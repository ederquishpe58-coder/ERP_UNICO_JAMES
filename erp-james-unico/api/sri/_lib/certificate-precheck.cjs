const { getSupabaseAdmin, getSupabaseUserContext } = require("./supabase-admin.cjs");
const { validateInMemory, identityRuc, MAX_BYTES } = require("./certificate-validator.cjs");
const { SECRET_REFERENCES } = require("./certificate.cjs");
const CAPABILITY = "tax.parameters.manage";

function reply(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  return response.end(JSON.stringify(payload));
}

async function handleCertificatePrecheck(request, response, { dryRun = false } = {}) {
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
    const allowedFields = ["action", "company_id", "certificate_file", ...(dryRun ? ["document_type", "commercial_context"] : [])];
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !allowedFields.includes(k))) {
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
      .select(dryRun ? "id, tax_id, is_active, legal_name, commercial_name" : "id, tax_id, is_active").eq("id", companyId).maybeSingle();
    if (companyError || company?.id !== companyId || company.is_active !== true || !/^\d{13}$/.test(company.tax_id || "")) {
      return fail(422, "CANONICAL_COMPANY_REQUIRED", "Falta el RUC canónico de una empresa activa.");
    }
    if (dryRun && !require("./certificate-dry-run.cjs").allowedDryRun(companyId, body.document_type, body.commercial_context)) {
      return fail(422, "DRY_RUN_FIXTURE_REQUIRED", "Seleccione una prueba permitida para esta empresa: factura local/exportación o retención BLESS.");
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
    const data = dryRun
      ? await require("./certificate-dry-run.cjs").validateSriXmlSignatureDryRun(bytes, process.env[SECRET_REFERENCES[companyId]], company, body.document_type, body.commercial_context)
      : validateInMemory(bytes, process.env[SECRET_REFERENCES[companyId]], companyId, company.tax_id);
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
