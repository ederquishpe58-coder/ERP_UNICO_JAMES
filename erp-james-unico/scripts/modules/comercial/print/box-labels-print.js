(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateLabels(context, options = {}) {
    const documentData = BlessERP.comercialLabels.buildDocumentData(context.order, context.appState, options);
    context.preparedBoxLabelData = documentData;
    return {
      errors: [...documentData.errors],
      warnings: [...documentData.warnings]
    };
  }

  function renderLabels(context, options = {}) {
    const documentData = context.preparedBoxLabelData
      || BlessERP.comercialLabels.buildDocumentData(context.order, context.appState, options);
    return BlessERP.comercialLabels.renderPrintDocument(context.order, context.appState, options, documentData);
  }

  BlessERP.comercialPrintDocs.ETIQUETAS = {
    code: "ETIQUETAS",
    name: "Etiquetas de caja",
    description: "Etiqueta aduanera horizontal de 16 x 10 cm para Zebra ZD220, con margen de pagina 0 y a escala real.",
    validate: validateLabels,
    render: renderLabels
  };
})();
