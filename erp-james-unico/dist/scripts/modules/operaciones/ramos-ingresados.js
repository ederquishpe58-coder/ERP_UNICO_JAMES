(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function render(appState) {
    const utils = BlessERP.operacionesUtils;
    const store = BlessERP.operacionesState.getStore(appState);
    const rows = (store.bunchEntries || []).filter(item => item.state === "INGRESADO_POR_ESCANEO");

    return `
      <section class="hero-banner"><div><strong>Ramos ingresados desde el escaner</strong><span>Esta vista es de consulta. El ingreso se realiza exclusivamente en la estacion Ingreso de ramos por escaner.</span></div><button class="secondary-button" data-route-link="operations-bunch-intake">Abrir estacion de ingreso</button></section>
      ${utils.renderSummaryCards([
        { label: "Ramos ingresados", value: utils.number(rows.length), help: "Primeros escaneos validos" },
        { label: "Tallos ingresados", value: utils.number(rows.reduce((sum, item) => sum + utils.parseNumber(item.stemsPerBunch), 0)), help: "Desde datos de etiqueta" },
        { label: "Sin inventario", value: utils.number(rows.filter(item => !item.inventoryId).length), help: "Debe permanecer en cero" }
      ])}
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">DETALLE DE RAMOS INGRESADOS</p><h3>Base del rendimiento de embonchadores</h3></div></div>
        <div class="compact-table-wrap"><table class="compact-table">
          <thead><tr><th>Fecha/hora</th><th>Codigo</th><th>Variedad</th><th>Longitud</th><th>Tallos</th><th>Clasificador relacionado</th><th>Embonchador</th><th>Inventario</th><th>Estado</th></tr></thead>
          <tbody>${rows.map(item => `<tr>
            <td>${utils.esc(item.registeredAt)}</td><td>${utils.esc(item.code)}</td><td>${utils.esc(item.variety)}</td><td>${utils.esc(`${utils.number(item.length)} cm`)}</td>
            <td>${utils.number(item.stemsPerBunch)}</td><td>${utils.esc(item.classifier || "NO RELACIONADO")}</td><td>${utils.esc(item.buncher)}</td><td>${utils.esc(item.inventoryId)}</td>
            <td><span class="status-badge ${utils.badgeClass(item.state)}">${utils.esc(item.state)}</span></td>
          </tr>`).join("") || `<tr><td colspan="9">Sin ramos ingresados por escaneo.</td></tr>`}</tbody>
        </table></div>
      </section>
    `;
  }

  BlessERP.operacionesRamosIngresados = { render };
})();
