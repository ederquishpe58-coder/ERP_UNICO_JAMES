import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

// PGlite is always ephemeral. This test never reads database URLs or credentials.
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(path.resolve(process.env.PGLITE_MODULE)).href : '@electric-sql/pglite');
const db = new PGlite();
const company = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const unrelated = '00000000-0000-0000-0000-000000000003';
const unmapped = '00000000-0000-0000-0000-000000000004';
const date = '2026-09-10';
const file = 'scripts/modules/operaciones/inventario-proveedores-report-xlsx.js';
const sql = (await fs.readFile('supabase/migrations/202609120001_supplier_inventory_report_reconciliation.sql', 'utf8')).replaceAll('\r\n','\n');
await db.exec(`create schema auth;
create function auth.uid() returns uuid language sql as $$select '${company}'::uuid$$;
create function erp_is_company_member(uuid,uuid) returns boolean language sql as $$select $1 = '${company}'::uuid$$;
create table erp_entity_records(company_id uuid,entity text,record_id text,payload jsonb,created_at timestamptz default now(),deleted_at timestamptz,primary key(company_id,entity,record_id));`);
await assert.rejects(db.exec(sql), /SUPPLIER_REPORT_INTERNAL_DEPENDENCY_MISSING/);
await db.exec('rollback');
const signature='erp_operations_v2_supplier_inventory_report_u2c3_internal(uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer)';
const installed=JSON.parse(await fs.readFile('test-fixtures/supplier-report-installed-20260912.json','utf8'));
await db.exec(`create role authenticated; create role service_role;
create table companies(id uuid primary key,company_key text,metadata jsonb,is_active boolean);
create function erp_security_assert_capability(uuid,text) returns void language plpgsql as $$begin
  if not erp_is_company_member($1,auth.uid()) or $2 <> 'operations.inventory.view' then raise exception 'CAPABILITY_DENIED'; end if;
end;$$;`);
await db.query('insert into companies values($1,$2,$3,true),($4,$5,$6,true),($7,$8,$9,true),($10,$11,$12,true)',[
  company,'BLESS',JSON.stringify({inventory_owner:true}),
  other,'IMPERIO',JSON.stringify({inventory_owner:false,availability_source_company_key:'BLESS'}),
  unrelated,'INDEPENDENT',JSON.stringify({inventory_owner:true}),
  unmapped,'NO_POOL',JSON.stringify({inventory_owner:false})]);
for (const fn of installed.functions) await db.exec(fn.definition);
const wrapperSignature=signature.replace('_u2c3_internal','');
await db.exec(`revoke all on function ${signature} from public;
revoke all on function ${wrapperSignature} from public; grant execute on function ${wrapperSignature} to authenticated;
revoke all on function erp_inventory_pool_company(uuid) from public; grant execute on function erp_inventory_pool_company(uuid) to service_role;`);
const acl=async()=>JSON.stringify((await db.query('select oid,proacl,proowner from pg_proc where oid in ($1::regprocedure,$2::regprocedure,$3::regprocedure) order by oid',[signature,wrapperSignature,'erp_inventory_pool_company(uuid)'])).rows);
const aclBefore=await acl();
const appliedSql=process.env.SUPPLIER_NEGATIVE_CONTROL === '1'
  ? sql.replace('delivered_stems - (inventory_stems + national_stems) as mismatch', 'inventory_stems + national_stems - delivered_stems as mismatch')
  : process.env.SUPPLIER_POOL_NEGATIVE_CONTROL === '1'
    ? sql.replace('v_source_company_id := public.erp_inventory_pool_company(p_company_id);','v_source_company_id := p_company_id;')
    : sql;
await db.exec(appliedSql);
await db.exec(appliedSql);
assert.equal(await acl(),aclBefore);
const installedWrapper=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[wrapperSignature])).rows[0].definition;
assert.equal(installedWrapper,installed.functions.find(f=>f.signature===wrapperSignature).definition);
const put = (entity, id, payload, scope = company) => db.query(
  'insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',
  [scope, entity, id, JSON.stringify(payload)]);
