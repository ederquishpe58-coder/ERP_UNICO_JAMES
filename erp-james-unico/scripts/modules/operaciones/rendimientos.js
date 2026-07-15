(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function renderTransitionView(store) {
    const yieldUtils = BlessERP.operacionesRendimientosUtils;
    const rows = yieldUtils.buildTransitionRows(store);
    return `
      <section class="placeholder-grid">
        ${rows.map(item => `
          <article class="panel-card subtle-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">TRANSICION OPERATIVA</p>
                <h3>${utils.esc(item.step)}</h3>
              </div>
              <span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span>
            </div>
            <div class="info-stack">
              <div class="info-row"><strong>Cantidad</strong><span>${utils.esc(item.countLabel)}</span></div>
              <div class="info-row"><strong>Detalle</strong><span>${utils.esc(item.detail)}</span></div>
            </div>
          </article>
        `).join("")}
      </section>
    `;
  }

  function renderWorkdayPanel(store) {
    const yieldUtils = BlessERP.operacionesRendimientosUtils;
    const status = yieldUtils.buildWorkdayStatus(store);
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BLESS FLOWER</p>
            <h3>Control de jornada</h3>
          </div>
          <span class="status-badge ${utils.badgeClass(status.status)}">${utils.esc(status.status)}</span>
        </div>
        <div class="placeholder-grid">
          <article class="panel-card subtle-card">
            <div class="info-stack">
              <div class="info-row"><strong>Fecha</strong><span>${utils.esc(utils.dateLabel(status.date))}</span></div>
              <div class="info-row"><strong>Inicio</strong><span>${utils.esc(status.startedAt)}</span></div>
              <div class="info-row"><strong>Pausa</strong><span>${utils.esc(status.pausedAt)}</span></div>
              <div class="info-row"><strong>Cierre</strong><span>${utils.esc(status.endedAt)}</span></div>
            </div>
          </article>
          <article class="panel-card subtle-card">
            <div class="info-stack">
              <div class="info-row"><strong>Meta clasificador</strong><span>${utils.esc(utils.number(status.classifierDailyGoal))} mallas/dia</span></div>
              <div class="info-row"><strong>Meta clasificador/hora</strong><span>${utils.esc(status.classifierHourlyGoal.toFixed(1))} mallas/hora</span></div>
              <div class="info-row"><strong>Meta embonchador/hora</strong><span>${utils.esc(utils.number(status.buncherHourlyGoal))} bonches/hora</span></div>
              <div class="info-row"><strong>Jornada base</strong><span>${utils.esc(utils.number(status.workdayHours))} horas</span></div>
            </div>
          </article>
        </div>
        <p class="panel-note">${utils.esc(status.observation)} No modifica rol de pagos; solo prepara los parametros operativos que despues se revisaran.</p>
        <div class="button-row">
          <button class="secondary-button" type="button" data-ops-action="yield-workday-start">Iniciar jornada</button>
          <button class="secondary-button" type="button" data-ops-action="yield-workday-pause">Pausar</button>
          <button class="secondary-button" type="button" data-ops-action="yield-workday-resume">Reanudar</button>
          <button class="primary-button" type="button" data-ops-action="yield-workday-close">Cerrar jornada demo</button>
        </div>
      </section>
    `;
  }

  function renderInventoryRelation(store) {
    const yieldUtils = BlessERP.operacionesRendimientosUtils;
    const rows = yieldUtils.buildInventoryRelationRows(store);
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">RELACION CON INVENTARIO OPERATIVO</p>
            <h3>Ramos ingresados reflejados en inventario demo</h3>
          </div>
          <span class="status-badge partial">Demo visual</span>
        </div>
        <p class="panel-note">Esta tabla muestra el puente operativo: un ramo leido en Rendimientos puede reflejarse en Inventario de rosas demo. No descuenta ni modifica inventario real.</p>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo ramo</th>
                <th>Variedad</th>
                <th>Longitud</th>
                <th>Embonchador</th>
                <th>Inventario demo</th>
                <th>Bodega</th>
                <th>Ubicacion</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${utils.esc(item.code)}</td>
                  <td>${utils.esc(item.variety)}</td>
                  <td>${utils.esc(`${utils.number(item.length)} cm`)}</td>
                  <td>${utils.esc(item.buncher)}</td>
                  <td>${utils.esc(item.inventoryId)}</td>
                  <td>${utils.esc(item.warehouse)}</td>
                  <td>${utils.esc(item.location)}</td>
                  <td><span class="status-badge ${utils.badgeClass(item.state)}">${utils.esc(item.state)}</span></td>
                </tr>
              `).join("") || `<tr><td colspan="8" class="empty-row">Sin ramos relacionados con inventario demo.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderRegistrosView(store) {
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">REGISTROS DE RENDIMIENTO</p>
            <h3>Resumen consolidado por actividad</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Trabajador</th>
                <th>Actividad</th>
                <th>Variedad</th>
                <th>Ramos</th>
                <th>Tallos</th>
                <th>Rendimiento hora</th>
                <th>Observacion</th>
              </tr>
            </thead>
            <tbody>
              ${store.performances.map(item => `
                <tr>
                  <td>${utils.esc(utils.dateLabel(item.date))}</td>
                  <td>${utils.esc(item.worker)}</td>
                  <td>${utils.esc(item.activity)}</td>
                  <td>${utils.esc(item.variety)}</td>
                  <td>${utils.esc(utils.number(item.bunches))}</td>
                  <td>${utils.esc(utils.number(item.stems))}</td>
                  <td>${utils.esc(utils.number(item.performancePerHour))}</td>
                  <td>${utils.esc(item.observation || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderOverview(appState, store) {
    const yieldUtils = BlessERP.operacionesRendimientosUtils;
    const summary = yieldUtils.buildYieldSummary(store);
    const classifierRows = yieldUtils.buildClassifierRanking(store);
    const buncherRows = yieldUtils.buildBuncherRanking(store);
    return `
      ${renderWorkdayPanel(store)}
      <section class="hero-banner">
        <div>
          <strong>Rendimientos reestructurados con flujo operativo</strong>
          <span>Clasificadores se miden desde entregas/cierres y embonchadores desde ramos efectivamente escaneados. Imprimir etiquetas no suma rendimiento.</span>
        </div>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Despacho y contabilidad siguen separados</strong>
          <span>Datos demo. No conecta inventario real, Supabase ni scanner real.</span>
        </div>
      </section>
      ${utils.renderSummaryCards([
        { label: "Mallas procesadas", value: utils.number(summary.totalMeshes), help: "Ingreso separado por clasificador" },
        { label: "Tallos por mallas", value: utils.number(summary.totalMeshStems), help: "25 tallos por malla + extras" },
        { label: "Ramos ingresados", value: utils.number(summary.totalBunches), help: "Lectura separada dentro de Rendimientos" },
        { label: "Tallos ingresados", value: utils.number(summary.totalBunchStems), help: "Base visual para inventario operativo" },
        { label: "Clasificadores activos", value: utils.number(summary.classifierWorkers), help: "Con mallas procesadas en el dia" },
        { label: "Embonchadores activos", value: utils.number(summary.buncherWorkers), help: "Con ramos ingresados en el dia" },
        { label: "Duplicados detectados", value: utils.number(summary.duplicateEvents), help: "Lecturas repetidas en demo" },
        { label: "Avance clasificacion", value: `${utils.number(summary.classifierProgress)}%`, help: `${utils.number(summary.classifierDailyGoal)} mallas/dia meta demo` },
        { label: "Avance embonchado", value: `${utils.number(summary.buncherProgress)}%`, help: `${utils.number(summary.buncherDailyGoal)} bonches/dia meta demo` }
      ])}
      ${BlessERP.operacionesPlanOperativo.render(appState)}
      <section class="placeholder-grid">
        ${yieldUtils.renderRankingTable("Rendimiento de clasificadores", "MALLAS / HORA", classifierRows, "classifier")}
        ${yieldUtils.renderRankingTable("Rendimiento de embonchadores", "BONCHES / HORA", buncherRows, "buncher")}
      </section>
      ${renderInventoryRelation(store)}
    `;
  }

  function render(appState, route) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const yieldUtils = BlessERP.operacionesRendimientosUtils;
    const activeView = yieldUtils.getYieldsView(ui);
    const views = [
      ["rendimientos", "RENDIMIENTOS"],
      ["mallas", "MALLAS PRC"],
      ["ramos", "RAMOS ING"],
      ["registros", "REGISTROS"],
      ["transiciones", "TRANSICIONES"]
    ];

    let body = "";
    if (activeView === "mallas") {
      body = BlessERP.operacionesMallasProcesadas.render(appState);
    } else if (activeView === "ramos") {
      body = BlessERP.operacionesRamosIngresados.render(appState);
    } else if (activeView === "registros") {
      body = renderRegistrosView(store);
    } else if (activeView === "transiciones") {
      body = renderTransitionView(store);
    } else {
      body = renderOverview(appState, store);
    }

    return `
      ${utils.renderPageHeader(route, "Rendimientos operativos demo", "partial", "Base operativa inspirada en Parte 1 con mallas procesadas, ramos ingresados y registros separados.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner">
        <div>
          <strong>Opciones de Rendimientos</strong>
          <span>RAMOS ING es ahora una consulta de los ingresos creados en la estacion de escaneo; no permite generar inventario desde Rendimientos.</span>
        </div>
      </section>
      <div class="subnav-tabs">
        ${views.map(([value, label]) => `
          <button class="subnav-tab ${activeView === value ? "active" : ""}" data-ops-ui-field="yieldsView" data-value="${utils.esc(value)}">${utils.esc(label)}</button>
        `).join("")}
      </div>
      ${body}
    `;
  }

  BlessERP.operacionesRendimientos = { render };
})();
