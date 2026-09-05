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
    const message = String(error?.message || "Backend de facturas de compra pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message: status === "BACKEND_MISSING" ? "Backend de facturas de compra pendiente de actualización." : message };
  }
  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura de facturas de compra V2 no está configurada." }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_purchase_invoices_read_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "PURCHASE_INVOICES_READ_V2" || result.migration !== "202608230010"
      || !result.historyPage || !result.detail || !result.xml) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "Backend de facturas de compra pendiente de actualización." }, companyId);
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
    return result?.ok ? result : { ok: false, message: result?.message || "La consulta de facturas de compra no respondió correctamente." };
  }
  function paging(options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return { p_limit: limit, p_offset: Math.max(0, Number(options.offset || 0)) };
  }
  function historyPage(filters = {}, options = {}) {
    return call("erp_purchase_invoices_history_page", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_date_kind: filters.dateKind || "ISSUE",
      p_provider_id: filters.supplierId || null,
      p_status: filters.status || null,
      p_document_type: filters.documentType || null,
      p_posting_state: filters.postingState || null,
      p_retention_status: filters.retentionStatus || null,
      p_document_number: filters.documentNumber || null,
      p_search: filters.search || null,
      ...paging(options)
    });
  }
  function detail(id, source) {
    return call("erp_purchase_invoice_detail", { p_purchase_id: String(id || ""), p_source: source || "SUPPLIER_FINANCE_V2" });
  }
  function xml(id, source) {
    return call("erp_purchase_invoice_xml", { p_purchase_id: String(id || ""), p_source: source || "SUPPLIER_FINANCE_V2" });
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
      if (String(record.entity || "") === "purchases") emit("erp_entity_records")(event);
    };
    channelCompanyId = companyId;
    channel = db.channel(`purchase-invoice-read-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_documents", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_documents"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_lines", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_lines"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_accounts_payable", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_accounts_payable"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_withholding_links", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_withholding_links"))
      .on("postgres_changes", { event: "*", schema: "public", table: "electronic_documents", filter: `company_id=eq.${companyId}` }, emit("electronic_documents"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, legacy)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("purchase-invoice-read-v2", true);
    return true;
  }

  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("purchase-invoice-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.purchaseInvoiceReadV2Repository = Object.freeze({
    activeCompanyUuid, canExecute, detail, historyPage, probeBackend, subscribe, unsubscribe, xml
  });
})();
