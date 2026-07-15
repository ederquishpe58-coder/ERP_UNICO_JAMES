(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const receivableService = BlessERP.services.receivables;
  const chartService = BlessERP.services.chartOfAccounts;
  const bankService = BlessERP.services.banks;

  const uiState = {
    customers: {
      search: "",
      type: "",
      country: "",
      status: "",
      message: "",
      errors: [],
      draft: null
    },
    receivables: {
      search: "",
      customerId: "",
      status: "",
      documentType: "",
      message: "",
      errors: [],
      draft: null
    },
    collections: {
      draft: null,
      message: "",
      errors: []
    },
    bulk: {
      customerId: "",
      state: "",
      dueUntil: "",
      draft: null,
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
    const css = value.includes("anulado") || value.includes("inactivo")
      ? "cancelled"
      : value.includes("borrador") || value.includes("pendiente") || value.includes("vencido")
        ? "pending"
        : value.includes("cobrado") || value.includes("confirmado") || value.includes("activo")
          ? "authorized"
          : "partial";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function activeAccounts() {
    return chartService.movementOptions();
  }

  function collectionAccounts() {
    return receivableService.activeCollectionAccountOptions();
  }

  function activeBanks() {
    return bankService.accountsWithSummary({ status: "activa" });
  }

  function customerRows() {
    return receivableService.customers().filter(item => {
      const search = String(uiState.customers.search || "").toLowerCase();
      const haystack = [item.code, item.taxId, item.name, item.commercialName, item.customerType, item.country].join(" ").toLowerCase();
      return (!search || haystack.includes(search))
        && (!uiState.customers.type || item.customerType === uiState.customers.type)
        && (!uiState.customers.status || item.status === uiState.customers.status)
        && (!uiState.customers.country || item.country.toLowerCase().includes(uiState.customers.country.toLowerCase()));
    });
  }

  function receivableRows() {
    return receivableService.receivables({
      search: uiState.receivables.search,
      customerId: uiState.receivables.customerId,
      status: uiState.receivables.status,
      documentType: uiState.receivables.documentType
    });
  }

  function ensureCustomerDraft(customer = null) {
    uiState.customers.draft = customer ? clone(customer) : {
      id: "",
      code: "",
      taxId: "",
      name: "",
      commercialName: "",
      customerType: "otro",
      country: "Ecuador",
      city: "",
      address: "",
      phone: "",
      email: "",
      paymentCondition: "Credito 30 dias",
      creditDays: 30,
      creditLimit: 0,
      receivableAccountCode: BlessERP.services.companySettings.settings().defaultAccounts?.accountsReceivableCustomers || "",
      advanceAccountCode: BlessERP.services.companySettings.settings().defaultAccounts?.customerAdvances || "",
      status: "activo",
      observation: ""
    };
    uiState.customers.errors = [];
    uiState.customers.message = "";
  }

  function ensureReceivableDraft(receivable = null) {
    uiState.receivables.draft = receivable ? clone(receivable) : receivableService.emptyReceivable();
    uiState.receivables.errors = [];
    uiState.receivables.message = "";
  }

  function receivableDraftFromDocument(receivableId = "") {
    return receivableService.receivableDocuments().find(item => item.id === receivableId) || receivableService.emptyReceivable();
  }

  function collectionDraftFromReceivable(receivableId = "") {
    const draft = receivableService.emptyCollection();
    const receivable = receivableService.receivables().find(item => item.id === receivableId);
    if (!receivable) return draft;
    draft.customerId = receivable.customerId;
    draft.customerName = receivable.customerName;
    draft.customerTaxId = receivable.customerTaxId;
    draft.applications = [{
      receivableId: receivable.id,
      customerId: receivable.customerId,
      customerName: receivable.customerName,
      customerTaxId: receivable.customerTaxId,
      documentNumber: receivable.documentNumber,
      originalBalance: receivable.balance,
      retentionApplied: 0,
      advanceApplied: 0,
      amount: receivable.balance,
      resultingBalance: 0,
      receivableAccountCode: receivable.receivableAccountCode
    }];
    draft.total = receivable.balance;
    return receivableService.normalizeCollection(draft);
  }

  function ensureCollectionDraft(collection = null) {
    uiState.collections.draft = collection ? clone(collection) : receivableService.emptyCollection();
    uiState.collections.errors = [];
    uiState.collections.message = "";
  }

  function ensureCollectionBatchDraft(batch = null) {
    uiState.bulk.draft = batch ? clone(batch) : receivableService.emptyCollectionBatch();
    uiState.bulk.errors = [];
    uiState.bulk.message = "";
  }

  function renderCustomers(container, route) {
    const rows = customerRows();
    const draft = uiState.customers.draft;
    const accounts = activeAccounts();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Clientes</h1>
          <p>Catalogo base de clientes del ERP, preparado para cartera local y exterior sin tocar aun ventas reales.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Catalogo local activo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.customers.message ? `<section class="inline-feedback success">${esc(uiState.customers.message)}</section>` : ""}
      ${uiState.customers.errors.length ? `<section class="inline-feedback danger">${uiState.customers.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-portfolio-providers">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="customer-search" placeholder="Codigo, identificacion, nombre o pais" value="${esc(uiState.customers.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="customer-type-filter">
              <option value="">Todos</option>
              ${receivableService.customerTypes.map(item => `<option value="${esc(item)}" ${uiState.customers.type === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Pais</span>
            <input id="customer-country-filter" placeholder="Ecuador, USA, Netherlands..." value="${esc(uiState.customers.country)}">
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="customer-status-filter">
              <option value="">Todos</option>
              ${receivableService.customerStates.map(item => `<option value="${esc(item)}" ${uiState.customers.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-customer-new>Nuevo cliente</button>
          </div>
        </div>
      </section>
      ${draft ? `
        <article class="panel-card editor-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">FICHA</p>
              <h3>${draft.id ? "Editar cliente" : "Nuevo cliente"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-customer-cancel>Cancelar</button>
              <button class="secondary-button" type="button" data-customer-save>Guardar cliente</button>
            </div>
          </div>
          <form id="customer-form" class="compact-form-grid">
            <label class="compact-field"><span>Codigo cliente</span><input name="code" value="${esc(draft.code || "")}"></label>
            <label class="compact-field"><span>Identificacion</span><input name="taxId" value="${esc(draft.taxId || "")}"></label>
            <label class="compact-field"><span>Razon social / nombre</span><input name="name" value="${esc(draft.name || "")}"></label>
            <label class="compact-field"><span>Nombre comercial</span><input name="commercialName" value="${esc(draft.commercialName || "")}"></label>
            <label class="compact-field">
              <span>Tipo cliente</span>
              <select name="customerType">
                ${receivableService.customerTypes.map(item => `<option value="${esc(item)}" ${draft.customerType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Pais</span><input name="country" value="${esc(draft.country || "")}"></label>
            <label class="compact-field"><span>Ciudad</span><input name="city" value="${esc(draft.city || "")}"></label>
            <label class="compact-field"><span>Telefono</span><input name="phone" value="${esc(draft.phone || "")}"></label>
            <label class="compact-field"><span>Correo</span><input name="email" value="${esc(draft.email || "")}"></label>
            <label class="compact-field">
              <span>Condicion de pago</span>
              <select name="paymentCondition">
                ${receivableService.paymentConditions.map(item => `<option value="${esc(item)}" ${draft.paymentCondition === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Dias de credito</span><input name="creditDays" type="number" min="0" step="1" value="${esc(String(draft.creditDays || 0))}"></label>
            <label class="compact-field"><span>Limite de credito</span><input name="creditLimit" type="number" min="0" step="0.01" value="${esc(String(draft.creditLimit || 0))}"></label>
            <label class="compact-field">
              <span>Cuenta por cobrar asociada</span>
              <select name="receivableAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.receivableAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Cuenta anticipo asociada</span>
              <select name="advanceAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.advanceAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Estado</span>
              <select name="status">
                ${receivableService.customerStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field full"><span>Direccion</span><textarea name="address" rows="2">${esc(draft.address || "")}</textarea></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          </form>
        </article>
      ` : ""}
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CATALOGO</p>
            <h3>Clientes</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-providers">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Identificacion</th>
                <th>Razon social</th>
                <th>Nombre comercial</th>
                <th>Tipo</th>
                <th>Pais</th>
                <th>Ciudad</th>
                <th>Telefono</th>
                <th>Correo</th>
                <th>Condicion</th>
                <th>Dias</th>
                <th>Limite</th>
                <th>CxC</th>
                <th>Anticipo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td><strong>${esc(item.code || "-")}</strong></td>
                  <td>${esc(item.taxId)}</td>
                  <td>${esc(item.name)}</td>
                  <td>${esc(item.commercialName || "-")}</td>
                  <td>${esc(item.customerType)}</td>
                  <td>${esc(item.country || "-")}</td>
                  <td>${esc(item.city || "-")}</td>
                  <td>${esc(item.phone || "-")}</td>
                  <td>${esc(item.email || "-")}</td>
                  <td>${esc(item.paymentCondition || "-")}</td>
                  <td>${esc(String(item.creditDays || 0))}</td>
                  <td>${money(item.creditLimit || 0)}</td>
                  <td>${esc(item.receivableAccountCode || "-")}</td>
                  <td>${esc(item.advanceAccountCode || "-")}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-customer-edit="${esc(item.id)}">Editar</button>
                      <button class="row-action-button" type="button" data-customer-portfolio="${esc(item.id)}">Cartera</button>
                      <button class="row-action-button" type="button" data-customer-toggle="${esc(item.id)}">${item.status === "activo" ? "Inactivar" : "Activar"}</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="16"><div class="empty-inline">No hay clientes para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindCustomers();
  }

  function renderReceivables(container, route) {
    const rows = receivableRows();
    const summary = {
      totalPending: rows.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.status)).reduce((sum, item) => sum + item.balance, 0),
      totalOverdue: rows.filter(item => item.status === "VENCIDO").reduce((sum, item) => sum + item.balance, 0),
      totalCollected: rows.reduce((sum, item) => sum + item.collected, 0),
      openDocs: rows.filter(item => !["COBRADO", "ANULADO"].includes(item.status)).length
    };
    const customerSummary = uiState.receivables.customerId ? receivableService.customerPortfolioSummary(uiState.receivables.customerId) : null;
    const draft = uiState.receivables.draft;
    const accounts = activeAccounts();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Cuentas por cobrar</h1>
          <p>Documentos manuales de cartera, saldos iniciales y ajustes preparados para que ventas futuras alimenten este modulo automaticamente.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Cartera local activa</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.receivables.message ? `<section class="inline-feedback success">${esc(uiState.receivables.message)}</section>` : ""}
      ${uiState.receivables.errors.length ? `<section class="inline-feedback danger">${uiState.receivables.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="summary-grid summary-grid-payables">
        <article class="summary-card"><span>Total pendiente</span><strong>${money(summary.totalPending)}</strong><small>Documentos abiertos</small></article>
        <article class="summary-card"><span>Total vencido</span><strong>${money(summary.totalOverdue)}</strong><small>Solo documentos vencidos</small></article>
        <article class="summary-card"><span>Total cobrado</span><strong>${money(summary.totalCollected)}</strong><small>Aplicado en cobros confirmados</small></article>
        <article class="summary-card"><span>Documentos abiertos</span><strong>${esc(String(summary.openDocs))}</strong><small>Cartera vigente</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-payables">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="receivable-search" placeholder="Cliente, documento, concepto o asiento" value="${esc(uiState.receivables.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Cliente</span>
            <select id="receivable-customer-filter">
              <option value="">Todos</option>
              ${receivableService.customers().map(item => `<option value="${esc(item.id)}" ${uiState.receivables.customerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="receivable-state-filter">
              <option value="">Todos</option>
              ${receivableService.receivableStates.map(item => `<option value="${esc(item)}" ${uiState.receivables.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo documento</span>
            <select id="receivable-type-filter">
              <option value="">Todos</option>
              ${receivableService.receivableDocumentTypes.map(item => `<option value="${esc(item)}" ${uiState.receivables.documentType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-receivable-new>Nuevo documento</button>
            <button class="secondary-button" type="button" data-route-link="portfolios-collections-single">Nuevo cobro</button>
          </div>
        </div>
      </section>
      ${customerSummary ? `
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN CLIENTE</p>
              <h3>${esc(customerSummary.customer.name)}</h3>
            </div>
            ${statusBadge(customerSummary.customer.status)}
          </div>
          <div class="info-stack info-grid-two">
            <div class="info-row"><strong>Total pendiente</strong><span>${money(customerSummary.totalPending)}</span></div>
            <div class="info-row"><strong>Total vencido</strong><span>${money(customerSummary.totalOverdue)}</span></div>
            <div class="info-row"><strong>Total por vencer</strong><span>${money(customerSummary.totalUpcoming)}</span></div>
            <div class="info-row"><strong>Total cobrado periodo</strong><span>${money(customerSummary.totalCollectedPeriod)}</span></div>
            <div class="info-row"><strong>Retenciones recibidas</strong><span>Se implementaran en modulo tributario posterior.</span></div>
            <div class="info-row"><strong>Anticipos disponibles</strong><span>Se implementaran en una fase posterior.</span></div>
            <div class="info-row"><strong>Ultimo cobro</strong><span>${esc(customerSummary.latestCollection?.collectionNumber || customerSummary.latestCollection?.batchNumber || "No registrado")}</span></div>
            <div class="info-row"><strong>Documentos abiertos</strong><span>${esc(String(customerSummary.openDocuments))}</span></div>
          </div>
        </article>
      ` : ""}
      ${draft ? `
        <article class="panel-card editor-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">DOCUMENTO</p>
              <h3>${draft.id ? `Documento ${esc(draft.documentNumber)}` : "Nuevo documento de cartera"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-receivable-cancel>Cancelar</button>
              <button class="secondary-button" type="button" data-receivable-save>Guardar</button>
              ${!draft.journalEntryId ? `<button class="secondary-button" type="button" data-receivable-post>Guardar y contabilizar</button>` : ""}
            </div>
          </div>
          <form id="receivable-form" class="compact-form-grid">
            <label class="compact-field">
              <span>Cliente</span>
              <select name="customerId">
                <option value="">Seleccionar cliente</option>
                ${receivableService.customers().map(item => `<option value="${esc(item.id)}" ${draft.customerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Tipo documento</span>
              <select name="documentType">
                ${receivableService.receivableDocumentTypes.map(item => `<option value="${esc(item)}" ${draft.documentType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Numero documento</span><input name="documentNumber" value="${esc(draft.documentNumber || "")}"></label>
            <label class="compact-field"><span>Fecha emision</span><input name="issueDate" type="date" value="${esc(draft.issueDate || "")}"></label>
            <label class="compact-field"><span>Fecha vencimiento</span><input name="dueDate" type="date" value="${esc(draft.dueDate || "")}"></label>
            <label class="compact-field"><span>Total</span><input name="total" type="number" min="0" step="0.01" value="${esc(String(draft.total || 0))}"></label>
            <label class="compact-field">
              <span>Cuenta por cobrar</span>
              <select name="receivableAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.receivableAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Cuenta ingreso / contrapartida</span>
              <select name="counterAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.counterAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Asiento relacionado</span><input value="${esc(draft.journalEntryNumber || "Aun no generado")}" readonly></label>
            <label class="compact-field full"><span>Concepto</span><input name="concept" value="${esc(draft.concept || "")}"></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          </form>
          <p class="panel-note">Retenciones recibidas por XML se implementaran en modulo tributario posterior. Anticipos aplicados quedaran para una fase posterior.</p>
        </article>
      ` : ""}
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">DOCUMENTOS</p>
            <h3>Cartera por cobrar</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} documentos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-payables">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Identificacion</th>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Fecha emision</th>
                <th>Vencimiento</th>
                <th>Total</th>
                <th>Ret. recibidas</th>
                <th>Anticipos</th>
                <th>Cobrado</th>
                <th>Saldo</th>
                <th>Estado</th>
                <th>Asiento</th>
                <th>Dias venc.</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td><strong>${esc(item.customerName)}</strong><small>${esc(item.customerCode || "")}</small></td>
                  <td>${esc(item.customerTaxId || "-")}</td>
                  <td>${esc(item.documentNumber)}</td>
                  <td>${esc(item.documentType)}</td>
                  <td>${esc(item.issueDate)}</td>
                  <td>${esc(item.dueDate || "-")}</td>
                  <td>${money(item.total)}</td>
                  <td><span class="muted-text">Pendiente modulo tributario</span></td>
                  <td><span class="muted-text">Fase posterior</span></td>
                  <td>${money(item.collected)}</td>
                  <td><strong>${money(item.balance)}</strong></td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.journalEntryNumber || "-")}</td>
                  <td>${esc(String(item.overdueDays || 0))}</td>
                  <td>
                    <div class="row-actions">
                      ${!item.journalEntryId && item.status !== "ANULADO" ? `<button class="row-action-button" type="button" data-receivable-edit="${esc(item.id)}">Editar</button>` : ""}
                      ${!item.journalEntryId && item.status !== "ANULADO" ? `<button class="row-action-button" type="button" data-receivable-post-row="${esc(item.id)}">Contabilizar</button>` : ""}
                      ${!["COBRADO", "ANULADO"].includes(item.status) ? `<button class="row-action-button" type="button" data-receivable-collect="${esc(item.id)}">Cobrar</button>` : ""}
                      ${item.status !== "ANULADO" ? `<button class="row-action-button" type="button" data-receivable-annul="${esc(item.id)}">Anular</button>` : ""}
                      <button class="row-action-button" type="button" data-receivable-customer="${esc(item.customerId)}">Cliente</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="15"><div class="empty-inline">No hay cuentas por cobrar para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindReceivables();
  }

  function collectionApplicationsFromVisible(existing = [], customerId = uiState.collections.draft?.customerId || "") {
    const documents = customerId ? receivableService.pendingReceivablesByCustomer(customerId) : [];
    return documents.map(document => {
      const current = existing.find(item => item.receivableId === document.id) || {};
      const amount = Number(current.amount || 0);
      return {
        receivableId: document.id,
        customerId: document.customerId,
        customerName: document.customerName,
        customerTaxId: document.customerTaxId,
        documentNumber: document.documentNumber,
        originalBalance: document.balance,
        retentionApplied: 0,
        advanceApplied: 0,
        amount,
        resultingBalance: Number((document.balance - amount).toFixed(2)),
        receivableAccountCode: document.receivableAccountCode
      };
    });
  }

  function collectCollectionDraft() {
    const form = document.querySelector("#collection-form");
    const base = clone(uiState.collections.draft || receivableService.emptyCollection());
    if (!form) return base;
    const selectedBank = form.elements.bankAccountId?.value || "";
    const bankAccount = selectedBank ? bankService.findBankAccountById(selectedBank) : null;
    const customerId = form.elements.customerId?.value || "";
    base.customerId = customerId;
    base.collectionDate = form.elements.collectionDate?.value || "";
    base.collectionMethod = form.elements.collectionMethod?.value || "transferencia";
    base.collectionAccountCode = form.elements.collectionAccountCode?.value || bankAccount?.linkedAccountCode || "";
    base.bankAccountId = selectedBank;
    base.reference = form.elements.reference?.value || "";
    base.observation = form.elements.observation?.value || "";
    base.applications = Array.from(document.querySelectorAll(".compact-table-payments-detail tbody tr[data-collection-application-id]")).map(row => {
      const current = collectionApplicationsFromVisible(uiState.collections.draft?.applications || [], customerId).find(item => item.receivableId === row.dataset.collectionApplicationId) || {};
      const selected = row.querySelector('[name="selected"]')?.checked;
      const amount = selected ? Number(row.querySelector('[name="amount"]')?.value || 0) : 0;
      return {
        ...current,
        amount,
        resultingBalance: Number((Number(current.originalBalance || 0) - amount).toFixed(2))
      };
    }).filter(item => Number(item.amount || 0) > 0 || String(item.receivableId || "").length);
    return receivableService.normalizeCollection(base);
  }

  function renderCollectionsSingle(container, route) {
    if (!uiState.collections.draft) ensureCollectionDraft();
    const draft = receivableService.normalizeCollection(uiState.collections.draft);
    uiState.collections.draft = draft;
    const applications = collectionApplicationsFromVisible(draft.applications || []);
    const history = receivableService.collections();
    const accounts = collectionAccounts();
    const banks = activeBanks();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Cobros individuales</h1>
          <p>Cobros parciales o totales por cliente, con asiento contable y enlace al modulo de bancos sin duplicar movimientos.</p>
        </div>
        <div class="page-header-side">
          ${statusBadge(draft.status || "BORRADOR")}
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.collections.message ? `<section class="inline-feedback success">${esc(uiState.collections.message)}</section>` : ""}
      ${uiState.collections.errors.length ? `<section class="inline-feedback danger">${uiState.collections.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid purchase-editor-layout">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">COBRO</p>
              <h3>${draft.id ? `Cobro ${esc(draft.collectionNumber)}` : "Nuevo cobro"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-collection-reset>Nuevo</button>
              <button class="secondary-button" type="button" data-collection-select-full>Seleccionar saldos completos</button>
              <button class="secondary-button" type="button" data-collection-save>Guardar borrador</button>
              <button class="secondary-button" type="button" data-collection-confirm>Confirmar cobro</button>
            </div>
          </div>
          <form id="collection-form" class="compact-form-grid">
            <label class="compact-field"><span>Numero cobro</span><input name="collectionNumber" value="${esc(draft.collectionNumber || "")}" readonly></label>
            <label class="compact-field"><span>Fecha cobro</span><input name="collectionDate" type="date" value="${esc(draft.collectionDate || "")}"></label>
            <label class="compact-field">
              <span>Cliente</span>
              <select name="customerId">
                <option value="">Seleccionar cliente</option>
                ${receivableService.customers().map(item => `<option value="${esc(item.id)}" ${draft.customerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Medio de cobro</span>
              <select name="collectionMethod">
                ${receivableService.collectionMethods.map(item => `<option value="${esc(item)}" ${draft.collectionMethod === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Cuenta contable de cobro</span>
              <select name="collectionAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.collectionAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Cuenta bancaria / caja</span>
              <select name="bankAccountId">
                <option value="">Sin enlace bancario</option>
                ${banks.map(item => `<option value="${esc(item.id)}" ${draft.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.bankName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Referencia / comprobante</span><input name="reference" value="${esc(draft.reference || "")}"></label>
            <label class="compact-field"><span>Asiento relacionado</span><input value="${esc(draft.entryNumber || "Aun no generado")}" readonly></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          </form>
          <div class="compact-table-wrap">
            <table class="compact-table compact-table-payments-detail">
              <thead>
                <tr>
                  <th>Sel.</th>
                  <th>Documento</th>
                  <th>Emision</th>
                  <th>Vencimiento</th>
                  <th>Saldo</th>
                  <th>Aplicar</th>
                  <th>Saldo posterior</th>
                </tr>
              </thead>
              <tbody>
                ${applications.map(item => {
                  const checked = Number(item.amount || 0) > 0;
                  const receivable = receivableService.receivables().find(row => row.id === item.receivableId);
                  return `
                    <tr data-collection-application-id="${esc(item.receivableId)}">
                      <td><input name="selected" type="checkbox" ${checked ? "checked" : ""}></td>
                      <td><strong>${esc(item.documentNumber)}</strong><small>${esc(receivable?.concept || "")}</small></td>
                      <td>${esc(receivable?.issueDate || "-")}</td>
                      <td>${esc(receivable?.dueDate || "-")}</td>
                      <td>${money(item.originalBalance)}</td>
                      <td><input name="amount" type="number" step="0.01" min="0" max="${esc(String(item.originalBalance || 0))}" value="${esc(String(item.amount || 0))}"></td>
                      <td><strong>${money(item.resultingBalance)}</strong></td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="7"><div class="empty-inline">Seleccione un cliente con documentos pendientes.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN</p>
              <h3>Control del cobro</h3>
            </div>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Cliente</strong><span>${esc(draft.customerName || "No seleccionado")}</span></div>
            <div class="info-row"><strong>Total a cobrar</strong><span>${money(draft.total || 0)}</span></div>
            <div class="info-row"><strong>Estado</strong><span>${esc(draft.status || "BORRADOR")}</span></div>
            <div class="info-row"><strong>Cuenta banco/caja</strong><span>${esc((bankService.findBankAccountById(draft.bankAccountId)?.bankName) || "Sin enlace")}</span></div>
            <div class="info-row"><strong>Retenciones recibidas</strong><span>Se implementaran en modulo tributario posterior.</span></div>
            <div class="info-row"><strong>Anticipos aplicados</strong><span>Se implementaran en una fase posterior.</span></div>
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Cobros individuales registrados</h3>
          </div>
          <span class="status-badge partial">${esc(String(history.length))} cobros</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Cobro</th><th>Cliente</th><th>Cuenta</th><th>Total</th><th>Estado</th><th>Asiento</th><th>Acciones</th></tr></thead>
            <tbody>
              ${history.map(item => `
                <tr>
                  <td>${esc(item.collectionDate)}</td>
                  <td>${esc(item.collectionNumber)}</td>
                  <td>${esc(item.customerName || "-")}</td>
                  <td>${esc(item.collectionAccountCode || "-")}</td>
                  <td>${money(item.total || 0)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.entryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      ${item.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-collection-edit="${esc(item.id)}">Editar</button><button class="row-action-button" type="button" data-collection-post-row="${esc(item.id)}">Confirmar</button>` : ""}
                      ${item.status === "CONFIRMADO" ? `<button class="row-action-button" type="button" data-collection-annul="${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay cobros registrados.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindCollectionsSingle();
  }

  function bulkApplicationsFromVisible(existing = []) {
    return receivableService.receivables().filter(item => {
      if (uiState.bulk.customerId && item.customerId !== uiState.bulk.customerId) return false;
      if (uiState.bulk.state && item.status !== uiState.bulk.state) return false;
      if (uiState.bulk.dueUntil && item.dueDate > uiState.bulk.dueUntil) return false;
      if (["COBRADO", "ANULADO"].includes(item.status)) return false;
      return true;
    }).map(document => {
      const current = existing.find(item => item.receivableId === document.id) || {};
      const amount = Number(current.amount || 0);
      return {
        receivableId: document.id,
        customerId: document.customerId,
        customerName: document.customerName,
        customerTaxId: document.customerTaxId,
        documentNumber: document.documentNumber,
        originalBalance: document.balance,
        retentionApplied: 0,
        advanceApplied: 0,
        amount,
        resultingBalance: Number((document.balance - amount).toFixed(2)),
        receivableAccountCode: document.receivableAccountCode
      };
    });
  }

  function collectBatchDraft() {
    const form = document.querySelector("#collection-batch-form");
    const base = clone(uiState.bulk.draft || receivableService.emptyCollectionBatch());
    if (!form) return base;
    const selectedBank = form.elements.bankAccountId?.value || "";
    const bankAccount = selectedBank ? bankService.findBankAccountById(selectedBank) : null;
    base.collectionDate = form.elements.collectionDate?.value || "";
    base.collectionAccountCode = form.elements.collectionAccountCode?.value || bankAccount?.linkedAccountCode || "";
    base.bankAccountId = selectedBank;
    base.reference = form.elements.reference?.value || "";
    base.observation = form.elements.observation?.value || "";
    base.applications = Array.from(document.querySelectorAll(".compact-table-payments-detail tbody tr[data-batch-collection-id]")).map(row => {
      const current = bulkApplicationsFromVisible(uiState.bulk.draft?.applications || []).find(item => item.receivableId === row.dataset.batchCollectionId) || {};
      const selected = row.querySelector('[name="selected"]')?.checked;
      const amount = selected ? Number(row.querySelector('[name="amount"]')?.value || 0) : 0;
      return {
        ...current,
        amount,
        resultingBalance: Number((Number(current.originalBalance || 0) - amount).toFixed(2))
      };
    }).filter(item => Number(item.amount || 0) > 0 || String(item.receivableId || "").length);
    return receivableService.normalizeCollectionBatch(base);
  }

  function renderCollectionsBulk(container, route) {
    if (!uiState.bulk.draft) ensureCollectionBatchDraft();
    const draft = receivableService.normalizeCollectionBatch(uiState.bulk.draft);
    uiState.bulk.draft = draft;
    const visible = bulkApplicationsFromVisible(draft.applications || []);
    const batches = receivableService.collectionBatches();
    const accounts = collectionAccounts();
    const banks = activeBanks();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Cobros masivos</h1>
          <p>Lotes de cobro para varios documentos, con confirmacion, asiento unico y preparacion para conciliacion bancaria.</p>
        </div>
        <div class="page-header-side">
          ${statusBadge(draft.status || "BORRADOR")}
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.bulk.message ? `<section class="inline-feedback success">${esc(uiState.bulk.message)}</section>` : ""}
      ${uiState.bulk.errors.length ? `<section class="inline-feedback danger">${uiState.bulk.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid purchase-editor-layout">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">LOTE</p>
              <h3>${draft.id ? `Lote ${esc(draft.batchNumber)}` : "Nuevo lote de cobro"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-collection-batch-reset>Nuevo</button>
              <button class="secondary-button" type="button" data-collection-batch-select-all>Seleccionar visibles</button>
              <button class="secondary-button" type="button" data-collection-batch-clear>Limpiar</button>
              <button class="secondary-button" type="button" data-collection-batch-save>Guardar borrador</button>
              <button class="secondary-button" type="button" data-collection-batch-confirm>Confirmar lote</button>
            </div>
          </div>
          <form id="collection-batch-form" class="compact-form-grid">
            <label class="compact-field"><span>Numero lote</span><input name="batchNumber" value="${esc(draft.batchNumber || "")}" readonly></label>
            <label class="compact-field"><span>Fecha</span><input name="collectionDate" type="date" value="${esc(draft.collectionDate || "")}"></label>
            <label class="compact-field">
              <span>Cliente</span>
              <select id="collection-batch-customer-filter">
                <option value="">Todos</option>
                ${receivableService.customers().map(item => `<option value="${esc(item.id)}" ${uiState.bulk.customerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Estado documento</span>
              <select id="collection-batch-state-filter">
                <option value="">Todos</option>
                ${["PENDIENTE", "PARCIAL", "VENCIDO"].map(item => `<option value="${esc(item)}" ${uiState.bulk.state === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Vence hasta</span><input id="collection-batch-due-filter" type="date" value="${esc(uiState.bulk.dueUntil || "")}"></label>
            <label class="compact-field">
              <span>Cuenta de cobro</span>
              <select name="collectionAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.collectionAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Cuenta bancaria / caja</span>
              <select name="bankAccountId">
                <option value="">Sin enlace bancario</option>
                ${banks.map(item => `<option value="${esc(item.id)}" ${draft.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.bankName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Referencia general</span><input name="reference" value="${esc(draft.reference || "")}"></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          </form>
          <div class="compact-table-wrap">
            <table class="compact-table compact-table-payments-detail">
              <thead>
                <tr>
                  <th>Sel.</th>
                  <th>Cliente</th>
                  <th>Documento</th>
                  <th>Vencimiento</th>
                  <th>Saldo</th>
                  <th>Aplicar</th>
                  <th>Saldo posterior</th>
                </tr>
              </thead>
              <tbody>
                ${visible.map(item => {
                  const checked = Number(item.amount || 0) > 0;
                  const receivable = receivableService.receivables().find(row => row.id === item.receivableId);
                  return `
                    <tr data-batch-collection-id="${esc(item.receivableId)}">
                      <td><input name="selected" type="checkbox" ${checked ? "checked" : ""}></td>
                      <td>${esc(item.customerName)}</td>
                      <td><strong>${esc(item.documentNumber)}</strong><small>${esc(receivable?.issueDate || "")}</small></td>
                      <td>${esc(receivable?.dueDate || "-")}</td>
                      <td>${money(item.originalBalance)}</td>
                      <td><input name="amount" type="number" step="0.01" min="0" max="${esc(String(item.originalBalance || 0))}" value="${esc(String(item.amount || 0))}"></td>
                      <td><strong>${money(item.resultingBalance)}</strong></td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay documentos visibles para este filtro.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN</p>
              <h3>Control del lote</h3>
            </div>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Total documentos</strong><span>${esc(String(draft.totalDocuments || 0))}</span></div>
            <div class="info-row"><strong>Total a cobrar</strong><span>${money(draft.totalToCollect || 0)}</span></div>
            <div class="info-row"><strong>Estado</strong><span>${esc(draft.status || "BORRADOR")}</span></div>
            <div class="info-row"><strong>Usuario</strong><span>${esc(draft.createdBy || "")}</span></div>
            <div class="info-row"><strong>Asiento</strong><span>${esc(draft.entryNumber || "Aun no generado")}</span></div>
            <div class="info-row"><strong>Retenciones / anticipos</strong><span>Quedan preparados para fases posteriores.</span></div>
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">LOTES</p>
            <h3>Historial de cobros masivos</h3>
          </div>
          <span class="status-badge partial">${esc(String(batches.length))} lotes</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Lote</th><th>Cuenta cobro</th><th>Docs</th><th>Total</th><th>Estado</th><th>Asiento</th><th>Acciones</th></tr></thead>
            <tbody>
              ${batches.map(item => `
                <tr>
                  <td>${esc(item.collectionDate)}</td>
                  <td>${esc(item.batchNumber)}</td>
                  <td>${esc(item.collectionAccountCode || "-")}</td>
                  <td>${esc(String(item.totalDocuments || 0))}</td>
                  <td>${money(item.totalToCollect || 0)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.entryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      ${item.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-collection-batch-edit="${esc(item.id)}">Editar</button><button class="row-action-button" type="button" data-collection-batch-post-row="${esc(item.id)}">Confirmar</button>` : ""}
                      ${item.status === "CONFIRMADO" ? `<button class="row-action-button" type="button" data-collection-batch-annul="${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay lotes registrados.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindCollectionsBulk();
  }

  function collectCustomerDraft() {
    const form = document.querySelector("#customer-form");
    const base = clone(uiState.customers.draft || {});
    if (!form) return base;
    return {
      ...base,
      code: form.elements.code?.value || "",
      taxId: form.elements.taxId?.value || "",
      name: form.elements.name?.value || "",
      commercialName: form.elements.commercialName?.value || "",
      customerType: form.elements.customerType?.value || "otro",
      country: form.elements.country?.value || "",
      city: form.elements.city?.value || "",
      address: form.elements.address?.value || "",
      phone: form.elements.phone?.value || "",
      email: form.elements.email?.value || "",
      paymentCondition: form.elements.paymentCondition?.value || "Credito 30 dias",
      creditDays: Number(form.elements.creditDays?.value || 0),
      creditLimit: Number(form.elements.creditLimit?.value || 0),
      receivableAccountCode: form.elements.receivableAccountCode?.value || "",
      advanceAccountCode: form.elements.advanceAccountCode?.value || "",
      status: form.elements.status?.value || "activo",
      observation: form.elements.observation?.value || ""
    };
  }

  function collectReceivableDraft() {
    const form = document.querySelector("#receivable-form");
    const base = clone(uiState.receivables.draft || receivableService.emptyReceivable());
    if (!form) return base;
    return {
      ...base,
      customerId: form.elements.customerId?.value || "",
      documentType: form.elements.documentType?.value || "saldo inicial",
      documentNumber: form.elements.documentNumber?.value || "",
      issueDate: form.elements.issueDate?.value || "",
      dueDate: form.elements.dueDate?.value || "",
      concept: form.elements.concept?.value || "",
      total: Number(form.elements.total?.value || 0),
      receivableAccountCode: form.elements.receivableAccountCode?.value || "",
      counterAccountCode: form.elements.counterAccountCode?.value || "",
      observation: form.elements.observation?.value || ""
    };
  }

  function bindCustomers() {
    document.querySelector("#customer-search")?.addEventListener("input", event => {
      uiState.customers.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#customer-type-filter")?.addEventListener("change", event => {
      uiState.customers.type = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#customer-country-filter")?.addEventListener("input", event => {
      uiState.customers.country = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#customer-status-filter")?.addEventListener("change", event => {
      uiState.customers.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-customer-new]")?.addEventListener("click", () => {
      ensureCustomerDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-customer-cancel]")?.addEventListener("click", () => {
      uiState.customers.draft = null;
      uiState.customers.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-customer-save]")?.addEventListener("click", () => {
      const result = receivableService.saveCustomer(collectCustomerDraft());
      uiState.customers.errors = result.errors || [];
      uiState.customers.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.customers.draft = null;
      uiState.customers.message = `Cliente ${result.customer.name} guardado correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-customer-edit]").forEach(button => button.addEventListener("click", () => {
      const customer = receivableService.customers().find(item => item.id === button.dataset.customerEdit);
      if (!customer) return;
      ensureCustomerDraft(customer);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-customer-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = receivableService.toggleCustomerStatus(button.dataset.customerToggle);
      uiState.customers.message = result.ok ? "Estado del cliente actualizado." : (result.message || "");
      uiState.customers.errors = [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-customer-portfolio]").forEach(button => button.addEventListener("click", () => {
      uiState.receivables.customerId = button.dataset.customerPortfolio;
      BlessERP.state.setRoute("portfolios-ar");
      BlessERP.layout.renderApp();
    }));
  }

  function bindReceivables() {
    document.querySelector("#receivable-search")?.addEventListener("input", event => {
      uiState.receivables.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#receivable-customer-filter")?.addEventListener("change", event => {
      uiState.receivables.customerId = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#receivable-state-filter")?.addEventListener("change", event => {
      uiState.receivables.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#receivable-type-filter")?.addEventListener("change", event => {
      uiState.receivables.documentType = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-receivable-new]")?.addEventListener("click", () => {
      ensureReceivableDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-receivable-cancel]")?.addEventListener("click", () => {
      uiState.receivables.draft = null;
      uiState.receivables.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-receivable-save]")?.addEventListener("click", () => {
      const result = receivableService.saveReceivable(collectReceivableDraft());
      uiState.receivables.errors = result.errors || [];
      uiState.receivables.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureReceivableDraft(result.receivable);
      uiState.receivables.message = `Documento ${result.receivable.documentNumber} guardado en cartera.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-receivable-post]")?.addEventListener("click", () => {
      let current = collectReceivableDraft();
      if (!current.id) {
        const saved = receivableService.saveReceivable(current);
        if (!saved.ok) {
          uiState.receivables.errors = saved.errors || [];
          BlessERP.layout.renderPage();
          return;
        }
        current = saved.receivable;
      }
      const result = receivableService.postReceivable(current.id);
      uiState.receivables.errors = result.errors || [];
      uiState.receivables.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureReceivableDraft(result.receivable);
      uiState.receivables.message = `Documento contabilizado con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-receivable-edit]").forEach(button => button.addEventListener("click", () => {
      ensureReceivableDraft(receivableDraftFromDocument(button.dataset.receivableEdit));
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-receivable-post-row]").forEach(button => button.addEventListener("click", () => {
      const result = receivableService.postReceivable(button.dataset.receivablePostRow);
      uiState.receivables.message = result.ok ? `Documento contabilizado con asiento ${result.entry.entryNumber}.` : "";
      uiState.receivables.errors = result.errors || [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-receivable-annul]").forEach(button => button.addEventListener("click", () => {
      const result = receivableService.annulReceivable(button.dataset.receivableAnnul);
      uiState.receivables.message = result.ok ? "Documento anulado y reversado cuando correspondia." : (result.message || "");
      uiState.receivables.errors = [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-receivable-collect]").forEach(button => button.addEventListener("click", () => {
      ensureCollectionDraft(collectionDraftFromReceivable(button.dataset.receivableCollect));
      BlessERP.state.setRoute("portfolios-collections-single");
      BlessERP.layout.renderApp();
    }));
    document.querySelectorAll("[data-receivable-customer]").forEach(button => button.addEventListener("click", () => {
      uiState.receivables.customerId = button.dataset.receivableCustomer;
      BlessERP.layout.renderPage();
    }));
  }

  function bindCollectionsSingle() {
    document.querySelector("[data-collection-reset]")?.addEventListener("click", () => {
      ensureCollectionDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-collection-select-full]")?.addEventListener("click", () => {
      uiState.collections.draft = collectCollectionDraft();
      uiState.collections.draft.applications = collectionApplicationsFromVisible(uiState.collections.draft.applications).map(item => ({
        ...item,
        amount: item.originalBalance,
        resultingBalance: 0
      }));
      BlessERP.layout.renderPage();
    });
    document.querySelector("#collection-form")?.addEventListener("change", () => {
      uiState.collections.draft = collectCollectionDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector(".compact-table-payments-detail tbody")?.addEventListener("input", () => {
      uiState.collections.draft = collectCollectionDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector(".compact-table-payments-detail tbody")?.addEventListener("change", () => {
      uiState.collections.draft = collectCollectionDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-collection-save]")?.addEventListener("click", () => {
      const result = receivableService.saveCollection(collectCollectionDraft());
      uiState.collections.errors = result.errors || [];
      uiState.collections.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureCollectionDraft(result.collection);
      uiState.collections.message = `Cobro ${result.collection.collectionNumber} guardado en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-collection-confirm]")?.addEventListener("click", () => {
      let current = collectCollectionDraft();
      if (!current.id) {
        const saved = receivableService.saveCollection(current);
        if (!saved.ok) {
          uiState.collections.errors = saved.errors || [];
          BlessERP.layout.renderPage();
          return;
        }
        current = saved.collection;
      }
      const result = receivableService.confirmCollection(current.id);
      uiState.collections.errors = result.errors || [];
      uiState.collections.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureCollectionDraft(result.collection);
      uiState.collections.message = `Cobro confirmado con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-collection-edit]").forEach(button => button.addEventListener("click", () => {
      const collection = receivableService.collections().find(item => item.id === button.dataset.collectionEdit);
      if (!collection) return;
      ensureCollectionDraft(collection);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-collection-post-row]").forEach(button => button.addEventListener("click", () => {
      const result = receivableService.confirmCollection(button.dataset.collectionPostRow);
      uiState.collections.message = result.ok ? `Cobro confirmado con asiento ${result.entry.entryNumber}.` : "";
      uiState.collections.errors = result.errors || [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-collection-annul]").forEach(button => button.addEventListener("click", () => {
      const result = receivableService.annulCollection(button.dataset.collectionAnnul);
      uiState.collections.message = result.ok ? "Cobro anulado y reversado cuando correspondia." : (result.message || "");
      uiState.collections.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  function bindCollectionsBulk() {
    document.querySelector("[data-collection-batch-reset]")?.addEventListener("click", () => {
      ensureCollectionBatchDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-collection-batch-select-all]")?.addEventListener("click", () => {
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications).map(item => ({
        ...item,
        amount: item.originalBalance,
        resultingBalance: 0
      }));
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-collection-batch-clear]")?.addEventListener("click", () => {
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible([]).map(item => ({
        ...item,
        amount: 0,
        resultingBalance: item.originalBalance
      }));
      BlessERP.layout.renderPage();
    });
    document.querySelector("#collection-batch-customer-filter")?.addEventListener("change", event => {
      uiState.bulk.customerId = event.target.value;
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications);
      BlessERP.layout.renderPage();
    });
    document.querySelector("#collection-batch-state-filter")?.addEventListener("change", event => {
      uiState.bulk.state = event.target.value;
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications);
      BlessERP.layout.renderPage();
    });
    document.querySelector("#collection-batch-due-filter")?.addEventListener("change", event => {
      uiState.bulk.dueUntil = event.target.value;
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications);
      BlessERP.layout.renderPage();
    });
    document.querySelector("#collection-batch-form")?.addEventListener("change", () => {
      uiState.bulk.draft = collectBatchDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector(".compact-table-payments-detail tbody")?.addEventListener("input", () => {
      uiState.bulk.draft = collectBatchDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector(".compact-table-payments-detail tbody")?.addEventListener("change", () => {
      uiState.bulk.draft = collectBatchDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-collection-batch-save]")?.addEventListener("click", () => {
      const result = receivableService.saveCollectionBatch(collectBatchDraft());
      uiState.bulk.errors = result.errors || [];
      uiState.bulk.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureCollectionBatchDraft(result.batch);
      uiState.bulk.message = `Lote ${result.batch.batchNumber} guardado en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-collection-batch-confirm]")?.addEventListener("click", () => {
      let current = collectBatchDraft();
      if (!current.id) {
        const saved = receivableService.saveCollectionBatch(current);
        if (!saved.ok) {
          uiState.bulk.errors = saved.errors || [];
          BlessERP.layout.renderPage();
          return;
        }
        current = saved.batch;
      }
      const result = receivableService.confirmCollectionBatch(current.id);
      uiState.bulk.errors = result.errors || [];
      uiState.bulk.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureCollectionBatchDraft(result.batch);
      uiState.bulk.message = `Lote confirmado con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-collection-batch-edit]").forEach(button => button.addEventListener("click", () => {
      const batch = receivableService.collectionBatches().find(item => item.id === button.dataset.collectionBatchEdit);
      if (!batch) return;
      uiState.bulk.customerId = "";
      uiState.bulk.state = "";
      uiState.bulk.dueUntil = "";
      ensureCollectionBatchDraft(batch);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-collection-batch-post-row]").forEach(button => button.addEventListener("click", () => {
      const result = receivableService.confirmCollectionBatch(button.dataset.collectionBatchPostRow);
      uiState.bulk.message = result.ok ? `Lote confirmado con asiento ${result.entry.entryNumber}.` : "";
      uiState.bulk.errors = result.errors || [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-collection-batch-annul]").forEach(button => button.addEventListener("click", () => {
      const result = receivableService.annulCollectionBatch(button.dataset.collectionBatchAnnul);
      uiState.bulk.message = result.ok ? "Lote anulado y reversado cuando correspondia." : (result.message || "");
      uiState.bulk.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  function render(container, route) {
    if (route.id === "portfolios-customers") {
      renderCustomers(container, route);
      return;
    }
    if (route.id === "portfolios-ar") {
      renderReceivables(container, route);
      return;
    }
    if (route.id === "portfolios-collections-single") {
      renderCollectionsSingle(container, route);
      return;
    }
    if (route.id === "portfolios-collections-bulk") {
      renderCollectionsBulk(container, route);
    }
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Receivables = {
    render,
    ensureCollectionDraft,
    collectionDraftFromReceivable
  };
})();
