(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.accountingBankReportV2Repository;
  const bucket = () => ({ loading: false, generated: false, stale: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null });
  const runtime = { started: false, subscribed: false, activeRoute: "", error: "", onChange: null, detail: null, reports: { movements: bucket(), balances: bucket(), reconciliations: bucket() } };
  let realtimeTimer = null;
  function snapshot() { return clone(runtime); }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (runtime.started) return snapshot(); runtime.started = true;
    const health = await repo()?.probeBackend?.(); runtime.error = health?.ok ? "" : (health?.message || "Backend de reportes bancarios pendiente de actualización."); runtime.onChange?.(); return snapshot();
  }
  async function stop() { if (realtimeTimer) { clearTimeout(realtimeTimer); realtimeTimer = null; } runtime.activeRoute = ""; runtime.onChange = null; if (runtime.subscribed) await repo()?.unsubscribe?.(); runtime.subscribed = false; return snapshot(); }
  async function generate(view, filters = {}, options = {}) {
    const key = String(view || "movements").toLowerCase(); const state = runtime.reports[key];
    if (!state) throw new Error("Vista bancaria no válida.");
    if (!filters.dateFrom || !filters.dateTo || filters.dateFrom > filters.dateTo) throw new Error("Define un rango Desde/Hasta válido.");
    if (state.loading && !options.force) return snapshot();
    const page = Math.max(1, Number(options.page || 1)); const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : state.pageSize;
    state.loading = true; runtime.error = ""; runtime.onChange?.();
    try {
      const result = await repo()?.reportPage?.(key, filters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo generar el reporte bancario.");
      Object.assign(state, { generated: true, stale: false, items: clone(result.items || []), total: Number(result.total || 0), summary: clone(result.summary || {}), page, pageSize, appliedFilters: { ...clone(filters), ...clone(result.filters || {}) } });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; } finally { state.loading = false; runtime.onChange?.(); }
  }
  async function exportAll(view) {
    const key = String(view || "").toLowerCase(); const state = runtime.reports[key];
    if (!state?.generated || !state.appliedFilters) throw new Error("Genera el reporte bancario antes de exportar.");
    const items = []; let offset = 0; let total = 0; let summary = null;
    do { const result = await repo()?.reportPage?.(key, state.appliedFilters, { limit: 50, offset }); if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la exportación bancaria."); total = Number(result.total || 0); summary = summary || clone(result.summary || {}); const page = clone(result.items || []); items.push(...page); offset += page.length; if (!page.length) break; } while (offset < total);
    return { ok: true, view: key, items, total, summary, appliedFilters: clone(state.appliedFilters) };
  }
  async function loadDetail(row) { const result = await BlessERP.treasuryReadV2Repository?.reconciliationDetail?.(row.id); if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el detalle de conciliación."); runtime.detail = { row: clone(row), data: clone(result) }; runtime.onChange?.(); return clone(runtime.detail); }
  function closeDetail() { runtime.detail = null; runtime.onChange?.(); }
  function affectedViews(event = {}) { const table = String(event.table || ""); if (table.includes("reconciliation") || String(event.new?.entity || event.old?.entity || "") === "bank_reconciliations") return ["reconciliations"]; if (table.includes("bank_account")) return ["movements", "balances", "reconciliations"]; if (table.includes("bank_transaction") || String(event.new?.entity || event.old?.entity || "") === "bank_movements") return ["movements", "balances"]; return []; }
  function scheduleRefresh(event = {}) {
    const states = affectedViews(event).map(key => [key, runtime.reports[key]]).filter(([, state]) => state.generated && state.appliedFilters); if (!states.length) return;
    states.forEach(([, state]) => { state.stale = true; }); runtime.onChange?.(); if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => { realtimeTimer = null; if ((BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute) !== "reports-banks") return; for (const [key, state] of states) await generate(key, state.appliedFilters, { page: state.page, pageSize: state.pageSize, force: true }).catch(() => {}); }, 220);
  }
  BlessERP.services = BlessERP.services || {};
  BlessERP.services.accountingBankReportV2 = Object.freeze({ closeDetail, exportAll, generate, loadDetail, setActiveRoute, snapshot, start, stop });
})();
