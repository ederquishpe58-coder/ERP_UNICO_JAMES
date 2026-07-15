(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function resolveAppState(appState) {
    return appState || BlessERP.state?.state || null;
  }

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeText(value) {
    return String(value || "").trim().toUpperCase();
  }

  function ensureStore(appState) {
    const state = resolveAppState(appState);
    if (!state) throw new Error("No existe appState para disponibilidad demo.");
    return BlessERP.operacionesState.getStore(state);
  }

  function isReservationActive(status) {
    const value = normalizeText(status);
    return !["LIBERADO_DEMO", "ANULADO_DEMO"].includes(value);
  }

  function calculateStatus(baseRow, reservedBunches) {
    const baseStatus = normalizeText(baseRow.estado);
    if (["VENCIDO", "DESPACHADO", "OBSERVADO"].includes(baseStatus)) return baseStatus;
    if (reservedBunches <= 0) return "DISPONIBLE";
    const initial = parseNumber(baseRow.ramos_disponibles, 0);
    if (reservedBunches >= initial) return "RESERVADO_TOTAL";
    return "RESERVADO_PARCIAL";
  }

  function buildAvailabilityRow(baseRow, reservations) {
    const activeReservations = (reservations || []).filter(item => (
      isReservationActive(item.estado || item.status) &&
      String(item.availability_id || item.availabilityId) === String(baseRow.availability_id)
    ));

    const reservedBunches = activeReservations.reduce((sum, item) => sum + parseNumber(item.ramos_reservados || item.bunchesReserved), 0);
    const reservedStems = activeReservations.reduce((sum, item) => sum + parseNumber(item.tallos_reservados || item.stemsReserved), 0);
    const initialBunches = parseNumber(baseRow.ramos_disponibles, 0);
    const initialStems = parseNumber(baseRow.tallos_disponibles, 0);
    const saldoBunches = Math.max(initialBunches - reservedBunches, 0);
    const saldoStems = Math.max(initialStems - reservedStems, 0);
    const estadoCalculado = calculateStatus(baseRow, reservedBunches);
    const exportable = normalizeText(baseRow.categoria) === "EXPORTACION";
    const reservableDemo = exportable && !["VENCIDO", "OBSERVADO", "DESPACHADO", "RESERVADO_TOTAL"].includes(estadoCalculado) && saldoBunches > 0;

    return {
      ...baseRow,
      ramos_reservados_demo: reservedBunches,
      tallos_reservados_demo: reservedStems,
      ramos_saldo_demo: saldoBunches,
      tallos_saldo_demo: saldoStems,
      estado: estadoCalculado,
      exportable_demo: exportable,
      reservable_demo: reservableDemo,
      reservas_activas_demo: activeReservations.length
    };
  }

  function getReservationsDemo(appState) {
    const store = ensureStore(appState);
    return [...(store.demoReservations || [])]
      .sort((a, b) => String(b.fecha_hora || "").localeCompare(String(a.fecha_hora || "")));
  }

  function getAvailabilityDemo(appState) {
    const store = ensureStore(appState);
    return (store.availabilityDemo || []).map(row => buildAvailabilityRow(row, store.demoReservations || []));
  }

  function getAvailabilityByIdDemo(appState, availabilityId) {
    return getAvailabilityDemo(appState).find(item => item.availability_id === availabilityId) || null;
  }

  function getReservationsByOrderDemo(appState, pedidoId) {
    return getReservationsDemo(appState).filter(item => String(item.pedido_id || item.orderId) === String(pedidoId));
  }

  function getReservationsByAvailabilityDemo(appState, availabilityId) {
    return getReservationsDemo(appState).filter(item => String(item.availability_id || item.availabilityId) === String(availabilityId));
  }

  function getReservationByIdDemo(appState, reservationId) {
    return getReservationsDemo(appState).find(item => String(item.reservation_id || item.id) === String(reservationId)) || null;
  }

  function getAvailabilitySummaryDemo(appState) {
    const rows = getAvailabilityDemo(appState);
    const exportRows = rows.filter(item => normalizeText(item.categoria) === "EXPORTACION");
    const nationalRows = rows.filter(item => normalizeText(item.categoria) === "NACIONAL");
    const expiredRows = rows.filter(item => ["VENCIDO", "OBSERVADO"].includes(normalizeText(item.estado)));
    const activeReservations = getReservationsDemo(appState).filter(item => isReservationActive(item.estado || item.status));

    return {
      totalRows: rows.length,
      exportAvailableBunches: exportRows.reduce((sum, item) => sum + parseNumber(item.ramos_saldo_demo), 0),
      reservedBunches: exportRows.reduce((sum, item) => sum + parseNumber(item.ramos_reservados_demo), 0),
      expiredBunches: expiredRows.reduce((sum, item) => sum + parseNumber(item.ramos_saldo_demo || item.ramos_disponibles), 0),
      nationalBunches: nationalRows.reduce((sum, item) => sum + parseNumber(item.ramos_saldo_demo), 0),
      varietiesAvailable: new Set(exportRows.filter(item => parseNumber(item.ramos_saldo_demo) > 0).map(item => item.variedad)).size,
      activeReservations: activeReservations.length
    };
  }

  function reserveAvailabilityDemo(appState, payload = {}) {
    const store = ensureStore(appState);
    const state = resolveAppState(appState);
    const row = getAvailabilityByIdDemo(state, payload.availability_id || payload.availabilityId);
    if (!row) {
      return { ok: false, error: "La disponibilidad demo no existe." };
    }
    if (!row.exportable_demo) {
      return { ok: false, error: "Solo se puede reservar disponibilidad de categoria exportacion." };
    }
    if (!row.reservable_demo) {
      return { ok: false, error: "La disponibilidad seleccionada no esta disponible para reserva demo." };
    }

    const requestedBunches = parseNumber(payload.ramos_reservados || payload.bunchesReserved, 0);
    if (requestedBunches <= 0) {
      return { ok: false, error: "Debe indicar ramos a reservar mayores a cero." };
    }
    if (requestedBunches > row.ramos_saldo_demo) {
      return { ok: false, error: "No se puede reservar mas ramos que el saldo disponible demo." };
    }

    const stemsReserved = requestedBunches * parseNumber(row.tallos_por_ramo, 0);
    const reservationId = BlessERP.utils.uid("OPS-RES");
    const record = {
      id: reservationId,
      reservation_id: reservationId,
      orderId: payload.pedido_id || payload.orderId || "",
      pedido_id: payload.pedido_id || payload.orderId || "",
      orderNumber: payload.numero_pedido || payload.orderNumber || "",
      numero_pedido: payload.numero_pedido || payload.orderNumber || "",
      cliente_principal: payload.cliente_principal || payload.customerName || "",
      marca_cliente_final: payload.marca_cliente_final || payload.brandName || "",
      fecha_pedido: payload.fecha_pedido || "",
      fecha_vuelo: payload.fecha_vuelo || "",
      availabilityId: row.availability_id,
      availability_id: row.availability_id,
      variety: row.variedad,
      variedad: row.variedad,
      length: row.longitud,
      longitud: row.longitud,
      stemsPerBunch: row.tallos_por_ramo,
      tallos_por_ramo: row.tallos_por_ramo,
      bunchesReserved: requestedBunches,
      ramos_reservados: requestedBunches,
      stemsReserved,
      tallos_reservados: stemsReserved,
      warehouse: row.bodega,
      bodega: row.bodega,
      supplier: row.proveedor,
      proveedor: row.proveedor,
      block: row.bloque,
      bloque: row.bloque,
      status: "reservado_demo",
      estado: "reservado_demo",
      userDemo: payload.usuario_demo || payload.userDemo || state.db.session?.activeUser?.name || "Usuario demo",
      usuario_demo: payload.usuario_demo || payload.userDemo || state.db.session?.activeUser?.name || "Usuario demo",
      fecha_hora: new Date().toISOString(),
      observation: payload.observacion || payload.note || "Reserva demo creada desde Pedido Maestro.",
      observacion: payload.observacion || payload.note || "Reserva demo creada desde Pedido Maestro."
    };

    store.demoReservations.unshift(record);
    BlessERP.state.saveDb();
    return { ok: true, reservation: record, availability: getAvailabilityByIdDemo(state, row.availability_id) };
  }

  function updateReservationStatusDemo(appState, reservationId, nextStatus) {
    const store = ensureStore(appState);
    const reservation = (store.demoReservations || []).find(item => String(item.reservation_id || item.id) === String(reservationId));
    if (!reservation) return null;
    reservation.status = nextStatus;
    reservation.estado = nextStatus;
    reservation.fecha_hora = new Date().toISOString();
    BlessERP.state.saveDb();
    return reservation;
  }

  function confirmReservationDemo(appState, reservationId) {
    return updateReservationStatusDemo(appState, reservationId, "confirmado_demo");
  }

  function releaseReservationDemo(appState, reservationId) {
    return updateReservationStatusDemo(appState, reservationId, "liberado_demo");
  }

  function releaseReservationsByOrderDemo(appState, pedidoId) {
    return getReservationsByOrderDemo(appState, pedidoId)
      .filter(item => isReservationActive(item.estado || item.status))
      .map(item => releaseReservationDemo(appState, item.reservation_id || item.id))
      .filter(Boolean);
  }

  BlessERP.operacionesAvailabilityDemo = {
    confirmReservationDemo,
    getAvailabilityByIdDemo,
    getAvailabilityDemo,
    getAvailabilitySummaryDemo,
    getReservationByIdDemo,
    getReservationsByAvailabilityDemo,
    getReservationsByOrderDemo,
    getReservationsDemo,
    releaseReservationDemo,
    releaseReservationsByOrderDemo,
    reserveAvailabilityDemo
  };
})();
