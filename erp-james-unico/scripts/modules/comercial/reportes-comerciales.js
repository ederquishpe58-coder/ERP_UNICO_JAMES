(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const today = BlessERP.utils?.today?.() || new Date().toISOString().slice(0, 10);
  const ui = {
    dateFrom: `${today.slice(0, 7)}-01`,
    dateTo: today,
    includeAnnulled: false,
    busy: false,
    financeLoading: false,
    queried: false,
    queriedCompany: "",
    reportOrders: [],
    financialRows: [],
    financialSummary: {},
    queryMeta: null,
    financeError: ""
  };

  function activeCompanyId() {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || BlessERP.companyCapabilities?.COMPANY_IDS?.BLESS
      || "COMP-BLESS-FLOWER";
  }

  function reportOrders(appState) {
    if (!ui.queried) return [];
    return (ui.reportOrders || [])
      .filter(order => !order.unsavedDraft)
      .filter(order => ui.includeAnnulled || String(order.status || "").toUpperCase() !== "ANULADO")
      .filter(order => {
        const date = String(order.issuedAt || order.date || "").slice(0, 10);
        if (ui.dateFrom && (!date || date < ui.dateFrom)) return false;
        if (ui.dateTo && (!date || date > ui.dateTo)) return false;
        return true;
      });
  }

  function summary(appState) {
    const orders = reportOrders(appState);
    const result = orders.reduce((result, order) => {
      const metrics = utils.getOrderMetrics(order);
      result.orders += 1;
      result.boxes += Number(metrics.totalBoxes || 0);
      result.stems += Number(metrics.totalStems || 0);
      result.sales += Number(metrics.totalUsd || 0);
      return result;
    }, { orders: 0, boxes: 0, stems: 0, sales: 0, officialRevenue: 0, officialCosts: 0, officialMargin: 0 });
    result.officialRevenue = Number(ui.financialSummary.officialRevenue || 0);
    result.officialCosts = Number(ui.financialSummary.officialCosts || 0);
    result.officialMargin = Number(ui.financialSummary.officialMargin || 0);
    return result;
  }

  function resetQueryResult() {
    ui.queried = false;
    ui.queriedCompany = "";
    ui.reportOrders = [];
    ui.financialRows = [];
    ui.financialSummary = {};
    ui.queryMeta = null;
    ui.financeError = "";
  }

  async function queryFinancialProfitability() {
    const companyId = BlessERP.getFinancialV2Repository?.()?.activeCompanyUuid?.() || activeCompanyId();
    if (ui.financeLoading) return;
    ui.financeLoading = true;
    ui.financeError = "";
    rerender();
    try {
      const result = await BlessERP.services?.financialV2?.commercialProfitabilityReport?.({
        dateFrom: ui.dateFrom,
        dateTo: ui.dateTo,
        includeAnnulled: ui.includeAnnulled,
        pageSize: 100
      });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la rentabilidad financiera.");
      ui.queried = true;
      ui.queriedCompany = companyId;
      ui.reportOrders = result.orders || [];
      ui.financialRows = result.rows || [];
      ui.financialSummary = result.summary || {};
      ui.queryMeta = {
        total: Number(result.total || 0),
        totalPages: Number(result.totalPages || 0),
        requestCount: Number(result.requestCount || 0)
      };
      ui.financeError = "";
    } catch (error) {
      resetQueryResult();
      ui.financeError = error?.message || "No se pudo consultar la rentabilidad financiera.";
    } finally {
      ui.financeLoading = false;
      rerender();
    }
  }

  function render(container, route, appState) {
    const companyId = BlessERP.getFinancialV2Repository?.()?.activeCompanyUuid?.() || activeCompanyId();
    if (ui.queried && ui.queriedCompany !== companyId) resetQueryResult();
    const totals = summary(appState);
    const queryStatus = ui.financeLoading
      ? "Consultando el rango seleccionado..."
      : ui.financeError
        ? ui.financeError
        : ui.queried
          ? `${utils.number(ui.queryMeta?.total || 0)} pedidos canónicos · ${utils.number(ui.queryMeta?.requestCount || 0)} solicitud(es) acotada(s)`
          : "Seleccione el rango y pulse Consultar. No se carga historial al abrir la ruta.";
    container.innerHTML = `
      <section class="page-header">
        <div><p class="section-kicker">REPORTES / COMERCIAL</p><h1>Rentabilidad comercial</h1><p>Genere el reporte detallado sin recargar el Historial de pedidos.</p></div>
        <div class="page-header-side"><span class="status-badge authorized">Bajo demanda</span></div>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="commercial-filter-grid">
          <label class="compact-field"><span>Desde</span><input type="date" value="${utils.esc(ui.dateFrom)}" data-commercial-report-date-from></label>
          <label class="compact-field"><span>Hasta</span><input type="date" value="${utils.esc(ui.dateTo)}" data-commercial-report-date-to></label>
          <label class="compact-field"><span>Pedidos anulados</span><select data-commercial-report-annulled><option value="NO" ${!ui.includeAnnulled ? "selected" : ""}>No incluir</option><option value="SI" ${ui.includeAnnulled ? "selected" : ""}>Incluir</option></select></label>
          <div class="compact-field"><span>Consulta</span><button class="primary-button" type="button" data-commercial-report-query ${ui.financeLoading ? "disabled" : ""}>${ui.financeLoading ? "Consultando..." : "Consultar"}</button></div>
        </div>
        <p class="panel-note" data-commercial-report-status>${utils.esc(queryStatus)}</p>
      </section>
      <section class="summary-grid">
        <article class="summary-card"><span>Pedidos</span><strong>${utils.number(totals.orders)}</strong><small>Dentro del rango</small></article>
        <article class="summary-card"><span>Cajas</span><strong>${utils.number(totals.boxes)}</strong><small>Piezas comerciales</small></article>
        <article class="summary-card"><span>Tallos</span><strong>${utils.number(totals.stems)}</strong><small>Detalle de venta</small></article>
        <article class="summary-card"><span>Ventas</span><strong>${utils.money(totals.sales)}</strong><small>Antes del costeo</small></article>
        <article class="summary-card"><span>Ingreso confirmado</span><strong>${utils.money(totals.officialRevenue)}</strong><small>Supabase financiero</small></article>
        <article class="summary-card"><span>Costos confirmados</span><strong>${utils.money(totals.officialCosts)}</strong><small>Directos + asignados</small></article>
        <article class="summary-card"><span>Margen confirmado</span><strong>${utils.money(totals.officialMargin)}</strong><small>${ui.queried ? "Servidor canónico" : "Pendiente de consulta"}</small></article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">RENTABILIDAD</p><h3>Reporte XLSX por pedido, variedad y medida</h3><p class="panel-note">El archivo se prepara únicamente al pulsar Descargar. Los costos faltantes se identifican sin inventar valores.</p></div>
          <button class="primary-button" type="button" data-commercial-report-download ${!ui.queried || !totals.orders || ui.busy ? "disabled" : ""}>${ui.busy ? "Preparando..." : "Descargar rentabilidad XLSX"}</button>
        </div>
      </section>
    `;
    bind(container, appState);
  }

  function rerender() {
    BlessERP.layout?.renderPage?.();
  }

  function bind(container, appState) {
    container.querySelector("[data-commercial-report-date-from]")?.addEventListener("change", event => {
      ui.dateFrom = String(event.currentTarget.value || "");
      resetQueryResult();
      rerender();
    });
    container.querySelector("[data-commercial-report-date-to]")?.addEventListener("change", event => {
      ui.dateTo = String(event.currentTarget.value || "");
      resetQueryResult();
      rerender();
    });
    container.querySelector("[data-commercial-report-annulled]")?.addEventListener("change", event => {
      ui.includeAnnulled = event.currentTarget.value === "SI";
      resetQueryResult();
      rerender();
    });
    container.querySelector("[data-commercial-report-query]")?.addEventListener("click", () => {
      queryFinancialProfitability();
    });
    container.querySelector("[data-commercial-report-download]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      if (ui.busy) return;
      const orders = reportOrders(appState);
      ui.busy = true;
      button.disabled = true;
      button.textContent = "Preparando XLSX...";
      try {
        await BlessERP.moduleLoader.loadGroup("reports-commercial-xlsx");
        const result = await BlessERP.comercialProfitabilityReportXlsx?.exportXlsx?.(appState, {
          companyId: activeCompanyId(),
          orders,
          orderIds: orders.map(order => order.id),
          includeAnnulled: ui.includeAnnulled,
          financialRows: ui.financialRows
        });
        if (!result?.ok) throw new Error(result?.message || "No se pudo generar el reporte de rentabilidad.");
        BlessERP.layout?.toast?.(`Reporte generado: ${result.fileName}`);
      } catch (error) {
        BlessERP.layout?.toast?.(error?.message || "No se pudo generar el reporte.", { tone: "danger" });
      } finally {
        ui.busy = false;
        if (document.body.contains(button)) {
          button.disabled = false;
          button.textContent = "Descargar rentabilidad XLSX";
        }
      }
    });
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.commercialReports = { render };
})();
