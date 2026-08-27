(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;
  let refreshTimer = 0;
  let storageHandler = null;
  let mountedAppState = null;
  let productionSignature = "";

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function filterRows(rows, search, date) {
    const workerSearch = normalize(search);
    const selectedDate = String(date || "").trim();
    return (rows || [])
      .filter(row => !workerSearch || normalize(row.worker).includes(workerSearch))
      .filter(row => !selectedDate || row.date === selectedDate)
      .slice()
      .sort((left, right) => String(right.date).localeCompare(String(left.date)) || left.worker.localeCompare(right.worker));
  }

  function buildRows(store, ui) {
    const yieldUtils = BlessERP.operacionesRendimientosUtils;
    return {
      bunchers: filterRows(
        yieldUtils.buildBuncherHourlyPerformance(store, { scope: "all" }),
        ui.yieldHistoryBuncherSearch,
        ui.yieldHistoryBuncherDate
      ),
      classifiers: filterRows(
        yieldUtils.buildClassifierHourlyPerformance(store, { scope: "all" }),
        ui.yieldHistoryClassifierSearch,
        ui.yieldHistoryClassifierDate
      )
    };
  }

  function renderPanel(options) {
    return `
      <article class="panel-card ops-yield-records-panel" data-yield-records-panel="${utils.esc(options.mode)}">
        <h3>${utils.esc(options.title)}</h3>
        <div class="ops-yield-records-filters">
          <label><span>Buscar por nombre</span><input type="search" autocomplete="off" value="${utils.esc(options.search)}" data-ops-ui-field="${utils.esc(options.searchField)}" placeholder="${utils.esc(options.placeholder)}"></label>
          <label><span>Fecha</span><input type="date" value="${utils.esc(options.date)}" data-ops-ui-field="${utils.esc(options.dateField)}"></label>
        </div>
        <div class="compact-table-wrap ops-yield-records-table-wrap">
          <table class="compact-table ops-yield-records-table">
            <thead><tr><th>D&iacute;a laborado</th><th>${utils.esc(options.workerLabel)}</th><th>${utils.esc(options.totalLabel)}</th></tr></thead>
            <tbody>
              ${options.rows.map(row => `
                <tr>
                  <td>${utils.esc(row.date === "SIN_FECHA" ? "-" : utils.dateLabel(row.date))}</td>
                  <td><strong>${utils.esc(row.worker)}</strong></td>
                  <td><strong>${utils.esc(utils.number(row.total))}</strong></td>
                </tr>
              `).join("") || `<tr><td colspan="3" class="empty-row">No existen registros para los filtros seleccionados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function render(appState) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const rows = buildRows(store, ui);
    return `
      <section class="ops-yield-records-view" data-yield-records-view aria-label="Historial de registros de rendimientos">
        ${renderPanel({
          mode: "bunchers",
          title: "Registros de Embonchadores",
          workerLabel: "Embonchador",
          totalLabel: "Bonches realizados",
          search: ui.yieldHistoryBuncherSearch || "",
          date: ui.yieldHistoryBuncherDate || "",
          searchField: "yieldHistoryBuncherSearch",
          dateField: "yieldHistoryBuncherDate",
          placeholder: "Nombre del embonchador",
          rows: rows.bunchers
        })}
        ${renderPanel({
          mode: "classifiers",
          title: "Registros de Clasificadores",
          workerLabel: "Clasificador",
          totalLabel: "Mallas clasificadas",
          search: ui.yieldHistoryClassifierSearch || "",
          date: ui.yieldHistoryClassifierDate || "",
          searchField: "yieldHistoryClassifierSearch",
          dateField: "yieldHistoryClassifierDate",
          placeholder: "Nombre del clasificador",
          rows: rows.classifiers
        })}
      </section>
    `;
  }

  function signature(store) {
    return JSON.stringify({
      bunches: (store.bunchEntries || []).map(item => [item.id, item.registeredAt, item.buncher, item.state]),
      inventory: (store.roseInventory || []).map(item => [item.inventoryId, item.sourceType, item.state]),
      meshes: (store.meshProcessingRecords || []).map(item => [item.id, item.registeredAt, item.classifier, item.meshCount]),
      workdays: (store.yieldWorkdayHistory || []).map(item => [item.id, item.status, item.endedAt])
    });
  }

  function refreshFromDatabase() {
    if (!mountedAppState || BlessERP.state?.state?.currentRoute !== "operations-yields") {
      unmount();
      return;
    }
    const latestDb = BlessERP.storage?.load?.();
    if (!latestDb?.operations || latestDb.operations.ui?.yieldsView !== "records") return;
    const nextSignature = signature(latestDb.operations);
    if (nextSignature === productionSignature) return;
    mountedAppState.db = latestDb;
    productionSignature = nextSignature;
    BlessERP.layout.renderApp();
  }

  function mount(appState) {
    unmount();
    mountedAppState = appState;
    productionSignature = signature(stateApi.getStore(appState));
    refreshTimer = setInterval(refreshFromDatabase, 5000);
    storageHandler = refreshFromDatabase;
    window.addEventListener?.("storage", storageHandler);
  }

  function unmount() {
    clearInterval(refreshTimer);
    if (storageHandler) window.removeEventListener?.("storage", storageHandler);
    refreshTimer = 0;
    storageHandler = null;
    mountedAppState = null;
  }

  BlessERP.operacionesRegistrosRendimientos = { buildRows, filterRows, mount, refreshFromDatabase, render, signature, unmount };
})();
