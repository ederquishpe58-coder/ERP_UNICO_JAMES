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
    return Boolean(config.supabaseEnabled && config.supplierFinanceV2CaptureEnabled === true
      && client()?.rpc && activeCompanyUuid() && window.location?.protocol !== "file:");
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS;
  }

  function failure(error, companyId) {
    const code = String(error?.code || "");
    const message = String(error?.message || "Backend de Retenciones V2 no disponible.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return failure({ code: "NOT_CONFIGURED", message: "Retenciones V2 no está configurado." }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_purchase_withholding_v2_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "PURCHASE_WITHHOLDING_V2" || result.migration !== "202608200002"
      || result.readModelMigration !== "202608230003"
      || !result.linksTable || !result.draftRpc || !result.financialV2
      || !result.pendingReadModel || !result.historyReadModel || !result.detailReadModel) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "El backend canónico de Retenciones V2 está incompleto." }, companyId);
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
    if (!result?.ok) return { ok: false, message: result?.message || "La consulta de Retenciones V2 no respondió correctamente.", data: result };
    return result;
  }

  function pendingPage(options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 50;
    return callReadModel("erp_purchase_withholding_v2_pending_page", {
      p_limit: limit,
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }

  function historyPage(filters = {}, options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return callReadModel("erp_purchase_withholding_v2_history_page", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_provider_search: String(filters.provider || "").trim() || null,
      p_status: String(filters.status || "").trim() || null,
      p_retention_number: String(filters.retentionNumber || "").trim() || null,
      p_purchase_number: String(filters.purchaseNumber || "").trim() || null,
      p_search: String(filters.search || "").trim() || null,
      p_limit: limit,
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }

  function detailContext(options = {}) {
    return callReadModel("erp_purchase_withholding_v2_detail", {
      p_purchase_document_id: options.purchaseId || null,
      p_electronic_document_id: options.documentId || null
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
    realtimeChannel = db.channel(`purchase-withholding-v2-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_withholding_links", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_withholding_links"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_documents", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_documents"))
      .on("postgres_changes", { event: "*", schema: "public", table: "electronic_documents", filter: `company_id=eq.${companyId}` }, event => {
        if (event.new?.document_type === "07" || event.old?.document_type === "07") emit("electronic_documents")(event);
      })
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("purchase-withholding-v2", true);
    return true;
  }

  function healthStatus() { return { ...health, available: canExecute() }; }

  async function unsubscribe() {
    const current = realtimeChannel;
    realtimeChannel = null;
    realtimeCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("purchase-withholding-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.purchaseWithholdingV2Repository = Object.freeze({
    activeCompanyUuid,
    canExecute,
    detailContext,
    healthStatus,
    historyPage,
    pendingPage,
    probeBackend,
    subscribe,
    unsubscribe
  });
})();
