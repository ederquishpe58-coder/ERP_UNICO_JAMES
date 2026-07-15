(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const portfolioService = BlessERP.services.portfolios;
  const purchaseService = BlessERP.services.purchases;

  const uiState = {
    providers: {
      search: "",
      type: "",
      status: "",
      message: "",
      errors: [],
      draft: null
    },
    payables: {
      search: "",
      providerId: "",
      state: "",
      message: ""
    },
    payments: {
      draft: null,
      mode: "new",
      message: "",
      errors: []
    },
    bulk: {
      providerId: "",
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
        : value.includes("pagado") || value.includes("confirmado") || value.includes("activo") || value.includes("completo")
          ? "authorized"
          : "partial";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function providerRows() {
    return portfolioService.providers().filter(item => {
      const search = String(uiState.providers.search || "").toLowerCase();
      const haystack = [item.code, item.taxId, item.name, item.commercialName, item.providerType].join(" ").toLowerCase();
      return (!search || haystack.includes(search))
        && (!uiState.providers.type || item.providerType === uiState.providers.type)
        && (!uiState.providers.status || item.status === uiState.providers.status);
    });
  }

  function ensureProviderDraft(provider = null) {
    uiState.providers.draft = provider ? clone(provider) : {
      id: "",
      code: "",
      taxId: "",
      name: "",
      commercialName: "",
      providerType: "otros",
      address: "",
      phone: "",
      email: "",
      paymentCondition: "Credito 30 dias",
      creditDays: 30,
      payableAccountCode: "",
      advanceAccountCode: "",
      status: "activo",
      observation: "",
      profileState: "COMPLETO"
    };
    uiState.providers.errors = [];
    uiState.providers.message = "";
  }

  function renderProviders(container, route) {
    const providers = providerRows();
    const draft = uiState.providers.draft;
    const accounts = BlessERP.services.chartOfAccounts.movementOptions();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Proveedores</h1>
          <p>Catalogo base de proveedores, con ficha compacta y preparacion para movimientos de cartera.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Catalogo local activo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.providers.message ? `<section class="inline-feedback success">${esc(uiState.providers.message)}</section>` : ""}
      ${uiState.providers.errors.length ? `<section class="inline-feedback danger">${uiState.providers.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-portfolio-providers">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="provider-search" placeholder="Codigo, RUC, nombre o tipo" value="${esc(uiState.providers.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="provider-type-filter">
              <option value="">Todos</option>
              ${portfolioService.providerTypes.map(item => `<option value="${esc(item)}" ${uiState.providers.type === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="provider-status-filter">
              <option value="">Todos</option>
              ${portfolioService.providerStates.map(item => `<option value="${esc(item)}" ${uiState.providers.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-provider-new>Nuevo proveedor</button>
          </div>
        </div>
      </section>
      ${draft ? `
        <article class="panel-card editor-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">FICHA</p>
              <h3>${draft.id ? "Editar proveedor" : "Nuevo proveedor"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-provider-cancel>Cancelar</button>
              <button class="secondary-button" type="button" data-provider-save>Guardar proveedor</button>
            </div>
          </div>
          <form id="provider-form" class="compact-form-grid">
            <label class="compact-field"><span>Codigo proveedor</span><input name="code" value="${esc(draft.code || "")}"></label>
            <label class="compact-field"><span>RUC / CI</span><input name="taxId" value="${esc(draft.taxId || "")}"></label>
            <label class="compact-field"><span>Razon social / nombre</span><input name="name" value="${esc(draft.name || "")}"></label>
            <label class="compact-field"><span>Nombre comercial</span><input name="commercialName" value="${esc(draft.commercialName || "")}"></label>
            <label class="compact-field">
              <span>Tipo proveedor</span>
              <select name="providerType">
                ${portfolioService.providerTypes.map(item => `<option value="${esc(item)}" ${draft.providerType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Telefono</span><input name="phone" value="${esc(draft.phone || "")}"></label>
            <label class="compact-field"><span>Correo</span><input name="email" value="${esc(draft.email || "")}"></label>
            <label class="compact-field">
              <span>Condicion de pago</span>
              <select name="paymentCondition">
                ${portfolioService.paymentConditions.map(item => `<option value="${esc(item)}" ${draft.paymentCondition === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Dias de credito</span><input name="creditDays" type="number" min="0" step="1" value="${esc(String(draft.creditDays || 0))}"></label>
            <label class="compact-field">
              <span>Cuenta por pagar asociada</span>
              <select name="payableAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.payableAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
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
                ${portfolioService.providerStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
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
            <h3>Proveedores</h3>
          </div>
          <span class="status-badge partial">${esc(String(providers.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-providers">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>RUC / CI</th>
                <th>Razon social</th>
                <th>Nombre comercial</th>
                <th>Tipo</th>
                <th>Direccion</th>
                <th>Telefono</th>
                <th>Correo</th>
                <th>Condicion</th>
                <th>Dias</th>
                <th>CxP</th>
                <th>Anticipo</th>
                <th>Estado</th>
                <th>Ficha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${providers.map(item => `
                <tr>
                  <td><strong>${esc(item.code || "-")}</strong></td>
                  <td>${esc(item.taxId)}</td>
                  <td>${esc(item.name)}</td>
                  <td>${esc(item.commercialName || "-")}</td>
                  <td>${esc(item.providerType)}</td>
                  <td>${esc(item.address || "-")}</td>
                  <td>${esc(item.phone || "-")}</td>
                  <td>${esc(item.email || "-")}</td>
                  <td>${esc(item.paymentCondition || "-")}</td>
                  <td>${esc(String(item.creditDays || 0))}</td>
                  <td>${esc(item.payableAccountCode || "-")}</td>
                  <td>${esc(item.advanceAccountCode || "-")}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${statusBadge(item.profileState || "COMPLETO")}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-provider-edit="${esc(item.id)}">Editar</button>
                      <button class="row-action-button" type="button" data-provider-toggle="${esc(item.id)}">${item.status === "activo" ? "Inactivar" : "Activar"}</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="15"><div class="empty-inline">No hay proveedores para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindProviders();
  }

  function payableRows() {
    return portfolioService.payables({
      search: uiState.payables.search,
      providerId: uiState.payables.providerId,
      state: uiState.payables.state
    });
  }

  function renderPayables(container, route) {
    const rows = payableRows();
    const providerSummary = uiState.payables.providerId ? portfolioService.providerPortfolioSummary(uiState.payables.providerId) : null;
    const summary = {
      totalPending: rows.filter(item => ["PENDIENTE", "PARCIAL", "VENCIDO"].includes(item.state)).reduce((sum, item) => sum + item.balance, 0),
      totalOverdue: rows.filter(item => item.state === "VENCIDO").reduce((sum, item) => sum + item.balance, 0),
      totalPaid: rows.reduce((sum, item) => sum + item.paid, 0),
      docsOpen: rows.filter(item => !["PAGADO", "ANULADO"].includes(item.state)).length
    };
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Cuentas por pagar</h1>
          <p>Documentos abiertos generados desde compras contabilizadas, con saldo derivado por retenciones y pagos confirmados.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Saldos derivados</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.payables.message ? `<section class="inline-feedback success">${esc(uiState.payables.message)}</section>` : ""}
      <section class="summary-grid summary-grid-payables">
        <article class="summary-card"><span>Total pendiente</span><strong>${money(summary.totalPending)}</strong><small>Documentos abiertos</small></article>
        <article class="summary-card"><span>Total vencido</span><strong>${money(summary.totalOverdue)}</strong><small>Solo documentos vencidos</small></article>
        <article class="summary-card"><span>Total pagado</span><strong>${money(summary.totalPaid)}</strong><small>Aplicado localmente</small></article>
        <article class="summary-card"><span>Documentos abiertos</span><strong>${esc(String(summary.docsOpen))}</strong><small>Cartera vigente</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-payables">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="payable-search" placeholder="Proveedor, documento o asiento" value="${esc(uiState.payables.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Proveedor</span>
            <select id="payable-provider-filter">
              <option value="">Todos</option>
              ${portfolioService.providers().map(item => `<option value="${esc(item.id)}" ${uiState.payables.providerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="payable-state-filter">
              <option value="">Todos</option>
              ${portfolioService.payableStates.map(item => `<option value="${esc(item)}" ${uiState.payables.state === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-route-link="portfolios-payments-single">Nuevo pago</button>
            <button class="secondary-button" type="button" data-route-link="portfolios-payments-bulk">Pago masivo</button>
          </div>
        </div>
      </section>
      ${providerSummary ? `
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN PROVEEDOR</p>
              <h3>${esc(providerSummary.provider.name)}</h3>
            </div>
            ${statusBadge(providerSummary.provider.status)}
          </div>
          <div class="info-stack info-grid-two">
            <div class="info-row"><strong>Total pendiente</strong><span>${money(providerSummary.totalPending)}</span></div>
            <div class="info-row"><strong>Total vencido</strong><span>${money(providerSummary.totalOverdue)}</span></div>
            <div class="info-row"><strong>Total por vencer</strong><span>${money(providerSummary.totalUpcoming)}</span></div>
            <div class="info-row"><strong>Total pagado periodo</strong><span>${money(providerSummary.totalPaidPeriod)}</span></div>
            <div class="info-row"><strong>Retenciones pendientes</strong><span>${money(providerSummary.pendingWithholdings)}</span></div>
            <div class="info-row"><strong>Anticipos disponibles</strong><span>${money(providerSummary.availableAdvances)}</span></div>
            <div class="info-row"><strong>Ultimo pago</strong><span>${esc(providerSummary.latestPayment?.paymentNumber || providerSummary.latestPayment?.batchNumber || "No registrado")}</span></div>
            <div class="info-row"><strong>Documentos abiertos</strong><span>${esc(String(providerSummary.openDocuments))}</span></div>
          </div>
        </article>
      ` : ""}
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">DOCUMENTOS</p>
            <h3>Cartera por pagar</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} documentos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-payables">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>RUC</th>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Fecha emision</th>
                <th>Fecha contab.</th>
                <th>Vencimiento</th>
                <th>Total</th>
                <th>Retenciones</th>
                <th>Anticipos</th>
                <th>Pagado</th>
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
                  <td><strong>${esc(item.providerName)}</strong><small>${esc(item.providerCode || "")}</small></td>
                  <td>${esc(item.providerRuc)}</td>
                  <td>${esc(item.documentNumber)}</td>
                  <td>${esc(purchaseService.voucherLabel(item.voucherType))}</td>
                  <td>${esc(item.issueDate)}</td>
                  <td>${esc(item.accountingDate)}</td>
                  <td>${esc(item.dueDate || "-")}</td>
                  <td>${money(item.totalDocument)}</td>
                  <td>${money(item.retentionApplied)}</td>
                  <td>${money(item.advanceApplied)}</td>
                  <td>${money(item.paid)}</td>
                  <td><strong>${money(item.balance)}</strong></td>
                  <td>${statusBadge(item.state)}</td>
                  <td>${esc(item.originEntryNumber || "-")}</td>
                  <td>${esc(String(item.overdueDays || 0))}</td>
                  <td>
                    <div class="row-actions">
                      ${!["PAGADO", "ANULADO"].includes(item.state) ? `<button class="row-action-button" type="button" data-payable-pay="${esc(item.id)}">Pagar</button>` : ""}
                      <button class="row-action-button" type="button" data-payable-provider="${esc(item.providerId)}">Proveedor</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="16"><div class="empty-inline">No hay cuentas por pagar para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindPayables();
  }

  function paymentDraftFromPayable(payableId = "") {
    const draft = portfolioService.emptyPayment();
    if (!payableId) return draft;
    const payable = portfolioService.payables().find(item => item.id === payableId);
    if (!payable) return draft;
    draft.providerId = payable.providerId;
    draft.providerName = payable.providerName;
    draft.providerRuc = payable.providerRuc;
    draft.applications = [{
      payableId: payable.id,
      purchaseId: payable.purchaseId,
      documentNumber: payable.documentNumber,
      supplierName: payable.providerName,
      supplierRuc: payable.providerRuc,
      providerId: payable.providerId,
      originalBalance: payable.balance,
      withholdingApplied: payable.retentionApplied,
      advanceApplied: payable.advanceApplied,
      amount: payable.balance,
      resultingBalance: 0
    }];
    return portfolioService.normalizePayment(draft);
  }

  function ensurePaymentDraft(payment = null) {
    uiState.payments.errors = [];
    uiState.payments.message = "";
    uiState.payments.mode = payment?.id ? "edit" : "new";
    uiState.payments.draft = payment ? portfolioService.normalizePayment(payment) : portfolioService.emptyPayment();
  }

  function applicationsForProvider(providerId, existing = []) {
    return portfolioService.pendingPayablesByProvider(providerId).map(item => {
      const found = (existing || []).find(app => app.payableId === item.id);
      return {
        payableId: item.id,
        purchaseId: item.purchaseId,
        documentNumber: item.documentNumber,
        supplierName: item.providerName,
        supplierRuc: item.providerRuc,
        providerId: item.providerId,
        originalBalance: item.balance,
        withholdingApplied: item.retentionApplied,
        advanceApplied: found?.advanceApplied || 0,
        amount: found?.amount || 0,
        resultingBalance: found ? found.resultingBalance : item.balance
      };
    });
  }

  function renderPaymentsSingle(container, route) {
    if (!uiState.payments.draft) ensurePaymentDraft();
    const draft = uiState.payments.draft;
    const accounts = portfolioService.activePaymentAccountOptions();
    const provider = draft.providerId ? portfolioService.findProviderById(draft.providerId) : null;
    const history = portfolioService.payments().filter(item => item.providerId === draft.providerId);
    const total = draft.applications.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Pagos individuales</h1>
          <p>Pago parcial o total de documentos abiertos por proveedor, con asiento automático hacia Diario.</p>
        </div>
        <div class="page-header-side">
          ${statusBadge(draft.status || "BORRADOR")}
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.payments.message ? `<section class="inline-feedback success">${esc(uiState.payments.message)}</section>` : ""}
      ${uiState.payments.errors.length ? `<section class="inline-feedback danger">${uiState.payments.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid purchase-editor-layout">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CABECERA</p>
              <h3>${draft.id ? `Pago ${esc(draft.paymentNumber)}` : "Nuevo pago individual"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-payment-reset>Nuevo</button>
              <button class="secondary-button" type="button" data-payment-save>Borrador</button>
              <button class="secondary-button" type="button" data-payment-confirm>Confirmar pago</button>
            </div>
          </div>
          <form id="payment-form" class="compact-form-grid">
            <label class="compact-field"><span>Numero pago</span><input name="paymentNumber" value="${esc(draft.paymentNumber || "")}" readonly></label>
            <label class="compact-field"><span>Fecha de pago</span><input name="paymentDate" type="date" value="${esc(draft.paymentDate || "")}"></label>
            <label class="compact-field">
              <span>Proveedor</span>
              <select name="providerId">
                <option value="">Seleccionar proveedor</option>
                ${portfolioService.providers().map(item => `<option value="${esc(item.id)}" ${draft.providerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Medio de pago</span>
              <select name="paymentMethod">
                ${portfolioService.paymentMethods.map(item => `<option value="${esc(item)}" ${draft.paymentMethod === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Cuenta contable de pago</span>
              <select name="paymentAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.paymentAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Referencia / comprobante</span><input name="reference" value="${esc(draft.reference || "")}"></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          </form>
          ${provider ? `<div class="helper-pill">Proveedor: ${esc(provider.name)} · Condicion ${esc(provider.paymentCondition)} · Dias de credito ${esc(String(provider.creditDays || 0))}</div>` : ""}
          <div class="journal-lines-head">
            <div>
              <p class="section-kicker">DETALLE</p>
              <h3>Documentos pendientes del proveedor</h3>
            </div>
            <button class="secondary-button" type="button" data-payment-fill>Saldo completo</button>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table compact-table-payments-detail">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Saldo documento</th>
                  <th>Valor a pagar</th>
                  <th>Retencion aplicada</th>
                  <th>Anticipo aplicado</th>
                  <th>Saldo posterior</th>
                </tr>
              </thead>
              <tbody>
                ${(draft.applications || []).map(app => `
                  <tr data-application-id="${esc(app.payableId)}">
                    <td><strong>${esc(app.documentNumber)}</strong><small>${esc(app.supplierName || "")}</small></td>
                    <td>${money(app.originalBalance)}</td>
                    <td><input name="amount" type="number" step="0.01" min="0" max="${esc(String(app.originalBalance || 0))}" value="${esc(String(app.amount || 0))}"></td>
                    <td>${money(app.withholdingApplied || 0)}</td>
                    <td><input name="advanceApplied" type="number" step="0.01" min="0" value="${esc(String(app.advanceApplied || 0))}" readonly></td>
                    <td><strong>${money(app.resultingBalance)}</strong></td>
                  </tr>
                `).join("") || `<tr><td colspan="6"><div class="empty-inline">Seleccione un proveedor para cargar sus documentos pendientes.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN</p>
              <h3>Aplicacion del pago</h3>
            </div>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Total a pagar</strong><span id="payment-total">${money(total)}</span></div>
            <div class="info-row"><strong>Estado</strong><span>${esc(draft.status || "BORRADOR")}</span></div>
            <div class="info-row"><strong>Cuenta de pago</strong><span>${esc(draft.paymentAccountCode || "Pendiente")}</span></div>
            <div class="info-row"><strong>Asiento</strong><span>${esc(draft.entryNumber || "Aun no generado")}</span></div>
            <div class="info-row"><strong>Anticipos</strong><span>Anticipos a proveedores se implementara en una fase posterior.</span></div>
          </div>
          <p class="panel-note">El pago confirmado genera asiento <code>Dr Cuentas por pagar / Cr Cuenta de pago</code>. No se permite exceder el saldo del documento.</p>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Pagos individuales registrados</h3>
          </div>
          <span class="status-badge partial">${esc(String(history.length))} registros</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Numero</th><th>Proveedor</th><th>Medio</th><th>Total</th><th>Estado</th><th>Asiento</th><th>Acciones</th></tr></thead>
            <tbody>
              ${history.map(item => `
                <tr>
                  <td>${esc(item.paymentDate)}</td>
                  <td>${esc(item.paymentNumber)}</td>
                  <td>${esc(item.providerName)}</td>
                  <td>${esc(item.paymentMethod)}</td>
                  <td>${money(item.total)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.entryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      ${item.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-payment-edit="${esc(item.id)}">Editar</button><button class="row-action-button" type="button" data-payment-post-row="${esc(item.id)}">Confirmar</button>` : ""}
                      ${item.status === "CONFIRMADO" ? `<button class="row-action-button" type="button" data-payment-annul="${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay pagos individuales registrados.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindPaymentsSingle();
  }

  function collectPaymentDraft() {
    const form = document.querySelector("#payment-form");
    const base = clone(uiState.payments.draft || portfolioService.emptyPayment());
    if (!form) return base;
    base.paymentDate = form.elements.paymentDate?.value || "";
    base.providerId = form.elements.providerId?.value || "";
    base.paymentMethod = form.elements.paymentMethod?.value || "";
    base.paymentAccountCode = form.elements.paymentAccountCode?.value || "";
    base.reference = form.elements.reference?.value || "";
    base.observation = form.elements.observation?.value || "";
    base.applications = Array.from(document.querySelectorAll(".compact-table-payments-detail tbody tr[data-application-id]")).map(row => {
      const current = (uiState.payments.draft?.applications || []).find(item => item.payableId === row.dataset.applicationId) || {};
      const amount = Number(row.querySelector('[name="amount"]')?.value || 0);
      const advanceApplied = Number(row.querySelector('[name="advanceApplied"]')?.value || 0);
      return {
        ...current,
        amount,
        advanceApplied,
        resultingBalance: Number((Number(current.originalBalance || 0) - amount - advanceApplied).toFixed(2))
      };
    });
    return portfolioService.normalizePayment(base);
  }

  function renderPaymentTotals() {
    uiState.payments.draft = collectPaymentDraft();
    const total = uiState.payments.draft.applications.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    document.querySelector("#payment-total")?.replaceChildren(document.createTextNode(money(total)));
  }

  function ensureApplicationsForSelectedProvider() {
    const providerId = uiState.payments.draft?.providerId || "";
    if (!providerId) {
      uiState.payments.draft.applications = [];
      return;
    }
    uiState.payments.draft.applications = applicationsForProvider(providerId, uiState.payments.draft.applications);
  }

  function bindPaymentsSingle() {
    document.querySelector("[data-payment-reset]")?.addEventListener("click", () => {
      ensurePaymentDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("#payment-form")?.addEventListener("change", event => {
      uiState.payments.draft = collectPaymentDraft();
      if (event.target.name === "providerId") {
        ensureApplicationsForSelectedProvider();
        BlessERP.layout.renderPage();
        return;
      }
      renderPaymentTotals();
    });
    document.querySelector(".compact-table-payments-detail tbody")?.addEventListener("input", renderPaymentTotals);
    document.querySelector("[data-payment-fill]")?.addEventListener("click", () => {
      uiState.payments.draft = collectPaymentDraft();
      uiState.payments.draft.applications = uiState.payments.draft.applications.map(item => ({
        ...item,
        amount: item.originalBalance,
        resultingBalance: 0
      }));
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-payment-save]")?.addEventListener("click", () => {
      const result = portfolioService.savePayment(collectPaymentDraft());
      uiState.payments.errors = result.errors || [];
      uiState.payments.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensurePaymentDraft(result.payment);
      uiState.payments.message = `Pago ${result.payment.paymentNumber} guardado en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-payment-confirm]")?.addEventListener("click", () => {
      let current = collectPaymentDraft();
      if (!current.id) {
        const saved = portfolioService.savePayment(current);
        if (!saved.ok) {
          uiState.payments.errors = saved.errors || [];
          BlessERP.layout.renderPage();
          return;
        }
        current = saved.payment;
      }
      const result = portfolioService.confirmPayment(current.id);
      uiState.payments.errors = result.errors || [];
      uiState.payments.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensurePaymentDraft(result.payment);
      uiState.payments.message = `Pago confirmado con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-payment-edit]").forEach(button => button.addEventListener("click", () => {
      const payment = portfolioService.payments().find(item => item.id === button.dataset.paymentEdit);
      if (!payment) return;
      ensurePaymentDraft(payment);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-payment-post-row]").forEach(button => button.addEventListener("click", () => {
      const result = portfolioService.confirmPayment(button.dataset.paymentPostRow);
      uiState.payments.message = result.ok ? `Pago confirmado con asiento ${result.entry.entryNumber}.` : "";
      uiState.payments.errors = result.errors || [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-payment-annul]").forEach(button => button.addEventListener("click", () => {
      const result = portfolioService.annulPayment(button.dataset.paymentAnnul);
      uiState.payments.message = result.ok ? "Pago anulado y reversado cuando correspondia." : (result.message || "");
      uiState.payments.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  function ensureBatchDraft(batch = null) {
    uiState.bulk.errors = [];
    uiState.bulk.message = "";
    uiState.bulk.draft = batch ? portfolioService.normalizeBatch(batch) : portfolioService.emptyBatch();
  }

  function filteredBulkPayables() {
    return portfolioService.payables({
      providerId: uiState.bulk.providerId,
      state: uiState.bulk.state
    }).filter(item => {
      if (uiState.bulk.dueUntil && item.dueDate && item.dueDate > uiState.bulk.dueUntil) return false;
      return !["PAGADO", "ANULADO"].includes(item.state);
    });
  }

  function bulkApplicationsFromVisible(existing = []) {
    return filteredBulkPayables().map(item => {
      const found = existing.find(app => app.payableId === item.id);
      return {
        payableId: item.id,
        purchaseId: item.purchaseId,
        providerId: item.providerId,
        supplierName: item.providerName,
        supplierRuc: item.providerRuc,
        documentNumber: item.documentNumber,
        originalBalance: item.balance,
        withholdingApplied: item.retentionApplied,
        advanceApplied: found?.advanceApplied || 0,
        amount: found?.amount || 0,
        resultingBalance: found ? found.resultingBalance : item.balance
      };
    });
  }

  function renderPaymentsBulk(container, route) {
    if (!uiState.bulk.draft) ensureBatchDraft();
    const draft = uiState.bulk.draft;
    const visible = bulkApplicationsFromVisible(draft.applications || []);
    const batches = portfolioService.paymentBatches();
    const accounts = portfolioService.activePaymentAccountOptions();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Pagos masivos</h1>
          <p>Lotes de pago por varios documentos, con confirmacion y asiento unico de salida.</p>
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
              <h3>${draft.id ? `Lote ${esc(draft.batchNumber)}` : "Nuevo lote de pago"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-batch-reset>Nuevo</button>
              <button class="secondary-button" type="button" data-batch-select-all>Seleccionar visibles</button>
              <button class="secondary-button" type="button" data-batch-clear>Limpiar</button>
              <button class="secondary-button" type="button" data-batch-save>Guardar borrador</button>
              <button class="secondary-button" type="button" data-batch-confirm>Confirmar lote</button>
            </div>
          </div>
          <form id="batch-form" class="compact-form-grid">
            <label class="compact-field"><span>Numero lote</span><input name="batchNumber" value="${esc(draft.batchNumber || "")}" readonly></label>
            <label class="compact-field"><span>Fecha</span><input name="paymentDate" type="date" value="${esc(draft.paymentDate || "")}"></label>
            <label class="compact-field">
              <span>Proveedor</span>
              <select id="bulk-provider-filter" name="providerId">
                <option value="">Todos</option>
                ${portfolioService.providers().map(item => `<option value="${esc(item.id)}" ${uiState.bulk.providerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Estado documento</span>
              <select id="bulk-state-filter" name="state">
                <option value="">Todos</option>
                ${["PENDIENTE", "PARCIAL", "VENCIDO"].map(item => `<option value="${esc(item)}" ${uiState.bulk.state === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Vence hasta</span><input id="bulk-due-filter" type="date" value="${esc(uiState.bulk.dueUntil || "")}"></label>
            <label class="compact-field">
              <span>Cuenta de pago</span>
              <select name="paymentAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.code)}" ${draft.paymentAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
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
                  <th>Proveedor</th>
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
                  const payable = portfolioService.payables().find(row => row.id === item.payableId);
                  return `
                    <tr data-batch-application-id="${esc(item.payableId)}">
                      <td><input name="selected" type="checkbox" ${checked ? "checked" : ""}></td>
                      <td>${esc(item.supplierName)}</td>
                      <td><strong>${esc(item.documentNumber)}</strong><small>${esc(payable?.issueDate || "")}</small></td>
                      <td>${esc(payable?.dueDate || "-")}</td>
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
            <div class="info-row"><strong>Total documentos</strong><span id="batch-total-docs">${esc(String(draft.totalDocuments || 0))}</span></div>
            <div class="info-row"><strong>Total a pagar</strong><span id="batch-total-pay">${money(draft.totalToPay || 0)}</span></div>
            <div class="info-row"><strong>Estado</strong><span>${esc(draft.status || "BORRADOR")}</span></div>
            <div class="info-row"><strong>Usuario</strong><span>${esc(draft.createdBy || "")}</span></div>
            <div class="info-row"><strong>Asiento</strong><span>${esc(draft.entryNumber || "Aun no generado")}</span></div>
            <div class="info-row"><strong>Anticipos</strong><span>Anticipos a proveedores se implementara en una fase posterior.</span></div>
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">LOTES</p>
            <h3>Historial de pagos masivos</h3>
          </div>
          <span class="status-badge partial">${esc(String(batches.length))} lotes</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Lote</th><th>Cuenta pago</th><th>Docs</th><th>Total</th><th>Estado</th><th>Asiento</th><th>Acciones</th></tr></thead>
            <tbody>
              ${batches.map(item => `
                <tr>
                  <td>${esc(item.paymentDate)}</td>
                  <td>${esc(item.batchNumber)}</td>
                  <td>${esc(item.paymentAccountCode || "-")}</td>
                  <td>${esc(String(item.totalDocuments || 0))}</td>
                  <td>${money(item.totalToPay || 0)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.entryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      ${item.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-batch-edit="${esc(item.id)}">Editar</button><button class="row-action-button" type="button" data-batch-post-row="${esc(item.id)}">Confirmar</button>` : ""}
                      ${item.status === "CONFIRMADO" ? `<button class="row-action-button" type="button" data-batch-annul="${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay lotes registrados.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindPaymentsBulk();
  }

  function collectBatchDraft() {
    const form = document.querySelector("#batch-form");
    const base = clone(uiState.bulk.draft || portfolioService.emptyBatch());
    if (!form) return base;
    base.paymentDate = form.elements.paymentDate?.value || "";
    base.paymentAccountCode = form.elements.paymentAccountCode?.value || "";
    base.reference = form.elements.reference?.value || "";
    base.observation = form.elements.observation?.value || "";
    base.applications = Array.from(document.querySelectorAll(".compact-table-payments-detail tbody tr[data-batch-application-id]")).map(row => {
      const current = (bulkApplicationsFromVisible(uiState.bulk.draft?.applications || [])).find(item => item.payableId === row.dataset.batchApplicationId) || {};
      const selected = row.querySelector('[name="selected"]')?.checked;
      const amount = selected ? Number(row.querySelector('[name="amount"]')?.value || 0) : 0;
      return {
        ...current,
        amount,
        resultingBalance: Number((Number(current.originalBalance || 0) - amount).toFixed(2))
      };
    }).filter(item => Number(item.amount || 0) > 0 || String(item.payableId || "").length);
    return portfolioService.normalizeBatch(base);
  }

  function bindPaymentsBulk() {
    document.querySelector("[data-batch-reset]")?.addEventListener("click", () => {
      ensureBatchDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-batch-select-all]")?.addEventListener("click", () => {
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications).map(item => ({
        ...item,
        amount: item.originalBalance,
        resultingBalance: 0
      }));
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-batch-clear]")?.addEventListener("click", () => {
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible([]).map(item => ({
        ...item,
        amount: 0,
        resultingBalance: item.originalBalance
      }));
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bulk-provider-filter")?.addEventListener("change", event => {
      uiState.bulk.providerId = event.target.value;
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications);
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bulk-state-filter")?.addEventListener("change", event => {
      uiState.bulk.state = event.target.value;
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications);
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bulk-due-filter")?.addEventListener("change", event => {
      uiState.bulk.dueUntil = event.target.value;
      uiState.bulk.draft = collectBatchDraft();
      uiState.bulk.draft.applications = bulkApplicationsFromVisible(uiState.bulk.draft.applications);
      BlessERP.layout.renderPage();
    });
    document.querySelector("#batch-form")?.addEventListener("change", () => {
      uiState.bulk.draft = collectBatchDraft();
    });
    document.querySelector(".compact-table-payments-detail tbody")?.addEventListener("input", () => {
      uiState.bulk.draft = collectBatchDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector(".compact-table-payments-detail tbody")?.addEventListener("change", () => {
      uiState.bulk.draft = collectBatchDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-batch-save]")?.addEventListener("click", () => {
      const result = portfolioService.saveBatch(collectBatchDraft());
      uiState.bulk.errors = result.errors || [];
      uiState.bulk.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureBatchDraft(result.batch);
      uiState.bulk.message = `Lote ${result.batch.batchNumber} guardado en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-batch-confirm]")?.addEventListener("click", () => {
      let current = collectBatchDraft();
      if (!current.id) {
        const saved = portfolioService.saveBatch(current);
        if (!saved.ok) {
          uiState.bulk.errors = saved.errors || [];
          BlessERP.layout.renderPage();
          return;
        }
        current = saved.batch;
      }
      const result = portfolioService.confirmBatch(current.id);
      uiState.bulk.errors = result.errors || [];
      uiState.bulk.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureBatchDraft(result.batch);
      uiState.bulk.message = `Lote confirmado con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-batch-edit]").forEach(button => button.addEventListener("click", () => {
      const batch = portfolioService.paymentBatches().find(item => item.id === button.dataset.batchEdit);
      if (!batch) return;
      uiState.bulk.providerId = "";
      uiState.bulk.state = "";
      uiState.bulk.dueUntil = "";
      ensureBatchDraft(batch);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-batch-post-row]").forEach(button => button.addEventListener("click", () => {
      const result = portfolioService.confirmBatch(button.dataset.batchPostRow);
      uiState.bulk.message = result.ok ? `Lote confirmado con asiento ${result.entry.entryNumber}.` : "";
      uiState.bulk.errors = result.errors || [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-batch-annul]").forEach(button => button.addEventListener("click", () => {
      const result = portfolioService.annulBatch(button.dataset.batchAnnul);
      uiState.bulk.message = result.ok ? "Lote anulado y reversado cuando correspondia." : (result.message || "");
      uiState.bulk.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  function collectProviderDraft() {
    const form = document.querySelector("#provider-form");
    const base = clone(uiState.providers.draft || {});
    if (!form) return base;
    return {
      ...base,
      code: form.elements.code?.value || "",
      taxId: form.elements.taxId?.value || "",
      name: form.elements.name?.value || "",
      commercialName: form.elements.commercialName?.value || "",
      providerType: form.elements.providerType?.value || "otros",
      address: form.elements.address?.value || "",
      phone: form.elements.phone?.value || "",
      email: form.elements.email?.value || "",
      paymentCondition: form.elements.paymentCondition?.value || "Credito 30 dias",
      creditDays: Number(form.elements.creditDays?.value || 0),
      payableAccountCode: form.elements.payableAccountCode?.value || "",
      advanceAccountCode: form.elements.advanceAccountCode?.value || "",
      status: form.elements.status?.value || "activo",
      observation: form.elements.observation?.value || ""
    };
  }

  function bindProviders() {
    document.querySelector("#provider-search")?.addEventListener("input", event => {
      uiState.providers.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#provider-type-filter")?.addEventListener("change", event => {
      uiState.providers.type = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#provider-status-filter")?.addEventListener("change", event => {
      uiState.providers.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-provider-new]")?.addEventListener("click", () => {
      ensureProviderDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-provider-cancel]")?.addEventListener("click", () => {
      uiState.providers.draft = null;
      uiState.providers.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-provider-save]")?.addEventListener("click", () => {
      const result = portfolioService.saveProvider(collectProviderDraft());
      uiState.providers.errors = result.errors || [];
      uiState.providers.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.providers.draft = null;
      uiState.providers.message = `Proveedor ${result.provider.name} guardado correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-provider-edit]").forEach(button => button.addEventListener("click", () => {
      const provider = portfolioService.providers().find(item => item.id === button.dataset.providerEdit);
      if (!provider) return;
      ensureProviderDraft(provider);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-provider-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = portfolioService.toggleProviderStatus(button.dataset.providerToggle);
      uiState.providers.message = result.ok ? "Estado del proveedor actualizado." : (result.message || "");
      uiState.providers.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  function bindPayables() {
    document.querySelector("#payable-search")?.addEventListener("input", event => {
      uiState.payables.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#payable-provider-filter")?.addEventListener("change", event => {
      uiState.payables.providerId = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#payable-state-filter")?.addEventListener("change", event => {
      uiState.payables.state = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-payable-provider]").forEach(button => button.addEventListener("click", () => {
      uiState.payables.providerId = button.dataset.payableProvider;
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-payable-pay]").forEach(button => button.addEventListener("click", () => {
      ensurePaymentDraft(paymentDraftFromPayable(button.dataset.payablePay));
      BlessERP.state.setRoute("portfolios-payments-single");
      BlessERP.layout.renderApp();
    }));
  }

  function render(container, route) {
    if (route.id === "portfolios-suppliers") {
      renderProviders(container, route);
      return;
    }
    if (route.id === "portfolios-ap") {
      renderPayables(container, route);
      return;
    }
    if (route.id === "portfolios-payments-single") {
      renderPaymentsSingle(container, route);
      return;
    }
    if (route.id === "portfolios-payments-bulk") {
      renderPaymentsBulk(container, route);
    }
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Portfolios = {
    render,
    ensurePaymentDraft,
    paymentDraftFromPayable
  };
})();
