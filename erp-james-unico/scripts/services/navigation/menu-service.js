(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const treeApi = BlessERP.navigationTree;
  const navigation = BlessERP.navigation;
  let records = treeApi.createMenuRecordsFromLegacyNavigation(navigation);
  let provider = null;
  let source = "LOCAL_CONFIG";
  let menuRevision = 0;
  let activeDbCache = { key: "", tree: null, pages: null };
  const ROLE_CODES = Object.freeze([
    "ADMIN",
    "SOPORTE",
    "CONTABILIDAD",
    "COMERCIAL",
    "OPERACIONES",
    "BODEGA",
    "INVITADO"
  ]);
  const ROLE_LABELS = Object.freeze({
    ADMIN: "Administrador",
    SOPORTE: "Soporte",
    CONTABILIDAD: "Contabilidad",
    COMERCIAL: "Comercial / Ventas",
    OPERACIONES: "Operaciones / Poscosecha",
    BODEGA: "Bodega",
    INVITADO: "Solo consulta básica"
  });

  function getMenuRecords() {
    return records.map(item => ({ ...item, permisos: [...item.permisos] }));
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  }

  function normalizeRoleCode(value) {
    const normalized = normalizeText(value);
    if (ROLE_CODES.includes(normalized)) return normalized;
    if (/\bADMINISTRADOR(?:A)?\b/.test(normalized)) return "ADMIN";
    if (/\bSOPORTE\b/.test(normalized) || normalized.includes("CO-CREADOR") || normalized.includes("CREADOR")) return "SOPORTE";
    if (normalized.includes("CONTAB")) return "CONTABILIDAD";
    if (normalized.includes("COMERCIAL") || normalized.includes("VENTA")) return "COMERCIAL";
    if (normalized.includes("POSCOSECHA") || normalized.includes("OPERACION")) return "OPERACIONES";
    if (normalized.includes("BODEGA")) return "BODEGA";
    return "INVITADO";
  }

  function roleLabel(roleCode) {
    const code = normalizeRoleCode(roleCode);
    return ROLE_LABELS[code] || ROLE_LABELS.INVITADO;
  }

  function activeCompanyId(db = BlessERP.state?.state?.db) {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || db?.activeCompanyId
      || BlessERP.companyCapabilities?.COMPANY_IDS?.BLESS;
  }

  function recordsForCompany(companyId = activeCompanyId()) {
    if (!BlessERP.companyCapabilities?.filterMenuRecords) return getMenuRecords();
    return BlessERP.companyCapabilities.filterMenuRecords(records, companyId);
  }

  function recordsForActiveCompany() {
    return recordsForCompany(activeCompanyId());
  }

  function resolveUserFromDb(db = BlessERP.state?.state?.db) {
    const sessionUser = db?.session?.activeUser || {};
    const storedUser = (db?.visualUsers || []).find(item => item?.id && item.id === sessionUser.id);
    return storedUser ? { ...sessionUser, ...storedUser } : sessionUser;
  }

  function membershipForUser(user, companyId) {
    const explicit = user?.companyAccess?.[companyId];
    const globalActive = String(user?.status || "activo").toLowerCase() === "activo";
    if (!explicit || typeof explicit !== "object") {
      return {
        enabled: globalActive,
        status: globalActive ? "activo" : "inactivo",
        roleCode: normalizeRoleCode(user?.roleCode || user?.role || user?.cargo),
        routeAccess: {},
        inherited: true
      };
    }
    const routeAccess = {};
    Object.entries(explicit.routeAccess || {}).forEach(([routeId, allowed]) => {
      if (allowed === true || allowed === false) routeAccess[String(routeId)] = allowed;
    });
    return {
      enabled: explicit.enabled !== false,
      status: String(explicit.status || "activo").toLowerCase() === "inactivo" ? "inactivo" : "activo",
      roleCode: normalizeRoleCode(explicit.roleCode || user?.roleCode || user?.role || user?.cargo),
      routeAccess,
      inherited: false
    };
  }

  function getUserAccessContext(user, companyId = activeCompanyId()) {
    const membership = membershipForUser(user || {}, companyId);
    const userActive = String(user?.status || "activo").toLowerCase() === "activo";
    return {
      user: user || {},
      userId: String(user?.id || ""),
      companyId,
      membership,
      roleCode: membership.roleCode,
      roleLabel: roleLabel(membership.roleCode),
      active: Boolean(userActive && membership.enabled && membership.status === "activo")
    };
  }

  function getCurrentAccessContext(db = BlessERP.state?.state?.db) {
    return getUserAccessContext(resolveUserFromDb(db), activeCompanyId(db));
  }

  function roleAllowsPage(page, roleCode) {
    return treeApi.hasPermission(page, normalizeRoleCode(roleCode));
  }

  function userAllowsPage(page, context) {
    if (!context?.active || page?.tipo !== "pagina") return false;
    const override = context.membership.routeAccess?.[page.ruta];
    return override === true || (override !== false && roleAllowsPage(page, context.roleCode));
  }

  function filterRecordsForUser(user, companyId = activeCompanyId()) {
    const companyRecords = recordsForCompany(companyId);
    const context = getUserAccessContext(user, companyId);
    if (!context.active) return [];
    const rowMap = new Map(companyRecords.map(item => [item.id, item]));
    const allowedIds = new Set(
      companyRecords
        .filter(item => {
          if (item.tipo !== "pagina") return false;
          const legacyAllowed = userAllowsPage(item, context);
          const capabilityDecision = BlessERP.capabilityRuntime?.evaluateRoute?.(item.ruta, {
            source: "MENU",
            legacyAllowed
          });
          return capabilityDecision?.enforced === true ? capabilityDecision.allowed : legacyAllowed;
        })
        .map(item => item.id)
    );
    [...allowedIds].forEach(id => {
      let current = rowMap.get(id);
      while (current?.parentId && rowMap.has(current.parentId)) {
        allowedIds.add(current.parentId);
        current = rowMap.get(current.parentId);
      }
    });
    return companyRecords.filter(item => allowedIds.has(item.id));
  }

  function getMenuTreeForRole(role) {
    return treeApi.buildMenuTree(recordsForActiveCompany(), role);
  }

  function getVisiblePages(role) {
    const { tree } = getMenuTreeForRole(role);
    return treeApi.flattenTree(tree).filter(node => node.tipo === "pagina");
  }

  function canRoleAccessRoute(role, routeId) {
    return getVisiblePages(role).some(node => node.ruta === routeId);
  }

  function getMenuTreeForUser(user, companyId = activeCompanyId()) {
    return treeApi.buildMenuTree(filterRecordsForUser(user, companyId), "ADMIN");
  }

  function getVisiblePagesForUser(user, companyId = activeCompanyId()) {
    const { tree } = getMenuTreeForUser(user, companyId);
    return treeApi.flattenTree(tree).filter(node => node.tipo === "pagina");
  }

  function canUserAccessRoute(user, companyId, routeId) {
    return getVisiblePagesForUser(user, companyId).some(node => node.ruta === routeId);
  }

  function getMenuTreeForDb(db = BlessERP.state?.state?.db) {
    const companyId = activeCompanyId(db);
    const user = resolveUserFromDb(db);
    const key = JSON.stringify([
      menuRevision,
      companyId,
      user?.id || "",
      user?.status || "",
      user?.roleCode || user?.role || user?.cargo || "",
      user?.companyAccess?.[companyId] || null,
      BlessERP.capabilityRuntime?.status?.().permissionToken || "",
      BlessERP.capabilityRuntime?.status?.().loaded === true
    ]);
    if (activeDbCache.key === key && activeDbCache.tree) return activeDbCache.tree;
    const tree = getMenuTreeForUser(user, companyId);
    activeDbCache = { key, tree, pages: null };
    return tree;
  }

  function getVisiblePagesForDb(db = BlessERP.state?.state?.db) {
    const { tree } = getMenuTreeForDb(db);
    if (activeDbCache.tree?.tree === tree && activeDbCache.pages) return activeDbCache.pages;
    const pages = treeApi.flattenTree(tree).filter(node => node.tipo === "pagina");
    activeDbCache.pages = pages;
    const visibleRoutes = new Set(pages.map(node => String(node.ruta || "")));
    (navigation.routes || []).forEach(route => {
      BlessERP.capabilityRuntime?.evaluateRoute?.(route.id, {
        source: "MENU",
        legacyAllowed: visibleRoutes.has(route.id)
      });
    });
    return pages;
  }

  function canCurrentUserAccessRoute(routeId, db = BlessERP.state?.state?.db) {
    const legacyAllowed = getVisiblePagesForDb(db).some(node => node.ruta === routeId);
    const capabilityDecision = BlessERP.capabilityRuntime?.evaluateRoute?.(routeId, { source: "ROUTE", legacyAllowed });
    return capabilityDecision?.enforced === true ? capabilityDecision.allowed : legacyAllowed;
  }

  const OPERATIONS_ENTRY_ROUTES = Object.freeze([
    "operations-grading",
    "operations-reception",
    "operations-bunch-intake",
    "operations-roses-inventory",
    "operations-availability",
    "operations-yields",
    "operations-labels",
    "operations-parameters",
    "operations-farms-blocks",
    "operations-varieties"
  ]);

  function resolveOperationsDefaultRoute(db = BlessERP.state?.state?.db) {
    const coldRoomAccess = canCurrentUserAccessRoute("operations-dispatch", db);
    const inventoryAccess = canCurrentUserAccessRoute("operations-roses-inventory", db);
    if (coldRoomAccess && inventoryAccess) return "operations-roses-inventory";
    return OPERATIONS_ENTRY_ROUTES.find(routeId => canCurrentUserAccessRoute(routeId, db)) || "";
  }

  function getCompanyAvailablePages(companyId) {
    return recordsForCompany(companyId)
      .filter(item => item.tipo === "pagina")
      .map(item => ({ ...item, permisos: [...(item.permisos || [])] }));
  }

  function registerDynamicRoutes(nextRecords) {
    const recordMap = new Map(nextRecords.map(item => [item.id, item]));
    nextRecords.filter(item => item.tipo === "pagina" && item.ruta).forEach(item => {
      if (navigation.routeMap[item.ruta]) return;
      let root = item;
      while (root.parentId && recordMap.has(root.parentId)) root = recordMap.get(root.parentId);
      const groupId = item.metadata?.groupId || root.id;
      const menuId = item.metadata?.menuId || root.id;
      const route = {
        id: item.ruta,
        label: item.nombre,
        title: item.nombre,
        description: item.metadata?.description || "Pagina registrada dinamicamente desde el arbol de navegacion.",
        status: item.metadata?.status || "Preparado",
        checklist: item.metadata?.checklist || ["Ruta dinamica registrada", "Render especifico pendiente si aplica"],
        source: item.metadata?.source || "MENU_DATABASE_FUTURE",
        future: Boolean(item.metadata?.future),
        groupId,
        groupLabel: item.metadata?.groupLabel || root.nombre,
        groupShortLabel: root.icono,
        menuId,
        menuLabel: root.nombre,
        menuShortLabel: root.icono
      };
      if (!navigation.groupMap[groupId]) {
        navigation.groupMap[groupId] = { id: groupId, label: route.groupLabel, shortLabel: route.groupShortLabel, defaultRoute: route.id, routes: [] };
        navigation.groups.push(navigation.groupMap[groupId]);
      }
      if (!navigation.menuGroupMap[menuId]) {
        navigation.menuGroupMap[menuId] = { id: menuId, label: route.menuLabel, shortLabel: route.menuShortLabel, defaultRoute: route.id, groupIds: [groupId] };
      }
      navigation.groupMap[groupId].routes.push(route);
      navigation.routes.push(route);
      navigation.routeMap[route.id] = route;
    });
  }

  function applyMenuRecords(nextRecords, nextSource = "DATABASE_FUTURE") {
    const report = treeApi.validateMenuRecords(nextRecords);
    if (!report.valid) return { ok: false, report, source };
    records = nextRecords.map(item => ({ ...item, permisos: [...item.permisos] }));
    source = nextSource;
    menuRevision += 1;
    activeDbCache = { key: "", tree: null, pages: null };
    registerDynamicRoutes(records);
    BlessERP.state?.refreshNavigationAccess?.();
    return { ok: true, report, source, total: records.length };
  }

  function configureMenuDataProvider(nextProvider) {
    provider = typeof nextProvider === "function" ? nextProvider : null;
  }

  async function refreshMenuFromProvider() {
    if (!provider) return { ok: true, source, total: records.length, fallback: true };
    try {
      const result = await provider();
      const nextRecords = Array.isArray(result) ? result : result?.records;
      if (!Array.isArray(nextRecords) || !nextRecords.length) {
        return { ok: true, source, total: records.length, fallback: true, message: "Proveedor sin datos; menu local conservado." };
      }
      return applyMenuRecords(nextRecords, result?.source || "DATABASE_FUTURE");
    } catch (error) {
      return { ok: true, source, total: records.length, fallback: true, message: `Menu local conservado: ${error.message}` };
    }
  }

  function getMenuServiceStatus() {
    const companyRecords = recordsForActiveCompany();
    const report = treeApi.validateMenuRecords(companyRecords);
    return {
      mode: source === "LOCAL_CONFIG" ? "LOCAL_DEMO" : "DATABASE_FUTURE",
      source,
      totalNodes: records.length,
      visibleCompanyNodes: companyRecords.length,
      activeCompanyId: activeCompanyId(),
      totalFolders: records.filter(item => item.tipo === "carpeta").length,
      totalPages: records.filter(item => item.tipo === "pagina").length,
      unlimitedDepth: true,
      rolePermissions: true,
      valid: report.valid,
      errors: report.errors
    };
  }

  BlessERP.menuService = {
    ROLE_CODES,
    ROLE_LABELS,
    applyMenuRecords,
    canCurrentUserAccessRoute,
    canRoleAccessRoute,
    canUserAccessRoute,
    configureMenuDataProvider,
    getCompanyAvailablePages,
    getCurrentAccessContext,
    getMenuRecords,
    getMenuServiceStatus,
    getMenuTreeForDb,
    getMenuTreeForRole,
    getMenuTreeForUser,
    getVisiblePages,
    getVisiblePagesForDb,
    getVisiblePagesForUser,
    getUserAccessContext,
    membershipForUser,
    normalizeRoleCode,
    refreshMenuFromProvider,
    resolveOperationsDefaultRoute
  };
})();
