const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const { backend, received, networkError } = require("./validate-sri-safe-retry.cjs");
const soap = require("./api/sri/_lib/sri-soap.cjs");
const env = require("./api/sri/_lib/environment.cjs");
const results = [];
const writes = b => b.calls.filter(call => call.operation || (call.rpc && call.rpc !== "erp_sri_assert_transport_actor"));
const response = xml => ({ ok: true, status: 200, text: async () => xml });
async function test(name, run) {
  try { await run(); results.push({ name, result: "PASS" }); }
  catch (error) { results.push({ name, result: "FAIL", message: error.stack }); }
}
async function blockedWithoutEffects(b, invoke = fetch => b.run(fetch)) {
  const before = structuredClone(b.document);
  let requests = 0;
  await assert.rejects(() => invoke(async () => { requests++; throw Error("Unexpected HTTP"); }));
  assert.equal(requests, 0);
  assert.deepEqual(b.document, before);
  assert.deepEqual(writes(b), []);
}

async function runWorker(b, { secret = "fixture-only-secret", supplied = secret, fetchImpl, jobs } = {}) {
  const filename = path.join(__dirname, "api/sri-retry.js");
  const actualRequire = createRequire(filename);
  const exported = { exports: {} };
  let selected = "";
  const workerClient = jobs ? { async rpc(name,args) {
    assert.equal(name,'erp_sri_manager_due_jobs');assert.equal(args.p_limit,25);
    selected='id, company_id, document_id, environment, transmission_type, endpoint_url';
    return {data:jobs};
  } } : b.client;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module: exported, exports: exported.exports, Buffer, process: { env: { SRI_RETRY_CRON_SECRET: secret } },
    require(name) {
      if (name === "./sri/_lib/supabase-admin.cjs") return { getSupabaseAdmin: () => workerClient };
      if (name === "./sri/_lib/transmission-service.cjs") return { transmitDocument: (_client, company, document, actor, options) => b.service.transmitDocument(b.client, company, document, actor, { ...options, fetchImpl }) };
      return actualRequire(name);
    }
  }, { filename });
  const reply = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
  await exported.exports({ method: "GET", headers: { authorization: `Bearer ${supplied}` } }, reply);
  return { status: reply.statusCode, body: reply.body, selected };
}

