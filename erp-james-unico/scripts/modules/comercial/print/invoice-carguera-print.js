(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  function validateInvoice(context) {
    const { order, brand, metrics, airline, dae } = context;
    const localSale = utils.isLocalOrder?.(order) || false;
    const transport = utils.normalizeTransportType?.(order.transportType) || String(order.transportType || "AEREO").trim().toUpperCase();
    const errors = [];
    const warnings = [];

    if (!BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order)) {
      errors.push("Falta numero de factura. Guarde el pedido para reservar su secuencial.");
    }
    if (!localSale && !brand) errors.push("Falta marca / cliente final.");
    if (!order.issuedAt) errors.push("Falta fecha de emision.");
    if (!metrics.lines.length) errors.push("Falta detalle de cajas.");
    if (metrics.totalUsd <= 0) errors.push("Falta total USD con precios.");
    if (metrics.lines.some(line => Number(line.unitPrice || 0) <= 0)) {
      errors.push("Hay lineas sin precio unitario.");
    }
    if (!localSale && transport === "AEREO" && order.destination !== "ECUADOR" && !order.daeNumber) {
      errors.push("Falta DAE vigente.");
    }

    if (!localSale && !order.awb) warnings.push("Falta AWB.");
    if (!localSale && !order.hawb) warnings.push("Falta HAWB.");
    if (!localSale && transport === "AEREO" && !airline) warnings.push("Falta linea aerea.");
    if (dae && utils.isDaeNearExpiry(dae)) warnings.push("DAE proxima a caducar.");
    if (brand?.requiresPo && metrics.lines.some(line => !String(line.po || "").trim())) {
      warnings.push("La marca requiere PO por linea.");
    }

    return { errors, warnings };
  }

  function countryCode(value) {
    const normalized = String(value || "").trim().toUpperCase();
    const codes = {
      ECUADOR: "EC",
      USA: "US",
      "UNITED STATES": "US",
      NETHERLANDS: "NL",
      KAZAJSTAN: "KZ",
      KAZAKHSTAN: "KZ",
      "REPUBLICA DOMINICANA": "DO",
      RUSIA: "RU",
      RUSSIA: "RU"
    };
    return codes[normalized] || normalized.slice(0, 2) || "-";
  }

  function aggregatePieceTypes(context) {
    const rows = new Map();
    context.boxGroups.forEach(group => {
      const code = group.boxType || "-";
      const definition = utils.findBoxType(code);
      if (!rows.has(code)) {
        rows.set(code, {
          code,
          pieces: 0,
          fulls: 0,
          stems: 0,
          totalUsd: 0
        });
      }
      const row = rows.get(code);
      row.pieces += 1;
      row.fulls += Number(definition?.fullEquivalent || 0);
      row.stems += Number(group.totalStems || 0);
      row.totalUsd += Number(group.totalUsd || 0);
    });
    return [...rows.values()].map(row => ({
      ...row,
      unitPrice: row.stems > 0 ? row.totalUsd / row.stems : 0
    }));
  }

  function renderInvoice(context) {
    const { company, order, customer, brand, agency, airline, dae, metrics } = context;
    const localSale = utils.isLocalOrder?.(order) || false;
    const transport = utils.normalizeTransportType?.(order.transportType) || String(order.transportType || "AEREO").trim().toUpperCase();
    const invoiceNumber = BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order, "PENDIENTE") || "PENDIENTE";
    const pieceRows = aggregatePieceTypes(context);
    const consignee = localSale ? customer : brand;
    const consigneeName = consignee?.finalClientName || consignee?.name || consignee?.legalName || consignee?.commercialName || "-";
    const consigneeAddress = consignee?.printedInvoiceAddress || consignee?.address || "-";
    const consigneeLocation = [consignee?.city, consignee?.country || order.destinationCountry].filter(Boolean).join(", ");
    const marketingName = String(company.commercialName || company.legalName || "EMPRESA").toUpperCase();
    const shipperLegalName = String(company.ruc || "").trim() === "1717637084001"
      ? "MANUEL CLEMENTE LANCHIMBA TUTILLO"
      : String(company.legalName || company.commercialName || "EMPRESA").toUpperCase();
    const preparedBy = order.seller_name
      || order.sellerName
      || order.vendedorNombre
      || "VENDEDOR NO REGISTRADO";
    const reference = order.generalPo || order.customerPo || order.sourcePoNumber || "-";
    const countPieces = (...codes) => pieceRows
      .filter(row => codes.includes(String(row.code || "").trim().toUpperCase()))
      .reduce((total, row) => total + Number(row.pieces || 0), 0);
    const pieceSummary = {
      qb: countPieces("QB"),
      hb: countPieces("HB"),
      sb: countPieces("SB"),
      oct: countPieces("OCT", "EB")
    };
    const pieceMarkup = pieceRows.map(row => `
      <tr>
        <td class="center">${utils.esc(row.code)}</td>
        <td class="center">${utils.esc(row.pieces)}</td>
        <td class="center">${utils.esc(row.fulls.toFixed(2))}</td>
        <td class="center">ROSES</td>
        <td class="center">0603.11.00.60</td>
        <td class="center">0603.11.00.00</td>
        <td class="center">${utils.esc(utils.number(row.stems))}</td>
        <td class="numeric">${utils.esc(row.unitPrice.toFixed(4))}</td>
        <td class="numeric">${utils.esc(utils.money(row.totalUsd))}</td>
      </tr>
    `).join("");

    return `
      <article class="doc-page commercial-invoice-letter">
        <header class="commercial-invoice-title">
          <h1>COMMERCIAL INVOICE NO. ${utils.esc(invoiceNumber)}</h1>
        </header>

        <section class="commercial-invoice-top">
          <div class="commercial-invoice-left">
            <div class="commercial-field-group">
              <h2>Shipper Name And Address</h2>
              <div class="commercial-bordered-block commercial-shipper">
                ${printUtils.renderCompanyBrand(company, {
                  compact: true,
                  displayName: shipperLegalName
                })}
                <span>${utils.esc(company.address)}</span>
                ${company.address2 ? `<span>${utils.esc(company.address2)}</span>` : ""}
                <span>${utils.esc(company.city)}</span>
                <span>Phone: ${utils.esc(company.phone || "-")}</span>
                <span>Email: ${utils.esc(company.email || "-")}</span>
                <span>R.U.C.: ${utils.esc(company.ruc || "-")}</span>
              </div>
            </div>

            <div class="commercial-field-group">
              <h2>Marketing Name</h2>
              <div class="commercial-bordered-block commercial-marketing-name">${utils.esc(marketingName)}</div>
            </div>

            <div class="commercial-field-group commercial-consignee-group">
              <h2>Consignee Name and Address</h2>
              <div class="commercial-bordered-block commercial-consignee">
                <strong>${utils.esc(consigneeName)}</strong>
                <span>${utils.esc(consigneeAddress)}</span>
                <span>${utils.esc(consigneeLocation || "-")}</span>
                <span>Phone: ${utils.esc(consignee?.phone || consignee?.fixedPhone || "-")}</span>
                <span>Email: ${utils.esc(consignee?.email || consignee?.billingEmail || "-")}</span>
                <span>Attn: ${utils.esc(consignee?.contact || consigneeName)}</span>
              </div>
            </div>
          </div>

          <div class="commercial-invoice-right">
            <div class="commercial-logistics-pair">
              <div class="commercial-field-group"><h2>Farm Code:</h2><div class="commercial-bordered-value">${utils.esc(company.farmCode || "BLE")}</div></div>
              <div class="commercial-field-group"><h2>Date:</h2><div class="commercial-bordered-value">${utils.esc(utils.dateLabel(order.issuedAt))}</div></div>
            </div>
            <div class="commercial-logistics-pair">
              <div class="commercial-field-group"><h2>Incoterm:</h2><div class="commercial-bordered-value">${utils.esc(company.incoterm || "FCA")}</div></div>
              <div class="commercial-field-group"><h2>Country Code:</h2><div class="commercial-bordered-value">${utils.esc(company.originCountryAlpha2 || "EC")}</div></div>
            </div>
            <div class="commercial-field-group"><h2>${transport === "MARITIMO" ? "Mother Guide / Guía madre" : "MAWB No."}</h2><div class="commercial-bordered-value">${utils.esc(order.awb || "-")}</div></div>
            <div class="commercial-field-group"><h2>${transport === "MARITIMO" ? "Child Guide / Guía hija" : "HAWB No."}</h2><div class="commercial-bordered-value">${utils.esc(order.hawb || "-")}</div></div>
            <div class="commercial-field-group"><h2>${transport === "MARITIMO" ? "Carrier / Transporte" : "Airline"}</h2><div class="commercial-bordered-value">${utils.esc(transport === "MARITIMO" ? "MARÍTIMO" : [airline?.name, order.flightNumber].filter(Boolean).join(" / ") || "-")}</div></div>
            <div class="commercial-field-group"><h2>Cold Room / Cuarto frio</h2><div class="commercial-bordered-value">${utils.esc(order.coldRoom || agency?.coldRoom || "-")}</div></div>
            ${!localSale ? `<div class="commercial-logistics-pair commercial-logistics-last">
              <div class="commercial-field-group">
                <h2>DAE No.</h2>
                <div class="commercial-dae-values">
                  <div class="commercial-bordered-value">${utils.esc(order.daeNumber || "DAE PENDIENTE")}</div>
                  <div class="commercial-bordered-value">${utils.esc(order.daeNumber ? utils.dateLabel(dae?.expirationDate || order.flightDate) : "NO ASIGNADA")}</div>
                </div>
              </div>
            </div>` : ""}
          </div>
        </section>

        <table class="commercial-invoice-table">
          <thead><tr><th>PIECE<br>TYPE</th><th>TOTAL<br>PIECES</th><th>EQ. FULL<br>BOXES</th><th>PRODUCT<br>DESCRIPTION</th><th>HTS</th><th>NANDINA</th><th>TOTAL-UNIT<br>STEMS</th><th>UNIT-PRICE<br>PER/STEM</th><th>TOTAL<br>VALUE-USD</th></tr></thead>
          <tbody>${pieceMarkup || `<tr><td colspan="9">Sin detalle de cajas.</td></tr>`}</tbody>
        </table>

        <section class="commercial-invoice-totals">
          <div><strong>TOTAL</strong><span>${utils.esc(metrics.totalBoxes)}</span><span>${utils.esc(metrics.totalFulls.toFixed(2))}</span></div>
          <strong>${utils.esc(utils.number(metrics.totalStems))}</strong>
          <strong>${utils.esc(utils.money(metrics.totalUsd))}</strong>
        </section>

        <section class="commercial-invoice-bill">
          <strong>BILL TO</strong><div>${utils.esc(consigneeName)}</div>
        </section>

        <section class="commercial-invoice-box-summary" aria-label="Resumen de cajas de la factura">
          <div class="commercial-invoice-box-summary-total"><span>TOTAL FULLS</span><strong>${utils.esc(metrics.totalFulls.toFixed(2))}</strong></div>
          <div><span>QB</span><strong>${utils.esc(pieceSummary.qb)}</strong></div>
          <div><span>HB</span><strong>${utils.esc(pieceSummary.hb)}</strong></div>
          <div><span>SB</span><strong>${utils.esc(pieceSummary.sb)}</strong></div>
          <div><span>OCT</span><strong>${utils.esc(pieceSummary.oct)}</strong></div>
        </section>

        <section class="commercial-invoice-final-grid">
          <div class="commercial-invoice-final-field">
            <h2>Name and Title of Person Preparing Invoice</h2>
            <div><strong>${utils.esc(preparedBy)}</strong><span>VENDEDOR / SALES REPRESENTATIVE</span></div>
          </div>
          <div class="commercial-invoice-final-field">
            <h2>Freight Forwarder / Agencia de carga</h2>
            <div><strong>${utils.esc(localSale ? "NO APLICA" : agency?.name || "-")}</strong><span>${utils.esc(localSale ? "RETIRA EN FINCA" : order.coldRoom || agency?.coldRoom || "-")}</span></div>
          </div>
        </section>

        <footer class="commercial-invoice-declaration">
          <strong>The Flowers and Foliage on this invoice were wholly grown in Ecuador.</strong>
          <p>"El exportador de los productos incluidos en el presente documento (R.U.C. No. ${utils.esc(company.ruc || "-")}) declara que, salvo indicacion en sentido contrario, estos productos gozan de un origen preferencial de Ecuador."</p>
          <p>The exporter of the products covered by this document declares that, except where otherwise clearly indicated, these products are of Ecuador preferential origin.</p>
          <div><strong>PO ID:</strong> ${utils.esc(reference)}</div>
          <div><strong>CUSTOMER REF:</strong> ${utils.esc(consignee?.code || "-")}</div>
        </footer>
      </article>
    `;
  }

  function registerInvoiceDoc(code, name, stamp, stampClass) {
    BlessERP.comercialPrintDocs[code] = {
      code,
      name,
      description: "Formato comercial de carguera basado en el pedido activo de Crear pedido.",
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
