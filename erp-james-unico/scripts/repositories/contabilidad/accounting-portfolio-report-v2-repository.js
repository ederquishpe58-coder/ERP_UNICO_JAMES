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
    const message = String(error?.message || "Backend de reportes de cartera pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message: status === "BACKEND_MISSING"
      ? "Backend de reportes de cartera pendiente de actualización." : message };
  }
  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura server-side de reportes de cartera no está configurada." }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_accounting_portfolio_report_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "ACCOUNTING_PORTFOLIO_REPORT_V2" || result.migration !== "202608230015"
      || !result.reportPage || !result.payableAuthority || !result.receivableAuthority
      || !result.payableDetail || !result.receivableDetail || !result.paymentDetail || !result.collectionDetail) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "Backend de reportes de cartera pendiente de actualización." }, companyId);
    }
    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: "VERIFIED", data: result };
  }
  async function reportPage(view, filters = {}, options = {}) {
    const companyId = activeCompanyUuid();
    const ready = await probeBackend();
    if (!ready.ok) return ready;
    const { data, error } = await client().rpc("erp_accounting_portfolio_report_page", {
      p_company_id: companyId,
      p_view: String(view || "").toUpperCase(),
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_provider_id: filters.providerId || null,
      p_customer_id: filters.customerId || null,
      p_status: filters.status || null,
      p_search: filters.search || null,
      p_limit: Number(options.limit || 25),
      p_offset: Number(options.offset || 0)
    });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? result : { ok: false, message: result?.message || "El reporte de cartera no respondió correctamente." };
  }
  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (channel && channelCompanyId === companyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    const legacy = event => {
      const record = event?.new || event?.old || {};
      if (new Set(["purchase_payables", "customer_receivables", "payments", "payment_batches", "collections", "collection_batches"]).has(String(record.entity || ""))) {
        emit("erp_entity_records")(event);
      }
    };
    channelCompanyId = companyId;
    channel = db.channel(`accounting-portfolio-report-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_accounts_payable", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_accounts_payable"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_payments", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_payments"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_payment_applications", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_payment_applications"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_receivables", filter: `company_id=eq.${companyId}` }, emit("erp_financial_receivables"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_collections", filter: `company_id=eq.${companyId}` }, emit("erp_financial_collections"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_collection_applications", filter: `company_id=eq.${companyId}` }, emit("erp_financial_collection_applications"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, legacy)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-portfolio-report-v2", true);
    return true;
  }
  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-portfolio-report-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch { try { await current.unsubscribe?.(); } catch {} }
    return true;
  }
  BlessERP.accountingPortfolioReportV2Repository = Object.freeze({ activeCompanyUuid, canExecute, probeBackend, reportPage, subscribe, unsubscribe });
})();
