(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function customerName(order) {
    return BlessERP.comercialUtils?.findCustomer?.(order.customerId)?.commercialName || order.customerId || "-";
  }

  function brandName(order) {
    return BlessERP.comercialUtils?.findBrand?.(order.brandId)?.name || order.brandId || "-";
  }

  function progressPercent(summary) {
    return summary.requiredBunches
      ? Math.round((summary.scannedBunches / summary.requiredBunches) * 100)
      : 0;
  }

  function renderCurrentOrders(rows, appState) {
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">PEDIDOS PARA PREPARAR</p>
            <h3>Pedidos enviados por Comercial</h3>
          </div>
          <span class="status-badge partial">${utils.esc(rows.length)} pedido(s)</span>
        </div>
        <p class="panel-note">Ordenados por fecha de liberacion. Abra el pedido para revisar sus cajas y continuar el trabajo en la pantalla operativa correspondiente.</p>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Orden de llegada</th><th>Pedido</th><th>Cliente / marca</th><th>Vuelo</th><th>Destino</th><th>Cajas</th><th>Ramos</th><th>Avance</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>
              ${rows.map((summary, index) => {
                const pendingChanges = BlessERP.comercialOrderFulfillment?.getPendingOrderChanges?.(appState, summary.order.id) || [];
                return `
                  <tr>
                    <td><strong>${utils.esc(index + 1)}</strong></td>
                    <td><strong>${utils.esc(summary.order.number)}</strong><br><small>${utils.esc(summary.order.warehouseReleasedAt || summary.order.issuedAt || "-")}</small></td>
                    <td>${utils.esc(customerName(summary.order))}<br><small>${utils.esc(brandName(summary.order))}</small></td>
                    <td>${utils.esc(summary.order.flightDate || "-")}</td>
                    <td>${utils.esc(summary.order.destination || "-")}</td>
                    <td>${utils.esc(summary.completeBoxes)} / ${utils.esc(summary.totalBoxes)}</td>
                    <td>${utils.esc(summary.scannedBunches)} / ${utils.esc(summary.requiredBunches)}</td>
                    <td><strong>${utils.esc(progressPercent(summary))}%</strong></td>
                    <td><span class="status-badge ${utils.badgeClass(summary.warehouseStatus)}">${utils.esc(summary.warehouseStatus)}</span>${pendingChanges.length ? `<br><small class="status-badge pending">NUEVA CAJA</small>` : ""}</td>
                    <td><button class="primary-button" data-ops-action="warehouse-open-order-detail" data-order-id="${utils.esc(summary.order.id)}">Ver pedido</button></td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="10">No hay pedidos pendientes enviados a Bodega.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderOrderHistory(rows) {
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL DE PEDIDOS</p>
            <h3>Pedidos completados en Bodega</h3>
          </div>
          <span class="status-badge authorized">${utils.esc(rows.length)} completado(s)</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Pedido</th><th>Cliente / marca</th><th>Destino</th><th>Cajas</th><th>Ramos utilizados</th><th>Completado</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>
              ${rows.map(summary => `
                <tr>
                  <td><strong>${utils.esc(summary.order.number)}</strong></td>
                  <td>${utils.esc(customerName(summary.order))}<br><small>${utils.esc(brandName(summary.order))}</small></td>
                  <td>${utils.esc(summary.order.destination || "-")}</td>
                  <td>${utils.esc(summary.totalBoxes)}</td>
                  <td>${utils.esc(summary.scannedBunches)}</td>
                  <td>${utils.esc(summary.order.warehouseCompletedAt || "-")}</td>
                  <td><span class="status-badge authorized">${utils.esc(summary.warehouseStatus)}</span></td>
                  <td><button class="secondary-button" data-ops-action="warehouse-open-order-detail" data-order-id="${utils.esc(summary.order.id)}">Consultar</button></td>
                </tr>
              `).join("") || `<tr><td colspan="8">Todavia no existen pedidos completados en el historial.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function render(appState, route) {
    const ui = stateApi.getUi(appState);
    const service = BlessERP.comercialOrderFulfillment;
    const allOrders = service?.getWarehouseOrders?.(appState) || [];
    const currentOrders = allOrders.filter(summary => summary.warehouseStatus !== "COMPLETO_BODEGA");
    const history = allOrders
      .filter(summary => summary.warehouseStatus === "COMPLETO_BODEGA")
      .sort((left, right) => String(right.order.warehouseCompletedAt || "").localeCompare(String(left.order.warehouseCompletedAt || "")));

    return `
      ${utils.renderPageHeader(route, "Bandeja de pedidos e historial de Bodega", "authorized")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner">
        <div>
          <strong>Bodega de rosas</strong>
          <span>Esta pantalla organiza pedidos enviados por Comercial y su historial. El escaneo de ramos no se realiza en este listado.</span>
        </div>
        <span class="status-badge partial">Modo local demo</span>
      </section>
      ${utils.renderSummaryCards([
        { label: "Pedidos pendientes", value: utils.number(currentOrders.length), help: "Por preparar o completar" },
        { label: "Cajas pendientes", value: utils.number(currentOrders.reduce((sum, item) => sum + Math.max(item.totalBoxes - item.completeBoxes, 0), 0)), help: "Segun el pedido comercial" },
        { label: "Ramos pendientes", value: utils.number(currentOrders.reduce((sum, item) => sum + item.pendingBunches, 0)), help: "Pendientes de colocar en cajas" },
        { label: "Pedidos completados", value: utils.number(history.length), help: "Disponibles en el historial" }
      ])}
      ${renderCurrentOrders(currentOrders, appState)}
      ${renderOrderHistory(history)}
    `;
  }

  BlessERP.operacionesBodega = { render };
})();
