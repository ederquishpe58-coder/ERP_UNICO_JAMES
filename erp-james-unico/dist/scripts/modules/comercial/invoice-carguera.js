(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function resolveInvoiceDoc(modeLabel = "") {
    return String(modeLabel || "").toLowerCase().includes("real")
      ? "INVOICE_PACKING_REAL"
      : "INVOICE_PACKING_REFERENCIAL";
  }

  function renderInvoiceWorkspace(order, modeLabel = "Preview carguera", appState = BlessERP.state?.state) {
    const docCode = resolveInvoiceDoc(modeLabel);
    const alternateDocCode = docCode === "INVOICE_PACKING_REAL"
      ? "INVOICE_PACKING_REFERENCIAL"
      : "INVOICE_PACKING_REAL";

    return BlessERP.comercialPrintSystem.renderWorkspace(docCode, order, appState, {
      title: "Invoice / Packing carguera",
      description: "Vista comercial y logistica basada en el Pedido Maestro. No corresponde a factura cliente ni a SRI.",
      actionsMarkup: `
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-preview-doc="${docCode}">Vista previa ${docCode === "INVOICE_PACKING_REAL" ? "real demo" : "referencial"}</button>
          <button class="secondary-button" data-commercial-print-doc="${docCode}">Imprimir ${docCode === "INVOICE_PACKING_REAL" ? "real demo" : "referencial"}</button>
          <button class="secondary-button" data-commercial-preview-doc="${alternateDocCode}">Vista previa ${alternateDocCode === "INVOICE_PACKING_REAL" ? "real demo" : "referencial"}</button>
        </div>
      `
    });
  }

  function openPreview(docCode, orders, autoPrint = false, options = {}) {
    return BlessERP.comercialPrintSystem.openPreview(
      docCode,
      orders,
      BlessERP.state?.state,
      { autoPrint, options }
    );
  }

  function renderPreviewMarkup(docCode, orders, options = {}) {
    return BlessERP.comercialPrintSystem.renderPreviewMarkup(
      docCode,
      orders,
      BlessERP.state?.state,
      options
    );
  }

  BlessERP.comercialInvoice = {
    openPreview,
    renderInvoiceWorkspace,
    renderPreviewMarkup
  };
})();
