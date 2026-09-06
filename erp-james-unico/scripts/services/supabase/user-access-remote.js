(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let inviteBlockedUntil = 0;

  function retryMinutes(milliseconds) {
    return Math.max(1, Math.ceil(Math.max(0, milliseconds) / 60000));
  }

  function enabled() {
    return Boolean(
      BlessERP.isCoreSupabaseEnabled?.()
      || ["test", "production"].includes(String(BlessERP.getAppMode?.() || window.__ERP_ENV__?.VITE_APP_ENV || ""))
    );
  }

  function membershipRole(access = {}) {
    const preserved = String(access.membershipRole || "").toUpperCase();
    if (["OWNER", "ADMIN", "EDITOR", "VIEWER"].includes(preserved)) return preserved;
    return "VIEWER";
  }

  function payloadFor(user, options = {}) {
    const companyAccess = user.companyAccess || {};
    return {
      id: user.cloudManaged ? user.id : "",
      email: user.email || "",
      username: user.username || user.code || "",
      code: user.code || "",
      name: user.name || user.fullName || "",
      fullName: user.fullName || user.name || "",
      cargo: user.cargo || user.role || "",
      role: user.role || user.cargo || "",
      area: user.area || "",
      status: user.status || "activo",
      observation: user.observation || "",
      preserveAuthEmail: user.preserveAuthEmail === true,
      password: String(options.password || ""),
      inviteRedirectTo: `${window.location.origin}/crear-contrasena`,
      companies: Object.entries(companyAccess)
        .filter(([, access]) => access.enabled !== false || Boolean(String(access.profileId || "").trim()))
        .map(([companyKey, access], index) => ({
        companyKey,
        membershipRole: membershipRole(access),
        enabled: access.enabled !== false,
        status: access.status || "activo",
        isDefault: access.isDefault === true,
        profileId: String(access.profileId || "").trim().toUpperCase()
      }))
    };
  }

  async function requestJson(url, options = {}, retried = false) {
    let token;
    try { token = await BlessERP.authAccess?.getAccessToken?.(retried); }
    catch { return { ok: false, confirmed: false, errors: ["No se pudo validar la sesión. Ingrese nuevamente."] }; }
    if (!token) {
      return {
        ok: false,
        errors: ["La sesión expiró. Cierre sesión e ingrese nuevamente con la contraseña actual."]
      };
    }
    let response;
    try { response = await fetch(url, {
      ...options,
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        ...(options.headers || {})
      }
    }); } catch (error) {
      return { ok: false, confirmed: false, errors: [error?.message || "No se pudo confirmar el acceso con Supabase."] };
    }
    const payload = await response.json().catch(() => ({}));
    const message = String(payload.error || "");
    if (
      !retried
      && (response.status === 401 || /sesión no es válida|sesion no es valida|expiró|expiro/i.test(message))
    ) {
      return requestJson(url, options, true);
    }
    if (!response.ok || !payload.ok) {
      const retryAfterSeconds = Math.max(
        0,
        Number(payload.retryAfterSeconds || response.headers.get("retry-after") || 0)
      );
      if (payload.code === "EMAIL_RATE_LIMIT" || response.status === 429) {
        inviteBlockedUntil = Math.max(inviteBlockedUntil, Date.now() + (retryAfterSeconds || 3600) * 1000);
      }
      return {
        ok: false,
        code: payload.code || (response.status === 429 ? "EMAIL_RATE_LIMIT" : "REMOTE_ACCESS_ERROR"),
        retryAfterSeconds,
        errors: [
          message || "No se pudo actualizar el acceso remoto.",
          ...(retried ? ["Cierre sesión e ingrese nuevamente si el problema continúa."] : [])
        ]
      };
    }
    return { ok: true, data: payload.data };
  }

  function request(body) {
    return requestJson("/api/admin-users", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  async function save(user, options = {}) {
    if (!enabled()) return { ok: true, user };
    if (!user.cloudManaged && inviteBlockedUntil > Date.now()) {
      return {
        ok: false,
        code: "EMAIL_RATE_LIMIT",
        retryAfterSeconds: Math.ceil((inviteBlockedUntil - Date.now()) / 1000),
        errors: [
          `El envío de invitaciones está temporalmente pausado por Supabase. Reintente en aproximadamente ${retryMinutes(inviteBlockedUntil - Date.now())} minuto(s).`,
          "Para eliminar este límite en producción, configure un proveedor SMTP propio en Supabase Auth."
        ]
      };
    }
    const action = user.cloudManaged ? "update_access" : "create_user";
    const result = await request({ action, user: payloadFor(user, options) });
    if (!result.ok) return result;
    if (result.data?.confirmed !== true) return { ok: false, confirmed: false, errors: ["Supabase no confirmó el perfil y la membresía."] };
    return {
      ok: true,
      confirmed: true,
      user: {
        ...user,
        id: result.data.id,
        email: result.data.email || user.email || "",
        cloudManaged: true
      },
      invited: Boolean(result.data.invited),
      linkedExisting: Boolean(result.data.linkedExisting),
      emailConfirmed: Boolean(result.data.emailConfirmed),
      passwordUpdated: Boolean(result.data.passwordUpdated),
      created: Boolean(result.data.created)
    };
  }

  async function revoke(user) {
    if (!enabled()) return { ok: true };
    const result = await request({
      action: "revoke",
      user: {
        id: user.id,
        companyKeys: Object.keys(user.companyAccess || {})
      }
    });
    return result.ok && result.data?.confirmed === true ? { ...result, confirmed: true }
      : { ...result, ok: false, errors: result.errors || ["No se confirmó la revocación."] };
  }

  async function remove(user) {
    if (!enabled()) return { ok: true };
    const companyKey = BlessERP.authAccess?.activeAccess?.()?.activeCompanyKey || "";
    const result = await request({
      action: "delete",
      user: {
        id: user.id,
        companyKey
      }
    });
    return result.ok && result.data?.deleted === true ? { ...result, confirmed: true }
      : { ...result, ok: false, errors: result.errors || ["No se confirmó la eliminación."] };
  }

  async function listUnlinked() {
    if (!enabled()) return { ok: true, data: [] };
    const companyKey = BlessERP.authAccess?.activeAccess?.()?.activeCompanyKey || "";
    const result = await requestJson(`/api/admin-users?company=${encodeURIComponent(companyKey)}`, {
      method: "GET"
    });
    if (!result.ok) return result;
    return {
      ok: true,
      data: (Array.isArray(result.data) ? result.data : []).filter(user => user.unlinked)
    };
  }

  function roleCodeForMembership(role = "VIEWER") {
    const normalized = String(role || "VIEWER").toUpperCase();
    if (["OWNER", "ADMIN"].includes(normalized)) return "ADMIN";
    if (normalized === "EDITOR") return "SOPORTE";
    return "INVITADO";
  }

  async function listDirectory() {
    if (!enabled()) return { ok: true, data: { users: [], unlinked: [], profilesByCompany: {} } };
    const access = BlessERP.authAccess?.activeAccess?.() || {};
    const companyKeys = [...new Set(
      (access.allowedCompanyKeys || [access.activeCompanyKey]).filter(Boolean)
    )];
    const responses = await Promise.all(companyKeys.map(async companyKey => {
      const [users, profiles] = await Promise.all([
        requestJson(`/api/admin-users?company=${encodeURIComponent(companyKey)}`, { method: "GET" }),
        requestJson(`/api/admin-users?company=${encodeURIComponent(companyKey)}&resource=profiles`, { method: "GET" })
      ]);
      return { companyKey, users, profiles };
    }));
    const successful = responses.filter(item => item.users.ok && item.profiles.ok);
    if (!successful.length) {
      const failed = responses.find(item => !item.users.ok || !item.profiles.ok);
      return failed ? (!failed.users.ok ? failed.users : failed.profiles) : {
        ok: false,
        code: "CANONICAL_DIRECTORY_EMPTY",
        errors: ["No existe una empresa administrable disponible para cargar usuarios y perfiles canónicos."]
      };
    }
    const usersById = new Map();
    const unlinkedById = new Map();
    const profilesByCompany = {};
    successful.forEach(({ companyKey, users, profiles }) => {
      profilesByCompany[companyKey] = Array.isArray(profiles.data) ? profiles.data : [];
      (Array.isArray(users.data) ? users.data : []).forEach(row => {
        if (row.unlinked) {
          unlinkedById.set(row.id, row);
          return;
        }
        const profile = row.profile || {};
        const membership = row.membership || {};
        const current = usersById.get(row.id) || {
          id: row.id,
          code: String(profile.username || "").trim(),
          username: String(profile.username || row.loginEmail?.split("@")[0] || "").trim(),
          name: String(membership.display_name_override || profile.display_name || row.email || row.loginEmail || "Usuario").trim(),
          fullName: String(membership.display_name_override || profile.display_name || row.email || row.loginEmail || "Usuario").trim(),
          email: String(row.email || "").trim(),
          role: roleCodeForMembership(membership.membership_role),
          cargo: String(membership.job_title || membership.membership_role || "").trim(),
          area: String(membership.area || "").trim(),
          status: profile.is_active === false ? "inactivo" : "activo",
          observation: String(membership.notes || "").trim(),
          companyAccess: {},
          cloudManaged: true
        };
        const active = membership.membership_status === "ACTIVE" && profile.is_active !== false;
        current.companyAccess[companyKey] = {
          enabled: active,
          status: active ? "activo" : "inactivo",
          roleCode: roleCodeForMembership(membership.membership_role),
           membershipRole: membership.membership_role,
           membershipId: membership.id,
           membershipStatus: membership.membership_status,
           isDefault: membership.is_default === true,
           profileId: String(row.canonicalProfileId || "").trim(),
           profileName: String(row.canonicalProfileName || "PROFILE_MISSING"),
           profileState: String(row.profileState || "PROFILE_MISSING"),
           legacyRoutePermissionCount: Number(row.legacyRoutePermissionCount || 0),
           legacyDependent: row.legacyDependent === true,
           routeAccess: {}
        };
        usersById.set(row.id, current);
      });
    });
    return {
      ok: true,
      data: {
         users: [...usersById.values()],
         unlinked: [...unlinkedById.values()],
         profilesByCompany,
         skippedCompanyKeys: responses
           .filter(item => !item.users.ok || !item.profiles.ok)
           .map(item => item.companyKey)
      }
    };
  }

  async function accessPlan(action, plan) {
    const companyKey = BlessERP.authAccess?.activeAccess?.()?.activeCompanyKey;
    if (!companyKey || companyKey !== plan.companyKey) return { ok: false, errors: ["SECURITY_COMPANY_CONTEXT_MISMATCH"] };
    const result = await request({ action, plan: { ...plan, contextCompanyKey: companyKey } });
    if (BlessERP.authAccess?.activeAccess?.()?.activeCompanyKey !== companyKey) return { ok: false, errors: ["SECURITY_COMPANY_CONTEXT_MISMATCH"] };
    if (!result.ok) return result;
    if (result.data?.target_user_id !== plan.targetUserId || !result.data.state_token || !Array.isArray(result.data.effective_capabilities)
      || (action === "configure_access_plan" && (result.data.confirmed !== true || result.data.second_read_confirmed !== true))) {
      return { ok: false, errors: ["CANONICAL_ACCESS_PLAN_NOT_CONFIRMED"] };
    }
    return result;
  }

  BlessERP.remoteUserAccess = {
    previewAccessPlan: plan => accessPlan("preview_access_plan", plan),
    saveAccessPlan: plan => accessPlan("configure_access_plan", plan),
    enabled,
    listDirectory,
    listUnlinked,
    payloadFor,
    remove,
    revoke,
    save
  };
})();
