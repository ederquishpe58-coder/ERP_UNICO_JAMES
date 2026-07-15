(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;
  const { clone, uid, today } = BlessERP.utils;

  const taxTypes = ["IVA", "ICE", "IRBPNR", "RENTA", "OTRO"];
  const taxScopes = ["compras", "ventas", "ambos"];
  const retentionTypes = ["RENTA", "IVA"];
  const retentionScopes = ["compra", "venta", "ambos"];
  const retentionCategories = ["bienes", "servicios", "profesional", "arriendo", "transporte", "agricola", "exterior", "otros"];
  const parameterStates = ["activo", "inactivo"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function saveList(key, value) {
    stateApi.state.db[key] = value;
    stateApi.saveDb();
  }

  function settingsDefaults() {
    return companyService.settings().defaultAccounts || {};
  }

  function normalizedText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function taxes(filters = {}) {
    const search = normalizedText(filters.search);
    return cloneList("taxParameters").filter(item => {
      if (search) {
        const haystack = [
          item.internalCode,
          item.sriCode,
          item.name,
          item.taxType,
          item.appliesTo
        ].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (filters.taxType && item.taxType !== filters.taxType) return false;
      if (filters.appliesTo && item.appliesTo !== filters.appliesTo) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.onlyActive && item.status !== "activo") return false;
      if (filters.validOn && !isRecordActiveOnDate(item, filters.validOn)) return false;
      return true;
    });
  }

  function retentions(filters = {}) {
    const search = normalizedText(filters.search);
    return cloneList("retentionParameters").filter(item => {
      if (search) {
        const haystack = [
          item.internalCode,
          item.sriCode,
          item.description,
          item.taxType,
          item.category,
          item.appliesTo
        ].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (filters.taxType && item.taxType !== filters.taxType) return false;
      if (filters.appliesTo && item.appliesTo !== filters.appliesTo) return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.onlyActive && item.status !== "activo") return false;
      if (filters.validOn && !isRecordActiveOnDate(item, filters.validOn)) return false;
      return true;
    });
  }

  function findTaxById(id) {
    return taxes().find(item => item.id === id);
  }

  function findTaxByCode(code) {
    const normalized = normalizeCode(code);
    return taxes().find(item => item.internalCode === normalized || item.sriCode === normalized);
  }

  function findRetentionById(id) {
    return retentions().find(item => item.id === id);
  }

  function findRetentionByCode(code) {
    const normalized = normalizeCode(code);
    return retentions().find(item => item.internalCode === normalized || item.sriCode === normalized);
  }

  function emptyTax() {
    const defaults = settingsDefaults();
    return {
      id: "",
      internalCode: "",
      sriCode: "",
      name: "",
      taxType: "IVA",
      rate: 0,
      appliesTo: "ambos",
      purchaseAccountCode: defaults.vatPurchases || "",
      salesAccountCode: defaults.vatSales || "",
      payableAccountCode: defaults.vatSales || "",
      receivableAccountCode: defaults.vatPurchases || "",
      effectiveFrom: today(),
      effectiveTo: "",
      status: "activo",
      observation: ""
    };
  }

  function emptyRetention() {
    const defaults = settingsDefaults();
    return {
      id: "",
      internalCode: "",
      sriCode: "",
      description: "",
      taxType: "RENTA",
      percentage: 0,
      appliesTo: "compra",
      category: "otros",
      payableAccountCode: defaults.incomeTaxWithholdingPayable || "",
      receivableAccountCode: defaults.withholdingReceivable || "",
      effectiveFrom: today(),
      effectiveTo: "",
      status: "activo",
      observation: ""
    };
  }

  function normalizeTax(candidate) {
    return {
      ...emptyTax(),
      ...clone(candidate || {}),
      id: candidate?.id || uid("TAX"),
      internalCode: normalizeCode(candidate?.internalCode),
      sriCode: normalizeCode(candidate?.sriCode),
      name: String(candidate?.name || "").trim(),
      taxType: String(candidate?.taxType || "IVA").trim().toUpperCase(),
      rate: round2(candidate?.rate),
      appliesTo: String(candidate?.appliesTo || "ambos").trim().toLowerCase(),
      purchaseAccountCode: String(candidate?.purchaseAccountCode || "").trim(),
      salesAccountCode: String(candidate?.salesAccountCode || "").trim(),
      payableAccountCode: String(candidate?.payableAccountCode || "").trim(),
      receivableAccountCode: String(candidate?.receivableAccountCode || "").trim(),
      effectiveFrom: String(candidate?.effectiveFrom || "").trim(),
      effectiveTo: String(candidate?.effectiveTo || "").trim(),
      status: String(candidate?.status || "activo").trim().toLowerCase(),
      observation: String(candidate?.observation || "").trim()
    };
  }

  function normalizeRetention(candidate) {
    return {
      ...emptyRetention(),
      ...clone(candidate || {}),
      id: candidate?.id || uid("RET-PAR"),
      internalCode: normalizeCode(candidate?.internalCode),
      sriCode: normalizeCode(candidate?.sriCode),
      description: String(candidate?.description || "").trim(),
      taxType: String(candidate?.taxType || "RENTA").trim().toUpperCase(),
      percentage: round2(candidate?.percentage),
      appliesTo: String(candidate?.appliesTo || "compra").trim().toLowerCase(),
      category: String(candidate?.category || "otros").trim().toLowerCase(),
      payableAccountCode: String(candidate?.payableAccountCode || "").trim(),
      receivableAccountCode: String(candidate?.receivableAccountCode || "").trim(),
      effectiveFrom: String(candidate?.effectiveFrom || "").trim(),
      effectiveTo: String(candidate?.effectiveTo || "").trim(),
      status: String(candidate?.status || "activo").trim().toLowerCase(),
      observation: String(candidate?.observation || "").trim()
    };
  }

  function rangesOverlap(leftFrom, leftTo, rightFrom, rightTo) {
    const start = [leftFrom || "0000-01-01", rightFrom || "0000-01-01"].sort().at(-1);
    const end = [leftTo || "9999-12-31", rightTo || "9999-12-31"].sort()[0];
    return start <= end;
  }

  function isRecordActiveOnDate(record, date) {
    const target = String(date || "").trim() || today();
    if (String(record?.status || "").toLowerCase() !== "activo") return false;
    if (record?.effectiveFrom && target < record.effectiveFrom) return false;
    if (record?.effectiveTo && target > record.effectiveTo) return false;
    return true;
  }

  function validateLinkedAccount(code, label) {
    const errors = [];
    if (!String(code || "").trim()) return errors;
    const account = chartService.findByCode(code);
    if (!account) {
      errors.push(`La cuenta ${label} no existe en el Plan de Cuentas.`);
      return errors;
    }
    if (account.status !== "Activa") errors.push(`La cuenta ${label} debe estar activa.`);
    if (!account.isMovement) errors.push(`La cuenta ${label} debe ser de movimiento.`);
    return errors;
  }

  function taxWarnings(record) {
    const warnings = [];
    if (record.appliesTo === "compras" || record.appliesTo === "ambos") {
      if (!record.purchaseAccountCode) warnings.push("Falta cuenta contable de compras para este impuesto.");
    }
    if (record.appliesTo === "ventas" || record.appliesTo === "ambos") {
      if (!record.salesAccountCode) warnings.push("Falta cuenta contable de ventas para este impuesto.");
    }
    if (record.taxType === "IVA" && !record.payableAccountCode && !record.receivableAccountCode) {
      warnings.push("No hay cuenta contable por pagar o por cobrar asociada al impuesto.");
    }
    return warnings;
  }

  function retentionWarnings(record) {
    const warnings = [];
    if (!record.payableAccountCode && !record.receivableAccountCode) {
      warnings.push("No hay cuenta contable por pagar o por cobrar asociada a esta retencion.");
    }
    return warnings;
  }

  function validateTax(candidate, currentId = "") {
    const normalized = normalizeTax(candidate);
    const errors = [];
    const rows = taxes();
    if (!normalized.internalCode) errors.push("El código interno es obligatorio.");
    if (!normalized.name) errors.push("El nombre del impuesto es obligatorio.");
    if (!normalized.taxType) errors.push("El tipo de impuesto es obligatorio.");
    if (normalized.rate < 0) errors.push("La tarifa debe ser mayor o igual a cero.");
    if (normalized.effectiveFrom && normalized.effectiveTo && normalized.effectiveFrom > normalized.effectiveTo) {
      errors.push("La vigencia desde no puede ser mayor que la vigencia hasta.");
    }
    const duplicate = rows.find(item => item.internalCode === normalized.internalCode && item.id !== currentId);
    if (duplicate) errors.push("No se permite código interno duplicado en impuestos.");
    errors.push(...validateLinkedAccount(normalized.purchaseAccountCode, "de compras"));
    errors.push(...validateLinkedAccount(normalized.salesAccountCode, "de ventas"));
    errors.push(...validateLinkedAccount(normalized.payableAccountCode, "por pagar"));
    errors.push(...validateLinkedAccount(normalized.receivableAccountCode, "por cobrar"));
    return { normalized, errors, warnings: taxWarnings(normalized) };
  }

  function validateRetention(candidate, currentId = "") {
    const normalized = normalizeRetention(candidate);
    const errors = [];
    const rows = retentions();
    if (!normalized.internalCode) errors.push("El código interno es obligatorio.");
    if (!normalized.description) errors.push("La descripcion de la retencion es obligatoria.");
    if (!normalized.taxType) errors.push("El tipo de impuesto es obligatorio.");
    if (normalized.percentage < 0 || normalized.percentage > 100) errors.push("El porcentaje debe estar entre 0 y 100.");
    if (normalized.effectiveFrom && normalized.effectiveTo && normalized.effectiveFrom > normalized.effectiveTo) {
      errors.push("La vigencia desde no puede ser mayor que la vigencia hasta.");
    }
    const duplicateInternal = rows.find(item => item.internalCode === normalized.internalCode && item.id !== currentId);
    if (duplicateInternal) errors.push("No se permite código interno duplicado en retenciones.");
    const duplicateSri = rows.find(item =>
      normalized.sriCode &&
      item.id !== currentId &&
      item.taxType === normalized.taxType &&
      item.sriCode === normalized.sriCode &&
      rangesOverlap(item.effectiveFrom, item.effectiveTo, normalized.effectiveFrom, normalized.effectiveTo)
    );
    if (duplicateSri) errors.push("No se permite código SRI duplicado para el mismo tipo y vigencia.");
    errors.push(...validateLinkedAccount(normalized.payableAccountCode, "por pagar"));
    errors.push(...validateLinkedAccount(normalized.receivableAccountCode, "por cobrar"));
    return { normalized, errors, warnings: retentionWarnings(normalized) };
  }

  function saveTax(candidate) {
    const { normalized, errors, warnings } = validateTax(candidate, candidate?.id || "");
    if (errors.length) return { ok: false, errors, warnings };
    const rows = taxes();
    const index = rows.findIndex(item => item.id === normalized.id);
    if (index >= 0) rows[index] = normalized;
    else rows.unshift(normalized);
    saveList("taxParameters", rows);
    return { ok: true, tax: clone(normalized), warnings };
  }

  function saveRetention(candidate) {
    const { normalized, errors, warnings } = validateRetention(candidate, candidate?.id || "");
    if (errors.length) return { ok: false, errors, warnings };
    const rows = retentions();
    const index = rows.findIndex(item => item.id === normalized.id);
    if (index >= 0) rows[index] = normalized;
    else rows.unshift(normalized);
    saveList("retentionParameters", rows);
    return { ok: true, retention: clone(normalized), warnings };
  }

  function toggleTaxStatus(id) {
    const rows = taxes();
    const index = rows.findIndex(item => item.id === id);
    if (index < 0) return { ok: false, message: "Impuesto no encontrado." };
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    saveList("taxParameters", rows);
    return { ok: true, tax: clone(rows[index]) };
  }

  function toggleRetentionStatus(id) {
    const rows = retentions();
    const index = rows.findIndex(item => item.id === id);
    if (index < 0) return { ok: false, message: "Retencion no encontrada." };
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    saveList("retentionParameters", rows);
    return { ok: true, retention: clone(rows[index]) };
  }

  function validateTaxActiveOnDate(codeOrRecord, date) {
    const record = typeof codeOrRecord === "string" ? findTaxByCode(codeOrRecord) : normalizeTax(codeOrRecord);
    if (!record) return { ok: false, errors: ["Impuesto no encontrado."] };
    const errors = [];
    if (!isRecordActiveOnDate(record, date)) {
      errors.push("El impuesto no esta activo o vigente para la fecha indicada.");
    }
    errors.push(...validateLinkedAccount(record.purchaseAccountCode, "de compras"));
    errors.push(...validateLinkedAccount(record.salesAccountCode, "de ventas"));
    errors.push(...validateLinkedAccount(record.payableAccountCode, "por pagar"));
    errors.push(...validateLinkedAccount(record.receivableAccountCode, "por cobrar"));
    return { ok: !errors.length, errors, tax: clone(record), warnings: taxWarnings(record) };
  }

  function validateRetentionActiveOnDate(codeOrRecord, date, options = {}) {
    const record = typeof codeOrRecord === "string" ? findRetentionByCode(codeOrRecord) : normalizeRetention(codeOrRecord);
    if (!record) return { ok: false, errors: ["Codigo de retencion no encontrado."] };
    const errors = [];
    if (options.taxType && record.taxType !== options.taxType) {
      errors.push("El codigo de retencion no corresponde al tipo de impuesto seleccionado.");
    }
    if (options.appliesTo && record.appliesTo !== "ambos" && record.appliesTo !== options.appliesTo) {
      errors.push("El codigo de retencion no aplica para este origen.");
    }
    if (!isRecordActiveOnDate(record, date)) {
      errors.push("El codigo de retencion no esta activo o vigente para la fecha indicada.");
    }
    errors.push(...validateLinkedAccount(record.payableAccountCode, "por pagar"));
    errors.push(...validateLinkedAccount(record.receivableAccountCode, "por cobrar"));
    return { ok: !errors.length, errors, retention: clone(record), warnings: retentionWarnings(record) };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.taxConfig = {
    taxTypes,
    taxScopes,
    retentionTypes,
    retentionScopes,
    retentionCategories,
    parameterStates,
    taxes,
    retentions,
    emptyTax,
    emptyRetention,
    findTaxById,
    findTaxByCode,
    findRetentionById,
    findRetentionByCode,
    saveTax,
    saveRetention,
    toggleTaxStatus,
    toggleRetentionStatus,
    validateTax,
    validateRetention,
    validateTaxActiveOnDate,
    validateRetentionActiveOnDate,
    isRecordActiveOnDate,
    taxWarnings,
    retentionWarnings
  };
})();
