(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;
  const invoiceSequence = BlessERP.comercialInvoiceSequence;
  const requestedOrderId = String(
    window.URLSearchParams && window.location
      ? new window.URLSearchParams(window.location.search).get("order")
      : ""
  ).trim();
  let requestedOrderPending = Boolean(requestedOrderId);
  let initialOrderWorkspaceResolved = false;
  let orderWorkspacePreparedInThisTab = false;
  let tabOrderWorkspaceId = "";
  let normalizedStore = null;
  let normalizedCollectionRefs = null;
  let noticeTimer = 0;
  let orderDraftSaveTimer = 0;
  let orderDraftIdleHandle = 0;
  const orderDraftReleaseById = new Map();
  const orderDraftSnapshotById = new Map();
  const DEMO_ORDER_SELLERS = Object.freeze({
    "order-demo-0001": "SELL-BLF-001",
    "order-demo-0002": "SELL-BLF-002",
    "order-demo-0003": "SELL-BLF-001",
    "order-demo-0004": "SELL-BLF-002",
    "order-demo-0005": "SELL-BLF-001",
    "order-demo-0006": "SELL-BLF-002"
  });

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

  function saveConfirmedCatalogCache() {
    const saveLocalOnly = BlessERP.state?.saveDbLocalOnly;
    if (typeof saveLocalOnly !== "function") return true;
    return saveLocalOnly() !== false;
  }

  function activeCompanyId(appState) {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || BlessERP.companyCapabilities?.companyIdOf?.(appState?.db?.activeCompanyId)
      || "COMP-BLESS-FLOWER";
  }

  function bindCatalogCompany(record, appState) {
    const companyId = activeCompanyId(appState);
    record.companyId = companyId;
    record.company_id = companyId;
    return record;
  }

  async function persistCatalogRecord(appState, repository, record, label) {
    if (!repository?.configured?.()) {
      const message = `Supabase debe confirmar ${label}. No se guardó localmente.`;
      setNotice(appState, message, "warning");
      return { ok: false, message, mode: "REMOTE_REQUIRED" };
    }
    const result = await repository.save(record);
    if (!result?.ok || result.confirmed !== true || result.status !== "SYNCED") {
      const message = result?.message || `Supabase no confirmó ${label}.`;
      setNotice(appState, message, "warning");
      return { ok: false, message, mode: result?.mode || "REMOTE_NOT_CONFIRMED" };
    }
    return result;
  }

  async function removeCatalogRecord(appState, repository, record, label) {
    if (!repository?.configured?.()) {
      const message = `Supabase debe confirmar la eliminación de ${label}. No se modificó la caché.`;
      setNotice(appState, message, "warning");
      return { ok: false, message, mode: "REMOTE_REQUIRED" };
    }
    const result = await repository.remove(bindCatalogCompany({ ...record }, appState));
    if (!result?.ok || result.confirmed !== true || result.status !== "SYNCED") {
      const message = result?.message || `Supabase no confirmó la eliminación de ${label}.`;
      setNotice(appState, message, "warning");
      return { ok: false, message, mode: result?.mode || "REMOTE_NOT_CONFIRMED" };
    }
    return result;
  }

  function normalizePersonName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function normalizePayrollEmployee(employee = {}) {
    const employeeId = employee.employee_id || employee.employeeId || employee.id || "";
    const sellerId = employee.seller_id || employee.sellerId || employee.vendedor_id || employee.vendedorId || "";
    const fullName = employee.full_name || employee.fullName || employee.name || employee.nombre || "";
    return {
      ...employee,
      employee_id: employeeId,
      employeeId,
      seller_id: sellerId,
      sellerId,
      full_name: fullName,
      fullName
    };
  }

  function listPayrollEmployees(appState) {
    try {
      const serviceRows = BlessERP.payrollService?.listEmployees?.({ includeInactive: true });
      if (Array.isArray(serviceRows)) return serviceRows.map(normalizePayrollEmployee);
      const direct = appState?.db?.payroll?.employees;
      if (Array.isArray(direct)) return direct.map(normalizePayrollEmployee);
      const seedRows = BlessERP.payrollData?.createDemoEmployees?.();
      return Array.isArray(seedRows) ? seedRows.map(normalizePayrollEmployee) : [];
    } catch (error) {
      const direct = appState?.db?.payroll?.employees;
      if (Array.isArray(direct)) return direct.map(normalizePayrollEmployee);
      const seedRows = BlessERP.payrollData?.createDemoEmployees?.();
      return Array.isArray(seedRows) ? seedRows.map(normalizePayrollEmployee) : [];
    }
  }

  function listSalespeople(appState) {
    return listPayrollEmployees(appState)
      .filter(employee => employee.seller_id && !["INACTIVO", "INACTIVE"].includes(String(employee.status || employee.state || "").toUpperCase()))
      .sort((left, right) => left.full_name.localeCompare(right.full_name));
  }

  function applySellerLink(order, sellerId, appState, options = {}) {
    const normalizedSellerId = String(sellerId || "").trim();
    const seller = listSalespeople(appState).find(item => item.seller_id === normalizedSellerId);
    const visibleName = seller?.full_name || options.visibleName || order.seller_name || order.sellerName || order.vendedorNombre || "";
    order.seller_id = normalizedSellerId;
    order.sellerId = normalizedSellerId;
    order.vendedorId = normalizedSellerId;
    order.seller_name = visibleName;
    order.sellerName = visibleName;
    order.vendedorNombre = visibleName;
    order.sellerEmployeeId = seller?.employee_id || order.sellerEmployeeId || "";
    order.sellerLinkSource = normalizedSellerId
      ? (seller ? "PAYROLL_EMPLOYEE" : (options.source || "EXPLICIT_ID"))
      : "";
    return seller || null;
  }

  function migrateLegacySellerLink(order, appState) {
    const explicitSellerId = order.seller_id || order.sellerId || order.vendedor_id || order.vendedorId || "";
    if (explicitSellerId) {
      applySellerLink(order, explicitSellerId, appState, {
        visibleName: order.seller_name || order.sellerName || order.vendedor_nombre || order.vendedorNombre || "",
        source: "LEGACY_ID"
      });
      return;
    }
    const legacyName = order.seller_name || order.sellerName || order.vendedor_nombre || order.vendedorNombre || order.nombreVendedor || "";
    if (!legacyName) return;
    const matches = listSalespeople(appState).filter(item => normalizePersonName(item.full_name) === normalizePersonName(legacyName));
    if (matches.length === 1) {
      applySellerLink(order, matches[0].seller_id, appState, {
        visibleName: matches[0].full_name,
        source: "LEGACY_NAME_MIGRATION"
      });
    }
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

  function ensurePrintCenterUi(store) {
    const modes = ["LABELS", "AGENCY_INVOICE", "CLIENT_INVOICE", "SRI_INVOICE"];
    store.ui.printCenterDocument = modes.includes(store.ui.printCenterDocument)
      ? store.ui.printCenterDocument
      : "LABELS";
    store.ui.printCenterInvoiceFilter = String(store.ui.printCenterInvoiceFilter || "");
    store.ui.printCenterCustomerId = String(store.ui.printCenterCustomerId || "");
    store.ui.printCenterSelectedOrderIds = Array.isArray(store.ui.printCenterSelectedOrderIds)
      ? [...new Set(store.ui.printCenterSelectedOrderIds.filter(Boolean))]
      : [];
  }

  function commercialCollectionRefs(store) {
    return {
      countries: store?.countryCatalog,
      customers: store?.customerCatalog,
      agencies: store?.agencyCatalog,
      airlines: store?.airlineCatalog,
      destinations: store?.destinationCatalog,
      daes: store?.daeCatalog,
      brands: store?.brandCatalog,
      orders: store?.orders,
      reservations: store?.reservations
    };
  }

  function sameCommercialCollectionRefs(store) {
    if (!normalizedCollectionRefs) return false;
    const current = commercialCollectionRefs(store);
    return Object.keys(current).every(key => current[key] === normalizedCollectionRefs[key]);
  }

  function ensureStore(appState) {
    const currentStore = appState.db.commercial;
    // La sincronización incremental sustituye la colección afectada cuando
    // recibe datos remotos. Mientras las referencias no cambien, los registros
    // ya están normalizados y no deben recorrerse otra vez en cada render.
    if (currentStore && currentStore === normalizedStore && sameCommercialCollectionRefs(currentStore)) {
      return currentStore;
    }
    const base = data.createCommercialStore();
    appState.db.commercial = mergeMissing(base, appState.db.commercial || {});
    const store = appState.db.commercial;

    const countriesUseCanonicalServerAuthority = BlessERP.syncEntityRegistry
      ?.hasCanonicalServerEvidence?.(appState.db, "commercial_countries") === true;
    store.countryCatalog = (store.countryCatalog || []).map(data.createCountry);
    const referencedCountries = [
      ...(store.customerCatalog || []).map(item => item.country),
      ...(store.brandCatalog || []).map(item => item.country),
      ...(store.destinationCatalog || []).map(item => item.country),
      ...(store.daeCatalog || []).map(item => item.country)
    ].map(item => String(item || "").trim()).filter(Boolean);
    if (!countriesUseCanonicalServerAuthority) {
      referencedCountries.forEach(countryName => {
        const exists = store.countryCatalog.some(item => item.name.toUpperCase() === countryName.toUpperCase());
        if (!exists) store.countryCatalog.push(data.createCountry({
          code: nextCatalogCode(store.countryCatalog, "PAIS"),
          name: countryName,
          status: "ACTIVO"
        }));
      });
    }
    data.countries.splice(0, data.countries.length, ...store.countryCatalog.map(item => BlessERP.utils.clone(item)));
    const countryDraftIsNew = Boolean(store.ui.countryDraft?.id && !store.countryCatalog.some(item => item.id === store.ui.countryDraft.id));
    if (!store.countryCatalog.some(item => item.id === store.ui.selectedCountryId) && !countryDraftIsNew) {
      store.ui.selectedCountryId = store.countryCatalog[0]?.id || "";
    }
    const selectedCountry = store.countryCatalog.find(item => item.id === store.ui.selectedCountryId);
    store.ui.countryDraft = data.createCountry(store.ui.countryDraft?.id ? store.ui.countryDraft : selectedCountry || {});

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

    store.brandCatalog = (store.brandCatalog || []).map(brand => normalizeBrandCatalogLink(store, brand));
    data.brands.splice(0, data.brands.length, ...store.brandCatalog.map(item => BlessERP.utils.clone(item)));
    const brandDraftIsNew = Boolean(store.ui.brandDraft?.id && !store.brandCatalog.some(item => item.id === store.ui.brandDraft.id));
    if (!store.brandCatalog.some(item => item.id === store.ui.selectedBrandId) && !brandDraftIsNew) {
      store.ui.selectedBrandId = store.brandCatalog[0]?.id || "";
    }
    const selectedBrand = store.brandCatalog.find(item => item.id === store.ui.selectedBrandId);
    store.ui.brandDraft = normalizeBrandCatalogLink(store, store.ui.brandDraft?.id ? store.ui.brandDraft : selectedBrand || {});

    store.orders = (Array.isArray(store.orders) ? store.orders : [])
      .filter(order => order && typeof order === "object")
      .map(order => {
      const normalized = utils.normalizeOrder(order);
      Object.assign(order, normalized);
      BlessERP.comercialIntercompany?.normalizeOrderCompanies?.(order);
      if (!order.seller_id && DEMO_ORDER_SELLERS[order.id] && order.demoSellerLinkInitialized !== true) {
        applySellerLink(order, DEMO_ORDER_SELLERS[order.id], appState, { source: "DEMO_ID_MIGRATION" });
        order.demoSellerLinkInitialized = true;
      }
      migrateLegacySellerLink(order, appState);
      workflow.ensureOrderWorkflow(order, appState);
      return order;
      });
    store.ui.localDraftOrderIds = Array.isArray(store.ui.localDraftOrderIds)
      ? [...new Set(store.ui.localDraftOrderIds.map(String).filter(orderId => store.orders.some(order => String(order.id) === orderId)))]
      : [];
    store.ui.localDraftOrderIds.forEach(ensureOrderDraftProtection);
    store.reservations = Array.isArray(store.reservations) ? store.reservations : [];
    ensureHistoryFilters(store);
    ensureAvailabilityUi(store);
    ensurePrintCenterUi(store);

    if (requestedOrderPending) {
      if (store.orders.some(order => order.id === requestedOrderId)) {
        store.ui.currentOrderId = requestedOrderId;
        store.ui.orderWorkspaceMode = "EDIT";
        store.ui.orderTab = "summary";
        store.ui.accountingPreviewView = "summary";
        store.ui.packagingViewMode = "material";
      }
      requestedOrderPending = false;
    }

    if (!store.orders.some(order => order.id === store.ui.currentOrderId)) {
      store.ui.currentOrderId = store.orders[0]?.id || "";
    }

    ensureClientInvoiceOptions(store);
    ensureAccountingPreviewView(store);
    ensureLabelSelection(store, store.orders.find(order => order.id === store.ui.currentOrderId));
    store.ui.labelSelectedOrderIds = [...new Set((store.ui.labelSelectedOrderIds || []).filter(orderId => store.orders.some(order => order.id === orderId)))];
    store.ui.printCenterSelectedOrderIds = store.ui.printCenterSelectedOrderIds.filter(orderId => store.orders.some(order => order.id === orderId));
    normalizedStore = store;
    normalizedCollectionRefs = commercialCollectionRefs(store);
    return store;
  }

  function ensureOrderDraftProtection(orderId) {
    const normalizedId = String(orderId || "").trim();
    if (!normalizedId) return false;
    BlessERP.offlineSync?.suspendRecordCapture?.("commercial_orders", normalizedId);
    if (!orderDraftReleaseById.has(normalizedId)) {
      const release = BlessERP.offlineSync?.holdRecord?.("commercial_orders", normalizedId);
      if (typeof release === "function") orderDraftReleaseById.set(normalizedId, release);
    }
    return true;
  }

  function beginOrderDraft(appState, order = null) {
    const store = ensureStore(appState);
    const target = order || store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    if (!target?.id) return null;
    const orderId = String(target.id);
    if (!target.unsavedDraft && !orderDraftSnapshotById.has(orderId)) {
      orderDraftSnapshotById.set(orderId, BlessERP.utils.clone(target));
    }
    store.ui.localDraftOrderIds = Array.isArray(store.ui.localDraftOrderIds)
      ? store.ui.localDraftOrderIds
      : [];
    if (!store.ui.localDraftOrderIds.includes(orderId)) store.ui.localDraftOrderIds.push(orderId);
    ensureOrderDraftProtection(orderId);
    return target;
  }

  function cancelScheduledOrderDraftSave() {
    if (orderDraftSaveTimer) clearTimeout(orderDraftSaveTimer);
    if (orderDraftIdleHandle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(orderDraftIdleHandle);
    }
    orderDraftSaveTimer = 0;
    orderDraftIdleHandle = 0;
  }

  function persistOrderDraftWhenIdle() {
    orderDraftIdleHandle = 0;
    BlessERP.performance?.measureSync?.("commercial-order:persistir-borrador", () => (
      BlessERP.state.saveDbLocalOnly?.() ?? BlessERP.state.saveDb()
    ));
  }

  function scheduleOrderDraftSave() {
    cancelScheduledOrderDraftSave();
    orderDraftSaveTimer = setTimeout(() => {
      orderDraftSaveTimer = 0;
      if (typeof window.requestIdleCallback === "function") {
        orderDraftIdleHandle = window.requestIdleCallback(persistOrderDraftWhenIdle, { timeout: 1200 });
      } else {
        persistOrderDraftWhenIdle();
      }
    }, 450);
    return true;
  }

  function saveOrderDraft(appState, order = null) {
    const target = beginOrderDraft(appState, order);
    if (!target) return false;
    BlessERP.state.markDataChanged?.();
    // El pedido permanece en memoria de inmediato. La copia local completa se
    // escribe después de la interacción para no bloquear selectores ni clics.
    return scheduleOrderDraftSave();
  }

  function prepareOrderDraftCommit(appState, order) {
    const store = ensureStore(appState);
    const orderId = String(order?.id || "").trim();
    if (!orderId) return false;
    if (!store.ui.localDraftOrderIds.includes(orderId)) store.ui.localDraftOrderIds.push(orderId);
    ensureOrderDraftProtection(orderId);
    BlessERP.offlineSync?.resumeRecordCapture?.("commercial_orders", orderId);
    return true;
  }

  async function completeOrderDraftCommit(appState, orderId) {
    const store = ensureStore(appState);
    const normalizedId = String(orderId || "").trim();
    store.ui.localDraftOrderIds = (store.ui.localDraftOrderIds || []).filter(id => String(id) !== normalizedId);
    BlessERP.offlineSync?.resumeRecordCapture?.("commercial_orders", normalizedId);
    const release = orderDraftReleaseById.get(normalizedId);
    orderDraftReleaseById.delete(normalizedId);
    orderDraftSnapshotById.delete(normalizedId);
    BlessERP.state.saveDbLocalOnly?.();
    if (typeof release === "function") await release();
  }

  function restoreOrderDraftAfterFailedCommit(appState, orderId) {
    const store = ensureStore(appState);
    const normalizedId = String(orderId || "").trim();
    if (normalizedId && !store.ui.localDraftOrderIds.includes(normalizedId)) {
      store.ui.localDraftOrderIds.push(normalizedId);
    }
    ensureOrderDraftProtection(normalizedId);
    BlessERP.state.saveDbLocalOnly?.();
  }

  function setNotice(appState, text, tone = "info") {
    const store = ensureStore(appState);
    store.ui.notice = text || "";
    store.ui.noticeTone = tone;
    if (text) BlessERP.layout?.toast?.(text, { tone });
    if (noticeTimer) clearTimeout(noticeTimer);
    if (text) {
      noticeTimer = setTimeout(() => {
        if (store.ui.notice === text && store.ui.noticeTone === tone) {
          store.ui.notice = "";
          store.ui.noticeTone = "info";
        }
        noticeTimer = 0;
      }, tone === "danger" ? 4600 : tone === "warning" ? 3400 : tone === "success" ? 1800 : 2400);
    }
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

  function configuredInvoiceSeries(appState, seed = {}) {
    const companyId = seed.sellingCompanyId || seed.selling_company_id || seed.companyId || seed.company_id || activeCompanyId(appState);
    const localSale = utils.isLocalOrder(seed);
    const base = invoiceSequence.saleSeries?.(
      companyId,
      localSale ? "LOCAL" : (seed.saleType || seed.sale_type),
      seed.transportType || seed.transport_type
    ) || {};
    const configured = BlessERP.services?.adminConfig?.findSequenceByCode?.(base.code) || null;
    const activeConfiguration = configured?.status === "activo" ? configured : null;
    return {
      ...base,
      establishment: activeConfiguration?.establishmentCode || base.establishment || "001",
      emissionPoint: activeConfiguration?.emissionPointCode || base.emissionPoint || "001",
      configured: activeConfiguration
    };
  }

  function nextInvoiceSequence(orders, seed = {}, appState = null) {
    const series = configuredInvoiceSeries(appState, seed);
    const configured = series.configured;
    const sameSeriesOrders = (orders || []).filter(order => {
      const parts = invoiceSequence.fullNumberParts(order.sriInvoiceNumber);
      if (!parts) return false;
      return parts.establishment === (series.establishment || configured?.establishmentCode || "001")
        && parts.emissionPoint === (series.emissionPoint || configured?.emissionPointCode || "001");
    });
    return invoiceSequence.nextSequence(sameSeriesOrders, {
      currentNumber: configured?.status === "activo" ? configured.currentNumber : 0
    });
  }

  function enforceOrderInvoiceSeries(appState, order, options = {}) {
    if (!order) return { changed: false };
    const sriAuthorized = String(order.sriAuthorizationStatus || "").toUpperCase() === "AUTORIZADO" || Boolean(order.sriAuthorizedAt);
    if (sriAuthorized) return { changed: false, authorized: true };
    const series = configuredInvoiceSeries(appState, order);
    const previousFullNumber = String(order.sriInvoiceNumber || "");
    const previousParts = invoiceSequence.fullNumberParts(previousFullNumber);
    if (!previousParts && options.allocate !== true) {
      return { changed: false, pendingSave: true, series };
    }
    const marketChanged = Boolean(previousParts) && (
      String(order.sriSeriesCode || "") !== String(series.code || "")
      || previousParts.establishment !== String(series.establishment || "001")
      || previousParts.emissionPoint !== String(series.emissionPoint || "001")
    );
    const reallocate = Boolean(options.reallocate || marketChanged || !previousParts);
    const orders = (appState.db.commercial?.orders || []).filter(item => item !== order && item.id !== order.id);
    const sequence = reallocate
      ? nextInvoiceSequence(orders, order, appState)
      : previousParts.sequence;
    const establishment = series.establishment || "001";
    const emissionPoint = series.emissionPoint || "001";
    const fullNumber = invoiceSequence.formatFullNumber(sequence, establishment, emissionPoint);
    const changed = fullNumber !== order.sriInvoiceNumber || marketChanged;
    if (reallocate && series.configured && options.commitCounter !== false) {
      const counterResult = BlessERP.services?.adminConfig?.saveSequence?.({
        ...series.configured,
        currentNumber: Math.max(Number(series.configured.currentNumber || 0), Number(sequence || 0))
      });
      if (counterResult && counterResult.ok === false) {
        return {
          changed: false,
          error: (counterResult.errors || ["No se pudo reservar el secuencial configurado."]).join(" "),
          series
        };
      }
    }
    order.sriInvoiceNumber = fullNumber;
    order.sriSequential = sequence;
    order.packingListNumber = sequence;
    order.invoicePackingNumber = sequence;
    order.clientInvoiceNumber = sequence;
    order.invoiceSequence = sequence;
    order.sriSeriesCode = series.code || (utils.isLocalOrder(order) ? "FAC_LOCAL" : "FAC_EXPORT");
    order.sriMarket = series.market || (utils.isLocalOrder(order) ? "LOCAL" : "EXPORTACION");
    order.establishmentCode = establishment;
    order.emissionPointCode = emissionPoint;
    order.sriSequenceStatus = "RESERVADO";
    order.sriSequenceSource = "LOCAL_RESERVADO";
    order.sriSequenceAllocatedAt = order.sriSequenceAllocatedAt || new Date().toISOString();
    if (changed && previousParts) {
      order.sriAccessKey = "";
      order.sriAuthorizationNumber = "";
      order.sriAuthorizedXml = "";
      order.sriRemoteDocumentId = "";
      order.sriQueueStatus = "PENDIENTE";
      order.sriQueuedAt = new Date().toISOString();
    }
    return { changed, series, fullNumber, sequence, reallocated: reallocate };
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

  function findCatalogCountry(store, value) {
    const normalized = String(value || "").trim().toUpperCase();
    return (store.countryCatalog || []).find(item => item.name.toUpperCase() === normalized) || null;
  }

  function findCatalogDestination(store, value) {
    const normalized = String(value || "").trim().toUpperCase();
    return (store.destinationCatalog || []).find(item => String(item.destination || "").trim().toUpperCase() === normalized) || null;
  }

  function normalizeBrandCatalogLink(store, seed) {
    const brand = data.createBrand(seed || {});
    const brandCountry = String(brand.country || "").trim().toUpperCase();
    const configuredDestination = findCatalogDestination(store, brand.destination);
    const destinationMatchesCountry = configuredDestination
      && (!brandCountry || String(configuredDestination.country || "").trim().toUpperCase() === brandCountry);
    if (!destinationMatchesCountry && brandCountry) {
      const countryDestinations = (store.destinationCatalog || []).filter(item => (
        String(item.status || "ACTIVO").toUpperCase() !== "INACTIVO"
        && String(item.country || "").trim().toUpperCase() === brandCountry
      ));
      if (countryDestinations.length === 1) brand.destination = countryDestinations[0].destination;
    }
    const resolvedDestination = findCatalogDestination(store, brand.destination);
    if (resolvedDestination) {
      brand.destination = resolvedDestination.destination;
      brand.country = findCatalogCountry(store, resolvedDestination.country)?.name || resolvedDestination.country;
    }
    return data.createBrand(brand);
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

  function getCustomerCatalog(appState, companyId = "") {
    const rows = ensureStore(appState).customerCatalog;
    return companyId ? rows.filter(item => String(item.companyId || item.company_id) === String(companyId)) : rows;
  }

  function getCountryCatalog(appState) {
    return ensureStore(appState).countryCatalog;
  }

  function selectCountry(appState, countryId) {
    const store = ensureStore(appState);
    const country = store.countryCatalog.find(item => item.id === countryId);
    if (!country) return false;
    store.ui.selectedCountryId = country.id;
    store.ui.countryDraft = data.createCountry(BlessERP.utils.clone(country));
    setNotice(appState, `Editando pais ${country.name}.`, "info");
    return true;
  }

  function newCountry(appState) {
    const store = ensureStore(appState);
    store.ui.selectedCountryId = "";
    store.ui.countryDraft = data.createCountry({
      companyId: activeCompanyId(appState),
      code: nextCatalogCode(store.countryCatalog, "PAIS"),
      status: "ACTIVO"
    });
    setNotice(appState, "Nuevo pais preparado.", "info");
    return store.ui.countryDraft;
  }

  function updateCountryDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.countryDraft;
    if (!draft || !(field in draft) || field === "code") return false;
    draft[field] = String(value || "").trim().toUpperCase();
    return true;
  }

  async function saveCountry(appState) {
    const store = ensureStore(appState);
    const draft = bindCatalogCompany(data.createCountry(store.ui.countryDraft || {}), appState);
    if (!draft.code) draft.code = nextCatalogCode(store.countryCatalog, "PAIS");
    if (!draft.name) {
      setNotice(appState, "Ingrese el nombre del pais.", "warning");
      return { ok: false };
    }
    const duplicateCode = store.countryCatalog.find(item => item.id !== draft.id && item.code.toUpperCase() === draft.code.toUpperCase());
    const duplicateName = store.countryCatalog.find(item => item.id !== draft.id && item.name.toUpperCase() === draft.name.toUpperCase());
    if (duplicateCode || duplicateName) {
      setNotice(appState, duplicateCode ? "Ya existe un pais con ese codigo." : "Ese pais ya existe en el catalogo.", "warning");
      return { ok: false };
    }
    const existing = store.countryCatalog.find(item => item.id === draft.id);
    const previousName = existing?.name || draft.name;
    if (existing && previousName.toUpperCase() !== draft.name.toUpperCase()) {
      const referenced = [
        ...store.customerCatalog,
        ...store.brandCatalog,
        ...store.destinationCatalog,
        ...store.daeCatalog
      ].some(item => String(item?.country || "").trim().toUpperCase() === previousName.toUpperCase())
        || store.orders.some(order => String(order.destinationCountry || "").trim().toUpperCase() === previousName.toUpperCase());
      if (referenced) {
        setNotice(appState, "No se puede renombrar un país ya utilizado. Actualice primero sus referencias o márquelo INACTIVO.", "warning");
        return { ok: false, reason: "COUNTRY_IN_USE" };
      }
    }
    const result = await persistCatalogRecord(appState, BlessERP.getCountryRepository?.(), draft, "el país");
    if (!result.ok) return result;
    const canonical = data.createCountry(result.record);
    const existingIndex = store.countryCatalog.findIndex(item => item.id === canonical.id);
    if (existingIndex >= 0) store.countryCatalog[existingIndex] = canonical;
    else store.countryCatalog.unshift(canonical);
    if (existing && previousName.toUpperCase() !== canonical.name.toUpperCase()) {
      const rename = item => {
        if (String(item?.country || "").trim().toUpperCase() === previousName.toUpperCase()) item.country = canonical.name;
      };
      // La edición se bloquea arriba cuando existen referencias persistidas.
      // Este paso conserva coherentes borradores/cachés que se hayan abierto
      // durante la confirmación remota, sin convertirlos en autoridad.
      store.customerCatalog.forEach(rename);
      store.brandCatalog.forEach(rename);
      store.destinationCatalog.forEach(rename);
      store.daeCatalog.forEach(rename);
      [store.ui.customerDraft, store.ui.brandDraft, store.ui.destinationDraft, store.ui.daeDraft].forEach(rename);
    }
    data.countries.splice(0, data.countries.length, ...store.countryCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedCountryId = "";
    store.ui.countryDraft = data.createCountry({
      companyId: activeCompanyId(appState),
      code: nextCatalogCode(store.countryCatalog, "PAIS"),
      status: "ACTIVO"
    });
    setNotice(appState, `País guardado y confirmado por Supabase: ${canonical.name}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, country: canonical, updated: existingIndex >= 0 };
  }

  function selectCustomer(appState, customerId) {
    const store = ensureStore(appState);
    const customer = store.customerCatalog.find(item => item.id === customerId);
    if (!customer) return false;
    store.ui.selectedCustomerId = customer.id;
    store.ui.customerDraft = data.createCustomer(BlessERP.utils.clone(customer));
    setNotice(appState, `Editando cliente ${customer.commercialName}.`, "info");
    return true;
  }

  function newCustomer(appState, companyId = "") {
    const store = ensureStore(appState);
    companyId = companyId || activeCompanyId(appState);
    store.ui.selectedCustomerId = "";
    store.ui.customerDraft = data.createCustomer({
      companyId,
      code: nextCatalogCode(store.customerCatalog, "CLI"),
      country: "ECUADOR",
      status: "ACTIVO"
    });
    setNotice(appState, "Nueva ficha de cliente preparada.", "info");
    return store.ui.customerDraft;
  }

  function updateCustomerDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.customerDraft;
    if (!draft || !(field in draft)) return false;
    if (field === "code") return false;
    if (["related", "flowerTypeB", "dedicatedInventoryEnabled"].includes(field)) draft[field] = Boolean(value);
    else if (["creditDays", "creditAmount"].includes(field)) draft[field] = Math.max(0, utils.parseNumber(value));
    else draft[field] = String(value || "");
    return true;
  }

  async function saveCustomer(appState) {
    const store = ensureStore(appState);
    const draft = bindCatalogCompany(data.createCustomer(store.ui.customerDraft || {}), appState);
    const existing = store.customerCatalog.find(item => String(item.id) === String(draft.id));
    let automaticIdentification = false;
    const country = findCatalogCountry(store, draft.country);
    if (!country) {
      setNotice(appState, "Seleccione un pais registrado en el catalogo comercial.", "warning");
      return { ok: false };
    }
    draft.country = country.name;
    if (!draft.code) draft.code = nextCatalogCode(store.customerCatalog, "CLI");
    if (!String(draft.identification || "").trim()) {
      const receivableCustomers = Array.isArray(appState.db.customers) ? appState.db.customers : [];
      draft.identification = BlessERP.utils.nextCustomerExternalId(
        [...store.customerCatalog, ...receivableCustomers],
        draft.companyId || draft.company_id,
        draft.id
      );
      draft.identificationType = "TAX ID";
      automaticIdentification = true;
    }
    draft.commercialName = String(draft.commercialName || draft.legalName || "").trim();
    const required = [draft.code, draft.legalName, draft.commercialName, draft.country];
    if (required.some(value => !String(value || "").trim())) {
      setNotice(appState, "Complete razon social, nombre comercial y pais.", "warning");
      return { ok: false };
    }
    const sameCompany = item => String(item.companyId || item.company_id) === String(draft.companyId || draft.company_id);
    const duplicateCode = store.customerCatalog.find(item => item.id !== draft.id && sameCompany(item) && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    const duplicateIdentification = store.customerCatalog.find(item => item.id !== draft.id && sameCompany(item) && String(item.identification).trim() === String(draft.identification).trim());
    if (duplicateCode || duplicateIdentification) {
      setNotice(appState, duplicateCode ? "Ya existe un cliente con ese codigo." : "Ya existe un cliente con esa identificacion.", "warning");
      return { ok: false };
    }
    if (existing?.dedicatedInventoryEnabled === true && draft.dedicatedInventoryEnabled !== true) {
      setNotice(
        appState,
        "No se puede desactivar la disponibilidad propia desde esta ficha: las etiquetas, destinos e historial existentes deben preservarse. Solicite una revisión operativa focalizada.",
        "warning"
      );
      return { ok: false, reason: "DEDICATED_INVENTORY_DISABLE_REVIEW_REQUIRED" };
    }
    const result = await persistCatalogRecord(appState, BlessERP.getCustomerRepository?.(), draft, "el cliente");
    if (!result.ok) return result;
    const canonical = data.createCustomer(result.record);
    const existingIndex = store.customerCatalog.findIndex(item => item.id === canonical.id);
    if (existingIndex >= 0) store.customerCatalog[existingIndex] = canonical;
    else store.customerCatalog.unshift(canonical);
    data.customers.splice(0, data.customers.length, ...store.customerCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedCustomerId = "";
    store.ui.customerDraft = data.createCustomer({
      companyId: activeCompanyId(appState),
      code: nextCatalogCode(store.customerCatalog, "CLI"),
      country: "ECUADOR",
      status: "ACTIVO"
    });
    setNotice(
      appState,
      `Cliente guardado y confirmado por Supabase: ${canonical.commercialName}.${automaticIdentification ? ` Identificación exterior automática: ${canonical.identification}.` : ""}`,
      "success"
    );
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, customer: canonical, updated: existingIndex >= 0 };
  }

  async function deleteCustomer(appState, customerId) {
    const store = ensureStore(appState);
    const customer = store.customerCatalog.find(item => item.id === customerId);
    if (!customer) return { ok: false, reason: "NOT_FOUND" };
    if (customer.dedicatedInventoryEnabled === true) {
      setNotice(
        appState,
        `No se puede eliminar ${customer.legalName}: su destino dedicado e historial físico deben preservarse. Solicite una revisión operativa focalizada.`,
        "warning"
      );
      return { ok: false, reason: "DEDICATED_INVENTORY_DELETE_REVIEW_REQUIRED" };
    }
    const usedByBrand = store.brandCatalog.some(item => item.customerId === customerId);
    const usedByOrder = store.orders.some(item => item.customerId === customerId && String(item.status || "").toUpperCase() !== "ANULADO");
    const usedByDae = store.daeCatalog.some(item => (item.customerIds || []).includes(customerId));
    if (usedByBrand || usedByOrder || usedByDae) {
      setNotice(appState, `No se puede eliminar ${customer.legalName}: primero retire sus marcas, DAEs o pedidos activos.`, "warning");
      return { ok: false, reason: "IN_USE" };
    }
    const result = await removeCatalogRecord(appState, BlessERP.getCustomerRepository?.(), customer, "el cliente");
    if (!result.ok) return result;
    store.customerCatalog = store.customerCatalog.filter(item => item.id !== customerId);
    data.customers.splice(0, data.customers.length, ...store.customerCatalog.map(item => BlessERP.utils.clone(item)));
    newCustomer(appState, customer.companyId || customer.company_id);
    setNotice(appState, `Cliente eliminado y confirmado por Supabase: ${customer.legalName}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, customer };
  }

  function getBrandCatalog(appState, companyId = "") {
    const rows = ensureStore(appState).brandCatalog;
    return companyId ? rows.filter(item => String(item.companyId || item.company_id) === String(companyId)) : rows;
  }

  function selectBrand(appState, brandId) {
    const store = ensureStore(appState);
    const brand = store.brandCatalog.find(item => item.id === brandId);
    if (!brand) return false;
    store.ui.selectedBrandId = brand.id;
    store.ui.brandDraft = data.createBrand(BlessERP.utils.clone(brand));
    setNotice(appState, `Editando marca ${brand.name}.`, "info");
    return true;
  }

  function newBrand(appState, companyId = "") {
    const store = ensureStore(appState);
    companyId = companyId || activeCompanyId(appState);
    const companyCustomers = getCustomerCatalog(appState, companyId);
    const customer = companyCustomers.find(item => item.status === "ACTIVO") || companyCustomers[0];
    store.ui.selectedBrandId = "";
    store.ui.brandDraft = data.createBrand({
      companyId,
      code: nextCatalogCode(store.brandCatalog, "MAR"),
      customerId: customer?.id || "",
      country: "",
      destination: "",
      status: "ACTIVO"
    });
    setNotice(appState, "Nueva ficha de marca preparada.", "info");
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

    if (field === "finalClientName") {
      draft.name = draft.finalClientName;
      draft.shortReference = draft.finalClientName;
    }

    if (field === "defaultAgencyId") {
      const agency = data.agencies.find(item => item.id === draft.defaultAgencyId);
      if (agency) {
        draft.agencyContact = agency.contact || "";
        draft.agencyEmail = agency.email || "";
        draft.agencyColdRoom = agency.coldRoom || "";
        draft.agencyCity = agency.city || "";
      }
    }
    if (field === "country") {
      const country = findCatalogCountry(store, value);
      draft.country = country?.name || "";
      // Se conserva destination por compatibilidad histórica, pero la única fuente es País.
      draft.destination = draft.country;
    }
    return true;
  }

  async function saveBrand(appState) {
    const store = ensureStore(appState);
    const draft = bindCatalogCompany(data.createBrand(store.ui.brandDraft || {}), appState);
    const country = findCatalogCountry(store, draft.country || draft.destination);
    if (!country) {
      setNotice(appState, "Seleccione un pais registrado en el catalogo comercial.", "warning");
      return { ok: false };
    }
    draft.country = country.name;
    draft.destination = country.name;
    draft.name = draft.finalClientName;
    draft.shortReference = draft.finalClientName;
    if (!draft.code) draft.code = nextCatalogCode(store.brandCatalog, "MAR");
    const required = [draft.code, draft.customerId, draft.finalClientName, draft.country];
    if (required.some(value => !String(value || "").trim())) {
      setNotice(appState, "Complete cliente principal, apellidos y nombres / razon social y pais.", "warning");
      return { ok: false };
    }
    if (!store.customerCatalog.some(item => item.id === draft.customerId && String(item.companyId || item.company_id) === String(draft.companyId || draft.company_id))) {
      setNotice(appState, "El cliente principal seleccionado no existe en la misma empresa.", "warning");
      return { ok: false };
    }
    const duplicateCode = store.brandCatalog.find(item => (
      item.id !== draft.id
      && String(item.companyId || item.company_id) === String(draft.companyId || draft.company_id)
      && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase()
    ));
    if (duplicateCode) {
      setNotice(appState, "Ya existe una marca con ese codigo.", "warning");
      return { ok: false };
    }
    const result = await persistCatalogRecord(appState, BlessERP.getFinalBrandRepository?.(), draft, "el cliente final / marca");
    if (!result.ok) return result;
    const canonical = data.createBrand(result.record);
    const existingIndex = store.brandCatalog.findIndex(item => item.id === canonical.id);
    if (existingIndex >= 0) store.brandCatalog[existingIndex] = canonical;
    else store.brandCatalog.unshift(canonical);
    data.brands.splice(0, data.brands.length, ...store.brandCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedBrandId = "";
    store.ui.brandDraft = data.createBrand({
      companyId: activeCompanyId(appState),
      code: nextCatalogCode(store.brandCatalog, "MAR"),
      status: "ACTIVO"
    });
    setNotice(appState, `Marca guardada y confirmada por Supabase: ${canonical.name}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, brand: canonical, updated: existingIndex >= 0 };
  }

  async function deleteBrand(appState, brandId) {
    const store = ensureStore(appState);
    const brand = store.brandCatalog.find(item => item.id === brandId);
    if (!brand) return { ok: false, reason: "NOT_FOUND" };
    const used = store.orders.some(item => item.brandId === brandId && String(item.status || "").toUpperCase() !== "ANULADO");
    if (used) {
      setNotice(appState, `No se puede eliminar ${brand.finalClientName}: tiene pedidos activos o históricos vigentes.`, "warning");
      return { ok: false, reason: "IN_USE" };
    }
    const result = await removeCatalogRecord(appState, BlessERP.getFinalBrandRepository?.(), brand, "el cliente final / marca");
    if (!result.ok) return result;
    store.brandCatalog = store.brandCatalog.filter(item => item.id !== brandId);
    data.brands.splice(0, data.brands.length, ...store.brandCatalog.map(item => BlessERP.utils.clone(item)));
    newBrand(appState, brand.companyId || brand.company_id);
    setNotice(appState, `Cliente final eliminado y confirmado por Supabase: ${brand.finalClientName}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, brand };
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
    return true;
  }

  function newAgency(appState) {
    const store = ensureStore(appState);
    store.ui.selectedAgencyId = "";
    store.ui.agencyDraft = data.createAgency({
      companyId: activeCompanyId(appState),
      code: nextCatalogCode(store.agencyCatalog, "AG"),
      city: "Quito",
      status: "ACTIVA"
    });
    setNotice(appState, "Nueva ficha de agencia preparada.", "info");
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
    return true;
  }

  async function saveAgency(appState) {
    const store = ensureStore(appState);
    const draft = bindCatalogCompany(data.createAgency(store.ui.agencyDraft || {}), appState);
    if (!draft.code) draft.code = nextCatalogCode(store.agencyCatalog, "AG");
    const required = [draft.code, draft.name, draft.coldRoom, draft.city];
    if (required.some(value => !String(value || "").trim())) {
      setNotice(appState, "Complete agencia, cuarto frio principal y ciudad.", "warning");
      return { ok: false, message: "Complete agencia, cuarto frío principal y ciudad." };
    }
    const duplicateCode = store.agencyCatalog.find(item => item.id !== draft.id && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    const duplicateName = store.agencyCatalog.find(item => item.id !== draft.id && String(item.name).trim().toUpperCase() === String(draft.name).trim().toUpperCase());
    if (duplicateCode || duplicateName) {
      setNotice(appState, duplicateCode ? "Ya existe una agencia con ese codigo." : "Ya existe una agencia con ese nombre.", "warning");
      return { ok: false, message: duplicateCode ? "Ya existe una agencia con ese código." : "Ya existe una agencia con ese nombre." };
    }
    const repository = BlessERP.getCargoAgencyRepository?.();
    if (!repository?.configured?.()) {
      setNotice(appState, "Supabase debe confirmar la agencia. No se guardó localmente.", "warning");
      return { ok: false, message: "Supabase debe confirmar la agencia." };
    }
    const result = await repository.save(draft);
    if (!result?.ok || result.confirmed !== true || result.status !== "SYNCED") {
      setNotice(appState, result?.message || "Supabase no confirmó la agencia.", "warning");
      return { ok: false, message: result?.message || "Supabase no confirmó la agencia." };
    }
    const canonical = data.createAgency(result.record);
    const existingIndex = store.agencyCatalog.findIndex(item => item.id === canonical.id);
    if (existingIndex >= 0) store.agencyCatalog[existingIndex] = canonical;
    else store.agencyCatalog.unshift(canonical);
    data.agencies.splice(0, data.agencies.length, ...store.agencyCatalog.map(item => BlessERP.utils.clone(item)));

    store.ui.selectedAgencyId = "";
    store.ui.agencyDraft = data.createAgency({
      companyId: activeCompanyId(appState),
      code: nextCatalogCode(store.agencyCatalog, "AG"),
      city: "Quito",
      status: "ACTIVA"
    });
    setNotice(appState, `Agencia guardada y confirmada por Supabase: ${canonical.name}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, agency: canonical, updated: existingIndex >= 0 };
  }

  async function deleteAgency(appState, agencyId) {
    const store = ensureStore(appState);
    const agency = store.agencyCatalog.find(item => item.id === agencyId);
    if (!agency) return { ok: false, reason: "NOT_FOUND" };
    const usedByBrand = store.brandCatalog.some(item => item.defaultAgencyId === agencyId);
    const usedByOrder = store.orders.some(item => item.agencyId === agencyId && String(item.status || "").toUpperCase() !== "ANULADO");
    if (usedByBrand || usedByOrder) {
      setNotice(appState, `No se puede eliminar ${agency.name}: está relacionada con clientes finales o pedidos.`, "warning");
      return { ok: false, reason: "IN_USE" };
    }
    const result = await removeCatalogRecord(appState, BlessERP.getCargoAgencyRepository?.(), agency, "la agencia");
    if (!result.ok) return result;
    store.agencyCatalog = store.agencyCatalog.filter(item => item.id !== agencyId);
    data.agencies.splice(0, data.agencies.length, ...store.agencyCatalog.map(item => BlessERP.utils.clone(item)));
    newAgency(appState);
    setNotice(appState, `Agencia eliminada y confirmada por Supabase: ${agency.name}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, agency };
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
    return true;
  }

  function newAirline(appState) {
    const store = ensureStore(appState);
    store.ui.selectedAirlineId = "";
    store.ui.airlineDraft = data.createAirline({
      companyId: activeCompanyId(appState),
      code: `AIR-${String(store.airlineCatalog.length + 1).padStart(3, "0")}`,
      status: "ACTIVA"
    });
    setNotice(appState, "Nueva linea aerea preparada.", "info");
    return store.ui.airlineDraft;
  }

  function updateAirlineDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.airlineDraft;
    if (!draft || !(field in draft)) return false;
    draft[field] = field === "awbPrefix" ? String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) : String(value || "");
    return true;
  }

  async function saveAirline(appState) {
    const store = ensureStore(appState);
    const draft = bindCatalogCompany(data.createAirline(store.ui.airlineDraft || {}), appState);
    if (![draft.code, draft.name, draft.awbPrefix].every(value => String(value || "").trim())) {
      setNotice(appState, "Complete codigo, linea aerea y prefijo AWB.", "warning");
      return { ok: false, message: "Complete código, línea aérea y prefijo AWB." };
    }
    if (!/^[A-Z0-9]{3}$/.test(draft.awbPrefix)) {
      setNotice(appState, "El prefijo AWB debe contener exactamente 3 caracteres alfanuméricos.", "warning");
      return { ok: false, message: "El prefijo AWB debe contener exactamente 3 caracteres alfanuméricos." };
    }
    const duplicateCode = store.airlineCatalog.find(item => item.id !== draft.id && String(item.code).trim().toUpperCase() === String(draft.code).trim().toUpperCase());
    const duplicatePrefix = store.airlineCatalog.find(item => item.id !== draft.id && item.awbPrefix === draft.awbPrefix);
    if (duplicateCode || duplicatePrefix) {
      setNotice(appState, duplicateCode ? "Ya existe una linea aerea con ese codigo." : "Ya existe una linea aerea con ese prefijo AWB.", "warning");
      return { ok: false, message: duplicateCode ? "Ya existe una línea aérea con ese código." : "Ya existe una línea aérea con ese prefijo AWB." };
    }
    const repository = BlessERP.getAirlineRepository?.();
    if (!repository?.configured?.()) {
      setNotice(appState, "Supabase debe confirmar la línea aérea. No se guardó localmente.", "warning");
      return { ok: false, message: "Supabase debe confirmar la línea aérea." };
    }
    const result = await repository.save(draft);
    if (!result?.ok || result.confirmed !== true || result.status !== "SYNCED") {
      setNotice(appState, result?.message || "Supabase no confirmó la línea aérea.", "warning");
      return { ok: false, message: result?.message || "Supabase no confirmó la línea aérea." };
    }
    const canonical = data.createAirline(result.record);
    const existingIndex = store.airlineCatalog.findIndex(item => item.id === canonical.id);
    if (existingIndex >= 0) store.airlineCatalog[existingIndex] = canonical;
    else store.airlineCatalog.unshift(canonical);
    data.airlines.splice(0, data.airlines.length, ...store.airlineCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedAirlineId = "";
    store.ui.airlineDraft = data.createAirline({
      companyId: activeCompanyId(appState),
      code: `AIR-${String(store.airlineCatalog.length + 1).padStart(3, "0")}`,
      status: "ACTIVA"
    });
    setNotice(appState, `Línea aérea guardada y confirmada por Supabase: ${canonical.name}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, airline: canonical, updated: existingIndex >= 0 };
  }

  async function deleteAirline(appState, airlineId) {
    const store = ensureStore(appState);
    const airline = store.airlineCatalog.find(item => item.id === airlineId);
    if (!airline) return { ok: false, reason: "NOT_FOUND" };
    const daeInUse = data.daes.some(item => item.airlineId === airlineId);
    const orderInUse = store.orders.some(item => item.airlineId === airlineId);
    if (daeInUse || orderInUse) {
      setNotice(appState, `No se puede borrar ${airline.name}: esta usada en ${daeInUse ? "DAE" : "pedidos"}.`, "warning");
      return { ok: false, reason: "IN_USE" };
    }
    const result = await removeCatalogRecord(appState, BlessERP.getAirlineRepository?.(), airline, "la línea aérea");
    if (!result.ok) return result;
    store.airlineCatalog = store.airlineCatalog.filter(item => item.id !== airlineId);
    data.airlines.splice(0, data.airlines.length, ...store.airlineCatalog.map(item => BlessERP.utils.clone(item)));
    const next = store.airlineCatalog[0] || data.createAirline();
    store.ui.selectedAirlineId = next.id || "";
    store.ui.airlineDraft = data.createAirline(BlessERP.utils.clone(next));
    setNotice(appState, `Línea aérea eliminada y confirmada por Supabase: ${airline.name}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, airline };
  }

  function getDaeCatalog(appState, companyId = "") {
    const rows = ensureStore(appState).daeCatalog;
    return companyId ? rows.filter(item => String(item.companyId || item.company_id) === String(companyId)) : rows;
  }

  function selectDae(appState, daeId) {
    const store = ensureStore(appState);
    const dae = store.daeCatalog.find(item => item.id === daeId);
    if (!dae) return false;
    store.ui.selectedDaeId = dae.id;
    store.ui.daeDraft = data.createDae(BlessERP.utils.clone(dae));
    setNotice(appState, `Editando DAE ${dae.number}.`, "info");
    return true;
  }

  function newDae(appState, companyId = "") {
    const store = ensureStore(appState);
    companyId = companyId || activeCompanyId(appState);
    const companyCustomers = getCustomerCatalog(appState, companyId);
    const firstCustomer = companyCustomers.find(item => item.status === "ACTIVO") || companyCustomers[0];
    store.ui.selectedDaeId = "";
    store.ui.daeDraft = data.createDae({
      companyId,
      number: "055-",
      status: "ACTIVA",
      airlineId: "",
      customerIds: firstCustomer ? [firstCustomer.id] : []
    });
    setNotice(appState, "Nueva ficha DAE preparada.", "info");
    return store.ui.daeDraft;
  }

  function updateDaeDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.daeDraft;
    if (!draft || !(field in draft) || field === "customerIds") return false;
    draft[field] = String(value || "");
    if (field === "country") {
      const country = findCatalogCountry(store, value);
      draft.country = country?.name || "";
      draft.destination = draft.country;
    }
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
    return true;
  }

  function validateDaeDraft(store, draft) {
    const required = [draft.number, draft.country, draft.expirationDate, draft.status];
    if (required.some(value => !String(value || "").trim())) {
      return { ok: false, message: "Complete numero DAE, pais, caducidad y estado." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expirationDate) || Number.isNaN(new Date(`${draft.expirationDate}T00:00:00`).getTime())) {
      return { ok: false, message: "La fecha de caducidad DAE no es valida." };
    }
    if (draft.airlineId && !store.airlineCatalog.some(item => item.id === draft.airlineId)) {
      return { ok: false, message: "La linea aerea seleccionada no existe." };
    }
    const country = findCatalogCountry(store, draft.country);
    if (!country) return { ok: false, message: "El pais de la DAE no existe en el catalogo comercial." };
    draft.country = country.name;
    draft.destination = country.name;
    return { ok: true };
  }

  async function saveDae(appState) {
    const store = ensureStore(appState);
    const draft = bindCatalogCompany(data.createDae(store.ui.daeDraft || {}), appState);
    const validation = validateDaeDraft(store, draft);
    if (!validation.ok) {
      setNotice(appState, validation.message, "warning");
      return { ok: false };
    }
    const duplicate = store.daeCatalog.find(item => (
      item.id !== draft.id
      && String(item.companyId || item.company_id) === String(draft.companyId || draft.company_id)
      && String(item.number).trim().toUpperCase() === String(draft.number).trim().toUpperCase()
    ));
    if (duplicate) {
      setNotice(appState, "Ya existe una DAE con ese numero.", "warning");
      return { ok: false };
    }
    const result = await persistCatalogRecord(appState, BlessERP.getDaeRepository?.(), draft, "la DAE");
    if (!result.ok) return result;
    const canonical = data.createDae(result.record);
    const existingIndex = store.daeCatalog.findIndex(item => item.id === canonical.id);
    if (existingIndex >= 0) store.daeCatalog[existingIndex] = canonical;
    else store.daeCatalog.unshift(canonical);
    data.daes.splice(0, data.daes.length, ...store.daeCatalog.map(item => BlessERP.utils.clone(item)));
    store.ui.selectedDaeId = "";
    store.ui.daeDraft = data.createDae({
      companyId: activeCompanyId(appState),
      number: "055-",
      status: "ACTIVA",
      airlineId: "",
      customerIds: []
    });
    setNotice(appState, `DAE guardada y confirmada por Supabase: ${canonical.number}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, dae: canonical, updated: existingIndex >= 0 };
  }

  async function deleteDae(appState, daeId) {
    const store = ensureStore(appState);
    const dae = store.daeCatalog.find(item => item.id === daeId);
    if (!dae) return { ok: false, reason: "NOT_FOUND" };
    const used = store.orders.some(item => item.daeNumber === dae.number && String(item.status || "").toUpperCase() !== "ANULADO");
    if (used) {
      setNotice(appState, `No se puede eliminar la DAE ${dae.number}: está usada en un pedido. Puede marcarla INACTIVA.`, "warning");
      return { ok: false, reason: "IN_USE" };
    }
    const result = await removeCatalogRecord(appState, BlessERP.getDaeRepository?.(), dae, "la DAE");
    if (!result.ok) return result;
    store.daeCatalog = store.daeCatalog.filter(item => item.id !== daeId);
    data.daes.splice(0, data.daes.length, ...store.daeCatalog.map(item => BlessERP.utils.clone(item)));
    newDae(appState, dae.companyId || dae.company_id);
    setNotice(appState, `DAE eliminada y confirmada por Supabase: ${dae.number}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, dae };
  }

  async function deleteCountry(appState, countryId) {
    const store = ensureStore(appState);
    const country = store.countryCatalog.find(item => item.id === countryId);
    if (!country) return { ok: false, reason: "NOT_FOUND" };
    const name = String(country.name || "").toUpperCase();
    const used = [...store.customerCatalog, ...store.brandCatalog, ...store.daeCatalog]
      .some(item => String(item.country || "").toUpperCase() === name);
    if (used) {
      setNotice(appState, `No se puede eliminar ${country.name}: está relacionado con clientes o DAEs.`, "warning");
      return { ok: false, reason: "IN_USE" };
    }
    const result = await removeCatalogRecord(appState, BlessERP.getCountryRepository?.(), country, "el país");
    if (!result.ok) return result;
    store.countryCatalog = store.countryCatalog.filter(item => item.id !== countryId);
    data.countries.splice(0, data.countries.length, ...store.countryCatalog.map(item => BlessERP.utils.clone(item)));
    newCountry(appState);
    setNotice(appState, `País eliminado y confirmado por Supabase: ${country.name}.`, "success");
    saveConfirmedCatalogCache();
    return { ok: true, confirmed: true, country };
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
    return store.ui.destinationDraft;
  }

  function updateDestinationDraftField(appState, field, value) {
    const store = ensureStore(appState);
    const draft = store.ui.destinationDraft;
    if (!draft || !(field in draft)) return false;
    if (field === "code") return false;
    draft[field] = String(value || "");
    return true;
  }

  function saveDestination(appState) {
    const store = ensureStore(appState);
    const draft = data.createDestination(store.ui.destinationDraft || {});
    const country = findCatalogCountry(store, draft.country);
    if (!country) {
      setNotice(appState, "Seleccione un pais registrado en el catalogo comercial.", "warning");
      return { ok: false };
    }
    draft.country = country.name;
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
    const store = ensureStore(appState);
    const orderId = tabOrderWorkspaceId || store.ui.currentOrderId;
    const order = store.orders.find(item => item.id === orderId) || null;
    if (!order) return null;
    if (tabOrderWorkspaceId) store.ui.currentOrderId = tabOrderWorkspaceId;
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
    const boxes = orderBoxNumbers(order);
    const lower = boxes[0] || 1;
    const upper = boxes[boxes.length - 1] || 1;
    store.ui.labelPrintMode = "all";
    store.ui.labelFromBox = lower;
    store.ui.labelToBox = upper;
    store.ui.labelSingleBox = lower;
  }

  function ensureLabelSelection(store, order) {
    const boxes = orderBoxNumbers(order);
    const lower = boxes[0] || 1;
    const upper = boxes[boxes.length - 1] || 1;
    store.ui.labelFromBox = Math.max(lower, Math.min(Number(store.ui.labelFromBox || lower), upper));
    store.ui.labelToBox = Math.max(store.ui.labelFromBox, Math.min(Number(store.ui.labelToBox || upper), upper));
    const selectedSingle = Number(store.ui.labelSingleBox || lower);
    store.ui.labelSingleBox = boxes.includes(selectedSingle) ? selectedSingle : lower;
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
    saveOrderDraft(appState, order);
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
    saveOrderDraft(appState, order);
    return true;
  }

  function updateManualMixDraftItem(appState, itemId, field, value) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const draft = ensureBoxRangeDraft(store, order);
    if (!BlessERP.comercialBoxBuilder.updateManualItem(draft, itemId, field, value)) return false;
    saveOrderDraft(appState, order);
    return true;
  }

  function addManualMixDraftItem(appState) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const item = BlessERP.comercialBoxBuilder.addManualItem(ensureBoxRangeDraft(store, order));
    if (!item) return false;
    saveOrderDraft(appState, order);
    return true;
  }

  function removeManualMixDraftItem(appState, itemId) {
    const store = ensureStore(appState);
    const order = store.orders.find(item => item.id === store.ui.currentOrderId) || null;
    const removed = BlessERP.comercialBoxBuilder.removeManualItem(ensureBoxRangeDraft(store, order), itemId);
    if (!removed) return false;
    saveOrderDraft(appState, order);
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
      sellerId: "vendedor",
      seller_id: "vendedor",
      vendedorId: "vendedor",
      transportType: "tipo transporte",
      daeNumber: "DAE",
      sriDaeNumber: "DAE fiscal SRI",
      sriGuides: "guias SRI",
      invoicePackingNumber: "factura comercial para agencia",
      clientInvoiceNumber: "factura comercial del cliente",
      sriInvoiceNumber: "numero de factura SRI",
      sriAuthorizationStatus: "estado de autorizacion SRI",
      sriAuthorizationNumber: "numero de autorizacion SRI",
      sriAccessKey: "clave de acceso SRI",
      sriAuthorizedAt: "fecha de autorizacion SRI",
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
      sriPaymentMethod: "forma de pago SRI",
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
      quality: "calidad",
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
      const review = workflow.canEditOrderField(order, field);
      if (!review.ok) {
        blockOrderEdit(appState, order, review.message);
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
      order.sriPaymentMethod = "";
      return;
    }

    order.paymentTerms = `${customer.creditDays} dias`;
    order.sriPaymentMethod = data.normalizeSriPaymentMethod(customer.sriPaymentMethod, "20");

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
    if (utils.isLocalOrder(order)) {
      utils.applyLocalOrderDefaults(order);
      return { type: "info", text: "Venta local: cliente final, DAE y agencia no aplican. Guias y linea aerea son opcionales." };
    }
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

    if (!order.destinationModifiedManual) order.destination = brand.destination;
    if (!order.destinationCountryModifiedManual) order.destinationCountry = brand.country;
    if (brand.defaultAgencyId) {
      order.agencyId = brand.defaultAgencyId;
    }

    const agency = utils.findAgency(order.agencyId);
    order.coldRoom = agency?.coldRoom || data.company.coldRoomDefault;

    if (preserveManualDae && order.transportType === "aereo" && order.daeModifiedManual && order.daeNumber) {
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

  function sriProcessStarted(order) {
    const status = String(order?.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
    return Boolean(order?.sriRemoteDocumentId) || !["PENDIENTE", "ANULADO"].includes(status);
  }

  function sriInvoiceAuthorized(order) {
    return workflow.isSriAuthorized?.(order)
      || String(order?.sriAuthorizationStatus || "").trim().toUpperCase() === "AUTORIZADO";
  }

  function invalidateCommercialDocuments(order, reason = "") {
    if (!order) return;
    order.documentActivity = order.documentActivity && typeof order.documentActivity === "object"
      ? order.documentActivity
      : {};
    const invalidatedAt = new Date().toISOString();
    [
      "INVOICE_PACKING_REAL",
      "INVOICE_PACKING_REFERENCIAL",
      "PACKING_LIST",
      "COMMERCIAL_INVOICE_CLIENT",
      "HR",
      "MP",
      "RESUMEN_PEDIDO",
      "CONTROL_DAE"
    ].forEach(code => {
      if (!order.documentActivity[code]) return;
      order.documentActivity[code] = {
        ...order.documentActivity[code],
        lastAction: "invalidated",
        invalidatedAt,
        invalidationReason: String(reason || "").trim(),
        previewedAt: "",
        printedAt: "",
        downloadedAt: "",
        regenerationRequired: true
      };
    });
  }

  const revisionOrderFields = [
    "customerId",
    "brandId",
    "seller_id",
    "sellerId",
    "vendedorId",
    "seller_name",
    "sellerName",
    "vendedorNombre",
    "transportType",
    "issuedAt",
    "flightDate",
    "destination",
    "destinationCountry",
    "destinationModifiedManual",
    "destinationCountryModifiedManual",
    "agencyId",
    "daeNumber",
    "sriGuides",
    "invoicePackingNumber",
    "clientInvoiceNumber",
    "sriInvoiceNumber",
    "sriAuthorizationStatus",
    "sriAuthorizationNumber",
    "sriAccessKey",
    "sriIssueDate",
    "sriAuthorizedAt",
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
    "sriPaymentMethod",
    "expireDate"
  ];

  function scannedCount(line) {
    return Array.isArray(line?.scannedBunches) ? line.scannedBunches.length : 0;
  }

  function orderBoxNumbers(order) {
    return [...new Set((order?.lines || []).map(line => Number(line.boxNumber)).filter(Boolean))].sort((a, b) => a - b);
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
    order.revisionDataOnly = false;
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
    tabOrderWorkspaceId = orderId;
    orderWorkspacePreparedInThisTab = true;
    clearNotice(appState);
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

  function setLabelOrderSelected(appState, orderId, selected) {
    const store = ensureStore(appState);
    const ids = new Set(store.ui.labelSelectedOrderIds || []);
    if (selected && store.orders.some(order => order.id === orderId)) ids.add(orderId);
    else ids.delete(orderId);
    store.ui.labelSelectedOrderIds = [...ids];
    saveDb();
  }

  function setLabelOrderSelection(appState, orderIds) {
    const store = ensureStore(appState);
    const validIds = new Set(store.orders.map(order => order.id));
    store.ui.labelSelectedOrderIds = [...new Set((orderIds || []).filter(orderId => validIds.has(orderId)))];
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
    return setHistoryFilters(appState, { [field]: value });
  }

  function setHistoryFilters(appState, values = {}, options = {}) {
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
    let changed = false;
    Object.entries(values || {}).forEach(([field, value]) => {
      if (!allowed.includes(field)) return;
      const normalized = String(value || "");
      if (ui[field] === normalized) return;
      ui[field] = normalized;
      changed = true;
    });
    if (!changed) return false;
    if (options.persist !== false) saveDb();
    return true;
  }

  function setPrintCenterUi(appState, field, value) {
    const store = ensureStore(appState);
    const allowed = ["printCenterDocument", "printCenterInvoiceFilter", "printCenterCustomerId"];
    if (!allowed.includes(field)) return;
    store.ui[field] = String(value || "");
    ensurePrintCenterUi(store);
    saveDb();
  }

  function setPrintCenterOrderSelected(appState, orderId, selected) {
    const store = ensureStore(appState);
    const ids = new Set(store.ui.printCenterSelectedOrderIds || []);
    if (selected && store.orders.some(order => order.id === orderId)) ids.add(orderId);
    else ids.delete(orderId);
    store.ui.printCenterSelectedOrderIds = [...ids];
    saveDb();
  }

  function setPrintCenterOrderSelection(appState, orderIds) {
    const store = ensureStore(appState);
    const validIds = new Set(store.orders.map(order => order.id));
    store.ui.printCenterSelectedOrderIds = [...new Set((orderIds || []).filter(orderId => validIds.has(orderId)))];
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
    if (["customerId", "brandId", "agencyId", "sellerId", "seller_id", "vendedorId", "transportType", "inventorySupplyMode", "sriPaymentMethod"].includes(field)
      && String(order[field] ?? "") === String(value ?? "")) {
      return { changed: false, order };
    }
    beginOrderDraft(appState, order);

    const previousValue = JSON.stringify(order[field] ?? "");

    if (field === "customerId") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.customerId = value;
      order.brandId = "";
      order.destination = "";
      order.destinationCountry = "";
      order.destinationModifiedManual = false;
      order.destinationCountryModifiedManual = false;
      order.agencyId = "";
      order.daeNumber = "";
      order.daeDestination = "";
      order.daeExpirationDate = "";
      order.daeAssignedAutomatically = false;
      order.daeModifiedManual = false;
      applyCustomerBrand(order);
      if (utils.isLocalOrder(order)) {
        utils.applyLocalOrderDefaults(order);
        setNotice(appState, "Cliente principal actualizado. En venta local no se requiere DAE ni agencia de carga.", "info");
      } else {
        setNotice(appState, "Cliente principal actualizado. Seleccione la marca relacionada.", "info");
      }
    } else if (field === "brandId") {
      if (utils.isLocalOrder(order)) {
        utils.applyLocalOrderDefaults(order);
        setNotice(appState, "El cliente final no se utiliza en ventas locales.", "info");
        saveDb();
        return;
      }
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.brandId = value;
      order.destinationModifiedManual = false;
      order.destinationCountryModifiedManual = false;
      const result = applyBrand(order);
      setNotice(appState, result.text || "Marca actualizada.", result.type || "info");
    } else if (["sellerId", "seller_id", "vendedorId"].includes(field)) {
      resetAccountingPreview(order);
      const seller = applySellerLink(order, value, appState);
      setNotice(
        appState,
        seller ? `Vendedor asignado: ${seller.full_name}.` : "Vendedor retirado del pedido.",
        seller ? "success" : "info"
      );
    } else if (field === "transportType") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      const previousSeries = invoiceSequence.saleSeries?.(
        order.sellingCompanyId || order.companyId || activeCompanyId(appState),
        order.saleType || order.sale_type,
        order.transportType || order.transport_type
      ) || {};
      order.transportType = value;
      const result = utils.isLocalOrder(order)
        ? (utils.applyLocalOrderDefaults(order), { type: "info", text: "Venta local: retiro en finca, sin DAE ni agencia. Guias y linea aerea opcionales." })
        : applyBrand(order, { preserveManualDae: true });
      const nextSeries = invoiceSequence.saleSeries?.(
        order.sellingCompanyId || order.companyId || activeCompanyId(appState),
        order.saleType || order.sale_type,
        order.transportType || order.transport_type
      ) || {};
      if (previousSeries.code !== nextSeries.code && order.sriInvoiceNumber) {
        setNotice(appState, "El punto de emision y el secuencial se actualizaran al guardar el borrador.", "info");
      }
      setNotice(appState, result.text || "Logistica actualizada.", result.type || "info");
    } else if (field === "daeNumber") {
      if (utils.isLocalOrder(order)) {
        utils.applyLocalOrderDefaults(order);
        setNotice(appState, "La DAE no aplica a ventas locales.", "info");
        saveDb();
        return;
      }
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      const result = utils.applyManualDae(order, value);
      setNotice(appState, result.text || "DAE actualizada manualmente.", result.type || "info");
    } else if (field === "agencyId") {
      if (utils.isLocalOrder(order)) {
        utils.applyLocalOrderDefaults(order);
        setNotice(appState, "La agencia de carga no aplica a ventas locales.", "info");
        saveDb();
        return;
      }
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.agencyId = value;
      const agency = utils.findAgency(value);
      if (agency) order.coldRoom = agency.coldRoom;
      setNotice(appState, agency
        ? `Agencia actualizada. Cuarto frio sugerido: ${agency.coldRoom || "pendiente"}.`
        : "Agencia de carga retirada.", "info");
    } else if (field === "sriPaymentMethod") {
      resetAccountingPreview(order);
      order.sriPaymentMethod = data.normalizeSriPaymentMethod(value, "20");
      setNotice(appState, `Forma de pago SRI actualizada a codigo ${order.sriPaymentMethod}.`, "success");
    } else if (field === "inventorySupplyMode") {
      const imperioCompanyId = BlessERP.companyCapabilities?.COMPANY_IDS?.IMPERIO || "COMP-IMPERIO-FLOWERS";
      const isImperioOrder = String(order.sellingCompanyId || order.companyId || "") === imperioCompanyId;
      const mode = String(value || "EXTERNAL_FARM").trim().toUpperCase();
      const normalMode = isImperioOrder ? "BLESS_SHARED" : "BLESS_INVENTORY";
      order.inventorySupplyMode = mode === "EXTERNAL_FARM" ? "EXTERNAL_FARM" : normalMode;
      order.inventory_supply_mode = order.inventorySupplyMode;
      order.inventoryConsumptionMode = order.inventorySupplyMode === "EXTERNAL_FARM"
        ? "SIN_INVENTARIO"
        : (isImperioOrder ? "BLESS_COMPARTIDO" : "BLESS_INVENTARIO");
      order.availabilityCommitmentStatus = order.inventorySupplyMode === "EXTERNAL_FARM" ? "NO_APLICA" : "BORRADOR";
      order.warehouseStatus = "NO_LIBERADO";
      order.fulfillmentStatus = "NO_LIBERADO";
      setNotice(
        appState,
        order.inventorySupplyMode === "EXTERNAL_FARM"
          ? "Compra de finca externa: el pedido podra facturarse sin reservar ni descontar inventario de Bless Flower."
          : (isImperioOrder
            ? "Origen Bless compartido: el pedido volvera a participar en disponibilidad y Cuarto frío."
            : "Inventario propio de Bless: el pedido participara en disponibilidad y Cuarto frío."),
        "info"
      );
    } else if (field === "destination") {
      if (utils.isLocalOrder(order)) {
        utils.applyLocalOrderDefaults(order);
        saveDb();
        return;
      }
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.destination = String(value || "").trim();
      order.destinationModifiedManual = true;
      order.daeDestination = order.destination;
      setNotice(appState, "Destino actualizado manualmente para este pedido.", "info");
    } else if (field === "destinationCountry") {
      if (utils.isLocalOrder(order)) {
        utils.applyLocalOrderDefaults(order);
        saveDb();
        return;
      }
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.destinationCountry = String(value || "").trim();
      order.destinationCountryModifiedManual = true;
      setNotice(appState, "Pais actualizado manualmente para este pedido.", "info");
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
    } else if (field === "hawb") {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      order.hawb = utils.normalizeHawb(value);
      setNotice(
        appState,
        String(order.hawb || "").trim()
          ? "Guia hija registrada."
          : "Guia hija pendiente.",
        String(order.hawb || "").trim() ? "success" : "warning"
      );
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
      if (field === "coldRoom" && utils.isLocalOrder(order)) utils.applyLocalOrderDefaults(order);
      else order[field] = value;
    }

    const currentValue = JSON.stringify(order[field] ?? "");
    if (previousValue !== currentValue) {
      const labelFields = ["customerId", "brandId", "transportType", "flightDate", "destination", "destinationCountry", "agencyId", "coldRoom", "daeNumber", "invoicePackingNumber", "awb", "hawb", "airlineId", "flightNumber", "generalPo", "notes"];
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

    saveOrderDraft(appState, order);
    return { changed: previousValue !== currentValue, order };
  }

  function updateSriLogistics(appState, orderId, field, value) {
    const order = findOrder(appState, orderId);
    if (!order) return { ok: false, message: "No se encontro el pedido relacionado." };
    if (!["sriDaeNumber", "sriGuides", "awb", "hawb"].includes(field)) {
      return { ok: false, message: "El dato logistico solicitado no puede editarse desde SRI." };
    }

    const authorizationStatus = String(order.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
    if (order.sriRemoteDocumentId || authorizationStatus !== "PENDIENTE") {
      return { ok: false, message: "La DAE y las guias solo pueden editarse antes de crear el borrador SRI." };
    }

    const previousValue = String(order[field] || "");
    if (field === "sriDaeNumber") {
      order.sriDaeNumber = String(value || "").trim().slice(0, 50);
    } else if (["awb", "hawb"].includes(field)) {
      const storedGuides = String(order.sriGuides || "")
        .split(/\s+\/\s+|[\r\n,;|]+/)
        .map(item => item.trim())
        .filter(Boolean);
      if (!String(order.awb || "").trim() && storedGuides[0]) order.awb = storedGuides[0];
      if (!String(order.hawb || "").trim() && storedGuides[1]) order.hawb = storedGuides[1];
      order[field] = String(value || "").trim().slice(0, 120);
      order.sriGuides = [...new Set([order.awb, order.hawb]
        .map(item => String(item || "").trim())
        .filter(Boolean))]
        .join(" / ")
        .slice(0, 300);
    } else {
      order.sriGuides = [...new Set(String(value || "")
        .split(/[\r\n,;|/]+/)
        .map(item => item.trim())
        .filter(Boolean))]
        .join(" / ")
        .slice(0, 300);
    }

    if (previousValue !== String(order[field] || "")) {
      workflow.recordEvent(order, appState, {
        action: field === "sriDaeNumber" ? "CAMBIAR_DAE_SRI" : "EDITAR_GUIAS_SRI",
        actionLabel: field === "sriDaeNumber" ? "Cambiar DAE fiscal desde SRI" : `Editar ${fieldLabel(field)} desde SRI`,
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Se actualizo ${fieldLabel(field)} del pedido ${order.number} desde Documentos electronicos SRI.`,
        result: "exitoso"
      });
    }
    saveDb();
    return {
      ok: true,
      value: order[field] || "",
      message: `${field === "sriDaeNumber" ? "DAE fiscal" : field === "awb" ? "Guia madre" : field === "hawb" ? "Guia hija" : "Guias"} actualizada(s) para SRI en el pedido ${order.number}.`
    };
  }

  function updateOrderCoordination(appState, orderId, values = {}, options = {}) {
    const order = findOrder(appState, orderId);
    if (!order) return { ok: false, message: "No se encontro el pedido relacionado." };
    if (utils.isLocalOrder(order)) {
      return { ok: false, message: "La venta local no requiere coordinacion de guias ni DAE." };
    }
    const authorizationStatus = String(order.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
    if (order.sriRemoteDocumentId || authorizationStatus !== "PENDIENTE") {
      return { ok: false, message: "La coordinacion solo puede modificarse antes de crear el comprobante SRI." };
    }

    const before = {
      awb: String(order.awb || ""),
      hawb: String(order.hawb || ""),
      daeNumber: String(order.daeNumber || ""),
      sriDaeNumber: String(order.sriDaeNumber || "")
    };
    order.awb = String(values.awb || "").trim().slice(0, 120);
    order.hawb = String(values.hawb || "").trim().slice(0, 120);
    order.sriGuides = [...new Set([order.awb, order.hawb].filter(Boolean))].join(" / ").slice(0, 300);

    const maritime = String(order.transportType || "").trim().toUpperCase() === "MARITIMO";
    if (maritime) {
      const dae = String(values.daeNumber || values.sriDaeNumber || "").trim().slice(0, 50);
      order.daeNumber = dae;
      order.sriDaeNumber = dae;
    }

    const changed = before.awb !== order.awb
      || before.hawb !== order.hawb
      || before.daeNumber !== String(order.daeNumber || "")
      || before.sriDaeNumber !== String(order.sriDaeNumber || "");
    if (!changed) return { ok: true, changed: false, message: "La coordinacion no tiene cambios pendientes." };

    markRevisionChange(order, "LOGISTICA_ETIQUETA", orderBoxNumbers(order));
    invalidateCommercialDocuments(order, "Guias o DAE actualizadas desde Coordinacion diaria.");
    workflow.recordEvent(order, appState, {
      action: "ACTUALIZAR_COORDINACION",
      actionLabel: "Actualizar coordinacion diaria",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Se actualizaron las guias${maritime ? " y la DAE" : ""} del pedido ${order.number}.`,
      result: "exitoso"
    });
    if (!options.deferSave) saveDb();
    return { ok: true, changed: true, order, message: `Coordinacion del pedido ${order.number} actualizada.` };
  }

  function updateLineField(appState, lineId, field, value) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableLines(appState, order, "Las lineas del pedido estan bloqueadas. Reabra el pedido para modificarlas.")) return;
    beginOrderDraft(appState, order);

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
      if (scans > 0 && ["boxNumber", "boxType", "variety", "quality", "length", "lengthSelection", "stemsPerBunch"].includes(field)) {
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
    } else if (field === "quality") {
      line.quality = BlessERP.flowerQuality?.normalize?.(value) || "";
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
    saveOrderDraft(appState, order);
  }

  function addLine(appState) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableLines(appState, order, "No se puede agregar lineas en el estado actual.")) return;
    beginOrderDraft(appState, order);

    resetPackagingLifecycle(order);
    resetAccountingPreview(order);
    const nextBox = maxBoxNumber(order) + 1;
    order.lines.push(data.createLine({
      boxNumber: nextBox,
      boxType: "HB",
      variety: "EXPLORER",
      quality: "PREMIUM",
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
      description: `Se agrego la caja ${nextBox} en el pedido.`,
      result: "exitoso"
    });
    setNotice(appState, `Caja ${nextBox} agregada. Ingrese variedad, medida, ramos y precio manual por tallo.`, "info");
    ensureLabelSelection(ensureStore(appState), order);
    saveOrderDraft(appState, order);
  }

  function addBoxRange(appState) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede agregar un rango en el estado actual.")) {
      return { ok: false, error: "Pedido bloqueado." };
    }
    beginOrderDraft(appState, order);
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
    saveOrderDraft(appState, order);
    return { ...build, rangeId: build.groupId };
  }

  function addItemToBox(appState, boxNumber) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede agregar items en el estado actual.")) return { ok: false, error: "Pedido bloqueado." };
    beginOrderDraft(appState, order);
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
      quality: BlessERP.flowerQuality?.normalize?.(template.quality) || "PREMIUM",
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
    saveOrderDraft(appState, order);
    return { ok: true, line };
  }

  function duplicateBox(appState, boxNumber) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede duplicar cajas en el estado actual.")) return { ok: false, error: "Pedido bloqueado." };
    beginOrderDraft(appState, order);
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
    saveOrderDraft(appState, order);
    return { ok: true, boxNumber: nextBox };
  }

  function deleteBox(appState, boxNumber) {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (!ensureEditableLines(appState, order, "No se puede eliminar cajas en el estado actual.")) return { ok: false, error: "Pedido bloqueado." };
    const numericBox = Number(boxNumber || 0);
    const lines = order.lines.filter(line => Number(line.boxNumber) === numericBox);
    if (!lines.length) return { ok: false, error: "Caja no encontrada." };
    const activeBoxes = orderBoxNumbers(order);
    if (activeBoxes.length <= 1) {
      const error = "No se puede retirar la unica caja del pedido. Si el cliente cancelo todo, anule el pedido completo.";
      setNotice(appState, error, "warning");
      return { ok: false, error };
    }
    if (sriInvoiceAuthorized(order)) {
      const error = "La factura ya fue autorizada por el SRI. Para retirar una caja debe anular el comprobante conforme al proceso tributario y generar uno nuevo.";
      setNotice(appState, error, "warning");
      return { ok: false, error, requiresSriReview: true };
    }
    const scans = lines.reduce((sum, line) => sum + scannedCount(line), 0);
    if (scans > 0 && !order.revisionEditing) {
      const error = `La caja ${numericBox} tiene ${scans} ramo(s) leido(s). Inicie "Modificar pedido" para retirarla y devolver esos ramos a disponibilidad.`;
      blockOrderEdit(appState, order, error);
      return { ok: false, error };
    }
    beginOrderDraft(appState, order);

    if (!order.revisionEditing) {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      invalidateCommercialDocuments(order, "Caja eliminada antes de liberar el pedido.");
    }
    order.lines = order.lines.filter(line => Number(line.boxNumber) !== numericBox);
    markRevisionChange(order, "CAJAS", [numericBox]);
    workflow.recordEvent(order, appState, {
      action: order.revisionEditing ? "RETIRAR_CAJA_REVISION" : "ELIMINAR_CAJA",
      actionLabel: order.revisionEditing ? "Retirar caja del pedido" : "Eliminar caja",
      previousStatus: order.status,
      nextStatus: order.status,
      description: order.revisionEditing
        ? `Se marco la caja ${numericBox} para retiro en la revision ${order.revisionDraftNumber}. Sus ${scans} ramo(s) se liberaran al enviar la actualizacion a Bodega.`
        : `Se elimino la caja ${numericBox} antes de liberar el pedido.`,
      reason: order.revisionEditing ? order.revisionReason : "",
      result: "exitoso"
    });
    setNotice(
      appState,
      order.revisionEditing
        ? `Caja ${numericBox} retirada del borrador de la revision. Envie la actualizacion a Bodega para liberar ${scans} ramo(s).`
        : `Caja ${numericBox} eliminada.`,
      "warning"
    );
    ensureLabelSelection(ensureStore(appState), order);
    saveOrderDraft(appState, order);
    return { ok: true, pendingWarehouseUpdate: Boolean(order.revisionEditing), scannedBunches: scans };
  }

  function retireBoxAndUpdate(appState, boxNumber, reason = "") {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) return { ok: false, error: "Debe registrar el motivo para retirar la caja." };
    if (order.revisionEditing && order.revisionDataOnly) {
      return { ok: false, error: "Existe una edicion solo de datos abierta. Guardela o cancelala antes de retirar una caja." };
    }
    if (sriInvoiceAuthorized(order)) {
      return {
        ok: false,
        error: "La factura ya fue autorizada por el SRI. Debe anular el comprobante conforme al proceso tributario y generar uno nuevo.",
        requiresSriReview: true
      };
    }

    const startedHere = !order.revisionEditing;
    if (startedHere) {
      const started = startOrderRevision(appState, trimmedReason);
      if (!started?.ok) return started;
    } else if (!String(order.revisionReason || "").includes(trimmedReason)) {
      order.revisionReason = [order.revisionReason, trimmedReason].filter(Boolean).join(" | ");
    }
    const deleted = deleteBox(appState, boxNumber);
    if (!deleted?.ok) {
      if (startedHere) cancelOrderRevision(appState);
      return deleted;
    }
    const submitted = submitOrderRevision(appState);
    if (!submitted?.ok) {
      if (startedHere) cancelOrderRevision(appState);
      return submitted;
    }
    return { ...submitted, directBoxRetirement: true };
  }

  function duplicateLine(appState, lineId) {
    const order = currentOrder(appState);
    if (!order) return;
    if (!ensureEditableLines(appState, order, "No se puede duplicar lineas en el estado actual.")) return;
    beginOrderDraft(appState, order);

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
    saveOrderDraft(appState, order);
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
    beginOrderDraft(appState, order);
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
    saveOrderDraft(appState, order);
  }

  function applyAtomicOrderIdentifiers(appState, order, reservation, series) {
    const orderNumber = String(reservation.orderNumber || "").trim();
    const fullNumber = String(reservation.fullNumber || "").trim();
    const invoiceSequential = String(reservation.invoiceSequential || "").replace(/\D/g, "").padStart(9, "0").slice(-9);
    if (!orderNumber || !/^\d{3}-\d{3}-\d{9}$/.test(fullNumber) || !/^\d{9}$/.test(invoiceSequential)) {
      return { ok: false, error: "Supabase devolvio una reserva incompleta para el pedido o la factura." };
    }

    const previousFullNumber = String(order.sriInvoiceNumber || "").trim();
    order.number = orderNumber;
    order.numberPending = false;
    order.sriInvoiceNumber = fullNumber;
    order.sriSequential = invoiceSequential;
    order.packingListNumber = invoiceSequential;
    order.invoicePackingNumber = invoiceSequential;
    order.clientInvoiceNumber = invoiceSequential;
    order.invoiceSequence = invoiceSequential;
    order.sriSeriesCode = series.code || (utils.isLocalOrder(order) ? "FAC_LOCAL" : "FAC_EXPORT");
    order.sriMarket = series.market || (utils.isLocalOrder(order) ? "LOCAL" : "EXPORTACION");
    order.establishmentCode = String(reservation.establishmentCode || series.establishment || "001");
    order.emissionPointCode = String(reservation.emissionPointCode || series.emissionPoint || "001");
    order.sriSequenceStatus = "RESERVADO";
    order.sriSequenceSource = "SUPABASE_ATOMICO";
    order.sriSequenceReservationId = String(reservation.invoiceReservationId || "");
    order.sriSequenceAllocatedAt = String(reservation.reservedAt || new Date().toISOString());
    if (previousFullNumber && previousFullNumber !== fullNumber) {
      order.sriAccessKey = "";
      order.sriAuthorizationNumber = "";
      order.sriAuthorizedXml = "";
      order.sriRemoteDocumentId = "";
      order.sriQueueStatus = "PENDIENTE";
      order.sriQueuedAt = new Date().toISOString();
    }
    return { ok: true };
  }

  async function reserveCurrentOrderIdentifiers(appState, order) {
    const repository = BlessERP.getCommercialOrderRepository?.();
    if (!repository?.canListPage?.()) return { ok: true, mode: "LOCAL_FALLBACK" };
    if (String(order.sriAuthorizationStatus || "").toUpperCase() === "AUTORIZADO" || order.sriAuthorizedAt || order.sriRemoteDocumentId) {
      return { ok: true, mode: "SRI_LOCKED" };
    }

    order.issuedAt = String(order.issuedAt || BlessERP.utils.today()).slice(0, 10);
    const series = configuredInvoiceSeries(appState, order);
    const reservation = await repository.reserveIdentifiers(order, series);
    if (!reservation?.ok) {
      const error = reservation?.message || "No se pudo reservar el numero del pedido y la factura en Supabase.";
      setNotice(appState, error, "danger");
      return { ok: false, error, reservation };
    }
    const applied = applyAtomicOrderIdentifiers(appState, order, reservation, series);
    if (!applied.ok) {
      setNotice(appState, applied.error, "danger");
      return applied;
    }
    return { ok: true, mode: reservation.mode, reservation, series };
  }

  function prepareCurrentOrderSave(appState, options = {}) {
    const order = currentOrder(appState);
    if (!order) return { ok: false };
    const store = ensureStore(appState);
    const invalidQualityLine = (order.lines || []).find(line => !BlessERP.flowerQuality?.isValid?.(line.quality));
    if (invalidQualityLine) {
      const error = `Caja ${invalidQualityLine.boxNumber || "-"}: seleccione calidad PREMIUM o TIPO B.`;
      setNotice(appState, error, "warning");
      return { ok: false, error };
    }
    const deferIdentifiers = options.deferIdentifiers === true;
    if (!deferIdentifiers && (order.unsavedDraft || order.numberPending || !String(order.number || "").trim())) {
      order.number = nextOrderNumber(store.orders.filter(item => item.id !== order.id));
      order.numberPending = false;
    }
    if (utils.isLocalOrder(order)) utils.applyLocalOrderDefaults(order);
    order.issuedAt = String(order.issuedAt || BlessERP.utils.today()).slice(0, 10);
    order.sriIssueDate = order.issuedAt;
    const allocation = deferIdentifiers
      ? { ok: true, mode: "SUPABASE_PENDING", series: configuredInvoiceSeries(appState, order) }
      : enforceOrderInvoiceSeries(appState, order, {
          allocate: true,
          commitCounter: true
        });
    if (allocation.error) {
      setNotice(appState, allocation.error, "danger");
      return { ok: false, error: allocation.error };
    }
    if (!deferIdentifiers) {
      const assignedParts = invoiceSequence.fullNumberParts(order.sriInvoiceNumber);
      const assignedSequence = invoiceSequence.visibleInvoiceNumber(order);
      const assignedSeries = configuredInvoiceSeries(appState, order);
      const sequenceIsValid = Boolean(
        assignedParts
        && assignedSequence
        && assignedParts.sequence === assignedSequence
        && assignedParts.establishment === String(assignedSeries.establishment || "001")
        && assignedParts.emissionPoint === String(assignedSeries.emissionPoint || "001")
        && invoiceSequence.isSynchronized(order)
      );
      if (!sequenceIsValid) {
        const error = "No se pudo confirmar el secuencial de la factura. Revise la serie configurada y vuelva a guardar el pedido.";
        setNotice(appState, error, "danger");
        return { ok: false, error };
      }
    }
    order.unsavedDraft = false;
    order.savedAt = order.savedAt || new Date().toISOString();
    store.ui.orderWorkspaceMode = "EDIT";
    order.sriAuthorizationStatus = order.sriAuthorizationStatus || "PENDIENTE";
    order.sriQueueStatus = order.sriQueueStatus || "PENDIENTE";
    order.sriQueuedAt = order.sriQueuedAt || new Date().toISOString();
    const externalSupply = String(order.inventorySupplyMode || order.inventory_supply_mode || "").trim().toUpperCase() === "EXTERNAL_FARM";
    if (externalSupply) {
      order.availabilityCommitmentStatus = "NO_APLICA";
      order.availabilityCommittedAt = "";
      order.availabilityCommittedBy = "";
      order.availabilityCommitmentSource = "COMPRA_EXTERNA_SIN_INVENTARIO";
      order.inventoryConsumptionMode = "SIN_INVENTARIO";
      order.inventoryConsumptionApplied = false;
    } else {
      const availabilityPolicy = BlessERP.operacionesAvailabilityPolicy;
      const preparationDate = availabilityPolicy?.orderPreparationDate?.(order) || order.flightDate || order.issuedAt;
      const today = availabilityPolicy?.localDateKey?.() || BlessERP.utils.today();
      const futureOrder = Boolean(preparationDate && preparationDate > today);
      const alreadyReserved = availabilityPolicy?.isExplicitlyReserved?.(order) === true;
      if (futureOrder && !alreadyReserved) {
        order.availabilityReservationMode = "INFORMATIVO";
        order.availabilityCommitmentStatus = "INFORMATIVO_FUTURO";
        order.availabilityStatus = "PROYECTADO";
        order.availabilityCommittedAt = "";
        order.availabilityCommittedBy = "";
        order.availabilityCommitmentSource = "PEDIDO_FUTURO_INFORMATIVO";
      } else {
        order.availabilityReservationMode = alreadyReserved ? "RESERVADO" : "ACTIVO_DIA";
        order.availabilityCommitmentStatus = alreadyReserved ? "RESERVADO_FUTURO" : "ACTIVO";
        order.availabilityStatus = "ACTIVO";
        order.availabilityCommittedAt = order.availabilityCommittedAt || new Date().toISOString();
        order.availabilityCommittedBy = order.availabilityCommittedBy || activeUser(appState).name || "Usuario comercial";
        order.availabilityCommitmentSource = alreadyReserved ? "RESERVA_FUTURA_MANUAL" : "GUARDAR_PEDIDO";
      }
    }
    workflow.recordEvent(order, appState, {
      action: "GUARDAR_PEDIDO",
      actionLabel: "Guardar pedido",
      previousStatus: order.status,
      nextStatus: order.status,
      description: `Pedido ${order.number || "por asignar"} guardado y disponible en la bandeja SRI sin autorizar.`,
      result: "exitoso"
    });
    return { ok: true, order, allocation };
  }

  function saveCurrentOrder(appState) {
    const prepared = prepareCurrentOrderSave(appState);
    if (!prepared.ok) return prepared;
    setNotice(appState, `Pedido guardado con factura ${prepared.order.sriInvoiceNumber}. Quedo pendiente en Documentos electronicos SRI.`, "success");
    saveDb();
    return prepared;
  }

  async function saveCurrentOrderConfirmed(appState) {
    cancelScheduledOrderDraftSave();
    const draftOrder = currentOrder(appState);
    if (!draftOrder) return { ok: false, error: "No existe un pedido activo para guardar." };
    const attemptedDraft = BlessERP.utils.clone(draftOrder);
    beginOrderDraft(appState, draftOrder);
    const repository = BlessERP.getCommercialOrderRepository?.();

    if (repository?.remoteRequired?.() === true && repository?.canListPage?.() !== true) {
      const message = "Supabase está configurado, pero el contexto remoto del pedido no está disponible. El pedido no se guardó ni consumió secuenciales.";
      setNotice(appState, message, "danger");
      return { ok: false, confirmed: false, pending: false, error: message, order: draftOrder };
    }

    if (repository?.canListPage?.() && typeof repository.saveConfirmedOrder === "function") {
      const orderId = String(draftOrder.id || "");
      const basePayload = BlessERP.utils.clone(orderDraftSnapshotById.get(orderId) || {});
      const prepared = prepareCurrentOrderSave(appState, { deferIdentifiers: true });
      if (!prepared.ok) {
        restoreOrderDraftAfterFailedCommit(appState, orderId);
        return prepared;
      }
      const { order, allocation } = prepared;
      prepareOrderDraftCommit(appState, order);
      const series = configuredInvoiceSeries(appState, order);
      let confirmation = null;
      try {
        confirmation = await repository.saveConfirmedOrder(order, series, {
          basePayload,
          baseVersion: Number(order.__syncVersion || 0)
        });
      } catch (error) {
        confirmation = {
          ok: false,
          confirmed: false,
          mode: "REMOTE_SAVE_ERROR",
          message: error?.message || "No se pudo confirmar el pedido en Supabase."
        };
      }

      if (confirmation?.confirmed === true && confirmation?.serverRecord) {
        const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(confirmation.serverRecord, {
          source: "ATOMIC_ORDER_SAVE",
          force: true,
          forceServer: true,
          ignoreEditGuard: true,
          ignoreRecordHold: true
        });
        if (applied?.ok === false) {
          confirmation = {
            ...confirmation,
            ok: false,
            confirmed: false,
            message: "Supabase guardo el pedido, pero no se pudo actualizar esta pantalla. Recargue para obtener la version oficial."
          };
        } else {
          await completeOrderDraftCommit(appState, orderId);
          const savedOrder = findOrder(appState, orderId) || order;
          setNotice(
            appState,
            `Pedido ${savedOrder.number} guardado con factura ${savedOrder.sriInvoiceNumber}. Confirmado en Supabase y visible para los demas dispositivos.`,
            "success"
          );
          return {
            ok: true,
            confirmed: true,
            order: savedOrder,
            allocation,
            confirmation
          };
        }
      }

      // La RPC es transaccional: si falla, no consume secuencial. Se restaura
      // solamente el formulario que el usuario estaba editando y queda como
      // borrador local; nunca se inventa un pedido remoto inexistente.
      Object.keys(order).forEach(key => delete order[key]);
      Object.assign(order, attemptedDraft);
      restoreOrderDraftAfterFailedCommit(appState, orderId);
      const pendingMessage = confirmation?.message || "Supabase no confirmo el pedido. No se consumio ningun secuencial y sus datos siguen en este formulario.";
      setNotice(appState, pendingMessage, "danger");
      return {
        ok: false,
        pending: false,
        confirmed: false,
        error: pendingMessage,
        order,
        allocation,
        confirmation
      };
    }

    // El archivo local conserva el flujo previo para pruebas sin Supabase.
    const reserved = draftOrder
      ? await reserveCurrentOrderIdentifiers(appState, draftOrder)
      : { ok: false, error: "No existe un pedido activo para guardar." };
    if (!reserved.ok) return reserved;
    const prepared = prepareCurrentOrderSave(appState);
    if (!prepared.ok) return prepared;
    const { order, allocation } = prepared;
    const orderId = order.id;
    const minimumVersion = Math.max(1, Number(order.__syncVersion || 0) + 1);
    prepareOrderDraftCommit(appState, order);
    let confirmation = null;
    try {
      confirmation = await BlessERP.state.saveDbConfirmed({
        entity: "commercial_orders",
        recordId: orderId,
        minimumVersion,
        skipCloudSnapshot: true
      });
    } catch (error) {
      confirmation = {
        ok: false,
        confirmed: false,
        mode: "REMOTE_SAVE_ERROR",
        message: error?.message || "No se pudo confirmar el pedido en Supabase."
      };
    }

    const localOnlyConfirmed = confirmation?.ok === true && confirmation?.mode === "LOCAL_ONLY";
    if (confirmation?.confirmed === true || localOnlyConfirmed) {
      await completeOrderDraftCommit(appState, orderId);
      const savedOrder = findOrder(appState, orderId) || order;
      setNotice(
        appState,
        localOnlyConfirmed
          ? `Pedido guardado localmente con factura ${savedOrder.sriInvoiceNumber} y visible en el historial de este equipo.`
          : `Pedido guardado con factura ${savedOrder.sriInvoiceNumber}. Confirmado en Supabase y visible en el historial.`,
        "success"
      );
      return {
        ok: true,
        confirmed: true,
        localOnly: localOnlyConfirmed,
        order: savedOrder,
        allocation,
        confirmation
      };
    }

    restoreOrderDraftAfterFailedCommit(appState, orderId);
    const savedOrder = findOrder(appState, orderId) || order;
    const pendingMessage = confirmation?.message
      || "El pedido se conservo en este equipo, pero Supabase aun no confirmo el guardado. Se reintentara automaticamente.";
    setNotice(appState, pendingMessage, confirmation?.ok === false ? "danger" : "warning");
    return {
      ok: false,
      pending: true,
      confirmed: false,
      error: pendingMessage,
      order: savedOrder,
      allocation,
      confirmation
    };
  }

  function syncSriDocument(appState, orderId, detail) {
    const order = findOrder(appState, orderId);
    const document = detail?.document || detail;
    if (!order || !document) return false;

    const previousStatus = String(order.sriAuthorizationStatus || "PENDIENTE");
    if (document.full_number) {
      Object.assign(order, invoiceSequence.synchronize(order, {
        authoritativeFullNumber: document.full_number,
        establishment: document.establishment_code,
        emissionPoint: document.emission_point_code
      }));
    }
    order.sriRemoteDocumentId = document.id || order.sriRemoteDocumentId || "";
    order.sriAuthorizationStatus = String(document.status || order.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
    order.sriQueueStatus = order.sriAuthorizationStatus;
    order.sriIssueDate = document.issue_date || order.sriIssueDate || "";
    order.sriAccessKey = document.access_key || order.sriAccessKey || "";
    order.sriAuthorizationNumber = document.authorization_number || order.sriAuthorizationNumber || "";
    order.sriAuthorizedAt = document.authorized_at || order.sriAuthorizedAt || "";
    order.sriQueuedAt = order.sriQueuedAt || new Date().toISOString();
    order.sriSubtotal = Number(document.subtotal ?? order.sriSubtotal ?? 0);
    order.sriTaxTotal = Number(document.tax_total ?? order.sriTaxTotal ?? 0);
    order.sriGrandTotal = Number(document.grand_total ?? order.sriGrandTotal ?? 0);
    order.sriBackendAccountingStatus = String(detail?.accountingLinks?.[0]?.status || order.sriBackendAccountingStatus || "");

    if (previousStatus !== order.sriAuthorizationStatus) {
      workflow.recordEvent(order, appState, {
        action: "ACTUALIZAR_ESTADO_SRI",
        actionLabel: "Actualizar estado SRI",
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Comprobante ${order.sriInvoiceNumber} actualizado a ${order.sriAuthorizationStatus} por respuesta del backend SRI.`,
        result: ["DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO"].includes(order.sriAuthorizationStatus) ? "advertencia" : "exitoso"
      });
    }
    if (order.sriAuthorizationStatus === "AUTORIZADO") {
      const receivableService = BlessERP.services?.receivables;
      const receivableResult = receivableService?.syncAuthorizedSale?.(appState, order);
      if (!receivableService?.syncAuthorizedSale) {
        order.receivableSyncStatus = "PENDIENTE";
        order.receivableSyncError = "El servicio contable de ventas no esta disponible en esta pantalla.";
        order.saleAccountingStatus = "PENDIENTE";
      } else if (!receivableResult?.ok) {
        order.receivableSyncStatus = "ERROR";
        order.receivableSyncError = receivableResult.message || receivableResult.errors?.join(" ") || "No se pudo crear la cuenta por cobrar.";
      } else {
        order.receivableSyncError = "";
        order.saleAccountingStatus = receivableResult.accountingOk
          ? "CONTABILIZADO"
          : receivableResult.accountingPending ? "PENDIENTE" : "ERROR";
        order.saleAccountingError = receivableResult.accountingOk || receivableResult.accountingPending
          ? ""
          : (receivableResult.errors?.join(" ") || "No se pudo contabilizar la venta.");
      }
    }
    saveDb();
    return order;
  }

  async function applyLocalSriIssueDate(appState, orderId, issueDate, options = {}) {
    const order = findOrder(appState, orderId);
    const normalizedDate = String(issueDate || "").slice(0, 10);
    if (!order || !utils.isLocalOrder(order) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return false;
    const repository = BlessERP.getCommercialOrderRepository?.();
    if (!repository?.getFullOrder || !repository?.patchSriIssueDate) {
      throw new Error("La mutación Comercial V2 para la fecha SRI no está disponible.");
    }
    const canonical = await repository.getFullOrder(orderId);
    if (!canonical?.ok || !canonical.order) {
      throw new Error(canonical?.message || "No fue posible consultar el pedido canónico antes de actualizar su fecha SRI.");
    }
    const canonicalDate = String(canonical.order.issuedAt || "").slice(0, 10);
    const canonicalSriDate = String(canonical.order.sriIssueDate || "").slice(0, 10);
    let confirmedOrder = canonical.order;
    if (canonicalDate !== normalizedDate || canonicalSriDate !== normalizedDate) {
      const result = await repository.patchSriIssueDate(orderId, normalizedDate, options.documentId, {
        expectedVersion: canonical.order.__syncVersion
      });
      if (!result?.ok) {
        throw new Error(result?.message || "Supabase rechazó la actualización canónica de la fecha SRI.");
      }
      const serverRecord = result.serverRecord || {};
      confirmedOrder = utils.normalizeOrder({
        ...(serverRecord.payload || {}),
        id: String(serverRecord.record_id || orderId),
        __syncVersion: Number(serverRecord.version || 0),
        __syncUpdatedAt: String(serverRecord.updated_at || "")
      });
    }
    Object.keys(order).forEach(key => delete order[key]);
    Object.assign(order, confirmedOrder);
    return true;
  }

  function syncSriCreditNote(appState, orderId, detail) {
    const order = findOrder(appState, orderId);
    const document = detail?.document || detail;
    if (!order || !document || String(document.document_type || document.documentType || "") !== "04") return false;
    const source = document.source_snapshot || detail?.source || {};
    const reason = source.creditNote?.reason || source.additionalInformation?.Motivo || "";
    const record = {
      id: document.id || "",
      remoteDocumentId: document.id || "",
      documentNumber: document.full_number || "",
      authorizationNumber: document.authorization_number || "",
      accessKey: document.access_key || "",
      issueDate: document.issue_date || "",
      authorizedAt: document.authorized_at || "",
      status: String(document.status || "BORRADOR").toUpperCase(),
      reason,
      subtotal: Number(document.subtotal ?? source.creditNote?.subtotal ?? 0),
      taxTotal: Number(document.tax_total ?? source.creditNote?.taxTotal ?? 0),
      total: Number(document.grand_total || source.creditNote?.modificationValue || 0),
      lines: (detail?.lines || source.lines || []).map(line => ({
        sourceLineId: line.source_line_id || line.sourceLineId || "",
        description: line.description || "",
        variety: line.variety || "",
        measure: line.measure || "",
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unit_price ?? line.unitPrice ?? 0),
        subtotal: Number(line.subtotal || 0)
      }))
    };
    order.sriCreditNotes = Array.isArray(order.sriCreditNotes) ? order.sriCreditNotes : [];
    const index = order.sriCreditNotes.findIndex(note => String(note.remoteDocumentId || note.id) === String(record.remoteDocumentId));
    const before = index >= 0 ? order.sriCreditNotes[index] : null;
    if (index >= 0) order.sriCreditNotes[index] = record;
    else order.sriCreditNotes.unshift(record);
    if (record.status === "AUTORIZADO") {
      const applied = BlessERP.services?.receivables?.applyAuthorizedCreditNote?.(order, record);
      record.receivableApplyStatus = applied?.ok ? "APLICADA" : "PENDIENTE";
      record.receivableApplyMessage = applied?.ok ? "" : applied?.message || "";
      record.accountingStatus = applied?.accountingOk ? "CONTABILIZADO" : "ERROR";
      record.accountingError = applied?.accountingOk ? "" : (applied?.accounting?.errors?.join(" ") || "No se pudo contabilizar la nota de credito.");
      record.journalEntryId = applied?.accounting?.entry?.id || "";
      record.journalEntryNumber = applied?.accounting?.entry?.entryNumber || "";
    }
    if (!before || before.status !== record.status) {
      workflow.recordEvent(order, appState, {
        action: "ACTUALIZAR_NOTA_CREDITO_SRI",
        actionLabel: "Actualizar nota de credito SRI",
        previousStatus: order.status,
        nextStatus: order.status,
        description: `Nota de credito ${record.documentNumber || record.id} actualizada a ${record.status}.`,
        result: ["DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO"].includes(record.status) ? "advertencia" : "exitoso"
      });
    }
    saveDb();
    return record;
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

    if (nextStatus === "ANULADO") {
      const sriStatus = String(order.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
      const sriProcessStarted = Boolean(order.sriRemoteDocumentId) || !["PENDIENTE", "ANULADO"].includes(sriStatus);
      if (sriProcessStarted && sriStatus !== "ANULADO") {
        const message = sriStatus === "AUTORIZADO"
          ? "La factura ya esta AUTORIZADA por el SRI. Primero debe anularse conforme al proceso del SRI o mediante nota de credito; el secuencial no se reutiliza."
          : `El comprobante ya inicio el proceso SRI (${sriStatus}). Revise ese documento antes de anular el pedido; el secuencial no se reutiliza.`;
        workflow.recordEvent(order, appState, {
          action: "BLOQUEAR_ANULACION_SRI",
          actionLabel: "Bloqueo de anulacion por SRI",
          previousStatus: currentStatus,
          nextStatus: currentStatus,
          description: message,
          reason: trimmedReason,
          result: "bloqueado"
        });
        setNotice(appState, message, "warning");
        saveDb();
        return { ok: false, message, requiresSriReview: true };
      }
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

    let cancellationRelease = null;
    if (nextStatus === "ANULADO") {
      cancellationRelease = BlessERP.comercialOrderFulfillment?.releaseOrderForCancellation?.(
        appState,
        order,
        trimmedReason,
        activeUser(appState).name || "Usuario demo"
      ) || { ok: true, releasedBunches: 0 };
      if (!cancellationRelease.ok) {
        workflow.recordEvent(order, appState, {
          action: "BLOQUEAR_ANULACION_DESPACHO",
          actionLabel: "Bloqueo de anulacion por despacho",
          previousStatus: currentStatus,
          nextStatus: currentStatus,
          description: cancellationRelease.error,
          reason: trimmedReason,
          result: "bloqueado"
        });
        setNotice(appState, cancellationRelease.error, "warning");
        saveDb();
        return { ok: false, message: cancellationRelease.error };
      }
    }

    order.status = nextStatus;
    order.statusUpdatedAt = nowForOrder();
    order.statusUpdatedBy = activeUser(appState).name || "Usuario demo";
    order.lastTransitionReason = trimmedReason;

    if (nextStatus === "ANULADO") {
      releaseReservationsForOrder(appState, order.id);
      order.sriSequenceStatus = String(order.sriAuthorizationStatus || "").toUpperCase() === "ANULADO"
        ? "ANULADO_SRI"
        : "RESERVADO_ANULADO";
      order.sriSequenceAnnulledAt = order.statusUpdatedAt;
      order.sriSequenceAnnulReason = trimmedReason;
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
      ? `Pedido anulado. Se conservo el secuencial ${order.sriSequential || "asignado"} como no reutilizable, se liberaron sus reservas y ${cancellationRelease?.releasedBunches || 0} ramo(s) regresaron a disponibilidad.`
      : `Pedido actualizado a ${nextStatus}.`;
    setNotice(appState, successMessage, nextStatus === "ANULADO" ? "warning" : "success");
    saveDb();
    return { ok: true, status: nextStatus };
  }

  function hasSriElectronicArtifact(order) {
    if (!order) return false;
    return Boolean(
      String(order.sriRemoteDocumentId || "").trim()
      || String(order.sriAccessKey || "").trim()
      || String(order.sriAuthorizationNumber || "").trim()
      || String(order.sriAuthorizedXml || "").trim()
    );
  }

  function archiveAnnulledOrderFromHistory(appState, orderId) {
    const order = findOrder(appState, orderId);
    if (!order) return { ok: false, message: "Pedido no encontrado." };
    if (workflow.normalizeStatus(order.status) !== "ANULADO") {
      return { ok: false, message: "Solo se pueden retirar del historial los pedidos anulados." };
    }
    if (order.historyArchivedAt) {
      return { ok: true, alreadyArchived: true, hasSriArtifact: hasSriElectronicArtifact(order) };
    }

    const archivedAt = nowForOrder();
    const archivedBy = activeUser(appState).name || "Usuario comercial";
    const hasSriArtifact = hasSriElectronicArtifact(order);
    order.historyArchivedAt = archivedAt;
    order.historyArchivedBy = archivedBy;
    order.historyArchiveReason = order.lastTransitionReason || order.sriSequenceAnnulReason || "Pedido anulado retirado del historial operativo.";
    order.sriSequenceStatus = String(order.sriAuthorizationStatus || "").toUpperCase() === "ANULADO"
      ? "ANULADO_SRI"
      : "RESERVADO_ANULADO";
    order.sriQueueStatus = hasSriArtifact ? "ANULADO" : "RETIRADO_ANULADO";
    if (hasSriArtifact) order.sriAuthorizationStatus = "ANULADO";

    const store = ensureStore(appState);
    store.ui.printCenterSelectedOrderIds = (store.ui.printCenterSelectedOrderIds || [])
      .filter(id => String(id) !== String(order.id));
    store.ui.labelSelectedOrderIds = (store.ui.labelSelectedOrderIds || [])
      .filter(id => String(id) !== String(order.id));

    workflow.recordEvent(order, appState, {
      action: "ARCHIVAR_PEDIDO_ANULADO",
      actionLabel: "Retirar anulado del historial",
      previousStatus: "ANULADO",
      nextStatus: "ANULADO",
      description: hasSriArtifact
        ? `Pedido ${order.number} retirado del historial operativo. Su comprobante se conserva como ANULADO en Documentos electronicos SRI.`
        : `Pedido ${order.number} retirado del historial operativo y de la bandeja pendiente SRI. Su secuencial permanece anulado y no reutilizable.`,
      reason: order.historyArchiveReason,
      result: "exitoso"
    });
    setNotice(
      appState,
      hasSriArtifact
        ? "Pedido retirado del historial. El comprobante permanece como ANULADO para auditoria SRI."
        : "Pedido retirado del historial y de pendientes SRI. El secuencial no se reutilizara.",
      "success"
    );
    saveDb();
    return { ok: true, hasSriArtifact };
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
    const releaseValidation = service.validateRelease(releaseCandidate, appState);
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

  async function saveAndMarkReadyWarehouseConfirmed(appState) {
    cancelScheduledOrderDraftSave();
    const draftOrder = currentOrder(appState);
    if (!draftOrder) {
      return { ok: false, confirmed: false, stage: "GUARDADO_PEDIDO", error: "No existe un pedido activo para guardar." };
    }

    // El primer guardado confirma todos los datos comerciales y asigna los
    // secuenciales en Supabase. Cuarto frio nunca debe recibir un borrador que
    // solo exista en la memoria o en la cache de este dispositivo.
    const saved = await saveCurrentOrderConfirmed(appState);
    if (!saved?.confirmed) {
      return {
        ...saved,
        ok: false,
        confirmed: false,
        stage: "GUARDADO_PEDIDO",
        error: saved?.error || "Supabase no confirmo el pedido; no se envio a Cuarto frio."
      };
    }

    const order = findOrder(appState, saved.order?.id) || currentOrder(appState);
    if (!order) {
      return {
        ok: false,
        confirmed: false,
        saved: true,
        stage: "PREPARACION_CUARTO_FRIO",
        error: "El pedido se guardo, pero no pudo prepararse para Cuarto frio."
      };
    }

    const beforeRelease = BlessERP.utils.clone(order);
    beginOrderDraft(appState, order);
    const released = markReadyWarehouse(appState);
    if (!released?.ok) {
      Object.keys(order).forEach(key => delete order[key]);
      Object.assign(order, beforeRelease);
      await completeOrderDraftCommit(appState, order.id);
      const detail = released?.validation?.errors?.join(" | ")
        || released?.error
        || released?.message
        || "El pedido se guardo, pero no pudo enviarse a Cuarto frio.";
      setNotice(appState, detail, "warning");
      return {
        ...released,
        ok: false,
        confirmed: false,
        saved: true,
        stage: "LIBERACION_CUARTO_FRIO",
        error: detail,
        order
      };
    }

    // La liberacion modifica el mismo registro ya confirmado. Se vuelve a
    // guardar mediante la RPC transaccional para que el estado visible en
    // Cuarto frio tambien quede confirmado antes de informar exito.
    const confirmedRelease = await saveCurrentOrderConfirmed(appState);
    if (!confirmedRelease?.confirmed) {
      const current = findOrder(appState, order.id) || order;
      Object.keys(current).forEach(key => delete current[key]);
      Object.assign(current, beforeRelease);
      await completeOrderDraftCommit(appState, current.id);
      const detail = confirmedRelease?.error
        || "El pedido se guardo, pero Supabase no confirmo el envio a Cuarto frio.";
      setNotice(appState, detail, "danger");
      return {
        ...confirmedRelease,
        ok: false,
        confirmed: false,
        saved: true,
        stage: "CONFIRMACION_CUARTO_FRIO",
        error: detail,
        order: current
      };
    }

    const confirmedOrder = confirmedRelease.order || findOrder(appState, order.id) || order;
    setNotice(
      appState,
      `${confirmedOrder.number || "Pedido"} guardado y enviado a Cuarto frio. Confirmado en Supabase.`,
      "success"
    );
    return {
      ok: true,
      confirmed: true,
      saved: true,
      released: true,
      stage: "COMPLETADO",
      order: confirmedOrder,
      saveResult: saved,
      releaseResult: released,
      confirmation: confirmedRelease
    };
  }

  function startOrderRevision(appState, reason = "") {
    const order = currentOrder(appState);
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (sriInvoiceAuthorized(order)) {
      return { ok: false, error: "La factura ya fue AUTORIZADA por el SRI. Para corregir el pedido debe anular el comprobante conforme al proceso tributario y generar uno nuevo." };
    }
    if (String(order.status || "").toUpperCase() === "ANULADO") {
      return { ok: false, error: "Un pedido anulado no puede modificarse. Cree un pedido nuevo." };
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
    setNotice(appState, `Edicion R${order.revisionDraftNumber} abierta. Puede corregir cliente, logistica, cajas, cantidades y precios. Confirme con Actualizar pedido para notificar a Despacho.`, "info");
    saveDb();
    return { ok: true, order };
  }

  function startOrderDataEdit(appState, reason = "") {
    const result = startOrderRevision(appState, reason);
    if (!result?.ok) return result;
    result.order.revisionDataOnly = true;
    setNotice(
      appState,
      `Edicion de datos R${result.order.revisionDraftNumber} abierta. Las cajas permanecen bloqueadas; puede corregir DAE, guias y logistica.`,
      "info"
    );
    saveDb();
    return result;
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
    const currentBoxNumbers = orderBoxNumbers(order);
    const currentBoxes = new Set(currentBoxNumbers);
    const removedBoxNumbers = [...previousBoxes].filter(boxNumber => !currentBoxes.has(boxNumber)).sort((a, b) => a - b);
    const affectedBoxes = [...new Set([...(order.revisionAffectedBoxes || []), ...newBoxNumbers].map(Number).filter(Boolean))].sort((a, b) => a - b);
    const changeTypes = [...new Set(order.revisionChangeTypes || [])];
    const errors = [];
    if (!changeTypes.length && !affectedBoxes.length) errors.push("No se detectaron cambios para enviar a Bodega.");
    if (!currentBoxNumbers.length) errors.push("El pedido debe conservar al menos una caja. Para cancelar todo, anule el pedido completo.");
    if (newBoxNumbers.some(boxNumber => previousBoxes.has(boxNumber))) errors.push("Una caja nueva no puede usar el numero de una caja anterior.");
    if (sriInvoiceAuthorized(order)) {
      errors.push("La factura ya fue autorizada por el SRI. Para corregir el pedido debe anular el comprobante conforme al proceso tributario y generar uno nuevo.");
    }
    (order.lines || []).forEach(line => {
      if (!line.variety || Number(line.length) <= 0 || Number(line.bunches) <= 0 || Number(line.stemsPerBunch) <= 0) errors.push(`Caja ${line.boxNumber}: detalle incompleto.`);
      if (!BlessERP.flowerQuality?.isValid?.(line.quality)) errors.push(`Caja ${line.boxNumber}: falta calidad PREMIUM o TIPO B.`);
      if (Number(line.unitPrice) <= 0) errors.push(`Caja ${line.boxNumber}: falta precio manual por tallo.`);
      if (Number(line.bunches) < scannedCount(line)) errors.push(`Caja ${line.boxNumber}: la cantidad no puede ser menor que los ramos leidos.`);
    });
    const removedBoxLines = new Map(removedBoxNumbers.map(boxNumber => [
      boxNumber,
      (order.revisionSnapshot?.lines || []).filter(line => Number(line.boxNumber) === boxNumber)
    ]));
    removedBoxNumbers.forEach(boxNumber => {
      const review = BlessERP.comercialOrderFulfillment?.inspectBoxReleaseForCancellation?.(
        appState,
        order,
        boxNumber,
        removedBoxLines.get(boxNumber)
      );
      if (review && !review.ok) errors.push(review.error);
    });
    if (errors.length) return { ok: false, error: errors.join(" | "), errors };

    const revisionUser = appState.db.session?.activeUser?.name || "Usuario ventas demo";
    const cancellationTimestamp = new Date().toISOString();
    const releaseResults = removedBoxNumbers.map(boxNumber => {
      const snapshotLines = BlessERP.utils.clone(removedBoxLines.get(boxNumber) || []);
      const release = BlessERP.comercialOrderFulfillment?.releaseBoxForCancellation?.(
        appState,
        order,
        boxNumber,
        order.revisionReason,
        revisionUser,
        snapshotLines
      ) || { ok: true, boxNumber, releasedBunches: 0, staleAssignments: 0, releasedAt: cancellationTimestamp };
      order.cancelledBoxes = Array.isArray(order.cancelledBoxes) ? order.cancelledBoxes : [];
      order.cancelledBoxes.unshift({
        id: BlessERP.utils.uid("COM-CAJA-ANULADA"),
        boxNumber,
        lines: snapshotLines,
        revision: draftRevision,
        reason: order.revisionReason,
        cancelledAt: release.releasedAt || cancellationTimestamp,
        cancelledBy: revisionUser,
        releasedBunches: Number(release.releasedBunches || 0),
        status: "RETIRADA_ANTES_DE_FACTURAR"
      });
      return release;
    });
    if (changeTypes.length) {
      resetPackagingLifecycle(order);
      resetAccountingPreview(order);
      invalidateCommercialDocuments(order, order.revisionReason);
      if (sriProcessStarted(order) && !sriInvoiceAuthorized(order)) {
        order.sriRegenerationRequired = true;
        order.sriRegenerationReason = order.revisionReason;
        order.sriRegenerationRequestedAt = cancellationTimestamp;
      }
    }

    newLines.forEach(line => { line.state = "confirmado"; });
    order.revisionNumber = draftRevision;
    order.changeNotifications = Array.isArray(order.changeNotifications) ? order.changeNotifications : [];
    const affectsLabels = affectedBoxes.length > 0 && changeTypes.some(type => ["CAJAS", "MARCACION", "LOGISTICA_ETIQUETA"].includes(type));
    const labelAffectedBoxes = removedBoxNumbers.length
      ? [...new Set([...affectedBoxes, ...currentBoxNumbers])].sort((a, b) => a - b)
      : affectedBoxes;
    const labelsWerePrinted = Boolean(order.documentActivity?.ETIQUETAS?.printedAt);
    let reprintMessage = "";

    if (affectsLabels && labelsWerePrinted) {
      const previousLabelRevision = Number(order.labelRevision || 1);
      order.labelRevision = previousLabelRevision + 1;
      order.labelReprintRequired = true;
      order.invalidatedLabels = Array.isArray(order.invalidatedLabels) ? order.invalidatedLabels : [];
      order.invalidatedLabels.unshift({
        revision: previousLabelRevision,
        boxes: [...labelAffectedBoxes],
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
      labelAffectedBoxes.filter(boxNumber => currentBoxes.has(boxNumber)).forEach(boxNumber => {
        order.boxFulfillment[boxNumber] = {
          ...(order.boxFulfillment[boxNumber] || {}),
          labelStatus: "REIMPRESION_REQUERIDA",
          labelRevision: order.labelRevision
        };
      });
      reprintMessage = ` Etiqueta anterior anulada; imprimir revision R${order.labelRevision}.`;
    } else if (removedBoxNumbers.length && order.documentActivity?.ETIQUETAS) {
      order.documentActivity.ETIQUETAS = {
        ...order.documentActivity.ETIQUETAS,
        lastAction: "invalidated",
        invalidatedAt: cancellationTimestamp,
        invalidationReason: order.revisionReason,
        previewedAt: "",
        downloadedAt: "",
        regenerationRequired: true
      };
    }

    const releasedBunches = releaseResults.reduce((sum, item) => sum + Number(item.releasedBunches || 0), 0);
    const removedMessage = removedBoxNumbers.length
      ? ` Se retiro la caja${removedBoxNumbers.length > 1 ? "s" : ""} ${removedBoxNumbers.join(", ")} y ${releasedBunches} ramo(s) regresaron a disponibilidad.`
      : "";

    const notification = {
      id: BlessERP.utils.uid("COM-CAMBIO"),
      revision: draftRevision,
      type: changeTypes.includes("CAJAS") ? "CAMBIO_CAJAS" : changeTypes.includes("LOGISTICA_ETIQUETA") ? "CAMBIO_LOGISTICA" : "CAMBIO_COMERCIAL",
      boxNumbers: affectedBoxes,
      removedBoxNumbers: [...removedBoxNumbers],
      changeTypes,
      reason: order.revisionReason,
      message: affectedBoxes.length
        ? `Pedido actualizado en caja${affectedBoxes.length > 1 ? "s" : ""} ${affectedBoxes.join(", ")}.${removedMessage}${reprintMessage}`
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
    ensureLabelSelection(ensureStore(appState), order);
    setNotice(appState, `${notification.message} Bodega recibio la revision ${draftRevision}.`, "success");
    saveDb();
    return { ok: true, notification, order, removedBoxNumbers, releasedBunches };
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

  function createNewOrder(appState, seed = {}) {
    const store = ensureStore(appState);
    const orderCompanyId = seed.sellingCompanyId || seed.selling_company_id || seed.companyId || seed.company_id || activeCompanyId(appState);
    const imperioCompanyId = BlessERP.companyCapabilities?.COMPANY_IDS?.IMPERIO || "COMP-IMPERIO-FLOWERS";
    const order = data.createOrder({
      ...seed,
      sellingCompanyId: orderCompanyId,
      inventorySupplyMode: seed.inventorySupplyMode || seed.inventory_supply_mode || (orderCompanyId === imperioCompanyId ? "EXTERNAL_FARM" : "BLESS_INVENTORY"),
      id: BlessERP.utils.uid("COM-ORD"),
      number: "",
      numberPending: true,
      unsavedDraft: true,
      invoiceSequence: "",
      issuedAt: seed.issuedAt || BlessERP.utils.today(),
      flightDate: seed.flightDate || BlessERP.utils.today(),
      status: "BORRADOR",
      transportType: seed.transportType || "aereo",
      paymentTerms: seed.paymentTerms || data.company.paymentTermsDefault,
      expireDate: seed.expireDate || BlessERP.utils.today(),
      sriAuthorizationStatus: "PENDIENTE",
      sriQueueStatus: "NO_GENERADO",
      sriQueuedAt: ""
    });
    store.orders.unshift(order);
    store.ui.currentOrderId = order.id;
    tabOrderWorkspaceId = order.id;
    store.ui.orderWorkspaceMode = "CREATE";
    orderWorkspacePreparedInThisTab = true;
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
      description: order.sourcePoNumber
        ? `Pedido nuevo preparado desde ${order.sourcePoNumber}; el número se asignará al guardar.`
        : "Nuevo pedido preparado; el número se asignará al guardar.",
      result: "exitoso"
    });
    delete order.historySeedDisabled;
    setNotice(
      appState,
      order.sourcePoNumber
        ? `Pedido ${order.number} generado desde ${order.sourcePoNumber}. Complete sus datos y confirme a Bodega cuando corresponda.`
        : "Nuevo pedido creado en borrador.",
      order.sourcePoNumber ? "success" : "info"
    );
    saveOrderDraft(appState, order);
    return order;
  }

  function startNewOrderWorkspace(appState, seed = {}) {
    const store = ensureStore(appState);
    cancelScheduledOrderDraftSave();
    const current = currentOrder(appState);
    if (current?.unsavedDraft) {
      const orderId = String(current.id);
      store.orders = store.orders.filter(order => order.id !== orderId);
      store.ui.localDraftOrderIds = (store.ui.localDraftOrderIds || []).filter(id => String(id) !== orderId);
      BlessERP.offlineSync?.resumeRecordCapture?.("commercial_orders", orderId);
      const release = orderDraftReleaseById.get(orderId);
      orderDraftReleaseById.delete(orderId);
      orderDraftSnapshotById.delete(orderId);
      if (typeof release === "function") Promise.resolve(release()).catch(() => {});
    } else if (current?.id && orderDraftSnapshotById.has(String(current.id))) {
      const orderId = String(current.id);
      const confirmedSnapshot = BlessERP.utils.clone(orderDraftSnapshotById.get(orderId));
      Object.keys(current).forEach(key => { delete current[key]; });
      Object.assign(current, confirmedSnapshot);
      store.ui.localDraftOrderIds = (store.ui.localDraftOrderIds || []).filter(id => String(id) !== orderId);
      BlessERP.offlineSync?.resumeRecordCapture?.("commercial_orders", orderId);
      const release = orderDraftReleaseById.get(orderId);
      orderDraftReleaseById.delete(orderId);
      orderDraftSnapshotById.delete(orderId);
      if (typeof release === "function") Promise.resolve(release()).catch(() => {});
    }
    store.ui.currentOrderId = "";
    tabOrderWorkspaceId = "";
    clearOrderRequestFromUrl();
    return createNewOrder(appState, seed);
  }

  function clearOrderRequestFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("order") && !url.searchParams.has("new")) return false;
      url.searchParams.delete("order");
      url.searchParams.delete("new");
      window.history?.replaceState?.({}, "", url.href);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function resolveInitialOrderWorkspace(appState) {
    if (initialOrderWorkspaceResolved) return currentOrder(appState);
    initialOrderWorkspaceResolved = true;

    if (requestedOrderId) {
      if (openOrder(appState, requestedOrderId)) return currentOrder(appState);
      clearOrderRequestFromUrl();
    }

    if (orderWorkspacePreparedInThisTab) return currentOrder(appState);
    return startNewOrderWorkspace(appState);
  }

  function openOrder(appState, orderId) {
    const store = ensureStore(appState);
    if (!store.orders.some(order => order.id === orderId)) return false;
    store.ui.currentOrderId = orderId;
    tabOrderWorkspaceId = orderId;
    store.ui.orderWorkspaceMode = "EDIT";
    orderWorkspacePreparedInThisTab = true;
    store.ui.orderTab = "summary";
    store.ui.accountingPreviewView = "summary";
    store.ui.packagingViewMode = "material";
    resetLabelSelection(store, store.orders.find(order => order.id === orderId));
    resetClientInvoiceOptions(store);
    clearNotice(appState);
    return true;
  }

  function duplicateOrder(appState, orderId) {
    const store = ensureStore(appState);
    const source = store.orders.find(order => order.id === orderId);
    if (!source) return false;

    const clone = data.createOrder({
      ...source,
      id: BlessERP.utils.uid("COM-ORD"),
      number: "",
      numberPending: true,
      unsavedDraft: true,
      invoiceSequence: "",
      issuedAt: BlessERP.utils.today(),
      flightDate: BlessERP.utils.today(),
      status: "BORRADOR",
      awb: "",
      hawb: "",
      daeNumber: "",
      packingListNumber: "",
      invoicePackingNumber: "",
      clientInvoiceNumber: "",
      sriInvoiceNumber: "",
      sriSequential: "",
      sriAuthorizationStatus: "PENDIENTE",
      sriAuthorizationNumber: "",
      sriAccessKey: "",
      sriIssueDate: "",
      sriAuthorizedAt: "",
      sriRemoteDocumentId: "",
      sriSeriesCode: "",
      sriMarket: "",
      establishmentCode: "",
      emissionPointCode: "",
      sriSequenceSource: "PENDIENTE_GUARDADO",
      sriSequenceStatus: "SIN_ASIGNAR",
      sriQueueStatus: "NO_GENERADO",
      sriQueuedAt: "",
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
      cancelledBoxes: [],
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
    tabOrderWorkspaceId = clone.id;
    store.ui.orderWorkspaceMode = "CREATE";
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
    setNotice(appState, `Pedido preparado desde ${source.number}. El nuevo número se asignará al guardar.`, "info");
    saveOrderDraft(appState, clone);
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
          observacion: "Reserva creada desde Comercial / Crear pedido."
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
    applyLocalSriIssueDate,
    cancelOrderRevision,
    annulCurrentOrder,
    archiveAnnulledOrderFromHistory,
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
    deleteAgency,
    deleteBrand,
    deleteCountry,
    deleteCustomer,
    deleteDae,
    findOrder,
    getAgencyCatalog,
    getAirlineCatalog,
    getBrandCatalog,
    getBoxRangeDraft,
    getCountryCatalog,
    getCustomerCatalog,
    getDaeCatalog,
    getDestinationCatalog,
    getOrders,
    getReservations,
    getStore,
    getUi,
    hasSriElectronicArtifact,
    generateAccountingPreview,
    generateAccountingPreviewById,
    markDispatchedDemo,
    markAccountingReady,
    markAccountingReadyById,
    markPackagingConsumed,
    markPackagingPrepared,
    markReadyDispatch,
    markReadyWarehouse,
    saveAndMarkReadyWarehouseConfirmed,
    markReferential,
    newCustomer,
    newCountry,
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
    resolveInitialOrderWorkspace,
    retireBoxAndUpdate,
    reserveAvailability,
    saveCurrentOrder,
    saveCurrentOrderConfirmed,
    syncSriDocument,
    syncSriCreditNote,
    startNewOrderWorkspace,
    startOrderRevision,
    startOrderDataEdit,
    submitOrderRevision,
    saveAgency,
    saveAirline,
    saveBrand,
    saveCountry,
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
    setHistoryFilters,
    setHistorySearch,
    setHistoryStatus,
    setLabelPrintField,
    setLabelPrintMode,
    setLabelOrderSelected,
    setLabelOrderSelection,
    setNotice,
    setOrderTab,
    setOrderDetailBox,
    setOrderScanCode,
    setOrdersDayDate,
    setPackagingViewMode,
    setPrintCenterUi,
    setPrintCenterOrderSelected,
    setPrintCenterOrderSelection,
    setReservationLineDraft,
    setBoxBuilderMode,
    selectCustomer,
    selectCountry,
    selectDae,
    selectDestination,
    selectBrand,
    selectAgency,
    selectAirline,
    updateAgencyDraftField,
    updateAirlineDraftField,
    updateBrandDraftField,
    updateCountryDraftField,
    updateBoxRangeDraft,
    updateManualMixDraftItem,
    updateCustomerDraftField,
    updateDaeDraftField,
    updateDestinationDraftField,
    updateLineField,
    updateOrderField,
    updateOrderCoordination,
    updateSriLogistics,
    listSalespeople,
    applySellerLink,
    toggleDaeCustomer,
    validateDaeDraft,
    validateCurrentOrder
  };
})();
