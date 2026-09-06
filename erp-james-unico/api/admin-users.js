const crypto = require("node:crypto");
const {
  assertUserCapability,
  getSupabaseAdmin,
  getSupabaseUserContext,
  bearerToken
} = require("./sri/_lib/supabase-admin.cjs");

const COMPANY_KEY_PATTERN = /^COMP-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const MEMBERSHIP_ROLES = new Set(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
const EMAIL_RATE_LIMIT_RETRY_SECONDS = 60 * 60;

function isEmailRateLimitError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return Number(error?.status || error?.statusCode || 0) === 429
    || code === "over_email_send_rate_limit"
    || /email rate limit|rate limit.*email|too many.*email/.test(message);
}

function emailRateLimitError() {
  return Object.assign(new Error(
    "Supabase alcanzó el límite temporal de correos de invitación. No se creó una invitación confirmada. Espere hasta una hora o configure SMTP propio en Supabase antes de reintentar."
  ), {
    statusCode: 429,
    code: "EMAIL_RATE_LIMIT",
    retryAfterSeconds: EMAIL_RATE_LIMIT_RETRY_SECONDS
  });
}

function bodyOf(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) return JSON.parse(request.body);
  return {};
}

function queryOf(request, key) {
  if (request.query?.[key] != null) return request.query[key];
  return new URL(request.url, "http://localhost").searchParams.get(key);
}

function send(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(payload));
}

function uuidOrNull(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function normalizedUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("El usuario de ingreso debe tener entre 3 y 64 caracteres válidos.");
  }
  return username;
}

function inviteRedirectUrl(request, requestedValue = "") {
  const forwardedProto = String(request.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  const forwardedHost = String(request.headers?.["x-forwarded-host"] || request.headers?.host || "").split(",")[0].trim();
  const fallbackOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : "";
  const requested = String(requestedValue || "").trim();
  let target;
  try {
    target = new URL(requested || "/crear-contrasena", fallbackOrigin || "http://localhost");
  } catch {
    throw new Error("La URL de creación de contraseña no es válida.");
  }
  if (fallbackOrigin) {
    const allowedOrigin = new URL(fallbackOrigin).origin;
    if (target.origin !== allowedOrigin) throw new Error("La invitación solo puede volver al dominio actual del sistema.");
  }
  target.pathname = "/crear-contrasena";
  target.search = "";
  target.hash = "";
  return target.toString();
}

async function actor(client, request) {
  let token;
  try { token = bearerToken(request); }
  catch { throw Object.assign(new Error("La sesión no es válida o expiró."), { statusCode: 401 }); }
  if (!token) throw Object.assign(new Error("La sesión no es válida o expiró."), { statusCode: 401 });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error("La sesión no es válida o expiró."), { statusCode: 401 });
  return { ...data.user, accessToken: token };
}

async function companyByKey(client, companyKey) {
  const key = String(companyKey || "").trim().toUpperCase();
  if (!COMPANY_KEY_PATTERN.test(key)) throw new Error("La empresa solicitada no es válida.");
  const { data, error } = await client
    .from("companies")
    .select("id, company_key, commercial_name")
    .eq("company_key", key)
    .eq("is_active", true)
    .single();
  if (error || !data) throw new Error("La empresa no existe o está inactiva.");
  return data;
}

async function assertCanManage(client, actorUser, companyId, requestedRole = "VIEWER", capabilityId = "admin.users.manage") {
  const userId = actorUser.id;
  const { data: membership, error: membershipError } = await client
    .from("user_company_memberships")
    .select("membership_role, membership_status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("membership_status", "ACTIVE")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership || !["OWNER", "ADMIN"].includes(membership.membership_role)) {
    throw new Error("No tiene autorización para administrar usuarios de esta empresa.");
  }
  if (requestedRole === "OWNER" && membership.membership_role !== "OWNER") {
    throw new Error("Solo un propietario puede asignar otro propietario.");
  }
  await assertUserCapability(actorUser.accessToken, companyId, capabilityId);
  return membership;
}

