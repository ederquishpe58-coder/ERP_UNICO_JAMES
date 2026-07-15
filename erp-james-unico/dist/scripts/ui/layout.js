(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { state } = BlessERP.state;
  const navigation = BlessERP.navigation;
  const menuService = BlessERP.menuService;
  const { esc } = BlessERP.utils;
  const sidebarScrollPositions = { expanded: 0, collapsed: 0 };
  let lastRenderedRouteId = null;

  function activeRole() {
    return state.db.session?.activeUser?.role || "Invitado";
  }

  function visibleMenuTree() {
    return menuService.getMenuTreeForRole(activeRole()).tree;
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
    const allowedRoutes = new Set(menuService.getVisiblePages(activeRole()).map(node => node.ruta));
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

  function renderTreeNode(node, currentRoute, depth = 0) {
    const activeBranch = treeContainsRoute(node, currentRoute.id);
    if (node.tipo === "pagina") {
      return `
        <button class="sidebar-tree-item page ${node.ruta === currentRoute.id ? "active" : ""}" type="button"
          data-nav-route="${esc(node.ruta)}" style="--tree-depth:${depth}">
          <span class="sidebar-tree-icon">${esc(node.icono)}</span>
          <span class="sidebar-tree-label">${esc(node.nombre)}</span>
          ${node.metadata?.future ? `<small>Futuro</small>` : ""}
        </button>
      `;
    }

    const hasExplicitState = Object.prototype.hasOwnProperty.call(state.ui.openMenuNodes, node.id);
    const open = hasExplicitState ? Boolean(state.ui.openMenuNodes[node.id]) : activeBranch;
    return `
      <div class="sidebar-tree-folder ${open ? "open" : ""} ${depth === 0 ? "root" : ""}">
        <button class="sidebar-tree-item folder ${activeBranch ? "active-branch" : ""}" type="button"
          data-toggle-menu-node="${esc(node.id)}" aria-expanded="${open}" style="--tree-depth:${depth}">
          <span class="sidebar-tree-icon">${esc(node.icono)}</span>
          <span class="sidebar-tree-label">${esc(node.nombre)}</span>
          <span class="sidebar-tree-caret">${open ? "-" : "+"}</span>
        </button>
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

    const collapsed = state.ui.sidebarCollapsed;
    const currentMode = collapsed ? "collapsed" : "expanded";
    const currentRoute = BlessERP.state.currentRoute();
    const menuTree = visibleMenuTree();
    const deploymentLabel = window.location.hostname.endsWith("github.io") ? "Nube GitHub" : "Modo local";

    sidebar.className = `sidebar part2-sidebar${collapsed ? " collapsed" : ""}`;
    sidebar.innerHTML = `
      <div class="sidebar-top">
        <div class="brand-card sidebar-brand ${collapsed ? "compact" : ""}">
          <span class="brand-mark">JU</span>
          ${collapsed ? "" : `
            <div>
              <strong>ERP JAMES UNICO</strong>
              <small>Shell modular base</small>
            </div>
          `}
        </div>
        <button class="sidebar-toggle" type="button" data-toggle-sidebar>${collapsed ? ">>" : "<<"}</button>
      </div>
      <nav class="sidebar-groups">
        ${collapsed
          ? menuTree.map(node => {
              const firstPage = BlessERP.navigationTree.getFirstPage(node);
              const active = treeContainsRoute(node, currentRoute.id);
              return firstPage ? `<button class="collapsed-group-button ${active ? "active" : ""}" type="button" title="${esc(node.nombre)}" data-nav-route="${esc(firstPage.ruta)}">${esc(node.icono)}</button>` : "";
            }).join("")
          : menuTree.map(node => renderTreeNode(node, currentRoute)).join("")}
      </nav>
      <div class="sidebar-foot">
        ${collapsed ? `<small>JU</small>` : `
          <span>Un solo ERP, una sola web, un solo menu</span>
          <small>${deploymentLabel} &middot; Contabilidad base activa con Operaciones y Comercial registrados</small>
        `}
      </div>
    `;

    const renderedMenu = sidebar.querySelector(".sidebar-groups");
    if (renderedMenu) renderedMenu.scrollTop = sidebarScrollPositions[currentMode];
  }

  function renderTopbar() {
    const topbar = document.querySelector("#topbar");
    const route = BlessERP.state.currentRoute();
    const companyName = state.db.meta?.companyName || "Bless Flower";
    const accountingPeriod = state.db.meta?.accountingPeriod || "Periodo pendiente";
    const activeUser = state.db.session?.activeUser || { name: "Usuario demo", role: "Administrador" };
    const alerts = state.db.session?.alerts || [];
    const matches = routeMatches(state.quickSearch);

    topbar.innerHTML = `
      <div class="topbar-block">
        <p class="eyebrow">ERP JAMES UNICO</p>
        <h1>${esc(route.title)}</h1>
        <span class="topbar-subtitle">${esc(routeContext(route))} · Shell unico y arquitectura modular</span>
      </div>
      <div class="topbar-utility">
        <div class="topbar-pill">
          <strong>${esc(companyName)}</strong>
          <small>Empresa activa</small>
        </div>
        <div class="topbar-pill">
          <strong>${esc(accountingPeriod)}</strong>
          <small>Periodo contable</small>
        </div>
        <div class="quick-search-wrap">
          <label class="quick-search">
            <span>Busqueda rapida</span>
            <input id="quick-search-input" type="search" placeholder="Ir a modulo, area o pantalla..." value="${esc(state.quickSearch)}" autocomplete="off">
          </label>
          <div id="quick-search-results" class="quick-search-results" ${state.quickSearchOpen && matches.length ? "" : "hidden"}>
            ${matches.map(item => `
              <button type="button" class="quick-search-item" data-nav-route="${esc(item.id)}">
                <strong>${esc(item.label)}</strong>
                <span>${esc(routeContext(item))}</span>
              </button>
            `).join("") || `<div class="quick-search-empty">Sin coincidencias</div>`}
          </div>
        </div>
        <button class="topbar-icon-button" type="button" title="Alertas">${alerts.length}</button>
        <div class="user-chip">
          <strong>${esc(activeUser.name)}</strong>
          <small>${esc(activeUser.role)}</small>
        </div>
      </div>
    `;
  }

  function renderPage() {
    const root = document.querySelector("#page-root");
    BlessERP.modules.part2.render(root, state, BlessERP.state.currentRoute());
  }

  function renderApp() {
    const routeId = BlessERP.state.currentRoute().id;
    const routeChanged = lastRenderedRouteId !== null && lastRenderedRouteId !== routeId;
    renderSidebar();
    renderTopbar();
    renderPage();
    if (routeChanged) {
      const workspace = document.querySelector(".workspace-shell");
      if (workspace) workspace.scrollTop = 0;
    }
    lastRenderedRouteId = routeId;
  }

  function bindNavigation() {
    document.querySelector("#sidebar").addEventListener("click", event => {
      const routeButton = event.target.closest("[data-nav-route]");
      if (routeButton) {
        BlessERP.state.setRoute(routeButton.dataset.navRoute);
        renderApp();
        return;
      }
      const toggleSidebar = event.target.closest("[data-toggle-sidebar]");
      if (toggleSidebar) {
        BlessERP.state.toggleSidebar();
        renderApp();
        return;
      }
      const toggleNode = event.target.closest("[data-toggle-menu-node]");
      if (toggleNode) {
        BlessERP.state.toggleMenuNode(toggleNode.dataset.toggleMenuNode);
        renderSidebar();
      }
    });

    document.querySelector("#topbar").addEventListener("click", event => {
      const routeButton = event.target.closest("[data-nav-route]");
      if (!routeButton) return;
      BlessERP.state.setRoute(routeButton.dataset.navRoute);
      renderApp();
    });

    document.querySelector("#topbar").addEventListener("input", event => {
      if (event.target.id !== "quick-search-input") return;
      BlessERP.state.setQuickSearch(event.target.value);
      renderTopbar();
      const input = document.querySelector("#quick-search-input");
      input?.focus();
      if (input) input.selectionStart = input.selectionEnd = input.value.length;
    });

    document.querySelector("#page-root").addEventListener("click", event => {
      const routeButton = event.target.closest("[data-route-link]");
      if (!routeButton) return;
      BlessERP.state.setRoute(routeButton.dataset.routeLink);
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
  function toast(message) {
    const node = document.querySelector("#toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 2400);
  }

  BlessERP.layout = {
    bindNavigation,
    renderApp,
    renderPage,
    toast
  };
})();
