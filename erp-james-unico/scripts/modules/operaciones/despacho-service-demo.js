(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const DISPATCH_STATES = [
    "PENDIENTE",
    "PEDIDO_INCOMPLETO",
    "PEDIDO_COMPLETADO",
    "PEDIDO_ACTUALIZADO",
    "CARGADO_CAMION",
    "EN_PREPARACION",
    "LISTO_DESPACHO",
    "DESPACHADO_DEMO",
    "OBSERVADO",
    "ANULADO",
    "ANULADO_DEMO"
  ];

  const BOX_FULL_EQUIVALENCE = {
    HB: 0.5,
    QB: 0.25,
    EB: 1
  };

  const seedDispatches = [
    {
      dispatch_id: "DSP-DEMO-0001",
      pedido_id: "order-demo-0001",
      numero_pedido: "PED-COM-2026-0001",
      cliente_principal: "URSA",
      marca_cliente_final: "ALEX",
      destino: "KAZAJSTAN",
      fecha_vuelo: "2026-07-12",
      dae: "055-2026-40-01186707",
      awb: "369-45872109",
      hawb: "HWB-URSA-001",
      agencia_carga: "PACIFIC CARGO",
      carrier: "ATLAS",
      vuelo: "5Y 901",
      total_cajas: 4,
      total_fulls: 2,
      total_ramos: 32,
      total_tallos: 800,
      estado_pedido: "LISTO_BODEGA",
      estado_bodega: "PREPARADO_DEMO",
      estado_etiquetas: "LISTAS",
      estado_reservas: "REVISADAS",
      estado_despacho: "LISTO_DESPACHO",
      cajas: [
        {
          box_id: "BOX-DEMO-0001",
          numero_caja: 1,
          tipo_caja: "HB",
          po: "PO-URSA-001",
          contenido_resumido: "NINA 50 cm / 8 ramos / 200 tallos",
          etiqueta_generada: true,
          estado_caja: "LISTA",
          reservation_id: "RSV-DEMO-0001",
          ramos: 8,
          tallos: 200
        },
        {
          box_id: "BOX-DEMO-0002",
          numero_caja: 2,
          tipo_caja: "HB",
          po: "PO-URSA-001",
          contenido_resumido: "PINK MONDIAL 40 cm / 8 ramos / 200 tallos",
          etiqueta_generada: true,
          estado_caja: "LISTA",
          reservation_id: "RSV-DEMO-0002",
          ramos: 8,
          tallos: 200
        },
        {
          box_id: "BOX-DEMO-0003",
          numero_caja: 3,
          tipo_caja: "HB",
          po: "PO-URSA-001",
          contenido_resumido: "PLAYA BLANCA 50 cm / 8 ramos / 200 tallos",
          etiqueta_generada: true,
          estado_caja: "LISTA",
          reservation_id: "RSV-DEMO-0003",
          ramos: 8,
          tallos: 200
        },
        {
          box_id: "BOX-DEMO-0004",
          numero_caja: 4,
          tipo_caja: "HB",
          po: "PO-URSA-001",
          contenido_resumido: "EXPLORER 60 cm / 8 ramos / 200 tallos",
          etiqueta_generada: true,
          estado_caja: "LISTA",
          reservation_id: "RSV-DEMO-0004",
          ramos: 8,
          tallos: 200
        }
      ],
      materiales_requeridos: [
        { material_codigo: "CARTON-HB", material_nombre: "Caja HB", requerido: 4, disponible: 6, faltante: 0, estado: "OK" },
        { material_codigo: "ETQ-CAJA", material_nombre: "Etiqueta de caja", requerido: 4, disponible: 10, faltante: 0, estado: "OK" },
        { material_codigo: "LIGA-001", material_nombre: "Liga para bonche", requerido: 32, disponible: 40, faltante: 0, estado: "OK" }
      ],
      reservas_relacionadas: [
        { reservation_id: "RSV-DEMO-0001", variedad: "NINA", longitud: 50, ramos_reservados: 8, ramos_usados_cajas: 8, diferencia: 0, estado_reserva: "RESERVADO" },
        { reservation_id: "RSV-DEMO-0002", variedad: "PINK MONDIAL", longitud: 40, ramos_reservados: 8, ramos_usados_cajas: 8, diferencia: 0, estado_reserva: "RESERVADO" }
      ],
      etiquetas_generadas: 4,
      responsable_demo: "Marco A.",
      fecha_hora_despacho: "",
      observacion: "Pedido demo listo para confirmacion de despacho."
    },
    {
      dispatch_id: "DSP-DEMO-0002",
      pedido_id: "order-demo-0002",
      numero_pedido: "PED-COM-2026-0002",
      cliente_principal: "CVFLOR GROUP",
      marca_cliente_final: "DEL REAL",
      destino: "REPUBLICA DOMINICANA",
      fecha_vuelo: "2026-07-14",
      dae: "055-2026-40-00992586",
      awb: "",
      hawb: "",
      agencia_carga: "FRESH LOGISTICS",
      carrier: "LATAM CARGO",
      vuelo: "LA 1413",
      total_cajas: 3,
      total_fulls: 1.25,
      total_ramos: 18,
      total_tallos: 450,
      estado_pedido: "VALIDADO_COMERCIAL",
      estado_bodega: "PARCIAL",
      estado_etiquetas: "PENDIENTES",
      estado_reservas: "CON_DIFERENCIAS",
      estado_despacho: "OBSERVADO",
      cajas: [
        {
          box_id: "BOX-DEMO-0101",
          numero_caja: 1,
          tipo_caja: "QB",
          po: "PO-CVF-101",
          contenido_resumido: "MONDIAL 50 cm / 6 ramos / 150 tallos",
          etiqueta_generada: false,
          estado_caja: "OBSERVADA",
          reservation_id: "RSV-DEMO-0101",
          ramos: 6,
          tallos: 150
        },
        {
          box_id: "BOX-DEMO-0102",
          numero_caja: 2,
          tipo_caja: "QB",
          po: "PO-CVF-101",
          contenido_resumido: "QUICKSAND 60 cm / 6 ramos / 150 tallos",
          etiqueta_generada: false,
          estado_caja: "PENDIENTE",
          reservation_id: "",
          ramos: 6,
          tallos: 150
        },
        {
          box_id: "BOX-DEMO-0103",
          numero_caja: 3,
          tipo_caja: "HB",
          po: "PO-CVF-101",
          contenido_resumido: "PLAYA BLANCA 50 cm / 6 ramos / 150 tallos",
          etiqueta_generada: false,
          estado_caja: "PENDIENTE",
          reservation_id: "RSV-DEMO-0102",
          ramos: 6,
          tallos: 150
        }
      ],
      materiales_requeridos: [
        { material_codigo: "CARTON-QB", material_nombre: "Caja QB", requerido: 2, disponible: 2, faltante: 0, estado: "OK" },
        { material_codigo: "CARTON-HB", material_nombre: "Caja HB", requerido: 1, disponible: 0, faltante: 1, estado: "FALTANTE" },
        { material_codigo: "ETQ-CAJA", material_nombre: "Etiqueta de caja", requerido: 3, disponible: 1, faltante: 2, estado: "PARCIAL" }
      ],
      reservas_relacionadas: [
        { reservation_id: "RSV-DEMO-0101", variedad: "MONDIAL", longitud: 50, ramos_reservados: 8, ramos_usados_cajas: 6, diferencia: 2, estado_reserva: "RESERVADO" },
        { reservation_id: "RSV-DEMO-0102", variedad: "PLAYA BLANCA", longitud: 50, ramos_reservados: 6, ramos_usados_cajas: 6, diferencia: 0, estado_reserva: "RESERVADO" }
      ],
      etiquetas_generadas: 0,
      responsable_demo: "Paola T.",
      fecha_hora_despacho: "",
      observacion: "Despacho observado por etiquetas pendientes y materiales faltantes."
    }
  ];

  // Los registros de ejemplo históricos se conservan en el código solo como referencia
  // de compatibilidad, pero nunca se cargan en la bandeja operativa.
  let memoryDispatches = [];
  const normalizedDispatchArrays = new WeakSet();
  const orderListMetricsCache = new WeakMap();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeText(value) {
    return String(value || "").trim().toUpperCase();
  }

  function createId(prefix) {
    if (BlessERP.utils?.uid) return BlessERP.utils.uid(prefix);
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  function todayIso() {
    return new Date().toISOString();
  }

  function todayDate() {
    return todayIso().slice(0, 10);
  }

  function orderListMetrics(order) {
    if (!order || typeof order !== "object") return { totalBoxes: 0, totalFulls: 0 };
    const lines = Array.isArray(order.lines) ? order.lines : [];
    const fingerprint = [
      order.version || 0,
      order.updatedAt || order.updated_at || "",
      order.revisionNumber || 0,
      lines.length,
      lines.map(line => `${line?.boxNumber ?? line?.numero_caja ?? ""}:${line?.boxType ?? line?.tipo_caja ?? ""}`).join("|")
    ].join(";");
    const cached = orderListMetricsCache.get(order);
    if (cached?.fingerprint === fingerprint) return cached.metrics;

    const uniqueBoxes = new Map();
    lines.forEach(line => {
      const boxNumber = toNumber(line?.boxNumber ?? line?.numero_caja, 0);
      if (boxNumber <= 0 || uniqueBoxes.has(boxNumber)) return;
      uniqueBoxes.set(boxNumber, normalizeText(line?.boxType || line?.tipo_caja || ""));
    });
    let totalFulls = 0;
    uniqueBoxes.forEach(boxType => {
      const configured = BlessERP.comercialUtils?.findBoxType?.(boxType)?.fullEquivalent;
      totalFulls += toNumber(configured, BOX_FULL_EQUIVALENCE[boxType] || 0);
    });
    const metrics = { totalBoxes: uniqueBoxes.size, totalFulls };
    orderListMetricsCache.set(order, { fingerprint, metrics });
    return metrics;
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

  function saveState() {
    BlessERP.state?.saveDb?.();
  }

  function getOperationsStore(appState) {
    if (!appState?.db) return null;
    const currentStore = appState.db.operations;
    const store = currentStore && typeof currentStore === "object"
      ? currentStore
      : BlessERP.operacionesState?.getStore
        ? BlessERP.operacionesState.getStore(appState)
        : (appState.db.operations = {});
    const legacyStore = appState.db.operaciones;
    if (
      legacyStore
      && Array.isArray(legacyStore.dispatches)
      && legacyStore.dispatches.length
      && (!Array.isArray(store.dispatches) || !store.dispatches.length)
    ) {
      store.dispatches = legacyStore.dispatches;
    }
    return store;
  }

  function findCustomerName(pedido, appState) {
    if (pedido?.cliente_principal) return pedido.cliente_principal;
    if (pedido?.cliente_principal_nombre) return pedido.cliente_principal_nombre;
    if (pedido?.customerName) return pedido.customerName;
    if (pedido?.customerId) {
      const customer = BlessERP.comercialState?.getCustomerCatalog?.(appState)?.find(item => item.id === pedido.customerId)
        || BlessERP.comercialUtils?.findCustomer?.(pedido.customerId);
      return customer?.legalName || customer?.commercialName || customer?.name || "";
    }
    return "";
  }

  function findBrandName(pedido, appState) {
    if (pedido?.marca_cliente_final) return pedido.marca_cliente_final;
    if (pedido?.marca_nombre) return pedido.marca_nombre;
    if (pedido?.brandName) return pedido.brandName;
    if (pedido?.brandId) {
      const brand = BlessERP.comercialState?.getBrandCatalog?.(appState)?.find(item => item.id === pedido.brandId)
        || BlessERP.comercialUtils?.findBrand?.(pedido.brandId);
      return brand?.finalClientName || brand?.name || "";
    }
    return "";
  }

  function findAgencyName(pedido) {
    if (pedido?.agencia_carga) return pedido.agencia_carga;
    if (pedido?.agencyName) return pedido.agencyName;
    if (pedido?.agencyId && BlessERP.comercialUtils?.findAgency) {
      return BlessERP.comercialUtils.findAgency(pedido.agencyId)?.name || "";
    }
    return "";
  }

  function findCarrierName(pedido) {
    if (pedido?.carrier) return pedido.carrier;
    if (pedido?.linea_aerea) return pedido.linea_aerea;
    if (pedido?.airlineName) return pedido.airlineName;
    if (pedido?.airlineId && BlessERP.comercialUtils?.findAirline) {
      return BlessERP.comercialUtils.findAirline(pedido.airlineId)?.name || "";
    }
    return "";
  }

  function normalizeBoxState(value) {
    const state = normalizeText(value);
    if (state === "LISTA" || state === "DESPACHADA DEMO" || state === "DESPACHADA_DEMO") return "LISTA";
    if (state === "OBSERVADA" || state === "OBSERVADO") return "OBSERVADA";
    return "PENDIENTE";
  }

  function buildLineSummary(line) {
    const variety = line.variedad || line.variety || "VARIEDAD";
    const length = toNumber(line.longitud ?? line.length, 0);
    const bunches = toNumber(line.ramos ?? line.bunches, 0);
    const stemsPerBunch = toNumber(line.tallos_por_ramo ?? line.stemsPerBunch, 0);
    const totalStems = toNumber(line.total_tallos ?? line.totalStems, bunches * stemsPerBunch);
    return `${variety} ${length} cm / ${bunches} ramos / ${totalStems} tallos`;
  }

  function normalizeBox(box, index = 0) {
    return {
      box_id: box.box_id || box.id || `BOX-${index + 1}`,
      numero_caja: toNumber(box.numero_caja ?? box.boxNumber, index + 1),
      tipo_caja: normalizeText(box.tipo_caja || box.boxType || "HB") || "HB",
      po: String(box.po || "").trim(),
      contenido_resumido: String(box.contenido_resumido || box.summary || buildLineSummary(box)).trim(),
      etiqueta_generada: Boolean(box.etiqueta_generada ?? box.labelGenerated),
        estado_caja: normalizeBoxState(box.estado_caja || box.state),
        reservation_id: String(box.reservation_id || box.reservationId || "").trim(),
        ramos: toNumber(box.ramos ?? box.bunches, 0),
        tallos: toNumber(box.tallos ?? box.total_tallos ?? box.totalStems, 0),
        ramos_escaneados: toNumber(box.ramos_escaneados ?? box.scannedBunches, 0),
        ramos_pendientes: toNumber(box.ramos_pendientes ?? box.pendingBunches, 0)
    };
  }

  function normalizeMaterial(material) {
    const required = toNumber(material.requerido ?? material.required, 0);
    const available = toNumber(material.disponible ?? material.available ?? material.disponible_demo, 0);
    const missing = toNumber(material.faltante ?? material.missing, Math.max(required - available, 0));
    let state = normalizeText(material.estado || material.state);

    if (!state) {
      if (missing > 0 && available <= 0) state = "FALTANTE";
      else if (missing > 0) state = "PARCIAL";
      else state = "OK";
    }

    return {
      material_codigo: String(material.material_codigo || material.code || "").trim(),
      material_nombre: String(material.material_nombre || material.name || "Material demo").trim(),
      requerido: required,
      disponible: available,
      faltante: missing,
      estado: state
    };
  }

  function normalizeReservation(reservation) {
    const reserved = toNumber(reservation.ramos_reservados ?? reservation.bunches_reserved ?? reservation.bunchesReserved, 0);
    const used = toNumber(reservation.ramos_usados_cajas ?? reservation.bunches_used ?? reservation.bunchesUsed, 0);
    return {
      reservation_id: String(reservation.reservation_id || reservation.id || "").trim(),
      variedad: String(reservation.variedad || reservation.variety || "").trim(),
      longitud: toNumber(reservation.longitud ?? reservation.length, 0),
      ramos_reservados: reserved,
      ramos_usados_cajas: used,
      diferencia: toNumber(reservation.diferencia, Math.max(reserved - used, 0)),
      estado_reserva: String(reservation.estado_reserva || reservation.estado || reservation.status || "RESERVADO").trim()
    };
  }

  function generateMaterialsFromBoxes(boxes) {
    const counts = boxes.reduce((summary, box) => {
      summary.totalBoxes += 1;
      summary.totalBunches += toNumber(box.ramos, 0);
      const type = normalizeText(box.tipo_caja || "HB") || "HB";
      summary.byType[type] = (summary.byType[type] || 0) + 1;
      return summary;
    }, { totalBoxes: 0, totalBunches: 0, byType: {} });

    const materials = [];
    Object.entries(counts.byType).forEach(([type, qty]) => {
      materials.push(normalizeMaterial({
        material_codigo: `CARTON-${type}`,
        material_nombre: `Caja ${type}`,
        requerido: qty,
        disponible: qty,
        faltante: 0,
        estado: "OK"
      }));
    });

    if (counts.totalBoxes > 0) {
      materials.push(normalizeMaterial({
        material_codigo: "ETQ-CAJA",
        material_nombre: "Etiqueta de caja",
        requerido: counts.totalBoxes,
        disponible: counts.totalBoxes,
        faltante: 0,
        estado: "OK"
      }));
    }

    if (counts.totalBunches > 0) {
      materials.push(normalizeMaterial({
        material_codigo: "LIGA-001",
        material_nombre: "Liga para bonche",
        requerido: counts.totalBunches,
        disponible: counts.totalBunches,
        faltante: 0,
        estado: "OK"
      }));
    }

    return materials;
  }

  function buildBoxesFromPedido(pedido) {
    if (Array.isArray(pedido?.cajas) && pedido.cajas.length) {
      return pedido.cajas.map((box, index) => normalizeBox(box, index));
    }

    const lines = Array.isArray(pedido?.lines) ? pedido.lines : [];
    if (!lines.length) return [];

    const grouped = new Map();
    lines.forEach((line, index) => {
      const boxNumber = toNumber(line.boxNumber ?? line.numero_caja, index + 1);
      const key = String(boxNumber);
      if (!grouped.has(key)) {
        grouped.set(key, {
          box_id: line.id || `BOX-${key}`,
          numero_caja: boxNumber,
          tipo_caja: normalizeText(line.boxType || line.tipo_caja || "HB") || "HB",
          po: String(line.po || "").trim(),
          contenido_resumido: [],
          etiqueta_generada: Boolean(line.etiqueta_generada || line.labelGenerated || line.labelId),
            estado_caja: normalizeBoxState(line.state || line.estado),
            reservation_id: String(line.reservationId || line.reservation_id || "").trim(),
            ramos: 0,
            tallos: 0,
            ramos_escaneados: 0,
            ramos_pendientes: 0
        });
      }

      const box = grouped.get(key);
      box.contenido_resumido.push(buildLineSummary(line));
      box.etiqueta_generada = box.etiqueta_generada || Boolean(line.etiqueta_generada || line.labelGenerated || line.labelId);
        box.reservation_id = box.reservation_id || String(line.reservationId || line.reservation_id || "").trim();
        box.ramos += toNumber(line.bunches ?? line.ramos, 0);
        box.tallos += toNumber(line.totalStems ?? line.total_tallos, toNumber(line.bunches ?? line.ramos, 0) * toNumber(line.stemsPerBunch ?? line.tallos_por_ramo, 0));
        box.ramos_escaneados += Array.isArray(line.scannedBunches) ? line.scannedBunches.length : 0;
      });

      return Array.from(grouped.values()).map(item => ({
        ...item,
        contenido_resumido: item.contenido_resumido.join(" | "),
        ramos_pendientes: Math.max(item.ramos - item.ramos_escaneados, 0),
        estado_caja: item.ramos > 0 && item.ramos_escaneados >= item.ramos ? "LISTA" : "PENDIENTE"
    }));
  }

  function buildReservationsFromPedido(pedido, boxes) {
    if (Array.isArray(pedido?.reservas_relacionadas) && pedido.reservas_relacionadas.length) {
      return pedido.reservas_relacionadas.map(normalizeReservation);
    }

    const lines = Array.isArray(pedido?.lines) ? pedido.lines : [];
    const grouped = new Map();

    lines.forEach(line => {
      const reservationId = String(line.reservationId || line.reservation_id || "").trim();
      if (!reservationId) return;

      if (!grouped.has(reservationId)) {
        grouped.set(reservationId, {
          reservation_id: reservationId,
          variedad: String(line.variety || line.variedad || "").trim(),
          longitud: toNumber(line.length ?? line.longitud, 0),
          ramos_reservados: toNumber(line.reservationBunchesUsed ?? line.bunches ?? line.ramos, 0),
          ramos_usados_cajas: 0,
          diferencia: 0,
          estado_reserva: "RESERVADO"
        });
      }

      const reservation = grouped.get(reservationId);
      reservation.ramos_usados_cajas += toNumber(line.reservationBunchesUsed ?? line.bunches ?? line.ramos, 0);
      reservation.diferencia = Math.max(reservation.ramos_reservados - reservation.ramos_usados_cajas, 0);
    });

    if (grouped.size) {
      return Array.from(grouped.values()).map(normalizeReservation);
    }

    return boxes
      .filter(box => box.reservation_id)
      .map(box => normalizeReservation({
        reservation_id: box.reservation_id,
        variedad: box.contenido_resumido,
        longitud: 0,
        ramos_reservados: box.ramos,
        ramos_usados_cajas: box.ramos,
        diferencia: 0,
        estado_reserva: "RESERVADO"
      }));
  }

  function inferTotalsFromBoxes(boxes) {
    return boxes.reduce((summary, box) => {
      summary.total_cajas += 1;
      summary.total_ramos += toNumber(box.ramos, 0);
      summary.total_tallos += toNumber(box.tallos, 0);
      summary.total_fulls += BOX_FULL_EQUIVALENCE[normalizeText(box.tipo_caja)] || 0;
      return summary;
    }, { total_cajas: 0, total_ramos: 0, total_tallos: 0, total_fulls: 0 });
  }

  function normalizeDispatchState(value) {
    const state = normalizeText(value);
    const legacy = {
      EN_PREPARACION: "PEDIDO_INCOMPLETO",
      LISTO_DESPACHO: "PEDIDO_COMPLETADO",
      DESPACHADO_DEMO: "CARGADO_CAMION",
      ANULADO_DEMO: "ANULADO"
    };
    if (legacy[state]) return legacy[state];
    return DISPATCH_STATES.includes(state) ? state : "PENDIENTE";
  }

  function normalizeDispatch(record, seed = {}) {
    const draft = { ...seed, ...clone(record || {}) };
    const boxes = (draft.cajas || draft.boxes || []).map((box, index) => normalizeBox(box, index));
    const totals = inferTotalsFromBoxes(boxes);
    const reservations = (draft.reservas_relacionadas || []).map(normalizeReservation);
    const materials = (draft.materiales_requeridos || []).map(normalizeMaterial);
    const labelsGenerated = toNumber(
      draft.etiquetas_generadas,
      boxes.filter(box => box.etiqueta_generada).length
    );
    const saleType = String(draft.tipo_venta || draft.saleType || draft.sale_type || "").trim();
    const transportType = String(draft.tipo_transporte || draft.transportType || draft.transport_type || "").trim();
    const localSale = draft.venta_local === true
      || String(draft.venta_local || "").toLowerCase() === "true"
      || ["LOCAL", "VENTA LOCAL", "VENTA_LOCAL"].includes(normalizeText(saleType))
      || normalizeText(transportType) === "TERRESTRE";

    return {
      dispatch_id: String(draft.dispatch_id || draft.id || createId("CF")).trim(),
      pedido_id: String(draft.pedido_id || draft.orderId || "").trim(),
      numero_pedido: String(draft.numero_pedido || draft.relatedOrder || "").trim(),
      cliente_principal: String(draft.cliente_principal || "").trim(),
      marca_cliente_final: String(draft.marca_cliente_final || "").trim(),
      destino: String(draft.destino || "").trim(),
      fecha_pedido: String(draft.fecha_pedido || draft.orderDate || "").trim(),
      fecha_vuelo: String(draft.fecha_vuelo || "").trim(),
      tipo_venta: saleType,
      tipo_transporte: transportType,
      venta_local: localSale,
      dae: String(draft.dae || "").trim(),
      dae_fecha_caducidad: String(draft.dae_fecha_caducidad || draft.daeExpirationDate || "").trim(),
      awb: String(draft.awb || "").trim(),
      hawb: String(draft.hawb || "").trim(),
      agencia_carga: String(draft.agencia_carga || "").trim(),
      carrier: String(draft.carrier || "").trim(),
      vuelo: String(draft.vuelo || "").trim(),
      total_cajas: toNumber(draft.total_cajas, totals.total_cajas),
      total_fulls: toNumber(draft.total_fulls, totals.total_fulls),
      total_ramos: toNumber(draft.total_ramos, totals.total_ramos),
      total_tallos: toNumber(draft.total_tallos, totals.total_tallos),
      estado_pedido: String(draft.estado_pedido || "BORRADOR").trim(),
      estado_bodega: String(draft.estado_bodega || "PENDIENTE").trim(),
      estado_etiquetas: String(draft.estado_etiquetas || (labelsGenerated > 0 ? "PARCIALES" : "PENDIENTES")).trim(),
      estado_reservas: String(draft.estado_reservas || (reservations.length ? "REVISADAS" : "SIN_RESERVAS")).trim(),
      estado_despacho: normalizeDispatchState(draft.estado_despacho || draft.state),
      cajas: boxes,
      materiales_requeridos: materials.length ? materials : generateMaterialsFromBoxes(boxes),
      reservas_relacionadas: reservations,
      etiquetas_generadas: labelsGenerated,
      responsable_demo: String(draft.responsable_demo || draft.responsible || "").trim(),
      fecha_hora_despacho: String(draft.fecha_hora_despacho || draft.dispatchDate || "").trim(),
      observacion: String(draft.observacion || draft.observation || "").trim(),
      document_activity: draft.document_activity || draft.documentActivity || {},
      actualizado_en_demo: String(draft.actualizado_en_demo || draft.updatedAtDemo || "").trim(),
      sincronizacion_pedido: draft.sincronizacion_pedido || null
    };
  }

  function findCommercialOrder(appState, input) {
    if (!appState || !BlessERP.comercialState) return null;

    if (input && typeof input === "object" && !input.dispatch_id && !input.estado_despacho && !input.cajas && (input.id || input.number || input.numero_pedido)) {
      return input;
    }

    const orders = BlessERP.comercialState.getOrders ? BlessERP.comercialState.getOrders(appState) : [];
    const orderId = typeof input === "string"
      ? input
      : input?.pedido_id || input?.id || "";
    const orderNumber = typeof input === "string"
      ? ""
      : input?.numero_pedido || input?.number || "";

    return orders.find(order => (
      String(order.id || "") === String(orderId) ||
      String(order.number || "") === String(orderNumber)
    )) || null;
  }

  function buildDispatchFromPedido(pedido, existing = {}, appState = null) {
    const boxes = buildBoxesFromPedido(pedido);
    const totals = inferTotalsFromBoxes(boxes);
    const reservations = buildReservationsFromPedido(pedido, boxes);
    const materials = Array.isArray(pedido?.materiales_requeridos) && pedido.materiales_requeridos.length
      ? pedido.materiales_requeridos.map(normalizeMaterial)
      : Array.isArray(existing.materiales_requeridos) && existing.materiales_requeridos.length
        ? existing.materiales_requeridos.map(normalizeMaterial)
        : generateMaterialsFromBoxes(boxes);
    const labelsGenerated = toNumber(existing.etiquetas_generadas, boxes.filter(box => box.etiqueta_generada).length);

    return normalizeDispatch({
      ...existing,
      pedido_id: pedido?.id || existing.pedido_id || "",
      numero_pedido: pedido?.number || pedido?.numero_pedido || existing.numero_pedido || "",
      cliente_principal: findCustomerName(pedido, appState) || existing.cliente_principal || "",
      marca_cliente_final: findBrandName(pedido, appState) || existing.marca_cliente_final || "",
      destino: pedido?.destination || pedido?.destino || existing.destino || "",
      fecha_pedido: pedido?.issuedAt || pedido?.date || pedido?.createdAt || pedido?.fecha_pedido || existing.fecha_pedido || "",
      fecha_vuelo: pedido?.flightDate || pedido?.fecha_vuelo || existing.fecha_vuelo || "",
      tipo_venta: pedido?.saleType || pedido?.sale_type || existing.tipo_venta || "",
      tipo_transporte: pedido?.transportType || pedido?.transport_type || existing.tipo_transporte || "",
      venta_local: BlessERP.comercialUtils?.isLocalOrder?.(pedido) || false,
      dae: pedido?.daeNumber || pedido?.dae || existing.dae || "",
      dae_fecha_caducidad: pedido?.daeExpirationDate || pedido?.dae_fecha_caducidad || existing.dae_fecha_caducidad || "",
      awb: pedido?.awb || existing.awb || "",
      hawb: pedido?.hawb || existing.hawb || "",
      agencia_carga: findAgencyName(pedido) || existing.agencia_carga || "",
      carrier: findCarrierName(pedido) || existing.carrier || "",
      vuelo: pedido?.flightNumber || pedido?.vuelo || existing.vuelo || "",
      total_cajas: pedido?.total_cajas ?? totals.total_cajas,
      total_fulls: pedido?.total_fulls ?? totals.total_fulls,
      total_ramos: pedido?.total_ramos ?? totals.total_ramos,
      total_tallos: pedido?.total_tallos ?? totals.total_tallos,
      estado_pedido: pedido?.status || pedido?.estado_pedido || existing.estado_pedido || "BORRADOR",
        estado_bodega: pedido?.warehouseStatus || pedido?.estado_bodega || pedido?.packagingDemoStatus || existing.estado_bodega || "PENDIENTE",
      estado_etiquetas: pedido?.estado_etiquetas || existing.estado_etiquetas || (labelsGenerated > 0 ? "PARCIALES" : "PENDIENTES"),
      estado_reservas: pedido?.estado_reservas || existing.estado_reservas || (reservations.length ? "REVISADAS" : "SIN_RESERVAS"),
      estado_despacho: existing.estado_despacho || "PENDIENTE",
      cajas: boxes,
      materiales_requeridos: materials,
      reservas_relacionadas: reservations,
      etiquetas_generadas: labelsGenerated,
      responsable_demo: existing.responsable_demo || "",
      fecha_hora_despacho: existing.fecha_hora_despacho || "",
      observacion: existing.observacion || "",
      document_activity: pedido?.documentActivity || existing.document_activity || {},
      actualizado_en_demo: existing.actualizado_en_demo || "",
      sincronizacion_pedido: existing.sincronizacion_pedido || null
    });
  }

  function ensureDispatchArray(appState) {
    const operationsStore = getOperationsStore(appState);
    const current = operationsStore ? operationsStore.dispatches : memoryDispatches;
    if (Array.isArray(current) && normalizedDispatchArrays.has(current)) return current;
    const source = Array.isArray(current) ? current : [];
    const normalized = source
      .filter(record => !String(record?.dispatch_id || "").toUpperCase().includes("DEMO"))
      .filter(record => !String(record?.pedido_id || "").toLowerCase().startsWith("order-demo-"))
      .map(record => normalizeDispatch(record));

    if (operationsStore) {
      operationsStore.dispatches = normalized;
      normalizedDispatchArrays.add(operationsStore.dispatches);
      return operationsStore.dispatches;
    }

    memoryDispatches = normalized;
    normalizedDispatchArrays.add(memoryDispatches);
    return memoryDispatches;
  }

  function findDispatchIndex(dispatches, input) {
    const pedidoId = typeof input === "string"
      ? input
      : input?.pedido_id || input?.id || "";
    const numeroPedido = typeof input === "string"
      ? input
      : input?.numero_pedido || input?.number || "";
    const dispatchId = typeof input === "string"
      ? input
      : input?.dispatch_id || "";

    return dispatches.findIndex(dispatch => (
      String(dispatch.dispatch_id || "") === String(dispatchId) ||
      String(dispatch.pedido_id || "") === String(pedidoId) ||
      String(dispatch.numero_pedido || "") === String(numeroPedido)
    ));
  }

  function getMutableDispatch(appState, input) {
    const dispatches = ensureDispatchArray(appState);
    const commercialOrder = findCommercialOrder(appState, input);
    let index = findDispatchIndex(dispatches, input);

    if (commercialOrder && index > -1) {
      Object.assign(dispatches[index], buildDispatchFromPedido(commercialOrder, dispatches[index], appState));
      return dispatches[index];
    }

    if (commercialOrder && index === -1) {
      const built = buildDispatchFromPedido(commercialOrder, {
        dispatch_id: createId("CF"),
        estado_despacho: "PENDIENTE"
      }, appState);
      dispatches.push(built);
      saveState();
      return built;
    }

    if (index > -1) {
      Object.assign(dispatches[index], normalizeDispatch(dispatches[index]));
      return dispatches[index];
    }

    if (input && typeof input === "object") {
      const built = input.dispatch_id || input.estado_despacho || input.cajas
        ? normalizeDispatch(input)
        : buildDispatchFromPedido(input, {
            dispatch_id: createId("CF"),
            estado_despacho: "PENDIENTE"
          }, appState);
      dispatches.push(built);
      saveState();
      return built;
    }

    return null;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function isExpired(dateValue) {
    if (!String(dateValue || "").trim()) return false;
    return String(dateValue).slice(0, 10) < todayDate();
  }

  function suggestedOrderStatusForDispatch(status, currentOrderStatus = "") {
    const dispatchStatus = normalizeText(status);
    const orderStatus = normalizeText(currentOrderStatus);
    if (dispatchStatus === "PEDIDO_COMPLETADO") return "LISTO_DESPACHO";
    if (dispatchStatus === "CARGADO_CAMION") return "DESPACHADO_DEMO";
    if (dispatchStatus === "PEDIDO_INCOMPLETO") return orderStatus || "VALIDADO_COMERCIAL";
    if (dispatchStatus === "PEDIDO_ACTUALIZADO") return orderStatus || "VALIDADO_COMERCIAL";
    if (dispatchStatus === "PENDIENTE") return ["VALIDADO_COMERCIAL", "LISTO_BODEGA", "LISTO_DESPACHO"].includes(orderStatus) ? orderStatus : "VALIDADO_COMERCIAL";
    if (dispatchStatus === "OBSERVADO") return orderStatus || "LISTO_BODEGA";
    if (dispatchStatus === "ANULADO") return orderStatus || "ANULADO";
    return orderStatus || "";
  }

  function recordDispatchEvent(appState, dispatch, action, previousState, nextState, result = "exitoso", motivo = "") {
    const order = findCommercialOrder(appState, dispatch?.pedido_id || dispatch?.numero_pedido);
    if (!order || !BlessERP.comercialWorkflow?.recordEvent) return false;
    BlessERP.comercialWorkflow.recordEvent(order, appState, {
      action,
      actionLabel: action.replaceAll("_", " "),
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Despacho operativo ${previousState || "-"} -> ${nextState || "-"} para ${dispatch.numero_pedido || dispatch.pedido_id}.`,
      result,
      reason: motivo || dispatch.observacion || ""
    });
    return true;
  }

  function touchDispatch(dispatch, appState, action, previousState, motivo = "") {
    dispatch.actualizado_en_demo = todayIso();
    const sync = syncDispatchStatusWithOrderDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id, dispatch.estado_despacho);
    dispatch.sincronizacion_pedido = sync;
    recordDispatchEvent(appState, dispatch, action, previousState, dispatch.estado_despacho, sync.sincronizado ? "exitoso" : "pendiente", motivo || sync.observacion);
    return sync;
  }

  function syncDispatchStatusWithOrderDemo(first, second, third) {
    const appState = isAppState(first) ? first : (BlessERP.state?.state || null);
    const pedidoId = isAppState(first) ? second : first;
    const requestedState = isAppState(first) ? third : second;
    const dispatch = getMutableDispatch(appState, pedidoId);
    const estadoDespacho = requestedState ? normalizeDispatchState(requestedState) : normalizeDispatchState(dispatch?.estado_despacho || "");
    const order = findCommercialOrder(appState, pedidoId);
    const currentOrderStatus = order?.status || dispatch?.estado_pedido || "";
    const suggested = suggestedOrderStatusForDispatch(estadoDespacho || dispatch?.estado_despacho, currentOrderStatus);
    const result = {
      pedido_id: dispatch?.pedido_id || (typeof pedidoId === "string" ? pedidoId : pedidoId?.id || ""),
      estado_despacho: estadoDespacho || dispatch?.estado_despacho || "PENDIENTE",
      estado_pedido_sugerido: suggested,
      sincronizado: false,
      observacion: "Estado comercial pendiente de sincronizacion real."
    };

    if (!dispatch) return result;

    if (!order || !BlessERP.comercialState?.changeOrderStatusById || !suggested) {
      dispatch.sincronizacion_pedido = result;
      return result;
    }

    if (normalizeText(order.status) === normalizeText(suggested)) {
      result.sincronizado = true;
      result.observacion = "Estado comercial ya sincronizado visualmente.";
      dispatch.estado_pedido = order.status;
      dispatch.sincronizacion_pedido = result;
      return result;
    }

    if (!["LISTO_DESPACHO", "DESPACHADO_DEMO"].includes(suggested)) {
      result.observacion = `Estado despacho ${result.estado_despacho}; pedido puede permanecer en ${order.status || "estado actual"}.`;
      dispatch.sincronizacion_pedido = result;
      return result;
    }

    const workflow = BlessERP.comercialWorkflow;
    const transitionAllowed = !workflow?.isTransitionAllowed
      || workflow.isTransitionAllowed(order.status, suggested);
    const transitionReview = transitionAllowed && workflow?.buildTransitionValidation
      ? workflow.buildTransitionValidation(order, suggested, appState)
      : null;
    if (!transitionAllowed || transitionReview?.errors?.length) {
      result.observacion = `Despacho operativo registrado; el pedido comercial permanece en ${order.status || "su estado actual"} hasta completar su propio flujo.`;
      dispatch.estado_pedido = order.status;
      dispatch.sincronizacion_pedido = result;
      return result;
    }

    const transition = BlessERP.comercialState.changeOrderStatusById(appState, order.id, suggested, "Sincronizacion de estado desde despacho operativo.");
    if (transition?.ok) {
      result.sincronizado = true;
      result.observacion = `Pedido sincronizado visualmente a ${suggested}.`;
      dispatch.estado_pedido = suggested;
    } else {
      result.observacion = transition?.message || transition?.error || "Estado comercial pendiente de sincronizacion real.";
    }
    dispatch.sincronizacion_pedido = result;
    return result;
  }

  function buildChecklist(dispatch) {
    const localSale = dispatch.venta_local === true
      || ["LOCAL", "VENTA LOCAL", "VENTA_LOCAL"].includes(normalizeText(dispatch.tipo_venta))
      || normalizeText(dispatch.tipo_transporte) === "TERRESTRE";
    const missingMaterials = dispatch.materiales_requeridos.filter(item => toNumber(item.faltante, 0) > 0 || normalizeText(item.estado) === "FALTANTE");
    const partialMaterials = dispatch.materiales_requeridos.filter(item => normalizeText(item.estado) === "PARCIAL");
    const unusedReservations = dispatch.reservas_relacionadas.filter(item => toNumber(item.diferencia, 0) > 0);
    const boxesWithoutReservation = dispatch.cajas.filter(item => !String(item.reservation_id || "").trim());
    const labelsGenerated = toNumber(dispatch.etiquetas_generadas, 0) > 0;
    const documentActivity = dispatch.document_activity || {};
    const documentStatus = docCode => String(documentActivity?.[docCode]?.printedAt || documentActivity?.[docCode]?.previewedAt || "").trim();
    const scannerStatus = BlessERP.operacionesScannerDemo?.getBoxScanStatusDemo
      ? BlessERP.operacionesScannerDemo.getBoxScanStatusDemo(BlessERP.state?.state || null, dispatch.pedido_id || dispatch.numero_pedido)
      : { summary: { total: dispatch.cajas.length, scanned: 0, pending: dispatch.cajas.length, duplicated: 0 }, boxes: [] };
    const scannerChecklistStatus = !scannerStatus.summary.total
      ? "PENDIENTE"
      : scannerStatus.summary.pending === 0
        ? (scannerStatus.summary.duplicated ? "ADVERTENCIA" : "OK")
        : scannerStatus.summary.scanned > 0
          ? "ADVERTENCIA"
          : "PENDIENTE";
    const consumptionRows = BlessERP.operacionesConsumptionDemo?.getConsumptionsByOrderDemo
      ? BlessERP.operacionesConsumptionDemo.getConsumptionsByOrderDemo(BlessERP.state?.state || null, dispatch.pedido_id || dispatch.numero_pedido)
      : [];
    const activeConsumption = consumptionRows.filter(item => normalizeText(item.estado_consumo) === "SIMULADO");
    const revertedConsumption = consumptionRows.filter(item => normalizeText(item.estado_consumo) === "REVERTIDO_DEMO");
    const consumptionChecklistStatus = normalizeText(dispatch.estado_despacho) !== "CARGADO_CAMION"
      ? "PENDIENTE"
      : activeConsumption.length
        ? "OK"
        : revertedConsumption.length
          ? "ADVERTENCIA"
          : "ADVERTENCIA";

    return [
      {
        id: "cliente_principal",
        label: "Cliente principal definido",
        status: dispatch.cliente_principal ? "OK" : "PENDIENTE",
        detail: dispatch.cliente_principal ? "Cliente principal registrado." : "Cliente principal pendiente."
      },
      {
        id: "marca",
        label: "Marca / cliente final definida",
        status: localSale || dispatch.marca_cliente_final ? "OK" : "ERROR",
        detail: localSale ? "No aplica en venta local." : dispatch.marca_cliente_final ? "Marca registrada." : "Falta marca."
      },
      {
        id: "destino",
        label: "Destino definido",
        status: dispatch.destino ? "OK" : "ERROR",
        detail: dispatch.destino ? "Destino registrado." : "Falta destino."
      },
      {
        id: "dae",
        label: "DAE registrada",
        status: localSale || dispatch.dae ? "OK" : "ERROR",
        detail: localSale ? "No aplica en venta local." : dispatch.dae ? "DAE registrada." : "Falta DAE."
      },
      {
        id: "dae_vigente",
        label: "DAE vigente",
        status: localSale ? "OK" : !dispatch.dae ? "PENDIENTE" : isExpired(dispatch.dae_fecha_caducidad) ? "ERROR" : "OK",
        detail: localSale
          ? "No aplica en venta local."
          : !dispatch.dae
          ? "No se puede validar vigencia sin DAE."
          : isExpired(dispatch.dae_fecha_caducidad)
            ? "DAE caducada."
            : "DAE vigente o sin caducidad demo vencida."
      },
      {
        id: "fecha_vuelo",
        label: "Fecha vuelo valida",
        status: dispatch.fecha_vuelo ? "OK" : "PENDIENTE",
        detail: dispatch.fecha_vuelo ? "Fecha de vuelo registrada." : "Fecha de vuelo pendiente."
      },
      {
        id: "awb",
        label: "AWB registrado",
        status: dispatch.awb ? "OK" : "ADVERTENCIA",
        detail: dispatch.awb ? "AWB registrado." : "Falta AWB."
      },
      {
        id: "hawb",
        label: "HAWB registrado",
        status: dispatch.hawb ? "OK" : "ADVERTENCIA",
        detail: dispatch.hawb ? "HAWB registrado." : "Falta HAWB."
      },
      {
        id: "agencia_carga",
        label: "Agencia de carga seleccionada",
        status: dispatch.agencia_carga ? "OK" : "PENDIENTE",
        detail: dispatch.agencia_carga ? "Agencia de carga registrada." : "Agencia de carga pendiente."
      },
      {
        id: "carrier_vuelo",
        label: "Carrier / vuelo definido",
        status: dispatch.carrier && dispatch.vuelo ? "OK" : "ADVERTENCIA",
        detail: dispatch.carrier && dispatch.vuelo ? "Carrier y vuelo registrados." : "Falta carrier/vuelo."
      },
      {
        id: "cajas",
        label: "Cajas creadas",
        status: toNumber(dispatch.total_cajas, 0) > 0 ? "OK" : "ERROR",
        detail: toNumber(dispatch.total_cajas, 0) > 0 ? `${dispatch.total_cajas} caja(s) registradas.` : "Pedido sin cajas."
      },
      {
        id: "tallos",
        label: "Total tallos mayor a cero",
        status: toNumber(dispatch.total_tallos, 0) > 0 ? "OK" : "PENDIENTE",
        detail: toNumber(dispatch.total_tallos, 0) > 0 ? `${dispatch.total_tallos} tallo(s) registrados.` : "Total de tallos pendiente."
      },
      {
        id: "reservas_revisadas",
        label: "Reservas revisadas",
        status: dispatch.reservas_relacionadas.length ? "OK" : "ADVERTENCIA",
        detail: dispatch.reservas_relacionadas.length ? "Reservas demo relacionadas." : "Pedido sin reservas conectadas."
      },
      {
        id: "cajas_reservas",
        label: "Cajas conectadas a reservas o advertencia",
        status: boxesWithoutReservation.length ? "ADVERTENCIA" : "OK",
        detail: boxesWithoutReservation.length ? "Hay cajas sin reserva." : "Cajas alineadas con reservas."
      },
      {
        id: "etiquetas",
        label: "Etiquetas generadas",
        status: labelsGenerated ? "OK" : "ADVERTENCIA",
        detail: labelsGenerated ? `${dispatch.etiquetas_generadas} etiqueta(s) generadas.` : "Etiquetas no generadas."
      },
      {
        id: "cajas_escaneadas_demo",
        label: "Cajas escaneadas demo",
        status: scannerChecklistStatus,
        detail: scannerStatus.summary.pending === 0 && scannerStatus.summary.total
          ? "Todas las cajas fueron escaneadas en demo. Escaneo demo. No equivale a confirmacion real con lector Zebra."
          : `${scannerStatus.summary.scanned || 0}/${scannerStatus.summary.total || 0} caja(s) escaneadas. Escaneo demo. No equivale a confirmacion real con lector Zebra.`
      },
      {
        id: "materiales_calculados",
        label: "Materiales calculados",
        status: dispatch.materiales_requeridos.length ? "OK" : "PENDIENTE",
        detail: dispatch.materiales_requeridos.length ? "Materiales demo calculados." : "Materiales pendientes."
      },
      {
        id: "materiales",
        label: "Materiales sin faltantes criticos o advertencia",
        status: missingMaterials.length ? "ADVERTENCIA" : partialMaterials.length ? "ADVERTENCIA" : "OK",
        detail: missingMaterials.length
          ? "Hay materiales faltantes."
          : partialMaterials.length
            ? "Hay materiales parciales."
            : "Materiales completos."
      },
      {
        id: "reservas",
        label: "Reservas sin usar",
        status: unusedReservations.length || boxesWithoutReservation.length ? "ADVERTENCIA" : "OK",
        detail: unusedReservations.length
          ? "Hay reservas sin usar."
          : boxesWithoutReservation.length
            ? "Hay cajas sin reserva."
            : "Reservas alineadas con cajas."
      },
      {
        id: "INVOICE_PACKING_REAL",
        label: "Invoice carguera listo",
        status: documentStatus("INVOICE_PACKING_REAL") ? "OK" : "PENDIENTE",
        detail: documentStatus("INVOICE_PACKING_REAL") ? "Invoice carguera con preview o impresion demo." : "Invoice carguera pendiente."
      },
      {
        id: "PACKING_LIST",
        label: "Packing List listo",
        status: documentStatus("PACKING_LIST") ? "OK" : "PENDIENTE",
        detail: documentStatus("PACKING_LIST") ? "Packing List con preview o impresion demo." : "Packing List pendiente."
      },
      {
        id: "HR",
        label: "HR listo",
        status: documentStatus("HR") ? "OK" : "PENDIENTE",
        detail: documentStatus("HR") ? "HR con preview o impresion demo." : "HR pendiente."
      },
      {
        id: "MP",
        label: "MP listo",
        status: documentStatus("MP") ? "OK" : "PENDIENTE",
        detail: documentStatus("MP") ? "MP con preview o impresion demo." : "MP pendiente."
      },
      {
        id: "scanner",
        label: "Scanner Zebra HID",
        status: "OK",
        detail: "Lectura automatica activa para ramos en la caja seleccionada."
      },
      {
        id: "inventario",
        label: "Inventario real no descontado",
        status: "ADVERTENCIA",
        detail: "Despacho demo no descuenta inventario real."
      },
      {
        id: "consumo_demo_simulado",
        label: "Consumo demo simulado",
        status: consumptionChecklistStatus,
          detail: normalizeText(dispatch.estado_despacho) !== "CARGADO_CAMION"
          ? "Se habilita cuando el pedido este despachado demo."
          : activeConsumption.length
            ? `Consumo demo simulado con ${activeConsumption.length} movimiento(s).`
            : revertedConsumption.length
              ? "El consumo demo fue revertido y requiere nueva simulacion si corresponde."
              : "Despacho demo sin consumo simulado todavia."
      }
    ];
  }

  function validateDispatchReadinessDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    let dispatch = getMutableDispatch(appState, input);

    if (!dispatch) {
      return {
        ok: false,
        errors: ["Despacho demo no encontrado."],
        warnings: [],
        checklist: []
      };
    }

    const errors = [];
    const warnings = [];
    const checklist = buildChecklist(dispatch);
    const localSale = dispatch.venta_local === true
      || ["LOCAL", "VENTA LOCAL", "VENTA_LOCAL"].includes(normalizeText(dispatch.tipo_venta))
      || normalizeText(dispatch.tipo_transporte) === "TERRESTRE";

    if (!localSale && !dispatch.marca_cliente_final) errors.push("Falta marca.");
    if (!dispatch.destino) errors.push("Falta destino.");
    if (!localSale && !dispatch.dae) errors.push("Falta DAE.");
    if (toNumber(dispatch.total_cajas, 0) <= 0 || !dispatch.cajas.length) errors.push("Pedido sin cajas.");
    if (!localSale && isExpired(dispatch.dae_fecha_caducidad)) errors.push("DAE caducada.");
    if (normalizeText(dispatch.estado_pedido) === "ANULADO") errors.push("Pedido anulado.");

    if (!dispatch.awb) warnings.push("Falta AWB.");
    if (!dispatch.hawb) warnings.push("Falta HAWB.");
    if (!dispatch.carrier || !dispatch.vuelo) warnings.push("Falta carrier/vuelo.");
    if (toNumber(dispatch.etiquetas_generadas, 0) <= 0) warnings.push("Etiquetas no generadas.");
    if (!dispatch.materiales_requeridos.length) warnings.push("Materiales calculados pendientes.");
    if (dispatch.materiales_requeridos.some(item => toNumber(item.faltante, 0) > 0 || normalizeText(item.estado) === "FALTANTE")) warnings.push("Materiales faltantes.");
    if (!dispatch.reservas_relacionadas.length) warnings.push("Pedido sin reservas conectadas.");
    if (dispatch.reservas_relacionadas.some(item => toNumber(item.diferencia, 0) > 0)) warnings.push("Reservas sin usar.");
    if (dispatch.cajas.some(item => !String(item.reservation_id || "").trim())) warnings.push("Cajas sin reserva.");
    const scannerStatus = BlessERP.operacionesScannerDemo?.getBoxScanStatusDemo
      ? BlessERP.operacionesScannerDemo.getBoxScanStatusDemo(appState, dispatch.pedido_id || dispatch.numero_pedido)
      : { summary: { total: dispatch.cajas.length, scanned: 0, pending: dispatch.cajas.length, duplicated: 0 } };
    if (!scannerStatus.summary.scanned) warnings.push("Cajas sin escaneo demo.");
    if (scannerStatus.summary.pending > 0) warnings.push("Hay cajas pendientes de escaneo demo.");
    if (scannerStatus.summary.duplicated > 0) warnings.push("Hay cajas duplicadas en escaneo demo.");
    const consumptionRows = BlessERP.operacionesConsumptionDemo?.getConsumptionsByOrderDemo
      ? BlessERP.operacionesConsumptionDemo.getConsumptionsByOrderDemo(appState, dispatch.pedido_id || dispatch.numero_pedido)
      : [];
    if (normalizeText(dispatch.estado_despacho) === "CARGADO_CAMION" && !consumptionRows.some(item => normalizeText(item.estado_consumo) === "SIMULADO")) {
      warnings.push("Despacho demo sin consumo simulado.");
    }
    warnings.push("Scanner real no conectado.");
    warnings.push("Despacho demo no descuenta inventario real.");

    return {
      ok: !errors.length,
      errors: unique(errors),
      warnings: unique(warnings),
      checklist
    };
  }

  function getDispatchResponsiblesDemo(first) {
    return ["DESPACHO GENERAL"];
  }

  function getDefaultDispatchResponsibleDemo(first) {
    return "DESPACHO GENERAL";
  }

  function getDispatchProgressDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const dispatch = getMutableDispatch(appState, input);
    if (!dispatch) {
      return {
        ok: false,
        status: "PENDIENTE",
        allBoxesComplete: false,
        totalBoxes: 0,
        completeBoxes: 0,
        pendingBunches: 0,
        pendingChanges: 0
      };
    }
    const orderId = dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id;
    const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, orderId) || null;
    const pendingChanges = BlessERP.comercialOrderFulfillment?.getPendingOrderChanges?.(appState, orderId) || [];
    const current = normalizeDispatchState(dispatch.estado_despacho);
    let status = "PENDIENTE";
    if (pendingChanges.length && ["PEDIDO_COMPLETADO", "PEDIDO_ACTUALIZADO", "CARGADO_CAMION"].includes(current)) {
      status = "PEDIDO_ACTUALIZADO";
    } else if (current === "CARGADO_CAMION") {
      status = "CARGADO_CAMION";
    } else if (fulfillment?.allBoxesComplete) {
      status = "PEDIDO_COMPLETADO";
    } else if (toNumber(fulfillment?.scannedBunches, 0) > 0 || toNumber(fulfillment?.completeBoxes, 0) > 0) {
      status = "PEDIDO_INCOMPLETO";
    }
    return {
      ok: true,
      status,
      allBoxesComplete: Boolean(fulfillment?.allBoxesComplete),
      totalBoxes: toNumber(fulfillment?.totalBoxes, dispatch.total_cajas),
      completeBoxes: toNumber(fulfillment?.completeBoxes, 0),
      pendingBunches: toNumber(fulfillment?.pendingBunches, 0),
      pendingChanges: pendingChanges.length,
      fulfillment
    };
  }

  function refreshDispatchProgressDemo(first, second, third = {}) {
    const { appState, input } = resolveArgs(first, second);
    const options = isAppState(first) ? (third || {}) : {};
    let dispatch = getMutableDispatch(appState, input);
    if (!dispatch) return { ok: false, error: "Despacho no encontrado." };
    const progress = getDispatchProgressDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id);
    dispatch = getMutableDispatch(appState, input);
    if (!progress.ok || progress.status === dispatch.estado_despacho) {
      return { ...progress, dispatch: clone(dispatch) };
    }
    const previousState = dispatch.estado_despacho;
    dispatch.estado_despacho = progress.status;
    dispatch.observacion = progress.status === "PEDIDO_COMPLETADO"
      ? "Todas las cajas quedaron completas mediante escaneo."
      : progress.status === "PEDIDO_ACTUALIZADO"
        ? "El pedido fue actualizado después de completar sus cajas."
        : progress.status === "PEDIDO_INCOMPLETO"
          ? "El pedido conserva cajas o ramos pendientes."
          : "Pedido pendiente de iniciar armado.";
    const sync = touchDispatch(
      dispatch,
      appState,
      options.action || "ACTUALIZAR_AVANCE_CAJAS",
      previousState,
      dispatch.observacion
    );
    saveState();
    return { ...progress, dispatch: clone(dispatch), sync };
  }

  function setDispatchResponsibleDemo(first, second, third) {
    const { appState, input } = resolveArgs(first, second);
    const responsible = String(isAppState(first) ? third : second || "").trim();
    const dispatch = getMutableDispatch(appState, input);
    if (!dispatch) return { ok: false, error: "Despacho no encontrado." };
    const options = getDispatchResponsiblesDemo(appState);
    if (!responsible || !options.includes(responsible)) {
      return { ok: false, error: "Seleccione un responsable activo de Parametros de Poscosecha." };
    }
    const previousResponsible = dispatch.responsable_demo || "";
    dispatch.responsable_demo = responsible;
    dispatch.actualizado_en_demo = todayIso();
    recordDispatchEvent(
      appState,
      dispatch,
      "ASIGNAR_RESPONSABLE_DESPACHO",
      dispatch.estado_despacho,
      dispatch.estado_despacho,
      "exitoso",
      `${previousResponsible || "Sin responsable"} -> ${responsible}`
    );
    saveState();
    return { ok: true, responsible, dispatch: clone(dispatch) };
  }

  function getDispatchListDemo(first) {
    const { appState } = resolveArgs(first);
    const commercialOrders = BlessERP.comercialState?.getOrders ? BlessERP.comercialState.getOrders(appState) : [];
    const dispatches = ensureDispatchArray(appState);
    const dispatchByOrderId = new Map();
    const dispatchByNumber = new Map();
    dispatches.forEach(dispatch => {
      if (dispatch.pedido_id) dispatchByOrderId.set(String(dispatch.pedido_id), dispatch);
      if (dispatch.numero_pedido) dispatchByNumber.set(String(dispatch.numero_pedido), dispatch);
    });
    const customers = BlessERP.comercialState?.getCustomerCatalog?.(appState) || [];
    const brands = BlessERP.comercialState?.getBrandCatalog?.(appState) || [];
    const customerById = new Map(customers.map(item => [String(item.id || ""), item]));
    const brandById = new Map(brands.map(item => [String(item.id || ""), item]));

    return commercialOrders
      .filter(order => normalizeText(order.status) !== "ANULADO")
      .map(order => {
        const metrics = orderListMetrics(order);
        return { order, metrics };
      })
      .filter(({ metrics }) => metrics ? toNumber(metrics.totalBoxes, 0) > 0 : true)
      .map(({ order, metrics }) => {
        const existing = dispatchByOrderId.get(String(order.id || ""))
          || dispatchByNumber.get(String(order.number || order.numero_pedido || ""))
          || {};
        const customer = customerById.get(String(order.customerId || order.customer_id || ""));
        const brand = brandById.get(String(order.brandId || order.brand_id || ""));
        return {
          dispatch_id: existing.dispatch_id || "",
          pedido_id: order.id || existing.pedido_id || "",
          numero_pedido: order.number || order.numero_pedido || existing.numero_pedido || "",
          cliente_principal: order.cliente_principal || order.cliente_principal_nombre || order.customerName
            || customer?.legalName || customer?.commercialName || customer?.name || existing.cliente_principal || "",
          marca_cliente_final: order.marca_cliente_final || order.marca_nombre || order.brandName
            || brand?.finalClientName || brand?.name || existing.marca_cliente_final || "",
          destino: order.destination || order.destino || existing.destino || "",
          fecha_pedido: order.issuedAt || order.date || order.createdAt || order.fecha_pedido || existing.fecha_pedido || "",
          fecha_vuelo: order.flightDate || order.fecha_vuelo || existing.fecha_vuelo || "",
          tipo_venta: order.saleType || order.sale_type || existing.tipo_venta || "",
          tipo_transporte: order.transportType || order.transport_type || existing.tipo_transporte || "",
          venta_local: BlessERP.comercialUtils?.isLocalOrder?.(order) || false,
          dae: order.daeNumber || order.dae || existing.dae || "",
          awb: order.awb || existing.awb || "",
          hawb: order.hawb || existing.hawb || "",
          total_cajas: toNumber(order.total_cajas, toNumber(metrics?.totalBoxes, existing.total_cajas)),
          total_fulls: toNumber(order.total_fulls, toNumber(metrics?.totalFulls, existing.total_fulls)),
          estado_pedido: order.status || order.estado_pedido || existing.estado_pedido || "BORRADOR",
          estado_despacho: normalizeDispatchState(existing.estado_despacho || order.estado_despacho || "PENDIENTE"),
          actualizado_en_demo: existing.actualizado_en_demo || order.updatedAt || order.updated_at || ""
        };
      });
  }

  function getDispatchesDemo(first) {
    const { appState } = resolveArgs(first);
    const commercialOrders = BlessERP.comercialState?.getOrders ? BlessERP.comercialState.getOrders(appState) : [];
    const dispatches = ensureDispatchArray(appState);
    const byOrderId = new Map();
    const byOrderNumber = new Map();
    dispatches.forEach((dispatch, index) => {
      if (dispatch.pedido_id) byOrderId.set(String(dispatch.pedido_id), index);
      if (dispatch.numero_pedido) byOrderNumber.set(String(dispatch.numero_pedido), index);
    });
    let added = false;
    commercialOrders
      .filter(order => normalizeText(order.status) !== "ANULADO")
      .filter(order => {
        const metrics = BlessERP.comercialUtils?.getOrderMetrics?.(order);
        return metrics ? toNumber(metrics.totalBoxes, 0) > 0 : true;
      })
      .forEach(order => {
        const index = byOrderId.get(String(order.id || ""))
          ?? byOrderNumber.get(String(order.number || order.numero_pedido || ""));
        if (Number.isInteger(index)) {
          Object.assign(dispatches[index], buildDispatchFromPedido(order, dispatches[index], appState));
          return;
        }
        const built = buildDispatchFromPedido(order, {
          dispatch_id: createId("CF"),
          estado_despacho: "PENDIENTE"
        }, appState);
        dispatches.push(built);
        const newIndex = dispatches.length - 1;
        if (built.pedido_id) byOrderId.set(String(built.pedido_id), newIndex);
        if (built.numero_pedido) byOrderNumber.set(String(built.numero_pedido), newIndex);
        added = true;
      });
    if (added) saveState();
    return dispatches.map(item => clone(item));
  }

  function getDispatchByOrderDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const dispatch = getMutableDispatch(appState, input);
    return dispatch ? clone(dispatch) : null;
  }

  function prepareDispatchFromOrderDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    const dispatch = getMutableDispatch(appState, input);

    if (!dispatch) {
      return { ok: false, error: "Despacho demo no encontrado." };
    }

    if (normalizeText(dispatch.estado_pedido) === "ANULADO") {
      return { ok: false, error: "Pedido anulado." };
    }

    const previousState = dispatch.estado_despacho;
    dispatch.estado_despacho = "PEDIDO_INCOMPLETO";
    dispatch.responsable_demo = "DESPACHO GENERAL";
    dispatch.observacion = "Pedido en armado; las cajas se completan mediante escaneo.";
    const sync = touchDispatch(dispatch, appState, "DESPACHO_PREPARADO", previousState);
    saveState();

    return { ok: true, dispatch: clone(dispatch), sync };
  }

  function markDispatchReadyDemo(first, second) {
    const { appState, input } = resolveArgs(first, second);
    let dispatch = getMutableDispatch(appState, input);

    if (!dispatch) {
      return { ok: false, error: "Despacho demo no encontrado." };
    }

    const progress = refreshDispatchProgressDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id, {
      action: "VALIDAR_AVANCE_CAJAS"
    });
    if (!progress.allBoxesComplete) {
      return { ok: false, error: "El pedido sigue incompleto; termine de escanear los ramos de todas las cajas.", progress };
    }
    return { ok: true, dispatch: progress.dispatch, progress };
  }

  function confirmDispatchDemo(first, second, third) {
    const context = resolveArgs(first, second);
    const appState = context.appState;
    const input = context.input;
    const payload = isAppState(first) ? (third || {}) : (second && typeof second === "object" && !isAppState(second) ? second : {});
    let dispatch = getMutableDispatch(appState, input);

    if (!dispatch) {
      return { ok: false, error: "Despacho demo no encontrado." };
    }

    const progress = getDispatchProgressDemo(appState, dispatch.pedido_id || dispatch.numero_pedido || dispatch.dispatch_id);
    dispatch = getMutableDispatch(appState, input);
    if (!progress.allBoxesComplete || progress.pendingChanges > 0) {
      return { ok: false, error: progress.pendingChanges > 0
        ? "El pedido fue actualizado; revise nuevamente sus cajas antes de confirmar la carga."
        : "El pedido esta incompleto; termine todas las cajas antes de confirmar la carga." };
    }
    const responsible = String(
      payload.responsable_demo
      || payload.responsable
      || dispatch.responsable_demo
      || getDefaultDispatchResponsibleDemo(appState)
    ).trim();
    const previousState = dispatch.estado_despacho;
    dispatch.estado_despacho = "CARGADO_CAMION";
    dispatch.responsable_demo = responsible || "DESPACHO GENERAL";
    dispatch.fecha_hora_despacho = String(payload.fecha_hora_despacho || todayIso()).trim();
    dispatch.observacion = String(payload.observacion || "Carga confirmada en camion.").trim();
    const sync = touchDispatch(dispatch, appState, "CONFIRMAR_CARGA_CAMION", previousState, dispatch.observacion);
    saveState();

    return { ok: true, dispatch: clone(dispatch), sync };
  }

  function observeDispatchDemo(first, second, third) {
    const context = resolveArgs(first, second);
    const appState = context.appState;
    const input = context.input;
    const motivo = isAppState(first) ? third : second;
    const dispatch = getMutableDispatch(appState, input);

    if (!dispatch) {
      return { ok: false, error: "Despacho demo no encontrado." };
    }

    if (dispatch.estado_despacho === "ANULADO") {
      return { ok: false, error: "No se puede observar un despacho anulado. Reabrir primero." };
    }

    const previousState = dispatch.estado_despacho;
    dispatch.estado_despacho = "OBSERVADO";
    dispatch.observacion = String(motivo || "Despacho demo observado.").trim();
    const sync = touchDispatch(dispatch, appState, "DESPACHO_OBSERVADO", previousState, dispatch.observacion);
    saveState();

    return { ok: true, dispatch: clone(dispatch), sync };
  }

  function cancelDispatchDemo(first, second, third) {
    const context = resolveArgs(first, second);
    const appState = context.appState;
    const input = context.input;
    const motivo = isAppState(first) ? third : second;
    const dispatch = getMutableDispatch(appState, input);

    if (!dispatch) {
      return { ok: false, error: "Despacho demo no encontrado." };
    }

    const previousState = dispatch.estado_despacho;
    dispatch.estado_despacho = "ANULADO";
    dispatch.observacion = String(motivo || "Despacho anulado.").trim();
    if (BlessERP.operacionesConsumptionDemo?.getConsumptionsByOrderDemo?.(appState, dispatch.pedido_id)?.some(item => normalizeText(item.estado_consumo) === "SIMULADO")) {
      BlessERP.operacionesConsumptionDemo.reverseConsumptionDemo(appState, dispatch.pedido_id, `Reverso demo por anulacion de despacho. ${dispatch.observacion}`.trim());
    }
    const sync = touchDispatch(dispatch, appState, "DESPACHO_ANULADO_DEMO", previousState, dispatch.observacion);
    saveState();

    return { ok: true, dispatch: clone(dispatch), sync };
  }

  function reopenDispatchDemo(first, second, third) {
    const context = resolveArgs(first, second);
    const appState = context.appState;
    const input = context.input;
    const motivo = isAppState(first) ? third : second;
    const dispatch = getMutableDispatch(appState, input);

    if (!dispatch) {
      return { ok: false, error: "Despacho demo no encontrado." };
    }

    if (!["OBSERVADO", "ANULADO"].includes(dispatch.estado_despacho)) {
      return { ok: false, error: "Reabrir despacho solo se permite desde OBSERVADO o ANULADO." };
    }

    const previousState = dispatch.estado_despacho;
    dispatch.estado_despacho = "PEDIDO_INCOMPLETO";
    dispatch.observacion = String(motivo || "Pedido reabierto para revision de cajas.").trim();
    if (BlessERP.operacionesConsumptionDemo?.getConsumptionsByOrderDemo?.(appState, dispatch.pedido_id)?.some(item => normalizeText(item.estado_consumo) === "SIMULADO")) {
      BlessERP.operacionesConsumptionDemo.reverseConsumptionDemo(appState, dispatch.pedido_id, `Reverso demo por reapertura de despacho. ${dispatch.observacion}`.trim());
    }
    const sync = touchDispatch(dispatch, appState, "DESPACHO_REABIERTO", previousState, dispatch.observacion);
    saveState();

    return { ok: true, dispatch: clone(dispatch), sync };
  }

  BlessERP.operacionesDispatchDemo = {
    getDispatchListDemo,
    getDispatchesDemo,
    getDispatchByOrderDemo,
    getDispatchProgressDemo,
    refreshDispatchProgressDemo,
    getDispatchResponsiblesDemo,
    getDefaultDispatchResponsibleDemo,
    setDispatchResponsibleDemo,
    prepareDispatchFromOrderDemo,
    validateDispatchReadinessDemo,
    markDispatchReadyDemo,
    confirmDispatchDemo,
    observeDispatchDemo,
    cancelDispatchDemo,
    reopenDispatchDemo,
    syncDispatchStatusWithOrderDemo
  };
})();
