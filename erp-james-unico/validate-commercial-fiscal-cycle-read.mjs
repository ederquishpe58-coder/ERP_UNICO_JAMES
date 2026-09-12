import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {listDocuments} = createRequire(import.meta.url)('./api/sri/_lib/document-service.cjs');

// Real browser modules with a read-only PostgREST fixture. No server URL/session.
globalThis.fetch = async () => { throw Error('REAL_NETWORK_FORBIDDEN'); };
const BASE = 'e041f24df47f4f4467664ab6f4f7c7fe5c72a9d4';
const readerPath = 'scripts/repositories/comercial/commercial-fiscal-reservation-read.js';
const historyPath = 'scripts/repositories/comercial/commercial-history-read.js';
const sriPath = 'scripts/modules/comercial/sri-authorization.js';
const read = file => fs.readFileSync(file, 'utf8');
const old = file => execFileSync('git', ['show', `${BASE}:erp-james-unico/${file}`], {encoding:'utf8'});
const clone = value => JSON.parse(JSON.stringify(value));
const C = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const checks = [];
async function test(name, run) { await run(); checks.push({name, result:'PASS'}); }
function fixture({previous = false} = {}) {
  const reservations = [], entities = [], fiscalDocuments = [], queries = [], writes = [];
  let activeCompany = C, fail = false, leak = false;
  const appState = {db:{activeCompanyId:'COMP-BLESS-FLOWER',authAccess:{activeCompanyUuid:C}, commercial:{orders:[]}}};
  function query(table) {
    const filters = [], request = {table,filters,offset:0,end:Infinity}; queries.push(request);
    const q = {
      select(fields) {request.fields=fields;return q;}, eq(k,v) {filters.push(['eq',k,v]);return q;},
      in(k,v) {filters.push(['in',k,v]);return q;}, is(k,v) {filters.push(['is',k,v]);return q;},
      gte(k,v) {filters.push(['gte',k,v]);return q;}, lte(k,v) {filters.push(['lte',k,v]);return q;},
      order(k) {request.sort=k;return q;}, range(a,b) {request.offset=a;request.end=b;return q;},
      async then(resolve,reject) {
        try {
          if(fail) return resolve({error:{message:'READ_DENIED'}});
          let rows=table==='commercial_invoice_reservations'?reservations:table==='erp_entity_records'?entities:table==='electronic_documents'?fiscalDocuments:null;
          assert.ok(rows, `Unexpected table ${table}`);
          rows=rows.filter(row=>filters.every(([op,k,v])=>op==='in'?v.includes(row[k]):op==='gte'?Date.parse(row[k])>=Date.parse(v):op==='lte'?Date.parse(row[k])<=Date.parse(v):op==='is'?(row[k]??null)===v:row[k]===v));
          if(request.sort) rows=[...rows].sort((a,b)=>String(a[request.sort]).localeCompare(String(b[request.sort])));
          rows=clone(rows.slice(request.offset,request.end+1));
          if(leak&&rows.length) rows[0].company_id=OTHER;
          return resolve({data:rows});
        } catch(e){return reject(e);}
      }
    };
    return q;
  }
  const mutation = name => () => {writes.push(name);throw Error(`BUSINESS_WRITE_FORBIDDEN:${name}`);};
  const B = {
    authAccess:{activeAccess:()=>({activeCompany:{id:activeCompany}})},getSupabaseClient:()=>({from:query,rpc:mutation('rpc')}),
    comercialUtils:{esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
      money:v=>Number(v||0).toFixed(2),dateLabel:v=>v,getOrderMetrics:()=>({totalUsd:10})},
    comercialState:{getOrders:()=>appState.db.commercial.orders,getCustomerCatalog:()=>[],getBrandCatalog:()=>[],
      syncSriDocument:mutation('syncSriDocument'),syncSriCreditNote:mutation('syncSriCreditNote')},
    commercialFlowV2:{activeCompanyId:()=>appState.db.activeCompanyId},
    sriApi:{activeCompanyKey:()=> 'BLESS_FLOWER',companyKeyForReference:()=> 'BLESS_FLOWER',
      activeCompany:()=>({key:'BLESS_FLOWER',companyId:activeCompany}),status:()=>({ready:true}),
      orderCompanyKey:()=> 'BLESS_FLOWER',configuration:async()=>({settings:{company_id:activeCompany,environment:'PRODUCTION'}}),
      environmentDefinition:environment=>({label:environment}),list:async()=>[],post:mutation('api.post'),detail:mutation('detail-on-refresh')}
  };
  B.getCommercialOrderRepository=()=>({canListPage:()=>true,listPage:async(options,page)=>({
    ok:true,companyId:activeCompany,items:entities.filter(r=>r.entity==='commercial_orders'&&r.company_id===activeCompany).map(r=>({...r.payload,id:r.record_id,company_id:r.company_id})),total:entities.filter(r=>r.entity==='commercial_orders').length,totalPages:1
  })});
  const context={window:{BlessERP:B},console,Date,Set,Map,Intl,structuredClone,fetch:globalThis.fetch};
  vm.createContext(context);
  for(const file of ['scripts/modules/comercial/sri-order-queue-core.js','scripts/services/sri/fiscal-date.js',readerPath]) {
    vm.runInContext(read(file),context,{filename:file});
  }
  // Expose closures only in the harness; shipped public API stays unchanged.
  const sriSource=(previous?old(sriPath):read(sriPath)).replace('  BlessERP.comercialSriAuthorization = {',
    '  BlessERP.__trace = {ui, remoteRows, allRows, renderDocumentInlineActions};\n  BlessERP.comercialSriAuthorization = {');
  vm.runInContext(sriSource,context,{filename:sriPath});
  vm.runInContext(previous?old(historyPath):read(historyPath),context,{filename:historyPath});
  return {B,appState,reservations,entities,fiscalDocuments,queries,writes,context,
    switchCompany:()=>{activeCompany=OTHER;appState.db.activeCompanyId='COMP-IMPERIO-FLOWERS';},
    fail:()=>{fail=true;},leak:()=>{leak=true;}};
}
function addCycle(f,seq=781,overrides={}) {
  const orderId=`ORDER-${seq}`, id=`RES-${seq}`;
  const row={id,company_id:C,environment:'PRODUCTION',document_type:'01',record_id:orderId,status:'ACTIVE',
    full_number:`001-002-${String(seq).padStart(9,'0')}`,sequential:seq,establishment_code:'001',emission_point_code:'002',
    consumed_document_id:null,created_at:'2026-09-12T01:00:00Z',...overrides};
  f.reservations.push(row);
  const order={number:`PED-${seq}`,brandId:`BRAND-${seq}`,customerId:`BUYER-${seq}`,issuedAt:'2026-09-11',saleType:'EXPORTACION',transportType:'AEREO'};
  for(const [entity,record_id,payload] of [['commercial_orders',row.record_id,order],['commercial_brands',order.brandId,{name:`MARK-${seq}`,finalClientName:`FINAL-${seq}`}],['commercial_customers',order.customerId,{legalName:`PRINCIPAL-${seq}`}]] ) {
    f.entities.push({company_id:row.company_id,entity,record_id,payload,deleted_at:null});
  }
  return row;
}
const options={companyId:C,environment:'PRODUCTION',from:'2026-09-01',to:'2026-09-30'};
const filters={page:1,pageSize:20,market:'TODOS',date:'',search:''};
function document(seq,status='AUTORIZADO') {
  return {id:`DOC-${seq}`,company_id:C,environment:'PRODUCTION',document_type:'01',status,
    full_number:`001-002-${String(seq).padStart(9,'0')}`,issue_date:'2026-09-11',source_order_id:null,
    buyer_snapshot:{legalName:`PRINCIPAL-${seq}`},additional_information:{MARCACION:`FINAL-${seq}`},
    source_snapshot:{erpEmission:{sourceOrderId:`ORDER-${seq}`,sourceOrderNumber:`PED-${seq}`},additionalInformation:{MARCACION:`FINAL-${seq}`}}};
}

