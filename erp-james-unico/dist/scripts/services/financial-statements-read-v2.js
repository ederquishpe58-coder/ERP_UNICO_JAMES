(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.financialStatementsReadV2Repository;
  const viewToScope = {
    "trial-balance": "trialBalance",
    "income-statement": "incomeStatement",
    "balance-sheet": "balanceSheet"
  };
  const runtime = {
    started: false,
    subscribed: false,
    companyId: "",
    activeRoute: "",
    activeView: "trial-balance",
    healthError: "",
    onChange: null,
    reports: {
      "trial-balance": { generated: false, loading: false, stale: false, error: "", report: null, appliedFilters: null },
      "income-statement": { generated: false, loading: false, stale: false, error: "", report: null, appliedFilters: null },
      "balance-sheet": { generated: false, loading: false, stale: false, error: "", report: null, appliedFilters: null }
    }
  };
  let realtimeTimer = null;

  function snapshot() { return clone(runtime); }

  function resetForCompany() {
    const companyId = String(repo()?.activeCompanyUuid?.() || "");
    if (runtime.companyId === companyId) return;
    runtime.companyId = companyId;
    runtime.started = false;
    runtime.subscribed = false;
    runtime.healthError = "";
    Object.values(runtime.reports).forEach(state => Object.assign(state, {
      generated: false, loading: false, stale: false, error: "", report: null, appliedFilters: null
    }));
  }

  async function start(onChange) {
    resetForCompany();
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) {
      repo()?.subscribe?.(scheduleRefresh);
      runtime.subscribed = true;
    }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.healthError = health?.ok ? "" : (health?.message || "Backend de estados financieros pendiente de actualización.");
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
  function setActiveView(view) { if (viewToScope[view]) runtime.activeView = view; }

  async function generate(view, filters = {}, options = {}) {
    resetForCompany();
    if (!viewToScope[view]) throw new Error("Reporte financiero no soportado.");
    const state = runtime.reports[view];
    if (state.loading && !options.force) return snapshot();
    state.loading = true;
    state.error = "";
    runtime.onChange?.();
    try {
      const result = await repo()?.[viewToScope[view]]?.(filters);
      if (!result?.ok) throw new Error(result?.message || "No se pudo generar el estado financiero.");
      state.report = clone(result);
      state.appliedFilters = { ...clone(filters), ...clone(result.filters || {}) };
      state.generated = true;
      state.stale = false;
      return snapshot();
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.loading = false;
      runtime.onChange?.();
    }
  }

  function reportForScope(scope) {
    const state = runtime.reports[String(scope || "")];
    if (!state?.generated || !state.report) throw new Error("Primero genere el estado financiero antes de descargarlo.");
    return { report: clone(state.report), appliedFilters: clone(state.appliedFilters) };
  }

  function eventRelevant(event = {}) {
    return new Set(["erp_financial_journal_entries", "erp_financial_journal_lines", "erp_entity_records"])
      .has(String(event.table || ""));
  }

  function eventCanAffectRange(event, filters) {
    const record = event?.new || event?.old || {};
    const movementDate = String(record.accounting_date || record.accountingDate || "");
    if (!movementDate || !filters?.dateTo) return true;
    return movementDate.slice(0, 10) <= String(filters.dateTo);
  }

  function scheduleRefresh(event = {}) {
    const state = runtime.reports[runtime.activeView];
    if (!eventRelevant(event) || !state?.generated || !state.appliedFilters || !eventCanAffectRange(event, state.appliedFilters)) return;
    state.stale = true;
    runtime.onChange?.();
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      if (!["accounting-financials", "reports-accounting"].includes(route) || !state.generated) return;
      await generate(runtime.activeView, state.appliedFilters, { force: true }).catch(() => {});
    }, 220);
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.financialStatementsReadV2 = Object.freeze({
    generate,
    reportForScope,
    setActiveRoute,
    setActiveView,
    snapshot,
    start,
    stop
  });
})();
