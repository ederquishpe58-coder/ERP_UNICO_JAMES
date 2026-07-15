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
  const receivableDocumentTypes = ["saldo inicial", "documento manual", "ajuste", "factura futura"];
  const receivableStates = ["PENDIENTE", "PARCIAL", "COBRADO", "VENCIDO", "ANULADO"];
  const collectionMethods = ["banco", "caja", "transferencia", "cheque", "efectivo", "tarjeta", "otro"];
  const collectionStates = ["BORRADOR", "CONFIRMADO", "ANULADO"];
  const collectionBatchStates = ["BORRADOR", "CONFIRMADO", "ANULADO"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
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
    return {
      id: current.id || uid("CUS"),
      code: String(current.code || "").trim(),
      taxId: String(current.taxId || current.identification || "").trim(),
      name: String(current.name || current.legalName || "").trim(),
      commercialName: String(current.commercialName || current.name || "").trim(),
      customerType: String(current.customerType || "otro").trim().toLowerCase(),
      country: String(current.country || "Ecuador").trim(),
      city: String(current.city || "").trim(),
      address: String(current.address || "").trim(),
      phone: String(current.phone || "").trim(),
      email: String(current.email || "").trim(),
      paymentCondition: String(current.paymentCondition || "Credito 30 dias").trim(),
      creditDays: Number(current.creditDays ?? 30),
      creditLimit: round2(current.creditLimit || 0),
      receivableAccountCode: String(current.receivableAccountCode || settings.defaultAccounts?.accountsReceivableCustomers || "").trim(),
      advanceAccountCode: String(current.advanceAccountCode || settings.defaultAccounts?.customerAdvances || "").trim(),
      status: String(current.status || "activo").trim().toLowerCase(),
      observation: String(current.observation || current.notes || "").trim(),
      hasMovements: Boolean(current.hasMovements)
    };
  }

  function customerCatalog() {
    return cloneList("customers").map(normalizeCustomer);
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

  function validateCustomer(customer) {
    const candidate = normalizeCustomer(customer);
    const errors = [];
    if (!candidate.name) errors.push("La razon social / nombre es obligatoria.");
    if (!candidate.code) candidate.code = nextCustomerCode(customerCatalog());
    if (!candidate.taxId) errors.push("La identificacion del cliente es obligatoria.");
    const duplicateCode = customerCatalog().find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicateCode) errors.push("No se permite codigo de cliente duplicado.");
    const duplicateTaxId = customerCatalog().find(item => item.id !== candidate.id && item.taxId === candidate.taxId);
    if (duplicateTaxId) errors.push("No se permite identificacion duplicada.");
    if (!customerTypes.includes(candidate.customerType)) errors.push("El tipo de cliente no es valido.");
    if (!customerStates.includes(candidate.status)) errors.push("El estado del cliente no es valido.");
    return { customer: candidate, errors };
  }

  function saveCustomer(customer) {
    const { customer: candidate, errors } = validateCustomer(customer);
    if (errors.length) return { ok: false, errors };
    const rows = customerCatalog();
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("customers", rows);
    adminService?.addAuditLog?.({
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
    });
    return { ok: true, customer: clone(candidate) };
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
      id: "",
      customerId,
      customerName: "",
      customerTaxId: "",
      customerCountry: "",
      documentType: "saldo inicial",
      documentNumber: nextReceivableNumber(),
      issueDate: today(),
      dueDate: today(),
      concept: "",
      total: 0,
      receivableAccountCode: settings.defaultAccounts?.accountsReceivableCustomers || "",
      counterAccountCode: "",
      counterAccountName: "",
      observation: "",
      status: "PENDIENTE",
      source: "MANUAL",
      journalEntryId: "",
      journalEntryNumber: "",
      postingStatus: "NO_CONTABILIZADO",
      retentionPlaceholder: 0,
      advancePlaceholder: 0,
      createdBy: currentUser().name,
      createdAt: new Date().toISOString()
    };
  }

  function normalizeReceivable(receivable = {}) {
    const settings = companyService.settings();
    const current = {
      ...emptyReceivable(receivable.customerId || ""),
      ...clone(receivable || {})
    };
    const customer = current.customerId ? findCustomerById(current.customerId) : findCustomerByTaxId(current.customerTaxId);
    const receivableAccountCode = String(current.receivableAccountCode || settings.defaultAccounts?.accountsReceivableCustomers || "").trim();
    const counterAccount = current.counterAccountCode ? chartService.findByCode(current.counterAccountCode) : null;
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
      total: round2(current.total || 0),
      receivableAccountCode,
      counterAccountCode: String(current.counterAccountCode || "").trim(),
      counterAccountName: String(counterAccount?.name || current.counterAccountName || "").trim(),
      observation: String(current.observation || "").trim(),
      status: String(current.status || "PENDIENTE").trim().toUpperCase(),
      source: String(current.source || "MANUAL").trim().toUpperCase(),
      journalEntryId: String(current.journalEntryId || "").trim(),
      journalEntryNumber: String(current.journalEntryNumber || "").trim(),
      postingStatus: String(current.postingStatus || (current.journalEntryId ? "CONTABILIZADO" : "NO_CONTABILIZADO")).trim().toUpperCase(),
      retentionPlaceholder: round2(current.retentionPlaceholder || 0),
      advancePlaceholder: round2(current.advancePlaceholder || 0),
      createdBy: String(current.createdBy || currentUser().name).trim(),
      createdAt: String(current.createdAt || new Date().toISOString()).trim()
    };
  }

  function receivableDocuments() {
    return cloneList("customerReceivables").map(normalizeReceivable);
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
    return cloneList("collections").map(normalizeCollection);
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
        const collected = round2(
          applied
            .filter(item => item.application.receivableId === document.id)
            .reduce((sum, item) => sum + Number(item.application.amount || 0), 0)
        );
        const withheld = round2(
          appliedWithholdings
            .filter(item => item.receivableId === document.id)
            .reduce((sum, item) => sum + Number(item.amount || 0), 0)
        );
        const balance = round2(Math.max(0, document.total - collected - withheld));
        const overdueDays = document.dueDate && balance > 0
          ? Math.max(0, Math.floor((new Date(today()) - new Date(document.dueDate)) / (1000 * 60 * 60 * 24)))
          : 0;
        const state = document.status === "ANULADO"
          ? "ANULADO"
          : balance <= 0
            ? "COBRADO"
            : (collected > 0 || withheld > 0)
              ? "PARCIAL"
              : overdueDays > 0
                ? "VENCIDO"
                : "PENDIENTE";
        return {
          ...document,
          collected,
          withheld,
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

    if (!candidate.customerId) errors.push("Debe seleccionar un cliente.");
    if (!candidate.issueDate) errors.push("La fecha de emision es obligatoria.");
    if (!candidate.documentNumber) errors.push("El numero de documento es obligatorio.");
    if (!candidate.concept) errors.push("El concepto es obligatorio.");
    if (candidate.total <= 0) errors.push("El documento debe tener valor mayor que cero.");
    if (!receivableDocumentTypes.includes(candidate.documentType)) errors.push("El tipo de documento no es valido.");
    if (!candidate.receivableAccountCode) errors.push("Debe seleccionar la cuenta por cobrar.");
    if (customer && customer.status !== "activo") errors.push("El cliente seleccionado esta inactivo.");
    const duplicate = receivableDocuments().find(item =>
      item.id !== candidate.id
      && item.customerId === candidate.customerId
      && item.documentNumber === candidate.documentNumber
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
    }

    return { receivable: candidate, errors };
  }

  function buildReceivableJournalEntry(receivable) {
    const receivableAccount = chartService.findByCode(receivable.receivableAccountCode);
    const counterAccount = chartService.findByCode(receivable.counterAccountCode);
    const entry = journalService.emptyEntry();
    entry.accountingDate = receivable.issueDate;
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
    entry.concept = `Documento cartera ${receivable.documentNumber} - ${receivable.customerName}`;
    entry.originModule = "Cobros";
    entry.sourceDocument = receivable.documentNumber;
    entry.externalReference = receivable.documentNumber;
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
        credit: round2(receivable.total),
        costCenter: "",
        auxiliary: "",
        lineDescription: `Contrapartida ${receivable.documentNumber}`,
        documentReference: receivable.documentNumber
      }
    ];
    return entry;
  }

  function saveReceivable(receivable) {
    const { receivable: candidate, errors } = validateReceivable(receivable, { forPost: false });
    if (errors.length) return { ok: false, errors };
    const rows = receivableDocuments();
    candidate.id = candidate.id || uid("CXC");
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("customerReceivables", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: index >= 0 ? "EDITAR_CXC" : "CREAR_CXC",
      entityType: "receivable",
      entityId: candidate.id,
      entityLabel: candidate.documentNumber,
      documentLabel: candidate.documentNumber,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el documento ${candidate.documentNumber} de cuentas por cobrar.`,
      before,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, receivable: clone(candidate) };
  }

  function postReceivable(receivableId) {
    const rows = receivableDocuments();
    const index = rows.findIndex(item => item.id === receivableId);
    if (index < 0) return { ok: false, errors: ["Documento de cartera no encontrado."] };
    if (rows[index].journalEntryId) return { ok: false, errors: ["El documento ya esta contabilizado."] };
    const { receivable: candidate, errors } = validateReceivable(rows[index], { forPost: true });
    if (errors.length) return { ok: false, errors };
    const entryDraft = buildReceivableJournalEntry(candidate);
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento del documento."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el documento."] };
    candidate.journalEntryId = postedEntry.entry.id;
    candidate.journalEntryNumber = postedEntry.entry.entryNumber;
    candidate.postingStatus = "CONTABILIZADO";
    rows[index] = candidate;
    saveList("customerReceivables", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: "CONTABILIZAR_CXC",
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
    return { ok: true, receivable: clone(candidate), entry: clone(postedEntry.entry) };
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
    return {
      id: "",
      collectionNumber: nextCollectionNumber(),
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
      id: "",
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
    return {
      id: current.id || uid("COL"),
      collectionNumber: String(current.collectionNumber || nextCollectionNumber()).trim(),
      customerId: String(customer?.id || current.customerId || "").trim(),
      customerName: String(customer?.name || current.customerName || "").trim(),
      customerTaxId: String(customer?.taxId || current.customerTaxId || "").trim(),
      collectionDate: String(current.collectionDate || today()).trim(),
      collectionMethod: collectionMethods.includes(String(current.collectionMethod || "").toLowerCase()) ? String(current.collectionMethod || "").toLowerCase() : "transferencia",
      collectionAccountCode: resolvedAccountCode,
      collectionAccountName: String(resolvedAccount?.name || current.collectionAccountName || "").trim(),
      bankAccountId: String(current.bankAccountId || "").trim(),
      reference: String(current.reference || "").trim(),
      observation: String(current.observation || "").trim(),
      status: collectionStates.includes(String(current.status || "").toUpperCase()) ? String(current.status || "").toUpperCase() : "BORRADOR",
      entryId: String(current.entryId || "").trim(),
      entryNumber: String(current.entryNumber || "").trim(),
      applications: (current.applications || []).map(application => {
        const receivable = application.receivableId ? findReceivableById(application.receivableId) : null;
        return {
          receivableId: String(application.receivableId || "").trim(),
          customerId: String(application.customerId || current.customerId || receivable?.customerId || "").trim(),
          customerName: String(application.customerName || current.customerName || receivable?.customerName || "").trim(),
          customerTaxId: String(application.customerTaxId || current.customerTaxId || receivable?.customerTaxId || "").trim(),
          documentNumber: String(application.documentNumber || receivable?.documentNumber || "").trim(),
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

  function validateCollectionApplications(applications = []) {
    const errors = [];
    applications.forEach((application, index) => {
      const receivable = receivables().find(item => item.id === application.receivableId);
      const row = index + 1;
      if (!receivable) {
        errors.push(`El documento ${row} ya no existe en cartera.`);
        return;
      }
      if (["COBRADO", "ANULADO"].includes(receivable.status)) {
        errors.push(`El documento ${receivable.documentNumber} ya no puede cobrarse.`);
      }
      if (Number(application.amount || 0) < 0) {
        errors.push(`El valor aplicado al documento ${receivable.documentNumber} no puede ser negativo.`);
      }
      if (Number(application.amount || 0) > Number(receivable.balance || 0)) {
        errors.push(`El valor aplicado al documento ${receivable.documentNumber} excede su saldo disponible.`);
      }
    });
    return errors;
  }

  function validateCollection(collection, { forConfirm = false } = {}) {
    const candidate = normalizeCollection(collection);
    const errors = [];
    const collectionAccount = candidate.collectionAccountCode ? chartService.findByCode(candidate.collectionAccountCode) : null;
    const bankAccount = candidate.bankAccountId ? bankService()?.findBankAccountById(candidate.bankAccountId) : null;
    if (!candidate.customerId) errors.push("Debe seleccionar un cliente.");
    if (!candidate.collectionDate) errors.push("La fecha de cobro es obligatoria.");
    if (forConfirm && !candidate.collectionAccountCode) errors.push("Debe seleccionar la cuenta contable de cobro.");
    errors.push(...validateCollectionApplications(candidate.applications));
    if (!candidate.applications.some(item => Number(item.amount || 0) > 0)) errors.push("Debe aplicar valor a por lo menos un documento.");
    if (forConfirm && candidate.total <= 0) errors.push("El cobro no puede ser cero.");
    if (forConfirm && candidate.collectionAccountCode && !collectionAccount) errors.push("La cuenta de cobro no existe.");
    if (forConfirm && collectionAccount && collectionAccount.status !== "Activa") errors.push("La cuenta de cobro esta inactiva.");
    if (forConfirm && collectionAccount && !collectionAccount.isMovement) errors.push("La cuenta de cobro debe ser de movimiento.");
    if (forConfirm && candidate.bankAccountId && !bankAccount) errors.push("La cuenta bancaria/caja seleccionada no existe.");
    if (forConfirm && bankAccount && bankAccount.status !== "activa") errors.push("La cuenta bancaria/caja seleccionada esta inactiva.");
    return { collection: candidate, errors };
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
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
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

  function saveCollection(collection) {
    const { collection: candidate, errors } = validateCollection(collection, { forConfirm: false });
    if (errors.length) return { ok: false, errors };
    const rows = collections();
    candidate.id = candidate.id || uid("COL");
    const index = rows.findIndex(item => item.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("collections", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: index >= 0 ? "EDITAR_COBRO" : "CREAR_COBRO",
      entityType: "collection",
      entityId: candidate.id,
      entityLabel: candidate.collectionNumber,
      documentLabel: candidate.collectionNumber,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el cobro ${candidate.collectionNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, collection: clone(candidate) };
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
    const { batch: candidate, errors } = validateCollectionBatch(batch, { forConfirm: false });
    if (errors.length) return { ok: false, errors };
    const rows = collectionBatches();
    candidate.id = candidate.id || uid("LCB");
    const index = rows.findIndex(item => item.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("collectionBatches", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: index >= 0 ? "EDITAR_LOTE_COBRO" : "CREAR_LOTE_COBRO",
      entityType: "collection_batch",
      entityId: candidate.id,
      entityLabel: candidate.batchNumber,
      documentLabel: candidate.batchNumber,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el lote de cobro ${candidate.batchNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, batch: clone(candidate) };
  }

  function confirmCollectionBatch(batchId) {
    const rows = collectionBatches();
    const index = rows.findIndex(item => item.id === batchId);
    if (index < 0) return { ok: false, errors: ["Lote de cobro no encontrado."] };
    if (rows[index].status !== "BORRADOR") return { ok: false, errors: ["Solo se pueden confirmar lotes en borrador."] };
    const { batch: candidate, errors } = validateCollectionBatch(rows[index], { forConfirm: true });
    if (errors.length) return { ok: false, errors };
    const pseudoCollection = {
      ...candidate,
      total: candidate.totalToCollect,
      customerName: "Cobros masivos",
      collectionNumber: candidate.batchNumber
    };
    const entryDraft = buildCollectionJournalEntry(pseudoCollection, `Lote de cobros ${candidate.batchNumber}`);
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento del lote de cobro."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el lote de cobro."] };
    candidate.status = "CONFIRMADO";
    candidate.entryId = postedEntry.entry.id;
    candidate.entryNumber = postedEntry.entry.entryNumber;
    rows[index] = candidate;
    saveList("collectionBatches", rows);
    adminService?.addAuditLog?.({
      module: "COBROS",
      action: "CONFIRMAR_LOTE_COBRO",
      entityType: "collection_batch",
      entityId: candidate.id,
      entityLabel: candidate.batchNumber,
      documentLabel: candidate.batchNumber,
      previousStatus: "BORRADOR",
      nextStatus: candidate.status,
      description: `Lote de cobro ${candidate.batchNumber} confirmado con asiento ${candidate.entryNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, batch: clone(candidate), entry: clone(postedEntry.entry) };
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
    saveCustomer,
    toggleCustomerStatus,
    receivables,
    receivableDocuments,
    findReceivableById,
    customerPortfolioSummary,
    pendingReceivablesByCustomer,
    emptyReceivable,
    saveReceivable,
    postReceivable,
    annulReceivable,
    collections,
    collectionBatches,
    activeCollectionAccountOptions,
    emptyCollection,
    emptyCollectionBatch,
    saveCollection,
    confirmCollection,
    annulCollection,
    saveCollectionBatch,
    confirmCollectionBatch,
    annulCollectionBatch,
    collectionHistoryForReceivable,
    normalizeCollection,
    normalizeCollectionBatch
  };
})();
