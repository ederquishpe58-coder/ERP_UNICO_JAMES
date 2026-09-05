(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, data: null, error: null };
  let transferHealth = { status: "UNKNOWN", companyId: "", checkedAt: 0, data: null, error: null };
  let channel = null;
  let channelCompanyId = "";

  function companyId() {
    return String(BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }
  function client() { return BlessERP.getSupabaseClient?.(); }
  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.financialV2CaptureEnabled === true
      && client()?.rpc && companyId() && window.location?.protocol !== "file:");
  }
  function canExecute() {
    return configured() && health.status === "VERIFIED" && health.companyId === companyId()
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS;
  }
  function canExecuteTransfers() {
    return configured() && transferHealth.status === "VERIFIED" && transferHealth.companyId === companyId()
      && Date.now() - transferHealth.checkedAt <= HEALTH_TTL_MS;
  }
  function failure(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "Backend search-first de Tesorería no disponible.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId: companyId(), checkedAt: Date.now(), data: null, error };
    return { ok: false, status, message, error };
  }
  async function probeBackend(options = {}) {
    const activeCompanyId = companyId();
    if (!configured()) return failure({ code: "NOT_CONFIGURED", message: "La lectura search-first de Tesorería no está configurada." });
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_treasury_search_v2_health", { p_company_id: activeCompanyId });
    if (error) return failure(error);
    const result = Array.isArray(data) ? data[0] : data;
    const required = ["bankTransactionsTable", "reconciliationsTable", "matchesTable", "reviewsTable", "movementsPage", "workspace", "historyPage", "detail"];
    if (!result?.ok || result.component !== "TREASURY_SEARCH_V2" || result.migration !== "202608230005" || required.some(key => result[key] !== true)) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "El backend search-first de movimientos y conciliaciones está incompleto." });
    }
    health = { status: "VERIFIED", companyId: activeCompanyId, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: health.status, data: result };
  }
  function transferFailure(error) {
    const code = String(error?.code || "");
    const technicalMessage = String(error?.message || "Backend search-first de transferencias no disponible.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(technicalMessage)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    const message = status === "BACKEND_MISSING"
      ? "Backend de transferencias pendiente de actualización."
      : status === "PERMISSION_DENIED"
        ? "No tienes permisos para consultar transferencias de esta empresa."
        : technicalMessage;
    transferHealth = { status, companyId: companyId(), checkedAt: Date.now(), data: null, error };
    return { ok: false, status, message, error };
  }
  async function probeTransfersBackend(options = {}) {
    const activeCompanyId = companyId();
    if (!configured()) return transferFailure({ code: "NOT_CONFIGURED", message: "La lectura search-first de transferencias no está configurada." });
    if (!options.force && canExecuteTransfers()) return { ok: true, status: "VERIFIED", data: transferHealth.data };
    const { data, error } = await client().rpc("erp_treasury_transfer_read_health", { p_company_id: activeCompanyId });
    if (error) return transferFailure(error);
    const result = Array.isArray(data) ? data[0] : data;
    const required = ["transfersTable", "bankTransactionsTable", "cashTransactionsTable", "journalEntriesTable", "historyPage", "detail"];
    if (!result?.ok || result.component !== "TREASURY_TRANSFERS_SEARCH_V2" || result.migration !== "202608230009" || required.some(key => result[key] !== true)) {
      return transferFailure({ code: "INCOMPLETE_BACKEND", message: "El backend search-first de transferencias está incompleto." });
    }
    transferHealth = { status: "VERIFIED", companyId: activeCompanyId, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: transferHealth.status, data: result };
  }
  async function call(name, args = {}) {
    const backend = await probeBackend();
    if (!backend.ok) return backend;
    const { data, error } = await client().rpc(name, { p_company_id: companyId(), ...args });
    if (error) return failure(error);
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? result : { ok: false, message: result?.message || "La consulta Treasury V2 no respondió correctamente." };
  }
  async function callTransfers(name, args = {}) {
    const backend = await probeTransfersBackend();
    if (!backend.ok) return backend;
    const { data, error } = await client().rpc(name, { p_company_id: companyId(), ...args });
    if (error) return transferFailure(error);
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? result : { ok: false, message: result?.message || "La consulta de transferencias no respondió correctamente." };
  }
  function pageSize(value) { return [25, 50].includes(Number(value)) ? Number(value) : 25; }
  function movementsPage(filters = {}, options = {}) {
    const statusMap = { BORRADOR: "DRAFT", CONTABILIZADO: "CONFIRMED", ANULADO: "VOIDED" };
    const originMap = { pagos: "SUPPLIER_PAYMENT", cobros: "COLLECTION", ajustes: "ADJUSTMENT", transferencias: "TRANSFER", manual: "MANUAL" };
    const rawStatus = String(filters.status || "").trim().toUpperCase();
    const rawOrigin = String(filters.origin || "").trim().toLowerCase();
    return call("erp_treasury_movements_page", {
      p_bank_account_id: String(filters.bankAccountId || "").trim() || null,
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_type: String(filters.type || "").trim() || null,
      p_status: statusMap[rawStatus] || rawStatus || null,
      p_origin: originMap[rawOrigin] || rawOrigin.toUpperCase() || null,
      p_search: String(filters.search || "").trim() || null,
      p_limit: pageSize(options.limit),
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }
  function reconciliationHistoryPage(filters = {}, options = {}) {
    return call("erp_treasury_reconciliation_history_page", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_bank_account_id: String(filters.bankAccountId || "").trim() || null,
      p_status: String(filters.status || "").trim() || null,
      p_reference: String(filters.reference || "").trim() || null,
      p_search: String(filters.search || "").trim() || null,
      p_limit: pageSize(options.limit),
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }
  function reconciliationWorkspace(filters = {}) {
    return call("erp_treasury_reconciliation_workspace", {
      p_bank_account_id: String(filters.bankAccountId || "").trim() || null,
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_reconciliation_id: String(filters.reconciliationId || "").trim() || null,
      p_limit: pageSize(filters.limit || 50)
    });
  }
  function reconciliationDetail(id) {
    return call("erp_treasury_reconciliation_detail", { p_reconciliation_id: String(id || "").trim() });
  }
  function transferHistoryPage(filters = {}, options = {}) {
    return callTransfers("erp_treasury_transfers_history_page", {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_source_account_type: String(filters.sourceAccountType || "").trim() || null,
      p_source_account_id: String(filters.sourceAccountId || "").trim() || null,
      p_destination_account_type: String(filters.destinationAccountType || "").trim() || null,
      p_destination_account_id: String(filters.destinationAccountId || "").trim() || null,
      p_status: String(filters.status || "").trim() || null,
      p_reference: String(filters.reference || "").trim() || null,
      p_search: String(filters.search || "").trim() || null,
      p_limit: pageSize(options.limit),
      p_offset: Math.max(0, Number(options.offset || 0))
    });
  }
  function transferDetail(id) {
    return callTransfers("erp_treasury_transfer_detail", { p_transfer_id: String(id || "").trim() });
  }
  function subscribe(onChange) {
    const activeCompanyId = companyId();
    const db = client();
    if (!db?.channel || !activeCompanyId) return null;
    if (channel && channelCompanyId === activeCompanyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({ table, eventType: event?.eventType || "UPDATE", new: event?.new || null, old: event?.old || null });
    channelCompanyId = activeCompanyId;
    channel = db.channel(`treasury-search-v2-${activeCompanyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_bank_transactions", filter: `company_id=eq.${activeCompanyId}` }, emit("erp_treasury_bank_transactions"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_reconciliations", filter: `company_id=eq.${activeCompanyId}` }, emit("erp_treasury_reconciliations"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_reconciliation_matches", filter: `company_id=eq.${activeCompanyId}` }, emit("erp_treasury_reconciliation_matches"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_reconciliation_reviews", filter: `company_id=eq.${activeCompanyId}` }, emit("erp_treasury_reconciliation_reviews"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_transfers", filter: `company_id=eq.${activeCompanyId}` }, emit("erp_treasury_transfers"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_cash_transactions", filter: `company_id=eq.${activeCompanyId}` }, emit("erp_treasury_cash_transactions"))
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("treasury-read-v2", true);
    return true;
  }
  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("treasury-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch (_) { try { await current.unsubscribe?.(); } catch (_) { /* lifecycle best effort */ } }
    return true;
  }
  BlessERP.treasuryReadV2Repository = Object.freeze({
    canExecute,
    canExecuteTransfers,
    healthStatus: () => ({ ...health, available: canExecute() }),
    transferHealthStatus: () => ({ ...transferHealth, available: canExecuteTransfers() }),
    movementsPage,
    probeBackend,
    probeTransfersBackend,
    reconciliationDetail,
    reconciliationHistoryPage,
    reconciliationWorkspace,
    subscribe,
    unsubscribe,
    transferDetail,
    transferHistoryPage
  });
})();
