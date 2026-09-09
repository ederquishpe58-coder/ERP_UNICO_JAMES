const {SriValidationError}=require('./errors.cjs');
const {getDocumentDetail,documentPayload,activeCertificateMetadata,assertWithholdingEligibility,dbError,uuidOrNull}=require('./document-service.cjs');
const {canonicalCertificateCompany,resolveCertificatePassword,parsePkcs12,releaseCertificateMaterial}=require('./certificate.cjs');
const {assertEnvironmentEnabled}=require('./environment.cjs');
const {assertCanonicalDocumentIdentity,assertDocumentXmlIdentity}=require('./xml-identity.cjs');
const {buildDocumentXml}=require('./xml-builders.cjs');
const {assertOfficialXsd}=require('./xsd-validator.cjs');
const {signXadesBes,verifyXadesBes}=require('./xades-signer.cjs');
const {stageArtifact}=require('./artifact-store.cjs');

function correctedDocument(document,fields){
 if(!fields||Array.isArray(fields)||typeof fields!=='object'||!Object.keys(fields).length||Object.keys(fields).some(k=>!['buyerAddress','notes'].includes(k)))throw new SriValidationError('Solo se permite corregir dirección y observaciones.');
 for(const [k,v]of Object.entries(fields))if(typeof v!=='string'||v.length>300||!v.trim()||/[\u0000-\u001f]/.test(v))throw new SriValidationError('Campo de corrección inválido: '+k);
 const next=structuredClone(document);
 if(Object.hasOwn(fields,'buyerAddress')){next.buyer_snapshot={...next.buyer_snapshot,address:fields.buyerAddress};next.source_snapshot={...next.source_snapshot,buyer:{...next.source_snapshot?.buyer,address:fields.buyerAddress}};}
 if(Object.hasOwn(fields,'notes'))next.source_snapshot={...next.source_snapshot,additionalInformation:{...next.source_snapshot?.additionalInformation,Observaciones:fields.notes}};
 return next;
}

async function correct(client,companyId,documentId,actorUserId,input){
 if(!uuidOrNull(input.operationId)||!Number.isInteger(input.version)||String(input.reason||'').trim().length<3||String(input.reason).length>500)throw new SriValidationError('Versión, motivo e identificador de corrección requeridos.');
 // The RPC also rechecks this permission, document identity and timestamp at commit.
 dbError(await client.rpc('sri_assert_service_actor_capability',{p_company_id:companyId,p_actor_user_id:actorUserId,p_capability:'commercial.electronic_documents.correct'}),'Permiso de corrección');
 const previous=dbError(await client.from('erp_sri_document_manager_events').select('*').eq('operation_id',input.operationId).maybeSingle(),'Operación de corrección');
 if(previous){
  const fieldsEqual=Object.keys({...previous.evidence?.fields,...input.fields}).every(k=>previous.evidence?.fields?.[k]===input.fields?.[k]);
  if(previous.company_id!==companyId||previous.document_id!==documentId||previous.actor_user_id!==actorUserId||previous.action!=='CORRECT'||!fieldsEqual||previous.reason!==input.reason||previous.evidence?.expectedVersion!==input.version||Date.parse(previous.evidence?.expectedUpdatedAt)!==Date.parse(input.documentUpdatedAt))throw new SriValidationError('Identificador de operación usado por otra solicitud.');
  return {reused:true};
 }
 const detail=await getDocumentDetail(client,companyId,documentId),d=detail.document;
 if(d.updated_at!==input.documentUpdatedAt||!['BORRADOR','VALIDADO','XML_GENERADO','FIRMADO'].includes(d.status)||detail.transmissions.length||detail.transmissionAttempts.length||detail.responses.length||detail.authorizations.length)throw new SriValidationError('Solo se corrige la versión vigente de un comprobante nunca transmitido.');
 if(d.document_type==='07'&&Object.hasOwn(input.fields||{},'buyerAddress'))throw new SriValidationError('La dirección no es un campo corregible de Retención 07.');
 const next=correctedDocument(d,input.fields);
 if(JSON.stringify(next)===JSON.stringify(d))throw new SriValidationError('No existen cambios de campos fuente.');
 const settings=dbError(await client.from('sri_settings').select('*').eq('company_id',companyId).single(),'Configuración SRI');
 assertEnvironmentEnabled(settings,d.environment,companyId);
 assertWithholdingEligibility(settings,d.document_type);
 const company=await canonicalCertificateCompany(client,companyId);
 if(settings.ruc!==company.tax_id)throw new SriValidationError('RUC de configuración inconsistente.');
 assertCanonicalDocumentIdentity(next,{expectedRuc:company.tax_id});
 const payload=await documentPayload(client,next),xml=buildDocumentXml(d.document_type,payload);
 assertDocumentXmlIdentity(next,xml,{expectedRuc:company.tax_id});
 const report=await assertOfficialXsd({documentType:d.document_type,version:d.xml_version,xml});
 const row=await activeCertificateMetadata(client,companyId,settings,company.tax_id);
 const blob=dbError(await client.storage.from(row.storage_bucket).download(row.storage_object_path),'Certificado de firma');
 let bytes,certificate;
 try{
  bytes=Buffer.from(await blob.arrayBuffer());
  certificate=parsePkcs12(bytes,resolveCertificatePassword(row.password_secret_name),{companyId,expectedRuc:company.tax_id,expirationWarningDays:30});
  if(certificate.metadata.fingerprintSha256.toLowerCase()!==row.fingerprint_sha256)throw new SriValidationError('Certificado fuera de su huella canónica.');
  const signedXml=await signXadesBes({xml,certificate});
  assertDocumentXmlIdentity(next,signedXml,{expectedRuc:company.tax_id});
  await assertOfficialXsd({documentType:d.document_type,version:d.xml_version,xml:signedXml});
  if(!await verifyXadesBes(signedXml))throw new SriValidationError('Firma de la nueva versión inválida.');
  // Immutable uploads are staged privately. They cannot become current XML until
  // the single atomic RPC commits the source change, version and all file rows.
  const artifacts=[];
  for(const[fileType,content]of[['SOURCE_JSON',JSON.stringify(payload)],['UNSIGNED_XML',xml],['XSD_REPORT',JSON.stringify(report)],['SIGNED_XML',signedXml]])artifacts.push(await stageArtifact(client,{companyId,documentId,fileType,content,schemaVersion:d.xml_version,createdBy:actorUserId}));
  const ack=dbError(await client.rpc('erp_sri_manager_commit_correction',{p_company_id:companyId,p_document_id:documentId,p_actor_user_id:actorUserId,p_operation_id:input.operationId,p_expected_version:input.version,p_expected_updated_at:input.documentUpdatedAt,p_reason:input.reason,p_fields:input.fields,p_certificate_id:row.id,p_artifacts:artifacts}),'Confirmación atómica de corrección');
  if(!ack?.ok||(!ack.reused&&(!ack.document||['id','company_id','environment','document_type','sequential','access_key','issue_date'].some(k=>ack.document[k]!==d[k])||ack.document.status!=='FIRMADO')))throw new SriValidationError('ACK de corrección inconsistente. Relea el documento antes de continuar.');
  return ack;
 }finally{bytes?.fill(0);releaseCertificateMaterial(certificate);}
}
module.exports={correct,correctedDocument};
