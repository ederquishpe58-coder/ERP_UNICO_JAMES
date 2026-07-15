(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { clone, esc, money, number, today } = BlessERP.utils;
  const data = BlessERP.comercialData;

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeText(value) {
    return String(value || "").trim().toUpperCase();
  }

  function iso(value) {
    if (!value) return "";
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return raw;
  }

  function dateLabel(value) {
    if (!value) return "-";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function badgeClass(status) {
    const value = String(status || "").toLowerCase();
    if (value.includes("validado") || value.includes("activa") || value.includes("activo") || value.includes("ok") || value.includes("listo") || value.includes("despach") || value.includes("cerrado")) return "authorized";
    if (value.includes("referencial") || value.includes("demo") || value.includes("parcial") || value.includes("preparado") || value.includes("reabierto")) return "partial";
    if (value.includes("anulado") || value.includes("futuro") || value.includes("caduc")) return "cancelled";
    return "pending";
  }

  function findCustomer(customerId) {
    return data.customers.find(item => item.id === customerId) || null;
  }

  function findBrand(brandId) {
    return data.brands.find(item => item.id === brandId) || null;
  }

  function findBrandsByCustomer(customerId) {
    return data.brands.filter(item => item.customerId === customerId);
  }

  function findAgency(agencyId) {
    return data.agencies.find(item => item.id === agencyId) || null;
  }

  function getAirlineCatalog(appState) {
    if (appState && BlessERP.comercialState?.getAirlineCatalog) {
      const catalog = BlessERP.comercialState.getAirlineCatalog(appState);
      if (Array.isArray(catalog)) return catalog;
    }
    return data.airlines;
  }

  function findAirline(airlineId, appState) {
    return getAirlineCatalog(appState).find(item => item.id === airlineId) || null;
  }

  function getAwbDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 11);
  }

  function normalizeAwb(value) {
    const digits = getAwbDigits(value);
    return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
  }

  function findAirlineByAwb(value, appState) {
    const prefix = getAwbDigits(value).slice(0, 3);
    if (prefix.length !== 3) return null;
    return getAirlineCatalog(appState).find(item =>
      String(item.awbPrefix || "").padStart(3, "0") === prefix
      && String(item.status || "ACTIVA").toUpperCase() !== "INACTIVA"
    ) || null;
  }

  function findDae(daeNumber) {
    return data.daes.find(item => item.number === daeNumber) || null;
  }

  function findBoxType(code) {
    return data.boxTypes.find(item => item.code === code) || data.boxTypes[0];
  }

  function getAvailabilityService() {
    return BlessERP.operacionesAvailabilityDemo || null;
  }

  function getDispatchService() {
    return BlessERP.operacionesDispatchDemo || null;
  }

  function isReservationActive(record) {
    const value = normalizeText(record?.estado || record?.status);
    return !["LIBERADO", "LIBERADO_DEMO", "ANULADO", "ANULADO_DEMO"].includes(value);
  }

  function normalizeAvailabilityRow(item) {
    const availabilityId = item.availability_id || item.id || "";
    const remainingBunches = parseNumber(
      item.ramos_saldo_demo ?? item.remainingBunches ?? item.ramos_disponibles ?? item.bunchesAvailable,
      0
    );
    const remainingStems = parseNumber(
      item.tallos_saldo_demo ?? item.remainingStems ?? item.tallos_disponibles ?? item.stemsAvailable,
      0
    );
    const reservedBunches = parseNumber(item.ramos_reservados_demo ?? item.reservedBunches, 0);
    const reservedStems = parseNumber(item.tallos_reservados_demo ?? item.reservedStems, 0);

    return {
      ...clone(item),
      id: availabilityId,
      availability_id: availabilityId,
      variety: item.variedad || item.variety || "",
      variedad: item.variedad || item.variety || "",
      length: parseNumber(item.longitud ?? item.length, 0),
      longitud: parseNumber(item.longitud ?? item.length, 0),
      stemsPerBunch: parseNumber(item.tallos_por_ramo ?? item.stemsPerBunch, 0),
      tallos_por_ramo: parseNumber(item.tallos_por_ramo ?? item.stemsPerBunch, 0),
      bunchesAvailable: parseNumber(item.ramos_disponibles ?? item.bunchesAvailable, 0),
      ramos_disponibles: parseNumber(item.ramos_disponibles ?? item.bunchesAvailable, 0),
      stemsAvailable: parseNumber(item.tallos_disponibles ?? item.stemsAvailable, 0),
      tallos_disponibles: parseNumber(item.tallos_disponibles ?? item.stemsAvailable, 0),
      warehouse: item.bodega || item.warehouse || "",
      bodega: item.bodega || item.warehouse || "",
      supplier: item.proveedor || item.supplier || "",
      proveedor: item.proveedor || item.supplier || "",
      block: item.bloque || item.block || "",
      bloque: item.bloque || item.block || "",
      category: item.categoria || item.category || "",
      categoria: item.categoria || item.category || "",
      status: item.estado || item.status || "",
      estado: item.estado || item.status || "",
      ageDays: parseNumber(item.edad_dias ?? item.ageDays, 0),
      edad_dias: parseNumber(item.edad_dias ?? item.ageDays, 0),
      note: item.observacion || item.note || "",
      observacion: item.observacion || item.note || "",
      reservedBunches,
      reservedStems,
      remainingBunches,
      remainingStems,
      ramos_reservados_demo: reservedBunches,
      tallos_reservados_demo: reservedStems,
      ramos_saldo_demo: remainingBunches,
      tallos_saldo_demo: remainingStems,
      exportable_demo: item.exportable_demo ?? normalizeText(item.categoria || item.category) === "EXPORTACION",
      reservable_demo: item.reservable_demo ?? (remainingBunches > 0 && normalizeText(item.estado || item.status) !== "VENCIDO"),
      reservas_activas_demo: parseNumber(item.reservas_activas_demo, 0)
    };
  }

  function daysBetween(fromValue, toValue) {
    const from = iso(fromValue);
    const to = iso(toValue);
    if (!from || !to) return null;
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    return Math.round((toDate - fromDate) / 86400000);
  }

  function daysUntil(dateValue) {
    return daysBetween(today(), dateValue);
  }

  function isDaeExpired(dae) {
    const remaining = daysUntil(dae?.expirationDate);
    return remaining !== null && remaining < 0;
  }

  function isDaeNearExpiry(dae) {
    const remaining = daysUntil(dae?.expirationDate);
    return remaining !== null && remaining >= 0 && remaining <= 5;
  }

  function getAvailableDaesForOrder(order) {
    const destination = normalizeText(order.destination);
    return data.daes.filter(item => (
      normalizeText(item.destination) === destination &&
      (!Array.isArray(item.customerIds) || item.customerIds.includes(order.customerId)) &&
      String(item.status || "").toUpperCase() === "ACTIVA" &&
      !isDaeExpired(item)
    ));
  }

  function createLineDefaults(seed = {}) {
    return data.createLine(seed);
  }

  function createOrderDefaults(seed = {}) {
    return data.createOrder(seed);
  }

  function normalizeOrder(order) {
    const draft = createOrderDefaults({
      ...order,
      lines: Array.isArray(order?.lines) ? order.lines : []
    });
    draft.lines = draft.lines.map(line => createLineDefaults(line));

    const customer = findCustomer(draft.customerId);
    const brand = findBrand(draft.brandId);
    const brands = findBrandsByCustomer(draft.customerId);

    if (!customer) {
      draft.brandId = "";
    }
    if (draft.brandId && !brands.some(item => item.id === draft.brandId)) {
      draft.brandId = "";
    }

    const activeBrand = findBrand(draft.brandId);
    if (activeBrand) {
      draft.destination = activeBrand.destination;
      draft.destinationCountry = activeBrand.country;
      if (!draft.agencyId) draft.agencyId = activeBrand.defaultAgencyId || "";
    }

    const agency = findAgency(draft.agencyId);
    if (!draft.coldRoom) {
      draft.coldRoom = agency?.coldRoom || data.company.coldRoomDefault;
    }

    if (!draft.paymentTerms && customer) {
      draft.paymentTerms = `${customer.creditDays} dias`;
    }

    if (draft.transportType !== "aereo") {
      draft.daeNumber = "";
      draft.daeDestination = "";
      draft.daeExpirationDate = "";
      draft.daeAssignedAutomatically = false;
      draft.daeModifiedManual = false;
    }

    return draft;
  }

  function applyManualDae(order, daeNumber) {
    order.daeNumber = daeNumber || "";
    order.daeAssignedAutomatically = false;
    order.daeModifiedManual = Boolean(daeNumber);
    const dae = findDae(daeNumber);
    if (!dae) {
      order.daeDestination = order.destination || "";
      order.daeExpirationDate = "";
      return { type: daeNumber ? "warning" : "info", text: daeNumber ? "La DAE seleccionada no existe en el catalogo demo." : "" };
    }
    order.daeDestination = dae.destination;
    order.destination = dae.destination;
    order.destinationCountry = dae.country;
    order.daeExpirationDate = dae.expirationDate;
    if (dae.airlineId) {
      order.airlineId = dae.airlineId;
    }
    if (isDaeExpired(dae)) {
      return { type: "warning", text: "La DAE seleccionada esta caducada." };
    }
    if (isDaeNearExpiry(dae)) {
      return { type: "warning", text: "La DAE seleccionada esta proxima a caducar." };
    }
    return { type: "info", text: "" };
  }

  function autoAssignDae(order) {
    if (order.transportType !== "aereo") {
      order.daeNumber = "";
      order.daeDestination = "";
      order.daeExpirationDate = "";
      order.daeAssignedAutomatically = false;
      order.daeModifiedManual = false;
      return { type: "info", text: "" };
    }

    const available = getAvailableDaesForOrder(order);
    if (!available.length) {
      order.daeNumber = "";
      order.daeDestination = order.destination || "";
      order.daeExpirationDate = "";
      order.daeAssignedAutomatically = false;
      order.daeModifiedManual = false;
      return { type: "warning", text: "No existe una DAE vigente para el destino seleccionado." };
    }

    if (available.length > 1) {
      order.daeNumber = "";
      order.daeDestination = order.destination || "";
      order.daeExpirationDate = "";
      order.daeAssignedAutomatically = false;
      order.daeModifiedManual = false;
      return { type: "warning", text: "Existen varias DAEs activas para este destino. Debe escoger una manualmente." };
    }

    const dae = available[0];
    order.daeNumber = dae.number;
    order.daeDestination = dae.destination;
    order.destination = dae.destination;
    order.destinationCountry = dae.country;
    order.daeExpirationDate = dae.expirationDate;
    order.daeAssignedAutomatically = true;
    order.daeModifiedManual = false;
    if (dae.airlineId) {
      order.airlineId = dae.airlineId;
    }
    if (isDaeNearExpiry(dae)) {
      return { type: "warning", text: "La DAE autoasignada esta proxima a caducar." };
    }
    return { type: "info", text: "" };
  }

  function createResolvedLine(line) {
    const boxNumber = parseNumber(line.boxNumber, 1);
    const bunches = parseNumber(line.bunches, 0);
    const stemsPerBunch = parseNumber(line.stemsPerBunch, 0);
    const length = parseNumber(line.length, 0);
    const unitPrice = parseNumber(line.unitPrice, 0);
    const totalStems = bunches * stemsPerBunch;
    const totalLine = totalStems * unitPrice;
    return {
      ...createLineDefaults(line),
      boxNumber,
      bunches,
      stemsPerBunch,
      length,
      unitPrice,
      reservationId: line.reservationId || line.reservation_id || "",
      reservationSourceId: line.reservationSourceId || line.availability_id || "",
      reservationBunchesUsed: parseNumber(line.reservationBunchesUsed || line.ramos_reserva_usados, bunches),
      reservationNote: line.reservationNote || "",
      totalStems,
      totalLine
    };
  }

  function getOrderMetrics(order) {
    const lines = (order.lines || []).map(createResolvedLine).sort((a, b) => {
      if (a.boxNumber !== b.boxNumber) return a.boxNumber - b.boxNumber;
      return a.variety.localeCompare(b.variety);
    });

    const uniqueBoxes = new Map();
    const byLength = {};
    const byVariety = {};
    const byBoxType = {};
    let totalBunches = 0;
    let totalStems = 0;
    let totalUsd = 0;

    lines.forEach(line => {
      totalBunches += line.bunches;
      totalStems += line.totalStems;
      totalUsd += line.totalLine;
      if (!uniqueBoxes.has(line.boxNumber)) {
        uniqueBoxes.set(line.boxNumber, line.boxType);
      }
      byLength[line.length] = (byLength[line.length] || 0) + line.totalStems;
      byVariety[line.variety] = (byVariety[line.variety] || 0) + line.totalStems;
      byBoxType[line.boxType] = (byBoxType[line.boxType] || 0) + 1;
    });

    let totalFulls = 0;
    uniqueBoxes.forEach(boxTypeCode => {
      totalFulls += parseNumber(findBoxType(boxTypeCode)?.fullEquivalent, 0);
    });

    return {
      lines,
      totalBoxes: uniqueBoxes.size,
      totalFulls,
      totalBunches,
      totalStems,
      totalUsd,
      averagePricePerStem: totalStems ? totalUsd / totalStems : 0,
      byLength,
      byVariety,
      byBoxType
    };
  }

  function getEstimatedMaterials(order) {
    if (BlessERP.comercialPackaging?.calculateOrderRequirements) {
      return BlessERP.comercialPackaging.calculateOrderRequirements(order, BlessERP.state?.state).requirements.map(item => ({
        code: item.code,
        name: item.name,
        unit: item.unit,
        required: item.required,
        available: item.available,
        missing: item.missing,
        state: item.state,
        observation: item.observation,
        category: item.category,
        warehouse: item.warehouse
      }));
    }

    const metrics = getOrderMetrics(order);
    const uniqueBoxes = new Map();
    metrics.lines.forEach(line => {
      if (!uniqueBoxes.has(line.boxNumber)) {
        uniqueBoxes.set(line.boxNumber, line.boxType);
      }
    });

    const required = {};
    uniqueBoxes.forEach(boxType => {
      required[`CARTON_${boxType}`] = (required[`CARTON_${boxType}`] || 0) + 1;
      required.SEPARADOR = (required.SEPARADOR || 0) + (data.materialRules.separatorPerBox[boxType] || 1);
      required.ETIQUETA = (required.ETIQUETA || 0) + data.materialRules.labelsPerBox;
    });

    required.LIGA = Math.ceil(metrics.totalBunches / data.materialRules.bunchesPerLigaPack);

    const capuchonBunches = metrics.lines
      .filter(line => data.materialRules.capuchonLengths.includes(line.length))
      .reduce((sum, line) => sum + line.bunches, 0);
    required.CAPUCHON = Math.ceil(capuchonBunches / data.materialRules.bunchesPerCapuchonPack);

    return Object.entries(required)
      .filter(([, qty]) => qty > 0)
      .map(([code, qty]) => {
        const stock = data.materialStock[code] || { name: code, unit: "unidad", available: 0 };
        const available = parseNumber(stock.available, 0);
        const missing = Math.max(qty - available, 0);
        let state = "OK";
        if (missing > 0 && available > 0) state = "PARCIAL";
        if (available === 0 && qty > 0) state = "FALTANTE";
        return {
          code,
          name: stock.name,
          unit: stock.unit,
          required: qty,
          available,
          missing,
          state,
          observation: state === "OK"
            ? "Stock demo suficiente."
            : "Revisar abastecimiento antes de validar."
        };
      });
  }

  function getReservationSummary(order, reservations) {
    const activeReservations = (reservations || []).filter(item => (
      isReservationActive(item) &&
      String(item.pedido_id || item.orderId) === String(order.id)
    ));
    return activeReservations.reduce((summary, item) => {
      summary.totalBunches += parseNumber(item.ramos_reservados || item.bunchesReserved, 0);
      summary.totalStems += parseNumber(item.tallos_reservados || item.stemsReserved, 0);
      summary.count += 1;
      summary.rows.push(item);
      return summary;
    }, { totalBunches: 0, totalStems: 0, count: 0, rows: [] });
  }

  function getReservationUsageSummary(order, reservations) {
    const metrics = getOrderMetrics(order);
    const activeReservations = (reservations || []).filter(item => (
      isReservationActive(item) &&
      String(item.pedido_id || item.orderId) === String(order.id)
    ));

    let linesWithReservation = 0;
    let linesWithoutReservation = 0;
    let usedBunches = 0;

    metrics.lines.forEach(line => {
      if (String(line.reservationId || "").trim()) {
        linesWithReservation += 1;
        usedBunches += parseNumber(line.reservationBunchesUsed, line.bunches);
      } else if (parseNumber(line.bunches, 0) > 0) {
        linesWithoutReservation += 1;
      }
    });

    const unusedReservations = activeReservations.filter(item => !metrics.lines.some(line => (
      String(line.reservationId || "") === String(item.reservation_id || item.id)
    )));

    const reservedBunches = activeReservations.reduce((sum, item) => (
      sum + parseNumber(item.ramos_reservados || item.bunchesReserved, 0)
    ), 0);

    return {
      activeCount: activeReservations.length,
      reservedBunches,
      reservedStems: activeReservations.reduce((sum, item) => (
        sum + parseNumber(item.tallos_reservados || item.stemsReserved, 0)
      ), 0),
      linesWithReservation,
      linesWithoutReservation,
      usedBunches,
      unusedReservationCount: unusedReservations.length,
      unusedBunches: Math.max(reservedBunches - usedBunches, 0),
      unusedReservations,
      reservations: activeReservations
    };
  }

  function getAvailabilityRowsWithReservations(appStateOrReservations) {
    const service = getAvailabilityService();
    const currentState = Array.isArray(appStateOrReservations)
      ? BlessERP.state?.state
      : appStateOrReservations || BlessERP.state?.state;

    if (service && currentState) {
      return service.getAvailabilityDemo(currentState).map(normalizeAvailabilityRow);
    }

    const reservations = Array.isArray(appStateOrReservations) ? appStateOrReservations : [];
    return data.availability.map(item => {
      const reservedBunches = (reservations || [])
        .filter(entry => (
          String(entry.availabilityId || entry.availability_id) === String(item.id) &&
          isReservationActive(entry)
        ))
        .reduce((sum, entry) => sum + parseNumber(entry.bunchesReserved || entry.ramos_reservados, 0), 0);
      const reservedStems = (reservations || [])
        .filter(entry => (
          String(entry.availabilityId || entry.availability_id) === String(item.id) &&
          isReservationActive(entry)
        ))
        .reduce((sum, entry) => sum + parseNumber(entry.stemsReserved || entry.tallos_reservados, 0), 0);
      return normalizeAvailabilityRow({
        ...clone(item),
        reservedBunches,
        reservedStems,
        remainingBunches: Math.max(parseNumber(item.bunchesAvailable, 0) - reservedBunches, 0),
        remainingStems: Math.max(parseNumber(item.stemsAvailable, 0) - reservedStems, 0)
      });
    });
  }

  function getValidationState(order, reservations) {
    const errors = [];
    const warnings = [];
    const customer = findCustomer(order.customerId);
    const brand = findBrand(order.brandId);
    const metrics = getOrderMetrics(order);
    const materials = getEstimatedMaterials(order);
    const dispatchService = getDispatchService();
    const dispatchReview = dispatchService?.validateDispatchReadinessDemo
      ? dispatchService.validateDispatchReadinessDemo(BlessERP.state?.state, order.id)
      : null;
    const packagingResult = BlessERP.comercialPackaging?.calculateOrderRequirements
      ? BlessERP.comercialPackaging.calculateOrderRequirements(order, BlessERP.state?.state)
      : null;

    if (!customer) errors.push("Falta cliente principal.");
    if (!brand) errors.push("Falta marca.");
    if (!order.destination) errors.push("Falta destino.");
    if (order.transportType === "aereo" && order.destination !== "ECUADOR" && !order.daeNumber) {
      errors.push("Falta DAE vigente.");
    }
    if (!order.issuedAt) errors.push("Falta fecha emision.");
    if (!order.flightDate) errors.push("Falta fecha vuelo.");
    if (!metrics.lines.length) errors.push("Falta detalle de cajas.");
    if (metrics.totalUsd <= 0) errors.push("Total USD cero.");
    if (metrics.lines.some(line => Number(line.unitPrice || 0) <= 0)) errors.push("Falta precio unitario.");
    if (order.daeExpirationDate && order.flightDate && order.flightDate > order.daeExpirationDate) {
      errors.push("Fecha vuelo posterior a caducidad DAE.");
    }

    if (brand?.requiresPo && metrics.lines.some(line => !String(line.po || "").trim())) {
      warnings.push("Falta PO cuando la marca lo requiere.");
    }
    if (!order.awb) warnings.push("Falta guia madre.");
    if (!order.hawb) warnings.push("Falta guia hija.");
    if (!order.airlineId || !order.flightNumber) warnings.push("Falta carrier/vuelo.");
    const dae = findDae(order.daeNumber);
    if (dae && isDaeNearExpiry(dae)) warnings.push("DAE proxima a caducar.");
    if (packagingResult?.summary.missingCount > 0) warnings.push("Materiales faltantes en bodega / empaque.");
    if (packagingResult?.summary.partialCount > 0) warnings.push("Materiales parciales en bodega / empaque.");
    if (packagingResult?.missingCatalogCodes?.length) warnings.push("Caja sin material configurado.");
    if (packagingResult?.missingRules?.length) warnings.push("Tipo de caja sin regla de empaque.");
    if (!packagingResult && materials.some(item => item.state !== "OK")) warnings.push("Bodega con materiales faltantes.");
    if (!String(order.documentActivity?.ETIQUETAS?.previewedAt || order.documentActivity?.ETIQUETAS?.printedAt || "").trim()) warnings.push("Etiquetas no generadas.");
    if (!["INVOICE_PACKING_REAL", "PACKING_LIST", "HR", "MP"].every(docCode => String(order.documentActivity?.[docCode]?.previewedAt || order.documentActivity?.[docCode]?.printedAt || "").trim())) {
      warnings.push("Documentos de despacho aun no impresos o sin vista previa.");
    }
    const reservationSummary = getReservationSummary(order, reservations);
    const reservationUsage = getReservationUsageSummary(order, reservations);

    if (reservationUsage.linesWithoutReservation > 0) warnings.push("Existen lineas de cajas sin reserva de disponibilidad demo.");
    if (reservationUsage.unusedReservationCount > 0) warnings.push("Existen reservas demo sin usar todavia en cajas.");
    if (reservationSummary.count > 0) warnings.push("Las reservas actuales provienen del flujo demo Operaciones -> Comercial.");
    warnings.push("Disponibilidad real no conectada. Se usa availabilityContract demo.");
    warnings.push("Inventario real no conectado.");
    warnings.push("Scanner real no conectado.");
    warnings.push("Despacho demo no afecta inventario real.");
    warnings.push("Estado despacho no autorizado por SRI.");
    warnings.push("Factura SRI pendiente.");
    warnings.push("Contabilidad real pendiente.");
    warnings.push("Supabase pendiente.");

    if (dispatchReview) {
      if (dispatchReview.errors.includes("Falta marca.")) errors.push("Despacho sin marca.");
      if (dispatchReview.errors.includes("Falta destino.")) errors.push("Despacho sin destino.");
      if (dispatchReview.errors.includes("Falta DAE.")) errors.push("Despacho sin DAE.");
      if (dispatchReview.errors.includes("Pedido sin cajas.")) errors.push("Despacho sin cajas.");
      if (dispatchReview.errors.includes("Pedido anulado.")) errors.push("Pedido anulado.");
      dispatchReview.warnings.forEach(item => warnings.push(item));
    }

    return {
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      metrics,
      materials,
      packaging: packagingResult,
      reservationUsage,
      reservationSummary,
      nextState: errors.length ? "BORRADOR" : "VALIDADO_COMERCIAL"
    };
  }

  function buildCommercialOrderContract(order) {
    const customer = findCustomer(order.customerId);
    const brand = findBrand(order.brandId);
    const metrics = getOrderMetrics(order);
    const agency = findAgency(order.agencyId);
    const airline = findAirline(order.airlineId);
    return {
      pedido_id: order.id,
      numero_pedido: order.number,
      cliente_principal_id: customer?.id || "",
      cliente_principal_nombre: customer?.commercialName || "",
      marca_id: brand?.id || "",
      marca_nombre: brand?.name || "",
      destino: order.destination || "",
      fecha_emision: order.issuedAt || "",
      fecha_vuelo: order.flightDate || "",
      estado: order.status || "BORRADOR",
      total_cajas: metrics.totalBoxes,
      total_fulls: metrics.totalFulls,
      total_ramos: metrics.totalBunches,
      total_tallos: metrics.totalStems,
      total_usd: metrics.totalUsd,
      dae: order.daeNumber || "",
      awb: order.awb || "",
      hawb: order.hawb || "",
      agencia_carga: agency?.name || "",
      linea_aerea: airline?.name || "",
      tipo_transporte: order.transportType || "",
      observacion: order.notes || ""
    };
  }

  BlessERP.comercialUtils = {
    badgeClass,
    buildCommercialOrderContract,
    clone,
    createLineDefaults,
    createOrderDefaults,
    dateLabel,
    daysBetween,
    daysUntil,
    esc,
    findAgency,
    findAirline,
    findAirlineByAwb,
    findBoxType,
    findBrand,
    findBrandsByCustomer,
    findCustomer,
    findDae,
    getAvailabilityService,
    getDispatchService,
    getAvailabilityRowsWithReservations,
    getAvailableDaesForOrder,
    getEstimatedMaterials,
    getOrderMetrics,
    getReservationSummary,
    getReservationUsageSummary,
    getValidationState,
    isReservationActive,
    getAwbDigits,
    normalizeAwb,
    isDaeExpired,
    isDaeNearExpiry,
    iso,
    money,
    normalizeOrder,
    normalizeText,
    number,
    parseNumber,
    applyManualDae,
    autoAssignDae
  };
})();
