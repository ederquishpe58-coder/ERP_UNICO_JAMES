const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const phase = process.argv[2] || "planned";
const base = JSON.parse(fs.readFileSync("output/sri-country-release/" + (phase==="planned"?"before":phase) + ".json"));
const plan = JSON.parse(fs.readFileSync("output/sri-country-release/plan.json"));
const companyId = "ab60abdc-fe53-4289-9ae2-8f749ee21cff";
const rows = structuredClone(base.countries);
if(phase==="planned") for(const row of rows){
 const match=plan.rows.find(r=>r.company_id===row.company_id&&r.record_id===row.record_id&&r.status==="ADD");
 if(match) row.payload.sriCountryCode=match.matches[0].code;
}
const ERP = {utils:{clone:structuredClone,uid:()=>{throw Error("Unexpected ID generation");}},
 getEnvConfig:()=>({supabaseEnabled:true}),comercialState:{getOrders:()=>[]},
 authAccess:{activeAccess:()=>({activeCompany:{id:companyId},session:{user:{id:"in-memory-actor"}}})},
 sriApi:{companyIdentity:()=>({companyId})},
 getSupabaseClient:()=>({
  rpc:async(name,args)=>{
   assert.equal(name,"erp_commercial_order_countries");assert.equal(args.p_company_id,companyId);
   return {data:{company_id:companyId,source:"commercial_countries",read_only:true,
    records:rows.filter(r=>r.company_id===companyId).map(r=>({id:r.record_id,name:r.payload.searchName||r.payload.name,
     legacy_name:r.payload.name,code:r.payload.code,iso2:r.payload.iso2,iso3:r.payload.iso3,active:true}))}};
  },
  from:table=>{
   assert.equal(table,"erp_entity_records");const filters={};
   return {select(){return this;},eq(k,v){filters[k]=v;return this;},is(){return this;},order(){return this;},
    async range(start,end){assert.equal(filters.company_id,companyId);return {data:rows.filter(r=>r.company_id===companyId).slice(start,end+1)};}};
  }
 })};
const box={BlessERP:ERP,console,structuredClone,setTimeout,clearTimeout,Intl,Date};box.window=box;
vm.createContext(box);
for(const name of ["comercial-data.js","comercial-utils.js","sri-order-queue-core.js"]){
 vm.runInContext(fs.readFileSync("scripts/modules/comercial/"+name,"utf8"),box);
}
for(const [entity,key] of [["commercial_customers","customers"],["commercial_brands","brands"],["commercial_agencies","agencies"]]){
 ERP.comercialData[key].splice(0,ERP.comercialData[key].length,...base.parties.filter(r=>r.entity===entity).map(r=>r.payload));
}
vm.runInContext(fs.readFileSync("scripts/repositories/comercial/order-country-catalog.js","utf8"),box);
vm.runInContext(fs.readFileSync("scripts/modules/comercial/sri-authorization.js","utf8")
 .replace(/    render,\r?\n/,"    localContext,\n    render,\n"),box);
(async()=>{
 await ERP.orderCountryCatalog.loadFiscal({});
 const order=base.orders.find(r=>r.record_id==="COM-DRAFT-gtnrqk-mttanusr").payload;
 const prior=JSON.stringify(order);
 const ctx=ERP.comercialSriAuthorization.localContext({},order);
 const result=ERP.comercialSriOrderQueueCore.buildInvoicePayload(ctx);
 assert.equal(result.ok,true,JSON.stringify(result.errors));
 assert.equal(result.payload.invoice.destinationCountryCode,"246");
 assert.equal(result.payload.erpEmission.transportType,"AEREO");
 assert.equal(JSON.stringify(order),prior);
 assert.equal(base.reservation[0].full_number,"001-002-000000748");
 assert.equal(base.reservation[0].status,"ACTIVE");
 assert.equal(base.reservation[0].consumed_document_id,null);
 const report=base.orders.filter(r=>!ERP.comercialSriOrderQueueCore.isLocalSale(r.payload)).map(r=>{
   const resolved=ERP.comercialSriOrderQueueCore.resolveDestinationCountry(r.payload,ctx.countries,companyId);
   return {order:r.payload.number,destination:r.payload.destinationCountry,ready:resolved.ok,reason:resolved.reason};
 });
 const summary={phase,referenceOrder:order.number,destination:order.destinationCountry,
   countryCode:result.payload.invoice.destinationCountryCode,reserved:base.reservation[0].full_number,
   checked:report.length,ready:report.filter(r=>r.ready).length,
   missing:report.filter(r=>!r.ready&&r.reason!=="COUNTRY_AMBIGUOUS").length,
   ambiguous:report.filter(r=>r.reason==="COUNTRY_AMBIGUOUS").length,
   needsReview:report.filter(r=>!r.ready)};
 fs.writeFileSync("output/sri-country-release/real-case-"+phase+".json",JSON.stringify(summary,null,2));
 console.log(JSON.stringify(summary,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
