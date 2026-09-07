(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const utils = BlessERP.comercialUtils;
  const stateApi = BlessERP.comercialState;

  const centerDocuments = [
    { id: "LABELS", label: "Etiqueta de Caja / Aduanera", shortLabel: "Etiquetas", docCode: "ETIQUETAS" },
    { id: "AGENCY_INVOICE", label: "Factura Comercial / Agencia", shortLabel: "Factura Agencia", docCode: "INVOICE_PACKING_REFERENCIAL" },
    { id: "CLIENT_INVOICE", label: "Factura del Cliente", shortLabel: "Factura Cliente", docCode: "COMMERCIAL_INVOICE_CLIENT" },
    { id: "ROUTE_SHEET", label: "Hoja de Ruta", shortLabel: "Hoja de Ruta", docCode: "HR" },
    { id: "SRI_INVOICE", label: "Factura SRI", shortLabel: "Factura SRI", docCode: "SRI_RIDE", requiresSri: true }
  ];

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

  function getDocumentConfig(mode) {
    return centerDocuments.find(item => item.id === mode) || centerDocuments[0];
  }

  function invoiceNumberFor(order, mode) {
    if (mode === "CLIENT_INVOICE") return BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order) || "";
    if (mode === "SRI_INVOICE") return order.sriInvoiceNumber || "";
    if (mode === "ROUTE_SHEET") return order.number || "";
    return BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order) || "";
  }

  function getPrintCenterRows(appState, mode = null, options = {}) {
    const ui = stateApi.getUi(appState);
    const activeMode = mode || ui.printCenterDocument || "LABELS";
    const invoiceFilter = options.ignoreFilters ? "" : String(ui.printCenterInvoiceFilter || "").trim().toLowerCase();
    const customerFilter = options.ignoreFilters ? "" : String(ui.printCenterCustomerId || "");
    const selectedIds = new Set(activeMode === "LABELS"
      ? (ui.labelSelectedOrderIds || [])
      : (ui.printCenterSelectedOrderIds || []));

    return stateApi.getOrders(appState)
      .map(order => {
        const normalized = utils.normalizeOrder(order);
        const config = getDocumentConfig(activeMode);
        const customer = utils.findCustomer(normalized.customerId);
        const invoiceNumber = invoiceNumberFor(normalized, activeMode);
        const documentData = activeMode === "LABELS"
          ? BlessERP.comercialLabels.buildDocumentData(normalized, appState, { printType: "all" })
          : null;
        const sriReview = activeMode === "SRI_INVOICE"
          ? BlessERP.comercialSriDocuments.validateAuthorization(normalized)
          : null;
        const report = activeMode === "LABELS"
          ? null
          : getReportForDoc({ code: config.docCode }, normalized, appState);
        return {
          order: normalized,
          customer,
          customerName: customer?.commercialName || customer?.legalName || "Sin cliente",
          invoiceNumber,
          documentData,
          report,
          selected: selectedIds.has(normalized.id),
          sriReview,
          ready: documentData
            ? !documentData.errors.length
            : sriReview
              ? sriReview.authorized && !report.validation.errors.length
              : !report.validation.errors.length
        };
      })
      .filter(row => !customerFilter || row.order.customerId === customerFilter)
      .filter(row => !invoiceFilter || [row.invoiceNumber, row.order.number]
        .some(value => String(value || "").toLowerCase().includes(invoiceFilter)))
      .sort((left, right) => String(right.order.issuedAt || "").localeCompare(String(left.order.issuedAt || "")) || String(right.order.number).localeCompare(String(left.order.number)));
  }

  function getBulkLabelRows(appState, options = {}) {
    return getPrintCenterRows(appState, "LABELS", options);
  }

  function renderDocumentSwitcher(appState) {
    const active = stateApi.getUi(appState).printCenterDocument || "LABELS";
    return `
      <div class="commercial-print-document-switcher" role="tablist" aria-label="Documentos del centro de impresion">
        ${centerDocuments.map(item => `
          <button class="${item.id === active ? "primary-button is-active" : "secondary-button"}" type="button" role="tab" aria-selected="${item.id === active ? "true" : "false"}" data-commercial-print-center-document="${utils.esc(item.id)}">${utils.esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function renderFilters(appState, visibleCount) {
    const ui = stateApi.getUi(appState);
    const customers = stateApi.getCustomerCatalog(appState)
      .slice()
      .sort((left, right) => String(left.commercialName || left.legalName).localeCompare(String(right.commercialName || right.legalName)));
    return `
      <form class="panel-card commercial-print-filters" data-commercial-print-center-filters>
        <div class="panel-card-head">
          <div><p class="section-kicker">FILTROS</p><h3>Pedidos disponibles para impresion</h3></div>
          <span class="status-badge partial">${utils.esc(visibleCount)} resultado(s)</span>
        </div>
        <div class="commercial-print-filter-grid">
          <label class="compact-field"><span>Numero de factura</span><input name="invoice" value="${utils.esc(ui.printCenterInvoiceFilter || "")}" placeholder="Buscar numero de factura"></label>
          <label class="compact-field"><span>Cliente</span><select name="customer"><option value="">Todos los clientes</option>${customers.map(customer => `<option value="${utils.esc(customer.id)}" ${customer.id === ui.printCenterCustomerId ? "selected" : ""}>${utils.esc(customer.commercialName || customer.legalName)}</option>`).join("")}</select></label>
          <div class="table-actions-inline commercial-print-filter-actions"><button class="primary-button" type="submit">Filtrar</button><button class="secondary-button" type="button" data-commercial-print-center-clear>Limpiar</button></div>
        </div>
      </form>
    `;
  }

  function renderBulkLabels(appState) {
    const rows = getBulkLabelRows(appState);
    const selected = getBulkLabelRows(appState, { ignoreFilters: true }).filter(row => row.selected);
    const selectedBoxes = selected.reduce((sum, row) => sum + row.documentData.summary.totalBoxes, 0);

    return `
      <section class="panel-card commercial-bulk-labels">
        <div class="panel-card-head">
          <div><p class="section-kicker">ETIQUETAS DE CAJA</p><h3>Generacion masiva por pedido y caja</h3></div>
          <span class="status-badge ${selected.length ? "authorized" : "partial"}">${utils.esc(selected.length)} pedido(s) / ${utils.esc(selectedBoxes)} caja(s)</span>
        </div>
        <p class="panel-note">Seleccione uno o varios pedidos. La etiqueta usa la factura comercial para agencia y no requiere autorizacion SRI.</p>
        <div class="table-actions-inline commercial-bulk-label-actions">
          <button class="secondary-button" data-commercial-label-select-ready>Seleccionar listos</button>
          <button class="secondary-button" data-commercial-label-clear-selection>Deseleccionar todos</button>
          <button class="secondary-button" data-commercial-preview-selected-labels ${selected.length ? "" : "disabled"}>Vista previa seleccionadas</button>
          <button class="primary-button" data-commercial-print-selected-labels ${selected.length ? "" : "disabled"}>Imprimir seleccionadas</button>
          <button class="secondary-button" data-commercial-download-selected-labels ${selected.length ? "" : "disabled"}>Guardar PDF seleccionadas</button>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table commercial-bulk-label-table">
            <thead><tr><th>Seleccion</th><th>Pedido</th><th>Cliente</th><th>Numero factura</th><th>DAE</th><th>Cajas</th><th>Estado</th><th>Validacion</th></tr></thead>
            <tbody>${rows.map(row => {
              const firstIssue = row.documentData.errors[0] || "Datos completos para generar etiquetas.";
              return `<tr>
                <td><input type="checkbox" data-commercial-label-order-select="${utils.esc(row.order.id)}" ${row.selected ? "checked" : ""} aria-label="Seleccionar pedido ${utils.esc(row.order.number)}"></td>
                <td><strong>${utils.esc(row.order.number)}</strong><br><small>${utils.esc(row.order.issuedAt || "-")}</small></td>
                <td>${utils.esc(row.customerName)}</td>
                <td><strong>${utils.esc(row.invoiceNumber || "-")}</strong></td>
                <td>${utils.esc(row.order.daeNumber || "-")}</td>
                <td>${utils.esc(row.documentData.summary.totalBoxes)}</td>
                <td><span class="status-badge ${row.ready ? "authorized" : "cancelled"}">${row.ready ? "LISTO" : "BLOQUEADO"}</span></td>
                <td><small>${utils.esc(firstIssue)}</small></td>
              </tr>`;
            }).join("") || `<tr><td colspan="8">No existen pedidos que coincidan con los filtros.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
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
        <p class="panel-note">Una etiqueta aduanera por caja, con codigo de barras DAE e impresion individual, por rango o masiva.</p>
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

  function renderInvoiceTable(appState, mode) {
    const config = getDocumentConfig(mode);
    const rows = getPrintCenterRows(appState, mode);
    const selected = getPrintCenterRows(appState, mode, { ignoreFilters: true }).filter(row => row.selected && (row.ready || ["INVOICE_PACKING_REFERENCIAL", "COMMERCIAL_INVOICE_CLIENT"].includes(config.docCode)));
    return `
      <section class="panel-card commercial-print-orders">
        <div class="panel-card-head">
          <div><p class="section-kicker">${utils.esc(config.shortLabel.toUpperCase())}</p><h3>${utils.esc(config.label)}</h3></div>
          <span class="status-badge ${config.requiresSri ? "partial" : "authorized"}">${config.requiresSri ? "Requiere autorizacion" : "Sin requisito SRI"}</span>
        </div>
        <p class="panel-note">${config.requiresSri ? "El RIDE y el XML se habilitan solo cuando la factura consta como AUTORIZADA y tiene numero de autorizacion y clave de acceso." : "Este documento comercial puede generarse e imprimirse sin autorizacion del SRI."}</p>
        <div class="table-actions-inline commercial-invoice-bulk-actions">
          <button class="secondary-button" type="button" data-commercial-invoice-select-visible>Seleccionar visibles</button>
          <button class="secondary-button" type="button" data-commercial-invoice-clear-selection>Deseleccionar</button>
          <button class="secondary-button" type="button" data-commercial-preview-selected-invoices data-commercial-selected-doc-code="${utils.esc(config.docCode)}" ${selected.length ? "" : "disabled"}>Vista previa seleccionadas (${utils.esc(selected.length)})</button>
          <button class="primary-button" type="button" data-commercial-print-selected-invoices data-commercial-selected-doc-code="${utils.esc(config.docCode)}" ${selected.length ? "" : "disabled"}>Imprimir seleccionadas</button>
          <button class="secondary-button" type="button" data-commercial-download-selected-invoices data-commercial-selected-doc-code="${utils.esc(config.docCode)}" ${selected.length ? "" : "disabled"}>Guardar PDF seleccionadas</button>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table commercial-print-order-table">
            <thead><tr><th>Seleccion</th><th>Pedido</th><th>Cliente</th><th>Numero factura</th><th>Fecha</th><th>Cajas</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>${rows.map(row => {
              const report = row.report || getReportForDoc({ code: config.docCode }, row.order, appState);
              const ready = config.requiresSri ? row.sriReview.authorized : !report.validation.errors.length;
              const optionsSource = mode === "CLIENT_INVOICE" ? "client-invoice-referential" : "";
              const disabled = config.requiresSri && !ready ? "disabled" : "";
              const stateLabel = config.requiresSri ? (ready ? "AUTORIZADO" : row.sriReview.status) : (ready ? "LISTO" : "REVISAR");
              return `<tr>
                <td><input type="checkbox" data-commercial-invoice-order-select="${utils.esc(row.order.id)}" ${row.selected ? "checked" : ""} ${ready ? "" : "disabled"} aria-label="Seleccionar factura ${utils.esc(row.invoiceNumber || row.order.number)}"></td>
                <td><strong>${utils.esc(row.order.number)}</strong></td>
                <td>${utils.esc(row.customerName)}</td>
                <td><strong>${utils.esc(row.invoiceNumber || "-")}</strong></td>
                <td>${utils.esc(row.order.issuedAt || "-")}</td>
                <td>${utils.esc(utils.getOrderMetrics(row.order).totalBoxes)}</td>
                <td><span class="status-badge ${ready ? "authorized" : "cancelled"}">${utils.esc(stateLabel)}</span>${config.requiresSri && !ready ? `<br><small>${utils.esc(row.sriReview.errors[0] || "Autorizacion pendiente.")}</small>` : ""}</td>
                <td><div class="table-actions-inline">
                  <button class="secondary-button" data-commercial-center-doc-action="preview" data-commercial-center-doc-code="${utils.esc(config.docCode)}" data-commercial-center-order-id="${utils.esc(row.order.id)}" ${optionsSource ? `data-commercial-doc-options-source="${optionsSource}"` : ""} ${disabled}>${config.requiresSri ? "Ver RIDE" : "Vista previa"}</button>
                  <button class="primary-button" data-commercial-center-doc-action="print" data-commercial-center-doc-code="${utils.esc(config.docCode)}" data-commercial-center-order-id="${utils.esc(row.order.id)}" ${optionsSource ? `data-commercial-doc-options-source="${optionsSource}"` : ""} ${disabled}>${config.requiresSri ? "Imprimir RIDE" : "Imprimir"}</button>
                  <button class="secondary-button" data-commercial-center-doc-action="download" data-commercial-center-doc-code="${utils.esc(config.docCode)}" data-commercial-center-order-id="${utils.esc(row.order.id)}" ${optionsSource ? `data-commercial-doc-options-source="${optionsSource}"` : ""} ${disabled}>Guardar PDF</button>
                  ${config.requiresSri ? `<button class="secondary-button" data-commercial-sri-xml="${utils.esc(row.order.id)}" ${disabled}>Descargar XML</button>` : ""}
                </div></td>
              </tr>`;
            }).join("") || `<tr><td colspan="8">No existen pedidos que coincidan con los filtros.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPrintCards(order, appState) {
    const mode = stateApi.getUi(appState).printCenterDocument || "LABELS";
    return mode === "LABELS" ? renderBulkLabels(appState) : renderInvoiceTable(appState, mode);
  }

  function renderPrintCenter(order, appState) {
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Centro de impresion</h1>
          <p>Etiquetas de caja, factura comercial, factura del cliente, hoja de ruta y documentos SRI en una sola bandeja.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">5 tipos de impresion</span>
        </div>
      </section>
      ${renderDocumentSwitcher(appState)}
      ${renderFilters(appState, getPrintCenterRows(appState).length)}
      ${renderPrintCards(order, appState)}
    `;
  }

  function bind(container, appState) {
    container.querySelectorAll("[data-commercial-print-center-document]").forEach(button => button.addEventListener("click", () => {
      stateApi.setPrintCenterUi(appState, "printCenterDocument", button.dataset.commercialPrintCenterDocument);
      BlessERP.layout.renderPage();
    }));

    container.querySelector("[data-commercial-print-center-filters]")?.addEventListener("submit", event => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      stateApi.setPrintCenterUi(appState, "printCenterInvoiceFilter", formData.get("invoice"));
      stateApi.setPrintCenterUi(appState, "printCenterCustomerId", formData.get("customer"));
      BlessERP.layout.renderPage();
    });

    container.querySelector("[data-commercial-print-center-clear]")?.addEventListener("click", () => {
      stateApi.setPrintCenterUi(appState, "printCenterInvoiceFilter", "");
      stateApi.setPrintCenterUi(appState, "printCenterCustomerId", "");
      BlessERP.layout.renderPage();
    });

    container.querySelectorAll("[data-commercial-sri-xml]").forEach(button => button.addEventListener("click", () => {
      const order = stateApi.findOrder(appState, button.dataset.commercialSriXml);
      const result = BlessERP.comercialSriDocuments.downloadXml(order, appState);
      if (!result.ok) {
        BlessERP.layout.toast(result.errors[0] || "La factura SRI no esta autorizada.");
        return;
      }
      BlessERP.layout.toast(`XML generado: ${result.fileName}`);
    }));
  }

  BlessERP.comercialPrint = {
    renderDocumentIssues,
    getBulkLabelRows,
    getPrintCenterRows,
    bind,
    renderBulkLabels,
    renderPrintCards,
    renderPrintCenter
  };
})();
