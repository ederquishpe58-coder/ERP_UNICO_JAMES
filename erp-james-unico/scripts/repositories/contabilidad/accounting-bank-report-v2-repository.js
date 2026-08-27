(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, data: null, error: null };
  let channel = null;
  let channelCompanyId = "";
  function companyId() { return String(BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim(); }
  function client() { return BlessERP.getSupabaseClient?.(); }
  function configured() { const env = BlessERP.getEnvConfig?.() || {}; return Boolean(env.supabaseEnabled && env.financialV2CaptureEnabled === true && client()?.rpc && companyId() && window.location?.protocol !== "file:"); }
  function canExecute() { return configured() && health.status === "VERIFIED" && health.companyId === companyId() && Date.now() - health.checkedAt <= HEALTH_TTL_MS; }
  function failure(error, id = companyId()) {
    const code = String(error?.code || ""); const technical = String(error?.message || "Backend de reportes bancarios pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(technical) ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    const message = status === "BACKEND_MISSING" || status === "INCOMPLETE_BACKEND" ? "Backend de reportes bancarios pendiente de actualización." : technical;
    health = { status, companyId: id, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, message, error };
  }
  async function probeBackend(options = {}) {
    const id = companyId();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura server-side de reportes bancarios no está configurada." }, id);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_accounting_bank_report_health", { p_company_id: id });
    if (error) return failure(error, id);
    const result = Array.isArray(data) ? data[0] : data;
    const required = ["reportPage", "movementAuthority", "accountAuthority", "reconciliationAuthority", "movementRows", "reconciliationDetail"];
    if (!result?.ok || result.component !== "ACCOUNTING_BANK_REPORT_V2" || result.migration !== "202608230016" || required.some(key => result[key] !== true)) return failure({ code: "INCOMPLETE_BACKEND", message: "Backend de reportes bancarios pendiente de actualización." }, id);
    health = { status: "VERIFIED", companyId: id, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: "VERIFIED", data: result };
  }
  async function reportPage(view, filters = {}, options = {}) {
    const ready = await probeBackend(); if (!ready.ok) return ready;
    const statusMap = { BORRADOR: "DRAFT", CONTABILIZADO: "CONFIRMED", ANULADO: "VOIDED" };
    const rawStatus = String(filters.status || "").trim().toUpperCase();
    const { data, error } = await client().rpc("erp_accounting_bank_report_page", {
      p_company_id: companyId(), p_view: String(view || "").toUpperCase(), p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
      p_bank_account_id: String(filters.bankAccountId || "").trim() || null, p_type: String(filters.type || "").trim() || null,
      p_status: statusMap[rawStatus] || rawStatus || null, p_origin: String(filters.originModule || "").trim() || null,
      p_search: String(filters.search || "").trim() || null, p_limit: [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25,
      p_offset: Math.max(0, Number(options.offset || 0))
    });
    if (error) return failure(error);
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? result : { ok: false, message: result?.message || "El reporte bancario no respondió correctamente." };
  }
  function subscribe(onChange) {
    const id = companyId(); const db = client(); if (!db?.channel || !id) return null;
    if (channel && channelCompanyId === id) return true; if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    const legacy = event => { const entity = String(event?.new?.entity || event?.old?.entity || ""); if (["bank_movements", "bank_reconciliations"].includes(entity)) emit("erp_entity_records")(event); };
    channelCompanyId = id;
    channel = db.channel(`accounting-bank-report-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_bank_accounts", filter: `company_id=eq.${id}` }, emit("erp_treasury_bank_accounts"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_bank_transactions", filter: `company_id=eq.${id}` }, emit("erp_treasury_bank_transactions"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_reconciliations", filter: `company_id=eq.${id}` }, emit("erp_treasury_reconciliations"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${id}` }, legacy).subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-bank-report-v2", true);
    return true;
  }
  async function unsubscribe() { const current = channel; channel = null; channelCompanyId = ""; BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-bank-report-v2", false); if (!current) return true; try { await client()?.removeChannel?.(current); } catch { try { await current.unsubscribe?.(); } catch {} } return true; }
  BlessERP.accountingBankReportV2Repository = Object.freeze({ canExecute, probeBackend, reportPage, subscribe, unsubscribe });
})();
