const { sha256 } = require('./artifact-store.cjs');
const { assertCanonicalDocumentIdentity } = require('./xml-identity.cjs');
const { endpointFor } = require('./environment.cjs');
const { definitiveAuthorizationAbsent } = require('./withholding-date-recovery.cjs');
const { frozenIdentity, evaluateManualSameDocumentRetry } = require('./manual-retry-policy.cjs');

const COMPATIBLE_NORMAL_BLOCKS = new Set([
  'INSUFFICIENT_RECEPTION_EVIDENCE',
  'AUTHORIZATION_LOOKUP_REQUIRED',
  'AUTHORIZATION_EVIDENCE_INCOMPLETE',
  'LATEST_LOOKUP_INCONCLUSIVE',
  'FINAL_LOOKUP_NOT_ABSENT'
]);
const FINAL_DOCUMENT_STATUSES = new Set(['AUTORIZADO', 'ANULADO', 'RECIBIDO_SRI', 'NO_AUTORIZADO', 'DEVUELTO']);
const PROCESSING_CODES = new Set(['43', '45', '70']);

function timestamp(row) {
  return Date.parse(row?.finished_at || row?.started_at || row?.created_at) || 0;
}

function latest(rows) {
  return [...rows].sort((a, b) => timestamp(b) - timestamp(a))[0];
}

function own(row, document) {
  return row?.company_id === document?.company_id && row?.document_id === document?.id;
}

function messages(detail) {
  return [
    ...(detail.errors || []),
    ...(detail.responses || []).flatMap(response => response.payload?.messages || [])
  ];
}

function hasProcessingCode(detail) {
  return messages(detail).some(message => PROCESSING_CODES.has(String(message?.identifier || '').trim()))
    || (detail.responses || []).some(response => ['PROCESSING', '70'].includes(String(response.sri_status || '').toUpperCase()));
}

function responseResult(response) {
  return response ? { ...(response.payload || {}), rawXml: response.raw_xml } : null;
}

function isDefinitiveAbsent(document, response) {
  return Boolean(response
    && response.response_type === 'AUTHORIZATION'
    && response.raw_xml
    && response.content_sha256 === sha256(response.raw_xml)
    && definitiveAuthorizationAbsent(document, responseResult(response)));
}

function isAuthorized(response) {
  return Boolean(response && (
    ['AUTORIZADO', 'AUTHORIZED'].includes(String(response.sri_status || '').toUpperCase())
    || response.payload?.authorized === true
    || ['AUTORIZADO', 'AUTHORIZED'].includes(String(response.payload?.state || '').toUpperCase())
  ));
}

function isProcessing(response) {
  return Boolean(response && (
    ['PROCESSING', 'EN_PROCESO'].includes(String(response.sri_status || '').toUpperCase())
    || ['PROCESSING', 'EN_PROCESO'].includes(String(response.payload?.state || '').toUpperCase())
    || (response.payload?.messages || []).some(message => String(message?.identifier || '').trim() === '70')
  ));
}

