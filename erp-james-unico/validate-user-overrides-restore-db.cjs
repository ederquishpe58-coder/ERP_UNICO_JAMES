const fs=require('fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const A='11111111-1111-4111-8111-111111111111',J='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333';
const cap='purchases.withholdings.reverse',tests=[];
global.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
async function main(){
 const db=new PGlite(),run=s=>db.exec(s),scalar=async(s,args)=>(await db.query(s,args)).rows[0]?.v;
 const login=(id=A,role='authenticated')=>run(`reset role;select set_config('request.jwt.claim.sub','${id}',false);select set_config('request.jwt.claim.role','${role}',false);set role ${role}`);
 const preview=(company=B,target=J,profile=null,overrides=null)=>scalar('select erp_admin_preview_user_access_plan($1,$2,$3,$4) v',[company,target,profile,overrides&&JSON.stringify(overrides)]);
 const save=(p,overrides,op=randomUUID())=>scalar('select erp_admin_configure_user_access_plan($1,$2,$3,$4,$5,$6,$7) v',[p.company_id,p.target_user_id,p.profile_id,JSON.stringify(overrides),p.state_token,op,'Isolated explicit grant fixture']);
 const snap=()=>scalar(`select jsonb_build_object('members',(select jsonb_agg(to_jsonb(t) order by company_id,user_id) from user_company_memberships t),'profiles',(select jsonb_agg(to_jsonb(t) order by company_id,user_id) from erp_security_user_company_profiles t),'overrides',(select jsonb_agg(to_jsonb(t) order by company_id,user_id,capability_id) from erp_security_user_capability_overrides t),'audit',(select jsonb_agg(to_jsonb(t) order by id) from erp_access_audit_log t),'versions',(select jsonb_agg(to_jsonb(t) order by company_id) from erp_security_permission_versions t)) v`);
 const deny=async(fn,pattern)=>{await run('savepoint rejected');try{await assert.rejects(fn,pattern);}finally{await run('rollback to savepoint rejected;release savepoint rejected');}};
 const test=async(name,fn)=>{await run('reset role;begin');try{await fn();tests.push({name,result:'PASS'});}catch(e){tests.push({name,result:'FAIL',error:e.message});}finally{await run('rollback;reset role');}};
 try{
  await run(fs.readFileSync('tests/fixtures/sri-dual-configuration-fixture.sql','utf8'));
  await run(fs.readFileSync('tests/fixtures/existing-user-membership-dependencies.sql','utf8'));
  await run(fs.readFileSync('supabase/migrations/202609060007_user_access_profile_overrides.sql','utf8'));
  for(const f of JSON.parse(fs.readFileSync('tests/fixtures/user-access-plan-current-functions.json','utf8')))await run(f.definition);
  await run(`insert into auth.users values('${A}'),('${J}'),('${O}');
   insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values('${B}','COMP-BLESS-FLOWER','COMP-BLESS-FLOWER','B','B','1717637084001'),('${I}','COMP-IMPERIO-FLOWERS','COMP-IMPERIO-FLOWERS','I','I','1727970137001');
   insert into user_profiles(user_id,display_name,username) values('${A}','Authorized other owner','admin'),('${J}','James fixture','james'),('${O}','Other same profile','other');
   insert into user_company_memberships(company_id,user_id,membership_role,membership_status) values('${B}','${A}','OWNER','ACTIVE'),('${B}','${J}','OWNER','ACTIVE'),('${I}','${J}','OWNER','ACTIVE'),('${B}','${O}','EDITOR','ACTIVE');
   insert into erp_security_profiles(profile_id,display_name,description,active) values('GERENCIA_GENERAL','Gerencia General','Fixture',true) on conflict do nothing;
   insert into erp_security_capabilities(capability_id,module,resource,action,description,risk_level,active) values('${cap}','purchases','withholdings','reverse','Fixture','CRITICAL',true) on conflict do nothing;
   insert into erp_security_user_company_profiles(company_id,user_id,profile_id) values('${B}','${A}','GERENCIA_GENERAL'),('${B}','${J}','GERENCIA_GENERAL'),('${I}','${J}','GERENCIA_GENERAL'),('${B}','${O}','GERENCIA_GENERAL');
   insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) values('${B}','${A}','admin.users.manage','GRANT','Fixture'),('${B}','${J}','admin.users.manage','GRANT','Fixture'),('${I}','${J}','admin.users.manage','GRANT','Fixture');`);
  const before=await snap(),migration=fs.readFileSync('supabase/migrations/202609090001_user_access_plan_self_read.sql','utf8');
  await run(migration);await run(migration);assert.deepEqual(await snap(),before);tests.push({name:'Migration twice preserves all membership/profile/override data',result:'PASS'});
  await test('James self read: real membership, profile, catalog, overrides, no writes',async()=>{const old=await snap();await login(J);const p=await preview();assert.equal(p.can_edit,false);assert.equal(p.membership.user_id,J);assert.equal(p.profile_id,'GERENCIA_GENERAL');assert(p.capability_catalog.some(c=>c.capability_id===cap));await run('reset role');assert.deepEqual(await snap(),old);});
  await test('Self desired preview and direct save still blocked',async()=>{await login(J);const p=await preview();await deny(()=>preview(B,J,p.profile_id,[]),/SELF_ELEVATION/);await deny(()=>save(p,[{capability_id:cap,effect:'GRANT',reason:'fixture'}]),/SELF_ELEVATION/);});
  await test('Other authorized owner grants James only BLESS; ACK, refresh, effective TRUE, sparse override, idempotency',async()=>{const old=await snap();await login();const p=await preview();assert.equal(p.can_edit,true);const desired=[...p.overrides.map(({capability_id,effect,reason})=>({capability_id,effect,reason})),{capability_id:cap,effect:'GRANT',reason:'fixture'}],op=randomUUID();const r=await save(p,desired,op);assert.equal(r.confirmed,true);assert(r.effective_capabilities.some(c=>c.capability_id===cap));const reread=await preview();assert.equal(reread.state_token,r.state_token);assert.equal(reread.profile_id,'GERENCIA_GENERAL');assert.equal(reread.overrides.length,2);assert.deepEqual(await save(p,desired,op),r);await run('reset role');const after=await snap();assert.deepEqual(after.members,old.members);assert.deepEqual(after.profiles.filter(x=>x.user_id!==J||x.company_id!==B),old.profiles.filter(x=>x.user_id!==J||x.company_id!==B));assert.deepEqual(after.overrides.filter(x=>x.user_id!==J||x.company_id!==B),old.overrides.filter(x=>x.user_id!==J||x.company_id!==B));});
  await test('DENY > GRANT > PROFILE canonical resolver unchanged',async()=>{const rows=await db.query("select * from erp_security_resolve_access_plan_internal('GERENCIA_GENERAL',$1)",[JSON.stringify([{capability_id:cap,effect:'GRANT'},{capability_id:cap,effect:'DENY'}])]);assert(!rows.rows.some(c=>c.capability_id===cap));const p=await scalar("select jsonb_agg(r) v from erp_security_resolve_access_plan_internal('GERENCIA_GENERAL',$1) r",[JSON.stringify([{capability_id:cap,effect:'GRANT'}])]);assert(p.some(c=>c.capability_id===cap));});
  for(const [name,setup,actor,company,error] of [
   ['Cross-company no membership','',A,I,/CAPABILITY|MEMBERSHIP/],
   ['OWNER without capability',`delete from erp_security_user_capability_overrides where user_id='${A}'`,A,B,/CAPABILITY/],
   ['Inactive membership',`update user_company_memberships set membership_status='SUSPENDED' where user_id='${A}'`,A,B,/CAPABILITY|MEMBERSHIP/],
   ['Expired membership',`update user_company_memberships set valid_until=current_date-1 where user_id='${A}'`,A,B,/CAPABILITY|MEMBERSHIP|ADMIN/],
   ['Inactive identity',`update user_profiles set is_active=false where user_id='${A}'`,A,B,/CAPABILITY|MEMBERSHIP|PROFILE/],
   ['ADMIN cannot edit OWNER',`update user_company_memberships set membership_role='ADMIN' where user_id='${A}'`,A,B,/OWNER_ADMIN/]
  ])await test(name,async()=>{if(setup)await run(setup);const old=await snap();await login(actor);await deny(()=>preview(company),error);await run('reset role');assert.deepEqual(await snap(),old);});
  await test('Stale state token blocks save, never overwrites other edits',async()=>{await login();const p=await preview();await run(`reset role;update user_company_memberships set notes='Another edit' where user_id='${J}' and company_id='${B}'`);await login();await deny(()=>save(p,[]),/STALE/);});
  await test('Nonexistent target not fabricated',async()=>{await login();await deny(()=>preview(B,randomUUID()),/TARGET_MEMBERSHIP/);});
  for(const role of ['anon','service_role'])await test(role+' cannot execute preview',async()=>{await login(J,role);await deny(()=>preview(),/permission denied/);});
 }finally{await db.close();}
 console.log(JSON.stringify({result:tests.every(t=>t.result==='PASS')?'PASS':'FAIL',tests,realDatabaseCalls:0,realPermissionChanges:0},null,2));if(tests.some(t=>t.result==='FAIL'))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
