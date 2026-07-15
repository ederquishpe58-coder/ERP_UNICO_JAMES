(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const TYPE_LABELS = {
    suppliers: "Proveedores",
    classifiers: "Clasificadores",
    bunchers: "Embonchadores",
    receptionists: "Recepcionistas",
    varieties: "Variedades",
    lengths: "Longitudes",
    stemTypes: "Tipos de tallo",
    labelTypes: "Tipos de etiqueta"
  };

  function render(appState, route) {
    const stateApi = BlessERP.operacionesState;
    const utils = BlessERP.operacionesUtils;
    const store = stateApi.getStore(appState);
    const draft = store.ui.parameterDraft;
    const rows = Object.entries(store.masterData).flatMap(([type, items]) => items.map(item => ({ ...item, type })));
    const active = rows.filter(item => item.active !== false).length;

    return `
      ${utils.renderPageHeader(route, "Parametros operativos activos", "authorized", "Catalogos maestros reutilizados por Recepcion, Clasificacion, Etiquetas y Escaneo.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(store.ui)}
      <section class="hero-banner">
        <div>
          <strong>Una sola fuente para los datos operativos</strong>
          <span>Los registros con historial se desactivan en lugar de eliminarse para conservar trazabilidad.</span>
        </div>
      </section>
      ${utils.renderSummaryCards([
        { label: "Parametros", value: utils.number(rows.length), help: "Todos los catalogos" },
        { label: "Activos", value: utils.number(active), help: "Disponibles en formularios" },
        { label: "Inactivos", value: utils.number(rows.length - active), help: "Conservan historial" },
        { label: "Catalogos", value: utils.number(Object.keys(TYPE_LABELS).length), help: "Administracion central" }
      ])}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">PARAMETRO</p><h3>${draft.id ? "Editar parametro" : "Nuevo parametro"}</h3></div>
            <span class="status-badge partial">Local/demo</span>
          </div>
          <div class="ops-form-grid">
            <label class="compact-inline-field"><span>Tipo</span><select data-ops-bind="parameterDraft" data-field="type">${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${utils.esc(value)}" ${value === draft.type ? "selected" : ""}>${utils.esc(label)}</option>`).join("")}</select></label>
            <label class="compact-inline-field"><span>Codigo</span><input value="${utils.esc(draft.code)}" data-ops-bind="parameterDraft" data-field="code" placeholder="Automatico si queda vacio"></label>
            <label class="compact-inline-field"><span>Nombre / valor</span><input value="${utils.esc(draft.name)}" data-ops-bind="parameterDraft" data-field="name"></label>
            ${draft.type === "suppliers" ? `<label class="compact-inline-field"><span>Numero de bloque asignado</span><input value="${utils.esc(draft.assignedBlock || "")}" data-ops-bind="parameterDraft" data-field="assignedBlock" placeholder="Ej. BQ-01"></label>` : ""}
            <label class="compact-inline-field ops-form-span-2"><span>Observacion</span><textarea rows="2" data-ops-bind="parameterDraft" data-field="observation">${utils.esc(draft.observation)}</textarea></label>
          </div>
          <div class="table-actions-inline">
            <button class="primary-button" data-ops-action="parameter-save">Guardar parametro</button>
            <button class="secondary-button" data-ops-action="parameter-reset">Limpiar</button>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">REGLAS</p><h3>Integridad de catalogos</h3></div></div>
          <ul class="checklist-list">
            <li>No se permiten nombres duplicados dentro del mismo catalogo.</li>
            <li>Los parametros activos aparecen en las listas desplegables.</li>
            <li>Un parametro usado historicamente se desactiva, no se borra.</li>
            <li>No conecta Supabase ni modifica Parte 1 original.</li>
          </ul>
        </article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">CATALOGOS</p><h3>Parametros de Operaciones / Poscosecha</h3></div></div>
        <div class="compact-table-wrap"><table class="compact-table">
          <thead><tr><th>Tipo</th><th>Codigo</th><th>Nombre</th><th>Bloque asignado</th><th>Estado</th><th>Observacion</th><th>Acciones</th></tr></thead>
          <tbody>${rows.map(item => `<tr>
            <td>${utils.esc(TYPE_LABELS[item.type] || item.type)}</td><td>${utils.esc(item.code)}</td><td>${utils.esc(item.name)}</td><td>${utils.esc(item.assignedBlock || "-")}</td>
            <td><span class="status-badge ${item.active !== false ? "authorized" : "pending"}">${item.active !== false ? "ACTIVO" : "INACTIVO"}</span></td>
            <td>${utils.esc(item.observation || "-")}</td>
            <td><div class="table-actions-inline">
              <button class="row-action-button" data-ops-action="parameter-edit" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">Editar</button>
              <button class="row-action-button" data-ops-action="parameter-toggle" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">${item.active !== false ? "Desactivar" : "Activar"}</button>
              <button class="row-action-button" data-ops-action="parameter-delete" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">Eliminar</button>
            </div></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>
    `;
  }

  BlessERP.operacionesParametros = { render };
})();
