(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let searchPanelOpen = false;

  function isSearchPanelOpen() {
    return searchPanelOpen;
  }

  function setSearchPanelOpen(open) {
    searchPanelOpen = Boolean(open);
    return searchPanelOpen;
  }

  function inventoryTone(state) {
    if (state === "DISPONIBLE") return "authorized";
    if (state === "ANULADO") return "cancelled";
    return "partial";
  }

  function sessionTone(status) {
    if (status === "INGRESADO") return "authorized";
    if (status === "DUPLICADO") return "partial";
    if (status === "ERROR") return "cancelled";
    return "pending";
  }

  function sessionLabel(status) {
    return ({
      LEIDO: "Leído",
      EN_COLA: "En cola",
      CONFIRMANDO: "Confirmando",
      INGRESADO: "Ingresado",
      DUPLICADO: "Ramo ya ingresado",
      ERROR: "Error",
      PENDIENTE_COMPOSICION: "Pendiente de composición"
    })[status] || status || "Esperando";
  }

  function renderSession(snapshot = {}) {
    const utils = BlessERP.operacionesUtils;
    const items = Array.isArray(snapshot.results) ? snapshot.results : [];
    const last = snapshot.last || null;
    return `
      <div class="ops-zebra-session-metrics">
        <div><span>Pendientes</span><strong>${utils.number(snapshot.pending || 0)}</strong></div>
        <div><span>Confirmados</span><strong>${utils.number(snapshot.confirmed || 0)}</strong></div>
        <div><span>Errores</span><strong>${utils.number(snapshot.errors || 0)}</strong></div>
      </div>
      ${last ? `<div class="inline-feedback ${last.status === "INGRESADO" ? "success" : last.status === "ERROR" ? "danger" : "warning"}"><strong>${utils.esc(sessionLabel(last.status))}</strong> · ${utils.esc(last.message || last.code || "")}</div>` : ""}
      <div class="ops-zebra-session-list">
        ${items.map(item => `<div class="ops-zebra-session-item" data-status="${utils.esc(item.status)}">
          <span class="status-badge ${sessionTone(item.status)}">${utils.esc(sessionLabel(item.status))}</span>
          <strong>${utils.esc(item.code)}</strong>
          <small>${utils.esc(item.message || "")}</small>
          ${item.status === "ERROR" && item.retryable ? `<button class="secondary-button" type="button" data-ops-action="bunch-intake-retry" data-operation-id="${utils.esc(item.operationId)}">Reintentar</button>` : ""}
        </div>`).join("") || `<div class="ops-zebra-session-empty">Esta sesión todavía no tiene lecturas.</div>`}
      </div>
    `;
  }

  function render(appState, route) {
    const stateApi = BlessERP.operacionesState;
    const utils = BlessERP.operacionesUtils;
    const store = stateApi.getStore(appState);
    const draft = store.ui.bunchIntakeDraft;
    const scanner = BlessERP.operacionesZebraIntakeController?.getSnapshot?.() || { pending: 0, confirmed: 0, errors: 0, results: [], last: null, mounted: false };
    const last = scanner.last;
    const mixedDraft = store.ui.mixedBunchIntakeDraft;
    const suppliers = (store.masterData?.suppliers || []).filter(item => item.active !== false && item.assignedBlock);
    const mixedTotal = (mixedDraft?.lines || []).reduce((sum, item) => sum + utils.parseNumber(item.stems), 0);
    const mixedRemaining = Math.max(utils.parseNumber(mixedDraft?.expectedStems) - mixedTotal, 0);
    const selectedSearchCodes = new Set(store.ui.bunchSearchSelectedCodes || []);
    const searchRows = (store.ui.bunchSearchCodes || []).map(code => store.roseInventory.find(item => item.labelCode === code && item.sourceType === "ESCANEO_ETIQUETA")).filter(Boolean);
    const filteredSearchRows = searchRows;
    const selectedSearchRows = searchRows.filter(item => selectedSearchCodes.has(item.labelCode));
    const bulkLengthOptions = [40, 50, 60, 70, 80, 90, 100];
    const searchOpen = isSearchPanelOpen();
    const searchDialog = store.ui.bunchSearchDialog || "";

    return `
      ${utils.renderPageHeader(route, "Ingreso por escaneo activo", "authorized", "Estacion exclusiva donde una etiqueta valida se convierte en un ramo de inventario.")}
      ${utils.renderTabs(route)}
      <div class="ops-bunch-intake-summary">
        ${utils.renderSummaryCards([
          { label: "Pendientes", value: utils.number(scanner.pending), help: "En cola o confirmando" },
          { label: "Confirmados", value: utils.number(scanner.confirmed), help: "Solo esta sesión" },
          { label: "Errores", value: utils.number(scanner.errors), help: "Requieren revisión" }
        ])}
      </div>
      <section class="ops-bunch-intake-layout">
        <article class="panel-card ops-scanner-station">
          <div class="panel-card-head"><div><p class="section-kicker">INGRESO DE RAMOS</p><h3>Escanear etiqueta del ramo</h3></div><div class="table-actions-inline"><button type="button" class="secondary-button" data-ops-action="bunch-history-open">Ver historial</button><button type="button" class="secondary-button" data-route-link="operations-labels">DIGITACIÓN / ETIQUETAS ZEBRA</button></div></div>
          <div class="ops-bunch-auto-intake">
            <div class="ops-bunch-auto-reader" tabindex="0" role="status" aria-live="polite" data-ops-bunch-intake-auto>
              <span><i aria-hidden="true"></i>LECTOR ZEBRA HID</span>
              <strong>${last?.code ? `ETIQUETA ${utils.esc(last.code)}` : "ESPERANDO ETIQUETA"}</strong>
              <small>${last ? utils.esc(sessionLabel(last.status)) : "LECTURA AUTOMATICA"}</small>
            </div>
            <input class="sr-only" type="text" inputmode="none" maxlength="10" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus data-ops-bunch-intake-scan aria-label="Captura automatica del codigo de 10 digitos del ramo">
            <label class="compact-inline-field"><span>Responsable</span><input type="text" value="${utils.esc(draft.responsible)}" readonly aria-readonly="true"></label>
          </div>
          <div class="ops-reader-toolbar">
            <span class="status-badge ${scanner.mounted ? "authorized" : "partial"}">${scanner.mounted ? "LECTOR ZEBRA ACTIVO" : "LECTOR EN ESPERA"}</span>
            <span class="status-badge partial" data-ops-zebra-remote-sync>${scanner.remoteSyncAt ? "INVENTARIO SINCRONIZADO" : "CONFIRMACIÓN SUPABASE"}</span>
          </div>
          <div data-ops-zebra-session>${renderSession(scanner)}</div>
          <div class="ops-bunch-search-toggle-row">
            <button class="ops-bunch-search-toggle" type="button" data-ops-action="bunch-search-toggle" aria-expanded="${searchOpen}" aria-controls="ops-bunch-search-panel">
              <span class="ops-bunch-search-toggle-icon" aria-hidden="true">&#128269;</span>
              <span>ABRIR LECTOR PARA BUSCAR / EDITAR RAMOS</span>
              ${searchRows.length ? `<strong>${utils.number(searchRows.length)}</strong>` : ""}
            </button>
          </div>
        </article>
        ${searchOpen ? `<div class="ops-bunch-search-workspace-backdrop" data-ops-bunch-search-workspace role="dialog" aria-modal="true" aria-labelledby="ops-bunch-search-workspace-title">
        <article id="ops-bunch-search-panel" class="panel-card ops-bunch-search-panel is-open">
          <div class="panel-card-head ops-bunch-search-head">
            <div><p class="section-kicker">LECTOR INDEPENDIENTE</p><h3 id="ops-bunch-search-workspace-title">Buscar, editar o eliminar ramos</h3><p>Todo lo escaneado se acumula exclusivamente dentro de esta ventana.</p></div>
            <div class="ops-bunch-search-head-actions"><span class="ops-bunch-search-total">${utils.number(searchRows.length)} escaneadas | ${utils.number(selectedSearchRows.length)} seleccionadas</span><button class="ops-modal-close" type="button" data-ops-action="bunch-search-close" aria-label="Cerrar lector">X</button></div>
          </div>
          <div class="ops-bunch-search-entry-grid">
            <div class="ops-bunch-search-inputs">
              <div class="ops-bunch-search-unified-control">
                <div class="ops-zebra-reader-control">
                  <input class="sr-only ops-bunch-search-scan" type="text" inputmode="none" maxlength="180" autocomplete="off" autocapitalize="characters" spellcheck="false" ${searchOpen ? "autofocus" : ""} value="${utils.esc(store.ui.bunchSearchScanCode)}" data-ops-ui-field="bunchSearchScanCode" data-ops-bunch-search-scan aria-label="Captura exclusiva del lector Zebra">
                  <span class="secondary-button ops-zebra-reader-button is-active" aria-label="Lector ZEBRA de busqueda activo automaticamente">
                    <span class="ops-zebra-reader-mark" aria-hidden="true"></span>
                    ZEBRA LISTA PARA ESCANEAR
                  </span>
                  <strong>Escanee una etiqueta para localizar y seleccionar el ramo.</strong>
                </div>
              </div>
              <p class="panel-note">B&uacute;squeda exclusiva por esc&aacute;ner. No se permite digitar ni buscar c&oacute;digos manualmente.</p>
            </div>
            <div class="ops-bunch-search-counters" aria-label="Contadores de busqueda">
              <div><span>Etiquetas escaneadas</span><strong>${utils.number(searchRows.length)}</strong></div>
              <div><span>Etiquetas seleccionadas</span><strong>${utils.number(selectedSearchRows.length)}</strong></div>
            </div>
          </div>
          <div class="ops-bunch-search-actions">
            <button class="secondary-button" data-ops-action="bunch-search-select-visible" data-codes="${utils.esc(filteredSearchRows.map(item => item.labelCode).join(","))}" ${filteredSearchRows.length ? "" : "disabled"}>Seleccionar visibles</button>
            <button class="secondary-button" data-ops-action="bunch-search-deselect-visible" data-codes="${utils.esc(filteredSearchRows.map(item => item.labelCode).join(","))}" ${filteredSearchRows.length ? "" : "disabled"}>Deseleccionar visibles</button>
            <label class="compact-inline-field"><span>Nueva medida</span><select data-ops-ui-field="bunchSearchTargetLength"><option value="">Seleccione</option>${bulkLengthOptions.map(length => `<option value="${length}" ${String(store.ui.bunchSearchTargetLength) === String(length) ? "selected" : ""}>${length} cm</option>`).join("")}</select></label>
            <button class="primary-button" data-ops-action="bunch-search-apply-length" ${selectedSearchRows.length && store.ui.bunchSearchTargetLength ? "" : "disabled"}>Aplicar cambios y cerrar</button>
            <button class="secondary-button" data-ops-action="bunch-search-remove" ${selectedSearchRows.length ? "" : "disabled"}>Quitar seleccionadas de la lista</button>
            <button class="danger-button" data-ops-action="bunch-search-delete" ${selectedSearchRows.length ? "" : "disabled"}>Eliminar seleccionadas</button>
          </div>
          <div class="compact-table-wrap"><table class="compact-table ops-bunch-search-table">
            <thead><tr><th><span class="sr-only">Seleccionar</span></th><th>Codigo</th><th>Fecha / hora ingreso</th><th>Proveedor / bloque</th><th>Variedad</th><th>Medida actual</th><th>Tallos</th><th>Embonchador</th><th>Inventario</th><th>Estado</th></tr></thead>
            <tbody>${filteredSearchRows.map(item => `<tr>
              <td><input type="checkbox" aria-label="Seleccionar ramo ${utils.esc(item.labelCode)}" data-ops-bunch-search-select data-code="${utils.esc(item.labelCode)}" ${selectedSearchCodes.has(item.labelCode) ? "checked" : ""}></td>
              <td><strong>${utils.esc(item.labelCode)}</strong></td><td>${utils.esc(item.admittedAt || "-")}</td><td>${utils.esc(item.supplier)}<br><small>${utils.esc(item.block)}</small></td><td>${utils.esc(item.variety)}</td><td><strong>${utils.number(item.length)} cm</strong></td><td>${utils.number(item.stems || item.stemsPerBunch)}</td><td>${utils.esc(item.buncher || "-")}</td><td>${utils.esc(item.inventoryId)}</td><td><span class="status-badge ${inventoryTone(item.state)}">${utils.esc(item.state)}</span></td>
            </tr>`).join("") || `<tr><td colspan="10">Escanee o busque un ramo ya ingresado.</td></tr>`}</tbody>
          </table></div>
          <p class="ops-bunch-search-footer">Mostrando ${utils.number(filteredSearchRows.length)} de ${utils.number(searchRows.length)} resultado(s)</p>
        </article>
        </div>` : ""}
      </section>
      ${searchDialog ? `<div class="ops-mixed-modal-backdrop" data-ops-bunch-search-dialog role="dialog" aria-modal="true" aria-labelledby="ops-bunch-search-dialog-title">
        <article class="panel-card ops-bunch-search-dialog">
          <div class="panel-card-head"><div><p class="section-kicker">OPERACION MASIVA</p><h3 id="ops-bunch-search-dialog-title">${searchDialog === "DELETE" ? "Confirmar eliminacion" : "Confirmar actualizacion"}</h3></div><button class="ops-modal-close" type="button" data-ops-action="bunch-search-dialog-cancel" aria-label="Cerrar">X</button></div>
          ${searchDialog === "DELETE" ? `
            <div class="inline-feedback danger"><strong>Se anularan ${utils.number(selectedSearchRows.length)} etiqueta(s)</strong> - Los registros quedaran anulados y el inventario se actualizara.</div>
            <label class="compact-inline-field"><span>Motivo de eliminacion</span><textarea rows="3" data-ops-bunch-search-delete-reason placeholder="Escriba el motivo obligatorio">${utils.esc(store.ui.bunchSearchDeleteReason)}</textarea></label>
            <div class="table-actions-inline"><button class="danger-button" data-ops-action="bunch-search-delete-confirm" ${String(store.ui.bunchSearchDeleteReason || "").trim() ? "" : "disabled"}>Eliminar seleccionadas</button><button class="secondary-button" data-ops-action="bunch-search-dialog-cancel">Cancelar</button></div>
          ` : `
            <div class="inline-feedback warning"><strong>Se actualizaran ${utils.number(selectedSearchRows.length)} etiqueta(s) a ${utils.number(store.ui.bunchSearchTargetLength)} cm.</strong> - La etiqueta, el ingreso y el inventario relacionado se guardaran en una sola operacion.</div>
            <div class="table-actions-inline"><button class="primary-button" data-ops-action="bunch-search-update-confirm">Aplicar cambios y cerrar</button><button class="secondary-button" data-ops-action="bunch-search-dialog-cancel">Cancelar</button></div>
          `}
        </article>
      </div>` : ""}
      ${mixedDraft ? `<div class="ops-mixed-modal-backdrop" data-ops-mixed-composition role="dialog" aria-modal="true" aria-labelledby="ops-mixed-modal-title">
        <article class="panel-card ops-mixed-composition-card">
          <div class="panel-card-head"><div><p class="section-kicker">ETIQUETA MIXTA ${utils.esc(mixedDraft.code)}</p><h3 id="ops-mixed-modal-title">Composicion del bonche</h3></div><button class="ops-modal-close" type="button" data-ops-action="mixed-bunch-cancel" aria-label="Cerrar">×</button></div>
          <div class="inline-feedback warning"><strong>Pendiente de confirmacion</strong> · Este ramo no ingresara al inventario hasta completar y confirmar su composicion.</div>
          <p class="panel-note">Seleccione de uno a tres bloques. El proveedor se reconoce automaticamente y la suma debe completar ${utils.number(mixedDraft.expectedStems)} tallos.</p>
          <div class="ops-mixed-composition-head"><span>#</span><span>Bloque</span><span>Proveedor reconocido</span><span>Tallos</span></div>
          <div class="ops-mixed-composition-lines">
            ${mixedDraft.lines.map((line, index) => `<div class="ops-mixed-composition-line" data-mixed-line="${index}">
              <strong>${index + 1}</strong>
              <select data-ops-mixed-field="block" data-line-index="${index}"><option value="">Seleccione</option>${suppliers.map(item => `<option value="${utils.esc(item.assignedBlock)}" ${item.assignedBlock === line.block ? "selected" : ""}>${utils.esc(item.assignedBlock)}</option>`).join("")}</select>
              <input readonly data-mixed-supplier value="${utils.esc(line.supplier || "Seleccione un bloque")}">
              <input type="number" min="0" max="${utils.esc(mixedDraft.expectedStems)}" value="${utils.esc(line.stems)}" data-ops-mixed-field="stems" data-line-index="${index}" aria-label="Tallos proveedor ${index + 1}">
            </div>`).join("")}
          </div>
          <div class="ops-mixed-composition-summary">
            <div><span>Total bonche</span><strong>${utils.number(mixedDraft.expectedStems)}</strong></div>
            <div><span>Registrados</span><strong data-mixed-total>${utils.number(mixedTotal)}</strong></div>
            <div><span>Faltan</span><strong data-mixed-remaining>${utils.number(mixedRemaining)}</strong></div>
          </div>
          <p class="ops-enter-hint">Después de completar los tallos, presione <kbd>Enter</kbd> para confirmar.</p>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="mixed-bunch-confirm" data-mixed-confirm ${mixedTotal !== utils.parseNumber(mixedDraft.expectedStems) ? "disabled" : ""}>Confirmar e ingresar ramo</button><button class="secondary-button" data-ops-action="mixed-bunch-cancel">Cancelar</button></div>
        </article>
      </div>` : ""}
      ${BlessERP.operacionesRamosIngresados?.render?.(appState) || ""}
    `;
  }

  BlessERP.operacionesIngresoRamos = { isSearchPanelOpen, render, renderSession, setSearchPanelOpen };
})();
