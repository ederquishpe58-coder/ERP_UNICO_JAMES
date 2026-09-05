(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const DEFAULT_SETTINGS = Object.freeze({
    autoActivateOrders: true,
    activationTime: "05:00",
    mondayToSaturday: true,
    showFutureOrders: true,
    allowRiskSales: true,
    requireRiskObservation: true,
    projectionDays: 3
  });

  const CLOSED_STATUSES = new Set(["REFERENCIAL", "REABIERTO_DEMO", "ANULADO", "DESPACHADO_DEMO", "DESPACHADO", "CERRADO_DEMO", "CERRADO"]);
  const ELIGIBLE_STATUSES = new Set(["VALIDADO_COMERCIAL", "LISTO_BODEGA", "LISTO_DESPACHO"]);
  const OPEN_WAREHOUSE_STATUSES = new Set(["LIBERADO_BODEGA", "EN_ARMADO", "PARCIAL_FALTANTE", "ACTUALIZADO_POR_VENTAS", "CAMBIO_REVISADO_BODEGA"]);

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function inventorySupplyMode(order) {
    return normalize(order?.inventorySupplyMode || order?.inventory_supply_mode);
  }

  function reservationMode(order) {
    return normalize(order?.availabilityReservationMode || order?.availability_reservation_mode);
  }

  function isExplicitlyReserved(order) {
    const mode = reservationMode(order);
    const status = normalize(order?.availabilityCommitmentStatus || order?.availability_commitment_status);
    return mode === "RESERVADO" || status === "RESERVADO_FUTURO";
  }

  function isSavedOrder(order) {
    if (!order || order.unsavedDraft || order.numberPending) return false;
    return Boolean(
      String(order.number || "").trim()
      && (
        String(order.savedAt || "").trim()
        || String(order.sriInvoiceNumber || order.sriSequential || "").trim()
        || (order.history || []).some(item => normalize(item?.action) === "GUARDAR_PEDIDO")
      )
    );
  }

  function hasAvailabilityCommitment(order) {
    if (!order) return false;
    if (inventorySupplyMode(order) === "EXTERNAL_FARM") return false;
    if (reservationMode(order) === "INFORMATIVO") return false;
    if (isExplicitlyReserved(order)) return true;
    if (order.availabilityCommittedAt || order.availability_committed_at) return true;
    if ((order.history || []).some(item => normalize(item?.action) === "GUARDAR_PEDIDO")) return true;
    return normalize(order.sriSequenceStatus) === "RESERVADO" && Boolean(String(order.sriInvoiceNumber || "").trim());
  }

  function parseBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (["TRUE", "1", "SI", "SÍ", "ON"].includes(normalize(value))) return true;
    if (["FALSE", "0", "NO", "OFF"].includes(normalize(value))) return false;
    return fallback;
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function addDays(dateKey, days) {
    const date = new Date(`${dateKey}T12:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return localDateKey(date);
  }

  function orderPreparationDate(order) {
    return String(order?.preparationDate || order?.flightDate || order?.departureDate || order?.issuedAt || "").slice(0, 10);
  }

  function isEligibleOrder(order) {
    if (!order) return false;
    const status = normalize(order.status);
    const warehouseStatus = normalize(order.warehouseStatus);
    const committedDraft = status === "BORRADOR" && hasAvailabilityCommitment(order);
    const savedFutureDraft = status === "BORRADOR" && isSavedOrder(order);
    if (status === "BORRADOR" && !committedDraft && !savedFutureDraft) return false;
    if (CLOSED_STATUSES.has(status) || warehouseStatus === "COMPLETO_BODEGA") return false;
    return committedDraft || savedFutureDraft || ELIGIBLE_STATUSES.has(status) || OPEN_WAREHOUSE_STATUSES.has(warehouseStatus);
  }

  function getStore(appState) {
    return BlessERP.operacionesState?.getStore?.(appState) || null;
  }

  function getSettings(appState) {
    const store = getStore(appState);
    const saved = store?.availabilityPolicySettings || {};
    const settings = {
      autoActivateOrders: parseBoolean(saved.autoActivateOrders, DEFAULT_SETTINGS.autoActivateOrders),
      activationTime: /^\d{2}:\d{2}$/.test(String(saved.activationTime || "")) ? String(saved.activationTime) : DEFAULT_SETTINGS.activationTime,
      mondayToSaturday: parseBoolean(saved.mondayToSaturday, DEFAULT_SETTINGS.mondayToSaturday),
      showFutureOrders: parseBoolean(saved.showFutureOrders, DEFAULT_SETTINGS.showFutureOrders),
      allowRiskSales: parseBoolean(saved.allowRiskSales, DEFAULT_SETTINGS.allowRiskSales),
      requireRiskObservation: parseBoolean(saved.requireRiskObservation, DEFAULT_SETTINGS.requireRiskObservation),
      projectionDays: [1, 3, 7].includes(Number(saved.projectionDays)) ? Number(saved.projectionDays) : DEFAULT_SETTINGS.projectionDays
    };
    if (store) store.availabilityPolicySettings = settings;
    return settings;
  }

  function updateSetting(appState, field, value) {
    const store = getStore(appState);
    if (!store || !Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, field)) return false;
    const settings = getSettings(appState);
    if (["autoActivateOrders", "mondayToSaturday", "showFutureOrders", "allowRiskSales", "requireRiskObservation"].includes(field)) {
      settings[field] = parseBoolean(value, settings[field]);
    } else if (field === "projectionDays") {
      settings[field] = [1, 3, 7].includes(Number(value)) ? Number(value) : settings[field];
    } else if (field === "activationTime" && /^\d{2}:\d{2}$/.test(String(value || ""))) {
      settings[field] = String(value);
    }
    store.availabilityPolicySettings = settings;
    BlessERP.state?.saveDb?.();
    return true;
  }

  function isWorkingDay(dateKey, settings) {
    if (!settings.mondayToSaturday) return true;
    return new Date(`${dateKey}T12:00:00`).getDay() !== 0;
  }

  function activationReady(now, settings) {
    const today = localDateKey(now);
    const currentTime = String(now.toTimeString()).slice(0, 5);
    return isWorkingDay(today, settings) && currentTime >= settings.activationTime;
  }

  function isOrderActive(order, appState, now = new Date()) {
    if (!isEligibleOrder(order)) return false;
    // Los pedidos del día afectan disponibilidad al guardarse. Un pedido con
    // fecha futura solo descuenta antes de tiempo cuando fue reservado de
    // forma explícita desde Disponibilidad.
    if (isExplicitlyReserved(order)) return true;
    const warehouseStatus = normalize(order.warehouseStatus);
    if (OPEN_WAREHOUSE_STATUSES.has(warehouseStatus)) return true;
    const date = orderPreparationDate(order);
    if (!date) return true;
    const today = localDateKey(now);
    if (date < today) return true;
    if (date > today) return false;
    if (normalize(order.status) === "BORRADOR" && isSavedOrder(order)) return true;
    if (normalize(order.availabilityStatus) === "ACTIVO") return true;
    const settings = getSettings(appState);
    return settings.autoActivateOrders && activationReady(now, settings);
  }

  function isFutureOrder(order, appState, now = new Date()) {
    if (!isEligibleOrder(order) || isOrderActive(order, appState, now)) return false;
    const date = orderPreparationDate(order);
    return Boolean(date && date > localDateKey(now));
  }

  function isScheduledFutureOrder(order, appState, now = new Date()) {
    if (!isEligibleOrder(order)) return false;
    const date = orderPreparationDate(order);
    return Boolean(date && date > localDateKey(now));
  }

  function horizonRange(horizon, now = new Date()) {
    const today = localDateKey(now);
    const normalized = normalize(horizon) || "HOY";
    if (normalized === "MANANA" || normalized === "MAÑANA") {
      const tomorrow = addDays(today, 1);
      return { from: tomorrow, to: tomorrow, label: "Mañana" };
    }
    if (normalized === "SEMANA") return { from: today, to: addDays(today, 7), label: "Semana" };
    return { from: today, to: today, label: "Hoy" };
  }

  function getScheduledOrders(appState, horizon = "HOY", now = new Date()) {
    const range = horizonRange(horizon, now);
    const orders = BlessERP.comercialState?.getOrders?.(appState) || [];
    return orders.filter(order => {
      if (!isScheduledFutureOrder(order, appState, now)) return false;
      const date = orderPreparationDate(order);
      return date >= range.from && date <= range.to;
    }).map(order => ({
      order,
      preparationDate: orderPreparationDate(order),
      bunches: (order.lines || []).reduce((sum, line) => sum + Number(line.bunches || 0), 0),
      reserved: isExplicitlyReserved(order)
    })).sort((left, right) => left.preparationDate.localeCompare(right.preparationDate) || String(left.order.number || "").localeCompare(String(right.order.number || "")));
  }

  function findOrder(appState, orderId) {
    const orders = BlessERP.comercialIntercompany?.getAllOrders?.(appState)
      || BlessERP.comercialState?.getOrders?.(appState)
      || [];
    return orders.find(order => String(order.id) === String(orderId)) || null;
  }

  function appendReservationHistory(order, action, description) {
    order.history = Array.isArray(order.history) ? order.history : [];
    order.history.unshift({
      id: BlessERP.utils?.uid?.("AVL-RES") || `AVL-RES-${Date.now()}`,
      action,
      actionLabel: action === "RESERVAR_PEDIDO_FUTURO" ? "Reservar pedido futuro" : "Liberar reserva futura",
      dateTime: new Date().toISOString(),
      description,
      result: "exitoso"
    });
  }

  function setFutureReservation(appState, orderId, reserve) {
    const order = findOrder(appState, orderId);
    if (!order) return { ok: false, error: "No se encontró el pedido futuro." };
    if (inventorySupplyMode(order) === "EXTERNAL_FARM") {
      return { ok: false, error: "La compra externa no utiliza disponibilidad de Bless Flower." };
    }
    const preparationDate = orderPreparationDate(order);
    const today = localDateKey();
    if (!preparationDate || preparationDate <= today) {
      return { ok: false, error: "La reserva manual solo aplica a pedidos con fecha posterior a hoy." };
    }
    if (!isSavedOrder(order)) {
      return { ok: false, error: "Primero guarde el pedido para poder reservar su disponibilidad." };
    }
    const warehouseStatus = normalize(order.warehouseStatus);
    if (!reserve && OPEN_WAREHOUSE_STATUSES.has(warehouseStatus)) {
      return { ok: false, error: "El pedido ya está en Cuarto frío; su compromiso no puede liberarse desde Disponibilidad." };
    }
    const now = new Date().toISOString();
    if (reserve) {
      order.availabilityReservationMode = "RESERVADO";
      order.availabilityCommitmentStatus = "RESERVADO_FUTURO";
      order.availabilityCommittedAt = order.availabilityCommittedAt || now;
      order.availabilityReservedAt = now;
      order.availabilityReservedBy = appState?.db?.session?.activeUser?.name || "Usuario comercial";
      order.availabilityReleasedAt = "";
      order.availabilityCommitmentSource = "RESERVA_FUTURA_MANUAL";
      appendReservationHistory(order, "RESERVAR_PEDIDO_FUTURO", `El pedido ${order.number || order.id} reservó disponibilidad antes de su fecha de preparación.`);
    } else {
      order.availabilityReservationMode = "INFORMATIVO";
      order.availabilityCommitmentStatus = "INFORMATIVO_FUTURO";
      order.availabilityCommittedAt = "";
      order.availabilityReservedAt = "";
      order.availabilityReservedBy = "";
      order.availabilityReleasedAt = now;
      order.availabilityCommitmentSource = "PEDIDO_FUTURO_INFORMATIVO";
      appendReservationHistory(order, "LIBERAR_RESERVA_FUTURA", `El pedido ${order.number || order.id} volvió a ser informativo y liberó su disponibilidad.`);
    }
    BlessERP.operacionesState?.setUiValue?.(appState, "availabilityLastUpdated", now);
    BlessERP.state?.saveDb?.();
    return { ok: true, order, reserved: Boolean(reserve) };
  }

  function synchronizeDueOrders(appState, options = {}) {
    const settings = getSettings(appState);
    const now = options.now instanceof Date ? options.now : new Date();
    const today = localDateKey(now);
    const force = Boolean(options.force);
    const canActivate = force || (settings.autoActivateOrders && activationReady(now, settings));
    const store = getStore(appState);
    if (!canActivate) return { ok: true, activated: [], skipped: true, reason: "Horario o activacion automatica pendiente." };
    const orders = BlessERP.comercialState?.getOrders?.(appState) || [];
    const activated = [];
    orders.forEach(order => {
      const date = orderPreparationDate(order);
      if (!isEligibleOrder(order) || !date || date > today || normalize(order.availabilityStatus) === "ACTIVO") return;
      order.availabilityStatus = "ACTIVO";
      order.availabilityActivatedAt = new Date().toISOString();
      order.availabilityActivatedDate = today;
      order.availabilityReservationMode = "ACTIVO_DIA";
      order.availabilityCommitmentStatus = "ACTIVO";
      order.availabilityCommittedAt = order.availabilityCommittedAt || new Date().toISOString();
      activated.push(order.id);
    });
    if (store) {
      store.ui.availabilityLastUpdated = new Date().toISOString();
      store.availabilityActivationLog = Array.isArray(store.availabilityActivationLog) ? store.availabilityActivationLog : [];
      if (activated.length) store.availabilityActivationLog.unshift({ id: BlessERP.utils.uid("AVL-ACT"), dateTime: new Date().toISOString(), orderIds: activated, automatic: !force });
    }
    if (activated.length || force) BlessERP.state?.saveDb?.();
    return { ok: true, activated, skipped: false };
  }

  function evaluateOrderRisk(appState, order) {
    const fulfillment = BlessERP.comercialOrderFulfillment;
    if (!order || !fulfillment?.getAvailabilityRows || !fulfillment?.getFutureDemandRows) return { hasRisk: false, risks: [], futureBunches: 0 };
    const settings = getSettings(appState);
    const availableRows = fulfillment.getAvailabilityRows(appState);
    const futureRows = fulfillment.getFutureDemandRows(appState, settings.projectionDays, order.id);
    const futureByKey = new Map(futureRows.map(row => [row.key, row]));
    const currentByKey = new Map();
    (order.lines || []).forEach(line => {
      const key = fulfillment.demandKeyForLine(line);
      currentByKey.set(key, (currentByKey.get(key) || 0) + Number(line.bunches || 0));
    });
    const risks = [];
    currentByKey.forEach((requested, key) => {
      const future = futureByKey.get(key);
      if (!future) return;
      const available = availableRows.find(row => row.key === key);
      const spot = Number(available?.spotAvailableBunches ?? available?.availableForSaleBunches ?? 0);
      const remainingAfterSale = Math.max(spot - requested, 0);
      const futureDemand = Number(future.futureOrderBunches || 0);
      if (futureDemand <= remainingAfterSale) return;
      risks.push({
        key,
        variety: future.variety,
        lengthLabel: future.lengthLabel,
        stemsPerBunch: future.stemsPerBunch,
        requested,
        spot,
        remainingAfterSale,
        futureDemand,
        riskBunches: futureDemand - remainingAfterSale,
        orderNumbers: future.orderNumbers || []
      });
    });
    return { hasRisk: risks.length > 0, risks, futureBunches: risks.reduce((sum, item) => sum + item.futureDemand, 0), projectionDays: settings.projectionDays };
  }

  function recordRiskObservation(appState, order, observation, riskResult) {
    if (!order || !String(observation || "").trim()) return false;
    order.availabilityRiskObservations = Array.isArray(order.availabilityRiskObservations) ? order.availabilityRiskObservations : [];
    order.availabilityRiskObservations.unshift({
      id: BlessERP.utils.uid("AVL-RISK"),
      dateTime: new Date().toISOString(),
      observation: String(observation).trim(),
      projectionDays: Number(riskResult?.projectionDays || getSettings(appState).projectionDays),
      risks: (riskResult?.risks || []).map(item => ({ ...item }))
    });
    order.availabilityRiskObservation = String(observation).trim();
    BlessERP.state?.saveDb?.();
    return true;
  }

  BlessERP.operacionesAvailabilityPolicy = {
    DEFAULT_SETTINGS,
    addDays,
    evaluateOrderRisk,
    getScheduledOrders,
    getSettings,
    hasAvailabilityCommitment,
    horizonRange,
    isEligibleOrder,
    isExplicitlyReserved,
    isFutureOrder,
    isScheduledFutureOrder,
    isOrderActive,
    localDateKey,
    orderPreparationDate,
    recordRiskObservation,
    setFutureReservation,
    synchronizeDueOrders,
    updateSetting
  };
})();
