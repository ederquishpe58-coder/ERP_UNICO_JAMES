(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const labelData = BlessERP.comercialLabelData;
  const labelUtils = BlessERP.comercialLabelsUtils;
  const utils = BlessERP.comercialUtils;

  function renderControls(order, appState, options = {}) {
    const documentData = labelUtils.buildDocumentData(order, appState, options.selection || {});
    const selection = documentData.selection;
    const showActions = options.showActions !== false;
    const cardMode = options.cardMode === true;

    return `
      <div class="commercial-doc-toolbar commercial-label-toolbar screen-only">
        <label class="compact-field">
          <span>Tipo impresion</span>
          <select data-commercial-label-mode>
            ${labelData.printModes.map(item => `
              <option value="${utils.esc(item.id)}" ${item.id === selection.printType ? "selected" : ""}>${utils.esc(item.label)}</option>
            `).join("")}
          </select>
        </label>
        <label class="compact-field">
          <span>Desde caja</span>
          <input type="number" min="1" value="${utils.esc(selection.fromBox)}" data-commercial-label-field="fromBox" ${selection.printType === "individual" ? "disabled" : ""}>
        </label>
        <label class="compact-field">
          <span>Hasta caja</span>
          <input type="number" min="1" value="${utils.esc(selection.toBox)}" data-commercial-label-field="toBox" ${selection.printType !== "range" ? "disabled" : ""}>
        </label>
        <label class="compact-field">
          <span>Caja individual</span>
          <input type="number" min="1" value="${utils.esc(selection.singleBox)}" data-commercial-label-field="singleBox" ${selection.printType !== "individual" ? "disabled" : ""}>
        </label>
      </div>
      <div class="hero-banner commercial-inline-banner commercial-label-banner screen-only">
        <div>
          <strong>Seleccion actual: ${utils.esc(labelData.printModes.find(item => item.id === selection.printType)?.label || "Todas")}</strong>
          <span>Se imprimiran ${utils.esc(selection.printCount)} etiquetas sobre ${utils.esc(documentData.summary.totalBoxes)} cajas detectadas.</span>
        </div>
        <span class="status-badge ${documentData.errors.length ? "cancelled" : documentData.warnings.length ? "pending" : "authorized"}">
          ${utils.esc(documentData.errors.length ? "Seleccion bloqueada" : documentData.warnings.length ? "Con advertencias" : "Lista")}
        </span>
      </div>
      ${showActions ? `
        <div class="table-actions-inline screen-only ${cardMode ? "commercial-print-inline-grid" : ""}">
          <button class="secondary-button" data-commercial-preview-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Vista previa</button>
          <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-all">Imprimir todas</button>
          <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-range">Imprimir rango</button>
          <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-individual">Reimprimir individual</button>
          <button class="secondary-button" data-commercial-doc-placeholder="pdf|ETIQUETAS">Descargar PDF</button>
          <button class="secondary-button" data-commercial-doc-placeholder="zebra|ETIQUETAS">Zebra futuro</button>
        </div>
      ` : ""}
      <p class="panel-note screen-only">${utils.esc(labelData.placeholders.zebra)}</p>
    `;
  }

  function renderSummaryCards(documentData) {
    return `
      <section class="summary-grid">
        <article class="summary-card">
          <span>Total cajas</span>
          <strong>${utils.esc(documentData.summary.totalBoxes)}</strong>
          <small>Base actual del Pedido Maestro</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas generadas</span>
          <strong>${utils.esc(documentData.summary.generatedCount)}</strong>
          <small>Una etiqueta por caja</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas con DAE</span>
          <strong>${utils.esc(documentData.summary.withDaeCount)}</strong>
          <small>Control aduanero demo</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas sin PO</span>
          <strong>${utils.esc(documentData.summary.withoutPoCount)}</strong>
          <small>Advertencia comercial</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas listas</span>
          <strong>${utils.esc(documentData.summary.readyCount)}</strong>
          <small>Sin errores criticos</small>
        </article>
        <article class="summary-card">
          <span>Advertencias</span>
          <strong>${utils.esc(documentData.summary.warningCount)}</strong>
          <small>PO, AWB/HAWB o barcode pendiente</small>
        </article>
      </section>
    `;
  }

  function renderIssues(documentData) {
    const items = documentData.errors.length ? documentData.errors : documentData.warnings;
    const label = documentData.errors.length ? "Error" : "Advertencia";
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ETIQUETAS</p>
            <h3>Validaciones de etiquetas</h3>
          </div>
          <span class="status-badge ${documentData.errors.length ? "cancelled" : documentData.warnings.length ? "pending" : "authorized"}">
            ${utils.esc(documentData.errors.length ? "Bloqueado" : documentData.warnings.length ? "Con advertencias" : "Listo")}
          </span>
        </div>
        <ul class="checklist-list">
          ${(items.length ? items : ["Sin errores ni advertencias para la seleccion actual."]).map(item => `<li><strong>${utils.esc(items.length ? `${label}:` : "Estado:")}</strong> ${utils.esc(item)}</li>`).join("")}
        </ul>
      </article>
    `;
  }

  function renderTable(documentData) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CONTROL DE ETIQUETAS</p>
            <h3>Etiquetas por caja</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table commercial-label-table">
            <thead>
              <tr>
                <th>Caja</th>
                <th>Tipo</th>
                <th>Marca</th>
                <th>PO</th>
                <th>Destino</th>
                <th>DAE</th>
                <th>AWB / HAWB</th>
                <th>Codigo aduana demo</th>
                <th>Codigo caja demo</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${documentData.rows.length ? documentData.rows.map(row => `
                <tr>
                  <td>${utils.esc(row.numero_caja)}</td>
                  <td>${utils.esc(row.tipo_caja)}</td>
                  <td>${utils.esc(row.marca || "-")}</td>
                  <td>${utils.esc(row.po || "-")}</td>
                  <td>${utils.esc(row.destino || "-")}</td>
                  <td>${utils.esc(row.dae || "-")}</td>
                  <td>${utils.esc([row.awb || "-", row.hawb || "-"].join(" / "))}</td>
                  <td>
                    <div class="commercial-label-code-cell">
                      <strong>${utils.esc(row.codigo_aduana)}</strong>
                      <small>${utils.esc(row.codigo_aduana_note)}</small>
                    </div>
                  </td>
                  <td><strong>${utils.esc(row.codigo_scanner_demo || "-")}</strong></td>
                  <td><span class="status-badge ${utils.esc(row.badgeTone)}">${utils.esc(row.estado_label)}</span></td>
                  <td>
                    <div class="table-actions-inline commercial-action-stack">
                      <button class="secondary-button" data-commercial-preview-doc="ETIQUETAS" data-commercial-doc-options='{"printType":"individual","singleBox":${Number(row.numero_caja)}}'>Ver</button>
                      <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options='{"printType":"individual","singleBox":${Number(row.numero_caja)}}'>Imprimir</button>
                    </div>
                  </td>
                </tr>
              `).join("") : `<tr><td colspan="11">No existen cajas para generar etiquetas.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderPrintDocument(order, appState, options = {}, existingDocumentData = null) {
    const documentData = existingDocumentData || labelUtils.buildDocumentData(order, appState, options);
    const normalizedOrder = utils.normalizeOrder(order);
    const brand = utils.findBrand(normalizedOrder.brandId);

    if (!documentData.selectedRows.length) {
      return `
        <article class="doc-page doc-label-page">
          <h2 class="doc-title">Etiquetas de caja</h2>
          <p class="doc-subtitle">No existen etiquetas para la seleccion actual.</p>
        </article>
      `;
    }

    return `
      <article class="doc-page doc-label-page">
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Etiquetas comerciales demo</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">ETIQUETAS DE CAJA</h2>
            <p class="doc-subtitle">Una etiqueta por caja. Impresion demo por todas, rango o individual.</p>
          </div>
          <div class="doc-box">
            <h4>Seleccion actual</h4>
            ${BlessERP.comercialPrintUtils.renderInfoRows([
              ["Pedido", normalizedOrder.number],
              ["Marca", brand?.name || "-"],
              ["Tipo impresion", labelData.printModes.find(item => item.id === documentData.selection.printType)?.label || "Todas"],
              ["Etiquetas", `${documentData.selection.printCount} de ${documentData.summary.totalBoxes}`],
              ["Destino", normalizedOrder.destination || "-"],
              ["Fecha vuelo", utils.dateLabel(normalizedOrder.flightDate)]
            ])}
          </div>
        </div>
        <div class="doc-stamp referential">Referencial</div>
        <section class="print-label-sheet">
          ${documentData.selectedRows.map(row => `
            <section class="box-label">
              <header class="box-label-header">
                <div>
                  <span class="doc-kicker">Etiqueta comercial demo</span>
                  <strong>BLESS FLOWER</strong>
                  <span class="doc-muted">Pedido No. ${utils.esc(normalizedOrder.number)}</span>
                  ${row.invoice_packing_no ? `<span class="doc-muted">Invoice / Packing No. ${utils.esc(row.invoice_packing_no)}</span>` : ""}
                </div>
                <div class="doc-inline-status">
                  <span>Box ${utils.esc(row.numero_caja)} / ${utils.esc(row.total_cajas)}</span>
                  <span>${utils.esc(row.tipo_caja)}</span>
                </div>
              </header>
              <div class="box-label-body">
                <div class="box-label-grid">
                  <div><span>Cliente final / marca</span><strong>${utils.esc(row.marca || "-")}</strong></div>
                  <div><span>PO / marcacion</span><strong>${utils.esc(row.po || "-")}</strong></div>
                  <div><span>Destino</span><strong>${utils.esc(row.destino || "-")}</strong></div>
                  <div><span>Pais</span><strong>${utils.esc(row.pais || "-")}</strong></div>
                  <div><span>DAE</span><strong>${utils.esc(row.dae || "-")}</strong></div>
                  <div><span>AWB / HAWB</span><strong>${utils.esc([row.awb || "-", row.hawb || "-"].join(" / "))}</strong></div>
                  <div><span>Agencia</span><strong>${utils.esc(row.agencia_carga || "-")}</strong></div>
                  <div><span>Carrier / vuelo</span><strong>${utils.esc([row.carrier || "-", row.vuelo || "-"].join(" / "))}</strong></div>
                  <div><span>Fecha vuelo</span><strong>${utils.esc(utils.dateLabel(row.fecha_vuelo))}</strong></div>
                  <div><span>Estado</span><strong>${utils.esc(row.estado_label)}</strong></div>
                  <div><span>Codigo caja demo</span><strong>${utils.esc(row.codigo_scanner_demo || "-")}</strong></div>
                  <div><span>Revision etiqueta</span><strong>R${utils.esc(row.revision_etiqueta || 1)}</strong></div>
                </div>
                <div class="customs-code-callout">
                  <strong>${utils.esc(row.codigo_aduana)}</strong>
                  <span>${utils.esc(row.codigo_aduana_note)}</span>
                </div>
                <section class="box-label-content">
                  <strong>Contenido resumido de la caja</strong>
                  <div class="label-content-list">
                    ${row.contenido_lineas.map(line => `
                      <div class="label-content-row">
                        <span>${utils.esc(line.variety)} ${utils.esc(line.length)} cm</span>
                        <span>${utils.esc(utils.number(line.bunches))} ramo</span>
                        <span>${utils.esc(utils.number(line.stemsPerBunch))} tallos</span>
                        <strong>${utils.esc(utils.number(line.totalStems))} total</strong>
                      </div>
                    `).join("")}
                  </div>
                </section>
                <div class="doc-label-grid">
                  <div class="barcode-placeholder">
                    <strong>${utils.esc(labelData.placeholders.barcode)}</strong>
                    <span>${utils.esc(row.codigo_scanner_demo || row.barcode_value_futuro || "Pendiente")}</span>
                  </div>
                  <div class="qr-placeholder">
                    <strong>${utils.esc(labelData.placeholders.qr)}</strong>
                    <span>${utils.esc(row.qr_value_futuro || "Pendiente")}</span>
                  </div>
                </div>
              </div>
              <footer class="box-label-footer">
                <span>Observacion: ${utils.esc(row.observacion || "Sin observacion.")}</span>
                <span>${utils.esc(labelData.placeholders.zebra)}</span>
              </footer>
            </section>
          `).join("")}
        </section>
      </article>
    `;
  }

  function renderWorkspace(order, appState) {
    const documentData = labelUtils.buildDocumentData(order, appState, labelUtils.getCurrentSelection(appState));
    return `
      ${renderSummaryCards(documentData)}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ETIQUETAS</p>
              <h3>Preparacion e impresion de etiquetas</h3>
            </div>
            <span class="status-badge ${documentData.errors.length ? "cancelled" : documentData.warnings.length ? "pending" : "authorized"}">
              ${utils.esc(documentData.errors.length ? "Bloqueado" : documentData.warnings.length ? "Con advertencias" : "Listo")}
            </span>
          </div>
          <p class="panel-note">Cada caja genera una etiqueta demo con codigo aduana placeholder, barcode/QR visual y filtro por todas, rango o individual.</p>
          ${renderControls(order, appState)}
        </article>
        ${renderIssues(documentData)}
      </section>
      ${renderTable(documentData)}
      ${BlessERP.comercialPrintSystem.renderWorkspace("ETIQUETAS", order, appState, {
        title: "Vista previa de etiquetas",
        description: "La vista previa usa la seleccion actual del Pedido Maestro. Puede imprimirse completa, por rango o reimprimir una caja.",
        options: labelUtils.getCurrentSelection(appState),
        controlsMarkup: "",
        actionsMarkup: `
          <div class="table-actions-inline screen-only">
            <button class="secondary-button" data-commercial-preview-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Vista previa emergente</button>
            <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Imprimir seleccion actual</button>
            <button class="secondary-button" data-commercial-doc-placeholder="zebra|ETIQUETAS">Zebra futuro</button>
          </div>
        `,
        footerNote: labelData.placeholders.zebra
      })}
    `;
  }

  BlessERP.comercialLabels = {
    buildDocumentData: labelUtils.buildDocumentData,
    buildLabelContract: labelUtils.buildLabelRows,
    getCurrentSelection: labelUtils.getCurrentSelection,
    renderControls,
    renderPrintDocument,
    renderWorkspace,
    validatePrintRequest: labelUtils.validatePrintRequest
  };
})();
