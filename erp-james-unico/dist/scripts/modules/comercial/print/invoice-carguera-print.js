(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateInvoice(context) {
    const { order, brand, metrics, airline, dae } = context;
    const errors = [];
    const warnings = [];

    if (!brand) errors.push("Falta marca / cliente final.");
    if (!order.issuedAt) errors.push("Falta fecha de emision.");
    if (!metrics.lines.length) errors.push("Falta detalle de cajas.");
    if (metrics.totalUsd <= 0) errors.push("Falta total USD con precios.");
    if (metrics.lines.some(line => Number(line.unitPrice || 0) <= 0)) {
      errors.push("Hay lineas sin precio unitario.");
    }
    if (order.transportType === "aereo" && order.destination !== "ECUADOR" && !order.daeNumber) {
      errors.push("Falta DAE vigente.");
    }

    if (!order.awb) warnings.push("Falta AWB.");
    if (!order.hawb) warnings.push("Falta HAWB.");
    if (!airline || !order.flightNumber) warnings.push("Falta carrier o vuelo.");
    if (dae && utils.isDaeNearExpiry(dae)) warnings.push("DAE proxima a caducar.");
    if (brand?.requiresPo && metrics.lines.some(line => !String(line.po || "").trim())) {
      warnings.push("La marca requiere PO por linea.");
    }

    return { errors, warnings };
  }

  function renderInvoice(context, options = {}) {
    const { company, order, customer, brand, agency, airline, metrics, boxGroups } = context;
    const stamp = options.stamp || "REFERENCIAL";
    const stampClass = options.stampClass || "referential";
    const rows = boxGroups.map((group, groupIndex) => (
      group.lines.map((line, lineIndex) => `
        <tr class="${groupIndex > 0 && lineIndex === 0 ? "box-divider" : ""}">
          <td class="center">${lineIndex === 0 ? utils.esc(group.boxNumber) : ""}</td>
          <td class="center">${lineIndex === 0 ? utils.esc(group.boxType) : ""}</td>
          <td>${utils.esc(`${company.soldToLabel} ${line.variety}`)}</td>
          <td>${utils.esc(line.po || order.generalPo || "")}</td>
          <td class="center">${utils.esc(`${line.length} cm`)}</td>
          <td class="center">${utils.esc(utils.number(line.bunches))}</td>
          <td class="center">${utils.esc(utils.number(line.stemsPerBunch))}</td>
          <td class="center">${utils.esc(utils.number(line.totalStems))}</td>
          <td class="numeric">${utils.esc(Number(line.unitPrice || 0).toFixed(3))}</td>
          <td class="numeric">${utils.esc(Number(line.totalLine || 0).toFixed(2))}</td>
        </tr>
      `).join("")
    )).join("");

    const byLength = printUtils.summarizeMap(
      metrics.byLength,
      value => `${utils.number(value)} tallos`,
      "numeric"
    );

    return `
      <article class="doc-page">
        <div class="doc-stamp ${utils.esc(stampClass)}">${utils.esc(stamp)}</div>
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Comercial / Exportaciones</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">INVOICE / PACKING</h2>
            <p class="doc-subtitle">Documento comercial y logistico para carguera. No corresponde a facturacion SRI.</p>
            ${printUtils.renderInfoRows([
              ["Exportador", company.legalName],
              ["Direccion", company.address],
              ["Referencia", company.address2],
              ["Ciudad / Pais", company.city],
              ["Telefono", company.phone],
              ["Correo", company.email],
              ["RUC", company.ruc]
            ])}
          </div>
          <div class="doc-box">
            <h4>Bloque documento</h4>
            ${printUtils.renderInfoRows([
              ["Customer code", brand?.code || "-"],
              ["Pedido / invoice", order.number],
              ["Fecha", utils.dateLabel(order.issuedAt)],
              ["Payment", order.paymentTerms || `${customer?.creditDays || 0} dias`],
              ["Expire", utils.dateLabel(order.expireDate)],
              ["Forwarder agent", agency?.name || "-"],
              ["AWB / HAWB", [order.awb || "-", order.hawb || "-"].join(" / ")],
              ["DAE", order.daeNumber || "-"],
              ["Carrier & Flight", [airline?.name || "-", order.flightNumber || "-"].join(" / ")]
            ])}
          </div>
        </div>

        <div class="doc-grid">
          <section class="doc-box">
            <h4>SOLD TO</h4>
            ${printUtils.renderInfoRows([
              ["Cliente final", brand?.finalClientName || brand?.name || "-"],
              ["Mark", brand?.name || "-"],
              ["Direccion", brand?.address || "-"],
              ["Ciudad", brand?.city || "-"],
              ["Pais", brand?.country || order.destinationCountry || "-"]
            ])}
          </section>
          <section class="doc-box">
            <h4>CONSIGNEE TO</h4>
            ${printUtils.renderInfoRows([
              ["Mark", brand?.name || "-"],
              ["PO general", order.generalPo || "-"],
              ["Direccion", brand?.address || "-"],
              ["Pais", brand?.country || order.destinationCountry || "-"],
              ["Contacto", brand?.contact || "-"]
            ])}
          </section>
        </div>

        ${printUtils.renderMetricPills([
          { label: "Total piezas", value: String(metrics.totalBoxes) },
          { label: "Total fulls", value: metrics.totalFulls.toFixed(2) },
          { label: "Total ramos", value: utils.number(metrics.totalBunches) },
          { label: "Total tallos", value: utils.number(metrics.totalStems) },
          { label: "Total USD", value: utils.money(metrics.totalUsd) },
          { label: "Promedio tallo", value: Number(metrics.averagePricePerStem || 0).toFixed(3) },
          { label: "Destino", value: order.destination || "-" },
          { label: "Prepared by", value: company.preparedBy }
        ])}

        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>BOXES</th>
                <th>TYPE</th>
                <th>DESCRIPTION</th>
                <th>PO</th>
                <th>LENGTH</th>
                <th>BUNCH</th>
                <th>STEM</th>
                <th>T. STEMS</th>
                <th>PRICE</th>
                <th>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="10">Sin lineas cargadas en el pedido.</td></tr>`}
              <tr>
                <td colspan="5"><strong>TOTAL</strong></td>
                <td class="center"><strong>${utils.esc(utils.number(metrics.totalBunches))}</strong></td>
                <td></td>
                <td class="center"><strong>${utils.esc(utils.number(metrics.totalStems))}</strong></td>
                <td class="numeric"><strong>${utils.esc(Number(metrics.averagePricePerStem || 0).toFixed(3))}</strong></td>
                <td class="numeric"><strong>${utils.esc(Number(metrics.totalUsd || 0).toFixed(2))}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Resumen por longitud</h4>
            ${printUtils.renderSimpleSummaryTable(
              ["Longitud", "Tallos"],
              byLength.map(item => [item.label, item.value]),
              [1]
            )}
          </section>
          <section class="doc-box">
            <h4>Notas de esta salida</h4>
            <ul class="doc-list">
              <li>El cliente principal interno no se imprime en este formato.</li>
              <li>PO por linea tiene prioridad sobre PO general del pedido.</li>
              <li>Factura cliente y facturacion SRI se implementaran en una fase posterior.</li>
            </ul>
          </section>
        </div>

        <p class="doc-legal-note">Modo actual: ${utils.esc(stamp)}. Este documento es comercial/logistico y no debe confundirse con factura electronica ni autorizacion SRI.</p>
      </article>
    `;
  }

  function registerInvoiceDoc(code, name, stamp, stampClass) {
    BlessERP.comercialPrintDocs[code] = {
      code,
      name,
      description: "Formato comercial de carguera basado en el Pedido Maestro activo.",
      validate: validateInvoice,
      render(context) {
        return renderInvoice(context, { stamp, stampClass });
      }
    };
  }

  registerInvoiceDoc(
    "INVOICE_PACKING_REFERENCIAL",
    "Invoice / Packing carguera referencial",
    "REFERENCIAL",
    "referential"
  );

  registerInvoiceDoc(
    "INVOICE_PACKING_REAL",
    "Invoice / Packing carguera real demo",
    "REAL DEMO / VALIDADO INTERNAMENTE",
    "real-demo"
  );
})();
