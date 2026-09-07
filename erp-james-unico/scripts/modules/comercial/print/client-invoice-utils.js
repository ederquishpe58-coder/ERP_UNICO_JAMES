(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;

  function getCurrentOptions(appState) {
    const ui = BlessERP.comercialState?.getUi
      ? BlessERP.comercialState.getUi(appState)
      : {};
    return {
      mode: "REFERENCIAL",
      viewMode: ["grouped", "detailed"].includes(ui?.clientInvoiceViewMode) ? ui.clientInvoiceViewMode : "grouped",
      showCustomer: ui?.clientInvoiceShowCustomer !== false,
      showBrand: ui?.clientInvoiceShowBrand !== false
    };
  }

  function resolveOptions(appState, rawOptions = {}) {
    const base = getCurrentOptions(appState);
    return {
      ...base,
      ...rawOptions,
      mode: rawOptions.mode === "REAL_DEMO" ? "REAL_DEMO" : (rawOptions.mode || base.mode || "REFERENCIAL"),
      viewMode: rawOptions.viewMode === "detailed" ? "detailed" : (rawOptions.viewMode || base.viewMode || "grouped"),
      showCustomer: rawOptions.showCustomer === undefined ? base.showCustomer : Boolean(rawOptions.showCustomer),
      showBrand: rawOptions.showBrand === undefined ? base.showBrand : Boolean(rawOptions.showBrand)
    };
  }

  function buildInvoiceNumber(order) {
    return BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order) || "";
  }

  function getInvoiceMetrics(order) {
    const metrics = utils.getOrderMetrics(order);
    return BlessERP.comercialPrintUtils?.buildPrintableMetrics
      ? BlessERP.comercialPrintUtils.buildPrintableMetrics(metrics)
      : metrics;
  }

  function normalizeGroupedRows(lines, order) {
    const groups = new Map();
    (lines || []).forEach(line => {
      const po = String(line.po || order.generalPo || "").trim();
      const boxType = String(line.boxType || "").trim().toUpperCase() || "-";
      const quality = BlessERP.flowerQuality?.preserve?.(line.quality) || "";
      const key = [boxType, line.variety, line.length, quality, line.stemsPerBunch, Number(line.unitPrice || 0).toFixed(4), po].join("|");
      if (!groups.has(key)) {
        groups.set(key, {
          type: boxType,
          description: line.variety,
          quality,
          length: line.length,
          bunches: 0,
          stemsPerBunch: line.stemsPerBunch,
          totalStems: 0,
          unitPrice: Number(line.unitPrice || 0),
          totalUsd: 0,
          po,
          boxes: new Set()
        });
      }
      const target = groups.get(key);
      target.bunches += Number(line.bunches || 0);
      target.totalStems += Number(line.totalStems || 0);
      target.totalUsd += Number(line.totalLine || 0);
      target.boxes.add(Number(line.boxNumber || 0));
    });

    return [...groups.values()]
      .sort((left, right) => {
        if (left.description !== right.description) return left.description.localeCompare(right.description);
        if (left.length !== right.length) return Number(left.length) - Number(right.length);
        return left.unitPrice - right.unitPrice;
      })
      .map((row, index) => ({
        item: index + 1,
        type: row.type,
        description: row.description,
        quality: row.quality,
        length: row.length,
        bunches: row.bunches,
        stemsPerBunch: row.stemsPerBunch,
        totalStems: row.totalStems,
        unitPrice: row.unitPrice,
        totalUsd: row.totalUsd,
        po: row.po,
        boxLabel: `${row.boxes.size} caja(s)`
      }));
  }

  function normalizeDetailedRows(lines, order) {
    return (lines || []).map((line, index) => ({
      item: index + 1,
      type: String(line.boxType || "").trim().toUpperCase() || "-",
      description: `Caja ${line.boxNumber} ${line.boxType} · ${line.variety}`,
      quality: BlessERP.flowerQuality?.preserve?.(line.quality) || "",
      length: line.length,
      bunches: Number(line.bunches || 0),
      stemsPerBunch: Number(line.stemsPerBunch || 0),
      totalStems: Number(line.totalStems || 0),
      unitPrice: Number(line.unitPrice || 0),
      totalUsd: Number(line.totalLine || 0),
      po: String(line.po || order.generalPo || "").trim(),
      boxLabel: `Caja ${line.boxNumber}`
    }));
  }

  function buildRows(order, options, preparedMetrics = null) {
    const metrics = preparedMetrics || getInvoiceMetrics(order);
    return options.viewMode === "detailed"
      ? normalizeDetailedRows(metrics.lines, order)
      : normalizeGroupedRows(metrics.lines, order);
  }

  function buildDocumentState(order, validation, options) {
    const status = String(order?.status || "").toUpperCase();
    if (status === "ANULADO") return "ANULADO";
    if (options.mode === "SRI_FUTURO") return "SRI_FUTURO";
    if (validation.errors.length) return "BORRADOR";
    if (
      options.mode === "REAL_DEMO" ||
      ["VALIDADO_COMERCIAL", "LISTO_BODEGA", "LISTO_DESPACHO", "DESPACHADO_DEMO", "CERRADO_DEMO"].includes(status)
    ) {
      return "VALIDADO_INTERNO";
    }
    if (["REFERENCIAL", "REABIERTO_DEMO"].includes(status) || options.mode === "REFERENCIAL") return "REFERENCIAL";
    return "BORRADOR";
  }

  function validatePrepared(normalizedOrder, options, customer, brand, metrics) {
    const localSale = utils.isLocalOrder?.(normalizedOrder) || false;
    const errors = [];
    const warnings = [];

    if (!buildInvoiceNumber(normalizedOrder)) errors.push("Falta numero de factura. Solicite el documento para confirmar o reservar su número de factura.");
    if (!customer) errors.push("Falta cliente principal.");
    if (!localSale && options.showBrand && !brand) errors.push("Falta marca / cliente final.");
    if (!localSale && (options.showBrand || normalizedOrder.transportType === "aereo") && !normalizedOrder.destination) {
      errors.push("Falta marca / destino configurado como obligatorio.");
    }
    if (!normalizedOrder.issuedAt) errors.push("Falta fecha emision.");
    if (!metrics.lines.length) errors.push("Falta detalle de cajas / productos.");
    if (metrics.totalUsd <= 0) errors.push("Total USD cero.");
    if (metrics.lines.some(line => Number(line.unitPrice || 0) <= 0)) errors.push("Falta precio unitario.");
    if (!String(normalizedOrder.currency || "").trim()) errors.push("Falta moneda.");

    if (!localSale && normalizedOrder.transportType === "aereo" && !normalizedOrder.awb) warnings.push("Falta AWB.");
    if (!localSale && normalizedOrder.transportType === "aereo" && !normalizedOrder.hawb) warnings.push("Falta HAWB.");
    if (!localSale && normalizedOrder.transportType === "aereo" && !normalizedOrder.daeNumber) warnings.push("Falta DAE.");
    if (!normalizedOrder.flightDate) warnings.push("Falta fecha vuelo.");
    if (!String(customer?.billingEmail || "").trim()) warnings.push("Falta correo cliente.");
    if (!String(normalizedOrder.paymentTerms || "").trim()) warnings.push("Falta condicion de pago.");
    warnings.push("Documento comercial para cliente. No corresponde a factura electronica autorizada por el SRI.");

    const state = buildDocumentState(normalizedOrder, { errors, warnings }, options);

    return {
      customer,
      brand,
      errors,
      warnings,
      state
    };
  }

  function validateDocument(order, appState, rawOptions = {}) {
    const normalizedOrder = utils.normalizeOrder(order);
    const options = resolveOptions(appState, rawOptions);
    const customer = utils.findCustomer(normalizedOrder.customerId);
    const brand = utils.findBrand(normalizedOrder.brandId);
    const metrics = getInvoiceMetrics(normalizedOrder);
    return validatePrepared(normalizedOrder, options, customer, brand, metrics);
  }

  function buildContract(order, appState, rawOptions = {}, prepared = null) {
    const normalizedOrder = prepared?.normalizedOrder || utils.normalizeOrder(order);
    const options = prepared?.options || resolveOptions(appState, rawOptions);
    const customer = prepared?.customer || utils.findCustomer(normalizedOrder.customerId);
    const brand = prepared?.brand || utils.findBrand(normalizedOrder.brandId);
    const metrics = prepared?.metrics || getInvoiceMetrics(normalizedOrder);
    const economics = prepared?.economics || utils.calculateOrderEconomics(normalizedOrder);
    const validation = prepared?.validation || validatePrepared(normalizedOrder, options, customer, brand, metrics);

    return {
      pedido_id: normalizedOrder.id,
      invoice_cliente_id: `${normalizedOrder.id}-CLIENT-INVOICE`,
      numero_invoice: buildInvoiceNumber(normalizedOrder),
      cliente_principal_id: customer?.id || "",
      cliente_principal_nombre: customer?.commercialName || "",
      marca_id: brand?.id || "",
      marca_nombre: brand?.name || "",
      fecha_emision: normalizedOrder.issuedAt || "",
      fecha_vuelo: normalizedOrder.flightDate || "",
      destino: normalizedOrder.destination || "",
      moneda: normalizedOrder.currency || "USD",
      total_cajas: metrics.totalBoxes,
      total_fulls: metrics.totalFulls,
      total_ramos: metrics.totalBunches,
      total_tallos: metrics.totalStems,
      subtotal_bruto_usd: economics.subtotal,
      descuento_porcentaje: economics.discountPercentage,
      descuento_usd: economics.discountAmount,
      total_usd: economics.netTotal,
      estado: validation.state,
      es_sri: false,
      sri_estado_futuro: "pendiente",
      observacion: normalizedOrder.notes || "Factura comercial cliente demo desde Crear pedido."
    };
  }

  function buildDocumentData(order, appState, rawOptions = {}) {
    const normalizedOrder = utils.normalizeOrder(order);
    const options = resolveOptions(appState, rawOptions);
    const customer = utils.findCustomer(normalizedOrder.customerId);
    const brand = utils.findBrand(normalizedOrder.brandId);
    const agency = utils.findAgency(normalizedOrder.agencyId);
    const airline = utils.findAirline(normalizedOrder.airlineId);
    const metrics = getInvoiceMetrics(normalizedOrder);
    const economics = utils.calculateOrderEconomics(normalizedOrder);
    const rows = buildRows(normalizedOrder, options, metrics);
    const validation = validatePrepared(normalizedOrder, options, customer, brand, metrics);
    const contract = buildContract(normalizedOrder, appState, options, {
      normalizedOrder,
      options,
      customer,
      brand,
      metrics,
      economics,
      validation
    });

    return {
      order: normalizedOrder,
      options,
      customer,
      brand,
      agency,
      airline,
      metrics,
      economics,
      rows,
      validation,
      contract,
      invoiceNumber: contract.numero_invoice
    };
  }

  BlessERP.comercialClientInvoiceUtils = {
    buildContract,
    buildDocumentData,
    buildInvoiceNumber,
    getCurrentOptions,
    resolveOptions,
    validateDocument
  };
})();
