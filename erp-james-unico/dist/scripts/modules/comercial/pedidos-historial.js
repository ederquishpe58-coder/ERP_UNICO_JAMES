(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;
  const data = BlessERP.comercialData;

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function matchesRange(order, ui) {
    const issuedAt = String(order.issuedAt || "");
    if (ui.historyDateFrom && (!issuedAt || issuedAt < ui.historyDateFrom)) return false;
    if (ui.historyDateTo && (!issuedAt || issuedAt > ui.historyDateTo)) return false;
    return true;
  }

  function matchesFilters(order, appState) {
    const ui = stateApi.getUi(appState);
    const search = normalizeText(ui.historySearch);
    const status = String(ui.historyStatus || "TODOS").toUpperCase();
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);
    const metrics = utils.getOrderMetrics(order);

    if (!matchesRange(order, ui)) return false;
    if (ui.historyCustomerId && order.customerId !== ui.historyCustomerId) return false;
    if (ui.historyBrandId && order.brandId !== ui.historyBrandId) return false;
    if (ui.historyStatus && status !== "TODOS" && String(order.status || "").toUpperCase() !== status) return false;
    if (ui.historyDestination && normalizeText(order.destination) !== normalizeText(ui.historyDestination)) return false;
    if (ui.historyDae && !normalizeText(order.daeNumber).includes(normalizeText(ui.historyDae))) return false;
    if (ui.historyBoxType && !metrics.lines.some(line => String(line.boxType || "").toUpperCase() === String(ui.historyBoxType || "").toUpperCase())) return false;
    if (ui.historyPo) {
      const poNeedle = normalizeText(ui.historyPo);
      const orderPo = normalizeText(order.generalPo);
      const lineHasPo = metrics.lines.some(line => normalizeText(line.po).includes(poNeedle));
      if (!orderPo.includes(poNeedle) && !lineHasPo) return false;
    }

    if (!search) return true;

    return [
      order.number,
      order.issuedAt,
      order.flightDate,
      customer?.commercialName,
      brand?.name,
      order.destination,
      order.daeNumber,
      order.awb,
      order.hawb,
      metrics.lines.map(line => line.po).join(" ")
    ].some(value => normalizeText(value).includes(search));
  }

  function filteredOrders(appState) {
    return stateApi.getOrders(appState)
      .map(order => utils.normalizeOrder(order))
      .filter(order => matchesFilters(order, appState));
  }

  function openDocument(order, docCode, appState, options = {}, autoPrint = false) {
    const normalizedOrder = utils.normalizeOrder(order);
    const finalOptions = docCode === "ETIQUETAS"
      ? { ...(BlessERP.comercialLabels?.getCurrentSelection ? BlessERP.comercialLabels.getCurrentSelection(appState) : {}), ...options }
      : options;

    if (docCode === "ETIQUETAS" && BlessERP.comercialLabels?.validatePrintRequest) {
      const validation = BlessERP.comercialLabels.validatePrintRequest(normalizedOrder, appState, finalOptions);
      if (!validation.isValid) {
        BlessERP.layout.toast(validation.errors[0] || "No se puede imprimir etiquetas con la seleccion actual.");
        return false;
      }
    }

    const action = autoPrint ? "print" : "preview";
    const review = workflow.canExecuteDocumentAction(docCode, normalizedOrder, appState, action, finalOptions);
    if (!review.allowed) {
      const message = review.errors[0] || "El estado actual del pedido no permite esta accion.";
      workflow.recordEvent(order, appState, {
        action: "BLOQUEAR_DOCUMENTO",
        actionLabel: "Bloqueo documental",
        previousStatus: order.status,
        nextStatus: order.status,
        description: message,
        documentCode: docCode,
        documentLabel: data.printDocs.find(item => item.code === docCode)?.name || docCode,
        result: "bloqueado"
      });
      BlessERP.layout.toast(message);
      BlessERP.state.saveDb();
      return false;
    }

    const opened = BlessERP.comercialPrintSystem.openPreview(
      docCode,
      [normalizedOrder],
      appState,
      {
        autoPrint,
        options: finalOptions
      }
    );

    if (opened) {
      workflow.markDocumentActivity(order, appState, docCode, action, finalOptions);
      BlessERP.state.saveDb();
    }

    return opened;
  }

  function renderStatusOptions(selected) {
    const rows = ["TODOS", ...Object.keys(workflow.statusDefinitions)];
    return rows.map(item => `
      <option value="${utils.esc(item)}" ${item === String(selected || "TODOS") ? "selected" : ""}>${utils.esc(item)}</option>
    `).join("");
  }

  function render(appState) {
    const rows = filteredOrders(appState);
    const summary = workflow.buildPortfolioSummary(stateApi.getOrders(appState), appState);
    const reservations = stateApi.getReservations(appState);
    const usageRows = stateApi.getOrders(appState).map(order => utils.getReservationUsageSummary(order, reservations));
    const ordersWithReservations = usageRows.filter(item => item.activeCount > 0).length;
    const reservedBunches = usageRows.reduce((sum, item) => sum + item.reservedBunches, 0);
    const linesWithoutReservation = usageRows.reduce((sum, item) => sum + item.linesWithoutReservation, 0);
    const unusedReservationBunches = usageRows.reduce((sum, item) => sum + item.unusedBunches, 0);

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Pedidos / Historial</h1>
          <p>Historial comercial completo con filtros, estados, duplicado, anulacion demo, reapertura y acceso directo a documentos del Pedido Maestro.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Demo integrado</span>
        </div>
      </section>
      <section class="summary-grid">
        <article class="summary-card"><span>Pedidos borrador</span><strong>${utils.esc(summary.counts.BORRADOR)}</strong><small>Edicion abierta</small></article>
        <article class="summary-card"><span>Pedidos referenciales</span><strong>${utils.esc(summary.counts.REFERENCIAL)}</strong><small>Con advertencias</small></article>
        <article class="summary-card"><span>Pedidos validados</span><strong>${utils.esc(summary.counts.VALIDADO_COMERCIAL)}</strong><small>Revision comercial completa</small></article>
        <article class="summary-card"><span>Listos bodega</span><strong>${utils.esc(summary.counts.LISTO_BODEGA)}</strong><small>Bodega demo revisada</small></article>
        <article class="summary-card"><span>Listos despacho</span><strong>${utils.esc(summary.counts.LISTO_DESPACHO)}</strong><small>Salida documental demo</small></article>
        <article class="summary-card"><span>Despachados demo</span><strong>${utils.esc(summary.counts.DESPACHADO_DEMO)}</strong><small>Sin inventario real</small></article>
        <article class="summary-card"><span>Cerrados demo</span><strong>${utils.esc(summary.counts.CERRADO_DEMO)}</strong><small>Solo reimpresion</small></article>
        <article class="summary-card"><span>Anulados</span><strong>${utils.esc(summary.counts.ANULADO)}</strong><small>No se eliminan</small></article>
        <article class="summary-card"><span>Pedidos con reservas</span><strong>${utils.esc(ordersWithReservations)}</strong><small>Con enlace demo a Operaciones</small></article>
        <article class="summary-card"><span>Ramos reservados demo</span><strong>${utils.esc(utils.number(reservedBunches))}</strong><small>reservationContract activo</small></article>
        <article class="summary-card"><span>Lineas sin reserva</span><strong>${utils.esc(linesWithoutReservation)}</strong><small>No bloquea, pero queda advertido</small></article>
        <article class="summary-card"><span>Reservas sin usar</span><strong>${utils.esc(utils.number(unusedReservationBunches))}</strong><small>Ramos aun no pasados a cajas</small></article>
        <article class="summary-card"><span>Total USD periodo demo</span><strong>${utils.esc(utils.money(summary.totalUsd))}</strong><small>Todos los pedidos del historial</small></article>
        <article class="summary-card"><span>Cajas pendientes despacho</span><strong>${utils.esc(summary.pendingDispatchBoxes)}</strong><small>No incluyen anulados ni cerrados</small></article>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Alertas comerciales</strong>
          <span>${utils.esc(summary.alerts.length ? `${summary.alerts.length} alertas comerciales activas.` : "Sin alertas comerciales criticas en este momento.")}</span>
        </div>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">FILTROS</p>
              <h3>Busqueda avanzada</h3>
            </div>
          </div>
          <div class="commercial-filter-grid">
            <label class="compact-field">
              <span>Buscar pedido</span>
              <input id="commercial-history-search" type="search" value="${utils.esc(stateApi.getUi(appState).historySearch)}" placeholder="Pedido, cliente, marca, destino o DAE">
            </label>
            <label class="compact-field">
              <span>Fecha desde</span>
              <input id="commercial-history-date-from" type="date" value="${utils.esc(stateApi.getUi(appState).historyDateFrom)}">
            </label>
            <label class="compact-field">
              <span>Fecha hasta</span>
              <input id="commercial-history-date-to" type="date" value="${utils.esc(stateApi.getUi(appState).historyDateTo)}">
            </label>
            <label class="compact-field">
              <span>Cliente principal</span>
              <select id="commercial-history-customer">
                <option value="">Todos</option>
                ${data.customers.map(item => `<option value="${utils.esc(item.id)}" ${item.id === stateApi.getUi(appState).historyCustomerId ? "selected" : ""}>${utils.esc(item.commercialName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Marca</span>
              <select id="commercial-history-brand">
                <option value="">Todas</option>
                ${data.brands.map(item => `<option value="${utils.esc(item.id)}" ${item.id === stateApi.getUi(appState).historyBrandId ? "selected" : ""}>${utils.esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Destino</span>
              <select id="commercial-history-destination">
                <option value="">Todos</option>
                ${[...new Set(data.brands.map(item => item.destination))].map(item => `<option value="${utils.esc(item)}" ${item === stateApi.getUi(appState).historyDestination ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>DAE</span>
              <input id="commercial-history-dae" type="text" value="${utils.esc(stateApi.getUi(appState).historyDae)}" placeholder="055-2026...">
            </label>
            <label class="compact-field">
              <span>Estado</span>
              <select id="commercial-history-status">
                ${renderStatusOptions(stateApi.getUi(appState).historyStatus)}
              </select>
            </label>
            <label class="compact-field">
              <span>Tipo caja</span>
              <select id="commercial-history-box-type">
                <option value="">Todos</option>
                ${data.boxTypes.map(item => `<option value="${utils.esc(item.code)}" ${item.code === stateApi.getUi(appState).historyBoxType ? "selected" : ""}>${utils.esc(item.code)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>PO</span>
              <input id="commercial-history-po" type="text" value="${utils.esc(stateApi.getUi(appState).historyPo)}" placeholder="PO general o por linea">
            </label>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ALERTAS</p>
              <h3>Resumen comercial</h3>
            </div>
          </div>
          <div class="base-ready-list">
            ${summary.alerts.slice(0, 8).map(item => `
              <div class="base-ready-item">
                <strong>${utils.esc(item.orderNumber)}</strong>
                <span>${utils.esc(item.message)}</span>
              </div>
            `).join("") || `<div class="base-ready-item"><strong>Sin alertas</strong><span>El flujo comercial no muestra alertas activas.</span></div>`}
          </div>
        </article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Pedidos filtrados</h3>
          </div>
          <span class="status-badge partial">${utils.esc(rows.length)} pedidos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table">
            <thead>
              <tr>
                <th>Numero pedido</th>
                <th>Fecha emision</th>
                <th>Fecha vuelo</th>
                <th>Cliente principal</th>
                <th>Marca / cliente final</th>
                <th>Destino</th>
                <th>DAE</th>
                <th>AWB / HAWB</th>
                <th>Total cajas</th>
                <th>Total fulls</th>
                <th>Total tallos</th>
                <th>Total USD</th>
                <th>Reservas demo</th>
                <th>Ramos reservados</th>
                <th>Ramos sin usar</th>
                <th>Lineas sin reserva</th>
                <th>Estado disponibilidad</th>
                <th>Estado</th>
                <th>Estado contable</th>
                <th>Preview CxC</th>
                <th>Preview asiento</th>
                <th>Listo contabilidad</th>
                <th>Errores</th>
                <th>Advertencias</th>
                <th>Ultima accion</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(order => {
                const customer = utils.findCustomer(order.customerId);
                const brand = utils.findBrand(order.brandId);
                const metrics = utils.getOrderMetrics(order);
                const summaryRow = workflow.buildWorkflowSummary(order, appState);
                const accountingRow = BlessERP.comercialAccountingPreview.buildPreview(order, appState);
                const reservationUsage = utils.getReservationUsageSummary(order, reservations);
                const reservationState = reservationUsage.activeCount > 0
                  ? reservationUsage.unusedReservationCount > 0 || reservationUsage.linesWithoutReservation > 0
                    ? "CON_ADVERTENCIAS"
                    : "ENLAZADO_DEMO"
                  : "SIN_RESERVAS";
                return `
                  <tr>
                    <td>${utils.esc(order.number)}</td>
                    <td>${utils.esc(order.issuedAt || "-")}</td>
                    <td>${utils.esc(order.flightDate || "-")}</td>
                    <td>${utils.esc(customer?.commercialName || "-")}</td>
                    <td>${utils.esc(brand?.name || "-")}</td>
                    <td>${utils.esc(order.destination || "-")}</td>
                    <td>${utils.esc(order.daeNumber || "-")}</td>
                    <td>${utils.esc([order.awb || "-", order.hawb || "-"].join(" / "))}</td>
                    <td>${utils.esc(metrics.totalBoxes)}</td>
                    <td>${utils.esc(metrics.totalFulls.toFixed(2))}</td>
                    <td>${utils.esc(utils.number(metrics.totalStems))}</td>
                    <td>${utils.esc(utils.money(metrics.totalUsd))}</td>
                    <td>${utils.esc(reservationUsage.activeCount)}</td>
                    <td>${utils.esc(utils.number(reservationUsage.reservedBunches))}</td>
                    <td>${utils.esc(utils.number(reservationUsage.unusedBunches))}</td>
                    <td>${utils.esc(reservationUsage.linesWithoutReservation)}</td>
                    <td><span class="status-badge ${utils.badgeClass(reservationState)}">${utils.esc(reservationState)}</span></td>
                    <td><span class="status-badge ${utils.badgeClass(order.status)}">${utils.esc(order.status)}</span></td>
                    <td><span class="status-badge ${utils.badgeClass(order.accountingPreview?.state)}">${utils.esc(order.accountingPreview?.state || "NO_GENERADO")}</span></td>
                    <td>${utils.esc(order.accountingPreview?.cxcPreviewId ? "Si" : "No")}</td>
                    <td>${utils.esc(order.accountingPreview?.asientoPreviewId ? "Si" : "No")}</td>
                    <td>${utils.esc(order.accountingPreview?.state === "LISTO_PARA_CONTABILIZAR_FUTURO" ? "Si" : "No")}</td>
                    <td>${utils.esc(summaryRow.validation.errors.length)}</td>
                    <td>${utils.esc(summaryRow.validation.warnings.length)}</td>
                    <td>${utils.esc(summaryRow.latestAction?.actionLabel || "-")}</td>
                    <td>
                      <div class="table-actions-inline commercial-action-stack">
                        <button class="primary-button" data-commercial-open-order="${utils.esc(order.id)}">Ver orden</button>
                        <button class="secondary-button" data-commercial-print-order-doc="${utils.esc(order.id)}|INVOICE_PACKING_REFERENCIAL">Invoice</button>
                        <button class="secondary-button" data-commercial-print-order-doc="${utils.esc(order.id)}|COMMERCIAL_INVOICE_CLIENT">Factura cliente</button>
                        <button class="secondary-button" data-commercial-print-order-doc="${utils.esc(order.id)}|PACKING_LIST">Packing</button>
                        <button class="secondary-button" data-commercial-print-order-doc="${utils.esc(order.id)}|HR">HR</button>
                        <button class="secondary-button" data-commercial-print-order-doc="${utils.esc(order.id)}|MP">MP</button>
                        <button class="secondary-button" data-commercial-print-order-doc="${utils.esc(order.id)}|ETIQUETAS">Etiquetas</button>
                        <button class="secondary-button" data-commercial-open-tab="${utils.esc(order.id)}|warehouse">Bodega</button>
                        <button class="secondary-button" data-commercial-open-tab="${utils.esc(order.id)}|history">Ver historial</button>
                        <button class="secondary-button" data-commercial-open-tab="${utils.esc(order.id)}|future-accounting">Ver preview contable</button>
                        <button class="secondary-button" data-commercial-accounting-ready-order="${utils.esc(order.id)}" ${accountingRow.allowed ? "" : "disabled"}>Marcar listo contabilidad</button>
                        <button class="secondary-button" data-commercial-accounting-send-order="${utils.esc(order.id)}">Enviar a contabilidad</button>
                        <button class="secondary-button" data-commercial-duplicate-order="${utils.esc(order.id)}">Duplicar pedido</button>
                        <button class="secondary-button" data-commercial-order-status="${utils.esc(order.id)}|ANULADO">Anular</button>
                        <button class="secondary-button" data-commercial-order-status="${utils.esc(order.id)}|REABIERTO_DEMO">Reabrir</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="26">No hay pedidos para los filtros seleccionados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function bindFilter(container, id, field, appState) {
    container.querySelector(id)?.addEventListener("change", event => {
      stateApi.setHistoryFilter(appState, field, event.target.value);
      BlessERP.layout.renderPage();
    });
  }

  function bind(container, appState) {
    container.querySelector("#commercial-history-search")?.addEventListener("input", event => {
      stateApi.setHistorySearch(appState, event.target.value);
      BlessERP.layout.renderPage();
    });

    bindFilter(container, "#commercial-history-date-from", "historyDateFrom", appState);
    bindFilter(container, "#commercial-history-date-to", "historyDateTo", appState);
    bindFilter(container, "#commercial-history-customer", "historyCustomerId", appState);
    bindFilter(container, "#commercial-history-brand", "historyBrandId", appState);
    bindFilter(container, "#commercial-history-destination", "historyDestination", appState);
    bindFilter(container, "#commercial-history-dae", "historyDae", appState);
    bindFilter(container, "#commercial-history-status", "historyStatus", appState);
    bindFilter(container, "#commercial-history-box-type", "historyBoxType", appState);
    bindFilter(container, "#commercial-history-po", "historyPo", appState);

    container.querySelectorAll("[data-commercial-open-order]").forEach(button => button.addEventListener("click", () => {
      stateApi.openOrder(appState, button.dataset.commercialOpenOrder);
      BlessERP.state.setRoute("commercial-order-detail");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-duplicate-order]").forEach(button => button.addEventListener("click", () => {
      stateApi.duplicateOrder(appState, button.dataset.commercialDuplicateOrder);
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-print-order-doc]").forEach(button => button.addEventListener("click", () => {
      const [orderId, docCode] = String(button.dataset.commercialPrintOrderDoc || "").split("|");
      const order = stateApi.findOrder(appState, orderId);
      if (!order) return;
      const options = docCode === "COMMERCIAL_INVOICE_CLIENT"
        ? { ...BlessERP.comercialClientInvoice.getCurrentOptions(appState), mode: "REFERENCIAL" }
        : {};
      openDocument(order, docCode, appState, options, true);
    }));

    container.querySelectorAll("[data-commercial-open-tab]").forEach(button => button.addEventListener("click", () => {
      const [orderId, tabId] = String(button.dataset.commercialOpenTab || "").split("|");
      stateApi.openOrder(appState, orderId);
      stateApi.setOrderTab(appState, tabId);
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-order-status]").forEach(button => button.addEventListener("click", () => {
      const [orderId, targetStatus] = String(button.dataset.commercialOrderStatus || "").split("|");
      const reason = window.prompt(
        targetStatus === "ANULADO"
          ? "Motivo de anulacion del pedido:"
          : "Motivo de reapertura del pedido:",
        ""
      ) || "";
      if (!String(reason).trim()) return;
      stateApi.changeOrderStatusById(appState, orderId, targetStatus, reason);
      BlessERP.layout.renderPage();
    }));

    BlessERP.comercialAccountingPreview?.bind?.(container, appState);
  }

  BlessERP.comercialHistory = { bind, render };
})();
