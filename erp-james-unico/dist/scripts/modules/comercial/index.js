(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;

  function renderPanel(appState) {
    const orders = stateApi.getOrders(appState);
    const currentOrder = stateApi.currentOrder(appState);
    const reservations = stateApi.getReservations(appState);
    const salesAvailabilityRows = BlessERP.comercialOrderFulfillment?.getAvailabilityRows?.(appState) || [];
    const cycleService = BlessERP.operacionesCycleDemo;
    const dispatchRows = utils.getDispatchService?.()?.getDispatchesDemo
      ? utils.getDispatchService().getDispatchesDemo(appState)
      : [];
    const expiringDaes = data.daes.filter(item => utils.isDaeNearExpiry(item)).length;
    const portfolio = workflow.buildPortfolioSummary(orders, appState);
    const accountingPortfolio = BlessERP.comercialAccountingPreview.buildPortfolioSummary(orders, appState);
    const reservationIndicators = orders.map(order => utils.getReservationUsageSummary(order, reservations));
    const ordersWithReservations = reservationIndicators.filter(item => item.activeCount > 0).length;
    const boxesWithoutReservation = reservationIndicators.reduce((sum, item) => sum + item.linesWithoutReservation, 0);
    const pendingReservationBunches = reservationIndicators.reduce((sum, item) => sum + item.unusedBunches, 0);
    const reservedBunches = reservationIndicators.reduce((sum, item) => sum + item.reservedBunches, 0);
    const physicalAvailableBunches = salesAvailabilityRows
      .filter(item => !item.openMixed)
      .reduce((sum, item) => sum + Number(item.physicalBunches || 0), 0);
    const activeOrderBunches = salesAvailabilityRows
      .reduce((sum, item) => sum + Number(item.demandPendingBunches || 0), 0);
    const exportAvailableBunches = Math.max(physicalAvailableBunches - activeOrderBunches, 0);
    const dispatchReady = dispatchRows.filter(item => String(item.estado_despacho || "").toUpperCase() === "LISTO_DESPACHO").length;
    const dispatchObserved = dispatchRows.filter(item => String(item.estado_despacho || "").toUpperCase() === "OBSERVADO").length;
    const dispatchedDemo = dispatchRows.filter(item => String(item.estado_despacho || "").toUpperCase() === "DESPACHADO_DEMO").length;
    const dispatchReviews = dispatchRows.map(item => utils.getDispatchService().validateDispatchReadinessDemo(appState, item.pedido_id || item.numero_pedido || item.dispatch_id));
    const dispatchPendingChecklist = dispatchReviews.filter(item => item.warnings.length > 0).length;
    const dispatchCriticalErrors = dispatchReviews.filter(item => item.errors.length > 0).length;
    const pendingGuides = orders.filter(order => !["ANULADO", "CERRADO_DEMO"].includes(String(order.status || "").toUpperCase()) && (!order.awb || !order.hawb)).length;
    const pendingLabels = dispatchRows.filter(item => String(item.estado_etiquetas || "").toUpperCase() !== "LISTAS").length;
    const cycleRows = cycleService?.getOperationalCycleSummaryDemo
      ? cycleService.getOperationalCycleSummaryDemo(appState).cycles || []
      : [];
    const ordersWithConsumptionDemo = cycleRows.filter(item => (item.consumos || []).some(row => String(row.estado_consumo || "").toUpperCase() === "SIMULADO")).length;
    const ordersPendingConsumptionDemo = cycleRows.filter(item => String(item.estado_ciclo || "").toUpperCase() === "DESPACHADO_DEMO" && !(item.consumos || []).some(row => String(row.estado_consumo || "").toUpperCase() === "SIMULADO")).length;
    const ordersWithCycleErrors = cycleRows.filter(item => (item.errores || []).length).length;
    const cards = [
      ["commercial-order-master", "Pedido Maestro", "Centro del flujo comercial demo con cliente, marca, DAE, logistica, cajas y documentos."],
      ["commercial-order-history", "Pedidos / Historial", "Bandeja de pedidos demo con acciones de apertura, duplicado y preview."],
      ["commercial-customers-brands", "Clientes principales", "Catalogo local/demo de compradores, contacto y condiciones comerciales."],
      ["commercial-brands", "Marcas / Clientes finales", "Marcas relacionadas con cada cliente principal, destino, agencia y reglas de PO."],
      ["commercial-availability-reservations", "Disponibilidad", "Inventario disponible menos demanda pendiente de pedidos activos."],
      ["commercial-invoice-packing", "Invoice / Packing carguera", "Preview dinamico del documento comercial de carguera."],
      ["commercial-client-invoice", "Factura Comercial Cliente", "Documento comercial cliente demo separado del invoice carguera y de la futura factura SRI."],
      ["commercial-print-center", "Centro de impresion", "Salida visual demo para invoice, packing, HR, MP, etiquetas y control DAE."],
      ["commercial-daes", "DAE / Aduana", "Catalogo demo de DAEs activas y caducidad."],
      ["commercial-sri-authorization", "Autorizacion SRI futura", "Placeholder tributario reservado para otra fase."]
    ];

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Panel comercial</h1>
          <p>Modulo comercial demo integrado desde la referencia de Parte 3, separado por dominio y sin copiar el app.js monolitico del prototipo.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Demo integrado</span>
        </div>
      </section>
      <section class="summary-grid">
        <article class="summary-card">
          <span>Pedidos demo</span>
          <strong>${utils.esc(orders.length)}</strong>
          <small>Pedidos guardados localmente</small>
        </article>
        <article class="summary-card">
          <span>Total USD demo</span>
          <strong>${utils.esc(utils.money(portfolio.totalUsd))}</strong>
          <small>Historial comercial integrado</small>
        </article>
        <article class="summary-card">
          <span>Pedidos listos despacho</span>
          <strong>${utils.esc(dispatchReady)}</strong>
          <small>Checklist despacho demo aprobado</small>
        </article>
        <article class="summary-card">
          <span>Despachados demo</span>
          <strong>${utils.esc(dispatchedDemo)}</strong>
          <small>Sin afectar inventario real</small>
        </article>
        <article class="summary-card">
          <span>Despacho observado</span>
          <strong>${utils.esc(dispatchObserved)}</strong>
          <small>Requiere revision operativa</small>
        </article>
        <article class="summary-card">
          <span>Guias pendientes</span>
          <strong>${utils.esc(pendingGuides)}</strong>
          <small>Falta AWB y/o HAWB</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas pendientes</span>
          <strong>${utils.esc(pendingLabels)}</strong>
          <small>No listas para despacho demo</small>
        </article>
        <article class="summary-card">
          <span>Pendientes checklist</span>
          <strong>${utils.esc(dispatchPendingChecklist)}</strong>
          <small>Advertencias despacho demo</small>
        </article>
        <article class="summary-card">
          <span>Errores despacho</span>
          <strong>${utils.esc(Math.max(dispatchCriticalErrors, ordersWithCycleErrors))}</strong>
          <small>Despacho o ciclo operativo demo</small>
        </article>
        <article class="summary-card">
          <span>Disponibilidad para venta</span>
          <strong>${utils.esc(utils.number(exportAvailableBunches))}</strong>
          <small>Inventario menos pedidos activos</small>
        </article>
        <article class="summary-card">
          <span>Ramos reservados demo</span>
          <strong>${utils.esc(utils.number(reservedBunches))}</strong>
          <small>availabilityContract + reservationContract</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con reserva demo</span>
          <strong>${utils.esc(ordersWithReservations)}</strong>
          <small>Con enlace al ciclo operativo</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con consumo demo</span>
          <strong>${utils.esc(ordersWithConsumptionDemo)}</strong>
          <small>Consumo simulado en Operaciones</small>
        </article>
        <article class="summary-card">
          <span>Pendientes consumo demo</span>
          <strong>${utils.esc(ordersPendingConsumptionDemo)}</strong>
          <small>Despachados sin consumo simulado</small>
        </article>
        <article class="summary-card">
          <span>Ramos reservados operaciones</span>
          <strong>${utils.esc(utils.number(reservedBunches))}</strong>
          <small>Ramos enlazados desde Operaciones demo</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con errores ciclo</span>
          <strong>${utils.esc(ordersWithCycleErrors)}</strong>
          <small>Requieren revisar flujo operativo demo</small>
        </article>
        <article class="summary-card">
          <span>Pedido activo</span>
          <strong>${utils.esc(currentOrder?.number || "-")}</strong>
          <small>${utils.esc(utils.findBrand(currentOrder?.brandId)?.name || "Sin marca")}</small>
        </article>
        <article class="summary-card">
          <span>Pedidos borrador</span>
          <strong>${utils.esc(portfolio.counts.BORRADOR)}</strong>
          <small>En edicion comercial</small>
        </article>
        <article class="summary-card">
          <span>Pedidos validados</span>
          <strong>${utils.esc(portfolio.counts.VALIDADO_COMERCIAL)}</strong>
          <small>Revision comercial lista</small>
        </article>
        <article class="summary-card">
          <span>Pedidos anulados</span>
          <strong>${utils.esc(portfolio.counts.ANULADO)}</strong>
          <small>Sin eliminacion fisica</small>
        </article>
        <article class="summary-card">
          <span>Cajas pendientes despacho</span>
          <strong>${utils.esc(portfolio.pendingDispatchBoxes)}</strong>
          <small>No incluyen anulados ni cerrados</small>
        </article>
        <article class="summary-card">
          <span>Cajas sin reserva</span>
          <strong>${utils.esc(boxesWithoutReservation)}</strong>
          <small>No bloquea, pero requiere revisar Pedido Maestro</small>
        </article>
        <article class="summary-card">
          <span>Reservas sin usar</span>
          <strong>${utils.esc(utils.number(pendingReservationBunches))}</strong>
          <small>Ramos reservados aun no pasados a cajas</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con preview contable</span>
          <strong>${utils.esc(accountingPortfolio.withPreview)}</strong>
          <small>Preview generado sin tocar libros reales</small>
        </article>
        <article class="summary-card">
          <span>Listos contabilidad futura</span>
          <strong>${utils.esc(accountingPortfolio.readyForFuture)}</strong>
          <small>Preparados para fase posterior</small>
        </article>
        <article class="summary-card">
          <span>Pedidos sin preview contable</span>
          <strong>${utils.esc(accountingPortfolio.withoutPreview)}</strong>
          <small>Elegibles pendientes</small>
        </article>
        <article class="summary-card">
          <span>Total USD preview</span>
          <strong>${utils.esc(utils.money(accountingPortfolio.totalUsdPreview))}</strong>
          <small>Pedidos con preview generado</small>
        </article>
        <article class="summary-card">
          <span>Facturas demo pendientes</span>
          <strong>${utils.esc(accountingPortfolio.pendingClientInvoices)}</strong>
          <small>Pendientes de contabilizar futuro</small>
        </article>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Conexiones y alertas</strong>
          <span>${utils.esc(portfolio.alerts.length ? `${portfolio.alerts.length} alertas comerciales activas. ${dispatchReady} pedido(s) listos despacho, ${dispatchObserved} observado(s), ${expiringDaes} DAE(s) proximas a caducar.` : `Sin alertas comerciales criticas. ${dispatchReady} pedido(s) listos despacho, ${ordersWithReservations} pedido(s) enlazados con reservas demo.`)}</span>
        </div>
        <button class="secondary-button" data-route-link="core-diagnostics">Ver diagnostico del ERP</button>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Modo comercial actual</strong>
          <span>Datos demo. No genera factura SRI, asiento contable real ni CxC real.</span>
        </div>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ALERTAS COMERCIALES</p>
              <h3>Pedidos por revisar</h3>
            </div>
            <span class="status-badge pending">${utils.esc(portfolio.alerts.length)}</span>
          </div>
          <div class="base-ready-list">
            ${portfolio.alerts.slice(0, 6).map(item => `
              <div class="base-ready-item">
                <strong>${utils.esc(item.orderNumber)}</strong>
                <span>${utils.esc(item.message)}</span>
              </div>
            `).join("") || `<div class="base-ready-item"><strong>Sin alertas</strong><span>El flujo comercial no reporta novedades.</span></div>`}
          </div>
        </article>
      </section>
      <section class="placeholder-grid">
        ${cards.map(([routeId, title, description]) => `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">PARTE 3 EXPORTACIONES Y VENTA</p>
                <h3>${utils.esc(title)}</h3>
              </div>
              <span class="status-badge partial">Demo</span>
            </div>
            <p class="panel-note">${utils.esc(description)}</p>
            <button class="secondary-button" data-route-link="${utils.esc(routeId)}">Abrir</button>
          </article>
        `).join("")}
      </section>
    `;
  }

  function renderSriPlaceholder() {
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Autorizacion SRI futura</h1>
          <p>Frente reservado para una fase posterior. No se integra SRI real, no genera factura electronica y no se conecta a contabilidad en esta etapa.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge cancelled">Fase futura</span>
        </div>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">PLACEHOLDER</p>
              <h3>Alcance bloqueado en Fase 2A</h3>
            </div>
          </div>
          <ul class="checklist-list">
            <li>No implementar facturacion SRI real.</li>
            <li>No implementar autorizacion SRI real.</li>
            <li>No mezclar invoice carguera con factura electronica.</li>
            <li>No enviar ventas a cartera ni a contabilidad.</li>
          </ul>
        </article>
      </section>
    `;
  }

  function renderStandaloneInvoice(appState) {
    const order = stateApi.currentOrder(appState);
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Invoice / Packing carguera</h1>
          <p>Preview dinamico del documento comercial basado en el Pedido Maestro activo.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Demo documento</span>
        </div>
      </section>
      ${BlessERP.comercialPrintSystem.renderWorkspace("INVOICE_PACKING_REFERENCIAL", order, appState, {
        title: "Invoice / Packing carguera",
        description: "Preview dinamico del documento comercial basado en el Pedido Maestro activo.",
        actionsMarkup: `
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-preview-doc="INVOICE_PACKING_REFERENCIAL">Vista previa referencial</button>
            <button class="secondary-button" data-commercial-print-doc="INVOICE_PACKING_REFERENCIAL">Imprimir referencial</button>
            <button class="secondary-button" data-commercial-preview-doc="INVOICE_PACKING_REAL">Vista previa real demo</button>
            <button class="secondary-button" data-commercial-doc-placeholder="pdf|INVOICE_PACKING_REFERENCIAL">Descargar PDF</button>
          </div>
        `
      })}
    `;
  }

  function renderStandaloneClientInvoice(appState) {
    const order = stateApi.currentOrder(appState);
    return BlessERP.comercialClientInvoice.renderWorkspace(order, appState);
  }

  function render(container, route, appState) {
    let html = "";
    if (route.id === "commercial-panel") {
      html = renderPanel(appState);
      container.innerHTML = html;
      return;
    }
    if (route.id === "commercial-order-master") {
      container.innerHTML = BlessERP.comercialPedido.render(appState);
      BlessERP.comercialPedido.bind(container, appState);
      return;
    }
    if (route.id === "commercial-orders-day") {
      container.innerHTML = BlessERP.comercialOrdersDay.render(appState);
      BlessERP.comercialOrdersDay.bind(container, appState);
      return;
    }
    if (route.id === "commercial-order-detail") {
      container.innerHTML = BlessERP.comercialOrderDetail.render(appState);
      BlessERP.comercialOrderDetail.bind(container, appState);
      return;
    }
    if (route.id === "commercial-order-history") {
      container.innerHTML = BlessERP.comercialHistory.render(appState);
      BlessERP.comercialHistory.bind(container, appState);
      return;
    }
    if (route.id === "commercial-customers-brands") {
      container.innerHTML = BlessERP.comercialCatalogs.renderCustomersBrandsPage(appState);
      BlessERP.comercialCatalogs.bindCustomersPage(container, appState);
      return;
    } else if (route.id === "commercial-brands") {
      container.innerHTML = BlessERP.comercialCatalogs.renderBrandsPage(appState);
      BlessERP.comercialCatalogs.bindBrandsPage(container, appState);
      return;
    } else if (route.id === "commercial-cargo-agencies") {
      container.innerHTML = BlessERP.comercialCatalogs.renderAgenciesPage(appState);
      BlessERP.comercialCatalogs.bindAgenciesPage(container, appState);
      return;
    } else if (route.id === "commercial-destinations") {
      container.innerHTML = BlessERP.comercialCatalogs.renderDestinationsPage(appState);
      BlessERP.comercialCatalogs.bindDestinationsPage(container, appState);
      return;
    } else if (route.id === "commercial-daes") {
      container.innerHTML = BlessERP.comercialCatalogs.renderDaesPage(appState);
      BlessERP.comercialCatalogs.bindDaesPage(container, appState);
      return;
    } else if (route.id === "commercial-airlines") {
      container.innerHTML = BlessERP.comercialCatalogs.renderAirlinesPage(appState);
      BlessERP.comercialCatalogs.bindAirlinesPage(container, appState);
      return;
    } else if (route.id === "commercial-export-products") {
      html = BlessERP.comercialCatalogs.renderProductsPage(appState);
    } else if (route.id === "commercial-box-types") {
      html = BlessERP.comercialCatalogs.renderBoxTypesPage();
    } else if (route.id === "commercial-availability-reservations") {
      html = BlessERP.comercialAvailability.render(appState);
      container.innerHTML = html;
      return;
    } else if (route.id === "commercial-invoice-packing") {
      html = renderStandaloneInvoice(appState);
      container.innerHTML = html;
      BlessERP.comercialPedido.bind(container, appState);
      return;
    } else if (route.id === "commercial-client-invoice") {
      html = renderStandaloneClientInvoice(appState);
      container.innerHTML = html;
      BlessERP.comercialPedido.bind(container, appState);
      return;
    } else if (route.id === "commercial-print-center") {
      html = BlessERP.comercialPrint.renderPrintCenter(stateApi.currentOrder(appState), appState);
      container.innerHTML = html;
      BlessERP.comercialPedido.bind(container, appState);
      return;
    } else if (route.id === "commercial-packaging-report") {
      html = BlessERP.comercialPackaging.renderReport(appState);
      container.innerHTML = html;
      BlessERP.comercialHistory.bind(container, appState);
      return;
    } else if (route.id === "commercial-accounting-report") {
      html = BlessERP.comercialAccountingPreview.renderReport(appState);
      container.innerHTML = html;
      BlessERP.comercialAccountingPreview.bind(container, appState);
      return;
    } else if (route.id === "commercial-sri-authorization") {
      html = renderSriPlaceholder();
    } else {
      html = `
        <section class="page-header">
          <div>
            <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
            <h1>${utils.esc(route.title)}</h1>
            <p>${utils.esc(route.description)}</p>
          </div>
        </section>
      `;
    }

    container.innerHTML = html;
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.comercial = { render };
})();