async function assertMembershipTransition(client, actorUser, companyId, targetUserId, requestedRole) {
  const { data: targetMembership, error } = await client
    .from("user_company_memberships")
    .select("membership_role, membership_status")
    .eq("company_id", companyId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) throw error;
  if (!targetMembership) return;
  const changingOwner = targetMembership.membership_role === "OWNER" && requestedRole !== "OWNER";
  if (!changingOwner) return;
  if (targetUserId === actorUser.id) {
    throw new Error("Un propietario no puede reducir su propio nivel de membresía.");
  }
  const { count, error: countError } = await client
    .from("user_company_memberships")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("membership_role", "OWNER")
    .eq("membership_status", "ACTIVE");
  if (countError) throw countError;
  if (Number(count || 0) <= 1) throw new Error("No se puede remover al último propietario activo de la empresa.");
}

async function authUsersById(client) {
  const map = new Map();
  let page = 1;
  while (page <= 10) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    (data?.users || []).forEach(user => map.set(user.id, user));
    if ((data?.users || []).length < 100) break;
    page += 1;
  }
  return map;
}

async function listUsers(client, actorUser, company) {
  const actorMembership = await assertCanManage(client, actorUser, company.id, "VIEWER", "admin.users.view");
  const { data: memberships, error: membershipError } = await client
    .from("user_company_memberships")
    .select("id, company_id, user_id, membership_role, membership_status, is_default, display_name_override, area, job_title, notes, valid_from, valid_until")
    .eq("company_id", company.id)
    .order("created_at");
  if (membershipError) throw membershipError;
  const ids = [...new Set((memberships || []).map(row => row.user_id))];
  const userProfiles = ids.length
    ? await client.from("user_profiles")
        .select("user_id, display_name, username, phone, default_company_id, is_active")
        .in("user_id", ids)
    : { data: [], error: null };
  if (userProfiles.error) throw userProfiles.error;
  const canonicalAssignments = ids.length
    ? await client.from("erp_security_user_company_profiles")
        .select("company_id, user_id, profile_id, assigned_at, updated_at")
        .eq("company_id", company.id)
        .in("user_id", ids)
    : { data: [], error: null };
  if (canonicalAssignments.error) throw canonicalAssignments.error;
  const assignedProfileIds = [...new Set((canonicalAssignments.data || []).map(row => row.profile_id))];
  const canonicalProfiles = assignedProfileIds.length
    ? await client.from("erp_security_profiles")
        .select("profile_id, display_name, description, active")
        .in("profile_id", assignedProfileIds)
    : { data: [], error: null };
  if (canonicalProfiles.error) throw canonicalProfiles.error;
  const legacyPermissions = ids.length
    ? await client.from("user_route_permissions")
        .select("company_id, user_id, route_id")
        .eq("company_id", company.id)
        .in("user_id", ids)
    : { data: [], error: null };
  if (legacyPermissions.error) throw legacyPermissions.error;
  const authUsers = await authUsersById(client);
  const allAuthIds = [...authUsers.keys()];
  const allMemberships = allAuthIds.length
    ? await client.from("user_company_memberships").select("user_id").in("user_id", allAuthIds)
    : { data: [], error: null };
  if (allMemberships.error) throw allMemberships.error;
  const linkedUserIds = new Set((allMemberships.data || []).map(row => row.user_id));
  const profileById = new Map((userProfiles.data || []).map(profile => [profile.user_id, profile]));
  const canonicalAssignmentByUser = new Map((canonicalAssignments.data || []).map(row => [row.user_id, row]));
  const canonicalProfileById = new Map((canonicalProfiles.data || []).map(row => [row.profile_id, row]));
  const linked = (memberships || []).map(membership => {
    const profile = profileById.get(membership.user_id) || {};
    const canonicalAssignment = canonicalAssignmentByUser.get(membership.user_id) || null;
    const canonicalProfile = canonicalAssignment ? canonicalProfileById.get(canonicalAssignment.profile_id) || null : null;
    const legacyRoutePermissionCount = (legacyPermissions.data || [])
      .filter(row => row.user_id === membership.user_id).length;
    const authUser = authUsers.get(membership.user_id);
    const contactEmail = String(authUser?.user_metadata?.contact_email || "").trim();
    const loginEmail = String(authUser?.email || "").trim();
    return {
      id: membership.user_id,
      email: contactEmail || loginEmail,
      contactEmail,
      loginEmail,
      displayName: String(authUser?.user_metadata?.display_name || "").trim(),
      username: String(authUser?.user_metadata?.username || profile.username || "").trim(),
      emailConfirmed: Boolean(authUser?.email_confirmed_at),
      unlinked: false,
      profile,
      membership,
      canonicalProfileId: canonicalAssignment?.profile_id || null,
      canonicalProfileName: canonicalProfile?.display_name || "PROFILE_MISSING",
      canonicalProfileActive: canonicalProfile?.active === true,
      profileState: canonicalProfile?.active === true ? "CANONICAL" : "PROFILE_MISSING",
      legacyRoutePermissionCount,
      legacyDependent: legacyRoutePermissionCount > 0
    };
  });
  if (actorMembership.membership_role !== "OWNER") return linked;
  const unlinked = [...authUsers.values()]
    .filter(user => !linkedUserIds.has(user.id))
    .map(user => {
      const contactEmail = String(user.user_metadata?.contact_email || "").trim();
      const loginEmail = String(user.email || "").trim();
      return {
        id: user.id,
        email: contactEmail || loginEmail,
        contactEmail,
        loginEmail,
        displayName: String(user.user_metadata?.display_name || "").trim(),
        username: String(user.user_metadata?.username || "").trim(),
        emailConfirmed: Boolean(user.email_confirmed_at),
        unlinked: true,
        profile: null,
        membership: null,
        canonicalProfileId: null,
        canonicalProfileName: "PROFILE_MISSING",
        canonicalProfileActive: false,
        profileState: "PROFILE_MISSING",
        legacyRoutePermissionCount: 0,
        legacyDependent: false
      };
    });
  return [...linked, ...unlinked];
}

