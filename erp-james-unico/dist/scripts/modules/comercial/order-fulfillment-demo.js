(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const OPEN_WAREHOUSE_STATUSES = new Set([
    "LIBERADO_BODEGA",
    "EN_ARMADO",
    "PARCIAL_FALTANTE",
    "ACTUALIZADO_POR_VENTAS",
    "CAMBIO_REVISADO_BODEGA",
    "COMPLETO_BODEGA"
  ]);

  const DEMAND_ORDER_STATUSES = new Set([
    "VALIDADO_COMERCIAL",
    "LISTO_BODEGA",
    "LISTO_DESPACHO"
  ]);

  const CLOSED_DEMAND_STATUSES = new Set([
    "BORRADOR",
    "REFERENCIAL",
    "REABIERTO_DEMO",
    "ANULADO",
    "DESPACHADO_DEMO",
    "CERRADO_DEMO"
  ]);

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function keyOf(variety, length, stemsPerBunch) {
    return `${normalize(variety)}|${parseNumber(length)}|${parseNumber(stemsPerBunch)}`;
  }

  function isOpenMixedLine(line) {
    return normalize(line?.boxBuildMode) === "MIXTO_ABIERTO";
  }

  function isAnyLengthLine(line) {
    return line?.anyLength === true || (isOpenMixedLine(line) && line?.mixedAnyLength !== false);
  }

  function isAnyLengthOpenMix(line) {
    return isOpenMixedLine(line) && isAnyLengthLine(line);
  }

  function excludedVarieties(line) {
    return new Set((Array.isArray(line?.mixedExcludedVarieties) ? line.mixedExcludedVarieties : []).map(normalize).filter(Boolean));
  }

  function lineAcceptsInventory(line, inventory) {
    if (!isAnyLengthLine(line) && parseNumber(line?.length) !== parseNumber(inventory?.length)) return false;
    if (parseNumber(line?.stemsPerBunch) !== parseNumber(inventory?.stemsPerBunch)) return false;
    if (!isOpenMixedLine(line)) return normalize(line?.variety) === normalize(inventory?.variety);
    return !excludedVarieties(line).has(normalize(inventory?.variety));
  }

  function refreshMixedActualComposition(line) {
    if (!isOpenMixedLine(line)) return;
    const grouped = new Map();
    (line.scannedBunches || []).forEach(scan => {
      const key = keyOf(scan.variety, scan.length, scan.stemsPerBunch);
      const current = grouped.get(key) || {
        variety: scan.variety || "-",
        length: parseNumber(scan.length || line.length),
        stemsPerBunch: parseNumber(scan.stemsPerBunch || line.stemsPerBunch),
        bunches: 0,
        totalStems: 0
      };
      current.bunches += 1;
      current.totalStems += current.stemsPerBunch;
      grouped.set(key, current);
    });
    line.mixedActualComposition = [...grouped.values()].sort((left, right) => (
      left.variety.localeCompare(right.variety)
      || left.length - right.length
      || left.stemsPerBunch - right.stemsPerBunch
    ));
  }

  function nowLabel() {
    const now = new Date();
    const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return local.toISOString().replace("T", " ").slice(0, 16);
  }

  function getOrders(appState) {
    return BlessERP.comercialState?.getOrders ? BlessERP.comercialState.getOrders(appState) : [];
  }

  function getOperationsStore(appState) {
    return BlessERP.operacionesState?.getStore ? BlessERP.operacionesState.getStore(appState) : null;
  }

  function save() {
    BlessERP.state?.saveDb?.();
  }

  function ensureWarehouseFields(order) {
    if (!order) return;
    if (!order.warehouseStatus) {
      order.warehouseStatus = normalize(order.status) === "LISTO_BODEGA"
        ? "LIBERADO_BODEGA"
        : "NO_LIBERADO";
    }
    order.warehouseReleasedAt = order.warehouseReleasedAt || "";
    order.warehouseReleasedBy = order.warehouseReleasedBy || "";
    order.warehouseCompletedAt = order.warehouseCompletedAt || "";
    order.warehouseObservation = order.warehouseObservation || "";
    order.revisionNumber = parseNumber(order.revisionNumber, 1);
    order.revisionEditing = Boolean(order.revisionEditing);
    order.revisionDraftNumber = parseNumber(order.revisionDraftNumber, 0);
    order.revisionReason = order.revisionReason || "";
    order.revisionBaseBoxNumbers = Array.isArray(order.revisionBaseBoxNumbers) ? order.revisionBaseBoxNumbers : [];
    order.changeNotifications = Array.isArray(order.changeNotifications) ? order.changeNotifications : [];
    (order.lines || []).forEach(line => { line.addedRevision = parseNumber(line.addedRevision, 1); });
    order.boxFulfillment = order.boxFulfillment && typeof order.boxFulfillment === "object"
      ? order.boxFulfillment
      : {};
  }

  function orderContributesDemand(order) {
    if (!order) return false;
    ensureWarehouseFields(order);
    const orderStatus = normalize(order.status);
    const warehouseStatus = normalize(order.warehouseStatus);
    if (CLOSED_DEMAND_STATUSES.has(orderStatus) || warehouseStatus === "COMPLETO_BODEGA") return false;
    if (DEMAND_ORDER_STATUSES.has(orderStatus)) return true;
    return OPEN_WAREHOUSE_STATUSES.has(warehouseStatus);
  }

  function getAvailabilityRows(appState) {
    const sourceRows = BlessERP.operacionesAvailabilityDemo?.getAvailabilityDemo
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilityDemo(appState)
      : [];
    const grouped = new Map();

    sourceRows.forEach(row => {
      const key = keyOf(row.variedad || row.variety, row.longitud || row.length, row.tallos_por_ramo || row.stemsPerBunch);
      const current = grouped.get(key) || {
        key,
        variety: row.variedad || row.variety || "",
        length: parseNumber(row.longitud || row.length),
        stemsPerBunch: parseNumber(row.tallos_por_ramo || row.stemsPerBunch),
        physicalBunches: 0,
        demandPendingBunches: 0,
        warehouses: new Set(),
        oldestAdmission: ""
      };
      current.physicalBunches += parseNumber(row.ramos_disponibles ?? row.bunchesAvailable);
      if (row.bodega || row.warehouse) current.warehouses.add(row.bodega || row.warehouse);
      const admission = row.fecha_ingreso_bodega || row.fecha || "";
      if (admission && (!current.oldestAdmission || admission < current.oldestAdmission)) current.oldestAdmission = admission;
      grouped.set(key, current);
    });

    getOrders(appState)
      .filter(orderContributesDemand)
      .forEach(order => (order.lines || []).forEach(line => {
        const openMixed = isOpenMixedLine(line);
        const anyLength = isAnyLengthLine(line);
        const exclusions = [...excludedVarieties(line)];
        const key = openMixed
          ? `MIXTO_ABIERTO|${anyLength ? "ANY" : parseNumber(line.length)}|${parseNumber(line.stemsPerBunch)}|${exclusions.sort().join(",")}`
          : anyLength
            ? `${normalize(line.variety)}|ANY|${parseNumber(line.stemsPerBunch)}`
            : keyOf(line.variety, line.length, line.stemsPerBunch);
        const current = grouped.get(key) || {
          key,
          variety: line.variety || "",
          length: parseNumber(line.length),
          stemsPerBunch: parseNumber(line.stemsPerBunch),
          physicalBunches: 0,
          demandPendingBunches: 0,
          warehouses: new Set(),
          oldestAdmission: "",
          openMixed,
          anyLength,
          excludedVarieties: exclusions
        };
        const scanned = Array.isArray(line.scannedBunches) ? line.scannedBunches.length : 0;
        current.demandPendingBunches += Math.max(parseNumber(line.bunches) - scanned, 0);
        grouped.set(key, current);
      }));

    return [...grouped.values()].map(row => {
      const flexibleLength = row.openMixed || row.anyLength;
      const compatibleRows = flexibleLength
        ? sourceRows
          .filter(item => row.anyLength || parseNumber(item.longitud || item.length) === row.length)
          .filter(item => parseNumber(item.tallos_por_ramo || item.stemsPerBunch) === row.stemsPerBunch)
          .filter(item => row.openMixed
            ? !new Set(row.excludedVarieties || []).has(normalize(item.variedad || item.variety))
            : normalize(item.variedad || item.variety) === normalize(row.variety))
        : [];
      const physicalBunches = flexibleLength
        ? compatibleRows.reduce((sum, item) => sum + parseNumber(item.ramos_disponibles ?? item.bunchesAvailable), 0)
        : row.physicalBunches;
      const warehouses = flexibleLength
        ? [...new Set(compatibleRows.map(item => item.bodega || item.warehouse).filter(Boolean))].join(", ")
        : [...row.warehouses].join(", ");
      const oldestAdmission = flexibleLength
        ? compatibleRows.map(item => item.fecha_ingreso_bodega || item.fecha || "").filter(Boolean).sort()[0] || ""
        : row.oldestAdmission;
      const projectedBunches = physicalBunches - row.demandPendingBunches;
      const shortageBunches = Math.max(-projectedBunches, 0);
      const availableForSaleBunches = Math.max(projectedBunches, 0);
      return {
        ...row,
        physicalBunches,
        warehouses,
        oldestAdmission,
        lengthLabel: row.anyLength ? "CUALQUIER MEDIDA" : `${row.length}`,
        projectedBunches,
        availableForSaleBunches,
        shortageBunches,
        status: shortageBunches > 0 ? "FALTANTE_PROYECTADO" : projectedBunches > 0 ? "DISPONIBLE" : "JUSTO",
        // Aliases kept while older views are migrated.
        totalBunches: physicalBunches,
        bunchesInOrders: row.demandPendingBunches,
        availableBunches: availableForSaleBunches
      };
    }).sort((left, right) => left.variety.localeCompare(right.variety) || left.length - right.length || left.stemsPerBunch - right.stemsPerBunch);
  }

  function groupOrderBoxes(order) {
    const groups = new Map();
    (order?.lines || []).forEach(line => {
      const boxNumber = Math.max(1, parseNumber(line.boxNumber, 1));
      if (!groups.has(boxNumber)) groups.set(boxNumber, { boxNumber, boxType: line.boxType || "-", lines: [] });
      groups.get(boxNumber).lines.push(line);
    });
    return [...groups.values()].sort((a, b) => a.boxNumber - b.boxNumber);
  }

  function lineProgress(line) {
    const required = parseNumber(line.bunches);
    const scanned = Array.isArray(line.scannedBunches) ? line.scannedBunches.length : 0;
    return {
      line,
      required,
      scanned,
      pending: Math.max(required - scanned, 0),
      status: required > 0 && scanned >= required ? "COMPLETA" : scanned > 0 ? "EN_PROCESO" : "PENDIENTE"
    };
  }

  function getOrderFulfillment(appState, orderId) {
    const order = BlessERP.comercialState?.findOrder?.(appState, orderId);
    if (!order) return null;
    ensureWarehouseFields(order);
    const boxes = groupOrderBoxes(order).map(group => {
      const lines = group.lines.map(lineProgress);
      const required = lines.reduce((sum, item) => sum + item.required, 0);
      const scanned = lines.reduce((sum, item) => sum + item.scanned, 0);
      const automaticComplete = Boolean(lines.length && lines.every(item => item.status === "COMPLETA"));
      const saved = order.boxFulfillment[group.boxNumber] || {};
      const closedAt = saved.closedAt || saved.confirmedAt || "";
      const status = closedAt
        ? "CERRADA_BODEGA"
        : automaticComplete
          ? "ARMADA_COMPLETA"
          : scanned > 0
            ? "EN_PROCESO"
            : "INCOMPLETA";
      return {
        ...group,
        lines,
        required,
        scanned,
        pending: Math.max(required - scanned, 0),
        automaticComplete,
        status,
        closedAt,
        closedBy: saved.closedBy || saved.confirmedBy || "",
        labelPrintedAt: saved.labelPrintedAt || ""
      };
    });
    const allBoxesComplete = Boolean(boxes.length && boxes.every(box => box.automaticComplete || box.status === "CERRADA_BODEGA"));
    const allBoxesClosed = Boolean(boxes.length && boxes.every(box => box.status === "CERRADA_BODEGA"));
    return {
      order,
      boxes,
      totalBoxes: boxes.length,
      closedBoxes: boxes.filter(box => box.status === "CERRADA_BODEGA").length,
      confirmedBoxes: boxes.filter(box => box.status === "CERRADA_BODEGA").length,
      completeBoxes: boxes.filter(box => ["ARMADA_COMPLETA", "CERRADA_BODEGA"].includes(box.status)).length,
      requiredBunches: boxes.reduce((sum, box) => sum + box.required, 0),
      scannedBunches: boxes.reduce((sum, box) => sum + box.scanned, 0),
      pendingBunches: boxes.reduce((sum, box) => sum + box.pending, 0),
      allBoxesClosed,
      allBoxesComplete,
      allBoxesConfirmed: allBoxesComplete,
      warehouseStatus: order.warehouseStatus,
      orderFulfillmentStatus: order.fulfillmentStatus || "NO_LIBERADO"
    };
  }

  function validateRelease(order) {
    const errors = [];
    const warnings = [];
    if (!["VALIDADO_COMERCIAL", "LISTO_BODEGA"].includes(normalize(order?.status))) {
      errors.push("El pedido debe estar VALIDADO_COMERCIAL antes de liberarse a Bodega.");
    }
    if (!order?.customerId) errors.push("Falta cliente principal.");
    if (!order?.brandId) errors.push("Falta marca / cliente final.");
    if (!String(order?.destination || "").trim()) errors.push("Falta destino.");
    if (!String(order?.agencyId || "").trim()) errors.push("Falta agencia de carga.");
    if (!String(order?.flightDate || "").trim()) errors.push("Falta fecha de vuelo o salida.");
    if (!(order?.lines || []).length) errors.push("El pedido no tiene cajas ni variedades.");
    (order?.lines || []).forEach(line => {
      const invalidLength = !isAnyLengthLine(line) && parseNumber(line.length) <= 0;
      if (parseNumber(line.boxNumber) <= 0 || !String(line.boxType || "").trim() || !String(line.variety || "").trim() || invalidLength || parseNumber(line.bunches) <= 0 || parseNumber(line.stemsPerBunch) <= 0) {
        errors.push(`Caja ${line.boxNumber || "-"}: detalle incompleto.`);
      }
      if (parseNumber(line.unitPrice) <= 0) errors.push(`Caja ${line.boxNumber || "-"}: falta precio manual por tallo.`);
    });
    const brand = BlessERP.comercialUtils?.findBrand?.(order?.brandId);
    if (brand?.requiresPo && (order?.lines || []).some(line => !String(line.po || order.generalPo || "").trim())) {
      errors.push("La marca requiere PO en todas las lineas o un PO general.");
    }
    if (normalize(order?.transportType) === "AEREO" && !String(order?.daeNumber || "").trim()) {
      errors.push("El pedido aereo requiere DAE antes de liberarse a Bodega.");
    }
    const awbDigits = BlessERP.comercialUtils?.getAwbDigits?.(order?.awb) || String(order?.awb || "").replace(/\D/g, "");
    if (!awbDigits) {
      warnings.push("AWB pendiente; Bodega puede iniciar el armado.");
    } else if (awbDigits.length !== 11) {
      warnings.push("AWB incompleta: debe contener 3 digitos de aerolinea y 8 complementarios.");
    } else if (!BlessERP.comercialUtils?.findAirlineByAwb?.(order.awb)) {
      warnings.push(`Prefijo AWB ${awbDigits.slice(0, 3)} no parametrizado en Lineas aereas.`);
    }
    if (!String(order?.hawb || "").trim()) warnings.push("HAWB pendiente; Bodega puede iniciar el armado.");
    if (!String(order?.airlineId || "").trim() || !String(order?.flightNumber || "").trim()) warnings.push("Carrier o vuelo pendiente; completar antes de etiquetas finales.");
    if (normalize(order?.transportType) === "MARITIMO" && !String(order?.daeNumber || "").trim()) {
      warnings.push("Pedido maritimo sin DAE: permitido mientras la DAE siga pendiente.");
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  function recordHistory(order, action, detail) {
    order.fulfillmentHistory = Array.isArray(order.fulfillmentHistory) ? order.fulfillmentHistory : [];
    order.fulfillmentHistory.unshift({ id: BlessERP.utils.uid("COM-ARM"), dateTime: nowLabel(), action, detail });
  }

  function recordBunchAssignmentEvent(appState, order, box, line, inventory, code) {
    const store = getOperationsStore(appState);
    if (!store) return;
    store.scannerEvents = Array.isArray(store.scannerEvents) ? store.scannerEvents : [];
    store.scannerEvents.unshift({
      eventId: BlessERP.utils.uid("SCN-ARM"),
      dateTime: nowLabel(),
      code,
      type: "RAMO",
      moduleOrigin: "Operaciones / Despacho operativo",
      moduleDestination: "Pedido / Caja",
      pedido_id: order.id,
      orderId: order.id,
      box_id: `${order.id}-BOX-${box.boxNumber}`,
      boxId: `${order.id}-BOX-${box.boxNumber}`,
      label_id: inventory.sourceLabelId || "",
      labelId: inventory.sourceLabelId || "",
      variedad: inventory.variety,
      longitud: inventory.length,
      result: "ASIGNADO_CAJA",
      user: appState.db.session?.activeUser?.name || "Bodega demo",
      observation: `${order.number} / caja ${box.boxNumber} / ${inventory.variety} ${inventory.length} cm${isOpenMixedLine(line) ? " / mixto abierto" : ""}${isAnyLengthLine(line) ? " / cualquier medida" : ""}.`
    });
  }

  function releaseOrderToWarehouse(appState, orderId, user = "Usuario ventas demo") {
    const summary = getOrderFulfillment(appState, orderId);
    if (!summary) return { ok: false, error: "El pedido no existe." };
    const validation = validateRelease(summary.order);
    if (!validation.ok) return { ok: false, error: "No se puede liberar el pedido a Bodega.", validation };
    summary.order.warehouseStatus = summary.scannedBunches > 0 ? "EN_ARMADO" : "LIBERADO_BODEGA";
    summary.order.warehouseReleasedAt = summary.order.warehouseReleasedAt || nowLabel();
    summary.order.warehouseReleasedBy = user;
    summary.order.fulfillmentStatus = summary.order.warehouseStatus;
    recordHistory(summary.order, "LIBERAR_A_BODEGA", `Pedido liberado a Bodega por ${user}. No se reservaron ramos.`);
    save();
    return { ok: true, validation, summary: getOrderFulfillment(appState, orderId) };
  }

  function getWarehouseOrders(appState) {
    return getOrders(appState)
      .map(order => getOrderFulfillment(appState, order.id))
      .filter(summary => summary && OPEN_WAREHOUSE_STATUSES.has(normalize(summary.warehouseStatus)))
      .sort((left, right) => {
        const leftDate = left.order.warehouseReleasedAt || left.order.issuedAt || "";
        const rightDate = right.order.warehouseReleasedAt || right.order.issuedAt || "";
        return leftDate.localeCompare(rightDate) || left.order.number.localeCompare(right.order.number);
      });
  }

  function findInventoryBunch(appState, code) {
    const clean = String(code || "").trim();
    const store = getOperationsStore(appState);
    return (store?.roseInventory || []).find(item => String(item.labelCode || "").trim() === clean) || null;
  }

  function findScannedCode(appState, code) {
    const clean = String(code || "").trim();
    for (const order of getOrders(appState)) {
      for (const line of order.lines || []) {
        const scan = (line.scannedBunches || []).find(item => String(item.code || "") === clean);
        if (scan) return { order, line, scan };
      }
    }
    return null;
  }

  function availableCompatibleBunches(appState, targetLine) {
    const store = getOperationsStore(appState);
    return (store?.roseInventory || [])
      .filter(item => normalize(item.state) === "DISPONIBLE")
      .filter(item => lineAcceptsInventory(targetLine, item))
      .sort((left, right) => String(left.admittedAt || left.date || "").localeCompare(String(right.admittedAt || right.date || "")));
  }

  function getFifoSuggestions(appState, orderId, boxNumber) {
    const summary = getOrderFulfillment(appState, orderId);
    const box = summary?.boxes.find(item => item.boxNumber === parseNumber(boxNumber));
    if (!box) return [];
    return box.lines.filter(item => item.pending > 0).map(item => {
      const candidates = availableCompatibleBunches(appState, item.line);
      return {
        lineId: item.line.id,
        variety: item.line.variety,
        length: item.line.length,
        lengthLabel: isAnyLengthLine(item.line) ? "CUALQUIER MEDIDA" : `${item.line.length} cm`,
        anyLength: isAnyLengthLine(item.line),
        stemsPerBunch: item.line.stemsPerBunch,
        pending: item.pending,
        available: candidates.length,
        oldest: candidates[0] || null
      };
    });
  }

  function scanBunchForOrder(appState, orderId, boxNumber, code) {
    const cleanCode = String(code || "").trim();
    if (!/^\d{10}$/.test(cleanCode)) return { ok: false, error: "El codigo del ramo debe tener 10 digitos." };
    const duplicate = findScannedCode(appState, cleanCode);
    if (duplicate) return { ok: false, error: `El ramo ya fue usado en ${duplicate.order.number}, caja ${duplicate.line.boxNumber}.`, result: "DUPLICADO" };
    // Resolve the order after duplicate validation so all mutations use the latest normalized store references.
    const summary = getOrderFulfillment(appState, orderId);
    if (!summary) return { ok: false, error: "La orden no existe." };
    if (!OPEN_WAREHOUSE_STATUSES.has(normalize(summary.warehouseStatus))) {
      return { ok: false, error: "La orden debe estar liberada y abierta en Bodega antes de escanear." };
    }
    const inventory = findInventoryBunch(appState, cleanCode);
    if (!inventory) return { ok: false, error: "El codigo no corresponde a un ramo ingresado al inventario por escaneo.", result: "NO_ENCONTRADO" };
    if (normalize(inventory.state) !== "DISPONIBLE") {
      return { ok: false, error: `El ramo no esta disponible para armado: ${inventory.state}.`, result: "NO_DISPONIBLE" };
    }
    const box = summary.boxes.find(item => item.boxNumber === parseNumber(boxNumber));
    if (!box) return { ok: false, error: "Seleccione una caja existente de la orden." };
    if (box.status === "CERRADA_BODEGA") return { ok: false, error: "La caja ya fue cerrada por Bodega." };
    const target = box.lines.find(item => item.pending > 0 && lineAcceptsInventory(item.line, inventory));
    if (!target) {
      return { ok: false, error: `El ramo ${inventory.variety} ${inventory.length} cm / ${inventory.stemsPerBunch} tallos no corresponde a una linea pendiente de la caja ${box.boxNumber}.`, result: "NO_COINCIDE" };
    }

    const candidates = availableCompatibleBunches(appState, target.line);
    const oldest = candidates[0] || null;
    const fifoWarning = oldest && String(oldest.labelCode) !== cleanCode
      ? `Existe flor mas antigua disponible: ${oldest.labelCode}, ingreso ${oldest.admittedAt || oldest.date}. Revise su estado fisico antes de continuar.`
      : "";

    target.line.scannedBunches = Array.isArray(target.line.scannedBunches) ? target.line.scannedBunches : [];
    target.line.scannedBunches.push({
      code: cleanCode,
      inventoryId: inventory.inventoryId || "",
      scannedAt: nowLabel(),
      variety: inventory.variety || "",
      length: parseNumber(inventory.length),
      stemsPerBunch: parseNumber(inventory.stemsPerBunch)
    });
    refreshMixedActualComposition(target.line);
    target.line.fulfillmentStatus = target.line.scannedBunches.length >= parseNumber(target.line.bunches) ? "COMPLETA" : "EN_PROCESO";
    inventory.state = "ASIGNADO_CAJA";
    inventory.assignedOrderId = summary.order.id;
    inventory.assignedBoxNumber = box.boxNumber;
    inventory.assignedLineId = target.line.id;
    inventory.assignedAt = nowLabel();
    inventory.assignmentHistory = Array.isArray(inventory.assignmentHistory) ? inventory.assignmentHistory : [];
    inventory.assignmentHistory.unshift({
      pedidoId: summary.order.id,
      pedidoNumero: summary.order.number,
      boxNumber: box.boxNumber,
      lineId: target.line.id,
      assignedAt: inventory.assignedAt
    });
    inventory.observation = `Asignado a ${summary.order.number}, caja ${box.boxNumber}.`;
    recordBunchAssignmentEvent(appState, summary.order, box, target.line, inventory, cleanCode);
    summary.order.warehouseStatus = "EN_ARMADO";
    summary.order.fulfillmentStatus = "EN_ARMADO";
    recordHistory(summary.order, "ESCANEAR_RAMO_BODEGA", `Caja ${box.boxNumber}: ${cleanCode} · ${inventory.variety} ${inventory.length} cm.${fifoWarning ? ` Advertencia FIFO: ${fifoWarning}` : ""}`);
    const updated = getOrderFulfillment(appState, orderId);
    if (updated.allBoxesComplete) {
      updated.order.warehouseStatus = "COMPLETO_BODEGA";
      updated.order.fulfillmentStatus = "COMPLETO_BODEGA";
      updated.order.warehouseCompletedAt = nowLabel();
      recordHistory(updated.order, "COMPLETAR_ORDEN_BODEGA", "Todas las cajas se completaron automaticamente mediante escaneo de ramos.");
    }
    save();
    return { ok: true, result: "RAMO_ASIGNADO", warning: fifoWarning, boxNumber: box.boxNumber, lineId: target.line.id, inventory, summary: getOrderFulfillment(appState, orderId) };
  }

  function closeBoxByWarehouse(appState, orderId, boxNumber, user = "Bodega demo") {
    const summary = getOrderFulfillment(appState, orderId);
    const box = summary?.boxes.find(item => item.boxNumber === parseNumber(boxNumber));
    if (!box) return { ok: false, error: "La caja no existe." };
    if (!box.automaticComplete) return { ok: false, error: `La caja ${box.boxNumber} todavia tiene ${box.pending} ramos pendientes.` };
    summary.order.boxFulfillment[box.boxNumber] = {
      ...(summary.order.boxFulfillment[box.boxNumber] || {}),
      closedAt: nowLabel(),
      closedBy: user
    };
    recordHistory(summary.order, "CERRAR_CAJA_BODEGA", `Caja ${box.boxNumber} cerrada por ${user}.`);
    const updated = getOrderFulfillment(appState, orderId);
    if (updated.allBoxesClosed) {
      updated.order.warehouseStatus = "COMPLETO_BODEGA";
      updated.order.fulfillmentStatus = "COMPLETO_BODEGA";
      updated.order.warehouseCompletedAt = nowLabel();
      recordHistory(updated.order, "COMPLETAR_ORDEN_BODEGA", "Todas las cajas quedaron cerradas en Bodega.");
    }
    save();
    return { ok: true, summary: getOrderFulfillment(appState, orderId) };
  }

  function markBoxLabelPrinted(appState, orderId, boxNumber) {
    const summary = getOrderFulfillment(appState, orderId);
    const box = summary?.boxes.find(item => item.boxNumber === parseNumber(boxNumber));
    if (!box || !["ARMADA_COMPLETA", "CERRADA_BODEGA"].includes(box.status)) return { ok: false, error: "Complete la caja mediante escaneo antes de imprimir su etiqueta." };
    summary.order.boxFulfillment[box.boxNumber] = {
      ...(summary.order.boxFulfillment[box.boxNumber] || {}),
      labelPrintedAt: nowLabel()
    };
    recordHistory(summary.order, "IMPRIMIR_ETIQUETA_CAJA", `Etiqueta de caja ${box.boxNumber} enviada a preview demo.`);
    save();
    return { ok: true };
  }

  function completeOrderByWarehouse(appState, orderId) {
    const summary = getOrderFulfillment(appState, orderId);
    if (!summary?.allBoxesComplete) return { ok: false, error: "Todas las cajas deben completarse mediante escaneo antes de completar la orden." };
    summary.order.warehouseStatus = "COMPLETO_BODEGA";
    summary.order.fulfillmentStatus = "COMPLETO_BODEGA";
    summary.order.warehouseCompletedAt = summary.order.warehouseCompletedAt || nowLabel();
    recordHistory(summary.order, "COMPLETAR_ORDEN_BODEGA", "Orden completada en Bodega. El pedido comercial sigue abierto para revisión final.");
    save();
    return { ok: true, summary: getOrderFulfillment(appState, orderId) };
  }

  // Compatibility aliases while legacy screens are migrated.
  function confirmBoxBySales(appState, orderId, boxNumber, user) {
    return closeBoxByWarehouse(appState, orderId, boxNumber, user || "Bodega demo");
  }

  function confirmOrderFulfillment(appState, orderId) {
    return completeOrderByWarehouse(appState, orderId);
  }

  function getPendingOrderChanges(appState, orderId) {
    const summary = getOrderFulfillment(appState, orderId);
    return (summary?.order?.changeNotifications || []).filter(item => !item.acknowledgedAt);
  }

  function acknowledgeOrderRevision(appState, orderId, user = "Bodega demo") {
    const summary = getOrderFulfillment(appState, orderId);
    if (!summary) return { ok: false, error: "El pedido no existe." };
    const pending = getPendingOrderChanges(appState, orderId);
    if (!pending.length) return { ok: false, error: "No existen actualizaciones pendientes de revisar." };
    pending.forEach(item => {
      item.acknowledgedAt = nowLabel();
      item.acknowledgedBy = user;
      item.status = "REVISADA_BODEGA";
    });
    summary.order.warehouseStatus = summary.scannedBunches > 0 ? "EN_ARMADO" : "CAMBIO_REVISADO_BODEGA";
    summary.order.fulfillmentStatus = summary.order.warehouseStatus;
    recordHistory(summary.order, "REVISAR_CAMBIO_BODEGA", `Bodega reviso la revision ${summary.order.revisionNumber || 1}.`);
    save();
    return { ok: true, summary: getOrderFulfillment(appState, orderId) };
  }

  BlessERP.comercialOrderFulfillment = {
    closeBoxByWarehouse,
    acknowledgeOrderRevision,
    completeOrderByWarehouse,
    confirmBoxBySales,
    confirmOrderFulfillment,
    getAvailabilityRows,
    getFifoSuggestions,
    getPendingOrderChanges,
    getOrderFulfillment,
    getWarehouseOrders,
    isAnyLengthLine,
    isAnyLengthOpenMix,
    orderContributesDemand,
    groupOrderBoxes,
    markBoxLabelPrinted,
    releaseOrderToWarehouse,
    scanBunchForOrder,
    validateRelease
  };
})();
