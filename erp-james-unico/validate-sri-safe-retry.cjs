const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const soap = require("./api/sri/_lib/sri-soap.cjs");
const { nativeDiagnostic, safeText, UNCERTAIN, DEFINITE } = require("./api/sri/_lib/transport-diagnostic.cjs");
const { recoveryPolicy } = require("./api/sri/_lib/recovery-policy.cjs");
const { buildAccessKey } = require("./api/sri/_lib/access-key.cjs");
const { environmentCode, authorizationEnvironmentLabel, endpointFor } = require("./api/sri/_lib/environment.cjs");
const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, result: "PASS" }); }
  catch (error) { results.push({ name, result: "FAIL", message: error.stack }); }
}
const envelope = body => `<Envelope><Body>${body}</Body></Envelope>`;
const received = envelope("<validarComprobanteResponse><RespuestaRecepcionComprobante><estado>RECIBIDA</estado></RespuestaRecepcionComprobante></validarComprobanteResponse>");
const fault = envelope("<Fault><faultcode>Server</faultcode><faultstring>Servicio temporalmente no disponible</faultstring></Fault>");
const networkError = code => new TypeError("fetch failed", { cause: Object.assign(new Error("connect failure"), { code, errno: -3008, syscall: "connect", hostname: "celcer.sri.gob.ec" }) });
async function caughtFrom(fetchImpl) {
  try { await soap.postSoap({ endpoint: soap.TEST_ENDPOINTS.reception, envelope: "<fixture/>", fetchImpl, timeoutMs: 5 }); }
  catch (error) { return error; }
  throw Error("Expected transport error");
}

