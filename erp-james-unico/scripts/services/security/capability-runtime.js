(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const policy = BlessERP.capabilityPolicy;
  const MAX_DIAGNOSTICS = 500;
  const diagnostics = [];
  const diagnosticKeys = new Set();
  let refreshPromise = null;
  let refreshKey = "";
  let refreshGeneration = 0;
  let securityRealtimeTimer = 0;
  let current = emptyContext();

  function hardEnforcementEnabled() {
    return policy?.mode?.hardEnforcement === true;
  }

  function emptyContext(identity = {}, reason = "NOT_LOADED") {
    return {
      userId: String(identity.userId || ""),
      companyId: String(identity.companyId || ""),
      capabilityIds: new Set(),
      permissionToken: "",
      catalogVersion: 0,
      companyVersion: 0,
      loading: false,
      loaded: false,
      error: "",
      reason,
      refreshedAt: ""
    };
  }

  function identity(options = {}) {
    const access = BlessERP.authAccess?.activeAccess?.() || {};
    const requestedCompany = String(
      options.companyId
      || BlessERP.services?.companyContext?.activeCompanyId?.()
      || access.activeCompany?.id
      || BlessERP.state?.state?.db?.activeCompanyId
      || ""
    );
    const directoryCompany = (access.companies || []).find(company => (
      String(company?.id || "") === requestedCompany
      || String(company?.company_key || "") === requestedCompany
      || String(company?.company_code || "") === requestedCompany
    ));
    const activeDirectoryCompanyMatches = [
      access.activeCompany?.id,
      access.activeCompany?.company_key,
      access.activeCompany?.company_code
    ].some(value => String(value || "") === requestedCompany);
    return {
      userId: String(options.userId || access.session?.user?.id || ""),
      // Los almacenes locales usan claves como COMP-BLESS-FLOWER. Los RPC U2C1
      // reciben exclusivamente el UUID canónico del directorio autenticado.
      companyId: String(
        directoryCompany?.id
        || (activeDirectoryCompanyMatches ? access.activeCompany?.id : "")
        || (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCompany)
          ? requestedCompany
          : "")
      )
    };
  }

  function snapshot() {
    return {
      userId: current.userId,
      companyId: current.companyId,
      capabilityIds: [...current.capabilityIds].sort(),
      effectiveCapabilityCount: current.capabilityIds.size,
      permissionToken: current.permissionToken,
      catalogVersion: current.catalogVersion,
      companyVersion: current.companyVersion,
      loading: current.loading,
      loaded: current.loaded,
      error: current.error,
      reason: current.reason,
      refreshedAt: current.refreshedAt,
      shadowEnforcement: policy?.mode?.shadow === true,
      hardEnforcement: hardEnforcementEnabled()
    };
  }

  function recordDiagnostic(kind, detail = {}) {
    const entry = {
      kind: String(kind || "UNKNOWN"),
      at: new Date().toISOString(),
      userId: current.userId,
      companyId: current.companyId,
      permissionToken: current.permissionToken,
      ...detail
    };
    const key = JSON.stringify([
      entry.kind, entry.routeId || "", entry.domain || "", entry.entity || "",
      entry.requiredCapability || "", entry.legacyAllowed, entry.capabilityAllowed,
      entry.permissionToken, entry.reason || ""
    ]);
    if (diagnosticKeys.has(key)) return entry;
    diagnosticKeys.add(key);
    diagnostics.push(entry);
    if (diagnostics.length > MAX_DIAGNOSTICS) {
      diagnostics.shift();
      diagnosticKeys.clear();
      diagnostics.forEach(item => diagnosticKeys.add(JSON.stringify([
        item.kind, item.routeId || "", item.domain || "", item.entity || "",
        item.requiredCapability || "", item.legacyAllowed, item.capabilityAllowed,
        item.permissionToken, item.reason || ""
      ])));
    }
    return entry;
  }

  function can(capabilityId) {
    const id = String(capabilityId || "").trim();
    if (!id || !policy?.isKnownCapability?.(id)) {
      recordDiagnostic("UNKNOWN_CAPABILITY", {
        requiredCapability: id,
        capabilityAllowed: false,
        reason: "UNKNOWN_CAPABILITY_DENY"
      });
      return false;
    }
    return current.loaded && current.capabilityIds.has(id);
  }

  function canAny(capabilityIds) {
    const values = Array.isArray(capabilityIds) ? capabilityIds : [];
    return values.some(can);
  }

  function canAll(capabilityIds) {
    const values = Array.isArray(capabilityIds) ? capabilityIds : [];
    return values.length > 0 && values.every(can);
  }

  function evaluateRoute(routeId, options = {}) {
    const id = String(routeId || "");
    const requiredCapability = policy?.requiredCapability?.(id) || "";
    const capabilityAllowed = requiredCapability ? can(requiredCapability) : false;
    const requiredDomains = policy?.requiredDomains?.(id) || [];
    const reason = !requiredCapability
      ? "UNMAPPED_ROUTE_DENY"
      : capabilityAllowed
        ? "CAPABILITY_PRESENT"
        : current.loading
          ? "CAPABILITIES_LOADING_DEFAULT_DENY"
          : current.error
            ? "CAPABILITY_CONTEXT_ERROR_DEFAULT_DENY"
            : "CAPABILITY_ABSENT_DEFAULT_DENY";
    const enforced = hardEnforcementEnabled();
    recordDiagnostic(options.source === "MENU" ? "MENU_SHADOW" : "ROUTE_SHADOW", {
      source: String(options.source || "ROUTE"),
      routeId: id,
      legacyAllowed: options.legacyAllowed === true,
      capabilityAllowed,
      requiredCapability,
      requiredDomains: [...requiredDomains],
      mismatch: typeof options.legacyAllowed === "boolean" && options.legacyAllowed !== capabilityAllowed,
      reason,
      enforced
    });
    return { allowed: capabilityAllowed, requiredCapability, requiredDomains, reason, enforced };
  }

  function isDomainAllowedForCurrentContext(domain, options = {}) {
    const routeId = String(options.routeId || BlessERP.domainDataLoader?.status?.().activeRouteId || "");
    const authorizationContextId = String(options.authorizationContext || "");
    if (authorizationContextId) {
      const authorizationContext = policy?.domainAuthorizationContext?.(authorizationContextId);
      const belongsToContext = Boolean(authorizationContext?.domains?.includes(String(domain || "")));
      const requiredCapability = String(authorizationContext?.capability || "");
      return {
        allowed: belongsToContext && Boolean(requiredCapability) && can(requiredCapability),
        routeId,
        authorizationContext: authorizationContextId,
        requiredCapability,
        reason: !authorizationContext
          ? "DOMAIN_AUTHORIZATION_CONTEXT_UNKNOWN"
          : !belongsToContext
            ? "DOMAIN_NOT_REQUIRED_BY_AUTHORIZATION_CONTEXT"
            : can(requiredCapability)
              ? "DOMAIN_AUTHORIZATION_CAPABILITY_PRESENT"
              : "DOMAIN_AUTHORIZATION_CAPABILITY_ABSENT"
      };
    }
    if (routeId) {
      const routeDecision = evaluateRoute(routeId, { source: options.source || "DOMAIN_ROUTE" });
      const belongsToRoute = routeDecision.requiredDomains.includes(String(domain || ""));
      return {
        allowed: belongsToRoute && routeDecision.allowed,
        routeId,
        requiredCapability: routeDecision.requiredCapability,
        reason: belongsToRoute ? routeDecision.reason : "DOMAIN_NOT_REQUIRED_BY_ROUTE"
      };
    }
    const matchingCapabilities = Object.entries(policy?.routeCapabilities || {})
      .filter(([candidateRoute]) => (policy?.requiredDomains?.(candidateRoute) || []).includes(String(domain || "")))
      .map(([, capabilityId]) => capabilityId);
    return {
      allowed: canAny([...new Set(matchingCapabilities)]),
      routeId: "",
      requiredCapability: "",
      reason: matchingCapabilities.length ? "DIRECT_DOMAIN_ANY_VIEW_CAPABILITY" : "UNMAPPED_DOMAIN_DENY"
    };
  }

  function evaluateDomain(domain, options = {}) {
    const decision = isDomainAllowedForCurrentContext(domain, options);
    const enforced = hardEnforcementEnabled();
    recordDiagnostic("DOMAIN_SHADOW", {
      source: String(options.source || "ENSURE_DOMAIN"),
      routeId: decision.routeId,
      authorizationContext: decision.authorizationContext || "",
      domain: String(domain || ""),
      requiredCapability: decision.requiredCapability,
      capabilityAllowed: decision.allowed,
      reason: decision.reason,
      loadedBeforeDecision: BlessERP.domainDataLoader?.status?.().domains?.[domain]?.loaded === true,
      enforced
    });
    return { ...decision, enforced };
  }

  function evaluateRealtimeEntity(entity, options = {}) {
    const domain = BlessERP.syncEntityRegistry?.domainForEntity?.(entity) || "";
    const domainLoaded = domain ? BlessERP.domainDataLoader?.status?.().domains?.[domain]?.loaded === true : false;
    const decision = domain
      ? isDomainAllowedForCurrentContext(domain, { source: "REALTIME" })
      : { allowed: false, reason: "ENTITY_WITHOUT_DOMAIN", routeId: "", requiredCapability: "" };
    const enforced = hardEnforcementEnabled();
    recordDiagnostic("REALTIME_SHADOW", {
      entity: String(entity || ""),
      domain,
      capabilityAllowed: decision.allowed,
      requiredCapability: decision.requiredCapability,
      domainLoaded,
      futureAction: decision.allowed ? (domainLoaded ? "APPLY_IF_ACTIVE" : "MARK_STALE_ONLY") : "IGNORE",
      reason: decision.reason,
      source: String(options.source || "REALTIME"),
      enforced
    });
    return { ...decision, domain, domainLoaded, enforced };
  }

  function invalidateCapabilities(reason = "MANUAL_INVALIDATION", options = {}) {
    const nextIdentity = identity(options);
    current = emptyContext(nextIdentity, reason);
    refreshGeneration += 1;
    refreshPromise = null;
    refreshKey = "";
    recordDiagnostic("CAPABILITY_CONTEXT_INVALIDATED", { reason });
    return snapshot();
  }

  async function refreshCapabilities(options = {}) {
    const nextIdentity = identity(options);
    const key = `${nextIdentity.userId}:${nextIdentity.companyId}`;
    if (!nextIdentity.userId || !nextIdentity.companyId) {
      current = emptyContext(nextIdentity, "NO_AUTH_COMPANY_CONTEXT");
      current.loaded = true;
      current.refreshedAt = new Date().toISOString();
      return snapshot();
    }
    if (refreshPromise && refreshKey === key) return refreshPromise;
    if (key !== `${current.userId}:${current.companyId}`) current = emptyContext(nextIdentity, "CONTEXT_CHANGED");
    const client = BlessERP.getSupabaseClient?.();
    if (!client?.rpc) {
      current = emptyContext(nextIdentity, "REMOTE_SECURITY_RESOLVER_UNAVAILABLE");
      current.loaded = true;
      current.refreshedAt = new Date().toISOString();
      return snapshot();
    }
    current.loading = true;
    current.error = "";
    refreshKey = key;
    const ownGeneration = ++refreshGeneration;
    refreshPromise = (async () => {
      const [versionResult, capabilityResult] = await Promise.all([
        client.rpc("erp_security_get_permission_version", { p_company_id: nextIdentity.companyId }),
        client.rpc("erp_security_get_effective_capabilities", { p_company_id: nextIdentity.companyId })
      ]);
      if (versionResult.error) throw versionResult.error;
      if (capabilityResult.error) throw capabilityResult.error;
      if (ownGeneration !== refreshGeneration || `${nextIdentity.userId}:${nextIdentity.companyId}` !== refreshKey) return snapshot();
      const version = Array.isArray(versionResult.data) ? versionResult.data[0] : versionResult.data;
      const rows = Array.isArray(capabilityResult.data) ? capabilityResult.data : [];
      const capabilityIds = new Set(rows
        .map(row => String(row?.capability_id || ""))
        .filter(capabilityId => policy?.isKnownCapability?.(capabilityId)));
      current = {
        ...emptyContext(nextIdentity, "RESOLVED"),
        capabilityIds,
        permissionToken: String(version?.security_token || ""),
        catalogVersion: Number(version?.catalog_version || 0),
        companyVersion: Number(version?.company_version || 0),
        loaded: true,
        loading: false,
        refreshedAt: new Date().toISOString()
      };
      recordDiagnostic("CAPABILITY_CONTEXT_RESOLVED", {
        capabilityCount: capabilityIds.size,
        reason: capabilityIds.size ? "EFFECTIVE_CAPABILITIES" : "ZERO_PROFILE_DEFAULT_DENY"
      });
      window.dispatchEvent?.(new CustomEvent("erp:capabilities-refreshed", { detail: snapshot() }));
      return snapshot();
    })().catch(error => {
      if (ownGeneration !== refreshGeneration) return snapshot();
      current = {
        ...emptyContext(nextIdentity, "RESOLUTION_ERROR"),
        loaded: false,
        loading: false,
        error: String(error?.message || error || "No se pudieron resolver capabilities."),
        refreshedAt: new Date().toISOString()
      };
      recordDiagnostic("CAPABILITY_CONTEXT_ERROR", { reason: current.error });
      window.dispatchEvent?.(new CustomEvent("erp:capabilities-refreshed", { detail: snapshot() }));
      console.warn("[jaeder-capabilities] No se pudo resolver el contexto; el acceso funcional queda denegado.", error);
      return snapshot();
    }).finally(() => {
      if (ownGeneration === refreshGeneration) refreshPromise = null;
    });
    return refreshPromise;
  }

  async function bootstrap() {
    return refreshCapabilities({ force: true, reason: "LOGIN_BOOTSTRAP" });
  }

  function handleSecurityRealtime(table, payload) {
    const row = payload?.new || payload?.old || {};
    const rowCompanyId = String(row.company_id || "");
    if (rowCompanyId && rowCompanyId !== current.companyId) return false;
    invalidateCapabilities(`REALTIME_${String(table || "SECURITY").toUpperCase()}`);
    if (securityRealtimeTimer) window.clearTimeout(securityRealtimeTimer);
    securityRealtimeTimer = window.setTimeout(() => {
      securityRealtimeTimer = 0;
      refreshCapabilities({ reason: "SECURITY_VERSION_CHANGED" });
    }, 50);
    return true;
  }

  window.addEventListener?.("erp:company-changed", event => {
    const companyId = String(event?.detail?.companyId || "");
    invalidateCapabilities("COMPANY_SWITCH", { companyId });
    window.setTimeout(() => refreshCapabilities({ companyId, reason: "COMPANY_SWITCH" }), 0);
  });

  BlessERP.capabilityRuntime = {
    bootstrap,
    can,
    canAny,
    canAll,
    evaluateDomain,
    evaluateRealtimeEntity,
    evaluateRoute,
    handleSecurityRealtime,
    invalidateCapabilities,
    isDomainAllowedForCurrentContext,
    refreshCapabilities,
    status: snapshot,
    diagnostics() { return diagnostics.map(item => ({ ...item, requiredDomains: [...(item.requiredDomains || [])] })); },
    clearDiagnostics() { diagnostics.length = 0; diagnosticKeys.clear(); }
  };
})();
