(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.operacionesUtils;
  const stateApi = BlessERP.operacionesState;

  function qualityReportLabel(value) {
    const canonical = BlessERP.flowerQuality?.normalize?.(value) || "";
    if (canonical === "PREMIUM") return "EXPORTACION";
    if (canonical === "TIPO_B") return "TIPO B";
    const historical = BlessERP.flowerQuality?.preserve?.(value) || "";
    return historical === "EXPORTACION" ? "EXPORTACION" : historical;
  }

  function uniqueOptions(rows, field, selected) {
    return [...new Set(rows.map(item => String(item[field] || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map(value => `<option value="${utils.esc(value)}" ${value === selected ? "selected" : ""}>${utils.esc(value)}</option>`)
      .join("");
  }

  function filterRows(rows, filters) {
    const code = String(filters.code || "").trim().toUpperCase();
    return (rows || []).filter(item => {
      const date = String(item.processedAt || "").slice(0, 10);
      return (!code || String(item.meshCode || "").toUpperCase() === code) &&
        (!filters.from || date >= filters.from) &&
        (!filters.to || date <= filters.to) &&
        (!filters.supplier || item.supplier === filters.supplier) &&
        (!filters.block || item.block === filters.block) &&
        (!filters.variety || item.variety === filters.variety) &&
        (!filters.length || String(item.length || "") === String(filters.length)) &&
        (!filters.worker || item.workerName === filters.worker) &&
        (!filters.user || item.userName === filters.user) &&
        (!filters.state || item.state === filters.state);
    });
  }

  function sortRows(rows, sort) {
    const comparators = {
      "date-desc": (a, b) => String(b.processedAt).localeCompare(String(a.processedAt)),
      "date-asc": (a, b) => String(a.processedAt).localeCompare(String(b.processedAt)),
      "code-asc": (a, b) => String(a.meshCode).localeCompare(String(b.meshCode)),
      "supplier-asc": (a, b) => String(a.supplier).localeCompare(String(b.supplier)),
      "variety-asc": (a, b) => String(a.variety).localeCompare(String(b.variety)),
      "worker-asc": (a, b) => String(a.workerName).localeCompare(String(b.workerName))
    };
    return [...rows].sort(comparators[sort] || comparators["date-desc"]);
  }

  function getVisibleRows(appState) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    return sortRows(filterRows(store.processedMeshHistory || [], ui.meshHistoryAppliedFilters || {}), ui.meshHistorySort);
  }

  function exportHistoryXlsx(appState, options = {}) {
    const rows = getVisibleRows(appState);
    if (!rows.length) return { ok: false, message: "No existen registros visibles para exportar." };
    const ui = stateApi.getUi(appState);
    const filters = Object.entries(ui.meshHistoryAppliedFilters || {}).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(" | ") || "Sin filtros";
    const totalMeshes = rows.reduce((sum, item) => sum + Math.max(1, utils.parseNumber(item.meshCount, 1)), 0);
    const totalStems = rows.reduce((sum, item) => sum + utils.parseNumber(item.processedStems), 0);
    const totalBunches = rows.reduce((sum, item) => sum + utils.parseNumber(item.bunchesObtained), 0);
    const sheet = {
      name: "Mallas procesadas",
      title: "HISTORIAL DE MALLAS PROCESADAS",
      widths: [24,22,14,26,18,22,16,14,18,18,20,22,18,36],
      headers: ["Codigo malla","Fecha y hora","Cantidad de mallas","Proveedor","Bloque","Variedad","TIPO","Medida","Tallos procesados","Ramos obtenidos","Trabajador","Usuario","Estado","Observaciones"],
      rows: rows.map(item => [item.meshCode,item.processedAt,item.meshCount || 1,item.supplier,item.block,item.variety,qualityReportLabel(item.quality),item.length || "",item.processedStems,item.bunchesObtained,item.workerName,item.userName,item.state,item.observations]),
      totals: ["TOTALES","",totalMeshes,"","","","","",totalStems,totalBunches,"","","",""]
    };
    const report = {
      period: `Exportado ${new Date().toLocaleString("es-EC")}`,
      range: `${filters} | ${totalMeshes} mallas | ${totalStems} tallos | ${totalBunches} ramos`
    };
    const archive = BlessERP.operacionesRamosReportXlsx.buildWorkbookArchive([sheet], report);
    const fileName = `historial-mallas-procesadas-${new Date().toISOString().slice(0, 10)}.xlsx`;
    if (options.download !== false) {
      const blob = new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    }
    return { ok: true, rows, fileName, archive, totals: { totalMeshes, totalStems, totalBunches }, filters };
  }

  function renderDetailDialog(record, audits) {
    return `
      <div class="modal-backdrop" data-ops-mesh-history-dialog>
        <section class="modal-card ops-mesh-history-dialog">
          <div class="panel-card-head"><div><p class="section-kicker">DETALLE</p><h3>${utils.esc(record.meshCode)}</h3></div><button class="secondary-button" data-ops-action="mesh-history-dialog-close">Cerrar</button></div>
          <div class="ops-mesh-detail-grid">
            ${[
              ["Fecha y hora",record.processedAt],["Cantidad de mallas",record.meshCount || 1],["Proveedor",record.supplier],["Bloque",record.block],["Variedad",record.variety],
              ["Medida",record.length ? `${record.length} cm` : "-"],["Tallos iniciales",record.initialStems],["Tallos procesados",record.processedStems],["Ramos obtenidos",record.bunchesObtained],
              ["Trabajador",record.workerName],["Usuario",record.userName],["Mesa",record.station || "-"],["Turno",record.shift || "-"],["Estado",record.state],["Observaciones",record.observations || "-"]
            ].map(([label,value]) => `<div><span>${utils.esc(label)}</span><strong>${utils.esc(value)}</strong></div>`).join("")}
          </div>
          ${audits.length ? `<div class="ops-mesh-audit"><strong>Correcciones y anulaciones</strong>${audits.map(item => `<p>${utils.esc(item.dateTime)} &middot; ${utils.esc(item.action)} &middot; ${utils.esc(item.user)} &middot; ${utils.esc(item.reason)}</p>`).join("")}</div>` : ""}
        </section>
      </div>
    `;
  }

  function renderEditDialog(record, draft) {
    return `
      <div class="modal-backdrop" data-ops-mesh-history-dialog>
        <section class="modal-card ops-mesh-history-dialog">
          <div class="panel-card-head"><div><p class="section-kicker">CORRECCI&Oacute;N AUTORIZADA</p><h3>${utils.esc(record.meshCode)}</h3></div></div>
          <div class="ops-form-grid">
            ${[["Proveedor","supplier"],["Bloque","block"],["Variedad","variety"],["Trabajador","workerName"],["Mesa","station"],["Turno","shift"]].map(([label,field]) => `<label>${label}<input data-ops-bind="meshHistoryEditDraft" data-field="${field}" value="${utils.esc(draft[field] || "")}"></label>`).join("")}
            <label>Medida<input type="number" min="0" data-ops-bind="meshHistoryEditDraft" data-field="length" value="${utils.esc(draft.length || "")}"></label>
            <label>Tallos procesados<input type="number" min="0" data-ops-bind="meshHistoryEditDraft" data-field="processedStems" value="${utils.esc(draft.processedStems)}"></label>
            <label>Ramos obtenidos<input type="number" min="0" data-ops-bind="meshHistoryEditDraft" data-field="bunchesObtained" value="${utils.esc(draft.bunchesObtained)}"></label>
          </div>
          <label>Observaciones<input data-ops-bind="meshHistoryEditDraft" data-field="observations" value="${utils.esc(draft.observations || "")}"></label>
          <label>Motivo de correcci&oacute;n<input data-ops-bind="meshHistoryEditDraft" data-field="editReason" value="${utils.esc(draft.editReason || "")}"></label>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="mesh-history-edit-save">Guardar correcci&oacute;n</button><button class="secondary-button" data-ops-action="mesh-history-dialog-close">Cancelar</button></div>
        </section>
      </div>
    `;
  }

  function renderAnnulDialog(record, draft) {
    return `
      <div class="modal-backdrop" data-ops-mesh-history-dialog>
        <section class="modal-card ops-mesh-history-dialog">
          <p class="section-kicker">ANULACI&Oacute;N L&Oacute;GICA</p><h3>${utils.esc(record.meshCode)}</h3>
          <p>El registro continuar&aacute; visible con estado ANULADO.</p>
          <label>Motivo de anulaci&oacute;n<textarea data-ops-bind="meshHistoryEditDraft" data-field="annulReason">${utils.esc(draft.annulReason || "")}</textarea></label>
          <div class="table-actions-inline"><button class="danger-button" data-ops-action="mesh-history-annul-confirm">Anular registro</button><button class="secondary-button" data-ops-action="mesh-history-dialog-close">Cancelar</button></div>
        </section>
      </div>
    `;
  }

  function render(appState) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const allRows = store.processedMeshHistory || [];
    const rows = getVisibleRows(appState);
    const visibleMeshCount = rows.reduce((sum, item) => sum + Math.max(1, utils.parseNumber(item.meshCount, 1)), 0);
    const pageSize = ui.meshHistoryPageSize;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(Math.max(1, ui.meshHistoryPage), pages);
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    const filters = ui.meshHistoryFilters;
    const canEdit = stateApi.canEditProcessedMeshHistory(appState);
    const dialog = ui.meshHistoryDialog;
    const dialogRecord = allRows.find(item => item.id === dialog?.historyId);
    const audits = (store.processedMeshHistoryAudit || []).filter(item => item.historyId === dialogRecord?.id);
    return `
      <section class="panel-card ops-mesh-history-panel">
        <div class="panel-card-head"><div><p class="section-kicker">HISTORIAL DE MALLAS PROCESADAS</p><h3>Consulta exclusiva de mallas procesadas</h3></div><span class="status-badge authorized">${utils.esc(utils.number(visibleMeshCount))} mallas</span></div>
        <div class="ops-mesh-history-filters">
          <label>C&oacute;digo de malla<input value="${utils.esc(filters.code)}" data-ops-bind="meshHistoryFilters" data-field="code" data-ops-mesh-history-code placeholder="Escriba o escanee el c&oacute;digo"></label>
          <label>Fecha inicial<input type="date" value="${utils.esc(filters.from)}" data-ops-bind="meshHistoryFilters" data-field="from"></label>
          <label>Fecha final<input type="date" value="${utils.esc(filters.to)}" data-ops-bind="meshHistoryFilters" data-field="to"></label>
          <label>Proveedor<select data-ops-bind="meshHistoryFilters" data-field="supplier"><option value="">Todos</option>${uniqueOptions(allRows,"supplier",filters.supplier)}</select></label>
          <label>Bloque<select data-ops-bind="meshHistoryFilters" data-field="block"><option value="">Todos</option>${uniqueOptions(allRows,"block",filters.block)}</select></label>
          <label>Variedad<select data-ops-bind="meshHistoryFilters" data-field="variety"><option value="">Todas</option>${uniqueOptions(allRows,"variety",filters.variety)}</select></label>
          <label>Medida<select data-ops-bind="meshHistoryFilters" data-field="length"><option value="">Todas</option>${uniqueOptions(allRows,"length",String(filters.length || ""))}</select></label>
          <label>Trabajador<select data-ops-bind="meshHistoryFilters" data-field="worker"><option value="">Todos</option>${uniqueOptions(allRows,"workerName",filters.worker)}</select></label>
          <label>Usuario<select data-ops-bind="meshHistoryFilters" data-field="user"><option value="">Todos</option>${uniqueOptions(allRows,"userName",filters.user)}</select></label>
          <label>Estado<select data-ops-bind="meshHistoryFilters" data-field="state"><option value="">Todos</option>${uniqueOptions(allRows,"state",filters.state)}</select></label>
        </div>
        <div class="ops-mesh-history-toolbar">
          <button class="primary-button" data-ops-action="mesh-history-search">Buscar</button>
          <button class="secondary-button" data-ops-action="mesh-history-clear">Limpiar</button>
          <button class="secondary-button" data-ops-action="mesh-history-today">Registros de hoy</button>
          <button class="secondary-button" data-ops-action="mesh-history-all">Mostrar todos</button>
          <button class="secondary-button" data-ops-action="mesh-history-export" ${rows.length ? "" : "disabled"}>Exportar a Excel</button>
          <label>Orden<select data-ops-ui-field="meshHistorySort"><option value="date-desc" ${ui.meshHistorySort === "date-desc" ? "selected" : ""}>Fecha reciente</option><option value="date-asc" ${ui.meshHistorySort === "date-asc" ? "selected" : ""}>Fecha antigua</option><option value="code-asc" ${ui.meshHistorySort === "code-asc" ? "selected" : ""}>C&oacute;digo</option><option value="supplier-asc" ${ui.meshHistorySort === "supplier-asc" ? "selected" : ""}>Proveedor</option><option value="variety-asc" ${ui.meshHistorySort === "variety-asc" ? "selected" : ""}>Variedad</option><option value="worker-asc" ${ui.meshHistorySort === "worker-asc" ? "selected" : ""}>Trabajador</option></select></label>
          <label>Filas<select data-ops-ui-field="meshHistoryPageSize">${[10,25,50,100].map(value => `<option value="${value}" ${pageSize === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table ops-mesh-history-table">
            <thead><tr><th>N&uacute;mero</th><th>C&oacute;digo de malla</th><th>Mallas</th><th>Fecha</th><th>Hora</th><th>Proveedor</th><th>Bloque</th><th>Variedad</th><th>Medida</th><th>Tallos procesados</th><th>Ramos obtenidos</th><th>Trabajador</th><th>Usuario</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>${pageRows.map((item,index) => {
              const [date,time = "-"] = String(item.processedAt || "").split(" ");
              return `<tr><td>${(page - 1) * pageSize + index + 1}</td><td><strong>${utils.esc(item.meshCode)}</strong></td><td>${utils.esc(utils.number(item.meshCount || 1))}</td><td>${utils.esc(utils.dateLabel(date))}</td><td>${utils.esc(time)}</td><td>${utils.esc(item.supplier)}</td><td>${utils.esc(item.block)}</td><td>${utils.esc(item.variety)}</td><td>${item.length ? `${utils.esc(item.length)} cm` : "-"}</td><td>${utils.esc(utils.number(item.processedStems))}</td><td>${utils.esc(utils.number(item.bunchesObtained))}</td><td>${utils.esc(item.workerName)}</td><td>${utils.esc(item.userName)}</td><td><span class="status-badge ${utils.badgeClass(item.state)}">${utils.esc(item.state)}</span></td><td><div class="ops-mesh-row-actions"><button data-ops-action="mesh-history-detail" data-id="${utils.esc(item.id)}">Ver detalle</button>${canEdit ? `<button data-ops-action="mesh-history-edit" data-id="${utils.esc(item.id)}">Editar</button><button class="danger-text" data-ops-action="mesh-history-annul" data-id="${utils.esc(item.id)}" ${item.annulled ? "disabled" : ""}>Anular</button>` : ""}</div></td></tr>`;
            }).join("") || `<tr><td colspan="15" class="empty-row">No existen mallas procesadas con los filtros seleccionados.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="ops-mesh-history-pagination"><span>Mostrando ${utils.esc(utils.number(pageRows.length))} de ${utils.esc(utils.number(rows.length))}</span><div><button class="secondary-button" data-ops-action="mesh-history-page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Anterior</button><span>P&aacute;gina ${page} de ${pages}</span><button class="secondary-button" data-ops-action="mesh-history-page" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Siguiente</button></div></div>
      </section>
      ${dialogRecord && dialog?.type === "DETAIL" ? renderDetailDialog(dialogRecord, audits) : ""}
      ${dialogRecord && dialog?.type === "EDIT" ? renderEditDialog(dialogRecord, ui.meshHistoryEditDraft || {}) : ""}
      ${dialogRecord && dialog?.type === "ANNUL" ? renderAnnulDialog(dialogRecord, ui.meshHistoryEditDraft || {}) : ""}
    `;
  }

  BlessERP.operacionesHistorialMallas = { exportHistoryXlsx, filterRows, getVisibleRows, qualityReportLabel, render, sortRows };
})();
