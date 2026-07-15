(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { money, number, esc } = BlessERP.utils;

  function render(container, appState) {
    const sales = appState.db.sales || [];
    const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const pending = sales.filter(sale => ["Pendiente", "Borrador"].includes(sale.status)).length;
    const authorized = sales.filter(sale => sale.status === "Autorizado").length;
    const countries = new Set(sales.map(sale => sale.country).filter(Boolean)).size;

    const topClients = Object.entries(
      sales.reduce((acc, sale) => {
        acc[sale.client] = (acc[sale.client] || 0) + Number(sale.total || 0);
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 4);

    container.innerHTML = `
      <section class="section-head">
        <div>
          <h2>Panel general</h2>
          <p>Vista limpia y modular para crecer por etapas sin volver al monolito anterior.</p>
        </div>
      </section>
      <section class="kpi-grid">
        <article class="glass-card kpi-card"><span>Total ventas</span><strong>${money(total)}</strong><small>${sales.length} documentos demo</small></article>
        <article class="glass-card kpi-card"><span>Pendientes</span><strong>${number(pending)}</strong><small>Borradores y documentos por revisar</small></article>
        <article class="glass-card kpi-card"><span>Autorizadas</span><strong>${number(authorized)}</strong><small>Documentos ya consolidados</small></article>
        <article class="glass-card kpi-card"><span>Paises</span><strong>${number(countries)}</strong><small>Mercados activos en esta demo</small></article>
      </section>
      <section class="two-column">
        <article class="glass-card card-block">
          <h3>Por que esta V2 si conviene</h3>
          <p>Aqui la navegacion, los formularios y los modulos viven separados. El detalle de una venta no se mezcla con la lista, y cambiar de modulo ya no obliga a redibujar todo.</p>
          <div class="module-roadmap">
            <div class="roadmap-item"><strong>Lista separada</strong><span>Las pantallas de modulo quedan aparte del formulario detalle.</span></div>
            <div class="roadmap-item"><strong>Detalle seguro</strong><span>Si hay cambios sin guardar, avisa antes de salir.</span></div>
            <div class="roadmap-item"><strong>Render parcial</strong><span>Solo se actualiza el modulo abierto.</span></div>
            <div class="roadmap-item"><strong>Escalabilidad</strong><span>Se podran mover ventas, compras y contabilidad a archivos propios.</span></div>
          </div>
        </article>
        <article class="glass-card card-block">
          <h3>Clientes principales</h3>
          <p>Resumen simple para validar la base comercial y el nuevo diseño.</p>
          ${topClients.length ? `
            <div class="module-roadmap">
              ${topClients.map(([client, value]) => `
                <div class="roadmap-item">
                  <strong>${esc(client)}</strong>
                  <span>${money(value)}</span>
                </div>
              `).join("")}
            </div>
          ` : `<div class="empty-state">Todavia no hay ventas para el dashboard.</div>`}
        </article>
      </section>
    `;
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.dashboard = { render };
})();
