const fs = require("node:fs");
const path = require("node:path");
const bwipjs = require("bwip-js");
const PDFDocument = require("pdfkit");
const { SriValidationError } = require("./errors.cjs");
const softwareProvider = require("../../../scripts/config/software-provider.js");

const TITLES = Object.freeze({
  "01": "RIDE - FACTURA DE EXPORTACION",
  "04": "RIDE - NOTA DE CREDITO",
  "06": "RIDE - GUIA DE REMISION",
  "07": "RIDE - COMPROBANTE DE RETENCION"
});
const HABITUAL_GOODS_EXPORTER_RUC = "1717637084001";
const HABITUAL_GOODS_EXPORTER_LEGEND = "EXPORTADOR HABITUAL DE BIENES";

function issuerExporterLegend(issuer = {}) {
  return text(issuer.habitualExporterLegend)
    || (String(issuer.ruc || "").trim() === HABITUAL_GOODS_EXPORTER_RUC ? HABITUAL_GOODS_EXPORTER_LEGEND : "");
}
const COMPANY_BRANDING = Object.freeze({
  "1717637084001": Object.freeze({
    name: "BLESS FLOWER",
    logo: "bless-flower-logo-official-transparent.png"
  }),
  "1727970137001": Object.freeze({
    name: "IMPERIO FLOWERS",
    logo: "imperio-flowers-logo.png"
  })
});

function money(value) {
  return Number(value || 0).toFixed(2);
}

function rawText(value) {
  return String(value ?? "").trim();
}

function dateLabel(value) {
  const source = rawText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (source || "-");
}

function dateTimeLabel(value) {
  const source = rawText(value);
  if (!source) return "-";
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return source;
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(parsed);
}

function supportingDocumentNumber(value) {
  const digits = rawText(value).replace(/\D+/g, "");
  return /^\d{15}$/.test(digits)
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : (rawText(value) || "-");
}

function supportingDocumentLabel(value) {
  return ({ "01": "FACTURA", "03": "LIQUIDACION DE COMPRA", "04": "NOTA DE CREDITO", "05": "NOTA DE DEBITO" })[rawText(value)]
    || rawText(value)
    || "COMPROBANTE";
}

function text(value, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function labelValue(doc, label, value, x, y, width) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#111111").text(label, x, y, { width });
  doc.font("Helvetica").fontSize(8.5).text(text(value), x, y + 9, { width });
}

function pageFooter(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.font("Helvetica").fontSize(7).fillColor("#555555")
      .text(`Representacion impresa generada por JAEDER SYSTEMS | Pagina ${index + 1} de ${range.count}`, 36, 795, {
        align: "center", width: 523
      });
  }
}

function tableHeader(doc, y) {
  doc.rect(36, y, 523, 22).fill("#E8EEF7");
  const columns = [
    ["CODIGO", 40, 78], ["DESCRIPCION", 118, 188], ["CANT.", 306, 55],
    ["P. UNIT.", 361, 62], ["DESC.", 423, 55], ["TOTAL", 478, 77]
  ];
  doc.fillColor("#15233C").font("Helvetica-Bold").fontSize(7.5);
  columns.forEach(([label, x, width]) => doc.text(label, x, y + 7, { width, align: x >= 306 ? "right" : "left" }));
  return y + 22;
}

function tableRow(doc, line, y) {
  const rowHeight = 32;
  doc.rect(36, y, 523, rowHeight).strokeColor("#D8E0EC").lineWidth(0.5).stroke();
  doc.fillColor("#111111").font("Helvetica").fontSize(7.5);
  doc.text(text(line.main_code), 40, y + 6, { width: 76 });
  doc.text([
    text(line.description),
    [line.variety, line.measure].filter(Boolean).join(" | ")
  ].filter(Boolean).join("\n"), 118, y + 6, { width: 184, height: 24 });
  doc.text(money(line.quantity), 306, y + 6, { width: 51, align: "right" });
  doc.text(Number(line.unit_price || 0).toFixed(6), 361, y + 6, { width: 58, align: "right" });
  doc.text(money(line.discount), 423, y + 6, { width: 51, align: "right" });
  doc.text(money(line.subtotal), 478, y + 6, { width: 77, align: "right" });
  return y + rowHeight;
}

function retentionRows(source = {}) {
  const fiscalPeriod = rawText(source.withholding?.fiscalPeriod);
  return (source.withholding?.supportingDocuments || []).flatMap(support => (
    (support.retentions || []).map(retention => ({
      documentType: supportingDocumentLabel(support.documentCode),
      documentNumber: supportingDocumentNumber(support.documentNumber),
      issueDate: dateLabel(support.issueDate),
      fiscalPeriod,
      taxCode: String(retention.code) === "1" ? "Impuesto a la Renta" : String(retention.code) === "2" ? "Impuesto al Valor Agregado" : "Impuesto a la Salida de Divisas",
      retentionCode: retention.retentionCode,
      taxableBase: Number(retention.taxableBase || 0),
      rate: Number(retention.rate || 0),
      value: Number(retention.value ?? retention.retainedValue ?? 0)
    }))
  ));
}

