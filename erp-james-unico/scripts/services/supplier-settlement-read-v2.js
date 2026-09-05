(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.supplierSettlementReadV2Repository;
  let realtimeTimer = null;
  const bucket = () => ({ loading: false, loaded: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null });
  const runtime = { started: false, subscribed: false, activeRoute: "", error: "", onChange: null, candidates: bucket(), history: bucket(), detail: null };

  function snapshot() { return clone(runtime); }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend de liquidaciones pendiente de actualización.");
    runtime.onChange?.();
    return snapshot();
  }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  async function queryCandidates(filters = {}, options = {}) {
    const state = runtime.candidates;
    if (state.loading && !options.force) return snapshot();
    state.loading = true; runtime.error = "";
    try {
      const result = await repo()?.candidates?.(filters);
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la flor por liquidar.");
      Object.assign(state, { items: clone(result.items || []), total: Number(result.total || 0), summary: clone(result.summary || {}),
        loaded: true, appliedFilters: clone(filters) });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; }
    finally { state.loading = false; }
  }
  async function queryHistory(filters = {}, options = {}) {
    const state = runtime.history;
    if (state.loading && !options.force) return snapshot();
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : state.pageSize;
    state.loading = true; runtime.error = "";
    try {
      const result = await repo()?.historyPage?.(filters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar el historial de liquidaciones.");
      Object.assign(state, { items: clone(result.items || []), total: Number(result.total || 0), summary: clone(result.summary || {}),
        loaded: true, page, pageSize, appliedFilters: clone(filters) });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; }
    finally { state.loading = false; }
  }
  async function loadDetail(id) {
    const result = await repo()?.detail?.(id);
    if (!result?.ok) throw new Error(result?.message || "No se pudo cargar la liquidación.");
    runtime.detail = clone(result); runtime.onChange?.(); return clone(result);
  }
  function clearCandidates() { runtime.candidates = bucket(); runtime.onChange?.(); }
  function closeDetail() { runtime.detail = null; runtime.onChange?.(); }
  async function refreshCandidates() {
    if (!runtime.candidates.loaded || !runtime.candidates.appliedFilters) return snapshot();
    return queryCandidates(runtime.candidates.appliedFilters, { force: true });
  }
  async function refreshHistory() {
    if (!runtime.history.loaded || !runtime.history.appliedFilters) return snapshot();
    return queryHistory(runtime.history.appliedFilters, { force: true, page: runtime.history.page, pageSize: runtime.history.pageSize });
  }
  async function exportAll(filters) {
    const items = []; let offset = 0; let total = 0;
    do {
      const result = await repo()?.historyPage?.(filters, { limit: 50, offset });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la exportación de liquidaciones.");
      const page = result.items || []; total = Number(result.total || 0); items.push(...clone(page)); offset += page.length;
      if (!page.length) break;
    } while (offset < total);
    return { items, total };
  }
  function scheduleRefresh(event = {}) {
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      if (route !== "purchases-supplier-settlements") return;
      const table = String(event.table || "");
      if (runtime.candidates.loaded && ["erp_entity_records", "erp_supplier_reception_cost_allocations", "erp_supplier_settlements"].includes(table)) await refreshCandidates().catch(() => {});
      if (runtime.history.loaded && table !== "erp_entity_records") await refreshHistory().catch(() => {});
      const selected = runtime.detail?.settlement;
      const record = event.new || event.old || {};
      if (selected && (String(record.settlement_id || "") === String(selected.settlement_id || selected.id || "")
        || String(record.payable_id || "") === String(selected.payable_id || ""))) {
        const result = await repo()?.detail?.(selected.settlement_id || selected.id);
        if (result?.ok) runtime.detail = clone(result);
      }
      runtime.onChange?.();
    }, 180);
  }

  async function stop() {
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = null;
    runtime.activeRoute = "";
    runtime.onChange = null;
    if (runtime.subscribed) await repo()?.unsubscribe?.();
    runtime.subscribed = false;
    return snapshot();
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.supplierSettlementReadV2 = Object.freeze({
    clearCandidates, closeDetail, exportAll, loadDetail, queryCandidates, queryHistory, refreshCandidates, refreshHistory, setActiveRoute, snapshot, start, stop
  });
})();
