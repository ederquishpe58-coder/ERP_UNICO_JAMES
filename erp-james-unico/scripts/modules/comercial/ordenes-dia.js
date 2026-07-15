(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;

  function render(appState) {
    const ui = stateApi.getUi(appState);
    const orders = stateApi.getOrders(appState);
    const availableDates = orders.map(item => item.issuedAt).filter(Boolean).sort();
    const selectedDate = ui.ordersDayDate || BlessERP.utils.today() || availableDates[availableDates.length - 1] || "";
    const rows = orders.filter(order => order.issuedAt === selectedDate);

    return `
      <section class="page-header">
        <div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>Ordenes del dia</h1><p>Lista compacta de ordenes comerciales. Ver orden abre una pantalla separada para cajas, lineas y escaneo de ramos.</p></div>
        <div class="page-header-side"><button class="primary-button" data-orders-day-new>Crear orden</button></div>
      </section>
      <section class="panel-card commercial-orders-day-toolbar">
        <label class="compact-inline-field"><span>Dia de ordenes</span><input type="date" value="${utils.esc(selectedDate)}" data-orders-day-date></label>
        <button class="secondary-button" data-route-link="commercial-order-history">Ver historial completo</button>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">ORDENES</p><h3>Ordenes registradas el ${utils.esc(utils.dateLabel(selectedDate))}</h3></div><span>${rows.length} orden(es)</span></div>
        <div class="compact-table-wrap"><table class="compact-table commercial-orders-day-table">
          <thead><tr><th>Orden</th><th>Cliente</th><th>Marca</th><th>Cajas</th><th>Cajas completas</th><th>Bunches</th><th>Escaneados</th><th>Pendientes</th><th>Estado armado</th><th>Estado comercial</th><th>Acciones</th></tr></thead>
          <tbody>${rows.map(order => {
            const progress = BlessERP.comercialOrderFulfillment.getOrderFulfillment(appState, order.id);
            const customer = utils.findCustomer(order.customerId);
            const brand = utils.findBrand(order.brandId);
            return `<tr>
              <td><strong>${utils.esc(order.number)}</strong></td>
              <td>${utils.esc(customer?.commercialName || "Sin cliente")}</td>
              <td>${utils.esc(brand?.name || "Sin marca")}</td>
              <td>${utils.number(progress?.totalBoxes)}</td>
              <td>${utils.number(progress?.confirmedBoxes)} / ${utils.number(progress?.totalBoxes)}</td>
              <td>${utils.number(progress?.requiredBunches)}</td>
              <td>${utils.number(progress?.scannedBunches)}</td>
              <td>${utils.number(progress?.pendingBunches)}</td>
              <td><span class="status-badge ${utils.badgeClass(progress?.orderFulfillmentStatus)}">${utils.esc(progress?.orderFulfillmentStatus || "EN_PROCESO")}</span></td>
              <td><span class="status-badge ${utils.badgeClass(order.status)}">${utils.esc(order.status)}</span></td>
              <td><div class="table-actions-inline"><button class="primary-button" data-orders-day-open="${utils.esc(order.id)}">Ver orden</button><button class="secondary-button" data-orders-day-edit="${utils.esc(order.id)}">Editar</button></div></td>
            </tr>`;
          }).join("") || `<tr><td colspan="11">No hay ordenes registradas para este dia.</td></tr>`}</tbody>
        </table></div>
      </section>
    `;
  }

  function bind(container, appState) {
    container.querySelector("[data-orders-day-date]")?.addEventListener("change", event => {
      stateApi.setOrdersDayDate(appState, event.target.value);
      BlessERP.layout.renderPage();
    });
    container.querySelector("[data-orders-day-new]")?.addEventListener("click", () => {
      stateApi.createNewOrder(appState);
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    });
    container.querySelectorAll("[data-orders-day-open]").forEach(button => button.addEventListener("click", () => {
      stateApi.setCurrentOrder(appState, button.dataset.ordersDayOpen);
      BlessERP.state.setRoute("commercial-order-detail");
      BlessERP.layout.renderApp();
    }));
    container.querySelectorAll("[data-orders-day-edit]").forEach(button => button.addEventListener("click", () => {
      stateApi.openOrder(appState, button.dataset.ordersDayEdit);
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    }));
  }

  BlessERP.comercialOrdersDay = { bind, render };
})();