function retentionTableHeader(doc, y) {
  doc.rect(24, y, 547, 30).fill("#EEEEEE");
  const columns = [
    ["COMPROBANTE", 24, 55], ["NUMERO", 79, 82], ["FECHA EMISION", 161, 56],
    ["EJERCICIO FISCAL", 217, 50], ["BASE IMPONIBLE", 267, 72], ["IMPUESTO", 339, 87],
    ["PORCENTAJE", 426, 67], ["VALOR RETENIDO", 493, 78]
  ];
  doc.strokeColor("#111111").lineWidth(0.55).rect(24, y, 547, 30).stroke();
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(5.8);
  columns.forEach(([label, x, width], index) => {
    if (index) doc.moveTo(x, y).lineTo(x, y + 30).stroke();
    doc.text(label, x + 2, y + 9, { width: width - 4, align: "center", height: 16 });
  });
  return y + 30;
}

function retentionTableRow(doc, row, y) {
  const height = 30;
  const columns = [[24, 55], [79, 82], [161, 56], [217, 50], [267, 72], [339, 87], [426, 67], [493, 78]];
  doc.rect(24, y, 547, height).strokeColor("#777777").lineWidth(0.4).stroke();
  columns.slice(1).forEach(([x]) => doc.moveTo(x, y).lineTo(x, y + height).stroke());
  doc.fillColor("#111111").font("Helvetica").fontSize(6.1);
  doc.text(text(row.documentType), 26, y + 9, { width: 51, align: "center", height: 16 });
  doc.text(text(row.documentNumber), 81, y + 7, { width: 78, align: "center", height: 18 });
  doc.text(text(row.issueDate), 163, y + 9, { width: 52, align: "center" });
  doc.text(text(row.fiscalPeriod), 219, y + 9, { width: 46, align: "center" });
  doc.text(money(row.taxableBase), 269, y + 9, { width: 68, align: "right" });
  doc.text(`${text(row.taxCode)}${row.retentionCode ? ` (${row.retentionCode})` : ""}`, 341, y + 6, { width: 83, align: "center", height: 20 });
  doc.text(`${money(row.rate)}%`, 428, y + 9, { width: 63, align: "right" });
  doc.text(money(row.value), 495, y + 9, { width: 74, align: "right" });
  return y + height;
}

function exportInvoiceLines(document, source, lines) {
  if (document.document_type !== "01" || !isExportInvoice(source)) return lines;
  const quantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const subtotal = lines.reduce((sum, line) => sum + Number(line.subtotal || 0), 0);
  return [{
    main_code: "ROSAS",
    description: "ROSAS",
    variety: "",
    measure: "",
    quantity,
    unit_price: quantity ? subtotal / quantity : 0,
    discount: lines.reduce((sum, line) => sum + Number(line.discount || 0), 0),
    subtotal
  }];
}

function isExportInvoice(source = {}) {
  return String(source.erpEmission?.sourceType || "").toUpperCase() !== "INTERCOMPANY_SETTLEMENT"
    && Boolean(source.invoice?.incoterm || source.invoice?.originCountryCode || source.additionalInformation?.DAE || source.additionalInformation?.DAES);
}

function rideTitle(document, source = {}) {
  if (document.document_type === "01" && !isExportInvoice(source)) return "RIDE - FACTURA";
  return TITLES[document.document_type];
}

async function barcode(accessKey) {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: accessKey,
    scale: 2,
    height: 11,
    includetext: false,
    backgroundcolor: "FFFFFF",
    paddingwidth: 8,
    paddingheight: 2
  });
}

function fitText(doc, value, x, y, width, options = {}) {
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size || 7.5)
    .fillColor("#111111")
    .text(text(value), x, y, {
      width,
      height: options.height,
      align: options.align || "left",
      ellipsis: Boolean(options.height)
    });
}

function box(doc, x, y, width, height, radius = 0) {
  if (radius) doc.roundedRect(x, y, width, height, radius);
  else doc.rect(x, y, width, height);
  doc.strokeColor("#111111").lineWidth(0.8).stroke();
}

