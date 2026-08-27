(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { state } = BlessERP.state;
  const navigation = BlessERP.navigation;
  const menuService = BlessERP.menuService;
  const { esc } = BlessERP.utils;
  const productName = BlessERP.softwareProvider?.productName || "JAEDER SYSTEMS";
  const sidebarScrollPositions = { expanded: 0, collapsed: 0 };
  let lastRenderedRouteId = null;
  let realtimeSyncBound = false;
  let directRealtimeRenderTimer = null;
  let incrementalRealtimeRenderTimer = null;
  let crossTabSyncTimer = null;
  let deferredIncrementalRender = false;
  let connectionStatusBound = false;
  let sidebarHoverExpanded = false;
  let pageRenderToken = 0;
  let deferredPageRender = false;
  let dateEditGuardBound = false;
  let sidebarResponsiveBound = false;

  function usesDesktopHoverMenu() {
    return window.matchMedia?.("(min-width: 1121px) and (hover: hover) and (pointer: fine)")?.matches === true;
  }

  function activeDateInput() {
    const active = document.activeElement;
    const root = document.querySelector("#page-root");
    return active && root?.contains(active) && active.matches?.('input[type="date"], input[type="datetime-local"], input[type="month"], input[type="time"]')
      ? active
      : null;
  }

  function activePageEditor() {
    const active = document.activeElement;
    const root = document.querySelector("#page-root");
    return active && root?.contains(active) && active.matches?.('input, textarea, select, [contenteditable="true"]')
      ? active
      : null;
  }

  function refreshIncrementalPage() {
    if (activePageEditor()) {
      deferredIncrementalRender = true;
      return;
    }
    deferredIncrementalRender = false;
    BlessERP.performance?.invalidateCache?.();
    BlessERP.services?.companyContext?.ensureMultiCompanyState?.();
    BlessERP.state.refreshNavigationAccess?.();
    renderPage();
    renderConnectionStatus();
  }

  function routeAcceptsRemoteEntities(routeId, entities) {
    if (!entities?.size) return true;
    const route = String(routeId || "");
    const accepts = prefixes => [...entities].some(entity => prefixes.some(prefix => String(entity).startsWith(prefix)));
    if (route.startsWith("commercial-")) {
      return accepts(["commercial_", "operations_availability", "operations_rose_inventory", "operations_bunch", "operations_order_", "operations_dispatch_", "financial_"]);
    }
    if (route.startsWith("operations-")) {
      return accepts(["operations_", "commercial_orders", "commercial_order_reservations"]);
    }
    if (route.startsWith("payroll-")) return accepts(["payroll_"]);
    if (route === "reports-dashboard") {
      return accepts([
        "accounting_journal_entries", "financial_", "supplier_purchase_documents", "supplier_payables",
        "treasury_bank_", "treasury_reconciliations", "purchase_payables", "customer_receivables",
        "issued_withholdings", "received_withholdings", "bank_accounts", "bank_movements",
        "bank_reconciliations", "inventory_items", "material_inventory_movements", "purchases"
      ]);
    }
    if (["accounting-financials", "reports-accounting"].includes(route)) {
      const allowed = new Set([
        "accounting_chart_accounts", "accounting_journal_entries",
        "erp_financial_journal_entries", "erp_financial_journal_lines",
        "financial_journal_entries", "financial_journal_lines"
      ]);
      return [...entities].some(entity => allowed.has(String(entity)));
    }
    if (/^(accounting-|purchases-|portfolios-|portfolio-|banks-|treasury-|tax-)/.test(route)) {
      return accepts(["accounting_", "financial_", "supplier_", "treasury_", "purchase", "payments", "bank_", "customer_", "collections", "sales"]);
    }
    if (route.startsWith("settings-")) {
      return accepts(["company_", "accounting_", "commercial_", "operations_", "inventory_", "payroll_"]);
    }
    return true;
  }

  function flushDeferredPageRender() {
    if (!deferredPageRender || activeDateInput()) return;
    deferredPageRender = false;
    renderPage();
  }

  function bindDateEditGuard() {
    if (dateEditGuardBound) return;
    dateEditGuardBound = true;
    document.addEventListener("focusout", event => {
      if (event.target?.matches?.('input[type="date"], input[type="datetime-local"], input[type="month"], input[type="time"]')) {
        window.setTimeout(flushDeferredPageRender, 0);
      }
      window.setTimeout(async () => {
        await BlessERP.offlineSync?.flushDeferredRemoteRecords?.();
        if (deferredIncrementalRender) refreshIncrementalPage();
      }, 0);
    }, true);
  }

  function visibleMenuTree() {
    return menuService.getMenuTreeForDb(state.db).tree;
  }

  function routeContext(route) {
    if (!route) return "";
    return route.menuLabel === route.groupLabel
      ? route.menuLabel
      : `${route.menuLabel} · ${route.groupLabel}`;
  }

  function routeMatches(term) {
    const needle = String(term || "").trim().toLowerCase();
    if (!needle) return [];
    const allowedRoutes = new Set(menuService.getVisiblePagesForDb(state.db).map(node => node.ruta));
    return navigation.routes.filter(route => allowedRoutes.has(route.id) && (() => {
      const haystack = [
        route.menuLabel,
        route.groupLabel,
        route.label,
        route.title,
        route.description,
        route.status
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    })()).slice(0, 8);
  }

  function treeContainsRoute(node, routeId) {
    return node.ruta === routeId || (node.children || []).some(child => treeContainsRoute(child, routeId));
  }

  function newCommercialOrderUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("route", "commercial-order-master");
      url.searchParams.delete("order");
      url.searchParams.set("new", "1");
      return url.href;
    } catch (_error) {
      return "?route=commercial-order-master&new=1";
    }
  }

  function renderTreeNode(node, currentRoute, depth = 0) {
    const activeBranch = treeContainsRoute(node, currentRoute.id);
    if (node.tipo === "pagina") {
      const createOrderInlineAction = node.ruta === "commercial-order-master"
        ? `onclick="return window.BlessERP.layout.openNewCommercialOrder(event)"`
        : "";
      const createOrderShortcut = node.ruta === "commercial-order-master"
        ? `<a class="sidebar-tree-quick-action" href="${esc(newCommercialOrderUrl())}" data-commercial-new-order-shortcut onclick="return window.BlessERP.layout.openNewCommercialOrder(event)" aria-label="Crear pedido nuevo" title="Crear pedido nuevo">+</a>`
        : "";
      return `
        <div class="sidebar-tree-page-wrap ${createOrderShortcut ? "has-quick-action" : ""}" style="--tree-depth:${depth}">
          <button class="sidebar-tree-item page ${node.ruta === currentRoute.id ? "active" : ""}" type="button"
            data-nav-route="${esc(node.ruta)}" ${createOrderInlineAction} style="--tree-depth:${depth}">
            <span class="sidebar-tree-icon">${esc(node.icono)}</span>
            <span class="sidebar-tree-label">${esc(node.nombre)}</span>
            ${node.metadata?.future ? `<small>Futuro</small>` : ""}
          </button>
          ${createOrderShortcut}
        </div>
      `;
    }

    const hasExplicitState = Object.prototype.hasOwnProperty.call(state.ui.openMenuNodes, node.id);
    const open = hasExplicitState ? Boolean(state.ui.openMenuNodes[node.id]) : activeBranch;
    const commercialNewOrderShortcut = depth === 0 && treeContainsRoute(node, "commercial-order-master")
      ? `<a class="sidebar-root-new-order-shortcut" href="${esc(newCommercialOrderUrl())}" data-commercial-new-order-shortcut onclick="return window.BlessERP.layout.openNewCommercialOrder(event)" aria-label="Crear pedido nuevo" title="Crear pedido nuevo">+</a>`
      : "";
    return `
      <div class="sidebar-tree-folder ${open ? "open" : ""} ${depth === 0 ? "root" : ""}" data-menu-node-id="${esc(node.id)}">
        <button class="sidebar-tree-item folder ${activeBranch ? "active-branch" : ""}" type="button"
          data-toggle-menu-node="${esc(node.id)}" aria-expanded="${open}" style="--tree-depth:${depth}">
          <span class="sidebar-tree-icon">${esc(node.icono)}</span>
          <span class="sidebar-tree-label">${esc(node.nombre)}</span>
          <span class="sidebar-tree-caret" aria-hidden="true">›</span>
        </button>
        ${commercialNewOrderShortcut}
        <div class="sidebar-tree-children">
          ${(node.children || []).map(child => renderTreeNode(child, currentRoute, depth + 1)).join("")}
        </div>
      </div>
    `;
  }

  function renderSidebar() {
    const sidebar = document.querySelector("#sidebar");
    const previousMode = sidebar.classList.contains("collapsed") ? "collapsed" : "expanded";
    const previousMenu = sidebar.querySelector(".sidebar-groups");
    if (previousMenu) sidebarScrollPositions[previousMode] = previousMenu.scrollTop;

    const desktopHoverMenu = usesDesktopHoverMenu();
    const collapsed = desktopHoverMenu ? !sidebarHoverExpanded : state.ui.sidebarCollapsed;
    const currentMode = collapsed ? "collapsed" : "expanded";
    const currentRoute = BlessERP.state.currentRoute();
    const menuTree = visibleMenuTree();
    const hostname = String(window.location.hostname || "").toLowerCase();
    const localDeployment = window.location.protocol === "file:"
      || !hostname
      || ["localhost", "127.0.0.1", "::1"].includes(hostname);
    const deploymentLabel = localDeployment ? "Modo local" : "Nube segura";
    const compactLabelsRoute = currentRoute.id === "operations-labels";
    const companyContext = BlessERP.services?.companyContext;
    const activeCompany = companyContext?.activeCompany?.() || {};
    const companyIds = BlessERP.companyCapabilities?.COMPANY_IDS || {};
    const otherCompanyId = activeCompany.id === companyIds.IMPERIO ? companyIds.BLESS : companyIds.IMPERIO;
    const otherCompany = companyContext?.company?.(otherCompanyId) || {};
    const otherCompanyUrl = companyContext?.workspaceUrl?.(otherCompanyId) || "#";
    const activeCompanyName = activeCompany.commercialName || state.db.meta?.companyName || "Bless Flower";
    const activeCompanyLogo = activeCompany.logoPath || "scripts/assets/bless-flower-logo-official-transparent.png";
    const otherCompanyName = otherCompany.commercialName || (otherCompanyId === companyIds.BLESS ? "Bless Flower" : "Imperio Flowers");
    const otherCompanyShort = otherCompanyId === companyIds.BLESS ? "BF" : "IF";
    const otherCompanyClass = otherCompanyId === companyIds.BLESS ? "target-bless" : "target-imperio";
    const sessionUserId = state.db.session?.activeUser?.id;
    const accessUser = (state.db.visualUsers || []).find(item => item.id === sessionUserId)
      || state.db.session?.activeUser
      || {};
    const otherCompanyAccess = menuService.getUserAccessContext(accessUser, otherCompanyId).active;

    const shell = sidebar.closest(".app-shell");
    shell?.classList.toggle("sidebar-is-collapsed", collapsed);
    sidebar.className = `sidebar part2-sidebar${collapsed ? " collapsed" : ""}${sidebarHoverExpanded ? " hover-expanded" : ""}${desktopHoverMenu ? " desktop-hover-menu" : " touch-menu"}`;
    sidebar.innerHTML = `
      <div class="sidebar-top ${collapsed ? "is-collapsed" : ""} ${compactLabelsRoute ? "brand-hidden" : ""}">
        <div class="brand-card sidebar-brand">
          <img class="sidebar-brand-logo" src="${esc(activeCompanyLogo)}" alt="${esc(activeCompanyName)}">
          <div>
            <strong>${esc(productName)}</strong>
            <small>${esc(activeCompanyName)}</small>
          </div>
        </div>
        <span class="sidebar-compact-brand" aria-label="${esc(productName)}" title="${esc(productName)}">JS</span>
        <button class="sidebar-toggle" type="button" data-toggle-sidebar aria-expanded="${!collapsed}" aria-label="${collapsed ? "Expandir menu principal" : "Contraer menu principal"}" title="${collapsed ? "Expandir menu" : "Contraer menu"}">
          <span class="sidebar-toggle-bars" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>
      </div>
      <nav class="sidebar-groups">
        ${menuTree.map(node => renderTreeNode(node, currentRoute)).join("")}
      </nav>
      <div class="sidebar-foot">
        ${collapsed && otherCompanyAccess ? `
          <a class="company-workspace-link icon-only ${otherCompanyClass}" href="${esc(otherCompanyUrl)}" target="_blank" rel="noopener noreferrer"
            title="Abrir ${esc(otherCompanyName)} en otra pestaña" aria-label="Abrir ${esc(otherCompanyName)} en otra pestaña">
            <span>${esc(otherCompanyShort)}</span><b aria-hidden="true">↗</b>
          </a>
        ` : collapsed ? `
          <span class="company-workspace-link icon-only is-disabled" title="Sin acceso a ${esc(otherCompanyName)}">
            <span>${esc(otherCompanyShort)}</span><b aria-hidden="true">×</b>
          </span>
        ` : `
          <div class="sidebar-company-context">
            <small>Empresa de esta pestaña</small>
            <strong>${esc(activeCompanyName)}</strong>
          </div>
          ${otherCompanyAccess ? `
            <a class="company-workspace-link ${otherCompanyClass}" href="${esc(otherCompanyUrl)}" target="_blank" rel="noopener noreferrer">
              <span>Abrir ${esc(otherCompanyName)}</span><b aria-hidden="true">↗</b>
            </a>
          ` : `
            <span class="company-workspace-link is-disabled">
              <span>Sin acceso a ${esc(otherCompanyName)}</span><b aria-hidden="true">×</b>
            </span>
          `}
          <small>${deploymentLabel} &middot; Cada pestaña conserva su propia empresa</small>
        `}
      </div>
    `;

    const renderedMenu = sidebar.querySelector(".sidebar-groups");
    if (renderedMenu) renderedMenu.scrollTop = sidebarScrollPositions[currentMode];
  }

  function renderTopbar() {
    const topbar = document.querySelector("#topbar");
    const signOutEnabled = BlessERP.authAccess?.enabled?.() || false;
    topbar.hidden = !signOutEnabled;
    topbar.classList.toggle("topbar-signout-only", signOutEnabled);
    if (topbar.hidden) {
      topbar.innerHTML = "";
      return;
    }

    topbar.innerHTML = `
      <button class="topbar-signout-button" type="button" data-auth-signout title="Cerrar la sesión actual">
        Cerrar sesión
      </button>
    `;
  }

  function refreshSidebarRouteState(routeId) {
    const sidebar = document.querySelector("#sidebar");
    if (!sidebar) return false;
    sidebar.querySelectorAll("[data-nav-route]").forEach(button => {
      button.classList.toggle("active", button.dataset.navRoute === routeId);
    });
    sidebar.querySelectorAll("[data-menu-node-id]").forEach(folder => {
      const activeBranch = [...folder.querySelectorAll("[data-nav-route]")]
        .some(button => button.dataset.navRoute === routeId);
      folder.querySelector(":scope > [data-toggle-menu-node]")?.classList.toggle("active-branch", activeBranch);
    });
    syncSidebarTreeState(sidebar);
    return true;
  }

  function syncSidebarTreeState(sidebar) {
    sidebar?.querySelectorAll?.("[data-menu-node-id]").forEach(folder => {
      const open = Boolean(state.ui.openMenuNodes[folder.dataset.menuNodeId]);
      folder.classList.toggle("open", open);
      folder.querySelector(":scope > [data-toggle-menu-node]")?.setAttribute("aria-expanded", String(open));
    });
  }

  function renderPage() {
    if (activeDateInput()) {
      // Varios módulos actualizan su estado durante input/change. Reemplazar
      // page-root en ese momento destruye el control nativo y corta la edición
      // de día, mes o año. El refresco se aplica al abandonar el campo.
      deferredPageRender = true;
      return;
    }
    deferredPageRender = false;
    const root = document.querySelector("#page-root");
    const route = BlessERP.state.currentRoute();
    const token = ++pageRenderToken;
    root.onclick = null;
    BlessERP.performance?.beginRenderCycle?.();

    if (!BlessERP.menuService?.canCurrentUserAccessRoute?.(route.id, state.db)) {
      const decision = BlessERP.capabilityRuntime?.evaluateRoute?.(route.id, { source: "RENDER_GUARD" });
      root.innerHTML = `
        <section class="panel-card inline-feedback warning" data-capability-access-denied>
          <strong>Acceso no autorizado</strong>
          <span>Su perfil no permite abrir este recurso en la empresa activa.</span>
          <small>${esc(decision?.requiredCapability || "CAPABILITY_REQUIRED")}</small>
        </section>
      `;
      BlessERP.performance?.finishRouteTransition?.(route.id, { denied: true });
      return;
    }

    const showRenderError = error => {
      console.error(`[JAEDER PERF] No se pudo abrir ${route.id}`, error);
      root.innerHTML = `
        <section class="panel-card inline-feedback danger">
          <strong>No se pudo abrir ${esc(route.title)}</strong>
          <span>${esc(error?.message || "Error al cargar el módulo.")}</span>
          <button type="button" class="secondary-button" data-jaeder-retry-module>Reintentar</button>
        </section>
      `;
    };

    if (!BlessERP.moduleLoader?.isRouteReady?.(route.id)) {
      root.innerHTML = `
        <section class="jaeder-module-loading" role="status" aria-live="polite">
          <span class="jaeder-loading-spinner" aria-hidden="true"></span>
          <div><strong>Cargando ${esc(route.title)}</strong><small>Preparando únicamente este módulo.</small></div>
        </section>
      `;
      BlessERP.moduleLoader.ensureRoute(route.id)
        .then(() => {
          if (token !== pageRenderToken || BlessERP.state.currentRoute().id !== route.id) return;
          renderPage();
        })
        .catch(error => {
          if (token !== pageRenderToken) return;
          showRenderError(error);
        });
      return;
    }

    try {
      BlessERP.performance?.measureSync?.(`render:${route.id}`, () => {
        BlessERP.modules.part2.render(root, state, route);
        enforceRouteVisibility(root);
        removeSummaryCards(root);
      }, { routeId: route.id });
      if (!root.querySelector("[data-jaeder-deferred-content]")) {
        BlessERP.performance?.finishRouteTransition?.(route.id, {
          domNodes: root.querySelectorAll("*").length
        });
      }
    } catch (error) {
      BlessERP.performance?.finishRouteTransition?.(route.id, { error: true });
      showRenderError(error);
    }
  }

  function renderConnectionStatus() {
    let indicator = document.querySelector("#jaeder-connection-status");
    const env = BlessERP.getEnvConfig?.() || {};
    if (window.__ERP_LOCAL_MODE__ === true || window.location?.protocol === "file:" || !env.supabaseEnabled) {
      indicator?.remove();
      return;
    }
    if (!indicator) {
      indicator = document.createElement("button");
      indicator.id = "jaeder-connection-status";
      indicator.type = "button";
      indicator.dataset.cloudSyncNow = "true";
      document.body.appendChild(indicator);
    }
    const cloud = BlessERP.cloudStateSync?.status?.() || {};
    const queue = BlessERP.offlineSync?.status?.() || {};
    const sync = queue.enabled ? queue : cloud;
    const session = BlessERP.authAccess?.sessionStatus?.() || {};
    const localMode = !sync.enabled;
    let tone = "ok";
    let label = localMode ? "Modo local" : "Supabase confirmado";
    let detail = localMode
      ? "Los datos compartidos no están conectados a Supabase."
      : "Datos compartidos confirmados por Supabase.";

    if ((!localMode && !queue.enabled && cloud.conflict) || Number(sync.conflictCount || 0) > 0) {
      tone = "warning";
      label = "Incidencia en conciliación";
      detail = "El sistema conservará la auditoría y resolverá automáticamente sin bloquear el trabajo.";
    } else if (!localMode && (sync.online === false || sync.serverReachable === false)) {
      tone = "offline";
      label = Number(sync.pendingCount || 0) > 0 || sync.pending ? "Cambios sin confirmar" : "Supabase sin conexión";
      detail = Number(sync.pendingCount || 0) > 0 || sync.pending
        ? "Existe un cambio local pendiente; todavía no fue confirmado por Supabase."
        : "JAEDER SYSTEMS volverá a consultar Supabase cuando se recupere la conexión.";
    } else if (!localMode && (sync.saving || sync.phase === "syncing" || Number(sync.pendingCount || 0) > 0 || sync.pending)) {
      tone = "pending";
      label = sync.saving || sync.phase === "syncing" ? "Sincronizando..." : "Cambios pendientes";
      detail = `${Math.max(Number(sync.pendingCount || 0), 1)} operación(es) pendiente(s). El reintento es automático.`;
    } else if (!localMode && sync.realtimeState !== "SUBSCRIBED") {
      tone = "warning";
      label = sync.realtimeState === "RECONNECTING" ? "Reconectando Realtime" : "Realtime desconectado";
      detail = sync.lastRealtimeError || sync.lastError || "Los datos están seguros en Supabase; se realizará una consulta de recuperación.";
    } else if (!localMode && sync.lastError) {
      tone = "warning";
      label = "Conexión por comprobar";
      detail = sync.lastError;
    }

    const sessionLabel = session.active === false
      ? "Sesión por validar"
      : session.mode === "SUPABASE_OFFLINE_CACHE"
        ? "Sesión conservada sin conexión"
        : localMode
          ? "Sesión protegida 15 h"
          : "Sesión web activa";
    indicator.className = `jaeder-connection-status is-${tone}`;
    indicator.innerHTML = `<span aria-hidden="true"></span><strong>${esc(label)}</strong><small>${esc(sessionLabel)}</small>`;
    const lastConfirmedAt = sync.lastSyncAt || sync.lastSuccessAt || cloud.lastSuccessAt;
    const lastSync = lastConfirmedAt
      ? new Date(lastConfirmedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })
      : "sin confirmación previa";
    indicator.title = `${detail} Última confirmación: ${lastSync}. Pulse para abrir el centro de sincronización.`;
  }

  function enforceRouteVisibility(root) {
    if (!root) return;
    root.querySelectorAll("[data-route-link], [data-nav-route]").forEach(element => {
      const routeId = element.dataset.routeLink || element.dataset.navRoute;
      if (routeId && !menuService.canCurrentUserAccessRoute(routeId, state.db)) element.remove();
    });
  }

  function removeSummaryCards(root) {
    if (!root) return;
    const availabilityRoutes = new Set(["operations-availability", "commercial-availability-reservations"]);
    root.querySelectorAll([
      ...(availabilityRoutes.has(BlessERP.state.currentRoute().id) ? [] : [".summary-grid", ".summary-card"]),
      ".kpi-grid",
      ".kpi-card",
      ".master-order-kpis",
      ".ops-inline-metrics",
      ".ops-classification-summary",
      ".ops-label-summary",
      ".ops-bunch-intake-summary",
      ".ops-bunch-search-counters",
      ".ops-workday-summary",
      ".ops-worker-yield-goals",
      ".yield-tv-metrics"
    ].join(",")).forEach(node => node.remove());
  }

  function renderApp() {
    const routeId = BlessERP.state.currentRoute().id;
    const routeChanged = lastRenderedRouteId !== null && lastRenderedRouteId !== routeId;
    if (routeChanged) {
      BlessERP.domainDataLoader?.leaveRoute?.(lastRenderedRouteId);
      if (lastRenderedRouteId === "reports-portfolio") void BlessERP.services?.accountingPortfolioReportV2?.stop?.();
      if (lastRenderedRouteId === "reports-banks") void BlessERP.services?.accountingBankReportV2?.stop?.();
      if (lastRenderedRouteId === "reports-dashboard") void BlessERP.services?.accountingDashboardReadV2?.stop?.();
      if (["accounting-financials", "reports-accounting"].includes(lastRenderedRouteId)
        && !["accounting-financials", "reports-accounting"].includes(routeId)) {
        void BlessERP.services?.financialStatementsReadV2?.stop?.();
      }
      if (["accounting-journal", "accounting-ledger"].includes(lastRenderedRouteId)
        && !["accounting-journal", "accounting-ledger"].includes(routeId)) {
        void BlessERP.services?.accountingReadV2?.stop?.();
      }
      if (["portfolios-ap", "portfolios-ar"].includes(lastRenderedRouteId)
        && !["portfolios-ap", "portfolios-ar"].includes(routeId)) {
        void BlessERP.services?.portfolioReadV2?.stop?.();
      }
      if (["portfolios-payments-single", "portfolios-collections-single"].includes(lastRenderedRouteId)
        && !["portfolios-payments-single", "portfolios-collections-single"].includes(routeId)) {
        void BlessERP.services?.paymentCollectionReadV2?.stop?.();
      }
      if (["banks-movements", "banks-reconciliation", "banks-transfers"].includes(lastRenderedRouteId)
        && !["banks-movements", "banks-reconciliation", "banks-transfers"].includes(routeId)) {
        void BlessERP.services?.treasuryReadV2?.stop?.();
      }
      if (lastRenderedRouteId === "purchases-invoices") void BlessERP.services?.purchaseInvoiceReadV2?.stop?.();
      if (lastRenderedRouteId === "purchases-withholdings-issued") void BlessERP.services?.purchaseWithholdingV2?.stop?.();
      if (lastRenderedRouteId === "tax-withholdings-received") void BlessERP.services?.receivedWithholdingRead?.stop?.();
      if (lastRenderedRouteId === "purchases-retention-report") void BlessERP.services?.retentionReportReadV2?.stop?.();
      if (lastRenderedRouteId === "purchases-supplier-settlements") void BlessERP.services?.supplierSettlementReadV2?.stop?.();
    }
    if (routeChanged && ["commercial-order-detail", "commercial-order-coordination"].includes(lastRenderedRouteId)) {
      BlessERP.comercialOrderDetail?.unmount?.(document.querySelector("#page-root"));
    }
    if (routeChanged && lastRenderedRouteId?.startsWith("operations-") && !routeId.startsWith("operations-")) {
      BlessERP.modules.operaciones?.unmount?.(document.querySelector("#page-root"));
    }
    if (routeId === "operations-dispatch" && lastRenderedRouteId !== routeId) {
      const coldRoomUi = state.db.operations?.ui;
      if (coldRoomUi) {
        coldRoomUi.dispatchViewMode = "list";
        coldRoomUi.selectedDispatchOrderId = "";
        coldRoomUi.dispatchPreviewOrderId = "";
        coldRoomUi.dispatchReturnRoute = "";
      }
    }
    if (!routeChanged || !refreshSidebarRouteState(routeId)) renderSidebar();
    if (!routeChanged || !document.querySelector("#topbar")?.hasChildNodes()) renderTopbar();
    renderPage();
    renderConnectionStatus();
    if (routeChanged) {
      const workspace = document.querySelector(".workspace-shell");
      if (workspace) workspace.scrollTop = 0;
    }
    lastRenderedRouteId = routeId;
  }

  function openNewCommercialOrder(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    startNewCommercialOrderWorkspace();
    BlessERP.state.setRoute("commercial-order-master");
    if (!usesDesktopHoverMenu()) BlessERP.state.setSidebarCollapsed?.(true);
    renderApp();
    return false;
  }

  function startNewCommercialOrderWorkspace() {
    if (BlessERP.commercialFlowV2?.newDraft) return BlessERP.commercialFlowV2.newDraft(state);
    return BlessERP.comercialState?.startNewOrderWorkspace?.(state);
  }

  function bindRealtimeSync() {
    if (realtimeSyncBound) return;
    realtimeSyncBound = true;
    window.addEventListener("erp:capabilities-refreshed", () => {
      BlessERP.state.refreshNavigationAccess?.();
      renderApp();
    });
    window.addEventListener("storage", event => {
      if (event.key !== BlessERP.storage.STORAGE_KEY) return;
      if (BlessERP.getEnvConfig?.().incrementalSyncEnabled) {
        // localStorage es solo caché. Una pestaña vecina nunca debe reemplazar
        // todo el estado activo ni devolver el formulario al pedido anterior.
        window.clearTimeout(crossTabSyncTimer);
        crossTabSyncTimer = window.setTimeout(() => {
          BlessERP.offlineSync?.pullBootstrap?.().catch(error => {
            console.warn("[jaeder-sync] No se pudo consultar Supabase tras el cambio de otra pestaña.", error);
          });
        }, 250);
        renderConnectionStatus();
        return;
      }
      const routeId = BlessERP.state.currentRoute().id;
      const recordsOwnSync = routeId === "operations-yields" && state.db.operations?.ui?.yieldsView === "records";
      if (routeId === "operations-yield-screen" || recordsOwnSync) return;
      const latestDb = BlessERP.storage.load();
      if (!latestDb) return;
      state.db = latestDb;
      BlessERP.services?.companyContext?.ensureMultiCompanyState?.();
      BlessERP.state.refreshNavigationAccess?.();
      renderApp();
    });
    window.addEventListener("erp:storage-reconciled", () => {
      // La conciliación registro por registro continúa en segundo plano. No se
      // interrumpe al usuario con una decisión global entre dos bases locales.
      renderConnectionStatus();
    });
    if (!connectionStatusBound) {
      connectionStatusBound = true;
      [
        "erp:cloud-sync-status",
        "erp:cloud-sync-success",
        "erp:cloud-sync-error",
        "erp:session-status",
        "online",
        "offline"
      ].forEach(eventName => window.addEventListener(eventName, renderConnectionStatus));
      window.addEventListener("erp:cloud-sync-remote-loaded", () => {
        BlessERP.performance?.invalidateCache?.();
        BlessERP.services?.companyContext?.ensureMultiCompanyState?.();
        BlessERP.state.refreshNavigationAccess?.();
        renderApp();
          // La resincronizacion exitosa es silenciosa; los errores siguen visibles.
      });
      window.addEventListener("erp:direct-realtime-change", event => {
        window.clearTimeout(directRealtimeRenderTimer);
        directRealtimeRenderTimer = window.setTimeout(() => {
          BlessERP.performance?.invalidateCache?.();
          const routeId = BlessERP.state.currentRoute().id;
          const table = event.detail?.table || "Supabase";
          if (/^(commercial-sri-authorization|commercial-credit-notes|settings-)/.test(routeId)) {
            refreshIncrementalPage();
          }
        // Las actualizaciones normales entre equipos no interrumpen el trabajo del usuario.
        }, 350);
      });
      window.addEventListener("erp:incremental-sync-applied", event => {
        const routeId = BlessERP.state.currentRoute().id;
        const entities = new Set([
          event.detail?.entity,
          ...(Array.isArray(event.detail?.entities) ? event.detail.entities : [])
        ].filter(Boolean));
        if (event.detail?.granularHandled === true || !routeAcceptsRemoteEntities(routeId, entities)) {
          renderConnectionStatus();
          return;
        }
        if (routeId === "commercial-order-history" && entities.size && !entities.has("commercial_orders")) {
          renderConnectionStatus();
          return;
        }
        if (routeId === "commercial-order-history" && (!entities.size || entities.has("commercial_orders"))) {
          BlessERP.comercialHistory?.invalidateRemotePage?.();
        }
        if (routeId === "operations-bunch-intake" && BlessERP.operacionesZebraIntakeController?.handleRealtime?.(event.detail)) {
          renderConnectionStatus();
          return;
        }
        window.clearTimeout(incrementalRealtimeRenderTimer);
        incrementalRealtimeRenderTimer = window.setTimeout(refreshIncrementalPage, 220);
      });
      document.addEventListener("click", event => {
        const syncButton = event.target.closest("[data-cloud-sync-now]");
        if (!syncButton) return;
        BlessERP.state.setRoute?.("settings-synchronization");
        renderApp();
      });
    }
  }

  function bindNavigation() {
    bindRealtimeSync();
    bindDateEditGuard();
    if (usesDesktopHoverMenu()) {
      sidebarHoverExpanded = false;
      BlessERP.state.closeAllMenuNodes?.({ persist: false });
    }
    const updateQuickSearch = BlessERP.performance?.debounce?.(value => {
      BlessERP.state.setQuickSearch(value);
      renderTopbar();
      const input = document.querySelector("#quick-search-input");
      input?.focus();
      if (input) input.selectionStart = input.selectionEnd = input.value.length;
    }, 140) || (value => {
      BlessERP.state.setQuickSearch(value);
      renderTopbar();
    });
    const sidebar = document.querySelector("#sidebar");
    sidebar.addEventListener("mouseenter", () => {
      if (!usesDesktopHoverMenu() || sidebarHoverExpanded) return;
      sidebarHoverExpanded = true;
      renderSidebar();
    });
    sidebar.addEventListener("mouseleave", () => {
      if (!usesDesktopHoverMenu() || !sidebarHoverExpanded) return;
      sidebarHoverExpanded = false;
      BlessERP.state.closeAllMenuNodes?.({ persist: false });
      renderSidebar();
    });
    sidebar.addEventListener("click", event => {
      const newOrderShortcut = event.target.closest("[data-commercial-new-order-shortcut]");
      if (newOrderShortcut) {
        event.preventDefault();
        event.stopPropagation();
        startNewCommercialOrderWorkspace();
        BlessERP.state.setRoute("commercial-order-master");
        if (!usesDesktopHoverMenu()) BlessERP.state.setSidebarCollapsed?.(true);
        renderApp();
        return;
      }
      const routeButton = event.target.closest("[data-nav-route]");
      if (routeButton) {
        const targetRoute = routeButton.dataset.navRoute;
        if (targetRoute === "commercial-order-master") {
          startNewCommercialOrderWorkspace();
        }
        BlessERP.state.setRoute(targetRoute);
        if (!usesDesktopHoverMenu()) {
          BlessERP.state.setSidebarCollapsed?.(true);
          BlessERP.state.closeAllMenuNodes?.({ persist: false });
        }
        renderApp();
        return;
      }
      const toggleSidebar = event.target.closest("[data-toggle-sidebar]");
      if (toggleSidebar) {
        if (usesDesktopHoverMenu()) return;
        sidebarHoverExpanded = false;
        BlessERP.state.toggleSidebar();
        renderApp();
        return;
      }
      const toggleNode = event.target.closest("[data-toggle-menu-node]");
      if (toggleNode) {
        BlessERP.state.toggleMenuNode(toggleNode.dataset.toggleMenuNode);
        syncSidebarTreeState(sidebar);
      }
    });

    let navigationPrefetchTimer = 0;
    let navigationPrefetchRoute = "";
    const cancelNavigationPrefetch = () => {
      if (navigationPrefetchTimer) window.clearTimeout(navigationPrefetchTimer);
      navigationPrefetchTimer = 0;
      navigationPrefetchRoute = "";
    };
    const prefetchNavigationRoute = event => {
      const routeButton = event.target.closest?.("[data-nav-route]");
      if (!routeButton) return;
      const routeId = String(routeButton.dataset.navRoute || "");
      if (!routeId || routeId === navigationPrefetchRoute) return;
      cancelNavigationPrefetch();
      navigationPrefetchRoute = routeId;
      navigationPrefetchTimer = window.setTimeout(() => {
        navigationPrefetchTimer = 0;
        BlessERP.moduleLoader?.prefetchRoute?.(routeId);
      }, event.type === "focusin" ? 0 : 220);
    };
    const cancelNavigationPrefetchOnLeave = event => {
      const routeButton = event.target.closest?.("[data-nav-route]");
      if (!routeButton || routeButton.contains(event.relatedTarget)) return;
      cancelNavigationPrefetch();
    };
    sidebar.addEventListener("pointerover", prefetchNavigationRoute, { passive: true });
    sidebar.addEventListener("pointerout", cancelNavigationPrefetchOnLeave, { passive: true });
    sidebar.addEventListener("focusin", prefetchNavigationRoute);

    if (!sidebarResponsiveBound && window.matchMedia) {
      sidebarResponsiveBound = true;
      const desktopQuery = window.matchMedia("(min-width: 1121px) and (hover: hover) and (pointer: fine)");
      desktopQuery.addEventListener?.("change", () => {
        sidebarHoverExpanded = false;
        BlessERP.state.closeAllMenuNodes?.({ persist: false });
        if (desktopQuery.matches) BlessERP.state.setSidebarCollapsed?.(true, { persist: false });
        renderSidebar();
      });
    }

    document.querySelector("#topbar").addEventListener("click", event => {
      const signOutButton = event.target.closest("[data-auth-signout]");
      if (signOutButton) {
        signOutButton.disabled = true;
        BlessERP.authAccess?.signOut?.().finally(() => window.location.reload());
        return;
      }
      const routeButton = event.target.closest("[data-nav-route]");
      if (!routeButton) return;
      const targetRoute = routeButton.dataset.navRoute;
      if (targetRoute === "commercial-order-master") {
        startNewCommercialOrderWorkspace();
      }
      BlessERP.state.setRoute(targetRoute);
      renderApp();
    });

    document.querySelector("#topbar").addEventListener("input", event => {
      if (event.target.id !== "quick-search-input") return;
      updateQuickSearch(event.target.value);
    });

    document.querySelector("#toast")?.addEventListener("click", () => hideToast());

    document.querySelector("#page-root").addEventListener("click", event => {
      const pager = event.target.closest("[data-jaeder-page-key]");
      if (pager) {
        BlessERP.performance?.setPage?.(pager.dataset.jaederPageKey, pager.dataset.jaederPage);
        renderPage();
        return;
      }
      if (event.target.closest("[data-jaeder-retry-module]")) {
        renderPage();
        return;
      }
      const routeButton = event.target.closest("[data-route-link]");
      if (!routeButton) return;
      const targetRoute = routeButton.dataset.routeLink;
      if (targetRoute === "commercial-order-master") {
        startNewCommercialOrderWorkspace();
      }
      BlessERP.state.setRoute(targetRoute);
      renderApp();
    });

    document.addEventListener("click", event => {
      const searchWrap = document.querySelector(".quick-search-wrap");
      if (!searchWrap) return;
      if (!searchWrap.contains(event.target) && !document.querySelector("#topbar").contains(event.target)) {
        BlessERP.state.closeQuickSearch();
        renderTopbar();
      }
    });
  }

  let toastTimer = null;
  let toastHideTimer = null;

  function compactToastText(message, tone = "info") {
    const text = String(message || "").replace(/\s+/g, " ").trim();
    const maxLength = tone === "danger" ? 190 : tone === "warning" ? 165 : 145;
    if (text.length <= maxLength) return text;
    const clipped = text.slice(0, maxLength - 1);
    const lastSpace = clipped.lastIndexOf(" ");
    return `${clipped.slice(0, lastSpace > maxLength * 0.65 ? lastSpace : clipped.length).trim()}…`;
  }

  function finalizeDeferredContent(root) {
    enforceRouteVisibility(root);
    removeSummaryCards(root);
  }

  function hideToast(node = document.querySelector("#toast")) {
    if (!node || node.hidden) return;
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    node.classList.remove("toast--visible");
    node.classList.add("toast--leaving");
    toastHideTimer = setTimeout(() => {
      node.hidden = true;
      node.classList.remove("toast--leaving");
      node.removeAttribute("title");
    }, 260);
  }

  function toast(message, options = {}) {
    const node = document.querySelector("#toast");
    if (!node) return;
    const cloud = BlessERP.cloudStateSync?.status?.() || {};
    const queue = BlessERP.offlineSync?.status?.() || {};
    const text = String(message || "").trim();
    if (!text) {
      node.hidden = true;
      return;
    }
    const looksLikeError = /(?:no se pudo|no se puede|no puede|error|fall[oó]|rechazad|inv[aá]lid|desconectad|no existe|no disponible)/i.test(text);
    const looksLikeWarning = !looksLikeError && /(?:seleccione|complete|pendiente|requiere|debe ingresar|debe elegir)/i.test(text);
    const looksLikeSaveSuccess = !looksLikeError
      && /(?:guardad|registrad|actualizad|cread|eliminad|anulad|completad|agregad|editad|procesad|ingresad|enviad|generad|descargad|copiad|confirmad|finalizad)/i.test(text);
    const mustClarifyPending = options.confirmed !== true
      && ((queue.enabled && (
        queue.pendingCount
        || queue.syncingCount
        || !queue.serverReachable
        || ["pending", "syncing", "offline", "reconnecting", "error"].includes(queue.phase)
      )) || (cloud.enabled && (cloud.pending || cloud.saving)))
      && looksLikeSaveSuccess;
    const requestedTone = options.tone === "error" ? "danger" : options.tone;
    const tone = mustClarifyPending
      ? "warning"
      : (requestedTone || (looksLikeError ? "danger" : looksLikeWarning ? "warning" : looksLikeSaveSuccess ? "success" : "info"));
    const fullText = mustClarifyPending
      ? `${text} Pendiente de confirmación en Supabase.`
      : text;
    node.textContent = compactToastText(fullText, tone);
    node.title = fullText;
    node.className = `toast toast--${tone}`;
    node.setAttribute("role", tone === "danger" ? "alert" : "status");
    node.setAttribute("aria-live", tone === "danger" ? "assertive" : "polite");
    node.hidden = false;
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    void node.offsetWidth;
    node.classList.add("toast--visible");
    toastTimer = setTimeout(
      () => hideToast(node),
      Number(options.duration || (tone === "success" ? 1600 : tone === "danger" ? 4400 : tone === "warning" ? 3200 : 2200))
    );
  }

  BlessERP.layout = {
    bindNavigation,
    finalizeDeferredContent,
    removeSummaryCards,
    renderApp,
    renderPage,
    isEditing() {
      return Boolean(activePageEditor());
    },
    hideToast,
    openNewCommercialOrder,
    toast
  };
})();
