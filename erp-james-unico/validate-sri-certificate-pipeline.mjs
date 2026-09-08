import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url),root=path.dirname(fileURLToPath(import.meta.url));
const forge=require('node-forge');
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const companies={[B]:{id:B,tax_id:'1717637084001',is_active:true,legal_name:'BLESS ISOLATED',commercial_name:'BLESS'},[I]:{id:I,tax_id:'1727970137001',is_active:true,legal_name:'IMPERIO ISOLATED',commercial_name:'IMPERIO'}};
const OID='1.3.6.1.4.1.37746.3.11',password='SYNTHETIC_ONLY_NOT_A_REAL_SECRET';
const beforeEnv={...process.env},originalFetch=globalThis.fetch,originalError=console.error;
const logs=[],checks=[],trace=[];
let auth=true,capability=true,membership=true,allowWrites=false,xadesFailure=false,xsdFailure=false;
let dbWrites=0,storageWrites=0,storageReads=0,networkCalls=0,stored=null,storedBytes=null;
let document=null,unsignedXml='';
function unsignedArtifact(){
 const content_sha256=crypto.createHash('sha256').update(unsignedXml).digest('hex');
 return {id:'fixture-file',company_id:document.company_id,document_id:document.id,file_type:'UNSIGNED_XML',storage_bucket:'sri-private',
  content_sha256,storage_object_path:`companies/${document.company_id}/documents/${document.id}/unsigned_xml-${content_sha256}.xml`};
}
const signatureModule=require('./api/sri/_lib/xades-signer.cjs'),originalSign=signatureModule.signXadesBes;
const xsdModule=require('./api/sri/_lib/xsd-validator.cjs'),originalXsd=xsdModule.assertOfficialXsd;
signatureModule.signXadesBes=async options=>{if(xadesFailure)throw Error('PRIVATE_KEY_SENTINEL');return originalSign(options);};
xsdModule.assertOfficialXsd=async options=>{if(xsdFailure)throw Error('PRIVATE_XML_SENTINEL');return originalXsd(options);};
const originalParse=forge.pkcs12.pkcs12FromAsn1;
forge.pkcs12.pkcs12FromAsn1=(...args)=>{trace.push('VALIDATE_PKCS12');return originalParse(...args);};
const recordWrite=kind=>{trace.push(kind);if(kind==='DB_WRITE')dbWrites++;else storageWrites++;if(!allowWrites)throw Error('REMOTE_WRITE_FORBIDDEN_IN_ISOLATION');};
const client={
 auth:{async getUser(token){assert.equal(token,'fixture-erp-jwt');return {data:{user:auth?{id:'fixture-user'}:null},error:null};}},
 from(table){
  trace.push('READ:'+table);const where={};let changed=null;
  const rows=()=>{
   if(changed)return [changed];
   const c=companies[where.id||where.company_id]||companies[B];
   if(table==='companies')return [c];
   if(table==='sri_company_memberships')return membership?[{company_id:where.company_id,role_code:'ADMIN',active:true}]:[];
   if(table==='sri_settings')return [{company_id:c.id,ruc:c.tax_id,environment:'TEST',test_enabled:true,production_enabled:false}];
   if(table==='digital_certificates')return stored?[stored]:[];
   if(table==='electronic_documents')return document?[document]:[];
   if(table==='electronic_document_files')return unsignedXml?[unsignedArtifact()]:[];
   return [];
  };
  const q={select(){return q;},eq(k,v){where[k]=v;return q;},order(){return q;},limit(){return q;},
   insert(row){recordWrite('DB_WRITE');changed=row;return q;},upsert(row){recordWrite('DB_WRITE');changed={id:'fixture-created',...row};return q;},update(row){recordWrite('DB_WRITE');changed=row;return q;},delete(){recordWrite('DB_WRITE');return q;},
   async single(){return {data:rows()[0]||null,error:null};},async maybeSingle(){return {data:rows()[0]||null,error:null};},then(ok,bad){return Promise.resolve({data:rows(),error:null}).then(ok,bad);}};return q;
 },
 storage:{from(bucket){assert.equal(bucket,'sri-private');return {
  async upload(objectPath,bytes){recordWrite('STORAGE_WRITE');assert.ok(trace.lastIndexOf('VALIDATE_PKCS12')>=0);assert.ok(Buffer.isBuffer(bytes));assert.match(objectPath,/^companies\/[a-f0-9-]+\/certificates\/[a-f0-9]{64}\.p12$/);return {data:{path:objectPath},error:null};},
  async download(objectPath){storageReads++;const data=unsignedXml&&objectPath===unsignedArtifact().storage_object_path?Buffer.from(unsignedXml):storedBytes;assert.ok(data);return {data:new Blob([data]),error:null};}
 };}},
 async rpc(){recordWrite('DB_WRITE');throw Error('MUTABLE_RPC_NOT_ALLOWED');}
};
const supabasePath=require.resolve('@supabase/supabase-js'),priorSupabase=require.cache[supabasePath];
require.cache[supabasePath]={id:supabasePath,filename:supabasePath,loaded:true,exports:{createClient(url,key,options){
 assert.equal(url,'https://isolated.invalid');assert.equal(key,'isolated-server-key');
 if(options.global.headers.authorization)return {async rpc(name,args){assert.equal(name,'erp_security_assert_capability');assert.ok(['tax.parameters.manage','commercial.electronic_documents.authorize'].includes(args.p_capability_id));assert.ok(companies[args.p_company_id]);return {data:null,error:capability&&membership?null:{code:'42501'}};}};
 return client;
}}};
process.env.SUPABASE_URL='https://isolated.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-server-key';delete process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
process.env.SRI_P12_PASSWORD_BLESS=password;process.env.SRI_P12_PASSWORD_IMPERIO=password;
globalThis.fetch=async()=>{networkCalls++;throw Error('NETWORK_FORBIDDEN');};console.error=(...args)=>logs.push(args);
const handler=require('./api/sri.js');
const shared=require('./api/sri/_lib/certificate-validator.cjs');
const certificates=require('./api/sri/_lib/certificate.cjs');
const dry=require('./api/sri/_lib/certificate-dry-run.cjs');
const {signDocument}=require('./api/sri/_lib/document-service.cjs');
const {buildDocumentXml}=require('./api/sri/_lib/xml-builders.cjs');
const pair=forge.pki.rsa.generateKeyPair(2048);
function fixture(companyId=B,{ruc=companies[companyId].tax_id,issuer='SECURITY DATA S.A. 2',expired=false,missingOid=false,extra=[]}={}){
 const c=forge.pki.createCertificate();c.publicKey=pair.publicKey;c.serialNumber=crypto.randomBytes(8).toString('hex');c.validity.notBefore=new Date('2025-01-01');c.validity.notAfter=new Date(expired?'2025-02-01':'2031-01-01');
 c.setSubject([{name:'commonName',value:'ISOLATED CERTIFICATE'},{type:'2.5.4.5',value:companies[companyId].tax_id.slice(0,10)}]);
 c.setIssuer([{name:'organizationName',value:issuer},{name:'countryName',value:'EC'}]);
 const ext=(id,value)=>({id,value:forge.asn1.toDer(forge.asn1.create(0,12,false,value)).getBytes()});
 c.setExtensions([...(missingOid?[]:[ext(OID,ruc)]),ext('1.3.6.1.4.1.37746.3.1',companies[companyId].tax_id.slice(0,10)),ext('1.3.6.1.4.1.37746.3.8','0981357267'),...extra]);c.sign(pair.privateKey,forge.md.sha256.create());
 const bytes=Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(pair.privateKey,[c],password,{algorithm:'3des',count:2048})).getBytes(),'binary');
 return {bytes,fingerprint:crypto.createHash('sha256').update(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(),'binary')).digest('hex')};
}
async function invoke(action,body,options={}){
 const request={method:'POST',url:'/api/sri?action='+action,headers:options.noAuth?{}:{authorization:'Bearer fixture-erp-jwt'},body};
 const headers={};let result;const response={setHeader(k,v){headers[k]=v;},end(text){result=JSON.parse(text);}};
 await handler(request,response);assert.equal(headers['cache-control'],'no-store');
 if(action==='validate-xml-signature-dry-run'||action==='validate-certificate')assert.equal(request.body,undefined);
 const text=JSON.stringify(result);for(const value of [password,'PRIVATE_KEY_SENTINEL','PRIVATE_XML_SENTINEL','BEGIN PRIVATE KEY'])assert.ok(!text.includes(value));
 assert.ok(!text.includes('<Signature')&&!text.includes('privateKeyPkcs8')&&!text.includes('certificateBase64'));
 return {status:response.statusCode,...result};
}
const dryBody=(f,id=B,type='01',context='LOCAL')=>({company_id:id,certificate_file:f.bytes.toString('base64'),document_type:type,...(context==null?{}:{commercial_context:context})});
const uploadBody=(f,id=B)=>({companyId:id,certificate:{p12Base64:f.bytes.toString('base64'),passwordSecretName:id===B?'SRI_P12_PASSWORD_BLESS':'SRI_P12_PASSWORD_IMPERIO',alias:'ISOLATED'}});
const counts=()=>({dbWrites,storageWrites,networkCalls});
async function zeroTest(name,fn){const before=counts();await fn();assert.deepEqual(counts(),before);checks.push({name,result:'PASS',databaseDelta:0,storageDelta:0,sequenceDelta:0,documentDelta:0});}
try{
 const bless=fixture(),imperio=fixture(I),contradictory=fixture(B,{ruc:companies[I].tax_id}),unknown=fixture(B,{issuer:'UNSUPPORTED'}),expired=fixture(B,{expired:true}),missing=fixture(B,{missingOid:true});
 await zeroTest('Shared validator: both company matches and cross-company rejects',async()=>{
  for(const [f,id,expected] of [[bless,B,'PASS'],[imperio,I,'PASS'],[bless,I,'FAIL'],[imperio,B,'FAIL']]){
   const r=shared.validateSriPkcs12ForCompany(f.bytes,password,id,companies[id].tax_id);assert.equal(r.validation.ruc_match,expected);assert.equal(r.validation.valid,expected==='PASS');
   if(expected==='PASS'){const privateBytes=r.material.privateKeyPkcs8;shared.releaseCertificateMaterial(r.material);assert.ok(privateBytes.every(b=>b===0));}else assert.equal(r.material,null);
  }
 });
 await zeroTest('Cedula matches but authoritative .3.11 has other company RUC: every parser FAIL CLOSED',async()=>{
  const r=shared.validateInMemory(contradictory.bytes,password,B,companies[B].tax_id);assert.equal(r.ruc_match,'FAIL');assert.equal(r.valid,false);
  assert.throws(()=>certificates.parsePkcs12(contradictory.bytes,password,{companyId:B,expectedRuc:companies[B].tax_id}),/RUC/);
 });
 await zeroTest('Missing .3.11, .3.8 phone and unsupported issuer remain UNPROVEN',async()=>{
  for(const f of [unknown,missing]){assert.equal(shared.validateInMemory(f.bytes,password,B,companies[B].tax_id).ruc_match,'UNPROVEN');assert.throws(()=>certificates.parsePkcs12(f.bytes,password,{companyId:B,expectedRuc:companies[B].tax_id}));}
 });
 await zeroTest('Expired, wrong password and corrupt PKCS12 fail closed in shared validator',async()=>{
  for(const [bytes,pw] of [[expired.bytes,password],[bless.bytes,'WRONG'],[Buffer.from('corrupt'),password]]){const r=shared.validateSriPkcs12ForCompany(bytes,pw,B,companies[B].tax_id);assert.equal(r.validation.valid,false);assert.equal(r.material,null);}
 });
 for(const [label,f,id] of [['RUC_MISMATCH',contradictory,B],['BLESS_CROSS',bless,I],['IMPERIO_CROSS',imperio,B],['UNPROVEN',unknown,B],['EXPIRED',expired,B]]){
  await zeroTest('Actual upload rejects '+label+' before Storage/metadata/settings mutation',async()=>{const r=await invoke('upload-certificate',uploadBody(f,id));assert.equal(r.ok,false);assert.equal(r.status,422);});
 }
 await zeroTest('Actual upload rejects foreign secret or client RUC/password override',async()=>{
  let body=uploadBody(bless);body.certificate.passwordSecretName='SRI_P12_PASSWORD_IMPERIO';assert.equal((await invoke('upload-certificate',body)).ok,false);
  for(const key of ['password','ruc','private_key','storage_path']){body=uploadBody(bless);body.certificate[key]='FORBIDDEN';assert.equal((await invoke('upload-certificate',body)).ok,false);}
 });
 await zeroTest('Actual upload wrong runtime password and corrupt bytes: zero writes',async()=>{
  process.env.SRI_P12_PASSWORD_BLESS='WRONG';assert.equal((await invoke('upload-certificate',uploadBody(bless))).ok,false);process.env.SRI_P12_PASSWORD_BLESS=password;
  assert.equal((await invoke('upload-certificate',uploadBody({bytes:Buffer.from('corrupt')}))).ok,false);
 });
 {const before=counts();allowWrites=true;trace.length=0;const r=await invoke('upload-certificate',uploadBody(bless));allowWrites=false;
  assert.equal(r.ok,true);assert.equal(r.data.subject_ruc,companies[B].tax_id);assert.equal(r.data.password_secret_name,'SRI_P12_PASSWORD_BLESS');
  assert.ok(trace.indexOf('VALIDATE_PKCS12')<trace.indexOf('STORAGE_WRITE'));assert.equal(storageWrites-before.storageWrites,1);assert.equal(dbWrites-before.dbWrites,2);
  checks.push({name:'Actual valid upload proceeds only after shared validation; simulated client only',result:'PASS',simulatedStorageCalls:1,simulatedDbCalls:2,remoteWrites:0});}
 const payload=dry.dryRunFixture(companies[B],'01','LOCAL');unsignedXml=buildDocumentXml('01',payload);
 const fiscal=payload.document;
 // Persisted fixture identity must match its XML before certificate-specific guards run.
 document={id:crypto.randomUUID(),company_id:B,document_type:'01',status:'XML_GENERADO',environment:'TEST',
  access_key:fiscal.accessKey,issue_date:fiscal.issueDate,xml_version:fiscal.version,emission_point_id:crypto.randomUUID(),
  establishment_code:fiscal.establishmentCode,emission_point_code:fiscal.emissionPointCode,sequential:Number(fiscal.sequential),
  sequential_text:fiscal.sequential,numeric_code:fiscal.accessKey.slice(39,47),emission_type:fiscal.emissionType,
  issuer_snapshot:structuredClone(fiscal.issuer),buyer_snapshot:structuredClone(payload.buyer),source_snapshot:structuredClone(payload)};
 require('./api/sri/_lib/xml-identity.cjs').assertDocumentXmlIdentity(document,unsignedXml,{expectedRuc:companies[B].tax_id});
 const rowFor=(f,id=B)=>({id:crypto.randomUUID(),company_id:id,active:true,storage_bucket:'sri-private',storage_object_path:'companies/'+id+'/certificates/'+f.fingerprint+'.p12',fingerprint_sha256:f.fingerprint,password_secret_name:id===B?'SRI_P12_PASSWORD_BLESS':'SRI_P12_PASSWORD_IMPERIO',
  validation_status:'VALID',subject_ruc:companies[id].tax_id,valid_from:'2025-01-01T00:00:00.000Z',valid_until:'2031-01-01T00:00:00.000Z',last_validated_at:new Date().toISOString()});
 await zeroTest('Actual sign rejects stored certificate row from another company before document mutation',async()=>{stored=rowFor(imperio,I);storedBytes=imperio.bytes;await assert.rejects(signDocument(client,B,document.id,'fixture-user'),/empresa/);});
 await zeroTest('Actual sign rejects foreign Storage path/secret even when row company matches',async()=>{
  stored=rowFor(bless);stored.storage_object_path=stored.storage_object_path.replace(B,I);storedBytes=bless.bytes;await assert.rejects(signDocument(client,B,document.id,'fixture-user'));
  stored=rowFor(bless);stored.password_secret_name='SRI_P12_PASSWORD_IMPERIO';await assert.rejects(signDocument(client,B,document.id,'fixture-user'));
 });
 for(const [label,f] of [['OID_MISMATCH',contradictory],['CROSS_CERT',imperio],['EXPIRED',expired],['UNPROVEN',unknown]]){
  await zeroTest('Actual sign '+label+': no certificate/document/XML/status updates',async()=>{stored=rowFor(f);storedBytes=f.bytes;await assert.rejects(signDocument(client,B,document.id,'fixture-user'));});
 }
 await zeroTest('Actual sign wrong password/corrupt PKCS12 does not persist validation failure',async()=>{
  stored=rowFor(bless);storedBytes=bless.bytes;process.env.SRI_P12_PASSWORD_BLESS='WRONG';await assert.rejects(signDocument(client,B,document.id,'fixture-user'));process.env.SRI_P12_PASSWORD_BLESS=password;
  storedBytes=Buffer.from('corrupt');await assert.rejects(signDocument(client,B,document.id,'fixture-user'));
 });
 await zeroTest('Actual sign rejects stored fingerprint mismatch without mutations',async()=>{stored=rowFor(bless);stored.fingerprint_sha256='a'.repeat(64);stored.storage_object_path='companies/'+B+'/certificates/'+stored.fingerprint_sha256+'.p12';storedBytes=bless.bytes;await assert.rejects(signDocument(client,B,document.id,'fixture-user'),/huella/);});
 for(const [label,f,id,type,context] of [['BLESS LOCAL',bless,B,'01','LOCAL'],['BLESS EXPORT',bless,B,'01','EXPORT'],['BLESS RETENTION',bless,B,'07',null],['IMPERIO LOCAL',imperio,I,'01','LOCAL'],['IMPERIO EXPORT',imperio,I,'01','EXPORT']]){
  await zeroTest('Actual authenticated dry-run '+label+' XML + official XSD + XAdES PASS',async()=>{
   const beforeReads=storageReads;const r=await invoke('validate-xml-signature-dry-run',dryBody(f,id,type,context));assert.equal(r.status,200);assert.equal(r.data.valid,true,JSON.stringify(r.data));
   assert.equal(r.data.certificate_validation,'PASS');assert.equal(r.data.ruc_match,'PASS');assert.equal(r.data.xml_build,'PASS');assert.equal(r.data.xades_sign,'PASS');assert.equal(r.data.schema_validation,'PASS');assert.equal(r.data.environment,'TEST');assert.equal(r.data.environment_code,'1');assert.equal(r.data.writes,0);assert.equal(r.data.series,context==='LOCAL'?'001-003':'001-002');assert.equal(storageReads,beforeReads);
   const xml=buildDocumentXml(type,dry.dryRunFixture(companies[id],type,context));if(id===B)assert.match(xml,/<agenteRetencion>10<\/agenteRetencion>/);else assert.ok(!xml.includes('<agenteRetencion>'));
  });
 }
 for(const [label,f,id] of [['WRONG_CERT',bless,I],['OID_MISMATCH',contradictory,B],['EXPIRED',expired,B],['UNPROVEN',unknown,B],['CORRUPT',{bytes:Buffer.from('corrupt')},B]]){
  await zeroTest('Dry-run '+label+' fails closed with zero writes',async()=>{const r=await invoke('validate-xml-signature-dry-run',dryBody(f,id));assert.equal(r.data.valid,false);assert.equal(r.data.certificate_validation,'FAIL');assert.equal(r.data.xml_build,'NOT_EXECUTED');});
 }
 await zeroTest('Dry-run wrong password or missing secret: zero writes',async()=>{
  for(const pw of ['WRONG',undefined]){if(pw)process.env.SRI_P12_PASSWORD_BLESS=pw;else delete process.env.SRI_P12_PASSWORD_BLESS;const r=await invoke('validate-xml-signature-dry-run',dryBody(bless));assert.equal(r.data.valid,false);assert.equal(r.data.certificate_validation,'FAIL');}process.env.SRI_P12_PASSWORD_BLESS=password;
 });
 await zeroTest('Dry-run no auth/invalid auth=401, no capability/cross-company membership=403',async()=>{
  assert.equal((await invoke('validate-xml-signature-dry-run',dryBody(bless),{noAuth:true})).status,401);
  auth=false;assert.equal((await invoke('validate-xml-signature-dry-run',dryBody(bless))).status,401);auth=true;
  capability=false;assert.equal((await invoke('validate-xml-signature-dry-run',dryBody(bless))).status,403);capability=true;
  membership=false;assert.equal((await invoke('validate-xml-signature-dry-run',dryBody(bless))).status,403);membership=true;
 });
 await zeroTest('Dry-run rejects IMPERIO 07, context override, arbitrary fixtures/secrets/paths/environment',async()=>{
  for(const [id,type,context] of [[I,'07',null],[B,'04','LOCAL'],[B,'07','LOCAL'],[B,'01','UNKNOWN']])assert.equal((await invoke('validate-xml-signature-dry-run',dryBody(bless,id,type,context))).status,422);
  for(const key of ['fixture','xml','password','secret_value','private_key','secret_name','storage_path','environment','ruc']){const body=dryBody(bless);body[key]='FORBIDDEN';assert.equal((await invoke('validate-xml-signature-dry-run',body)).status,400);}
 });
 await zeroTest('Dry-run injected XAdES error is safe and leaves all deltas zero',async()=>{xadesFailure=true;const r=await invoke('validate-xml-signature-dry-run',dryBody(bless));xadesFailure=false;assert.equal(r.data.valid,false);assert.equal(r.data.xades_sign,'FAIL');assert.equal(r.data.failure_stage,'XADES');});
 await zeroTest('Dry-run injected XSD error is safe and leaves all deltas zero',async()=>{xsdFailure=true;const r=await invoke('validate-xml-signature-dry-run',dryBody(bless));xsdFailure=false;assert.equal(r.data.valid,false);assert.equal(r.data.schema_validation,'FAIL');assert.equal(r.data.xades_sign,'NOT_EXECUTED');});
 await zeroTest('Dry-run bad canonical XML fixture fails closed without schema/signature persistence',async()=>{const prior=companies[B].legal_name;companies[B].legal_name='';const r=await invoke('validate-xml-signature-dry-run',dryBody(bless));companies[B].legal_name=prior;assert.equal(r.data.valid,false);assert.equal(r.data.xml_build,'FAIL');});
 assert.equal(networkCalls,0);const logText=JSON.stringify(logs);for(const secret of [password,bless.bytes.toString('base64'),imperio.bytes.toString('base64'),'PRIVATE_KEY_SENTINEL','PRIVATE_XML_SENTINEL'])assert.ok(!logText.includes(secret));
 checks.push({name:'No outbound network, no secrets/XML/private material in results or logs',result:'PASS'});
 // Browser/client interaction with its real company guard and explicit dry-run action.
 let uiCompany=B,requestCount=0,click,dryClick,uiFail=false;
 const input={files:[{name:'fixture.p12',size:3,arrayBuffer:async()=>Uint8Array.from([1,2,3]).buffer}],value:'selected',disabled:false};
 const button={disabled:false,addEventListener(e,fn){click=fn;}},dryButton={disabled:false,addEventListener(e,fn){dryClick=fn;}};
 const select={value:'01:LOCAL',disabled:false,addEventListener(){}},output={textContent:''},diagnostic={hidden:true},text={value:''};
 const nodes={'[data-certificate-file]':input,'[data-certificate-validate]':button,'[data-certificate-dry-run]':dryButton,'[data-certificate-fixture]':select,'[data-certificate-result]':output,'[data-certificate-diagnostic]':diagnostic,'[data-certificate-diagnostic-text]':text};
 const panel={isConnected:true,querySelector:s=>nodes[s]};
 const erp={env:{sriEnabled:false,sriSupabaseEnabled:false},services:{companyContext:{activeCompanyId:()=>uiCompany}},authAccess:{activeAccess:()=>({companies:Object.values(companies)})},capabilityRuntime:{status:()=>({companyId:uiCompany,loaded:true}),can:()=>true},getSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-erp-jwt'}}})}})};
 const window={BlessERP:erp};const ctx={window,URLSearchParams,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(url,options)=>{requestCount++;assert.equal(url,'/api/sri?action=validate-xml-signature-dry-run');const body=JSON.parse(options.body);assert.equal(body.company_id,uiCompany);assert.equal(body.document_type,'01');assert.equal(body.commercial_context,'LOCAL');assert.deepEqual(Object.keys(body).sort(),['certificate_file','commercial_context','company_id','document_type']);return {ok:true,json:async()=>({ok:true,data:{company_id:uiCompany,valid:!uiFail,certificate_validation:'PASS',ruc_match:'PASS',xml_build:'PASS',xades_sign:uiFail?'FAIL':'PASS',schema_validation:uiFail?'NOT_EXECUTED':'PASS',environment:'TEST',writes:0}})};}};
 Object.assign(ctx, { AbortController, setTimeout, clearTimeout });
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'/scripts/services/sri/sri-api-client.js','utf8'),ctx);vm.runInContext(fs.readFileSync(root+'/scripts/services/sri/certificate-precheck-ui.js','utf8'),ctx);
 await zeroTest('UI dry-run available while SRI OFF, confirmed success only, file cleared',async()=>{assert.ok(erp.sriCertificatePrecheck.render().includes('Validar XML y firma'));erp.sriCertificatePrecheck.bind({querySelector:()=>panel});await dryClick();assert.match(output.textContent,/XML DRY RUN = PASS/);assert.match(output.textContent,/Escrituras: 0/);assert.equal(input.value,'');assert.equal(dryButton.disabled,false);uiFail=true;await dryClick();assert.match(output.textContent,/XML DRY RUN = FAIL/);uiFail=false;});
 await zeroTest('UI company switch discards stale dry-run and IMPERIO never offers 07',async()=>{uiCompany=I;assert.ok(!erp.sriCertificatePrecheck.render().includes('value="07"'));const before=requestCount;await dryClick();assert.equal(requestCount,before);assert.match(output.textContent,/empresa cambió/);await assert.rejects(erp.sriApi.validateXmlSignatureDryRun(I,input.files[0],'07'));});
 for(const f of [bless,imperio,contradictory,unknown,expired,missing])f.bytes.fill(0);
}finally{
 console.error=originalError;globalThis.fetch=originalFetch;signatureModule.signXadesBes=originalSign;xsdModule.assertOfficialXsd=originalXsd;forge.pkcs12.pkcs12FromAsn1=originalParse;
 for(const key of Object.keys(process.env))if(!(key in beforeEnv))delete process.env[key];Object.assign(process.env,beforeEnv);
 if(priorSupabase)require.cache[supabasePath]=priorSupabase;else delete require.cache[supabasePath];
}
const report={at:new Date().toISOString(),result:'PASS',checks,isolatedOnly:true,syntheticCertificatesOnly:true,realRuntimeSecretsRead:false,
 realDatabaseWrites:0,realStorageWrites:0,sriSequenceAllocations:0,sriDocumentsCreated:0,sriTransmissions:0,
 simulatedValidUpload:{storageCalls:storageWrites,databaseCalls:dbWrites},runtimeRealCertificates:'REQUIRES_HUMAN_DRY_RUN'};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:'PASS',tests:checks.length,realWrites:0,realStorageWrites:0}));
