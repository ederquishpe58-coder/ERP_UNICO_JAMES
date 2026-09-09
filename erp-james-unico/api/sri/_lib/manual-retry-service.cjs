const { isDeepStrictEqual }=require('node:util');
const manager=require('./manager-service.cjs');
const transport=require('./transmission-service.cjs');
const { getDocumentDetail,dbError,uuidOrNull }=require('./document-service.cjs');
const { validateDocument }=require('./manager-validation.cjs');
const { frozenIdentity,evaluateManualSameDocumentRetry }=require('./manual-retry-policy.cjs');
const { SriError,SriValidationError }=require('./errors.cjs');
async function retrySameDocument(client,userClient,companyId,documentId,actorUserId,input={},deps={}) {
 const read=deps.detail||manager.detail,validate=deps.validate||validateDocument;
 const current=await read(client,userClient,companyId,documentId);
 if(!uuidOrNull(input.operationId)||input.confirmSameDocument!==true||!isDeepStrictEqual(input.identity,frozenIdentity(current)))throw new SriValidationError('Confirme el mismo comprobante y su identidad fiscal actual, sin cambios.');
 if(!current.managerPolicy.actions.retry.allowed)throw new SriError(current.managerPolicy.actions.retry.reason,{code:'SRI_MANUAL_RETRY_BLOCKED',httpStatus:409,details:current.managerPolicy.manualSameDocumentRetry});
 const prior=dbError(await client.from('electronic_document_audit_logs').select('id,company_id,document_id,actor_user_id,new_values').eq('action','SRI_MANUAL_SAME_DOCUMENT_RETRY').contains('new_values',{operation_id:input.operationId}).maybeSingle(),'Operación de reintento');
 if(prior)throw new SriError('Esta confirmación ya fue utilizada. Consulte el estado del mismo comprobante.',{code:'SRI_MANUAL_RETRY_OPERATION_CONSUMED',httpStatus:409});
 const settings=await transport.settingsFor(client,companyId,current.document),handoff={completed:false};
 const check=async(job,finalLookup)=>{
  const fresh=await getDocumentDetail(client,companyId,documentId);
  fresh.management=dbError(await client.from('erp_sri_document_management').select('*').eq('company_id',companyId).eq('document_id',documentId).maybeSingle(),'Control de revisión')||{};
  if(!isDeepStrictEqual(frozenIdentity(fresh),input.identity))throw new SriValidationError('La identidad o XML cambió después de la confirmación.');
  const validation=await validate(client,fresh);
  const p=evaluateManualSameDocumentRetry(fresh,{ownedAuthorization:job,requireValidation:true,validation,finalLookup});
  if(!p.allowed)throw new SriError(p.humanReason,{code:p.reasonCode,httpStatus:409});
  return {fresh,validation,p};
 };
 try {
  await transport.processAuthorization(client,settings,current.document,actorUserId,{
   managerRecovery:true,recoveryQuery:true,timeoutMs:30000,fetchImpl:deps.fetchImpl,manualRetryHandoff:handoff,
   beforeAuthorizationLookup:({job})=>check(job),
   onAuthorizationAbsent:async({job,attempt,persisted,result})=>{
    const {fresh,validation,p}=await check(job,result);
    const claim=dbError(await client.rpc('claim_sri_manual_same_document_reception',{
     p_company_id:companyId,p_document_id:documentId,p_actor_user_id:actorUserId,p_operation_id:input.operationId,
     p_authorization_job_id:job.id,p_authorization_worker:job.worker_id,p_authorization_attempt_id:attempt.id,
     p_lookup_response_id:persisted.response.id,p_signed_file_id:input.identity.signedFileId,p_document_snapshot:fresh.document,
     p_evidence:{...p.evidence,validation:validation.validation,signedXmlHash:validation.xmlSha256,finalLookupHash:persisted.hash}
    }),'Toma atómica del mismo comprobante');
    if(!claim?.manual_same_document||claim.operation_id!==input.operationId||claim.company_id!==companyId||claim.document_id!==documentId||claim.environment!==current.document.environment||claim.claim_attempt?.request_sha256!==input.identity.signedXmlHash||claim.request_file_id!==input.identity.signedFileId)throw new SriValidationError('SRI_MANUAL_RETRY_CANONICAL_ACK_REQUIRED');
    handoff.completed=true;
    return transport.processReception(client,settings,fresh.document,actorUserId,{manualReceptionClaim:claim,timeoutMs:30000,fetchImpl:deps.fetchImpl});
   }
  });
 }catch(e){if(!['SRI_AUTHORIZATION_PENDING','SRI_MANAGER_WAIT_SCHEDULED'].includes(e.code))throw e;}
 return read(client,userClient,companyId,documentId);
}
module.exports={retrySameDocument};
