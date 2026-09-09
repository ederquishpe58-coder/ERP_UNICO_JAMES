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
const migrationPath = 'supabase/migrations/202609090005_sri_manual_same_document_retry.sql';
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
    await run(fs.readFileSync('supabase/migrations/202609090003_sri_document_manager.sql','utf8'));
    await run(`alter table sri_responses add column raw_xml text, add column payload jsonb; create table sri_error_messages(id uuid primary key default gen_random_uuid(),company_id uuid,document_id uuid,identifier text); grant select on accounting_document_links,journal_entries,commercial_invoice_reservations,digital_certificates,sri_transmission_attempts,sri_transmissions to service_role;`);
    await run(fs.readFileSync(migrationPath,'utf8'));
    async function eligible(config={}) {
      const d=await fixture(config);const document=(await one('select to_jsonb(d) d from electronic_documents d where id=$1',[d.id])).d;
      const file=randomUUID(),send=randomUUID(),response=randomUUID(),hash='a'.repeat(64);
      const raw=`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>${document.access_key}</claveAccesoConsultada><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>`;
      const responseHash=require('node:crypto').createHash('sha256').update(raw).digest('hex');
      await db.query(`insert into electronic_document_files(id,company_id,document_id,file_type,storage_bucket,storage_object_path,content_sha256) values($1,$2,$3,'SIGNED_XML','sri-private',$4,$5)`,[file,d.company,d.id,`companies/${d.company}/documents/${d.id}/signed_xml-${hash}.xml`,hash]);
      await db.query('update sri_transmissions set request_file_id=$1 where id=$2',[file,d.receptionJob]);
      await db.query(`insert into sri_transmission_attempts(id,company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256,http_status,started_at,finished_at) values($1,$2,$3,$4,1,'FAILED',$5,$6,500,now()-interval '26 minutes',now()-interval '25 minutes')`,[send,d.company,d.id,d.receptionJob,endpointFor(d.environment,'RECEPTION'),hash]);
      await db.query(`insert into electronic_document_audit_logs(company_id,document_id,actor_type,action,new_values) values($1,$2,'SYSTEM','TRANSPORT_DIAGNOSTIC',$3)`,[d.company,d.id,{phase:'RECEPTION',attemptId:send,transmissionId:d.receptionJob,transport:{environment:d.environment,httpStatus:500,response:{faultCode:'soap:Server',faultString:'JBAS014559: Invocation cannot proceed as component is shutting down'}}}]);
      await db.query(`insert into sri_responses(id,company_id,document_id,transmission_id,response_type,sri_status,content_sha256,raw_xml,payload) values($1,$2,$3,$4,'AUTHORIZATION','NO_ENCONTRADO',$5,$6,$7)`,[response,d.company,d.id,d.queryJob,responseHash,raw,{state:'NO_ENCONTRADO',accessKey:document.access_key,documentCount:0,authorized:false,messages:[],authorizations:[]}]);
      await db.query('update sri_transmission_attempts set response_sha256=$1 where transmission_id=$2',[responseHash,d.queryJob]);
      await login();const j=(await claim(d)).r;
      const args=[d.company,d.id,A,randomUUID(),j.id,j.worker_id,j.claim_attempt.id,response,file,document,{validation:'PASS',signedXmlHash:hash,finalLookupHash:responseHash}];
      return {d,j,args,hash};
    }
    const handoff=x=>one('select claim_sri_manual_same_document_reception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r',x.args);
    const receptionOwns=j=>one('select assert_sri_manual_reception_claim($1,$2,$3,$4) r',[j.id,j.worker_id,j.claim_attempt.id,A]);
    await test('Migration repeated: existing documents/sequences/accounting unchanged',async()=>{const before=await snapshot();await run(fs.readFileSync(migrationPath,'utf8'));assert.deepEqual(await snapshot(),before);});
    for(const environment of ['TEST','PRODUCTION'])for(const type of ['01','04','07'])await test(`${type} ${environment}: atomic handoff keeps fiscal identity, counters, accounting`,async()=>{
      const x=await eligible({environment,type}),before=await snapshot();const counters=await one('select jsonb_agg(jsonb_build_array(id,attempt_number,max_attempts) order by id) v from sri_transmissions');
      const j=(await handoff(x)).r;assert.equal(j.manual_same_document,true);assert.equal(j.document_id,x.d.id);assert.equal(j.request_file_id,x.args[8]);assert.equal(j.claim_attempt.request_sha256,x.hash);assert.equal((await receptionOwns(j)).r,true);
      assert.deepEqual(await snapshot(),before);assert.deepEqual(await one('select jsonb_agg(jsonb_build_array(id,attempt_number,max_attempts) order by id) v from sri_transmissions'),counters);
      assert.equal((await one("select count(*)::int n from sri_transmissions where document_id=$1 and status='PROCESSING'",[x.d.id])).n,1);
    });
    await test('20 simultaneous confirms: only one handoff and active reception',async()=>{const x=await eligible();const results=await Promise.allSettled(Array.from({length:20},()=>handoff(x)));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await one("select count(*)::int n from sri_transmission_attempts where document_id=$1 and status='STARTED'",[x.d.id])).n,1);});
    await test('Active manual reception blocks queries and automatic reception',async()=>{const x=await eligible();await handoff(x);await assert.rejects(()=>claim(x.d),/SRI_TRANSMISSION_ALREADY_PROCESSING/);await assert.rejects(()=>automatic(x.d),/SRI_TRANSMISSION_ALREADY_PROCESSING|SRI_TRANSMISSION_NOT_CLAIMABLE/);});
    await test('Document A does not block B or IMPERIO or TEST',async()=>{const a=await eligible();await handoff(a);for(const config of [{},{company:I,type:'01'},{environment:'TEST'}]){const b=await eligible(config);assert.equal((await handoff(b)).r.document_id,b.d.id);}});
    for(const [name,index,value]of [['company',0,I],['actor',2,O],['document',1,randomUUID()],['file',8,randomUUID()],['snapshot',9,{}],['validation',10,{}]])await test('Tampered '+name+' BLOCKED',async()=>{const x=await eligible();x.args[index]=value;await assert.rejects(()=>handoff(x));});
    for(const code of ['43','45','70'])await test('Registered/processing '+code+' BLOCKED',async()=>{const x=await eligible();await run('reset role');await db.query("insert into sri_error_messages(document_id,company_id,identifier) values($1,$2,$3)",[x.d.id,B,code]);await login();await assert.rejects(()=>handoff(x),/FISCAL_RESPONSE_EXISTS/);});
    await test('Single NOT_FOUND or missing XML validation BLOCKED',async()=>{const x=await eligible();await run('reset role');await db.query('update sri_transmission_attempts set response_sha256=null where transmission_id=$1 and attempt_number>1',[x.d.queryJob]);await login();await assert.rejects(()=>handoff(x),/LOOKUP_EVIDENCE_REQUIRED/);});
    await test('Expired manual reception reclaimed to lookup only; old holder fenced',async()=>{
      const x=await eligible();const old=(await handoff(x)).r;await run('reset role');await db.query("update sri_transmissions set claimed_at=clock_timestamp()-interval '181 seconds' where id=$1",[old.id]);
      await db.query("update electronic_document_audit_logs set new_values=jsonb_set(new_values,'{claimed_at}',to_jsonb((select claimed_at from sri_transmissions where id=$1))) where action='SRI_MANUAL_SAME_DOCUMENT_RETRY' and new_values->>'worker_id'=$2",[old.id,old.worker_id]);
      await db.query("update sri_transmissions set finished_at=clock_timestamp()-interval '40 seconds',claimed_at=clock_timestamp()-interval '45 seconds' where id=$1",[x.d.queryJob]);await login();const fresh=(await claim(x.d)).r;assert.equal(fresh.transmission_type,'AUTHORIZATION_QUERY');await assert.rejects(()=>receptionOwns(old),/CLAIM_LOST/);
      await assert.rejects(()=>handoff(x),/OPERATION_CONSUMED/);
    });
    await test('Roles anon/authenticated cannot invoke service-only handoff',async()=>{for(const role of ['anon','authenticated']){const x=await eligible();await login(A,role);await assert.rejects(()=>handoff(x),/permission denied/);}});
    await test('IMPERIO 07 remains disabled',async()=>{await assert.rejects(()=>eligible({company:I,type:'07'}),/RETENTION|WITHHOLDING|withholding|retenci/i);});
    fs.mkdirSync('.release/same-document-retry',{recursive:true});fs.writeFileSync('.release/same-document-retry/db-tests.json',JSON.stringify({result:results.every(r=>r.result==='PASS')?'PASS':'FAIL',results,realSri:0,realDataChanges:0},null,2));
    console.log(JSON.stringify({passed:results.filter(r=>r.result==='PASS').length,total:results.length,failures:results.filter(r=>r.result!=='PASS')},null,2));if(results.some(r=>r.result!=='PASS'))process.exitCode=1;
  }finally{await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
