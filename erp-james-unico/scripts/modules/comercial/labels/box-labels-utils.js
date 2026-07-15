(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const labelData = BlessERP.comercialLabelData;
  const customsCode = BlessERP.comercialCustomsCode;
  const utils = BlessERP.comercialUtils;

  function dedupe(items) {
    return [...new Set((items || []).filter(Boolean))];
  }

  function getBoxGroups(order) {
    const normalizedOrder = utils.normalizeOrder(order);
    const metrics = utils.getOrderMetrics(normalizedOrder);
    const printUtils = BlessERP.comercialPrintUtils;
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

  function normalizeSelection(order, rawSelection = {}, appState = null) {
    const groups = getBoxGroups(order);
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
      bunches: Number(line.bunches || 0),
      stemsPerBunch: Number(line.stemsPerBunch || 0),
      totalStems: Number(line.totalStems || 0)
    }));
  }

  function buildContentSummary(lines) {
    return (lines || [])
      .map(line => `${line.variety} ${line.length} cm / ${utils.number(line.bunches)} ramo / ${utils.number(line.totalStems)} tallos`)
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
    const aerial = String(order.transportType || "aereo").trim().toUpperCase() === "AEREO";
    const boxComplete = !boxProgress || boxProgress.automaticComplete || boxProgress.status === "CERRADA_BODEGA";

    if (!Number(group?.boxNumber || 0)) errors.push("Caja sin numero.");
    if (!contentLines.length) errors.push("Caja sin contenido.");
    if (!brand) errors.push("Falta marca / cliente final.");
    if (!order.destination) errors.push("Falta destino.");
    if (aerial && !order.daeNumber) errors.push("Falta DAE para transporte aereo.");
    const awbDigits = utils.getAwbDigits ? utils.getAwbDigits(order.awb) : String(order.awb || "").replace(/\D/g, "");
    if (!order.awb) errors.push("Falta AWB para la etiqueta final.");
    else if (awbDigits.length !== 11) errors.push("AWB invalida: debe contener 3 digitos de aerolinea y 8 complementarios.");
    else if (!utils.findAirlineByAwb?.(order.awb)) errors.push(`Prefijo AWB ${awbDigits.slice(0, 3)} no parametrizado.`);
    if (!order.hawb) errors.push("Falta HAWB para la etiqueta final.");
    if (!boxComplete) errors.push("Caja incompleta en Bodega; la etiqueta final aun no puede imprimirse.");

    if (brand?.requiresPo && !poValues.length) warnings.push("Falta PO cuando la marca lo requiere.");
    if (!order.flightDate) warnings.push("Falta fecha de vuelo.");
    if (order.labelReprintRequired) warnings.push(`Reimpresion requerida para revision R${Number(order.labelRevision || 1)}.`);
    warnings.push("Codigo aduana demo no validado oficialmente.");
    warnings.push("Barcode / QR real pendiente.");

    let state = "LISTA";
    if (errors.some(item => item.includes("numero"))) {
      state = "FALTA_NUMERO_CAJA";
    } else if (errors.some(item => item.includes("contenido"))) {
      state = "SIN_CONTENIDO";
    } else if (errors.some(item => item.includes("marca"))) {
      state = "FALTA_MARCA";
    } else if (errors.some(item => item.includes("destino"))) {
      state = "FALTA_DESTINO";
    } else if (errors.some(item => item.includes("DAE"))) {
      state = "FALTA_DAE";
    } else if (errors.some(item => item.includes("AWB") || item.includes("HAWB"))) {
      state = "FALTA_GUIAS";
    } else if (errors.some(item => item.includes("incompleta"))) {
      state = "CAJA_INCOMPLETA";
    } else if (order.labelReprintRequired) {
      state = "REIMPRESION_REQUERIDA";
    } else if (warnings.some(item => item.includes("PO"))) {
      state = "ADVERTENCIA_PO";
    }

    return {
      errors: dedupe(errors),
      warnings: dedupe(warnings),
      state
    };
  }

  function buildLabelRows(order, appState) {
    const normalizedOrder = utils.normalizeOrder(order);
    const brand = utils.findBrand(normalizedOrder.brandId);
    const agency = utils.findAgency(normalizedOrder.agencyId);
    const airline = utils.findAirline(normalizedOrder.airlineId);
    const groups = getBoxGroups(normalizedOrder);
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
        box_id: `${normalizedOrder.id}-${customsCode.padBoxNumber(boxNumber)}`,
        numero_caja: boxNumber,
        total_cajas: totalBoxes,
        tipo_caja: group.boxType || "-",
        marca: brand?.name || "",
        po,
        destino: normalizedOrder.destination || "",
        pais: normalizedOrder.destinationCountry || brand?.country || "",
        dae: normalizedOrder.daeNumber || "",
        awb: normalizedOrder.awb || "",
        hawb: normalizedOrder.hawb || "",
        fecha_vuelo: normalizedOrder.flightDate || "",
        agencia_carga: agency?.name || "",
        carrier: airline?.name || "",
        vuelo: normalizedOrder.flightNumber || "",
        invoice_packing_no: normalizedOrder.invoicePackingNumber || "",
        contenido_resumido: contentSummary,
        contenido_lineas: contentLines,
        codigo_aduana: customs.value,
        codigo_aduana_note: customs.note,
        codigo_scanner_demo: buildScannerDemoCode(normalizedOrder, boxNumber),
        revision_etiqueta: Number(normalizedOrder.labelRevision || 1),
        reimpresion_requerida: Boolean(normalizedOrder.labelReprintRequired),
        barcode_value_futuro: customsCode.buildBarcodeValue(normalizedOrder, group, totalBoxes),
        qr_value_futuro: customsCode.buildQrValue(normalizedOrder, group, totalBoxes),
        estado: status.state,
        badgeTone: stateDefinition.tone,
        estado_label: stateDefinition.label,
        errors: status.errors,
        warnings: dedupe([...status.warnings, ...customs.issues.map(item => `Codigo aduana: ${item}`)]),
        observacion: normalizedOrder.notes || "Etiqueta demo preparada desde Pedido Maestro.",
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
      readyCount: rows.filter(row => row.estado === "LISTA").length,
      warningCount: rows.filter(row => row.warnings.length).length,
      blockedCount: rows.filter(row => row.errors.length).length,
      selectedCount: selection?.printCount || 0
    };
  }

  function buildDocumentData(order, appState, rawOptions = {}) {
    const rows = buildLabelRows(order, appState);
    const selection = normalizeSelection(order, rawOptions, appState);
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
