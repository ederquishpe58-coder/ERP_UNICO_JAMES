const { randomUUID } = require("node:crypto");
const { getSupabaseAdmin, getSupabaseUserContext } = require("./supabase-admin.cjs");
const { approvedPlan } = require("./test-apply-plan.cjs");
const { canonicalCertificateCompany, certificateSecretName, resolveCertificatePassword, parsePkcs12, releaseCertificateMaterial } = require("./certificate.cjs");
const { validateSriXmlSignatureDryRun } = require("./certificate-dry-run.cjs");
const { MAX_BYTES } = require("./certificate-validator.cjs");
const CAPABILITY = "tax.parameters.manage";
const ACTIONS = ["review-sri-test-configuration", "precheck-sri-test-configuration", "apply-sri-test-configuration"];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const SAFE = new Set(["AUTH_REQUIRED","CAPABILITY_REQUIRED","COMPANY_NOT_APPROVED","CANONICAL_COMPANY_DRIFT","PLAN_DRIFT","BASELINE_DRIFT","PRIVATE_STORAGE_REQUIRED","CERTIFICATE_REQUIRED","CERTIFICATE_INVALID","CERTIFICATE_STORAGE_CONFLICT","CERTIFICATE_STORAGE_MISMATCH","SECRET_REQUIRED","XML_XADES_FAILED","INVALID_INPUT","ACTIVAR_TEST_REQUIRED","APPLY_IN_PROGRESS","OPERATION_LEASE_MISMATCH","ROLLBACK_HAS_BUSINESS_REFERENCES","STORAGE_CLEANUP_REQUIRED","SEQUENCE_OR_DOCUMENT_DRIFT","SEQUENCE_COUNT_DRIFT","POINT_DRIFT","SETTINGS_DRIFT","RECOVERY_REQUIRED","ROLLBACK_INCOMPLETE","APPLY_FAILED","PRECHECK_REQUIRED"]);
function safeCode(error) {
  if (error?.code === "AUTHORIZATION_CHECK_FAILED") return error.code;
  if (SAFE.has(error?.code)) return error.code;
  const message = String(error?.message || "");
  return [...SAFE].find(code => message === code) || "APPLY_FAILED";
}
async function authorizeCapability(userClient, companyId, capability) {
  let result;
  try { result = await userClient.rpc("erp_security_assert_capability", { p_company_id: companyId, p_capability_id: capability }); }
  catch { fail("AUTHORIZATION_CHECK_FAILED"); }
  if (!result || typeof result !== "object" || !("error" in result)) fail("AUTHORIZATION_CHECK_FAILED");
  const { error } = result;
  if (!error) return;
  const denied = error.code === "42501";
  throw Object.assign(new Error(denied ? "CAPABILITY_REQUIRED" : "AUTHORIZATION_CHECK_FAILED"), {
    code: denied ? "CAPABILITY_REQUIRED" : "AUTHORIZATION_CHECK_FAILED",
    details: denied ? { capability_id: capability, company_id: companyId } : undefined
  });
}
function reply(res, status, value) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  return res.end(JSON.stringify(value));
}
function decodeFile(encoded) {
  if (typeof encoded !== "string" || !encoded.length || encoded.length > MAX_BYTES * 4 / 3 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail("CERTIFICATE_REQUIRED");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) { bytes.fill(0); fail("CERTIFICATE_INVALID"); }
  return bytes;
}

