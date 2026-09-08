// Isolated read-model tests only. No production calls or complete UI workflow claims.
const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(__dirname+'/supabase/migrations/202609080008_shared_postharvest_catalog_read.sql','utf8');
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const J='10000000-0000-4000-8000-000000000001',A='10000000-0000-4000-8000-000000000002',X='10000000-0000-4000-8000-000000000003';
const checks=[];
(async()=>{
 const db=new PGlite();const q=(sql,args=[])=>db.query(sql,args);
 const check=async(name,f)=>{await f();checks.push({name,result:'PASS'});};
 const actor=id=>q("select set_config('fixture.actor',$1,false)",[id]);
 const call=async(c=I,k='varieties',history=false)=>(await q('select erp_commercial_shared_postharvest_catalog($1,$2,$3) value',[c,k,history])).rows[0].value;
 try{
 await db.exec(`create role authenticated;create role anon;create role service_role;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
 create table user_profiles(user_id uuid primary key,is_active boolean);
 create table user_company_memberships(user_id uuid,company_id uuid,membership_status text);
 create table fixture_capabilities(user_id uuid,company_id uuid,capability_id text);
 create table erp_entity_records(company_id uuid,entity text,record_id text,payload jsonb,version bigint default1,updated_at timestamptz default now(),deleted_at timestamptz,
 primary key(company_id,entity,record_id));
 create function erp_u2a_assert_company_read_access(c uuid) returns uuid language plpgsql stable as $$begin
 if auth.uid() is null or not exists(select1 from user_company_memberships where user_id=auth.uid() and company_id=c and membership_status='ACTIVE') then
 raise exception using errcode='42501',message='COMPANY_MEMBERSHIP_REQUIRED';end if;return auth.uid();end$$;
 create function erp_security_assert_capability(c uuid,k text) returns void language plpgsql stable as $$begin
 if not exists(select1 from fixture_capabilities where user_id=auth.uid() and company_id=c and capability_id=k) then
 raise exception using errcode='42501',message='CAPABILITY_REQUIRED';end if;end$$;`.replaceAll('default1','default 1').replaceAll('select1','select 1'));
 for(const id of [J,A,X])await q('insert into user_profiles values($1,true)',[id]);
 for(const [id,c] of [[J,B],[J,I],[A,I]]){await q("insert into user_company_memberships values($1,$2,'ACTIVE')",[id,c]);await q("insert into fixture_capabilities values($1,$2,'commercial.export_products.view')",[id,c]);}
 for(const [c,e,id,p,d] of [
  [B,'operations_varieties','v1',{name:'EXPLORER',code:'V1',active:true,cost:99,employee_id:'private',created_by:J},null],
  [B,'operations_varieties','v2',{name:'OLD',code:'V2',active:false},null],
  [B,'operations_varieties','v3',{name:'DELETED',code:'V3',active:true},'2026-09-01'],
  [I,'operations_varieties','v1',{name:'STALE COPY',active:true},null],
  [B,'operations_lengths','l1',{name:'63',code:'L63',active:true},null],
  [B,'operations_lengths','l2',{name:'71',code:'L71',active:false},null],
  [B,'operations_inventory','stock1',{cost:999,stems:500},null]
 ])await q('insert into erp_entity_records(company_id,entity,record_id,payload,deleted_at) values($1,$2,$3,$4,$5)',[c,e,id,JSON.stringify(p),d]);
 await db.exec(migration);await db.exec(migration);
 const fingerprint=async()=>JSON.stringify((await q('select * from erp_entity_records order by company_id,entity,record_id')).rows);
 await check('BLESS owner and IMPERIO consumer return exactly the BLESS active variety through canonical row IDs',async()=>{await actor(J);const b=await call(B),i=await call(I);assert.deepEqual(b.records,i.records);assert.equal(i.records.length,1);assert.equal(i.records[0].id,'v1');assert.equal(i.records[0].name,'EXPLORER');assert.equal(i.owner_company_id,B);});
 await check('James and Alex fixtures with the same commercial capability see identical catalogs independent of creator',async()=>{await actor(J);const j=await call();await actor(A);assert.deepEqual(await call(),j);});
 await check('Measures come from BLESS data; arbitrary fixture63 proves no standard-size hardcoding',async()=>{const r=await call(I,'lengths');assert.equal(r.records.length,1);assert.equal(r.records[0].name,'63');});
 await check('Inactive and soft-deleted varieties excluded from selection but resolve by unchanged historical ID',async()=>{const r=await call(I,'varieties',true);assert.equal(r.records.length,3);assert.equal(r.records.find(x=>x.id==='v2').active,false);assert.equal(r.records.find(x=>x.id==='v3').active,false);});
 await check('Inactive historical measure remains readable',async()=>{const r=await call(I,'lengths',true);assert.equal(r.records.find(x=>x.id==='l2').name,'71');assert.equal(r.records.find(x=>x.id==='l2').active,false);});
 await check('Projection does not leak cost/employee/creator/arbitrary payload properties',async()=>{const r=await call();assert.deepEqual(Object.keys(r.records[0]).sort(),['active','code','deleted_at','id','name','owner_company_id','updated_at','version']);});
 await check('Inventory, availability, payroll and arbitrary catalog requests blocked',async()=>{for(const k of ['operations_inventory','inventory','availability','payroll','customers','all',null])await assert.rejects(()=>call(I,k),e=>e.code==='42501');});
 await check('Arbitrary requesting company and missing company blocked',async()=>{for(const c of [null,X])await assert.rejects(()=>call(c),e=>e.code==='42501');});
 await check('No BLESS membership gained by IMPERIO-only fixture actor',async()=>{await actor(A);await assert.rejects(()=>call(B),e=>e.code==='42501');});
 await check('Invalid membership blocked without OWNER bypass',async()=>{await actor(X);await assert.rejects(()=>call(),e=>e.code==='42501');});
 await check('Missing capability blocked even with an active membership',async()=>{await actor(A);await q('delete from fixture_capabilities where user_id=$1',[A]);await assert.rejects(()=>call(),e=>e.code==='42501');await q("insert into fixture_capabilities values($1,$2,'commercial.export_products.view')",[A,I]);});
 await check('Inactive user profile blocked',async()=>{await q('update user_profiles set is_active=false where user_id=$1',[A]);await assert.rejects(()=>call(),e=>e.code==='42501');await q('update user_profiles set is_active=true where user_id=$1',[A]);});
 await check('Fresh read reflects an owner rename/inactivation without copy or local writeback',async()=>{await q("update erp_entity_records set payload=payload||'{\"name\":\"RENAMED\",\"active\":false}' where company_id=$1 and entity='operations_varieties' and record_id='v1'",[B]);assert.equal((await call()).records.length,0);assert.equal((await call(I,'varieties',true)).records.find(x=>x.id==='v1').name,'RENAMED');});
 await check('Shared reads do not mutate records or create catalogs; authenticated receives no direct write privilege',async()=>{const before=await fingerprint();await call();await call(I,'lengths',true);assert.equal(await fingerprint(),before);const r=(await q("select has_table_privilege('authenticated','erp_entity_records','UPDATE') can_write,has_function_privilege('anon','erp_commercial_shared_postharvest_catalog(uuid,text,boolean)','EXECUTE') anon,has_function_privilege('service_role','erp_commercial_shared_postharvest_catalog(uuid,text,boolean)','EXECUTE') service")).rows[0];assert.deepEqual(r,{can_write:false,anon:false,service:false});});
 await check('Quality is not part of shared RPC allowlist; existing flower-quality enum remains authority',async()=>{await assert.rejects(()=>call(I,'qualities'),e=>e.code==='42501'&&e.message==='SHARED_CATALOG_NOT_ALLOWED');});
 console.log(JSON.stringify({result:'PASS',tests:checks.length,checks,scope:'Reader prototype for varieties/lengths only; authorization helpers are fixture doubles',qualityImplemented:false,uiImplemented:false,prodCalls:0},null,2));
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
