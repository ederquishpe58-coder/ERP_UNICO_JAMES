(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;
  const journalService = BlessERP.services.journal;
  const purchaseService = BlessERP.services.purchases;
  const adminService = BlessERP.services.adminConfig;

  const providerTypes = ["comercial", "floricola", "servicios", "transporte", "insumos", "otros"];
  const providerStates = ["activo", "inactivo"];
  const paymentConditions = ["Contado", "Credito 15 dias", "Credito 30 dias", "Credito 45 dias", "Credito 60 dias"];
  const payableStates = ["PENDIENTE", "PARCIAL", "PAGADO", "VENCIDO", "ANULADO"];
  const paymentMethods = ["banco", "caja", "transferencia", "cheque", "efectivo", "otro"];
  const paymentStates = ["BORRADOR", "CONFIRMADO", "ANULADO"];
  const batchStates = ["BORRADOR", "CONFIRMADO", "ANULADO"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function currentUser() {
    return adminService?.activeUser?.() || stateApi.state.db.session?.activeUser || { id: "demo", name: "Usuario demo", role: "Administrador" };
  }

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function saveList(key, value) {
    stateApi.state.db[key] = value;
    stateApi.saveDb();
  }

  function nextProviderCode(existing = null) {
    const providers = existing || cloneList("providers");
    const max = providers.reduce((acc, item) => {
      const numeric = Number(String(item.code || "").replace(/\D/g, "") || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `PRV-${String(max + 1).padStart(4, "0")}`;
  }

  function normalizeProvider(provider = {}) {
    const settings = companyService.settings();
    const current = clone(provider || {});
    return {
      id: current.id || uid("PRV"),
      code: String(current.code || "").trim(),
      taxId: String(current.taxId || current.ruc || "").trim(),
      name: String(current.name || "").trim(),
      commercialName: String(current.commercialName || current.name || "").trim(),
      providerType: String(current.providerType || "otros").trim(),
      address: String(current.address || "").trim(),
      phone: String(current.phone || "").trim(),
      email: String(current.email || "").trim(),
      paymentCondition: String(current.paymentCondition || "Credito 30 dias").trim(),
      creditDays: Number(current.creditDays ?? 30),
      payableAccountCode: String(current.payableAccountCode || settings.defaultAccounts?.accountsPayableSuppliers || "").trim(),
      advanceAccountCode: String(current.advanceAccountCode || settings.defaultAccounts?.supplierAdvances || "").trim(),
      status: String(current.status || "activo").trim().toLowerCase(),
      observation: String(current.observation || current.notes || "").trim(),
      profileState: String(current.profileState || "COMPLETO").trim().toUpperCase(),
      hasMovements: Boolean(current.hasMovements)
    };
  }

  function syncProvidersFromPurchases() {
    const providers = cloneList("providers").map(normalizeProvider);
    const purchases = purchaseService.purchases();
    let changed = false;
    purchases.forEach(purchase => {
      if (!purchase.supplierRuc || !purchase.supplierName) return;
      const existing = providers.find(item => item.taxId === purchase.supplierRuc);
      if (existing) {
        if (!existing.address && purchase.supplierAddress) {
          existing.address = purchase.supplierAddress;
          changed = true;
        }
        return;
      }
      providers.push(normalizeProvider({
        code: nextProviderCode(providers),
        ruc: purchase.supplierRuc,
        taxId: purchase.supplierRuc,
        name: purchase.supplierName,
        commercialName: purchase.supplierName,
        providerType: "otros",
        address: purchase.supplierAddress || "",
        email: "",
        phone: "",
        paymentCondition: "Credito 30 dias",
        creditDays: 30,
        status: "activo",
        observation: "Proveedor creado automaticamente desde compra/XML.",
        profileState: "PENDIENTE"
      }));
      changed = true;
    });
    if (changed) saveList("providers", providers);
    return providers;
  }

  function providers() {
    const rows = syncProvidersFromPurchases().map(normalizeProvider);
    const purchases = purchaseService.purchases();
    const confirmedPayments = payments().filter(item => item.status === "CONFIRMADO");
    const confirmedBatches = paymentBatches().filter(item => item.status === "CONFIRMADO");
    return rows.map(provider => ({
      ...provider,
      hasMovements: purchases.some(item => item.supplierRuc === provider.taxId)
        || confirmedPayments.some(item => item.providerRuc === provider.taxId)
        || confirmedBatches.some(item => item.applications?.some(app => app.supplierRuc === provider.taxId))
    }));
  }

  function findProviderById(providerId) {
    return providers().find(item => item.id === providerId);
  }

  function findProviderByTaxId(taxId) {
    return providers().find(item => item.taxId === taxId);
  }

  function validateProvider(provider) {
    const candidate = normalizeProvider(provider);
    const errors = [];
    if (!candidate.taxId) errors.push("El RUC / CI es obligatorio.");
    if (!candidate.name) errors.push("La razon social / nombre es obligatoria.");
    const duplicate = providers().find(item => item.id !== candidate.id && item.taxId === candidate.taxId);
    if (duplicate) errors.push("No se permite RUC / CI duplicado.");
    if (!providerTypes.includes(candidate.providerType)) errors.push("El tipo de proveedor no es valido.");
    if (!providerStates.includes(candidate.status)) errors.push("El estado del proveedor no es valido.");
    return { provider: candidate, errors };
  }

  function saveProvider(provider) {
    const { provider: candidate, errors } = validateProvider(provider);
    if (errors.length) return { ok: false, errors };
    const rows = providers();
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (!candidate.code) candidate.code = nextProviderCode(rows);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("providers", rows);
    adminService?.addAuditLog?.({
      module: "CARTERAS",
      action: index >= 0 ? "EDITAR_PROVEEDOR" : "CREAR_PROVEEDOR",
      entityType: "provider",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.name,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el proveedor ${candidate.name}.`,
      before,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, provider: clone(candidate) };
  }

  function toggleProviderStatus(providerId) {
    const rows = providers();
    const index = rows.findIndex(item => item.id === providerId);
    if (index < 0) return { ok: false, message: "Proveedor no encontrado." };
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    saveList("providers", rows);
    adminService?.addAuditLog?.({
      module: "CARTERAS",
      action: "CAMBIAR_ESTADO_PROVEEDOR",
      entityType: "provider",
      entityId: rows[index].id,
      entityLabel: rows[index].code,
      documentLabel: rows[index].name,
      nextStatus: rows[index].status,
      description: `Proveedor ${rows[index].name} cambiado a ${rows[index].status}.`,
      after: rows[index],
      result: "exitoso"
    });
    return { ok: true, provider: clone(rows[index]) };
  }

  function payments() {
    return cloneList("payments");
  }

  function paymentBatches() {
    return cloneList("paymentBatches");
  }

  function nextPaymentNumber(existing = null) {
    const rows = existing || payments();
    const year = companyService.settings().periodStart?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.paymentNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `PAG-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function nextBatchNumber(existing = null) {
    const rows = existing || paymentBatches();
    const year = companyService.settings().periodStart?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.batchNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `LOT-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function activePaymentAccountOptions() {
    const movement = chartService.movementOptions();
    const direct = movement.filter(item => item.type === "Activo" && String(item.code || "").startsWith("1.1.01"));
    return direct.length ? direct : movement.filter(item => item.type === "Activo");
  }

  function sumAppliedWithholdings(purchaseId) {
    return round2(
      purchaseService.issuedWithholdings()
        .filter(item => item.purchaseId === purchaseId && item.status !== "ANULADA")
        .reduce((sum, item) => sum + Number(item.retainedAmount || 0), 0)
    );
  }

  function normalizedPaymentApplications(collection, kind) {
    return collection.flatMap(item =>
      (item.applications || [])
        .filter(application => item.status === "CONFIRMADO")
        .map(application => ({
          paymentId: item.id,
          source: kind,
          paymentNumber: kind === "LOTE" ? item.batchNumber : item.paymentNumber,
          paymentDate: item.paymentDate,
          providerId: item.providerId || application.providerId || "",
          providerRuc: item.providerRuc || application.supplierRuc || "",
          providerName: item.providerName || application.supplierName || "",
          entryId: item.entryId || "",
          entryNumber: item.entryNumber || "",
          application: clone(application)
        }))
    );
  }

  function confirmedApplications() {
    const individual = normalizedPaymentApplications(payments(), "PAGO");
    const batches = normalizedPaymentApplications(paymentBatches(), "LOTE");
    return [...individual, ...batches];
  }

  function paymentsByPurchase(purchaseId) {
    return confirmedApplications().filter(item => item.application.purchaseId === purchaseId);
  }

  function derivePayables() {
    const purchases = purchaseService.purchases();
    const paymentRows = confirmedApplications();
    return purchases
      .filter(purchase => ["PENDIENTE_RETENCION", "CONTABILIZADO", "RETENIDO", "ANULADO"].includes(purchase.status))
      .map(purchase => {
        const provider = findProviderByTaxId(purchase.supplierRuc);
        const retentionApplied = sumAppliedWithholdings(purchase.id);
        const paid = round2(
          paymentRows
            .filter(item => item.application.purchaseId === purchase.id)
            .reduce((sum, item) => sum + Number(item.application.amount || 0), 0)
        );
        const anticiposApplied = round2(
          paymentRows
            .filter(item => item.application.purchaseId === purchase.id)
            .reduce((sum, item) => sum + Number(item.application.advanceApplied || 0), 0)
        );
        const total = round2(purchase.totals.total || 0);
        const saldo = round2(Math.max(0, total - retentionApplied - anticiposApplied - paid));
        const dueDate = purchase.dueDate || purchase.issueDate;
        const overdueDays = dueDate && saldo > 0
          ? Math.max(0, Math.floor((new Date(today()) - new Date(dueDate)) / (1000 * 60 * 60 * 24)))
          : 0;
        const state = purchase.status === "ANULADO"
          ? "ANULADO"
          : saldo <= 0
            ? "PAGADO"
            : paid > 0
              ? "PARCIAL"
              : overdueDays > 0
                ? "VENCIDO"
                : "PENDIENTE";
        return {
          id: purchase.payableId || `payable-${purchase.id}`,
          purchaseId: purchase.id,
          providerId: provider?.id || purchase.supplierId || "",
          providerCode: provider?.code || "",
          providerName: purchase.supplierName,
          providerRuc: purchase.supplierRuc,
          voucherType: purchase.voucherType,
          documentNumber: purchase.documentNumber,
          issueDate: purchase.issueDate,
          accountingDate: purchase.accountingDate,
          dueDate,
          totalDocument: total,
          retentionApplied,
          advanceApplied: anticiposApplied,
          paid,
          balance: saldo,
          state,
          originEntryId: purchase.journalEntryId,
          originEntryNumber: purchase.journalEntryNumber,
          overdueDays,
          paymentCount: paymentRows.filter(item => item.application.purchaseId === purchase.id).length,
          sourcePurchase: clone(purchase)
        };
      });
  }

  function payables(filters = {}) {
    return derivePayables().filter(item => {
      if (filters.providerId && item.providerId !== filters.providerId) return false;
      if (filters.state && item.state !== filters.state) return false;
      if (filters.status && item.state !== filters.status) return false;
      if (filters.search) {
        const search = String(filters.search || "").toLowerCase();
        const haystack = [
          item.providerName,
          item.providerRuc,
          item.documentNumber,
          item.originEntryNumber,
          purchaseService.voucherLabel(item.voucherType)
        ].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function providerPortfolioSummary(providerId) {
    const provider = findProviderById(providerId);
    if (!provider) return null;
    const docs = payables({ providerId });
    const periodPrefix = companyService.settings().activePeriod || "";
    const paymentsConfirmed = payments()
      .filter(item => item.status === "CONFIRMADO" && item.providerId === providerId && item.paymentDate.startsWith(periodPrefix));
    const batchesConfirmed = paymentBatches()
      .filter(item => item.status === "CONFIRMADO" && item.applications?.some(app => app.providerId === providerId) && item.paymentDate.startsWith(periodPrefix));
    const totalPaidPeriod = round2(
      paymentsConfirmed.reduce((sum, item) => sum + Number(item.total || 0), 0)
      + batchesConfirmed.reduce((sum, item) => sum + Number(item.applications.filter(app => app.providerId === providerId).reduce((acc, app) => acc + Number(app.amount || 0), 0)), 0)
    );
    const latestPayment = [...paymentsConfirmed, ...batchesConfirmed]
      .sort((a, b) => `${b.paymentDate}|${b.createdAt || ""}`.localeCompare(`${a.paymentDate}|${a.createdAt || ""}`, "es"))[0] || null;

    return {
      provider,
      totalPending: round2(docs.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.state)).reduce((sum, item) => sum + item.balance, 0)),
      totalOverdue: round2(docs.filter(item => item.state === "VENCIDO").reduce((sum, item) => sum + item.balance, 0)),
      totalUpcoming: round2(docs.filter(item => ["PENDIENTE", "PARCIAL"].includes(item.state) && item.overdueDays === 0).reduce((sum, item) => sum + item.balance, 0)),
      totalPaidPeriod,
      pendingWithholdings: round2(docs.filter(item => item.sourcePurchase.status === "PENDIENTE_RETENCION").reduce((sum, item) => sum + item.balance, 0)),
      availableAdvances: 0,
      latestPayment,
      openDocuments: docs.filter(item => item.state !== "PAGADO" && item.state !== "ANULADO").length,
      documents: docs
    };
  }

  function emptyPayment(providerId = "") {
    const rows = payments();
    return {
      id: "",
      paymentNumber: nextPaymentNumber(rows),
      providerId,
      providerName: "",
      providerRuc: "",
      paymentDate: today(),
      paymentMethod: "transferencia",
      paymentAccountCode: "",
      paymentAccountName: "",
      reference: "",
      observation: "",
      status: "BORRADOR",
      entryId: "",
      entryNumber: "",
      source: "INDIVIDUAL",
      applications: [],
      createdBy: currentUser().name,
      createdAt: new Date().toISOString()
    };
  }

  function emptyBatch() {
    const rows = paymentBatches();
    return {
      id: "",
      batchNumber: nextBatchNumber(rows),
      paymentDate: today(),
      paymentAccountCode: "",
      paymentAccountName: "",
      reference: "",
      observation: "",
      status: "BORRADOR",
      entryId: "",
      entryNumber: "",
      totalDocuments: 0,
      totalToPay: 0,
      createdBy: currentUser().name,
      createdAt: new Date().toISOString(),
      applications: []
    };
  }

  function pendingPayablesByProvider(providerId) {
    return payables({ providerId }).filter(item => !["PAGADO", "ANULADO"].includes(item.state));
  }

  function normalizePayment(payment) {
    const candidate = {
      ...emptyPayment(payment.providerId || ""),
      ...clone(payment || {})
    };
    const provider = candidate.providerId ? findProviderById(candidate.providerId) : findProviderByTaxId(candidate.providerRuc);
    if (provider) {
      candidate.providerId = provider.id;
      candidate.providerName = provider.name;
      candidate.providerRuc = provider.taxId;
    }
    candidate.paymentMethod = String(candidate.paymentMethod || "transferencia").toLowerCase();
    candidate.status = String(candidate.status || "BORRADOR").toUpperCase();
    candidate.applications = (candidate.applications || []).map(application => ({
      payableId: String(application.payableId || ""),
      purchaseId: String(application.purchaseId || ""),
      documentNumber: String(application.documentNumber || ""),
      supplierName: String(application.supplierName || candidate.providerName || ""),
      supplierRuc: String(application.supplierRuc || candidate.providerRuc || ""),
      providerId: String(application.providerId || candidate.providerId || ""),
      originalBalance: round2(application.originalBalance || 0),
      withholdingApplied: round2(application.withholdingApplied || 0),
      advanceApplied: round2(application.advanceApplied || 0),
      amount: round2(application.amount || 0),
      resultingBalance: round2(application.resultingBalance || 0)
    }));
    candidate.total = round2(candidate.applications.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    candidate.paymentAccountName = candidate.paymentAccountCode
      ? (chartService.findByCode(candidate.paymentAccountCode)?.name || candidate.paymentAccountName || "")
      : "";
    return candidate;
  }

  function normalizeBatch(batch) {
    const candidate = {
      ...emptyBatch(),
      ...clone(batch || {})
    };
    candidate.status = String(candidate.status || "BORRADOR").toUpperCase();
    candidate.applications = (candidate.applications || []).map(application => ({
      payableId: String(application.payableId || ""),
      purchaseId: String(application.purchaseId || ""),
      providerId: String(application.providerId || ""),
      supplierName: String(application.supplierName || ""),
      supplierRuc: String(application.supplierRuc || ""),
      documentNumber: String(application.documentNumber || ""),
      originalBalance: round2(application.originalBalance || 0),
      withholdingApplied: round2(application.withholdingApplied || 0),
      advanceApplied: round2(application.advanceApplied || 0),
      amount: round2(application.amount || 0),
      resultingBalance: round2(application.resultingBalance || 0)
    }));
    candidate.totalDocuments = candidate.applications.filter(item => Number(item.amount || 0) > 0).length;
    candidate.totalToPay = round2(candidate.applications.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    candidate.paymentAccountName = candidate.paymentAccountCode
      ? (chartService.findByCode(candidate.paymentAccountCode)?.name || candidate.paymentAccountName || "")
      : "";
    return candidate;
  }

  function validateApplications(applications = []) {
    const errors = [];
    applications.forEach((application, index) => {
      const payable = payables().find(item => item.id === application.payableId);
      const row = index + 1;
      if (!payable) {
        errors.push(`El documento ${row} ya no existe en cartera.`);
        return;
      }
      if (["PAGADO", "ANULADO"].includes(payable.state)) {
        errors.push(`El documento ${payable.documentNumber} ya no puede pagarse.`);
      }
      if (Number(application.amount || 0) < 0) {
        errors.push(`El valor aplicado al documento ${payable.documentNumber} no puede ser negativo.`);
      }
      if (Number(application.amount || 0) > Number(payable.balance || 0)) {
        errors.push(`El valor aplicado al documento ${payable.documentNumber} excede su saldo disponible.`);
      }
    });
    return errors;
  }

  function validatePayment(payment, { forConfirm = false } = {}) {
    const candidate = normalizePayment(payment);
    const errors = [];
    if (!candidate.providerId) errors.push("Debe seleccionar un proveedor.");
    if (!candidate.paymentDate) errors.push("La fecha de pago es obligatoria.");
    if (forConfirm && !candidate.paymentAccountCode) errors.push("Debe seleccionar la cuenta contable de pago.");
    const appErrors = validateApplications(candidate.applications);
    errors.push(...appErrors);
    const positiveApplications = candidate.applications.filter(item => Number(item.amount || 0) > 0);
    if (!positiveApplications.length) errors.push("Debe aplicar valor a por lo menos un documento.");
    if (forConfirm && candidate.total <= 0) errors.push("El pago no puede ser cero.");
    const account = candidate.paymentAccountCode ? chartService.findByCode(candidate.paymentAccountCode) : null;
    if (forConfirm && candidate.paymentAccountCode && !account) errors.push("La cuenta de pago seleccionada no existe.");
    if (forConfirm && account && account.status !== "Activa") errors.push("La cuenta de pago seleccionada esta inactiva.");
    if (forConfirm && account && !account.isMovement) errors.push("La cuenta de pago seleccionada no es de movimiento.");
    return { payment: candidate, errors };
  }

  function buildPaymentJournalEntry(payment, label = "") {
    const defaults = companyService.settings().defaultAccounts || {};
    const accountsPayable = chartService.findByCode(defaults.accountsPayableSuppliers);
    const paymentAccount = chartService.findByCode(payment.paymentAccountCode);
    const entry = journalService.emptyEntry();
    entry.accountingDate = payment.paymentDate;
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
    entry.concept = label || `Pago a proveedor ${payment.providerName}`;
    entry.originModule = "Pagos";
    entry.sourceDocument = payment.paymentNumber || payment.batchNumber || "";
    entry.externalReference = payment.reference || "";
    entry.observation = payment.observation || "";
    entry.lines = payment.applications
      .filter(item => Number(item.amount || 0) > 0)
      .map(application => ({
        id: uid("JLN"),
        accountCode: accountsPayable.code,
        accountName: accountsPayable.name,
        debit: round2(application.amount),
        credit: 0,
        costCenter: "",
        auxiliary: payment.providerRuc || application.supplierRuc,
        lineDescription: `Pago de ${application.documentNumber}`,
        documentReference: application.documentNumber
      }));
    entry.lines.push({
      id: uid("JLN"),
      accountCode: paymentAccount.code,
      accountName: paymentAccount.name,
      debit: 0,
      credit: round2(payment.total || payment.totalToPay || 0),
      costCenter: "",
      auxiliary: "",
      lineDescription: `Cuenta de pago ${paymentAccount.name}`,
      documentReference: payment.paymentNumber || payment.batchNumber || ""
    });
    return entry;
  }

  function savePayment(payment) {
    const { payment: candidate, errors } = validatePayment(payment, { forConfirm: false });
    if (errors.filter(error => !error.includes("Debe seleccionar la cuenta contable de pago")).length) return { ok: false, errors };
    const rows = payments();
    const index = rows.findIndex(item => item.id === candidate.id);
    candidate.id = candidate.id || uid("PAY");
    if (!candidate.paymentNumber) candidate.paymentNumber = nextPaymentNumber(rows);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("payments", rows);
    adminService?.addAuditLog?.({
      module: "PAGOS",
      action: index >= 0 ? "EDITAR_PAGO" : "CREAR_PAGO",
      entityType: "payment",
      entityId: candidate.id,
      entityLabel: candidate.paymentNumber,
      documentLabel: candidate.paymentNumber,
      previousStatus: index >= 0 ? payment.status || "" : "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el pago ${candidate.paymentNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, payment: clone(candidate) };
  }

  function confirmPayment(paymentId) {
    const rows = payments();
    const index = rows.findIndex(item => item.id === paymentId);
    if (index < 0) return { ok: false, errors: ["Pago no encontrado."] };
    if (rows[index].status !== "BORRADOR") return { ok: false, errors: ["Solo se pueden confirmar pagos en borrador."] };
    const { payment: candidate, errors } = validatePayment(rows[index], { forConfirm: true });
    if (errors.length) return { ok: false, errors };
    const defaults = companyService.settings().defaultAccounts || {};
    if (!defaults.accountsPayableSuppliers) return { ok: false, errors: ["No existe cuenta por pagar proveedores predeterminada."] };
    const entryDraft = buildPaymentJournalEntry(candidate);
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento de pago."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el asiento de pago."] };
    candidate.status = "CONFIRMADO";
    candidate.entryId = postedEntry.entry.id;
    candidate.entryNumber = postedEntry.entry.entryNumber;
    rows[index] = candidate;
    saveList("payments", rows);
    adminService?.addAuditLog?.({
      module: "PAGOS",
      action: "CONFIRMAR_PAGO",
      entityType: "payment",
      entityId: candidate.id,
      entityLabel: candidate.paymentNumber,
      documentLabel: candidate.paymentNumber,
      previousStatus: "BORRADOR",
      nextStatus: candidate.status,
      description: `Pago ${candidate.paymentNumber} confirmado con asiento ${candidate.entryNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, payment: clone(candidate), entry: clone(postedEntry.entry) };
  }

  function annulPayment(paymentId) {
    const rows = payments();
    const index = rows.findIndex(item => item.id === paymentId);
    if (index < 0) return { ok: false, message: "Pago no encontrado." };
    const payment = rows[index];
    if (payment.status === "ANULADO") return { ok: false, message: "El pago ya esta anulado." };
    if (payment.status === "CONFIRMADO" && payment.entryId) {
      const reversed = journalService.reverseEntry(payment.entryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el asiento del pago." };
      payment.reverseEntryId = reversed.entry.id;
      payment.reverseEntryNumber = reversed.entry.entryNumber;
    }
    payment.status = "ANULADO";
    rows[index] = payment;
    saveList("payments", rows);
    adminService?.addAuditLog?.({
      module: "PAGOS",
      action: "ANULAR_PAGO",
      entityType: "payment",
      entityId: payment.id,
      entityLabel: payment.paymentNumber,
      documentLabel: payment.paymentNumber,
      previousStatus: "CONFIRMADO",
      nextStatus: payment.status,
      description: `Pago ${payment.paymentNumber} anulado.`,
      after: payment,
      result: "exitoso"
    });
    return { ok: true, payment: clone(payment) };
  }

  function validateBatch(batch, { forConfirm = false } = {}) {
    const candidate = normalizeBatch(batch);
    const errors = [];
    if (!candidate.paymentDate) errors.push("La fecha del lote es obligatoria.");
    if (forConfirm && !candidate.paymentAccountCode) errors.push("Debe seleccionar la cuenta de pago del lote.");
    errors.push(...validateApplications(candidate.applications));
    if (!candidate.applications.some(item => Number(item.amount || 0) > 0)) errors.push("Debe seleccionar documentos con valores a pagar.");
    if (forConfirm && candidate.totalToPay <= 0) errors.push("El lote no puede confirmarse con valor cero.");
    const paymentAccount = candidate.paymentAccountCode ? chartService.findByCode(candidate.paymentAccountCode) : null;
    if (forConfirm && candidate.paymentAccountCode && !paymentAccount) errors.push("La cuenta de pago del lote no existe.");
    if (forConfirm && paymentAccount && paymentAccount.status !== "Activa") errors.push("La cuenta de pago del lote esta inactiva.");
    if (forConfirm && paymentAccount && !paymentAccount.isMovement) errors.push("La cuenta de pago del lote no es de movimiento.");
    return { batch: candidate, errors };
  }

  function saveBatch(batch) {
    const { batch: candidate, errors } = validateBatch(batch, { forConfirm: false });
    if (errors.filter(error => !error.includes("Debe seleccionar la cuenta de pago del lote")).length) return { ok: false, errors };
    const rows = paymentBatches();
    const index = rows.findIndex(item => item.id === candidate.id);
    candidate.id = candidate.id || uid("LOT");
    if (!candidate.batchNumber) candidate.batchNumber = nextBatchNumber(rows);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("paymentBatches", rows);
    adminService?.addAuditLog?.({
      module: "PAGOS",
      action: index >= 0 ? "EDITAR_LOTE_PAGO" : "CREAR_LOTE_PAGO",
      entityType: "payment_batch",
      entityId: candidate.id,
      entityLabel: candidate.batchNumber,
      documentLabel: candidate.batchNumber,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el lote ${candidate.batchNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, batch: clone(candidate) };
  }

  function confirmBatch(batchId) {
    const rows = paymentBatches();
    const index = rows.findIndex(item => item.id === batchId);
    if (index < 0) return { ok: false, errors: ["Lote no encontrado."] };
    if (rows[index].status !== "BORRADOR") return { ok: false, errors: ["Solo se pueden confirmar lotes en borrador."] };
    const { batch: candidate, errors } = validateBatch(rows[index], { forConfirm: true });
    if (errors.length) return { ok: false, errors };
    const defaults = companyService.settings().defaultAccounts || {};
    if (!defaults.accountsPayableSuppliers) return { ok: false, errors: ["No existe cuenta por pagar proveedores predeterminada."] };
    const pseudoPayment = {
      ...candidate,
      providerName: "Lote de pagos",
      providerRuc: "",
      paymentNumber: candidate.batchNumber,
      total: candidate.totalToPay
    };
    const entryDraft = buildPaymentJournalEntry(pseudoPayment, `Lote de pagos ${candidate.batchNumber}`);
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento del lote."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el asiento del lote."] };
    candidate.status = "CONFIRMADO";
    candidate.entryId = postedEntry.entry.id;
    candidate.entryNumber = postedEntry.entry.entryNumber;
    rows[index] = candidate;
    saveList("paymentBatches", rows);
    adminService?.addAuditLog?.({
      module: "PAGOS",
      action: "CONFIRMAR_LOTE_PAGO",
      entityType: "payment_batch",
      entityId: candidate.id,
      entityLabel: candidate.batchNumber,
      documentLabel: candidate.batchNumber,
      previousStatus: "BORRADOR",
      nextStatus: candidate.status,
      description: `Lote ${candidate.batchNumber} confirmado con asiento ${candidate.entryNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, batch: clone(candidate), entry: clone(postedEntry.entry) };
  }

  function annulBatch(batchId) {
    const rows = paymentBatches();
    const index = rows.findIndex(item => item.id === batchId);
    if (index < 0) return { ok: false, message: "Lote no encontrado." };
    const batch = rows[index];
    if (batch.status === "ANULADO") return { ok: false, message: "El lote ya esta anulado." };
    if (batch.status === "CONFIRMADO" && batch.entryId) {
      const reversed = journalService.reverseEntry(batch.entryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el lote." };
      batch.reverseEntryId = reversed.entry.id;
      batch.reverseEntryNumber = reversed.entry.entryNumber;
    }
    batch.status = "ANULADO";
    rows[index] = batch;
    saveList("paymentBatches", rows);
    adminService?.addAuditLog?.({
      module: "PAGOS",
      action: "ANULAR_LOTE_PAGO",
      entityType: "payment_batch",
      entityId: batch.id,
      entityLabel: batch.batchNumber,
      documentLabel: batch.batchNumber,
      previousStatus: "CONFIRMADO",
      nextStatus: batch.status,
      description: `Lote ${batch.batchNumber} anulado.`,
      after: batch,
      result: "exitoso"
    });
    return { ok: true, batch: clone(batch) };
  }

  function paymentHistoryForPurchase(purchaseId) {
    return confirmedApplications()
      .filter(item => item.application.purchaseId === purchaseId)
      .sort((a, b) => `${b.paymentDate}|${b.paymentNumber}`.localeCompare(`${a.paymentDate}|${a.paymentNumber}`, "es"));
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.portfolios = {
    providerTypes,
    providerStates,
    paymentConditions,
    payableStates,
    paymentMethods,
    paymentStates,
    batchStates,
    providers,
    findProviderById,
    findProviderByTaxId,
    saveProvider,
    toggleProviderStatus,
    payables,
    providerPortfolioSummary,
    activePaymentAccountOptions,
    payments,
    paymentBatches,
    paymentsByPurchase,
    pendingPayablesByProvider,
    emptyPayment,
    emptyBatch,
    savePayment,
    confirmPayment,
    annulPayment,
    saveBatch,
    confirmBatch,
    annulBatch,
    paymentHistoryForPurchase,
    normalizePayment,
    normalizeBatch
  };
})();
