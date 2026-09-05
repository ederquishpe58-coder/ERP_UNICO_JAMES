(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const navigation = BlessERP.navigation;
  const menuService = BlessERP.menuService;
  const savedUi = BlessERP.storage.loadUi();
  const sidebarBehaviorVersion = 3;
  const migrateSidebarBehavior = Number(savedUi.sidebarBehaviorVersion || 0) < sidebarBehaviorVersion;
  const routeAliases = {
    "commercial-invoice-packing": "commercial-order-history",
    "commercial-client-invoice": "commercial-order-history",
    "commercial-print-center": "commercial-order-history",
    "commercial-export-shipments": "commercial-panel"
  };
  const requestedRouteRaw = new URLSearchParams(window.location.search).get("route");
  const requestedRoute = routeAliases[requestedRouteRaw] || requestedRouteRaw;
  const savedRoute = navigation.routeMap[savedUi.currentRoute] ? savedUi.currentRoute : navigation.defaultRoute;
  const initialRoute = navigation.routeMap[requestedRoute] ? requestedRoute : savedRoute;
  const initialDb = BlessERP.storage.load();
  let lastIncrementalCapture = Promise.resolve([]);
  let lastIncrementalCaptureError = null;
  let runtimeDataRevision = 0;

  function markDataChanged() {
    runtimeDataRevision += 1;
    return runtimeDataRevision;
  }

  function defaultOpenMenuNodes(db, routeId) {
    const records = menuService.getMenuRecords();
    const { tree } = menuService.getMenuTreeForDb(db);
    const routeNode = BlessERP.navigationTree.findNodeByRoute(tree, routeId);
    const openNodes = {};
    BlessERP.navigationTree.getAncestorIds(records, routeNode?.id).forEach(nodeId => { openNodes[nodeId] = true; });
    return openNodes;
  }

  function closeMenuBranch(nodeId, records = menuService.getMenuRecords()) {
    const pending = [nodeId];
    while (pending.length) {
      const currentId = pending.pop();
      state.ui.openMenuNodes[currentId] = false;
      records
        .filter(item => item.parentId === currentId && item.tipo === "carpeta")
        .forEach(item => pending.push(item.id));
    }
  }

  function activateRouteMenuBranch(routeId) {
    const records = menuService.getMenuRecords();
    const { tree } = menuService.getMenuTreeForDb(state.db);
    const routeNode = BlessERP.navigationTree.findNodeByRoute(tree, routeId);
    const activeIds = new Set(BlessERP.navigationTree.getAncestorIds(records, routeNode?.id));
    records
      .filter(item => item.tipo === "carpeta")
      .forEach(item => { state.ui.openMenuNodes[item.id] = activeIds.has(item.id); });
  }

  const state = {
    db: initialDb,
    currentRoute: initialRoute,
    ui: {
      sidebarCollapsed: migrateSidebarBehavior ? true : savedUi.sidebarCollapsed !== false,
      sidebarBehaviorVersion,
      openMenuNodes: migrateSidebarBehavior
        ? defaultOpenMenuNodes(initialDb, initialRoute)
        : {
            ...defaultOpenMenuNodes(initialDb, initialRoute),
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
      sidebarBehaviorVersion: state.ui.sidebarBehaviorVersion,
      openMenuNodes: state.ui.openMenuNodes
    });
  }

  function syncRouteInUrl(routeId) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("route", routeId);
      url.searchParams.delete("order");
      window.history?.replaceState?.({}, "", url.href);
    } catch {
      // La navegación interna continúa funcionando aunque la URL no pueda actualizarse.
    }
  }

  function firstAccessibleRoute() {
    return menuService.getVisiblePagesForDb(state.db)
      .find(page => page.ruta !== "operations-postharvest")?.ruta
      || navigation.defaultRoute;
  }

  function resolveRouteId(routeId) {
    const aliasedRouteId = routeAliases[routeId] || routeId;
    if (aliasedRouteId !== "operations-postharvest") return aliasedRouteId;
    return menuService.resolveOperationsDefaultRoute(state.db);
  }

  function currentRoute() {
    if (state.currentRoute === "operations-postharvest") {
      state.currentRoute = resolveRouteId(state.currentRoute) || firstAccessibleRoute();
      persistUi();
      syncRouteInUrl(state.currentRoute);
    }
    if (!navigation.routeMap[state.currentRoute] || !menuService.canCurrentUserAccessRoute(state.currentRoute, state.db)) {
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
    const resolvedRouteId = resolveRouteId(routeId);
    if (!navigation.routeMap[resolvedRouteId]) return false;
    if (!menuService.canCurrentUserAccessRoute(resolvedRouteId, state.db)) return false;
    if (state.currentRoute !== resolvedRouteId) {
      BlessERP.performance?.beginRouteTransition?.(resolvedRouteId);
    }
    state.currentRoute = resolvedRouteId;
    state.quickSearch = "";
    state.quickSearchOpen = false;
    activateRouteMenuBranch(resolvedRouteId);
    persistUi();
    syncRouteInUrl(resolvedRouteId);
    return true;
  }

  function toggleSidebar() {
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    persistUi();
    return state.ui.sidebarCollapsed;
  }

  function setSidebarCollapsed(collapsed, options = {}) {
    state.ui.sidebarCollapsed = Boolean(collapsed);
    if (options.persist !== false) persistUi();
    return state.ui.sidebarCollapsed;
  }

  function closeAllMenuNodes(options = {}) {
    menuService.getMenuRecords()
      .filter(item => item.tipo === "carpeta")
      .forEach(item => { state.ui.openMenuNodes[item.id] = false; });
    if (options.persist !== false) persistUi();
    return state.ui.openMenuNodes;
  }

  function toggleMenuNode(nodeId) {
    const records = menuService.getMenuRecords();
    const record = records.find(item => item.id === nodeId && item.tipo === "carpeta");
    if (!record) return false;
    const opening = !state.ui.openMenuNodes[nodeId];
    if (!opening) {
      closeMenuBranch(nodeId, records);
    } else {
      records
        .filter(item => item.tipo === "carpeta" && item.parentId === record.parentId && item.id !== nodeId)
        .forEach(item => closeMenuBranch(item.id, records));
      BlessERP.navigationTree.getAncestorIds(records, nodeId)
        .forEach(ancestorId => { state.ui.openMenuNodes[ancestorId] = true; });
      state.ui.openMenuNodes[nodeId] = true;
    }
    persistUi();
    return state.ui.openMenuNodes[nodeId];
  }

  function refreshNavigationAccess() {
    currentRoute();
    activateRouteMenuBranch(state.currentRoute);
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

  function saveDbLocalOnly() {
    let persisted = false;
    try {
      const saveLocal = () => BlessERP.storage.save(state.db) !== false;
      persisted = BlessERP.performance?.measureSync?.("storage:guardar-local", saveLocal)
        ?? saveLocal();
    } catch (error) {
      console.error("No se pudo guardar la base local del ERP.", error);
      return false;
    }
    if (persisted) markDataChanged();
    return persisted;
  }

  function beginIncrementalCapture(options = {}) {
    try {
      lastIncrementalCaptureError = null;
      const captureChanges = () => BlessERP.offlineSync?.captureChanges?.(state.db, {
        origin: String(options.source || "USER_MUTATION").trim().toUpperCase()
      });
      if (BlessERP.performance?.measureSync) {
        lastIncrementalCapture = Promise.resolve(
          BlessERP.performance.measureSync("sync:detectar-cambios", captureChanges)
        );
      } else {
        lastIncrementalCapture = Promise.resolve(captureChanges());
      }
      lastIncrementalCapture = lastIncrementalCapture.catch(error => {
        lastIncrementalCaptureError = error;
        console.warn("La cola incremental no pudo capturar el cambio.", error);
        return [];
      });
    } catch (error) {
      lastIncrementalCaptureError = error;
      lastIncrementalCapture = Promise.resolve([]);
      console.warn("La cola offline no pudo iniciar la captura del cambio.", error);
    }
    return lastIncrementalCapture;
  }

  function saveDb(options = {}) {
    // La captura comienza antes de escribir la caché completa. Así el registro
    // queda protegido frente a un evento Realtime mientras localStorage todavía
    // está trabajando y la caché nunca actúa como autoridad del dato.
    const source = String(options.source || "LOCAL_EDIT").trim().toUpperCase();
    const remoteSource = options.remote === true
      || /^(REMOTE|REALTIME|SUPABASE|SERVER|CANONICAL)/.test(source);
    if (!remoteSource && options.captureIncremental !== false) beginIncrementalCapture({ source });
    else {
      lastIncrementalCaptureError = null;
      lastIncrementalCapture = Promise.resolve([]);
    }
    const persisted = saveDbLocalOnly();
    if (!persisted) return false;
    try {
      if (options.skipCloudSnapshot !== true && !BlessERP.offlineSync?.hasSuspendedCapture?.()) {
        BlessERP.cloudStateSync?.scheduleSave?.(state.db);
      }
    } catch (error) {
      console.warn("El guardado local termino, pero la sincronizacion en nube no pudo programarse.", error);
    }
    return persisted;
  }

  async function waitForLastSave(options = {}) {
    const capturedOperations = await lastIncrementalCapture;
    if (lastIncrementalCaptureError) {
      return {
        ok: false,
        durable: false,
        confirmed: false,
        mode: "QUEUE_CAPTURE_ERROR",
        message: lastIncrementalCaptureError?.message || "No se pudo conservar el cambio en la cola local."
      };
    }
    const env = BlessERP.getEnvConfig?.() || {};
    if (!env.incrementalSyncEnabled || !BlessERP.offlineSync) {
      return { ok: true, durable: true, confirmed: false, mode: "LOCAL_ONLY", capturedOperations };
    }
    const status = BlessERP.offlineSync.status?.() || {};
    if (options.processRemote === false) {
      return {
        ok: true,
        durable: true,
        queued: Array.isArray(capturedOperations) && capturedOperations.length > 0,
        confirmed: false,
        mode: "DURABLE_QUEUE_CAPTURED",
        capturedOperations
      };
    }
    if (globalThis.navigator?.onLine === false || status.serverReachable === false) {
      return {
        ok: true,
        durable: true,
        queued: true,
        confirmed: false,
        mode: "OFFLINE_QUEUED",
        capturedOperations
      };
    }
    const result = await BlessERP.offlineSync.processQueue();
    return {
      ...result,
      durable: true,
      queued: result?.ok !== true,
      confirmed: result?.ok === true && Number(result?.conflicts || 0) === 0,
      mode: result?.ok ? "REMOTE_CONFIRMED_INCREMENTAL" : (result?.mode || "REMOTE_PENDING"),
      capturedOperations
    };
  }

  async function saveDbDurable(options = {}) {
    if (!saveDb(options)) {
      return { ok: false, durable: false, confirmed: false, mode: "LOCAL_SAVE_ERROR", message: "No se pudo conservar el cambio en este dispositivo." };
    }
    return waitForLastSave(options);
  }

  async function saveDbConfirmed(options = {}) {
    const descriptor = BlessERP.syncEntityRegistry?.descriptor?.(options.entity);
    const explicitV2 = String(descriptor?.syncMode || "").startsWith("EXPLICIT_");
    const env = BlessERP.getEnvConfig?.() || {};
    const remoteConfigured = Boolean(
      env.supabaseEnabled
      && env.authEnabled
      && env.incrementalSyncEnabled
      && window.location?.protocol !== "file:"
    );
    if (explicitV2 && remoteConfigured) {
      return {
        ok: false,
        confirmed: false,
        mode: "EXPLICIT_V2_COMMAND_REQUIRED",
        message: `${options.entity} requiere su RPC V2; saveDbConfirmed no puede sustituir una confirmación de Supabase.`
      };
    }
    if (!saveDb({ skipCloudSnapshot: options.skipCloudSnapshot === true })) {
      return { ok: false, mode: "LOCAL_SAVE_ERROR", message: "No se pudo conservar el cambio en este dispositivo." };
    }
    const cloud = BlessERP.cloudStateSync?.status?.() || {};
    if (env.incrementalSyncEnabled && BlessERP.offlineSync) {
      const capturedOperations = await lastIncrementalCapture;
      if (lastIncrementalCaptureError) {
        return { ok: false, mode: "QUEUE_CAPTURE_ERROR", message: lastIncrementalCaptureError?.message || "No se pudo preparar la sincronización." };
      }
      const recordWasCaptured = Array.isArray(capturedOperations) && capturedOperations.some(operation => (
        String(operation?.entity || "") === String(options.entity || "")
        && String(operation?.record_id || operation?.recordId || "") === String(options.recordId || "")
      ));
      if (options.entity && options.recordId && !recordWasCaptured && BlessERP.offlineSync.captureRecord) {
        try {
          await BlessERP.offlineSync.captureRecord(options.entity, options.recordId, state.db);
        } catch (error) {
          return {
            ok: false,
            mode: "RECORD_CAPTURE_ERROR",
            message: error?.message || "No se pudo preparar el pedido para enviarlo a Supabase."
          };
        }
      }
      const result = await BlessERP.offlineSync.processQueue();
      if (options.entity && options.recordId) {
        const recordResult = await BlessERP.offlineSync.confirmRecord(options.entity, options.recordId, {
          minimumVersion: options.minimumVersion
        });
        return {
          ...result,
          ...recordResult,
          mode: recordResult.confirmed ? "REMOTE_CONFIRMED_RECORD" : recordResult.mode,
          confirmed: recordResult.confirmed === true
        };
      }
      return {
        ...result,
        mode: result?.ok ? "REMOTE_CONFIRMED_INCREMENTAL" : (result?.mode || "REMOTE_PENDING"),
        confirmed: result?.ok === true && Number(result?.conflicts || 0) === 0
      };
    }
    if (!cloud.enabled) {
      return { ok: true, mode: "LOCAL_ONLY", confirmed: false };
    }
    const result = await BlessERP.cloudStateSync.saveNow(state.db);
    return { ...result, confirmed: result?.ok === true && result?.mode === "REMOTE_SAVED" };
  }

  BlessERP.state = {
    state,
    currentRoute,
    currentGroup,
    currentMenuGroup,
    setRoute,
    toggleSidebar,
    setSidebarCollapsed,
    toggleMenuNode,
    closeAllMenuNodes,
    refreshNavigationAccess,
    setQuickSearch,
    closeQuickSearch,
    resetDemoData,
    dataRevision: () => runtimeDataRevision,
    markDataChanged,
    saveDb,
    saveDbLocalOnly,
    saveDbConfirmed,
    saveDbDurable,
    waitForLastSave
  };
  window.addEventListener?.("erp:incremental-sync-applied", markDataChanged);
})();
