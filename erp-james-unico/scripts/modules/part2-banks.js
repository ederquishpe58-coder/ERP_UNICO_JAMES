(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const bankService = BlessERP.services.banks;
  const chartService = BlessERP.services.chartOfAccounts;
  const reconciliationService = BlessERP.services.bankReconciliation;
  const companyService = BlessERP.services.companySettings;

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
      draft: null,
      message: "",
      errors: []
    },
    reconciliation: {
      currentId: "",
      draft: null,
      statementDraft: null,
      selectedSystemId: "",
      selectedStatementId: "",
      message: "",
      errors: [],
      actionNote: "",
      reopenReason: ""
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
    return bankService.bankAccounts().find(item => item.status === "activa")?.id || "";
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
    uiState.reconciliation.selectedSystemId = "";
    uiState.reconciliation.selectedStatementId = "";
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
      const existing = uiState.reconciliation.currentId
        ? reconciliationService.findReconciliationById(uiState.reconciliation.currentId)
        : reconciliationService.reconciliations()[0];
      ensureReconciliationDraft(existing || null);
    }
    return uiState.reconciliation.draft;
  }

  function setReconciliationDraft(reconciliation, message = "") {
    uiState.reconciliation.currentId = reconciliation.id || "";
    uiState.reconciliation.draft = clone(reconciliation);
    uiState.reconciliation.message = message;
    uiState.reconciliation.errors = [];
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
            <label class="compact-field"><span>Saldo inicial</span><input name="openingBalance" type="number" min="0" step="0.01" value="${esc(String(draft.openingBalance || 0))}"></label>
            <label class="compact-field"><span>Fecha saldo inicial</span><input name="openingBalanceDate" type="date" value="${esc(draft.openingBalanceDate || "")}"></label>
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
    const rows = movementRows();
    const summary = bankService.dashboardSummary();
    const draft = uiState.movements.draft;
    const accounts = bankService.bankAccounts().filter(item => item.status === "activa");
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
      <section class="summary-grid summary-grid-banks">
        <article class="summary-card"><span>Ingresos contabilizados</span><strong>${money(summary.confirmedIncome)}</strong><small>Solo movimientos confirmados</small></article>
        <article class="summary-card"><span>Egresos contabilizados</span><strong>${money(summary.confirmedExpense)}</strong><small>Incluye pagos a proveedores</small></article>
        <article class="summary-card"><span>Saldo auxiliar</span><strong>${money(summary.totalAuxiliaryBalance)}</strong><small>Suma de cuentas activas</small></article>
        <article class="summary-card"><span>Borradores</span><strong>${esc(String(summary.draftMovements))}</strong><small>No afectan diario ni mayor</small></article>
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
              <option value="">Todas</option>
              ${bankService.bankAccounts().map(item => `<option value="${esc(item.id)}" ${uiState.movements.bankAccountId === item.id ? "selected" : ""}>${esc(item.code)} · ${esc(item.bankName)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="bank-movement-status-filter">
              <option value="">Todos</option>
              ${bankService.movementStates.map(item => `<option value="${esc(item)}" ${uiState.movements.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
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
          <span class="status-badge partial">${esc(String(rows.length))} registros</span>
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
              `).join("") || `<tr><td colspan="14"><div class="empty-inline">No hay movimientos bancarios para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindMovements();
  }

  function renderReconciliation(container, route) {
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
            <label class="compact-field"><span>Ingreso</span><input name="incomeValue" type="number" min="0" step="0.01" value="${esc(String(statementDraft.incomeValue || 0))}"></label>
            <label class="compact-field"><span>Egreso</span><input name="expenseValue" type="number" min="0" step="0.01" value="${esc(String(statementDraft.expenseValue || 0))}"></label>
            <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(statementDraft.observation || "")}</textarea></label>
          </form>
          <p class="panel-note">La importacion de extractos por Excel o CSV quedara lista para una fase posterior. En esta fase se registra el extracto de forma manual para revisar los cruces.</p>
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
    bindReconciliation();
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

  function persistReconciliationDraft() {
    const result = reconciliationService.saveReconciliation(collectReconciliationDraft());
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
    document.querySelector("[data-bank-account-save]")?.addEventListener("click", () => {
      const result = bankService.saveBankAccount(collectAccountDraft());
      uiState.accounts.errors = result.errors || [];
      uiState.accounts.warnings = result.warnings || [];
      uiState.accounts.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.accounts.draft = null;
      uiState.accounts.message = `Cuenta bancaria ${result.account.code} guardada correctamente.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-bank-account-edit]").forEach(button => button.addEventListener("click", () => {
      const account = bankService.findBankAccountById(button.dataset.bankAccountEdit);
      if (!account) return;
      ensureAccountDraft(account);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-bank-account-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = bankService.toggleBankAccountStatus(button.dataset.bankAccountToggle);
      uiState.accounts.message = result.ok ? "Estado de la cuenta bancaria actualizado." : (result.message || "");
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
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bank-movement-account-filter")?.addEventListener("change", event => {
      uiState.movements.bankAccountId = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bank-movement-status-filter")?.addEventListener("change", event => {
      uiState.movements.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bank-movement-origin-filter")?.addEventListener("change", event => {
      uiState.movements.originModule = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bank-movement-date-from")?.addEventListener("change", event => {
      uiState.movements.dateFrom = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#bank-movement-date-to")?.addEventListener("change", event => {
      uiState.movements.dateTo = event.target.value;
      BlessERP.layout.renderPage();
    });
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
    document.querySelector("[data-bank-movement-confirm]")?.addEventListener("click", () => {
      let current = collectMovementDraft();
      if (!current.id) {
        const saved = bankService.saveMovement(current);
        uiState.movements.errors = saved.errors || [];
        if (!saved.ok) {
          BlessERP.layout.renderPage();
          return;
        }
        current = saved.movement;
      }
      const result = bankService.confirmMovement(current.id);
      uiState.movements.errors = result.errors || [];
      uiState.movements.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      ensureMovementDraft(result.movement);
      uiState.movements.message = `Movimiento contabilizado con asiento ${result.entry.entryNumber}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-bank-movement-edit]").forEach(button => button.addEventListener("click", () => {
      const movement = bankService.movements().find(item => item.id === button.dataset.bankMovementEdit);
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

  function bindReconciliation() {
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
    document.querySelector("[data-reconciliation-save]")?.addEventListener("click", () => {
      const result = persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.reconciliation.message = `Conciliacion ${result.reconciliation.period} guardada en estado ${result.reconciliation.status}.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-close]")?.addEventListener("click", () => {
      let result = persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = reconciliationService.closeReconciliation(result.reconciliation.id);
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      setReconciliationDraft(result.reconciliation, "Conciliacion cerrada correctamente.");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-reconciliation-reopen]")?.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      const reason = String(uiState.reconciliation.actionNote || uiState.reconciliation.reopenReason || "").trim();
      if (!window.confirm("Esta conciliacion cerrada se reabrira para correccion. Desea continuar?")) return;
      const result = reconciliationService.reopenReconciliation(uiState.reconciliation.currentId, reason);
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
    document.querySelector("[data-reconciliation-link]")?.addEventListener("click", () => {
      let result = persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = reconciliationService.linkMatch(
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
    document.querySelector("[data-reconciliation-suggest]")?.addEventListener("click", () => {
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
      let result = persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = reconciliationService.linkMatch(
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
    document.querySelector("[data-reconciliation-observe-system]")?.addEventListener("click", () => {
      let result = persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = reconciliationService.saveReview(
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
    document.querySelector("[data-reconciliation-observe-statement]")?.addEventListener("click", () => {
      let result = persistReconciliationDraft();
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      result = reconciliationService.saveReview(
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
    document.querySelector("[data-reconciliation-unlink]")?.addEventListener("click", () => {
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
      const result = reconciliationService.unlinkMatch(
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
    document.querySelector("[data-reconciliation-adjustment]")?.addEventListener("click", () => {
      uiState.reconciliation.message = "Crear ajuste contable desde conciliacion quedara habilitado en una fase posterior.";
      uiState.reconciliation.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-statement-reset]")?.addEventListener("click", () => {
      syncReconciliationDraftFromDom();
      ensureStatementDraft(null, uiState.reconciliation.draft?.bankAccountId || "");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-statement-save]")?.addEventListener("click", () => {
      const result = reconciliationService.saveStatementMovement(collectStatementDraft());
      uiState.reconciliation.errors = result.errors || [];
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.reconciliation.message = `Movimiento externo ${result.movement.statementNumber} guardado correctamente.`;
      ensureStatementDraft(null, result.movement.bankAccountId || uiState.reconciliation.draft?.bankAccountId || "");
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

  function render(container, route) {
    if (route.id === "banks-accounts") {
      renderAccounts(container, route);
      return;
    }
    if (route.id === "banks-movements") {
      renderMovements(container, route);
      return;
    }
    renderReconciliation(container, route);
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Banks = {
    render,
    ensureMovementDraft
  };
})();
