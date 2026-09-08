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
const clone = structuredClone;
const customer = (id, name, code, identification, company = key) => ({ id, companyId: company, company_id: company,
  code, identification, identificationType: 'TAX ID', legalName: name, commercialName: name,
  country: 'ECUADOR', status: 'ACTIVO', preservedLegacySnapshot: { note: 'never rewrite' } });
const fixtures = [customer('cvflor', 'CVFLOR GROUP', 'CLI-001', 'CE0001'),
  customer('naranjo', 'NARANJO ROSES ECUADOR S.A.', 'CLI-002', 'CE0002'),
  customer('eflowers', 'eFLOWERS', 'CLI-002', 'CE0001'), customer('mirra', 'MIRRA', 'CLI-003', 'CE0002')];
const get = async (id, company = I) => (await db.query('select * from erp_entity_records where company_id=$1 and entity=$2 and record_id=$3', [company, 'commercial_customers', id])).rows[0];
const fields = (base, value) => [...new Set([...Object.keys(base), ...Object.keys(value)])]
  .filter(k => JSON.stringify(base[k]) !== JSON.stringify(value[k]))
  .map(k => ({ path: [k], base_exists: k in base, base: base[k] ?? null, value_exists: k in value, value: value[k] ?? null }));
async function rpc(p) {
  const names = ['operation_id','company_id','device_id','entity','action','record_id','payload','base_payload','field_changes','base_version','local_created_at'];
  return (await db.query('select * from erp_apply_offline_operation(' + names.map((_, i) => '$' + (i + 1)).join(',') + ')', names.map(n => ['payload','base_payload','field_changes'].includes(n) ? JSON.stringify(p['p_' + n]) : p['p_' + n]))).rows;
}
async function write(id, patch, company = I, action = 'UPDATE') {
  const old = await get(id, company), payload = { ...(old?.payload || {}), ...patch };
  return rpc({ p_operation_id: randomUUID(), p_company_id: company, p_device_id: 'fixture', p_entity: 'commercial_customers', p_action: action,
    p_record_id: id, p_payload: payload, p_base_payload: old?.payload || {}, p_field_changes: fields(old?.payload || {}, payload), p_base_version: old?.version || 0, p_local_created_at: new Date().toISOString() });
}
async function pass(name, fn) { await fn(); checks.push({ name, result: 'PASS' }); }
const client = {
  from(table) {
    assert.equal(table, 'erp_entity_records'); const f = {};
    const q = { select() { return q; }, eq(k,v) { f[k]=v; return q; }, is(k,v) { f[k]=v; return q; }, order() { return q; },
      async maybeSingle() { return { data: await get(f.record_id, f.company_id), error: null }; },
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
async function saveUI(record, rows) {
  const store={customerCatalog:rows.map(data.createCustomer),ui:{customerDraft:data.createCustomer(record)}};
  const source=read('scripts/modules/comercial/comercial-state.js');
  const body=source.slice(source.indexOf('  async function saveCustomer('),source.indexOf('  async function deleteCustomer('));
  const c={data,ensureStore:()=>store,bindCatalogCompany:r=>r,findCatalogCountry:()=>({name:'ECUADOR'}),nextCatalogCode:()=> 'CLI-NEXT',
    activeCompanyId:()=>key,setNotice(){},saveConfirmedCatalogCache(){},BlessERP:erp,
    persistCatalogRecord:async(_a,r,d)=>r.save(d),save:null};
  vm.runInNewContext(body+';save=saveCustomer',c); return c.save({db:{customers:[]}});
}
(async()=>{
  await db.exec(read('tests/fixtures/customer-inactivation-sync.sql'));
  await db.query("select set_config('test.actor',$1,false),set_config('test.capability','allowed',false)",[actor]);
  await db.query("insert into user_company_memberships values($1,$2,'ACTIVE')",[I,actor]);
  for(const p of fixtures) await db.query('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',[I,'commercial_customers',p.id,JSON.stringify(p)]);
  await db.query('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',[B,'commercial_customers','bless',JSON.stringify(customer('bless','BLESS','BLESS-CODE','BLESS-TAX','COMP-BLESS-FLOWER'))]);
  const blessBefore=await get('bless',B);
  await db.exec(read('supabase/migrations/202609080003_customer_status_only_inactivation.sql'));
  for(const p of fixtures.slice(0,2)) await pass(p.commercialName+' UI → RPC → trigger → persisted INACTIVO',async()=>{
    const old=await get(p.id); const result=await saveUI({...p,status:'INACTIVO',__syncVersion:old.version},fixtures); assert.equal(result.ok,true,JSON.stringify(result));
    const saved=await get(p.id); assert.deepEqual(saved.payload,{...old.payload,status:'INACTIVO'});
    assert.equal(saved.version,old.version+1); assert.deepEqual(lastParameters.p_field_changes.map(f=>f.path),[['status']]);
    assert.equal((await repo.getById(p.id)).record.status,'INACTIVO');
  });
  await pass('server retry identical operation: no extra version/audit',async()=>{
    const before=await get('naranjo'), n=(await db.query('select count(*) n from erp_sync_operations')).rows[0].n;
    await rpc(lastParameters); assert.deepEqual(await get('naranjo'),before); assert.equal((await db.query('select count(*) n from erp_sync_operations')).rows[0].n,n);
  });
  for(const [field,value] of [['code','CLI-002'],['identification','CE0001']]) await pass('CREATE reserves inactive '+field,async()=>{
    await assert.rejects(write('new-'+field,{...customer('new-'+field,'NEW','UNIQUE','UNIQUE-TAX'),[field]:value},I,'INSERT'),/Ya existe otro cliente/);
  });
  await pass('reactivation with historical collision blocked in DB and UI',async()=>{
    await assert.rejects(write('cvflor',{status:'ACTIVO'}),/Ya existe otro cliente/);
    assert.equal((await saveUI({...fixtures[0],status:'ACTIVO'},[...(await repo.list()).rows])).ok,false);
  });
  // Roll back each adversarial transition so original fixtures remain isolated and repeatable.
  for(const patch of [{code:'CLI-003'},{identification:'CE0002'},{legalName:'Changed'},{commercialName:'Changed'},
    {identificationType:'RUC'},{companyId:'COMP-BLESS-FLOWER'},{id:'different'},{address:'Changed'}, {preservedLegacySnapshot:{note:'Changed'}}]) {
    await pass('non-status payload change cannot use exception '+Object.keys(patch)[0],async()=>{
      await db.exec('begin');
      try {
        await db.exec('alter table erp_entity_records disable trigger erp_customer_identity_update_guard');
        await db.query("update erp_entity_records set payload=jsonb_set(payload,'{status}','\"ACTIVO\"') where record_id='cvflor'");
        await db.exec('alter table erp_entity_records enable trigger erp_customer_identity_update_guard');
        await assert.rejects(write('cvflor',{...patch,status:'INACTIVO'}),/Ya existe otro cliente/);
      } finally { await db.exec('rollback'); }
    });
  }
  await pass('canonical company row, not legacy company payload, determines uniqueness',async()=>{
    await assert.rejects(write('legacy',{...customer('legacy','LEGACY','CLI-002','UNIQUE-TAX','COMP-BLESS-FLOWER')},I,'INSERT'),/Ya existe otro cliente/);
  });
  await pass('cross-company RPC without membership blocked; BLESS unchanged',async()=>{
    await assert.rejects(write('bless',{status:'INACTIVO'},B),/Acceso de empresa no autorizado/);
    assert.deepEqual(await get('bless',B),blessBefore);
    active=B; assert.equal((await repo.save({...fixtures[0],status:'INACTIVO'})).ok,false); active=I;
  });
  await pass('same-company self excluded; another company does not occupy identity',async()=>{
    await write('unique',customer('unique','UNIQUE','BLESS-CODE','BLESS-TAX'),I,'INSERT');
    await write('unique',{address:'Updated'}); await write('unique',{status:'INACTIVO'}); await write('unique',{status:'ACTIVO'});
  });
  await pass('missing capability still blocked at canonical wrapper',async()=>{
    await db.query("select set_config('test.capability','denied',false)");
    await assert.rejects(write('unique',{status:'INACTIVO'}),/CAPABILITY_REQUIRED/);
    await db.query("select set_config('test.capability','allowed',false)");
  });
  await pass('new-order selector excludes inactive; history lookup preserves IDs',async()=>{
    const source=read('scripts/modules/comercial/pedido-maestro.js');
    const rows=(await repo.list()).rows;
    const selector=source.slice(source.indexOf('    const normalizeCustomerSearch ='),source.indexOf('    let customerOptions = []'));
    const c={stateApi:{getCustomerCatalog:()=>rows},appState:{},selected:null};
    vm.runInNewContext(selector+';selected=customerSearchRows;',c);
    assert.equal(c.selected.some(r=>['cvflor','naranjo'].includes(r.item.id)),false);
    for(const id of ['cvflor','naranjo']) assert.equal(rows.find(r=>r.id===id).commercialName,fixtures.find(r=>r.id===id).commercialName);
  });
  await pass('metadata-only sync does not reactivate or rewrite payload',async()=>{
    const before=await get('cvflor'); await db.query("update erp_entity_records set version=version+1 where record_id='cvflor'");
    assert.deepEqual((await get('cvflor')).payload,before.payload);
  });
  await pass('row company/ID moves blocked; unrelated entities unaffected',async()=>{
    await assert.rejects(db.query("update erp_entity_records set company_id=$1 where record_id='cvflor'",[B]),/CUSTOMER_IDENTITY_SCOPE_IMMUTABLE/);
    await assert.rejects(db.query("update erp_entity_records set record_id='different' where record_id='cvflor'"),/CUSTOMER_IDENTITY_SCOPE_IMMUTABLE/);
    await db.query("insert into erp_entity_records(company_id,entity,record_id,payload) values($1,'unrelated_fixture','other',$2)",[I,JSON.stringify(fixtures[0])]);
  });
  await pass('stale frontend identity cannot overwrite canonical identity during inactivation',async()=>{
    const stale={...fixtures[2],status:'INACTIVO',legalName:'STALE'};
    assert.equal((await repo.save(stale)).ok,false);
    assert.deepEqual((await get('eflowers')).payload,fixtures[2]);
  });
  await pass('migration reapply does not change business rows',async()=>{
    const before=(await db.query('select * from erp_entity_records order by id')).rows;
    await db.exec(read('supabase/migrations/202609080003_customer_status_only_inactivation.sql'));
    assert.deepEqual((await db.query('select * from erp_entity_records order by id')).rows,before);
  });
  console.log(JSON.stringify({result:'PASS',checks,canonicalRpcCalls:calls,businessMutations:0,sriMutations:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
