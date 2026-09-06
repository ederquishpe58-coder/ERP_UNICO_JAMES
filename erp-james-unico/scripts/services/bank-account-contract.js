(function () {
  const erp = window.BlessERP = window.BlessERP || {};
  const company = () => String(erp.getTreasuryV2Repository?.()?.activeCompanyUuid?.() || "");
  const required = () => erp.getEnvConfig?.().supabaseEnabled === true;
  function belongs(row) {
    const id = company(), access = erp.authAccess?.activeAccess?.() || {};
    const key = (access.companies || []).find(c => c.id === id)?.company_key || access.activeCompany?.company_key;
    const scope = row?.company_id || row?.companyId;
    return Boolean(id && scope && [id, key].filter(Boolean).includes(scope));
  }
  function ledger(code, purpose = "Cuenta") {
    const row = erp.services.chartOfAccounts.findByCode(code);
    if (!row || row.deleted_at || row.__deleted || (required() && Number(row.__syncVersion || 0) < 1)) throw new Error(`FINANCE_V2_ACCOUNT_NOT_FOUND:${code || "(sin código)"} — ${purpose}`);
    const selected = erp.services.companyContext?.activeCompanyId?.();
    // Canonical chart payloads can omit company fields; the sync layer scopes the active company store.
    // An explicit foreign scope is always rejected; the Finance RPC rechecks the canonical company row.
    if (required() && ((row.company_id || row.companyId) ? !belongs(row) : !belongs({ company_id: selected }))) throw new Error(`FINANCE_V2_ACCOUNT_WRONG_COMPANY:${code} — ${purpose}`);
    if (row.status !== "Activa") throw new Error(`FINANCE_V2_ACCOUNT_INACTIVE:${code} — ${purpose}`);
    if (row.isMovement !== true) throw new Error(`FINANCE_V2_ACCOUNT_NOT_MOVEMENT:${code} — ${purpose}`);
    return row;
  }
  function bank(id) {
    const row = (erp.services.treasuryV2?.bankAccounts?.() || []).find(a => a.id === id || a.bankAccountId === id);
    if (!row || !belongs(row) || row.deleted_at || String(row.status).toUpperCase() !== "ACTIVE") throw new Error(`TREASURY_V2_BANK_ACCOUNT_NOT_FOUND:${id || "(sin selección)"}`);
    ledger(row.linkedAccountCode, "Cuenta contable del banco");
    return row;
  }
  function label(row = {}) {
    // These are fields returned by the canonical read model; no local catalog lookup is needed.
    return row.bankAccountLabel || [row.bankAccountCode, row.bankName].filter(Boolean).join(" · ")
      || `Banco sin identificar: ${row.bankAccountId || "sin identificador"}`;
  }
  let configuration = null, configurationRequest = null, configurationError = "", configurationCompany = "";
  function configurationSnapshot() {
    if (configurationCompany !== company()) { configuration = null; configurationError = ""; configurationCompany = company(); }
    if (configuration?.companyId !== company()) configuration = null;
    return { ready: Boolean(configuration), companyId: company(), error: configurationError, mainBank: configuration?.mainBank || "", accounts: configuration?.accounts || [] };
  }
  async function loadConfiguration() {
    const id = company();
    configurationSnapshot();
    if (configurationRequest?.companyId === id) return configurationRequest.promise;
    configuration = null; configurationError = "";
    const request = { companyId: id };
    request.promise = (async () => {
      try {
        const result = await erp.getTreasuryV2Repository().bankAccountingConfiguration();
        if (id !== company()) throw new Error("TREASURY_COMPANY_CHANGED");
        configuration = result; return configurationSnapshot();
      } catch (error) { if (id === company()) configurationError = error.message; throw error; }
      finally { if (configurationRequest === request) configurationRequest = null; }
    })();
    configurationRequest = request; return request.promise;
  }
  function accountOptions() {
    if (!required()) return erp.services.chartOfAccounts.movementOptions();
    const snapshot = configurationSnapshot();
    return snapshot.accounts.filter(row => !row.deleted_at && !row.payload.deleted_at && !row.payload.__deleted && row.payload.isMovement === true && ["ACTIVE", "ACTIVA"].includes(String(row.payload.status).toUpperCase()))
      .map(row => ({ ...row.payload, code: row.payload.code || row.record_id })).sort((a,b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }
  async function resolveAccount(account) {
    const id = company();
    if (account.treasuryCompanyId && account.treasuryCompanyId !== id) throw new Error("TREASURY_COMPANY_CHANGED: vuelva a abrir el formulario en la empresa actual.");
    const repository = erp.getTreasuryV2Repository();
    const config = await repository.bankAccountingConfiguration();
    if (id !== company()) throw new Error("TREASURY_COMPANY_CHANGED");
    return repository.resolveBankLedger(config, account.linkedAccountCode);
  }
  function fingerprint(value) {
    if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${fingerprint(value[k])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  const pending = new Set();
  async function saveDraft(prepare) {
    const id = company(), user = erp.authAccess?.activeAccess?.()?.session?.user?.id;
    if (!id || !user || !erp.state.saveDbConfirmed || !erp.syncEntityRegistry) return { ok: false, errors: ["Confirmación canónica no disponible."] };
    if (pending.has(id)) return { ok: false, errors: ["Ya existe un guardado bancario en curso."] };
    pending.add(id);
    try {
      const prepared = prepare(); if (!prepared?.ok) return prepared;
      const movement = prepared.movement, serialize = erp.syncEntityRegistry.serializableRecord;
      const expected = fingerprint(serialize(movement, "bank_movements"));
      const result = await erp.state.saveDbConfirmed({ entity: "bank_movements", recordId: movement.id, skipCloudSnapshot: true });
      if (id !== company() || user !== erp.authAccess?.activeAccess?.()?.session?.user?.id) throw new Error("La empresa o sesión cambió durante el guardado; consulte la empresa de origen.");
      const server = result?.serverRecord;
      if (!result?.ok || !result.confirmed || !server || server.company_id !== id || server.entity !== "bank_movements" || server.record_id !== movement.id || server.deleted_at || Number(server.version || 0) < 1 || fingerprint(serialize(server.payload, "bank_movements")) !== expected) throw new Error(result?.message || "Supabase no confirmó este borrador; no se informó éxito.");
      return { ...prepared, confirmed: true, serverRecord: server };
    } catch (error) { return { ok: false, confirmed: false, errors: [error.message] }; }
    finally { pending.delete(id); }
  }
  erp.services = erp.services || {};
  erp.services.bankAccountContract = { company, belongs, required, ledger, bank, label, saveDraft, configurationSnapshot, loadConfiguration, accountOptions, resolveAccount };
})();
