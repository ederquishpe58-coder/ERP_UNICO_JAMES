(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;
  const previewUtils = BlessERP.comercialAccountingPreviewUtils;
  const cxcApi = BlessERP.comercialAccountingPreviewCxc;
  const journalApi = BlessERP.comercialAccountingPreviewJournal;

  function buildWarnings(accounts, costCenter) {
    const warnings = [];
    if (!accounts.receivable.code) {
      warnings.push("No existe cuenta contable configurada para cuentas por cobrar clientes.");
    }
    if (!accounts.exportSales.code) {
      warnings.push("No existe cuenta contable configurada para ventas exportacion.");
    }
    if (!accounts.customerAdvances.code) {
      warnings.push("No existe cuenta contable preparada para anticipos de clientes.");
    }
    if (!accounts.withholdingReceivable.code) {
      warnings.push("No existe cuenta contable preparada para retenciones recibidas por cobrar.");
    }
    if (!costCenter.code) {
      warnings.push("No existe centro de costo sugerido para ventas exportacion.");
    }
    return warnings;
  }

  function buildErrors(order, customer, totals) {
    const errors = [];
    const status = workflow?.normalizeStatus
      ? workflow.normalizeStatus(order.status)
      : String(order.status || "").trim().toUpperCase();

    if (!previewUtils.isEligibleStatus(order)) {
      errors.push("El preview contable solo se permite desde VALIDADO_COMERCIAL en adelante.");
    }
    if (status === "ANULADO") {
      errors.push("No se puede generar preview contable para un pedido ANULADO.");
    }
    if (!customer) {
      errors.push("Falta cliente principal.");
    }
    if (!String(order.clientInvoiceNumber || "").trim()) {
      errors.push("Falta Factura Comercial Cliente demo.");
    }
    if (totals.totalUsd <= 0) {
      errors.push("Total USD cero.");
    }
    return errors;
  }

  function buildSalesAccountingContract(order, appState, preview) {
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);
    const metrics = utils.getOrderMetrics(order);
    const state = previewUtils.ensurePreviewStore(order);

    return {
      pedido_id: order.id,
      numero_pedido: order.number,
      invoice_cliente_id: order.id ? `${order.id}-CLIENT-INVOICE` : "",
      numero_invoice_cliente: order.clientInvoiceNumber || "",
      cliente_principal_id: customer?.id || "",
      cliente_principal_nombre: customer?.commercialName || "",
      marca_id: brand?.id || "",
      marca_nombre: brand?.name || "",
      fecha_emision: order.issuedAt || "",
      fecha_vuelo: order.flightDate || "",
      destino: order.destination || "",
      moneda: order.currency || "USD",
      total_cajas: metrics.totalBoxes,
      total_fulls: metrics.totalFulls,
      total_ramos: metrics.totalBunches,
      total_tallos: metrics.totalStems,
      subtotal: preview.totals.subtotal,
      descuento: preview.totals.discount,
      iva: preview.totals.iva,
      total_usd: preview.totals.totalUsd,
      cuenta_ingreso_sugerida: preview.accounts.exportSales.code || "",
      cuenta_cxc_sugerida: preview.accounts.receivable.code || "",
      centro_costo_sugerido: preview.costCenter.code || "",
      estado_comercial: workflow?.normalizeStatus ? workflow.normalizeStatus(order.status) : String(order.status || "").trim().toUpperCase(),
      estado_contable: state.state,
      asiento_preview_id: state.asientoPreviewId || preview.journal.id,
      cxc_preview_id: state.cxcPreviewId || preview.cxc.id,
      observacion: state.observation || preview.warnings[0] || "Preview contable demo preparado."
    };
  }

  function buildPreview(order, appState) {
    previewUtils.ensurePreviewStore(order);
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);
    const metrics = utils.getOrderMetrics(order);
    const totals = previewUtils.buildCommercialTotals(order);
    const accounts = previewUtils.resolveSuggestedAccounts(appState);
    const costCenter = previewUtils.resolveSuggestedCostCenter(order);
    const warnings = buildWarnings(accounts, costCenter);
    const errors = buildErrors(order, customer, totals);
    const cxc = cxcApi.buildCxcPreview(order, appState);
    const journal = journalApi.buildJournalPreview(order, appState);

    const preview = {
      orderSummary: {
        number: order.number,
        customerName: customer?.commercialName || "",
        brandName: brand?.name || "",
        destination: order.destination || "",
        issuedAt: order.issuedAt || "",
        flightDate: order.flightDate || "",
        totalBoxes: metrics.totalBoxes,
        totalStems: metrics.totalStems,
        totalUsd: totals.totalUsd,
        status: workflow?.normalizeStatus ? workflow.normalizeStatus(order.status) : String(order.status || "").trim().toUpperCase()
      },
      metrics,
      totals,
      customer,
      brand,
      accounts,
      costCenter,
      warnings,
      errors,
      cxc,
      journal
    };

    preview.contract = buildSalesAccountingContract(order, appState, preview);
    preview.allowed = !errors.length;
    preview.state = previewUtils.ensurePreviewStore(order).state;
    preview.definition = previewUtils.getPreviewDefinition(preview.state);
    return preview;
  }

  function generatePreview(order, appState) {
    const preview = buildPreview(order, appState);
    if (!preview.allowed) {
      return { ok: false, ...preview };
    }

    const state = previewUtils.ensurePreviewStore(order);
    const user = previewUtils.currentUser(appState);
    state.state = "PREVIEW";
    state.cxcPreviewId = preview.cxc.id;
    state.asientoPreviewId = preview.journal.id;
    state.generatedAt = previewUtils.nowIso();
    state.generatedBy = user.name || "Usuario demo";
    state.observation = preview.warnings[0] || "Preview contable generado sin afectar libros reales.";
    state.snapshot = {
      contract: preview.contract,
      cxc: preview.cxc,
      journal: preview.journal
    };

    return {
      ok: true,
      ...buildPreview(order, appState)
    };
  }

  function markReadyForFuture(order, appState) {
    const preview = buildPreview(order, appState);
    if (!preview.allowed) {
      return { ok: false, ...preview };
    }

    const state = previewUtils.ensurePreviewStore(order);
    if (state.state === "NO_GENERADO") {
      return {
        ok: false,
        ...preview,
        errors: ["Debe generar preview contable primero.", ...preview.errors]
      };
    }

    const user = previewUtils.currentUser(appState);
    state.state = "LISTO_PARA_CONTABILIZAR_FUTURO";
    state.readyAt = previewUtils.nowIso();
    state.readyBy = user.name || "Usuario demo";
    state.snapshot = state.snapshot || {
      contract: preview.contract,
      cxc: preview.cxc,
      journal: preview.journal
    };
    state.observation = state.observation || preview.warnings[0] || "Listo para contabilidad futura.";

    return {
      ok: true,
      ...buildPreview(order, appState)
    };
  }

  function buildPortfolioSummary(orders, appState) {
    const rows = (orders || []).map(order => {
      previewUtils.ensurePreviewStore(order);
      return {
        order,
        preview: buildPreview(order, appState)
      };
    });

    const withPreview = rows.filter(item => item.order.accountingPreview.state !== "NO_GENERADO").length;
    const readyForFuture = rows.filter(item => item.order.accountingPreview.state === "LISTO_PARA_CONTABILIZAR_FUTURO").length;
    const withoutPreview = rows.filter(item => item.preview.allowed && item.order.accountingPreview.state === "NO_GENERADO").length;
    const totalUsdPreview = rows
      .filter(item => item.order.accountingPreview.state !== "NO_GENERADO")
      .reduce((sum, item) => sum + Number(item.preview.totals.totalUsd || 0), 0);
    const pendingClientInvoices = rows.filter(item => (
      item.preview.allowed &&
      String(item.order.clientInvoiceNumber || "").trim() &&
      !["LISTO_PARA_CONTABILIZAR_FUTURO", "CONTABILIZADO_FUTURO"].includes(item.order.accountingPreview.state)
    )).length;

    return {
      withPreview,
      readyForFuture,
      withoutPreview,
      totalUsdPreview,
      pendingClientInvoices
    };
  }

  BlessERP.comercialAccountingPreviewModel = {
    buildPortfolioSummary,
    buildPreview,
    buildSalesAccountingContract,
    generatePreview,
    markReadyForFuture
  };
})();
