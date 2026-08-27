(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  const BACKEND_MESSAGE = "Backend de estados financieros pendiente de actualización.";
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, data: null, error: null };
  let channel = null;
  let channelCompanyId = "";

  function activeCompanyUuid() {
    return String(BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }

  function client() { return BlessERP.getSupabaseClient?.(); }

  function configured() {
    const env = BlessERP.getEnvConfig?.() || {};
    return Boolean(env.supabaseEnabled && env.financialV2CaptureEnabled === true && client()?.rpc
      && activeCompanyUuid() && window.location?.protocol !== "file:");
  }

  function canExecute() {
    return configured() && health.status === "VERIFIED" && health.companyId === activeCompanyUuid()
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS;
  }

  function failure(error, companyId) {
    const code = String(error?.code || "");
    const rawMessage = String(error?.message || BACKEND_MESSAGE);
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(rawMessage)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message: status === "BACKEND_MISSING" ? BACKEND_MESSAGE : rawMessage };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: BACKEND_MESSAGE }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_accounting_financial_statements_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "ACCOUNTING_FINANCIAL_STATEMENTS_READ_V2"
      || result.migration !== "202608230014" || !result.balanceRows || !result.validation
      || !result.trialBalance || !result.incomeStatement || !result.balanceSheet
      || !result.journalAuthority || !result.journalLinesAuthority || !result.accountPlanAuthority) {
      return failure({ code: "INCOMPLETE_BACKEND", message: BACKEND_MESSAGE }, companyId);
    }
    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: "VERIFIED", data: result };
  }

  async function execute(rpcName, args) {
    const companyId = activeCompanyUuid();
    const ready = await probeBackend();
    if (!ready.ok) return ready;
    const { data, error } = await client().rpc(rpcName, { p_company_id: companyId, ...args });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? result : { ok: false, message: result?.message || BACKEND_MESSAGE };
  }

  function trialBalance(filters = {}) {
    return execute("erp_accounting_trial_balance", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_account_code: filters.accountCode || null,
      p_account_type: filters.accountType || null,
      p_include_zero: filters.includeZeroRows === true
    });
  }

  function incomeStatement(filters = {}) {
    return execute("erp_accounting_income_statement", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null
    });
  }

  function balanceSheet(filters = {}) {
    return execute("erp_accounting_balance_sheet", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null
    });
  }

  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (channel && channelCompanyId === companyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({
      table,
      eventType: event?.eventType || "UPDATE",
      new: event?.new || null,
      old: event?.old || null
    });
    const legacy = event => {
      const record = event?.new || event?.old || {};
      if (["accounting_chart_accounts", "accounting_journal_entries"].includes(String(record.entity || ""))) {
        emit("erp_entity_records")(event);
      }
    };
    channelCompanyId = companyId;
    channel = db.channel(`accounting-financial-statements-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_journal_entries", filter: `company_id=eq.${companyId}` }, emit("erp_financial_journal_entries"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_journal_lines", filter: `company_id=eq.${companyId}` }, emit("erp_financial_journal_lines"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, legacy)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("financial-statements-read-v2", true);
    return true;
  }
  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("financial-statements-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch { try { await current.unsubscribe?.(); } catch {} }
    return true;
  }

  BlessERP.financialStatementsReadV2Repository = Object.freeze({
    activeCompanyUuid,
    balanceSheet,
    canExecute,
    incomeStatement,
    probeBackend,
    subscribe,
    unsubscribe,
    trialBalance
  });
})();
