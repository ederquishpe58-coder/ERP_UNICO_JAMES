(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
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

  function validateAccount(candidate, currentId = "") {
    const errors = [];
    const accounts = all();
    const code = String(candidate.code || "").trim();
    const name = String(candidate.name || "").trim();
    const type = String(candidate.type || "").trim();
    const nature = String(candidate.nature || "").trim();

    if (!code) errors.push("El código es obligatorio.");
    if (!name) errors.push("El nombre es obligatorio.");
    if (!type) errors.push("El tipo es obligatorio.");
    if (!nature) errors.push("La naturaleza es obligatoria.");

    const duplicate = accounts.find(account => account.code === code && account.id !== currentId);
    if (duplicate) errors.push("No se permiten códigos duplicados.");

    const ownChildren = childrenOf(code, accounts).filter(account => account.id !== currentId);
    if (candidate.isMovement && ownChildren.length) errors.push("Una cuenta con subcuentas no puede marcarse como cuenta de movimiento.");

    return errors;
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

    const errors = validateAccount(normalized, normalized.id);
    if (errors.length) return { ok: false, errors };

    const accounts = all();
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
    target.status = target.status === "Activa" ? "Inactiva" : "Activa";
    stateApi.state.db.chartOfAccounts = sortAccounts(accounts);
    stateApi.saveDb();
    return { ok: true, account: clone(target) };
  }

  function movementOptions() {
    return sortAccounts(all()).filter(account => account.status === "Activa" && account.isMovement);
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.chartOfAccounts = {
    all,
    sortAccounts,
    childrenOf,
    findByCode,
    validateAccount,
    saveAccount,
    toggleActive,
    movementOptions,
    levelFromCode
  };
})();
