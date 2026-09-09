(function () {
  const ERP = window.BlessERP = window.BlessERP || {};
  let cache;
  const bindings = new WeakMap();
  const text = value => String(value ?? "").trim();
  const fold = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const esc = value => text(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function state(appState) {
    const access = ERP.authAccess?.activeAccess?.();
    const company = text(access?.activeCompany?.id || appState?.db?.authAccess?.activeCompanyUuid);
    const actor = text(access?.session?.user?.id);
    const key = company + ":" + actor;
    if (!cache || cache.key !== key) cache = {key, company, actor, rows: [], loaded: false, loading: false, error: "", loadedAt: 0};
    return cache;
  }
  function rows(appState) {
    const current = state(appState);
    return current.loaded && !current.error ? current.rows.filter(row => row.active) : [];
  }
  function find(appState, id) { return rows(appState).find(row => row.id === text(id)) || null; }
  async function load(appState, {force = false} = {}) {
    const current = state(appState);
    if (current.loading) return current.promise;
    if (!force && current.error) throw Error(current.error);
    if (!force && current.loaded && Date.now() - current.loadedAt < 60000) return current.rows;
    current.loading = true;
    current.error = "";
    current.promise = (async () => {
      if (!current.company || !current.actor || !ERP.getSupabaseClient?.()?.rpc) throw Error("La sesión no permite consultar países.");
      const {data, error} = await ERP.getSupabaseClient().rpc("erp_commercial_order_countries", {p_company_id: current.company});
      if (error) throw Error(error.message || "Error de lectura del catálogo.");
      if (!data || data.company_id !== current.company || data.source !== "commercial_countries" || data.read_only !== true || !Array.isArray(data.records)) throw Error("Respuesta del catálogo no válida.");
      const ids = new Set();
      const result = data.records.map(row => {
        if (!row || !text(row.id) || !text(row.name) || ids.has(row.id) || typeof row.active !== "boolean") throw Error("Referencia de país no válida.");
        ids.add(row.id);
        return Object.freeze({id: row.id, name: row.name, code: text(row.code), iso2: text(row.iso2), iso3: text(row.iso3), legacyName: text(row.legacy_name), active: row.active});
      });
      if (state(appState) !== current) throw Error("La empresa o sesión cambió durante la consulta.");
      current.rows = Object.freeze(result); current.loaded = true; current.loadedAt = Date.now();
      return current.rows;
    })().catch(error => {
      current.rows = []; current.loaded = false; current.error = text(error.message || error); throw error;
    }).finally(() => { current.loading = false; current.promise = null; });
    return current.promise;
  }
  function search(appState, query) {
    const expected = fold(query);
    return rows(appState).filter(row => fold([row.name, row.legacyName, row.code, row.iso2, row.iso3].join(" ")).includes(expected));
  }
  function options(appState, order, query = "") {
    const selected = text(order.destinationId || order.destination_id);
    const matches = search(appState, query);
    const current = state(appState).rows.find(row => row.id === selected);
    const historical = current || (selected && order.unsavedDraft !== true ? {id: selected, name: order.destinationCountry || order.destination, active: false} : null);
    const extra = historical && !matches.some(row => row.id === selected) ? [historical] : [];
    return `<option value="">${matches.length ? "Seleccione un país" : "Sin resultados"}</option>` + [...extra, ...matches].map(row => `<option value="${esc(row.id)}" ${row.id === selected ? "selected" : ""} ${!row.active ? "disabled" : ""}>${esc(row.name)}${row.iso2 ? " · " + esc(row.iso2) : ""}${!row.active ? " · histórico" : ""}</option>`).join("");
  }
  function contents(appState, order) {
    const current = state(appState);
    const unavailable = current.loading || !current.loaded || !!current.error;
    return `<span class="commercial-v2-field-label">Destino / País canónico *</span>
      <input type="search" data-country-search aria-label="Buscar país por nombre o código ISO" placeholder="Buscar país..." autocomplete="off" ${unavailable ? "disabled" : ""}>
      <select data-order-field="destinationId" aria-label="Destino / País canónico" ${unavailable ? "disabled" : ""}>${options(appState, order)}</select>
      <small role="status" class="commercial-v2-field-help">${current.error ? "No se pudo cargar catálogo de países. " + esc(current.error) : unavailable ? "Cargando países..." : "Seleccione manualmente el país de este pedido."}</small>
      ${current.error ? '<button type="button" data-country-retry>Volver a consultar países</button>' : ""}
      ${!order.destinationId && order.destinationCountry ? `<small>Destino conservado: ${esc(order.destinationCountry)}</small>` : ""}`;
  }
  function render(appState, order) { return `<label data-order-country>${contents(appState, order)}</label>`; }
  function mount(container, appState) {
    const host = container.querySelector("[data-order-country]");
    if (!host) return;
    bindings.get(host)?.abort();
    const controller = new AbortController(); bindings.set(host, controller);
    const captured = state(appState);
    const refresh = () => {
      if (host.isConnected && state(appState) === captured) host.innerHTML = contents(appState, ERP.commercialFlowV2.getDraft(appState));
    };
    const request = force => {
      const promise = load(appState, {force}); refresh(); promise.then(refresh, refresh);
    };
    host.addEventListener("input", event => {
      if (!event.target.matches("[data-country-search]")) return;
      host.querySelector("select").innerHTML = options(appState, ERP.commercialFlowV2.getDraft(appState), event.target.value);
    }, {signal: controller.signal});
    host.addEventListener("click", event => { if (event.target.closest("[data-country-retry]")) request(true); }, {signal: controller.signal});
    request(false);
  }
  ERP.orderCountryCatalog = Object.freeze({state, rows, find, load, search, render, mount});
})();