const report = async (scope = company) => (await db.query(
  'select erp_operations_v2_supplier_inventory_report_u2c3_internal($1,$2::date,$2::date) r', [scope, date])).rows[0].r;
const snapshot = async () => JSON.stringify((await db.query('select * from erp_entity_records order by company_id,entity,record_id')).rows);
const catalog = {id:'BQ0004',code:'BQ0004',name:'Finca',assignedBlocks:['B4','B5']};
let activeReport;
const window = { BlessERP: {
  operacionesState:{getStore:s=>s.db.operations,getUi:s=>s.db.operations.ui},
  operacionesUtils:{esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),number:n=>String(n??0)},
  getSupplierInventoryReportQueryRepository:()=>({queryPage:async()=>activeReport})
}, addEventListener(){} };
const context = {window,console,setTimeout,clearTimeout,TextEncoder,Uint8Array,performance:{now:()=>0}};
for (const source of ['scripts/core/flower-quality.js','scripts/modules/operaciones/bunch-label-codec.js','scripts/modules/operaciones/ramos-report-xlsx.js',file]) {
  vm.runInNewContext(await fs.readFile(source,'utf8'),context,{filename:source});
}
const api = window.BlessERP.operacionesInventarioProveedoresReport;
let referenceApi;
if (process.env.LUNA_REFERENCE_REPORT) {
  const referenceWindow={BlessERP:{...window.BlessERP},addEventListener(){}};
  vm.runInNewContext(await fs.readFile(process.env.LUNA_REFERENCE_REPORT,'utf8'),{...context,window:referenceWindow});
  referenceApi=referenceWindow.BlessERP.operacionesInventarioProveedoresReport;
}
const resolverStore = {companyId:company,masterData:{suppliers:[catalog]}};
const cases = [];
function workbookEntries(archive) {
  const entries=new Map(), view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength);
  for(let offset=0;offset+4<archive.length && view.getUint32(offset,true)===0x04034b50;) {
    const size=view.getUint32(offset+18,true), names=view.getUint16(offset+26,true), extra=view.getUint16(offset+28,true);
    const start=offset+30+names+extra;
    entries.set(new TextDecoder().decode(archive.slice(offset+30,offset+30+names)),new TextDecoder().decode(archive.slice(start,start+size)));
    offset=start+size;
  }
  return entries;
}
async function fixture(physical, national) {
  await db.exec('truncate erp_entity_records');
  await put('operations_suppliers',catalog.id,catalog);
  const store = {companyId:company,masterData:{suppliers:[catalog]},ui:{},classifierAssignments:[],classificationResults:[],roseInventory:[]};
  // Two deliveries, two closures with category breakdowns, three scanner measures.
  for (const [i, delivered] of [100,150].entries()) {
    const receipt = `r${i}`, assignment = `a${i}`;
    await put('operations_receptions',receipt,{supplier:'Finca',block:'B04',items:[{id:'line',variety:'ROSE',quality:'PREMIUM'}]});
    const delivery = {id:assignment,receptionId:receipt,receptionItemId:'line',totalStems:delivered,dateTime:date,status:'COMPLETADO',quality:'PREMIUM'};
    await put('operations_classifier_assignments',assignment,delivery);
    store.classifierAssignments.push({...delivery,supplier:'Finca',block:'B04',variety:'ROSE',nationalStems:99999});
    for (let part=0;part<2;part++) {
      const closure = {id:`c${i}-${part}`,assignmentId:assignment,nationalStems:national/4,nationalOidioStems:national/8,nationalMaltratoStems:national/8,quality:'PREMIUM'};
      await put('operations_classification_results',closure.id,closure);
      store.classificationResults.push(closure);
    }
  }
  for (const [i, amount] of [80,80,physical-160].entries()) {
    const inventory = {id:`i${i}`,sourceType:'ESCANEO_ETIQUETA',supplier:'P004',block:'B4',variety:'ROSE',quality:'PREMIUM',length:[40,60,70][i],stems:amount,date,admittedAt:date,state:i===0?null:'DISPONIBLE'};
    await put('operations_rose_inventory',inventory.id,inventory);
    store.roseInventory.push(inventory);
  }
  return {db:{operations:store}};
}
for (const [physical,national,expected] of [[249,0,1],[240,10,0],[252,0,-2]]) {
  const state = await fixture(physical,national);
  const before = await snapshot(), localBefore=JSON.stringify(state);
  const result = await report();
  const row=result.items[0];
  assert.equal(result.items.length,1);
  assert.deepEqual([row.classifiedStems,row.exportedStems,row.nationalStems,row.mismatch],[250,physical,national,expected]);
  assert.equal(result.totals.mismatch,expected);
  assert.deepEqual([row.length40,row.length60,row.length70],[80,80,physical-160]);
  const local = api.aggregateSupplierClassificationRows(api.buildSupplierClassificationSourceRows(state));
  assert.equal(local.length,1);
  for (const key of ['classifiedStems','exportedStems','nationalStems','mismatch','length40','length60','length70']) assert.equal(local[0][key],row[key],key);
  if(referenceApi) {
    const previous=referenceApi.aggregateSupplierClassificationRows(referenceApi.buildSupplierClassificationSourceRows(state));
    for(const key of ['exportedStems',...Array.from({length:10},(_,i)=>`length${40+i*10}`)]) {
      assert.equal(previous.reduce((n,r)=>n+r[key],0),result.totals[key],`Physical/measure unchanged: ${key}`);
    }
  }
  const sheets=api.buildSupplierClassificationSheets({rows:result.items,totals:result.totals});
  assert.deepEqual(Array.from(sheets[0].rows[0].slice(-4)),[national,physical,250,expected]);
  activeReport={...result,filters:{from:date,to:date}};
  const query=await api.querySupplierReportPage(1);
  assert.equal(query.ok,true,JSON.stringify(query));
  const html=api.renderSupplierClassificationReport(state);
  assert.ok(html.includes(`>${expected}</td>`),html.slice(-500));
  assert.ok(html.includes(`>${physical}</strong>`));
  assert.ok(html.includes('>250</strong>'));
  assert.ok(!/proveedor entreg[oó] menos|p[eé]rdida|faltante|error de clasificaci[oó]n/i.test(html));
  const archive=window.BlessERP.operacionesRamosReportXlsx.buildWorkbookArchive(sheets,{identity:{commercialName:'Fixture'}},new Uint8Array());
  const entries=workbookEntries(archive);
  const sheet=entries.get('xl/worksheets/sheet1.xml');
  for(const [column,value] of [['P',national],['Q',physical],['R',250],['S',expected]]) {
    assert.match(sheet,new RegExp(`<c r="${column}[0-9]+"[^>]*><v>${value}</v></c>`));
  }
  const output=process.env.LUNA_EVIDENCE_DIR || path.resolve('..','evidence','supplier-report');
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,`desfase-${expected}.xlsx`),archive);
  assert.equal(await snapshot(),before); assert.equal(JSON.stringify(state),localBefore);
  cases.push({delivered:250,physical,national,mismatch:expected,uiXlsx:true,sourceUnchanged:true});
}
// Same supplier/date/block/variety: typed contributions never cross or multiply.
const typedState=await fixture(240,10);
const typedStore=typedState.db.operations;
async function addDelivery(id, quality, stems) {
  await put('operations_receptions',`r-${id}`,{supplier:'Finca',block:'B4',items:[{id:'line',variety:'ROSE',quality}]});
  const row={id,receptionId:`r-${id}`,receptionItemId:'line',totalStems:stems,dateTime:date,quality,status:'COMPLETADO'};
  await put('operations_classifier_assignments',id,row);
  typedStore.classifierAssignments.push({...row,supplier:'Finca',block:'B4',variety:'ROSE'});
}
async function addClosure(id,assignmentId,quality,stems) {
  const row={id,assignmentId,quality,nationalStems:stems};
  await put('operations_classification_results',id,row); typedStore.classificationResults.push(row);
}
await addDelivery('tipo-b','TIPO_B',100);
await addClosure('b-closure','tipo-b',null,5); // A proven assignment link supplies type.
const bInventory={id:'b-inventory',supplier:'P004',block:'B4',variety:'ROSE',quality:'TIPO_B',length:60,sourceType:'ESCANEO_ETIQUETA',stems:95,date,admittedAt:date};
await put('operations_rose_inventory',bInventory.id,bInventory); typedStore.roseInventory.push(bInventory);
let typed=await report();
assert.equal(typed.items.length,2);
assert.equal(typed.items.find(r=>r.quality==='PREMIUM').length60,80);
assert.equal(typed.items.find(r=>r.quality==='TIPO_B').length60,95);
assert.equal(typed.items.find(r=>r.quality==='TIPO_B').length40,0);
await addDelivery('untyped',null,7);
await addClosure('untyped-close','untyped',null,2);
typed=await report();
assert.equal(typed.items.length,3);
assert.deepEqual(typed.items.filter(r=>!r.quality).map(r=>[r.classifiedStems,r.nationalStems]),[[7,2]]);
assert.equal(typed.totals.classifiedStems,357); assert.equal(typed.totals.nationalStems,17);
// An explicit closure type is retained even if its delivery has a higher grain.
await addClosure('typed-close-untyped-delivery','untyped','TIPO_B',1);
typed=await report();
const typedBefore=await snapshot();
const typedLocal=api.aggregateSupplierClassificationRows(api.buildSupplierClassificationSourceRows(typedState));
for(const row of typed.items) {
  const local=typedLocal.find(r=>r.quality===row.quality);
  for(const key of ['classifiedStems','nationalStems','exportedStems','mismatch','length40','length60']) assert.equal(local[key],row[key],`${row.quality}:${key}`);
}
assert.equal(typed.items.find(r=>r.quality==='PREMIUM').nationalStems,10);
assert.equal(typed.items.find(r=>r.quality==='TIPO_B').nationalStems,6);
const typeSheets=api.buildSupplierClassificationSheets({rows:typed.items,totals:typed.totals});
assert.deepEqual(Array.from(typeSheets[0].rows.map(r=>r[4])).sort(),['PREMIUM','SIN CALIDAD','TIPO B']);
const typeArchive=window.BlessERP.operacionesRamosReportXlsx.buildWorkbookArchive(typeSheets,{identity:{commercialName:'Fixture'}},new Uint8Array());
const typeXml=workbookEntries(typeArchive).get('xl/worksheets/sheet1.xml');
for(const label of ['PREMIUM','TIPO B','SIN CALIDAD']) assert.match(typeXml,new RegExp(`<c r="E[0-9]+"[^>]*>.*?<t[^>]*>${label}</t>`));
const typeOutput=process.env.LUNA_EVIDENCE_DIR || path.resolve('..','evidence','supplier-report');
await fs.mkdir(typeOutput,{recursive:true});
await fs.writeFile(path.join(typeOutput,'tipo-premium-b-unattributed.xlsx'),typeArchive);
activeReport={...typed,filters:{from:date,to:date}};
assert.equal((await api.querySupplierReportPage(1)).ok,true);
const typeHtml=api.renderSupplierClassificationReport(typedState);
for(const label of ['PREMIUM','TIPO B','SIN CALIDAD']) assert.ok(typeHtml.includes(`<td>${label}</td>`));
for(const row of typed.items) {
  const sheetRow=typeSheets[0].rows.find(r=>r[4]===api.supplierQualityTypeLabel(row.quality));
  assert.deepEqual(Array.from(sheetRow.slice(-4)),[row.nationalStems,row.exportedStems,row.classifiedStems,row.mismatch]);
}
assert.equal(await snapshot(),typedBefore);
// Explicit IDs cannot be silently replaced; block evidence must exist and agree.
for(const [extra,cat,expected] of [
  [{supplierId:'MISSING'},catalog,'UNKNOWN'],
  [{block:'B04'},catalog,'RESOLVED'],
  [{block:''},{...catalog,assignedBlocks:[]},'UNKNOWN'],
  [{block:'B5'},catalog,'RESOLVED'],
]) {
  await db.exec('truncate erp_entity_records');
  await put('operations_suppliers',cat.id,cat);
  const source={supplier:'P004',block:'B4',...extra};
  await put('operations_rose_inventory','i',{...source,sourceType:'ESCANEO_ETIQUETA',date,stems:10});
  assert.equal((await report()).items[0].supplierResolution,expected);
  assert.equal(api.resolveSupplierIdentity({...resolverStore,masterData:{suppliers:[cat]}},source).status,expected);
}
await fixture(240,10);
await put('operations_rose_inventory','other-block',{supplierId:catalog.id,block:'B5',variety:'ROSE',quality:'PREMIUM',sourceType:'ESCANEO_ETIQUETA',date,stems:20,length:60});
await put('operations_suppliers','other',{code:'OTHER',name:'Finca',assignedBlock:'B9'});
await put('operations_rose_inventory','different-provider',{supplierId:'other',block:'B9',variety:'ROSE',quality:'PREMIUM',sourceType:'ESCANEO_ETIQUETA',date,stems:30});
let result=await report();
assert.equal(result.items.find(r=>r.block==='B4').mismatch,0);
assert.equal(result.items.find(r=>r.block==='B5').mismatch,-20);
assert.equal(result.items.find(r=>r.supplierId==='other').mismatch,-30);
// Sources with no demonstrable link remain individually traceable.
for(const id of ['old-A','old-B']) await put('operations_rose_inventory',id,{supplierId:id,supplier:'Same unknown',block:'B8',sourceType:'ESCANEO_ETIQUETA',date,stems:1});
result=await report(); assert.equal(result.items.filter(r=>r.supplierResolution==='UNKNOWN').length,2);
const unresolvedSheet=api.buildSupplierClassificationSheets({rows:result.items,totals:result.totals});
assert.ok(unresolvedSheet[0].rows.some(r=>r[1].includes('[UNKNOWN]')));
await put('operations_rose_inventory','annulled',{supplierId:catalog.id,block:'B4',sourceType:'ESCANEO_ETIQUETA',date,stems:999,state:'ANULADO'});
assert.equal((await report()).totals.exportedStems,result.totals.exportedStems);
await db.query("update erp_entity_records set payload=payload || '{\"printCount\":99,\"printedAt\":\"2026-09-12\"}'::jsonb where entity='operations_rose_inventory' and record_id='i1'");
assert.equal((await report()).totals.exportedStems,result.totals.exportedStems);
assert.equal((await report()).totals.classifiedStems,250);
assert.equal((await report()).totals.nationalStems,10);
await put('operations_suppliers','alias-A',{code:'A',name:'Alias A',assignedBlock:'B8',aliases:['DUP']});
await put('operations_suppliers','alias-B',{code:'B',name:'Alias B',assignedBlock:'B8',aliases:['DUP']});
await put('operations_rose_inventory','ambiguous',{supplier:'DUP',block:'B8',sourceType:'ESCANEO_ETIQUETA',date,stems:0});
assert.equal((await report()).items.find(r=>r.supplier==='DUP').supplierResolution,'AMBIGUOUS');
await put('operations_rose_inventory','foreign',{supplierId:catalog.id,block:'B4',sourceType:'ESCANEO_ETIQUETA',date,stems:999},other);
assert.equal((await report()).totals.exportedStems,result.totals.exportedStems);
await assert.rejects(report(other),/OPERATIONS_SUPPLIER_REPORT_FORBIDDEN/);
await assert.rejects(db.query(`select ${wrapperSignature.split('(')[0]}($1,$2::date,$2::date)`,[other,date]),/CAPABILITY_DENIED/);
// Replay the installed wrapper/resolver under the actual local authenticated role.
// Actor membership/capability are test doubles; there is no PROD session or network.
// IMPERIO-only actor has no membership in BLESS: the metadata pool is the authority.
await db.exec(`create table test_report_access(actor uuid,company_id uuid,inventory_view boolean);
create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create or replace function erp_is_company_member(uuid,uuid) returns boolean language sql as $$
  select exists(select 1 from test_report_access where company_id=$1 and actor=$2)$$;
create or replace function erp_security_assert_capability(uuid,text) returns void language plpgsql as $$begin
  if $2 <> 'operations.inventory.view' or not exists(select 1 from test_report_access where company_id=$1 and actor=auth.uid() and inventory_view)
  then raise exception 'CAPABILITY_DENIED'; end if;
end;$$;`);
for(const scope of [company,other,unrelated,unmapped]) {
  await db.query('insert into test_report_access values($1,$1,true)',[scope]);
}
await db.query("select set_config('test.actor',$1,false)",[company]);
await fixture(240,10);
// Additional type, canonical source links, untyped closure, annulled scanner.
await put('operations_receptions','r-b',{supplierId:catalog.id,block:'B4',items:[{id:'line',variety:'ROSE',quality:'TIPO_B'}]});
await put('operations_classifier_assignments','a-b',{receptionId:'r-b',receptionItemId:'line',totalStems:100,dateTime:date,status:'COMPLETADO'});
await put('operations_classification_results','c-b',{assignmentId:'a-b',nationalStems:5});
await put('operations_rose_inventory','i-b',{sourceType:'ESCANEO_ETIQUETA',supplier:'P004',block:'B4',variety:'ROSE',quality:'TIPO_B',length:60,stems:95,date});
await put('operations_rose_inventory','cancelled-pool',{sourceType:'ESCANEO_ETIQUETA',supplierId:catalog.id,block:'B4',stems:900,state:'ANULADO',date});
// Same IDs/block/names in other scopes must never replace the source owner's data.
for(const scope of [other,unrelated]) {
  await put('operations_suppliers',catalog.id,{...catalog,name:'NOT THE POOL'},scope);
  await put('operations_receptions','r0',{supplierId:catalog.id,block:'B4',items:[{id:'line',variety:'ROSE',quality:'PREMIUM'}]},scope);
  await put('operations_classifier_assignments','a0',{receptionId:'r0',receptionItemId:'line',totalStems:9999,dateTime:date},scope);
  await put('operations_classification_results','c0',{assignmentId:'a0',nationalStems:7777},scope);
  await put('operations_rose_inventory','i0',{sourceType:'ESCANEO_ETIQUETA',supplierId:catalog.id,block:'B4',variety:'ROSE',quality:'PREMIUM',stems:5555,date},scope);
}
// Plausible fields in unrelated BLESS entities cannot become report contributions.
for(const entity of ['commercial_customers','commercial_orders','accounting_journal_entries','user_profiles']) {
  await put(entity,`excluded-${entity}`,{supplierId:catalog.id,block:'B4',variety:'ROSE',quality:'PREMIUM',sourceType:'ESCANEO_ETIQUETA',stems:88888,totalStems:88888,nationalStems:88888,date,dateTime:date,privateMarker:'NOT_OPERATIONAL_POOL'});
}
const poolBefore=await snapshot();
const companiesBefore=JSON.stringify((await db.query('select * from companies order by id')).rows);
const ownerReport=await report();
assert.deepEqual([ownerReport.totals.classifiedStems,ownerReport.totals.exportedStems,ownerReport.totals.nationalStems,ownerReport.totals.mismatch],[350,335,15,0]);
const internalBefore=await acl();
await db.exec('set role authenticated');
const publicReport=async(scope)=> (await db.query(`select ${wrapperSignature.split('(')[0]}($1,$2::date,$2::date) r`,[scope,date])).rows[0].r;
assert.deepEqual((await publicReport(company)).items,ownerReport.items);
await db.query("select set_config('test.actor',$1,false)",[other]);
await assert.rejects(publicReport(company),/CAPABILITY_DENIED/);
await assert.rejects(report(other),/permission denied/); // No direct internal bypass.
await assert.rejects(db.query('select erp_inventory_pool_company($1)',[other]),/permission denied/);
await assert.rejects(db.query("select * from erp_entity_records where company_id=$1 and entity='commercial_customers'",[company]),/permission denied/);
const poolResult=await publicReport(other);
assert.deepEqual(poolResult.totals,ownerReport.totals,'IMPERIO must use owner sources, not its own same-ID records');
assert.deepEqual(poolResult.items,ownerReport.items);
assert.equal(poolResult.operatingCompanyId,other);
assert.equal(poolResult.inventoryOwnerCompanyId,company);
assert.ok(poolResult.items.every(r=>r.supplierScope===company && r.supplierId===catalog.id && r.supplier==='Finca'));
assert.equal(poolResult.items.find(r=>r.quality==='PREMIUM').length60,80);
assert.equal(poolResult.items.find(r=>r.quality==='TIPO_B').length60,95);
assert.ok(!JSON.stringify(poolResult).includes('NOT_OPERATIONAL_POOL'));
await db.query("select set_config('test.actor',$1,false)",[unrelated]);
await assert.rejects(publicReport(other),/CAPABILITY_DENIED/);
await assert.rejects(publicReport(company),/CAPABILITY_DENIED/);
const ownUnrelated=await publicReport(unrelated);
assert.equal(ownUnrelated.inventoryOwnerCompanyId,unrelated);
assert.equal(ownUnrelated.totals.exportedStems,5555);
await db.query("select set_config('test.actor',$1,false)",[unmapped]);
await assert.rejects(publicReport(unmapped),/INVENTORY_POOL_MAPPING_REQUIRED/);
await db.query("select set_config('test.actor','',false)");
await assert.rejects(publicReport(other),/CAPABILITY_DENIED/);
await db.exec('reset role');
await db.query('update test_report_access set inventory_view=false where actor=$1',[other]);
await db.query("select set_config('test.actor',$1,false)",[other]);
await db.exec('set role authenticated');
await assert.rejects(publicReport(other),/CAPABILITY_DENIED/);
await db.exec('reset role');
await db.query('update test_report_access set inventory_view=true where actor=$1',[other]);
await db.exec('set role authenticated');

