(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;
  const journalService = BlessERP.services.journal;
  const taxConfigService = BlessERP.services.taxConfig;
  const adminService = BlessERP.services.adminConfig;

  const purchaseStatuses = [
    "BORRADOR",
    "XML_LEIDO",
    "PENDIENTE_CLASIFICACION",
    "PENDIENTE_RETENCION",
    "CONTABILIZADO",
    "RETENIDO",
    "ANULADO"
  ];

  const importStatuses = ["LEIDO", "VALIDO", "DUPLICADO", "ERROR_XML", "PENDIENTE_CUENTA", "IMPORTADO"];
  const retentionStatuses = ["BORRADOR", "CONFIRMADA", "LISTA_PARA_AUTORIZAR", "AUTORIZADA", "ANULADA"];
  const retentionDecisions = ["PENDIENTE", "APLICAR", "NO_SUJETO_332"];
  const voucherTypes = [
    { code: "factura", label: "Factura" },
    { code: "liquidacion_compra", label: "Liquidacion de compra" },
    { code: "documento_exterior", label: "Documento del exterior" },
    { code: "saldo_inicial", label: "Saldo inicial" },
    { code: "nota_credito", label: "Nota de credito" },
    { code: "nota_debito", label: "Nota de debito" }
  ];
  const paymentMethods = [
    { code: "01", label: "Sin utilizacion del sistema financiero" },
    { code: "15", label: "Compensacion de deudas" },
    { code: "16", label: "Tarjeta de debito" },
    { code: "17", label: "Dinero electronico" },
    { code: "18", label: "Tarjeta prepago" },
    { code: "19", label: "Tarjeta de credito" },
    { code: "20", label: "Otros con utilizacion del sistema financiero" },
    { code: "21", label: "Endoso de titulos" }
  ];
  const lineTypes = [
    "gasto",
    "inventario",
    "activo",
    "servicio",
    "material empaque",
    "suministro",
    "quimico",
    "fertilizante"
  ];
  const inventoryPurchaseTypeCategories = {
    INVENTARIO_EMPAQUE: ["MATERIAL_EMPAQUE"],
    INVENTARIO_SUMINISTROS: ["SUMINISTRO", "QUIMICO", "FERTILIZANTE", "HERRAMIENTA", "MATERIAL_BODEGA", "OTRO"],
    AGRICOLA: ["SUMINISTRO", "QUIMICO", "FERTILIZANTE"],
    MATERIAL_EMPAQUE: ["MATERIAL_EMPAQUE"],
    SUMINISTRO: ["SUMINISTRO"],
    QUIMICO: ["QUIMICO"],
    FERTILIZANTE: ["FERTILIZANTE"],
    HERRAMIENTA: ["HERRAMIENTA"],
    MATERIAL_BODEGA: ["MATERIAL_BODEGA"]
  };
  const purchaseTypeAliases = {
    ACTIVO_PPE: "ACTIVO_FIJO",
    COSTOS: "COSTO"
  };

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function vatPurchaseAccountCode(rate, defaults = companyService.settings().defaultAccounts || {}) {
    return BlessERP.accountingPlanBlessV1?.vatPurchaseAccountCode?.(rate, defaults)
      || defaults.vatPurchases
      || "";
  }

  function vatGroups(lines = [], defaults = companyService.settings().defaultAccounts || {}) {
    const groups = new Map();
    (lines || []).forEach(line => {
      const amount = round2(line.vatValue || 0);
      if (amount <= 0) return;
      const rate = Number(line.vatRate || 0);
      const accountCode = vatPurchaseAccountCode(rate, defaults);
      const key = `${accountCode}|${rate}`;
      const current = groups.get(key) || { accountCode, rate, amount: 0 };
      current.amount = round2(current.amount + amount);
      groups.set(key, current);
    });
    return [...groups.values()];
  }

  function pad9(value) {
    const raw = String(value || "").replace(/\D/g, "");
    return raw.padStart(9, "0").slice(-9);
  }

  function digits(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function keywordsFromText(value) {
    return normalizeText(value)
      .split(" ")
      .filter(word => word.length >= 4)
      .slice(0, 6);
  }

  function currentUser() {
    return adminService?.activeUser?.() || stateApi.state.db.session?.activeUser || { id: "demo", name: "Usuario demo", role: "Administrador" };
  }

  function companyAllows(capability, fallback = true) {
    const companyContext = BlessERP.services?.companyContext;
    return companyContext?.hasCapability ? companyContext.hasCapability(capability) : fallback;
  }

  function retentionCapabilityError() {
    return {
      ok: false,
      code: "COMPANY_CAPABILITY_DENIED",
      errors: ["La empresa activa no emite retenciones. Solo puede registrar retenciones recibidas."]
    };
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

  function inventoryApi() {
    return BlessERP.services.inventory || {};
  }

  function saveList(key, value) {
    stateApi.state.db[key] = value;
    stateApi.saveDb();
  }

  function providers() {
    const canonical = supplierV2()?.providers?.() || [];
    const byId = new Set(canonical.map(item => String(item.id || item.providerId || "")));
    const byTax = new Set(canonical.map(item => String(item.taxId || item.ruc || "").replace(/\W/g, "")));
    return [...canonical, ...cloneList("providers").filter(item => !byId.has(String(item.id || "")) && !byTax.has(String(item.taxId || item.ruc || "").replace(/\W/g, "")))];
  }

  function purchases() {
    const canonical = supplierV2()?.purchases?.() || [];
    const replacedDrafts = new Set(canonical.map(item => String(item.legacyDraftId || "")).filter(Boolean));
    const keys = new Set(canonical.map(item => String(item.sourceKey || "")).filter(Boolean));
    const legacy = cloneList("purchases").filter(item => !replacedDrafts.has(String(item.id || "")) && !keys.has(duplicateKeyForPurchase(item)));
    return [...canonical, ...legacy];
  }

  function purchasePayables() {
    const canonical = supplierV2()?.payables?.() || [];
    const ids = new Set(canonical.map(item => String(item.id || item.payableId || "")));
    return [...canonical, ...cloneList("purchasePayables").filter(item => !ids.has(String(item.id || "")))];
  }

  function taxSupports() {
    return cloneList("taxSupports");
  }

  function purchaseTypes() {
    return cloneList("purchaseTypes");
  }

  function toLegacyWithholding(item) {
    if (!item) return null;
    return {
      ...clone(item),
      code: item.sriCode || item.internalCode || "",
      status: String(item.status || "").replace(/^./, char => char.toUpperCase())
    };
  }

  function withholdingCatalog(type = "", options = {}) {
    if (!companyAllows("purchases.issueWithholdings")) return [];
    const priority = String(type || "").toUpperCase() === "IVA"
      ? ["3", "1", "10", "11", "2", "9"]
      : ["312C", "312", "303", "304", "303A", "3482", "340", "311", "501", "502", "511", "520"];
    const rows = taxConfigService
      .retentions({ taxType: type || "", appliesTo: "compra", onlyActive: true })
      .map(toLegacyWithholding)
      .sort((left, right) => {
        const leftIndex = priority.indexOf(String(left.sriCode || left.code || ""));
        const rightIndex = priority.indexOf(String(right.sriCode || right.code || ""));
        if (leftIndex >= 0 || rightIndex >= 0) {
          if (leftIndex < 0) return 1;
          if (rightIndex < 0) return -1;
          return leftIndex - rightIndex;
        }
        return String(left.sriCode || left.code || "").localeCompare(String(right.sriCode || right.code || ""));
      });
    return options.issuableOnly
      ? rows.filter(item => Number(item.percentage || 0) > 0 && String(item.sriCode || item.code || "") !== "332")
      : rows;
  }

  function purchaseMemory() {
    return cloneList("purchaseMemory");
  }

  function issuedWithholdings() {
    if (!companyAllows("purchases.issueWithholdings")) return [];
    return cloneList("issuedWithholdings").map(normalizeIssuedWithholding);
  }

  function findProviderById(providerId) {
    return providers().find(item => item.id === providerId);
  }

  function findProviderByRuc(ruc) {
    const identity = String(ruc || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
    return providers().find(item => String(item.ruc || item.taxId || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "") === identity);
  }

  function taxSupportByCode(code) {
    return taxSupports().find(item => item.code === code);
  }

  function canonicalPurchaseTypeCode(code = "") {
    const normalized = String(code || "").trim().toUpperCase();
    return purchaseTypeAliases[normalized] || normalized;
  }

  function purchaseTypeByCode(code) {
    const normalized = canonicalPurchaseTypeCode(code);
    return purchaseTypes().find(item => item.code === normalized);
  }

  function withholdingByCode(code) {
    if (!companyAllows("purchases.issueWithholdings")) return null;
    return toLegacyWithholding(taxConfigService.findRetentionByCode(code));
  }

  function voucherLabel(code) {
    return voucherTypes.find(item => item.code === code)?.label || code;
  }

  function purchaseTypeLabel(code) {
    return purchaseTypeByCode(code)?.label || code;
  }

  function purchaseTypeUsesInventory(code = "") {
    if (!companyAllows("inventory.materials")) return false;
    return Boolean(purchaseTypeByCode(code)?.affectsInventory);
  }

  function inventoryCategoriesForPurchaseType(code = "") {
    const normalized = canonicalPurchaseTypeCode(code);
    return [...new Set(inventoryPurchaseTypeCategories[normalized] || [])];
  }

  function inventoryCategoryLabel(code = "") {
    const labels = inventoryApi().categoryLabels || {};
    return labels[code] || code;
  }

  function inventoryItemsForPurchaseType(code = "") {
    const items = inventoryApi().items?.({ status: "activo" }) || [];
    const categories = inventoryCategoriesForPurchaseType(code);
    if (!categories.length) return items;
    return items.filter(item => categories.includes(String(item.category || "").toUpperCase()));
  }

  function lineTypeForInventoryCategory(category = "") {
    switch (String(category || "").toUpperCase()) {
      case "MATERIAL_EMPAQUE":
        return "material empaque";
      case "QUIMICO":
        return "quimico";
      case "FERTILIZANTE":
        return "fertilizante";
      case "SUMINISTRO":
        return "suministro";
      default:
        return "inventario";
    }
  }

  function inventoryItemForLine(line = {}, purchaseType = "") {
    const inventory = inventoryApi();
    const available = inventoryItemsForPurchaseType(purchaseType);
    const selectedById = line.inventoryItemId ? inventory.findItemById?.(line.inventoryItemId) : null;
    if (selectedById && (!available.length || available.some(item => item.id === selectedById.id))) return selectedById;
    const selectedByCode = line.productCode ? inventory.findItemByCode?.(line.productCode) : null;
    if (selectedByCode && (!available.length || available.some(item => item.id === selectedByCode.id))) return selectedByCode;
    const selectedByName = normalizeText(line.description || "");
    if (!selectedByName) return null;
    return available.find(item => normalizeText(item.name) === selectedByName) || null;
  }

  function applyInventoryDefaults(rawLine = {}, purchaseType = "") {
    const line = {
      ...clone(rawLine || {}),
      inventoryItemId: String(rawLine?.inventoryItemId || "").trim(),
      inventoryCategory: String(rawLine?.inventoryCategory || "").trim().toUpperCase(),
      inventoryUnit: String(rawLine?.inventoryUnit || "").trim().toLowerCase()
    };
    if (!purchaseTypeUsesInventory(purchaseType)) return line;

    const item = inventoryItemForLine(line, purchaseType);
    const typeConfig = purchaseTypeByCode(purchaseType);
    if (!item) {
      if (!line.suggestedAccountCode) line.suggestedAccountCode = String(typeConfig?.suggestedAccountCode || "").trim();
      if (!line.lineType || line.lineType === "gasto") line.lineType = "inventario";
      return line;
    }

    const linkedAccountCode = String(item.inventoryAccountCode || typeConfig?.suggestedAccountCode || "").trim();
    line.inventoryItemId = item.id;
    line.inventoryCategory = String(item.category || "").trim().toUpperCase();
    line.inventoryUnit = String(item.unit || "").trim().toLowerCase();
    line.productCode = String(item.code || "").trim().toUpperCase();
    line.description = String(item.name || "").trim();
    line.accountCode = linkedAccountCode;
    line.accountName = linkedAccountCode ? chartService.findByCode(linkedAccountCode)?.name || line.accountName || "" : "";
    line.suggestedAccountCode = linkedAccountCode;
    line.suggestionMode = linkedAccountCode ? "Automatico" : "Manual";
    if (!String(line.costCenter || "").trim()) line.costCenter = String(item.defaultCostCenter || "").trim().toUpperCase();
    line.lineType = lineTypeForInventoryCategory(item.category);
    return line;
  }

  function buildDocumentNumber(input) {
    if (["documento_exterior", "saldo_inicial"].includes(String(input.voucherType || "").trim())) {
      return String(input.externalDocumentNumber || "").trim().toUpperCase();
    }
    const estab = String(input.estab || "").padStart(3, "0");
    const ptoEmi = String(input.ptoEmi || "").padStart(3, "0");
    const sequential = pad9(input.sequential || "");
    return estab && ptoEmi && sequential ? `${estab}-${ptoEmi}-${sequential}` : "";
  }

  function duplicateKeyForPurchase(purchase) {
    if (["documento_exterior", "saldo_inicial"].includes(purchase.voucherType)) {
      const externalNumber = String(purchase.externalDocumentNumber || purchase.documentNumber || "").trim().toUpperCase();
      if (!purchase.supplierRuc || !externalNumber) return "";
      return `${purchase.supplierRuc}|${purchase.voucherType}|${externalNumber}`;
    }
    const series = `${String(purchase.estab || "").padStart(3, "0")}${String(purchase.ptoEmi || "").padStart(3, "0")}`;
    const authorization = purchase.authorizationNumber || purchase.accessKey || "";
    if (!purchase.supplierRuc || !purchase.voucherType || !series.trim() || !purchase.sequential || !authorization) return "";
    return `${purchase.supplierRuc}|${purchase.voucherType}|${series}|${pad9(purchase.sequential)}|${authorization}`;
  }

  function nextSequential(estab = "001", ptoEmi = "001") {
    const rows = purchases().filter(item => String(item.estab || "001") === estab && String(item.ptoEmi || "001") === ptoEmi);
    const max = rows.reduce((acc, item) => Math.max(acc, Number(String(item.sequential || "0").replace(/\D/g, "") || 0)), 0);
    return pad9(max + 1);
  }

  function emptyLine() {
    return {
      id: uid("PLN"),
      inventoryItemId: "",
      inventoryCategory: "",
      inventoryUnit: "",
      productCode: "",
      description: "",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      taxableBase: 0,
      vatRate: 15,
      vatCode: "4",
      vatCategory: "TARIFA",
      vatValue: 0,
      totalLine: 0,
      accountCode: "",
      accountName: "",
      costCenter: "",
      lineType: "gasto",
      suggestionMode: "Manual",
      suggestedAccountCode: ""
    };
  }

  function emptyPurchase() {
    const settings = companyService.settings();
    return {
      id: "",
      source: "MANUAL",
      importStatus: "LEIDO",
      supplierId: "",
      supplierName: "",
      supplierRuc: "",
      supplierAddress: "",
      supplierCommercialName: "",
      supplierEmail: "",
      supplierPhone: "",
      issueDate: today(),
      accountingDate: today(),
      dueDate: "",
      voucherType: "factura",
      externalDocumentNumber: "",
      estab: settings.mainEstablishment || "001",
      ptoEmi: settings.mainEmissionPoint || "001",
      sequential: nextSequential(settings.mainEstablishment || "001", settings.mainEmissionPoint || "001"),
      authorizationNumber: "",
      accessKey: "",
      taxSupportCode: "02",
      purchaseType: "GASTO",
      paymentMethod: "",
      settlementMode: "CXP",
      paymentAccountCode: "",
      observation: "",
      status: "BORRADOR",
      retentionStatus: "Pendiente de decision",
      retentionDecision: "PENDIENTE",
      retentionDecisionCode: "",
      retentionDecisionReason: "",
      retentionDecisionBy: "",
      retentionDecisionById: "",
      retentionDecisionAt: "",
      payableId: "",
      journalEntryId: "",
      journalEntryNumber: "",
      documentNumber: "",
      duplicateKey: "",
      lines: [emptyLine()],
      totals: {
        base0: 0,
        baseIva: 0,
        iva: 0,
        total: 0,
        withholdingsTotal: 0,
        balanceDue: 0
      }
    };
  }

  function emptyRetentionLine(taxType = "RENTA", purchase = null) {
    const normalizedType = String(taxType || "RENTA").trim().toUpperCase() === "IVA" ? "IVA" : "RENTA";
    const purchaseBase = normalizedType === "IVA"
      ? Number(purchase?.totals?.iva || 0)
      : Number(purchase?.totals?.base0 || 0) + Number(purchase?.totals?.baseIva || 0);
    return {
      id: uid("RTL"),
      taxType: normalizedType,
      code: "",
      sriCode: "",
      parameterId: "",
      description: "",
      baseAmount: round2(purchaseBase),
      percentage: 0,
      retainedAmount: 0,
      payableAccountCode: ""
    };
  }

  function emptyRetentionDraft(purchaseId = "") {
    const purchase = purchases().find(item => item.id === purchaseId);
    return {
      id: "",
      purchaseId,
      supplierName: purchase?.supplierName || "",
      supplierRuc: purchase?.supplierRuc || "",
      retentionDate: today(),
      draftNumber: `RET-BOR-${String(cloneList("issuedWithholdings").length + 1).padStart(6, "0")}`,
      purchaseDocumentNumber: purchase?.documentNumber || "",
      rentCode: "",
      rentSriCode: "",
      rentParameterId: "",
      rentDescription: "",
      rentBaseAmount: purchase ? round2(Number(purchase.totals.base0 || 0) + Number(purchase.totals.baseIva || 0)) : 0,
      rentPercentage: 0,
      rentRetainedAmount: 0,
      rentPayableAccountCode: "",
      vatCode: "",
      vatSriCode: "",
      vatParameterId: "",
      vatDescription: "",
      vatBaseAmount: purchase ? round2(Number(purchase.totals.iva || 0)) : 0,
      vatPercentage: 0,
      vatRetainedAmount: 0,
      vatPayableAccountCode: "",
      retentionLines: [
        emptyRetentionLine("RENTA", purchase),
        emptyRetentionLine("IVA", purchase)
      ],
      totalRetained: 0,
      journalEntryId: "",
      journalEntryNumber: "",
      reverseEntryId: "",
      reverseEntryNumber: "",
      fullNumber: "",
      establishmentCode: "",
      emissionPointCode: "",
      sequential: "",
      accessKey: "",
      authorizationNumber: "",
      authorizedAt: "",
      authorizedXml: "",
      environment: "PRUEBAS",
      emissionType: "NORMAL",
      preparedForAuthorizationAt: "",
      preparedForAuthorizationBy: "",
      preparedForAuthorizationById: "",
      authorizedBy: "",
      authorizedById: "",
      status: "BORRADOR"
    };
  }

  function normalizeLine(raw) {
    const line = {
      ...emptyLine(),
      ...clone(raw || {})
    };
    line.inventoryItemId = String(line.inventoryItemId || "").trim();
    line.inventoryCategory = String(line.inventoryCategory || "").trim().toUpperCase();
    line.inventoryUnit = String(line.inventoryUnit || "").trim().toLowerCase();
    line.quantity = round2(line.quantity || 0);
    line.unitPrice = round2(line.unitPrice || 0);
    line.discount = round2(line.discount || 0);
    const computedBase = round2((line.quantity || 0) * (line.unitPrice || 0) - (line.discount || 0));
    line.taxableBase = round2(line.taxableBase || computedBase);
    line.vatRate = round2(line.vatRate || 0);
    line.vatCode = String(line.vatCode || "").trim();
    line.vatCategory = ["TARIFA", "NO_OBJETO", "EXENTO"].includes(String(line.vatCategory || "").toUpperCase())
      ? String(line.vatCategory).toUpperCase()
      : line.vatCode === "6"
        ? "NO_OBJETO"
        : line.vatCode === "7"
          ? "EXENTO"
          : "TARIFA";
    line.vatValue = round2(line.vatValue || (line.taxableBase * line.vatRate / 100));
    line.totalLine = round2(line.totalLine || (line.taxableBase + line.vatValue));
    line.description = String(line.description || "").trim();
    line.productCode = String(line.productCode || "").trim();
    line.accountCode = String(line.accountCode || "").trim();
    line.accountName = line.accountCode ? (chartService.findByCode(line.accountCode)?.name || line.accountName || "") : "";
    line.costCenter = String(line.costCenter || "").trim();
    line.lineType = String(line.lineType || "gasto").trim();
    line.suggestionMode = String(line.suggestionMode || "Manual");
    line.suggestedAccountCode = String(line.suggestedAccountCode || "").trim();
    return line;
  }

  function normalizePurchase(raw) {
    const candidate = {
      ...emptyPurchase(),
      ...clone(raw || {})
    };
    const provider = (candidate.supplierId ? findProviderById(candidate.supplierId) : null) || findProviderByRuc(candidate.supplierRuc);
    if (provider) {
      candidate.supplierId = provider.id;
      if (!candidate.supplierName) candidate.supplierName = provider.name;
      if (!candidate.supplierRuc) candidate.supplierRuc = provider.ruc || provider.taxId;
      if (!candidate.supplierAddress) candidate.supplierAddress = provider.address || "";
      if (!candidate.supplierCommercialName) candidate.supplierCommercialName = provider.commercialName || "";
      if (!candidate.supplierEmail) candidate.supplierEmail = provider.email || "";
      if (!candidate.supplierPhone) candidate.supplierPhone = provider.phone || "";
    }
    candidate.supplierCommercialName = String(candidate.supplierCommercialName || "").trim();
    candidate.supplierEmail = String(candidate.supplierEmail || "").trim();
    candidate.supplierPhone = String(candidate.supplierPhone || "").trim();
    candidate.externalDocumentNumber = String(candidate.externalDocumentNumber || "").trim().toUpperCase();
    candidate.issueDate = candidate.issueDate || today();
    candidate.accountingDate = candidate.accountingDate || candidate.issueDate;
    candidate.estab = String(candidate.estab || "001").padStart(3, "0");
    candidate.ptoEmi = String(candidate.ptoEmi || "001").padStart(3, "0");
    candidate.sequential = ["documento_exterior", "saldo_inicial"].includes(candidate.voucherType)
      ? String(candidate.sequential || "").trim()
      : pad9(candidate.sequential || nextSequential(candidate.estab, candidate.ptoEmi));
    candidate.taxSupportCode = String(candidate.taxSupportCode || "").trim();
    candidate.purchaseType = canonicalPurchaseTypeCode(candidate.purchaseType);
    candidate.paymentMethod = String(candidate.paymentMethod || "").trim();
    candidate.settlementMode = String(candidate.settlementMode || "CXP").trim().toUpperCase() === "CONTADO" ? "CONTADO" : "CXP";
    candidate.paymentAccountCode = String(candidate.paymentAccountCode || "").trim();
    const inferredRetentionDecision = ["PENDIENTE_RETENCION", "RETENIDO"].includes(candidate.status)
      ? "APLICAR"
      : String(candidate.retentionStatus || "").toUpperCase().includes("NO SUJETA")
        || String(candidate.retentionStatus || "").toUpperCase().includes("NO REQUERIDA")
        ? "NO_SUJETO_332"
        : "PENDIENTE";
    candidate.retentionDecision = retentionDecisions.includes(String(candidate.retentionDecision || "").trim().toUpperCase())
      ? String(candidate.retentionDecision || "").trim().toUpperCase()
      : inferredRetentionDecision;
    candidate.retentionDecisionCode = candidate.retentionDecision === "NO_SUJETO_332" ? "332" : "";
    candidate.retentionDecisionReason = String(candidate.retentionDecisionReason || "").trim();
    candidate.retentionDecisionBy = String(candidate.retentionDecisionBy || "").trim();
    candidate.retentionDecisionById = String(candidate.retentionDecisionById || "").trim();
    candidate.retentionDecisionAt = String(candidate.retentionDecisionAt || "").trim();
    candidate.documentNumber = buildDocumentNumber(candidate);
    candidate.lines = (candidate.lines || []).map(line => applyInventoryDefaults(normalizeLine(line), candidate.purchaseType));
    candidate.totals = calculateTotals(candidate.lines, candidate.totals?.withholdingsTotal || 0);
    candidate.duplicateKey = duplicateKeyForPurchase(candidate);
    if (!candidate.status) candidate.status = candidate.source === "XML" ? "XML_LEIDO" : "BORRADOR";
    return applySuggestions(candidate);
  }

  function calculateTotals(lines, withholdingTotal = 0) {
    const totals = lines.reduce((acc, line) => {
      if (Number(line.vatRate || 0) > 0) acc.baseIva += Number(line.taxableBase || 0);
      else acc.base0 += Number(line.taxableBase || 0);
      acc.iva += Number(line.vatValue || 0);
      acc.total += Number(line.totalLine || 0);
      return acc;
    }, { base0: 0, baseIva: 0, iva: 0, total: 0 });
    totals.base0 = round2(totals.base0);
    totals.baseIva = round2(totals.baseIva);
    totals.iva = round2(totals.iva);
    totals.total = round2(totals.total);
    totals.withholdingsTotal = round2(withholdingTotal || 0);
    totals.balanceDue = round2(totals.total - totals.withholdingsTotal);
    return totals;
  }

  function findMemorySuggestion(line, purchase) {
    const memories = purchaseMemory();
    const supplierRuc = purchase.supplierRuc || "";
    const normalizedDescription = normalizeText(line.description);
    const code = String(line.productCode || "").trim();
    const relevant = memories.filter(item => item.supplierRuc === supplierRuc);

    if (code) {
      const exactCode = relevant.find(item => String(item.productCode || "").trim() === code);
      if (exactCode) return { memory: exactCode, mode: "Automatico" };
    }

    if (normalizedDescription) {
      const exactDescription = relevant.find(item => item.descriptionNormalized === normalizedDescription);
      if (exactDescription) return { memory: exactDescription, mode: "Automatico" };

      const lineKeywords = keywordsFromText(normalizedDescription);
      const similar = relevant.find(item => {
        const baseKeywords = Array.isArray(item.keywords) ? item.keywords : [];
        const overlap = lineKeywords.filter(word => baseKeywords.includes(word));
        return overlap.length >= 2;
      });
      if (similar) return { memory: similar, mode: "Sugerido" };
    }

    const globalKeyword = memories.find(item => {
      const baseKeywords = Array.isArray(item.keywords) ? item.keywords : [];
      return keywordsFromText(normalizedDescription).some(word => baseKeywords.includes(word));
    });
    if (globalKeyword) return { memory: globalKeyword, mode: "Sugerido" };

    const purchaseType = purchaseTypeByCode(purchase.purchaseType);
    if (purchaseType?.suggestedAccountCode) {
      return {
        memory: {
          accountCode: purchaseType.suggestedAccountCode,
          expenseType: purchaseType.code
        },
        mode: "Sugerido"
      };
    }

    return null;
  }

  function applySuggestions(purchase) {
    const next = clone(purchase);
    next.lines = next.lines.map(line => {
      const item = applyInventoryDefaults(clone(line), next.purchaseType);
      if (purchaseTypeUsesInventory(next.purchaseType)) {
        if (item.accountCode) {
          item.accountName = chartService.findByCode(item.accountCode)?.name || item.accountName || "";
          item.suggestedAccountCode = item.accountCode;
          item.suggestionMode = "Automatico";
        } else {
          item.suggestedAccountCode = item.suggestedAccountCode || purchaseTypeByCode(next.purchaseType)?.suggestedAccountCode || "";
          item.suggestionMode = item.inventoryItemId ? "Sugerido" : "Manual";
        }
        return item;
      }
      const suggestion = findMemorySuggestion(item, next);
      if (item.accountCode && item.suggestedAccountCode && item.accountCode !== item.suggestedAccountCode) {
        item.suggestionMode = "Manual";
        item.accountName = chartService.findByCode(item.accountCode)?.name || item.accountName || "";
        return item;
      }
      if (!item.accountCode && suggestion?.memory?.accountCode) {
        item.accountCode = suggestion.memory.accountCode;
        item.accountName = chartService.findByCode(item.accountCode)?.name || "";
        item.suggestedAccountCode = suggestion.memory.accountCode;
        item.suggestionMode = suggestion.mode;
      } else if (item.accountCode) {
        item.accountName = chartService.findByCode(item.accountCode)?.name || item.accountName || "";
        item.suggestedAccountCode = item.suggestedAccountCode || suggestion?.memory?.accountCode || item.accountCode;
        item.suggestionMode = item.suggestionMode || "Manual";
      } else {
        item.suggestedAccountCode = suggestion?.memory?.accountCode || "";
        item.suggestionMode = suggestion ? "Sugerido" : "Manual";
      }
      return item;
    });
    return next;
  }

  function findDuplicate(purchase, ignoreId = "") {
    const key = duplicateKeyForPurchase(purchase);
    if (!key) return null;
    return purchases().find(item => item.id !== ignoreId && item.duplicateKey === key);
  }

  function isPostedStatus(status) {
    return ["PENDIENTE_RETENCION", "CONTABILIZADO", "RETENIDO"].includes(status);
  }

  function canEditPurchase(purchase) {
    return !isPostedStatus(purchase.status) && !["ANULADO"].includes(purchase.status);
  }

  function validatePurchase(purchase, { forPost = false } = {}) {
    const candidate = normalizePurchase(purchase);
    const errors = [];

    if (!candidate.supplierName) errors.push("Debe seleccionar un proveedor.");
    if (!candidate.supplierRuc) errors.push("El RUC del proveedor es obligatorio.");
    if (!candidate.issueDate) errors.push("La fecha de emision es obligatoria.");
    if (!candidate.accountingDate) errors.push("La fecha de contabilizacion es obligatoria.");
    if (!candidate.voucherType) errors.push("El tipo de comprobante es obligatorio.");
    if (["documento_exterior", "saldo_inicial"].includes(candidate.voucherType)) {
      if (!candidate.externalDocumentNumber) {
        errors.push(candidate.voucherType === "saldo_inicial"
          ? "El numero del documento del saldo inicial es obligatorio."
          : "El numero del documento del exterior es obligatorio.");
      }
    } else if (!candidate.estab || !candidate.ptoEmi || !candidate.sequential) {
      errors.push("Serie, punto de emision y secuencial son obligatorios.");
    }
    if (candidate.voucherType !== "saldo_inicial" && !candidate.taxSupportCode) errors.push("Debe seleccionar un sustento tributario.");
    if (!candidate.purchaseType) errors.push("Debe seleccionar un tipo de compra.");
    if (!candidate.lines.length) errors.push("Debe existir al menos una linea de compra.");
    if (forPost && candidate.voucherType !== "saldo_inicial" && companyAllows("purchases.issueWithholdings")) {
      if (candidate.retentionDecision === "PENDIENTE") {
        errors.push("Debe decidir si la compra aplica retencion o corresponde al codigo 332 no sujeto a retencion.");
      }
      if (candidate.retentionDecision === "NO_SUJETO_332" && !candidate.retentionDecisionReason) {
        errors.push("Debe registrar el motivo para usar el codigo 332 no sujeto a retencion.");
      }
      if (candidate.retentionDecision === "NO_SUJETO_332") {
        const noSubjectValidation = taxConfigService.validateRetentionActiveOnDate("332", candidate.accountingDate || candidate.issueDate, {
          taxType: "RENTA",
          appliesTo: "compra",
          skipLinkedAccounts: true
        });
        if (!noSubjectValidation.ok) {
          noSubjectValidation.errors.forEach(message => errors.push(`Codigo SRI 332: ${message}`));
        } else if (Number(noSubjectValidation.retention?.percentage || 0) !== 0) {
          errors.push("El codigo SRI 332 debe tener porcentaje 0.");
        }
      }
    }

    candidate.lines.forEach((line, index) => {
      const row = index + 1;
      const inventoryLinkedItem = purchaseTypeUsesInventory(candidate.purchaseType) ? inventoryItemForLine(line, candidate.purchaseType) : null;
      if (purchaseTypeUsesInventory(candidate.purchaseType) && !inventoryLinkedItem) {
        errors.push(`La linea ${row} debe seleccionar un producto parametrizado de inventario.`);
      }
      if (!line.description) errors.push(`La linea ${row} debe tener descripcion.`);
      if (Number(line.quantity || 0) <= 0) errors.push(`La linea ${row} debe tener cantidad mayor a cero.`);
      if (Number(line.totalLine || 0) < 0) errors.push(`La linea ${row} no puede tener total negativo.`);
      if (purchaseTypeUsesInventory(candidate.purchaseType) && inventoryLinkedItem && !line.accountCode) {
        errors.push(`El producto de la linea ${row} no tiene cuenta de inventario parametrizada.`);
      }
      if (forPost && !line.accountCode) errors.push(`La linea ${row} debe tener cuenta contable para contabilizar.`);
    });

    const duplicate = findDuplicate(candidate, candidate.id);
    if (duplicate) errors.push(`El comprobante ya existe: ${duplicate.documentNumber || duplicate.authorizationNumber}.`);

    if (forPost) {
      const defaults = companyService.settings().defaultAccounts || {};
      if (candidate.settlementMode !== "CONTADO") {
        const payableAccount = chartService.findByCode(defaults.accountsPayableSuppliers);
        if (!defaults.accountsPayableSuppliers) errors.push("No existe cuenta por pagar a proveedores predeterminada.");
        else if (!payableAccount || payableAccount.status !== "Activa" || !payableAccount.isMovement) {
          errors.push(`La cuenta por pagar a proveedores ${defaults.accountsPayableSuppliers} debe ser de movimiento activa.`);
        }
      }
      if (candidate.settlementMode === "CONTADO") {
        if (!candidate.paymentAccountCode) errors.push("Seleccione la cuenta de banco o caja usada para pagar la compra.");
        const paymentAccount = candidate.paymentAccountCode ? chartService.findByCode(candidate.paymentAccountCode) : null;
        if (candidate.paymentAccountCode && (!paymentAccount || paymentAccount.status !== "Activa" || !paymentAccount.isMovement)) {
          errors.push("La cuenta seleccionada para banco o caja no es una cuenta de movimiento activa.");
        }
      }
      vatGroups(candidate.lines, defaults).forEach(group => {
        if (!group.accountCode) {
          errors.push(`No existe cuenta IVA compras para la tarifa ${group.rate}%.`);
          return;
        }
        const account = chartService.findByCode(group.accountCode);
        if (!account) errors.push(`La cuenta IVA compras ${group.accountCode} para la tarifa ${group.rate}% no existe.`);
        else if (account.status !== "Activa" || !account.isMovement) {
          errors.push(`La cuenta IVA compras ${group.accountCode} para la tarifa ${group.rate}% debe ser de movimiento activa.`);
        }
      });
      candidate.lines.forEach((line, index) => {
        if (!line.accountCode) return;
        const account = chartService.findByCode(line.accountCode);
        if (!account) errors.push(`La cuenta de la linea ${index + 1} no existe.`);
        else {
          if (account.status !== "Activa") errors.push(`La cuenta ${account.code} de la linea ${index + 1} esta inactiva.`);
          if (!account.isMovement) errors.push(`La cuenta ${account.code} de la linea ${index + 1} no es de movimiento.`);
        }
      });
    }

    return { purchase: candidate, errors };
  }

  function savePurchase(purchase) {
    const { purchase: candidate, errors } = validatePurchase(purchase);
    if (errors.length) return { ok: false, errors };

    if (!requiresSupplierV2()) {
      const providerResult = BlessERP.services?.portfolios?.upsertProviderFromPurchase?.(candidate, {
        source: candidate.source === "XML" ? "XML" : "MANUAL",
        importedAt: candidate.source === "XML" ? new Date().toISOString() : ""
      });
      if (providerResult?.ok) {
        candidate.supplierId = providerResult.provider.id;
        candidate.supplierName = providerResult.provider.name || candidate.supplierName;
        candidate.supplierRuc = providerResult.provider.taxId || providerResult.provider.ruc || candidate.supplierRuc;
        candidate.supplierAddress = providerResult.provider.address || candidate.supplierAddress;
      }
    }

    const rows = purchases();
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    candidate.id = candidate.id || uid("PUR");
    candidate.createdBy = candidate.createdBy || currentUser().name;
    candidate.createdById = candidate.createdById || currentUser().id;
    candidate.createdAt = candidate.createdAt || new Date().toISOString();
    if (!candidate.status || !purchaseStatuses.includes(candidate.status)) candidate.status = candidate.source === "XML" ? "XML_LEIDO" : "BORRADOR";
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("purchases", rows);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: index >= 0 ? "EDITAR_COMPRA" : "CREAR_COMPRA",
      entityType: "purchase",
      entityId: candidate.id,
      entityLabel: candidate.documentNumber,
      documentLabel: candidate.documentNumber || candidate.supplierName,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se registro"} la compra ${candidate.documentNumber || candidate.supplierName}.`,
      before,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, purchase: clone(candidate) };
  }

  function updatePurchaseMemory(purchase) {
    const user = currentUser();
    const rules = purchaseMemory();

    purchase.lines.forEach(line => {
      if (!line.accountCode || !line.description) return;
      const normalizedDescription = normalizeText(line.description);
      const ruleIndex = rules.findIndex(rule =>
        rule.supplierRuc === purchase.supplierRuc
        && String(rule.productCode || "") === String(line.productCode || "")
        && rule.descriptionNormalized === normalizedDescription
      );
      const nextRule = {
        id: ruleIndex >= 0 ? rules[ruleIndex].id : uid("MEM"),
        supplierId: purchase.supplierId || "",
        supplierRuc: purchase.supplierRuc,
        supplierName: purchase.supplierName,
        productCode: line.productCode || "",
        descriptionNormalized: normalizedDescription,
        keywords: keywordsFromText(line.description),
        accountCode: line.accountCode,
        vatPercentage: line.vatRate || 0,
        expenseType: purchase.purchaseType,
        lastUsedAt: new Date().toISOString(),
        usageCount: ruleIndex >= 0 ? Number(rules[ruleIndex].usageCount || 0) + 1 : 1,
        updatedBy: user.name
      };
      if (ruleIndex >= 0) rules[ruleIndex] = nextRule;
      else rules.unshift(nextRule);
    });

    saveList("purchaseMemory", rules);
  }

  function buildPurchaseJournalEntry(purchase) {
    const defaults = companyService.settings().defaultAccounts || {};
    const accountsPayable = chartService.findByCode(defaults.accountsPayableSuppliers);
    const entry = journalService.emptyEntry();
    entry.accountingDate = purchase.accountingDate;
    entry.accountingPeriod = journalService.accountingPeriodForDate?.(entry.accountingDate, entry.accountingPeriod)
      || String(entry.accountingDate || "").slice(0, 7)
      || entry.accountingPeriod;
    entry.concept = `Compra ${purchase.supplierName} | ${purchase.lines[0]?.description || purchase.documentNumber}`;
    entry.originModule = "Compras";
    entry.sourceDocument = purchase.documentNumber;
    entry.externalReference = purchase.authorizationNumber || purchase.accessKey || "";
    entry.observation = purchase.observation || "";
    entry.lines = purchase.lines.map(line => ({
      id: uid("JLN"),
      accountCode: line.accountCode,
      accountName: chartService.findByCode(line.accountCode)?.name || line.accountName || "",
      debit: round2(line.taxableBase),
      credit: 0,
      costCenter: line.costCenter || "",
      auxiliary: "",
      lineDescription: line.description || "",
      documentReference: purchase.documentNumber
    }));
    vatGroups(purchase.lines, defaults).forEach(group => {
      const vatPurchases = chartService.findByCode(group.accountCode);
      if (!vatPurchases) return;
      entry.lines.push({
        id: uid("JLN"),
        accountCode: vatPurchases.code,
        accountName: vatPurchases.name,
        debit: round2(group.amount),
        credit: 0,
        costCenter: "",
        auxiliary: "",
        lineDescription: `IVA compras ${group.rate}%`,
        documentReference: purchase.documentNumber
      });
    });
    const paymentAccount = purchase.settlementMode === "CONTADO"
      ? chartService.findByCode(purchase.paymentAccountCode)
      : accountsPayable;
    entry.lines.push({
      id: uid("JLN"),
      accountCode: paymentAccount.code,
      accountName: paymentAccount.name,
      debit: 0,
      credit: round2(purchase.totals.total),
      costCenter: "",
      auxiliary: purchase.settlementMode === "CONTADO" ? "" : purchase.supplierRuc,
      lineDescription: purchase.settlementMode === "CONTADO" ? `Pago inmediato ${purchase.supplierName}` : `Proveedor ${purchase.supplierName}`,
      documentReference: purchase.documentNumber
    });
    return entry;
  }

  function createOrUpdatePayable(purchase) {
    const rows = purchasePayables();
    const balance = round2(purchase.totals.balanceDue);
    const item = {
      id: purchase.payableId || uid("APV"),
      purchaseId: purchase.id,
      supplierName: purchase.supplierName,
      supplierRuc: purchase.supplierRuc,
      documentNumber: purchase.documentNumber,
      issueDate: purchase.issueDate,
      dueDate: purchase.dueDate,
      total: round2(purchase.totals.total),
      balance,
      status: purchase.status === "ANULADO" ? "anulado" : balance <= 0 ? "pagado" : balance < round2(purchase.totals.total) ? "parcial" : "pendiente",
      journalEntryId: purchase.journalEntryId,
      journalEntryNumber: purchase.journalEntryNumber
    };
    const index = rows.findIndex(row => row.purchaseId === purchase.id || row.id === purchase.payableId);
    if (index >= 0) rows[index] = item;
    else rows.unshift(item);
    saveList("purchasePayables", rows);
    return item;
  }

  function postPurchase(purchaseId) {
    const rows = purchases();
    const index = rows.findIndex(item => item.id === purchaseId);
    if (index < 0) return { ok: false, errors: ["Compra no encontrada."] };
    const current = normalizePurchase(rows[index]);
    if (!canEditPurchase(current)) return { ok: false, errors: ["La compra ya fue contabilizada y no puede editarse directamente."] };
    const { purchase: candidate, errors } = validatePurchase(current, { forPost: true });
    if (errors.length) return { ok: false, errors };

    const entryDraft = buildPurchaseJournalEntry(candidate);
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento de compra."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el asiento de compra."] };

    const previousStatus = current.status;
    candidate.journalEntryId = postedEntry.entry.id;
    candidate.journalEntryNumber = postedEntry.entry.entryNumber;
    candidate.postedBy = currentUser().name;
    candidate.postedById = currentUser().id;
    candidate.postedAt = new Date().toISOString();
    const requiresRetention = companyAllows("purchases.issueWithholdings")
      && candidate.retentionDecision === "APLICAR";
    candidate.status = requiresRetention
      ? "PENDIENTE_RETENCION"
      : "CONTABILIZADO";
    candidate.retentionStatus = candidate.status === "PENDIENTE_RETENCION"
      ? "Pendiente de emitir"
      : candidate.retentionDecision === "NO_SUJETO_332"
        ? "No sujeta (332)"
        : "No emite retencion";
    candidate.retentionDecisionCode = candidate.retentionDecision === "NO_SUJETO_332" ? "332" : "";
    candidate.retentionDecisionBy = currentUser().name;
    candidate.retentionDecisionById = currentUser().id;
    candidate.retentionDecisionAt = new Date().toISOString();
    candidate.payableId = candidate.settlementMode === "CXP" ? createOrUpdatePayable(candidate).id : "";
    rows[index] = candidate;
    saveList("purchases", rows);
    updatePurchaseMemory(candidate);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "CONTABILIZAR_COMPRA",
      entityType: "purchase",
      entityId: candidate.id,
      entityLabel: candidate.documentNumber,
      documentLabel: candidate.documentNumber,
      previousStatus,
      nextStatus: candidate.status,
      description: `Compra ${candidate.documentNumber} contabilizada con asiento ${candidate.journalEntryNumber}.`,
      before: current,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, purchase: clone(candidate), entry: clone(postedEntry.entry) };
  }

  async function postPurchaseV2(purchaseOrId, options = {}) {
    const suppliedDraft = purchaseOrId && typeof purchaseOrId === "object" ? normalizePurchase(clone(purchaseOrId)) : null;
    const purchaseId = suppliedDraft?.id || purchaseOrId;
    if (!requiresSupplierV2()) return suppliedDraft
      ? { ok:false,errors:["La revisión XML en memoria requiere Compras V2 confirmada por Supabase."] }
      : postPurchase(purchaseId);
    const current = suppliedDraft || purchases().find(item => item.id === purchaseId || item.purchaseDocumentId === purchaseId);
    if (!current) return { ok:false,errors:["Compra no encontrada."] };
    // Notas de crédito/débito todavía no capturan de forma obligatoria el
    // documento y la CxP afectados. Se conserva su flujo legacy para no
    // convertirlas erróneamente en una nueva obligación positiva.
    if (["nota_credito", "nota_debito"].includes(String(current.voucherType || "").toLowerCase())) {
      return postPurchase(purchaseId);
    }
    if (current.syncFlow === "SUPPLIER_FINANCE_V2" || current.status === "POSTED") {
      return { ok:true,purchase:clone(current),reused:true };
    }
    const { purchase:candidate,errors } = validatePurchase(current,{ forPost:true });
    if (errors.length) return { ok:false,errors };
    const result = await supplierV2()?.postPurchase?.(candidate,options);
    return result || { ok:false,errors:["Servicio de compras V2 no disponible."] };
  }

  function deleteOrAnnulPurchase(purchaseId, reason = "Correccion solicitada por el usuario") {
    const rows = purchases();
    const index = rows.findIndex(item => item.id === purchaseId);
    if (index < 0) return { ok: false, message: "Compra no encontrada." };
    const target = normalizePurchase(rows[index]);
    const activeRetention = issuedWithholdings().find(item => item.purchaseId === target.id && item.status !== "ANULADA");
    if (activeRetention) return { ok: false, message: "Anule primero la retencion relacionada con esta compra." };
    if (!isPostedStatus(target.status)) {
      rows.splice(index, 1);
      saveList("purchases", rows);
      saveList("purchasePayables", purchasePayables().filter(item => item.purchaseId !== target.id));
      adminService?.addAuditLog?.({ module: "COMPRAS", action: "ELIMINAR_BORRADOR_COMPRA", entityType: "purchase", entityId: target.id, entityLabel: target.documentNumber, description: reason, before: target, result: "exitoso" });
      return { ok: true, deleted: true, purchase: clone(target) };
    }
    if (target.status === "ANULADO") return { ok: false, message: "La compra ya esta anulada." };
    const reversed = journalService.reverseEntry(target.journalEntryId);
    if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el asiento de la compra." };
    const previousStatus = target.status;
    const before = clone(target);
    target.status = "ANULADO";
    target.reverseEntryId = reversed.entry.id;
    target.reverseEntryNumber = reversed.entry.entryNumber;
    target.annulledAt = new Date().toISOString();
    target.annulledBy = currentUser().name;
    target.annulmentReason = reason;
    rows[index] = target;
    saveList("purchases", rows);
    saveList("purchasePayables", purchasePayables().map(item => item.purchaseId === target.id ? { ...item, balance: 0, status: "anulado" } : item));
    adminService?.addAuditLog?.({ module: "COMPRAS", action: "ANULAR_COMPRA", entityType: "purchase", entityId: target.id, entityLabel: target.documentNumber, previousStatus, nextStatus: "ANULADO", description: reason, before, after: target, result: "exitoso" });
    return { ok: true, deleted: false, purchase: clone(target), reversal: clone(reversed.entry) };
  }

  async function deleteOrAnnulPurchaseV2(purchaseId, reason = "Correccion solicitada por el usuario", options = {}) {
    const current = purchases().find(item => String(item.id || item.purchaseDocumentId) === String(purchaseId));
    if (!current) return { ok: false, errors: ["Compra no encontrada."] };
    if (!requiresSupplierV2() || current.syncFlow !== "SUPPLIER_FINANCE_V2") {
      return deleteOrAnnulPurchase(purchaseId, reason);
    }
    const result = await supplierV2()?.reversePurchase?.(current.purchaseDocumentId || current.id, reason, options);
    return result || { ok: false, errors: ["Servicio de reversión de compras V2 no disponible."] };
  }

  function parseVoucherType(codDoc) {
    const map = {
      "01": "factura",
      "03": "liquidacion_compra",
      "04": "nota_credito",
      "05": "nota_debito"
    };
    return map[codDoc] || "factura";
  }

  function pickText(doc, tags = []) {
    for (const tag of tags) {
      const node = doc.querySelector(tag);
      if (node?.textContent?.trim()) return node.textContent.trim();
    }
    return "";
  }

  function pickAdditionalText(doc, labels = []) {
    const normalizedLabels = labels.map(label => normalizeText(label));
    const field = Array.from(doc.querySelectorAll("campoAdicional")).find(node => {
      const label = normalizeText(node.getAttribute("nombre") || "");
      return normalizedLabels.some(item => label === item || label.includes(item));
    });
    return String(field?.textContent || "").trim();
  }

  function parseXmlString(xmlText, fileName = "") {
    try {
      const parser = new DOMParser();
      const outer = parser.parseFromString(String(xmlText || ""), "application/xml");
      if (outer.querySelector("parsererror")) {
        return { ok: false, importStatus: "ERROR_XML", fileName, error: "No se pudo leer el XML." };
      }
      let doc = outer;
      let authorizationNumber = "";
      let accessKey = "";
      const authorizationNode = outer.querySelector("autorizacion");
      if (authorizationNode) {
        authorizationNumber = pickText(outer, ["numeroAutorizacion"]);
        const cdataXml = pickText(outer, ["comprobante"]);
        if (cdataXml) {
          const inner = parser.parseFromString(cdataXml, "application/xml");
          if (!inner.querySelector("parsererror")) doc = inner;
        }
      }

      accessKey = pickText(doc, ["claveAcceso"]);
      const codDoc = pickText(doc, ["codDoc"]);
      const supplierRuc = pickText(doc, ["infoTributaria > ruc", "ruc"]);
      const supplierName = pickText(doc, ["infoTributaria > razonSocial", "razonSocial"]);
      const supplierCommercialName = pickText(doc, ["infoTributaria > nombreComercial", "nombreComercial"]);
      const supplierAddress = pickText(doc, ["infoTributaria > dirMatriz", "dirMatriz"]);
      const supplierEmail = pickAdditionalText(doc, ["email", "correo", "correo electronico"]);
      const supplierPhone = pickAdditionalText(doc, ["telefono", "celular", "telefono proveedor"]);
      const issueDate = pickText(doc, ["fechaEmision", "infoFactura > fechaEmision"]);
      const estab = pickText(doc, ["estab"]);
      const ptoEmi = pickText(doc, ["ptoEmi"]);
      const sequential = pickText(doc, ["secuencial"]);
      const details = Array.from(doc.querySelectorAll("detalles > detalle")).map(node => {
        const quantity = round2(pickText(node, ["cantidad"]) || 1);
        const unitPrice = round2(pickText(node, ["precioUnitario"]) || 0);
        const discount = round2(pickText(node, ["descuento"]) || 0);
        const taxableBase = round2(pickText(node, ["precioTotalSinImpuesto"]) || (quantity * unitPrice - discount));
        const taxNodes = Array.from(node.querySelectorAll("impuestos > impuesto"));
        const vatNode = taxNodes.find(tax => pickText(tax, ["codigo"]) === "2") || taxNodes[0] || null;
        const vatCode = pickText(vatNode || node, ["codigoPorcentaje"]);
        const vatRate = round2(pickText(vatNode || node, ["tarifa"]) || 0);
        const vatValue = round2(pickText(vatNode || node, ["valor"]) || 0);
        return {
          id: uid("PLN"),
          productCode: pickText(node, ["codigoPrincipal", "codigoAuxiliar"]),
          description: pickText(node, ["descripcion"]),
          quantity,
          unitPrice,
          discount,
          taxableBase,
          vatRate,
          vatCode,
          vatCategory: vatCode === "6" ? "NO_OBJETO" : vatCode === "7" ? "EXENTO" : "TARIFA",
          vatValue,
          totalLine: round2(taxableBase + vatValue),
          accountCode: "",
          accountName: "",
          costCenter: "",
          lineType: "gasto",
          suggestionMode: "Manual",
          suggestedAccountCode: ""
        };
      });

      const rawPurchase = normalizePurchase({
        id: uid("PUR"),
        source: "XML",
        importStatus: "LEIDO",
        supplierId: findProviderByRuc(supplierRuc)?.id || "",
        supplierName,
        supplierRuc,
        supplierAddress: findProviderByRuc(supplierRuc)?.address || supplierAddress,
        supplierCommercialName,
        supplierEmail,
        supplierPhone,
        issueDate: issueDate ? issueDate.split("/").reverse().join("-") : today(),
        accountingDate: issueDate ? issueDate.split("/").reverse().join("-") : today(),
        dueDate: "",
        voucherType: parseVoucherType(codDoc),
        estab,
        ptoEmi,
        sequential,
        authorizationNumber: authorizationNumber || accessKey,
        accessKey,
        taxSupportCode: "",
        purchaseType: "",
        paymentMethod: pickText(doc, ["pagos > pago > formaPago", "formaPago"]),
        observation: `Importado desde ${fileName || "XML"}`,
        status: "XML_LEIDO",
        retentionStatus: "Pendiente de decision",
        retentionDecision: "PENDIENTE",
        retentionDecisionReason: "",
        payableId: "",
        journalEntryId: "",
        journalEntryNumber: "",
        lines: details.length ? details : [emptyLine()]
      });

      const firstLine = rawPurchase.lines[0];
      const memorySuggestion = findMemorySuggestion(firstLine, rawPurchase);
      const inferredType = memorySuggestion?.memory?.expenseType || "GASTO";
      rawPurchase.purchaseType = inferredType;
      rawPurchase.taxSupportCode = purchaseTypeByCode(inferredType)?.suggestedSupportCode || "02";
      const next = normalizePurchase(rawPurchase);
      const duplicate = findDuplicate(next);
      next.importStatus = duplicate ? "DUPLICADO" : next.lines.some(line => !line.accountCode) ? "PENDIENTE_CUENTA" : "VALIDO";
      next.status = next.lines.some(line => !line.accountCode) ? "PENDIENTE_CLASIFICACION" : "XML_LEIDO";
      return { ok: true, importStatus: next.importStatus, fileName, purchase: next };
    } catch (error) {
      return { ok: false, importStatus: "ERROR_XML", fileName, error: error?.message || "Error no controlado al procesar XML." };
    }
  }

  async function parseXmlFile(file) {
    const xmlText = await file.text();
    return parseXmlString(xmlText, file.name);
  }

  function registerProvidersFromXmlBatch(batch = []) {
    const results = [];
    batch.forEach(item => {
      if (!item?.ok || !item.purchase?.supplierRuc || !item.purchase?.supplierName) return;
      const providerResult = BlessERP.services?.portfolios?.upsertProviderFromPurchase?.(item.purchase, {
        source: "XML",
        importedAt: new Date().toISOString()
      });
      if (!providerResult?.ok) return;
      item.purchase.supplierId = providerResult.provider.id;
      item.purchase.supplierRuc = providerResult.provider.taxId || providerResult.provider.ruc || item.purchase.supplierRuc;
      results.push({
        providerId: providerResult.provider.id,
        created: Boolean(providerResult.created),
        taxId: providerResult.provider.taxId
      });
    });
    return {
      processed: results.length,
      created: results.filter(item => item.created).length,
      updated: results.filter(item => !item.created).length,
      results
    };
  }

  async function registerProvidersFromXmlBatchV2(batch = []) {
    if (!requiresSupplierV2()) return registerProvidersFromXmlBatch(batch);
    const results=[];
    for (const item of batch) {
      if (!item?.ok || !item.purchase?.supplierRuc || !item.purchase?.supplierName) continue;
      const existed = Boolean(supplierV2()?.findProvider?.({ taxId:item.purchase.supplierRuc }));
      const result=await supplierV2()?.upsertProvider?.({ ...item.purchase,taxId:item.purchase.supplierRuc,name:item.purchase.supplierName },{ source:"XML" });
      if (!result?.ok) { results.push({ ok:false,error:result?.message || result?.errors?.join(" ") }); continue; }
      item.purchase.supplierId=result.provider.id || result.provider.providerId;
      results.push({ ok:true,providerId:item.purchase.supplierId,created:!existed,taxId:result.provider.taxId });
    }
    return { processed:results.filter(item=>item.ok).length,created:results.filter(item=>item.ok&&item.created).length,
      updated:results.filter(item=>item.ok&&!item.created).length,errors:results.filter(item=>!item.ok),results };
  }

  function detectXmlBatchDuplicates(batch = []) {
    const seen = new Map();
    let duplicates = 0;
    batch.forEach(item => {
      if (!item?.ok || !item.purchase) return;
      const key = duplicateKeyForPurchase(item.purchase);
      if (!key) return;
      if (seen.has(key)) {
        item.importStatus = "DUPLICADO";
        item.purchase.importStatus = "DUPLICADO";
        item.duplicateWithinBatch = true;
        item.duplicateOfFileName = seen.get(key);
        duplicates += 1;
        return;
      }
      seen.set(key, item.fileName || key);
    });
    return { duplicates };
  }

  async function resolveProvidersFromXmlBatchV2(batch = []) {
    const duplicateResult = detectXmlBatchDuplicates(batch);
    const candidates = batch.filter(item => item?.ok && item.purchase?.supplierRuc);
    const taxIds = [...new Set(candidates.map(item => String(item.purchase.supplierRuc || "")
      .trim().toUpperCase().replace(/[^0-9A-Z]/g, "")).filter(Boolean))];
    let rows = [];
    if (requiresSupplierV2()) {
      const result = await supplierV2()?.resolveProvidersByTaxIds?.(taxIds);
      if (!result?.ok) {
        return { ok: false, processed: 0, existing: 0, pendingCreation: taxIds.length,
          duplicates: duplicateResult.duplicates, errors: result?.errors || [result?.message || "No se pudieron consultar los proveedores."] };
      }
      rows = result.rows || [];
    } else {
      rows = taxIds.map(taxId => findProviderByRuc(taxId)).filter(Boolean).map(provider => ({
        id: provider.id,
        providerId: provider.id,
        taxId: provider.taxId || provider.ruc,
        legalName: provider.name || provider.legalName,
        commercialName: provider.commercialName || "",
        status: provider.status || ""
      }));
    }
    const byTax = new Map(rows.map(provider => [String(provider.taxId || "").replace(/[^0-9A-Z]/gi, "").toUpperCase(), provider]));
    candidates.forEach(item => {
      const taxId = String(item.purchase.supplierRuc || "").replace(/[^0-9A-Z]/gi, "").toUpperCase();
      const provider = byTax.get(taxId) || null;
      item.providerResolution = provider
        ? { status: "REGISTERED", providerId: provider.id || provider.providerId, taxId,
          legalName: provider.legalName || provider.name || item.purchase.supplierName,
          providerCode: provider.providerCode || "", version: Number(provider.version || 0), updatedAt: provider.updatedAt || "" }
        : { status: "PENDING_CREATION", providerId: "", taxId,
          legalName: item.purchase.supplierName || "", providerCode: "", version: 0, updatedAt: "" };
      item.purchase.supplierId = provider?.id || provider?.providerId || "";
    });
    return { ok: true, processed: candidates.length, existing: candidates.filter(item => item.providerResolution?.status === "REGISTERED").length,
      pendingCreation: candidates.filter(item => item.providerResolution?.status === "PENDING_CREATION").length,
      duplicates: duplicateResult.duplicates, errors: [], rows };
  }

  function importXmlBatch(batch = []) {
    const rows = purchases();
    const results = [];
    batch.forEach(item => {
      if (!item?.purchase || !["VALIDO", "PENDIENTE_CUENTA"].includes(item.importStatus)) {
        results.push({ fileName: item?.fileName || "", imported: false });
        return;
      }
      const candidate = normalizePurchase(item.purchase);
      if (findDuplicate(candidate, candidate.id)) {
        results.push({ fileName: item.fileName, imported: false, reason: "duplicado" });
        return;
      }
      const providerResult = BlessERP.services?.portfolios?.upsertProviderFromPurchase?.(candidate, {
        source: "XML",
        importedAt: new Date().toISOString()
      });
      if (providerResult?.ok) {
        candidate.supplierId = providerResult.provider.id;
        candidate.supplierName = providerResult.provider.name || candidate.supplierName;
        candidate.supplierAddress = providerResult.provider.address || candidate.supplierAddress;
      }
      candidate.importStatus = "IMPORTADO";
      rows.unshift(candidate);
      results.push({
        fileName: item.fileName,
        imported: true,
        purchaseId: candidate.id,
        providerId: providerResult?.provider?.id || candidate.supplierId || "",
        providerCreated: Boolean(providerResult?.created)
      });
    });
    saveList("purchases", rows);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "IMPORTAR_XML_COMPRAS",
      entityType: "purchase_import",
      entityId: uid("IMP"),
      entityLabel: `XML compras ${results.filter(item => item.imported).length}`,
      documentLabel: "Importacion XML compras",
      previousStatus: "",
      nextStatus: "IMPORTADO",
      description: `Se importaron ${results.filter(item => item.imported).length} XML validos de compras sobre ${batch.length} archivos revisados.`,
      after: { imported: results.filter(item => item.imported).length, reviewed: batch.length, results },
      result: "exitoso"
    });
    return {
      ok: true,
      results,
      imported: results.filter(item => item.imported).length,
      providersCreated: results.filter(item => item.providerCreated).length
    };
  }

  function periodKey(value = "") {
    const match = /^(\d{4})-(\d{2})/.exec(String(value || ""));
    return match ? `${match[1]}-${match[2]}` : "";
  }

  function daysBetweenDates(fromValue = "", toValue = "") {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromValue || "")) ? new Date(`${fromValue}T00:00:00Z`) : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(toValue || "")) ? new Date(`${toValue}T00:00:00Z`) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  function purchaseTaxBreakdown(purchase = {}) {
    const breakdown = {
      base15: 0,
      iva15: 0,
      base8: 0,
      iva8: 0,
      base5: 0,
      iva5: 0,
      base0: 0,
      baseNoObjeto: 0,
      baseExenta: 0,
      baseOther: 0,
      ivaOther: 0,
      ivaTotal: 0
    };
    (purchase.lines || []).map(normalizeLine).forEach(line => {
      const base = Number(line.taxableBase || 0);
      const iva = Number(line.vatValue || 0);
      if (line.vatCategory === "NO_OBJETO" || line.vatCode === "6") {
        breakdown.baseNoObjeto += base;
      } else if (line.vatCategory === "EXENTO" || line.vatCode === "7") {
        breakdown.baseExenta += base;
      } else if (Math.abs(Number(line.vatRate || 0) - 15) < 0.001) {
        breakdown.base15 += base;
        breakdown.iva15 += iva;
      } else if (Math.abs(Number(line.vatRate || 0) - 8) < 0.001) {
        breakdown.base8 += base;
        breakdown.iva8 += iva;
      } else if (Math.abs(Number(line.vatRate || 0) - 5) < 0.001) {
        breakdown.base5 += base;
        breakdown.iva5 += iva;
      } else if (Math.abs(Number(line.vatRate || 0)) < 0.001) {
        breakdown.base0 += base;
      } else {
        breakdown.baseOther += base;
        breakdown.ivaOther += iva;
      }
      breakdown.ivaTotal += iva;
    });
    Object.keys(breakdown).forEach(key => {
      breakdown[key] = round2(breakdown[key]);
    });
    return breakdown;
  }

  function purchaseRetentionReport(period = "", scope = "BOTH", search = "") {
    const normalizedScope = ["BOTH", "PURCHASE", "RETENTION", "CROSS"].includes(String(scope || "").toUpperCase())
      ? String(scope || "").toUpperCase()
      : "BOTH";
    const query = normalizeText(search);
    const retentionRows = issuedWithholdings().filter(item => item.status !== "ANULADA");
    const matchedRetentionIds = new Set();
    const rows = [];
    purchases().forEach(purchase => {
      const related = retentionRows.filter(retention =>
        retention.purchaseId === purchase.id
        || (!retention.purchaseId && retention.purchaseDocumentNumber === purchase.documentNumber)
      );
      const detailRows = related.length ? related : [null];
      detailRows.forEach(retention => {
        if (retention) matchedRetentionIds.add(retention.id);
        const purchasePeriod = periodKey(purchase.accountingDate || purchase.issueDate);
        const retentionPeriod = periodKey(retention?.retentionDate);
        const crossPeriod = Boolean(retentionPeriod && purchasePeriod && retentionPeriod !== purchasePeriod);
        const retentionDaysAfterPurchase = retention
          ? daysBetweenDates(purchase.issueDate || purchase.accountingDate, retention.retentionDate)
          : null;
        const retentionOutOfTerm = retentionDaysAfterPurchase !== null && retentionDaysAfterPurchase > 5;
        const taxBreakdown = purchaseTaxBreakdown(purchase);
        const matchesPeriod = !period
          || (normalizedScope === "PURCHASE" && purchasePeriod === period)
          || (normalizedScope === "RETENTION" && retentionPeriod === period)
          || (normalizedScope === "CROSS" && crossPeriod && (purchasePeriod === period || retentionPeriod === period))
          || (normalizedScope === "BOTH" && (purchasePeriod === period || retentionPeriod === period));
        const haystack = normalizeText([
          purchase.supplierName,
          purchase.supplierRuc,
          purchase.documentNumber,
          retention?.fullNumber,
          retention?.draftNumber
        ].join(" "));
        if (!matchesPeriod || (query && !haystack.includes(query))) return;
        rows.push({
          id: `${purchase.id}:${retention?.id || "SIN_RETENCION"}`,
          purchaseId: purchase.id,
          purchaseDate: purchase.issueDate || "",
          accountingDate: purchase.accountingDate || purchase.issueDate || "",
          purchasePeriod,
          supplierName: purchase.supplierName || "",
          supplierRuc: purchase.supplierRuc || "",
          purchaseDocumentNumber: purchase.documentNumber || "",
          purchaseAuthorization: purchase.authorizationNumber || purchase.accessKey || "",
          taxSupportCode: purchase.taxSupportCode || "",
          purchaseTotal: round2(purchase.totals?.total || 0),
          ...taxBreakdown,
          purchaseStatus: purchase.status || "",
          retentionDecision: purchase.retentionDecision || "",
          retentionId: retention?.id || "",
          retentionDate: retention?.retentionDate || "",
          retentionPeriod,
          retentionNumber: retention?.fullNumber || retention?.draftNumber || "",
          retentionStatus: retention?.status || "SIN_RETENCION",
          rentRetained: round2(retention?.rentRetainedAmount || 0),
          vatRetained: round2(retention?.vatRetainedAmount || 0),
          totalRetained: round2(retention?.totalRetained || 0),
          crossPeriod,
          retentionDaysAfterPurchase,
          retentionOutOfTerm,
          atsTreatment: !retention
            ? "Compra sin comprobante de retencion relacionado"
            : retentionOutOfTerm
              ? `Revisar: retencion emitida ${retentionDaysAfterPurchase} dias despues de la factura; supera el plazo de 5 dias`
            : crossPeriod
              ? retentionPeriod === period
                ? `Retencion del periodo ${retentionPeriod}; compra ${purchasePeriod} solo como referencia`
                : `Compra del periodo ${purchasePeriod}; retencion registrada en ${retentionPeriod}`
              : `Compra y retencion en ${purchasePeriod || retentionPeriod || "periodo no definido"}`
        });
      });
    });
    retentionRows.filter(item => !matchedRetentionIds.has(item.id)).forEach(retention => {
      const retentionPeriod = periodKey(retention.retentionDate);
      if (period && !["BOTH", "RETENTION"].includes(normalizedScope) && normalizedScope !== "CROSS") return;
      if (period && retentionPeriod !== period) return;
      rows.push({
        id: `SIN_COMPRA:${retention.id}`,
        purchaseId: "",
        purchaseDate: "",
        accountingDate: "",
        purchasePeriod: "",
        supplierName: retention.supplierName || "",
        supplierRuc: retention.supplierRuc || "",
        purchaseDocumentNumber: retention.purchaseDocumentNumber || "",
        purchaseAuthorization: "",
        taxSupportCode: "",
        purchaseTotal: 0,
        ...purchaseTaxBreakdown(),
        purchaseStatus: "NO_ENCONTRADA",
        retentionDecision: "",
        retentionId: retention.id,
        retentionDate: retention.retentionDate || "",
        retentionPeriod,
        retentionNumber: retention.fullNumber || retention.draftNumber || "",
        retentionStatus: retention.status || "",
        rentRetained: round2(retention.rentRetainedAmount || 0),
        vatRetained: round2(retention.vatRetainedAmount || 0),
        totalRetained: round2(retention.totalRetained || 0),
        crossPeriod: false,
        retentionDaysAfterPurchase: null,
        retentionOutOfTerm: false,
          atsTreatment: "Revisar: retencion sin compra relacionada en JAEDER SYSTEMS"
      });
    });
    return rows.sort((a, b) => String(b.retentionDate || b.accountingDate).localeCompare(String(a.retentionDate || a.accountingDate)));
  }

  function accountedPurchaseReportRows(purchaseIds = []) {
    const allowedIds = new Set((purchaseIds || []).filter(Boolean));
    const accountedStatuses = new Set(["CONTABILIZADO", "PENDIENTE_RETENCION", "RETENIDO"]);
    const activeRetentions = issuedWithholdings()
      .map(normalizeIssuedWithholding)
      .filter(issuedWithholdingAffectsPayable);
    return purchases()
      .filter(purchase => (!allowedIds.size || allowedIds.has(purchase.id))
        && accountedStatuses.has(String(purchase.status || "").toUpperCase()))
      .map(purchase => {
        const tax = purchaseTaxBreakdown(purchase);
        const relatedRetentions = activeRetentions.filter(retention =>
          retention.purchaseId === purchase.id
          || (!retention.purchaseId && retention.purchaseDocumentNumber === purchase.documentNumber)
        );
        const retentionVat = round2(relatedRetentions.reduce((sum, item) => sum + Number(item.vatRetainedAmount || 0), 0));
        const retentionRent = round2(relatedRetentions.reduce((sum, item) => sum + Number(item.rentRetainedAmount || 0), 0));
        const retentionTotal = round2(retentionVat + retentionRent);
        const purchaseTotal = round2(purchase.totals?.total || 0);
        return {
          purchaseId: purchase.id,
          accountingNumber: purchase.journalEntryNumber || "",
          issueDate: purchase.issueDate || "",
          supplierRuc: purchase.supplierRuc || "",
          supplierName: purchase.supplierName || "",
          documentNumber: purchase.documentNumber || "",
          ...tax,
          purchaseTotal,
          retentionVat,
          retentionRent,
          retentionTotal,
          netPayable: round2(purchaseTotal - retentionTotal)
        };
      })
      .sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)) || String(b.accountingNumber).localeCompare(String(a.accountingNumber)));
  }

  function retentionDetailReportRows(options = {}) {
    const allowedRetentionIds = new Set((options.retentionIds || []).filter(Boolean));
    const allowedPurchaseIds = new Set((options.purchaseIds || []).filter(Boolean));
    return issuedWithholdings()
      .map(normalizeIssuedWithholding)
      .filter(retention => issuedWithholdingAffectsPayable(retention)
        && (!allowedRetentionIds.size || allowedRetentionIds.has(retention.id))
        && (!allowedPurchaseIds.size || allowedPurchaseIds.has(retention.purchaseId)))
      .flatMap(retention => (retention.retentionLines || [])
        .filter(line => line.code)
        .map(line => ({
          retentionId: retention.id,
          accountingNumber: retention.journalEntryNumber || "",
          supplierRuc: retention.supplierRuc || "",
          supplierName: retention.supplierName || "",
          originNumber: digits(retention.purchaseDocumentNumber).slice(-9),
          retentionNumber: retention.fullNumber || retention.draftNumber || "",
          retentionCode: line.sriCode || line.code || "",
          baseAmount: round2(line.baseAmount || 0),
          percentage: round2(line.percentage || 0),
          retainedAmount: round2(line.retainedAmount || 0),
          accessKey: retention.accessKey || ""
        })))
      .sort((a, b) => String(b.retentionNumber).localeCompare(String(a.retentionNumber)) || String(a.retentionCode).localeCompare(String(b.retentionCode)));
  }

  function purchasesPendingRetention() {
    if (!companyAllows("purchases.issueWithholdings")) return [];
    return purchases().filter(item =>
      item.status === "PENDIENTE_RETENCION"
      || (item.status === "CONTABILIZADO" && normalizePurchase(item).retentionDecision === "APLICAR")
    );
  }

  function normalizeIssuedWithholding(raw = {}) {
    const current = {
      ...emptyRetentionDraft(raw.purchaseId || ""),
      ...clone(raw || {})
    };
    const hasStoredLines = Object.prototype.hasOwnProperty.call(raw || {}, "retentionLines")
      && Array.isArray(raw.retentionLines);
    const legacyLines = [];
    if (!hasStoredLines && (current.rentCode || current.taxType === "RENTA")) {
      legacyLines.push({
        id: uid("RTL"),
        taxType: "RENTA",
        code: current.rentCode || current.code || "",
        sriCode: current.rentSriCode || current.sriCode || "",
        parameterId: current.rentParameterId || current.parameterId || "",
        description: current.rentDescription || current.description || "",
        baseAmount: current.rentBaseAmount || current.baseAmount || 0,
        percentage: current.rentPercentage || current.percentage || 0,
        retainedAmount: current.rentRetainedAmount || current.retainedAmount || 0,
        payableAccountCode: current.rentPayableAccountCode || current.payableAccountCode || ""
      });
    }
    if (!hasStoredLines && (current.vatCode || current.taxType === "IVA")) {
      legacyLines.push({
        id: uid("RTL"),
        taxType: "IVA",
        code: current.vatCode || current.code || "",
        sriCode: current.vatSriCode || current.sriCode || "",
        parameterId: current.vatParameterId || current.parameterId || "",
        description: current.vatDescription || current.description || "",
        baseAmount: current.vatBaseAmount || current.baseAmount || 0,
        percentage: current.vatPercentage || current.percentage || 0,
        retainedAmount: current.vatRetainedAmount || current.retainedAmount || 0,
        payableAccountCode: current.vatPayableAccountCode || current.payableAccountCode || ""
      });
    }
    const sourceLines = hasStoredLines ? raw.retentionLines : legacyLines;
    const retentionLines = sourceLines.map(line => {
      const taxType = String(line.taxType || "RENTA").trim().toUpperCase() === "IVA" ? "IVA" : "RENTA";
      const baseAmount = round2(line.baseAmount || 0);
      const percentage = round2(line.percentage || 0);
      return {
        id: String(line.id || uid("RTL")).trim(),
        taxType,
        code: String(line.code || "").trim(),
        sriCode: String(line.sriCode || line.code || "").trim(),
        parameterId: String(line.parameterId || "").trim(),
        description: String(line.description || "").trim(),
        baseAmount,
        percentage,
        retainedAmount: round2(baseAmount * percentage / 100),
        payableAccountCode: String(line.payableAccountCode || "").trim()
      };
    });
    const selectedLines = retentionLines.filter(line => line.code);
    const rentLines = selectedLines.filter(line => line.taxType === "RENTA");
    const vatLines = selectedLines.filter(line => line.taxType === "IVA");
    const firstRent = rentLines[0] || {};
    const firstVat = vatLines[0] || {};
    const rentBaseAmount = round2(rentLines.reduce((sum, line) => sum + Number(line.baseAmount || 0), 0));
    const rentRetainedAmount = round2(rentLines.reduce((sum, line) => sum + Number(line.retainedAmount || 0), 0));
    const vatBaseAmount = round2(vatLines.reduce((sum, line) => sum + Number(line.baseAmount || 0), 0));
    const vatRetainedAmount = round2(vatLines.reduce((sum, line) => sum + Number(line.retainedAmount || 0), 0));
    return {
      ...current,
      id: current.id || uid("RET"),
      purchaseDocumentNumber: String(current.purchaseDocumentNumber || "").trim(),
      supplierName: String(current.supplierName || "").trim(),
      supplierRuc: String(current.supplierRuc || "").trim(),
      retentionDate: String(current.retentionDate || today()).trim(),
      draftNumber: String(current.draftNumber || `RET-BOR-${String(cloneList("issuedWithholdings").length + 1).padStart(6, "0")}`).trim(),
      rentCode: String(firstRent.code || "").trim(),
      rentSriCode: String(firstRent.sriCode || "").trim(),
      rentParameterId: String(firstRent.parameterId || "").trim(),
      rentDescription: String(firstRent.description || "").trim(),
      rentBaseAmount,
      rentPercentage: round2(firstRent.percentage || 0),
      rentRetainedAmount,
      rentPayableAccountCode: String(firstRent.payableAccountCode || "").trim(),
      vatCode: String(firstVat.code || "").trim(),
      vatSriCode: String(firstVat.sriCode || "").trim(),
      vatParameterId: String(firstVat.parameterId || "").trim(),
      vatDescription: String(firstVat.description || "").trim(),
      vatBaseAmount,
      vatPercentage: round2(firstVat.percentage || 0),
      vatRetainedAmount,
      vatPayableAccountCode: String(firstVat.payableAccountCode || "").trim(),
      retentionLines,
      totalRetained: round2(rentRetainedAmount + vatRetainedAmount),
      journalEntryId: String(current.journalEntryId || "").trim(),
      journalEntryNumber: String(current.journalEntryNumber || "").trim(),
      reverseEntryId: String(current.reverseEntryId || "").trim(),
      reverseEntryNumber: String(current.reverseEntryNumber || "").trim(),
      fullNumber: String(current.fullNumber || current.retentionNumber || "").trim(),
      establishmentCode: current.establishmentCode ? digits(current.establishmentCode).padStart(3, "0").slice(-3) : "",
      emissionPointCode: current.emissionPointCode ? digits(current.emissionPointCode).padStart(3, "0").slice(-3) : "",
      sequential: digits(current.sequential).padStart(current.sequential ? 9 : 0, "0").slice(-9),
      accessKey: digits(current.accessKey),
      authorizationNumber: digits(current.authorizationNumber),
      authorizedAt: String(current.authorizedAt || "").trim(),
      authorizedXml: String(current.authorizedXml || "").trim(),
      environment: String(current.environment || "PRUEBAS").trim().toUpperCase(),
      emissionType: String(current.emissionType || "NORMAL").trim().toUpperCase(),
      preparedForAuthorizationAt: String(current.preparedForAuthorizationAt || "").trim(),
      preparedForAuthorizationBy: String(current.preparedForAuthorizationBy || "").trim(),
      preparedForAuthorizationById: String(current.preparedForAuthorizationById || "").trim(),
      authorizedBy: String(current.authorizedBy || "").trim(),
      authorizedById: String(current.authorizedById || "").trim(),
      status: retentionStatuses.includes(String(current.status || "").trim().toUpperCase())
        ? String(current.status || "").trim().toUpperCase()
        : "BORRADOR"
    };
  }

  function issuedWithholdingAffectsPayable(item) {
    return ["CONFIRMADA", "LISTA_PARA_AUTORIZAR", "AUTORIZADA"].includes(String(item.status || "").toUpperCase());
  }

  function appliedWithholdingsForPurchase(purchaseId) {
    return issuedWithholdings()
      .map(normalizeIssuedWithholding)
      .filter(item => item.purchaseId === purchaseId && issuedWithholdingAffectsPayable(item));
  }

  function retentionRequirementForPurchase(purchase) {
    if (!companyAllows("purchases.issueWithholdings")) return false;
    return normalizePurchase(purchase).retentionDecision === "APLICAR";
  }

  function syncPurchaseRetentionState(purchaseId) {
    const purchaseRows = purchases();
    const purchaseIndex = purchaseRows.findIndex(item => item.id === purchaseId);
    if (purchaseIndex < 0) return null;
    const purchase = normalizePurchase(purchaseRows[purchaseIndex]);
    const allRelated = issuedWithholdings().map(normalizeIssuedWithholding).filter(item => item.purchaseId === purchaseId);
    const impacting = allRelated.filter(issuedWithholdingAffectsPayable);
    const totalRetained = round2(impacting.reduce((sum, item) => sum + Number(item.totalRetained || 0), 0));
    purchase.totals = calculateTotals(purchase.lines, totalRetained);

    if (purchase.status !== "ANULADO" && isPostedStatus(purchase.status)) {
      if (totalRetained > 0) purchase.status = "RETENIDO";
      else purchase.status = retentionRequirementForPurchase(purchase) ? "PENDIENTE_RETENCION" : "CONTABILIZADO";
    }

    if (impacting.length) {
      purchase.retentionStatus = impacting[0].status;
    } else if (allRelated.some(item => item.status === "BORRADOR")) {
      purchase.retentionStatus = "BORRADOR";
    } else {
      purchase.retentionStatus = retentionRequirementForPurchase(purchase)
        ? "Pendiente de emitir"
        : purchase.retentionDecision === "NO_SUJETO_332"
          ? "No sujeta (332)"
          : "No emite retencion";
    }

    purchase.payableId = createOrUpdatePayable(purchase).id;
    purchaseRows[purchaseIndex] = purchase;
    saveList("purchases", purchaseRows);
    return purchase;
  }

  function validateWithholdingAccount(code, label) {
    const account = code ? chartService.findByCode(code) : null;
    const errors = [];
    if (!code) errors.push(`Debe configurar la cuenta ${label}.`);
    else if (!account) errors.push(`La cuenta ${label} no existe.`);
    else {
      if (account.status !== "Activa") errors.push(`La cuenta ${label} esta inactiva.`);
      if (!account.isMovement) errors.push(`La cuenta ${label} debe ser de movimiento.`);
    }
    return { account, errors };
  }

  function defaultRentPayableAccount() {
    return companyService.settings().defaultAccounts?.incomeTaxWithholdingPayable || "";
  }

  function defaultVatPayableAccount() {
    return companyService.settings().defaultAccounts?.vatWithholdingPayable || "";
  }

  function validateRetentionDraftShape(draft) {
    const normalized = normalizeIssuedWithholding(draft);
    const errors = [];
    const selectedLines = normalized.retentionLines.filter(line => line.code);
    if (!normalized.purchaseId) errors.push("Debe seleccionar una compra relacionada.");
    if (!selectedLines.length) errors.push("Debe seleccionar al menos un codigo de retencion.");
    selectedLines.forEach((line, index) => {
      if (String(line.sriCode || line.code) === "332") {
        errors.push(`La linea ${index + 1} usa el codigo 332, que se registra en la compra como no sujeto y no genera comprobante.`);
      }
      if (line.baseAmount <= 0) errors.push(`La linea ${index + 1} debe tener una base imponible mayor que cero.`);
      if (line.retainedAmount <= 0) errors.push(`La linea ${index + 1} debe tener un valor retenido mayor que cero.`);
    });
    if (normalized.totalRetained <= 0) errors.push("La retencion debe tener valor total mayor que cero.");
    return { retention: normalized, errors };
  }

  function buildIssuedWithholdingJournalEntry(retention, purchase) {
    const defaults = companyService.settings().defaultAccounts || {};
    const errors = [];
    const payableValidation = validateWithholdingAccount(defaults.accountsPayableSuppliers, "Cuentas por pagar proveedores");
    errors.push(...payableValidation.errors);
    const selectedLines = retention.retentionLines.filter(line => line.code);
    const lineValidations = selectedLines.map((line, index) => {
      const fallbackAccount = line.taxType === "IVA" ? defaultVatPayableAccount() : defaultRentPayableAccount();
      const validation = validateWithholdingAccount(
        line.payableAccountCode || fallbackAccount,
        `${line.taxType === "IVA" ? "Retenciones IVA" : "Retenciones fuente"} por pagar de la linea ${index + 1}`
      );
      errors.push(...validation.errors);
      return { line, account: validation.account };
    });
    if (retention.totalRetained <= 0) errors.push("La retencion no puede confirmarse con valor cero.");
    if (errors.length) return { ok: false, errors };

    const entry = journalService.emptyEntry();
    entry.accountingDate = retention.retentionDate;
    entry.accountingPeriod = journalService.accountingPeriodForDate?.(entry.accountingDate, entry.accountingPeriod)
      || String(entry.accountingDate || "").slice(0, 7)
      || entry.accountingPeriod;
    entry.concept = `Retencion emitida ${retention.draftNumber} - ${purchase.documentNumber}`;
    entry.originModule = "RETENCIONES_EMITIDAS";
    entry.sourceDocument = retention.draftNumber;
    entry.externalReference = purchase.authorizationNumber || purchase.accessKey || purchase.documentNumber;
    entry.observation = `Retencion emitida sobre compra ${purchase.documentNumber}`;
    entry.lines = [
      {
        id: uid("JLN"),
        accountCode: payableValidation.account.code,
        accountName: payableValidation.account.name,
        debit: round2(retention.totalRetained),
        credit: 0,
        costCenter: "",
        auxiliary: purchase.supplierRuc,
        lineDescription: `Retencion sobre ${purchase.documentNumber}`,
        documentReference: purchase.documentNumber
      }
    ];
    lineValidations.forEach(({ line, account }) => {
      if (!account) return;
      entry.lines.push({
        id: uid("JLN"),
        accountCode: account.code,
        accountName: account.name,
        debit: 0,
        credit: round2(line.retainedAmount),
        costCenter: "",
        auxiliary: purchase.supplierRuc,
        lineDescription: `Retencion ${line.taxType} ${line.sriCode || line.code}`,
        documentReference: retention.draftNumber
      });
    });
    return { ok: true, entry };
  }

  function saveRetentionDraft(draft) {
    if (!companyAllows("purchases.issueWithholdings")) return retentionCapabilityError();
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const prepared = normalizeIssuedWithholding(draft);
    const errors = [];
    const purchase = purchases().find(item => item.id === prepared.purchaseId);
    if (!purchase) errors.push("La compra relacionada no existe.");
    else if (normalizePurchase(purchase).retentionDecision !== "APLICAR") {
      errors.push("La compra no esta marcada para aplicar retencion. Revise primero su tratamiento tributario.");
    }

    const validatedLines = prepared.retentionLines.map((line, index) => {
      if (!line.code) return line;
      const validation = taxConfigService.validateRetentionActiveOnDate(
        line.code,
        prepared.retentionDate || purchase?.accountingDate || today(),
        { taxType: line.taxType, appliesTo: "compra" }
      );
      if (!validation.ok) {
        (validation.errors || []).forEach(message => errors.push(`Linea ${index + 1}: ${message}`));
        return line;
      }
      const parameter = validation.retention || {};
      const percentage = round2(parameter.percentage ?? line.percentage ?? 0);
      return {
        ...line,
        parameterId: parameter.id || line.parameterId || "",
        sriCode: parameter.sriCode || line.sriCode || line.code,
        description: parameter.description || line.description || "",
        percentage,
        retainedAmount: round2(line.baseAmount * percentage / 100),
        payableAccountCode: parameter.payableAccountCode
          || line.payableAccountCode
          || (line.taxType === "IVA" ? defaultVatPayableAccount() : defaultRentPayableAccount())
      };
    });

    if (errors.length) return { ok: false, errors: [...new Set(errors)] };

    const normalized = normalizeIssuedWithholding({
      ...prepared,
      supplierName: purchase?.supplierName || prepared.supplierName || "",
      supplierRuc: purchase?.supplierRuc || prepared.supplierRuc || "",
      purchaseDocumentNumber: purchase?.documentNumber || prepared.purchaseDocumentNumber || "",
      retentionLines: validatedLines,
      status: ["BORRADOR", "LISTA_PARA_AUTORIZAR"].includes(prepared.status) ? prepared.status : "BORRADOR"
    });
    const shapeValidation = validateRetentionDraftShape(normalized);
    if (shapeValidation.errors.length) return { ok: false, errors: [...new Set(shapeValidation.errors)] };

    const index = rows.findIndex(item => item.id === normalized.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = normalized;
    else rows.unshift(normalized);
    saveList("issuedWithholdings", rows);
    syncPurchaseRetentionState(normalized.purchaseId);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: index >= 0 ? "EDITAR_RETENCION_EMITIDA" : "CREAR_RETENCION_EMITIDA",
      entityType: "issued_withholding",
      entityId: normalized.id,
      entityLabel: normalized.draftNumber,
      documentLabel: normalized.draftNumber,
      previousStatus: before?.status || "",
      nextStatus: normalized.status,
      description: `${index >= 0 ? "Se actualizo" : "Se guardo"} la retencion emitida ${normalized.draftNumber}.`,
      before,
      after: normalized,
      result: "exitoso"
    });
    return { ok: true, retention: clone(normalized) };
  }

  function confirmRetentionDraft(retentionId) {
    if (!companyAllows("purchases.issueWithholdings")) return retentionCapabilityError();
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const index = rows.findIndex(item => item.id === retentionId);
    if (index < 0) return { ok: false, errors: ["Retencion emitida no encontrada."] };
    const target = rows[index];
    if (!["BORRADOR", "LISTA_PARA_AUTORIZAR"].includes(target.status)) {
      return { ok: false, errors: ["Solo se pueden confirmar retenciones en borrador o listas para autorizar."] };
    }
    if (target.journalEntryId) return { ok: false, errors: ["La retencion ya tiene asiento contable."] };
    const purchase = purchases().find(item => item.id === target.purchaseId);
    if (!purchase) return { ok: false, errors: ["La compra relacionada no existe."] };
    if (normalizePurchase(purchase).retentionDecision !== "APLICAR") {
      return { ok: false, errors: ["La compra no esta marcada para aplicar retencion."] };
    }

    const build = buildIssuedWithholdingJournalEntry(target, purchase);
    if (!build.ok) return build;
    const savedEntry = journalService.saveDraft(build.entry);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento de retencion."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar la retencion."] };

    target.status = "CONFIRMADA";
    target.journalEntryId = postedEntry.entry.id;
    target.journalEntryNumber = postedEntry.entry.entryNumber;
    rows[index] = normalizeIssuedWithholding(target);
    saveList("issuedWithholdings", rows);
    const syncedPurchase = syncPurchaseRetentionState(target.purchaseId);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "CONFIRMAR_RETENCION_EMITIDA",
      entityType: "issued_withholding",
      entityId: target.id,
      entityLabel: target.draftNumber,
      documentLabel: target.draftNumber,
      previousStatus: "BORRADOR",
      nextStatus: target.status,
      description: `Retencion emitida ${target.draftNumber} confirmada con asiento ${target.journalEntryNumber}.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, retention: clone(rows[index]), purchase: clone(syncedPurchase), entry: clone(postedEntry.entry) };
  }

  function nextRetentionSequential(rows = issuedWithholdings()) {
    const configured = adminService?.findSequenceByCode?.("RETE") || {};
    const maximum = rows
      .map(item => {
        const full = /^(\d{3})-(\d{3})-(\d{9})$/.exec(String(item.fullNumber || "").trim());
        if (!full) return 0;
        if (full[1] !== (configured.establishmentCode || "001")
          || full[2] !== (configured.emissionPointCode || "002")) return 0;
        return Number(full[3]) || 0;
      })
      .reduce((max, value) => Math.max(max, value), Math.max(0, Number(configured.currentNumber || 0)));
    if (maximum >= 999999999) throw new Error("El secuencial SRI de retenciones alcanzo el limite de 9 digitos.");
    return String(maximum + 1).padStart(9, "0");
  }

  function retentionEmissionCodes() {
    const settings = companyService.settings() || {};
    const configured = adminService?.findSequenceByCode?.("RETE") || {};
    return {
      establishmentCode: digits(
        configured.establishmentCode
        || settings.retentionEstablishmentCode
        || settings.sriEstablishmentCode
        || settings.establishmentCode
        || "001"
      ).padStart(3, "0").slice(-3),
      emissionPointCode: digits(
        configured.emissionPointCode
        || settings.retentionEmissionPointCode
        || settings.sriEmissionPointCode
        || settings.emissionPointCode
        || "002"
      ).padStart(3, "0").slice(-3)
    };
  }

  function prepareRetentionForAuthorization(retentionId) {
    if (!companyAllows("purchases.issueWithholdings")) return retentionCapabilityError();
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const index = rows.findIndex(item => item.id === retentionId);
    if (index < 0) return { ok: false, errors: ["Retencion emitida no encontrada."] };
    const target = rows[index];
    if (target.status === "LISTA_PARA_AUTORIZAR") return { ok: true, retention: clone(target) };
    if (target.status !== "CONFIRMADA") {
      return { ok: false, errors: ["Primero debe confirmar y contabilizar la retencion."] };
    }
    if (!target.journalEntryId) return { ok: false, errors: ["La retencion no tiene asiento contable confirmado."] };

    const sequence = nextRetentionSequential(rows);
    const codes = retentionEmissionCodes();
    let keyResult;
    try {
      const companyKey = BlessERP.sriApi?.activeCompanyKey?.();
      keyResult = BlessERP.sriApi?.buildTestAccessKey?.({
        companyKey,
        documentType: "07",
        issueDate: target.retentionDate,
        establishmentCode: codes.establishmentCode,
        emissionPointCode: codes.emissionPointCode,
        sequential: sequence
      });
    } catch (error) {
      return { ok: false, errors: [error?.message || "No se pudo construir la clave de acceso de la retencion."] };
    }
    if (!keyResult?.accessKey) {
      return { ok: false, errors: ["El servicio local SRI no esta disponible para preparar la clave de acceso."] };
    }

    target.establishmentCode = codes.establishmentCode;
    target.emissionPointCode = codes.emissionPointCode;
    target.sequential = sequence;
    target.fullNumber = `${codes.establishmentCode}-${codes.emissionPointCode}-${sequence}`;
    target.accessKey = keyResult.accessKey;
    target.environment = keyResult.environment || "PRUEBAS";
    target.preparedForAuthorizationAt = new Date().toISOString();
    target.preparedForAuthorizationBy = currentUser().name;
    target.preparedForAuthorizationById = currentUser().id;
    target.status = "LISTA_PARA_AUTORIZAR";
    rows[index] = normalizeIssuedWithholding(target);
    saveList("issuedWithholdings", rows);
    syncPurchaseRetentionState(target.purchaseId);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "PREPARAR_AUTORIZACION_RETENCION",
      entityType: "issued_withholding",
      entityId: target.id,
      entityLabel: target.fullNumber,
      documentLabel: target.fullNumber,
      previousStatus: "CONFIRMADA",
      nextStatus: "LISTA_PARA_AUTORIZAR",
      description: `Retencion ${target.fullNumber} preparada para autorizacion electronica en ambiente de pruebas.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, retention: clone(rows[index]) };
  }

  function validateRetentionAuthorization(retention, input = {}) {
    const errors = [];
    const accessKey = digits(input.accessKey || retention.accessKey);
    const authorizationNumber = digits(input.authorizationNumber || accessKey);
    const authorizedAt = String(input.authorizedAt || "").trim();
    const authorizedXml = String(input.authorizedXml || "").trim();
    const parsed = BlessERP.sriApi?.parseAccessKey?.(accessKey);
    if (!/^\d{49}$/.test(accessKey)) errors.push("La clave de acceso debe contener 49 digitos.");
    if (parsed && !parsed.validModulo11) errors.push("La clave de acceso no supera la validacion modulo 11.");
    if (parsed && parsed.documentType !== "07") errors.push("La clave de acceso no corresponde a un comprobante de retencion tipo 07.");
    if (!/^\d{49}$/.test(authorizationNumber)) errors.push("El numero de autorizacion debe contener 49 digitos.");
    if (!authorizedAt) errors.push("Debe registrar la fecha y hora devuelta por el SRI.");
    if (!authorizedXml) errors.push("Debe pegar o cargar el XML autorizado devuelto por el SRI.");
    if (authorizedXml && !authorizedXml.includes(accessKey)) errors.push("El XML autorizado no contiene la clave de acceso preparada.");
    if (authorizedXml && !authorizedXml.includes(authorizationNumber)) errors.push("El XML autorizado no contiene el numero de autorizacion registrado.");
    if (authorizedXml
      && BlessERP.softwareProvider?.billingSystemProviderEnabled
      && !BlessERP.softwareProvider.hasExpectedProviderField(authorizedXml)) {
      errors.push(`El XML autorizado no contiene el campo adicional obligatorio RUC Proveedor ${BlessERP.softwareProvider.providerRuc}.`);
    }
    return { errors: [...new Set(errors)], accessKey, authorizationNumber, authorizedAt, authorizedXml };
  }

  function registerRetentionAuthorization(retentionId, input = {}) {
    if (!companyAllows("purchases.issueWithholdings")) return retentionCapabilityError();
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const index = rows.findIndex(item => item.id === retentionId);
    if (index < 0) return { ok: false, errors: ["Retencion emitida no encontrada."] };
    const target = rows[index];
    if (target.status !== "LISTA_PARA_AUTORIZAR") {
      return { ok: false, errors: ["La retencion debe estar lista para autorizar antes de registrar la respuesta del SRI."] };
    }
    const validation = validateRetentionAuthorization(target, input);
    if (validation.errors.length) return { ok: false, errors: validation.errors };
    target.accessKey = validation.accessKey;
    target.authorizationNumber = validation.authorizationNumber;
    target.authorizedAt = validation.authorizedAt;
    target.authorizedXml = validation.authorizedXml;
    target.environment = String(input.environment || target.environment || "PRUEBAS").trim().toUpperCase();
    target.authorizedBy = currentUser().name;
    target.authorizedById = currentUser().id;
    target.status = "AUTORIZADA";
    rows[index] = normalizeIssuedWithholding(target);
    saveList("issuedWithholdings", rows);
    syncPurchaseRetentionState(target.purchaseId);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "REGISTRAR_AUTORIZACION_SRI_RETENCION",
      entityType: "issued_withholding",
      entityId: target.id,
      entityLabel: target.fullNumber,
      documentLabel: target.fullNumber,
      previousStatus: "LISTA_PARA_AUTORIZAR",
      nextStatus: "AUTORIZADA",
      description: `Se registro la autorizacion SRI de la retencion ${target.fullNumber}.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, retention: clone(rows[index]) };
  }

  function syncRemoteRetentionAuthorization(retentionId, detail = {}) {
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const index = rows.findIndex(item => item.id === retentionId);
    if (index < 0) return { ok: false, errors: ["Retencion emitida no encontrada."] };
    const target = rows[index];
    const previousStatus = target.status;
    const document = detail.document || detail || {};
    const authorization = (detail.authorizations || []).find(item =>
      String(item.authorization_status || "").toUpperCase() === "AUTORIZADO"
    ) || (detail.authorizations || [])[0] || {};
    const remoteStatus = String(document.status || "").trim().toUpperCase();
    if (String(document.document_type || document.documentType || "07") !== "07") {
      return { ok: false, errors: ["La respuesta remota no corresponde a una retencion SRI tipo 07."] };
    }
    const establishmentCode = digits(document.establishment_code || document.establishmentCode || target.establishmentCode).padStart(3, "0").slice(-3);
    const emissionPointCode = digits(document.emission_point_code || document.emissionPointCode || target.emissionPointCode).padStart(3, "0").slice(-3);
    const sequential = digits(document.sequential || target.sequential).padStart(9, "0").slice(-9);
    target.sriRemoteDocumentId = String(document.id || target.sriRemoteDocumentId || "");
    target.sriRemoteStatus = remoteStatus || target.sriRemoteStatus || "";
    target.sriLastError = String(document.last_error || document.lastError || "");
    target.establishmentCode = establishmentCode;
    target.emissionPointCode = emissionPointCode;
    target.sequential = sequential;
    if (establishmentCode && emissionPointCode && sequential) {
      target.fullNumber = `${establishmentCode}-${emissionPointCode}-${sequential}`;
    }
    target.accessKey = digits(document.access_key || document.accessKey || target.accessKey);
    target.environment = String(document.environment || target.environment || "PRUEBAS").toUpperCase() === "TEST" ? "PRUEBAS" : String(document.environment || target.environment || "PRUEBAS").toUpperCase();
    if (remoteStatus === "AUTORIZADO") {
      target.status = "AUTORIZADA";
      target.authorizationNumber = digits(
        document.authorization_number
        || document.authorizationNumber
        || authorization.authorization_number
        || target.accessKey
      );
      target.authorizedAt = String(
        document.authorized_at
        || document.authorizedAt
        || authorization.authorization_date
        || new Date().toISOString()
      );
      target.authorizedXml = String(authorization.authorized_xml || target.authorizedXml || "");
      target.authorizedBy = currentUser().name;
      target.authorizedById = currentUser().id;
    } else if (target.status === "CONFIRMADA") {
      target.status = "LISTA_PARA_AUTORIZAR";
    }
    rows[index] = normalizeIssuedWithholding(target);
    saveList("issuedWithholdings", rows);
    syncPurchaseRetentionState(target.purchaseId);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "SINCRONIZAR_RETENCION_SRI",
      entityType: "issued_withholding",
      entityId: target.id,
      entityLabel: target.fullNumber || target.draftNumber,
      documentLabel: target.fullNumber || target.draftNumber,
      previousStatus,
      nextStatus: rows[index].status,
      description: `Retencion sincronizada con SRI en estado ${remoteStatus || "SIN RESPUESTA"}.`,
      after: rows[index],
      result: remoteStatus === "AUTORIZADO" ? "exitoso" : "pendiente"
    });
    return { ok: true, retention: clone(rows[index]), remoteStatus };
  }

  function recordRetentionSriError(retentionId, message = "", technical = {}) {
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const index = rows.findIndex(item => item.id === retentionId);
    if (index < 0) return { ok: false, errors: ["Retencion emitida no encontrada."] };
    const target = rows[index];
    const previousStatus = target.status;
    target.sriLastError = String(message || "No se pudo completar el proceso SRI.").trim();
    target.sriLastErrorCode = String(technical.code || "").trim();
    target.sriLastErrorStage = String(technical.stage || "").trim();
    target.sriLastErrorAt = new Date().toISOString();
    if (target.journalEntryId && target.status === "CONFIRMADA") target.status = "LISTA_PARA_AUTORIZAR";
    rows[index] = normalizeIssuedWithholding(target);
    saveList("issuedWithholdings", rows);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "ERROR_AUTORIZACION_SRI_RETENCION",
      entityType: "issued_withholding",
      entityId: target.id,
      entityLabel: target.fullNumber || target.draftNumber,
      documentLabel: target.fullNumber || target.draftNumber,
      previousStatus,
      nextStatus: rows[index].status,
      description: target.sriLastError,
      after: rows[index],
      result: "error"
    });
    return { ok: true, retention: clone(rows[index]) };
  }

  function annulRetention(retentionId, reason = "") {
    if (!companyAllows("purchases.issueWithholdings")) {
      return { ...retentionCapabilityError(), message: retentionCapabilityError().errors[0] };
    }
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const index = rows.findIndex(item => item.id === retentionId);
    if (index < 0) return { ok: false, message: "Retencion emitida no encontrada." };
    const target = rows[index];
    if (target.status === "ANULADA") return { ok: false, message: "La retencion ya esta anulada." };
    const previousStatus = target.status;
    const annulReason = String(reason || "").trim();
    if (!annulReason) return { ok: false, message: "Debe indicar el motivo de anulacion." };
    if (target.journalEntryId && issuedWithholdingAffectsPayable(target)) {
      const reversed = journalService.reverseEntry(target.journalEntryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar la retencion emitida." };
      target.reverseEntryId = reversed.entry.id;
      target.reverseEntryNumber = reversed.entry.entryNumber;
    }
    target.status = "ANULADA";
    target.annulReason = annulReason;
    target.annulledAt = new Date().toISOString();
    target.annulledBy = currentUser().name;
    target.annulledById = currentUser().id;
    rows[index] = normalizeIssuedWithholding(target);
    saveList("issuedWithholdings", rows);
    const syncedPurchase = syncPurchaseRetentionState(target.purchaseId);
    adminService?.addAuditLog?.({
      module: "COMPRAS",
      action: "ANULAR_RETENCION_EMITIDA",
      entityType: "issued_withholding",
      entityId: target.id,
      entityLabel: target.draftNumber,
      documentLabel: target.draftNumber,
      previousStatus,
      nextStatus: target.status,
      description: `Retencion emitida ${target.draftNumber} anulada. Motivo: ${annulReason}.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, retention: clone(rows[index]), purchase: clone(syncedPurchase) };
  }

  function replacementRetentionDraft(retentionId) {
    if (!companyAllows("purchases.issueWithholdings")) return retentionCapabilityError();
    const source = issuedWithholdings().map(normalizeIssuedWithholding).find(item => item.id === retentionId);
    if (!source) return { ok: false, errors: ["Retencion emitida no encontrada."] };
    if (source.status !== "ANULADA") return { ok: false, errors: ["Solo una retencion anulada puede originar un reemplazo."] };
    const draft = normalizeIssuedWithholding({
      ...source,
      id: "",
      draftNumber: `RET-BOR-${String(issuedWithholdings().length + 1).padStart(6, "0")}`,
      retentionDate: today(),
      status: "BORRADOR",
      fullNumber: "",
      sequential: "",
      accessKey: "",
      authorizationNumber: "",
      authorizedAt: "",
      authorizedXml: "",
      journalEntryId: "",
      journalEntryNumber: "",
      reverseEntryId: "",
      reverseEntryNumber: "",
      replacementOfId: source.id,
      replacementOfNumber: source.fullNumber || source.draftNumber,
      annulReason: "",
      annulledAt: "",
      annulledBy: "",
      annulledById: "",
      retentionLines: (source.retentionLines || []).map(line => ({ ...line, id: uid("RTL") }))
    });
    return { ok: true, retention: draft };
  }

  function issuedWithholdingSummary() {
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    return {
      drafts: rows.filter(item => item.status === "BORRADOR").length,
      confirmed: rows.filter(item => item.status === "CONFIRMADA").length,
      pendingAuthorization: rows.filter(item => item.status === "LISTA_PARA_AUTORIZAR").length,
      totalRentPayable: round2(rows.filter(item => issuedWithholdingAffectsPayable(item)).reduce((sum, item) => sum + Number(item.rentRetainedAmount || 0), 0)),
      totalVatPayable: round2(rows.filter(item => issuedWithholdingAffectsPayable(item)).reduce((sum, item) => sum + Number(item.vatRetainedAmount || 0), 0))
    };
  }

  function purchaseDashboardSummary() {
    const rows = purchases();
    const payables = purchasePayables();
    return {
      total: rows.length,
      drafts: rows.filter(item => item.status === "BORRADOR").length,
      xmlPending: rows.filter(item => ["XML_LEIDO", "PENDIENTE_CLASIFICACION"].includes(item.status)).length,
      pendingRetention: rows.filter(item => item.status === "PENDIENTE_RETENCION").length,
      retained: rows.filter(item => item.status === "RETENIDO").length,
      totalPayables: round2(payables.reduce((sum, item) => sum + Number(item.balance || 0), 0))
    };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.purchases = {
    purchaseStatuses,
    importStatuses,
    retentionStatuses,
    retentionDecisions,
    voucherTypes,
    paymentMethods,
    lineTypes,
    providers,
    purchases,
    purchasePayables,
    taxSupports,
    purchaseTypes,
    withholdingCatalog,
    purchaseMemory,
    issuedWithholdings,
    findProviderById,
    findProviderByRuc,
    taxSupportByCode,
    purchaseTypeByCode,
    withholdingByCode,
    voucherLabel,
    purchaseTypeLabel,
    purchaseTypeUsesInventory,
    inventoryCategoriesForPurchaseType,
    inventoryCategoryLabel,
    inventoryItemsForPurchaseType,
    buildDocumentNumber,
    duplicateKeyForPurchase,
    emptyLine,
    emptyPurchase,
    buildPurchaseJournalEntry,
    emptyRetentionLine,
    emptyRetentionDraft,
    normalizePurchase,
    calculateTotals,
    canEditPurchase,
    validatePurchase,
    savePurchase,
    postPurchase,
    postPurchaseV2,
    deleteOrAnnulPurchase,
    deleteOrAnnulPurchaseV2,
    parseXmlString,
    parseXmlFile,
    registerProvidersFromXmlBatch,
    registerProvidersFromXmlBatchV2,
    detectXmlBatchDuplicates,
    resolveProvidersFromXmlBatchV2,
    importXmlBatch,
    purchaseTaxBreakdown,
    purchaseRetentionReport,
    accountedPurchaseReportRows,
    retentionDetailReportRows,
    purchasesPendingRetention,
    saveRetentionDraft,
    confirmRetentionDraft,
    prepareRetentionForAuthorization,
    registerRetentionAuthorization,
    syncRemoteRetentionAuthorization,
    recordRetentionSriError,
    validateRetentionAuthorization,
    annulRetention,
    replacementRetentionDraft,
    issuedWithholdingSummary,
    purchaseDashboardSummary
  };
})();
