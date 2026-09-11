// Synthetic PostgreSQL fixture only. This script never connects to Supabase or SRI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { endpointFor } = require('./api/sri/_lib/environment.cjs');

const B = 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5';
const I = 'ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const A = '11000000-0000-4000-8000-000000000001';
const O = '22000000-0000-4000-8000-000000000002';
const migrationPath = 'supabase/migrations/202609110001_sri_break_glass_same_document_retry.sql';
const repairMigrationPath = 'supabase/migrations/202609110003_sri_break_glass_accept_valid_manual_lookup.sql';
const manualMigrationPath = 'supabase/migrations/202609090005_sri_manual_same_document_retry.sql';
const results = [];
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const sha256 = value => require('node:crypto').createHash('sha256').update(value).digest('hex');

async function main() {
  const db = new PGlite();
  const run = sql => db.exec(sql);
  const query = async (sql, args = []) => {
    return db.query(sql, args);
  };
  const one = async (sql, args = []) => (await query(sql, args)).rows[0];
  async function login(actor = A, role = 'service_role') {
    await run(`reset role;select set_config('request.jwt.claim.sub',${literal(actor)},false),set_config('request.jwt.claim.role',${literal(role)},false),set_config('request.jwt.claims',${literal(JSON.stringify({ sub: actor, role }))},false);set role ${role};`);
  }
  async function test(name, fn) {
    try { await run('rollback;reset role;begin'); await fn(); results.push({ name, result: 'PASS' }); }
    catch (error) { results.push({ name, result: 'FAIL', error: error.message, where: error.where, position: error.position, internalQuery: error.internalQuery }); }
    finally { await run('rollback;reset role'); }
  }
  async function snapshot() {
    return one(`select
      (select jsonb_agg(to_jsonb(x) order by id) from electronic_documents x) documents,
      (select jsonb_agg(to_jsonb(x) order by company_id,environment,document_type) from electronic_document_sequences x) sequences,
      (select jsonb_agg(to_jsonb(x) order by company_id,document_id) from accounting_document_links x) accounting`);
  }
  try {
    await run(fs.readFileSync('tests/fixtures/sri-dual-configuration-fixture.sql', 'utf8'));
    await run(`
      -- The shared fixture predates the production link identity column.
      alter table accounting_document_links add column id uuid default gen_random_uuid();
      create table public.sri_responses(id uuid primary key default gen_random_uuid(),company_id uuid not null,document_id uuid not null,
        transmission_id uuid not null,response_type text not null,sri_status text,content_sha256 text not null);
      create table public.journal_entries(id uuid primary key,company_id uuid,document_id uuid);
      create table public.erp_purchase_withholding_cancellations(company_id uuid,electronic_document_id uuid,state text);
      insert into auth.users values('${A}'),('${O}');
      insert into user_profiles(user_id) values('${A}'),('${O}');
      insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values
        ('${B}','FIXTURE_B','FIXTURE_B','Fixture B','Fixture B','1717637084001'),
        ('${I}','FIXTURE_I','FIXTURE_I','Fixture I','Fixture I','1727970137001');
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
        select company_id,environment,id,t,800 from emission_points cross join(values('01'),('04'),('07')) v(t);
      insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description)
        values('commercial.electronic_documents.authorize','commercial','electronic_documents','authorize','HIGH','Fixture') on conflict do nothing;
      insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
        select id,'${A}','commercial.electronic_documents.authorize','GRANT','Fixture' from companies;
      grant select,insert on erp_security_user_capability_overrides to service_role;
      grant select on electronic_documents,electronic_document_files,sri_responses,electronic_document_audit_logs to service_role;
    `);
    for (const file of ['202609070020_sri_dual_environment_configuration.sql', '202609070021_sri_dual_environment_document_guards.sql']) {
      await run(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    }
    await run(fs.readFileSync('supabase/migrations/202609080005_sri_manual_authorization_recovery.sql', 'utf8'));
    await run(`alter table sri_responses add column received_at timestamptz default now();
      alter table electronic_document_files add column id uuid primary key default gen_random_uuid(),add column company_id uuid,
      add column file_type text,add column storage_bucket text,add column storage_object_path text,add column content_type text,
      add column content_sha256 text,add column size_bytes bigint,add column schema_version text,add column immutable boolean,
      add column created_by uuid,add column created_at timestamptz default clock_timestamp(),add unique(document_id,file_type,content_sha256);`);
    await run(fs.readFileSync('supabase/migrations/202609090003_sri_document_manager.sql', 'utf8'));
    await run(`alter table sri_responses add column raw_xml text, add column payload jsonb;
      create table public.sri_error_messages(id uuid primary key default gen_random_uuid(),company_id uuid,document_id uuid,identifier text);
      grant select on accounting_document_links,journal_entries,commercial_invoice_reservations,digital_certificates,sri_transmission_attempts,sri_transmissions to service_role;`);
    await run(fs.readFileSync(manualMigrationPath, 'utf8'));
    const beforeMigration = await snapshot();
    const breakGlassMigration = fs.readFileSync(migrationPath, 'utf8');
    await run(breakGlassMigration);
    await run(fs.readFileSync(repairMigrationPath, 'utf8'));

    await test('migration registers capability without granting a user', async () => {
      const capability = await one("select capability_id,module,resource,action,risk_level,active from erp_security_capabilities where capability_id='commercial.electronic_documents.break_glass_retry'");
      assert.deepEqual(capability, { capability_id: 'commercial.electronic_documents.break_glass_retry', module: 'commercial', resource: 'electronic_documents', action: 'break_glass_retry', risk_level: 'CRITICAL', active: true });
      assert.equal((await one("select count(*)::int n from erp_security_user_capability_overrides where capability_id='commercial.electronic_documents.break_glass_retry'")).n, 0);
    });

    async function eligible() {
      await run('reset role');
      const id = randomUUID(), queryJob = randomUUID(), receptionJob = randomUUID(), file = randomUUID(), accountingLink = randomUUID();
      const date = (await one("select (clock_timestamp() at time zone 'America/Guayaquil')::date dt")).dt;
      const doc = (await one(`select sri_build_access_key($1::date,'07','1717637084001','TEST','001','002',757,'12345678') access`, [date])).access;
      const sequential = '000000757';
      await query(`insert into electronic_documents(id,company_id,emission_point_id,document_type,status,issue_date,environment,establishment_code,emission_point_code,
        sequential,sequential_text,full_number,numeric_code,verification_digit,access_key,xml_version,xsd_version,issuer_snapshot,source_snapshot,created_by)
        select $1::uuid,'${B}',p.id,'07','PENDIENTE_REINTENTO',$2::date,'TEST','001','002',757,$3::text,'001-002-'||$3::text,'12345678',right($4::text,1)::int,$4::text,'2.0.0','2.0.0',jsonb_build_object('ruc','1717637084001'),jsonb_build_object('purchaseId','fixture-purchase'),$5::uuid
         from emission_points p where p.company_id='${B}' and p.environment='TEST'`, [id, date, sequential, doc, A]);
      await query(`insert into accounting_document_links(id,company_id,document_id,status)
        values($1,'${B}',$2,'PENDING')`, [accountingLink, id]);
      await query(`insert into sri_transmissions(id,company_id,document_id,transmission_type,environment,endpoint_url,status,idempotency_key,attempt_number,max_attempts,finished_at,error_class,http_status)
        values($1::uuid,'${B}',$2::uuid,'AUTHORIZATION_QUERY','TEST',$3::text,'FAILED',$2::text||':AUTHORIZATION_QUERY',12,12,now()-interval '5 minutes','SRI_TRANSPORT_RESULT_UNCERTAIN',200),
        ($4::uuid,'${B}',$2::uuid,'RECEPTION','TEST',$5::text,'RETRY_SCHEDULED',$2::text||':RECEPTION',1,12,now()-interval '20 minutes','SRI_TRANSPORT_RESULT_UNCERTAIN',500)`,
        [queryJob, id, endpointFor('TEST', 'AUTHORIZATION_QUERY'), receptionJob, endpointFor('TEST', 'RECEPTION')]);
      await query(`insert into sri_transmission_attempts(company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256,http_status,started_at,finished_at)
        select '${B}',$1,$2,n,'FAILED',$3,encode(sha256(convert_to($4,'UTF8')),'hex'),200,now()-interval '20 minutes'+n*interval '1 second',now()-interval '19 minutes'+n*interval '1 second' from generate_series(1,12) n`, [id, queryJob, endpointFor('TEST', 'AUTHORIZATION_QUERY'), doc]);
      const signedXml = '<signed-xml-fixture/>'; const signedHash = sha256(signedXml);
      await query(`insert into electronic_document_files(id,company_id,document_id,file_type,storage_bucket,storage_object_path,content_sha256)
        values($1::uuid,'${B}',$2::uuid,'SIGNED_XML','sri-private','companies/${B}/documents/'||$2::text||'/signed_xml-'||$3::text||'.xml',$3::text)`, [file, id, signedHash]);
      await query(`insert into sri_transmission_attempts(company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256,http_status,started_at,finished_at)
        values('${B}',$1,$2,1,'FAILED',$3,$4,500,now()-interval '20 minutes',now()-interval '19 minutes')`,
        [id, receptionJob, endpointFor('TEST', 'RECEPTION'), signedHash]);
      await query('update sri_transmissions set request_file_id=$1 where id=$2', [file, receptionJob]);
      const raw = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>${doc}</claveAccesoConsultada><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>`;
      const responseHash = sha256(raw);
      const response = randomUUID();
      await query(`insert into sri_responses(id,company_id,document_id,transmission_id,response_type,sri_status,content_sha256,raw_xml,payload)
        values($1,'${B}',$2,$3,'AUTHORIZATION','NO_ENCONTRADO',$4,$5,$6)`, [response, id, queryJob, responseHash, raw, { state: 'NO_ENCONTRADO', accessKey: doc, documentCount: 0, authorized: false, messages: [], authorizations: [] }]);
      await query(`update sri_transmission_attempts set status='FAILED',error_class='SRI_TRANSPORT_RESULT_UNCERTAIN',response_sha256=$1 where transmission_id=$2 and attempt_number=12`, [responseHash, queryJob]);
      const document = (await one('select to_jsonb(d) d from electronic_documents d where id=$1', [id])).d;
      const accountingLinks = (await query('select * from accounting_document_links where company_id=$1 and document_id=$2 order by id', [B, id])).rows;
      await login();
      const claimedAuth = (await one('select claim_sri_manual_authorization($1,$2,$3,$4,$5) r', [queryJob, `manual-auth-${randomUUID()}`, B, id, A])).r;
      const operationId = randomUUID();
      const evidence = {
        validation: 'PASS', signedXmlHash: signedHash, finalLookupHash: responseHash, accountingHash: 'a'.repeat(64),
        accountingLinks,
        identity: { documentId: id, companyId: B, environment: 'TEST', documentType: '07', fullNumber: document.full_number,
          establishment: '001', emissionPoint: '002', accessKey: doc, issueDate: date.toISOString().slice(0, 10), sequential, signedFileId: file, signedXmlHash: signedHash }
      };
      const args = [B, id, A, operationId, claimedAuth.id, claimedAuth.worker_id, claimedAuth.claim_attempt.id, response, file, document, evidence];
      return { id, queryJob, receptionJob, file, document, signedHash, accountingLinks, claimedAuth, operationId, args };
    }

    await test('same-document claim preserves identity and does not create fiscal or accounting rows', async () => {
      const x = await eligible();
      await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
        values('${B}','${A}','commercial.electronic_documents.break_glass_retry','GRANT','Isolated fixture only')`);
      await run('reset role');
      const before = await snapshot();
      await login();
      const result = (await one('select claim_sri_break_glass_reception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r', x.args)).r;
      assert.equal(result.break_glass_same_document, true);
      assert.equal(result.reused, false);
      assert.equal(result.document_id, x.id);
      assert.equal(result.request_file_id, x.file);
      assert.equal(result.claim_attempt.request_sha256, x.signedHash);
      await run('reset role');
      assert.deepEqual(await snapshot(), before);
      assert.equal((await one("select count(*)::int n from electronic_documents where id=$1", [x.id])).n, 1);
      assert.equal((await one("select count(*)::int n from sri_transmission_attempts where document_id=$1 and status='STARTED'", [x.id])).n, 1);
      assert.equal((await one("select count(*)::int n from electronic_document_audit_logs where document_id=$1 and action='SRI_BREAK_GLASS_RETRY'", [x.id])).n, 1);
      await login();
      assert.equal((await one('select assert_sri_break_glass_reception_claim($1,$2,$3,$4) r', [result.id, result.worker_id, result.claim_attempt.id, A])).r, true);
    });

    await test('accounting link drift is rejected before the new transmission attempt', async () => {
      const x = await eligible();
      await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
        values('${B}','${A}','commercial.electronic_documents.break_glass_retry','GRANT','Isolated fixture only')`);
      const changedEvidence = { ...x.args[10], accountingLinks: [] };
      const changedArgs = [...x.args]; changedArgs[10] = changedEvidence;
      await login();
      await assert.rejects(
        () => one('select claim_sri_break_glass_reception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r', changedArgs),
        /SRI_BREAK_GLASS_VALIDATION_REQUIRED/
      );
    });

    await test('same operation is idempotent and keeps one active transmission', async () => {
      const x = await eligible();
      await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
        values('${B}','${A}','commercial.electronic_documents.break_glass_retry','GRANT','Isolated fixture only')`);
      const first = (await one('select claim_sri_break_glass_reception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r', x.args)).r;
      const repeated = await Promise.all(Array.from({ length: 20 }, () => one('select claim_sri_break_glass_reception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r', x.args)));
      assert.equal(repeated.filter(row => row.r?.reused === true).length, 20);
      assert.equal(first.claim_attempt.id, repeated[0].r.claim_attempt.id);
      await run('reset role');
      assert.equal((await one("select count(*)::int n from electronic_document_audit_logs where document_id=$1 and action='SRI_BREAK_GLASS_RETRY'", [x.id])).n, 1);
      assert.equal((await one("select count(*)::int n from sri_transmission_attempts where document_id=$1 and status='STARTED'", [x.id])).n, 1);
    });

    await test('authenticated role cannot invoke the service-only claim', async () => {
      const x = await eligible();
      await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
        values('${B}','${A}','commercial.electronic_documents.break_glass_retry','GRANT','Isolated fixture only')`);
      await login(A, 'authenticated');
      await assert.rejects(() => one('select claim_sri_break_glass_reception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r', x.args), /permission denied/);
    });

    await test('migration can be applied again without data delta', async () => {
      const before = await snapshot();
      await run(fs.readFileSync(migrationPath, 'utf8'));
      await run(fs.readFileSync(repairMigrationPath, 'utf8'));
      await run(fs.readFileSync(repairMigrationPath, 'utf8'));
      assert.deepEqual(await snapshot(), before);
      assert.equal((await one("select count(*)::int n from erp_security_capabilities where capability_id='commercial.electronic_documents.break_glass_retry'")).n, 1);
    });

    console.log(JSON.stringify({ result: results.every(item => item.result === 'PASS') ? 'PASS' : 'FAIL', results, realSriRequests: 0, realDataChanges: 0 }, null, 2));
    if (results.some(item => item.result !== 'PASS')) process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
