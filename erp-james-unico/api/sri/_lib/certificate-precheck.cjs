const forge = require("node-forge");
const { randomBytes } = require("node:crypto");
const { getSupabaseAdmin, getSupabaseUserContext } = require("./supabase-admin.cjs");

const CAPABILITY = "tax.parameters.manage";
const MAX_BYTES = 3 * 1024 * 1024;
// Approved server-side references. Neither the secret name nor its value comes from the request.
const SECRET_REFERENCES = Object.freeze({
  "cf331b82-7ac3-4065-9e38-d0bbcde96cd5": "SRI_P12_PASSWORD_BLESS",
  "ab60abdc-fe53-4289-9ae2-8f749ee21cff": "SRI_P12_PASSWORD_IMPERIO"
});

function identityRuc(certificate) {
  // Only explicit subject identity attributes count. CN, filenames, issuer and arbitrary
  // numeric subject text do not prove an Ecuadorian taxpayer identity.
  const candidates = (certificate.subject?.attributes || [])
    .filter(a => a.type === "2.5.4.5" || a.type === "2.5.4.97")
    .map(a => String(a.value || "").trim().match(/^(?:PNOEC-|VATEC-)?(\d{10}|\d{13})$/)?.[1])
    .filter(Boolean)
    .map(id => id.length === 10 ? `${id}001` : id);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

function safeName(name) {
  const attribute = name?.attributes?.find(a => a.type === "2.5.4.10")
    || name?.attributes?.find(a => a.type === "2.5.4.3");
  return String(attribute?.value || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160);
}

function boundedDer(node, depth = 0) {
  if (depth > 32) throw new Error("UNSUPPORTED_CONTAINER");
  if (Array.isArray(node.value)) {
    for (const child of node.value) boundedDer(child, depth + 1);
    // PKCS#12 MacData, PKCS#12 PBE and PBKDF2 iteration counts use INTEGER.
    // A certificate INTEGER (e.g. serial/modulus) is inside an OCTET STRING here.
    for (const child of node.value) {
      if (child.tagClass === 0 && child.type === forge.asn1.Type.INTEGER) {
        if (child.value.length > 4) throw new Error("UNSUPPORTED_CONTAINER");
        let n = 0;
        for (const byte of child.value) n = n * 256 + byte.charCodeAt(0);
        if (n > 1000000) throw new Error("UNSUPPORTED_CONTAINER");
      }
    }
  }
}

function validateInMemory(bytes, password, companyId, expectedRuc, now = new Date()) {
  const result = {
    valid: false, company_id: companyId, ruc_match: "UNPROVEN",
    subject_safe_summary: "", issuer: "", serial_number: "",
    not_before: null, not_after: null, expired: false,
    private_key_present: false, private_key_usable: false,
    secret_resolution: typeof password === "string" && password.length ? "PASS" : "FAIL",
    certificate_format: "PKCS12"
  };
  if (result.secret_resolution !== "PASS") return result;
  try {
    const asn1 = forge.asn1.fromDer(bytes.toString("binary"));
    boundedDer(asn1);
    // The authenticatedSafe is DER wrapped in an OCTET STRING. Inspect it before KDF work.
    const authenticatedSafe = asn1.value?.[1]?.value?.[1]?.value?.[0]?.value;
    if (typeof authenticatedSafe !== "string") return result;
    boundedDer(forge.asn1.fromDer(authenticatedSafe));
    const container = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const keys = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]
      .flatMap(bagType => container.getBags({ bagType })[bagType] || []).filter(bag => bag.key);
    const certs = (container.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])
      .filter(bag => bag.cert);
    result.private_key_present = keys.length > 0;
    if (keys.length !== 1 || certs.length > 16) return result;
    const key = keys[0].key;
    const matching = certs.filter(b => b.cert.publicKey?.n?.equals(key.n) && b.cert.publicKey?.e?.equals(key.e));
    if (matching.length !== 1) return result;
    const certificate = matching[0].cert;
    const challenge = randomBytes(32).toString("binary");
    const digest = forge.md.sha256.create().update(challenge);
    result.private_key_usable = certificate.publicKey.verify(digest.digest().getBytes(), key.sign(digest));
    const start = certificate.validity.notBefore;
    const end = certificate.validity.notAfter;
    result.not_before = start.toISOString();
    result.not_after = end.toISOString();
    result.expired = end <= now;
    result.serial_number = /^[a-f0-9]{1,128}$/i.test(certificate.serialNumber) ? certificate.serialNumber : "";
    result.issuer = safeName(certificate.issuer);
    const ruc = identityRuc(certificate);
    result.ruc_match = ruc ? (ruc === expectedRuc ? "PASS" : "FAIL") : "UNPROVEN";
    result.subject_safe_summary = ruc ? "Identidad tributaria presente" : "Identidad tributaria no demostrada";
    result.valid = result.ruc_match === "PASS" && result.private_key_usable && !result.expired && start <= now;
  } catch {
    // Never propagate parser/crypto exceptions, which can contain certificate or secret data.
    result.valid = false;
  }
  return result;
}

