const assert = require('node:assert/strict');
const { buildAccessKey } = require('./api/sri/_lib/access-key.cjs');
const { endpointFor } = require('./api/sri/_lib/environment.cjs');
const { sha256 } = require('./api/sri/_lib/artifact-store.cjs');
const { evaluateManualSameDocumentRetry } = require('./api/sri/_lib/manual-retry-policy.cjs');
const { evaluateBreakGlassRetry } = require('./api/sri/_lib/break-glass-retry-policy.cjs');
const { CAPS, managerPolicy } = require('./api/sri/_lib/manager-policy.cjs');

const company = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const receptionId = '33333333-3333-4333-8333-333333333333';
const authorizationId = '44444444-4444-4444-8444-444444444444';
const signedFileId = '55555555-5555-4555-8555-555555555555';
const access = buildAccessKey({
  issueDate: '2026-09-11', documentType: '07', ruc: '1717637084001', environment: 'TEST',
  establishmentCode: '001', emissionPointCode: '002', sequential: 757,
  numericCode: '12345678', emissionType: '1'
});
const signedXml = '<comprobanteRetencion id="comprobante" version="1.1.0"/>';
const signedHash = sha256(signedXml);
const lookupXml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>${access.accessKey}</claveAccesoConsultada><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>`;
const lookupHash = sha256(lookupXml);
const validation = { validation: 'PASS', signed: true, xmlAvailable: true, xmlSha256: signedHash };

function fixture(overrides = {}) {
  const sentAt = '2026-09-11T10:00:00.000Z';
  const lookupAt = '2026-09-11T10:05:00.000Z';
  const document = {
    id: documentId, company_id: company, environment: 'TEST', document_type: '07',
    status: 'PENDIENTE_REINTENTO', issue_date: '2026-09-11',
    establishment_code: '001', emission_point_code: '002', sequential: 757,
    sequential_text: access.sequential, full_number: `001-002-${access.sequential}`,
    access_key: access.accessKey, numeric_code: access.numericCode, emission_type: '1',
    issuer_snapshot: { ruc: '1717637084001' }, source_snapshot: { purchaseId: 'purchase-757' }
  };
  const signed = {
    id: signedFileId, company_id: company, document_id: documentId, file_type: 'SIGNED_XML',
    storage_bucket: 'sri-private', content_sha256: signedHash,
    storage_object_path: `companies/${company}/documents/${documentId}/signed_xml-${signedHash}.xml`
  };
  const reception = {
    id: receptionId, company_id: company, document_id: documentId, transmission_type: 'RECEPTION',
    environment: 'TEST', endpoint_url: endpointFor('TEST', 'RECEPTION'), status: 'FAILED',
    request_file_id: signedFileId, finished_at: '2026-09-11T10:01:00.000Z'
  };
  const authJob = {
    id: authorizationId, company_id: company, document_id: documentId,
    transmission_type: 'AUTHORIZATION_QUERY', environment: 'TEST',
    endpoint_url: endpointFor('TEST', 'AUTHORIZATION_QUERY'), status: 'FAILED', max_attempts: 10
  };
  const detail = {
    document,
    files: [signed],
    transmissions: [reception, authJob],
    transmissionAttempts: [
      { id: '66666666-6666-4666-8666-666666666666', company_id: company, document_id: documentId,
        transmission_id: receptionId, status: 'FAILED', endpoint_url: reception.endpoint_url,
        request_sha256: signedHash, http_status: 500, started_at: sentAt, finished_at: '2026-09-11T10:01:00.000Z' },
      { id: '77777777-7777-4777-8777-777777777777', company_id: company, document_id: documentId,
        transmission_id: authorizationId, status: 'SUCCEEDED', endpoint_url: authJob.endpoint_url,
        request_sha256: sha256(access.accessKey), response_sha256: lookupHash, http_status: 200,
        started_at: lookupAt, finished_at: '2026-09-11T10:06:00.000Z' }
    ],
    responses: [{ id: '88888888-8888-4888-8888-888888888888', company_id: company, document_id: documentId,
      transmission_id: authorizationId, response_type: 'AUTHORIZATION', sri_status: 'NO_ENCONTRADO',
      raw_xml: lookupXml, content_sha256: lookupHash,
      payload: { state: 'NO_ENCONTRADO', accessKey: access.accessKey, documentCount: 0, authorized: false, messages: [], authorizations: [] } }],
    errors: [], authorizations: [], audit: [], managerEvents: [],
    management: { automatic_paused: false, correction_in_progress: false }
  };
  return structuredClone(Object.assign(detail, overrides));
}

function available(detail = fixture()) {
  return evaluateBreakGlassRetry(detail, { validation });
}

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, result: 'PASS' }); }
  catch (error) { results.push({ name, result: 'FAIL', message: error.stack }); }
}

test('insufficient reception evidence offers extraordinary action after one valid lookup', () => {
  const detail = fixture();
  const normal = evaluateManualSameDocumentRetry(detail, { requireValidation: true, validation });
  const result = available(detail);
  assert.equal(normal.reasonCode, 'INSUFFICIENT_RECEPTION_EVIDENCE');
  assert.equal(result.allowed, true);
  assert.equal(result.reasonCode, 'BREAK_GLASS_RETRY_AVAILABLE');
  assert.equal(result.authorizationLookupCount, 1);
  assert.equal(result.authorizationLookupLimit, 10);
  assert.equal(result.manualReviewRequired, false);
});

test('bounded lookup budget never turns normal safe retry on', () => {
  const detail = fixture(); detail.transmissions[1].max_attempts = 1;
  const normal = evaluateManualSameDocumentRetry(detail, { requireValidation: true, validation });
  const result = available(detail);
  assert.equal(normal.allowed, false);
  assert.equal(normal.reasonCode, 'INSUFFICIENT_RECEPTION_EVIDENCE');
  assert.equal(result.allowed, true);
  assert.equal(result.manualReviewRequired, true);
  assert.equal(result.authorizationLookupCount >= result.authorizationLookupLimit, true);
});

test('authorized response blocks break-glass', () => {
  const detail = fixture(); detail.responses[0].sri_status = 'AUTORIZADO'; detail.responses[0].payload.authorized = true;
  const result = available(detail);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'AUTHORIZATION_NOT_ABSENT');
});

test('processing code blocks break-glass', () => {
  const detail = fixture({ errors: [{ company_id: company, document_id: documentId, identifier: '70' }] });
  const result = available(detail);
  assert.equal(result.allowed, false);
  assert.notEqual(result.reasonCode, 'BREAK_GLASS_RETRY_AVAILABLE');
});

test('active claim blocks break-glass', () => {
  const detail = fixture(); detail.transmissions.push({
    id: '99999999-9999-4999-8999-999999999999', company_id: company, document_id: documentId,
    transmission_type: 'RECEPTION', status: 'PROCESSING'
  });
  const result = available(detail);
  assert.equal(result.allowed, false);
});

test('signed XML identity mismatch blocks break-glass', () => {
  const detail = fixture(); detail.files[0].content_sha256 = 'a'.repeat(64);
  const result = available(detail);
  assert.equal(result.allowed, false);
});

test('missing valid lookup after the last reception attempt blocks break-glass', () => {
  const detail = fixture(); detail.transmissionAttempts[1].finished_at = '2026-09-11T09:59:00.000Z';
  const result = available(detail);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'AUTHORIZATION_LOOKUP_REQUIRED');
});

test('final authorization result is evaluated independently before send', () => {
  const detail = fixture();
  const finalLookup = { state: 'AUTORIZADO', authorized: true, accessKey: access.accessKey };
  const result = evaluateBreakGlassRetry(detail, { validation, finalLookup });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'FINAL_LOOKUP_NOT_ABSENT');
});

test('manager exposes a separate extraordinary action without changing normal retry', () => {
  const detail = fixture({ breakGlassValidation: validation });
  const policy = managerPolicy(detail, [CAPS.breakGlassRetry, CAPS.retry]);
  assert.equal(policy.actions.retry.allowed, false);
  assert.equal(policy.manualSameDocumentRetry.reasonCode, 'INSUFFICIENT_RECEPTION_EVIDENCE');
  assert.equal(policy.actions.breakGlassRetry.allowed, true);
  assert.equal(policy.breakGlassRetry.offered, true);
  assert.equal(policy.breakGlassRetry.reasonCode, 'BREAK_GLASS_RETRY_AVAILABLE');
});

const failed = results.filter(result => result.result !== 'PASS');
console.log(JSON.stringify({ result: failed.length ? 'FAIL' : 'PASS', results, realSriRequests: 0, realDocumentsChanged: 0 }, null, 2));
if (failed.length) process.exitCode = 1;
