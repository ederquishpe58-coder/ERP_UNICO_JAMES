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

  function migrateRetentionCatalog2026() {
    const version = "RETENCIONES-2026-08-PLAN-CUENTAS-BLESS-V2-332";
    if (stateApi.state.db.taxCatalogVersion === version) return;
    const defaults = settingsDefaults();
    const payableAccountCode = defaults.incomeTaxWithholdingPayable || "";
    const receivableAccountCode = defaults.withholdingReceivable || "";
    const rows = cloneList("retentionParameters");
    let changed = false;

    const replaceLegacy = (internalCode, expectedSriCode, patch, predicate = () => true) => {
      const item = rows.find(row => row.internalCode === internalCode && row.sriCode === expectedSriCode);
      if (!item || !predicate(item)) return;
      Object.assign(item, patch);
      changed = true;
    };
    const addIfMissing = record => {
      if (rows.some(row => row.taxType === record.taxType && row.sriCode === record.sriCode && row.status === "activo")) return;
      const accountLinks = BlessERP.accountingPlanBlessV1?.retentionAccountCodes?.(record) || {
        payableAccountCode,
        receivableAccountCode
      };
      rows.push({
        id: uid("WHT"),
        appliesTo: "compra",
        ...accountLinks,
        effectiveFrom: "2026-03-01",
        effectiveTo: "",
        status: "activo",
        observation: "Tarifa vigente segun Resolucion NAC-DGERCGC26-00000009.",
        ...record
      });
      changed = true;
    };

    replaceLegacy("RET_304", "304", {
      description: "Servicios donde predomina el intelecto",
      percentage: 10,
      effectiveFrom: "2026-03-01",
      observation: "Tarifa vigente segun Resolucion NAC-DGERCGC26-00000009."
    }, item => Number(item.percentage || 0) === 2 && String(item.description || "") === "Servicios");
    replaceLegacy("RET_312", "312", {
      description: "Transferencia de bienes muebles de naturaleza corporal",
      percentage: 2,
      effectiveFrom: "2026-03-01",
      observation: "Tarifa vigente segun Resolucion NAC-DGERCGC26-00000009."
    }, item => Number(item.percentage || 0) === 1.75 && String(item.description || "") === "Transferencia de bienes");
    replaceLegacy("RET_AGRICOLA_1", "AGRICOLA_1", {
      internalCode: "RET_312A",
      sriCode: "312A",
      description: "Compras directas al productor de bienes de origen agricola y similares",
      percentage: 1,
      effectiveFrom: "2026-03-01",
      observation: "Tarifa vigente segun Resolucion NAC-DGERCGC26-00000009."
    });
    replaceLegacy("RET_IVA_30", "IVA_30", { sriCode: "1", category: "bienes", observation: "Codigo SRI de comprobante electronico: 1." });
    replaceLegacy("RET_IVA_70", "IVA_70", { sriCode: "2", observation: "Codigo SRI de comprobante electronico: 2." });
    replaceLegacy("RET_IVA_100", "IVA_100", { sriCode: "3", observation: "Codigo SRI de comprobante electronico: 3." });
    replaceLegacy("RET_EXTERIOR_25", "EXTERIOR_25", {
      internalCode: "RET_520",
      sriCode: "520",
      description: "Pago al exterior - otros conceptos de ingresos gravados",
      percentage: 25,
      category: "exterior",
      effectiveFrom: "2026-03-01",
      observation: "Codigo SRI 520. Verificar convenio para evitar doble imposicion, residencia fiscal y naturaleza del pago antes de emitir."
    });
    const code332 = rows.find(row => row.taxType === "RENTA" && row.sriCode === "332" && row.status === "activo")
      || rows.find(row => row.taxType === "RENTA" && row.sriCode === "332");
    if (code332) {
      Object.assign(code332, {
        internalCode: "RET_332",
        description: "Otras compras de bienes y servicios no sujetas a retencion",
        percentage: 0,
        appliesTo: "compra",
        category: "otros",
        payableAccountCode: "",
        receivableAccountCode: "",
        effectiveFrom: "2026-01-01",
        effectiveTo: "",
        status: "activo",
        observation: "Se reporta en AIR con base, porcentaje 0 y valor retenido 0; no genera comprobante."
      });
      changed = true;
    }

    [
      { internalCode: "RET_307", sriCode: "307", description: "Servicios donde predomina la mano de obra", taxType: "RENTA", percentage: 3, category: "servicios" },
      { internalCode: "RET_310", sriCode: "310", description: "Transporte privado de pasajeros o transporte publico/privado de carga", taxType: "RENTA", percentage: 1, category: "transporte" },
      { internalCode: "RET_311", sriCode: "311", description: "Pagos mediante liquidacion de compra", taxType: "RENTA", percentage: 3, category: "bienes" },
      { internalCode: "RET_312A", sriCode: "312A", description: "Compras directas al productor de bienes de origen agricola y similares", taxType: "RENTA", percentage: 1, category: "agricola" },
      { internalCode: "RET_312C", sriCode: "312C", description: "Compras a comercializador de bienes de origen agricola y similares", taxType: "RENTA", percentage: 1.75, category: "agricola" },
      { internalCode: "RET_303A", sriCode: "303A", description: "Servicios profesionales prestados por sociedades residentes", taxType: "RENTA", percentage: 5, category: "profesional" },
      { internalCode: "RET_3482", sriCode: "3482", description: "Comisiones pagadas a sociedades residentes y establecimientos permanentes", taxType: "RENTA", percentage: 5, category: "servicios" },
      { internalCode: "RET_340", sriCode: "340", description: "Otras retenciones aplicables el 3% (casillero 3440)", taxType: "RENTA", percentage: 3, category: "otros", observation: "El codigo electronico es 340; 3440 corresponde al casillero del Formulario 103." },
      { internalCode: "RET_501", sriCode: "501", description: "Pago al exterior - beneficios empresariales", taxType: "RENTA", percentage: 25, category: "exterior", observation: "Verificar convenio para evitar doble imposicion y residencia fiscal antes de emitir." },
      { internalCode: "RET_502", sriCode: "502", description: "Pago al exterior - servicios empresariales", taxType: "RENTA", percentage: 25, category: "exterior", observation: "Verificar convenio para evitar doble imposicion y residencia fiscal antes de emitir." },
      { internalCode: "RET_511", sriCode: "511", description: "Pago al exterior - servicios profesionales independientes", taxType: "RENTA", percentage: 25, category: "exterior", observation: "Verificar convenio para evitar doble imposicion y residencia fiscal antes de emitir." },
      { internalCode: "RET_520", sriCode: "520", description: "Pago al exterior - otros conceptos de ingresos gravados", taxType: "RENTA", percentage: 25, category: "exterior", observation: "Verificar convenio para evitar doble imposicion, residencia fiscal y naturaleza del pago antes de emitir." },
      { internalCode: "RET_332", sriCode: "332", description: "Otras compras de bienes y servicios no sujetas a retencion", taxType: "RENTA", percentage: 0, category: "otros", effectiveFrom: "2026-01-01", observation: "Se reporta en AIR con base, porcentaje 0 y valor retenido 0; no genera comprobante." },
      { internalCode: "RET_IVA_20", sriCode: "10", description: "Retencion IVA 20%", taxType: "IVA", percentage: 20, category: "servicios", observation: "Codigo SRI de comprobante electronico: 10." },
      { internalCode: "RET_IVA_30", sriCode: "1", description: "Retencion IVA 30%", taxType: "IVA", percentage: 30, category: "bienes", observation: "Codigo SRI de comprobante electronico: 1." },
      { internalCode: "RET_IVA_70", sriCode: "2", description: "Retencion IVA 70%", taxType: "IVA", percentage: 70, category: "servicios", observation: "Codigo SRI de comprobante electronico: 2." },
      { internalCode: "RET_IVA_100", sriCode: "3", description: "Retencion IVA 100%", taxType: "IVA", percentage: 100, category: "servicios", observation: "Codigo SRI de comprobante electronico: 3." }
    ].forEach(addIfMissing);

    rows.forEach(record => {
      const accountLinks = BlessERP.accountingPlanBlessV1?.retentionAccountCodes?.(record);
      if (!accountLinks) return;
      if (record.payableAccountCode !== accountLinks.payableAccountCode || record.receivableAccountCode !== accountLinks.receivableAccountCode) {
        Object.assign(record, accountLinks);
        changed = true;
      }
    });

    if (changed) stateApi.state.db.retentionParameters = rows;
    stateApi.state.db.taxCatalogVersion = version;
    stateApi.saveDb();
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
    const normalizedCode = typeof codeOrRecord === "string" ? normalizeCode(codeOrRecord) : "";
    const matchingRecords = normalizedCode
      ? retentions().filter(item => item.internalCode === normalizedCode || item.sriCode === normalizedCode)
      : [];
    const record = normalizedCode
      ? matchingRecords.find(item => isRecordActiveOnDate(item, date)) || matchingRecords.find(item => item.status === "activo") || matchingRecords[0]
      : normalizeRetention(codeOrRecord);
    if (!record) return { ok: false, errors: ["Codigo de retencion no encontrado."] };
    const errors = [];
    if (options.taxType && record.taxType !== options.taxType) {
      errors.push("El codigo de retencion no corresponde al tipo de impuesto seleccionado.");
    }
    if (options.appliesTo && record.appliesTo !== "ambos" && record.appliesTo !== options.appliesTo) {
      errors.push("El codigo de retencion no aplica para este origen.");
    }
    if (!isRecordActiveOnDate(record, date)) {
      const targetDate = String(date || "").trim() || today();
      const range = `${record.effectiveFrom || "sin fecha inicial"}${record.effectiveTo ? ` a ${record.effectiveTo}` : " en adelante"}`;
      errors.push(`El codigo de retencion no esta activo o vigente para ${targetDate}. Estado: ${record.status || "sin estado"}; vigencia configurada: ${range}.`);
    }
    if (!options.skipLinkedAccounts) {
      errors.push(...validateLinkedAccount(record.payableAccountCode, "por pagar"));
      errors.push(...validateLinkedAccount(record.receivableAccountCode, "por cobrar"));
    }
    return { ok: !errors.length, errors, retention: clone(record), warnings: retentionWarnings(record) };
  }

  BlessERP.services = BlessERP.services || {};
  migrateRetentionCatalog2026();
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
