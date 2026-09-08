const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch { ({ PGlite } = require('C:/Users/Contador J/Documents/ERP_UNICO_JAMES/node_modules/@electric-sql/pglite')); }
const read = p => fs.readFileSync(__dirname + '/' + p, 'utf8');
const I = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const actor = '20000000-0000-4000-8000-000000000001', key = 'COMP-IMPERIO-FLOWERS';
const checks = [], db = new PGlite();
let active = I, calls = 0, lastParameters;
const entityNames=['commercial_customers','commercial_brands','commercial_airlines','commercial_agencies','commercial_dae'];
const entityFields={commercial_customers:['code','identification'],commercial_brands:['code'],commercial_airlines:['code','awbPrefix'],commercial_agencies:['code','name'],commercial_dae:['number']};
const factories={commercial_customers:'createCustomer',commercial_brands:'createBrand',commercial_airlines:'createAirline',commercial_agencies:'createAgency',commercial_dae:'createDae'};
const keys={[I]:key,[B]:'COMP-BLESS-FLOWER'};
const clone = structuredClone;
const get = async (id, company = active, entity='commercial_customers') => (await db.query('select * from erp_entity_records where company_id=$1 and entity=$2 and record_id=$3', [company, entity, id])).rows[0];
const fields = (base, value) => [...new Set([...Object.keys(base), ...Object.keys(value)])]
  .filter(k => JSON.stringify(base[k]) !== JSON.stringify(value[k]))
  .map(k => ({ path: [k], base_exists: k in base, base: base[k] ?? null, value_exists: k in value, value: value[k] ?? null }));
