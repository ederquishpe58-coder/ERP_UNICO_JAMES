const fs = require('fs'), assert = require('assert/strict'), { randomUUID } = require('crypto');
const { PGlite } = require('C:/Users/Contador J/Documents/ERP_UNICO_JAMES/node_modules/@electric-sql/pglite');
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5', I='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const A='11111111-1111-4111-8111-111111111111', U='22222222-2222-4222-8222-222222222222', O='33333333-3333-4333-8333-333333333333';
const results=[];
global.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
async function main(){
 const db=new PGlite(), run=s=>db.exec(s), query=(s,a)=>db.query(s,a);
 const scalar=async(s,a)=>(await query(s,a)).rows[0]?.v;
 const login=async(actor=A,role='authenticated')=>run(`reset role;select set_config('request.jwt.claim.sub','${actor}',false);select set_config('request.jwt.claim.role','${role}',false);set role ${role};`);
 const call=(company=I, user=U, role='EDITOR', profile='COMERCIAL', op=randomUUID(), reason='Synthetic company access')=>scalar('select erp_admin_add_existing_user_membership($1,$2,$3,$4,$5,$6) v',[company,user,role,profile,op,reason]);
 const rejected=async(fn,error)=>{await run('savepoint expected_failure');try{await assert.rejects(fn,error);}finally{await run('rollback to savepoint expected_failure;release savepoint expected_failure');}};
 const snapshot=()=>scalar(`select jsonb_build_object('memberships',(select jsonb_agg(to_jsonb(t) order by company_id,user_id) from user_company_memberships t),
 'profiles',(select jsonb_agg(to_jsonb(t) order by company_id,user_id) from erp_security_user_company_profiles t),
 'overrides',(select jsonb_agg(to_jsonb(t) order by company_id,user_id,capability_id) from erp_security_user_capability_overrides t),
 'auth',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),'userProfiles',(select jsonb_agg(to_jsonb(t) order by user_id) from user_profiles t),
 'versions',(select jsonb_agg(to_jsonb(v) order by company_id) from erp_security_permission_versions v),'audit',(select jsonb_agg(to_jsonb(t) order by id) from erp_access_audit_log t)) v`);
 const test=async(name,fn)=>{await run('reset role;begin');try{await fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:e.message});}finally{await run('rollback;reset role');}};
 try{
  await run(fs.readFileSync('tests/fixtures/sri-dual-configuration-fixture.sql','utf8'));
  await run(fs.readFileSync('tests/fixtures/existing-user-membership-dependencies.sql','utf8'));
  await run(fs.readFileSync('supabase/migrations/202609060007_user_access_profile_overrides.sql','utf8'));
  await run(`insert into auth.users values('${A}'),('${U}'),('${O}');
   insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values
    ('${B}','COMP-BLESS-FLOWER','COMP-BLESS-FLOWER','Synthetic B','Synthetic B','1717637084001'),
    ('${I}','COMP-IMPERIO-FLOWERS','COMP-IMPERIO-FLOWERS','Synthetic I','Synthetic I','1727970137001');
   insert into user_profiles(user_id,display_name,username,default_company_id) values('${A}','Admin fixture','admin', '${B}'),('${U}','Alex fixture','alex','${B}'),('${O}','Owner fixture','owner','${B}');
   insert into user_company_memberships(company_id,user_id,membership_role,membership_status,is_default) values
    ('${B}','${A}','OWNER','ACTIVE',true),('${I}','${A}','OWNER','ACTIVE',false),('${B}','${U}','EDITOR','ACTIVE',true),('${B}','${O}','OWNER','ACTIVE',true);
   insert into erp_security_profiles(profile_id,display_name,description,active) values('COMERCIAL','Synthetic commercial','Fixture',true),('INACTIVE_FIXTURE','Inactive','Fixture',false) on conflict do nothing;
   insert into erp_security_user_company_profiles(company_id,user_id,profile_id) values('${B}','${U}','COMERCIAL');
   insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) values
    ('${B}','${A}','admin.users.manage','GRANT','Fixture'),('${I}','${A}','admin.users.manage','GRANT','Fixture'),('${B}','${U}','admin.users.view','DENY','Preserve BLESS');`);
  const migration=fs.readFileSync('supabase/migrations/202609080002_existing_user_company_membership.sql','utf8');
  const before=await snapshot();await run(migration);await run(migration);assert.deepEqual(await snapshot(),before);results.push({name:'Migration twice has zero user/data mutations',result:'PASS'});
  await test('Add existing Alex: active IMPERIO role/profile, BLESS and Auth byte-for-byte unchanged, refresh, duplicate and operation retry',async()=>{
    const old=await snapshot(), op=randomUUID();await login();const first=await call(I,U,'EDITOR','COMERCIAL',op);
    assert.equal(first.created,true);assert.equal(first.membership.company_id,I);assert.equal(first.membership.membership_role,'EDITOR');assert.equal(first.membership.membership_status,'ACTIVE');assert.equal(first.profile_id,'COMERCIAL');assert.equal(first.membership.is_default,false);assert.deepEqual(first.overrides,[]);
    const read=await scalar('select erp_admin_preview_user_access_plan($1,$2) v',[I,U]);assert.equal(read.state_token,first.state_token);
    await run('reset role');const after=await snapshot();assert.deepEqual(after.versions.filter(v=>v.company_id===B),old.versions.filter(v=>v.company_id===B));assert.deepEqual(after.auth,old.auth);assert.deepEqual(after.userProfiles,old.userProfiles);
    assert.deepEqual(after.memberships.filter(m=>m.company_id===B),old.memberships.filter(m=>m.company_id===B));
    assert.deepEqual(after.profiles.filter(m=>m.company_id===B),old.profiles.filter(m=>m.company_id===B));assert.deepEqual(after.overrides,old.overrides);
    await login();const second=await call(I,U,'EDITOR','COMERCIAL',op);assert.equal(second.created,false);assert.equal(second.membership.id,first.membership.id);
    const repeated=await call();assert.equal(repeated.already_member,true);await run('reset role');assert.deepEqual(await snapshot(),after);
  });
  await test('Existing membership with a different requested role is reread, never overwritten',async()=>{
    await login();const first=await call();const next=await call(I,U,'VIEWER');assert.equal(next.membership.id,first.membership.id);assert.equal(next.membership.membership_role,'EDITOR');
  });
  await test('RPC transaction rollback when audit fails leaves no partial membership/profile',async()=>{
    await run(`alter table erp_access_audit_log add constraint synthetic_failure check(reason_code<>'EXISTING_USER_MEMBERSHIP_ADDED')`);const old=await snapshot();await login();await rejected(call,/synthetic_failure/);await run('reset role');assert.deepEqual(await snapshot(),old);
  });
  for(const [name,setup,args,error] of [
   ['SELF elevation','',[I,A],/SELF_ELEVATION/],
   ['Missing Auth','',[I,randomUUID()],/AUTH_USER_REQUIRED/],
   ['Inactive target',`update user_profiles set is_active=false where user_id='${U}'`,[],/ACTIVE_EXISTING_USER_PROFILE/],
   ['Inactive profile','',[I,U,'EDITOR','INACTIVE_FIXTURE'],/ACTIVE_CANONICAL_PROFILE/],
   ['Invalid role','',[I,U,'SUPERADMIN'],/MEMBERSHIP_ROLE_INVALID/],
   ['Reason required','',[I,U,'EDITOR','COMERCIAL',randomUUID(),''],/MEMBERSHIP_REQUEST/],
   ['OWNER without capability',`delete from erp_security_user_capability_overrides where user_id='${A}' and company_id='${I}'`,[],/CAPABILITY_REQUIRED/],
   ['DENY wins',`update erp_security_user_capability_overrides set effect='DENY' where user_id='${A}' and company_id='${I}'`,[],/CAPABILITY_REQUIRED/],
   ['Inactive actor membership',`update user_company_memberships set membership_status='SUSPENDED' where user_id='${A}' and company_id='${I}'`,[],/MEMBERSHIP|CAPABILITY/],
   ['Expired actor membership',`update user_company_memberships set valid_until=current_date-1 where user_id='${A}' and company_id='${I}'`,[],/MEMBERSHIP|CAPABILITY|ADMIN/],
   ['BLESS-only actor cannot add IMPERIO',`delete from erp_security_user_capability_overrides where user_id='${A}' and company_id='${I}';delete from user_company_memberships where user_id='${A}' and company_id='${I}'`,[],/MEMBERSHIP|CAPABILITY/],
   ['ADMIN cannot assign OWNER',`update user_company_memberships set membership_role='ADMIN' where user_id='${A}' and company_id='${I}'`,[I,U,'OWNER'],/OWNER_ROLE_ASSIGNMENT/],
   ['Inactive company',`update companies set is_active=false where id='${I}'`,[],/MEMBERSHIP|CAPABILITY/]
  ]) await test(name,async()=>{if(setup)await run(setup);const old=await snapshot();await login();await rejected(()=>call(...args),error);await run('reset role');assert.deepEqual(await snapshot(),old);});
  await test('Operation context cannot be replayed with a new company, profile, actor or role',async()=>{
   await login();const op=randomUUID();await call(I,U,'EDITOR','COMERCIAL',op);await rejected(()=>call(B,U,'EDITOR','COMERCIAL',op),/CONTEXT_MISMATCH/);
  });
  for(const role of ['anon','service_role'])await test(role+' cannot call RPC',async()=>{await login(A,role);await rejected(call,/permission denied/);});
 }finally{await db.close();}
 console.log(JSON.stringify({result:results.every(r=>r.result==='PASS')?'PASS':'FAIL',tests:results,realAuthUsersCreated:0,realMembershipMutations:0,realDatabaseCalls:0},null,2));
 if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
