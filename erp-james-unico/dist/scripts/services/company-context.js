(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const policy = BlessERP.companyCapabilities;

  function clone(value) {
    return BlessERP.utils?.clone ? BlessERP.utils.clone(value) : JSON.parse(JSON.stringify(value));
  }

  function database() {
    return stateApi.state.db;
  }

  function workspaceCompanyId() {
    const pinned = BlessERP.storage?.tabCompanyId?.();
    return pinned
      ? policy.companyIdOf(pinned)
      : policy.companyIdOf(database()?.activeCompanyId);
  }

  function applyWorkspaceIdentity(companyId = workspaceCompanyId()) {
    const profile = policy.getCompany(companyId);
    if (typeof document !== "undefined") {
      document.title = `${profile.commercialName} · JAEDER SYSTEMS`;
      if (document.body) document.body.dataset.companyId = profile.id;
    }
    return profile;
  }

  function ensureMultiCompanyState() {
    let db = database();
    const requestedId = workspaceCompanyId();
    const hasRequestedStore = Boolean(db?.companyStores?.[requestedId]);
    if (!hasRequestedStore || !Array.isArray(db?.companies)) {
      db = policy.migrateDatabase(db);
      stateApi.state.db = db;
    }
    if (policy.companyIdOf(db?.activeCompanyId) !== requestedId) {
      policy.captureActiveStore(db);
      policy.applyActiveStore(db, requestedId);
    }
    applyWorkspaceIdentity(requestedId);
    return db;
  }

  function companies() {
    ensureMultiCompanyState();
    return clone(database().companies || policy.listCompanies());
  }

  function activeCompanyId() {
    ensureMultiCompanyState();
    return policy.companyIdOf(database().activeCompanyId);
  }

  function activeCompany() {
    return policy.getCompany(activeCompanyId());
  }

  function company(companyId) {
    return policy.getCompany(companyId);
  }

  function hasCapability(capability, companyId = activeCompanyId()) {
    return policy.hasCapability(companyId, capability);
  }

  function assertCapability(capability, companyId = activeCompanyId()) {
    if (hasCapability(capability, companyId)) return { ok: true };
    return {
      ok: false,
      code: "COMPANY_CAPABILITY_DENIED",
      companyId,
      capability,
      message: `${company(companyId).commercialName} no tiene habilitada la función ${capability}.`
    };
  }

  function canAccessRoute(routeId, companyId = activeCompanyId()) {
    return policy.canAccessRoute(companyId, routeId);
  }

  function currentAccessUser() {
    const db = database() || {};
    const sessionUser = db.session?.activeUser || {};
    return (db.visualUsers || []).find(item => item?.id && item.id === sessionUser.id)
      || sessionUser;
  }

  function canCurrentUserAccessCompany(companyId) {
    const id = policy.companyIdOf(companyId, "");
    if (!id) return false;
    const menuService = BlessERP.menuService;
    if (!menuService?.getUserAccessContext) return true;
    return Boolean(menuService.getUserAccessContext(currentAccessUser(), id).active);
  }

  function companySettings(companyId = activeCompanyId()) {
    ensureMultiCompanyState();
    const id = policy.companyIdOf(companyId);
    return clone(database().companyStores?.[id]?.companySettings || {});
  }

  function saveCompanySettings(nextSettings, companyId = activeCompanyId()) {
    ensureMultiCompanyState();
    const db = database();
    const id = policy.companyIdOf(companyId);
    const current = db.companyStores[id]?.companySettings || {};
    db.companyStores[id].companySettings = {
      ...clone(current),
      ...clone(nextSettings || {}),
      companyId: id,
      company_id: id
    };
    if (id === activeCompanyId()) {
      // Guardar la configuración no debe volver a aplicar todo el almacén de la
      // empresa: durante la reserva de un secuencial eso reemplazaba el pedido
      // activo por la copia anterior y ocultaba la factura recién asignada.
      db.companySettings = clone(db.companyStores[id].companySettings);
    }
    stateApi.saveDb();
    return companySettings(id);
  }

  function setActiveCompany(companyId) {
    ensureMultiCompanyState();
    const db = database();
    const nextId = policy.companyIdOf(companyId, "");
    if (!nextId || !db.companyStores?.[nextId]) {
      return { ok: false, message: "Empresa no encontrada o sin almacén de datos inicializado." };
    }
    if (!canCurrentUserAccessCompany(nextId)) {
      return {
        ok: false,
        code: "COMPANY_ACCESS_DENIED",
        message: `El usuario actual no tiene permiso para ingresar a ${company(nextId).commercialName}.`
      };
    }
    if (nextId === activeCompanyId()) {
      return { ok: true, company: activeCompany(), changed: false };
    }
    policy.captureActiveStore(db);
    policy.applyActiveStore(db, nextId);
    BlessERP.storage?.setTabCompanyId?.(nextId);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("company", nextId);
      url.searchParams.delete("companyId");
      window.history?.replaceState?.({}, "", url.href);
    } catch {
      // El contexto en memoria continúa funcionando en navegadores sin History API.
    }
    stateApi.saveDb();
    // Fail closed inmediatamente: las decisiones y dominios del tenant previo
    // dejan de ser válidos antes de recalcular navegación para la nueva empresa.
    BlessERP.capabilityRuntime?.invalidateCapabilities?.("COMPANY_SWITCH_PENDING", { companyId: nextId });
    stateApi.refreshNavigationAccess?.();
    applyWorkspaceIdentity(nextId);
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("erp:company-changed", {
        detail: { companyId: nextId, company: policy.getCompany(nextId) }
      }));
    }
    return {
      ok: true,
      company: policy.getCompany(nextId),
      changed: true,
      currentRoute: stateApi.currentRoute?.()?.id || ""
    };
  }

  function workspaceUrl(companyId, requestedRouteId = "") {
    const nextId = policy.companyIdOf(companyId);
    if (!canCurrentUserAccessCompany(nextId)) return "#";
    const preferredRoute = String(requestedRouteId || "").trim();
    const fallbackRoute = nextId === policy.COMPANY_IDS.IMPERIO ? "commercial-panel" : "dashboard-home";
    const routeId = preferredRoute && canAccessRoute(preferredRoute, nextId)
      ? preferredRoute
      : fallbackRoute;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("company", nextId);
      url.searchParams.delete("companyId");
      url.searchParams.set("route", routeId);
      url.hash = "";
      return url.href;
    } catch {
      return `?company=${encodeURIComponent(nextId)}&route=${encodeURIComponent(routeId)}`;
    }
  }

  function inventoryPolicy(companyId = activeCompanyId()) {
    return clone(company(companyId).inventoryPolicy || {});
  }

  function payrollPolicy(companyId = activeCompanyId()) {
    return clone(company(companyId).payrollPolicy || {});
  }

  function availabilitySourceCompanyId(companyId = activeCompanyId()) {
    return inventoryPolicy(companyId).availabilitySourceCompanyId || policy.COMPANY_IDS.BLESS;
  }

  ensureMultiCompanyState();

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.companyContext = {
    activeCompany,
    activeCompanyId,
    assertCapability,
    availabilitySourceCompanyId,
    canAccessRoute,
    canCurrentUserAccessCompany,
    companies,
    company,
    companySettings,
    ensureMultiCompanyState,
    hasCapability,
    inventoryPolicy,
    payrollPolicy,
    saveCompanySettings,
    setActiveCompany,
    workspaceCompanyId,
    workspaceUrl
  };
})();
