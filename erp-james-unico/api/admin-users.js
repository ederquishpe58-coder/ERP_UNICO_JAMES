const { assertUserCapability, getSupabaseAdmin, bearerToken } = require("./sri/_lib/supabase-admin.cjs");

const COMPANY_KEY_PATTERN = /^COMP-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const ROUTE_PATTERN = /^(?:\*|[a-z0-9][a-z0-9._:-]{0,127})$/;
const MEMBERSHIP_ROLES = new Set(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
const AUTH_USERNAME_DOMAIN = "users.jaeder.systems";
const PASSWORD_REQUIREMENTS = Object.freeze({
  minimumLength: 12,
  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/
});
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

function authEmailForUsername(value) {
  return `${normalizedUsername(value).toLowerCase()}@${AUTH_USERNAME_DOMAIN}`;
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
  const token = bearerToken(request);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw new Error("La sesión no es válida o expiró.");
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

function validatedPassword(value, options = {}) {
  const password = String(value || "");
  if (!password && !options.required) return "";
  if (!password) throw new Error("El administrador debe establecer la contraseña inicial.");
  if (
    password.length < PASSWORD_REQUIREMENTS.minimumLength
    || !PASSWORD_REQUIREMENTS.pattern.test(password)
  ) {
    throw new Error("La contraseña debe tener al menos 12 caracteres, mayúscula, minúscula, número y símbolo.");
  }
  return password;
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
  const profiles = ids.length
    ? await client.from("user_profiles")
        .select("user_id, display_name, username, phone, default_company_id, is_active")
        .in("user_id", ids)
    : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const permissions = ids.length
    ? await client.from("user_route_permissions")
        .select("company_id, user_id, route_id, can_view, can_create, can_edit, can_delete, can_approve, can_print, can_export")
        .eq("company_id", company.id)
        .in("user_id", ids)
    : { data: [], error: null };
  if (permissions.error) throw permissions.error;
  const authUsers = await authUsersById(client);
  const allAuthIds = [...authUsers.keys()];
  const allMemberships = allAuthIds.length
    ? await client.from("user_company_memberships").select("user_id").in("user_id", allAuthIds)
    : { data: [], error: null };
  if (allMemberships.error) throw allMemberships.error;
  const linkedUserIds = new Set((allMemberships.data || []).map(row => row.user_id));
  const profileById = new Map((profiles.data || []).map(profile => [profile.user_id, profile]));
  const linked = (memberships || []).map(membership => {
    const profile = profileById.get(membership.user_id) || {};
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
      permissions: (permissions.data || []).filter(row => row.user_id === membership.user_id)
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
        permissions: []
      };
    });
  return [...linked, ...unlinked];
}

async function resolveTargetUser(client, input) {
  const existingId = uuidOrNull(input.id || input.userId);
  const username = normalizedUsername(input.username || input.code);
  const authEmail = authEmailForUsername(username);
  const contactEmail = String(input.email || "").trim().toLowerCase();
  const requestedPassword = validatedPassword(input.password, { required: false });
  if (existingId) {
    const { data, error } = await client.auth.admin.getUserById(existingId);
    if (error || !data?.user) throw new Error("El usuario de Supabase Auth no existe.");
    const updates = {};
    if (input.preserveAuthEmail !== true && authEmail !== data.user.email) updates.email = authEmail;
    updates.user_metadata = {
      ...(data.user.user_metadata || {}),
      display_name: String(input.fullName || input.name || data.user.email || username).trim(),
      contact_email: contactEmail
    };
    if (requestedPassword) {
      updates.password = requestedPassword;
      updates.email_confirm = true;
    }
    if (Object.keys(updates).length) {
      const updated = await client.auth.admin.updateUserById(existingId, updates);
      if (updated.error) throw updated.error;
      return {
        user: updated.data.user,
        invited: false,
        linkedExisting: input.preserveAuthEmail === true,
        passwordUpdated: Boolean(requestedPassword)
      };
    }
    return {
      user: data.user,
      invited: false,
      linkedExisting: input.preserveAuthEmail === true,
      passwordUpdated: false
    };
  }
  const authUsers = await authUsersById(client);
  const existingUser = [...authUsers.values()].find(user =>
    String(user.email || "").trim().toLowerCase() === authEmail
    || (contactEmail && String(user.user_metadata?.contact_email || "").trim().toLowerCase() === contactEmail)
  );
  if (existingUser) {
    const updates = {
      user_metadata: {
        ...(existingUser.user_metadata || {}),
        display_name: String(input.fullName || input.name || existingUser.email || username).trim(),
        contact_email: contactEmail
      }
    };
    if (requestedPassword) {
      updates.password = requestedPassword;
      updates.email_confirm = true;
    }
    const { data: updated, error } = await client.auth.admin.updateUserById(existingUser.id, updates);
    if (error || !updated?.user) throw new Error(error?.message || "No se pudo habilitar la contraseña del usuario existente.");
    return {
      user: updated.user,
      invited: false,
      linkedExisting: true,
      passwordUpdated: Boolean(requestedPassword)
    };
  }
  if (!contactEmail) throw new Error("El correo es obligatorio para enviar la invitación.");
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

function normalizedPermission(permission) {
  const routeId = String(permission?.route_id || permission?.routeId || "").trim();
  if (!ROUTE_PATTERN.test(routeId)) throw new Error(`Ruta de permiso no válida: ${routeId || "(vacía)"}.`);
  return {
    route_id: routeId,
    can_view: permission.can_view === true || permission.view === true,
    can_create: permission.can_create === true || permission.create === true,
    can_edit: permission.can_edit === true || permission.edit === true,
    can_delete: permission.can_delete === true || permission.delete === true,
    can_approve: permission.can_approve === true || permission.approve === true,
    can_print: permission.can_print === true || permission.print === true,
    can_export: permission.can_export === true || permission.export === true
  };
}

async function upsertUser(client, actorUser, input) {
  const companyInputs = Array.isArray(input.companies) ? input.companies : [];
  if (!companyInputs.length) throw new Error("Debe indicar al menos una empresa para el usuario.");
  const resolvedCompanies = [];
  for (const row of companyInputs) {
    const company = await companyByKey(client, row.companyKey);
    const role = String(row.membershipRole || "VIEWER").toUpperCase();
    if (!MEMBERSHIP_ROLES.has(role)) throw new Error("El rol de membresía no es válido.");
    await assertCanManage(client, actorUser, company.id, role);
    resolvedCompanies.push({ ...row, company, role });
  }

  const resolvedTarget = await resolveTargetUser(client, input);
  const target = resolvedTarget.user;
  const displayName = String(input.fullName || input.name || target.email || "Usuario").trim();
  const isActive = String(input.status || "activo").toLowerCase() === "activo";
  const { error: profileError } = await client.from("user_profiles").upsert({
    user_id: target.id,
    display_name: displayName,
    username: String(input.username || input.code || "").trim() || null,
    is_active: isActive,
    default_company_id: resolvedCompanies.find(row => row.isDefault)?.company.id || resolvedCompanies[0].company.id
  }, { onConflict: "user_id" });
  if (profileError) throw profileError;

  for (const row of resolvedCompanies) {
    await assertMembershipTransition(client, actorUser, row.company.id, target.id, row.role);
    const active = isActive && row.enabled !== false && String(row.status || "activo").toLowerCase() === "activo";
    const { error: membershipError } = await client.from("user_company_memberships").upsert({
      company_id: row.company.id,
      user_id: target.id,
      membership_role: row.role,
      membership_status: active ? "ACTIVE" : "SUSPENDED",
      is_default: Boolean(row.isDefault),
      display_name_override: displayName,
      area: String(input.area || "").trim() || null,
      job_title: String(input.cargo || input.role || "").trim() || null,
      notes: String(input.observation || "").trim() || null
    }, { onConflict: "company_id,user_id" });
    if (membershipError) throw membershipError;

    const { error: deleteError } = await client
      .from("user_route_permissions")
      .delete()
      .eq("company_id", row.company.id)
      .eq("user_id", target.id);
    if (deleteError) throw deleteError;
    const permissions = (Array.isArray(row.permissions) ? row.permissions : [])
      .map(normalizedPermission);
    if (active && !permissions.some(permission => permission.route_id === "erp-company-state")) {
      permissions.push({
        route_id: "erp-company-state",
        can_view: true,
        can_create: false,
        can_edit: true,
        can_delete: false,
        can_approve: false,
        can_print: false,
        can_export: false
      });
    }
    if (permissions.length) {
      const { error: permissionsError } = await client.from("user_route_permissions").insert(
        permissions.map(permission => ({
          company_id: row.company.id,
          user_id: target.id,
          ...permission,
          granted_by: actorUser.id
        }))
      );
      if (permissionsError) throw permissionsError;
    }
  }
  return {
    id: target.id,
    email: target.user_metadata?.contact_email || String(input.email || "").trim(),
    loginEmail: target.email || "",
    invited: resolvedTarget.invited,
    linkedExisting: resolvedTarget.linkedExisting,
    emailConfirmed: Boolean(target.email_confirmed_at),
    passwordUpdated: Boolean(resolvedTarget.passwordUpdated),
    created: Boolean(resolvedTarget.created)
  };
}

async function revokeUser(client, actorUser, input) {
  const userId = uuidOrNull(input.id || input.userId);
  if (!userId) throw new Error("El usuario no es válido.");
  const keys = Array.isArray(input.companyKeys) ? input.companyKeys : [];
  if (!keys.length) throw new Error("Debe indicar las empresas que se revocarán.");
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
    const { error } = await client.from("user_company_memberships")
      .update({ membership_status: "REVOKED", is_default: false })
      .eq("company_id", company.id)
      .eq("user_id", userId);
    if (error) throw error;
  }
  const { count, error: countError } = await client.from("user_company_memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("membership_status", "ACTIVE");
  if (countError) throw countError;
  if (!count) {
    const { error } = await client.from("user_profiles").update({ is_active: false }).eq("user_id", userId);
    if (error) throw error;
  }
  return { id: userId, revoked: true };
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
      return send(response, 200, { ok: true, data: await listUsers(client, currentActor, company) });
    }
    if (request.method !== "POST") return send(response, 405, { ok: false, error: "Método no permitido." });
    const body = bodyOf(request);
    if (body?.user && typeof body.user === "object" && !body.user.id) {
      body.user.inviteRedirectTo = inviteRedirectUrl(request, body.user.inviteRedirectTo);
    }
    const action = String(body.action || "upsert").toLowerCase();
    const data = action === "revoke"
      ? await revokeUser(client, currentActor, body.user || {})
      : (action === "delete"
        ? await deleteUser(client, currentActor, body.user || {})
        : await upsertUser(client, currentActor, body.user || {}));
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
