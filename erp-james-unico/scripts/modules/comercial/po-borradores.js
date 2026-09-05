(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;

  const STATUS = {
    BORRADOR: { label: "Borrador", tone: "pending" },
    CONFIRMADO: { label: "Confirmado", tone: "authorized" },
    PEDIDO_GENERADO: { label: "Pedido generado", tone: "partial" },
    ANULADO: { label: "Anulado", tone: "cancelled" }
  };
  const LINE_MODES = Object.freeze({
    INDIVIDUAL: "INDIVIDUAL",
    RANGE: "RANGO_IGUAL",
    MANUAL_MIX: "MIXTO_MANUAL",
    OPEN_MIX: "MIXTO_ABIERTO"
  });
  const LINE_MODE_LABELS = {
    [LINE_MODES.INDIVIDUAL]: "Caja individual",
    [LINE_MODES.RANGE]: "Rango igual",
    [LINE_MODES.MANUAL_MIX]: "Mixto manual",
    [LINE_MODES.OPEN_MIX]: "Mixto abierto"
  };
  const ANY_LENGTH = "CUALQUIER_MEDIDA";
  let noticeTimer = 0;

  function now() {
    return new Date().toISOString();
  }

  function today() {
    return BlessERP.utils.today();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function isAnyLength(value) {
    return value === true || [ANY_LENGTH, "TRUE", "1"].includes(String(value || "").trim().toUpperCase());
  }

  function createManualItem(seed = {}, index = 0) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-PO-MIX"),
      variety: seed.variety || (index === 0 ? "EXPLORER" : "MONDIAL"),
      length: Math.max(1, number(seed.length, 60)),
      anyLength: seed.anyLength === true || isAnyLength(seed.lengthSelection),
      bunches: Math.max(1, number(seed.bunches, 1)),
      stemsPerBunch: Math.max(1, number(seed.stemsPerBunch, 25)),
      unitPrice: Math.max(0, number(seed.unitPrice, 0))
    };
  }

  function createLine(seed = {}) {
    const inferredMode = number(seed.boxCount, 1) > 1 ? LINE_MODES.RANGE : LINE_MODES.INDIVIDUAL;
    const mode = Object.values(LINE_MODES).includes(seed.mode) ? seed.mode : inferredMode;
    const manualItems = Array.isArray(seed.manualItems) && seed.manualItems.length
      ? seed.manualItems
      : [createManualItem({}, 0), createManualItem({}, 1)];
    const anyLength = seed.anyLength !== undefined
      ? Boolean(seed.anyLength)
      : seed.lengthSelection !== undefined
        ? isAnyLength(seed.lengthSelection)
        : mode === LINE_MODES.OPEN_MIX;
    return {
      id: seed.id || BlessERP.utils.uid("COM-PO-LIN"),
      mode,
      boxCount: mode === LINE_MODES.INDIVIDUAL ? 1 : Math.min(200, Math.max(1, Math.floor(number(seed.boxCount, mode === LINE_MODES.RANGE ? 2 : 1)))),
      boxType: seed.boxType || "HB",
      variety: seed.variety || "EXPLORER",
      length: Math.max(1, number(seed.length, 60)),
      anyLength,
      bunchesPerBox: Math.max(1, number(seed.bunchesPerBox, 12)),
      stemsPerBunch: Math.max(1, number(seed.stemsPerBunch, 25)),
      unitPrice: Math.max(0, number(seed.unitPrice, 0)),
      excludedVarieties: String(seed.excludedVarieties || ""),
      manualItems: manualItems.map(createManualItem)
    };
  }

  function createPreorder(seed = {}) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-PO"),
      number: seed.number || "",
      customerPo: seed.customerPo || "",
      status: STATUS[seed.status] ? seed.status : "BORRADOR",
      createdAt: seed.createdAt || now(),
      updatedAt: seed.updatedAt || now(),
      confirmedAt: seed.confirmedAt || "",
      confirmedBy: seed.confirmedBy || "",
      generatedAt: seed.generatedAt || "",
      generatedBy: seed.generatedBy || "",
      linkedOrderId: seed.linkedOrderId || "",
      linkedOrderNumber: seed.linkedOrderNumber || "",
      annulledAt: seed.annulledAt || "",
      annulReason: seed.annulReason || "",
      reopenedAt: seed.reopenedAt || "",
      reopenReason: seed.reopenReason || "",
      customerId: seed.customerId || "",
      brandId: seed.brandId || "",
      scheduledDate: seed.scheduledDate || today(),
      transportType: seed.transportType || "aereo",
      destination: seed.destination || "",
      destinationCountry: seed.destinationCountry || "",
      agencyId: seed.agencyId || "",
      currency: seed.currency || "USD",
      notes: seed.notes || "",
      lines: Array.isArray(seed.lines) && seed.lines.length ? seed.lines.map(createLine) : [createLine()],
      history: Array.isArray(seed.history) ? seed.history.map(item => ({ ...item })) : []
    };
  }

  function nextPoNumber(preorders) {
    const year = String(new Date().getFullYear());
    const highest = (preorders || []).reduce((max, item) => {
      const match = String(item.number || "").match(/(\d+)$/);
      return Math.max(max, match ? Number(match[1]) || 0 : 0);
    }, 0);
    return `PO-${year}-${String(highest + 1).padStart(5, "0")}`;
  }

  function activeUser(appState) {
    return appState.db?.session?.activeUser?.name || "Usuario comercial";
  }

  function record(preorder, appState, action, description, reason = "") {
    preorder.history = Array.isArray(preorder.history) ? preorder.history : [];
    preorder.history.unshift({
      id: BlessERP.utils.uid("COM-PO-HIS"),
      at: now(),
      user: activeUser(appState),
      action,
      description,
      reason
    });
  }

  function ensureStore(appState) {
    const store = stateApi.getStore(appState);
    store.preorders = Array.isArray(store.preorders)
      ? store.preorders.map(item => createPreorder(item))
      : [];
    store.ui.currentPreorderId = String(store.ui.currentPreorderId || "");
    store.ui.preorderStatusFilter = String(store.ui.preorderStatusFilter || "TODOS");
    store.ui.preorderCustomerFilter = String(store.ui.preorderCustomerFilter || "");
    store.ui.preorderDateFilter = String(store.ui.preorderDateFilter || "");
    store.ui.preorderVarietyFilter = String(store.ui.preorderVarietyFilter || "");
    store.ui.preorderLengthFilter = String(store.ui.preorderLengthFilter || "");
    store.ui.preorderMixedOnly = Boolean(store.ui.preorderMixedOnly);
    store.ui.preorderNotice = String(store.ui.preorderNotice || "");
    store.ui.preorderNoticeTone = String(store.ui.preorderNoticeTone || "info");
    if (!store.preorders.some(item => item.id === store.ui.currentPreorderId)) {
      store.ui.currentPreorderId = store.preorders[0]?.id || "";
    }
    return store;
  }

  function save(appState) {
    BlessERP.state.saveDb();
  }

  function setNotice(appState, message, tone = "info") {
    const store = ensureStore(appState);
    store.ui.preorderNotice = message || "";
    store.ui.preorderNoticeTone = tone;
    if (message) BlessERP.layout?.toast?.(message, { tone });
    if (noticeTimer) clearTimeout(noticeTimer);
    if (message) {
      noticeTimer = setTimeout(() => {
        if (store.ui.preorderNotice === message && store.ui.preorderNoticeTone === tone) {
          store.ui.preorderNotice = "";
          store.ui.preorderNoticeTone = "info";
        }
        noticeTimer = 0;
      }, tone === "danger" ? 4600 : tone === "warning" ? 3400 : tone === "success" ? 1800 : 2400);
    }
  }

  function current(appState) {
    const store = ensureStore(appState);
    return store.preorders.find(item => item.id === store.ui.currentPreorderId) || null;
  }

  function createNew(appState) {
    const store = ensureStore(appState);
    const preorder = createPreorder({
      number: nextPoNumber(store.preorders),
      scheduledDate: today()
    });
    record(preorder, appState, "CREAR_PO", `${preorder.number} creado como borrador.`);
    store.preorders.unshift(preorder);
    store.ui.currentPreorderId = preorder.id;
    setNotice(appState, `${preorder.number} creado. Este borrador no afecta inventario, Bodega ni SRI.`, "info");
    return preorder;
  }

  function select(appState, preorderId) {
    const store = ensureStore(appState);
    if (!store.preorders.some(item => item.id === preorderId)) return false;
    store.ui.currentPreorderId = preorderId;
    setNotice(appState, "", "info");
    return true;
  }

  function updateField(appState, field, value) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    const allowed = [
      "customerId", "brandId", "scheduledDate", "transportType",
      "agencyId", "currency", "notes"
    ];
    if (!allowed.includes(field)) return false;
    preorder[field] = value;
    preorder.updatedAt = now();

    const store = ensureStore(appState);
    if (field === "customerId") {
      const brand = store.brandCatalog.find(item => item.id === preorder.brandId);
      if (brand && brand.customerId !== value) {
        preorder.brandId = "";
        preorder.destination = "";
        preorder.destinationCountry = "";
        preorder.agencyId = "";
      }
    }
    if (field === "brandId") {
      const brand = store.brandCatalog.find(item => item.id === value);
      if (brand) {
        preorder.customerId = brand.customerId || preorder.customerId;
        preorder.destination = brand.destination || brand.country || "";
        preorder.destinationCountry = brand.country || brand.destination || "";
        preorder.agencyId = brand.defaultAgencyId || "";
      } else {
        preorder.destination = "";
        preorder.destinationCountry = "";
        preorder.agencyId = "";
      }
    }
    return true;
  }

  function updateLine(appState, lineId, field, value) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    const line = preorder.lines.find(item => item.id === lineId);
    if (!line) return false;
    const numericFields = ["boxCount", "length", "bunchesPerBox", "stemsPerBunch", "unitPrice"];
    const textFields = ["boxType", "variety", "excludedVarieties"];
    if (field === "lengthSelection") {
      line.anyLength = isAnyLength(value);
      if (!line.anyLength) line.length = Math.max(1, number(value, line.length || 60));
      preorder.updatedAt = now();
      return true;
    }
    if (numericFields.includes(field)) {
      line[field] = field === "unitPrice"
        ? Math.max(0, number(value, 0))
        : Math.max(1, number(value, 1));
      if (field === "boxCount") {
        line.boxCount = line.mode === LINE_MODES.INDIVIDUAL
          ? 1
          : Math.min(200, Math.floor(line.boxCount));
      }
    } else if (textFields.includes(field)) {
      line[field] = field === "excludedVarieties"
        ? String(value || "")
        : String(value || "").toUpperCase();
    } else {
      return false;
    }
    preorder.updatedAt = now();
    return true;
  }

  function addLine(appState, mode = LINE_MODES.INDIVIDUAL) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    const previous = preorder.lines.at(-1) || {};
    preorder.lines.push(createLine({
      mode: Object.values(LINE_MODES).includes(mode) ? mode : LINE_MODES.INDIVIDUAL,
      boxCount: mode === LINE_MODES.RANGE ? 2 : 1,
      boxType: previous.boxType,
      length: previous.length,
      bunchesPerBox: previous.bunchesPerBox,
      stemsPerBunch: previous.stemsPerBunch,
      unitPrice: previous.unitPrice,
      anyLength: mode === LINE_MODES.OPEN_MIX
    }));
    preorder.updatedAt = now();
    return true;
  }

  function updateManualItem(appState, lineId, itemId, field, value) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    const line = preorder.lines.find(item => item.id === lineId);
    const item = line?.manualItems?.find(entry => entry.id === itemId);
    if (!line || line.mode !== LINE_MODES.MANUAL_MIX || !item) return false;
    if (field === "lengthSelection") {
      item.anyLength = isAnyLength(value);
      if (!item.anyLength) item.length = Math.max(1, number(value, item.length || 60));
    } else if (["length", "bunches", "stemsPerBunch", "unitPrice"].includes(field)) {
      item[field] = field === "unitPrice"
        ? Math.max(0, number(value, 0))
        : Math.max(1, number(value, 1));
    } else if (field === "variety") {
      item.variety = String(value || "").toUpperCase();
    } else {
      return false;
    }
    preorder.updatedAt = now();
    return true;
  }

  function addManualItem(appState, lineId) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    const line = preorder.lines.find(item => item.id === lineId);
    if (!line || line.mode !== LINE_MODES.MANUAL_MIX) return false;
    line.manualItems.push(createManualItem({}, line.manualItems.length));
    preorder.updatedAt = now();
    return true;
  }

  function deleteManualItem(appState, lineId, itemId) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    const line = preorder.lines.find(item => item.id === lineId);
    if (!line || line.mode !== LINE_MODES.MANUAL_MIX || line.manualItems.length <= 2) return false;
    line.manualItems = line.manualItems.filter(item => item.id !== itemId);
    preorder.updatedAt = now();
    return true;
  }

  function deleteLine(appState, lineId) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR" || preorder.lines.length <= 1) return false;
    preorder.lines = preorder.lines.filter(item => item.id !== lineId);
    preorder.updatedAt = now();
    return true;
  }

  function validate(preorder) {
    const errors = [];
    if (!preorder.customerId) errors.push("Seleccione el cliente principal.");
    if (!preorder.brandId) errors.push("Seleccione la marca / cliente final.");
    if (!preorder.scheduledDate) errors.push("Ingrese la fecha prevista.");
    if (!preorder.lines.length) errors.push("Agregue al menos una línea.");
    preorder.lines.forEach((line, index) => {
      const prefix = `Línea ${index + 1}`;
      if (!Object.values(LINE_MODES).includes(line.mode)) errors.push(`${prefix}: modalidad inválida.`);
      if (!Number.isInteger(line.boxCount) || line.boxCount < 1 || line.boxCount > 200) errors.push(`${prefix}: las cajas deben estar entre 1 y 200.`);
      if (!data.boxTypes.some(item => item.code === line.boxType)) errors.push(`${prefix}: tipo de caja inválido.`);
      if ([LINE_MODES.INDIVIDUAL, LINE_MODES.RANGE].includes(line.mode)) {
        if (!line.variety.trim()) errors.push(`${prefix}: falta variedad.`);
        if (!line.anyLength && line.length <= 0) errors.push(`${prefix}: medida inválida.`);
        if (line.bunchesPerBox <= 0 || line.stemsPerBunch <= 0) errors.push(`${prefix}: complete ramos y tallos por ramo.`);
        if (line.unitPrice <= 0) errors.push(`${prefix}: ingrese precio por tallo.`);
      }
      if (line.mode === LINE_MODES.MANUAL_MIX) {
        if (!Array.isArray(line.manualItems) || line.manualItems.length < 2) errors.push(`${prefix}: el mixto manual necesita al menos dos variedades.`);
        (line.manualItems || []).forEach((item, itemIndex) => {
          if (!item.variety.trim()) errors.push(`${prefix}, variedad ${itemIndex + 1}: falta variedad.`);
          if (!item.anyLength && item.length <= 0) errors.push(`${prefix}, variedad ${itemIndex + 1}: medida inválida.`);
          if (item.bunches <= 0 || item.stemsPerBunch <= 0) errors.push(`${prefix}, variedad ${itemIndex + 1}: complete ramos y tallos.`);
          if (item.unitPrice <= 0) errors.push(`${prefix}, variedad ${itemIndex + 1}: ingrese precio por tallo.`);
        });
      }
      if (line.mode === LINE_MODES.OPEN_MIX) {
        if (!line.anyLength && line.length <= 0) errors.push(`${prefix}: medida inválida.`);
        if (line.bunchesPerBox <= 0 || line.stemsPerBunch <= 0) errors.push(`${prefix}: complete ramos y tallos por ramo.`);
        if (line.unitPrice <= 0) errors.push(`${prefix}: ingrese precio común por tallo.`);
      }
    });
    return errors;
  }

  function saveDraft(appState) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    preorder.updatedAt = now();
    record(preorder, appState, "GUARDAR_BORRADOR", `${preorder.number} guardado como borrador.`);
    setNotice(appState, `${preorder.number} guardado. No se afectó ninguna otra parte del sistema.`, "success");
    save(appState);
    return true;
  }

  function confirm(appState) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "BORRADOR") return false;
    const errors = validate(preorder);
    if (errors.length) {
      setNotice(appState, errors[0], "warning");
      return false;
    }
    preorder.status = "CONFIRMADO";
    preorder.confirmedAt = now();
    preorder.confirmedBy = activeUser(appState);
    preorder.updatedAt = now();
    record(preorder, appState, "CONFIRMAR_PO", `${preorder.number} confirmado. Ya puede generar un pedido.`);
    setNotice(appState, `${preorder.number} confirmado. Use “Generar pedido” para continuar en Crear pedido.`, "success");
    save(appState);
    return true;
  }

  function reopen(appState, reason) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "CONFIRMADO" || !String(reason || "").trim()) return false;
    preorder.status = "BORRADOR";
    preorder.reopenedAt = now();
    preorder.reopenReason = String(reason).trim();
    preorder.updatedAt = now();
    record(preorder, appState, "REABRIR_PO", `${preorder.number} reabierto como borrador.`, preorder.reopenReason);
    setNotice(appState, `${preorder.number} volvió a borrador.`, "warning");
    save(appState);
    return true;
  }

  function annul(appState, reason) {
    const preorder = current(appState);
    if (!preorder || preorder.status === "PEDIDO_GENERADO" || preorder.status === "ANULADO" || !String(reason || "").trim()) return false;
    preorder.status = "ANULADO";
    preorder.annulledAt = now();
    preorder.annulReason = String(reason).trim();
    preorder.updatedAt = now();
    record(preorder, appState, "ANULAR_PO", `${preorder.number} anulado sin afectar pedidos, inventario ni SRI.`, preorder.annulReason);
    setNotice(appState, `${preorder.number} anulado. No se eliminó y conserva su historial.`, "warning");
    save(appState);
    return true;
  }

  function expandOrderLines(preorder) {
    let boxNumber = 0;
    const lines = [];
    preorder.lines.forEach(poLine => {
      for (let boxIndex = 0; boxIndex < poLine.boxCount; boxIndex += 1) {
        boxNumber += 1;
        const groupId = `PO-${poLine.id}`;
        const firstBox = boxNumber - boxIndex;
        const lastBox = firstBox + poLine.boxCount - 1;
        const common = {
          boxNumber,
          boxType: poLine.boxType,
          // El numero del PO interno identifica solamente este borrador. El PO
          // solicitado por el cliente se digita despues, manualmente, en Crear
          // pedido y es el unico que puede mostrarse en la factura.
          po: "",
          boxRangeId: groupId,
          boxRangeSequence: boxIndex + 1,
          boxRangeTotal: poLine.boxCount,
          boxRangeLabel: `Cajas ${firstBox}-${lastBox}`,
          boxBuildGroupId: groupId,
          addedRevision: 1,
          state: "borrador"
        };
        if ([LINE_MODES.INDIVIDUAL, LINE_MODES.RANGE].includes(poLine.mode)) {
          lines.push(data.createLine({
            ...common,
            boxBuildMode: poLine.mode,
            variety: poLine.variety,
            length: poLine.length,
            anyLength: Boolean(poLine.anyLength),
            bunches: poLine.bunchesPerBox,
            stemsPerBunch: poLine.stemsPerBunch,
            unitPrice: poLine.unitPrice
          }));
        }
        if (poLine.mode === LINE_MODES.MANUAL_MIX) {
          poLine.manualItems.forEach(item => lines.push(data.createLine({
            ...common,
            boxBuildMode: LINE_MODES.MANUAL_MIX,
            variety: item.variety,
            length: item.length,
            anyLength: Boolean(item.anyLength),
            bunches: item.bunches,
            stemsPerBunch: item.stemsPerBunch,
            unitPrice: item.unitPrice
          })));
        }
        if (poLine.mode === LINE_MODES.OPEN_MIX) {
          lines.push(data.createLine({
            ...common,
            boxBuildMode: LINE_MODES.OPEN_MIX,
            variety: "MIXTO ABIERTO",
            length: poLine.length,
            anyLength: Boolean(poLine.anyLength),
            bunches: poLine.bunchesPerBox,
            stemsPerBunch: poLine.stemsPerBunch,
            unitPrice: poLine.unitPrice,
            mixedAnyLength: Boolean(poLine.anyLength),
            mixedExcludedVarieties: [...new Set(String(poLine.excludedVarieties || "").split(/[,;\n]/).map(item => item.trim().toUpperCase()).filter(Boolean))],
            mixedActualComposition: []
          }));
        }
      }
    });
    return lines;
  }

  function generateOrder(appState) {
    const preorder = current(appState);
    if (!preorder || preorder.status !== "CONFIRMADO" || preorder.linkedOrderId) return null;
    const preorderId = preorder.id;
    const order = stateApi.createNewOrder(appState, {
      customerId: preorder.customerId,
      brandId: preorder.brandId,
      destination: preorder.destination,
      destinationCountry: preorder.destinationCountry,
      agencyId: preorder.agencyId,
      flightDate: preorder.scheduledDate,
      transportType: preorder.transportType,
      currency: preorder.currency,
      generalPo: "",
      sourcePoId: preorder.id,
      sourcePoNumber: preorder.number,
      generatedFromPoAt: now(),
      notes: [
        `Generado desde ${preorder.number}.`,
        preorder.notes
      ].filter(Boolean).join(" "),
      lines: expandOrderLines(preorder)
    });
    if (!order) return null;

    const generatedPreorder = ensureStore(appState).preorders.find(item => item.id === preorderId);
    if (!generatedPreorder) return order;
    generatedPreorder.status = "PEDIDO_GENERADO";
    generatedPreorder.generatedAt = now();
    generatedPreorder.generatedBy = activeUser(appState);
    generatedPreorder.linkedOrderId = order.id;
    generatedPreorder.linkedOrderNumber = order.number;
    generatedPreorder.updatedAt = now();
    record(generatedPreorder, appState, "GENERAR_PEDIDO", `${order.number} generado desde ${generatedPreorder.number}.`);
    save(appState);
    BlessERP.state.setRoute("commercial-order-master");
    BlessERP.layout.renderApp();
    return order;
  }

  function lineMetrics(line) {
    if (line.mode === LINE_MODES.MANUAL_MIX) {
      const perBox = line.manualItems.reduce((totals, item) => {
        const stems = item.bunches * item.stemsPerBunch;
        totals.bunches += item.bunches;
        totals.stems += stems;
        totals.totalUsd += stems * item.unitPrice;
        return totals;
      }, { bunches: 0, stems: 0, totalUsd: 0 });
      return {
        totalBunches: perBox.bunches * line.boxCount,
        totalStems: perBox.stems * line.boxCount,
        totalUsd: perBox.totalUsd * line.boxCount
      };
    }
    const totalBunches = line.boxCount * line.bunchesPerBox;
    const totalStems = totalBunches * line.stemsPerBunch;
    return {
      totalBunches,
      totalStems,
      totalUsd: totalStems * line.unitPrice
    };
  }

  function metrics(preorder) {
    return preorder.lines.reduce((totals, line) => {
      const currentLine = lineMetrics(line);
      totals.boxes += line.boxCount;
      totals.bunches += currentLine.totalBunches;
      totals.stems += currentLine.totalStems;
      totals.totalUsd += currentLine.totalUsd;
      return totals;
    }, { boxes: 0, bunches: 0, stems: 0, totalUsd: 0 });
  }

  function displayCustomer(customer) {
    return customer?.commercialName || customer?.legalName || customer?.code || "Sin cliente";
  }

  function option(value, label, selected) {
    return `<option value="${utils.esc(value)}" ${value === selected ? "selected" : ""}>${utils.esc(label)}</option>`;
  }

  function lineVarieties(line) {
    if (line.mode === LINE_MODES.MANUAL_MIX) return line.manualItems.map(item => item.variety).filter(Boolean);
    if (line.mode === LINE_MODES.OPEN_MIX) return ["MIXTO ABIERTO"];
    return [line.variety].filter(Boolean);
  }

  function lineLengths(line) {
    if (line.mode === LINE_MODES.MANUAL_MIX) {
      return line.manualItems.map(item => item.anyLength ? ANY_LENGTH : String(item.length)).filter(Boolean);
    }
    return [line.anyLength ? ANY_LENGTH : String(line.length)].filter(Boolean);
  }

  function isMixedLine(line) {
    return [LINE_MODES.MANUAL_MIX, LINE_MODES.OPEN_MIX].includes(line.mode);
  }

  function filteredPreorders(store) {
    const ui = store.ui;
    return store.preorders.filter(preorder => {
      const lines = preorder.lines || [];
      if (ui.preorderStatusFilter !== "TODOS" && preorder.status !== ui.preorderStatusFilter) return false;
      if (ui.preorderCustomerFilter && preorder.customerId !== ui.preorderCustomerFilter) return false;
      if (ui.preorderDateFilter && preorder.scheduledDate !== ui.preorderDateFilter) return false;
      if (ui.preorderMixedOnly && !lines.some(isMixedLine)) return false;
      if (ui.preorderVarietyFilter && !lines.some(line => lineVarieties(line).includes(ui.preorderVarietyFilter))) return false;
      if (ui.preorderLengthFilter && !lines.some(line => lineLengths(line).includes(ui.preorderLengthFilter))) return false;
      return true;
    });
  }

  function renderNotice(store) {
    if (!store.ui.preorderNotice) return "";
    return "";
  }

  function renderList(store) {
    const ui = store.ui;
    const rows = filteredPreorders(store);
    const customerIds = [...new Set(store.preorders.map(item => item.customerId).filter(Boolean))];
    const varieties = [...new Set(store.preorders.flatMap(item => item.lines.flatMap(lineVarieties)).filter(Boolean))].sort();
    const lengths = [...new Set(store.preorders.flatMap(item => item.lines.flatMap(lineLengths)).filter(Boolean))]
      .sort((left, right) => left === ANY_LENGTH ? 1 : right === ANY_LENGTH ? -1 : number(left) - number(right));
    const filterActive = ui.preorderCustomerFilter || ui.preorderDateFilter || ui.preorderVarietyFilter || ui.preorderLengthFilter || ui.preorderMixedOnly || ui.preorderStatusFilter !== "TODOS";
    return `
      <section class="panel-card po-list-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BANDEJA PO</p>
            <h3>Borradores y confirmados</h3>
          </div>
          <span class="status-badge partial">${utils.esc(rows.length)}</span>
        </div>
        <div class="po-filter-toolbar" aria-label="Filtros de PO">
          <div class="po-filter-buttons">
            ${["TODOS", ...Object.keys(STATUS)].map(status => `
              <button type="button" class="po-filter-chip ${ui.preorderStatusFilter === status ? "active" : ""}" data-po-status-button="${utils.esc(status)}">
                ${utils.esc(status === "TODOS" ? "Todos" : STATUS[status].label)}
              </button>
            `).join("")}
          </div>
          <select class="po-filter-control" data-po-list-filter="preorderCustomerFilter" aria-label="Filtrar por cliente">
            <option value="">Cliente: todos</option>
            ${customerIds.map(customerId => {
              const customer = store.customerCatalog.find(item => item.id === customerId);
              return option(customerId, displayCustomer(customer), ui.preorderCustomerFilter);
            }).join("")}
          </select>
          <input class="po-filter-control" type="date" value="${utils.esc(ui.preorderDateFilter)}" data-po-list-filter="preorderDateFilter" aria-label="Filtrar por fecha">
          <select class="po-filter-control" data-po-list-filter="preorderVarietyFilter" aria-label="Filtrar por variedad">
            <option value="">Variedad: todas</option>
            ${varieties.map(item => option(item, item, ui.preorderVarietyFilter)).join("")}
          </select>
          <select class="po-filter-control" data-po-list-filter="preorderLengthFilter" aria-label="Filtrar por medida">
            <option value="">Medida: todas</option>
            ${lengths.map(item => option(item, item === ANY_LENGTH ? "Cualquier medida" : `${item} cm`, ui.preorderLengthFilter)).join("")}
          </select>
          <button type="button" class="po-filter-chip ${ui.preorderMixedOnly ? "active" : ""}" data-po-mixed-filter>Solo mixtos</button>
          ${filterActive ? `<button type="button" class="po-filter-chip clear" data-po-clear-filters>Limpiar</button>` : ""}
        </div>
        <div class="po-list">
          ${rows.map(item => {
            const customer = store.customerCatalog.find(customerItem => customerItem.id === item.customerId);
            return `
              <button type="button" class="po-list-item ${item.id === store.ui.currentPreorderId ? "active" : ""}" data-po-select="${utils.esc(item.id)}">
                <span>
                  <strong>${utils.esc(item.number)}</strong>
                  <small>${utils.esc(displayCustomer(customer))} · ${utils.esc(item.scheduledDate || "Sin fecha")}</small>
                </span>
                <span class="status-badge ${STATUS[item.status]?.tone || "pending"}">${utils.esc(STATUS[item.status]?.label || item.status)}</span>
              </button>
            `;
          }).join("") || `<div class="base-ready-item"><strong>Sin PO</strong><span>No hay registros para este filtro.</span></div>`}
        </div>
      </section>
    `;
  }

  function varietyOptions(selected) {
    return [...new Set([...(data.varieties || []), selected].filter(Boolean))]
      .sort()
      .map(item => option(item, item, selected))
      .join("");
  }

  function lengthOptions(length, anyLength) {
    const values = [...new Set([40, 50, 60, 70, 80, 90, 100, number(length, 60)])].sort((left, right) => left - right);
    return [
      ...values.map(item => option(String(item), `${item} cm`, !anyLength ? String(length) : "")),
      option(ANY_LENGTH, "Cualquier medida", anyLength ? ANY_LENGTH : "")
    ].join("");
  }

  function boxTypeOptions(selected) {
    return (data.boxTypes || []).map(item => option(item.code, item.code, selected)).join("");
  }

  function renderManualItems(line, locked) {
    return `
      <div class="compact-table-wrap po-manual-items">
        <table class="compact-table po-lines-table">
          <thead><tr><th>Variedad</th><th>Medida</th><th>Ramos/caja</th><th>Tallos/ramo</th><th>Precio/tallo</th><th></th></tr></thead>
          <tbody>
            ${line.manualItems.map(item => `
              <tr>
                <td>
                  <select data-po-manual-field="${utils.esc(line.id)}|${utils.esc(item.id)}|variety" ${locked ? "disabled" : ""}>
                    ${varietyOptions(item.variety)}
                  </select>
                </td>
                <td>
                  <select data-po-manual-field="${utils.esc(line.id)}|${utils.esc(item.id)}|lengthSelection" ${locked ? "disabled" : ""}>
                    ${lengthOptions(item.length, item.anyLength)}
                  </select>
                </td>
                <td><input type="number" min="1" value="${utils.esc(item.bunches)}" data-po-manual-field="${utils.esc(line.id)}|${utils.esc(item.id)}|bunches" ${locked ? "disabled" : ""}></td>
                <td><input type="number" min="1" value="${utils.esc(item.stemsPerBunch)}" data-po-manual-field="${utils.esc(line.id)}|${utils.esc(item.id)}|stemsPerBunch" ${locked ? "disabled" : ""}></td>
                <td><input type="number" min="0" step="0.01" value="${utils.esc(item.unitPrice)}" data-po-manual-field="${utils.esc(line.id)}|${utils.esc(item.id)}|unitPrice" ${locked ? "disabled" : ""}></td>
                <td><button class="icon-action danger" type="button" data-po-delete-manual="${utils.esc(line.id)}|${utils.esc(item.id)}" ${locked || line.manualItems.length <= 2 ? "disabled" : ""} aria-label="Quitar variedad">×</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${locked ? "" : `<button class="secondary-button po-add-mix-item" type="button" data-po-add-manual="${utils.esc(line.id)}">Agregar variedad al mixto</button>`}
    `;
  }

  function renderLineEditor(line, index, locked, canDelete) {
    const total = lineMetrics(line);
    const commonFields = `
      <label class="compact-field">
        <span>Cajas</span>
        <input type="number" min="1" max="200" value="${utils.esc(line.boxCount)}" data-po-line-field="boxCount" data-po-line-id="${utils.esc(line.id)}" ${locked || line.mode === LINE_MODES.INDIVIDUAL ? "disabled" : ""}>
      </label>
      <label class="compact-field">
        <span>Tipo de caja</span>
        <select data-po-line-field="boxType" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>${boxTypeOptions(line.boxType)}</select>
      </label>
    `;
    const regularFields = `
      <label class="compact-field">
        <span>Variedad</span>
        <select data-po-line-field="variety" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>${varietyOptions(line.variety)}</select>
      </label>
      <label class="compact-field">
        <span>Medida</span>
        <select data-po-line-field="lengthSelection" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>${lengthOptions(line.length, line.anyLength)}</select>
      </label>
      <label class="compact-field">
        <span>Ramos/caja</span>
        <input type="number" min="1" value="${utils.esc(line.bunchesPerBox)}" data-po-line-field="bunchesPerBox" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>
      </label>
      <label class="compact-field">
        <span>Tallos/ramo</span>
        <input type="number" min="1" value="${utils.esc(line.stemsPerBunch)}" data-po-line-field="stemsPerBunch" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>
      </label>
      <label class="compact-field">
        <span>Precio/tallo</span>
        <input type="number" min="0" step="0.01" value="${utils.esc(line.unitPrice)}" data-po-line-field="unitPrice" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>
      </label>
    `;
    const openFields = `
      <label class="compact-field">
        <span>Medida permitida</span>
        <select data-po-line-field="lengthSelection" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>${lengthOptions(line.length, line.anyLength)}</select>
      </label>
      <label class="compact-field">
        <span>Ramos/caja</span>
        <input type="number" min="1" value="${utils.esc(line.bunchesPerBox)}" data-po-line-field="bunchesPerBox" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>
      </label>
      <label class="compact-field">
        <span>Tallos/ramo</span>
        <input type="number" min="1" value="${utils.esc(line.stemsPerBunch)}" data-po-line-field="stemsPerBunch" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>
      </label>
      <label class="compact-field">
        <span>Precio/tallo</span>
        <input type="number" min="0" step="0.01" value="${utils.esc(line.unitPrice)}" data-po-line-field="unitPrice" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""}>
      </label>
      <label class="compact-field po-line-wide">
        <span>Excluir variedades (opcional)</span>
        <input value="${utils.esc(line.excludedVarieties)}" data-po-line-field="excludedVarieties" data-po-line-id="${utils.esc(line.id)}" ${locked ? "disabled" : ""} placeholder="Ej. EXPLORER, MONDIAL">
      </label>
    `;
    return `
      <article class="po-line-group">
        <header class="po-line-group-head">
          <span class="po-line-mode">${utils.esc(LINE_MODE_LABELS[line.mode] || line.mode)}</span>
          <span>Línea ${utils.esc(index + 1)} · ${utils.esc(line.boxCount)} caja(s) · ${utils.esc(total.totalStems)} tallos</span>
          <button class="icon-action danger" type="button" data-po-delete-line="${utils.esc(line.id)}" ${locked || !canDelete ? "disabled" : ""} aria-label="Quitar línea">×</button>
        </header>
        <div class="po-line-group-grid">
          ${commonFields}
          ${[LINE_MODES.INDIVIDUAL, LINE_MODES.RANGE].includes(line.mode) ? regularFields : ""}
          ${line.mode === LINE_MODES.OPEN_MIX ? openFields : ""}
        </div>
        ${line.mode === LINE_MODES.MANUAL_MIX ? renderManualItems(line, locked) : ""}
      </article>
    `;
  }

  function renderEditor(store, preorder) {
    if (!preorder) {
      return `
        <section class="panel-card po-empty-card">
          <p class="section-kicker">PO NUEVO</p>
          <h3>Cree el primer borrador</h3>
          <p class="panel-note">El PO es opcional y no afecta inventario, Bodega, reservas ni Documentos electrónicos SRI.</p>
          <button class="primary-button" type="button" data-po-new>Nuevo PO</button>
        </section>
      `;
    }

    const locked = preorder.status !== "BORRADOR";
    const totals = metrics(preorder);
    const brands = store.brandCatalog.filter(item => !preorder.customerId || item.customerId === preorder.customerId);
    const status = STATUS[preorder.status] || STATUS.BORRADOR;
    return `
      <section class="panel-card po-editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">PO COMERCIAL OPCIONAL</p>
            <h3>${utils.esc(preorder.number)} <small>· control interno</small></h3>
            <p class="panel-note">Creado ${utils.esc(preorder.createdAt.slice(0, 10))}. ${preorder.linkedOrderNumber ? `Pedido enlazado: ${utils.esc(preorder.linkedOrderNumber)}.` : "Todavía no existe un pedido generado."}</p>
          </div>
          <span class="status-badge ${status.tone}">${utils.esc(status.label)}</span>
        </div>

        <div class="po-form-grid">
          <label class="compact-field">
            <span>Cliente principal</span>
            <select data-po-field="customerId" ${locked ? "disabled" : ""}>
              <option value="">Seleccione</option>
              ${store.customerCatalog.map(item => option(item.id, displayCustomer(item), preorder.customerId)).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Marca / cliente final</span>
            <select data-po-field="brandId" ${locked ? "disabled" : ""}>
              <option value="">Seleccione</option>
              ${brands.map(item => option(item.id, item.finalClientName || item.name, preorder.brandId)).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Fecha prevista</span>
            <input type="date" value="${utils.esc(preorder.scheduledDate)}" data-po-field="scheduledDate" ${locked ? "disabled" : ""}>
          </label>
          <label class="compact-field">
            <span>Transporte previsto</span>
            <select data-po-field="transportType" ${locked ? "disabled" : ""}>
              ${option("aereo", "Aéreo", preorder.transportType)}
              ${option("maritimo", "Marítimo", preorder.transportType)}
            </select>
          </label>
          <label class="compact-field">
            <span>País según marca</span>
            <input value="${utils.esc(preorder.destinationCountry || "Seleccione una marca")}" disabled>
            <small>Se completa automáticamente desde la marca / cliente final.</small>
          </label>
          <label class="compact-field">
            <span>Agencia prevista</span>
            <select data-po-field="agencyId" ${locked ? "disabled" : ""}>
              <option value="">Por completar en Crear pedido</option>
              ${store.agencyCatalog.map(item => option(item.id, item.name, preorder.agencyId)).join("")}
            </select>
          </label>
          <label class="compact-field po-field-full">
            <span>Observación</span>
            <textarea data-po-field="notes" ${locked ? "disabled" : ""} placeholder="Condiciones, cambios o indicaciones del cliente">${utils.esc(preorder.notes)}</textarea>
          </label>
        </div>

        <div class="po-summary-strip">
          <span><small>Cajas</small><strong>${utils.esc(totals.boxes)}</strong></span>
          <span><small>Ramos</small><strong>${utils.esc(totals.bunches)}</strong></span>
          <span><small>Tallos</small><strong>${utils.esc(totals.stems)}</strong></span>
          <span><small>Total estimado</small><strong>${utils.esc(utils.money(totals.totalUsd))}</strong></span>
        </div>

        ${locked ? "" : `
          <div class="po-line-add-toolbar">
            <span>Agregar al borrador:</span>
            <button class="secondary-button" type="button" data-po-add-mode="${LINE_MODES.INDIVIDUAL}">Caja individual</button>
            <button class="secondary-button" type="button" data-po-add-mode="${LINE_MODES.RANGE}">Rango igual</button>
            <button class="secondary-button" type="button" data-po-add-mode="${LINE_MODES.MANUAL_MIX}">Mixto manual</button>
            <button class="secondary-button" type="button" data-po-add-mode="${LINE_MODES.OPEN_MIX}">Mixto abierto</button>
          </div>
        `}
        <div class="po-line-groups">
          ${preorder.lines.map((line, index) => renderLineEditor(line, index, locked, preorder.lines.length > 1)).join("")}
        </div>

        <div class="editor-actions po-editor-actions">
          ${preorder.status === "BORRADOR" ? `
            <button class="secondary-button" type="button" data-po-save>Guardar borrador</button>
            <button class="primary-button" type="button" data-po-confirm>Confirmar PO</button>
            <button class="secondary-button" type="button" data-po-annul>Anular PO</button>
          ` : ""}
          ${preorder.status === "CONFIRMADO" ? `
            <button class="secondary-button" type="button" data-po-reopen>Reabrir PO</button>
            <button class="secondary-button" type="button" data-po-annul>Anular PO</button>
            <button class="primary-button" type="button" data-po-generate>Generar pedido</button>
          ` : ""}
          ${preorder.status === "PEDIDO_GENERADO" ? `
            <button class="primary-button" type="button" data-po-open-order="${utils.esc(preorder.linkedOrderId)}">Abrir ${utils.esc(preorder.linkedOrderNumber)}</button>
          ` : ""}
        </div>
      </section>
    `;
  }

  function render(appState) {
    const store = ensureStore(appState);
    const preorder = current(appState);
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>PO Nuevo</h1>
          <p>Borradores comerciales opcionales conectados únicamente con Crear pedido.</p>
        </div>
        <div class="page-header-side">
          <button class="primary-button" type="button" data-po-new>Nuevo PO</button>
          <span class="status-badge partial">Sin reservas · Sin SRI</span>
        </div>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Flujo independiente</strong>
          <span>Guardar o confirmar un PO no altera inventario, disponibilidad ni Bodega. “Generar pedido” crea un borrador en Crear pedido; la autorización se mantiene en Documentos electrónicos SRI.</span>
        </div>
      </section>
      ${renderNotice(store)}
      <section class="po-workspace">
        ${renderList(store)}
        ${renderEditor(store, preorder)}
      </section>
    `;
  }

  function bind(container, appState) {
    container.querySelectorAll("[data-po-new]").forEach(button => button.addEventListener("click", () => {
      createNew(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-status-button]").forEach(button => button.addEventListener("click", () => {
      const store = ensureStore(appState);
      store.ui.preorderStatusFilter = button.dataset.poStatusButton;
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-list-filter]").forEach(control => control.addEventListener("change", event => {
      const store = ensureStore(appState);
      store.ui[control.dataset.poListFilter] = event.target.value;
      BlessERP.layout.renderPage();
    }));

    container.querySelector("[data-po-mixed-filter]")?.addEventListener("click", () => {
      const store = ensureStore(appState);
      store.ui.preorderMixedOnly = !store.ui.preorderMixedOnly;
      BlessERP.layout.renderPage();
    });

    container.querySelector("[data-po-clear-filters]")?.addEventListener("click", () => {
      const store = ensureStore(appState);
      store.ui.preorderStatusFilter = "TODOS";
      store.ui.preorderCustomerFilter = "";
      store.ui.preorderDateFilter = "";
      store.ui.preorderVarietyFilter = "";
      store.ui.preorderLengthFilter = "";
      store.ui.preorderMixedOnly = false;
      BlessERP.layout.renderPage();
    });

    container.querySelectorAll("[data-po-select]").forEach(button => button.addEventListener("click", () => {
      select(appState, button.dataset.poSelect);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-field]").forEach(input => input.addEventListener("change", event => {
      updateField(appState, input.dataset.poField, event.target.value);
      if (["customerId", "brandId"].includes(input.dataset.poField)) BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-line-field]").forEach(input => input.addEventListener("change", event => {
      updateLine(appState, input.dataset.poLineId, input.dataset.poLineField, event.target.value);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-add-mode]").forEach(button => button.addEventListener("click", () => {
      addLine(appState, button.dataset.poAddMode);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-manual-field]").forEach(input => input.addEventListener("change", event => {
      const [lineId, itemId, field] = input.dataset.poManualField.split("|");
      updateManualItem(appState, lineId, itemId, field, event.target.value);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-add-manual]").forEach(button => button.addEventListener("click", () => {
      addManualItem(appState, button.dataset.poAddManual);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-delete-manual]").forEach(button => button.addEventListener("click", () => {
      const [lineId, itemId] = button.dataset.poDeleteManual.split("|");
      deleteManualItem(appState, lineId, itemId);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-po-delete-line]").forEach(button => button.addEventListener("click", () => {
      deleteLine(appState, button.dataset.poDeleteLine);
      BlessERP.layout.renderPage();
    }));

    container.querySelector("[data-po-save]")?.addEventListener("click", () => {
      saveDraft(appState);
      BlessERP.layout.renderPage();
    });

    container.querySelector("[data-po-confirm]")?.addEventListener("click", () => {
      confirm(appState);
      BlessERP.layout.renderPage();
    });

    container.querySelector("[data-po-reopen]")?.addEventListener("click", () => {
      const reason = window.prompt("Motivo para reabrir el PO como borrador:", "") || "";
      if (!reason.trim()) return;
      reopen(appState, reason);
      BlessERP.layout.renderPage();
    });

    container.querySelector("[data-po-annul]")?.addEventListener("click", () => {
      const reason = window.prompt("Motivo de anulación del PO:", "") || "";
      if (!reason.trim()) return;
      annul(appState, reason);
      BlessERP.layout.renderPage();
    });

    container.querySelector("[data-po-generate]")?.addEventListener("click", () => {
      generateOrder(appState);
    });

    container.querySelector("[data-po-open-order]")?.addEventListener("click", event => {
      if (!stateApi.openOrder(appState, event.currentTarget.dataset.poOpenOrder)) return;
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    });
  }

  BlessERP.comercialPreorders = {
    ANY_LENGTH,
    LINE_MODES,
    STATUS,
    bind,
    createLine,
    createPreorder,
    expandOrderLines,
    generateOrder,
    render,
    validate
  };
})();
