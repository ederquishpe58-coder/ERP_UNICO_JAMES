(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const accountingRules = BlessERP.accountingRules;
  const { clone, uid } = BlessERP.utils;

  function all() {
    return clone(stateApi.state.db.chartOfAccounts || []);
  }

  function sortAccounts(accounts = all()) {
    const parts = value => String(value || "").split(".").map(segment => {
      const numeric = Number(segment);
      return Number.isNaN(numeric) ? segment : numeric;
    });
    return [...accounts].sort((a, b) => {
      const aParts = parts(a.code);
      const bParts = parts(b.code);
      const max = Math.max(aParts.length, bParts.length);
      for (let index = 0; index < max; index += 1) {
        const left = aParts[index];
        const right = bParts[index];
        if (left === undefined) return -1;
        if (right === undefined) return 1;
        if (left === right) continue;
        if (typeof left === "number" && typeof right === "number") return left - right;
        return String(left).localeCompare(String(right), "es");
      }
      return 0;
    });
  }

  function childrenOf(code, accounts = all()) {
    return accounts.filter(account => String(account.parentCode || "") === String(code || ""));
  }

  function findByCode(code, accounts = all()) {
    return accounts.find(account => account.code === code);
  }

  function levelFromCode(code) {
    return String(code || "").split(".").filter(Boolean).length || 1;
  }

  function saveAccount(candidate) {
    const normalized = {
      id: candidate.id || uid("ACC"),
      code: String(candidate.code || "").trim(),
      name: String(candidate.name || "").trim(),
      type: String(candidate.type || "").trim(),
      nature: String(candidate.nature || "").trim(),
      level: levelFromCode(candidate.code),
      parentCode: String(candidate.parentCode || "").trim(),
      isMovement: Boolean(candidate.isMovement),
      acceptsCostCenter: Boolean(candidate.acceptsCostCenter),
      requiresAuxiliary: Boolean(candidate.requiresAuxiliary),
      status: String(candidate.status || "Activa"),
      notes: String(candidate.notes || "").trim()
    };

    const accounts = all();
    const previous = accounts.find(account => account.id === normalized.id);
    const usedByPostedEntry = previous && (stateApi.state.db.journalEntries || []).some(entry =>
      ["CONTABILIZADO", "REVERSADO"].includes(entry.status)
      && (entry.lines || []).some(line => line.accountCode === previous.code)
    );
    const errors = validateAccountStructure(normalized, normalized.id);
    if (usedByPostedEntry && ["code", "type", "nature", "isMovement"].some(field => normalized[field] !== previous[field])) {
      errors.push("No se puede cambiar la estructura de una cuenta que ya tiene movimientos contabilizados.");
    }
    if (errors.length) return { ok: false, errors };

    const index = accounts.findIndex(account => account.id === normalized.id);
    if (index >= 0) accounts[index] = normalized;
    else accounts.push(normalized);

    stateApi.state.db.chartOfAccounts = sortAccounts(accounts);
    stateApi.saveDb();
    return { ok: true, account: clone(normalized) };
  }

  function toggleActive(id) {
    const accounts = all();
    const target = accounts.find(account => account.id === id);
    if (!target) return { ok: false, message: "Cuenta no encontrada." };
    if (target.status === "Activa") {
      const usedByPostedEntry = (stateApi.state.db.journalEntries || []).some(entry =>
        ["CONTABILIZADO", "REVERSADO"].includes(entry.status)
        && (entry.lines || []).some(line => line.accountCode === target.code)
      );
      if (usedByPostedEntry) return { ok: false, message: "No se puede inactivar una cuenta con movimientos contabilizados." };
      if (childrenOf(target.code, accounts).some(account => account.status === "Activa")) {
        return { ok: false, message: "Inactive primero las subcuentas activas." };
      }
    }
    target.status = target.status === "Activa" ? "Inactiva" : "Activa";
    stateApi.state.db.chartOfAccounts = sortAccounts(accounts);
    stateApi.saveDb();
    return { ok: true, account: clone(target) };
  }

  function movementOptions() {
    return sortAccounts(all()).filter(account => account.status === "Activa" && account.isMovement);
  }

  function validateAccountStructure(candidate, currentId = "") {
    return accountingRules.validateAccount(candidate, all(), currentId);
  }

  function auditCatalog() {
    return accountingRules.auditCatalog(all());
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.chartOfAccounts = {
    all,
    sortAccounts,
    childrenOf,
    findByCode,
    validateAccount: validateAccountStructure,
    saveAccount,
    toggleActive,
    movementOptions,
    levelFromCode,
    auditCatalog,
    accountGroups: accountingRules.ACCOUNT_GROUPS,
    accountTypes: accountingRules.ACCOUNT_TYPES
  };
})();
