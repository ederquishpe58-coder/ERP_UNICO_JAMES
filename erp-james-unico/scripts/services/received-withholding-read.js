(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repository = () => BlessERP.receivedWithholdingReadRepository;
  let realtimeTimer = null;

  const runtime = {
    started: false, subscribed: false, activeRoute: "", error: "", onChange: null,
    list: { loading: false, loaded: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null },
    detail: { loading: false, receivedId: "", item: null, journal: null },
    lookup: { loading: false, receivedId: "", customerId: "", search: "", items: [] }
  };

  function snapshot() { return clone(runtime); }

  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) {
      repository()?.subscribe?.(scheduleRealtimeRefresh);
      runtime.subscribed = true;
    }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repository()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend search-first de retenciones recibidas no disponible.");
    runtime.onChange?.();
    return snapshot();
  }

  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }

  async function query(filters, options = {}) {
    if (runtime.list.loading && !options.force) return snapshot();
    const appliedFilters = clone(filters || runtime.list.appliedFilters || {});
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : runtime.list.pageSize;
    runtime.list.loading = true;
    runtime.error = "";
    try {
      const result = await repository()?.page?.(appliedFilters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudieron consultar las retenciones recibidas.");
      Object.assign(runtime.list, { loaded: true, items: clone(result.items || []), total: Number(result.total || 0), summary: clone(result.summary || {}), page, pageSize, appliedFilters });
      return snapshot();
    } catch (error) {
      runtime.error = error.message;
      throw error;
    } finally {
      runtime.list.loading = false;
    }
  }

  async function loadDetail(receivedId) {
    runtime.detail = { loading: true, receivedId: String(receivedId || ""), item: null, journal: null };
    runtime.error = "";
    try {
      const result = await repository()?.detail?.(receivedId);
      if (!result?.ok) throw new Error(result?.message || "No se pudo cargar la retención.");
      runtime.detail = { loading: false, receivedId: String(receivedId || ""), item: clone(result.item || null), journal: clone(result.journal || null) };
      return snapshot();
    } finally {
      runtime.detail.loading = false;
    }
  }

  function closeDetail() { runtime.detail = { loading: false, receivedId: "", item: null, journal: null }; }

  function openLookup(receivedId, customerId) {
    runtime.lookup = { loading: false, receivedId: String(receivedId || ""), customerId: String(customerId || ""), search: "", items: [] };
    return snapshot();
  }

  async function lookupReceivables(receivedId, customerId, search = "") {
    runtime.lookup = { loading: true, receivedId: String(receivedId || ""), customerId: String(customerId || ""), search: String(search || ""), items: [] };
    runtime.error = "";
    try {
      const result = await repository()?.receivableLookup?.(customerId, search, { limit: 25 });
      if (!result?.ok) throw new Error(result?.message || "No se pudieron buscar documentos de CxC.");
      runtime.lookup.items = clone(result.items || []);
      return snapshot();
    } finally {
      runtime.lookup.loading = false;
    }
  }

  function closeLookup() { runtime.lookup = { loading: false, receivedId: "", customerId: "", search: "", items: [] }; }

  function patchVisible(record = {}) {
    const index = runtime.list.items.findIndex(item => String(item.id) === String(record.id));
    if (index >= 0) runtime.list.items[index] = { ...runtime.list.items[index], ...clone(record) };
    return snapshot();
  }

  async function refreshCurrent() {
    if (runtime.activeRoute !== "tax-withholdings-received" || !runtime.list.loaded || !runtime.list.appliedFilters) return snapshot();
    return query(runtime.list.appliedFilters, { force: true, page: runtime.list.page, pageSize: runtime.list.pageSize });
  }

  function scheduleRealtimeRefresh(event = {}) {
    if (runtime.activeRoute !== "tax-withholdings-received") return;
    const recordId = String(event?.new?.record_id || event?.old?.record_id || "");
    const shouldRefreshDetail = runtime.detail.receivedId && recordId === runtime.detail.receivedId;
    if (!runtime.list.loaded && !shouldRefreshDetail) return;
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      try {
        if (runtime.list.loaded) await refreshCurrent();
        if (shouldRefreshDetail) await loadDetail(runtime.detail.receivedId);
      } catch (_) { /* visible through runtime */ }
      runtime.onChange?.();
    }, 180);
  }

  async function stop() {
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = null;
    runtime.activeRoute = "";
    runtime.onChange = null;
    if (runtime.subscribed) await repository()?.unsubscribe?.();
    runtime.subscribed = false;
    return snapshot();
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.receivedWithholdingRead = Object.freeze({
    closeDetail, closeLookup, loadDetail, lookupReceivables, openLookup, patchVisible, query, refreshCurrent,
    setActiveRoute, snapshot, start, stop
  });
})();
