const { createClient } = require("@supabase/supabase-js");
const { SriConfigurationError, SriValidationError } = require("./errors.cjs");

let singleton = null;

function serverConfiguration(environment = process.env) {
  const url = String(environment.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) {
    throw new SriConfigurationError("El backend SRI requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (environment.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    throw new SriConfigurationError("La clave service_role nunca puede exponerse como variable VITE.");
  }
  return { url, serviceRoleKey };
}

function getSupabaseAdmin(environment = process.env) {
  if (singleton) return singleton;
  const config = serverConfiguration(environment);
  singleton = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-erp-service": "sri-electronic-documents" } }
  });
  return singleton;
}

function getSupabaseUserContext(accessToken, environment = process.env) {
  const config = serverConfiguration(environment);
  const token = String(accessToken || "").trim();
  if (!token) throw new SriValidationError("Se requiere una sesion autenticada.");
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { authorization: `Bearer ${token}` } }
  });
}

async function assertUserCapability(accessToken, companyId, capabilityId, environment = process.env) {
  const client = getSupabaseUserContext(accessToken, environment);
  const { error } = await client.rpc("erp_security_assert_capability", {
    p_company_id: companyId,
    p_capability_id: capabilityId
  });
  if (error) {
    const denied = new SriValidationError("El usuario no tiene la capability requerida para esta operacion.");
    denied.code = "CAPABILITY_REQUIRED";
    denied.details = { capabilityId };
    throw denied;
  }
  return true;
}

function bearerToken(request) {
  const header = String(request?.headers?.authorization || request?.headers?.Authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new SriValidationError("Se requiere una sesion autenticada.");
  return match[1];
}

async function authenticateCompanyRequest(client, request, requestedCompanyId, allowedRoles = null) {
  const token = bearerToken(request);
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData?.user) throw new SriValidationError("La sesion no es valida o expiro.");

  let query = client
    .from("sri_company_memberships")
    .select("company_id, role_code, active")
    .eq("auth_user_id", userData.user.id)
    .eq("active", true);
  if (requestedCompanyId) query = query.eq("company_id", requestedCompanyId);
  const { data: memberships, error: membershipError } = await query;
  if (membershipError) throw membershipError;
  const membership = memberships?.[0];
  if (!membership) throw new SriValidationError("El usuario no pertenece a la empresa solicitada.");
  if (allowedRoles?.length && !allowedRoles.includes(membership.role_code)) {
    throw new SriValidationError("El usuario no tiene permisos para esta operacion.");
  }
  return {
    user: userData.user,
    companyId: membership.company_id,
    roleCode: membership.role_code,
    accessToken: token
  };
}

module.exports = {
  serverConfiguration,
  getSupabaseAdmin,
  getSupabaseUserContext,
  assertUserCapability,
  bearerToken,
  authenticateCompanyRequest
};
