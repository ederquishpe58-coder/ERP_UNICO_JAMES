(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  function documentMap() {
    return BlessERP.comercialPrintDocs || {};
  }

  function getDefinition(docCode) {
    return documentMap()[docCode] || documentMap().RESUMEN || null;
  }

  function getDocumentReport(docCode, order, appState, options = {}) {
    const definition = getDefinition(docCode);
    const context = printUtils.buildContext(order, appState, options);
    const baseValidation = definition?.validate
      ? definition.validate(context, options)
      : { errors: [], warnings: [] };
    const workflowValidation = BlessERP.comercialWorkflow?.canExecuteDocumentAction
      ? BlessERP.comercialWorkflow.canExecuteDocumentAction(docCode, context.order, appState, "preview", options)
      : { errors: [], warnings: [] };
    const validation = {
      errors: [...new Set([...(baseValidation.errors || []), ...(workflowValidation.errors || [])])],
      warnings: [...new Set([...(baseValidation.warnings || []), ...(workflowValidation.warnings || [])])]
    };
    const status = printUtils.buildDocumentStatus(validation.errors, validation.warnings);

    return {
      definition,
      context,
      validation,
      status,
      options
    };
  }

  function renderDocument(docCode, order, appState, options = {}) {
    const report = getDocumentReport(docCode, order, appState, options);
    if (!report.definition) {
      return `
        <article class="doc-page">
          <h2 class="doc-title">Documento no registrado</h2>
          <p class="doc-subtitle">${utils.esc(docCode)}</p>
        </article>
      `;
    }
    const presentation = BlessERP.comercialWorkflow?.getDocumentPresentation
      ? BlessERP.comercialWorkflow.getDocumentPresentation(report.context.order, docCode, options)
      : null;
    const ribbon = presentation
      ? `<div class="doc-state-ribbon ${utils.esc(presentation.tone)}">${utils.esc(presentation.label)}</div>`
      : "";
    return `${ribbon}${report.definition.render(report.context, options, report.validation, report.status)}`;
  }

  function renderPreviewMarkup(docCode, orders, appState, options = {}) {
    const list = Array.isArray(orders) ? orders : [];
    if (!list.length) {
      return `
        <div class="print-shell">
          <article class="doc-page">
            <h2 class="doc-title">Sin pedidos seleccionados</h2>
            <p class="doc-subtitle">No hay informacion disponible para generar el preview.</p>
          </article>
        </div>
      `;
    }

    return `
      <div class="print-shell">
        ${list.map(order => renderDocument(docCode, order, appState, options)).join("")}
      </div>
    `;
  }

  function openPreview(docCode, orders, appState, config = {}) {
    const definition = getDefinition(docCode);
    const win = window.open("", "_blank", "width=1280,height=900");
    if (!win) {
      BlessERP.layout.toast("El navegador bloqueo la ventana de preview.");
      return false;
    }

    const pageSize = config.pageSize || config.options?.pageSize || "A4";
    const markup = renderPreviewMarkup(docCode, orders, appState, config.options || {});
    win.document.open();
    win.document.write(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <title>${utils.esc(definition?.name || docCode)}</title>
          ${printUtils.previewStylesheetTags(pageSize)}
        </head>
        <body data-print-preview="true" data-print-size="${utils.esc(pageSize)}">
          ${markup}
        </body>
      </html>
    `);
    win.document.close();

    if (config.autoPrint) {
      win.focus();
      win.print();
    }
    return true;
  }

  function renderValidationSummary(report) {
    const issues = report.validation.errors.length
      ? report.validation.errors
      : report.validation.warnings;
    const emptyMessage = report.validation.errors.length || report.validation.warnings.length
      ? ""
      : `<div class="base-ready-item"><strong>Estado</strong><span>El documento esta listo para vista previa.</span></div>`;

    return `
      <div class="base-ready-list commercial-document-state">
        ${report.validation.errors.map(item => `
          <div class="base-ready-item">
            <strong>Error</strong>
            <span>${utils.esc(item)}</span>
          </div>
        `).join("")}
        ${!report.validation.errors.length ? report.validation.warnings.map(item => `
          <div class="base-ready-item">
            <strong>Advertencia</strong>
            <span>${utils.esc(item)}</span>
          </div>
        `).join("") : ""}
        ${emptyMessage}
      </div>
    `;
  }

  function defaultActions(docCode) {
    return `
      <div class="table-actions-inline">
        <button class="secondary-button" data-commercial-preview-doc="${utils.esc(docCode)}">Vista previa</button>
        <button class="secondary-button" data-commercial-print-doc="${utils.esc(docCode)}">Imprimir</button>
      </div>
    `;
  }

  function renderWorkspace(docCode, order, appState, config = {}) {
    const report = getDocumentReport(docCode, order, appState, config.options || {});
    const definition = report.definition || { name: docCode, description: "" };
    const actionsMarkup = config.actionsMarkup || defaultActions(docCode);
    const controlsMarkup = config.controlsMarkup || "";
    const footerNote = config.footerNote || "Factura cliente y facturacion SRI se implementaran en una fase posterior. Los documentos actuales son comerciales/logisticos y de revision.";

    return `
      <section class="panel-card commercial-print-preview">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CENTRO DE IMPRESION</p>
            <h3>${utils.esc(config.title || definition.name)}</h3>
          </div>
          <span class="status-badge ${report.status.tone}">${utils.esc(report.status.label)}</span>
        </div>
        <p class="panel-note">${utils.esc(config.description || definition.description || "")}</p>
        ${controlsMarkup}
        ${renderValidationSummary(report)}
        <div class="commercial-document-frame">
          ${renderDocument(docCode, order, appState, config.options || {})}
        </div>
        ${actionsMarkup}
        <p class="panel-note commercial-legal-note">${utils.esc(footerNote)}</p>
      </section>
    `;
  }

  BlessERP.comercialPrintSystem = {
    getDefinition,
    getDocumentReport,
    openPreview,
    renderDocument,
    renderPreviewMarkup,
    renderWorkspace
  };
})();
