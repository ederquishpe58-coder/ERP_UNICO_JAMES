(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const counters = {
    bootstrapPulls: 0,
    bootstrapEntitiesRequested: 0,
    bootstrapRowsReceived: 0,
    domainPulls: 0,
    domainRowsReceived: 0,
    duplicateDomainLoads: 0,
    indexedDbWrites: 0,
    indexedDbDeletes: 0
  };
  const domainLoads = new Map();
  const routeRealtimeSubscriptions = new Set();

  function recordPull(kind, detail = {}) {
    const rows = Number(detail.fetchedRows || 0);
    const entities = Number(detail.entitiesRequested || 0);
    if (kind === "bootstrap") {
      counters.bootstrapPulls += 1;
      counters.bootstrapEntitiesRequested += entities;
      counters.bootstrapRowsReceived += rows;
      return;
    }
    counters.domainPulls += 1;
    counters.domainRowsReceived += rows;
    const domain = String(detail.domain || "unknown");
    const current = domainLoads.get(domain) || { loads: 0, rows: 0, entities: 0, lastMode: "" };
    current.loads += 1;
    current.rows += rows;
    current.entities = entities;
    current.lastMode = String(detail.mode || detail.scope || "");
    domainLoads.set(domain, current);
  }

  BlessERP.syncInstrumentation = {
    recordPull,
    recordDuplicateDomainLoad() { counters.duplicateDomainLoads += 1; },
    recordIndexedDbWrite(kind = "put") {
      if (kind === "delete") counters.indexedDbDeletes += 1;
      else counters.indexedDbWrites += 1;
    },
    setRealtimeSubscription(key, active) {
      const id = String(key || "").trim();
      if (!id) return;
      if (active) routeRealtimeSubscriptions.add(id);
      else routeRealtimeSubscriptions.delete(id);
    },
    reset() {
      Object.keys(counters).forEach(key => { counters[key] = 0; });
      domainLoads.clear();
      routeRealtimeSubscriptions.clear();
    },
    snapshot() {
      return {
        ...counters,
        activeRealtimeSubscriptions: Number(BlessERP.realtimeSync?.status?.().activeSubscriptions || 0) + routeRealtimeSubscriptions.size,
        routeRealtimeSubscriptions: [...routeRealtimeSubscriptions].sort(),
        domainLoads: Object.fromEntries([...domainLoads.entries()].map(([key, value]) => [key, { ...value }]))
      };
    }
  };
})();
