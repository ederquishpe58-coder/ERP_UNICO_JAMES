(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const calculator = BlessERP.comercialPackagingCalculator;
  const view = BlessERP.comercialPackagingView;

  function calculateOrderRequirements(order, appState) {
    return calculator.calculateOrderRequirements(order, appState);
  }

  function renderWorkspace(order, appState) {
    return view.renderWorkspace(order, appState);
  }

  function renderReport(appState) {
    return view.renderReport(appState);
  }

  function buildPackagingRequirementContract(order, appState) {
    return calculator.calculateOrderRequirements(order, appState).contractRows;
  }

  BlessERP.comercialPackaging = {
    buildPackagingRequirementContract,
    calculateOrderRequirements,
    renderReport,
    renderWorkspace
  };

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};
  BlessERP.comercialPrintDocs.PACKAGING_REQUIREMENTS = {
    code: "PACKAGING_REQUIREMENTS",
    name: "Requerimiento de materiales / Bodega",
    description: "Documento demo interno para preparar materiales de empaque del pedido.",
    validate(context) {
      const result = calculator.calculateOrderRequirements(context.order, context.appState);
      const warnings = [...result.warnings];
      if (!result.requirements.length) warnings.unshift("No hay materiales calculados para este pedido.");
      return { errors: [], warnings };
    },
    render(context) {
      return view.renderPrintDocument(context.order, context.appState);
    }
  };
})();
