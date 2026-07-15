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
  const voucherTypes = [
    { code: "factura", label: "Factura" },
    { code: "liquidacion_compra", label: "Liquidacion de compra" },
    { code: "nota_credito", label: "Nota de credito" },
    { code: "nota_debito", label: "Nota de debito" }
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

  function pad9(value) {
    const raw = String(value || "").replace(/\D/g, "");
    return raw.padStart(9, "0").slice(-9);
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

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function inventoryApi() {
    return BlessERP.services.inventory || {};
  }

  function saveList(key, value) {
    stateApi.state.db[key] = value;
    stateApi.saveDb();
  }

  function providers() {
    return cloneList("providers");
  }

  function purchases() {
    return cloneList("purchases");
  }

  function purchasePayables() {
    return cloneList("purchasePayables");
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

  function withholdingCatalog(type = "") {
    return taxConfigService
      .retentions({ taxType: type || "", appliesTo: "compra", onlyActive: true })
      .map(toLegacyWithholding);
  }

  function purchaseMemory() {
    return cloneList("purchaseMemory");
  }

  function issuedWithholdings() {
    return cloneList("issuedWithholdings").map(normalizeIssuedWithholding);
  }

  function findProviderById(providerId) {
    return providers().find(item => item.id === providerId);
  }

  function findProviderByRuc(ruc) {
    return providers().find(item => item.ruc === ruc);
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
    return toLegacyWithholding(taxConfigService.findRetentionByCode(code));
  }

  function voucherLabel(code) {
    return voucherTypes.find(item => item.code === code)?.label || code;
  }

  function purchaseTypeLabel(code) {
    return purchaseTypeByCode(code)?.label || code;
  }

  function purchaseTypeUsesInventory(code = "") {
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
    const estab = String(input.estab || "").padStart(3, "0");
    const ptoEmi = String(input.ptoEmi || "").padStart(3, "0");
    const sequential = pad9(input.sequential || "");
    return estab && ptoEmi && sequential ? `${estab}-${ptoEmi}-${sequential}` : "";
  }

  function duplicateKeyForPurchase(purchase) {
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
      issueDate: today(),
      accountingDate: today(),
      dueDate: "",
      voucherType: "factura",
      estab: settings.mainEstablishment || "001",
      ptoEmi: settings.mainEmissionPoint || "001",
      sequential: nextSequential(settings.mainEstablishment || "001", settings.mainEmissionPoint || "001"),
      authorizationNumber: "",
      accessKey: "",
      taxSupportCode: "02",
      purchaseType: "GASTO",
      observation: "",
      status: "BORRADOR",
      retentionStatus: "Pendiente",
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

  function emptyRetentionDraft(purchaseId = "") {
    const purchase = purchases().find(item => item.id === purchaseId);
    return {
      id: "",
      purchaseId,
      supplierName: purchase?.supplierName || "",
      supplierRuc: purchase?.supplierRuc || "",
      retentionDate: purchase?.accountingDate || today(),
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
      totalRetained: 0,
      journalEntryId: "",
      journalEntryNumber: "",
      reverseEntryId: "",
      reverseEntryNumber: "",
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
    const provider = candidate.supplierId ? findProviderById(candidate.supplierId) : findProviderByRuc(candidate.supplierRuc);
    if (provider) {
      candidate.supplierId = provider.id;
      if (!candidate.supplierName) candidate.supplierName = provider.name;
      if (!candidate.supplierRuc) candidate.supplierRuc = provider.ruc;
      if (!candidate.supplierAddress) candidate.supplierAddress = provider.address || "";
    }
    candidate.issueDate = candidate.issueDate || today();
    candidate.accountingDate = candidate.accountingDate || candidate.issueDate;
    candidate.estab = String(candidate.estab || "001").padStart(3, "0");
    candidate.ptoEmi = String(candidate.ptoEmi || "001").padStart(3, "0");
    candidate.sequential = pad9(candidate.sequential || nextSequential(candidate.estab, candidate.ptoEmi));
    candidate.taxSupportCode = String(candidate.taxSupportCode || "").trim();
    candidate.purchaseType = canonicalPurchaseTypeCode(candidate.purchaseType);
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
    if (!candidate.estab || !candidate.ptoEmi || !candidate.sequential) errors.push("Serie, punto de emision y secuencial son obligatorios.");
    if (!candidate.taxSupportCode) errors.push("Debe seleccionar un sustento tributario.");
    if (!candidate.purchaseType) errors.push("Debe seleccionar un tipo de compra.");
    if (!candidate.lines.length) errors.push("Debe existir al menos una linea de compra.");

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
      if (!defaults.accountsPayableSuppliers) errors.push("No existe cuenta por pagar a proveedores predeterminada.");
      if (Number(candidate.totals.iva || 0) > 0 && !defaults.vatPurchases) errors.push("No existe cuenta IVA compras predeterminada.");
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
    const vatPurchases = chartService.findByCode(defaults.vatPurchases);
    const entry = journalService.emptyEntry();
    entry.accountingDate = purchase.accountingDate;
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
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
    if (Number(purchase.totals.iva || 0) > 0 && vatPurchases) {
      entry.lines.push({
        id: uid("JLN"),
        accountCode: vatPurchases.code,
        accountName: vatPurchases.name,
        debit: round2(purchase.totals.iva),
        credit: 0,
        costCenter: "",
        auxiliary: "",
        lineDescription: "IVA compras",
        documentReference: purchase.documentNumber
      });
    }
    entry.lines.push({
      id: uid("JLN"),
      accountCode: accountsPayable.code,
      accountName: accountsPayable.name,
      debit: 0,
      credit: round2(purchase.totals.total),
      costCenter: "",
      auxiliary: purchase.supplierRuc,
      lineDescription: `Proveedor ${purchase.supplierName}`,
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
    const typeConfig = purchaseTypeByCode(candidate.purchaseType);
    candidate.status = typeConfig?.requiresRetentionRent || typeConfig?.requiresRetentionVat
      ? "PENDIENTE_RETENCION"
      : "CONTABILIZADO";
    candidate.retentionStatus = candidate.status === "PENDIENTE_RETENCION" ? "Pendiente" : "No requerida";
    candidate.payableId = createOrUpdatePayable(candidate).id;
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
      const issueDate = pickText(doc, ["fechaEmision", "infoFactura > fechaEmision"]);
      const estab = pickText(doc, ["estab"]);
      const ptoEmi = pickText(doc, ["ptoEmi"]);
      const sequential = pickText(doc, ["secuencial"]);
      const details = Array.from(doc.querySelectorAll("detalle")).map(node => {
        const quantity = round2(pickText(node, ["cantidad"]) || 1);
        const unitPrice = round2(pickText(node, ["precioUnitario"]) || 0);
        const discount = round2(pickText(node, ["descuento"]) || 0);
        const taxableBase = round2(pickText(node, ["precioTotalSinImpuesto"]) || (quantity * unitPrice - discount));
        const vatNode = node.querySelector("impuesto");
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
        supplierAddress: findProviderByRuc(supplierRuc)?.address || "",
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
        observation: `Importado desde ${fileName || "XML"}`,
        status: "XML_LEIDO",
        retentionStatus: "Pendiente",
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
      candidate.importStatus = "IMPORTADO";
      rows.unshift(candidate);
      results.push({ fileName: item.fileName, imported: true, purchaseId: candidate.id });
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
      imported: results.filter(item => item.imported).length
    };
  }

  function purchasesPendingRetention() {
    return purchases().filter(item => item.status === "PENDIENTE_RETENCION" || item.status === "CONTABILIZADO");
  }

  function normalizeIssuedWithholding(raw = {}) {
    const current = {
      ...emptyRetentionDraft(raw.purchaseId || ""),
      ...clone(raw || {})
    };
    const rentBaseAmount = round2(current.rentBaseAmount || current.baseAmount || 0);
    const rentPercentage = round2(current.rentPercentage || (current.taxType === "RENTA" ? current.percentage : 0) || 0);
    const rentRetainedAmount = round2(current.rentRetainedAmount || (current.taxType === "RENTA" ? current.retainedAmount : 0) || (rentBaseAmount * rentPercentage / 100));
    const vatBaseAmount = round2(current.vatBaseAmount || (current.taxType === "IVA" ? current.baseAmount : 0) || 0);
    const vatPercentage = round2(current.vatPercentage || (current.taxType === "IVA" ? current.percentage : 0) || 0);
    const vatRetainedAmount = round2(current.vatRetainedAmount || (current.taxType === "IVA" ? current.retainedAmount : 0) || (vatBaseAmount * vatPercentage / 100));
    return {
      ...current,
      id: current.id || uid("RET"),
      purchaseDocumentNumber: String(current.purchaseDocumentNumber || "").trim(),
      supplierName: String(current.supplierName || "").trim(),
      supplierRuc: String(current.supplierRuc || "").trim(),
      retentionDate: String(current.retentionDate || today()).trim(),
      draftNumber: String(current.draftNumber || `RET-BOR-${String(cloneList("issuedWithholdings").length + 1).padStart(6, "0")}`).trim(),
      rentCode: String(current.rentCode || (current.taxType === "RENTA" ? current.code : "") || "").trim(),
      rentSriCode: String(current.rentSriCode || (current.taxType === "RENTA" ? current.sriCode : "") || "").trim(),
      rentParameterId: String(current.rentParameterId || (current.taxType === "RENTA" ? current.parameterId : "") || "").trim(),
      rentDescription: String(current.rentDescription || (current.taxType === "RENTA" ? current.description : "") || "").trim(),
      rentBaseAmount,
      rentPercentage,
      rentRetainedAmount,
      rentPayableAccountCode: String(current.rentPayableAccountCode || (current.taxType === "RENTA" ? current.payableAccountCode : "") || "").trim(),
      vatCode: String(current.vatCode || (current.taxType === "IVA" ? current.code : "") || "").trim(),
      vatSriCode: String(current.vatSriCode || (current.taxType === "IVA" ? current.sriCode : "") || "").trim(),
      vatParameterId: String(current.vatParameterId || (current.taxType === "IVA" ? current.parameterId : "") || "").trim(),
      vatDescription: String(current.vatDescription || (current.taxType === "IVA" ? current.description : "") || "").trim(),
      vatBaseAmount,
      vatPercentage,
      vatRetainedAmount,
      vatPayableAccountCode: String(current.vatPayableAccountCode || (current.taxType === "IVA" ? current.payableAccountCode : "") || "").trim(),
      totalRetained: round2(current.totalRetained || rentRetainedAmount + vatRetainedAmount),
      journalEntryId: String(current.journalEntryId || "").trim(),
      journalEntryNumber: String(current.journalEntryNumber || "").trim(),
      reverseEntryId: String(current.reverseEntryId || "").trim(),
      reverseEntryNumber: String(current.reverseEntryNumber || "").trim(),
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
    const typeConfig = purchaseTypeByCode(purchase.purchaseType);
    return Boolean(typeConfig?.requiresRetentionRent || typeConfig?.requiresRetentionVat);
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
      purchase.retentionStatus = retentionRequirementForPurchase(purchase) ? "Pendiente" : "No requerida";
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
    if (!normalized.purchaseId) errors.push("Debe seleccionar una compra relacionada.");
    if (!normalized.rentCode && !normalized.vatCode) errors.push("Debe seleccionar al menos un codigo de retencion.");
    if (normalized.rentCode && normalized.rentRetainedAmount <= 0) errors.push("La retencion renta debe tener valor mayor que cero.");
    if (normalized.vatCode && normalized.vatRetainedAmount <= 0) errors.push("La retencion IVA debe tener valor mayor que cero.");
    if (normalized.totalRetained <= 0) errors.push("La retencion debe tener valor total mayor que cero.");
    return { retention: normalized, errors };
  }

  function buildIssuedWithholdingJournalEntry(retention, purchase) {
    const defaults = companyService.settings().defaultAccounts || {};
    const errors = [];
    const payableValidation = validateWithholdingAccount(defaults.accountsPayableSuppliers, "Cuentas por pagar proveedores");
    errors.push(...payableValidation.errors);
    const rentValidation = retention.rentCode
      ? validateWithholdingAccount(retention.rentPayableAccountCode || defaultRentPayableAccount(), "Retenciones fuente por pagar")
      : { account: null, errors: [] };
    const vatValidation = retention.vatCode
      ? validateWithholdingAccount(retention.vatPayableAccountCode || defaultVatPayableAccount(), "Retenciones IVA por pagar")
      : { account: null, errors: [] };
    errors.push(...rentValidation.errors, ...vatValidation.errors);
    if (retention.totalRetained <= 0) errors.push("La retencion no puede confirmarse con valor cero.");
    if (errors.length) return { ok: false, errors };

    const entry = journalService.emptyEntry();
    entry.accountingDate = retention.retentionDate;
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
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
    if (retention.rentCode && rentValidation.account) {
      entry.lines.push({
        id: uid("JLN"),
        accountCode: rentValidation.account.code,
        accountName: rentValidation.account.name,
        debit: 0,
        credit: round2(retention.rentRetainedAmount),
        costCenter: "",
        auxiliary: purchase.supplierRuc,
        lineDescription: `Retencion renta ${retention.rentCode}`,
        documentReference: retention.draftNumber
      });
    }
    if (retention.vatCode && vatValidation.account) {
      entry.lines.push({
        id: uid("JLN"),
        accountCode: vatValidation.account.code,
        accountName: vatValidation.account.name,
        debit: 0,
        credit: round2(retention.vatRetainedAmount),
        costCenter: "",
        auxiliary: purchase.supplierRuc,
        lineDescription: `Retencion IVA ${retention.vatCode}`,
        documentReference: retention.draftNumber
      });
    }
    return { ok: true, entry };
  }

  function saveRetentionDraft(draft) {
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const { retention: prepared, errors } = validateRetentionDraftShape(draft);
    const purchase = purchases().find(item => item.id === prepared.purchaseId);
    if (!purchase) errors.push("La compra relacionada no existe.");

    let rentValidation = null;
    if (prepared.rentCode) {
      rentValidation = taxConfigService.validateRetentionActiveOnDate(prepared.rentCode, prepared.retentionDate || purchase?.accountingDate || today(), {
        taxType: "RENTA",
        appliesTo: "compra"
      });
      if (!rentValidation.ok) errors.push(...(rentValidation.errors || []));
    }

    let vatValidation = null;
    if (prepared.vatCode) {
      vatValidation = taxConfigService.validateRetentionActiveOnDate(prepared.vatCode, prepared.retentionDate || purchase?.accountingDate || today(), {
        taxType: "IVA",
        appliesTo: "compra"
      });
      if (!vatValidation.ok) errors.push(...(vatValidation.errors || []));
    }

    if (errors.length) return { ok: false, errors: [...new Set(errors)] };

    const normalized = normalizeIssuedWithholding({
      ...prepared,
      supplierName: purchase?.supplierName || prepared.supplierName || "",
      supplierRuc: purchase?.supplierRuc || prepared.supplierRuc || "",
      purchaseDocumentNumber: purchase?.documentNumber || prepared.purchaseDocumentNumber || "",
      rentParameterId: rentValidation?.retention?.id || prepared.rentParameterId || "",
      rentSriCode: rentValidation?.retention?.sriCode || prepared.rentSriCode || "",
      rentDescription: rentValidation?.retention?.description || prepared.rentDescription || "",
      rentPercentage: round2(rentValidation?.retention?.percentage ?? prepared.rentPercentage ?? 0),
      rentRetainedAmount: round2(prepared.rentBaseAmount * (rentValidation?.retention?.percentage ?? prepared.rentPercentage ?? 0) / 100),
      rentPayableAccountCode: rentValidation?.retention?.payableAccountCode || prepared.rentPayableAccountCode || defaultRentPayableAccount(),
      vatParameterId: vatValidation?.retention?.id || prepared.vatParameterId || "",
      vatSriCode: vatValidation?.retention?.sriCode || prepared.vatSriCode || "",
      vatDescription: vatValidation?.retention?.description || prepared.vatDescription || "",
      vatPercentage: round2(vatValidation?.retention?.percentage ?? prepared.vatPercentage ?? 0),
      vatRetainedAmount: round2(prepared.vatBaseAmount * (vatValidation?.retention?.percentage ?? prepared.vatPercentage ?? 0) / 100),
      vatPayableAccountCode: vatValidation?.retention?.payableAccountCode || prepared.vatPayableAccountCode || defaultVatPayableAccount(),
      status: prepared.status || "BORRADOR"
    });

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

  function annulRetention(retentionId) {
    const rows = issuedWithholdings().map(normalizeIssuedWithholding);
    const index = rows.findIndex(item => item.id === retentionId);
    if (index < 0) return { ok: false, message: "Retencion emitida no encontrada." };
    const target = rows[index];
    if (target.status === "ANULADA") return { ok: false, message: "La retencion ya esta anulada." };
    if (target.journalEntryId && issuedWithholdingAffectsPayable(target)) {
      const reversed = journalService.reverseEntry(target.journalEntryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar la retencion emitida." };
      target.reverseEntryId = reversed.entry.id;
      target.reverseEntryNumber = reversed.entry.entryNumber;
    }
    target.status = "ANULADA";
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
      previousStatus: "CONFIRMADA",
      nextStatus: target.status,
      description: `Retencion emitida ${target.draftNumber} anulada.`,
      after: target,
      result: "exitoso"
    });
    return { ok: true, retention: clone(rows[index]), purchase: clone(syncedPurchase) };
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
    voucherTypes,
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
    emptyRetentionDraft,
    normalizePurchase,
    calculateTotals,
    canEditPurchase,
    validatePurchase,
    savePurchase,
    postPurchase,
    parseXmlString,
    parseXmlFile,
    importXmlBatch,
    purchasesPendingRetention,
    saveRetentionDraft,
    confirmRetentionDraft,
    annulRetention,
    issuedWithholdingSummary,
    purchaseDashboardSummary
  };
})();