function withholdingAdditionalRows(source = {}, subject = {}) {
  const rows = [];
  const seen = new Set();
  const push = (label, value) => {
    const normalized = rawText(value);
    const key = `${rawText(label).toUpperCase()}|${normalized.toUpperCase()}`;
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    rows.push([rawText(label), normalized]);
  };
  push("Direccion", subject.address);
  push("Email", subject.email);
  push("Telefono", subject.phone);
  Object.entries(source.additionalInformation || {}).forEach(([label, value]) => {
    if (["string", "number", "boolean"].includes(typeof value)) push(label, value);
  });
  return rows;
}

function drawWithholdingRide(pdf, { document, issuer, subject, source, logoPath, hasLogo, barcodePng }) {
  const leftX = 24;
  const leftW = 267;
  const gap = 9;
  const rightX = leftX + leftW + gap;
  const rightW = 271;
  const topY = 24;
  const topH = 292;
  const branchAddress = issuer.branchAddress || issuer.establishmentAddress || issuer.headOfficeAddress || issuer.address;
  const accountingRequired = issuer.accountingRequired === false ? "NO" : "SI";
  const environment = String(document.environment || "TEST").toUpperCase() === "TEST" ? "PRUEBAS" : "PRODUCCION";

  box(pdf, leftX, topY, leftW, topH, 7);
  box(pdf, rightX, topY, rightW, topH, 7);

  if (hasLogo) {
    pdf.image(logoPath, leftX + 14, topY + 12, { fit: [leftW - 28, 68], align: "center", valign: "center" });
  } else {
    fitText(pdf, issuer.commercialName || issuer.legalName, leftX + 12, topY + 35, leftW - 24, { bold: true, size: 16, align: "center" });
  }
  fitText(pdf, issuer.legalName, leftX + 12, topY + 86, leftW - 24, { bold: true, size: 8.4, align: "center", height: 20 });
  if (rawText(issuer.commercialName) && rawText(issuer.commercialName) !== rawText(issuer.legalName)) {
    fitText(pdf, issuer.commercialName, leftX + 12, topY + 106, leftW - 24, { size: 8, align: "center", height: 17 });
  }
  labelValue(pdf, "Direccion Matriz:", issuer.headOfficeAddress || issuer.address, leftX + 12, topY + 135, leftW - 24);
  labelValue(pdf, "Direccion Sucursal:", branchAddress, leftX + 12, topY + 184, leftW - 24);
  fitText(pdf, "OBLIGADO A LLEVAR CONTABILIDAD", leftX + 12, topY + 248, 181, { bold: true, size: 7.2 });
  fitText(pdf, accountingRequired, leftX + 205, topY + 248, 42, { bold: true, size: 7.4, align: "center" });
  if (issuer.withholdingAgentNumber) {
    fitText(pdf, "AGENTE DE RETENCION", leftX + 12, topY + 269, 181, { bold: true, size: 7.2 });
    fitText(pdf, issuer.withholdingAgentNumber, leftX + 205, topY + 269, 42, { bold: true, size: 7.4, align: "center" });
  }

  fitText(pdf, "R.U.C.", rightX + 12, topY + 13, 62, { size: 12.5 });
  fitText(pdf, issuer.ruc, rightX + 76, topY + 13, rightW - 88, { bold: true, size: 12.5 });
  fitText(pdf, "COMPROBANTE DE RETENCION", rightX + 12, topY + 43, rightW - 24, { bold: true, size: 12.2 });
  fitText(pdf, "No.", rightX + 12, topY + 72, 35, { size: 7.5 });
  fitText(pdf, document.full_number, rightX + 49, topY + 72, rightW - 61, { bold: true, size: 8.2 });
  fitText(pdf, "NUMERO DE AUTORIZACION", rightX + 12, topY + 98, rightW - 24, { bold: true, size: 7.1 });
  fitText(pdf, document.authorization_number, rightX + 12, topY + 113, rightW - 24, { bold: true, size: 6.9, height: 22 });
  fitText(pdf, "FECHA Y HORA DE AUTORIZACION", rightX + 12, topY + 144, 129, { bold: true, size: 6.9 });
  fitText(pdf, dateTimeLabel(document.authorized_at), rightX + 145, topY + 144, rightW - 157, { size: 6.9 });
  fitText(pdf, "AMBIENTE", rightX + 12, topY + 177, 129, { bold: true, size: 6.9 });
  fitText(pdf, environment, rightX + 145, topY + 177, rightW - 157, { size: 6.9 });
  fitText(pdf, "EMISION", rightX + 12, topY + 199, 129, { bold: true, size: 6.9 });
  fitText(pdf, "NORMAL", rightX + 145, topY + 199, rightW - 157, { size: 6.9 });
  fitText(pdf, "CLAVE DE ACCESO", rightX + 12, topY + 223, rightW - 24, { bold: true, size: 6.9 });
  pdf.image(barcodePng, rightX + 15, topY + 239, { fit: [rightW - 30, 27], align: "center" });
  fitText(pdf, document.access_key, rightX + 10, topY + 271, rightW - 20, { bold: true, size: 5.6, align: "center" });

  const subjectY = 328;
  box(pdf, 24, subjectY, 547, 58);
  fitText(pdf, "Razon Social / Nombres y Apellidos:", 29, subjectY + 8, 194, { bold: true, size: 7 });
  fitText(pdf, subject.legalName, 225, subjectY + 8, 341, { bold: true, size: 7.2, height: 16 });
  fitText(pdf, "Identificacion:", 29, subjectY + 29, 82, { bold: true, size: 7 });
  fitText(pdf, subject.identification, 113, subjectY + 29, 173, { size: 7.2 });
  fitText(pdf, "Fecha:", 310, subjectY + 29, 42, { bold: true, size: 7 });
  fitText(pdf, dateLabel(document.issue_date), 354, subjectY + 29, 120, { size: 7.2 });

  let y = 399;
  const rows = retentionRows(source);
  y = retentionTableHeader(pdf, y);
  rows.forEach(row => {
    if (y + 30 > 748) {
      pdf.addPage();
      y = retentionTableHeader(pdf, 42);
    }
    y = retentionTableRow(pdf, row, y);
  });
  y += 9;
  fitText(pdf, "TOTAL RETENIDO", 377, y, 112, { bold: true, size: 8.5, align: "right" });
  fitText(pdf, money(rows.reduce((sum, row) => sum + row.value, 0)), 493, y, 78, { bold: true, size: 8.5, align: "right" });
  y += 25;

  const additionalRows = withholdingAdditionalRows(source, subject);
  if (additionalRows.length) {
    const additionalHeight = 25 + (additionalRows.length * 15);
    if (y + additionalHeight > 770) { pdf.addPage(); y = 42; }
    box(pdf, 24, y, 386, additionalHeight);
    fitText(pdf, "Informacion Adicional", 29, y + 7, 376, { bold: true, size: 8, align: "center" });
    additionalRows.forEach(([label, value], index) => {
      const rowY = y + 24 + (index * 15);
      fitText(pdf, `${label}:`, 31, rowY, 98, { bold: true, size: 6.5 });
      fitText(pdf, value, 132, rowY, 271, { size: 6.5, height: 13 });
    });
    y += additionalHeight + 8;
  }

  fitText(pdf, "Representacion impresa del comprobante electronico autorizado.", 24, Math.min(y, 779), 547, { size: 6.2, align: "center" });
  pageFooter(pdf);
}