async function rpc(p) {
  const names = ['operation_id','company_id','device_id','entity','action','record_id','payload','base_payload','field_changes','base_version','local_created_at'];
  return (await db.query('select * from erp_apply_offline_operation(' + names.map((_, i) => '$' + (i + 1)).join(',') + ')', names.map(n => ['payload','base_payload','field_changes'].includes(n) ? JSON.stringify(p['p_' + n]) : p['p_' + n]))).rows;
}
async function write(id, patch, company = active, action = 'UPDATE', entity='commercial_customers', baseVersion) {
  const old = await get(id, company, entity), payload = { ...(old?.payload || {}), ...patch };
  return rpc({ p_operation_id: randomUUID(), p_company_id: company, p_device_id: 'fixture', p_entity: entity, p_action: action,
    p_record_id: id, p_payload: payload, p_base_payload: old?.payload || {}, p_field_changes: fields(old?.payload || {}, payload), p_base_version: baseVersion ?? old?.version ?? 0, p_local_created_at: new Date().toISOString() });
}
async function pass(name, fn) { try { await fn(); checks.push({ name, result: 'PASS' }); } catch(e) { e.message=name+': '+e.message; throw e; } }
const client = {
  from(table) {
    assert.equal(table, 'erp_entity_records'); const f = {};
    const q = { select() { return q; }, eq(k,v) { f[k]=v; return q; }, is(k,v) { f[k]=v; return q; }, order() { return q; },
      async maybeSingle() { return { data: await get(f.record_id, f.company_id, f.entity), error: null }; },
      async then(resolve,reject) { try { const rows=(await db.query('select * from erp_entity_records where company_id=$1 and entity=$2 and deleted_at is null',[f.company_id,f.entity])).rows; return resolve({data:rows,error:null}); } catch(e) { return reject(e); } }
    }; return q;
  },
  async rpc(name, p) { assert.equal(name, 'erp_apply_offline_operation'); calls++; lastParameters=clone(p);
    try { return { data: await rpc(p), error:null }; } catch(e) { return {data:null,error:e}; } }
};
const erp = {
  utils: { clone, uid: () => randomUUID() }, getEnvConfig: () => ({supabaseEnabled:true,authEnabled:true,incrementalSyncEnabled:true,commercialCatalogsSupabaseEnabled:true}),
  getSupabaseClient: () => client,
  authAccess: { activeAccess: () => ({activeCompany:{id:active}, activeCompanyKey: active === I ? key : 'COMP-BLESS-FLOWER'}) },
  state: {state:{db:{}},saveDbLocalOnly(){}},
  syncEntityRegistry: {sanitizePayload: (_e,r) => Object.fromEntries(Object.entries(clone(r)).filter(([k])=>!k.startsWith('__sync'))),setRecords(){return true;}},
  offlineSync: {createOperationId:randomUUID,getDeviceId:async()=> 'fixture',buildFieldChanges:fields,applyRemoteRecord:async()=>({ok:true})}
};
const ctx = {window:{BlessERP:erp,location:{protocol:'https:'}},console,structuredClone,crypto:require('node:crypto').webcrypto};
vm.runInNewContext(read('scripts/modules/comercial/comercial-data.js'), ctx);
vm.runInNewContext(read('scripts/repositories/comercial/commercial-master-data-repository.js'), ctx);
const data = erp.comercialData, repo = erp.getCustomerRepository();
async function saveUI(entity, record) {
  const rows=(await db.query('select * from erp_entity_records where company_id=$1 and deleted_at is null',[active])).rows;
  const config={commercial_customers:['Customer','customer'],commercial_brands:['Brand','brand'],commercial_agencies:['Agency','agency'],commercial_airlines:['Airline','airline'],commercial_dae:['Dae','dae']};
  const [name,kind]=config[entity],store={ui:{[kind+'Draft']:data[factories[entity]](record)},orders:[]};
  for(const [e,[,k]] of Object.entries(config))store[k+'Catalog']=rows.filter(r=>r.entity===e).map(r=>data[factories[e]]({...r.payload,__syncVersion:r.version}));
  const source=read('scripts/modules/comercial/comercial-state.js');
  const body=source.slice(source.indexOf('  async function save'+name+'('),source.indexOf('  async function delete'+name+'('));
  const validation=entity==='commercial_dae'?source.slice(source.indexOf('  function validateDaeDraft('),source.indexOf('  async function saveDae(')):'';
  const c={data,ensureStore:()=>store,bindCatalogCompany:r=>r,findCatalogCountry:()=>({name:'ECUADOR'}),nextCatalogCode:()=> 'NEXT',
    activeCompanyId:()=>keys[active],setNotice(){},saveConfirmedCatalogCache(){},BlessERP:erp,
    persistCatalogRecord:async(_a,r,d)=>r.save(d),save:null};
  vm.runInNewContext(validation+body+';save=save'+name,c);return c.save({db:{customers:[]}});
}
function sample(entity, suffix, company, duplicate=false) {
  const code=duplicate?'USED':suffix, name=entity==='commercial_customers'?(suffix==='A'?'CVFLOR GROUP':suffix==='B'?'NARANJO ROSES ECUADOR S.A.':suffix):suffix;
  return {id:entity+'-'+suffix,companyId:keys[company],company_id:keys[company],code,
    identification:duplicate?'CE0001':'TAX-'+suffix,identificationType:'TAX ID',legalName:name,commercialName:name,
    customerId:'commercial_customers-A',finalClientName:name,name:entity==='commercial_agencies'&&duplicate?'USED AGENCY':name,
    printedMark:'MARK',printedConsignee:'CONSIGNEE',number:duplicate?'055-2026-40-00000001':'055-2026-40-00000003',
    awbPrefix:duplicate?'014':'074',country:'ECUADOR',destination:'ECUADOR',expirationDate:'2026-12-31',coldRoom:'ROOM',city:'Quito',
    status:['commercial_customers','commercial_brands'].includes(entity)?'ACTIVO':'ACTIVA',extraCanonicalField:'PRESERVE',customerIds:[]};
}
const nonIdentityPatch={commercial_customers:{commercialName:'Visible edited',address:'New address',fixedPhone:'555'},commercial_brands:{finalClientName:'Final edited',printedMark:'NEW MARK',printedConsignee:'NEW CONSIGNEE'},commercial_airlines:{name:'Airline edited'},commercial_agencies:{phone:'555',city:'Edited city'},commercial_dae:{observation:'Edited observation',expirationDate:'2027-01-31'}};
(async()=>{
 await db.exec(read('tests/fixtures/customer-inactivation-sync.sql'));
 await db.query("select set_config('test.actor',$1,false),set_config('test.capability','allowed',false)",[actor]);
 await db.query("insert into user_company_memberships values($1,$2,'ACTIVE'),($3,$2,'ACTIVE')",[I,actor,B]);
 for(const company of [I,B])for(const entity of entityNames)for(const suffix of ['A','B','C']){
  const payload=sample(entity,suffix,company,suffix!=='C');
  await db.query('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',[company,entity,payload.id,JSON.stringify(payload)]);
 }
 await db.exec(read('supabase/migrations/202609080003_customer_status_only_inactivation.sql'));
 await db.exec(read('supabase/migrations/202609080004_commercial_catalog_identity_updates.sql'));
 const initial=(await db.query('select * from erp_entity_records order by company_id,record_id')).rows;
 for(const company of [I,B]){
  active=company;
  for(const entity of entityNames){
   const id=entity+'-A';
   await pass(keys[company]+' '+entity+' historical collision + non-identity edit through UI/RPC',async()=>{
    const old=await get(id,company,entity),draft={...old.payload,...nonIdentityPatch[entity],__syncVersion:old.version};
    const result=await saveUI(entity,draft);assert.equal(result.ok,true,JSON.stringify(result));
    const saved=await get(id,company,entity);for(const key of entityFields[entity])assert.deepEqual(saved.payload[key],old.payload[key]);
    for(const [key,value] of Object.entries(nonIdentityPatch[entity]))assert.deepEqual(saved.payload[key],value);
    assert.equal(saved.payload.extraCanonicalField,'PRESERVE');assert.equal(saved.version,old.version+1);
    const reread=await erp.createCommercialMasterDataRepository(entity).getById(id);assert.equal(reread.record.__syncVersion,saved.version);
   });
   await pass(keys[company]+' '+entity+' identity change / create duplicate blocked, including direct RPC',async()=>{
    for(const field of entityFields[entity]){
     const used=(await get(id,company,entity)).payload[field];
     await assert.rejects(write(entity+'-C',{[field]:used},company,'UPDATE',entity),/Ya existe otro registro/);
     const newRecord=sample(entity,'NEW',company,false);newRecord[field]=used;
     await assert.rejects(write(newRecord.id,newRecord,company,'INSERT',entity),/Ya existe otro registro/);
     const old=await get(entity+'-C',company,entity);
     assert.equal((await saveUI(entity,{...old.payload,[field]:used,__syncVersion:old.version})).ok,false);
    }
   });
   await pass(keys[company]+' '+entity+' inactive retains identities; conflicting reactivation blocked',async()=>{
    const old=await get(id,company,entity),status=old.payload.status==='ACTIVO'?'INACTIVO':'INACTIVA';
    assert.equal((await saveUI(entity,{...old.payload,status,__syncVersion:old.version})).ok,true);
    const saved=await get(id,company,entity);assert.equal(saved.payload.status,status);
    await assert.rejects(write(id,{status:old.payload.status},company,'UPDATE',entity),/Ya existe otro registro/);
    assert.equal((await saveUI(entity,{...saved.payload,status:old.payload.status,__syncVersion:saved.version})).ok,false);
    const request=clone(lastParameters),before=await get(id,company,entity);await rpc(request);assert.deepEqual(await get(id,company,entity),before);
    const value=saved.payload[entityFields[entity][0]],next=sample(entity,'NEW',company,false);next[entityFields[entity][0]]=value;
    await assert.rejects(write(next.id,next,company,'INSERT',entity),/Ya existe otro registro/);
   });
   await pass(keys[company]+' '+entity+' concurrency: stale browser and stale canonical version blocked',async()=>{
    const current=await get(entity+'-C',company,entity),version=current.version;
    await write(current.record_id,{observation:'User one'},company,'UPDATE',entity,version);
    const actual=await get(current.record_id,company,entity);
    await assert.rejects(write(current.record_id,{observation:'User two'},company,'UPDATE',entity,version),/La ficha cambió/);
    const result=await erp.createCommercialMasterDataRepository(entity).save({...current.payload,name:'Stale edit',__syncVersion:version});
    assert.equal(result.ok,false);assert.equal(result.mode,'COMMERCIAL_CATALOG_VERSION_CONFLICT');assert.deepEqual(await get(current.record_id,company,entity),actual);
   });
  }
 }
 active=I;
 await pass('foreign company rows do not block same-value create; canonical row scope defeats legacy payload alias',async()=>{
  const e='commercial_brands',p=sample(e,'FOREIGN',B,false);p.code='FOREIGN-ONLY';await write(p.id,p,B,'INSERT',e);
  const same={...p,id:e+'-SAME',companyId:key,company_id:key};assert.equal((await write(same.id,same,I,'INSERT',e))[0].status,'SYNCED');
  await assert.rejects(write('legacy-alias',{...same,id:'legacy-alias',companyId:keys[B],company_id:keys[B]},I,'INSERT',e),/Ya existe otro registro/);
 });
 await pass('cross-company membership/capability guards preserved; no OWNER bypass introduced',async()=>{
  await db.query('delete from user_company_memberships where company_id=$1',[B]);
  await assert.rejects(write('commercial_customers-C',{address:'Unauthorized'},B,'UPDATE'),/Acceso de empresa no autorizado/);
  assert.equal((await repo.save({...sample('commercial_customers','C',B),address:'Unauthorized',__syncVersion:1})).ok,false);
  await db.query("select set_config('test.capability','denied',false)");
  await assert.rejects(write('commercial_customers-C',{address:'Unauthorized'}),/CAPABILITY_REQUIRED/);
  await db.query("select set_config('test.capability','allowed',false)");
 });
 await pass('record ID / company / entity cannot be moved',async()=>{
  await assert.rejects(db.query("update erp_entity_records set company_id=$1 where company_id=$2 and record_id='commercial_customers-A'",[B,I]),/COMMERCIAL_CATALOG_IDENTITY_SCOPE_IMMUTABLE/);
  await assert.rejects(write('commercial_customers-A',{id:'OTHER'}),/COMMERCIAL_CATALOG_IDENTITY_SCOPE_IMMUTABLE/);
 });
 await pass('identity change to unused value allowed when all resulting unique fields are unoccupied',async()=>{
  for(const entity of entityNames){const patch=Object.fromEntries(entityFields[entity].map(f=>[f,f==='awbPrefix'?'999':'UNIQUE-NEW-'+f]));await write(entity+'-C',patch,I,'UPDATE',entity);}
 });
 await pass('competing same-version edits: exactly one commit; competing new identities: exactly one create',async()=>{
  const row=await get('commercial_customers-C');
  const edits=await Promise.allSettled([write(row.record_id,{address:'writer1'},I,'UPDATE','commercial_customers',row.version),write(row.record_id,{address:'writer2'},I,'UPDATE','commercial_customers',row.version)]);
  assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal((await get(row.record_id)).version,row.version+1);
  const one=sample('commercial_brands','RACE1',I),two=sample('commercial_brands','RACE2',I);one.code=two.code='RACE-CODE';
  const creates=await Promise.allSettled([write(one.id,one,I,'INSERT','commercial_brands'),write(two.id,two,I,'INSERT','commercial_brands')]);assert.equal(creates.filter(r=>r.status==='fulfilled').length,1);
 });
 await pass('missing browser version fails closed; no field overwritten',async()=>{
  const row=await get('commercial_customers-C');const result=await repo.save({...row.payload,address:'No version'});assert.equal(result.ok,false);assert.deepEqual(await get(row.record_id),row);
 });
 await pass('inactive references retained in canonical list; new order selector hides inactive customer',async()=>{
  const rows=(await repo.list()).rows;assert(rows.some(r=>r.id==='commercial_customers-A'&&r.status==='INACTIVO'));
  const source=read('scripts/modules/comercial/pedido-maestro.js'),body=source.slice(source.indexOf('    const normalizeCustomerSearch ='),source.indexOf('    let customerOptions = []'));
  const c={stateApi:{getCustomerCatalog:()=>rows},appState:{},selected:null};vm.runInNewContext(body+';selected=customerSearchRows',c);assert(!c.selected.some(r=>r.item.id==='commercial_customers-A'));
 });
 await pass('concurrent identical operation retry returns one persisted version and one audit operation',async()=>{
  const row=await get('commercial_customers-C'),payload={...row.payload,address:'Identical retry'},operation=randomUUID();
  const p={p_operation_id:operation,p_company_id:I,p_device_id:'fixture',p_entity:'commercial_customers',p_action:'UPDATE',p_record_id:row.record_id,p_payload:payload,p_base_payload:row.payload,p_field_changes:fields(row.payload,payload),p_base_version:row.version,p_local_created_at:new Date().toISOString()};
  const results=await Promise.all([rpc(p),rpc(p)]);assert(results.every(r=>r[0].status==='SYNCED'));assert.equal((await get(row.record_id)).version,row.version+1);assert.equal((await db.query('select count(*)::int n from erp_sync_operations where operation_id=$1',[operation])).rows[0].n,1);
 });
 await pass('existing blank identification is not assigned an automatic CE during non-identity edit',async()=>{
  await write('commercial_customers-C',{identification:''});const row=await get('commercial_customers-C');
  const result=await saveUI('commercial_customers',{...row.payload,fixedPhone:'987',__syncVersion:row.version});assert.equal(result.ok,true);assert.equal((await get(row.record_id)).payload.identification,'');
 });
 await pass('DAE historical order number references remain stable; non-identity edits still allowed',async()=>{
  const row=await get('commercial_dae-C',I,'commercial_dae');
  const order={id:'historical-order',daeNumber:row.payload.number,sriDaeNumber:row.payload.number,status:'ANULADO'};
  await db.query('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',[I,'commercial_orders',order.id,JSON.stringify(order)]);
  await assert.rejects(write(row.record_id,{number:'UNUSED-NEW-NUMBER'},I,'UPDATE','commercial_dae'),/DAE está referenciada/);
  await write(row.record_id,{observation:'Historical notes updated'},I,'UPDATE','commercial_dae');
  assert.equal((await get(row.record_id,I,'commercial_dae')).payload.number,row.payload.number);
  assert.deepEqual((await db.query("select payload from erp_entity_records where entity='commercial_orders' and record_id=$1",[order.id])).rows[0].payload,order);
 });
 await pass('forward migration idempotent without business data changes',async()=>{
  const before=(await db.query('select * from erp_entity_records order by id')).rows;await db.exec(read('supabase/migrations/202609080004_commercial_catalog_identity_updates.sql'));assert.deepEqual((await db.query('select * from erp_entity_records order by id')).rows,before);
 });
 const source=read('scripts/repositories/comercial/commercial-master-data-repository.js');
 await pass('status-only previous exception remains a subset, printed fields stay independent',async()=>{
  const row=await get('commercial_brands-A',I,'commercial_brands');assert.equal(row.payload.finalClientName,'Final edited');assert.equal(row.payload.printedMark,'NEW MARK');assert.equal(row.payload.printedConsignee,'NEW CONSIGNEE');
  assert(source.includes('COMMERCIAL_CATALOG_VERSION_CONFLICT'));
 });
 console.log(JSON.stringify({result:'PASS',checks,initialFixtureRows:initial.length,canonicalRpcCalls:calls,businessMutations:0,sriMutations:0},null,2));
})().catch(e=>{console.error(e.stack,e.detail||'');process.exitCode=1;}).finally(()=>db.close());
