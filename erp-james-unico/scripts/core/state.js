(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const navigation = BlessERP.navigation;
  const menuService = BlessERP.menuService;
  const savedUi = BlessERP.storage.loadUi();

  function activeRole(db) {
    return db?.session?.activeUser?.role || "Invitado";
  }

  function defaultOpenMenuNodes(db, routeId) {
    const records = menuService.getMenuRecords();
    const { tree } = menuService.getMenuTreeForRole(activeRole(db));
    const routeNode = BlessERP.navigationTree.findNodeByRoute(tree, routeId);
    const openNodes = {};
    tree.slice(0, 2).forEach(node => { openNodes[node.id] = true; });
    BlessERP.navigationTree.getAncestorIds(records, routeNode?.id).forEach(nodeId => { openNodes[nodeId] = true; });
    return openNodes;
  }

  const state = {
    db: BlessERP.storage.load(),
    currentRoute: navigation.routeMap[savedUi.currentRoute] ? savedUi.currentRoute : navigation.defaultRoute,
    ui: {
      sidebarCollapsed: Boolean(savedUi.sidebarCollapsed),
      openMenuNodes: {
        ...defaultOpenMenuNodes(BlessERP.storage.load(), savedUi.currentRoute || navigation.defaultRoute),
        ...(savedUi.openMenuNodes || {})
      }
    },
    quickSearch: "",
    quickSearchOpen: false
  };

  function persistUi() {
    BlessERP.storage.saveUi({
      currentRoute: state.currentRoute,
      sidebarCollapsed: state.ui.sidebarCollapsed,
      openMenuNodes: state.ui.openMenuNodes
    });
  }

  function firstAccessibleRoute() {
    return menuService.getVisiblePages(activeRole(state.db))[0]?.ruta || navigation.defaultRoute;
  }

  function currentRoute() {
    if (!navigation.routeMap[state.currentRoute] || !menuService.canRoleAccessRoute(activeRole(state.db), state.currentRoute)) {
      state.currentRoute = firstAccessibleRoute();
    }
    return navigation.routeMap[state.currentRoute] || navigation.routeMap[navigation.defaultRoute];
  }

  function currentGroup() {
    return navigation.groupMap[currentRoute().groupId];
  }

  function currentMenuGroup() {
    return navigation.menuGroupMap[currentRoute().menuId];
  }

  function setRoute(routeId) {
    if (!navigation.routeMap[routeId]) return false;
    if (!menuService.canRoleAccessRoute(activeRole(state.db), routeId)) return false;
    state.currentRoute = routeId;
    state.quickSearch = "";
    state.quickSearchOpen = false;
    const { tree } = menuService.getMenuTreeForRole(activeRole(state.db));
    const routeNode = BlessERP.navigationTree.findNodeByRoute(tree, routeId);
    BlessERP.navigationTree.getAncestorIds(menuService.getMenuRecords(), routeNode?.id)
      .forEach(nodeId => { state.ui.openMenuNodes[nodeId] = true; });
    persistUi();
    return true;
  }

  function toggleSidebar() {
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    persistUi();
    return state.ui.sidebarCollapsed;
  }

  function toggleMenuNode(nodeId) {
    const record = menuService.getMenuRecords().find(item => item.id === nodeId && item.tipo === "carpeta");
    if (!record) return false;
    state.ui.openMenuNodes[nodeId] = !state.ui.openMenuNodes[nodeId];
    persistUi();
    return state.ui.openMenuNodes[nodeId];
  }

  function refreshNavigationAccess() {
    currentRoute();
    const { tree } = menuService.getMenuTreeForRole(activeRole(state.db));
    const routeNode = BlessERP.navigationTree.findNodeByRoute(tree, state.currentRoute);
    BlessERP.navigationTree.getAncestorIds(menuService.getMenuRecords(), routeNode?.id)
      .forEach(nodeId => { state.ui.openMenuNodes[nodeId] = true; });
    persistUi();
  }

  function setQuickSearch(value) {
    state.quickSearch = String(value || "");
    state.quickSearchOpen = state.quickSearch.trim().length > 0;
  }

  function closeQuickSearch() {
    state.quickSearchOpen = false;
  }

  function resetDemoData() {
    state.db = BlessERP.storage.reset();
  }

  function saveDb() {
    BlessERP.storage.save(state.db);
  }

  BlessERP.state = {
    state,
    currentRoute,
    currentGroup,
    currentMenuGroup,
    setRoute,
    toggleSidebar,
    toggleMenuNode,
    refreshNavigationAccess,
    setQuickSearch,
    closeQuickSearch,
    resetDemoData,
    saveDb
  };
})();
