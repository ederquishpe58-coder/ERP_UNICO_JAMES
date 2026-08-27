(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  const DISPATCH_STATES = [
    "PENDIENTE",
    "PEDIDO_INCOMPLETO",
    "PEDIDO_COMPLETADO",
    "PEDIDO_ACTUALIZADO",
    "CARGADO_CAMION",
    "OBSERVADO",
    "ANULADO"
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

  function buildSummary(rows) {
    return rows.reduce((summary, item) => {
      const state = dispatchState(item);
      const key = {
        PENDIENTE: "pending",
        PEDIDO_INCOMPLETO: "preparing",
        PEDIDO_COMPLETADO: "ready",
        PEDIDO_ACTUALIZADO: "updated",
        CARGADO_CAMION: "dispatched",
        OBSERVADO: "observed",
        ANULADO: "cancelled"
      }[state];
      if (key) summary[key] += 1;
      summary.totalBoxes += numeric(item.total_cajas);
      summary.totalFulls += numeric(item.total_fulls);
      return summary;
    }, { pending: 0, preparing: 0, ready: 0, updated: 0, dispatched: 0, observed: 0, cancelled: 0, totalBoxes: 0, totalFulls: 0 });
  }

  function applyFilters(rows, ui) {
    const requestedState = String(ui.dispatchFilterState || "").trim().toUpperCase();
    const filters = {
      state: ["PENDIENTE", "COMPLETADO", "INCOMPLETO"].includes(requestedState) ? requestedState : "",
      orderDate: String(ui.dispatchFilterOrderDate || "").trim(),
      search: String(ui.dispatchFilterSearch || "").trim().toUpperCase()
    };

    return rows.filter(item => {
      const effectiveState = dispatchState(item);
      const simpleState = effectiveState === "PEDIDO_COMPLETADO"
        ? "COMPLETADO"
        : effectiveState === "PENDIENTE"
          ? "PENDIENTE"
          : "INCOMPLETO";
      const text = [
        item.numero_pedido,
        item.pedido_id,
        item.destino,
        item.dae,
        item.awb,
        item.hawb
      ].join(" ").toUpperCase();
      if (filters.state && simpleState !== filters.state) return false;
      if (filters.orderDate && String(item.fecha_pedido || "").slice(0, 10) !== filters.orderDate) return false;
      if (filters.search && !text.includes(filters.search)) return false;
      return true;
    });
  }

  function statusBadge(status) {
    const value = String(status || "-").toUpperCase();
    return `<span class="status-badge ${utils.badgeClass(value)}">${utils.esc(value)}</span>`;
  }

  function previewComposition(line) {
    if (line?.boxBuildMode !== "MIXTO_ABIERTO") return "";
    const rows = Array.isArray(line.mixedActualComposition) ? line.mixedActualComposition : [];
    if (!rows.length) return "Todavía no se han ingresado ramos en este mixto abierto.";
    return rows
      .map(item => `${item.variety || "-"} ${Number(item.length || 0) || "-"} cm · ${Number(item.bunches || 0)} ramo(s)`)
      .join(" / ");
  }

  function renderBoxesPreviewModal(dispatch, appState) {
    if (!dispatch) return "";
    const orderId = dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id;
    const summary = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, orderId);
    if (!summary) return "";
    const status = summary.allBoxesComplete
      ? "COMPLETADO"
      : Number(summary.scannedBunches || 0) > 0
        ? "INCOMPLETO"
        : "PENDIENTE";

    return `
      <div class="erp-modal-backdrop" data-ops-preview-backdrop>
        <section class="erp-modal-card cold-room-preview-modal" role="dialog" aria-modal="true" aria-label="Contenido del pedido ${utils.esc(dispatch.numero_pedido || orderId)}">
          <header class="erp-modal-header">
            <div>
              <p class="section-kicker">CUARTO FRÍO · CONTENIDO DEL PEDIDO</p>
              <h3>${utils.esc(dispatch.numero_pedido || orderId)}</h3>
              <p class="panel-note">${utils.esc(dispatch.cliente_principal || "-")} · ${utils.esc(dispatch.marca_cliente_final || "-")} · ${utils.esc(utils.dateLabel(dispatch.fecha_pedido || dispatch.fecha_vuelo))}</p>
            </div>
            <div class="table-actions-inline">${statusBadge(status)}<button class="secondary-button" type="button" data-ops-action="dispatch-preview-close">Cerrar</button></div>
          </header>
          <div class="cold-room-preview-body">
            <div class="cold-room-mini-summary">
              <div><span>Cajas</span><strong>${utils.number(summary.totalBoxes)}</strong></div>
              <div><span>Completas</span><strong>${utils.number(summary.completeBoxes)}</strong></div>
              <div><span>Ramos ingresados</span><strong>${utils.number(summary.scannedBunches)}</strong></div>
              <div><span>Ramos pendientes</span><strong>${utils.number(summary.pendingBunches)}</strong></div>
            </div>
            <section class="cold-room-preview-section">
              <div class="panel-card-head"><div><p class="section-kicker">CONTENIDO POR CAJA</p><h3>Solicitado y composición ingresada</h3></div></div>
              <div class="compact-table-wrap">
                <table class="compact-table">
                  <thead><tr><th>Caja</th><th>Tipo</th><th>Variedad / composición real</th><th>Solicitados</th><th>Ingresados</th><th>Pendientes</th><th>Estado</th></tr></thead>
                  <tbody>${summary.boxes.map(box => box.lines.map((item, index) => {
                    const mixedComposition = previewComposition(item.line);
                    const requested = item.line?.boxBuildMode === "MIXTO_ABIERTO"
                      ? `MIXTO ABIERTO · ${lineMeasureLabel(item.line)}`
                      : `${item.line?.variety || "-"} · ${lineMeasureLabel(item.line)}`;
                    const rowStatus = item.pending === 0 ? "COMPLETO" : item.scanned > 0 ? "INCOMPLETO" : "PENDIENTE";
                    return `<tr>
                      ${index === 0 ? `<td rowspan="${box.lines.length}"><strong>Caja ${utils.esc(box.boxNumber)}</strong></td><td rowspan="${box.lines.length}">${utils.esc(box.boxType)}</td>` : ""}
                      <td><strong>${utils.esc(requested)}</strong>${mixedComposition ? `<br><small class="master-mix-actual">${utils.esc(mixedComposition)}</small>` : ""}</td>
                      <td>${utils.number(item.required)}</td><td>${utils.number(item.scanned)}</td><td>${utils.number(item.pending)}</td><td>${statusBadge(rowStatus)}</td>
                    </tr>`;
                  }).join("")).join("") || `<tr><td colspan="7">El pedido no contiene cajas.</td></tr>`}</tbody>
                </table>
              </div>
            </section>
          </div>
          <footer class="erp-modal-footer"><span class="panel-note">Vista de consulta. Puede revisar aquí los mixtos abiertos sin ingresar al escáner.</span><button class="primary-button" type="button" data-ops-action="dispatch-preview-close">Cerrar detalle</button></footer>
        </section>
      </div>
    `;
  }

  function renderFilters(_rows, ui) {
    const requestedState = String(ui.dispatchFilterState || "").trim().toUpperCase();
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FILTROS</p>
            <h3>Estado de preparación y carga</h3>
          </div>
          <button class="secondary-button" data-ops-action="dispatch-clear-filters">Limpiar filtros</button>
        </div>
        <div class="commercial-filter-grid">
          <label>Estado en cuarto frío
            <select data-ops-ui-field="dispatchFilterState">
              <option value="">Todos</option>
              <option value="PENDIENTE" ${requestedState === "PENDIENTE" ? "selected" : ""}>Pendientes</option>
              <option value="INCOMPLETO" ${requestedState === "INCOMPLETO" ? "selected" : ""}>Incompletos</option>
              <option value="COMPLETADO" ${requestedState === "COMPLETADO" ? "selected" : ""}>Completados</option>
            </select>
          </label>
          <label>Fecha del pedido
            <input type="date" data-ops-ui-field="dispatchFilterOrderDate" value="${utils.esc(ui.dispatchFilterOrderDate || "")}">
          </label>
          <label>Busqueda por pedido
            <input type="search" data-ops-ui-field="dispatchFilterSearch" value="${utils.esc(ui.dispatchFilterSearch || "")}" placeholder="Número de pedido, DAE o guía">
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
        <h3>${utils.esc(dispatch.numero_pedido || dispatch.pedido_id || "Despacho")}</h3>
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
      <div class="info-row"><strong>Origen pedido</strong><span>${utils.esc(dispatch.pedido_id ? "Crear pedido" : "Registro operativo")}</span></div>
          <div class="info-row"><strong>Sincronizacion pedido</strong><span>${utils.esc(dispatch.sincronizacion_pedido?.observacion || "Estado visual compartido con Crear pedido.")}</span></div>
      <div class="info-row"><strong>Ultima actualizacion</strong><span>${utils.esc(dispatch.actualizado_en_demo ? dispatch.actualizado_en_demo.replace("T", " ").slice(0, 16) : "-")}</span></div>
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

  function renderCompactTable(rows, appState, pagination) {
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">CUARTO FRÍO</p><h3>Historial de pedidos</h3><p class="panel-note">Abra un pedido para ingresar a su escáner de cajas.</p></div>
          <span class="status-badge partial">${utils.esc(pagination?.total ?? rows.length)} registro(s)</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Número de pedido</th><th>Fecha</th><th>Destino</th><th>Cajas</th><th>Avance</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>${rows.map(item => {
              const orderId = item.pedido_id || item.numero_pedido || item.dispatch_id;
              const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, orderId);
              const pendingChanges = BlessERP.comercialOrderFulfillment?.getPendingOrderChanges?.(appState, orderId) || [];
              const completionStatus = fulfillment?.allBoxesComplete || dispatchState(item) === "PEDIDO_COMPLETADO"
                ? "COMPLETADO"
                : Number(fulfillment?.scannedBunches || 0) > 0 || dispatchState(item) === "PEDIDO_INCOMPLETO"
                  ? "INCOMPLETO"
                  : "PENDIENTE";
              return `<tr>
                <td><strong>${utils.esc(item.numero_pedido || item.pedido_id || "-")}</strong><br><small>${utils.esc(item.actualizado_en_demo ? item.actualizado_en_demo.replace("T", " ").slice(0, 16) : "-")}</small></td>
                <td>${utils.esc(utils.dateLabel(item.fecha_pedido || item.fecha_vuelo))}</td>
                <td>${utils.esc(item.destino || "-")}</td>
                <td>${utils.esc(utils.number(fulfillment?.totalBoxes || item.total_cajas || 0))}${pendingChanges.length ? `<br><small class="status-badge pending">${pendingChanges[0].removedBoxNumbers?.length ? "CAJA RETIRADA" : "ACTUALIZACION"} R${utils.esc(pendingChanges[0].revision)}</small>` : ""}</td>
                <td><strong>${utils.esc(fulfillment?.completeBoxes || 0)} / ${utils.esc(fulfillment?.totalBoxes || item.total_cajas || 0)}</strong><br><small>${utils.esc(fulfillment?.pendingBunches || 0)} ramos pendientes</small></td>
                <td>${statusBadge(completionStatus)}</td>
                <td><div class="table-actions-inline"><button class="secondary-button" type="button" data-ops-action="dispatch-preview-order" data-order-id="${utils.esc(orderId)}">Ver cajas</button><button class="primary-button" type="button" data-ops-action="dispatch-view-detail" data-order-id="${utils.esc(orderId)}">Abrir escáner</button></div></td>
              </tr>`;
            }).join("") || `<tr><td colspan="7">No hay pedidos en cuarto frío con los filtros actuales.</td></tr>`}</tbody>
          </table>
        </div>
        ${BlessERP.performance?.renderPager?.(pagination) || ""}
      </section>
    `;
  }

  function renderDetailTabs(active) {
    return `<div class="subnav-tabs">
      <button class="subnav-tab ${active === "boxes" ? "active" : ""}" data-ops-ui-field="dispatchDetailTab" data-value="boxes">Escáner de cajas</button>
      <button class="subnav-tab ${active === "general" ? "active" : ""}" data-ops-ui-field="dispatchDetailTab" data-value="general">Datos generales</button>
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
    const retiredBoxes = (summary.order.cancelledBoxes || []).slice(0, 6);
    const newBoxNumbers = new Set(newestChange?.boxNumbers || []);
    const lastScan = ui.dispatchLastBunchScan;
    const dispatchService = BlessERP.operacionesDispatchDemo;
    const progress = dispatchService?.getDispatchProgressDemo?.(appState, orderId) || {
      status: summary.allBoxesComplete ? "PEDIDO_COMPLETADO" : summary.scannedBunches > 0 ? "PEDIDO_INCOMPLETO" : "PENDIENTE"
    };

    return `
      ${newestChange ? `<section class="hero-banner"><div><strong>Nueva actualizacion del pedido · Revision ${utils.esc(newestChange.revision)}</strong><span>${utils.esc(newestChange.message)} Motivo: ${utils.esc(newestChange.reason || "-")}</span></div><button class="primary-button" data-ops-action="dispatch-acknowledge-revision" data-order-id="${utils.esc(orderId)}">Actualizacion revisada</button></section>` : ""}
      ${retiredBoxes.length ? `<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">CAJAS RETIRADAS POR COMERCIAL</p><h3>No preparar ni escanear estas cajas</h3></div><span class="status-badge cancelled">${utils.esc(retiredBoxes.length)} registrada(s)</span></div><div class="base-ready-list">${retiredBoxes.map(item => `<div class="base-ready-item"><strong>Caja ${utils.esc(item.boxNumber)} · R${utils.esc(item.revision || "-")}</strong><span>${utils.esc(item.reason || "Sin motivo")} · ${utils.esc(item.releasedBunches || 0)} ramo(s) devueltos a disponibilidad</span></div>`).join("")}</div></section>` : ""}
      <section class="hero-banner"><div><strong>Cuarto frío · Escáner de cajas</strong><span>El avance se guarda con cada lectura. No requiere seleccionar responsable ni confirmar una salida.</span></div>${statusBadge(progress.status)}</section>
      ${utils.renderSummaryCards([
        { label: "Cajas del pedido", value: utils.number(summary.totalBoxes), help: "Incluye ampliaciones" },
        { label: "Cajas completas", value: utils.number(summary.completeBoxes), help: "Completadas automaticamente" },
        { label: "Ramos escaneados", value: utils.number(summary.scannedBunches), help: "Asignados al contenido" },
        { label: "Ramos pendientes", value: utils.number(summary.pendingBunches), help: "Puede continuar en otra caja" }
      ])}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">DETALLE DE CAJAS</p><h3>Seleccione el numero de caja</h3></div>${statusBadge(progress.status)}</div>
          <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Caja</th><th>Tipo</th><th>Resumen contenido</th><th>Avance</th><th>Estado</th></tr></thead><tbody>
            ${summary.boxes.map(box => `<tr class="${selectedBox?.boxNumber === box.boxNumber ? "selected-row" : ""}"><td><button class="row-action-button" data-ops-action="dispatch-select-assembly-box" data-box-number="${utils.esc(box.boxNumber)}">Caja ${utils.esc(box.boxNumber)}</button>${newBoxNumbers.has(box.boxNumber) || summary.order.boxFulfillment?.[box.boxNumber]?.isNew ? `<br><small class="status-badge pending">NUEVA R${utils.esc(summary.order.boxFulfillment?.[box.boxNumber]?.addedRevision || newestChange?.revision || summary.order.revisionNumber)}</small>` : ""}</td><td>${utils.esc(box.boxType)}</td><td>${utils.esc(box.lines.map(item => `${lineContentLabel(item.line)} · ${item.required} ramos`).join(" / "))}</td><td><strong>${utils.esc(box.scanned)} / ${utils.esc(box.required)}</strong></td><td><span class="status-badge ${utils.badgeClass(box.status)}">${utils.esc(box.status)}</span></td></tr>`).join("") || `<tr><td colspan="5">El pedido no tiene cajas.</td></tr>`}
          </tbody></table></div>
          <p class="panel-note">Puede cambiar de caja aunque la seleccionada este incompleta. El avance queda guardado.</p>
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">CONTENIDO DE CAJA</p><h3>Caja ${utils.esc(selectedBox?.boxNumber || "-")} · ${utils.esc(selectedBox?.boxType || "-")}</h3></div>${selectedBox ? `<span class="status-badge ${utils.badgeClass(selectedBox.status)}">${utils.esc(selectedBox.status)}</span>` : ""}</div>
          ${selectedBox ? `<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Variedad / composicion real</th><th>Medida solicitada</th><th>T/R</th><th>Requeridos</th><th>Escaneados</th><th>Pendientes</th><th>Estado</th></tr></thead><tbody>${selectedBox.lines.map(item => `<tr><td><strong>${utils.esc(lineContentLabel(item.line))}</strong>${item.line.boxBuildMode === "MIXTO_ABIERTO" && item.line.mixedExcludedVarieties?.length ? `<br><small>Excluye: ${utils.esc(item.line.mixedExcludedVarieties.join(", "))}</small>` : ""}</td><td>${utils.esc(lineMeasureLabel(item.line))}</td><td>${utils.esc(item.line.stemsPerBunch)}</td><td>${utils.esc(item.required)}</td><td>${utils.esc(item.scanned)}</td><td>${utils.esc(item.pending)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-inline">Seleccione una caja.</div>`}
          <div class="ops-bunch-auto-reader ops-fast-dispatch-reader ${lastScan?.ok === true ? "is-success" : lastScan?.ok === false ? "is-error" : ""}" tabindex="0" role="status" aria-live="polite" data-ops-dispatch-reader-status>
            <span><i aria-hidden="true"></i>ZEBRA HID · LECTURA AUTOM&Aacute;TICA</span>
            <strong>${utils.esc(lastScan?.message || "LISTO PARA ESCANEAR")}</strong>
            <small>${lastScan?.ok ? "Lectura validada y guardada" : lastScan ? "Vuelva a escanear la etiqueta" : "Acerque la etiqueta; el c&oacute;digo no se mostrar&aacute; en pantalla"}</small>
          </div>
          <input class="sr-only" type="text" inputmode="none" maxlength="180" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus readonly aria-readonly="true" data-ops-dispatch-bunch-scan="true" value="" ${selectedBox?.automaticComplete ? "disabled" : ""} aria-label="Lector Zebra automático de Cuarto frío">
          ${lastScan?.warning ? `<div class="inline-feedback warning is-transient">${utils.esc(lastScan.warning)}</div>` : ""}
          ${summary.allBoxesComplete ? `<div class="inline-feedback success">Pedido completado. Todas las cajas quedaron completas automáticamente.</div>` : selectedBox?.automaticComplete ? `<div class="inline-feedback success">Caja completa automáticamente. Puede continuar con la siguiente caja.</div>` : `<p class="panel-note">Cada lectura actualiza inmediatamente la caja. Mientras falten ramos o cajas el estado será PEDIDO_INCOMPLETO; al terminar todo cambiará a PEDIDO_COMPLETADO.</p>`}
        </article>
      </section>
    `;
  }

  function renderDetailWindow(dispatch, appState, ui) {
    if (!dispatch) return "";
    const orderId = dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id;
    const active = ui.dispatchDetailTab || "boxes";
    const validation = BlessERP.operacionesDispatchDemo.validateDispatchReadinessDemo(appState, orderId);
    const progress = BlessERP.operacionesDispatchDemo.getDispatchProgressDemo(appState, orderId);
    let content = renderBunchAssembly(dispatch, appState, ui);
    if (active === "general") content = `<section class="placeholder-grid">${renderGeneral(dispatch)}</section>`;

    return `
      <section class="page-header">
        <div><p class="section-kicker">CUARTO FRÍO · ESCÁNER DE CAJAS</p><h1>${utils.esc(dispatch.numero_pedido || orderId)}</h1><p>${utils.esc(dispatch.cliente_principal || "-")} · ${utils.esc(dispatch.marca_cliente_final || "-")} · ${utils.esc(dispatch.destino || "-")}</p></div>
        <div class="page-header-side">${ui.dispatchReturnRoute ? `<button class="primary-button" type="button" data-ops-action="dispatch-return-order">Regresar al pedido</button>` : ""}<button class="secondary-button" type="button" data-ops-action="dispatch-back-list">Volver a cuarto frío</button>${statusBadge(progress.status)}</div>
      </section>
      <section class="hero-banner"><div><strong>Lectura de ramos asociada al pedido</strong><span>El lector ZEBRA funciona automaticamente en modo HID y valida cada ramo contra el contenido de la caja seleccionada.</span></div><span class="status-badge authorized">${utils.esc(dispatch.total_cajas || 0)} caja(s)</span></section>
      ${renderDetailTabs(active)}
      ${content}
    `;
  }

  function render(appState, route) {
    const ui = appState?.db?.operations?.ui || stateApi.getUi(appState);
    const dispatchService = BlessERP.operacionesDispatchDemo;

    if (ui.dispatchViewMode === "detail") {
      const selected = dispatchService?.getDispatchByOrderDemo?.(appState, ui.selectedDispatchOrderId) || null;
      if (selected) return `${utils.renderTabs(route)}${utils.renderNotice(ui)}${renderDetailWindow(selected, appState, ui)}`;
      ui.dispatchViewMode = "list";
      ui.selectedDispatchOrderId = "";
      ui.dispatchPreviewOrderId = "";
      ui.dispatchReturnRoute = "";
    }

    const allRows = dispatchService?.getDispatchListDemo
      ? dispatchService.getDispatchListDemo(appState)
      : dispatchService?.getDispatchesDemo?.(appState) || [];
    const filteredRows = applyFilters(allRows, ui);
    const summary = buildSummary(allRows);
    const previewDispatch = ui.dispatchPreviewOrderId
      ? dispatchService?.getDispatchByOrderDemo?.(appState, ui.dispatchPreviewOrderId) || null
      : null;
    const pagination = BlessERP.performance?.paginate?.(filteredRows, "operations-cold-room-orders", { pageSize: 30 })
      || { items: filteredRows.slice(0, 30), total: filteredRows.length, pageSize: 30 };
    const buildPage = () => `
      ${utils.renderPageHeader(route, "Historial de pedidos", "authorized", "Pulse Abrir escáner en el pedido que desea preparar.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner"><div><strong>Cuarto frío</strong><span>Esta bandeja conserva pedidos pendientes, incompletos y completos. El escáner se abre únicamente desde la acción del pedido.</span></div><span class="status-badge authorized">ZEBRA HID activo</span></section>
      ${utils.renderSummaryCards([
        { label: "Sin iniciar", value: utils.number(summary.pending), help: "Pendiente de escaneo" },
        { label: "Incompletos", value: utils.number(summary.preparing), help: "Faltan cajas o ramos" },
        { label: "Completados", value: utils.number(summary.ready), help: "Todas las cajas completas" },
        { label: "Actualizados", value: utils.number(summary.updated), help: "Cambios posteriores de Bodega" },
        { label: "Total cajas", value: utils.number(summary.totalBoxes), help: "Cajas disponibles en cuarto frío" }
      ])}
      ${renderFilters(allRows, ui)}
      ${renderCompactTable(pagination.items, appState, pagination)}
      ${renderBoxesPreviewModal(previewDispatch, appState)}
    `;
    return BlessERP.performance?.measureSync
      ? BlessERP.performance.measureSync("render:cuarto-frio-lista", buildPage, { total: allRows.length, visibles: pagination.items.length })
      : buildPage();
  }

  BlessERP.operacionesCuartoFrio = { render };
  BlessERP.operacionesDespacho = BlessERP.operacionesCuartoFrio;
})();
