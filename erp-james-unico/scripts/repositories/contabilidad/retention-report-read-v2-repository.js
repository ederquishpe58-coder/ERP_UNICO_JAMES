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
    const message = String(error?.message || "Backend del reporte de retenciones pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message: status === "BACKEND_MISSING" ? "Backend del reporte de retenciones pendiente de actualización." : message };
  }
  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura V2 del reporte de retenciones no está configurada." }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_retention_report_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "RETENTION_REPORT_READ_V2" || result.migration !== "202608230012"
      || !result.issuedAuthority || !result.receivedAuthority || !result.page || !result.issuedDetail || !result.receivedDetail) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "Backend del reporte de retenciones pendiente de actualización." }, companyId);
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
    return result?.ok ? result : { ok: false, message: result?.message || "El reporte de retenciones no respondió correctamente." };
  }
  function page(filters = {}, options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return call("erp_retention_report_page", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_type: filters.type || "ALL",
      p_status: filters.status || null,
      p_supplier_id: filters.supplierId || null,
      p_customer_id: filters.customerId || null,
      p_retention_code: filters.retentionCode || null,
      p_retention_number: filters.retentionNumber || null,
      p_document_number: filters.documentNumber || null,
      p_search: filters.search || null,
      p_limit: limit,
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }
  function issuedDetail(row = {}) {
    return call("erp_purchase_withholding_v2_detail", {
      p_purchase_document_id: row.originDocumentId || null,
      p_electronic_document_id: row.retentionId || null
    });
  }
  function receivedDetail(row = {}) {
    return call("erp_received_withholding_detail", { p_received_id: String(row.retentionId || "") });
  }
  function legacyIssuedDetail(row = {}) {
    return call("erp_retention_report_legacy_detail", { p_retention_id: String(row.retentionId || "") });
  }
  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (channel && channelCompanyId === companyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    const received = event => {
      const record = event?.new || event?.old || {};
      if (String(record.entity || "") === "received_withholdings") emit("erp_entity_records")(event);
    };
    channelCompanyId = companyId;
    channel = db.channel(`retention-report-read-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_withholding_links", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_withholding_links"))
      .on("postgres_changes", { event: "*", schema: "public", table: "electronic_documents", filter: `company_id=eq.${companyId}` }, emit("electronic_documents"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, received)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("retention-report-read-v2", true);
    return true;
  }

  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("retention-report-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.retentionReportReadV2Repository = Object.freeze({
    activeCompanyUuid, canExecute, issuedDetail, legacyIssuedDetail, page, probeBackend, receivedDetail, subscribe, unsubscribe
  });
})();
