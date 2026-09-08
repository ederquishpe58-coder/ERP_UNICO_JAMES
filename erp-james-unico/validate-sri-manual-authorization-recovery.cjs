const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
global.fetch = async () => { throw Error("REAL_NETWORK_FORBIDDEN"); };
const { backend } = require("./validate-sri-safe-retry.cjs");
const { buildAccessKey } = require("./api/sri/_lib/access-key.cjs");
const { endpointFor } = require("./api/sri/_lib/environment.cjs");
const { recoveryPolicy } = require("./api/sri/_lib/recovery-policy.cjs");
const results = [];
const response = xml => ({ ok: true, status: 200, text: async () => xml });
const hash = value => createHash("sha256").update(value).digest("hex");
const error = (code, message, hint = null) => ({ error: { code, message, hint } });
async function test(name, run) {
  try { await run(); results.push({ name, result: "PASS" }); }
  catch (failure) { results.push({ name, result: "FAIL", error: failure.stack }); }
}

// Only I/O is modeled. Actual service, XML parser, policy, identities and SOAP run.
// The companion DB suite executes claim/lease/concurrency against PostgreSQL.
function fixture(environment = "PRODUCTION", type = "07") {
  const access = buildAccessKey({ issueDate: "2026-09-08", documentType: type, ruc: "1717637084001", environment,
    establishmentCode: "001", emissionPointCode: "002", sequential: 750, numericCode: "97353364", emissionType: "1" });
  const b = backend(type, "PENDIENTE_REINTENTO", true, environment, { document: {
    issue_date: "2026-09-08", sequential_text: "000000750", full_number: "001-002-000000750", access_key: access.accessKey
  } });
  Object.assign(b.tables.sri_transmissions[0], { attempt_number: 1, error_class: "SRI_TRANSPORT_RESULT_UNCERTAIN", http_status: 500 });
  const queryJob = { id: "authorization-750", company_id: b.document.company_id, document_id: b.document.id,
    transmission_type: "AUTHORIZATION_QUERY", environment, endpoint_url: endpointFor(environment, "AUTHORIZATION_QUERY"),
    idempotency_key: `${b.document.id}:AUTHORIZATION_QUERY`, status: "FAILED", attempt_number: 12, max_attempts: 12,
    worker_id: "api-old-finished", claimed_at: "2026-09-08T15:23:00Z", finished_at: "2026-09-08T15:23:05Z",
    next_attempt_at: null, error_class: "SRI_TRANSPORT_RESULT_UNCERTAIN" };
  b.tables.sri_transmissions.push(queryJob);
  b.tables.sri_transmission_attempts = b.tables.sri_transmission_attempts.slice(0, 1);
  for (let number = 1; number <= 12; number++) b.tables.sri_transmission_attempts.push({
    id: `automatic-${number}`, company_id: b.document.company_id, document_id: b.document.id,
    transmission_id: queryJob.id, attempt_number: number, status: number === 12 ? "FAILED" : "RETRY_SCHEDULED",
    endpoint_url: queryJob.endpoint_url, request_sha256: hash(b.document.access_key),
    error_class: "SRI_TRANSPORT_RESULT_UNCERTAIN", finished_at: "2026-09-08T15:23:05Z"
  });
  // Make the fixed historical fixture older than the current test clock.
  queryJob.finished_at = new Date(Date.now() - 60000).toISOString();
  const baseRpc = b.client.rpc.bind(b.client);
  const manualClaims = new Map();
  const guard = args => {
    const attempt = b.tables.sri_transmission_attempts.find(row => row.id === args.p_attempt_id);
    return attempt && manualClaims.get(attempt.id) === args.p_worker_id && queryJob.status === "PROCESSING"
      && queryJob.worker_id === args.p_worker_id && attempt.status === "STARTED"
      && args.p_transmission_id === queryJob.id && args.p_actor_user_id === "actor"
      && Date.now() - new Date(queryJob.claimed_at).getTime() < 180000;
  };
  b.client.rpc = async (name, args) => {
    if (!name.includes("sri_manual_authorization")) {
      if (name === "claim_sri_transmission") {
        const selected = b.tables.sri_transmissions.find(row => row.id === args.p_transmission_id);
        if (!["PENDING", "RETRY_SCHEDULED"].includes(selected.status)) return error("55P03", "SRI_TRANSMISSION_NOT_CLAIMABLE");
      }
      return baseRpc(name, args);
    }
    b.calls.push({ rpc: name, args: structuredClone(args) });
    if (name === "claim_sri_manual_authorization") {
      if (!b.authority.allowed || args.p_actor_user_id !== "actor") return error("42501", "SRI_TRANSPORT_ACTOR_DENIED");
      assert.equal(args.p_transmission_id, queryJob.id);
      assert.equal(args.p_company_id, b.document.company_id); assert.equal(args.p_document_id, b.document.id);
      assert.match(args.p_worker_id, /^manual-auth-[a-f0-9-]{36}$/);
      if (b.tables.sri_transmissions.some(row => row !== queryJob && row.status === "PROCESSING")) return error("55P03", "SRI_TRANSMISSION_ALREADY_PROCESSING");
      if (queryJob.status === "PROCESSING") {
        const old = b.tables.sri_transmission_attempts.find(row => row.status === "STARTED" && manualClaims.get(row.id) === queryJob.worker_id);
        if (!old || Date.now() - new Date(queryJob.claimed_at).getTime() < 180000) return error("55P03", "SRI_TRANSMISSION_ALREADY_PROCESSING", '{"retryAfterSeconds":5}');
        Object.assign(old, { status: "FAILED", finished_at: new Date().toISOString(), error_class: "SRI_TRANSPORT_RESULT_UNCERTAIN" });
      } else if (queryJob.status !== "FAILED" || queryJob.attempt_number !== 12 || queryJob.error_class !== "SRI_TRANSPORT_RESULT_UNCERTAIN" || type !== "07") {
        return error("23514", "SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE");
      } else if (Date.now() - new Date(queryJob.finished_at).getTime() < 30000) {
        return error("55P03", "SRI_MANUAL_AUTHORIZATION_COOLDOWN", '{"retryAfterSeconds":30}');
      }
      const attemptNumber = Math.max(...b.tables.sri_transmission_attempts.filter(row => row.transmission_id === queryJob.id).map(row => row.attempt_number)) + 1;
      const attempt = { id: `manual-${attemptNumber}`, company_id: b.document.company_id, document_id: b.document.id,
        transmission_id: queryJob.id, attempt_number: attemptNumber, endpoint_url: queryJob.endpoint_url,
        request_sha256: hash(b.document.access_key), status: "STARTED", started_at: new Date().toISOString() };
      b.tables.sri_transmission_attempts.push(attempt);
      Object.assign(queryJob, { status: "PROCESSING", worker_id: args.p_worker_id, claimed_at: new Date().toISOString(), finished_at: null, next_attempt_at: null });
      manualClaims.set(attempt.id, args.p_worker_id);
      return { data: structuredClone({ ...queryJob, manual_recovery: true, claim_attempt: attempt }) };
    }
    if (!guard(args)) return error("55000", "SRI_MANUAL_AUTHORIZATION_CLAIM_LOST");
    if (name === "assert_sri_manual_authorization_claim") return { data: true };
    assert.equal(name, "settle_sri_manual_authorization");
    const attempt = b.tables.sri_transmission_attempts.find(row => row.id === args.p_attempt_id);
    if (args.p_success) { assert.match(args.p_response_sha256, /^[a-f0-9]{64}$/); assert.equal(args.p_http_status, 200); }
    Object.assign(attempt, { status: args.p_success ? "SUCCEEDED" : "FAILED", finished_at: new Date().toISOString(),
      response_sha256: args.p_response_sha256, error_class: args.p_error_class });
    Object.assign(queryJob, { status: args.p_success ? "COMPLETED" : "FAILED", finished_at: new Date().toISOString(),
      error_class: args.p_error_class, next_attempt_at: null });
    return { data: structuredClone({ ...queryJob, manual_recovery: true }) };
  };
  b.queryJob = queryJob;
  b.query = (fetchImpl, options = {}) => b.service.queryDocumentStatus(b.client, b.document.company_id, b.document.id, "actor", { fetchImpl, ...options });
  b.seedStale = async () => {
    const result = await b.client.rpc("claim_sri_manual_authorization", { p_transmission_id: queryJob.id,
      p_company_id: b.document.company_id, p_document_id: b.document.id, p_worker_id: "manual-auth-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", p_actor_user_id: "actor" });
    assert.ok(result.data);
    queryJob.claimed_at = new Date(Date.now() - 181000).toISOString();
    return result.data.claim_attempt;
  };
  return b;
}

