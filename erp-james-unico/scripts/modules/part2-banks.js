(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const bankService = BlessERP.services.banks;
  const chartService = BlessERP.services.chartOfAccounts;
  const reconciliationService = BlessERP.services.bankReconciliation;
  const companyService = BlessERP.services.companySettings;
  const treasuryReadService = () => BlessERP.services?.treasuryReadV2;

  const uiState = {
    accounts: {
      search: "",
      type: "",
      status: "",
      draft: null,
      message: "",
      errors: [],
      warnings: []
    },
    movements: {
      search: "",
      bankAccountId: "",
      status: "",
      originModule: "",
      dateFrom: "",
      dateTo: "",
      type: "",
      pageSize: 25,
      draft: null,
      message: "",
      errors: []
    },
    reconciliation: {
      viewMode: "history",
      currentId: "",
      draft: null,
      statementDraft: null,
      selectedSystemIds: [],
      selectedStatementIds: [],
      message: "",
      errors: [],
      actionNote: "",
      reopenReason: "",
      historyFilters: { dateFrom: "", dateTo: "", bankAccountId: "", status: "", reference: "", search: "" },
      historyPageSize: 25
    },
    treasury: {
      message: "",
      errors: [],
      cashDraft: null,
      transferDraft: null,
      transferViewMode: "form",
      transferHistoryFilters: { dateFrom: "", dateTo: "", source: "", destination: "", status: "", reference: "", search: "" },
      transferHistoryPageSize: 25
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
    const css = value.includes("anulado") || value.includes("inactiva") || value.includes("observado")
      ? "cancelled"
      : value.includes("borrador") || value.includes("pendiente") || value.includes("revision")
        ? "pending"
        : value.includes("contabilizado") || value.includes("activa") || value.includes("cerrada") || value.includes("conciliado")
          ? "authorized"
          : "partial";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function suggestionBadge(status) {
    const label = status === "MATCH_EXACTO"
      ? "Match exacto"
      : status === "MATCH_POSIBLE"
        ? "Match posible"
        : "Sin coincidencia";
    const css = status === "MATCH_EXACTO"
      ? "authorized"
      : status === "MATCH_POSIBLE"
        ? "partial"
        : "pending";
    return `<span class="status-badge ${css}">${esc(label)}</span>`;
  }

  function firstActiveBankAccountId() {
    const active = bankService.bankAccounts().filter(item => item.status === "activa");
    return active.find(item => item.isCanonical)?.id || active[0]?.id || "";
  }

  function reconciliationAccountResolution(accountId = uiState.reconciliation.draft?.bankAccountId || "") {
    return bankService.resolveCanonicalBankAccount(accountId);
  }

  function reconciliationAccountLabel(account) {
    const suffix = account.isCanonical ? "Confirmada V2" : "Pendiente de confirmar";
    return `${account.code} · ${account.bankName} · ${suffix}`;
  }

  function periodRange(period) {
    if (!/^\d{4}-\d{2}$/.test(String(period || ""))) {
      const settings = companyService.settings();
      return {
        period: settings.activePeriod || "",
        dateFrom: settings.periodStart || BlessERP.utils.today(),
        dateTo: settings.periodEnd || BlessERP.utils.today()
      };
    }
    const [year, month] = String(period).split("-").map(Number);
    const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(year, month, 0);
    const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return { period: `${year}-${String(month).padStart(2, "0")}`, dateFrom, dateTo };
  }

  function ensureAccountDraft(account = null) {
    uiState.accounts.draft = account ? clone(account) : {
      id: "",
      code: "",
      bankName: "",
      accountNumber: "",
      accountType: "corriente",
      holder: "",
      currency: "USD",
      linkedAccountCode: "",
      openingBalance: 0,
      openingBalanceDate: companyService.settings().periodStart || BlessERP.utils.today(),
      status: "activa",
      observation: ""
    };
    uiState.accounts.errors = [];
    uiState.accounts.warnings = [];
    uiState.accounts.message = "";
  }

  function ensureMovementDraft(movement = null) {
    uiState.movements.draft = movement ? clone(movement) : bankService.emptyMovement();
    uiState.movements.errors = [];
    uiState.movements.message = "";
  }

  function ensureStatementDraft(statement = null, bankAccountId = "") {
    const targetBankAccountId = bankAccountId || uiState.reconciliation.draft?.bankAccountId || firstActiveBankAccountId();
    uiState.reconciliation.statementDraft = statement
      ? clone(statement)
      : reconciliationService.emptyStatementMovement(targetBankAccountId);
  }

  function ensureReconciliationDraft(reconciliation = null) {
    if (reconciliation) {
      uiState.reconciliation.currentId = reconciliation.id || "";
      uiState.reconciliation.draft = clone(reconciliation);
      ensureStatementDraft(null, reconciliation.bankAccountId || "");
    } else {
      const draft = reconciliationService.emptyReconciliation(firstActiveBankAccountId());
      uiState.reconciliation.currentId = "";
      uiState.reconciliation.draft = clone(draft);
      ensureStatementDraft(null, draft.bankAccountId || "");
    }
    uiState.reconciliation.selectedSystemIds = [];
    uiState.reconciliation.selectedStatementIds = [];
    uiState.reconciliation.message = "";
    uiState.reconciliation.errors = [];
    uiState.reconciliation.actionNote = "";
    uiState.reconciliation.reopenReason = "";
  }

  function accountRows() {
    return bankService.accountsWithSummary({
      search: uiState.accounts.search,
      type: uiState.accounts.type,
      status: uiState.accounts.status
    });
  }

  function movementRows() {
    return bankService.movements({
      search: uiState.movements.search,
      bankAccountId: uiState.movements.bankAccountId,
      status: uiState.movements.status,
      originModule: uiState.movements.originModule,
      dateFrom: uiState.movements.dateFrom,
      dateTo: uiState.movements.dateTo
    });
  }

  function activeReconciliationDraft() {
    if (!uiState.reconciliation.draft) {
      ensureReconciliationDraft(null);
    }
    return uiState.reconciliation.draft;
  }

  function setReconciliationDraft(reconciliation, message = "") {
    uiState.reconciliation.currentId = reconciliation.id || "";
    uiState.reconciliation.draft = clone(reconciliation);
    uiState.reconciliation.message = message;
    uiState.reconciliation.errors = [];
    uiState.reconciliation.selectedSystemIds = [];
    uiState.reconciliation.selectedStatementIds = [];
    if (uiState.reconciliation.statementDraft && uiState.reconciliation.statementDraft.bankAccountId !== reconciliation.bankAccountId) {
      ensureStatementDraft(null, reconciliation.bankAccountId || "");
    }
  }

  function syncReconciliationDraftFromDom() {
    const form = document.querySelector("#bank-reconciliation-form");
    if (!form || !uiState.reconciliation.draft) return;
    const base = clone(uiState.reconciliation.draft);
    uiState.reconciliation.draft = {
      ...base,
      bankAccountId: form.elements.bankAccountId?.value || "",
      period: form.elements.period?.value || base.period || "",
      dateFrom: form.elements.dateFrom?.value || "",
      dateTo: form.elements.dateTo?.value || "",
      openingBankBalance: Number(form.elements.openingBankBalance?.value || 0),
      closingBankBalance: Number(form.elements.closingBankBalance?.value || 0),
      notes: form.elements.notes?.value || "",
      differenceJustification: form.elements.differenceJustification?.value || ""
    };
  }

  function syncStatementDraftFromDom() {
    const form = document.querySelector("#bank-statement-form");
    if (!form || !uiState.reconciliation.statementDraft) return;
    const base = clone(uiState.reconciliation.statementDraft);
    const incomeValue = Number(form.elements.incomeValue?.value || 0);
    const expenseValue = Number(form.elements.expenseValue?.value || 0);
    uiState.reconciliation.statementDraft = {
      ...base,
      bankAccountId: form.elements.bankAccountId?.value || base.bankAccountId || uiState.reconciliation.draft?.bankAccountId || "",
      movementDate: form.elements.movementDate?.value || "",
      reference: form.elements.reference?.value || "",
      description: form.elements.description?.value || "",
      externalUniqueCode: form.elements.externalUniqueCode?.value || "",
      transactionType: form.elements.transactionType?.value || "",
      incomeValue,
      expenseValue,
      netValue: Number((incomeValue - expenseValue).toFixed(2)),
      observation: form.elements.observation?.value || ""
    };
  }

  function renderAccounts(container, route) {
    const rows = accountRows();
    const summary = bankService.dashboardSummary();
    const draft = uiState.accounts.draft;
    const ledgerOptions = chartService.movementOptions();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Cuentas bancarias</h1>
          <p>Catalogo base de bancos, cajas y cuentas financieras, con saldo auxiliar calculado desde movimientos internos.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Control auxiliar activo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.accounts.message ? `<section class="inline-feedback success">${esc(uiState.accounts.message)}</section>` : ""}
      ${uiState.accounts.warnings.length ? `<section class="inline-feedback warning">${uiState.accounts.warnings.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${uiState.accounts.errors.length ? `<section class="inline-feedback danger">${uiState.accounts.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="summary-grid summary-grid-banks">
        <article class="summary-card"><span>Cuentas activas</span><strong>${esc(String(summary.activeAccounts))}</strong><small>Catalogo disponible</small></article>
        <article class="summary-card"><span>Cuentas inactivas</span><strong>${esc(String(summary.inactiveAccounts))}</strong><small>Sin eliminacion fisica</small></article>
        <article class="summary-card"><span>Saldo auxiliar total</span><strong>${money(summary.totalAuxiliaryBalance)}</strong><small>Saldo inicial mas movimientos</small></article>
        <article class="summary-card"><span>Borradores</span><strong>${esc(String(summary.draftMovements))}</strong><small>Movimientos aun no contabilizados</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-banks-accounts">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="bank-account-search" placeholder="Codigo, banco, numero o titular" value="${esc(uiState.accounts.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="bank-account-type-filter">
              <option value="">Todos</option>
              ${bankService.bankAccountTypes.map(item => `<option value="${esc(item)}" ${uiState.accounts.type === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="bank-account-status-filter">
              <option value="">Todos</option>
              ${bankService.bankAccountStates.map(item => `<option value="${esc(item)}" ${uiState.accounts.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-bank-account-new>Nueva cuenta</button>
          </div>
        </div>
      </section>
      ${draft ? `
        <article class="panel-card editor-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">FICHA</p>
              <h3>${draft.id ? "Editar cuenta bancaria" : "Nueva cuenta bancaria"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-bank-account-cancel>Cancelar</button>
              <button class="secondary-button" type="button" data-bank-account-save>Guardar cuenta</button>
            </div>
          </div>
          <form id="bank-account-form" class="compact-form-grid">
            <label class="compact-field"><span>Codigo interno</span><input name="code" value="${esc(draft.code || "")}"></label>
            <label class="compact-field"><span>Banco</span><input name="bankName" value="${esc(draft.bankName || "")}"></label>
            <label class="compact-field"><span>Numero de cuenta</span><input name="accountNumber" value="${esc(draft.accountNumber || "")}"></label>
            <label class="compact-field">
              <span>Tipo</span>
              <select name="accountType">
                ${bankService.bankAccountTypes.map(item => `<option value="${esc(item)}" ${draft.accountType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Titular</span><input name="holder" value="${esc(draft.holder || "")}"></label>
            <label class="compact-field"><span>Moneda</span><input name="currency" value="${esc(draft.currency || "USD")}"></label>
            <label class="compact-field">
              <span>Cuenta contable asociada</span>
              <select name="linkedAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${ledgerOptions.map(item => `<option value="${esc(item.code)}" ${draft.linkedAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Saldo inicial</span><input name="openingBalance" type="number" min="0" step="0.01" value="${esc(String(draft.openingBalance || 0))}" ${draft.id?"disabled":""}></label>
            <label class="compact-field"><span>Fecha saldo inicial</span><input name="openingBalanceDate" type="date" value="${esc(draft.openingBalanceDate || "")}" ${draft.id?"disabled":""}></label>
            <label class="compact-field">
              <span>Estado</span>
              <select name="status">
                ${bankService.bankAccountStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          </form>
        </article>
      ` : ""}
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CATALOGO</p>
            <h3>Cuentas bancarias y cajas</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-bank-accounts">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Banco</th>
                <th>Numero</th>
                <th>Tipo</th>
                <th>Titular</th>
                <th>Moneda</th>
                <th>Cuenta contable</th>
                <th>Saldo inicial</th>
                <th>Ingresos</th>
                <th>Egresos</th>
                <th>Saldo actual</th>
                <th>Ultimo movimiento</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td><strong>${esc(item.code)}</strong></td>
                  <td>${esc(item.bankName)}</td>
                  <td>${esc(item.accountNumber || "-")}</td>
                  <td>${esc(item.accountType)}</td>
                  <td>${esc(item.holder)}</td>
                  <td>${esc(item.currency)}</td>
                  <td>${esc(item.linkedAccountCode || "-")}</td>
                  <td>${money(item.summary?.openingBalance || 0)}</td>
                  <td>${money(item.summary?.incomes || 0)}</td>
                  <td>${money(item.summary?.expenses || 0)}</td>
                  <td><strong>${money(item.summary?.currentBalance || 0)}</strong></td>
                  <td>${esc(item.summary?.lastMovement?.movementNumber || "Sin movimientos")}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-bank-account-edit="${esc(item.id)}">Editar</button>
                      <button class="row-action-button" type="button" data-bank-account-toggle="${esc(item.id)}">${item.status === "activa" ? "Inactivar" : "Activar"}</button>
                      <button class="row-action-button" type="button" data-bank-account-movements="${esc(item.id)}">Movimientos</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="14"><div class="empty-inline">No hay cuentas bancarias para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindAccounts();
  }

  function renderMovements(container, route) {
    if (!uiState.movements.draft) ensureMovementDraft();
    const readRuntime = treasuryReadService()?.snapshot?.() || {};
    const read = readRuntime.movements || { loaded:false,loading:false,items:[],total:0,summary:{},page:1,pageSize:25 };
    const rows = read.items || [];
    const summary = read.summary || {};
    const draft = uiState.movements.draft;
    const accounts = bankService.bankAccounts().filter(item => item.status === "activa" && item.isCanonical);
    const counterAccounts = chartService.movementOptions();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Movimientos bancarios</h1>
          <p>Registro y consulta de movimientos manuales, con visualizacion auxiliar de pagos confirmados sin duplicar asientos.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Integrado con Pagos</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.movements.message ? `<section class="inline-feedback success">${esc(uiState.movements.message)}</section>` : ""}
      ${uiState.movements.errors.length ? `<section class="inline-feedback danger">${uiState.movements.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${readRuntime.error ? `<section class="inline-feedback danger">${esc(readRuntime.error)} No se utilizará el histórico local como fallback.</section>` : ""}
      <section class="summary-grid summary-grid-banks">
        <article class="summary-card"><span>Ingresos del rango</span><strong>${read.loaded ? money(summary.income || 0) : "—"}</strong><small>Universo consultado</small></article>
        <article class="summary-card"><span>Egresos del rango</span><strong>${read.loaded ? money(summary.expense || 0) : "—"}</strong><small>Universo consultado</small></article>
        <article class="summary-card"><span>Saldo inicial</span><strong>${read.loaded ? money(summary.openingBalance || 0) : "—"}</strong><small>Treasury V2 antes de Desde</small></article>
        <article class="summary-card"><span>Saldo final</span><strong>${read.loaded ? money(summary.closingBalance || 0) : "—"}</strong><small>Independiente de la página</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-bank-movements">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="bank-movement-search" placeholder="Numero, referencia, tercero o asiento" value="${esc(uiState.movements.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Cuenta bancaria</span>
            <select id="bank-movement-account-filter">
              <option value="">Seleccionar cuenta</option>
              ${accounts.map(item => `<option value="${esc(item.id)}" ${uiState.movements.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} · ${esc(item.bankName)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Tipo</span><select id="bank-movement-type-filter"><option value="">Todos</option><option value="INGRESO" ${uiState.movements.type === "INGRESO" ? "selected" : ""}>Ingreso</option><option value="EGRESO" ${uiState.movements.type === "EGRESO" ? "selected" : ""}>Egreso</option></select></label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="bank-movement-status-filter">
              <option value="">Todos</option>
              ${bankService.movementStates.map(item => `<option value="${esc(item)}" ${uiState.movements.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Filas</span><select id="bank-movement-page-size"><option value="25" ${Number(uiState.movements.pageSize) === 25 ? "selected" : ""}>25</option><option value="50" ${Number(uiState.movements.pageSize) === 50 ? "selected" : ""}>50</option></select></label>
          <button class="primary-button" type="button" data-bank-movement-query ${read.loading ? "disabled" : ""}>${read.loading ? "Consultando..." : "Consultar"}</button>
          <label class="compact-inline-field">
            <span>Origen</span>
            <select id="bank-movement-origin-filter">
              <option value="">Todos</option>
              ${bankService.movementOrigins.map(item => `<option value="${esc(item)}" ${uiState.movements.originModule === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Desde</span>
            <input id="bank-movement-date-from" type="date" value="${esc(uiState.movements.dateFrom || "")}">
          </label>
          <label class="compact-inline-field">
            <span>Hasta</span>
            <input id="bank-movement-date-to" type="date" value="${esc(uiState.movements.dateTo || "")}">
          </label>
        </div>
      </section>
      <section class="placeholder-grid banks-editor-layout">
        <article class="panel-card editor-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CAPTURA</p>
              <h3>${draft.id ? `Movimiento ${esc(draft.movementNumber)}` : "Nuevo movimiento manual"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-bank-movement-reset>Nuevo</button>
              <button class="secondary-button" type="button" data-bank-movement-save>Guardar borrador</button>
              <button class="secondary-button" type="button" data-bank-movement-confirm>Contabilizar</button>
            </div>
          </div>
          <form id="bank-movement-form" class="compact-form-grid">
            <label class="compact-field"><span>Numero</span><input name="movementNumber" value="${esc(draft.movementNumber || "")}" readonly></label>
            <label class="compact-field"><span>Fecha</span><input name="movementDate" type="date" value="${esc(draft.movementDate || "")}"></label>
            <label class="compact-field">
              <span>Cuenta bancaria</span>
              <select name="bankAccountId">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.id)}" ${draft.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} · ${esc(item.bankName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Tipo movimiento</span>
              <select name="movementType">
                ${bankService.movementTypes.map(item => `<option value="${esc(item)}" ${draft.movementType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Medio</span>
              <select name="medium">
                ${bankService.movementMediums.map(item => `<option value="${esc(item)}" ${draft.medium === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Modulo origen</span>
              <select name="originModule">
                ${["manual", "ajustes", "transferencias"].map(item => `<option value="${esc(item)}" ${draft.originModule === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Referencia / comprobante</span><input name="reference" value="${esc(draft.reference || "")}"></label>
            <label class="compact-field"><span>Beneficiario / tercero</span><input name="beneficiary" value="${esc(draft.beneficiary || "")}"></label>
            <label class="compact-field full"><span>Concepto</span><input name="concept" value="${esc(draft.concept || "")}"></label>
            <label class="compact-field"><span>Valor ingreso</span><input name="incomeValue" type="number" min="0" step="0.01" value="${esc(String(draft.incomeValue || 0))}"></label>
            <label class="compact-field"><span>Valor egreso</span><input name="expenseValue" type="number" min="0" step="0.01" value="${esc(String(draft.expenseValue || 0))}"></label>
            <label class="compact-field">
              <span>Cuenta contrapartida</span>
              <select name="counterAccountCode">
                <option value="">Seleccionar cuenta</option>
                ${counterAccounts.map(item => `<option value="${esc(item.code)}" ${draft.counterAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Centro de costo</span><input name="costCenter" value="${esc(draft.costCenter || "")}"></label>
            <label class="compact-field"><span>Auxiliar</span><input name="auxiliary" value="${esc(draft.auxiliary || "")}"></label>
            <label class="compact-field"><span>Descripcion linea</span><input name="lineDescription" value="${esc(draft.lineDescription || "")}"></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          </form>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">NOTAS</p>
              <h3>Reglas del modulo</h3>
            </div>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Integracion Pagos</strong><span>Los pagos confirmados aparecen aqui como egresos auxiliares y no vuelven a contabilizar.</span></div>
            <div class="info-row"><strong>Borradores</strong><span>Los movimientos en borrador no afectan Libro Diario ni Mayor.</span></div>
            <div class="info-row"><strong>Contrapartida</strong><span>Se exige al contabilizar movimientos manuales.</span></div>
            <div class="info-row"><strong>Transferencias</strong><span>Las transferencias internas quedaran para una fase posterior del modulo.</span></div>
          </div>
          <p class="panel-note">La conciliacion bancaria mensual ya queda disponible en la pestana siguiente con extracto externo manual y cierre base.</p>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Movimientos bancarios</h3>
          </div>
           <span class="status-badge partial">${read.loaded ? esc(String(read.total)) : "0"} registros</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-bank-movements">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Numero</th>
                <th>Cuenta</th>
                <th>Tipo</th>
                <th>Medio</th>
                <th>Referencia</th>
                <th>Tercero</th>
                <th>Concepto</th>
                <th>Ingreso</th>
                <th>Egreso</th>
                <th>Estado</th>
                <th>Origen</th>
                <th>Asiento</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.movementDate)}</td>
                  <td><strong>${esc(item.movementNumber)}</strong></td>
                  <td>${esc(item.bankAccountLabel || "Cuenta no catalogada")}</td>
                  <td>${esc(item.movementType)}</td>
                  <td>${esc(item.medium)}</td>
                  <td>${esc(item.reference || "-")}</td>
                  <td>${esc(item.beneficiary || "-")}</td>
                  <td>${esc(item.concept || "-")}</td>
                  <td>${money(item.incomeValue || 0)}</td>
                  <td>${money(item.expenseValue || 0)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${statusBadge(item.originModule)}</td>
                  <td>${esc(item.journalEntryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      ${!item.derived && item.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-bank-movement-edit="${esc(item.id)}">Editar</button>` : ""}
                      ${!item.derived && item.status !== "ANULADO" ? `<button class="row-action-button" type="button" data-bank-movement-annul="${esc(item.id)}">Anular</button>` : ""}
                      ${item.bankAccountId ? `<button class="row-action-button" type="button" data-bank-movement-account="${esc(item.bankAccountId)}">Cuenta</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="14"><div class="empty-inline">${read.loaded ? "No hay movimientos bancarios para estos filtros." : "Selecciona cuenta y rango, luego pulsa Consultar."}</div></td></tr>`}
            </tbody>
          </table>
        </div>
        ${read.loaded && read.total > read.pageSize ? `<div class="pagination-bar"><button class="secondary-button" data-bank-movement-page="${read.page - 1}" ${read.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${read.page} · ${Math.min((read.page - 1) * read.pageSize + 1, read.total)}–${Math.min(read.page * read.pageSize, read.total)} de ${read.total}</span><button class="secondary-button" data-bank-movement-page="${read.page + 1}" ${read.page * read.pageSize >= read.total ? "disabled" : ""}>Siguiente</button></div>` : ""}
      </article>
    `;
    bindMovements();
  }

  function renderReconciliationLegacy(container, route) {
    const history = reconciliationService.reconciliations();
    const current = activeReconciliationDraft();
    const context = reconciliationService.context(current);
    const totals = context.totals;
    const draft = context.reconciliation;
    const accounts = bankService.bankAccounts().filter(item => item.status === "activa");
    const statementDraft = uiState.reconciliation.statementDraft || reconciliationService.emptyStatementMovement(draft.bankAccountId || "");
    const selectedSystem = context.systemRows.find(item => item.id === uiState.reconciliation.selectedSystemId) || null;
    const selectedStatement = context.statementRows.find(item => item.id === uiState.reconciliation.selectedStatementId) || null;
    const selectedMatch = draft.matches.find(item =>
      item.systemMovementId === uiState.reconciliation.selectedSystemId ||
      item.statementMovementId === uiState.reconciliation.selectedStatementId
    ) || null;
    const candidateSuggestions = selectedSystem ? (context.suggestions[selectedSystem.id] || []) : [];
    const selectedSuggestion = selectedStatement
      ? candidateSuggestions.find(item => item.statementMovementId === selectedStatement.id) || null
      : candidateSuggestions[0] || null;
    const hasClosedStatus = draft.status === "CERRADA";

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Conciliacion bancaria</h1>
          <p>Comparacion mensual entre movimientos internos del sistema y extracto bancario externo, con sugerencias de match, observaciones y cierre base.</p>
        </div>
        <div class="page-header-side">
          ${statusBadge(draft.status)}
          <span class="status-badge partial">Tolerancia ${money(reconciliationService.toleranceAmount)}</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.reconciliation.message ? `<section class="inline-feedback success">${esc(uiState.reconciliation.message)}</section>` : ""}
      ${uiState.reconciliation.errors.length ? `<section class="inline-feedback danger">${uiState.reconciliation.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <form id="bank-reconciliation-form" class="compact-form-grid reconciliation-form-grid">
          <label class="compact-field">
            <span>Cuenta bancaria</span>
            <select name="bankAccountId" id="reconciliation-bank-account">
              <option value="">Seleccionar cuenta</option>
              ${accounts.map(item => `<option value="${esc(item.id)}" ${draft.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} · ${esc(item.bankName)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Periodo</span><input name="period" id="reconciliation-period" type="month" value="${esc(draft.period || "")}"></label>
          <label class="compact-field"><span>Fecha desde</span><input name="dateFrom" id="reconciliation-date-from" type="date" value="${esc(draft.dateFrom || "")}"></label>
          <label class="compact-field"><span>Fecha hasta</span><input name="dateTo" id="reconciliation-date-to" type="date" value="${esc(draft.dateTo || "")}"></label>
          <label class="compact-field"><span>Saldo inicial banco</span><input name="openingBankBalance" type="number" min="0" step="0.01" value="${esc(String(draft.openingBankBalance || 0))}"></label>
          <label class="compact-field"><span>Saldo final segun banco</span><input name="closingBankBalance" type="number" step="0.01" value="${esc(String(draft.closingBankBalance || 0))}"></label>
          <label class="compact-field"><span>Saldo auxiliar sistema</span><input value="${esc(String(totals.auxiliaryBalance || 0))}" readonly></label>
          <label class="compact-field"><span>Diferencia</span><input value="${esc(String(totals.difference || 0))}" readonly></label>
          <label class="compact-field full"><span>Notas de conciliacion</span><textarea name="notes" rows="2">${esc(draft.notes || "")}</textarea></label>
          <label class="compact-field full"><span>Justificacion de diferencia / observaciones generales</span><textarea name="differenceJustification" rows="2">${esc(draft.differenceJustification || "")}</textarea></label>
        </form>
        <div class="reconciliation-toolbar">
          <button class="secondary-button" type="button" data-reconciliation-new>Crear conciliacion</button>
          <button class="secondary-button" type="button" data-reconciliation-save>Guardar borrador</button>
          <button class="secondary-button" type="button" data-reconciliation-close ${!draft.bankAccountId ? "disabled" : ""}>Cerrar conciliacion</button>
          <button class="secondary-button" type="button" data-reconciliation-reopen ${hasClosedStatus ? "" : "disabled"}>Reabrir</button>
          <button class="secondary-button" type="button" data-reconciliation-export>Exportar</button>
        </div>
        ${hasClosedStatus ? `
          <div class="helper-pill">
            <strong>Conciliacion cerrada</strong>
            <span>Fecha cierre: ${esc(draft.closeDate ? new Date(draft.closeDate).toLocaleString("es-EC") : "No registrada")} · Usuario: ${esc(draft.closedBy || "No registrado")}</span>
          </div>
        ` : ""}
      </section>
      <section class="summary-grid summary-grid-reconciliation">
        <article class="summary-card"><span>Ingresos sistema</span><strong>${money(totals.totalSystemIncome)}</strong><small>Movimientos internos contabilizados</small></article>
        <article class="summary-card"><span>Egresos sistema</span><strong>${money(totals.totalSystemExpense)}</strong><small>Pagos, cargos y manuales</small></article>
        <article class="summary-card"><span>Ingresos banco</span><strong>${money(totals.totalBankIncome)}</strong><small>Estado de cuenta cargado</small></article>
        <article class="summary-card"><span>Egresos banco</span><strong>${money(totals.totalBankExpense)}</strong><small>Estado de cuenta cargado</small></article>
        <article class="summary-card"><span>Total conciliado</span><strong>${money(totals.totalConciliated)}</strong><small>${esc(String(draft.matches.length))} cruces confirmados</small></article>
        <article class="summary-card"><span>Diferencia final</span><strong>${money(totals.difference)}</strong><small>${totals.difference === 0 ? "Lista para cierre" : "Requiere ajuste o justificacion"}</small></article>
      </section>
      <section class="panel-card reconciliation-actions-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ACCIONES</p>
            <h3>Conciliar, observar o dejar pendiente</h3>
          </div>
          ${selectedSuggestion ? suggestionBadge(selectedSuggestion.status) : `<span class="status-badge pending">Seleccione movimientos</span>`}
        </div>
        <div class="reconciliation-actions-grid">
          <div class="info-row">
            <strong>Sistema seleccionado</strong>
            <span>${selectedSystem ? `${selectedSystem.movementDate} · ${selectedSystem.reference} · ${money((selectedSystem.incomeValue || 0) - (selectedSystem.expenseValue || 0))}` : "Sin seleccion"}</span>
          </div>
          <div class="info-row">
            <strong>Banco seleccionado</strong>
            <span>${selectedStatement ? `${selectedStatement.movementDate} · ${selectedStatement.reference} · ${money(selectedStatement.netValue || 0)}` : "Sin seleccion"}</span>
          </div>
          <label class="compact-field full">
            <span>Nota para match / observacion / reapertura</span>
            <input id="reconciliation-action-note" value="${esc(uiState.reconciliation.actionNote || "")}" placeholder="Ej. cargo pendiente de ajuste o match confirmado por referencia">
          </label>
        </div>
        <div class="reconciliation-toolbar">
          <button class="secondary-button" type="button" data-reconciliation-link ${selectedSystem && selectedStatement && !hasClosedStatus ? "" : "disabled"}>Conciliar seleccion</button>
          <button class="secondary-button" type="button" data-reconciliation-suggest ${selectedSystem && !hasClosedStatus ? "" : "disabled"}>Aplicar sugerencia</button>
          <button class="secondary-button" type="button" data-reconciliation-observe-system ${selectedSystem && !hasClosedStatus ? "" : "disabled"}>Observar sistema</button>
          <button class="secondary-button" type="button" data-reconciliation-observe-statement ${selectedStatement && !hasClosedStatus ? "" : "disabled"}>Observar banco</button>
          <button class="secondary-button" type="button" data-reconciliation-unlink ${selectedMatch && !hasClosedStatus ? "" : "disabled"}>Quitar relacion</button>
          <button class="secondary-button" type="button" data-reconciliation-adjustment>Crear ajuste</button>
        </div>
      </section>
      <section class="reconciliation-panels">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">PANEL A</p>
              <h3>Movimientos del sistema</h3>
            </div>
            <span class="status-badge partial">${esc(String(context.systemRows.length))} registros</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table compact-table-reconciliation">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Referencia</th>
                  <th>Descripcion</th>
                  <th>Ingreso</th>
                  <th>Egreso</th>
                  <th>Neto</th>
                  <th>Estado</th>
                  <th>Asiento</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                ${context.systemRows.map(item => `
                  <tr class="${uiState.reconciliation.selectedSystemId === item.id ? "selected-row" : ""}">
                    <td>${esc(item.movementDate)}</td>
                    <td><strong>${esc(item.reference || item.movementNumber)}</strong><small>${esc(item.originModule || "-")}</small></td>
                    <td>${esc(item.concept || "-")}<small>${esc(item.observation || item.beneficiary || "")}</small></td>
                    <td>${money(item.incomeValue || 0)}</td>
                    <td>${money(item.expenseValue || 0)}</td>
                    <td><strong>${money((item.incomeValue || 0) - (item.expenseValue || 0))}</strong></td>
                    <td>${statusBadge(item.lineState)}</td>
                    <td>${esc(item.journalEntryNumber || "-")}</td>
                    <td><button class="row-action-button" type="button" data-reconciliation-select-system="${esc(item.id)}">Seleccionar</button></td>
                  </tr>
                `).join("") || `<tr><td colspan="9"><div class="empty-inline">No hay movimientos del sistema para la cuenta y periodo seleccionados.</div></td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="reconciliation-footnote">
            <strong>Pendiente sistema:</strong> ${esc(String(totals.pendingSystemRows.length))} |
            <strong>Observado sistema:</strong> ${esc(String(totals.observedSystemRows.length))}
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">PANEL B</p>
              <h3>Movimientos del estado de cuenta</h3>
            </div>
            <span class="status-badge partial">${esc(String(context.statementRows.length))} registros</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table compact-table-reconciliation">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Referencia</th>
                  <th>Descripcion</th>
                  <th>Ingreso</th>
                  <th>Egreso</th>
                  <th>Neto</th>
                  <th>Estado</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                ${context.statementRows.map(item => `
                  <tr class="${uiState.reconciliation.selectedStatementId === item.id ? "selected-row" : ""}">
                    <td>${esc(item.movementDate)}</td>
                    <td><strong>${esc(item.reference || item.statementNumber)}</strong><small>${esc(item.statementNumber || "-")}</small></td>
                    <td>${esc(item.description || "-")}<small>${esc(item.observation || "")}</small></td>
                    <td>${money(item.incomeValue || 0)}</td>
                    <td>${money(item.expenseValue || 0)}</td>
                    <td><strong>${money(item.netValue || 0)}</strong></td>
                    <td>${statusBadge(item.lineState)}</td>
                    <td><button class="row-action-button" type="button" data-reconciliation-select-statement="${esc(item.id)}">Seleccionar</button></td>
                  </tr>
                `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay movimientos externos para la cuenta y periodo seleccionados.</div></td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="reconciliation-footnote">
            <strong>Pendiente banco:</strong> ${esc(String(totals.pendingBankRows.length))} |
            <strong>Observado banco:</strong> ${esc(String(totals.observedBankRows.length))}
          </div>
        </article>
      </section>
      <section class="placeholder-grid reconciliation-bottom-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ESTADO DE CUENTA</p>
              <h3>Registrar movimiento externo</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-statement-template>Descargar plantilla XLSX</button>
              <button class="secondary-button" type="button" data-statement-import>Importar XLSX</button>
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-statement-file hidden>
              <button class="secondary-button" type="button" data-statement-reset>Nuevo</button>
              <button class="secondary-button" type="button" data-statement-save>Guardar movimiento banco</button>
            </div>
          </div>
          <form id="bank-statement-form" class="compact-form-grid">
            <label class="compact-field">
              <span>Cuenta bancaria</span>
              <select name="bankAccountId">
                <option value="">Seleccionar cuenta</option>
                ${accounts.map(item => `<option value="${esc(item.id)}" ${statementDraft.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} · ${esc(item.bankName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Fecha</span><input name="movementDate" type="date" value="${esc(statementDraft.movementDate || "")}"></label>
            <label class="compact-field"><span>Referencia</span><input name="reference" value="${esc(statementDraft.reference || "")}"></label>
            <label class="compact-field"><span>Descripcion</span><input name="description" value="${esc(statementDraft.description || "")}"></label>
            <label class="compact-field"><span>Codigo unico banco</span><input name="externalUniqueCode" value="${esc(statementDraft.externalUniqueCode || "")}" placeholder="Evita movimientos duplicados"></label>
            <label class="compact-field"><span>Tipo movimiento</span><input name="transactionType" value="${esc(statementDraft.transactionType || "")}" placeholder="Transferencia, comision..."></label>
            <label class="compact-field"><span>Ingreso</span><input name="incomeValue" type="number" min="0" step="0.01" value="${esc(String(statementDraft.incomeValue || 0))}"></label>
            <label class="compact-field"><span>Egreso</span><input name="expenseValue" type="number" min="0" step="0.01" value="${esc(String(statementDraft.expenseValue || 0))}"></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(statementDraft.observation || "")}</textarea></label>
          </form>
          <p class="panel-note"><strong>Formato XLSX:</strong> FECHA, DETALLE, CREDITO, DEBITO y CODIGO_UNICO son obligatorios. REFERENCIA, TIPO_MOVIMIENTO, OBSERVACION y SALDO son opcionales. Seleccione la cuenta bancaria antes de importar.</p>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">REPORTE</p>
              <h3>Resumen del cierre</h3>
            </div>
            ${statusBadge(draft.status)}
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Empresa</strong><span>${esc(context.report.company)}</span></div>
            <div class="info-row"><strong>Cuenta</strong><span>${esc(context.report.bankAccount)}</span></div>
            <div class="info-row"><strong>Periodo</strong><span>${esc(context.report.period || "No definido")}</span></div>
            <div class="info-row"><strong>Saldo inicial</strong><span>${money(context.report.openingBalance)}</span></div>
            <div class="info-row"><strong>Saldo final banco</strong><span>${money(context.report.closingBankBalance)}</span></div>
            <div class="info-row"><strong>Saldo sistema</strong><span>${money(context.report.systemBalance)}</span></div>
            <div class="info-row"><strong>Diferencia</strong><span>${money(context.report.difference)}</span></div>
            <div class="info-row"><strong>Movimientos conciliados</strong><span>${esc(String(context.report.conciliatedCount))}</span></div>
            <div class="info-row"><strong>Pendientes</strong><span>Sistema ${esc(String(context.report.pendingSystem))} / Banco ${esc(String(context.report.pendingBank))}</span></div>
            <div class="info-row"><strong>Observados</strong><span>${esc(String(context.report.observed))}</span></div>
            <div class="info-row"><strong>Mayor contable</strong><span>${context.totals.ledger ? money(context.totals.ledger.finalBalance || 0) : "Cuenta contable no enlazada"}</span></div>
            <div class="info-row"><strong>Notas</strong><span>${esc(context.report.notes || "Sin observaciones")}</span></div>
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Conciliaciones registradas</h3>
          </div>
          <span class="status-badge partial">${esc(String(history.length))} conciliaciones</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-reconciliation-history">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Cuenta bancaria</th>
                <th>Saldo banco</th>
                <th>Saldo sistema</th>
                <th>Diferencia</th>
                <th>Estado</th>
                <th>Cierre</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${history.map(item => {
                const itemContext = reconciliationService.context(item);
                return `
                  <tr>
                    <td><strong>${esc(item.period)}</strong><small>${esc(item.dateFrom)} a ${esc(item.dateTo)}</small></td>
                    <td>${esc(itemContext.account ? `${itemContext.account.code} · ${itemContext.account.bankName}` : "Cuenta no catalogada")}</td>
                    <td>${money(item.closingBankBalance || 0)}</td>
                    <td>${money(itemContext.totals.auxiliaryBalance || 0)}</td>
                    <td>${money(itemContext.totals.difference || 0)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td>${esc(item.closeDate ? new Date(item.closeDate).toLocaleDateString("es-EC") : "Sin cierre")}</td>
                    <td>
                      <div class="row-actions">
                        <button class="row-action-button" type="button" data-reconciliation-open="${esc(item.id)}">Abrir</button>
                        <button class="row-action-button" type="button" data-reconciliation-open-ledger="${esc(item.bankAccountId || "")}">Ver mayor</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="8"><div class="empty-inline">Todavia no hay conciliaciones registradas.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindReconciliationLegacy();
  }

  function collectAccountDraft() {
    const form = document.querySelector("#bank-account-form");
    const base = clone(uiState.accounts.draft || {});
    if (!form) return base;
    return {
      ...base,
      code: form.elements.code?.value || "",
      bankName: form.elements.bankName?.value || "",
      accountNumber: form.elements.accountNumber?.value || "",
      accountType: form.elements.accountType?.value || "corriente",
      holder: form.elements.holder?.value || "",
      currency: form.elements.currency?.value || "USD",
      linkedAccountCode: form.elements.linkedAccountCode?.value || "",
      openingBalance: Number(form.elements.openingBalance?.value || 0),
      openingBalanceDate: form.elements.openingBalanceDate?.value || "",
      status: form.elements.status?.value || "activa",
      observation: form.elements.observation?.value || ""
    };
  }

  function collectMovementDraft() {
    const form = document.querySelector("#bank-movement-form");
    const base = clone(uiState.movements.draft || bankService.emptyMovement());
    if (!form) return base;
    return {
      ...base,
      movementDate: form.elements.movementDate?.value || "",
      bankAccountId: form.elements.bankAccountId?.value || "",
      movementType: form.elements.movementType?.value || "egreso",
      medium: form.elements.medium?.value || "transferencia",
      originModule: form.elements.originModule?.value || "manual",
      reference: form.elements.reference?.value || "",
      beneficiary: form.elements.beneficiary?.value || "",
      concept: form.elements.concept?.value || "",
      incomeValue: Number(form.elements.incomeValue?.value || 0),
      expenseValue: Number(form.elements.expenseValue?.value || 0),
      counterAccountCode: form.elements.counterAccountCode?.value || "",
      costCenter: form.elements.costCenter?.value || "",
      auxiliary: form.elements.auxiliary?.value || "",
      lineDescription: form.elements.lineDescription?.value || "",
      observation: form.elements.observation?.value || ""
    };
  }

  function collectReconciliationDraft() {
    syncReconciliationDraftFromDom();
    return clone(uiState.reconciliation.draft || reconciliationService.emptyReconciliation(firstActiveBankAccountId()));
  }

  function collectStatementDraft() {
    syncStatementDraftFromDom();
    return clone(uiState.reconciliation.statementDraft || reconciliationService.emptyStatementMovement(uiState.reconciliation.draft?.bankAccountId || ""));
  }

  async function persistReconciliationDraft() {
    const resolution = reconciliationAccountResolution();
    if (!resolution.ok) {
      const errors = ["La cuenta seleccionada debe confirmarse en Tesorería V2 antes de continuar con la conciliación."];
      uiState.reconciliation.errors = errors;
      return { ok:false,code:"BANK_ACCOUNT_NOT_CANONICAL",errors };
    }
    uiState.reconciliation.draft.bankAccountId = resolution.bankAccountId;
    const result = await reconciliationService.saveReconciliation(collectReconciliationDraft());
    uiState.reconciliation.errors = result.errors || [];
    if (!result.ok) return result;
    setReconciliationDraft(result.reconciliation);
    return result;
  }

  function selectReconciliation(item) {
    ensureReconciliationDraft(item || null);
    BlessERP.layout.renderPage();
  }

  function bindAccounts() {
    document.querySelector("#bank-account-search")?.addEventListener("input", event => {
      uiState.accounts.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bank-account-type-filter")?.addEventListener("change", event => {
      uiState.accounts.type = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bank-account-status-filter")?.addEventListener("change", event => {
      uiState.accounts.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-bank-account-new]")?.addEventListener("click", () => {
      ensureAccountDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-bank-account-cancel]")?.addEventListener("click", () => {
      uiState.accounts.draft = null;
      uiState.accounts.errors = [];
      uiState.accounts.warnings = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-bank-account-save]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const result = await bankService.saveBankAccount(collectAccountDraft());
      uiState.accounts.errors = result.errors || [];
      uiState.accounts.warnings = result.warnings || [];
      uiState.accounts.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.accounts.draft = null;
      uiState.accounts.message = `Cuenta bancaria ${result.account.code} confirmada en Supabase.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-bank-account-edit]").forEach(button => button.addEventListener("click", () => {
      const account = bankService.findBankAccountById(button.dataset.bankAccountEdit);
      if (!account) return;
      ensureAccountDraft(account);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-bank-account-toggle]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await bankService.toggleBankAccountStatus(button.dataset.bankAccountToggle);
      uiState.accounts.message = result.ok
        ? "Estado confirmado en Supabase."
        : (result.message || "");
      uiState.accounts.errors = [];
      uiState.accounts.warnings = [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-bank-account-movements]").forEach(button => button.addEventListener("click", () => {
      uiState.movements.bankAccountId = button.dataset.bankAccountMovements;
      BlessERP.state.setRoute("banks-movements");
      BlessERP.layout.renderApp();
    }));
  }

  function bindMovements() {
    document.querySelector("#bank-movement-search")?.addEventListener("input", event => {
      uiState.movements.search = event.target.value;
    });
    document.querySelector("#bank-movement-account-filter")?.addEventListener("change", event => {
      uiState.movements.bankAccountId = event.target.value;
    });
    document.querySelector("#bank-movement-status-filter")?.addEventListener("change", event => {
      uiState.movements.status = event.target.value;
    });
    document.querySelector("#bank-movement-origin-filter")?.addEventListener("change", event => {
      uiState.movements.originModule = event.target.value;
    });
    document.querySelector("#bank-movement-date-from")?.addEventListener("change", event => {
      uiState.movements.dateFrom = event.target.value;
    });
    document.querySelector("#bank-movement-date-to")?.addEventListener("change", event => {
      uiState.movements.dateTo = event.target.value;
    });
    document.querySelector("#bank-movement-type-filter")?.addEventListener("change", event => {
      uiState.movements.type = event.target.value;
    });
    document.querySelector("#bank-movement-page-size")?.addEventListener("change", event => {
      uiState.movements.pageSize = Number(event.target.value || 25);
    });
    document.querySelector("[data-bank-movement-query]")?.addEventListener("click", async () => {
      uiState.movements.errors = [];
      try {
        await treasuryReadService()?.queryMovements?.({
          bankAccountId: uiState.movements.bankAccountId,
          dateFrom: uiState.movements.dateFrom,
          dateTo: uiState.movements.dateTo,
          type: uiState.movements.type,
          status: uiState.movements.status,
          origin: uiState.movements.originModule,
          search: uiState.movements.search
        }, { page: 1, pageSize: uiState.movements.pageSize });
      } catch (error) { uiState.movements.errors = [error.message]; }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-bank-movement-page]").forEach(button => button.addEventListener("click", async () => {
      const state = treasuryReadService()?.snapshot?.()?.movements;
      try { await treasuryReadService()?.queryMovements?.(state?.appliedFilters, { page: Number(button.dataset.bankMovementPage), pageSize: state?.pageSize }); }
      catch (error) { uiState.movements.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-bank-movement-reset]")?.addEventListener("click", () => {
      ensureMovementDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-bank-movement-save]")?.addEventListener("click", () => {
      const result = bankService.saveMovement(collectMovementDraft());
      uiState.movements.errors = result.errors || [];
      uiState.movements.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureMovementDraft(result.movement);
      uiState.movements.message = `Movimiento ${result.movement.movementNumber} guardado en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-bank-movement-confirm]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const current = collectMovementDraft();
      const result = await bankService.confirmMovement(current.id, current);
      uiState.movements.errors = result.errors || [];
      uiState.movements.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureMovementDraft(result.movement);
      uiState.movements.message = `Movimiento ${result.movement.movementNumber} confirmado en Supabase${result.entry?.entryNumber ? ` con asiento ${result.entry.entryNumber}` : ""}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-bank-movement-edit]").forEach(button => button.addEventListener("click", () => {
      const movement = treasuryReadService()?.snapshot?.()?.movements?.items?.find(item => item.id === button.dataset.bankMovementEdit);
      if (!movement) return;
      ensureMovementDraft(movement);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-bank-movement-annul]").forEach(button => button.addEventListener("click", () => {
      const result = bankService.annulMovement(button.dataset.bankMovementAnnul);
      uiState.movements.errors = result.ok ? [] : [result.message || "No se pudo anular el movimiento."];
      uiState.movements.message = result.ok ? "Movimiento bancario anulado." : "";
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-bank-movement-account]").forEach(button => button.addEventListener("click", () => {
      uiState.movements.bankAccountId = button.dataset.bankMovementAccount;
      BlessERP.layout.renderPage();
    }));
  }

  function bindReconciliationLegacy() {
    document.querySelector("#reconciliation-bank-account")?.addEventListener("change", event => {
      syncReconciliationDraftFromDom();
      const bankAccountId = event.target.value || "";
      uiState.reconciliation.draft.bankAccountId = bankAccountId;
      ensureStatementDraft(null, bankAccountId);
      uiState.reconciliation.selectedSystemId = "";
      uiState.reconciliation.selectedStatementId = "";
      BlessERP.layout.renderPage();
    });
    document.querySelector("#reconciliation-period")?.addEventListener("change", event => {
      syncReconciliationDraftFromDom();
      const range = periodRange(event.target.value);
      uiState.reconciliation.draft.period = range.period;
      uiState.reconciliation.draft.dateFrom = range.dateFrom;
      uiState.reconciliation.draft.dateTo = range.dateTo;
      uiState.reconciliation.selectedSystemId = "";
      uiState.reconciliation.selectedStatementId = "";
      BlessERP.layout.renderPage();
    });
    document.querySelector("#reconciliation-date-from")?.addEventListener("change", () => {
      syncReconciliationDraftFromDom();
      BlessERP.layout.renderPage();
    });
    document.querySelector("#reconciliation-date-to")?.addEventListener("change", () => {
      syncReconciliationDraftFromDom();
      BlessERP.layout.renderPage();
    });
    document.querySelector("#reconciliation-action-note")?.addEventListener("input", event => {
      uiState.reconciliation.actionNote = event.target.value;
    });
    document.querySelector("[data-reconciliation-new]")?.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      ensureReconciliationDraft(null);
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-save]")?.addEventListener("click", async () => {
      const result = await persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.reconciliation.message = `Conciliacion ${result.reconciliation.period} guardada en estado ${result.reconciliation.status}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-close]")?.addEventListener("click", async () => {
      let result = await persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = await reconciliationService.closeReconciliation(result.reconciliation.id);
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, "Conciliacion cerrada correctamente.");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-reopen]")?.addEventListener("click", async () => {
      syncReconciliationDraftFromDom();
      const reason = String(uiState.reconciliation.actionNote || uiState.reconciliation.reopenReason || "").trim();
      if (!window.confirm("Esta conciliacion cerrada se reabrira para correccion. Desea continuar?")) return;
      const result = await reconciliationService.reopenReconciliation(uiState.reconciliation.currentId, reason);
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, "Conciliacion reabierta correctamente.");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-export]")?.addEventListener("click", () => {
      uiState.reconciliation.message = "La exportacion PDF/Excel de conciliacion quedara activa en una fase posterior.";
      uiState.reconciliation.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-reconciliation-select-system]").forEach(button => button.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      syncStatementDraftFromDom();
      uiState.reconciliation.selectedSystemId = button.dataset.reconciliationSelectSystem;
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-reconciliation-select-statement]").forEach(button => button.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      syncStatementDraftFromDom();
      uiState.reconciliation.selectedStatementId = button.dataset.reconciliationSelectStatement;
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-reconciliation-link]")?.addEventListener("click", async () => {
      let result = await persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = await reconciliationService.linkMatch(
        result.reconciliation.id,
        uiState.reconciliation.selectedSystemId,
        uiState.reconciliation.selectedStatementId,
        uiState.reconciliation.actionNote
      );
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, `Cruce registrado como ${result.suggestion.status}.`);
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-suggest]")?.addEventListener("click", async () => {
      const draft = collectReconciliationDraft();
      const context = reconciliationService.context(draft);
      const candidates = context.suggestions[uiState.reconciliation.selectedSystemId] || [];
      const candidate = uiState.reconciliation.selectedStatementId
        ? candidates.find(item => item.statementMovementId === uiState.reconciliation.selectedStatementId)
        : candidates[0];
      if (!candidate) {
        uiState.reconciliation.errors = ["No existe una sugerencia valida para el movimiento del sistema seleccionado."];
        BlessERP.layout.renderPage();
        return;
      }
      uiState.reconciliation.selectedStatementId = candidate.statementMovementId;
      let result = await persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = await reconciliationService.linkMatch(
        result.reconciliation.id,
        uiState.reconciliation.selectedSystemId,
        candidate.statementMovementId,
        uiState.reconciliation.actionNote || candidate.reason
      );
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, `Sugerencia aplicada: ${candidate.status}.`);
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-observe-system]")?.addEventListener("click", async () => {
      let result = await persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = await reconciliationService.saveReview(
        result.reconciliation.id,
        "system",
        uiState.reconciliation.selectedSystemId,
        "observado",
        uiState.reconciliation.actionNote || "Movimiento del sistema pendiente de revision."
      );
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, "Movimiento del sistema marcado como observado.");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-observe-statement]")?.addEventListener("click", async () => {
      let result = await persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = await reconciliationService.saveReview(
        result.reconciliation.id,
        "statement",
        uiState.reconciliation.selectedStatementId,
        "observado",
        uiState.reconciliation.actionNote || "Movimiento externo pendiente de ajuste."
      );
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, "Movimiento del estado de cuenta marcado como observado.");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-unlink]")?.addEventListener("click", async () => {
      const draft = collectReconciliationDraft();
      const match = draft.matches.find(item =>
        item.systemMovementId === uiState.reconciliation.selectedSystemId ||
        item.statementMovementId === uiState.reconciliation.selectedStatementId
      );
      if (!match) {
        uiState.reconciliation.errors = ["No existe una relacion activa para la seleccion actual."];
        BlessERP.layout.renderPage();
        return;
      }
      const result = await reconciliationService.unlinkMatch(
        draft.id,
        match.systemMovementId,
        match.statementMovementId
      );
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, "Relacion eliminada y movimientos liberados.");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-adjustment]")?.addEventListener("click", async event => {
      const draft=collectReconciliationDraft();
      const statement=reconciliationService.statementMovements().find(row=>row.id===uiState.reconciliation.selectedStatementId);
      if(!statement){uiState.reconciliation.errors=["Seleccione primero el movimiento bancario que requiere ajuste."];BlessERP.layout.renderPage();return;}
      const counterAccountCode=String(window.prompt("Cuenta contable de contrapartida para el ajuste:","") || "").trim();
      if(!counterAccountCode)return;
      const reason=String(window.prompt("Motivo obligatorio del ajuste:",uiState.reconciliation.actionNote || statement.description || "") || "").trim();
      if(!reason){uiState.reconciliation.errors=["El motivo del ajuste es obligatorio."];BlessERP.layout.renderPage();return;}
      const button=event.currentTarget;button.disabled=true;
      const result=await BlessERP.services?.treasuryV2?.registerAdjustment?.({accountType:"BANK",accountId:draft.bankAccountId,
        bankTransactionId:statement.id,adjustmentDate:statement.movementDate,direction:Number(statement.incomeValue||0)>0?"CREDIT":"DEBIT",
        amount:Math.abs(Number(statement.netValue||0)),currencyCode:"USD",counterAccountCode,reason,reference:statement.reference,adjustmentType:"BANK_IDENTIFICATION"});
      uiState.reconciliation.errors=result?.errors || (result?.ok?[]:[result?.message || "Supabase no confirmó el ajuste."]);
      uiState.reconciliation.message=result?.ok?`Ajuste ${result.adjustment.adjustmentNumber} contabilizado y confirmado en Supabase.`:"";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-statement-reset]")?.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      ensureStatementDraft(null, uiState.reconciliation.draft?.bankAccountId || "");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-statement-save]")?.addEventListener("click", async event => {
      const button=event.currentTarget; button.disabled=true;
      const result = await reconciliationService.saveStatementMovement(collectStatementDraft());
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.reconciliation.message = `Movimiento externo ${result.movement.statementNumber} guardado correctamente.`;
      ensureStatementDraft(null, result.movement.bankAccountId || uiState.reconciliation.draft?.bankAccountId || "");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-statement-template]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const previous = button.textContent;
      button.textContent = "Generando...";
      const result = await BlessERP.services?.bankStatementXlsx?.generateTemplate?.();
      button.disabled = false;
      button.textContent = previous;
      uiState.reconciliation.errors = result?.errors || [];
      uiState.reconciliation.message = result?.ok ? `Plantilla ${result.fileName} descargada.` : "";
      if (!result?.ok) BlessERP.layout.renderPage();
    });
    const statementFileInput = document.querySelector("[data-statement-file]");
    document.querySelector("[data-statement-import]")?.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      const bankAccountId = collectStatementDraft().bankAccountId || uiState.reconciliation.draft?.bankAccountId || "";
      if (!bankAccountId) {
        uiState.reconciliation.errors = ["Seleccione primero la cuenta bancaria donde se importará el estado de cuenta."];
        uiState.reconciliation.message = "";
        BlessERP.layout.renderPage();
        return;
      }
      statementFileInput?.click();
    });
    statementFileInput?.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      syncReconciliationDraftFromDom();
      const bankAccountId = collectStatementDraft().bankAccountId || uiState.reconciliation.draft?.bankAccountId || "";
      const result = await BlessERP.services?.bankStatementXlsx?.importFile?.(file, { bankAccountId });
      uiState.reconciliation.errors = result?.errors || [];
      uiState.reconciliation.message = result?.ok
        ? `${result.imported} movimiento(s) importado(s) desde ${file.name}.`
        : "";
      event.target.value = "";
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-reconciliation-open]").forEach(button => button.addEventListener("click", () => {
      const target = reconciliationService.findReconciliationById(button.dataset.reconciliationOpen);
      if (!target) return;
      selectReconciliation(target);
    }));
    document.querySelectorAll("[data-reconciliation-open-ledger]").forEach(button => button.addEventListener("click", () => {
      const account = bankService.findBankAccountById(button.dataset.reconciliationOpenLedger);
      if (!account?.linkedAccountCode) {
        uiState.reconciliation.errors = ["La cuenta bancaria seleccionada no tiene cuenta contable enlazada."];
        BlessERP.layout.renderPage();
        return;
      }
      BlessERP.state.setRoute("accounting-ledger");
      BlessERP.state.state.routeFilters = {
        ...(BlessERP.state.state.routeFilters || {}),
        ledgerAccountCode: account.linkedAccountCode
      };
      BlessERP.layout.renderApp();
    }));
  }

  function reconciliationDateLabel(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("es-EC");
  }

  function reconciliationMonthLabel(period) {
    if (!/^\d{4}-\d{2}$/.test(String(period || ""))) return "Sin definir";
    const [year, month] = String(period).split("-").map(Number);
    return new Intl.DateTimeFormat("es-EC", { month: "long", year: "numeric" })
      .format(new Date(year, month - 1, 1));
  }

  function systemMovementNet(item) {
    return Number(item?.incomeValue || 0) - Number(item?.expenseValue || 0);
  }

  function movementTypeCell(value) {
    return value >= 0
      ? `<span class="reconciliation-type plus">+</span>`
      : `<span class="reconciliation-type minus">−</span>`;
  }

  function renderReconciliationHistory(container, route) {
    const readRuntime = treasuryReadService()?.snapshot?.() || {};
    const read = readRuntime.history || { loaded:false,loading:false,items:[],total:0,page:1,pageSize:25 };
    const history = read.items || [];
    const filters = uiState.reconciliation.historyFilters;
    const accounts = bankService.bankAccounts().filter(item => item.status === "activa" && item.isCanonical);
    container.innerHTML = `
      <section class="page-header reconciliation-history-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Historial de conciliaciones</h1>
          <p>Control y revisión de conciliaciones por cuenta bancaria y período.</p>
        </div>
        <button class="primary-button" type="button" data-reconciliation-new-workspace>+ Nueva conciliación</button>
      </section>
      ${routeTabs(route)}
      ${uiState.reconciliation.message ? `<section class="inline-feedback success">${esc(uiState.reconciliation.message)}</section>` : ""}
      ${uiState.reconciliation.errors.length ? `<section class="inline-feedback danger">${uiState.reconciliation.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${readRuntime.error ? `<section class="inline-feedback danger">${esc(readRuntime.error)} No se utilizará el histórico local como fallback.</section>` : ""}
      <section class="reconciliation-bank-cards">
        ${accounts.map(account => `
          <article class="reconciliation-bank-card">
            <span class="reconciliation-bank-icon">${esc(String(account.bankName || "B").slice(0, 2).toUpperCase())}</span>
            <div><strong>${esc(account.bankName)}</strong><small>${esc(account.code)} · ${esc(account.accountNumber || "Cuenta activa")}</small></div>
          </article>
        `).join("") || `<div class="empty-inline">Configure una cuenta bancaria activa para iniciar.</div>`}
      </section>
      <section class="panel-card compact-toolbar-card"><div class="compact-toolbar">
        <label class="compact-inline-field"><span>Desde</span><input type="date" data-reconciliation-history-filter="dateFrom" value="${esc(filters.dateFrom)}"></label>
        <label class="compact-inline-field"><span>Hasta</span><input type="date" data-reconciliation-history-filter="dateTo" value="${esc(filters.dateTo)}"></label>
        <label class="compact-inline-field"><span>Cuenta</span><select data-reconciliation-history-filter="bankAccountId"><option value="">Todas</option>${accounts.map(item => `<option value="${esc(item.id)}" ${filters.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} · ${esc(item.bankName)}</option>`).join("")}</select></label>
        <label class="compact-inline-field"><span>Estado</span><select data-reconciliation-history-filter="status"><option value="">Todos</option>${["OPEN","IN_REVIEW","CLOSED","REOPENED","CANCELLED"].map(value => `<option value="${value}" ${filters.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label class="compact-inline-field"><span>Número</span><input data-reconciliation-history-filter="reference" value="${esc(filters.reference)}"></label>
        <label class="compact-inline-field"><span>Buscar</span><input data-reconciliation-history-filter="search" value="${esc(filters.search)}"></label>
        <label class="compact-inline-field"><span>Filas</span><select data-reconciliation-history-page-size><option value="25" ${Number(uiState.reconciliation.historyPageSize) === 25 ? "selected" : ""}>25</option><option value="50" ${Number(uiState.reconciliation.historyPageSize) === 50 ? "selected" : ""}>50</option></select></label>
        <button class="primary-button" type="button" data-reconciliation-history-query ${read.loading ? "disabled" : ""}>${read.loading ? "Consultando..." : "Consultar"}</button>
      </div></section>
      <article class="panel-card reconciliation-history-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Historial de conciliaciones</h3>
          </div>
           <span class="status-badge partial">${read.loaded ? esc(String(read.total)) : "0"} registros</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-reconciliation-history">
            <thead><tr><th>Fecha</th><th>Banco</th><th>Estado</th><th>Saldo final</th><th>Acciones</th></tr></thead>
            <tbody>
              ${history.map(item => {
                const account = bankService.findBankAccountById(item.bank_account_id || item.bankAccountId);
                return `
                  <tr>
                    <td><strong>${esc(reconciliationDateLabel(item.closed_at || item.updated_at))}</strong><small>${esc(item.period_start && item.period_end ? `${item.period_start} — ${item.period_end}` : "Sin período")}</small></td>
                    <td>${esc(account ? `${account.bankName} · ${account.code}` : `${item.bank_name || ""} · ${item.account_code || ""}`)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td><strong>${money(item.bank_closing_balance || 0)}</strong></td>
                    <td><div class="row-actions">
                      <button class="row-action-button" type="button" data-reconciliation-modify="${esc(item.id)}">Ver / modificar</button>
                      <button class="row-action-button danger" type="button" data-reconciliation-delete="${esc(item.id)}">Eliminar</button>
                    </div></td>
                  </tr>`;
              }).join("") || `<tr><td colspan="5"><div class="empty-inline">${read.loaded ? "No existen conciliaciones para los filtros aplicados." : "Selecciona filtros y pulsa Consultar."}</div></td></tr>`}
            </tbody>
          </table>
        </div>
        ${read.loaded && read.total > read.pageSize ? `<div class="pagination-bar"><button class="secondary-button" data-reconciliation-history-page="${read.page - 1}" ${read.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${read.page} de ${Math.ceil(read.total / read.pageSize)}</span><button class="secondary-button" data-reconciliation-history-page="${read.page + 1}" ${read.page * read.pageSize >= read.total ? "disabled" : ""}>Siguiente</button></div>` : ""}
      </article>
    `;
    bindReconciliationHistory();
  }

  function renderReconciliationWorkspace(container, route) {
    const current = activeReconciliationDraft();
    const readWorkspace = treasuryReadService()?.snapshot?.()?.workspace || { loaded:false,loading:false,data:null };
    const data = readWorkspace.data || {};
    const normalizedMatches = (data.matches || []).map(match => ({
      id: match.reconciliation_match_id || match.id,
      systemMovementIds: [`${match.source_type || match.sourceType}:${match.source_id || match.sourceId}`],
      statementMovementIds: [match.bank_transaction_id || match.bankTransactionId],
      amount: Number(match.amount || 0), createdAt: match.created_at || match.createdAt || ""
    }));
    const draftBase = { ...current, matches: normalizedMatches };
    const systemRows = (data.systemRows || []).map(row => ({ ...row, id: row.id || `${row.sourceType}:${row.sourceId}` }));
    const statementRows = (data.statementRows || []).map(row => ({ ...row, id: row.id || row.bankTransactionId }));
    const systemIncome = Number(data.summary?.systemIncome || 0), systemExpense = Number(data.summary?.systemExpense || 0);
    const bankIncome = Number(data.summary?.bankIncome || 0), bankExpense = Number(data.summary?.bankExpense || 0);
    const context = {
      reconciliation: draftBase,
      systemRows,
      statementRows,
      totals: { difference: Number(draftBase.closingBankBalance || 0) - (Number(draftBase.openingBankBalance || 0) + systemIncome - systemExpense), systemIncome, systemExpense, bankIncome, bankExpense },
      account: bankService.findBankAccountById(draftBase.bankAccountId)
    };
    const totals = context.totals;
    const draft = context.reconciliation;
    const accounts = bankService.bankAccounts().filter(item => item.status === "activa");
    const accountResolution = reconciliationAccountResolution(draft.bankAccountId);
    const accountNeedsConfirmation = Boolean(draft.bankAccountId && !accountResolution.ok);
    const hasClosedStatus = draft.status === "CERRADA";
    const pendingSystem = context.systemRows.filter(item => item.lineState !== "conciliado");
    const pendingBank = context.statementRows.filter(item => item.lineState !== "conciliado");
    const selectedSystemIds = new Set(uiState.reconciliation.selectedSystemIds || []);
    const selectedStatementIds = new Set(uiState.reconciliation.selectedStatementIds || []);

    const reconciledRows = draft.matches.map(match => {
      const systemIds = match.systemMovementIds || (match.systemMovementId ? [match.systemMovementId] : []);
      const statementIds = match.statementMovementIds || (match.statementMovementId ? [match.statementMovementId] : []);
      const systemRows = systemIds.map(id => context.systemRows.find(item => item.id === id)).filter(Boolean);
      const statementRows = statementIds.map(id => context.statementRows.find(item => item.id === id)).filter(Boolean);
      const systemTotal = systemRows.reduce((sum, item) => sum + systemMovementNet(item), 0);
      const bankTotal = statementRows.reduce((sum, item) => sum + Number(item.netValue || 0), 0);
      const systemText = systemRows.map(item => `${item.reference || item.movementNumber}: ${item.concept || "Movimiento"}`).join(" · ");
      const bankText = statementRows.map(item => `${item.reference || item.statementNumber}: ${item.description || "Movimiento bancario"}`).join(" · ");
      return `
        <tr>
          <td>${esc(reconciliationDateLabel(match.createdAt))}</td>
          <td>${esc(systemText || systemIds.join(", "))}</td>
          <td><strong>${money(systemTotal)}</strong></td>
          <td>${esc(bankText || statementIds.join(", "))}</td>
          <td><strong>${money(bankTotal)}</strong></td>
          <td>${statusBadge("Conciliado")}</td>
          <td><button class="row-action-button" type="button" data-reconciliation-undo="${esc(match.id)}" ${hasClosedStatus ? "disabled" : ""}>Deshacer</button></td>
        </tr>`;
    }).join("");

    container.innerHTML = `
      <section class="page-header reconciliation-workspace-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Conciliación bancaria</h1>
          <p>Compare movimientos contables del sistema con el estado de cuenta importado.</p>
        </div>
        <div class="editor-actions">
          <button class="secondary-button" type="button" data-reconciliation-back>← Historial</button>
          <button class="primary-button" type="button" data-reconciliation-load ${readWorkspace.loading ? "disabled" : ""}>${readWorkspace.loading ? "Cargando..." : "Cargar conciliación"}</button>
          <button class="secondary-button" type="button" data-reconciliation-save>Guardar cambios</button>
          ${hasClosedStatus
            ? `<button class="secondary-button" type="button" data-reconciliation-reopen>Reabrir</button>`
            : `<button class="secondary-button" type="button" data-reconciliation-close ${accountResolution.ok ? "" : "disabled"}>Cerrar conciliación</button>`}
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.reconciliation.message ? `<section class="inline-feedback success">${esc(uiState.reconciliation.message)}</section>` : ""}
      ${uiState.reconciliation.errors.length ? `<section class="inline-feedback danger">${uiState.reconciliation.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${!readWorkspace.loaded ? `<section class="inline-feedback"><strong>Workspace sin cargar.</strong> Selecciona cuenta y período, luego pulsa Cargar conciliación. No se consultan movimientos al abrir.</section>` : ""}
      <section class="panel-card reconciliation-config-card">
        <form id="bank-reconciliation-form" class="compact-form-grid reconciliation-config-grid">
          <label class="compact-field"><span>Cuenta bancaria</span><select name="bankAccountId" id="reconciliation-bank-account" ${hasClosedStatus ? "disabled" : ""}>
            <option value="">Seleccionar cuenta</option>
            ${accounts.map(item => `<option value="${esc(item.id)}" ${draft.bankAccountId === item.id || draft.bankAccountId === item.legacyId ? "selected" : ""}>${esc(reconciliationAccountLabel(item))}</option>`).join("")}
          </select></label>
          <label class="compact-field"><span>Período</span><input name="period" id="reconciliation-period" type="month" value="${esc(draft.period || "")}" ${hasClosedStatus ? "disabled" : ""}></label>
          <input name="dateFrom" type="hidden" value="${esc(draft.dateFrom || "")}">
          <input name="dateTo" type="hidden" value="${esc(draft.dateTo || "")}">
          <label class="compact-field"><span>Saldo inicial banco</span><input name="openingBankBalance" type="number" step="0.01" value="${esc(String(draft.openingBankBalance || 0))}" ${hasClosedStatus ? "disabled" : ""}></label>
          <label class="compact-field"><span>Saldo según banco</span><input name="closingBankBalance" type="number" step="0.01" value="${esc(String(draft.closingBankBalance || 0))}" ${hasClosedStatus ? "disabled" : ""}></label>
          <label class="compact-field full"><span>Notas</span><input name="notes" value="${esc(draft.notes || "")}" ${hasClosedStatus ? "disabled" : ""}></label>
          <label class="compact-field full"><span>Justificación de diferencia</span><input name="differenceJustification" value="${esc(draft.differenceJustification || "")}" placeholder="Obligatoria únicamente si se cierra con diferencia" ${hasClosedStatus ? "disabled" : ""}></label>
        </form>
        ${accountNeedsConfirmation ? `<div class="inline-feedback warning"><strong>Cuenta pendiente de confirmar.</strong> Esta cuenta conserva un identificador histórico y todavía no puede operar en Conciliación V2. <button class="secondary-button" type="button" data-reconciliation-confirm-account>Confirmar / vincular cuenta</button></div>` : ""}
      </section>
      <section class="reconciliation-summary-grid">
        <article><span>Cuenta bancaria</span><strong>${esc(context.account ? `${context.account.bankName} · ${context.account.code}` : "Sin seleccionar")}</strong></article>
        <article><span>Período</span><strong>${esc(draft.dateFrom)} — ${esc(draft.dateTo)}</strong></article>
        <article><span>Mes conciliación</span><strong>${esc(reconciliationMonthLabel(draft.period))}</strong></article>
        <article><span>Saldo inicial banco</span><strong>${money(draft.openingBankBalance || 0)}</strong></article>
        <article><span>Saldo según banco</span><strong>${money(draft.closingBankBalance || 0)}</strong></article>
        <article class="difference"><span>Diferencia pendiente</span><strong>${money(totals.difference || 0)}</strong></article>
      </section>
      <section class="reconciliation-import-toolbar">
        <div><strong>Estado de cuenta bancario</strong><small>El archivo alimenta únicamente el panel derecho y no genera asientos contables.</small></div>
        <div class="editor-actions">
          <button class="secondary-button" type="button" data-statement-template>Descargar formato XLSX</button>
          <button class="primary-button" type="button" data-statement-import ${hasClosedStatus || !accountResolution.ok ? "disabled" : ""}>Cargar estado de cuenta Excel</button>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-statement-file hidden>
          <button class="secondary-button" type="button" data-reconciliation-refresh>Actualizar movimientos del sistema</button>
        </div>
      </section>
      <section class="reconciliation-workspace-grid">
        <article class="reconciliation-side-panel">
          <header><div><h3>Movimientos del sistema</h3><small>Libro Diario/Mayor, cobros, pagos y asientos que afectan la cuenta.</small></div><span class="count-pill" data-system-selection-count>${selectedSystemIds.size} seleccionados</span></header>
          <div class="compact-table-wrap reconciliation-scroll-table"><table class="compact-table reconciliation-pending-table">
            <thead><tr><th>Sel.</th><th>Fecha</th><th>Descripción</th><th>Referencia</th><th>Origen</th><th>Tipo + / -</th><th>Valor</th></tr></thead>
            <tbody>${pendingSystem.map(item => {
              const value = systemMovementNet(item);
              return `<tr><td><input type="checkbox" data-reconciliation-system-check="${esc(item.id)}" ${selectedSystemIds.has(item.id) ? "checked" : ""} ${hasClosedStatus ? "disabled" : ""}></td><td>${esc(item.movementDate)}</td><td>${esc(item.concept || "-")}</td><td>${esc(item.reference || item.movementNumber || "-")}</td><td>${esc(item.originLabel || item.originModule || "-")}</td><td>${movementTypeCell(value)}</td><td><strong>${money(Math.abs(value))}</strong></td></tr>`;
            }).join("") || `<tr><td colspan="7"><div class="empty-inline">No existen movimientos pendientes del sistema para esta cuenta y período.</div></td></tr>`}</tbody>
          </table></div>
        </article>
        <div class="reconciliation-center-action">
          <button class="reconciliation-main-button" type="button" data-reconciliation-link-group ${selectedSystemIds.size && selectedStatementIds.size && !hasClosedStatus ? "" : "disabled"}><span>⇄</span>CONCILIAR</button>
        </div>
        <article class="reconciliation-side-panel">
          <header><div><h3>Estado de cuenta bancario</h3><small>Movimientos provenientes exclusivamente del Excel importado.</small></div><span class="count-pill" data-bank-selection-count>${selectedStatementIds.size} seleccionados</span></header>
          <div class="compact-table-wrap reconciliation-scroll-table"><table class="compact-table reconciliation-pending-table">
            <thead><tr><th>Sel.</th><th>Fecha</th><th>Descripción</th><th>Referencia</th><th>Tipo + / -</th><th>Valor</th></tr></thead>
            <tbody>${pendingBank.map(item => {
              const value = Number(item.netValue || 0);
              return `<tr><td><input type="checkbox" data-reconciliation-bank-check="${esc(item.id)}" ${selectedStatementIds.has(item.id) ? "checked" : ""} ${hasClosedStatus ? "disabled" : ""}></td><td>${esc(item.movementDate)}</td><td>${esc(item.description || "-")}</td><td>${esc(item.reference || item.statementNumber || "-")}</td><td>${movementTypeCell(value)}</td><td><strong>${money(Math.abs(value))}</strong></td></tr>`;
            }).join("") || `<tr><td colspan="6"><div class="empty-inline">Importe un estado de cuenta o revise el período seleccionado.</div></td></tr>`}</tbody>
          </table></div>
        </article>
      </section>
      <article class="panel-card reconciliation-completed-card">
        <div class="panel-card-head"><div><p class="section-kicker">CONCILIADOS</p><h3>Movimientos conciliados</h3><p>Las relaciones conservan sus movimientos originales y pueden deshacerse.</p></div><span class="count-pill">${draft.matches.length} conciliaciones</span></div>
        <div class="compact-table-wrap"><table class="compact-table compact-table-reconciled">
          <thead><tr><th>Fecha conciliación</th><th>Movimientos del sistema</th><th>Total sistema</th><th>Movimientos del banco</th><th>Total banco</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>${reconciledRows || `<tr><td colspan="7"><div class="empty-inline">Aún no existen movimientos conciliados.</div></td></tr>`}</tbody>
        </table></div>
      </article>
    `;
    bindReconciliationWorkspace();
  }

  function renderReconciliation(container, route) {
    if (uiState.reconciliation.viewMode === "workspace") renderReconciliationWorkspace(container, route);
    else renderReconciliationHistory(container, route);
  }

  function bindReconciliationHistory() {
    document.querySelectorAll("[data-reconciliation-history-filter]").forEach(input => input.addEventListener("input", () => {
      uiState.reconciliation.historyFilters[input.dataset.reconciliationHistoryFilter] = input.value;
    }));
    document.querySelector("[data-reconciliation-history-page-size]")?.addEventListener("change", event => {
      uiState.reconciliation.historyPageSize = Number(event.target.value || 25);
    });
    document.querySelector("[data-reconciliation-history-query]")?.addEventListener("click", async () => {
      uiState.reconciliation.errors = [];
      try { await treasuryReadService()?.queryHistory?.(uiState.reconciliation.historyFilters, { page: 1, pageSize: uiState.reconciliation.historyPageSize }); }
      catch (error) { uiState.reconciliation.errors = [error.message]; }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-reconciliation-history-page]").forEach(button => button.addEventListener("click", async () => {
      const read = treasuryReadService()?.snapshot?.()?.history;
      try { await treasuryReadService()?.queryHistory?.(read?.appliedFilters, { page: Number(button.dataset.reconciliationHistoryPage), pageSize: read?.pageSize }); }
      catch (error) { uiState.reconciliation.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-reconciliation-new-workspace]")?.addEventListener("click", () => {
      ensureReconciliationDraft(null);
      treasuryReadService()?.invalidateWorkspace?.();
      uiState.reconciliation.viewMode = "workspace";
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-reconciliation-modify]").forEach(button => button.addEventListener("click", async () => {
      try {
        const state = await treasuryReadService()?.loadDetail?.(button.dataset.reconciliationModify);
        const raw = state?.workspace?.data?.reconciliation || {};
        const target = {
          id: raw.reconciliation_id || button.dataset.reconciliationModify,
          reconciliationId: raw.reconciliation_id || button.dataset.reconciliationModify,
          reconciliationNumber: raw.reconciliation_code || "",
          bankAccountId: raw.bank_account_id || "",
          dateFrom: raw.period_start || "",
          dateTo: raw.period_end || "",
          period: String(raw.period_start || "").slice(0,7),
          openingBankBalance: Number(raw.bank_opening_balance || 0), closingBankBalance: Number(raw.bank_closing_balance || 0),
          bookClosingBalance: Number(raw.book_closing_balance || 0), difference: Number(raw.difference || 0),
          status: ({OPEN:"BORRADOR",IN_REVIEW:"EN_REVISION",CLOSED:"CERRADA",REOPENED:"REABIERTA",CANCELLED:"ANULADA"})[raw.status] || raw.status,
          notes: raw.notes || "", version: Number(raw.version || 0), matches: [], systemReviews: [], statementReviews: []
        };
        ensureReconciliationDraft(target); uiState.reconciliation.viewMode = "workspace";
      } catch (error) { uiState.reconciliation.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-reconciliation-delete]").forEach(button => button.addEventListener("click", async () => {
      const result = await reconciliationService.deleteReconciliation(button.dataset.reconciliationDelete);
      uiState.reconciliation.errors = result?.errors || [];
      uiState.reconciliation.message = result?.ok ? "Conciliación eliminada." : "";
      BlessERP.layout.renderPage();
    }));
  }

  function updateReconciliationSelectionUi() {
    const systemCount = (uiState.reconciliation.selectedSystemIds || []).length;
    const bankCount = (uiState.reconciliation.selectedStatementIds || []).length;
    const systemLabel = document.querySelector("[data-system-selection-count]");
    const bankLabel = document.querySelector("[data-bank-selection-count]");
    const button = document.querySelector("[data-reconciliation-link-group]");
    if (systemLabel) systemLabel.textContent = `${systemCount} seleccionados`;
    if (bankLabel) bankLabel.textContent = `${bankCount} seleccionados`;
    if (button) button.disabled = !(systemCount && bankCount);
  }

  function bindReconciliationWorkspace() {
    document.querySelector("[data-reconciliation-back]")?.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      uiState.reconciliation.viewMode = "history";
      uiState.reconciliation.message = "";
      uiState.reconciliation.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("#reconciliation-bank-account")?.addEventListener("change", event => {
      syncReconciliationDraftFromDom();
      uiState.reconciliation.draft.bankAccountId = event.target.value || "";
      uiState.reconciliation.selectedSystemIds = [];
      uiState.reconciliation.selectedStatementIds = [];
      treasuryReadService()?.invalidateWorkspace?.();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-confirm-account]")?.addEventListener("click", async event => {
      syncReconciliationDraftFromDom();
      const legacyId = uiState.reconciliation.draft?.bankAccountId || "";
      const button = event.currentTarget;
      button.disabled = true;
      const result = await bankService.confirmCanonicalBankAccount(legacyId);
      uiState.reconciliation.errors = result?.errors || [];
      uiState.reconciliation.message = "";
      if (result?.ok && result.account?.bankAccountId) {
        uiState.reconciliation.draft.bankAccountId = result.account.bankAccountId;
        ensureStatementDraft(null, result.account.bankAccountId);
        uiState.reconciliation.message = `Cuenta ${result.account.code} confirmada en Tesorería V2.`;
      }
      BlessERP.layout.renderPage();
    });
    document.querySelector("#reconciliation-period")?.addEventListener("change", event => {
      syncReconciliationDraftFromDom();
      const range = periodRange(event.target.value);
      uiState.reconciliation.draft.period = range.period;
      uiState.reconciliation.draft.dateFrom = range.dateFrom;
      uiState.reconciliation.draft.dateTo = range.dateTo;
      uiState.reconciliation.selectedSystemIds = [];
      uiState.reconciliation.selectedStatementIds = [];
      treasuryReadService()?.invalidateWorkspace?.();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-load]")?.addEventListener("click", async () => {
      syncReconciliationDraftFromDom();
      const draft = uiState.reconciliation.draft || {};
      uiState.reconciliation.errors = [];
      try {
        await treasuryReadService()?.loadWorkspace?.({ bankAccountId: draft.bankAccountId, dateFrom: draft.dateFrom, dateTo: draft.dateTo, reconciliationId: draft.id || "" });
      } catch (error) { uiState.reconciliation.errors = [error.message]; }
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-save]")?.addEventListener("click", async () => {
      const result = await persistReconciliationDraft();
      if (result.ok) uiState.reconciliation.message = "Conciliación guardada correctamente.";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-close]")?.addEventListener("click", async () => {
      let result = await persistReconciliationDraft();
      if (result.ok) result = await reconciliationService.closeReconciliation(result.reconciliation.id);
      uiState.reconciliation.errors = result.errors || [];
      if (result.ok) setReconciliationDraft(result.reconciliation, "Conciliación cerrada correctamente.");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-reopen]")?.addEventListener("click", async () => {
      const reason = window.prompt("Motivo de reapertura de la conciliación:", "Corrección de conciliación bancaria") || "";
      if (!reason.trim()) return;
      const result = await reconciliationService.reopenReconciliation(uiState.reconciliation.currentId, reason);
      uiState.reconciliation.errors = result.errors || [];
      if (result.ok) setReconciliationDraft(result.reconciliation, "Conciliación reabierta.");
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-reconciliation-system-check]").forEach(input => input.addEventListener("change", () => {
      const ids = new Set(uiState.reconciliation.selectedSystemIds || []);
      input.checked ? ids.add(input.dataset.reconciliationSystemCheck) : ids.delete(input.dataset.reconciliationSystemCheck);
      uiState.reconciliation.selectedSystemIds = [...ids];
      updateReconciliationSelectionUi();
    }));
    document.querySelectorAll("[data-reconciliation-bank-check]").forEach(input => input.addEventListener("change", () => {
      const ids = new Set(uiState.reconciliation.selectedStatementIds || []);
      input.checked ? ids.add(input.dataset.reconciliationBankCheck) : ids.delete(input.dataset.reconciliationBankCheck);
      uiState.reconciliation.selectedStatementIds = [...ids];
      updateReconciliationSelectionUi();
    }));
    document.querySelector("[data-reconciliation-link-group]")?.addEventListener("click", async () => {
      let result = await persistReconciliationDraft();
      if (result.ok) result = await reconciliationService.linkMatchGroup(
        result.reconciliation.id,
        uiState.reconciliation.selectedSystemIds,
        uiState.reconciliation.selectedStatementIds,
        "Selección múltiple confirmada desde conciliación bancaria."
      );
      uiState.reconciliation.errors = result.errors || [];
      if (result.ok) setReconciliationDraft(result.reconciliation, "Movimientos conciliados correctamente.");
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-reconciliation-undo]").forEach(button => button.addEventListener("click", async () => {
      if (!window.confirm("¿Deshacer esta conciliación? Los movimientos regresarán a pendientes y no se eliminará ningún asiento ni movimiento bancario.")) return;
      const result = await reconciliationService.unlinkMatchGroup(uiState.reconciliation.currentId, button.dataset.reconciliationUndo);
      uiState.reconciliation.errors = result.errors || [];
      if (result.ok) setReconciliationDraft(result.reconciliation, "Conciliación deshecha; los movimientos regresaron a pendientes.");
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-reconciliation-refresh]")?.addEventListener("click", async () => {
      syncReconciliationDraftFromDom();
      const draft = uiState.reconciliation.draft || {};
      try {
        await treasuryReadService()?.loadWorkspace?.({ bankAccountId: draft.bankAccountId, dateFrom: draft.dateFrom, dateTo: draft.dateTo, reconciliationId: draft.id || "" });
        uiState.reconciliation.message = "Movimientos actualizados desde Treasury V2.";
      } catch (error) { uiState.reconciliation.errors = [error.message]; }
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-statement-template]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const result = await BlessERP.services?.bankStatementXlsx?.generateTemplate?.();
      button.disabled = false;
      uiState.reconciliation.errors = result?.errors || [];
      uiState.reconciliation.message = result?.ok ? `Formato ${result.fileName} descargado.` : "";
      if (!result?.ok) BlessERP.layout.renderPage();
    });
    const fileInput = document.querySelector("[data-statement-file]");
    document.querySelector("[data-statement-import]")?.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      if (!uiState.reconciliation.draft?.bankAccountId) {
        uiState.reconciliation.errors = ["Seleccione primero la cuenta bancaria."];
        BlessERP.layout.renderPage();
        return;
      }
      const resolution = reconciliationAccountResolution();
      if (!resolution.ok) {
        uiState.reconciliation.errors = ["La cuenta seleccionada debe confirmarse en Tesorería V2 antes de importar el estado de cuenta."];
        BlessERP.layout.renderPage();
        return;
      }
      fileInput?.click();
    });
    fileInput?.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      syncReconciliationDraftFromDom();
      const resolution = reconciliationAccountResolution();
      if (!resolution.ok) {
        uiState.reconciliation.errors = ["La cuenta seleccionada debe confirmarse en Tesorería V2 antes de importar el estado de cuenta."];
        event.target.value = "";
        BlessERP.layout.renderPage();
        return;
      }
      const result = await BlessERP.services?.bankStatementXlsx?.importFile?.(file, { bankAccountId: resolution.bankAccountId });
      uiState.reconciliation.errors = result?.errors || [];
      uiState.reconciliation.message = result?.ok ? `${result.imported} movimiento(s) importado(s) desde ${file.name}.` : "";
      event.target.value = "";
      BlessERP.layout.renderPage();
    });
  }

  function treasuryAccountOptions() {
    return [
      ...bankService.bankAccounts().filter(row => row.status === "activa").map(row => ({ value:`BANK|${row.id}`,label:`Banco · ${row.code} · ${row.bankName}` })),
      ...(BlessERP.services?.treasuryV2?.cashAccounts?.() || []).filter(row => row.status === "ACTIVE").map(row => ({ value:`CASH|${row.id}`,label:`Caja · ${row.code} · ${row.name}` }))
    ];
  }

  function renderCashAccounts(container, route) {
    const service=BlessERP.services?.treasuryV2; const rows=service?.cashAccounts?.() || []; const draft=uiState.treasury.cashDraft;
    const ledgerOptions=chartService.movementOptions();
    container.innerHTML=`
      <section class="page-header"><div><p class="section-kicker">BANCOS / CAJA</p><h1>Cuentas de caja</h1><p>El saldo se deriva del saldo inicial y movimientos confirmados; no se edita directamente.</p></div></section>
      ${routeTabs(route)}
      ${uiState.treasury.message?`<section class="inline-feedback success">${esc(uiState.treasury.message)}</section>`:""}
      ${uiState.treasury.errors.length?`<section class="inline-feedback danger">${uiState.treasury.errors.map(esc).join("<br>")}</section>`:""}
      <section class="panel-card compact-toolbar-card"><button class="secondary-button" data-cash-new>Nueva caja</button></section>
      ${draft?`<article class="panel-card"><div class="panel-card-head"><h3>${draft.id?"Editar":"Nueva"} caja</h3><div><button class="secondary-button" data-cash-cancel>Cancelar</button> <button class="primary-button" data-cash-save>Guardar y confirmar</button></div></div>
        <form id="cash-account-form" class="compact-form-grid">
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(draft.name||"")}"></label>
          <label class="compact-field"><span>Moneda</span><input name="currency" value="${esc(draft.currency||"USD")}"></label>
          <label class="compact-field"><span>Cuenta contable</span><select name="linkedAccountCode"><option value="">Seleccionar</option>${ledgerOptions.map(row=>`<option value="${esc(row.code)}" ${draft.linkedAccountCode===row.code?"selected":""}>${esc(row.code)} - ${esc(row.name)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Saldo inicial</span><input type="number" step="0.01" name="openingBalance" value="${esc(String(draft.openingBalance||0))}" ${draft.id?"disabled":""}></label>
          <label class="compact-field"><span>Fecha inicial</span><input type="date" name="openingBalanceDate" value="${esc(draft.openingBalanceDate||new Date().toISOString().slice(0,10))}" ${draft.id?"disabled":""}></label>
          <label class="compact-field"><span>Estado</span><select name="status"><option>ACTIVE</option><option ${draft.status==="INACTIVE"?"selected":""}>INACTIVE</option></select></label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation">${esc(draft.observation||"")}</textarea></label>
        </form></article>`:""}
      <article class="panel-card"><div class="panel-card-head"><h3>Cajas confirmadas</h3><span class="status-badge partial">${rows.length}</span></div><div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Codigo</th><th>Nombre</th><th>Moneda</th><th>Cuenta contable</th><th>Saldo inicial</th><th>Estado</th><th>Accion</th></tr></thead><tbody>
        ${rows.map(row=>`<tr><td><strong>${esc(row.code)}</strong></td><td>${esc(row.name)}</td><td>${esc(row.currency)}</td><td>${esc(row.linkedAccountCode)}</td><td>${money(row.openingBalance)}</td><td>${statusBadge(row.status)}</td><td><button class="row-action-button" data-cash-edit="${esc(row.id)}">Editar</button></td></tr>`).join("")||`<tr><td colspan="7">Sin cajas V2 confirmadas.</td></tr>`}
      </tbody></table></div></article>`;
    document.querySelector("[data-cash-new]")?.addEventListener("click",()=>{uiState.treasury.cashDraft={status:"ACTIVE",currency:"USD",openingBalance:0,openingBalanceDate:new Date().toISOString().slice(0,10)};BlessERP.layout.renderPage();});
    document.querySelector("[data-cash-cancel]")?.addEventListener("click",()=>{uiState.treasury.cashDraft=null;BlessERP.layout.renderPage();});
    document.querySelectorAll("[data-cash-edit]").forEach(button=>button.addEventListener("click",()=>{uiState.treasury.cashDraft=clone(rows.find(row=>row.id===button.dataset.cashEdit));BlessERP.layout.renderPage();}));
    document.querySelector("[data-cash-save]")?.addEventListener("click",async event=>{event.currentTarget.disabled=true;const form=document.querySelector("#cash-account-form");const candidate={...draft,name:form.elements.name.value,currency:form.elements.currency.value,
      linkedAccountCode:form.elements.linkedAccountCode.value,openingBalance:Number(form.elements.openingBalance.value||0),openingBalanceDate:form.elements.openingBalanceDate.value,status:form.elements.status.value,observation:form.elements.observation.value};
      const result=await service.upsertCashAccount(candidate);uiState.treasury.errors=result.errors||[];uiState.treasury.message=result.ok?`Caja ${result.account.code} confirmada en Supabase.`:"";if(result.ok)uiState.treasury.cashDraft=null;BlessERP.layout.renderPage();});
  }

  function renderTransfers(container, route) {
    const service = BlessERP.services?.treasuryV2;
    const readService = treasuryReadService();
    const readRuntime = readService?.snapshot?.() || {};
    const read = readRuntime.transfers || { loaded:false,loading:false,items:[],total:0,page:1,pageSize:25,detail:null };
    const options = treasuryAccountOptions();
    const draft = uiState.treasury.transferDraft || { transferDate:BlessERP.utils.today(),currency:"USD",amount:0 };
    const filters = uiState.treasury.transferHistoryFilters;
    const isHistory = uiState.treasury.transferViewMode === "history";
    const detail = read.detail || null;
    const detailTransfer = detail?.transfer || {};
    const detailMovements = detail?.movements || [];
    const detailJournal = detail?.journal || {};
    const accountOptions = selected => options.map(row => `<option value="${esc(row.value)}" ${selected === row.value ? "selected" : ""}>${esc(row.label)}</option>`).join("");

    container.innerHTML = `
      <section class="page-header"><div><p class="section-kicker">TESORERIA</p><h1>Transferencias</h1><p>Banco ↔ banco y banco ↔ caja en una sola transacción con asiento confirmado.</p></div></section>
      ${routeTabs(route)}
      ${uiState.treasury.message ? `<section class="inline-feedback success">${esc(uiState.treasury.message)}</section>` : ""}
      ${uiState.treasury.errors.length ? `<section class="inline-feedback danger">${uiState.treasury.errors.map(esc).join("<br>")}</section>` : ""}
      ${readRuntime.transferError ? `<section class="inline-feedback danger">${esc(readRuntime.transferError)} No se utilizará el histórico local como fallback.</section>` : ""}
      <div class="subnav-tabs">
        <button class="subnav-tab ${isHistory ? "" : "active"}" type="button" data-transfer-view="form">Nueva transferencia</button>
        <button class="subnav-tab ${isHistory ? "active" : ""}" type="button" data-transfer-view="history">Historial</button>
      </div>
      ${!isHistory ? `
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">OPERACIÓN</p><h3>Transferencia bancaria</h3></div></div>
          <form id="treasury-transfer-form" class="compact-form-grid">
            <label class="compact-field"><span>Fecha efectiva</span><input type="date" name="transferDate" value="${esc(draft.transferDate)}"></label>
            <label class="compact-field"><span>Cuenta origen</span><select name="source"><option value="">Seleccionar</option>${accountOptions(draft.source || "")}</select></label>
            <label class="compact-field"><span>Cuenta destino</span><select name="destination"><option value="">Seleccionar</option>${accountOptions(draft.destination || "")}</select></label>
            <label class="compact-field"><span>Valor</span><input type="number" min="0.01" step="0.01" name="amount" value="${esc(String(draft.amount || 0))}"></label>
            <label class="compact-field"><span>Moneda</span><input name="currency" value="${esc(draft.currency || "USD")}"></label>
            <label class="compact-field"><span>Referencia</span><input name="reference" value="${esc(draft.reference || "")}"></label>
            <label class="compact-field full"><span>Observación</span><textarea name="notes">${esc(draft.notes || "")}</textarea></label>
          </form>
          <div class="editor-actions"><button class="primary-button" type="button" data-transfer-confirm>Confirmar transferencia</button></div>
        </article>
      ` : `
        <section class="panel-card compact-toolbar-card">
          <div class="compact-toolbar">
            <label class="compact-inline-field"><span>Desde</span><input id="transfer-history-from" type="date" value="${esc(filters.dateFrom)}"></label>
            <label class="compact-inline-field"><span>Hasta</span><input id="transfer-history-to" type="date" value="${esc(filters.dateTo)}"></label>
            <label class="compact-inline-field"><span>Cuenta origen</span><select id="transfer-history-source"><option value="">Todas</option>${accountOptions(filters.source)}</select></label>
            <label class="compact-inline-field"><span>Cuenta destino</span><select id="transfer-history-destination"><option value="">Todas</option>${accountOptions(filters.destination)}</select></label>
            <label class="compact-inline-field"><span>Estado</span><select id="transfer-history-status"><option value="">Todos</option><option value="CONFIRMED" ${filters.status === "CONFIRMED" ? "selected" : ""}>Confirmada</option><option value="REVERSED" ${filters.status === "REVERSED" ? "selected" : ""}>Reversada</option></select></label>
            <label class="compact-inline-field"><span>Número / referencia</span><input id="transfer-history-reference" value="${esc(filters.reference)}"></label>
            <label class="compact-inline-field"><span>Buscar</span><input id="transfer-history-search" placeholder="Cuenta, nota o asiento" value="${esc(filters.search)}"></label>
            <label class="compact-inline-field"><span>Filas</span><select id="transfer-history-page-size"><option value="25" ${Number(uiState.treasury.transferHistoryPageSize) === 25 ? "selected" : ""}>25</option><option value="50" ${Number(uiState.treasury.transferHistoryPageSize) === 50 ? "selected" : ""}>50</option></select></label>
            <button class="primary-button" type="button" data-transfer-query ${read.loading ? "disabled" : ""}>${read.loading ? "Consultando..." : "Consultar"}</button>
          </div>
        </section>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">HISTORIAL</p><h3>Transferencias confirmadas</h3></div><span class="status-badge partial">${read.loaded ? esc(String(read.total)) : "0"} registros</span></div>
          <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Número</th><th>Fecha efectiva</th><th>Origen</th><th>Destino</th><th>Referencia</th><th>Valor</th><th>Estado</th><th>Asiento</th><th>Acción</th></tr></thead><tbody>
            ${(read.items || []).map(row => `<tr><td><strong>${esc(row.transferNumber)}</strong></td><td>${esc(row.transferDate)}</td><td>${esc(row.sourceAccountLabel)}</td><td>${esc(row.destinationAccountLabel)}</td><td>${esc(row.reference || "-")}</td><td>${money(row.amount)} ${esc(row.currencyCode || row.currency || "USD")}</td><td>${statusBadge(row.status)}</td><td>${esc(row.journalEntryNumber || "-")}</td><td><button class="row-action-button" type="button" data-transfer-detail="${esc(row.id)}">Ver detalle</button></td></tr>`).join("") || `<tr><td colspan="9"><div class="empty-inline">${read.loaded ? "No hay transferencias para los filtros aplicados." : "Selecciona filtros y pulsa Consultar."}</div></td></tr>`}
          </tbody></table></div>
          ${read.loaded && read.total > read.pageSize ? `<div class="pagination-bar"><button class="secondary-button" type="button" data-transfer-page="${read.page - 1}" ${read.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${read.page} · ${Math.min((read.page - 1) * read.pageSize + 1, read.total)}–${Math.min(read.page * read.pageSize, read.total)} de ${read.total}</span><button class="secondary-button" type="button" data-transfer-page="${read.page + 1}" ${read.page * read.pageSize >= read.total ? "disabled" : ""}>Siguiente</button></div>` : ""}
        </article>
      `}
      ${detail ? `
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">DETALLE LAZY</p><h3>${esc(detailTransfer.transferNumber || detailTransfer.transfer_code || "Transferencia")}</h3></div><button class="secondary-button" type="button" data-transfer-detail-close>Cerrar</button></div>
          <div class="info-stack">
            <div class="info-row"><strong>Origen</strong><span>${esc(detailTransfer.sourceAccount?.code || "")} · ${esc(detailTransfer.sourceAccount?.name || "")}</span></div>
            <div class="info-row"><strong>Destino</strong><span>${esc(detailTransfer.destinationAccount?.code || "")} · ${esc(detailTransfer.destinationAccount?.name || "")}</span></div>
            <div class="info-row"><strong>Referencia</strong><span>${esc(detailTransfer.reference || "-")}</span></div>
            <div class="info-row"><strong>Movimientos Treasury</strong><span>${esc(String(detailMovements.length))} (${detailMovements.map(row => `${row.direction} ${row.account_type}`).join(" · ")})</span></div>
            <div class="info-row"><strong>Asiento</strong><span>${esc(detailJournal.entry_number || "No vinculado")} · ${esc(String((detailJournal.lines || []).length))} líneas</span></div>
          </div>
        </article>
      ` : ""}
    `;

    document.querySelectorAll("[data-transfer-view]").forEach(button => button.addEventListener("click", () => {
      uiState.treasury.transferViewMode = button.dataset.transferView;
      readService?.closeTransferDetail?.();
      BlessERP.layout.renderPage();
    }));
    const bindFilter = (selector, key, eventName = "change") => document.querySelector(selector)?.addEventListener(eventName, event => { filters[key] = event.target.value; });
    bindFilter("#transfer-history-from", "dateFrom"); bindFilter("#transfer-history-to", "dateTo");
    bindFilter("#transfer-history-source", "source"); bindFilter("#transfer-history-destination", "destination");
    bindFilter("#transfer-history-status", "status"); bindFilter("#transfer-history-reference", "reference", "input"); bindFilter("#transfer-history-search", "search", "input");
    document.querySelector("#transfer-history-page-size")?.addEventListener("change", event => { uiState.treasury.transferHistoryPageSize = Number(event.target.value || 25); });
    document.querySelector("[data-transfer-query]")?.addEventListener("click", async () => {
      uiState.treasury.errors = [];
      const [sourceAccountType,sourceAccountId] = String(filters.source || "").split("|");
      const [destinationAccountType,destinationAccountId] = String(filters.destination || "").split("|");
      try { await readService?.queryTransfers?.({ ...clone(filters),sourceAccountType,sourceAccountId,destinationAccountType,destinationAccountId }, { page:1,pageSize:uiState.treasury.transferHistoryPageSize }); }
      catch (error) { uiState.treasury.errors = [error.message]; }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-transfer-page]").forEach(button => button.addEventListener("click", async () => {
      const state = readService?.snapshot?.()?.transfers;
      try { await readService?.queryTransfers?.(state?.appliedFilters, { page:Number(button.dataset.transferPage),pageSize:state?.pageSize }); }
      catch (error) { uiState.treasury.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-transfer-detail]").forEach(button => button.addEventListener("click", async () => {
      try { await readService?.loadTransferDetail?.(button.dataset.transferDetail); }
      catch (error) { uiState.treasury.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-transfer-detail-close]")?.addEventListener("click", () => { readService?.closeTransferDetail?.(); BlessERP.layout.renderPage(); });
    document.querySelector("[data-transfer-confirm]")?.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      const form = document.querySelector("#treasury-transfer-form");
      const [sourceAccountType,sourceAccountId] = String(form.elements.source.value || "").split("|");
      const [destinationAccountType,destinationAccountId] = String(form.elements.destination.value || "").split("|");
      const result = await service.createTransfer({ transferDate:form.elements.transferDate.value,sourceAccountType,sourceAccountId,destinationAccountType,destinationAccountId,amount:Number(form.elements.amount.value || 0),currencyCode:form.elements.currency.value,reference:form.elements.reference.value,notes:form.elements.notes.value });
      uiState.treasury.errors = result.errors || []; uiState.treasury.message = result.ok ? `Transferencia ${result.transfer.transferNumber} confirmada en Supabase.` : "";
      if (result.ok) {
        uiState.treasury.transferDraft = null;
        readService?.suppressTransferOperation?.(result.operationId);
        const history = readService?.snapshot?.()?.transfers;
        if (history?.loaded) {
          try { await readService.queryTransfers(history.appliedFilters, { page:history.page,pageSize:history.pageSize }); }
          catch (error) { uiState.treasury.errors = [error.message]; }
        }
      }
      BlessERP.layout.renderPage();
    });
  }

  function renderCashFlow(container, route) {
    const service=BlessERP.services?.treasuryV2; const bank=service?.bankTransactions?.() || [];const cash=service?.cashTransactions?.() || [];
    const rows=[...bank.map(row=>({...row,accountType:"BANK",flowKind:row.originType==="REAL_STATEMENT"?"REAL":"EXPECTED"})),...cash.map(row=>({...row,accountType:"CASH",flowKind:"REAL"}))]
      .sort((a,b)=>String(b.movementDate||"").localeCompare(String(a.movementDate||"")));
    const real=rows.filter(row=>row.flowKind==="REAL").reduce((sum,row)=>sum+(row.direction==="CREDIT"?1:-1)*Number(row.amount||0),0);
    const expected=rows.filter(row=>row.flowKind==="EXPECTED").reduce((sum,row)=>sum+(row.direction==="CREDIT"?1:-1)*Number(row.amount||0),0);
    container.innerHTML=`<section class="page-header"><div><p class="section-kicker">TESORERIA</p><h1>Flujo de efectivo</h1><p>Los movimientos reales se mantienen separados de cobros, pagos y transferencias esperadas.</p></div></section>${routeTabs(route)}
      <section class="summary-grid"><article class="summary-card"><span>Flujo real</span><strong>${money(real)}</strong></article><article class="summary-card"><span>Flujo esperado</span><strong>${money(expected)}</strong></article><article class="summary-card"><span>Movimientos</span><strong>${rows.length}</strong></article></section>
      <article class="panel-card"><div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha</th><th>Cuenta</th><th>Real/Esperado</th><th>Descripcion</th><th>Ingreso</th><th>Egreso</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.movementDate||row.transactionDate)}</td><td>${esc(row.accountType)}</td><td>${statusBadge(row.flowKind)}</td><td>${esc(row.concept||row.description||"")}</td><td>${money(row.direction==="CREDIT"?row.amount:0)}</td><td>${money(row.direction==="DEBIT"?row.amount:0)}</td></tr>`).join("")||`<tr><td colspan="6">Sin movimientos V2 confirmados.</td></tr>`}</tbody></table></div></article>`;
  }

  function render(container, route) {
    const readService = treasuryReadService();
    readService?.setActiveRoute?.(route.id);
    const readSnapshot = readService?.snapshot?.() || {};
    if (["banks-movements", "banks-reconciliation"].includes(route.id) && readService && !readSnapshot.started) {
      void readService.start(() => {
        const active = BlessERP.state?.currentRoute?.()?.id;
        if (["banks-movements", "banks-reconciliation"].includes(active)) BlessERP.layout.renderPage();
      });
    }
    if (route.id === "banks-transfers" && readService && !readSnapshot.transfersStarted) {
      void readService.startTransfers(() => {
        if (BlessERP.state?.currentRoute?.()?.id === "banks-transfers") BlessERP.layout.renderPage();
      });
    }
    if (route.id === "banks-accounts") {
      renderAccounts(container, route);
      return;
    }
    if (route.id === "banks-movements") {
      renderMovements(container, route);
      return;
    }
    if (route.id === "banks-cash") { renderCashAccounts(container,route); return; }
    if (route.id === "banks-transfers") { renderTransfers(container,route); return; }
    if (route.id === "banks-cash-flow") { renderCashFlow(container,route); return; }
    renderReconciliation(container, route);
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Banks = {
    render,
    ensureMovementDraft
  };
})();