// Real JS repository -> actual PGlite public wrapper -> renderer and XLSX.
// No canned success response: all RPC parameters pass through to PostgreSQL.
let operatingScope=other;
const rpcRequests=[];
window.BlessERP.authAccess={activeAccess:()=>({activeCompany:{id:operatingScope}})};
window.BlessERP.getSupabaseClient=()=>({rpc:async(name,args)=>{
  assert.equal(name,'erp_operations_v2_supplier_inventory_report');
  rpcRequests.push({...args});
  const values=['p_company_id','p_date_from','p_date_to','p_supplier','p_block','p_variety','p_length','p_classification_type','p_search','p_sort_field','p_sort_direction','p_page','p_page_size'].map(k=>args[k]);
  try { return {data:(await db.query(`select ${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) r`,values)).rows[0].r,error:null}; }
  catch(error) { return {data:null,error}; }
}});
vm.runInNewContext(await fs.readFile('scripts/repositories/operaciones/supplier-inventory-report-query-repository.js','utf8'),context);
const repository=window.BlessERP.getSupplierInventoryReportQueryRepository();
// Existing block text filter is retained: B matches B04 and B4 source spellings.
const filters={from:date,to:date,block:'B',variety:'ROSE'};
const page=await repository.queryPage(filters);
const exported=await repository.exportReport(filters);
assert.deepEqual(Array.from(exported.items),Array.from(page.items)); assert.deepEqual(exported.totals,page.totals);
assert.deepEqual(page.totals,ownerReport.totals);
assert.equal(exported.operatingCompanyId,other); assert.equal(exported.inventoryOwnerCompanyId,company);
assert.ok(rpcRequests.every(r=>r.p_company_id===other));
for(const [key,value] of Object.entries(filters)) api.setSupplierReportFilter(key,value);
assert.equal((await api.querySupplierReportPage(1)).ok,true);
// Empty local operations proves the rendered rows came from the remote owner.
const emptyOperatorState={db:{operations:{companyId:other,masterData:{suppliers:[]},roseInventory:[],classifierAssignments:[],classificationResults:[],ui:{}}}};
const poolHtml=api.renderSupplierClassificationReport(emptyOperatorState);
assert.ok(poolHtml.includes('<td>PREMIUM</td>') && poolHtml.includes('<td>TIPO B</td>'));
assert.ok(poolHtml.includes('>350</th>') && poolHtml.includes('>335</th>'));
assert.ok(poolHtml.includes('Finca') && !poolHtml.includes('NOT THE POOL'));
const downloaded=await api.exportSupplierClassificationXlsx(emptyOperatorState,{download:false,logoBytes:new Uint8Array()});
assert.equal(downloaded.ok,true,downloaded.message);
assert.deepEqual(Array.from(downloaded.report.rows),Array.from(page.items));
for(const key of ['classifiedStems','exportedStems','nationalStems','mismatch']) assert.equal(downloaded.report.totals[key],page.totals[key]);
assert.ok(rpcRequests.every(r=>r.p_company_id===other));
const poolSheets=downloaded.sheets;
const poolArchive=downloaded.archive;
const poolXml=workbookEntries(poolArchive).get('xl/worksheets/sheet1.xml');
for(const row of page.items) {
  const label=api.supplierQualityTypeLabel(row.quality);
  const cells=Array.from(poolSheets[0].rows.find(r=>r[4]===label));
  assert.deepEqual(cells.slice(-4),[row.nationalStems,row.exportedStems,row.classifiedStems,row.mismatch]);
  // Inspect each worksheet data row together, not values anywhere in the file.
  const xmlRow=Array.from(poolXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g),m=>m[0]).find(r=>r.includes(`>${label}</t>`));
  assert.ok(xmlRow,label);
  for(const [col,value] of [['P',row.nationalStems],['Q',row.exportedStems],['R',row.classifiedStems],['S',row.mismatch]]) {
    assert.match(xmlRow,new RegExp(`<c r="${col}[0-9]+"[^>]*><v>${value}</v></c>`));
  }
}
await fs.writeFile(path.join(typeOutput,'imperio-bless-pool.xlsx'),poolArchive);
// Company switching must change both actor authorization and report source.
operatingScope=unrelated;
await assert.rejects(repository.queryPage(filters),/CAPABILITY_DENIED/);
await db.query("select set_config('test.actor',$1,false)",[unrelated]);
assert.equal((await repository.queryPage(filters)).inventoryOwnerCompanyId,unrelated);
await db.exec('reset role');
assert.equal(await snapshot(),poolBefore);
assert.equal(JSON.stringify((await db.query('select * from companies order by id')).rows),companiesBefore);
assert.equal(await acl(),internalBefore);
await db.close();
console.log(JSON.stringify({ok:true,cases,typeCases:'A-H PASS',independentStages:true,identityGuards:true,blockGrain:true,idempotentMigration:true,installedDefinitionsReplayed:true,aclPreserved:true,scopeGuard:true,physicalComparedWithReference:Boolean(referenceApi),sharedPoolReport:'PASS',poolSources:[350,335,15,0],poolActorRole:'authenticated (isolated)',operatorContextPreserved:true,unrelatedEntitiesExcluded:true,realRepositoryUiXlsx:true,sourceRecordsUnchanged:true},null,2));
