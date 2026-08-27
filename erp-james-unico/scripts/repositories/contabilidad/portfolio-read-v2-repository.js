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
    const message = String(error?.message || "Backend de cartera pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return { ok: false, status, error, message: status === "BACKEND_MISSING" ? "Backend de cartera pendiente de actualización." : message };
  }
  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura de cartera V2 no está configurada." }, companyId);
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_portfolio_read_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "PORTFOLIO_READ_V2" || result.migration !== "202608230007"
      || !result.supplierPayables || !result.customerReceivables || !result.apOpen || !result.apHistory
      || !result.apDetail || !result.arOpen || !result.arHistory || !result.arDetail) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "Backend de cartera pendiente de actualización." }, companyId);
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
    return result?.ok ? result : { ok: false, message: result?.message || "La consulta de cartera no respondió correctamente." };
  }
  function paging(options = {}) {
    const limit = [25, 50].includes(Number(options.limit)) ? Number(options.limit) : 25;
    return { p_limit: limit, p_offset: Math.max(0, Number(options.offset || 0)) };
  }
  function apOpen(filters = {}, options = {}) {
    return call("erp_supplier_payables_open_page", {
      p_provider_id: filters.providerId || null, p_state: filters.state || null,
      p_due_mode: filters.dueMode || null, p_search: filters.search || null, ...paging(options)
    });
  }
  function apHistory(filters = {}, options = {}) {
    return call("erp_supplier_payables_history_page", {
      p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
      p_provider_id: filters.providerId || null, p_state: filters.state || null,
      p_document: filters.document || null, p_search: filters.search || null, ...paging(options)
    });
  }
  function apDetail(id, source) { return call("erp_supplier_payable_detail", { p_payable_id: String(id || ""), p_source: source || "SUPPLIER_FINANCE_V2" }); }
  function arOpen(filters = {}, options = {}) {
    return call("erp_customer_receivables_open_page", {
      p_customer_id: filters.customerId || null, p_state: filters.state || null,
      p_due_mode: filters.dueMode || null, p_search: filters.search || null, ...paging(options)
    });
  }
  function arHistory(filters = {}, options = {}) {
    return call("erp_customer_receivables_history_page", {
      p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
      p_customer_id: filters.customerId || null, p_state: filters.state || null,
      p_document_type: filters.documentType || null, p_document: filters.document || null,
      p_search: filters.search || null, ...paging(options)
    });
  }
  function arDetail(id, source) { return call("erp_customer_receivable_detail", { p_receivable_id: String(id || ""), p_source: source || "FINANCIAL_V2" }); }

  async function customerById(customerId) {
    const companyId = activeCompanyUuid();
    const id = String(customerId || "").trim();
    if (!id) return { ok: false, companyId, mode: "IDENTITY_REQUIRED", message: "Falta la identidad canónica del cliente." };
    const ready = await probeBackend();
    if (!ready.ok) return ready;
    const { data, error } = await client().from("erp_entity_records")
      .select("record_id,payload,version,updated_at")
      .eq("company_id", companyId)
      .eq("entity", "customers")
      .eq("record_id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { ok: false, companyId, mode: "SUPABASE_ERROR", error, message: error.message || "No se pudo consultar el cliente canónico." };
    if (!data) return { ok: false, companyId, mode: "NOT_FOUND", message: "El cliente canónico no existe en la empresa activa." };
    const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    const resolvedId = String(payload.id || data.record_id || "").trim();
    if (resolvedId !== id) return { ok: false, companyId, mode: "IDENTITY_MISMATCH", message: "La identidad del cliente no coincide." };
    return {
      ok: true,
      companyId,
      mode: "SUPABASE_READ_ONLY",
      customer: {
        ...payload,
        id: resolvedId,
        companyId,
        version: Number(data.version || 0),
        updatedAt: String(data.updated_at || payload.updatedAt || ""),
        syncFlow: "CUSTOMER_CANONICAL_READ",
        remoteConfirmed: true
      }
    };
  }

  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (channel && channelCompanyId === companyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    const legacyEntities = new Set([
      "purchase_payables", "payments", "payment_batches",
      "customer_receivables", "collections", "collection_batches", "received_withholdings"
    ]);
    const emitLegacy = event => {
      const record = event?.new || event?.old || {};
      if (!legacyEntities.has(String(record.entity || ""))) return;
      emit("erp_entity_records")(event);
    };
    channelCompanyId = companyId;
    channel = db.channel(`portfolio-read-v2-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_accounts_payable", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_accounts_payable"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_payment_applications", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_payment_applications"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_receivables", filter: `company_id=eq.${companyId}` }, emit("erp_financial_receivables"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_collection_applications", filter: `company_id=eq.${companyId}` }, emit("erp_financial_collection_applications"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_credit_notes", filter: `company_id=eq.${companyId}` }, emit("erp_financial_credit_notes"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, emitLegacy)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("portfolio-read-v2", true);
    return true;
  }

  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("portfolio-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }

  BlessERP.portfolioReadV2Repository = Object.freeze({
    activeCompanyUuid, apDetail, apHistory, apOpen, arDetail, arHistory, arOpen,
    canExecute, customerById, probeBackend, subscribe, unsubscribe
  });
})();
