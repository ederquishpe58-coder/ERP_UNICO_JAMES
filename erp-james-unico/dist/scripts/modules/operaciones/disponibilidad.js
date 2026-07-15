(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function render(appState, route) {
    const ui = stateApi.getUi(appState);
    const rows = BlessERP.comercialOrderFulfillment?.getAvailabilityRows?.(appState) || [];
    const filtered = rows.filter(row => {
      if (ui.availabilityFilterVariety !== "TODOS" && row.variety !== ui.availabilityFilterVariety) return false;
      const lengthValue = row.anyLength ? "CUALQUIER_MEDIDA" : String(row.length);
      if (ui.availabilityFilterLength !== "TODOS" && lengthValue !== String(ui.availabilityFilterLength)) return false;
      if (ui.availabilityFilterWarehouse !== "TODOS" && !String(row.warehouses || "").includes(ui.availabilityFilterWarehouse)) return false;
      if (ui.availabilityFilterState !== "TODOS" && row.status !== ui.availabilityFilterState) return false;
      return true;
    });
    const physicalTotal = rows.filter(row => !row.openMixed && !row.anyLength).reduce((sum, row) => sum + row.physicalBunches, 0);
    const demandTotal = rows.reduce((sum, row) => sum + row.demandPendingBunches, 0);
    const totals = {
      physical: physicalTotal,
      demand: demandTotal,
      projected: Math.max(physicalTotal - demandTotal, 0),
      shortage: Math.max(demandTotal - physicalTotal, 0)
    };
    const varieties = [...new Set(rows.map(row => row.variety).filter(Boolean))].sort();
    const lengths = [...new Set(rows.map(row => row.anyLength ? "CUALQUIER_MEDIDA" : row.length).filter(Boolean))].sort((a, b) => {
      if (a === "CUALQUIER_MEDIDA") return -1;
      if (b === "CUALQUIER_MEDIDA") return 1;
      return a - b;
    });
    const warehouses = [...new Set(rows.flatMap(row => String(row.warehouses || "").split(",").map(item => item.trim())).filter(Boolean))].sort();
    const states = [...new Set(rows.map(row => row.status).filter(Boolean))].sort();

    return `
      ${utils.renderPageHeader(route, "Stock fisico frente a demanda de pedidos activos", "authorized")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(ui)}
      <section class="hero-banner">
        <div><strong>Disponibilidad operativa sin reservas</strong><span>Un ramo permanece disponible hasta validar manualmente su codigo dentro de una caja del pedido. La demanda solo permite anticipar faltantes.</span></div>
        <span class="status-badge partial">Inventario local/demo</span>
      </section>
      ${utils.renderSummaryCards([
        { label: "Stock fisico", value: utils.number(totals.physical), help: "Ramos ingresados por escaneo" },
        { label: "Demanda pendiente", value: utils.number(totals.demand), help: "Pedidos desde VALIDADO_COMERCIAL" },
        { label: "Saldo proyectado", value: utils.number(totals.projected), help: "Stock menos demanda" },
        { label: "Faltante proyectado", value: utils.number(totals.shortage), help: "No bloquea el pedido" }
      ])}
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">FILTROS</p><h3>Disponibilidad por variedad y medida</h3></div><button class="secondary-button" data-route-link="operations-warehouse">Abrir Bodega de rosas</button></div>
        <div class="compact-form-grid">
          <label class="compact-field"><span>Variedad</span><select data-ops-ui-field="availabilityFilterVariety"><option value="TODOS">Todas</option>${varieties.map(item => `<option value="${utils.esc(item)}" ${item === ui.availabilityFilterVariety ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Medida</span><select data-ops-ui-field="availabilityFilterLength"><option value="TODOS">Todas</option>${lengths.map(item => `<option value="${utils.esc(item)}" ${String(item) === String(ui.availabilityFilterLength) ? "selected" : ""}>${utils.esc(item === "CUALQUIER_MEDIDA" ? "CUALQUIER MEDIDA" : `${item} cm`)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Bodega</span><select data-ops-ui-field="availabilityFilterWarehouse"><option value="TODOS">Todas</option>${warehouses.map(item => `<option value="${utils.esc(item)}" ${item === ui.availabilityFilterWarehouse ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Estado</span><select data-ops-ui-field="availabilityFilterState"><option value="TODOS">Todos</option>${states.map(item => `<option value="${utils.esc(item)}" ${item === ui.availabilityFilterState ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">DISPONIBILIDAD</p><h3>Stock, demanda y faltantes</h3></div><span class="status-badge authorized">${utils.esc(filtered.length)} combinaciones</span></div>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Variedad</th><th>Medida</th><th>Stock fisico</th><th>Tallos/ramo</th><th>Demanda pendiente</th><th>Saldo proyectado</th><th>Faltante</th><th>Ingreso mas antiguo</th><th>Bodega</th><th>Estado</th></tr></thead><tbody>
          ${filtered.map(row => `<tr><td><strong>${utils.esc(row.variety)}</strong></td><td>${utils.esc(row.anyLength ? "CUALQUIER MEDIDA" : `${utils.number(row.length)} cm`)}</td><td>${utils.number(row.physicalBunches)}</td><td>${utils.number(row.stemsPerBunch)}</td><td>${utils.number(row.demandPendingBunches)}</td><td><strong>${utils.number(row.projectedBunches)}</strong></td><td>${utils.number(row.shortageBunches)}</td><td>${utils.esc(row.oldestAdmission || "-")}</td><td>${utils.esc(row.warehouses || "-")}</td><td><span class="status-badge ${utils.badgeClass(row.status)}">${utils.esc(row.status)}</span></td></tr>`).join("") || `<tr><td colspan="10">No existen ramos escaneados ni pedidos activos para mostrar.</td></tr>`}
        </tbody></table></div>
        <p class="panel-note">Datos demo/locales. No hay reserva de ramos, no se descuenta inventario real y no se conecta Parte 1 ni Supabase.</p>
      </section>
    `;
  }

  BlessERP.operacionesDisponibilidad = { render };
})();
