(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const previewUtils = BlessERP.comercialAccountingPreviewUtils;

  function buildJournalPreview(order, appState) {
    const totals = previewUtils.buildCommercialTotals(order);
    const accounts = previewUtils.resolveSuggestedAccounts(appState);
    const costCenter = previewUtils.resolveSuggestedCostCenter(order);
    const ids = previewUtils.buildPreviewIds(order);
    const state = previewUtils.ensurePreviewStore(order);
    const period = previewUtils.settings().activePeriod || order.issuedAt?.slice(0, 7) || "";

    const debitLine = {
      accountCode: accounts.receivable.code,
      accountName: accounts.receivable.name,
      debit: totals.totalUsd,
      credit: 0,
      costCenter: costCenter.code,
      auxiliary: order.customerId || "",
      description: `CxC comercial demo ${order.clientInvoiceNumber || order.number}`
    };

    const creditLine = {
      accountCode: accounts.exportSales.code,
      accountName: accounts.exportSales.name,
      debit: 0,
      credit: totals.totalUsd,
      costCenter: costCenter.code,
      auxiliary: order.brandId || "",
      description: `Venta exportacion demo ${order.clientInvoiceNumber || order.number}`
    };

    return {
      id: state.asientoPreviewId || ids.asientoPreviewId,
      accountingDate: order.issuedAt || BlessERP.utils.today(),
      accountingPeriod: period,
      concept: `Preview comercial ${order.number}`,
      state: previewUtils.normalizePreviewState(state.state),
      lines: [debitLine, creditLine],
      debitTotal: totals.totalUsd,
      creditTotal: totals.totalUsd,
      difference: previewUtils.round2(totals.totalUsd - totals.totalUsd),
      observation: "Este asiento es solo una vista previa. No afecta Libro Diario ni Mayor General."
    };
  }

  BlessERP.comercialAccountingPreviewJournal = {
    buildJournalPreview
  };
})();
