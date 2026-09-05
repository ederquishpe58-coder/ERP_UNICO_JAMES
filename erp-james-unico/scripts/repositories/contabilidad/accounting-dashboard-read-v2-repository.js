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
    const message = String(error?.message || "Backend del Dashboard contable pendiente de actualización.");
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), data: null, error };
    return {
      ok: false,
      status,
      error,
      message: status === "BACKEND_MISSING"
        ? "Backend del Dashboard contable pendiente de actualización."
        : message
    };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured()) {
      return failure({ code: "NOT_CONFIGURED", message: "La lectura agregada del Dashboard contable no está configurada." }, companyId);
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", data: health.data };
    const { data, error } = await client().rpc("erp_accounting_dashboard_health", { p_company_id: companyId });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "ACCOUNTING_DASHBOARD_READ_V2" || result.migration !== "202608230013"
      || !result.summaryRpc || !result.purchaseAuthority || !result.payableAuthority || !result.receivableAuthority
      || !result.treasuryAuthority || !result.journalAuthority || !result.inventoryProjection) {
      return failure({ code: "INCOMPLETE_BACKEND", message: "Backend del Dashboard contable pendiente de actualización." }, companyId);
    }
    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), data: result, error: null };
    return { ok: true, status: "VERIFIED", data: result };
  }

  async function summary(filters = {}) {
    const companyId = activeCompanyUuid();
    const ready = await probeBackend();
    if (!ready.ok) return ready;
    const { data, error } = await client().rpc("erp_accounting_dashboard_summary", {
      p_company_id: companyId,
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_period: filters.period || null,
      p_purchase_status: filters.status || null
    });
    if (error) return failure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? result : { ok: false, message: result?.message || "El Dashboard contable no respondió correctamente." };
  }

  function subscribe(onChange) {
    const companyId = activeCompanyUuid();
    const db = client();
    if (!db?.channel || !companyId) return null;
    if (channel && channelCompanyId === companyId) return true;
    if (channel) void db.removeChannel(channel);
    const emit = table => event => onChange?.({
      table,
      eventType: event?.eventType || "UPDATE",
      new: event?.new || null,
      old: event?.old || null
    });
    const legacy = event => {
      const record = event?.new || event?.old || {};
      const allowed = new Set([
        "accounting_journal_entries", "purchases", "purchase_payables", "customer_receivables",
        "issued_withholdings", "received_withholdings", "bank_accounts", "bank_movements",
        "bank_reconciliations", "inventory_items", "material_inventory_movements"
      ]);
      if (allowed.has(String(record.entity || ""))) emit("erp_entity_records")(event);
    };
    channelCompanyId = companyId;
    channel = db.channel(`accounting-dashboard-read-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_documents", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_documents"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_accounts_payable", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_accounts_payable"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_receivables", filter: `company_id=eq.${companyId}` }, emit("erp_financial_receivables"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_financial_journal_entries", filter: `company_id=eq.${companyId}` }, emit("erp_financial_journal_entries"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_bank_accounts", filter: `company_id=eq.${companyId}` }, emit("erp_treasury_bank_accounts"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_bank_transactions", filter: `company_id=eq.${companyId}` }, emit("erp_treasury_bank_transactions"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_treasury_reconciliations", filter: `company_id=eq.${companyId}` }, emit("erp_treasury_reconciliations"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_supplier_purchase_withholding_links", filter: `company_id=eq.${companyId}` }, emit("erp_supplier_purchase_withholding_links"))
      .on("postgres_changes", { event: "*", schema: "public", table: "electronic_documents", filter: `company_id=eq.${companyId}` }, emit("electronic_documents"))
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_entity_records", filter: `company_id=eq.${companyId}` }, legacy)
      .subscribe();
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-dashboard-read-v2", true);
    return true;
  }
  async function unsubscribe() {
    const current = channel;
    channel = null;
    channelCompanyId = "";
    BlessERP.syncInstrumentation?.setRealtimeSubscription?.("accounting-dashboard-read-v2", false);
    if (!current) return true;
    try { await client()?.removeChannel?.(current); }
    catch { try { await current.unsubscribe?.(); } catch {} }
    return true;
  }

  BlessERP.accountingDashboardReadV2Repository = Object.freeze({
    activeCompanyUuid,
    canExecute,
    probeBackend,
    subscribe,
    unsubscribe,
    summary
  });
})();
