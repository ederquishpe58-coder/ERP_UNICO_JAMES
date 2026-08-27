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
    "REFERENCIAL",
    "REABIERTO_DEMO",
    "ANULADO",
    "DESPACHADO_DEMO",
    "DESPACHADO",
    "CERRADO_DEMO",
    "CERRADO"
  ]);
  let availabilityCache = null;

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function hasAvailabilityCommitment(order) {
    const policy = BlessERP.operacionesAvailabilityPolicy;
    if (policy?.hasAvailabilityCommitment) return policy.hasAvailabilityCommitment(order);
    if (!order) return false;
    if (order.availabilityCommittedAt || order.availability_committed_at) return true;
    if ((order.history || []).some(item => normalize(item?.action) === "GUARDAR_PEDIDO")) return true;
    return normalize(order.sriSequenceStatus) === "RESERVADO" && Boolean(String(order.sriInvoiceNumber || "").trim());
  }

  function normalizeBunchBarcodeCode(value) {
    const compact = String(value ?? "").replace(/[\r\n\t ]+/g, "").trim();
    if (BlessERP.bunchLabelCodec?.isStructuredCode?.(compact)) {
      return BlessERP.bunchLabelCodec.normalizeStructuredCode(compact);
    }
    const digits = compact.replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.length < 10) return digits.padStart(10, "0");
    return digits.slice(-10);
  }

  function bunchBarcodeDigitCount(value) {
    if (BlessERP.bunchLabelCodec?.isStructuredCode?.(value)) return 10;
    return String(value ?? "").replace(/\D+/g, "").length;
  }

  function keyOf(variety, length, stemsPerBunch) {
    return `${normalize(variety)}|${parseNumber(length)}|${parseNumber(stemsPerBunch)}`;
  }

  function demandKeyForLine(line) {
    const openMixed = isOpenMixedLine(line);
    const anyLength = isAnyLengthLine(line);
    const exclusions = [...excludedVarieties(line)];
    return openMixed
      ? `MIXTO_ABIERTO|${anyLength ? "ANY" : parseNumber(line.length)}|${parseNumber(line.stemsPerBunch)}|${exclusions.sort().join(",")}`
      : anyLength
        ? `${normalize(line.variety)}|ANY|${parseNumber(line.stemsPerBunch)}`
        : keyOf(line.variety, line.length, line.stemsPerBunch);
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
    if (BlessERP.comercialIntercompany?.getAllOrders) {
      return BlessERP.comercialIntercompany.getAllOrders(appState);
    }
    return BlessERP.comercialState?.getOrders ? BlessERP.comercialState.getOrders(appState) : [];
  }

  function getOperationsStore(appState) {
    if (!BlessERP.operacionesState?.getStore) return null;
    const inventorySourceState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    return BlessERP.operacionesState.getStore(inventorySourceState);
  }

  function save() {
    BlessERP.state?.saveDb?.();
  }

  function ensureWarehouseFields(order) {
    if (!order) return;
    if (!order.warehouseStatus) {
      order.warehouseStatus = normalize(order.status) === "LISTO_BODEGA"
        ? "LIBERADO_BODEGA"
        : "PENDIENTE_ARMADO";
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

  function orderContributesDemand(order, appState) {
    if (!order) return false;
    if (normalize(order.inventorySupplyMode || order.inventory_supply_mode) === "EXTERNAL_FARM") return false;
    const orderStatus = normalize(order.status);
    const committedDraft = orderStatus === "BORRADOR" && hasAvailabilityCommitment(order);
    if (orderStatus === "BORRADOR" && !committedDraft) return false;
    if (CLOSED_DEMAND_STATUSES.has(orderStatus)) return false;
    ensureWarehouseFields(order);
    const policy = BlessERP.operacionesAvailabilityPolicy;
    const availabilityState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    if (policy?.isOrderActive) return policy.isOrderActive(order, availabilityState);
    const warehouseStatus = normalize(order.warehouseStatus);
    if (warehouseStatus === "COMPLETO_BODEGA") return false;
    if (DEMAND_ORDER_STATUSES.has(orderStatus)) return true;
    return OPEN_WAREHOUSE_STATUSES.has(warehouseStatus);
  }

  function availabilityInputSignature(appState, orders) {
    const availabilityState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    const operations = availabilityState?.db?.operations || {};
    const inventory = Array.isArray(operations.roseInventory) ? operations.roseInventory : [];
    const legacyAvailability = Array.isArray(operations.availabilityDemo) ? operations.availabilityDemo : [];
    let hash = 2166136261;
    const mix = value => {
      const text = String(value ?? "");
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    };
    orders.forEach(order => {
      mix(order.id); mix(order.status); mix(order.warehouseStatus);
      mix(order.availabilityReservationMode); mix(order.availabilityCommitmentStatus);
      mix(order.flightDate); mix(order.issuedAt); mix((order.history || []).length);
      (order.lines || []).forEach(line => {
        mix(line.id); mix(line.variety); mix(line.length); mix(line.stemsPerBunch); mix(line.bunches);
        mix(line.anyLength); mix(line.boxBuildMode); mix((line.scannedBunches || []).length);
        const lastScan = (line.scannedBunches || []).at?.(-1);
        if (lastScan) { mix(lastScan.code); mix(lastScan.variety); mix(lastScan.length); }
      });
    });
    inventory.forEach(item => {
      mix(item.inventoryId || item.id || item.labelCode); mix(item.state);
      mix(item.variety); mix(item.length); mix(item.stemsPerBunch); mix(item.assignedOrderId); mix(item.assignedBoxNumber);
    });
    legacyAvailability.forEach(item => {
      mix(item.id); mix(item.variedad || item.variety); mix(item.longitud || item.length);
      mix(item.ramos_disponibles ?? item.bunchesAvailable); mix(item.estado || item.state);
    });
    return `${orders.length}:${inventory.length}:${legacyAvailability.length}:${hash >>> 0}`;
  }

  function getAvailabilityRows(appState) {
    const revision = Number(BlessERP.state?.dataRevision?.() || 0);
    const companyId = String(BlessERP.services?.companyContext?.activeCompanyId?.() || appState?.db?.activeCompanyId || "");
    const orders = getOrders(appState);
    const signature = availabilityInputSignature(appState, orders);
    if (availabilityCache?.appState === appState && availabilityCache.revision === revision && availabilityCache.companyId === companyId && availabilityCache.signature === signature) {
      return availabilityCache.rows;
    }
    const availabilityState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    const sourceRows = BlessERP.operacionesAvailabilityDemo?.getAvailabilityDemo
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilityDemo(availabilityState)
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
        activeOrderBunches: 0,
        blessActiveOrderBunches: 0,
        imperioActiveOrderBunches: 0,
        blessPendingOrderBunches: 0,
        imperioPendingOrderBunches: 0,
        blessScannedBunches: 0,
         imperioScannedBunches: 0,
         scannedBunches: 0,
          mixedScannedBunches: 0,
         demandPendingBunches: 0,
        warehouses: new Set(),
        origins: new Set(),
        oldestAdmission: ""
      };
      current.physicalBunches += parseNumber(row.ramos_disponibles ?? row.bunchesAvailable);
      if (row.bodega || row.warehouse) current.warehouses.add(row.bodega || row.warehouse);
      if (row.proveedor || row.supplier || row.origin) current.origins.add(row.proveedor || row.supplier || row.origin);
      const admission = row.fecha_ingreso_bodega || row.fecha || "";
      if (admission && (!current.oldestAdmission || admission < current.oldestAdmission)) current.oldestAdmission = admission;
      grouped.set(key, current);
    });

    orders
      .filter(order => orderContributesDemand(order, appState))
      .forEach(order => (order.lines || []).forEach(line => {
        const openMixed = isOpenMixedLine(line);
        const anyLength = isAnyLengthLine(line);
        const exclusions = [...excludedVarieties(line)];
        const key = demandKeyForLine(line);
        const current = grouped.get(key) || {
          key,
          variety: line.variety || "",
          length: parseNumber(line.length),
          stemsPerBunch: parseNumber(line.stemsPerBunch),
          physicalBunches: 0,
          activeOrderBunches: 0,
          blessActiveOrderBunches: 0,
          imperioActiveOrderBunches: 0,
          blessPendingOrderBunches: 0,
          imperioPendingOrderBunches: 0,
          blessScannedBunches: 0,
           imperioScannedBunches: 0,
           scannedBunches: 0,
           mixedScannedBunches: 0,
           demandPendingBunches: 0,
          warehouses: new Set(),
          origins: new Set(),
          oldestAdmission: "",
          openMixed,
          anyLength,
          excludedVarieties: exclusions
        };
        const scanned = Array.isArray(line.scannedBunches) ? line.scannedBunches.length : 0;
        const requested = parseNumber(line.bunches);
        const pending = Math.max(requested - scanned, 0);
        const companyId = BlessERP.comercialIntercompany?.sellingCompanyId
          ? BlessERP.comercialIntercompany.sellingCompanyId(order)
          : String(order.sellingCompanyId || order.selling_company_id || order.companyId || order.company_id || "COMP-BLESS-FLOWER");
        const imperioCompanyId = BlessERP.comercialIntercompany?.IMPERIO_COMPANY_ID || "COMP-IMPERIO-FLOWERS";
        current.activeOrderBunches += requested;
        current.scannedBunches += scanned;
        current.demandPendingBunches += pending;
        if (companyId === imperioCompanyId) {
          current.imperioActiveOrderBunches += requested;
          current.imperioPendingOrderBunches += pending;
          current.imperioScannedBunches += scanned;
        } else {
          current.blessActiveOrderBunches += requested;
          current.blessPendingOrderBunches += pending;
          current.blessScannedBunches += scanned;
        }
        grouped.set(key, current);

        // Una linea mixta no puede reservar una variedad ficticia. Cada ramo
        // confirmado en Bodega se atribuye a su variedad y medida reales; el
        // saldo sin escanear permanece solamente como compromiso MIXTO.
        if (openMixed) {
          current.pendingMixedPlaceholder = true;
          (line.scannedBunches || []).forEach(scan => {
            const actualKey = keyOf(scan.variety, scan.length, scan.stemsPerBunch);
            const actual = grouped.get(actualKey) || {
              key: actualKey,
              variety: scan.variety || "",
              length: parseNumber(scan.length),
              stemsPerBunch: parseNumber(scan.stemsPerBunch),
              physicalBunches: 0,
              activeOrderBunches: 0,
              blessActiveOrderBunches: 0,
              imperioActiveOrderBunches: 0,
              blessPendingOrderBunches: 0,
              imperioPendingOrderBunches: 0,
              blessScannedBunches: 0,
              imperioScannedBunches: 0,
              scannedBunches: 0,
              mixedScannedBunches: 0,
              demandPendingBunches: 0,
              warehouses: new Set(),
              origins: new Set(),
              oldestAdmission: ""
            };
            actual.mixedScannedBunches += 1;
            grouped.set(actualKey, actual);
          });
        }
      }));

    const rows = [...grouped.values()].map(row => {
      if (row.pendingMixedPlaceholder) {
        const pending = parseNumber(row.demandPendingBunches);
        return {
          ...row,
          variety: "MIXTO PENDIENTE",
          physicalBunches: 0,
          physicalInventoryBunches: 0,
          warehouses: "",
          origins: "",
          oldestAdmission: "",
          lengthLabel: row.anyLength ? "POR CONFIRMAR" : `${row.length}`,
          projectedBunches: 0,
          availableForSaleBunches: 0,
          spotAvailableBunches: 0,
          shortageBunches: 0,
          status: pending > 0 ? "PENDIENTE_ESCANEO_MIXTO" : "MIXTO_CONFIRMADO",
          totalBunches: 0,
          bunchesInOrders: pending,
          availableBunches: 0
        };
      }
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
      const origins = flexibleLength
        ? [...new Set(compatibleRows.map(item => item.proveedor || item.supplier || item.origin).filter(Boolean))].join(", ")
        : [...(row.origins || [])].join(", ");
      const oldestAdmission = flexibleLength
        ? compatibleRows.map(item => item.fecha_ingreso_bodega || item.fecha || "").filter(Boolean).sort()[0] || ""
        : row.oldestAdmission;
      const projectedBunches = physicalBunches - row.demandPendingBunches;
      const shortageBunches = Math.max(-projectedBunches, 0);
      const availableForSaleBunches = Math.max(projectedBunches, 0);
      const scannedBunches = parseNumber(row.scannedBunches);
      const activeOrderBunches = parseNumber(row.activeOrderBunches, row.demandPendingBunches + scannedBunches);
      const blessActiveOrderBunches = parseNumber(row.blessActiveOrderBunches);
      const imperioActiveOrderBunches = parseNumber(row.imperioActiveOrderBunches);
      const blessPendingOrderBunches = parseNumber(row.blessPendingOrderBunches);
      const imperioPendingOrderBunches = parseNumber(row.imperioPendingOrderBunches);
      return {
        ...row,
        physicalBunches,
        warehouses,
        origins,
        oldestAdmission,
        lengthLabel: row.anyLength ? "CUALQUIER MEDIDA" : `${row.length}`,
        projectedBunches,
        physicalInventoryBunches: physicalBunches + scannedBunches,
        activeOrderBunches,
        blessActiveOrderBunches,
        imperioActiveOrderBunches,
        blessPendingOrderBunches,
        imperioPendingOrderBunches,
        blessScannedBunches: parseNumber(row.blessScannedBunches),
        imperioScannedBunches: parseNumber(row.imperioScannedBunches),
        scannedBunches,
        mixedScannedBunches: parseNumber(row.mixedScannedBunches),
        availableForSaleBunches,
        spotAvailableBunches: availableForSaleBunches,
        shortageBunches,
        status: shortageBunches > 0 ? "FALTANTE_PROYECTADO" : projectedBunches > 0 ? "DISPONIBLE" : "JUSTO",
        // Aliases kept while older views are migrated.
        totalBunches: physicalBunches,
        bunchesInOrders: row.demandPendingBunches,
        availableBunches: availableForSaleBunches
      };
    }).sort((left, right) => left.variety.localeCompare(right.variety) || left.length - right.length || left.stemsPerBunch - right.stemsPerBunch);
    availabilityCache = { appState, revision, companyId, signature, rows };
    return rows;
  }

  function getOrderCoverageRows(appState, fulfillmentOrOrderId) {
    const fulfillment = typeof fulfillmentOrOrderId === "string"
      ? getOrderFulfillment(appState, fulfillmentOrOrderId)
      : fulfillmentOrOrderId;
    const availability = getAvailabilityRows(appState);
    const byKey = new Map(availability.map(item => [item.key, item]));

    return (Array.isArray(fulfillment?.boxes) ? fulfillment.boxes : [])
      .filter(box => box && typeof box === "object")
      .flatMap(box => (Array.isArray(box.lines) ? box.lines : [])
        .filter(progress => progress?.line)
        .map(progress => {
          const line = progress.line;
          const stock = byKey.get(demandKeyForLine(line)) || {};
          const physical = parseNumber(stock.physicalBunches);
          const pending = parseNumber(progress.pending);
          const covered = Math.min(physical, pending);
          return {
            boxNumber: box.boxNumber,
            line,
            required: parseNumber(progress.required),
            scanned: parseNumber(progress.scanned),
            pending,
            physical,
            projected: parseNumber(stock.projectedBunches),
            shortage: Math.max(pending - physical, 0),
            coverage: pending === 0 ? "COMPLETA" : covered >= pending ? "DISPONIBLE" : covered > 0 ? "PARCIAL" : "FALTANTE"
          };
        }));
  }

  function getFutureDemandRows(appState, projectionDays = 3, excludeOrderId = "") {
    const policy = BlessERP.operacionesAvailabilityPolicy;
    if (!policy?.isFutureOrder) return [];
    const today = policy.localDateKey();
    const limit = policy.addDays(today, [1, 3, 7].includes(Number(projectionDays)) ? Number(projectionDays) : 3);
    const grouped = new Map();
    getOrders(appState)
      .filter(order => order.id !== excludeOrderId && policy.isFutureOrder(order, appState))
      .filter(order => {
        const date = policy.orderPreparationDate(order);
        return date >= today && date <= limit;
      })
      .forEach(order => (order.lines || []).forEach(line => {
        const key = demandKeyForLine(line);
        const current = grouped.get(key) || {
          key,
          variety: line.variety || "",
          length: parseNumber(line.length),
          lengthLabel: isAnyLengthLine(line) ? "CUALQUIER MEDIDA" : `${parseNumber(line.length)} cm`,
          stemsPerBunch: parseNumber(line.stemsPerBunch),
          openMixed: isOpenMixedLine(line),
          anyLength: isAnyLengthLine(line),
          futureOrderBunches: 0,
          orderIds: new Set(),
          orderNumbers: new Set(),
          preparationDates: new Set()
        };
        current.futureOrderBunches += parseNumber(line.bunches);
        current.orderIds.add(order.id);
        current.orderNumbers.add(order.number || order.id);
        current.preparationDates.add(policy.orderPreparationDate(order));
        grouped.set(key, current);
      }));
    return [...grouped.values()].map(row => ({
      ...row,
      orderIds: [...row.orderIds],
      orderNumbers: [...row.orderNumbers],
      preparationDates: [...row.preparationDates].sort()
    })).sort((left, right) => left.variety.localeCompare(right.variety) || left.length - right.length || left.stemsPerBunch - right.stemsPerBunch);
  }

  function groupOrderBoxes(order) {
    const groups = new Map();
    (Array.isArray(order?.lines) ? order.lines : [])
      .filter(line => line && typeof line === "object")
      .forEach(line => {
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

  function buildOrderFulfillment(order) {
    if (!order) return null;
    ensureWarehouseFields(order);
    const boxes = groupOrderBoxes(order).filter(Boolean).map(group => {
      const lines = (Array.isArray(group?.lines) ? group.lines : []).filter(Boolean).map(lineProgress);
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

  function getOrderFulfillment(appState, orderId) {
    const order = BlessERP.comercialState?.findOrder?.(appState, orderId)
      || getOrders(appState).find(item => String(item.id) === String(orderId));
    return buildOrderFulfillment(order);
  }

  function validateRelease(order, appState = null) {
    const errors = [];
    const warnings = [];
    const localSale = BlessERP.comercialUtils?.isLocalOrder?.(order) || false;
    if (normalize(order?.inventorySupplyMode || order?.inventory_supply_mode) === "EXTERNAL_FARM") {
      errors.push("El pedido de finca externa no utiliza inventario ni Cuarto frío.");
      return { ok: false, errors, warnings };
    }
    if (!["VALIDADO_COMERCIAL", "LISTO_BODEGA"].includes(normalize(order?.status))) {
      errors.push("El pedido debe estar VALIDADO_COMERCIAL antes de liberarse a Bodega.");
    }
    if (!order?.customerId) errors.push("Falta cliente principal.");
    if (!localSale && !order?.brandId) errors.push("Falta marca / cliente final.");
    if (!String(order?.destination || "").trim()) errors.push("Falta destino.");
    if (!localSale && !String(order?.agencyId || "").trim()) errors.push("Falta agencia de carga.");
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
    if (!localSale && brand?.requiresPo && (order?.lines || []).some(line => !String(line.po || order.generalPo || "").trim())) {
      errors.push("La marca requiere PO en todas las lineas o un PO general.");
    }
    if (!localSale && normalize(order?.transportType) === "AEREO" && !String(order?.daeNumber || "").trim()) {
      errors.push("El pedido aereo requiere DAE antes de liberarse a Bodega.");
    }
    if (!localSale && ["AEREO", "TERRESTRE"].includes(normalize(order?.transportType))) {
      const awbDigits = BlessERP.comercialUtils?.getAwbDigits?.(order?.awb) || String(order?.awb || "").replace(/\D/g, "");
      if (!awbDigits && !String(order?.sriGuides || "").trim()) {
        warnings.push("AWB pendiente; Bodega puede iniciar el armado.");
      } else if (awbDigits && awbDigits.length !== 11) {
        warnings.push("AWB incompleta: debe contener 3 digitos de aerolinea y 8 complementarios.");
      } else if (awbDigits && !BlessERP.comercialUtils?.findAirlineByAwb?.(order.awb)) {
        warnings.push(`Prefijo AWB ${awbDigits.slice(0, 3)} no parametrizado en Lineas aereas.`);
      }
      if (!String(order?.hawb || order?.sriGuides || "").trim()) warnings.push("HAWB pendiente; Bodega puede iniciar el armado.");
      if (!String(order?.airlineId || "").trim()) warnings.push("Linea aerea pendiente; puede completarse antes de las etiquetas finales.");
    }
    if (normalize(order?.transportType) === "MARITIMO" && !String(order?.daeNumber || "").trim()) {
      warnings.push("Pedido maritimo: la DAE fiscal se completara al emitir en Documentos electronicos SRI.");
    }
    const risk = appState ? BlessERP.operacionesAvailabilityPolicy?.evaluateOrderRisk?.(appState, order) : null;
    if (risk?.hasRisk) {
      warnings.push(`Alerta informativa: esta venta puede afectar ${risk.risks.reduce((sum, item) => sum + item.riskBunches, 0)} ramo(s) de pedidos futuros. La venta no queda bloqueada.`);
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
      moduleOrigin: "Operaciones / Cuarto frío",
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
    const validation = validateRelease(summary.order, appState);
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
      .filter(order => orderContributesDemand(order, appState))
      .map(buildOrderFulfillment)
      .filter(summary => summary && OPEN_WAREHOUSE_STATUSES.has(normalize(summary.warehouseStatus)))
      .sort((left, right) => {
        const leftDate = left.order.warehouseReleasedAt || left.order.issuedAt || "";
        const rightDate = right.order.warehouseReleasedAt || right.order.issuedAt || "";
        return leftDate.localeCompare(rightDate) || left.order.number.localeCompare(right.order.number);
      });
  }

  function releaseOrderForCancellation(appState, order, reason = "", user = "Usuario comercial") {
    if (!order) return { ok: false, error: "El pedido no existe." };
    ensureWarehouseFields(order);
    const store = getOperationsStore(appState);
    const scans = (order.lines || []).flatMap(line => (
      (Array.isArray(line.scannedBunches) ? line.scannedBunches : []).map(scan => ({ line, scan }))
    ));
    const inventoryById = new Map((store?.roseInventory || []).map(item => [String(item.inventoryId || ""), item]));
    const inventoryByCode = new Map((store?.roseInventory || []).map(item => [
      normalizeBunchBarcodeCode(item.labelCode || item.code),
      item
    ]));
    const dispatched = scans
      .map(({ scan }) => inventoryById.get(String(scan.inventoryId || "")) || inventoryByCode.get(normalizeBunchBarcodeCode(scan.code)))
      .filter(item => normalize(item?.state) === "DESPACHADO");
    if (dispatched.length) {
      return {
        ok: false,
        error: `No se puede anular: ${dispatched.length} ramo(s) ya constan como despachados. Primero debe reversarse el despacho fisico.`
      };
    }

    let releasedBunches = 0;
    let staleAssignments = 0;
    const releasedAt = nowLabel();
    scans.forEach(({ scan }) => {
      const inventory = inventoryById.get(String(scan.inventoryId || ""))
        || inventoryByCode.get(normalizeBunchBarcodeCode(scan.code));
      if (!inventory) {
        staleAssignments += 1;
        return;
      }
      const belongsToOrder = String(inventory.assignedOrderId || "") === String(order.id);
      const legacyAssignment = !inventory.assignedOrderId && normalize(inventory.state) === "ASIGNADO_CAJA";
      if (!belongsToOrder && !legacyAssignment) {
        staleAssignments += 1;
        return;
      }
      inventory.state = "DISPONIBLE";
      inventory.assignedOrderId = "";
      inventory.assignedBoxNumber = "";
      inventory.assignedLineId = "";
      inventory.assignedAt = "";
      inventory.releasedAt = releasedAt;
      inventory.releasedBy = user;
      inventory.releaseReason = String(reason || "").trim();
      inventory.assignmentHistory = Array.isArray(inventory.assignmentHistory) ? inventory.assignmentHistory : [];
      inventory.assignmentHistory.unshift({
        pedidoId: order.id,
        pedidoNumero: order.number,
        releasedAt,
        releasedBy: user,
        reason: String(reason || "").trim(),
        action: "LIBERADO_POR_ANULACION"
      });
      inventory.observation = `Disponible nuevamente por anulacion de ${order.number}. Motivo: ${String(reason || "").trim() || "No especificado"}.`;
      synchronizePermanentBunchEntry(getOperationsStore(appState), inventory);
      releasedBunches += 1;
    });

    (order.lines || []).forEach(line => {
      line.scannedBunches = [];
      line.fulfillmentStatus = "PENDIENTE";
      refreshMixedActualComposition(line);
    });
    order.boxFulfillment = {};
    order.warehouseStatus = "ANULADO";
    order.fulfillmentStatus = "ANULADO";
    order.warehouseCancelledAt = releasedAt;
    order.warehouseCancelledBy = user;
    order.warehouseCancellationReason = String(reason || "").trim();
    recordHistory(
      order,
      "ANULAR_PREPARACION_BODEGA",
      `Pedido retirado de Despacho. ${releasedBunches} ramo(s) regresaron a disponibilidad${staleAssignments ? `; ${staleAssignments} lectura(s) antigua(s) no tenian asignacion activa` : ""}.`
    );

    const availabilityState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    BlessERP.operacionesState?.synchronizeAvailabilityFromInventory?.(availabilityState);
    return { ok: true, releasedBunches, staleAssignments };
  }

  function inspectBoxReleaseForCancellation(appState, order, boxNumber, sourceLines = null) {
    if (!order) return { ok: false, error: "El pedido no existe." };
    const numericBox = parseNumber(boxNumber);
    const lines = (Array.isArray(sourceLines) ? sourceLines : order.lines || [])
      .filter(line => parseNumber(line.boxNumber) === numericBox);
    if (!numericBox || !lines.length) return { ok: false, error: `La caja ${numericBox || "seleccionada"} no existe.` };

    const store = getOperationsStore(appState);
    const inventoryRows = store?.roseInventory || [];
    const inventoryById = new Map(inventoryRows.map(item => [String(item.inventoryId || ""), item]));
    const inventoryByCode = new Map(inventoryRows.map(item => [
      normalizeBunchBarcodeCode(item.labelCode || item.code),
      item
    ]));
    const scans = lines.flatMap(line => (
      (Array.isArray(line.scannedBunches) ? line.scannedBunches : []).map(scan => ({ line, scan }))
    ));
    const resolved = scans.map(({ line, scan }) => ({
      line,
      scan,
      inventory: inventoryById.get(String(scan.inventoryId || ""))
        || inventoryByCode.get(normalizeBunchBarcodeCode(scan.code))
        || null
    }));
    const dispatched = resolved.filter(item => normalize(item.inventory?.state) === "DESPACHADO");
    if (dispatched.length) {
      return {
        ok: false,
        error: `No se puede retirar la caja ${numericBox}: ${dispatched.length} ramo(s) ya constan como despachados fisicamente. Primero debe reversarse el despacho.`,
        dispatched: dispatched.length
      };
    }
    return { ok: true, numericBox, lines, scans, resolved };
  }

  function releaseBoxForCancellation(appState, order, boxNumber, reason = "", user = "Usuario comercial", sourceLines = null) {
    const review = inspectBoxReleaseForCancellation(appState, order, boxNumber, sourceLines);
    if (!review.ok) return review;

    const releasedAt = nowLabel();
    let releasedBunches = 0;
    let staleAssignments = 0;
    review.resolved.forEach(({ scan, inventory }) => {
      if (!inventory) {
        staleAssignments += 1;
        return;
      }
      const belongsToOrder = String(inventory.assignedOrderId || "") === String(order.id);
      const belongsToBox = parseNumber(inventory.assignedBoxNumber) === review.numericBox;
      const legacyAssignment = !inventory.assignedOrderId && normalize(inventory.state) === "ASIGNADO_CAJA";
      if ((!belongsToOrder || !belongsToBox) && !legacyAssignment) {
        staleAssignments += 1;
        return;
      }
      inventory.state = "DISPONIBLE";
      inventory.assignedOrderId = "";
      inventory.assignedBoxNumber = "";
      inventory.assignedLineId = "";
      inventory.assignedAt = "";
      inventory.releasedAt = releasedAt;
      inventory.releasedBy = user;
      inventory.releaseReason = String(reason || "").trim();
      inventory.assignmentHistory = Array.isArray(inventory.assignmentHistory) ? inventory.assignmentHistory : [];
      inventory.assignmentHistory.unshift({
        pedidoId: order.id,
        pedidoNumero: order.number,
        boxNumber: review.numericBox,
        labelCode: scan.code || inventory.labelCode || "",
        releasedAt,
        releasedBy: user,
        reason: String(reason || "").trim(),
        action: "LIBERADO_POR_RETIRO_CAJA"
      });
      inventory.observation = `Disponible nuevamente por retiro de la caja ${review.numericBox} del pedido ${order.number}. Motivo: ${String(reason || "").trim() || "No especificado"}.`;
      synchronizePermanentBunchEntry(getOperationsStore(appState), inventory);
      releasedBunches += 1;
    });

    if (order.boxFulfillment && typeof order.boxFulfillment === "object") {
      delete order.boxFulfillment[review.numericBox];
      delete order.boxFulfillment[String(review.numericBox)];
    }
    recordHistory(
      order,
      "RETIRAR_CAJA_PEDIDO",
      `Caja ${review.numericBox} retirada antes de facturar. ${releasedBunches} ramo(s) regresaron a disponibilidad${staleAssignments ? `; ${staleAssignments} lectura(s) no tenian asignacion activa` : ""}. Motivo: ${String(reason || "").trim() || "No especificado"}.`
    );

    const availabilityState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    BlessERP.operacionesState?.synchronizeAvailabilityFromInventory?.(availabilityState);
    return { ok: true, boxNumber: review.numericBox, releasedBunches, staleAssignments, releasedAt };
  }

  function findInventoryBunch(appState, code) {
    const clean = normalizeBunchBarcodeCode(code);
    const store = getOperationsStore(appState);
    const current = (store?.roseInventory || []).find(item => normalizeBunchBarcodeCode(item.labelCode || item.code) === clean) || null;
    if (current) return current;
    const inventorySourceState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    return BlessERP.operacionesState?.findScannedInventoryByCode?.(inventorySourceState, clean) || null;
  }

  function synchronizePermanentBunchEntry(store, inventory) {
    if (!store || !inventory) return;
    const code = normalizeBunchBarcodeCode(inventory.labelCode || inventory.code);
    const entry = (store.bunchEntries || []).find(item => (
      String(item.inventoryId || "") === String(inventory.inventoryId || "")
      || normalizeBunchBarcodeCode(item.code || item.labelCode) === code
    ));
    if (!entry) return;
    entry.intakeState = entry.intakeState || "INGRESADO_POR_ESCANEO";
    entry.admissionSource = entry.admissionSource || "ESCANEO_ETIQUETA";
    entry.operationalState = inventory.state || entry.operationalState || "DISPONIBLE";
  }

  function findScannedCode(appState, code) {
    const clean = normalizeBunchBarcodeCode(code);
    for (const order of getOrders(appState)) {
      for (const line of order.lines || []) {
        const scan = (line.scannedBunches || []).find(item => normalizeBunchBarcodeCode(item.code) === clean);
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
    const digitCount = bunchBarcodeDigitCount(code);
    const cleanCode = normalizeBunchBarcodeCode(code);
    const structured = BlessERP.bunchLabelCodec?.isStructuredCode?.(cleanCode) || false;
    if ((!structured && (digitCount < 10 || !/^\d{10}$/.test(cleanCode))) || (structured && !BlessERP.bunchLabelCodec.decode(cleanCode, getOperationsStore(appState))?.ok)) {
      return {
        ok: false,
        error: structured ? "El código BF está incompleto o su composición no es válida." : `Lectura incompleta: se recibieron ${digitCount} de 10 digitos. Vuelva a escanear la etiqueta completa.`,
        result: "FORMATO_INVALIDO",
        scannedCode: String(code || "")
      };
    }
    const duplicate = findScannedCode(appState, cleanCode);
    if (duplicate) return { ok: false, error: `El ramo ya fue usado en ${duplicate.order.number}, caja ${duplicate.line.boxNumber}.`, result: "DUPLICADO" };
    // Resolve the order after duplicate validation so all mutations use the latest normalized store references.
    const summary = getOrderFulfillment(appState, orderId);
    if (!summary) return { ok: false, error: "La orden no existe." };
    if (normalize(summary.warehouseStatus) === "NO_LIBERADO") {
      summary.order.warehouseStatus = "PENDIENTE_ARMADO";
      summary.order.fulfillmentStatus = "PENDIENTE_ARMADO";
      recordHistory(summary.order, "INICIAR_ARMADO_DIRECTO", "El armado se inicio directamente con la primera lectura, sin liberacion manual previa.");
    }
    const inventory = findInventoryBunch(appState, cleanCode);
    if (!inventory) {
      return {
        ok: false,
        error: `El codigo ${cleanCode} fue leido completo, pero no corresponde a un ramo ingresado al inventario por escaneo.`,
        result: "NO_ENCONTRADO",
        scannedCode: cleanCode
      };
    }
    if (normalize(inventory.state) !== "DISPONIBLE") {
      return { ok: false, error: `El ramo no esta disponible para armado: ${inventory.state}.`, result: "NO_DISPONIBLE" };
    }
    const box = summary.boxes.find(item => item.boxNumber === parseNumber(boxNumber));
    if (!box) return { ok: false, error: "Seleccione una caja existente de la orden." };
    if (box.status === "CERRADA_BODEGA") return { ok: false, error: "La caja ya fue cerrada por Bodega." };
    const boxWasComplete = Boolean(box.automaticComplete);
    const target = box.lines.find(item => item.pending > 0 && lineAcceptsInventory(item.line, inventory));
    if (!target) {
      return { ok: false, error: `El ramo ${inventory.variety} ${inventory.length} cm / ${inventory.stemsPerBunch} tallos no corresponde a una linea pendiente de la caja ${box.boxNumber}.`, result: "NO_COINCIDE" };
    }

    const candidates = availableCompatibleBunches(appState, target.line);
    const oldest = candidates[0] || null;
    const fifoWarning = oldest && String(oldest.labelCode) !== cleanCode
      ? `Existe flor mas antigua disponible: ${oldest.labelCode}, ingreso ${oldest.admittedAt || oldest.date}. Revise su estado fisico antes de continuar.`
      : "";
    const stemsWarning = parseNumber(target.line.stemsPerBunch) !== parseNumber(inventory.stemsPerBunch)
      ? `La linea solicitaba ${parseNumber(target.line.stemsPerBunch)} tallos por ramo y la etiqueta contiene ${parseNumber(inventory.stemsPerBunch)}; se guardo la cantidad real escaneada.`
      : "";
    const scanWarning = [fifoWarning, stemsWarning].filter(Boolean).join(" ");

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
    synchronizePermanentBunchEntry(getOperationsStore(appState), inventory);
    const availabilityState = BlessERP.comercialIntercompany?.getAvailabilitySourceState
      ? BlessERP.comercialIntercompany.getAvailabilitySourceState(appState)
      : appState;
    BlessERP.operacionesState?.synchronizeAvailabilityFromInventory?.(availabilityState);
    recordBunchAssignmentEvent(appState, summary.order, box, target.line, inventory, cleanCode);
    summary.order.warehouseStatus = "EN_ARMADO";
    summary.order.fulfillmentStatus = "EN_ARMADO";
    recordHistory(summary.order, "ESCANEAR_RAMO_BODEGA", `Caja ${box.boxNumber}: ${cleanCode} · ${inventory.variety} ${inventory.length} cm.${scanWarning ? ` Advertencia: ${scanWarning}` : ""}`);
    const updated = getOrderFulfillment(appState, orderId);
    if (updated.allBoxesComplete) {
      updated.order.warehouseStatus = "COMPLETO_BODEGA";
      updated.order.fulfillmentStatus = "COMPLETO_BODEGA";
      updated.order.warehouseCompletedAt = nowLabel();
      recordHistory(updated.order, "COMPLETAR_ORDEN_BODEGA", "Todas las cajas se completaron automaticamente mediante escaneo de ramos.");
    }
    save();
    const finalSummary = getOrderFulfillment(appState, orderId);
    const finalBox = finalSummary?.boxes.find(item => item.boxNumber === box.boxNumber);
    return {
      ok: true,
      result: "RAMO_ASIGNADO",
      warning: scanWarning,
      boxNumber: box.boxNumber,
      lineId: target.line.id,
      inventory,
      boxCompleted: !boxWasComplete && Boolean(finalBox?.automaticComplete),
      orderCompleted: Boolean(finalSummary?.allBoxesComplete),
      summary: finalSummary
    };
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
    buildOrderFulfillment,
    closeBoxByWarehouse,
    acknowledgeOrderRevision,
    completeOrderByWarehouse,
    confirmBoxBySales,
    confirmOrderFulfillment,
    demandKeyForLine,
    getAvailabilityRows,
    getOrderCoverageRows,
    getFutureDemandRows,
    getFifoSuggestions,
    getPendingOrderChanges,
    getOrderFulfillment,
    getWarehouseOrders,
    isAnyLengthLine,
    isAnyLengthOpenMix,
    normalizeBunchBarcodeCode,
    orderContributesDemand,
    groupOrderBoxes,
    markBoxLabelPrinted,
    releaseOrderToWarehouse,
    releaseOrderForCancellation,
    inspectBoxReleaseForCancellation,
    releaseBoxForCancellation,
    scanBunchForOrder,
    validateRelease
  };
})();
