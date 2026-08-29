(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let inviteBlockedUntil = 0;

  function retryMinutes(milliseconds) {
    return Math.max(1, Math.ceil(Math.max(0, milliseconds) / 60000));
  }

  function enabled() {
    return Boolean(
      BlessERP.isCoreSupabaseEnabled?.()
      && BlessERP.authAccess?.activeAccess?.()
    );
  }

  function membershipRole(access = {}) {
    const preserved = String(access.membershipRole || "").toUpperCase();
    if (["OWNER", "ADMIN", "EDITOR", "VIEWER"].includes(preserved)) return preserved;
    const roleCode = String(access.roleCode || "").toUpperCase();
    if (["ADMIN", "SOPORTE"].includes(roleCode)) return "ADMIN";
    if (roleCode === "INVITADO") return "VIEWER";
    return "EDITOR";
  }

  function permissionsFor(user, companyKey, access) {
    const pages = BlessERP.menuService?.getCompanyAvailablePages?.(companyKey) || [];
    const memberRole = membershipRole(access);
    return pages.map(page => {
      const allowed = Boolean(
        access.enabled !== false
        && String(access.status || "activo").toLowerCase() === "activo"
        && BlessERP.menuService?.canUserAccessRoute?.(user, companyKey, page.ruta)
      );
      const administrator = ["OWNER", "ADMIN"].includes(memberRole);
      return {
        route_id: page.ruta,
        view: allowed,
        create: allowed && administrator,
        edit: allowed && administrator,
        delete: allowed && administrator,
        approve: allowed && administrator,
        print: allowed,
        export: allowed
      };
    });
  }

  function allowedCompanyKeys() {
    const access = BlessERP.authAccess?.activeAccess?.() || {};
    return new Set(
      (access.allowedCompanyKeys || [access.activeCompanyKey])
        .map(value => String(value || "").trim())
        .filter(Boolean)
    );
  }

  function scopedCompanyEntries(user) {
    const allowed = allowedCompanyKeys();
    return Object.entries(user.companyAccess || {}).filter(([companyKey, access]) => {
      if (allowed.has(companyKey)) return true;
      return access?.enabled !== true && String(access?.status || "inactivo").toLowerCase() === "inactivo";
    }).filter(([companyKey]) => allowed.has(companyKey));
  }

  function unauthorizedEnabledCompanyKeys(user) {
    const allowed = allowedCompanyKeys();
    return Object.entries(user.companyAccess || {})
      .filter(([companyKey, access]) => (
        !allowed.has(companyKey)
        && access?.enabled === true
        && String(access?.status || "activo").toLowerCase() !== "inactivo"
      ))
      .map(([companyKey]) => companyKey);
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
      phone: user.phone || "",
      cargo: user.cargo || user.role || "",
      role: user.role || user.cargo || "",
      area: user.area || "",
      status: user.status || "activo",
      observation: user.observation || "",
      preserveAuthEmail: user.preserveAuthEmail === true,
      password: String(options.password || ""),
      inviteRedirectTo: `${window.location.origin}/crear-contrasena`,
      companies: scopedCompanyEntries({ companyAccess }).map(([companyKey, access], index) => ({
        companyKey,
        membershipRole: membershipRole(access),
        profileId: String(access.profileId || "").trim().toUpperCase(),
        enabled: access.enabled !== false,
        status: access.status || "activo",
        isDefault: index === 0,
        permissions: permissionsFor(user, companyKey, access)
      }))
    };
  }

  async function requestJson(url, options = {}, retried = false) {
    const token = await BlessERP.authAccess?.getAccessToken?.(retried);
    if (!token) {
      return {
        ok: false,
        errors: ["La sesión expiró. Cierre sesión e ingrese nuevamente con la contraseña actual."]
      };
    }
    const response = await fetch(url, {
      ...options,
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
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
    const unauthorizedCompanies = unauthorizedEnabledCompanyKeys(user);
    if (unauthorizedCompanies.length) {
      return {
        ok: false,
        code: "COMPANY_SCOPE_DENIED",
        errors: ["No tiene autorización para administrar usuarios de la empresa solicitada."]
      };
    }
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
    const result = await request({ action: "upsert", user: payloadFor(user, options) });
    if (!result.ok) return result;
    return {
      ok: true,
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
    return request({
      action: "revoke",
      user: {
        id: user.id,
        companyKeys: Object.keys(user.companyAccess || {})
      }
    });
  }

  async function remove(user) {
    if (!enabled()) return { ok: true };
    const companyKey = BlessERP.authAccess?.activeAccess?.()?.activeCompanyKey || "";
    return request({
      action: "delete",
      user: {
        id: user.id,
        companyKey
      }
    });
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

  async function listProfiles() {
    if (!enabled()) return { ok: true, data: [] };
    const companyKey = BlessERP.authAccess?.activeAccess?.()?.activeCompanyKey || "";
    return requestJson(`/api/admin-users?company=${encodeURIComponent(companyKey)}&profiles=1`, {
      method: "GET"
    });
  }

  function roleCodeForMembership(role = "VIEWER") {
    const normalized = String(role || "VIEWER").toUpperCase();
    if (["OWNER", "ADMIN"].includes(normalized)) return "ADMIN";
    if (normalized === "EDITOR") return "SOPORTE";
    return "INVITADO";
  }

  async function listDirectory() {
    if (!enabled()) return { ok: true, data: { users: [], unlinked: [] } };
    const access = BlessERP.authAccess?.activeAccess?.() || {};
    const companyKeys = [...new Set(
      (access.allowedCompanyKeys || [access.activeCompanyKey]).filter(Boolean)
    )];
    const responses = await Promise.all(companyKeys.map(async companyKey => ({
      companyKey,
      result: await requestJson(`/api/admin-users?company=${encodeURIComponent(companyKey)}`, { method: "GET" })
    })));
    const failed = responses.find(item => !item.result.ok);
    if (failed) return failed.result;
    const usersById = new Map();
    const unlinkedById = new Map();
    responses.forEach(({ companyKey, result }) => {
      (Array.isArray(result.data) ? result.data : []).forEach(row => {
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
          phone: String(profile.phone || "").trim(),
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
          profileId: String(row.securityProfile?.profile_id || "").trim(),
          routeAccess: Object.fromEntries((row.permissions || []).map(permission => [permission.route_id, permission.can_view === true])),
          permissions: row.permissions || []
        };
        usersById.set(row.id, current);
      });
    });
    return {
      ok: true,
      data: {
        users: [...usersById.values()],
        unlinked: [...unlinkedById.values()]
      }
    };
  }

  BlessERP.remoteUserAccess = {
    enabled,
    listDirectory,
    listProfiles,
    listUnlinked,
    payloadFor,
    remove,
    revoke,
    save
  };
})();