// In-memory backend; any document/sequence/journal creation is a test failure.
// Runs the actual transmission/recovery service with only I/O boundaries replaced.
function backend(type = "07", status = "PENDIENTE_REINTENTO", legacy = true, environment = "TEST") {
  const id = "fixture-document", company = "fixture-company";
  const access = buildAccessKey({ issueDate: "2026-09-07", documentType: type, ruc: "1717637084001", environment, establishmentCode: "001", emissionPointCode: "002", sequential: 3, numericCode: "97353364", emissionType: "1" });
  const document = { id, company_id: company, created_by: "actor", issue_date: "2026-09-07", environment, status, access_key: access.accessKey, document_type: type, issuer_snapshot: { ruc: "1717637084001" }, establishment_code: "001", emission_point_code: "002", sequential_text: "000000003", full_number: "001-002-000000003", xml_version: "2.0.0", last_error: "network failure" };
  const tables = {
    electronic_documents: [document],
    sri_settings: [{ company_id: company, ruc: "1717637084001", environment, production_enabled: environment === "PRODUCTION", test_enabled: true, retry_max_attempts: 12 }],
    companies: [{ id: company, tax_id: "1717637084001", is_active: true }],
    sri_transmissions: legacy ? [{ id: "reception", document_id: id, company_id: company, environment, transmission_type: "RECEPTION", idempotency_key: `${id}:RECEPTION`, endpoint_url: endpointFor(environment, "RECEPTION"), status: "RETRY_SCHEDULED", attempt_number: 9, max_attempts: 12, error_class: "SRI_NETWORK_ERROR" }] : [],
    sri_transmission_attempts: legacy ? [{ id: "old-attempt", document_id: id, transmission_id: "reception", error_class: "SRI_NETWORK_ERROR", retryable: true }] : [],
    electronic_document_audit_logs: [], sri_responses: [], sri_error_messages: [],
    accounting_document_links: [{ id: "accounting", company_id: company, document_id: id, status: "POSTED", journal_entry_id: "existing-journal" }]
  };
  const calls = [], artifacts = [{ id: "ride", file_type: "RIDE_PDF" }];
  const authority = { allowed: true };
  function documentXml(key = document.access_key) {
    const root = type === "01" ? "factura" : type === "04" ? "notaCredito" : "comprobanteRetencion";
    const info = type === "01" ? "infoFactura" : type === "04" ? "infoNotaCredito" : "infoCompRetencion";
    return `<${root} id="comprobante" version="2.0.0"><infoTributaria><ambiente>${environmentCode(environment)}</ambiente><tipoEmision>1</tipoEmision><claveAcceso>${key}</claveAcceso><codDoc>${type}</codDoc><ruc>1717637084001</ruc><estab>001</estab><ptoEmi>002</ptoEmi><secuencial>000000003</secuencial></infoTributaria><${info}><fechaEmision>07/09/2026</fechaEmision></${info}></${root}>`;
  }
  const signedArtifact = { xml: documentXml(), file: {} };
  function detail(requestCompany = company, requestId = id) {
    assert.equal(requestCompany, company); assert.equal(requestId, id);
    return structuredClone({ document, transmissions: tables.sri_transmissions.slice().reverse(), transmissionAttempts: tables.sri_transmission_attempts.slice().reverse(), audit: tables.electronic_document_audit_logs.slice().reverse(), errors: [], files: artifacts, accountingLinks: tables.accounting_document_links });
  }
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = "select"; }
    select() { return this; }
    eq(k, v) { this.filters.push(row => row[k] === v); return this; }
    in(k, values) { this.filters.push(row => values.includes(row[k])); return this; }
    lte(k, value) { this.filters.push(row => row[k] <= value); return this; }
    order() { return this; }
    limit(n) { this.maximum = n; return this; }
    update(patch) { this.operation = "update"; this.patch = patch; return this; }
    insert(values) { this.operation = "insert"; this.values = Array.isArray(values) ? values : [values]; return this; }
    upsert(values) { return this.insert(values); }
    execute(single = false) {
      const table = tables[this.table] ||= [];
      if (this.operation !== "select") calls.push({ table: this.table, operation: this.operation });
      if (this.operation === "insert") {
        assert.ok(!/electronic_documents|sequences|journal/.test(this.table), "Forbidden business insert");
        const rows = this.values.map(value => ({ id: `${this.table}-${table.length}`, ...structuredClone(value) })); table.push(...rows);
        return { data: single ? rows[0] : rows };
      }
      let rows = table.filter(row => this.filters.every(f => f(row)));
      if (this.maximum) rows = rows.slice(0, this.maximum);
      if (this.operation === "update") {
        if (this.table === "electronic_documents") assert.deepEqual(Object.keys(this.patch), ["last_error"]);
        rows.forEach(row => Object.assign(row, this.patch));
      }
      return { data: structuredClone(single ? rows[0] || null : rows) };
    }
    single() { return Promise.resolve(this.execute(true)); }
    maybeSingle() { return this.single(); }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
  }
  const client = {
    from: table => new Query(table),
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === "erp_sri_assert_transport_actor") {
        assert.equal(args.p_company_id, company);
        return { data: authority.allowed && args.p_actor_user_id === "actor" };
      }
      if (name === "claim_sri_transmission") {
        const job = tables.sri_transmissions.find(j => j.id === args.p_transmission_id);
        if (job.attempt_number >= job.max_attempts) return { data: null };
        job.attempt_number++; job.status = "PROCESSING"; return { data: structuredClone(job) };
      }
      assert.ok(["record_sri_authorization", "record_sri_recovery_authorization"].includes(name), `Forbidden RPC ${name}`);
      assert.equal(args.p_document_id, id);
      document.status = args.p_authorization_status === "AUTORIZADO" ? "AUTORIZADO" : "NO_AUTORIZADO";
      return { data: structuredClone(document) };
    }
  };
  const filename = path.join(__dirname, "api/sri/_lib/transmission-service.cjs");
  const actualRequire = createRequire(filename);
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module: exported, exports: exported.exports, Buffer, console: { error() {} },
    require(name) {
      if (name === "./document-service.cjs") return {
        dbError(result) { if (result.error) throw Error(result.error.message); return result.data; },
        getDocumentDetail: async (_client, co, doc) => detail(co, doc),
        async transition(_client, current, next) { assert.equal(current.id, id); document.status = next; return structuredClone(document); }
      };
      if (name === "./artifact-store.cjs") return {
        sha256: value => require("node:crypto").createHash("sha256").update(value).digest("hex"),
        loadArtifact: async () => {
          const buffer = Buffer.from(signedArtifact.xml);
          const hash = require("node:crypto").createHash("sha256").update(buffer).digest("hex");
          return { file: { id: "same-signed-file", company_id: company, document_id: id, file_type: "SIGNED_XML", storage_bucket: "sri-private",
            content_sha256: hash, storage_object_path: `companies/${company}/documents/${id}/signed_xml-${hash}.xml`, ...signedArtifact.file }, buffer };
        },
        storeArtifact: async (_client, value) => { assert.equal(value.companyId, company); assert.equal(value.documentId, id); artifacts.push(value); return { id: "fixture-artifact" }; }
      };
      if (name === "./ride.cjs") return { generateRidePdf() { throw Error("Existing RIDE must be reused"); } };
      return actualRequire(name);
    }
  }, { filename });
  function authResponse(state = "AUTORIZADO", key = document.access_key) {
    return envelope(`<autorizacionComprobanteResponse><RespuestaAutorizacionComprobante><claveAccesoConsultada>${key}</claveAccesoConsultada><numeroComprobantes>${state === "NO_ENCONTRADO" ? 0 : 1}</numeroComprobantes>${state === "NO_ENCONTRADO" ? "" : `<autorizaciones><autorizacion><estado>${state}</estado><numeroAutorizacion>${key}</numeroAutorizacion><fechaAutorizacion>2026-09-07T12:00:00</fechaAutorizacion><ambiente>${authorizationEnvironmentLabel(environment)}</ambiente><comprobante><![CDATA[${documentXml(key)}]]></comprobante></autorizacion></autorizaciones>`}</RespuestaAutorizacionComprobante></autorizacionComprobanteResponse>`);
  }
  return { service: exported.exports, client, document, tables, calls, detail, authResponse, authority, signedArtifact, run: fetchImpl => exported.exports.transmitDocument(client, company, id, "actor", { force: true, fetchImpl }) };
}

