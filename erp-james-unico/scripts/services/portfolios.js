(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;
  const journalService = BlessERP.services.journal;
  const purchaseService = BlessERP.services.purchases;
  const adminService = BlessERP.services.adminConfig;

  const providerTypes = ["comercial", "floricola", "productor", "socio", "servicios", "transporte", "insumos", "otros"];
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

  function supplierV2() { return BlessERP.services?.supplierFinanceV2 || null; }
  function requiresSupplierV2() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.supplierFinanceV2CaptureEnabled === true
      && window.location?.protocol !== "file:");
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

  function providerIdentity(value = "") {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "");
  }

  function normalizeProvider(provider = {}) {
    const settings = companyService.settings();
    const current = clone(provider || {});
    return {
      id: current.id || uid("PRV"),
      code: String(current.code || "").trim(),
      taxId: providerIdentity(current.taxId || current.ruc),
      ruc: providerIdentity(current.taxId || current.ruc),
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
      createdSource: String(current.createdSource || "").trim().toUpperCase(),
      lastXmlImportAt: String(current.lastXmlImportAt || "").trim(),
      hasMovements: Boolean(current.hasMovements)
    };
  }

  function upsertProviderFromPurchase(purchase = {}, options = {}) {
    const taxId = providerIdentity(purchase.supplierRuc);
    const name = String(purchase.supplierName || "").trim();
    if (!taxId || !name) {
      return { ok: false, created: false, errors: ["El XML no contiene RUC y razon social suficientes para crear el proveedor."] };
    }
    const rows = cloneList("providers").map(normalizeProvider);
    const index = rows.findIndex(item => providerIdentity(item.taxId) === taxId);
    const before = index >= 0 ? clone(rows[index]) : null;
    const current = index >= 0 ? rows[index] : normalizeProvider({
      code: nextProviderCode(rows),
      taxId,
      name,
      commercialName: purchase.supplierCommercialName || name,
      providerType: "otros",
      paymentCondition: "Credito 30 dias",
      creditDays: 30,
      status: "activo",
      observation: "Proveedor creado automaticamente desde XML de compra.",
      profileState: "PENDIENTE",
      createdSource: options.source || purchase.source || "XML"
    });
    current.name = current.name || name;
    current.commercialName = current.commercialName || purchase.supplierCommercialName || name;
    current.address = current.address || purchase.supplierAddress || "";
    current.email = current.email || purchase.supplierEmail || "";
    current.phone = current.phone || purchase.supplierPhone || "";
    current.ruc = taxId;
    current.taxId = taxId;
    current.lastXmlImportAt = options.importedAt || new Date().toISOString();
    current.profileState = current.address && current.email && current.phone ? "COMPLETO" : "PENDIENTE";
    if (index >= 0) rows[index] = normalizeProvider(current);
    else rows.unshift(normalizeProvider(current));
    saveList("providers", rows);
    const saved = index >= 0 ? rows[index] : rows[0];
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: index >= 0 ? "ACTUALIZAR_PROVEEDOR_DESDE_XML" : "CREAR_PROVEEDOR_DESDE_XML",
      entityType: "provider",
      entityId: saved.id,
      entityLabel: saved.code,
      documentLabel: saved.name,
      previousStatus: before?.profileState || "",
      nextStatus: saved.profileState,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} automaticamente el proveedor ${saved.name} desde un XML de compra.`,
      before,
      after: saved,
      result: "exitoso"
    });
    return { ok: true, created: index < 0, provider: clone(saved) };
  }

  function syncProvidersFromPurchases() {
    const providers = cloneList("providers").map(normalizeProvider);
    const purchases = purchaseService.purchases();
    let changed = false;
    purchases.forEach(purchase => {
      if (!purchase.supplierRuc || !purchase.supplierName) return;
      const purchaseTaxId = providerIdentity(purchase.supplierRuc);
      const existing = providers.find(item => providerIdentity(item.taxId) === purchaseTaxId);
      if (existing) {
        if (!existing.address && purchase.supplierAddress) {
          existing.address = purchase.supplierAddress;
          changed = true;
        }
        return;
      }
      providers.push(normalizeProvider({
        code: nextProviderCode(providers),
        ruc: purchaseTaxId,
        taxId: purchaseTaxId,
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
    const canonical = supplierV2()?.providers?.() || [];
    const canonicalIds = new Set(canonical.map(item => String(item.id || item.providerId || "")));
    const canonicalTax = new Set(canonical.map(item => providerIdentity(item.taxId || item.ruc)));
    const legacySource = requiresSupplierV2() ? cloneList("providers") : syncProvidersFromPurchases();
    const rows = [...canonical, ...legacySource.filter(item => !canonicalIds.has(String(item.id || "")) && !canonicalTax.has(providerIdentity(item.taxId || item.ruc)))]
      .map(item => normalizeProvider({
        ...item,
        providerType: ({ EXTERNAL:"comercial",PRODUCER:"productor",PARTNER:"socio",SERVICE:"servicios",TRANSPORT:"transporte",SUPPLIES:"insumos",OTHER:"otros" })[String(item.providerType || "").toUpperCase()] || item.providerType,
        status: ({ ACTIVE:"activo",INACTIVE:"inactivo" })[String(item.status || "").toUpperCase()] || item.status
      }));
    const purchases = purchaseService.purchases();
    const confirmedPayments = payments().filter(item => item.status === "CONFIRMADO");
    const confirmedBatches = paymentBatches().filter(item => item.status === "CONFIRMADO");
    return rows.map(provider => {
      const providerPurchases = purchases.filter(item => providerIdentity(item.supplierRuc) === provider.taxId);
      const validPurchases = providerPurchases.filter(item => String(item.status || "").toUpperCase() !== "ANULADO");
      const lastPurchase = providerPurchases
        .slice()
        .sort((a, b) => String(b.issueDate || b.createdAt || "").localeCompare(String(a.issueDate || a.createdAt || "")))[0];
      return {
        ...provider,
        purchaseCount: providerPurchases.length,
        totalPurchased: round2(validPurchases.reduce((sum, item) => sum + Number(item.totals?.total || 0), 0)),
        lastPurchaseDate: lastPurchase?.issueDate || "",
        hasMovements: providerPurchases.length > 0
          || confirmedPayments.some(item => providerIdentity(item.providerRuc) === provider.taxId)
          || confirmedBatches.some(item => item.applications?.some(app => providerIdentity(app.supplierRuc) === provider.taxId))
      };
    });
  }

  function findProviderById(providerId) {
    return providers().find(item => item.id === providerId);
  }

  function findProviderByTaxId(taxId) {
    const identity = providerIdentity(taxId);
    return providers().find(item => providerIdentity(item.taxId) === identity);
  }

  function validateProvider(provider) {
    const candidate = normalizeProvider(provider);
    const errors = [];
    if (!candidate.taxId) errors.push("El RUC / CI es obligatorio.");
    if (!candidate.name) errors.push("La razon social / nombre es obligatoria.");
    const duplicate = providers().find(item => item.id !== candidate.id && providerIdentity(item.taxId) === providerIdentity(candidate.taxId));
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
    if (!candidate.createdSource) candidate.createdSource = "MANUAL";
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

  async function saveProviderV2(provider, options = {}) {
    const { provider:candidate,errors }=validateProvider(provider);
    if(errors.length) return { ok:false,errors };
    if(!requiresSupplierV2()) return saveProvider(candidate);
    const result=await supplierV2()?.upsertProvider?.(candidate,{ source:candidate.createdSource || "MANUAL",...options });
    return result || { ok:false,errors:["Servicio de proveedores V2 no disponible."] };
  }

  async function upsertProviderFromPurchaseV2(purchase = {}, options = {}) {
    if(!requiresSupplierV2()) return upsertProviderFromPurchase(purchase,options);
    const result=await supplierV2()?.upsertProvider?.({ ...purchase,taxId:purchase.supplierRuc,name:purchase.supplierName },{ source:options.source || purchase.source || "PURCHASE" });
    return result?.ok ? { ...result,created:false } : result;
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

  async function toggleProviderStatusV2(providerId, options = {}) {
    const current = providers().find(item => String(item.id) === String(providerId));
    if (!current) return { ok: false, errors: ["Proveedor no encontrado."] };
    if (!requiresSupplierV2()) return toggleProviderStatus(providerId);
    return saveProviderV2({
      ...current,
      status: current.status === "activo" ? "inactivo" : "activo"
    }, options);
  }

  function payments() {
    const canonical=(supplierV2()?.payments?.() || []).map(item=>({
      ...clone(item),id:String(item.id || item.paymentId || ""),paymentNumber:item.paymentNumber || item.paymentCode || "",
      providerId:String(item.providerId || ""),providerName:item.providerName || "",providerRuc:item.providerRuc || "",
      paymentDate:item.paymentDate || "",paymentMethod:String(item.paymentMethod || "otro").toLowerCase(),
      paymentAccountCode:item.paymentAccountCode || "",total:round2(item.total || 0),applications:clone(item.applications || []),
      entryId:item.entryId || item.journalEntryId || "",status:({CONFIRMED:"CONFIRMADO",REVERSED:"ANULADO"})[String(item.status || "").toUpperCase()] || item.status,
      syncFlow:"SUPPLIER_FINANCE_V2",remoteConfirmed:true
    }));
    const refs=new Set(canonical.map(item=>String(item.clientReferenceId || "")).filter(Boolean));
    const ids=new Set(canonical.map(item=>String(item.id || item.paymentId || "")));
    return [...canonical,...cloneList("payments").filter(item=>!refs.has(String(item.id || ""))&&!ids.has(String(item.id || "")))];
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
    const canonical=(supplierV2()?.payables?.() || []).map(item=>({
      ...item,id:String(item.id || item.payableId || ""),providerId:String(item.providerId || ""),providerName:item.providerName || "",
      providerRuc:item.providerRuc || "",documentNumber:item.documentNumber || "",issueDate:item.issueDate || "",dueDate:item.dueDate || "",
      totalDocument:round2(item.total || 0),balance:round2(item.balance || 0),state:({OPEN:"PENDIENTE",PARTIALLY_PAID:"PARCIAL",PAID:"PAGADO",CANCELLED:"ANULADO"})[String(item.status || "").toUpperCase()] || item.state,
      originEntryId:item.journalEntryId || "",sourcePurchase:{ status:"CONTABILIZADO",syncFlow:"SUPPLIER_FINANCE_V2" },syncFlow:"SUPPLIER_FINANCE_V2"
    }));
    const sourceIds=new Set(canonical.map(item=>String(item.sourceId || "")));
    const merged=[...canonical,...derivePayables().filter(item=>!sourceIds.has(String(item.purchaseId || "")))];
    return merged.filter(item => {
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
    const remote = requiresSupplierV2();
    const rows = remote ? [] : payments();
    return {
      id: uid("DRAFT"),
      paymentNumber: remote ? "Se asigna al confirmar" : nextPaymentNumber(rows),
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
      id: uid("DRAFT"),
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
      source: String(application.source || ""),
      state: String(application.state || ""),
      canonicalStatus: String(application.canonicalStatus || application.canonical_status || ""),
      companyId: String(application.companyId || application.company_id || ""),
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

  function activeCompanyIds() {
    return new Set([
      BlessERP.getSupplierFinanceV2Repository?.()?.activeCompanyUuid?.(),
      BlessERP.services?.companyContext?.activeCompanyId?.(),
      stateApi.state.db?.activeCompanyId
    ].map(value => String(value || "").trim()).filter(Boolean));
  }

  function canonicalPaymentPayable(payableId) {
    const id = String(payableId || "").trim();
    if (!id) return null;
    const portfolioRow = BlessERP.services?.portfolioReadV2?.row?.("ap", id);
    if (portfolioRow) return clone(portfolioRow);
    const lookup = BlessERP.services?.paymentCollectionReadV2?.snapshot?.()?.payment?.lookup;
    const lookupRow = (lookup?.items || []).find(item => String(item.id || "") === id);
    if (lookupRow) return clone(lookupRow);
    const supplierRow = (supplierV2()?.payables?.() || [])
      .find(item => String(item.id || item.payableId || "") === id);
    if (supplierRow) return clone(supplierRow);
    if (!requiresSupplierV2()) return payables().find(item => String(item.id || "") === id) || null;
    return null;
  }

  function validateApplications(applications = [], providerId = "") {
    const errors = [];
    applications.forEach((application, index) => {
      const row = index + 1;
      const payableId = String(application.payableId || "").trim();
      if (!payableId) {
        errors.push(`El documento ${row} no tiene una CxP canónica.`);
        return;
      }
      const payable = canonicalPaymentPayable(payableId);
      if (!payable) {
        errors.push(`El documento ${row} ya no existe en cartera.`);
        return;
      }
      const documentNumber = payable.documentNumber || application.documentNumber || row;
      const payableCompanyId = String(payable.companyId || payable.company_id || application.companyId || "");
      const companyIds = activeCompanyIds();
      if (payableCompanyId && companyIds.size && !companyIds.has(payableCompanyId)) {
        errors.push(`El documento ${documentNumber} pertenece a otra empresa.`);
      }
      const payableProviderId = String(payable.providerId || payable.provider_id || application.providerId || "");
      if (providerId && payableProviderId && payableProviderId !== String(providerId)) {
        errors.push(`El documento ${documentNumber} pertenece a otro proveedor.`);
      }
      const state = String(payable.state || "").toUpperCase();
      const canonicalStatus = String(payable.canonicalStatus || payable.canonical_status || payable.status || "").toUpperCase();
      const invalidState = state && !["PENDIENTE", "PARCIAL", "VENCIDO"].includes(state);
      const invalidCanonicalStatus = canonicalStatus && !["OPEN", "PARTIALLY_PAID"].includes(canonicalStatus);
      if (invalidState || invalidCanonicalStatus) {
        errors.push(`El documento ${documentNumber} ya no puede pagarse.`);
      }
      if (Number(payable.balance || 0) <= 0) {
        errors.push(`El documento ${documentNumber} no tiene saldo pendiente.`);
      }
      if (Number(application.amount || 0) < 0) {
        errors.push(`El valor aplicado al documento ${documentNumber} no puede ser negativo.`);
      }
      if (Number(application.amount || 0) > Number(payable.balance || 0)) {
        errors.push(`El valor aplicado al documento ${documentNumber} excede su saldo disponible.`);
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
    const appErrors = validateApplications(candidate.applications, candidate.providerId);
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

  function validatePaymentDraft(payment, options = {}) {
    const result = validatePayment(payment, options);
    return { ok: result.errors.length === 0, ...result };
  }

  function buildPaymentJournalEntry(payment, label = "") {
    const defaults = companyService.settings().defaultAccounts || {};
    const accountsPayable = chartService.findByCode(defaults.accountsPayableSuppliers);
    const paymentAccount = chartService.findByCode(payment.paymentAccountCode);
    const entry = journalService.emptyEntry();
    entry.accountingDate = payment.paymentDate;
    entry.accountingPeriod = journalService.accountingPeriodForDate?.(entry.accountingDate, entry.accountingPeriod)
      || String(entry.accountingDate || "").slice(0, 7)
      || entry.accountingPeriod;
    entry.concept = label || `Pago a proveedor ${payment.providerName}`;
    entry.originModule = "Pagos";
    entry.sourceDocument = payment.paymentNumber || payment.batchNumber || "";
    entry.externalReference = payment.reference || "";
    entry.observation = payment.observation || "";
    entry.lines = payment.applications
      .filter(item => Number(item.amount || 0) > 0)
      .map(application => {
        const contract = BlessERP.services?.purchaseAccountContract;
        const payableAccount = contract?.enabled() ? chartService.findByCode(contract.payableForDocument(application)) : accountsPayable;
        if (!payableAccount) throw new Error("PURCHASE_AP_ACCOUNT_REQUIRED: la obligación debe tener una cuenta CxP canónica válida.");
        return ({
        id: uid("JLN"),
        accountCode: payableAccount.code,
        accountName: payableAccount.name,
        debit: round2(application.amount),
        credit: 0,
        costCenter: "",
        auxiliary: payment.providerRuc || application.supplierRuc,
        lineDescription: `Pago de ${application.documentNumber}`,
        documentReference: application.documentNumber
      }); });
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

  async function savePayment(payment) {
    const { payment: candidate, errors } = validatePayment(payment, { forConfirm: false });
    if (errors.filter(error => !error.includes("Debe seleccionar la cuenta contable de pago")).length) return { ok: false, errors };
    const rows = payments();
    const index = rows.findIndex(item => item.id === candidate.id);
    candidate.id = candidate.id || uid("PAY");
    if (!candidate.paymentNumber) candidate.paymentNumber = nextPaymentNumber(rows);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    const ack = await BlessERP.services.confirmedOperationalWrite.commit('payments', candidate, {});
    return { ...ack, payment: clone(ack.serverRecord?.payload || candidate) };
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

  async function confirmPaymentV2(paymentId, options = {}) {
    if (!requiresSupplierV2()) return confirmPayment(paymentId);
    const current=payments().find(item=>String(item.id)===String(paymentId));
    if(!current) return { ok:false,errors:["Pago no encontrado."] };
    if(current.syncFlow==="SUPPLIER_FINANCE_V2" || current.status==="CONFIRMADO") return { ok:true,payment:clone(current),reused:true };
    const { payment:candidate,errors }=validatePayment(current,{ forConfirm:true });
    if(errors.length) return { ok:false,errors };
    const result=await supplierV2()?.registerPayment?.(candidate,options);
    return result || { ok:false,errors:["Servicio de pagos V2 no disponible."] };
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

  async function annulPaymentV2(paymentId, reason, options = {}) {
    const current=payments().find(item=>String(item.id)===String(paymentId));
    if(!current) return { ok:false,errors:["Pago no encontrado."] };
    if(current.syncFlow!=="SUPPLIER_FINANCE_V2") return annulPayment(paymentId);
    const result=await supplierV2()?.reversePayment?.(current.paymentId || current.id,reason,options);
    return result || { ok:false,errors:["Servicio de reversión V2 no disponible."] };
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
    return BlessERP.services.confirmedOperationalWrite.unavailable("saveBatch");
  }

  function confirmBatch(batchId) {
    return BlessERP.services.confirmedOperationalWrite.unavailable("confirmBatch");
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
    providerIdentity,
    upsertProviderFromPurchase,
    upsertProviderFromPurchaseV2,
    findProviderById,
    findProviderByTaxId,
    saveProvider,
    saveProviderV2,
    toggleProviderStatus,
    toggleProviderStatusV2,
    payables,
    providerPortfolioSummary,
    activePaymentAccountOptions,
    payments,
    paymentBatches,
    paymentsByPurchase,
    pendingPayablesByProvider,
    emptyPayment,
    buildPaymentJournalEntry,
    emptyBatch,
    savePayment,
    confirmPayment,
    confirmPaymentV2,
    annulPayment,
    annulPaymentV2,
    saveBatch,
    confirmBatch,
    annulBatch,
    paymentHistoryForPurchase,
    validatePaymentDraft,
    normalizePayment,
    normalizeBatch
  };
})();