async function listCanonicalProfiles(client, actorUser, company) {
  await assertCanManage(client, actorUser, company.id, "VIEWER", "admin.users.view");
  const { data, error } = await client
    .from("erp_security_profiles")
    .select("profile_id, display_name, description, active, system_defined")
    .eq("active", true)
    .order("display_name");
  if (error) throw error;
  console.info("[admin-users] canonical_profiles_loaded", {
    companyId: company.id,
    companyKey: company.company_key,
    count: Array.isArray(data) ? data.length : 0
  });
  return (data || []).map(profile => ({
    id: profile.profile_id,
    name: profile.display_name,
    description: profile.description,
    active: profile.active === true,
    systemDefined: profile.system_defined === true,
    companyId: company.id
  }));
}

async function existingTargetUser(client, input) {
  const existingId = uuidOrNull(input.id || input.userId);
  if (!existingId) throw new Error("El UUID Auth canónico es obligatorio para actualizar accesos.");
  if (String(input.password || "").trim()) {
    throw new Error("La contraseña no puede modificarse desde la administración de accesos.");
  }
  const { data, error } = await client.auth.admin.getUserById(existingId);
  if (error || !data?.user) throw new Error("El usuario de Supabase Auth no existe.");
  return {
    user: data.user,
    invited: false,
    linkedExisting: true,
    passwordUpdated: false,
    authMutations: 0
  };
}

