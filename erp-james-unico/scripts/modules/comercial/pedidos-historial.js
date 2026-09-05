(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;
  const data = BlessERP.comercialData;

  const printActions = [
    { code: "COMMERCIAL_INVOICE_CLIENT", label: "Imprimir factura cliente" },
    { code: "INVOICE_PACKING_REFERENCIAL", label: "Imprimir invoice comercial" },
    { code: "ETIQUETAS", label: "Imprimir etiquetas" }
  ];
  const historyPrintGroups = Object.freeze({
    COMMERCIAL_INVOICE_CLIENT: ["commercial-history-print-core", "commercial-history-print-client"],
    INVOICE_PACKING_REFERENCIAL: ["commercial-history-print-core", "commercial-history-print-invoice"],
    ETIQUETAS: ["commercial-history-print-core", "commercial-history-print-labels"]
  });
  const HISTORY_PAGE_SIZE = 25;
  const historyUi = {
    visibleOrderIds: [],
    selectedOrderIds: new Set(),
    actionPending: false,
    filterPending: false,
    rangeInitialized: false,
    remotePage: {
      requestKey: "",
      key: "commercial-orders-history",
      status: "idle",
      items: [],
      total: 0,
      page: 1,
      pageSize: HISTORY_PAGE_SIZE,
      totalPages: 1,
      start: 0,
      end: 0,
      error: ""
    },
    remoteController: null,
    remotePromise: null
  };

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function displayStatus(value) {
    return String(value || "").replace(/_/g, " ");
  }

  function activeCompanyId() {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || BlessERP.companyCapabilities?.COMPANY_IDS?.BLESS
      || "COMP-BLESS-FLOWER";
  }

  function historyRepository() {
    return BlessERP.getCommercialOrderRepository?.() || null;
  }

  function canUseServerPagination() {
    return historyRepository()?.canListPage?.() === true;
  }

  function matchingCatalogIds(items, search, fields) {
    if (!search) return [];
    return (Array.isArray(items) ? items : [])
      .filter(item => fields.some(field => normalizeText(item?.[field]).includes(search)))
      .map(item => String(item.id || ""))
      .filter(Boolean)
      .slice(0, 100);
  }

  function serverQueryDescriptor(appState) {
    const ui = stateApi.getUi(appState);
    const search = normalizeText(ui.historySearch);
    const airlineCatalog = stateApi.getAirlineCatalog?.(appState) || data.airlines || [];
    const filters = {
      search: String(ui.historySearch || "").trim(),
      dateFrom: String(ui.historyDateFrom || ""),
      dateTo: String(ui.historyDateTo || ""),
      customerId: String(ui.historyCustomerId || ""),
      brandId: String(ui.historyBrandId || ""),
      destination: String(ui.historyDestination || ""),
      customerMatches: matchingCatalogIds(data.customers, search, ["commercialName", "legalName", "externalId", "taxId"]),
      brandMatches: matchingCatalogIds(data.brands, search, ["name", "country", "destination"]),
      airlineMatches: matchingCatalogIds(airlineCatalog, search, ["name", "code", "prefix"])
    };
    const page = BlessERP.performance?.getPage?.("commercial-orders-history") || 1;
    return {
      page,
      pageSize: HISTORY_PAGE_SIZE,
      filters,
      key: JSON.stringify({ companyId: activeCompanyId(), page, pageSize: HISTORY_PAGE_SIZE, filters })
    };
  }

  function invalidateRemotePage() {
    historyUi.remoteController?.abort?.();
    historyUi.remoteController = null;
    historyUi.remotePromise = null;
    historyUi.remotePage = {
      requestKey: "",
      key: "commercial-orders-history",
      status: "idle",
      items: [],
      total: 0,
      page: 1,
      pageSize: HISTORY_PAGE_SIZE,
      totalPages: 1,
      start: 0,
      end: 0,
      error: ""
    };
  }

  function prepareRemotePage(appState) {
    if (!canUseServerPagination()) return null;
    const descriptor = serverQueryDescriptor(appState);
    if (historyUi.remotePage.requestKey !== descriptor.key) {
      historyUi.remoteController?.abort?.();
      historyUi.remoteController = null;
      historyUi.remotePromise = null;
      historyUi.remotePage = {
        requestKey: descriptor.key,
        key: "commercial-orders-history",
        status: "loading",
        items: [],
        total: 0,
        page: descriptor.page,
        pageSize: descriptor.pageSize,
        totalPages: 1,
        start: 0,
        end: 0,
        error: ""
      };
    }
    return descriptor;
  }

  async function ensureRemotePage(appState, options = {}) {
    const descriptor = prepareRemotePage(appState);
    if (!descriptor) return { ok: false, mode: "LOCAL_FALLBACK" };
    if (historyUi.remotePage.status === "ready" && historyUi.remotePage.requestKey === descriptor.key && !options.force) {
      return { ok: true, cached: true };
    }
    if (historyUi.remotePage.status === "error" && historyUi.remotePage.requestKey === descriptor.key && !options.force) {
      return { ok: false, cachedError: true };
    }
    if (historyUi.remotePromise && historyUi.remotePage.requestKey === descriptor.key && !options.force) {
      return historyUi.remotePromise;
    }

    historyUi.remoteController?.abort?.();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    historyUi.remoteController = controller;
    historyUi.remotePage.status = "loading";
    historyUi.remotePage.error = "";
    const requestKey = descriptor.key;
    const repository = historyRepository();
    historyUi.remotePromise = (async () => {
      const result = await (BlessERP.performance?.measureAsync
        ? BlessERP.performance.measureAsync(
            "historial:supabase:pagina",
            () => repository.listPage({ ...descriptor, signal: controller?.signal }),
            { page: descriptor.page, pageSize: descriptor.pageSize }
          )
        : repository.listPage({ ...descriptor, signal: controller?.signal }));
      if (historyUi.remotePage.requestKey !== requestKey || controller?.signal?.aborted) return { ok: false, aborted: true };
      if (!result?.ok) {
        historyUi.remotePage.status = "error";
        historyUi.remotePage.error = result?.message || "No se pudo consultar Supabase.";
      } else {
        BlessERP.performance?.setPage?.("commercial-orders-history", result.page);
        historyUi.remotePage = {
          ...result,
          requestKey,
          key: "commercial-orders-history",
          status: "ready",
          items: result.items.map(order => utils.normalizeOrder(order)),
          error: ""
        };
      }
      if (BlessERP.state?.currentRoute?.()?.id === "commercial-order-history") {
        BlessERP.layout?.renderPage?.();
      }
      return result;
    })().catch(error => {
      if (historyUi.remotePage.requestKey === requestKey && !controller?.signal?.aborted) {
        historyUi.remotePage.status = "error";
        historyUi.remotePage.error = error?.message || "No se pudo consultar Supabase.";
        if (BlessERP.state?.currentRoute?.()?.id === "commercial-order-history") BlessERP.layout?.renderPage?.();
      }
      return { ok: false, error };
    }).finally(() => {
      if (historyUi.remotePage.requestKey === requestKey) {
        historyUi.remotePromise = null;
        historyUi.remoteController = null;
      }
    });
    return historyUi.remotePromise;
  }

  function currentWeekRange() {
    const raw = BlessERP.utils.today();
    const current = new Date(`${raw}T12:00:00`);
    const day = current.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(current);
    monday.setDate(current.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const iso = date => date.toISOString().slice(0, 10);
    return { dateFrom: iso(monday), dateTo: iso(sunday) };
  }

  function isoLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function quickDateRanges() {
    const todayValue = BlessERP.utils.today();
    const today = new Date(`${todayValue}T12:00:00`);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const week = currentWeekRange();
    const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    const monthTo = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12);
    return {
      today: { dateFrom: todayValue, dateTo: todayValue, label: "Hoy" },
      yesterday: { dateFrom: isoLocal(yesterday), dateTo: isoLocal(yesterday), label: "Ayer" },
      week: { ...week, label: "Semana" },
      month: { dateFrom: isoLocal(monthFrom), dateTo: isoLocal(monthTo), label: "Mes" },
      all: { dateFrom: "", dateTo: "", label: "Todo el historial" }
    };
  }

  function ensureDefaultDateRange(appState) {
    if (historyUi.rangeInitialized) return;
    historyUi.rangeInitialized = true;
    const ui = stateApi.getUi(appState);
    if (ui.historyDateFrom || ui.historyDateTo) return;
    const today = quickDateRanges().today;
    stateApi.setHistoryFilters(appState, {
      historyDateFrom: today.dateFrom,
      historyDateTo: today.dateTo
    }, { persist: false });
  }

  function activeQuickRange(ui, ranges) {
    return Object.entries(ranges).find(([, range]) =>
      String(ui.historyDateFrom || "") === range.dateFrom
      && String(ui.historyDateTo || "") === range.dateTo
    )?.[0] || "custom";
  }

  function matchesRange(order, ui) {
    const issuedAt = String(order.issuedAt || "");
    if (ui.historyDateFrom && (!issuedAt || issuedAt < ui.historyDateFrom)) return false;
    if (ui.historyDateTo && (!issuedAt || issuedAt > ui.historyDateTo)) return false;
    return true;
  }

  function buildFilterContext(appState) {
    const ui = stateApi.getUi(appState);
    const airlineCatalog = stateApi.getAirlineCatalog?.(appState) || data.airlines || [];
    return {
      appState,
      ui,
      search: normalizeText(ui.historySearch),
      destination: normalizeText(ui.historyDestination),
      customers: new Map(data.customers.map(item => [item.id, item])),
      brands: new Map(data.brands.map(item => [item.id, item])),
      airlines: new Map(airlineCatalog.map(item => [item.id, item]))
    };
  }

  function matchesFilters(order, context) {
    const { ui, search } = context;

    if (!matchesRange(order, ui)) return false;
    if (ui.historyCustomerId && order.customerId !== ui.historyCustomerId) return false;
    if (ui.historyBrandId && order.brandId !== ui.historyBrandId) return false;
    if (ui.historyDestination && normalizeText(order.destination) !== context.destination) return false;
    if (!search) return true;

    const customer = context.customers.get(order.customerId);
    const brand = context.brands.get(order.brandId);
    const airline = context.airlines.get(order.airlineId);
    const directMatch = [
      order.number,
      order.sriSequential,
      order.sriInvoiceNumber,
      order.issuedAt,
      order.flightDate,
      customer?.commercialName,
      customer?.legalName,
      brand?.name,
      order.destination,
      order.daeNumber,
      order.awb,
      order.hawb,
      airline?.name
    ].some(value => normalizeText(value).includes(search));
    if (directMatch) return true;

    // Solo si los datos principales no coinciden se inspecciona el detalle.
    // No se calculan totales ni se ordenan líneas durante una búsqueda textual.
    return (Array.isArray(order.lines) ? order.lines : []).some(line => [
      line?.po,
      line?.boxType,
      line?.variety,
      line?.length
    ].some(value => normalizeText(value).includes(search)));
  }

  function filteredOrders(appState) {
    const context = buildFilterContext(appState);
    return stateApi.getOrders(appState)
      .filter(order => !order.historyArchivedAt)
      .filter(order => !order.unsavedDraft)
      .filter(order => matchesFilters(order, context))
      .sort((left, right) =>
        String(right.issuedAt || "").localeCompare(String(left.issuedAt || ""))
        || String(right.number || "").localeCompare(String(left.number || ""))
      );
  }

  function selectedIds(appState) {
    const validIds = new Set([
      ...stateApi.getOrders(appState).map(order => order.id),
      ...(historyUi.remotePage.items || []).map(order => order.id)
    ].filter(Boolean));
    historyUi.selectedOrderIds.forEach(orderId => {
      if (!validIds.has(orderId)) historyUi.selectedOrderIds.delete(orderId);
    });
    return new Set(historyUi.selectedOrderIds);
  }

  function selectedOrders(appState) {
    const ids = selectedIds(appState);
    const byId = new Map([
      ...(historyUi.remotePage.items || []),
      ...stateApi.getOrders(appState)
    ].filter(order => order?.id).map(order => [order.id, order]));
    return [...ids].map(id => byId.get(id)).filter(Boolean);
  }

  async function selectedOrdersWithDetails(appState) {
    const orders = selectedOrders(appState);
    const repository = historyRepository();
    if (!repository?.getFullOrder || !canUseServerPagination()) return orders;
    const hydrated = [];
    for (const order of orders) {
      if (!order?.__historyServerPage) {
        hydrated.push(order);
        continue;
      }
      const result = await repository.getFullOrder(order.id);
      if (!result?.ok || !result.order) {
        throw new Error(result?.message || `No se pudo recuperar el detalle del pedido ${order.number || order.id}.`);
      }
      hydrated.push(utils.normalizeOrder(result.order));
    }
    return hydrated;
  }

  function historyOrderMetrics(order) {
    const summary = order?._historyMetrics;
    if (!summary || typeof summary !== "object") return utils.getOrderMetrics(order);
    return {
      totalBoxes: Math.max(0, Number(summary.totalBoxes || 0)),
      totalFulls: Math.max(0, Number(summary.totalFulls || 0)),
      totalBunches: Math.max(0, Number(summary.totalBunches || 0)),
      totalStems: Math.max(0, Number(summary.totalStems || 0)),
      totalUsd: Math.max(0, Number(summary.totalUsd || 0))
    };
  }

  function orderEditUrl(orderId) {
    const url = new URL(window.location.href);
    const companyId = activeCompanyId();
    url.search = "";
    url.hash = "";
    url.searchParams.set("company", companyId);
    url.searchParams.set("route", "commercial-order-master");
    url.searchParams.set("order", orderId);
    return url.href;
  }

  function renderPrintToolbar(selectedCount) {
    return `
      <section class="commercial-history-printbar erp-action-toolbar">
        <div class="commercial-history-selection">
          <strong><span class="erp-selection-mark" aria-hidden="true">✓</span>${utils.esc(selectedCount)} seleccionado(s)</strong>
          <button class="secondary-button" type="button" data-commercial-history-select-visible>Seleccionar visibles</button>
          <button class="secondary-button" type="button" data-commercial-history-clear-selection ${selectedCount ? "" : "disabled"}>Deseleccionar</button>
        </div>
        <div class="commercial-history-print-actions">
          ${printActions.map(action => `
            <button class="primary-button" type="button" data-commercial-history-print="${utils.esc(action.code)}" ${selectedCount ? "" : "disabled"}>${utils.esc(action.label)}</button>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderFilters(appState, visibleCount) {
    const ui = stateApi.getUi(appState);
    const destinations = [...new Set(data.brands.map(item => item.destination).filter(Boolean))].sort();
    const ranges = quickDateRanges();
    const activeRange = activeQuickRange(ui, ranges);
    const activeLabel = activeRange === "custom"
      ? "Rango personalizado"
      : ranges[activeRange].label;
    return `
      <form class="panel-card commercial-history-filters erp-page-card erp-filter-bar" data-commercial-history-filters>
        <div class="commercial-history-filter-main">
          <label class="compact-field commercial-history-search">
            <span>Buscar</span>
            <input name="search" type="search" value="${utils.esc(ui.historySearch)}" placeholder="Pedido, factura, cliente, DAE o AWB">
          </label>
          <label class="compact-field">
            <span>Fecha desde</span>
            <input name="dateFrom" type="date" value="${utils.esc(ui.historyDateFrom)}">
          </label>
          <label class="compact-field">
            <span>Fecha hasta</span>
            <input name="dateTo" type="date" value="${utils.esc(ui.historyDateTo)}">
          </label>
          <div class="commercial-history-filter-actions">
            <button class="primary-button" type="submit">Buscar</button>
            <button class="secondary-button" type="button" data-commercial-history-clear-filters>Limpiar</button>
          </div>
        </div>
        <div class="commercial-history-quick-ranges erp-segmented-control" aria-label="Rangos rápidos del historial">
          <span>Vista rápida</span>
          ${Object.entries(ranges).map(([code, range]) => `
            <button class="commercial-history-range-button ${code === activeRange ? "active" : ""}" type="button" data-commercial-history-range="${utils.esc(code)}" aria-pressed="${code === activeRange ? "true" : "false"}">${utils.esc(range.label)}</button>
          `).join("")}
          <strong>Mostrando: ${utils.esc(activeLabel)}</strong>
        </div>
        <details class="commercial-history-advanced-filters">
          <summary>Más filtros <span>${utils.esc(visibleCount)} resultado(s)</span></summary>
          <div class="commercial-history-filter-grid">
            <label class="compact-field">
              <span>Cliente</span>
              <select name="customerId">
                <option value="">Todos</option>
                ${data.customers.map(item => `<option value="${utils.esc(item.id)}" ${item.id === ui.historyCustomerId ? "selected" : ""}>${utils.esc(item.commercialName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Marca</span>
              <select name="brandId">
                <option value="">Todas</option>
                ${data.brands.map(item => `<option value="${utils.esc(item.id)}" ${item.id === ui.historyBrandId ? "selected" : ""}>${utils.esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Destino</span>
              <select name="destination">
                <option value="">Todos</option>
                ${destinations.map(item => `<option value="${utils.esc(item)}" ${item === ui.historyDestination ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
              </select>
            </label>
          </div>
        </details>
      </form>
    `;
  }

  function renderTable(appState, page) {
    const rows = page.items;
    const selected = selectedIds(appState);
    const visibleSelected = rows.filter(order => selected.has(order.id)).length;
    const allVisibleSelected = Boolean(rows.length && visibleSelected === rows.length);
    const numberCounts = rows.reduce((counts, order) => {
      const number = String(order.number || "").trim();
      if (number) counts.set(number, Number(counts.get(number) || 0) + 1);
      return counts;
    }, new Map());

    return `
      <section class="panel-card commercial-history-table-panel erp-page-card erp-data-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">PEDIDOS / HISTORIAL</p><h3>Pedidos confirmados</h3></div>
          <span class="status-badge ${visibleSelected ? "authorized" : "partial"}" data-commercial-history-selection-summary data-total="${utils.esc(page.total)}">${utils.esc(visibleSelected)} seleccionados · ${utils.esc(page.total)} resultado(s)</span>
        </div>
        <div class="compact-table-wrap commercial-history-table-wrap erp-table-scroll">
          <table class="compact-table commercial-table commercial-history-table erp-data-table">
            <thead><tr>
              <th class="commercial-history-check"><input type="checkbox" data-commercial-history-select-all aria-label="Seleccionar pedidos visibles" ${allVisibleSelected ? "checked" : ""}></th>
              <th>Fecha</th><th>Pedido</th><th>Factura</th><th>Cliente</th><th>Cliente final</th><th>Logística</th><th>Cajas</th><th>Total</th><th>Estado</th><th>Acciones</th>
            </tr></thead>
            <tbody>${rows.map(order => {
              const customer = utils.findCustomer(order.customerId);
              const brand = utils.findBrand(order.brandId);
              const airline = utils.findAirline(order.airlineId, appState);
              const metrics = historyOrderMetrics(order);
              const invoiceNumber = order.sriSequential || BlessERP.comercialInvoiceSequence.resolveSequence(order) || "Pendiente";
              const orderStatus = workflow.normalizeStatus(order.status);
              const sriStatus = String(order.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
              const sriProcessStarted = Boolean(order.sriRemoteDocumentId) || !["PENDIENTE", "ANULADO"].includes(sriStatus);
              const canAnnul = workflow.isTransitionAllowed(orderStatus, "ANULADO") && (!sriProcessStarted || sriStatus === "ANULADO");
              const requiresSriReview = workflow.isTransitionAllowed(orderStatus, "ANULADO") && sriProcessStarted && sriStatus !== "ANULADO";
              const canArchive = orderStatus === "ANULADO" && !order.historyArchivedAt;
              const repeatedNumber = Number(numberCounts.get(String(order.number || "").trim()) || 0) > 1;
              const incomplete = !order.issuedAt || !order.customerId;
              return `<tr class="${selected.has(order.id) ? "is-selected" : ""}">
                <td class="commercial-history-check" data-label="Elegir"><input type="checkbox" data-commercial-history-order-select="${utils.esc(order.id)}" ${selected.has(order.id) ? "checked" : ""} aria-label="Seleccionar pedido ${utils.esc(order.number)}"></td>
                <td class="commercial-history-date-cell" data-label="Fecha"><strong>${utils.esc(utils.dateLabel(order.issuedAt))}</strong><small>Salida: ${utils.esc(utils.dateLabel(order.flightDate))}</small></td>
                <td class="commercial-history-order-cell" data-label="Pedido">
                  <a class="commercial-order-link" href="${utils.esc(orderEditUrl(order.id))}" target="_blank" rel="noopener noreferrer">${utils.esc(order.number || "Sin número")}</a>
                  <div class="commercial-history-quality">${repeatedNumber ? `<span>Número repetido</span>` : ""}${incomplete ? `<span>Datos incompletos</span>` : ""}</div>
                </td>
                <td class="commercial-history-invoice-cell" data-label="Factura"><strong class="commercial-history-invoice">${utils.esc(invoiceNumber)}</strong><small>${utils.esc(displayStatus(sriStatus))}</small></td>
                <td class="commercial-history-text commercial-history-customer-cell" data-label="Cliente"><strong title="${utils.esc(customer?.commercialName || "Sin cliente")}">${utils.esc(customer?.commercialName || "Sin cliente")}</strong></td>
                <td class="commercial-history-text commercial-history-customer-cell" data-label="Cliente final"><strong title="${utils.esc(brand?.name || "Sin marca")}">${utils.esc(brand?.name || "Sin marca")}</strong></td>
                <td class="commercial-history-logistics" data-label="Logística"><strong>${utils.esc(order.destination || "Sin destino")}</strong><small>${utils.esc(order.daeNumber ? `DAE ${order.daeNumber}` : "Sin DAE")} · ${utils.esc(order.awb ? `AWB ${order.awb}` : "Sin AWB")}</small><small>${utils.esc(airline?.name || "Sin línea aérea")}</small></td>
                <td class="erp-numeric-cell commercial-history-boxes-cell" data-label="Cajas"><strong>${utils.esc(metrics.totalBoxes)}</strong><small>${utils.esc(metrics.totalFulls.toFixed(2).replace(/\\.00$/, ""))} fulls</small></td>
                <td class="erp-numeric-cell commercial-history-total-cell" data-label="Total"><strong>${utils.esc(utils.money(metrics.totalUsd))}</strong></td>
                <td class="commercial-history-status-cell" data-label="Estado"><span class="status-badge erp-status-badge ${utils.badgeClass(orderStatus)}">${utils.esc(displayStatus(orderStatus))}</span></td>
                <td class="commercial-history-actions-cell" data-label="Acciones">
                  <button class="row-action-button" type="button" data-commercial-history-tracking="${utils.esc(order.id)}">Ver seguimiento</button>
                  <a class="row-action-button commercial-history-edit-link" href="${utils.esc(orderEditUrl(order.id))}" target="_blank" rel="noopener noreferrer">Editar</a>
                  ${(canAnnul || requiresSriReview || canArchive) ? `<details class="commercial-history-row-menu"><summary>Más</summary><div>${canAnnul ? `<button class="row-action-button danger" type="button" data-commercial-history-annul="${utils.esc(order.id)}">Anular</button>` : ""}${requiresSriReview ? `<button class="row-action-button" type="button" data-commercial-history-sri-review="${utils.esc(order.id)}">Revisar SRI</button>` : ""}${canArchive ? `<button class="row-action-button danger" type="button" data-commercial-history-archive="${utils.esc(order.id)}">Eliminar del historial</button>` : ""}</div></details>` : ""}
                </td>
              </tr>`;
            }).join("") || `<tr><td colspan="11"><div class="empty-inline">No hay pedidos para los filtros seleccionados.</div></td></tr>`}</tbody>
          </table>
        </div>
        <div class="erp-pagination">${BlessERP.performance?.renderPager?.(page) || ""}</div>
      </section>
    `;
  }

  function renderIntercompanyPanel(appState) {
    const service = BlessERP.comercialIntercompany;
    const companyIds = BlessERP.companyCapabilities?.COMPANY_IDS || {};
    if (!service?.billingEnabled || activeCompanyId() !== (companyIds.BLESS || service.BLESS_COMPANY_ID)) return "";
    const week = currentWeekRange();
    const settlements = service.getSettlements(appState);
    return `
      <section class="panel-card commercial-intercompany-panel">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BLESS → IMPERIO</p>
            <h3>Liquidación semanal intercompany</h3>
          </div>
              <span class="status-badge partial">Borrador SRI sin envío automático</span>
        </div>
        <p class="panel-note">Incluye únicamente pedidos vendidos por Imperio, preparados por Bless, despachados y aún no liquidados. Imperio registra costo directo; no genera inventario.</p>
        <form class="commercial-history-filter-grid" data-commercial-intercompany-create>
          <label class="compact-field"><span>Desde</span><input name="dateFrom" type="date" required value="${utils.esc(week.dateFrom)}"></label>
          <label class="compact-field"><span>Hasta</span><input name="dateTo" type="date" required value="${utils.esc(week.dateTo)}"></label>
          <label class="compact-field commercial-history-search"><span>Observación</span><input name="observation" value="Liquidación semanal de pedidos Imperio despachados"></label>
          <div class="commercial-history-filter-actions"><button class="primary-button" type="submit">Preparar liquidación</button></div>
        </form>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table">
            <thead><tr><th>Liquidación</th><th>Periodo</th><th>Pedidos</th><th>Cajas</th><th>Bonches</th><th>Tallos</th><th>Factura Bless</th><th>Margen bruto Imperio</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>${settlements.map(item => `
              <tr>
                <td><strong>${utils.esc(item.number)}</strong></td>
                <td>${utils.esc(utils.dateLabel(item.dateFrom))} – ${utils.esc(utils.dateLabel(item.dateTo))}</td>
                <td>${utils.number(item.totals?.orders || 0)}</td>
                <td>${utils.number(item.totals?.boxes || 0)}</td>
                <td>${utils.number(item.totals?.bunches || 0)}</td>
                <td>${utils.number(item.totals?.stems || 0)}</td>
                <td><strong>${utils.money(item.totals?.transferTotal || 0)}</strong><small>${utils.esc(item.invoiceNumber || "Pendiente")}</small></td>
                <td>${utils.money(item.totals?.imperioGrossMargin || 0)}</td>
                <td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td>
                <td><div class="table-actions-inline">
                    ${item.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-commercial-intercompany-confirm="${utils.esc(item.id)}">Confirmar corte y preparar SRI</button>` : ""}
                  ${item.status !== "ANULADA" ? `<button class="row-action-button danger" type="button" data-commercial-intercompany-annul="${utils.esc(item.id)}">Anular</button>` : ""}
                </div></td>
              </tr>
              ${item.status === "BORRADOR" ? `<tr><td colspan="10">
                <details>
                  <summary>Revisar ${utils.number(item.lines?.length || 0)} línea(s) y precios de transferencia</summary>
                  <div class="compact-table-wrap">
                    <table class="compact-table">
                      <thead><tr><th>Pedido</th><th>Caja</th><th>Variedad</th><th>Medida</th><th>Tallos</th><th>Precio venta</th><th>Precio Bless → Imperio</th><th>Origen</th></tr></thead>
                      <tbody>${(item.lines || []).map(line => `<tr><td>${utils.esc(line.orderNumber)}</td><td>${utils.number(line.boxNumber)}</td><td>${utils.esc(line.variety)}</td><td>${utils.number(line.length)} cm</td><td>${utils.number(line.stems)}</td><td>${utils.money(line.sellingUnitPrice)}</td><td><strong>${utils.money(line.transferUnitPrice)}</strong></td><td>${utils.esc(line.transferPriceSource)}</td></tr>`).join("")}</tbody>
                    </table>
                  </div>
                  <form class="commercial-history-filter-grid" data-commercial-intercompany-price="${utils.esc(item.id)}">
                    <label class="compact-field commercial-history-search"><span>Línea a ajustar</span><select name="lineId" data-commercial-intercompany-price-line>${(item.lines || []).map(line => `<option value="${utils.esc(line.id)}" data-price="${utils.esc(line.transferUnitPrice)}">${utils.esc(`${line.orderNumber} · caja ${line.boxNumber} · ${line.variety} ${line.length} cm`)}</option>`).join("")}</select></label>
                    <label class="compact-field"><span>Nuevo precio por tallo</span><input name="price" type="number" min="0" step="0.0001" required value="${utils.esc(item.lines?.[0]?.transferUnitPrice || 0)}"></label>
                    <label class="compact-field commercial-history-search"><span>Motivo obligatorio</span><input name="reason" required placeholder="Acuerdo semanal, mercado o ajuste de costo"></label>
                    <div class="commercial-history-filter-actions"><button class="secondary-button" type="submit">Actualizar precio</button></div>
                  </form>
                </details>
              </td></tr>` : ""}
            `).join("") || `<tr><td colspan="10">No existen liquidaciones semanales preparadas.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function localHistoryPage(appState) {
    const sources = filteredOrders(appState);
    const rawPage = BlessERP.performance?.paginate?.(sources, "commercial-orders-history", { pageSize: HISTORY_PAGE_SIZE })
      || { key: "commercial-orders-history", items: sources, total: sources.length, page: 1, pageSize: sources.length || 1, totalPages: 1, start: sources.length ? 1 : 0, end: sources.length };
    return {
      sources,
      page: { ...rawPage, items: rawPage.items.map(order => utils.normalizeOrder(order)) }
    };
  }

  function renderRemotePageStatus() {
    if (!canUseServerPagination()) return "";
    if (historyUi.remotePage.status === "loading") {
      return `<div class="commercial-history-source-status loading"><span></span>Consultando esta página en Supabase…</div>`;
    }
    if (historyUi.remotePage.status === "error") {
      return `<div class="commercial-history-source-status error"><span></span><strong>No se pudo confirmar esta página en Supabase.</strong><small>${utils.esc(historyUi.remotePage.error)}</small><button type="button" class="secondary-button compact-button" data-commercial-history-retry-server>Reintentar</button></div>`;
    }
    return `<div class="commercial-history-source-status ready"><span></span>25 pedidos por página · Supabase confirmado</div>`;
  }

  function render(appState) {
    ensureDefaultDateRange(appState);
    const descriptor = prepareRemotePage(appState);
    let page;
    if (descriptor && historyUi.remotePage.status === "ready" && historyUi.remotePage.requestKey === descriptor.key) {
      page = historyUi.remotePage;
    } else {
      page = localHistoryPage(appState).page;
    }
    historyUi.visibleOrderIds = page.items.map(order => order.id);
    const selectedCount = selectedOrders(appState).length;
    return `
      <section class="page-header commercial-history-header erp-page-card erp-page-hero">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Pedidos / Historial</h1>
          <p class="erp-page-lead"><strong>Pedidos confirmados</strong><span>Bandeja central de pedidos, documentos comerciales e impresión.</span></p>
        </div>
        <div class="page-header-side">
          <button class="primary-button" type="button" data-commercial-history-new-order><span aria-hidden="true">＋</span> Nuevo pedido</button>
        </div>
      </section>
      ${renderPrintToolbar(selectedCount)}
      ${renderFilters(appState, page.total)}
      ${renderRemotePageStatus()}
      ${renderTable(appState, page)}
      ${renderIntercompanyPanel(appState)}
    `;
  }

  function applyFilters(form, appState) {
    const values = Object.fromEntries(new FormData(form).entries());
    const fields = {
      historySearch: values.search,
      historyDateFrom: values.dateFrom,
      historyDateTo: values.dateTo,
      historyCustomerId: values.customerId,
      historyBrandId: values.brandId,
      historyDestination: values.destination
    };
    stateApi.setHistoryFilters(appState, fields, { persist: false });
    BlessERP.performance?.resetPage?.("commercial-orders-history");
    invalidateRemotePage();
  }

  function clearFilters(appState) {
    const fields = [
      "historySearch",
      "historyDateFrom",
      "historyDateTo",
      "historyCustomerId",
      "historyBrandId",
      "historyDestination",
      "historyDae",
      "historyBoxType",
      "historyPo"
    ];
    stateApi.setHistoryFilters(appState, Object.fromEntries(fields.map(field => [field, ""])), { persist: false });
    BlessERP.performance?.resetPage?.("commercial-orders-history");
    invalidateRemotePage();
  }

  function applyQuickRange(appState, rangeCode) {
    const range = quickDateRanges()[rangeCode];
    if (!range) return false;
    stateApi.setHistoryFilters(appState, {
      historyDateFrom: range.dateFrom,
      historyDateTo: range.dateTo
    }, { persist: false });
    BlessERP.performance?.resetPage?.("commercial-orders-history");
    invalidateRemotePage();
    return true;
  }

  async function runFilterAction(button, action) {
    if (historyUi.filterPending) return false;
    historyUi.filterPending = true;
    const originalText = button?.textContent || "Buscar";
    if (button) {
      button.disabled = true;
      button.textContent = "Filtrando...";
    }
    try {
      await nextPaint();
      action();
      BlessERP.layout.renderPage();
      return true;
    } finally {
      historyUi.filterPending = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function ensureActionGroup(group, button, label = "Preparando...") {
    if (historyUi.actionPending) return false;
    historyUi.actionPending = true;
    const originalText = button?.textContent || "";
    if (button) {
      button.disabled = true;
      button.textContent = label;
    }
    try {
      await BlessERP.moduleLoader.ensureRoute(group);
      return true;
    } catch (error) {
      BlessERP.layout.toast(error?.message || "No se pudo preparar la acción solicitada.");
      return false;
    } finally {
      historyUi.actionPending = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function ensureLazyGroup(group, button, label = "Preparando...") {
    if (historyUi.actionPending) return false;
    historyUi.actionPending = true;
    const originalText = button?.textContent || "";
    if (button) {
      button.disabled = true;
      button.textContent = label;
    }
    try {
      await BlessERP.moduleLoader.loadGroup(group);
      return true;
    } catch (error) {
      BlessERP.layout.toast(error?.message || "No se pudo preparar la acción solicitada.");
      return false;
    } finally {
      historyUi.actionPending = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function loadHistoryPrintGroups(docCode, onProgress = null) {
    const groups = historyPrintGroups[docCode] || ["commercial-history-print"];
    for (let index = 0; index < groups.length; index += 1) {
      onProgress?.(index + 1, groups.length);
      await BlessERP.moduleLoader.loadGroup(groups[index]);
    }
    return groups;
  }

  function prefetchHistoryPrint(docCode, button) {
    if (button?.dataset?.commercialPrintPrefetched === "true") return;
    if (button?.dataset) button.dataset.commercialPrintPrefetched = "true";
    loadHistoryPrintGroups(docCode).catch(error => {
      if (button?.dataset) delete button.dataset.commercialPrintPrefetched;
      console.warn(`[JAEDER PERF] No se pudo precargar ${docCode}.`, error);
    });
  }

  function refreshSelectionUi(container, appState) {
    const selected = selectedIds(appState);
    const visibleFields = [...container.querySelectorAll("[data-commercial-history-order-select]")];
    visibleFields.forEach(field => {
      const checked = selected.has(field.dataset.commercialHistoryOrderSelect);
      field.checked = checked;
      field.closest("tr")?.classList.toggle("is-selected", checked);
    });
    const visibleSelected = visibleFields.filter(field => field.checked).length;
    const selectAll = container.querySelector("[data-commercial-history-select-all]");
    if (selectAll) {
      selectAll.checked = Boolean(visibleFields.length && visibleSelected === visibleFields.length);
      selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleFields.length;
    }
    const count = selected.size;
    const counter = container.querySelector(".commercial-history-selection strong");
    if (counter) counter.textContent = `${count} seleccionado(s)`;
    const summary = container.querySelector("[data-commercial-history-selection-summary]");
    if (summary) {
      summary.textContent = `${visibleSelected} seleccionados · ${summary.dataset.total || 0} resultado(s)`;
      summary.classList.toggle("authorized", visibleSelected > 0);
      summary.classList.toggle("partial", visibleSelected === 0);
    }
    container.querySelectorAll("[data-commercial-history-print]").forEach(button => { button.disabled = !count; });
    const clear = container.querySelector("[data-commercial-history-clear-selection]");
    if (clear) clear.disabled = !count;
  }

  async function openTracking(orderId, button) {
    if (!await ensureActionGroup("commercial-order-detail", button, "Abriendo...")) return false;
    BlessERP.comercialOrderDetail.open(orderId);
    BlessERP.state.setRoute("commercial-order-detail");
    BlessERP.layout.renderApp();
    return true;
  }

  async function printSelected(docCode, appState, button) {
    if (historyUi.actionPending) return false;
    historyUi.actionPending = true;
    const originalText = button?.textContent || "Imprimir";
    if (button) button.disabled = true;
    try {
      await loadHistoryPrintGroups(docCode, (current, total) => {
        if (button?.isConnected) button.textContent = `Preparando ${current}/${total}...`;
      });
      const orders = await selectedOrdersWithDetails(appState);
      if (button?.isConnected) button.textContent = `Generando ${orders.length} pedido(s)...`;
      await nextPaint();
      const options = docCode === "COMMERCIAL_INVOICE_CLIENT"
        ? { ...BlessERP.comercialClientInvoice.getCurrentOptions(appState), mode: "REFERENCIAL" }
        : docCode === "ETIQUETAS"
            ? { pageSize: "CUSTOMS_LABEL", printType: "all" }
            : {};

      return BlessERP.comercialPrintSystem.openDocuments(docCode, orders, appState, {
        autoPrint: true,
        nonBlocking: true,
        onProgress: progress => {
          if (!button?.isConnected || docCode !== "ETIQUETAS") return;
          button.textContent = progress.phase === "pdf"
            ? "Armando PDF..."
            : `Etiquetas ${progress.current}/${progress.total}...`;
        },
        pageSize: docCode === "ETIQUETAS" ? "CUSTOMS_LABEL" : "A4",
        options
      });
    } catch (error) {
      BlessERP.layout.toast(error?.message || "No se pudo preparar la impresión solicitada.");
      return false;
    } finally {
      historyUi.actionPending = false;
      if (button?.isConnected) {
        button.textContent = originalText;
        button.disabled = !selectedIds(appState).size;
      }
    }
  }

  function bind(container, appState) {
    void ensureRemotePage(appState);

    container.querySelector("[data-commercial-history-retry-server]")?.addEventListener("click", event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Reintentando…";
      void ensureRemotePage(appState, { force: true });
    });

    container.querySelectorAll("[data-commercial-history-tracking]").forEach(button => button.addEventListener("click", () => {
      openTracking(button.dataset.commercialHistoryTracking, button);
    }));

    container.querySelector("[data-commercial-history-filters]")?.addEventListener("submit", event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = event.submitter || form.querySelector('button[type="submit"]');
      runFilterAction(button, () => applyFilters(form, appState));
    });

    container.querySelector("[data-commercial-history-clear-filters]")?.addEventListener("click", event => {
      runFilterAction(event.currentTarget, () => clearFilters(appState));
    });

    container.querySelectorAll("[data-commercial-history-range]").forEach(button => button.addEventListener("click", event => {
      const rangeCode = event.currentTarget.dataset.commercialHistoryRange;
      runFilterAction(event.currentTarget, () => applyQuickRange(appState, rangeCode));
    }));

    container.querySelector("[data-commercial-history-new-order]")?.addEventListener("click", () => {
      stateApi.startNewOrderWorkspace(appState);
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    });

    container.querySelectorAll("[data-commercial-history-annul]").forEach(button => button.addEventListener("click", () => {
      const order = stateApi.getOrders(appState).find(item => item.id === button.dataset.commercialHistoryAnnul);
      if (!order) return;
      const sequence = order.sriSequential || BlessERP.comercialInvoiceSequence.resolveSequence(order) || "sin secuencial";
      const confirmed = window.confirm(`Se anulara el pedido ${order.number}.\n\nEl secuencial ${sequence} se conservara en el historial y NO se entregara a otro pedido.\n\n¿Desea continuar?`);
      if (!confirmed) return;
      const reason = window.prompt("Motivo obligatorio de la anulacion:", "Pedido cancelado antes de la emision SRI.") || "";
      if (!String(reason).trim()) {
        BlessERP.layout.toast("Debe ingresar un motivo para anular el pedido.");
        return;
      }
      const result = stateApi.changeOrderStatusById(appState, order.id, "ANULADO", reason);
      if (!result?.ok) BlessERP.layout.toast(result?.message || "No se pudo anular el pedido.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-history-sri-review]").forEach(button => button.addEventListener("click", () => {
      stateApi.openOrder(appState, button.dataset.commercialHistorySriReview);
      BlessERP.state.setRoute("commercial-sri-authorization");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-history-archive]").forEach(button => button.addEventListener("click", () => {
      const order = stateApi.getOrders(appState).find(item => item.id === button.dataset.commercialHistoryArchive);
      if (!order) return;
      const sequence = order.sriSequential || BlessERP.comercialInvoiceSequence.resolveSequence(order) || "sin secuencial";
      const hasSriArtifact = stateApi.hasSriElectronicArtifact?.(order);
      const sriExplanation = hasSriArtifact
        ? "El comprobante conservara su clave/XML y seguira visible como ANULADO en Documentos electronicos SRI."
        : "Como no existe clave, XML ni documento electronico, dejara de aparecer entre los pendientes SRI.";
      const confirmed = window.confirm(
        `Se retirara el pedido anulado ${order.number} del historial operativo.\n\n${sriExplanation}\n\nEl secuencial ${sequence} permanecera anulado y NUNCA se reutilizara.\n\n¿Desea continuar?`
      );
      if (!confirmed) return;
      const result = stateApi.archiveAnnulledOrderFromHistory(appState, order.id);
      if (!result?.ok) BlessERP.layout.toast(result?.message || "No se pudo retirar el pedido del historial.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-history-order-select]").forEach(field => field.addEventListener("change", event => {
      const orderId = event.target.dataset.commercialHistoryOrderSelect;
      if (event.target.checked) historyUi.selectedOrderIds.add(orderId);
      else historyUi.selectedOrderIds.delete(orderId);
      refreshSelectionUi(container, appState);
    }));

    const visibleIds = historyUi.visibleOrderIds;
    container.querySelector("[data-commercial-history-select-all]")?.addEventListener("change", event => {
      const next = selectedIds(appState);
      visibleIds.forEach(orderId => event.target.checked ? next.add(orderId) : next.delete(orderId));
      historyUi.selectedOrderIds = next;
      refreshSelectionUi(container, appState);
    });

    container.querySelector("[data-commercial-history-select-visible]")?.addEventListener("click", () => {
      historyUi.selectedOrderIds = new Set([...selectedIds(appState), ...visibleIds]);
      refreshSelectionUi(container, appState);
    });

    container.querySelector("[data-commercial-history-clear-selection]")?.addEventListener("click", () => {
      historyUi.selectedOrderIds.clear();
      refreshSelectionUi(container, appState);
    });

    container.querySelectorAll("[data-commercial-history-print]").forEach(button => {
      const prefetch = () => prefetchHistoryPrint(button.dataset.commercialHistoryPrint, button);
      button.addEventListener("pointerenter", prefetch, { once: true });
      button.addEventListener("focus", prefetch, { once: true });
      button.addEventListener("click", () => {
        printSelected(button.dataset.commercialHistoryPrint, appState, button);
      });
    });

    container.querySelector("[data-commercial-intercompany-create]")?.addEventListener("submit", event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const result = BlessERP.comercialIntercompany.createWeeklySettlement(appState, values);
      BlessERP.layout.toast(result.ok ? `Liquidación ${result.settlement.number} preparada.` : result.error);
      BlessERP.layout.renderPage();
    });

    container.querySelectorAll("[data-commercial-intercompany-confirm]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("Se confirmará la liquidación y se preparará el borrador de factura Bless → Imperio. No se firmará ni enviará al SRI automáticamente. ¿Continuar?")) return;
      const result = BlessERP.comercialIntercompany.confirmWeeklySettlement(appState, button.dataset.commercialIntercompanyConfirm);
      BlessERP.layout.toast(result.ok
        ? `${result.invoice.number}: ${result.invoice.sriDraftReady ? "borrador SRI listo para revisión" : "complete la configuración tributaria antes de crear el borrador SRI"}.`
        : result.error);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-intercompany-price-line]").forEach(select => select.addEventListener("change", event => {
      const form = event.currentTarget.closest("form");
      const selectedOption = event.currentTarget.selectedOptions?.[0];
      if (form?.elements?.price && selectedOption) form.elements.price.value = selectedOption.dataset.price || "0";
    }));

    container.querySelectorAll("[data-commercial-intercompany-price]").forEach(form => form.addEventListener("submit", event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const result = BlessERP.comercialIntercompany.setSettlementLineTransferPrice(
        appState,
        event.currentTarget.dataset.commercialIntercompanyPrice,
        values.lineId,
        values.price,
        values.reason
      );
      BlessERP.layout.toast(result.ok ? "Precio de transferencia actualizado." : result.error);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-intercompany-annul]").forEach(button => button.addEventListener("click", () => {
      const reason = window.prompt("Motivo obligatorio de la anulación intercompany:", "") || "";
      if (!String(reason).trim()) return;
      const result = BlessERP.comercialIntercompany.annulWeeklySettlement(appState, button.dataset.commercialIntercompanyAnnul, reason);
      BlessERP.layout.toast(result.ok ? "Liquidación intercompany anulada." : result.error);
      BlessERP.layout.renderPage();
    }));
  }

  BlessERP.comercialHistory = {
    bind,
    filteredOrders,
    invalidateRemotePage,
    printSelected,
    render
  };
})();
