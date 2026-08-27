const { create } = require("xmlbuilder2");
const { SriValidationError } = require("./errors.cjs");
const { validateAccessKey } = require("./access-key.cjs");
const softwareProvider = require("../../../scripts/config/software-provider.js");

const ENABLED_XML_VERSIONS = Object.freeze({
  "01": new Set(["1.1.0"]),
  "04": new Set(["1.1.0"]),
  "06": new Set(["1.1.0"]),
  "07": new Set(["2.0.0"])
});

const XML_FORBIDDEN_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function normalizeSriText(value, maxLength = null) {
  const normalized = String(value ?? "")
    .normalize("NFC")
    .replace(XML_FORBIDDEN_CHARACTERS, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return Number.isInteger(maxLength) ? normalized.slice(0, maxLength) : normalized;
}

function required(value, label) {
  const normalized = normalizeSriText(value);
  if (!normalized) throw new SriValidationError(`${label} es obligatorio.`);
  return normalized;
}

function decimal(value, digits = 2) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new SriValidationError("Se encontro un valor numerico invalido.");
  }
  return number.toFixed(digits);
}

function dateSri(value, label = "La fecha") {
  const raw = required(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw new SriValidationError(`${label} debe usar YYYY-MM-DD.`);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function digits(value, length, label) {
  const normalized = required(value, label).replace(/[^0-9]/g, "");
  if (normalized.length !== length) {
    throw new SriValidationError(`${label} debe contener ${length} digitos.`);
  }
  return normalized;
}

function fiscalPeriod(value, issueDate) {
  const normalized = normalizeSriText(value);
  if (/^(0[1-9]|1[0-2])\/20[0-9]{2}$/.test(normalized)) return normalized;
  const match = /^(20[0-9]{2})-(0[1-9]|1[0-2])-[0-9]{2}$/.exec(required(issueDate, "Fecha de emision"));
  if (!match) throw new SriValidationError("El periodo fiscal debe usar MM/YYYY.");
  return `${match[2]}/${match[1]}`;
}

function addText(parent, name, value, options = {}) {
  const normalized = normalizeSriText(value, options.maxLength || null);
  if (!normalized) {
    if (options.required) throw new SriValidationError(`${options.label || name} es obligatorio.`);
    return null;
  }
  return parent.ele(name).txt(normalized).up();
}

function addTributaryInfo(root, document) {
  const issuer = document.issuer || {};
  const info = root.ele("infoTributaria");
  addText(info, "ambiente", document.environmentCode, { required: true, label: "Ambiente" });
  addText(info, "tipoEmision", document.emissionType || "1", { required: true, label: "Tipo de emision" });
  addText(info, "razonSocial", issuer.legalName, { required: true, label: "Razon social del emisor" });
  addText(info, "nombreComercial", issuer.commercialName);
  addText(info, "ruc", issuer.ruc, { required: true, label: "RUC del emisor" });
  if (!validateAccessKey(document.accessKey)) throw new SriValidationError("La clave de acceso no supera modulo 11.");
  addText(info, "claveAcceso", document.accessKey, { required: true });
  addText(info, "codDoc", document.documentType, { required: true });
  addText(info, "estab", document.establishmentCode, { required: true });
  addText(info, "ptoEmi", document.emissionPointCode, { required: true });
  addText(info, "secuencial", document.sequential, { required: true });
  addText(info, "dirMatriz", issuer.headOfficeAddress, { required: true, label: "Direccion matriz" });
  addText(info, "agenteRetencion", issuer.withholdingAgentNumber);
  addText(info, "contribuyenteRimpe", issuer.rimpeLabel);
  return info;
}

function assertVersion(documentType, version) {
  const normalized = required(version, "Version XML");
  if (!ENABLED_XML_VERSIONS[documentType]?.has(normalized)) {
    throw new SriValidationError(`La version XML ${normalized} no esta habilitada para ${documentType}.`);
  }
  return normalized;
}

function addAdditionalInformation(root, values = {}) {
  const rows = Object.entries(softwareProvider.mergeAdditionalInformation(values))
    .filter(([, value]) => normalizeSriText(value))
    .slice(0, 15);
  if (!rows.length) return;
  const info = root.ele("infoAdicional");
  rows.forEach(([name, value]) => {
    info.ele("campoAdicional", { nombre: normalizeSriText(name, 300) })
      .txt(normalizeSriText(value, 300))
      .up();
  });
}

function issuerAdditionalInformation(values = {}, issuer = {}) {
  const legend = normalizeSriText(issuer.habitualExporterLegend, 300);
  return legend
    ? { ...values, "Calificacion tributaria": legend }
    : values;
}

function normalizeTaxes(taxes, base) {
  const rows = Array.isArray(taxes) && taxes.length ? taxes : [{
    code: "2",
    percentageCode: "0",
    rate: 0,
    taxableBase: base,
    value: 0
  }];
  return rows.map(item => ({
    code: required(item.code, "Codigo de impuesto"),
    percentageCode: required(item.percentageCode, "Codigo de porcentaje"),
    rate: Number(item.rate || 0),
    taxableBase: Number(item.taxableBase ?? base ?? 0),
    value: Number(item.value || 0),
    discountAdditional: item.discountAdditional == null ? null : Number(item.discountAdditional),
    refundValue: item.refundValue == null ? null : Number(item.refundValue)
  }));
}

function addTaxTotals(parent, taxes, creditNote = false) {
  const totals = parent.ele("totalConImpuestos");
  taxes.forEach(tax => {
    const row = totals.ele("totalImpuesto");
    addText(row, "codigo", tax.code, { required: true });
    addText(row, "codigoPorcentaje", tax.percentageCode, { required: true });
    if (!creditNote && tax.discountAdditional != null) addText(row, "descuentoAdicional", decimal(tax.discountAdditional));
    addText(row, "baseImponible", decimal(tax.taxableBase), { required: true });
    if (!creditNote && tax.rate != null) addText(row, "tarifa", decimal(tax.rate));
    addText(row, "valor", decimal(tax.value), { required: true });
    if (tax.refundValue != null) addText(row, "valorDevolucionIva", decimal(tax.refundValue));
  });
}

function addLineTaxes(parent, taxes) {
  const wrapper = parent.ele("impuestos");
  taxes.forEach(tax => {
    const row = wrapper.ele("impuesto");
    addText(row, "codigo", tax.code, { required: true });
    addText(row, "codigoPorcentaje", tax.percentageCode, { required: true });
    addText(row, "tarifa", decimal(tax.rate), { required: true });
    addText(row, "baseImponible", decimal(tax.taxableBase), { required: true });
    addText(row, "valor", decimal(tax.value), { required: true });
  });
}

function addLineDetails(parent, details = {}) {
  const rows = Object.entries(details || {}).filter(([, value]) => normalizeSriText(value)).slice(0, 3);
  if (!rows.length) return;
  const wrapper = parent.ele("detallesAdicionales");
  rows.forEach(([name, value]) => wrapper.ele("detAdicional", {
    nombre: normalizeSriText(name, 300),
    valor: normalizeSriText(value, 300)
  }).up());
}

function buildInvoiceXml(payload = {}) {
  const document = payload.document || {};
  const invoice = payload.invoice || {};
  const buyer = payload.buyer || {};
  const version = assertVersion("01", document.version || "1.1.0");
  const exportInvoice = String(invoice.commerceType || "").toUpperCase() === "EXPORTADOR"
    || (
      String(invoice.commerceType || "").toUpperCase() !== "LOCAL"
      && Boolean(invoice.incoterm || invoice.originCountryCode || invoice.destinationCountryCode)
    );
  if (!Array.isArray(payload.lines) || !payload.lines.length) {
    throw new SriValidationError("La factura debe contener al menos una linea.");
  }

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("factura", { id: "comprobante", version });
  addTributaryInfo(root, { ...document, documentType: "01" });

  const info = root.ele("infoFactura");
  addText(info, "fechaEmision", dateSri(document.issueDate, "Fecha de emision"), { required: true });
  addText(info, "dirEstablecimiento", document.establishmentAddress);
  addText(info, "contribuyenteEspecial", document.issuer?.specialTaxpayerNumber);
  addText(info, "obligadoContabilidad", document.issuer?.accountingRequired === false ? "NO" : "SI");
  if (exportInvoice) {
    addText(info, "comercioExterior", "EXPORTADOR", { required: true });
    addText(info, "incoTermFactura", invoice.incoterm, { required: true, label: "Incoterm" });
    addText(info, "lugarIncoTerm", invoice.incotermPlace, { required: true, label: "Lugar del Incoterm" });
    addText(info, "paisOrigen", invoice.originCountryCode, { required: true, label: "Pais de origen" });
    addText(info, "puertoEmbarque", invoice.portOfLoading, { required: true, label: "Puerto de embarque" });
    addText(info, "puertoDestino", invoice.portOfDestination, { required: true, label: "Puerto de destino" });
    addText(info, "paisDestino", invoice.destinationCountryCode, { required: true, label: "Pais de destino" });
    addText(info, "paisAdquisicion", invoice.acquisitionCountryCode);
  }
  addText(info, "tipoIdentificacionComprador", buyer.identificationType || "08", { required: true });
  addText(info, "razonSocialComprador", buyer.legalName, { required: true, label: "Comprador" });
  addText(info, "identificacionComprador", buyer.identification, { required: true, label: "Identificacion del comprador" });
  addText(info, "direccionComprador", buyer.address, { required: true, label: "Direccion del comprador" });

  const totalWithoutTax = Number(invoice.totalWithoutTax ?? payload.lines.reduce((sum, line) => sum + Number(line.subtotal || 0), 0));
  const taxes = normalizeTaxes(payload.taxes, totalWithoutTax);
  const taxTotal = taxes.reduce((sum, tax) => sum + Number(tax.value || 0), 0);
  const grandTotal = Number(invoice.grandTotal ?? (totalWithoutTax - Number(invoice.discountTotal || 0) + taxTotal));
  addText(info, "totalSinImpuestos", decimal(totalWithoutTax), { required: true });
  if (exportInvoice) {
    addText(info, "incoTermTotalSinImpuestos", invoice.totalWithoutTaxIncoterm || invoice.incoterm, { required: true });
  }
  addText(info, "totalDescuento", decimal(invoice.discountTotal || 0), { required: true });
  addTaxTotals(info, taxes);
  addText(info, "propina", decimal(invoice.tip || 0), { required: true });
  if (exportInvoice) {
    addText(info, "fleteInternacional", decimal(invoice.internationalFreight || 0), { required: true });
    addText(info, "seguroInternacional", decimal(invoice.internationalInsurance || 0), { required: true });
    addText(info, "gastosAduaneros", decimal(invoice.customsExpenses || 0), { required: true });
    addText(info, "gastosTransporteOtros", decimal(invoice.otherTransportExpenses || 0), { required: true });
  }
  addText(info, "importeTotal", decimal(grandTotal), { required: true });
  addText(info, "moneda", invoice.currency || "USD", { required: true });

  const payments = Array.isArray(invoice.payments) && invoice.payments.length
    ? invoice.payments
    : [{ method: "20", total: grandTotal, term: 0, unit: "dias" }];
  const paymentRoot = info.ele("pagos");
  payments.forEach(payment => {
    const row = paymentRoot.ele("pago");
    addText(row, "formaPago", payment.method, { required: true, label: "Forma de pago" });
    addText(row, "total", decimal(payment.total), { required: true });
    if (Number(payment.term || 0) > 0) addText(row, "plazo", decimal(payment.term));
    if (Number(payment.term || 0) > 0) addText(row, "unidadTiempo", payment.unit || "dias");
  });

  const linesRoot = root.ele("detalles");
  payload.lines.forEach((line, index) => {
    const lineRoot = linesRoot.ele("detalle");
    addText(lineRoot, "codigoPrincipal", line.mainCode || `ITEM-${index + 1}`, { required: true });
    addText(lineRoot, "codigoAuxiliar", line.auxiliaryCode);
    addText(lineRoot, "descripcion", line.description, { required: true, label: `Descripcion linea ${index + 1}` });
    addText(lineRoot, "unidadMedida", line.unit || "UNIDAD");
    addText(lineRoot, "cantidad", decimal(line.quantity, 6), { required: true });
    addText(lineRoot, "precioUnitario", decimal(line.unitPrice, 6), { required: true });
    addText(lineRoot, "descuento", decimal(line.discount || 0), { required: true });
    addText(lineRoot, "precioTotalSinImpuesto", decimal(line.subtotal), { required: true });
    addLineDetails(lineRoot, {
      Variedad: line.variety,
      Medida: line.measure,
      ...(line.additionalDetails || {})
    });
    addLineTaxes(lineRoot, normalizeTaxes(line.taxes, line.subtotal));
  });

  addAdditionalInformation(root, issuerAdditionalInformation(payload.additionalInformation, document.issuer));
  return root.end({ prettyPrint: true });
}

function buildCreditNoteXml(payload = {}) {
  const document = payload.document || {};
  const credit = payload.creditNote || {};
  const buyer = payload.buyer || {};
  const original = payload.originalInvoice || {};
  const version = assertVersion("04", document.version || "1.1.0");
  if (!Array.isArray(payload.lines) || !payload.lines.length) {
    throw new SriValidationError("La nota de credito debe contener al menos una linea.");
  }
  if (original.status !== "AUTORIZADO") {
    throw new SriValidationError("La nota de credito solo puede originarse en una factura autorizada.");
  }

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("notaCredito", { id: "comprobante", version });
  addTributaryInfo(root, { ...document, documentType: "04" });
  const info = root.ele("infoNotaCredito");
  addText(info, "fechaEmision", dateSri(document.issueDate, "Fecha de emision"), { required: true });
  addText(info, "dirEstablecimiento", document.establishmentAddress);
  addText(info, "tipoIdentificacionComprador", buyer.identificationType || "08", { required: true });
  addText(info, "razonSocialComprador", buyer.legalName, { required: true });
  addText(info, "identificacionComprador", buyer.identification, { required: true });
  addText(info, "contribuyenteEspecial", document.issuer?.specialTaxpayerNumber);
  addText(info, "obligadoContabilidad", document.issuer?.accountingRequired === false ? "NO" : "SI");
  addText(info, "codDocModificado", "01", { required: true });
  addText(info, "numDocModificado", original.fullNumber, { required: true, label: "Numero de factura modificada" });
  addText(info, "fechaEmisionDocSustento", dateSri(original.issueDate, "Fecha de factura original"), { required: true });

  const totalWithoutTax = Number(credit.totalWithoutTax ?? payload.lines.reduce((sum, line) => sum + Number(line.subtotal || 0), 0));
  const taxes = normalizeTaxes(payload.taxes, totalWithoutTax);
  const taxTotal = taxes.reduce((sum, tax) => sum + Number(tax.value || 0), 0);
  const modificationValue = Number(credit.modificationValue ?? (totalWithoutTax + taxTotal));
  addText(info, "totalSinImpuestos", decimal(totalWithoutTax), { required: true });
  addText(info, "valorModificacion", decimal(modificationValue), { required: true });
  addText(info, "moneda", credit.currency || "USD", { required: true });
  addTaxTotals(info, taxes, true);
  addText(info, "motivo", credit.reason, { required: true, label: "Motivo de modificacion" });

  const linesRoot = root.ele("detalles");
  payload.lines.forEach((line, index) => {
    const lineRoot = linesRoot.ele("detalle");
    addText(lineRoot, "codigoInterno", line.mainCode || `ITEM-${index + 1}`, { required: true });
    addText(lineRoot, "codigoAdicional", line.auxiliaryCode);
    addText(lineRoot, "descripcion", line.description, { required: true });
    addText(lineRoot, "cantidad", decimal(line.quantity, 6), { required: true });
    addText(lineRoot, "precioUnitario", decimal(line.unitPrice, 6), { required: true });
    addText(lineRoot, "descuento", decimal(line.discount || 0), { required: true });
    addText(lineRoot, "precioTotalSinImpuesto", decimal(line.subtotal), { required: true });
    addLineDetails(lineRoot, {
      Variedad: line.variety,
      Medida: line.measure,
      ...(line.additionalDetails || {})
    });
    addLineTaxes(lineRoot, normalizeTaxes(line.taxes, line.subtotal));
  });
  addAdditionalInformation(root, issuerAdditionalInformation(payload.additionalInformation, document.issuer));
  return root.end({ prettyPrint: true });
}

function buildDeliveryGuideXml(payload = {}) {
  const document = payload.document || {};
  const guide = payload.deliveryGuide || {};
  const carrier = guide.carrier || {};
  const recipient = guide.recipient || {};
  const version = assertVersion("06", document.version || "1.1.0");
  if (!Array.isArray(payload.lines) || !payload.lines.length) {
    throw new SriValidationError("La guia de remision debe contener al menos una linea.");
  }

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("guiaRemision", { id: "comprobante", version });
  addTributaryInfo(root, { ...document, documentType: "06" });
  const info = root.ele("infoGuiaRemision");
  addText(info, "dirEstablecimiento", document.establishmentAddress);
  addText(info, "dirPartida", guide.departureAddress, { required: true, label: "Direccion de partida" });
  addText(info, "razonSocialTransportista", carrier.legalName, { required: true, label: "Transportista" });
  addText(info, "tipoIdentificacionTransportista", carrier.identificationType || "04", { required: true });
  addText(info, "rucTransportista", carrier.identification, { required: true });
  addText(info, "obligadoContabilidad", carrier.accountingRequired == null ? null : (carrier.accountingRequired ? "SI" : "NO"));
  addText(info, "fechaIniTransporte", dateSri(guide.startDate, "Fecha inicial del transporte"), { required: true });
  addText(info, "fechaFinTransporte", dateSri(guide.endDate, "Fecha final del transporte"), { required: true });
  addText(info, "placa", carrier.plate, { required: true, label: "Placa" });

  const recipients = root.ele("destinatarios");
  const recipientRoot = recipients.ele("destinatario");
  addText(recipientRoot, "identificacionDestinatario", recipient.identification, { required: true });
  addText(recipientRoot, "razonSocialDestinatario", recipient.legalName, { required: true });
  addText(recipientRoot, "dirDestinatario", recipient.address, { required: true });
  addText(recipientRoot, "motivoTraslado", guide.transferReason, { required: true });
  addText(recipientRoot, "docAduaneroUnico", guide.customsDocument);
  addText(recipientRoot, "codEstabDestino", guide.destinationEstablishmentCode);
  addText(recipientRoot, "ruta", guide.route);
  if (guide.relatedInvoice?.fullNumber) {
    addText(recipientRoot, "codDocSustento", "01");
    addText(recipientRoot, "numDocSustento", guide.relatedInvoice.fullNumber);
    addText(recipientRoot, "numAutDocSustento", guide.relatedInvoice.authorizationNumber, { required: true });
    addText(recipientRoot, "fechaEmisionDocSustento", dateSri(guide.relatedInvoice.issueDate, "Fecha de factura relacionada"));
  }
  const linesRoot = recipientRoot.ele("detalles");
  payload.lines.forEach((line, index) => {
    const lineRoot = linesRoot.ele("detalle");
    addText(lineRoot, "codigoInterno", line.mainCode || `ITEM-${index + 1}`);
    addText(lineRoot, "codigoAdicional", line.auxiliaryCode);
    addText(lineRoot, "descripcion", line.description, { required: true });
    addText(lineRoot, "cantidad", decimal(line.quantity, 6), { required: true });
    addLineDetails(lineRoot, {
      Cajas: line.boxes,
      Unidad: line.unit,
      Variedad: line.variety,
      Medida: line.measure,
      ...(line.additionalDetails || {})
    });
  });
  addAdditionalInformation(root, issuerAdditionalInformation(payload.additionalInformation, document.issuer));
  return root.end({ prettyPrint: true });
}

function buildWithholdingXml(payload = {}) {
  const document = payload.document || {};
  const withholding = payload.withholding || {};
  const subject = withholding.subject || payload.buyer || {};
  const version = assertVersion("07", document.version || "2.0.0");
  const supportingDocuments = Array.isArray(withholding.supportingDocuments)
    ? withholding.supportingDocuments
    : [];
  if (!supportingDocuments.length) {
    throw new SriValidationError("La retencion debe contener al menos un documento de sustento.");
  }

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("comprobanteRetencion", { id: "comprobante", version });
  addTributaryInfo(root, { ...document, documentType: "07" });

  const info = root.ele("infoCompRetencion");
  addText(info, "fechaEmision", dateSri(document.issueDate, "Fecha de emision"), { required: true });
  addText(info, "dirEstablecimiento", document.establishmentAddress);
  addText(info, "contribuyenteEspecial", document.issuer?.specialTaxpayerNumber);
  addText(info, "obligadoContabilidad", document.issuer?.accountingRequired === false ? "NO" : "SI");
  addText(info, "tipoIdentificacionSujetoRetenido", subject.identificationType || "04", { required: true });
  if (String(subject.identificationType || "04") === "08") {
    addText(info, "tipoSujetoRetenido", subject.subjectType || withholding.subjectType || "01", { required: true });
  }
  addText(info, "parteRel", withholding.relatedParty === true || withholding.relatedParty === "SI" ? "SI" : "NO", { required: true });
  addText(info, "razonSocialSujetoRetenido", subject.legalName, { required: true, label: "Sujeto retenido" });
  addText(info, "identificacionSujetoRetenido", subject.identification, { required: true, label: "Identificacion del sujeto retenido" });
  addText(info, "periodoFiscal", fiscalPeriod(withholding.fiscalPeriod, document.issueDate), { required: true });

  const docsRoot = root.ele("docsSustento");
  supportingDocuments.forEach((support, supportIndex) => {
    const taxes = Array.isArray(support.taxes) ? support.taxes : [];
    const retentions = Array.isArray(support.retentions) ? support.retentions : [];
    const payments = Array.isArray(support.payments) ? support.payments : [];
    if (!taxes.length) throw new SriValidationError(`El documento de sustento ${supportIndex + 1} debe detallar sus impuestos.`);
    if (!retentions.length) throw new SriValidationError(`El documento de sustento ${supportIndex + 1} debe detallar al menos una retencion.`);
    if (!payments.length) throw new SriValidationError(`El documento de sustento ${supportIndex + 1} debe detallar al menos una forma de pago.`);
    const retainedTotal = retentions.reduce((sum, item) => sum + Number(item.value || item.retainedValue || 0), 0);
    if (!(retainedTotal > 0)) throw new SriValidationError("No se debe emitir un comprobante 07 con valor retenido cero.");

    const row = docsRoot.ele("docSustento");
    addText(row, "codSustento", support.supportCode || "01", { required: true });
    addText(row, "codDocSustento", support.documentCode || "01", { required: true });
    addText(row, "numDocSustento", digits(support.documentNumber, 15, "Numero del documento de sustento"), { required: true });
    addText(row, "fechaEmisionDocSustento", dateSri(support.issueDate, "Fecha del documento de sustento"), { required: true });
    if (support.accountingDate) addText(row, "fechaRegistroContable", dateSri(support.accountingDate, "Fecha de registro contable"));
    const authorizationNumber = normalizeSriText(support.authorizationNumber).replace(/[^0-9]/g, "");
    if (authorizationNumber) {
      if (!/^\d{10,49}$/.test(authorizationNumber)) throw new SriValidationError("La autorizacion del documento de sustento debe contener entre 10 y 49 digitos.");
      addText(row, "numAutDocSustento", authorizationNumber);
    }
    const paymentLocation = support.paymentLocation === "02" ? "02" : "01";
    addText(row, "pagoLocExt", paymentLocation, { required: true });
    if (paymentLocation === "02") {
      addText(row, "tipoRegi", support.regimeType, { required: true, label: "Tipo de regimen del pago al exterior" });
      addText(row, "paisEfecPago", support.paymentCountryCode, { required: true, label: "Pais del pago al exterior" });
      addText(row, "aplicConvDobTrib", support.doubleTaxTreaty === true || support.doubleTaxTreaty === "SI" ? "SI" : "NO", { required: true });
      if (!(support.doubleTaxTreaty === true || support.doubleTaxTreaty === "SI")) {
        addText(row, "pagExtSujRetNorLeg", support.subjectToRetentionRule === false || support.subjectToRetentionRule === "NO" ? "NO" : "SI", { required: true });
      }
      addText(row, "pagoRegFis", support.taxHavenPayment === true || support.taxHavenPayment === "SI" ? "SI" : "NO", { required: true });
    }
    addText(row, "totalSinImpuestos", decimal(support.totalWithoutTax), { required: true });
    addText(row, "importeTotal", decimal(support.grandTotal), { required: true });

    const taxesRoot = row.ele("impuestosDocSustento");
    taxes.forEach(tax => {
      const taxRow = taxesRoot.ele("impuestoDocSustento");
      addText(taxRow, "codImpuestoDocSustento", tax.code, { required: true });
      addText(taxRow, "codigoPorcentaje", tax.percentageCode, { required: true });
      addText(taxRow, "baseImponible", decimal(tax.taxableBase), { required: true });
      addText(taxRow, "tarifa", decimal(tax.rate), { required: true });
      addText(taxRow, "valorImpuesto", decimal(tax.value), { required: true });
    });

    const retentionsRoot = row.ele("retenciones");
    retentions.forEach(retention => {
      const retentionRow = retentionsRoot.ele("retencion");
      addText(retentionRow, "codigo", retention.code, { required: true });
      addText(retentionRow, "codigoRetencion", retention.retentionCode, { required: true });
      addText(retentionRow, "baseImponible", decimal(retention.taxableBase), { required: true });
      addText(retentionRow, "porcentajeRetener", decimal(retention.rate), { required: true });
      addText(retentionRow, "valorRetenido", decimal(retention.value ?? retention.retainedValue), { required: true });
    });

    const paymentsRoot = row.ele("pagos");
    payments.forEach(payment => {
      const paymentRow = paymentsRoot.ele("pago");
      addText(paymentRow, "formaPago", payment.method, { required: true });
      addText(paymentRow, "total", decimal(payment.total), { required: true });
    });
  });

  addAdditionalInformation(root, issuerAdditionalInformation(payload.additionalInformation, document.issuer));
  return root.end({ prettyPrint: true });
}

function buildDocumentXml(documentType, payload) {
  if (documentType === "01") return buildInvoiceXml(payload);
  if (documentType === "04") return buildCreditNoteXml(payload);
  if (documentType === "06") return buildDeliveryGuideXml(payload);
  if (documentType === "07") return buildWithholdingXml(payload);
  throw new SriValidationError("Tipo de comprobante no habilitado en esta etapa.");
}

module.exports = {
  ENABLED_XML_VERSIONS,
  buildInvoiceXml,
  buildCreditNoteXml,
  buildDeliveryGuideXml,
  buildWithholdingXml,
  buildDocumentXml,
  dateSri,
  decimal,
  normalizeSriText
};
