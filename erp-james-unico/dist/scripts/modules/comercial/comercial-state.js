(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;

  function mergeMissing(baseValue, currentValue) {
    if (Array.isArray(baseValue)) return Array.isArray(currentValue) ? currentValue : baseValue;
    if (baseValue && typeof baseValue === "object") {
      const result = { ...baseValue };
      const source = currentValue && typeof currentValue === "object" ? currentValue : {};
      Object.keys(source).forEach(key => {
        result[key] = key in baseValue
          ? mergeMissing(baseValue[key], source[key])
          : source[key];
      });
      return result;
    }
    return currentValue === undefined ? baseValue : currentValue;
  }

  function saveDb() {
    BlessERP.state.saveDb();
  }

  function ensureHistoryFilters(store) {
    store.ui.historySearch = String(store.ui.historySearch || "");
    store.ui.historyStatus = String(store.ui.historyStatus || "TODOS");
    store.ui.historyDateFrom = String(store.ui.historyDateFrom || "");
    store.ui.historyDateTo = String(store.ui.historyDateTo || "");
    store.ui.historyCustomerId = String(store.ui.historyCustomerId || "");
    store.ui.historyBrandId = String(store.ui.historyBrandId || "");
    store.ui.historyDestination = String(store.ui.historyDestination || "");
    store.ui.historyDae = String(store.ui.historyDae || "");
    store.ui.historyBoxType = String(store.ui.historyBoxType || "");
    store.ui.historyPo = String(store.ui.historyPo || "");
  }

  function ensureStore(appState) {
    const base = data.createCommercialStore();
    appState.db.commercial = mergeMissing(base, appState.db.commercial || {});
    const store = appState.db.commercial;

    const existingOrderIds = new Set((store.orders || []).map(order => order.id));
    const validationOrders = (base.orders || []).filter(order => order.demoValidationSeed && !existingOrderIds.has(order.id));
    if (validationOrders.length) store.orders.push(...validationOrders.map(order => BlessERP.utils.clone(order)));

    store.customerCatalog = (store.customerCatalog || []).map(data.createCustomer);
    data.customers.splice(0, data.customers.length, ...store.customerCatalog.map(item => BlessERP.utils.clone(item)));
    const customerDraftIsNew = Boolean(store.ui.customerDraft?.id && !store.customerCatalog.some(item => item.id === store.ui.customerDraft.id));
    if (!store.customerCatalog.some(item => item.id === store.ui.selectedCustomerId) && !customerDraftIsNew) {
      store.ui.selectedCustomerId = store.customerCatalog[0]?.id || "";
    }
    const selectedCustomer = store.customerCatalog.find(item => item.id === store.ui.selectedCustomerId);
    store.ui.customerDraft = data.createCustomer(store.ui.customerDraft?.id ? store.ui.customerDraft : selectedCustomer || {});

    store.agencyCatalog = (store.agencyCatalog || []).map(data.createAgency);
    data.agencies.splice(0, data.agencies.length, ...store.agencyCatalog.map(item => BlessERP.utils.clone(item)));
    const agencyDraftIsNew = Boolean(store.ui.agencyDraft?.id && !store.agencyCatalog.some(item => item.id === store.ui.agencyDraft.id));
    if (!store.agencyCatalog.some(item => item.id === store.ui.selectedAgencyId) && !agencyDraftIsNew) {
      store.ui.selectedAgencyId = store.agencyCatalog[0]?.id || "";
    }
    const selectedAgency = store.agencyCatalog.find(item => item.id === store.ui.selectedAgencyId);
    store.ui.agencyDraft = data.createAgency(store.ui.agencyDraft?.id ? store.ui.agencyDraft : selectedAgency || {});

    store.airlineCatalog = (store.airlineCatalog || []).map(data.createAirline);
    data.airlines.splice(0, data.airlines.length, ...store.airlineCatalog.map(item => BlessERP.utils.clone(item)));
    const airlineDraftIsNew = Boolean(store.ui.airlineDraft?.id && !store.airlineCatalog.some(item => item.id === store.ui.airlineDraft.id));
    if (!store.airlineCatalog.some(item => item.id === store.ui.selectedAirlineId) && !airlineDraftIsNew) {
      store.ui.selectedAirlineId = store.airlineCatalog[0]?.id || "";
    }
    const selectedAirline = store.airlineCatalog.find(item => item.id === store.ui.selectedAirlineId);
    store.ui.airlineDraft = data.createAirline(store.ui.airlineDraft?.id ? store.ui.airlineDraft : selectedAirline || {});

    store.destinationCatalog = (store.destinationCatalog || []).map(data.createDestination);
    data.destinations.splice(0, data.destinations.length, ...store.destinationCatalog.map(item => BlessERP.utils.clone(item)));
    const destinationDraftIsNew = Boolean(store.ui.destinationDraft?.id && !store.destinationCatalog.some(item => item.id === store.ui.destinationDraft.id));
    if (!store.destinationCatalog.some(item => item.id === store.ui.selectedDestinationId) && !destinationDraftIsNew) {
      store.ui.selectedDestinationId = store.destinationCatalog[0]?.id || "";
    }
    const selectedDestination = store.destinationCatalog.find(item => item.id === store.ui.selectedDestinationId);
    store.ui.destinationDraft = data.createDestination(store.ui.destinationDraft?.id ? store.ui.destinationDraft : selectedDestination || {});

    store.daeCatalog = (store.daeCatalog || []).map(data.createDae);
    data.daes.splice(0, data.daes.length, ...store.daeCatalog.map(item => BlessERP.utils.clone(item)));
    const daeDraftIsNew = Boolean(store.ui.daeDraft?.id && !store.daeCatalog.some(item => item.id === store.ui.daeDraft.id));
    if (!store.daeCatalog.some(item => item.id === store.ui.selectedDaeId) && !daeDraftIsNew) {
      store.ui.selectedDaeId = store.daeCatalog[0]?.id || "";
    }
    const selectedDae = store.daeCatalog.find(item => item.id === store.ui.selectedDaeId);
    store.ui.daeDraft = data.createDae(store.ui.daeDraft?.id ? store.ui.daeDraft : selectedDae || {});

    store.brandCatalog = (store.brandCatalog || []).map(data.createBrand);
    data.brands.splice(0, data.brands.length, ...store.brandCatalog.map(item => BlessERP.utils.clone(item)));
    const brandDraftIsNew = Boolean(store.ui.brandDraft?.id && !store.brandCatalog.some(item => item.id === store.ui.brandDraft.id));
    if (!store.brandCatalog.some(item => item.id === store.ui.selectedBrandId) && !brandDraftIsNew) {
      store.ui.selectedBrandId = store.brandCatalog[0]?.id || "";
    }
    const selectedBrand = store.brandCatalog.find(item => item.id === store.ui.selectedBrandId);
    store.ui.brandDraft = data.createBrand(store.ui.brandDraft?.id ? store.ui.brandDraft : selectedBrand || {});

    store.orders = (store.orders || []).map(order => {
      const normalized = utils.normalizeOrder(order);
      Object.assign(order, normalized);
      workflow.ensureOrderWorkflow(order, appState);
      return order;
    });
    store.reservations = Array.isArray(store.reservations) ? store.reservations : [];
    ensureHistoryFilters(store);
    ensureAvailabilityUi(store);

    if (!store.orders.some(order => order.id === store.ui.currentOrderId)) {
      store.ui.currentOrderId = store.orders[0]?.id || "";
    }

    ensureClientInvoiceOptions(store);
    ensureAccountingPreviewView(store);
    ensureLabelSelection(store, store.orders.find(order => order.id === store.ui.currentOrderId));
    return store;
  }

  function setNotice(appState, text, tone = "info") {
    const store = ensureStore(appState);
    store.ui.notice = text || "";
    store.ui.noticeTone = tone;
  }

  function clearNotice(appState) {
    setNotice(appState, "", "info");
  }

  function nextOrderNumber(orders) {
    const max = (orders || []).reduce((highest, order) => {
      const match = String(order.number || "").match(/(\d+)$/);
      const current = match ? Number(match[1]) : 0;
      return Math.max(highest, current);
    }, 0);
    return `PED-COM-2026-${String(max + 1).padStart(4, "0")}`;
  }

  function nextCatalogCode(catalog, prefix) {
    const escapedPrefix = String(prefix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`^${escapedPrefix}-(\\d+)$`, "i");
    const highest = (catalog || []).reduce((max, item) => {
      const match = String(item?.code || "").trim().match(matcher);
      return match ? Math.max(max, Number(match[1]) || 0) : max;
    }, (catalog || []).length);
    return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
  }

  function parseColdRooms(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(/[\n,;]+/);
    return [...new Map(source.map(item => String(item || "").trim()).filter(Boolean).map(item => [item.toUpperCase(), item])).values()];
  }

  function getStore(appState) {
    return ensureStore(appState);
  }

  function getUi(appState) {
    return ensureStore(appState).ui;
  }

  function getOrders(appState) {
    return ensureStore(appState).orders;
  }

  function getCustomerCatalog(appState) {
    return ensureStore(appState).customerCatalog;
  }

  function selectCustomer(appState, customerId) {
    const store = ensureStore(appState);
    const customer = store.customerCatalog.find(item => item.id === customerId);
    if (!customer) return false;
    store.ui.selectedCustomerId = customer.id;
    store.ui.customerDraft = data.createCustomer(BlessERP.utils.clone(customer));
    setNotice(appState, `Editando cliente ${customer.commercialName}.`, "info");
    saveDb();
    return true;
  }

  function newCustomer(appState) {
    const store = ensureStore(appState);
    store.ui.selectedCustomerId = "";
    store.ui.customerDraft = data.createCustomer({
      code: nextCatalogCode(store.customerCatalog, "CLI"),
      country: "ECUADOR",
      status: "ACTIVO"
    });
    setNotice(appState, "Nueva ficha de cliente preparada.", "info");
    saveDb();
    return store.ui.customerDraft;
  }

  function updateCustomerDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.customerDraft;
    if (!draft || !(field in draft)) return false;
    if (field === "code") return false;
    if (["related", "flowerTypeB"].includes(field)) draft[field] = Boolean(value);
    else if (["creditDays", "creditAmount"].includes(field)) draft[field] = Math.max(0, utils.parseNumber(value));
    else draft[field] = String(value || "");
    saveDb();
    return true;
  }

  function saveCustomer(appState) {
    const store = ensureStore(appState);
    const draft = data.createCustomer(store.ui.customerDraft || {});
    if (!draft.code) draft.code = nextCatalogCode(store.customerCatalog, "CLI");
    const required = [draft.code, draft.legalName, draft.commercialName, draft.identification, draft.country];
    if (required.some(value => !String(value || "").trim())) {
      setNotice(appState, "Complete razon social, nombre comercial, identificacion y pais.", "warning");
      return { ok: false };
    }
    const duplicateCode = store.customerCatalog.find(item => item.id !== draft.id && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    const duplicateIdentification = store.customerCatalog.find(item => item.id !== draft.id && String(item.identification).trim() === String(draft.identification).trim());
    if (duplicateCode || duplicateIdentification) {
      setNotice(appState, duplicateCode ? "Ya existe un cliente con ese codigo." : "Ya existe un cliente con esa identificacion.", "warning");
      return { ok: false };
    }
    const existing = store.customerCatalog.find(item => item.id === draft.id);
    if (existing) Object.assign(existing, draft);
    else store.customerCatalog.unshift(draft);
    data.customers.splice(0, data.customers.length, ...store.customerCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedCustomerId = draft.id;
    store.ui.customerDraft = data.createCustomer(BlessERP.utils.clone(draft));
    setNotice(appState, `Cliente guardado: ${draft.commercialName}.`, "success");
    saveDb();
    return { ok: true, customer: draft, updated: Boolean(existing) };
  }

  function getBrandCatalog(appState) {
    return ensureStore(appState).brandCatalog;
  }

  function selectBrand(appState, brandId) {
    const store = ensureStore(appState);
    const brand = store.brandCatalog.find(item => item.id === brandId);
    if (!brand) return false;
    store.ui.selectedBrandId = brand.id;
    store.ui.brandDraft = data.createBrand(BlessERP.utils.clone(brand));
    setNotice(appState, `Editando marca ${brand.name}.`, "info");
    saveDb();
    return true;
  }

  function newBrand(appState) {
    const store = ensureStore(appState);
    const customer = store.customerCatalog.find(item => item.status === "ACTIVO") || store.customerCatalog[0];
    store.ui.selectedBrandId = "";
    store.ui.brandDraft = data.createBrand({
      code: nextCatalogCode(store.brandCatalog, "MAR"),
      customerId: customer?.id || "",
      country: "ECUADOR",
      destination: "ECUADOR",
      status: "ACTIVO"
    });
    setNotice(appState, "Nueva ficha de marca preparada.", "info");
    saveDb();
    return store.ui.brandDraft;
  }

  function updateBrandDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.brandDraft;
    if (!draft || !(field in draft)) return false;
    if (field === "code") return false;
    if (field === "commercializer") draft[field] = Boolean(value);
    else if (field === "requiresPo") draft[field] = value === true || String(value).toUpperCase() === "SI" || String(value).toLowerCase() === "true";
    else draft[field] = String(value || "");

    if (field === "defaultAgencyId") {
      const agency = data.agencies.find(item => item.id === draft.defaultAgencyId);
      if (agency) {
        draft.agencyContact = agency.contact || "";
        draft.agencyEmail = agency.email || "";
        draft.agencyColdRoom = agency.coldRoom || "";
        draft.agencyCity = agency.city || "";
      }
    }
    if (field === "destination") {
      const destination = store.destinationCatalog.find(item => item.destination === draft.destination);
      if (destination) draft.country = destination.country;
    }
    saveDb();
    return true;
  }

  function saveBrand(appState) {
    const store = ensureStore(appState);
    const draft = data.createBrand(store.ui.brandDraft || {});
    if (!draft.code) draft.code = nextCatalogCode(store.brandCatalog, "MAR");
    const required = [draft.code, draft.customerId, draft.name, draft.finalClientName, draft.country, draft.destination];
    if (required.some(value => !String(value || "").trim())) {
      setNotice(appState, "Complete cliente principal, marca, razon social, pais y destino.", "warning");
      return { ok: false };
    }
    if (!store.customerCatalog.some(item => item.id === draft.customerId)) {
      setNotice(appState, "El cliente principal seleccionado no existe.", "warning");
      return { ok: false };
    }
    const duplicateCode = store.brandCatalog.find(item => item.id !== draft.id && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    if (duplicateCode) {
      setNotice(appState, "Ya existe una marca con ese codigo.", "warning");
      return { ok: false };
    }
    const existing = store.brandCatalog.find(item => item.id === draft.id);
    if (existing) Object.assign(existing, draft);
    else store.brandCatalog.unshift(draft);
    data.brands.splice(0, data.brands.length, ...store.brandCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedBrandId = draft.id;
    store.ui.brandDraft = data.createBrand(BlessERP.utils.clone(draft));
    setNotice(appState, `Marca guardada: ${draft.name}.`, "success");
    saveDb();
    return { ok: true, brand: draft, updated: Boolean(existing) };
  }

  function getAgencyCatalog(appState) {
    return ensureStore(appState).agencyCatalog;
  }

  function selectAgency(appState, agencyId) {
    const store = ensureStore(appState);
    const agency = store.agencyCatalog.find(item => item.id === agencyId);
    if (!agency) return false;
    store.ui.selectedAgencyId = agency.id;
    store.ui.agencyDraft = data.createAgency(BlessERP.utils.clone(agency));
    setNotice(appState, `Editando agencia ${agency.name}.`, "info");
    saveDb();
    return true;
  }

  function newAgency(appState) {
    const store = ensureStore(appState);
    store.ui.selectedAgencyId = "";
    store.ui.agencyDraft = data.createAgency({
      code: nextCatalogCode(store.agencyCatalog, "AG"),
      city: "Quito",
      status: "ACTIVA"
    });
    setNotice(appState, "Nueva ficha de agencia preparada.", "info");
    saveDb();
    return store.ui.agencyDraft;
  }

  function updateAgencyDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.agencyDraft;
    if (!draft || (!(field in draft) && field !== "coldRooms")) return false;
    if (field === "code") return false;
    if (field === "coldRooms") {
      draft.coldRooms = parseColdRooms(value);
      if (!draft.coldRooms.some(item => item.toUpperCase() === String(draft.coldRoom || "").toUpperCase())) {
        draft.coldRoom = draft.coldRooms[0] || "";
      }
    } else {
      draft[field] = String(value || "");
      if (field === "coldRoom" && draft.coldRoom) {
        draft.coldRooms = parseColdRooms([draft.coldRoom, ...(draft.coldRooms || [])]);
      }
    }
    saveDb();
    return true;
  }

  function saveAgency(appState) {
    const store = ensureStore(appState);
    const draft = data.createAgency(store.ui.agencyDraft || {});
    if (!draft.code) draft.code = nextCatalogCode(store.agencyCatalog, "AG");
    const required = [draft.code, draft.name, draft.coldRoom, draft.city];
    if (required.some(value => !String(value || "").trim())) {
      setNotice(appState, "Complete agencia, cuarto frio principal y ciudad.", "warning");
      return { ok: false };
    }
    const duplicateCode = store.agencyCatalog.find(item => item.id !== draft.id && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    const duplicateName = store.agencyCatalog.find(item => item.id !== draft.id && String(item.name).trim().toUpperCase() === String(draft.name).trim().toUpperCase());
    if (duplicateCode || duplicateName) {
      setNotice(appState, duplicateCode ? "Ya existe una agencia con ese codigo." : "Ya existe una agencia con ese nombre.", "warning");
      return { ok: false };
    }
    const existing = store.agencyCatalog.find(item => item.id === draft.id);
    if (existing) Object.assign(existing, draft);
    else store.agencyCatalog.unshift(draft);
    data.agencies.splice(0, data.agencies.length, ...store.agencyCatalog.map(item => BlessERP.utils.clone(item)));

    store.brandCatalog.forEach(brand => {
      if (brand.defaultAgencyId !== draft.id) return;
      brand.agencyContact = draft.contact;
      brand.agencyEmail = draft.email;
      brand.agencyColdRoom = draft.coldRoom;
      brand.agencyCity = draft.city;
    });
    data.brands.splice(0, data.brands.length, ...store.brandCatalog.map(item => BlessERP.utils.clone(item)));
    if (store.ui.brandDraft?.defaultAgencyId === draft.id) {
      store.ui.brandDraft.agencyContact = draft.contact;
      store.ui.brandDraft.agencyEmail = draft.email;
      store.ui.brandDraft.agencyColdRoom = draft.coldRoom;
      store.ui.brandDraft.agencyCity = draft.city;
    }

    store.ui.selectedAgencyId = draft.id;
    store.ui.agencyDraft = data.createAgency(BlessERP.utils.clone(draft));
    setNotice(appState, `Agencia guardada: ${draft.name}.`, "success");
    saveDb();
    return { ok: true, agency: draft, updated: Boolean(existing) };
  }

  function getAirlineCatalog(appState) {
    return ensureStore(appState).airlineCatalog;
  }

  function selectAirline(appState, airlineId) {
    const store = ensureStore(appState);
    const airline = store.airlineCatalog.find(item => item.id === airlineId);
    if (!airline) return false;
    store.ui.selectedAirlineId = airline.id;
    store.ui.airlineDraft = data.createAirline(BlessERP.utils.clone(airline));
    setNotice(appState, `Editando linea aerea ${airline.name}.`, "info");
    saveDb();
    return true;
  }

  function newAirline(appState) {
    const store = ensureStore(appState);
    store.ui.selectedAirlineId = "";
    store.ui.airlineDraft = data.createAirline({
      code: `AIR-${String(store.airlineCatalog.length + 1).padStart(3, "0")}`,
      status: "ACTIVA"
    });
    setNotice(appState, "Nueva linea aerea preparada.", "info");
    saveDb();
    return store.ui.airlineDraft;
  }

  function updateAirlineDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.airlineDraft;
    if (!draft || !(field in draft)) return false;
    draft[field] = field === "awbPrefix" ? String(value || "").replace(/\D/g, "").slice(0, 3) : String(value || "");
    saveDb();
    return true;
  }

  function saveAirline(appState) {
    const store = ensureStore(appState);
    const draft = data.createAirline(store.ui.airlineDraft || {});
    if (![draft.code, draft.name, draft.awbPrefix].every(value => String(value || "").trim())) {
      setNotice(appState, "Complete codigo, linea aerea y prefijo AWB.", "warning");
      return { ok: false };
    }
    if (!/^\d{3}$/.test(draft.awbPrefix)) {
      setNotice(appState, "El prefijo AWB debe contener exactamente 3 digitos.", "warning");
      return { ok: false };
    }
    const duplicateCode = store.airlineCatalog.find(item => item.id !== draft.id && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    const duplicatePrefix = store.airlineCatalog.find(item => item.id !== draft.id && item.awbPrefix === draft.awbPrefix);
    if (duplicateCode || duplicatePrefix) {
      setNotice(appState, duplicateCode ? "Ya existe una linea aerea con ese codigo." : "Ya existe una linea aerea con ese prefijo AWB.", "warning");
      return { ok: false };
    }
    const existing = store.airlineCatalog.find(item => item.id === draft.id);
    if (existing) Object.assign(existing, draft);
    else store.airlineCatalog.unshift(draft);
    data.airlines.splice(0, data.airlines.length, ...store.airlineCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedAirlineId = draft.id;
    store.ui.airlineDraft = data.createAirline(BlessERP.utils.clone(draft));
    setNotice(appState, `Linea aerea guardada: ${draft.name}.`, "success");
    saveDb();
    return { ok: true, airline: draft, updated: Boolean(existing) };
  }

  function deleteAirline(appState, airlineId) {
    const store = ensureStore(appState);
    const airline = store.airlineCatalog.find(item => item.id === airlineId);
    if (!airline) return { ok: false, reason: "NOT_FOUND" };
    const daeInUse = data.daes.some(item => item.airlineId === airlineId);
    const orderInUse = store.orders.some(item => item.airlineId === airlineId);
    if (daeInUse || orderInUse) {
      setNotice(appState, `No se puede borrar ${airline.name}: esta usada en ${daeInUse ? "DAE" : "pedidos"}.`, "warning");
      return { ok: false, reason: "IN_USE" };
    }
    store.airlineCatalog = store.airlineCatalog.filter(item => item.id !== airlineId);
    data.airlines.splice(0, data.airlines.length, ...store.airlineCatalog.map(item => BlessERP.utils.clone(item)));
    const next = store.airlineCatalog[0] || data.createAirline();
    store.ui.selectedAirlineId = next.id || "";
    store.ui.airlineDraft = data.createAirline(BlessERP.utils.clone(next));
    setNotice(appState, `Linea aerea eliminada: ${airline.name}.`, "success");
    saveDb();
    return { ok: true, airline };
  }

  function getDaeCatalog(appState) {
    return ensureStore(appState).daeCatalog;
  }

  function selectDae(appState, daeId) {
    const store = ensureStore(appState);
    const dae = store.daeCatalog.find(item => item.id === daeId);
    if (!dae) return false;
    store.ui.selectedDaeId = dae.id;
    store.ui.daeDraft = data.createDae(BlessERP.utils.clone(dae));
    setNotice(appState, `Editando DAE ${dae.number}.`, "info");
    saveDb();
    return true;
  }

  function newDae(appState) {
    const store = ensureStore(appState);
    const firstCustomer = store.customerCatalog.find(item => item.status === "ACTIVO") || store.customerCatalog[0];
    const firstAirline = store.airlineCatalog.find(item => item.status === "ACTIVA") || store.airlineCatalog[0];
    store.ui.selectedDaeId = "";
    store.ui.daeDraft = data.createDae({
      number: "055-",
      status: "ACTIVA",
      airlineId: firstAirline?.id || "",
      customerIds: firstCustomer ? [firstCustomer.id] : []
    });
    setNotice(appState, "Nueva ficha DAE preparada.", "info");
    saveDb();
    return store.ui.daeDraft;
  }

  function updateDaeDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.daeDraft;
    if (!draft || !(field in draft) || field === "customerIds") return false;
    draft[field] = String(value || "");
    if (field === "destination") {
      const destinationName = String(value || "").trim().toUpperCase();
      const destination = store.destinationCatalog.find(item => String(item.destination || "").trim().toUpperCase() === destinationName);
      if (destination?.country) draft.country = destination.country;
      else if (destinationName) draft.country = destinationName;
    }
    saveDb();
    return true;
  }

  function toggleDaeCustomer(appState, customerId, enabled) {
    const store = ensureStore(appState);
    const draft = store.ui.daeDraft;
    if (!draft || !store.customerCatalog.some(item => item.id === customerId)) return false;
    const current = new Set(draft.customerIds || []);
    if (enabled) current.add(customerId);
    else current.delete(customerId);
    draft.customerIds = [...current];
    saveDb();
    return true;
  }

  function saveDae(appState) {
    const store = ensureStore(appState);
    const draft = data.createDae(store.ui.daeDraft || {});
    const required = [draft.number, draft.destination, draft.country, draft.expirationDate, draft.airlineId, draft.status];
    if (required.some(value => !String(value || "").trim())) {
      setNotice(appState, "Complete numero DAE, destino, pais, caducidad, linea aerea y estado.", "warning");
      return { ok: false };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expirationDate) || Number.isNaN(new Date(`${draft.expirationDate}T00:00:00`).getTime())) {
      setNotice(appState, "La fecha de caducidad DAE no es valida.", "warning");
      return { ok: false };
    }
    if (!store.airlineCatalog.some(item => item.id === draft.airlineId)) {
      setNotice(appState, "La linea aerea seleccionada no existe.", "warning");
      return { ok: false };
    }
    const duplicate = store.daeCatalog.find(item => item.id !== draft.id && String(item.number).trim().toUpperCase() === String(draft.number).trim().toUpperCase());
    if (duplicate) {
      setNotice(appState, "Ya existe una DAE con ese numero.", "warning");
      return { ok: false };
    }
    const existing = store.daeCatalog.find(item => item.id === draft.id);
    if (existing) Object.assign(existing, draft);
    else store.daeCatalog.unshift(draft);
    data.daes.splice(0, data.daes.length, ...store.daeCatalog.map(item => BlessERP.utils.clone(item)));

    store.orders.filter(order => order.daeNumber === draft.number).forEach(order => {
      order.daeDestination = draft.destination;
      order.daeExpirationDate = draft.expirationDate;
      order.airlineId = draft.airlineId;
    });
    store.ui.selectedDaeId = draft.id;
    store.ui.daeDraft = data.createDae(BlessERP.utils.clone(draft));
    setNotice(appState, `DAE guardada: ${draft.number}.`, "success");
    saveDb();
    return { ok: true, dae: draft, updated: Boolean(existing) };
  }

  function getDestinationCatalog(appState) {
    return ensureStore(appState).destinationCatalog;
  }

  function selectDestination(appState, destinationId) {
    const store = ensureStore(appState);
    const destination = store.destinationCatalog.find(item => item.id === destinationId);
    if (!destination) return false;
    store.ui.selectedDestinationId = destination.id;
    store.ui.destinationDraft = data.createDestination(BlessERP.utils.clone(destination));
    setNotice(appState, `Editando destino ${destination.destination}.`, "info");
    saveDb();
    return true;
  }

  function newDestination(appState) {
    const store = ensureStore(appState);
    store.ui.selectedDestinationId = "";
    store.ui.destinationDraft = data.createDestination({
      code: nextCatalogCode(store.destinationCatalog, "DEST"),
      suggestedTransport: "aereo",
      status: "ACTIVO"
    });
    setNotice(appState, "Nuevo destino / pais preparado.", "info");
    saveDb();
    return store.ui.destinationDraft;
  }

  function updateDestinationDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.destinationDraft;
    if (!draft || !(field in draft)) return false;
    if (field === "code") return false;
    draft[field] = String(value || "");
    saveDb();
    return true;
  }

  function saveDestination(appState) {
    const store = ensureStore(appState);
    const draft = data.createDestination(store.ui.destinationDraft || {});
    if (!draft.code) draft.code = nextCatalogCode(store.destinationCatalog, "DEST");
    if (![draft.code, draft.destination, draft.country, draft.suggestedTransport].every(value => String(value || "").trim())) {
      setNotice(appState, "Complete destino, pais y transporte sugerido.", "warning");
      return { ok: false };
    }
    const duplicateCode = store.destinationCatalog.find(item => item.id !== draft.id && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    const duplicateDestination = store.destinationCatalog.find(item => item.id !== draft.id && String(item.destination).trim().toUpperCase() === String(draft.destination).trim().toUpperCase());
    if (duplicateCode || duplicateDestination) {
      setNotice(appState, duplicateCode ? "Ya existe un destino con ese codigo." : "Ya existe ese destino en el catalogo.", "warning");
      return { ok: false };
    }
    const existing = store.destinationCatalog.find(item => item.id === draft.id);
    const previousDestination = existing?.destination || draft.destination;
    if (existing) Object.assign(existing, draft);
    else store.destinationCatalog.unshift(draft);
    data.destinations.splice(0, data.destinations.length, ...store.destinationCatalog.map(item => BlessERP.utils.clone(item)));

    if (existing) {
      store.brandCatalog.filter(item => item.destination === previousDestination).forEach(item => {
        item.destination = draft.destination;
        item.country = draft.country;
      });
      store.daeCatalog.filter(item => item.destination === previousDestination).forEach(item => {
        item.destination = draft.destination;
        item.country = draft.country;
      });
      store.orders.filter(item => item.destination === previousDestination).forEach(item => {
        item.destination = draft.destination;
        item.daeDestination = item.daeDestination === previousDestination ? draft.destination : item.daeDestination;
      });
      data.brands.splice(0, data.brands.length, ...store.brandCatalog.map(item => BlessERP.utils.clone(item)));
      data.daes.splice(0, data.daes.length, ...store.daeCatalog.map(item => BlessERP.utils.clone(item)));
    }

    store.ui.selectedDestinationId = draft.id;
    store.ui.destinationDraft = data.createDestination(BlessERP.utils.clone(draft));
    setNotice(appState, `Destino guardado: ${draft.destination}.`, "success");
    saveDb();
    return { ok: true, destination: draft, updated: Boolean(existing) };
  }

  function getReservations(appState) {
    ensureStore(appState);
    const service = getAvailabilityService();
    if (service?.getReservationsDemo) {
      return service.getReservationsDemo(appState);
    }
    return ensureStore(appState).reservations;
  }

  function findOrder(appState, orderId) {
    return getOrders(appState).find(order => order.id === orderId) || null;
  }

  function currentOrder(appState) {
    const order = findOrder(appState, getUi(appState).currentOrderId);
    if (!order) return null;
    const normalized = utils.normalizeOrder(order);
    Object.assign(order, normalized);
    workflow.ensureOrderWorkflow(order, appState);
    return order;
  }

  function maxBoxNumber(order) {
    const metrics = utils.getOrderMetrics(order || { lines: [] });
    return (metrics.lines || []).reduce((highest, line) => Math.max(highest, Number(line.boxNumber || 0)), 0);
  }

  function resetLabelSelection(store, order) {
    const upper = Math.max(maxBoxNumber(order), 1);
    store.ui.labelPrintMode = "all";
    store.ui.labelFromBox = 1;
    store.ui.labelToBox = upper;
    store.ui.labelSingleBox = 1;
  }

  function ensureLabelSelection(store, order) {
    const upper = Math.max(maxBoxNumber(order), 1);
    store.ui.labelFromBox = Math.max(1, Math.min(Number(store.ui.labelFromBox || 1), upper));
    store.ui.labelToBox = Math.max(store.ui.labelFromBox, Math.min(Number(store.ui.labelToBox || upper), upper));
    store.ui.labelSingleBox = Math.max(1, Math.min(Number(store.ui.labelSingleBox || 1), upper));
    if (!["all", "range", "individual"].includes(store.ui.labelPrintMode)) {
      store.ui.labelPrintMode = "all";
    }
  }

  function resetClientInvoiceOptions(store) {
    store.ui.clientInvoiceViewMode = "grouped";
    store.ui.clientInvoiceShowCustomer = true;
    store.ui.clientInvoiceShowBrand = true;
  }

  function ensureClientInvoiceOptions(store) {
    if (!["grouped", "detailed"].includes(store.ui.clientInvoiceViewMode)) {
      store.ui.clientInvoiceViewMode = "grouped";
    }
    store.ui.clientInvoiceShowCustomer = store.ui.clientInvoiceShowCustomer !== false;
    store.ui.clientInvoiceShowBrand = store.ui.clientInvoiceShowBrand !== false;
  }

  function ensureAccountingPreviewView(store) {
    if (!["summary", "cxc", "journal", "contract"].includes(store.ui.accountingPreviewView)) {
      store.ui.accountingPreviewView = "summary";
    }
  }

  function ensureAvailabilityUi(store) {
    store.ui.availabilityFilterVariety = String(store.ui.availabilityFilterVariety || "");
    store.ui.availabilityFilterLength = String(store.ui.availabilityFilterLength || "");
    store.ui.availabilityFilterCategory = String(store.ui.availabilityFilterCategory || "");
    store.ui.availabilityFilterWarehouse = String(store.ui.availabilityFilterWarehouse || "");
    store.ui.availabilityFilterState = String(store.ui.availabilityFilterState || "");
    store.ui.availabilityReserveDrafts = store.ui.availabilityReserveDrafts && typeof store.ui.availabilityReserveDrafts === "object"
      ? store.ui.availabilityReserveDrafts
      : {};
    store.ui.reservationLineDrafts = store.ui.reservationLineDrafts && typeof store.ui.reservationLineDrafts === "object"
      ? store.ui.reservationLineDrafts
      : {};
  }

  function ensureBoxRangeDraft(store, order) {
    store.ui.boxRangeDrafts = store.ui.boxRangeDrafts && typeof store.ui.boxRangeDrafts === "object"
      ? store.ui.boxRangeDrafts
      : {};
    if (!order) return null;
    const current = store.ui.boxRangeDrafts[order.id] || {};
    const draft = BlessERP.comercialBoxBuilder.normalizeDraft(current, order);
    store.ui.boxRangeDrafts[order.id] = draft;
    return draft;
  }

  function getBoxRangeDraft(appState) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    return ensureBoxRangeDraft(store, order);
  }

  function updateBoxRangeDraft(appState, field, value) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const draft = ensureBoxRangeDraft(store, order);
    if (!BlessERP.comercialBoxBuilder.updateDraftField(draft, field, value)) return false;
    saveDb();
    return true;
  }

  function setBoxBuilderMode(appState, mode) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const draft = ensureBoxRangeDraft(store, order);
    if (!draft || !Object.values(BlessERP.comercialBoxBuilder.MODES).includes(mode)) return false;
    const previousMode = draft.mode;
    draft.mode = mode;
    if (mode === BlessERP.comercialBoxBuilder.MODES.OPEN_MIX && previousMode !== mode) {
      draft.anyLength = true;
    }
    saveDb();
    return true;
  }

  function updateManualMixDraftItem(appState, itemId, field, value) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const draft = ensureBoxRangeDraft(store, order);
    if (!BlessERP.comercialBoxBuilder.updateManualItem(draft, itemId, field, value)) return false;
    saveDb();
    return true;
  }

  function addManualMixDraftItem(appState) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const item = BlessERP.comercialBoxBuilder.addManualItem(ensureBoxRangeDraft(store, order));
    if (!item) return false;
    saveDb();
    return true;
  }

  function removeManualMixDraftItem(appState, itemId) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const removed = BlessERP.comercialBoxBuilder.removeManualItem(ensureBoxRangeDraft(store, order), itemId);
    if (!removed) return false;
    saveDb();
    return true;
  }

  function getAvailabilityService() {
    return BlessERP.operacionesAvailabilityDemo || null;
  }

  function reservationLineDefaults(order, reservation) {
    return {
      boxNumber: maxBoxNumber(order) + 1,
      boxType: "HB",
      unitPrice: 0,
      po: order.generalPo || "",
      bunchesUsed: utils.parseNumber(reservation?.ramos_reservados || reservation?.bunchesReserved, 1)
    };
  }

  function getReservationLineDraft(store, order, reservation) {
    const reservationId = String(reservation?.reservation_id || reservation?.id || "");
    const current = store.ui.reservationLineDrafts[reservationId] || {};
    const defaults = reservationLineDefaults(order, reservation);
    store.ui.reservationLineDrafts[reservationId] = {
      boxNumber: utils.parseNumber(current.boxNumber, defaults.boxNumber),
      boxType: current.boxType || defaults.boxType,
      unitPrice: utils.parseNumber(current.unitPrice, defaults.unitPrice),
      po: current.po !== undefined ? String(current.po) : defaults.po,
      bunchesUsed: utils.parseNumber(current.bunchesUsed, defaults.bunchesUsed)
    };
    return store.ui.reservationLineDrafts[reservationId];
  }

  function activeUser(appState) {
    return workflow.ensureOrderWorkflow && BlessERP.adminConfig?.activeUser
      ? BlessERP.adminConfig.activeUser()
      : appState?.db?.session?.activeUser || { name: "Usuario demo", role: "Administrador" };
  }

  function fieldLabel(field) {
    const map = {
      customerId: "cliente principal",
      brandId: "marca / cliente final",
      transportType: "tipo transporte",
      daeNumber: "DAE",
      agencyId: "agencia de carga",
      coldRoom: "cuarto frio",
      airlineId: "linea aerea",
      flightNumber: "vuelo",
      issuedAt: "fecha emision",
      flightDate: "fecha vuelo",
      expireDate: "vencimiento",
      awb: "AWB",
      hawb: "HAWB",
      paymentTerms: "condicion de pago",
      generalPo: "PO general",
      notes: "observacion",
      currency: "moneda"
    };
    return map[field] || field;
  }

  function lineFieldLabel(field) {
    const map = {
      boxNumber: "numero de caja",
      boxType: "tipo de caja",
      variety: "variedad",
      po: "PO",
      length: "longitud",
      lengthSelection: "medida",
      bunches: "ramos",
      stemsPerBunch: "tallos por ramo",
      unitPrice: "precio unitario",
      state: "estado de linea"
    };
    return map[field] || field;
  }

  function blockOrderEdit(appState, order, detail) {
    workflow.recordEvent(order, appState, {
      action: "BLOQUEAR_EDICION",
      actionLabel: "Bloqueo de edicion",
      previousStatus: order.status,
      nextStatus: order.status,
      description: detail,
      result: "bloqueado"
    });
    setNotice(appState, detail, "warning");
  }

  function ensureEditableField(appState, order, field) {
    if (order.revisionEditing) {
      if (["customerId", "brandId", "transportType"].includes(field)) {
        blockOrderEdit(appState, order, "Cliente, marca y tipo de transporte no se cambian en una revision liberada. Cree un pedido nuevo si cambia la relacion comercial.");
        return false;
      }
      return true;
    }
    const review = workflow.canEditOrderField(order, field);
    if (!review.ok) {
      blockOrderEdit(appState, order, review.message);
      return false;
    }
    return true;
  }

  function ensureEditableLines(appState, order, description) {
    if (order.revisionEditing) return true;
    const review = workflow.canEditLines(order);
    if (!review.ok) {
      blockOrderEdit(appState, order, description || review.message);
      return false;
    }
    return true;
  }

  function applyCustomerBrand(order) {
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);
    const allowedBrands = utils.findBrandsByCustomer(order.customerId);

    if (!customer) {
      order.brandId = "";
      order.destination = "";
      order.destinationCountry = "";
      order.agencyId = "";
      order.paymentTerms = data.company.paymentTermsDefault;
      return;
    }

    order.paymentTerms = `${customer.creditDays} dias`;

    if (brand && !allowedBrands.some(item => item.id === brand.id)) {
      order.brandId = "";
      order.destination = "";
      order.destinationCountry = "";
      order.agencyId = "";
      order.daeNumber = "";
      order.daeDestination = "";
      order.daeExpirationDate = "";
    }
  }

  function applyBrand(order, { preserveManualDae = false } = {}) {
    const brand = utils.findBrand(order.brandId);
    if (!brand) {
      order.destination = "";
      order.destinationCountry = "";
      order.agencyId = "";
      order.daeNumber = "";
      order.daeDestination = "";
      order.daeExpirationDate = "";
      order.daeAssignedAutomatically = false;
      order.daeModifiedManual = false;
      return { type: "warning", text: "Debe seleccionar una marca relacionada al cliente principal." };
    }

    order.destination = brand.destination;
    order.destinationCountry = brand.country;
    if (brand.defaultAgencyId) {
      order.agencyId = brand.defaultAgencyId;
    }

    const agency = utils.findAgency(order.agencyId);
    order.coldRoom = agency?.coldRoom || data.company.coldRoomDefault;

    if (preserveManualDae && order.daeModifiedManual && order.daeNumber) {
      return utils.applyManualDae(order, order.daeNumber);
    }
    return utils.autoAssignDae(order);
  }

  function resetPackagingLifecycle(order) {
    order.packagingDemoStatus = "";
    order.packagingPreparedAt = "";
    order.packagingConsumedAt = "";
  }

  function resetAccountingPreview(order) {
    if (BlessERP.comercialAccountingPreview?.resetOrderPreview) {
      BlessERP.comercialAccountingPreview.resetOrderPreview(order);
      return;
    }

    order.accountingPreview = {
      state: "NO_GENERADO",
      asientoPreviewId: "",
      cxcPreviewId: "",
      generatedAt: "",
      generatedBy: "",
      readyAt: "",
      readyBy: "",
      observation: "",
      snapshot: null
    };
  }

  const revisionOrderFields = [
    "issuedAt",
    "flightDate",
    "destination",
    "destinationCountry",
    "agencyId",
    "daeNumber",
    "daeDestination",
    "daeExpirationDate",
    "awb",
    "hawb",
    "airlineId",
    "flightNumber",
    "coldRoom",
    "generalPo",
    "notes",
    "paymentTerms",
    "expireDate"
  ];

  function scannedCount(line) {
    return Array.isArray(line?.scannedBunches) ? line.scannedBunches.length : 0;
  }

  function orderBoxNumbers(order) {
    return [...new Set((order.lines || []).map(line => Number(line.boxNumber)).filter(Boolean))].sort((a, b) => a - b);
  }

  function markRevisionChange(order, type, boxNumbers = []) {
    if (!order?.revisionEditing) return;
    order.revisionChangeTypes = Array.isArray(order.revisionChangeTypes) ? order.revisionChangeTypes : [];
    order.revisionAffectedBoxes = Array.isArray(order.revisionAffectedBoxes) ? order.revisionAffectedBoxes : [];
    if (type && !order.revisionChangeTypes.includes(type)) order.revisionChangeTypes.push(type);
    boxNumbers.map(Number).filter(Boolean).forEach(boxNumber => {
      if (!order.revisionAffectedBoxes.includes(boxNumber)) order.revisionAffectedBoxes.push(boxNumber);
    });
  }

  function buildRevisionSnapshot(order) {
    const fields = {};
    revisionOrderFields.forEach(field => { fields[field] = BlessERP.utils.clone(order[field]); });
    return {
      fields,
      lines: BlessERP.utils.clone(order.lines || []),
      documentActivity: BlessERP.utils.clone(order.documentActivity || {}),
      boxFulfillment: BlessERP.utils.clone(order.boxFulfillment || {}),
      labelRevision: Number(order.labelRevision || 1),
      labelReprintRequired: Boolean(order.labelReprintRequired),
      invalidatedLabels: BlessERP.utils.clone(order.invalidatedLabels || [])
    };
  }

  function restoreRevisionSnapshot(order) {
    const snapshot = order?.revisionSnapshot;
    if (!snapshot) return;
    Object.entries(snapshot.fields || {}).forEach(([field, value]) => { order[field] = BlessERP.utils.clone(value); });
    order.lines = BlessERP.utils.clone(snapshot.lines || []);
    order.documentActivity = BlessERP.utils.clone(snapshot.documentActivity || {});
    order.boxFulfillment = BlessERP.utils.clone(snapshot.boxFulfillment || {});
    order.labelRevision = Number(snapshot.labelRevision || 1);
    order.labelReprintRequired = Boolean(snapshot.labelReprintRequired);
    order.invalidatedLabels = BlessERP.utils.clone(snapshot.invalidatedLabels || []);
  }

  function clearRevisionDraft(order) {
    order.revisionEditing = false;
    order.revisionDraftNumber = 0;
    order.revisionReason = "";
    order.revisionBaseBoxNumbers = [];
    order.revisionAffectedBoxes = [];
    order.revisionChangeTypes = [];
    order.revisionSnapshot = null;
  }

  function setCurrentOrder(appState, orderId) {
    const store = ensureStore(appState);
    if (!store.orders.some(order => order.id === orderId)) return false;
    store.ui.currentOrderId = orderId;
    clearNotice(appState);
    saveDb();
    return true;
  }

  function setOrderTab(appState, tabId) {
    const order = currentOrder(appState);
    const ui = getUi(appState);
    const previousTab = ui.orderTab;
    ui.orderTab = tabId;
    if (order && tabId === "availability" && previousTab !== "availability") {
      workflow.recordEvent(order, appState, {
        action: "CONSULTAR_DISPONIBILIDAD",
        actionLabel: "Consultar disponibilidad",
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Se consulto disponibilidad demo de Operaciones para el pedido ${order.number}.`,
        result: "exitoso"
      });
    }
    saveDb();
  }

  function setAccountingPreviewView(appState, view) {
    const store = ensureStore(appState);
    store.ui.accountingPreviewView = ["summary", "cxc", "journal", "contract"].includes(view)
      ? view
      : "summary";
    saveDb();
  }

  function setLabelPrintMode(appState, mode) {
    const store = ensureStore(appState);
    store.ui.labelPrintMode = ["all", "range", "individual"].includes(mode) ? mode : "all";
    ensureLabelSelection(store, currentOrder(appState));
    saveDb();
  }

  function setLabelPrintField(appState, field, value) {
    const store = ensureStore(appState);
    if (!["fromBox", "toBox", "singleBox"].includes(field)) return;
    const key = `label${field.charAt(0).toUpperCase()}${field.slice(1)}`;
    store.ui[key] = Math.max(1, Number(value || 1) || 1);
    ensureLabelSelection(store, currentOrder(appState));
    saveDb();
  }

  function setClientInvoiceViewMode(appState, mode) {
    const store = ensureStore(appState);
    store.ui.clientInvoiceViewMode = ["grouped", "detailed"].includes(mode) ? mode : "grouped";
    ensureClientInvoiceOptions(store);
    saveDb();
  }

  function setClientInvoiceToggle(appState, field, checked) {
    const store = ensureStore(appState);
    if (!["showCustomer", "showBrand"].includes(field)) return;
    const key = field === "showCustomer"
      ? "clientInvoiceShowCustomer"
      : "clientInvoiceShowBrand";
    store.ui[key] = Boolean(checked);
    ensureClientInvoiceOptions(store);
    saveDb();
  }

  function setPackagingViewMode(appState, mode) {
    const ui = getUi(appState);
    ui.packagingViewMode = mode || "material";
    saveDb();
  }

  function setAvailabilityFilter(appState, field, value) {
    const ui = getUi(appState);
    const allowed = [
      "availabilityFilterVariety",
      "availabilityFilterLength",
      "availabilityFilterCategory",
      "availabilityFilterWarehouse",
      "availabilityFilterState"
    ];
    if (!allowed.includes(field)) return;
    ui[field] = String(value || "");
    saveDb();
  }

  function setAvailabilityReserveQty(appState, availabilityId, value) {
    const store = ensureStore(appState);
    store.ui.availabilityReserveDrafts[String(availabilityId)] = Math.max(1, utils.parseNumber(value, 1));
    saveDb();
  }

  function setReservationLineDraft(appState, reservationId, field, value) {
    const store = ensureStore(appState);
    const order = currentOrder(appState);
    const reservation = getReservations(appState).find(item => String(item.reservation_id || item.id) === String(reservationId));
    if (!order || !reservation) return;
    const draft = getReservationLineDraft(store, order, reservation);

    if (["boxNumber", "bunchesUsed"].includes(field)) {
      draft[field] = Math.max(1, utils.parseNumber(value, draft[field]));
    } else if (field === "unitPrice") {
      draft.unitPrice = Math.max(0, utils.parseNumber(value, draft.unitPrice));
    } else if (field === "boxType") {
      draft.boxType = String(value || "HB");
    } else if (field === "po") {
      draft.po = String(value || "");
    }

    saveDb();
  }

  function setHistoryFilter(appState, field, value) {
    const ui = getUi(appState);
    const allowed = [
      "historySearch",
      "historyStatus",
      "historyDateFrom",
      "historyDateTo",
      "historyCustomerId",
      "historyBrandId",
      "historyDestination",
      "historyDae",
      "historyBoxType",
      "historyPo"
    ];
    if (!allowed.includes(field)) return;
    ui[field] = String(value || "");
    saveDb();
  }

  function setHistorySearch(appState, value) {
    setHistoryFilter(appState, "historySearch", value);
  }

  function setHistoryStatus(appState, value) {
    setHistoryFilter(appState, "historyStatus", value || "TODOS");
  }

  function setOrdersDayDate(appState, value) {
    const store = ensureStore(appState);
    store.ui.ordersDayDate = String(value || "");
    saveDb();
  }

  function setOrderDetailBox(appState, value) {
    const store = ensureStore(appState);
    store.ui.orderDetailBox = Math.max(1, utils.parseNumber(value, 1));
    saveDb();
  }

  function setOrderScanCode(appState, value) {
    const store = ensureStore(appState);
    store.ui.orderScanCode = String(value || "");
    saveDb();
  }

  function updateOrderField(appState, field, value) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableField(appState, order, field)) return;

    const previousValue = JSON.stringify(order[field] ?? "");

    if (field === "customerId") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.customerId = value;
      applyCustomerBrand(order);
      order.brandId = "";
      setNotice(appState, "Cliente principal actualizado. Seleccione la marca relacionada.", "info");
    } else if (field === "brandId") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.brandId = value;
      const result = applyBrand(order);
      setNotice(appState, result.text || "Marca actualizada.", result.type || "info");
    } else if (field === "transportType") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.transportType = value;
      const result = applyBrand(order, { preserveManualDae: true });
      setNotice(appState, result.text || "Logistica actualizada.", result.type || "info");
    } else if (field === "daeNumber") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      const result = utils.applyManualDae(order, value);
      setNotice(appState, result.text || "DAE actualizada manualmente.", result.type || "info");
    } else if (field === "agencyId") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.agencyId = value;
      const agency = utils.findAgency(value);
      if (agency) order.coldRoom = agency.coldRoom;
      setNotice(appState, agency
        ? `Agencia actualizada. Cuarto frio sugerido: ${agency.coldRoom || "pendiente"}.`
        : "Agencia de carga retirada.", "info");
    } else if (field === "awb") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.awb = utils.normalizeAwb(value);
      const awbDigits = utils.getAwbDigits(order.awb);
      const airline = utils.findAirlineByAwb(order.awb, appState);
      order.airlineId = airline?.id || "";
      if (airline && awbDigits.length === 11) {
        setNotice(appState, `Guia madre reconocida: ${airline.name} (${airline.awbPrefix}).`, "success");
      } else if (airline) {
        setNotice(appState, `${airline.name} reconocida por prefijo ${airline.awbPrefix}; faltan ${11 - awbDigits.length} digito(s) de la guia madre.`, "warning");
      } else if (awbDigits.length >= 3) {
        setNotice(appState, `No existe una aerolinea activa con el prefijo ${awbDigits.slice(0, 3)}.`, "warning");
      } else {
        setNotice(appState, "Ingrese la guia madre: 3 digitos de aerolinea y 8 digitos complementarios.", "info");
      }
    } else if (["issuedAt", "flightDate", "expireDate"].includes(field)) {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order[field] = utils.iso(value) || value;
      if (field === "flightDate" && order.brandId && order.transportType === "aereo" && !order.daeModifiedManual) {
        const result = applyBrand(order);
        if (result.text) setNotice(appState, result.text, result.type);
      }
    } else {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order[field] = value;
    }

    const currentValue = JSON.stringify(order[field] ?? "");
    if (previousValue !== currentValue) {
      const labelFields = ["flightDate", "destination", "destinationCountry", "agencyId", "coldRoom", "daeNumber", "awb", "hawb", "airlineId", "flightNumber", "generalPo", "notes"];
      markRevisionChange(order, labelFields.includes(field) ? "LOGISTICA_ETIQUETA" : "COMERCIAL", labelFields.includes(field) ? orderBoxNumbers(order) : []);
      workflow.recordEvent(order, appState, {
        action: field === "customerId" || field === "brandId"
          ? "EDITAR_CLIENTE_MARCA"
          : field === "daeNumber"
            ? "CAMBIAR_DAE"
            : "EDITAR_PEDIDO",
        actionLabel: field === "customerId" || field === "brandId"
          ? "Editar cliente / marca"
          : field === "daeNumber"
            ? "Cambiar DAE"
            : "Editar pedido",
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Se actualizo ${fieldLabel(field)} del pedido ${order.number}.`,
        result: "exitoso"
      });
    }

    saveDb();
  }

  function updateLineField(appState, lineId, field, value) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableLines(appState, order, "Las lineas del pedido estan bloqueadas. Reabra el pedido para modificarlas.")) return;

    const line = order.lines.find(item => item.id === lineId);
    if (!line) return;
    const previousBoxNumber = Number(line.boxNumber || 0);
    if (order.revisionEditing) {
      const isNewRevisionLine = Number(line.addedRevision || 1) === Number(order.revisionDraftNumber);
      const scans = scannedCount(line);
      if (!isNewRevisionLine && field === "boxNumber") {
        blockOrderEdit(appState, order, "El numero de una caja ya liberada no puede cambiarse. Agregue una caja nueva si necesita otra numeracion.");
        return;
      }
      if (scans > 0 && ["boxNumber", "boxType", "variety", "length", "lengthSelection", "stemsPerBunch"].includes(field)) {
        blockOrderEdit(appState, order, `La linea ya tiene ${scans} ramo(s) leido(s). Bodega debe desasignarlos antes de cambiar tipo, variedad o medida.`);
        return;
      }
      if (field === "bunches" && Number(value) < scans) {
        blockOrderEdit(appState, order, `La cantidad no puede ser menor que los ${scans} ramo(s) ya leido(s).`);
        return;
      }
    }
    const previousValue = field === "lengthSelection"
      ? JSON.stringify({ length: line.length, anyLength: line.anyLength, mixedAnyLength: line.mixedAnyLength })
      : JSON.stringify(line[field] ?? "");
    resetPackagingLifecycle(order);
    resetAccountingPreview(order);

    if (field === "lengthSelection") {
      const anyLength = BlessERP.comercialBoxBuilder.isAnyLengthValue(value);
      line.anyLength = anyLength;
      if (line.boxBuildMode === BlessERP.comercialBoxBuilder.MODES.OPEN_MIX) line.mixedAnyLength = anyLength;
      if (!anyLength) line.length = utils.parseNumber(value, line.length || 60);
    } else if (["boxNumber", "length", "bunches", "stemsPerBunch", "unitPrice"].includes(field)) {
      line[field] = utils.parseNumber(value, field === "boxNumber" ? 1 : 0);
    } else {
      line[field] = value;
    }

    const currentValue = field === "lengthSelection"
      ? JSON.stringify({ length: line.length, anyLength: line.anyLength, mixedAnyLength: line.mixedAnyLength })
      : JSON.stringify(line[field] ?? "");
    if (previousValue !== currentValue) {
      markRevisionChange(order, field === "unitPrice" ? "PRECIO" : field === "po" ? "MARCACION" : "CAJAS", [previousBoxNumber, Number(line.boxNumber || 0)]);
      workflow.recordEvent(order, appState, {
        action: "EDITAR_LINEA",
        actionLabel: "Editar linea",
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Se actualizo ${lineFieldLabel(field)} en la caja ${line.boxNumber}.`,
        result: "exitoso"
      });
    }

    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
  }

  function addLine(appState) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableLines(appState, order, "No se puede agregar lineas en el estado actual.")) return;

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    const nextBox = maxBoxNumber(order) + 1;
    order.lines.push(data.createLine({
      boxNumber: nextBox,
      boxType: "HB",
      variety: "EXPLORER",
      length: 60,
      bunches: 1,
      stemsPerBunch: 25,
      unitPrice: 0,
      po: order.generalPo || "",
      addedRevision: order.revisionEditing ? order.revisionDraftNumber : order.revisionNumber || 1
    }));
    markRevisionChange(order, "CAJAS", [nextBox]);
    workflow.recordEvent(order, appState, {
      action: "AGREGAR_CAJA",
      actionLabel: "Agregar caja",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se agrego la caja ${nextBox} en el Pedido Maestro.`,
      result: "exitoso"
    });
    setNotice(appState, `Caja ${nextBox} agregada. Ingrese variedad, medida, ramos y precio manual por tallo.`, "info");
    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
  }

  function addBoxRange(appState) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede agregar un rango en el estado actual.")) {
      return { ok: false, error: "Pedido bloqueado." };
    }
    const store = ensureStore(appState);
    const draft = ensureBoxRangeDraft(store, order);
    const firstBox = Number(draft.firstBox || maxBoxNumber(order) + 1);
    const requestedBoxes = Array.from({ length: Number(draft.quantity || 0) }, (_, index) => firstBox + index);
    const existingBoxes = new Set((order.lines || []).map(line => Number(line.boxNumber || 0)));
    const duplicatedBoxes = requestedBoxes.filter(boxNumber => existingBoxes.has(boxNumber));
    if (duplicatedBoxes.length) {
      const error = `La caja inicial genera numeros ya existentes: ${duplicatedBoxes.join(", ")}.`;
      setNotice(appState, error, "warning");
      return { ok: false, error };
    }
    const build = BlessERP.comercialBoxBuilder.buildLines(draft, {
      firstBox,
      generalPo: order.generalPo || "",
      revisionNumber: order.revisionEditing ? order.revisionDraftNumber : order.revisionNumber || 1
    });
    if (!build.ok) {
      const error = build.errors.join(" | ");
      setNotice(appState, error, "warning");
      return { ok: false, error, errors: build.errors };
    }

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    order.lines.push(...build.lines);
    markRevisionChange(order, "CAJAS", build.boxNumbers);
    workflow.recordEvent(order, appState, {
      action: "AGREGAR_RANGO_CAJAS",
      actionLabel: build.modeLabel,
      previousStatus: order.status,
      nextStatus: order.status,
      description: `${build.rangeLabel}: ${draft.quantity} ${draft.boxType} en modo ${build.modeLabel}.`,
      result: "exitoso"
    });
    draft.quantity = 1;
    draft.firstBox = maxBoxNumber(order) + 1;
    setNotice(appState, `${build.rangeLabel} generadas como ${build.modeLabel}. Cada caja puede revisarse individualmente.`, "success");
    ensureLabelSelection(store, order);
    saveDb();
    return { ...build, rangeId: build.groupId };
  }

  function addItemToBox(appState, boxNumber) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede agregar items en el estado actual.")) return { ok: false, error: "Pedido bloqueado." };
    const numericBox = Number(boxNumber || 0);
    const template = order.lines.find(line => Number(line.boxNumber) === numericBox);
    if (!template) return { ok: false, error: "Caja no encontrada." };
    if (template.boxBuildMode === "MIXTO_ABIERTO") return { ok: false, error: "El mixto abierto se completa por escaneo en Bodega; no admite items manuales." };

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    const line = data.createLine({
      boxNumber: numericBox,
      boxType: template.boxType || "HB",
      variety: template.variety || "EXPLORER",
      length: Number(template.length || 60),
      anyLength: Boolean(template.anyLength || (template.boxBuildMode === "MIXTO_ABIERTO" && template.mixedAnyLength !== false)),
      bunches: 1,
      stemsPerBunch: Number(template.stemsPerBunch || 25),
      unitPrice: 0,
      po: template.po || order.generalPo || "",
      boxRangeId: template.boxRangeId || "",
      boxRangeSequence: Number(template.boxRangeSequence || 0),
      boxRangeTotal: Number(template.boxRangeTotal || 0),
      boxRangeLabel: template.boxRangeLabel || "",
      boxBuildMode: template.boxBuildMode || "INDIVIDUAL",
      boxBuildGroupId: template.boxBuildGroupId || "",
      mixedAnyLength: template.boxBuildMode === "MIXTO_ABIERTO" && template.mixedAnyLength !== false,
      mixedExcludedVarieties: Array.isArray(template.mixedExcludedVarieties) ? [...template.mixedExcludedVarieties] : [],
      addedRevision: order.revisionEditing ? order.revisionDraftNumber : order.revisionNumber || 1,
      state: "borrador"
    });
    order.lines.push(line);
    markRevisionChange(order, "CAJAS", [numericBox]);
    workflow.recordEvent(order, appState, {
      action: "AGREGAR_ITEM_CAJA",
      actionLabel: "Agregar item a caja",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se agrego un item a la caja ${numericBox}.`,
      result: "exitoso"
    });
    setNotice(appState, `Item agregado a la caja ${numericBox}. El precio por tallo queda pendiente de ingreso manual.`, "info");
    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
    return { ok: true, line };
  }

  function duplicateBox(appState, boxNumber) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede duplicar cajas en el estado actual.")) return { ok: false, error: "Pedido bloqueado." };
    const sourceLines = order.lines.filter(line => Number(line.boxNumber) === Number(boxNumber));
    if (!sourceLines.length) return { ok: false, error: "Caja no encontrada." };
    const nextBox = maxBoxNumber(order) + 1;
    const duplicateGroupId = BlessERP.utils.uid("COM-BOX-GRP");

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    sourceLines.forEach(source => order.lines.push(data.createLine({
      ...source,
      id: undefined,
      boxNumber: nextBox,
      scannedBunches: [],
      fulfillmentStatus: "PENDIENTE",
      reservationId: "",
      reservationSourceId: "",
      reservationBunchesUsed: 0,
      reservationNote: "",
      boxRangeId: "",
      boxRangeSequence: 0,
      boxRangeTotal: 0,
      boxRangeLabel: "",
      boxBuildGroupId: duplicateGroupId,
      mixedActualComposition: [],
      addedRevision: order.revisionEditing ? order.revisionDraftNumber : order.revisionNumber || 1,
      state: "borrador"
    })));
    markRevisionChange(order, "CAJAS", [nextBox]);
    workflow.recordEvent(order, appState, {
      action: "DUPLICAR_CAJA",
      actionLabel: "Duplicar caja",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se duplico la caja ${boxNumber} como caja ${nextBox}. Revise precios antes de enviar.`,
      result: "exitoso"
    });
    setNotice(appState, `Caja ${nextBox} duplicada. Revise precios y PO.`, "info");
    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
    return { ok: true, boxNumber: nextBox };
  }

  function deleteBox(appState, boxNumber) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede eliminar cajas en el estado actual.")) return { ok: false, error: "Pedido bloqueado." };
    const numericBox = Number(boxNumber || 0);
    const lines = order.lines.filter(line => Number(line.boxNumber) === numericBox);
    if (!lines.length) return { ok: false, error: "Caja no encontrada." };
    const scans = lines.reduce((sum, line) => sum + scannedCount(line), 0);
    if (scans > 0) {
      const error = `La caja ${numericBox} tiene ${scans} ramo(s) leido(s). Bodega debe desasignarlos antes de eliminarla.`;
      blockOrderEdit(appState, order, error);
      return { ok: false, error };
    }

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    order.lines = order.lines.filter(line => Number(line.boxNumber) !== numericBox);
    markRevisionChange(order, "CAJAS", [numericBox]);
    workflow.recordEvent(order, appState, {
      action: "ELIMINAR_CAJA",
      actionLabel: "Eliminar caja",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se elimino la caja ${numericBox} sin ramos asignados.`,
      result: "exitoso"
    });
    setNotice(appState, `Caja ${numericBox} eliminada.`, "warning");
    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
    return { ok: true };
  }

  function duplicateLine(appState, lineId) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableLines(appState, order, "No se puede duplicar lineas en el estado actual.")) return;

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    const line = order.lines.find(item => item.id === lineId);
    if (!line) return;
    if (order.revisionEditing && Number(line.addedRevision || 1) !== Number(order.revisionDraftNumber)) {
      blockOrderEdit(appState, order, "No se puede duplicar una caja anterior dentro de la revision. Agregue una caja nueva.");
      return;
    }
    order.lines.push(data.createLine({
      ...line,
      id: undefined,
      reservationId: "",
      reservationSourceId: "",
      reservationBunchesUsed: 0,
      reservationNote: "",
      scannedBunches: [],
      fulfillmentStatus: "PENDIENTE",
      addedRevision: order.revisionEditing ? order.revisionDraftNumber : order.revisionNumber || 1,
      state: "borrador"
    }));
    markRevisionChange(order, "CAJAS", [Number(line.boxNumber)]);
    workflow.recordEvent(order, appState, {
      action: "DUPLICAR_LINEA",
      actionLabel: "Duplicar linea",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se duplico la linea de la caja ${line.boxNumber} en estado borrador.`,
      result: "exitoso"
    });
    setNotice(appState, "Linea duplicada en estado borrador.", "info");
    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
  }

  function deleteLine(appState, lineId) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableLines(appState, order, "No se puede eliminar lineas en el estado actual.")) return;

    const line = order.lines.find(item => item.id === lineId);
    if (!line) return;
    if (order.revisionEditing && scannedCount(line) > 0) {
      blockOrderEdit(appState, order, "La linea tiene ramos leidos. Bodega debe desasignarlos antes de retirarla.");
      return;
    }
    if (!order.revisionEditing && line.state !== "borrador") {
      blockOrderEdit(appState, order, "Solo se pueden eliminar lineas en estado borrador.");
      return;
    }
    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    order.lines = order.lines.filter(item => item.id !== lineId);
    markRevisionChange(order, "CAJAS", [Number(line.boxNumber)]);
    workflow.recordEvent(order, appState, {
      action: "ELIMINAR_LINEA",
      actionLabel: "Eliminar linea",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se elimino la linea de la caja ${line.boxNumber}.`,
      result: "exitoso"
    });
    setNotice(appState, "Linea borrador eliminada.", "info");
    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
  }

  function saveCurrentOrder(appState) {
    const order = currentOrder(appState);
    if (!order) return;
    workflow.recordEvent(order, appState, {
      action: "GUARDAR_PEDIDO",
      actionLabel: "Guardar pedido",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Pedido ${order.number} guardado en almacenamiento local.`,
      result: "exitoso"
    });
    setNotice(appState, "Pedido demo guardado en almacenamiento local.", "info");
    saveDb();
  }

  function generateAccountingPreview(appState) {
    const order = currentOrder(appState);
    if (!order || !BlessERP.comercialAccountingPreview?.generatePreviewForOrder) return { ok: false };
    const result = BlessERP.comercialAccountingPreview.generatePreviewForOrder(order, appState);

    if (!result.ok) {
      setNotice(appState, result.errors?.[0] || "No se pudo generar el preview contable.", "warning");
      saveDb();
      return result;
    }

    workflow.recordEvent(order, appState, {
      action: "GENERAR_PREVIEW_CONTABLE",
      actionLabel: "Generar preview contable",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Preview contable generado para ${order.number} por ${utils.money(result.totals.totalUsd)}.`,
      result: "exitoso"
    });
    setNotice(appState, "Preview contable generado. No afecta Libro Diario ni Cartera real.", result.warnings.length ? "warning" : "success");
    saveDb();
    return result;
  }

  function generateAccountingPreviewById(appState, orderId) {
    const order = findOrder(appState, orderId);
    if (!order || !BlessERP.comercialAccountingPreview?.generatePreviewForOrder) return { ok: false };
    const result = BlessERP.comercialAccountingPreview.generatePreviewForOrder(order, appState);

    if (!result.ok) {
      setNotice(appState, result.errors?.[0] || "No se pudo generar el preview contable.", "warning");
      saveDb();
      return result;
    }

    workflow.recordEvent(order, appState, {
      action: "GENERAR_PREVIEW_CONTABLE",
      actionLabel: "Generar preview contable",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Preview contable generado para ${order.number} por ${utils.money(result.totals.totalUsd)}.`,
      result: "exitoso"
    });
    setNotice(appState, `Preview contable generado para ${order.number}.`, result.warnings.length ? "warning" : "success");
    saveDb();
    return result;
  }

  function markAccountingReady(appState) {
    const order = currentOrder(appState);
    if (!order || !BlessERP.comercialAccountingPreview?.markReadyForAccounting) return { ok: false };
    const result = BlessERP.comercialAccountingPreview.markReadyForAccounting(order, appState);

    if (!result.ok) {
      setNotice(appState, result.errors?.[0] || "No se pudo marcar el preview contable como listo.", "warning");
      saveDb();
      return result;
    }

    workflow.recordEvent(order, appState, {
      action: "MARCAR_LISTO_CONTABILIDAD_FUTURA",
      actionLabel: "Marcar listo contabilidad futura",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Pedido ${order.number} marcado como listo para contabilidad futura.`,
      result: "exitoso"
    });
    setNotice(appState, "Preview contable marcado como listo para contabilidad futura.", "success");
    saveDb();
    return result;
  }

  function markAccountingReadyById(appState, orderId) {
    const order = findOrder(appState, orderId);
    if (!order || !BlessERP.comercialAccountingPreview?.markReadyForAccounting) return { ok: false };
    const result = BlessERP.comercialAccountingPreview.markReadyForAccounting(order, appState);

    if (!result.ok) {
      setNotice(appState, result.errors?.[0] || "No se pudo marcar el preview contable como listo.", "warning");
      saveDb();
      return result;
    }

    workflow.recordEvent(order, appState, {
      action: "MARCAR_LISTO_CONTABILIDAD_FUTURA",
      actionLabel: "Marcar listo contabilidad futura",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Pedido ${order.number} marcado como listo para contabilidad futura.`,
      result: "exitoso"
    });
    setNotice(appState, `Pedido ${order.number} listo para contabilidad futura.`, "success");
    saveDb();
    return result;
  }

  function recalculatePackaging(appState) {
    const order = currentOrder(appState);
    if (!order) return;
    workflow.recordEvent(order, appState, {
      action: "RECALCULAR_BODEGA",
      actionLabel: "Recalcular bodega",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se recalcularon materiales demo para el pedido ${order.number}.`,
      result: "exitoso"
    });
    setNotice(appState, "Materiales recalculados en modo demo. No se consume inventario real.", "info");
    saveDb();
  }

  function markPackagingPrepared(appState) {
    const order = currentOrder(appState);
    if (!order) return false;
    order.packagingDemoStatus = "PREPARADO_DEMO";
    order.packagingPreparedAt = BlessERP.utils.today();
    workflow.recordEvent(order, appState, {
      action: "REVISAR_BODEGA",
      actionLabel: "Revisar bodega",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Bodega demo marcada como preparada para el pedido ${order.number}.`,
      result: "exitoso"
    });
    setNotice(appState, "Bodega marcada como preparada en modo demo.", "success");
    saveDb();
    return true;
  }

  function markPackagingConsumed(appState) {
    const order = currentOrder(appState);
    if (!order) return false;
    order.packagingDemoStatus = "CONSUMIDO_DEMO";
    order.packagingConsumedAt = BlessERP.utils.today();
    workflow.recordEvent(order, appState, {
      action: "CONSUMIR_BODEGA_DEMO",
      actionLabel: "Consumir bodega demo",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Materiales demo marcados como consumidos para el pedido ${order.number}.`,
      result: "exitoso"
    });
    setNotice(appState, "Materiales marcados como consumidos en modo demo. No se afectó stock real.", "warning");
    saveDb();
    return true;
  }

  function releaseReservationsForOrder(appState, orderId) {
    const service = getAvailabilityService();
    if (service?.releaseReservationsByOrderDemo) {
      service.releaseReservationsByOrderDemo(appState, orderId);
      return;
    }

    getReservations(appState)
      .filter(item => String(item.orderId || item.pedido_id) === String(orderId) && utils.isReservationActive(item))
      .forEach(item => {
        item.status = "liberado_demo";
        item.estado = "liberado_demo";
      });
  }

  function changeOrderStatusForOrder(appState, order, targetStatus, reason = "") {
    if (!order) return { ok: false, message: "Pedido no encontrado." };
    workflow.ensureOrderWorkflow(order, appState);

    const currentStatus = workflow.normalizeStatus(order.status);
    const nextStatus = workflow.normalizeStatus(targetStatus);
    const trimmedReason = String(reason || "").trim();

    if (!workflow.isTransitionAllowed(currentStatus, nextStatus)) {
      const message = `Transicion no permitida: ${currentStatus} -> ${nextStatus}.`;
      workflow.recordEvent(order, appState, {
        action: "BLOQUEAR_TRANSICION",
        actionLabel: "Bloqueo de transicion",
        previousStatus: currentStatus,
        nextStatus: currentStatus,
        description: message,
        reason: trimmedReason,
        result: "bloqueado"
      });
      setNotice(appState, message, "warning");
      saveDb();
      return { ok: false, message };
    }

    if (["ANULADO", "REABIERTO_DEMO"].includes(nextStatus) && !trimmedReason) {
      const message = nextStatus === "ANULADO"
        ? "Debe registrar un motivo para anular el pedido."
        : "Debe registrar un motivo para reabrir el pedido.";
      workflow.recordEvent(order, appState, {
        action: "BLOQUEAR_TRANSICION",
        actionLabel: "Bloqueo de transicion",
        previousStatus: currentStatus,
        nextStatus: currentStatus,
        description: message,
        result: "bloqueado"
      });
      setNotice(appState, message, "warning");
      saveDb();
      return { ok: false, message };
    }

    const review = workflow.buildTransitionValidation(order, nextStatus, appState);
    if (review.errors.length) {
      const message = `No se puede pasar a ${nextStatus}: ${review.errors[0]}`;
      workflow.recordEvent(order, appState, {
        action: "BLOQUEAR_TRANSICION",
        actionLabel: "Bloqueo de transicion",
        previousStatus: currentStatus,
        nextStatus: currentStatus,
        description: message,
        reason: trimmedReason,
        result: "bloqueado"
      });
      setNotice(appState, message, "warning");
      saveDb();
      return { ok: false, message, errors: review.errors };
    }

    order.status = nextStatus;
    order.statusUpdatedAt = nowForOrder();
    order.statusUpdatedBy = activeUser(appState).name || "Usuario demo";
    order.lastTransitionReason = trimmedReason;

    if (nextStatus === "ANULADO") {
      releaseReservationsForOrder(appState, order.id);
    }

    if (nextStatus === "REABIERTO_DEMO") {
      order.reopenedFromStatus = currentStatus;
    }

    if (currentStatus === "REABIERTO_DEMO" && ["BORRADOR", "REFERENCIAL"].includes(nextStatus)) {
      order.reopenedFromStatus = order.reopenedFromStatus || "REABIERTO_DEMO";
    }

    if (nextStatus === "DESPACHADO_DEMO") {
      order.dispatchedAt = BlessERP.utils.today();
    }

    if (nextStatus === "CERRADO_DEMO") {
      order.closedAt = BlessERP.utils.today();
    }

    workflow.recordEvent(order, appState, {
      action: "CAMBIAR_ESTADO_PEDIDO",
      actionLabel: "Cambiar estado",
      previousStatus: currentStatus,
      nextStatus,
      description: `Pedido ${order.number} movido de ${currentStatus} a ${nextStatus}.`,
      reason: trimmedReason,
      result: "exitoso",
      forceStatusStamp: true
    });

    const successMessage = nextStatus === "ANULADO"
      ? "Pedido anulado en modo demo. Las reservas demo quedaron liberadas."
      : `Pedido actualizado a ${nextStatus}.`;
    setNotice(appState, successMessage, nextStatus === "ANULADO" ? "warning" : "success");
    saveDb();
    return { ok: true, status: nextStatus };
  }

  function nowForOrder() {
    return new Date().toISOString();
  }

  function changeOrderStatus(appState, targetStatus, reason = "") {
    return changeOrderStatusForOrder(appState, currentOrder(appState), targetStatus, reason);
  }

  function changeOrderStatusById(appState, orderId, targetStatus, reason = "") {
    return changeOrderStatusForOrder(appState, findOrder(appState, orderId), targetStatus, reason);
  }

  function markReferential(appState) {
    return changeOrderStatus(appState, "REFERENCIAL");
  }

  function validateCurrentOrder(appState) {
    return changeOrderStatus(appState, "VALIDADO_COMERCIAL");
  }

  function markReadyWarehouse(appState) {
    const order = currentOrder(appState);
    const service = BlessERP.comercialOrderFulfillment;
    if (!order || !service?.releaseOrderToWarehouse) {
      return { ok: false, message: "Servicio de armado de Bodega no disponible." };
    }
    const currentStatus = workflow.normalizeStatus(order.status);
    const releaseCandidate = ["VALIDADO_COMERCIAL", "LISTO_BODEGA"].includes(currentStatus)
      ? order
      : { ...order, status: "VALIDADO_COMERCIAL" };
    const releaseValidation = service.validateRelease(releaseCandidate);
    if (!releaseValidation.ok) {
      setNotice(appState, releaseValidation.errors.join(" | "), "warning");
      return { ok: false, stage: "VALIDACION_ENVIO", error: "No se puede enviar el pedido a Bodega.", validation: releaseValidation };
    }

    if (!["VALIDADO_COMERCIAL", "LISTO_BODEGA"].includes(currentStatus)) {
      const automaticValidation = workflow.buildTransitionValidation(order, "VALIDADO_COMERCIAL", appState);
      if (automaticValidation.errors.length) {
        setNotice(appState, automaticValidation.errors.join(" | "), "warning");
        return {
          ok: false,
          error: "El pedido permanece en BORRADOR porque tiene errores.",
          validation: automaticValidation
        };
      }
      order.status = "VALIDADO_COMERCIAL";
      order.statusUpdatedAt = nowForOrder();
      order.statusUpdatedBy = activeUser(appState).name || "Usuario ventas demo";
      workflow.recordEvent(order, appState, {
        action: "VALIDAR_AUTOMATICAMENTE_BODEGA",
        actionLabel: "Validacion automatica para Bodega",
        previousStatus: currentStatus,
        nextStatus: "VALIDADO_COMERCIAL",
        description: `Pedido ${order.number} validado automaticamente al enviarse a Bodega.`,
        result: "exitoso"
      });
    }
    if (workflow.normalizeStatus(order.status) === "VALIDADO_COMERCIAL") {
      const transition = changeOrderStatusForOrder(appState, order, "LISTO_BODEGA");
      if (!transition.ok) return transition;
    }
    const demoUser = appState.db.session?.activeUser?.name || "Usuario ventas demo";
    const result = service.releaseOrderToWarehouse(appState, order.id, demoUser);
    if (!result.ok) {
      const detail = result.validation?.errors?.join(" | ") || result.error || "No se pudo liberar el pedido.";
      setNotice(appState, detail, "warning");
      return { ...result, stage: "LIBERACION_BODEGA" };
    }
    setNotice(appState, "Pedido liberado a Bodega. Los ramos se asignaran unicamente al escanearlos dentro de una caja.", "success");
    saveDb();
    return result;
  }

  function startOrderRevision(appState, reason = "") {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (["DESPACHADO_DEMO", "CERRADO_DEMO", "ANULADO"].includes(String(order.status || "").toUpperCase())) {
      return { ok: false, error: "Un pedido despachado, cerrado o anulado no puede modificarse. Cree un pedido complementario." };
    }
    if (String(order.warehouseStatus || "NO_LIBERADO") === "NO_LIBERADO") {
      return { ok: false, error: "El pedido aun no fue liberado a Bodega; puede editarlo normalmente." };
    }
    if (!String(reason || "").trim()) return { ok: false, error: "Debe registrar el motivo de la modificacion." };
    order.revisionSnapshot = buildRevisionSnapshot(order);
    order.revisionNumber = Number(order.revisionNumber || 1);
    order.revisionDraftNumber = order.revisionNumber + 1;
    order.revisionEditing = true;
    order.revisionReason = String(reason).trim();
    order.revisionBaseBoxNumbers = [...new Set((order.lines || []).map(line => Number(line.boxNumber)))];
    order.revisionAffectedBoxes = [];
    order.revisionChangeTypes = [];
    workflow.recordEvent(order, appState, {
      action: "INICIAR_REVISION_PEDIDO",
      actionLabel: "Iniciar revision del pedido",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se inicio la revision ${order.revisionDraftNumber}. Motivo: ${order.revisionReason}`,
      reason: order.revisionReason,
      result: "exitoso"
    });
    setNotice(appState, `Revision ${order.revisionDraftNumber} abierta. Puede corregir datos sin lectura; los ramos ya asignados permanecen protegidos.`, "info");
    saveDb();
    return { ok: true, order };
  }

  function cancelOrderRevision(appState) {
    const order = currentOrder(appState);
    if (!order?.revisionEditing) return { ok: false, error: "No existe una revision abierta." };
    const draftRevision = Number(order.revisionDraftNumber);
    restoreRevisionSnapshot(order);
    clearRevisionDraft(order);
    workflow.recordEvent(order, appState, {
      action: "CANCELAR_REVISION_PEDIDO",
      actionLabel: "Cancelar revision del pedido",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se cancelo la revision ${draftRevision}; no se alteraron cajas anteriores.`,
      result: "exitoso"
    });
    setNotice(appState, "Revision cancelada. Las cajas anteriores no fueron modificadas.", "info");
    saveDb();
    return { ok: true };
  }

  function submitOrderRevision(appState) {
    const order = currentOrder(appState);
    if (!order?.revisionEditing) return { ok: false, error: "No existe una revision abierta." };
    const draftRevision = Number(order.revisionDraftNumber);
    const newLines = (order.lines || []).filter(line => Number(line.addedRevision || 1) === draftRevision);
    const newBoxNumbers = [...new Set(newLines.map(line => Number(line.boxNumber)))].sort((a, b) => a - b);
    const previousBoxes = new Set((order.revisionBaseBoxNumbers || []).map(Number));
    const affectedBoxes = [...new Set([...(order.revisionAffectedBoxes || []), ...newBoxNumbers].map(Number).filter(Boolean))].sort((a, b) => a - b);
    const changeTypes = [...new Set(order.revisionChangeTypes || [])];
    const errors = [];
    if (!changeTypes.length && !affectedBoxes.length) errors.push("No se detectaron cambios para enviar a Bodega.");
    if (newBoxNumbers.some(boxNumber => previousBoxes.has(boxNumber))) errors.push("Una caja nueva no puede usar el numero de una caja anterior.");
    (order.lines || []).forEach(line => {
      if (!line.variety || Number(line.length) <= 0 || Number(line.bunches) <= 0 || Number(line.stemsPerBunch) <= 0) errors.push(`Caja ${line.boxNumber}: detalle incompleto.`);
      if (Number(line.unitPrice) <= 0) errors.push(`Caja ${line.boxNumber}: falta precio manual por tallo.`);
      if (Number(line.bunches) < scannedCount(line)) errors.push(`Caja ${line.boxNumber}: la cantidad no puede ser menor que los ramos leidos.`);
    });
    if (errors.length) return { ok: false, error: errors.join(" | "), errors };

    newLines.forEach(line => { line.state = "confirmado"; });
    order.revisionNumber = draftRevision;
    order.changeNotifications = Array.isArray(order.changeNotifications) ? order.changeNotifications : [];
    const affectsLabels = affectedBoxes.length > 0 && changeTypes.some(type => ["CAJAS", "MARCACION", "LOGISTICA_ETIQUETA"].includes(type));
    const labelsWerePrinted = Boolean(order.documentActivity?.ETIQUETAS?.printedAt);
    let reprintMessage = "";

    if (affectsLabels && labelsWerePrinted) {
      const previousLabelRevision = Number(order.labelRevision || 1);
      order.labelRevision = previousLabelRevision + 1;
      order.labelReprintRequired = true;
      order.invalidatedLabels = Array.isArray(order.invalidatedLabels) ? order.invalidatedLabels : [];
      order.invalidatedLabels.unshift({
        revision: previousLabelRevision,
        boxes: [...affectedBoxes],
        invalidatedAt: new Date().toISOString(),
        invalidatedBy: appState.db.session?.activeUser?.name || "Usuario ventas demo",
        reason: order.revisionReason
      });
      order.documentActivity.ETIQUETAS = {
        ...(order.documentActivity.ETIQUETAS || {}),
        lastAction: "invalidated",
        invalidatedAt: new Date().toISOString(),
        printedAt: "",
        reprintRequired: true,
        revision: order.labelRevision
      };
      affectedBoxes.forEach(boxNumber => {
        order.boxFulfillment[boxNumber] = {
          ...(order.boxFulfillment[boxNumber] || {}),
          labelStatus: "REIMPRESION_REQUERIDA",
          labelRevision: order.labelRevision
        };
      });
      reprintMessage = ` Etiqueta anterior anulada; imprimir revision R${order.labelRevision}.`;
    }

    const notification = {
      id: BlessERP.utils.uid("COM-CAMBIO"),
      revision: draftRevision,
      type: changeTypes.includes("CAJAS") ? "CAMBIO_CAJAS" : changeTypes.includes("LOGISTICA_ETIQUETA") ? "CAMBIO_LOGISTICA" : "CAMBIO_COMERCIAL",
      boxNumbers: affectedBoxes,
      changeTypes,
      reason: order.revisionReason,
      message: affectedBoxes.length
        ? `Pedido actualizado en caja${affectedBoxes.length > 1 ? "s" : ""} ${affectedBoxes.join(", ")}.${reprintMessage}`
        : `Datos comerciales del pedido actualizados.${reprintMessage}`,
      status: "NUEVA",
      createdAt: new Date().toISOString(),
      createdBy: appState.db.session?.activeUser?.name || "Usuario ventas demo",
      acknowledgedAt: "",
      acknowledgedBy: ""
    };
    order.changeNotifications.unshift(notification);
    newBoxNumbers.forEach(boxNumber => {
      order.boxFulfillment[boxNumber] = { ...(order.boxFulfillment[boxNumber] || {}), addedRevision: draftRevision, isNew: true };
    });
    order.warehouseStatus = "ACTUALIZADO_POR_VENTAS";
    order.fulfillmentStatus = "ACTUALIZADO_POR_VENTAS";
    order.warehouseCompletedAt = "";
    if (String(order.status || "").toUpperCase() === "LISTO_DESPACHO") order.status = "LISTO_BODEGA";
    workflow.recordEvent(order, appState, {
      action: "ENVIAR_REVISION_BODEGA",
      actionLabel: "Enviar revision a Bodega",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Revision ${draftRevision} enviada a Bodega. ${notification.message} Motivo: ${notification.reason}`,
      reason: notification.reason,
      result: "exitoso"
    });
    clearRevisionDraft(order);
    setNotice(appState, `${notification.message} Bodega recibio la revision ${draftRevision}.`, "success");
    saveDb();
    return { ok: true, notification, order };
  }

  function markReadyDispatch(appState) {
    return changeOrderStatus(appState, "LISTO_DESPACHO");
  }

  function markDispatchedDemo(appState) {
    return changeOrderStatus(appState, "DESPACHADO_DEMO");
  }

  function closeCurrentOrder(appState) {
    return changeOrderStatus(appState, "CERRADO_DEMO");
  }

  function annulCurrentOrder(appState, reason = "") {
    return changeOrderStatus(appState, "ANULADO", reason);
  }

  function reopenCurrentOrder(appState, reason = "") {
    return changeOrderStatus(appState, "REABIERTO_DEMO", reason);
  }

  function createNewOrder(appState) {
    const store = ensureStore(appState);
    const order = data.createOrder({
      id: BlessERP.utils.uid("COM-ORD"),
      number: nextOrderNumber(store.orders),
      issuedAt: BlessERP.utils.today(),
      flightDate: BlessERP.utils.today(),
      status: "BORRADOR",
      transportType: "aereo",
      paymentTerms: data.company.paymentTermsDefault,
      expireDate: BlessERP.utils.today()
    });
    store.orders.unshift(order);
    store.ui.currentOrderId = order.id;
    store.ui.orderTab = "summary";
    store.ui.accountingPreviewView = "summary";
    store.ui.packagingViewMode = "material";
    resetLabelSelection(store, order);
    resetClientInvoiceOptions(store);
    order.historySeedDisabled = true;
    workflow.ensureOrderWorkflow(order, appState);
    order.history = [];
    workflow.recordEvent(order, appState, {
      action: "CREAR_PEDIDO",
      actionLabel: "Crear pedido",
      previousStatus: "BORRADOR",
      nextStatus: "BORRADOR",
      description: `Nuevo Pedido Maestro ${order.number} creado en borrador.`,
      result: "exitoso"
    });
    delete order.historySeedDisabled;
    setNotice(appState, "Nuevo Pedido Maestro creado en borrador.", "info");
    saveDb();
  }

  function openOrder(appState, orderId) {
    const store = ensureStore(appState);
    if (!store.orders.some(order => order.id === orderId)) return false;
    store.ui.currentOrderId = orderId;
    store.ui.orderTab = "summary";
    store.ui.accountingPreviewView = "summary";
    store.ui.packagingViewMode = "material";
    resetLabelSelection(store, store.orders.find(order => order.id === orderId));
    resetClientInvoiceOptions(store);
    clearNotice(appState);
    saveDb();
    return true;
  }

  function duplicateOrder(appState, orderId) {
    const store = ensureStore(appState);
    const source = store.orders.find(order => order.id === orderId);
    if (!source) return false;

    const clone = data.createOrder({
      ...source,
      id: BlessERP.utils.uid("COM-ORD"),
      number: nextOrderNumber(store.orders),
      issuedAt: BlessERP.utils.today(),
      flightDate: BlessERP.utils.today(),
      status: "BORRADOR",
      awb: "",
      hawb: "",
      daeNumber: "",
      daeDestination: "",
      daeExpirationDate: "",
      daeAssignedAutomatically: false,
      daeModifiedManual: false,
      packagingDemoStatus: "",
      packagingPreparedAt: "",
      packagingConsumedAt: "",
      warehouseStatus: "NO_LIBERADO",
      warehouseReleasedAt: "",
      warehouseReleasedBy: "",
      warehouseCompletedAt: "",
      boxFulfillment: {},
      fulfillmentStatus: "NO_LIBERADO",
      fulfillmentHistory: [],
      revisionNumber: 1,
      revisionEditing: false,
      revisionDraftNumber: 0,
      revisionReason: "",
      revisionBaseBoxNumbers: [],
      changeNotifications: [],
      accountingPreview: {
        state: "NO_GENERADO",
        asientoPreviewId: "",
        cxcPreviewId: "",
        generatedAt: "",
        generatedBy: "",
        readyAt: "",
        readyBy: "",
        observation: "",
        snapshot: null
      },
      documentActivity: {},
      history: [],
      lines: source.lines.map(line => ({
        ...line,
        id: undefined,
        reservationId: "",
        reservationSourceId: "",
        reservationBunchesUsed: 0,
        reservationNote: "",
        scannedBunches: [],
        fulfillmentStatus: "PENDIENTE",
        addedRevision: 1,
        state: "borrador"
      }))
    });

    if (clone.brandId) {
      applyBrand(clone);
    }

    store.orders.unshift(clone);
    store.ui.currentOrderId = clone.id;
    store.ui.orderTab = "summary";
    store.ui.accountingPreviewView = "summary";
    store.ui.packagingViewMode = "material";
    resetLabelSelection(store, clone);
    resetClientInvoiceOptions(store);
    clone.historySeedDisabled = true;
    workflow.ensureOrderWorkflow(clone, appState);
    clone.history = [];
    workflow.recordEvent(clone, appState, {
      action: "DUPLICAR_PEDIDO",
      actionLabel: "Duplicar pedido",
      previousStatus: "BORRADOR",
      nextStatus: "BORRADOR",
      description: `Pedido duplicado desde ${source.number}.`,
      result: "exitoso"
    });
    delete clone.historySeedDisabled;
    setNotice(appState, `Pedido duplicado desde ${source.number} en estado BORRADOR.`, "info");
    saveDb();
    return true;
  }

  function reserveAvailability(appState, availabilityId) {
    const order = currentOrder(appState);
    if (!order) return false;
    if (!ensureEditableLines(appState, order, "Las reservas comerciales requieren un pedido editable.")) return false;

    const service = getAvailabilityService();
    const store = ensureStore(appState);
    const row = utils.getAvailabilityRowsWithReservations(appState).find(item => String(item.id) === String(availabilityId));
    if (!row) {
      blockOrderEdit(appState, order, "La disponibilidad demo seleccionada no existe.");
      return false;
    }
    const requestedBunches = Math.max(
      1,
      utils.parseNumber(store.ui.availabilityReserveDrafts[String(availabilityId)], 1)
    );

    const result = service?.reserveAvailabilityDemo
      ? service.reserveAvailabilityDemo(appState, {
          availability_id: row.availability_id,
          pedido_id: order.id,
          numero_pedido: order.number,
          cliente_principal: utils.findCustomer(order.customerId)?.commercialName || "",
          marca_cliente_final: utils.findBrand(order.brandId)?.name || "",
          fecha_pedido: order.issuedAt || BlessERP.utils.today(),
          fecha_vuelo: order.flightDate || "",
          ramos_reservados: requestedBunches,
          usuario_demo: activeUser(appState).name || "Usuario demo",
          observacion: "Reserva demo creada desde Comercial / Pedido Maestro."
        })
      : { ok: false, error: "Servicio demo de disponibilidad no cargado." };

    if (!result.ok) {
      blockOrderEdit(appState, order, result.error || "No se pudo registrar la reserva demo.");
      return false;
    }

    workflow.recordEvent(order, appState, {
      action: "RESERVAR_DISPONIBILIDAD",
      actionLabel: "Reservar disponibilidad",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Reserva demo registrada para ${row.variety} ${row.length} cm desde Operaciones.`,
      result: "exitoso"
    });
    store.ui.availabilityReserveDrafts[String(availabilityId)] = requestedBunches;
    setNotice(appState, "Reserva demo registrada. No consume inventario ni disponibilidad real.", "info");
    saveDb();
    return true;
  }

  function releaseReservation(appState, reservationId) {
    const order = currentOrder(appState);
    if (!order) return false;
    const service = getAvailabilityService();
    const reservation = getReservations(appState).find(item => String(item.reservation_id || item.id) === String(reservationId));
    if (!reservation) return false;

    const updated = service?.releaseReservationDemo
      ? service.releaseReservationDemo(appState, reservationId)
      : null;

    if (!updated) {
      blockOrderEdit(appState, order, "No se pudo liberar la reserva demo seleccionada.");
      return false;
    }

    workflow.recordEvent(order, appState, {
      action: "LIBERAR_RESERVA",
      actionLabel: "Liberar reserva",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Reserva demo ${reservationId} liberada desde Comercial.`,
      result: "exitoso"
    });
    setNotice(appState, "Reserva demo liberada. La disponibilidad vuelve a mostrarse en Operaciones.", "warning");
    saveDb();
    return true;
  }

  function confirmReservation(appState, reservationId) {
    const order = currentOrder(appState);
    if (!order) return false;
    const service = getAvailabilityService();
    const reservation = getReservations(appState).find(item => String(item.reservation_id || item.id) === String(reservationId));
    if (!reservation) return false;

    const updated = service?.confirmReservationDemo
      ? service.confirmReservationDemo(appState, reservationId)
      : null;

    if (!updated) {
      blockOrderEdit(appState, order, "No se pudo confirmar la reserva demo seleccionada.");
      return false;
    }

    workflow.recordEvent(order, appState, {
      action: "CONFIRMAR_RESERVA",
      actionLabel: "Confirmar reserva",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Reserva demo ${reservationId} confirmada para el pedido ${order.number}.`,
      result: "exitoso"
    });
    setNotice(appState, "Reserva demo confirmada. Aun no se descuenta inventario real.", "success");
    saveDb();
    return true;
  }

  function createLineFromReservation(appState, reservationId) {
    const order = currentOrder(appState);
    if (!order) return false;
    if (!ensureEditableLines(appState, order, "Las lineas del pedido estan bloqueadas. Reabra el pedido para usar reservas demo.")) return false;

    const reservation = getReservations(appState).find(item => String(item.reservation_id || item.id) === String(reservationId));
    if (!reservation || !utils.isReservationActive(reservation)) {
      blockOrderEdit(appState, order, "La reserva demo seleccionada no esta disponible para crear una linea.");
      return false;
    }

    const store = ensureStore(appState);
    const draft = getReservationLineDraft(store, order, reservation);
    const bunchesUsed = Math.max(
      1,
      Math.min(
        utils.parseNumber(draft.bunchesUsed, 1),
        utils.parseNumber(reservation.ramos_reservados || reservation.bunchesReserved, 0)
      )
    );

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    order.lines.push(data.createLine({
      boxNumber: utils.parseNumber(draft.boxNumber, maxBoxNumber(order) + 1),
      boxType: draft.boxType || "HB",
      variety: reservation.variedad || reservation.variety || "EXPLORER",
      po: draft.po || order.generalPo || "",
      length: utils.parseNumber(reservation.longitud || reservation.length, 60),
      bunches: bunchesUsed,
      stemsPerBunch: utils.parseNumber(reservation.tallos_por_ramo || reservation.stemsPerBunch, 25),
      unitPrice: utils.parseNumber(draft.unitPrice, 0.28),
      reservationId: reservation.reservation_id || reservation.id,
      reservationSourceId: reservation.availability_id || reservation.availabilityId || "",
      reservationBunchesUsed: bunchesUsed,
      reservationNote: "Linea creada desde reserva demo Operaciones -> Comercial.",
      state: "reservado"
    }));

    workflow.recordEvent(order, appState, {
      action: "CREAR_LINEA_DESDE_RESERVA",
      actionLabel: "Crear linea desde reserva",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se creo una linea comercial desde la reserva demo ${reservationId}.`,
      result: "exitoso"
    });
    setNotice(appState, "Linea comercial creada desde reserva demo. Revise precio y PO antes de validar.", "info");
    ensureLabelSelection(ensureStore(appState), order);
    saveDb();
    return true;
  }

  BlessERP.comercialState = {
    addLine,
    addBoxRange,
    addManualMixDraftItem,
    addItemToBox,
    cancelOrderRevision,
    annulCurrentOrder,
    changeOrderStatus,
    changeOrderStatusById,
    clearNotice,
    closeCurrentOrder,
    confirmReservation,
    createLineFromReservation,
    createNewOrder,
    currentOrder,
    deleteLine,
    deleteBox,
    duplicateLine,
    duplicateBox,
    duplicateOrder,
    deleteAirline,
    findOrder,
    getAgencyCatalog,
    getAirlineCatalog,
    getBrandCatalog,
    getBoxRangeDraft,
    getCustomerCatalog,
    getDaeCatalog,
    getDestinationCatalog,
    getOrders,
    getReservations,
    getStore,
    getUi,
    generateAccountingPreview,
    generateAccountingPreviewById,
    markDispatchedDemo,
    markAccountingReady,
    markAccountingReadyById,
    markPackagingConsumed,
    markPackagingPrepared,
    markReadyDispatch,
    markReadyWarehouse,
    markReferential,
    newCustomer,
    newDae,
    newDestination,
    newBrand,
    newAgency,
    newAirline,
    openOrder,
    recalculatePackaging,
    releaseReservation,
    removeManualMixDraftItem,
    reopenCurrentOrder,
    reserveAvailability,
    saveCurrentOrder,
    startOrderRevision,
    submitOrderRevision,
    saveAgency,
    saveAirline,
    saveBrand,
    saveCustomer,
    saveDae,
    saveDestination,
    setAvailabilityFilter,
    setAvailabilityReserveQty,
    setClientInvoiceToggle,
    setClientInvoiceViewMode,
    setCurrentOrder,
    setAccountingPreviewView,
    setHistoryFilter,
    setHistorySearch,
    setHistoryStatus,
    setLabelPrintField,
    setLabelPrintMode,
    setNotice,
    setOrderTab,
    setOrderDetailBox,
    setOrderScanCode,
    setOrdersDayDate,
    setPackagingViewMode,
    setReservationLineDraft,
    setBoxBuilderMode,
    selectCustomer,
    selectDae,
    selectDestination,
    selectBrand,
    selectAgency,
    selectAirline,
    updateAgencyDraftField,
    updateAirlineDraftField,
    updateBrandDraftField,
    updateBoxRangeDraft,
    updateManualMixDraftItem,
    updateCustomerDraftField,
    updateDaeDraftField,
    updateDestinationDraftField,
    updateLineField,
    updateOrderField,
    toggleDaeCustomer,
    validateCurrentOrder
  };
})();
