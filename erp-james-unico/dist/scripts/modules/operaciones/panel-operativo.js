(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function render(appState, route) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const summary = utils.buildPanelSummary(store);
    const cycleService = BlessERP.operacionesCycleDemo;
    const cycleSummary = cycleService?.getOperationalCycleSummaryDemo
      ? cycleService.getOperationalCycleSummaryDemo(appState)
      : { steps: [], counts: {}, futureSource: "Parte 1 POSCOSECHA", part1AdapterStatus: "PENDIENTE_INTEGRACION_REAL" };
    const availabilityRows = BlessERP.comercialOrderFulfillment?.getAvailabilityRows?.(appState) || [];
    const demandSummary = availabilityRows.reduce((acc, row) => ({
      physical: acc.physical + Number(row.physicalBunches || 0),
      demand: acc.demand + Number(row.demandPendingBunches || 0),
      projected: acc.projected + Number(row.projectedBunches || 0)
    }), { physical: 0, demand: 0, projected: 0 });
    const cards = [
      ["operations-parameters", "Catalogos maestros activos para todos los formularios operativos."],
      ["operations-reception", "Recepciones con proveedor, variedad, tipo de tallo, mallas y total automatico."],
      ["operations-grading", "Entregas al clasificador y registro separado de nacional o rechazo."],
      ["operations-labels", "Etiquetas individuales numericas; imprimir no crea inventario."],
      ["operations-bunch-intake", "Primer escaneo valido crea exactamente un ramo y fija su fecha oficial de ingreso."],
      ["operations-roses-inventory", "Inventario formado solo por ramos escaneados y separado de materiales."],
      ["operations-availability", "Disponibilidad derivada del inventario operativo nacido por escaneo."],
      ["operations-warehouse", "Ubicacion y edad calculadas desde la fecha real del escaneo."],
      ["operations-yields", "Clasificador desde entregas y embonchador desde escaneos validos."],
      ["operations-scanner", "Validacion tecnica HID y acceso compacto a los dos escaners operativos."],
      ["operations-dispatch", "Despacho operativo demo sincronizado visualmente con Pedido Maestro."]
    ];

    return `
      ${utils.renderPageHeader(route, "Flujo operativo integrado demo", "authorized")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner">
        <div>
          <strong>Flujo de Poscosecha conectado de principio a fin</strong>
          <span>Recepcion y clasificacion controlan trabajo; etiquetas identifican; solo el escaneo crea inventario; disponibilidad y rendimientos reutilizan esos datos.</span>
        </div>
        <button class="secondary-button" data-route-link="core-diagnostics">Ver diagnostico</button>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Modo operativo actual</strong>
          <span>Datos demo. No conecta inventario real, Supabase ni scanner real.</span>
        </div>
      </section>
      ${utils.renderSummaryCards([
        { label: "Ramos recibidos hoy", value: utils.number(summary.receivedToday), help: "Estimado demo desde recepciones del dia" },
        { label: "Ramos clasificados", value: utils.number(summary.classifiedBunches), help: "Total demo procesado en clasificacion" },
        { label: "Exportacion disponible", value: utils.number(summary.availableBunches), help: "Saldo demo entregable a Comercial" },
        { label: "Demanda comercial", value: utils.number(demandSummary.demand), help: "Ordenes liberadas sin reservas" },
        { label: "Saldo proyectado", value: utils.number(demandSummary.projected), help: "Stock fisico menos demanda pendiente" },
        { label: "Ramos nacionales", value: utils.number(summary.nationalBunches), help: "No reservables para exportacion demo" },
        { label: "Vencidos / observados", value: utils.number(summary.expiredBunches), help: "Requieren accion operativa" },
        { label: "Stock fisico escaneado", value: utils.number(demandSummary.physical), help: "Se asigna al leer el ramo dentro del pedido" },
        { label: "Variedades exportables", value: utils.number(summary.varietiesAvailable), help: "Disponibilidad demo actual" },
        { label: "Pedidos listos despacho", value: utils.number(summary.dispatchSummary.ready), help: "Pedidos listos para salida demo" },
        { label: "Pedidos en preparacion", value: utils.number(summary.dispatchSummary.preparing), help: "Despacho operativo en armado" },
        { label: "Despachados demo hoy", value: utils.number(summary.dispatchSummary.dispatchedToday), help: "Sin descuento real de inventario" },
        { label: "Pedidos observados", value: utils.number(summary.dispatchSummary.observed), help: "Requieren revision de despacho" },
        { label: "Anulados demo", value: utils.number(summary.dispatchSummary.cancelled), help: "Despachos demo anulados sin eliminar pedidos" },
        { label: "Cajas por despachar", value: utils.number(summary.dispatchSummary.totalBoxes), help: "Total de cajas en frente operativo demo" },
        { label: "Fulls por despachar", value: utils.number(summary.dispatchSummary.totalFulls.toFixed(2)), help: "Carga demo consolidada" },
        { label: "Cajas pendientes", value: utils.number(summary.dispatchSummary.pendingBoxes), help: "No despachadas ni anuladas" },
        { label: "Fulls pendientes", value: utils.number(summary.dispatchSummary.pendingFulls.toFixed(2)), help: "Pendientes en despacho demo" },
        { label: "Alertas despacho", value: utils.number(summary.dispatchSummary.alerts), help: "Pedidos pendientes u observados" },
        { label: "Rendimiento promedio", value: `${utils.number(summary.averageYield.toFixed(0))} / hora`, help: "Promedio demo por trabajador" },
        { label: "Etiquetas generadas", value: utils.number(summary.labelCount), help: "Lotes demo de etiquetas" },
        { label: "Escaneos demo hoy", value: utils.number(summary.scannerSummary.today), help: "Lecturas simuladas registradas" },
        { label: "Cajas escaneadas demo", value: utils.number(summary.scannerSummary.boxes), help: "Codigos CAJA validados visualmente" },
        { label: "Cajas pendientes escaneo", value: utils.number(summary.scannerSummary.pendingBoxes || 0), help: "Pendientes de lectura demo" },
        { label: "Codigos no encontrados", value: utils.number(summary.scannerSummary.notFound), help: "Lecturas demo sin coincidencia" },
        { label: "Duplicados demo", value: utils.number(summary.scannerSummary.duplicates), help: "Codigos repetidos en memoria demo" },
        { label: "Zebra real pendiente", value: summary.scannerSummary.zebraRealPending ? "Si" : "No", help: "Sin lector ni driver real conectado" },
        { label: "Consumos demo hoy", value: utils.number(summary.consumptionSummary.todaySimulated || 0), help: "Simulaciones de consumo por despacho" },
        { label: "Ramos consumidos demo", value: utils.number(summary.consumptionSummary.consumedBunches || 0), help: "No afecta inventario real" },
        { label: "Tallos consumidos demo", value: utils.number(summary.consumptionSummary.consumedStems || 0), help: "Solo kardex operativo demo" },
        { label: "Pendientes de simular", value: utils.number(summary.consumptionSummary.pendingOrders || 0), help: "Despachos demo sin consumo" },
        { label: "Consumos revertidos demo", value: utils.number(summary.consumptionSummary.revertedCount || 0), help: "Movimientos reversados en demo" }
      ])}
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CICLO OPERATIVO DEMO</p>
            <h3>Inventario -> Disponibilidad -> Demanda -> Bodega -> Despacho -> Consumo -> Kardex</h3>
          </div>
          <span class="status-badge partial">${utils.esc(cycleSummary.part1AdapterStatus || "PENDIENTE_INTEGRACION_REAL")}</span>
        </div>
        <p class="panel-note">Todo el ciclo sigue en DEMO. No descuenta inventario real, no conecta Supabase y no importa <code>app.js</code> completo de Parte 1.</p>
        <div class="placeholder-grid">
          ${(cycleSummary.steps || []).map(step => `
            <article class="panel-card subtle-card">
              <div class="panel-card-head">
                <div>
                  <p class="section-kicker">${utils.esc(step.contract)}</p>
                  <h3>${utils.esc(step.label)}</h3>
                </div>
                <span class="status-badge ${utils.badgeClass(step.status)}">${utils.esc(step.status)}</span>
              </div>
              <div class="info-stack">
                <div class="info-row"><strong>Cantidad demo</strong><span>${utils.esc(step.quantityLabel || utils.number(step.quantity || 0))}</span></div>
                <div class="info-row"><strong>Modulo responsable</strong><span>${utils.esc(step.module)}</span></div>
                <div class="info-row"><strong>Pendiente real</strong><span>${utils.esc(step.pendingReal)}</span></div>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="placeholder-grid">
        ${cards.map(([routeId, dataPoint]) => utils.buildModuleCard(routeId, {
          status: "Demo visual",
          dataPoint,
          futureAction: "Conectar adapter documentado de Parte 1"
        })).join("")}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ALERTAS OPERATIVAS</p>
              <h3>Radar actual del frente operativo</h3>
            </div>
            <span class="status-badge pending">${utils.esc(summary.alerts.length)}</span>
          </div>
          <div class="base-ready-list">
            ${summary.alerts.map(alert => `
              <div class="base-ready-item">
                <strong>${utils.esc(alert.title)}</strong>
                <span>${utils.esc(alert.detail)}</span>
              </div>
            `).join("") || `<div class="base-ready-item"><strong>Sin alertas</strong><span>El demo operativo no reporta novedades criticas.</span></div>`}
          </div>
        </article>
      </section>
    `;
  }

  BlessERP.operacionesPanel = { render };
})();
