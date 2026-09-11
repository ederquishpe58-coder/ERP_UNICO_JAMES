const { CAPS,managerPolicy }=require('./manager-policy.cjs');
const { getDocumentDetail,dbError,uuidOrNull }=require('./document-service.cjs');
const { validateDocument }=require('./manager-validation.cjs');
const transport=require('./transmission-service.cjs');
const { safeText }=require('./transport-diagnostic.cjs');
const { SriError,SriValidationError }=require('./errors.cjs');
const { parseOfficialEvidence }=require('./manager-evidence.cjs');
const { sha256 }=require('./artifact-store.cjs');
const { assertDocumentXmlIdentity }=require('./xml-identity.cjs');
const { verifyXadesBes }=require('./xades-signer.cjs');
const { evaluateManualSameDocumentRetry }=require('./manual-retry-policy.cjs');
const { COMPATIBLE_NORMAL_BLOCKS,evaluateBreakGlassRetry }=require('./break-glass-retry-policy.cjs');
function assertId(id){if(!uuidOrNull(id))throw new SriValidationError('Seleccione un comprobante canónico.');return id;}
async function detail(client,userClient,companyId,documentId){
 const data=await getDocumentDetail(client,companyId,assertId(documentId));
 if(data.document.company_id!==companyId||!['01','04','07'].includes(data.document.document_type))throw new SriValidationError('Documento fuera del alcance del gestor.');
 for(const collection of ['files','transmissions','transmissionAttempts','responses','authorizations','errors','audit'])for(const item of data[collection]||[])if(item.company_id!==companyId||item.document_id!==documentId)throw new SriValidationError('Referencia relacionada de otra empresa o comprobante.');
 for(const collection of ['lines','taxes','accountingLinks','journalEntries'])for(const item of data[collection]||[])if(item.company_id!==companyId||(item.document_id&&item.document_id!==documentId)||(item.source_document_id&&item.source_document_id!==documentId))throw new SriValidationError('Referencia relacionada de otra empresa o comprobante.');
 const [meta,events,rights]=await Promise.all([
  client.from('erp_sri_document_management').select('*').eq('company_id',companyId).eq('document_id',documentId).maybeSingle(),
  client.from('erp_sri_document_manager_events').select('operation_id,action,actor_user_id,reason,before_state,after_state,evidence,created_at').eq('company_id',companyId).eq('document_id',documentId).order('created_at',{ascending:false}),
  userClient.rpc('erp_security_get_effective_capabilities',{p_company_id:companyId})]);
 data.management=dbError(meta,'Control manual SRI')||{version:0,revision:1,automatic_paused:false};data.managerEvents=dbError(events,'Historial del gestor');
 const capabilities=dbError(rights,'Permisos canónicos').map(x=>x.capability_id);
 data.technicalHistory=[...(data.audit||[]).map(x=>({timestamp:x.created_at,actor:x.actor_user_id,action:x.action,reason:safeText(x.reason),operationId:x.new_values?.operation_id||x.new_values?.operationId||null,attemptId:x.new_values?.attempt_id||x.new_values?.attemptId||null,result:x.new_status||'',classification:x.new_values?.transport?.classification||null})),...(data.transmissionAttempts||[]).map(x=>({timestamp:x.finished_at||x.started_at||x.created_at,actor:null,action:data.transmissions.find(j=>j.id===x.transmission_id)?.transmission_type==='AUTHORIZATION_QUERY'?'AUTHORIZATION_LOOKUP_ATTEMPT':'TRANSMISSION_ATTEMPT',attemptId:x.id,operationId:x.transmission_id,result:x.status,reason:safeText(x.error_message),classification:x.error_class})),...data.managerEvents.map(x=>({timestamp:x.created_at,actor:x.actor_user_id,action:x.action,operationId:x.operation_id,reason:safeText(x.reason),result:x.after_state?.state||'REGISTRADO'}))].sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
 data.source={orderId:data.document.source_order_id,originalInvoiceId:data.document.parent_document_id,purchaseId:data.document.source_snapshot?.erpWithholding?.purchaseDocumentId||data.document.source_snapshot?.purchaseId||null};
 data.officialMessages=(data.responses?.[0]?.payload?.messages||[]).map(m=>({code:safeText(m.identifier),message:safeText(m.message),additionalInformation:safeText(m.additionalInformation)}));
 if(data.document.document_type==='07'&&capabilities.includes('purchases.withholdings.view')){
  const c=await userClient.rpc('erp_purchase_withholding_cancellation_state',{p_company_id:companyId,p_document_id:documentId});
  data.cancellation=c.error?{unavailableReason:safeText(c.error.message)}:c.data;
 }
 if(['01','04'].includes(data.document.document_type)&&data.document.status==='AUTORIZADO'){
  const event=data.managerEvents.find(e=>e.action==='CANCELLATION_REQUESTED');
  data.cancellation={state:event?.after_state?.state||'NONE',version:data.management.version,documentUpdatedAt:data.document.updated_at,
   actions:capabilities.includes(CAPS.cancellation)?[event?'SUBMIT_PORTAL_REFERENCE':'REQUEST']:[],trackingOnly:true,
   unavailableReason:'Seguimiento interno de anulación. El comprobante sigue vigente. La anulación final está bloqueada hasta disponer del workflow canónico completo de este tipo documental.'};
 }
 const normalStructural=evaluateManualSameDocumentRetry(data);
 if(capabilities.includes(CAPS.retry)&&normalStructural.allowed) data.manualRetryValidation=await validateDocument(client,data);
 const breakGlassStructural=evaluateBreakGlassRetry(data,{normal:normalStructural});
 if(capabilities.includes(CAPS.breakGlassRetry)
     && (COMPATIBLE_NORMAL_BLOCKS.has(normalStructural.reasonCode)||breakGlassStructural.reasonCode==='VALIDATION_REQUIRED')) {
  data.breakGlassValidation=await validateDocument(client,data);
 }
 data.managerPolicy=managerPolicy(data,capabilities);
 return data;
}
async function list(userClient,companyId,filters={}){
 const result=await userClient.rpc('erp_sri_manager_list',{p_company_id:companyId,p_filters:filters});
 return dbError(result,'Gestor de comprobantes');
}
async function recover(client,userClient,companyId,documentId,actorUserId,options={}){
 const current=await detail(client,userClient,companyId,documentId),policy=current.managerPolicy;
 if(!policy.actions.recover.allowed)throw new SriError(policy.actions.recover.reason||'El documento no admite recuperación.',{code:'SRI_MANAGER_RECOVERY_BLOCKED',httpStatus:409,details:{waitUntil:policy.waitUntil}});
 const settings=await transport.settingsFor(client,companyId,current.document);
 try{await transport.processAuthorization(client,settings,current.document,actorUserId,{...options,managerRecovery:true,recoveryQuery:true,manualDateRecovery:false,force:false});}
 catch(e){if(!['SRI_AUTHORIZATION_PENDING','SRI_MANAGER_WAIT_SCHEDULED'].includes(e.code))throw e;}
 return detail(client,userClient,companyId,documentId);
}
async function evidence(client,userClient,companyId,documentId,actorUserId,input={}){
 const current=await detail(client,userClient,companyId,documentId);
 if(input.accessKey!==current.document.access_key||input.authorizationNumber!==current.document.access_key)throw new SriValidationError('La evidencia no coincide con la clave y autorización del documento.');
 if(!uuidOrNull(input.operationId)||String(input.reason||'').trim().length<3)throw new SriValidationError('Motivo e identificador de operación requeridos.');
 let evidenceHash=null;
 if(input.officialXml){if(typeof input.officialXml!=='string'||Buffer.byteLength(input.officialXml)>2*1024*1024||/<!\s*(DOCTYPE|ENTITY)/i.test(input.officialXml))throw new SriValidationError('XML de evidencia inválido.');
  const result=parseOfficialEvidence(input.officialXml,current.document.access_key);transport.validateAuthorizationIdentity(current.document,result);if(!result.authorized)throw new SriValidationError('El XML adjunto no contiene autorización.');assertDocumentXmlIdentity(current.document,result.authorizedXml);if(!await verifyXadesBes(result.authorizedXml))throw new SriValidationError('La firma del XML adjunto es inválida.');evidenceHash=sha256(input.officialXml);
 }
 // An uploaded result is evidence, never authority to change fiscal status.
 const previous=dbError(await client.from('erp_sri_document_manager_events').select('*').eq('operation_id',input.operationId).maybeSingle(),'Identidad de la operación de evidencia');
 if(previous){
  if(previous.company_id!==companyId||previous.document_id!==documentId||previous.action!=='EXTERNAL_EVIDENCE'||previous.actor_user_id!==actorUserId||previous.reason!==input.reason||previous.evidence?.accessKey!==input.accessKey||previous.evidence?.authorizationNumber!==input.authorizationNumber||previous.evidence?.sha256!==evidenceHash)throw new SriValidationError('Identificador de operación usado por otra evidencia.');
  return current;
 }
 if(!current.managerPolicy.actions.evidence.allowed)throw new SriValidationError(current.managerPolicy.actions.evidence.reason);
 await recover(client,userClient,companyId,documentId,actorUserId);
 const args={p_company_id:companyId,p_document_id:documentId,p_operation_id:input.operationId,p_reason:input.reason,p_access_key:input.accessKey,p_authorization_number:input.authorizationNumber,p_evidence_sha256:evidenceHash};
 dbError(await userClient.rpc('erp_sri_manager_record_evidence',args),'Evidencia externa');return detail(client,userClient,companyId,documentId);
 }
 async function breakGlassRetry(client,userClient,companyId,documentId,actorUserId,input={},deps={}){
  return require('./break-glass-retry-service.cjs').breakGlassRetry(client,userClient,companyId,documentId,actorUserId,input,deps);
 }
 module.exports={CAPS,detail,list,recover,evidence,breakGlassRetry,validateDocument};
