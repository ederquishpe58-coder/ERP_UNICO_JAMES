const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const results = [];
async function test(name, fn) { await fn(); results.push({name, result:'PASS'}); }
function fixture() {
  const id='752e40b9-bda1-44b0-9785-c2405487c0bc';
  const handlers={}, container={innerHTML:''}; let calls=0, processCalls=0, resolve, reject, processWait=null;
  const detail={document:{id,company_id:'cf331b82-7ac3-4065-9e38-d0bbcde96cd5',environment:'PRODUCTION',full_number:'001-002-000000750',status:'PENDIENTE_REINTENTO'},retention:{},recoveryPolicy:{action:'QUERY_AUTHORIZATION',actionLabel:'Consultar estado SRI'}};
  const button=(name,dataset)=>({dataset,addEventListener:(_event,fn)=>handlers[name]=fn});
  const viewButton=button('view',{retentionV2View:id}), retryButton=button('retry',{retentionV2Recover:id});
  const other=JSON.parse(JSON.stringify(detail));other.document.id='f9d70df4-4883-468f-b53e-aa2fc89d6947';other.document.full_number='001-002-000000751';
  const otherView=button('view751',{retentionV2View:other.document.id});
  const process750=button('process750',{retentionV2Process:id}), process751=button('process751',{retentionV2Process:other.document.id});
  const svc={start(){},setHistoryVisible(){},nextAction(){return '';},snapshot(){return {pending:[],actionable:[],queue:{},history:{}};},detail:async requested=>requested===other.document.id?other:detail,process:async requested=>{processCalls++;await processWait;return requested===other.document.id?other:detail;},recover(documentId){assert.equal(documentId,id);calls++;return new Promise((ok,no)=>{resolve=ok;reject=no;});}};
  const app={services:{purchaseWithholdingV2:svc},layout:{renderPage:()=>app.purchaseWithholdingV2Ui.render(container,{id:'retentions',title:'Retenciones'})}};
  const document={querySelectorAll:s=>s==='[data-retention-v2-view]'?[viewButton,otherView]:s==='[data-retention-v2-process]'?[process750,process751]:[],querySelector:s=>s==='[data-retention-v2-recover]'&&container.innerHTML.includes('data-retention-v2-recover=')?retryButton:null};
  vm.runInNewContext(fs.readFileSync('scripts/modules/purchases/retentions-v2-ui.js','utf8'),{window:{BlessERP:app},document,Date,console});
  app.layout.renderPage();
  return {id,detail,handlers,container,app,retry:()=>handlers.retry({currentTarget:retryButton}),calls:()=>calls,holdProcess:()=>{let release;processWait=new Promise(ok=>release=ok);return release;},processCalls:()=>processCalls,resolve:()=>resolve(detail),reject:()=>reject(Error('Este comprobante está siendo procesado. Intente nuevamente en unos segundos.'))};
}
(async()=>{
  await test('20 clicks concurrentes conservan una solicitud y el mismo documento',async()=>{
    const f=fixture();await f.handlers.view();const retry=f.handlers.retry;
    const pending=Array.from({length:20},()=>retry({currentTarget:{dataset:{retentionV2Recover:f.id}}}));
    assert.equal(f.calls(),1);assert.match(f.container.innerHTML,/data-retention-v2-recover="[^"]+" disabled/);assert.match(f.container.innerHTML,/Consultando\.\.\./);
    f.resolve();await Promise.all(pending);assert.equal(f.calls(),1);assert.doesNotMatch(f.container.innerHTML,/data-retention-v2-recover="[^"]+" disabled/);
  });
  await test('Error ocupado visible y guard se libera sin retry automático',async()=>{
    const f=fixture();await f.handlers.view();const pending=f.retry();f.reject();await pending;assert.equal(f.calls(),1);assert.match(f.container.innerHTML,/Este comprobante está siendo procesado/);assert.doesNotMatch(f.container.innerHTML,/data-retention-v2-recover="[^"]+" disabled/);
  });
  await test('Backend NONE/estado autorizado no muestra acción de recuperación',async()=>{
    const f=fixture();f.detail.document.status='AUTORIZADO';f.detail.recoveryPolicy.action='NONE';await f.handlers.view();assert.doesNotMatch(f.container.innerHTML,/data-retention-v2-recover=/);assert.equal(f.calls(),0);
  });
  await test('750 en consulta no bloquea751 ni sobrescribe su detalle al responder tarde',async()=>{
    const f=fixture();await f.handlers.view();const pending=f.retry();await f.handlers.process750();assert.equal(f.processCalls(),0);
    await f.handlers.view751();await f.handlers.process751();assert.equal(f.processCalls(),1);assert.match(f.container.innerHTML,/001-002-000000751/);
    f.resolve();await pending;assert.match(f.container.innerHTML,/001-002-000000751/);assert.doesNotMatch(f.container.innerHTML,/001-002-000000750/);
  });
  await test('Procesar750 primero también bloquea consulta duplicada del mismo documento',async()=>{const f=fixture();await f.handlers.view();const release=f.holdProcess(),pending=f.handlers.process750();await f.retry();assert.equal(f.calls(),0);assert.equal(f.processCalls(),1);release();await pending;});
  console.log(JSON.stringify({result:'PASS',results,realTransmissions:0,documentsCreated:0,sequencesConsumed:0},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
