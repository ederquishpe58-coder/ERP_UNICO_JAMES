(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;
  const deferredRenderTokens = new Map();
  let panelCache = null;

  function renderRouteLoading({ title, description, status, detail }) {
    return `
      <section class="page-header">
        <div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>${utils.esc(title)}</h1><p>${utils.esc(description)}</p></div>
        <div class="page-header-side"><span class="order-tracking-loading-status"><span class="jaeder-loading-spinner" aria-hidden="true"></span>${utils.esc(status)}</span></div>
      </section>
      <section class="order-tracking-progress" data-jaeder-deferred-content role="status" aria-live="polite" aria-busy="true">
        <div class="order-tracking-skeleton-grid" aria-hidden="true">
          ${Array.from({ length: 3 }, () => `<article><span class="order-tracking-skeleton-line short"></span><span class="order-tracking-skeleton-line metric"></span><span class="order-tracking-skeleton-line"></span></article>`).join("")}
        </div>
        <section class="panel-card order-tracking-skeleton-panel" aria-hidden="true">
          <div class="order-tracking-skeleton-filters"><span class="order-tracking-skeleton-line"></span><span class="order-tracking-skeleton-line"></span></div>
          ${Array.from({ length: 5 }, () => `<div class="order-tracking-skeleton-row"><span></span><span></span><span></span><span></span></div>`).join("")}
        </section>
        <p>${utils.esc(detail)}</p>
      </section>
    `;
  }

  function renderRouteDeferred(container, appState, routeId, loading, renderContent, bindContent) {
    const token = Number(deferredRenderTokens.get(routeId) || 0) + 1;
    deferredRenderTokens.set(routeId, token);
    container.innerHTML = renderRouteLoading(loading);
    const complete = () => {
      if (token !== deferredRenderTokens.get(routeId) || BlessERP.state.currentRoute().id !== routeId) return;
      try {
        BlessERP.performance?.measureSync?.(`render:${routeId}:contenido`, () => {
          container.innerHTML = renderContent();
          bindContent();
          BlessERP.layout.finalizeDeferredContent?.(container);
        }, { routeId });
        BlessERP.performance?.finishRouteTransition?.(routeId, {
          domNodes: container.querySelectorAll("*").length,
          progressive: true
        });
      } catch (error) {
        container.innerHTML = `<section class="panel-card"><h2>No se pudo abrir ${utils.esc(loading.title)}</h2><p>${utils.esc(error?.message || "Error de carga")}</p></section>`;
        BlessERP.performance?.finishRouteTransition?.(routeId, { error: true, progressive: true });
        console.error(`[JAEDER][${routeId}]`, error);
      }
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(complete));
    } else {
      window.setTimeout(complete, 20);
    }
  }

  function renderTrackingLoading() {
    return renderRouteLoading({
      title: "Seguimiento de pedidos",
      description: "Consulte el avance de Cuarto frio y el contenido real ingresado en cada caja.",
      status: "Preparando pedidos...",
      detail: "Organizando estados, cajas y ramos ingresados. La pantalla se completará automáticamente."
    });
  }

  function renderTrackingDeferred(container, appState) {
    renderRouteDeferred(container, appState, "commercial-order-detail", {
      title: "Seguimiento de pedidos",
      description: "Consulte el avance de Cuarto frio y el contenido real ingresado en cada caja.",
      status: "Preparando pedidos...",
      detail: "Organizando estados, cajas y ramos ingresados. La pantalla se completará automáticamente."
    }, () => BlessERP.comercialOrderDetail.render(appState, "SEGUIMIENTO"), () => {
      BlessERP.comercialOrderDetail.bind(container, appState);
    });
  }

  function renderPanelLegacy(appState) {
    const revision = Number(BlessERP.state?.dataRevision?.() || 0);
    const companyId = String(BlessERP.services?.companyContext?.activeCompanyId?.() || appState?.db?.activeCompanyId || "");
    if (panelCache?.revision === revision && panelCache.companyId === companyId) return panelCache.html;
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
      ["commercial-preorders", "PO Nuevo", "Borradores opcionales que no afectan inventario ni SRI y pueden generar un pedido prellenado."],
      ["commercial-order-master", "Crear pedido", "Formulario para registrar una orden nueva y editar pedidos existentes desde el historial."],
      ["commercial-order-detail", "Seguimiento de pedidos", "Avance de Cuarto frio, contenido real por caja y coordinacion diaria."],
      ["commercial-order-coordination", "Coordinacion diaria", "Editor general por fecha para guias y DAE maritimas."],
      ["commercial-order-history", "Pedidos / Historial", "Bandeja central de pedidos, documentos comerciales e impresion directa."],
      ["commercial-customers-brands", "Clientes principales", "Catálogo editable de compradores, contactos y condiciones comerciales."],
      ["commercial-brands", "Marcas / Clientes finales", "Marcas relacionadas con cada cliente principal, destino, agencia y reglas de PO."],
      ["commercial-countries", "Paises", "Catalogo unico de paises para clientes, marcas, destinos y DAEs."],
      ["commercial-daes", "DAE / Aduana", "Catálogo editable de DAEs activas y caducidad."],
      ["commercial-senae-liquidation", "Liquidación SENAE", "Facturas SRI autorizadas locales y de exportación por fecha de emisión."],
      ["commercial-credit-notes", "Notas de crédito", "Correcciones totales o parciales vinculadas a facturas SRI autorizadas."],
      ["commercial-sri-authorization", "Documentos electronicos SRI", "Bandeja de emision y autorizacion en ambiente de pruebas."]
    ];

    const html = `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Panel comercial</h1>
          <p>Pedidos, catálogos, disponibilidad compartida, documentos comerciales y facturación electrónica por empresa.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Activo comercial</span>
        </div>
      </section>
      <section class="summary-grid">
        <article class="summary-card">
          <span>Pedidos</span>
          <strong>${utils.esc(orders.length)}</strong>
          <small>Pedidos guardados localmente</small>
        </article>
        <article class="summary-card">
          <span>Total USD</span>
          <strong>${utils.esc(utils.money(portfolio.totalUsd))}</strong>
          <small>Historial comercial integrado</small>
        </article>
        <article class="summary-card">
          <span>Pedidos listos despacho</span>
          <strong>${utils.esc(dispatchReady)}</strong>
          <small>Checklist operativo aprobado</small>
        </article>
        <article class="summary-card">
          <span>Despachados</span>
          <strong>${utils.esc(dispatchedDemo)}</strong>
          <small>Consumo vinculado al despacho</small>
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
          <small>No listas para despacho</small>
        </article>
        <article class="summary-card">
          <span>Pendientes checklist</span>
          <strong>${utils.esc(dispatchPendingChecklist)}</strong>
          <small>Advertencias de despacho</small>
        </article>
        <article class="summary-card">
          <span>Errores despacho</span>
          <strong>${utils.esc(Math.max(dispatchCriticalErrors, ordersWithCycleErrors))}</strong>
          <small>Despacho o ciclo operativo</small>
        </article>
        <article class="summary-card">
          <span>Disponibilidad para venta</span>
          <strong>${utils.esc(utils.number(exportAvailableBunches))}</strong>
          <small>Inventario menos pedidos activos</small>
        </article>
        <article class="summary-card">
          <span>Ramos comprometidos</span>
          <strong>${utils.esc(utils.number(reservedBunches))}</strong>
          <small>availabilityContract + reservationContract</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con compromiso</span>
          <strong>${utils.esc(ordersWithReservations)}</strong>
          <small>Con enlace al ciclo operativo</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con consumo</span>
          <strong>${utils.esc(ordersWithConsumptionDemo)}</strong>
          <small>Consumo simulado en Operaciones</small>
        </article>
        <article class="summary-card">
          <span>Pendientes de consumo</span>
          <strong>${utils.esc(ordersPendingConsumptionDemo)}</strong>
          <small>Despachados sin consumo simulado</small>
        </article>
        <article class="summary-card">
          <span>Ramos reservados operaciones</span>
          <strong>${utils.esc(utils.number(reservedBunches))}</strong>
          <small>Ramos enlazados desde Operaciones</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con errores ciclo</span>
          <strong>${utils.esc(ordersWithCycleErrors)}</strong>
          <small>Requieren revisar el flujo operativo</small>
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
          <small>No bloquea, pero requiere revisar el pedido</small>
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
          <span>Facturas pendientes</span>
          <strong>${utils.esc(accountingPortfolio.pendingClientInvoices)}</strong>
          <small>Pendientes de revisión contable</small>
        </article>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Conexiones y alertas</strong>
          <span>${utils.esc(portfolio.alerts.length ? `${portfolio.alerts.length} alertas comerciales activas. ${dispatchReady} pedido(s) listos despacho, ${dispatchObserved} observado(s), ${expiringDaes} DAE(s) proximas a caducar.` : `Sin alertas comerciales criticas. ${dispatchReady} pedido(s) listos despacho, ${ordersWithReservations} pedido(s) con flor comprometida.`)}</span>
        </div>
              <button class="secondary-button" data-route-link="core-diagnostics">Ver diagnostico del sistema</button>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Entorno actual</strong>
          <span>Datos guardados en este navegador. La emisión SRI está habilitada solamente en ambiente de pruebas; producción permanece bloqueada.</span>
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
              <span class="status-badge authorized">Activo</span>
            </div>
            <p class="panel-note">${utils.esc(description)}</p>
            <button class="secondary-button" data-route-link="${utils.esc(routeId)}">Abrir</button>
          </article>
        `).join("")}
      </section>
    `;
    panelCache = { revision, companyId, html };
    return html;
  }

  function renderPanel(appState) {
    const flow = BlessERP.commercialFlowV2;
    const companyId = flow.activeCompanyId(appState);
    const orders = (appState.db.commercial?.orders || []).filter(order => String(order.sellingCompanyId || order.companyId || order.company_id) === companyId);
    const activeOrders = flow.activeOrders(appState);
    const coldRoomOrders = flow.getWarehouseOrders(appState);
    const availability = flow.getAvailabilityRows(appState);
    const pendingBunches = activeOrders.reduce((sum, order) => sum + Number(flow.buildOrderFulfillment(order)?.pendingBunches || 0), 0);
    const availableBunches = availability.reduce((sum, row) => sum + Number(row.availableBunches || 0), 0);
    const cards = [
      ["commercial-order-master", "Crear pedido", "Formulario nuevo en memoria; se confirma solamente al guardar."],
      ["commercial-order-history", "Pedidos / Historial", "Pedidos confirmados, edición y documentos bajo demanda."],
      ["commercial-order-detail", "Seguimiento", "Contenido por caja y avance de preparación, sin editar el pedido."],
      ["commercial-order-coordination", "Coordinación diaria", "Editor exclusivo de DAE, guía madre y guía hija."],
      ["commercial-availability-reservations", "Disponibilidad", "Inventario físico frente a pedidos guardados."],
      ["commercial-sri-authorization", "Documentos electrónicos SRI", "Facturas y notas de crédito separadas del pedido operativo."]
    ];
    return `
      <section class="page-header"><div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>Panel comercial</h1><p>Navegación ligera del flujo confirmado de pedidos.</p></div></section>
      <section class="summary-grid">
        ${[["Pedidos confirmados", orders.length], ["Pedidos activos", activeOrders.length], ["En Cuarto Frío", coldRoomOrders.length], ["Ramos pendientes", pendingBunches], ["Disponible spot", availableBunches]].map(item => `<article class="summary-card"><span>${item[0]}</span><strong>${item[1]}</strong></article>`).join("")}
      </section>
      <section class="module-grid">${cards.map(([routeId, title, description]) => `<button type="button" class="module-card" data-route-link="${routeId}"><span class="module-icon">${title.slice(0, 2).toUpperCase()}</span><strong>${utils.esc(title)}</strong><small>${utils.esc(description)}</small></button>`).join("")}</section>`;
  }

  function renderStandaloneInvoice(appState) {
    const order = stateApi.currentOrder(appState);
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Invoice / Packing carguera</h1>
          <p>Preview dinamico del documento comercial basado en el pedido activo.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Demo documento</span>
        </div>
      </section>
      ${BlessERP.comercialPrintSystem.renderWorkspace("INVOICE_PACKING_REFERENCIAL", order, appState, {
        title: "Invoice / Packing carguera",
        description: "Preview dinamico del documento comercial basado en el pedido activo.",
        actionsMarkup: `
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-preview-doc="INVOICE_PACKING_REFERENCIAL">Vista previa referencial</button>
            <button class="primary-button" data-commercial-print-doc="INVOICE_PACKING_REFERENCIAL">Imprimir referencial</button>
            <button class="secondary-button" data-commercial-preview-doc="INVOICE_PACKING_REAL">Vista previa real demo</button>
            <button class="secondary-button" data-commercial-download-doc="INVOICE_PACKING_REFERENCIAL">Guardar PDF</button>
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
    if (route.id !== "commercial-senae-liquidation") {
      BlessERP.comercialSriAuthorization?.unmountSenae?.();
    }
    if (route.id === "commercial-panel") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderRouteDeferred(container, appState, route.id, {
          title: "Panel comercial",
          description: "Resumen operativo, comercial y tributario por empresa.",
          status: "Preparando indicadores...",
          detail: "Consolidando únicamente los indicadores visibles. Los accesos ya están disponibles desde el menú."
        }, () => renderPanel(appState), () => {});
        return;
      }
      container.innerHTML = renderPanel(appState);
      return;
    }
    if (route.id === "commercial-order-master") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderRouteDeferred(container, appState, route.id, {
          title: "Crear pedido",
          description: "Cliente, logística, cajas, variedades, cantidades y precios.",
          status: "Preparando formulario...",
          detail: "Cargando los catálogos y la estructura del pedido. Podrá empezar a trabajar en cuanto aparezca el formulario."
        }, () => BlessERP.comercialPedido.render(appState), () => {
          BlessERP.comercialPedido.bind(container, appState);
        });
        return;
      }
      container.innerHTML = BlessERP.comercialPedido.render(appState);
      BlessERP.comercialPedido.bind(container, appState);
      return;
    }
    if (route.id === "commercial-preorders") {
      container.innerHTML = BlessERP.comercialPreorders.render(appState);
      BlessERP.comercialPreorders.bind(container, appState);
      return;
    }
    if (route.id === "commercial-orders-day") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderRouteDeferred(container, appState, route.id, {
          title: "Órdenes del día",
          description: "Pedidos registrados para una fecha específica.",
          status: "Preparando órdenes...",
          detail: "Calculando el avance únicamente de la página visible."
        }, () => BlessERP.comercialOrdersDay.render(appState), () => {
          BlessERP.comercialOrdersDay.bind(container, appState);
        });
        return;
      }
      container.innerHTML = BlessERP.comercialOrdersDay.render(appState);
      BlessERP.comercialOrdersDay.bind(container, appState);
      return;
    }
    if (route.id === "commercial-order-detail") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderTrackingDeferred(container, appState);
        return;
      }
      container.innerHTML = BlessERP.comercialOrderDetail.render(appState, "SEGUIMIENTO");
      BlessERP.comercialOrderDetail.bind(container, appState);
      return;
    }
    if (route.id === "commercial-order-coordination") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderRouteDeferred(container, appState, route.id, {
          title: "Coordinación diaria",
          description: "Guías y DAE de los pedidos de una fecha.",
          status: "Consultando pedidos del día...",
          detail: "La pantalla mostrará primero su estructura y luego la página de pedidos correspondiente."
        }, () => BlessERP.comercialOrderDetail.render(appState, "COORDINACION"), () => {
          BlessERP.comercialOrderDetail.bind(container, appState);
        });
        return;
      }
      container.innerHTML = BlessERP.comercialOrderDetail.render(appState, "COORDINACION");
      BlessERP.comercialOrderDetail.bind(container, appState);
      return;
    }
    if (route.id === "commercial-export-shipments") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderRouteDeferred(container, appState, route.id, {
          title: "Expedientes de exportación",
          description: "Pedido, despacho, DAE, guías, vuelo y documentación.",
          status: "Preparando expedientes...",
          detail: "Cargando únicamente la información logística canónica del módulo."
        }, () => BlessERP.comercialExportShipments.render(appState), () => {
          BlessERP.comercialExportShipments.bind(container, appState);
        });
        return;
      }
      container.innerHTML = BlessERP.comercialExportShipments.render(appState);
      BlessERP.comercialExportShipments.bind(container, appState);
      return;
    }
    if (route.id === "commercial-order-history") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderRouteDeferred(container, appState, route.id, {
          title: "Pedidos / Historial",
          description: "Consulte y edite los pedidos comerciales registrados.",
          status: "Preparando historial...",
          detail: "Organizando filtros y pedidos visibles. La tabla aparecerá automáticamente sin bloquear la navegación."
        }, () => BlessERP.comercialHistory.render(appState), () => {
          BlessERP.comercialHistory.bind(container, appState);
        });
        return;
      }
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
    } else if (route.id === "commercial-countries") {
      container.innerHTML = BlessERP.comercialCatalogs.renderCountriesPage(appState);
      BlessERP.comercialCatalogs.bindCountriesPage(container, appState);
      return;
    } else if (route.id === "commercial-export-products") {
      html = BlessERP.comercialCatalogs.renderProductsPage(appState);
    } else if (route.id === "commercial-box-types") {
      html = BlessERP.comercialCatalogs.renderBoxTypesPage();
    } else if (route.id === "commercial-availability-reservations") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderRouteDeferred(container, appState, route.id, {
          title: "Disponibilidad",
          description: "Inventario físico frente a pedidos y disponibilidad comercial.",
          status: "Calculando disponibilidad...",
          detail: "Consolidando variedades, medidas y pedidos guardados. Los resultados se mostrarán automáticamente."
        }, () => BlessERP.comercialAvailability.render(appState), () => {
          BlessERP.comercialAvailability.bind(container, appState);
        });
        return;
      }
      html = BlessERP.comercialAvailability.render(appState);
      container.innerHTML = html;
      BlessERP.comercialAvailability.bind(container, appState);
      return;
    } else if (route.id === "commercial-invoice-packing") {
      container.innerHTML = renderStandaloneInvoice(appState);
      BlessERP.comercialPedido.bind(container, appState);
      return;
    } else if (route.id === "commercial-client-invoice") {
      container.innerHTML = renderStandaloneClientInvoice(appState);
      BlessERP.comercialPedido.bind(container, appState);
      return;
    } else if (route.id === "commercial-print-center") {
      const order = stateApi.currentOrder(appState);
      container.innerHTML = BlessERP.comercialPrint.renderPrintCenter(order, appState);
      BlessERP.comercialPrint.bind(container, appState);
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
    } else if (route.id === "commercial-credit-notes") {
      html = BlessERP.comercialSriAuthorization.renderCreditNotes(appState);
      container.innerHTML = html;
      BlessERP.comercialSriAuthorization.bindCreditNotes(container, appState);
      return;
    } else if (route.id === "commercial-senae-liquidation") {
      html = BlessERP.comercialSriAuthorization.renderSenae(appState);
      container.innerHTML = html;
      BlessERP.comercialSriAuthorization.bindSenae(container, appState);
      return;
    } else if (route.id === "commercial-sri-authorization") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        // Cada entrada a la bandeja tributaria comienza sin mes seleccionado.
        // Los rerenders internos conservan el mes mientras el usuario trabaja.
        BlessERP.comercialSriAuthorization.resetDocumentsEntry?.();
        renderRouteDeferred(container, appState, route.id, {
          title: "Documentos electrónicos SRI",
          description: "Facturas, notas de crédito, XML y RIDE por estado tributario.",
          status: "Preparando documentos...",
          detail: "Organizando documentos, filtros y estados de autorización. La bandeja se completará automáticamente."
        }, () => BlessERP.comercialSriAuthorization.render(appState), () => {
          BlessERP.comercialSriAuthorization.bind(container, appState);
        });
        return;
      }
      html = BlessERP.comercialSriAuthorization.render(appState);
      container.innerHTML = html;
      BlessERP.comercialSriAuthorization.bind(container, appState);
      return;
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
