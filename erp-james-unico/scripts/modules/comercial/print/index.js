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

  function defaultPageSize(docCode) {
    if (docCode === "ETIQUETAS") return "CUSTOMS_LABEL";
    if (["INVOICE_PACKING_REFERENCIAL", "INVOICE_PACKING_REAL"].includes(docCode)) return "LETTER";
    return "A4";
  }

  function getDocumentReport(docCode, order, appState, options = {}, action = "preview") {
    const definition = getDefinition(docCode);
    const context = printUtils.buildContext(order, appState, options);
    const baseValidation = definition?.validate
      ? definition.validate(context, options)
      : { errors: [], warnings: [] };
    const workflowValidation = BlessERP.comercialWorkflow?.canExecuteDocumentAction
      ? BlessERP.comercialWorkflow.canExecuteDocumentAction(docCode, context.order, appState, action, options)
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
      workflowValidation,
      status,
      options
    };
  }

  function renderDocument(docCode, order, appState, options = {}, preparedReport = null) {
    const report = preparedReport || getDocumentReport(docCode, order, appState, options);
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
    const cleanA4Documents = new Set(["INVOICE_PACKING_REFERENCIAL", "INVOICE_PACKING_REAL", "COMMERCIAL_INVOICE_CLIENT", "SRI_RIDE", "HR"]);
    const ribbon = presentation && !cleanA4Documents.has(docCode) && docCode !== "ETIQUETAS"
      ? `<div class="doc-state-ribbon ${utils.esc(presentation.tone)}">${utils.esc(presentation.label)}</div>`
      : "";
    return `${ribbon}${report.definition.render(report.context, options, report.validation, report.status)}`;
  }

  function reportKey(order) {
    return String(order?.id || order?.number || "");
  }

  function renderPreviewMarkup(docCode, orders, appState, options = {}, preparedReports = null) {
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

    if (docCode === "HR") {
      const groups = new Map();
      list.forEach(order => {
        const key = String(options.routeDate || order?.issuedAt || order?.issueDate || order?.date || "SIN_FECHA").slice(0, 10);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(order);
      });
      return `
        <div class="print-shell">
          ${[...groups.values()].map(group => renderDocument("HR", group[0], appState, {
            ...options,
            routeOrders: group
          })).join("")}
        </div>
      `;
    }

    return `
      <div class="print-shell">
        ${list.map(order => renderDocument(
          docCode,
          order,
          appState,
          options,
          preparedReports?.get?.(reportKey(order)) || null
        )).join("")}
      </div>
    `;
  }

  function cleanPdfTitleToken(value) {
    return String(value || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/-+/g, "-")
      .replace(/^[\s.-]+|[\s.-]+$/g, "");
  }

  function clientInvoicePdfTitle(order, appState, preparedContext = null) {
    const context = preparedContext || printUtils.buildContext(order, appState);
    const lastNineDigits = BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order, "000000000") || "000000000";
    const customerName = context.customer?.commercialName || context.customer?.legalName || "SIN CLIENTE";
    const brandName = context.brand?.finalClientName || context.brand?.name || "SIN MARCA";
    return [lastNineDigits, customerName, brandName]
      .map(cleanPdfTitleToken)
      .filter(Boolean)
      .join("-");
  }

  function buildPreviewHtml(docCode, orders, appState, config = {}) {
    const definition = getDefinition(docCode);
    const pageSize = config.pageSize || config.options?.pageSize || defaultPageSize(docCode);
    const markup = renderPreviewMarkup(docCode, orders, appState, config.options || {}, config.preparedReports || null);
    const firstOrder = Array.isArray(orders) ? orders[0] : null;
    const firstPreparedReport = firstOrder ? config.preparedReports?.get?.(reportKey(firstOrder)) : null;
    const reference = BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(firstOrder) || "";
    const title = docCode === "COMMERCIAL_INVOICE_CLIENT" && firstOrder
      ? clientInvoicePdfTitle(firstOrder, appState, firstPreparedReport?.context || null)
      : [definition?.name || docCode, reference].filter(Boolean).join(" - ");
    return {
      pageSize,
      title,
      html: `
        <!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8">
            <base href="${utils.esc(document.baseURI)}">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>${utils.esc(title)}</title>
            ${printUtils.previewStylesheetTags(pageSize)}
          </head>
          <body data-print-preview="true" data-print-size="${utils.esc(String(pageSize).toUpperCase())}">
            ${markup}
          </body>
        </html>
      `
    };
  }

  function waitForPrintAssets(frame, timeoutMs = 5000) {
    const frameDocument = frame.contentDocument;
    if (!frameDocument) return Promise.resolve();
    const imageTasks = [...frameDocument.images].map(image => {
      if (image.complete) return Promise.resolve();
      return new Promise(resolve => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    });
    const fontTask = frameDocument.fonts?.ready || Promise.resolve();
    const assetsReady = Promise.all([fontTask, ...imageTasks]);
    const timeout = new Promise(resolve => window.setTimeout(resolve, timeoutMs));
    return Promise.race([assetsReady, timeout]);
  }

  function printInIsolatedFrame(documentHtml, config = {}) {
    const frame = document.createElement("iframe");
    frame.className = "commercial-print-output-frame";
    frame.title = config.title || "Documento para impresion";
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);

    let cleaned = false;
    let resolveReady = null;
    const readyPromise = new Promise(resolve => { resolveReady = resolve; });
    const finishReady = value => {
      if (!resolveReady) return;
      const resolve = resolveReady;
      resolveReady = null;
      resolve(value);
    };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.setTimeout(() => frame.remove(), 250);
    };
    const fallbackCleanup = window.setTimeout(() => {
      cleanup();
      finishReady(false);
    }, 60000);
    frame.addEventListener("load", async () => {
      try {
        await waitForPrintAssets(frame);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        config.onStage?.("file-ready", { output: "print-frame" });
        const outputWindow = frame.contentWindow;
        if (!outputWindow) throw new Error("No se pudo preparar el marco de impresion.");
        outputWindow.addEventListener("afterprint", () => {
          window.clearTimeout(fallbackCleanup);
          cleanup();
        }, { once: true });
        outputWindow.focus();
        outputWindow.print();
        config.onStage?.("download-started", { output: "print-dialog" });
        finishReady(true);
      } catch (error) {
        window.clearTimeout(fallbackCleanup);
        cleanup();
        BlessERP.layout.toast("No se pudo abrir el dialogo de impresion.");
        finishReady(false);
      }
    }, { once: true });
    frame.srcdoc = documentHtml;
    return config.awaitReady ? readyPromise : true;
  }

  function openPreview(docCode, orders, appState, config = {}) {
    const output = buildPreviewHtml(docCode, orders, appState, config);
    config.onStage?.("template-ready", { bytes: output.html.length, pageSize: output.pageSize });
    if (config.autoPrint) {
      if (config.saveAsPdf) {
        BlessERP.layout.toast("En el dialogo seleccione Guardar como PDF. El documento ya esta ajustado al tamano correcto.");
      }
      return printInIsolatedFrame(output.html, {
        awaitReady: Boolean(config.awaitPrintReady),
        onStage: config.onStage,
        title: output.title
      });
    }

    const win = config.previewWindow || window.open("", "_blank", "width=1280,height=900");
    if (!win) {
      BlessERP.layout.toast("El navegador bloqueo la ventana de preview.");
      return false;
    }
    win.document.open();
    win.document.write(output.html);
    win.document.close();
    return true;
  }

  const invoiceDocuments = new Set(["ETIQUETAS", "INVOICE_PACKING_REFERENCIAL", "COMMERCIAL_INVOICE_CLIENT"]);
  function openDocuments(docCode, orders, appState, config = {}) {
    if (!invoiceDocuments.has(docCode)) return openDocumentsResolved(docCode, orders, appState, config);
    const sourceOrders = (Array.isArray(orders) ? orders : []).filter(Boolean);
    if (!sourceOrders.length) { BlessERP.layout.toast("Seleccione al menos un pedido."); return false; }
    const companyId = BlessERP.authAccess?.activeAccess?.().activeCompany?.id;
    const assertContext = () => {
      if (!companyId || BlessERP.authAccess?.activeAccess?.().activeCompany?.id !== companyId) throw new Error("COMMERCIAL_PRINT_CONTEXT_CHANGED");
    };
    // Open preview during the user's click, before asynchronous reservation (Chrome).
    const previewWindow = config.autoPrint === false ? window.open("", "_blank", "width=1280,height=900") : null;
    if (config.autoPrint === false && !previewWindow) { BlessERP.layout.toast("El navegador bloqueó la ventana de preview."); return false; }
    return (async () => {
      try {
        const repository = BlessERP.getCommercialOrderRepository?.();
        if (!repository?.reserveInvoiceForDocuments) throw new Error("No está disponible la reserva canónica de factura.");
        const resolved = [];
        for (const order of sourceOrders) { assertContext(); resolved.push(await repository.reserveInvoiceForDocuments(order, docCode)); }
        assertContext();
        const result = await openDocumentsResolved(docCode, resolved, appState, { ...config, previewWindow });
        if (!result) previewWindow?.close();
        return result;
      } catch (error) {
        previewWindow?.close();
        BlessERP.layout.toast(error.message || "No se pudo confirmar la identidad de factura; vuelva a intentar.");
        return false;
      }
    })();
  }

  function openDocumentsResolved(docCode, orders, appState, config = {}) {
    const sourceOrders = (Array.isArray(orders) ? orders : []).filter(Boolean);
    const options = config.options || {};
    const autoPrint = config.autoPrint !== false;
    const action = autoPrint ? "print" : "preview";

    if (!sourceOrders.length) {
      BlessERP.layout.toast("Seleccione al menos un pedido para imprimir.");
      return false;
    }

    const printable = [];
    const blocked = [];
    sourceOrders.forEach(original => {
      const order = utils.normalizeOrder(original);
      let message = "";

      const report = getDocumentReport(docCode, order, appState, options, action);
      if (!message && report.validation.errors.length) {
        message = report.validation.errors[0];
      }

      const workflowReview = report.workflowValidation || { allowed: true, errors: [] };
      if (!message && !workflowReview.allowed) {
        message = workflowReview.errors[0] || "El documento no esta listo para imprimir.";
      }

      if (message) {
        BlessERP.comercialWorkflow?.recordEvent?.(original, appState, {
          action: "BLOQUEAR_DOCUMENTO",
          actionLabel: "Bloqueo documental",
          previousStatus: original.status,
          nextStatus: original.status,
          description: message,
          documentCode: docCode,
          documentLabel: report.definition?.name || docCode,
          result: "bloqueado"
        });
        blocked.push({ order, original, message });
        return;
      }

      printable.push({ order, original, report });
    });

    if (blocked.length) {
      BlessERP.state.saveDb();
      const first = blocked[0];
      if (!printable.length) {
        BlessERP.layout.toast(`${first.order.number}: ${first.message}`);
        return false;
      }
      BlessERP.layout.toast(
        `Se imprimiran ${printable.length} pedido(s). Se omitieron ${blocked.length} por datos pendientes; primero: ${first.order.number}: ${first.message}`
      );
    }

    const normalizedOrders = printable.map(item => item.order);
    const preparedReports = new Map(printable.map(item => [reportKey(item.order), item.report]));
    const outputOptions = docCode === "ETIQUETAS"
      ? {
          ...options,
          preparedDocumentDataByOrder: new Map(printable.map(item => [
            reportKey(item.order),
            item.report.context.preparedBoxLabelData
          ]))
        }
      : options;

    const opened = docCode === "ETIQUETAS" && autoPrint && config.nonBlocking
      ? BlessERP.labelPdf?.downloadBoxLabelsAsync?.(
          normalizedOrders,
          appState,
          outputOptions,
          config.onProgress
        )
      : docCode === "ETIQUETAS" && autoPrint
        ? BlessERP.labelPdf?.downloadBoxLabels?.(normalizedOrders, appState, outputOptions)
      : openPreview(docCode, normalizedOrders, appState, {
        autoPrint,
        awaitPrintReady: Boolean(config.awaitPrintReady),
        saveAsPdf: Boolean(config.saveAsPdf),
        pageSize: config.pageSize || options.pageSize || defaultPageSize(docCode),
        options,
        preparedReports,
        previewWindow: config.previewWindow,
        onStage: config.onStage
      });

    const finishOpened = resolvedOpened => {
      if (!resolvedOpened) return resolvedOpened;
      printable.forEach(item => BlessERP.comercialWorkflow?.markDocumentActivity?.(
        item.original,
        appState,
        docCode,
        action,
        options
      ));
      const persistActivity = () => BlessERP.state.saveDb();
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(persistActivity, { timeout: 1000 });
      } else if (typeof window.setTimeout === "function") {
        window.setTimeout(persistActivity, 0);
      } else {
        persistActivity();
      }
      return resolvedOpened;
    };
    if (opened && typeof opened.then === "function") return opened.then(finishOpened);
    return finishOpened(opened);
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
        <button class="primary-button" data-commercial-print-doc="${utils.esc(docCode)}">Imprimir</button>
        <button class="secondary-button" data-commercial-download-doc="${utils.esc(docCode)}">Guardar PDF</button>
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
          ${renderDocument(docCode, order, appState, config.options || {}, report)}
        </div>
        ${actionsMarkup}
        <p class="panel-note commercial-legal-note">${utils.esc(footerNote)}</p>
      </section>
    `;
  }

  BlessERP.comercialPrintSystem = {
    buildPreviewHtml,
    defaultPageSize,
    getDefinition,
    getDocumentReport,
    openDocuments,
    openPreview: (code, orders, state, config = {}) => invoiceDocuments.has(code)
      ? openDocuments(code, orders, state, { ...config, autoPrint: Boolean(config.autoPrint) })
      : openPreview(code, orders, state, config),
    renderDocument,
    renderPreviewMarkup,
    renderWorkspace
  };
})();
