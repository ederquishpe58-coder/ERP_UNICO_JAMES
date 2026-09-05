(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));

  function repository() { return BlessERP.getSupplierFinanceV2Repository?.(); }
  function financeState() {
    const db = BlessERP.state?.state?.db || {};
    db.supplierV2 = db.supplierV2 || {};
    return db.supplierV2;
  }
  function rows(key) { return clone(financeState()[key] || []); }
  function entityPayloads(result, entity) {
    return (result?.records || []).filter(record => record.entity === entity).map(record => clone(record.payload || {}));
  }
  function first(result, entity) { return entityPayloads(result, entity)[0] || null; }
  function normalizedTaxId(value) { return String(value || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, ""); }
  function canonicalUuid(value) {
    const candidate = String(value || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
      ? candidate
      : "";
  }

  const lazyProviders = { companyId: "", loaded: false, rows: [], promise: null };
  function activeCompanyId() { return String(repository()?.activeCompanyUuid?.() || ""); }
  function resetLazyProviders() {
    const companyId = activeCompanyId();
    if (lazyProviders.companyId === companyId) return companyId;
    lazyProviders.companyId = companyId;
    lazyProviders.loaded = false;
    lazyProviders.rows = [];
    lazyProviders.promise = null;
    return companyId;
  }
  function mergeLazyProviders(incoming = []) {
    resetLazyProviders();
    const merged = new Map();
    [...lazyProviders.rows, ...(incoming || [])].forEach(item => {
      const id = String(item?.id || item?.providerId || "");
      const taxId = normalizedTaxId(item?.taxId || item?.ruc);
      if (!id || !taxId) return;
      const current = merged.get(id);
      if (!current || Number(item?.version || 0) >= Number(current?.version || 0)) merged.set(id, clone(item));
    });
    lazyProviders.rows = [...merged.values()];
    return clone(lazyProviders.rows);
  }

  function providers() {
    resetLazyProviders();
    const combined = new Map();
    [...lazyProviders.rows, ...rows("providers")].forEach(item => {
      const id = String(item?.id || item?.providerId || "");
      const current = combined.get(id);
      if (id && (!current || Number(item?.version || 0) >= Number(current?.version || 0))) combined.set(id, clone(item));
    });
    return [...combined.values()];
  }
  function canonicalPurchase(item = {}) {
    const voucherTypes = {
      INVOICE: "factura",
      PURCHASE_SETTLEMENT: "liquidacion_compra",
      CREDIT_NOTE: "nota_credito",
      SALES_NOTE: "nota_venta",
      OPENING_BALANCE: "saldo_inicial",
      OTHER: "otro"
    };
    const serverStatus = String(item.status || "").toUpperCase();
    const retentionDecision = String(item.retentionDecision || "PENDIENTE").toUpperCase();
    const statuses = { DRAFT: "BORRADOR", REVIEWED: "REVISADO", POSTED: "CONTABILIZADO", CANCELLED: "ANULADO" };
    const status = serverStatus === "POSTED" && retentionDecision === "APLICAR"
      ? "PENDIENTE_RETENCION"
      : statuses[serverStatus] || item.status;
    return {
      ...item,
      id: String(item.id || item.purchaseDocumentId || ""),
      voucherType: voucherTypes[String(item.voucherType || "").toUpperCase()] || item.voucherType,
      status,
      retentionDecision,
      journalEntryId: item.journalEntryId || "",
      syncFlow: "SUPPLIER_FINANCE_V2",
      remoteConfirmed: true
    };
  }
  function purchases() {
    return rows("purchaseDocuments").map(canonicalPurchase);
  }
  function payables() { return rows("payables"); }
  function payments() { return rows("payments"); }
  function settlements() { return rows("settlements"); }
  function receptionCosts() { return rows("receptionCosts"); }

  function findProvider(candidate = {}) {
    const id = String(candidate.providerId || candidate.supplierId || candidate.id || "");
    const taxId = normalizedTaxId(candidate.taxId || candidate.ruc || candidate.supplierRuc);
    return providers().find(row => String(row.id || row.providerId) === id || (taxId && normalizedTaxId(row.taxId || row.ruc) === taxId)) || null;
  }

  function providerPayload(candidate = {}, source = "MANUAL") {
    const typeMap = { comercial:"EXTERNAL",floricola:"PRODUCER",productor:"PRODUCER",socio:"PARTNER",servicios:"SERVICE",transporte:"TRANSPORT",insumos:"SUPPLIES",otros:"OTHER" };
    return {
      // Los identificadores legacy (por ejemplo PRV-0001) nunca se envían a
      // columnas UUID. El servidor reutiliza el proveedor canónico por RUC/CI.
      providerId: canonicalUuid(candidate.providerId || candidate.id),
      taxId: normalizedTaxId(candidate.taxId || candidate.ruc || candidate.supplierRuc),
      legalName: String(candidate.legalName || candidate.name || candidate.supplierName || "").trim(),
      commercialName: String(candidate.commercialName || candidate.supplierCommercialName || "").trim(),
      providerType: typeMap[String(candidate.providerType || "").toLowerCase()] || String(candidate.providerType || "OTHER").toUpperCase(),
      settlementMethod: String(candidate.settlementMethod || "PURCHASE_DOCUMENT").toUpperCase(),
      contact: String(candidate.contact || candidate.contactName || ""), phone: String(candidate.phone || candidate.supplierPhone || ""),
      email: String(candidate.email || candidate.supplierEmail || ""), address: String(candidate.address || candidate.supplierAddress || ""),
      paymentCondition: String(candidate.paymentCondition || ""), creditDays: Number(candidate.creditDays || 0),
      currencyCode: String(candidate.currencyCode || "USD"), payableAccountCode: String(candidate.payableAccountCode || ""),
      advanceAccountCode: String(candidate.advanceAccountCode || ""), operationalSupplierId: String(candidate.operationalSupplierId || ""),
      status: String(candidate.status || "activo"), profileState: String(candidate.profileState || "COMPLETE"),
      source, observation: String(candidate.observation || candidate.notes || "")
    };
  }

  async function upsertProvider(candidate = {}, options = {}) {
    const repo = repository();
    if (!repo) return { ok:false,errors:["Repositorio de proveedores V2 no disponible."] };
    const result = await repo.upsertProvider(providerPayload(candidate, options.source || candidate.source || "MANUAL"), options);
    return result.ok ? { ...result, provider:first(result,"supplier_providers") } : { ...result, errors:result.errors || [result.message || "Proveedor no confirmado."] };
  }

  async function resolveProvidersByTaxIds(taxIds = []) {
    const repo = repository();
    if (!repo?.resolveProvidersByTaxIds) {
      return { ok: false, rows: [], errors: ["Consulta de proveedores V2 no disponible."] };
    }
    const result = await repo.resolveProvidersByTaxIds(taxIds);
    if (result.ok) {
      mergeLazyProviders(result.rows || []);
      return result;
    }
    return { ...result, rows: [], errors: result.errors || [result.message || "No se pudieron consultar los proveedores."] };
  }

  async function resolveProvider(candidate = {}) {
    const existing = findProvider(candidate);
    if (existing) return { ok: true, provider: existing, rows: [existing], mode: "MEMORY_CACHE", companyId: activeCompanyId() };
    const repo = repository();
    if (!repo?.resolveProvider) return { ok: false, provider: null, rows: [], errors: ["Consulta canónica de proveedor no disponible."] };
    const result = await repo.resolveProvider(candidate);
    if (!result.ok) return { ...result, provider: null, rows: [], errors: result.errors || [result.message || "No se pudo consultar el proveedor."] };
    mergeLazyProviders(result.rows || [result.provider]);
    const provider = findProvider({ providerId: result.provider?.id, taxId: result.provider?.taxId });
    return { ...result, provider, rows: provider ? [provider] : [] };
  }

  async function hydrateProviderCatalog(options = {}) {
    resetLazyProviders();
    if (lazyProviders.loaded && options.force !== true) {
      return { ok: true, rows: providers(), fetchedRows: 0, mode: "MEMORY_CACHE", companyId: activeCompanyId(), paginated: true };
    }
    if (lazyProviders.promise) return lazyProviders.promise;
    const repo = repository();
    if (!repo?.providerCatalog) return { ok: false, rows: [], fetchedRows: 0, errors: ["Catálogo canónico de proveedores no disponible."] };
    lazyProviders.promise = (async () => {
      const result = await repo.providerCatalog(options);
      if (!result.ok) return { ...result, fetchedRows: 0, errors: result.errors || [result.message || "No se pudo cargar el catálogo de proveedores."] };
      mergeLazyProviders(result.rows || []);
      lazyProviders.loaded = true;
      return { ...result, rows: providers(), fetchedRows: Number(result.rows?.length || 0) };
    })().finally(() => { lazyProviders.promise = null; });
    return lazyProviders.promise;
  }

  function purchaseSourceKey(purchase = {}) {
    return String(purchase.duplicateKey || [normalizedTaxId(purchase.supplierRuc),purchase.voucherType,purchase.documentNumber || purchase.externalDocumentNumber || purchase.accessKey].join("|")).trim();
  }

  function purchasePayload(purchase = {}, provider = {}) {
    const journal = BlessERP.services?.purchases?.buildPurchaseJournalEntry?.(purchase) || {};
    const defaults = BlessERP.services?.companySettings?.settings?.().defaultAccounts || {};
    return {
      providerId:canonicalUuid(provider.id || provider.providerId || purchase.supplierId),
      provider:providerPayload({ ...purchase, ...provider, taxId:purchase.supplierRuc || provider.taxId,
        legalName:purchase.supplierName || provider.legalName || provider.name }, purchase.source || "PURCHASE"),
      sourceKey:purchaseSourceKey(purchase),
      documentType:({factura:"INVOICE",liquidacion_compra:"PURCHASE_SETTLEMENT",nota_credito:"CREDIT_NOTE",nota_venta:"SALES_NOTE",saldo_inicial:"OPENING_BALANCE"})[purchase.voucherType] || "OTHER",
      documentNumber:String(purchase.documentNumber || purchase.externalDocumentNumber || ""), issueDate:purchase.issueDate,
      accountingDate:purchase.accountingDate || purchase.issueDate, dueDate:purchase.dueDate || purchase.issueDate,
      currencyCode:purchase.currencyCode || "USD", exchangeRate:Number(purchase.exchangeRate || 1),
      settlementMode:String(purchase.settlementMode || "CXP").toUpperCase() === "CONTADO" ? "CASH" : "CXP",
      paymentAccountCode:String(purchase.paymentAccountCode || ""),
      source:purchase.source || "MANUAL", sourcePayload:{ authorizationNumber:purchase.authorizationNumber || "",accessKey:purchase.accessKey || "",
        ...(BlessERP.services?.purchaseAccountContract?.enabled() ? { purchaseAccountContract: "BLESS_PURCHASE_V1", vatCreditTreatment: purchase.vatCreditTreatment || "PENDING", taxSupportCode: purchase.taxSupportCode || "" } : {}) },
      retentionDecision:String(purchase.retentionDecision || "PENDIENTE").toUpperCase(),
      retentionDecisionCode:String(purchase.retentionDecisionCode || (purchase.retentionDecision === "NO_SUJETO_332" ? "332" : "")),
      retentionDecisionReason:String(purchase.retentionDecisionReason || ""),
      legacyDraftId:String(purchase.id || ""), payableAccountCode:String(BlessERP.services?.purchaseAccountContract?.enabled() ? BlessERP.services.purchaseAccountContract.payable(purchase) : (purchase.payableAccountCode || defaults.accountsPayableSuppliers || provider.payableAccountCode || "")),
      totals:{ subtotal:Number(purchase.totals?.subtotal ?? purchase.totals?.base0 ?? 0)+Number(purchase.totals?.baseIva || 0),
        taxTotal:Number(purchase.totals?.iva || 0),discountTotal:Number(purchase.totals?.discount || 0),
        withholdingTotal:Number(purchase.totals?.withholdingsTotal || 0),total:Number(purchase.totals?.total || 0) },
      lines:(purchase.lines || []).map(line=>({ productCode:line.productCode || "",description:line.description || "Compra",quantity:Number(line.quantity || 0),
        unit:line.inventoryUnit || line.unit || "",unitPrice:Number(line.unitPrice || 0),taxableBase:Number(line.taxableBase || 0),vatRate:Number(line.vatRate || 0),
        vatValue:Number(line.vatValue || 0),vatCode:line.vatCode || "",vatParameterId:line.vatParameterId || "",vatRateAuthority:line.vatRateAuthority || "",discount:Number(line.discount || 0),totalLine:Number(line.totalLine || 0),accountCode:line.accountCode || "",
        costCenter:line.costCenter || "",lineType:line.lineType || "EXPENSE",receptionId:line.receptionId || "",receptionItemId:line.receptionItemId || "",
        quantityType:String(line.quantityType || "STEM").toUpperCase(),ruleSnapshot:clone(line.ruleSnapshot || {}) })),
      journal:{ accountingDate:journal.accountingDate,concept:journal.concept,originModule:journal.originModule,sourceDocument:journal.sourceDocument,
        externalReference:journal.externalReference,currencyCode:journal.currencyCode || "USD",exchangeRate:Number(journal.exchangeRate || 1),
        observation:journal.observation || "",lines:(journal.lines || []).map(line=>({accountCode:line.accountCode,debit:Number(line.debit || 0),credit:Number(line.credit || 0),
          costCenter:line.costCenter || "",auxiliary:line.auxiliary || "",lineDescription:line.lineDescription || "",documentReference:line.documentReference || ""})) }
    };
  }

  async function postPurchase(purchase = {}, options = {}) {
    const provider = findProvider({ providerId:purchase.supplierId,taxId:purchase.supplierRuc }) || {};
    const result = await repository().postPurchase(purchasePayload(purchase,provider),options);
    if (BlessERP.services?.purchaseAccountContract?.enabled() && result?.ok && (!first(result,"supplier_purchase_documents") || !first(result,"financial_journal_entries"))) return { ok:false,errors:["Supabase no confirmó compra y asiento; no se informó éxito."] };
    return result.ok ? { ...result,purchase:canonicalPurchase(first(result,"supplier_purchase_documents") || {}),payable:first(result,"supplier_payables"),
      entry:first(result,"financial_journal_entries") } : { ...result,errors:result.errors || [result.message || "Compra no confirmada."] };
  }

  async function reversePurchase(purchaseDocumentId, reason, options = {}) {
    const result = await repository()?.reversePurchase(purchaseDocumentId, reason, options);
    return result?.ok ? {
      ...result,
      purchase: first(result, "supplier_purchase_documents"),
      payable: first(result, "supplier_payables"),
      entries: entityPayloads(result, "financial_journal_entries")
    } : { ...(result || {}), ok: false, errors: result?.errors || [result?.message || "Reversión de compra no confirmada."] };
  }

  function paymentPayload(payment = {}) {
    const journal = BlessERP.services?.portfolios?.buildPaymentJournalEntry?.(payment) || {};
    const provider = findProvider({ providerId:payment.providerId,taxId:payment.providerRuc });
    return {
      providerId:String(provider?.id || provider?.providerId || payment.providerId || ""),clientReferenceId:String(payment.id || ""),
      paymentDate:payment.paymentDate,paymentMethod:payment.paymentMethod || "OTHER",reference:payment.reference || "",
      currencyCode:payment.currencyCode || "USD",exchangeRate:Number(payment.exchangeRate || 1),paymentAccountCode:payment.paymentAccountCode || "",
      total:Number(payment.total || 0),applications:(payment.applications || []).filter(item=>Number(item.amount || 0)>0)
        .map(item=>({ payableId:String(item.payableId || ""),amount:Number(item.amount || 0) })),
      journal:{ accountingDate:journal.accountingDate,concept:journal.concept,originModule:journal.originModule,sourceDocument:journal.sourceDocument,
        externalReference:journal.externalReference,currencyCode:journal.currencyCode || "USD",exchangeRate:Number(journal.exchangeRate || 1),observation:journal.observation || "",
        lines:(journal.lines || []).map(line=>({accountCode:line.accountCode,debit:Number(line.debit || 0),credit:Number(line.credit || 0),costCenter:line.costCenter || "",
          auxiliary:line.auxiliary || "",lineDescription:line.lineDescription || "",documentReference:line.documentReference || ""})) }
    };
  }

  async function registerPayment(payment = {}, options = {}) {
    const payload = paymentPayload(payment);
    if (!payload.applications.length || payload.applications.some(item => !canonicalUuid(item.payableId))) {
      return { ok:false,errors:["El pago contiene una obligación histórica que aún no tiene CxP canónica en Supabase."] };
    }
    const result = await repository()?.registerPayment(payload,options);
    return result?.ok ? { ...result,payment:first(result,"supplier_payments"),entry:first(result,"financial_journal_entries") }
      : { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "Pago no confirmado."] };
  }

  async function reversePayment(paymentId, reason, options = {}) {
    const result = await repository()?.reversePayment(paymentId,reason,options);
    return result?.ok ? { ...result,payment:first(result,"supplier_payments"),entries:entityPayloads(result,"financial_journal_entries") }
      : { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "Reversión no confirmada."] };
  }

  async function createSettlement(payload = {}, options = {}) {
    const result = await repository()?.createSettlement(payload,options);
    return result?.ok ? { ...result,settlement:first(result,"supplier_settlements"),payable:first(result,"supplier_payables"),entry:first(result,"financial_journal_entries") }
      : { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "Liquidación no confirmada."] };
  }

  async function reverseSettlement(settlementId, reason, options = {}) {
    const result = await repository()?.reverseSettlement(settlementId, reason, options);
    return result?.ok ? { ...result, settlement:first(result,"supplier_settlements"), payable:first(result,"supplier_payables"),
      entries:entityPayloads(result,"financial_journal_entries") }
      : { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "Reversión de liquidación no confirmada."] };
  }

  function resolveReceptionProvider(reception = {}) {
    const byId=findProvider({providerId:reception.providerId}); if(byId) return byId;
    const supplier=String(reception.supplier || "").trim().toUpperCase();
    return providers().find(row=>[row.name,row.legalName,row.commercialName].some(value=>String(value || "").trim().toUpperCase()===supplier)) || null;
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.supplierFinanceV2 = Object.freeze({
    createSettlement,findProvider,hydrateProviderCatalog,payables,payments,postPurchase,providers,providerBalances:()=>repository()?.providerBalances(),
    purchases,receptionCosts,receptionCostSummary:filters=>repository()?.receptionCostSummary(filters),registerPayment,resolveProvider,resolveProvidersByTaxIds,resolveReceptionProvider,
    reversePayment,reversePurchase,reverseSettlement,settlements,upsertProvider
  });
  BlessERP.domainDataHydrators = BlessERP.domainDataHydrators || {};
  BlessERP.domainDataHydrators["purchases-catalog"] = options => hydrateProviderCatalog(options);
})();
