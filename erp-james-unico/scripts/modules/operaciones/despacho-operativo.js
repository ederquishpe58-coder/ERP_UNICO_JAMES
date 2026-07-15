(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  const DISPATCH_STATES = [
    "PENDIENTE",
    "EN_PREPARACION",
    "LISTO_DESPACHO",
    "DESPACHADO_DEMO",
    "OBSERVADO",
    "ANULADO_DEMO"
  ];

  function valueOf(item, keys, fallback = "") {
    const key = keys.find(name => item?.[name] !== undefined && item?.[name] !== null && String(item[name]).trim() !== "");
    return key ? item[key] : fallback;
  }

  function numeric(value) {
    return utils.parseNumber(value, 0);
  }

  function dispatchState(item) {
    return String(item?.estado_despacho || "PENDIENTE").toUpperCase();
  }

  function uniqueOptions(rows, field) {
    return [...new Set(rows.map(item => String(item[field] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function buildSummary(rows) {
    return {
      pending: rows.filter(item => dispatchState(item) === "PENDIENTE").length,
      preparing: rows.filter(item => dispatchState(item) === "EN_PREPARACION").length,
      ready: rows.filter(item => dispatchState(item) === "LISTO_DESPACHO").length,
      dispatched: rows.filter(item => dispatchState(item) === "DESPACHADO_DEMO").length,
      observed: rows.filter(item => dispatchState(item) === "OBSERVADO").length,
      cancelled: rows.filter(item => dispatchState(item) === "ANULADO_DEMO").length,
      totalBoxes: rows.reduce((sum, item) => sum + numeric(item.total_cajas), 0),
      totalFulls: rows.reduce((sum, item) => sum + numeric(item.total_fulls), 0)
    };
  }

  function applyFilters(rows, ui) {
    const filters = {
      state: String(ui.dispatchFilterState || "").trim().toUpperCase(),
      destination: String(ui.dispatchFilterDestination || "").trim().toUpperCase(),
      brand: String(ui.dispatchFilterBrand || "").trim().toUpperCase(),
      flightDate: String(ui.dispatchFilterFlightDate || "").trim(),
      search: String(ui.dispatchFilterSearch || "").trim().toUpperCase()
    };

    return rows.filter(item => {
      const text = [
        item.numero_pedido,
        item.pedido_id,
        item.cliente_principal,
        item.marca_cliente_final,
        item.destino,
        item.dae,
        item.awb,
        item.hawb
      ].join(" ").toUpperCase();
      if (filters.state && dispatchState(item) !== filters.state) return false;
      if (filters.destination && String(item.destino || "").toUpperCase() !== filters.destination) return false;
      if (filters.brand && String(item.marca_cliente_final || "").toUpperCase() !== filters.brand) return false;
      if (filters.flightDate && String(item.fecha_vuelo || "") !== filters.flightDate) return false;
      if (filters.search && !text.includes(filters.search)) return false;
      return true;
    });
  }

  function statusBadge(status) {
    const value = String(status || "-").toUpperCase();
    return `<span class="status-badge ${utils.badgeClass(value)}">${utils.esc(value)}</span>`;
  }

  function renderFilters(rows, ui) {
    const destinations = uniqueOptions(rows, "destino");
    const brands = uniqueOptions(rows, "marca_cliente_final");
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FILTROS</p>
            <h3>Despachos demo</h3>
          </div>
          <button class="secondary-button" data-ops-action="dispatch-clear-filters">Limpiar filtros</button>
        </div>
        <div class="commercial-filter-grid">
          <label>Estado despacho
            <select data-ops-ui-field="dispatchFilterState">
              <option value="">Todos</option>
              ${DISPATCH_STATES.map(state => `<option value="${utils.esc(state)}" ${ui.dispatchFilterState === state ? "selected" : ""}>${utils.esc(state)}</option>`).join("")}
            </select>
          </label>
          <label>Destino
            <select data-ops-ui-field="dispatchFilterDestination">
              <option value="">Todos</option>
              ${destinations.map(destination => `<option value="${utils.esc(destination)}" ${ui.dispatchFilterDestination === destination ? "selected" : ""}>${utils.esc(destination)}</option>`).join("")}
            </select>
          </label>
          <label>Marca
            <select data-ops-ui-field="dispatchFilterBrand">
              <option value="">Todas</option>
              ${brands.map(brand => `<option value="${utils.esc(brand)}" ${ui.dispatchFilterBrand === brand ? "selected" : ""}>${utils.esc(brand)}</option>`).join("")}
            </select>
          </label>
          <label>Fecha vuelo
            <input type="date" data-ops-ui-field="dispatchFilterFlightDate" value="${utils.esc(ui.dispatchFilterFlightDate || "")}">
          </label>
          <label>Busqueda por pedido
            <input type="search" data-ops-ui-field="dispatchFilterSearch" value="${utils.esc(ui.dispatchFilterSearch || "")}" placeholder="Pedido, DAE, AWB, cliente">
          </label>
        </div>
      </section>
    `;
  }

  function renderGeneral(dispatch) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">A. DATOS GENERALES</p>
            <h3>${utils.esc(dispatch.numero_pedido || dispatch.pedido_id || "Despacho demo")}</h3>
          </div>
          ${statusBadge(dispatch.estado_despacho)}
        </div>
        <div class="info-stack">
          <div class="info-row"><strong>Pedido</strong><span>${utils.esc(dispatch.numero_pedido || "-")}</span></div>
          <div class="info-row"><strong>Marca</strong><span>${utils.esc(dispatch.marca_cliente_final || "-")}</span></div>
          <div class="info-row"><strong>Destino</strong><span>${utils.esc(dispatch.destino || "-")}</span></div>
          <div class="info-row"><strong>Fecha vuelo</strong><span>${utils.esc(utils.dateLabel(dispatch.fecha_vuelo))}</span></div>
          <div class="info-row"><strong>Agencia</strong><span>${utils.esc(dispatch.agencia_carga || "-")}</span></div>
          <div class="info-row"><strong>DAE</strong><span>${utils.esc(dispatch.dae || "-")}</span></div>
          <div class="info-row"><strong>AWB / HAWB</strong><span>${utils.esc(dispatch.awb || "-")} / ${utils.esc(dispatch.hawb || "-")}</span></div>
          <div class="info-row"><strong>Carrier / vuelo</strong><span>${utils.esc(dispatch.carrier || "-")} / ${utils.esc(dispatch.vuelo || "-")}</span></div>
          <div class="info-row"><strong>Estado pedido</strong><span>${statusBadge(dispatch.estado_pedido)}</span></div>
          <div class="info-row"><strong>Estado despacho</strong><span>${statusBadge(dispatch.estado_despacho)}</span></div>
          <div class="info-row"><strong>Origen pedido</strong><span>${utils.esc(dispatch.pedido_id ? "Pedido Maestro" : "Demo operativo")}</span></div>
          <div class="info-row"><strong>Sincronizacion pedido</strong><span>${utils.esc(dispatch.sincronizacion_pedido?.observacion || "Estado visual compartido con Pedido Maestro.")}</span></div>
          <div class="info-row"><strong>Ultima actualizacion demo</strong><span>${utils.esc(dispatch.actualizado_en_demo ? dispatch.actualizado_en_demo.replace("T", " ").slice(0, 16) : "-")}</span></div>
          <div class="info-row"><strong>Observacion</strong><span>${utils.esc(dispatch.observacion || "-")}</span></div>
        </div>
      </article>
    `;
  }

  function renderMaterials(dispatch) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">D. BODEGA / MATERIALES</p>
            <h3>Materiales requeridos demo</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Requerido</th>
                <th>Disponible demo</th>
                <th>Faltante</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${(dispatch.materiales_requeridos || []).map(item => `
                <tr>
                  <td>${utils.esc(valueOf(item, ["material_nombre", "material", "nombre"], "-"))}</td>
                  <td>${utils.esc(utils.number(valueOf(item, ["requerido", "cantidad_requerida"], 0)))}</td>
                  <td>${utils.esc(utils.number(valueOf(item, ["disponible", "disponible_demo", "cantidad_disponible"], 0)))}</td>
                  <td>${utils.esc(utils.number(valueOf(item, ["faltante", "cantidad_faltante"], 0)))}</td>
                  <td>${statusBadge(item.estado)}</td>
                </tr>
              `).join("") || `<tr><td colspan="5">Sin materiales calculados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderChecklist(validation) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">E. CHECKLIST</p>
            <h3>Validacion de despacho</h3>
          </div>
          ${statusBadge(validation.errors.length ? "OBSERVADO" : validation.warnings.length ? "PENDIENTE" : "LISTO_DESPACHO")}
        </div>
        <div class="placeholder-grid">
          <div class="info-stack">
            <div class="info-row"><strong>Errores</strong><span>${utils.esc(validation.errors.length)}</span></div>
            ${validation.errors.map(error => `<div class="inline-feedback danger">${utils.esc(error)}</div>`).join("") || `<div class="inline-feedback success">Sin errores criticos.</div>`}
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Advertencias</strong><span>${utils.esc(validation.warnings.length)}</span></div>
            ${validation.warnings.map(warning => `<div class="inline-feedback warning">${utils.esc(warning)}</div>`).join("") || `<div class="inline-feedback success">Sin advertencias.</div>`}
          </div>
        </div>
        <div class="base-ready-list">
          ${(validation.checklist || []).map(item => `
            <div class="base-ready-item">
              <strong>${utils.esc(item.label)}</strong>
              <span>${utils.esc(item.status)} - ${utils.esc(item.detail)}</span>
            </div>
          `).join("") || `<div class="base-ready-item"><strong>Sin checklist</strong><span>No hay despacho seleccionado.</span></div>`}
        </div>
      </article>
    `;
  }

  function renderConsumption(dispatch, appState) {
    const service = BlessERP.operacionesConsumptionDemo;
    const review = service?.validateConsumptionReadinessDemo
      ? service.validateConsumptionReadinessDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id)
      : { errors: [], warnings: ["Servicio demo de consumo no disponible."], groupedSummary: [] };
    const consumptions = service?.getConsumptionsByOrderDemo
      ? service.getConsumptionsByOrderDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id)
      : [];
    const kardex = service?.getKardexByOrderDemo
      ? service.getKardexByOrderDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id)
      : [];
    const activeRows = consumptions.filter(item => String(item.estado_consumo || "").toUpperCase() === "SIMULADO");
    const revertedRows = consumptions.filter(item => String(item.estado_consumo || "").toUpperCase() === "REVERTIDO_DEMO");
    const totalBunches = activeRows.reduce((sum, item) => sum + numeric(item.ramos_consumidos_demo), 0);
    const totalStems = activeRows.reduce((sum, item) => sum + numeric(item.tallos_consumidos_demo), 0);
    const status = activeRows.length ? "SIMULADO" : revertedRows.length ? "REVERTIDO_DEMO" : "PENDIENTE";

    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CONSUMO DE INVENTARIO DEMO</p>
            <h3>Rosas consumidas por despacho</h3>
          </div>
          <span class="status-badge ${utils.badgeClass(status)}">${utils.esc(status)}</span>
        </div>
        <p class="panel-note">Consumo demo. No descuenta inventario real de rosas, no consume materiales reales y no genera contabilidad.</p>
        ${utils.renderSummaryCards([
          { label: "Estado consumo", value: status, help: "Solo visual/demo" },
          { label: "Ramos a consumir", value: utils.number(review.groupedSummary?.reduce((sum, item) => sum + numeric(item.ramos), 0) || 0), help: "Preview del consumo demo" },
          { label: "Tallos a consumir", value: utils.number(review.groupedSummary?.reduce((sum, item) => sum + numeric(item.tallos), 0) || 0), help: "Preview del consumo demo" },
          { label: "Ramos consumidos", value: utils.number(totalBunches), help: "Filas SIMULADO" },
          { label: "Tallos consumidos", value: utils.number(totalStems), help: "Filas SIMULADO" },
          { label: "Kardex demo", value: utils.number(kardex.length), help: "Movimientos operativos demo" }
        ])}
        <div class="placeholder-grid">
          <article class="panel-card">
            <div class="panel-card-head"><div><p class="section-kicker">RESUMEN</p><h3>Estado actual</h3></div></div>
            <div class="info-stack">
              <div class="info-row"><strong>Variedades</strong><span>${utils.esc(review.groupedSummary?.map(item => item.variedad).join(", ") || "-")}</span></div>
              <div class="info-row"><strong>Longitudes</strong><span>${utils.esc(review.groupedSummary?.map(item => `${item.longitud} cm`).join(", ") || "-")}</span></div>
              <div class="info-row"><strong>Reservas relacionadas</strong><span>${utils.esc(utils.number((dispatch.reservas_relacionadas || []).length))}</span></div>
              <div class="info-row"><strong>Kardex relacionado</strong><span>${utils.esc(utils.number(kardex.length))} fila(s)</span></div>
            </div>
          </article>
          <article class="panel-card">
            <div class="panel-card-head"><div><p class="section-kicker">ADVERTENCIAS</p><h3>Revision previa</h3></div></div>
            <div class="base-ready-list">
              ${(review.warnings || []).map(item => `<div class="base-ready-item"><strong>Advertencia</strong><span>${utils.esc(item)}</span></div>`).join("") || `<div class="base-ready-item"><strong>Sin advertencias</strong><span>El consumo demo no reporta novedades.</span></div>`}
            </div>
          </article>
        </div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-ops-action="dispatch-consumption-simulate" data-order-id="${utils.esc(dispatch.pedido_id || "")}">Simular consumo demo</button>
          <button class="secondary-button" data-ops-action="dispatch-consumption-kardex" data-order-id="${utils.esc(dispatch.pedido_id || "")}">Ver kardex demo</button>
          <button class="secondary-button" data-ops-action="dispatch-consumption-reverse" data-order-id="${utils.esc(dispatch.pedido_id || "")}">Revertir consumo demo</button>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Variedad</th>
                <th>Longitud</th>
                <th>Ramos</th>
                <th>Tallos</th>
                <th>Availability</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${activeRows.map(item => `
                <tr>
                  <td>${utils.esc(item.variedad || "-")}</td>
                  <td>${utils.esc(item.longitud || "-")} cm</td>
                  <td>${utils.esc(utils.number(item.ramos_consumidos_demo || 0))}</td>
                  <td>${utils.esc(utils.number(item.tallos_consumidos_demo || 0))}</td>
                  <td>${utils.esc(item.availability_id || "-")}</td>
                  <td>${statusBadge(item.estado_consumo)}</td>
                </tr>
              `).join("") || `<tr><td colspan="6">No hay consumo demo simulado todavia.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderOperationalCycle(dispatch, appState) {
    const cycleService = BlessERP.operacionesCycleDemo;
    const cycle = cycleService?.getOperationalCycleByOrderDemo
      ? cycleService.getOperationalCycleByOrderDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id)
      : {
          estado_ciclo: "SIN_INICIAR",
          reservas: [],
          cajas: dispatch.cajas || [],
          escaneos: { summary: { scanned: 0, pending: (dispatch.cajas || []).length } },
          consumos: [],
          kardex: [],
          advertencias: ["Servicio de ciclo operativo demo no disponible."]
        };
    const activeConsumptions = (cycle.consumos || []).filter(item => String(item.estado_consumo || "").toUpperCase() === "SIMULADO");

    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CICLO OPERATIVO DEL PEDIDO</p>
            <h3>De reserva a kardex demo</h3>
          </div>
          <span class="status-badge ${utils.badgeClass(cycle.estado_ciclo || "PENDIENTE")}">${utils.esc(cycle.estado_ciclo || "SIN_INICIAR")}</span>
        </div>
        <p class="panel-note">Ciclo operativo demo. No descuenta inventario real, no afecta contabilidad y no conecta Parte 1 real todavia.</p>
        ${utils.renderSummaryCards([
          { label: "Reservas relacionadas", value: utils.number((cycle.reservas || []).length), help: "reservationContract demo" },
          { label: "Cajas creadas", value: utils.number((cycle.cajas || []).length), help: "Cajas del pedido" },
          { label: "Cajas escaneadas", value: utils.number(cycle.escaneos?.summary?.scanned || 0), help: "Scanner demo" },
          { label: "Estado despacho", value: dispatch.estado_despacho || "PENDIENTE", help: "dispatchContract demo" },
          { label: "Consumo demo", value: utils.number(activeConsumptions.length), help: "Filas SIMULADO" },
          { label: "Kardex demo", value: utils.number((cycle.kardex || []).length), help: "Movimientos operativos demo" }
        ])}
        <div class="placeholder-grid">
          <article class="panel-card">
            <div class="panel-card-head"><div><p class="section-kicker">RESUMEN</p><h3>Estado del ciclo</h3></div></div>
            <div class="info-stack">
              <div class="info-row"><strong>Disponibilidad origen</strong><span>${utils.esc((cycle.disponibilidad_relacionada || []).map(item => item.availability_id).join(", ") || "Pendiente demo")}</span></div>
              <div class="info-row"><strong>Reservas relacionadas</strong><span>${utils.esc((cycle.reservas || []).map(item => item.reservation_id || item.id).join(", ") || "Sin reservas")}</span></div>
              <div class="info-row"><strong>Cajas escaneadas</strong><span>${utils.esc(utils.number(cycle.escaneos?.summary?.scanned || 0))} / ${utils.esc(utils.number(cycle.escaneos?.summary?.total || 0))}</span></div>
              <div class="info-row"><strong>Kardex demo</strong><span>${utils.esc(utils.number((cycle.kardex || []).length))} movimiento(s)</span></div>
            </div>
          </article>
          <article class="panel-card">
            <div class="panel-card-head"><div><p class="section-kicker">ADVERTENCIAS</p><h3>Revision del ciclo</h3></div></div>
            <div class="base-ready-list">
              ${(cycle.advertencias || []).map(item => `<div class="base-ready-item"><strong>Advertencia</strong><span>${utils.esc(item)}</span></div>`).join("") || `<div class="base-ready-item"><strong>Sin advertencias</strong><span>El ciclo demo no reporta novedades.</span></div>`}
            </div>
          </article>
        </div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-ops-action="dispatch-cycle-view" data-order-id="${utils.esc(dispatch.pedido_id || "")}">Ver ciclo operativo</button>
          <button class="secondary-button" data-ops-action="dispatch-consumption-kardex" data-order-id="${utils.esc(dispatch.pedido_id || "")}">Ver kardex demo</button>
          <button class="secondary-button" data-route-link="operations-roses-inventory">Ver consumo demo</button>
          <button class="secondary-button" data-route-link="operations-availability">Ver disponibilidad origen</button>
        </div>
      </article>
    `;
  }

  function renderCompactTable(rows, appState) {
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">DESPACHOS</p><h3>Pedidos en despacho operativo</h3></div>
          <span class="status-badge partial">${utils.esc(rows.length)} registro(s)</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Pedido</th><th>Fecha vuelo</th><th>Cliente / marca</th><th>Destino</th><th>DAE</th><th>Cajas</th><th>Armado de cajas</th><th>Estado Bodega</th><th>Estado despacho</th><th>Responsable</th><th>Accion</th></tr></thead>
            <tbody>${rows.map(item => {
              const orderId = item.pedido_id || item.numero_pedido || item.dispatch_id;
              const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, orderId);
              const pendingChanges = BlessERP.comercialOrderFulfillment?.getPendingOrderChanges?.(appState, orderId) || [];
              return `<tr>
                <td><strong>${utils.esc(item.numero_pedido || item.pedido_id || "-")}</strong><br><small>${utils.esc(item.actualizado_en_demo ? item.actualizado_en_demo.replace("T", " ").slice(0, 16) : "-")}</small></td>
                <td>${utils.esc(utils.dateLabel(item.fecha_vuelo))}</td>
                <td>${utils.esc(item.cliente_principal || "-")}<br><small>${utils.esc(item.marca_cliente_final || "-")}</small></td>
                <td>${utils.esc(item.destino || "-")}</td>
                <td>${utils.esc(item.dae || "-")}</td>
                <td>${utils.esc(utils.number(fulfillment?.totalBoxes || item.total_cajas || 0))}${pendingChanges.length ? `<br><small class="status-badge pending">NUEVA CAJA R${utils.esc(pendingChanges[0].revision)}</small>` : ""}</td>
                <td><strong>${utils.esc(fulfillment?.completeBoxes || 0)} / ${utils.esc(fulfillment?.totalBoxes || item.total_cajas || 0)}</strong><br><small>${utils.esc(fulfillment?.pendingBunches || 0)} ramos pendientes</small></td>
                <td>${statusBadge(fulfillment?.warehouseStatus || item.estado_bodega)}</td>
                <td>${statusBadge(item.estado_despacho)}</td>
                <td>${utils.esc(item.responsable_demo || "-")}</td>
                <td><button class="primary-button" data-ops-action="dispatch-view-detail" data-order-id="${utils.esc(orderId)}">Ver detalle</button></td>
              </tr>`;
            }).join("") || `<tr><td colspan="11">No hay despachos con los filtros actuales.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderDetailTabs(active) {
    return `<div class="subnav-tabs">
      <button class="subnav-tab ${active === "boxes" ? "active" : ""}" data-ops-ui-field="dispatchDetailTab" data-value="boxes">Cajas y escaner</button>
      <button class="subnav-tab ${active === "general" ? "active" : ""}" data-ops-ui-field="dispatchDetailTab" data-value="general">Datos generales</button>
      <button class="subnav-tab ${active === "checklist" ? "active" : ""}" data-ops-ui-field="dispatchDetailTab" data-value="checklist">Checklist</button>
      <button class="subnav-tab ${active === "inventory" ? "active" : ""}" data-ops-ui-field="dispatchDetailTab" data-value="inventory">Inventario demo</button>
      <button class="subnav-tab ${active === "cycle" ? "active" : ""}" data-ops-ui-field="dispatchDetailTab" data-value="cycle">Ciclo operativo</button>
    </div>`;
  }

  function lineContentLabel(line) {
    if (line?.boxBuildMode !== "MIXTO_ABIERTO") {
      if (!isAnyLengthLine(line)) return `${line?.variety || "-"} ${line?.length || "-"} cm`;
      const grouped = new Map();
      (line.scannedBunches || []).forEach(scan => grouped.set(Number(scan.length || 0), (grouped.get(Number(scan.length || 0)) || 0) + 1));
      const actual = [...grouped.entries()].filter(([length]) => length > 0).sort((left, right) => left[0] - right[0]).map(([length, bunches]) => `${length} cm x ${bunches}`).join(", ");
      return `${line?.variety || "-"} · CUALQUIER MEDIDA${actual ? ` · leido: ${actual}` : ""}`;
    }
    const actual = Array.isArray(line.mixedActualComposition) ? line.mixedActualComposition : [];
    if (!actual.length) return isAnyLengthLine(line) ? "MIXTO ABIERTO · CUALQUIER MEDIDA" : `MIXTO ABIERTO ${line.length} cm`;
    return actual.map(item => `${item.variety} ${item.length} cm · ${item.bunches} ramo(s)`).join(" / ");
  }

  function isAnyLengthLine(line) {
    return line?.anyLength === true || (line?.boxBuildMode === "MIXTO_ABIERTO" && line?.mixedAnyLength !== false);
  }

  function lineMeasureLabel(line) {
    return isAnyLengthLine(line) ? "CUALQUIER MEDIDA" : `${line?.length || "-"} cm`;
  }

  function renderBunchAssembly(dispatch, appState, ui) {
    const orderId = dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id;
    const service = BlessERP.comercialOrderFulfillment;
    const summary = service?.getOrderFulfillment?.(appState, orderId);
    if (!summary) return `<section class="panel-card"><p class="panel-note">El pedido no esta conectado al detalle comercial de cajas.</p></section>`;
    const firstPending = summary.boxes.find(box => !box.automaticComplete) || summary.boxes[0];
    const selectedBox = summary.boxes.find(box => box.boxNumber === Number(ui.dispatchAssemblyBoxNumber)) || firstPending;
    const pendingChanges = service.getPendingOrderChanges?.(appState, orderId) || [];
    const newestChange = pendingChanges[0] || null;
    const newBoxNumbers = new Set(newestChange?.boxNumbers || []);
    const lastScan = ui.dispatchLastBunchScan;

    return `
      ${newestChange ? `<section class="hero-banner"><div><strong>Nueva actualizacion del pedido · Revision ${utils.esc(newestChange.revision)}</strong><span>${utils.esc(newestChange.message)} Motivo: ${utils.esc(newestChange.reason || "-")}</span></div><button class="primary-button" data-ops-action="dispatch-acknowledge-revision" data-order-id="${utils.esc(orderId)}">Actualizacion revisada</button></section>` : ""}
      ${utils.renderSummaryCards([
        { label: "Cajas del pedido", value: utils.number(summary.totalBoxes), help: "Incluye ampliaciones" },
        { label: "Cajas completas", value: utils.number(summary.completeBoxes), help: "Completadas automaticamente" },
        { label: "Ramos escaneados", value: utils.number(summary.scannedBunches), help: "Asignados al contenido" },
        { label: "Ramos pendientes", value: utils.number(summary.pendingBunches), help: "Puede continuar en otra caja" }
      ])}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">DETALLE DE CAJAS</p><h3>Seleccione el numero de caja</h3></div><span class="status-badge ${utils.badgeClass(summary.warehouseStatus)}">${utils.esc(summary.warehouseStatus)}</span></div>
          <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Caja</th><th>Tipo</th><th>Resumen contenido</th><th>Avance</th><th>Estado</th></tr></thead><tbody>
            ${summary.boxes.map(box => `<tr class="${selectedBox?.boxNumber === box.boxNumber ? "selected-row" : ""}"><td><button class="row-action-button" data-ops-action="dispatch-select-assembly-box" data-box-number="${utils.esc(box.boxNumber)}">Caja ${utils.esc(box.boxNumber)}</button>${newBoxNumbers.has(box.boxNumber) || summary.order.boxFulfillment?.[box.boxNumber]?.isNew ? `<br><small class="status-badge pending">NUEVA R${utils.esc(summary.order.boxFulfillment?.[box.boxNumber]?.addedRevision || newestChange?.revision || summary.order.revisionNumber)}</small>` : ""}</td><td>${utils.esc(box.boxType)}</td><td>${utils.esc(box.lines.map(item => `${lineContentLabel(item.line)} · ${item.required} ramos`).join(" / "))}</td><td><strong>${utils.esc(box.scanned)} / ${utils.esc(box.required)}</strong></td><td><span class="status-badge ${utils.badgeClass(box.status)}">${utils.esc(box.status)}</span></td></tr>`).join("") || `<tr><td colspan="5">El pedido no tiene cajas.</td></tr>`}
          </tbody></table></div>
          <p class="panel-note">Puede cambiar de caja aunque la seleccionada este incompleta. El avance queda guardado.</p>
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">CONTENIDO DE CAJA</p><h3>Caja ${utils.esc(selectedBox?.boxNumber || "-")} · ${utils.esc(selectedBox?.boxType || "-")}</h3></div>${selectedBox ? `<span class="status-badge ${utils.badgeClass(selectedBox.status)}">${utils.esc(selectedBox.status)}</span>` : ""}</div>
          ${selectedBox ? `<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Variedad / composicion real</th><th>Medida solicitada</th><th>T/R</th><th>Requeridos</th><th>Escaneados</th><th>Pendientes</th><th>Estado</th></tr></thead><tbody>${selectedBox.lines.map(item => `<tr><td><strong>${utils.esc(lineContentLabel(item.line))}</strong>${item.line.boxBuildMode === "MIXTO_ABIERTO" && item.line.mixedExcludedVarieties?.length ? `<br><small>Excluye: ${utils.esc(item.line.mixedExcludedVarieties.join(", "))}</small>` : ""}</td><td>${utils.esc(lineMeasureLabel(item.line))}</td><td>${utils.esc(item.line.stemsPerBunch)}</td><td>${utils.esc(item.required)}</td><td>${utils.esc(item.scanned)}</td><td>${utils.esc(item.pending)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-inline">Seleccione una caja.</div>`}
          <label class="compact-field full"><span>Codigo manual del ramo (10 digitos)</span><input type="text" inputmode="numeric" maxlength="10" autocomplete="off" data-ops-ui-field="dispatchBunchScanCode" data-ops-dispatch-bunch-scan="true" value="${utils.esc(ui.dispatchBunchScanCode || "")}" placeholder="Ejemplo: 0000000101" ${selectedBox?.automaticComplete ? "disabled" : ""}></label>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="dispatch-scan-bunch" data-order-id="${utils.esc(orderId)}" ${selectedBox?.automaticComplete ? "disabled" : ""}>Validar ramo manual</button></div>
          ${lastScan ? `<div class="inline-feedback ${lastScan.ok ? "success" : "danger"}">${utils.esc(lastScan.message || "-")}${lastScan.warning ? `<br>${utils.esc(lastScan.warning)}` : ""}</div>` : ""}
          ${selectedBox?.automaticComplete ? `<div class="inline-feedback success">Caja completa automaticamente. La composicion real ya esta sincronizada con Ventas.</div>` : `<p class="panel-note">Ingreso manual temporal mientras Zebra no esta conectado. Una medida especifica exige coincidencia exacta; CUALQUIER MEDIDA acepta cualquier longitud parametrizada. La variedad sigue fija, salvo en mixto abierto, que acepta las variedades permitidas y sincroniza la composicion real con Ventas.</p>`}
        </article>
      </section>
    `;
  }

  function renderDetailWindow(dispatch, appState, ui) {
    if (!dispatch) return `<section class="panel-card"><p class="panel-note">El despacho seleccionado ya no existe.</p><button class="secondary-button" data-ops-action="dispatch-back-list">Volver a la tabla</button></section>`;
    const orderId = dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id;
    const active = ui.dispatchDetailTab || "boxes";
    const validation = BlessERP.operacionesDispatchDemo.validateDispatchReadinessDemo(appState, orderId);
    let content = renderBunchAssembly(dispatch, appState, ui);
    if (active === "general") content = `<section class="placeholder-grid">${renderGeneral(dispatch)}</section>`;
    if (active === "checklist") content = `<section class="placeholder-grid">${renderChecklist(validation)}</section>`;
    if (active === "inventory") content = `<section class="placeholder-grid">${renderMaterials(dispatch)}${renderConsumption(dispatch, appState)}</section>`;
    if (active === "cycle") content = `<section class="placeholder-grid">${renderOperationalCycle(dispatch, appState)}</section>`;

    return `
      <section class="page-header">
        <div><p class="section-kicker">DETALLE DE DESPACHO</p><h1>${utils.esc(dispatch.numero_pedido || orderId)}</h1><p>${utils.esc(dispatch.cliente_principal || "-")} · ${utils.esc(dispatch.marca_cliente_final || "-")} · ${utils.esc(dispatch.destino || "-")}</p></div>
        <div class="page-header-side"><button class="secondary-button" data-ops-action="dispatch-back-list">Volver a despachos</button>${statusBadge(dispatch.estado_despacho)}</div>
      </section>
      <section class="hero-banner"><div><strong>Lectura de ramos asociada al pedido</strong><span>Cada ramo se valida contra el contenido de la caja seleccionada. La caja no se escanea. No conecta Zebra real.</span></div><span class="status-badge partial">${utils.esc(dispatch.total_cajas || 0)} caja(s)</span></section>
      ${renderDetailTabs(active)}
      ${content}
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">ACCIONES DEL DESPACHO</p><h3>Control de estado</h3></div></div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-ops-action="dispatch-ready" data-order-id="${utils.esc(orderId)}">Marcar listo</button>
          <button class="primary-button" data-ops-action="dispatch-confirm" data-order-id="${utils.esc(orderId)}">Confirmar despacho demo</button>
          <button class="secondary-button" data-ops-action="dispatch-observe" data-order-id="${utils.esc(orderId)}">Observar</button>
          <button class="secondary-button" data-ops-action="dispatch-cancel" data-order-id="${utils.esc(orderId)}">Anular demo</button>
          <button class="secondary-button" data-ops-action="dispatch-reopen" data-order-id="${utils.esc(orderId)}">Reabrir demo</button>
        </div>
      </section>
    `;
  }

  function render(appState, route) {
    const ui = stateApi.getUi(appState);
    const allRows = BlessERP.operacionesDispatchDemo?.getDispatchesDemo
      ? BlessERP.operacionesDispatchDemo.getDispatchesDemo(appState)
      : [];
    const selected = allRows.find(item => [item.pedido_id, item.numero_pedido, item.dispatch_id].includes(ui.selectedDispatchOrderId)) || null;

    if (ui.dispatchViewMode === "detail") {
      return `${utils.renderTabs(route)}${utils.renderNotice(ui)}${renderDetailWindow(selected, appState, ui)}`;
    }

    const filteredRows = applyFilters(allRows, ui);
    const summary = buildSummary(allRows);
    return `
      ${utils.renderPageHeader(route, "Bandeja de pedidos para despacho", "partial", "Abra Ver detalle para revisar cajas y usar el escaner asociado al despacho.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner"><div><strong>Despacho operativo demo</strong><span>La tabla muestra el estado general. El detalle, cajas y escaner se abren en una pantalla separada.</span></div><span class="status-badge pending">Sin inventario real</span></section>
      ${utils.renderSummaryCards([
        { label: "Pendientes", value: utils.number(summary.pending), help: "Estado PENDIENTE" },
        { label: "En preparacion", value: utils.number(summary.preparing), help: "Estado EN_PREPARACION" },
        { label: "Listos despacho", value: utils.number(summary.ready), help: "Estado LISTO_DESPACHO" },
        { label: "Despachados demo", value: utils.number(summary.dispatched), help: "Sin descuento real" },
        { label: "Observados", value: utils.number(summary.observed), help: "Requieren revision" },
        { label: "Total cajas", value: utils.number(summary.totalBoxes), help: "Cajas de todos los despachos" }
      ])}
      ${renderFilters(allRows, ui)}
      ${renderCompactTable(filteredRows, appState)}
    `;
  }

  BlessERP.operacionesDespacho = { render };
})();
