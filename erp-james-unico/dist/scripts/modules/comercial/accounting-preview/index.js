(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const previewUtils = BlessERP.comercialAccountingPreviewUtils;
  const model = BlessERP.comercialAccountingPreviewModel;

  function renderInfoCard(title, rows, kicker = "CONTABILIDAD FUTURA") {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">${utils.esc(kicker)}</p>
            <h3>${utils.esc(title)}</h3>
          </div>
        </div>
        <div class="info-stack">
          ${rows.map(([label, value]) => `
            <div class="info-row">
              <strong>${utils.esc(label)}</strong>
              <span>${utils.esc(value)}</span>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  function renderWarnings(preview) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">VALIDACIONES</p>
            <h3>Estado del preview</h3>
          </div>
          <span class="status-badge ${utils.esc(preview.definition.tone)}">${utils.esc(preview.definition.shortLabel)}</span>
        </div>
        <ul class="checklist-list">
          ${preview.errors.map(item => `<li>${utils.esc(item)}</li>`).join("") || "<li>Sin errores criticos para generar preview.</li>"}
        </ul>
        <div class="base-ready-list">
          ${preview.warnings.map(item => `
            <div class="base-ready-item">
              <strong>Advertencia</strong>
              <span>${utils.esc(item)}</span>
            </div>
          `).join("") || `<div class="base-ready-item"><strong>Sin advertencias</strong><span>La configuracion sugerida esta completa para este preview.</span></div>`}
        </div>
      </article>
    `;
  }

  function renderSummaryView(order, appState, preview) {
    const state = previewUtils.ensurePreviewStore(order);
    return `
      <section class="placeholder-grid">
        ${renderInfoCard("Resumen comercial", [
          ["Numero pedido", preview.orderSummary.number || "-"],
          ["Cliente principal", preview.orderSummary.customerName || "-"],
          ["Marca", preview.orderSummary.brandName || "-"],
          ["Destino", preview.orderSummary.destination || "-"],
          ["Fecha emision", preview.orderSummary.issuedAt || "-"],
          ["Fecha vuelo", preview.orderSummary.flightDate || "-"],
          ["Total cajas", String(preview.orderSummary.totalBoxes || 0)],
          ["Total tallos", utils.number(preview.orderSummary.totalStems || 0)],
          ["Total USD", utils.money(preview.orderSummary.totalUsd || 0)],
          ["Estado pedido", preview.orderSummary.status || "-"]
        ])}
        ${renderInfoCard("Estado contable demo", [
          ["Estado contable", state.state],
          ["Preview generado", state.generatedAt ? state.generatedAt.replace("T", " ").slice(0, 16) : "-"],
          ["Generado por", state.generatedBy || "-"],
          ["Listo para futuro", state.readyAt ? state.readyAt.replace("T", " ").slice(0, 16) : "No"],
          ["Observacion", state.observation || "Preview pendiente"]
        ])}
        ${renderInfoCard("Parametros sugeridos", [
          ["Cuenta CxC", preview.accounts.receivable.code ? `${preview.accounts.receivable.code} - ${preview.accounts.receivable.name}` : "Pendiente configuracion"],
          ["Cuenta ventas exportacion", preview.accounts.exportSales.code ? `${preview.accounts.exportSales.code} - ${preview.accounts.exportSales.name}` : "Pendiente configuracion"],
          ["Anticipos clientes", preview.accounts.customerAdvances.code ? `${preview.accounts.customerAdvances.code} - ${preview.accounts.customerAdvances.name}` : "Pendiente configuracion"],
          ["Retenciones por cobrar", preview.accounts.withholdingReceivable.code ? `${preview.accounts.withholdingReceivable.code} - ${preview.accounts.withholdingReceivable.name}` : "Pendiente configuracion"],
          ["Centro de costo sugerido", preview.costCenter.code ? `${preview.costCenter.code} - ${preview.costCenter.name}` : "Pendiente configuracion"]
        ])}
        ${renderWarnings(preview)}
      </section>
    `;
  }

  function renderCxcView(preview) {
    const cxc = preview.cxc;
    return `
      <section class="placeholder-grid">
        ${renderInfoCard("Preview de cuenta por cobrar", [
          ["Cliente principal", cxc.customerName || "-"],
          ["Marca", cxc.brandName || "-"],
          ["Documento", cxc.documentLabel],
          ["Numero documento", cxc.documentNumber || "Pendiente"],
          ["Fecha emision", cxc.issueDate || "-"],
          ["Fecha vencimiento", cxc.dueDate || "-"],
          ["Total", utils.money(cxc.total || 0)],
          ["Saldo", utils.money(cxc.balance || 0)],
          ["Estado", cxc.state],
          ["Cartera real", "Pendiente"]
        ])}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CXC PREVIEW</p>
              <h3>Mensaje de control</h3>
            </div>
          </div>
          <p class="panel-note">Este preview no crea cuentas por cobrar reales. Sirve para preparar la futura integracion con cartera y validar montos, cliente y vencimiento.</p>
          <div class="table-actions-inline">
            <button class="secondary-button" data-route-link="portfolios-ar">Ver cartera real</button>
          </div>
        </article>
      </section>
    `;
  }

  function renderJournalView(preview) {
    const journal = preview.journal;
    return `
      <section class="summary-grid">
        <article class="summary-card">
          <span>Total debe</span>
          <strong>${utils.esc(utils.money(journal.debitTotal))}</strong>
          <small>Preview contable</small>
        </article>
        <article class="summary-card">
          <span>Total haber</span>
          <strong>${utils.esc(utils.money(journal.creditTotal))}</strong>
          <small>Preview contable</small>
        </article>
        <article class="summary-card">
          <span>Diferencia</span>
          <strong>${utils.esc(utils.money(journal.difference))}</strong>
          <small>Debe quedar en cero</small>
        </article>
      </section>
      <section class="placeholder-grid">
        ${renderInfoCard("Asiento sugerido", [
          ["Fecha", journal.accountingDate || "-"],
          ["Periodo", journal.accountingPeriod || "-"],
          ["Estado", journal.state],
          ["Cuenta por cobrar sugerida", preview.accounts.receivable.code ? `${preview.accounts.receivable.code} - ${preview.accounts.receivable.name}` : "Pendiente configuracion"],
          ["Cuenta ingreso sugerida", preview.accounts.exportSales.code ? `${preview.accounts.exportSales.code} - ${preview.accounts.exportSales.name}` : "Pendiente configuracion"],
          ["Centro de costo sugerido", preview.costCenter.code ? `${preview.costCenter.code} - ${preview.costCenter.name}` : "Pendiente configuracion"]
        ])}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ASIENTO PREVIEW</p>
              <h3>Detalle sugerido</h3>
            </div>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table commercial-table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Nombre</th>
                  <th>Debe</th>
                  <th>Haber</th>
                  <th>Centro costo</th>
                  <th>Descripcion</th>
                </tr>
              </thead>
              <tbody>
                ${journal.lines.map(line => `
                  <tr>
                    <td>${utils.esc(line.accountCode || "-")}</td>
                    <td>${utils.esc(line.accountName || "Pendiente configuracion")}</td>
                    <td>${utils.esc(utils.money(line.debit || 0))}</td>
                    <td>${utils.esc(utils.money(line.credit || 0))}</td>
                    <td>${utils.esc(line.costCenter || "-")}</td>
                    <td>${utils.esc(line.description || "-")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <p class="panel-note">Este asiento es solo una vista previa. No afecta Libro Diario ni Mayor General.</p>
          <div class="table-actions-inline">
            <button class="secondary-button" data-route-link="accounting-journal">Ver Libro Diario real</button>
          </div>
        </article>
      </section>
    `;
  }

  function renderContractView(preview) {
    const contract = preview.contract;
    return `
      <section class="placeholder-grid">
        ${renderInfoCard("salesAccountingContract", [
          ["pedido_id", contract.pedido_id],
          ["numero_pedido", contract.numero_pedido],
          ["numero_invoice_cliente", contract.numero_invoice_cliente || "-"],
          ["estado_comercial", contract.estado_comercial],
          ["estado_contable", contract.estado_contable],
          ["cuenta_cxc_sugerida", contract.cuenta_cxc_sugerida || "-"],
          ["cuenta_ingreso_sugerida", contract.cuenta_ingreso_sugerida || "-"],
          ["centro_costo_sugerido", contract.centro_costo_sugerido || "-"],
          ["cxc_preview_id", contract.cxc_preview_id || "-"],
          ["asiento_preview_id", contract.asiento_preview_id || "-"]
        ], "CONTRATO")}
        ${renderInfoCard("Totales comerciales", [
          ["Subtotal", utils.money(contract.subtotal || 0)],
          ["Descuento", utils.money(contract.descuento || 0)],
          ["IVA", utils.money(contract.iva || 0)],
          ["Total USD", utils.money(contract.total_usd || 0)],
          ["Moneda", contract.moneda || "USD"],
          ["Observacion", contract.observacion || "-"]
        ], "CONTRATO")}
      </section>
    `;
  }

  function renderOrderTab(order, appState) {
    previewUtils.ensurePreviewStore(order);
    const preview = model.buildPreview(order, appState);
    const ui = BlessERP.comercialState.getUi(appState);
    const currentView = ["summary", "cxc", "journal", "contract"].includes(ui.accountingPreviewView)
      ? ui.accountingPreviewView
      : "summary";

    return `
      <section class="hero-banner commercial-inline-banner">
        <div>
          <strong>Contabilidad futura preparada</strong>
          <span>Vista previa. No afecta Libro Diario ni Mayor General. Factura Comercial Cliente demo, cuenta por cobrar futura y asiento sugerido quedan separados del Libro Diario y la Cartera real.</span>
        </div>
        <span class="status-badge ${utils.esc(preview.definition.tone)}">${utils.esc(preview.definition.shortLabel)}</span>
      </section>
      <section class="summary-grid">
        <article class="summary-card"><span>Total cajas</span><strong>${utils.esc(preview.metrics.totalBoxes)}</strong><small>Pedido comercial actual</small></article>
        <article class="summary-card"><span>Total tallos</span><strong>${utils.esc(utils.number(preview.metrics.totalStems))}</strong><small>Base del preview</small></article>
        <article class="summary-card"><span>Total USD</span><strong>${utils.esc(utils.money(preview.totals.totalUsd))}</strong><small>Sin IVA exportacion en esta fase</small></article>
        <article class="summary-card"><span>Estado contable</span><strong>${utils.esc(preview.state)}</strong><small>Solo preview / preparado</small></article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ACCIONES</p>
            <h3>Contabilidad futura</h3>
          </div>
        </div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-generate-accounting-preview>Generar preview contable</button>
          <button class="secondary-button" data-commercial-accounting-view="cxc">Ver preview CxC</button>
          <button class="secondary-button" data-commercial-accounting-view="journal">Ver preview asiento</button>
          <button class="secondary-button" data-commercial-mark-accounting-ready>Marcar como listo para contabilidad futura</button>
          <button class="secondary-button" data-commercial-accounting-placeholder="send">Enviar a contabilidad</button>
          <button class="secondary-button" data-commercial-accounting-placeholder="real-entry">Generar asiento real</button>
        </div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-accounting-view="summary">Resumen</button>
          <button class="secondary-button" data-commercial-accounting-view="contract">Contrato</button>
          <button class="secondary-button" data-route-link="commercial-accounting-report">Reporte comercial-contable demo</button>
        </div>
      </section>
      ${currentView === "cxc"
        ? renderCxcView(preview)
        : currentView === "journal"
          ? renderJournalView(preview)
          : currentView === "contract"
            ? renderContractView(preview)
            : renderSummaryView(order, appState, preview)}
    `;
  }

  function renderReport(appState) {
    const rows = BlessERP.comercialState.getOrders(appState).map(order => {
      previewUtils.ensurePreviewStore(order);
      return {
        order,
        preview: model.buildPreview(order, appState)
      };
    });
    const summary = model.buildPortfolioSummary(BlessERP.comercialState.getOrders(appState), appState);

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Reporte comercial-contable demo</h1>
          <p>Reporte demo. No corresponde a contabilidad oficial y no genera cuenta por cobrar ni asiento real.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Preview contable</span>
        </div>
      </section>
      <section class="summary-grid">
        <article class="summary-card"><span>Pedidos con preview</span><strong>${utils.esc(summary.withPreview)}</strong><small>Preview generado</small></article>
        <article class="summary-card"><span>Listos futuro</span><strong>${utils.esc(summary.readyForFuture)}</strong><small>Preparados para fase posterior</small></article>
        <article class="summary-card"><span>Sin preview</span><strong>${utils.esc(summary.withoutPreview)}</strong><small>Elegibles pendientes</small></article>
        <article class="summary-card"><span>Total USD preview</span><strong>${utils.esc(utils.money(summary.totalUsdPreview))}</strong><small>Pedidos con preview generado</small></article>
        <article class="summary-card"><span>Facturas demo pendientes</span><strong>${utils.esc(summary.pendingClientInvoices)}</strong><small>Pendientes de contabilizar futuro</small></article>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Conexión real pendiente</strong>
          <span>La contabilizacion de ventas se implementara en una fase posterior. Este frente solo prepara contratos, cuentas sugeridas y trazabilidad comercial.</span>
        </div>
        <button class="secondary-button" data-route-link="accounting-journal">Ver Libro Diario real</button>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">REPORTE DEMO</p>
            <h3>Pedidos comerciales y preview contable</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha emision</th>
                <th>Cliente principal</th>
                <th>Marca</th>
                <th>Destino</th>
                <th>Total USD</th>
                <th>Estado pedido</th>
                <th>Estado contable</th>
                <th>Cuenta CxC sugerida</th>
                <th>Cuenta ingreso sugerida</th>
                <th>Asiento preview</th>
                <th>Observacion</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(({ order, preview }) => `
                <tr>
                  <td>${utils.esc(order.number)}</td>
                  <td>${utils.esc(order.issuedAt || "-")}</td>
                  <td>${utils.esc(preview.customer?.commercialName || "-")}</td>
                  <td>${utils.esc(preview.brand?.name || "-")}</td>
                  <td>${utils.esc(order.destination || "-")}</td>
                  <td>${utils.esc(utils.money(preview.totals.totalUsd))}</td>
                  <td>${utils.esc(order.status || "-")}</td>
                  <td><span class="status-badge ${utils.esc(preview.definition.tone)}">${utils.esc(order.accountingPreview.state)}</span></td>
                  <td>${utils.esc(preview.accounts.receivable.code || "-")}</td>
                  <td>${utils.esc(preview.accounts.exportSales.code || "-")}</td>
                  <td>${utils.esc(order.accountingPreview.asientoPreviewId || "-")}</td>
                  <td>${utils.esc(order.accountingPreview.observation || preview.warnings[0] || "-")}</td>
                  <td>
                    <div class="table-actions-inline commercial-action-stack">
                      <button class="secondary-button" data-commercial-accounting-open-order="${utils.esc(order.id)}">Ver preview contable</button>
                      <button class="secondary-button" data-commercial-accounting-ready-order="${utils.esc(order.id)}">Marcar listo</button>
                      <button class="secondary-button" data-commercial-accounting-send-order="${utils.esc(order.id)}">Enviar a contabilidad</button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function generatePreviewForOrder(order, appState) {
    return model.generatePreview(order, appState);
  }

  function markReadyForAccounting(order, appState) {
    return model.markReadyForFuture(order, appState);
  }

  function resetOrderPreview(order) {
    previewUtils.resetOrderPreview(order);
  }

  function bind(container, appState) {
    container.querySelectorAll("[data-commercial-accounting-view]").forEach(button => button.addEventListener("click", () => {
      BlessERP.comercialState.setAccountingPreviewView(appState, button.dataset.commercialAccountingView);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-generate-accounting-preview]").forEach(button => button.addEventListener("click", () => {
      BlessERP.comercialState.generateAccountingPreview(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-mark-accounting-ready]").forEach(button => button.addEventListener("click", () => {
      BlessERP.comercialState.markAccountingReady(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-accounting-placeholder]").forEach(button => button.addEventListener("click", () => {
      BlessERP.layout.toast("Pendiente fase futura. No se generan asientos reales en esta fase.");
    }));

    container.querySelectorAll("[data-commercial-accounting-open-order]").forEach(button => button.addEventListener("click", () => {
      BlessERP.comercialState.openOrder(appState, button.dataset.commercialAccountingOpenOrder);
      BlessERP.comercialState.setOrderTab(appState, "future-accounting");
      BlessERP.comercialState.setAccountingPreviewView(appState, "summary");
      BlessERP.state.setRoute("commercial-order-master");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-accounting-ready-order]").forEach(button => button.addEventListener("click", () => {
      BlessERP.comercialState.markAccountingReadyById(appState, button.dataset.commercialAccountingReadyOrder);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-accounting-send-order]").forEach(button => button.addEventListener("click", () => {
      BlessERP.layout.toast("Pendiente fase futura. No se generan asientos reales en esta fase.");
    }));
  }

  BlessERP.comercialAccountingPreview = {
    bind,
    buildPortfolioSummary: model.buildPortfolioSummary,
    buildPreview: model.buildPreview,
    generatePreviewForOrder,
    markReadyForAccounting,
    renderOrderTab,
    renderReport,
    resetOrderPreview
  };
})();
