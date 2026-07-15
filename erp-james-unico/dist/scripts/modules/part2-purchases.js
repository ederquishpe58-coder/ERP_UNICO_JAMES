(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const purchaseService = BlessERP.services.purchases;

  const uiState = {
    invoices: {
      search: "",
      status: "",
      purchaseType: "",
      supplierId: "",
      message: ""
    },
    manual: {
      draft: null,
      mode: "new",
      message: "",
      errors: []
    },
    xml: {
      batch: [],
      message: "",
      errors: [],
      loading: false
    },
    retentions: {
      draft: null,
      purchaseFilter: "",
      typeFilter: "",
      message: "",
      errors: []
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
    const css = value.includes("anulado") || value.includes("error")
      ? "cancelled"
      : value.includes("borrador") || value.includes("pendiente")
        ? "pending"
        : value.includes("retenido") || value.includes("contabilizado") || value.includes("importado") || value.includes("valido") || value.includes("activo")
          ? "authorized"
          : "partial";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function suppliersOptions() {
    return purchaseService.providers();
  }

  function filteredPurchases() {
    return purchaseService.purchases().filter(item => {
      const haystack = [
        item.documentNumber,
        item.supplierName,
        item.supplierRuc,
        item.authorizationNumber,
        item.accessKey,
        item.observation,
        item.purchaseType,
        ...(item.lines || []).map(line => `${line.description} ${line.productCode}`)
      ].join(" ").toLowerCase();
      return (!uiState.invoices.search || haystack.includes(uiState.invoices.search.toLowerCase()))
        && (!uiState.invoices.status || item.status === uiState.invoices.status)
        && (!uiState.invoices.purchaseType || item.purchaseType === uiState.invoices.purchaseType)
        && (!uiState.invoices.supplierId || item.supplierId === uiState.invoices.supplierId);
    });
  }

  function ensureManualDraft(purchase = null, mode = "new") {
    uiState.manual.mode = mode;
    uiState.manual.errors = [];
    uiState.manual.message = "";
    uiState.manual.draft = purchase ? purchaseService.normalizePurchase(clone(purchase)) : purchaseService.emptyPurchase();
  }

  function ensureRetentionDraft(purchaseId = "") {
    uiState.retentions.errors = [];
    uiState.retentions.message = "";
    uiState.retentions.draft = syncRetentionDraftDerivedValues(
      purchaseService.emptyRetentionDraft(purchaseId),
      { forcePurchaseDefaults: Boolean(purchaseId) }
    );
  }

  function purchaseSummaryCards() {
    const summary = purchaseService.purchaseDashboardSummary();
    return `
      <section class="summary-grid summary-grid-purchases">
        <article class="summary-card"><span>Compras registradas</span><strong>${esc(String(summary.total))}</strong><small>Documentos cargados localmente</small></article>
        <article class="summary-card"><span>Borradores</span><strong>${esc(String(summary.drafts))}</strong><small>Aun editables</small></article>
        <article class="summary-card"><span>XML por clasificar</span><strong>${esc(String(summary.xmlPending))}</strong><small>Pendientes de cuenta o revision</small></article>
        <article class="summary-card"><span>Pendientes de retencion</span><strong>${esc(String(summary.pendingRetention))}</strong><small>Compras ya contabilizadas</small></article>
        <article class="summary-card"><span>Retenidas</span><strong>${esc(String(summary.retained))}</strong><small>Con borrador o gestion de retencion</small></article>
        <article class="summary-card"><span>CxP local</span><strong>${money(summary.totalPayables)}</strong><small>Saldo pendiente preparado para pagos</small></article>
      </section>
    `;
  }

  function renderPurchaseTableRows(rows) {
    return rows.map(item => `
      <tr>
        <td>${esc(item.issueDate)}</td>
        <td>${esc(item.accountingDate)}</td>
        <td><strong>${esc(item.supplierName)}</strong><small>${esc(item.supplierAddress || "")}</small></td>
        <td>${esc(item.supplierRuc)}</td>
        <td>${esc(purchaseService.voucherLabel(item.voucherType))}</td>
        <td>${esc(`${item.estab}-${item.ptoEmi}`)}</td>
        <td>${esc(item.sequential)}</td>
        <td><strong>${esc(item.authorizationNumber || item.accessKey || "-")}</strong><small>${esc(item.importStatus || "")}</small></td>
        <td>${esc(item.taxSupportCode)}</td>
        <td>${esc(purchaseService.purchaseTypeLabel(item.purchaseType))}</td>
        <td>${money(item.totals.base0)}</td>
        <td>${money(item.totals.baseIva)}</td>
        <td>${money(item.totals.iva)}</td>
        <td><strong>${money(item.totals.total)}</strong></td>
        <td>${statusBadge(item.status)}</td>
        <td>${esc(item.retentionStatus || "Pendiente")}</td>
        <td>${esc(item.payableId ? "Preparada" : "-")}</td>
        <td>${esc(item.journalEntryNumber || "-")}</td>
        <td>
          <div class="row-actions">
            <button class="row-action-button" type="button" data-purchase-view="${esc(item.id)}">Ver</button>
            ${purchaseService.canEditPurchase(item) ? `<button class="row-action-button" type="button" data-purchase-edit="${esc(item.id)}">Editar</button><button class="row-action-button" type="button" data-purchase-post="${esc(item.id)}">Contabilizar</button>` : ""}
            ${(item.status === "PENDIENTE_RETENCION" || item.status === "CONTABILIZADO") ? `<button class="row-action-button" type="button" data-purchase-retention="${esc(item.id)}">Retener</button>` : ""}
          </div>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="19"><div class="empty-inline">No hay compras para los filtros actuales.</div></td></tr>`;
  }

  function renderInvoices(container, route) {
    const rows = filteredPurchases();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Flujo base activo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.invoices.message ? `<section class="inline-feedback success">${esc(uiState.invoices.message)}</section>` : ""}
      ${purchaseSummaryCards()}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-purchases">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="purchase-search" placeholder="Proveedor, numero, autorizacion o detalle" value="${esc(uiState.invoices.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="purchase-status-filter">
              <option value="">Todos</option>
              ${purchaseService.purchaseStatuses.map(status => `<option value="${esc(status)}" ${uiState.invoices.status === status ? "selected" : ""}>${esc(status)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo compra</span>
            <select id="purchase-type-filter">
              <option value="">Todos</option>
              ${purchaseService.purchaseTypes().map(type => `<option value="${esc(type.code)}" ${uiState.invoices.purchaseType === type.code ? "selected" : ""}>${esc(type.label)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Proveedor</span>
            <select id="purchase-supplier-filter">
              <option value="">Todos</option>
              ${suppliersOptions().map(item => `<option value="${esc(item.id)}" ${uiState.invoices.supplierId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-purchase-new>Nueva compra</button>
            <button class="secondary-button" type="button" data-route-link="purchases-upload-xml">Subir XML</button>
          </div>
        </div>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BANDEJA</p>
            <h3>Facturas de compra y documentos relacionados</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-purchases">
            <thead>
              <tr>
                <th>Fecha emision</th>
                <th>Fecha contab.</th>
                <th>Proveedor</th>
                <th>RUC</th>
                <th>Tipo</th>
                <th>Serie</th>
                <th>Secuencial</th>
                <th>Autorizacion / clave</th>
                <th>Sustento</th>
                <th>Tipo compra</th>
                <th>Base 0%</th>
                <th>Base IVA</th>
                <th>IVA</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Retencion</th>
                <th>CxP</th>
                <th>Asiento</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>${renderPurchaseTableRows(rows)}</tbody>
          </table>
        </div>
      </article>
    `;
    bindInvoices();
  }

  function renderManualHeaderFields(draft, readOnly) {
    return `
      <div class="compact-form-grid purchase-form-grid">
        <label class="compact-field">
          <span>Proveedor</span>
          <select name="supplierId" ${readOnly ? "disabled" : ""}>
            <option value="">Seleccionar proveedor</option>
            ${suppliersOptions().map(item => `<option value="${esc(item.id)}" ${draft.supplierId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
          </select>
        </label>
        <label class="compact-field"><span>RUC proveedor</span><input name="supplierRuc" value="${esc(draft.supplierRuc)}" ${readOnly ? "readonly" : ""}></label>
        <label class="compact-field"><span>Fecha emision</span><input name="issueDate" type="date" value="${esc(draft.issueDate)}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field"><span>Fecha contabilizacion</span><input name="accountingDate" type="date" value="${esc(draft.accountingDate)}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field">
          <span>Tipo comprobante</span>
          <select name="voucherType" ${readOnly ? "disabled" : ""}>
            ${purchaseService.voucherTypes.map(item => `<option value="${esc(item.code)}" ${draft.voucherType === item.code ? "selected" : ""}>${esc(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="compact-field"><span>Serie establecimiento</span><input name="estab" value="${esc(draft.estab)}" ${readOnly ? "readonly" : ""}></label>
        <label class="compact-field"><span>Punto emision</span><input name="ptoEmi" value="${esc(draft.ptoEmi)}" ${readOnly ? "readonly" : ""}></label>
        <label class="compact-field"><span>Secuencial</span><input name="sequential" value="${esc(draft.sequential)}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field"><span>Autorizacion</span><input name="authorizationNumber" value="${esc(draft.authorizationNumber || "")}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field">
          <span>Sustento tributario</span>
          <select name="taxSupportCode" ${readOnly ? "disabled" : ""}>
            <option value="">Seleccionar sustento</option>
            ${purchaseService.taxSupports().map(item => `<option value="${esc(item.code)}" ${draft.taxSupportCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.description)}</option>`).join("")}
          </select>
        </label>
        <label class="compact-field">
          <span>Tipo compra</span>
          <select name="purchaseType" ${readOnly ? "disabled" : ""}>
            <option value="">Seleccionar tipo</option>
            ${purchaseService.purchaseTypes().map(item => `<option value="${esc(item.code)}" ${draft.purchaseType === item.code ? "selected" : ""}>${esc(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="compact-field"><span>Vencimiento</span><input name="dueDate" type="date" value="${esc(draft.dueDate || "")}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2" ${readOnly ? "disabled" : ""}>${esc(draft.observation || "")}</textarea></label>
      </div>
      ${draft.supplierAddress ? `<div class="helper-pill">Direccion proveedor: ${esc(draft.supplierAddress)}</div>` : ""}
    `;
  }

  function lineModeBadge(line) {
    const mode = String(line.suggestionMode || "Manual");
    const css = mode === "Automatico" ? "authorized" : mode === "Sugerido" ? "pending" : "partial";
    return `<span class="status-badge ${css}">${esc(mode)}</span>`;
  }

  function renderStandardPurchaseLines(draft, readOnly) {
    const movementAccounts = BlessERP.services.chartOfAccounts.movementOptions();
    return `
      <div class="journal-lines-head">
        <div>
          <p class="section-kicker">DETALLE</p>
          <h3>Lineas de compra</h3>
        </div>
        ${!readOnly ? `<button class="secondary-button" type="button" data-manual-add-line>Agregar linea</button>` : ""}
      </div>
      <div class="compact-table-wrap">
        <table class="compact-table compact-table-purchases-detail">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Descripcion</th>
              <th>Cant.</th>
              <th>Precio U.</th>
              <th>Desc.</th>
              <th>Base</th>
              <th>IVA %</th>
              <th>IVA valor</th>
              <th>Total linea</th>
              <th>Cuenta contable</th>
              <th>Centro costo</th>
              <th>Tipo</th>
              <th>Modo</th>
              ${!readOnly ? `<th></th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${(draft.lines || []).map(line => `
              <tr data-line-id="${esc(line.id)}">
                <td><input name="productCode" value="${esc(line.productCode || "")}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="description" value="${esc(line.description || "")}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="quantity" type="number" step="0.01" min="0" value="${esc(String(line.quantity || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="unitPrice" type="number" step="0.01" min="0" value="${esc(String(line.unitPrice || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="discount" type="number" step="0.01" min="0" value="${esc(String(line.discount || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="taxableBase" type="number" step="0.01" min="0" value="${esc(String(line.taxableBase || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="vatRate" type="number" step="0.01" min="0" value="${esc(String(line.vatRate || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="vatValue" type="number" step="0.01" min="0" value="${esc(String(line.vatValue || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="totalLine" type="number" step="0.01" min="0" value="${esc(String(line.totalLine || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td>
                  <select name="accountCode" ${readOnly ? "disabled" : ""}>
                    <option value="">Seleccionar cuenta</option>
                    ${movementAccounts.map(account => `<option value="${esc(account.code)}" ${line.accountCode === account.code ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
                  </select>
                  ${line.suggestedAccountCode ? `<small class="line-hint">Sugerida: ${esc(line.suggestedAccountCode)}</small>` : ""}
                </td>
                <td><input name="costCenter" value="${esc(line.costCenter || "")}" ${readOnly ? "disabled" : ""}></td>
                <td>
                  <select name="lineType" ${readOnly ? "disabled" : ""}>
                    ${purchaseService.lineTypes.map(type => `<option value="${esc(type)}" ${line.lineType === type ? "selected" : ""}>${esc(type)}</option>`).join("")}
                  </select>
                </td>
                <td>${lineModeBadge(line)}</td>
                ${!readOnly ? `<td><button class="row-action-button" type="button" data-manual-remove-line="${esc(line.id)}">Quitar</button></td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderInventoryPurchaseLines(draft, readOnly) {
    const inventoryItems = purchaseService.inventoryItemsForPurchaseType(draft.purchaseType);
    return `
      <div class="journal-lines-head">
        <div>
          <p class="section-kicker">DETALLE INVENTARIABLE</p>
          <h3>Productos ligados a parametrizacion de inventario</h3>
        </div>
        ${!readOnly ? `<button class="secondary-button" type="button" data-manual-add-line>Agregar linea</button>` : ""}
      </div>
      <p class="panel-note purchase-lines-note">Selecciona el producto parametrizado y el sistema completara codigo, nombre y cuenta de inventario. Solo se editan cantidades, precio, IVA y centro de costo.</p>
      <div class="compact-table-wrap">
        <table class="compact-table compact-table-purchases-detail">
          <thead>
            <tr>
              <th>Producto parametrizado</th>
              <th>Codigo</th>
              <th>Nombre producto</th>
              <th>Cant.</th>
              <th>Precio U.</th>
              <th>Desc.</th>
              <th>Base</th>
              <th>IVA %</th>
              <th>IVA valor</th>
              <th>Total linea</th>
              <th>Centro costo</th>
              <th>Modo</th>
              ${!readOnly ? `<th></th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${(draft.lines || []).map(line => `
              <tr data-line-id="${esc(line.id)}" data-line-mode="inventory">
                <td class="purchase-cell-product">
                  <select name="inventoryItemId" ${readOnly ? "disabled" : ""}>
                    <option value="">Seleccionar producto</option>
                    ${inventoryItems.map(item => `<option value="${esc(item.id)}" ${line.inventoryItemId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                  </select>
                  <input type="hidden" name="accountCode" value="${esc(line.accountCode || "")}">
                  <input type="hidden" name="lineType" value="${esc(line.lineType || "inventario")}">
                  <input type="hidden" name="inventoryCategory" value="${esc(line.inventoryCategory || "")}">
                  <input type="hidden" name="inventoryUnit" value="${esc(line.inventoryUnit || "")}">
                  ${line.accountCode ? `<small class="line-hint">Cuenta auto: ${esc(line.accountCode)}${line.accountName ? ` - ${esc(line.accountName)}` : ""}</small>` : `<small class="line-hint">El producto debe tener cuenta de inventario parametrizada.</small>`}
                </td>
                <td><input class="readonly-cell-input" name="productCode" value="${esc(line.productCode || "")}" readonly></td>
                <td>
                  <input class="readonly-cell-input" name="description" value="${esc(line.description || "")}" readonly>
                  ${line.inventoryCategory ? `<small class="line-hint">${esc(purchaseService.inventoryCategoryLabel(line.inventoryCategory))}${line.inventoryUnit ? ` · ${esc(line.inventoryUnit)}` : ""}</small>` : ""}
                </td>
                <td><input name="quantity" type="number" step="0.01" min="0" value="${esc(String(line.quantity || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="unitPrice" type="number" step="0.01" min="0" value="${esc(String(line.unitPrice || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="discount" type="number" step="0.01" min="0" value="${esc(String(line.discount || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input class="readonly-cell-input" name="taxableBase" type="number" step="0.01" min="0" value="${esc(String(line.taxableBase || 0))}" readonly></td>
                <td><input name="vatRate" type="number" step="0.01" min="0" value="${esc(String(line.vatRate || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input class="readonly-cell-input" name="vatValue" type="number" step="0.01" min="0" value="${esc(String(line.vatValue || 0))}" readonly></td>
                <td><input class="readonly-cell-input" name="totalLine" type="number" step="0.01" min="0" value="${esc(String(line.totalLine || 0))}" readonly></td>
                <td><input name="costCenter" value="${esc(line.costCenter || "")}" ${readOnly ? "disabled" : ""}></td>
                <td>${lineModeBadge(line)}</td>
                ${!readOnly ? `<td><button class="row-action-button" type="button" data-manual-remove-line="${esc(line.id)}">Quitar</button></td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPurchaseLines(draft, readOnly) {
    return purchaseService.purchaseTypeUsesInventory(draft.purchaseType)
      ? renderInventoryPurchaseLines(draft, readOnly)
      : renderStandardPurchaseLines(draft, readOnly);
  }

  function renderManual(container, route) {
    if (!uiState.manual.draft) ensureManualDraft();
    const draft = uiState.manual.draft;
    const readOnly = uiState.manual.mode === "view" || !purchaseService.canEditPurchase(draft);
    const inventoryMode = purchaseService.purchaseTypeUsesInventory(draft.purchaseType);
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          ${statusBadge(draft.status)}
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.manual.message ? `<section class="inline-feedback success">${esc(uiState.manual.message)}</section>` : ""}
      ${uiState.manual.errors.length ? `<section class="inline-feedback danger">${uiState.manual.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid purchase-editor-layout ${inventoryMode ? "purchase-editor-layout-wide" : ""}">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CABECERA</p>
              <h3>${draft.id ? `${readOnly ? "Visualizacion" : "Edicion"} de ${esc(draft.documentNumber)}` : "Nueva compra manual"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-purchase-clear>${draft.id ? "Nueva compra" : "Limpiar"}</button>
              <button class="secondary-button" type="button" data-route-link="purchases-invoices">Ir a bandeja</button>
              ${!readOnly ? `<button class="secondary-button" type="button" data-purchase-save>Guardar borrador</button><button class="secondary-button" type="button" data-purchase-post-editor>Contabilizar</button>` : ""}
            </div>
          </div>
          <form id="purchase-manual-form">
            ${renderManualHeaderFields(draft, readOnly)}
            ${renderPurchaseLines(draft, readOnly)}
          </form>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN</p>
              <h3>Totales y preparacion contable</h3>
            </div>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Documento</strong><span>${esc(draft.documentNumber || "-")}</span></div>
            <div class="info-row"><strong>Base 0%</strong><span id="manual-total-base0">${money(draft.totals.base0)}</span></div>
            <div class="info-row"><strong>Base IVA</strong><span id="manual-total-baseiva">${money(draft.totals.baseIva)}</span></div>
            <div class="info-row"><strong>IVA</strong><span id="manual-total-iva">${money(draft.totals.iva)}</span></div>
            <div class="info-row"><strong>Total</strong><span id="manual-total-total">${money(draft.totals.total)}</span></div>
            <div class="info-row"><strong>Total retenciones</strong><span id="manual-total-withholdings">${money(draft.totals.withholdingsTotal)}</span></div>
            <div class="info-row"><strong>Saldo por pagar</strong><span id="manual-total-balance">${money(draft.totals.balanceDue)}</span></div>
            <div class="info-row"><strong>Cuenta por pagar</strong><span>${esc(draft.payableId ? "Preparada" : "Aun no generada")}</span></div>
            <div class="info-row"><strong>Asiento</strong><span>${esc(draft.journalEntryNumber || "Aun no contabilizado")}</span></div>
            <div class="info-row"><strong>Retencion</strong><span>${esc(draft.retentionStatus || "Pendiente")}</span></div>
          </div>
          <p class="panel-note">La compra siempre acredita cuentas por pagar proveedores al contabilizar. Si el tipo afecta inventario, la cuenta del debito se toma automaticamente del producto parametrizado.</p>
        </article>
      </section>
    `;
    bindManual();
  }

  function renderXml(container, route) {
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge pending">${uiState.xml.loading ? "Leyendo XML" : "Parser base local"}</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.xml.message ? `<section class="inline-feedback success">${esc(uiState.xml.message)}</section>` : ""}
      ${uiState.xml.errors.length ? `<section class="inline-feedback danger">${uiState.xml.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CARGA</p>
              <h3>Seleccionar archivos XML</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-xml-import ${uiState.xml.batch.some(item => ["VALIDO", "PENDIENTE_CUENTA"].includes(item.importStatus)) ? "" : "disabled"}>Importar validos</button>
            </div>
          </div>
          <label class="compact-field full">
            <span>Archivos XML de compras</span>
            <input id="purchase-xml-input" type="file" accept=".xml,text/xml" multiple>
          </label>
          <p class="panel-note">El parser local intenta leer proveedor, fechas, serie, secuencial, autorizacion, bases, IVA, total y detalle. Los duplicados se comparan por RUC + tipo + serie + secuencial + autorizacion.</p>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ESTADOS</p>
              <h3>Lectura e importacion</h3>
            </div>
          </div>
          <div class="module-chip-grid">
            ${purchaseService.importStatuses.map(status => `<span class="module-chip">${esc(status)}</span>`).join("")}
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">REVISION</p>
            <h3>Documentos leidos antes de guardar</h3>
          </div>
          <span class="status-badge partial">${esc(String(uiState.xml.batch.length))} archivos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-xml-review">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Proveedor</th>
                <th>RUC</th>
                <th>Documento</th>
                <th>Autorizacion</th>
                <th>Base</th>
                <th>IVA</th>
                <th>Total</th>
                <th>Estado importacion</th>
                <th>Estado compra</th>
              </tr>
            </thead>
            <tbody>
              ${uiState.xml.batch.map(item => item.purchase ? `
                <tr>
                  <td>${esc(item.fileName)}</td>
                  <td>${esc(item.purchase.supplierName)}</td>
                  <td>${esc(item.purchase.supplierRuc)}</td>
                  <td><strong>${esc(item.purchase.documentNumber)}</strong><small>${esc(purchaseService.voucherLabel(item.purchase.voucherType))}</small></td>
                  <td>${esc(item.purchase.authorizationNumber || item.purchase.accessKey || "-")}</td>
                  <td>${money(Number(item.purchase.totals.base0 || 0) + Number(item.purchase.totals.baseIva || 0))}</td>
                  <td>${money(item.purchase.totals.iva)}</td>
                  <td>${money(item.purchase.totals.total)}</td>
                  <td>${statusBadge(item.importStatus)}</td>
                  <td>${statusBadge(item.purchase.status)}</td>
                </tr>
              ` : `
                <tr>
                  <td>${esc(item.fileName)}</td>
                  <td colspan="7">${esc(item.error || "No se pudo leer el archivo.")}</td>
                  <td>${statusBadge(item.importStatus || "ERROR_XML")}</td>
                  <td>${statusBadge("ERROR_XML")}</td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">Todavia no se han seleccionado archivos XML.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindXml();
  }

  function filteredPendingRetentions() {
    return purchaseService.purchasesPendingRetention().filter(item => {
      return (!uiState.retentions.purchaseFilter || item.id === uiState.retentions.purchaseFilter);
    });
  }

  function round2(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  function getRetentionPurchase(purchaseId) {
    return purchaseService.purchases().find(item => item.id === purchaseId) || null;
  }

  function syncRetentionDraftDerivedValues(draft, options = {}) {
    const { forcePurchaseDefaults = false } = options;
    const current = clone(draft || purchaseService.emptyRetentionDraft());
    const purchase = getRetentionPurchase(current.purchaseId);
    if (purchase) {
      const rentBase = round2(Number(purchase.totals.base0 || 0) + Number(purchase.totals.baseIva || 0));
      const vatBase = round2(Number(purchase.totals.iva || 0));
      current.purchaseDocumentNumber = purchase.documentNumber;
      current.supplierName = purchase.supplierName;
      current.supplierRuc = purchase.supplierRuc;
      if (forcePurchaseDefaults || !Number(current.rentBaseAmount || 0)) current.rentBaseAmount = rentBase;
      if (forcePurchaseDefaults || !Number(current.vatBaseAmount || 0)) current.vatBaseAmount = vatBase;
    }
    if (!current.retentionDate) current.retentionDate = BlessERP.utils.today();
    if (current.rentCode) {
      const rentCode = purchaseService.withholdingByCode(current.rentCode);
      if (rentCode) {
        current.rentSriCode = rentCode.sriCode || rentCode.code || "";
        current.rentParameterId = rentCode.id || "";
        current.rentDescription = rentCode.description || "";
        current.rentPercentage = Number(rentCode.percentage || 0);
        current.rentPayableAccountCode = rentCode.payableAccountCode || current.rentPayableAccountCode || "";
      }
    } else {
      current.rentSriCode = "";
      current.rentParameterId = "";
      current.rentDescription = "";
    }
    if (current.vatCode) {
      const vatCode = purchaseService.withholdingByCode(current.vatCode);
      if (vatCode) {
        current.vatSriCode = vatCode.sriCode || vatCode.code || "";
        current.vatParameterId = vatCode.id || "";
        current.vatDescription = vatCode.description || "";
        current.vatPercentage = Number(vatCode.percentage || 0);
        current.vatPayableAccountCode = vatCode.payableAccountCode || current.vatPayableAccountCode || "";
      }
    } else {
      current.vatSriCode = "";
      current.vatParameterId = "";
      current.vatDescription = "";
    }
    current.rentBaseAmount = round2(current.rentBaseAmount);
    current.rentPercentage = round2(current.rentPercentage);
    current.rentRetainedAmount = round2(current.rentBaseAmount * current.rentPercentage / 100);
    current.vatBaseAmount = round2(current.vatBaseAmount);
    current.vatPercentage = round2(current.vatPercentage);
    current.vatRetainedAmount = round2(current.vatBaseAmount * current.vatPercentage / 100);
    current.totalRetained = round2(Number(current.rentRetainedAmount || 0) + Number(current.vatRetainedAmount || 0));
    return current;
  }

  function filteredIssuedRetentions() {
    return purchaseService.issuedWithholdings().filter(item => {
      if (uiState.retentions.purchaseFilter && item.purchaseId !== uiState.retentions.purchaseFilter) return false;
      if (!uiState.retentions.typeFilter) return true;
      const hasRent = Number(item.rentRetainedAmount || 0) > 0;
      const hasVat = Number(item.vatRetainedAmount || 0) > 0;
      if (uiState.retentions.typeFilter === "MIXTA") return hasRent && hasVat;
      if (uiState.retentions.typeFilter === "RENTA") return hasRent;
      if (uiState.retentions.typeFilter === "IVA") return hasVat;
      return true;
    });
  }

  function retentionSummaryCards() {
    const summary = purchaseService.issuedWithholdingSummary();
    return `
      <section class="summary-grid summary-grid-purchases">
        <article class="summary-card"><span>Pendientes de retener</span><strong>${esc(String(filteredPendingRetentions().length))}</strong><small>Compras contabilizadas aun sin retencion</small></article>
        <article class="summary-card"><span>Borradores</span><strong>${esc(String(summary.drafts))}</strong><small>Editables antes de confirmar</small></article>
        <article class="summary-card"><span>Confirmadas</span><strong>${esc(String(summary.confirmed))}</strong><small>Ya afectan la cuenta por pagar</small></article>
        <article class="summary-card"><span>Renta por pagar</span><strong>${money(summary.totalRentPayable)}</strong><small>Saldo tributario preparado</small></article>
        <article class="summary-card"><span>IVA por pagar</span><strong>${money(summary.totalVatPayable)}</strong><small>Retencion IVA acumulada</small></article>
      </section>
    `;
  }

  function renderRetentions(container, route) {
    const pending = filteredPendingRetentions();
    const drafts = filteredIssuedRetentions();
    if (!uiState.retentions.draft) ensureRetentionDraft(pending[0]?.id || "");
    uiState.retentions.draft = syncRetentionDraftDerivedValues(uiState.retentions.draft);
    const draft = uiState.retentions.draft;
    const purchase = getRetentionPurchase(draft.purchaseId);
    const rentCodes = purchaseService.withholdingCatalog("RENTA");
    const vatCodes = purchaseService.withholdingCatalog("IVA");
    const editable = !draft.id || ["BORRADOR", "LISTA_PARA_AUTORIZAR"].includes(draft.status);
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge pending">Base sin XML SRI aun</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.retentions.message ? `<section class="inline-feedback success">${esc(uiState.retentions.message)}</section>` : ""}
      ${uiState.retentions.errors.length ? `<section class="inline-feedback danger">${uiState.retentions.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${retentionSummaryCards()}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-purchases">
          <label class="compact-inline-field">
            <span>Compra</span>
            <select id="retention-purchase-filter">
              <option value="">Todas</option>
              ${purchaseService.purchases().filter(item => isRetentionSelectable(item)).map(item => `<option value="${esc(item.id)}" ${uiState.retentions.purchaseFilter === item.id ? "selected" : ""}>${esc(item.documentNumber)} - ${esc(item.supplierName)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="retention-type-filter">
              <option value="">Todas</option>
              <option value="RENTA" ${uiState.retentions.typeFilter === "RENTA" ? "selected" : ""}>Con renta</option>
              <option value="IVA" ${uiState.retentions.typeFilter === "IVA" ? "selected" : ""}>Con IVA</option>
              <option value="MIXTA" ${uiState.retentions.typeFilter === "MIXTA" ? "selected" : ""}>Mixtas</option>
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-retention-clear>Nueva retencion</button>
          </div>
        </div>
      </section>
      <section class="placeholder-grid purchase-editor-layout">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">PENDIENTES</p>
              <h3>Compras listas para retencion</h3>
            </div>
            <span class="status-badge partial">${esc(String(pending.length))} compras</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Documento</th><th>Proveedor</th><th>Base</th><th>IVA</th><th>Total</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                ${pending.map(item => `
                  <tr>
                    <td><strong>${esc(item.documentNumber)}</strong><small>${esc(item.issueDate)}</small></td>
                    <td>${esc(item.supplierName)}</td>
                    <td>${money(Number(item.totals.base0 || 0) + Number(item.totals.baseIva || 0))}</td>
                    <td>${money(item.totals.iva)}</td>
                    <td>${money(item.totals.total)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td><button class="row-action-button" type="button" data-retention-from-purchase="${esc(item.id)}">Crear borrador</button></td>
                  </tr>
                `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay compras pendientes de retencion.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">EMISION</p>
              <h3>${draft.id ? `Retencion ${esc(draft.draftNumber)}` : "Nueva retencion emitida"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-retention-save ${editable ? "" : "disabled"}>Guardar borrador</button>
              <button class="secondary-button" type="button" data-retention-confirm ${editable ? "" : "disabled"}>Confirmar</button>
            </div>
          </div>
          <form id="retention-draft-form" class="compact-form-grid">
            <label class="compact-field">
              <span>Compra relacionada</span>
              <select name="purchaseId" ${editable ? "" : "disabled"}>
                <option value="">Seleccionar compra</option>
                ${purchaseService.purchases().filter(item => isRetentionSelectable(item)).map(item => `<option value="${esc(item.id)}" ${draft.purchaseId === item.id ? "selected" : ""}>${esc(item.documentNumber)} - ${esc(item.supplierName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Proveedor</span><input name="supplierName" value="${esc(draft.supplierName || "")}" readonly></label>
            <label class="compact-field"><span>RUC</span><input name="supplierRuc" value="${esc(draft.supplierRuc || "")}" readonly></label>
            <label class="compact-field"><span>Fecha retencion</span><input name="retentionDate" type="date" value="${esc(draft.retentionDate || "")}" ${editable ? "" : "disabled"}></label>
            <label class="compact-field"><span>Numero borrador</span><input name="draftNumber" value="${esc(draft.draftNumber || "")}" readonly></label>
            <label class="compact-field">
              <span>Estado</span>
              <select name="status" ${editable ? "" : "disabled"}>
                ${purchaseService.retentionStatuses.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <div class="compact-field full"><strong>Renta</strong></div>
            <label class="compact-field">
              <span>Codigo renta</span>
              <select name="rentCode" ${editable ? "" : "disabled"}>
                <option value="">Sin retencion renta</option>
                ${rentCodes.map(item => `<option value="${esc(item.code)}" ${draft.rentCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.description)} (${esc(String(item.percentage))}%)</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Base renta</span><input name="rentBaseAmount" type="number" step="0.01" min="0" value="${esc(String(draft.rentBaseAmount || 0))}" ${editable ? "" : "readonly"}></label>
            <label class="compact-field"><span>% renta</span><input name="rentPercentage" type="number" step="0.01" min="0" value="${esc(String(draft.rentPercentage || 0))}" readonly></label>
            <label class="compact-field"><span>Valor renta</span><input name="rentRetainedAmount" type="number" step="0.01" min="0" value="${esc(String(draft.rentRetainedAmount || 0))}" readonly></label>
            <div class="helper-pill full">Cuenta renta sugerida: ${esc(draft.rentPayableAccountCode || "-")} | ${esc(draft.rentDescription || "Sin codigo seleccionado")}</div>
            <div class="compact-field full"><strong>IVA</strong></div>
            <label class="compact-field">
              <span>Codigo IVA</span>
              <select name="vatCode" ${editable ? "" : "disabled"}>
                <option value="">Sin retencion IVA</option>
                ${vatCodes.map(item => `<option value="${esc(item.code)}" ${draft.vatCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.description)} (${esc(String(item.percentage))}%)</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Base IVA</span><input name="vatBaseAmount" type="number" step="0.01" min="0" value="${esc(String(draft.vatBaseAmount || 0))}" ${editable ? "" : "readonly"}></label>
            <label class="compact-field"><span>% IVA</span><input name="vatPercentage" type="number" step="0.01" min="0" value="${esc(String(draft.vatPercentage || 0))}" readonly></label>
            <label class="compact-field"><span>Valor IVA</span><input name="vatRetainedAmount" type="number" step="0.01" min="0" value="${esc(String(draft.vatRetainedAmount || 0))}" readonly></label>
            <div class="helper-pill full">Cuenta IVA sugerida: ${esc(draft.vatPayableAccountCode || "-")} | ${esc(draft.vatDescription || "Sin codigo seleccionado")}</div>
            <div class="helper-pill full">Compra: ${esc(draft.purchaseDocumentNumber || purchase?.documentNumber || "-")} | Retencion total: ${money(draft.totalRetained || 0)} | Asiento: ${esc(draft.journalEntryNumber || "-")}</div>
          </form>
          <p class="panel-note">La retencion confirmada crea asiento contable y baja el saldo de la cuenta por pagar. La autorizacion SRI queda para una fase posterior.</p>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">SEGUIMIENTO</p>
            <h3>Retenciones emitidas registradas</h3>
          </div>
          <span class="status-badge partial">${esc(String(drafts.length))} registros</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Borrador</th><th>Compra</th><th>Proveedor</th><th>Renta</th><th>IVA</th><th>Total</th><th>Estado</th><th>Asiento</th><th></th></tr></thead>
            <tbody>
              ${drafts.map(item => `
                <tr>
                  <td>${esc(item.retentionDate)}</td>
                  <td><strong>${esc(item.draftNumber)}</strong></td>
                  <td>${esc(item.purchaseDocumentNumber || "-")}</td>
                  <td>${esc(item.supplierName)}</td>
                  <td>${item.rentCode ? `${esc(item.rentCode)} · ${money(item.rentRetainedAmount)}` : "-"}</td>
                  <td>${item.vatCode ? `${esc(item.vatCode)} · ${money(item.vatRetainedAmount)}` : "-"}</td>
                  <td><strong>${money(item.totalRetained)}</strong></td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.journalEntryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-retention-load="${esc(item.id)}">Ver</button>
                      ${["BORRADOR", "LISTA_PARA_AUTORIZAR"].includes(item.status) ? `<button class="row-action-button" type="button" data-retention-row-confirm="${esc(item.id)}">Confirmar</button>` : ""}
                      ${item.status !== "ANULADA" ? `<button class="row-action-button" type="button" data-retention-annul="${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay retenciones emitidas registradas.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindRetentions();
  }

  function renderSupports(container, route) {
    const supports = purchaseService.taxSupports();
    const types = purchaseService.purchaseTypes();
    const withholdings = purchaseService.withholdingCatalog();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Catalogos base disponibles</span>
        </div>
      </section>
      ${routeTabs(route)}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">SUSTENTOS</p><h3>Catalogo tributario base</h3></div>
            <span class="status-badge partial">${esc(String(supports.length))} codigos</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Codigo</th><th>Descripcion</th><th>Estado</th><th>Cuenta sugerida</th><th>Tipo compra sugerido</th></tr></thead>
              <tbody>
                ${supports.map(item => `
                  <tr>
                    <td><strong>${esc(item.code)}</strong></td>
                    <td>${esc(item.description)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td>${esc(item.suggestedAccountCode || "-")}</td>
                    <td>${esc(item.suggestedPurchaseType || "-")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">TIPOS</p><h3>Clasificacion de compra</h3></div>
            <span class="status-badge partial">${esc(String(types.length))} tipos</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Codigo</th><th>Descripcion</th><th>Cuenta sugerida</th><th>Ret. fuente</th><th>Ret. IVA</th><th>Inventario</th><th>Centro costo</th></tr></thead>
              <tbody>
                ${types.map(item => `
                  <tr>
                    <td><strong>${esc(item.code)}</strong></td>
                    <td>${esc(item.label)}</td>
                    <td>${esc(item.suggestedAccountCode || "-")}</td>
                    <td>${item.requiresRetentionRent ? "Si" : "No"}</td>
                    <td>${item.requiresRetentionVat ? "Si" : "No"}</td>
                    <td>${item.affectsInventory ? "Si" : "No"}</td>
                    <td>${item.requiresCostCenter ? "Si" : "No"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">RETENCIONES</p><h3>Parametros base para renta e IVA</h3></div>
          <span class="status-badge partial">${esc(String(withholdings.length))} codigos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Codigo</th><th>Descripcion</th><th>Tipo impuesto</th><th>Porcentaje</th><th>Estado</th><th>Cuenta asociada</th></tr></thead>
            <tbody>
              ${withholdings.map(item => `
                <tr>
                  <td><strong>${esc(item.code)}</strong></td>
                  <td>${esc(item.description)}</td>
                  <td>${esc(item.taxType)}</td>
                  <td>${esc(String(item.percentage))}%</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.payableAccountCode || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function collectManualDraft() {
    const form = document.querySelector("#purchase-manual-form");
    if (!form) return uiState.manual.draft;
    const base = clone(uiState.manual.draft || purchaseService.emptyPurchase());
    base.supplierId = form.elements.supplierId?.value || "";
    base.supplierRuc = form.elements.supplierRuc?.value || "";
    base.issueDate = form.elements.issueDate?.value || "";
    base.accountingDate = form.elements.accountingDate?.value || "";
    base.voucherType = form.elements.voucherType?.value || "";
    base.estab = form.elements.estab?.value || "";
    base.ptoEmi = form.elements.ptoEmi?.value || "";
    base.sequential = form.elements.sequential?.value || "";
    base.authorizationNumber = form.elements.authorizationNumber?.value || "";
    base.taxSupportCode = form.elements.taxSupportCode?.value || "";
    base.purchaseType = form.elements.purchaseType?.value || "";
    base.dueDate = form.elements.dueDate?.value || "";
    base.observation = form.elements.observation?.value || "";
    base.lines = Array.from(document.querySelectorAll(".compact-table-purchases-detail tbody tr[data-line-id]")).map(row => ({
      id: row.dataset.lineId,
      inventoryItemId: row.querySelector('[name="inventoryItemId"]')?.value || "",
      inventoryCategory: row.querySelector('[name="inventoryCategory"]')?.value || "",
      inventoryUnit: row.querySelector('[name="inventoryUnit"]')?.value || "",
      productCode: row.querySelector('[name="productCode"]')?.value || "",
      description: row.querySelector('[name="description"]')?.value || "",
      quantity: Number(row.querySelector('[name="quantity"]')?.value || 0),
      unitPrice: Number(row.querySelector('[name="unitPrice"]')?.value || 0),
      discount: Number(row.querySelector('[name="discount"]')?.value || 0),
      taxableBase: Number(row.querySelector('[name="taxableBase"]')?.value || 0),
      vatRate: Number(row.querySelector('[name="vatRate"]')?.value || 0),
      vatValue: Number(row.querySelector('[name="vatValue"]')?.value || 0),
      totalLine: Number(row.querySelector('[name="totalLine"]')?.value || 0),
      accountCode: row.querySelector('[name="accountCode"]')?.value || "",
      costCenter: row.querySelector('[name="costCenter"]')?.value || "",
      lineType: row.querySelector('[name="lineType"]')?.value || "gasto"
    }));
    return purchaseService.normalizePurchase(base);
  }

  function refreshManualSummary() {
    uiState.manual.draft = collectManualDraft();
    const totals = uiState.manual.draft.totals;
    document.querySelector("#manual-total-base0")?.replaceChildren(document.createTextNode(money(totals.base0)));
    document.querySelector("#manual-total-baseiva")?.replaceChildren(document.createTextNode(money(totals.baseIva)));
    document.querySelector("#manual-total-iva")?.replaceChildren(document.createTextNode(money(totals.iva)));
    document.querySelector("#manual-total-total")?.replaceChildren(document.createTextNode(money(totals.total)));
    document.querySelector("#manual-total-withholdings")?.replaceChildren(document.createTextNode(money(totals.withholdingsTotal)));
    document.querySelector("#manual-total-balance")?.replaceChildren(document.createTextNode(money(totals.balanceDue)));
  }

  function bindInvoices() {
    document.querySelector("#purchase-search")?.addEventListener("input", event => {
      uiState.invoices.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#purchase-status-filter")?.addEventListener("change", event => {
      uiState.invoices.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#purchase-type-filter")?.addEventListener("change", event => {
      uiState.invoices.purchaseType = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#purchase-supplier-filter")?.addEventListener("change", event => {
      uiState.invoices.supplierId = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-purchase-new]")?.addEventListener("click", () => {
      ensureManualDraft();
      BlessERP.state.setRoute("purchases-manual");
      BlessERP.layout.renderApp();
    });
    document.querySelectorAll("[data-purchase-view]").forEach(button => button.addEventListener("click", () => {
      const purchase = purchaseService.purchases().find(item => item.id === button.dataset.purchaseView);
      if (!purchase) return;
      ensureManualDraft(purchase, "view");
      BlessERP.state.setRoute("purchases-manual");
      BlessERP.layout.renderApp();
    }));
    document.querySelectorAll("[data-purchase-edit]").forEach(button => button.addEventListener("click", () => {
      const purchase = purchaseService.purchases().find(item => item.id === button.dataset.purchaseEdit);
      if (!purchase) return;
      ensureManualDraft(purchase, "edit");
      BlessERP.state.setRoute("purchases-manual");
      BlessERP.layout.renderApp();
    }));
    document.querySelectorAll("[data-purchase-post]").forEach(button => button.addEventListener("click", () => {
      const result = purchaseService.postPurchase(button.dataset.purchasePost);
      uiState.invoices.message = result.ok
        ? `Compra ${result.purchase.documentNumber} contabilizada con asiento ${result.entry.entryNumber}.`
        : "";
      if (!result.ok) BlessERP.layout.toast((result.errors || ["No se pudo contabilizar la compra."]).join(" "));
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-purchase-retention]").forEach(button => button.addEventListener("click", () => {
      ensureRetentionDraft(button.dataset.purchaseRetention);
      BlessERP.state.setRoute("purchases-withholdings-issued");
      BlessERP.layout.renderApp();
    }));
  }

  function bindManual() {
    document.querySelector("[data-purchase-clear]")?.addEventListener("click", () => {
      ensureManualDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-manual-add-line]")?.addEventListener("click", () => {
      uiState.manual.draft = collectManualDraft();
      uiState.manual.draft.lines.push(purchaseService.emptyLine());
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-manual-remove-line]").forEach(button => button.addEventListener("click", () => {
      uiState.manual.draft = collectManualDraft();
      uiState.manual.draft.lines = uiState.manual.draft.lines.filter(line => line.id !== button.dataset.manualRemoveLine);
      if (!uiState.manual.draft.lines.length) uiState.manual.draft.lines = [purchaseService.emptyLine()];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#purchase-manual-form")?.addEventListener("change", event => {
      if (["supplierId", "purchaseType", "inventoryItemId"].includes(event.target.name)) {
        uiState.manual.draft = collectManualDraft();
        if (event.target.name === "purchaseType") {
          const config = purchaseService.purchaseTypeByCode(uiState.manual.draft.purchaseType);
          if (config?.suggestedSupportCode) uiState.manual.draft.taxSupportCode = config.suggestedSupportCode;
        }
        BlessERP.layout.renderPage();
        return;
      }
      uiState.manual.draft = collectManualDraft();
      if (purchaseService.purchaseTypeUsesInventory(uiState.manual.draft.purchaseType) && ["quantity", "unitPrice", "discount", "vatRate"].includes(event.target.name)) {
        BlessERP.layout.renderPage();
        return;
      }
      refreshManualSummary();
    });
    document.querySelector("[data-purchase-save]")?.addEventListener("click", () => {
      const result = purchaseService.savePurchase(collectManualDraft());
      uiState.manual.errors = result.errors || [];
      uiState.manual.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.manual.draft = clone(result.purchase);
      uiState.manual.mode = "edit";
      uiState.manual.message = `Compra ${result.purchase.documentNumber} guardada en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-purchase-post-editor]")?.addEventListener("click", () => {
      let current = collectManualDraft();
      if (!current.id) {
        const saveResult = purchaseService.savePurchase(current);
        if (!saveResult.ok) {
          uiState.manual.errors = saveResult.errors || [];
          BlessERP.layout.renderPage();
          return;
        }
        current = saveResult.purchase;
      }
      const result = purchaseService.postPurchase(current.id);
      uiState.manual.errors = result.errors || [];
      uiState.manual.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureManualDraft(result.purchase, "view");
      uiState.manual.message = `Compra contabilizada con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
  }

  function bindXml() {
    document.querySelector("#purchase-xml-input")?.addEventListener("change", async event => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      uiState.xml.loading = true;
      uiState.xml.message = "Leyendo XML seleccionados...";
      uiState.xml.errors = [];
      BlessERP.layout.renderPage();
      try {
        uiState.xml.batch = await Promise.all(files.map(file => purchaseService.parseXmlFile(file)));
        uiState.xml.message = `Se leyeron ${uiState.xml.batch.length} archivos para revision.`;
      } catch (error) {
        uiState.xml.errors = [error?.message || "No se pudieron leer los XML seleccionados."];
      } finally {
        uiState.xml.loading = false;
        BlessERP.layout.renderPage();
      }
    });
    document.querySelector("[data-xml-import]")?.addEventListener("click", () => {
      const result = purchaseService.importXmlBatch(uiState.xml.batch);
      uiState.xml.message = `Se importaron ${result.imported} documentos validos al modulo de compras.`;
      BlessERP.layout.renderPage();
    });
  }

  function isRetentionSelectable(purchase) {
    return ["PENDIENTE_RETENCION", "CONTABILIZADO", "RETENIDO"].includes(purchase.status);
  }

  function collectRetentionDraft() {
    const form = document.querySelector("#retention-draft-form");
    if (!form) return uiState.retentions.draft;
    const draft = clone(uiState.retentions.draft || purchaseService.emptyRetentionDraft());
    draft.purchaseId = form.elements.purchaseId?.value || "";
    draft.supplierName = form.elements.supplierName?.value || "";
    draft.supplierRuc = form.elements.supplierRuc?.value || "";
    draft.retentionDate = form.elements.retentionDate?.value || "";
    draft.draftNumber = form.elements.draftNumber?.value || draft.draftNumber;
    draft.status = form.elements.status?.value || "BORRADOR";
    draft.rentCode = form.elements.rentCode?.value || "";
    draft.rentBaseAmount = Number(form.elements.rentBaseAmount?.value || 0);
    draft.rentPercentage = Number(form.elements.rentPercentage?.value || 0);
    draft.rentRetainedAmount = Number(form.elements.rentRetainedAmount?.value || 0);
    draft.vatCode = form.elements.vatCode?.value || "";
    draft.vatBaseAmount = Number(form.elements.vatBaseAmount?.value || 0);
    draft.vatPercentage = Number(form.elements.vatPercentage?.value || 0);
    draft.vatRetainedAmount = Number(form.elements.vatRetainedAmount?.value || 0);
    return syncRetentionDraftDerivedValues(draft);
  }

  function bindRetentions() {
    document.querySelectorAll("[data-retention-from-purchase]").forEach(button => button.addEventListener("click", () => {
      ensureRetentionDraft(button.dataset.retentionFromPurchase);
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#retention-purchase-filter")?.addEventListener("change", event => {
      uiState.retentions.purchaseFilter = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-type-filter")?.addEventListener("change", event => {
      uiState.retentions.typeFilter = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-draft-form")?.addEventListener("change", event => {
      let draft = collectRetentionDraft();
      if (event.target.name === "purchaseId") {
        draft = syncRetentionDraftDerivedValues(draft, { forcePurchaseDefaults: true });
      }
      if (["rentCode", "vatCode"].includes(event.target.name)) {
        draft = syncRetentionDraftDerivedValues(draft);
      }
      uiState.retentions.draft = draft;
      if (["purchaseId", "rentCode", "vatCode", "status"].includes(event.target.name)) BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-clear]")?.addEventListener("click", () => {
      ensureRetentionDraft(uiState.retentions.purchaseFilter || filteredPendingRetentions()[0]?.id || "");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-save]")?.addEventListener("click", () => {
      const result = purchaseService.saveRetentionDraft(collectRetentionDraft());
      uiState.retentions.errors = result.errors || [];
      uiState.retentions.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.retentions.draft = syncRetentionDraftDerivedValues(result.retention);
      uiState.retentions.message = `Retencion ${result.retention.draftNumber} guardada en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-confirm]")?.addEventListener("click", () => {
      let draft = collectRetentionDraft();
      if (!draft.id) {
        const saveResult = purchaseService.saveRetentionDraft(draft);
        if (!saveResult.ok) {
          uiState.retentions.errors = saveResult.errors || ["No se pudo guardar la retencion."];
          uiState.retentions.message = "";
          return BlessERP.layout.renderPage();
        }
        draft = saveResult.retention;
      }
      const result = purchaseService.confirmRetentionDraft(draft.id);
      if (!result.ok) {
        uiState.retentions.errors = result.errors || ["No se pudo confirmar la retencion."];
        uiState.retentions.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.retentions.errors = [];
      uiState.retentions.draft = syncRetentionDraftDerivedValues(result.retention);
      uiState.retentions.message = `Retencion ${result.retention.draftNumber} confirmada con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-retention-load]").forEach(button => button.addEventListener("click", () => {
      const target = purchaseService.issuedWithholdings().find(item => item.id === button.dataset.retentionLoad);
      if (!target) return;
      uiState.retentions.errors = [];
      uiState.retentions.message = "";
      uiState.retentions.draft = syncRetentionDraftDerivedValues(target);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-retention-row-confirm]").forEach(button => button.addEventListener("click", () => {
      const result = purchaseService.confirmRetentionDraft(button.dataset.retentionRowConfirm);
      if (!result.ok) {
        uiState.retentions.errors = result.errors || ["No se pudo confirmar la retencion."];
        uiState.retentions.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.retentions.errors = [];
      uiState.retentions.message = `Retencion ${result.retention.draftNumber} confirmada con asiento ${result.entry.entryNumber}.`;
      if (uiState.retentions.draft?.id === result.retention.id) {
        uiState.retentions.draft = syncRetentionDraftDerivedValues(result.retention);
      }
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-retention-annul]").forEach(button => button.addEventListener("click", () => {
      const result = purchaseService.annulRetention(button.dataset.retentionAnnul);
      if (!result.ok) {
        uiState.retentions.errors = [result.message || "No se pudo anular la retencion."];
        uiState.retentions.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.retentions.errors = [];
      uiState.retentions.message = `Retencion ${result.retention.draftNumber} anulada.`;
      if (uiState.retentions.draft?.id === result.retention.id) {
        uiState.retentions.draft = syncRetentionDraftDerivedValues(result.retention);
      }
      BlessERP.layout.renderPage();
    }));
  }

  function render(container, route) {
    if (route.id === "purchases-invoices") {
      renderInvoices(container, route);
      return;
    }
    if (route.id === "purchases-manual") {
      renderManual(container, route);
      return;
    }
    if (route.id === "purchases-upload-xml") {
      renderXml(container, route);
      return;
    }
    if (route.id === "purchases-withholdings-issued") {
      renderRetentions(container, route);
      return;
    }
    if (route.id === "purchases-tax-supports") {
      renderSupports(container, route);
    }
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Purchases = { render, ensureManualDraft, ensureRetentionDraft };
})();
