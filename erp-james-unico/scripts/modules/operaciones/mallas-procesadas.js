(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function render(appState) {
    const utils = BlessERP.operacionesUtils;
    const stateApi = BlessERP.operacionesState;
    const store = stateApi.getStore(appState);
    const draft = stateApi.getUi(appState).yieldMeshDraft;
    const rows = store.meshProcessingRecords || [];
    const totalMeshes = rows.reduce((sum, item) => sum + utils.parseNumber(item.meshCount), 0);
    const totalStems = rows.reduce((sum, item) => sum + utils.parseNumber(item.totalStems), 0);

    return `
      <section class="hero-banner">
        <div>
          <strong>Ingreso de mallas procesadas</strong>
          <span>Panel separado para proveedor, bloque, variedad, clasificador y tallos extras, como base del flujo operativo de Parte 1.</span>
        </div>
      </section>
      ${utils.renderSummaryCards([
        { label: "Mallas registradas", value: utils.number(totalMeshes), help: "Total demo entregado a clasificacion" },
        { label: "Tallos procesados", value: utils.number(totalStems), help: "Mallas x 25 + tallos extras" },
        { label: "Clasificadores activos", value: utils.number(new Set(rows.map(item => item.classifier)).size), help: "Con entrega de mallas en el dia" }
      ])}
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CLASIFICACION POR MALLAS</p>
            <h3>Entrega de mallas al clasificador</h3>
          </div>
          <span class="status-badge partial">Demo activo</span>
        </div>
        <div class="ops-form-grid">
          <label>
            Fecha
            <input data-ops-bind="yieldMeshDraft" data-field="date" value="${utils.esc(draft.date)}">
          </label>
          <label>
            Proveedor
            <select data-ops-bind="yieldMeshDraft" data-field="supplier">
              ${store.catalogs.suppliers.map(item => `<option value="${utils.esc(item)}" ${item === draft.supplier ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label>
            Bloque
            <select data-ops-bind="yieldMeshDraft" data-field="block">
              ${store.catalogs.blocks.map(item => `<option value="${utils.esc(item)}" ${item === draft.block ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label>
            Variedad
            <select data-ops-bind="yieldMeshDraft" data-field="variety">
              ${store.catalogs.varieties.map(item => `<option value="${utils.esc(item)}" ${item === draft.variety ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label>
            Clasificador
            <select data-ops-bind="yieldMeshDraft" data-field="classifier">
              ${store.catalogs.classifiers.map(item => `<option value="${utils.esc(item)}" ${item === draft.classifier ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label>
            Responsable
            <select data-ops-bind="yieldMeshDraft" data-field="responsible">
              ${store.catalogs.responsibles.map(item => `<option value="${utils.esc(item)}" ${item === draft.responsible ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label>
            Numero de mallas
            <input type="number" min="0" step="1" data-ops-bind="yieldMeshDraft" data-field="meshCount" value="${utils.esc(draft.meshCount)}">
          </label>
          <label>
            Tallos extras
            <input type="number" min="0" step="1" data-ops-bind="yieldMeshDraft" data-field="extraStems" value="${utils.esc(draft.extraStems)}">
          </label>
        </div>
        <label>
          Observacion
          <input data-ops-bind="yieldMeshDraft" data-field="observation" value="${utils.esc(draft.observation || "")}" placeholder="Novedad de clasificacion o entrega">
        </label>
        <div class="hero-banner">
          <div>
            <strong>Total demo de tallos</strong>
            <span data-ops-yield-mesh-total>${utils.esc(utils.number((utils.parseNumber(draft.meshCount) * 25) + utils.parseNumber(draft.extraStems)))}</span>
          </div>
          <div class="button-row">
            <button class="secondary-button" type="button" data-ops-action="yield-mesh-reset">Limpiar</button>
            <button class="primary-button" type="button" data-ops-action="yield-mesh-save">Registrar mallas</button>
          </div>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Mallas procesadas del dia</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Bloque</th>
                <th>Variedad</th>
                <th>Clasificador</th>
                <th>Mallas</th>
                <th>Tallos extra</th>
                <th>Total tallos</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${utils.esc(utils.dateLabel(item.date))}</td>
                  <td>${utils.esc(item.supplier)}</td>
                  <td>${utils.esc(item.block)}</td>
                  <td>${utils.esc(item.variety)}</td>
                  <td>${utils.esc(item.classifier)}</td>
                  <td>${utils.esc(utils.number(item.meshCount))}</td>
                  <td>${utils.esc(utils.number(item.extraStems))}</td>
                  <td>${utils.esc(utils.number(item.totalStems))}</td>
                  <td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  BlessERP.operacionesMallasProcesadas = { render };
})();
