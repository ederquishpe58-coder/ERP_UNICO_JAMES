(function(){
  const ERP = window.BlessERP = window.BlessERP || {};
  const OWNER = "cf331b82-7ac3-4065-9e38-d0bbcde96cd5";
  const CONSUMER = "ab60abdc-fe53-4289-9ae2-8f749ee21cff";
  const TTL = 60000;
  let cache = null;

  function context(appState) {
    const access = ERP.authAccess?.activeAccess?.();
    return {
      company: String(access?.activeCompany?.id || appState?.db?.authAccess?.activeCompanyUuid || ""),
      actor: String(access?.session?.user?.id || "")
    };
  }
  function isConsumer(appState) {
    const company = context(appState).company;
    return company === CONSUMER || (!company && appState?.db?.activeCompanyId === "COMP-IMPERIO-FLOWERS");
  }
  function state(appState) {
    const current = context(appState), key = current.company + ":" + current.actor;
    if (!cache || cache.key !== key) cache = { key, ...current, loaded: false, loading: false,
      error: "", loadedAt: 0, varieties: [], lengths: [], promise: null };
    return cache;
  }
  function ready(appState) {
    const current = state(appState);
    return current.loaded && !current.error && Date.now() - current.loadedAt < TTL;
  }
  function selection(appState) {
    if (!isConsumer(appState)) return null;
    const current = state(appState);
    return current.loaded && !current.error
      ? { varieties: current.varieties, lengths: current.lengths }
      : { varieties: [], lengths: [] };
  }
  function projection(result, catalog) {
    if (!result || result.company_id !== CONSUMER || result.owner_company_id !== OWNER
        || result.catalog !== catalog || result.read_only !== true || result.source !== "erp_entity_records"
        || result.include_inactive !== false || !Array.isArray(result.records)) throw Error("SHARED_CATALOG_INVALID_RESPONSE");
    const ids = new Set();
    return Object.freeze(result.records.map(row => {
      if (!row || row.owner_company_id !== OWNER || row.active !== true || row.deleted_at
          || typeof row.id !== "string" || !row.id || ids.has(row.id)
          || typeof row.name !== "string" || !row.name.trim()) throw Error("SHARED_CATALOG_INVALID_RECORD");
      ids.add(row.id);
      return Object.freeze({ id: row.id, name: row.name, code: row.code, active: true });
    }));
  }
  async function load(appState, options = {}) {
    if (!isConsumer(appState)) return { ok: true, shared: false };
    const current = state(appState);
    if (current.loading) return current.promise;
    if (!options.force && current.error) throw Error(current.error);
    if (!options.force && ready(appState)) return { ok: true, shared: true };
    current.loading = true; current.error = "";
    current.promise = (async () => {
      if (current.company !== CONSUMER || !current.actor || !ERP.getSupabaseClient?.()?.rpc) throw Error("SHARED_CATALOG_SESSION_REQUIRED");
      const values = await Promise.all(["varieties", "lengths"].map(async catalog => {
        const { data, error } = await ERP.getSupabaseClient().rpc("erp_commercial_shared_postharvest_catalog", {
          p_company_id: CONSUMER, p_catalog: catalog, p_include_inactive: false
        });
        if (error) throw Error(error.message || "No se pudo cargar el catálogo compartido.");
        return projection(data, catalog);
      }));
      if (state(appState) !== current) throw Error("SHARED_CATALOG_CONTEXT_CHANGED");
      [current.varieties, current.lengths] = values;
      current.loaded = true; current.loadedAt = Date.now();
      return { ok: true, shared: true };
    })().catch(error => {
      current.loaded = false; current.varieties = []; current.lengths = [];
      current.error = String(error.message || error); throw error;
    }).finally(() => { current.loading = false; current.promise = null; });
    return current.promise;
  }
  ERP.sharedPostharvestCatalog = Object.freeze({ isConsumer, state, ready, selection, load });
})();
