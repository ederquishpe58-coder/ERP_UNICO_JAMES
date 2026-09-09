const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const results=[];
async function test(name,fn){await fn();results.push({name,result:'PASS'});}
function fixture(status,state,actions){
 const id='11000000-0000-4000-8000-000000000001',handlers={},container={innerHTML:''};let calls=0,resolve;
 const detail={document:{id,status,full_number:'001-002-000000760',access_key:'1'.repeat(49)},retention:{},
   cancellation:{documentId:id,companyId:'BLESS',purchaseId:'PURCHASE',state,version:1,actions,history:[]},recoveryPolicy:{action:'NONE'}};
 const buttons=()=>[...container.innerHTML.matchAll(/data-retention-cancellation="([A-Z_]+)"/g)].map(match=>({dataset:{retentionCancellation:match[1]},addEventListener:(_,fn)=>handlers[match[1]]=fn}));
 const viewButton={dataset:{retentionV2View:id},addEventListener:(_,fn)=>handlers.view=fn};
 const document={querySelectorAll:s=>s==='[data-retention-v2-view]'?[viewButton]:s==='[data-retention-cancellation]'?buttons():[],
 querySelector:s=>s==='#retention-cancellation-form'?{reportValidity:()=>true,elements:{reason:{value:'Motivo fixture'},reference:{value:'SRI PORTAL'},evidenceFile:{files:[]}}}:null};
 const svc={start(){},setHistoryVisible(){},snapshot:()=>({pending:[],actionable:[],queue:{},history:{}}),nextAction:()=>'',detail:async()=>detail,
   cancelWithholding(current,action,reason,evidence){calls++;assert.equal(current,detail);assert(actions.includes(action));assert.equal(evidence.accessKey,detail.document.access_key);return new Promise(ok=>resolve=ok);},
   prepareDraft:async purchaseId=>{assert.equal(purchaseId,'PURCHASE');return {purchaseId};},purchaseById:()=>({id:'PURCHASE'})};
 const app={services:{purchaseWithholdingV2:svc},layout:{renderPage:()=>app.purchaseWithholdingV2Ui.render(container,{id:'retentions',title:'Retenciones'})},
   utils:{escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')}};
 vm.runInNewContext(fs.readFileSync('scripts/modules/purchases/retentions-v2-ui.js','utf8'),{window:{BlessERP:app},document,Date,console});
 app.layout.renderPage();return {detail,container,handlers,open:()=>handlers.view(),calls:()=>calls,finish:()=>resolve(detail)};
}
(async()=>{
 for(const [status,state,actions,label] of [
 ['BORRADOR','NONE',['DISCARD'],'Descartar retención'],['AUTORIZADO','NONE',['REQUEST'],'Solicitar anulación'],
 ['AUTORIZADO','CANCELLATION_REQUESTED',['SUBMIT_PORTAL_REFERENCE'],'Registrar solicitud presentada en SRI'],
 ['AUTORIZADO','PENDING_CANCELLATION',['CONFIRM_OFFICIAL_ANNULMENT'],'Registrar anulación oficial y revertir'],
 ['ANULADO','ANULLED',['REISSUE'],'Volver a retener']]) await test(status+'/'+state+' renders only backend-permitted action',async()=>{
   const f=fixture(status,state,actions);await f.open();assert(f.container.innerHTML.includes(label));
   assert.deepEqual([...f.container.innerHTML.matchAll(/data-retention-cancellation="([A-Z_]+)"/g)].map(m=>m[1]),actions);
   assert.equal(f.calls(),0);
 });
 await test('Pending fiscal result has no cancellation; canonical recovery remains visible',async()=>{
   const f=fixture('PENDIENTE_REINTENTO','NONE',[]);f.detail.recoveryPolicy={action:'QUERY_AUTHORIZATION',actionLabel:'Consultar / recuperar SRI'};
   await f.open();assert(!f.container.innerHTML.includes('data-retention-cancellation='));assert(f.container.innerHTML.includes('Consultar / recuperar SRI'));
 });
 await test('Official cancellation form requires evidence, matching identity and explicit SRI verification',async()=>{
   const f=fixture('AUTORIZADO','PENDING_CANCELLATION',['CONFIRM_OFFICIAL_ANNULMENT']);await f.open();
   for(const field of ['evidenceFile','accessKey','authorizationNumber','verified','annulmentDate'])assert(f.container.innerHTML.includes(`name="${field}"`));
   assert(f.container.innerHTML.includes('La retención sigue vigente'));assert(f.container.innerHTML.includes('SRI en Línea'));
 });
 await test('Double click cannot submit a second cancellation mutation',async()=>{
   const f=fixture('BORRADOR','NONE',['DISCARD']);await f.open();const handler=f.handlers.DISCARD;
   const pending=handler();await handler();assert.equal(f.calls(),1);f.finish();await pending;assert.equal(f.calls(),1);
 });
 await test('Official history preserves predecessor and reversal identity without generating documents',async()=>{
   const f=fixture('ANULADO','ANULLED',[]);f.detail.cancellation.history=[{documentId:'old',fullNumber:'001-002-000000760',status:'ANULADO',cancellationState:'ANULLED',reversalJournalEntryId:'REVERSAL'},
    {documentId:'new',fullNumber:'001-002-000000761',status:'AUTORIZADO',previousDocumentId:'old'}];await f.open();
   for(const text of ['000000760','000000761','REVERSAL'])assert(f.container.innerHTML.includes(text));assert.equal(f.calls(),0);
 });
 await test('Read-only actor cannot gain action from document status alone',async()=>{
   const f=fixture('AUTORIZADO','NONE',[]);await f.open();assert(!f.container.innerHTML.includes('data-retention-cancellation='));
 });
 console.log(JSON.stringify({result:'PASS',passed:results.length,results,businessMutations:0,sriTransmissions:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
