(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const utils = BlessERP.comercialUtils;

  function renderDocumentIssues(report) {
    const items = report.validation.errors.length
      ? report.validation.errors
      : report.validation.warnings;

    if (!items.length) {
      return `
        <div class="base-ready-list commercial-print-card-list">
          <div class="base-ready-item">
            <strong>Datos faltantes</strong>
            <span>Sin faltantes para la vista previa actual.</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="base-ready-list commercial-print-card-list">
        ${items.map(item => `
          <div class="base-ready-item">
            <strong>${report.validation.errors.length ? "Error" : "Advertencia"}</strong>
            <span>${utils.esc(item)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function getReportForDoc(doc, order, appState) {
    if (doc.code === "ETIQUETAS") {
      return BlessERP.comercialPrintSystem.getDocumentReport(
        doc.code,
        order,
        appState,
        BlessERP.comercialLabels.getCurrentSelection(appState)
      );
    }
    if (doc.code === "COMMERCIAL_INVOICE_CLIENT") {
      return BlessERP.comercialPrintSystem.getDocumentReport(
        doc.code,
        order,
        appState,
        BlessERP.comercialClientInvoice.getCurrentOptions(appState)
      );
    }
    return BlessERP.comercialPrintSystem.getDocumentReport(doc.code, order, appState);
  }

  function renderLabelCard(order, appState, doc, report) {
    const documentData = BlessERP.comercialLabels.buildDocumentData(
      order,
      appState,
      BlessERP.comercialLabels.getCurrentSelection(appState)
    );

    return `
      <article class="panel-card commercial-print-card commercial-print-card-wide">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CENTRO DE IMPRESION</p>
            <h3>${utils.esc(doc.name)}</h3>
          </div>
          <span class="status-badge ${report.status.tone}">${utils.esc(report.status.label)}</span>
        </div>
        <p class="panel-note">Una etiqueta por caja con codigo aduana demo, barcode / QR placeholder e impresion por todas, rango o individual.</p>
        <div class="info-stack commercial-print-card-meta">
          <div class="info-row"><strong>Pedido activo</strong><span>${utils.esc(order?.number || "-")}</span></div>
          <div class="info-row"><strong>Total etiquetas</strong><span>${utils.esc(documentData.summary.totalBoxes)}</span></div>
          <div class="info-row"><strong>Seleccion actual</strong><span>${utils.esc(documentData.selection.printCount)} etiquetas</span></div>
          <div class="info-row"><strong>Estado general</strong><span>${utils.esc(documentData.errors.length ? "Bloqueado" : documentData.warnings.length ? "Con advertencias" : "Listo")}</span></div>
        </div>
        ${BlessERP.comercialLabels.renderControls(order, appState, { cardMode: true })}
        ${renderDocumentIssues(report)}
      </article>
    `;
  }

  function renderPrintCards(order, appState) {
    const cards = data.printDocs.map(doc => {
      const report = getReportForDoc(doc, order, appState);
      if (doc.code === "COMMERCIAL_INVOICE_CLIENT") {
        return BlessERP.comercialClientInvoice.renderCard(order, appState, doc, report);
      }
      if (doc.code === "ETIQUETAS") {
        return renderLabelCard(order, appState, doc, report);
      }
      return `
        <article class="panel-card commercial-print-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CENTRO DE IMPRESION</p>
              <h3>${utils.esc(doc.name)}</h3>
            </div>
            <span class="status-badge ${report.status.tone}">${utils.esc(report.status.label)}</span>
          </div>
          <p class="panel-note">${utils.esc(report.definition?.description || "Documento demo del flujo comercial.")}</p>
          <div class="info-stack commercial-print-card-meta">
            <div class="info-row"><strong>Estado base</strong><span>${utils.esc(doc.mode)}</span></div>
            <div class="info-row"><strong>Pedido activo</strong><span>${utils.esc(order?.number || "-")}</span></div>
          </div>
          ${renderDocumentIssues(report)}
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-preview-doc="${utils.esc(doc.code)}">Vista previa</button>
            <button class="secondary-button" data-commercial-print-doc="${utils.esc(doc.code)}">Imprimir</button>
            <button class="secondary-button" data-commercial-doc-placeholder="pdf|${utils.esc(doc.code)}">Descargar PDF</button>
            <button class="secondary-button" data-commercial-doc-placeholder="email|${utils.esc(doc.code)}">Enviar por correo</button>
          </div>
        </article>
      `;
    }).join("");

    return `
      <section class="placeholder-grid commercial-print-grid">
        ${cards}
      </section>
    `;
  }

  function renderPrintCenter(order, appState) {
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Centro de impresion</h1>
          <p>Salida demo centralizada para invoice, packing, HR, MP, etiquetas, resumen, control DAE y requerimiento de bodega. No genera PDF real ni SRI.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Documentos demo activos</span>
        </div>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Pedido activo: ${utils.esc(order?.number || "-")}</strong>
          <span>Todos los previews salen desde el Pedido Maestro actual. Impresion Zebra y codigo de barras real se implementaran en una fase posterior.</span>
        </div>
      </section>
      ${renderPrintCards(order, appState)}
    `;
  }

  BlessERP.comercialPrint = {
    renderDocumentIssues,
    renderPrintCards,
    renderPrintCenter
  };
})();