// The database phase RPC is private to the server, not exposed to the browser.
// Every phase is preceded by capability enforcement using the real ERP JWT.
// The actor comes exclusively from auth.getUser; no caller-supplied actor/role.
function engine({ admin, userClient, companyId, userId, hash, lease = randomUUID(), environment = process.env, dryRun = validateSriXmlSignatureDryRun }) {
  const { company: plan } = approvedPlan(companyId);
  let operation = null;
  async function authorize() {
    for (const capability of [CAPABILITY, "admin.sequences.manage"]) {
      await authorizeCapability(userClient, companyId, capability);
    }
  }
  async function phase(name, certificate = null, { compensating = false } = {}) {
    // A server-owned compensation must still turn TEST off if the user's token
    // expires during the request. It is limited by the acquired operation lease.
    if (!compensating) await authorize();
    const { data, error } = await admin.rpc("erp_sri_test_apply_phase", { p_company_id: companyId, p_actor_id: userId,
      p_plan_hash: hash, p_phase: name, p_lease: lease, p_certificate: certificate });
    if (error) throw error;
    return data;
  }
  async function bucket() {
    const { data, error } = await admin.storage.getBucket("sri-private");
    if (error || data?.public !== false) fail("PRIVATE_STORAGE_REQUIRED");
    return admin.storage.from("sri-private");
  }
  async function current() {
    await bucket();
    const company = await canonicalCertificateCompany(admin, companyId);
    if (company.tax_id !== plan.settings.ruc) fail("CANONICAL_COMPANY_DRIFT");
    const state = await phase("status");
    return { state, company: { ...company, legal_name: plan.settings.legalName, commercial_name: plan.settings.commercialName } };
  }
  async function validate(bytes, company) {
    let material;
    try {
      let password;
      try { password = resolveCertificatePassword(certificateSecretName(companyId), environment); }
      catch { fail("SECRET_REQUIRED"); }
      try { material = parsePkcs12(bytes, password, { companyId, expectedRuc: company.tax_id }); }
      catch { fail("CERTIFICATE_INVALID"); }
      if (material.metadata.notAfter.slice(0, 10) !== plan.certificate.humanExpiration) fail("PLAN_DRIFT");
      const checks = [];
      for (const [type, context] of [["01","LOCAL"],["01","EXPORT"], ...(plan.settings.withholdingAgentNumber ? [["07",undefined]] : [])]) {
        const result = await dryRun(bytes, password, company, type, context);
        if (!result.valid || result.environment !== "TEST" || result.writes !== 0) fail("XML_XADES_FAILED");
        checks.push({ type, context: context || "RETENTION", xml: result.xml_build, xades: result.xades_sign, series: result.series });
      }
      return { metadata: { ...material.metadata }, checks };
    } finally { releaseCertificateMaterial(material); }
  }
  async function emptyStorage() {
    const storage = await bucket();
    const { data, error } = await storage.list("companies/" + companyId + "/certificates", { limit: 1 });
    if (error || data?.length) fail("CERTIFICATE_STORAGE_CONFLICT");
  }
  async function review() {
    const { state } = await current();
    return { ...state, company_id: companyId, approved_plan_hash: hash, plan: { company: plan.code, ruc: plan.settings.ruc,
      establishment: "001", local: "001-003", export: "001-002", retention: plan.settings.withholdingAgentNumber ? "001-002" : "NOT_APPLICABLE",
      withholding_agent_number: plan.settings.withholdingAgentNumber, sequences: plan.sequences.map(s => ({ point: "001-" + s.emissionPointCode, type: s.documentType, first: s.expectedFirst })),
      config_rows: 4 + plan.sequences.length, certificate_objects: 1 }, writes: 0 };
  }
  async function precheck(bytes) {
    const { state, company } = await current();
    if (state.status === "ALREADY_APPLIED") return { ...state, checks: [], writes: 0 };
    const recovering = !["READY","ROLLED_BACK"].includes(state.status);
    if (!recovering) await emptyStorage();
    const checked = await validate(bytes, company);
    return { status: "PASS", company_id: companyId, approved_plan_hash: hash, certificate: "PASS", ruc_match: "PASS", expiration: checked.metadata.notAfter, checks: checked.checks, recovery_required: recovering, writes: 0 };
  }
  async function compensate() {
    const disabled = await phase("disable", null, { compensating: true });
    const storage = admin.storage.from("sri-private");
    if (disabled.storage_path) {
      const { data: listed, error } = await storage.list("companies/" + companyId + "/certificates", { limit: 1000 });
      if (error) fail("STORAGE_CLEANUP_REQUIRED");
      const file = (listed || []).find(f => disabled.storage_path.endsWith("/" + f.name));
      if (file) {
        // The upload tags its immutable owner; never delete a preexisting object.
        const { data: info, error: infoError } = await storage.info(disabled.storage_path);
        if (infoError) fail("STORAGE_CLEANUP_REQUIRED");
        if ((info?.metadata?.operationId || info?.metadata?.operation_id) === operation.operation_id) {
          const { error: removeError } = await storage.remove([disabled.storage_path]);
          if (removeError) fail("STORAGE_CLEANUP_REQUIRED");
        }
      }
    }
    return phase("rollback", null, { compensating: true });
  }
  async function apply(bytes) {
    let beginAttempted = false;
    try {
      const { state, company } = await current();
      if (state.status === "ALREADY_APPLIED") return { ...state, company_id: companyId, sequences_consumed: 0, documents_created: 0 };
      let checked;
      if (["READY","ROLLED_BACK"].includes(state.status)) { await emptyStorage(); checked = await validate(bytes, company); }
      beginAttempted = true;
      operation = await phase("begin");
      if (operation.status === "ALREADY_APPLIED") return { ...operation, company_id: companyId, sequences_consumed: 0, documents_created: 0 };
      if (operation.status === "RECOVERY_REQUIRED") return { ...await compensate(), company_id: companyId, error: "RECOVERY_REQUIRED" };
      if (!checked) fail("PRECHECK_REQUIRED");
      const fingerprint = checked.metadata.fingerprintSha256.toLowerCase();
      const intent = await phase("storage-intent", { fingerprint });
      const storage = await bucket();
      const { error: uploadError } = await storage.upload(intent.storage_path, bytes, { contentType: "application/x-pkcs12", upsert: false, cacheControl: "private, no-store", metadata: { operation_id: operation.operation_id, company_id: companyId } });
      if (uploadError) fail("CERTIFICATE_STORAGE_CONFLICT");
      await phase("certificate", checked.metadata);
      const { data: stored, error: downloadError } = await storage.download(intent.storage_path);
      if (downloadError || !stored) fail("CERTIFICATE_STORAGE_MISMATCH");
      const loaded = Buffer.from(await stored.arrayBuffer());
      let confirmed;
      try {
        confirmed = await validate(loaded, company);
        if (confirmed.metadata.fingerprintSha256.toLowerCase() !== fingerprint) fail("CERTIFICATE_STORAGE_MISMATCH");
      } finally { loaded.fill(0); }
      // Last functional write: all company config, Storage reload and XML/XAdES
      // checks have passed. No sequence allocator or document service is called.
      const result = await phase("enable");
      const after = await phase("status");
      if (after.status !== "ALREADY_APPLIED" || after.test_enabled !== true || after.production_enabled !== false) fail("SETTINGS_DRIFT");
      return { ...result, company_id: companyId, certificate: "PASS", ruc_match: "PASS", checks: confirmed.checks, error: "NONE" };
    } catch (error) {
      // A committed begin may lose its HTTP response. Recover only the lease
      // owned by this request; another actor/request can never be compensated.
      if (!operation?.operation_id && beginAttempted) {
        try { operation = await phase("disable", null, { compensating: true }); }
        catch { throw error; }
      }
      if (!operation?.operation_id) throw error;
      try { return { ...await compensate(), company_id: companyId, error: safeCode(error), sequences_consumed: 0, documents_created: 0 }; }
      catch { return { status: "FAIL", company_id: companyId, operation_id: operation.operation_id, error: "ROLLBACK_INCOMPLETE", test_enabled: null, production_enabled: false, recovery_required: true }; }
    }
  }
  return { review, precheck, apply };
}

