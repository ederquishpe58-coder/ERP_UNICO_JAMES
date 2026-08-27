(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.accountingDashboardReadV2Repository;
  let realtimeTimer = null;
  const runtime = {
    started: false,
    subscribed: false,
    activeRoute: "",
    loading: false,
    generated: false,
    stale: false,
    error: "",
    summary: null,
    series: {},
    meta: {},
    appliedFilters: null,
    onChange: null
  };

  function snapshot() { return clone(runtime); }

  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) {
      repo()?.subscribe?.(scheduleRefresh);
      runtime.subscribed = true;
    }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend del Dashboard contable pendiente de actualización.");
    runtime.onChange?.();
    return snapshot();
  }
  async function stop() {
    if (realtimeTimer) { clearTimeout(realtimeTimer); realtimeTimer = null; }
    runtime.activeRoute = "";
    runtime.onChange = null;
    if (runtime.subscribed) await repo()?.unsubscribe?.();
    runtime.subscribed = false;
    return snapshot();
  }

  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }

  async function generate(filters = {}, options = {}) {
    if (runtime.loading && !options.force) return snapshot();
    runtime.loading = true;
    runtime.error = "";
    runtime.onChange?.();
    try {
      const result = await repo()?.summary?.(filters);
      if (!result?.ok) throw new Error(result?.message || "No se pudo generar el Dashboard contable.");
      runtime.summary = clone(result.summary || {});
      runtime.series = clone(result.series || {});
      runtime.meta = clone(result.meta || {});
      runtime.appliedFilters = {
        ...clone(filters),
        ...clone(result.filters || {}),
        status: result.filters?.purchaseStatus ?? filters.status ?? ""
      };
      runtime.generated = true;
      runtime.stale = false;
      return snapshot();
    } catch (error) {
      runtime.error = error.message;
      throw error;
    } finally {
      runtime.loading = false;
      runtime.onChange?.();
    }
  }

  function eventRelevant(event = {}) {
    if (event.table === "electronic_documents") {
      const record = event.new || event.old || {};
      return String(record.document_type || "") === "07";
    }
    return new Set([
      "erp_supplier_purchase_documents", "erp_supplier_accounts_payable", "erp_financial_receivables",
      "erp_financial_journal_entries", "erp_treasury_bank_accounts", "erp_treasury_bank_transactions",
      "erp_treasury_reconciliations", "erp_supplier_purchase_withholding_links", "erp_entity_records"
    ]).has(String(event.table || ""));
  }

  function scheduleRefresh(event = {}) {
    if (!eventRelevant(event) || !runtime.generated || !runtime.appliedFilters) return;
    runtime.stale = true;
    runtime.onChange?.();
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      if (route !== "reports-dashboard" || !runtime.generated) return;
      await generate(runtime.appliedFilters, { force: true }).catch(() => {});
    }, 220);
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.accountingDashboardReadV2 = Object.freeze({
    generate,
    setActiveRoute,
    snapshot,
    start,
    stop
  });
})();
