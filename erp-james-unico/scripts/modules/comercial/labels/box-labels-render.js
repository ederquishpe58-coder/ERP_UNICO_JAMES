(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const labelData = BlessERP.comercialLabelData;
  const labelUtils = BlessERP.comercialLabelsUtils;
  const utils = BlessERP.comercialUtils;

  function assetUrl(relativePath) {
    try {
      return new URL(relativePath, document.baseURI).href;
    } catch (error) {
      return relativePath;
    }
  }

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
          <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-all">PDF de todas</button>
          <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-range">PDF por rango</button>
          <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-individual">PDF individual</button>
          <button class="secondary-button" data-commercial-download-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Descargar PDF para Adobe</button>
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
        <small>Base actual de Crear pedido</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas generadas</span>
          <strong>${utils.esc(documentData.summary.generatedCount)}</strong>
          <small>Una etiqueta por caja</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas con DAE</span>
          <strong>${utils.esc(documentData.summary.withDaeCount)}</strong>
          <small>Con codigo de barras DAE</small>
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
          <small>Datos logisticos pendientes</small>
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

  function renderProductRows(row) {
    const content = Array.isArray(row.contenido_lineas) ? row.contenido_lineas : [];
    const minimumRows = 6;
    const blankRows = Array.from({ length: Math.max(0, minimumRows - content.length) }, () => null);
    return [...content, ...blankRows].map(line => line
      ? `<tr><td>${utils.esc(String(line.variety || "-").toUpperCase())}</td><td>${utils.esc(line.length)} cm</td><td>${utils.esc(BlessERP.flowerQuality?.label?.(line.quality) || "SIN CALIDAD")}</td><td>${utils.esc(utils.number(line.bunches))}</td><td>${utils.esc(utils.number(line.totalStems))}</td></tr>`
      : `<tr class="customs-product-empty-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>`
    ).join("");
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
                <th>Codigo DAE</th>
                <th>Codigo caja</th>
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
                      <strong>${utils.esc(row.dae_barcode || "-")}</strong>
                      <small>${utils.esc(row.dae || "Sin DAE")}</small>
                    </div>
                  </td>
                  <td><strong>${utils.esc(row.codigo_scanner_demo || "-")}</strong></td>
                  <td><span class="status-badge ${utils.esc(row.badgeTone)}">${utils.esc(row.estado_label)}</span></td>
                  <td>
                    <div class="table-actions-inline commercial-action-stack">
                      <button class="secondary-button" data-commercial-preview-doc="ETIQUETAS" data-commercial-doc-options='{"printType":"individual","singleBox":${Number(row.numero_caja)}}'>Ver</button>
                      <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options='{"printType":"individual","singleBox":${Number(row.numero_caja)}}'>Descargar PDF</button>
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
    const company = BlessERP.services?.companyBranding?.resolveForOrder?.(order)
      || BlessERP.comercialData.company;

    if (!documentData.selectedRows.length) {
      return `
        <article class="doc-page doc-label-page">
          <h2 class="doc-title">Etiquetas de caja</h2>
          <p class="doc-subtitle">No existen etiquetas para la seleccion actual.</p>
        </article>
      `;
    }

    return `
      <section class="customs-label-sheet">
        ${documentData.selectedRows.map(row => `
          <article class="customs-shipping-label">
            <div class="customs-label-canvas">
              <header class="customs-label-top">
                <div class="customs-aduana-logo" role="img" aria-label="Aduana del Ecuador">
                  <img src="${utils.esc(assetUrl("scripts/assets/aduana-ecuador-logo.png"))}" alt="Aduana del Ecuador">
                </div>
                ${row.dae ? `<div class="customs-dae-bars">${BlessERP.code128.barcodeSvg(row.dae, { className: "customs-dae-barcode", height: 64, quietZone: 14 })}</div><strong class="customs-dae-number">${utils.esc(row.dae_barcode)}</strong>` : `<div class="customs-dae-bars"><strong>DAE PENDIENTE</strong></div><strong class="customs-dae-number">SIN CÓDIGO DE BARRAS</strong>`}
                <div class="customs-destination-country">PAIS DESTINO: <strong>${utils.esc(String(row.pais || row.destino || "").toUpperCase())}</strong></div>
              </header>

              <section class="customs-label-frame">
                <div class="customs-label-details">
                  <div class="customs-address-block">
                    <p><b>FROM:</b><strong>${utils.esc(String(
                      /bless/i.test(`${company.company_key || company.id || ""} ${company.commercialName || ""}`)
                        ? `${company.legalName || company.commercialName || "Empresa"} (BLESS FLOWER)`
                        : (company.legalName || company.commercialName || "Empresa")
                    ).toUpperCase())}</strong></p>
                    <p><b>RUC:</b><strong>${utils.esc(company.ruc || "-")}</strong></p>
                    <p><b>TO:</b><strong>${utils.esc(String(row.marca || row.destino || "-").toUpperCase())}</strong></p>
                  </div>

                  <div class="customs-logistics-block">
                    <p><b>PO:</b><strong>${utils.esc(row.po || "-")}</strong></p>
                    <p><b>INVOICE:</b><strong>${utils.esc(row.invoice_no || "-")}</strong></p>
                    <p><b>${row.transport_type === "maritimo" ? "GUÍA MADRE" : "AWB"}:</b><strong>${utils.esc(row.awb || "-")}</strong></p>
                    <p><b>${row.transport_type === "maritimo" ? "GUÍA HIJA" : "HAWB"}:</b><strong>${utils.esc(row.hawb || "-")}</strong></p>
                    <p class="customs-box-line"><span><b>BOX #:</b><strong>${utils.esc(row.numero_caja)}</strong></span></p>
                  </div>
                </div>

                <div class="customs-products-space">
                  <table class="customs-products-table ${row.contenido_lineas.length > 6 ? "is-dense" : ""}">
                    <thead><tr><th>PRODUCTO/VARIETY</th><th>GRADE</th><th>CALIDAD</th><th>BUNCH</th><th>STEMS</th></tr></thead>
                    <tbody>${renderProductRows(row)}</tbody>
                    <tfoot><tr><td colspan="3">TOTAL BUNCHS / STEMS</td><td>${utils.esc(utils.number(row.total_ramos))}</td><td>${utils.esc(utils.number(row.total_tallos))}</td></tr></tfoot>
                  </table>
                </div>

                <div class="customs-label-bottom">
                  <strong>PRODUCT GROWN IN ECUADOR</strong>
                  <div class="customs-label-bottom-logistics">
                    <p>AGENCY: ${utils.esc(String(row.agencia_carga || "-").toUpperCase())}</p>
                    <p>COLD ROOM: ${utils.esc(String(row.cuarto_frio || "-").toUpperCase())}</p>
                  </div>
                  <small>${utils.esc(row.pedido_numero)} / INVOICE ${utils.esc(row.invoice_no || "-")}</small>
                </div>
              </section>
            </div>
          </article>
        `).join("")}
      </section>
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
          <p class="panel-note">Cada caja genera un PDF vertical de 10 x 16 cm para Zebra ZD220: 100 mm de ancho por 160 mm de alto, con margen de página 0. La impresión se realiza desde Adobe Acrobat en Tamaño real / 100 %.</p>
          ${renderControls(order, appState)}
        </article>
        ${renderIssues(documentData)}
      </section>
      ${renderTable(documentData)}
      ${BlessERP.comercialPrintSystem.renderWorkspace("ETIQUETAS", order, appState, {
        title: "Vista previa de etiquetas",
      description: "La vista previa usa la seleccion actual de Crear pedido. Puede imprimirse completa, por rango o reimprimir una caja.",
        options: labelUtils.getCurrentSelection(appState),
        controlsMarkup: "",
        actionsMarkup: `
          <div class="table-actions-inline screen-only">
            <button class="secondary-button" data-commercial-preview-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Vista previa emergente</button>
            <button class="primary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Descargar PDF seleccionado</button>
            <button class="secondary-button" data-commercial-download-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">PDF para Adobe</button>
          </div>
        `,
        footerNote: "La impresión logística marítima puede indicar DAE pendiente; CONTROL_DAE continúa exigiendo una DAE real."
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
