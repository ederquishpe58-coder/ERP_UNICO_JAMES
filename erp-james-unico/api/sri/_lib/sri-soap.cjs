const { XMLParser } = require("fast-xml-parser");
const { SriTransportError, SriValidationError } = require("./errors.cjs");
const { validateAccessKey } = require("./access-key.cjs");
const { UNCERTAIN, nativeDiagnostic, safeText } = require("./transport-diagnostic.cjs");

const TEST_ENDPOINTS = Object.freeze({
  reception: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
  authorization: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline"
});

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  cdataPropName: false
});

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value == null) return "";
  if (typeof value === "object" && "#text" in value) return String(value["#text"] || "").trim();
  return String(value).trim();
}

function normalizeMessages(container) {
  return asArray(container?.mensaje).map(message => ({
    identifier: textValue(message?.identificador),
    message: textValue(message?.mensaje),
    additionalInformation: textValue(message?.informacionAdicional),
    type: textValue(message?.tipo)
  }));
}

function soapEnvelope(namespace, operation, payload) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sri="${namespace}">` +
    `<soapenv:Header/><soapenv:Body><sri:${operation}>${payload}</sri:${operation}></soapenv:Body>` +
    `</soapenv:Envelope>`;
}

function buildReceptionEnvelope(signedXml) {
  const source = String(signedXml || "").trim();
  if (!source) throw new SriValidationError("El XML firmado es obligatorio para recepcion.");
  return soapEnvelope(
    "http://ec.gob.sri.ws.recepcion",
    "validarComprobante",
    `<xml>${Buffer.from(source, "utf8").toString("base64")}</xml>`
  );
}

function buildAuthorizationEnvelope(accessKey) {
  if (!validateAccessKey(accessKey)) throw new SriValidationError("La clave de acceso para consulta no es valida.");
  return soapEnvelope(
    "http://ec.gob.sri.ws.autorizacion",
    "autorizacionComprobante",
    `<claveAccesoComprobante>${xmlEscape(accessKey)}</claveAccesoComprobante>`
  );
}

function soapBody(xml) {
  let parsed;
  try {
    parsed = parser.parse(String(xml || ""));
  } catch (error) {
    throw new SriTransportError("La respuesta del SRI no contiene XML legible.", {
      code: "SRI_RESPONSE_XML_INVALID",
      retryable: true,
      details: { reason: safeText(error.message) }
    });
  }
  const body = parsed?.Envelope?.Body;
  if (!body) throw new SriTransportError("La respuesta del SRI no contiene un cuerpo SOAP.");
  if (body.Fault) {
    const faultCode = safeText(textValue(body.Fault.faultcode));
    const faultString = safeText(textValue(body.Fault.faultstring));
    throw new SriTransportError(`El Web Service del SRI devolvio una falla SOAP: ${faultString || faultCode}.`, {
      code: "SRI_SOAP_FAULT",
      details: {
        faultCode, faultString,
        transport: { classification: "SOAP", resultState: UNCERTAIN, nextAction: "AUTHORIZATION_LOOKUP_FIRST", faultCode, faultString }
      }
    });
  }
  return body;
}

function parseReceptionResponse(xml) {
  const response = soapBody(xml)?.validarComprobanteResponse?.RespuestaRecepcionComprobante;
  if (!response) throw new SriTransportError("El SRI no devolvio una respuesta de recepcion reconocible.");
  const receipts = asArray(response.comprobantes?.comprobante).map(item => ({
    accessKey: textValue(item?.claveAcceso),
    messages: normalizeMessages(item?.mensajes)
  }));
  const state = textValue(response.estado).toUpperCase();
  return {
    state,
    received: state === "RECIBIDA",
    returned: state === "DEVUELTA",
    receipts,
    messages: receipts.flatMap(receipt => receipt.messages),
    rawXml: String(xml || "")
  };
}

function parseAuthorizationResponse(xml) {
  const response = soapBody(xml)?.autorizacionComprobanteResponse?.RespuestaAutorizacionComprobante;
  if (!response) throw new SriTransportError("El SRI no devolvio una respuesta de autorizacion reconocible.");
  const authorizations = asArray(response.autorizaciones?.autorizacion).map(item => ({
    state: textValue(item?.estado).toUpperCase(),
    authorizationNumber: textValue(item?.numeroAutorizacion),
    authorizationDate: textValue(item?.fechaAutorizacion),
    environment: textValue(item?.ambiente),
    authorizedXml: textValue(item?.comprobante),
    messages: normalizeMessages(item?.mensajes)
  }));
  const selected = authorizations.find(item => item.state === "AUTORIZADO") || authorizations[0] || null;
  return {
    accessKey: textValue(response.claveAccesoConsultada),
    documentCount: Number(textValue(response.numeroComprobantes) || 0),
    state: selected?.state || "NO_ENCONTRADO",
    authorized: selected?.state === "AUTORIZADO",
    authorizationNumber: selected?.state === "AUTORIZADO" ? selected.authorizationNumber : "",
    authorizationDate: selected?.state === "AUTORIZADO" ? selected.authorizationDate : "",
    environment: selected?.environment || "",
    authorizedXml: selected?.state === "AUTORIZADO" ? selected.authorizedXml : "",
    messages: authorizations.flatMap(item => item.messages),
    authorizations,
    rawXml: String(xml || "")
  };
}

async function postSoap({ endpoint, envelope, timeoutMs = 20000, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new SriTransportError("El backend no dispone de cliente HTTP.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let responseStatus = null;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=UTF-8",
        SOAPAction: ""
      },
      body: envelope,
      signal: controller.signal
    });
    responseStatus = response.status;
    const body = await response.text();
    if (!response.ok) {
      const relevant = safeResponse(body);
      throw new SriTransportError(`El Web Service del SRI respondio HTTP ${response.status}.`, {
        code: "SRI_HTTP_ERROR",
        httpStatus: 502,
        details: { sriHttpStatus: response.status, responseBody: relevant, transport: {
          classification: "HTTP", resultState: UNCERTAIN, nextAction: "AUTHORIZATION_LOOKUP_FIRST", httpStatus: response.status, response: relevant
        } }
      });
    }
    return body;
  } catch (error) {
    if (error instanceof SriTransportError) throw error;
    const transport = nativeDiagnostic(error, { responseStatus });
    const timeoutFailure = transport.classification === "TIMEOUT";
    throw new SriTransportError(
      responseStatus ? `El Web Service del SRI respondio HTTP ${responseStatus}, pero no se pudo leer la respuesta completa.`
        : timeoutFailure ? "El Web Service del SRI excedio el tiempo de espera." : "No fue posible conectar con el Web Service del SRI.",
      { code: responseStatus ? "SRI_HTTP_ERROR" : timeoutFailure ? "SRI_TIMEOUT" : "SRI_NETWORK_ERROR", details: { reason: safeText(error?.message || "unknown"), transport } }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function safeResponse(body) {
  // Extract diagnostic fields only; never persist echoed fiscal XML or HTML.
  try {
    const parsed = parser.parse(String(body || ""));
    const fault = parsed?.Envelope?.Body?.Fault;
    if (fault) return { faultCode: safeText(textValue(fault.faultcode)), faultString: safeText(textValue(fault.faultstring)) };
    const messages = [];
    function visit(node, depth = 0) {
      if (!node || typeof node !== "object" || depth > 10 || messages.length >= 8) return;
      for (const [key, value] of Object.entries(node)) {
        if (["identificador", "mensaje", "informacionAdicional"].includes(key) && typeof value === "string") messages.push({ field: key, text: safeText(value) });
        else if (typeof value === "object") visit(value, depth + 1);
      }
    }
    visit(parsed);
    if (messages.length) return { messages: messages.slice(0, 8) };
  } catch { /* The bounded text sanitizer also removes unreadable XML. */ }
  return safeText(body);
}

function responseFailure(error) {
  if (!(error instanceof SriTransportError)) return error;
  const transport = error.details?.transport || { classification: "NETWORK_OTHER", resultState: UNCERTAIN, nextAction: "AUTHORIZATION_LOOKUP_FIRST" };
  error.details = { ...error.details, transport: { ...transport, httpStatus: 200 } };
  return error;
}

async function sendForReception(signedXml, options = {}) {
  const rawXml = await postSoap({
    endpoint: options.endpoint || TEST_ENDPOINTS.reception,
    envelope: buildReceptionEnvelope(signedXml),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl
  });
  try { return parseReceptionResponse(rawXml); } catch (error) { throw responseFailure(error); }
}

async function queryAuthorization(accessKey, options = {}) {
  const rawXml = await postSoap({
    endpoint: options.endpoint || TEST_ENDPOINTS.authorization,
    envelope: buildAuthorizationEnvelope(accessKey),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl
  });
  try { return parseAuthorizationResponse(rawXml); } catch (error) { throw responseFailure(error); }
}

module.exports = {
  TEST_ENDPOINTS,
  buildReceptionEnvelope,
  buildAuthorizationEnvelope,
  parseReceptionResponse,
  parseAuthorizationResponse,
  postSoap,
  sendForReception,
  queryAuthorization
};