(async () => {
  await test("Strict environment enum and official endpoints; no fallback", () => {
    for (const value of [undefined, null, "", "test", "PROD", "PRUEBAS", " TEST ", "constructor", "__proto__", "1", "2", 1, 2, true, {}]) {
      assert.throws(() => env.requireEnvironment(value));
      assert.throws(() => env.environmentCode(value));
      assert.throws(() => env.endpointFor(value, "RECEPTION"));
    }
    assert.equal(env.environmentCode("TEST"), "1");
    assert.equal(env.environmentCode("PRODUCTION"), "2");
    assert.equal(env.authorizationEnvironmentLabel("PRODUCTION"), "PRODUCCION");
    assert.equal(env.endpointFor("TEST", "RECEPTION"), "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline");
    assert.equal(env.endpointFor("PRODUCTION", "AUTHORIZATION_QUERY"), "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline");
    assert.throws(() => env.endpointFor("TEST", "OTHER"));
    const b = backend();
    assert.throws(() => env.assertDocumentEnvironment({ ...b.document, access_key: `${b.document.access_key}\n` }));
  });

  for (const environment of ["TEST", "PRODUCTION"]) {
    for (const selector of ["TEST", "PRODUCTION"]) {
      for (const enabled of [false, true]) {
        for (const otherEnabled of [false, true]) {
          await test(`${environment} document with selector ${selector}, own flag ${enabled}, other flag ${otherEnabled}`, async () => {
            const b = backend("01", "FIRMADO", false, environment);
            Object.assign(b.tables.sri_settings[0], { environment: selector,
              test_enabled: environment === "TEST" ? enabled : otherEnabled,
              production_enabled: environment === "PRODUCTION" ? enabled : otherEnabled });
            if (!enabled) return blockedWithoutEffects(b);
            const urls = [], before = b.document.access_key;
            await b.run(async (url, options) => {
              urls.push(url); assert.equal(options.redirect, "error");
              return response(url === env.endpointFor(environment, "RECEPTION") ? received : b.authResponse());
            });
            assert.deepEqual(urls, [env.endpointFor(environment, "RECEPTION"), env.endpointFor(environment, "AUTHORIZATION_QUERY")]);
            assert.equal(b.document.access_key, before); assert.equal(b.document.environment, environment);
            assert.ok(b.tables.sri_transmissions.every(job => job.environment === environment && job.endpoint_url === env.endpointFor(environment, job.transmission_type)));
            assert.equal(b.calls.find(call => call.rpc === "record_sri_authorization").args.p_environment, env.authorizationEnvironmentLabel(environment));
          });
        }
      }
    }
  }

  for (const environment of ["TEST", "PRODUCTION"]) {
    await test(`${environment} uncertainty retries same authorization only after current selector changes`, async () => {
      const b = backend("07", "FIRMADO", false, environment), urls = [];
      await assert.rejects(() => b.run(async url => { urls.push(url); throw networkError("ECONNRESET"); }));
      const snapshot = b.tables.sri_transmissions.map(({ id, environment, endpoint_url, idempotency_key }) => ({ id, environment, endpoint_url, idempotency_key }));
      Object.assign(b.tables.sri_settings[0], { environment: environment === "TEST" ? "PRODUCTION" : "TEST", test_enabled: true, production_enabled: true });
      await b.run(async url => { urls.push(url); return response(b.authResponse()); });
      assert.deepEqual(urls, [env.endpointFor(environment, "RECEPTION"), env.endpointFor(environment, "AUTHORIZATION_QUERY")]);
      const original = b.tables.sri_transmissions[0];
      for (const [key, value] of Object.entries(snapshot[0])) assert.equal(original[key], value);
      const diagnostic = b.tables.electronic_document_audit_logs[0].new_values.transport;
      assert.equal(diagnostic.environment, environment);
      assert.equal(diagnostic.nextAction, "AUTHORIZATION_LOOKUP_FIRST");
      assert.equal(diagnostic.native.cause.code, "ECONNRESET");
    });
  }

  const invalidJobs = [
    ["environment", "PRODUCTION"], ["company_id", "other-company"], ["document_id", "other-document"],
    ["transmission_type", "OTHER"], ["idempotency_key", "changed-key"],
    ["endpoint_url", soap.PRODUCTION_ENDPOINTS.reception], ["endpoint_url", soap.TEST_ENDPOINTS.authorization],
    ["endpoint_url", "https://user:secret@celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline"],
    ["endpoint_url", `${soap.TEST_ENDPOINTS.reception}?token=secret`]
  ];
  for (const [field, value] of invalidJobs) await test(`Persisted job ${field} mismatch blocks before mutations and HTTP (${value.includes?.("https") ? "endpoint" : value})`, async () => {
    const b = backend(); b.tables.sri_transmissions[0][field] = value;
    await blockedWithoutEffects(b);
  });

  for (const change of [
    b => { b.document.environment = "UNKNOWN"; },
    b => { b.document.environment = "PRODUCTION"; },
    b => { b.tables.sri_settings[0].environment = "UNKNOWN"; },
    b => { b.tables.sri_settings[0].ruc = "1727970137001"; },
    b => { b.tables.sri_settings[0].reception_test_url = soap.PRODUCTION_ENDPOINTS.reception; },
    b => { b.tables.companies[0].is_active = false; },
    b => { b.tables.companies[0].tax_id = "1727970137001"; },
    b => { b.authority.allowed = false; }
  ]) await test(`Company/configuration/document/actor preflight fail closed #${results.length}`, async () => {
    const b = backend("01", "FIRMADO", false); change(b); await blockedWithoutEffects(b);
  });

  for (const replacement of [
    xml => xml.replace("<ambiente>1</ambiente>", "<ambiente>2</ambiente>"),
    xml => xml.replace("<ruc>1717637084001</ruc>", "<ruc>1727970137001</ruc>"),
    xml => xml.replace("<secuencial>000000003</secuencial>", "<secuencial>000000004</secuencial>"),
    xml => xml.replace("<claveAcceso>", "<claveAcceso>0"),
    xml => xml.replace("<infoTributaria>", "<infoTributaria/><infoTributaria>"),
    xml => `<!DOCTYPE factura [<!ENTITY injected 'secret'>]>${xml}`
  ]) await test(`Signed artifact mismatch blocks before mutations and HTTP #${results.length}`, async () => {
    const b = backend("01", "FIRMADO", false); b.signedArtifact.xml = replacement(b.signedArtifact.xml); await blockedWithoutEffects(b);
  });

  await test("Persisted signed request file cannot change on retry", async () => {
    const b = backend("01", "FIRMADO", true);
    b.tables.sri_transmissions[0].error_class = "SRI_TRANSPORT_FAILED_DEFINITE";
    b.tables.sri_transmission_attempts = [];
    b.tables.sri_transmissions[0].request_file_id = "other-signed-file";
    await blockedWithoutEffects(b);
  });

  for (const [field, value] of [["company_id", "other-company"], ["document_id", "other-document"], ["file_type", "UNSIGNED_XML"],
    ["storage_bucket", "public"], ["storage_object_path", "other-path"], ["content_sha256", "0".repeat(64)]]) {
    await test(`Signed artifact ${field} identity/hash blocks before mutation and HTTP`, async () => {
      const b = backend("01", "FIRMADO", false); b.signedArtifact.file[field] = value;
      await blockedWithoutEffects(b);
    });
  }

  for (const malformed of [
    xml => xml.replace("<ambiente>PRUEBAS</ambiente>", "<ambiente>PRODUCCION</ambiente>"),
    xml => xml.replace("<ambiente>PRUEBAS</ambiente>", "<ambiente>UNKNOWN</ambiente>"),
    xml => xml.replace("<ambiente>PRUEBAS</ambiente>", ""),
    xml => xml.replace("<ambiente>1</ambiente>", "<ambiente>2</ambiente>"),
    xml => xml.replace("<comprobante><![CDATA[", "<comprobante><![CDATA[<!DOCTYPE factura>"),
    xml => xml.replace(/<comprobante><!\[CDATA\[[\s\S]*?\]\]><\/comprobante>/, "")
  ]) await test(`Wrong authorization environment/XML never records authorization #${results.length}`, async () => {
    const b = backend(), before = structuredClone(b.document);
    await assert.rejects(() => b.run(async () => response(malformed(b.authResponse()))), error => error.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH");
    assert.deepEqual(b.document, before);
    assert.equal(b.tables.sri_responses.length, 0);
    assert.ok(!b.calls.some(call => /record_sri.*authorization/.test(call.rpc || "")));
    assert.equal(b.detail().transmissionAttempts[0].retryable, false);
  });

  await test("Tampered claimed identity blocks HTTP and attempt creation", async () => {
    const b = backend(), originalRpc = b.client.rpc;
    b.client.rpc = async (name, args) => {
      const value = await originalRpc(name, args);
      if (name === "claim_sri_transmission") value.data.endpoint_url = soap.PRODUCTION_ENDPOINTS.authorization;
      return value;
    };
    let requests = 0;
    await assert.rejects(() => b.run(async () => { requests++; }));
    assert.equal(requests, 0); assert.equal(b.tables.sri_transmission_attempts.length, 1);
  });

  await test("SOAP rejects missing environment/cross-environment/nonofficial endpoint before HTTP", async () => {
    const b = backend(); let requests = 0;
    const fetchImpl = async () => { requests++; };
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { fetchImpl }));
    await assert.rejects(() => soap.queryAuthorization(b.document.access_key, { environment: "PRODUCTION", fetchImpl }));
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { document: b.document, environment: "TEST", endpoint: soap.PRODUCTION_ENDPOINTS.reception, fetchImpl }));
    await assert.rejects(() => soap.postSoap({ endpoint: "https://example.invalid", envelope: "fixture", fetchImpl }));
    assert.equal(requests, 0);
  });

  for (const environment of ["TEST", "PRODUCTION"]) await test(`Direct ${environment} SOAP reception requires matching document/key/XML before HTTP`, async () => {
    const b = backend("01", "FIRMADO", false, environment);
    const opposite = environment === "TEST" ? "PRODUCTION" : "TEST";
    const other = backend("01", "FIRMADO", false, opposite);
    let requests = 0;
    const fetchImpl = async url => { requests++; assert.equal(url, env.endpointFor(environment, "RECEPTION")); return response(received); };
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { environment: opposite, fetchImpl }));
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { environment, fetchImpl }));
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { environment: opposite, document: b.document, fetchImpl }));
    await assert.rejects(() => soap.sendForReception(other.signedArtifact.xml, { environment, document: b.document, fetchImpl }));
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { environment: opposite, document: { ...b.document, environment: opposite }, fetchImpl }));
    await assert.rejects(() => soap.sendForReception("<fixture/>", { environment, document: b.document, fetchImpl }));
    assert.equal(requests, 0);
    const result = await soap.sendForReception(b.signedArtifact.xml, { environment, document: b.document, fetchImpl });
    assert.equal(result.received, true); assert.equal(requests, 1);
  });

  for (const [name, number] of [
    ["all-zero number", "0".repeat(49)],
    ["different valid environment/key", backend("07", "FIRMADO", false, "PRODUCTION").document.access_key],
    ["invalid checksum", `${backend().document.access_key.slice(0, -1)}${(Number(backend().document.access_key.at(-1)) + 1) % 10}`],
    ["empty number", ""]
  ]) await test(`Offline authorization rejects ${name} before recording authorization`, async () => {
    const b = backend(), before = structuredClone(b.document);
    const body = b.authResponse().replace(/<numeroAutorizacion>[^<]*<\/numeroAutorizacion>/, `<numeroAutorizacion>${number}</numeroAutorizacion>`);
    const result = soap.parseAuthorizationResponse(body);
    assert.throws(() => b.service.validateAuthorizationIdentity(b.document, result), error => error.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH");
    await assert.rejects(() => b.run(async () => response(body)), error => error.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH");
    assert.deepEqual(b.document, before); assert.equal(b.tables.sri_responses.length, 0);
    assert.ok(!b.calls.some(call => /record_sri.*authorization/.test(call.rpc || "")));
    assert.equal(b.detail().transmissionAttempts[0].retryable, false);
  });

  await test("Offline authorization rejects a missing or non-string number", () => {
    const b = backend(), result = soap.parseAuthorizationResponse(b.authResponse());
    for (const number of [undefined, null, 0, Number(b.document.access_key), `${b.document.access_key}\n`]) {
      assert.throws(() => b.service.validateAuthorizationIdentity(b.document, { ...result, authorizationNumber: number }), error => error.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH");
    }
  });

  await test("Worker carries immutable identity and uses persisted creator; historical TEST remains celcer", async () => {
    const b = backend(); Object.assign(b.tables.sri_settings[0], { environment: "PRODUCTION", production_enabled: true });
    const job = b.tables.sri_transmissions[0]; job.next_attempt_at = "2020-01-01T00:00:00.000Z";
    let requests = 0;
    const result = await runWorker(b, { jobs: [structuredClone(job)], fetchImpl: async url => { requests++; assert.equal(url, soap.TEST_ENDPOINTS.authorization); return response(b.authResponse()); } });
    assert.equal(result.status, 200); assert.equal(result.body.processed, 1); assert.equal(requests, 1);
    for (const column of ["environment", "transmission_type", "endpoint_url"]) assert.ok(result.selected.includes(column));
    assert.ok(b.calls.filter(call => call.rpc === "erp_sri_assert_transport_actor").every(call => call.args.p_actor_user_id === b.document.created_by));
  });

  for (const change of [
    b => { b.authority.allowed = false; },
    b => { b.document.created_by = null; },
    b => { b.tables.companies[0].is_active = false; },
    b => { b.tables.sri_settings[0].test_enabled = false; },
    b => { b.tables.sri_transmissions[0].status = "FAILED"; },
    b => { b.tables.sri_transmissions[0].next_attempt_at = "2999-01-01T00:00:00.000Z"; },
    b => { b.tables.sri_transmissions[0].endpoint_url = soap.PRODUCTION_ENDPOINTS.reception; }
  ]) await test(`Worker rejects revoked/disabled/stale transport without side effects #${results.length}`, async () => {
    const b = backend(), job = b.tables.sri_transmissions[0]; job.next_attempt_at = "2020-01-01T00:00:00.000Z";
    const selected = structuredClone(job); change(b); let requests = 0;
    const result = await runWorker(b, { jobs: [selected], fetchImpl: async () => { requests++; } });
    assert.equal(result.body.processed, 0); assert.equal(requests, 0); assert.deepEqual(writes(b), []);
  });

  await test("Worker cannot send disabled PROD and cannot bypass its secret", async () => {
    const b = backend("01", "PENDIENTE_REINTENTO", true, "PRODUCTION");
    b.tables.sri_settings[0].production_enabled = false;
    const job = b.tables.sri_transmissions[0]; job.next_attempt_at = "2020-01-01T00:00:00.000Z";
    let requests = 0;
    const fetchImpl = async () => { requests++; };
    const denied = await runWorker(b, { jobs: [job], supplied: "bad-secret", fetchImpl });
    assert.equal(denied.status, 401); assert.equal(b.calls.length, 0);
    const disabled = await runWorker(b, { jobs: [job], fetchImpl });
    assert.equal(disabled.body.processed, 0); assert.equal(requests, 0); assert.deepEqual(writes(b), []);
  });

  console.log(JSON.stringify({ ok: results.every(row => row.result === "PASS"), passed: results.filter(row => row.result === "PASS").length, failed: results.filter(row => row.result === "FAIL").length,
    realTransmissions: 0, realSignatures: 0, databaseChanges: 0, results }, null, 2));
  process.exitCode = results.every(row => row.result === "PASS") ? 0 : 1;
})();
