const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
global.fetch=()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff',checks=[];
const read=f=>fs.readFileSync(f,'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
async function test(name,f){await f();checks.push({name,result:'PASS'});}
function fixture(){
 let company=I,user='JAMES',failure=false,delay=null,tamper=null;const calls=[],persisted=new Map();
 const source={varieties:[{id:'V1',name:'EXPLORER',code:'V01',active:true},{id:'V2',name:'HISTORIC',active:false}],lengths:[{id:'L1',name:'63',active:true},{id:'L2',name:'71',active:false}]};
 const state={db:{activeCompanyId:'COMP-IMPERIO-FLOWERS',commercial:{orders:[],customerCatalog:[{id:'C',name:'BUYER',commercialName:'BUYER',country:'ECUADOR',status:'ACTIVO'}],brandCatalog:[{id:'M',customerId:'C',name:'FINAL',finalClientName:'FINAL',country:'USA'}]},operations:{masterData:{varieties:[{id:'STALE',name:'STALE IMPERIO',active:true}],lengths:[{id:'STALE',name:'999',active:true}]}}}};
 const ERP={utils:{clone,uid:()=>randomUUID(),esc:x=>String(x??''),number:Number},services:{companyContext:{activeCompanyId:()=>company===I?'COMP-IMPERIO-FLOWERS':'COMP-BLESS-FLOWER'}},
  authAccess:{activeAccess:()=>({activeCompany:{id:company},session:{user:{id:user}}})},state:{state,saveDbLocalOnly:()=>true,currentRoute:()=>({id:'commercial-order-master'})},
  getEnvConfig:()=>({supabaseEnabled:true,authEnabled:true,incrementalSyncEnabled:true}),layout:{toast(){},renderPage(){}},
  getSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});assert.equal(name,'erp_commercial_shared_postharvest_catalog');assert.equal(args.p_company_id,I);assert(['varieties','lengths'].includes(args.p_catalog));assert.equal(args.p_include_inactive,false);if(delay)await delay;if(failure)return{error:{message:'SERVER_READ_FAILED'}};
   const data={company_id:I,owner_company_id:B,catalog:args.p_catalog,read_only:true,source:'erp_entity_records',include_inactive:false,records:source[args.p_catalog].filter(r=>r.active).map(r=>({...r,owner_company_id:B,deleted_at:null}))};if(tamper)tamper(data);return{data};}})};
 const context=vm.createContext({window:{BlessERP:ERP,location:{protocol:'https:'}},console,structuredClone,Intl,Date,Map,Set,crypto:require('node:crypto').webcrypto});
 for(const f of ['scripts/core/flower-quality.js','scripts/modules/comercial/invoice-sequence-core.js','scripts/modules/comercial/comercial-data.js','scripts/modules/comercial/comercial-utils.js','scripts/modules/comercial/order-box-builder.js','scripts/repositories/comercial/shared-postharvest-catalog-repository.js','scripts/modules/comercial/flow-v2/commercial-flow-core.js','scripts/modules/comercial/flow-v2/commercial-flow-ui.js'])vm.runInContext(read(f),context,{filename:f});
 ERP.getCommercialOrderRepository=()=>({canListPage:()=>true,saveConfirmedOrder:async(order)=>{const saved={...clone(order),number:order.number||'PED-FIXTURE',unsavedDraft:false};persisted.set(saved.id,saved);return{ok:true,serverRecord:{payload:saved,version:1,record_id:saved.id},operationId:randomUUID()};}});
 const shared=ERP.sharedPostharvestCatalog,flow=ERP.commercialFlowV2;
 return{ERP,shared,flow,state,source,calls,persisted,context,setCompany:c=>{company=c;state.db.activeCompanyId=c===I?'COMP-IMPERIO-FLOWERS':'COMP-BLESS-FLOWER';},setUser:u=>user=u,setFailure:f=>failure=f,setDelay:d=>delay=d,setTamper:f=>tamper=f};
}
(async()=>{
await test('Empty cache IMPERIO has no stale local selections',async()=>{const b=fixture();assert.deepEqual(clone(b.flow.catalogs(b.state).varieties),[]);assert.deepEqual(clone(b.flow.catalogs(b.state).lengths),[]);});
for(const user of ['JAMES','ALEX'])await test(user+' IMPERIO uses BLESS products/measures and shared quality helper',async()=>{const b=fixture();b.setUser(user);await b.shared.load(b.state);assert.deepEqual(clone(b.flow.catalogs(b.state).varieties.map(r=>r.name)),['EXPLORER']);assert.deepEqual(clone(b.flow.catalogs(b.state).lengths.map(r=>r.name)),['63']);assert.deepEqual(clone(b.ERP.flowerQuality.VALUES),['PREMIUM','TIPO_B']);assert.equal(b.calls.length,2);});
await test('Cache acceleration does not duplicate requests',async()=>{const b=fixture();await b.shared.load(b.state);await b.shared.load(b.state);assert.equal(b.calls.length,2);});
await test('20 concurrent loads share only two read RPC calls',async()=>{const b=fixture();let resolve;b.setDelay(new Promise(r=>resolve=r));const pending=Array.from({length:20},()=>b.shared.load(b.state));assert.equal(b.calls.length,2);resolve();await Promise.all(pending);assert(b.shared.ready(b.state));});
await test('BLESS uses its unchanged own masterData and does not call shared RPC',async()=>{const b=fixture();b.setCompany(B);const before=JSON.stringify(b.state);await b.shared.load(b.state);assert.equal(b.flow.catalogs(b.state).varieties[0].name,'STALE IMPERIO');assert.equal(b.calls.length,0);assert.equal(JSON.stringify(b.state.db.operations.masterData),JSON.stringify(JSON.parse(before).db.operations.masterData));});
await test('Owner inactivation removes both selections on a new canonical read',async()=>{const b=fixture();await b.shared.load(b.state);b.source.varieties[0].active=false;b.source.lengths[0].active=false;await b.shared.load(b.state,{force:true});assert.equal(b.flow.catalogs(b.state).varieties.length,0);assert.equal(b.flow.catalogs(b.state).lengths.length,0);});
await test('Owner rename and nonstandard measure reflect fresh read without hardcoding',async()=>{const b=fixture();await b.shared.load(b.state);b.source.varieties[0].name='RENAMED';b.source.lengths[0].name='87';await b.shared.load(b.state,{force:true});assert.equal(b.flow.catalogs(b.state).varieties[0].name,'RENAMED');assert.equal(b.flow.catalogs(b.state).lengths[0].name,'87');});
await test('New session and refresh resolve identical canonical catalogs',async()=>{const a=fixture(),b=fixture();await a.shared.load(a.state);await b.shared.load(b.state);assert.deepEqual(clone(a.shared.selection(a.state)),clone(b.shared.selection(b.state)));});
await test('Company switch during pending read cannot apply old response',async()=>{const b=fixture();let resolve;b.setDelay(new Promise(r=>resolve=r));const task=b.shared.load(b.state);b.setCompany(B);resolve();await assert.rejects(()=>task,/CONTEXT_CHANGED/);assert.equal(b.shared.selection(b.state),null);});
await test('Actor switch during pending read cannot reuse personal session cache',async()=>{const b=fixture();let resolve;b.setDelay(new Promise(r=>resolve=r));const task=b.shared.load(b.state);b.setUser('ALEX');resolve();await assert.rejects(()=>task,/CONTEXT_CHANGED/);assert.equal(b.shared.ready(b.state),false);});
await test('Read failure is fail-closed and has no automatic retry storm',async()=>{const b=fixture();b.setFailure(true);await assert.rejects(()=>b.shared.load(b.state));for(let i=0;i<10;i++)await assert.rejects(()=>b.shared.load(b.state));assert.equal(b.calls.length,2);assert.equal(b.flow.catalogs(b.state).varieties.length,0);b.setFailure(false);await b.shared.load(b.state,{force:true});assert.equal(b.calls.length,4);});
for(const [name,change] of [['wrong owner',r=>r.owner_company_id=I],['wrong consumer',r=>r.company_id=B],['inactive row',r=>r.records[0].active=false],['deleted row',r=>r.records[0].deleted_at='2026-01-01'],['unexpected source',r=>r.source='localStorage']])await test('Reject '+name+' in backend projection',async()=>{const b=fixture();b.setTamper(change);await assert.rejects(()=>b.shared.load(b.state));assert.equal(b.flow.catalogs(b.state).varieties.length,0);});
for(const quality of ['PREMIUM','TIPO_B'])for(const market of ['LOCAL','EXPORTACION'])await test(quality+' '+market+' order save/ACK/reopen preserves shared text snapshots',async()=>{
 const b=fixture();await b.shared.load(b.state);const d=b.flow.newDraft(b.state,{customerId:'C',brandId:'M',saleType:market,transportType:market==='LOCAL'?'terrestre':'aereo',inventoryMode:'NO_INVENTORY',issuedAt:'2026-09-08',seller_id:'SELLER',sellerEmployeeId:'EMP',seller_name:'SELLER'});
 const draft=b.flow.getDraft(b.state);Object.assign(draft,{customerId:'C',brandId:'M',saleType:market,inventoryMode:'NO_INVENTORY',seller_id:'SELLER',sellerEmployeeId:'EMP',seller_name:'SELLER'});
 draft.lines=[b.ERP.comercialData.createLine({variety:b.flow.catalogs(b.state).varieties[0].name,length:Number(b.flow.catalogs(b.state).lengths[0].name),quality,boxNumber:1,boxType:'HB',bunches:4,stemsPerBunch:25,unitPrice:0.5})];
 const expected=clone(draft.lines.map(({variety,length,quality})=>({variety,length,quality})));
 const saved=await b.flow.saveOrderConfirmed(b.state);assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.confirmedByServer,true);
 assert.deepEqual(clone(saved.order.lines.map(({variety,length,quality})=>({variety,length,quality}))),expected);
 b.flow.openOrder(b.state,saved.order.id);assert.deepEqual(clone(b.flow.getDraft(b.state).lines.map(({variety,length,quality})=>({variety,length,quality}))),expected);
 const historical=JSON.stringify(b.state.db.commercial.orders);b.source.varieties[0].active=false;b.source.lengths[0].active=false;await b.shared.load(b.state,{force:true});assert.equal(JSON.stringify(b.state.db.commercial.orders),historical);
 const html=b.ERP.comercialPedido.render(b.state);assert(html.includes('EXPLORER'));assert(html.includes('63'));assert(html.includes(quality));
 for(const f of ['scripts/modules/comercial/print/client-invoice-utils.js','scripts/modules/comercial/labels/box-labels-data.js','scripts/modules/comercial/labels/customs-code-utils.js','scripts/modules/comercial/labels/box-labels-utils.js'])vm.runInContext(read(f),b.context,{filename:f});
 const invoice=b.ERP.comercialClientInvoiceUtils.buildDocumentData(saved.order,b.state);
 assert.equal(invoice.rows[0].description,'EXPLORER');assert.equal(invoice.rows[0].length,63);assert.equal(invoice.rows[0].quality,quality);
 const labels=b.ERP.comercialLabelsUtils.buildDocumentData(saved.order,b.state);
 assert(JSON.stringify(labels).includes('EXPLORER'));assert(JSON.stringify(labels).includes(quality));assert(JSON.stringify(labels).includes('63'));
});
await test('Historical IMPERIO local catalogs remain untouched by shared load',async()=>{const b=fixture(),before=JSON.stringify(b.state);await b.shared.load(b.state);assert.equal(JSON.stringify(b.state),before);});
await test('Shared selection quality uses existing helper; no quality RPC or new enum',async()=>{assert(!read('scripts/repositories/comercial/shared-postharvest-catalog-repository.js').includes('PREMIUM'));assert(read('scripts/modules/comercial/flow-v2/commercial-flow-ui.js').includes('BlessERP.flowerQuality?.options'));});
for(const route of ['commercial-order-master','commercial-preorders','commercial-export-products'])await test(route+' waits for canonical read and rerenders once',async()=>{
 const b=fixture();let finish,rendered=0,rerenders=0;b.setDelay(new Promise(r=>finish=r));b.ERP.state.currentRoute=()=>({id:route});
 const stub={render:()=>{rendered++;return 'READY';},bind(){}};b.ERP.comercialPedido=stub;b.ERP.comercialPreorders=stub;b.ERP.comercialCatalogs={renderProductsPage:stub.render};
 vm.runInContext(read('scripts/modules/comercial/index.js'),b.context);const container={innerHTML:'',querySelector:()=>null};const render=()=>b.ERP.modules.comercial.render(container,{id:route},b.state);
 b.ERP.layout.renderPage=()=>{rerenders++;render();};render();render();assert(container.innerHTML.includes('Cargando'));assert.equal(rendered,0);assert.equal(b.calls.length,2);
 const pending=b.shared.state(b.state).promise;finish();await pending;await Promise.resolve();assert.equal(rendered,1);assert.equal(rerenders,1);assert.equal(container.innerHTML,'READY');
});
await test('Products page uses shared names and never falls back to stale IMPERIO varieties',async()=>{
 const b=fixture();b.ERP.operacionesState={getStore:()=>b.state.db.operations};vm.runInContext(read('scripts/modules/comercial/catalogos-comerciales.js'),b.context);
 assert(!b.ERP.comercialCatalogs.renderProductsPage(b.state).includes('STALE IMPERIO'));await b.shared.load(b.state);
 const html=b.ERP.comercialCatalogs.renderProductsPage(b.state);assert(html.includes('EXPLORER'));assert(!html.includes('STALE IMPERIO'));
});
console.log(JSON.stringify({result:'PASS',tests:checks.length,checks,productionCalls:0,orders:'Actual flow save/ACK/reopen with isolated repository I/O; no real orders'},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