function evaluateBreakGlassRetry(detail, options = {}) {
  const document = detail.document || {};
  const jobs = detail.transmissions || [];
  const attempts = detail.transmissionAttempts || [];
  const responses = detail.responses || [];
  const now = options.now ?? Date.now();
  const identity = frozenIdentity(detail);
  const evidence = { identity };
  const authJobFromDetail = jobs.find(job => job.transmission_type === 'AUTHORIZATION_QUERY');
  const lookupLimit = Number.isInteger(Number(authJobFromDetail?.max_attempts))
    ? Math.max(1, Math.min(100, Number(authJobFromDetail.max_attempts)))
    : 10;
  const validLookupIds = () => evidence.authorizationLookupAttemptIds || [];
  const decision = (allowed, reasonCode, humanReason, extra = {}) => ({
    allowed, reasonCode, humanReason, evidence,
    authorizationLookupCount: validLookupIds().length,
    authorizationLookupLimit: lookupLimit,
    manualReviewRequired: validLookupIds().length >= lookupLimit,
    ...extra
  });
  const block = (reasonCode, humanReason, extra = {}) => decision(false, reasonCode, humanReason, extra);
  const normal = options.normal || evaluateManualSameDocumentRetry(detail, {
    now,
    requireValidation: true,
    validation: options.validation || detail.breakGlassValidation
  });

  if (normal.allowed) return block('NORMAL_RETRY_AVAILABLE', 'El reintento normal ya es elegible; no se ofrece una acción extraordinaria.');
  if (!COMPATIBLE_NORMAL_BLOCKS.has(normal.reasonCode)) {
    return block('BREAK_GLASS_INCOMPATIBLE', normal.humanReason || 'El bloqueo actual no corresponde a un resultado de recepción incierto.');
  }
  try {
    assertCanonicalDocumentIdentity(document);
  } catch {
    return block('IDENTITY_INVALID', 'La identidad fiscal canónica no es consistente.');
  }
  if (FINAL_DOCUMENT_STATUSES.has(document.status) || (detail.authorizations || []).length) {
    return block('FISCAL_RESPONSE_PREVENTS_RESEND', 'El documento ya tiene un resultado fiscal que impide retransmitirlo.');
  }
  if (!['PENDIENTE_REINTENTO', 'ERROR_ENVIO', 'ENVIADO_SRI'].includes(document.status)) {
    return block('STATUS_NOT_ELIGIBLE', 'El estado actual no admite un reintento extraordinario.');
  }
  if (detail.management?.automatic_paused || detail.management?.correction_in_progress) {
    return block('MANUAL_REVIEW_REQUIRED', 'El documento está pausado o en corrección.');
  }
  if (detail.cancellation?.unavailableReason) {
    return block('CANCELLATION_STATE_UNAVAILABLE', 'No se pudo verificar que no exista una anulación activa.');
  }
  if (detail.cancellation && !['NONE', undefined, null].includes(detail.cancellation.state)) {
    return block('CANCELLATION_ACTIVE', 'Existe una gestión de anulación activa; no se retransmitirá.');
  }
  if ((detail.managerEvents || []).some(event => event.action === 'CANCELLATION_REQUESTED')) {
    return block('CANCELLATION_ACTIVE', 'Existe una solicitud de anulación activa; no se retransmitirá.');
  }

  const ownedAuthorization = options.ownedAuthorization;
  if (jobs.some(job => job.status === 'PROCESSING'
      && !(ownedAuthorization && job.id === ownedAuthorization.id && job.worker_id === ownedAuthorization.worker_id))) {
    return block('ACTIVE_CLAIM', 'Otro proceso está trabajando este comprobante.');
  }
  if (attempts.some(attempt => attempt.status === 'STARTED' && attempt.id !== ownedAuthorization?.claim_attempt?.id)) {
    return block('ACTIVE_CLAIM', 'Existe un intento activo sobre este comprobante.');
  }
  if (jobs.some(job => Number.isFinite(Date.parse(job.next_attempt_at)) && Date.parse(job.next_attempt_at) > now)) {
    return block('WAIT_SCHEDULED', 'Todavía vence una espera programada antes de la gestión extraordinaria.');
  }

  if (hasProcessingCode(detail)) return block('PROCESSING_OR_REGISTERED', 'Existe evidencia de procesamiento o clave registrada; solo corresponde consultar autorización.');
  if (responses.some(response => own(response, document) && response.response_type === 'RECEPTION')) {
    return block('RECEPTION_RESPONSE_EXISTS', 'Existe una respuesta de recepción; primero debe resolverse con su contrato oficial.');
  }

  const signed = (detail.files || []).find(file => own(file, document) && file.id === identity.signedFileId);
  if (!signed || !/^[a-f0-9]{64}$/.test(signed.content_sha256)
      || signed.storage_bucket !== 'sri-private'
      || signed.storage_object_path !== `companies/${document.company_id}/documents/${document.id}/signed_xml-${signed.content_sha256}.xml`) {
    return block('SIGNED_XML_REQUIRED', 'Falta el XML firmado archivado con su identidad y hash canónicos.');
  }
  const reception = jobs.find(job => own(job, document) && job.transmission_type === 'RECEPTION');
  const sent = latest(attempts.filter(attempt => own(attempt, document) && attempt.transmission_id === reception?.id));
  if (!reception || !sent || !['FAILED', 'RETRY_SCHEDULED'].includes(reception.status)
      || reception.environment !== document.environment
      || reception.endpoint_url !== endpointFor(document.environment, 'RECEPTION')
      || reception.request_file_id !== signed.id
      || sent.endpoint_url !== reception.endpoint_url
      || sent.request_sha256 !== signed.content_sha256
      || !sent.finished_at) {
    return block('RECEPTION_EVIDENCE_MISSING', 'No se puede demostrar que el intento anterior utilizó exactamente este XML firmado.');
  }
  evidence.receptionAttemptId = sent.id;

  const authJob = authJobFromDetail;
  if (!authJob || !own(authJob, document)
      || !['FAILED', 'RETRY_SCHEDULED', 'PENDING', 'PROCESSING', 'COMPLETED'].includes(authJob.status)
      || authJob.environment !== document.environment
      || authJob.endpoint_url !== endpointFor(document.environment, 'AUTHORIZATION_QUERY')) {
    return block('AUTHORIZATION_LOOKUP_REQUIRED', 'Primero debe existir una consulta de autorización con la misma clave y ambiente.');
  }
  const authResponses = responses.filter(response => own(response, document)
    && response.transmission_id === authJob.id && response.response_type === 'AUTHORIZATION');
  if (authResponses.some(response => isAuthorized(response) || isProcessing(response))) {
    return block('AUTHORIZATION_NOT_ABSENT', 'La evidencia de autorización no permite retransmitir.');
  }
  const absentByHash = new Map(authResponses.filter(response => isDefinitiveAbsent(document, response))
    .map(response => [response.content_sha256, response]));
  const authAttempts = attempts.filter(attempt => own(attempt, document) && attempt.transmission_id === authJob.id);
  const validLookups = authAttempts.filter(attempt => attempt.id !== ownedAuthorization?.claim_attempt?.id
    && attempt.endpoint_url === authJob.endpoint_url
    && attempt.request_sha256 === sha256(document.access_key)
    && attempt.http_status === 200
    && attempt.finished_at
    && timestamp(attempt) > timestamp(sent)
    && absentByHash.has(attempt.response_sha256));
  evidence.authorizationLookupAttemptIds = validLookups.map(attempt => attempt.id);
  if (!validLookups.length) return block('AUTHORIZATION_LOOKUP_REQUIRED', 'Se requiere al menos una consulta válida de autorización posterior al último envío.');
  const lastLookup = latest(authAttempts.filter(attempt => attempt.id !== ownedAuthorization?.claim_attempt?.id));
  if (!lastLookup || !validLookups.some(attempt => attempt.id === lastLookup.id)) {
    return block('LATEST_LOOKUP_INCONCLUSIVE', 'La última consulta no confirmó ausencia de autorización.');
  }
  if (options.finalLookup && !definitiveAuthorizationAbsent(document, options.finalLookup)) {
    return block('FINAL_LOOKUP_NOT_ABSENT', 'La consulta final no confirmó ausencia; no se retransmitirá.');
  }
  const validation = options.validation || detail.breakGlassValidation;
  if (!(validation?.validation === 'PASS' && validation.signed && validation.xmlAvailable
      && validation.xmlSha256 === signed.content_sha256)) {
    return block('VALIDATION_REQUIRED', 'Debe pasar la validación canónica del mismo XML firmado antes del reintento extraordinario.');
  }
  return decision(true, 'BREAK_GLASS_RETRY_AVAILABLE',
    'El resultado de recepción anterior no puede demostrarse, las consultas posteriores no confirman autorización y el mismo XML firmado pasó validación. Se requiere confirmación extraordinaria.',
    { evidence: { ...evidence, lastAuthorizationLookupAttemptId: lastLookup.id } });
}

module.exports = { COMPATIBLE_NORMAL_BLOCKS, evaluateBreakGlassRetry };