async function createTargetUser(client, input) {
  const username = normalizedUsername(input.username || input.code);
  const contactEmail = String(input.email || "").trim().toLowerCase();
  if (uuidOrNull(input.id || input.userId)) throw new Error("CREATE_USER_NO_ADMITE_AUTH_UUID_EXISTENTE");
  if (String(input.password || "").trim()) throw new Error("CREATE_USER_NO_ADMITE_PASSWORD_ADMINISTRATIVO");
  if (!contactEmail) throw new Error("El correo es obligatorio para enviar la invitación.");
  const authUsers = await authUsersById(client);
  const existingUser = [...authUsers.values()].find(user =>
    String(user.email || "").trim().toLowerCase() === contactEmail
    || String(user.user_metadata?.contact_email || "").trim().toLowerCase() === contactEmail
    || String(user.user_metadata?.username || "").trim().toLowerCase() === username.toLowerCase()
  );
  if (existingUser) throw new Error("AUTH_EMAIL_OR_USERNAME_ALREADY_EXISTS");
  const { data, error } = await client.auth.admin.inviteUserByEmail(contactEmail, {
    redirectTo: String(input.inviteRedirectTo || "").trim(),
    data: {
      display_name: String(input.fullName || input.name || username).trim(),
      contact_email: contactEmail,
      username
    }
  });
  if (isEmailRateLimitError(error)) throw emailRateLimitError();
  if (error || !data?.user) throw new Error(error?.message || "No se pudo enviar la invitación al usuario.");
  return {
    user: data.user,
    invited: true,
    linkedExisting: false,
    passwordUpdated: false,
    created: true
  };
}

