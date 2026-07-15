(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const previewUtils = BlessERP.comercialAccountingPreviewUtils;

  function buildCxcPreview(order, appState) {
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);
    const totals = previewUtils.buildCommercialTotals(order);
    const ids = previewUtils.buildPreviewIds(order);
    const state = previewUtils.ensurePreviewStore(order);
    const issueDate = order.issuedAt || BlessERP.utils.today();
    const dueDate = order.expireDate
      || previewUtils.addDays(issueDate, Number(customer?.creditDays || 0))
      || issueDate;

    return {
      id: state.cxcPreviewId || ids.cxcPreviewId,
      customerId: customer?.id || "",
      customerName: customer?.commercialName || "",
      brandName: brand?.name || "",
      documentLabel: "Factura Comercial Cliente demo",
      documentNumber: order.clientInvoiceNumber || "",
      issueDate,
      dueDate,
      total: totals.totalUsd,
      balance: totals.totalUsd,
      state: previewUtils.normalizePreviewState(state.state),
      realPortfolioStatus: "pendiente",
      observation: "Preview de cuenta por cobrar. No genera cartera real."
    };
  }

  BlessERP.comercialAccountingPreviewCxc = {
    buildCxcPreview
  };
})();
