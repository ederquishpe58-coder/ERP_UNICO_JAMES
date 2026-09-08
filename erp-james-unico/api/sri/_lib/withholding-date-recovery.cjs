const { XMLParser } = require("fast-xml-parser");
const { ecuadorDate } = require("./emission-date.cjs");
const { assertCanonicalDocumentIdentity } = require("./xml-identity.cjs");
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true });

// A narrow recovery case: the original receipt was returned ONLY for code 65,
// before its immutable issue date, and that date is now today's Ecuador date.
// This does not make expired documents, other errors, 01 or 04 retryable.
function withholdingDateRecovery(detail, now = new Date()) {
  const document = detail?.document || {};
  try { assertCanonicalDocumentIdentity(document); } catch { return null; }
  if (document.document_type !== "07" || document.status !== "DEVUELTO"
      || document.issue_date !== ecuadorDate(now) || detail.authorizations?.length) return null;
  const own = row => row.company_id === document.company_id && row.document_id === document.id;
  const response = (detail.responses || []).filter(row => own(row) && row.response_type === "RECEPTION")
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))[0];
  if (!response || !Number.isFinite(Date.parse(response.received_at))
      || ecuadorDate(new Date(response.received_at)) >= document.issue_date
      || response.sri_status !== "DEVUELTA" || response.payload?.returned !== true
      || response.payload?.messages?.length !== 1
      || response.payload.messages[0].identifier !== "65"
      || response.payload?.receipts?.length !== 1
      || response.payload.receipts[0].accessKey !== document.access_key) return null;
  const job = (detail.transmissions || []).find(row => own(row) && row.id === response.transmission_id
    && row.transmission_type === "RECEPTION" && row.environment === document.environment
    && row.status === "COMPLETED" && row.attempt_number < row.max_attempts);
  const signed = (detail.files || []).find(row => own(row) && row.id === job?.request_file_id && row.file_type === "SIGNED_XML");
  if (!signed) return null;
  return { receptionResponseId: response.id, signedFileId: signed.id };
}

// Missing/ambiguous counts and pending/error messages MUST NOT authorize resending.
function definitiveAuthorizationAbsent(document, result) {
  if (result.state !== "NO_ENCONTRADO" || result.authorized !== false
      || result.accessKey !== document.access_key || result.documentCount !== 0
      || result.authorizations?.length !== 0 || result.messages?.length !== 0) return false;
  try {
    const response = parser.parse(result.rawXml)?.Envelope?.Body
      ?.autorizacionComprobanteResponse?.RespuestaAutorizacionComprobante;
    return response?.claveAccesoConsultada === document.access_key
      && response?.numeroComprobantes === "0" && !response?.mensajes
      && (!response.autorizaciones || response.autorizaciones === "");
  } catch { return false; }
}

module.exports = { withholdingDateRecovery, definitiveAuthorizationAbsent };
