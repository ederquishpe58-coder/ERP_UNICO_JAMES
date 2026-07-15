(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function resultTone(result) {
    if (result === "INVENTARIO_CREADO") return "authorized";
    if (result === "PENDIENTE_COMPOSICION") return "pending";
    if (result === "DUPLICADO") return "partial";
    return "pending";
  }

  function render(appState, route) {
    const stateApi = BlessERP.operacionesState;
    const utils = BlessERP.operacionesUtils;
    const store = stateApi.getStore(appState);
    const draft = store.ui.bunchIntakeDraft;
    const last = store.ui.lastBunchIntakeResult;
    const mixedDraft = store.ui.mixedBunchIntakeDraft;
    const suppliers = (store.masterData?.suppliers || []).filter(item => item.active !== false && item.assignedBlock);
    const mixedTotal = (mixedDraft?.lines || []).reduce((sum, item) => sum + utils.parseNumber(item.stems), 0);
    const mixedRemaining = Math.max(utils.parseNumber(mixedDraft?.expectedStems) - mixedTotal, 0);
    const numericLabels = store.labelBatches.filter(item => /^\d{10}$/.test(String(item.code || "")));
    const availableLabels = numericLabels.filter(item => !["ESCANEADA", "ANULADA", "OBSERVADA"].includes(item.state));
    const entries = (store.bunchEntries || []).filter(item => item.state === "INGRESADO_POR_ESCANEO");
    const reportApi = BlessERP.operacionesRamosReportXlsx;
    const report = reportApi?.getReportData(appState, {
      from: store.ui.bunchReportFrom,
      to: store.ui.bunchReportTo
    }) || { records: [], byBlock: new Map(), period: "PERIODO SIN DEFINIR", range: "RANGO SIN DEFINIR", validationError: "Generador XLSX no disponible." };
    const reportStems = report.records.reduce((sum, item) => sum + Number(item.stems || 0), 0);
    const reportMixed = report.records.filter(item => item.type === "MIXTA").length;

    return `
      ${utils.renderPageHeader(route, "Ingreso por escaneo activo demo", "authorized", "Estacion exclusiva donde una etiqueta valida se convierte en un ramo de inventario.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(store.ui)}
      <section class="hero-banner">
        <div>
          <strong>La etiqueta no es inventario</strong>
          <span>El inventario nace solamente en el primer escaneo valido. La fecha oficial es la fecha y hora de esta lectura.</span>
        </div>
      </section>
      ${utils.renderSummaryCards([
        { label: "Etiquetas utilizables", value: utils.number(availableLabels.length), help: "Generadas o impresas" },
        { label: "Ramos ingresados", value: utils.number(entries.length), help: "Solo escaneos validos" },
        { label: "Inventario por escaneo", value: utils.number(store.roseInventory.filter(item => item.sourceType === "ESCANEO_ETIQUETA").length), help: "Una fila por ramo" },
        { label: "Ultimo resultado", value: last?.result || "SIN LECTURA", help: last?.code || "Esperando codigo" }
      ])}
      <section class="placeholder-grid">
        <article class="panel-card ops-scanner-station">
          <div class="panel-card-head"><div><p class="section-kicker">ESTACION DE CORTE Y ENCAPUCHONADO</p><h3>Escanear etiqueta del ramo</h3></div><span class="status-badge partial">Teclado HID demo</span></div>
          <p class="panel-note">Enfoque el campo y escanee. Una etiqueta NORMAL ingresa inmediatamente. Una etiqueta MIXTA abre su composicion antes de crear inventario.</p>
          <div class="ops-form-grid">
            <label class="compact-inline-field ops-form-span-2"><span>Codigo numerico de 10 digitos</span><input class="ops-scan-input" inputmode="numeric" maxlength="10" autocomplete="off" autofocus value="${utils.esc(draft.code)}" data-ops-bind="bunchIntakeDraft" data-field="code" data-ops-bunch-intake placeholder="0000000002"></label>
            <label class="compact-inline-field"><span>Responsable</span><select data-ops-bind="bunchIntakeDraft" data-field="responsible">${store.catalogs.responsibles.map(item => `<option value="${utils.esc(item)}" ${item === draft.responsible ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
            <label class="compact-inline-field"><span>Observacion</span><input value="${utils.esc(draft.observation)}" data-ops-bind="bunchIntakeDraft" data-field="observation"></label>
          </div>
          <div class="table-actions-inline">
            <button class="primary-button" data-ops-action="bunch-intake-scan">Registrar ingreso por escaneo</button>
            <button class="secondary-button" data-ops-action="bunch-intake-example">Cargar 0000000002</button>
            <button class="secondary-button" data-ops-action="bunch-intake-reset">Limpiar</button>
          </div>
          ${last ? `<div class="inline-feedback ${last.ok ? "success" : "warning"}"><strong>${utils.esc(last.result)}</strong> · ${utils.esc(last.observation)}</div>` : ""}
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">VALIDACIONES</p><h3>Control del primer escaneo</h3></div></div>
          <ul class="checklist-list">
            <li>Codigo existente y exactamente de 10 digitos.</li>
            <li>Etiqueta no anulada ni observada.</li>
            <li>Etiqueta no escaneada anteriormente.</li>
            <li>Duplicados generan evento, pero nunca otro ramo.</li>
            <li>La etiqueta normal pasa sin confirmacion adicional.</li>
            <li>La etiqueta mixta exige de uno a tres proveedores y suma exacta de tallos.</li>
            <li>Variedad, longitud, tallos y embonchador se recuperan de la etiqueta.</li>
          </ul>
        </article>
      </section>
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
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">ULTIMOS INGRESOS</p><h3>Ramos creados mediante escaneo</h3></div></div>
        <div class="compact-table-wrap"><table class="compact-table">
          <thead><tr><th>Fecha/hora ingreso</th><th>Codigo</th><th>Tipo / composicion</th><th>Proveedor</th><th>Variedad</th><th>Longitud</th><th>Tallos</th><th>Embonchador</th><th>Inventario</th><th>Estado</th></tr></thead>
          <tbody>${entries.slice(0, 30).map(item => `<tr>
            <td>${utils.esc(item.registeredAt || "-")}</td><td>${utils.esc(item.code)}</td><td>${item.composition?.length ? `<strong>MIXTA</strong><br><small>${utils.esc(item.composition.map(part => `${part.block}: ${part.stems}`).join(" · "))}</small>` : "NORMAL"}</td><td>${utils.esc(item.supplier)}</td><td>${utils.esc(item.variety)}</td>
            <td>${utils.esc(item.length)} cm</td><td>${utils.esc(item.stemsPerBunch)}</td><td>${utils.esc(item.buncher)}</td><td>${utils.esc(item.inventoryId)}</td>
            <td><span class="status-badge ${resultTone(item.state)}">${utils.esc(item.state)}</span></td>
          </tr>`).join("") || `<tr><td colspan="10">Todavia no existen ramos ingresados por escaneo.</td></tr>`}</tbody>
        </table></div>
      </section>
      <section class="panel-card ops-reception-history-panel">
        <div class="panel-card-head"><div><p class="section-kicker">REPORTE OPERATIVO</p><h3>Excel de ramos escaneados</h3></div><span class="status-badge authorized">XLSX multihoja</span></div>
        <p class="panel-note">El reporte toma la fecha oficial de escaneo. Incluye Ramos escaneados, Resumen proveedores y una hoja individual por cada bloque encontrado.</p>
        <div class="ops-form-grid">
          <label class="compact-inline-field"><span>Desde</span><input type="date" value="${utils.esc(store.ui.bunchReportFrom)}" data-ops-ui-field="bunchReportFrom"></label>
          <label class="compact-inline-field"><span>Hasta</span><input type="date" value="${utils.esc(store.ui.bunchReportTo)}" data-ops-ui-field="bunchReportTo"></label>
          <div class="base-ready-item ops-form-span-2"><strong>${utils.esc(report.period)}</strong><span>${utils.esc(report.range)}</span></div>
        </div>
        <div class="ops-inline-metrics">
          <div class="base-ready-item"><strong>Ramos fisicos</strong><span>${utils.number(report.records.length)} registros</span></div>
          <div class="base-ready-item"><strong>Tallos escaneados</strong><span>${utils.number(reportStems)} tallos</span></div>
          <div class="base-ready-item"><strong>Hojas del archivo</strong><span>${utils.number(2 + report.byBlock.size)} hojas · ${utils.number(reportMixed)} mixtos</span></div>
        </div>
        ${report.validationError ? `<div class="inline-feedback warning"><strong>Rango no valido</strong> · ${utils.esc(report.validationError)}</div>` : ""}
        <div class="table-actions-inline"><button class="primary-button" data-ops-action="bunch-report-export-xlsx" ${report.validationError || !report.records.length ? "disabled" : ""}>Descargar reporte Excel</button></div>
        <p class="panel-note ops-reception-note">Cada hoja lleva logo BLESS FLOWER, periodo y rango. Un bonche mixto ocupa una sola fila principal; sus tallos se distribuyen entre las hojas de sus bloques sin duplicar el bonche.</p>
      </section>
    `;
  }

  BlessERP.operacionesIngresoRamos = { render };
})();
