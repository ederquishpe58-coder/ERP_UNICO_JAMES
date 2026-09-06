(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const ROLE_MAP = Object.freeze({
    OWNER: "ADMIN",
    ADMIN: "ADMIN",
    EDITOR: "INVITADO",
    VIEWER: "INVITADO"
  });
  const DIRECTORY_BOOTSTRAP_TIMEOUT_MS = 25000;
  const DIRECTORY_QUERY_ATTEMPTS = 2;
  const ACCESS_CACHE_FRESH_MS = 5 * 60 * 1000;
  const ACCESS_CACHE_OFFLINE_MAX_AGE_MS = 15 * 60 * 60 * 1000;
  const SESSION_CHECK_INTERVAL_MS = 4 * 60 * 1000;
  const AUTH_USERNAME_DOMAIN = "users.jaeder.systems";
  const DIRECTORY_REVALIDATION_MS = 5 * 60 * 1000;
  let currentAccess = null;
  let sessionSupervisorStarted = false;
  let authStateListenerStarted = false;
  let directoryValidationPromise = null;
  let directoryContext = null;
  let directoryFlight = null;
  let sessionGeneration = 0;
  let lastDirectoryValidationAt = 0;
  let currentSessionStatus = {
    active: false,
    mode: "NONE",
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    lastCheckedAt: "",
    message: "Sesión no validada"
  };

  function config() {
    return BlessERP.getEnvConfig?.() || {};
  }

  function remoteEnabled() {
    return Boolean(config().authEnabled);
  }

  function enabled() {
    return remoteEnabled() || Boolean(BlessERP.localAuth?.isConfigured?.());
  }

  function client() {
    return BlessERP.getSupabaseClient?.() || null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function requestedCompanyKey() {
    try {
      const value = new URLSearchParams(window.location.search).get("company");
      return BlessERP.companyCapabilities?.companyIdOf?.(value)
        || value
        || BlessERP.companyCapabilities?.COMPANY_IDS?.BLESS
        || "COMP-BLESS-FLOWER";
    } catch {
      return BlessERP.companyCapabilities?.COMPANY_IDS?.BLESS || "COMP-BLESS-FLOWER";
    }
  }

  function membershipRoleCode(membership) {
    return ROLE_MAP[String(membership?.membership_role || "").toUpperCase()] || "INVITADO";
  }

  function membershipIsActive(membership) {
    if (String(membership?.membership_status || "").toUpperCase() !== "ACTIVE") return false;
    const today = new Date().toISOString().slice(0, 10);
    if (membership?.valid_from && membership.valid_from > today) return false;
    if (membership?.valid_until && membership.valid_until < today) return false;
    return true;
  }

  function routeAccessForUser(companyKey, permissions) {
    const pages = BlessERP.menuService?.getCompanyAvailablePages?.(companyKey) || [];
    const rows = Array.isArray(permissions) ? permissions : [];
    const wildcard = rows.find(row => row.route_id === "*");
    const routeAccess = {};
    pages.forEach(page => {
      const exact = rows.find(row => row.route_id === page.ruta);
      routeAccess[page.ruta] = Boolean((exact || wildcard)?.can_view);
    });
    return routeAccess;
  }

  function transientDirectoryError(error) {
    return /connection pool|timed out|timeout|aborted|fetch failed|network|temporarily unavailable|excedi[oó]|tiempo de espera/i
      .test(String(error?.message || error || ""));
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function bootstrapError(code, message) {
    return Object.assign(new Error(`${code}: ${message}`), { code });
  }

  function staleBootstrap(error) {
    return error?.code === "SESSION_BOOTSTRAP_STALE";
  }

  async function sessionRequest(request) {
    let timer;
    try {
      return await Promise.race([request, new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(bootstrapError("AUTH_SESSION_TIMEOUT", "No se pudo confirmar la sesión a tiempo. Reintente el acceso.")), 9000);
      })]);
    } finally { window.clearTimeout(timer); }
  }

  function invalidateDirectory() {
    sessionGeneration++;
    directoryContext?.controller.abort();
    directoryContext = null;
    directoryFlight = null;
    directoryValidationPromise = null;
    lastDirectoryValidationAt = 0;
    currentAccess = null;
    BlessERP.capabilityRuntime?.invalidateCapabilities?.("AUTH_CONTEXT_CHANGED");
  }

  function contextFor(session) {
    const key = `${session?.user?.id || ""}:${requestedCompanyKey()}`;
    if (!directoryContext || directoryContext.key !== key) {
      invalidateDirectory();
      directoryContext = { key, userId: session?.user?.id, companyKey: requestedCompanyKey(), generation: sessionGeneration, controller: new AbortController() };
    }
    return directoryContext;
  }

  function assertCurrent(context) {
    if (directoryContext !== context || context.controller.signal.aborted || context.companyKey !== requestedCompanyKey()) {
      throw bootstrapError("SESSION_BOOTSTRAP_STALE", "La consulta pertenece a otra sesión o empresa.");
    }
  }

  function assertAccessCurrent(access) {
    if (!directoryContext || access?.sessionGeneration !== directoryContext.generation || access?.session?.user?.id !== directoryContext.userId) {
      throw bootstrapError("SESSION_BOOTSTRAP_STALE", "El acceso corresponde a una sesión anterior.");
    }
    assertCurrent(directoryContext);
  }

  window.addEventListener?.("erp:company-changed", () => {
    if (directoryContext && directoryContext.companyKey !== requestedCompanyKey()) {
      invalidateDirectory();
      void validateActiveAccess(null, true).then(result => {
        if (result.ok) return BlessERP.capabilityRuntime?.refreshCapabilities?.({ reason: "COMPANY_BOOTSTRAP" });
      }).catch(error => { if (!staleBootstrap(error)) renderGate({ message: error.message, showLogin: false, allowRetry: true }); });
    }
  });

  async function selectRows(queryFactory, label, flight) {
    let lastError = null;
    for (let attempt = 1; attempt <= DIRECTORY_QUERY_ATTEMPTS; attempt += 1) {
      try {
        assertCurrent(flight.context);
        const { data, error } = await Promise.race([queryFactory(flight.controller.signal), flight.interrupted]);
        assertCurrent(flight.context);
        if (error) throw error;
        return Array.isArray(data) ? data : [];
      } catch (error) {
        assertCurrent(flight.context);
        if (flight.controller.signal.aborted || error?.code === "SESSION_BOOTSTRAP_TIMEOUT") throw bootstrapError("SESSION_BOOTSTRAP_TIMEOUT", "La carga de acceso agotó su tiempo de espera. Reintente sin cambiar su contraseña.");
        lastError = error;
        if (
          (error?.name !== "AbortError" && !transientDirectoryError(error))
          || attempt === DIRECTORY_QUERY_ATTEMPTS
        ) break;
        await wait(700 * attempt);
      }
    }
    const detail = lastError?.name === "AbortError" || /AbortError|operation was aborted/i.test(String(lastError?.message || ""))
      ? "consulta interrumpida; reintente la carga de acceso"
      : String(lastError?.message || lastError || "error desconocido");
    throw bootstrapError("SESSION_BOOTSTRAP_NETWORK_ERROR", `${label}: ${detail}`);
  }

  function loadDirectory(session, allowInitialOwnerClaim = true) {
    const context = contextFor(session);
    if (directoryFlight?.context === context) return directoryFlight.promise;
    const controller = new AbortController();
    let rejectInterrupted;
    const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
    const cancel = () => {
      rejectInterrupted(bootstrapError("SESSION_BOOTSTRAP_STALE", "La consulta pertenece a otra sesión o empresa."));
      controller.abort();
    };
    const timer = window.setTimeout(() => {
      rejectInterrupted(bootstrapError("SESSION_BOOTSTRAP_TIMEOUT", "La carga de acceso agotó su tiempo de espera. Reintente sin cambiar su contraseña."));
      controller.abort();
    }, DIRECTORY_BOOTSTRAP_TIMEOUT_MS);
    context.controller.signal.addEventListener("abort", cancel, { once: true });
    const flight = { context, controller, interrupted };
    directoryFlight = flight;
    flight.promise = Promise.race([readDirectory(session, allowInitialOwnerClaim, flight), interrupted])
      .then(access => { assertCurrent(context); return { ...access, sessionGeneration: context.generation }; })
      .catch(error => { assertCurrent(context); throw error; })
      .finally(() => {
        window.clearTimeout(timer);
        context.controller.signal.removeEventListener("abort", cancel);
        if (directoryFlight === flight) directoryFlight = null;
      });
    return flight.promise;
  }

  async function readDirectory(session, allowInitialOwnerClaim, flight) {
    const supabase = client();
    const userId = session?.user?.id;
    if (!supabase || !userId) throw new Error("No existe una sesión válida para cargar accesos.");

    const [memberships, profiles] = await Promise.all([
      selectRows(
        signal => supabase.from("user_company_memberships")
          .select("id, company_id, user_id, membership_role, membership_status, is_default, display_name_override, area, job_title, notes, valid_from, valid_until")
          .eq("user_id", userId)
          .abortSignal(signal),
        "Su membresía", flight
      ),
      selectRows(
        signal => supabase.from("user_profiles")
          .select("user_id, display_name, username, phone, locale, timezone, default_company_id, is_active")
          .eq("user_id", userId)
          .abortSignal(signal),
        "Su perfil", flight
      )
    ]);
    if (allowInitialOwnerClaim && !memberships.length && !profiles.length) {
      const { data: claimed, error: claimError } = await supabase.rpc("erp_claim_initial_owner");
      if (!claimError && claimed === true) {
        return readDirectory(session, false, flight);
      }
      if (claimError && !/erp_claim_initial_owner|PGRST202|does not exist/i.test(String(claimError.message || ""))) {
        console.warn("[jaeder-auth] No se pudo validar el primer propietario invitado.", claimError);
      }
    }
    const companyIds = [...new Set(memberships.map(row => row.company_id).filter(Boolean))];
    const [companies, permissions] = companyIds.length
      ? await Promise.all([
          selectRows(
            signal => supabase.from("companies")
              .select("id, company_key, company_code, legal_name, commercial_name, tax_id, sri_environment, is_active")
              .in("id", companyIds)
              .eq("is_active", true)
              .abortSignal(signal),
            "Sus empresas", flight
          ),
          selectRows(
            signal => supabase.from("user_route_permissions")
              .select("company_id, user_id, route_id, can_view, can_create, can_edit, can_delete, can_approve, can_print, can_export")
              .eq("user_id", userId)
              .abortSignal(signal),
            "Sus permisos", flight
          )
        ])
      : [[], []];

    const companyByUuid = new Map(companies.map(company => [company.id, company]));
    const profileByUser = new Map(profiles.map(profile => [profile.user_id, profile]));
    const profile = profileByUser.get(userId) || null;
    const users = profile ? [userId].map(id => {
      const userProfile = profileByUser.get(id) || {};
      const userMemberships = memberships;
      const companyAccess = {};
      userMemberships.forEach(membership => {
        const company = companyByUuid.get(membership.company_id);
        if (!company?.company_key) return;
        const userPermissions = permissions.filter(row =>
          row.user_id === id && row.company_id === membership.company_id
        );
        const active = membershipIsActive(membership) && userProfile.is_active !== false;
        companyAccess[company.company_key] = {
          enabled: active,
          status: active ? "activo" : "inactivo",
          roleCode: membershipRoleCode(membership),
          routeAccess: routeAccessForUser(company.company_key, userPermissions),
          membershipRole: membership.membership_role,
          membershipId: membership.id,
          cloudCompanyId: membership.company_id,
          permissions: userPermissions
        };
      });
      const ownEmail = String(session.user.email || "");
      const primaryMembership = userMemberships.find(row => row.is_default) || userMemberships[0] || {};
      const name = String(primaryMembership.display_name_override || userProfile.display_name || ownEmail || "Usuario");
      return {
        id,
        code: String(userProfile.username || "").trim(),
        name,
        fullName: name,
        email: ownEmail,
        role: membershipRoleCode(primaryMembership),
        cargo: String(primaryMembership.job_title || membershipRoleCode(primaryMembership)),
        area: String(primaryMembership.area || ""),
        status: userProfile.is_active === false ? "inactivo" : "activo",
        observation: String(primaryMembership.notes || ""),
        companyAccess,
        cloudManaged: true
      };
    }) : [];

    assertCurrent(flight.context);
    const activeCompanyKey = flight.context.companyKey;
    const activeCompany = companies.find(company => company.company_key === activeCompanyKey);
    const ownMembership = profile?.is_active === false
      ? null
      : memberships.find(row =>
          row.company_id === activeCompany?.id
          && membershipIsActive(row)
        );
    const currentUser = users.find(user => user.id === userId) || null;
    return {
      session,
      companies,
      memberships,
      permissions,
      users,
      currentUser,
      activeCompany,
      ownMembership,
      activeCompanyKey,
      allowedCompanyKeys: profile?.is_active === false ? [] : memberships
        .filter(row => membershipIsActive(row))
        .map(row => companyByUuid.get(row.company_id)?.company_key)
        .filter(Boolean),
      directoryScope: "CURRENT_USER",
      validatedAt: new Date().toISOString()
    };
  }

  function cachedDirectory(session, maxAgeMs = ACCESS_CACHE_FRESH_MS) {
    const db = BlessERP.state?.state?.db;
    const cached = db?.authAccess;
    const userId = session?.user?.id;
    const activeCompanyKey = requestedCompanyKey();
    const loadedAt = Date.parse(cached?.loadedAt || "");
    if (
      cached?.mode !== "SUPABASE_AUTH"
      || !userId
      || cached.userId !== userId
      || cached.activeCompanyKey !== activeCompanyKey
      || !Number.isFinite(loadedAt)
      || Date.now() - loadedAt > maxAgeMs
    ) {
      return null;
    }
    const currentUser = (db.visualUsers || []).find(user => user.id === userId);
    const companyAccess = currentUser?.companyAccess?.[activeCompanyKey];
    if (
      !currentUser
      || String(currentUser.status || "").toLowerCase() !== "activo"
      || !companyAccess
      || companyAccess?.enabled === false
      || String(companyAccess?.status || "").toLowerCase() === "inactivo"
      || !cached.activeCompanyUuid
    ) {
      return null;
    }
    const companies = Array.isArray(cached.companies) && cached.companies.length
      ? cached.companies
      : [{
          id: cached.activeCompanyUuid,
          company_key: activeCompanyKey,
          commercial_name: activeCompanyKey === "COMP-IMPERIO-FLOWERS"
            ? "Imperio Flowers"
            : "Bless Flower",
          is_active: true
        }];
    const activeCompany = companies.find(company => company.company_key === activeCompanyKey);
    if (!activeCompany) return null;
    const ownMembership = {
      id: companyAccess?.membershipId || "",
      company_id: activeCompany.id,
      user_id: userId,
      membership_role: companyAccess?.membershipRole || companyAccess?.roleCode || "VIEWER",
      membership_status: "ACTIVE",
      area: currentUser.area || "",
      job_title: currentUser.cargo || currentUser.role || ""
    };
    return {
      session,
      companies,
      memberships: [ownMembership],
      permissions: companyAccess?.permissions || [],
      users: [currentUser],
      currentUser,
      activeCompany,
      ownMembership,
      activeCompanyKey,
      allowedCompanyKeys: cached.allowedCompanyKeys || [activeCompanyKey],
      directoryScope: "CURRENT_USER_CACHE",
      validatedAt: cached.loadedAt,
      fromCache: true,
      sessionGeneration: contextFor(session).generation
    };
  }

  function applyDirectory(access) {
    if (remoteEnabled()) assertAccessCurrent(access);
    const db = BlessERP.state?.state?.db;
    if (!db || !access?.currentUser || !access?.ownMembership || !access?.activeCompany) return false;
    const previousUsers = Array.isArray(db.visualUsers) ? db.visualUsers : [];
    db.visualUsers = [
      ...previousUsers.filter(user => user.id !== access.currentUser.id),
      access.currentUser
    ];
    db.authAccess = {
      mode: "SUPABASE_AUTH",
      userId: access.session.user.id,
      activeCompanyKey: access.activeCompanyKey,
      activeCompanyUuid: access.activeCompany.id,
      allowedCompanyKeys: access.allowedCompanyKeys,
      companies: (access.companies || []).map(company => ({
        id: company.id,
        company_key: company.company_key,
        commercial_name: company.commercial_name,
        is_active: company.is_active
      })),
      loadedAt: access.validatedAt || new Date().toISOString()
    };
    db.session = db.session || {};
    db.session.activeUser = {
      id: access.currentUser.id,
      name: access.currentUser.name,
      email: access.session.user.email || "",
      role: membershipRoleCode(access.ownMembership),
      roleLabel: membershipRoleCode(access.ownMembership),
      cargo: access.ownMembership.job_title || membershipRoleCode(access.ownMembership),
      area: access.ownMembership.area || ""
    };
    db.session.alerts = Array.isArray(db.session.alerts) ? db.session.alerts : [];
    currentAccess = access;
    if (!access.fromCache) lastDirectoryValidationAt = Date.now();
    try {
      BlessERP.storage?.save?.(db);
    } catch {
      // El acceso sigue siendo válido aunque el navegador no permita persistir caché local.
    }
    return true;
  }

  function refreshAccessInBackground(session, generation = sessionGeneration) {
    if (generation !== sessionGeneration || directoryContext?.userId !== session?.user?.id) return;
    loadDirectory(session).then(access => {
      assertAccessCurrent(access);
      if (!access.currentUser || !access.ownMembership || !access.activeCompany) {
        renderGate({
          title: "El acceso cambió",
          message: "La sesión ya no tiene acceso activo a esta empresa.",
          showLogin: false,
          allowSignOut: true,
          access
        });
        return;
      }
      applyDirectory(access);
      BlessERP.state?.refreshNavigationAccess?.();
    }).catch(error => {
      if (staleBootstrap(error)) return;
      console.warn("[auth-access] No se pudo actualizar el acceso en segundo plano", error);
    });
  }

  function companyLinks(access) {
    return (access?.companies || [])
      .filter(company => access.allowedCompanyKeys?.includes(company.company_key))
      .map(company => {
        const url = new URL(window.location.href);
        url.searchParams.set("company", company.company_key);
        url.searchParams.delete("route");
        return `<a class="auth-company-link" href="${escapeHtml(url.href)}">${escapeHtml(company.commercial_name)}</a>`;
      })
      .join("");
  }

  function renderGate(options = {}) {
    const sidebar = document.querySelector("#sidebar");
    const topbar = document.querySelector("#topbar");
    const root = document.querySelector("#page-root");
    if (sidebar) sidebar.innerHTML = "";
    if (topbar) topbar.innerHTML = "";
    document.body.classList.add("auth-gate-active");
    if (!root) return;
    const localMode = options.localMode === true || !remoteEnabled();
    const title = options.title || "Iniciar sesión";
    const message = options.message || "Accede a tu cuenta";
    const links = companyLinks(options.access);
    root.innerHTML = `
      <section class="auth-gate-card" aria-labelledby="auth-gate-title">
        <div class="auth-gate-brand">
          <img class="auth-gate-logo" src="scripts/assets/bless-flower-logo-official-transparent.png" alt="Bless Flower">
          <div>
            <strong>JAEDER SYSTEMS</strong>
            <small>Bless Flower · Imperio Flowers</small>
          </div>
        </div>
        <h1 id="auth-gate-title">${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${options.showLogin === false ? "" : `
          <form id="erp-auth-form" class="auth-gate-form">
            <label>Usuario, código o correo
              <input name="email" type="text" autocomplete="username" required>
            </label>
            <label>Contraseña
              <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <button type="submit">Ingresar</button>
            <small id="erp-auth-message" role="status"></small>
          <small>Las cuentas y contraseñas son creadas únicamente por el administrador de JAEDER SYSTEMS.</small>
          </form>
        `}
        ${links ? `<div class="auth-company-links"><strong>Empresas disponibles</strong>${links}</div>` : ""}
        ${options.allowRetry ? `<button id="erp-auth-retry" class="auth-secondary-button" type="button">Reintentar acceso</button>` : ""}
        ${options.allowSignOut ? `<button id="erp-auth-signout" class="auth-secondary-button" type="button">Cerrar sesión</button>` : ""}
      </section>
    `;
    root.querySelector("#erp-auth-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = form.querySelector("#erp-auth-message");
      const button = form.querySelector("button");
      button.disabled = true;
      status.textContent = "Validando acceso...";
      try {
        const result = await signIn(form.email.value, form.password.value);
        if (!result.ok) throw new Error(result.message);
        status.textContent = "Validando empresa y permisos...";
        const access = await loadDirectory(result.session);
        assertAccessCurrent(access);
        if (!access.currentUser) {
          throw new Error("La cuenta existe en Supabase Auth, pero todavía no tiene un perfil ERP habilitado.");
        }
        if (!access.ownMembership || !access.activeCompany) {
          throw new Error("La cuenta todavía no tiene acceso activo a esta empresa.");
        }
        applyDirectory(access);
        window.location.reload();
      } catch (error) {
        if (staleBootstrap(error) || !status.isConnected) return;
        status.textContent = authErrorMessage(error);
        button.disabled = false;
      }
    });
    root.querySelector("#erp-auth-signout")?.addEventListener("click", async () => {
      await signOut();
      window.location.reload();
    });
    root.querySelector("#erp-auth-retry")?.addEventListener("click", () => {
      window.location.reload();
    });
  }

  function authErrorMessage(error) {
    const message = String(error?.message || error || "").trim();
    if (error?.name === "AbortError" || /AbortError|operation was aborted/i.test(message)) return "AUTH_SESSION_INTERRUPTED: reintente el acceso sin cambiar su contraseña.";
    if (/invalid login credentials/i.test(message)) {
      return "Correo o contraseña incorrectos. Solicite al administrador que valide su acceso o establezca una contraseña nueva.";
    }
    if (/email not confirmed/i.test(message)) {
      return "El correo todavía no está habilitado. Solicite al administrador que confirme la cuenta y establezca la contraseña.";
    }
    if (/user already registered/i.test(message)) {
      return "Este correo ya existe en Supabase. El administrador debe vincularlo desde Usuarios y accesos, no registrarlo nuevamente.";
    }
    return message || "No se pudo iniciar sesión.";
  }

  function authEmailForIdentifier(identifier) {
    const normalized = String(identifier || "").trim();
    if (normalized.includes("@")) return normalized.toLowerCase();
    const username = normalized.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    return username ? `${username}@${AUTH_USERNAME_DOMAIN}` : "";
  }

  async function signIn(email, password) {
    if (!remoteEnabled()) {
      return BlessERP.localAuth?.signIn?.(email, password)
        || { ok: false, message: "El acceso local no está disponible." };
    }
    const supabase = client();
    if (!supabase) return { ok: false, message: "Supabase no está configurado." };
    invalidateDirectory();
    const generation = sessionGeneration;
    const companyKey = requestedCompanyKey();
    const { data, error } = await sessionRequest(supabase.auth.signInWithPassword({
      email: authEmailForIdentifier(email),
      password: String(password || "")
    }));
    if (companyKey !== requestedCompanyKey() || (generation !== sessionGeneration && directoryContext?.userId !== data?.session?.user?.id)) {
      throw bootstrapError("SESSION_BOOTSTRAP_STALE", "El intento de ingreso fue reemplazado.");
    }
    return error
      ? { ok: false, message: authErrorMessage(error) }
      : { ok: true, session: data.session, user: data.user };
  }

  async function signOut() {
    if (!remoteEnabled()) {
      return BlessERP.localAuth?.signOut?.() || { ok: true };
    }
    const supabase = client();
    if (!supabase) return { ok: true };
    invalidateDirectory();
    const { error } = await supabase.auth.signOut();
    return error ? { ok: false, message: error.message } : { ok: true };
  }

  async function getAccessToken(forceRefresh = false) {
    if (!remoteEnabled()) return "";
    const supabase = client();
    if (!supabase) return "";
    if (forceRefresh) {
      const { data, error } = await supabase.auth.refreshSession();
      return error ? "" : (data?.session?.access_token || "");
    }
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session) return "";
    const expiresAt = Number(data.session.expires_at || 0);
    if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 60) {
      const refreshed = await supabase.auth.refreshSession();
      return refreshed.error ? "" : (refreshed.data?.session?.access_token || "");
    }
    return data.session.access_token || "";
  }

  async function validateActiveAccess(session = null, force = false) {
    if (!remoteEnabled()) return { ok: true, mode: "LOCAL" };
    const supabase = client();
    const generation = sessionGeneration;
    const companyKey = requestedCompanyKey();
    const activeSession = session || (await sessionRequest(supabase.auth.getSession())).data?.session;
    if (companyKey !== requestedCompanyKey() || (generation !== sessionGeneration && directoryContext?.userId !== activeSession?.user?.id)) return { ok: false, mode: "STALE" };
    if (!activeSession) return { ok: false, mode: "NO_SESSION" };
    const context = contextFor(activeSession);
    if (
      !force
      && lastDirectoryValidationAt
      && Date.now() - lastDirectoryValidationAt < DIRECTORY_REVALIDATION_MS
    ) {
      return { ok: true, mode: "RECENT" };
    }
    if (directoryValidationPromise?.context === context) return directoryValidationPromise.promise;
    const validation = { context };
    directoryValidationPromise = validation;
    validation.promise = (async () => {
      try {
        const access = await loadDirectory(activeSession);
        assertAccessCurrent(access);
        lastDirectoryValidationAt = Date.now();
        if (!access.currentUser || !access.ownMembership || !access.activeCompany) {
          currentAccess = null;
          emitSessionStatus({
            active: false,
            mode: "ACCESS_REVOKED",
            message: "El administrador desactivó este acceso."
          });
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
          renderGate({
            title: "Acceso desactivado",
            message: "El administrador desactivó el usuario o su acceso a esta empresa.",
            showLogin: true
          });
          return { ok: false, mode: "ACCESS_REVOKED" };
        }
        applyDirectory(access);
        BlessERP.state?.refreshNavigationAccess?.();
        return { ok: true, mode: "VALIDATED", access };
      } catch (error) {
        if (staleBootstrap(error)) return { ok: false, mode: "STALE" };
        if (transientDirectoryError(error) || navigator.onLine === false) {
          return { ok: Boolean(currentAccess && currentAccess.sessionGeneration === context.generation), mode: "OFFLINE_CACHE", error };
        }
        throw error;
      }
    })().finally(() => {
      if (directoryValidationPromise === validation) directoryValidationPromise = null;
    });
    return validation.promise;
  }

  function emitSessionStatus(nextStatus = {}) {
    currentSessionStatus = {
      ...currentSessionStatus,
      ...nextStatus,
      online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      lastCheckedAt: new Date().toISOString()
    };
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("erp:session-status", { detail: currentSessionStatus }));
    }
    return currentSessionStatus;
  }

  async function checkSessionContinuity(forceRefresh = false) {
    if (!remoteEnabled()) {
      const local = BlessERP.localAuth?.sessionStatus?.() || { active: true, mode: "LOCAL" };
      return emitSessionStatus({
        ...local,
        message: local.active
          ? "Sesión local protegida por 15 horas"
          : "Sesión local no activa"
      });
    }
    const token = await getAccessToken(forceRefresh);
    if (token) {
      validateActiveAccess(null, forceRefresh).catch(error => {
        console.warn("[auth-access] No se pudo revalidar el acceso", error);
      });
      return emitSessionStatus({
        active: true,
        mode: "SUPABASE",
        message: "Sesión web activa y renovación automática"
      });
    }
    return emitSessionStatus({
      active: Boolean(currentAccess),
      mode: "SUPABASE",
      message: navigator.onLine === false
        ? "Sesión conservada; esperando conexión"
        : "No se pudo renovar la sesión todavía"
    });
  }

  function startAuthStateListener() {
    if (authStateListenerStarted || !remoteEnabled()) return;
    const supabase = client();
    if (!supabase?.auth?.onAuthStateChange) return;
    authStateListenerStarted = true;
    supabase.auth.onAuthStateChange((event, session) => {
      // Capture the Auth identity before deferred callbacks; token refresh of the
      // same user must not cancel its membership bootstrap.
      if (event === "SIGNED_OUT") invalidateDirectory();
      else if (session && ["SIGNED_IN", "INITIAL_SESSION", "USER_UPDATED"].includes(event)) contextFor(session);
      const generation = sessionGeneration;
      // Se difiere el trabajo que consulta Supabase para no bloquear el callback
      // interno de renovación de Auth.
      window.setTimeout(() => {
        if (generation !== sessionGeneration) return;
        if (event === "TOKEN_REFRESHED") {
          emitSessionStatus({
            active: Boolean(session),
            mode: "SUPABASE",
            message: "Token renovado automáticamente"
          });
          return;
        }
        if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
          emitSessionStatus({
            active: Boolean(session),
            mode: "SUPABASE",
            message: event === "USER_UPDATED"
              ? "Usuario actualizado; validando permisos"
              : "Sesión Supabase activa"
          });
          validateActiveAccess(session, true).catch(error => {
            if (staleBootstrap(error)) return;
            console.warn("[auth-access] No se pudo validar el cambio de sesión", error);
          });
          return;
        }
        if (event === "SIGNED_OUT") {
          currentAccess = null;
          emitSessionStatus({
            active: false,
            mode: "SIGNED_OUT",
            message: "La sesión terminó"
          });
          renderGate({
            title: "Acceso a JAEDER SYSTEMS",
            message: "Ingrese con el usuario y contraseña asignados por el administrador.",
            showLogin: true
          });
        }
      }, 0);
    });
  }

  function startSessionSupervisor() {
    if (sessionSupervisorStarted) return;
    sessionSupervisorStarted = true;
    startAuthStateListener();
    BlessERP.localAuth?.startSessionSupervisor?.();
    window.setInterval(() => {
      checkSessionContinuity(false).catch(error => {
        emitSessionStatus({
          active: Boolean(currentAccess),
          message: authErrorMessage(error)
        });
      });
    }, SESSION_CHECK_INTERVAL_MS);
    window.addEventListener("online", () => {
      checkSessionContinuity(true)
        .then(() => validateActiveAccess(null, true))
        .catch(() => {});
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkSessionContinuity(false)
          .then(() => validateActiveAccess(null, false))
          .catch(() => {});
      }
    });
    checkSessionContinuity(false).catch(() => {});
  }

  async function confirmSensitiveAction(options = {}) {
    const reason = String(options.reason || "realizar esta operación sensible").trim();
    const suppliedPassword = typeof options.password === "string" ? options.password : "";
    const password = suppliedPassword || window.prompt(
      `Confirme su contraseña para ${reason}. La contraseña no se guardará.`
    );
    if (!password) return { ok: false, cancelled: true, message: "Confirmación cancelada." };
    if (!remoteEnabled()) {
      const db = BlessERP.state?.state?.db;
      const userId = db?.session?.activeUser?.id;
      const user = (db?.visualUsers || []).find(item => item.id === userId);
      const credential = BlessERP.localAuth?.credentialOf?.(user);
      const valid = credential
        ? await BlessERP.localAuth.verifyPassword(password, credential)
        : false;
      return valid
        ? { ok: true, mode: "LOCAL_REAUTHENTICATED" }
        : { ok: false, message: "La contraseña no es correcta." };
    }
    if (navigator.onLine === false) {
      return {
        ok: false,
        message: "Esta operación sensible requiere conexión para verificar nuevamente la contraseña."
      };
    }
    const supabase = client();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const email = sessionData?.session?.user?.email || "";
    if (sessionError || !email) {
      return { ok: false, message: "No existe una sesión válida para confirmar." };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: authErrorMessage(error) };
    emitSessionStatus({
      active: true,
      mode: "SUPABASE_REAUTHENTICATED",
      message: "Identidad confirmada nuevamente"
    });
    return { ok: true, mode: "SUPABASE_REAUTHENTICATED" };
  }

  function sessionStatus() {
    if (!remoteEnabled() && BlessERP.localAuth?.sessionStatus) {
      return {
        ...currentSessionStatus,
        ...BlessERP.localAuth.sessionStatus(),
        online: typeof navigator === "undefined" ? true : navigator.onLine !== false
      };
    }
    return { ...currentSessionStatus };
  }

  async function boot() {
    if (!remoteEnabled()) {
      const localResult = await (BlessERP.localAuth?.boot?.({ renderGate })
        || { ok: true, mode: "LOCAL" });
      if (localResult.ok) startSessionSupervisor();
      return localResult;
    }
    const supabase = client();
    if (!supabase) {
      renderGate({
        title: "Configuración incompleta",
        message: "El acceso está activado, pero faltan las variables públicas de Supabase.",
        showLogin: false
      });
      return { ok: false, mode: "MISCONFIGURED" };
    }
    let bootSession = null;
    let bootContext = null;
    const companyKey = requestedCompanyKey();
    const startingGeneration = sessionGeneration;
    try {
      const { data, error } = await sessionRequest(supabase.auth.getSession());
      if (error) throw error;
      if (companyKey !== requestedCompanyKey() || (startingGeneration !== sessionGeneration && directoryContext?.userId !== data?.session?.user?.id)) return { ok: false, mode: "STALE" };
      if (!data?.session) {
        renderGate({ showLogin: true });
        return { ok: false, mode: "LOGIN_REQUIRED" };
      }
      bootSession = data.session;
      bootContext = contextFor(data.session);
      const cachedAccess = cachedDirectory(data.session);
      if (cachedAccess) {
        applyDirectory(cachedAccess);
        document.body.classList.remove("auth-gate-active");
        const generation = sessionGeneration;
        window.setTimeout(() => refreshAccessInBackground(data.session, generation), 3500);
        startSessionSupervisor();
        return { ok: true, mode: "AUTHENTICATED_CACHE", access: cachedAccess };
      }
      renderGate({
        title: "Cargando JAEDER SYSTEMS",
        message: "Validando empresa, perfil y permisos. Espere un momento...",
        showLogin: false
      });
      const access = await loadDirectory(data.session);
      assertAccessCurrent(access);
      if (!access.currentUser) {
        renderGate({
        title: "Usuario sin perfil en JAEDER SYSTEMS",
          message: "La cuenta existe en Supabase Auth, pero aún no tiene un perfil ERP habilitado.",
          showLogin: false,
          allowSignOut: true,
          access
        });
        return { ok: false, mode: "PROFILE_REQUIRED" };
      }
      if (!access.ownMembership || !access.activeCompany) {
        renderGate({
          title: "Sin acceso a esta empresa",
          message: "Seleccione una empresa autorizada o solicite al administrador que habilite su membresía.",
          showLogin: false,
          allowSignOut: true,
          access
        });
        return { ok: false, mode: "COMPANY_DENIED", access };
      }
      applyDirectory(access);
      document.body.classList.remove("auth-gate-active");
      startSessionSupervisor();
      return { ok: true, mode: "AUTHENTICATED", access };
    } catch (error) {
      if (staleBootstrap(error) || companyKey !== requestedCompanyKey() || (bootContext ? directoryContext !== bootContext : startingGeneration !== sessionGeneration)) return { ok: false, mode: "STALE" };
      const offlineAccess = transientDirectoryError(error) && bootSession
        ? cachedDirectory(bootSession, ACCESS_CACHE_OFFLINE_MAX_AGE_MS)
        : null;
      if (offlineAccess) {
        offlineAccess.fromCache = true;
        offlineAccess.offlineFallback = true;
        applyDirectory(offlineAccess);
        document.body.classList.remove("auth-gate-active");
        startSessionSupervisor();
        emitSessionStatus({
          active: true,
          mode: "SUPABASE_OFFLINE_CACHE",
          message: "Sesión conservada con caché; permisos pendientes de conexión"
        });
        return { ok: true, mode: "AUTHENTICATED_OFFLINE_CACHE", access: offlineAccess };
      }
      renderGate({
        title: "No se pudo validar el acceso",
        message: transientDirectoryError(error)
          ? "Supabase tardó demasiado en responder. Reintente; JAEDER SYSTEMS ya consulta solamente su usuario y sus empresas."
          : authErrorMessage(error),
        showLogin: false,
        allowRetry: true,
        allowSignOut: true
      });
      return { ok: false, mode: "ACCESS_ERROR", error };
    }
  }

  function activeAccess() {
    return currentAccess;
  }

  BlessERP.authAccess = {
    activeAccess,
    applyDirectory,
    boot,
    checkSessionContinuity,
    confirmSensitiveAction,
    enabled,
    remoteEnabled,
    getAccessToken,
    loadDirectory,
    renderGate,
    sessionStatus,
    signIn,
    signOut,
    startSessionSupervisor,
    validateActiveAccess
  };
})();
