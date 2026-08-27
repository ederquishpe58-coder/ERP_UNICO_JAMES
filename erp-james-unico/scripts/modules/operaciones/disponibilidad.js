(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function render(appState) {
    BlessERP.operacionesAvailabilityPolicy?.synchronizeDueOrders?.(appState);
    return BlessERP.comercialAvailability.render(appState, { enableAvailabilityCopy: true });
  }

  function bind(container, appState) {
    BlessERP.comercialAvailability.bind(container, appState);
  }

  BlessERP.operacionesDisponibilidad = { render, bind };
})();
