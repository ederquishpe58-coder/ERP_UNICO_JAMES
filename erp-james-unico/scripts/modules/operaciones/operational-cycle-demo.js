(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const STEP_DEFINITIONS = [
    {
      id: "inventory",
      label: "Inventario rosas demo",
      contract: "operationalInventoryContract",
      module: "Operaciones / Poscosecha -> Inventario de rosas",
      pendingReal: "Conexion real Parte 1"
    },
    {
      id: "availability",
      label: "Disponibilidad",
      contract: "availabilityContract",
      module: "Operaciones / Poscosecha -> Disponibilidad",
      pendingReal: "Disponibilidad real desde Parte 1"
    },
    {
      id: "reservation",
      label: "Reservas",
      contract: "reservationContract",
      module: "Comercial / Exportaciones -> Pedido Maestro",
      pendingReal: "Reserva real sobre inventario operativo"
    },
    {
      id: "dispatch",
      label: "Despacho",
      contract: "dispatchContract",
      module: "Operaciones / Poscosecha -> Despacho operativo",
      pendingReal: "Despacho real con scanner"
    },
    {
      id: "consumption",
      label: "Consumo demo",
      contract: "operationalConsumptionContract",
      module: "Operaciones / Poscosecha -> Inventario de rosas / Despacho",
      pendingReal: "Descuento real de inventario"
    },
    {
      id: "kardex",
      label: "Kardex demo",
      contract: "operationalConsumptionContract",
      module: "Operaciones / Poscosecha -> Inventario de rosas",
      pendingReal: "Persistencia real / Supabase futuro"
    }
  ];

  function isAppState(value) {
    return Boolean(value && value.db);
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

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function upper(value) {
    return String(value || "").trim().toUpperCase();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getOrders(appState) {
    return BlessERP.comercialState?.getOrders ? BlessERP.comercialState.getOrders(appState) : [];
  }

  function findOrder(appState, pedidoId) {
    return BlessERP.comercialState?.findOrder ? BlessERP.comercialState.findOrder(appState, pedidoId) : null;
  }

  function getAvailabilityRows(appState) {
    return BlessERP.operacionesAvailabilityDemo?.getAvailabilityDemo
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilityDemo(appState)
      : [];
  }

  function getAvailabilityById(appState, availabilityId) {
    return BlessERP.operacionesAvailabilityDemo?.getAvailabilityByIdDemo
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilityByIdDemo(appState, availabilityId)
      : null;
  }

  function getReservationsByOrder(appState, pedidoId) {
    return BlessERP.operacionesAvailabilityDemo?.getReservationsByOrderDemo
      ? BlessERP.operacionesAvailabilityDemo.getReservationsByOrderDemo(appState, pedidoId)
      : [];
  }

  function getAllReservations(appState) {
    return BlessERP.operacionesAvailabilityDemo?.getReservationsDemo
      ? BlessERP.operacionesAvailabilityDemo.getReservationsDemo(appState)
      : [];
  }

  function getDispatchByOrder(appState, pedidoId) {
    return BlessERP.operacionesDispatchDemo?.getDispatchByOrderDemo
      ? BlessERP.operacionesDispatchDemo.getDispatchByOrderDemo(appState, pedidoId)
      : null;
  }

  function getAllDispatches(appState) {
    return BlessERP.operacionesDispatchDemo?.getDispatchesDemo
      ? BlessERP.operacionesDispatchDemo.getDispatchesDemo(appState)
      : [];
  }

  function getScanStatus(appState, pedidoId, totalBoxes) {
    return BlessERP.operacionesScannerDemo?.getBoxScanStatusDemo
      ? BlessERP.operacionesScannerDemo.getBoxScanStatusDemo(appState, pedidoId)
      : {
          summary: {
            total: toNumber(totalBoxes, 0),
            scanned: 0,
            pending: toNumber(totalBoxes, 0),
            duplicated: 0,
            observed: 0
          },
          boxes: [],
          message: "Scanner demo no disponible."
        };
  }

  function getScansByOrder(appState, pedidoId) {
    return BlessERP.operacionesScannerDemo?.getScansByOrderDemo
      ? BlessERP.operacionesScannerDemo.getScansByOrderDemo(appState, pedidoId)
      : [];
  }

  function getConsumptionsByOrder(appState, pedidoId) {
    return BlessERP.operacionesConsumptionDemo?.getConsumptionsByOrderDemo
      ? BlessERP.operacionesConsumptionDemo.getConsumptionsByOrderDemo(appState, pedidoId)
      : [];
  }

  function getKardexByOrder(appState, pedidoId) {
    return BlessERP.operacionesConsumptionDemo?.getKardexByOrderDemo
      ? BlessERP.operacionesConsumptionDemo.getKardexByOrderDemo(appState, pedidoId)
      : [];
  }

  function getConsumptionSummary(appState) {
    return BlessERP.operacionesConsumptionDemo?.getConsumptionSummaryDemo
      ? BlessERP.operacionesConsumptionDemo.getConsumptionSummaryDemo(appState)
      : {
          availableBunches: 0,
          reservedBunches: 0,
          consumedBunches: 0,
          consumedStems: 0,
          simulatedCount: 0,
          revertedCount: 0,
          todaySimulated: 0,
          pendingOrders: 0
        };
  }

  function getParte1Status() {
    return BlessERP.operacionesParte1Adapter?.getParte1AdapterStatus
      ? BlessERP.operacionesParte1Adapter.getParte1AdapterStatus()
      : {
          status: "PENDIENTE_INTEGRACION_REAL",
          source: "Parte 1 POSCOSECHA"
        };
  }

  function buildRelatedAvailability(appState, reservations = [], dispatch = null, order = null) {
    const byReservation = reservations
      .map(item => getAvailabilityById(appState, item.availability_id))
      .filter(Boolean);

    if (byReservation.length) return byReservation;

    const rows = getAvailabilityRows(appState);
    const keys = unique((dispatch?.cajas || order?.lines || []).map(item => `${upper(item.variedad || item.variety)}|${String(item.longitud || item.length || "")}`));

    return rows.filter(item => keys.includes(`${upper(item.variedad)}|${String(item.longitud || "")}`));
  }

  function buildUsedReservationMap(dispatch = null) {
    const map = {};
    (dispatch?.cajas || []).forEach(box => {
      (box.lineas || box.lines || []).forEach(line => {
        const reservationId = String(line.reservation_id || line.reservationId || "").trim();
        if (!reservationId) return;
        map[reservationId] = (map[reservationId] || 0) + toNumber(line.ramos || line.bunches || 0);
      });
    });
    return map;
  }

  function buildCycleTimeline(order, dispatch, scanStatus, scans, consumptions, kardex, availabilities, reservations) {
    const events = [];

    if (availabilities.length) {
      events.push({
        id: "inventory-available",
        label: "Inventario disponible",
        status: "OK",
        module: "Inventario de rosas",
        fecha_hora: availabilities[0].fecha || "",
        detail: `${availabilities.length} fila(s) de inventario/disponibilidad demo asociadas.`
      });
      events.push({
        id: "availability-generated",
        label: "Disponibilidad generada",
        status: "OK",
        module: "Disponibilidad",
        fecha_hora: availabilities[0].fecha || "",
        detail: "availabilityContract demo visible para Comercial."
      });
    }

    if (reservations.length) {
      events.push({
        id: "reservation-created",
        label: "Reserva creada",
        status: "OK",
        module: "Pedido Maestro",
        fecha_hora: reservations[0].fecha_hora || reservations[0].fecha_pedido || "",
        detail: `${reservations.length} reserva(s) demo ligadas al pedido.`
      });
    }

    if ((dispatch?.cajas || []).length) {
      events.push({
        id: "box-created",
        label: "Caja creada",
        status: "OK",
        module: "Pedido Maestro / Despacho",
        fecha_hora: order?.updatedAt || "",
        detail: `${dispatch.cajas.length} caja(s) preparadas para despacho demo.`
      });
    }

    if (toNumber(dispatch?.etiquetas_generadas || 0) > 0) {
      events.push({
        id: "label-generated",
        label: "Etiqueta generada",
        status: "OK",
        module: "Etiquetas",
        fecha_hora: order?.updatedAt || "",
        detail: `${dispatch.etiquetas_generadas} etiqueta(s) demo generadas.`
      });
    }

    if ((scanStatus.summary?.scanned || 0) > 0) {
      events.push({
        id: "box-scanned",
        label: "Caja escaneada",
        status: scanStatus.summary.pending ? "ADVERTENCIA" : "OK",
        module: "Scanner / Zebra demo",
        fecha_hora: scans[scans.length - 1]?.fecha_hora || "",
        detail: `${scanStatus.summary.scanned} caja(s) escaneadas demo, ${scanStatus.summary.pending} pendiente(s).`
      });
    }

    if (dispatch && ["EN_PREPARACION", "LISTO_DESPACHO", "DESPACHADO_DEMO", "OBSERVADO"].includes(upper(dispatch.estado_despacho))) {
      events.push({
        id: "dispatch-prepared",
        label: "Despacho preparado",
        status: upper(dispatch.estado_despacho) === "OBSERVADO" ? "ADVERTENCIA" : "OK",
        module: "Despacho operativo",
        fecha_hora: dispatch.actualizado_en_demo || "",
        detail: `Estado actual de despacho: ${dispatch.estado_despacho || "PENDIENTE"}.`
      });
    }

    if (upper(dispatch?.estado_despacho) === "DESPACHADO_DEMO") {
      events.push({
        id: "dispatch-confirmed",
        label: "Despacho confirmado demo",
        status: "OK",
        module: "Despacho operativo / Pedido Maestro",
        fecha_hora: dispatch.fecha_hora_despacho || "",
        detail: "Despacho demo confirmado sin afectar inventario real."
      });
    }

    const activeConsumptions = consumptions.filter(item => upper(item.estado_consumo) === "SIMULADO");
    if (activeConsumptions.length) {
      events.push({
        id: "consumption-simulated",
        label: "Consumo demo simulado",
        status: "OK",
        module: "Inventario de rosas / Despacho",
        fecha_hora: activeConsumptions[0].fecha_hora || "",
        detail: `${activeConsumptions.length} linea(s) de consumo demo SIMULADO.`
      });
    }

    if (kardex.length) {
      events.push({
        id: "kardex-generated",
        label: "Kardex demo generado",
        status: "OK",
        module: "Inventario de rosas",
        fecha_hora: kardex[0].fecha_hora || "",
        detail: `${kardex.length} movimiento(s) demo registrados.`
      });
    }

    const reverted = consumptions.filter(item => upper(item.estado_consumo) === "REVERTIDO_DEMO");
    if (reverted.length) {
      events.push({
        id: "consumption-reverted",
        label: "Consumo revertido",
        status: "ADVERTENCIA",
        module: "Inventario de rosas / Despacho",
        fecha_hora: reverted[0].fecha_hora || "",
        detail: `${reverted.length} linea(s) de consumo demo revertidas.`
      });
    }

    return events.length ? events : [{
      id: "cycle-pending",
      label: "Ciclo demo pendiente",
      status: "PENDIENTE",
      module: "Operaciones / Comercial",
      fecha_hora: "",
      detail: "Aun no hay suficientes eventos demo para construir la linea de tiempo."
    }];
  }

  function computeCycleState(order, dispatch, reservations, activeConsumptions, kardex, validation) {
    if (validation.errors.length) return "OBSERVADO";
    if (activeConsumptions.length && kardex.length) return "CERRADO_DEMO";
    if (activeConsumptions.length) return "CONSUMO_SIMULADO";
    if (upper(dispatch?.estado_despacho) === "DESPACHADO_DEMO") return "DESPACHADO_DEMO";
    if (dispatch && ["EN_PREPARACION", "LISTO_DESPACHO", "PENDIENTE"].includes(upper(dispatch.estado_despacho))) return "EN_DESPACHO";
    if (reservations.length) return "RESERVADO";
    if (order) return "DISPONIBLE";
    return "SIN_INICIAR";
  }

  function validateOperationalCycleDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const order = findOrder(appState, input);
    const dispatch = getDispatchByOrder(appState, input);
    const reservations = getReservationsByOrder(appState, input);
    const consumptions = getConsumptionsByOrder(appState, input);
    const activeConsumptions = consumptions.filter(item => upper(item.estado_consumo) === "SIMULADO");
    const usedReservationMap = buildUsedReservationMap(dispatch);
    const errors = [];
    const warnings = [];

    if (upper(order?.status) === "ANULADO") errors.push("Pedido anulado.");
    if (upper(dispatch?.estado_despacho) === "ANULADO_DEMO") errors.push("Despacho anulado.");
    if (activeConsumptions.length && upper(dispatch?.estado_despacho) !== "DESPACHADO_DEMO") errors.push("Consumo simulado sin despacho confirmado.");

    const reservedBunches = reservations.reduce((sum, item) => sum + toNumber(item.ramos_reservados || item.bunchesReserved || 0), 0);
    const consumedBunches = activeConsumptions.reduce((sum, item) => sum + toNumber(item.ramos_consumidos_demo || 0), 0);
    if (reservedBunches > 0 && consumedBunches > reservedBunches) {
      errors.push("Consumo demo mayor a reserva.");
    }

    (dispatch?.cajas || []).forEach(box => {
      const lines = box.lineas || box.lines || [];
      lines.forEach(line => {
        if (!upper(line.variedad || line.variety) || !String(line.longitud || line.length || "").trim()) {
          errors.push(`Caja ${box.numero_caja || box.box_id || "-"} sin variedad/longitud completa.`);
        }
      });
    });

    warnings.push("Inventario real no conectado.");
    warnings.push("Parte 1 real pendiente.");
    warnings.push("Supabase pendiente.");
    warnings.push("Scanner real no conectado.");
    warnings.push("Despacho demo no descuenta inventario real.");
    warnings.push("Consumo demo no descuenta stock real.");
    warnings.push("Kardex demo no persistente.");
    warnings.push("Contabilidad no afectada.");
    warnings.push("SRI no afectado.");

    const boxesWithoutReservation = (dispatch?.cajas || []).filter(box => {
      const lines = box.lineas || box.lines || [];
      return lines.some(line => !String(line.reservation_id || line.reservationId || "").trim());
    }).length;
    if (boxesWithoutReservation) warnings.push("Cajas sin reserva asociada.");

    const unusedReservations = reservations.filter(item => {
      const reserved = toNumber(item.ramos_reservados || item.bunchesReserved || 0);
      return reserved > toNumber(usedReservationMap[item.reservation_id], 0);
    }).length;
    if (unusedReservations) warnings.push("Reservas sin usar en cajas.");

    return {
      ok: !errors.length,
      errors: unique(errors),
      warnings: unique(warnings)
    };
  }

  function getOperationalCycleWarningsDemo(first, second) {
    return validateOperationalCycleDemo(first, second).warnings;
  }

  function getOperationalCycleTimelineDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const order = findOrder(appState, input);
    const dispatch = getDispatchByOrder(appState, input);
    const reservations = getReservationsByOrder(appState, input);
    const availabilities = buildRelatedAvailability(appState, reservations, dispatch, order);
    const scanStatus = getScanStatus(appState, input, dispatch?.cajas?.length || order?.boxes?.length || 0);
    const scans = getScansByOrder(appState, input);
    const consumptions = getConsumptionsByOrder(appState, input);
    const kardex = getKardexByOrder(appState, input);
    return buildCycleTimeline(order, dispatch, scanStatus, scans, consumptions, kardex, availabilities, reservations);
  }

  function getOperationalCycleByOrderDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const order = findOrder(appState, input);
    const dispatch = getDispatchByOrder(appState, input);
    const reservations = getReservationsByOrder(appState, input);
    const availabilityRows = buildRelatedAvailability(appState, reservations, dispatch, order);
    const scanStatus = getScanStatus(appState, input, dispatch?.cajas?.length || order?.boxes?.length || 0);
    const scans = getScansByOrder(appState, input);
    const consumptions = getConsumptionsByOrder(appState, input);
    const kardex = getKardexByOrder(appState, input);
    const validation = validateOperationalCycleDemo(appState, input);
    const activeConsumptions = consumptions.filter(item => upper(item.estado_consumo) === "SIMULADO");
    const cycleState = computeCycleState(order, dispatch, reservations, activeConsumptions, kardex, validation);
    const inventarioOrigen = {
      source: "DEMO",
      futureSource: getParte1Status().source || "Parte 1 POSCOSECHA",
      rows: availabilityRows.map(item => ({
        availability_id: item.availability_id,
        variedad: item.variedad,
        longitud: item.longitud,
        ramos_disponibles: item.ramos_disponibles,
        bodega: item.bodega
      })),
      contract: "operationalInventoryContract"
    };

    return {
      pedido_id: String(input || order?.id || dispatch?.pedido_id || "").trim(),
      numero_pedido: order?.number || dispatch?.numero_pedido || "",
      inventario_origen: inventarioOrigen,
      disponibilidad_relacionada: clone(availabilityRows),
      reservas: clone(reservations),
      cajas: clone(dispatch?.cajas || []),
      despacho: dispatch ? clone(dispatch) : null,
      escaneos: {
        summary: clone(scanStatus.summary || {}),
        rows: clone(scans),
        boxes: clone(scanStatus.boxes || [])
      },
      consumos: clone(consumptions),
      kardex: clone(kardex),
      estado_ciclo: cycleState,
      errores: validation.errors,
      advertencias: validation.warnings
    };
  }

  function buildStepSummary(appState) {
    const availabilityRows = getAvailabilityRows(appState);
    const availabilitySummary = BlessERP.operacionesAvailabilityDemo?.getAvailabilitySummaryDemo
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilitySummaryDemo(appState)
      : {
          exportAvailableBunches: availabilityRows.reduce((sum, item) => sum + toNumber(item.ramos_saldo_demo || item.ramos_disponibles || 0), 0),
          reservedBunches: availabilityRows.reduce((sum, item) => sum + toNumber(item.ramos_reservados_demo || 0), 0)
        };
    const reservations = getAllReservations(appState);
    const dispatches = getAllDispatches(appState);
    const consumptionSummary = getConsumptionSummary(appState);
    const kardexCount = BlessERP.operacionesConsumptionDemo?.getKardexOperativoDemo
      ? BlessERP.operacionesConsumptionDemo.getKardexOperativoDemo(appState).length
      : 0;

    return STEP_DEFINITIONS.map(step => {
      if (step.id === "inventory") {
        return {
          ...step,
          status: "demo activo",
          quantity: availabilityRows.reduce((sum, item) => sum + toNumber(item.ramos_disponibles || 0), 0),
          quantityLabel: `${availabilityRows.length} fila(s) / ${availabilityRows.reduce((sum, item) => sum + toNumber(item.ramos_disponibles || 0), 0)} ramos`
        };
      }
      if (step.id === "availability") {
        return {
          ...step,
          status: "demo activo",
          quantity: toNumber(availabilitySummary.exportAvailableBunches, 0),
          quantityLabel: `${toNumber(availabilitySummary.exportAvailableBunches, 0)} ramos demo`
        };
      }
      if (step.id === "reservation") {
        return {
          ...step,
          status: reservations.length ? "demo activo" : "pendiente demo",
          quantity: reservations.reduce((sum, item) => sum + toNumber(item.ramos_reservados || 0), 0),
          quantityLabel: `${reservations.length} reserva(s) / ${reservations.reduce((sum, item) => sum + toNumber(item.ramos_reservados || 0), 0)} ramos`
        };
      }
      if (step.id === "dispatch") {
        return {
          ...step,
          status: dispatches.length ? "demo activo" : "pendiente demo",
          quantity: dispatches.length,
          quantityLabel: `${dispatches.length} despacho(s) demo`
        };
      }
      if (step.id === "consumption") {
        return {
          ...step,
          status: consumptionSummary.simulatedCount ? "demo activo" : "pendiente demo",
          quantity: toNumber(consumptionSummary.consumedBunches, 0),
          quantityLabel: `${toNumber(consumptionSummary.consumedBunches, 0)} ramos consumidos demo`
        };
      }
      return {
        ...step,
        status: kardexCount ? "demo activo" : "pendiente demo",
        quantity: kardexCount,
        quantityLabel: `${kardexCount} movimiento(s) demo`
      };
    });
  }

  function getOperationalCycleSummaryDemo(first) {
    const { appState } = resolveArgs(first);
    const orders = getOrders(appState);
    const dispatches = getAllDispatches(appState);
    const cycleRows = orders.map(order => getOperationalCycleByOrderDemo(appState, order.id));
    const part1Status = getParte1Status();
    const consumptionSummary = getConsumptionSummary(appState);
    const dispatchStates = dispatches.reduce((acc, item) => {
      const key = upper(item.estado_despacho || "PENDIENTE");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return {
      status: "activo",
      source: "DEMO",
      futureSource: part1Status.source || "Parte 1 POSCOSECHA",
      part1AdapterStatus: part1Status.status || "PENDIENTE_INTEGRACION_REAL",
      steps: buildStepSummary(appState),
      cycles: cycleRows,
      counts: {
        orders: orders.length,
        dispatches: dispatches.length,
        reservedBunches: cycleRows.reduce((sum, item) => sum + item.reservas.reduce((inner, row) => inner + toNumber(row.ramos_reservados || 0), 0), 0),
        dispatchedBunches: dispatches
          .filter(item => upper(item.estado_despacho) === "DESPACHADO_DEMO")
          .reduce((sum, item) => sum + toNumber(item.total_ramos || 0), 0),
        consumedBunches: toNumber(consumptionSummary.consumedBunches, 0),
        consumedStems: toNumber(consumptionSummary.consumedStems, 0),
        kardexRows: BlessERP.operacionesConsumptionDemo?.getKardexOperativoDemo ? BlessERP.operacionesConsumptionDemo.getKardexOperativoDemo(appState).length : 0,
        pendingConsumption: toNumber(consumptionSummary.pendingOrders, 0),
        observedCycles: cycleRows.filter(item => item.errores.length).length,
        dispatchStateMap: dispatchStates
      }
    };
  }

  BlessERP.operacionesCycleDemo = {
    getOperationalCycleSummaryDemo,
    getOperationalCycleByOrderDemo,
    validateOperationalCycleDemo,
    getOperationalCycleWarningsDemo,
    getOperationalCycleTimelineDemo
  };
})();
