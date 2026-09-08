const { DOMParser } = require("@xmldom/xmldom");
const { validateAccessKey, formatIssueDate } = require("./access-key.cjs");
const { assertDocumentEnvironment, environmentCode } = require("./environment.cjs");
const { SriValidationError } = require("./errors.cjs");

const ROOTS = Object.freeze({ "01": "factura", "04": "notaCredito", "06": "guiaRemision", "07": "comprobanteRetencion" });
const INFO = Object.freeze({ "01": "infoFactura", "04": "infoNotaCredito", "06": "infoGuiaRemision", "07": "infoCompRetencion" });

function fail() {
  throw new SriValidationError("La identidad fiscal del XML, la clave y el comprobante no coinciden.");
}

function assertCanonicalDocumentIdentity(document, { expectedRuc } = {}) {
  const environment = assertDocumentEnvironment(document);
  const accessKey = document.access_key;
  const ruc = document.issuer_snapshot?.ruc;
  const sequential = String(document.sequential_text ?? document.sequential ?? "").padStart(9, "0");
  if (!ROOTS[document.document_type] || !validateAccessKey(accessKey)
    || typeof ruc !== "string" || !/^[0-9]{13}$/.test(ruc)
    || (expectedRuc !== undefined && ruc !== expectedRuc)
    || !/^[0-9]{9}$/.test(sequential) || Number(sequential) < 1
    || (document.sequential !== undefined && Number(document.sequential) !== Number(sequential))
    || accessKey.slice(0, 8) !== formatIssueDate(document.issue_date)
    || accessKey.slice(8, 10) !== document.document_type
    || accessKey.slice(10, 23) !== ruc
    || accessKey.slice(24, 27) !== document.establishment_code
    || accessKey.slice(27, 30) !== document.emission_point_code
    || accessKey.slice(30, 39) !== sequential
    || (document.numeric_code !== undefined && accessKey.slice(39, 47) !== document.numeric_code)
    || accessKey[47] !== "1" || (document.emission_type !== undefined && document.emission_type !== "1")) fail();
  return { environment, accessKey, xmlEnvironment: environmentCode(environment), ruc, documentType: document.document_type, sequential };
}

function assertPayloadDocumentIdentity(document) {
  const fromCode = { "1": "TEST", "2": "PRODUCTION" }[document.environmentCode];
  if (typeof document.environmentCode !== "string" || !fromCode || (document.environment !== undefined && document.environment !== fromCode)) fail();
  return assertCanonicalDocumentIdentity({
    environment: fromCode, access_key: document.accessKey, document_type: document.documentType,
    issuer_snapshot: document.issuer, issue_date: document.issueDate,
    establishment_code: document.establishmentCode, emission_point_code: document.emissionPointCode,
    sequential_text: document.sequential, emission_type: document.emissionType || "1"
  });
}

function directElement(parent, name) {
  const children = Array.from(parent.childNodes || []).filter(node => node.nodeType === 1 && node.nodeName === name && !node.namespaceURI);
  if (children.length !== 1) fail();
  return children[0];
}

function scalar(parent, name) {
  const element = directElement(parent, name);
  if (Array.from(element.childNodes || []).some(node => node.nodeType === 1)) fail();
  return element.textContent;
}

function assertDocumentXmlIdentity(document, xml, options = {}) {
  const identity = assertCanonicalDocumentIdentity(document, options);
  if (typeof xml !== "string" || !xml.trim() || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail();
  let parsed;
  try {
    parsed = new DOMParser({ onError() { fail(); } }).parseFromString(xml, "application/xml");
  } catch { fail(); }
  const root = parsed.documentElement;
  if (!root || root.nodeName !== ROOTS[identity.documentType] || root.namespaceURI
    || root.getAttribute("id") !== "comprobante"
    || (document.xml_version && root.getAttribute("version") !== document.xml_version)
    || Array.from(parsed.childNodes || []).filter(node => node.nodeType === 1).length !== 1
    || parsed.getElementsByTagName("infoTributaria").length !== 1) fail();
  const tax = directElement(root, "infoTributaria");
  const accessKey = scalar(tax, "claveAcceso");
  const xmlEnvironment = scalar(tax, "ambiente");
  assertDocumentEnvironment(document, { accessKey, xmlEnvironment });
  if (scalar(tax, "ruc") !== identity.ruc || scalar(tax, "codDoc") !== identity.documentType
    || scalar(tax, "estab") !== document.establishment_code
    || scalar(tax, "ptoEmi") !== document.emission_point_code
    || scalar(tax, "secuencial") !== identity.sequential || scalar(tax, "tipoEmision") !== "1") fail();
  const info = directElement(root, INFO[identity.documentType]);
  if (identity.documentType !== "06") {
    const date = formatIssueDate(document.issue_date);
    if (scalar(info, "fechaEmision") !== `${date.slice(0, 2)}/${date.slice(2, 4)}/${date.slice(4)}`) fail();
  }
  return identity;
}

module.exports = { assertCanonicalDocumentIdentity, assertPayloadDocumentIdentity, assertDocumentXmlIdentity };
