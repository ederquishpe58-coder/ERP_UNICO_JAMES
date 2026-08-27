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
    const localSale = utils.isLocalOrder?.(order) || false;
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
      const destinationParty = localSale ? customer : brand;
      sections.push(`
        <section class="doc-box">
          <h4>DESTINATION / MARK</h4>
          ${printUtils.renderInfoRows([
            [localSale ? "Cliente local" : "Marca / cliente final", destinationParty?.name || destinationParty?.commercialName || destinationParty?.legalName || "-"],
            ["Cliente final", localSale ? "NO APLICA" : brand?.finalClientName || "-"],
            ["Contacto", destinationParty?.contact || "-"],
            ["Direccion", destinationParty?.address || "-"],
            ["Ciudad / Pais", destinationParty ? `${destinationParty.city || "-"} / ${destinationParty.country || "-"}` : `${order.destination || "-"} / ${order.destinationCountry || "-"}`],
            ["Correo", destinationParty?.email || destinationParty?.billingEmail || "-"]
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

  function addDays(dateValue, dayCount) {
    const parts = String(dateValue || "").slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return "";
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + Number(dayCount || 0));
    return date.toISOString().slice(0, 10);
  }

  function compactDecimal(value, decimals = 4) {
    return Number(value || 0)
      .toFixed(decimals)
      .replace(/0+$/g, "")
      .replace(/\.$/g, "");
  }

  function renderDocument(context, options = {}) {
    const documentData = context.preparedClientInvoiceData
      || invoiceUtils.buildDocumentData(context.order, context.appState, options);
    const { order, customer, brand, agency, airline, metrics, invoiceNumber } = documentData;
    const localSale = utils.isLocalOrder?.(order) || false;
    const consignee = localSale ? customer : brand;
    const logoUrl = printUtils.companyLogoUrl(context.company);
    const byLength = printUtils.summarizeMap(metrics.byLength, value => utils.number(value), "numeric");
    const boxGroups = printUtils.groupLinesByBox(metrics.lines);
    const customerCountry = consignee?.country || order.destinationCountry || order.destination || (localSale ? "ECUADOR" : "-");
    const paymentValue = String(order.paymentTerms || customer?.creditDays || 0);
    const expiryDate = order.expireDate || addDays(order.issuedAt, customer?.creditDays || 0);
    const detailRows = boxGroups.flatMap(group => group.lines.map((line, lineIndex) => {
      const lineTotal = Number(line.totalLine || (
        Number(line.bunches || 0)
        * Number(line.stemsPerBunch || 0)
        * Number(line.unitPrice || 0)
      ));
      return `
        <tr class="${lineIndex === 0 ? "is-box-start" : ""}">
          ${lineIndex === 0 ? `
            <td class="center client-detail-box-cell" rowspan="${group.lines.length}">${utils.esc(group.boxNumber)}</td>
            <td class="center client-detail-box-cell" rowspan="${group.lines.length}">${utils.esc(group.boxType || "-")}</td>
          ` : ""}
          <td>${utils.esc(line.variety || "-")}</td>
          <td class="center">${utils.esc(line.length || "-")}</td>
          <td class="center">${utils.esc(utils.number(line.bunches))}</td>
          <td class="center">${utils.esc(utils.number(line.stemsPerBunch))}</td>
          <td class="center">${utils.esc(utils.number(line.totalStems))}</td>
          <td class="numeric">${utils.esc(compactDecimal(line.unitPrice))}</td>
          <td class="numeric">${utils.esc(compactDecimal(lineTotal, 2))}</td>
        </tr>
      `;
    })).join("");

    return `
      <article class="doc-page invoice-a4-page client-invoice-a4">
        <header class="invoice-a4-header client-invoice-header">
          <div class="invoice-a4-brand">
            <img src="${utils.esc(logoUrl)}" alt="${utils.esc(context.company.commercialName || context.company.legalName || "Empresa")}">
            <div>
              <strong>${utils.esc(context.company.legalName)}</strong>
              <span>${utils.esc(context.company.address)}</span>
              <span>${utils.esc(context.company.city)} | RUC ${utils.esc(context.company.ruc)}</span>
              <span>${utils.esc(context.company.phone)} | ${utils.esc(context.company.email)}</span>
            </div>
          </div>
          <div class="client-invoice-parties">
            <section><h2>SOLD TO</h2><strong>${utils.esc(customer?.legalName || customer?.commercialName || "-")}</strong><span>${utils.esc(customer?.address || "-")}</span><span>${utils.esc([customer?.city, customer?.country].filter(Boolean).join(", ") || "-")}</span></section>
            <section><h2>CONSIGNEE TO</h2><strong>${utils.esc(consignee?.finalClientName || consignee?.name || consignee?.legalName || consignee?.commercialName || "-")}</strong><span>${utils.esc(consignee?.address || "-")}</span><span>${utils.esc([consignee?.city, consignee?.country].filter(Boolean).join(", ") || "-")}</span></section>
          </div>
        </header>

        <div class="client-invoice-country"><span>Country:</span><strong>${utils.esc(customerCountry)}</strong></div>
        <section class="client-invoice-summary-grid">
          <div class="client-invoice-summary-number"><span>INVOICE / PACKING</span><strong>${utils.esc(invoiceNumber)}</strong></div>
          <div><span>TOTAL PIEZAS</span><strong>${utils.esc(metrics.totalBoxes)}</strong></div>
          <div><span>TOTAL FULLS</span><strong>${utils.esc(metrics.totalFulls.toFixed(2))}</strong></div>
          <div><span>CUSTOMER CODE</span><strong>${utils.esc(customer?.code || brand?.code || "-")}</strong></div>
          <div><span>DATE / FECHA</span><strong>${utils.esc(utils.dateLabel(order.issuedAt))}</strong></div>
          <div><span>PAYMENT / PAGO</span><strong>${utils.esc(paymentValue)}</strong></div>
          <div><span>EXPIRE / VENCIMIENTO</span><strong>${utils.esc(utils.dateLabel(expiryDate))}</strong></div>
          <div><span>FORWARDER / AGENCIA</span><strong>${utils.esc(localSale ? "NO APLICA" : agency?.name || "-")}</strong></div>
          <div><span>AWB / HAWB</span><strong>${utils.esc([order.awb, order.hawb].filter(Boolean).join(" / ") || "-")}</strong></div>
          <div><span>DAE</span><strong>${utils.esc(localSale ? "NO APLICA" : order.transportType === "aereo" ? order.daeNumber || "-" : "-")}</strong></div>
          <div><span>CARRIER & FLIGHT / LINEA</span><strong>${utils.esc([airline?.name, order.flightNumber].filter(Boolean).join(" / ") || "-")}</strong></div>
        </section>

        <table class="invoice-a4-table client-detail-table">
          <thead><tr><th>BOXES<br>CAJAS</th><th>TYPE<br>TIPO</th><th>DESCRIPTION<br>DESCRIPCION</th><th>LENGTH<br>LONGITUD</th><th>BUNCH<br>RAMO</th><th>STEM<br>TALLO</th><th>T. STEMS<br>T. TALLOS</th><th>PRICE<br>PRECIO</th><th>TOTAL</th></tr></thead>
          <tbody>
            ${detailRows || `<tr><td colspan="9">Sin detalle comercial disponible.</td></tr>`}
          </tbody>
          <tfoot><tr><td colspan="4"><strong>TOTAL</strong></td><td class="center"><strong>${utils.esc(utils.number(metrics.totalBunches))}</strong></td><td></td><td class="center"><strong>${utils.esc(utils.number(metrics.totalStems))}</strong></td><td></td><td class="numeric"><strong>${utils.esc(compactDecimal(metrics.totalUsd, 2))}</strong></td></tr></tfoot>
        </table>

        <footer class="client-invoice-footer">
          <table class="invoice-a4-table compact"><thead><tr><th>LENGTH / LONGITUD</th><th>STEMS / TALLOS</th></tr></thead><tbody>${byLength.map(item => `<tr><td class="center">${utils.esc(item.label)} cm</td><td class="center">${utils.esc(item.value)}</td></tr>`).join("") || `<tr><td colspan="2">Sin resumen.</td></tr>`}</tbody></table>
          <div class="client-invoice-order-number"><span>NUMERO DE PEDIDO</span><strong>${utils.esc(order.number || "-")}</strong></div>
        </footer>
      </article>
    `;
  }

  function validateDocument(context, options = {}) {
    const documentData = invoiceUtils.buildDocumentData(context.order, context.appState, options);
    context.preparedClientInvoiceData = documentData;
    const validation = documentData.validation;
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
            <button class="primary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Imprimir referencial</button>
            <button class="secondary-button" data-commercial-preview-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Vista previa real demo</button>
            <button class="secondary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Imprimir real demo</button>
            <button class="secondary-button" data-commercial-download-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Guardar PDF</button>
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
        <p class="panel-note">No es factura SRI. Documento comercial preliminar para cliente usando los mismos datos de Crear pedido.</p>
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
          <button class="primary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Imprimir referencial</button>
          <button class="secondary-button" data-commercial-preview-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Vista previa real demo</button>
          <button class="secondary-button" data-commercial-print-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-real-demo">Imprimir real demo</button>
          <button class="secondary-button" data-commercial-download-doc="COMMERCIAL_INVOICE_CLIENT" data-commercial-doc-options-source="client-invoice-referential">Guardar PDF</button>
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
