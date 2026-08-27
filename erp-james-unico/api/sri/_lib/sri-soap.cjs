const { XMLParser } = require("fast-xml-parser");
const { SriTransportError, SriValidationError } = require("./errors.cjs");
const { validateAccessKey } = require("./access-key.cjs");

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
      details: { reason: error.message }
    });
  }
  const body = parsed?.Envelope?.Body;
  if (!body) throw new SriTransportError("La respuesta del SRI no contiene un cuerpo SOAP.");
  if (body.Fault) {
    throw new SriTransportError("El Web Service del SRI devolvio una falla SOAP.", {
      details: {
        faultCode: textValue(body.Fault.faultcode),
        faultString: textValue(body.Fault.faultstring)
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
    const body = await response.text();
    if (!response.ok) {
      throw new SriTransportError(`El Web Service del SRI respondio HTTP ${response.status}.`, {
        httpStatus: 502,
        details: { sriHttpStatus: response.status, responseBody: body.slice(0, 4000) }
      });
    }
    return body;
  } catch (error) {
    if (error instanceof SriTransportError) throw error;
    const timeoutFailure = error?.name === "AbortError";
    throw new SriTransportError(
      timeoutFailure ? "El Web Service del SRI excedio el tiempo de espera." : "No fue posible conectar con el Web Service del SRI.",
      { code: timeoutFailure ? "SRI_TIMEOUT" : "SRI_NETWORK_ERROR", details: { reason: error?.message || "unknown" } }
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function sendForReception(signedXml, options = {}) {
  const rawXml = await postSoap({
    endpoint: options.endpoint || TEST_ENDPOINTS.reception,
    envelope: buildReceptionEnvelope(signedXml),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl
  });
  return parseReceptionResponse(rawXml);
}

async function queryAuthorization(accessKey, options = {}) {
  const rawXml = await postSoap({
    endpoint: options.endpoint || TEST_ENDPOINTS.authorization,
    envelope: buildAuthorizationEnvelope(accessKey),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl
  });
  return parseAuthorizationResponse(rawXml);
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
