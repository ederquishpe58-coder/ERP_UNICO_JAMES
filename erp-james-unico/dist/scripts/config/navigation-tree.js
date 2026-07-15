(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const MENU_ICONS = {
    core: "CS",
    operations: "OP",
    commercial: "CE",
    administration: "AC",
    "materials-inventory": "IE",
    reports: "RP",
    settings: "CF",
    extensions: "MF"
  };

  const MENU_PERMISSIONS = {
    core: ["*"],
    operations: ["ADMIN", "SOPORTE", "OPERACIONES", "BODEGA"],
    commercial: ["ADMIN", "SOPORTE", "COMERCIAL"],
    administration: ["ADMIN", "SOPORTE", "CONTABILIDAD"],
    "materials-inventory": ["ADMIN", "SOPORTE", "BODEGA", "CONTABILIDAD"],
    reports: ["ADMIN", "SOPORTE", "CONTABILIDAD", "COMERCIAL", "OPERACIONES", "BODEGA"],
    settings: ["ADMIN", "SOPORTE"],
    extensions: ["ADMIN", "SOPORTE"]
  };

  const MENU_SUBFOLDERS = {
    commercial: [
      {
        id: "folder-commercial-orders",
        nombre: "Órdenes / Pedidos",
        icono: "OR",
        orden: 20,
        routes: ["commercial-orders-day", "commercial-order-master", "commercial-order-detail", "commercial-order-history"]
      },
      {
        id: "folder-commercial-documents",
        nombre: "Documentos comerciales",
        icono: "DC",
        orden: 40,
        routes: ["commercial-invoice-packing", "commercial-client-invoice", "commercial-print-center"]
      },
      {
        id: "folder-commercial-administration",
        nombre: "Administración",
        icono: "AD",
        orden: 50,
        routes: ["commercial-customers-brands", "commercial-brands", "commercial-cargo-agencies", "commercial-destinations", "commercial-daes", "commercial-airlines", "commercial-export-products", "commercial-box-types"]
      }
    ]
  };

  const MENU_ROOT_ROUTE_ORDER = {
    "commercial-panel": 10,
    "commercial-availability-reservations": 30,
    "commercial-sri-authorization": 90
  };

  function normalizeRoleTokens(role) {
    const value = String(role || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const roles = new Set();
    if (value.includes("ADMIN")) roles.add("ADMIN");
    if (value.includes("SOPORTE") || value.includes("CREADOR")) roles.add("SOPORTE");
    if (value.includes("CONTAB")) roles.add("CONTABILIDAD");
    if (value.includes("COMERCIAL") || value.includes("VENTA")) roles.add("COMERCIAL");
    if (value.includes("OPERACION") || value.includes("POSCOSECHA")) roles.add("OPERACIONES");
    if (value.includes("BODEGA")) roles.add("BODEGA");
    if (!roles.size) roles.add("INVITADO");
    return [...roles];
  }

  function hasPermission(node, role) {
    const permissions = Array.isArray(node?.permisos) && node.permisos.length
      ? node.permisos
      : [];
    if (permissions.includes("*")) return true;
    const roles = normalizeRoleTokens(role);
    return roles.includes("ADMIN") || permissions.some(permission => roles.includes(String(permission).toUpperCase()));
  }

  function createMenuRecordsFromLegacyNavigation(navigation) {
    const records = [];
    navigation.menuGroups.forEach((menuGroup, menuIndex) => {
      const rootId = `menu-${menuGroup.id}`;
      const permissions = MENU_PERMISSIONS[menuGroup.id] || ["ADMIN"];
      records.push({
        id: rootId,
        parentId: null,
        orden: (menuIndex + 1) * 10,
        icono: MENU_ICONS[menuGroup.id] || menuGroup.shortLabel || "MN",
        nombre: menuGroup.label,
        ruta: menuGroup.defaultRoute || null,
        tipo: "carpeta",
        permisos: permissions,
        activo: true,
        metadata: { menuId: menuGroup.id, source: "LOCAL_CONFIG" }
      });

      const sections = menuGroup.groupIds
        .map(groupId => navigation.groupMap[groupId])
        .filter(Boolean);
      const needsSectionFolders = sections.length > 1;

      sections.forEach((section, sectionIndex) => {
        const parentId = needsSectionFolders ? `group-${section.id}` : rootId;
        if (needsSectionFolders) {
          records.push({
            id: parentId,
            parentId: rootId,
            orden: (sectionIndex + 1) * 10,
            icono: section.shortLabel || "AR",
            nombre: section.label,
            ruta: section.defaultRoute || null,
            tipo: "carpeta",
            permisos: permissions,
            activo: true,
            metadata: { groupId: section.id, source: "LOCAL_CONFIG" }
          });
        }

        const subfolders = MENU_SUBFOLDERS[menuGroup.id] || [];
        const routeFolderMap = new Map();
        subfolders.forEach(folder => {
          records.push({
            id: folder.id,
            parentId,
            orden: folder.orden,
            icono: folder.icono,
            nombre: folder.nombre,
            ruta: null,
            tipo: "carpeta",
            permisos: permissions,
            activo: true,
            metadata: { groupId: section.id, menuId: menuGroup.id, source: "LOCAL_CONFIG" }
          });
          folder.routes.forEach(routeId => routeFolderMap.set(routeId, folder.id));
        });

        section.routes.forEach((route, routeIndex) => {
          const routeParentId = routeFolderMap.get(route.id) || parentId;
          records.push({
            id: `page-${route.id}`,
            parentId: routeParentId,
            orden: MENU_ROOT_ROUTE_ORDER[route.id] || (routeIndex + 1) * 10,
            icono: route.future ? "FT" : "PG",
            nombre: route.label,
            ruta: route.id,
            tipo: "pagina",
            permisos: permissions,
            activo: true,
            metadata: {
              groupId: section.id,
              menuId: menuGroup.id,
              future: Boolean(route.future),
              status: route.status,
              source: "LOCAL_CONFIG"
            }
          });
        });
      });
    });
    return records;
  }

  function validateMenuRecords(records) {
    const errors = [];
    const warnings = [];
    const items = Array.isArray(records) ? records : [];
    const map = new Map();
    const requiredFields = ["id", "orden", "icono", "nombre", "tipo", "permisos"];

    items.forEach((item, index) => {
      const missing = requiredFields.filter(field => item?.[field] === undefined || item?.[field] === null);
      if (missing.length) errors.push(`Nodo ${index + 1} sin campos: ${missing.join(", ")}`);
      if (map.has(item?.id)) errors.push(`Id de menu duplicado: ${item.id}`);
      if (item?.id) map.set(item.id, item);
      if (!['carpeta', 'pagina'].includes(item?.tipo)) errors.push(`Tipo invalido en ${item?.id || index}: ${item?.tipo}`);
      if (item?.tipo === "pagina" && !item?.ruta) errors.push(`Pagina sin ruta: ${item?.id || index}`);
      if (!Array.isArray(item?.permisos) || !item.permisos.length) errors.push(`Nodo sin permisos por rol: ${item?.id || index}`);
      if (!Number.isFinite(Number(item?.orden))) errors.push(`Orden invalido: ${item?.id || index}`);
    });

    items.forEach(item => {
      if (item.parentId && !map.has(item.parentId)) errors.push(`ParentId inexistente: ${item.id} -> ${item.parentId}`);
      const parent = item.parentId ? map.get(item.parentId) : null;
      if (parent && parent.tipo !== "carpeta") errors.push(`El padre de ${item.id} no es carpeta: ${parent.id}`);
    });

    items.forEach(item => {
      const visited = new Set([item.id]);
      let current = item;
      while (current?.parentId) {
        if (visited.has(current.parentId)) {
          errors.push(`Ciclo detectado desde ${item.id}`);
          break;
        }
        visited.add(current.parentId);
        current = map.get(current.parentId);
      }
    });

    if (!items.some(item => item.parentId === null)) warnings.push("El menu no contiene nodos raiz.");
    return { valid: errors.length === 0, errors: [...new Set(errors)], warnings };
  }

  function buildMenuTree(records, role) {
    const report = validateMenuRecords(records);
    if (!report.valid) return { tree: [], report };

    const children = new Map();
    records.filter(item => item.activo !== false).forEach(item => {
      const key = item.parentId || null;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(item);
    });
    children.forEach(list => list.sort((a, b) => Number(a.orden) - Number(b.orden) || a.nombre.localeCompare(b.nombre)));

    function visit(parentId, depth) {
      return (children.get(parentId) || []).map(item => {
        const childNodes = visit(item.id, depth + 1);
        if (!hasPermission(item, role) && !childNodes.length) return null;
        return { ...item, depth, children: childNodes };
      }).filter(Boolean);
    }

    return { tree: visit(null, 0), report };
  }

  function flattenTree(tree) {
    const result = [];
    (tree || []).forEach(node => {
      result.push(node);
      result.push(...flattenTree(node.children));
    });
    return result;
  }

  function findNodeByRoute(tree, routeId) {
    return flattenTree(tree).find(node => node.tipo === "pagina" && node.ruta === routeId) || null;
  }

  function getFirstPage(node) {
    if (!node) return null;
    if (node.tipo === "pagina") return node;
    for (const child of node.children || []) {
      const page = getFirstPage(child);
      if (page) return page;
    }
    return null;
  }

  function getAncestorIds(records, nodeId) {
    const map = new Map((records || []).map(item => [item.id, item]));
    const ancestors = [];
    let current = map.get(nodeId);
    while (current?.parentId && map.has(current.parentId)) {
      ancestors.unshift(current.parentId);
      current = map.get(current.parentId);
    }
    return ancestors;
  }

  BlessERP.navigationTree = {
    buildMenuTree,
    createMenuRecordsFromLegacyNavigation,
    findNodeByRoute,
    flattenTree,
    getAncestorIds,
    getFirstPage,
    hasPermission,
    normalizeRoleTokens,
    validateMenuRecords
  };
})();