async function handleTestApply(request, response) {
  let body, bytes;
  try {
    if (request.method !== "POST") return reply(response,405,{ok:false,error:{code:"METHOD_NOT_ALLOWED"}});
    const token = /^Bearer\s+(\S+)$/i.exec(String(request.headers?.authorization || ""))?.[1];
    if (!token) return reply(response,401,{ok:false,error:{code:"AUTH_REQUIRED"}});
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return reply(response,401,{ok:false,error:{code:"AUTH_REQUIRED"}});
    if (typeof request.body === "string" && request.body.length > MAX_BYTES * 4 / 3 + 1024) fail("INVALID_INPUT");
    try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; } catch { fail("INVALID_INPUT"); }
    // certificate_file is transient upload transport, never free configuration.
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !["action","company_id","approved_plan_hash","explicit_confirmation","certificate_file"].includes(k)) || !ACTIONS.includes(body.action)) fail("INVALID_INPUT");
    const { hash } = approvedPlan(body.company_id);
    if (body.action !== ACTIONS[0] && body.approved_plan_hash !== hash) fail("PLAN_DRIFT");
    const userClient = getSupabaseUserContext(token);
    await authorizeCapability(userClient, body.company_id, CAPABILITY);
    const action = engine({ admin, userClient, companyId: body.company_id, userId: data.user.id, hash });
    if (body.action === ACTIONS[0]) return reply(response,200,{ok:true,data:await action.review()});
    if (body.action === ACTIONS[2] && body.explicit_confirmation !== "ACTIVAR TEST") fail("ACTIVAR_TEST_REQUIRED");
    bytes = decodeFile(body.certificate_file);
    const result = body.action === ACTIONS[1] ? await action.precheck(bytes) : await action.apply(bytes);
    return reply(response,200,{ok:true,data:result});
  } catch (error) {
    const code = safeCode(error);
    const details = code === "CAPABILITY_REQUIRED" && [CAPABILITY, "admin.sequences.manage"].includes(error?.details?.capability_id)
      ? { capability_id: error.details.capability_id, company_id: body?.company_id } : undefined;
    return reply(response,code === "AUTHORIZATION_CHECK_FAILED" ? 503 : ["CAPABILITY_REQUIRED","COMPANY_NOT_APPROVED"].includes(code)?403:422,{ok:false,error:{code,message:code,details}});
  } finally { bytes?.fill(0); if (body) delete body.certificate_file; request.body = undefined; }
}
module.exports = { ACTIONS, CAPABILITY, engine, handleTestApply, safeCode };
