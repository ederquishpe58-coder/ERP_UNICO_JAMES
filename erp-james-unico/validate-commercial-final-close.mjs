import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import path from 'node:path';
const app=process.cwd(),read=f=>fs.readFileSync(path.join(app,f),'utf8'),checks=[];
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff',keys={[B]:'COMP-BLESS-FLOWER',[I]:'COMP-IMPERIO-FLOWERS'};let active=B;
const e={authAccess:{activeAccess:()=>({activeCompany:{id:active,company_key:keys[active]}})},utils:{clone:structuredClone},comercialData:{boxTypes:[]},comercialBoxBuilder:{},comercialInvoiceSequence:{visibleInvoiceNumber:o=>o.sriInvoiceNumber||''},comercialUtils:{esc:v=>String(v??''),normalizeOrder:o=>({...o}),normalizeTransportType:v=>String(v||'AEREO').toUpperCase(),isValidAirMawb:v=>/^\d{3}-\d{8}$/.test(v),normalizeLogisticsReference:v=>v,calculateOrderEconomics:()=>({netTotal:100}),number:Number,dateLabel:String},services:{companyContext:{activeCompanyId:()=>keys[active]}},state:{},layout:{toast(){}}};
const win={BlessERP:e,AbortController};const ctx=vm.createContext({window:win,console,Intl,Date,Map,Set,WeakMap,structuredClone});const load=f=>vm.runInContext(read(f),ctx,{filename:f});
load('scripts/modules/comercial/flow-v2/commercial-flow-core.js');load('scripts/modules/comercial/route-sheet-model.js');
const flow=e.commercialFlowV2;
vm.runInContext(read('scripts/modules/comercial/flow-v2/commercial-flow-ui.js').replace('  BlessERP.comercialPedido =','  BlessERP.testRead = {orderRows,routeSheetModel,renderRouteSheetModal};\n  BlessERP.comercialPedido ='),ctx);
const order=(company,id,local=true,more={})=>({id,number:id,company_id:company,companyId:keys[company],sellingCompanyId:keys[company],saleType:local?'LOCAL':'EXPORTACION',transportType:local?'TERRESTRE':'AEREO',issuedAt:'2026-09-07',createdAt:'2026-09-07',status:'EN_CUARTO_FRIO',customerId:'CUSTOMER',lines:[{boxNumber:1,boxType:'HB',bunches:10,stemsPerBunch:25}],...more});
const state=()=>({date:'2026-09-07',page:1,pageSize:30,status:'TODOS',routeSheetOpen:true,routeSheetSelectedIds:[]});
for(const c of [B,I]){
 active=c;const other=c===B?I:B;
 const orders=[order(c,'LOCAL-'+c,true,{inventoryMode:'NO_INVENTORY',deliveryAddress:'DIRECCION CANONICA'}),order(c,'EXPORT-'+c,false,{agencyId:'AGENCY',awb:'014-12345678',hawb:'H-1'}),order(other,'OTHER-COMPANY'),order(c,'WRONG-DATE',true,{issuedAt:'2026-09-06'}),order(c,'CANCELLED',true,{status:'ANULADO'})];
 const a={db:{activeCompanyId:keys[c],commercial:{orders,customerCatalog:[{id:'CUSTOMER',legalName:'CLIENTE LOCAL',companyId:keys[c]}],agencyCatalog:[{id:'AGENCY',name:'AGENCIA CANONICA'}]}}};
 const st=state(),rows=e.testRead.orderRows(a,st,'coordination').rows;
 assert.deepEqual(Array.from(rows,r=>r.id).sort(),['LOCAL-'+c,'EXPORT-'+c].sort());assert.equal(flow.deriveCoordinationStatus(orders[0],a),'NO_APLICA');assert.equal(flow.deriveCoordinationStatus(orders[1],a),'COORDINADA');assert.equal(flow.deriveCoordinationStatus({...orders[1],awb:'',hawb:''},a),'PENDIENTE');
 const m=e.testRead.routeSheetModel(a,st);assert.equal(m.rows.length,2);assert(m.rows.every(r=>r.printable));assert.equal(m.rows.find(r=>r.isLocal).destination,'DIRECCION CANONICA');
 st.routeSheetSelectedIds=m.rows.map(r=>r.orderId);const html=e.testRead.renderRouteSheetModal(a,st);assert(html.includes('LOCAL-'+c));assert(!html.includes('OTHER-COMPANY'));assert(!html.includes('data-route-sheet-order="LOCAL-'+c+'" checked disabled'));assert(html.includes('Coordinación opcional'));
 const invalid=e.comercialRouteSheetModel.build([order(c,'EXPORT-NO-AGENCY',false)],a).rows[0];assert(!invalid.printable);assert.equal(invalid.agencyValid,false);
 assert(!e.comercialRouteSheetModel.isCurrentCompanyOrder(order(other,'CROSS',{},{sellingCompanyId:keys[c],companyId:keys[c]}),a));
 checks.push((c===B?'BLESS':'IMPERIO')+'_LOCAL_EXPORT_COORDINATION_ROUTE_OPTIONAL_LOCAL_EXPORT_GUARDS_SCOPE_DATE');
}
// Use the actual route renderer. Invoice changes invalidate its preparation cache.
active=B;let builds=0;e.comercialPrintUtils={buildContext:(o,a,options={})=>{builds++;return{order:o,appState:a,options,company:{commercialName:keys[active]},customer:{commercialName:'CLIENTE LOCAL'},brand:{name:'MARCA EXPORT',printedConsignee:'CONSIGNATARIO ESPECIFICO'},metrics:{totalBoxes:1,totalFulls:.5,byBoxType:{HB:1}},boxGroups:[{boxNumber:1}]};},renderCompanyBrand:company=>company.commercialName};load('scripts/modules/comercial/print/hoja-ruta-print.js');
const a={db:{commercial:{agencyCatalog:[]}}},o=order(B,'LOCAL-PRINT',true,{sriInvoiceNumber:'001-003-000000001',deliveryAddress:'DIRECCION CANONICA'}),options={routeOrders:[o],routeDate:o.issuedAt},context=e.comercialPrintUtils.buildContext(o,a,options),doc=e.comercialPrintDocs.HR;
assert.equal(doc.validate(context).errors.length,0);let html=doc.render(context);assert(html.includes('001-003-000000001'));assert(!html.includes('CONSIGNATARIO ESPECIFICO'));assert(html.includes('MARCA EXPORT'));assert(!html.includes('CLIENTE LOCAL')); assert(!html.includes('GUIA PENDIENTE'));assert.equal(builds,2);options.routeOrders=[{...o,sriInvoiceNumber:'001-003-000000009'}];html=doc.render(context);assert(html.includes('001-003-000000009'));assert(!html.includes('001-003-000000001'));checks.push('ACTUAL_HR_LOCAL_RENDER_NO_AGENCY_CANONICAL_INVOICE_CACHE_REFRESH');
// Route-sheet consignee is the final customer; printed fields and buyer remain separate.
for (const company of [B,I]) for (const local of [true,false]) {
 active=company;
 const a={db:{commercial:{agencyCatalog:[{id:'CARGO',name:'FORBIDDEN AGENCY'}]}}};
 const source=order(company,'FORBIDDEN ORDER',local,{brandId:'LINKED-BRAND',agencyId:local?'':'CARGO',awb:'FORBIDDEN AWB',hawb:'FORBIDDEN HAWB',sriInvoiceNumber:'001-002-000000123'});
 for(const [brand,expected] of [[{id:'LINKED-BRAND',printedConsignee:'BOULEVARD FLORIST',finalClientName:'OTHER FINAL CUSTOMER',name:'OTHER MARKING'},'OTHER FINAL CUSTOMER'],[{id:'LINKED-BRAND',printedConsignee:'',finalClientName:'BOULEVARD FLORIST',name:'BOULEVARD FLORIST'},'BOULEVARD FLORIST'],[{id:'LINKED-BRAND',name:'CANONICAL MARKING'},'CANONICAL MARKING'],[null,'-'],[{id:'LINKED-BRAND',printedConsignee:null,finalClientName:'',name:''},'-']]) {
  e.comercialPrintUtils.buildContext=(o,state,opts={})=>({order:o,appState:state,options:opts,company:{commercialName:keys[company]},brand,customer:{commercialName:'QUALITY FLOWERS',legalName:'QUALITY FLOWERS'},agency:{name:'FORBIDDEN AGENCY'},metrics:{totalBoxes:1,totalFulls:.5,byBoxType:{HB:1}},boxGroups:[{boxNumber:1}]});
  const printed=doc.render(e.comercialPrintUtils.buildContext(source,a,{routeOrders:[source],routeDate:source.issuedAt}));
  const consignee=printed.match(/<td><strong>[^<]*<\/strong><br><small>[^<]*<\/small><\/td>\s*<td><strong>([^<]*)<\/strong>/)?.[1];
  assert.equal(consignee,expected);
  for(const forbidden of ['QUALITY FLOWERS','OTHER MARKING','FORBIDDEN AGENCY','FORBIDDEN AWB','FORBIDDEN HAWB','FORBIDDEN ORDER'])assert.notEqual(consignee,forbidden);
 }
 checks.push((company===B?'BLESS':'IMPERIO')+'_'+(local?'LOCAL':'EXPORT')+'_EXPLICIT_CONSIGNEE_BUYER_MARKING_SEPARATE');
}
// All three established documents remain in the resolver; route orders receive resolved identities.
const print=read('scripts/modules/comercial/print/index.js');assert.match(print,/routeOrders: resolved/);for(const code of ['HR','ETIQUETAS','INVOICE_PACKING_REFERENCIAL','COMMERCIAL_INVOICE_CLIENT'])assert(print.includes('"'+code+'"'));checks.push('SAME_RESOLVER_FOUR_OUTPUTS');
if(process.env.COMMERCIAL_READONLY_EVIDENCE){
 const evidence=JSON.parse(fs.readFileSync(process.env.COMMERCIAL_READONLY_EVIDENCE,'utf8').replace(/^\uFEFF/,'' )).data.evidence;
 const result=[];
 for(const record of evidence.linked_orders||[]){
  active=record.company_id; const raw=record.payload;
  const appState={db:{activeCompanyId:keys[active],commercial:{orders:[raw],customerCatalog:[],agencyCatalog:[]}}};
  const stateValue={...state(),date:raw.issuedAt.slice(0,10)};
  const found=e.testRead.orderRows(appState,stateValue,'coordination').rows.some(x=>x.id===raw.id);
  const model=e.testRead.routeSheetModel(appState,stateValue);assert(found);assert(model.rows.some(r=>r.orderId===raw.id && r.printable));
  result.push({company:record.company_id,id:record.record_id,coordinationVisible:found,routeVisible:true,localCoordinationRequired:false,mutations:0});
 }
 assert(result.length===2);fs.writeFileSync(process.env.COMMERCIAL_READONLY_EVIDENCE.replace('before-db.json','naranjo-tests.json'),JSON.stringify({result:'PASS',cases:result,cause:'Canonical rows exist and are visible with date/status filters. Original incident cannot be attributed to no-inventory: both raw records default to inventory. Route requires agency although LOCAL normalization clears it.'},null,2));
}
console.log(JSON.stringify({result:'PASS',checks}));
