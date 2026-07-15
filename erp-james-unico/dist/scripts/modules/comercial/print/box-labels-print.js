(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateLabels(context, options = {}) {
    const documentData = BlessERP.comercialLabels.buildDocumentData(context.order, context.appState, options);
    return {
      errors: [...documentData.errors],
      warnings: [...documentData.warnings]
    };
  }

  function renderLabels(context, options = {}) {
    const documentData = BlessERP.comercialLabels.buildDocumentData(context.order, context.appState, options);
    return BlessERP.comercialLabels.renderPrintDocument(context.order, context.appState, options, documentData);
  }

  BlessERP.comercialPrintDocs.ETIQUETAS = {
    code: "ETIQUETAS",
    name: "Etiquetas de caja",
    description: "Etiquetas demo por caja con codigo aduana placeholder, barcode / QR visual y filtros por rango.",
    validate: validateLabels,
    render: renderLabels
  };
})();
