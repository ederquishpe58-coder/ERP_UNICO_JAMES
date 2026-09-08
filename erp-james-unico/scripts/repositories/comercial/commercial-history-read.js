(function(){
  const B = window.BlessERP = window.BlessERP || {};
  let current;
  const text = value => String(value ?? "").trim();
  const repository = () => B.getCommercialOrderRepository?.();
  function state(appState) {
    const uuid = text(B.authAccess?.activeAccess?.()?.activeCompany?.id || appState?.db?.authAccess?.activeCompanyUuid);
    const key = B.commercialFlowV2.activeCompanyId(appState);
    if (!current || current.uuid !== uuid || current.companyKey !== key) {
      current = { uuid, companyKey: key, generation: 0, referenceVersion: 0, references: null, referencePromise: null, key: "", rows: [], total: 0, totalPages: 1, loading: false, error: "" };
    }
    return current;
  }
  function assertCurrent(appState, captured) {
    if (state(appState) !== captured) throw new Error("La empresa cambió durante la consulta del historial.");
  }
  function remote() { return repository()?.canListPage?.() === true; }
  function assertOrderCompany(order, captured) {
    const ids = [order?.company_id, order?.companyId, order?.sellingCompanyId].map(text).filter(Boolean);
    if (!ids.length || ids.some(id => id !== captured.uuid && id !== captured.companyKey)) throw new Error("Pedido fuera de la empresa actual.");
  }
  // Same canonical entity records as the master-data repositories. This read
  // retains inactive historical references; it never writes/hydrates catalogs.
  async function references(appState) {
    const captured = state(appState);
    if (captured.references) return captured.references;
    if (captured.referencePromise) return captured.referencePromise;
    if (!remote() || !captured.uuid) throw new Error("No se pudo consultar el catálogo canónico de la empresa.");
    const version = captured.referenceVersion;
    const task = (async () => {
      const result = { customers: new Map(), brands: new Map() };
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await B.getSupabaseClient().from("erp_entity_records")
          .select("company_id,entity,record_id,payload,deleted_at")
          .eq("company_id", captured.uuid).in("entity", ["commercial_customers", "commercial_brands"])
          .is("deleted_at", null).order("record_id", { ascending: true }).range(offset, offset + 499);
        assertCurrent(appState, captured);
        if (version !== captured.referenceVersion) throw new Error("El catálogo cambió; vuelva a consultar el historial.");
        if (error) throw new Error(error.message || "No se pudieron consultar las referencias del pedido.");
        if (!Array.isArray(data)) throw new Error("El servidor no confirmó las referencias del pedido.");
        for (const row of data) {
          if (row.company_id !== captured.uuid || row.deleted_at) throw new Error("Referencia comercial fuera de la empresa actual.");
          const target = row.entity === "commercial_customers" ? result.customers : row.entity === "commercial_brands" ? result.brands : null;
          if (!target || !row.record_id || !row.payload) throw new Error("Referencia comercial incompleta.");
          target.set(text(row.record_id), { ...row.payload, id: text(row.record_id) });
        }
        if (data.length < 500) break;
      }
      captured.references = result;
      return result;
    })();
    captured.referencePromise = task;
    try { return await task; } finally { if (captured.referencePromise === task) captured.referencePromise = null; }
  }
  function reference(appState, kind, id) {
    return state(appState).references?.[kind]?.get(text(id)) || null;
  }
  function name(appState, kind, id) {
    const row = reference(appState, kind, id);
    return kind === "brands" ? row?.finalClientName || row?.name || "-" : row?.legalName || row?.commercialName || "Sin cliente";
  }
  function filterKey(filters) {
    return JSON.stringify([filters.date || "", filters.search || "", filters.market || "TODOS", filters.page || 1, filters.pageSize || 20]);
  }
  function view(appState, filters) {
    const captured = state(appState);
    return captured.key === filterKey(filters) ? captured : { rows: [], total: 0, totalPages: 1, loading: true, error: "" };
  }
  async function load(appState, filters) {
    const captured = state(appState), key = filterKey(filters);
    if (captured.key === key) return captured.promise;
    const input = { ...filters }, generation = ++captured.generation;
    Object.assign(captured, { key, rows: [], total: 0, totalPages: 1, loading: true, error: "" });
    const valid = () => state(appState) === captured && generation === captured.generation;
    captured.promise = (async () => {
      try {
        const refs = await references(appState);
        if (!valid()) return;
        const search = text(input.search).toUpperCase();
        const matches = (rows, names) => [...rows.values()].filter(row => names.some(field => text(row[field]).toUpperCase().includes(search))).map(row => row.id);
        const options = { pageSize: input.pageSize, filters: { search: input.search, dateFrom: input.date || null, dateTo: input.date || null,
          customerMatches: search ? matches(refs.customers, ["legalName", "commercialName"]) : [],
          brandMatches: search ? matches(refs.brands, ["finalClientName", "name"]) : [] } };
        // Existing RPC has no market argument. Only that filter scans its
        // canonical pages before applying the existing LOCAL/EXPORT predicate.
        const market = input.market && input.market !== "TODOS";
        let page = market ? 1 : input.page, result, rows = [];
        do {
          result = await repository().listPage({ ...options, pageSize: market ? 100 : input.pageSize }, page);
          if (!valid()) return;
          if (!result?.ok || result.companyId !== captured.uuid || !Array.isArray(result.items)) throw new Error(result?.message || "No se pudo consultar el historial canónico.");
          result.items.forEach(order => assertOrderCompany(order, captured));
          rows.push(...result.items);
        } while (market && page++ < result.totalPages);
        if (market) rows = rows.filter(order => {
          const declared = text(order.saleType || order.sale_type || order.commercialType).toUpperCase();
          const local = ["LOCAL", "VENTA_LOCAL", "VENTA LOCAL"].includes(declared)
            || (!declared && text(refs.customers.get(text(order.customerId))?.category).toUpperCase() === "LOCAL");
          return (local ? "LOCAL" : "EXPORTACION") === input.market;
        });
        captured.total = market ? rows.length : result.total;
        captured.totalPages = market ? Math.max(1, Math.ceil(rows.length / input.pageSize)) : result.totalPages;
        captured.rows = market ? rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize) : rows;
      } catch (error) {
        if (valid()) captured.error = error.message || "No se pudo consultar el historial.";
      } finally { if (valid()) captured.loading = false; }
    })();
    return captured.promise;
  }
  function invalidate() {
    if (!current) return;
    current.generation += 1;
    current.referenceVersion += 1;
    current.key = "";
    current.references = null;
    current.referencePromise = null;
  }
  async function fullOrder(appState, id) {
    const captured = state(appState);
    const result = await repository().getFullOrder(id);
    assertCurrent(appState, captured);
    if (!result?.ok || text(result.order?.id) !== text(id) || !Array.isArray(result.order?.lines)) throw new Error(result?.message || "No se pudo cargar el pedido completo.");
    assertOrderCompany(result.order, captured);
    const rows = appState.db.commercial.orders;
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) rows.push(result.order); else rows[index] = result.order;
    // In-memory canonical read only: no saveDb, queue or business mutation.
    return result.order;
  }
  B.commercialHistoryRead = { remote, state, references, reference, name, view, load, invalidate, fullOrder };
})();
