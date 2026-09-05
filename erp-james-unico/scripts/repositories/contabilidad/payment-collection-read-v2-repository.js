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
    const message = String(error?.message || "Backend de pagos y cobros pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message: status === "BACKEND_MISSING" ? "Backend de pagos y cobros pendiente de actualización." : message };
  }
  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura de pagos y cobros V2 no está configurada." }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_payment_collection_read_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "PAYMENT_COLLECTION_READ_V2" || result.migration !== "202608230008"
      || !result.paymentHistory || !result.paymentDetail || !result.collectionHistory || !result.collectionDetail
      || !result.payableLookup || !result.receivableLookup) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "Backend de pagos y cobros pendiente de actualización." }, companyId);
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
    return result?.ok ? result : { ok: false, message: result?.message || "La consulta no respondió correctamente." };
  }
  function paging(options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return { p_limit: limit, p_offset: Math.max(0, Number(options.offset || 0)) };
  }
  function payableLookup(filters = {}, options = {}) {
    return call("erp_supplier_payables_open_page", {
      p_provider_id: filters.providerId || null, p_state: null, p_due_mode: null,
      p_search: filters.search || null, ...paging(options)
    });
  }
  function receivableLookup(filters = {}, options = {}) {
    return call("erp_customer_receivables_open_page", {
      p_customer_id: filters.customerId || null, p_state: null, p_due_mode: null,
      p_search: filters.search || null, ...paging(options)
    });
  }
  function paymentHistory(filters = {}, options = {}) {
    return call("erp_supplier_payments_history_page", {
      p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
      p_provider_id: filters.providerId || null, p_bank_account_id: filters.bankAccountId || null,
      p_state: filters.state || null, p_document: filters.document || null,
      p_search: filters.search || null, ...paging(options)
    });
  }
  function collectionHistory(filters = {}, options = {}) {
    return call("erp_customer_collections_history_page", {
      p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
      p_customer_id: filters.customerId || null, p_bank_account_id: filters.bankAccountId || null,
      p_state: filters.state || null, p_document: filters.document || null,
      p_search: filters.search || null, ...paging(options)
    });
  }
  function paymentDetail(id, source) {
    return call("erp_supplier_payment_detail", { p_payment_id: String(id || ""), p_source: source || "SUPPLIER_FINANCE_V2" });
  }
  function collectionDetail(id, source) {
    return call("erp_customer_collection_detail", { p_collection_id: String(id || ""), p_source: source || "FINANCIAL_V2" });
  }
  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (channel && channelCompanyId === companyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    const emitLegacy = event => {
      const entity = String(event?.new?.entity || event?.old?.entity || "");
      if (["payments", "collections"].includes(entity)) emit("erp_entity_records")(event);
    };
    channelCompanyId = companyId;
    channel = db.channel(`payment-collection-read-v2-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_payments", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_payments"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_payment_applications", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_payment_applications"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_collections", filter: `company_id=eq.${companyId}` }, emit("erp_financial_collections"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_collection_applications", filter: `company_id=eq.${companyId}` }, emit("erp_financial_collection_applications"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, emitLegacy)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("payment-collection-read-v2", true);
    return true;
  }

  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("payment-collection-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.paymentCollectionReadV2Repository = Object.freeze({
    activeCompanyUuid, canExecute, collectionDetail, collectionHistory, payableLookup,
    paymentDetail, paymentHistory, probeBackend, receivableLookup, subscribe, unsubscribe
  });
})();
