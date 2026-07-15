(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const taxService = BlessERP.services.taxConfig;
  const chartService = BlessERP.services.chartOfAccounts;
  const withholdingXmlService = BlessERP.services.taxWithholdings;
  const receivablesService = BlessERP.services.receivables;

  const uiState = {
    taxes: {
      search: "",
      taxType: "",
      appliesTo: "",
      status: "",
      vigency: "",
      draft: null,
      message: "",
      errors: [],
      warnings: []
    },
    retentions: {
      search: "",
      taxType: "",
      category: "",
      appliesTo: "",
      status: "",
      vigency: "",
      draft: null,
      message: "",
      errors: [],
      warnings: []
    },
    received: {
      search: "",
      status: "",
      batch: [],
      loading: false,
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
    const css = value.includes("inactivo") || value.includes("anulado") || value.includes("error")
      ? "cancelled"
      : value.includes("activo") || value.includes("vigente") || value.includes("aplicado") || value.includes("importado")
        ? "authorized"
        : "pending";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function vigencyLabel(record) {
    return taxService.isRecordActiveOnDate(record, BlessERP.utils.today()) ? "Vigente" : "Fuera de vigencia";
  }

  function matchesVigency(record, filter) {
    if (!filter) return true;
    const active = taxService.isRecordActiveOnDate(record, BlessERP.utils.today());
    return filter === "vigente" ? active : !active;
  }

  function ensureTaxDraft(record = null) {
    uiState.taxes.draft = record ? clone(record) : taxService.emptyTax();
    uiState.taxes.errors = [];
    uiState.taxes.warnings = [];
    uiState.taxes.message = "";
  }

  function ensureRetentionDraft(record = null) {
    uiState.retentions.draft = record ? clone(record) : taxService.emptyRetention();
    uiState.retentions.errors = [];
    uiState.retentions.warnings = [];
    uiState.retentions.message = "";
  }

  function taxRows() {
    return taxService.taxes({
      search: uiState.taxes.search,
      taxType: uiState.taxes.taxType,
      appliesTo: uiState.taxes.appliesTo,
      status: uiState.taxes.status
    }).filter(item => matchesVigency(item, uiState.taxes.vigency));
  }

  function retentionRows() {
    return taxService.retentions({
      search: uiState.retentions.search,
      taxType: uiState.retentions.taxType,
      category: uiState.retentions.category,
      appliesTo: uiState.retentions.appliesTo,
      status: uiState.retentions.status
    }).filter(item => matchesVigency(item, uiState.retentions.vigency));
  }

  function taxSummary() {
    const rows = taxService.taxes();
    return {
      total: rows.length,
      active: rows.filter(item => item.status === "activo").length,
      iva: rows.filter(item => item.taxType === "IVA").length,
      warnings: rows.reduce((sum, item) => sum + taxService.taxWarnings(item).length, 0)
    };
  }

  function retentionSummary() {
    const rows = taxService.retentions();
    return {
      total: rows.length,
      active: rows.filter(item => item.status === "activo").length,
      renta: rows.filter(item => item.taxType === "RENTA").length,
      iva: rows.filter(item => item.taxType === "IVA").length,
      warnings: rows.reduce((sum, item) => sum + taxService.retentionWarnings(item).length, 0)
    };
  }

  function summaryCards(summary, variant = "tax") {
    const extra = variant === "tax"
      ? `<article class="summary-card"><span>Parametros IVA</span><strong>${esc(String(summary.iva))}</strong><small>Listos para compras y ventas futuras</small></article>`
      : `<article class="summary-card"><span>Renta / IVA</span><strong>${esc(`${summary.renta} / ${summary.iva}`)}</strong><small>Catalogo base reutilizable</small></article>`;
    return `
      <section class="summary-grid">
        <article class="summary-card"><span>Total registros</span><strong>${esc(String(summary.total))}</strong><small>Persistidos en almacenamiento local</small></article>
        <article class="summary-card"><span>Activos</span><strong>${esc(String(summary.active))}</strong><small>Disponibles para usar segun vigencia</small></article>
        ${extra}
        <article class="summary-card"><span>Alertas</span><strong>${esc(String(summary.warnings))}</strong><small>Cuentas faltantes o configuracion a revisar</small></article>
      </section>
    `;
  }

  function draftFeedback(message, errors, warnings) {
    return `
      ${message ? `<section class="inline-feedback success">${esc(message)}</section>` : ""}
      ${warnings?.length ? `<section class="inline-feedback warning">${warnings.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${errors?.length ? `<section class="inline-feedback danger">${errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
    `;
  }

  function movementAccountOptions(selectedCode = "") {
    return chartService.movementOptions().map(item => `
      <option value="${esc(item.code)}" ${selectedCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>
    `).join("");
  }

  function renderTaxForm(draft) {
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FICHA</p>
            <h3>${draft.id ? "Editar impuesto" : "Nuevo impuesto"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-tax-cancel>Cancelar</button>
            <button class="secondary-button" type="button" data-tax-save>Guardar impuesto</button>
          </div>
        </div>
        <form id="tax-parameter-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo interno</span><input name="internalCode" value="${esc(draft.internalCode || "")}"></label>
          <label class="compact-field"><span>Codigo SRI</span><input name="sriCode" value="${esc(draft.sriCode || "")}"></label>
          <label class="compact-field full"><span>Nombre impuesto</span><input name="name" value="${esc(draft.name || "")}"></label>
          <label class="compact-field">
            <span>Tipo impuesto</span>
            <select name="taxType">
              ${taxService.taxTypes.map(item => `<option value="${esc(item)}" ${draft.taxType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Tarifa %</span><input name="rate" type="number" min="0" step="0.01" value="${esc(String(draft.rate ?? 0))}"></label>
          <label class="compact-field">
            <span>Aplica a</span>
            <select name="appliesTo">
              ${taxService.taxScopes.map(item => `<option value="${esc(item)}" ${draft.appliesTo === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta compras</span>
            <select name="purchaseAccountCode">
              <option value="">Sin asignar</option>
              ${movementAccountOptions(draft.purchaseAccountCode)}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta ventas</span>
            <select name="salesAccountCode">
              <option value="">Sin asignar</option>
              ${movementAccountOptions(draft.salesAccountCode)}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta por pagar</span>
            <select name="payableAccountCode">
              <option value="">Sin asignar</option>
              ${movementAccountOptions(draft.payableAccountCode)}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta por cobrar</span>
            <select name="receivableAccountCode">
              <option value="">Sin asignar</option>
              ${movementAccountOptions(draft.receivableAccountCode)}
            </select>
          </label>
          <label class="compact-field"><span>Vigente desde</span><input name="effectiveFrom" type="date" value="${esc(draft.effectiveFrom || "")}"></label>
          <label class="compact-field"><span>Vigente hasta</span><input name="effectiveTo" type="date" value="${esc(draft.effectiveTo || "")}"></label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              ${taxService.parameterStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
        </form>
      </article>
    `;
  }

  function renderRetentionForm(draft) {
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FICHA</p>
            <h3>${draft.id ? "Editar retencion" : "Nueva retencion"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-retention-parameter-cancel>Cancelar</button>
            <button class="secondary-button" type="button" data-retention-parameter-save>Guardar retencion</button>
          </div>
        </div>
        <form id="retention-parameter-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo interno</span><input name="internalCode" value="${esc(draft.internalCode || "")}"></label>
          <label class="compact-field"><span>Codigo SRI</span><input name="sriCode" value="${esc(draft.sriCode || "")}"></label>
          <label class="compact-field full"><span>Descripcion</span><input name="description" value="${esc(draft.description || "")}"></label>
          <label class="compact-field">
            <span>Tipo impuesto</span>
            <select name="taxType">
              ${taxService.retentionTypes.map(item => `<option value="${esc(item)}" ${draft.taxType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Porcentaje %</span><input name="percentage" type="number" min="0" max="100" step="0.01" value="${esc(String(draft.percentage ?? 0))}"></label>
          <label class="compact-field">
            <span>Aplica a</span>
            <select name="appliesTo">
              ${taxService.retentionScopes.map(item => `<option value="${esc(item)}" ${draft.appliesTo === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Categoria</span>
            <select name="category">
              ${taxService.retentionCategories.map(item => `<option value="${esc(item)}" ${draft.category === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta por pagar</span>
            <select name="payableAccountCode">
              <option value="">Sin asignar</option>
              ${movementAccountOptions(draft.payableAccountCode)}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta por cobrar</span>
            <select name="receivableAccountCode">
              <option value="">Sin asignar</option>
              ${movementAccountOptions(draft.receivableAccountCode)}
            </select>
          </label>
          <label class="compact-field"><span>Vigente desde</span><input name="effectiveFrom" type="date" value="${esc(draft.effectiveFrom || "")}"></label>
          <label class="compact-field"><span>Vigente hasta</span><input name="effectiveTo" type="date" value="${esc(draft.effectiveTo || "")}"></label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              ${taxService.parameterStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
        </form>
      </article>
    `;
  }

  function renderTaxes(container, route) {
    const rows = taxRows();
    const summary = taxSummary();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>Catalogo central para impuestos, porcentajes, vigencias y cuentas contables sin dejar valores quemados en compras ni en procesos futuros.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Catalogo central activo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${draftFeedback(uiState.taxes.message, uiState.taxes.errors, uiState.taxes.warnings)}
      ${summaryCards(summary, "tax")}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar">
          <label class="compact-inline-field"><span>Buscar</span><input id="tax-search" placeholder="Codigo, nombre o SRI" value="${esc(uiState.taxes.search)}"></label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="tax-type-filter">
              <option value="">Todos</option>
              ${taxService.taxTypes.map(item => `<option value="${esc(item)}" ${uiState.taxes.taxType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Aplica a</span>
            <select id="tax-scope-filter">
              <option value="">Todos</option>
              ${taxService.taxScopes.map(item => `<option value="${esc(item)}" ${uiState.taxes.appliesTo === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="tax-status-filter">
              <option value="">Todos</option>
              ${taxService.parameterStates.map(item => `<option value="${esc(item)}" ${uiState.taxes.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Vigencia</span>
            <select id="tax-vigency-filter">
              <option value="">Todas</option>
              <option value="vigente" ${uiState.taxes.vigency === "vigente" ? "selected" : ""}>Vigentes</option>
              <option value="fuera" ${uiState.taxes.vigency === "fuera" ? "selected" : ""}>Fuera de vigencia</option>
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-tax-new>Nuevo impuesto</button>
          </div>
        </div>
      </section>
      ${uiState.taxes.draft ? renderTaxForm(uiState.taxes.draft) : ""}
      <article class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">PARAMETROS</p><h3>Impuestos base</h3></div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>SRI</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Tarifa</th>
                <th>Aplica</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th>Alertas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => {
                const warnings = taxService.taxWarnings(item);
                return `
                  <tr>
                    <td><strong>${esc(item.internalCode)}</strong></td>
                    <td>${esc(item.sriCode || "-")}</td>
                    <td>${esc(item.name)}</td>
                    <td>${esc(item.taxType)}</td>
                    <td>${money(item.rate).replace("$", "").trim()}%</td>
                    <td>${esc(item.appliesTo)}</td>
                    <td>${esc(item.effectiveFrom || "-")} ${item.effectiveTo ? `a ${esc(item.effectiveTo)}` : "en adelante"}</td>
                    <td>${statusBadge(`${item.status} / ${vigencyLabel(item)}`)}</td>
                    <td>${warnings.length ? `<span class="status-badge pending">${esc(String(warnings.length))}</span>` : `<span class="status-badge authorized">0</span>`}</td>
                    <td>
                      <div class="row-actions">
                        <button class="row-action-button" type="button" data-tax-edit="${esc(item.id)}">Editar</button>
                        <button class="row-action-button" type="button" data-tax-toggle="${esc(item.id)}">${item.status === "activo" ? "Inactivar" : "Activar"}</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay impuestos para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindTaxes();
  }

  function renderRetentions(container, route) {
    const rows = retentionRows();
    const summary = retentionSummary();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>Catalogo central de codigos de retencion para compras, ventas futuras y procesos tributarios posteriores, con vigencia y cuentas asociadas.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Base reutilizable activa</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${draftFeedback(uiState.retentions.message, uiState.retentions.errors, uiState.retentions.warnings)}
      ${summaryCards(summary, "retention")}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar">
          <label class="compact-inline-field"><span>Buscar</span><input id="retention-search" placeholder="Codigo, descripcion o SRI" value="${esc(uiState.retentions.search)}"></label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="retention-type-filter">
              <option value="">Todos</option>
              ${taxService.retentionTypes.map(item => `<option value="${esc(item)}" ${uiState.retentions.taxType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Categoria</span>
            <select id="retention-category-filter">
              <option value="">Todas</option>
              ${taxService.retentionCategories.map(item => `<option value="${esc(item)}" ${uiState.retentions.category === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Aplica a</span>
            <select id="retention-scope-filter">
              <option value="">Todos</option>
              ${taxService.retentionScopes.map(item => `<option value="${esc(item)}" ${uiState.retentions.appliesTo === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="retention-status-filter">
              <option value="">Todos</option>
              ${taxService.parameterStates.map(item => `<option value="${esc(item)}" ${uiState.retentions.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Vigencia</span>
            <select id="retention-vigency-filter">
              <option value="">Todas</option>
              <option value="vigente" ${uiState.retentions.vigency === "vigente" ? "selected" : ""}>Vigentes</option>
              <option value="fuera" ${uiState.retentions.vigency === "fuera" ? "selected" : ""}>Fuera de vigencia</option>
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-retention-parameter-new>Nueva retencion</button>
          </div>
        </div>
      </section>
      ${uiState.retentions.draft ? renderRetentionForm(uiState.retentions.draft) : ""}
      <article class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">PARAMETROS</p><h3>Retenciones base</h3></div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Interno</th>
                <th>SRI</th>
                <th>Descripcion</th>
                <th>Tipo</th>
                <th>%</th>
                <th>Aplica</th>
                <th>Categoria</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th>Alertas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => {
                const warnings = taxService.retentionWarnings(item);
                return `
                  <tr>
                    <td><strong>${esc(item.internalCode)}</strong></td>
                    <td>${esc(item.sriCode || "-")}</td>
                    <td>${esc(item.description)}</td>
                    <td>${esc(item.taxType)}</td>
                    <td>${money(item.percentage).replace("$", "").trim()}%</td>
                    <td>${esc(item.appliesTo)}</td>
                    <td>${esc(item.category)}</td>
                    <td>${esc(item.effectiveFrom || "-")} ${item.effectiveTo ? `a ${esc(item.effectiveTo)}` : "en adelante"}</td>
                    <td>${statusBadge(`${item.status} / ${vigencyLabel(item)}`)}</td>
                    <td>${warnings.length ? `<span class="status-badge pending">${esc(String(warnings.length))}</span>` : `<span class="status-badge authorized">0</span>`}</td>
                    <td>
                      <div class="row-actions">
                        <button class="row-action-button" type="button" data-retention-parameter-edit="${esc(item.id)}">Editar</button>
                        <button class="row-action-button" type="button" data-retention-parameter-toggle="${esc(item.id)}">${item.status === "activo" ? "Inactivar" : "Activar"}</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="11"><div class="empty-inline">No hay retenciones para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindRetentions();
  }

  function receivableOptions(selectedId = "") {
    return receivablesService.receivables({})
      .filter(item => !["COBRADO", "ANULADO"].includes(item.status))
      .map(item => `<option value="${esc(item.id)}" ${selectedId === item.id ? "selected" : ""}>${esc(item.documentNumber)} - ${esc(item.customerName)} (${money(item.balance)})</option>`)
      .join("");
  }

  function filteredReceivedRows() {
    return withholdingXmlService.receivedWithholdings({
      search: uiState.received.search,
      status: uiState.received.status
    });
  }

  function renderReceivedCards(summary) {
    return `
      <section class="summary-grid">
        <article class="summary-card"><span>Pendientes de relacion</span><strong>${esc(String(summary.pendingRelation))}</strong><small>Retenciones sin aplicar todavia</small></article>
        <article class="summary-card"><span>Importadas</span><strong>${esc(String(summary.imported))}</strong><small>Con sugerencia o listas para revisar</small></article>
        <article class="summary-card"><span>Aplicadas</span><strong>${esc(String(summary.applied))}</strong><small>Ya afectan cartera y diario</small></article>
        <article class="summary-card"><span>Renta retenida</span><strong>${money(summary.totalRent)}</strong><small>Acumulado recibido</small></article>
        <article class="summary-card"><span>IVA retenido</span><strong>${money(summary.totalVat)}</strong><small>Acumulado recibido</small></article>
      </section>
    `;
  }

  function renderReceivedXml(container, route) {
    const summary = withholdingXmlService.receivedSummary();
    const rows = filteredReceivedRows();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>Importa XML de retenciones de clientes, revisa duplicados, sugiere la relacion con cuentas por cobrar y aplica el asiento solo cuando se confirme.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge pending">ATS aun pendiente</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.received.message ? `<section class="inline-feedback success">${esc(uiState.received.message)}</section>` : ""}
      ${uiState.received.errors.length ? `<section class="inline-feedback danger">${uiState.received.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${renderReceivedCards(summary)}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar">
          <label class="compact-inline-field">
            <span>Cargar XML</span>
            <input id="received-xml-input" type="file" accept=".xml,text/xml" multiple>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-received-import ${uiState.received.batch.some(item => item.importStatus === "VALIDO") ? "" : "disabled"}>Importar validos</button>
          </div>
        </div>
        <p class="panel-note">Los XML se revisan antes de guardar. Si existe documento relacionado, el sistema lo sugiere pero no aplica la retencion automaticamente.</p>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">REVISION</p><h3>XML cargados para importar</h3></div>
          <span class="status-badge partial">${esc(String(uiState.received.batch.length))} archivos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Cliente</th>
                <th>Retencion</th>
                <th>Doc. sustento</th>
                <th>Total retenido</th>
                <th>Sugerencia</th>
                <th>Importacion</th>
              </tr>
            </thead>
            <tbody>
              ${uiState.received.batch.map(item => item.received ? `
                <tr>
                  <td>${esc(item.fileName)}</td>
                  <td><strong>${esc(item.received.issuerName)}</strong><small>${esc(item.received.issuerTaxId)}</small></td>
                  <td>${esc(item.received.documentNumber)}</td>
                  <td>${esc(item.received.supportDocumentNumber || "-")}</td>
                  <td>${money(item.received.totalRetained)}</td>
                  <td>${item.suggestion ? `${esc(item.suggestion.documentNumber)} / ${esc(item.suggestion.matchType)}` : "Sin coincidencia"}</td>
                  <td>${statusBadge(item.importStatus)}</td>
                </tr>
              ` : `
                <tr>
                  <td>${esc(item.fileName || "-")}</td>
                  <td colspan="5">${esc(item.error || "No se pudo leer el XML.")}</td>
                  <td>${statusBadge(item.importStatus || "ERROR_XML")}</td>
                </tr>
              `).join("") || `<tr><td colspan="7"><div class="empty-inline">${uiState.received.loading ? "Leyendo XML..." : "Todavia no se han cargado XML de retenciones."}</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar">
          <label class="compact-inline-field"><span>Buscar</span><input id="received-search" placeholder="Cliente, RUC, retencion o sustento" value="${esc(uiState.received.search)}"></label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="received-status-filter">
              <option value="">Todos</option>
              ${withholdingXmlService.receivedStatuses.map(item => `<option value="${esc(item)}" ${uiState.received.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
        </div>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">BANDEJA</p><h3>Retenciones recibidas importadas</h3></div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Retencion</th>
                <th>Doc. sustento</th>
                <th>Renta / IVA</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Relacion</th>
                <th>Asiento</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.issueDate)}</td>
                  <td><strong>${esc(item.issuerName)}</strong><small>${esc(item.issuerTaxId)}</small></td>
                  <td>${esc(item.documentNumber)}</td>
                  <td>${esc(item.supportDocumentNumber || "-")}</td>
                  <td>${money(item.totalRent)} / ${money(item.totalVat)}</td>
                  <td>${money(item.totalRetained)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>
                    <select data-received-link="${esc(item.id)}" ${item.status === "APLICADO" || item.status === "ANULADO" ? "disabled" : ""}>
                      <option value="">Seleccionar documento</option>
                      ${receivableOptions(item.relatedReceivableId || item.suggestedReceivableId)}
                    </select>
                    <small class="line-hint">${esc(item.relatedReceivableNumber || item.suggestedReceivableNumber || "Sin relacion sugerida")}</small>
                  </td>
                  <td>${esc(item.journalEntryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      ${item.status !== "APLICADO" && item.status !== "ANULADO" ? `<button class="row-action-button" type="button" data-received-apply="${esc(item.id)}">Aplicar</button>` : ""}
                      ${item.status !== "ANULADO" ? `<button class="row-action-button" type="button" data-received-annul="${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay retenciones recibidas para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindReceivedXml();
  }

  function collectTaxDraft() {
    const form = document.querySelector("#tax-parameter-form");
    if (!form) return clone(uiState.taxes.draft || taxService.emptyTax());
    return {
      ...(uiState.taxes.draft || taxService.emptyTax()),
      internalCode: form.elements.internalCode?.value || "",
      sriCode: form.elements.sriCode?.value || "",
      name: form.elements.name?.value || "",
      taxType: form.elements.taxType?.value || "IVA",
      rate: Number(form.elements.rate?.value || 0),
      appliesTo: form.elements.appliesTo?.value || "ambos",
      purchaseAccountCode: form.elements.purchaseAccountCode?.value || "",
      salesAccountCode: form.elements.salesAccountCode?.value || "",
      payableAccountCode: form.elements.payableAccountCode?.value || "",
      receivableAccountCode: form.elements.receivableAccountCode?.value || "",
      effectiveFrom: form.elements.effectiveFrom?.value || "",
      effectiveTo: form.elements.effectiveTo?.value || "",
      status: form.elements.status?.value || "activo",
      observation: form.elements.observation?.value || ""
    };
  }

  function collectRetentionDraft() {
    const form = document.querySelector("#retention-parameter-form");
    if (!form) return clone(uiState.retentions.draft || taxService.emptyRetention());
    return {
      ...(uiState.retentions.draft || taxService.emptyRetention()),
      internalCode: form.elements.internalCode?.value || "",
      sriCode: form.elements.sriCode?.value || "",
      description: form.elements.description?.value || "",
      taxType: form.elements.taxType?.value || "RENTA",
      percentage: Number(form.elements.percentage?.value || 0),
      appliesTo: form.elements.appliesTo?.value || "compra",
      category: form.elements.category?.value || "otros",
      payableAccountCode: form.elements.payableAccountCode?.value || "",
      receivableAccountCode: form.elements.receivableAccountCode?.value || "",
      effectiveFrom: form.elements.effectiveFrom?.value || "",
      effectiveTo: form.elements.effectiveTo?.value || "",
      status: form.elements.status?.value || "activo",
      observation: form.elements.observation?.value || ""
    };
  }

  function bindTaxes() {
    document.querySelector("#tax-search")?.addEventListener("input", event => {
      uiState.taxes.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#tax-type-filter")?.addEventListener("change", event => {
      uiState.taxes.taxType = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#tax-scope-filter")?.addEventListener("change", event => {
      uiState.taxes.appliesTo = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#tax-status-filter")?.addEventListener("change", event => {
      uiState.taxes.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#tax-vigency-filter")?.addEventListener("change", event => {
      uiState.taxes.vigency = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-tax-new]")?.addEventListener("click", () => {
      ensureTaxDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-tax-cancel]")?.addEventListener("click", () => {
      uiState.taxes.draft = null;
      uiState.taxes.errors = [];
      uiState.taxes.warnings = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-tax-save]")?.addEventListener("click", () => {
      const result = taxService.saveTax(collectTaxDraft());
      uiState.taxes.errors = result.errors || [];
      uiState.taxes.warnings = result.warnings || [];
      uiState.taxes.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.taxes.draft = clone(result.tax);
      uiState.taxes.message = `Impuesto ${result.tax.internalCode} guardado correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-tax-edit]").forEach(button => button.addEventListener("click", () => {
      const record = taxService.findTaxById(button.dataset.taxEdit);
      if (!record) return;
      ensureTaxDraft(record);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-tax-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = taxService.toggleTaxStatus(button.dataset.taxToggle);
      uiState.taxes.message = result.ok ? `Estado de ${result.tax.internalCode} actualizado.` : (result.message || "");
      uiState.taxes.errors = [];
      uiState.taxes.warnings = [];
      BlessERP.layout.renderPage();
    }));
  }

  function bindRetentions() {
    document.querySelector("#retention-search")?.addEventListener("input", event => {
      uiState.retentions.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-type-filter")?.addEventListener("change", event => {
      uiState.retentions.taxType = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-category-filter")?.addEventListener("change", event => {
      uiState.retentions.category = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-scope-filter")?.addEventListener("change", event => {
      uiState.retentions.appliesTo = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-status-filter")?.addEventListener("change", event => {
      uiState.retentions.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-vigency-filter")?.addEventListener("change", event => {
      uiState.retentions.vigency = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-parameter-new]")?.addEventListener("click", () => {
      ensureRetentionDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-parameter-cancel]")?.addEventListener("click", () => {
      uiState.retentions.draft = null;
      uiState.retentions.errors = [];
      uiState.retentions.warnings = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-parameter-save]")?.addEventListener("click", () => {
      const result = taxService.saveRetention(collectRetentionDraft());
      uiState.retentions.errors = result.errors || [];
      uiState.retentions.warnings = result.warnings || [];
      uiState.retentions.message = "";
      if (!result.ok) return BlessERP.layout.renderPage();
      uiState.retentions.draft = clone(result.retention);
      uiState.retentions.message = `Retencion ${result.retention.internalCode} guardada correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-retention-parameter-edit]").forEach(button => button.addEventListener("click", () => {
      const record = taxService.findRetentionById(button.dataset.retentionParameterEdit);
      if (!record) return;
      ensureRetentionDraft(record);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-retention-parameter-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = taxService.toggleRetentionStatus(button.dataset.retentionParameterToggle);
      uiState.retentions.message = result.ok ? `Estado de ${result.retention.internalCode} actualizado.` : (result.message || "");
      uiState.retentions.errors = [];
      uiState.retentions.warnings = [];
      BlessERP.layout.renderPage();
    }));
  }

  function bindReceivedXml() {
    document.querySelector("#received-search")?.addEventListener("input", event => {
      uiState.received.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#received-status-filter")?.addEventListener("change", event => {
      uiState.received.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#received-xml-input")?.addEventListener("change", async event => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      uiState.received.loading = true;
      uiState.received.message = "Leyendo XML de retenciones...";
      uiState.received.errors = [];
      BlessERP.layout.renderPage();
      try {
        uiState.received.batch = await Promise.all(files.map(file => withholdingXmlService.parseRetentionXmlFile(file)));
        uiState.received.message = `Se revisaron ${uiState.received.batch.length} XML de retenciones.`;
      } catch (error) {
        uiState.received.errors = [error?.message || "No se pudieron leer los XML de retenciones."];
      } finally {
        uiState.received.loading = false;
        BlessERP.layout.renderPage();
      }
    });
    document.querySelector("[data-received-import]")?.addEventListener("click", () => {
      const result = withholdingXmlService.importReceivedXmlBatch(uiState.received.batch);
      uiState.received.message = `Se importaron ${result.imported} retenciones recibidas.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-received-apply]").forEach(button => button.addEventListener("click", () => {
      const related = document.querySelector(`[data-received-link="${button.dataset.receivedApply}"]`)?.value || "";
      const result = withholdingXmlService.applyReceivedWithholding(button.dataset.receivedApply, related);
      if (!result.ok) {
        uiState.received.errors = result.errors || ["No se pudo aplicar la retencion."];
        uiState.received.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.received.errors = [];
      uiState.received.message = `Retencion ${result.received.documentNumber} aplicada con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-received-annul]").forEach(button => button.addEventListener("click", () => {
      const result = withholdingXmlService.annulReceivedWithholding(button.dataset.receivedAnnul);
      if (!result.ok) {
        uiState.received.errors = [result.message || "No se pudo anular la retencion."];
        uiState.received.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.received.errors = [];
      uiState.received.message = `Retencion ${result.received.documentNumber} anulada.`;
      BlessERP.layout.renderPage();
    }));
  }

  function render(container, route) {
    if (route.id === "tax-retention-parameters") {
      renderRetentions(container, route);
      return;
    }
    if (route.id === "tax-withholdings-received") {
      renderReceivedXml(container, route);
      return;
    }
    renderTaxes(container, route);
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Tax = { render };
})();
