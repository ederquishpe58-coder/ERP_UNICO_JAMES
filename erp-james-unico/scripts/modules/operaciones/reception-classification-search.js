(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.operacionesUtils;
  const views = {
    receptionHistory: createState(false),
    classificationReceipts: createState(true),
    classificationDeliveries: createState(false)
  };
  let refreshTimer = 0;

  function todayEcuador() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }

  function createState(onlyPending) {
    const today = todayEcuador();
    return {
      open: false, queried: false, loading: false, error: "", items: [], total: 0,
      page: 1, pageSize: 25, totalPages: 1, elapsedMs: 0, payloadBytes: 0,
      filters: { dateFrom: today, dateTo: today, supplier: "", block: "", variety: "", classifier: "", status: "", search: "", onlyPending }
    };
  }

  function state(name) { return views[name]; }
  function activeName() { return Object.keys(views).find(name => views[name].open) || ""; }
  function closeAll() { Object.values(views).forEach(item => { item.open = false; }); }
  function open(name) {
    closeAll();
    const current = state(name);
    if (!current) return;
    current.open = true;
    current.queried = false;
    current.items = [];
    current.total = 0;
    current.error = "";
  }
  function close(name) { if (state(name)) state(name).open = false; }
  function setFilter(name, field, value) {
    const current = state(name);
    if (!current) return;
    if (field === "pageSize") current.pageSize = [25, 50].includes(Number(value)) ? Number(value) : 25;
    else if (field === "onlyPending") current.filters.onlyPending = value === true || value === "true" || value === "1";
    else current.filters[field] = value;
  }

  async function query(name, page = 1) {
    const current = state(name);
    if (!current || current.loading) return;
    if (!current.filters.dateFrom || !current.filters.dateTo) {
      current.error = "Desde y Hasta son obligatorios.";
      return;
    }
    if (current.filters.dateFrom > current.filters.dateTo) {
      current.error = "El rango de fechas no es válido.";
      return;
    }
    current.loading = true;
    current.error = "";
    try {
      const repository = BlessERP.getReceptionClassificationQueryRepository?.();
      const result = name === "classificationDeliveries"
        ? await repository.listDeliveries({ ...current.filters, page, pageSize: current.pageSize })
        : await repository.listReceptionLines({ ...current.filters, page, pageSize: current.pageSize });
      current.items = result.items;
      current.total = Number(result.total || 0);
      current.page = Number(result.page || page);
      current.pageSize = Number(result.pageSize || current.pageSize);
      current.totalPages = Number(result.totalPages || 1);
      current.elapsedMs = Number(result.elapsedMs || 0);
      current.payloadBytes = Number(result.payloadBytes || 0);
      current.queried = true;
    } catch (error) {
      current.error = error?.message || "No se pudo consultar el historial canónico.";
      current.items = [];
      current.total = 0;
      current.queried = true;
    } finally {
      current.loading = false;
    }
  }

  function input(view, field, label, type = "text") {
    const current = state(view);
    return `<label class="compact-inline-field"><span>${utils.esc(label)}</span><input type="${type}" value="${utils.esc(current.filters[field] || "")}" data-ops-search-view="${view}" data-ops-search-field="${field}"></label>`;
  }

  function filters(view, options = {}) {
    const current = state(view);
    return `<div class="ops-form-grid ops-filter-grid ops-search-first-filters">
      ${input(view, "dateFrom", "Desde", "date")}${input(view, "dateTo", "Hasta", "date")}
      ${options.classifier ? input(view, "classifier", "Clasificador") : ""}
      ${input(view, "supplier", "Proveedor")}${input(view, "block", "Bloque")}${input(view, "variety", "Variedad")}
      ${input(view, "status", "Estado")}${input(view, "search", "Buscar")}
      ${options.pending ? `<label class="compact-inline-field"><span>Disponibilidad</span><select data-ops-search-view="${view}" data-ops-search-field="onlyPending"><option value="true" ${current.filters.onlyPending ? "selected" : ""}>Solo con pendiente</option><option value="false" ${current.filters.onlyPending ? "" : "selected"}>Todos</option></select></label>` : ""}
      <label class="compact-inline-field"><span>Filas</span><select data-ops-search-view="${view}" data-ops-search-field="pageSize"><option value="25" ${current.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${current.pageSize === 50 ? "selected" : ""}>50</option></select></label>
      <button class="primary-button" data-ops-search-action="query" data-view="${view}" ${current.loading ? "disabled" : ""}>${current.loading ? "Consultando..." : "Consultar"}</button>
    </div>`;
  }

  function pager(view) {
    const current = state(view);
    if (!current.queried || current.total === 0) return "";
    const start = (current.page - 1) * current.pageSize + 1;
    const end = Math.min(current.total, current.page * current.pageSize);
    return `<div class="ops-search-first-pager"><span>Mostrando ${start}–${end} de ${current.total} · Página ${current.page}/${current.totalPages}</span><div class="table-actions-inline"><button class="secondary-button" data-ops-search-action="page" data-view="${view}" data-page="${current.page - 1}" ${current.page <= 1 ? "disabled" : ""}>Anterior</button><button class="secondary-button" data-ops-search-action="page" data-view="${view}" data-page="${current.page + 1}" ${current.page >= current.totalPages ? "disabled" : ""}>Siguiente</button></div></div>`;
  }

  function empty(view, columns) {
    const current = state(view);
    if (!current.queried) return `<tr><td colspan="${columns}" class="ops-search-first-empty">Selecciona filtros y pulsa Consultar.</td></tr>`;
    if (current.error) return `<tr><td colspan="${columns}" class="ops-search-first-error">${utils.esc(current.error)}</td></tr>`;
    return `<tr><td colspan="${columns}" class="ops-search-first-empty">No existen resultados para los filtros seleccionados.</td></tr>`;
  }

  function receptionRows(view) {
    const current = state(view);
    const hasActions = view === "receptionHistory";
    return current.items.map(item => `<tr data-reception-id="${utils.esc(item.receptionId)}" data-reception-item-id="${utils.esc(item.receptionItemId)}"><td>${utils.esc(item.dateTime || item.date || "-")}</td><td>${utils.esc(item.supplier || "-")}</td><td>${utils.esc(item.block || "-")}</td><td><strong>${utils.esc(item.variety || "-")}</strong></td><td>${utils.esc(item.stemType || "-")}</td><td>${utils.number(item.receivedStems)}</td><td>${utils.number(item.deliveredStems)}</td><td><strong>${utils.number(item.pendingStems)}</strong></td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td>${hasActions ? `<td><button class="row-action-button" data-ops-action="reception-edit" data-id="${utils.esc(item.receptionId)}">Editar</button></td>` : ""}</tr>`).join("") || empty(view, hasActions ? 10 : 9);
  }

  function header(route, title, subtitle, view) {
    return `${utils.renderPageHeader(route, title, "authorized", subtitle)}${utils.renderTabs(route)}<div class="table-actions-inline ops-search-first-back"><button class="secondary-button" data-ops-search-action="close" data-view="${view}">Volver a la operación</button></div>`;
  }

  function renderReceptionHistory(route) {
    const view = "receptionHistory";
    return `${header(route, "Historial de recepciones", "Consulta canónica bajo demanda; registrar recepción permanece separado.", view)}<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">CONSULTA</p><h3>Recepciones por línea</h3></div></div>${filters(view)}<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha/hora</th><th>Proveedor</th><th>Bloque</th><th>Variedad</th><th>Tipo</th><th>Recibido</th><th>Entregado</th><th>Pendiente</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${receptionRows(view)}</tbody></table></div>${pager(view)}</section>`;
  }

  function renderClassificationReceipts(route) {
    const view = "classificationReceipts";
    return `${header(route, "Recepciones de flor", "Vista para patinadores basada en el lineage canónico de Recepción.", view)}<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">FLOR RECIBIDA</p><h3>Disponible para entregar</h3></div></div>${filters(view, { pending: true })}<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha/hora</th><th>Proveedor</th><th>Bloque</th><th>Variedad</th><th>Tipo</th><th>Recibido</th><th>Entregado</th><th>Pendiente</th><th>Estado</th></tr></thead><tbody>${receptionRows(view)}</tbody></table></div>${pager(view)}</section>`;
  }

  function deliveryRows() {
    const view = "classificationDeliveries";
    const current = state(view);
    return current.items.map(item => `<tr data-delivery-group-id="${utils.esc(item.deliveryGroupId)}"><td>${utils.esc(item.dateTime || "-")}</td><td>${utils.esc(item.classifier || "-")}</td><td>${utils.esc(item.supplier || "-")}</td><td>${utils.esc(item.block || "-")}</td><td><strong>${utils.esc(item.variety || "-")}</strong></td><td>${utils.esc(item.stemType || "-")}</td><td>${utils.number(item.meshCount)}</td><td>${utils.number(item.extraStems)}</td><td>${utils.number(item.totalStems)}</td><td>${utils.number(item.nationalStems)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td></tr>`).join("") || empty(view, 11);
  }

  function renderClassificationDeliveries(route) {
    const view = "classificationDeliveries";
    return `${header(route, "Trabajo entregado", "Cada fila agrupa una entrega por deliveryGroupId y conserva sus assignments por UUID.", view)}<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">CONSULTA</p><h3>Trabajo entregado a clasificadores</h3></div><button class="secondary-button" data-ops-search-action="export" data-view="${view}" ${state(view).queried && state(view).total ? "" : "disabled"}>Descargar Excel</button></div>${filters(view, { classifier: true })}<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha/hora</th><th>Clasificador</th><th>Proveedor</th><th>Bloque</th><th>Variedad</th><th>Tipo</th><th>Mallas</th><th>Extras</th><th>Tallos entregados</th><th>Nacional/Rechazo</th><th>Estado</th></tr></thead><tbody>${deliveryRows()}</tbody></table></div>${pager(view)}</section>`;
  }

  async function exportCurrent(appState) {
    const current = state("classificationDeliveries");
    const repository = BlessERP.getReceptionClassificationQueryRepository?.();
    const rows = await repository.exportDeliveries(current.filters);
    BlessERP.operacionesClasificacion?.exportClassificationXlsx?.(appState, rows);
  }

  function recordEntity(event) {
    return String(event?.detail?.record?.entity || event?.detail?.entity || "");
  }
  window.addEventListener("erp:canonical-record-updated", event => {
    const name = activeName();
    const current = state(name);
    if (!name || !current?.queried) return;
    const expectedRoute = name === "receptionHistory" ? "operations-reception" : "operations-grading";
    if (BlessERP.state?.currentRoute?.()?.id !== expectedRoute) return;
    if (!["operations_receptions", "operations_classifier_assignments", "operations_classification_results"].includes(recordEntity(event))) return;
    event.preventDefault?.();
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
      if (!state(name)?.open || BlessERP.state?.currentRoute?.()?.id !== expectedRoute) return;
      await query(name, state(name).page);
      BlessERP.layout?.renderPage?.();
    }, 180);
  });

  BlessERP.operacionesReceptionClassificationSearch = {
    activeName, close, exportCurrent, isOpen: name => Boolean(state(name)?.open), open, query,
    renderClassificationDeliveries, renderClassificationReceipts, renderReceptionHistory, setFilter, state
  };
})();
