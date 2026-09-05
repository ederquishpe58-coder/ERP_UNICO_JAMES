(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const labelData = BlessERP.comercialLabelData;
  const customsCode = BlessERP.comercialCustomsCode;
  const utils = BlessERP.comercialUtils;

  function dedupe(items) {
    return [...new Set((items || []).filter(Boolean))];
  }

  function getBoxGroups(order, preparedOrder = null) {
    const normalizedOrder = preparedOrder || utils.normalizeOrder(order);
    const printUtils = BlessERP.comercialPrintUtils;
    const baseMetrics = utils.getOrderMetrics(normalizedOrder);
    const metrics = printUtils?.buildPrintableMetrics
      ? printUtils.buildPrintableMetrics(baseMetrics)
      : baseMetrics;
    if (printUtils?.groupLinesByBox) return printUtils.groupLinesByBox(metrics.lines || []);

    const groups = new Map();
    (metrics.lines || []).forEach(line => {
      const boxNumber = Number(line.boxNumber || 0);
      if (!groups.has(boxNumber)) {
        groups.set(boxNumber, { boxNumber, boxType: line.boxType || "-", po: line.po || "", lines: [] });
      }
      groups.get(boxNumber).lines.push(line);
    });
    return [...groups.values()].sort((left, right) => left.boxNumber - right.boxNumber);
  }

  function getMaxBoxNumber(groups) {
    return (groups || []).reduce((highest, group) => Math.max(highest, Number(group.boxNumber || 0)), 0);
  }

  function normalizeSelection(order, rawSelection = {}, appState = null, preparedGroups = null) {
    const groups = preparedGroups || getBoxGroups(order);
    const totalBoxes = groups.length;
    const maxBoxNumber = getMaxBoxNumber(groups);
    const ui = rawSelection || {};
    const printType = labelData.printModes.some(item => item.id === (ui.printType || ui.labelPrintMode))
      ? (ui.printType || ui.labelPrintMode)
      : "all";
    const defaultUpper = Math.max(maxBoxNumber, 1);
    const fromBox = Math.max(1, Number(ui.fromBox ?? ui.labelFromBox ?? 1) || 1);
    const toBox = Math.max(1, Number(ui.toBox ?? ui.labelToBox ?? defaultUpper) || defaultUpper);
    const singleBox = Math.max(1, Number(ui.singleBox ?? ui.labelSingleBox ?? fromBox) || fromBox);
    const errors = [];
    const warnings = [];
    let selectedGroups = groups;

    if (!groups.length) {
      errors.push("No hay cajas para generar etiquetas.");
    } else if (printType === "range") {
      if (fromBox > toBox) {
        errors.push("Rango invalido: desde caja no puede ser mayor que hasta caja.");
      }
      selectedGroups = groups.filter(group => Number(group.boxNumber) >= fromBox && Number(group.boxNumber) <= toBox);
      if (!selectedGroups.length) {
        errors.push("El rango seleccionado no contiene cajas existentes.");
      }
    } else if (printType === "individual") {
      selectedGroups = groups.filter(group => Number(group.boxNumber) === singleBox);
      if (!selectedGroups.length) {
        errors.push("La caja individual seleccionada no existe.");
      }
    }

    return {
      printType,
      fromBox,
      toBox,
      singleBox,
      totalBoxes,
      maxBoxNumber,
      boxGroups: groups,
      selectedGroups,
      printCount: selectedGroups.length,
      errors: dedupe(errors),
      warnings,
      isValid: !errors.length
    };
  }

  function buildContentLines(group) {
    return (group?.lines || []).map(line => ({
      variety: line.variety || "-",
      length: Number(line.length || 0),
      quality: BlessERP.flowerQuality?.preserve?.(line.quality) || "",
      bunches: Number(line.bunches || 0),
      stemsPerBunch: Number(line.stemsPerBunch || 0),
      totalStems: Number(line.totalStems || 0)
    }));
  }

  function buildContentSummary(lines) {
    return (lines || [])
      .map(line => `${line.variety} ${line.length} cm / CALIDAD: ${BlessERP.flowerQuality?.label?.(line.quality) || "SIN CALIDAD"} / ${utils.number(line.bunches)} ramo / ${utils.number(line.totalStems)} tallos`)
      .join(" / ");
  }

  function buildScannerDemoCode(order, boxNumber) {
    const rawOrder = String(order.invoicePackingNumber || order.number || order.id || "PEDIDO").trim();
    const orderToken = rawOrder.replace(/[^0-9A-Z]/gi, "").toUpperCase() || "PEDIDO";
    if (BlessERP.operacionesCodeUtilsDemo?.buildBoxCodeDemo) {
      return BlessERP.operacionesCodeUtilsDemo.buildBoxCodeDemo(orderToken, boxNumber);
    }
    return `BOX-${orderToken}-${customsCode.padBoxNumber(boxNumber)}`;
  }

  function resolveRowState(order, brand, group, contentLines, boxProgress = null) {
    const errors = [];
    const warnings = [];
    const poValues = [...(group?.poValues || [])].filter(Boolean);
    const boxComplete = !boxProgress || boxProgress.automaticComplete || boxProgress.status === "CERRADA_BODEGA";
    const localSale = utils.isLocalOrder?.(order) || false;
    const invoiceNumber = BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order) || "";

    if (!Number(group?.boxNumber || 0)) errors.push("Caja sin numero.");
    if (!contentLines.length) errors.push("Caja sin contenido.");
    if (!order.number) errors.push("Falta secuencial unico del pedido.");
    if (!invoiceNumber) errors.push("Falta numero de factura. Guarde el pedido para reservar su secuencial antes de imprimir la etiqueta.");
    if (!localSale && !brand) errors.push("Falta marca / cliente final.");
    if (!localSale && !order.destination) errors.push("Falta destino.");
    if (!localSale && String(order.transportType || "").toLowerCase() === "aereo") {
      if (!order.daeNumber) errors.push("Falta DAE para generar el codigo de barras.");
      else if (!BlessERP.code128?.numericPayload(order.daeNumber)) errors.push("DAE invalida para generar el codigo de barras.");
      const awbDigits = utils.getAwbDigits ? utils.getAwbDigits(order.awb) : String(order.awb || "").replace(/\D/g, "");
      if (!order.awb) errors.push("Falta AWB para la etiqueta final.");
      else if (awbDigits.length !== 11) errors.push("AWB invalida: debe contener 3 digitos de aerolinea y 8 complementarios.");
      else if (!utils.findAirlineByAwb?.(order.awb)) errors.push(`Prefijo AWB ${awbDigits.slice(0, 3)} no parametrizado.`);
      if (!order.hawb) errors.push("Falta HAWB para la etiqueta final.");
    }
    if (!boxComplete) warnings.push("Caja aun no completada en Bodega; se permite imprimir la etiqueta anticipadamente para preparar el empaque.");

    if (brand?.requiresPo && !poValues.length) warnings.push("Falta PO cuando la marca lo requiere.");
    if (!order.flightDate) warnings.push("Falta fecha de vuelo.");
    if (order.labelReprintRequired) warnings.push(`Reimpresion requerida para revision R${Number(order.labelRevision || 1)}.`);

    let state = "LISTA";
    if (errors.some(item => item.includes("numero de factura"))) {
      state = "FALTA_FACTURA";
    } else if (errors.some(item => item.includes("numero"))) {
      state = "FALTA_NUMERO_CAJA";
    } else if (errors.some(item => item.includes("contenido"))) {
      state = "SIN_CONTENIDO";
    } else if (errors.some(item => item.includes("marca"))) {
      state = "FALTA_MARCA";
    } else if (errors.some(item => item.includes("destino"))) {
      state = "FALTA_DESTINO";
    } else if (errors.some(item => item.includes("DAE"))) {
      state = errors.some(item => item.includes("invalida")) ? "DAE_INVALIDA" : "FALTA_DAE";
    } else if (errors.some(item => item.includes("AWB") || item.includes("HAWB"))) {
      state = "FALTA_GUIAS";
    } else if (order.labelReprintRequired) {
      state = "REIMPRESION_REQUERIDA";
    } else if (warnings.some(item => item.includes("PO"))) {
      state = "ADVERTENCIA_PO";
    } else if (warnings.some(item => item.includes("no completada en Bodega"))) {
      state = "CAJA_INCOMPLETA";
    }

    return {
      errors: dedupe(errors),
      warnings: dedupe(warnings),
      state
    };
  }

  function buildLabelRows(order, appState, prepared = null) {
    const normalizedOrder = prepared?.normalizedOrder || utils.normalizeOrder(order);
    const brand = utils.findBrand(normalizedOrder.brandId);
    const customer = utils.findCustomer(normalizedOrder.customerId);
    const localSale = utils.isLocalOrder?.(normalizedOrder) || false;
    const agency = utils.findAgency(normalizedOrder.agencyId);
    const airline = utils.findAirline(normalizedOrder.airlineId);
    const groups = prepared?.groups || getBoxGroups(normalizedOrder, normalizedOrder);
    const totalBoxes = groups.length;
    const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, normalizedOrder.id);
    const fulfillmentByBox = new Map((fulfillment?.boxes || []).map(box => [Number(box.boxNumber), box]));

    return groups.map(group => {
      const contentLines = buildContentLines(group);
      const contentSummary = buildContentSummary(contentLines);
      const customs = customsCode.buildCustomsCode(normalizedOrder, group, totalBoxes);
      const status = resolveRowState(normalizedOrder, brand, group, contentLines, fulfillmentByBox.get(Number(group.boxNumber)) || null);
      const stateDefinition = labelData.statusDefinitions[status.state] || labelData.statusDefinitions.LISTA;
      const boxNumber = Number(group.boxNumber || 0);
      const po = [...(group.poValues || [])].join(", ") || normalizedOrder.generalPo || "";

      return {
        pedido_id: normalizedOrder.id,
        pedido_numero: normalizedOrder.number,
        box_id: `${normalizedOrder.id}-${customsCode.padBoxNumber(boxNumber)}`,
        numero_caja: boxNumber,
        total_cajas: totalBoxes,
        tipo_caja: group.boxType || "-",
        marca: localSale
          ? (customer?.legalName || customer?.commercialName || "CLIENTE LOCAL")
          : (brand?.name || ""),
        po,
        destino: normalizedOrder.destination || "",
        pais: normalizedOrder.destinationCountry || (localSale ? customer?.country || "ECUADOR" : brand?.country) || "",
        transport_type: String(normalizedOrder.transportType || "").toLowerCase(),
        dae: normalizedOrder.daeNumber || "",
        dae_barcode: BlessERP.code128?.numericPayload(normalizedOrder.daeNumber) || "",
        awb: normalizedOrder.awb || "",
        hawb: normalizedOrder.hawb || "",
        fecha_vuelo: normalizedOrder.flightDate || "",
        agencia_carga: localSale ? "NO APLICA" : agency?.name || "",
        cuarto_frio: normalizedOrder.coldRoom || agency?.coldRoom || "",
        carrier: airline?.name || "",
        vuelo: normalizedOrder.flightNumber || "",
        invoice_packing_no: BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(normalizedOrder) || "",
        invoice_no: BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(normalizedOrder) || "",
        packing_list_no: normalizedOrder.packingListNumber || "",
        sri_invoice_no: normalizedOrder.sriInvoiceNumber || "",
        contenido_resumido: contentSummary,
        contenido_lineas: contentLines,
        codigo_aduana: customs.value,
        codigo_aduana_note: customs.note,
        codigo_scanner_demo: buildScannerDemoCode(normalizedOrder, boxNumber),
        revision_etiqueta: Number(normalizedOrder.labelRevision || 1),
        reimpresion_requerida: Boolean(normalizedOrder.labelReprintRequired),
        barcode_value: BlessERP.code128?.numericPayload(normalizedOrder.daeNumber) || "",
        estado: status.state,
        badgeTone: stateDefinition.tone,
        estado_label: stateDefinition.label,
        errors: status.errors,
        warnings: dedupe([...status.warnings, ...customs.issues.map(item => `Codigo aduana: ${item}`)]),
      observacion: normalizedOrder.notes || "Etiqueta demo preparada desde Crear pedido.",
        total_ramos: Number(group.totalBunches || 0),
        total_tallos: Number(group.totalStems || 0)
      };
    });
  }

  function buildSummary(rows, selection) {
    return {
      totalBoxes: rows.length,
      generatedCount: rows.length,
      withDaeCount: rows.filter(row => row.dae).length,
      withoutPoCount: rows.filter(row => !row.po).length,
      readyCount: rows.filter(row => !row.errors.length).length,
      warningCount: rows.filter(row => row.warnings.length).length,
      blockedCount: rows.filter(row => row.errors.length).length,
      selectedCount: selection?.printCount || 0
    };
  }

  function buildDocumentData(order, appState, rawOptions = {}) {
    const normalizedOrder = utils.normalizeOrder(order);
    const groups = getBoxGroups(normalizedOrder, normalizedOrder);
    const rows = buildLabelRows(normalizedOrder, appState, { normalizedOrder, groups });
    const selection = normalizeSelection(normalizedOrder, rawOptions, appState, groups);
    const rowMap = new Map(rows.map(row => [Number(row.numero_caja), row]));
    const selectedRows = selection.selectedGroups
      .map(group => rowMap.get(Number(group.boxNumber)))
      .filter(Boolean);
    const errors = dedupe([
      ...selection.errors,
      ...selectedRows.flatMap(row => row.errors)
    ]);
    const warnings = dedupe([
      ...selection.warnings,
      ...selectedRows.flatMap(row => row.warnings)
    ]);

    return {
      errors,
      rows,
      selectedRows,
      selection,
      summary: buildSummary(rows, selection),
      warnings
    };
  }

  function getCurrentSelection(appState) {
    const ui = BlessERP.comercialState?.getUi ? BlessERP.comercialState.getUi(appState) : {};
    return {
      printType: ui?.labelPrintMode || "all",
      fromBox: Number(ui?.labelFromBox || 1),
      toBox: Number(ui?.labelToBox || 1),
      singleBox: Number(ui?.labelSingleBox || 1)
    };
  }

  function resolveOptions(order, appState, rawOptions = {}) {
    const selection = {
      ...getCurrentSelection(appState),
      ...rawOptions
    };
    return normalizeSelection(order, selection, appState);
  }

  function validatePrintRequest(order, appState, rawOptions = {}) {
    const documentData = buildDocumentData(order, appState, rawOptions);
    return {
      errors: documentData.errors,
      isValid: !documentData.errors.length,
      selection: documentData.selection,
      warnings: documentData.warnings
    };
  }

  BlessERP.comercialLabelsUtils = {
    buildContentLines,
    buildContentSummary,
    buildDocumentData,
    buildLabelRows,
    buildScannerDemoCode,
    buildSummary,
    getBoxGroups,
    getCurrentSelection,
    normalizeSelection,
    resolveOptions,
    validatePrintRequest
  };
})();
