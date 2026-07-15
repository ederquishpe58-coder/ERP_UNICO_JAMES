(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const codeUtils = BlessERP.operacionesCodeUtilsDemo;

  const demoCodes = {
    [codeUtils.buildBoxCodeDemo("60334", 1)]: {
      tipo_codigo: "CAJA",
      pedido_id: "order-demo-0001",
      box_id: codeUtils.buildBoxCodeDemo("60334", 1),
      label_id: codeUtils.buildBoxCodeDemo("60334", 1),
      modulo_destino: "Operaciones / Despacho operativo",
      observacion: "Caja demo 1 validada visualmente."
    },
    [codeUtils.buildBoxCodeDemo("60334", 2)]: {
      tipo_codigo: "CAJA",
      pedido_id: "order-demo-0001",
      box_id: codeUtils.buildBoxCodeDemo("60334", 2),
      label_id: codeUtils.buildBoxCodeDemo("60334", 2),
      modulo_destino: "Operaciones / Despacho operativo",
      observacion: "Caja demo 2 validada visualmente."
    },
    [codeUtils.buildBoxCodeDemo("60334", 3)]: {
      tipo_codigo: "CAJA",
      pedido_id: "order-demo-0001",
      box_id: codeUtils.buildBoxCodeDemo("60334", 3),
      label_id: codeUtils.buildBoxCodeDemo("60334", 3),
      modulo_destino: "Operaciones / Despacho operativo",
      observacion: "Caja demo 3 validada visualmente."
    },
    [codeUtils.buildBunchCodeDemo("EXPLORER", 50, 1)]: {
      tipo_codigo: "RAMO",
      variedad: "EXPLORER",
      longitud: 50,
      modulo_destino: "Operaciones / Etiquetas de ramos",
      observacion: "Ramo demo Explorer 50 cm leido."
    },
    [codeUtils.buildBunchCodeDemo("PLAYA BLANCA", 50, 1)]: {
      tipo_codigo: "RAMO",
      variedad: "PLAYA BLANCA",
      longitud: 50,
      modulo_destino: "Operaciones / Etiquetas de ramos",
      observacion: "Ramo demo Playa Blanca 50 cm leido."
    },
    [codeUtils.buildBunchCodeDemo("MONDIAL", 60, 1)]: {
      tipo_codigo: "RAMO",
      variedad: "MONDIAL",
      longitud: 60,
      modulo_destino: "Operaciones / Etiquetas de ramos",
      observacion: "Ramo demo Mondial 60 cm leido."
    },
    [codeUtils.buildOrderCodeDemo("60334")]: {
      tipo_codigo: "PEDIDO",
      pedido_id: "order-demo-0001",
      modulo_destino: "Comercial / Pedido Maestro",
      observacion: "Pedido demo identificado."
    },
    [codeUtils.buildDispatchCodeDemo("60334")]: {
      tipo_codigo: "DESPACHO",
      pedido_id: "order-demo-0001",
      modulo_destino: "Operaciones / Despacho operativo",
      observacion: "Despacho demo identificado."
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    if (BlessERP.utils?.uid) return BlessERP.utils.uid(prefix);
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  function normalizeCode(value) {
    return codeUtils.normalizeDemoCode(value);
  }

  function getStore(appState) {
    const state = appState || BlessERP.state?.state || null;
    if (!state?.db) return null;
    if (BlessERP.operacionesState?.getStore) {
      return BlessERP.operacionesState.getStore(state);
    }
    state.db.operations = state.db.operations || {};
    state.db.operations.scannerEvents = Array.isArray(state.db.operations.scannerEvents)
      ? state.db.operations.scannerEvents
      : [];
    return state.db.operations;
  }

  function saveState() {
    BlessERP.state?.saveDb?.();
  }

  function toLegacyEvent(event) {
    return {
      ...event,
      eventId: event.event_id,
      dateTime: event.fecha_hora.replace("T", " ").slice(0, 16),
      code: event.codigo,
      type: event.tipo_codigo,
      moduleOrigin: event.modulo_origen,
      result: event.resultado,
      user: event.usuario_demo,
      observation: event.observacion
    };
  }

  function normalizeEvent(event) {
    const normalized = {
      event_id: event.event_id || event.eventId || createId("SCN-DEMO"),
      fecha_hora: event.fecha_hora || event.dateTime || nowIso(),
      codigo: normalizeCode(event.codigo || event.code),
      tipo_codigo: String(event.tipo_codigo || event.type || "DESCONOCIDO").toUpperCase(),
      modulo_origen: event.modulo_origen || event.moduleOrigin || "Operaciones / Scanner Zebra demo",
      modulo_destino: event.modulo_destino || event.moduleDestination || "Core / Auditoria demo",
      pedido_id: event.pedido_id || event.orderId || "",
      box_id: event.box_id || event.boxId || "",
      label_id: event.label_id || event.labelId || "",
      variedad: event.variedad || event.variety || "",
      longitud: event.longitud || event.length || "",
      resultado: String(event.resultado || event.result || "LEIDO_DEMO").toUpperCase(),
      usuario_demo: event.usuario_demo || event.user || BlessERP.state?.state?.db?.session?.activeUser?.name || "Usuario demo",
      observacion: event.observacion || event.observation || "Escaneo demo registrado.",
      estado_escaneo: event.estado_escaneo || event.scanState || ""
    };
    return toLegacyEvent(normalized);
  }

  function getScannerEventsDemo(appState) {
    const store = getStore(appState);
    const rows = store?.scannerEvents || [];
    return rows.map(normalizeEvent).map(clone);
  }

  function resolveDemoCode(codigo) {
    const normalized = normalizeCode(codigo);
    if (demoCodes[normalized]) return demoCodes[normalized];
    const parsed = codeUtils.parseDemoCode(normalized);
    if (parsed.tipo_codigo === "DESCONOCIDO") return null;
    const pedidoId = parsed.pedido === "60334" ? "order-demo-0001" : "";
    return {
      tipo_codigo: parsed.tipo_codigo,
      pedido_id: pedidoId,
      box_id: parsed.tipo_codigo === "CAJA" ? normalized : "",
      modulo_destino: parsed.tipo_codigo === "RAMO"
        ? "Operaciones / Etiquetas de ramos"
        : parsed.tipo_codigo === "PEDIDO"
          ? "Comercial / Pedido Maestro"
          : parsed.tipo_codigo === "DESPACHO"
            ? "Operaciones / Despacho operativo"
            : "Core / Auditoria demo",
      variedad: parsed.variedad_corta || "",
      longitud: parsed.longitud || "",
      observacion: `Codigo demo ${parsed.tipo_codigo.toLowerCase()} reconocido por formato unificado.`
    };
  }

  function resolveTypeFromContext(context = {}, found = null) {
    return String(context.tipo_codigo || context.type || found?.tipo_codigo || "DESCONOCIDO").toUpperCase();
  }

  function storeScannerEvent(appState, event) {
    const store = getStore(appState);
    const normalized = normalizeEvent(event);
    if (store) {
      store.scannerEvents = Array.isArray(store.scannerEvents) ? store.scannerEvents : [];
      store.scannerEvents.unshift(normalized);
      saveState();
    }
    return clone(normalized);
  }

  function getDispatchForOrder(appState, pedidoId) {
    if (!BlessERP.operacionesDispatchDemo?.getDispatchByOrderDemo) return null;
    return BlessERP.operacionesDispatchDemo.getDispatchByOrderDemo(appState, pedidoId);
  }

  function padBoxNumber(value) {
    return String(Number(value || 0)).padStart(3, "0");
  }

  function orderTokenForDispatch(dispatch) {
    if (String(dispatch?.pedido_id || "") === "order-demo-0001") return "60334";
    const fromNumber = codeUtils.normalizeDemoCode(dispatch?.numero_pedido || dispatch?.pedido_id || "PEDIDO").replace(/[^0-9A-Z]/g, "");
    return fromNumber || "PEDIDO";
  }

  function buildBoxCodeForDispatch(dispatch, box) {
    if (String(box?.codigo_demo || "").trim()) return normalizeCode(box.codigo_demo);
    const existing = normalizeCode(box?.box_id || "");
    if (/^BOX-[0-9A-Z]+-\d{3}$/.test(existing)) return existing;
    return codeUtils.buildBoxCodeDemo(orderTokenForDispatch(dispatch), box?.numero_caja || 0);
  }

  function findBoxByDemoCode(dispatch, codigo) {
    const cleanCode = normalizeCode(codigo);
    return (dispatch?.cajas || []).find(box => buildBoxCodeForDispatch(dispatch, box) === cleanCode) || null;
  }

  function findAnyKnownBox(codigo) {
    const found = resolveDemoCode(codigo);
    return found?.tipo_codigo === "CAJA" ? found : null;
  }

  function scanCodeDemo(codigo, contexto = {}) {
    const appState = contexto.appState || BlessERP.state?.state || null;
    const store = getStore(appState);
    const cleanCode = normalizeCode(codigo);
    const found = resolveDemoCode(cleanCode);
    const previousEvents = store?.scannerEvents || [];
    const duplicate = cleanCode && previousEvents.some(item => normalizeCode(item.codigo || item.code) === cleanCode);
    const result = !cleanCode
      ? "ERROR_DEMO"
      : duplicate
        ? "DUPLICADO"
        : found
          ? "VALIDADO_DEMO"
          : "NO_ENCONTRADO";
    const event = normalizeEvent({
      event_id: createId("SCN-DEMO"),
      fecha_hora: nowIso(),
      codigo: cleanCode || "SIN-CODIGO",
      tipo_codigo: resolveTypeFromContext(contexto, found),
      modulo_origen: contexto.modulo_origen || contexto.moduleOrigin || "Operaciones / Scanner Zebra demo",
      modulo_destino: contexto.modulo_destino || found?.modulo_destino || "Core / Auditoria demo",
      pedido_id: contexto.pedido_id || found?.pedido_id || "",
      box_id: contexto.box_id || found?.box_id || "",
      label_id: contexto.label_id || found?.label_id || "",
      variedad: contexto.variedad || found?.variedad || "",
      longitud: contexto.longitud || found?.longitud || "",
      resultado: result,
      usuario_demo: contexto.usuario_demo || contexto.user || BlessERP.state?.state?.db?.session?.activeUser?.name || "Usuario demo",
      observacion: contexto.observacion || found?.observacion || (
        result === "NO_ENCONTRADO"
          ? "Codigo demo no encontrado."
          : result === "DUPLICADO"
            ? "Codigo demo leido previamente."
            : result === "ERROR_DEMO"
              ? "Codigo vacio o invalido para demo."
              : "Lectura demo registrada."
      )
    });

    const stored = storeScannerEvent(appState, event);
    if (store?.ui?.scannerDraft) {
      store.ui.scannerDraft.code = "";
      store.ui.scannerDraft.type = stored.tipo_codigo;
      store.ui.scannerDraft.moduleOrigin = stored.modulo_origen;
      saveState();
    }

    return stored;
  }

  function getScansByOrderDemo(first, second) {
    const appState = first?.db ? first : (BlessERP.state?.state || null);
    const pedidoId = first?.db ? second : first;
    return getScannerEventsDemo(appState).filter(item => String(item.pedido_id || "") === String(pedidoId || ""));
  }

  function scanBoxForDispatchDemo(first, second, third) {
    const appState = first?.db ? first : (BlessERP.state?.state || null);
    const codigo = first?.db ? second : first;
    const pedidoId = first?.db ? third : second;
    const cleanCode = normalizeCode(codigo);
    const dispatch = getDispatchForOrder(appState, pedidoId);
    const knownBox = findAnyKnownBox(cleanCode);
    const box = dispatch ? findBoxByDemoCode(dispatch, cleanCode) : null;
    const previousOrderEvents = getScansByOrderDemo(appState, pedidoId);
    const duplicate = Boolean(box && previousOrderEvents.some(item => (
      String(item.tipo_codigo || "").toUpperCase() === "CAJA" &&
      (normalizeCode(item.codigo) === cleanCode || normalizeCode(item.box_id) === cleanCode) &&
      ["VALIDADO_DEMO", "DUPLICADO"].includes(String(item.resultado || "").toUpperCase())
    )));
    let resultado = "VALIDADO_DEMO";
    let estadoEscaneo = "ESCANEADA_DEMO";
    let observacion = "Caja demo escaneada para despacho.";
    let boxId = box ? buildBoxCodeForDispatch(dispatch, box) : knownBox?.box_id || "";

    if (!cleanCode) {
      resultado = "ERROR_DEMO";
      estadoEscaneo = "OBSERVADA_DEMO";
      observacion = "Codigo de caja vacio o invalido.";
    } else if (!knownBox && !box) {
      resultado = "NO_ENCONTRADO";
      estadoEscaneo = "NO_ENCONTRADA";
      observacion = "Codigo de caja demo no encontrado.";
    } else if (knownBox && String(knownBox.pedido_id || "") !== String(pedidoId || "")) {
      resultado = "ERROR_DEMO";
      estadoEscaneo = "OBSERVADA_DEMO";
      observacion = "Codigo demo pertenece a otro pedido/despacho.";
      boxId = knownBox.box_id || cleanCode;
    } else if (!box) {
      resultado = "ERROR_DEMO";
      estadoEscaneo = "OBSERVADA_DEMO";
      observacion = "Codigo existe, pero no corresponde a una caja del despacho seleccionado.";
    } else if (duplicate) {
      resultado = "DUPLICADO";
      estadoEscaneo = "DUPLICADA_DEMO";
      observacion = "Caja demo ya fue escaneada para este despacho.";
    }

    return storeScannerEvent(appState, {
      event_id: createId("SCN-BOX"),
      fecha_hora: nowIso(),
      codigo: cleanCode || "SIN-CODIGO",
      tipo_codigo: "CAJA",
      modulo_origen: "Operaciones / Despacho operativo",
      modulo_destino: "Operaciones / Despacho operativo",
      pedido_id: pedidoId || knownBox?.pedido_id || "",
      box_id: boxId,
      label_id: knownBox?.label_id || "",
      resultado,
      usuario_demo: BlessERP.state?.state?.db?.session?.activeUser?.name || "Usuario demo",
      observacion,
      estado_escaneo: estadoEscaneo
    });
  }

  function getBoxScanStatusDemo(first, second) {
    const appState = first?.db ? first : (BlessERP.state?.state || null);
    const pedidoId = first?.db ? second : first;
    const dispatch = getDispatchForOrder(appState, pedidoId);
    const orderEvents = getScansByOrderDemo(appState, pedidoId)
      .filter(item => String(item.tipo_codigo || "").toUpperCase() === "CAJA");
    const boxes = (dispatch?.cajas || []).map(box => {
      const codigoDemo = buildBoxCodeForDispatch(dispatch, box);
      const related = orderEvents.filter(item => normalizeCode(item.codigo) === codigoDemo || normalizeCode(item.box_id) === codigoDemo);
      const latest = related[0] || null;
      const hasDuplicate = related.some(item => String(item.resultado || "").toUpperCase() === "DUPLICADO");
      const hasScan = related.some(item => ["VALIDADO_DEMO", "DUPLICADO"].includes(String(item.resultado || "").toUpperCase()));
      const isObserved = String(box.estado_caja || "").toUpperCase().includes("OBSERV");
      const estadoEscaneo = hasDuplicate
        ? "DUPLICADA_DEMO"
        : hasScan
          ? "ESCANEADA_DEMO"
          : isObserved
            ? "OBSERVADA_DEMO"
            : "PENDIENTE_ESCANEO";

      return {
        box_id: box.box_id || codigoDemo,
        numero_caja: box.numero_caja,
        codigo_demo: codigoDemo,
        pedido_id: dispatch?.pedido_id || pedidoId || "",
        tipo_caja: box.tipo_caja || "",
        po: box.po || "",
        contenido_resumido: box.contenido_resumido || "",
        estado_escaneo: estadoEscaneo,
        fecha_hora_escaneo: latest?.fecha_hora || "",
        resultado: latest?.resultado || (isObserved ? "ERROR_DEMO" : "PENDIENTE"),
        observacion: latest?.observacion || (isObserved ? "Caja observada en despacho demo." : "Pendiente de escaneo demo.")
      };
    });
    const noEncontradas = orderEvents.filter(item => String(item.resultado || "").toUpperCase() === "NO_ENCONTRADO");
    const errores = orderEvents.filter(item => String(item.resultado || "").toUpperCase() === "ERROR_DEMO");
    const summary = {
      total: boxes.length,
      scanned: boxes.filter(item => ["ESCANEADA_DEMO", "DUPLICADA_DEMO"].includes(item.estado_escaneo)).length,
      pending: boxes.filter(item => item.estado_escaneo === "PENDIENTE_ESCANEO").length,
      duplicated: boxes.filter(item => item.estado_escaneo === "DUPLICADA_DEMO").length,
      observed: boxes.filter(item => item.estado_escaneo === "OBSERVADA_DEMO").length + noEncontradas.length + errores.length,
      notFound: noEncontradas.length,
      errors: errores.length,
      lastEvent: orderEvents[0] || null
    };

    return {
      pedido_id: dispatch?.pedido_id || pedidoId || "",
      numero_pedido: dispatch?.numero_pedido || "",
      boxes,
      events: orderEvents,
      summary,
      allScanned: Boolean(boxes.length && summary.pending === 0),
      message: boxes.length && summary.pending === 0
        ? "Todas las cajas fueron escaneadas en demo."
        : "Faltan cajas por escanear."
    };
  }

  function resetBoxScansForOrderDemo(first, second) {
    const appState = first?.db ? first : (BlessERP.state?.state || null);
    const pedidoId = first?.db ? second : first;
    const store = getStore(appState);
    if (!store) return { ok: false, cleared: 0 };
    const before = store.scannerEvents.length;
    store.scannerEvents = store.scannerEvents.filter(item => !(
      String(item.pedido_id || "") === String(pedidoId || "") &&
      String(item.tipo_codigo || item.type || "").toUpperCase() === "CAJA"
    ));
    const cleared = before - store.scannerEvents.length;
    saveState();
    return { ok: true, cleared, pedido_id: pedidoId };
  }

  function getPendingBoxesForOrderDemo(first, second) {
    return getBoxScanStatusDemo(first, second).boxes.filter(item => item.estado_escaneo === "PENDIENTE_ESCANEO");
  }

  function getScannedBoxesForOrderDemo(first, second) {
    return getBoxScanStatusDemo(first, second).boxes.filter(item => ["ESCANEADA_DEMO", "DUPLICADA_DEMO"].includes(item.estado_escaneo));
  }

  function scanAllBoxesForDispatchDemo(first, second) {
    const appState = first?.db ? first : (BlessERP.state?.state || null);
    const pedidoId = first?.db ? second : first;
    const pending = getPendingBoxesForOrderDemo(appState, pedidoId);
    const events = pending.map(box => scanBoxForDispatchDemo(appState, box.codigo_demo, pedidoId));
    return {
      ok: true,
      scanned: events.length,
      events,
      status: getBoxScanStatusDemo(appState, pedidoId)
    };
  }

  function validateBoxScanDemo(codigo, pedidoId = "") {
    if (pedidoId) return scanBoxForDispatchDemo(codigo, pedidoId);
    return scanCodeDemo(codigo, {
      tipo_codigo: "CAJA",
      pedido_id: pedidoId,
      modulo_origen: "Operaciones / Despacho operativo",
      modulo_destino: "Operaciones / Despacho operativo"
    });
  }

  function validateBunchScanDemo(codigo) {
    return scanCodeDemo(codigo, {
      tipo_codigo: "RAMO",
      modulo_origen: "Operaciones / Scanner Zebra demo",
      modulo_destino: "Operaciones / Etiquetas de ramos"
    });
  }

  function validateDispatchScanDemo(codigo, pedidoId = "") {
    return scanCodeDemo(codigo, {
      tipo_codigo: "DESPACHO",
      pedido_id: pedidoId,
      modulo_origen: "Operaciones / Despacho operativo",
      modulo_destino: "Operaciones / Despacho operativo"
    });
  }

  function clearScannerEventsDemo(appState) {
    const store = getStore(appState);
    if (!store) return { ok: false, cleared: 0 };
    const cleared = (store.scannerEvents || []).length;
    store.scannerEvents = [];
    saveState();
    return { ok: true, cleared };
  }

  function getScannerSummaryDemo(appState) {
    const events = getScannerEventsDemo(appState);
    const today = nowIso().slice(0, 10);
    const dispatches = BlessERP.operacionesDispatchDemo?.getDispatchesDemo
      ? BlessERP.operacionesDispatchDemo.getDispatchesDemo(appState)
      : [];
    const boxStatusSummaries = dispatches.map(dispatch => getBoxScanStatusDemo(appState, dispatch.pedido_id || dispatch.numero_pedido).summary);
    const scannedBoxCodes = new Set(events
      .filter(item => item.tipo_codigo === "CAJA" && ["LEIDO_DEMO", "VALIDADO_DEMO", "DUPLICADO"].includes(item.resultado))
      .map(item => item.box_id || item.codigo)
      .filter(Boolean));
    return {
      total: events.length,
      today: events.filter(item => String(item.fecha_hora || "").slice(0, 10) === today).length,
      boxes: scannedBoxCodes.size,
      pendingBoxes: boxStatusSummaries.reduce((sum, item) => sum + (item?.pending || 0), 0),
      notFound: events.filter(item => item.resultado === "NO_ENCONTRADO").length,
      duplicates: events.filter(item => item.resultado === "DUPLICADO").length,
      lastEvent: events[0] || null,
      zebraRealPending: true
    };
  }

  BlessERP.operacionesScannerDemo = {
    demoCodes,
    getScannerEventsDemo,
    getScansByOrderDemo,
    getBoxScanStatusDemo,
    scanBoxForDispatchDemo,
    resetBoxScansForOrderDemo,
    getPendingBoxesForOrderDemo,
    getScannedBoxesForOrderDemo,
    scanAllBoxesForDispatchDemo,
    scanCodeDemo,
    validateBoxScanDemo,
    validateBunchScanDemo,
    validateDispatchScanDemo,
    clearScannerEventsDemo,
    getScannerSummaryDemo
  };
})();
