(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function render(appState) {
    const utils = BlessERP.operacionesUtils;
    const stateApi = BlessERP.operacionesState;
    const store = stateApi.getStore(appState);
    const catalogs = store.catalogs || {};
    const cards = [
      ["Proveedores", catalogs.suppliers || [], "Proveedor conectado con bloque y entrega de mallas."],
      ["Bloques", catalogs.blocks || [], "Base para trazabilidad por proveedor y origen."],
      ["Clasificadores", catalogs.classifiers || [], "Medicion futura en mallas/hora."],
      ["Embonchadores", catalogs.bunchers || [], "Medicion futura en bonches/hora."],
      ["Responsables", catalogs.responsibles || [], "Seleccionados en dropdown para entrega y registro."]
    ];

    return `
      <section class="placeholder-grid">
        ${cards.map(([label, rows, detail]) => `
          <article class="panel-card subtle-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">PLAN OPERATIVO</p>
                <h3>${utils.esc(label)}</h3>
              </div>
              <span class="status-badge partial">${utils.esc(utils.number(rows.length))}</span>
            </div>
            <p class="panel-note">${utils.esc(detail)}</p>
            <div class="base-ready-list">
              ${rows.map(item => `<div class="base-ready-item"><strong>${utils.esc(item)}</strong><span>Parametro demo activo</span></div>`).join("")}
            </div>
          </article>
        `).join("")}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">REGLA DE LA FASE</p>
              <h3>Sin tocar rol de pagos todavia</h3>
            </div>
            <span class="status-badge pending">Separado</span>
          </div>
          <p class="panel-note">Esta parametrizacion deja lista la base operativa que despues alimentara conexiones futuras. En esta fase no se modifica nomina ni contabilidad.</p>
          <div class="info-stack">
            <div class="info-row"><strong>Meta clasificador</strong><span>233 mallas/dia demo</span></div>
            <div class="info-row"><strong>Meta clasificador/hora</strong><span>29.1 mallas/hora demo</span></div>
            <div class="info-row"><strong>Meta embonchador/hora</strong><span>25 bonches/hora demo</span></div>
          </div>
        </article>
      </section>
    `;
  }

  BlessERP.operacionesPlanOperativo = { render };
})();
