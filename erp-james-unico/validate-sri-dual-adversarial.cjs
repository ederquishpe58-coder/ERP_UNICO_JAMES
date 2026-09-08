// Independent adversarial checks: synthetic PostgreSQL only, mock HTTP only, no PKCS12.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { backend, received, networkError } = require('./validate-sri-safe-retry.cjs');
const soap = require('./api/sri/_lib/sri-soap.cjs');
const env = require('./api/sri/_lib/environment.cjs');
const { assertDocumentXmlIdentity } = require('./api/sri/_lib/xml-identity.cjs');
const { activeCertificateMetadata } = require('./api/sri/_lib/document-service.cjs');
const { safeText } = require('./api/sri/_lib/transport-diagnostic.cjs');
const results = [];
const response = xml => ({ ok: true, status: 200, text: async () => xml });
async function test(id, name, run) {
  try { await run(); results.push({ id, name, result: 'PASS' }); }
  catch (error) { results.push({ id, name, result: 'FAIL', error: error.stack }); }
}
const writes = b => b.calls.filter(c => c.operation || (c.rpc && c.rpc !== 'erp_sri_assert_transport_actor'));
async function noSend(b) {
  let requests = 0;
  const before = structuredClone(b.document);
  await assert.rejects(() => b.run(async () => { requests++; throw Error('Unexpected mock HTTP'); }));
  assert.equal(requests, 0); assert.deepEqual(writes(b), []); assert.deepEqual(b.document, before);
}
async function transportTests() {
  await test('actor', 'A current authorizer can transmit a document created by a different create-only actor', async () => {
    const b = backend('01','FIRMADO',false), urls = [];
    b.document.created_by = 'creator-without-authorize';
    await b.run(async url => { urls.push(url); return response(url === env.endpointFor('TEST','RECEPTION') ? received : b.authResponse()); });
    assert.equal(b.document.status,'AUTORIZADO'); assert.equal(urls.length,2);
    assert.ok(b.calls.filter(c => c.rpc === 'erp_sri_assert_transport_actor').every(c => c.args.p_actor_user_id === 'actor'));
    assert.equal(b.document.created_by,'creator-without-authorize');
  });
  await test('actor', 'Automatic retry cannot inherit a different authorizer when its creator lacks authorization', async () => {
    const b = backend(), job = b.tables.sri_transmissions[0]; let requests = 0;
    b.document.created_by = 'creator-without-authorize'; job.next_attempt_at = '2020-01-01T00:00:00Z';
    const before = structuredClone(b.document);
    await assert.rejects(() => b.service.transmitDocument(b.client,b.document.company_id,b.document.id,null,
      { retryJob: structuredClone(job), fetchImpl: async () => { requests++; throw Error('Unexpected mock HTTP'); } }), e => e.code === 'SRI_TRANSPORT_ACTOR_DENIED');
    assert.equal(requests,0); assert.deepEqual(writes(b),[]); assert.deepEqual(b.document,before);
    assert.equal(b.calls.find(c => c.rpc === 'erp_sri_assert_transport_actor').args.p_actor_user_id,b.document.created_by);
  });
  await test(1, 'PRODUCTION cannot accept XML ambiente 1 or a TEST access key', async () => {
    const b = backend('01', 'FIRMADO', false, 'PRODUCTION');
    b.signedArtifact.xml = b.signedArtifact.xml.replace('<ambiente>2</ambiente>', '<ambiente>1</ambiente>');
    assert.throws(() => assertDocumentXmlIdentity(b.document, b.signedArtifact.xml));
    await noSend(b);
  });
  await test(2, 'TEST XML cannot reach cel even through exported SOAP entrypoint', async () => {
    const b = backend('01', 'FIRMADO', false, 'TEST'); let requests = 0;
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { document: b.document, environment: 'PRODUCTION', fetchImpl: async () => { requests++; return response(received); } }));
    assert.equal(requests, 0);
  });
  await test(2, 'PRODUCTION XML cannot reach celcer through exported SOAP entrypoint', async () => {
    const b = backend('01', 'FIRMADO', false, 'PRODUCTION'); let requests = 0;
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { document: b.document, environment: 'TEST', fetchImpl: async () => { requests++; return response(received); } }));
    assert.equal(requests, 0);
  });
  await test(5, 'BLESS document rejects another company configuration and certificate metadata', async () => {
    const b = backend('01', 'FIRMADO', false); b.tables.sri_settings[0].company_id = 'another-company'; await noSend(b);
    const company = 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5';
    const row = { company_id: company, active: true, storage_bucket: 'sri-private', fingerprint_sha256: 'a'.repeat(64),
      storage_object_path: `companies/${company}/certificates/${'a'.repeat(64)}.p12`, password_secret_name: 'SRI_P12_PASSWORD_IMPERIO',
      subject_ruc: '1717637084001', validation_status: 'VALID', valid_from: '2020-01-01', valid_until: '2999-01-01', last_validated_at: '2026-09-07' };
    const query = { select() { return this; }, eq() { return this; }, single: async () => ({ data: row }) };
    await assert.rejects(() => activeCertificateMetadata({ from: () => query }, company, { company_id: company, ruc: row.subject_ruc }, row.subject_ruc));
  });
  for (const environment of ['TEST', 'PRODUCTION']) {
    await test(7, `${environment} uncertain retry preserves environment, key and job and performs lookup first`, async () => {
      const b = backend('01', 'FIRMADO', false, environment), requests = [];
      await assert.rejects(() => b.run(async url => { requests.push(url); throw networkError('ECONNRESET'); }));
      const before = { key: b.document.access_key, env: b.document.environment, job: b.tables.sri_transmissions[0].id };
      Object.assign(b.tables.sri_settings[0], { environment: environment === 'TEST' ? 'PRODUCTION' : 'TEST', test_enabled: true, production_enabled: true });
      await assert.rejects(() => b.run(async url => { requests.push(url); return response(b.authResponse('NO_ENCONTRADO')); }), e => e.code === 'SRI_AUTHORIZATION_PENDING');
      assert.deepEqual(requests, [env.endpointFor(environment, 'RECEPTION'), env.endpointFor(environment, 'AUTHORIZATION_QUERY')]);
      assert.deepEqual({ key: b.document.access_key, env: b.document.environment, job: b.tables.sri_transmissions[0].id }, before);
    });
  }
  for (const wrong of ['', '0'.repeat(49), '123', '1'.repeat(49)]) {
    await test('identity', `Authorization number ${wrong.length} digits cannot authorize a different identity`, async () => {
      const b = backend(), before = structuredClone(b.document);
      const xml = b.authResponse().replace(/<numeroAutorizacion>[^<]*/, `<numeroAutorizacion>${wrong}`);
      await assert.rejects(() => b.run(async () => response(xml)), e => e.code === 'SRI_AUTHORIZATION_IDENTITY_MISMATCH');
      assert.deepEqual(b.document, before); assert.equal(b.tables.sri_responses.length, 0);
      assert.ok(!b.calls.some(c => /record_sri.*authorization/.test(c.rpc || '')));
    });
  }
  await test('identity', 'Checksum, duplicate tax identity and XML trailing roots fail before HTTP', async () => {
    for (const mutate of [xml => xml.replace('</infoTributaria>', '</infoTributaria><infoTributaria/>'), xml => xml + '<factura/>',
      xml => xml.replace('<fechaEmision>07/09/2026</fechaEmision>', '<fechaEmision>08/09/2026</fechaEmision>')]) {
      const b = backend('01', 'FIRMADO', false); b.signedArtifact.xml = mutate(b.signedArtifact.xml); await noSend(b);
    }
    const b = backend('01', 'FIRMADO', false); b.document.access_key = b.document.access_key.slice(0, 48) + ((Number(b.document.access_key[48]) + 1) % 10); await noSend(b);
  });
  await test('privacy', 'Diagnostic sanitizer hides passwords, bearer credentials and fiscal XML', () => {
    const text = safeText('password=SECRET_X Bearer SECRET_Y <factura>PRIVATE_BUYER</factura> https://name:SECRET_Z@example.invalid/?token=SECRET_Q');
    for (const secret of ['SECRET_X','SECRET_Y','PRIVATE_BUYER','SECRET_Z','SECRET_Q']) assert.ok(!text.includes(secret));
  });
}
function documentHarness() {
  const filename = path.join(__dirname,'validate-sri-dual-documents.cjs');
  const module = { exports: {} };
  const source = fs.readFileSync(filename,'utf8') + '\nmodule.exports={...module.exports,effects,mockClient,service,inputFor};';
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${source}\n})`,{filename})(createRequire(filename),module,module.exports,filename,path.dirname(filename));
  return module.exports;
}
async function documentEdgeTests() {
  const h = documentHarness(), secretName = 'SRI_P12_PASSWORD_BLESS';
  const previous = process.env[secretName]; process.env[secretName] = 'SYNTHETIC_ADVERSARIAL_SECRET';
  try {
    await test('reservation', 'Exhausted counter does not block reuse of an already reserved last identity', async () => {
      const f = h.fixture(h.COMPANIES[0],'TEST','01','LOCAL'), calls = h.effects();
      f.sequence.next_value = 1000000000;
      f.document.sequential = 999999999; f.document.sequential_text = '999999999'; f.document.full_number = '001-003-999999999';
      const service = h.service(calls), client = h.mockClient(f,calls);
      const result = await service.createDraft(client,h.inputFor(f),'00000000-0000-4000-8000-000000000999');
      assert.equal(calls.create,1,'Canonical SQL RPC must decide reuse vs exhaustion');
      assert.equal(result.document.sequential_text,'999999999'); assert.equal(f.sequence.next_value,1000000000);
    });
    await test('certificate', 'Missing stored PKCS12 cannot consume a sequence even with valid certificate metadata', async () => {
      const f = h.fixture(), calls = h.effects(), client = h.mockClient(f,calls);
      client.storage.from = () => ({ download: async () => ({ error: new Error('SYNTHETIC_P12_MISSING') }) });
      await assert.rejects(() => h.service(calls).createDraft(client,h.inputFor(f),'00000000-0000-4000-8000-000000000999'), e => e.code === 'SRI_CONFIGURATION_ERROR');
      assert.equal(calls.create,0); assert.equal(calls.sign,0); assert.equal(calls.writes,0);
    });
  } finally { if (previous === undefined) delete process.env[secretName]; else process.env[secretName] = previous; }
}
async function databaseTests() {
  const db = new PGlite();
  const B = 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5', I = 'ab60abdc-fe53-4289-9ae2-8f749ee21cff';
  const A = '11000000-0000-4000-8000-000000000001', O = '22000000-0000-4000-8000-000000000002';
  const lit = v => v == null ? 'null' : "'" + String(v).replaceAll("'", "''") + "'";
  const row = async (sql, args) => (await db.query(sql, args)).rows[0];
  const run = sql => db.exec(sql);
  const login = async (actor = A, role = 'authenticated') => run(`reset role; select set_config('request.jwt.claims',${lit(JSON.stringify({ sub: actor, role }))},false),set_config('request.jwt.claim.sub',${lit(actor)},false),set_config('request.jwt.claim.role',${lit(role)},false); set role ${role};`);
  const snapshot = async () => {
    await run('reset role');
    return row(`select ${['electronic_documents','commercial_invoice_reservations','electronic_document_files','sri_transmissions','sri_transmission_attempts','sri_authorizations','electronic_document_audit_logs','electronic_document_sequences'].map(t => `(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) from ${t} t) as ${t}`).join(',')}`);
  };
  const activate = (company, enabled, expected, environment = 'PRODUCTION') => row('select erp_sri_set_environment_enabled($1,$2,$3,$4,$5,$6) result', [company, environment, enabled, expected, randomUUID(), 'Independent adversarial fixture']);
  const setNext = (company, point, type, environment, next = 90, expected = null) => row('select erp_sri_set_sequence_next($1,$2,$3,$4,$5,$6,$7,$8) result', [company,environment,point,type,next,expected,randomUUID(),'Independent adversarial fixture']);
  const draft = async (company, point, type, environment, idempotencyKey = randomUUID()) => {
    await login(A,'service_role');
    await run("select set_config('request.headers','{\"x-erp-service\":\"sri-electronic-documents\"}',false)");
    return row('select create_electronic_document_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) result',
    [company,point,type,'2026-09-07','12345678',type === '07' ? '2.0.0' : '1.1.0',type === '07' ? '2.0.0' : '1.1.0',
      { ruc: company === B ? '1717637084001' : '1727970137001' },{}, { erpEmission: { environment,idempotencyKey } },null,null,null,null,A]);
  };
  try {
    await run(fs.readFileSync(path.join(__dirname, 'tests/fixtures/sri-dual-configuration-fixture.sql'), 'utf8'));
    // The fixture's generic function grants are wider than the verified live claim
    // ACL (postgres + service_role). OR REPLACE must preserve this existing boundary.
    await run('revoke all on function public.claim_sri_transmission(uuid,text) from public,anon,authenticated; grant execute on function public.claim_sri_transmission(uuid,text) to service_role;');
    await run(`insert into auth.users values(${lit(A)}),(${lit(O)}); insert into user_profiles(user_id) values(${lit(A)}),(${lit(O)});
      insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values(${lit(B)},'ADVERSARIAL_B','ADVERSARIAL_B','Synthetic B','Synthetic B','1717637084001'),(${lit(I)},'ADVERSARIAL_I','ADVERSARIAL_I','Synthetic I','Synthetic I','1727970137001');
      insert into user_company_memberships(company_id,user_id,membership_status,membership_role) values(${lit(B)},${lit(A)},'ACTIVE','OWNER'),(${lit(I)},${lit(A)},'ACTIVE','OWNER'),(${lit(B)},${lit(O)},'ACTIVE','OWNER');
      insert into sri_company_memberships(company_id,auth_user_id,active,role_code) values(${lit(B)},${lit(A)},true,'ADMIN'),(${lit(I)},${lit(A)},true,'ADMIN');
      insert into sri_settings(company_id,legal_name,ruc,head_office_address,test_enabled,withholding_agent_number,technical_spec_version)
        select id,legal_name,tax_id,'Synthetic address',true,case when id=${lit(B)} then '10' end,'2.34' from companies;
      insert into digital_certificates(company_id,alias,storage_object_path,password_secret_name,subject_ruc,fingerprint_sha256,active,validation_status,valid_from,valid_until,last_validated_at)
        select id,'Synthetic metadata','companies/'||id||'/certificates/'||repeat('a',64)||'.p12',case when id=${lit(B)} then 'SRI_P12_PASSWORD_BLESS' else 'SRI_P12_PASSWORD_IMPERIO' end,tax_id,repeat('a',64),true,'VALID',now()-interval '1 day',now()+interval '1 year',now() from companies;
      insert into storage.objects(bucket_id,name) select storage_bucket,storage_object_path from digital_certificates;
      insert into emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address)
        select id,'TEST','001',ep,'Synthetic address' from companies cross join (values('002'),('003')) x(ep);
      insert into electronic_document_sequences(company_id,emission_point_id,environment,document_type,next_value)
        select company_id,id,'TEST',t,90 from emission_points cross join (values('01'),('04')) x(t);
      insert into electronic_document_sequences(company_id,emission_point_id,environment,document_type,next_value)
        select company_id,id,'TEST','07',90 from emission_points where company_id=${lit(B)} and emission_point_code='002';
      insert into electronic_documents(company_id,emission_point_id,document_type,issue_date,environment,establishment_code,emission_point_code,sequential,sequential_text,full_number,numeric_code,verification_digit,access_key,xml_version,xsd_version,issuer_snapshot,source_snapshot,created_by)
        select ${lit(B)},p.id,'01','2026-09-07','TEST','001','002',n,lpad(n::text,9,'0'),'001-002-'||lpad(n::text,9,'0'),'12345678',right(k,1)::smallint,k,'1.1.0','1.1.0','{"ruc":"1717637084001"}','{}',${lit(A)}
        from emission_points p cross join generate_series(1,13) n cross join lateral (select sri_build_access_key('2026-09-07','01','1717637084001','TEST','001','002',n,'12345678') k) key
        where p.company_id=${lit(B)} and p.environment='TEST' and p.emission_point_code='002';
      update sri_settings set test_enabled=false;`);
    for (const cap of ['tax.parameters.manage','admin.sequences.manage','commercial.electronic_documents.create','commercial.electronic_documents.authorize','purchases.withholdings.create']) {
      const [module,resource,action] = cap.split('.');
      await db.query('insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description) values($1,$2,$3,$4,$5,$6) on conflict(capability_id) do nothing', [cap,module,resource,action,'HIGH','Independent fixture']);
    }
    await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) select id,${lit(A)},capability_id,'GRANT','Synthetic grant' from companies cross join erp_security_capabilities;`);
    const historical = await snapshot();
    for (const file of ['202609070020_sri_dual_environment_configuration.sql','202609070021_sri_dual_environment_document_guards.sql']) await run(fs.readFileSync(path.join(__dirname,'supabase/migrations',file),'utf8'));
    await test(8, 'All 13 synthetic historical TEST rows remain byte-identical after migration', async () => {
      assert.equal((await row('select count(*)::int n from electronic_documents')).n, 13); assert.deepEqual(await snapshot(), historical);
    });
    const points = {};
    for (const company of [B,I]) for (const environment of ['TEST','PRODUCTION']) for (const ep of ['002','003']) {
      if (environment === 'TEST') { await run('reset role'); points[company+environment+ep] = (await row('select id from emission_points where company_id=$1 and environment=$2 and emission_point_code=$3', [company,environment,ep])).id; continue; }
      await login(); points[company+environment+ep] = (await row('select erp_sri_save_emission_point($1,$2,$3,$4,$5,$6,$7,$8,$9) result', [company,environment,'001',ep,'Synthetic address','Synthetic point',true,null,randomUUID()])).result.id;
    }
    for (const company of [B,I]) for (const ep of ['002','003']) for (const type of ['01','04', ...(company === B && ep === '002' ? ['07'] : [])]) {
      await login(); await setNext(company,points[company+'PRODUCTION'+ep],type,'PRODUCTION');
    }
    await test(3, 'PRODUCTION cannot configure a TEST sequence', async () => {
      const before = await snapshot(); await login();
      await assert.rejects(() => setNext(B,points[B+'TEST002'],'01','PRODUCTION'), /SRI_ACTIVE_EMISSION_POINT_REQUIRED/);
      assert.deepEqual(await snapshot(),before);
    });
    await test(4, 'TEST cannot configure a PRODUCTION sequence', async () => {
      const before = await snapshot(); await login();
      await assert.rejects(() => setNext(B,points[B+'PRODUCTION002'],'01','TEST'), /SRI_ACTIVE_EMISSION_POINT_REQUIRED/);
      assert.deepEqual(await snapshot(),before);
    });
    await test(5, 'Company boundary blocks foreign point and foreign certificate secret during activation', async () => {
      await login(); await assert.rejects(() => setNext(B,points[I+'PRODUCTION002'],'01','PRODUCTION'), /SRI_ACTIVE_EMISSION_POINT_REQUIRED/);
      await run(`reset role; update digital_certificates set password_secret_name='SRI_P12_PASSWORD_IMPERIO' where company_id=${lit(B)}`);
      try { await login(); await assert.rejects(() => activate(B,true,false), /SRI_.*CERTIFICATE/); }
      finally { await run(`reset role; update digital_certificates set password_secret_name='SRI_P12_PASSWORD_BLESS' where company_id=${lit(B)}`); }
    });
    await test(6, 'Activation creates no document, reservation, key, XML, signature, transmission or consumed sequence', async () => {
      const before = await snapshot(); await login();
      const enabled = (await activate(B,true,false)).result;
      assert.deepEqual([enabled.environment,enabled.production_enabled,enabled.test_enabled],['PRODUCTION',true,false]);
      assert.deepEqual(await snapshot(),before);
    });
    await test(8, 'Activating PRODUCTION preserves all 13 historical TEST documents byte-for-byte', async () => {
      const after = await snapshot(); assert.equal(after.electronic_documents,historical.electronic_documents);
      assert.equal((await row('select environment from sri_settings where company_id=$1',[B])).environment,'PRODUCTION');
      assert.equal((await row("select count(*)::int n from electronic_documents where environment='TEST'")).n,13);
    });
    await test(3, 'PRODUCTION draft RPC cannot consume TEST sequence through a crossed point', async () => {
      const before = await snapshot(); await login();
      await assert.rejects(() => draft(B,points[B+'TEST002'],'01','PRODUCTION'), /SRI_ACTIVE_EMISSION_POINT_REQUIRED|SRI_EMISSION_POINT_MISMATCH/);
      assert.deepEqual(await snapshot(),before);
    });
    await test(4, 'TEST draft RPC cannot consume PRODUCTION sequence through a crossed point', async () => {
      await login(); await activate(B,true,false,'TEST');
      const before = await snapshot(); await login();
      await assert.rejects(() => draft(B,points[B+'PRODUCTION002'],'01','TEST'), /SRI_ACTIVE_EMISSION_POINT_REQUIRED|SRI_EMISSION_POINT_MISMATCH/);
      assert.deepEqual(await snapshot(),before);
      await login(); await activate(B,true,true,'PRODUCTION');
    });
    await test(9, 'IMPERIO cannot issue 07 through direct backend RPC in either environment', async () => {
      for (const environment of ['TEST','PRODUCTION']) {
        await login(); await activate(I,true,false,environment);
        const before = await snapshot(); await login();
        await assert.rejects(() => setNext(I,points[I+environment+'002'],'07',environment), /SRI_WITHHOLDING_COMPANY_NOT_ENABLED/);
        await assert.rejects(() => draft(I,points[I+environment+'002'],'07',environment), /SRI_WITHHOLDING_COMPANY_NOT_ENABLED/);
        assert.deepEqual(await snapshot(),before);
      }
    });
    await test(10, 'Frontend bypass and OWNER membership cannot replace canonical capabilities', async () => {
      const before = await snapshot(); await login(O);
      await assert.rejects(() => activate(B,false,true), /CAPABILITY_REQUIRED/);
      await assert.rejects(() => setNext(B,points[B+'PRODUCTION002'],'01','PRODUCTION',91,90), /CAPABILITY_REQUIRED/);
      await assert.rejects(() => run(`update sri_settings set production_enabled=true where company_id=${lit(B)}`), /permission denied/);
      assert.deepEqual(await snapshot(),before);
      await login(A,'service_role'); await assert.rejects(() => activate(B,false,true), /permission denied/);
      await assert.rejects(() => row('select erp_sri_assert_transport_actor($1,$2)',[B,O]), /CAPABILITY_REQUIRED/);
    });
    await test('reservation', 'SQL reuses the last reserved number but rejects fresh issuance from exhausted counter', async () => {
      const point = points[B+'PRODUCTION003'];
      await run(`reset role;
        update electronic_document_sequences set next_value=1000000000 where company_id=${lit(B)} and emission_point_id=${lit(point)} and environment='PRODUCTION' and document_type='01';
        insert into commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,establishment_code,emission_point_code,sequential,full_number,status,created_by)
        values(${lit(B)},'SRI-IDEMP:adversarial-last-held',${lit(point)},'PRODUCTION','01','001','003',999999999,'001-003-999999999','ACTIVE',${lit(A)});`);
      const result = (await draft(B,point,'01','PRODUCTION','adversarial-last-held')).result;
      assert.equal(result.sequential,999999999);
      await run('reset role');
      assert.equal((await row('select next_value from electronic_document_sequences where company_id=$1 and emission_point_id=$2 and environment=$3 and document_type=$4',[B,point,'PRODUCTION','01'])).next_value,1000000000);
      const before = await snapshot();
      const repeated = (await draft(B,point,'01','PRODUCTION','adversarial-last-held')).result;
      assert.equal(repeated.id,result.id); assert.deepEqual(await snapshot(),before);
      await assert.rejects(() => draft(B,point,'01','PRODUCTION','adversarial-fresh-after-exhaustion'), /SRI_SEQUENTIAL_EXHAUSTED/);
      assert.deepEqual(await snapshot(),before);
    });
    await test('actor', 'SQL claim remains service-only and does not require the document creator to authorize', async () => {
      const point = points[B+'PRODUCTION003'], docId = randomUUID(), jobId = randomUUID();
      await run(`reset role;
        insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
          values(${lit(B)},${lit(O)},'commercial.electronic_documents.create','GRANT','Synthetic create-only actor');
        insert into electronic_documents(id,company_id,emission_point_id,document_type,status,issue_date,environment,establishment_code,emission_point_code,sequential,sequential_text,full_number,numeric_code,verification_digit,access_key,xml_version,xsd_version,issuer_snapshot,source_snapshot,created_by)
          select ${lit(docId)},${lit(B)},${lit(point)},'01','FIRMADO','2026-09-07','PRODUCTION','001','003',89,'000000089','001-003-000000089','12345678',right(k,1)::smallint,k,'1.1.0','1.1.0','{"ruc":"1717637084001"}','{}',${lit(O)}
          from (select sri_build_access_key('2026-09-07','01','1717637084001','PRODUCTION','001','003',89,'12345678') k) source;
        insert into sri_transmissions(id,company_id,document_id,transmission_type,environment,endpoint_url,idempotency_key,status,next_attempt_at)
          values(${lit(jobId)},${lit(B)},${lit(docId)},'RECEPTION','PRODUCTION',${lit(env.endpointFor('PRODUCTION','RECEPTION'))},${lit(docId+':RECEPTION')},'PENDING',now()-interval '1 day');`);
      const before = await row('select to_jsonb(d) document from electronic_documents d where id=$1',[docId]);
      await login(O);
      assert.equal((await row('select erp_security_has_capability($1,$2) allowed',[B,'commercial.electronic_documents.create'])).allowed,true);
      assert.equal((await row('select erp_security_has_capability($1,$2) allowed',[B,'commercial.electronic_documents.authorize'])).allowed,false);
      await assert.rejects(() => row('select claim_sri_transmission($1,$2)',[jobId,'forbidden-frontend']), /permission denied/);
      await login(A,'service_role');
      assert.equal((await row('select erp_sri_assert_transport_actor($1,$2) allowed',[B,A])).allowed,true);
      const claimed = (await row('select claim_sri_transmission($1,$2) job',[jobId,'independent-adversarial-worker'])).job;
      assert.equal(claimed.status,'PROCESSING'); assert.equal(claimed.attempt_number,1); assert.equal(claimed.document_id,docId);
      await run('reset role'); assert.deepEqual(await row('select to_jsonb(d) document from electronic_documents d where id=$1',[docId]),before);
    });
  } finally { await db.close(); }
}
(async () => {
  await transportTests();
  await documentEdgeTests();
  await test('database', 'Isolated PostgreSQL adversarial fixture executes all database cases', databaseTests);
  console.log(JSON.stringify({ ok: results.every(r => r.result === 'PASS'), passed: results.filter(r => r.result === 'PASS').length,
    failed: results.filter(r => r.result === 'FAIL').length, realTransmissions: 0, realSignatures: 0, realDatabaseChanges: 0,
    historicalScope: '13 synthetic fixtures; live 13 hashes are separately verified by release integrator', results },null,2));
  process.exitCode = results.some(r => r.result === 'FAIL') ? 1 : 0;
})();