async function saveUserAccess(client, actorUser, input, options = {}) {
  if (uuidOrNull(input.id || input.userId) === actorUser.id) throw new Error("SECURITY_SELF_ELEVATION_DENIED");
  const forbiddenKeys = ["permissions", "capabilities", "routePermissions", "route_permissions", "user_route_permissions"];
  if (forbiddenKeys.some(key => Object.prototype.hasOwnProperty.call(input, key))) {
    throw new Error("INDIVIDUAL_PERMISSIONS_NOT_ACCEPTED");
  }
  const companyInputs = Array.isArray(input.companies) ? input.companies : [];
  if (!companyInputs.length) throw new Error("Debe indicar al menos una empresa para el usuario.");
  const resolvedCompanies = [];
  const seenCompanies = new Set();
  for (const row of companyInputs) {
    if (!row || typeof row !== "object" || forbiddenKeys.some(key => Object.prototype.hasOwnProperty.call(row, key))) {
      throw new Error("INDIVIDUAL_PERMISSIONS_NOT_ACCEPTED");
    }
    const company = await companyByKey(client, row.companyKey);
    if (seenCompanies.has(company.id)) throw new Error("DUPLICATE_COMPANY_ACCESS");
    seenCompanies.add(company.id);
    const role = String(row.membershipRole || "VIEWER").toUpperCase();
    if (!MEMBERSHIP_ROLES.has(role)) throw new Error("El rol de membresía no es válido.");
    await assertCanManage(client, actorUser, company.id, role);
    const profileId = String(row.profileId || row.profile_id || "").trim().toUpperCase();
    if (!profileId) throw new Error("CANONICAL_PROFILE_REQUIRED");
    const { data: canonicalProfile, error: canonicalProfileError } = await client
      .from("erp_security_profiles")
      .select("profile_id, display_name, active")
      .eq("profile_id", profileId)
      .eq("active", true)
      .maybeSingle();
    if (canonicalProfileError) throw canonicalProfileError;
    if (!canonicalProfile) throw new Error("ACTIVE_CANONICAL_PROFILE_REQUIRED");
    resolvedCompanies.push({ ...row, company, role, profileId, canonicalProfile });
  }

  const resolvedTarget = options.createIdentity === true
    ? await createTargetUser(client, input)
    : await existingTargetUser(client, input);
  const target = resolvedTarget.user;
  const displayName = String(input.fullName || input.name || target.email || "Usuario").trim();
  if (!displayName) throw new Error("DISPLAY_NAME_REQUIRED");
  if (!resolvedTarget.created) {
    for (const row of resolvedCompanies) {
      await assertMembershipTransition(client, actorUser, row.company.id, target.id, row.role);
    }
  }
  const operationId = crypto.randomUUID();
  const userClient = getSupabaseUserContext(actorUser.accessToken);
  const companyAccess = resolvedCompanies.map(row => {
    const active = row.enabled !== false && String(row.status || "activo").toLowerCase() === "activo";
    return {
      company_id: row.company.id,
      profile_id: row.profileId,
      membership_role: row.role,
      membership_status: active ? "ACTIVE" : "SUSPENDED",
      is_default: Boolean(row.isDefault)
    };
  });
  const { data: configured, error: configurationError } = await userClient.rpc("erp_admin_configure_user_access", {
    p_target_user_id: target.id,
    p_display_name: displayName,
    p_username: String(input.username || input.code || "").trim() || null,
    p_area: String(input.area || "").trim() || null,
    p_job_title: String(input.cargo || input.role || "").trim() || null,
    p_notes: String(input.observation || "").trim() || null,
    p_company_access: companyAccess,
    p_operation_id: operationId
  });
  if (configurationError) {
    const state = [resolvedTarget.created ? "AUTH_CREATED" : "AUTH_PREEXISTING", "ERP_CONFIGURATION_FAILED"];
    if (resolvedTarget.created === true) {
      const { data: persistedMemberships, error: verificationError } = await client.from("user_company_memberships")
        .select("company_id").eq("user_id", target.id);
      if (verificationError || persistedMemberships?.length) {
        throw new Error("ERP_CONFIGURATION_UNCONFIRMED: se conserva la identidad; compruebe el directorio antes de reintentar.");
      }
      const { error: compensationError } = await client.auth.admin.deleteUser(target.id);
      if (compensationError) {
        state.push("AUTH_COMPENSATION_FAILED");
        console.error("[admin-users]", { operationId, targetUserId: target.id, state, error: compensationError.message });
        const blocking = new Error("AUTH_COMPENSATION_FAILED: la configuración ERP falló y no se pudo revertir el Auth nuevo.");
        blocking.code = "AUTH_COMPENSATION_FAILED";
        blocking.statusCode = 500;
        throw blocking;
      }
      state.push("AUTH_COMPENSATION_SUCCESS");
    }
    console.error("[admin-users]", { operationId, targetUserId: target.id, state, error: configurationError.message });
    const failed = new Error(`ERP_CONFIGURATION_FAILED: ${configurationError.message}`);
    failed.code = "ERP_CONFIGURATION_FAILED";
    throw failed;
  }
  if (configured?.target_user_id !== target.id || configured?.legacy_route_permissions_written !== 0
      || !companyAccess.every(expected => configured?.companies?.some(actual => actual.company_id === expected.company_id
        && actual.canonical_profile_id === expected.profile_id && actual.membership_role === expected.membership_role
        && actual.membership_status === expected.membership_status))) {
    throw new Error("CANONICAL_ACCESS_NOT_CONFIRMED");
  }
  console.info("[admin-users]", {
    operationId,
    targetUserId: target.id,
    state: [resolvedTarget.created ? "AUTH_CREATED" : "AUTH_PREEXISTING", "ERP_CONFIGURATION_SUCCESS"]
  });
  return {
    id: target.id,
    email: target.user_metadata?.contact_email || String(input.email || "").trim(),
    loginEmail: target.email || "",
    invited: resolvedTarget.invited,
    linkedExisting: resolvedTarget.linkedExisting,
    emailConfirmed: Boolean(target.email_confirmed_at),
    passwordUpdated: Boolean(resolvedTarget.passwordUpdated),
    created: Boolean(resolvedTarget.created),
    canonicalAccess: configured,
    confirmed: true,
    operationId
  };
}

