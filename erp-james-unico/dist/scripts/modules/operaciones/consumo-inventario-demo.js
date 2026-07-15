(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeText(value) {
    return String(value || "").trim().toUpperCase();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function todayIso() {
    return nowIso().slice(0, 10);
  }

  function isAppState(value) {
    return Boolean(value && typeof value === "object" && value.db);
  }

  function resolveArgs(first, second) {
    if (isAppState(first)) {
      return { appState: first, input: second };
    }
    return {
      appState: BlessERP.state?.state || null,
      input: first
    };
  }

  function createId(prefix) {
    if (BlessERP.utils?.uid) return BlessERP.utils.uid(prefix);
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  function currentUserName(appState) {
    return BlessERP.adminConfig?.activeUser?.()?.name
      || appState?.db?.session?.activeUser?.name
      || "Usuario demo";
  }

  function saveState() {
    BlessERP.state?.saveDb?.();
  }

  function ensureStore(appState) {
    if (!appState?.db) return null;
    appState.db.operaciones = appState.db.operaciones || {};
    const store = appState.db.operaciones;
    store.consumptionsDemo = Array.isArray(store.consumptionsDemo) ? store.consumptionsDemo : [];
    store.kardexOperativoDemo = Array.isArray(store.kardexOperativoDemo) ? store.kardexOperativoDemo : [];
    return store;
  }

  function getCommercialOrder(appState, pedidoId) {
    return BlessERP.comercialState?.findOrder
      ? BlessERP.comercialState.findOrder(appState, pedidoId)
      : null;
  }

  function getDispatch(appState, pedidoId) {
    return BlessERP.operacionesDispatchDemo?.getDispatchByOrderDemo
      ? BlessERP.operacionesDispatchDemo.getDispatchByOrderDemo(appState, pedidoId)
      : null;
  }

  function getAvailabilityRows(appState) {
    return BlessERP.operacionesAvailabilityDemo?.getAvailabilityDemo
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilityDemo(appState)
      : [];
  }

  function getReservationById(appState, reservationId) {
    return BlessERP.operacionesAvailabilityDemo?.getReservationByIdDemo
      ? BlessERP.operacionesAvailabilityDemo.getReservationByIdDemo(appState, reservationId)
      : null;
  }

  function getReservationsByOrder(appState, pedidoId) {
    return BlessERP.operacionesAvailabilityDemo?.getReservationsByOrderDemo
      ? BlessERP.operacionesAvailabilityDemo.getReservationsByOrderDemo(appState, pedidoId)
      : [];
  }

  function getScannerStatus(appState, pedidoId, totalBoxes) {
    return BlessERP.operacionesScannerDemo?.getBoxScanStatusDemo
      ? BlessERP.operacionesScannerDemo.getBoxScanStatusDemo(appState, pedidoId)
      : {
          boxes: [],
          summary: {
            total: parseNumber(totalBoxes, 0),
            scanned: 0,
            pending: parseNumber(totalBoxes, 0),
            duplicated: 0,
            observed: 0
          }
        };
  }

  function findAvailabilityByLine(appState, line) {
    if (line.availability_id) {
      const direct = getAvailabilityRows(appState).find(item => String(item.availability_id) === String(line.availability_id));
      if (direct) return direct;
    }

    const reservation = line.reservation_id ? getReservationById(appState, line.reservation_id) : null;
    if (reservation?.availability_id) {
      const byReservation = getAvailabilityRows(appState).find(item => String(item.availability_id) === String(reservation.availability_id));
      if (byReservation) return byReservation;
    }

    const variety = normalizeText(line.variedad || line.variety);
    const length = parseNumber(line.longitud ?? line.length, 0);
    const warehouse = normalizeText(line.bodega || line.warehouse);
    const rows = getAvailabilityRows(appState).filter(item => (
      normalizeText(item.variedad) === variety &&
      parseNumber(item.longitud, 0) === length &&
      (!warehouse || normalizeText(item.bodega) === warehouse)
    ));
    return rows[0] || null;
  }

  function parseBoxSummary(summary) {
    const raw = String(summary || "").trim();
    const match = raw.match(/^(.+?)\s+(\d+)\s*cm\s*\/\s*(\d+)\s*ramos\s*\/\s*(\d+)\s*tallos/i);
    if (!match) {
      return {
        variedad: raw || "",
        longitud: 0,
        ramos: 0,
        tallos: 0
      };
    }
    return {
      variedad: String(match[1] || "").trim(),
      longitud: parseNumber(match[2], 0),
      ramos: parseNumber(match[3], 0),
      tallos: parseNumber(match[4], 0)
    };
  }

  function buildDispatchBoxMap(dispatch) {
    return (dispatch?.cajas || []).reduce((map, box) => {
      map.set(String(parseNumber(box.numero_caja ?? box.boxNumber, 0)), box);
      return map;
    }, new Map());
  }

  function buildConsumptionDrafts(appState, pedidoId) {
    const order = getCommercialOrder(appState, pedidoId);
    const dispatch = getDispatch(appState, pedidoId);
    if (!dispatch) return [];

    const boxMap = buildDispatchBoxMap(dispatch);
    const orderLines = Array.isArray(order?.lines) ? order.lines : [];

    if (orderLines.length) {
      return orderLines.map((line, index) => {
        const boxNumber = parseNumber(line.boxNumber ?? line.numero_caja, index + 1);
        const box = boxMap.get(String(boxNumber)) || {};
        const bunches = parseNumber(line.reservationBunchesUsed ?? line.bunches ?? line.ramos, 0);
        const stemsPerBunch = parseNumber(line.stemsPerBunch ?? line.tallos_por_ramo, 25);
        const totalStems = parseNumber(line.totalStems ?? line.total_tallos, bunches * stemsPerBunch);
        const reservationId = String(line.reservationId || line.reservation_id || box.reservation_id || "").trim();
        const reservation = reservationId ? getReservationById(appState, reservationId) : null;
        const availability = findAvailabilityByLine(appState, {
          reservation_id: reservationId,
          availability_id: reservation?.availability_id,
          variedad: line.variety || line.variedad,
          longitud: line.length ?? line.longitud,
          bodega: reservation?.bodega || reservation?.warehouse || ""
        });

        return {
          box_id: String(box.box_id || line.box_id || line.id || `BOX-LINEA-${index + 1}`).trim(),
          numero_caja: boxNumber,
          reservation_id: reservationId,
          availability_id: availability?.availability_id || reservation?.availability_id || "",
          variedad: String(line.variety || line.variedad || availability?.variedad || "").trim(),
          longitud: parseNumber(line.length ?? line.longitud ?? availability?.longitud, 0),
          tallos_por_ramo: stemsPerBunch,
          ramos_consumidos_demo: bunches,
          tallos_consumidos_demo: totalStems,
          bodega: availability?.bodega || reservation?.bodega || "",
          proveedor: availability?.proveedor || reservation?.proveedor || "",
          bloque: availability?.bloque || reservation?.bloque || "",
          observacion: `Consumo demo calculado desde caja ${boxNumber}.`
        };
      }).filter(item => item.ramos_consumidos_demo > 0 || item.tallos_consumidos_demo > 0);
    }

    return (dispatch.cajas || []).map((box, index) => {
      const parsed = parseBoxSummary(box.contenido_resumido);
      const reservationId = String(box.reservation_id || "").trim();
      const reservation = reservationId ? getReservationById(appState, reservationId) : null;
      const availability = findAvailabilityByLine(appState, {
        reservation_id: reservationId,
        availability_id: reservation?.availability_id,
        variedad: parsed.variedad,
        longitud: parsed.longitud
      });

      return {
        box_id: String(box.box_id || `BOX-FALLBACK-${index + 1}`).trim(),
        numero_caja: parseNumber(box.numero_caja, index + 1),
        reservation_id: reservationId,
        availability_id: availability?.availability_id || reservation?.availability_id || "",
        variedad: parsed.variedad,
        longitud: parsed.longitud,
        tallos_por_ramo: reservation?.tallos_por_ramo || parseNumber(parsed.ramos ? parsed.tallos / parsed.ramos : 25, 25),
        ramos_consumidos_demo: parseNumber(box.ramos, parsed.ramos),
        tallos_consumidos_demo: parseNumber(box.tallos, parsed.tallos),
        bodega: availability?.bodega || reservation?.bodega || "",
        proveedor: availability?.proveedor || reservation?.proveedor || "",
        bloque: availability?.bloque || reservation?.bloque || "",
        observacion: `Consumo demo inferido desde resumen de caja ${box.numero_caja || index + 1}.`
      };
    }).filter(item => item.ramos_consumidos_demo > 0 || item.tallos_consumidos_demo > 0);
  }

  function getActiveConsumptions(store, pedidoId = "") {
    return (store?.consumptionsDemo || []).filter(item => (
      String(item.estado_consumo || "").toUpperCase() === "SIMULADO" &&
      (!pedidoId || String(item.pedido_id) === String(pedidoId))
    ));
  }

  function buildActiveTotalsByAvailability(store, excludedIds = []) {
    const excluded = new Set((excludedIds || []).map(item => String(item)));
    return (store?.consumptionsDemo || []).reduce((map, item) => {
      if (String(item.estado_consumo || "").toUpperCase() !== "SIMULADO") return map;
      if (excluded.has(String(item.consumption_id))) return map;
      const key = String(item.availability_id || "SIN-AVAILABILITY");
      const current = map.get(key) || { ramos: 0, tallos: 0 };
      current.ramos += parseNumber(item.ramos_consumidos_demo, 0);
      current.tallos += parseNumber(item.tallos_consumidos_demo, 0);
      map.set(key, current);
      return map;
    }, new Map());
  }

  function buildOrderConsumptionSummary(rows) {
    const active = rows.filter(item => String(item.estado_consumo || "").toUpperCase() === "SIMULADO");
    const reverted = rows.filter(item => String(item.estado_consumo || "").toUpperCase() === "REVERTIDO_DEMO");
    const latest = rows[0] || null;
    let status = "PENDIENTE";
    if (active.length) status = "SIMULADO";
    else if (reverted.length) status = "REVERTIDO_DEMO";
    else if (latest) status = String(latest.estado_consumo || "PENDIENTE").toUpperCase();

    return {
      status,
      totalRows: rows.length,
      activeRows: active.length,
      revertedRows: reverted.length,
      totalBunches: active.reduce((sum, item) => sum + parseNumber(item.ramos_consumidos_demo, 0), 0),
      totalStems: active.reduce((sum, item) => sum + parseNumber(item.tallos_consumidos_demo, 0), 0),
      latest,
      varieties: [...new Set(active.map(item => item.variedad).filter(Boolean))],
      lengths: [...new Set(active.map(item => item.longitud).filter(Boolean))].sort((a, b) => a - b)
    };
  }

  function recordCommercialEvent(appState, pedidoId, payload) {
    const order = getCommercialOrder(appState, pedidoId);
    if (order && BlessERP.comercialWorkflow?.recordEvent) {
      BlessERP.comercialWorkflow.recordEvent(order, appState, payload);
    }
  }

  function sortByDateDesc(rows, field = "fecha_hora") {
    return [...rows].sort((a, b) => String(b[field] || "").localeCompare(String(a[field] || "")));
  }

  function validateConsumptionReadinessDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const store = ensureStore(appState);
    const pedidoId = String(input || "").trim();
    const dispatch = getDispatch(appState, pedidoId);
    const order = getCommercialOrder(appState, pedidoId);
    const previewRows = buildConsumptionDrafts(appState, pedidoId);
    const scannerStatus = getScannerStatus(appState, pedidoId, dispatch?.total_cajas || previewRows.length);
    const reservations = getReservationsByOrder(appState, pedidoId);
    const activeConsumptions = getActiveConsumptions(store, pedidoId);

    const errors = [];
    const warnings = [];

    if (!dispatch) errors.push("Despacho demo no encontrado.");
    if (normalizeText(order?.status) === "ANULADO") errors.push("Pedido anulado.");
    if (dispatch && normalizeText(dispatch.estado_despacho) !== "DESPACHADO_DEMO") errors.push("El consumo demo solo se simula cuando el despacho esta en DESPACHADO_DEMO.");
    if (dispatch && !(dispatch.cajas || []).length) errors.push("Pedido sin cajas.");
    if (dispatch && parseNumber(dispatch.total_tallos, 0) <= 0) errors.push("Total tallos es cero.");
    if (!previewRows.length) errors.push("No hay detalle valido para calcular consumo demo.");
    if (previewRows.some(item => !String(item.variedad || "").trim() || parseNumber(item.longitud, 0) <= 0)) errors.push("Hay cajas o lineas sin variedad/longitud validas.");
    if (activeConsumptions.length) errors.push("El consumo demo ya fue simulado para este pedido.");

    if (previewRows.some(item => !String(item.reservation_id || "").trim())) warnings.push("Cajas no tienen reserva asociada.");
    if (reservations.some(item => parseNumber(item.diferencia, 0) > 0)) warnings.push("Reservas no fueron usadas totalmente.");
    if (scannerStatus.summary.pending > 0) warnings.push("Cajas no fueron escaneadas todas.");
    warnings.push("Scanner real no conectado.");
    warnings.push("Inventario real no conectado.");

    const grouped = previewRows.reduce((acc, item) => {
      const key = `${item.variedad}|${item.longitud}`;
      if (!acc[key]) {
        acc[key] = { variedad: item.variedad, longitud: item.longitud, ramos: 0, tallos: 0 };
      }
      acc[key].ramos += parseNumber(item.ramos_consumidos_demo, 0);
      acc[key].tallos += parseNumber(item.tallos_consumidos_demo, 0);
      return acc;
    }, {});

    return {
      ok: !errors.length,
      errors,
      warnings,
      dispatch,
      order,
      previewRows,
      groupedSummary: Object.values(grouped),
      scannerStatus,
      reservations,
      activeConsumptions: activeConsumptions.map(clone)
    };
  }

  function createKardexRowsForConsumptions(appState, consumptions, type) {
    const store = ensureStore(appState);
    const activeTotals = buildActiveTotalsByAvailability(store, type === "REVERSO_CONSUMO_DEMO" ? consumptions.map(item => item.consumption_id) : []);
    const running = new Map(Array.from(activeTotals.entries()).map(([key, value]) => [key, { ...value }]));

    return consumptions.map(item => {
      const availability = item.availability_id
        ? getAvailabilityRows(appState).find(row => String(row.availability_id) === String(item.availability_id))
        : null;
      const key = String(item.availability_id || "SIN-AVAILABILITY");
      const current = running.get(key) || { ramos: 0, tallos: 0 };
      const direction = type === "REVERSO_CONSUMO_DEMO" ? -1 : 1;
      current.ramos += direction * parseNumber(item.ramos_consumidos_demo, 0);
      current.tallos += direction * parseNumber(item.tallos_consumidos_demo, 0);
      running.set(key, current);

      const initialRamos = parseNumber(availability?.ramos_disponibles, parseNumber(item.ramos_consumidos_demo, 0));
      const initialTallos = parseNumber(availability?.tallos_disponibles, parseNumber(item.tallos_consumidos_demo, 0));

      return {
        kardex_id: createId("OPS-KDX"),
        fecha_hora: nowIso(),
        tipo_movimiento: type,
        pedido_id: item.pedido_id,
        dispatch_id: item.dispatch_id,
        availability_id: item.availability_id,
        variedad: item.variedad,
        longitud: item.longitud,
        ramos: parseNumber(item.ramos_consumidos_demo, 0),
        tallos: parseNumber(item.tallos_consumidos_demo, 0),
        bodega: item.bodega,
        saldo_ramos_demo: Math.max(initialRamos - current.ramos, 0),
        saldo_tallos_demo: Math.max(initialTallos - current.tallos, 0),
        usuario_demo: currentUserName(appState),
        observacion: type === "REVERSO_CONSUMO_DEMO"
          ? `Reverso demo del consumo ${item.consumption_id}.`
          : `Consumo demo por despacho ${item.numero_pedido || item.pedido_id}.`
      };
    });
  }

  function simulateConsumptionFromDispatchDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const store = ensureStore(appState);
    const pedidoId = String(input || "").trim();
    const review = validateConsumptionReadinessDemo(appState, pedidoId);

    if (!review.ok) {
      recordCommercialEvent(appState, pedidoId, {
        action: "CONSUMO_DEMO_INVALIDO",
        actionLabel: "Intento de consumo demo invalido",
        previousStatus: review.order?.status || review.dispatch?.estado_pedido || "BORRADOR",
        nextStatus: review.order?.status || review.dispatch?.estado_pedido || "BORRADOR",
        description: review.errors[0] || "No se pudo simular el consumo demo.",
        result: "bloqueado"
      });
      saveState();
      return { ok: false, error: review.errors[0] || "No se pudo simular el consumo demo.", validation: review };
    }

    const user = currentUserName(appState);
    const consumptions = review.previewRows.map(item => ({
      consumption_id: createId("OPS-CON"),
      pedido_id: pedidoId,
      numero_pedido: review.dispatch?.numero_pedido || review.order?.number || "",
      dispatch_id: review.dispatch?.dispatch_id || "",
      reservation_id: item.reservation_id || "",
      availability_id: item.availability_id || "",
      box_id: item.box_id || "",
      fecha_hora: nowIso(),
      variedad: item.variedad,
      longitud: item.longitud,
      tallos_por_ramo: parseNumber(item.tallos_por_ramo, 25),
      ramos_consumidos_demo: parseNumber(item.ramos_consumidos_demo, 0),
      tallos_consumidos_demo: parseNumber(item.tallos_consumidos_demo, 0),
      bodega: item.bodega || "",
      proveedor: item.proveedor || "",
      bloque: item.bloque || "",
      estado_consumo: "SIMULADO",
      usuario_demo: user,
      motivo: "Consumo demo por despacho",
      observacion: item.observacion || "Consumo demo generado."
    }));

    const kardexRows = createKardexRowsForConsumptions(appState, consumptions, "CONSUMO_DESPACHO_DEMO");
    store.consumptionsDemo.unshift(...consumptions.slice().reverse());
    store.kardexOperativoDemo.unshift(...kardexRows.slice().reverse());

    recordCommercialEvent(appState, pedidoId, {
      action: "SIMULAR_CONSUMO_DEMO",
      actionLabel: "Simular consumo demo",
      previousStatus: review.order?.status || review.dispatch?.estado_pedido || "DESPACHADO_DEMO",
      nextStatus: review.order?.status || review.dispatch?.estado_pedido || "DESPACHADO_DEMO",
      description: `Consumo demo simulado para ${consumptions.length} linea(s) del pedido ${review.dispatch?.numero_pedido || pedidoId}.`,
      result: "exitoso"
    });
    recordCommercialEvent(appState, pedidoId, {
      action: "GENERAR_KARDEX_DEMO",
      actionLabel: "Generar kardex demo",
      previousStatus: review.order?.status || review.dispatch?.estado_pedido || "DESPACHADO_DEMO",
      nextStatus: review.order?.status || review.dispatch?.estado_pedido || "DESPACHADO_DEMO",
      description: `Kardex operativo demo generado con ${kardexRows.length} movimiento(s).`,
      result: "exitoso"
    });

    saveState();
    return { ok: true, consumptions: consumptions.map(clone), kardex: kardexRows.map(clone), validation: review };
  }

  function reverseConsumptionDemo(first, second, third) {
    const context = resolveArgs(first, second);
    const appState = context.appState;
    const pedidoId = String(context.input || "").trim();
    const motivo = isAppState(first) ? third : second;
    const store = ensureStore(appState);
    const activeRows = getActiveConsumptions(store, pedidoId);

    if (!activeRows.length) {
      recordCommercialEvent(appState, pedidoId, {
        action: "CONSUMO_DEMO_INVALIDO",
        actionLabel: "Intento de reverso invalido",
        previousStatus: getCommercialOrder(appState, pedidoId)?.status || "DESPACHADO_DEMO",
        nextStatus: getCommercialOrder(appState, pedidoId)?.status || "DESPACHADO_DEMO",
        description: "No existe consumo demo SIMULADO para revertir.",
        result: "bloqueado"
      });
      saveState();
      return { ok: false, error: "No existe consumo demo SIMULADO para revertir." };
    }

    const reason = String(motivo || "Reverso demo desde despacho operativo.").trim();
    const user = currentUserName(appState);
    const reverted = [];

    activeRows.forEach(item => {
      const target = store.consumptionsDemo.find(row => String(row.consumption_id) === String(item.consumption_id));
      if (!target) return;
      target.estado_consumo = "REVERTIDO_DEMO";
      target.usuario_demo = user;
      target.motivo = reason;
      target.observacion = `${target.observacion || ""} | Revertido demo.`.trim();
      target.fecha_hora_reversion = nowIso();
      reverted.push(clone(target));
    });

    const kardexRows = createKardexRowsForConsumptions(appState, reverted, "REVERSO_CONSUMO_DEMO");
    store.kardexOperativoDemo.unshift(...kardexRows.slice().reverse());

    recordCommercialEvent(appState, pedidoId, {
      action: "REVERTIR_CONSUMO_DEMO",
      actionLabel: "Revertir consumo demo",
      previousStatus: getCommercialOrder(appState, pedidoId)?.status || "DESPACHADO_DEMO",
      nextStatus: getCommercialOrder(appState, pedidoId)?.status || "DESPACHADO_DEMO",
      description: `Consumo demo revertido para ${reverted.length} linea(s) del pedido ${pedidoId}.`,
      reason,
      result: "exitoso"
    });
    recordCommercialEvent(appState, pedidoId, {
      action: "GENERAR_KARDEX_REVERSO_DEMO",
      actionLabel: "Generar reverso kardex demo",
      previousStatus: getCommercialOrder(appState, pedidoId)?.status || "DESPACHADO_DEMO",
      nextStatus: getCommercialOrder(appState, pedidoId)?.status || "DESPACHADO_DEMO",
      description: `Kardex demo de reverso generado con ${kardexRows.length} movimiento(s).`,
      reason,
      result: "exitoso"
    });

    saveState();
    return { ok: true, consumptions: reverted, kardex: kardexRows.map(clone) };
  }

  function getConsumptionsDemo(first) {
    const { appState } = resolveArgs(first);
    const store = ensureStore(appState);
    return sortByDateDesc(store?.consumptionsDemo || []).map(clone);
  }

  function getConsumptionsByOrderDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    return getConsumptionsDemo(appState).filter(item => String(item.pedido_id) === String(input || ""));
  }

  function getKardexOperativoDemo(first) {
    const { appState } = resolveArgs(first);
    const store = ensureStore(appState);
    return sortByDateDesc(store?.kardexOperativoDemo || []).map(clone);
  }

  function getKardexByOrderDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    return getKardexOperativoDemo(appState).filter(item => String(item.pedido_id) === String(input || ""));
  }

  function getConsumptionSummaryDemo(first) {
    const { appState } = resolveArgs(first);
    const consumptions = getConsumptionsDemo(appState);
    const active = consumptions.filter(item => String(item.estado_consumo || "").toUpperCase() === "SIMULADO");
    const reverted = consumptions.filter(item => String(item.estado_consumo || "").toUpperCase() === "REVERTIDO_DEMO");
    const availabilitySummary = BlessERP.operacionesAvailabilityDemo?.getAvailabilitySummaryDemo
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilitySummaryDemo(appState)
      : {};
    const dispatches = BlessERP.operacionesDispatchDemo?.getDispatchesDemo
      ? BlessERP.operacionesDispatchDemo.getDispatchesDemo(appState)
      : [];
    const activeOrderSet = new Set(active.map(item => item.pedido_id));
    const pendingOrders = dispatches.filter(item => (
      normalizeText(item.estado_despacho) === "DESPACHADO_DEMO" &&
      !activeOrderSet.has(String(item.pedido_id || ""))
    )).length;

    return {
      availableBunches: parseNumber(availabilitySummary.exportAvailableBunches, 0),
      reservedBunches: parseNumber(availabilitySummary.reservedBunches, 0),
      consumedBunches: active.reduce((sum, item) => sum + parseNumber(item.ramos_consumidos_demo, 0), 0),
      consumedStems: active.reduce((sum, item) => sum + parseNumber(item.tallos_consumidos_demo, 0), 0),
      simulatedCount: active.length,
      revertedCount: reverted.length,
      todaySimulated: active.filter(item => String(item.fecha_hora || "").slice(0, 10) === todayIso()).length,
      pendingOrders
    };
  }

  BlessERP.operacionesConsumptionDemo = {
    getConsumptionsDemo,
    getConsumptionsByOrderDemo,
    simulateConsumptionFromDispatchDemo,
    validateConsumptionReadinessDemo,
    reverseConsumptionDemo,
    getConsumptionSummaryDemo,
    getKardexOperativoDemo,
    getKardexByOrderDemo
  };
})();
