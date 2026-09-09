// Isolated PostgreSQL (PGlite), synthetic fiscal rows only. No credentials or HTTP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { endpointFor } = require('./api/sri/_lib/environment.cjs');
const B = 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5';
const I = 'ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const A = '11000000-0000-4000-8000-000000000001';
const O = '22000000-0000-4000-8000-000000000002';
const migrationPath = 'supabase/migrations/202609090003_sri_document_manager.sql';
const results = [];
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";

async function main() {
  const db = new PGlite();
  const run = sql => db.exec(sql);
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  let sequence = 750;
  async function login(actor = A, role = 'service_role') {
    await run(`reset role;select set_config('request.jwt.claim.sub',${literal(actor)},false),set_config('request.jwt.claim.role',${literal(role)},false),set_config('request.jwt.claims',${literal(JSON.stringify({ sub: actor, role }))},false);set role ${role};`);
  }
  async function test(name, fn) {
    try { await run('reset role'); await fn(); results.push({ name, result: 'PASS' }); }
    catch (error) { results.push({ name, result: 'FAIL', error: error.message, where: error.where, position: error.position, internalPosition: error.internalPosition, internalQuery: error.internalQuery }); }
    finally { await run('rollback;reset role'); }
  }
  async function denied(fn, message) {
    await assert.rejects(fn, error => error.message.includes(message));
  }
  async function snapshot() {
    return one(`select
      (select jsonb_agg(to_jsonb(x) order by id) from electronic_documents x) documents,
      (select jsonb_agg(to_jsonb(x) order by company_id,environment,document_type) from electronic_document_sequences x) sequences,
      (select jsonb_agg(to_jsonb(x) order by document_id) from accounting_document_links x) accounting,
      (select jsonb_agg(to_jsonb(x) order by id) from journal_entries x) journals,
      (select jsonb_agg(to_jsonb(x) order by company_id) from sri_settings x) settings,
      (select jsonb_agg(to_jsonb(x) order by id) from digital_certificates x) certificates,
      (select count(*) from commercial_invoice_reservations) reservations`);
  }
  const claim = (d, worker = `manual-auth-${randomUUID()}`, actor = A, company = d.company) =>
    one('select claim_sri_manual_authorization($1,$2,$3,$4,$5) r', [d.queryJob, worker, company, d.id, actor]);
  const owns = (j, actor = A) => one('select assert_sri_manual_authorization_claim($1,$2,$3,$4) r',
    [j.id, j.worker_id, j.claim_attempt.id, actor]);
  const settle = (j, success = false, errorClass = 'SRI_TRANSPORT_RESULT_UNCERTAIN') =>
    one('select settle_sri_manual_authorization($1,$2,$3,$4,$5,$6,$7,$8,$9) r',
      [j.id, j.worker_id, j.claim_attempt.id, A, success, success ? 'b'.repeat(64) : null, success ? 200 : null,
        success ? null : errorClass, success ? null : 'El comprobante todavia no aparece en autorizacion del SRI.']);
  const automatic = d => one('select claim_sri_transmission($1,$2) r', [d.receptionJob, `api-${randomUUID()}`]);
  async function fixture({ company = B, environment = 'PRODUCTION', type = '07', status = 'PENDIENTE_REINTENTO', parent = null } = {}) {
    await run('reset role');
    if (type === '04' && !parent) parent = (await fixture({ company, environment, type: '01', status: 'AUTORIZADO' })).id;
    const d = { id: randomUUID(), company, environment, type, queryJob: randomUUID(), receptionJob: randomUUID(), journal: randomUUID(), sequential: sequence++ };
    await db.query(`insert into electronic_documents(id,company_id,emission_point_id,document_type,status,issue_date,environment,establishment_code,emission_point_code,
      sequential,sequential_text,full_number,numeric_code,verification_digit,access_key,authorization_number,authorized_at,xml_version,xsd_version,issuer_snapshot,source_snapshot,created_by,parent_document_id)
      select $1,s.company_id,p.id,$4,$5,date.dt,$3,'001','002',$6,lpad($6::text,9,'0'),'001-002-'||lpad($6::text,9,'0'),'85230878',right(v.key,1)::int,v.key,
      case when $5='AUTORIZADO' then v.key else null end,case when $5='AUTORIZADO' then clock_timestamp() else null end,case when $4='07' then '2.0.0' else '1.1.0' end,case when $4='07' then '2.0.0' else '1.1.0' end,
      jsonb_build_object('ruc',s.ruc),'{}',$7,$8 from sri_settings s join emission_points p on p.company_id=s.company_id and p.environment=$3
      cross join lateral(select (clock_timestamp() at time zone 'America/Guayaquil')::date dt) date
      cross join lateral(select sri_build_access_key(date.dt,$4,s.ruc,$3,'001','002',$6,'85230878') key) v where s.company_id=$2`,
    [d.id, company, environment, type, status, d.sequential, A, parent]);
    await db.query(`insert into sri_transmissions(id,company_id,document_id,transmission_type,environment,endpoint_url,status,idempotency_key,
      attempt_number,max_attempts,next_attempt_at,worker_id,claimed_at,finished_at,error_class,http_status)
      values($1,$2,$3,'AUTHORIZATION_QUERY',$4,$5,'FAILED',$3::uuid::text||':AUTHORIZATION_QUERY',12,12,null,'api-fixture',now()-interval '20 minutes',now()-interval '10 minutes','SRI_TRANSPORT_RESULT_UNCERTAIN',200),
      ($6,$2,$3,'RECEPTION',$4,$7,'RETRY_SCHEDULED',$3::uuid::text||':RECEPTION',1,12,now()-interval '1 minute','api-fixture-reception',now()-interval '30 minutes',now()-interval '25 minutes','SRI_TRANSPORT_RESULT_UNCERTAIN',500)`,
    [d.queryJob, company, d.id, environment, endpointFor(environment, 'AUTHORIZATION_QUERY'), d.receptionJob, endpointFor(environment, 'RECEPTION')]);
    await db.query(`insert into sri_transmission_attempts(company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256,
      started_at,finished_at,error_class,retryable,http_status)
      select $1,$2,$3,n,'FAILED',$4,encode(sha256(convert_to(access_key,'UTF8')),'hex'),now()-interval '20 minutes'+n*interval '1 second',
      now()-interval '10 minutes'+n*interval '1 second','SRI_TRANSPORT_RESULT_UNCERTAIN',false,200 from electronic_documents cross join generate_series(1,12) n where id=$2`,
    [company, d.id, d.queryJob, endpointFor(environment, 'AUTHORIZATION_QUERY')]);
    await db.query('insert into accounting_document_links values($1,$2,$3)', [company, d.id, 'POSTED']);
    await db.query('insert into journal_entries values($1,$2,$3)', [d.journal, company, d.id]);
    return d;
  }
  async function ageManual(j) {
    await run('reset role');
    await db.query("update sri_transmissions set claimed_at=clock_timestamp()-interval '181 seconds' where id=$1", [j.id]);
    await db.query(`update electronic_document_audit_logs set new_values=jsonb_set(new_values,'{claimed_at}',to_jsonb((select claimed_at from sri_transmissions where id=$1)))
      where action='SRI_MANUAL_AUTHORIZATION_CLAIMED' and new_values->>'worker_id'=$2`, [j.id, j.worker_id]);
  }
  try {
    await run(fs.readFileSync('tests/fixtures/sri-dual-configuration-fixture.sql', 'utf8'));
    await run(`create table sri_responses(id uuid primary key default gen_random_uuid(),company_id uuid not null,document_id uuid not null,
      transmission_id uuid not null,response_type text not null,sri_status text,content_sha256 text not null);
      create table journal_entries(id uuid primary key,company_id uuid,document_id uuid);
      insert into auth.users values('${A}'),('${O}');insert into user_profiles(user_id) values('${A}'),('${O}');
      insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values
      ('${B}','FIXTURE_B','FIXTURE_B','Fixture B','Fixture B','1717637084001'),('${I}','FIXTURE_I','FIXTURE_I','Fixture I','Fixture I','1727970137001');
      insert into user_company_memberships(company_id,user_id,membership_status,membership_role) values
      ('${B}','${A}','ACTIVE','OWNER'),('${I}','${A}','ACTIVE','OWNER'),('${B}','${O}','ACTIVE','OWNER');
      insert into sri_company_memberships(company_id,auth_user_id,role_code,active) values('${B}','${A}','ADMIN',true),('${I}','${A}','ADMIN',true);
      insert into sri_settings(company_id,legal_name,ruc,head_office_address,test_enabled,production_enabled,withholding_agent_number,technical_spec_version)
      values('${B}','Fixture B','1717637084001','Fixture',true,false,'10','2.34'),('${I}','Fixture I','1727970137001','Fixture',true,false,null,'2.34');
      insert into digital_certificates(company_id,alias,storage_object_path,password_secret_name,subject_ruc,fingerprint_sha256,active,validation_status,valid_from,valid_until,last_validated_at)
      select id,'Fixture','companies/'||id||'/certificates/'||repeat('a',64)||'.p12',case id when '${B}' then 'SRI_P12_PASSWORD_BLESS' else 'SRI_P12_PASSWORD_IMPERIO' end,
      tax_id,repeat('a',64),true,'VALID',now()-interval '1 day',now()+interval '1 year',now() from companies;
      insert into storage.objects select storage_bucket,storage_object_path from digital_certificates;
      insert into emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address,active)
      select id,e,'001','002','Fixture',true from companies cross join(values('TEST'),('PRODUCTION')) v(e);
      insert into electronic_document_sequences(company_id,environment,emission_point_id,document_type,next_value)
      select company_id,environment,id,t,800 from emission_points cross join(values('01'),('04'),('07')) v(t);`);
    await run(`insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description)
      values('commercial.electronic_documents.authorize','commercial','electronic_documents','authorize','HIGH','Fixture') on conflict do nothing;
      insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
      select id,'${A}','commercial.electronic_documents.authorize','GRANT','Fixture' from companies;`);
    for (const file of ['202609070020_sri_dual_environment_configuration.sql', '202609070021_sri_dual_environment_document_guards.sql']) {
      await run(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    }
    await run('update sri_settings set production_enabled=true');
    await run(fs.readFileSync('supabase/migrations/202609080005_sri_manual_authorization_recovery.sql','utf8'));
    await run(`alter table sri_responses add column received_at timestamptz default now();
      alter table electronic_document_files add column id uuid primary key default gen_random_uuid(),add column company_id uuid,
      add column file_type text,add column storage_bucket text,add column storage_object_path text,add column content_type text,
      add column content_sha256 text,add column size_bytes bigint,add column schema_version text,add column immutable boolean,
      add column created_by uuid,add column created_at timestamptz default clock_timestamp(),add unique(document_id,file_type,content_sha256);`);
    const original750 = await fixture();
    await test('Actual failure reproduced: finished AUTHORIZATION_QUERY FAILED 12/12 raises explicit 55P03', async () => {
      await login();
      await assert.rejects(() => one('select claim_sri_transmission($1,$2)', [original750.queryJob, `api-${randomUUID()}`]),
        error => error.code === '55P03' && error.message.includes('SRI_TRANSMISSION_NOT_CLAIMABLE'));
    });
    await test('Forward migration twice leaves all existing fiscal rows and claims untouched', async () => {
      const before = await snapshot();
      const jobsBefore = await one('select jsonb_agg(to_jsonb(j) order by id) jobs from sri_transmissions j');
      await run(fs.readFileSync(migrationPath, 'utf8'));
      await run(fs.readFileSync(migrationPath, 'utf8'));
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await one('select jsonb_agg(to_jsonb(j) order by id) jobs from sri_transmissions j'), jobsBefore);
    });
    await test('Manual claim uses same 750, job and key, allocates attempt 13, preserves automatic 12/12', async () => {
      const before = await snapshot();
      const receptionBefore = await one('select to_jsonb(j) r from sri_transmissions j where id=$1', [original750.receptionJob]);
      await login();
      const j = (await claim(original750)).r;
      assert.equal(j.manual_recovery, true);
      assert.equal(j.id, original750.queryJob);
      assert.equal(j.document_id, original750.id);
      assert.equal(j.attempt_number, 12);
      assert.equal(j.max_attempts, 12);
      assert.equal(j.claim_attempt.attempt_number, 13);
      assert.equal(j.claim_attempt.status, 'STARTED');
      assert.equal((await owns(j)).r, true);
      const failed = (await settle(j)).r;
      assert.equal(failed.status, 'FAILED');
      assert.equal(failed.next_attempt_at, null);
      assert.equal(failed.attempt_number, 12);
      await run('reset role');
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await one('select to_jsonb(j) r from sri_transmissions j where id=$1', [original750.receptionJob]), receptionBefore);
    });
    await test('Server cooldown rejects immediate repeated clicks without creating attempts', async () => {
      await login();
      await assert.rejects(() => claim(original750), error => error.code === 'P0001'
        && error.message.includes('SRI_MANAGER_WAIT_SCHEDULED') && JSON.parse(error.hint).retryAfterSeconds > 0);
    });
    await test('20 simultaneous manual claims yield exactly one active attempt', async () => {
      const d = await fixture(); const before = await snapshot(); await login();
      const concurrent = await Promise.allSettled(Array.from({ length: 20 }, () => claim(d)));
      assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
      const rejected = concurrent.filter(item => item.status === 'rejected');
      assert.equal(rejected.length, 19);
      assert.ok(rejected.every(item => item.reason.code === '55P03' && item.reason.message.includes('ALREADY_PROCESSING')));
      await run('reset role');
      assert.equal((await one("select count(*)::int n from sri_transmission_attempts where document_id=$1 and status='STARTED'", [d.id])).n, 1);
      assert.deepEqual(await snapshot(), before);
    });
    await test('An active valid manual claim blocks a second owner and reception of the same document', async () => {
      const d = await fixture(); await login(); const j = (await claim(d)).r;
      await denied(() => claim(d), 'ALREADY_PROCESSING');
      await denied(() => automatic(d), 'ALREADY_PROCESSING');
      assert.equal((await owns(j)).r, true);
    });
    await test('Active reception blocks a manual authorization query for the same document', async () => {
      const d = await fixture(); await login(); await automatic(d);
      await denied(() => claim(d), 'ALREADY_PROCESSING');
    });
    await test('Audited manual claim beyond 180s is reclaimed atomically and old worker cannot settle', async () => {
      const d = await fixture(); await login(); const old = (await claim(d)).r;
      await ageManual(old); await login(); const current = (await claim(d)).r;
      assert.equal(current.id, old.id); assert.equal(current.attempt_number, 12);
      assert.equal(current.claim_attempt.attempt_number, 14);
      await denied(() => owns(old), 'CLAIM_LOST'); await denied(() => settle(old), 'CLAIM_LOST');
      assert.equal((await owns(current)).r, true);
      await run('reset role');
      assert.equal((await one('select status from sri_transmission_attempts where id=$1', [old.claim_attempt.id])).status, 'FAILED');
      assert.equal((await one("select count(*)::int n from sri_transmission_attempts where document_id=$1 and status='STARTED'", [d.id])).n, 1);
    });
    await test('Legacy PROCESSING remains protected even if it is one hour old', async () => {
      const d = await fixture();
      await db.query("update sri_transmissions set status='PROCESSING',worker_id=$2,claimed_at=now()-interval '1 hour' where id=$1", [d.queryJob, `api-${randomUUID()}`]);
      await login(); await denied(() => claim(d), 'ALREADY_PROCESSING');
    });
    await test('Claimed 750 does not block later retention, invoice 01, NC 04, IMPERIO or TEST', async () => {
      const d = await fixture();
      const later = await fixture();
      const invoice = await fixture({ type: '01' });
      const credit = await fixture({ type: '04' });
      const imperio = await fixture({ company: I, type: '01' });
      const testing = await fixture({ environment: 'TEST' });
      const before = await snapshot(); await login(); await claim(d);
      for (const other of [later, invoice, credit, imperio, testing]) {
        const j = (await automatic(other)).r;
        assert.equal(j.status, 'PROCESSING'); assert.equal(j.document_id, other.id); assert.equal(j.environment, other.environment);
      }
      await run('reset role'); assert.deepEqual(await snapshot(), before);
    });
    await test('NO_ENCONTRADO closes FAILED; next manual query gets attempt 14 without reopening automatic budget', async () => {
      const d = await fixture(); await login(); const j = (await claim(d)).r; await settle(j);
      await run('reset role');
      await db.query("update sri_transmissions set finished_at=now()-interval '31 seconds',claimed_at=now()-interval '40 seconds' where id=$1", [d.queryJob]);
      await login(); const next = (await claim(d)).r;
      assert.equal(next.claim_attempt.attempt_number, 14); assert.equal(next.attempt_number, 12); assert.equal(next.max_attempts, 12);
    });
    await test('Official AUTORIZADO settles same document with no reception, journal or sequence creation', async () => {
      const d = await fixture({ status: 'ENVIADO_SRI' }); const before = await snapshot();
      await login(); const j = (await claim(d)).r;
      await run('reset role');
      const document = await one('select access_key from electronic_documents where id=$1', [d.id]);
      await db.query("insert into sri_responses(company_id,document_id,transmission_id,response_type,sri_status,content_sha256) values($1,$2,$3,'AUTHORIZATION','AUTORIZADO',$4)",
        [d.company, d.id, j.id, 'b'.repeat(64)]);
      await login();
      await one("select record_sri_authorization($1,'<fixture/>','AUTORIZADO',$2,clock_timestamp(),'PRODUCCION','<fixture/>',$3)", [d.id, document.access_key, A]);
      assert.equal((await settle(j, true)).r.status, 'COMPLETED');
      await run('reset role'); const after = await snapshot();
      for (const key of ['sequences', 'accounting', 'journals', 'settings', 'certificates', 'reservations']) assert.deepEqual(after[key], before[key]);
      assert.equal(after.documents.length, before.documents.length);
      const recovered = after.documents.find(row => row.id === d.id);
      assert.equal(recovered.status, 'AUTORIZADO'); assert.equal(recovered.access_key, document.access_key);
      assert.equal(recovered.sequential, d.sequential);
    });
    for (const [name, options, patch, expected] of [
      ['Authorized 07 cannot requery', { status: 'AUTORIZADO' }, null, 'NOT_ELIGIBLE'],
    ]) await test(name, async () => { const d = await fixture(options); if (patch) await patch(d); await login(); await denied(() => claim(d), expected); });
    await test('Wrong company cannot claim target document', async () => {
      const d = await fixture(); await login(); await denied(() => claim(d, undefined, A, I), 'DOCUMENT_NOT_FOUND');
    });
    await test('OWNER without authorization capability cannot claim', async () => {
      const d = await fixture(); await login(O); await denied(() => claim(d, undefined, O), 'CAPABILITY_REQUIRED');
    });
    await test('Another actor cannot settle a manual claim they do not own', async () => {
      const d = await fixture();
      await db.query("insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) values($1,$2,'commercial.electronic_documents.authorize','GRANT','Fixture')", [B, O]);
      await login(); const j = (await claim(d)).r; await login(O); await denied(() => owns(j, O), 'CLAIM_LOST');
    });
    for (const role of ['anon', 'authenticated']) await test(`${role} cannot call any manual claim RPC`, async () => {
      const d = await fixture(); await login(A, role);
      await denied(() => claim(d), 'permission denied');
      await denied(() => one('select assert_sri_manual_authorization_claim($1,$2,$3,$4)', [d.queryJob, `manual-auth-${randomUUID()}`, randomUUID(), A]), 'permission denied');
      await denied(() => one('select settle_sri_manual_authorization($1,$2,$3,$4,false,null,null,$5,$6)',
        [d.queryJob, `manual-auth-${randomUUID()}`, randomUUID(), A, 'SRI_TRANSPORT_RESULT_UNCERTAIN', 'Fixture']), 'permission denied');
    });
    await test('Success without canonical official authorization is rejected', async () => {
      const d = await fixture(); await login(); const j = (await claim(d)).r; await denied(() => settle(j, true), 'OFFICIAL_RESPONSE_REQUIRED');
    });
    await test('TEST manual lookup retains TEST endpoint and automatic budget', async () => {
      const d = await fixture({ environment: 'TEST' }); const before = await snapshot(); await login();
      const j = (await claim(d)).r;
      assert.equal(j.environment, 'TEST'); assert.equal(j.endpoint_url, endpointFor('TEST', 'AUTHORIZATION_QUERY'));
      assert.equal(j.claim_attempt.endpoint_url, j.endpoint_url);
      assert.equal((await settle(j)).r.attempt_number, 12);
      await run('reset role'); assert.deepEqual(await snapshot(), before);
    });
    await test('Mismatched persisted environment fails closed before creating a manual attempt', async () => {
      const d = await fixture();
      await run('alter table sri_transmissions disable trigger sri_transmissions_validate_environment');
      try { await db.query("update sri_transmissions set environment='TEST',endpoint_url=$2 where id=$1", [d.queryJob, endpointFor('TEST', 'AUTHORIZATION_QUERY')]); }
      finally { await run('alter table sri_transmissions enable trigger sri_transmissions_validate_environment'); }
      await login(); await denied(() => claim(d), 'NOT_ELIGIBLE');
    });
    await test('Mismatched persisted idempotency key fails closed', async () => {
      const d = await fixture();
      await db.query('update sri_transmissions set idempotency_key=$2 where id=$1', [d.queryJob, randomUUID()]);
      await login(); await denied(() => claim(d), 'NOT_ELIGIBLE');
    });
    await test('Worker must have a manual UUID identity', async () => {
      const d = await fixture(); await login(); await denied(() => claim(d, 'api-not-manual'), 'WORKER_REQUIRED');
    });
    await test('PRODUCTION disabled guard is preserved', async () => {
      const d = await fixture();
      await db.query('update sri_settings set production_enabled=false where company_id=$1', [B]);
      try { await login(); await denied(() => claim(d), 'PRODUCTION_DISABLED'); }
      finally { await run('reset role'); await db.query('update sri_settings set production_enabled=true where company_id=$1', [B]); }
    });
    await test('Capability revoked after claim blocks ownership and settlement', async () => {
      const d = await fixture(); await login(); const j = (await claim(d)).r; await run('reset role');
      await db.query("update erp_security_user_capability_overrides set effect='DENY' where company_id=$1 and user_id=$2", [B, A]);
      try { await login(); await denied(() => owns(j), 'CAPABILITY_REQUIRED'); await denied(() => settle(j), 'CAPABILITY_REQUIRED'); }
      finally { await run('reset role'); await db.query("update erp_security_user_capability_overrides set effect='GRANT' where company_id=$1 and user_id=$2", [B, A]); }
    });
    await test('Expired ownership is rejected before a replacement claim exists', async () => {
      const d = await fixture(); await login(); const j = (await claim(d)).r;
      await ageManual(j); await login(); await denied(() => owns(j), 'CLAIM_LOST'); await denied(() => settle(j), 'CLAIM_LOST');
    });
    await test('Wrong attempt id and wrong worker cannot finalize current manual work', async () => {
      const d = await fixture(); await login(); const j = (await claim(d)).r;
      await denied(() => owns({ ...j, claim_attempt: { ...j.claim_attempt, id: randomUUID() } }), 'CLAIM_LOST');
      await denied(() => settle({ ...j, worker_id: `manual-auth-${randomUUID()}` }), 'CLAIM_LOST');
      assert.equal((await owns(j)).r, true);
    });
    for(const type of ['01','04','07'])await test(type+' manual recovery works before/after automatic budget without resetting it',async()=>{
      for(const count of [0,5,12]){
        const d=await fixture({type});await db.query("update sri_transmissions set attempt_number=$2,status='RETRY_SCHEDULED',next_attempt_at=now()-interval '1 minute' where id=$1",[d.queryJob,count]);
        await login();const job=(await claim(d)).r;assert.equal(job.attempt_number,count);assert.equal((await owns(job)).r,true);await settle(job);
      }
    });
    await test('Active wait uses P0001 WAIT, not 55P03, and expiry allows evaluation',async()=>{
      const d=await fixture();await db.query("update sri_transmissions set next_attempt_at=now()+interval '1 hour' where id=$1",[d.queryJob]);await login();
      await assert.rejects(()=>claim(d),e=>e.code==='P0001'&&e.message==='SRI_MANAGER_WAIT_SCHEDULED');
      await run('reset role');await db.query("update sri_transmissions set next_attempt_at=now()-interval '1 second' where id=$1",[d.queryJob]);await login();assert.equal((await claim(d)).r.document_id,d.id);
    });
    const control=(d,action,op,version)=>one('select erp_sri_manager_control($1,$2,$3,$4,$5,$6) r',[d.company,d.id,action,op,version,'Fixture manual review']);
    await test('Pause is scoped, atomic, audited, idempotent and makes zero fiscal changes',async()=>{
      const d=await fixture(),other=await fixture({company:I,type:'01'}),before=await snapshot(),op=randomUUID();
      await login(A,'authenticated');const paused=(await control(d,'PAUSE',op,0)).r;assert.equal(paused.management.automatic_paused,true);
      assert.equal((await control(d,'PAUSE',op,0)).r.reused,true);
      await login();await denied(()=>automatic(d),'MANUAL_REVIEW_REQUIRED');
      const due=(await db.query('select * from erp_sri_manager_due_jobs(25)')).rows;assert.ok(due.every(j=>j.document_id!==d.id));
      assert.equal((await automatic(other)).r.document_id,other.id);
      // A manual, query-only recovery remains possible while the scheduler is paused.
      assert.equal((await claim(d)).r.document_id,d.id);
      await run('reset role');assert.deepEqual(await snapshot(),before);
    });
    await test('Pause/resume denies stale version and unauthorized or mismatched actor/company',async()=>{
      const d=await fixture(),op=randomUUID();await login(A,'authenticated');await control(d,'PAUSE',op,0);
      await denied(()=>control(d,'RESUME',randomUUID(),0),'STALE_VERSION');
      await denied(()=>control({...d,company:I},'RESUME',randomUUID(),1),'DOCUMENT_NOT_FOUND');
      await login(O,'authenticated');await run('reset role');await db.query("delete from erp_security_user_capability_overrides where user_id=$1 and capability_id='commercial.electronic_documents.authorize'",[O]);
      await login(O,'authenticated');await denied(()=>control(d,'RESUME',randomUUID(),1),'CAPABILITY_REQUIRED');
      await login(A,'authenticated');assert.equal((await control(d,'RESUME',randomUUID(),1)).r.management.automatic_paused,false);
    });
    await test('Application roles cannot commit corrections or read scheduler jobs',async()=>{
      for(const role of ['anon','authenticated']){await login(A,role);await denied(()=>one('select * from erp_sri_manager_due_jobs(25)'),'permission denied');
        await denied(()=>one("select erp_sri_manager_commit_correction($1,$2,$3,$4,0,now(),'Fixture','{}',$5,'[]')",[B,randomUUID(),A,randomUUID(),randomUUID()]),'permission denied');}
    });
    await test('External evidence mismatch cannot authorize or mutate a document',async()=>{
      const d=await fixture();await run('reset role');await db.query("insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) values($1,$2,'commercial.electronic_documents.reconcile','GRANT','Fixture')",[B,A]);
      const before=await snapshot();await login(A,'authenticated');
      await denied(()=>one("select erp_sri_manager_record_evidence($1,$2,$3,'Fixture',$4,$4,null)",[B,d.id,randomUUID(),'1'.repeat(49)]),'IDENTITY_MISMATCH');
      await run('reset role');assert.deepEqual(await snapshot(),before);
    });
    await test('Atomic source correction preserves identity and versions; stale and repeated requests cannot duplicate',async()=>{
      const d=await fixture({type:'01',status:'BORRADOR'});await run('reset role');
      await db.query('delete from sri_transmission_attempts where document_id=$1',[d.id]);await db.query('delete from sri_transmissions where document_id=$1',[d.id]);
      await db.query("insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description) values('commercial.electronic_documents.correct','commercial','electronic_documents','correct','HIGH','Fixture') on conflict do nothing");
      await db.query("insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) values($1,$2,'commercial.electronic_documents.correct','GRANT','Fixture')",[B,A]);
      const original=(await one('select to_jsonb(d) d from electronic_documents d where id=$1',[d.id])).d;
      const cert=(await one('select id from digital_certificates where company_id=$1',[B])).id;
      const files=['SOURCE_JSON','UNSIGNED_XML','XSD_REPORT','SIGNED_XML'].map((type,index)=>({company_id:B,document_id:d.id,file_type:type,storage_bucket:'sri-private',storage_object_path:`companies/${B}/documents/${d.id}/${type.toLowerCase()}-${String(index+1).repeat(64)}.${['SOURCE_JSON','XSD_REPORT'].includes(type)?'json':'xml'}`,content_sha256:String(index+1).repeat(64),size_bytes:100,schema_version:'1.1.0',created_by:A}));
      for(const f of files)await db.query('insert into storage.objects values($1,$2)',[f.storage_bucket,f.storage_object_path]);
      const args=[B,d.id,A,randomUUID(),0,original.updated_at,'Fixture correction',{notes:'Version two'},cert,files];
      const call=params=>one('select erp_sri_manager_commit_correction($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r',params);
      const before=await snapshot();await login();const result=(await call(args)).r;assert.equal(result.document.status,'FIRMADO');assert.equal(result.revision,2);
      for(const k of ['id','company_id','environment','access_key','sequential','issue_date','source_order_id','parent_document_id','grand_total'])assert.deepEqual(result.document[k],original[k]);
      assert.equal((await call(args)).r.reused,true);
      await denied(()=>call([...args.slice(0,3),randomUUID(),...args.slice(4)]),'STALE_VERSION');
      await run('reset role');const after=await snapshot();for(const k of ['sequences','accounting','journals','certificates','settings','reservations'])assert.deepEqual(after[k],before[k]);
      assert.equal((await one('select count(*)::int n from electronic_document_files where document_id=$1',[d.id])).n,4);
      assert.equal((await one('select count(*)::int n from erp_sri_document_manager_events where document_id=$1',[d.id])).n,1);
    });

    await test('Server list filters exact company/environment/number and refuses unknown environments',async()=>{
      const d=await fixture({company:I,type:'01',environment:'TEST'});await run('reset role');
      await db.query("insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description) values('commercial.electronic_documents.view','commercial','electronic_documents','view','LOW','Fixture') on conflict do nothing");
      await db.query("insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) values($1,$2,'commercial.electronic_documents.view','GRANT','Fixture') on conflict do nothing",[I,A]);
      await login(A,'authenticated');const r=(await one('select erp_sri_manager_list($1,$2) r',[I,{environment:'TEST',sequential:String(d.sequential),documentType:'01'}])).r;
      assert.equal(r.total,1);assert.equal(r.rows[0].id,d.id);assert.equal(r.rows[0].company_id,I);
      await denied(()=>one('select erp_sri_manager_list($1,$2)',[I,{environment:'PROD'}]),'ENVIRONMENT_INVALID');
      await login(O,'authenticated');await denied(()=>one('select erp_sri_manager_list($1,$2)',[I,{}]),'AUTHENTICATED_COMPANY_ACTOR_REQUIRED');
    });
    for(const type of ['01','04'])await test(type+' cancellation follow-up never changes fiscal state or accounting; final annulment is blocked',async()=>{
      const d=await fixture({type,status:'AUTORIZADO'});await run('reset role');
      await db.query("insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description) values('commercial.electronic_documents.annul','commercial','electronic_documents','annul','HIGH','Fixture') on conflict do nothing");
      await db.query("insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) values($1,$2,'commercial.electronic_documents.annul','GRANT','Fixture') on conflict do nothing",[B,A]);
      const doc=await one('select * from electronic_documents where id=$1',[d.id]),before=await snapshot(),op=randomUUID();
      const call=(action,id,version,evidence={})=>one('select erp_sri_manager_cancellation_tracking($1,$2,$3,$4,$5,$6,$7,$8) r',[B,d.id,id,action,version,doc.updated_at,'Fixture request',evidence]);
      await login(A,'authenticated');assert.equal((await call('REQUEST',op,0)).r.fiscalStatus,'AUTORIZADO');assert.equal((await call('REQUEST',op,0)).r.reused,true);
      assert.equal((await call('SUBMIT_PORTAL_REFERENCE',randomUUID(),1,{accessKey:doc.access_key,reference:'Portal fixture'})).r.finalAnnulmentBlocked,true);
      await denied(()=>call('CONFIRM_OFFICIAL_ANNULMENT',randomUUID(),2),'REQUEST_INVALID');
      await run('reset role');assert.deepEqual(await snapshot(),before);
    });
    const passed = results.filter(result => result.result === 'PASS').length;
    console.log(JSON.stringify({ result: passed === results.length ? 'PASS' : 'FAIL', passed, total: results.length, results,
      concurrencyEngine: 'PGlite PostgreSQL, concurrent submitted claims with committed durable ownership',
      productionCalls: 0, productionWrites: 0, sriNetworkCalls: 0 }, null, 2));
    process.exitCode = passed === results.length ? 0 : 1;
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.stack, error.where || ''); process.exitCode = 1; });
