(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const printUtils = BlessERP.comercialPrintUtils;
  const queueCore = BlessERP.comercialSriOrderQueueCore;

  BlessERP.comercialPrintDocs = BlessERP.comercialPrintDocs || {};

  const forbiddenXmlPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

  const countryCodes = Object.freeze({
    ECUADOR: "593",
    USA: "110",
    "UNITED STATES": "110",
    "ESTADOS UNIDOS": "110",
    KAZAJSTAN: "348",
    KAZAKHSTAN: "348",
    NETHERLANDS: "215",
    "PAISES BAJOS": "215",
    "REPUBLICA DOMINICANA": "122",
    RUSIA: "230",
    RUSSIA: "230"
  });
  const legacyIsoCountryCodes = Object.freeze({
    "840": "110",
    "398": "348",
    "528": "215",
    "214": "122",
    "643": "230"
  });

  function normalizeSriText(value, maxLength = 300) {
    return String(value ?? "")
      .normalize("NFC")
      .replace(forbiddenXmlPattern, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function accessKeyDigits(order) {
    return String(order?.sriAccessKey || "").replace(/\D+/g, "");
  }

  function modulo11(value) {
    let factor = 2;
    let sum = 0;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      sum += Number(value[index]) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const result = 11 - (sum % 11);
    if (result === 11) return 0;
    if (result === 10) return 1;
    return result;
  }

  function validAccessKey(value) {
    return /^[0-9]{49}$/.test(value) && modulo11(value.slice(0, 48)) === Number(value[48]);
  }

  function invoiceParts(order) {
    const match = /^(\d{3})-(\d{3})-(\d{9})$/.exec(String(order?.sriInvoiceNumber || "").trim());
    return match ? { estab: match[1], ptoEmi: match[2], secuencial: match[3] } : null;
  }

  function guideLabel(order) {
    return [...new Set([
      order?.sriGuides,
      order?.awb,
      order?.hawb
    ].map(value => normalizeSriText(value, 50)).filter(Boolean))].join(" / ");
  }

  function destinationCode(order, brand) {
    const explicit = String(order?.destinationCountryCode || "").replace(/\D+/g, "");
    if (/^\d{3}$/.test(explicit)) return legacyIsoCountryCodes[explicit] || explicit;
    const label = normalizeSriText(brand?.country || order?.destinationCountry || order?.destination).toUpperCase();
    return countryCodes[label] || "";
  }

  function validateAuthorization(order) {
    const errors = [];
    const warnings = [];
    const status = String(order?.sriAuthorizationStatus || "PENDIENTE").toUpperCase();
    const accessKey = accessKeyDigits(order);
    const authorization = String(order?.sriAuthorizationNumber || "").replace(/\D+/g, "");

    if (status !== "AUTORIZADO") errors.push("La factura SRI no consta como AUTORIZADA.");
    if (!invoiceParts(order)) errors.push("El numero de factura SRI debe usar 000-000-000000000.");
    if (!/^[0-9]{49}$/.test(authorization)) errors.push("El numero de autorizacion SRI debe contener 49 digitos.");
    if (!validAccessKey(accessKey)) errors.push("La clave de acceso SRI no es valida o no supera modulo 11.");
    if (!String(order?.sriAuthorizedAt || "").trim()) errors.push("Falta la fecha de autorizacion SRI.");
    if (authorization && accessKey && authorization !== accessKey) warnings.push("La autorizacion registrada difiere de la clave de acceso.");

    return { authorized: !errors.length, status, accessKey, authorization, errors, warnings };
  }

  function validateRide(context) {
    const review = validateAuthorization(context.order);
    const errors = [...review.errors];
    const warnings = [...review.warnings];
    const { company, customer, brand, metrics, order } = context;
    const exportOrder = queueCore?.isExportOrder ? queueCore.isExportOrder(order, brand) : String(order?.destinationCountry || order?.destination || "").toUpperCase() !== "ECUADOR";
    const fiscalDae = queueCore?.sriDae ? queueCore.sriDae(order, brand) : normalizeSriText(order?.sriDaeNumber || (String(order?.transportType || "").toLowerCase() === "aereo" ? order?.daeNumber : ""), 50);

    if (!/^\d{13}$/.test(String(company?.ruc || ""))) errors.push("El RUC del emisor debe contener 13 digitos.");
    if (!customer) errors.push("Falta cliente principal.");
    if (!normalizeSriText(customer?.legalName || customer?.commercialName)) errors.push("Falta la razon social del comprador.");
    if (!normalizeSriText(customer?.identification, 20)) errors.push("Falta la identificacion del comprador.");
    if (exportOrder && !brand) errors.push("Falta la marca o cliente final de la exportacion.");
    if (exportOrder && !fiscalDae) errors.push("Falta la DAE fiscal para informacion adicional.");
    if (exportOrder && !normalizeSriText(order?.awb, 50)) errors.push("La exportacion requiere guia madre para el RIDE.");
    if (exportOrder && !normalizeSriText(order?.hawb, 50)) errors.push("La exportacion requiere guia hija para el RIDE.");
    if (exportOrder && !destinationCode(order, brand)) errors.push("Falta el codigo numerico SRI del pais de destino.");
    if (!metrics.lines.length) errors.push("Falta detalle de productos.");
    if (Number(metrics.totalStems || 0) <= 0) errors.push("La factura debe contener una cantidad de tallos mayor que cero.");
    if (Number(metrics.totalUsd || 0) <= 0) errors.push("El total de la factura SRI debe ser mayor que cero.");

    const fields = [
      company?.legalName, company?.commercialName, company?.address,
      customer?.legalName, customer?.commercialName, customer?.address,
      brand?.name, brand?.finalClientName, fiscalDae, order?.sriGuides, order?.awb, order?.hawb
    ];
    if (fields.some(value => String(value ?? "") !== normalizeSriText(value))) {
      warnings.push("Se normalizaran espacios, saltos de linea o caracteres de control antes de generar el documento.");
    }
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }

  function renderRide(context) {
    const { company, customer, brand, metrics, order } = context;
    const provider = BlessERP.softwareProvider?.profile || BlessERP.softwareProvider || {};
    const review = validateAuthorization(order);
    const logoUrl = printUtils.companyLogoUrl(company);
    const quantity = Number(metrics.totalStems || 0);
    const unitPrice = quantity ? Number(metrics.totalUsd || 0) / quantity : 0;
    const total = Number(metrics.totalUsd || 0);
    const accountingRequired = company.accountingRequired === false ? "NO" : "SI";
    const environment = normalizeSriText(order.sriEnvironment || company.sriEnvironment || "PRUEBAS", 20).toUpperCase();
    const paymentLabel = normalizeSriText(order.paymentMethodLabel || order.paymentTerms || "20 - OTROS CON UTILIZACION DEL SISTEMA FINANCIERO", 100);
    const exportOrder = queueCore?.isExportOrder ? queueCore.isExportOrder(order, brand) : String(order?.destinationCountry || order?.destination || "").toUpperCase() !== "ECUADOR";
    const fiscalDae = queueCore?.sriDae ? queueCore.sriDae(order, brand) : normalizeSriText(order.sriDaeNumber || (order.transportType === "aereo" ? order.daeNumber : ""), 50);
    const customerEmail = normalizeSriText(
      customer?.email || customer?.billingEmail || customer?.contactEmail || order?.customerEmail,
      300
    );
    const authorizationDate = String(order?.sriAuthorizedAt || "").slice(0, 10);
    const payloadResult = queueCore?.buildInvoicePayload?.({
      ...context,
      today: /^\d{4}-\d{2}-\d{2}$/.test(authorizationDate) ? authorizationDate : undefined
    });
    const rideLines = payloadResult?.ok && payloadResult.payload?.lines?.length
      ? payloadResult.payload.lines
      : [{
        mainCode: "ROSES",
        quantity,
        description: "ROSES",
        measure: "",
        unitPrice,
        subtotal: total
      }];
    const detailRows = rideLines.map((line, index) => `
      <tr>
        <td>${utils.esc(line.mainCode || String(index + 1))}</td>
        <td>${utils.esc(line.auxiliaryCode || "0")}</td>
        <td class="numeric">${utils.esc(Number(line.quantity || 0).toFixed(2))}</td>
        <td><strong>${utils.esc(line.description || "ROSES")}</strong></td>
        <td>${utils.esc(line.measure || "")}</td>
        <td class="numeric">${utils.esc(Number(line.unitPrice || 0).toFixed(6))}</td>
        <td class="numeric">0.00</td>
        <td class="numeric">0.00</td>
        <td class="numeric">0.00</td>
        <td class="numeric">${utils.esc(Number(line.subtotal || 0).toFixed(2))}</td>
      </tr>
    `).join("");
    const localAdditionalRows = `
      <div><span>Direccion:</span><strong>${utils.esc(normalizeSriText(customer?.address || "-"))}</strong></div>
      <div><span>Telefono:</span><strong>${utils.esc(normalizeSriText(customer?.phone || order?.customerPhone || "-"))}</strong></div>
      <div><span>Email:</span><strong>${utils.esc(customerEmail || "-")}</strong></div>
      <div><span>RUC Proveedor:</span><strong>${utils.esc(provider.ruc || "-")}</strong></div>
    `;
    const exportAdditionalRows = `
      <div><span>Correo cliente:</span><strong>${utils.esc(customerEmail || "-")}</strong></div>
      <div><span>Guias:</span><strong>${utils.esc(guideLabel(order) || "-")}</strong></div>
      <div><span>Piezas:</span><strong>${utils.esc(String(metrics.totalBoxes || order.totalBoxes || "-"))}</strong></div>
      <div><span>Marca / cliente final:</span><strong>${utils.esc(normalizeSriText(brand?.name || brand?.finalClientName) || "-")}</strong></div>
      <div><span>DAE:</span><strong>${utils.esc(fiscalDae || "-")}</strong></div>
      <div><span>RUC Proveedor:</span><strong>${utils.esc(provider.ruc || "-")}</strong></div>
    `;

    return `
      <article class="doc-page invoice-a4-page sri-ride-page sri-traditional-ride">
        <section class="sri-traditional-top">
          <div class="sri-traditional-issuer">
            <div class="sri-traditional-logo"><img src="${utils.esc(logoUrl)}" alt="${utils.esc(company.commercialName || company.legalName || "Empresa")}"></div>
            <strong>${utils.esc(normalizeSriText(company.legalName || company.commercialName))}</strong>
            <span>${utils.esc(normalizeSriText(company.commercialName || ""))}</span>
            <dl>
              <dt>Direccion Matriz:</dt><dd>${utils.esc(normalizeSriText(company.address || "-"))}</dd>
              <dt>Direccion Sucursal:</dt><dd>${utils.esc(normalizeSriText(company.address2 || company.address || "-"))}</dd>
              <dt>OBLIGADO A LLEVAR CONTABILIDAD</dt><dd>${utils.esc(accountingRequired)}</dd>
              ${company.withholdingAgentNumber ? `<dt>AGENTE DE RETENCION</dt><dd>${utils.esc(company.withholdingAgentNumber)}</dd>` : ""}
              ${company.habitualExporterLegend ? `<dt>CALIFICACION</dt><dd>${utils.esc(company.habitualExporterLegend)}</dd>` : ""}
            </dl>
          </div>
          <div class="sri-traditional-fiscal">
            <div class="sri-traditional-ruc">R.U.C.: <strong>${utils.esc(company.ruc)}</strong></div>
            <h1>${exportOrder ? "FACTURA DE EXPORTACION" : "FACTURA"}</h1>
            <div class="sri-traditional-number"><span>No.</span><strong>${utils.esc(order.sriInvoiceNumber || "-")}</strong></div>
            <label>NUMERO DE AUTORIZACION</label>
            <strong class="sri-traditional-wrap">${utils.esc(review.authorization || "-")}</strong>
            <div class="sri-traditional-fiscal-grid">
              <span>FECHA Y HORA DE AUTORIZACION</span><strong>${utils.esc(order.sriAuthorizedAt || "-")}</strong>
              <span>AMBIENTE</span><strong>${utils.esc(environment)}</strong>
              <span>EMISION</span><strong>NORMAL</strong>
            </div>
            <label>CLAVE DE ACCESO</label>
            <div class="sri-traditional-barcode">${BlessERP.code128.barcodeSvg(review.accessKey, { className: "sri-access-key-svg", height: 54, quietZone: 8 })}</div>
            <strong class="sri-traditional-access">${utils.esc(review.accessKey || "SIN CLAVE DE ACCESO")}</strong>
          </div>
        </section>

        <section class="sri-traditional-buyer">
          <div><span>Razon Social / Nombres y Apellidos:</span><strong>${utils.esc(normalizeSriText(customer?.legalName || customer?.commercialName))}</strong></div>
          <div><span>Identificacion:</span><strong>${utils.esc(normalizeSriText(customer?.identification, 20))}</strong></div>
          <div><span>Fecha:</span><strong>${utils.esc(utils.dateLabel(order.issuedAt))}</strong></div>
          <div><span>Direccion:</span><strong>${utils.esc(normalizeSriText(customer?.address || "-"))}</strong></div>
          <div><span>Placa / Matricula:</span><strong>-</strong></div>
          <div><span>Guia:</span><strong>${utils.esc(guideLabel(order) || "-")}</strong></div>
        </section>

        <table class="invoice-a4-table sri-traditional-detail">
          <thead><tr><th>Cod. Principal</th><th>Cod. Auxiliar</th><th>Cantidad</th><th>Descripcion</th><th>Detalle Adicional</th><th>Precio Unitario</th><th>Subsidio</th><th>Precio sin Subsidio</th><th>Descuento</th><th>Precio Total</th></tr></thead>
          <tbody>${detailRows}</tbody>
        </table>

        <section class="sri-traditional-bottom">
          <div>
            <section class="sri-traditional-additional">
              <h2>Informacion Adicional</h2>
              ${exportOrder ? exportAdditionalRows : localAdditionalRows}
            </section>
            <table class="sri-traditional-payment">
              <thead><tr><th>Forma de pago</th><th>Valor</th></tr></thead>
              <tbody><tr><td>${utils.esc(paymentLabel)}</td><td class="numeric">${utils.esc(total.toFixed(2))}</td></tr></tbody>
            </table>
          </div>
          <table class="sri-traditional-totals">
            <tbody>
              <tr><td>SUBTOTAL 0%</td><td>${utils.esc(total.toFixed(2))}</td></tr>
              <tr><td>SUBTOTAL NO OBJETO DE IVA</td><td>0.00</td></tr>
              <tr><td>SUBTOTAL EXENTO DE IVA</td><td>0.00</td></tr>
              <tr><td>SUBTOTAL SIN IMPUESTOS</td><td>${utils.esc(total.toFixed(2))}</td></tr>
              <tr><td>TOTAL DESCUENTO</td><td>0.00</td></tr>
              <tr><td>ICE</td><td>0.00</td></tr>
              <tr><td>IRBPNR</td><td>0.00</td></tr>
              <tr><td>PROPINA</td><td>0.00</td></tr>
              <tr class="total"><td>VALOR TOTAL</td><td>${utils.esc(total.toFixed(2))}</td></tr>
            </tbody>
          </table>
        </section>
        <p class="sri-ride-legal">Representacion impresa del comprobante electronico autorizado. El XML firmado y la respuesta de autorizacion se conservan en el modulo SRI.</p>
      </article>
    `;
  }

  function buildXml(order, appState) {
    const context = printUtils.buildContext(order, appState);
    const validation = validateRide(context);
    if (validation.errors.length) return { ok: false, errors: validation.errors, warnings: validation.warnings, xml: "", fileName: "" };

    const storedXml = String(order?.sriAuthorizedXml || "").trim();
    if (!storedXml) {
      return {
        ok: false,
        errors: ["No existe un XML autorizado almacenado para esta factura. Genere, firme y autorice el comprobante desde el modulo SRI."],
        warnings: validation.warnings,
        xml: "",
        fileName: ""
      };
    }
    if (!storedXml.includes(context.order.sriAuthorizationNumber) || !storedXml.includes(accessKeyDigits(context.order))) {
      return { ok: false, errors: ["El XML almacenado no coincide con la autorizacion y clave de acceso registradas."], warnings: validation.warnings, xml: "", fileName: "" };
    }
    return {
      ok: true,
      errors: [],
      warnings: validation.warnings,
      xml: storedXml,
      fileName: `factura-sri-${String(context.order.sriInvoiceNumber).replace(/[^0-9A-Za-z-]+/g, "-")}.xml`
    };
  }

  function downloadXml(order, appState) {
    const result = buildXml(order, appState);
    if (!result.ok) return result;
    const url = URL.createObjectURL(new Blob([result.xml], { type: "application/xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return result;
  }

  BlessERP.comercialPrintDocs.SRI_RIDE = {
    code: "SRI_RIDE",
    name: "RIDE Factura SRI",
    description: "Representacion impresa A4 de una factura local o de exportacion autorizada por el SRI.",
    validate: validateRide,
    render: renderRide
  };

  BlessERP.comercialSriDocuments = {
    accessKeyDigits,
    buildXml,
    downloadXml,
    normalizeSriText,
    validateAuthorization,
    validateRide
  };
})();
