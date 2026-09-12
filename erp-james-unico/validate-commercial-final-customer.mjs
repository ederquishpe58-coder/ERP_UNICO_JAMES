import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=f=>fs.readFileSync(f,'utf8'), checks=[];
const BLESS='cf331b82-7ac3-4065-9e38-d0bbcde96cd5', IMPERIO='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const keys={[BLESS]:'COMP-BLESS-FLOWER',[IMPERIO]:'COMP-IMPERIO-FLOWERS'};
let active=BLESS, route='commercial-order-history', rerenders=0, queryFailure='', wrongRecord=false, waitQuery=null, waitRpc=null, rpcCalls=[];
const clone=structuredClone;
const orders=[BLESS,IMPERIO].flatMap(company=>['LOCAL','EXPORTACION'].map((saleType,i)=>({id:`${company}-${i}`,number:`PED-COM-2026-000${i+1}`,company_id:company,companyId:keys[company],sellingCompanyId:keys[company],customerId:'COM-CLI-CE0005',brandId:'MAR0061',saleType,issuedAt:'2026-09-07',createdAt:'2026-09-07',status:'GUARDADO',discountPercentage:10,lines:[{boxNumber:1,boxType:'HB',bunches:1,stemsPerBunch:25,unitPrice:4}]})));
const reservationRecords=[];
const records=[BLESS,IMPERIO].flatMap(company=>[
 {company_id:company,entity:'commercial_customers',record_id:'COM-CLI-CE0005',payload:{companyId:keys[company],legalName:company===BLESS?'QUALITY FLOWERS':'IMPERIO CUSTOMER'},deleted_at:null},
 {company_id:company,entity:'commercial_brands',record_id:'MAR0061',payload:{companyId:keys[company],customerId:'COM-CLI-CE0005',finalClientName:company===BLESS?'BOULEVARD FLORIST':'IMPERIO FINAL',name:'NAME ALIAS',printedConsignee:'',printedMark:'',status:'ACTIVO'},deleted_at:null},
 ...orders.filter(o=>o.company_id===company).map(o=>({company_id:company,entity:'commercial_orders',record_id:o.id,payload:o,version:2,deleted_at:null}))]);
