(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, data: null, error: null };
  let realtimeChannel = null;
  let realtimeCompanyId = "";

  function activeCompanyUuid() {
    return String(BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }

  function client() { return BlessERP.getSupabaseClient?.(); }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.financialV2CaptureEnabled === true
      && client()?.rpc && activeCompanyUuid() && window.location?.protocol !== "file:");
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS;
  }

  function failure(error, companyId) {
    const code = String(error?.code || "");
    const message = String(error?.message || "Backend de lectura contable V2 no disponible.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      return failure({ code: "NOT_CONFIGURED", message: "La lectura contable V2 no está configurada en este entorno." }, companyId);
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_accounting_read_v2_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "ACCOUNTING_READ_V2" || result.migration !== "202608230004"
      || !result.journalTable || !result.journalLinesTable || !result.legacyProjectionTable
      || !result.journalPage || !result.journalDetail || !result.ledgerPage) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "El backend search-first de Libro Diario y Mayor está incompleto." }, companyId);
    }
    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: health.status, data: result };
  }

  async function callReadModel(name, args = {}) {
    const companyId = activeCompanyUuid();
    const backend = await probeBackend();
    if (!backend.ok) return backend;
    const { data, error } = await client().rpc(name, { p_company_id: companyId, ...args });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok) return { ok: false, code: result?.code, message: result?.message || "La consulta contable no respondió correctamente.", data: result };
    return result;
  }

  function journalPage(filters = {}, options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return callReadModel("erp_accounting_journal_page", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_status: String(filters.status || "").trim() || null,
      p_origin_module: String(filters.originModule || "").trim() || null,
      p_entry_number: String(filters.entryNumber || "").trim() || null,
      p_reference: String(filters.reference || "").trim() || null,
      p_search: String(filters.search || "").trim() || null,
      p_limit: limit,
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }

  function journalDetail(entryKey, sourceKind) {
    return callReadModel("erp_accounting_journal_detail", {
      p_entry_key: String(entryKey || "").trim(),
      p_source_kind: String(sourceKind || "").trim().toUpperCase()
    });
  }

  function ledgerPage(filters = {}, options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return callReadModel("erp_accounting_ledger_page", {
      p_account_record_id: String(filters.accountRecordId || "").trim(),
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_status: String(filters.status || "").trim() || null,
      p_search: String(filters.search || "").trim() || null,
      p_limit: limit,
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }

  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (realtimeChannel && realtimeCompanyId === companyId) return true;
    if (realtimeChannel) void db.removeChannel(realtimeChannel);
    const emit = table => event => onChange?.({
      table,
      eventType: event?.eventType || "UPDATE",
      new: event?.new || null,
      old: event?.old || null
    });
    realtimeCompanyId = companyId;
    realtimeChannel = db.channel(`accounting-read-v2-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_journal_entries", filter: `company_id=eq.${companyId}` }, emit("erp_financial_journal_entries"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_journal_lines", filter: `company_id=eq.${companyId}` }, emit("erp_financial_journal_lines"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, event => {
        const entity = event?.new?.entity || event?.old?.entity;
        if (["accounting_journal_entries", "accounting_chart_accounts"].includes(entity)) emit("erp_entity_records")(event);
      })
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-read-v2", true);
    return true;
  }

  function healthStatus() { return { ...health, available: canExecute() }; }

  async function unsubscribe() {
    const current = realtimeChannel;
    realtimeChannel = null;
    realtimeCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.accountingReadV2Repository = Object.freeze({
    activeCompanyUuid,
    canExecute,
    healthStatus,
    journalDetail,
    journalPage,
    ledgerPage,
    probeBackend,
    subscribe,
    unsubscribe
  });
})();
