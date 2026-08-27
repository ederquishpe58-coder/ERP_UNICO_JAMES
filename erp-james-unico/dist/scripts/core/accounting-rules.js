(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    const BlessERP = root.BlessERP = root.BlessERP || {};
    BlessERP.accountingRules = api;
  }
})(typeof window !== "undefined" ? window : null, function(){
  const ACCOUNT_GROUPS = Object.freeze({
    "1": Object.freeze({ code: "1", label: "Activos", types: ["Activo"], nature: "Deudora" }),
    "2": Object.freeze({ code: "2", label: "Pasivos", types: ["Pasivo"], nature: "Acreedora" }),
    "3": Object.freeze({ code: "3", label: "Patrimonio", types: ["Patrimonio"], nature: "Acreedora" }),
    "4": Object.freeze({ code: "4", label: "Ingresos", types: ["Ingreso"], nature: "Acreedora" }),
    "5": Object.freeze({ code: "5", label: "Costos y Gastos", types: ["Costo", "Gasto"], nature: "Deudora" })
  });
  const ACCOUNT_TYPES = Object.freeze(["Activo", "Pasivo", "Patrimonio", "Ingreso", "Costo", "Gasto"]);
  const DEFERRED_SOURCE_MODULES = Object.freeze(["Ventas", "Inventario"]);
  const LEGACY_ACCOUNTING_VERSION = 3;
  const ACCOUNT_CODE_PATTERN = /^[1-5](?:\.\d{1,3}){0,4}$/;

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function accountGroup(code) {
    return ACCOUNT_GROUPS[String(code || "").trim().split(".")[0]] || null;
  }

  function expectedParentCode(code) {
    const parts = String(code || "").trim().split(".").filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join(".") : "";
  }

  function isAllowedContraNature(candidate = {}, group = null) {
    const code = String(candidate.code || "").trim();
    const name = String(candidate.name || "").trim().toUpperCase();
    const nature = String(candidate.nature || "").trim();
    if (group?.code === "1" && nature === "Acreedora") {
      return code.startsWith("1.2.02")
        || ["DEPRECIACION ACUMULADA", "DEPRECIACIÓN ACUMULADA", "AMORTIZACION ACUMULADA", "AMORTIZACIÓN ACUMULADA", "DETERIORO ACUMULADO"]
          .some(label => name.includes(label));
    }
    if (group?.code === "3" && nature === "Deudora") {
      return ["PERDIDA", "PÉRDIDA"].some(label => name.includes(label));
    }
    return false;
  }

  function migrateLegacyAccountCode(code) {
    const value = String(code || "").trim();
    if (value === "6") return "5";
    const match = value.match(/^6\.(\d+)(.*)$/);
    if (!match) return value;
    return `5.${Number(match[1]) + 2}${match[2] || ""}`;
  }

  function validateAccount(candidate = {}, accounts = [], currentId = "") {
    const errors = [];
    const code = String(candidate.code || "").trim();
    const name = String(candidate.name || "").trim();
    const type = String(candidate.type || "").trim();
    const nature = String(candidate.nature || "").trim();
    const parentCode = String(candidate.parentCode || "").trim();
    const group = accountGroup(code);

    if (!code) errors.push("El codigo es obligatorio.");
    if (!name) errors.push("El nombre es obligatorio.");
    if (!type) errors.push("El tipo es obligatorio.");
    if (!nature) errors.push("La naturaleza es obligatoria.");
    if (code && !ACCOUNT_CODE_PATTERN.test(code)) {
      errors.push("El codigo debe iniciar con un grupo del 1 al 5 y tener como maximo cinco niveles numericos separados por puntos.");
    }
    if (code && !group) errors.push("La cuenta debe pertenecer a Activos, Pasivos, Patrimonio, Ingresos o Costos y Gastos.");
    if (group && type && !group.types.includes(type)) {
      errors.push(`El codigo ${code} corresponde al grupo ${group.label} y no admite el tipo ${type}.`);
    }
    if (group && nature && group.nature !== nature && !isAllowedContraNature(candidate, group)) {
      errors.push(`Las cuentas del grupo ${group.label} deben tener naturaleza ${group.nature}.`);
    }

    const duplicate = (accounts || []).find(account => String(account.code || "").trim() === code && account.id !== currentId);
    if (duplicate) errors.push("No se permiten codigos duplicados.");

    const expectedParent = expectedParentCode(code);
    if (expectedParent !== parentCode) {
      errors.push(expectedParent
        ? `La cuenta ${code} debe depender directamente de ${expectedParent}.`
        : `La cuenta raiz ${code} no debe tener cuenta padre.`);
    }
    if (expectedParent) {
      const parent = (accounts || []).find(account => String(account.code || "").trim() === expectedParent && account.id !== currentId);
      if (!parent) errors.push(`La cuenta padre ${expectedParent} no existe.`);
      else {
        if (parent.isMovement) errors.push(`La cuenta padre ${expectedParent} no puede ser una cuenta de movimiento.`);
        if (accountGroup(parent.code)?.code !== group?.code) errors.push("La cuenta padre debe pertenecer al mismo grupo contable.");
      }
    }

    const ownChildren = (accounts || []).filter(account => String(account.parentCode || "").trim() === code && account.id !== currentId);
    if (candidate.isMovement && ownChildren.length) errors.push("Una cuenta con subcuentas no puede marcarse como cuenta de movimiento.");
    if (!expectedParent && candidate.isMovement) errors.push("Las cuentas raiz no pueden recibir movimientos.");

    return [...new Set(errors)];
  }

  function auditCatalog(accounts = []) {
    const invalidAccounts = (accounts || []).map(account => ({
      account,
      errors: validateAccount(account, accounts, account.id)
    })).filter(item => item.errors.length);
    const roots = Object.keys(ACCOUNT_GROUPS).map(code => (accounts || []).find(account => account.code === code)).filter(Boolean);
    const missingGroups = Object.keys(ACCOUNT_GROUPS).filter(code => !roots.some(account => account.code === code));
    return {
      totalAccounts: (accounts || []).length,
      invalidAccounts,
      missingGroups,
      isValid: invalidAccounts.length === 0 && missingGroups.length === 0
    };
  }

  function entryTotals(lines = []) {
    const totals = (lines || []).reduce((result, line) => ({
      debit: result.debit + Number(line?.debit || 0),
      credit: result.credit + Number(line?.credit || 0)
    }), { debit: 0, credit: 0 });
    return {
      debit: round2(totals.debit),
      credit: round2(totals.credit),
      difference: round2(totals.debit - totals.credit)
    };
  }

  function validateEntryLines(lines = [], accounts = []) {
    const errors = [];
    const accountMap = new Map((accounts || []).map(account => [String(account.code || "").trim(), account]));
    if ((lines || []).length < 2) errors.push("Debe existir al menos dos lineas.");

    (lines || []).forEach((line, index) => {
      const row = index + 1;
      const code = String(line?.accountCode || "").trim();
      const debit = Number(line?.debit || 0);
      const credit = Number(line?.credit || 0);
      if (!code) {
        errors.push(`La linea ${row} debe tener cuenta contable.`);
        return;
      }
      const account = accountMap.get(code);
      if (!account) {
        errors.push(`La cuenta ${code} de la linea ${row} no existe.`);
        return;
      }
      if (!ACCOUNT_CODE_PATTERN.test(code) || !accountGroup(code)) errors.push(`La cuenta ${code} no pertenece a los grupos contables 1 a 5.`);
      if (validateAccount(account, accounts, account.id).length) errors.push(`La cuenta ${code} no cumple la estructura contable vigente.`);
      if (account.status !== "Activa") errors.push(`La cuenta ${code} esta inactiva.`);
      if (!account.isMovement) errors.push(`La cuenta ${code} no es de movimiento.`);
      if (!Number.isFinite(debit) || !Number.isFinite(credit)) errors.push(`La linea ${row} contiene un valor no numerico.`);
      if (debit < 0 || credit < 0) errors.push(`La linea ${row} no admite valores negativos.`);
      if (debit > 0 && credit > 0) errors.push(`La linea ${row} no puede tener debe y haber al mismo tiempo.`);
      if (debit <= 0 && credit <= 0) errors.push(`La linea ${row} debe tener valor en debe o haber.`);
    });

    const totals = entryTotals(lines);
    if (totals.debit <= 0 || totals.credit <= 0) errors.push("El asiento debe tener movimientos positivos en Debe y Haber.");
    if (totals.difference !== 0) errors.push("El total Debe debe ser igual al total Haber.");
    return { totals, errors: [...new Set(errors)] };
  }

  function auditEntries(entries = [], accounts = [], options = {}) {
    const excluded = new Set(options.deferredSourceModules || DEFERRED_SOURCE_MODULES);
    const effectiveEntries = (entries || []).filter(entry => !entry.status || ["CONTABILIZADO", "REVERSADO"].includes(entry.status));
    const totals = effectiveEntries.reduce((result, entry) => {
      const current = entryTotals(entry.lines || []);
      result.debit = round2(result.debit + current.debit);
      result.credit = round2(result.credit + current.credit);
      return result;
    }, { debit: 0, credit: 0 });
    totals.difference = round2(totals.debit - totals.credit);

    const invalidEntries = [];
    const deferredEntries = [];
    effectiveEntries.forEach(entry => {
      const validation = validateEntryLines(entry.lines || [], accounts);
      if (validation.errors.length) {
        invalidEntries.push({
          id: entry.id || "",
          entryNumber: entry.entryNumber || "",
          originModule: entry.originModule || "",
          errors: validation.errors
        });
      }
      if (excluded.has(entry.originModule)) deferredEntries.push(entry.entryNumber || entry.id || "");
    });

    return {
      totalEntries: effectiveEntries.length,
      checkedEntries: effectiveEntries.length - deferredEntries.length,
      deferredEntries,
      deferredModules: [...excluded],
      invalidEntries,
      totals,
      isBalanced: totals.difference === 0 && invalidEntries.length === 0
    };
  }

  function migrateDatabase(database) {
    const db = database && typeof database === "object" ? database : {};
    db.meta = db.meta && typeof db.meta === "object" ? db.meta : {};
    if (Number(db.meta.accountingStructureVersion || 0) >= LEGACY_ACCOUNTING_VERSION) return db;

    const accounts = Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [];
    const migratedAccounts = accounts.filter(account => String(account.code || "") !== "6").map(account => {
      const oldCode = String(account.code || "").trim();
      const code = migrateLegacyAccountCode(oldCode);
      const migrated = {
        ...account,
        code,
        parentCode: migrateLegacyAccountCode(account.parentCode || "")
      };
      if (oldCode.startsWith("6.")) {
        migrated.type = "Gasto";
        migrated.nature = "Deudora";
      }
      if (code === "5") {
        migrated.name = "Costos y Gastos";
        migrated.type = "Costo";
        migrated.nature = "Deudora";
        migrated.parentCode = "";
        migrated.isMovement = false;
        migrated.notes = "Clase principal de costos y gastos";
      }
      const rootGroup = ACCOUNT_GROUPS[code];
      if (rootGroup) {
        migrated.name = rootGroup.label;
        migrated.type = rootGroup.types[0];
        migrated.nature = rootGroup.nature;
        migrated.parentCode = "";
        migrated.isMovement = false;
      }
      return migrated;
    });
    const uniqueAccounts = new Map();
    migratedAccounts.forEach(account => {
      if (!uniqueAccounts.has(account.code)) uniqueAccounts.set(account.code, account);
    });
    db.chartOfAccounts = [...uniqueAccounts.values()];

    function migrateReferences(value, key = "") {
      if (Array.isArray(value)) return value.map(item => migrateReferences(item, key));
      if (value && typeof value === "object") {
        Object.keys(value).forEach(childKey => {
          value[childKey] = migrateReferences(value[childKey], childKey);
        });
        return value;
      }
      if (typeof value !== "string") return value;
      const migrated = migrateLegacyAccountCode(value);
      if (migrated === value) return value;
      if (value !== "6" || /account|cuenta/i.test(key)) return migrated;
      return value;
    }

    migrateReferences(db);
    db.meta.accountingStructureVersion = LEGACY_ACCOUNTING_VERSION;
    return db;
  }

  return {
    ACCOUNT_CODE_PATTERN,
    ACCOUNT_GROUPS,
    ACCOUNT_TYPES,
    DEFERRED_SOURCE_MODULES,
    LEGACY_ACCOUNTING_VERSION,
    accountGroup,
    auditCatalog,
    auditEntries,
    entryTotals,
    expectedParentCode,
    migrateDatabase,
    migrateLegacyAccountCode,
    round2,
    validateAccount,
    validateEntryLines
  };
});