function reply(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  return response.end(JSON.stringify(payload));
}

async function handleCertificatePrecheck(request, response) {
  const fail = (status, code, message) => reply(response, status, { ok: false, error: { code, message } });
  let bytes;
  let body;
  try {
    if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Utilice la acción Validar certificado.");
    const token = /^Bearer\s+(\S+)$/i.exec(String(request.headers?.authorization || request.headers?.Authorization || ""))?.[1];
    if (!token) return fail(401, "AUTH_REQUIRED", "Inicie sesión en el ERP.");
    const client = getSupabaseAdmin();
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth?.user?.id) return fail(401, "AUTH_REQUIRED", "La sesión no es válida o expiró.");
    if (typeof request.body === "string" && request.body.length > MAX_BYTES * 4 / 3 + 1024) {
      return fail(413, "CERTIFICATE_TOO_LARGE", "El archivo debe tener como máximo 3 MB.");
    }
    try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
    catch { return fail(400, "INVALID_INPUT", "Solicitud de certificado inválida."); }
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !["action", "company_id", "certificate_file"].includes(k))) {
      return fail(400, "INVALID_INPUT", "Envíe solamente empresa y archivo; la contraseña se resuelve en el servidor.");
    }
    const companyId = body.company_id;
    if (typeof companyId !== "string" || !Object.hasOwn(SECRET_REFERENCES, companyId)) {
      return fail(403, "COMPANY_REQUIRED", "Seleccione una empresa autorizada con referencia de certificado configurada.");
    }
    // This canonical STABLE RPC enforces membership, profile, grants and base-denied
    // under the actual ERP JWT. No role (including OWNER) bypasses it.
    const { error: denied } = await getSupabaseUserContext(token).rpc("erp_security_assert_capability", {
      p_company_id: companyId, p_capability_id: CAPABILITY
    });
    if (denied) return fail(403, "CAPABILITY_REQUIRED", "No tiene autorización para validar certificados de esta empresa.");
    const { data: company, error: companyError } = await client.from("companies")
      .select("id, tax_id, is_active").eq("id", companyId).maybeSingle();
    if (companyError || company?.id !== companyId || company.is_active !== true || !/^\d{13}$/.test(company.tax_id || "")) {
      return fail(422, "CANONICAL_COMPANY_REQUIRED", "Falta el RUC canónico de una empresa activa.");
    }
    const encoded = body.certificate_file;
    if (typeof encoded !== "string" || !encoded.length || encoded.length > MAX_BYTES * 4 / 3
      || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return fail(400, "INVALID_CERTIFICATE_FILE", "Seleccione un archivo PKCS#12 (.p12 o .pfx), de hasta 3 MB.");
    }
    bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString("base64") !== encoded) {
      return fail(400, "INVALID_CERTIFICATE_FILE", "El archivo PKCS#12 no es válido.");
    }
    const data = validateInMemory(bytes, process.env[SECRET_REFERENCES[companyId]], companyId, company.tax_id);
    return reply(response, 200, { ok: true, data });
  } catch {
    return fail(503, "PRECHECK_UNAVAILABLE", "No fue posible validar el certificado. Revise la sesión y la configuración segura del servidor.");
  } finally {
    bytes?.fill(0);
    if (body && typeof body === "object") delete body.certificate_file;
    request.body = undefined;
    // No buffers, secrets, exceptions, audit writes or storage calls escape this action.
  }
}

module.exports = { handleCertificatePrecheck, validateInMemory, identityRuc, MAX_BYTES, CAPABILITY };
