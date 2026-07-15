(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { clone, esc, number, today } = BlessERP.utils;

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function dateLabel(value) {
    if (!value) return "-";
    const raw = String(value).trim();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw.replace(" ", "T");
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function badgeClass(status) {
    const value = String(status || "").toLowerCase();
    if (value.includes("ok") || value.includes("activo") || value.includes("recibido") || value.includes("cerrado") || value.includes("completado") || value.includes("disponible") || value.includes("listo") || value.includes("despachado") || value.includes("simulado") || value.includes("escaneada") || value.includes("ingresado_por_escaneo") || value.includes("inventario_creado")) return "authorized";
    if (value.includes("demo") || value.includes("parcial") || value.includes("preparando") || value.includes("clasificacion") || value.includes("reservado") || value.includes("revertido") || value.includes("generada") || value.includes("impresa") || value.includes("entregado")) return "partial";
    if (value.includes("vencido") || value.includes("pendiente") || value.includes("observado") || value.includes("no conectado")) return "pending";
    return "cancelled";
  }

  function calculateReceptionTotal(values) {
    return (parseNumber(values.meshCount) * parseNumber(values.stemsPerMesh)) + parseNumber(values.extraStems);
  }

  function estimateBunches(stems, stemsPerBunch = 25) {
    const divisor = parseNumber(stemsPerBunch, 25) || 25;
    return Math.max(Math.round(parseNumber(stems) / divisor), 0);
  }

  function buildLabelCode(draft) {
    return String(Math.max(1, parseNumber(draft.sequence, 1))).padStart(10, "0");
  }

  function renderTabs(route) {
    const siblings = BlessERP.navigation.groupMap[route.groupId]?.routes || [];
    return `
      <div class="subnav-tabs">
        ${siblings.map(item => `
          <button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function renderPageHeader(route, badgeText, badgeTone = "partial", descriptionOverride = "") {
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">OPERACIONES / POSCOSECHA</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(descriptionOverride || route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge ${esc(badgeTone)}">${esc(badgeText)}</span>
        </div>
      </section>
    `;
  }

  function renderNotice(ui) {
    if (!ui?.notice) return "";
    return `<div class="inline-feedback ${esc(ui.noticeTone || "info")}">${esc(ui.notice)}</div>`;
  }

  function renderSummaryCards(cards) {
    return `
      <section class="summary-grid ops-summary-grid">
        ${cards.map(card => `
          <article class="summary-card">
            <span>${esc(card.label)}</span>
            <strong>${esc(card.value)}</strong>
            <small>${esc(card.help || "")}</small>
          </article>
        `).join("")}
      </section>
    `;
  }

  function renderModuleCard(routeId, info = {}) {
    const route = BlessERP.navigation.routeMap[routeId];
    if (!route) return "";
    return `
      <article class="panel-card ops-module-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">PARTE 1 POSCOSECHA</p>
            <h3>${esc(route.label)}</h3>
          </div>
          <span class="status-badge partial">${esc(info.status || "Demo visual")}</span>
        </div>
        <p class="panel-note">${esc(info.description || route.description)}</p>
        <div class="info-stack">
          <div class="info-row"><strong>Origen</strong><span>Parte 1 POSCOSECHA</span></div>
          <div class="info-row"><strong>Dato demo</strong><span>${esc(info.dataPoint || "Preparado para integracion controlada")}</span></div>
          <div class="info-row"><strong>Accion futura</strong><span>${esc(info.futureAction || "Conectar adapter de Parte 1")}</span></div>
        </div>
        <button class="secondary-button" data-route-link="${esc(route.id)}">Abrir pantalla</button>
      </article>
    `;
  }

  function inventoryToAvailability(item) {
    return {
      availability_id: item.inventoryId,
      fecha: item.date,
      variedad: item.variety,
      longitud: item.length,
      tallos_por_ramo: item.stemsPerBunch,
      ramos_disponibles: item.bunches,
      tallos_disponibles: item.stems,
      bodega: item.warehouse,
      proveedor: item.supplier,
      bloque: item.block,
      categoria: item.category,
      estado: item.state,
      edad_dias: item.ageDays,
      observacion: item.observation
    };
  }

  function buildAvailabilityRows(store) {
    const state = BlessERP.state?.state || null;
    if (BlessERP.operacionesAvailabilityDemo?.getAvailabilityDemo && state) {
      return BlessERP.operacionesAvailabilityDemo.getAvailabilityDemo(state);
    }
    return (store.roseInventory || []).map(inventoryToAvailability);
  }

  function buildWarehouseRows(store) {
    return (store.roseInventory || []).map(item => ({
      inventoryId: item.inventoryId,
      labelCode: item.labelCode,
      location: item.location,
      variety: item.variety,
      length: item.length,
      stemsPerBunch: item.stemsPerBunch,
      bunches: item.bunches,
      admittedAt: item.admittedAt || item.date,
      ageDays: item.ageDays,
      coldState: item.coldState,
      responsible: item.responsible,
      supplier: item.supplier,
      block: item.block,
      assignedOrderId: item.assignedOrderId || "",
      assignedBoxNumber: item.assignedBoxNumber || "",
      assignedAt: item.assignedAt || "",
      state: item.state,
      observation: item.observation
    })).sort((left, right) => String(left.admittedAt || "").localeCompare(String(right.admittedAt || "")));
  }

  function buildClassificationBalances(store) {
    const receptions = Object.fromEntries((store.receptions || []).map(item => [item.id, item]));
    const grouped = {};
    (store.classifications || []).forEach(item => {
      if (!grouped[item.receptionId]) {
        grouped[item.receptionId] = {
          receptionId: item.receptionId,
          lotCode: item.lotCode,
          declared: parseNumber(receptions[item.receptionId]?.totalDeclared, 0),
          processed: 0,
          leftovers: 0,
          supplier: item.supplier,
          variety: item.variety
        };
      }
      grouped[item.receptionId].processed += parseNumber(item.totalStems, 0);
      grouped[item.receptionId].leftovers += parseNumber(item.leftovers, 0);
    });

    return Object.values(grouped).map(item => {
      const processedReal = item.processed + item.leftovers;
      const difference = item.declared - processedReal;
      return {
        ...item,
        processedReal,
        difference,
        alertTone: difference === 0 ? "authorized" : "pending"
      };
    });
  }

  function averagePerformance(store) {
    const rows = store.performances || [];
    if (!rows.length) return 0;
    return rows.reduce((sum, item) => sum + parseNumber(item.performancePerHour), 0) / rows.length;
  }

  function buildOperationalAlerts(store) {
    const alerts = [];
    const state = BlessERP.state?.state || null;
    const balances = buildClassificationBalances(store);
    const mismatch = balances.filter(item => item.difference !== 0);
    if (mismatch.length) {
      alerts.push({
        title: "Clasificacion con diferencia",
        detail: `${mismatch[0].lotCode}: diferencia demo de ${number(Math.abs(mismatch[0].difference))} tallos.`
      });
    }

    const missingLocation = (store.roseInventory || []).find(item => !String(item.location || "").trim() || String(item.location).includes("PENDIENTE"));
    if (missingLocation) {
      alerts.push({
        title: "Ramos sin ubicacion",
        detail: `${missingLocation.variety} ${missingLocation.length} cm espera ubicacion final.`
      });
    }

    const expired = (store.roseInventory || []).filter(item => item.state === "VENCIDO");
    if (expired.length) {
      alerts.push({
        title: "Ramos vencidos",
        detail: `${expired.length} registro(s) con edad critica en bodega.`
      });
    }

    const sharedSummary = BlessERP.operacionesAvailabilityDemo?.getAvailabilitySummaryDemo && state
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilitySummaryDemo(state)
      : null;
    if (sharedSummary?.activeReservations) {
      alerts.push({
        title: "Reservas comerciales demo",
        detail: `${sharedSummary.activeReservations} reserva(s) activas consumen disponibilidad visual de Operaciones.`
      });
    }

    const scannerPending = (store.scannerEvents || []).filter(item => String(item.result || "").toLowerCase().includes("pendiente"));
    if (scannerPending.length) {
      alerts.push({
        title: "Escaneo pendiente",
        detail: `${scannerPending.length} lectura(s) demo sin validacion real.`
      });
    }

    const dispatchPending = (store.dispatches || []).filter(item => item.state !== "DESPACHADO");
    if (dispatchPending.length) {
      alerts.push({
        title: "Despacho operativo abierto",
        detail: `${dispatchPending.length} despacho(s) siguen en preparacion o listos.`
      });
    }

    const consumptionSummary = BlessERP.operacionesConsumptionDemo?.getConsumptionSummaryDemo
      ? BlessERP.operacionesConsumptionDemo.getConsumptionSummaryDemo(state)
      : null;
    if (consumptionSummary?.pendingOrders) {
      alerts.push({
        title: "Consumo demo pendiente",
        detail: `${consumptionSummary.pendingOrders} pedido(s) despachados demo aun no simulan consumo de rosas.`
      });
    }

    return alerts;
  }

  function buildPanelSummary(store) {
    const state = BlessERP.state?.state || null;
    const availabilityRows = buildAvailabilityRows(store);
    const dispatchSummary = buildDispatchSummary(store);
    const scannerSummary = buildScannerSummary(store);
    const consumptionSummary = BlessERP.operacionesConsumptionDemo?.getConsumptionSummaryDemo
      ? BlessERP.operacionesConsumptionDemo.getConsumptionSummaryDemo(state)
      : {
          todaySimulated: 0,
          consumedBunches: 0,
          consumedStems: 0,
          pendingOrders: 0,
          revertedCount: 0
        };
    const sharedSummary = BlessERP.operacionesAvailabilityDemo?.getAvailabilitySummaryDemo && state
      ? BlessERP.operacionesAvailabilityDemo.getAvailabilitySummaryDemo(state)
      : null;
    const receivedToday = (store.receptions || [])
      .filter(item => item.date === today())
      .reduce((sum, item) => sum + estimateBunches(item.totalDeclared), 0);
    const classifiedBunches = (store.classifications || []).reduce((sum, item) => sum + parseNumber(item.bunches), 0);
    const availableBunches = sharedSummary
      ? sharedSummary.exportAvailableBunches
      : availabilityRows
        .filter(item => String(item.estado || "").toUpperCase() === "DISPONIBLE")
        .reduce((sum, item) => sum + parseNumber(item.ramos_disponibles), 0);
    const reservedBunches = sharedSummary
      ? sharedSummary.reservedBunches
      : availabilityRows
        .filter(item => String(item.estado || "").toUpperCase().includes("RESERVADO"))
        .reduce((sum, item) => sum + parseNumber(item.ramos_reservados_demo || item.ramos_disponibles), 0);
    const warehouseBunches = availabilityRows
      .filter(item => String(item.estado || "").toUpperCase() !== "DESPACHADO")
      .reduce((sum, item) => sum + parseNumber(item.ramos_saldo_demo || item.ramos_disponibles), 0);
    const expiredBunches = sharedSummary
      ? sharedSummary.expiredBunches
      : availabilityRows
        .filter(item => String(item.estado || "").toUpperCase() === "VENCIDO")
        .reduce((sum, item) => sum + parseNumber(item.ramos_saldo_demo || item.ramos_disponibles), 0);
    const labelCount = (store.labelBatches || []).reduce((sum, item) => sum + parseNumber(item.quantity), 0);
    const pendingScans = (store.scannerEvents || []).filter(item => String(item.result || item.resultado || "").toLowerCase().includes("pendiente")).length;
    return {
      receivedToday,
      classifiedBunches,
      availableBunches,
      reservedBunches,
      warehouseBunches,
      expiredBunches,
      nationalBunches: sharedSummary?.nationalBunches || 0,
      varietiesAvailable: sharedSummary?.varietiesAvailable || 0,
      activeReservations: sharedSummary?.activeReservations || 0,
      dispatchSummary,
      consumptionSummary,
      averageYield: averagePerformance(store),
      labelCount,
      pendingScans,
      scannerSummary,
      alerts: buildOperationalAlerts(store)
    };
  }

  function buildInventoryStatusSummary(store) {
    return (store.roseInventory || []).reduce((summary, item) => {
      const key = String(item.state || "").toUpperCase();
      summary[key] = (summary[key] || 0) + parseNumber(item.bunches);
      return summary;
    }, {});
  }

  function buildLabelSummary(store) {
    return {
      total: (store.labelBatches || []).reduce((sum, item) => sum + parseNumber(item.quantity), 0),
      mixed: (store.labelBatches || []).filter(item => item.labelType === "MIXTA").reduce((sum, item) => sum + parseNumber(item.quantity), 0),
      reprints: (store.labelBatches || []).reduce((sum, item) => sum + Math.max(parseNumber(item.printCount) - 1, 0), 0)
    };
  }

  function buildScannerSummary(store) {
    if (BlessERP.operacionesScannerDemo?.getScannerSummaryDemo) {
      return BlessERP.operacionesScannerDemo.getScannerSummaryDemo(BlessERP.state?.state);
    }
    const events = store.scannerEvents || [];
    return {
      total: events.length,
      lastEvent: events[0] || null,
      pending: events.filter(item => String(item.result || "").toLowerCase().includes("pendiente")).length,
      today: events.length,
      boxes: events.filter(item => String(item.type || item.tipo_codigo || "").toUpperCase() === "CAJA").length,
      notFound: events.filter(item => String(item.result || item.resultado || "").toUpperCase() === "NO_ENCONTRADO").length,
      duplicates: events.filter(item => String(item.result || item.resultado || "").toUpperCase() === "DUPLICADO").length
    };
  }

  function buildDispatchSummary(store) {
    const state = BlessERP.state?.state || null;
    const dispatches = BlessERP.operacionesDispatchDemo?.getDispatchesDemo && state
      ? BlessERP.operacionesDispatchDemo.getDispatchesDemo(state)
      : (store.dispatches || []);

    const todayIso = today();
    return {
      open: dispatches.filter(item => !["DESPACHADO_DEMO", "CERRADO_DEMO", "ANULADO_DEMO"].includes(String(item.estado_despacho || item.state || "").toUpperCase())).length,
      preparing: dispatches.filter(item => String(item.estado_despacho || item.state || "").toUpperCase() === "EN_PREPARACION").length,
      ready: dispatches.filter(item => String(item.estado_despacho || item.state || "").toUpperCase() === "LISTO_DESPACHO").length,
      dispatchedToday: dispatches.filter(item => (
        String(item.estado_despacho || item.state || "").toUpperCase() === "DESPACHADO_DEMO" &&
        String(item.fecha_hora_despacho || item.dispatchDate || "").slice(0, 10) === todayIso
      )).length,
      observed: dispatches.filter(item => String(item.estado_despacho || item.state || "").toUpperCase() === "OBSERVADO").length,
      cancelled: dispatches.filter(item => String(item.estado_despacho || item.state || "").toUpperCase() === "ANULADO_DEMO").length,
      totalBoxes: dispatches.reduce((sum, item) => sum + parseNumber(item.total_cajas || item.boxes), 0),
      totalBunches: dispatches.reduce((sum, item) => sum + parseNumber(item.total_ramos || item.bunchesShipped), 0),
      totalFulls: dispatches.reduce((sum, item) => sum + parseNumber(item.total_fulls), 0),
      pendingBoxes: dispatches
        .filter(item => !["DESPACHADO_DEMO", "ANULADO_DEMO"].includes(String(item.estado_despacho || item.state || "").toUpperCase()))
        .reduce((sum, item) => sum + parseNumber(item.total_cajas || item.boxes), 0),
      pendingFulls: dispatches
        .filter(item => !["DESPACHADO_DEMO", "ANULADO_DEMO"].includes(String(item.estado_despacho || item.state || "").toUpperCase()))
        .reduce((sum, item) => sum + parseNumber(item.total_fulls), 0),
      alerts: dispatches.filter(item => ["OBSERVADO", "PENDIENTE"].includes(String(item.estado_despacho || item.state || "").toUpperCase())).length
    };
  }

  BlessERP.operacionesUtils = {
    badgeClass,
    buildAvailabilityRows,
    buildClassificationBalances,
    buildDispatchSummary,
    buildInventoryStatusSummary,
    buildLabelCode,
    buildLabelSummary,
    buildModuleCard: renderModuleCard,
    buildOperationalAlerts,
    buildPanelSummary,
    buildScannerSummary,
    buildWarehouseRows,
    calculateReceptionTotal,
    clone,
    dateLabel,
    esc,
    estimateBunches,
    inventoryToAvailability,
    number,
    parseNumber,
    renderNotice,
    renderPageHeader,
    renderSummaryCards,
    renderTabs
  };
})();
