(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money } = BlessERP.utils;
  const reportsService = BlessERP.services.reports;
  const chartService = BlessERP.services.chartOfAccounts;
  const purchaseService = BlessERP.services.purchases;
  const portfolioService = BlessERP.services.portfolios;
  const receivableService = BlessERP.services.receivables;
  const bankService = BlessERP.services.banks;
  const reconciliationService = BlessERP.services.bankReconciliation;
  const inventoryService = BlessERP.services.inventory;
  const adminService = BlessERP.services.adminConfig;

  function buildBaseState() {
    const defaults = reportsService.defaultFilters();
    return {
      period: defaults.period || "",
      dateFrom: defaults.dateFrom || "",
      dateTo: defaults.dateTo || "",
      status: ""
    };
  }

  const uiState = {
    message: "",
    dashboard: {
      ...buildBaseState(),
      costCenter: ""
    },
    accounting: {
      ...buildBaseState(),
      view: "trial-balance",
      accountCode: "",
      accountType: "",
      includeZeroRows: false
    },
    tax: {
      ...buildBaseState(),
      view: "supports",
      providerId: "",
      taxSupportCode: "",
      purchaseType: ""
    },
    portfolio: {
      ...buildBaseState(),
      view: "payables",
      providerId: "",
      customerId: ""
    },
    banks: {
      ...buildBaseState(),
      view: "movements",
      bankAccountId: "",
      originModule: ""
    },
    inventory: {
      ...buildBaseState(),
      view: "stock",
      productId: "",
      category: "",
      warehouseId: "",
      movementType: "",
      costCenter: ""
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
    const css = value.includes("anulado") || value.includes("cerrada")
      ? "cancelled"
      : value.includes("borrador") || value.includes("pendiente") || value.includes("revision")
        ? "pending"
        : value.includes("confirmado") || value.includes("contabilizado") || value.includes("aplicado") || value.includes("activo")
          ? "authorized"
          : "partial";
    return `<span class="status-badge ${css}">${esc(status || "Sin estado")}</span>`;
  }

  function renderMessage() {
    return uiState.message ? `<section class="inline-feedback success">${esc(uiState.message)}</section>` : "";
  }

  function exportActions(scope) {
    return `
      <div class="panel-inline-actions">
        <button class="secondary-button" type="button" data-report-placeholder="${esc(scope)}:excel">Exportar Excel</button>
        <button class="secondary-button" type="button" data-report-placeholder="${esc(scope)}:pdf">Exportar PDF</button>
        <button class="secondary-button" type="button" data-report-placeholder="${esc(scope)}:print">Imprimir</button>
      </div>
    `;
  }

  function providerOptions() {
    return portfolioService.providers().filter(item => item.status === "activo");
  }

  function customerOptions() {
    return receivableService.customers().filter(item => item.status === "activo");
  }

  function bankAccountOptions() {
    return bankService.bankAccounts();
  }

  function inventoryProductOptions() {
    return inventoryService.items().filter(item => item.status === "activo");
  }

  function inventoryCategoryOptions() {
    return Array.from(new Set(inventoryService.items().map(item => item.category))).sort((a, b) => a.localeCompare(b, "es"));
  }

  function reportSwitch(activeView, views) {
    return `
      <div class="report-view-switcher">
        ${views.map(item => `
          <button class="report-view-button ${activeView === item.id ? "active" : ""}" type="button" data-report-view="${esc(item.scope)}:${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function summaryCards(cards = []) {
    return `
      <section class="summary-grid summary-grid-reports">
        ${cards.map(item => `
          <article class="summary-card">
            <span>${esc(item.label)}</span>
            <strong>${item.value}</strong>
            <small>${esc(item.note || "")}</small>
          </article>
        `).join("")}
      </section>
    `;
  }

  function renderEmpty(message) {
    return `<div class="empty-inline">${esc(message)}</div>`;
  }

  function renderSectionHeader(kicker, title, actions = "") {
    return `
      <div class="panel-card-head">
        <div>
          <p class="section-kicker">${esc(kicker)}</p>
          <h3>${esc(title)}</h3>
        </div>
        ${actions}
      </div>
    `;
  }

  function renderDashboard(container, route) {
    const filters = uiState.dashboard;
    const summary = reportsService.dashboardSummary(filters);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Dashboard general</h1>
          <p>Resumen ejecutivo de contabilidad, compras, cartera, bancos, conciliacion e inventario administrativo.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Solo lectura</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${renderMessage()}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar report-filter-grid">
          <label class="compact-inline-field">
            <span>Periodo contable</span>
            <input id="report-dashboard-period" type="month" value="${esc(filters.period)}">
          </label>
          <label class="compact-inline-field">
            <span>Fecha desde</span>
            <input id="report-dashboard-date-from" type="date" value="${esc(filters.dateFrom)}">
          </label>
          <label class="compact-inline-field">
            <span>Fecha hasta</span>
            <input id="report-dashboard-date-to" type="date" value="${esc(filters.dateTo)}">
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="report-dashboard-status">
              <option value="">Todos</option>
              <option value="BORRADOR" ${filters.status === "BORRADOR" ? "selected" : ""}>BORRADOR</option>
              <option value="CONTABILIZADO" ${filters.status === "CONTABILIZADO" ? "selected" : ""}>CONTABILIZADO</option>
              <option value="CONFIRMADO" ${filters.status === "CONFIRMADO" ? "selected" : ""}>CONFIRMADO</option>
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Centro de costo</span>
            <input id="report-dashboard-cost-center" placeholder="Preparado para fase posterior" value="${esc(filters.costCenter)}">
          </label>
        </div>
      </section>
      ${summaryCards([
        { label: "Total compras del periodo", value: money(summary.totalPurchases), note: "Compras leidas desde modulo compras" },
        { label: "Cuentas por pagar pendientes", value: money(summary.pendingPayables), note: "Pendientes y parciales" },
        { label: "Cuentas por cobrar pendientes", value: money(summary.pendingReceivables), note: "Pendientes y parciales" },
        { label: "Bancos: saldo auxiliar", value: money(summary.totalBankAuxiliary), note: "Suma de bancos y caja" },
        { label: "Asientos contabilizados", value: esc(String(summary.journalPosted)), note: "Libro Diario del periodo" },
        { label: "Asientos en borrador", value: esc(String(summary.journalDrafts)), note: "Aun no afectan reportes finales" },
        { label: "Retenciones emitidas pendientes", value: esc(String(summary.pendingIssuedWithholdings)), note: "Borrador o listas para autorizar" },
        { label: "Retenciones recibidas pendientes", value: esc(String(summary.pendingReceivedWithholdings)), note: "Pendientes de aplicar o relacionar" },
        { label: "Productos bajo stock minimo", value: esc(String(summary.lowStockProducts)), note: "Solo inventario administrativo" },
        { label: "Conciliaciones abiertas", value: esc(String(summary.openReconciliations)), note: "Borrador, revision o reabierta" },
        { label: "Conciliaciones cerradas", value: esc(String(summary.closedReconciliations)), note: "Cierre bancario registrado" },
        { label: "Inventario valorizado", value: money(summary.inventoryValue), note: "Suministros y materiales" }
      ])}
      <section class="report-two-column">
        <article class="panel-card">
          ${renderSectionHeader("INDICADORES", "Radar contable", exportActions("dashboard-general"))}
          <div class="info-stack">
            <div class="info-row"><strong>Alertas contables</strong><span>${esc(String(summary.accountingAlerts))}</span></div>
            <div class="info-row"><strong>Periodo consultado</strong><span>${esc(filters.period || "Personalizado")}</span></div>
            <div class="info-row"><strong>Rango</strong><span>${esc(`${filters.dateFrom || "-"} a ${filters.dateTo || "-"}`)}</span></div>
            <div class="info-row"><strong>Centro de costo</strong><span>${esc(filters.costCenter || "Todos")}</span></div>
          </div>
          <p class="panel-note">Este dashboard solo consolida informacion ya generada por los modulos existentes y no modifica ningun dato.</p>
        </article>
        <article class="panel-card">
          ${renderSectionHeader("ALCANCE", "Modulos cubiertos")}
          <div class="mini-route-grid">
            <button class="mini-route-card" data-route-link="reports-accounting"><strong>Reportes contables</strong><span>Balance, mayor y estados preliminares</span></button>
            <button class="mini-route-card" data-route-link="reports-tax"><strong>Reportes tributarios</strong><span>Compras y retenciones base</span></button>
            <button class="mini-route-card" data-route-link="reports-portfolio"><strong>Reportes de cartera</strong><span>CxP, CxC, pagos y cobros</span></button>
            <button class="mini-route-card" data-route-link="reports-banks"><strong>Reportes bancarios</strong><span>Movimientos, saldos y conciliaciones</span></button>
            <button class="mini-route-card" data-route-link="reports-inventory"><strong>Reportes de inventario</strong><span>Stock, kardex y consumos</span></button>
            <button class="mini-route-card" data-route-link="reports-commercial"><strong>Ventas / exportaciones</strong><span>Fase futura, no implementado todavia</span></button>
          </div>
        </article>
      </section>
    `;

    bindDashboard();
  }

  function renderTrialBalance(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("BALANCE", "Balance de comprobacion", exportActions("trial-balance"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Cuenta</th>
                <th>Saldo inicial</th>
                <th>Debe</th>
                <th>Haber</th>
                <th>Saldo deudor</th>
                <th>Saldo acreedor</th>
                <th>Saldo final</th>
              </tr>
            </thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td><strong>${esc(row.code)}</strong></td>
                  <td>${"&nbsp;".repeat(Math.max(0, (Number(row.level || 1) - 1) * 4))}${esc(row.name)}</td>
                  <td>${money(row.initialSigned)}</td>
                  <td>${money(row.debit)}</td>
                  <td>${money(row.credit)}</td>
                  <td>${money(row.saldoDeudor)}</td>
                  <td>${money(row.saldoAcreedor)}</td>
                  <td>${money(row.finalSigned)}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay movimientos contabilizados para estos filtros.")}</td></tr>`}
            </tbody>
            <tfoot>
              <tr>
                <th colspan="3">Totales movimiento</th>
                <th>${money(report.totals.debit)}</th>
                <th>${money(report.totals.credit)}</th>
                <th colspan="3"></th>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>
    `;
  }

  function renderIncomeStatement(report) {
    return `
      <section class="report-two-column">
        ${report.sections.map(section => `
          <article class="panel-card">
            ${renderSectionHeader("RESULTADOS", section.label)}
            <div class="compact-table-wrap">
              <table class="compact-table">
                <thead><tr><th>Codigo</th><th>Cuenta</th><th>Saldo</th></tr></thead>
                <tbody>
                  ${section.rows.map(row => `
                    <tr>
                      <td>${esc(row.code)}</td>
                      <td>${"&nbsp;".repeat(Math.max(0, (Number(row.level || 1) - 1) * 4))}${esc(row.name)}</td>
                      <td>${money(row.finalSigned)}</td>
                    </tr>
                  `).join("") || `<tr><td colspan="3">${renderEmpty("Sin movimientos para esta seccion.")}</td></tr>`}
                </tbody>
                <tfoot><tr><th colspan="2">Total ${esc(section.label)}</th><th>${money(section.total)}</th></tr></tfoot>
              </table>
            </div>
          </article>
        `).join("")}
        <article class="panel-card">
          ${renderSectionHeader("CIERRE", "Resultado del periodo", exportActions("income-statement"))}
          <div class="info-stack">
            <div class="info-row"><strong>Ingresos</strong><span>${money(report.totalIncome)}</span></div>
            <div class="info-row"><strong>Costos</strong><span>${money(report.totalCost)}</span></div>
            <div class="info-row"><strong>Gastos</strong><span>${money(report.totalExpense)}</span></div>
            <div class="info-row"><strong>Resultado</strong><span>${money(report.resultPeriod)}</span></div>
          </div>
        </article>
      </section>
    `;
  }

  function renderBalanceSheet(report) {
    return `
      <section class="report-two-column">
        ${report.sections.map(section => `
          <article class="panel-card">
            ${renderSectionHeader("BALANCE", section.label)}
            <div class="compact-table-wrap">
              <table class="compact-table">
                <thead><tr><th>Codigo</th><th>Cuenta</th><th>Saldo</th></tr></thead>
                <tbody>
                  ${section.rows.map(row => `
                    <tr>
                      <td>${esc(row.code)}</td>
                      <td>${"&nbsp;".repeat(Math.max(0, (Number(row.level || 1) - 1) * 4))}${esc(row.name)}</td>
                      <td>${money(row.finalSigned)}</td>
                    </tr>
                  `).join("") || `<tr><td colspan="3">${renderEmpty("Sin movimientos para esta seccion.")}</td></tr>`}
                </tbody>
                <tfoot><tr><th colspan="2">Total ${esc(section.label)}</th><th>${money(section.total)}</th></tr></tfoot>
              </table>
            </div>
          </article>
        `).join("")}
        <article class="panel-card">
          ${renderSectionHeader("RESUMEN", "Balance general preliminar", exportActions("balance-sheet"))}
          <div class="info-stack">
            <div class="info-row"><strong>Activos</strong><span>${money(report.totalAssets)}</span></div>
            <div class="info-row"><strong>Pasivos</strong><span>${money(report.totalLiabilities)}</span></div>
            <div class="info-row"><strong>Patrimonio</strong><span>${money(report.totalPatrimony)}</span></div>
            <div class="info-row"><strong>Resultado del periodo</strong><span>${money(report.resultPeriod)}</span></div>
            <div class="info-row"><strong>Patrimonio + resultado</strong><span>${money(report.patrimonyWithResult)}</span></div>
          </div>
        </article>
      </section>
    `;
  }

  function renderAccountMovement(report) {
    if (!report.ledger) {
      return `
        <article class="panel-card">
          ${renderSectionHeader("MOVIMIENTO", "Movimiento por cuenta", exportActions("account-movement"))}
          ${renderEmpty("Seleccione una cuenta contable para consultar su movimiento detallado.")}
        </article>
      `;
    }
    const ledger = report.ledger;
    return `
      ${summaryCards([
        { label: "Saldo inicial", value: money(ledger.initialBalance), note: ledger.account.name },
        { label: "Total debe", value: money(ledger.totals.debit), note: "Movimientos del rango" },
        { label: "Total haber", value: money(ledger.totals.credit), note: "Movimientos del rango" },
        { label: "Saldo final", value: money(ledger.finalBalance), note: `Naturaleza ${ledger.account.nature}` }
      ])}
      <article class="panel-card">
        ${renderSectionHeader("MOVIMIENTO", "Mayor por cuenta", exportActions("account-movement"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Asiento</th><th>Concepto</th><th>Documento origen</th><th>Debe</th><th>Haber</th><th>Saldo</th><th>Modulo origen</th></tr></thead>
            <tbody>
              <tr><td colspan="6"><strong>Saldo inicial</strong></td><td><strong>${money(ledger.initialBalance)}</strong></td><td></td></tr>
              ${ledger.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.entryNumber)}</td>
                  <td>${esc(row.concept)}</td>
                  <td>${esc(row.sourceDocument || "-")}</td>
                  <td>${money(row.debit)}</td>
                  <td>${money(row.credit)}</td>
                  <td>${money(row.balance)}</td>
                  <td>${esc(row.originModule)}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay movimientos contabilizados para esta cuenta.")}</td></tr>`}
            </tbody>
            <tfoot><tr><th colspan="4">Totales</th><th>${money(ledger.totals.debit)}</th><th>${money(ledger.totals.credit)}</th><th>${money(ledger.finalBalance)}</th><th></th></tr></tfoot>
          </table>
        </div>
      </article>
    `;
  }

  function renderAccounting(container, route) {
    const filters = uiState.accounting;
    const accountOptions = chartService.movementOptions();
    const viewOptions = [
      { id: "trial-balance", label: "Balance de comprobacion", scope: "accounting" },
      { id: "income-statement", label: "Estado de resultados", scope: "accounting" },
      { id: "balance-sheet", label: "Balance general", scope: "accounting" },
      { id: "account-movement", label: "Movimiento por cuenta", scope: "accounting" }
    ];
    const report = filters.view === "trial-balance"
      ? reportsService.trialBalance(filters)
      : filters.view === "income-statement"
        ? reportsService.incomeStatement(filters)
        : filters.view === "balance-sheet"
          ? reportsService.balanceSheet(filters)
          : reportsService.accountMovementReport(filters);

    let content = "";
    if (filters.view === "trial-balance") content = renderTrialBalance(report);
    if (filters.view === "income-statement") content = renderIncomeStatement(report);
    if (filters.view === "balance-sheet") content = renderBalanceSheet(report);
    if (filters.view === "account-movement") content = renderAccountMovement(report);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Reportes contables</h1>
          <p>Consultas base del Libro Diario y Mayor General para construir balance de comprobacion y estados preliminares.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Solo lectura</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${renderMessage()}
      <section class="panel-card compact-toolbar-card">
        ${renderSectionHeader("VISTAS", "Reporte contable activo")}
        ${reportSwitch(filters.view, viewOptions)}
        <div class="compact-toolbar report-filter-grid">
          <label class="compact-inline-field"><span>Periodo</span><input id="report-accounting-period" type="month" value="${esc(filters.period)}"></label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="report-accounting-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="report-accounting-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          <label class="compact-inline-field">
            <span>Tipo de cuenta</span>
            <select id="report-accounting-type">
              <option value="">Todos</option>
              ${["Activo", "Pasivo", "Patrimonio", "Ingreso", "Costo", "Gasto", "Orden"].map(item => `<option value="${esc(item)}" ${filters.accountType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Cuenta contable</span>
            <select id="report-accounting-account">
              <option value="">Todas / vista general</option>
              ${accountOptions.map(account => `<option value="${esc(account.code)}" ${filters.accountCode === account.code ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field compact-inline-checkbox">
            <span>Ver filas en cero</span>
            <input id="report-accounting-zero-rows" type="checkbox" ${filters.includeZeroRows ? "checked" : ""}>
          </label>
        </div>
      </section>
      ${content}
    `;

    bindAccounting();
  }

  function renderPurchasesBySupport(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("TRIBUTARIO", "Compras por sustento tributario", exportActions("tax-supports"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Codigo</th><th>Sustento tributario</th><th>Base 0%</th><th>Base IVA</th><th>IVA</th><th>Total</th><th>Retencion fuente</th><th>Retencion IVA</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.code)}</td>
                  <td>${esc(row.supportName)}</td>
                  <td>${money(row.base0)}</td>
                  <td>${money(row.baseIva)}</td>
                  <td>${money(row.iva)}</td>
                  <td>${money(row.total)}</td>
                  <td>${money(row.retentionRent)}</td>
                  <td>${money(row.retentionVat)}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay compras para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderPurchasesBySupplier(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("TRIBUTARIO", "Compras por proveedor", exportActions("tax-suppliers"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Proveedor</th><th>RUC</th><th>Documentos</th><th>Base 0%</th><th>Base IVA</th><th>IVA</th><th>Total compras</th><th>Retenciones</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.providerName)}</td>
                  <td>${esc(row.providerRuc)}</td>
                  <td>${esc(String(row.documents))}</td>
                  <td>${money(row.base0)}</td>
                  <td>${money(row.baseIva)}</td>
                  <td>${money(row.iva)}</td>
                  <td>${money(row.total)}</td>
                  <td>${money(row.retained)}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay compras para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderIssuedWithholdings(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("TRIBUTARIO", "Retenciones emitidas", exportActions("issued-withholdings"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>RUC</th><th>Compra relacionada</th><th>Codigo</th><th>Tipo</th><th>Base</th><th>%</th><th>Valor retenido</th><th>Estado</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.providerName)}</td>
                  <td>${esc(row.providerRuc)}</td>
                  <td>${esc(row.relatedDocument || "-")}</td>
                  <td>${esc(row.retentionCode)}</td>
                  <td>${esc(row.taxType)}</td>
                  <td>${money(row.baseAmount)}</td>
                  <td>${esc(String(row.percentage))}%</td>
                  <td>${money(row.retainedAmount)}</td>
                  <td>${statusBadge(row.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="10">${renderEmpty("No hay retenciones emitidas para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderReceivedWithholdings(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("TRIBUTARIO", "Retenciones recibidas", exportActions("received-withholdings"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Identificacion</th><th>Documento sustento</th><th>Codigo</th><th>Tipo</th><th>Base</th><th>%</th><th>Valor retenido</th><th>Estado</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.customerName)}</td>
                  <td>${esc(row.customerTaxId)}</td>
                  <td>${esc(row.supportDocument || "-")}</td>
                  <td>${esc(row.retentionCode)}</td>
                  <td>${esc(row.taxType)}</td>
                  <td>${money(row.baseAmount)}</td>
                  <td>${esc(String(row.percentage))}%</td>
                  <td>${money(row.retainedAmount)}</td>
                  <td>${statusBadge(row.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="10">${renderEmpty("No hay retenciones recibidas para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderTax(container, route) {
    const filters = uiState.tax;
    const viewOptions = [
      { id: "supports", label: "Compras por sustento", scope: "tax" },
      { id: "suppliers", label: "Compras por proveedor", scope: "tax" },
      { id: "issued", label: "Retenciones emitidas", scope: "tax" },
      { id: "received", label: "Retenciones recibidas", scope: "tax" }
    ];

    const report = filters.view === "supports"
      ? reportsService.purchasesByTaxSupport(filters)
      : filters.view === "suppliers"
        ? reportsService.purchasesBySupplier(filters)
        : filters.view === "issued"
          ? reportsService.issuedWithholdingsReport(filters)
          : reportsService.receivedWithholdingsReport(filters);

    const cards = filters.view === "supports"
      ? [
          { label: "Sustentos visibles", value: esc(String(report.rows.length)), note: "Agrupados por codigo" },
          { label: "Base 0%", value: money(report.rows.reduce((sum, row) => sum + Number(row.base0 || 0), 0)), note: "Acumulado del rango" },
          { label: "Base IVA", value: money(report.rows.reduce((sum, row) => sum + Number(row.baseIva || 0), 0)), note: "Acumulado del rango" },
          { label: "Retenciones", value: money(report.rows.reduce((sum, row) => sum + Number(row.retentionRent || 0) + Number(row.retentionVat || 0), 0)), note: "Fuente + IVA" }
        ]
      : filters.view === "suppliers"
        ? [
            { label: "Proveedores", value: esc(String(report.rows.length)), note: "Con compras visibles" },
            { label: "Total compras", value: money(report.rows.reduce((sum, row) => sum + Number(row.total || 0), 0)), note: "Acumulado del rango" },
            { label: "IVA", value: money(report.rows.reduce((sum, row) => sum + Number(row.iva || 0), 0)), note: "Segun compras leidas" },
            { label: "Retenciones", value: money(report.rows.reduce((sum, row) => sum + Number(row.retentions || 0), 0)), note: "Aplicadas o confirmadas" }
          ]
        : filters.view === "issued"
          ? [
              { label: "Retenciones visibles", value: esc(String(report.rows.length)), note: "Renta e IVA" },
              { label: "Valor retenido", value: money(report.rows.reduce((sum, row) => sum + Number(row.retainedAmount || 0), 0)), note: "Total del rango" },
              { label: "Pendientes", value: esc(String(report.rows.filter(row => ["BORRADOR", "LISTA_PARA_AUTORIZAR"].includes(row.status)).length)), note: "Borrador o lista" },
              { label: "Confirmadas", value: esc(String(report.rows.filter(row => row.status === "CONFIRMADA").length)), note: "Con asiento o preparadas" }
            ]
          : [
              { label: "Retenciones visibles", value: esc(String(report.rows.length)), note: "Importadas o aplicadas" },
              { label: "Renta retenida", value: money(report.rows.filter(row => row.taxType === "RENTA").reduce((sum, row) => sum + Number(row.retainedAmount || 0), 0)), note: "Segun XML recibido" },
              { label: "IVA retenido", value: money(report.rows.filter(row => row.taxType === "IVA").reduce((sum, row) => sum + Number(row.retainedAmount || 0), 0)), note: "Segun XML recibido" },
              { label: "Pendientes relacion", value: esc(String(report.rows.filter(row => row.status === "PENDIENTE_RELACION").length)), note: "Aun no aplicadas" }
            ];

    let content = "";
    if (filters.view === "supports") content = renderPurchasesBySupport(report);
    if (filters.view === "suppliers") content = renderPurchasesBySupplier(report);
    if (filters.view === "issued") content = renderIssuedWithholdings(report);
    if (filters.view === "received") content = renderReceivedWithholdings(report);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Reportes tributarios</h1>
          <p>Reportes base de compras y retenciones para alimentar control tributario previo al ATS.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge pending">ATS aun pendiente</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${renderMessage()}
      <section class="panel-card compact-toolbar-card">
        ${renderSectionHeader("VISTAS", "Reporte tributario activo")}
        ${reportSwitch(filters.view, viewOptions)}
        <div class="compact-toolbar report-filter-grid">
          <label class="compact-inline-field"><span>Periodo</span><input id="report-tax-period" type="month" value="${esc(filters.period)}"></label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="report-tax-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="report-tax-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          <label class="compact-inline-field">
            <span>Proveedor</span>
            <select id="report-tax-provider">
              <option value="">Todos</option>
              ${providerOptions().map(item => `<option value="${esc(item.id)}" ${filters.providerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Sustento</span>
            <select id="report-tax-support">
              <option value="">Todos</option>
              ${purchaseService.taxSupports().map(item => `<option value="${esc(item.code)}" ${filters.taxSupportCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.description)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo compra</span>
            <select id="report-tax-type">
              <option value="">Todos</option>
              ${purchaseService.purchaseTypes().map(item => `<option value="${esc(item.code)}" ${filters.purchaseType === item.code ? "selected" : ""}>${esc(item.label)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="report-tax-status">
              <option value="">Todos</option>
              <option value="BORRADOR" ${filters.status === "BORRADOR" ? "selected" : ""}>BORRADOR</option>
              <option value="CONFIRMADA" ${filters.status === "CONFIRMADA" ? "selected" : ""}>CONFIRMADA</option>
              <option value="APLICADO" ${filters.status === "APLICADO" ? "selected" : ""}>APLICADO</option>
              <option value="PENDIENTE_RELACION" ${filters.status === "PENDIENTE_RELACION" ? "selected" : ""}>PENDIENTE_RELACION</option>
            </select>
          </label>
        </div>
      </section>
      ${summaryCards(cards)}
      ${content}
    `;

    bindTax();
  }

  function renderPayables(report) {
    return `
      ${summaryCards([
        { label: "Total pendiente", value: money(report.summary.totalPending), note: "Pendiente y parcial" },
        { label: "Total vencido", value: money(report.summary.totalOverdue), note: "Documentos vencidos" },
        { label: "Total por vencer", value: money(report.summary.totalUpcoming), note: "Aun dentro de plazo" },
        { label: "Total pagado periodo", value: money(report.summary.totalPaidPeriod), note: "Pagos confirmados" }
      ])}
      <article class="panel-card">
        ${renderSectionHeader("CARTERA", "Cuentas por pagar", exportActions("payables-report"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Proveedor</th><th>Documento</th><th>Fecha emision</th><th>Fecha vencimiento</th><th>Total</th><th>Retenciones</th><th>Pagado</th><th>Saldo</th><th>Estado</th><th>Dias vencidos</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.providerName)}</td>
                  <td>${esc(row.documentNumber)}</td>
                  <td>${esc(row.issueDate)}</td>
                  <td>${esc(row.dueDate || "-")}</td>
                  <td>${money(row.totalDocument)}</td>
                  <td>${money(row.retentionApplied)}</td>
                  <td>${money(row.paid)}</td>
                  <td>${money(row.balance)}</td>
                  <td>${statusBadge(row.state)}</td>
                  <td>${esc(String(row.overdueDays || 0))}</td>
                </tr>
              `).join("") || `<tr><td colspan="10">${renderEmpty("No hay cuentas por pagar para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderReceivables(report) {
    return `
      ${summaryCards([
        { label: "Total pendiente", value: money(report.summary.totalPending), note: "Pendiente y parcial" },
        { label: "Total vencido", value: money(report.summary.totalOverdue), note: "Documentos vencidos" },
        { label: "Total por vencer", value: money(report.summary.totalUpcoming), note: "Aun dentro de plazo" },
        { label: "Total cobrado periodo", value: money(report.summary.totalCollectedPeriod), note: "Cobros confirmados" }
      ])}
      <article class="panel-card">
        ${renderSectionHeader("CARTERA", "Cuentas por cobrar", exportActions("receivables-report"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Cliente</th><th>Documento</th><th>Fecha emision</th><th>Fecha vencimiento</th><th>Total</th><th>Retenciones</th><th>Cobrado</th><th>Saldo</th><th>Estado</th><th>Dias vencidos</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.customerName)}</td>
                  <td>${esc(row.documentNumber)}</td>
                  <td>${esc(row.issueDate)}</td>
                  <td>${esc(row.dueDate || "-")}</td>
                  <td>${money(row.total)}</td>
                  <td>${money(row.withheld)}</td>
                  <td>${money(row.collected)}</td>
                  <td>${money(row.balance)}</td>
                  <td>${statusBadge(row.status)}</td>
                  <td>${esc(String(row.overdueDays || 0))}</td>
                </tr>
              `).join("") || `<tr><td colspan="10">${renderEmpty("No hay cuentas por cobrar para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderSupplierPayments(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("CARTERA", "Pagos a proveedores", exportActions("supplier-payments"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Documento pagado</th><th>Medio pago</th><th>Cuenta pago</th><th>Valor</th><th>Estado</th><th>Asiento</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.providerName)}</td>
                  <td>${esc(row.documentNumber)}</td>
                  <td>${esc(row.paymentMethod)}</td>
                  <td>${esc(row.paymentAccount)}</td>
                  <td>${money(row.value)}</td>
                  <td>${statusBadge(row.status)}</td>
                  <td>${esc(row.entryNumber || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay pagos para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderCustomerCollections(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("CARTERA", "Cobros a clientes", exportActions("customer-collections"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Documento cobrado</th><th>Medio cobro</th><th>Cuenta cobro</th><th>Valor</th><th>Estado</th><th>Asiento</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.customerName)}</td>
                  <td>${esc(row.documentNumber)}</td>
                  <td>${esc(row.collectionMethod)}</td>
                  <td>${esc(row.collectionAccount)}</td>
                  <td>${money(row.value)}</td>
                  <td>${statusBadge(row.status)}</td>
                  <td>${esc(row.entryNumber || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay cobros para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderPortfolio(container, route) {
    const filters = uiState.portfolio;
    const viewOptions = [
      { id: "payables", label: "Cuentas por pagar", scope: "portfolio" },
      { id: "receivables", label: "Cuentas por cobrar", scope: "portfolio" },
      { id: "payments", label: "Pagos a proveedores", scope: "portfolio" },
      { id: "collections", label: "Cobros a clientes", scope: "portfolio" }
    ];

    const report = filters.view === "payables"
      ? reportsService.payablesReport(filters)
      : filters.view === "receivables"
        ? reportsService.receivablesReport(filters)
        : filters.view === "payments"
          ? reportsService.supplierPaymentsReport(filters)
          : reportsService.customerCollectionsReport(filters);

    let content = "";
    if (filters.view === "payables") content = renderPayables(report);
    if (filters.view === "receivables") content = renderReceivables(report);
    if (filters.view === "payments") content = renderSupplierPayments(report);
    if (filters.view === "collections") content = renderCustomerCollections(report);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Reportes de cartera</h1>
          <p>Consulta consolidada de documentos abiertos, pagos y cobros generados por cartera de proveedores y clientes.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Solo lectura</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${renderMessage()}
      <section class="panel-card compact-toolbar-card">
        ${renderSectionHeader("VISTAS", "Reporte de cartera activo")}
        ${reportSwitch(filters.view, viewOptions)}
        <div class="compact-toolbar report-filter-grid">
          <label class="compact-inline-field"><span>Periodo</span><input id="report-portfolio-period" type="month" value="${esc(filters.period)}"></label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="report-portfolio-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="report-portfolio-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          <label class="compact-inline-field">
            <span>Proveedor</span>
            <select id="report-portfolio-provider">
              <option value="">Todos</option>
              ${providerOptions().map(item => `<option value="${esc(item.id)}" ${filters.providerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Cliente</span>
            <select id="report-portfolio-customer">
              <option value="">Todos</option>
              ${customerOptions().map(item => `<option value="${esc(item.id)}" ${filters.customerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="report-portfolio-status">
              <option value="">Todos</option>
              <option value="PENDIENTE" ${filters.status === "PENDIENTE" ? "selected" : ""}>PENDIENTE</option>
              <option value="PARCIAL" ${filters.status === "PARCIAL" ? "selected" : ""}>PARCIAL</option>
              <option value="PAGADO" ${filters.status === "PAGADO" ? "selected" : ""}>PAGADO / COBRADO</option>
              <option value="VENCIDO" ${filters.status === "VENCIDO" ? "selected" : ""}>VENCIDO</option>
              <option value="ANULADO" ${filters.status === "ANULADO" ? "selected" : ""}>ANULADO</option>
              <option value="CONFIRMADO" ${filters.status === "CONFIRMADO" ? "selected" : ""}>CONFIRMADO</option>
            </select>
          </label>
        </div>
      </section>
      ${content}
    `;

    bindPortfolio();
  }

  function renderBankMovements(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("BANCOS", "Movimientos bancarios", exportActions("bank-movements"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Cuenta bancaria</th><th>Tipo</th><th>Medio</th><th>Referencia</th><th>Tercero</th><th>Concepto</th><th>Ingreso</th><th>Egreso</th><th>Saldo auxiliar</th><th>Estado</th><th>Origen</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.movementDate)}</td>
                  <td>${esc(row.bankName)}</td>
                  <td>${esc(row.movementType)}</td>
                  <td>${esc(row.medium)}</td>
                  <td>${esc(row.reference || "-")}</td>
                  <td>${esc(row.beneficiary || "-")}</td>
                  <td>${esc(row.concept || "-")}</td>
                  <td>${money(row.incomeValue)}</td>
                  <td>${money(row.expenseValue)}</td>
                  <td>${money(row.auxiliaryBalance)}</td>
                  <td>${statusBadge(row.status)}</td>
                  <td>${esc(row.originModule)}</td>
                </tr>
              `).join("") || `<tr><td colspan="12">${renderEmpty("No hay movimientos bancarios para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderBankBalances(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("BANCOS", "Saldos por banco", exportActions("bank-balances"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Banco / caja</th><th>Cuenta bancaria</th><th>Cuenta contable</th><th>Saldo inicial</th><th>Ingresos</th><th>Egresos</th><th>Saldo auxiliar</th><th>Estado</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.bankName)}</td>
                  <td>${esc(row.code)}</td>
                  <td>${esc(row.linkedAccountCode || "-")}</td>
                  <td>${money(row.openingBalance)}</td>
                  <td>${money(row.incomes)}</td>
                  <td>${money(row.expenses)}</td>
                  <td>${money(row.currentBalance)}</td>
                  <td>${statusBadge(row.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay cuentas bancarias para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderBankReconciliations(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("BANCOS", "Conciliaciones bancarias", exportActions("bank-reconciliations"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Cuenta bancaria</th><th>Periodo</th><th>Saldo banco</th><th>Saldo sistema</th><th>Diferencia</th><th>Estado</th><th>Fecha cierre</th><th>Observaciones</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.bankAccount)}</td>
                  <td>${esc(row.period)}</td>
                  <td>${money(row.closingBankBalance)}</td>
                  <td>${money(row.systemBalance)}</td>
                  <td>${money(row.difference)}</td>
                  <td>${statusBadge(row.status)}</td>
                  <td>${esc(row.closeDate || "-")}</td>
                  <td>${esc(row.notes || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay conciliaciones para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderBanks(container, route) {
    const filters = uiState.banks;
    const viewOptions = [
      { id: "movements", label: "Movimientos bancarios", scope: "banks" },
      { id: "balances", label: "Saldos por banco", scope: "banks" },
      { id: "reconciliations", label: "Conciliaciones", scope: "banks" }
    ];

    const report = filters.view === "movements"
      ? reportsService.bankMovementsReport(filters)
      : filters.view === "balances"
        ? reportsService.bankBalancesReport(filters)
        : reportsService.bankReconciliationsReport(filters);

    const cards = filters.view === "movements"
      ? [
          { label: "Movimientos visibles", value: esc(String(report.rows.length)), note: "Segun filtros activos" },
          { label: "Ingresos", value: money(report.rows.reduce((sum, row) => sum + Number(row.incomeValue || 0), 0)), note: "Acumulado del rango" },
          { label: "Egresos", value: money(report.rows.reduce((sum, row) => sum + Number(row.expenseValue || 0), 0)), note: "Acumulado del rango" },
          { label: "Ultimo saldo", value: money(report.rows[report.rows.length - 1]?.auxiliaryBalance || 0), note: "Por la ultima fila visible" }
        ]
      : filters.view === "balances"
        ? [
            { label: "Cuentas visibles", value: esc(String(report.rows.length)), note: "Bancos y caja" },
            { label: "Saldo inicial", value: money(report.rows.reduce((sum, row) => sum + Number(row.openingBalance || 0), 0)), note: "Suma base" },
            { label: "Ingresos", value: money(report.rows.reduce((sum, row) => sum + Number(row.incomes || 0), 0)), note: "Contabilizados" },
            { label: "Saldo auxiliar", value: money(report.rows.reduce((sum, row) => sum + Number(row.currentBalance || 0), 0)), note: "Actual" }
          ]
        : [
            { label: "Conciliaciones visibles", value: esc(String(report.rows.length)), note: "Segun filtros activos" },
            { label: "Cerradas", value: esc(String(report.rows.filter(row => row.status === "CERRADA").length)), note: "Listas" },
            { label: "Abiertas", value: esc(String(report.rows.filter(row => row.status !== "CERRADA").length)), note: "En revision" },
            { label: "Diferencia total", value: money(report.rows.reduce((sum, row) => sum + Number(row.difference || 0), 0)), note: "Suma visible" }
          ];

    let content = "";
    if (filters.view === "movements") content = renderBankMovements(report);
    if (filters.view === "balances") content = renderBankBalances(report);
    if (filters.view === "reconciliations") content = renderBankReconciliations(report);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Reportes bancarios</h1>
          <p>Consulta de saldos auxiliares, movimientos y conciliaciones bancarias sin alterar ningun registro base.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Solo lectura</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${renderMessage()}
      <section class="panel-card compact-toolbar-card">
        ${renderSectionHeader("VISTAS", "Reporte bancario activo")}
        ${reportSwitch(filters.view, viewOptions)}
        <div class="compact-toolbar report-filter-grid">
          <label class="compact-inline-field"><span>Periodo</span><input id="report-banks-period" type="month" value="${esc(filters.period)}"></label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="report-banks-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="report-banks-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          <label class="compact-inline-field">
            <span>Banco</span>
            <select id="report-banks-account">
              <option value="">Todos</option>
              ${bankAccountOptions().map(item => `<option value="${esc(item.id)}" ${filters.bankAccountId === item.id ? "selected" : ""}>${esc(item.bankName)} - ${esc(item.code)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="report-banks-status">
              <option value="">Todos</option>
              <option value="BORRADOR" ${filters.status === "BORRADOR" ? "selected" : ""}>BORRADOR</option>
              <option value="CONTABILIZADO" ${filters.status === "CONTABILIZADO" ? "selected" : ""}>CONTABILIZADO</option>
              <option value="CERRADA" ${filters.status === "CERRADA" ? "selected" : ""}>CERRADA</option>
              <option value="EN_REVISION" ${filters.status === "EN_REVISION" ? "selected" : ""}>EN_REVISION</option>
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Modulo origen</span>
            <select id="report-banks-origin">
              <option value="">Todos</option>
              ${["manual", "PAGOS", "COBROS", "AJUSTES", "TRANSFERENCIAS"].map(item => `<option value="${esc(item)}" ${filters.originModule === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
        </div>
      </section>
      ${summaryCards(cards)}
      ${content}
    `;

    bindBanks();
  }

  function renderInventoryStock(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("INVENTARIO", "Stock actual", exportActions("inventory-stock"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Codigo</th><th>Producto</th><th>Categoria</th><th>Subcategoria</th><th>Bodega</th><th>Stock actual</th><th>Unidad</th><th>Costo promedio</th><th>Valor inventario</th><th>Stock minimo</th><th>Estado</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.code)}</td>
                  <td>${esc(row.name)}</td>
                  <td>${esc(row.category)}</td>
                  <td>${esc(row.subcategory)}</td>
                  <td>${esc(row.warehouseName)}</td>
                  <td>${esc(String(row.quantity))}</td>
                  <td>${esc(row.unit)}</td>
                  <td>${money(row.averageCost)}</td>
                  <td>${money(row.value)}</td>
                  <td>${esc(String(row.minStock))}</td>
                  <td>${statusBadge(row.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="11">${renderEmpty("No hay stock para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderInventoryKardex(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("INVENTARIO", "Kardex por producto", exportActions("inventory-kardex"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Tipo</th><th>Documento sustento</th><th>Proveedor</th><th>Factura relacionada</th><th>Linea compra</th><th>Origen</th><th>Entrada cantidad</th><th>Entrada valor</th><th>Salida cantidad</th><th>Salida valor</th><th>Saldo cantidad</th><th>Saldo valor</th><th>Costo promedio</th><th>Bodega</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.movementNumber)}</td>
                  <td>${esc(row.movementType)}</td>
                  <td>${esc(row.supportDocument || row.sourceDocument || "-")}</td>
                  <td>${esc(row.supplierName || "-")}</td>
                  <td>${esc(row.purchaseDocumentNumber || "-")}</td>
                  <td>${esc(row.sourceLineNumber ? `Linea ${row.sourceLineNumber}` : "-")}</td>
                  <td>${esc(row.sourceType || "-")}</td>
                  <td>${esc(String(row.entryQuantity || 0))}</td>
                  <td>${money(row.entryValue)}</td>
                  <td>${esc(String(row.exitQuantity || 0))}</td>
                  <td>${money(row.exitValue)}</td>
                  <td>${esc(String(row.balanceQuantity || 0))}</td>
                  <td>${money(row.balanceValue)}</td>
                  <td>${money(row.averageCost)}</td>
                  <td>${esc(row.warehouseName || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="16">${renderEmpty("No hay kardex para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderInventoryConsumptions(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("INVENTARIO", "Consumos por area / centro de costo", exportActions("inventory-consumptions"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Categoria</th><th>Area / centro costo</th><th>Cantidad</th><th>Costo unitario</th><th>Costo total</th><th>Cuenta gasto/costo</th><th>Asiento relacionado</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(`${row.productCode} - ${row.productName}`)}</td>
                  <td>${esc(row.category)}</td>
                  <td>${esc(row.costCenter || "-")}</td>
                  <td>${esc(String(row.quantity))}</td>
                  <td>${money(row.unitCost)}</td>
                  <td>${money(row.totalCost)}</td>
                  <td>${esc(row.expenseAccountCode ? `${row.expenseAccountCode} - ${row.expenseAccountName}` : "-")}</td>
                  <td>${esc(row.journalEntryNumber || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="9">${renderEmpty("No hay consumos para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderInventoryDeliveries(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("INVENTARIO", "Entregas a proveedores pendientes de descontar", exportActions("inventory-deliveries"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Bloque</th><th>Producto</th><th>Cantidad</th><th>Costo</th><th>Estado</th><th>Observacion</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.providerName)}</td>
                  <td>${esc(row.block || "-")}</td>
                  <td>${esc(`${row.productCode} - ${row.productName}`)}</td>
                  <td>${esc(String(row.quantity))}</td>
                  <td>${money(row.cost)}</td>
                  <td>${statusBadge(row.settlementStatus)}</td>
                  <td>${esc(row.observation || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">${renderEmpty("No hay entregas pendientes para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderInventoryPurchaseEntries(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("INVENTARIO", "Ingresos desde compras y diferencias", exportActions("inventory-purchase-entries"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha compra</th><th>Proveedor</th><th>RUC</th><th>Documento</th><th>Autorizacion</th><th>Total factura</th><th>Total inventario</th><th>Ingresado</th><th>Diferencia</th><th>Estado</th><th>Movimientos</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.date)}</td>
                  <td>${esc(row.supplierName)}</td>
                  <td>${esc(row.supplierRuc)}</td>
                  <td>${esc(row.documentNumber)}</td>
                  <td>${esc(row.authorizationNumber || "-")}</td>
                  <td>${money(row.totalInvoice)}</td>
                  <td>${money(row.inventoryLinesTotal)}</td>
                  <td>${money(row.totalEntered)}</td>
                  <td>${money(row.difference)}</td>
                  <td>${statusBadge(row.inventoryStatus)}</td>
                  <td>${esc(row.movements || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="11">${renderEmpty("No hay facturas de inventario para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderInventory(container, route) {
    const filters = uiState.inventory;
    const viewOptions = [
      { id: "stock", label: "Stock actual", scope: "inventory" },
      { id: "purchase-entries", label: "Ingresos compras", scope: "inventory" },
      { id: "kardex", label: "Kardex", scope: "inventory" },
      { id: "consumptions", label: "Consumos", scope: "inventory" },
      { id: "deliveries", label: "Entregas a proveedores", scope: "inventory" }
    ];

    const report = filters.view === "stock"
      ? reportsService.inventoryStockReport(filters)
      : filters.view === "purchase-entries"
        ? reportsService.inventoryPurchaseEntriesReport(filters)
      : filters.view === "kardex"
        ? reportsService.inventoryKardexReport(filters)
        : filters.view === "consumptions"
          ? reportsService.inventoryConsumptionsReport(filters)
          : reportsService.inventorySupplierDeliveriesReport(filters);

    const cards = filters.view === "stock"
      ? [
          { label: "Items visibles", value: esc(String(report.rows.length)), note: "Solo inventario administrativo" },
          { label: "Valor inventario", value: money(report.rows.reduce((sum, row) => sum + Number(row.value || 0), 0)), note: "Acumulado visible" },
          { label: "Bajo minimo", value: esc(String(report.rows.filter(row => row.status === "bajo minimo").length)), note: "Reposicion sugerida" },
          { label: "Sin stock", value: esc(String(report.rows.filter(row => row.status === "sin stock").length)), note: "Sin existencia" }
        ]
      : filters.view === "purchase-entries"
        ? [
            { label: "Facturas visibles", value: esc(String(report.rows.length)), note: "Compras con inventario" },
            { label: "Pendientes", value: esc(String(report.rows.filter(row => row.inventoryStatus === "PENDIENTE_INVENTARIO").length)), note: "Sin ingreso confirmado" },
            { label: "Parciales", value: esc(String(report.rows.filter(row => row.inventoryStatus === "PARCIAL_INGRESADO").length)), note: "Ingreso incompleto" },
            { label: "Diferencia visible", value: money(report.rows.reduce((sum, row) => sum + Number(row.difference || 0), 0)), note: "Factura vs inventario" }
          ]
      : filters.view === "kardex"
        ? [
            { label: "Movimientos visibles", value: esc(String(report.rows.length)), note: "Confirmados" },
            { label: "Entradas", value: money(report.rows.reduce((sum, row) => sum + Number(row.entryValue || 0), 0)), note: "Valor acumulado" },
            { label: "Salidas", value: money(report.rows.reduce((sum, row) => sum + Number(row.exitValue || 0), 0)), note: "Valor acumulado" },
            { label: "Saldo final", value: money(report.rows[report.rows.length - 1]?.balanceValue || 0), note: "Ultimo saldo visible" }
          ]
        : filters.view === "consumptions"
          ? [
              { label: "Consumos visibles", value: esc(String(report.rows.length)), note: "Consumos confirmados" },
              { label: "Costo total", value: money(report.rows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0)), note: "Acumulado del rango" },
              { label: "Centros usados", value: esc(String(new Set(report.rows.map(row => row.costCenter).filter(Boolean)).size)), note: "Preparado para costeo" },
              { label: "Asientos relacionados", value: esc(String(report.rows.filter(row => row.journalEntryNumber).length)), note: "Con impacto contable" }
            ]
          : [
              { label: "Entregas visibles", value: esc(String(report.rows.length)), note: "Pendientes o descontadas" },
              { label: "Costo entregado", value: money(report.rows.reduce((sum, row) => sum + Number(row.cost || 0), 0)), note: "Acumulado del rango" },
              { label: "Pendientes", value: esc(String(report.rows.filter(row => String(row.settlementStatus).includes("pendiente")).length)), note: "Aun no descontadas" },
              { label: "Bloques con salida", value: esc(String(new Set(report.rows.map(row => row.block).filter(Boolean)).size)), note: "Solo informativo" }
            ];

    let content = "";
    if (filters.view === "stock") content = renderInventoryStock(report);
    if (filters.view === "purchase-entries") content = renderInventoryPurchaseEntries(report);
    if (filters.view === "kardex") content = renderInventoryKardex(report);
    if (filters.view === "consumptions") content = renderInventoryConsumptions(report);
    if (filters.view === "deliveries") content = renderInventoryDeliveries(report);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Reportes de inventario</h1>
          <p>Reportes de suministros, materiales de empaque, quimicos, fertilizantes, herramientas y bodega. No incluye inventario de rosas.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Solo inventario administrativo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${renderMessage()}
      <section class="panel-card compact-toolbar-card">
        ${renderSectionHeader("VISTAS", "Reporte de inventario activo")}
        ${reportSwitch(filters.view, viewOptions)}
        <div class="compact-toolbar report-filter-grid">
          <label class="compact-inline-field"><span>Periodo</span><input id="report-inventory-period" type="month" value="${esc(filters.period)}"></label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="report-inventory-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="report-inventory-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          <label class="compact-inline-field">
            <span>Producto</span>
            <select id="report-inventory-product">
              <option value="">Todos</option>
              ${inventoryProductOptions().map(item => `<option value="${esc(item.id)}" ${filters.productId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Categoria</span>
            <select id="report-inventory-category">
              <option value="">Todas</option>
              ${inventoryCategoryOptions().map(item => `<option value="${esc(item)}" ${filters.category === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Bodega</span>
            <select id="report-inventory-warehouse">
              <option value="">Todas</option>
              ${inventoryService.warehouses().map(item => `<option value="${esc(item.id)}" ${filters.warehouseId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo movimiento</span>
            <select id="report-inventory-movement">
              <option value="">Todos</option>
              ${["ENTRADA_COMPRA", "ENTRADA_AJUSTE", "SALIDA_CONSUMO", "SALIDA_PROVEEDOR", "SALIDA_EMPAQUE", "SALIDA_CAMPO", "AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "TRANSFERENCIA_BODEGA"].map(item => `<option value="${esc(item)}" ${filters.movementType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="report-inventory-status">
              <option value="">Todos</option>
              <option value="normal" ${filters.status === "normal" ? "selected" : ""}>normal</option>
              <option value="bajo minimo" ${filters.status === "bajo minimo" ? "selected" : ""}>bajo minimo</option>
              <option value="sin stock" ${filters.status === "sin stock" ? "selected" : ""}>sin stock</option>
              <option value="PENDIENTE_INVENTARIO" ${filters.status === "PENDIENTE_INVENTARIO" ? "selected" : ""}>PENDIENTE_INVENTARIO</option>
              <option value="PARCIAL_INGRESADO" ${filters.status === "PARCIAL_INGRESADO" ? "selected" : ""}>PARCIAL_INGRESADO</option>
              <option value="INGRESADO_TOTAL" ${filters.status === "INGRESADO_TOTAL" ? "selected" : ""}>INGRESADO_TOTAL</option>
              <option value="OBSERVADO" ${filters.status === "OBSERVADO" ? "selected" : ""}>OBSERVADO</option>
              <option value="pendiente de descontar" ${filters.status === "pendiente de descontar" ? "selected" : ""}>pendiente de descontar</option>
              <option value="CONFIRMADO" ${filters.status === "CONFIRMADO" ? "selected" : ""}>CONFIRMADO</option>
            </select>
          </label>
        </div>
      </section>
      ${summaryCards(cards)}
      ${content}
    `;

    bindInventory();
  }

  function renderFuture(container, route) {
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge cancelled">Fase futura</span>
        </div>
      </section>
      ${routeTabs(route)}
      <section class="future-banner">
        <strong>Reportes de ventas y exportaciones quedan reservados para la fase comercial futura.</strong>
        <span>Esta pantalla se deja visible para no mezclar ventas/exportaciones dentro de la base administrativa-contable actual.</span>
      </section>
      <article class="panel-card">
        ${renderSectionHeader("FASE FUTURA", "Lo que se implementara despues")}
        <ul class="checklist-list">
          ${route.checklist.map(item => `<li>${esc(item)}</li>`).join("")}
        </ul>
      </article>
    `;
  }

  function render(container, route) {
    if (route.id === "reports-dashboard") {
      renderDashboard(container, route);
      return;
    }
    if (route.id === "reports-accounting") {
      renderAccounting(container, route);
      return;
    }
    if (route.id === "reports-tax") {
      renderTax(container, route);
      return;
    }
    if (route.id === "reports-portfolio") {
      renderPortfolio(container, route);
      return;
    }
    if (route.id === "reports-banks") {
      renderBanks(container, route);
      return;
    }
    if (route.id === "reports-inventory") {
      renderInventory(container, route);
      return;
    }
    renderFuture(container, route);
  }

  function bindDashboard() {
    document.querySelector("#report-dashboard-period")?.addEventListener("change", event => { uiState.dashboard.period = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-dashboard-date-from")?.addEventListener("change", event => { uiState.dashboard.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-dashboard-date-to")?.addEventListener("change", event => { uiState.dashboard.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-dashboard-status")?.addEventListener("change", event => { uiState.dashboard.status = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-dashboard-cost-center")?.addEventListener("input", event => { uiState.dashboard.costCenter = event.target.value; });
    bindSharedActions();
  }

  function bindAccounting() {
    document.querySelectorAll("[data-report-view^='accounting:']").forEach(button => button.addEventListener("click", () => {
      uiState.accounting.view = button.dataset.reportView.split(":")[1];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#report-accounting-period")?.addEventListener("change", event => { uiState.accounting.period = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-accounting-date-from")?.addEventListener("change", event => { uiState.accounting.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-accounting-date-to")?.addEventListener("change", event => { uiState.accounting.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-accounting-type")?.addEventListener("change", event => { uiState.accounting.accountType = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-accounting-account")?.addEventListener("change", event => { uiState.accounting.accountCode = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-accounting-zero-rows")?.addEventListener("change", event => { uiState.accounting.includeZeroRows = event.target.checked; BlessERP.layout.renderPage(); });
    bindSharedActions();
  }

  function bindTax() {
    document.querySelectorAll("[data-report-view^='tax:']").forEach(button => button.addEventListener("click", () => {
      uiState.tax.view = button.dataset.reportView.split(":")[1];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#report-tax-period")?.addEventListener("change", event => { uiState.tax.period = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-tax-date-from")?.addEventListener("change", event => { uiState.tax.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-tax-date-to")?.addEventListener("change", event => { uiState.tax.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-tax-provider")?.addEventListener("change", event => { uiState.tax.providerId = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-tax-support")?.addEventListener("change", event => { uiState.tax.taxSupportCode = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-tax-type")?.addEventListener("change", event => { uiState.tax.purchaseType = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-tax-status")?.addEventListener("change", event => { uiState.tax.status = event.target.value; BlessERP.layout.renderPage(); });
    bindSharedActions();
  }

  function bindPortfolio() {
    document.querySelectorAll("[data-report-view^='portfolio:']").forEach(button => button.addEventListener("click", () => {
      uiState.portfolio.view = button.dataset.reportView.split(":")[1];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#report-portfolio-period")?.addEventListener("change", event => { uiState.portfolio.period = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-portfolio-date-from")?.addEventListener("change", event => { uiState.portfolio.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-portfolio-date-to")?.addEventListener("change", event => { uiState.portfolio.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-portfolio-provider")?.addEventListener("change", event => { uiState.portfolio.providerId = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-portfolio-customer")?.addEventListener("change", event => { uiState.portfolio.customerId = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-portfolio-status")?.addEventListener("change", event => { uiState.portfolio.status = event.target.value; BlessERP.layout.renderPage(); });
    bindSharedActions();
  }

  function bindBanks() {
    document.querySelectorAll("[data-report-view^='banks:']").forEach(button => button.addEventListener("click", () => {
      uiState.banks.view = button.dataset.reportView.split(":")[1];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#report-banks-period")?.addEventListener("change", event => { uiState.banks.period = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-banks-date-from")?.addEventListener("change", event => { uiState.banks.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-banks-date-to")?.addEventListener("change", event => { uiState.banks.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-banks-account")?.addEventListener("change", event => { uiState.banks.bankAccountId = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-banks-status")?.addEventListener("change", event => { uiState.banks.status = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-banks-origin")?.addEventListener("change", event => { uiState.banks.originModule = event.target.value; BlessERP.layout.renderPage(); });
    bindSharedActions();
  }

  function bindInventory() {
    document.querySelectorAll("[data-report-view^='inventory:']").forEach(button => button.addEventListener("click", () => {
      uiState.inventory.view = button.dataset.reportView.split(":")[1];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#report-inventory-period")?.addEventListener("change", event => { uiState.inventory.period = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-inventory-date-from")?.addEventListener("change", event => { uiState.inventory.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-inventory-date-to")?.addEventListener("change", event => { uiState.inventory.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-inventory-product")?.addEventListener("change", event => { uiState.inventory.productId = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-inventory-category")?.addEventListener("change", event => { uiState.inventory.category = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-inventory-warehouse")?.addEventListener("change", event => { uiState.inventory.warehouseId = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-inventory-movement")?.addEventListener("change", event => { uiState.inventory.movementType = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#report-inventory-status")?.addEventListener("change", event => { uiState.inventory.status = event.target.value; BlessERP.layout.renderPage(); });
    bindSharedActions();
  }

  function bindSharedActions() {
    document.querySelectorAll("[data-report-placeholder]").forEach(button => button.addEventListener("click", () => {
      const [scope, action] = String(button.dataset.reportPlaceholder || "").split(":");
      adminService.addAuditLog({
        module: "REPORTES",
        action: "EXPORTAR_REPORTE",
        entityType: "REPORTE",
        entityId: `${scope || "reporte"}:${action || "accion"}`,
        entityLabel: scope || "reporte",
        description: `El usuario solicito ${action === "print" ? "imprimir" : `exportar ${action}`} en el reporte ${scope || "general"}.`,
        after: {
          scope: scope || "",
          action: action || "visual"
        }
      });
      uiState.message = action === "print"
        ? "La impresion quedara disponible en una siguiente fase del modulo de reportes."
        : `La opcion ${action === "excel" ? "Exportar Excel" : "Exportar PDF"} quedara habilitada en la siguiente etapa.`;
      BlessERP.layout.renderPage();
    }));
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Reports = { render };
})();
