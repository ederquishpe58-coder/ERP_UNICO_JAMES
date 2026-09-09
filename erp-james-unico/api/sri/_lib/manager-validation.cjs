const { DOMParser }=require('@xmldom/xmldom');
const { X509Certificate }=require('node:crypto');
const { assertDocumentXmlIdentity,assertCanonicalDocumentIdentity }=require('./xml-identity.cjs');
const { validateAgainstOfficialXsd }=require('./xsd-validator.cjs');
const { verifyXadesBes }=require('./xades-signer.cjs');
const { buildDocumentXml }=require('./xml-builders.cjs');
const { documentPayload,dbError }=require('./document-service.cjs');
const { loadArtifact,sha256 }=require('./artifact-store.cjs');
const { canonicalCertificateCompany }=require('./certificate.cjs');
const { safeText }=require('./transport-diagnostic.cjs');
function validateAmounts(d,payload){
 const value=(n,label)=>{if(n===null||n===undefined||!Number.isFinite(Number(n))||Number(n)<0)throw Error(label+': importe inválido.');return Number(n);};
 const equal=(a,b,label)=>{if(Math.abs(value(a,label)-value(b,label))>0.010001)throw Error(label+': valores inconsistentes.');};
 if(d.document_type==='07'){
  for(const support of payload.withholding?.supportingDocuments||[])for(const retention of support.retentions||[]){
   const base=value(retention.taxableBase,'Base de retención'),rate=value(retention.rate,'Porcentaje de retención');
   equal(retention.value??retention.retainedValue,Math.round(base*rate)/100,'Valor retenido');
  }
  return;
 }
 for(const [i,line]of(payload.lines||[]).entries()){
  equal(line.subtotal,value(line.quantity,'Cantidad')*value(line.unitPrice,'Precio')-value(line.discount??0,'Descuento'),'Subtotal línea '+(i+1));
 }
 const subtotal=(payload.lines||[]).reduce((s,l)=>s+value(l.subtotal,'Subtotal'),0),taxes=(payload.taxes||[]).reduce((s,t)=>s+value(t.value,'Impuesto'),0);
 const section=d.document_type==='01'?payload.invoice:payload.creditNote;
 if(section?.totalWithoutTax!==undefined)equal(section.totalWithoutTax,subtotal,'Base total XML');
 if(d.subtotal!==undefined)equal(d.subtotal,subtotal,'Base total persistida');
 if(d.tax_total!==undefined)equal(d.tax_total,taxes,'Impuesto total persistido');
 const total=d.document_type==='01'?section?.grandTotal:section?.modificationValue;
 if(total!==undefined)equal(d.grand_total,total,'Total persistido / XML');
 // Compare arithmetic only where the canonical payload contains no additional
 // invoice components. Export freight/insurance/tip keep their own contract.
 if(d.document_type==='04')equal(total??d.grand_total,subtotal+taxes,'Valor de modificación');
}
function unsignedCanonical(xml){const dom=new DOMParser().parseFromString(xml,'application/xml');for(const sig of [...dom.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#','Signature')])sig.parentNode.removeChild(sig);const visit=n=>n.nodeType===1?[n.nodeName,[...n.attributes].map(a=>[a.name,a.value]).filter(a=>!a[0].startsWith('xmlns')).sort(),[...n.childNodes].filter(c=>c.nodeType===1||c.nodeType===3&&c.nodeValue.trim()).map(visit)]:n.nodeValue.trim();return JSON.stringify(visit(dom.documentElement));}
async function validateDocument(client,detail,deps={}){
 const d=detail.document,errors=[],warnings=[],checks=[];
 const check=async(name,fn)=>{try{await fn();checks.push({name,result:'PASS'});}catch(e){checks.push({name,result:'FAIL'});errors.push({check:name,code:e.code||'VALIDATION_FAILED',message:safeText(e.message)});}};
 let payload,xml,artifact,company;
 await check('Identidad canónica',async()=>{company=await(deps.company||canonicalCertificateCompany)(client,d.company_id);assertCanonicalDocumentIdentity(d,{expectedRuc:company.tax_id});});
 await check('Campos fuente, bases, impuestos, totales y sustento',async()=>{payload=await(deps.payload||documentPayload)(client,d);xml=buildDocumentXml(d.document_type,payload);assertDocumentXmlIdentity(d,xml);});
 if(payload)await check('Consistencia de importes',async()=>validateAmounts(d,payload));
 const signed=(detail.files||[]).some(f=>f.file_type==='SIGNED_XML');
 if(signed||(detail.files||[]).some(f=>f.file_type==='UNSIGNED_XML'))await check('Integridad del XML archivado',async()=>{artifact=await(deps.load||loadArtifact)(client,d.id,signed?'SIGNED_XML':'UNSIGNED_XML');if(artifact.file.company_id!==d.company_id||artifact.file.document_id!==d.id||sha256(artifact.buffer)!==artifact.file.content_sha256)throw Error('El archivo no coincide con el documento y su hash.');const stored=artifact.buffer.toString('utf8');assertDocumentXmlIdentity(d,stored);if(xml&&unsignedCanonical(xml)!==unsignedCanonical(stored))throw Error('El XML no coincide con los campos fuente canónicos.');xml=stored;});
 else warnings.push('No existe XML archivado; se valida una representación en memoria, sin guardarla.');
 if(xml)await check('XSD oficial',async()=>{const r=await(deps.xsd||validateAgainstOfficialXsd)({documentType:d.document_type,version:d.xml_version,xml});if(!r.valid)throw Error(r.errors.map(e=>e.message).join('; '));});
 if(signed&&xml){
  await check('Firma XAdES',async()=>{if(!await(deps.verify||verifyXadesBes)(xml))throw Error('Firma inválida: el XML firmado pudo ser alterado.');});
  await check('Certificado de la firma / empresa / RUC',async()=>{
   const dom=new DOMParser().parseFromString(xml,'application/xml');const certs=dom.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#','X509Certificate');if(certs.length!==1)throw Error('No existe un certificado único en la firma.');
   const x509=new X509Certificate(Buffer.from(certs[0].textContent.replace(/\s/g,''),'base64'));
   const row=await(deps.certificate|| (async()=>dbError(await client.from('digital_certificates').select('id,company_id,fingerprint_sha256,subject_ruc,valid_from,valid_until').eq('company_id',d.company_id).eq('id',d.certificate_id).single(),'Certificado firmado')))();
   if(row.company_id!==d.company_id||row.subject_ruc!==company?.tax_id||x509.fingerprint256.replace(/:/g,'').toLowerCase()!==String(row.fingerprint_sha256).toLowerCase())throw Error('El certificado de la firma no coincide con la empresa y RUC canónicos.');
   const signingTimes=dom.getElementsByTagNameNS('http://uri.etsi.org/01903/v1.3.2#','SigningTime');
   const signedAt=signingTimes.length===1?Date.parse(signingTimes[0].textContent):NaN;
   if(!Number.isFinite(signedAt)||signedAt<Date.parse(x509.validFrom)||signedAt>Date.parse(x509.validTo))throw Error('El certificado no era vigente en la fecha de firma declarada por XAdES.');
   if(Date.parse(x509.validTo)<Date.now())warnings.push('El certificado actualmente está vencido; se conserva la validación histórica de la firma.');
  });
 }else warnings.push('El documento aún no tiene firma: su firma XAdES no está validada.');
 return {validation:errors.length?'FAIL':'PASS',errors,warnings,checks,signed,xmlAvailable:Boolean(artifact),xmlSha256:xml?sha256(xml):null,transmissions:0,sequencesConsumed:0,writes:0};
}
module.exports={validateDocument,unsignedCanonical,validateAmounts};
