const { sha256 } = require('./artifact-store.cjs');
const { assertCanonicalDocumentIdentity } = require('./xml-identity.cjs');
const { endpointFor } = require('./environment.cjs');
const { definitiveAuthorizationAbsent } = require('./withholding-date-recovery.cjs');
const timestamp = x => Date.parse(x?.finished_at || x?.started_at || x?.created_at) || 0;
const latest = rows => [...rows].sort((a,b)=>timestamp(b)-timestamp(a))[0];
const blockingCodes = new Set(['43','45','70']);
function frozenIdentity(detail) {
 const d=detail.document||{},f=(detail.files||[]).filter(f=>f.file_type==='SIGNED_XML').sort((a,b)=>timestamp(b)-timestamp(a))[0];
 return {documentId:d.id,companyId:d.company_id,environment:d.environment,documentType:d.document_type,
  fullNumber:d.full_number,sequential:d.sequential_text,accessKey:d.access_key,issueDate:d.issue_date,
  establishment:d.establishment_code,emissionPoint:d.emission_point_code,signedFileId:f?.id,signedXmlHash:f?.content_sha256,
  sourceHash:sha256(JSON.stringify(d.source_snapshot||{})),accountingHash:sha256(JSON.stringify(detail.accountingLinks||[]))};
}
function evaluateManualSameDocumentRetry(detail, options={}) {
 const d=detail.document||{},jobs=detail.transmissions||[],attempts=detail.transmissionAttempts||[],responses=detail.responses||[],now=options.now??Date.now();
 const identity=frozenIdentity(detail),evidence={identity};
 const decision=(allowed,reasonCode,humanReason)=>({allowed,reasonCode,humanReason,evidence});
 const block=(code,text)=>decision(false,code,text);
 try{assertCanonicalDocumentIdentity(d);}catch{return block('IDENTITY_INVALID','La identidad fiscal canónica no es consistente.');}
 if(['AUTORIZADO','ANULADO','RECIBIDO_SRI','NO_AUTORIZADO','DEVUELTO'].includes(d.status)||(detail.authorizations||[]).length)
  return block('FISCAL_RESPONSE_PREVENTS_RESEND','El estado o respuesta fiscal requiere consulta o gestión; no permite reenviar.');
 if(!['PENDIENTE_REINTENTO','ERROR_ENVIO','ENVIADO_SRI'].includes(d.status))return block('STATUS_NOT_ELIGIBLE','El estado actual no admite este reintento manual.');
 if(detail.management?.correction_in_progress)return block('CORRECTION_PENDING','Existe una corrección en curso.');
 if(detail.management?.automatic_paused)return block('MANUAL_REVIEW_REQUIRED','Los reintentos están pausados para revisión manual.');
 if(detail.cancellation&& !['NONE',undefined,null].includes(detail.cancellation.state))return block('CANCELLATION_ACTIVE','Existe una gestión de anulación; el reenvío está bloqueado.');
 const owned=options.ownedAuthorization;
 if(jobs.some(j=>j.status==='PROCESSING'&&!(owned&&j.id===owned.id&&j.worker_id===owned.worker_id))||attempts.some(a=>a.status==='STARTED'&&a.id!==owned?.claim_attempt?.id))return block('ACTIVE_CLAIM','Otro proceso está trabajando este comprobante.');
 if(jobs.some(j=>Date.parse(j.next_attempt_at)>now))return block('WAIT_SCHEDULED','Todavía no vence la espera programada.');
 const authJob=jobs.find(j=>j.transmission_type==='AUTHORIZATION_QUERY');
 if(!owned&&authJob&&Date.parse(authJob.finished_at)+30000>now)return block('WAIT_SCHEDULED','Espere hasta la próxima consulta programada.');
 for(const collection of [jobs,attempts,responses,detail.files||[],detail.errors||[],detail.audit||[]])for(const row of collection){
  if(row.company_id!==d.company_id||row.document_id!==d.id)return block('RELATED_IDENTITY_MISMATCH','Existe evidencia de otra empresa o comprobante.');
 }
 const messages=[...(detail.errors||[]),...responses.flatMap(r=>r.payload?.messages||[])];
 if(messages.some(m=>blockingCodes.has(String(m.identifier||'').trim())))return block('PROCESSING_OR_REGISTERED','El SRI informó procesamiento o clave/secuencial registrado. Solo corresponde consultar autorización.');
 if(responses.some(r=>r.response_type==='RECEPTION')||jobs.some(j=>j.transmission_type==='RECEPTION'&&['COMPLETED','RECEIVED'].includes(j.status)))return block('RECEPTION_RESPONSE_EXISTS','Existe una respuesta de recepción; debe resolverse por su contrato oficial antes de reenviar.');
 const signed=(detail.files||[]).find(f=>f.id===identity.signedFileId);
 if(!signed||!/^[a-f0-9]{64}$/.test(signed.content_sha256)||signed.storage_bucket!=='sri-private'||signed.storage_object_path!==`companies/${d.company_id}/documents/${d.id}/signed_xml-${signed.content_sha256}.xml`)return block('SIGNED_XML_REQUIRED','Falta el XML firmado archivado con su identidad y hash canónicos.');
 const reception=jobs.find(j=>j.transmission_type==='RECEPTION');
 const sent=latest(attempts.filter(a=>a.transmission_id===reception?.id));
 if(!reception||!sent||reception.environment!==d.environment||reception.endpoint_url!==endpointFor(d.environment,'RECEPTION')||sent.endpoint_url!==reception.endpoint_url||reception.request_file_id!==signed.id||sent.request_sha256!==signed.content_sha256||!sent.finished_at)return block('RECEPTION_EVIDENCE_MISSING','No se puede demostrar que el intento anterior utilizó exactamente este XML firmado.');
 evidence.receptionAttemptId=sent.id;
 const diagnostic=(detail.audit||[]).find(a=>a.action==='TRANSPORT_DIAGNOSTIC'&&a.new_values?.phase==='RECEPTION'&&a.new_values?.attemptId===sent.id&&a.new_values?.transmissionId===reception.id)?.new_values?.transport;
 // Narrow demonstrated case: SRI SOAP Server could not open its persistence connection.
 // Neither a generic HTTP 500 nor elapsed time nor NOT_FOUND alone permits reception.
 if(sent.http_status!==500||diagnostic?.httpStatus!==500||diagnostic.environment!==d.environment||diagnostic.response?.faultCode!=='soap:Server'||!['javax.persistence.PersistenceException: org.hibernate.exception.GenericJDBCException: Could not open connection','JBAS014559: Invocation cannot proceed as component is shutting down'].includes(diagnostic.response?.faultString))
  return block('INSUFFICIENT_RECEPTION_EVIDENCE','Falta evidencia de fallo de recepción anterior al procesamiento. Un timeout, HTTP 500 genérico o NO_ENCONTRADO no autoriza el reenvío.');
 evidence.receptionFailure=diagnostic.response;
 if(!authJob||authJob.environment!==d.environment||authJob.endpoint_url!==endpointFor(d.environment,'AUTHORIZATION_QUERY'))return block('AUTHORIZATION_LOOKUP_REQUIRED','Primero debe consultarse autorización con la misma clave y ambiente.');
 const absentResponses=responses.filter(r=>r.transmission_id===authJob.id&&r.response_type==='AUTHORIZATION'&&r.raw_xml&&sha256(r.raw_xml)===r.content_sha256&&definitiveAuthorizationAbsent(d,r.payload||{}));
 if(responses.some(r=>r.response_type==='AUTHORIZATION'&&!absentResponses.includes(r)))return block('AUTHORIZATION_NOT_ABSENT','La respuesta de autorización no demuestra ausencia; corresponde consultar o recuperar.');
 const absentHashes=new Set(absentResponses.map(r=>r.content_sha256));
 const lookups=attempts.filter(a=>a.transmission_id===authJob.id&&a.endpoint_url===authJob.endpoint_url&&a.request_sha256===sha256(d.access_key)&&a.http_status===200&&a.finished_at&&timestamp(a)>timestamp(sent)&&absentHashes.has(a.response_sha256));
 evidence.authorizationLookupAttemptIds=lookups.map(a=>a.id);
 if(lookups.length<2)return block('AUTHORIZATION_EVIDENCE_INCOMPLETE','Se requieren respuestas oficiales de ausencia en consultas distintas posteriores al último envío, con clave y hash verificables.');
 const last=latest(attempts.filter(a=>a.transmission_id===authJob.id&&a.id!==owned?.claim_attempt?.id));
 if(!last||!lookups.some(a=>a.id===last.id))return block('LATEST_LOOKUP_INCONCLUSIVE','La última consulta no confirmó ausencia. Consulte autorización nuevamente.');
 if(options.finalLookup&&!definitiveAuthorizationAbsent(d,options.finalLookup))return block('FINAL_LOOKUP_NOT_ABSENT','La consulta final no confirmó ausencia. No se reenviará.');
 if(options.requireValidation&&!(options.validation?.validation==='PASS'&&options.validation.signed&&options.validation.xmlAvailable&&options.validation.xmlSha256===signed.content_sha256))return block('VALIDATION_REQUIRED','Debe pasar la validación canónica del mismo XML firmado antes del reintento.');
 return decision(true,'MANUAL_SAME_DOCUMENT_RETRY_AVAILABLE','El SRI informó un fallo de infraestructura que impidió completar la recepción y las consultas oficiales posteriores confirman ausencia. Se permite un único reintento humano del mismo XML, sujeto a validación y consulta final.');
}
module.exports={evaluateManualSameDocumentRetry,frozenIdentity};
