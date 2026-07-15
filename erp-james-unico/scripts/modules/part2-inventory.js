(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const inventoryService = BlessERP.services.inventory;
  const chartService = BlessERP.services.chartOfAccounts;
  const adminService = BlessERP.services.adminConfig;

  const uiState = {
    catalog: {
      search: "",
      status: "",
      category: "",
      warehouseId: "",
      message: "",
      errors: [],
      itemDraft: null,
      warehouseDraft: null,
      responsibleDraft: null
    },
    kardex: {
      productId: "",
      category: "",
      warehouseId: "",
      movementType: "",
      dateFrom: "",
      dateTo: "",
      search: ""
    },
    purchaseEntries: {
      search: "",
      inventoryStatus: "",
      includeAnnulled: false,
      message: "",
      errors: [],
      selectedPurchaseId: "",
      draft: null
    },
    consumptions: {
      search: "",
      status: "",
      movementType: "SALIDA_CONSUMO",
      message: "",
      errors: [],
      draft: null
    },
    adjustments: {
      search: "",
      status: "",
      movementType: "AJUSTE_NEGATIVO",
      message: "",
      errors: [],
      draft: null
    }
  };

  function routeTabs(route) {
    return `
      <div class="subnav-tabs">
        ${BlessERP.navigation.groupMap[route.groupId].routes.map(item => `
          <button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function statusBadge(status) {
    const value = String(status || "").toLowerCase();
    const css = value.includes("anulado") || value.includes("inactivo") || value.includes("sin stock")
      ? "cancelled"
      : value.includes("borrador") || value.includes("pendiente") || value.includes("bajo")
        ? "pending"
        : value.includes("confirmado") || value.includes("activo") || value.includes("normal")
          ? "authorized"
          : "partial";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function categoryLabel(code) {
    return inventoryService.categoryLabels[code] || code;
  }

  function subcategoryOptions(category = "", current = "") {
    const map = {
      MATERIAL_EMPAQUE: ["carton", "separador", "liga", "capuchon", "etiqueta", "funda", "papel", "otro"],
      SUMINISTRO: ["otro"],
      QUIMICO: ["quimico", "otro"],
      FERTILIZANTE: ["fertilizante", "otro"],
      HERRAMIENTA: ["herramienta", "otro"],
      MATERIAL_BODEGA: ["otro"],
      OTRO: ["otro"]
    };
    const options = map[String(category || "").toUpperCase()] || ["otro"];
    return [...new Set([...(current ? [String(current).toLowerCase()] : []), ...options])];
  }

  function activeWarehouses() {
    return inventoryService.warehouses({ status: "activo" });
  }

  function movementOptions() {
    return chartService.movementOptions();
  }

  function activeCostCenters() {
    return adminService?.costCenters?.({ status: "activo" }) || [];
  }

  function activeResponsibles(filters = {}) {
    return inventoryService.responsibles({
      status: "activo",
      ...filters
    });
  }

  function catalogCategoriesForRoute() {
    return [];
  }

  function filteredItems(routeId) {
    return inventoryService.items({
      search: uiState.catalog.search,
      status: uiState.catalog.status,
      warehouseId: uiState.catalog.warehouseId,
      category: uiState.catalog.category || ""
    });
  }

  function filteredStock(routeId) {
    return inventoryService.stockSummary({
      warehouseId: uiState.catalog.warehouseId,
      category: uiState.catalog.category || ""
    }).filter(item => {
      if (uiState.catalog.category && item.category !== uiState.catalog.category) return false;
      if (uiState.catalog.search) {
        const haystack = [item.code, item.name, item.category, item.warehouseName].join(" ").toLowerCase();
        if (!haystack.includes(uiState.catalog.search.toLowerCase())) return false;
      }
      if (uiState.catalog.status) {
        const map = {
          activo: ["normal", "bajo minimo", "sin stock", "exceso"],
          inactivo: []
        };
        if (!map[uiState.catalog.status]?.includes(item.status)) return false;
      }
      return true;
    });
  }

  function ensureItemDraft(category = "") {
    uiState.catalog.itemDraft = uiState.catalog.itemDraft || {
      id: "",
      code: "",
      barcode: "",
      name: "",
      category: category || "SUMINISTRO",
      subcategory: category === "MATERIAL_EMPAQUE" ? "carton" : "otro",
      unit: category === "QUIMICO" ? "litro" : category === "FERTILIZANTE" ? "kilo" : "unidad",
      inventoryAccountCode: category === "MATERIAL_EMPAQUE" ? "1.1.03.02" : "1.1.03.01",
      expenseAccountCode: category === "MATERIAL_EMPAQUE" ? "5.2" : "6.2",
      defaultCostCenter: "",
      requiresCostCenter: false,
      defaultResponsibleId: "",
      minStock: 0,
      maxStock: 0,
      warehouseId: activeWarehouses()[0]?.id || "",
      requiresLot: ["QUIMICO", "FERTILIZANTE"].includes(category),
      requiresExpiry: ["QUIMICO", "FERTILIZANTE"].includes(category),
      status: "activo",
      observation: ""
    };
  }

  function ensureWarehouseDraft() {
    uiState.catalog.warehouseDraft = uiState.catalog.warehouseDraft || inventoryService.emptyWarehouse();
  }

  function ensureResponsibleDraft() {
    uiState.catalog.responsibleDraft = uiState.catalog.responsibleDraft || inventoryService.emptyResponsible();
  }

  function stockByItemMap(routeId) {
    return Object.fromEntries(filteredStock(routeId).map(item => [item.itemId, item]));
  }

  function summaryCards(routeId) {
    const stock = filteredStock(routeId);
    const alerts = inventoryService.inventoryAlerts();
    const totalValue = stock.reduce((sum, item) => sum + Number(item.value || 0), 0);
    return `
      <section class="summary-grid summary-grid-payables">
        <article class="summary-card"><span>Items parametrizados</span><strong>${esc(String(filteredItems(routeId).length))}</strong><small>Catalogo administrativo</small></article>
        <article class="summary-card"><span>Valor inventario</span><strong>${money(totalValue)}</strong><small>Segun stock confirmado</small></article>
        <article class="summary-card"><span>Bajo minimo</span><strong>${esc(String(alerts.lowStock.length))}</strong><small>Reposicion sugerida</small></article>
        <article class="summary-card"><span>Sin stock</span><strong>${esc(String(alerts.noStock.length))}</strong><small>Items agotados</small></article>
        <article class="summary-card"><span>Movimientos borrador</span><strong>${esc(String(alerts.draftMovements.length))}</strong><small>Aun no afectan stock</small></article>
        <article class="summary-card"><span>Entradas compras pendientes</span><strong>${esc(String(inventoryService.purchasesPendingInventory().length))}</strong><small>Listas para generar</small></article>
      </section>
    `;
  }

  function renderItemEditor(routeId) {
    ensureItemDraft(uiState.catalog.itemDraft?.category || "SUMINISTRO");
    const draft = uiState.catalog.itemDraft;
    const accounts = movementOptions();
    const warehouses = activeWarehouses();
    const costCenters = activeCostCenters();
    const responsibles = activeResponsibles();
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">PARAMETRIZACION</p>
            <h3>${draft.id ? "Editar material parametrizado" : "Nuevo material parametrizado"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-item-reset>Nuevo</button>
            <button class="secondary-button" type="button" data-item-save>Guardar item</button>
          </div>
        </div>
        <form id="inventory-item-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo interno</span><input name="code" value="${esc(draft.code || "")}"></label>
          <label class="compact-field"><span>Codigo de barras</span><input name="barcode" value="${esc(draft.barcode || "")}"></label>
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(draft.name || "")}"></label>
          <label class="compact-field">
            <span>Categoria</span>
            <select name="category">
              ${inventoryService.itemCategories.map(item => `<option value="${esc(item)}" ${draft.category === item ? "selected" : ""}>${esc(categoryLabel(item))}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Tipo / material</span>
            <select name="subcategory">
              ${subcategoryOptions(draft.category, draft.subcategory).map(item => `<option value="${esc(item)}" ${draft.subcategory === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Unidad</span>
            <select name="unit">
              ${inventoryService.itemUnits.map(item => `<option value="${esc(item)}" ${draft.unit === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta inventario</span>
            <select name="inventoryAccountCode">
              <option value="">Seleccionar cuenta</option>
              ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.inventoryAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta consumo / gasto / costo</span>
            <select name="expenseAccountCode">
              <option value="">Seleccionar cuenta</option>
              ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.expenseAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Stock minimo</span><input name="minStock" type="number" min="0" step="0.01" value="${esc(String(draft.minStock || 0))}"></label>
          <label class="compact-field"><span>Stock maximo</span><input name="maxStock" type="number" min="0" step="0.01" value="${esc(String(draft.maxStock || 0))}"></label>
          <label class="compact-field">
            <span>Bodega principal</span>
            <select name="warehouseId">
              <option value="">Seleccionar bodega</option>
              ${warehouses.map(item => `<option value="${esc(item.id)}" ${draft.warehouseId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Centro costo predeterminado</span>
            <select name="defaultCostCenter">
              <option value="">Principal / sin centro</option>
              ${costCenters.map(item => `<option value="${esc(item.code)}" ${draft.defaultCostCenter === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Responsable predeterminado</span>
            <select name="defaultResponsibleId">
              <option value="">Seleccionar responsable</option>
              ${responsibles.map(item => `<option value="${esc(item.id)}" ${draft.defaultResponsibleId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field compact-checkbox-field"><input name="requiresCostCenter" type="checkbox" ${draft.requiresCostCenter ? "checked" : ""}><span>Solicitar centro de costo</span></label>
          <label class="compact-field compact-checkbox-field"><input name="requiresLot" type="checkbox" ${draft.requiresLot ? "checked" : ""}><span>Requiere lote</span></label>
          <label class="compact-field compact-checkbox-field"><input name="requiresExpiry" type="checkbox" ${draft.requiresExpiry ? "checked" : ""}><span>Requiere vencimiento</span></label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              <option value="activo" ${draft.status === "activo" ? "selected" : ""}>activo</option>
              <option value="inactivo" ${draft.status === "inactivo" ? "selected" : ""}>inactivo</option>
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
        </form>
      </article>
    `;
  }

  function renderWarehouseEditor() {
    ensureWarehouseDraft();
    const draft = uiState.catalog.warehouseDraft;
    const responsibles = activeResponsibles();
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BODEGAS</p>
            <h3>${draft.id ? "Editar bodega" : "Nueva bodega"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-warehouse-reset>Nuevo</button>
            <button class="secondary-button" type="button" data-warehouse-save>Guardar bodega</button>
          </div>
        </div>
        <form id="inventory-warehouse-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo</span><input name="code" value="${esc(draft.code || "")}"></label>
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(draft.name || "")}"></label>
          <label class="compact-field">
            <span>Responsable</span>
            <select name="responsible">
              <option value="">Seleccionar responsable</option>
              ${responsibles.map(item => `<option value="${esc(item.name)}" ${draft.responsible === item.name ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              <option value="activo" ${draft.status === "activo" ? "selected" : ""}>activo</option>
              <option value="inactivo" ${draft.status === "inactivo" ? "selected" : ""}>inactivo</option>
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
        </form>
      </article>
    `;
  }

  function renderResponsibleEditor() {
    ensureResponsibleDraft();
    const draft = uiState.catalog.responsibleDraft;
    const warehouses = inventoryService.warehouses({ status: "activo" });
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ENCARGADOS</p>
            <h3>${draft.id ? "Editar responsable" : "Nuevo responsable"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-responsible-reset>Nuevo</button>
            <button class="secondary-button" type="button" data-responsible-save>Guardar responsable</button>
          </div>
        </div>
        <form id="inventory-responsible-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo</span><input name="code" value="${esc(draft.code || "")}"></label>
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(draft.name || "")}"></label>
          <label class="compact-field"><span>Cargo</span><input name="role" value="${esc(draft.role || "")}"></label>
          <label class="compact-field"><span>Area</span><input name="area" value="${esc(draft.area || "")}"></label>
          <label class="compact-field">
            <span>Bodega asignada</span>
            <select name="warehouseId">
              <option value="">Sin bodega fija</option>
              ${warehouses.map(item => `<option value="${esc(item.id)}" ${draft.warehouseId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              ${inventoryService.responsibleStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
        </form>
      </article>
    `;
  }

  function renderCatalogTable(routeId) {
    const rows = filteredItems(routeId);
    const stockMap = stockByItemMap(routeId);
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CATALOGO</p>
            <h3>Materiales y suministros parametrizados</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-providers">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Categoria</th>
                <th>Tipo material</th>
                <th>Unidad</th>
                <th>Bodega</th>
                <th>Centro costo</th>
                <th>Responsable</th>
                <th>Stock actual</th>
                <th>Costo prom.</th>
                <th>Valor</th>
                <th>Min.</th>
                <th>Estado stock</th>
                <th>Estado ficha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => {
                const stock = stockMap[item.id] || { quantity: 0, averageCost: 0, value: 0, status: "sin stock" };
                return `
                  <tr>
                    <td><strong>${esc(item.code)}</strong></td>
                    <td>${esc(item.name)}</td>
                    <td>${esc(categoryLabel(item.category))}</td>
                    <td>${esc(item.subcategory)}</td>
                    <td>${esc(item.unit)}</td>
                    <td>${esc(inventoryService.warehouses().find(row => row.id === item.warehouseId)?.name || "-")}</td>
                    <td>${esc(item.defaultCostCenter || "Principal")}</td>
                    <td>${esc(item.defaultResponsibleName || "-")}</td>
                    <td>${esc(String(stock.quantity || 0))}</td>
                    <td>${money(stock.averageCost || 0)}</td>
                    <td>${money(stock.value || 0)}</td>
                    <td>${esc(String(item.minStock || 0))}</td>
                    <td>${statusBadge(stock.status)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td>
                      <div class="row-actions">
                        <button class="row-action-button" type="button" data-item-edit="${esc(item.id)}">Editar</button>
                        <button class="row-action-button" type="button" data-item-toggle="${esc(item.id)}">${item.status === "activo" ? "Inactivar" : "Activar"}</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="15"><div class="empty-inline">No hay materiales parametrizados para los filtros actuales.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderResponsiblesTable() {
    const rows = inventoryService.responsibles();
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">RESPONSABLES</p>
            <h3>Bodegueros y encargados parametrizados</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} registrados</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Area</th>
                <th>Bodega</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td><strong>${esc(item.code)}</strong></td>
                  <td>${esc(item.name)}</td>
                  <td>${esc(item.role || "-")}</td>
                  <td>${esc(item.area || "-")}</td>
                  <td>${esc(item.warehouseName || "-")}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-responsible-edit="${esc(item.id)}">Editar</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay responsables configurados.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderStockTable(routeId) {
    const rows = filteredStock(routeId);
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">STOCK</p>
            <h3>Reporte de existencias por material</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoria</th>
                <th>Bodega</th>
                <th>Stock</th>
                <th>Unidad</th>
                <th>Costo prom.</th>
                <th>Valor</th>
                <th>Min.</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td><strong>${esc(item.code)}</strong><small>${esc(item.name)}</small></td>
                  <td>${esc(categoryLabel(item.category))}</td>
                  <td>${esc(item.warehouseName || "-")}</td>
                  <td>${esc(String(item.quantity))}</td>
                  <td>${esc(item.unit)}</td>
                  <td>${money(item.averageCost)}</td>
                  <td>${money(item.value)}</td>
                  <td>${esc(String(item.minStock || 0))}</td>
                  <td>${statusBadge(item.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="9"><div class="empty-inline">No hay stock para los filtros actuales.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderAlertsCard() {
    const alerts = inventoryService.inventoryAlerts();
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ALERTAS</p>
            <h3>Radar de inventario</h3>
          </div>
        </div>
        <div class="info-stack">
          <div class="info-row"><strong>Bajo minimo</strong><span>${esc(String(alerts.lowStock.length))}</span></div>
          <div class="info-row"><strong>Sin stock</strong><span>${esc(String(alerts.noStock.length))}</span></div>
          <div class="info-row"><strong>Proximos a vencer</strong><span>${esc(String(alerts.expiring.length))}</span></div>
          <div class="info-row"><strong>Movimientos borrador</strong><span>${esc(String(alerts.draftMovements.length))}</span></div>
          <div class="info-row"><strong>Compras pendientes ingreso</strong><span>${esc(String(alerts.pendingPurchaseEntries.length))}</span></div>
          <div class="info-row"><strong>Compras parciales</strong><span>${esc(String(alerts.partialPurchaseEntries.length))}</span></div>
          <div class="info-row"><strong>Diferencias factura/inventario</strong><span>${esc(String(alerts.observedPurchaseDifferences.length))}</span></div>
          <div class="info-row"><strong>Items sin cuenta consumo</strong><span>${esc(String(alerts.productsWithoutExpenseAccount.length))}</span></div>
          <div class="info-row"><strong>Consumos pendientes asiento</strong><span>${esc(String(alerts.pendingAccounting.length))}</span></div>
          <div class="info-row"><strong>Entregas a proveedor pendientes</strong><span>${esc(String(alerts.pendingSupplierDeliveries.length))}</span></div>
          <div class="info-row"><strong>Movimientos anulados</strong><span>${esc(String(alerts.annulledMovements.length))}</span></div>
        </div>
      </article>
    `;
  }

  function renderPendingPurchases() {
    const rows = inventoryService.purchasesPendingInventory().slice(0, 5);
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">COMPRAS</p>
            <h3>Entradas pendientes desde compras</h3>
          </div>
          <div class="row-actions">
            <span class="status-badge pending">${esc(String(rows.length))} compras</span>
            <button class="row-action-button" type="button" data-route-link="inventory-purchase-entries">Abrir modulo</button>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Documento</th>
                <th>Proveedor</th>
                <th>Inventario factura</th>
                <th>Ingresado</th>
                <th>Diferencia</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td>${esc(row.accountingDate || row.issueDate || "-")}</td>
                  <td><strong>${esc(row.documentNumber)}</strong></td>
                  <td>${esc(row.supplierName)}</td>
                  <td>${money(row.inventoryLinesTotal || 0)}</td>
                  <td>${money(row.totalEntered || 0)}</td>
                  <td>${money(row.difference || 0)}</td>
                  <td>${statusBadge(row.inventoryStatus)}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-open-purchase-entry="${esc(row.purchaseId)}">Completar</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay compras pendientes de entrada a inventario.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function purchaseEntryRows() {
    return inventoryService.purchasesPendingInventory({
      search: uiState.purchaseEntries.search,
      inventoryStatus: uiState.purchaseEntries.inventoryStatus,
      includeAnnulled: uiState.purchaseEntries.includeAnnulled
    });
  }

  function purchaseEntryDraftTotals(draft) {
    const lines = draft?.lines || [];
    const currentEntry = lines.reduce((sum, line) => sum + Number((line.entryQuantity || 0) * (line.costUnit || 0)), 0);
    const previous = Number(draft?.totalPreviouslyEntered || 0);
    const inventoryTotal = Number(draft?.inventoryLinesTotal || 0);
    const totalEntered = previous + currentEntry;
    const pending = inventoryTotal - totalEntered;
    return {
      totalInvoice: Number(draft?.totalInvoice || 0),
      inventoryTotal,
      currentEntry,
      previous,
      totalEntered,
      pending,
      difference: inventoryTotal - totalEntered
    };
  }

  function renderPurchaseEntrySummaryCards() {
    const rows = purchaseEntryRows();
    return `
      <section class="summary-grid summary-grid-payables">
        <article class="summary-card"><span>Facturas inventario</span><strong>${esc(String(rows.length))}</strong><small>Compras con lineas inventariables</small></article>
        <article class="summary-card"><span>Pendientes</span><strong>${esc(String(rows.filter(item => item.inventoryStatus === "PENDIENTE_INVENTARIO").length))}</strong><small>Sin ingreso confirmado</small></article>
        <article class="summary-card"><span>Parciales</span><strong>${esc(String(rows.filter(item => item.inventoryStatus === "PARCIAL_INGRESADO").length))}</strong><small>Ingreso incompleto</small></article>
        <article class="summary-card"><span>Observadas</span><strong>${esc(String(rows.filter(item => item.inventoryStatus === "OBSERVADO").length))}</strong><small>Diferencias factura vs inventario</small></article>
      </section>
    `;
  }

  function renderPurchaseEntriesTable() {
    const rows = purchaseEntryRows();
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FACTURAS</p>
            <h3>Compras pendientes o relacionadas con inventario</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha compra</th>
                <th>Proveedor</th>
                <th>RUC</th>
                <th>Documento</th>
                <th>Autorizacion</th>
                <th>Total factura</th>
                <th>Total lineas inventario</th>
                <th>Ya ingresado</th>
                <th>Diferencia pendiente</th>
                <th>Estado inventario</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td>${esc(row.accountingDate || row.issueDate || "-")}</td>
                  <td>${esc(row.supplierName)}</td>
                  <td>${esc(row.supplierRuc)}</td>
                  <td><strong>${esc(row.documentNumber)}</strong></td>
                  <td>${esc(row.authorizationNumber || row.accessKey || "-")}</td>
                  <td>${money(row.totalInvoice || 0)}</td>
                  <td>${money(row.inventoryLinesTotal || 0)}</td>
                  <td>${money(row.totalEntered || 0)}</td>
                  <td>${money(row.difference || 0)}</td>
                  <td>${statusBadge(row.inventoryStatus)}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-purchase-entry-open="${esc(row.purchaseId)}">${row.totalPending > 0.01 ? "Registrar ingreso" : "Ver ingreso"}</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="11"><div class="empty-inline">No hay compras de inventario para los filtros actuales.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderPurchaseEntryEditor() {
    const draft = uiState.purchaseEntries.draft;
    if (!draft) {
      return `
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">INGRESO DESDE FACTURA</p>
              <h3>Selecciona una compra</h3>
            </div>
          </div>
          <div class="empty-inline">Abre una factura desde la tabla para completar productos, cantidades, bodega y cuentas antes de confirmar el ingreso real a inventario.</div>
        </article>
      `;
    }
    const totals = purchaseEntryDraftTotals(draft);
    const items = inventoryService.items({ status: "activo" });
    const costCenters = activeCostCenters();
    const responsibles = activeResponsibles();
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">INGRESO DESDE FACTURA</p>
            <h3>${esc(draft.documentNumber)}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-purchase-entry-refresh="${esc(draft.purchaseId)}">Recargar</button>
            <button class="secondary-button" type="button" data-purchase-entry-clear>Cerrar</button>
            <button class="secondary-button" type="button" data-purchase-entry-confirm>Confirmar ingreso</button>
          </div>
        </div>
        <div class="info-stack info-stack-compact">
          <div class="info-row"><strong>Proveedor</strong><span>${esc(draft.supplierName)} · ${esc(draft.supplierRuc)}</span></div>
          <div class="info-row"><strong>Comprobante</strong><span>${esc(draft.documentType || "-")} ${esc(draft.series || "-")} ${esc(draft.sequential || "-")}</span></div>
          <div class="info-row"><strong>Autorizacion / clave</strong><span>${esc(draft.authorizationNumber || draft.accessKey || "-")}</span></div>
        </div>
        <section class="summary-grid summary-grid-payables compact-top-gap">
          <article class="summary-card"><span>Total factura</span><strong>${money(totals.totalInvoice)}</strong><small>Documento sustento automatico</small></article>
          <article class="summary-card"><span>Total lineas inventario</span><strong>${money(totals.inventoryTotal)}</strong><small>Base inventariable</small></article>
          <article class="summary-card"><span>Ingreso actual</span><strong>${money(totals.currentEntry)}</strong><small>Movimiento en preparacion</small></article>
          <article class="summary-card"><span>Ya ingresado</span><strong>${money(totals.previous)}</strong><small>Movimientos confirmados previos</small></article>
          <article class="summary-card"><span>Pendiente</span><strong>${money(totals.pending)}</strong><small>Diferencia aun no ingresada</small></article>
          <article class="summary-card"><span>Diferencia</span><strong>${money(totals.difference)}</strong><small>Factura vs kardex</small></article>
        </section>
        <form id="inventory-purchase-entry-form" class="compact-form-grid compact-top-gap">
          <label class="compact-field"><span>Fecha ingreso</span><input name="movementDate" type="date" value="${esc(draft.movementDate || "")}"></label>
          <label class="compact-field">
            <span>Responsable</span>
            <select name="responsible">
              <option value="">Seleccionar encargado</option>
              ${responsibles.map(item => `<option value="${esc(item.name)}" ${draft.responsible === item.name ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
        </form>
        <div class="compact-table-wrap compact-top-gap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Linea</th>
                <th>Producto relacionado</th>
                <th>Codigo interno</th>
                <th>Nombre</th>
                <th>Unidad</th>
                <th>Cant. comprada</th>
                <th>Ya ingresada</th>
                <th>Pendiente</th>
                <th>Ingresar ahora</th>
                <th>Costo unit.</th>
                <th>Costo total</th>
                <th>Lote</th>
                <th>Centro costo</th>
              </tr>
            </thead>
            <tbody>
              ${draft.lines.map(line => `
                <tr data-purchase-line-id="${esc(line.lineId)}">
                  <td>
                    <strong>${esc(String(line.lineNumber || ""))}</strong>
                    <input type="hidden" name="category" value="${esc(line.category || "SUMINISTRO")}">
                    <input type="hidden" name="subcategory" value="${esc(line.subcategory || "otro")}">
                    <input type="hidden" name="warehouseId" value="${esc(line.warehouseId || "")}">
                    <input type="hidden" name="expiryDate" value="${esc(line.expiryDate || "")}">
                    <input type="hidden" name="inventoryAccountCode" value="${esc(line.inventoryAccountCode || "")}">
                    <input type="hidden" name="expenseAccountCode" value="${esc(line.expenseAccountCode || "")}">
                  </td>
                  <td>
                    <select name="itemId">
                      <option value="">Crear / no relacionado</option>
                      ${items.map(item => `<option value="${esc(item.id)}" ${line.itemId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                    </select>
                  </td>
                  <td><input name="code" value="${esc(line.code || "")}" placeholder="Codigo interno"></td>
                  <td><input name="name" value="${esc(line.name || "")}" placeholder="Nombre producto"></td>
                  <td>
                    <select name="unit">
                      ${inventoryService.itemUnits.map(item => `<option value="${esc(item)}" ${line.unit === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
                    </select>
                  </td>
                  <td>${esc(String(line.purchasedQuantity || 0))}</td>
                  <td>${esc(String(line.alreadyEnteredQuantity || 0))}</td>
                  <td>${esc(String(line.pendingQuantity || 0))}</td>
                  <td><input name="entryQuantity" type="number" min="0" step="0.01" max="${esc(String(line.pendingQuantity || 0))}" value="${esc(String(line.entryQuantity || 0))}"></td>
                  <td><input name="costUnit" type="number" min="0" step="0.01" value="${esc(String(line.costUnit || 0))}"></td>
                  <td><input name="entryTotal" type="number" min="0" step="0.01" value="${esc(String(line.entryTotal || 0))}" readonly></td>
                  <td><input name="lot" value="${esc(line.lot || "")}" ${line.requiresLot ? "" : "placeholder='Opcional'"}></td>
                  <td>
                    <select name="costCenter">
                      <option value="">Principal / sin centro</option>
                      ${costCenters.map(item => `<option value="${esc(item.code)}" ${line.costCenter === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                    </select>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="13"><div class="empty-inline">La factura ya no tiene lineas pendientes por ingresar.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderPurchaseEntries(container, route) {
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Ingreso real a stock desde factura</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.purchaseEntries.message ? `<section class="inline-feedback success">${esc(uiState.purchaseEntries.message)}</section>` : ""}
      ${uiState.purchaseEntries.errors.length ? `<section class="inline-feedback danger">${uiState.purchaseEntries.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${renderPurchaseEntrySummaryCards()}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-payables">
          <label class="compact-inline-field"><span>Buscar</span><input id="purchase-entry-search" value="${esc(uiState.purchaseEntries.search)}" placeholder="Proveedor, documento o autorizacion"></label>
          <label class="compact-inline-field">
            <span>Estado inventario</span>
            <select id="purchase-entry-status">
              <option value="">Todos</option>
              ${["PENDIENTE_INVENTARIO", "PARCIAL_INGRESADO", "INGRESADO_TOTAL", "OBSERVADO", "ANULADO"].map(item => `<option value="${esc(item)}" ${uiState.purchaseEntries.inventoryStatus === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field compact-checkbox-field">
            <input id="purchase-entry-include-annulled" type="checkbox" ${uiState.purchaseEntries.includeAnnulled ? "checked" : ""}>
            <span>Incluir anuladas</span>
          </label>
        </div>
      </section>
      ${uiState.purchaseEntries.draft
        ? `<section class="purchase-entry-focus-layout">${renderPurchaseEntryEditor()}</section>`
        : `<section class="placeholder-grid">${renderPurchaseEntriesTable()}</section>`}
    `;
    bindPurchaseEntries();
  }

  function renderRosesPlaceholder(route) {
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge pending">Conexion futura</span>
        </div>
      </section>
      ${routeTabs(route)}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">PARTE 1</p><h3>Este panel no se implementa aqui</h3></div>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Estado</strong><span>Fase futura / conectado desde Parte 1</span></div>
            <div class="info-row"><strong>Alcance</strong><span>Rosas, disponibilidad, clasificacion y poscosecha quedan fuera del inventario administrativo.</span></div>
            <div class="info-row"><strong>Accion actual</strong><span>No funcional dentro de este modulo.</span></div>
          </div>
        </article>
      </section>
    `;
  }

  function renderCatalogPage(container, route) {
    ensureItemDraft(uiState.catalog.itemDraft?.category || "SUMINISTRO");
    ensureWarehouseDraft();
    ensureResponsibleDraft();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Inventario administrativo activo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.catalog.message ? `<section class="inline-feedback success">${esc(uiState.catalog.message)}</section>` : ""}
      ${uiState.catalog.errors.length ? `<section class="inline-feedback danger">${uiState.catalog.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${summaryCards(route.id)}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-inventory">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="inventory-search" placeholder="Codigo, nombre o categoria" value="${esc(uiState.catalog.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Estado ficha</span>
            <select id="inventory-status-filter">
              <option value="">Todos</option>
              <option value="activo" ${uiState.catalog.status === "activo" ? "selected" : ""}>activo</option>
              <option value="inactivo" ${uiState.catalog.status === "inactivo" ? "selected" : ""}>inactivo</option>
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo material</span>
            <select id="inventory-category-filter">
              <option value="">Todos</option>
              ${inventoryService.itemCategories.map(item => `<option value="${esc(item)}" ${uiState.catalog.category === item ? "selected" : ""}>${esc(categoryLabel(item))}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Bodega</span>
            <select id="inventory-warehouse-filter">
              <option value="">Todas</option>
              ${inventoryService.warehouses().map(item => `<option value="${esc(item.id)}" ${uiState.catalog.warehouseId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-item-reset>Nuevo item</button>
            <button class="secondary-button" type="button" data-warehouse-reset>Nueva bodega</button>
            <button class="secondary-button" type="button" data-responsible-reset>Nuevo responsable</button>
          </div>
        </div>
      </section>
      <section class="placeholder-grid purchase-editor-layout">
        ${renderItemEditor(route.id)}
        <div class="panel-stack">
          ${renderWarehouseEditor()}
          ${renderResponsibleEditor()}
        </div>
      </section>
      <section class="placeholder-grid">
        ${renderCatalogTable(route.id)}
        ${renderAlertsCard()}
      </section>
      <section class="placeholder-grid">
        ${renderStockTable(route.id)}
        ${renderPendingPurchases()}
      </section>
      <section class="placeholder-grid">
        ${renderResponsiblesTable()}
      </section>
    `;
    bindCatalog(route.id);
  }

  function movementTypesForConsumptions() {
    return ["SALIDA_CONSUMO", "SALIDA_EMPAQUE", "SALIDA_CAMPO", "SALIDA_PROVEEDOR"];
  }

  function movementTypesForAdjustments() {
    return ["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "ENTRADA_AJUSTE"];
  }

  function ensureConsumptionDraft() {
    uiState.consumptions.draft = uiState.consumptions.draft || inventoryService.emptyMovement(uiState.consumptions.movementType);
  }

  function ensureAdjustmentDraft() {
    uiState.adjustments.draft = uiState.adjustments.draft || inventoryService.emptyMovement(uiState.adjustments.movementType);
  }

  function stockCostForItem(itemId, warehouseId) {
    const row = inventoryService.stockSummary({ warehouseId }).find(item => item.itemId === itemId);
    return row?.averageCost || 0;
  }

  function renderMovementForm(draft, { formId, title, allowSupplier = false, adjustmentMode = false }) {
    const items = inventoryService.items({ status: "activo" });
    const warehouses = inventoryService.warehouses({ status: "activo" });
    const accounts = movementOptions();
    const costCenters = activeCostCenters();
    const responsibles = activeResponsibles();
    const typeOptions = adjustmentMode ? movementTypesForAdjustments() : movementTypesForConsumptions();
    return `
      <article class="panel-card editor-card" data-movement-section="${esc(formId)}">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FORMULARIO</p>
            <h3>${esc(title)}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-movement-reset="${esc(formId)}">Nuevo</button>
            <button class="secondary-button" type="button" data-movement-save="${esc(formId)}">Guardar borrador</button>
            <button class="secondary-button" type="button" data-movement-confirm="${esc(formId)}">Confirmar</button>
          </div>
        </div>
        <form id="${esc(formId)}" class="compact-form-grid">
          <label class="compact-field"><span>Numero</span><input name="movementNumber" value="${esc(draft.movementNumber || "")}" readonly></label>
          <label class="compact-field"><span>Fecha</span><input name="movementDate" type="date" value="${esc(draft.movementDate || "")}"></label>
          <label class="compact-field">
            <span>Tipo</span>
            <select name="movementType">
              ${typeOptions.map(item => `<option value="${esc(item)}" ${draft.movementType === item ? "selected" : ""}>${esc(inventoryService.movementTypeLabels[item] || item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Bodega origen</span>
            <select name="warehouseFromId">
              <option value="">Seleccionar</option>
              ${warehouses.map(item => `<option value="${esc(item.id)}" ${draft.warehouseFromId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          ${adjustmentMode ? "" : `<label class="compact-field"><span>Centro costo</span><select name="costCenter"><option value="">Principal / sin centro</option>${costCenters.map(item => `<option value="${esc(item.code)}" ${draft.costCenter === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}</select></label>`}
          <label class="compact-field"><span>Responsable</span><select name="responsible"><option value="">Seleccionar encargado</option>${responsibles.map(item => `<option value="${esc(item.name)}" ${draft.responsible === item.name ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}</select></label>
          ${allowSupplier ? `<label class="compact-field"><span>Proveedor</span><input name="supplierName" value="${esc(draft.supplierName || "")}"></label>` : ""}
          ${adjustmentMode ? `
            <label class="compact-field">
              <span>Cuenta contrapartida</span>
              <select name="counterAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.counterAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
          ` : ""}
          <label class="compact-field"><span>Documento origen</span><input name="documentOrigin" value="${esc(draft.documentOrigin || "")}"></label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
        </form>
        <div class="journal-lines-head">
          <div>
            <p class="section-kicker">DETALLE</p>
            <h3>Lineas del movimiento</h3>
          </div>
          <button class="secondary-button" type="button" data-movement-add-line="${esc(formId)}">Agregar linea</button>
        </div>
        <div class="compact-table-wrap" data-movement-lines="${esc(formId)}">
          <table class="compact-table compact-table-payments-detail">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Unidad</th>
                <th>Costo unitario</th>
                <th>Costo total</th>
                <th>Lote</th>
                <th>Vencimiento</th>
                <th>Cuenta inventario</th>
                ${adjustmentMode ? "" : `<th>Cuenta gasto/costo</th>`}
                <th>Centro costo</th>
                <th>Observacion</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${(draft.lines || []).map(line => `
                <tr data-line-id="${esc(line.id)}">
                  <td>
                    <select name="itemId">
                      <option value="">Seleccionar item</option>
                      ${items.map(item => `<option value="${esc(item.id)}" ${line.itemId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                    </select>
                  </td>
                  <td><input name="quantity" type="number" min="0" step="0.01" value="${esc(String(line.quantity || 0))}"></td>
                  <td><input name="unit" value="${esc(line.unit || "")}"></td>
                  <td><input name="costUnit" type="number" min="0" step="0.01" value="${esc(String(line.costUnit || 0))}"></td>
                  <td><input name="costTotal" type="number" min="0" step="0.01" value="${esc(String(line.costTotal || 0))}"></td>
                  <td><input name="lot" value="${esc(line.lot || "")}"></td>
                  <td><input name="expiryDate" type="date" value="${esc(line.expiryDate || "")}"></td>
                  <td>
                    <select name="inventoryAccountCode">
                      <option value="">Seleccionar cuenta</option>
                      ${accounts.map(item => `<option value="${esc(item.code)}" ${line.inventoryAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                    </select>
                  </td>
                  ${adjustmentMode ? "" : `
                    <td>
                      <select name="expenseAccountCode">
                        <option value="">Seleccionar cuenta</option>
                        ${accounts.map(item => `<option value="${esc(item.code)}" ${line.expenseAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                      </select>
                    </td>
                  `}
                  <td>
                    <select name="costCenter">
                      <option value="">Principal / sin centro</option>
                      ${costCenters.map(item => `<option value="${esc(item.code)}" ${String(line.costCenter || draft.costCenter || "") === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                    </select>
                  </td>
                  <td><input name="observation" value="${esc(line.observation || "")}"></td>
                  <td><button class="row-action-button" type="button" data-movement-remove-line="${esc(formId)}|${esc(line.id)}">Quitar</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderMovementTable(rows, formId) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">MOVIMIENTOS</p>
            <h3>Historial</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Numero</th>
                <th>Tipo</th>
                <th>Bodega</th>
                <th>Documento</th>
                <th>Responsable</th>
                <th>Total lineas</th>
                <th>Asiento</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.movementDate)}</td>
                  <td><strong>${esc(item.movementNumber)}</strong></td>
                  <td>${esc(inventoryService.movementTypeLabels[item.movementType] || item.movementType)}</td>
                  <td>${esc(item.warehouseFromName || item.warehouseToName || "-")}</td>
                  <td>${esc(item.documentOrigin || "-")}</td>
                  <td>${esc(item.responsible || "-")}</td>
                  <td>${esc(String(item.lines.length))}</td>
                  <td>${esc(item.journalEntryNumber || "-")}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>
                    <div class="row-actions">
                      ${item.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-movement-load="${esc(formId)}|${esc(item.id)}">Editar</button><button class="row-action-button" type="button" data-movement-confirm-row="${esc(formId)}|${esc(item.id)}">Confirmar</button>` : ""}
                      ${item.status === "CONFIRMADO" ? `<button class="row-action-button" type="button" data-movement-annul="${esc(formId)}|${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay movimientos para los filtros actuales.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderConsumptions(container, route) {
    ensureConsumptionDraft();
    const rows = inventoryService.movements({
      movementType: movementTypesForConsumptions(),
      status: uiState.consumptions.status
    }).filter(item => {
      if (!uiState.consumptions.search) return true;
      const haystack = [item.movementNumber, item.documentOrigin, item.supplierName, item.observation].join(" ").toLowerCase();
      return haystack.includes(uiState.consumptions.search.toLowerCase());
    });
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Consumir genera asiento</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.consumptions.message ? `<section class="inline-feedback success">${esc(uiState.consumptions.message)}</section>` : ""}
      ${uiState.consumptions.errors.length ? `<section class="inline-feedback danger">${uiState.consumptions.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-payables">
          <label class="compact-inline-field"><span>Buscar</span><input id="consumption-search" value="${esc(uiState.consumptions.search)}" placeholder="Numero, documento, observacion"></label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="consumption-status-filter">
              <option value="">Todos</option>
              ${inventoryService.movementStates.map(item => `<option value="${esc(item)}" ${uiState.consumptions.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="consumption-type-filter">
              ${movementTypesForConsumptions().map(item => `<option value="${esc(item)}" ${uiState.consumptions.draft.movementType === item ? "selected" : ""}>${esc(inventoryService.movementTypeLabels[item])}</option>`).join("")}
            </select>
          </label>
        </div>
      </section>
      <section class="placeholder-grid purchase-editor-layout">
        ${renderMovementForm(uiState.consumptions.draft, {
          formId: "inventory-consumption-form",
          title: "Consumo, salida a proceso o entrega a proveedor",
          allowSupplier: uiState.consumptions.draft.movementType === "SALIDA_PROVEEDOR",
          adjustmentMode: false
        })}
        ${renderAlertsCard()}
      </section>
      ${renderMovementTable(rows, "inventory-consumption-form")}
    `;
    bindMovementSection("inventory-consumption-form", false);
  }

  function renderAdjustments(container, route) {
    ensureAdjustmentDraft();
    const rows = inventoryService.movements({
      movementType: movementTypesForAdjustments(),
      status: uiState.adjustments.status
    }).filter(item => {
      if (!uiState.adjustments.search) return true;
      const haystack = [item.movementNumber, item.documentOrigin, item.observation].join(" ").toLowerCase();
      return haystack.includes(uiState.adjustments.search.toLowerCase());
    });
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Ajustes con reverso contable</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.adjustments.message ? `<section class="inline-feedback success">${esc(uiState.adjustments.message)}</section>` : ""}
      ${uiState.adjustments.errors.length ? `<section class="inline-feedback danger">${uiState.adjustments.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-payables">
          <label class="compact-inline-field"><span>Buscar</span><input id="adjustment-search" value="${esc(uiState.adjustments.search)}" placeholder="Numero o observacion"></label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="adjustment-status-filter">
              <option value="">Todos</option>
              ${inventoryService.movementStates.map(item => `<option value="${esc(item)}" ${uiState.adjustments.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="adjustment-type-filter">
              ${movementTypesForAdjustments().map(item => `<option value="${esc(item)}" ${uiState.adjustments.draft.movementType === item ? "selected" : ""}>${esc(inventoryService.movementTypeLabels[item])}</option>`).join("")}
            </select>
          </label>
        </div>
      </section>
      <section class="placeholder-grid purchase-editor-layout">
        ${renderMovementForm(uiState.adjustments.draft, {
          formId: "inventory-adjustment-form",
          title: "Ajustes positivos y negativos",
          allowSupplier: false,
          adjustmentMode: true
        })}
        ${renderStockTable("inventory-summary")}
      </section>
      ${renderMovementTable(rows, "inventory-adjustment-form")}
    `;
    bindMovementSection("inventory-adjustment-form", true);
  }

  function renderKardex(container, route) {
    const rows = inventoryService.kardex(uiState.kardex);
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Solo movimientos confirmados</span>
        </div>
      </section>
      ${routeTabs(route)}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-payables">
          <label class="compact-inline-field">
            <span>Producto</span>
            <select id="kardex-product-filter">
              <option value="">Todos</option>
              ${inventoryService.items().map(item => `<option value="${esc(item.id)}" ${uiState.kardex.productId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Categoria</span>
            <select id="kardex-category-filter">
              <option value="">Todas</option>
              ${inventoryService.itemCategories.map(item => `<option value="${esc(item)}" ${uiState.kardex.category === item ? "selected" : ""}>${esc(categoryLabel(item))}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Bodega</span>
            <select id="kardex-warehouse-filter">
              <option value="">Todas</option>
              ${inventoryService.warehouses().map(item => `<option value="${esc(item.id)}" ${uiState.kardex.warehouseId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="kardex-type-filter">
              <option value="">Todos</option>
              ${inventoryService.movementTypes.map(item => `<option value="${esc(item)}" ${uiState.kardex.movementType === item ? "selected" : ""}>${esc(inventoryService.movementTypeLabels[item])}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Desde</span><input id="kardex-date-from" type="date" value="${esc(uiState.kardex.dateFrom || "")}"></label>
          <label class="compact-inline-field"><span>Hasta</span><input id="kardex-date-to" type="date" value="${esc(uiState.kardex.dateTo || "")}"></label>
          <label class="compact-inline-field"><span>Buscar</span><input id="kardex-search" value="${esc(uiState.kardex.search || "")}" placeholder="Producto o documento"></label>
        </div>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">KARDEX</p>
            <h3>Movimientos por item y bodega</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} filas</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento</th>
                <th>Tipo</th>
                <th>Documento sustento</th>
                <th>Proveedor</th>
                <th>Factura relacionada</th>
                <th>Linea compra</th>
                <th>Tipo origen</th>
                <th>Producto</th>
                <th>Bodega</th>
                <th>Entrada cant.</th>
                <th>Entrada valor</th>
                <th>Salida cant.</th>
                <th>Salida valor</th>
                <th>Saldo cant.</th>
                <th>Costo prom.</th>
                <th>Saldo valor</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.date)}</td>
                  <td><strong>${esc(item.movementNumber)}</strong></td>
                  <td>${esc(item.movementTypeLabel)}</td>
                  <td>${esc(item.supportDocument || item.documentOrigin)}</td>
                  <td>${esc(item.supplierName || "-")}</td>
                  <td>${esc(item.purchaseDocumentNumber || "-")}</td>
                  <td>${esc(item.sourceLineNumber ? `Linea ${item.sourceLineNumber}` : "-")}</td>
                  <td>${esc(item.sourceType || "-")}</td>
                  <td>${esc(item.itemCode)}<small>${esc(item.itemName)}</small></td>
                  <td>${esc(item.warehouseName || "-")}</td>
                  <td>${esc(String(item.entryQty || 0))}</td>
                  <td>${money(item.entryValue || 0)}</td>
                  <td>${esc(String(item.exitQty || 0))}</td>
                  <td>${money(item.exitValue || 0)}</td>
                  <td>${esc(String(item.balanceQty || 0))}</td>
                  <td>${money(item.averageCost || 0)}</td>
                  <td>${money(item.balanceValue || 0)}</td>
                  <td>${esc(item.responsible || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="18"><div class="empty-inline">No hay movimientos confirmados para los filtros seleccionados.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindKardex();
  }

  function collectItemDraft() {
    const form = document.querySelector("#inventory-item-form");
    const base = clone(uiState.catalog.itemDraft || {});
    if (!form) return base;
    return {
      ...base,
      code: form.elements.code?.value || "",
      barcode: form.elements.barcode?.value || "",
      name: form.elements.name?.value || "",
      category: form.elements.category?.value || "SUMINISTRO",
      subcategory: form.elements.subcategory?.value || "otro",
      unit: form.elements.unit?.value || "unidad",
      inventoryAccountCode: form.elements.inventoryAccountCode?.value || "",
      expenseAccountCode: form.elements.expenseAccountCode?.value || "",
      defaultCostCenter: form.elements.defaultCostCenter?.value || "",
      requiresCostCenter: Boolean(form.elements.requiresCostCenter?.checked),
      defaultResponsibleId: form.elements.defaultResponsibleId?.value || "",
      minStock: Number(form.elements.minStock?.value || 0),
      maxStock: Number(form.elements.maxStock?.value || 0),
      warehouseId: form.elements.warehouseId?.value || "",
      requiresLot: Boolean(form.elements.requiresLot?.checked),
      requiresExpiry: Boolean(form.elements.requiresExpiry?.checked),
      status: form.elements.status?.value || "activo",
      observation: form.elements.observation?.value || ""
    };
  }

  function collectResponsibleDraft() {
    const form = document.querySelector("#inventory-responsible-form");
    const base = clone(uiState.catalog.responsibleDraft || {});
    if (!form) return base;
    return {
      ...base,
      code: form.elements.code?.value || "",
      name: form.elements.name?.value || "",
      role: form.elements.role?.value || "",
      area: form.elements.area?.value || "",
      warehouseId: form.elements.warehouseId?.value || "",
      status: form.elements.status?.value || "activo",
      observation: form.elements.observation?.value || ""
    };
  }

  function collectPurchaseEntryDraft() {
    const base = clone(uiState.purchaseEntries.draft || {});
    const form = document.querySelector("#inventory-purchase-entry-form");
    if (form) {
      base.movementDate = form.elements.movementDate?.value || base.movementDate || "";
      base.responsible = form.elements.responsible?.value || base.responsible || "";
      base.observation = form.elements.observation?.value || base.observation || "";
    }
    base.lines = (base.lines || []).map(line => {
      const row = document.querySelector(`tr[data-purchase-line-id="${line.lineId}"]`);
      if (!row) return line;
      const itemId = row.querySelector('[name="itemId"]')?.value || "";
      const linkedItem = itemId ? inventoryService.findItemById(itemId) : null;
      const category = row.querySelector('[name="category"]')?.value || line.category || "OTRO";
      const subcategory = row.querySelector('[name="subcategory"]')?.value || line.subcategory || "otro";
      const costUnit = Number(row.querySelector('[name="costUnit"]')?.value || 0);
      const entryQuantity = Number(row.querySelector('[name="entryQuantity"]')?.value || 0);
      return {
        ...line,
        itemId,
        code: row.querySelector('[name="code"]')?.value || linkedItem?.code || "",
        name: row.querySelector('[name="name"]')?.value || linkedItem?.name || "",
        category,
        subcategory,
        unit: row.querySelector('[name="unit"]')?.value || linkedItem?.unit || line.unit || "",
        entryQuantity,
        costUnit,
        entryTotal: entryQuantity * costUnit,
        warehouseId: row.querySelector('[name="warehouseId"]')?.value || linkedItem?.warehouseId || "",
        lot: row.querySelector('[name="lot"]')?.value || "",
        expiryDate: row.querySelector('[name="expiryDate"]')?.value || "",
        inventoryAccountCode: row.querySelector('[name="inventoryAccountCode"]')?.value || linkedItem?.inventoryAccountCode || "",
        expenseAccountCode: row.querySelector('[name="expenseAccountCode"]')?.value || linkedItem?.expenseAccountCode || "",
        costCenter: row.querySelector('[name="costCenter"]')?.value || linkedItem?.defaultCostCenter || "",
        responsibleId: linkedItem?.defaultResponsibleId || line.responsibleId || "",
        requiresLot: ["QUIMICO", "FERTILIZANTE"].includes(String(category || "").toUpperCase()),
        requiresExpiry: ["QUIMICO", "FERTILIZANTE"].includes(String(category || "").toUpperCase())
      };
    });
    return base;
  }

  function bindPurchaseEntries() {
    document.querySelector("#purchase-entry-search")?.addEventListener("input", event => {
      uiState.purchaseEntries.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#purchase-entry-status")?.addEventListener("change", event => {
      uiState.purchaseEntries.inventoryStatus = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#purchase-entry-include-annulled")?.addEventListener("change", event => {
      uiState.purchaseEntries.includeAnnulled = event.target.checked;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-purchase-entry-open]").forEach(button => button.addEventListener("click", () => {
      const result = inventoryService.preparePurchaseEntryDraft(button.dataset.purchaseEntryOpen);
      uiState.purchaseEntries.errors = result.errors || [];
      uiState.purchaseEntries.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.purchaseEntries.selectedPurchaseId = button.dataset.purchaseEntryOpen || "";
      uiState.purchaseEntries.draft = clone(result.draft);
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-purchase-entry-clear]")?.addEventListener("click", () => {
      uiState.purchaseEntries.selectedPurchaseId = "";
      uiState.purchaseEntries.draft = null;
      uiState.purchaseEntries.errors = [];
      uiState.purchaseEntries.message = "";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-purchase-entry-refresh]")?.addEventListener("click", () => {
      const result = inventoryService.preparePurchaseEntryDraft(uiState.purchaseEntries.selectedPurchaseId);
      uiState.purchaseEntries.errors = result.errors || [];
      uiState.purchaseEntries.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.purchaseEntries.draft = clone(result.draft);
      BlessERP.layout.renderPage();
    });
    document.querySelector("#inventory-purchase-entry-form")?.addEventListener("change", () => {
      uiState.purchaseEntries.draft = collectPurchaseEntryDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("tr[data-purchase-line-id]").forEach(row => {
      row.addEventListener("change", event => {
        if (event.target.name !== "itemId") {
          uiState.purchaseEntries.draft = collectPurchaseEntryDraft();
          return;
        }
        const item = inventoryService.findItemById(event.target.value);
        if (!item) {
          uiState.purchaseEntries.draft = collectPurchaseEntryDraft();
          return BlessERP.layout.renderPage();
        }
        row.querySelector('[name="code"]').value = item.code || "";
        row.querySelector('[name="name"]').value = item.name || "";
        row.querySelector('[name="category"]').value = item.category || "";
        row.querySelector('[name="subcategory"]').value = item.subcategory || "";
        row.querySelector('[name="unit"]').value = item.unit || "";
        row.querySelector('[name="warehouseId"]').value = item.warehouseId || "";
        row.querySelector('[name="inventoryAccountCode"]').value = item.inventoryAccountCode || "";
        row.querySelector('[name="expenseAccountCode"]').value = item.expenseAccountCode || "";
        const costCenterField = row.querySelector('[name="costCenter"]');
        if (costCenterField) costCenterField.value = item.defaultCostCenter || costCenterField.value || "";
        const responsibleField = document.querySelector('#inventory-purchase-entry-form [name="responsible"]');
        if (responsibleField && !responsibleField.value && item.defaultResponsibleName) responsibleField.value = item.defaultResponsibleName;
        uiState.purchaseEntries.draft = collectPurchaseEntryDraft();
        BlessERP.layout.renderPage();
      });
    });
    document.querySelector("[data-purchase-entry-confirm]")?.addEventListener("click", () => {
      const result = inventoryService.confirmPurchaseEntryDraft(collectPurchaseEntryDraft());
      uiState.purchaseEntries.errors = result.errors || [];
      uiState.purchaseEntries.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      const nextDraft = result.refreshed?.totalPending > 0.01
        ? inventoryService.preparePurchaseEntryDraft(result.refreshed.purchaseId)
        : null;
      uiState.purchaseEntries.message = `Ingreso confirmado desde ${result.refreshed?.documentNumber || "factura"}. Se generaron ${result.movements.length} movimiento(s).`;
      uiState.purchaseEntries.selectedPurchaseId = result.refreshed?.purchaseId || "";
      uiState.purchaseEntries.draft = nextDraft?.ok ? clone(nextDraft.draft) : null;
      BlessERP.layout.renderPage();
    });
  }

  function collectWarehouseDraft() {
    const form = document.querySelector("#inventory-warehouse-form");
    const base = clone(uiState.catalog.warehouseDraft || {});
    if (!form) return base;
    return {
      ...base,
      code: form.elements.code?.value || "",
      name: form.elements.name?.value || "",
      responsible: form.elements.responsible?.value || "",
      status: form.elements.status?.value || "activo",
      observation: form.elements.observation?.value || ""
    };
  }

  function movementDraftState(formId) {
    return formId === "inventory-adjustment-form" ? uiState.adjustments : uiState.consumptions;
  }

  function collectMovementDraft(formId) {
    const state = movementDraftState(formId);
    const form = document.querySelector(`#${formId}`);
    const base = clone(state.draft || inventoryService.emptyMovement());
    if (!form) return base;
    const section = document.querySelector(`[data-movement-section="${formId}"]`);
    const linesWrap = section?.querySelector(`[data-movement-lines="${formId}"]`);
    const lines = Array.from(linesWrap?.querySelectorAll("tbody tr[data-line-id]") || []);
    return {
      ...base,
      movementNumber: form.elements.movementNumber?.value || base.movementNumber,
      movementDate: form.elements.movementDate?.value || "",
      movementType: form.elements.movementType?.value || base.movementType,
      warehouseFromId: form.elements.warehouseFromId?.value || "",
      responsible: form.elements.responsible?.value || "",
      documentOrigin: form.elements.documentOrigin?.value || "",
      observation: form.elements.observation?.value || "",
      costCenter: form.elements.costCenter?.value || "",
      supplierName: form.elements.supplierName?.value || "",
      counterAccountCode: form.elements.counterAccountCode?.value || "",
      originModule: base.originModule || "manual",
      lines: lines.map(row => ({
        id: row.dataset.lineId,
        itemId: row.querySelector('[name="itemId"]')?.value || "",
        quantity: Number(row.querySelector('[name="quantity"]')?.value || 0),
        unit: row.querySelector('[name="unit"]')?.value || "unidad",
        costUnit: Number(row.querySelector('[name="costUnit"]')?.value || 0),
        costTotal: Number(row.querySelector('[name="costTotal"]')?.value || 0),
        lot: row.querySelector('[name="lot"]')?.value || "",
        expiryDate: row.querySelector('[name="expiryDate"]')?.value || "",
        inventoryAccountCode: row.querySelector('[name="inventoryAccountCode"]')?.value || "",
        expenseAccountCode: row.querySelector('[name="expenseAccountCode"]')?.value || "",
        costCenter: row.querySelector('[name="costCenter"]')?.value || "",
        observation: row.querySelector('[name="observation"]')?.value || ""
      }))
    };
  }

  function bindCatalog(routeId) {
    document.querySelector("#inventory-search")?.addEventListener("input", event => {
      uiState.catalog.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#inventory-status-filter")?.addEventListener("change", event => {
      uiState.catalog.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#inventory-category-filter")?.addEventListener("change", event => {
      uiState.catalog.category = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#inventory-warehouse-filter")?.addEventListener("change", event => {
      uiState.catalog.warehouseId = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#inventory-item-form")?.addEventListener("change", event => {
      uiState.catalog.itemDraft = collectItemDraft();
      if (["category", "warehouseId", "defaultResponsibleId"].includes(event.target.name)) BlessERP.layout.renderPage();
    });
    document.querySelector("[data-item-reset]")?.addEventListener("click", () => {
      uiState.catalog.itemDraft = null;
      ensureItemDraft(uiState.catalog.category || "SUMINISTRO");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-item-save]")?.addEventListener("click", () => {
      const result = inventoryService.saveItem(collectItemDraft());
      uiState.catalog.errors = result.errors || [];
      uiState.catalog.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.catalog.itemDraft = clone(result.item);
      uiState.catalog.message = `Item ${result.item.code} guardado correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-warehouse-reset]")?.addEventListener("click", () => {
      uiState.catalog.warehouseDraft = inventoryService.emptyWarehouse();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-warehouse-save]")?.addEventListener("click", () => {
      const result = inventoryService.saveWarehouse(collectWarehouseDraft());
      uiState.catalog.errors = result.errors || [];
      uiState.catalog.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.catalog.warehouseDraft = clone(result.warehouse);
      uiState.catalog.message = `Bodega ${result.warehouse.name} guardada correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-responsible-reset]")?.addEventListener("click", () => {
      uiState.catalog.responsibleDraft = inventoryService.emptyResponsible();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-responsible-save]")?.addEventListener("click", () => {
      const result = inventoryService.saveResponsible(collectResponsibleDraft());
      uiState.catalog.errors = result.errors || [];
      uiState.catalog.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.catalog.responsibleDraft = clone(result.responsible);
      uiState.catalog.message = `Responsable ${result.responsible.name} guardado correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-item-edit]").forEach(button => button.addEventListener("click", () => {
      const item = inventoryService.items().find(entry => entry.id === button.dataset.itemEdit);
      if (!item) return;
      uiState.catalog.itemDraft = clone(item);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-item-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = inventoryService.toggleItemStatus(button.dataset.itemToggle);
      uiState.catalog.errors = [];
      uiState.catalog.message = result.ok ? "Estado del item actualizado." : (result.message || "");
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-responsible-edit]").forEach(button => button.addEventListener("click", () => {
      const responsible = inventoryService.responsibles().find(entry => entry.id === button.dataset.responsibleEdit);
      if (!responsible) return;
      uiState.catalog.responsibleDraft = clone(responsible);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-open-purchase-entry]").forEach(button => button.addEventListener("click", () => {
      const result = inventoryService.preparePurchaseEntryDraft(button.dataset.openPurchaseEntry);
      uiState.catalog.errors = [];
      uiState.catalog.message = "";
      uiState.purchaseEntries.errors = result.errors || [];
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.purchaseEntries.selectedPurchaseId = button.dataset.openPurchaseEntry || "";
      uiState.purchaseEntries.draft = clone(result.draft);
      BlessERP.state.setRoute("inventory-purchase-entries");
      BlessERP.layout.renderApp();
    }));
  }

  function draftLineDefault(formId) {
    const state = movementDraftState(formId);
    state.draft = collectMovementDraft(formId);
    state.draft.lines.push(inventoryService.emptyMovementLine());
    BlessERP.layout.renderPage();
  }

  function removeDraftLine(formId, lineId) {
    const state = movementDraftState(formId);
    state.draft = collectMovementDraft(formId);
    state.draft.lines = state.draft.lines.filter(line => line.id !== lineId);
    if (!state.draft.lines.length) state.draft.lines = [inventoryService.emptyMovementLine()];
    BlessERP.layout.renderPage();
  }

  function syncMovementDraftFromInputs(formId, isAdjustment) {
    const state = movementDraftState(formId);
    state.draft = collectMovementDraft(formId);
    const form = document.querySelector(`#${formId}`);
    const section = document.querySelector(`[data-movement-section="${formId}"]`);
    Array.from(section?.querySelectorAll(".compact-table-payments-detail tbody tr[data-line-id]") || []).forEach(row => {
      const itemId = row.querySelector('[name="itemId"]')?.value || "";
      const item = inventoryService.findItemById(itemId);
      const warehouseId = form?.elements.warehouseFromId?.value || state.draft.warehouseFromId || "";
      if (!item) return;
      const unitInput = row.querySelector('[name="unit"]');
      if (unitInput) unitInput.value = item.unit || unitInput.value;
      const inventorySelect = row.querySelector('[name="inventoryAccountCode"]');
      if (inventorySelect && !inventorySelect.value) inventorySelect.value = item.inventoryAccountCode || "";
      const expenseSelect = row.querySelector('[name="expenseAccountCode"]');
      if (expenseSelect && !expenseSelect.value) expenseSelect.value = item.expenseAccountCode || "";
      const costCenterSelect = row.querySelector('[name="costCenter"]');
      if (costCenterSelect && !costCenterSelect.value) costCenterSelect.value = item.defaultCostCenter || form?.elements.costCenter?.value || "";
      const costInput = row.querySelector('[name="costUnit"]');
      if (costInput && Number(costInput.value || 0) <= 0) costInput.value = String(stockCostForItem(itemId, warehouseId) || 0);
      const totalInput = row.querySelector('[name="costTotal"]');
      const qty = Number(row.querySelector('[name="quantity"]')?.value || 0);
      const cost = Number(costInput?.value || 0);
      if (totalInput && Number(totalInput.value || 0) <= 0) totalInput.value = String(qty * cost);
    });
    state.draft = collectMovementDraft(formId);
    if (isAdjustment) uiState.adjustments.movementType = state.draft.movementType;
    else uiState.consumptions.movementType = state.draft.movementType;
  }

  function bindMovementSection(formId, isAdjustment) {
    const state = movementDraftState(formId);
    const prefix = isAdjustment ? "adjustment" : "consumption";
    document.querySelector(`#${prefix}-search`)?.addEventListener("input", event => {
      state.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector(`#${prefix}-status-filter`)?.addEventListener("change", event => {
      state.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector(`#${prefix}-type-filter`)?.addEventListener("change", event => {
      state.movementType = event.target.value;
      state.draft = inventoryService.emptyMovement(state.movementType);
      BlessERP.layout.renderPage();
    });
    document.querySelector(`#${formId}`)?.addEventListener("change", () => {
      syncMovementDraftFromInputs(formId, isAdjustment);
      BlessERP.layout.renderPage();
    });
    document.querySelector(`#${formId}`)?.addEventListener("input", () => {
      syncMovementDraftFromInputs(formId, isAdjustment);
    });
    document.querySelector(`[data-movement-add-line="${formId}"]`)?.addEventListener("click", () => draftLineDefault(formId));
    document.querySelectorAll(`[data-movement-remove-line^="${formId}|"]`).forEach(button => button.addEventListener("click", () => {
      const [, lineId] = String(button.dataset.movementRemoveLine || "").split("|");
      removeDraftLine(formId, lineId);
    }));
    document.querySelector(`[data-movement-reset="${formId}"]`)?.addEventListener("click", () => {
      state.draft = inventoryService.emptyMovement(state.movementType);
      state.errors = [];
      state.message = "";
      BlessERP.layout.renderPage();
    });
    document.querySelector(`[data-movement-save="${formId}"]`)?.addEventListener("click", () => {
      const result = inventoryService.saveMovement(collectMovementDraft(formId));
      state.errors = result.errors || [];
      state.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      state.draft = clone(result.movement);
      state.message = `Movimiento ${result.movement.movementNumber} guardado en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector(`[data-movement-confirm="${formId}"]`)?.addEventListener("click", () => {
      let current = collectMovementDraft(formId);
      if (!current.id) {
        const saved = inventoryService.saveMovement(current);
        if (!saved.ok) {
          state.errors = saved.errors || [];
          return BlessERP.layout.renderPage();
        }
        current = saved.movement;
      }
      const result = inventoryService.confirmMovement(current.id);
      state.errors = result.errors || [];
      state.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      state.draft = clone(result.movement);
      state.message = `Movimiento ${result.movement.movementNumber} confirmado${result.movement.journalEntryNumber ? ` con asiento ${result.movement.journalEntryNumber}` : ""}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll(`[data-movement-load^="${formId}|"]`).forEach(button => button.addEventListener("click", () => {
      const [, movementId] = String(button.dataset.movementLoad || "").split("|");
      const movement = inventoryService.findMovementById(movementId);
      if (!movement) return;
      state.draft = clone(movement);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll(`[data-movement-confirm-row^="${formId}|"]`).forEach(button => button.addEventListener("click", () => {
      const [, movementId] = String(button.dataset.movementConfirmRow || "").split("|");
      const result = inventoryService.confirmMovement(movementId);
      state.errors = result.errors || [];
      state.message = result.ok ? `Movimiento ${result.movement.movementNumber} confirmado.` : "";
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll(`[data-movement-annul^="${formId}|"]`).forEach(button => button.addEventListener("click", () => {
      const [, movementId] = String(button.dataset.movementAnnul || "").split("|");
      const result = inventoryService.annulMovement(movementId);
      state.errors = result.ok ? [] : [result.message || "No se pudo anular el movimiento."];
      state.message = result.ok ? "Movimiento anulado correctamente." : "";
      BlessERP.layout.renderPage();
    }));
  }

  function bindKardex() {
    document.querySelector("#kardex-product-filter")?.addEventListener("change", event => {
      uiState.kardex.productId = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#kardex-category-filter")?.addEventListener("change", event => {
      uiState.kardex.category = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#kardex-warehouse-filter")?.addEventListener("change", event => {
      uiState.kardex.warehouseId = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#kardex-type-filter")?.addEventListener("change", event => {
      uiState.kardex.movementType = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#kardex-date-from")?.addEventListener("change", event => {
      uiState.kardex.dateFrom = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#kardex-date-to")?.addEventListener("change", event => {
      uiState.kardex.dateTo = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#kardex-search")?.addEventListener("input", event => {
      uiState.kardex.search = event.target.value;
      BlessERP.layout.renderPage();
    });
  }

  function render(container, route) {
    if (route.id === "inventory-kardex") {
      renderKardex(container, route);
      return;
    }
    if (route.id === "inventory-purchase-entries") {
      renderPurchaseEntries(container, route);
      return;
    }
    if (route.id === "inventory-consumptions") {
      renderConsumptions(container, route);
      return;
    }
    if (route.id === "inventory-adjustments") {
      renderAdjustments(container, route);
      return;
    }
    if (route.id === "inventory-roses-link") {
      container.innerHTML = renderRosesPlaceholder(route);
      return;
    }
    renderCatalogPage(container, route);
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Inventory = { render };
})();
