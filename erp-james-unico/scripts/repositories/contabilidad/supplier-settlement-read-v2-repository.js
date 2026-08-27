(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
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
    const message = String(error?.message || "Backend de liquidaciones pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message: status === "BACKEND_MISSING" ? "Backend de liquidaciones pendiente de actualización." : message };
  }
  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura de liquidaciones V2 no está configurada." }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_supplier_settlement_read_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "SUPPLIER_SETTLEMENT_READ_V2" || result.migration !== "202608230011"
      || !result.candidates || !result.historyPage || !result.detail) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "Backend de liquidaciones pendiente de actualización." }, companyId);
    }
    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: "VERIFIED", data: result };
  }
  async function call(name, args = {}) {
    const companyId = activeCompanyUuid();
    const ready = await probeBackend();
    if (!ready.ok) return ready;
    const { data, error } = await client().rpc(name, { p_company_id: companyId, ...args });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? result : { ok: false, message: result?.message || "La consulta de liquidaciones no respondió correctamente." };
  }
  function candidates(filters = {}) {
    return call("erp_supplier_settlement_candidates", {
      p_provider_id: filters.providerId || null, p_period_start: filters.periodStart || null,
      p_period_end: filters.periodEnd || null, p_quantity_type: filters.quantityType || "STEM", p_limit: 500
    });
  }
  function historyPage(filters = {}, options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return call("erp_supplier_settlement_history_page", {
      p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
      p_provider_id: filters.providerId || null, p_status: filters.status || null,
      p_reference: filters.reference || null, p_search: filters.search || null,
      p_limit: limit, p_offset: Math.max(0, Number(options.offset || 0))
    });
  }
  function detail(id) { return call("erp_supplier_settlement_detail", { p_settlement_id: String(id || "") }); }
  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (channel && channelCompanyId === companyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    const reception = event => {
      const record = event?.new || event?.old || {};
      if (String(record.entity || "") === "operations_receptions") emit("erp_entity_records")(event);
    };
    channelCompanyId = companyId;
    channel = db.channel(`supplier-settlement-read-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_settlements", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_settlements"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_settlement_lines", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_settlement_lines"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_reception_cost_allocations", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_reception_cost_allocations"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_accounts_payable", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_accounts_payable"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, reception)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("supplier-settlement-read-v2", true);
    return true;
  }

  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("supplier-settlement-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.supplierSettlementReadV2Repository = Object.freeze({ activeCompanyUuid, canExecute, candidates, detail, historyPage, probeBackend, subscribe, unsubscribe });
})();
