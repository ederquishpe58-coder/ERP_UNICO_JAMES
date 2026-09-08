const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const RealDate = Date;
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-09-08T05:30:00Z'])); } static now() { return new RealDate('2026-09-08T05:30:00Z').getTime(); } };
global.fetch = async () => { throw Error('REAL_NETWORK_FORBIDDEN'); };
const { backend, received, fault } = require('./validate-sri-safe-retry.cjs');
const { recoveryPolicy } = require('./api/sri/_lib/recovery-policy.cjs');
const { withholdingDateRecovery, definitiveAuthorizationAbsent } = require('./api/sri/_lib/withholding-date-recovery.cjs');
const { buildAccessKey } = require('./api/sri/_lib/access-key.cjs');
const { parseAuthorizationResponse } = require('./api/sri/_lib/sri-soap.cjs');
const key = '0809202607171763708400120010020000007468523087819';
const results = [];
async function test(name, run) { try { await run(); results.push({ name, result: 'PASS' }); } catch (e) { results.push({ name, result: 'FAIL', error: e.stack }); } }
const response = xml => ({ ok: true, status: 200, text: async () => xml });
function fixture(type='07', environment='PRODUCTION') {
  const access = type==='07' && environment==='PRODUCTION' ? key : buildAccessKey({issueDate:'2026-09-08',documentType:type,ruc:'1717637084001',environment,establishmentCode:'001',emissionPointCode:'002',sequential:746,numericCode:'85230878',emissionType:'1'}).accessKey;
  const b = backend(type,'DEVUELTO',true,environment,{document:{issue_date:'2026-09-08',access_key:access,sequential_text:'000000746',full_number:'001-002-000000746',last_error:'65'}});
  const own={company_id:b.document.company_id,document_id:b.document.id};
  Object.assign(b.tables.sri_transmissions[0],{status:'COMPLETED',error_class:null,attempt_number:1,request_file_id:'same-signed-file'});
  Object.assign(b.tables.sri_transmission_attempts[0],{status:'SUCCEEDED',error_class:null});
  b.artifacts.push({...own,id:'same-signed-file',file_type:'SIGNED_XML'});
  b.tables.sri_responses.push({...own,id:'returned',transmission_id:'reception',response_type:'RECEPTION',sri_status:'DEVUELTA',received_at:'2026-09-08T04:54:55Z',payload:{returned:true,messages:[{identifier:'65'}],receipts:[{accessKey:access}]}});
  b.tables.sri_error_messages.push({...own,id:'error65',identifier:'65',stage:'RECEPTION'});
  // I/O model only. The same real RPC is independently executed in PostgreSQL fixtures.
  const rpc=b.client.rpc.bind(b.client);
  b.client.rpc=async (name,args)=>{
    if(name!=='erp_sri_retry_returned_withholding_date')return rpc(name,args);
    b.calls.push({rpc:name,args});
    const attempt=b.tables.sri_transmission_attempts.find(a=>a.id===args.p_lookup_attempt_id);
    const query=b.tables.sri_transmissions.find(j=>j.id===attempt.transmission_id);
    const receipt=b.tables.sri_transmissions.find(j=>j.id==='reception');
    assert.equal(query.status,'PROCESSING'); assert.equal(b.document.status,'DEVUELTO');
    Object.assign(attempt,{status:'SUCCEEDED'}); Object.assign(query,{status:'RETRY_SCHEDULED',next_attempt_at:new Date().toISOString()});
    Object.assign(receipt,{status:'PENDING'}); b.document.status='ENVIADO_SRI';
    return {data:{...own,environment,access_key:access,sequential:746,requeued:true}};
  };
  b.query=fetchImpl=>b.service.queryDocumentStatus(b.client,b.document.company_id,b.document.id,'actor',{fetchImpl});
  return b;
}
(async()=>{
  await test('746 code65 midnight case: backend exposes query/retry without creating anything',()=>{
    const b=fixture(),before=JSON.stringify(b.tables); const p=recoveryPolicy(b.detail());
    assert.equal(p.action,'QUERY_AUTHORIZATION');assert.equal(p.actionLabel,'Consultar / reintentar SRI');
    assert.equal(p.nextAction,'AUTHORIZATION_LOOKUP_FIRST');assert.equal(p.canTransmit,false);
    assert.equal(JSON.stringify(b.tables),before);
    const ui=fs.readFileSync('scripts/modules/purchases/retentions-v2-ui.js','utf8');
    assert.match(ui,/policy\.action === "QUERY_AUTHORIZATION"/);assert.match(ui,/policy\.actionLabel/);
  });
  for(const [name,mutate] of [
    ['Other date still future',b=>b.document.issue_date='2026-09-09'],
    ['Expired date',b=>b.document.issue_date='2026-09-07'],
    ['Rejected during same Ecuador date',b=>b.tables.sri_responses[0].received_at='2026-09-08T05:01:00Z'],
    ['Extra rejection reason',b=>b.tables.sri_responses[0].payload.messages.push({identifier:'70'})],
    ['Other rejection code',b=>b.tables.sri_responses[0].payload.messages[0].identifier='45'],
    ['Wrong response company',b=>b.tables.sri_responses[0].company_id='another'],
    ['Wrong key',b=>b.tables.sri_responses[0].payload.receipts[0].accessKey='0'.repeat(49)],
    ['No signed XML',b=>b.artifacts.length=0],
    ['Exhausted attempts',b=>b.tables.sri_transmissions[0].attempt_number=12],
    ['NO_AUTORIZADO final',b=>b.document.status='NO_AUTORIZADO']
  ]) await test(name+' cannot enable date resend',()=>{const b=fixture();mutate(b);assert.equal(withholdingDateRecovery(b.detail()),null);});
  for(const type of ['01','04'])await test(type+' unchanged by retention date recovery',()=>assert.equal(withholdingDateRecovery(fixture(type).detail()),null));
  await test('Lookup AUTORIZADO recovers same document, key, accounting; zero resends',async()=>{
    const b=fixture(),before=structuredClone(b.document),accounting=JSON.stringify(b.tables.accounting_document_links),urls=[];
    await b.query(async url=>{urls.push(url);assert.ok(url.includes('Autorizacion'));return response(b.authResponse());});
    assert.equal(b.document.status,'AUTORIZADO');assert.equal(urls.length,1);assert.equal(b.document.id,before.id);assert.equal(b.document.access_key,key);
    assert.equal(b.document.sequential_text,before.sequential_text);assert.equal(JSON.stringify(b.tables.accounting_document_links),accounting);
    assert.equal(b.calls.filter(c=>c.rpc==='erp_sri_retry_returned_withholding_date').length,0);
  });
  await test('Definitive absent then same signed bytes sent once, then authorization; repeat sends zero',async()=>{
    const b=fixture(),urls=[],hash=createHash('sha256').update(b.signedArtifact.xml).digest('hex');
    await b.query(async (url,options)=>{urls.push(url);if(urls.length===1)return response(b.authResponse('NO_ENCONTRADO'));
      if(url.includes('Recepcion')){assert.equal(createHash('sha256').update(b.signedArtifact.xml).digest('hex'),hash);assert.ok(options.body.includes(Buffer.from(b.signedArtifact.xml).toString('base64')));return response(received);}
      return response(b.authResponse());});
    assert.ok(urls[0].includes('Autorizacion'));assert.ok(urls[1].includes('Recepcion'));assert.ok(urls[2].includes('Autorizacion'));
    assert.equal(b.document.status,'AUTORIZADO');assert.equal(b.document.access_key,key);assert.equal(b.document.sequential_text,'000000746');
    await b.run(()=>{throw Error('Repeated transmission');});assert.equal(urls.length,3);
    assert.equal(b.tables.accounting_document_links.length,1);assert.equal(b.tables.electronic_documents.length,1);
  });
  for(const [name,make] of [
    ['Pending explicit message',b=>b.authResponse('NO_ENCONTRADO').replace('</numeroComprobantes>','</numeroComprobantes><mensajes><mensaje><identificador>70</identificador></mensaje></mensajes>')],
    ['Missing count',b=>b.authResponse('NO_ENCONTRADO').replace('<numeroComprobantes>0</numeroComprobantes>','')],
    ['Contradictory count',b=>b.authResponse('NO_ENCONTRADO').replace('<numeroComprobantes>0','<numeroComprobantes>1')],
    ['SOAP fault',()=>fault]
  ])await test(name+' preserves lookup-first; no resend',async()=>{const b=fixture(),urls=[];await assert.rejects(()=>b.query(async url=>{urls.push(url);return response(make(b));}));assert.ok(urls.every(u=>u.includes('Autorizacion')));assert.equal(b.document.status,'DEVUELTO');});
  await test('Official NO AUTORIZADO does not resend',async()=>{const b=fixture();let n=0;await b.query(async url=>{n++;assert.ok(url.includes('Autorizacion'));return response(b.authResponse('NO AUTORIZADO'));});assert.equal(n,1);assert.equal(b.document.status,'NO_AUTORIZADO');});
  await test('Lookup network failure does not requeue',async()=>{const b=fixture();await assert.rejects(()=>b.query(async()=>{throw Error('Synthetic network error');}));assert.equal(b.document.status,'DEVUELTO');assert.equal(b.calls.filter(c=>c.rpc==='erp_sri_retry_returned_withholding_date').length,0);});
  await test('Signed XML mismatch blocks before canonical requeue',async()=>{const b=fixture();b.signedArtifact.xml=b.signedArtifact.xml.replace('<ambiente>2','<ambiente>1');await assert.rejects(()=>b.query(async()=>response(b.authResponse('NO_ENCONTRADO'))));assert.equal(b.document.status,'DEVUELTO');});
  await test('TEST history uses TEST endpoints after default switches to PROD',async()=>{const b=fixture('07','TEST');b.tables.sri_settings[0].environment='PRODUCTION';b.tables.sri_settings[0].production_enabled=true;await b.query(async url=>{assert.ok(url.includes('celcer.sri.gob.ec'));return response(b.authResponse());});assert.equal(b.document.environment,'TEST');});
  await test('Same-key absent parser rejects ambiguous count',()=>{const b=fixture();const result=parseAuthorizationResponse(b.authResponse('NO_ENCONTRADO'));assert.equal(definitiveAuthorizationAbsent(b.document,result),true);result.rawXml=result.rawXml.replace('<numeroComprobantes>0</numeroComprobantes>','');assert.equal(definitiveAuthorizationAbsent(b.document,result),false);});
  await test('Actual retention detail UI renders backend action and binds same document; final states hide it',async()=>{
    const b=fixture(),container={innerHTML:''},handlers={};let recoverCalls=0;
    const detail=()=>({...b.detail(),recoveryPolicy:recoveryPolicy(b.detail())});
    const button=(name,dataset)=>({dataset,addEventListener:(_event,fn)=>handlers[name]=fn});
    const viewButton=button('view',{retentionV2View:b.document.id}),retryButton=button('retry',{retentionV2Recover:b.document.id});
    const uiService={start(){},setHistoryVisible(){},nextAction(){return '';},snapshot(){return {pending:[],actionable:[{id:b.document.id,status:b.document.status,fullNumber:b.document.full_number}],queue:{},history:{}};},detail:async()=>detail(),
      recover:async id=>{assert.equal(id,b.document.id);recoverCalls++;b.document.status='AUTORIZADO';return detail();}};
    const app={services:{purchaseWithholdingV2:uiService},layout:{renderPage:()=>app.purchaseWithholdingV2Ui.render(container,{id:'retentions',title:'Retenciones'})}};
    const document={querySelectorAll:s=>s==='[data-retention-v2-view]'?[viewButton]:[],querySelector:s=>s==='[data-retention-v2-recover]'&&container.innerHTML.includes('data-retention-v2-recover=')?retryButton:null};
    require('node:vm').runInNewContext(fs.readFileSync('scripts/modules/purchases/retentions-v2-ui.js','utf8'),{window:{BlessERP:app},document,Date,console});
    app.layout.renderPage();await handlers.view();assert.match(container.innerHTML,/Consultar \/ reintentar SRI/);
    assert.ok(container.innerHTML.includes('data-retention-v2-recover="'+b.document.id+'"'));
    await handlers.retry({currentTarget:retryButton});assert.equal(recoverCalls,1);assert.ok(!container.innerHTML.includes('data-retention-v2-recover='));
  });
  console.log(JSON.stringify({result:results.every(r=>r.result==='PASS')?'PASS':'FAIL',passed:results.filter(r=>r.result==='PASS').length,results,realTransmissions:0,sequencesConsumed:0,additionalJournals:0},null,2));
  process.exitCode=results.every(r=>r.result==='PASS')?0:1;
})();
