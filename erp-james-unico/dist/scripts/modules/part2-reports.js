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
  const accountingDashboardService = BlessERP.services.accountingDashboardReadV2;
  const financialStatementsService = BlessERP.services.financialStatementsReadV2;
  const portfolioReportService = BlessERP.services.accountingPortfolioReportV2;
  const bankReportService = BlessERP.services.accountingBankReportV2;

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
    dashboardDraftFilters: {
      ...buildBaseState(),
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
      customerId: "",
      search: "",
      pageSize: 25
    },
    banks: {
      ...buildBaseState(),
      view: "movements",
      bankAccountId: "",
      originModule: "",
      type: "",
      search: "",
      pageSize: 25
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
      <div class="table-actions-inline report-download-actions">
        <button class="secondary-button" type="button" data-report-export-pdf="${esc(scope)}">Descargar PDF</button>
        <button class="secondary-button" type="button" data-report-export-xlsx="${esc(scope)}">Descargar XLSX</button>
      </div>
    `;
  }

  function filtersForScope(scope) {
    if (new Set(["trial-balance", "income-statement", "balance-sheet"]).has(scope)) {
      return financialStatementsService?.snapshot?.()?.reports?.[scope]?.appliedFilters || uiState.accounting;
    }
    if (new Set(["financial-statements", "account-movement", "general-ledger"]).has(scope)) return uiState.accounting;
    if (new Set(["tax-supports", "purchases", "sales", "tax-suppliers", "issued-withholdings", "received-withholdings"]).has(scope)) return uiState.tax;
    if (new Set(["payables-report", "receivables-report", "supplier-payments", "customer-collections"]).has(scope)) {
      const view = ({ "payables-report": "payables", "receivables-report": "receivables", "supplier-payments": "payments", "customer-collections": "collections" })[scope];
      return portfolioReportService?.snapshot?.()?.reports?.[view]?.appliedFilters || uiState.portfolio;
    }
    if (new Set(["bank-movements", "bank-balances", "bank-reconciliations"]).has(scope)) {
      const view = ({ "bank-movements": "movements", "bank-balances": "balances", "bank-reconciliations": "reconciliations" })[scope];
      return bankReportService?.snapshot?.()?.reports?.[view]?.appliedFilters || uiState.banks;
    }
    if (String(scope).startsWith("inventory-")) return uiState.inventory;
    if (scope === "dashboard-general") {
      return accountingDashboardService?.snapshot?.()?.appliedFilters || uiState.dashboardDraftFilters;
    }
    return uiState.dashboardDraftFilters;
  }

  async function reportPdf(scope) {
    const root = document.querySelector("#page-root");
    if (!root) return { ok: false, message: "No se encontro el reporte visible." };
    const output = window.open("", "_blank");
    if (!output) return { ok: false, message: "El navegador bloqueo la ventana del PDF. Habilite ventanas emergentes." };
    const company = BlessERP.services?.companyBranding?.resolve?.() || {};
    const filters = filtersForScope(scope);
    const cloneRoot = root.cloneNode(true);
    const portfolioView = ({
      "payables-report": "payables",
      "receivables-report": "receivables",
      "supplier-payments": "payments",
      "customer-collections": "collections"
    })[scope];
    if (portfolioView) {
      let exported;
      try {
        exported = await portfolioReportService?.exportAll?.(portfolioView);
      } catch (error) {
        output.close();
        throw error;
      }
      if (!exported?.ok || Number(exported.total || 0) !== Number(exported.items?.length || 0)) {
        output.close();
        return { ok: false, message: "El universo consultado de cartera no coincide con el PDF." };
      }
      const fullReport = { generated: true, rows: exported.items, summary: exported.summary || {}, total: exported.total, page: 1, pageSize: Math.max(1, exported.total) };
      cloneRoot.innerHTML = portfolioView === "payables" ? renderPayables(fullReport)
        : portfolioView === "receivables" ? renderReceivables(fullReport)
          : portfolioView === "payments" ? renderSupplierPayments(fullReport)
            : renderCustomerCollections(fullReport);
    }
    const bankView = ({ "bank-movements": "movements", "bank-balances": "balances", "bank-reconciliations": "reconciliations" })[scope];
    if (bankView) {
      let exported;
      try { exported = await bankReportService?.exportAll?.(bankView); }
      catch (error) { output.close(); throw error; }
      if (!exported?.ok || Number(exported.total || 0) !== Number(exported.items?.length || 0)) {
        output.close();
        return { ok: false, message: "El universo bancario consultado no coincide con el PDF." };
      }
      const fullReport = { generated: true, rows: exported.items, summary: exported.summary || {}, total: exported.total, page: 1, pageSize: Math.max(1, exported.total) };
      cloneRoot.innerHTML = bankView === "movements" ? renderBankMovements(fullReport)
        : bankView === "balances" ? renderBankBalances(fullReport)
          : renderBankReconciliations(fullReport);
    }
    cloneRoot.querySelectorAll([
      ".page-header",
      ".subnav-tabs",
      ".report-view-switcher",
      ".report-filter-grid",
      ".compact-toolbar",
      ".mini-route-grid",
      ".inline-feedback",
      "button",
      "input",
      "select",
      "textarea"
    ].join(",")).forEach(element => element.remove());
    const isPortraitFinancial = Boolean(cloneRoot.querySelector(".financial-statement-report"));
    const logoPath = company.logoDataUrl || company.logoPath || "scripts/assets/bless-flower-logo-official-transparent.png";
    const logoUrl = String(logoPath).startsWith("data:") ? logoPath : new URL(logoPath, document.baseURI).href;
    const safeName = String(scope || "reporte").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const fileName = `${safeName}-${filters.dateFrom || "inicio"}-${filters.dateTo || "fin"}.pdf`;
    try { output.opener = null; } catch (error) { void error; }
    output.document.open();
    output.document.write(`<!doctype html>
      <html lang="es"><head><meta charset="utf-8"><title>${esc(fileName.replace(/\.pdf$/i, ""))}</title>
      <style>
        @page{size:${isPortraitFinancial ? "A4 portrait" : "A4 landscape"};margin:12mm}
        *{box-sizing:border-box} body{margin:0;color:#10233e;font:10px Arial,sans-serif;background:#fff}
        .report-pdf-header{display:flex;align-items:center;gap:18px;border-bottom:2px solid #b9902d;padding:0 0 8px;margin-bottom:10px}
        .report-pdf-header img{width:150px;height:72px;object-fit:contain;object-position:left center}
        .report-pdf-header h1{font-size:18px;margin:0;color:#072e1b}.report-pdf-header p{margin:3px 0;color:#56657a}
        .panel-card{break-inside:avoid;margin:0 0 10px;padding:8px;border:1px solid #d9e1ea;border-radius:6px;background:#fff}
        .panel-card-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
        h3{margin:0 0 6px;font-size:13px;color:#073d28}.section-kicker{margin:0 0 2px;font-size:8px;letter-spacing:.12em;color:#9b7419}
        .summary-grid,.report-two-column{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px}
        .summary-card{border:1px solid #d9e1ea;border-left:3px solid #b9902d;padding:7px}.summary-card strong{display:block;font-size:14px;margin:3px 0}
        .info-row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid #edf0f4}
        table{width:100%;border-collapse:collapse;table-layout:auto} th{background:#073d28;color:#fff;font-weight:700;padding:5px 4px;border:1px solid #cdd7e0}
        td{padding:4px;border:1px solid #d9e1ea;vertical-align:top} tbody tr:nth-child(even){background:#f7faf8}
        .financial-statement-report{max-width:178mm;margin:0 auto}.financial-statement-report .compact-table-wrap{overflow:visible}
        .financial-statement-table{font-size:10.5px}.financial-statement-table th:nth-child(1),.financial-statement-table td:nth-child(1){width:22%}
        .financial-statement-table th:nth-child(2),.financial-statement-table td:nth-child(2){width:56%}
        .financial-statement-table th:nth-child(3),.financial-statement-table td:nth-child(3){width:22%;text-align:right}
        .financial-statement-table thead th:nth-child(3){text-align:right}
        .financial-group-row th{background:#e8f3ec!important;color:#073d28!important;text-align:left!important;padding:7px 6px!important;border-color:#b8d0c1!important}
        .financial-subtotal-row th{background:#f4f7f5!important;color:#10233e!important}
        .financial-result-row th{background:#073d28!important;color:#fff!important;font-size:11px}
        .financial-signatures{display:grid;grid-template-columns:1fr 1fr;gap:28mm;margin:24mm 10mm 0;break-inside:avoid}
        .financial-signature{text-align:center;color:#111}.financial-signature-line{border-top:1px solid #111;padding-top:5px;min-height:18px}
        .financial-signature strong,.financial-signature span{display:block}.financial-signature span{font-size:9px;margin-top:2px}
        small{display:block;color:#66758a}.status-badge{display:inline-block;padding:2px 5px;border:1px solid #b8c6d3;border-radius:10px}
        .report-bear{position:fixed;right:8mm;bottom:3mm;font-size:12px;opacity:.28}.report-bear span{font-size:8px;margin-left:4px}
      </style></head><body>
        <header class="report-pdf-header"><img src="${logoUrl}" alt="Bless Flower"><div><h1>${esc(company.commercialName || company.legalName || "Bless Flower")}</h1><p>${esc(company.legalName || "")}</p><p>Periodo: ${esc(filters.dateFrom || "inicio")} al ${esc(filters.dateTo || "fin")}</p></div></header>
        ${cloneRoot.innerHTML}
        <div class="report-bear">🐻 <span>BLESS FLOWER · ECUADOR</span></div>
      </body></html>`);
    output.document.close();
    const launch = () => {
      output.focus();
      output.print();
    };
    if (output.document.readyState === "complete") setTimeout(launch, 180);
    else output.addEventListener("load", () => setTimeout(launch, 180), { once: true });
    return { ok: true, fileName };
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
    const filters = uiState.dashboardDraftFilters;
    accountingDashboardService?.setActiveRoute?.(route.id);
    void accountingDashboardService?.start?.(() => {
      if (BlessERP.state?.currentRoute?.()?.id === "reports-dashboard") BlessERP.layout.renderPage();
    });
    const dashboard = accountingDashboardService?.snapshot?.() || {};
    const summary = dashboard.summary || {};
    const applied = dashboard.appliedFilters || {};
    const dashboardResult = dashboard.generated ? `
      ${summaryCards([
        { label: "Total compras del periodo", value: money(summary.totalPurchases), note: "Purchase V2 · fecha contable/emisión" },
        { label: "Cuentas por pagar pendientes", value: money(summary.pendingPayables), note: "Supplier Finance V2 · saldo vigente" },
        { label: "Cuentas por cobrar pendientes", value: money(summary.pendingReceivables), note: "Financial V2 · saldo vigente" },
        { label: "Bancos: saldo auxiliar", value: money(summary.totalBankAuxiliary), note: "Treasury V2 · saldo vigente" },
        { label: "Asientos contabilizados", value: esc(String(summary.journalPosted || 0)), note: "Financial V2 · periodo contable" },
        { label: "Asientos en borrador", value: esc(String(summary.journalDrafts || 0)), note: "Financial V2 · periodo contable" },
        { label: "Retenciones emitidas pendientes", value: esc(String(summary.pendingIssuedWithholdings || 0)), note: "Documento 07 / compatibilidad" },
        { label: "Retenciones recibidas pendientes", value: esc(String(summary.pendingReceivedWithholdings || 0)), note: "Pendientes de aplicar o relacionar" },
        { label: "Productos bajo stock minimo", value: esc(String(summary.lowStockProducts || 0)), note: "Solo inventario administrativo" },
        { label: "Conciliaciones abiertas", value: esc(String(summary.openReconciliations || 0)), note: "Borrador, revisión o reabierta" },
        { label: "Conciliaciones cerradas", value: esc(String(summary.closedReconciliations || 0)), note: "Cierre bancario registrado" },
        { label: "Inventario valorizado", value: money(summary.inventoryValue), note: "Suministros y materiales" }
      ])}
      <section class="report-two-column">
        <article class="panel-card">
          ${renderSectionHeader("INDICADORES", "Radar contable", exportActions("dashboard-general"))}
          <div class="info-stack">
            <div class="info-row"><strong>Alertas contables</strong><span>${esc(String(summary.accountingAlerts || 0))}</span></div>
            <div class="info-row"><strong>Periodo consultado</strong><span>${esc(applied.period || "-")}</span></div>
            <div class="info-row"><strong>Rango aplicado</strong><span>${esc(`${applied.dateFrom || "-"} a ${applied.dateTo || "-"}`)}</span></div>
            <div class="info-row"><strong>Estado de compra</strong><span>${esc(applied.status || applied.purchaseStatus || "Todos")}</span></div>
            <div class="info-row"><strong>Actualización</strong><span>${dashboard.stale ? "Actualizando…" : "Vigente"}</span></div>
          </div>
          <p class="panel-note">PostgreSQL devolvió exclusivamente agregados. No se descargaron asientos, compras, carteras, movimientos ni inventario individual.</p>
        </article>
        <article class="panel-card">
          ${renderSectionHeader("ALCANCE", "Modulos cubiertos")}
          <div class="mini-route-grid">
            <button class="mini-route-card" data-route-link="reports-accounting"><strong>Reportes contables</strong><span>Balance, mayor y estados financieros validados</span></button>
            <button class="mini-route-card" data-route-link="reports-tax"><strong>Reportes tributarios</strong><span>Compras y retenciones base</span></button>
            <button class="mini-route-card" data-route-link="reports-portfolio"><strong>Reportes de cartera</strong><span>CxP, CxC, pagos y cobros</span></button>
            <button class="mini-route-card" data-route-link="reports-banks"><strong>Reportes bancarios</strong><span>Movimientos, saldos y conciliaciones</span></button>
            <button class="mini-route-card" data-route-link="reports-inventory"><strong>Reportes de inventario</strong><span>Stock, kardex y consumos</span></button>
          </div>
        </article>
      </section>
    ` : `
      <article class="panel-card">
        ${renderSectionHeader("GENERATE-FIRST", "Dashboard sin generar")}
        ${renderEmpty("Selecciona el período y pulsa Generar Dashboard. No se han consultado datos financieros históricos.")}
      </article>
    `;

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
            <span>Estado de compra</span>
            <select id="report-dashboard-status">
              <option value="">Todos</option>
              <option value="BORRADOR" ${filters.status === "BORRADOR" ? "selected" : ""}>BORRADOR</option>
              <option value="CONTABILIZADO" ${filters.status === "CONTABILIZADO" ? "selected" : ""}>CONTABILIZADO</option>
              <option value="CONFIRMADO" ${filters.status === "CONFIRMADO" ? "selected" : ""}>CONFIRMADO</option>
            </select>
          </label>
          <button class="primary-button" id="report-dashboard-generate" type="button" ${dashboard.loading ? "disabled" : ""}>${dashboard.loading ? "Generando…" : "Generar Dashboard"}</button>
        </div>
      </section>
      ${dashboard.error ? `<section class="inline-feedback danger">${esc(dashboard.error)}</section>` : ""}
      ${dashboardResult}
    `;

    bindDashboard();
  }

  function renderAccountingValidation(validation, equation, visibleDifference = null) {
    const journalAudit = validation?.journalAudit || {};
    const catalogAudit = validation?.catalogAudit || {};
    const balanced = Boolean(validation?.isBalanced);
    return `
      <section class="accounting-control-strip ${balanced ? "balanced" : "unbalanced"}">
        <div class="accounting-control-status">
          <span class="status-badge ${balanced ? "authorized" : "pending"}">${balanced ? "CUADRADO" : "REVISAR DIFERENCIA"}</span>
          <strong>${esc(equation)}</strong>
        </div>
        <div><span>Diferencia de control</span><strong>${money(Math.abs(Number(validation?.difference || 0)))}</strong></div>
        ${visibleDifference === null ? "" : `<div><span>Diferencia de filas visibles</span><strong>${money(Math.abs(Number(visibleDifference || 0)))}</strong></div>`}
        <div><span>Asientos revisados</span><strong>${esc(String(journalAudit.checkedEntries || 0))} / ${esc(String(journalAudit.totalEntries || 0))}</strong></div>
        <div><span>Catalogo 1 a 5</span><strong>${catalogAudit.isValid ? "VALIDO" : `${esc(String((catalogAudit.invalidAccounts || []).length))} observaciones`}</strong></div>
      </section>
      <p class="accounting-control-note">Ventas e Inventario quedan pendientes de validacion funcional hasta definir el inventario contable. Su igualdad Debe/Haber se controla siempre y no se permite contabilizar diferencias.</p>
      ${(journalAudit.invalidEntries || []).length ? `<section class="inline-feedback danger">${esc(String(journalAudit.invalidEntries.length))} asiento(s) contabilizado(s) requieren correccion estructural.</section>` : ""}
    `;
  }

  function renderTrialBalance(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("BALANCE", "Balance de comprobacion", exportActions("trial-balance"))}
        ${renderAccountingValidation(report.validation, "Debe = Haber", report.totals.difference)}
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
                <th colspan="3">Totales visibles</th>
                <th>${money(report.totals.debit)}</th>
                <th>${money(report.totals.credit)}</th>
                <th colspan="3">Diferencia: ${money(Math.abs(report.totals.difference))}</th>
              </tr>
              <tr>
                <th colspan="3">Control general del periodo</th>
                <th>${money(report.controlTotals.debit)}</th>
                <th>${money(report.controlTotals.credit)}</th>
                <th colspan="3">Diferencia: ${money(Math.abs(report.controlTotals.difference))}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>
    `;
  }

  function renderIncomeStatement(report) {
    const company = BlessERP.services?.companyBranding?.resolve?.() || {};
    return `
      ${renderAccountingValidation(report.validation, "Ingresos - Costos - Gastos = Resultado")}
      <article class="panel-card financial-statement-report">
        ${renderSectionHeader("ESTADO FINANCIERO", "Estado de resultados", exportActions("income-statement"))}
        <div class="compact-table-wrap">
          <table class="compact-table financial-statement-table">
            <thead><tr><th>Codigo</th><th>Cuenta contable</th><th>Saldo USD</th></tr></thead>
            <tbody>
              ${report.sections.map(section => `
                <tr class="financial-group-row"><th colspan="3">${esc(section.label.toUpperCase())}</th></tr>
                ${section.rows.map(row => `
                  <tr>
                    <td>${esc(row.code)}</td>
                    <td style="padding-left:${Math.max(8, Number(row.level || 1) * 14)}px">${esc(row.name)}</td>
                    <td>${money(row.finalSigned)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="3">${renderEmpty("Sin movimientos para esta seccion.")}</td></tr>`}
                <tr class="financial-subtotal-row"><th colspan="2">Total ${esc(section.label)}</th><th>${money(section.total)}</th></tr>
              `).join("")}
              <tr class="financial-result-row"><th colspan="2">RESULTADO DEL PERIODO</th><th>${money(report.resultPeriod)}</th></tr>
            </tbody>
          </table>
        </div>
        ${renderFinancialSignatures(company)}
      </article>
    `;
  }

  function renderFinancialSignatures(company = {}) {
    const representative = company.legalRepresentative || company.representativeName || company.legalName || "";
    const accountant = company.accountantName || company.contadorName || "";
    return `
      <footer class="financial-signatures" aria-label="Firmas del estado financiero">
        <div class="financial-signature">
          <div class="financial-signature-line">
            <strong>Firma del representante legal</strong>
            ${representative ? `<span>${esc(representative)}</span>` : ""}
          </div>
        </div>
        <div class="financial-signature">
          <div class="financial-signature-line">
            <strong>Firma del contador</strong>
            ${accountant ? `<span>${esc(accountant)}</span>` : ""}
          </div>
        </div>
      </footer>
    `;
  }

  function renderBalanceSheet(report) {
    const company = BlessERP.services?.companyBranding?.resolve?.() || {};
    return `
      ${renderAccountingValidation(report.validation, "Activos = Pasivos + Patrimonio + Resultado")}
      <article class="panel-card financial-statement-report">
        ${renderSectionHeader("ESTADO FINANCIERO", "Balance general", exportActions("balance-sheet"))}
        <div class="compact-table-wrap">
          <table class="compact-table financial-statement-table">
            <thead><tr><th>Codigo</th><th>Cuenta contable</th><th>Saldo USD</th></tr></thead>
            <tbody>
              ${report.sections.map(section => `
                <tr class="financial-group-row"><th colspan="3">${esc(section.label.toUpperCase())}</th></tr>
                ${section.rows.map(row => `
                  <tr>
                    <td>${esc(row.code)}</td>
                    <td style="padding-left:${Math.max(8, Number(row.level || 1) * 14)}px">${esc(row.name)}</td>
                    <td>${money(row.finalSigned)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="3">${renderEmpty("Sin movimientos para esta seccion.")}</td></tr>`}
                <tr class="financial-subtotal-row"><th colspan="2">Total ${esc(section.label)}</th><th>${money(section.total)}</th></tr>
              `).join("")}
              <tr class="financial-subtotal-row"><th colspan="2">Resultado del periodo</th><th>${money(report.resultPeriod)}</th></tr>
              <tr class="financial-result-row"><th colspan="2">PATRIMONIO + RESULTADO</th><th>${money(report.patrimonyWithResult)}</th></tr>
              <tr class="financial-subtotal-row"><th colspan="2">DIFERENCIA DE CONTROL</th><th>${money(report.validation?.difference || 0)}</th></tr>
            </tbody>
          </table>
        </div>
        ${renderFinancialSignatures(company)}
      </article>
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

  function renderGeneralLedger(report) {
    return `
      ${summaryCards([
        { label: "Cuentas", value: esc(String(report.totals.accounts)), note: "Mayores con movimiento o saldo" },
        { label: "Movimientos", value: esc(String(report.totals.movements)), note: "Lineas contabilizadas" },
        { label: "Total debe", value: money(report.totals.debit), note: "Acumulado del rango" },
        { label: "Total haber", value: money(report.totals.credit), note: "Acumulado del rango" }
      ])}
      <article class="panel-card">
        ${renderSectionHeader("MOVIMIENTO", "Mayor general", exportActions("general-ledger"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Codigo</th><th>Cuenta</th><th>Saldo inicial</th><th>Debe</th><th>Haber</th><th>Saldo final</th><th>Movimientos</th></tr></thead>
            <tbody>
              ${report.ledgers.map(ledger => `
                <tr>
                  <td><strong>${esc(ledger.account.code)}</strong></td>
                  <td>${esc(ledger.account.name)}</td>
                  <td>${money(ledger.initialBalance)}</td>
                  <td>${money(ledger.totals.debit)}</td>
                  <td>${money(ledger.totals.credit)}</td>
                  <td>${money(ledger.finalBalance)}</td>
                  <td>${esc(String(ledger.rows.length))}</td>
                </tr>
              `).join("") || `<tr><td colspan="7">${renderEmpty("No hay cuentas con movimiento para estos filtros.")}</td></tr>`}
            </tbody>
            <tfoot><tr><th colspan="3">Totales</th><th>${money(report.totals.debit)}</th><th>${money(report.totals.credit)}</th><th></th><th>${esc(String(report.totals.movements))}</th></tr></tfoot>
          </table>
        </div>
      </article>
    `;
  }

  function renderAccounting(container, route) {
    const filters = uiState.accounting;
    const accountOptions = chartService.movementOptions();
    const showsAccountFilters = filters.view === "trial-balance";
    const financialView = ["trial-balance", "income-statement", "balance-sheet"].includes(filters.view);
    financialStatementsService?.setActiveRoute?.(route.id);
    financialStatementsService?.setActiveView?.(filters.view);
    void financialStatementsService?.start?.(() => {
      const activeRoute = BlessERP.state?.currentRoute?.()?.id;
      if (["accounting-financials", "reports-accounting"].includes(activeRoute)) BlessERP.layout.renderPage();
    });
    const financialRuntime = financialStatementsService?.snapshot?.() || {};
    const financialState = financialRuntime.reports?.[filters.view] || {};
    const financialFilterKeys = filters.view === "trial-balance"
      ? ["dateFrom", "dateTo", "accountCode", "accountType", "includeZeroRows"]
      : ["dateFrom", "dateTo"];
    const financialFiltersDirty = Boolean(financialState.generated && financialState.appliedFilters
      && financialFilterKeys.some(key => String(financialState.appliedFilters[key] ?? "") !== String(filters[key] ?? "")));
    const accountingModuleRoute = route.id === "accounting-financials";
    const viewOptions = [
      { id: "trial-balance", label: "Balance de comprobacion", scope: "accounting" },
      { id: "income-statement", label: "Estado de resultados", scope: "accounting" },
      { id: "balance-sheet", label: "Balance general", scope: "accounting" }
    ];
    const report = financialState.report;

    let content = "";
    if (financialView && !financialState.generated) {
      content = `<article class="panel-card">${renderEmpty("Selecciona el período y pulsa Generar.")}</article>`;
    }
    if (filters.view === "trial-balance" && report) content = renderTrialBalance(report);
    if (filters.view === "income-statement" && report) content = renderIncomeStatement(report);
    if (filters.view === "balance-sheet" && report) content = renderBalanceSheet(report);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${accountingModuleRoute ? "Balance de comprobacion y estados financieros" : "Reportes contables"}</h1>
          <p>Balance de comprobacion y estados financieros con validacion automatica de cuadre y catalogo contable.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Solo lectura</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${renderMessage()}
      <section class="panel-card compact-toolbar-card">
        ${renderSectionHeader("VISTAS", "Generar. Descargar solamente el reporte visible", financialState.generated ? `${exportActions(filters.view)}<button class="secondary-button" type="button" data-route-link="accounting-ledger">Abrir Mayor General</button>` : `<button class="secondary-button" type="button" data-route-link="accounting-ledger">Abrir Mayor General</button>`)}
        ${reportSwitch(filters.view, viewOptions)}
        <div class="compact-toolbar report-filter-grid">
          <label class="compact-inline-field"><span>Periodo</span><input id="report-accounting-period" type="month" value="${esc(filters.period)}"></label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="report-accounting-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="report-accounting-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          ${showsAccountFilters ? `
            <label class="compact-inline-field">
              <span>Tipo de cuenta</span>
              <select id="report-accounting-type">
                <option value="">Todos</option>
                ${chartService.accountTypes.map(item => `<option value="${esc(item)}" ${filters.accountType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-inline-field">
              <span>Cuenta contable</span>
              <select id="report-accounting-account">
                <option value="">Todas / vista general</option>
                ${accountOptions.map(account => `<option value="${esc(account.code)}" ${filters.accountCode === account.code ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
              </select>
            </label>
          ` : ""}
          ${showsAccountFilters ? `
            <label class="compact-inline-field compact-inline-checkbox">
              <span>Ver filas en cero</span>
              <input id="report-accounting-zero-rows" type="checkbox" ${filters.includeZeroRows ? "checked" : ""}>
            </label>
          ` : ""}
          ${financialView ? `<button class="primary-button" id="report-accounting-generate" type="button" ${financialState.loading ? "disabled" : ""}>${financialState.loading ? "Generando…" : "Generar"}</button>` : ""}
        </div>
      </section>
      ${financialRuntime.healthError ? `<section class="inline-feedback danger">${esc(financialRuntime.healthError)}</section>` : ""}
      ${financialState.error ? `<section class="inline-feedback danger">${esc(financialState.error)}</section>` : ""}
      ${financialState.stale ? `<section class="inline-feedback pending">Datos contables actualizados; refrescando el reporte aplicado.</section>` : ""}
      ${financialFiltersDirty ? `<section class="inline-feedback pending">Filtros modificados. Pulsa Generar para aplicarlos; el reporte y la descarga mantienen el último rango generado.</section>` : ""}
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

  function renderPurchases(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("TRIBUTARIO", "Compras", exportActions("purchases"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>RUC</th><th>Documento</th><th>Base 0%</th><th>Base IVA</th><th>IVA</th><th>No objeto</th><th>Exento</th><th>Total</th><th>Retenciones</th><th>Estado</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.issueDate)}</td><td>${esc(row.supplierName)}</td><td>${esc(row.supplierRuc)}</td>
                  <td>${esc(row.documentNumber)}</td><td>${money(row.base0)}</td><td>${money(row.baseIva)}</td>
                  <td>${money(row.iva)}</td><td>${money(row.noVatBase)}</td><td>${money(row.exemptBase)}</td>
                  <td>${money(row.total)}</td><td>${money(row.retentionTotal)}</td><td>${statusBadge(row.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="12">${renderEmpty("No hay compras para estos filtros.")}</td></tr>`}
            </tbody>
            <tfoot><tr><th colspan="4">Totales</th><th>${money(report.totals.base0)}</th><th>${money(report.totals.baseIva)}</th><th>${money(report.totals.iva)}</th><th>${money(report.totals.noVatBase)}</th><th>${money(report.totals.exemptBase)}</th><th>${money(report.totals.total)}</th><th>${money(report.totals.retentionTotal)}</th><th></th></tr></tfoot>
          </table>
        </div>
      </article>
    `;
  }

  function renderSales(report) {
    return `
      <article class="panel-card">
        ${renderSectionHeader("TRIBUTARIO", "Ventas autorizadas", exportActions("sales"))}
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Marca</th><th>Pais</th><th>DAE</th><th>Cajas</th><th>Ramos</th><th>Tallos</th><th>Total</th><th>Notas credito</th><th>Venta neta</th></tr></thead>
            <tbody>
              ${report.rows.map(row => `
                <tr>
                  <td>${esc(row.issueDate)}</td><td>${esc(row.documentNumber)}</td><td>${esc(row.customerName)}</td>
                  <td>${esc(row.brandName)}</td><td>${esc(row.country)}</td><td>${esc(row.dae || "-")}</td>
                  <td>${esc(String(row.boxes))}</td><td>${esc(String(row.bunches))}</td><td>${esc(String(row.stems))}</td>
                  <td>${money(row.total)}</td><td>${money(row.credited)}</td><td>${money(row.netTotal)}</td>
                </tr>
              `).join("") || `<tr><td colspan="12">${renderEmpty("No hay facturas autorizadas para estos filtros.")}</td></tr>`}
            </tbody>
            <tfoot><tr><th colspan="6">Totales</th><th>${esc(String(report.totals.boxes))}</th><th>${esc(String(report.totals.bunches))}</th><th>${esc(String(report.totals.stems))}</th><th>${money(report.totals.total)}</th><th>${money(report.totals.credited)}</th><th>${money(report.totals.netTotal)}</th></tr></tfoot>
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
      { id: "purchases", label: "Compras", scope: "tax" },
      { id: "sales", label: "Ventas", scope: "tax" },
      { id: "supports", label: "Compras por sustento", scope: "tax" },
      { id: "suppliers", label: "Compras por proveedor", scope: "tax" },
      { id: "issued", label: "Retenciones emitidas", scope: "tax" },
      { id: "received", label: "Retenciones recibidas", scope: "tax" }
    ];

    const report = filters.view === "purchases"
      ? reportsService.purchasesReport(filters)
      : filters.view === "sales"
        ? reportsService.salesReport(filters)
        : filters.view === "supports"
      ? reportsService.purchasesByTaxSupport(filters)
      : filters.view === "suppliers"
        ? reportsService.purchasesBySupplier(filters)
        : filters.view === "issued"
          ? reportsService.issuedWithholdingsReport(filters)
          : reportsService.receivedWithholdingsReport(filters);

    const cards = filters.view === "purchases"
      ? [
          { label: "Compras", value: esc(String(report.rows.length)), note: "Documentos del rango" },
          { label: "Total", value: money(report.totals.total), note: "Total compras" },
          { label: "IVA", value: money(report.totals.iva), note: "IVA registrado" },
          { label: "Retenciones", value: money(report.totals.retentionTotal), note: "Renta + IVA" }
        ]
      : filters.view === "sales"
        ? [
            { label: "Facturas autorizadas", value: esc(String(report.rows.length)), note: "SRI AUTORIZADO" },
            { label: "Venta bruta", value: money(report.totals.total), note: "Antes de notas de credito" },
            { label: "Notas de credito", value: money(report.totals.credited), note: "Autorizadas" },
            { label: "Venta neta", value: money(report.totals.netTotal), note: "Factura menos notas" }
          ]
      : filters.view === "supports"
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
    if (filters.view === "purchases") content = renderPurchases(report);
    if (filters.view === "sales") content = renderSales(report);
    if (filters.view === "supports") content = renderPurchasesBySupport(report);
    if (filters.view === "suppliers") content = renderPurchasesBySupplier(report);
    if (filters.view === "issued") content = renderIssuedWithholdings(report);
    if (filters.view === "received") content = renderReceivedWithholdings(report);

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>Reportes tributarios</h1>
          <p>Compras, ventas autorizadas y retenciones separadas por empresa para control tributario y ATS.</p>
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
          ${filters.view === "sales" ? "" : `<label class="compact-inline-field">
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
          </label>`}
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
            <thead><tr><th>Proveedor</th><th>Documento</th><th>Fecha emision</th><th>Fecha vencimiento</th><th>Total</th><th>Retenciones</th><th>Pagado</th><th>Saldo</th><th>Estado</th><th>Dias vencidos</th><th>Detalle</th></tr></thead>
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
                  <td><button class="secondary-button" type="button" data-portfolio-detail="${esc(row.id)}">Ver</button></td>
                </tr>
              `).join("") || `<tr><td colspan="11">${renderEmpty("No hay cuentas por pagar para estos filtros.")}</td></tr>`}
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
            <thead><tr><th>Cliente</th><th>Documento</th><th>Fecha emision</th><th>Fecha vencimiento</th><th>Total</th><th>Retenciones</th><th>Cobrado</th><th>Saldo</th><th>Estado</th><th>Dias vencidos</th><th>Detalle</th></tr></thead>
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
                  <td><button class="secondary-button" type="button" data-portfolio-detail="${esc(row.id)}">Ver</button></td>
                </tr>
              `).join("") || `<tr><td colspan="11">${renderEmpty("No hay cuentas por cobrar para estos filtros.")}</td></tr>`}
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
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Documento pagado</th><th>Medio pago</th><th>Cuenta pago</th><th>Valor</th><th>Estado</th><th>Asiento</th><th>Detalle</th></tr></thead>
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
                  <td><button class="secondary-button" type="button" data-portfolio-detail="${esc(row.id)}">Ver</button></td>
                </tr>
              `).join("") || `<tr><td colspan="9">${renderEmpty("No hay pagos para estos filtros.")}</td></tr>`}
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
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Documento cobrado</th><th>Medio cobro</th><th>Cuenta cobro</th><th>Valor</th><th>Estado</th><th>Asiento</th><th>Detalle</th></tr></thead>
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
                  <td><button class="secondary-button" type="button" data-portfolio-detail="${esc(row.id)}">Ver</button></td>
                </tr>
              `).join("") || `<tr><td colspan="9">${renderEmpty("No hay cobros para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderPortfolioPager(report) {
    if (!report?.generated || Number(report.total || 0) <= Number(report.pageSize || 25)) return "";
    const pages = Math.max(1, Math.ceil(Number(report.total || 0) / Number(report.pageSize || 25)));
    return `<div class="pagination-bar"><button class="secondary-button" type="button" data-portfolio-page="${report.page - 1}" ${report.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${report.page} · ${Math.min((report.page - 1) * report.pageSize + 1, report.total)}–${Math.min(report.page * report.pageSize, report.total)} de ${report.total}</span><button class="secondary-button" type="button" data-portfolio-page="${report.page + 1}" ${report.page >= pages ? "disabled" : ""}>Siguiente</button></div>`;
  }

  function renderPortfolioDetail(detail) {
    if (!detail) return "";
    const data = detail.data || {};
    const item = data.item || {};
    const applications = data.applications || [];
    const journal = data.journal?.header || {};
    return `<article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">DETALLE LAZY</p><h3>${esc(detail.row?.documentNumber || detail.row?.paymentNumber || detail.row?.collectionNumber || detail.row?.id || "Registro")}</h3></div><button class="secondary-button" type="button" data-portfolio-detail-close>Cerrar</button></div><div class="info-stack"><div class="info-row"><strong>Fuente</strong><span>${esc(detail.row?.source || data.source || "-")}</span></div><div class="info-row"><strong>Aplicaciones</strong><span>${esc(String(applications.length))}</span></div><div class="info-row"><strong>Asiento</strong><span>${esc(journal.entry_number || journal.entryNumber || detail.row?.entryNumber || detail.row?.journalEntryId || "-")}</span></div><div class="info-row"><strong>Referencia</strong><span>${esc(item.reference || item.document_number || item.documentNumber || "-")}</span></div></div><p class="panel-note">Solo se consultó el registro seleccionado mediante el detail read-model existente.</p></article>`;
  }

  function renderPortfolio(container, route) {
    const filters = uiState.portfolio;
    portfolioReportService?.setActiveRoute?.(route.id);
    void portfolioReportService?.start?.(() => {
      if (BlessERP.state?.currentRoute?.()?.id === "reports-portfolio") BlessERP.layout.renderPage();
    });
    const runtime = portfolioReportService?.snapshot?.() || { reports: {} };
    const viewOptions = [
      { id: "payables", label: "Cuentas por pagar", scope: "portfolio" },
      { id: "receivables", label: "Cuentas por cobrar", scope: "portfolio" },
      { id: "payments", label: "Pagos a proveedores", scope: "portfolio" },
      { id: "collections", label: "Cobros a clientes", scope: "portfolio" }
    ];

    const state = runtime.reports?.[filters.view] || { generated: false, loading: false, items: [], total: 0, summary: {}, page: 1, pageSize: filters.pageSize };
    const report = { ...state, rows: state.items || [] };

    let content = "";
    if (state.generated && filters.view === "payables") content = renderPayables(report);
    if (state.generated && filters.view === "receivables") content = renderReceivables(report);
    if (state.generated && filters.view === "payments") content = renderSupplierPayments(report);
    if (state.generated && filters.view === "collections") content = renderCustomerCollections(report);
    if (!state.generated) content = `<article class="panel-card">${renderSectionHeader("GENERATE-FIRST", "Reporte sin generar")}${renderEmpty("Selecciona los filtros y pulsa Generar reporte. No se han consultado datos históricos de cartera.")}</article>`;

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
          <label class="compact-inline-field"><span>Buscar</span><input id="report-portfolio-search" type="search" value="${esc(filters.search)}" placeholder="Documento o tercero"></label>
          <label class="compact-inline-field"><span>Filas</span><select id="report-portfolio-page-size"><option value="25" ${Number(filters.pageSize) === 25 ? "selected" : ""}>25</option><option value="50" ${Number(filters.pageSize) === 50 ? "selected" : ""}>50</option></select></label>
          <button class="primary-button" id="report-portfolio-generate" type="button" ${state.loading ? "disabled" : ""}>${state.loading ? "Generando…" : "Generar reporte"}</button>
        </div>
      </section>
      ${runtime.error ? `<section class="inline-feedback danger">${esc(runtime.error)}</section>` : ""}
      ${state.generated ? `<p class="panel-note">${state.stale ? "Actualizando…" : "Consulta vigente"} · ${esc(String(state.total || 0))} filas en el universo aplicado · página ${esc(String(state.page || 1))}.</p>` : ""}
      ${content}
      ${renderPortfolioPager(state)}
      ${renderPortfolioDetail(runtime.detail)}
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
            <thead><tr><th>Cuenta bancaria</th><th>Periodo</th><th>Saldo banco</th><th>Saldo libros</th><th>Diferencia</th><th>Estado</th><th>Fecha cierre</th><th>Observaciones</th><th>Detalle</th></tr></thead>
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
                  <td><button class="secondary-button" type="button" data-bank-detail="${esc(row.id)}">Ver</button></td>
                </tr>
              `).join("") || `<tr><td colspan="9">${renderEmpty("No hay conciliaciones para estos filtros.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderBankPager(report) {
    if (!report?.generated || Number(report.total || 0) <= Number(report.pageSize || 25)) return "";
    const pages = Math.max(1, Math.ceil(Number(report.total || 0) / Number(report.pageSize || 25)));
    return `<div class="pagination-bar"><button class="secondary-button" type="button" data-bank-page="${report.page - 1}" ${report.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${report.page} · ${Math.min((report.page - 1) * report.pageSize + 1, report.total)}–${Math.min(report.page * report.pageSize, report.total)} de ${report.total}</span><button class="secondary-button" type="button" data-bank-page="${report.page + 1}" ${report.page >= pages ? "disabled" : ""}>Siguiente</button></div>`;
  }

  function renderBankDetail(detail) {
    if (!detail) return "";
    const data = detail.data || {};
    return `<article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">DETALLE LAZY</p><h3>${esc(detail.row?.reconciliationNumber || detail.row?.id || "Conciliación")}</h3></div><button class="secondary-button" type="button" data-bank-detail-close>Cerrar</button></div><div class="info-stack"><div class="info-row"><strong>Movimientos libros</strong><span>${esc(String(data.systemRows?.length || 0))}</span></div><div class="info-row"><strong>Movimientos extracto</strong><span>${esc(String(data.statementRows?.length || 0))}</span></div><div class="info-row"><strong>Relaciones</strong><span>${esc(String(data.matches?.length || 0))}</span></div><div class="info-row"><strong>Observaciones</strong><span>${esc(String(data.reviews?.length || 0))}</span></div></div><p class="panel-note">Solo se consultó la conciliación seleccionada mediante el detail read-model existente.</p></article>`;
  }

  function renderBanks(container, route) {
    const filters = uiState.banks;
    bankReportService?.setActiveRoute?.(route.id);
    void bankReportService?.start?.(() => {
      if (BlessERP.state?.currentRoute?.()?.id === "reports-banks") BlessERP.layout.renderPage();
    });
    const runtime = bankReportService?.snapshot?.() || { reports: {} };
    const viewOptions = [
      { id: "movements", label: "Movimientos bancarios", scope: "banks" },
      { id: "balances", label: "Saldos por banco", scope: "banks" },
      { id: "reconciliations", label: "Conciliaciones", scope: "banks" }
    ];

    const state = runtime.reports?.[filters.view] || { generated: false, loading: false, items: [], total: 0, summary: {}, page: 1, pageSize: filters.pageSize };
    const report = { ...state, rows: state.items || [] };
    const summary = state.summary || {};

    const cards = filters.view === "movements"
      ? [
          { label: "Movimientos", value: esc(String(summary.totalMovements || 0)), note: "Universo filtrado" },
          { label: "Ingresos", value: money(summary.totalIncome), note: "Agregado server-side" },
          { label: "Egresos", value: money(summary.totalExpense), note: "Agregado server-side" },
          { label: "Saldo libros", value: money(summary.closingBalance), note: `Inicial ${money(summary.openingBalance)}` }
        ]
      : filters.view === "balances"
        ? [
            { label: "Cuentas", value: esc(String(summary.totalAccounts || 0)), note: "Universo filtrado" },
            { label: "Saldo inicial", value: money(summary.openingBalance), note: "Libros antes de Desde" },
            { label: "Ingresos / egresos", value: `${money(summary.totalIncome)} / ${money(summary.totalExpense)}`, note: "Solo libros" },
            { label: "Saldo libros", value: money(summary.closingBalance), note: `Extracto neto ${money(summary.realStatementNet)}` }
          ]
        : [
            { label: "Conciliaciones", value: esc(String(summary.totalReconciliations || 0)), note: "Universo filtrado" },
            { label: "Cerradas", value: esc(String(summary.closed || 0)), note: "Listas" },
            { label: "Abiertas", value: esc(String(summary.open || 0)), note: "En revisión" },
            { label: "Diferencia total", value: money(summary.totalDifference), note: "Agregado server-side" }
          ];

    let content = "";
    if (state.generated && filters.view === "movements") content = renderBankMovements(report);
    if (state.generated && filters.view === "balances") content = renderBankBalances(report);
    if (state.generated && filters.view === "reconciliations") content = renderBankReconciliations(report);
    if (!state.generated) content = `<article class="panel-card">${renderSectionHeader("GENERATE-FIRST", "Reporte sin generar")}${renderEmpty("Selecciona los filtros y pulsa Generar reporte. No se han consultado datos históricos bancarios.")}</article>`;

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
          <label class="compact-inline-field"><span>Tipo</span><select id="report-banks-type"><option value="">Todos</option><option value="INGRESO" ${filters.type === "INGRESO" ? "selected" : ""}>INGRESO</option><option value="EGRESO" ${filters.type === "EGRESO" ? "selected" : ""}>EGRESO</option></select></label>
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
          <label class="compact-inline-field"><span>Buscar</span><input id="report-banks-search" type="search" value="${esc(filters.search)}" placeholder="Referencia, cuenta u origen"></label>
          <label class="compact-inline-field"><span>Filas</span><select id="report-banks-page-size"><option value="25" ${Number(filters.pageSize) === 25 ? "selected" : ""}>25</option><option value="50" ${Number(filters.pageSize) === 50 ? "selected" : ""}>50</option></select></label>
          <button class="primary-button" id="report-banks-generate" type="button" ${state.loading ? "disabled" : ""}>${state.loading ? "Generando…" : "Generar reporte"}</button>
        </div>
      </section>
      ${runtime.error ? `<section class="inline-feedback danger">${esc(runtime.error)}</section>` : ""}
      ${state.generated ? summaryCards(cards) : ""}
      ${state.generated ? `<p class="panel-note">${state.stale ? "Actualizando…" : "Consulta vigente"} · ${esc(String(state.total || 0))} filas en el universo aplicado · página ${esc(String(state.page || 1))}. SALDO LIBROS y SALDO EXTRACTO permanecen separados.</p>` : ""}
      ${content}
      ${renderBankPager(state)}
      ${renderBankDetail(runtime.detail)}
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
    document.querySelector("#report-dashboard-period")?.addEventListener("change", event => { uiState.dashboardDraftFilters.period = event.target.value; });
    document.querySelector("#report-dashboard-date-from")?.addEventListener("change", event => { uiState.dashboardDraftFilters.dateFrom = event.target.value; });
    document.querySelector("#report-dashboard-date-to")?.addEventListener("change", event => { uiState.dashboardDraftFilters.dateTo = event.target.value; });
    document.querySelector("#report-dashboard-status")?.addEventListener("change", event => { uiState.dashboardDraftFilters.status = event.target.value; });
    document.querySelector("#report-dashboard-generate")?.addEventListener("click", async () => {
      await accountingDashboardService?.generate?.({ ...uiState.dashboardDraftFilters }).catch(() => {});
    });
    bindSharedActions();
  }

  function bindAccounting() {
    const refreshReportView = () => BlessERP.layout.renderPage();
    document.querySelectorAll("[data-report-view^='accounting:']").forEach(button => button.addEventListener("click", () => {
      uiState.accounting.view = button.dataset.reportView.split(":")[1];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#report-accounting-period")?.addEventListener("change", event => { uiState.accounting.period = event.target.value; refreshReportView(); });
    document.querySelector("#report-accounting-date-from")?.addEventListener("change", event => { uiState.accounting.dateFrom = event.target.value; refreshReportView(); });
    document.querySelector("#report-accounting-date-to")?.addEventListener("change", event => { uiState.accounting.dateTo = event.target.value; refreshReportView(); });
    document.querySelector("#report-accounting-type")?.addEventListener("change", event => { uiState.accounting.accountType = event.target.value; refreshReportView(); });
    document.querySelector("#report-accounting-account")?.addEventListener("change", event => { uiState.accounting.accountCode = event.target.value; refreshReportView(); });
    document.querySelector("#report-accounting-zero-rows")?.addEventListener("change", event => { uiState.accounting.includeZeroRows = event.target.checked; refreshReportView(); });
    document.querySelector("#report-accounting-generate")?.addEventListener("click", async () => {
      await financialStatementsService?.generate?.(uiState.accounting.view, { ...uiState.accounting }).catch(() => {});
    });
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
    document.querySelector("#report-portfolio-period")?.addEventListener("change", event => { uiState.portfolio.period = event.target.value; });
    document.querySelector("#report-portfolio-date-from")?.addEventListener("change", event => { uiState.portfolio.dateFrom = event.target.value; });
    document.querySelector("#report-portfolio-date-to")?.addEventListener("change", event => { uiState.portfolio.dateTo = event.target.value; });
    document.querySelector("#report-portfolio-provider")?.addEventListener("change", event => { uiState.portfolio.providerId = event.target.value; });
    document.querySelector("#report-portfolio-customer")?.addEventListener("change", event => { uiState.portfolio.customerId = event.target.value; });
    document.querySelector("#report-portfolio-status")?.addEventListener("change", event => { uiState.portfolio.status = event.target.value; });
    document.querySelector("#report-portfolio-search")?.addEventListener("input", event => { uiState.portfolio.search = event.target.value; });
    document.querySelector("#report-portfolio-page-size")?.addEventListener("change", event => { uiState.portfolio.pageSize = Number(event.target.value || 25); });
    document.querySelector("#report-portfolio-generate")?.addEventListener("click", async () => {
      await portfolioReportService?.generate?.(uiState.portfolio.view, { ...uiState.portfolio }, { page: 1, pageSize: uiState.portfolio.pageSize })
        .catch(error => BlessERP.layout.toast(error?.message || "No se pudo generar el reporte de cartera."));
    });
    document.querySelectorAll("[data-portfolio-page]").forEach(button => button.addEventListener("click", async () => {
      const state = portfolioReportService?.snapshot?.()?.reports?.[uiState.portfolio.view];
      if (!state?.appliedFilters) return;
      await portfolioReportService?.generate?.(uiState.portfolio.view, state.appliedFilters, { page: Number(button.dataset.portfolioPage), pageSize: state.pageSize })
        .catch(error => BlessERP.layout.toast(error?.message || "No se pudo cambiar de página."));
    }));
    document.querySelectorAll("[data-portfolio-detail]").forEach(button => button.addEventListener("click", async () => {
      const state = portfolioReportService?.snapshot?.()?.reports?.[uiState.portfolio.view];
      const row = state?.items?.find(item => String(item.id) === String(button.dataset.portfolioDetail));
      if (!row) return;
      await portfolioReportService?.loadDetail?.(uiState.portfolio.view, row)
        .catch(error => BlessERP.layout.toast(error?.message || "No se pudo cargar el detalle."));
    }));
    document.querySelector("[data-portfolio-detail-close]")?.addEventListener("click", () => portfolioReportService?.closeDetail?.());
    bindSharedActions();
  }

  function bindBanks() {
    document.querySelectorAll("[data-report-view^='banks:']").forEach(button => button.addEventListener("click", () => {
      uiState.banks.view = button.dataset.reportView.split(":")[1];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#report-banks-period")?.addEventListener("change", event => { uiState.banks.period = event.target.value; });
    document.querySelector("#report-banks-date-from")?.addEventListener("change", event => { uiState.banks.dateFrom = event.target.value; });
    document.querySelector("#report-banks-date-to")?.addEventListener("change", event => { uiState.banks.dateTo = event.target.value; });
    document.querySelector("#report-banks-account")?.addEventListener("change", event => { uiState.banks.bankAccountId = event.target.value; });
    document.querySelector("#report-banks-status")?.addEventListener("change", event => { uiState.banks.status = event.target.value; });
    document.querySelector("#report-banks-origin")?.addEventListener("change", event => { uiState.banks.originModule = event.target.value; });
    document.querySelector("#report-banks-type")?.addEventListener("change", event => { uiState.banks.type = event.target.value; });
    document.querySelector("#report-banks-search")?.addEventListener("input", event => { uiState.banks.search = event.target.value; });
    document.querySelector("#report-banks-page-size")?.addEventListener("change", event => { uiState.banks.pageSize = Number(event.target.value) === 50 ? 50 : 25; });
    document.querySelector("#report-banks-generate")?.addEventListener("click", async () => {
      await bankReportService?.generate?.(uiState.banks.view, { ...uiState.banks }, { page: 1, pageSize: uiState.banks.pageSize })
        .catch(error => BlessERP.layout.toast(error?.message || "No se pudo generar el reporte bancario."));
    });
    document.querySelectorAll("[data-bank-page]").forEach(button => button.addEventListener("click", async () => {
      const state = bankReportService?.snapshot?.()?.reports?.[uiState.banks.view]; if (!state?.appliedFilters) return;
      await bankReportService?.generate?.(uiState.banks.view, state.appliedFilters, { page: Number(button.dataset.bankPage), pageSize: state.pageSize })
        .catch(error => BlessERP.layout.toast(error?.message || "No se pudo cambiar de página."));
    }));
    document.querySelectorAll("[data-bank-detail]").forEach(button => button.addEventListener("click", async () => {
      const state = bankReportService?.snapshot?.()?.reports?.reconciliations;
      const row = state?.items?.find(item => String(item.id) === String(button.dataset.bankDetail)); if (!row) return;
      await bankReportService?.loadDetail?.(row).catch(error => BlessERP.layout.toast(error?.message || "No se pudo cargar el detalle."));
    }));
    document.querySelector("[data-bank-detail-close]")?.addEventListener("click", () => bankReportService?.closeDetail?.());
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
    document.querySelectorAll("[data-report-export-pdf]").forEach(button => button.addEventListener("click", async () => {
      if (button.dataset.reportGenerating === "true") return;
      const scope = button.dataset.reportExportPdf;
      button.dataset.reportGenerating = "true";
      button.disabled = true;
      try {
        const execute = () => reportPdf(scope);
        const result = await (BlessERP.performance?.measureAsync?.(`reporte:pdf:${scope}`, execute, { scope }) || execute());
        if (!result.ok) BlessERP.layout.toast(result.message || "No se pudo preparar el PDF.");
        else BlessERP.layout.toast(`Formato PDF preparado: ${result.fileName}. Seleccione Guardar como PDF.`);
      } catch (error) {
        BlessERP.layout.toast(error?.message || "No se pudo preparar el PDF.");
      } finally {
        button.disabled = false;
        delete button.dataset.reportGenerating;
      }
    }));
    document.querySelectorAll("[data-report-export-xlsx]").forEach(button => button.addEventListener("click", async () => {
      if (button.dataset.reportGenerating === "true") return;
      const scope = button.dataset.reportExportXlsx;
      const filters = filtersForScope(scope);
      button.dataset.reportGenerating = "true";
      button.disabled = true;
      const previous = button.textContent;
      button.textContent = "Generando XLSX...";
      try {
        const execute = () => BlessERP.reportFinancialXlsx?.exportReport?.(scope, filters)
          || Promise.resolve({ ok: false, message: "El exportador XLSX no esta disponible." });
        const result = await (BlessERP.performance?.measureAsync?.(`reporte:xlsx:${scope}`, execute, { scope })
          || execute());
        if (!result.ok) BlessERP.layout.toast(result.message || "No se pudo generar el reporte.");
        else BlessERP.layout.toast(`XLSX generado en ${Math.max(0.01, Number(result.durationMs || 0) / 1000).toFixed(2)} s: ${result.fileName}`);
      } catch (error) {
        BlessERP.layout.toast(error?.message || "La descarga XLSX fallo. Intente nuevamente.");
      } finally {
        button.disabled = false;
        button.textContent = previous;
        delete button.dataset.reportGenerating;
      }
    }));
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Reports = { render, renderAccounting };
})();
