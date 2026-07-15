(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const treeApi = BlessERP.navigationTree;
  const navigation = BlessERP.navigation;
  let records = treeApi.createMenuRecordsFromLegacyNavigation(navigation);
  let provider = null;
  let source = "LOCAL_CONFIG";

  function getMenuRecords() {
    return records.map(item => ({ ...item, permisos: [...item.permisos] }));
  }

  function getMenuTreeForRole(role) {
    return treeApi.buildMenuTree(records, role);
  }

  function getVisiblePages(role) {
    const { tree } = getMenuTreeForRole(role);
    return treeApi.flattenTree(tree).filter(node => node.tipo === "pagina");
  }

  function canRoleAccessRoute(role, routeId) {
    return getVisiblePages(role).some(node => node.ruta === routeId);
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
    const report = treeApi.validateMenuRecords(records);
    return {
      mode: source === "LOCAL_CONFIG" ? "LOCAL_DEMO" : "DATABASE_FUTURE",
      source,
      totalNodes: records.length,
      totalFolders: records.filter(item => item.tipo === "carpeta").length,
      totalPages: records.filter(item => item.tipo === "pagina").length,
      unlimitedDepth: true,
      rolePermissions: true,
      valid: report.valid,
      errors: report.errors
    };
  }

  BlessERP.menuService = {
    applyMenuRecords,
    canRoleAccessRoute,
    configureMenuDataProvider,
    getMenuRecords,
    getMenuServiceStatus,
    getMenuTreeForRole,
    getVisiblePages,
    refreshMenuFromProvider
  };
})();