class Query {
 constructor(source=records){this.source=source;this.filters=[];this.start=0;this.end=Infinity;this.single=false;}
 select(){return this;} order(){return this;} abortSignal(){return this;}
 eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
 is(k,v){this.filters.push(r=>(r[k]??null)===v);return this;}
 range(a,b){this.start=a;this.end=b;return this;}
 maybeSingle(){this.single=true;return this;}
 async then(resolve,reject){try{
   let data=clone(this.source.filter(r=>this.filters.every(f=>f(r))).slice(this.start,this.end+1));
   const failure=queryFailure;
   if(wrongRecord&&data.length)data[0].company_id=IMPERIO;
   if(waitQuery){const wait=waitQuery;waitQuery=null;await wait;}
   return resolve({data:this.single?data[0]||null:data,error:failure?{message:failure}:null});
 }catch(e){return reject(e);}}
}
const client={from(table){assert.ok(['erp_entity_records','commercial_invoice_reservations'].includes(table));return new Query(table==='commercial_invoice_reservations'?reservationRecords:records);},async rpc(name,p){
 assert.equal(name,'erp_list_commercial_order_history','No writing/fiscal RPC allowed in tests');rpcCalls.push(clone(p));
 let rows=orders.filter(o=>o.company_id===p.p_company_id);
 if(p.p_date_from)rows=rows.filter(o=>o.issuedAt>=p.p_date_from&&o.issuedAt<=p.p_date_to);
 if(p.p_search){const needle=p.p_search.toUpperCase();rows=rows.filter(o=>o.number.toUpperCase().includes(needle)||(p.p_customer_matches||[]).includes(o.customerId)||(p.p_brand_matches||[]).includes(o.brandId));}
 const total=rows.length;rows=rows.slice((p.p_page-1)*p.p_page_size,p.p_page*p.p_page_size).map(o=>{const r=clone(o);delete r.lines;return {...r,__historyServerPage:true,_historyMetrics:{totalBoxes:1,totalUsd:100,totalBunches:1,totalStems:25}};});
 if(waitRpc){const wait=waitRpc;waitRpc=null;await wait;}
 return {data:{items:rows,total,page:p.p_page,pageSize:p.p_page_size,totalPages:Math.max(1,Math.ceil(total/p.p_page_size))},error:null};
}};
const E={utils:{clone,esc:v=>String(v??''),money:String,number:Number,today:()=> '2026-09-07',uid:p=>p+'-fixture'},authAccess:{activeAccess:()=>({activeCompany:{id:active}})},getEnvConfig:()=>({supabaseEnabled:true,authEnabled:true,incrementalSyncEnabled:true}),getSupabaseClient:()=>client,comercialInvoiceSequence:{},comercialBoxBuilder:{},services:{companyContext:{activeCompanyId:()=>keys[active]}},layout:{renderPage(){rerenders++;},toast(){}},state:{currentRoute:()=>({id:route})},moduleLoader:{loadGroup:async()=>({})}};
const events=new EventTarget();
const win={BlessERP:E,location:{protocol:'https:',hostname:'fixture.invalid'},AbortController,setTimeout:()=>0,addEventListener:events.addEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)};
const ctx=vm.createContext({window:win,console,Intl,Date,URL,URLSearchParams,AbortController,CustomEvent,setTimeout,clearTimeout,performance});
const load=f=>vm.runInContext(read(f),ctx,{filename:f});
for(const f of ['scripts/modules/comercial/comercial-data.js','scripts/modules/comercial/comercial-utils.js','scripts/modules/comercial/flow-v2/commercial-flow-core.js','scripts/repositories/comercial/commercial-order-repository.js','scripts/repositories/comercial/commercial-fiscal-reservation-read.js','scripts/repositories/comercial/commercial-history-read.js','scripts/modules/comercial/flow-v2/commercial-flow-ui.js','scripts/modules/comercial/flow-v2/history-controller.js'])load(f);
const app={db:{activeCompanyId:keys[active],commercial:{orders:[],customerCatalog:[],brandCatalog:[]}}}; E.state.state=app;
const R=E.commercialHistoryRead,F=E.commercialFlowV2;
const filters=()=>({date:'',search:'',market:'TODOS',page:1,pageSize:20});
const check=async(name,fn)=>{await fn();checks.push(name);};
await check('Cold canonical history and names, empty frontend catalogs',async()=>{await R.load(app,filters());assert.equal(R.state(app).rows.length,2);assert.equal(R.name(app,'customers','COM-CLI-CE0005'),'QUALITY FLOWERS');assert.equal(R.name(app,'brands','MAR0061'),'BOULEVARD FLORIST');assert.equal(app.db.commercial.orders.length,0);});
await check('Actual history renders canonical buyer/final customer and summary net total',()=>{Object.assign(F.sessionFor(app).history,filters());const html=E.comercialHistory.render(app);assert(html.includes('QUALITY FLOWERS'));assert(html.includes('BOULEVARD FLORIST'));assert(html.includes('90,00')||html.includes('90.00'));});
await check('Search BOULEVARD, buyer and order number use existing RPC',async()=>{for(const search of ['BOULEVARD','QUALITY','PED-COM']){await R.load(app,{...filters(),search});assert.equal(R.state(app).rows.length,2);}assert(rpcCalls.some(p=>p.p_search==='BOULEVARD'&&p.p_brand_matches.includes('MAR0061')));});
await check('Partial catalog never clears canonical brandId',()=>{E.comercialData.customers.splice(0);E.comercialData.brands.splice(0);assert.equal(E.comercialUtils.normalizeOrder(orders[0]).brandId,'MAR0061');});
await check('Full order required before edit/print; no writes',async()=>{const order=await R.fullOrder(app,orders[0].id);assert.equal(order.brandId,'MAR0061');assert.equal(order.lines.length,1);assert.equal(app.db.commercial.orders.length,1);});
await check('Refresh and inactive historical reference remain stable',async()=>{R.invalidate();records.find(r=>r.company_id===BLESS&&r.entity==='commercial_brands').payload.status='INACTIVO';await R.load(app,filters());assert.equal(R.name(app,'brands','MAR0061'),'BOULEVARD FLORIST');});
await check('Historical dates use same canonical reference',async()=>{orders[0].issuedAt='2025-01-01';await R.load(app,{...filters(),date:'2025-01-01'});assert.equal(R.state(app).rows.length,1);assert.equal(R.name(app,'brands',R.state(app).rows[0].brandId),'BOULEVARD FLORIST');orders[0].issuedAt='2026-09-07';});
for(const company of [BLESS,IMPERIO]) for(const market of ['LOCAL','EXPORTACION']) await check(`${keys[company]} ${market} company-scoped canonical history`,async()=>{active=company;app.db.activeCompanyId=keys[company];await R.load(app,{...filters(),market});assert.equal(R.state(app).rows.length,1);assert.equal(R.state(app).rows[0].company_id,company);assert.equal(R.name(app,'brands','MAR0061'),company===BLESS?'BOULEVARD FLORIST':'IMPERIO FINAL');});
active=BLESS;app.db.activeCompanyId=keys[active];
await check('Server/reference failure visible, no cached false success',async()=>{queryFailure='NETWORK FIXTURE';R.invalidate();await R.load(app,filters());assert.equal(R.state(app).rows.length,0);assert.equal(R.state(app).error,'NETWORK FIXTURE');assert.equal(R.state(app).loading,false);queryFailure='';});
await check('Cross-company reference response blocked',async()=>{wrongRecord=true;R.invalidate();await R.load(app,filters());assert(R.state(app).error.includes('empresa'));assert.equal(R.state(app).rows.length,0);wrongRecord=false;});
await check('Missing reference keeps ID with empty display',async()=>{const brand=records.find(r=>r.company_id===BLESS&&r.entity==='commercial_brands');brand.deleted_at='2026-09-07';R.invalidate();await R.load(app,filters());assert.equal(R.state(app).rows[0].brandId,'MAR0061');assert.equal(R.name(app,'brands','MAR0061'),'-');brand.deleted_at=null;});
await check('Company change drops delayed response',async()=>{let release;waitQuery=new Promise(r=>release=r);R.invalidate();const pending=R.load(app,filters());await new Promise(r=>setImmediate(r));active=IMPERIO;app.db.activeCompanyId=keys[active];await R.load(app,filters());release();await pending;assert.equal(R.state(app).uuid,IMPERIO);assert(R.state(app).rows.every(o=>o.company_id===IMPERIO));});
active=BLESS;app.db.activeCompanyId=keys[active];
await check('Search response ordering drops obsolete page',async()=>{await R.references(app);let release;waitRpc=new Promise(r=>release=r);const old=R.load(app,filters());await new Promise(r=>setImmediate(r));await R.load(app,{...filters(),search:'NO MATCH'});release();await old;assert.equal(R.state(app).rows.length,0);});
await check('Late catalog event rerenders without duplicate listeners',async()=>{const container=new EventTarget();container.isConnected=true;Object.assign(F.sessionFor(app).history,filters());R.invalidate();await R.load(app,filters());E.comercialHistory.bind(container,app);E.comercialHistory.bind(container,app);const before=rerenders;const brand=records.find(r=>r.company_id===BLESS&&r.entity==='commercial_brands');brand.payload.finalClientName='BOULEVARD UPDATED';events.dispatchEvent(new CustomEvent('erp:domain-loaded',{detail:{domain:'commercial-catalog'}}));assert.equal(rerenders,before+1);await R.load(app,filters());assert.equal(R.name(app,'brands','MAR0061'),'BOULEVARD UPDATED');brand.payload.finalClientName='BOULEVARD FLORIST';R.invalidate();await R.load(app,filters());});
await check('Hoja de Ruta uses canonical final customer despite empty printed fields and stale mirrors',async()=>{load('scripts/modules/comercial/route-sheet-model.js');E.comercialPrintUtils={buildContext:(o,a,options={})=>({order:o,appState:a,options,company:{commercialName:keys[active]},brand:{finalClientName:'STALE MIRROR',printedConsignee:'DO NOT USE'},customer:{legalName:'QUALITY FLOWERS'},metrics:{byBoxType:{HB:1},totalBoxes:1,totalFulls:.5},boxGroups:[{boxNumber:1}]}),renderCompanyBrand:c=>c.commercialName};load('scripts/modules/comercial/print/hoja-ruta-print.js');for(const company of [BLESS,IMPERIO])for(const market of ['LOCAL','EXPORTACION']){active=company;app.db.activeCompanyId=keys[company];await R.references(app);app.db.commercial.agencyCatalog=[{id:'CARGO',name:'CARGO'}];const o={...orders.find(o=>o.company_id===company&&o.saleType===market),agencyId:market==='LOCAL'?'':'CARGO',sriInvoiceNumber:'001-002-000000123'};const html=E.comercialPrintDocs.HR.render(E.comercialPrintUtils.buildContext(o,app,{routeOrders:[o]}));assert(html.includes(company===BLESS?'BOULEVARD FLORIST':'IMPERIO FINAL'));assert(!html.includes('STALE MIRROR'));assert(!html.includes('DO NOT USE'));}});
await check('History renders canonical reserved number without hydrating order or altering print sources',async()=>{
 active=BLESS;app.db.activeCompanyId=keys[active];
 reservationRecords.push({id:'fixture-reservation',company_id:BLESS,record_id:orders[0].id,environment:'PRODUCTION',document_type:'01',status:'ACTIVE',full_number:'001-002-000000781'});
 R.invalidate();await R.load(app,filters());Object.assign(F.sessionFor(app).history,filters());
 const html=E.comercialHistory.render(app);assert(html.includes('001-002-000000781 (PRODUCTION; RESERVADO)'));assert.equal(orders[0].sriInvoiceNumber,undefined);
 reservationRecords.length=0;
});
await check('Printed fields and business records unchanged by readers',()=>{assert(records.filter(r=>r.entity==='commercial_brands').every(r=>r.payload.printedConsignee===''&&r.payload.printedMark===''));assert(rpcCalls.every(p=>p.p_company_id===BLESS||p.p_company_id===IMPERIO));});
await check('History-only controller and existing route byte budgets',()=>{
 const tags=[...read('index.html').matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)].map(m=>({attrs:m[1],src:m[2].split('?')[0]}));
 const group=name=>tags.filter(t=>String(t.attrs.match(/data-jaeder-lazy-group=["']([^"']+)["']/i)?.[1]||'').split(/\s+/).includes(name));
 const bytes=rows=>rows.reduce((sum,t)=>sum+fs.statSync(t.src).size,0);
 for(const name of ['commercial-history','commercial-order-tracking','commercial-availability'])assert(bytes(group(name))<bytes(group('commercial'))*.22);
 assert(group('commercial-history').some(t=>t.src.endsWith('/history-controller.js')));
 assert(!group('commercial-order-tracking').some(t=>t.src.endsWith('/history-controller.js')));
});
console.log(JSON.stringify({result:'PASS',checks,tests:checks.length,realNetworkCalls:0,businessMutations:0,sequenceChanges:0,sriTransmissions:0}));
