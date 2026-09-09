// No network, credentials or real documents. Actual policy/service/SOAP with modeled I/O.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const {fixture}=require('./validate-sri-manual-authorization-recovery.cjs');
const {received,networkError,envelope}=require('./validate-sri-safe-retry.cjs');
const {sha256}=require('./api/sri/_lib/artifact-store.cjs');
const {parseAuthorizationResponse}=require('./api/sri/_lib/sri-soap.cjs');
const {evaluateManualSameDocumentRetry:evaluate,frozenIdentity}=require('./api/sri/_lib/manual-retry-policy.cjs');
const {managerPolicy,CAPS}=require('./api/sri/_lib/manager-policy.cjs');
const endpointFor=require('./api/sri/_lib/environment.cjs').endpointFor;
global.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
const results=[],ok=body=>({ok:true,status:200,text:async()=>body});
async function test(name,run){try{await run();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:e.stack});}}
function eligible(environment='PRODUCTION',type='07'){
 const b=fixture(environment,type,true),d=b.document,j=b.tables.sri_transmissions[0],hash=sha256(b.signedArtifact.xml),scope={company_id:d.company_id,document_id:d.id};
 b.artifacts.forEach(f=>Object.assign(f,scope));
 Object.assign(b.signedArtifact.file,{...scope,id:'same-signed-file',file_type:'SIGNED_XML',storage_bucket:'sri-private',storage_object_path:`companies/${d.company_id}/documents/${d.id}/signed_xml-${hash}.xml`,content_sha256:hash});
 b.artifacts.push(b.signedArtifact.file);j.request_file_id='same-signed-file';
 const send=b.tables.sri_transmission_attempts[0];Object.assign(send,{...scope,attempt_number:1,status:'FAILED',http_status:500,request_sha256:hash,endpoint_url:j.endpoint_url,finished_at:'2026-09-08T14:00:00Z'});
 b.tables.electronic_document_audit_logs.push({...scope,id:'native-fault',action:'TRANSPORT_DIAGNOSTIC',new_values:{phase:'RECEPTION',attemptId:send.id,transmissionId:j.id,transport:{environment,httpStatus:500,response:{faultCode:'soap:Server',faultString:'JBAS014559: Invocation cannot proceed as component is shutting down'}}}});
 const raw=b.authResponse('NO_ENCONTRADO'),responseHash=sha256(raw);
 b.tables.sri_responses.push({...scope,id:'absent-official',transmission_id:b.queryJob.id,response_type:'AUTHORIZATION',sri_status:'NO_ENCONTRADO',raw_xml:raw,content_sha256:responseHash,payload:parseAuthorizationResponse(raw)});
 b.tables.sri_transmission_attempts.filter(a=>a.transmission_id===b.queryJob.id).forEach(a=>Object.assign(a,{http_status:200,response_sha256:responseHash}));
 const originalDetail=b.detail;b.detail=()=>{const x=originalDetail();x.files=x.files.map(f=>({...f,...scope}));return x;};
 const validate=async()=>({validation:'PASS',signed:true,xmlAvailable:true,xmlSha256:hash});
 const read=async()=>{const x=b.detail();x.managerPolicy=managerPolicy({...x,manualRetryValidation:await validate()},Object.values(CAPS));return x;};
 const originalFrom=b.client.from;b.client.from=table=>{const q=originalFrom(table);q.contains=(key,obj)=>{q.filters.push(row=>Object.entries(obj).every(([k,v])=>row[key]?.[k]===v));return q;};return q;};
 const rpc=b.client.rpc.bind(b.client);let manual=null;
 b.client.rpc=async(name,args)=>{
  if(name==='claim_sri_manual_same_document_reception'){
   b.calls.push({rpc:name,args:structuredClone(args)});
   if(b.tables.electronic_document_audit_logs.some(a=>a.new_values?.operation_id===args.p_operation_id))return {error:{message:'SRI_MANUAL_RETRY_OPERATION_CONSUMED'}};
   assert.equal(b.queryJob.status,'PROCESSING');assert.equal(b.queryJob.worker_id,args.p_authorization_worker);assert.deepEqual(args.p_document_snapshot,d);
   const auth=b.tables.sri_transmission_attempts.find(a=>a.id===args.p_authorization_attempt_id),now=new Date().toISOString();
   Object.assign(auth,{status:'SUCCEEDED',response_sha256:responseHash,http_status:200,finished_at:now});
   Object.assign(b.queryJob,{status:'FAILED',finished_at:now});
   const attempt={...scope,id:randomUUID(),transmission_id:j.id,attempt_number:2,status:'STARTED',request_sha256:hash,endpoint_url:j.endpoint_url,started_at:now};
   Object.assign(j,{status:'PROCESSING',worker_id:'manual-reception-'+args.p_operation_id,claimed_at:now,finished_at:null,next_attempt_at:null});
   b.tables.sri_transmission_attempts.push(attempt);b.tables.electronic_document_audit_logs.push({...scope,action:'SRI_MANUAL_SAME_DOCUMENT_RETRY',new_values:{operation_id:args.p_operation_id}});
   manual={...j,manual_same_document:true,operation_id:args.p_operation_id,claim_attempt:attempt};return {data:structuredClone(manual)};
  }
  if(name==='assert_sri_manual_reception_claim'){
   const a=b.tables.sri_transmission_attempts.find(a=>a.id===args.p_attempt_id);
   if(!manual||j.status!=='PROCESSING'||j.worker_id!==args.p_worker_id||a?.status!=='STARTED')return {error:{message:'SRI_MANUAL_RECEPTION_CLAIM_LOST'}};
   return {data:true};
  }
  // The SQL suite proves this one-shot post-reception cooldown exception.
  if(name==='claim_sri_manual_authorization'&&manual&&j.status==='COMPLETED'&&j.finished_at>b.queryJob.finished_at)b.queryJob.finished_at=new Date(Date.now()-31000).toISOString();
  return rpc(name,args);
 };
 const filename=path.join(__dirname,'api/sri/_lib/manual-retry-service.cjs'),actual=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require(name){
  if(name==='./transmission-service.cjs')return b.service;
  if(name==='./document-service.cjs')return {...actual(name),getDocumentDetail:async()=>b.detail()};
  return actual(name);
 },console,Date,Buffer},{filename});
 b.input={operationId:randomUUID(),confirmSameDocument:true,identity:frozenIdentity(b.detail())};
 b.retry=(fetchImpl,extra={})=>module.exports.retrySameDocument(b.client,{},d.company_id,d.id,'actor',b.input,{detail:read,validate,fetchImpl,...extra});
 b.validation=validate;b.read=read;return b;
}
async function main(){
 for(const env of ['TEST','PRODUCTION'])for(const type of ['01','04','07'])await test(type+' '+env+' same XML after final lookup; RECIBIDA then authorization',async()=>{
  const b=eligible(env,type),before=frozenIdentity(b.detail()),urls=[],links=JSON.stringify(b.tables.accounting_document_links);let queries=0;
  await b.retry(async(url,options)=>{urls.push(url);if(url===endpointFor(env,'AUTHORIZATION_QUERY'))return ok(++queries===1?b.authResponse('NO_ENCONTRADO'):b.authResponse());
   const encoded=options.body.match(/<xml>([^<]+)<\/xml>/)?.[1];assert.equal(Buffer.from(encoded,'base64').toString(),b.signedArtifact.xml);return ok(received);});
  assert.deepEqual(urls,[endpointFor(env,'AUTHORIZATION_QUERY'),endpointFor(env,'RECEPTION'),endpointFor(env,'AUTHORIZATION_QUERY')]);
  assert.equal(b.document.status,'AUTORIZADO');assert.deepEqual(frozenIdentity(b.detail()),before);assert.equal(JSON.stringify(b.tables.accounting_document_links),links);
  assert.equal(b.tables.electronic_documents.length,1);assert.equal(b.queryJob.attempt_number,12);assert.equal(b.tables.sri_transmissions[0].attempt_number,1);
  assert.equal(b.tables.sri_transmission_attempts.filter(a=>a.transmission_id==='reception').length,2);
  await assert.rejects(()=>b.retry(()=>{throw Error('DUPLICATE_SOCKET');}));
 });
 await test('Final lookup already authorized: recover, reception zero',async()=>{const b=eligible();let count=0;await b.retry(async url=>{count++;assert.equal(url,endpointFor('PRODUCTION','AUTHORIZATION_QUERY'));return ok(b.authResponse());});assert.equal(count,1);assert.equal(b.document.status,'AUTORIZADO');assert.equal(b.calls.filter(c=>c.rpc==='claim_sri_manual_same_document_reception').length,0);});
 await test('Final lookup PROCESSING/70 blocks reception',async()=>{const b=eligible();let count=0;await b.retry(async url=>{count++;assert.equal(url,endpointFor('PRODUCTION','AUTHORIZATION_QUERY'));return ok(b.authResponse('EN PROCESO').replace('</estado>','</estado><mensajes><mensaje><identificador>70</identificador><mensaje>CLAVE EN PROCESAMIENTO</mensaje></mensaje></mensajes>'));});assert.equal(count,1);assert.equal(evaluate(b.detail()).allowed,false);});
 for(const code of ['43','45','70'])await test('Reception '+code+' retains identity and queries; no new resend',async()=>{
  const b=eligible(),urls=[];await b.retry(async url=>{urls.push(url);return ok(url.endsWith('AutorizacionComprobantesOffline')?b.authResponse('NO_ENCONTRADO'):envelope(`<validarComprobanteResponse><RespuestaRecepcionComprobante><estado>DEVUELTA</estado><comprobantes><comprobante><mensajes><mensaje><identificador>${code}</identificador><mensaje>REGISTRADO O PROCESANDO</mensaje></mensaje></mensajes></comprobante></comprobantes></RespuestaRecepcionComprobante></validarComprobanteResponse>`));});
  assert.equal(urls.filter(u=>u.endsWith('RecepcionComprobantesOffline')).length,1);assert.equal(urls.length,3);assert.equal(evaluate(b.detail()).allowed,false);
 });
 await test('New uncertainty: query-first, no recursive resend or automatic budget reset',async()=>{
  const b=eligible();let receptions=0;await assert.rejects(()=>b.retry(async url=>{if(url.endsWith('AutorizacionComprobantesOffline'))return ok(b.authResponse('NO_ENCONTRADO'));receptions++;throw networkError('ECONNRESET');}));
  assert.equal(receptions,1);assert.equal(b.tables.sri_transmissions[0].status,'FAILED');assert.equal(b.queryJob.attempt_number,12);assert.equal(evaluate(b.detail()).allowed,false);
 });
 await test('20 concurrent confirmations: max one active reception; no identity/business duplication',async()=>{
  const b=eligible();let active=0,max=0,sends=0,queries=0;
  await Promise.allSettled(Array.from({length:20},()=>b.retry(async url=>{if(url.endsWith('AutorizacionComprobantesOffline'))return ok(++queries===1?b.authResponse('NO_ENCONTRADO'):b.authResponse());sends++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,20));active--;return ok(received);})));
  assert.equal(max,1);assert.equal(sends,1);assert.equal(b.tables.electronic_documents.length,1);assert.equal(b.tables.accounting_document_links.length,1);
 });
 const cases=[['active claim',b=>b.tables.sri_transmissions[0].status='PROCESSING'],['active attempt',b=>b.tables.sri_transmission_attempts[0].status='STARTED'],['code70',b=>b.tables.sri_error_messages.push({company_id:b.document.company_id,document_id:b.document.id,identifier:'70'})],['wrong environment',b=>b.tables.sri_transmissions[0].environment='TEST'],['wrong company',b=>b.tables.sri_transmissions[0].company_id='other'],['generic500',b=>b.tables.electronic_document_audit_logs[0].new_values.transport.response.faultString='Unknown failure'],['one NOT_FOUND',b=>b.tables.sri_transmission_attempts.splice(2)],['changed XML',b=>b.signedArtifact.file.content_sha256='b'.repeat(64)],['future wait',b=>b.queryJob.next_attempt_at=new Date(Date.now()+60000).toISOString()]];
 for(const [name,change]of cases)await test(name+' blocks without socket',async()=>{const b=eligible();change(b);await assert.rejects(()=>b.retry(()=>{throw Error('SOCKET_FORBIDDEN');}));assert.equal(b.calls.filter(c=>c.rpc==='claim_sri_manual_same_document_reception').length,0);});
 await test('Signed validation failure blocks under claim before final lookup',async()=>{const b=eligible();await assert.rejects(()=>b.retry(()=>{throw Error('SOCKET_FORBIDDEN');},{validate:async()=>({validation:'FAIL'})}));assert.equal(b.calls.filter(c=>c.rpc==='claim_sri_manual_same_document_reception').length,0);});
 await test('No capability/OWNER bypass',()=>{const b=eligible();assert.equal(managerPolicy({...b.detail(),role:'OWNER'},[]).actions.retry.allowed,false);});
 fs.mkdirSync('.release/same-document-retry',{recursive:true});fs.writeFileSync('.release/same-document-retry/service-tests.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({passed:results.filter(r=>r.result==='PASS').length,total:results.length,failures:results.filter(r=>r.result==='FAIL')},null,2));if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={eligible};
