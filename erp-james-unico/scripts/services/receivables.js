(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;
  const companyService = BlessERP.services.companySettings;
  const chartService = BlessERP.services.chartOfAccounts;
  const journalService = BlessERP.services.journal;
  const adminService = BlessERP.services.adminConfig;

  const customerTypes = ["local", "exterior", "comercializadora", "floristeria", "consumidor final", "otro"];
  const customerStates = ["activo", "inactivo"];
  const paymentConditions = ["Contado", "Credito 15 dias", "Credito 30 dias", "Credito 45 dias", "Credito 60 dias"];
  const receivableDocumentTypes = ["saldo inicial", "documento manual", "ajuste", "factura futura", "factura sri"];
  const receivableStates = ["PENDIENTE", "PARCIAL", "COBRADO", "VENCIDO", "ANULADO"];
  const collectionMethods = ["banco", "caja", "transferencia", "cheque", "efectivo", "tarjeta", "otro"];
  const collectionStates = ["BORRADOR", "CONFIRMADO", "ANULADO"];
  const collectionBatchStates = ["BORRADOR", "CONFIRMADO", "ANULADO"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  const lazyCustomers = { companyId: "", rows: [], promises: new Map() };
  function activeCompanyUuid() {
    return String(BlessERP.portfolioReadV2Repository?.activeCompanyUuid?.()
      || BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id
      || stateApi.state.db?.authAccess?.activeCompanyUuid
      || "").trim();
  }
  function resetLazyCustomers() {
    const companyId = activeCompanyUuid();
    if (lazyCustomers.companyId === companyId) return companyId;
    lazyCustomers.companyId = companyId;
    lazyCustomers.rows = [];
    lazyCustomers.promises.clear();
    return companyId;
  }
  function mergeLazyCustomers(incoming = []) {
    const companyId = resetLazyCustomers();
    const merged = new Map(lazyCustomers.rows.map(item => [String(item.id || ""), clone(item)]));
    (incoming || []).forEach(item => {
      const id = String(item?.id || "").trim();
      const itemCompanyId = String(item?.companyId || item?.company_id || companyId).trim();
      if (!id || !companyId || itemCompanyId !== companyId) return;
      merged.set(id, { ...clone(item), id, companyId });
    });
    lazyCustomers.rows = [...merged.values()];
    return clone(lazyCustomers.rows);
  }

  function currentUser() {
    return adminService?.activeUser?.() || stateApi.state.db.session?.activeUser || { id: "demo", name: "Usuario demo", role: "Administrador" };
  }

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function saveList(key, rows) {
    stateApi.state.db[key] = rows;
    stateApi.saveDb();
  }

  function bankService() {
    return BlessERP.services.banks;
  }

  function nextCustomerCode(existing = null) {
    const rows = existing || cloneList("customers");
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.code || "").replace(/\D/g, "") || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `CLI-${String(max + 1).padStart(3, "0")}`;
  }

  function nextReceivableNumber(existing = null) {
    const rows = existing || cloneList("customerReceivables");
    const year = companyService.settings().periodStart?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.documentNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `CXC-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function nextCollectionNumber(existing = null) {
    const rows = existing || cloneList("collections");
    const year = companyService.settings().periodStart?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.collectionNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `COB-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function nextCollectionBatchNumber(existing = null) {
    const rows = existing || cloneList("collectionBatches");
    const year = companyService.settings().periodStart?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.batchNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `LCB-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function normalizeCustomer(customer = {}) {
    const settings = companyService.settings();
    const current = clone(customer || {});
    const customerType = String(current.customerType || "otro").trim().toLowerCase();
    const localCustomer = customerType === "local";
    const defaultReceivableAccount = localCustomer
      ? (settings.defaultAccounts?.accountsReceivableCustomersLocal || settings.defaultAccounts?.accountsReceivableCustomers)
      : (settings.defaultAccounts?.accountsReceivableCustomersExport || settings.defaultAccounts?.accountsReceivableCustomers);
    return {
      id: current.id || uid("CUS"),
      code: String(current.code || "").trim(),
      taxId: String(current.taxId || current.identification || "").trim(),
      name: String(current.name || current.legalName || "").trim(),
      commercialName: String(current.commercialName || current.name || "").trim(),
      customerType,
      country: String(current.country || "Ecuador").trim(),
      city: String(current.city || "").trim(),
      address: String(current.address || "").trim(),
      phone: String(current.phone || "").trim(),
      email: String(current.email || "").trim(),
      paymentCondition: String(current.paymentCondition || "Credito 30 dias").trim(),
      creditDays: Number(current.creditDays ?? 30),
      creditLimit: round2(current.creditLimit || 0),
      receivableAccountCode: String(current.receivableAccountCode || defaultReceivableAccount || "").trim(),
      advanceAccountCode: String(current.advanceAccountCode || settings.defaultAccounts?.customerAdvances || "").trim(),
      status: String(current.status || "activo").trim().toLowerCase(),
      observation: String(current.observation || current.notes || "").trim(),
      hasMovements: Boolean(current.hasMovements),
      companyId: String(current.companyId || current.company_id || "").trim(),
      version: Number(current.version || 0),
      syncFlow: String(current.syncFlow || "").trim(),
      remoteConfirmed: Boolean(current.remoteConfirmed)
    };
  }

  function customerCatalog() {
    resetLazyCustomers();
    const combined = new Map();
    [...cloneList("customers"), ...lazyCustomers.rows].forEach(item => {
      const normalized = normalizeCustomer(item);
      if (!normalized.id) return;
      const current = combined.get(normalized.id);
      if (!current || normalized.version >= current.version) combined.set(normalized.id, normalized);
    });
    return [...combined.values()];
  }

  function customers() {
    const rows = customerCatalog();
    const receivableDocs = receivableDocuments();
    const collectionRows = cloneList("collections");
    const batchRows = cloneList("collectionBatches");
    return rows.map(customer => ({
      ...customer,
      hasMovements: receivableDocs.some(item => item.customerId === customer.id)
        || collectionRows.some(item => item.customerId === customer.id || item.customerTaxId === customer.taxId)
        || batchRows.some(item => (item.applications || []).some(app => app.customerId === customer.id || app.customerTaxId === customer.taxId))
    }));
  }

  function findCustomerById(customerId) {
    return customerCatalog().find(item => item.id === customerId);
  }

  function findCustomerByTaxId(taxId) {
    return customerCatalog().find(item => item.taxId === taxId);
  }

  async function resolveCanonicalCustomer(candidate = {}) {
    const customerId = String(candidate.customerId || candidate.id || "").trim();
    const companyId = resetLazyCustomers();
    if (!customerId) return { ok: false, customer: null, companyId, mode: "IDENTITY_REQUIRED", message: "Falta la identidad canónica del cliente." };
    const existing = findCustomerById(customerId);
    if (existing && (!existing.companyId || existing.companyId === companyId)) {
      return { ok: true, customer: existing, companyId, mode: "MEMORY_CACHE" };
    }
    if (lazyCustomers.promises.has(customerId)) return lazyCustomers.promises.get(customerId);
    const pending = (async () => {
      const result = await BlessERP.portfolioReadV2Repository?.customerById?.(customerId);
      if (!result?.ok || !result.customer) {
        return { ...(result || {}), ok: false, customer: null, companyId, message: result?.message || "No se pudo consultar el cliente canónico." };
      }
      if (String(result.companyId || "") !== companyId || String(result.customer.companyId || "") !== companyId) {
        return { ok: false, customer: null, companyId, mode: "COMPANY_MISMATCH", message: "El cliente pertenece a otra empresa." };
      }
      if (String(result.customer.id || "") !== customerId) {
        return { ok: false, customer: null, companyId, mode: "IDENTITY_MISMATCH", message: "La identidad del cliente no coincide." };
      }
      mergeLazyCustomers([result.customer]);
      return { ...result, customer: findCustomerById(customerId) };
    })().finally(() => lazyCustomers.promises.delete(customerId));
    lazyCustomers.promises.set(customerId, pending);
    return pending;
  }

  function validateCustomer(customer) {
    const candidate = normalizeCustomer(customer);
    const errors = [];
    if (!candidate.name) errors.push("La razon social / nombre es obligatoria.");
    if (!candidate.code) candidate.code = nextCustomerCode(customerCatalog());
    if (!candidate.taxId) {
      const commercialCustomers = stateApi.state.db.commercial?.customerCatalog || [];
      candidate.taxId = BlessERP.utils.nextCustomerExternalId(
        [...customerCatalog(), ...commercialCustomers],
        "",
        candidate.id
      );
    }
    const duplicateCode = customerCatalog().find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicateCode) errors.push("No se permite codigo de cliente duplicado.");
    const duplicateTaxId = customerCatalog().find(item => item.id !== candidate.id && item.taxId === candidate.taxId);
    if (duplicateTaxId) errors.push("No se permite identificacion duplicada.");
    if (!customerTypes.includes(candidate.customerType)) errors.push("El tipo de cliente no es valido.");
    if (!customerStates.includes(candidate.status)) errors.push("El estado del cliente no es valido.");
    return { customer: candidate, errors };
  }

  function saveCustomer(customer, options = {}) {
    const { customer: candidate, errors } = validateCustomer(customer);
    if (errors.length) return { ok: false, errors };
    const rows = customerCatalog();
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    stateApi.state.db.customers = rows;
    if (options.prepareOnly !== true && stateApi.saveDb() === false) return { ok: false, confirmed: false, customer: clone(candidate), errors: ["No se pudo conservar el cliente en este dispositivo."] };
    const audit = {
      module: "CARTERAS",
      action: index >= 0 ? "EDITAR_CLIENTE" : "CREAR_CLIENTE",
      entityType: "customer",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.name,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el cliente ${candidate.name}.`,
      before,
      after: candidate,
      result: "exitoso"
    };
    return { ok: true, confirmed: false, audit, customer: clone(candidate) };
  }

  async function saveCustomerConfirmed(customer) {
    const result = await BlessERP.services.confirmedFinanceRecord?.save("customers", () => saveCustomer(customer, { prepareOnly: true }));
    if (!result?.confirmed) return result || { ok: false, errors: ["No está disponible la confirmación del cliente."] };
    adminService?.addAuditLog?.({ ...result.audit, after: result.serverRecord.payload, result: "exitoso" });
    return result;
  }

  async function toggleCustomerStatusConfirmed(customerId) {
    const customer = customerCatalog().find(row => row.id === customerId);
    if (!customer) return { ok: false, errors: ["Cliente no encontrado."] };
    return saveCustomerConfirmed({ ...customer, status: customer.status === "activo" ? "inactivo" : "activo" });
  }

  function toggleCustomerStatus(customerId) {
    const rows = customerCatalog();
    const index = rows.findIndex(item => item.id === customerId);
    if (index < 0) return { ok: false, message: "Cliente no encontrado." };
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    saveList("customers", rows);
    adminService?.addAuditLog?.({
      module: "CARTERAS",
      action: "CAMBIAR_ESTADO_CLIENTE",
      entityType: "customer",
      entityId: rows[index].id,
      entityLabel: rows[index].code,
      documentLabel: rows[index].name,
      nextStatus: rows[index].status,
      description: `Cliente ${rows[index].name} cambiado a ${rows[index].status}.`,
      after: rows[index],
      result: "exitoso"
    });
    return { ok: true, customer: clone(rows[index]) };
  }

  function emptyReceivable(customerId = "") {
    const settings = companyService.settings();
    return {
      id: uid("DRAFT"),
      customerId,
      customerName: "",
      customerTaxId: "",
      customerCountry: "",
      documentType: "saldo inicial",
      documentNumber: nextReceivableNumber(),
      issueDate: today(),
      dueDate: today(),
      concept: "",
      marketType: "",
      subtotal: 0,
      taxTotal: 0,
      total: 0,
      receivableAccountCode: settings.defaultAccounts?.accountsReceivableCustomers || "",
      counterAccountCode: "",
      counterAccountName: "",
      taxAccountCode: "",
      taxAccountName: "",
      observation: "",
      status: "PENDIENTE",
      source: "MANUAL",
      journalEntryId: "",
      journalEntryNumber: "",
      postingStatus: "NO_CONTABILIZADO",
      accountingError: "",
      sourceOrderId: "",
      sourceDocumentId: "",
      authorizationNumber: "",
      accessKey: "",
      creditNotes: [],
      retentionPlaceholder: 0,
      advancePlaceholder: 0,
      createdBy: currentUser().name,
      createdAt: new Date().toISOString(),
      updatedBy: currentUser().name,
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeReceivable(receivable = {}) {
    const settings = companyService.settings();
    const current = {
      ...emptyReceivable(receivable.customerId || ""),
      ...clone(receivable || {})
    };
    const customer = current.customerId ? findCustomerById(current.customerId) : findCustomerByTaxId(current.customerTaxId);
    const inferredMarket = String(current.marketType || "").trim().toUpperCase()
      || (String(customer?.customerType || "").toLowerCase() === "local" ? "LOCAL" : "EXPORTACION");
    const defaultReceivableAccount = inferredMarket === "LOCAL"
      ? (settings.defaultAccounts?.accountsReceivableCustomersLocal || settings.defaultAccounts?.accountsReceivableCustomers)
      : (settings.defaultAccounts?.accountsReceivableCustomersExport || settings.defaultAccounts?.accountsReceivableCustomers);
    const defaultSalesAccount = inferredMarket === "LOCAL"
      ? (settings.defaultAccounts?.localSales || settings.defaultAccounts?.exportSales)
      : settings.defaultAccounts?.exportSales;
    const total = round2(current.total || 0);
    const taxTotal = round2(current.taxTotal || 0);
    const explicitSubtotal = Object.prototype.hasOwnProperty.call(receivable || {}, "subtotal")
      && (Number(receivable.subtotal || 0) > 0 || total === taxTotal);
    const subtotal = explicitSubtotal ? round2(current.subtotal) : round2(Math.max(0, total - taxTotal));
    const receivableAccountCode = String(current.receivableAccountCode || defaultReceivableAccount || "").trim();
    const counterAccountCode = String(current.counterAccountCode || (String(current.documentType || "").toLowerCase() === "factura sri" ? defaultSalesAccount : "") || "").trim();
    const taxAccountCode = String(current.taxAccountCode || (taxTotal > 0 ? settings.defaultAccounts?.vatSales : "") || "").trim();
    const counterAccount = counterAccountCode ? chartService.findByCode(counterAccountCode) : null;
    const taxAccount = taxAccountCode ? chartService.findByCode(taxAccountCode) : null;
    return {
      id: current.id || uid("CXC"),
      customerId: String(customer?.id || current.customerId || "").trim(),
      customerCode: String(customer?.code || current.customerCode || "").trim(),
      customerName: String(customer?.name || current.customerName || "").trim(),
      customerTaxId: String(customer?.taxId || current.customerTaxId || "").trim(),
      customerCountry: String(customer?.country || current.customerCountry || "").trim(),
      documentType: receivableDocumentTypes.includes(String(current.documentType || "").toLowerCase()) ? String(current.documentType || "").toLowerCase() : "saldo inicial",
      documentNumber: String(current.documentNumber || nextReceivableNumber()).trim(),
      issueDate: String(current.issueDate || today()).trim(),
      dueDate: String(current.dueDate || current.issueDate || today()).trim(),
      concept: String(current.concept || "").trim(),
      marketType: inferredMarket === "LOCAL" ? "LOCAL" : "EXPORTACION",
      subtotal,
      taxTotal,
      total,
      receivableAccountCode,
      counterAccountCode,
      counterAccountName: String(counterAccount?.name || current.counterAccountName || "").trim(),
      taxAccountCode,
      taxAccountName: String(taxAccount?.name || current.taxAccountName || "").trim(),
      observation: String(current.observation || "").trim(),
      status: String(current.status || "PENDIENTE").trim().toUpperCase(),
      source: String(current.source || "MANUAL").trim().toUpperCase(),
      journalEntryId: String(current.journalEntryId || "").trim(),
      journalEntryNumber: String(current.journalEntryNumber || "").trim(),
      postingStatus: String(current.postingStatus || (current.journalEntryId ? "CONTABILIZADO" : "NO_CONTABILIZADO")).trim().toUpperCase(),
      accountingError: String(current.accountingError || "").trim(),
      sourceOrderId: String(current.sourceOrderId || "").trim(),
      sourceDocumentId: String(current.sourceDocumentId || "").trim(),
      sourceType: String(current.sourceType || "").trim(),
      sourceId: String(current.sourceId || "").trim(),
      orderId: String(current.orderId || current.sourceOrderId || "").trim(),
      shipmentId: String(current.shipmentId || "").trim(),
      currencyCode: String(current.currencyCode || "USD").trim().toUpperCase(),
      exchangeRate: Number(current.exchangeRate || 1),
      balance: round2(current.balance ?? total),
      creditedTotal: round2(current.creditedTotal || 0),
      syncFlow: String(current.syncFlow || "").trim(),
      remoteConfirmed: Boolean(current.remoteConfirmed),
      authorizationNumber: String(current.authorizationNumber || "").trim(),
      accessKey: String(current.accessKey || "").trim(),
      creditNotes: Array.isArray(current.creditNotes) ? current.creditNotes.map(note => ({
        id: String(note.id || "").trim(),
        documentNumber: String(note.documentNumber || "").trim(),
        authorizationNumber: String(note.authorizationNumber || "").trim(),
        issueDate: String(note.issueDate || "").trim(),
        reason: String(note.reason || "").trim(),
        accessKey: String(note.accessKey || "").trim(),
        subtotal: round2(note.subtotal ?? note.total ?? 0),
        taxTotal: round2(note.taxTotal || 0),
        total: round2(note.total || 0),
        status: String(note.status || "").trim().toUpperCase(),
        journalEntryId: String(note.journalEntryId || "").trim(),
        journalEntryNumber: String(note.journalEntryNumber || "").trim(),
        postingStatus: String(note.postingStatus || (note.journalEntryId ? "CONTABILIZADO" : "NO_CONTABILIZADO")).trim().toUpperCase(),
        accountingError: String(note.accountingError || "").trim()
      })) : [],
      retentionPlaceholder: round2(current.retentionPlaceholder || 0),
      advancePlaceholder: round2(current.advancePlaceholder || 0),
      createdBy: String(current.createdBy || currentUser().name).trim(),
      createdAt: String(current.createdAt || new Date().toISOString()).trim(),
      updatedBy: String(current.updatedBy || currentUser().name).trim(),
      updatedAt: String(current.updatedAt || current.createdAt || new Date().toISOString()).trim()
    };
  }

  function receivableDocuments() {
    const legacy = cloneList("customerReceivables").map(normalizeReceivable);
    const confirmed = BlessERP.services?.financialV2?.receivables?.() || [];
    const byBusinessKey = new Map();
    legacy.forEach(row => byBusinessKey.set(`${row.customerId}|${row.documentNumber}`, row));
    confirmed.forEach(row => {
      const key = `${row.customerId}|${row.documentNumber}`;
      const legacyRow = byBusinessKey.get(key);
      const confirmedNotes = BlessERP.services?.financialV2?.creditNotes?.()
        .filter(note => String(note.receivableId || "") === String(row.id || row.receivableId || "")) || [];
      const notes = (legacyRow?.creditNotes || row.creditNotes || []).map(note => {
        const canonical = confirmedNotes.find(item =>
          [item.id, item.creditNoteId, item.sourceId, item.documentNumber].map(String)
            .includes(String(note.id || note.documentNumber || ""))
        );
        return canonical ? { ...note, journalEntryId: canonical.journalEntryId, postingStatus: "CONTABILIZADO", accountingError: "" } : note;
      });
      byBusinessKey.set(key, normalizeReceivable({
        ...row,
        creditNotes: notes
      }));
    });
    return Array.from(byBusinessKey.values());
  }

  function normalizedCollectionApplications(rows = [], kind) {
    return rows.flatMap(item =>
      (item.applications || [])
        .filter(application => item.status === "CONFIRMADO")
        .map(application => ({
          collectionId: item.id,
          source: kind,
          collectionNumber: kind === "LOTE" ? item.batchNumber : item.collectionNumber,
          collectionDate: item.collectionDate,
          customerId: item.customerId || application.customerId || "",
          customerName: item.customerName || application.customerName || "",
          customerTaxId: item.customerTaxId || application.customerTaxId || "",
          entryId: item.entryId || "",
          entryNumber: item.entryNumber || "",
          application: clone(application)
        }))
    );
  }

  function collections() {
    const legacy = cloneList("collections").map(normalizeCollection);
    const confirmed = BlessERP.services?.financialV2?.collections?.() || [];
    const byBusinessKey = new Map();
    legacy.forEach(row => byBusinessKey.set(String(row.collectionNumber || row.id), row));
    confirmed.forEach(row => byBusinessKey.set(String(row.collectionNumber || row.id), normalizeCollection(row)));
    return Array.from(byBusinessKey.values());
  }

  function collectionBatches() {
    return cloneList("collectionBatches").map(normalizeCollectionBatch);
  }

  function confirmedApplications() {
    return [
      ...normalizedCollectionApplications(collections(), "COBRO"),
      ...normalizedCollectionApplications(collectionBatches(), "LOTE")
    ];
  }

  function confirmedWithholdingApplications() {
    return cloneList("receivedWithholdings")
      .filter(item => item.status === "APLICADO" && item.relatedReceivableId)
      .map(item => ({
        receivedId: item.id,
        receivableId: item.relatedReceivableId,
        documentNumber: item.documentNumber || "",
        amount: round2(item.totalRetained || 0),
        customerId: item.relatedCustomerId || "",
        appliedAt: item.appliedAt || item.createdAt || ""
      }));
  }

  function receivables(filters = {}) {
    const applied = confirmedApplications();
    const appliedWithholdings = confirmedWithholdingApplications();
    return receivableDocuments()
      .map(document => {
        const locallyCollected = round2(
          applied
            .filter(item => item.application.receivableId === document.id)
            .reduce((sum, item) => sum + Number(item.application.amount || 0), 0)
        );
        const withheld = round2(
          appliedWithholdings
            .filter(item => item.receivableId === document.id)
            .reduce((sum, item) => sum + Number(item.amount || 0), 0)
        );
        const credited = round2((document.creditNotes || [])
          .filter(note => note.status === "AUTORIZADO" && note.postingStatus === "CONTABILIZADO")
          .reduce((sum, note) => sum + Number(note.total || 0), 0));
        const collected = document.syncFlow === "FINANCIAL_V2"
          ? round2(Math.max(0, document.total - Number(document.balance || 0)))
          : locallyCollected;
        const balance = document.syncFlow === "FINANCIAL_V2"
          ? round2(Math.max(0, document.balance || 0))
          : round2(Math.max(0, document.total - collected - withheld - credited));
        const overdueDays = document.dueDate && balance > 0
          ? Math.max(0, Math.floor((new Date(today()) - new Date(document.dueDate)) / (1000 * 60 * 60 * 24)))
          : 0;
        const state = document.status === "ANULADO"
          ? "ANULADO"
          : balance <= 0
            ? "COBRADO"
            : (collected > 0 || withheld > 0 || credited > 0)
              ? "PARCIAL"
              : overdueDays > 0
                ? "VENCIDO"
                : "PENDIENTE";
        return {
          ...document,
          collected,
          withheld,
          credited,
          balance,
          overdueDays,
          status: state
        };
      })
      .filter(document => {
        if (filters.customerId && document.customerId !== filters.customerId) return false;
        if (filters.status && document.status !== filters.status) return false;
        if (filters.documentType && document.documentType !== filters.documentType) return false;
        if (filters.search) {
          const search = String(filters.search || "").toLowerCase();
          const haystack = [
            document.customerName,
            document.customerTaxId,
            document.documentNumber,
            document.concept,
            document.journalEntryNumber
          ].join(" ").toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });
  }

  function findReceivableById(receivableId) {
    return receivableDocuments().find(item => item.id === receivableId);
  }

  function validateReceivable(receivable, { forPost = false } = {}) {
    const candidate = normalizeReceivable(receivable);
    const errors = [];
    const customer = candidate.customerId ? findCustomerById(candidate.customerId) : null;
    const receivableAccount = candidate.receivableAccountCode ? chartService.findByCode(candidate.receivableAccountCode) : null;
    const counterAccount = candidate.counterAccountCode ? chartService.findByCode(candidate.counterAccountCode) : null;
    const taxAccount = candidate.taxAccountCode ? chartService.findByCode(candidate.taxAccountCode) : null;

    if (!candidate.customerId) errors.push("Debe seleccionar un cliente.");
    if (!candidate.issueDate) errors.push("La fecha de emision es obligatoria.");
    if (!candidate.documentNumber) errors.push("El numero de documento es obligatorio.");
    if (!candidate.concept) errors.push("El concepto es obligatorio.");
    if (candidate.total <= 0) errors.push("El documento debe tener valor mayor que cero.");
    if (candidate.subtotal < 0 || candidate.taxTotal < 0) errors.push("El subtotal y los impuestos no pueden ser negativos.");
    if (Math.abs(round2(candidate.subtotal + candidate.taxTotal) - candidate.total) > 0.01) {
      errors.push("El total debe coincidir con subtotal mas impuestos.");
    }
    if (!receivableDocumentTypes.includes(candidate.documentType)) errors.push("El tipo de documento no es valido.");
    if (!candidate.receivableAccountCode) errors.push("Debe seleccionar la cuenta por cobrar.");
    if (customer && customer.status !== "activo") errors.push("El cliente seleccionado esta inactivo.");
    const duplicate = receivableDocuments().find(item =>
      item.id !== candidate.id
      && ((candidate.accessKey && item.accessKey === candidate.accessKey)
        || (item.customerId === candidate.customerId && item.documentNumber === candidate.documentNumber))
    );
    if (duplicate) errors.push("Ya existe un documento de cartera con ese numero para el cliente.");

    if (!receivableAccount) {
      errors.push("La cuenta por cobrar no existe.");
    } else {
      if (receivableAccount.status !== "Activa") errors.push("La cuenta por cobrar esta inactiva.");
      if (!receivableAccount.isMovement) errors.push("La cuenta por cobrar debe ser de movimiento.");
    }

    if (forPost) {
      if (!candidate.counterAccountCode) errors.push("Debe seleccionar la cuenta ingreso / contrapartida para contabilizar.");
      if (candidate.counterAccountCode && !counterAccount) errors.push("La cuenta contrapartida no existe.");
      if (counterAccount && counterAccount.status !== "Activa") errors.push("La cuenta contrapartida esta inactiva.");
      if (counterAccount && !counterAccount.isMovement) errors.push("La cuenta contrapartida debe ser de movimiento.");
      if (candidate.taxTotal > 0 && !candidate.taxAccountCode) errors.push("Debe configurar la cuenta de IVA ventas.");
      if (candidate.taxTotal > 0 && candidate.taxAccountCode && !taxAccount) errors.push("La cuenta de IVA ventas no existe.");
      if (taxAccount && taxAccount.status !== "Activa") errors.push("La cuenta de IVA ventas esta inactiva.");
      if (taxAccount && !taxAccount.isMovement) errors.push("La cuenta de IVA ventas debe ser de movimiento.");
    }

    return { receivable: candidate, errors };
  }

  function buildReceivableJournalEntry(receivable) {
    const receivableAccount = chartService.findByCode(receivable.receivableAccountCode);
    const counterAccount = chartService.findByCode(receivable.counterAccountCode);
    const taxAccount = receivable.taxTotal > 0 ? chartService.findByCode(receivable.taxAccountCode) : null;
    const entry = journalService.emptyEntry();
    entry.accountingDate = receivable.issueDate;
    entry.accountingPeriod = journalService.accountingPeriodForDate?.(entry.accountingDate, entry.accountingPeriod)
      || String(entry.accountingDate || "").slice(0, 7)
      || entry.accountingPeriod;
    entry.concept = `Venta ${receivable.documentNumber} - ${receivable.customerName}`;
    entry.originModule = "Ventas";
    entry.sourceDocument = receivable.documentNumber;
    entry.externalReference = receivable.accessKey || receivable.authorizationNumber || receivable.documentNumber;
    entry.observation = receivable.observation || "";
    entry.lines = [
      {
        id: uid("JLN"),
        accountCode: receivableAccount.code,
        accountName: receivableAccount.name,
        debit: round2(receivable.total),
        credit: 0,
        costCenter: "",
        auxiliary: receivable.customerTaxId || receivable.customerName,
        lineDescription: receivable.concept,
        documentReference: receivable.documentNumber
      },
      {
        id: uid("JLN"),
        accountCode: counterAccount.code,
        accountName: counterAccount.name,
        debit: 0,
        credit: round2(receivable.subtotal),
        costCenter: "",
        auxiliary: "",
        lineDescription: `Contrapartida ${receivable.documentNumber}`,
        documentReference: receivable.documentNumber
      },
      ...(receivable.taxTotal > 0 ? [{
        id: uid("JLN"),
        accountCode: taxAccount.code,
        accountName: taxAccount.name,
        debit: 0,
        credit: round2(receivable.taxTotal),
        costCenter: "",
        auxiliary: "",
        lineDescription: `IVA venta ${receivable.documentNumber}`,
        documentReference: receivable.documentNumber
      }] : [])
    ];
    return entry;
  }

  function saveReceivable(receivable) {
    return BlessERP.services.confirmedOperationalWrite.unavailable("saveReceivable");
  }

  function addDays(value, days) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value || today();
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    date.setUTCDate(date.getUTCDate() + Math.max(0, Number(days || 0)));
    return date.toISOString().slice(0, 10);
  }

  function syncAuthorizedSale(appState, order = {}) {
    if (String(order.sriAuthorizationStatus || "").toUpperCase() !== "AUTORIZADO") {
      return { ok: false, message: "La factura todavia no esta autorizada por el SRI." };
    }
    const commercialCustomer = BlessERP.comercialUtils?.findCustomer?.(order.customerId) || {};
    const taxId = String(commercialCustomer.identification || "").trim();
    let customer = taxId ? findCustomerByTaxId(taxId) : null;
    if (!customer) {
      const savedCustomer = saveCustomer({
        taxId,
        name: commercialCustomer.legalName || commercialCustomer.commercialName || "Cliente SRI",
        commercialName: commercialCustomer.commercialName || commercialCustomer.legalName || "",
        customerType: String(commercialCustomer.category || "").toUpperCase() === "LOCAL" ? "local" : "exterior",
        country: commercialCustomer.country || "Ecuador",
        city: commercialCustomer.city || "",
        address: commercialCustomer.address || "",
        phone: commercialCustomer.mobilePhone || commercialCustomer.fixedPhone || "",
        email: commercialCustomer.billingEmail || commercialCustomer.contactEmail || "",
        creditDays: Number(commercialCustomer.creditDays || 0),
        creditLimit: Number(commercialCustomer.creditAmount || 0),
        status: "activo",
        observation: `Creado automaticamente desde factura SRI autorizada ${order.sriInvoiceNumber || order.number || ""}.`
      });
      if (!savedCustomer.ok) return { ok: false, message: savedCustomer.errors?.join(" ") || "No se pudo crear el cliente de cartera." };
      customer = savedCustomer.customer;
    }

    const metrics = BlessERP.comercialUtils?.getOrderMetrics?.(order) || {};
    const documentNumber = String(order.sriInvoiceNumber || order.number || "").trim();
    const existing = receivableDocuments().find(item =>
      (order.id && item.sourceOrderId === order.id)
      || (item.customerId === customer.id && item.documentNumber === documentNumber)
    );
    const issueDate = String(order.sriIssueDate || order.issuedAt || today()).slice(0, 10);
    const localSale = Boolean(BlessERP.comercialUtils?.isLocalOrder?.(order));
    const defaultAccounts = companyService.settings().defaultAccounts || {};
    const receivableAccountCode = localSale
      ? (defaultAccounts.accountsReceivableCustomersLocal || defaultAccounts.accountsReceivableCustomers)
      : (defaultAccounts.accountsReceivableCustomersExport || defaultAccounts.accountsReceivableCustomers);
    const grandTotal = round2(Number(order.sriGrandTotal || 0) > 0 ? order.sriGrandTotal : metrics.totalUsd);
    const taxTotal = round2(order.sriTaxTotal || 0);
    const subtotal = round2(Number(order.sriSubtotal || 0) > 0 ? order.sriSubtotal : Math.max(0, grandTotal - taxTotal));
    if (existing?.syncFlow === "FINANCIAL_V2") {
      order.receivableId = existing.id;
      order.receivableSyncStatus = "SINCRONIZADO";
      order.saleAccountingStatus = "CONTABILIZADO";
      order.saleJournalEntryId = existing.journalEntryId || "";
      order.saleJournalEntryNumber = existing.journalEntryNumber || "";
      return { ok: true, accountingOk: true, receivable: clone(existing), reused: true, errors: [] };
    }
    const candidate = {
      ...(existing || emptyReceivable(customer.id)),
      customerId: customer.id,
      customerName: customer.name,
      customerTaxId: customer.taxId,
      customerCountry: customer.country,
      documentType: "factura sri",
      documentNumber,
      issueDate,
      dueDate: String(order.expireDate || "").slice(0, 10) || addDays(issueDate, customer.creditDays),
      concept: `Factura SRI autorizada ${documentNumber}`,
      marketType: localSale ? "LOCAL" : "EXPORTACION",
      subtotal,
      taxTotal,
      total: grandTotal,
      receivableAccountCode,
      counterAccountCode: localSale ? defaultAccounts.localSales : defaultAccounts.exportSales,
      taxAccountCode: taxTotal > 0 ? defaultAccounts.vatSales : "",
      observation: `Generada automaticamente desde el pedido ${order.number || order.id}.`,
      status: "PENDIENTE",
      source: "SRI_AUTORIZADO",
      sourceOrderId: String(order.id || ""),
      sourceDocumentId: String(order.sriRemoteDocumentId || ""),
      authorizationNumber: String(order.sriAuthorizationNumber || ""),
      accessKey: String(order.sriAccessKey || ""),
      creditNotes: existing?.creditNotes || []
    };
    const result = saveReceivable(candidate);
    if (result.ok) {
      order.receivableId = result.receivable.id;
      order.receivableSyncStatus = "SINCRONIZADO";
      order.receivableSyncedAt = new Date().toISOString();
      // La autorización SRI únicamente prepara la factura para contabilización.
      // El asiento y la CxC se crean después mediante el comando transaccional V2;
      // Realtime jamás dispara contabilidad.
      const accounting = { ok: false, pending: true, message: "Pendiente de contabilización confirmada en Supabase." };
      order.saleAccountingStatus = "PENDIENTE";
      order.saleAccountingError = "";
      order.saleJournalEntryId = "";
      order.saleJournalEntryNumber = "";
      return {
        ...result,
        accountingOk: false,
        accountingPending: true,
        accounting,
        errors: []
      };
    } else {
      order.receivableSyncStatus = "ERROR";
      order.receivableSyncError = result.errors?.join(" ") || "No se pudo sincronizar la cuenta por cobrar.";
    }
    return result;
  }

  function findPostedSalesEntry({ documentNumber = "", accessKey = "", authorizationNumber = "" } = {}) {
    if (typeof journalService?.all !== "function") return null;
    const references = [accessKey, authorizationNumber, documentNumber].filter(Boolean);
    return journalService.all().find(entry =>
      entry.originModule === "Ventas"
      && entry.status === "CONTABILIZADO"
      && (references.includes(entry.externalReference) || entry.sourceDocument === documentNumber)
    ) || null;
  }

  function buildCreditNoteJournalEntry(receivable, note) {
    const receivableAccount = chartService.findByCode(receivable.receivableAccountCode);
    const revenueAccount = chartService.findByCode(receivable.counterAccountCode);
    const taxAccount = note.taxTotal > 0 ? chartService.findByCode(receivable.taxAccountCode) : null;
    const entry = journalService.emptyEntry();
    entry.accountingDate = note.issueDate || receivable.issueDate;
    entry.accountingPeriod = journalService.accountingPeriodForDate?.(entry.accountingDate, entry.accountingPeriod)
      || String(entry.accountingDate || "").slice(0, 7)
      || entry.accountingPeriod;
    entry.concept = `Nota de credito ${note.documentNumber} - ${receivable.customerName}`;
    entry.originModule = "Ventas";
    entry.sourceDocument = note.documentNumber;
    entry.externalReference = note.accessKey || note.authorizationNumber || note.documentNumber;
    entry.observation = note.reason || "Nota de credito autorizada por el SRI.";
    entry.lines = [
      {
        id: uid("JLN"),
        accountCode: revenueAccount.code,
        accountName: revenueAccount.name,
        debit: round2(note.subtotal),
        credit: 0,
        costCenter: "",
        auxiliary: "",
        lineDescription: `Reverso de venta ${receivable.documentNumber}`,
        documentReference: note.documentNumber
      },
      ...(note.taxTotal > 0 ? [{
        id: uid("JLN"),
        accountCode: taxAccount.code,
        accountName: taxAccount.name,
        debit: round2(note.taxTotal),
        credit: 0,
        costCenter: "",
        auxiliary: "",
        lineDescription: `Reverso IVA venta ${receivable.documentNumber}`,
        documentReference: note.documentNumber
      }] : []),
      {
        id: uid("JLN"),
        accountCode: receivableAccount.code,
        accountName: receivableAccount.name,
        debit: 0,
        credit: round2(note.total),
        costCenter: "",
        auxiliary: receivable.customerTaxId || receivable.customerName,
        lineDescription: `Disminucion CxC ${receivable.documentNumber}`,
        documentReference: note.documentNumber
      }
    ];
    return entry;
  }

  function postCreditNote(receivableId, noteId) {
    const rows = receivableDocuments();
    const index = rows.findIndex(item => item.id === receivableId);
    if (index < 0) return { ok: false, errors: ["No existe la cuenta por cobrar de la factura original."] };
    const candidate = normalizeReceivable(rows[index]);
    const noteIndex = candidate.creditNotes.findIndex(item => item.id === noteId);
    if (noteIndex < 0) return { ok: false, errors: ["No se encontro la nota de credito autorizada."] };
    const note = candidate.creditNotes[noteIndex];
    if (note.journalEntryId) {
      const linked = journalService.all?.()?.find(entry => entry.id === note.journalEntryId && entry.status === "CONTABILIZADO");
      if (linked) return { ok: true, receivable: clone(candidate), note: clone(note), entry: clone(linked), reused: true };
    }
    const existing = findPostedSalesEntry(note);
    if (existing) {
      note.journalEntryId = existing.id;
      note.journalEntryNumber = existing.entryNumber;
      note.postingStatus = "CONTABILIZADO";
      note.accountingError = "";
      rows[index] = candidate;
      saveList("customerReceivables", rows);
      return { ok: true, receivable: clone(candidate), note: clone(note), entry: clone(existing), reused: true };
    }
    if (!candidate.journalEntryId) {
      note.postingStatus = "ERROR";
      note.accountingError = "La factura original debe estar contabilizada antes de la nota de credito.";
      rows[index] = candidate;
      saveList("customerReceivables", rows);
      return { ok: false, errors: [note.accountingError], receivable: clone(candidate), note: clone(note) };
    }
    const accountErrors = validateReceivable(candidate, { forPost: true }).errors.filter(error => !/numero para el cliente/i.test(error));
    if (accountErrors.length) return { ok: false, errors: accountErrors };
    const entryDraft = buildCreditNoteJournalEntry(candidate, note);
    const entryValidation = journalService.validateEntry(entryDraft);
    if (entryValidation.errors.length) return { ok: false, errors: entryValidation.errors };
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento de la nota de credito."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) {
      journalService.deleteDraft(savedEntry.entry.id);
      return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar la nota de credito."] };
    }
    note.journalEntryId = postedEntry.entry.id;
    note.journalEntryNumber = postedEntry.entry.entryNumber;
    note.postingStatus = "CONTABILIZADO";
    note.accountingError = "";
    rows[index] = candidate;
    saveList("customerReceivables", rows);
    return { ok: true, receivable: clone(candidate), note: clone(note), entry: clone(postedEntry.entry) };
  }

  function applyAuthorizedCreditNote(order = {}, note = {}) {
    if (String(note.status || "").toUpperCase() !== "AUTORIZADO") {
      return { ok: false, message: "La nota de credito todavia no esta autorizada." };
    }
    const rows = receivableDocuments();
    const index = rows.findIndex(item =>
      (order.receivableId && item.id === order.receivableId)
      || (order.id && item.sourceOrderId === order.id)
      || (item.documentNumber && item.documentNumber === order.sriInvoiceNumber)
    );
    if (index < 0) return { ok: false, message: "No existe la cuenta por cobrar de la factura original." };
    const noteId = String(note.remoteDocumentId || note.id || note.authorizationNumber || note.documentNumber || "").trim();
    const currentNotes = rows[index].creditNotes || [];
    const priorNote = currentNotes.find(item => item.id === noteId) || {};
    const total = round2(note.total || note.modificationValue || 0);
    const taxTotal = round2(note.taxTotal || 0);
    const normalizedNote = {
      ...priorNote,
      id: noteId,
      documentNumber: note.documentNumber || "",
      authorizationNumber: note.authorizationNumber || "",
      issueDate: note.issueDate || "",
      reason: note.reason || "",
      accessKey: note.accessKey || "",
      subtotal: round2(Number(note.subtotal || 0) > 0 ? note.subtotal : Math.max(0, total - taxTotal)),
      taxTotal,
      total,
      status: "AUTORIZADO"
    };
    const noteIndex = currentNotes.findIndex(item => item.id === noteId);
    if (noteIndex >= 0) currentNotes[noteIndex] = normalizedNote;
    else currentNotes.push(normalizedNote);
    rows[index].creditNotes = currentNotes;
    saveList("customerReceivables", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: noteIndex >= 0 ? "ACTUALIZAR_NOTA_CREDITO_CXC" : "APLICAR_NOTA_CREDITO_CXC",
      entityType: "receivable",
      entityId: rows[index].id,
      entityLabel: rows[index].documentNumber,
      documentLabel: normalizedNote.documentNumber,
      description: `Nota de credito ${normalizedNote.documentNumber || noteId} aplicada a la cuenta por cobrar ${rows[index].documentNumber}.`,
      after: normalizedNote,
      result: "exitoso"
    });
    return {
      ok: true,
      accountingOk: false,
      accountingPending: true,
      accounting: { ok: false, pending: true, message: "Nota de crédito pendiente de contabilización confirmada en Supabase." },
      receivable: receivables().find(item => item.id === rows[index].id),
      note: normalizedNote
    };
  }

  async function postCreditNoteV2(receivableId, noteId, options = {}) {
    const receivable = findReceivableById(receivableId);
    if (!receivable) return { ok: false, errors: ["No existe la cuenta por cobrar de la factura original."] };
    const note = (receivable.creditNotes || []).find(item => item.id === noteId);
    if (!note) return { ok: false, errors: ["No se encontró la nota de crédito autorizada."] };
    const result = await BlessERP.services?.financialV2?.postCreditNote?.(receivable, note, options);
    if (!result) return { ok: false, errors: ["Servicio financiero V2 no disponible."] };
    return result.ok ? result : { ...result, errors: result.errors || [result.message || "Supabase no confirmó la nota de crédito."] };
  }

  function postReceivable(receivableId) {
    const rows = receivableDocuments();
    const index = rows.findIndex(item => item.id === receivableId);
    if (index < 0) return { ok: false, errors: ["Documento de cartera no encontrado."] };
    if (rows[index].journalEntryId) {
      const linked = journalService.all?.()?.find(entry => entry.id === rows[index].journalEntryId && entry.status === "CONTABILIZADO");
      if (linked) {
        (rows[index].creditNotes || [])
          .filter(note => note.status === "AUTORIZADO" && !note.journalEntryId)
          .forEach(note => postCreditNote(rows[index].id, note.id));
        return { ok: true, receivable: findReceivableById(rows[index].id), entry: clone(linked), reused: true };
      }
    }
    const { receivable: candidate, errors } = validateReceivable(rows[index], { forPost: true });
    if (errors.length) {
      candidate.postingStatus = "ERROR";
      candidate.accountingError = errors.join(" ");
      rows[index] = candidate;
      saveList("customerReceivables", rows);
      return { ok: false, errors };
    }
    const existing = findPostedSalesEntry(candidate);
    if (existing) {
      candidate.journalEntryId = existing.id;
      candidate.journalEntryNumber = existing.entryNumber;
      candidate.postingStatus = "CONTABILIZADO";
      candidate.accountingError = "";
      rows[index] = candidate;
      saveList("customerReceivables", rows);
      return { ok: true, receivable: clone(candidate), entry: clone(existing), reused: true };
    }
    const entryDraft = buildReceivableJournalEntry(candidate);
    const entryValidation = journalService.validateEntry(entryDraft);
    if (entryValidation.errors.length) {
      candidate.postingStatus = "ERROR";
      candidate.accountingError = entryValidation.errors.join(" ");
      rows[index] = candidate;
      saveList("customerReceivables", rows);
      return { ok: false, errors: entryValidation.errors };
    }
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento del documento."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) {
      journalService.deleteDraft(savedEntry.entry.id);
      candidate.postingStatus = "ERROR";
      candidate.accountingError = (postedEntry.errors || ["No se pudo contabilizar el documento."]).join(" ");
      rows[index] = candidate;
      saveList("customerReceivables", rows);
      return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el documento."] };
    }
    candidate.journalEntryId = postedEntry.entry.id;
    candidate.journalEntryNumber = postedEntry.entry.entryNumber;
    candidate.postingStatus = "CONTABILIZADO";
    candidate.accountingError = "";
    rows[index] = candidate;
    saveList("customerReceivables", rows);
    adminService?.addAuditLog?.({
      module: "VENTAS",
      action: "CONTABILIZAR_VENTA",
      entityType: "receivable",
      entityId: candidate.id,
      entityLabel: candidate.documentNumber,
      documentLabel: candidate.documentNumber,
      previousStatus: "PENDIENTE",
      nextStatus: candidate.postingStatus,
      description: `Documento ${candidate.documentNumber} contabilizado con asiento ${candidate.journalEntryNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    candidate.creditNotes
      .filter(note => note.status === "AUTORIZADO" && !note.journalEntryId)
      .forEach(note => postCreditNote(candidate.id, note.id));
    return { ok: true, receivable: clone(candidate), entry: clone(postedEntry.entry) };
  }

  async function postReceivableV2(receivableInput, options = {}) {
    const candidate = receivableInput && typeof receivableInput === "object"
      ? normalizeReceivable(receivableInput)
      : findReceivableById(receivableInput);
    if (!candidate) return { ok: false, errors: ["Documento de cartera no encontrado."] };
    const canonical = BlessERP.services?.financialV2?.financialReceivableForLegacy?.(candidate);
    if (canonical?.journalEntryId) {
      const entry = BlessERP.services?.financialV2?.journalEntries?.().find(item => item.id === canonical.journalEntryId);
      return { ok: true, confirmed: true, reused: true, receivable: canonical, entry };
    }
    const validation = validateReceivable(candidate, { forPost: true });
    if (validation.errors.length) return { ok: false, errors: validation.errors };
    const result = await BlessERP.services?.financialV2?.postInvoice?.(validation.receivable, options);
    if (!result) return { ok: false, errors: ["Servicio financiero V2 no disponible."] };
    return result.ok ? result : { ...result, errors: result.errors || [result.message || "Supabase no confirmó la venta."] };
  }

  function annulReceivable(receivableId) {
    const rows = receivableDocuments();
    const index = rows.findIndex(item => item.id === receivableId);
    if (index < 0) return { ok: false, message: "Documento de cartera no encontrado." };
    const target = rows[index];
    if (target.status === "ANULADO") return { ok: false, message: "El documento ya esta anulado." };
    const appliedAmount = confirmedApplications()
      .filter(item => item.application.receivableId === receivableId)
      .reduce((sum, item) => sum + Number(item.application.amount || 0), 0);
    if (appliedAmount > 0) return { ok: false, message: "No se puede anular un documento con cobros aplicados." };
    if (target.journalEntryId) {
      const reversed = journalService.reverseEntry(target.journalEntryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el asiento del documento." };
      target.reverseEntryId = reversed.entry.id;
      target.reverseEntryNumber = reversed.entry.entryNumber;
    }
    target.status = "ANULADO";
    rows[index] = normalizeReceivable(target);
    saveList("customerReceivables", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: "ANULAR_CXC",
      entityType: "receivable",
      entityId: target.id,
      entityLabel: target.documentNumber,
      documentLabel: target.documentNumber,
      previousStatus: "PENDIENTE",
      nextStatus: target.status,
      description: `Documento ${target.documentNumber} anulado.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, receivable: clone(rows[index]) };
  }

  function customerPortfolioSummary(customerId) {
    const customer = findCustomerById(customerId);
    if (!customer) return null;
    const docs = receivables({ customerId });
    const periodPrefix = companyService.settings().activePeriod || "";
    const confirmedCollections = collections()
      .filter(item => item.status === "CONFIRMADO" && item.customerId === customerId && item.collectionDate.startsWith(periodPrefix));
    const confirmedBatches = collectionBatches()
      .filter(item => item.status === "CONFIRMADO" && item.applications?.some(app => app.customerId === customerId) && item.collectionDate.startsWith(periodPrefix));
    const totalCollectedPeriod = round2(
      confirmedCollections.reduce((sum, item) => sum + Number(item.total || 0), 0)
      + confirmedBatches.reduce((sum, item) => sum + Number(item.applications.filter(app => app.customerId === customerId).reduce((acc, app) => acc + Number(app.amount || 0), 0)), 0)
    );
    const pendingWithholdings = round2(
      docs.reduce((sum, item) => sum + Number(item.withheld || 0), 0)
    );
    const latestCollection = [...confirmedCollections, ...confirmedBatches]
      .sort((a, b) => `${b.collectionDate}|${b.createdAt || ""}`.localeCompare(`${a.collectionDate}|${a.createdAt || ""}`, "es"))[0] || null;
    return {
      customer,
      totalPending: round2(docs.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.status)).reduce((sum, item) => sum + item.balance, 0)),
      totalOverdue: round2(docs.filter(item => item.status === "VENCIDO").reduce((sum, item) => sum + item.balance, 0)),
      totalUpcoming: round2(docs.filter(item => ["PENDIENTE", "PARCIAL"].includes(item.status) && item.overdueDays === 0).reduce((sum, item) => sum + item.balance, 0)),
      totalCollectedPeriod,
      pendingWithholdings,
      availableAdvances: 0,
      latestCollection,
      openDocuments: docs.filter(item => !["COBRADO", "ANULADO"].includes(item.status)).length,
      documents: docs
    };
  }

  function pendingReceivablesByCustomer(customerId) {
    return receivables({ customerId }).filter(item => !["COBRADO", "ANULADO"].includes(item.status));
  }

  function activeCollectionAccountOptions() {
    const options = chartService.movementOptions();
    const direct = options.filter(item => item.type === "Activo" && String(item.code || "").startsWith("1.1.01"));
    return direct.length ? direct : options.filter(item => item.type === "Activo");
  }

  function emptyCollection(customerId = "") {
    const remote = BlessERP.getEnvConfig?.()?.financialV2CaptureEnabled === true;
    return {
      id: uid("DRAFT"),
      collectionNumber: remote ? "Se asigna al confirmar" : nextCollectionNumber(),
      customerId,
      customerName: "",
      customerTaxId: "",
      collectionDate: today(),
      collectionMethod: "transferencia",
      collectionAccountCode: "",
      collectionAccountName: "",
      bankAccountId: "",
      reference: "",
      observation: "",
      status: "BORRADOR",
      entryId: "",
      entryNumber: "",
      applications: [],
      total: 0,
      createdBy: currentUser().name,
      createdAt: new Date().toISOString()
    };
  }

  function emptyCollectionBatch() {
    return {
      id: uid("DRAFT"),
      batchNumber: nextCollectionBatchNumber(),
      collectionDate: today(),
      collectionAccountCode: "",
      collectionAccountName: "",
      bankAccountId: "",
      reference: "",
      observation: "",
      status: "BORRADOR",
      entryId: "",
      entryNumber: "",
      totalDocuments: 0,
      totalToCollect: 0,
      createdBy: currentUser().name,
      createdAt: new Date().toISOString(),
      applications: []
    };
  }

  function normalizeCollection(collection = {}) {
    const current = {
      ...emptyCollection(collection.customerId || ""),
      ...clone(collection || {})
    };
    const customer = current.customerId ? findCustomerById(current.customerId) : findCustomerByTaxId(current.customerTaxId);
    const selectedBank = current.bankAccountId ? bankService()?.findBankAccountById(current.bankAccountId) : null;
    const resolvedAccountCode = String(current.collectionAccountCode || selectedBank?.linkedAccountCode || "").trim();
    const resolvedAccount = resolvedAccountCode ? chartService.findByCode(resolvedAccountCode) : null;
    const requestedMethod = String(collection.collectionMethod || collection.paymentMethod || collection.paymentForm || current.collectionMethod || "transferencia").trim().toLowerCase();
    return {
      id: current.id || uid("COL"),
      collectionNumber: String(current.collectionNumber || (BlessERP.getEnvConfig?.()?.financialV2CaptureEnabled === true ? "Se asigna al confirmar" : nextCollectionNumber())).trim(),
      customerId: String(customer?.id || current.customerId || "").trim(),
      customerName: String(customer?.name || current.customerName || "").trim(),
      customerTaxId: String(customer?.taxId || current.customerTaxId || "").trim(),
      collectionDate: String(current.collectionDate || today()).trim(),
      collectionMethod: collectionMethods.includes(requestedMethod) ? requestedMethod : "transferencia",
      collectionAccountCode: resolvedAccountCode,
      collectionAccountName: String(resolvedAccount?.name || current.collectionAccountName || "").trim(),
      bankAccountId: String(current.bankAccountId || "").trim(),
      reference: String(current.reference || "").trim(),
      observation: String(current.observation || "").trim(),
      status: collectionStates.includes(String(current.status || "").toUpperCase()) ? String(current.status || "").toUpperCase() : "BORRADOR",
      entryId: String(current.entryId || "").trim(),
      entryNumber: String(current.entryNumber || "").trim(),
      journalEntryId: String(current.journalEntryId || current.entryId || "").trim(),
      syncFlow: String(current.syncFlow || "").trim(),
      remoteConfirmed: Boolean(current.remoteConfirmed),
      applications: (current.applications || []).map(application => {
        const hasReadModelSnapshot = Boolean(application.documentNumber && application.originalBalance !== undefined);
        const receivable = !hasReadModelSnapshot && application.receivableId ? findReceivableById(application.receivableId) : null;
        return {
          receivableId: String(application.receivableId || "").trim(),
          source: String(application.source || receivable?.source || "").trim().toUpperCase(),
          sourceId: String(application.sourceId || receivable?.sourceId || "").trim(),
          status: String(application.status || receivable?.status || "").trim().toUpperCase(),
          canonicalStatus: String(application.canonicalStatus || application.canonical_status || receivable?.canonicalStatus || "").trim().toUpperCase(),
          companyId: String(application.companyId || application.company_id || receivable?.companyId || "").trim(),
          customerId: String(application.customerId || current.customerId || receivable?.customerId || "").trim(),
          customerName: String(application.customerName || current.customerName || receivable?.customerName || "").trim(),
          customerTaxId: String(application.customerTaxId || current.customerTaxId || receivable?.customerTaxId || "").trim(),
          documentNumber: String(application.documentNumber || receivable?.documentNumber || "").trim(),
          concept: String(application.concept || receivable?.concept || "").trim(),
          issueDate: String(application.issueDate || receivable?.issueDate || "").trim(),
          dueDate: String(application.dueDate || receivable?.dueDate || "").trim(),
          originalBalance: round2(application.originalBalance || receivable?.balance || receivable?.total || 0),
          retentionApplied: round2(application.retentionApplied || 0),
          advanceApplied: round2(application.advanceApplied || 0),
          amount: round2(application.amount || 0),
          resultingBalance: round2(application.resultingBalance || 0),
          receivableAccountCode: String(application.receivableAccountCode || receivable?.receivableAccountCode || companyService.settings().defaultAccounts?.accountsReceivableCustomers || "").trim()
        };
      }),
      total: round2((current.applications || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)),
      createdBy: String(current.createdBy || currentUser().name).trim(),
      createdAt: String(current.createdAt || new Date().toISOString()).trim()
    };
  }

  function normalizeCollectionBatch(batch = {}) {
    const current = {
      ...emptyCollectionBatch(),
      ...clone(batch || {})
    };
    const selectedBank = current.bankAccountId ? bankService()?.findBankAccountById(current.bankAccountId) : null;
    const resolvedAccountCode = String(current.collectionAccountCode || selectedBank?.linkedAccountCode || "").trim();
    const resolvedAccount = resolvedAccountCode ? chartService.findByCode(resolvedAccountCode) : null;
    const applications = (current.applications || []).map(application => {
      const receivable = application.receivableId ? findReceivableById(application.receivableId) : null;
      return {
        receivableId: String(application.receivableId || "").trim(),
        customerId: String(application.customerId || receivable?.customerId || "").trim(),
        customerName: String(application.customerName || receivable?.customerName || "").trim(),
        customerTaxId: String(application.customerTaxId || receivable?.customerTaxId || "").trim(),
        documentNumber: String(application.documentNumber || receivable?.documentNumber || "").trim(),
        originalBalance: round2(application.originalBalance || receivable?.balance || receivable?.total || 0),
        retentionApplied: round2(application.retentionApplied || 0),
        advanceApplied: round2(application.advanceApplied || 0),
        amount: round2(application.amount || 0),
        resultingBalance: round2(application.resultingBalance || 0),
        receivableAccountCode: String(application.receivableAccountCode || receivable?.receivableAccountCode || companyService.settings().defaultAccounts?.accountsReceivableCustomers || "").trim()
      };
    });
    return {
      id: current.id || uid("LCB"),
      batchNumber: String(current.batchNumber || nextCollectionBatchNumber()).trim(),
      collectionDate: String(current.collectionDate || today()).trim(),
      collectionAccountCode: resolvedAccountCode,
      collectionAccountName: String(resolvedAccount?.name || current.collectionAccountName || "").trim(),
      bankAccountId: String(current.bankAccountId || "").trim(),
      reference: String(current.reference || "").trim(),
      observation: String(current.observation || "").trim(),
      status: collectionBatchStates.includes(String(current.status || "").toUpperCase()) ? String(current.status || "").toUpperCase() : "BORRADOR",
      entryId: String(current.entryId || "").trim(),
      entryNumber: String(current.entryNumber || "").trim(),
      totalDocuments: applications.filter(item => Number(item.amount || 0) > 0).length,
      totalToCollect: round2(applications.reduce((sum, item) => sum + Number(item.amount || 0), 0)),
      createdBy: String(current.createdBy || currentUser().name).trim(),
      createdAt: String(current.createdAt || new Date().toISOString()).trim(),
      applications
    };
  }

  function activeCompanyIds() {
    return new Set([
      activeCompanyUuid(),
      BlessERP.services?.companyContext?.activeCompanyId?.(),
      stateApi.state.db?.activeCompanyId
    ].map(value => String(value || "").trim()).filter(Boolean));
  }

  function canonicalCollectionReceivable(receivableId) {
    const id = String(receivableId || "").trim();
    if (!id) return null;
    const portfolioRow = BlessERP.services?.portfolioReadV2?.row?.("ar", id);
    if (portfolioRow) return clone(portfolioRow);
    const lookup = BlessERP.services?.paymentCollectionReadV2?.snapshot?.()?.collection?.lookup;
    const lookupRow = (lookup?.items || []).find(item => String(item.id || "") === id);
    if (lookupRow) return clone(lookupRow);
    const financialRow = (BlessERP.services?.financialV2?.receivables?.() || [])
      .find(item => String(item.id || item.receivableId || "") === id);
    if (financialRow) return clone(financialRow);
    if (BlessERP.getEnvConfig?.()?.financialV2CaptureEnabled !== true) {
      return receivables().find(item => String(item.id || "") === id) || null;
    }
    return null;
  }

  function validateCollectionApplications(applications = [], customerId = "") {
    const errors = [];
    applications.forEach((application, index) => {
      const row = index + 1;
      const receivableId = String(application.receivableId || "").trim();
      if (!receivableId) {
        errors.push(`El documento ${row} no tiene una CxC canónica.`);
        return;
      }
      const receivable = canonicalCollectionReceivable(receivableId);
      if (!receivable) {
        errors.push(`El documento ${row} ya no existe en cartera.`);
        return;
      }
      const documentNumber = receivable.documentNumber || application.documentNumber || row;
      const receivableCompanyId = String(receivable.companyId || receivable.company_id || application.companyId || "");
      const companyIds = activeCompanyIds();
      if (receivableCompanyId && companyIds.size && !companyIds.has(receivableCompanyId)) {
        errors.push(`El documento ${documentNumber} pertenece a otra empresa.`);
      }
      const receivableCustomerId = String(receivable.customerId || receivable.customer_id || application.customerId || "");
      if (customerId && receivableCustomerId && receivableCustomerId !== String(customerId)) {
        errors.push(`El documento ${documentNumber} pertenece a otro cliente.`);
      }
      const status = String(receivable.status || application.status || "").toUpperCase();
      const canonicalStatus = String(receivable.canonicalStatus || receivable.canonical_status || application.canonicalStatus || "").toUpperCase();
      const invalidStatus = status && !["OPEN", "PARTIALLY_PAID", "PENDIENTE", "PARCIAL", "VENCIDO"].includes(status);
      const invalidCanonicalStatus = canonicalStatus && !["OPEN", "PARTIALLY_PAID"].includes(canonicalStatus);
      if (invalidStatus || invalidCanonicalStatus) {
        errors.push(`El documento ${documentNumber} ya no puede cobrarse.`);
      }
      if (Number(receivable.balance || 0) <= 0) {
        errors.push(`El documento ${documentNumber} no tiene saldo pendiente.`);
      }
      if (Number(application.amount || 0) < 0) {
        errors.push(`El valor aplicado al documento ${documentNumber} no puede ser negativo.`);
      }
      if (Number(application.amount || 0) > Number(receivable.balance || 0)) {
        errors.push(`El valor aplicado al documento ${documentNumber} excede su saldo disponible.`);
      }
    });
    return errors;
  }

  function validateCollection(collection, { forConfirm = false } = {}) {
    const candidate = normalizeCollection(collection);
    const errors = [];
    const collectionAccount = candidate.collectionAccountCode ? chartService.findByCode(candidate.collectionAccountCode) : null;
    const bankAccount = candidate.bankAccountId ? bankService()?.findBankAccountById(candidate.bankAccountId) : null;
    const customer = candidate.customerId ? findCustomerById(candidate.customerId) : null;
    if (!candidate.customerId) errors.push("Debe seleccionar un cliente.");
    if (candidate.customerId && !customer) errors.push("El cliente canónico no está disponible en la empresa activa.");
    if (customer?.companyId && !activeCompanyIds().has(customer.companyId)) errors.push("El cliente pertenece a otra empresa.");
    if (customer && String(customer.status || "activo").toLowerCase() !== "activo") errors.push("El cliente seleccionado está inactivo.");
    if (!candidate.collectionDate) errors.push("La fecha de cobro es obligatoria.");
    if (forConfirm && !candidate.collectionAccountCode) errors.push("Debe seleccionar la cuenta contable de cobro.");
    errors.push(...validateCollectionApplications(candidate.applications, candidate.customerId));
    if (!candidate.applications.some(item => Number(item.amount || 0) > 0)) errors.push("Debe aplicar valor a por lo menos un documento.");
    if (forConfirm && candidate.total <= 0) errors.push("El cobro no puede ser cero.");
    if (forConfirm && candidate.collectionAccountCode && !collectionAccount) errors.push("La cuenta de cobro no existe.");
    if (forConfirm && collectionAccount && collectionAccount.status !== "Activa") errors.push("La cuenta de cobro esta inactiva.");
    if (forConfirm && collectionAccount && !collectionAccount.isMovement) errors.push("La cuenta de cobro debe ser de movimiento.");
    if (forConfirm && candidate.bankAccountId && !bankAccount) errors.push("La cuenta bancaria/caja seleccionada no existe.");
    if (forConfirm && bankAccount && bankAccount.status !== "activa") errors.push("La cuenta bancaria/caja seleccionada esta inactiva.");
    return { collection: candidate, errors };
  }

  function validateCollectionDraft(collection, options = {}) {
    const result = validateCollection(collection, options);
    return { ok: result.errors.length === 0, ...result };
  }

  function validateCollectionBatch(batch, { forConfirm = false } = {}) {
    const candidate = normalizeCollectionBatch(batch);
    const errors = [];
    const collectionAccount = candidate.collectionAccountCode ? chartService.findByCode(candidate.collectionAccountCode) : null;
    const bankAccount = candidate.bankAccountId ? bankService()?.findBankAccountById(candidate.bankAccountId) : null;
    if (!candidate.collectionDate) errors.push("La fecha del lote es obligatoria.");
    if (forConfirm && !candidate.collectionAccountCode) errors.push("Debe seleccionar la cuenta de cobro del lote.");
    errors.push(...validateCollectionApplications(candidate.applications));
    if (!candidate.applications.some(item => Number(item.amount || 0) > 0)) errors.push("Debe seleccionar documentos con valores a cobrar.");
    if (forConfirm && candidate.totalToCollect <= 0) errors.push("El lote no puede confirmarse con valor cero.");
    if (forConfirm && candidate.collectionAccountCode && !collectionAccount) errors.push("La cuenta de cobro del lote no existe.");
    if (forConfirm && collectionAccount && collectionAccount.status !== "Activa") errors.push("La cuenta de cobro del lote esta inactiva.");
    if (forConfirm && collectionAccount && !collectionAccount.isMovement) errors.push("La cuenta de cobro del lote debe ser de movimiento.");
    if (forConfirm && candidate.bankAccountId && !bankAccount) errors.push("La cuenta bancaria/caja del lote no existe.");
    if (forConfirm && bankAccount && bankAccount.status !== "activa") errors.push("La cuenta bancaria/caja del lote esta inactiva.");
    return { batch: candidate, errors };
  }

  function buildCollectionJournalEntry(collection, label = "") {
    const debitAccount = chartService.findByCode(collection.collectionAccountCode);
    const entry = journalService.emptyEntry();
    entry.accountingDate = collection.collectionDate;
    entry.accountingPeriod = journalService.accountingPeriodForDate?.(entry.accountingDate, entry.accountingPeriod)
      || String(entry.accountingDate || "").slice(0, 7)
      || entry.accountingPeriod;
    entry.concept = label || `Cobro a cliente ${collection.customerName || "varios clientes"}`;
    entry.originModule = "Cobros";
    entry.sourceDocument = collection.collectionNumber || collection.batchNumber || "";
    entry.externalReference = collection.reference || "";
    entry.observation = collection.observation || "";
    entry.lines = [
      {
        id: uid("JLN"),
        accountCode: debitAccount.code,
        accountName: debitAccount.name,
        debit: round2(collection.total || collection.totalToCollect || 0),
        credit: 0,
        costCenter: "",
        auxiliary: "",
        lineDescription: label || entry.concept,
        documentReference: collection.reference || collection.collectionNumber || collection.batchNumber || ""
      }
    ];
    collection.applications
      .filter(item => Number(item.amount || 0) > 0)
      .forEach(application => {
        const creditAccount = chartService.findByCode(application.receivableAccountCode || companyService.settings().defaultAccounts?.accountsReceivableCustomers || "");
        entry.lines.push({
          id: uid("JLN"),
          accountCode: creditAccount.code,
          accountName: creditAccount.name,
          debit: 0,
          credit: round2(application.amount),
          costCenter: "",
          auxiliary: application.customerTaxId || application.customerName,
          lineDescription: `Cobro de ${application.documentNumber}`,
          documentReference: application.documentNumber
        });
      });
    return entry;
  }

  async function saveCollection(collection) {
    const { collection: candidate, errors } = validateCollection(collection, { forConfirm: false });
    if (errors.length) return { ok: false, errors };
    const rows = collections();
    candidate.id = candidate.id || uid("COL");
    const index = rows.findIndex(item => item.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    const ack = await BlessERP.services.confirmedOperationalWrite.commit('collections', candidate, {});
    return { ...ack, collection: clone(ack.serverRecord?.payload || candidate) };
  }

  function confirmCollection(collectionId) {
    const rows = collections();
    const index = rows.findIndex(item => item.id === collectionId);
    if (index < 0) return { ok: false, errors: ["Cobro no encontrado."] };
    if (rows[index].status !== "BORRADOR") return { ok: false, errors: ["Solo se pueden confirmar cobros en borrador."] };
    const { collection: candidate, errors } = validateCollection(rows[index], { forConfirm: true });
    if (errors.length) return { ok: false, errors };
    const entryDraft = buildCollectionJournalEntry(candidate);
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento de cobro."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el asiento de cobro."] };
    candidate.status = "CONFIRMADO";
    candidate.entryId = postedEntry.entry.id;
    candidate.entryNumber = postedEntry.entry.entryNumber;
    rows[index] = candidate;
    saveList("collections", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: "CONFIRMAR_COBRO",
      entityType: "collection",
      entityId: candidate.id,
      entityLabel: candidate.collectionNumber,
      documentLabel: candidate.collectionNumber,
      previousStatus: "BORRADOR",
      nextStatus: candidate.status,
      description: `Cobro ${candidate.collectionNumber} confirmado con asiento ${candidate.entryNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, collection: clone(candidate), entry: clone(postedEntry.entry) };
  }

  async function confirmCollectionV2(collectionOrId, options = {}) {
    BlessERP.services?.financialV2?.recordCollectionTrace?.("CONFIRM_COLLECTION_V2_STARTED");
    const candidate = typeof collectionOrId === "string"
      ? collections().find(item => item.id === collectionOrId)
      : normalizeCollection(collectionOrId || {});
    if (!candidate) {
      BlessERP.getFinancialV2Repository?.()?.failCollectionTrace?.("COLLECTION_LOOKUP", { code: "COLLECTION_NOT_FOUND", message: "Cobro no encontrado." });
      return { ok: false, errors: ["Cobro no encontrado."] };
    }
    if (candidate.syncFlow === "FINANCIAL_V2" && candidate.status === "CONFIRMADO") {
      return { ok: true, confirmed: true, reused: true, collection: candidate };
    }
    const validation = validateCollection(candidate, { forConfirm: true });
    if (validation.errors.length) {
      BlessERP.getFinancialV2Repository?.()?.failCollectionTrace?.("COLLECTION_VALIDATION", { code: "VALIDATION_ERROR", message: validation.errors.join(" | ") });
      return { ok: false, errors: validation.errors };
    }
    const result = await BlessERP.services?.financialV2?.registerCollection?.(validation.collection, options);
    if (!result) return { ok: false, errors: ["Servicio financiero V2 no disponible."] };
    return result.ok ? result : { ...result, errors: result.errors || [result.message || "Supabase no confirmó el cobro."] };
  }

  async function annulCollectionV2(collectionId, reason, options = {}) {
    const candidate = collections().find(item => item.id === collectionId);
    if (!candidate) return { ok: false, message: "Cobro no encontrado." };
    if (candidate.syncFlow !== "FINANCIAL_V2") {
      return { ok: false, message: "El cobro histórico conserva el flujo anterior y no se reversó automáticamente." };
    }
    const result = await BlessERP.services?.financialV2?.reverseCollection?.(collectionId, reason, options);
    return result || { ok: false, message: "Servicio financiero V2 no disponible." };
  }

  function annulCollection(collectionId) {
    const rows = collections();
    const index = rows.findIndex(item => item.id === collectionId);
    if (index < 0) return { ok: false, message: "Cobro no encontrado." };
    const target = rows[index];
    if (target.status === "ANULADO") return { ok: false, message: "El cobro ya esta anulado." };
    if (target.status === "CONFIRMADO" && target.entryId) {
      const reversed = journalService.reverseEntry(target.entryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el cobro." };
      target.reverseEntryId = reversed.entry.id;
      target.reverseEntryNumber = reversed.entry.entryNumber;
    }
    target.status = "ANULADO";
    rows[index] = normalizeCollection(target);
    saveList("collections", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: "ANULAR_COBRO",
      entityType: "collection",
      entityId: target.id,
      entityLabel: target.collectionNumber,
      documentLabel: target.collectionNumber,
      previousStatus: "CONFIRMADO",
      nextStatus: target.status,
      description: `Cobro ${target.collectionNumber} anulado.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, collection: clone(rows[index]) };
  }

  function saveCollectionBatch(batch) {
    return BlessERP.services.confirmedOperationalWrite.unavailable("saveCollectionBatch");
  }

  function confirmCollectionBatch(batchId) {
    return BlessERP.services.confirmedOperationalWrite.unavailable("confirmCollectionBatch");
  }

  function annulCollectionBatch(batchId) {
    const rows = collectionBatches();
    const index = rows.findIndex(item => item.id === batchId);
    if (index < 0) return { ok: false, message: "Lote de cobro no encontrado." };
    const target = rows[index];
    if (target.status === "ANULADO") return { ok: false, message: "El lote ya esta anulado." };
    if (target.status === "CONFIRMADO" && target.entryId) {
      const reversed = journalService.reverseEntry(target.entryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el lote de cobro." };
      target.reverseEntryId = reversed.entry.id;
      target.reverseEntryNumber = reversed.entry.entryNumber;
    }
    target.status = "ANULADO";
    rows[index] = normalizeCollectionBatch(target);
    saveList("collectionBatches", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: "ANULAR_LOTE_COBRO",
      entityType: "collection_batch",
      entityId: target.id,
      entityLabel: target.batchNumber,
      documentLabel: target.batchNumber,
      previousStatus: "CONFIRMADO",
      nextStatus: target.status,
      description: `Lote de cobro ${target.batchNumber} anulado.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, batch: clone(rows[index]) };
  }

  function collectionHistoryForReceivable(receivableId) {
    return confirmedApplications()
      .filter(item => item.application.receivableId === receivableId)
      .sort((a, b) => `${b.collectionDate}|${b.collectionNumber}`.localeCompare(`${a.collectionDate}|${a.collectionNumber}`, "es"));
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.receivables = {
    customerTypes,
    customerStates,
    paymentConditions,
    receivableDocumentTypes,
    receivableStates,
    collectionMethods,
    collectionStates,
    collectionBatchStates,
    customers,
    findCustomerById,
    findCustomerByTaxId,
    resolveCanonicalCustomer,
    saveCustomer,
    saveCustomerConfirmed,
    toggleCustomerStatusConfirmed,
    toggleCustomerStatus,
    receivables,
    receivableDocuments,
    findReceivableById,
    customerPortfolioSummary,
    pendingReceivablesByCustomer,
    emptyReceivable,
    normalizeReceivable,
    validateReceivable,
    saveReceivable,
    syncAuthorizedSale,
    applyAuthorizedCreditNote,
    postCreditNote,
    postCreditNoteV2,
    postReceivable,
    postReceivableV2,
    annulReceivable,
    collections,
    collectionBatches,
    activeCollectionAccountOptions,
    emptyCollection,
    emptyCollectionBatch,
    saveCollection,
    confirmCollection,
    confirmCollectionV2,
    annulCollection,
    annulCollectionV2,
    saveCollectionBatch,
    confirmCollectionBatch,
    annulCollectionBatch,
    collectionHistoryForReceivable,
    normalizeCollection,
    normalizeCollectionBatch,
    validateCollectionDraft
  };
})();
