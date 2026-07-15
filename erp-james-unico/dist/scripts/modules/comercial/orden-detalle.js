(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;

  function isOpenMixedLine(line) {
    return String(line?.boxBuildMode || "").toUpperCase() === "MIXTO_ABIERTO";
  }

  function isAnyLengthLine(line) {
    return line?.anyLength === true || (isOpenMixedLine(line) && line?.mixedAnyLength !== false);
  }

  function actualComposition(line) {
    if (!isOpenMixedLine(line)) return "";
    const rows = Array.isArray(line.mixedActualComposition) ? line.mixedActualComposition : [];
    if (!rows.length) return "Pendiente: Bodega define variedad y medida";
    return rows.map(item => `${item.variety} ${item.length} cm: ${item.bunches} ramo(s)`).join(" · ");
  }

  function render(appState) {
    const order = stateApi.currentOrder(appState);
    if (!order) return `<section class="panel-card"><h2>No existe una orden seleccionada.</h2><button class="secondary-button" data-route-link="commercial-orders-day">Volver a ordenes</button></section>`;
    const summary = BlessERP.comercialOrderFulfillment.getOrderFulfillment(appState, order.id);
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);

    return `
      <section class="page-header">
        <div><p class="section-kicker">SEGUIMIENTO COMERCIAL</p><h1>${utils.esc(order.number)}</h1><p>${utils.esc(customer?.commercialName || "Sin cliente")} · ${utils.esc(brand?.name || "Sin marca")} · ${utils.esc(order.destination || "Sin destino")}</p></div>
        <div class="page-header-side"><button class="secondary-button" data-route-link="commercial-orders-day">Volver</button><button class="secondary-button" data-order-detail-edit>Editar en Pedido Maestro</button><button class="primary-button" data-order-detail-open-warehouse>Abrir en Bodega</button></div>
      </section>
      <section class="hero-banner"><div><strong>Seguimiento de armado</strong><span>Comercial define y monitorea la orden. El escaneo y cierre de cajas se realizan en Operaciones / Bodega de rosas.</span></div><span class="status-badge ${utils.badgeClass(summary.warehouseStatus)}">${utils.esc(summary.warehouseStatus)}</span></section>
      <section class="summary-grid">
        <article class="summary-card"><span>Cajas</span><strong>${summary.totalBoxes}</strong><small>${summary.closedBoxes} cerradas en Bodega</small></article>
        <article class="summary-card"><span>Ramos solicitados</span><strong>${summary.requiredBunches}</strong><small>Demanda del pedido</small></article>
        <article class="summary-card"><span>Ramos escaneados</span><strong>${summary.scannedBunches}</strong><small>Asignados fisicamente</small></article>
        <article class="summary-card"><span>Ramos pendientes</span><strong>${summary.pendingBunches}</strong><small>Sin reserva previa</small></article>
      </section>
      <section class="commercial-order-boxes">${summary.boxes.map(box => `
        <details class="panel-card commercial-order-box" open>
          <summary><strong>Caja ${box.boxNumber} · ${utils.esc(box.boxType)}</strong><span>${box.scanned}/${box.required} ramos</span><span class="status-badge ${utils.badgeClass(box.status)}">${utils.esc(box.status)}</span></summary>
          <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Variedad / composicion real</th><th>Medida solicitada</th><th>Tallos/ramo</th><th>Solicitados</th><th>Escaneados</th><th>Pendientes</th><th>Estado</th></tr></thead><tbody>${box.lines.map(item => `<tr><td><strong>${utils.esc(item.line.variety)}</strong>${actualComposition(item.line) ? `<br><small class="master-mix-actual">${utils.esc(actualComposition(item.line))}</small>` : ""}</td><td>${utils.esc(isAnyLengthLine(item.line) ? "CUALQUIER MEDIDA" : `${utils.number(item.line.length)} cm`)}</td><td>${utils.number(item.line.stemsPerBunch)}</td><td>${utils.number(item.required)}</td><td>${utils.number(item.scanned)}</td><td>${utils.number(item.pending)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td></tr>`).join("")}</tbody></table></div>
        </details>
      `).join("") || `<article class="panel-card">La orden no tiene cajas.</article>`}</section>
    `;
  }

  function bind(container, appState) {
    const order = stateApi.currentOrder(appState);
    if (!order) return;
    container.querySelector("[data-order-detail-edit]")?.addEventListener("click", () => {
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    });
    container.querySelector("[data-order-detail-open-warehouse]")?.addEventListener("click", () => {
      BlessERP.operacionesState?.setUiValue?.(appState, "warehouseOrderId", order.id);
      BlessERP.state.setRoute("operations-warehouse");
      BlessERP.layout.renderApp();
    });
  }

  BlessERP.comercialOrderDetail = { bind, render };
})();