function drawTraditionalInvoice(pdf, {
  document,
  issuer,
  buyer,
  source,
  logoPath,
  hasLogo,
  barcodePng,
  printableLines
}) {
  const leftX = 24;
  const leftW = 267;
  const gap = 9;
  const rightX = leftX + leftW + gap;
  const rightW = 271;
  const topY = 24;
  const topH = 315;
  const extra = source.additionalInformation || {};
  const exportInvoice = isExportInvoice(source);

  box(pdf, leftX, topY, leftW, topH, 7);
  box(pdf, rightX, topY, rightW, topH, 7);

  if (hasLogo) pdf.image(logoPath, leftX + 16, topY + 12, { fit: [leftW - 32, 72], align: "center", valign: "center" });
  else fitText(pdf, issuer.commercialName || issuer.legalName, leftX + 12, topY + 34, leftW - 24, { bold: true, size: 17, align: "center" });
  fitText(pdf, issuer.legalName, leftX + 12, topY + 87, leftW - 24, { bold: true, size: 8.5, align: "center" });
  fitText(pdf, issuer.commercialName, leftX + 12, topY + 102, leftW - 24, { size: 8, align: "center" });
  labelValue(pdf, "Direccion Matriz:", issuer.headOfficeAddress || issuer.address, leftX + 12, topY + 132, leftW - 24);
  labelValue(pdf, "Direccion Sucursal:", issuer.branchAddress || issuer.headOfficeAddress || issuer.address, leftX + 12, topY + 181, leftW - 24);
  fitText(pdf, "OBLIGADO A LLEVAR CONTABILIDAD", leftX + 12, topY + 252, 176, { bold: true });
  fitText(pdf, issuer.accountingRequired === false ? "NO" : "SI", leftX + 201, topY + 252, 45, { bold: true });
  if (issuer.withholdingAgentNumber) {
    fitText(pdf, "AGENTE DE RETENCION", leftX + 12, topY + 276, 176, { bold: true });
    fitText(pdf, issuer.withholdingAgentNumber, leftX + 201, topY + 276, 45, { bold: true });
  }
  const exporterLegend = issuerExporterLegend(issuer);
  if (exporterLegend) fitText(pdf, exporterLegend, leftX + 12, topY + 230, leftW - 24, { bold: true, size: 7.2, align: "center" });

  fitText(pdf, "R.U.C.:", rightX + 12, topY + 12, 65, { size: 13 });
  fitText(pdf, issuer.ruc, rightX + 79, topY + 12, rightW - 91, { bold: true, size: 13 });
  fitText(pdf, exportInvoice ? "FACTURA DE EXPORTACION" : "FACTURA", rightX + 12, topY + 42, rightW - 24, { size: 13 });
  fitText(pdf, "No.", rightX + 12, topY + 72, 40, { size: 8 });
  fitText(pdf, document.full_number, rightX + 58, topY + 72, rightW - 70, { bold: true, size: 8 });
  fitText(pdf, "NUMERO DE AUTORIZACION", rightX + 12, topY + 98, rightW - 24, { bold: true, size: 7.5 });
  fitText(pdf, document.authorization_number, rightX + 12, topY + 114, rightW - 24, { bold: true, size: 7.3, height: 24 });
  fitText(pdf, "FECHA Y HORA DE AUTORIZACION", rightX + 12, topY + 150, 127, { bold: true, size: 7.3 });
  fitText(pdf, document.authorized_at, rightX + 145, topY + 150, rightW - 157, { size: 7.3 });
  fitText(pdf, "AMBIENTE", rightX + 12, topY + 184, 127, { bold: true, size: 7.3 });
  fitText(pdf, String(document.environment || "TEST") === "TEST" ? "PRUEBAS" : "PRODUCCION", rightX + 145, topY + 184, rightW - 157, { size: 7.3 });
  fitText(pdf, "EMISION", rightX + 12, topY + 214, 127, { bold: true, size: 7.3 });
  fitText(pdf, "NORMAL", rightX + 145, topY + 214, rightW - 157, { size: 7.3 });
  fitText(pdf, "CLAVE DE ACCESO", rightX + 12, topY + 242, rightW - 24, { bold: true, size: 7.3 });
  pdf.image(barcodePng, rightX + 16, topY + 260, { fit: [rightW - 32, 35], align: "center" });
  fitText(pdf, document.access_key, rightX + 12, topY + 300, rightW - 24, { bold: true, size: 5.7, align: "center" });

  const buyerY = 350;
  box(pdf, 24, buyerY, 547, 72);
  fitText(pdf, "Razon Social / Nombres y Apellidos:", 28, buyerY + 9, 196, { bold: true, size: 7.3 });
  fitText(pdf, buyer.legalName, 226, buyerY + 9, 336, { bold: true, size: 7.3 });
  fitText(pdf, "Identificacion:", 28, buyerY + 28, 76, { bold: true, size: 7.3 });
  fitText(pdf, buyer.identification, 108, buyerY + 28, 110, { size: 7.3 });
  fitText(pdf, "Fecha:", 229, buyerY + 28, 42, { bold: true, size: 7.3 });
  fitText(pdf, document.issue_date, 274, buyerY + 28, 92, { size: 7.3 });
  fitText(pdf, "Guia:", 395, buyerY + 28, 36, { bold: true, size: 7.3 });
  fitText(pdf, extra.Guias || extra.GUIAS || extra.AWB, 434, buyerY + 28, 128, { size: 7.3 });
  fitText(pdf, "Direccion:", 28, buyerY + 48, 76, { bold: true, size: 7.3 });
  fitText(pdf, buyer.address, 108, buyerY + 48, 454, { size: 7.3, height: 18 });

  let detailY = 430;
  const columns = [
    ["Cod. Principal", 24, 43], ["Cod. Auxiliar", 67, 43], ["Cantidad", 110, 51],
    ["Descripcion", 161, 105], ["Detalle Adicional", 266, 72], ["Precio Unitario", 338, 57],
    ["Subsidio", 395, 46], ["Precio sin Subsidio", 441, 55], ["Descuento", 496, 40], ["Precio Total", 536, 35]
  ];
  const drawDetailHeader = y => {
    columns.forEach(([label, x, width]) => {
      box(pdf, x, y, width, 31);
      fitText(pdf, label, x + 2, y + 7, width - 4, { size: 5.8, align: "center", height: 20 });
    });
    return y + 31;
  };
  let rowY = drawDetailHeader(detailY);
  const rowHeight = 25;
  (printableLines.length ? printableLines : [{}]).forEach((line, index) => {
    if (rowY + rowHeight > 760) {
      pdf.addPage();
      rowY = drawDetailHeader(36);
    }
    columns.forEach(([, x, width]) => box(pdf, x, rowY, width, rowHeight));
    const description = [line.description || "ROSES", line.variety, line.measure].filter(Boolean).join(" / ");
    fitText(pdf, line.main_code || line.mainCode || String(index + 1), 26, rowY + 8, 39, { size: 6.6, align: "center" });
    fitText(pdf, line.auxiliary_code || line.auxiliaryCode || "0", 69, rowY + 8, 39, { size: 6.6, align: "center" });
    fitText(pdf, money(line.quantity), 112, rowY + 8, 47, { size: 6.6, align: "right" });
    fitText(pdf, description, 164, rowY + 5, 99, { bold: true, size: 6.4, height: 18 });
    fitText(pdf, line.additional_detail || line.additionalDetail || "", 268, rowY + 5, 68, { size: 6.1, height: 18 });
    fitText(pdf, Number(line.unit_price ?? line.unitPrice ?? 0).toFixed(6), 340, rowY + 8, 53, { size: 6.5, align: "right" });
    fitText(pdf, "0.00", 397, rowY + 8, 42, { size: 6.5, align: "right" });
    fitText(pdf, "0.00", 443, rowY + 8, 51, { size: 6.5, align: "right" });
    fitText(pdf, money(line.discount), 498, rowY + 8, 36, { size: 6.5, align: "right" });
    fitText(pdf, money(line.subtotal), 538, rowY + 8, 31, { size: 6.5, align: "right" });
    rowY += rowHeight;
  });

  const providerRows = softwareProvider.billingSystemProviderEnabled
    ? [["RUC PROVEEDOR:", softwareProvider.providerRuc]]
    : [];
  const additionalRows = exportInvoice ? [
    ["CORREO CLIENTE:", extra["Correo cliente"] || buyer.email],
    ["GUIAS:", extra.Guias || extra.GUIAS || extra.AWB],
    ["PIEZAS:", extra.Piezas || extra.PIEZAS],
    ["MARCA / CLIENTE FINAL:", extra["Marca cliente"] || extra.Marca || extra.MARCA],
    ["DAE:", extra.DAE || extra.DAES || extra.Dae],
    ...providerRows
  ] : [
    ["DIRECCION:", extra.Direccion || extra.DIRECCION || buyer.address],
    ["TELEFONO:", extra.Telefono || extra.TELEFONO || buyer.phone],
    ["EMAIL:", extra["Correo cliente"] || extra.Email || extra.EMAIL || buyer.email],
    ...providerRows
  ];
  const additionalHeight = 28 + (additionalRows.length * 14);
  const requiredBottomHeight = Math.max(additionalHeight + 38, 126);
  let bottomY = rowY + 5;
  if (bottomY + requiredBottomHeight > 770) {
    pdf.addPage();
    bottomY = 36;
  }
  box(pdf, 24, bottomY, 337, additionalHeight);
  fitText(pdf, "Informacion Adicional", 26, bottomY + 5, 333, { size: 7.5, align: "center" });
  additionalRows.forEach(([label, value], index) => {
    const rowY = bottomY + 22 + (index * 14);
    fitText(pdf, label, 27, rowY, 91, { bold: true, size: 6.3 });
    fitText(pdf, value, 120, rowY, 236, { size: 6.3 });
  });

  const totalX = 376;
  const totalW = 195;
  const totalRows = [
    ["SUBTOTAL 0%", document.subtotal],
    ["SUBTOTAL NO OBJETO DE IVA", 0],
    ["SUBTOTAL EXENTO DE IVA", 0],
    ["SUBTOTAL SIN IMPUESTOS", document.subtotal],
    ["TOTAL DESCUENTO", document.discount_total],
    ["ICE", 0],
    ["IRBPNR", 0],
    ["PROPINA", 0],
    ["VALOR TOTAL", document.grand_total]
  ];
  totalRows.forEach(([label, value], index) => {
    const rowY = bottomY + (index * 14);
    box(pdf, totalX, rowY, totalW, 14);
    fitText(pdf, label, totalX + 3, rowY + 3.5, 139, { bold: index === totalRows.length - 1, size: 6.2 });
    fitText(pdf, money(value), totalX + 144, rowY + 3.5, 47, { bold: index === totalRows.length - 1, size: 6.2, align: "right" });
  });

  const paymentY = bottomY + additionalHeight + 5;
  box(pdf, 24, paymentY, 260, 32);
  box(pdf, 284, paymentY, 77, 32);
  fitText(pdf, "Forma de pago", 27, paymentY + 4, 254, { size: 6.5, align: "center" });
  fitText(pdf, "Valor", 287, paymentY + 4, 71, { size: 6.5, align: "center" });
  fitText(pdf, source.invoice?.payments?.[0]?.method || "20 - OTROS CON UTILIZACION DEL SISTEMA FINANCIERO", 27, paymentY + 17, 254, { size: 5.8 });
  fitText(pdf, money(document.grand_total), 287, paymentY + 17, 71, { size: 6.3, align: "right" });
  fitText(pdf, "Representacion impresa del comprobante electronico autorizado.", 24, Math.min(paymentY + 39, 784), 547, { size: 6.2, align: "center" });
  pageFooter(pdf);
}

