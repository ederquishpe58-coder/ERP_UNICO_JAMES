(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;
  const journalService = BlessERP.services.journal;
  const adminService = BlessERP.services.adminConfig;

  const itemCategories = [
    "MATERIAL_EMPAQUE",
    "SUMINISTRO",
    "QUIMICO",
    "FERTILIZANTE",
    "HERRAMIENTA",
    "MATERIAL_BODEGA",
    "OTRO"
  ];
  const itemSubcategories = [
    "carton",
    "separador",
    "liga",
    "capuchon",
    "etiqueta",
    "funda",
    "papel",
    "quimico",
    "fertilizante",
    "herramienta",
    "otro"
  ];
  const itemUnits = ["unidad", "paquete", "kilo", "litro", "caja", "rollo", "funda", "galon", "otro"];
  const warehouseStates = ["activo", "inactivo"];
  const movementTypes = [
    "ENTRADA_COMPRA",
    "ENTRADA_AJUSTE",
    "SALIDA_CONSUMO",
    "SALIDA_PROVEEDOR",
    "SALIDA_EMPAQUE",
    "SALIDA_CAMPO",
    "AJUSTE_POSITIVO",
    "AJUSTE_NEGATIVO",
    "TRANSFERENCIA_BODEGA",
    "ANULACION"
  ];
  const movementStates = ["BORRADOR", "CONFIRMADO", "ANULADO"];
  const movementOrigins = ["manual", "compras", "consumo", "ajuste", "transferencia"];
  const responsibleStates = ["activo", "inactivo"];
  const consumptionTypes = [
    "Consumo empaque",
    "Consumo campo",
    "Consumo administracion",
    "Consumo mantenimiento",
    "Entrega a proveedor",
    "Otro consumo"
  ];

  const categoryLabels = {
    MATERIAL_EMPAQUE: "Material de empaque",
    SUMINISTRO: "Suministro",
    QUIMICO: "Quimico",
    FERTILIZANTE: "Fertilizante",
    HERRAMIENTA: "Herramienta",
    MATERIAL_BODEGA: "Material de bodega",
    OTRO: "Otro"
  };
  const movementTypeLabels = {
    ENTRADA_COMPRA: "Entrada por compra",
    ENTRADA_AJUSTE: "Entrada por ajuste",
    SALIDA_CONSUMO: "Salida por consumo",
    SALIDA_PROVEEDOR: "Salida a proveedor",
    SALIDA_EMPAQUE: "Salida a empaque",
    SALIDA_CAMPO: "Salida a campo",
    AJUSTE_POSITIVO: "Ajuste positivo",
    AJUSTE_NEGATIVO: "Ajuste negativo",
    TRANSFERENCIA_BODEGA: "Transferencia entre bodegas",
    ANULACION: "Anulacion"
  };

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function currentUser() {
    return adminService?.activeUser?.() || stateApi.state.db.session?.activeUser || { id: "demo", name: "Usuario demo", role: "Administrador" };
  }

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function saveList(key, rows) {
    stateApi.state.db[key] = rows;
    stateApi.saveDb();
  }

  function nextWarehouseCode() {
    const max = cloneList("inventoryWarehouses").reduce((acc, item) => {
      const numeric = Number(String(item.code || "").replace(/\D/g, "") || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `BOD-${String(max + 1).padStart(3, "0")}`;
  }

  function nextMovementNumber() {
    const rows = cloneList("inventoryMovements");
    const year = companyService.settings().activePeriod?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.movementNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `INV-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function suggestInventoryAccountCode(category) {
    const defaults = companyService.settings().defaultAccounts || {};
    return category === "MATERIAL_EMPAQUE"
      ? (defaults.packagingInventory || "")
      : (defaults.suppliesInventory || "");
  }

  function suggestExpenseAccountCode(category) {
    const defaults = companyService.settings().defaultAccounts || {};
    return category === "MATERIAL_EMPAQUE"
      ? (defaults.packagingCost || "")
      : (defaults.suppliesExpenseCost || "");
  }

  function requiresTraceability(category) {
    return ["QUIMICO", "FERTILIZANTE"].includes(String(category || "").toUpperCase());
  }

  function defaultSubcategoryByCategory(category) {
    switch (category) {
      case "MATERIAL_EMPAQUE": return "carton";
      case "QUIMICO": return "quimico";
      case "FERTILIZANTE": return "fertilizante";
      case "HERRAMIENTA": return "herramienta";
      case "MATERIAL_BODEGA": return "otro";
      case "SUMINISTRO": return "otro";
      default: return "otro";
    }
  }

  function inferCategoryFromPurchaseLine(line = {}, purchase = {}) {
    const purchaseType = String(purchase.purchaseType || "").toUpperCase();
    const lineType = normalizeText(line.lineType || "");
    const text = normalizeText(`${line.productCode || ""} ${line.description || ""}`);
    if (purchaseType === "INVENTARIO_EMPAQUE" || lineType.includes("empaque") || text.includes("caja") || text.includes("carton") || text.includes("separador") || text.includes("liga") || text.includes("capuchon") || text.includes("etiqueta")) {
      return "MATERIAL_EMPAQUE";
    }
    if (purchaseType === "AGRICOLA" || lineType.includes("fertilizante") || text.includes("fertilizante")) {
      return "FERTILIZANTE";
    }
    if (lineType.includes("quimico") || text.includes("quimico") || text.includes("regulador")) {
      return "QUIMICO";
    }
    if (lineType.includes("herramienta") || text.includes("herramienta")) {
      return "HERRAMIENTA";
    }
    if (purchaseType === "INVENTARIO_SUMINISTROS" || lineType.includes("suministro") || text.includes("papel") || text.includes("funda") || text.includes("bodega")) {
      return "SUMINISTRO";
    }
    return "OTRO";
  }

  function inferSubcategoryFromLine(line = {}, category = "OTRO") {
    const text = normalizeText(`${line.productCode || ""} ${line.description || ""}`);
    if (text.includes("caja") || text.includes("carton")) return "carton";
    if (text.includes("separador")) return "separador";
    if (text.includes("liga")) return "liga";
    if (text.includes("capuchon")) return "capuchon";
    if (text.includes("etiqueta")) return "etiqueta";
    if (text.includes("funda")) return "funda";
    if (text.includes("papel")) return "papel";
    if (text.includes("quimico") || text.includes("regulador")) return "quimico";
    if (text.includes("fertilizante")) return "fertilizante";
    if (text.includes("herramienta")) return "herramienta";
    return defaultSubcategoryByCategory(category);
  }

  function inferUnitFromCategory(category = "OTRO", subcategory = "otro") {
    if (subcategory === "etiqueta") return "rollo";
    if (["QUIMICO"].includes(String(category || "").toUpperCase())) return "litro";
    if (["FERTILIZANTE"].includes(String(category || "").toUpperCase())) return "kilo";
    return "unidad";
  }

  function trackedPurchaseType(code = "") {
    return [
      "INVENTARIO_SUMINISTROS",
      "INVENTARIO_EMPAQUE",
      "MATERIAL_EMPAQUE",
      "SUMINISTRO",
      "QUIMICO",
      "FERTILIZANTE",
      "HERRAMIENTA",
      "MATERIAL_BODEGA",
      "AGRICOLA"
    ].includes(String(code || "").toUpperCase());
  }

  function inventoryLineMatches(line = {}, purchase = {}, typeConfig = null) {
    const purchaseType = String(purchase.purchaseType || "").toUpperCase();
    const lineType = normalizeText(line.lineType || "");
    const text = normalizeText(`${line.productCode || ""} ${line.description || ""}`);
    return trackedPurchaseType(purchaseType)
      || Boolean(typeConfig?.affectsInventory)
      || lineType.includes("inventario")
      || lineType.includes("empaque")
      || lineType.includes("suministro")
      || lineType.includes("quimico")
      || lineType.includes("fertilizante")
      || lineType.includes("herramienta")
      || lineType.includes("material")
      || text.includes("caja")
      || text.includes("carton")
      || text.includes("separador")
      || text.includes("liga")
      || text.includes("capuchon")
      || text.includes("etiqueta")
      || text.includes("funda")
      || text.includes("papel")
      || text.includes("quimico")
      || text.includes("fertilizante");
  }

  function normalizeWarehouse(raw = {}) {
    const current = clone(raw || {});
    return {
      id: current.id || uid("BOD"),
      code: String(current.code || nextWarehouseCode()).trim().toUpperCase(),
      name: String(current.name || "").trim(),
      responsible: String(current.responsible || "").trim(),
      status: warehouseStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "activo",
      observation: String(current.observation || "").trim()
    };
  }

  function warehouses(filters = {}) {
    return cloneList("inventoryWarehouses")
      .map(normalizeWarehouse)
      .filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.search) {
          const haystack = [item.code, item.name, item.responsible].join(" ").toLowerCase();
          if (!haystack.includes(String(filters.search || "").toLowerCase())) return false;
        }
        return true;
      });
  }

  function findWarehouseById(warehouseId) {
    return warehouses().find(item => item.id === warehouseId);
  }

  function defaultResponsibles() {
    const visualUsers = adminService?.visualUsers?.() || [];
    const preferred = [
      { code: "BOD-001", name: "Usuario Bodega", role: "Responsable bodega", area: "Bodega" },
      { code: "ADM-001", name: "James Lanchimba", role: "Administrador / Contador", area: "Administracion / Contabilidad" },
      { code: "SUP-001", name: "Eder Lenin Quishpe", role: "Co-creador / Soporte", area: "Tecnologia / Soporte" }
    ];
    const rows = preferred.map(base => {
      const match = visualUsers.find(user => String(user.name || "").toLowerCase() === String(base.name).toLowerCase());
      return {
        id: match?.id || uid("RSP"),
        code: base.code,
        name: match?.name || base.name,
        role: match?.cargo || base.role,
        area: match?.area || base.area,
        warehouseId: "",
        warehouseName: "",
        status: "activo",
        observation: ""
      };
    });
    if (!rows.length) {
      rows.push({
        id: uid("RSP"),
        code: "BOD-001",
        name: "Responsable bodega",
        role: "Bodeguero",
        area: "Bodega",
        warehouseId: "",
        warehouseName: "",
        status: "activo",
        observation: ""
      });
    }
    return rows;
  }

  function normalizeResponsible(raw = {}) {
    const current = clone(raw || {});
    const warehouse = current.warehouseId ? findWarehouseById(String(current.warehouseId || "").trim()) : null;
    return {
      id: current.id || uid("RSP"),
      code: String(current.code || `RSP-${String((stateApi.state.db.inventoryResponsibles || []).length + 1).padStart(3, "0")}`).trim().toUpperCase(),
      name: String(current.name || "").trim(),
      role: String(current.role || "").trim(),
      area: String(current.area || "").trim(),
      warehouseId: String(current.warehouseId || "").trim(),
      warehouseName: warehouse?.name || "",
      status: responsibleStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "activo",
      observation: String(current.observation || "").trim()
    };
  }

  function responsibles(filters = {}) {
    if (!Array.isArray(stateApi.state.db.inventoryResponsibles) || !stateApi.state.db.inventoryResponsibles.length) {
      stateApi.state.db.inventoryResponsibles = defaultResponsibles();
      stateApi.saveDb();
    }
    return clone(stateApi.state.db.inventoryResponsibles || [])
      .map(normalizeResponsible)
      .filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.warehouseId && item.warehouseId !== filters.warehouseId) return false;
        if (filters.search) {
          const haystack = [item.code, item.name, item.role, item.area].join(" ").toLowerCase();
          if (!haystack.includes(String(filters.search || "").toLowerCase())) return false;
        }
        return true;
      });
  }

  function findResponsibleById(responsibleId) {
    return responsibles().find(item => item.id === responsibleId);
  }

  function emptyResponsible() {
    return {
      id: "",
      code: `RSP-${String(responsibles().length + 1).padStart(3, "0")}`,
      name: "",
      role: "",
      area: "",
      warehouseId: defaultWarehouse()?.id || "",
      status: "activo",
      observation: ""
    };
  }

  function saveResponsible(responsible) {
    const candidate = normalizeResponsible(responsible);
    const rows = responsibles();
    const errors = [];
    if (!candidate.code) errors.push("El codigo del responsable es obligatorio.");
    if (!candidate.name) errors.push("El nombre del responsable es obligatorio.");
    const duplicate = rows.find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicate) errors.push("No se permite codigo de responsable duplicado.");
    if (candidate.warehouseId && !findWarehouseById(candidate.warehouseId)) errors.push("La bodega del responsable no existe.");
    if (errors.length) return { ok: false, errors };
    const index = rows.findIndex(item => item.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("inventoryResponsibles", rows);
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: index >= 0 ? "EDITAR_RESPONSABLE_INVENTARIO" : "CREAR_RESPONSABLE_INVENTARIO",
      entityType: "inventory_responsible",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.name,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el responsable ${candidate.code}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, responsible: clone(candidate) };
  }

  function defaultWarehouse() {
    return warehouses({ status: "activo" })[0] || warehouses()[0] || null;
  }

  function emptyWarehouse() {
    return {
      id: "",
      code: nextWarehouseCode(),
      name: "",
      responsible: currentUser().name,
      status: "activo",
      observation: ""
    };
  }

  function saveWarehouse(warehouse) {
    const candidate = normalizeWarehouse(warehouse);
    const rows = warehouses();
    const errors = [];
    if (!candidate.code) errors.push("El codigo de bodega es obligatorio.");
    if (!candidate.name) errors.push("El nombre de bodega es obligatorio.");
    const duplicate = rows.find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicate) errors.push("No se permite codigo de bodega duplicado.");
    if (errors.length) return { ok: false, errors };
    const index = rows.findIndex(item => item.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("inventoryWarehouses", rows);
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: index >= 0 ? "EDITAR_BODEGA" : "CREAR_BODEGA",
      entityType: "warehouse",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.name,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} la bodega ${candidate.code}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, warehouse: clone(candidate) };
  }

  function toggleWarehouseStatus(warehouseId) {
    const rows = warehouses();
    const index = rows.findIndex(item => item.id === warehouseId);
    if (index < 0) return { ok: false, message: "Bodega no encontrada." };
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    saveList("inventoryWarehouses", rows);
    return { ok: true, warehouse: clone(rows[index]) };
  }

  function normalizeItem(raw = {}) {
    const current = clone(raw || {});
    const category = itemCategories.includes(String(current.category || "").toUpperCase())
      ? String(current.category || "").toUpperCase()
      : "SUMINISTRO";
    const inventoryAccountCode = String(current.inventoryAccountCode || suggestInventoryAccountCode(category)).trim();
    const expenseAccountCode = String(current.expenseAccountCode || suggestExpenseAccountCode(category)).trim();
    const defaultCostCenter = String(current.defaultCostCenter || "").trim().toUpperCase();
    const defaultResponsibleId = String(current.defaultResponsibleId || "").trim();
    const defaultResponsible = defaultResponsibleId ? findResponsibleById(defaultResponsibleId) : null;
    return {
      id: current.id || uid("ITM"),
      code: String(current.code || "").trim().toUpperCase(),
      barcode: String(current.barcode || "").trim(),
      name: String(current.name || "").trim(),
      category,
      subcategory: itemSubcategories.includes(String(current.subcategory || "").toLowerCase())
        ? String(current.subcategory || "").toLowerCase()
        : defaultSubcategoryByCategory(category),
      unit: itemUnits.includes(String(current.unit || "").toLowerCase()) ? String(current.unit || "").toLowerCase() : "unidad",
      inventoryAccountCode,
      inventoryAccountName: chartService.findByCode(inventoryAccountCode)?.name || "",
      expenseAccountCode,
      expenseAccountName: chartService.findByCode(expenseAccountCode)?.name || "",
      minStock: round2(current.minStock || 0),
      maxStock: round2(current.maxStock || 0),
      warehouseId: String(current.warehouseId || defaultWarehouse()?.id || "").trim(),
      warehouseName: findWarehouseById(String(current.warehouseId || defaultWarehouse()?.id || "").trim())?.name || "",
      defaultCostCenter,
      requiresCostCenter: Boolean(current.requiresCostCenter || defaultCostCenter),
      defaultResponsibleId,
      defaultResponsibleName: defaultResponsible?.name || String(current.defaultResponsibleName || "").trim(),
      requiresLot: current.requiresLot === undefined ? requiresTraceability(category) : Boolean(current.requiresLot),
      requiresExpiry: current.requiresExpiry === undefined ? requiresTraceability(category) : Boolean(current.requiresExpiry),
      status: String(current.status || "activo").toLowerCase() === "inactivo" ? "inactivo" : "activo",
      observation: String(current.observation || "").trim()
    };
  }

  function items(filters = {}) {
    return cloneList("inventoryItems")
      .map(normalizeItem)
      .filter(item => {
        if (filters.category) {
          const categories = Array.isArray(filters.category) ? filters.category : [filters.category];
          if (!categories.includes(item.category)) return false;
        }
        if (filters.status && item.status !== filters.status) return false;
        if (filters.warehouseId && item.warehouseId !== filters.warehouseId) return false;
        if (filters.search) {
          const haystack = [item.code, item.name, item.category, item.subcategory].join(" ").toLowerCase();
          if (!haystack.includes(String(filters.search || "").toLowerCase())) return false;
        }
        return true;
      });
  }

  function findItemById(itemId) {
    return items().find(item => item.id === itemId);
  }

  function findItemByCode(code) {
    return items().find(item => item.code === String(code || "").trim().toUpperCase());
  }

  function findItemForPurchaseLine(line = {}) {
    const byCode = line.productCode ? findItemByCode(line.productCode) : null;
    if (byCode) return byCode;
    const normalizedLine = normalizeText(line.description);
    return items().find(item => normalizeText(item.name) === normalizedLine) || null;
  }

  function validateMovementAccount(code, label) {
    const account = code ? chartService.findByCode(code) : null;
    const errors = [];
    if (!code) errors.push(`Debe seleccionar ${label}.`);
    else if (!account) errors.push(`${label} no existe.`);
    else {
      if (account.status !== "Activa") errors.push(`${label} esta inactiva.`);
      if (!account.isMovement) errors.push(`${label} debe ser de movimiento.`);
    }
    return { account, errors };
  }

  function saveItem(item) {
    const candidate = normalizeItem(item);
    const rows = items();
    const errors = [];
    if (!candidate.code) errors.push("El codigo interno es obligatorio.");
    if (!candidate.name) errors.push("El nombre del producto es obligatorio.");
    const duplicate = rows.find(entry => entry.id !== candidate.id && entry.code === candidate.code);
    if (duplicate) errors.push("No se permite codigo interno duplicado.");
    if (candidate.warehouseId && !findWarehouseById(candidate.warehouseId)) errors.push("La bodega seleccionada no existe.");
    if (candidate.defaultCostCenter) {
      const availableCostCenters = adminService?.costCenters?.({ status: "activo" }) || [];
      if (!availableCostCenters.some(item => item.code === candidate.defaultCostCenter)) {
        errors.push("El centro de costo predeterminado no existe o esta inactivo.");
      }
    }
    if (candidate.defaultResponsibleId) {
      const responsible = findResponsibleById(candidate.defaultResponsibleId);
      if (!responsible || responsible.status !== "activo") {
        errors.push("El responsable predeterminado no existe o esta inactivo.");
      }
    }
    errors.push(...validateMovementAccount(candidate.inventoryAccountCode, "la cuenta contable de inventario").errors);
    errors.push(...validateMovementAccount(candidate.expenseAccountCode, "la cuenta contable de consumo / gasto / costo").errors);
    if (errors.length) return { ok: false, errors: [...new Set(errors)] };
    const index = rows.findIndex(entry => entry.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("inventoryItems", rows);
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: index >= 0 ? "EDITAR_ITEM_INVENTARIO" : "CREAR_ITEM_INVENTARIO",
      entityType: "inventory_item",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.name,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el item ${candidate.code}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, item: clone(candidate) };
  }

  function toggleItemStatus(itemId) {
    const rows = items();
    const index = rows.findIndex(item => item.id === itemId);
    if (index < 0) return { ok: false, message: "Producto no encontrado." };
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    saveList("inventoryItems", rows);
    return { ok: true, item: clone(rows[index]) };
  }

  function draftItemFromPurchaseLine(purchaseId, lineId) {
    const purchaseService = BlessERP.services.purchases;
    const purchase = purchaseService?.purchases().find(item => item.id === purchaseId);
    const line = purchase?.lines?.find(item => item.id === lineId);
    if (!purchase || !line) return null;
    const category = inferCategoryFromPurchaseLine(line, purchase);
    return normalizeItem({
      code: String(line.productCode || "").trim().toUpperCase() || "",
      name: line.description || "",
      category,
      subcategory: inferSubcategoryFromLine(line, category),
      unit: inferUnitFromCategory(category, inferSubcategoryFromLine(line, category)),
      warehouseId: defaultWarehouse()?.id || "",
      requiresLot: requiresTraceability(category),
      requiresExpiry: requiresTraceability(category),
      inventoryAccountCode: suggestInventoryAccountCode(category),
      expenseAccountCode: suggestExpenseAccountCode(category),
      defaultCostCenter: "",
      requiresCostCenter: false,
      defaultResponsibleId: "",
      minStock: 0,
      maxStock: 0
    });
  }

  function createItemFromPurchaseLine(purchaseId, lineId) {
    const draft = draftItemFromPurchaseLine(purchaseId, lineId);
    if (!draft) return { ok: false, errors: ["No se pudo preparar el item desde la compra seleccionada."] };
    if (!draft.code) {
      const autoCode = `INS-${String(items().length + 1).padStart(4, "0")}`;
      draft.code = autoCode;
    }
    return saveItem(draft);
  }

  function emptyMovementLine() {
    return {
      id: uid("MVL"),
      itemId: "",
      itemCode: "",
      itemName: "",
      description: "",
      quantity: 1,
      unit: "unidad",
      costUnit: 0,
      costTotal: 0,
      lot: "",
      expiryDate: "",
      inventoryAccountCode: "",
      inventoryAccountName: "",
      expenseAccountCode: "",
      expenseAccountName: "",
      costCenter: "",
      observation: "",
      sourcePurchaseId: "",
      sourceLineId: "",
      sourceLineNumber: "",
      sourceLineDescription: "",
      warehouseId: "",
      warehouseName: ""
    };
  }

  function normalizeMovementLine(raw = {}) {
    const current = { ...emptyMovementLine(), ...clone(raw || {}) };
    const item = current.itemId ? findItemById(current.itemId) : findItemByCode(current.itemCode);
    const quantity = round2(current.quantity || 0);
    const costUnit = round2(current.costUnit || 0);
    const costTotal = round2(current.costTotal || (quantity * costUnit));
    const inventoryAccountCode = String(current.inventoryAccountCode || item?.inventoryAccountCode || "").trim();
    const expenseAccountCode = String(current.expenseAccountCode || item?.expenseAccountCode || "").trim();
    return {
      id: current.id || uid("MVL"),
      itemId: item?.id || String(current.itemId || "").trim(),
      itemCode: item?.code || String(current.itemCode || "").trim().toUpperCase(),
      itemName: item?.name || String(current.itemName || "").trim(),
      description: String(current.description || item?.name || "").trim(),
      quantity,
      unit: item?.unit || String(current.unit || "unidad").trim().toLowerCase(),
      costUnit,
      costTotal,
      lot: String(current.lot || "").trim(),
      expiryDate: String(current.expiryDate || "").trim(),
      inventoryAccountCode,
      inventoryAccountName: chartService.findByCode(inventoryAccountCode)?.name || current.inventoryAccountName || "",
      expenseAccountCode,
      expenseAccountName: chartService.findByCode(expenseAccountCode)?.name || current.expenseAccountName || "",
      costCenter: String(current.costCenter || "").trim(),
      observation: String(current.observation || "").trim(),
      sourcePurchaseId: String(current.sourcePurchaseId || "").trim(),
      sourceLineId: String(current.sourceLineId || "").trim(),
      sourceLineNumber: String(current.sourceLineNumber || "").trim(),
      sourceLineDescription: String(current.sourceLineDescription || current.description || "").trim(),
      warehouseId: String(current.warehouseId || "").trim(),
      warehouseName: String(current.warehouseName || findWarehouseById(String(current.warehouseId || "").trim())?.name || "").trim()
    };
  }

  function emptyMovement(type = "SALIDA_CONSUMO") {
    const warehouse = defaultWarehouse();
    return {
      id: "",
      movementNumber: nextMovementNumber(),
      movementDate: today(),
      movementType: movementTypes.includes(type) ? type : "SALIDA_CONSUMO",
      warehouseFromId: warehouse?.id || "",
      warehouseToId: "",
      responsible: currentUser().name,
      documentOrigin: "",
      originModule: "manual",
      sourceType: "manual",
      supportMode: "manual",
      purchaseId: "",
      purchaseDocumentNumber: "",
      purchaseAuthorization: "",
      purchaseAccessKey: "",
      supplierRuc: "",
      supplierDocumentType: "",
      status: "BORRADOR",
      observation: "",
      costCenter: "",
      counterAccountCode: "",
      counterAccountName: "",
      supplierId: "",
      supplierName: "",
      settlementStatus: "pendiente de descontar",
      journalEntryId: "",
      journalEntryNumber: "",
      reverseEntryId: "",
      reverseEntryNumber: "",
      lines: [emptyMovementLine()]
    };
  }

  function normalizeMovement(raw = {}) {
    const current = { ...emptyMovement(raw.movementType), ...clone(raw || {}) };
    const fromWarehouse = current.warehouseFromId ? findWarehouseById(current.warehouseFromId) : null;
    const toWarehouse = current.warehouseToId ? findWarehouseById(current.warehouseToId) : null;
    const counterAccountCode = String(current.counterAccountCode || "").trim();
    return {
      id: current.id || uid("MOV"),
      movementNumber: String(current.movementNumber || nextMovementNumber()).trim(),
      movementDate: String(current.movementDate || today()).trim(),
      movementType: movementTypes.includes(String(current.movementType || "").trim().toUpperCase())
        ? String(current.movementType || "").trim().toUpperCase()
        : "SALIDA_CONSUMO",
      warehouseFromId: String(current.warehouseFromId || "").trim(),
      warehouseFromName: fromWarehouse?.name || "",
      warehouseToId: String(current.warehouseToId || "").trim(),
      warehouseToName: toWarehouse?.name || "",
      responsible: String(current.responsible || currentUser().name).trim(),
      documentOrigin: String(current.documentOrigin || "").trim(),
      originModule: movementOrigins.includes(String(current.originModule || "").toLowerCase()) ? String(current.originModule || "").toLowerCase() : "manual",
      sourceType: String(current.sourceType || (String(current.originModule || "").toLowerCase() === "compras" ? "compra" : "manual")).trim().toLowerCase(),
      supportMode: String(current.supportMode || (String(current.originModule || "").toLowerCase() === "compras" ? "automatico" : "manual")).trim().toLowerCase(),
      purchaseId: String(current.purchaseId || "").trim(),
      purchaseDocumentNumber: String(current.purchaseDocumentNumber || current.documentOrigin || "").trim(),
      purchaseAuthorization: String(current.purchaseAuthorization || "").trim(),
      purchaseAccessKey: String(current.purchaseAccessKey || "").trim(),
      supplierRuc: String(current.supplierRuc || "").trim(),
      supplierDocumentType: String(current.supplierDocumentType || "").trim(),
      status: movementStates.includes(String(current.status || "").trim().toUpperCase()) ? String(current.status || "").trim().toUpperCase() : "BORRADOR",
      observation: String(current.observation || "").trim(),
      costCenter: String(current.costCenter || "").trim(),
      counterAccountCode,
      counterAccountName: chartService.findByCode(counterAccountCode)?.name || current.counterAccountName || "",
      supplierId: String(current.supplierId || "").trim(),
      supplierName: String(current.supplierName || "").trim(),
      settlementStatus: String(current.settlementStatus || "pendiente de descontar").trim().toLowerCase(),
      journalEntryId: String(current.journalEntryId || "").trim(),
      journalEntryNumber: String(current.journalEntryNumber || "").trim(),
      reverseEntryId: String(current.reverseEntryId || "").trim(),
      reverseEntryNumber: String(current.reverseEntryNumber || "").trim(),
      lines: (current.lines || []).map(normalizeMovementLine)
    };
  }

  function sortMovements(rows = []) {
    return [...rows].sort((a, b) => `${b.movementDate}|${b.movementNumber}`.localeCompare(`${a.movementDate}|${a.movementNumber}`, "es"));
  }

  function movements(filters = {}) {
    return sortMovements(cloneList("inventoryMovements").map(normalizeMovement)).filter(item => {
      if (filters.status && item.status !== filters.status) return false;
      if (filters.movementType) {
        const types = Array.isArray(filters.movementType) ? filters.movementType : [filters.movementType];
        if (!types.includes(item.movementType)) return false;
      }
      if (filters.originModule && item.originModule !== filters.originModule) return false;
      if (filters.dateFrom && item.movementDate < filters.dateFrom) return false;
      if (filters.dateTo && item.movementDate > filters.dateTo) return false;
      if (filters.warehouseId && item.warehouseFromId !== filters.warehouseId && item.warehouseToId !== filters.warehouseId) return false;
      if (filters.productId && !item.lines.some(line => line.itemId === filters.productId)) return false;
      if (filters.category && !item.lines.some(line => {
        const product = findItemById(line.itemId);
        return product?.category === filters.category;
      })) return false;
      if (filters.search) {
        const haystack = [
          item.movementNumber,
          item.documentOrigin,
          item.observation,
          item.responsible,
          item.supplierName,
          ...item.lines.map(line => `${line.itemCode} ${line.itemName} ${line.description}`)
        ].join(" ").toLowerCase();
        if (!haystack.includes(String(filters.search || "").toLowerCase())) return false;
      }
      return true;
    });
  }

  function findMovementById(movementId) {
    return movements().find(item => item.id === movementId);
  }

  function isEntryMovement(type) {
    return ["ENTRADA_COMPRA", "ENTRADA_AJUSTE", "AJUSTE_POSITIVO"].includes(type);
  }

  function isExitMovement(type) {
    return ["SALIDA_CONSUMO", "SALIDA_PROVEEDOR", "SALIDA_EMPAQUE", "SALIDA_CAMPO", "AJUSTE_NEGATIVO"].includes(type);
  }

  function touchesJournal(type) {
    return ["SALIDA_CONSUMO", "SALIDA_PROVEEDOR", "SALIDA_EMPAQUE", "SALIDA_CAMPO", "AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "ENTRADA_AJUSTE"].includes(type);
  }

  function stockBalanceByItemWarehouse(itemId, warehouseId) {
    return movements({ status: "CONFIRMADO" }).reduce((acc, movement) => {
      movement.lines.forEach(line => {
        if (line.itemId !== itemId) return;
        if (movement.movementType === "TRANSFERENCIA_BODEGA") {
          if (movement.warehouseFromId === warehouseId) {
            acc.quantity = round2(acc.quantity - line.quantity);
            acc.value = round2(acc.value - line.costTotal);
          }
          if (movement.warehouseToId === warehouseId) {
            acc.quantity = round2(acc.quantity + line.quantity);
            acc.value = round2(acc.value + line.costTotal);
          }
          return;
        }
        const targetWarehouse = movement.warehouseToId || movement.warehouseFromId;
        if (targetWarehouse !== warehouseId) return;
        if (isEntryMovement(movement.movementType)) {
          acc.quantity = round2(acc.quantity + line.quantity);
          acc.value = round2(acc.value + line.costTotal);
        } else if (isExitMovement(movement.movementType)) {
          acc.quantity = round2(acc.quantity - line.quantity);
          acc.value = round2(acc.value - line.costTotal);
        }
      });
      return acc;
    }, { quantity: 0, value: 0 });
  }

  function validateMovement(movement, { forConfirm = false } = {}) {
    const candidate = normalizeMovement(movement);
    const errors = [];

    if (!candidate.movementDate) errors.push("La fecha del movimiento es obligatoria.");
    if (!candidate.movementType) errors.push("El tipo de movimiento es obligatorio.");
    if (!candidate.lines.length) errors.push("Debe agregar al menos una linea.");
    if (candidate.movementType === "TRANSFERENCIA_BODEGA") {
      if (!candidate.warehouseFromId) errors.push("La bodega origen es obligatoria.");
      if (!candidate.warehouseToId) errors.push("La bodega destino es obligatoria.");
      if (candidate.warehouseFromId && candidate.warehouseFromId === candidate.warehouseToId) errors.push("La bodega origen y destino no pueden ser iguales.");
    } else if (!candidate.warehouseFromId && !candidate.warehouseToId) {
      errors.push("Debe seleccionar una bodega.");
    }
    if (forConfirm && isEntryMovement(candidate.movementType) && !candidate.documentOrigin) {
      errors.push("El documento sustento es obligatorio para confirmar una entrada de inventario.");
    }

    candidate.lines.forEach((line, index) => {
      const row = index + 1;
      const item = line.itemId ? findItemById(line.itemId) : findItemByCode(line.itemCode);
      if (!item) errors.push(`La linea ${row} debe tener un producto valido.`);
      else if (item.status !== "activo") errors.push(`El producto ${item.code} esta inactivo.`);
      if (forConfirm && isEntryMovement(candidate.movementType) && !candidate.warehouseToId && !line.warehouseId) {
        errors.push(`La linea ${row} debe tener bodega destino.`);
      }
      if (Number(line.quantity || 0) <= 0) errors.push(`La linea ${row} debe tener cantidad mayor que cero.`);
      if (Number(line.costUnit || 0) < 0) errors.push(`La linea ${row} no puede tener costo unitario negativo.`);
      if (!line.inventoryAccountCode) errors.push(`La linea ${row} debe tener cuenta de inventario.`);
      if (item?.requiresLot && !line.lot) errors.push(`La linea ${row} requiere lote.`);
      if (item?.requiresExpiry && !line.expiryDate) errors.push(`La linea ${row} requiere fecha de vencimiento.`);
      if (forConfirm && isExitMovement(candidate.movementType) && candidate.movementType !== "AJUSTE_NEGATIVO") {
        const warehouseId = candidate.warehouseFromId || candidate.warehouseToId;
        const available = stockBalanceByItemWarehouse(item?.id || "", warehouseId).quantity;
        if (available < Number(line.quantity || 0)) {
          errors.push(`Stock insuficiente para ${item?.code || line.itemCode} en la bodega seleccionada.`);
        }
      }
      if (forConfirm && isEntryMovement(candidate.movementType)) {
        errors.push(...validateMovementAccount(line.inventoryAccountCode, `la cuenta de inventario de la linea ${row}`).errors);
      }
      if (forConfirm && ["SALIDA_CONSUMO", "SALIDA_PROVEEDOR", "SALIDA_EMPAQUE", "SALIDA_CAMPO"].includes(candidate.movementType)) {
        const targetCode = candidate.movementType === "SALIDA_PROVEEDOR"
          ? companyService.settings().defaultAccounts?.supplierAdvances
          : line.expenseAccountCode;
        const label = candidate.movementType === "SALIDA_PROVEEDOR"
          ? "la cuenta de anticipos a proveedores"
          : `la cuenta de gasto/costo de la linea ${row}`;
        errors.push(...validateMovementAccount(targetCode, label).errors);
      }
    });

    if (forConfirm && ["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "ENTRADA_AJUSTE"].includes(candidate.movementType)) {
      errors.push(...validateMovementAccount(candidate.counterAccountCode, "la cuenta contrapartida del ajuste").errors);
    }

    return { movement: candidate, errors: [...new Set(errors)] };
  }

  function buildMovementJournalEntry(movement) {
    const errors = [];
    const entry = journalService.emptyEntry();
    entry.accountingDate = movement.movementDate;
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
    entry.originModule = "Inventario";
    entry.sourceDocument = movement.movementNumber;
    entry.externalReference = movement.documentOrigin || movement.movementNumber;
    entry.observation = movement.observation || "";
    entry.concept = `${movementTypeLabels[movement.movementType] || movement.movementType} ${movement.movementNumber}`;
    entry.lines = [];

    const counterAccountCode = movement.counterAccountCode || companyService.settings().defaultAccounts?.supplierAdvances || "";
    const counterAccount = counterAccountCode ? chartService.findByCode(counterAccountCode) : null;

    movement.lines.forEach(line => {
      const inventoryValidation = validateMovementAccount(line.inventoryAccountCode, "la cuenta de inventario");
      errors.push(...inventoryValidation.errors);
      const inventoryAccount = inventoryValidation.account;
      const amount = round2(line.costTotal || (line.quantity * line.costUnit));

      if (["SALIDA_CONSUMO", "SALIDA_EMPAQUE", "SALIDA_CAMPO"].includes(movement.movementType)) {
        const expenseValidation = validateMovementAccount(line.expenseAccountCode, "la cuenta gasto/costo");
        errors.push(...expenseValidation.errors);
        if (expenseValidation.account && inventoryAccount) {
          entry.lines.push({
            id: uid("JLN"),
            accountCode: expenseValidation.account.code,
            accountName: expenseValidation.account.name,
            debit: amount,
            credit: 0,
            costCenter: line.costCenter || movement.costCenter || "",
            auxiliary: "",
            lineDescription: line.description || line.itemName,
            documentReference: movement.movementNumber
          });
          entry.lines.push({
            id: uid("JLN"),
            accountCode: inventoryAccount.code,
            accountName: inventoryAccount.name,
            debit: 0,
            credit: amount,
            costCenter: "",
            auxiliary: "",
            lineDescription: line.description || line.itemName,
            documentReference: movement.movementNumber
          });
        }
      } else if (movement.movementType === "SALIDA_PROVEEDOR") {
        const advanceValidation = validateMovementAccount(companyService.settings().defaultAccounts?.supplierAdvances, "la cuenta de anticipos a proveedores");
        errors.push(...advanceValidation.errors);
        if (advanceValidation.account && inventoryAccount) {
          entry.lines.push({
            id: uid("JLN"),
            accountCode: advanceValidation.account.code,
            accountName: advanceValidation.account.name,
            debit: amount,
            credit: 0,
            costCenter: "",
            auxiliary: movement.supplierName || "",
            lineDescription: `Entrega a proveedor ${movement.supplierName || ""}`.trim(),
            documentReference: movement.movementNumber
          });
          entry.lines.push({
            id: uid("JLN"),
            accountCode: inventoryAccount.code,
            accountName: inventoryAccount.name,
            debit: 0,
            credit: amount,
            costCenter: "",
            auxiliary: "",
            lineDescription: line.description || line.itemName,
            documentReference: movement.movementNumber
          });
        }
      } else if (["AJUSTE_POSITIVO", "ENTRADA_AJUSTE"].includes(movement.movementType)) {
        if (!counterAccount) errors.push("La cuenta contrapartida del ajuste no existe.");
        if (counterAccount && inventoryAccount) {
          entry.lines.push({
            id: uid("JLN"),
            accountCode: inventoryAccount.code,
            accountName: inventoryAccount.name,
            debit: amount,
            credit: 0,
            costCenter: "",
            auxiliary: "",
            lineDescription: line.description || line.itemName,
            documentReference: movement.movementNumber
          });
          entry.lines.push({
            id: uid("JLN"),
            accountCode: counterAccount.code,
            accountName: counterAccount.name,
            debit: 0,
            credit: amount,
            costCenter: movement.costCenter || "",
            auxiliary: "",
            lineDescription: movement.observation || "Contrapartida ajuste",
            documentReference: movement.movementNumber
          });
        }
      } else if (movement.movementType === "AJUSTE_NEGATIVO") {
        if (!counterAccount) errors.push("La cuenta contrapartida del ajuste no existe.");
        if (counterAccount && inventoryAccount) {
          entry.lines.push({
            id: uid("JLN"),
            accountCode: counterAccount.code,
            accountName: counterAccount.name,
            debit: amount,
            credit: 0,
            costCenter: movement.costCenter || "",
            auxiliary: "",
            lineDescription: movement.observation || "Contrapartida ajuste",
            documentReference: movement.movementNumber
          });
          entry.lines.push({
            id: uid("JLN"),
            accountCode: inventoryAccount.code,
            accountName: inventoryAccount.name,
            debit: 0,
            credit: amount,
            costCenter: "",
            auxiliary: "",
            lineDescription: line.description || line.itemName,
            documentReference: movement.movementNumber
          });
        }
      }
    });

    if (errors.length) return { ok: false, errors: [...new Set(errors)] };
    return { ok: true, entry };
  }

  function saveMovement(movement) {
    const { movement: candidate, errors } = validateMovement(movement);
    if (errors.length) return { ok: false, errors };
    const rows = movements();
    const index = rows.findIndex(item => item.id === candidate.id);
    candidate.status = candidate.status === "ANULADO" ? "ANULADO" : "BORRADOR";
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("inventoryMovements", rows);
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: index >= 0 ? "EDITAR_MOVIMIENTO_INVENTARIO" : "CREAR_MOVIMIENTO_INVENTARIO",
      entityType: "inventory_movement",
      entityId: candidate.id,
      entityLabel: candidate.movementNumber,
      documentLabel: candidate.documentOrigin || candidate.movementNumber,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el movimiento ${candidate.movementNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, movement: clone(candidate) };
  }

  function confirmMovement(movementId) {
    const rows = movements();
    const index = rows.findIndex(item => item.id === movementId);
    if (index < 0) return { ok: false, errors: ["Movimiento de inventario no encontrado."] };
    if (rows[index].status !== "BORRADOR") return { ok: false, errors: ["Solo se pueden confirmar movimientos en borrador."] };
    const { movement: candidate, errors } = validateMovement(rows[index], { forConfirm: true });
    if (errors.length) return { ok: false, errors };

    if (touchesJournal(candidate.movementType)) {
      const built = buildMovementJournalEntry(candidate);
      if (!built.ok) return built;
      const savedEntry = journalService.saveDraft(built.entry);
      if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento de inventario."] };
      const postedEntry = journalService.postEntry(savedEntry.entry.id);
      if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el asiento de inventario."] };
      candidate.journalEntryId = postedEntry.entry.id;
      candidate.journalEntryNumber = postedEntry.entry.entryNumber;
    }

    candidate.status = "CONFIRMADO";
    rows[index] = candidate;
    saveList("inventoryMovements", rows);
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: "CONFIRMAR_MOVIMIENTO_INVENTARIO",
      entityType: "inventory_movement",
      entityId: candidate.id,
      entityLabel: candidate.movementNumber,
      documentLabel: candidate.documentOrigin || candidate.movementNumber,
      previousStatus: "BORRADOR",
      nextStatus: candidate.status,
      description: `Movimiento ${candidate.movementNumber} confirmado${candidate.journalEntryNumber ? ` con asiento ${candidate.journalEntryNumber}` : ""}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, movement: clone(candidate) };
  }

  function annulMovement(movementId) {
    const rows = movements();
    const index = rows.findIndex(item => item.id === movementId);
    if (index < 0) return { ok: false, message: "Movimiento de inventario no encontrado." };
    if (rows[index].status === "ANULADO") return { ok: false, message: "El movimiento ya esta anulado." };
    if (rows[index].journalEntryId) {
      const reversed = journalService.reverseEntry(rows[index].journalEntryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el asiento de inventario." };
      rows[index].reverseEntryId = reversed.entry.id;
      rows[index].reverseEntryNumber = reversed.entry.entryNumber;
    }
    rows[index].status = "ANULADO";
    saveList("inventoryMovements", rows);
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: "ANULAR_MOVIMIENTO_INVENTARIO",
      entityType: "inventory_movement",
      entityId: rows[index].id,
      entityLabel: rows[index].movementNumber,
      documentLabel: rows[index].documentOrigin || rows[index].movementNumber,
      previousStatus: "CONFIRMADO",
      nextStatus: rows[index].status,
      description: `Movimiento ${rows[index].movementNumber} anulado.`,
      after: rows[index],
      result: "exitoso"
    });
    return { ok: true, movement: clone(rows[index]) };
  }

  function stockSummary(filters = {}) {
    return items(filters).map(item => {
      const warehouseId = filters.warehouseId || item.warehouseId || "";
      const balance = stockBalanceByItemWarehouse(item.id, warehouseId);
      const averageCost = balance.quantity > 0 ? round2(balance.value / balance.quantity) : 0;
      const status = balance.quantity <= 0
        ? "sin stock"
        : item.minStock > 0 && balance.quantity <= item.minStock
          ? "bajo minimo"
          : item.maxStock > 0 && balance.quantity > item.maxStock
            ? "exceso"
            : "normal";
      return {
        itemId: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        warehouseId,
        warehouseName: findWarehouseById(warehouseId)?.name || item.warehouseName || "",
        unit: item.unit,
        quantity: balance.quantity,
        averageCost,
        value: round2(balance.value),
        minStock: item.minStock,
        maxStock: item.maxStock,
        status
      };
    });
  }

  function lotBalances() {
    const map = new Map();
    movements({ status: "CONFIRMADO" }).forEach(movement => {
      movement.lines.forEach(line => {
        if (!line.expiryDate && !line.lot) return;
        const item = findItemById(line.itemId);
        if (!item) return;
        const warehouseId = movement.warehouseToId || movement.warehouseFromId || "";
        const lotKey = `${line.itemId}|${warehouseId}|${line.lot || "-"}|${line.expiryDate || "-"}`;
        const current = map.get(lotKey) || {
          itemId: line.itemId,
          itemCode: item.code,
          itemName: item.name,
          warehouseId,
          warehouseName: findWarehouseById(warehouseId)?.name || "",
          lot: line.lot || "",
          expiryDate: line.expiryDate || "",
          quantity: 0
        };
        const sign = movement.movementType === "TRANSFERENCIA_BODEGA"
          ? (movement.warehouseToId === warehouseId ? 1 : -1)
          : isEntryMovement(movement.movementType) ? 1 : -1;
        current.quantity = round2(current.quantity + (line.quantity * sign));
        map.set(lotKey, current);
      });
    });
    return Array.from(map.values());
  }

  function kardex(filters = {}) {
    const rows = [];
    const balances = new Map();
    const filteredMovements = movements({ status: "CONFIRMADO", dateFrom: filters.dateFrom, dateTo: filters.dateTo })
      .filter(item => !filters.movementType || item.movementType === filters.movementType)
      .sort((a, b) => `${a.movementDate}|${a.movementNumber}`.localeCompare(`${b.movementDate}|${b.movementNumber}`, "es"));

    filteredMovements.forEach(movement => {
      movement.lines.forEach(line => {
        const item = findItemById(line.itemId);
        if (!item) return;
        if (filters.productId && line.itemId !== filters.productId) return;
        if (filters.category && item.category !== filters.category) return;
        const impacts = [];
        if (movement.movementType === "TRANSFERENCIA_BODEGA") {
          impacts.push({ warehouseId: movement.warehouseFromId, warehouseName: movement.warehouseFromName, sign: -1 });
          impacts.push({ warehouseId: movement.warehouseToId, warehouseName: movement.warehouseToName, sign: 1 });
        } else {
          impacts.push({
            warehouseId: movement.warehouseToId || movement.warehouseFromId,
            warehouseName: movement.warehouseToName || movement.warehouseFromName,
            sign: isEntryMovement(movement.movementType) ? 1 : -1
          });
        }
        impacts.forEach(impact => {
          if (filters.warehouseId && impact.warehouseId !== filters.warehouseId) return;
          const key = `${line.itemId}|${impact.warehouseId}`;
          const current = balances.get(key) || { quantity: 0, value: 0 };
          const entryQty = impact.sign > 0 ? round2(line.quantity) : 0;
          const exitQty = impact.sign < 0 ? round2(line.quantity) : 0;
          const entryValue = impact.sign > 0 ? round2(line.costTotal) : 0;
          const exitValue = impact.sign < 0 ? round2(line.costTotal) : 0;
          current.quantity = round2(current.quantity + (impact.sign * line.quantity));
          current.value = round2(current.value + (impact.sign * line.costTotal));
          const averageCost = current.quantity > 0 ? round2(current.value / current.quantity) : 0;
          rows.push({
            movementId: movement.id,
            date: movement.movementDate,
            movementNumber: movement.movementNumber,
            movementType: movement.movementType,
            movementTypeLabel: movementTypeLabels[movement.movementType] || movement.movementType,
            documentOrigin: movement.documentOrigin || "-",
            supportDocument: movement.documentOrigin || "-",
            supplierName: movement.supplierName || "",
            supplierRuc: movement.supplierRuc || "",
            purchaseDocumentNumber: movement.purchaseDocumentNumber || "",
            purchaseId: movement.purchaseId || "",
            sourcePurchaseId: line.sourcePurchaseId || movement.purchaseId || "",
            sourceLineId: line.sourceLineId || "",
            sourceLineNumber: line.sourceLineNumber || "",
            sourceLineDescription: line.sourceLineDescription || line.description || "",
            sourceType: movement.sourceType || movement.originModule || "manual",
            itemId: line.itemId,
            itemCode: item.code,
            itemName: item.name,
            warehouseId: impact.warehouseId,
            warehouseName: impact.warehouseName,
            entryQty,
            entryQuantity: entryQty,
            entryValue,
            exitQty,
            exitQuantity: exitQty,
            exitValue,
            balanceQty: current.quantity,
            balanceQuantity: current.quantity,
            averageCost,
            balanceValue: current.value,
            sourceDocument: movement.documentOrigin || "-",
            responsible: movement.responsible,
            status: movement.status
          });
          balances.set(key, current);
        });
      });
    });

    return rows.filter(row => {
      if (!filters.search) return true;
      const haystack = [row.itemCode, row.itemName, row.warehouseName, row.documentOrigin, row.movementTypeLabel].join(" ").toLowerCase();
      return haystack.includes(String(filters.search || "").toLowerCase());
    });
  }

  function purchaseLineProgress() {
    return movements({ status: "CONFIRMADO" }).reduce((acc, movement) => {
      movement.lines.forEach(line => {
        if (!line.sourcePurchaseId || !line.sourceLineId) return;
        const key = `${line.sourcePurchaseId}|${line.sourceLineId}`;
        if (!acc[key]) {
          acc[key] = {
            quantity: 0,
            total: 0,
            movements: []
          };
        }
        acc[key].quantity = round2(acc[key].quantity + Number(line.quantity || 0));
        acc[key].total = round2(acc[key].total + Number(line.costTotal || 0));
        acc[key].movements.push({
          movementId: movement.id,
          movementNumber: movement.movementNumber,
          warehouseId: line.warehouseId || movement.warehouseToId || movement.warehouseFromId || "",
          warehouseName: line.warehouseName || movement.warehouseToName || movement.warehouseFromName || ""
        });
      });
      return acc;
    }, {});
  }

  function buildInventoryPurchaseStatus(summary = {}) {
    if (String(summary.purchaseStatus || "").toUpperCase() === "ANULADO") return "ANULADO";
    if (summary.totalEntered > summary.inventoryLinesTotal + 0.01) return "OBSERVADO";
    if (summary.totalPending <= 0.01) return "INGRESADO_TOTAL";
    if (summary.totalEntered > 0.01) return "PARCIAL_INGRESADO";
    return "PENDIENTE_INVENTARIO";
  }

  function purchasesPendingInventory(filters = {}) {
    const purchaseService = BlessERP.services.purchases;
    const purchaseTypes = purchaseService?.purchaseTypes?.() || [];
    const purchaseRows = purchaseService?.purchases?.() || [];
    const progressMap = purchaseLineProgress();

    return purchaseRows
      .filter(purchase => {
        const typeConfig = purchaseTypes.find(item => item.code === purchase.purchaseType);
        return ["CONTABILIZADO", "RETENIDO", "PENDIENTE_RETENCION", "ANULADO"].includes(purchase.status)
          && (trackedPurchaseType(purchase.purchaseType) || Boolean(typeConfig?.affectsInventory));
      })
      .map(purchase => {
        const typeConfig = purchaseTypes.find(item => item.code === purchase.purchaseType);
        const lines = (purchase.lines || [])
          .filter(line => inventoryLineMatches(line, purchase, typeConfig))
          .map((line, index) => {
            const item = findItemForPurchaseLine(line);
            const category = inferCategoryFromPurchaseLine(line, purchase);
            const subcategory = inferSubcategoryFromLine(line, category);
            const quantity = round2(line.quantity || 0);
            const costUnit = round2(line.unitPrice || 0);
            const costTotal = round2(line.taxableBase || line.totalLine || (quantity * costUnit));
            const key = `${purchase.id}|${line.id}`;
            const progress = progressMap[key] || { quantity: 0, total: 0, movements: [] };
            const pendingQuantity = round2(Math.max(0, quantity - progress.quantity));
            const pendingTotal = round2(Math.max(0, costTotal - progress.total));
            return {
              lineId: line.id,
              lineNumber: index + 1,
              generated: pendingQuantity <= 0.0001,
              itemId: item?.id || "",
              itemCode: item?.code || "",
              itemName: item?.name || "",
              barcode: item?.barcode || "",
              productCode: line.productCode || "",
              description: line.description || "",
              quantity,
              costUnit,
              costTotal,
              enteredQuantity: round2(progress.quantity || 0),
              enteredTotal: round2(progress.total || 0),
              pendingQuantity,
              pendingTotal,
              category,
              subcategory,
              unit: item?.unit || inferUnitFromCategory(category, subcategory),
              inventoryAccountCode: item?.inventoryAccountCode || suggestInventoryAccountCode(category),
              expenseAccountCode: item?.expenseAccountCode || suggestExpenseAccountCode(category),
              requiresLot: item?.requiresLot ?? requiresTraceability(category),
              requiresExpiry: item?.requiresExpiry ?? requiresTraceability(category),
              warehouseId: item?.warehouseId || defaultWarehouse()?.id || "",
              movementRefs: progress.movements || []
            };
          });

        const inventoryLinesTotal = round2(lines.reduce((sum, line) => sum + Number(line.costTotal || 0), 0));
        const totalEntered = round2(lines.reduce((sum, line) => sum + Number(line.enteredTotal || 0), 0));
        const totalPending = round2(Math.max(0, inventoryLinesTotal - totalEntered));
        const difference = round2(inventoryLinesTotal - totalEntered);
        const status = buildInventoryPurchaseStatus({
          purchaseStatus: purchase.status,
          inventoryLinesTotal,
          totalEntered,
          totalPending
        });
        return {
          purchaseId: purchase.id,
          issueDate: purchase.issueDate || "",
          accountingDate: purchase.accountingDate,
          supplierId: purchase.supplierId || "",
          supplierName: purchase.supplierName,
          supplierRuc: purchase.supplierRuc,
          supplierAddress: purchase.supplierAddress || "",
          documentType: purchase.documentType || "",
          series: purchase.series || `${purchase.establishment || ""}-${purchase.emissionPoint || ""}`.replace(/^-|-$/g, ""),
          establishment: purchase.establishment || "",
          emissionPoint: purchase.emissionPoint || "",
          sequential: purchase.sequential || "",
          authorizationNumber: purchase.authorizationNumber || "",
          accessKey: purchase.accessKey || "",
          documentNumber: purchase.documentNumber,
          purchaseStatus: purchase.status,
          totalInvoice: round2(purchase.totals?.total || 0),
          inventoryLinesTotal,
          totalEntered,
          totalPending,
          difference,
          inventoryStatus: status,
          lines,
          unresolved: lines.filter(line => line.pendingQuantity > 0.0001 && !line.itemId),
          readyLines: lines.filter(line => line.pendingQuantity > 0.0001 && line.itemId),
          generatedLines: lines.filter(line => line.generated),
          movementRefs: [...new Map(lines.flatMap(line => line.movementRefs || []).map(ref => [ref.movementId, ref])).values()]
        };
      })
      .filter(item => {
        if (!item.lines.length) return false;
        if (filters.includeAnnulled) return true;
        if (item.purchaseStatus === "ANULADO") return false;
        return true;
      })
      .filter(item => !filters.inventoryStatus || item.inventoryStatus === filters.inventoryStatus)
      .filter(item => {
        if (!filters.search) return true;
        const haystack = [
          item.documentNumber,
          item.supplierName,
          item.supplierRuc,
          item.authorizationNumber,
          item.accessKey
        ].join(" ").toLowerCase();
        return haystack.includes(String(filters.search || "").toLowerCase());
      });
  }

  function preparePurchaseEntryDraft(purchaseId) {
    const pending = purchasesPendingInventory({ includeAnnulled: true }).find(item => item.purchaseId === purchaseId);
    if (!pending) return { ok: false, errors: ["La compra seleccionada no tiene lineas clasificadas para inventario."] };
    if (pending.purchaseStatus === "ANULADO") return { ok: false, errors: ["La compra esta anulada y no puede generar ingreso a inventario."] };
    const draft = {
      id: uid("PID"),
      purchaseId: pending.purchaseId,
      issueDate: pending.issueDate || "",
      accountingDate: pending.accountingDate || "",
      movementDate: pending.accountingDate || today(),
      supplierId: pending.supplierId || "",
      supplierName: pending.supplierName || "",
      supplierRuc: pending.supplierRuc || "",
      documentType: pending.documentType || "",
      series: pending.series || "",
      sequential: pending.sequential || "",
      authorizationNumber: pending.authorizationNumber || "",
      accessKey: pending.accessKey || "",
      documentNumber: pending.documentNumber || "",
      totalInvoice: pending.totalInvoice || 0,
      inventoryLinesTotal: pending.inventoryLinesTotal || 0,
      totalPreviouslyEntered: pending.totalEntered || 0,
      totalPending: pending.totalPending || 0,
      difference: pending.difference || 0,
      inventoryStatus: pending.inventoryStatus,
      responsible: currentUser().name,
      observation: `Ingreso de inventario desde compra ${pending.documentNumber}`,
      lines: pending.lines
        .filter(line => line.pendingQuantity > 0.0001)
        .map(line => ({
          lineId: line.lineId,
          lineNumber: line.lineNumber,
          itemId: line.itemId || "",
          existingItemId: line.itemId || "",
          code: line.itemCode || line.productCode || "",
          barcode: line.barcode || "",
          name: line.itemName || line.description || "",
          description: line.description || "",
          category: line.category,
          subcategory: line.subcategory,
          unit: line.unit,
          purchasedQuantity: line.quantity,
          alreadyEnteredQuantity: line.enteredQuantity,
          pendingQuantity: line.pendingQuantity,
          entryQuantity: line.pendingQuantity,
          costUnit: line.costUnit,
          purchasedTotal: line.costTotal,
          entryTotal: line.pendingTotal,
          warehouseId: line.warehouseId || defaultWarehouse()?.id || "",
          lot: "",
          expiryDate: "",
          inventoryAccountCode: line.inventoryAccountCode || "",
          expenseAccountCode: line.expenseAccountCode || "",
          costCenter: "",
          observation: "",
          requiresLot: Boolean(line.requiresLot),
          requiresExpiry: Boolean(line.requiresExpiry)
        }))
    };
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: "CREAR_INGRESO_DESDE_FACTURA",
      entityType: "purchase_inventory_entry",
      entityId: draft.id,
      entityLabel: draft.documentNumber,
      documentLabel: draft.documentNumber,
      nextStatus: "BORRADOR",
      description: `Se preparo el ingreso de inventario desde la factura ${draft.documentNumber}.`,
      after: {
        purchaseId: draft.purchaseId,
        lines: draft.lines.length
      },
      result: "exitoso"
    });
    return { ok: true, draft };
  }

  function lineToItemPayload(line, existingItem = null) {
    return {
      id: existingItem?.id || line.itemId || "",
      code: String(line.code || existingItem?.code || "").trim().toUpperCase(),
      barcode: String(line.barcode || existingItem?.barcode || "").trim(),
      name: String(line.name || existingItem?.name || line.description || "").trim(),
      category: String(line.category || existingItem?.category || "OTRO").trim().toUpperCase(),
      subcategory: String(line.subcategory || existingItem?.subcategory || "otro").trim().toLowerCase(),
      unit: String(line.unit || existingItem?.unit || "unidad").trim().toLowerCase(),
      inventoryAccountCode: String(line.inventoryAccountCode || existingItem?.inventoryAccountCode || "").trim(),
      expenseAccountCode: String(line.expenseAccountCode || existingItem?.expenseAccountCode || "").trim(),
      minStock: Number(existingItem?.minStock || 0),
      maxStock: Number(existingItem?.maxStock || 0),
      warehouseId: String(line.warehouseId || existingItem?.warehouseId || defaultWarehouse()?.id || "").trim(),
      defaultCostCenter: String(line.costCenter || existingItem?.defaultCostCenter || "").trim().toUpperCase(),
      requiresCostCenter: Boolean(line.costCenter || existingItem?.requiresCostCenter || existingItem?.defaultCostCenter),
      defaultResponsibleId: String(line.responsibleId || existingItem?.defaultResponsibleId || "").trim(),
      requiresLot: line.requiresLot ?? existingItem?.requiresLot ?? false,
      requiresExpiry: line.requiresExpiry ?? existingItem?.requiresExpiry ?? false,
      status: existingItem?.status || "activo",
      observation: String(existingItem?.observation || "").trim()
    };
  }

  function purchaseLineItemChanged(item, payload) {
    if (!item) return false;
    return ["code", "barcode", "name", "category", "subcategory", "unit", "inventoryAccountCode", "expenseAccountCode", "warehouseId", "defaultCostCenter", "defaultResponsibleId", "requiresCostCenter", "requiresLot", "requiresExpiry"]
      .some(key => String(item[key] ?? "") !== String(payload[key] ?? ""));
  }

  function confirmPurchaseEntryDraft(rawDraft = {}) {
    const pending = purchasesPendingInventory({ includeAnnulled: true }).find(item => item.purchaseId === rawDraft.purchaseId);
    if (!pending) return { ok: false, errors: ["La compra ya no tiene lineas pendientes para inventario."] };
    if (pending.purchaseStatus === "ANULADO") return { ok: false, errors: ["La compra esta anulada y no puede generar ingreso a inventario."] };
    const draft = clone(rawDraft || {});
    const activeLines = (draft.lines || []).filter(line => Number(line.entryQuantity || 0) > 0);
    const errors = [];
    if (!activeLines.length) errors.push("Debe ingresar al menos una linea con cantidad mayor que cero.");
    if (!draft.movementDate) errors.push("La fecha de ingreso es obligatoria.");

    const resolvedLines = activeLines.map((line, index) => {
      const pendingLine = pending.lines.find(item => item.lineId === line.lineId);
      const row = index + 1;
      if (!pendingLine) {
        errors.push(`La linea ${row} ya no esta disponible en la factura.`);
        return null;
      }
      const entryQuantity = round2(line.entryQuantity || 0);
      const pendingQuantity = round2(pendingLine.pendingQuantity || 0);
      if (entryQuantity > pendingQuantity + 0.0001) {
        errors.push(`La linea ${row} no puede ingresar mas que la cantidad pendiente de la factura.`);
      }
      if (!line.warehouseId || !findWarehouseById(line.warehouseId)) {
        errors.push(`La linea ${row} debe tener una bodega destino valida.`);
      }
      const existingItem = line.itemId ? findItemById(line.itemId) : null;
      const payload = lineToItemPayload(line, existingItem);
      if (!payload.code) errors.push(`La linea ${row} debe tener codigo interno.`);
      if (!payload.name) errors.push(`La linea ${row} debe tener nombre de producto.`);
      if (!payload.inventoryAccountCode) errors.push(`La linea ${row} debe tener cuenta de inventario.`);
      if (!payload.expenseAccountCode) errors.push(`La linea ${row} debe tener cuenta de consumo / gasto / costo.`);
      if ((line.requiresLot || payload.requiresLot) && !line.lot) errors.push(`La linea ${row} requiere lote.`);
      if ((line.requiresExpiry || payload.requiresExpiry) && !line.expiryDate) errors.push(`La linea ${row} requiere fecha de vencimiento.`);
      return {
        row,
        pendingLine,
        entryQuantity,
        entryTotal: round2(entryQuantity * Number(line.costUnit || pendingLine.costUnit || 0)),
        warehouseId: line.warehouseId,
        payload,
        line
      };
    }).filter(Boolean);

    if (errors.length) return { ok: false, errors: [...new Set(errors)] };

    const grouped = new Map();
    const createdItems = [];
    const updatedItems = [];
    const relatedItems = [];

    resolvedLines.forEach(resolved => {
      const existingItem = resolved.line.itemId ? findItemById(resolved.line.itemId) : null;
      const saved = saveItem(resolved.payload);
      if (!saved.ok) {
        errors.push(...(saved.errors || [`No se pudo guardar el item de la linea ${resolved.row}.`]));
        return;
      }
      const item = saved.item;
      if (!existingItem) {
        createdItems.push(item);
        adminService?.addAuditLog?.({
          module: "INVENTARIO",
          action: "CREAR_PRODUCTO_NUEVO_DESDE_FACTURA",
          entityType: "inventory_item",
          entityId: item.id,
          entityLabel: item.code,
          documentLabel: pending.documentNumber,
          description: `Se creo el item ${item.code} desde la factura ${pending.documentNumber}.`,
          after: item,
          result: "exitoso"
        });
      } else if (purchaseLineItemChanged(existingItem, resolved.payload)) {
        updatedItems.push(item);
        adminService?.addAuditLog?.({
          module: "INVENTARIO",
          action: "EDITAR_PRODUCTO_DESDE_LINEA_COMPRA",
          entityType: "inventory_item",
          entityId: item.id,
          entityLabel: item.code,
          documentLabel: pending.documentNumber,
          description: `Se ajusto el item ${item.code} desde una linea de la factura ${pending.documentNumber}.`,
          before: existingItem,
          after: item,
          result: "exitoso"
        });
      } else {
        relatedItems.push(item);
        adminService?.addAuditLog?.({
          module: "INVENTARIO",
          action: "RELACIONAR_PRODUCTO_EXISTENTE",
          entityType: "inventory_item",
          entityId: item.id,
          entityLabel: item.code,
          documentLabel: pending.documentNumber,
          description: `Se relaciono el item existente ${item.code} con una linea de la factura ${pending.documentNumber}.`,
          after: {
            purchaseId: pending.purchaseId,
            lineId: resolved.pendingLine.lineId
          },
          result: "exitoso"
        });
      }

      const groupKey = resolved.warehouseId;
      if (!grouped.has(groupKey)) grouped.set(groupKey, []);
      grouped.get(groupKey).push(normalizeMovementLine({
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        description: resolved.pendingLine.description,
        quantity: resolved.entryQuantity,
        unit: item.unit || resolved.line.unit || "unidad",
        costUnit: round2(resolved.line.costUnit || resolved.pendingLine.costUnit || 0),
        costTotal: resolved.entryTotal,
        lot: resolved.line.lot || "",
        expiryDate: resolved.line.expiryDate || "",
        inventoryAccountCode: resolved.line.inventoryAccountCode || item.inventoryAccountCode,
        expenseAccountCode: resolved.line.expenseAccountCode || item.expenseAccountCode,
        costCenter: resolved.line.costCenter || "",
        observation: resolved.line.observation || "",
        sourcePurchaseId: pending.purchaseId,
        sourceLineId: resolved.pendingLine.lineId,
        sourceLineNumber: String(resolved.pendingLine.lineNumber || ""),
        sourceLineDescription: resolved.pendingLine.description || "",
        warehouseId: resolved.warehouseId,
        warehouseName: findWarehouseById(resolved.warehouseId)?.name || ""
      }));
    });

    if (errors.length) return { ok: false, errors: [...new Set(errors)] };

    const createdMovements = [];
    for (const [warehouseId, lines] of grouped.entries()) {
      const warehouse = findWarehouseById(warehouseId);
      if (!warehouse) return { ok: false, errors: ["Una de las bodegas seleccionadas ya no existe."] };
      const movement = normalizeMovement({
        movementNumber: nextMovementNumber(),
        movementDate: draft.movementDate,
        movementType: "ENTRADA_COMPRA",
        warehouseToId: warehouse.id,
        responsible: draft.responsible || currentUser().name,
        documentOrigin: pending.documentNumber,
        originModule: "compras",
        sourceType: "compra",
        supportMode: "automatico",
        purchaseId: pending.purchaseId,
        purchaseDocumentNumber: pending.documentNumber,
        purchaseAuthorization: pending.authorizationNumber || "",
        purchaseAccessKey: pending.accessKey || "",
        supplierId: pending.supplierId || "",
        supplierName: pending.supplierName || "",
        supplierRuc: pending.supplierRuc || "",
        supplierDocumentType: pending.documentType || "",
        status: "BORRADOR",
        observation: draft.observation || `Entrada de inventario desde compra ${pending.documentNumber}`,
        lines
      });
      const saved = saveMovement(movement);
      if (!saved.ok) return saved;
      const confirmed = confirmMovement(saved.movement.id);
      if (!confirmed.ok) return confirmed;
      createdMovements.push(confirmed.movement);
    }

    const refreshed = purchasesPendingInventory({ includeAnnulled: true }).find(item => item.purchaseId === pending.purchaseId);
    adminService?.addAuditLog?.({
      module: "INVENTARIO",
      action: "CONFIRMAR_INGRESO_DESDE_FACTURA",
      entityType: "purchase_inventory_entry",
      entityId: pending.purchaseId,
      entityLabel: pending.documentNumber,
      documentLabel: pending.documentNumber,
      nextStatus: refreshed?.inventoryStatus || "INGRESADO_TOTAL",
      description: `Se confirmo el ingreso de inventario desde la factura ${pending.documentNumber}.`,
      after: {
        movements: createdMovements.map(item => item.movementNumber),
        totalIngresado: round2(createdMovements.reduce((sum, item) => sum + item.lines.reduce((lineSum, line) => lineSum + Number(line.costTotal || 0), 0), 0)),
        inventoryStatus: refreshed?.inventoryStatus || ""
      },
      result: "exitoso"
    });
    return {
      ok: true,
      movements: createdMovements,
      refreshed,
      createdItems,
      updatedItems,
      relatedItems
    };
  }

  function createPurchaseEntry(purchaseId, { warehouseId = "" } = {}) {
    const prepared = preparePurchaseEntryDraft(purchaseId);
    if (!prepared.ok) return prepared;
    prepared.draft.lines = prepared.draft.lines.map(line => ({
      ...line,
      warehouseId: warehouseId || line.warehouseId || defaultWarehouse()?.id || ""
    }));
    return confirmPurchaseEntryDraft(prepared.draft);
  }

  function inventoryAlerts() {
    const stock = stockSummary();
    const pendingPurchases = purchasesPendingInventory({ includeAnnulled: true });
    const lowStock = stock.filter(item => item.status === "bajo minimo");
    const noStock = stock.filter(item => item.status === "sin stock");
    const expiring = lotBalances().filter(item => {
      if (!item.expiryDate || item.quantity <= 0) return false;
      const diffDays = Math.ceil((new Date(item.expiryDate).getTime() - new Date(today()).getTime()) / 86400000);
      return diffDays >= 0 && diffDays <= 30;
    });
    const draftMovements = movements({ status: "BORRADOR" });
    const pendingAccounting = movements({ status: "CONFIRMADO" }).filter(item => touchesJournal(item.movementType) && !item.journalEntryId);
    const pendingSupplierDeliveries = movements({ status: "CONFIRMADO", movementType: "SALIDA_PROVEEDOR" }).filter(item => item.settlementStatus !== "descontado");
    const pendingPurchaseEntries = pendingPurchases.filter(item => item.inventoryStatus === "PENDIENTE_INVENTARIO");
    const partialPurchaseEntries = pendingPurchases.filter(item => item.inventoryStatus === "PARCIAL_INGRESADO");
    const observedPurchaseDifferences = pendingPurchases.filter(item => item.inventoryStatus === "OBSERVADO" || Math.abs(Number(item.difference || 0)) > 0.01);
    const productsWithoutCode = items().filter(item => !String(item.code || "").trim());
    const productsWithoutExpenseAccount = items().filter(item => !String(item.expenseAccountCode || "").trim());
    const annulledMovements = movements({ status: "ANULADO" });
    return {
      lowStock,
      noStock,
      expiring,
      draftMovements,
      pendingAccounting,
      pendingSupplierDeliveries,
      pendingPurchaseEntries,
      partialPurchaseEntries,
      observedPurchaseDifferences,
      productsWithoutCode,
      productsWithoutExpenseAccount,
      annulledMovements
    };
  }

  function dashboardSummary() {
    const stock = stockSummary();
    const alerts = inventoryAlerts();
    return {
      totalItems: items({ status: "activo" }).length,
      totalWarehouses: warehouses({ status: "activo" }).length,
      inventoryValue: round2(stock.reduce((sum, item) => sum + Number(item.value || 0), 0)),
      lowStock: alerts.lowStock.length,
      noStock: alerts.noStock.length,
      draftMovements: alerts.draftMovements.length,
      pendingPurchaseEntries: alerts.pendingPurchaseEntries.length + alerts.partialPurchaseEntries.length + alerts.observedPurchaseDifferences.length
    };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.inventory = {
    itemCategories,
    itemSubcategories,
    itemUnits,
    warehouseStates,
    movementTypes,
    movementStates,
    movementOrigins,
    consumptionTypes,
    categoryLabels,
    movementTypeLabels,
    warehouses,
    findWarehouseById,
    responsibles,
    findResponsibleById,
    emptyResponsible,
    saveResponsible,
    responsibleStates,
    defaultWarehouse,
    emptyWarehouse,
    saveWarehouse,
    toggleWarehouseStatus,
    items,
    findItemById,
    findItemByCode,
    emptyMovementLine,
    emptyMovement,
    movements,
    findMovementById,
    saveItem,
    toggleItemStatus,
    saveMovement,
    confirmMovement,
    annulMovement,
    stockSummary,
    kardex,
    purchasesPendingInventory,
    preparePurchaseEntryDraft,
    confirmPurchaseEntryDraft,
    createPurchaseEntry,
    inventoryAlerts,
    dashboardSummary,
    draftItemFromPurchaseLine,
    createItemFromPurchaseLine
  };
})();
