(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;

  function render(appState) {
    return BlessERP.comercialPedidoDemandView.renderAvailability(null, appState, { standalone: true });
  }

  BlessERP.comercialAvailability = { render };
})();
