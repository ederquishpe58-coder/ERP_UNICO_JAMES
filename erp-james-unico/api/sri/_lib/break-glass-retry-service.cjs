const { isDeepStrictEqual } = require('node:util');
const manager = require('./manager-service.cjs');
const transport = require('./transmission-service.cjs');
const { getDocumentDetail, dbError, uuidOrNull } = require('./document-service.cjs');
const { validateDocument } = require('./manager-validation.cjs');
const { frozenIdentity, evaluateManualSameDocumentRetry } = require('./manual-retry-policy.cjs');
const { evaluateBreakGlassRetry } = require('./break-glass-retry-policy.cjs');
const { SriError, SriValidationError } = require('./errors.cjs');

async function breakGlassRetry(client, userClient, companyId, documentId, actorUserId, input = {}, deps = {}) {
  const read = deps.detail || manager.detail;
  const validate = deps.validate || validateDocument;
  const current = await read(client, userClient, companyId, documentId);
  if (!uuidOrNull(input.operationId) || input.confirmBreakGlass !== true
      || !isDeepStrictEqual(input.identity, frozenIdentity(current))) {
    throw new SriValidationError('Confirme el reintento extraordinario del mismo comprobante y su identidad fiscal actual.');
  }
  if (!current.managerPolicy?.actions?.breakGlassRetry?.allowed) {
    throw new SriError(current.managerPolicy?.actions?.breakGlassRetry?.reason || 'El reintento extraordinario no es elegible.', {
      code: 'SRI_BREAK_GLASS_RETRY_BLOCKED',
      httpStatus: 409,
      details: current.managerPolicy?.breakGlassRetry || null
    });
  }
  const prior = dbError(await client.from('electronic_document_audit_logs').select('id,company_id,document_id,actor_user_id,new_values')
    .eq('company_id', companyId).eq('document_id', documentId)
    .eq('action', 'SRI_BREAK_GLASS_RETRY').contains('new_values', { operation_id: input.operationId }).maybeSingle(), 'Operacion extraordinaria');
  if (prior) throw new SriError('Esta confirmacion extraordinaria ya fue utilizada. Consulte el estado del mismo comprobante.', {
    code: 'SRI_BREAK_GLASS_RETRY_OPERATION_CONSUMED', httpStatus: 409
  });

  const settings = deps.settings ? await deps.settings(client, companyId, current.document) : await transport.settingsFor(client, companyId, current.document);
  const handoff = { completed: false };
  const check = async ({ job, finalLookup } = {}) => {
    const fresh = await getDocumentDetail(client, companyId, documentId);
    fresh.management = dbError(await client.from('erp_sri_document_management').select('*')
      .eq('company_id', companyId).eq('document_id', documentId).maybeSingle(), 'Control de revision') || {};
    fresh.managerEvents = dbError(await client.from('erp_sri_document_manager_events').select('action,created_at,after_state')
      .eq('company_id', companyId).eq('document_id', documentId), 'Historial de gestion');
    fresh.cancellation = current.cancellation;
    if (!isDeepStrictEqual(frozenIdentity(fresh), input.identity)) {
      throw new SriValidationError('La identidad, fecha, clave o XML cambio despues de la confirmacion.');
    }
    const validation = await validate(client, fresh);
    const normal = evaluateManualSameDocumentRetry(fresh, {
      ownedAuthorization: job,
      requireValidation: true,
      validation
    });
    const policy = evaluateBreakGlassRetry(fresh, {
      ownedAuthorization: job,
      normal,
      validation,
      finalLookup
    });
    if (!policy.allowed) throw new SriError(policy.humanReason, { code: policy.reasonCode, httpStatus: 409, details: policy });
    return { fresh, validation, policy };
  };

  try {
    await transport.processAuthorization(client, settings, current.document, actorUserId, {
      managerRecovery: true,
      recoveryQuery: true,
      skipAccounting: true,
      timeoutMs: 30000,
      fetchImpl: deps.fetchImpl,
      manualRetryHandoff: handoff,
      beforeAuthorizationLookup: ({ job }) => check({ job }),
      onAuthorizationAbsent: async ({ job, attempt, persisted, result }) => {
        const { fresh, validation, policy } = await check({ job, finalLookup: result });
        const claim = dbError(await client.rpc('claim_sri_break_glass_reception', {
          p_company_id: companyId,
          p_document_id: documentId,
          p_actor_user_id: actorUserId,
          p_operation_id: input.operationId,
          p_authorization_job_id: job.id,
          p_authorization_worker: job.worker_id,
          p_authorization_attempt_id: attempt.id,
          p_lookup_response_id: persisted.response.id,
          p_signed_file_id: input.identity.signedFileId,
          p_document_snapshot: fresh.document,
          p_evidence: {
            ...policy.evidence,
            validation: validation.validation,
            signedXmlHash: validation.xmlSha256,
            finalLookupHash: persisted.hash,
            accountingHash: input.identity.accountingHash,
            accountingLinks: [...(fresh.accountingLinks || [])].sort((left, right) => String(left.id).localeCompare(String(right.id)))
          }
        }), 'Toma atomica del reintento extraordinario');
        if (!claim?.break_glass_same_document
            || claim.operation_id !== input.operationId
            || claim.company_id !== companyId
            || claim.document_id !== documentId
            || claim.environment !== current.document.environment
            || claim.claim_attempt?.request_sha256 !== input.identity.signedXmlHash
            || claim.request_file_id !== input.identity.signedFileId) {
          throw new SriValidationError('SRI_BREAK_GLASS_RETRY_CANONICAL_ACK_REQUIRED');
        }
        if (claim.reused === true) {
          handoff.completed = true;
          return read(client, userClient, companyId, documentId);
        }
        handoff.completed = true;
        return transport.processReception(client, settings, fresh.document, actorUserId, {
          manualReceptionClaim: claim,
          timeoutMs: 30000,
          fetchImpl: deps.fetchImpl
        });
      }
    });
  } catch (error) {
    if (!['SRI_AUTHORIZATION_PENDING', 'SRI_MANAGER_WAIT_SCHEDULED'].includes(error.code)) throw error;
  }
  return read(client, userClient, companyId, documentId);
}

module.exports = { breakGlassRetry };