async function generateRidePdf(detail) {
  const document = detail?.document;
  if (!document || document.status !== "AUTORIZADO") {
    throw new SriValidationError("El RIDE solo puede generarse para un comprobante AUTORIZADO.");
  }
  if (!TITLES[document.document_type]) throw new SriValidationError("Tipo de RIDE no soportado.");

  const rawIssuer = document.issuer_snapshot || {};
  const issuer = {
    ...rawIssuer,
    habitualExporterLegend: issuerExporterLegend(rawIssuer)
  };
  const buyer = document.buyer_snapshot || {};
  const source = structuredClone(document.source_snapshot || {});
  source.additionalInformation = softwareProvider.mergeAdditionalInformation(source.additionalInformation || {});
  const recipient = document.document_type === "06" ? source.deliveryGuide?.recipient || {} : buyer;
  const barcodePng = await barcode(document.access_key);
  const printableLines = exportInvoiceLines(document, source, detail.lines || []);
  const branding = COMPANY_BRANDING[String(issuer.ruc || "")] || {
    name: issuer.commercialName || issuer.legalName || "EMPRESA",
    logo: ""
  };
  const configuredLogo = document.document_type === "07"
    ? rawText(issuer.logoPath || issuer.logo_path || source.companyBranding?.logoPath || branding.logo)
    : rawText(branding.logo);
  const logoFile = configuredLogo ? path.basename(configuredLogo.replace(/\\/g, "/")) : "";
  const logoPath = logoFile
    ? path.resolve(__dirname, "..", "..", "..", "scripts", "assets", logoFile)
    : "";
  const hasLogo = fs.existsSync(logoPath);
  const title = rideTitle(document, source);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: {
      Title: `${title} ${document.full_number}`,
      Author: issuer.legalName || "JAEDER SYSTEMS",
      Subject: "Representacion impresa de comprobante electronico SRI"
    } });
    pdf.on("data", chunk => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));

    if (document.document_type === "07") {
      drawWithholdingRide(pdf, {
        document,
        issuer,
        subject: recipient,
        source,
        logoPath,
        hasLogo,
        barcodePng
      });
      pdf.end();
      return;
    }

    if (document.document_type === "01") {
      drawTraditionalInvoice(pdf, {
        document,
        issuer,
        buyer,
        source,
        logoPath,
        hasLogo,
        barcodePng,
        printableLines
      });
      pdf.end();
      return;
    }

    pdf.rect(36, 32, 523, 32).fill("#B31D2B");
    pdf.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13)
      .text("AMBIENTE DE PRUEBAS - SIN VALIDEZ TRIBUTARIA", 42, 42, { width: 511, align: "center" });

    if (hasLogo) pdf.image(logoPath, 36, 72, { fit: [238, 72], align: "left", valign: "center" });
    else pdf.fillColor("#111111").font("Helvetica-Bold").fontSize(19).text(branding.name, 36, 82);
    pdf.fillColor("#111111").font("Helvetica-Bold").fontSize(12).text(title, 36, 151);
    pdf.roundedRect(320, 78, 239, 96, 4).strokeColor("#9EABBD").lineWidth(0.8).stroke();
    labelValue(pdf, "RUC", issuer.ruc, 332, 88, 100);
    labelValue(pdf, "COMPROBANTE", document.full_number, 438, 88, 109);
    labelValue(pdf, "ESTADO", document.status, 332, 121, 100);
    labelValue(pdf, "AMBIENTE", "PRUEBAS", 438, 121, 109);
    labelValue(pdf, "FECHA AUTORIZACION", document.authorized_at, 332, 151, 215);

    labelValue(pdf, "RAZON SOCIAL", issuer.legalName, 36, 178, 260);
    labelValue(pdf, "NOMBRE COMERCIAL", issuer.commercialName, 36, 208, 260);
    labelValue(pdf, "DIRECCION MATRIZ", issuer.headOfficeAddress, 36, 238, 523);
    if (issuer.habitualExporterLegend) fitText(pdf, issuer.habitualExporterLegend, 36, 258, 523, { bold: true, size: 7.2, align: "center" });

    pdf.roundedRect(36, 272, 523, 91, 4).strokeColor("#9EABBD").stroke();
    pdf.font("Helvetica-Bold").fontSize(8).text("CLAVE DE ACCESO", 48, 283);
    pdf.image(barcodePng, 56, 298, { fit: [483, 38], align: "center" });
    pdf.font("Courier-Bold").fontSize(8.5).text(document.access_key, 48, 343, { width: 499, align: "center" });

    pdf.roundedRect(36, 377, 523, 77, 4).strokeColor("#9EABBD").stroke();
    const recipientLabel = document.document_type === "06" ? "DESTINATARIO"
      : document.document_type === "07" ? "SUJETO RETENIDO" : "COMPRADOR";
    labelValue(pdf, recipientLabel, recipient.legalName, 48, 389, 235);
    labelValue(pdf, "IDENTIFICACION", recipient.identification, 300, 389, 247);
    labelValue(pdf, "DIRECCION", recipient.address, 48, 422, 499);

    let y = 474;
    if (document.document_type === "07") {
      const rows = retentionRows(source);
      y = retentionTableHeader(pdf, y);
      rows.forEach(row => {
        if (y > 750) {
          pdf.addPage();
          y = retentionTableHeader(pdf, 52);
        }
        y = retentionTableRow(pdf, row, y);
      });
      y += 12;
      pdf.font("Helvetica-Bold").fontSize(10).fillColor("#111111")
        .text("TOTAL RETENIDO", 365, y, { width: 90 })
        .text(money(rows.reduce((sum, row) => sum + row.value, 0)), 460, y, { width: 95, align: "right" });
      y += 32;
    } else {
      y = tableHeader(pdf, y);
      printableLines.forEach(line => {
        if (y > 750) {
          pdf.addPage();
          y = tableHeader(pdf, 52);
        }
        y = tableRow(pdf, line, y);
      });
    }

    if (document.document_type !== "06" && document.document_type !== "07") {
      y += 12;
      if (y > 715) { pdf.addPage(); y = 52; }
      const totalX = 365;
      [["SUBTOTAL", document.subtotal], ["DESCUENTO", document.discount_total], ["IMPUESTOS", document.tax_total], ["TOTAL", document.grand_total]]
        .forEach(([label, value], index) => {
          const rowY = y + (index * 20);
          pdf.font(index === 3 ? "Helvetica-Bold" : "Helvetica").fontSize(index === 3 ? 10 : 8.5)
            .fillColor("#111111").text(label, totalX, rowY, { width: 90 });
          pdf.text(money(value), totalX + 95, rowY, { width: 99, align: "right" });
        });
      y += 92;
    }

    if (document.document_type === "01") {
      const extra = source.additionalInformation || {};
      if (y > 615) { pdf.addPage(); y = 52; }
      pdf.roundedRect(36, y, 523, 122, 4).strokeColor("#9EABBD").stroke();
      pdf.font("Helvetica-Bold").fontSize(8).text("INFORMACION ADICIONAL", 48, y + 9);
      const providerRows = softwareProvider.billingSystemProviderEnabled
        ? [["RUC PROVEEDOR", softwareProvider.providerRuc]]
        : [];
      [
        ["CORREO CLIENTE", extra["Correo cliente"] || buyer.email],
        ["GUIAS", extra.Guias || extra.GUIAS || extra.GuiasExportacion],
        ["PIEZAS", extra.Piezas || extra.PIEZAS],
        ["MARCA / CLIENTE FINAL", extra["Marca cliente"] || extra.Marca || extra.MARCA],
        ["DAE", extra.DAE || extra.DAES || extra.Dae],
        ...providerRows
      ].forEach(([label, value], index) => {
        labelValue(pdf, label, value || "-", 48, y + 25 + (index * 15), 499);
      });
      y += 134;
    } else if (softwareProvider.billingSystemProviderEnabled) {
      if (y > 700) { pdf.addPage(); y = 52; }
      pdf.roundedRect(36, y, 523, 44, 4).strokeColor("#9EABBD").stroke();
      pdf.font("Helvetica-Bold").fontSize(8).text("INFORMACION ADICIONAL", 48, y + 8);
      labelValue(pdf, "RUC PROVEEDOR", softwareProvider.providerRuc, 48, y + 22, 499);
      y += 56;
    }

    if (y > 735) { pdf.addPage(); y = 52; }
    pdf.roundedRect(36, y, 523, 58, 4).strokeColor("#9EABBD").stroke();
    labelValue(pdf, "NUMERO DE AUTORIZACION", document.authorization_number, 48, y + 10, 255);
    labelValue(pdf, "FECHA DE EMISION", document.issue_date, 316, y + 10, 110);
    labelValue(pdf, "MONEDA", document.currency, 446, y + 10, 101);
    pageFooter(pdf);
    pdf.end();
  });
}

module.exports = { generateRidePdf };
