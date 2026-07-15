(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const invoiceUtils = BlessERP.comercialClientInvoiceUtils;
  const printUtils = BlessERP.comercialPrintUtils;
  const utils = BlessERP.comercialUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function renderControls(appState) {
    const options = invoiceUtils.getCurrentOptions(appState);
    return `
      <div class="commercial-doc-toolbar screen-only">
        <label class="compact-field">
          <span>Vista</span>
          <select data-commercial-client-invoice-view>
            <option value="grouped" ${options.viewMode === "grouped" ? "selected" : ""}>Agrupada</option>
            <option value="detailed" ${options.viewMode === "detailed" ? "selected" : ""}>Detallada por caja</option>
          </select>
        </label>
        <label class="compact-field compact-check-field">
          <span>Mostrar cliente principal</span>
          <input type="checkbox" data-commercial-client-invoice-toggle="showCustomer" ${options.showCustomer ? "checked" : ""}>
        </label>
        <label class="compact-field compact-check-field">
          <span>Mostrar marca / cliente final</span>
          <input type="checkbox" data-commercial-client-invoice-toggle="showBrand" ${options.showBrand ? "checked" : ""}>
        </label>
      </div>
    `;
  }

  function renderStateBanner(documentData) {
    const { validation } = documentData;
    const statusText = validation.errors.length
      ? "pendiente datos"
      : validation.warnings.length
        ? "con advertencias"
        : "listo";

    return `
      <section class="hero-banner commercial-inline-banner screen-only">
        <div>
          <strong>Estado del documento: ${utils.esc(validation.state)}</strong>
          <span>Factura Comercial Cliente demo separada del Invoice / Packing carguera y de la futura factura SRI.</span>
        </div>
        <span class="status-badge ${validation.errors.length ? "cancelled" : validation.warnings.length ? "pending" : "authorized"}">${utils.esc(statusText)}</span>
      </section>
    `;
  }

  function renderBuyerSections(documentData) {
    const { customer, brand, order, options } = documentData;
    const sections = [];

    if (options.showCustomer) {
      sections.push(`
        <section class="doc-box">
          <h4>BUYER / COMPRADOR</h4>
          ${printUtils.renderInfoRows([
            ["Cliente principal", customer?.commercialName || "-"],
            ["Razon social", customer?.legalName || "-"],
            ["Identificacion", customer?.identification || "-"],
            ["Direccion", customer?.address || "-"],
            ["Ciudad / Pais", customer ? `${customer.city || "-"} / ${customer.country || "-"}` : "-"],
            ["Correo", customer?.billingEmail || "-"]
          ])}
        </section>
      `);
    }

    if (options.showBrand) {
      sections.push(`
        <section class="doc-box">
          <h4>DESTINATION / MARK</h4>
          ${printUtils.renderInfoRows([
            ["Marca / cliente final", brand?.name || "-"],
            ["Cliente final", brand?.finalClientName || "-"],
            ["Contacto", brand?.contact || "-"],
            ["Direccion", brand?.address || "-"],
            ["Ciudad / Pais", brand ? `${brand.city || "-"} / ${brand.country || "-"}` : `${order.destination || "-"} / ${order.destinationCountry || "-"}`],
            ["Correo", brand?.email || "-"]
          ])}
        </section>
      `);
    }

    if (!sections.length) {
      sections.push(`
        <section class="doc-box">
          <h4>BLOQUE CLIENTE</h4>
          <p class="doc-subtitle">Los bloques de cliente principal y marca / cliente final estan ocultos visualmente en esta configuracion demo.</p>
        </section>
      `);
    }

    return sections.join("");
  }

  function renderDocument(context, options = {}) {
    const documentData = invoiceUtils.buildDocumentData(context.order, context.appState, options);
    const { order, customer, brand, agency, airline, metrics, rows, validation, invoiceNumber } = documentData;
    const stamp = options.mode === "REAL_DEMO" ? "REAL DEMO / VALIDADO INTERNAMENTE" : "REFERENCIAL";
    const stampClass = options.mode === "REAL_DEMO" ? "real-demo" : "referential";

    return `
      <article class="doc-page">
        <div class="doc-stamp ${utils.esc(stampClass)}">${utils.esc(stamp)}</div>
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Documento comercial cliente</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">COMMERCIAL INVOICE / FACTURA COMERCIAL CLIENTE</h2>
            <p class="doc-subtitle">Documento comercial preliminar. No corresponde a factura electronica autorizada por el SRI.</p>
            ${printUtils.renderInfoRows([
              ["Exportador", context.company.legalName],
              ["RUC", context.company.ruc],
              ["Direccion", context.company.address],
              ["Referencia", context.company.address2],
              ["Ciudad / Pais", context.company.city],
              ["Telefono", context.company.phone],
              ["Correo", context.company.email]
            ])}
          </div>
          <div class="doc-box">
            <h4>Datos del documento</h4>
            ${printUtils.renderInfoRows([
              ["Numero invoice", invoiceNumber],
              ["Pedido", order.number],
              ["Estado documento", validation.state],
              ["Fecha emision", utils.dateLabel(order.issuedAt)],
              ["Moneda", order.currency || "USD"],
              ["Payment", order.paymentTerms || `${customer?.creditDays || 0} dias`],
              ["Expire", utils.dateLabel(order.expireDate)]
            ])}
          </div>
        </div>

        <div class="doc-grid">
          ${renderBuyerSections(documentData)}
          <section class="doc-box">
            <h4>LOGISTICA / REFERENCIA</h4>
            ${printUtils.renderInfoRows([
              ["Destino", order.destination || "-"],
              ["Fecha vuelo", utils.dateLabel(order.flightDate)],
              ["DAE", order.daeNumber || "-"],
              ["AWB / HAWB", [order.awb || "-", order.hawb || "-"].join(" / ")],
              ["Agencia", agency?.name || "-"],
              ["Carrier & Flight", [airline?.name || "-", order.flightNumber || "-"].join(" / ")]
            ])}
          </section>
        </div>

        ${printUtils.renderMetricPills([
          { label: "Total cajas", value: String(metrics.totalBoxes) },
          { label: "Total fulls", value: metrics.totalFulls.toFixed(2) },
          { label: "Total ramos", value: utils.number(metrics.totalBunches) },
          { label: "Total tallos", value: utils.number(metrics.totalStems) },
          { label: "Total USD", value: utils.money(metrics.totalUsd) },
          { label: "Precio promedio", value: Number(metrics.averagePricePerStem || 0).toFixed(3) },
          { label: "Vista", value: documentData.options.viewMode === "grouped" ? "Agrupada" : "Detallada por caja" },
          { label: "Moneda", value: order.currency || "USD" }
        ])}

        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>ITEM</th>
                <th>DESCRIPTION</th>
                <th>LENGTH</th>
                <th>BUNCHES</th>
                <th>STEMS/BUNCH</th>
                <th>TOTAL STEMS</th>
                <th>UNIT PRICE</th>
                <th>TOTAL USD</th>
                <th>PO</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map(row => `
                <tr>
                  <td class="center">${utils.esc(row.item)}</td>
                  <td>${utils.esc(row.description)}</td>
                  <td class="center">${utils.esc(`${row.length} cm`)}</td>
                  <td class="center">${utils.esc(utils.number(row.bunches))}</td>
                  <td class="center">${utils.esc(utils.number(row.stemsPerBunch))}</td>
                  <td class="center">${utils.esc(utils.number(row.totalStems))}</td>
                  <td class="numeric">${utils.esc(Number(row.unitPrice || 0).toFixed(3))}</td>
                  <td class="numeric">${utils.esc(Number(row.totalUsd || 0).toFixed(2))}</td>
                  <td>${utils.esc(row.po || "")}</td>
                </tr>
              `).join("") : `<tr><td colspan="9">Sin detalle comercial disponible.</td></tr>`}
              <tr>
                <td colspan="3"><strong>TOTAL</strong></td>
                <td class="center"><strong>${utils.esc(utils.number(metrics.totalBunches))}</strong></td>
                <td></td>
                <td class="center"><strong>${utils.esc(utils.number(metrics.totalStems))}</strong></td>
                <td class="numeric"><strong>${utils.esc(Number(metrics.averagePricePerStem || 0).toFixed(3))}</strong></td>
                <td class="numeric"><strong>${utils.esc(Number(metrics.totalUsd || 0).toFixed(2))}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Resumen comercial</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Resumen", "Valor"],
              [
                ["Variedades", String(Object.keys(metrics.byVariety).length)],
                ["Longitudes", String(Object.keys(metrics.byLength).length)],
                ["Total cajas", String(metrics.totalBoxes)],
                ["Total fulls", metrics.totalFulls.toFixed(2)],
                ["Total USD", utils.money(metrics.totalUsd)]
              ],
              []
            )}
          </section>
          <section class="doc-box">
            <h4>Relacion documental</h4>
            <ul class="doc-list">
              <li>Invoice / Packing carguera sigue separado de esta factura comercial cliente.</li>
              <li>Packing List, HR, MP, Etiquetas y Resumen pedido siguen accesibles desde el Centro de impresion.</li>
              <li>Factura SRI exportacion, XML y contabilidad de ventas quedan para fase futura.</li>
            </ul>
          </section>
        </div>

        <p class="doc-legal-note">Documento comercial preliminar. No corresponde a factura electronica autorizada por el SRI.</p>
      </article>
    `;
  }

  function validateDocument(context, options = {}) {
    const validation = invoiceUtils.validateDocument(context.order, context.appState, options);
    return {
      errors: [...validation.errors],
      warnings: [...validation.warnings]
    };
  }

  function renderWorkspace(order, appState) {
    const options = invoiceUtils.getCurrentOptions(appState);
    const documentData = invoiceUtils.buildDocumentData(order, appState, options);

    return `
      ${renderStateBanner(documentData)}
      ${BlessERP.comercialPrintSystem.renderWorkspace("COMMERCIAL_INVOICE_CLIENT", order, appState, {
        title: "Factura Comercial Cliente",
        description: "Documento comercial cliente separado del Invoice / Packing carguera. No es factura SRI.",
        options,
        controlsMarkup: renderControls(appState),
        actionsMarkup: `
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-preview-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Vista previa</button>
            <button class="secondary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Imprimir referencial</button>
            <button class="secondary-button" data-commercial-preview-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Vista previa real demo</button>
            <button class="secondary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Imprimir real demo</button>
            <button class="secondary-button" data-commercial-doc-placeholder="pdf|COMMERCIAL_INVOICE_CLIENT">Descargar PDF</button>
            <button class="secondary-button" data-commercial-doc-placeholder="email|COMMERCIAL_INVOICE_CLIENT">Enviar por correo</button>
          </div>
        `,
        footerNote: "Documento comercial preliminar. No corresponde a factura electronica autorizada por el SRI."
      })}
    `;
  }

  function renderCard(order, appState, doc, report) {
    const options = invoiceUtils.getCurrentOptions(appState);
    const documentData = invoiceUtils.buildDocumentData(order, appState, options);
    const statusText = report.validation.errors.length
      ? "pendiente datos"
      : report.validation.warnings.length
        ? "con advertencias"
        : "listo";

    return `
      <article class="panel-card commercial-print-card commercial-print-card-wide">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CENTRO DE IMPRESION</p>
            <h3>${utils.esc(doc.name)}</h3>
          </div>
          <span class="status-badge ${report.status.tone}">${utils.esc(statusText)}</span>
        </div>
        <p class="panel-note">No es factura SRI. Documento comercial preliminar para cliente usando los mismos datos del Pedido Maestro.</p>
        <div class="info-stack commercial-print-card-meta">
          <div class="info-row"><strong>Pedido activo</strong><span>${utils.esc(order?.number || "-")}</span></div>
          <div class="info-row"><strong>Numero invoice</strong><span>${utils.esc(documentData.invoiceNumber)}</span></div>
          <div class="info-row"><strong>Estado documento</strong><span>${utils.esc(documentData.validation.state)}</span></div>
          <div class="info-row"><strong>Total USD</strong><span>${utils.esc(utils.money(documentData.metrics.totalUsd))}</span></div>
        </div>
        ${renderControls(appState)}
        ${BlessERP.comercialPrint.renderDocumentIssues(report)}
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-preview-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Vista previa</button>
          <button class="secondary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Imprimir referencial</button>
          <button class="secondary-button" data-commercial-preview-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Vista previa real demo</button>
          <button class="secondary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Imprimir real demo</button>
          <button class="secondary-button" data-commercial-doc-placeholder="pdf|COMMERCIAL_INVOICE_CLIENT">Descargar PDF</button>
          <button class="secondary-button" data-commercial-doc-placeholder="email|COMMERCIAL_INVOICE_CLIENT">Enviar por correo</button>
        </div>
        <p class="panel-note commercial-legal-note">No es factura SRI.</p>
      </article>
    `;
  }

  BlessERP.comercialPrintDocs.COMMERCIAL_INVOICE_CLIENT = {
    code: "COMMERCIAL_INVOICE_CLIENT",
    name: "Factura Comercial Cliente",
    description: "Documento comercial cliente separado del invoice carguera. No corresponde a factura SRI.",
    validate: validateDocument,
    render: renderDocument
  };

  BlessERP.comercialClientInvoice = {
    getCurrentOptions: invoiceUtils.getCurrentOptions,
    renderCard,
    renderControls,
    renderWorkspace
  };
})();