await test('Negative controls: original history omits reservation; original mapper drops persisted MARCACION',async()=>{
  const f=fixture({previous:true});addCycle(f);
  await f.B.commercialHistoryRead.load(f.appState,filters);
  assert.equal(f.B.commercialHistoryRead.state(f.appState).rows[0]._fiscalReservations,undefined);
  f.B.__trace.ui.remoteDocuments=[document(748)];
  assert.equal(f.B.__trace.remoteRows(f.appState)[0].brand,'-');
});
await test('No reservation: history read consumes nothing',async()=>{
  const f=fixture();addCycle(f);f.reservations.length=0;
  await f.B.commercialHistoryRead.load(f.appState,filters);
  assert.equal(f.B.commercialHistoryRead.state(f.appState).rows[0]._fiscalReservations.length,0);
  assert.equal(f.writes.length,0);
});
await test('History 781, ten refreshes, display-only DTO and immutable source',async()=>{
  const f=fixture();addCycle(f);const before=JSON.stringify([f.reservations,f.entities,f.appState]);
  for(let i=0;i<10;i++) {
    f.B.commercialHistoryRead.invalidate();await f.B.commercialHistoryRead.load(f.appState,filters);
    const page=f.B.commercialHistoryRead.state(f.appState);
    assert.equal(page.error,'');assert.match(f.B.commercialFiscalReservationRead.historyLabel(page.rows[0]._fiscalReservations),/001-002-000000781 \(PRODUCTION; RESERVADO\)/);
    assert.equal(page.rows[0].sriInvoiceNumber,undefined);
  }
  assert.equal(JSON.stringify([f.reservations,f.entities,f.appState]),before);assert.equal(f.writes.length,0);
});
await test('Reservation before fiscal document, canonical brand, principal separate, read-only row and exact full number',async()=>{
  const f=fixture();addCycle(f);
  const ui=f.B.__trace.ui;ui.issueYear='2026';ui.issueMonth='9';
  await f.B.comercialSriAuthorization.refresh({isConnected:false},f.appState);
  assert.equal(ui.error,'');const rows=f.B.__trace.allRows(f.appState);
  assert.equal(rows.length,1);assert.equal(rows[0].documentNumber,'001-002-000000781');
  assert.equal(rows[0].authorizationStatus,'RESERVADO / SIN DOCUMENTO');assert.equal(rows[0].brand,'FINAL-781');
  assert.equal(rows[0].customer,'PRINCIPAL-781');assert.equal(rows[0].remoteDocumentId,'');
  assert.equal(rows[0].processable,false);assert.equal(rows[0].selectable,false);assert.equal(rows[0].issueDate,'');
  const html=f.B.comercialSriAuthorization.render(f.appState);
  assert.match(html,/<strong class="sri-document-number[^>]*>001-002-000000781<\/strong>/);assert.match(html,/FINAL-781/);assert.match(html,/Reserva; sin fecha de emision/);
  assert.doesNotMatch(f.B.__trace.renderDocumentInlineActions(rows[0]),/<button/);assert.equal(f.writes.length,0);
});
await test('Reservation and created/authorized document: one canonical cycle; identity unchanged by mapping',async()=>{
  const f=fixture();addCycle(f);const ui=f.B.__trace.ui;ui.remoteReservations=await f.B.commercialFiscalReservationRead.pending(options);
  for(const status of ['BORRADOR','AUTORIZADO']) {
    const d=document(781,status),before=JSON.stringify(d);ui.remoteDocuments=[d];
    const rows=f.B.__trace.allRows(f.appState);assert.equal(rows.length,1);
    assert.equal(rows[0].documentNumber,'001-002-000000781');assert.equal(rows[0].brand,'FINAL-781');assert.equal(JSON.stringify(d),before);
  }
});
await test('748/749/750: API DTO -> actual mapper -> rendered table retains persisted final customer without local catalog',async()=>{
  const f=fixture(),ui=f.B.__trace.ui;ui.issueYear='2026';ui.issueMonth='9';
  f.fiscalDocuments.push(...[748,749,750].map(seq=>document(seq)));
  f.B.sriApi.list=input=>listDocuments(f.B.getSupabaseClient(),C,input);
  ui.remoteDocuments=await f.B.comercialSriAuthorization.listCommercialSriDocuments({from:'2026-09-01',to:'2026-09-30'});
  ui.remoteDocuments.sort((a,b)=>a.full_number.localeCompare(b.full_number));
  const before=JSON.stringify(ui.remoteDocuments),rows=f.B.__trace.remoteRows(f.appState);
  rows.forEach((row,i)=>{assert.equal(row.brand,`FINAL-${748+i}`);assert.equal(row.customer,`PRINCIPAL-${748+i}`);});
  const html=f.B.comercialSriAuthorization.render(f.appState);[748,749,750].forEach(seq=>assert.match(html,new RegExp(`FINAL-${seq}`)));
  assert.equal(JSON.stringify(ui.remoteDocuments),before);
});
await test('Snapshot fallback preserved; absent final customer remains dash, never substituted by buyer',async()=>{
  const f=fixture(),d=document(748);d.additional_information={};f.B.__trace.ui.remoteDocuments=[d];
  assert.equal(f.B.__trace.remoteRows(f.appState)[0].brand,'FINAL-748');
  d.source_snapshot.additionalInformation={};assert.equal(f.B.__trace.remoteRows(f.appState)[0].brand,'-');
});
await test('Different orders, company, TEST/PRODUCTION and LOCAL/EXPORT preserve independent reservation identities',async()=>{
  const f=fixture();addCycle(f);addCycle(f,782,{emission_point_code:'003',full_number:'001-003-000000782'});
  addCycle(f,783,{company_id:OTHER});addCycle(f,784,{environment:'TEST'});
  const rows=await f.B.commercialFiscalReservationRead.pending(options);
  assert.deepEqual(clone(rows.map(r=>r.full_number)),['001-002-000000781','001-003-000000782']);
  const testRows=await f.B.commercialFiscalReservationRead.list({...options,environment:'TEST'});
  assert.equal(testRows.length,1);assert.equal(testRows[0].sequential,784);
  await assert.rejects(f.B.commercialFiscalReservationRead.list({...options,companyId:OTHER}),/empresa cambio/);
});
await test('Ambiguous reservation links remain visible for review, never choose a first number',async()=>{
  const f=fixture();const r=addCycle(f);f.reservations.push({...r,id:'SECOND',full_number:'001-002-000000999'});
  const rows=await f.B.commercialFiscalReservationRead.pending(options);assert.ok(rows.every(r=>r.requiresReview));
  assert.match(f.B.commercialFiscalReservationRead.historyLabel(rows),/REQUIERE REVISION/);
});
await test('Consumed reservations do not become pre-document rows; empty page makes no reservation request',async()=>{
  const f=fixture();addCycle(f,781,{status:'CONSUMED',consumed_document_id:'DOC-781'});
  assert.equal((await f.B.commercialFiscalReservationRead.pending(options)).length,0);
  f.queries.length=0;await f.B.commercialFiscalReservationRead.list({companyId:C,orderIds:[]});assert.equal(f.queries.length,0);
});
await test('Server pagination, batch enrichment, month filters and UI pagination retain final customer',async()=>{
  const f=fixture();for(let seq=1;seq<=205;seq++)addCycle(f,seq);
  addCycle(f,500,{created_at:'2026-08-10T12:00:00Z'});
  const rows=await f.B.commercialFiscalReservationRead.pending(options);assert.equal(rows.length,205);
  assert.ok(rows.every(r=>r.brand.finalClientName));assert.equal(f.queries.filter(q=>q.table==='commercial_invoice_reservations').length,2);
  assert.ok(f.queries.length<20,'Batch reads, not N+1');
  const ui=f.B.__trace.ui;ui.remoteReservations=rows;ui.issueYear='2026';ui.issueMonth='9';
  f.B.performance={paginate:items=>({items:items.slice(50,100),total:items.length})};
  const html=f.B.comercialSriAuthorization.render(f.appState);assert.match(html,/FINAL-/);
  const filtered=f.B.comercialSriAuthorization.filterAndSortDocumentRows(f.B.__trace.allRows(f.appState),{...f.B.comercialSriAuthorization.currentDocumentListFilters(),search:'FINAL-205'},f.B.comercialSriAuthorization.selectedIssueMonthRange());
  assert.equal(filtered.length,1);assert.equal(filtered[0].brand,'FINAL-205');
});
await test('Read errors/cross-company responses fail visibly, not empty success',async()=>{
  const f=fixture();addCycle(f);f.fail();const ui=f.B.__trace.ui;ui.issueYear='2026';ui.issueMonth='9';
  await f.B.comercialSriAuthorization.refresh({isConnected:false},f.appState);assert.match(ui.error,/READ_DENIED/);assert.equal(ui.loaded,false);
  const g=fixture();addCycle(g);g.leak();await assert.rejects(g.B.commercialFiscalReservationRead.pending(options),/ambito solicitado/);
});
await test('Refresh with authorized invoice never calls fiscal detail/sync/save or mutates order',async()=>{
  const f=fixture(),ui=f.B.__trace.ui;ui.issueYear='2026';ui.issueMonth='9';
  f.appState.db.commercial.orders.push({id:'ORDER-748',number:'PED-748',saleType:'EXPORTACION',issuedAt:'2026-09-11'});
  f.B.sriApi.list=async input=>input.documentType==='01'?[document(748)]:[];
  const before=JSON.stringify(f.appState);
  for(let i=0;i<10;i++)await f.B.comercialSriAuthorization.refresh({isConnected:false},f.appState);
  assert.equal(ui.error,'');assert.equal(f.writes.length,0);assert.equal(JSON.stringify(f.appState),before);
});
await test('Late response after company switch is discarded',async()=>{
  const f=fixture(),ui=f.B.__trace.ui;ui.issueYear='2026';ui.issueMonth='9';let release;
  f.B.sriApi.configuration=()=>new Promise(resolve=>{release=resolve;});
  const pending=f.B.comercialSriAuthorization.refresh({isConnected:false},f.appState);
  await new Promise(resolve=>setImmediate(resolve));f.switchCompany();ui.companyKey='IMPERIO_FLOWERS';
  release({settings:{company_id:C,environment:'PRODUCTION'}});await pending;
  assert.equal(ui.remoteDocuments.length,0);assert.equal(ui.remoteReservations.length,0);assert.equal(f.writes.length,0);
});
console.log(JSON.stringify({result:'PASS',groups:checks.length,checks,realNetwork:0,realBusinessWrites:0,scope:'Actual JS reader, mapper, history load, render and refresh; PostgREST transport fixture, not a live user session or fiscal creation test.'},null,2));
export {fixture, addCycle, document};
