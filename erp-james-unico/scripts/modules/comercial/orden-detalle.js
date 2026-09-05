(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;
  const COORDINATION_PAGE_KEY = "commercial-order-coordination";
  const COORDINATION_PAGE_SIZE = 25;
  const COORDINATION_REMOTE_PAGE_SIZE = 100;
  const TRACKING_PAGE_KEY = "commercial-order-status";
  const TRACKING_PAGE_SIZE = 12;
  const todayValue = () => BlessERP.utils?.today?.() || new Date().toISOString().slice(0, 10);
  const view = {
    search: "",
    status: "TODOS",
    trackingDate: todayValue(),
    coordinationDate: todayValue(),
    coordinationSearch: "",
    coordinationGuideStatus: "PENDIENTES",
    coordinationDrafts: new Map(),
    selectedOrderId: "",
    routeSheetOpen: false,
    routeSheetSelectedIds: new Set(),
    routeSheetRowsCache: null
  };
  let searchTimer = null;
  let coordinationRemoteController = null;
  let coordinationRemotePromise = null;
  let coordinationRemote = {
    requestKey: "",
    status: "idle",
    items: [],
    total: 0,
    error: ""
  };
  let catalogIndexCache = null;
  const listProgressCache = new WeakMap();

  function normalized(value) {
    return String(value || "").trim().toUpperCase();
  }

  function isOpenMixedLine(line) {
    return normalized(line?.boxBuildMode) === "MIXTO_ABIERTO";
  }

  function isAnyLengthLine(line) {
    return line?.anyLength === true || (isOpenMixedLine(line) && line?.mixedAnyLength !== false);
  }

  function actualComposition(line) {
    if (!isOpenMixedLine(line)) return "";
    const rows = Array.isArray(line.mixedActualComposition) ? line.mixedActualComposition : [];
    if (!rows.length) return "Todavía no se han escaneado ramos en este mixto abierto.";
    return rows
      .map(item => `${item.variety || "-"} ${Number(item.length || 0) || "-"} cm · ${Number(item.bunches || 0)} ramo(s)`)
      .join(" / ");
  }

  function catalogIndexes(appState) {
    const customerRows = stateApi.getCustomerCatalog?.(appState) || [];
    const brandRows = stateApi.getBrandCatalog?.(appState) || [];
    if (catalogIndexCache?.customerRows === customerRows && catalogIndexCache?.brandRows === brandRows) {
      return catalogIndexCache.indexes;
    }
    const indexes = {
      customers: new Map(customerRows.map(item => [String(item.id || ""), item])),
      brands: new Map(brandRows.map(item => [String(item.id || ""), item]))
    };
    catalogIndexCache = { customerRows, brandRows, indexes };
    return indexes;
  }

  function orderNames(appState, order, indexes = catalogIndexes(appState)) {
    const customer = indexes.customers.get(String(order.customerId || order.customer_id || ""));
    const brand = indexes.brands.get(String(order.brandId || order.brand_id || ""));
    return {
      customer: order.cliente_principal || order.cliente_principal_nombre || order.customerName
        || customer?.legalName || customer?.commercialName || customer?.name || "Sin cliente",
      brand: order.marca_cliente_final || order.marca_nombre || order.brandName
        || brand?.finalClientName || brand?.name || "Sin marca"
    };
  }

  function fulfillmentFor(appState, order) {
    return BlessERP.comercialOrderFulfillment?.buildOrderFulfillment?.(order)
      || BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, order.id) || {
      order,
      boxes: [],
      totalBoxes: 0,
      completeBoxes: 0,
      requiredBunches: 0,
      scannedBunches: 0,
      pendingBunches: 0,
      allBoxesComplete: false
    };
  }

  function fulfillmentProgressForList(order) {
    const lines = Array.isArray(order?.lines) ? order.lines : [];
    const boxFulfillmentSignature = Object.entries(order?.boxFulfillment || {})
      .map(([box, state]) => `${box}:${state?.closedAt || ""}:${state?.confirmedAt || ""}`)
      .join(",");
    const signature = lines.reduce((value, line) => {
      const scanned = Array.isArray(line?.scannedBunches) ? line.scannedBunches.length : 0;
      return `${value}|${line?.id || ""}:${line?.boxNumber || 1}:${line?.bunches || 0}:${scanned}:${line?.updatedAt || ""}`;
    }, `${lines.length}|${order?.updatedAt || order?.updated_at || ""}|${boxFulfillmentSignature}`);
    const cached = order && typeof order === "object" ? listProgressCache.get(order) : null;
    if (cached?.signature === signature) return cached.summary;
    const boxes = new Map();
    lines.forEach(line => {
      if (!line || typeof line !== "object") return;
      const boxNumber = Math.max(1, Number(line.boxNumber || 1));
      const progress = boxes.get(boxNumber) || {
        required: 0,
        scanned: 0,
        automaticComplete: true,
        lineCount: 0
      };
      const required = Number(line.bunches || 0);
      const scanned = Array.isArray(line.scannedBunches) ? line.scannedBunches.length : 0;
      progress.required += required;
      progress.scanned += scanned;
      progress.lineCount += 1;
      if (!(required > 0 && scanned >= required)) progress.automaticComplete = false;
      boxes.set(boxNumber, progress);
    });
    let completeBoxes = 0;
    let requiredBunches = 0;
    let scannedBunches = 0;
    boxes.forEach((progress, boxNumber) => {
      const saved = order?.boxFulfillment?.[boxNumber] || {};
      const closed = Boolean(saved.closedAt || saved.confirmedAt);
      if (closed || (progress.lineCount > 0 && progress.automaticComplete)) completeBoxes += 1;
      requiredBunches += progress.required;
      scannedBunches += progress.scanned;
    });
    const totalBoxes = boxes.size;
    const summary = {
      totalBoxes,
      completeBoxes,
      requiredBunches,
      scannedBunches,
      pendingBunches: Math.max(requiredBunches - scannedBunches, 0),
      allBoxesComplete: totalBoxes > 0 && completeBoxes === totalBoxes
    };
    if (order && typeof order === "object") listProgressCache.set(order, { signature, summary });
    return summary;
  }

  function statusFor(summary) {
    if (summary.totalBoxes > 0 && summary.allBoxesComplete) return "COMPLETO";
    if (Number(summary.scannedBunches || 0) > 0) return "INCOMPLETO";
    return "PENDIENTE";
  }

  function statusBadge(value) {
    return `<span class="status-badge ${utils.badgeClass(value)}">${utils.esc(value)}</span>`;
  }

  function orderTrackingDate(order) {
    return String(order?.issuedAt || order?.date || order?.fecha_emision || order?.createdAt || order?.created_at || "").slice(0, 10);
  }

  function listRows(appState) {
    const needle = normalized(view.search);
    const indexes = catalogIndexes(appState);
    return (stateApi.getOrders?.(appState) || [])
      .filter(order => normalized(order.status) !== "ANULADO")
      .filter(order => !view.trackingDate || orderTrackingDate(order) === view.trackingDate)
      .filter(order => {
        if (!needle) return true;
        const names = orderNames(appState, order, indexes);
        return normalized([
          order.number,
          order.numero_pedido,
          names.customer,
          names.brand,
          order.issuedAt,
          order.date,
          order.status
        ].join(" ")).includes(needle);
      })
      .map(order => {
        const summary = fulfillmentProgressForList(order);
        const names = orderNames(appState, order, indexes);
        return { order, summary, names, status: statusFor(summary) };
      })
      .filter(item => item.summary.totalBoxes > 0)
      .filter(item => view.status === "TODOS" || item.status === view.status)
      .sort((left, right) => String(right.order.issuedAt || right.order.date || right.order.createdAt || "")
        .localeCompare(String(left.order.issuedAt || left.order.date || left.order.createdAt || "")));
  }

  function renderTracking(appState) {
    const rows = listRows(appState);
    const pagination = BlessERP.performance?.paginate?.(rows, TRACKING_PAGE_KEY, { pageSize: TRACKING_PAGE_SIZE })
      || { items: rows.slice(0, TRACKING_PAGE_SIZE), total: rows.length, pageSize: TRACKING_PAGE_SIZE };
    const totals = rows.reduce((result, item) => {
      result[item.status] += 1;
      return result;
    }, { PENDIENTE: 0, INCOMPLETO: 0, COMPLETO: 0 });
    return `<div data-order-tracking-panel>
      <section class="summary-grid">
        <article class="summary-card"><span>Pendientes</span><strong>${utils.number(totals.PENDIENTE)}</strong><small>Sin lecturas</small></article>
        <article class="summary-card"><span>Incompletos</span><strong>${utils.number(totals.INCOMPLETO)}</strong><small>Con avance parcial</small></article>
        <article class="summary-card"><span>Completos</span><strong>${utils.number(totals.COMPLETO)}</strong><small>Todas las cajas completas</small></article>
      </section>
      <section class="panel-card order-tracking-filters">
        <div class="commercial-filter-grid">
          <label>Fecha del pedido<input type="date" value="${utils.esc(view.trackingDate)}" data-order-status-date></label>
          <label>Buscar pedido o cliente<input type="search" value="${utils.esc(view.search)}" placeholder="Numero, cliente o marca" data-order-status-search></label>
          <label>Estado<select data-order-status-filter><option value="TODOS" ${view.status === "TODOS" ? "selected" : ""}>Todos</option><option value="PENDIENTE" ${view.status === "PENDIENTE" ? "selected" : ""}>Pendientes</option><option value="INCOMPLETO" ${view.status === "INCOMPLETO" ? "selected" : ""}>Incompletos</option><option value="COMPLETO" ${view.status === "COMPLETO" ? "selected" : ""}>Completos</option></select></label>
          <div class="compact-action-row order-tracking-date-actions"><button class="secondary-button" type="button" data-order-status-today>Hoy</button><button class="secondary-button" type="button" data-order-status-all-dates>Ver todas las fechas</button></div>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">PEDIDOS</p><h3>Avance de Cuarto frio</h3><small>${view.trackingDate ? `Fecha: ${utils.esc(utils.dateLabel(view.trackingDate))}` : "Todas las fechas · carga paginada"}</small></div><span class="status-badge partial">${utils.number(rows.length)} pedido(s)</span></div>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente / marca</th><th>Cajas</th><th>Avance</th><th>Estado</th><th>Accion</th></tr></thead><tbody>
          ${pagination.items.map(item => `<tr><td><strong>${utils.esc(item.order.number || item.order.numero_pedido || item.order.id)}</strong></td><td>${utils.esc(utils.dateLabel(item.order.issuedAt || item.order.date || item.order.createdAt))}</td><td>${utils.esc(item.names.customer)}<br><small>${utils.esc(item.names.brand)}</small></td><td>${utils.number(item.summary.completeBoxes)} / ${utils.number(item.summary.totalBoxes)}</td><td><strong>${utils.number(item.summary.scannedBunches)} / ${utils.number(item.summary.requiredBunches)} ramos</strong><br><small>${utils.number(item.summary.pendingBunches)} pendiente(s)</small></td><td>${statusBadge(item.status)}</td><td><button class="secondary-button" type="button" data-order-status-open="${utils.esc(item.order.id)}">Ver cajas</button></td></tr>`).join("") || `<tr><td colspan="7">No hay pedidos con los filtros seleccionados.</td></tr>`}
        </tbody></table></div>
        ${BlessERP.performance?.renderPager?.(pagination) || ""}
      </section>
    </div>`;
  }

  function coordinationState(order) {
    if (utils.isLocalOrder?.(order)) return "NO_APLICA";
    const maritime = normalized(order.transportType) === "MARITIMO";
    const guidesOk = Boolean(String(order.awb || "").trim()) && Boolean(String(order.hawb || "").trim());
    const daeOk = !maritime || Boolean(String(order.sriDaeNumber || order.daeNumber || "").trim());
    return guidesOk && daeOk ? "COORDINADO" : "INCOMPLETO";
  }

  function guideCoordinationState(order) {
    if (utils.isLocalOrder?.(order)) return "NO_APLICA";
    const awbDigits = String(order.awb || "").replace(/\D/g, "");
    const hawb = String(order.hawb || "").trim();
    // El pedido aéreo inicia con el prefijo de tres dígitos. Mientras no tenga
    // los ocho dígitos restantes y su guía hija, continúa pendiente.
    return awbDigits.length === 11 && Boolean(hawb) ? "COORDINADA" : "PENDIENTE";
  }

  function coordinationRepository() {
    return BlessERP.getCommercialOrderRepository?.() || null;
  }

  function canUseRemoteCoordination() {
    return coordinationRepository()?.canListPage?.() === true;
  }

  function coordinationCatalogMatches(items, search, fields) {
    const needle = normalized(search);
    if (!needle) return [];
    return (Array.isArray(items) ? items : [])
      .filter(item => fields.some(field => normalized(item?.[field]).includes(needle)))
      .map(item => String(item.id || ""))
      .filter(Boolean)
      .slice(0, 100);
  }

  function coordinationRemoteDescriptor(appState) {
    const search = String(view.coordinationSearch || "").trim();
    const activeAccess = BlessERP.authAccess?.activeAccess?.();
    const companyKey = String(
      activeAccess?.activeCompany?.id
      || BlessERP.services?.companyContext?.activeCompanyId?.()
      || ""
    );
    const filters = {
      search,
      dateFrom: view.coordinationDate,
      dateTo: view.coordinationDate,
      customerMatches: coordinationCatalogMatches(
        stateApi.getCustomerCatalog?.(appState) || [],
        search,
        ["legalName", "commercialName", "name", "taxId"]
      ),
      brandMatches: coordinationCatalogMatches(
        stateApi.getBrandCatalog?.(appState) || [],
        search,
        ["finalClientName", "name", "countryName"]
      )
    };
    return {
      page: 1,
      pageSize: COORDINATION_REMOTE_PAGE_SIZE,
      filters,
      key: JSON.stringify({
        company: companyKey,
        date: view.coordinationDate,
        search: normalized(search),
        customerMatches: filters.customerMatches,
        brandMatches: filters.brandMatches
      })
    };
  }

  function invalidateRemoteCoordination() {
    coordinationRemoteController?.abort?.();
    coordinationRemoteController = null;
    coordinationRemotePromise = null;
    coordinationRemote = {
      requestKey: "",
      status: "idle",
      items: [],
      total: 0,
      error: ""
    };
  }

  async function ensureRemoteCoordination(appState, options = {}) {
    if (!canUseRemoteCoordination()) return { ok: false, mode: "LOCAL_FALLBACK" };
    const descriptor = coordinationRemoteDescriptor(appState);
    if (!options.force && coordinationRemote.requestKey === descriptor.key && coordinationRemote.status === "ready") {
      return { ok: true, cached: true };
    }
    if (!options.force && coordinationRemotePromise && coordinationRemote.requestKey === descriptor.key) {
      return coordinationRemotePromise;
    }

    coordinationRemoteController?.abort?.();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    coordinationRemoteController = controller;
    coordinationRemote = {
      requestKey: descriptor.key,
      status: "loading",
      items: [],
      total: 0,
      error: ""
    };
    const repository = coordinationRepository();
    const requestKey = descriptor.key;
    coordinationRemotePromise = (async () => {
      const items = [];
      let page = 1;
      let totalPages = 1;
      do {
        const request = () => repository.listPage({
          ...descriptor,
          page,
          signal: controller?.signal
        });
        const result = await (BlessERP.performance?.measureAsync
          ? BlessERP.performance.measureAsync(
              "coordinacion:supabase:fecha",
              request,
              { date: descriptor.dateFrom, page, pageSize: descriptor.pageSize }
            )
          : request());
        if (coordinationRemote.requestKey !== requestKey || controller?.signal?.aborted) {
          return { ok: false, aborted: true };
        }
        if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la coordinación en Supabase.");
        items.push(...result.items.map(order => utils.normalizeOrder(order)));
        totalPages = Math.max(1, Number(result.totalPages || 1));
        page += 1;
      } while (page <= totalPages);

      coordinationRemote = {
        requestKey,
        status: "ready",
        items,
        total: items.length,
        error: ""
      };
      invalidateRouteSheetRows();
      const routeId = BlessERP.state?.currentRoute?.()?.id;
      if (routeId === "commercial-order-coordination") {
        const pageRoot = document.querySelector("#page-root");
        refreshCoordinationResults(pageRoot, appState);
        if (view.routeSheetOpen) {
          resetRouteSheetSelection(appState);
          refreshRouteSheetModal(pageRoot, appState);
        }
      }
      return { ok: true, items };
    })().catch(error => {
      if (!controller?.signal?.aborted && coordinationRemote.requestKey === requestKey) {
        coordinationRemote.status = "error";
        coordinationRemote.error = error?.message || "No se pudo consultar Supabase.";
        const routeId = BlessERP.state?.currentRoute?.()?.id;
        if (routeId === "commercial-order-coordination") {
          refreshCoordinationResults(document.querySelector("#page-root"), appState);
        }
      }
      return { ok: false, error };
    }).finally(() => {
      if (coordinationRemote.requestKey === requestKey) {
        coordinationRemoteController = null;
        coordinationRemotePromise = null;
      }
    });
    return coordinationRemotePromise;
  }

  function coordinationSourceOrders(appState) {
    if (!canUseRemoteCoordination()) return stateApi.getOrders?.(appState) || [];
    const descriptor = coordinationRemoteDescriptor(appState);
    if (coordinationRemote.status === "ready"
      && coordinationRemote.requestKey === descriptor.key) {
      return coordinationRemote.items;
    }
    return stateApi.getOrders?.(appState) || [];
  }

  function coordinationValues(order) {
    return {
      awb: String(order?.awb || "").trim(),
      hawb: String(order?.hawb || "").trim(),
      daeNumber: String(order?.sriDaeNumber || order?.daeNumber || "").trim()
    };
  }

  function coordinationDraft(order) {
    return view.coordinationDrafts.get(String(order?.id || "")) || coordinationValues(order);
  }

  function effectiveCoordinationOrder(order) {
    const draft = coordinationDraft(order);
    return {
      ...order,
      awb: draft.awb,
      hawb: draft.hawb,
      daeNumber: draft.daeNumber,
      sriDaeNumber: draft.daeNumber
    };
  }

  function valuesAreDifferent(order, values) {
    const original = coordinationValues(order);
    return original.awb !== String(values.awb || "").trim()
      || original.hawb !== String(values.hawb || "").trim()
      || original.daeNumber !== String(values.daeNumber || "").trim();
  }

  function findCoordinationOrder(appState, orderId) {
    const id = String(orderId || "");
    return coordinationSourceOrders(appState).find(order => String(order.id) === id)
      || (stateApi.getOrders?.(appState) || []).find(order => String(order.id) === id)
      || null;
  }

  function coordinationRows(appState) {
    const needle = normalized(view.coordinationSearch);
    const indexes = catalogIndexes(appState);
    return coordinationSourceOrders(appState)
      .filter(order => normalized(order.status) !== "ANULADO")
      .filter(order => String(order.issuedAt || order.date || "").slice(0, 10) === view.coordinationDate)
      .map(order => {
        const effectiveOrder = effectiveCoordinationOrder(order);
        return {
          order: effectiveOrder,
          sourceOrder: order,
          names: orderNames(appState, effectiveOrder, indexes),
          state: coordinationState(effectiveOrder),
          guideState: guideCoordinationState(effectiveOrder)
        };
      })
      .filter(item => !needle || normalized([item.order.number, item.names.customer, item.names.brand, item.order.awb, item.order.hawb].join(" ")).includes(needle))
      .filter(item => view.coordinationGuideStatus === "TODAS"
        || (view.coordinationGuideStatus === "COORDINADAS" && item.guideState === "COORDINADA")
        || (view.coordinationGuideStatus === "PENDIENTES" && item.guideState === "PENDIENTE"))
      .sort((left, right) => String(left.order.number || "").localeCompare(String(right.order.number || "")));
  }

  function routeSheetRows(appState) {
    const sourceOrders = coordinationSourceOrders(appState);
    if (view.routeSheetRowsCache?.date === view.coordinationDate
      && view.routeSheetRowsCache.source === sourceOrders
      && view.routeSheetRowsCache.sourceLength === sourceOrders.length) {
      return view.routeSheetRowsCache.rows;
    }
    const indexes = catalogIndexes(appState);
    const rows = sourceOrders
      .filter(order => String(order.issuedAt || order.date || "").slice(0, 10) === view.coordinationDate)
      .filter(order => normalized(order.status) !== "ANULADO")
      .filter(order => normalized(order.transportType) === "AEREO")
      .map(sourceOrder => {
        const order = utils.normalizeOrder(sourceOrder);
        const summary = order._historyMetrics && typeof order._historyMetrics === "object"
          ? order._historyMetrics
          : null;
        return {
          order,
          names: orderNames(appState, order, indexes),
          agency: utils.findAgency(order.agencyId),
          metrics: summary || utils.getOrderMetrics(order)
        };
      })
      .sort((left, right) => String(left.order.number || "").localeCompare(String(right.order.number || "")));
    view.routeSheetRowsCache = { date: view.coordinationDate, source: sourceOrders, sourceLength: sourceOrders.length, rows };
    return rows;
  }

  function invalidateRouteSheetRows() {
    view.routeSheetRowsCache = null;
  }

  function selectedRouteSheetOrders(appState) {
    return routeSheetRows(appState)
      .filter(item => view.routeSheetSelectedIds.has(item.order.id))
      .map(item => item.order);
  }

  function resetRouteSheetSelection(appState, rows = routeSheetRows(appState)) {
    view.routeSheetSelectedIds = new Set(rows.map(item => item.order.id));
  }

  function renderRouteSheetModal(appState) {
    if (!view.routeSheetOpen) return "";
    const rows = routeSheetRows(appState);
    const selected = view.routeSheetSelectedIds;
    const totals = rows.reduce((sum, item) => {
      if (!selected.has(item.order.id)) return sum;
      sum.orders += 1;
      sum.boxes += Number(item.metrics.totalBoxes || 0);
      sum.fulls += Number(item.metrics.totalFulls || 0);
      return sum;
    }, { orders: 0, boxes: 0, fulls: 0 });
    return `
      <div class="commercial-quick-editor-modal commercial-route-sheet-modal" data-coordination-route-sheet-backdrop>
        <section class="panel-card commercial-quick-editor-dialog commercial-route-sheet-dialog" role="dialog" aria-modal="true" aria-label="Hoja de Ruta del ${utils.esc(view.coordinationDate)}">
          <div class="panel-card-head commercial-quick-editor-head">
            <div><p class="section-kicker">COORDINACION DIARIA</p><h2>Hoja de Ruta</h2><p class="panel-note">Usa la misma fecha de Coordinación y muestra únicamente los pedidos aéreos del día.</p></div>
            <button class="commercial-order-control-close" type="button" data-coordination-route-sheet-close aria-label="Cerrar">×</button>
          </div>
          <div class="commercial-route-sheet-controls">
            <label class="compact-field"><span>Fecha del pedido</span><input type="date" value="${utils.esc(view.coordinationDate)}" data-coordination-route-sheet-date></label>
            <button class="secondary-button" type="button" data-coordination-route-sheet-select-all ${rows.length ? "" : "disabled"}>Marcar todos</button>
            <button class="secondary-button" type="button" data-coordination-route-sheet-clear ${selected.size ? "" : "disabled"}>Desmarcar todos</button>
            <div class="commercial-route-sheet-summary" data-coordination-route-sheet-summary><strong>${utils.number(totals.orders)} pedido(s)</strong><span>${utils.number(totals.boxes)} pieza(s) · ${utils.number(totals.fulls, 3)} fulls</span></div>
          </div>
          <div class="compact-table-wrap commercial-route-sheet-table-wrap"><table class="compact-table commercial-route-sheet-table">
            <thead><tr><th>Elegir</th><th>Pedido</th><th>Factura</th><th>Cliente / consignatario</th><th>Agencia</th><th>Cuarto frío</th><th>Piezas</th><th>Fulls</th></tr></thead>
            <tbody>${rows.map(item => `<tr class="${selected.has(item.order.id) ? "is-selected" : ""}">
              <td><input type="checkbox" data-coordination-route-sheet-order="${utils.esc(item.order.id)}" data-boxes="${utils.esc(item.metrics.totalBoxes)}" data-fulls="${utils.esc(Number(item.metrics.totalFulls || 0).toFixed(3))}" ${selected.has(item.order.id) ? "checked" : ""}></td>
              <td><strong>${utils.esc(item.order.number || "-")}</strong></td><td>${utils.esc(item.order.sriInvoiceNumber || item.order.invoicePackingNumber || "Pendiente")}</td>
              <td>${utils.esc(item.names.brand || item.names.customer)}</td><td>${utils.esc(item.agency?.name || "-")}</td><td>${utils.esc(item.order.coldRoom || "-")}</td>
              <td>${utils.number(item.metrics.totalBoxes)}</td><td>${utils.number(item.metrics.totalFulls, 3)}</td>
            </tr>`).join("") || `<tr><td colspan="8">No existen pedidos aéreos para la fecha seleccionada.</td></tr>`}</tbody>
          </table></div>
          <div class="commercial-route-sheet-actions"><button class="secondary-button" type="button" data-coordination-route-sheet-preview ${totals.orders ? "" : "disabled"}>Vista previa</button><button class="primary-button" type="button" data-coordination-route-sheet-download ${totals.orders ? "" : "disabled"}>Imprimir / guardar PDF</button></div>
        </section>
      </div>
    `;
  }

  function coordinationDirtyIds(appState) {
    const known = new Map();
    (stateApi.getOrders?.(appState) || []).forEach(order => known.set(String(order.id || ""), order));
    coordinationRemote.items.forEach(order => known.set(String(order.id || ""), order));
    return [...view.coordinationDrafts.keys()].filter(orderId => {
      const order = known.get(String(orderId));
      return order && String(order.issuedAt || order.date || "").slice(0, 10) === view.coordinationDate;
    });
  }

  function coordinationSourceStatus() {
    if (!canUseRemoteCoordination()) return "";
    if (coordinationRemote.status === "loading") {
      return `<div class="commercial-history-source-status loading"><span></span>Consultando únicamente los pedidos del ${utils.esc(utils.dateLabel(view.coordinationDate))}…</div>`;
    }
    if (coordinationRemote.status === "error") {
      return `<div class="commercial-history-source-status error"><span></span><strong>No se pudo consultar la fecha en Supabase.</strong><small>Se mantienen visibles los datos locales. ${utils.esc(coordinationRemote.error)}</small><button type="button" class="secondary-button compact-button" data-order-coordination-retry-server>Reintentar</button></div>`;
    }
    if (coordinationRemote.status === "ready") {
      return `<div class="commercial-history-source-status ready"><span></span>${utils.number(coordinationRemote.total)} pedido(s) del día confirmados desde Supabase</div>`;
    }
    return "";
  }

  function coordinationResultModel(appState) {
    const rows = coordinationRows(appState);
    const pagination = BlessERP.performance?.paginate?.(rows, COORDINATION_PAGE_KEY, { pageSize: COORDINATION_PAGE_SIZE })
      || {
        key: COORDINATION_PAGE_KEY,
        items: rows.slice(0, COORDINATION_PAGE_SIZE),
        page: 1,
        pageSize: COORDINATION_PAGE_SIZE,
        total: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / COORDINATION_PAGE_SIZE)),
        start: rows.length ? 1 : 0,
        end: Math.min(rows.length, COORDINATION_PAGE_SIZE)
      };
    const coordinated = rows.filter(item => item.state === "COORDINADO" || item.state === "NO_APLICA").length;
    return { rows, pagination, coordinated, dirtyCount: coordinationDirtyIds(appState).length };
  }

  function renderCoordinationResults(appState, model = coordinationResultModel(appState)) {
    return `
      ${coordinationSourceStatus()}
      <div class="compact-table-wrap"><table class="compact-table order-coordination-table"><thead><tr><th>Pedido</th><th>Cliente / marca</th><th>Tipo</th><th>Guia madre</th><th>Guia hija</th><th>DAE maritima</th><th>Estado</th><th>Accion</th></tr></thead><tbody>
        ${model.pagination.items.map(item => {
          const order = item.order;
          const sourceOrder = item.sourceOrder || order;
          const local = utils.isLocalOrder?.(order);
          const maritime = normalized(order.transportType) === "MARITIMO";
          const sriLocked = Boolean(order.sriRemoteDocumentId) || normalized(order.sriAuthorizationStatus || "PENDIENTE") !== "PENDIENTE";
          const editable = !local && !sriLocked;
          const dirty = view.coordinationDrafts.has(String(order.id));
          return `<tr class="${dirty ? "is-dirty" : ""}" data-order-coordination-row="${utils.esc(order.id)}"><td><strong>${utils.esc(order.number || order.id)}</strong><br><small>${utils.esc(utils.dateLabel(order.issuedAt || order.date))}</small></td><td>${utils.esc(item.names.customer)}<br><small>${utils.esc(item.names.brand)}</small></td><td>${utils.esc(local ? "LOCAL" : order.transportType || "AEREO")}</td><td><input value="${utils.esc(order.awb || "")}" data-order-coordination-field="awb" data-original-value="${utils.esc(sourceOrder.awb || "")}" ${editable ? "" : "disabled"}></td><td><input value="${utils.esc(order.hawb || "")}" data-order-coordination-field="hawb" data-original-value="${utils.esc(sourceOrder.hawb || "")}" ${editable ? "" : "disabled"}></td><td>${maritime && !local ? `<input value="${utils.esc(order.sriDaeNumber || order.daeNumber || "")}" data-order-coordination-field="daeNumber" data-original-value="${utils.esc(sourceOrder.sriDaeNumber || sourceOrder.daeNumber || "")}" ${editable ? "" : "disabled"}>` : `<span class="panel-note">No aplica</span>`}</td><td data-order-coordination-status>${statusBadge(item.state)}</td><td><button class="primary-button" type="button" data-order-coordination-save="${utils.esc(order.id)}" ${editable && dirty ? "" : "disabled"}>Guardar</button></td></tr>`;
        }).join("") || `<tr><td colspan="8">No hay pedidos para la fecha y filtros seleccionados.</td></tr>`}
      </tbody></table></div>
      ${BlessERP.performance?.renderPager?.(model.pagination) || ""}
    `;
  }

  function renderCoordination(appState) {
    const model = coordinationResultModel(appState);
    return `
      <section class="panel-card order-coordination-panel" data-order-coordination-panel>
        <div class="panel-card-head"><div><p class="section-kicker">COORDINACION DIARIA</p><h3>Guias y DAE de los pedidos del dia</h3><p class="panel-note">Los cambios se guardan directamente en el pedido original y actualizan sus documentos pendientes.</p></div><div class="table-actions-inline"><span class="status-badge ${model.coordinated === model.rows.length && model.rows.length ? "authorized" : "partial"}" data-order-coordination-summary>${utils.number(model.coordinated)} / ${utils.number(model.rows.length)} coordinados</span><button class="secondary-button" type="button" data-coordination-route-sheet-open>Hoja de Ruta</button><button class="primary-button" type="button" data-order-coordination-save-all ${model.dirtyCount ? "" : "disabled"}>Guardar cambios${model.dirtyCount ? ` (${utils.number(model.dirtyCount)})` : ""}</button></div></div>
        <div class="commercial-filter-grid order-coordination-filters">
          <label>Fecha del pedido<input type="date" value="${utils.esc(view.coordinationDate)}" data-order-coordination-date></label>
          <label>Estado de las guías<select data-order-coordination-guide-status><option value="TODAS" ${view.coordinationGuideStatus === "TODAS" ? "selected" : ""}>Todas</option><option value="COORDINADAS" ${view.coordinationGuideStatus === "COORDINADAS" ? "selected" : ""}>Guías coordinadas</option><option value="PENDIENTES" ${view.coordinationGuideStatus === "PENDIENTES" ? "selected" : ""}>Pendientes de coordinar</option></select><small>Una guía con solo el prefijo de 3 dígitos y el resto vacío se considera pendiente.</small></label>
          <label>Buscar<input type="search" value="${utils.esc(view.coordinationSearch)}" placeholder="Pedido, cliente o guia" data-order-coordination-search></label>
        </div>
        <div data-order-coordination-results>${renderCoordinationResults(appState, model)}</div>
      </section>
    `;
  }

  function renderDetailModal(appState, order) {
    if (!order) return "";
    const summary = fulfillmentFor(appState, order);
    const names = orderNames(appState, order);
    const status = statusFor(summary);
    return `
      <div class="erp-modal-backdrop" data-order-status-backdrop>
        <section class="erp-modal-card cold-room-preview-modal" role="dialog" aria-modal="true" aria-label="Estado del pedido ${utils.esc(order.number || order.id)}">
          <header class="erp-modal-header">
            <div>
              <p class="section-kicker">ESTADO DEL PEDIDO</p>
              <h3>${utils.esc(order.number || order.numero_pedido || order.id)}</h3>
              <p class="panel-note">${utils.esc(names.customer)} · ${utils.esc(names.brand)} · ${utils.esc(utils.dateLabel(order.issuedAt || order.date || order.createdAt))}</p>
            </div>
            <div class="table-actions-inline">${statusBadge(status)}<button class="secondary-button" type="button" data-order-status-close>Cerrar</button></div>
          </header>
          <div class="cold-room-preview-body">
            <div class="cold-room-mini-summary">
              <div><span>Cajas</span><strong>${utils.number(summary.totalBoxes)}</strong></div>
              <div><span>Completas</span><strong>${utils.number(summary.completeBoxes)}</strong></div>
              <div><span>Ramos ingresados</span><strong>${utils.number(summary.scannedBunches)}</strong></div>
              <div><span>Ramos pendientes</span><strong>${utils.number(summary.pendingBunches)}</strong></div>
            </div>
            <section class="cold-room-preview-section">
              <div class="panel-card-head"><div><p class="section-kicker">CONTENIDO POR CAJA</p><h3>Lo solicitado y lo ingresado en Cuarto frío</h3></div></div>
              <div class="compact-table-wrap">
                <table class="compact-table">
                  <thead><tr><th>Caja</th><th>Tipo</th><th>Variedad / composición real</th><th>Solicitados</th><th>Ingresados</th><th>Pendientes</th><th>Estado</th></tr></thead>
                  <tbody>${summary.boxes.map(box => box.lines.map((item, index) => {
                    const composition = actualComposition(item.line);
                    const requested = isOpenMixedLine(item.line)
                      ? `MIXTO ABIERTO${isAnyLengthLine(item.line) ? " · CUALQUIER MEDIDA" : ` · ${utils.number(item.line.length)} cm`}`
                      : `${item.line.variety || "-"} · ${isAnyLengthLine(item.line) ? "CUALQUIER MEDIDA" : `${utils.number(item.line.length)} cm`}`;
                    return `<tr>
                      ${index === 0 ? `<td rowspan="${box.lines.length}"><strong>Caja ${utils.esc(box.boxNumber)}</strong></td><td rowspan="${box.lines.length}">${utils.esc(box.boxType)}</td>` : ""}
                      <td><strong>${utils.esc(requested)}</strong>${composition ? `<br><small class="master-mix-actual">Ingresado: ${utils.esc(composition)}</small>` : ""}</td>
                      <td>${utils.number(item.required)}</td><td>${utils.number(item.scanned)}</td><td>${utils.number(item.pending)}</td>
                      <td>${statusBadge(item.pending === 0 ? "COMPLETO" : item.scanned > 0 ? "INCOMPLETO" : "PENDIENTE")}</td>
                    </tr>`;
                  }).join("")).join("") || `<tr><td colspan="7">El pedido no contiene cajas.</td></tr>`}</tbody>
                </table>
              </div>
            </section>
          </div>
          <footer class="erp-modal-footer"><span class="panel-note">Vista de consulta. El escaneo se realiza únicamente desde Cuarto frío.</span><button class="primary-button" type="button" data-order-status-close>Cerrar detalle</button></footer>
        </section>
      </div>
    `;
  }

  function render(appState, requestedView = "SEGUIMIENTO") {
    const activeView = requestedView === "COORDINACION" ? "COORDINACION" : "SEGUIMIENTO";
    const selectedOrder = view.selectedOrderId
      ? (stateApi.getOrders?.(appState) || []).find(order => String(order.id) === String(view.selectedOrderId))
      : null;

    return `
      <section class="page-header">
        <div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>${activeView === "COORDINACION" ? "Coordinacion diaria" : "Seguimiento de pedidos"}</h1><p>${activeView === "COORDINACION" ? "Complete las guias y DAE maritimas de todos los pedidos de una fecha desde un solo editor." : "Consulte el avance de Cuarto frio y el contenido real ingresado en cada caja."}</p></div>
        <div class="page-header-side"><button class="secondary-button" type="button" data-route-link="${activeView === "COORDINACION" ? "commercial-order-detail" : "commercial-order-coordination"}">${activeView === "COORDINACION" ? "Ver seguimiento" : "Abrir coordinacion"}</button></div>
      </section>
      ${activeView === "COORDINACION" ? renderCoordination(appState) : renderTracking(appState)}
      ${activeView === "SEGUIMIENTO" ? renderDetailModal(appState, selectedOrder) : renderRouteSheetModal(appState)}
    `;
  }

  function rerender() {
    BlessERP.layout.renderPage();
  }

  function open(orderId) {
    view.selectedOrderId = String(orderId || "");
  }

  function refreshRouteSheetSelection(container) {
    const fields = [...container.querySelectorAll("[data-coordination-route-sheet-order]")];
    let orders = 0;
    let boxes = 0;
    let fulls = 0;
    fields.forEach(field => {
      field.closest("tr")?.classList.toggle("is-selected", field.checked);
      if (!field.checked) return;
      orders += 1;
      boxes += Number(field.dataset.boxes || 0);
      fulls += Number(field.dataset.fulls || 0);
    });
    const summary = container.querySelector("[data-coordination-route-sheet-summary]");
    if (summary) {
      summary.querySelector("strong").textContent = `${orders} pedido(s)`;
      summary.querySelector("span").textContent = `${boxes} pieza(s) · ${fulls.toFixed(3)} fulls`;
    }
    container.querySelectorAll("[data-coordination-route-sheet-preview], [data-coordination-route-sheet-download]").forEach(button => { button.disabled = orders === 0; });
    const clear = container.querySelector("[data-coordination-route-sheet-clear]");
    if (clear) clear.disabled = orders === 0;
  }

  function refreshRouteSheetModal(container, appState) {
    const current = container?.querySelector("[data-coordination-route-sheet-backdrop]");
    if (!current || !view.routeSheetOpen) return;
    current.outerHTML = renderRouteSheetModal(appState);
    bindRouteSheetModal(container, appState);
  }

  function closeRouteSheetModal(container) {
    view.routeSheetOpen = false;
    container?.querySelector("[data-coordination-route-sheet-backdrop]")?.remove();
  }

  function openRouteSheetModal(container, appState) {
    view.routeSheetOpen = true;
    invalidateRouteSheetRows();
    const rows = routeSheetRows(appState);
    resetRouteSheetSelection(appState, rows);
    container.querySelector("[data-coordination-route-sheet-backdrop]")?.remove();
    container.insertAdjacentHTML("beforeend", renderRouteSheetModal(appState));
    bindRouteSheetModal(container, appState);
    // La primera carga del módulo de impresión se realiza mientras el usuario
    // revisa la selección, no después de pulsar Imprimir.
    void BlessERP.moduleLoader.loadGroup("commercial-coordination-print").catch(() => {});
  }

  async function hydrateRouteSheetOrders(appState, orders) {
    const localById = new Map((stateApi.getOrders?.(appState) || []).map(order => [String(order.id || ""), order]));
    const resolved = orders.map(order => {
      const local = localById.get(String(order.id || ""));
      if (local && Array.isArray(local.lines) && !local.__historyServerPage) return utils.normalizeOrder(local);
      return order;
    });
    const pendingIndexes = resolved
      .map((order, index) => ({ order, index }))
      .filter(item => item.order?.__historyServerPage && !Array.isArray(item.order.lines));
    if (!pendingIndexes.length) return resolved;

    const repository = coordinationRepository();
    if (typeof repository?.getFullOrder !== "function") {
      throw new Error("No se pudo recuperar el detalle de las cajas seleccionadas.");
    }
    const batchSize = 6;
    for (let offset = 0; offset < pendingIndexes.length; offset += batchSize) {
      const batch = pendingIndexes.slice(offset, offset + batchSize);
      const results = await Promise.all(batch.map(item => repository.getFullOrder(item.order.id)));
      results.forEach((result, position) => {
        if (!result?.ok || !result.order) {
          throw new Error(result?.message || `No se pudo cargar el pedido ${batch[position].order.number || batch[position].order.id}.`);
        }
        resolved[batch[position].index] = utils.normalizeOrder(result.order);
      });
    }
    return resolved;
  }

  async function printRouteSheet(appState, autoPrint, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Preparando...";
    try {
      await BlessERP.moduleLoader.loadGroup("commercial-coordination-print");
      const selectedOrders = selectedRouteSheetOrders(appState);
      const hydrate = () => hydrateRouteSheetOrders(appState, selectedOrders);
      const orders = await (BlessERP.performance?.measureAsync
        ? BlessERP.performance.measureAsync(
            "hoja-ruta:preparar-pedidos",
            hydrate,
            { date: view.coordinationDate, orders: selectedOrders.length }
          )
        : hydrate());
      if (!orders.length) {
        BlessERP.layout.toast("Seleccione al menos un pedido para la Hoja de Ruta.");
        return;
      }
      const generate = () => BlessERP.comercialPrintSystem.openDocuments("HR", orders, appState, {
          autoPrint,
          saveAsPdf: autoPrint,
          pageSize: "A4",
          options: { routeOrders: orders, routeDate: view.coordinationDate }
        });
      if (BlessERP.performance?.measureAsync) {
        await BlessERP.performance.measureAsync(
          "hoja-ruta:generar-documento",
          async () => generate(),
          { date: view.coordinationDate, orders: orders.length, autoPrint }
        );
      } else {
        await generate();
      }
    } catch (error) {
      BlessERP.layout.toast(error?.message || "No se pudo preparar la Hoja de Ruta.");
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function bindRouteSheetModal(container, appState) {
    const backdrop = container.querySelector("[data-coordination-route-sheet-backdrop]");
    if (!backdrop) return;
    backdrop.querySelector("[data-coordination-route-sheet-close]")?.addEventListener("click", () => closeRouteSheetModal(container));
    backdrop.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeRouteSheetModal(container);
    });
    backdrop.querySelector("[data-coordination-route-sheet-date]")?.addEventListener("change", event => {
      view.coordinationDate = event.target.value || BlessERP.utils?.today?.() || new Date().toISOString().slice(0, 10);
      invalidateRouteSheetRows();
      BlessERP.performance?.resetPage?.(COORDINATION_PAGE_KEY);
      invalidateRemoteCoordination();
      const coordinationDate = container.querySelector("[data-order-coordination-date]");
      if (coordinationDate) coordinationDate.value = view.coordinationDate;
      refreshCoordinationResults(container, appState);
      resetRouteSheetSelection(appState);
      refreshRouteSheetModal(container, appState);
      void ensureRemoteCoordination(appState).then(() => {
        if (!view.routeSheetOpen) return;
        invalidateRouteSheetRows();
        resetRouteSheetSelection(appState);
        refreshRouteSheetModal(container, appState);
      });
    });
    backdrop.querySelectorAll("[data-coordination-route-sheet-order]").forEach(field => field.addEventListener("change", () => {
      if (field.checked) view.routeSheetSelectedIds.add(field.dataset.coordinationRouteSheetOrder);
      else view.routeSheetSelectedIds.delete(field.dataset.coordinationRouteSheetOrder);
      refreshRouteSheetSelection(backdrop);
    }));
    backdrop.querySelector("[data-coordination-route-sheet-select-all]")?.addEventListener("click", () => {
      resetRouteSheetSelection(appState);
      backdrop.querySelectorAll("[data-coordination-route-sheet-order]").forEach(field => { field.checked = true; });
      refreshRouteSheetSelection(backdrop);
    });
    backdrop.querySelector("[data-coordination-route-sheet-clear]")?.addEventListener("click", () => {
      view.routeSheetSelectedIds.clear();
      backdrop.querySelectorAll("[data-coordination-route-sheet-order]").forEach(field => { field.checked = false; });
      refreshRouteSheetSelection(backdrop);
    });
    backdrop.querySelector("[data-coordination-route-sheet-preview]")?.addEventListener("click", event => printRouteSheet(appState, false, event.currentTarget));
    backdrop.querySelector("[data-coordination-route-sheet-download]")?.addEventListener("click", event => printRouteSheet(appState, true, event.currentTarget));
  }

  function refreshCoordinationControls(container, appState, model = coordinationResultModel(appState)) {
    if (!container) return;
    const summary = container.querySelector("[data-order-coordination-summary]");
    if (summary) {
      summary.className = `status-badge ${model.coordinated === model.rows.length && model.rows.length ? "authorized" : "partial"}`;
      summary.textContent = `${utils.number(model.coordinated)} / ${utils.number(model.rows.length)} coordinados`;
    }
    const saveAll = container.querySelector("[data-order-coordination-save-all]");
    if (saveAll) {
      saveAll.disabled = model.dirtyCount === 0;
      saveAll.textContent = `Guardar cambios${model.dirtyCount ? ` (${utils.number(model.dirtyCount)})` : ""}`;
    }
  }

  function refreshCoordinationResults(container, appState) {
    if (!container) return;
    const results = container.querySelector("[data-order-coordination-results]");
    if (!results) return;
    const render = () => {
      const model = coordinationResultModel(appState);
      results.innerHTML = renderCoordinationResults(appState, model);
      bindCoordinationResultEvents(container, appState);
      refreshCoordinationControls(container, appState, model);
    };
    if (BlessERP.performance?.measureSync) {
      BlessERP.performance.measureSync("coordinacion:actualizar-resultados", render, {
        date: view.coordinationDate,
        status: view.coordinationGuideStatus
      });
    } else {
      render();
    }
  }

  function valuesFromCoordinationRow(row, order) {
    const current = coordinationDraft(order);
    const fieldValue = field => {
      const input = row?.querySelector(`[data-order-coordination-field="${field}"]`);
      return input ? String(input.value || "").trim() : current[field];
    };
    return {
      awb: fieldValue("awb"),
      hawb: fieldValue("hawb"),
      daeNumber: fieldValue("daeNumber")
    };
  }

  function markCoordinationRowDirty(container, appState, row) {
    const orderId = String(row?.dataset.orderCoordinationRow || "");
    const order = findCoordinationOrder(appState, orderId);
    if (!row || !order) return;
    const values = valuesFromCoordinationRow(row, order);
    const dirty = valuesAreDifferent(order, values);
    if (dirty) view.coordinationDrafts.set(orderId, values);
    else view.coordinationDrafts.delete(orderId);
    row.classList.toggle("is-dirty", dirty);
    const button = row.querySelector("[data-order-coordination-save]");
    if (button) button.disabled = !dirty;
    const effective = { ...order, ...values, sriDaeNumber: values.daeNumber };
    const status = row.querySelector("[data-order-coordination-status]");
    if (status) status.innerHTML = statusBadge(coordinationState(effective));
    refreshCoordinationControls(container, appState);
  }

  async function ensureLocalCoordinationOrder(appState, orderId) {
    const id = String(orderId || "");
    const localOrders = stateApi.getOrders?.(appState) || [];
    const local = localOrders.find(order => String(order.id) === id);
    if (local) return { ok: true, order: local };
    const repository = coordinationRepository();
    if (!repository?.getFullOrder || !canUseRemoteCoordination()) {
      return { ok: false, message: "El pedido ya no está disponible para edición." };
    }
    const result = await repository.getFullOrder(id);
    if (!result?.ok || !result.order) return result || { ok: false, message: "No se pudo recuperar el pedido." };
    const order = utils.normalizeOrder(result.order);
    localOrders.push(order);
    return { ok: true, order };
  }

  function updateRemoteCoordinationCache(order) {
    const index = coordinationRemote.items.findIndex(item => String(item.id) === String(order?.id));
    if (index < 0) return;
    coordinationRemote.items[index] = {
      ...coordinationRemote.items[index],
      ...order,
      __historyServerPage: coordinationRemote.items[index].__historyServerPage
    };
  }

  async function saveCoordinationDraft(appState, orderId, options = {}) {
    const id = String(orderId || "");
    const values = view.coordinationDrafts.get(id);
    if (!values) return { ok: true, changed: false, message: "La fila no tiene cambios pendientes." };
    const hydrated = await ensureLocalCoordinationOrder(appState, id);
    if (!hydrated?.ok || !hydrated.order) return hydrated;
    const result = stateApi.updateOrderCoordination?.(appState, id, values, {
      deferSave: options.deferSave === true
    }) || { ok: false, message: "No se encontró el servicio de coordinación." };
    if (result?.ok) {
      view.coordinationDrafts.delete(id);
      updateRemoteCoordinationCache(result.order || hydrated.order);
      invalidateRouteSheetRows();
    }
    return result;
  }

  async function saveAllCoordinationDrafts(container, appState, button) {
    const ids = coordinationDirtyIds(appState);
    if (!ids.length) return;
    const originalText = button?.textContent || "Guardar cambios";
    if (button) {
      button.disabled = true;
      button.textContent = "Guardando…";
    }
    let changed = 0;
    const errors = [];
    for (const orderId of ids) {
      const result = await saveCoordinationDraft(appState, orderId, { deferSave: true });
      if (result?.changed) changed += 1;
      else if (!result?.ok) errors.push(result?.message || `No se pudo actualizar ${orderId}.`);
    }
    if (changed) {
      BlessERP.state.saveDb();
      await BlessERP.state.waitForLastSave?.({ processRemote: false });
    }
    if (errors.length) {
      BlessERP.layout.toast(errors[0]);
    } else if (changed) {
      BlessERP.layout.toast(`${changed} pedido(s) actualizados.`);
    }
    if (button?.isConnected) button.textContent = originalText;
    refreshCoordinationResults(container, appState);
  }

  function bindCoordinationResultEvents(container, appState) {
    container.querySelectorAll("[data-order-coordination-row] [data-order-coordination-field]").forEach(input => {
      input.addEventListener("input", () => markCoordinationRowDirty(container, appState, input.closest("[data-order-coordination-row]")));
    });
    container.querySelectorAll("[data-order-coordination-save]").forEach(button => button.addEventListener("click", async () => {
      const orderId = button.dataset.orderCoordinationSave;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "Guardando…";
      const result = await saveCoordinationDraft(appState, orderId);
      if (!result?.ok) {
        BlessERP.layout.toast(result?.message || "No se pudo actualizar la coordinación.");
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = originalText;
        }
        return;
      }
      if (result.changed) {
        await BlessERP.state.waitForLastSave?.({ processRemote: false });
        BlessERP.layout.toast(result.message || "Coordinación actualizada.");
      }
      refreshCoordinationResults(container, appState);
    }));
    container.querySelectorAll(`[data-jaeder-page-key="${COORDINATION_PAGE_KEY}"]`).forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      BlessERP.performance?.setPage?.(COORDINATION_PAGE_KEY, button.dataset.jaederPage);
      refreshCoordinationResults(container, appState);
    }));
    container.querySelector("[data-order-coordination-retry-server]")?.addEventListener("click", event => {
      event.currentTarget.disabled = true;
      coordinationRemote.status = "loading";
      coordinationRemote.error = "";
      refreshCoordinationResults(container, appState);
      void ensureRemoteCoordination(appState, { force: true });
    });
  }

  function bindCoordination(container, appState) {
    if (!container.querySelector("[data-order-coordination-panel]")) return;
    const date = container.querySelector("[data-order-coordination-date]");
    date?.addEventListener("change", event => {
      view.coordinationDate = event.target.value || BlessERP.utils?.today?.() || new Date().toISOString().slice(0, 10);
      invalidateRouteSheetRows();
      BlessERP.performance?.resetPage?.(COORDINATION_PAGE_KEY);
      invalidateRemoteCoordination();
      refreshCoordinationResults(container, appState);
      void ensureRemoteCoordination(appState);
    });
    container.querySelector("[data-order-coordination-guide-status]")?.addEventListener("change", event => {
      view.coordinationGuideStatus = event.target.value || "PENDIENTES";
      BlessERP.performance?.resetPage?.(COORDINATION_PAGE_KEY);
      refreshCoordinationResults(container, appState);
    });
    container.querySelector("[data-order-coordination-search]")?.addEventListener("input", event => {
      window.clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = window.setTimeout(() => {
        view.coordinationSearch = value;
        BlessERP.performance?.resetPage?.(COORDINATION_PAGE_KEY);
        invalidateRemoteCoordination();
        refreshCoordinationResults(container, appState);
        void ensureRemoteCoordination(appState);
      }, 220);
    });
    container.querySelector("[data-order-coordination-save-all]")?.addEventListener("click", event => {
      void saveAllCoordinationDrafts(container, appState, event.currentTarget);
    });
    bindCoordinationResultEvents(container, appState);
    void ensureRemoteCoordination(appState);
  }

  function refreshTracking(container, appState) {
    const current = container?.querySelector("[data-order-tracking-panel]");
    if (!current) return;
    const render = () => {
      current.outerHTML = renderTracking(appState);
      bindTracking(container, appState);
    };
    if (BlessERP.performance?.measureSync) {
      BlessERP.performance.measureSync("seguimiento-pedidos:actualizar", render, {
        date: view.trackingDate || "TODAS",
        status: view.status
      });
    } else {
      render();
    }
  }

  function bindTracking(container, appState) {
    if (!container.querySelector("[data-order-tracking-panel]")) return;
    container.querySelector("[data-order-status-date]")?.addEventListener("change", event => {
      view.trackingDate = event.target.value || "";
      BlessERP.performance?.resetPage?.(TRACKING_PAGE_KEY);
      refreshTracking(container, appState);
    });
    container.querySelector("[data-order-status-today]")?.addEventListener("click", event => {
      event.preventDefault();
      view.trackingDate = todayValue();
      BlessERP.performance?.resetPage?.(TRACKING_PAGE_KEY);
      refreshTracking(container, appState);
    });
    container.querySelector("[data-order-status-all-dates]")?.addEventListener("click", event => {
      event.preventDefault();
      view.trackingDate = "";
      BlessERP.performance?.resetPage?.(TRACKING_PAGE_KEY);
      refreshTracking(container, appState);
    });
    container.querySelector("[data-order-status-filter]")?.addEventListener("change", event => {
      view.status = event.target.value || "TODOS";
      BlessERP.performance?.resetPage?.(TRACKING_PAGE_KEY);
      refreshTracking(container, appState);
    });
    container.querySelector("[data-order-status-search]")?.addEventListener("input", event => {
      window.clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = window.setTimeout(() => {
        view.search = value;
        BlessERP.performance?.resetPage?.(TRACKING_PAGE_KEY);
        refreshTracking(container, appState);
      }, 180);
    });
    container.querySelectorAll(`[data-jaeder-page-key="${TRACKING_PAGE_KEY}"]`).forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      BlessERP.performance?.setPage?.(TRACKING_PAGE_KEY, button.dataset.jaederPage);
      refreshTracking(container, appState);
    }));
    container.querySelectorAll("[data-order-status-open]").forEach(button => button.addEventListener("click", () => {
      open(button.dataset.orderStatusOpen);
      rerender();
    }));
  }

  function bind(container, appState) {
    bindTracking(container, appState);
    bindCoordination(container, appState);
    container.querySelector("[data-coordination-route-sheet-open]")?.addEventListener("click", () => {
      openRouteSheetModal(container, appState);
    });
    bindRouteSheetModal(container, appState);
    const close = () => {
      view.selectedOrderId = "";
      rerender();
    };
    container.querySelectorAll("[data-order-status-close]").forEach(button => button.addEventListener("click", close));
    container.querySelector("[data-order-status-backdrop]")?.addEventListener("click", event => {
      if (event.target.matches("[data-order-status-backdrop]")) close();
    });
  }

  BlessERP.comercialOrderDetail = { bind, open, render };
})();
