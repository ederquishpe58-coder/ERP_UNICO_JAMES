(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function optionList(values, current) {
    return values.map(item => `<option value="${utils.esc(item)}" ${item === current ? "selected" : ""}>${utils.esc(item)}</option>`).join("");
  }

  function render(appState, route) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const summary = utils.buildInventoryStatusSummary(store);
    const parte1Adapter = BlessERP.operacionesParte1Adapter;
    const cycleService = BlessERP.operacionesCycleDemo;
    const consumptionService = BlessERP.operacionesConsumptionDemo;
    const adapterStatus = parte1Adapter?.getParte1AdapterStatus
      ? parte1Adapter.getParte1AdapterStatus()
      : {
          status: "PENDIENTE_INTEGRACION_REAL",
          mode: "ADAPTADOR_DEMO",
          source: "Parte 1 POSCOSECHA",
          real_connection: false,
          supabase_connection: false,
          appjs_imported: false,
          supported_contracts: [],
          warnings: []
        };
    const adapterInventory = parte1Adapter?.loadInventarioRosasFromParte1
      ? parte1Adapter.loadInventarioRosasFromParte1()
      : { rawRows: [], mappedRows: [] };
    const adapterWarnings = parte1Adapter?.getParte1IntegrationWarnings
      ? parte1Adapter.getParte1IntegrationWarnings()
      : [];
    const adapterSampleRaw = adapterInventory.rawRows?.[0] || null;
    const adapterValidation = adapterSampleRaw && parte1Adapter?.validateParte1InventoryPayload
      ? parte1Adapter.validateParte1InventoryPayload(adapterSampleRaw)
      : { valid: false, errors: [], warnings: [], normalizedItem: null };
    const adapterMapped = adapterSampleRaw && parte1Adapter?.mapParte1InventoryToOperationalInventoryContract
      ? parte1Adapter.mapParte1InventoryToOperationalInventoryContract(adapterSampleRaw)
      : null;
    const consumptionSummary = consumptionService?.getConsumptionSummaryDemo
      ? consumptionService.getConsumptionSummaryDemo(appState)
      : {
          availableBunches: 0,
          reservedBunches: 0,
          consumedBunches: 0,
          consumedStems: 0,
          simulatedCount: 0,
          revertedCount: 0
        };
    const consumptionRows = consumptionService?.getConsumptionsDemo
      ? consumptionService.getConsumptionsDemo(appState)
      : [];
    const kardexRows = consumptionService?.getKardexOperativoDemo
      ? consumptionService.getKardexOperativoDemo(appState)
      : [];
    const cycleSummary = cycleService?.getOperationalCycleSummaryDemo
      ? cycleService.getOperationalCycleSummaryDemo(appState)
      : {
          source: "DEMO",
          futureSource: "Parte 1 POSCOSECHA",
          counts: {
            reservedBunches: 0,
            dispatchedBunches: 0,
            consumedBunches: 0,
            consumedStems: 0,
            kardexRows: 0
          }
        };
    const rows = ui.inventoryStateFilter === "TODOS"
      ? store.roseInventory
      : store.roseInventory.filter(item => item.state === ui.inventoryStateFilter);
    const filteredKardexRows = kardexRows.filter(item => {
      if (ui.kardexFilterPedido && String(item.pedido_id || "") !== String(ui.kardexFilterPedido)) return false;
      if (ui.kardexFilterVariedad && String(item.variedad || "").toUpperCase() !== String(ui.kardexFilterVariedad || "").toUpperCase()) return false;
      if (ui.kardexFilterLongitud && String(item.longitud || "") !== String(ui.kardexFilterLongitud || "")) return false;
      if (ui.kardexFilterMovimiento && String(item.tipo_movimiento || "").toUpperCase() !== String(ui.kardexFilterMovimiento || "").toUpperCase()) return false;
      return true;
    });
    const kardexPedidos = [...new Set(kardexRows.map(item => item.pedido_id).filter(Boolean))].sort();
    const kardexVariedades = [...new Set(kardexRows.map(item => item.variedad).filter(Boolean))].sort();
    const kardexLongitudes = [...new Set(kardexRows.map(item => item.longitud).filter(value => value !== undefined && value !== null && String(value).trim() !== ""))].sort((a, b) => Number(a) - Number(b));
    const kardexMovimientos = [...new Set(kardexRows.map(item => item.tipo_movimiento).filter(Boolean))].sort();

    return `
      ${utils.renderPageHeader(route, "Inventario operativo por escaneo", "authorized", "Cada fila representa un ramo creado por el primer escaneo valido de su etiqueta.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner">
        <div>
          <strong>Solo los ramos escaneados pertenecen al inventario</strong>
          <span>Imprimir etiquetas, recibir flor o clasificar no crea stock. Este inventario permanece separado de cartones, ligas, capuchones y otros materiales.</span>
        </div>
        <button class="secondary-button" data-route-link="inventory-summary">Ver inventario suministros / empaque</button>
      </section>
      ${utils.renderSummaryCards([
        { label: "Disponibles", value: utils.number(summary.DISPONIBLE || 0), help: "Ramos utilizables para disponibilidad futura" },
        { label: "Asignados a cajas", value: utils.number(summary.ASIGNADO_CAJA || 0), help: "Ya no aparecen como disponibles" },
        { label: "Observados", value: utils.number(summary.OBSERVADO || 0), help: "Pendientes de revision" },
        { label: "Vencidos", value: utils.number(summary.VENCIDO || 0), help: "No mezclar con inventario contable" }
      ])}
      <section class="panel-card compact-toolbar-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FILTRO</p>
            <h3>Stock operativo demo</h3>
          </div>
        </div>
        <div class="compact-toolbar compact-toolbar-inventory">
          <label class="compact-inline-field">
            <span>Estado</span>
            <select data-ops-ui-field="inventoryStateFilter">
              ${optionList(["TODOS", ...store.catalogs.inventoryStates], ui.inventoryStateFilter)}
            </select>
          </label>
          <div class="base-ready-item"><strong>Total filas</strong><span>${utils.esc(utils.number(rows.length))}</span></div>
          <div class="base-ready-item"><strong>Contrato</strong><span>Base para availabilityContract</span></div>
          <div class="base-ready-item"><strong>Persistencia</strong><span>Solo local/demo</span></div>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">RESUMEN CICLO OPERATIVO</p>
            <h3>Inventario -> disponibilidad -> reserva -> despacho -> consumo -> kardex</h3>
          </div>
          <span class="status-badge partial">DEMO</span>
        </div>
        <p class="panel-note">El saldo mostrado es demo. No corresponde al inventario real de rosas.</p>
        ${utils.renderSummaryCards([
          { label: "Ramos disponibles demo", value: utils.number(consumptionSummary.availableBunches || 0), help: "Saldo visual operativo" },
          { label: "Ramos reservados demo", value: utils.number(cycleSummary.counts.reservedBunches || 0), help: "Reservas desde Pedido Maestro" },
          { label: "Ramos despachados demo", value: utils.number(cycleSummary.counts.dispatchedBunches || 0), help: "Ramos en despachos demo" },
          { label: "Ramos consumidos demo", value: utils.number(cycleSummary.counts.consumedBunches || 0), help: "Consumo simulado" },
          { label: "Tallos consumidos demo", value: utils.number(cycleSummary.counts.consumedStems || 0), help: "No afecta stock real" },
          { label: "Saldo demo", value: utils.number((consumptionSummary.availableBunches || 0) - (cycleSummary.counts.consumedBunches || 0)), help: "Saldo visual restante" },
          { label: "Kardex demo generado", value: utils.number(cycleSummary.counts.kardexRows || 0), help: "Movimientos operativos demo" },
          { label: "Fuente actual", value: cycleSummary.source || "DEMO", help: "Sin conexion real" },
          { label: "Fuente futura", value: cycleSummary.futureSource || "Parte 1 POSCOSECHA", help: "Pendiente de integracion real" }
        ])}
      </section>
      <section class="panel-card">
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo etiqueta</th>
                <th>Fecha/hora ingreso</th>
                <th>Variedad</th>
                <th>Longitud</th>
                <th>Tallos por ramo</th>
                <th>Embonchador</th>
                <th>Bodega</th>
                <th>Proveedor</th>
                <th>Bloque</th>
                <th>Edad dias</th>
                <th>Categoria</th>
                <th>Pedido / caja</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${utils.esc(item.labelCode || "LEGADO DEMO")}</td>
                  <td>${utils.esc(item.admittedAt || item.date)}</td>
                  <td>${utils.esc(item.variety)}</td>
                  <td>${utils.esc(item.length)} cm</td>
                  <td>${utils.esc(utils.number(item.stemsPerBunch))}</td>
                  <td>${utils.esc(item.buncher || "-")}</td>
                  <td>${utils.esc(item.warehouse)}</td>
                  <td>${utils.esc(item.supplier)}</td>
                  <td>${utils.esc(item.block)}</td>
                  <td>${utils.esc(utils.number(item.ageDays))}</td>
                  <td>${utils.esc(item.category)}</td>
                  <td>${item.assignedOrderId ? `<strong>${utils.esc(item.assignedOrderId)}</strong><br><small>Caja ${utils.esc(item.assignedBoxNumber || "-")} · ${utils.esc(item.assignedAt || "-")}</small>` : "Sin asignar"}</td>
                  <td><span class="status-badge ${utils.badgeClass(item.state)}">${utils.esc(item.state)}</span></td>
                  <td>
                    ${item.assignedOrderId || item.state === "ASIGNADO_CAJA"
                      ? `<span class="status-badge partial">Bloqueado por caja</span>`
                      : `<div class="table-actions-inline"><button class="row-action-button" data-ops-action="inventory-state" data-id="${utils.esc(item.inventoryId)}" data-status="DISPONIBLE">Disponible</button><button class="row-action-button" data-ops-action="inventory-state" data-id="${utils.esc(item.inventoryId)}" data-status="OBSERVADO">Observar</button></div>`}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">PUENTE PARTE 1 POSCOSECHA</p>
            <h3>Adapter preparado para inventario real futuro</h3>
          </div>
          <span class="status-badge partial">${utils.esc(adapterStatus.status || "PENDIENTE_INTEGRACION_REAL")}</span>
        </div>
        <div class="placeholder-grid">
          <article class="panel-card subtle-card">
            <div class="info-stack">
              <div class="info-row"><strong>Estado integracion</strong><span>${utils.esc(adapterStatus.status || "PENDIENTE_INTEGRACION_REAL")}</span></div>
              <div class="info-row"><strong>Modo actual</strong><span>${utils.esc(adapterStatus.mode || "ADAPTADOR_DEMO")}</span></div>
              <div class="info-row"><strong>Fuente futura</strong><span>${utils.esc(adapterStatus.source || "Parte 1 POSCOSECHA")}</span></div>
              <div class="info-row"><strong>App.js Parte 1 importado</strong><span>${adapterStatus.appjs_imported ? "Si" : "No"}</span></div>
              <div class="info-row"><strong>Supabase real</strong><span>${adapterStatus.supabase_connection ? "Conectado" : "No conectado"}</span></div>
              <div class="info-row"><strong>Conexion real</strong><span>${adapterStatus.real_connection ? "Activa" : "Pendiente"}</span></div>
            </div>
          </article>
          <article class="panel-card subtle-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">CONTRATOS PREPARADOS</p>
                <h3>Puente operativo</h3>
              </div>
            </div>
            <ul class="checklist-list">
              <li><code>operationalInventoryContract</code></li>
              <li><code>availabilityContract</code></li>
              <li><code>reservationContract</code></li>
              <li><code>operationalConsumptionContract</code></li>
            </ul>
            <p class="panel-note">El adapter no lee Parte 1 real todavia. Solo deja listos mapeos, validaciones y payload demo.</p>
          </article>
          <article class="panel-card subtle-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">PAYLOAD DEMO</p>
                <h3>Validacion y mapeo</h3>
              </div>
              <span class="status-badge ${adapterValidation.valid ? "ready" : "partial"}">${adapterValidation.valid ? "VALIDO" : "REVISAR"}</span>
            </div>
            <div class="info-stack">
              <div class="info-row"><strong>Fila cruda</strong><span>${utils.esc(adapterSampleRaw?.id_lote || "-")}</span></div>
              <div class="info-row"><strong>Variedad</strong><span>${utils.esc(adapterMapped?.variedad || "-")}</span></div>
              <div class="info-row"><strong>Ramos disponibles</strong><span>${utils.esc(utils.number(adapterMapped?.ramos_disponibles || 0))}</span></div>
              <div class="info-row"><strong>Estado mapeado</strong><span>${utils.esc(adapterMapped?.estado || "-")}</span></div>
            </div>
            <ul class="checklist-list">
              ${(adapterValidation.errors?.length
                ? adapterValidation.errors.map(item => `<li>${utils.esc(item)}</li>`).join("")
                : `<li>Sin errores criticos en el payload demo.</li>`)}
              ${(adapterValidation.warnings?.length
                ? adapterValidation.warnings.map(item => `<li>${utils.esc(item)}</li>`).join("")
                : "")}
            </ul>
          </article>
        </div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-ops-action="parte1-adapter-status">Ver estado adaptador</button>
          <button class="secondary-button" data-ops-action="parte1-adapter-validate">Validar payload demo</button>
          <button class="secondary-button" data-ops-action="parte1-adapter-map-inventory">Simular mapeo inventario Parte 1</button>
          <button class="secondary-button" data-ops-action="parte1-adapter-warnings">Ver advertencias integracion</button>
        </div>
        <p class="panel-note">Pendiente conexion real. No se leen archivos externos, no se importa <code>app.js</code> de Parte 1 y no se toca inventario real.</p>
        ${adapterWarnings.length ? `
          <ul class="checklist-list">
            ${adapterWarnings.map(item => `<li>${utils.esc(item)}</li>`).join("")}
          </ul>
        ` : ""}
      </section>
      <section class="hero-banner">
        <div>
          <strong>Consumo demo por despacho</strong>
          <span>Consumo demo. No descuenta inventario real de rosas.</span>
        </div>
        <button class="secondary-button" data-route-link="operations-dispatch">Abrir despacho operativo</button>
      </section>
      ${utils.renderSummaryCards([
        { label: "Ramos disponibles demo", value: utils.number(consumptionSummary.availableBunches || 0), help: "Saldo visual desde disponibilidad demo" },
        { label: "Ramos reservados demo", value: utils.number(consumptionSummary.reservedBunches || 0), help: "Reservas activas antes del despacho" },
        { label: "Ramos consumidos demo", value: utils.number(consumptionSummary.consumedBunches || 0), help: "Consumo simulado por despacho" },
        { label: "Tallos consumidos demo", value: utils.number(consumptionSummary.consumedStems || 0), help: "No afecta inventario real" },
        { label: "Consumos simulados", value: utils.number(consumptionSummary.simulatedCount || 0), help: "Filas SIMULADO" },
        { label: "Consumos revertidos demo", value: utils.number(consumptionSummary.revertedCount || 0), help: "Filas REVERTIDO_DEMO" }
      ])}
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CONSUMOS DEMO</p>
            <h3>Rosas consumidas por despacho</h3>
          </div>
          <span class="status-badge partial">${utils.esc(utils.number(consumptionRows.length))} movimiento(s)</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>consumo_id</th>
                <th>Pedido</th>
                <th>Despacho</th>
                <th>Variedad</th>
                <th>Longitud</th>
                <th>Ramos consumidos</th>
                <th>Tallos consumidos</th>
                <th>Bodega</th>
                <th>Proveedor / bloque</th>
                <th>Estado consumo</th>
                <th>Fecha/hora</th>
                <th>Observacion</th>
              </tr>
            </thead>
            <tbody>
              ${consumptionRows.map(item => `
                <tr>
                  <td>${utils.esc(item.consumption_id || "-")}</td>
                  <td>${utils.esc(item.numero_pedido || item.pedido_id || "-")}</td>
                  <td>${utils.esc(item.dispatch_id || "-")}</td>
                  <td>${utils.esc(item.variedad || "-")}</td>
                  <td>${utils.esc(item.longitud || "-")} cm</td>
                  <td>${utils.esc(utils.number(item.ramos_consumidos_demo || 0))}</td>
                  <td>${utils.esc(utils.number(item.tallos_consumidos_demo || 0))}</td>
                  <td>${utils.esc(item.bodega || "-")}</td>
                  <td>${utils.esc(`${item.proveedor || "-"} / ${item.bloque || "-"}`)}</td>
                  <td><span class="status-badge ${utils.badgeClass(item.estado_consumo)}">${utils.esc(item.estado_consumo || "-")}</span></td>
                  <td>${utils.esc(item.fecha_hora ? String(item.fecha_hora).replace("T", " ").slice(0, 16) : "-")}</td>
                  <td>${utils.esc(item.observacion || item.motivo || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="12">Sin consumos demo registrados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">KARDEX OPERATIVO DEMO</p>
            <h3>Movimientos visuales por consumo y reverso</h3>
          </div>
          <span class="status-badge partial">${utils.esc(utils.number(filteredKardexRows.length))} fila(s)</span>
        </div>
        <p class="panel-note">Kardex operativo demo. No corresponde al inventario real ni contabilidad.</p>
        <div class="compact-form-grid commercial-form-grid">
          <label class="compact-field">
            <span>Pedido</span>
            <select data-ops-ui-field="kardexFilterPedido">
              <option value="">Todos</option>
              ${kardexPedidos.map(item => `<option value="${utils.esc(item)}" ${String(ui.kardexFilterPedido || "") === String(item) ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Variedad</span>
            <select data-ops-ui-field="kardexFilterVariedad">
              <option value="">Todas</option>
              ${kardexVariedades.map(item => `<option value="${utils.esc(item)}" ${String(ui.kardexFilterVariedad || "") === String(item) ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Longitud</span>
            <select data-ops-ui-field="kardexFilterLongitud">
              <option value="">Todas</option>
              ${kardexLongitudes.map(item => `<option value="${utils.esc(item)}" ${String(ui.kardexFilterLongitud || "") === String(item) ? "selected" : ""}>${utils.esc(item)} cm</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Tipo movimiento</span>
            <select data-ops-ui-field="kardexFilterMovimiento">
              <option value="">Todos</option>
              ${kardexMovimientos.map(item => `<option value="${utils.esc(item)}" ${String(ui.kardexFilterMovimiento || "") === String(item) ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo movimiento</th>
                <th>Pedido</th>
                <th>Variedad</th>
                <th>Longitud</th>
                <th>Ramos</th>
                <th>Tallos</th>
                <th>Bodega</th>
                <th>Saldo demo</th>
                <th>Observacion</th>
              </tr>
            </thead>
            <tbody>
              ${filteredKardexRows.map(item => `
                <tr>
                  <td>${utils.esc(item.fecha_hora ? String(item.fecha_hora).replace("T", " ").slice(0, 16) : "-")}</td>
                  <td><span class="status-badge ${utils.badgeClass(item.tipo_movimiento)}">${utils.esc(item.tipo_movimiento || "-")}</span></td>
                  <td>${utils.esc(item.pedido_id || "-")}</td>
                  <td>${utils.esc(item.variedad || "-")}</td>
                  <td>${utils.esc(item.longitud || "-")} cm</td>
                  <td>${utils.esc(utils.number(item.ramos || 0))}</td>
                  <td>${utils.esc(utils.number(item.tallos || 0))}</td>
                  <td>${utils.esc(item.bodega || "-")}</td>
                  <td>${utils.esc(`${utils.number(item.saldo_ramos_demo || 0)} ramos / ${utils.number(item.saldo_tallos_demo || 0)} tallos`)}</td>
                  <td>${utils.esc(item.observacion || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="10">Sin movimientos demo en kardex para el filtro actual.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  BlessERP.operacionesInventario = { render };
})();
