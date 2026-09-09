const assert=require('node:assert/strict');
const {fixture:legacyTransportFixture}=require('./validate-sri-manual-authorization-recovery.cjs');
const transportFixture=(env='PRODUCTION',type='07')=>legacyTransportFixture(env,type,true);
const {fixture,payloadFor,COMPANIES,syntheticCertificate}=require('./validate-sri-dual-documents.cjs');
const {managerPolicy,CAPS}=require('./api/sri/_lib/manager-policy.cjs');
const {validateDocument,unsignedCanonical,validateAmounts}=require('./api/sri/_lib/manager-validation.cjs');
const {correctedDocument}=require('./api/sri/_lib/manager-correction.cjs');
const {parseOfficialEvidence}=require('./api/sri/_lib/manager-evidence.cjs');
const {buildDocumentXml}=require('./api/sri/_lib/xml-builders.cjs');
const {assertDocumentXmlIdentity}=require('./api/sri/_lib/xml-identity.cjs');
const {signXadesBes,verifyXadesBes}=require('./api/sri/_lib/xades-signer.cjs');
const {releaseCertificateMaterial}=require('./api/sri/_lib/certificate.cjs');
const {sha256}=require('./api/sri/_lib/artifact-store.cjs');
const {endpointFor}=require('./api/sri/_lib/environment.cjs');
const results=[];const rights=Object.values(CAPS);
const response=body=>({ok:true,status:200,text:async()=>body});
const absent='<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><autorizacionComprobanteResponse><RespuestaAutorizacionComprobante><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante></autorizacionComprobanteResponse></soap:Body></soap:Envelope>';
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:e.stack});}}
const recover=(b,fetchImpl)=>b.service.processAuthorization(b.client,b.tables.sri_settings[0],b.document,'actor',{managerRecovery:true,recoveryQuery:true,manualDateRecovery:false,force:false,fetchImpl});
async function main(){
 for(const env of ['TEST','PRODUCTION'])for(const type of ['01','04','07']){
  await test(type+' '+env+' manager recovers official authorization after 12/12, no resend or identity change',async()=>{
   const b=transportFixture(env,type),before=structuredClone(b.document);let calls=0;
   await recover(b,async url=>{calls++;assert.equal(url,endpointFor(env,'AUTHORIZATION_QUERY'));return response(b.authResponse());});
   assert.equal(calls,1);assert.equal(b.document.status,'AUTORIZADO');assert.equal(b.queryJob.attempt_number,12);
   for(const k of ['id','company_id','environment','access_key','sequential','issue_date'])assert.equal(b.document[k],before[k]);
   assert.equal(b.calls.filter(c=>c.rpc==='claim_sri_transmission').length,0);
  });
 }
 await test('Uncertain result stays lookup-first; persistent NO_ENCONTRADO never enables resend',async()=>{
  const b=transportFixture();await assert.rejects(()=>recover(b,async url=>{assert.equal(url,endpointFor('PRODUCTION','AUTHORIZATION_QUERY'));return response(absent);}));
  const p=managerPolicy(b.detail(),rights);assert.equal(p.actions.retry.allowed,false);assert.equal(b.queryJob.attempt_number,12);assert.equal(p.automaticBudgetExhausted,true);
 });
 await test('PROCESSING / 70 never opens reception retry',async()=>{
  const b=transportFixture();const processing=absent.replace('<autorizaciones/>','<autorizaciones><autorizacion><estado>EN PROCESO</estado><mensajes><mensaje><identificador>70</identificador><mensaje>CLAVE EN PROCESAMIENTO</mensaje></mensaje></mensajes></autorizacion></autorizaciones>');
  let calls=0;await assert.rejects(()=>recover(b,async url=>{calls++;assert.equal(url,endpointFor('PRODUCTION','AUTHORIZATION_QUERY'));return response(processing);}));assert.equal(calls,1);assert.equal(managerPolicy(b.detail(),rights).actions.retry.allowed,false);
 });
 await test('Wait active blocks manager UI; expiry re-enables only authorization evaluation',()=>{
  const b=transportFixture(),d=b.detail(),now=Date.now();d.transmissions.find(j=>j.transmission_type==='AUTHORIZATION_QUERY').next_attempt_at=new Date(now+60000).toISOString();
  const p=managerPolicy(d,rights,now);assert.equal(p.actions.recover.allowed,false);assert.equal(p.retryState,'WAIT_SCHEDULED');assert.equal(managerPolicy(d,rights,now+61000).actions.recover.allowed,true);
 });
 await test('Pause does not change fiscal status and manual recovery remains eligible',()=>{
  const b=transportFixture(),d=b.detail();d.management={automatic_paused:true};const before=JSON.stringify(d.document);const p=managerPolicy(d,rights);assert.equal(p.actions.recover.allowed,true);assert.equal(p.actions.retry.allowed,false);assert.equal(p.automaticPaused,true);assert.equal(JSON.stringify(d.document),before);
 });
 await test('20 manager recoveries: one active query and no reception',async()=>{
  const b=transportFixture();let active=0,max=0,count=0;
  const concurrent=await Promise.allSettled(Array.from({length:20},()=>recover(b,async()=>{count++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,20));active--;return response(b.authResponse());})));
  assert.equal(max,1);assert.equal(count,1);assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
 });
 await test('A stale audited manual claim is reclaimed without reception',async()=>{
  const b=transportFixture();await b.seedStale();let count=0;await recover(b,async()=>{count++;return response(b.authResponse());});assert.equal(count,1);assert.equal(b.document.status,'AUTORIZADO');
 });
 await test('A claimed document does not block another document or environment',async()=>{
  const first=transportFixture(),second=transportFixture('TEST','01');await first.seedStale();await second.client.rpc('claim_sri_manual_authorization',{p_transmission_id:second.queryJob.id,p_company_id:second.document.company_id,p_document_id:second.document.id,p_worker_id:'manual-auth-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_actor_user_id:'actor'});
  await recover(first,async()=>response(first.authResponse()));assert.equal(first.document.status,'AUTORIZADO');assert.equal(second.queryJob.status,'PROCESSING');
 });
 await test('No capability means no manager action; OWNER label is not authority',()=>{
  const p=managerPolicy({...transportFixture().detail(),role:'OWNER'},[]);assert.ok(Object.values(p.actions).every(a=>a.allowed===false));
 });
 await test('Transmitted or authorized documents never expose source correction',()=>{
  const d=transportFixture().detail();assert.equal(managerPolicy(d,rights).actions.correct.allowed,false);d.document.status='AUTORIZADO';assert.equal(managerPolicy(d,rights).actions.correct.allowed,false);assert.equal(managerPolicy(d,rights).actions.recover.allowed,false);
 });
 for(const company of COMPANIES)for(const type of ['01','04','07']){
  if(company===COMPANIES[1]&&type==='07')continue;
  for(const environment of ['TEST','PRODUCTION'])await test(company.name+' '+type+' '+environment+' readonly validation uses actual XML/XSD',async()=>{
   const f=fixture(company,environment,type),payload=await payloadFor(f),before=JSON.stringify(f.document);
   const result=await validateDocument(null,{document:f.document,files:[]},{company:async()=>f.company,payload:async()=>payload});
   assert.equal(result.validation,'PASS',JSON.stringify(result.errors));assert.equal(result.writes,0);assert.equal(result.transmissions,0);assert.equal(JSON.stringify(f.document),before);
  });
 }
 await test('Invalid XML is reported with a diagnostic, no mutation',async()=>{
  const f=fixture(),payload=await payloadFor(f),buffer=Buffer.from('<factura>');const r=await validateDocument(null,{document:f.document,files:[{file_type:'UNSIGNED_XML'}]},{company:async()=>f.company,payload:async()=>payload,load:async()=>({buffer,file:{company_id:f.company.id,document_id:f.document.id,content_sha256:sha256(buffer)}})});
  assert.equal(r.validation,'FAIL');assert.ok(r.errors.some(e=>e.check==='Integridad del XML archivado'));
 });
 await test('Amounts cannot silently disagree with source totals or retention percentage',async()=>{
  const f=fixture(),p=await payloadFor(f);p.invoice.totalWithoutTax=200;assert.throws(()=>validateAmounts(f.document,p),/inconsistentes/);
  const r=fixture(COMPANIES[0],'TEST','07'),rp=await payloadFor(r);rp.withholding.supportingDocuments[0].retentions[0].value=999;assert.throws(()=>validateAmounts(r.document,rp));
 });
 const cert=syntheticCertificate();
 try{
  for(const type of ['01','04','07'])await test(type+' correction creates a new signed XML version with identity and DocSustento preserved',async()=>{
   const f=fixture(COMPANIES[0],'TEST',type),p=await payloadFor(f),old=buildDocumentXml(type,p),v1=await signXadesBes({xml:old,certificate:cert});
   const original=JSON.stringify(f.document);const next=correctedDocument(f.document,{notes:'Corrección permitida — versión 2'});f.document=next;
   const afterPayload=await payloadFor(f),v2=await signXadesBes({xml:buildDocumentXml(type,afterPayload),certificate:cert});
   assert.notEqual(sha256(v1),sha256(v2));assert.ok(await verifyXadesBes(v1));assert.ok(await verifyXadesBes(v2));assertDocumentXmlIdentity(next,v2);
   assert.equal(JSON.parse(original).access_key,next.access_key);assert.equal(JSON.parse(original).issue_date,next.issue_date);assert.equal(JSON.parse(original).sequential,next.sequential);
   assert.deepEqual(afterPayload.withholding?.supportingDocuments,p.withholding?.supportingDocuments);assert.notEqual(unsignedCanonical(v1),unsignedCanonical(v2));
   assert.throws(()=>correctedDocument(next,{access_key:'0'.repeat(49)}));assert.throws(()=>correctedDocument(next,{xml:v2}));
  });
  await test('Editing signed XML invalidates signature; read-only validator flags it',async()=>{
   const f=fixture(),p=await payloadFor(f),xml=await signXadesBes({xml:buildDocumentXml('01',p),certificate:cert}),tampered=xml.replace('CLIENTE SINTETICO','OTRO CLIENTE');await assert.rejects(()=>verifyXadesBes(tampered));
   const buffer=Buffer.from(tampered),r=await validateDocument(null,{document:f.document,files:[{file_type:'SIGNED_XML'}]},{company:async()=>f.company,payload:async()=>p,load:async()=>({buffer,file:{company_id:f.company.id,document_id:f.document.id,content_sha256:sha256(buffer)}}),certificate:async()=>({company_id:f.company.id,subject_ruc:f.company.tax_id,fingerprint_sha256:cert.metadata.fingerprintSha256.toLowerCase()})});
   assert.equal(r.validation,'FAIL');assert.ok(r.checks.some(c=>c.name==='Firma XAdES'&&c.result==='FAIL'));
  });
  await test('Official XML evidence supports standalone authorization and blocks identity mismatch',async()=>{
   const f=fixture(),p=await payloadFor(f),signed=await signXadesBes({xml:buildDocumentXml('01',p),certificate:cert});
   const raw=`<autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${f.document.access_key}</numeroAutorizacion><fechaAutorizacion>${new Date().toISOString()}</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante><![CDATA[${signed}]]></comprobante></autorizacion>`;
   const parsed=parseOfficialEvidence(raw,f.document.access_key);assert.equal(parsed.authorized,true);assert.equal(parsed.authorizedXml,signed);
   const transport=require('./api/sri/_lib/transmission-service.cjs');transport.validateAuthorizationIdentity(f.document,parsed);
   assert.throws(()=>transport.validateAuthorizationIdentity({...f.document,company_id:COMPANIES[1].id,issuer_snapshot:{ruc:COMPANIES[1].ruc}},parsed));
   assert.throws(()=>parseOfficialEvidence('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><autorizacion/>',f.document.access_key));
  });
 }finally{releaseCertificateMaterial(cert);}
 await test('Current XML follows committed revision even when it reuses an older immutable hash',async()=>{
  const {loadArtifact}=require('./api/sri/_lib/artifact-store.cjs');
  const rows=[{document_id:'d',file_type:'SIGNED_XML',content_sha256:'older-reused',created_at:'2026-09-01',storage_bucket:'sri-private',storage_object_path:'old'},
   {document_id:'d',file_type:'SIGNED_XML',content_sha256:'later-but-superseded',created_at:'2026-09-02',storage_bucket:'sri-private',storage_object_path:'later'}];
  let revised=true;const downloads=[];
  const client={from:table=>{
   const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},order:()=>q,limit:()=>q,
    maybeSingle:async()=>({data:table==='erp_sri_document_manager_events'?(revised?{evidence:{newArtifacts:[rows[0]]}}:null):rows.filter(r=>filters.every(([k,v])=>r[k]===v)).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0],error:null})};return q;
  },storage:{from:()=>({download:async path=>{downloads.push(path);return {data:{arrayBuffer:async()=>Buffer.from(path)}};}})}};
  assert.equal((await loadArtifact(client,'d','SIGNED_XML')).file.content_sha256,'older-reused');
  revised=false;assert.equal((await loadArtifact(client,'d','SIGNED_XML')).file.content_sha256,'later-but-superseded');
  assert.deepEqual(downloads,['old','later']);
 });
 console.log(JSON.stringify({passed:results.filter(x=>x.result==='PASS').length,total:results.length,results,realSriCalls:0,realDocuments:0,realSequencesConsumed:0},null,2));
 process.exitCode=results.some(x=>x.result==='FAIL')?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