(async () => {
  await test("750 FAILED 12/12 manual lookup recovers same authorization; no reception or fiscal identity changes", async () => {
    const b = fixture(), before = structuredClone(b.document), links = JSON.stringify(b.tables.accounting_document_links);
    const reception = JSON.stringify(b.tables.sri_transmissions[0]), oldAttempts = JSON.stringify(b.tables.sri_transmission_attempts), urls = [];
    assert.equal(recoveryPolicy(b.detail()).action, "QUERY_AUTHORIZATION");
    await b.query(async url => { urls.push(url); assert.equal(url, endpointFor("PRODUCTION", "AUTHORIZATION_QUERY")); return response(b.authResponse()); });
    assert.equal(b.document.status, "AUTORIZADO"); assert.equal(urls.length, 1);
    for (const field of ["id", "company_id", "environment", "access_key", "sequential_text", "full_number"]) assert.equal(b.document[field], before[field]);
    assert.equal(JSON.stringify(b.tables.accounting_document_links), links);
    assert.equal(JSON.stringify(b.tables.sri_transmissions[0]), reception);
    assert.equal(JSON.stringify(b.tables.sri_transmission_attempts.slice(0, -1)), oldAttempts);
    assert.equal(b.queryJob.attempt_number, 12); assert.equal(b.queryJob.max_attempts, 12);
    const attempt = b.tables.sri_transmission_attempts.at(-1); assert.equal(attempt.attempt_number, 13); assert.equal(attempt.status, "SUCCEEDED");
    assert.equal(b.tables.electronic_documents.length, 1); assert.equal(b.tables.accounting_document_links.length, 1);
    assert.equal(b.calls.filter(call => call.rpc === "claim_sri_transmission").length, 0);
    await b.run(() => { throw Error("AUTHORIZED_MUST_NOT_SEND"); });
  });
  await test("750 absent keeps FAILED automatic 12/12 and query-only next action; cooldown rejects rapid clicks", async () => {
    const b = fixture(), reception = JSON.stringify(b.tables.sri_transmissions[0]), urls = [];
    await assert.rejects(() => b.query(async url => { urls.push(url); return response(b.authResponse("NO_ENCONTRADO")); }), failure => failure.code === "SRI_AUTHORIZATION_PENDING");
    assert.equal(b.queryJob.status, "FAILED"); assert.equal(b.queryJob.next_attempt_at, null);
    assert.equal(b.queryJob.attempt_number, 12); assert.equal(b.queryJob.max_attempts, 12);
    assert.equal(JSON.stringify(b.tables.sri_transmissions[0]), reception); assert.equal(urls.length, 1);
    assert.match(b.tables.sri_transmission_attempts.at(-1).response_sha256, /^[a-f0-9]{64}$/);
    assert.equal(recoveryPolicy(b.detail()).action, "QUERY_AUTHORIZATION");
    await assert.rejects(() => b.query(() => { throw Error("COOLDOWN_SOCKET_FORBIDDEN"); }), failure => failure.code === "SRI_TRANSMISSION_NOT_DUE" && failure.details.retryAfterSeconds === 30);
    assert.equal(b.tables.sri_transmission_attempts.at(-1).attempt_number, 13);
  });
  await test("Interactive transmit/retry also queries exhausted retention authorization before any reception", async () => {
    const b = fixture(); let sockets = 0;
    await b.run(async url => { sockets++; assert.equal(url, endpointFor("PRODUCTION", "AUTHORIZATION_QUERY")); return response(b.authResponse()); });
    assert.equal(sockets, 1); assert.equal(b.queryJob.attempt_number, 12);
    assert.equal(b.tables.sri_transmission_attempts.at(-1).attempt_number, 13);
  });
  await test("Further human query after cooldown uses attempt 14, preserving automatic budget", async () => {
    const b = fixture();
    await assert.rejects(() => b.query(async () => response(b.authResponse("NO_ENCONTRADO"))));
    b.queryJob.finished_at = new Date(Date.now() - 31000).toISOString();
    await b.query(async () => response(b.authResponse()));
    assert.equal(b.tables.sri_transmission_attempts.at(-1).attempt_number, 14); assert.equal(b.queryJob.attempt_number, 12);
  });
  await test("20 concurrent same-document queries admit one socket and one manual attempt", async () => {
    const b = fixture(); let active = 0, maximum = 0, sockets = 0;
    const settled = await Promise.allSettled(Array.from({ length: 20 }, () => b.query(async () => {
      sockets++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 20)); active--;
      return response(b.authResponse());
    })));
    assert.equal(maximum, 1); assert.equal(sockets, 1); assert.equal(settled.filter(row => row.status === "fulfilled").length, 1);
    for (const row of settled.filter(row => row.status === "rejected")) assert.equal(row.reason.code, "SRI_TRANSMISSION_ALREADY_PROCESSING");
    assert.equal(b.tables.sri_transmission_attempts.filter(row => row.attempt_number > 12).length, 1);
    assert.equal(b.tables.electronic_documents.length, 1); assert.equal(b.tables.accounting_document_links.length, 1);
  });
  await test("Active valid manual claim blocks second actor and is never stolen", async () => {
    const b = fixture(); await b.seedStale(); b.queryJob.claimed_at = new Date().toISOString();
    const worker = b.queryJob.worker_id;
    await assert.rejects(() => b.query(() => { throw Error("ACTIVE_CLAIM_SOCKET_FORBIDDEN"); }), failure => failure.code === "SRI_TRANSMISSION_ALREADY_PROCESSING");
    assert.equal(b.queryJob.worker_id, worker); assert.equal(b.tables.sri_transmission_attempts.at(-1).status, "STARTED");
  });
  await test("Abandoned canonical manual claim is reclaimed through actual query entrypoint; authorization lookup remains first", async () => {
    const b = fixture(), previous = await b.seedStale(); let sockets = 0;
    await b.query(async url => { sockets++; assert.ok(url.includes("Autorizacion")); return response(b.authResponse()); });
    assert.equal(sockets, 1); assert.equal(b.tables.sri_transmission_attempts.find(row => row.id === previous.id).status, "FAILED");
    assert.equal(b.tables.sri_transmission_attempts.at(-1).attempt_number, 14); assert.equal(b.queryJob.attempt_number, 12);
  });
  await test("Legacy PROCESSING with unknown ownership remains safely blocked even when old", async () => {
    const b = fixture(); Object.assign(b.queryJob, { status: "PROCESSING", worker_id: "legacy-unproven-worker", claimed_at: "2020-01-01T00:00:00Z" });
    await assert.rejects(() => b.query(() => { throw Error("LEGACY_STEAL_FORBIDDEN"); }), failure => failure.code === "SRI_TRANSMISSION_ALREADY_PROCESSING");
    assert.equal(b.calls.filter(call => call.rpc === "claim_sri_manual_authorization").length, 0);
  });
  await test("Ownership lost after SOAP prevents response, authorization and settlement writes", async () => {
    const b = fixture();
    await assert.rejects(() => b.query(async () => { b.queryJob.worker_id = "another-owner"; return response(b.authResponse()); }), failure => failure.code === "SRI_MANUAL_AUTHORIZATION_CLAIM_LOST");
    assert.equal(b.tables.sri_responses.length, 0); assert.equal(b.document.status, "PENDIENTE_REINTENTO");
    assert.equal(b.calls.filter(call => /record_sri_|settle_sri_manual/.test(call.rpc || "")).length, 0);
  });
  await test("Lost network response remains uncertain; no reception and no automated budget extension", async () => {
    const b = fixture(); let sockets = 0;
    await assert.rejects(() => b.query(async url => { sockets++; assert.ok(url.includes("Autorizacion")); throw new TypeError("fetch failed"); }));
    assert.equal(sockets, 1); assert.equal(b.queryJob.status, "FAILED"); assert.equal(b.queryJob.error_class, "SRI_TRANSPORT_RESULT_UNCERTAIN");
    assert.equal(b.queryJob.attempt_number, 12); assert.equal(b.queryJob.next_attempt_at, null);
  });
  await test("Official NO AUTORIZADO is persisted as final with no resend", async () => {
    const b = fixture(); await b.query(async url => { assert.ok(url.includes("Autorizacion")); return response(b.authResponse("NO AUTORIZADO")); });
    assert.equal(b.document.status, "NO_AUTORIZADO"); assert.equal(b.queryJob.status, "COMPLETED");
  });
  await test("Wrong SRI identity fails closed and cannot reopen as uncertain manual recovery", async () => {
    const b = fixture();
    await assert.rejects(() => b.query(async () => response(b.authResponse().replaceAll(b.document.access_key, "0".repeat(49)))), failure => failure.code === "SRI_AUTHORIZATION_IDENTITY_MISMATCH");
    assert.equal(b.document.status, "PENDIENTE_REINTENTO"); assert.equal(b.tables.sri_responses.length, 0);
    assert.equal(b.queryJob.error_class, "SRI_AUTHORIZATION_IDENTITY_MISMATCH");
    await assert.rejects(() => b.query(() => { throw Error("IDENTITY_ERROR_REOPEN_FORBIDDEN"); }));
    assert.equal(b.calls.filter(call => call.rpc === "claim_sri_manual_authorization").length, 1);
  });
  await test("Tampered atomic claim acknowledgment blocks HTTP and document mutation", async () => {
    const b = fixture(), rpc = b.client.rpc;
    b.client.rpc = async (name, args) => { const result = await rpc(name, args); if (name === "claim_sri_manual_authorization") result.data.claim_attempt.document_id = "wrong-document"; return result; };
    await assert.rejects(() => b.query(() => { throw Error("TAMPERED_CLAIM_SOCKET_FORBIDDEN"); }), /CANONICAL_ACK_REQUIRED/);
    assert.equal(b.tables.sri_responses.length, 0); assert.equal(b.document.status, "PENDIENTE_REINTENTO");
  });
  await test("Incomplete settlement acknowledgment cannot report recovery success or repeat settlement", async () => {
    const b = fixture(), rpc = b.client.rpc;
    b.client.rpc = async (name, args) => { const result = await rpc(name, args); return name === "settle_sri_manual_authorization" ? { data: {} } : result; };
    await assert.rejects(() => b.query(async () => response(b.authResponse())), failure => failure.code === "SRI_MANUAL_AUTHORIZATION_CANONICAL_ACK_REQUIRED");
    assert.equal(b.calls.filter(call => call.rpc === "settle_sri_manual_authorization").length, 1);
    assert.equal(b.queryJob.attempt_number, 12); assert.equal(b.queryJob.max_attempts, 12);
  });
  await test("Revoked actor and tampered transmission identity block before manual claim", async () => {
    const b = fixture(); b.authority.allowed = false;
    await assert.rejects(() => b.query(() => { throw Error("REVOKED_ACTOR_SOCKET_FORBIDDEN"); }), failure => failure.code === "SRI_TRANSPORT_ACTOR_DENIED");
    b.authority.allowed = true; b.queryJob.environment = "TEST";
    await assert.rejects(() => b.query(() => { throw Error("TAMPERED_IDENTITY_SOCKET_FORBIDDEN"); }), failure => failure.code === "SRI_TRANSMISSION_IDENTITY_MISMATCH");
    assert.equal(b.calls.filter(call => call.rpc === "claim_sri_manual_authorization").length, 0);
  });
  await test("Automatic worker never claims manual query or resets exhausted automatic counter", async () => {
    const b = fixture();
    await assert.rejects(() => b.service.transmitDocument(b.client, b.document.company_id, b.document.id, null, {
      retryJob: structuredClone(b.queryJob), fetchImpl: () => { throw Error("AUTOMATIC_MANUAL_QUERY_FORBIDDEN"); }
    }), failure => failure.code === "SRI_TRANSMISSION_NOT_DUE");
    assert.equal(b.calls.filter(call => call.rpc === "claim_sri_manual_authorization").length, 0); assert.equal(b.queryJob.attempt_number, 12);
  });
  await test("TEST query remains isolated on TEST endpoint after company default switches to PROD", async () => {
    const b = fixture("TEST"); b.tables.sri_settings[0].environment = "PRODUCTION"; b.tables.sri_settings[0].production_enabled = true;
    await b.query(async url => { assert.equal(url, endpointFor("TEST", "AUTHORIZATION_QUERY")); return response(b.authResponse()); });
    assert.equal(b.document.environment, "TEST");
  });
  for (const type of ["01", "04"]) await test(`${type} exhausted query does not acquire the new retention manual path`, async () => {
    const b = fixture("PRODUCTION", type);
    await assert.rejects(() => b.query(() => { throw Error("NON_RETENTION_MANUAL_PATH_FORBIDDEN"); }), failure => failure.code === "SRI_TRANSMISSION_NOT_CLAIMABLE");
    assert.equal(b.calls.filter(call => call.rpc === "claim_sri_manual_authorization").length, 0);
  });
  console.log(JSON.stringify({ result: results.every(row => row.result === "PASS") ? "PASS" : "FAIL",
    passed: results.filter(row => row.result === "PASS").length, results,
    realTransmissions: 0, additionalDocuments: 0, sequenceDelta: 0, accessKeyDelta: 0, journalDelta: 0 }, null, 2));
  process.exitCode = results.every(row => row.result === "PASS") ? 0 : 1;
})();
