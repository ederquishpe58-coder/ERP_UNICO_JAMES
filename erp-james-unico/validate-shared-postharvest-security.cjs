const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const J='10000000-0000-4000-8000-000000000001',A='10000000-0000-4000-8000-000000000002',X='10000000-0000-4000-8000-000000000003';
const checks=[];
(async()=>{const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),run=s=>db.exec(s);
const actor=async(id,role='authenticated')=>{await run('reset role');await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id,role]);await run('set role '+role);};
const call=async(c=I,k='varieties')=>(await q('select erp_commercial_shared_postharvest_catalog($1,$2,false) r',[c,k])).rows[0].r;
const test=async(name,f)=>{await run('reset role');await f();checks.push({name,result:'PASS'});};
try{
await run(fs.readFileSync('tests/fixtures/sri-dual-configuration-fixture.sql','utf8'));
await run('alter table erp_entity_records add column updated_at timestamptz default now()');
for(const id of [J,A,X]){await q('insert into auth.users values($1)',[id]);await q('insert into user_profiles(user_id) values($1)',[id]);}
for(const [id,key] of [[B,'FIXTURE_B'],[I,'FIXTURE_I']])await q('insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values($1,$2,$2,$2,$2,$2)',[id,key]);
for(const [id,c] of [[J,B],[J,I],[A,I],[X,I]])await q("insert into user_company_memberships(user_id,company_id,membership_status,membership_role) values($1,$2,'ACTIVE','OWNER')",[id,c]);
for(const [id,c] of [[J,B],[J,I],[A,I]])await q("insert into erp_security_user_capability_overrides(user_id,company_id,capability_id,effect,reason) values($1,$2,'commercial.export_products.view','GRANT','Synthetic fixture')",[id,c]);
for(const [e,n] of [['operations_varieties',36],['operations_lengths',10]]){
 for(let i=1;i<=n;i++)await q('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',[B,e,'R'+i,JSON.stringify({name:e==='operations_lengths'?String(30+i):'VARIEDAD '+i,active:true,privateCost:123,created_by:J})]);
 await q('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',[B,e,'INACTIVE',JSON.stringify({name:'HISTORICAL',active:false})]);
 await q('insert into erp_entity_records(company_id,entity,record_id,payload,deleted_at) values($1,$2,$3,$4,now())',[B,e,'DELETED',JSON.stringify({name:'DELETED',active:true})]);
 await q('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4)',[I,e,'R1',JSON.stringify({name:'STALE IMPERIO',active:true})]);
}
const snapshot=async()=>JSON.stringify((await q('select * from erp_entity_records order by company_id,entity,record_id')).rows);
const before=await snapshot();
await run(fs.readFileSync('supabase/migrations/202609080008_shared_postharvest_catalog_read.sql','utf8'));
await run(fs.readFileSync('supabase/migrations/202609080008_shared_postharvest_catalog_read.sql','utf8'));
for(const [who,id] of [['JAMES',J],['ALEX',A]])for(const [catalog,count] of [['varieties',36],['lengths',10]])await test(who+' IMPERIO '+catalog+' uses actual capability engine and returns only BLESS active rows',async()=>{await actor(id);const r=await call(I,catalog);assert.equal(r.records.length,count);assert(r.records.every(x=>x.owner_company_id===B&&x.active&&!x.deleted_at&&!('privateCost'in x)));});
await test('BLESS owner remains readable under independent BLESS membership',async()=>{await actor(J);assert.equal((await call(B)).records.length,36);});
for(const k of ['qualities','inventory','availability','operations_inventory','operations_receipts','operations_classification','zebra','performance','suppliers','costs','purchases','orders','customers','sri'])await test(k+' outside allowlist is denied',async()=>{await actor(A);await assert.rejects(()=>call(I,k),e=>e.code==='42501');});
await test('IMPERIO actor cannot request BLESS context',async()=>{await actor(A);await assert.rejects(()=>call(B),e=>e.code==='42501');});
await test('Arbitrary or null company is denied',async()=>{await actor(A);for(const c of [null,X])await assert.rejects(()=>call(c),e=>e.code==='42501');});
await test('OWNER is not a capability bypass',async()=>{await actor(X);await assert.rejects(()=>call(),e=>e.code==='42501');});
await test('Missing and inactive membership denied',async()=>{await q("update user_company_memberships set membership_status='INACTIVE' where user_id=$1",[A]);await actor(A);await assert.rejects(()=>call(),e=>e.code==='42501');await run('reset role');await q("update user_company_memberships set membership_status='ACTIVE' where user_id=$1",[A]);});
await test('Inactive user denied',async()=>{await q('update user_profiles set is_active=false where user_id=$1',[A]);await actor(A);await assert.rejects(()=>call(),e=>e.code==='42501');await run('reset role');await q('update user_profiles set is_active=true where user_id=$1',[A]);});
await test('Explicit DENY defeats grant through actual capability engine',async()=>{await q("update erp_security_user_capability_overrides set effect='DENY' where user_id=$1",[A]);await actor(A);await assert.rejects(()=>call(),e=>e.code==='42501');await run('reset role');await q("update erp_security_user_capability_overrides set effect='GRANT' where user_id=$1",[A]);});
await test('No direct BLESS catalog write/read authority is granted',async()=>{await actor(A);await assert.rejects(()=>q("update erp_entity_records set payload='{}' where company_id=$1",[B]),e=>e.code==='42501');await assert.rejects(()=>q('select * from erp_entity_records where company_id=$1',[B]),e=>e.code==='42501');});
for(const role of ['anon','service_role'])await test(role+' cannot use shared RPC',async()=>{await actor(A,role);await assert.rejects(()=>call(),e=>e.code==='42501');});
await test('Repeated reads and idempotent migration do not mutate records',async()=>{await actor(A);await call();await call(I,'lengths');await run('reset role');assert.equal(await snapshot(),before);});
console.log(JSON.stringify({result:'PASS',tests:checks.length,checks,security:'Actual canonical capability/profile resolution from existing isolated fixture; synthetic users only',prodCalls:0},null,2));
}finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1;});