async function revokeUser(client, actorUser, input) {
  const userId = uuidOrNull(input.id || input.userId);
  if (!userId) throw new Error("El usuario no es válido.");
  const keys = Array.isArray(input.companyKeys) ? input.companyKeys : [];
  if (!keys.length) throw new Error("Debe indicar las empresas que se revocarán.");
  const companyIds = [];
  for (const key of keys) {
    const company = await companyByKey(client, key);
    await assertCanManage(client, actorUser, company.id);
    const { data: targetMembership, error: targetError } = await client
      .from("user_company_memberships")
      .select("membership_role")
      .eq("company_id", company.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (targetMembership?.membership_role === "OWNER") {
      throw new Error("Un propietario debe transferir su responsabilidad antes de ser revocado.");
    }
    if (!targetMembership) throw new Error("La membresía que se intenta revocar no existe.");
    companyIds.push(company.id);
  }
  const operationId = crypto.randomUUID();
  const userClient = getSupabaseUserContext(actorUser.accessToken);
  const { data, error } = await userClient.rpc("erp_admin_revoke_user_company_access", {
    p_target_user_id: userId,
    p_company_ids: companyIds,
    p_operation_id: operationId
  });
  if (error) throw new Error(error.message || "No se pudo revocar el acceso de empresa.");
  if (data?.target_user_id !== userId || data?.revoked !== true) throw new Error("CANONICAL_REVOCATION_NOT_CONFIRMED");
  return { id: userId, revoked: true, confirmed: true, canonicalAccess: data, operationId };
}

async function deleteUser(client, actorUser, input) {
  const userId = uuidOrNull(input.id || input.userId);
  if (!userId) throw new Error("El usuario no es válido.");
  if (userId === actorUser.id) throw new Error("No puede eliminar su propia cuenta administradora.");
  const contextCompany = await companyByKey(client, input.companyKey);
  const contextMembership = await assertCanManage(client, actorUser, contextCompany.id);
  if (contextMembership.membership_role !== "OWNER") {
    throw new Error("Solo un propietario puede eliminar completamente una cuenta.");
  }

  const { data: targetMemberships, error: targetMembershipsError } = await client
    .from("user_company_memberships")
    .select("company_id, membership_role, membership_status")
    .eq("user_id", userId);
  if (targetMembershipsError) throw targetMembershipsError;
  if ((targetMemberships || []).some(row => row.membership_role === "OWNER")) {
    throw new Error("No se puede eliminar una cuenta propietaria. Primero transfiera su responsabilidad.");
  }
  for (const membership of targetMemberships || []) {
    await assertCanManage(client, actorUser, membership.company_id);
  }

  const { data: target, error: targetError } = await client.auth.admin.getUserById(userId);
  if (targetError || !target?.user) throw new Error("La cuenta de Supabase Auth no existe.");
  const { error } = await client.auth.admin.deleteUser(userId);
  if (error) throw error;
  return {
    id: userId,
    email: target.user.email || "",
    deleted: true
  };
}

async function accessPlan(client, actorUser, action, input = {}) {
  const allowed = new Set(["companyKey", "contextCompanyKey", "targetUserId", "profileId", "overrides", "expectedVersion", "operationId", "reason"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("SECURITY_ACCESS_PLAN_INPUT_INVALID");
  if (!input.companyKey || input.companyKey !== input.contextCompanyKey) {
    throw Object.assign(new Error("SECURITY_COMPANY_CONTEXT_MISMATCH"), { statusCode: 403 });
  }
  const company = await companyByKey(client, input.companyKey);
  const target = uuidOrNull(input.targetUserId);
  if (!target) throw new Error("SECURITY_TARGET_MEMBERSHIP_REQUIRED");
  // All reads/changes for the plan use the actor JWT, including the independent confirmation read.
  const userClient = getSupabaseUserContext(actorUser.accessToken);
  async function rpc(name, args) {
    const { data, error } = await userClient.rpc(name, args);
    if (error) throw Object.assign(new Error(error.message || "SECURITY_ACCESS_PLAN_FAILED"), { statusCode: error.code === "42501" ? 403 : 400 });
    if (data?.company_id !== company.id || data?.target_user_id !== target || !Array.isArray(data.effective_capabilities) || !data.state_token) {
      throw new Error("CANONICAL_ACCESS_PLAN_NOT_CONFIRMED");
    }
    return data;
  }
  const scope = { p_company_id: company.id, p_target_user_id: target };
  if (action === "preview_access_plan") return rpc("erp_admin_preview_user_access_plan", {
    ...scope, p_profile_id: input.profileId ?? null, p_overrides: input.overrides ?? null
  });
  const data = await rpc("erp_admin_configure_user_access_plan", {
    ...scope, p_profile_id: input.profileId, p_overrides: input.overrides,
    p_expected_version: input.expectedVersion, p_operation_id: uuidOrNull(input.operationId), p_reason: input.reason
  });
  if (data.confirmed !== true || data.operation_id !== input.operationId) throw new Error("CANONICAL_ACCESS_PLAN_NOT_CONFIRMED");
  const second = await rpc("erp_admin_preview_user_access_plan", scope);
  for (const key of ["state_token", "profile_id", "overrides", "effective_capabilities", "membership", "version"]) {
    if (JSON.stringify(data[key]) !== JSON.stringify(second[key])) throw new Error("CANONICAL_ACCESS_PLAN_SECOND_READ_MISMATCH");
  }
  return { ...data, second_read_confirmed: true };
}

module.exports = async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    return response.end();
  }
  try {
    const client = getSupabaseAdmin();
    const currentActor = await actor(client, request);
    if (request.method === "GET") {
      const company = await companyByKey(client, queryOf(request, "company"));
      const resource = String(queryOf(request, "resource") || "users").trim().toLowerCase();
      if (resource === "profiles") {
        return send(response, 200, { ok: true, data: await listCanonicalProfiles(client, currentActor, company) });
      }
      if (resource !== "users") throw new Error("Recurso de administración de usuarios no válido.");
      return send(response, 200, { ok: true, data: await listUsers(client, currentActor, company) });
    }
    if (request.method !== "POST") return send(response, 405, { ok: false, error: "Método no permitido." });
    const body = bodyOf(request);
    const action = String(body.action || "").toLowerCase();
    if (["preview_access_plan", "configure_access_plan"].includes(action)) {
      return send(response, 200, { ok: true, data: await accessPlan(client, currentActor, action, body.plan) });
    }
    if (action === "create_user" && body?.user && typeof body.user === "object") {
      body.user.inviteRedirectTo = inviteRedirectUrl(request, body.user.inviteRedirectTo);
    }
    const data = action === "revoke"
      ? await revokeUser(client, currentActor, body.user || {})
      : (action === "delete"
        ? await deleteUser(client, currentActor, body.user || {})
        : (action === "create_user"
          ? await saveUserAccess(client, currentActor, body.user || {}, { createIdentity: true })
          : (action === "update_access"
            ? await saveUserAccess(client, currentActor, body.user || {}, { createIdentity: false })
            : (() => { throw new Error("Acción de administración de usuarios no válida."); })())));
    return send(response, 200, { ok: true, data });
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status || 400);
    const retryAfterSeconds = Math.max(0, Number(error?.retryAfterSeconds || 0));
    if (retryAfterSeconds) response.setHeader("retry-after", String(retryAfterSeconds));
    return send(response, statusCode >= 400 && statusCode <= 599 ? statusCode : 400, {
      ok: false,
      error: error.message || "No se pudo administrar el usuario.",
      code: error?.code || "ADMIN_USER_ERROR",
      retryAfterSeconds
    });
  }
};
