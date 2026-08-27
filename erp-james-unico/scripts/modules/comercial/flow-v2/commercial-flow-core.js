(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const commercialUtils = BlessERP.comercialUtils;
  const boxBuilder = BlessERP.comercialBoxBuilder;
  const invoiceSequence = BlessERP.comercialInvoiceSequence;
  const sessions = new Map();
  const orderMutationChains = new Map();
  const ACTIVE_ORDER_STATES = new Set(["GUARDADO", "EN_CUARTO_FRIO", "COMPLETADO"]);
  const IMMUTABLE_SRI_STATES = new Set(["AUTORIZADO", "ANULADO"]);
  const REQUIRED_AIRLINES = Object.freeze([
    { id: "air-lancargo", code: "AIR-LAN", name: "LANCARGO", awbPrefix: "014", status: "ACTIVA" }
  ]);

  function clone(value) {
    return BlessERP.utils?.clone ? BlessERP.utils.clone(value) : JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function upper(value) {
    return text(value).toUpperCase();
  }

  function number(value) {
    const parsed = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());
  }

  function activeCompanyId(appState) {
    return String(
      BlessERP.services?.companyContext?.activeCompanyId?.()
      || appState?.db?.activeCompanyId
      || "COMP-BLESS-FLOWER"
    );
  }

  function currentUser(appState) {
    const user = BlessERP.authAccess?.activeAccess?.()?.session?.user
      || BlessERP.services?.adminConfig?.activeUser?.()
      || BlessERP.adminConfig?.activeUser?.()
      || appState?.db?.session?.activeUser
      || {};
    return {
      id: text(user.id || user.user_id || user.code || "LOCAL-USER"),
      name: text(user.name || user.fullName || user.email || "Usuario local")
    };
  }

  function ensureDomain(appState) {
    const db = appState.db;
    db.commercial = db.commercial && typeof db.commercial === "object" ? db.commercial : {};
    db.commercial.orders = Array.isArray(db.commercial.orders) ? db.commercial.orders : [];
    db.commercial.preorders = Array.isArray(db.commercial.preorders) ? db.commercial.preorders : [];
    db.commercial.orderReservations = Array.isArray(db.commercial.orderReservations) ? db.commercial.orderReservations : [];
    db.commercial.exportShipments = Array.isArray(db.commercial.exportShipments) ? db.commercial.exportShipments : [];
    db.commercial.exportShipmentDocuments = Array.isArray(db.commercial.exportShipmentDocuments) ? db.commercial.exportShipmentDocuments : [];
    db.commercial.exportShipmentFlights = Array.isArray(db.commercial.exportShipmentFlights) ? db.commercial.exportShipmentFlights : [];
    db.commercial.exportShipmentEvents = Array.isArray(db.commercial.exportShipmentEvents) ? db.commercial.exportShipmentEvents : [];
    db.commercial.airlineCatalog = Array.isArray(db.commercial.airlineCatalog) ? db.commercial.airlineCatalog : [];
    REQUIRED_AIRLINES.forEach(required => {
      const exists = db.commercial.airlineCatalog.some(row => String(row.awbPrefix || "").padStart(3, "0") === required.awbPrefix);
      if (!exists) db.commercial.airlineCatalog.push(clone(required));
    });
    db.commercial.sequenceLedger = db.commercial.sequenceLedger && typeof db.commercial.sequenceLedger === "object"
      ? db.commercial.sequenceLedger
      : {};
    db.commercial.flowAudit = Array.isArray(db.commercial.flowAudit) ? db.commercial.flowAudit : [];
    db.operations = db.operations && typeof db.operations === "object" ? db.operations : {};
    db.operations.roseInventory = Array.isArray(db.operations.roseInventory) ? db.operations.roseInventory : [];
    db.operations.bunchEntries = Array.isArray(db.operations.bunchEntries) ? db.operations.bunchEntries : [];
    db.operations.labelBatches = Array.isArray(db.operations.labelBatches) ? db.operations.labelBatches : [];
    db.operations.destinationLots = Array.isArray(db.operations.destinationLots) ? db.operations.destinationLots : [];
    db.operations.coldRoomEvents = Array.isArray(db.operations.coldRoomEvents) ? db.operations.coldRoomEvents : [];
    db.operations.bunchOrderAssignments = Array.isArray(db.operations.bunchOrderAssignments) ? db.operations.bunchOrderAssignments : [];
    db.operations.orderBoxes = Array.isArray(db.operations.orderBoxes) ? db.operations.orderBoxes : [];
    db.operations.orderMovements = Array.isArray(db.operations.orderMovements) ? db.operations.orderMovements : [];
    db.operations.dispatchRecords = Array.isArray(db.operations.dispatchRecords) ? db.operations.dispatchRecords : [];
    return db;
  }

  function localSave(appState) {
    ensureDomain(appState);
    // El navegador conserva la caché, pero PO, inventario y eventos operativos
    // deben entrar también a la cola incremental. commercial_orders se ignora
    // allí porque utiliza su RPC transaccional dedicada.
    const ok = BlessERP.state?.saveDb?.();
    if (ok === false) throw new Error("No se pudo guardar la base local de JAEDER SYSTEMS.");
    return true;
  }

  function cacheSave(appState) {
    ensureDomain(appState);
    const saveLocalOnly = BlessERP.state?.saveDbLocalOnly;
    if (typeof saveLocalOnly !== "function") throw new Error("La caché local segura no está disponible.");
    const ok = saveLocalOnly();
    if (ok === false) throw new Error("No se pudo actualizar la caché local de JAEDER SYSTEMS.");
    return true;
  }

  function requiresConfirmedRemoteOrder() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && window.location?.protocol !== "file:");
  }

  function serializeOrderMutation(orderId, task) {
    const key = text(orderId);
    const previous = orderMutationChains.get(key) || Promise.resolve();
    let completed;
    const current = previous.catch(() => undefined).then(task);
    completed = current.finally(() => {
      if (orderMutationChains.get(key) === completed) orderMutationChains.delete(key);
    });
    orderMutationChains.set(key, completed);
    return current;
  }

  function sessionFor(appState) {
    const companyId = activeCompanyId(appState);
    if (!sessions.has(companyId)) {
      sessions.set(companyId, {
        mode: "NEW",
        draft: null,
        boxBuilderOpen: false,
        boxDraft: boxBuilder.normalizeDraft?.({ mode: "RANGO", firstBox: 1 }) || {},
        selectedOrderId: "",
        history: { date: today(), search: "", market: "TODOS", page: 1, pageSize: 20 },
        tracking: { date: today(), search: "", page: 1, pageSize: 20 },
        coordination: { date: today(), status: "TODOS", page: 1, pageSize: 30, routeSheetOpen: false, routeSheetSelectedIds: [] },
        availability: { variety: "TODAS", length: "TODAS" },
        coldRoom: { date: today(), status: "TODOS", page: 1, pageSize: 20, orderId: "", boxNumber: 1 },
        exportShipment: { selectedId: "", selectedOrderId: "", status: "TODOS", message: "", tone: "info" },
        salesRepresentatives: [],
        salesRepresentativesLoaded: false,
        salesRepresentativesLoading: false,
        preorder: { selectedId: "", draft: null }
      });
    }
    return sessions.get(companyId);
  }

  function catalogs(appState) {
    const db = ensureDomain(appState);
    const commercial = db.commercial;
    const companyId = activeCompanyId(appState);
    const sameCompany = row => !text(row?.companyId || row?.company_id) || text(row.companyId || row.company_id) === companyId;
    return {
      customers: (commercial.customerCatalog || []).filter(row => sameCompany(row) && upper(row.status || "ACTIVO") !== "INACTIVO"),
      brands: (commercial.brandCatalog || []).filter(row => sameCompany(row) && upper(row.status || "ACTIVO") !== "INACTIVO"),
      agencies: (commercial.agencyCatalog || []).filter(row => upper(row.status || "ACTIVA") !== "INACTIVA"),
      airlines: (commercial.airlineCatalog || []).filter(row => upper(row.status || "ACTIVA") !== "INACTIVA"),
      daes: (commercial.daeCatalog || []).filter(row => sameCompany(row) && upper(row.status || "ACTIVA") === "ACTIVA"),
      countries: (commercial.countryCatalog || []).filter(row => upper(row.status || "ACTIVO") !== "INACTIVO"),
      varieties: (db.operations?.masterData?.varieties || []).filter(row => row.active !== false),
      lengths: (db.operations?.masterData?.lengths || []).filter(row => row.active !== false),
      boxTypes: data.boxTypes || []
    };
  }

  function customerFor(appState, customerId) {
    return catalogs(appState).customers.find(row => String(row.id) === String(customerId)) || null;
  }

  function brandFor(appState, brandId) {
    return catalogs(appState).brands.find(row => String(row.id) === String(brandId)) || null;
  }

  function agencyFor(appState, agencyId) {
    return catalogs(appState).agencies.find(row => String(row.id) === String(agencyId)) || null;
  }

  function applyAgencyColdRoom(draft, agency) {
    const configured = text(agency?.coldRoom || agency?.coldRooms?.[0]);
    if (!configured) return false;
    draft.coldRoom = configured;
    draft.coldRoomSourceAgencyId = agency.id;
    draft.coldRoomModifiedManual = false;
    return true;
  }

  function selectAgencyLogistics(draft, agency) {
    if (applyAgencyColdRoom(draft, agency)) return;
    if (draft.coldRoomSourceAgencyId) {
      draft.coldRoom = "";
      draft.coldRoomSourceAgencyId = "";
    }
  }

  function guideDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 11);
  }

  function normalizeTransportReferences(transportType, values = {}) {
    return commercialUtils?.normalizeTransportReferences
      ? commercialUtils.normalizeTransportReferences(transportType, values)
      : { transportType: upper(transportType || "AEREO"), awb: text(values.awb), mawb: text(values.awb), hawb: text(values.hawb), airlineId: text(values.airlineId) };
  }

  function normalizeOrderTransportPayload(order = {}, options = {}) {
    if (commercialUtils?.normalizeOrderTransportPayload) {
      return commercialUtils.normalizeOrderTransportPayload(order, options);
    }
    const normalized = { ...order };
    const references = normalizeTransportReferences(order.transportType, order);
    normalized.transportType = references.transportType === "MARITIMO" ? "maritimo" : references.transportType === "TERRESTRE" ? "terrestre" : "aereo";
    normalized.awb = references.awb;
    normalized.hawb = references.hawb;
    normalized.airlineId = references.transportType === "AEREO" ? references.airlineId : "";
    return normalized;
  }

  function normalizeMotherGuide(value, transportType = "aereo", options = {}) {
    if (commercialUtils?.normalizeMaritimeMotherGuide
      && upper(commercialUtils.normalizeTransportType?.(transportType) || transportType) === "MARITIMO") {
      return commercialUtils.normalizeMaritimeMotherGuide(value, { ensurePrefix: options.ensureMaritimePrefix === true });
    }
    return normalizeTransportReferences(transportType, { awb: value }).awb;
  }

  function normalizeCoordinationValue(field, value, transportType = "aereo") {
    if (field === "awb") return normalizeMotherGuide(value, transportType);
    if (field === "hawb") return normalizeTransportReferences(transportType, { hawb: value }).hawb;
    return text(value);
  }

  function airlineForGuide(appState, value, transportType = "aereo") {
    if (upper(commercialUtils?.normalizeTransportType?.(transportType) || transportType) !== "AEREO") return null;
    const prefix = guideDigits(value).slice(0, 3);
    if (prefix.length !== 3) return null;
    return catalogs(appState).airlines.find(row => String(row.awbPrefix || "").padStart(3, "0") === prefix) || null;
  }

  function isLocalCustomer(customer) {
    return upper(customer?.category) === "LOCAL";
  }

  function isLocalOrder(order, appState) {
    const declared = upper(order?.saleType || order?.sale_type || order?.commercialType);
    if (["LOCAL", "VENTA LOCAL", "VENTA_LOCAL"].includes(declared)) return true;
    if (["EXPORTACION", "EXPORTACIÓN", "EXPORT"].includes(declared)) return false;
    return isLocalCustomer(customerFor(appState, order?.customerId));
  }

  function deriveCoordinationStatus(order, appState) {
    if (isLocalOrder(order, appState)) return "NO_APLICA";
    const transport = upper(commercialUtils?.normalizeTransportType?.(order?.transportType) || order?.transportType || "AEREO");
    const references = normalizeTransportReferences(transport, order || {});
    if (transport === "AEREO") {
      return guideDigits(references.awb).length === 11 && Boolean(references.hawb) ? "COORDINADA" : "PENDIENTE";
    }
    if (transport === "MARITIMO") {
      return Boolean(references.awb && references.hawb) ? "COORDINADA" : "PENDIENTE";
    }
    return "PENDIENTE";
  }

  function salesRepresentatives(appState) {
    return sessionFor(appState).salesRepresentatives || [];
  }

  function salesRepresentativeFor(appState, sellerId) {
    return salesRepresentatives(appState).find(row => String(row.sellerId || row.employeeId) === String(sellerId || "")) || null;
  }

  function assignSalesRepresentative(draft, seller) {
    if (!draft || !seller) return false;
    const employeeId = text(seller.employeeId || seller.employee_id);
    const sellerId = text(seller.sellerId || seller.seller_id || employeeId);
    const sellerName = text(seller.fullName || seller.full_name || seller.name);
    if (!employeeId || !sellerId || !sellerName) return false;
    draft.seller_id = sellerId;
    draft.sellerId = sellerId;
    draft.vendedorId = sellerId;
    draft.seller_employee_id = employeeId;
    draft.sellerEmployeeId = employeeId;
    draft.seller_name = sellerName;
    draft.sellerName = sellerName;
    draft.vendedorNombre = sellerName;
    return true;
  }

  function canAssignSalesRepresentative(appState) {
    const access = BlessERP.authAccess?.activeAccess?.();
    if (!access?.session?.user?.id) return true;
    return Boolean(
      BlessERP.capabilityRuntime?.can?.("commercial.orders.create")
      || BlessERP.capabilityRuntime?.can?.("commercial.orders.edit")
    );
  }

  async function loadSalesRepresentatives(appState, options = {}) {
    const session = sessionFor(appState);
    if (session.salesRepresentativesLoading) return { ok: true, pending: true, rows: salesRepresentatives(appState) };
    if (session.salesRepresentativesLoaded && !options.force) return { ok: true, cached: true, rows: salesRepresentatives(appState) };
    const repository = remoteOrderRepository();
    if (!repository?.listSalesRepresentatives) return { ok: false, error: "El catálogo Employee V2 de vendedores no está disponible." };
    session.salesRepresentativesLoading = true;
    const response = await repository.listSalesRepresentatives();
    session.salesRepresentativesLoading = false;
    if (!response?.ok) return { ok: false, error: response?.message || "No se pudieron consultar los vendedores Employee V2." };
    session.salesRepresentatives = response.rows || [];
    session.salesRepresentativesLoaded = true;
    const draft = session.draft;
    if (draft?.unsavedDraft && !text(draft.seller_id || draft.sellerId)) {
      const userId = currentUser(appState).id;
      const matches = session.salesRepresentatives.filter(row => text(row.userId || row.user_id) === userId);
      if (matches.length === 1) assignSalesRepresentative(draft, matches[0]);
    }
    return { ok: true, rows: salesRepresentatives(appState) };
  }

  function orderUsesInventory(order) {
    const mode = upper(order?.inventoryMode || order?.stockMode);
    if (["NO_INVENTORY", "SIN_INVENTARIO", "EXTERNAL_PURCHASE"].includes(mode)) return false;
    if (["WITH_INVENTORY", "CON_INVENTARIO"].includes(mode)) return true;
    if (typeof order?.affectsInventory === "boolean") return order.affectsInventory;
    return !/IMPERIO/i.test(text(order?.sellingCompanyId || order?.companyId || order?.company_id));
  }

  function blankDraft(appState, seed = {}) {
    const companyId = activeCompanyId(appState);
    const inventoryMode = seed.inventoryMode || (/IMPERIO/i.test(companyId) ? "NO_INVENTORY" : "WITH_INVENTORY");
    const created = data.createOrder({
      ...seed,
      id: seed.id || BlessERP.utils.uid("COM-DRAFT"),
      number: "",
      numberPending: true,
      unsavedDraft: true,
      status: "BORRADOR_LOCAL",
      sellingCompanyId: companyId,
      companyId,
      issuedAt: seed.issuedAt || today(),
      flightDate: seed.flightDate || today(),
      sriInvoiceNumber: "",
      sriSequential: "",
      packingListNumber: "",
      invoicePackingNumber: "",
      clientInvoiceNumber: "",
      inventoryMode,
      affectsInventory: inventoryMode !== "NO_INVENTORY",
      lines: Array.isArray(seed.lines) ? seed.lines : []
    });
    Object.assign(created, normalizeOrderTransportPayload(created, { ensureMaritimePrefix: true }));
    created.flowVersion = 2;
    created.persistenceMode = "FORM_MEMORY_ONLY";
    if (!text(created.seller_id || created.sellerId)) {
      const userId = currentUser(appState).id;
      const matches = salesRepresentatives(appState).filter(row => text(row.userId || row.user_id) === userId);
      if (matches.length === 1) assignSalesRepresentative(created, matches[0]);
    }
    return created;
  }

  function newDraft(appState, seed = {}) {
    const session = sessionFor(appState);
    session.mode = "NEW";
    session.selectedOrderId = "";
    session.draft = blankDraft(appState, seed);
    session.boxDraft = boxBuilder.normalizeDraft?.({ mode: "RANGO", firstBox: 1, generalPo: session.draft.generalPo }) || {};
    return session.draft;
  }

  function getDraft(appState) {
    const session = sessionFor(appState);
    if (!session.draft) return newDraft(appState);
    return session.draft;
  }

  function findOrder(appState, orderId) {
    return ensureDomain(appState).commercial.orders.find(row => String(row.id) === String(orderId)) || null;
  }

  function openOrder(appState, orderId) {
    const order = findOrder(appState, orderId);
    if (!order) return { ok: false, error: "El pedido no existe en la base local." };
    const session = sessionFor(appState);
    session.mode = "EDIT";
    session.selectedOrderId = order.id;
    session.draft = data.createOrder(normalizeOrderTransportPayload(clone(order), { ensureMaritimePrefix: true }));
    session.draft.unsavedDraft = false;
    session.draft.numberPending = false;
    session.draft.persistenceMode = "FORM_MEMORY_ONLY";
    session.boxDraft = boxBuilder.normalizeDraft?.({
      mode: "RANGO",
      firstBox: Math.max(0, ...(session.draft.lines || []).map(line => Number(line.boxNumber || 0))) + 1,
      generalPo: session.draft.generalPo
    }) || {};
    return { ok: true, order: session.draft };
  }

  function updateDraftField(appState, field, value) {
    const draft = getDraft(appState);
    if (!draft || IMMUTABLE_SRI_STATES.has(upper(draft.sriAuthorizationStatus))) return false;
    if (["sellerId", "seller_id"].includes(field)) {
      if (!draft.unsavedDraft || !canAssignSalesRepresentative(appState)) return false;
      const seller = salesRepresentativeFor(appState, value);
      return seller ? assignSalesRepresentative(draft, seller) : false;
    }
    const previousTransportType = draft.transportType;
    const numericFields = new Set(["creditDays"]);
    draft[field] = numericFields.has(field) ? number(value) : value;
    if (field === "inventoryMode") {
      draft.inventoryMode = upper(value) === "NO_INVENTORY" ? "NO_INVENTORY" : "WITH_INVENTORY";
      draft.affectsInventory = draft.inventoryMode === "WITH_INVENTORY";
    }
    if (field === "awb") {
      const transport = draft.transportType || "aereo";
      draft.awb = normalizeMotherGuide(value, transport, { ensureMaritimePrefix: true });
      const digits = guideDigits(value);
      const airline = airlineForGuide(appState, value, transport);
      if (airline) draft.airlineId = airline.id;
      else if (upper(commercialUtils?.normalizeTransportType?.(transport) || transport) !== "AEREO" || digits.length >= 3) draft.airlineId = "";
    }
    if (field === "hawb") {
      draft.hawb = normalizeCoordinationValue("hawb", value, draft.transportType);
    }
    if (field === "transportType") {
      Object.assign(draft, normalizeOrderTransportPayload(draft, {
        previousTransportType,
        ensureMaritimePrefix: true
      }));
    }
    if (field === "customerId") {
      const customer = customerFor(appState, value);
      draft.saleType = isLocalCustomer(customer) ? "LOCAL" : "EXPORTACION";
      if (isLocalCustomer(customer)) {
        draft.brandId = "";
        draft.destination = "ECUADOR";
        draft.destinationCountry = "ECUADOR";
        draft.coldRoom = "RETIRA EN FINCA";
        draft.localPickup = true;
        draft.daeNumber = "";
        draft.agencyId = "";
      }
    }
    if (field === "brandId") {
      const brand = brandFor(appState, value);
      if (brand) {
        draft.destination = brand.destination || brand.country || draft.destination;
        draft.destinationCountry = brand.country || draft.destinationCountry;
        draft.agencyId = brand.defaultAgencyId || draft.agencyId;
        if (brand.defaultAgencyId) selectAgencyLogistics(draft, agencyFor(appState, brand.defaultAgencyId));
        const matchingDaes = catalogs(appState).daes.filter(row => upper(row.country || row.destination) === upper(draft.destinationCountry));
        const defaultDae = matchingDaes.find(row => row.isDefault) || matchingDaes[0];
        if (defaultDae && !draft.daeModifiedManual) draft.daeNumber = defaultDae.number;
      }
    }
    if (field === "agencyId") selectAgencyLogistics(draft, agencyFor(appState, value));
    if (field === "coldRoom") {
      draft.coldRoomModifiedManual = true;
      draft.coldRoomSourceAgencyId = "";
    }
    if (field === "saleType" && upper(value) === "LOCAL") {
      draft.destination = "ECUADOR";
      draft.destinationCountry = "ECUADOR";
      draft.coldRoom = "RETIRA EN FINCA";
      draft.daeNumber = "";
      draft.agencyId = "";
    }
    draft.formDirty = true;
    return true;
  }

  function getBoxDraft(appState) {
    return sessionFor(appState).boxDraft;
  }

  function setBoxMode(appState, mode) {
    const session = sessionFor(appState);
    session.boxDraft = boxBuilder.normalizeDraft?.({
      ...session.boxDraft,
      mode,
      firstBox: Math.max(0, ...(getDraft(appState).lines || []).map(line => Number(line.boxNumber || 0))) + 1,
      generalPo: getDraft(appState).generalPo
    }) || { ...session.boxDraft, mode };
    return session.boxDraft;
  }

  function updateBoxDraft(appState, field, value) {
    return boxBuilder.updateDraftField?.(getBoxDraft(appState), field, value) || false;
  }

  function updateManualBoxItem(appState, itemId, field, value) {
    return boxBuilder.updateManualItem?.(getBoxDraft(appState), itemId, field, value) || false;
  }

  function addManualBoxItem(appState) {
    return boxBuilder.addManualItem?.(getBoxDraft(appState));
  }

  function removeManualBoxItem(appState, itemId) {
    return boxBuilder.removeManualItem?.(getBoxDraft(appState), itemId) || false;
  }

  function addBoxes(appState) {
    const draft = getDraft(appState);
    const result = boxBuilder.buildLines?.(getBoxDraft(appState), {
      firstBox: Math.max(0, ...(draft.lines || []).map(line => Number(line.boxNumber || 0))) + 1,
      generalPo: draft.generalPo,
      revisionNumber: Number(draft.revisionNumber || 1)
    });
    if (!result?.ok) return result || { ok: false, errors: ["No se pudo generar la caja."] };
    draft.lines.push(...result.lines);
    draft.formDirty = true;
    setBoxMode(appState, result.mode);
    return { ok: true, lines: result.lines, boxNumbers: result.boxNumbers };
  }

  function linesForBox(order, boxNumber) {
    return (order?.lines || []).filter(line => Number(line.boxNumber) === Number(boxNumber));
  }

  function boxNumbers(order) {
    return [...new Set((order?.lines || []).map(line => Number(line.boxNumber)).filter(value => value > 0))].sort((a, b) => a - b);
  }

  function renumberBoxes(order) {
    const mapping = new Map(boxNumbers(order).map((oldNumber, index) => [oldNumber, index + 1]));
    (order.lines || []).forEach(line => { line.boxNumber = mapping.get(Number(line.boxNumber)) || 1; });
  }

  function deleteBox(appState, boxNumber) {
    const draft = getDraft(appState);
    const before = draft.lines.length;
    draft.lines = draft.lines.filter(line => Number(line.boxNumber) !== Number(boxNumber));
    renumberBoxes(draft);
    draft.formDirty = before !== draft.lines.length;
    return before !== draft.lines.length;
  }

  function duplicateBox(appState, boxNumber) {
    const draft = getDraft(appState);
    const source = linesForBox(draft, boxNumber);
    if (!source.length) return false;
    const next = Math.max(0, ...boxNumbers(draft)) + 1;
    source.forEach(line => draft.lines.push(data.createLine({
      ...clone(line),
      id: BlessERP.utils.uid("COM-LIN"),
      boxNumber: next,
      scannedBunches: [],
      mixedActualComposition: [],
      fulfillmentStatus: "PENDIENTE"
    })));
    draft.formDirty = true;
    return true;
  }

  function addItemToBox(appState, boxNumber) {
    const draft = getDraft(appState);
    const base = linesForBox(draft, boxNumber)[0];
    if (!base) return false;
    draft.lines.push(data.createLine({
      boxNumber,
      boxType: base.boxType,
      boxBuildMode: "MIXTO_MANUAL",
      variety: "",
      length: base.length || 60,
      bunches: 1,
      stemsPerBunch: 25,
      unitPrice: base.unitPrice || 0,
      po: base.po || draft.generalPo
    }));
    draft.formDirty = true;
    return true;
  }

  function updateLine(appState, lineId, field, value) {
    const draft = getDraft(appState);
    const line = draft.lines.find(row => String(row.id) === String(lineId));
    if (!line) return false;
    if (["boxNumber", "length", "bunches", "stemsPerBunch", "unitPrice"].includes(field)) line[field] = number(value);
    else line[field] = value;
    draft.formDirty = true;
    return true;
  }

  function deleteLine(appState, lineId) {
    const draft = getDraft(appState);
    const before = draft.lines.length;
    draft.lines = draft.lines.filter(row => String(row.id) !== String(lineId));
    draft.formDirty = before !== draft.lines.length;
    return before !== draft.lines.length;
  }

  function validateDraft(appState, draft = getDraft(appState)) {
    const errors = [];
    const customer = customerFor(appState, draft.customerId);
    if (!customer) errors.push("Seleccione el cliente principal.");
    if (!text(draft.issuedAt)) errors.push("Seleccione la fecha de emisión.");
    if (!(draft.lines || []).length) errors.push("Agregue al menos una caja al pedido.");
    (draft.lines || []).forEach((line, index) => {
      if (!text(line.variety)) errors.push(`Línea ${index + 1}: falta variedad.`);
      if (number(line.length) <= 0 || number(line.bunches) <= 0 || number(line.stemsPerBunch) <= 0) errors.push(`Línea ${index + 1}: medida, ramos y tallos deben ser mayores a cero.`);
      if (number(line.unitPrice) < 0) errors.push(`Línea ${index + 1}: el precio no puede ser negativo.`);
    });
    if (!orderUsesInventory(draft) && (draft.lines || []).some(line => Array.isArray(line.scannedBunches) && line.scannedBunches.length)) {
      errors.push("No se puede convertir en venta sin inventario porque ya existen ramos escaneados en Cuarto Frío.");
    }
    if (!isLocalOrder(draft, appState) && !draft.brandId) errors.push("Seleccione la marca o cliente final de exportación.");
    const transport = upper(commercialUtils?.normalizeTransportType?.(draft.transportType) || draft.transportType || "AEREO");
    if (transport === "MARITIMO") {
      if (!commercialUtils?.isMaritimeMotherGuide?.(draft.awb)) errors.push("La guía madre marítima debe comenzar con MAR- y contener una referencia.");
      if (text(draft.airlineId || draft.airline_id || draft.airline || draft.airlineName)) errors.push("Un pedido marítimo no puede conservar una línea aérea.");
    }
    if (transport === "AEREO" && commercialUtils?.isMaritimeMotherGuide?.(draft.awb)) {
      errors.push("Una guía MAR- no puede utilizarse en un pedido aéreo.");
    }
    if (draft.unsavedDraft && (!text(draft.seller_id || draft.sellerId) || !text(draft.sellerEmployeeId) || !text(draft.seller_name || draft.sellerName))) {
      errors.push("Seleccione el vendedor / Sales Representative del pedido.");
    }
    return { ok: !errors.length, errors };
  }

  function nextOrderNumber(orders, issueDate) {
    const year = String(issueDate || today()).slice(0, 4) || String(new Date().getFullYear());
    const matcher = new RegExp(`^PED-COM-${year}-(\\d+)$`);
    const last = (orders || []).reduce((max, order) => {
      const match = matcher.exec(text(order.number));
      return match ? Math.max(max, Number(match[1]) || 0) : max;
    }, 0);
    return `PED-COM-${year}-${String(last + 1).padStart(4, "0")}`;
  }

  function nextInvoice(appState, draft, existingOrder = null) {
    const db = ensureDomain(appState);
    if (existingOrder?.sriInvoiceNumber) return invoiceSequence.fullNumberParts(existingOrder.sriInvoiceNumber);
    const market = isLocalOrder(draft, appState) ? "LOCAL" : "EXPORTACION";
    const series = invoiceSequence.saleSeries(activeCompanyId(appState), market, draft.transportType);
    const configured = BlessERP.services?.adminConfig?.findSequenceByCode?.(series.code) || null;
    const key = `${activeCompanyId(appState)}:${series.establishment}:${series.emissionPoint}`;
    let highest = Math.max(number(configured?.currentNumber), number(db.commercial.sequenceLedger[key]));
    db.commercial.orders.forEach(order => {
      const parts = invoiceSequence.fullNumberParts(order.sriInvoiceNumber);
      if (parts?.establishment === series.establishment && parts?.emissionPoint === series.emissionPoint) highest = Math.max(highest, number(parts.sequence));
    });
    const sequence = String(highest + 1).padStart(9, "0");
    db.commercial.sequenceLedger[key] = Number(sequence);
    return { ...series, sequence };
  }

  function createAuditRow(appState, order, action, detail = "") {
    const user = currentUser(appState);
    return {
      id: BlessERP.utils.uid("COM-AUD"),
      orderId: order.id,
      orderNumber: order.number,
      action,
      detail,
      userId: user.id,
      userName: user.name,
      createdAt: nowIso()
    };
  }

  function audit(appState, order, action, detail = "") {
    const db = ensureDomain(appState);
    const row = createAuditRow(appState, order, action, detail);
    db.commercial.flowAudit.unshift(row);
    order.history = Array.isArray(order.history) ? order.history : [];
    order.history.unshift(row);
    return row;
  }

  function normalizeConfirmedOrder(appState, draft, existing = null, options = {}) {
    draft = normalizeOrderTransportPayload(draft, { ensureMaritimePrefix: true });
    const remoteIdentifiers = options.remoteIdentifiers === true && !existing?.sriInvoiceNumber;
    const confirmedId = existing?.id || draft.id || BlessERP.utils.uid("COM-ORD");
    const series = invoiceSequence.saleSeries(
      activeCompanyId(appState),
      isLocalOrder(draft, appState) ? "LOCAL" : "EXPORTACION",
      draft.transportType
    );
    const sequence = remoteIdentifiers
      ? { ...series, sequence: "000000000" }
      : nextInvoice(appState, draft, existing);
    const usesInventory = orderUsesInventory(draft);
    const created = data.createOrder({
      ...clone(draft),
      id: confirmedId,
      number: existing?.number || (remoteIdentifiers ? `PENDIENTE-${confirmedId}` : nextOrderNumber(ensureDomain(appState).commercial.orders, draft.issuedAt)),
      numberPending: false,
      unsavedDraft: false,
      status: usesInventory && existing?.status && existing.status !== "BORRADOR_LOCAL" ? existing.status : "GUARDADO",
      sriInvoiceNumber: existing?.sriInvoiceNumber || invoiceSequence.formatFullNumber(sequence.sequence, sequence.establishment, sequence.emissionPoint),
      sriSequential: existing?.sriSequential || sequence.sequence,
      packingListNumber: existing?.packingListNumber || sequence.sequence,
      invoicePackingNumber: existing?.invoicePackingNumber || sequence.sequence,
      clientInvoiceNumber: existing?.clientInvoiceNumber || sequence.sequence,
      establishmentCode: existing?.establishmentCode || sequence.establishment,
      emissionPointCode: existing?.emissionPointCode || sequence.emissionPoint,
      sriSeriesCode: existing?.sriSeriesCode || sequence.code,
      sriMarket: existing?.sriMarket || sequence.market,
      inventoryMode: usesInventory ? "WITH_INVENTORY" : "NO_INVENTORY",
      affectsInventory: usesInventory,
      warehouseEligible: usesInventory,
      availabilityCommitmentStatus: usesInventory ? "COMPROMETIDO" : "NO_APLICA",
      availabilityCommittedAt: usesInventory ? (existing?.availabilityCommittedAt || nowIso()) : "",
      warehouseStatus: usesInventory ? (existing?.warehouseStatus || "NO_ENVIADO") : "NO_APLICA",
      fulfillmentStatus: usesInventory ? (existing?.fulfillmentStatus || "PENDIENTE") : "NO_APLICA",
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      version: Math.max(1, number(existing?.version) + 1),
      flowVersion: 2,
      persistenceMode: "CONFIRMED_ORDER"
    });
    created.formDirty = false;
    if (existing) {
      const operationalByLine = new Map((existing.lines || []).map(line => [String(line.id), line]));
      created.lines = (created.lines || []).map(line => {
        const operational = operationalByLine.get(String(line.id));
        if (!operational) return line;
        return {
          ...line,
          scannedBunches: clone(operational.scannedBunches || []),
          mixedActualComposition: clone(operational.mixedActualComposition || []),
          fulfillmentStatus: operational.fulfillmentStatus || line.fulfillmentStatus
        };
      });
      [
        "reservationStatus", "reservedBunches", "packedBunches", "requiredBunches",
        "warehouseStatus", "fulfillmentStatus", "warehouseReleasedAt", "warehouseCompletedAt",
        "warehouseFlowVersion", "dispatchStatus", "dispatchId", "dispatchCode",
        "readyForDispatchAt", "dispatchedAt", "shippedAt", "dispatchLogistics",
        "dispatchObservations", "dispatchFlowVersion"
      ].forEach(field => {
        if (existing[field] !== undefined) created[field] = clone(existing[field]);
      });
    }
    created.createdAt = existing?.createdAt || created.createdAt || nowIso();
    created.updatedAt = nowIso();
    created.version = Math.max(1, number(existing?.version) + 1);
    created.flowVersion = 2;
    created.persistenceMode = "CONFIRMED_ORDER";
    return created;
  }

  function remoteOrderRepository() {
    const repository = BlessERP.getCommercialOrderRepository?.();
    return repository?.canListPage?.() ? repository : null;
  }

  function warehouseRepository() {
    const repository = BlessERP.getWarehouseV2Repository?.();
    // La disponibilidad del backend se valida dentro de cada comando. Usar
    // solamente canExecute() aquí impedía ejecutar el primer health-check y
    // podía desviar la operación al flujo local antes de consultar Supabase.
    return repository?.configured?.() ? repository : null;
  }

  function destinationRepository() {
    const repository = BlessERP.getLocalDestinationV2Repository?.();
    return repository?.configured?.() ? repository : null;
  }

  function dispatchRepository() {
    const repository = BlessERP.getDispatchV2Repository?.();
    return repository?.canExecute?.() ? repository : null;
  }

  function exportShipmentRepository() {
    const repository = BlessERP.getExportShipmentV2Repository?.();
    return repository?.canExecute?.() ? repository : null;
  }

  function orderSeries(appState, order) {
    return invoiceSequence.saleSeries(
      activeCompanyId(appState),
      isLocalOrder(order, appState) ? "LOCAL" : "EXPORTACION",
      order.transportType
    );
  }

  function replaceConfirmedOrder(appState, order) {
    const db = ensureDomain(appState);
    const index = db.commercial.orders.findIndex(row => String(row.id) === String(order.id));
    if (index >= 0) db.commercial.orders[index] = order;
    else db.commercial.orders.unshift(order);
    // El registro ya fue confirmado por Supabase. Solo se actualiza la caché;
    // no se vuelve a capturar como una nueva escritura incremental.
    cacheSave(appState);
    return index;
  }

  function serverOrder(result, fallback) {
    const record = result?.serverRecord || {};
    const payload = record.payload && typeof record.payload === "object" ? record.payload : fallback;
    const order = data.createOrder({
      ...normalizeOrderTransportPayload(clone(payload), { ensureMaritimePrefix: true }),
      id: text(payload?.id || record.record_id || fallback?.id),
      __syncVersion: number(record.version || result?.resultVersion || payload?.__syncVersion),
      __syncUpdatedAt: text(record.updated_at || result?.serverTime || payload?.__syncUpdatedAt),
      __syncOperationId: text(record.last_operation_id || result?.operationId || payload?.__syncOperationId)
    });
    order.__syncVersion = number(record.version || result?.resultVersion || payload?.__syncVersion);
    order.__syncUpdatedAt = text(record.updated_at || result?.serverTime || payload?.__syncUpdatedAt);
    order.__syncOperationId = text(record.last_operation_id || result?.operationId || payload?.__syncOperationId);
    return order;
  }

  async function persistOrderRemotely(appState, order, baseOrder = null) {
    const repository = remoteOrderRepository();
    if (!repository) {
      if (requiresConfirmedRemoteOrder()) {
        return {
          ok: false,
          mode: "REMOTE_REQUIRED",
          error: "No fue posible conectar el pedido con Supabase. El cambio no se guardó como confirmado."
        };
      }
      return { ok: true, mode: "LOCAL_ONLY", order };
    }
    const result = await repository.saveConfirmedOrder(order, orderSeries(appState, order), {
      basePayload: baseOrder || {},
      baseVersion: number(baseOrder?.__syncVersion || baseOrder?.version)
    });
    if (!result.ok) {
      return {
        ok: false,
        mode: result.mode || "SUPABASE_ERROR",
        error: result.message || result.error?.message || "Supabase no confirmó el pedido."
      };
    }
    return { ok: true, mode: result.mode, order: serverOrder(result, order), result };
  }

  async function persistOrderMutation(appState, orderId, options = {}) {
    return serializeOrderMutation(orderId, async () => {
      let current = findOrder(appState, orderId);
      if (!current) return { ok: false, error: "Pedido no encontrado." };
      const repository = remoteOrderRepository();
      if (requiresConfirmedRemoteOrder() && repository?.getFullOrder) {
        const canonical = await repository.getFullOrder(orderId);
        if (!canonical.ok) {
          return { ok: false, mode: canonical.mode || "SUPABASE_ERROR", error: canonical.message || "No fue posible verificar la versión canónica del pedido." };
        }
        current = canonical.order;
        replaceConfirmedOrder(appState, current);
      }
      if (IMMUTABLE_SRI_STATES.has(upper(current.sriAuthorizationStatus)) && options.allowImmutableSri !== true) {
        return { ok: false, error: "El comprobante SRI ya no admite cambios directos." };
      }

      const updated = clone(current);
      const prepared = typeof options.mutate === "function" ? await options.mutate(updated, clone(current)) : { ok: true };
      if (prepared?.ok === false) return prepared;
      updated.updatedAt = nowIso();
      updated.version = Math.max(1, number(current.version) + 1);
      const auditRow = createAuditRow(appState, updated, options.action || "ACTUALIZAR_PEDIDO", options.detail || "Pedido actualizado.");
      updated.history = Array.isArray(updated.history) ? updated.history : [];
      updated.history.unshift(auditRow);

      const persisted = await persistOrderRemotely(appState, updated, clone(current));
      if (!persisted.ok) return persisted;
      if (typeof options.verifyCanonical === "function") {
        const verification = options.verifyCanonical(persisted.order, prepared);
        if (verification?.ok === false) {
          // Aunque el servidor haya conservado otra versión, esa versión
          // canónica debe reemplazar inmediatamente la caché de este equipo.
          replaceConfirmedOrder(appState, persisted.order);
          return { ...verification, order: persisted.order, confirmedByServer: true };
        }
      }

      ensureDomain(appState).commercial.flowAudit.unshift(auditRow);
      replaceConfirmedOrder(appState, persisted.order);
      if (typeof options.commitLocalSideEffects === "function") {
        options.commitLocalSideEffects(persisted.order, prepared);
        localSave(appState);
      }
      return {
        ok: true,
        ...prepared,
        order: persisted.order,
        confirmedByServer: persisted.mode !== "LOCAL_ONLY",
        localOnly: persisted.mode === "LOCAL_ONLY",
        operationId: persisted.result?.operationId || "",
        mergeSummary: persisted.result?.mergeSummary || {},
        discardedFields: persisted.result?.discardedFields || []
      };
    });
  }

  async function saveOrderConfirmed(appState) {
    const db = ensureDomain(appState);
    const draft = getDraft(appState);
    Object.assign(draft, normalizeOrderTransportPayload(draft, { ensureMaritimePrefix: true }));
    const validation = validateDraft(appState, draft);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    const session = sessionFor(appState);
    const existing = session.mode === "EDIT" ? findOrder(appState, session.selectedOrderId) : null;
    if (existing && IMMUTABLE_SRI_STATES.has(upper(existing.sriAuthorizationStatus))) {
      return { ok: false, errors: ["El comprobante está autorizado o anulado en SRI y no admite cambios directos."] };
    }
    if (existing && upper(existing.dispatchStatus || existing.status) === "DISPATCHED") {
      return { ok: false, errors: ["El pedido ya fue despachado físicamente y no admite edición ordinaria."] };
    }
    if (!remoteOrderRepository()) {
      if (requiresConfirmedRemoteOrder()) {
        return { ok: false, errors: ["Supabase no está disponible para confirmar el pedido. No se realizó un guardado local sustituto."] };
      }
      return saveOrder(appState);
    }

    const confirmed = normalizeConfirmedOrder(appState, draft, existing, { remoteIdentifiers: true });
    confirmed.history = Array.isArray(confirmed.history) ? confirmed.history : [];
    confirmed.history.unshift({
      id: BlessERP.utils.uid("COM-AUD"),
      orderId: confirmed.id,
      orderNumber: confirmed.number,
      action: existing ? "ACTUALIZAR_PEDIDO" : "GUARDAR_PEDIDO",
      detail: "Pedido enviado como una sola operación transaccional a Supabase.",
      userId: currentUser(appState).id,
      userName: currentUser(appState).name,
      createdAt: nowIso()
    });
    const persisted = await persistOrderRemotely(appState, confirmed, existing ? clone(existing) : null);
    if (!persisted.ok) return { ok: false, errors: [persisted.error] };
    const index = replaceConfirmedOrder(appState, persisted.order);
    let reservation = null;
    if (orderUsesInventory(persisted.order) && warehouseRepository()) {
      reservation = await warehouseRepository().reserveOrder(persisted.order.id, { allowPartial: true });
      if (reservation.ok) {
        persisted.order = findOrder(appState, persisted.order.id) || persisted.order;
      }
    }
    session.mode = "EDIT";
    session.selectedOrderId = persisted.order.id;
    session.draft = data.createOrder(clone(persisted.order));
    session.draft.persistenceMode = "FORM_MEMORY_ONLY";
    return {
      ok: true,
      order: persisted.order,
      created: index < 0,
      confirmedByServer: true,
      reservationConfirmed: !orderUsesInventory(persisted.order) || reservation?.ok === true,
      reservationStatus: reservation?.result?.status || (orderUsesInventory(persisted.order) ? "PENDING" : "NOT_APPLICABLE"),
      reservationError: reservation && !reservation.ok ? reservation.message : ""
    };
  }

  function saveOrder(appState) {
    const db = ensureDomain(appState);
    const draft = getDraft(appState);
    Object.assign(draft, normalizeOrderTransportPayload(draft, { ensureMaritimePrefix: true }));
    const validation = validateDraft(appState, draft);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    const existing = sessionFor(appState).mode === "EDIT" ? findOrder(appState, sessionFor(appState).selectedOrderId) : null;
    if (existing && IMMUTABLE_SRI_STATES.has(upper(existing.sriAuthorizationStatus))) {
      return { ok: false, errors: ["El comprobante está autorizado o anulado en SRI y no admite cambios directos."] };
    }
    if (existing && upper(existing.dispatchStatus || existing.status) === "DISPATCHED") {
      return { ok: false, errors: ["El pedido ya fue despachado físicamente y no admite edición ordinaria."] };
    }
    const confirmed = normalizeConfirmedOrder(appState, draft, existing);
    audit(appState, confirmed, existing ? "ACTUALIZAR_PEDIDO" : "GUARDAR_PEDIDO", "Pedido confirmado en una sola operación local.");
    const index = db.commercial.orders.findIndex(row => String(row.id) === String(confirmed.id));
    if (index >= 0) db.commercial.orders[index] = confirmed;
    else db.commercial.orders.unshift(confirmed);
    localSave(appState);
    const session = sessionFor(appState);
    session.mode = "EDIT";
    session.selectedOrderId = confirmed.id;
    session.draft = data.createOrder(clone(confirmed));
    session.draft.persistenceMode = "FORM_MEMORY_ONLY";
    return { ok: true, order: confirmed, created: index < 0 };
  }

  function sendToColdRoom(appState) {
    const session = sessionFor(appState);
    if (session.mode !== "EDIT" || !session.selectedOrderId) return { ok: false, error: "Guarde primero el pedido." };
    const current = findOrder(appState, session.selectedOrderId);
    if (!current) return { ok: false, error: "El pedido guardado no existe." };
    if (!orderUsesInventory(current)) return { ok: false, error: "La venta sin inventario no utiliza Cuarto Frío." };
    if (!current.lines?.length) return { ok: false, error: "El pedido no tiene cajas." };
    if (IMMUTABLE_SRI_STATES.has(upper(current.sriAuthorizationStatus))) return { ok: false, error: "El comprobante SRI ya no admite cambios." };
    current.status = "EN_CUARTO_FRIO";
    current.warehouseStatus = "EN_CUARTO_FRIO";
    current.fulfillmentStatus = "PENDIENTE";
    current.warehouseReleasedAt = nowIso();
    current.updatedAt = nowIso();
    current.version = Math.max(1, number(current.version) + 1);
    audit(appState, current, "ENVIAR_CUARTO_FRIO", "Pedido disponible para preparación en Cuarto Frío.");
    localSave(appState);
    newDraft(appState);
    return { ok: true, order: current };
  }

  async function sendToColdRoomConfirmed(appState) {
    if (!remoteOrderRepository()) {
      if (requiresConfirmedRemoteOrder()) {
        return { ok: false, error: "Supabase no está disponible para confirmar el envío a Cuarto Frío." };
      }
      return sendToColdRoom(appState);
    }
    const session = sessionFor(appState);
    if (session.mode !== "EDIT" || !session.selectedOrderId) return { ok: false, error: "Guarde primero el pedido." };
    const current = findOrder(appState, session.selectedOrderId);
    if (!current) return { ok: false, error: "El pedido guardado no existe." };
    if (!orderUsesInventory(current)) return { ok: false, error: "La venta sin inventario no utiliza Cuarto Frío." };
    if (!current.lines?.length) return { ok: false, error: "El pedido no tiene cajas." };
    if (IMMUTABLE_SRI_STATES.has(upper(current.sriAuthorizationStatus))) return { ok: false, error: "El comprobante SRI ya no admite cambios." };
    const updated = clone(current);
    updated.status = "EN_CUARTO_FRIO";
    updated.warehouseStatus = "EN_CUARTO_FRIO";
    updated.fulfillmentStatus = "PENDIENTE";
    updated.warehouseReleasedAt = nowIso();
    updated.updatedAt = nowIso();
    updated.version = Math.max(1, number(updated.version) + 1);
    updated.history = Array.isArray(updated.history) ? updated.history : [];
    updated.history.unshift({
      id: BlessERP.utils.uid("COM-AUD"), orderId: updated.id, orderNumber: updated.number,
      action: "ENVIAR_CUARTO_FRIO", detail: "Pedido disponible para preparación en Cuarto Frío.",
      userId: currentUser(appState).id, userName: currentUser(appState).name, createdAt: nowIso()
    });
    const persisted = await persistOrderRemotely(appState, updated, clone(current));
    if (!persisted.ok) return persisted;
    replaceConfirmedOrder(appState, persisted.order);
    let reservation = null;
    if (warehouseRepository()) {
      reservation = await warehouseRepository().reserveOrder(persisted.order.id, { allowPartial: true });
      if (!reservation.ok) {
        return {
          ok: false,
          error: `El pedido quedó guardado, pero Cuarto Frío no pudo confirmar su reserva: ${reservation.message}`,
          order: findOrder(appState, persisted.order.id) || persisted.order,
          reservationPending: true
        };
      }
      persisted.order = findOrder(appState, persisted.order.id) || persisted.order;
    }
    newDraft(appState);
    return { ok: true, order: persisted.order, confirmedByServer: true, reservationConfirmed: reservation?.ok !== false };
  }

  async function annulOrder(appState, orderId, reason) {
    const normalizedReason = text(reason);
    if (!normalizedReason) return { ok: false, error: "Ingrese el motivo de anulación." };
    const current = findOrder(appState, orderId);
    if (current && upper(current.dispatchStatus || current.status) === "DISPATCHED") {
      return { ok: false, error: "El pedido ya fue despachado. No puede anularse mediante el flujo ordinario." };
    }
    if (current && orderUsesInventory(current) && warehouseRepository()) {
      const result = await warehouseRepository().cancelOrder(orderId, normalizedReason);
      if (!result.ok) return { ok: false, error: result.message || "Supabase no confirmó la anulación y liberación." };
      return {
        ok: true,
        order: findOrder(appState, orderId),
        confirmedByServer: true,
        releaseStatus: result.result?.status || "RELEASED",
        reviewRequiredBunches: number(result.result?.reviewRequiredBunches)
      };
    }
    return persistOrderMutation(appState, orderId, {
      action: "ANULAR_PEDIDO",
      detail: normalizedReason,
      mutate(order) {
        if (upper(order.sriAuthorizationStatus) === "AUTORIZADO") {
          return { ok: false, error: "El pedido tiene una factura SRI autorizada; utilice el proceso tributario correspondiente." };
        }
        order.status = "ANULADO";
        order.warehouseStatus = "ANULADO";
        order.availabilityCommitmentStatus = orderUsesInventory(order) ? "LIBERADO" : "NO_APLICA";
        order.availabilityReleasedAt = orderUsesInventory(order) ? nowIso() : "";
        order.annulReason = normalizedReason;
        return { ok: true };
      }
    });
  }

  function activeOrders(appState) {
    return ensureDomain(appState).commercial.orders.filter(order => orderUsesInventory(order) && ACTIVE_ORDER_STATES.has(upper(order.status)));
  }

  function keyOf(variety, length, quality = "EXPORTACION") {
    return `${upper(variety)}|${number(length)}|${upper(quality || "EXPORTACION")}`;
  }

  function requestedBunches(line) {
    return Math.max(0, number(line?.bunches));
  }

  function scannedBunches(line) {
    return Array.isArray(line?.scannedBunches) ? line.scannedBunches.length : 0;
  }

  function groupOrderBoxes(order) {
    return boxNumbers(order).map(boxNumber => ({ boxNumber, lines: linesForBox(order, boxNumber) }));
  }

  function buildOrderFulfillment(order) {
    if (!order) return null;
    const boxRegistry = (BlessERP.state?.state?.db?.operations?.orderBoxes || [])
      .filter(box => String(box.orderId || "") === String(order.id));
    const boxes = groupOrderBoxes(order).map(box => {
      const registry = boxRegistry.find(item => number(item.boxNumber) === number(box.boxNumber)) || null;
      const required = box.lines.reduce((sum, line) => sum + requestedBunches(line), 0);
      const scanned = box.lines.reduce((sum, line) => sum + scannedBunches(line), 0);
      const details = box.lines.map(line => ({
        lineId: line.id,
        variety: line.variety,
        length: number(line.length),
        requiredBunches: requestedBunches(line),
        scannedBunches: scannedBunches(line),
        pendingBunches: Math.max(requestedBunches(line) - scannedBunches(line), 0),
        composition: clone(line.mixedActualComposition || []),
        scans: clone(line.scannedBunches || [])
      }));
      return {
        boxNumber: box.boxNumber,
        boxId: registry?.boxId || registry?.id || "",
        boxCode: registry?.boxCode || "",
        boxStatus: upper(registry?.status || (required > 0 && scanned >= required ? "CLOSED" : "OPEN")),
        boxType: box.lines[0]?.boxType || "",
        requiredBunches: required,
        scannedBunches: scanned,
        pendingBunches: Math.max(required - scanned, 0),
        automaticComplete: required > 0 && scanned >= required,
        status: required > 0 && scanned >= required ? "COMPLETA" : (scanned > 0 ? "INCOMPLETA" : "PENDIENTE"),
        lines: details
      };
    });
    const required = boxes.reduce((sum, box) => sum + box.requiredBunches, 0);
    const scanned = boxes.reduce((sum, box) => sum + box.scannedBunches, 0);
    return {
      order,
      boxes,
      requiredBunches: required,
      scannedBunches: scanned,
      pendingBunches: Math.max(required - scanned, 0),
      allBoxesComplete: boxes.length > 0 && boxes.every(box => box.automaticComplete),
      status: boxes.length > 0 && boxes.every(box => box.automaticComplete) ? "COMPLETADO" : (scanned > 0 ? "INCOMPLETO" : "PENDIENTE")
    };
  }

  function getOrderFulfillment(appState, orderId) {
    return buildOrderFulfillment(findOrder(appState, orderId));
  }

  function normalizeBunchBarcodeCode(value) {
    if (BlessERP.operacionesState?.normalizeBunchLabelCode) return BlessERP.operacionesState.normalizeBunchLabelCode(value);
    const digits = String(value || "").replace(/\D+/g, "");
    return digits.slice(-10).padStart(10, "0");
  }

  function inventoryForCode(appState, rawCode) {
    const code = normalizeBunchBarcodeCode(rawCode);
    return ensureDomain(appState).operations.roseInventory.find(row => String(row.labelCode) === code) || null;
  }

  function appendScan(line, inventory, order, boxNumber) {
    line.scannedBunches = Array.isArray(line.scannedBunches) ? line.scannedBunches : [];
    if (line.scannedBunches.some(scan => String(scan.code || scan.labelCode) === String(inventory.labelCode))) return false;
    line.scannedBunches.push({
      code: inventory.labelCode,
      labelCode: inventory.labelCode,
      inventoryId: inventory.inventoryId,
      variety: inventory.variety,
      length: number(inventory.length),
      stems: number(inventory.stems || inventory.stemsPerBunch),
      scannedAt: nowIso()
    });
    inventory.previousState = inventory.state;
    inventory.state = "ASIGNADO_CAJA";
    inventory.orderId = order.id;
    inventory.orderNumber = order.number;
    inventory.boxNumber = Number(boxNumber);
    inventory.assignedAt = nowIso();
    return true;
  }

  function compatibleLine(line, inventory) {
    const openMixed = upper(line.boxBuildMode) === "MIXTO_ABIERTO" || upper(line.variety) === "MIXTO ABIERTO";
    if (openMixed) {
      const excluded = new Set((line.mixedExcludedVarieties || []).map(upper));
      return !excluded.has(upper(inventory.variety)) && (line.anyLength || number(line.length) === number(inventory.length));
    }
    return upper(line.variety) === upper(inventory.variety) && (line.anyLength || number(line.length) === number(inventory.length));
  }

  function orderContainsScan(order, code) {
    return (order?.lines || []).some(line => (line.scannedBunches || []).some(scan => (
      normalizeBunchBarcodeCode(scan.code || scan.labelCode) === normalizeBunchBarcodeCode(code)
    )));
  }

  async function scanBunchForOrder(appState, orderId, boxNumber, rawCode) {
    const normalizedCode = normalizeBunchBarcodeCode(rawCode);
    if (warehouseRepository()) {
      const current = findOrder(appState, orderId);
      if (!current) return { ok: false, error: "Pedido no encontrado." };
      if (!orderUsesInventory(current)) return { ok: false, error: "La venta sin inventario no requiere escaneo en Cuarto Frío." };
      const inventory = inventoryForCode(appState, normalizedCode);
      if (!inventory) return { ok: false, error: "El código no corresponde a un ramo ingresado al inventario por escaneo." };
      const requestedBox = number(boxNumber);
      const targetBox = requestedBox > 0
        ? groupOrderBoxes(current).find(box => number(box.boxNumber) === requestedBox)
        : groupOrderBoxes(current).find(box => box.lines.some(line => scannedBunches(line) < requestedBunches(line) && compatibleLine(line, inventory)));
      if (!targetBox) return { ok: false, error: "La variedad o medida no corresponde a ninguna caja pendiente de este pedido." };
      const result = await warehouseRepository().scanIntoBox(orderId, targetBox.boxNumber, normalizedCode);
      if (!result.ok) return { ok: false, error: result.message || "Supabase rechazó el escaneo." };
      const canonicalOrder = findOrder(appState, orderId);
      const summary = buildOrderFulfillment(canonicalOrder);
      return {
        ok: true,
        order: canonicalOrder,
        summary,
        assignedBoxNumber: number(result.result?.boxNumber || targetBox.boxNumber),
        status: result.result?.status || "PACKED",
        alreadyPacked: result.result?.status === "ALREADY_PACKED",
        confirmedByServer: true
      };
    }
    return persistOrderMutation(appState, orderId, {
      action: "ESCANEAR_RAMO_CUARTO_FRIO",
      detail: `${normalizedCode} asignado en Cuarto Frío.`,
      mutate(order) {
        if (!orderUsesInventory(order)) return { ok: false, error: "La venta sin inventario no requiere escaneo en Cuarto Frío." };
        if (isLocalOrder(order, appState)) return { ok: false, error: "Los pedidos locales se confirman desde su bolsa por empresa; no requieren reescanear la etiqueta Bless." };
        const inventory = inventoryForCode(appState, normalizedCode);
        if (!inventory) return { ok: false, error: "El código no corresponde a un ramo ingresado al inventario por escaneo." };
        if (upper(inventory.state) !== "DISPONIBLE") {
          return {
            ok: false,
            error: upper(inventory.state) === "ASIGNADO_LOCAL"
              ? `El ramo está reservado para ${inventory.localDestinationName || "un cliente local"}.`
              : `El ramo está ${inventory.state || "no disponible"}.`
          };
        }
        const inventoryPatch = clone(inventory);
        const requestedBox = number(boxNumber);
        const targetBox = requestedBox > 0
          ? groupOrderBoxes(order).find(box => number(box.boxNumber) === requestedBox)
          : groupOrderBoxes(order).find(box => box.lines.some(line => scannedBunches(line) < requestedBunches(line) && compatibleLine(line, inventoryPatch)));
        if (!targetBox) return { ok: false, error: "La variedad o medida no corresponde a ninguna caja pendiente de este pedido." };
        const line = targetBox.lines.find(row => scannedBunches(row) < requestedBunches(row) && compatibleLine(row, inventoryPatch));
        if (!line) return { ok: false, error: "La variedad o medida no corresponde a lo pendiente en esta caja." };
        if (!appendScan(line, inventoryPatch, order, targetBox.boxNumber)) return { ok: false, error: "La etiqueta ya fue escaneada en este pedido." };
        if (upper(line.boxBuildMode) === "MIXTO_ABIERTO") {
          line.mixedActualComposition = Array.isArray(line.mixedActualComposition) ? line.mixedActualComposition : [];
          line.mixedActualComposition.push({ variety: inventoryPatch.variety, length: number(inventoryPatch.length), bunches: 1, stems: number(inventoryPatch.stems || inventoryPatch.stemsPerBunch), code: inventoryPatch.labelCode });
        }
        const summary = buildOrderFulfillment(order);
        order.fulfillmentStatus = summary.allBoxesComplete ? "COMPLETADO" : "INCOMPLETO";
        order.warehouseStatus = summary.allBoxesComplete ? "COMPLETADO" : "EN_PROCESO";
        if (summary.allBoxesComplete) {
          order.status = "COMPLETADO";
          order.warehouseCompletedAt = order.warehouseCompletedAt || nowIso();
          order.confirmedAutomatically = true;
        }
        return { ok: true, inventoryPatch, assignedBoxNumber: targetBox.boxNumber, summary };
      },
      verifyCanonical(order, prepared) {
        if (!orderContainsScan(order, normalizedCode)) {
          return { ok: false, error: "Supabase conservó una versión más reciente del pedido. El ramo no fue asignado; vuelva a escanearlo." };
        }
        prepared.summary = buildOrderFulfillment(order);
        prepared.line = (order.lines || []).find(line => (line.scannedBunches || []).some(scan => normalizeBunchBarcodeCode(scan.code || scan.labelCode) === normalizedCode)) || null;
        return { ok: true };
      },
      commitLocalSideEffects(order, prepared) {
        const inventory = inventoryForCode(appState, prepared.inventoryPatch?.labelCode);
        if (inventory) Object.assign(inventory, prepared.inventoryPatch);
      }
    });
  }

  async function scanBunchAutomatically(appState, orderId, rawCode) {
    return scanBunchForOrder(appState, orderId, 0, rawCode);
  }

  async function unassignBunchFromOrder(appState, orderId, labelCode, reason) {
    const repository = warehouseRepository();
    if (!repository) return { ok: false, error: "La desasignación V2 requiere conexión confirmada con Supabase." };
    const result = await repository.unassignBunch(orderId, labelCode, reason);
    if (!result.ok) return { ok: false, error: result.message || "Supabase no confirmó la desasignación." };
    return { ok: true, order: findOrder(appState, orderId), result: result.result, confirmedByServer: true };
  }

  async function closeWarehouseBox(appState, orderId, boxNumber) {
    const repository = warehouseRepository();
    if (!repository) return { ok: false, error: "El cierre V2 requiere conexión confirmada con Supabase." };
    const result = await repository.closeBox(orderId, boxNumber);
    if (!result.ok) return { ok: false, error: result.message || "Supabase no confirmó el cierre de caja." };
    return { ok: true, order: findOrder(appState, orderId), result: result.result, confirmedByServer: true };
  }

  async function reopenWarehouseBox(appState, orderId, boxNumber, reason) {
    const repository = warehouseRepository();
    if (!repository) return { ok: false, error: "La reapertura V2 requiere conexión confirmada con Supabase." };
    const result = await repository.reopenBox(orderId, boxNumber, reason);
    if (!result.ok) return { ok: false, error: result.message || "Supabase no confirmó la reapertura de caja." };
    return { ok: true, order: findOrder(appState, orderId), result: result.result, confirmedByServer: true };
  }

  function localPoolFor(appState, customerId) {
    return ensureDomain(appState).operations.roseInventory.filter(row => (
      String(row.destinationCustomerId || row.localDestinationCustomerId || "") === String(customerId || "")
      && upper(row.state) === "ASIGNADO_LOCAL"
    ));
  }

  function localLotsFor(appState, customerId) {
    return ensureDomain(appState).operations.destinationLots.filter(row => (
      String(row.destinationCustomerId || "") === String(customerId || "")
      && upper(row.destinationType) === "LOCAL"
    ));
  }

  async function confirmLocalOrder(appState, orderId) {
    if (destinationRepository()) {
      const order = findOrder(appState, orderId);
      if (!order || !isLocalOrder(order, appState)) return { ok: false, error: "Seleccione un pedido local." };
      if (!orderUsesInventory(order)) return { ok: false, error: "La venta local sin inventario no utiliza la bolsa operativa." };
      const result = await destinationRepository().confirmLocalOrder(orderId);
      if (!result.ok) return { ok: false, error: result.message || "Supabase no confirmó el pedido local." };
      return {
        ok: true,
        assigned: number(result.result?.assigned),
        summary: buildOrderFulfillment(findOrder(appState, orderId)),
        result: result.result,
        confirmedByServer: true
      };
    }
    return { ok: false, error: "Confirmar pedido local requiere conexión confirmada con Supabase." };
  }

  async function unassignInventory(appState, inventoryId, reason) {
    const db = ensureDomain(appState);
    const inventory = db.operations.roseInventory.find(row => String(row.inventoryId) === String(inventoryId));
    if (!inventory || upper(inventory.state) !== "ASIGNADO_LOCAL") return { ok: false, error: "El ramo ya no está disponible para desasignación local." };
    if (!text(reason)) return { ok: false, error: "El motivo es obligatorio." };
    const repository = destinationRepository();
    if (!repository) return { ok: false, error: "La reasignación requiere conexión confirmada con Supabase." };
    const result = await repository.reassignBunch(inventory.labelCode, { type: "EXPORT" }, reason);
    if (!result.ok) return { ok: false, error: result.message || "Supabase no confirmó la reasignación." };
    return { ok: true, inventory: ensureDomain(appState).operations.roseInventory.find(row => String(row.inventoryId) === String(inventoryId)), confirmedByServer: true };
  }

  function getAvailabilityRows(appState) {
    const db = ensureDomain(appState);
    const rows = new Map();
    const ensure = (variety, length, quality = "EXPORTACION") => {
      const key = keyOf(variety, length, quality);
      if (!rows.has(key)) rows.set(key, { key, variety: upper(variety), length: number(length), quality: upper(quality || "EXPORTACION"), physicalBunches: 0, demandBunches: 0, scannedBunches: 0, availableBunches: 0, physicalStems: 0, demandStems: 0, availableStems: 0 });
      return rows.get(key);
    };
    db.operations.roseInventory.forEach(item => {
      if (["ANULADO", "DESPACHADO", "DISPATCHED", "CONSUMIDO"].includes(upper(item.state))) return;
      const row = ensure(item.variety, item.length, item.quality || item.category);
      row.physicalBunches += number(item.bunches || 1);
      row.physicalStems += number(item.stems || item.stemsPerBunch);
      if (["PACKED", "EMPACADO", "ASIGNADO_CAJA"].includes(upper(item.state))) row.packedBunches = number(row.packedBunches) + number(item.bunches || 1);
      if (["BLOQUEADO", "BLOCKED", "OBSERVADO", "VENCIDO"].includes(upper(item.state))) row.blockedBunches = number(row.blockedBunches) + number(item.bunches || 1);
    });
    const reservations = db.commercial.orderReservations.filter(item => ["ACTIVE", "PARTIAL", "CONSUMED", "PENDING_SELECTION"].includes(upper(item.status)));
    if (reservations.length) {
      reservations.forEach(reservation => {
        if (upper(reservation.variety) === "MIXTO ABIERTO") return;
        const row = ensure(reservation.variety, reservation.length, reservation.quality);
        const requested = number(reservation.requestedQuantity);
        const assigned = number(reservation.assignedQuantity);
        const packed = number(reservation.packedQuantity);
        const released = number(reservation.releasedQuantity);
        const committed = Math.max(number(reservation.reservedQuantity) - assigned - released, 0);
        row.demandBunches += requested;
        row.demandStems += requested * number(reservation.stemsPerBunch);
        row.reservedBunches = number(row.reservedBunches) + committed;
        row.reservedStems = number(row.reservedStems) + committed * number(reservation.stemsPerBunch);
        row.scannedBunches += packed;
      });
    } else if (!warehouseRepository()) {
      // Compatibilidad exclusiva del HTML local: en producción la reserva V2
      // es la única que descuenta disponibilidad.
      activeOrders(appState).forEach(order => (order.lines || []).forEach(line => {
        if (upper(line.variety) === "MIXTO ABIERTO") return;
        const row = ensure(line.variety, line.length, line.quality);
        const bunches = requestedBunches(line);
        row.demandBunches += bunches;
        row.demandStems += bunches * number(line.stemsPerBunch);
        row.reservedBunches = number(row.reservedBunches) + Math.max(bunches - scannedBunches(line), 0);
        row.reservedStems = number(row.reservedStems) + Math.max(bunches - scannedBunches(line), 0) * number(line.stemsPerBunch);
        row.scannedBunches += scannedBunches(line);
      }));
    }
    rows.forEach(row => {
      const physicallyFree = db.operations.roseInventory.filter(item => (
        keyOf(item.variety, item.length, item.quality || item.category) === row.key && upper(item.state) === "DISPONIBLE"
      )).reduce((sum, item) => sum + number(item.bunches || 1), 0);
      const physicallyFreeStems = db.operations.roseInventory.filter(item => (
        keyOf(item.variety, item.length, item.quality || item.category) === row.key && upper(item.state) === "DISPONIBLE"
      )).reduce((sum, item) => sum + number(item.stems || item.stemsPerBunch), 0);
      row.availableBunches = Math.max(physicallyFree - number(row.reservedBunches), 0);
      row.availableStems = Math.max(physicallyFreeStems - number(row.reservedStems), 0);
      row.demandPendingBunches = Math.max(row.demandBunches - row.scannedBunches, 0);
    });
    return [...rows.values()].sort((a, b) => a.variety.localeCompare(b.variety, "es") || a.length - b.length);
  }

  function getWarehouseOrders(appState) {
    return ensureDomain(appState).commercial.orders
      .filter(order => orderUsesInventory(order) && ["EN_CUARTO_FRIO", "COMPLETADO", "READY_FOR_DISPATCH", "DISPATCHED"].includes(upper(order.status)))
      .sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")) || String(b.number).localeCompare(String(a.number)));
  }

  async function markShipment(appState, orderId) {
    return confirmDispatch(appState, orderId);
  }

  function getDispatchRecord(appState, orderId) {
    return ensureDomain(appState).operations.dispatchRecords.find(row => String(row.orderId || "") === String(orderId || "")) || null;
  }

  async function validateDispatchReady(appState, orderId) {
    const repository = dispatchRepository();
    if (!repository) return { ok: false, ready: false, error: "La validación de despacho requiere conexión confirmada con Supabase." };
    const response = await repository.validateReady(orderId);
    if (!response.ok) return { ok: false, ready: false, error: response.message || "Supabase no pudo validar el pedido." };
    return { ok: true, ready: response.ready, validation: response.validation };
  }

  async function markReadyForDispatch(appState, orderId) {
    const repository = dispatchRepository();
    if (!repository) return { ok: false, error: "No se puede marcar listo sin conexión confirmada con Supabase." };
    const response = await repository.markReady(orderId);
    if (!response.ok) return { ok: false, error: response.message || "Supabase rechazó la validación final." };
    return { ok: true, order: findOrder(appState, orderId), validation: response.result, confirmedByServer: true };
  }

  function dispatchFailureMessage(response) {
    const detail = String(response?.message || response?.error?.message || "").toUpperCase();
    if (detail.includes("DISPATCH_V2_NOT_READY:NO_LINES")) return "El pedido no contiene líneas válidas para despachar.";
    if (detail.includes("DISPATCH_V2_NOT_READY:INCOMPLETE_QUANTITY")) return "Las cantidades empacadas todavía están incompletas.";
    if (detail.includes("DISPATCH_V2_NOT_READY:NO_BOXES")) return "El pedido no tiene cajas canónicas para despachar.";
    if (detail.includes("DISPATCH_V2_NOT_READY:BOXES_NOT_CLOSED") || detail.includes("DISPATCH_V2_BOX_NOT_READY")) return "Todas las cajas deben estar completas y cerradas antes del despacho.";
    if (detail.includes("DISPATCH_V2_NOT_READY:ACTIVE_CONFLICTS")) return "Existe un conflicto de cancelación o revisión que debe resolverse antes del despacho.";
    if (detail.includes("DISPATCH_V2_BUNCH_STATE_INCONSISTENT")) return "El inventario o los ramos empacados son inconsistentes. Actualice el pedido antes de continuar.";
    if (detail.includes("DISPATCH_V2_ORDER_CANCELLED")) return "El pedido está anulado y no puede despacharse.";
    if (detail.includes("DISPATCH_V2_DIRECT_CONFIRM_STATE_INVALID")) return "El pedido todavía no está canónicamente completado para despacho.";
    if (detail.includes("ALREADY_DISPATCHED")) return "El pedido ya fue despachado.";
    return response?.message || "Supabase rechazó el despacho definitivo.";
  }

  async function confirmDispatch(appState, orderId, payload = {}) {
    const repository = dispatchRepository();
    if (!repository) return { ok: false, error: "El despacho definitivo requiere conexión confirmada con Supabase." };
    const order = findOrder(appState, orderId);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    const logistics = {
      destination: text(order.destinationCountry || order.country || ""),
      country: text(order.destinationCountry || order.country || ""),
      airport: text(order.airport || ""),
      cargoAgencyId: text(order.cargoAgencyId || order.agencyId || ""),
      airlineId: text(order.airlineId || ""),
      flight: text(order.flight || ""),
      flightDate: text(order.flightDate || order.departureDate || ""),
      flightTime: text(order.flightTime || ""),
      masterGuide: text(order.awb || ""),
      houseGuide: text(order.hawb || ""),
      dae: text(order.daeNumber || ""),
      carrier: text(payload.carrier || ""),
      plate: text(payload.plate || ""),
      driver: text(payload.driver || "")
    };
    const response = await repository.confirmDispatch(orderId, {
      logistics,
      observations: text(payload.observations || "Salida física confirmada desde Cuarto Frío.")
    });
    if (!response.ok) {
      const latest = await remoteOrderRepository()?.getFullOrder?.(orderId);
      if (latest?.ok && latest.order) replaceConfirmedOrder(appState, latest.order);
      return { ok: false, error: dispatchFailureMessage(response), canonicalRefreshed: Boolean(latest?.ok) };
    }
    return { ok: true, order: findOrder(appState, orderId), dispatch: getDispatchRecord(appState, orderId),
      result: response.result, confirmedByServer: true };
  }

  function exportShipments(appState) {
    return ensureDomain(appState).commercial.exportShipments
      .filter(row => !row.companyId || String(row.companyId) === String(activeCompanyId(appState)))
      .sort((a, b) => String(b.updatedAtServer || b.createdAt || "").localeCompare(String(a.updatedAtServer || a.createdAt || "")));
  }

  function findExportShipment(appState, shipmentId) {
    return exportShipments(appState).find(row => String(row.shipmentId || row.id) === String(shipmentId || "")) || null;
  }

  function eligibleExportOrders(appState) {
    const linked = new Set(exportShipments(appState).flatMap(row => row.orderIds || []).map(String));
    return ensureDomain(appState).commercial.orders.filter(order => (
      !isLocalOrder(order)
      && upper(order.dispatchStatus || order.status) === "DISPATCHED"
      && !linked.has(String(order.id))
      && getDispatchRecord(appState, order.id)?.dispatchId
    ));
  }

  async function createExportShipment(appState, orderId, requiredDocumentTypes = []) {
    const repository = exportShipmentRepository();
    if (!repository) return { ok: false, error: "Crear el expediente de exportación requiere conexión confirmada con Supabase." };
    const order = findOrder(appState, orderId);
    const dispatch = getDispatchRecord(appState, orderId);
    if (!order || isLocalOrder(order)) return { ok: false, error: "Seleccione un pedido de exportación despachado." };
    if (upper(order.dispatchStatus || order.status) !== "DISPATCHED" || !dispatch?.dispatchId) {
      return { ok: false, error: "El pedido todavía no tiene un despacho físico confirmado." };
    }
    const response = await repository.createShipment({
      orderIds: [order.id], dispatchIds: [dispatch.dispatchId], requiredDocumentTypes
    });
    if (!response.ok) return { ok: false, error: response.message || "Supabase rechazó la creación del expediente." };
    return { ok: true, shipment: findExportShipment(appState, response.result.shipmentId), result: response.result, confirmedByServer: true };
  }

  async function updateExportLogistics(appState, shipmentId, payload = {}) {
    const repository = exportShipmentRepository();
    if (!repository) return { ok: false, error: "Guardar DAE, guías o vuelo requiere conexión confirmada con Supabase." };
    const response = await repository.updateLogistics(shipmentId, payload);
    if (!response.ok) return { ok: false, error: response.message || "Supabase rechazó la actualización logística." };
    return { ok: true, shipment: findExportShipment(appState, shipmentId), result: response.result, confirmedByServer: true };
  }

  async function deliverExportToCargo(appState, shipmentId, payload = {}) {
    const repository = exportShipmentRepository();
    if (!repository) return { ok: false, error: "La entrega a la agencia requiere conexión confirmada con Supabase." };
    const response = await repository.deliverToCargo(shipmentId, payload);
    if (!response.ok) return { ok: false, error: response.message || "Supabase rechazó la entrega a carga." };
    return { ok: true, shipment: findExportShipment(appState, shipmentId), result: response.result, confirmedByServer: true };
  }

  async function closeExportShipment(appState, shipmentId) {
    const repository = exportShipmentRepository();
    if (!repository) return { ok: false, error: "Cerrar el expediente requiere conexión confirmada con Supabase." };
    const response = await repository.closeShipment(shipmentId);
    if (!response.ok) return { ok: false, error: response.message || "Supabase rechazó el cierre del expediente." };
    return { ok: true, shipment: findExportShipment(appState, shipmentId), result: response.result, confirmedByServer: true };
  }

  async function reopenExportShipment(appState, shipmentId, reason) {
    const repository = exportShipmentRepository();
    if (!repository) return { ok: false, error: "Reabrir el expediente requiere conexión confirmada con Supabase." };
    const response = await repository.reopenShipment(shipmentId, reason);
    if (!response.ok) return { ok: false, error: response.message || "Supabase rechazó la reapertura." };
    return { ok: true, shipment: findExportShipment(appState, shipmentId), result: response.result, confirmedByServer: true };
  }

  async function transitionExportShipment(appState, shipmentId, action) {
    const repository = exportShipmentRepository();
    if (!repository) return { ok: false, error: "Actualizar el estado del embarque requiere conexión confirmada con Supabase." };
    const response = await repository.transition(shipmentId, action, {});
    if (!response.ok) return { ok: false, error: response.message || "Supabase rechazó el cambio de estado." };
    return { ok: true, shipment: findExportShipment(appState, shipmentId), result: response.result, confirmedByServer: true };
  }

  async function updateCoordination(appState, orderId, payload = {}) {
    const allowedPayload = {};
    ["awb", "hawb", "daeNumber"].forEach(field => {
      if (Object.prototype.hasOwnProperty.call(payload, field)) allowedPayload[field] = text(payload[field]);
    });
    if (!Object.keys(allowedPayload).length) return { ok: false, error: "No existen cambios de coordinación para guardar." };
    const currentOrder = findOrder(appState, orderId);
    const shipmentId = text(currentOrder?.exportShipmentId || "");
    if (shipmentId) {
      const transportType = currentOrder?.transportType || "aereo";
      const references = normalizeTransportReferences(transportType, {
        awb: allowedPayload.awb ?? currentOrder?.awb ?? "",
        hawb: allowedPayload.hawb ?? currentOrder?.hawb ?? "",
        airlineId: currentOrder?.airlineId || ""
      });
      const airline = Object.prototype.hasOwnProperty.call(allowedPayload, "awb")
        ? airlineForGuide(appState, references.awb, transportType)
        : null;
      const documents = [];
      if (Object.prototype.hasOwnProperty.call(allowedPayload, "daeNumber")) documents.push({
        type: "DAE", status: allowedPayload.daeNumber ? "AVAILABLE" : "PENDING", reference: allowedPayload.daeNumber
      });
      if (Object.prototype.hasOwnProperty.call(allowedPayload, "awb")) documents.push({
        type: "MAWB", status: allowedPayload.awb ? "AVAILABLE" : "PENDING", reference: allowedPayload.awb
      });
      if (Object.prototype.hasOwnProperty.call(allowedPayload, "hawb")) documents.push({
        type: "HAWB", status: allowedPayload.hawb ? "AVAILABLE" : "PENDING", reference: allowedPayload.hawb
      });
      return updateExportLogistics(appState, shipmentId, {
        transportType,
        airlineId: references.transportType === "AEREO" ? (airline?.id || currentOrder?.airlineId || "") : "",
        dae: { number: allowedPayload.daeNumber ?? currentOrder?.daeNumber ?? "", status: allowedPayload.daeNumber ? "AVAILABLE" : "PENDING" },
        waybills: { mawb: references.awb, hawb: references.hawb },
        documents
      });
    }
    const repository = remoteOrderRepository();
    if (requiresConfirmedRemoteOrder()) {
      if (!repository?.getFullOrder || !repository?.patchCoordination) {
        return { ok: false, error: "El parche confirmado de Coordinación no está disponible en Supabase." };
      }
      return serializeOrderMutation(orderId, async () => {
        const canonical = await repository.getFullOrder(orderId);
        if (!canonical.ok) return { ok: false, error: canonical.message || "No fue posible consultar el pedido canónico." };
        const coordinationPatch = { ...allowedPayload };
        if (Object.prototype.hasOwnProperty.call(coordinationPatch, "awb")) {
          coordinationPatch.awb = normalizeMotherGuide(coordinationPatch.awb, canonical.order?.transportType);
          const airline = airlineForGuide(appState, coordinationPatch.awb, canonical.order?.transportType);
          coordinationPatch.airlineId = upper(commercialUtils?.normalizeTransportType?.(canonical.order?.transportType) || canonical.order?.transportType) === "AEREO" ? (airline?.id || "") : "";
        }
        const effectivePatch = Object.fromEntries(Object.entries(coordinationPatch)
          .map(([field, value]) => [field, normalizeCoordinationValue(field, value, canonical.order?.transportType)])
          .filter(([field, value]) => value !== normalizeCoordinationValue(field, canonical.order?.[field], canonical.order?.transportType)));
        if (!Object.keys(effectivePatch).length) {
          const cached = findOrder(appState, orderId);
          const cacheAdvanced = Number(canonical.order?.__syncVersion || 0) > Number(cached?.__syncVersion || 0);
          if (cacheAdvanced) replaceConfirmedOrder(appState, canonical.order);
          return {
            ok: true,
            unchanged: true,
            noChange: true,
            cacheAdvanced,
            order: canonical.order,
            confirmedByServer: true
          };
        }
        const response = await repository.patchCoordination(orderId, effectivePatch, {
          expectedVersion: canonical.order.__syncVersion
        });
        if (!response.ok) {
          const latest = await repository.getFullOrder(orderId);
          if (latest.ok) replaceConfirmedOrder(appState, latest.order);
          return { ok: false, mode: response.mode, error: response.message || "Supabase rechazó la actualización de Coordinación." };
        }
        const order = serverOrder({ serverRecord: response.serverRecord, operationId: response.operationId }, canonical.order);
        if (response.unchanged) {
          const cached = findOrder(appState, orderId);
          const cacheAdvanced = Number(order.__syncVersion || 0) > Number(cached?.__syncVersion || 0);
          if (cacheAdvanced) replaceConfirmedOrder(appState, order);
          return {
            ok: true,
            unchanged: true,
            noChange: true,
            cacheAdvanced,
            order,
            confirmedByServer: true,
            operationId: response.operationId
          };
        }
        replaceConfirmedOrder(appState, order);
        return { ok: true, order, confirmedByServer: true, operationId: response.operationId };
      });
    }
    return persistOrderMutation(appState, orderId, {
      action: "ACTUALIZAR_COORDINACION",
      detail: "DAE y guías actualizadas desde Coordinación diaria.",
      mutate(order) {
        Object.entries(allowedPayload).forEach(([field, value]) => { order[field] = value; });
        if (Object.prototype.hasOwnProperty.call(allowedPayload, "awb")) {
          order.awb = normalizeMotherGuide(allowedPayload.awb, order.transportType);
          const airline = airlineForGuide(appState, allowedPayload.awb, order.transportType);
          if (airline) order.airlineId = airline.id;
          else if (upper(commercialUtils?.normalizeTransportType?.(order.transportType) || order.transportType) !== "AEREO" || guideDigits(allowedPayload.awb).length >= 3) order.airlineId = "";
        }
        order.coordinationUpdatedAt = nowIso();
        return { ok: true };
      }
    });
  }

  function preorderDraft(appState) {
    const session = sessionFor(appState).preorder;
    if (!session.draft) {
      session.draft = {
        id: BlessERP.utils.uid("COM-PO"),
        number: "",
        customerId: "",
        brandId: "",
        country: "",
        requestedDate: today(),
        status: "BORRADOR",
        lines: []
      };
    }
    return session.draft;
  }

  function savePreorder(appState) {
    const db = ensureDomain(appState);
    const draft = preorderDraft(appState);
    if (!draft.customerId || !draft.lines.length) return { ok: false, error: "Seleccione cliente y agregue al menos una caja." };
    const existing = db.commercial.preorders.find(row => String(row.id) === String(draft.id));
    const row = { ...clone(draft), status: draft.status || "BORRADOR", updatedAt: nowIso(), createdAt: existing?.createdAt || nowIso(), flowVersion: 2 };
    if (!row.number) row.number = `PO-${String(db.commercial.preorders.length + 1).padStart(5, "0")}`;
    if (existing) Object.assign(existing, row); else db.commercial.preorders.unshift(row);
    localSave(appState);
    sessionFor(appState).preorder.draft = clone(row);
    return { ok: true, preorder: row };
  }

  function preorderToOrder(appState, preorderId) {
    const preorder = ensureDomain(appState).commercial.preorders.find(row => String(row.id) === String(preorderId));
    if (!preorder) return { ok: false, error: "PO no encontrado." };
    preorder.status = "CONFIRMADO";
    preorder.confirmedAt = nowIso();
    localSave(appState);
    const draft = newDraft(appState, {
      customerId: preorder.customerId,
      brandId: preorder.brandId,
      destinationCountry: preorder.country,
      issuedAt: preorder.requestedDate,
      sourcePoId: preorder.id,
      sourcePoNumber: preorder.number,
      generalPo: preorder.customerPo || "",
      lines: preorder.lines
    });
    return { ok: true, draft };
  }

  const api = {
    ACTIVE_ORDER_STATES,
    activeCompanyId,
    activeOrders,
    agencyFor,
    airlineForGuide,
    addBoxes,
    addItemToBox,
    addManualBoxItem,
    annulOrder,
    boxNumbers,
    buildOrderFulfillment,
    catalogs,
    confirmLocalOrder,
    closeWarehouseBox,
    customerFor,
    deriveCoordinationStatus,
    deleteBox,
    deleteLine,
    duplicateBox,
    confirmDispatch,
    closeExportShipment,
    createExportShipment,
    dispatchRepository,
    deliverExportToCargo,
    eligibleExportOrders,
    exportShipmentRepository,
    exportShipments,
    findOrder,
    findExportShipment,
    getAvailabilityRows,
    getBoxDraft,
    getDispatchRecord,
    getDraft,
    getOrderFulfillment,
    getWarehouseOrders,
    groupOrderBoxes,
    isLocalOrder,
    loadSalesRepresentatives,
    linesForBox,
    localPoolFor,
    localLotsFor,
    markReadyForDispatch,
    markShipment,
    newDraft,
    normalizeBunchBarcodeCode,
    normalizeMotherGuide,
    normalizeOrderTransportPayload,
    normalizeTransportReferences,
    openOrder,
    orderUsesInventory,
    preorderDraft,
    preorderToOrder,
    removeManualBoxItem,
    saveOrder,
    saveOrderConfirmed,
    savePreorder,
    salesRepresentativeFor,
    salesRepresentatives,
    canAssignSalesRepresentative,
    scanBunchAutomatically,
    scanBunchForOrder,
    sendToColdRoom,
    sendToColdRoomConfirmed,
    sessionFor,
    setBoxMode,
    reopenWarehouseBox,
    reopenExportShipment,
    unassignInventory,
    unassignBunchFromOrder,
    warehouseRepository,
    updateBoxDraft,
    updateCoordination,
    updateExportLogistics,
    transitionExportShipment,
    validateDispatchReady,
    updateDraftField,
    updateLine,
    updateManualBoxItem,
    validateDraft
  };

  BlessERP.commercialFlowV2 = api;
  BlessERP.comercialOrderFulfillment = {
    buildOrderFulfillment,
    getAvailabilityRows,
    getOrderFulfillment,
    getWarehouseOrders,
    groupOrderBoxes,
    normalizeBunchBarcodeCode,
    orderContributesDemand: order => orderUsesInventory(order) && ACTIVE_ORDER_STATES.has(upper(order?.status)),
    scanBunchForOrder
  };
})();