if (require.main === module) (async () => {
  for (const [code, classification, state] of [["ENOTFOUND", "DNS", DEFINITE], ["CERT_HAS_EXPIRED", "TLS", DEFINITE], ["UND_ERR_CONNECT_TIMEOUT", "TIMEOUT", UNCERTAIN], ["ECONNRESET", "CONNECTION_RESET", UNCERTAIN]]) await test(`${code} classification and native cause`, async () => {
    const e = await caughtFrom(async () => { throw networkError(code); });
    assert.equal(e.details.transport.classification, classification);
    assert.equal(e.details.transport.resultState, state);
    assert.equal(e.details.transport.native.cause.code, code);
    assert.equal(e.details.transport.native.cause.errno, -3008);
    assert.equal(e.details.transport.native.cause.syscall, "connect");
    assert.equal(e.details.transport.native.cause.hostname, "celcer.sri.gob.ec");
  });
  await test("AbortController timeout is uncertain", async () => {
    const e = await caughtFrom((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(Error("aborted"), { name: "AbortError" })))));
    assert.equal(e.details.transport.classification, "TIMEOUT"); assert.equal(e.details.transport.resultState, UNCERTAIN);
  });
  await test("Mixed aggregate and unknown errors remain uncertain", () => {
    assert.equal(nativeDiagnostic(new AggregateError([networkError("ENOTFOUND"), networkError("ECONNRESET")])).resultState, UNCERTAIN);
    assert.equal(nativeDiagnostic(Error("unknown")).resultState, UNCERTAIN);
  });
  await test("Diagnostics redact secrets XML URLs and cycles", () => {
    const e = networkError("ECONNRESET"); e.cause.cause = e;
    const diagnostic = nativeDiagnostic(e); assert.ok(JSON.stringify(diagnostic).length < 4000);
    const text = safeText("token=supersecret Bearer bearer-secret https://user:password@host.test/path?secret=secretvalue <factura>private buyer</factura>");
    for (const secret of ["supersecret", "bearer-secret", "password", "secretvalue", "private buyer"]) assert.ok(!text.includes(secret));
    assert.ok(!safeText("-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----").includes("SECRET"));
    assert.ok(!safeText('{"password":"sensitive quoted value"}').includes("sensitive"));
    assert.ok(!safeText("&lt;factura&gt;private buyer").includes("private buyer"));
  });
  await test("HTTP 500 keeps official status and SOAP fault without NETWORK", async () => {
    const e = await caughtFrom(async () => ({ ok: false, status: 500, text: async () => fault }));
    assert.equal(e.code, "SRI_HTTP_ERROR"); assert.equal(e.details.transport.classification, "HTTP");
    assert.equal(e.details.transport.httpStatus, 500); assert.equal(e.details.transport.response.faultCode, "Server");
    assert.equal(e.details.transport.response.faultString, "Servicio temporalmente no disponible");
  });
  await test("HTTP response followed by body reset preserves HTTP and cause", async () => {
    const e = await caughtFrom(async () => ({ ok: true, status: 200, text: async () => { throw networkError("ECONNRESET"); } }));
    assert.equal(e.code, "SRI_HTTP_ERROR"); assert.equal(e.details.transport.classification, "HTTP");
    assert.equal(e.details.transport.native.cause.code, "ECONNRESET");
  });
  await test("SOAP fault classified and official message retained", async () => {
    const b = backend();
    await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { document: b.document, environment: "TEST", fetchImpl: async () => ({ ok: true, status: 200, text: async () => fault }) }), e => e.code === "SRI_SOAP_FAULT" && e.details.transport.classification === "SOAP" && e.details.transport.httpStatus === 200 && e.message.includes("Servicio temporalmente no disponible"));
  });
  await test("HTTP 200 unreadable SOAP response stays SOAP, uncertain and lookup-first", async () => {
    const b = backend();
    for (const body of ["not an XML response", "<Envelope><Body><unexpected/></Body></Envelope>", "<Envelope><Body>"]) {
      await assert.rejects(() => soap.sendForReception(b.signedArtifact.xml, { document: b.document, environment: "TEST", fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }) }), error =>
        error.details.transport.classification === "SOAP" && error.details.transport.httpStatus === 200
        && error.details.transport.resultState === UNCERTAIN && error.details.transport.nextAction === "AUTHORIZATION_LOOKUP_FIRST");
    }
  });
  for (const type of ["01", "04", "07"]) await test(`${type} uncertain legacy retry recovers same authorization; zero resends`, async () => {
    const b = backend(type), before = structuredClone(b.document), urls = [];
    const fetch = async (url, options) => { urls.push(url); assert.equal(url, soap.TEST_ENDPOINTS.authorization); assert.ok(options.body.includes(before.access_key)); return { ok: true, status: 200, text: async () => b.authResponse() }; };
    await b.run(fetch); await b.run(fetch);
    assert.deepEqual(urls, [soap.TEST_ENDPOINTS.authorization]); assert.equal(b.document.status, "AUTORIZADO");
    for (const key of ["id", "company_id", "access_key", "sequential_text", "full_number"]) assert.equal(b.document[key], before[key]);
    assert.equal(b.tables.accounting_document_links[0].journal_entry_id, "existing-journal");
    assert.ok(!b.calls.some(c => /sequence|generate.*accounting|journal/.test(c.rpc || "")));
  });
  for (const type of ["01", "04", "07"]) await test(`${type} initial transport reception then authorization regression`, async () => {
    const b = backend(type, "FIRMADO", false), urls = [];
    await b.run(async (url, options) => {
      urls.push(url); assert.equal(options.method, "POST"); assert.equal(options.headers["content-type"], "text/xml; charset=UTF-8"); assert.equal(options.headers.SOAPAction, "");
      return { ok: true, status: 200, text: async () => url === soap.TEST_ENDPOINTS.reception ? received : b.authResponse() };
    });
    assert.deepEqual(urls, [soap.TEST_ENDPOINTS.reception, soap.TEST_ENDPOINTS.authorization]); assert.equal(b.document.status, "AUTORIZADO");
  });
  await test("Uncertain send persists native diagnostics and next retry only queries", async () => {
    const b = backend("07", "FIRMADO", false), urls = [];
    await assert.rejects(() => b.run(async url => { urls.push(url); throw networkError("ECONNRESET"); }));
    assert.equal(b.document.status, "PENDIENTE_REINTENTO");
    const diag = b.tables.electronic_document_audit_logs[0].new_values;
    assert.equal(diag.transport.native.cause.code, "ECONNRESET"); assert.equal(diag.transport.workflowResultState, UNCERTAIN);
    assert.equal(b.detail().transmissionAttempts[0].error_class, "SRI_TRANSPORT_RESULT_UNCERTAIN");
    assert.equal(recoveryPolicy(b.detail()).nextAction, "AUTHORIZATION_LOOKUP_FIRST");
    await b.run(async url => { urls.push(url); return { ok: true, status: 200, text: async () => b.authResponse() }; });
    assert.deepEqual(urls, [soap.TEST_ENDPOINTS.reception, soap.TEST_ENDPOINTS.authorization]);
  });
  await test("Definite DNS failure is distinguishable and may retry same job", async () => {
    const b = backend("07", "FIRMADO", false);
    await assert.rejects(() => b.run(async () => { throw networkError("ENOTFOUND"); }));
    assert.equal(b.detail().transmissionAttempts[0].error_class, "SRI_TRANSPORT_FAILED_DEFINITE");
    assert.equal(recoveryPolicy(b.detail()).transportResultState, DEFINITE);
  });
  await test("Unknown historical failure and interrupted send query first", () => {
    for (const error_class of [null, "SRI_BACKEND_ERROR", "UNRECOGNIZED"]) {
      assert.equal(recoveryPolicy({ document: { status: "PENDIENTE_REINTENTO" }, transmissionAttempts: [{ error_class }] }).action, "QUERY_AUTHORIZATION");
    }
    assert.equal(recoveryPolicy({ document: { status: "ENVIADO_SRI" } }).action, "QUERY_AUTHORIZATION");
  });
  await test("HTTP failure persisted with real status; no raw XML", async () => {
    const b = backend("07", "FIRMADO", false);
    await assert.rejects(() => b.run(async () => ({ ok: false, status: 500, text: async () => fault })));
    assert.equal(b.detail().transmissionAttempts[0].http_status, 500);
    assert.equal(b.tables.electronic_document_audit_logs[0].new_values.transport.response.faultCode, "Server");
  });
  await test("Official DEVUELTA is processed without automatic resend", async () => {
    const b = backend("07", "FIRMADO", false); let requests = 0;
    const returned = envelope('<validarComprobanteResponse><RespuestaRecepcionComprobante><estado>DEVUELTA</estado><comprobantes><comprobante><mensajes><mensaje><identificador>35</identificador><mensaje>DOCUMENTO INVALIDO</mensaje></mensaje></mensajes></comprobante></comprobantes></RespuestaRecepcionComprobante></validarComprobanteResponse>');
    await b.run(async url => { requests++; assert.equal(url, soap.TEST_ENDPOINTS.reception); return { ok: true, status: 200, text: async () => returned }; });
    assert.equal(b.document.status, "DEVUELTO");
    await b.run(async () => { throw Error("Cannot resend returned document"); }); assert.equal(requests, 1);
  });
  await test("No encontrado repeated lookup and lookup DNS never reenable reception", async () => {
    const b = backend(), urls = [];
    for (let n = 0; n < 3; n++) await assert.rejects(() => b.run(async url => {
      urls.push(url); if (n === 1) throw networkError("ENOTFOUND");
      return { ok: true, status: 200, text: async () => b.authResponse("NO_ENCONTRADO") };
    }));
    assert.ok(urls.every(url => url === soap.TEST_ENDPOINTS.authorization));
    assert.equal(b.document.status, "PENDIENTE_REINTENTO"); assert.equal(b.tables.sri_transmissions.length, 2);
    assert.equal(recoveryPolicy(b.detail()).nextAction, "AUTHORIZATION_LOOKUP_FIRST");
  });
  await test("Exhausted uncertain result does not become definitive or resend", async () => {
    const b = backend();
    await assert.rejects(() => b.run(async () => ({ ok: true, status: 200, text: async () => b.authResponse("NO_ENCONTRADO") })));
    const job = b.tables.sri_transmissions.find(j => j.transmission_type === "AUTHORIZATION_QUERY"); job.max_attempts = 2;
    await assert.rejects(() => b.run(async url => { assert.equal(url, soap.TEST_ENDPOINTS.authorization); throw networkError("ECONNRESET"); }));
    assert.equal(b.document.status, "PENDIENTE_REINTENTO"); assert.equal(job.status, "FAILED");
    assert.equal(recoveryPolicy(b.detail()).action, "QUERY_AUTHORIZATION");
  });
  await test("Worker respects pending authorization backoff", async () => {
    const b = backend();
    await assert.rejects(() => b.run(async () => ({ ok: true, status: 200, text: async () => b.authResponse("NO_ENCONTRADO") })));
    let requests = 0;
    await assert.rejects(() => b.service.transmitDocument(b.client, b.document.company_id, b.document.id, null, { force: false, retryJob: b.detail().transmissions[0], fetchImpl: async () => { requests++; throw Error("Unexpected send"); } }), e => e.code === "SRI_TRANSMISSION_NOT_DUE");
    assert.equal(requests, 0);
  });
  await test("Official NO AUTORIZADO is final; no reception retry", async () => {
    const b = backend(); let count = 0;
    await b.run(async url => { count++; assert.equal(url, soap.TEST_ENDPOINTS.authorization); return { ok: true, status: 200, text: async () => b.authResponse("NO AUTORIZADO") }; });
    assert.equal(b.document.status, "NO_AUTORIZADO"); await b.run(async () => { throw Error("No repeat allowed"); }); assert.equal(count, 1);
  });
  await test("Wrong company and mismatched authorization identity fail closed", async () => {
    const b = backend();
    await assert.rejects(() => b.service.transmitDocument(b.client, "other-company", b.document.id, null));
    await assert.rejects(() => b.run(async () => ({ ok: true, status: 200, text: async () => b.authResponse("AUTORIZADO", "0".repeat(49)) })), e => e.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH");
    assert.equal(b.document.status, "PENDIENTE_REINTENTO");
  });
  await test("Disabled document environment is blocked without HTTP", async () => {
    for (const environment of ["TEST", "PRODUCTION"]) {
      const b = backend("07", "FIRMADO", false, environment);
      b.tables.sri_settings[0][environment === "TEST" ? "test_enabled" : "production_enabled"] = false;
      let requests = 0;
      await assert.rejects(() => b.run(async () => { requests++; })); assert.equal(requests, 0);
    }
  });
  await test("Historical TEST retry remains query-only celcer after PROD activation", async () => {
    const b = backend(); Object.assign(b.tables.sri_settings[0], { environment: "PRODUCTION", production_enabled: true });
    const before = b.document.access_key;
    await b.run(async url => { assert.equal(url, soap.TEST_ENDPOINTS.authorization); return { ok: true, status: 200, text: async () => b.authResponse() }; });
    assert.equal(b.document.access_key, before); assert.equal(b.document.environment, "TEST");
  });
  console.log(JSON.stringify({ ok: results.every(r => r.result === "PASS"), passed: results.filter(r => r.result === "PASS").length, failed: results.filter(r => r.result === "FAIL").length, realTransmissions: 0, sequenceMutations: 0, results }, null, 2));
  process.exitCode = results.every(r => r.result === "PASS") ? 0 : 1;
})();

module.exports = { backend, envelope, received, fault, networkError };
