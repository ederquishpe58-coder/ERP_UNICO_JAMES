(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc } = BlessERP.utils;

  const definitions = {
    purchases: {
      title: "Compras",
      text: "Aqui ira el modulo nuevo de compras, separado de ventas y con formulario amplio por pestañas."
    },
    accounting: {
      title: "Contabilidad",
      text: "Aqui ira diario, mayor, plan de cuentas y asientos con archivos independientes."
    },
    exports: {
      title: "Exportaciones",
      text: "Aqui ira la capa comercial exportadora: consignees, marcas, pedidos, embarques y coordinacion."
    },
    inventory: {
      title: "Inventario",
      text: "Aqui se separaran inventario de insumos, inventario de flor y disponibilidad/preventa."
    },
    reports: {
      title: "Reportes",
      text: "Aqui iran tableros y reportes por ventas, costos, exportacion, cartera y resultados."
    },
    settings: {
      title: "Configuracion",
      text: "Panel tecnico de parametros, apariencia, datos demo y futuras integraciones."
    }
  };

  function renderPlaceholder(container, key, appState) {
    const item = definitions[key];
    if (!item) return;
    container.innerHTML = `
      <section class="section-head">
        <div>
          <h2>${esc(item.title)}</h2>
          <p>${esc(item.text)}</p>
        </div>
      </section>
      <section class="settings-grid">
        <article class="glass-card card-block">
          <h3>Base nueva</h3>
          <p>Este modulo todavia no arrastra codigo viejo. La idea es construirlo por archivos nuevos, con render parcial y formularios separados.</p>
          <div class="module-roadmap">
            <div class="roadmap-item"><strong>Render parcial</strong><span>Solo carga cuando se abre.</span></div>
            <div class="roadmap-item"><strong>Formulario aparte</strong><span>No mezcla lista y edicion.</span></div>
            <div class="roadmap-item"><strong>Datos demo</strong><span>Separados del sistema anterior.</span></div>
            <div class="roadmap-item"><strong>Escalable</strong><span>Listo para futuros submodulos.</span></div>
          </div>
        </article>
        <article class="glass-card card-block">
          <h3>Siguiente fase sugerida</h3>
          <p>Este modulo se puede construir despues de ventas, usando la misma arquitectura de detalle y guardado seguro.</p>
          ${key === "settings" ? `
            <div class="settings-actions">
              <button class="primary-button" data-reset-demo>Regenerar datos demo</button>
              <button class="ghost-button" data-show-storage>Ver clave local</button>
            </div>
            <p id="settings-feedback"></p>
          ` : `
            <div class="empty-state">Cuando quieras, seguimos con ${esc(item.title.toLowerCase())} sobre esta misma base.</div>
          `}
        </article>
      </section>
    `;

    if (key === "settings") {
      container.querySelector("[data-reset-demo]")?.addEventListener("click", () => {
        BlessERP.state.resetDemoData();
        BlessERP.layout.toast("Datos demo regenerados");
        BlessERP.layout.renderCurrentPage();
      });
      container.querySelector("[data-show-storage]")?.addEventListener("click", () => {
        container.querySelector("#settings-feedback").textContent = `Clave local activa: ${BlessERP.storage.STORAGE_KEY}`;
      });
    }
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.placeholders = { renderPlaceholder };
})();
