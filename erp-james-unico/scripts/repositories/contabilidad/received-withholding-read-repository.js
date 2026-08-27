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
    return Boolean(config.supabaseEnabled && client()?.rpc && activeCompanyUuid() && window.location?.protocol !== "file:");
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS;
  }

  function failure(error, companyId) {
    const code = String(error?.code || "");
    const message = String(error?.message || "Backend de retenciones recibidas no disponible.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      return failure({ code: "NOT_CONFIGURED", message: "La consulta search-first no está disponible en este entorno." }, companyId);
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_received_withholding_read_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "RECEIVED_WITHHOLDING_READ" || result.migration !== "202608230006"
      || !result.receivedProjection || !result.canonicalReceivables || !result.page || !result.detail || !result.receivableLookup) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "El read-model de retenciones recibidas está incompleto." }, companyId);
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
    if (!result?.ok) return { ok: false, code: result?.code, message: result?.message || "La consulta no respondió correctamente.", data: result };
    return result;
  }

  function page(filters = {}, options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return callReadModel("erp_received_withholding_page", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_customer_id: String(filters.customerId || "").trim() || null,
      p_status: String(filters.status || "").trim() || null,
      p_number: String(filters.number || "").trim() || null,
      p_document: String(filters.document || "").trim() || null,
      p_search: String(filters.search || "").trim() || null,
      p_limit: limit,
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }

  function detail(receivedId) {
    return callReadModel("erp_received_withholding_detail", { p_received_id: String(receivedId || "").trim() });
  }

  function receivableLookup(customerId, search = "", options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return callReadModel("erp_received_withholding_receivable_lookup", {
      p_customer_id: String(customerId || "").trim(),
      p_search: String(search || "").trim() || null,
      p_limit: limit
    });
  }

  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (realtimeChannel && realtimeCompanyId === companyId) return true;
    if (realtimeChannel) void db.removeChannel(realtimeChannel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    realtimeCompanyId = companyId;
    realtimeChannel = db.channel(`received-withholding-read-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, event => {
        const entity = event?.new?.entity || event?.old?.entity;
        if (["received_withholdings", "customer_receivables", "accounting_journal_entries"].includes(entity)) emit("erp_entity_records")(event);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_receivables", filter: `company_id=eq.${companyId}` }, emit("erp_financial_receivables"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_journal_entries", filter: `company_id=eq.${companyId}` }, emit("erp_financial_journal_entries"))
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("received-withholding-read", true);
    return true;
  }

  async function unsubscribe() {
    const current = realtimeChannel;
    realtimeChannel = null;
    realtimeCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("received-withholding-read", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.receivedWithholdingReadRepository = Object.freeze({
    activeCompanyUuid, canExecute, detail, healthStatus: () => ({ ...health, available: canExecute() }),
    page, probeBackend, receivableLookup, subscribe, unsubscribe
  });
})();
