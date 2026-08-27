(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.accountingPortfolioReportV2Repository;
  let realtimeTimer = null;
  function bucket() { return { loading: false, generated: false, stale: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null }; }
  const runtime = {
    started: false, subscribed: false, activeRoute: "", error: "", onChange: null, detail: null,
    reports: { payables: bucket(), receivables: bucket(), payments: bucket(), collections: bucket() }
  };
  function snapshot() { return clone(runtime); }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend de reportes de cartera pendiente de actualización.");
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
  async function generate(view, filters = {}, options = {}) {
    const key = String(view || "payables").toLowerCase();
    const state = runtime.reports[key];
    if (!state) throw new Error("Vista de cartera no válida.");
    if (!filters.dateFrom || !filters.dateTo || filters.dateFrom > filters.dateTo) throw new Error("Define un rango Desde/Hasta válido.");
    if (state.loading && !options.force) return snapshot();
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : state.pageSize;
    state.loading = true; runtime.error = ""; runtime.onChange?.();
    try {
      const result = await repo()?.reportPage?.(key, filters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo generar el reporte de cartera.");
      Object.assign(state, {
        generated: true, stale: false, items: clone(result.items || []), total: Number(result.total || 0),
        summary: clone(result.summary || {}), page, pageSize,
        appliedFilters: { ...clone(filters), ...clone(result.filters || {}) }
      });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; }
    finally { state.loading = false; runtime.onChange?.(); }
  }
  async function exportAll(view) {
    const key = String(view || "").toLowerCase();
    const state = runtime.reports[key];
    if (!state?.generated || !state.appliedFilters) throw new Error("Genera el reporte antes de exportar.");
    const items = [];
    let offset = 0;
    let total = 0;
    let summary = null;
    do {
      const result = await repo()?.reportPage?.(key, state.appliedFilters, { limit: 50, offset });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la exportación de cartera.");
      total = Number(result.total || 0);
      summary = summary || clone(result.summary || {});
      const pageItems = clone(result.items || []);
      items.push(...pageItems); offset += pageItems.length;
      if (!pageItems.length) break;
    } while (offset < total);
    return { ok: true, items, total, summary, appliedFilters: clone(state.appliedFilters), view: key };
  }
  async function loadDetail(view, row) {
    const key = String(view || "").toLowerCase();
    let result;
    if (key === "payables") result = await BlessERP.services?.portfolioReadV2?.detail?.("ap", row.id, row.source);
    else if (key === "receivables") result = await BlessERP.services?.portfolioReadV2?.detail?.("ar", row.id, row.source);
    else if (key === "payments") result = await BlessERP.services?.paymentCollectionReadV2?.detail?.("payment", row.operationId, row.source);
    else result = await BlessERP.services?.paymentCollectionReadV2?.detail?.("collection", row.operationId, row.source);
    runtime.detail = { view: key, row: clone(row), data: clone(result || {}) };
    runtime.onChange?.();
    return clone(runtime.detail);
  }
  function closeDetail() { runtime.detail = null; runtime.onChange?.(); }
  function eventView(event = {}) {
    const table = String(event.table || "");
    const entity = String(event.new?.entity || event.old?.entity || "");
    if (table.startsWith("erp_supplier_")) return table.includes("payment") ? "payments" : "payables";
    if (table.startsWith("erp_financial_")) return table.includes("collection") ? "collections" : "receivables";
    if (["payments", "payment_batches"].includes(entity)) return "payments";
    if (["collections", "collection_batches"].includes(entity)) return "collections";
    if (entity === "purchase_payables") return "payables";
    if (entity === "customer_receivables") return "receivables";
    return "";
  }
  function scheduleRefresh(event = {}) {
    const affected = eventView(event);
    if (!affected) return;
    const state = runtime.reports[affected];
    if (!state?.generated || !state.appliedFilters) return;
    state.stale = true; runtime.onChange?.();
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      if (route !== "reports-portfolio" || !state.generated) return;
      await generate(affected, state.appliedFilters, { page: state.page, pageSize: state.pageSize, force: true }).catch(() => {});
    }, 220);
  }
  BlessERP.services = BlessERP.services || {};
  BlessERP.services.accountingPortfolioReportV2 = Object.freeze({ closeDetail, exportAll, generate, loadDetail, setActiveRoute, snapshot, start, stop });
})();
