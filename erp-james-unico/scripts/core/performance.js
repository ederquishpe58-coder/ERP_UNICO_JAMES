(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const measures = [];
  const pageState = new Map();
  const cache = new Map();
  const routeTransitions = new Map();
  let renderCycle = 0;

  function now() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function record(name, startedAt, detail = {}) {
    const duration = Math.max(0, now() - Number(startedAt || 0));
    const item = {
      name: String(name || "medicion"),
      duration: Number(duration.toFixed(2)),
      at: new Date().toISOString(),
      ...detail
    };
    measures.push(item);
    if (measures.length > 250) measures.splice(0, measures.length - 250);
    if (window.__JAEDER_PERFORMANCE_DEBUG__ === true || item.duration >= 120) {
      console.info(`[JAEDER PERF] ${item.name}: ${item.duration.toFixed(2)} ms`, detail);
    }
    return item;
  }

  function measureSync(name, callback, detail = {}) {
    const startedAt = now();
    try {
      return callback();
    } finally {
      record(name, startedAt, detail);
    }
  }

  async function measureAsync(name, callback, detail = {}) {
    const startedAt = now();
    try {
      return await callback();
    } finally {
      record(name, startedAt, detail);
    }
  }

  function debounce(callback, wait = 150) {
    let timer = 0;
    const debounced = function(...args) {
      const context = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback.apply(context, args), wait);
    };
    debounced.cancel = () => {
      window.clearTimeout(timer);
      timer = 0;
    };
    return debounced;
  }

  function beginRenderCycle() {
    renderCycle += 1;
    return renderCycle;
  }

  function beginRouteTransition(routeId) {
    const id = String(routeId || "").trim();
    if (!id) return;
    routeTransitions.set(id, now());
  }

  function finishRouteTransition(routeId, detail = {}) {
    const id = String(routeId || "").trim();
    const startedAt = routeTransitions.get(id);
    if (!id || startedAt === undefined) return null;
    routeTransitions.delete(id);
    return record(`ruta:${id}:respuesta`, startedAt, { routeId: id, ...detail });
  }

  function isRouteTransitionPending(routeId) {
    return routeTransitions.has(String(routeId || "").trim());
  }

  function currentRenderCycle() {
    return renderCycle;
  }

  function paginate(rows, key, options = {}) {
    const source = Array.isArray(rows) ? rows : [];
    const pageSize = Math.max(10, Number(options.pageSize || 50));
    const totalPages = Math.max(1, Math.ceil(source.length / pageSize));
    const requested = Math.max(1, Number(pageState.get(key) || 1));
    const page = Math.min(requested, totalPages);
    pageState.set(key, page);
    const start = (page - 1) * pageSize;
    return {
      key,
      items: source.slice(start, start + pageSize),
      page,
      pageSize,
      total: source.length,
      totalPages,
      start: source.length ? start + 1 : 0,
      end: Math.min(source.length, start + pageSize)
    };
  }

  function setPage(key, page) {
    pageState.set(String(key || ""), Math.max(1, Number(page || 1)));
  }

  function getPage(key) {
    return Math.max(1, Number(pageState.get(String(key || "")) || 1));
  }

  function resetPage(key) {
    pageState.delete(String(key || ""));
  }

  function renderPager(result) {
    if (!result || result.total <= result.pageSize) return "";
    const esc = BlessERP.utils?.esc || (value => String(value ?? ""));
    return `
      <nav class="jaeder-table-pager" aria-label="Paginacion de tabla">
        <span>Mostrando ${result.start}-${result.end} de ${result.total}</span>
        <div>
          <button type="button" class="secondary-button" data-jaeder-page-key="${esc(result.key)}" data-jaeder-page="${result.page - 1}" ${result.page <= 1 ? "disabled" : ""}>Anterior</button>
          <strong>Pagina ${result.page} de ${result.totalPages}</strong>
          <button type="button" class="secondary-button" data-jaeder-page-key="${esc(result.key)}" data-jaeder-page="${result.page + 1}" ${result.page >= result.totalPages ? "disabled" : ""}>Siguiente</button>
        </div>
      </nav>
    `;
  }

  function getCached(key, ttlMs, loader) {
    const normalizedKey = String(key || "");
    const existing = cache.get(normalizedKey);
    const timestamp = Date.now();
    if (existing && timestamp - existing.createdAt < Number(ttlMs || 0)) return existing.value;
    const value = loader();
    cache.set(normalizedKey, { createdAt: timestamp, value });
    return value;
  }

  function invalidateCache(prefix = "") {
    const normalized = String(prefix || "");
    [...cache.keys()].forEach(key => {
      if (!normalized || key.startsWith(normalized)) cache.delete(key);
    });
  }

  function summary(limit = 250) {
    const sample = measures.slice(-Math.max(1, Number(limit || 250)));
    const groups = new Map();
    sample.forEach(item => {
      const current = groups.get(item.name) || { name: item.name, count: 0, total: 0, max: 0 };
      current.count += 1;
      current.total += item.duration;
      current.max = Math.max(current.max, item.duration);
      groups.set(item.name, current);
    });
    return [...groups.values()]
      .map(item => ({
        name: item.name,
        count: item.count,
        average: Number((item.total / item.count).toFixed(2)),
        max: Number(item.max.toFixed(2))
      }))
      .sort((left, right) => right.max - left.max);
  }

  BlessERP.performance = {
    beginRouteTransition,
    beginRenderCycle,
    currentRenderCycle,
    debounce,
    getCached,
    invalidateCache,
    isRouteTransitionPending,
    latest: (limit = 50) => measures.slice(-Math.max(1, Number(limit || 50))),
    measureAsync,
    measureSync,
    finishRouteTransition,
    getPage,
    now,
    paginate,
    record,
    renderPager,
    resetPage,
    setPage,
    summary
  };
})();
