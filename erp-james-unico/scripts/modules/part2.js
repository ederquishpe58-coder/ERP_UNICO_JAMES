(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const navigation = BlessERP.navigation;
  const { esc } = BlessERP.utils;

  function groupRoutes(route) {
    return navigation.groupMap[route.groupId]?.routes || [];
  }

  function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (value.includes("bloqueado") || value.includes("futura")) return "cancelled";
    if (value.includes("pendiente") || value.includes("placeholder")) return "pending";
    if (value.includes("activa") || value.includes("activo") || value.includes("lista")) return "authorized";
    return "partial";
  }

  function routeScope(route) {
    return route.menuLabel === route.groupLabel
      ? route.menuLabel
      : `${route.menuLabel} · ${route.groupLabel}`;
  }

  function renderTabs(route) {
    const siblings = groupRoutes(route);
    return `
      <div class="subnav-tabs">
        ${siblings.map(item => `
          <button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function renderChecklist(route) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CHECKLIST</p>
            <h3>Lo que sigue en este frente</h3>
          </div>
          <span class="status-badge ${statusClass(route.status)}">${esc(route.status)}</span>
        </div>
        <ul class="checklist-list">
          ${route.checklist.map(item => `<li>${esc(item)}</li>`).join("")}
        </ul>
      </article>
    `;
  }

  function renderIntegrationContext(route) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">INTEGRACION</p>
            <h3>Contexto de origen</h3>
          </div>
        </div>
        <div class="info-stack">
          <div class="info-row"><strong>Estado</strong><span>${esc(route.status)}</span></div>
          <div class="info-row"><strong>Origen</strong><span>${esc(route.source || "Shell unico")}</span></div>
          <div class="info-row"><strong>Riesgo</strong><span>${esc(route.integrationRisk || "Pendiente de evaluacion")}</span></div>
          <div class="info-row"><strong>Accion futura</strong><span>${esc(route.futureAction || "Definir siguiente fase")}</span></div>
        </div>
      </article>
    `;
  }

  function renderNotes(route) {
    const futureNote = route.future
      ? "Este modulo queda visible para reservar su lugar en arquitectura, pero pertenece a una fase futura y no se implementa todavia."
      : "Este placeholder ya tiene lugar reservado en el shell unico, pero aun no se conecta a datos ni a la logica pesada original.";
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ALCANCE</p>
            <h3>Notas de implementacion</h3>
          </div>
        </div>
        <div class="info-stack">
          <div class="info-row"><strong>Modulo principal</strong><span>${esc(route.menuLabel)}</span></div>
          <div class="info-row"><strong>Area interna</strong><span>${esc(route.groupLabel)}</span></div>
          <div class="info-row"><strong>Base actual</strong><span>Shell visual, rutas internas y placeholders desacoplados</span></div>
          <div class="info-row"><strong>Siguiente capa</strong><span>Contratos, adapters y vistas reales por dominio</span></div>
          <div class="info-row"><strong>Datos reales</strong><span>No conectados en esta fase</span></div>
        </div>
        <p class="panel-note">${esc(futureNote)}</p>
      </article>
    `;
  }

  function renderRelated(route) {
    const siblings = groupRoutes(route).filter(item => item.id !== route.id);
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">SUBMODULOS</p>
            <h3>Navegacion del area</h3>
          </div>
        </div>
        <div class="mini-route-grid">
          ${siblings.map(item => `
            <button class="mini-route-card" data-route-link="${esc(item.id)}">
              <strong>${esc(item.label)}</strong>
              <span>${esc(item.status)}</span>
            </button>
          `).join("") || `<div class="empty-inline">No hay otros submodulos en esta area.</div>`}
        </div>
      </article>
    `;
  }

  function renderModuleCard(routeId, overrides = {}) {
    const route = navigation.routeMap[routeId];
    if (!route) return "";
    const title = overrides.title || route.label;
    const description = overrides.description || route.description;
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">${esc((route.source || "").toUpperCase())}</p>
            <h3>${esc(title)}</h3>
          </div>
          <span class="status-badge ${statusClass(route.status)}">${esc(route.status)}</span>
        </div>
        <p class="panel-note">${esc(description)}</p>
        <div class="info-stack">
          <div class="info-row"><strong>Origen</strong><span>${esc(route.source || "Shell unico")}</span></div>
          <div class="info-row"><strong>Riesgo de integracion</strong><span>${esc(route.integrationRisk || "Pendiente de evaluacion")}</span></div>
          <div class="info-row"><strong>Accion futura</strong><span>${esc(route.futureAction || "Definir siguiente fase")}</span></div>
        </div>
        <button class="secondary-button" data-route-link="${esc(route.id)}">Abrir placeholder</button>
      </article>
    `;
  }

  function renderDashboard(container, route, appState) {
    const alerts = appState.db.session?.alerts || [];
    const modules = BlessERP.moduleRegistry?.modules || [];
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">ERP JAMES UNICO</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Shell base activo</span>
        </div>
      </section>
      ${renderTabs(route)}
      <section class="hero-banner">
        <div>
          <strong>Base tecnica del ERP unico creada desde Parte 2</strong>
          <span>Contabilidad, compras, bancos, cartera, reportes e inventario administrativo siguen activos. Operaciones ya opera en modo demo visual preparado y Comercial sigue integrado en modo demo, sin mover todavia la logica pesada de Parte 1 ni Parte 3.</span>
        </div>
        <button class="secondary-button" data-route-link="core-diagnostics">Ver diagnostico del ERP</button>
      </section>
      <section class="summary-grid">
        ${modules.map(module => `
          <article class="summary-card">
            <span>${esc(module.label)}</span>
            <strong>${esc(module.statusLabel)}</strong>
            <small>${esc(module.source)}</small>
          </article>
        `).join("")}
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ALERTAS</p>
              <h3>Radar administrativo base</h3>
            </div>
          </div>
          <ul class="alert-list">
            ${alerts.map(item => `<li>${esc(item)}</li>`).join("")}
          </ul>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ACCESOS</p>
              <h3>Frentes principales del shell</h3>
            </div>
          </div>
          <div class="module-chip-grid">
            <button class="module-chip" data-route-link="operations-postharvest">Operaciones</button>
            <button class="module-chip" data-route-link="commercial-panel">Comercial</button>
            <button class="module-chip" data-route-link="accounting-chart">Contabilidad</button>
            <button class="module-chip" data-route-link="purchases-invoices">Compras</button>
            <button class="module-chip" data-route-link="inventory-summary">Inventario</button>
            <button class="module-chip" data-route-link="reports-dashboard">Reportes</button>
            <button class="module-chip" data-route-link="settings-company">Configuración</button>
          </div>
        </article>
      </section>
    `;
  }

  function renderDiagnostics(container, route) {
    const registry = BlessERP.moduleRegistry || {};
    const modules = registry.modules || [];
    const diagnostics = registry.diagnostics || { technicalSources: [], warnings: [] };
    const contracts = BlessERP.moduleContracts?.contracts || [];
    const activeModules = modules.filter(module => ["activo", "activo demo/local"].includes(module.status));
    const placeholderModules = modules.filter(module => module.status === "placeholder");
    const demoModules = modules.filter(module => module.status === "demo avanzado");
    const futureModules = modules.filter(module => module.group === "Módulos futuros" || String(module.status || "").includes("futuro"));
    const generalStatus = diagnostics.generalStatus || null;
    const operationsStatus = diagnostics.operationsStatus || null;
    const commercialStatus = diagnostics.commercialExportStatus || null;
    const accountingStatus = diagnostics.accountingStatus || null;
    const inventoryMaterialsStatus = diagnostics.inventoryMaterialsStatus || null;
    const pendingTechnicalStatus = diagnostics.pendingTechnicalStatus || null;
    const supabaseStatus = diagnostics.supabaseStatus || null;
    const repositoryStatus = diagnostics.repositoryStatus || null;
    const progressiveMigrationStatus = diagnostics.progressiveMigrationStatus || null;
    const preSupabaseAuditStatus = diagnostics.preSupabaseAuditStatus || null;
    const functionalReviewStatus = diagnostics.functionalReviewStatus || null;
    const phase5bCorrectionsStatus = diagnostics.phase5bCorrectionsStatus || null;
    const guidedDemoStatus = diagnostics.guidedDemoStatus || null;
    const supabaseRuntimeStatus = BlessERP.getSupabaseStatus ? BlessERP.getSupabaseStatus() : null;
    const repositoryReadiness = BlessERP.getRepositoryReadinessReport ? BlessERP.getRepositoryReadinessReport() : null;
    const featureFlagsReadiness = BlessERP.getFeatureFlagsReadinessReport ? BlessERP.getFeatureFlagsReadinessReport() : null;

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">CORE DEL SISTEMA</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">${esc(diagnostics.shellStatus || "Shell activo")}</span>
        </div>
      </section>
      ${renderTabs(route)}
      <section class="summary-grid">
        <article class="summary-card">
          <span>Estado del shell</span>
          <strong>${esc(diagnostics.shellStatus || "Activo")}</strong>
          <small>Cascaron unico reutilizable</small>
        </article>
        <article class="summary-card">
          <span>Modulos activos</span>
          <strong>${activeModules.length}</strong>
          <small>Base funcional disponible hoy</small>
        </article>
        <article class="summary-card">
          <span>Placeholders</span>
          <strong>${placeholderModules.length}</strong>
          <small>Esperando fase aprobada</small>
        </article>
        <article class="summary-card">
          <span>Modulos demo</span>
          <strong>${demoModules.length}</strong>
          <small>Integracion visual y funcional controlada</small>
        </article>
        <article class="summary-card">
          <span>Modulos futuros</span>
          <strong>${futureModules.length}</strong>
          <small>Reservados fuera de esta fase</small>
        </article>
      </section>
      <section class="placeholder-grid">
        ${generalStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">ESTADO GENERAL</p>
                <h3>Shell, datos y base futura</h3>
              </div>
              <span class="status-badge authorized">${esc(generalStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(generalStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        ${operationsStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">OPERACIONES / POSCOSECHA</p>
                <h3>Estado del modulo operativo</h3>
              </div>
              <span class="status-badge partial">${esc(operationsStatus.status)}</span>
            </div>
            <div class="info-stack">
              <div class="info-row"><strong>Origen</strong><span>${esc(operationsStatus.origin)}</span></div>
              <div class="info-row"><strong>Tipo</strong><span>${esc(operationsStatus.moduleType || "Demo visual preparado")}</span></div>
            </div>
            <ul class="checklist-list">
              ${(operationsStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
            ${Array.isArray(operationsStatus.contracts) ? `
              <div class="info-stack">
                <div class="info-row"><strong>Contratos</strong><span>${esc(operationsStatus.contracts.join(" · "))}</span></div>
              </div>
            ` : ""}
          </article>
        ` : ""}
        ${commercialStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
                <h3>Estado del modulo comercial</h3>
              </div>
              <span class="status-badge partial">${esc(commercialStatus.status)}</span>
            </div>
            <div class="info-stack">
               <div class="info-row"><strong>Origen</strong><span>${esc(commercialStatus.origin)}</span></div>
               <div class="info-row"><strong>Conexiones</strong><span>${esc((commercialStatus.connections || []).join(" · "))}</span></div>
             </div>
            ${Array.isArray(commercialStatus.workflow) ? `
              <div class="info-stack">
                <div class="info-row"><strong>Flujo comercial</strong><span>${esc(commercialStatus.workflow.join(" · "))}</span></div>
              </div>
            ` : ""}
            ${Array.isArray(commercialStatus.accountingPreview) ? `
              <div class="info-stack">
                <div class="info-row"><strong>Preview contable</strong><span>${esc(commercialStatus.accountingPreview.join(" · "))}</span></div>
              </div>
            ` : ""}
            ${Array.isArray(commercialStatus.printables) ? `
              <div class="info-stack">
                <div class="info-row"><strong>Documentos demo</strong><span>${esc(commercialStatus.printables.join(" · "))}</span></div>
              </div>
            ` : ""}
            ${Array.isArray(commercialStatus.warehousePackaging) ? `
              <div class="info-stack">
                <div class="info-row"><strong>Bodega / materiales</strong><span>${esc(commercialStatus.warehousePackaging.join(" · "))}</span></div>
              </div>
            ` : ""}
            ${Array.isArray(commercialStatus.dispatchStatus) ? `
              <div class="info-stack">
                <div class="info-row"><strong>Despacho / sincronizacion</strong><span>${esc(commercialStatus.dispatchStatus.join(" · "))}</span></div>
              </div>
            ` : ""}
          </article>
        ` : ""}
        ${accountingStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">ADMINISTRACION / CONTABILIDAD</p>
                <h3>Preparacion contable</h3>
              </div>
              <span class="status-badge authorized">${esc(accountingStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(accountingStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        ${inventoryMaterialsStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">INVENTARIO SUMINISTROS / EMPAQUE</p>
                <h3>Estado del inventario administrativo</h3>
              </div>
              <span class="status-badge authorized">${esc(inventoryMaterialsStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(inventoryMaterialsStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        ${pendingTechnicalStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">PENDIENTES TECNICOS</p>
                <h3>Preparacion para fase futura</h3>
              </div>
              <span class="status-badge pending">${esc(pendingTechnicalStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(pendingTechnicalStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        ${supabaseStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">SUPABASE</p>
                <h3>Arquitectura futura</h3>
              </div>
              <span class="status-badge partial">${esc(supabaseStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(supabaseStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
            ${supabaseRuntimeStatus ? `
              <div class="info-stack">
                <div class="info-row"><strong>Modo runtime</strong><span>${esc(supabaseRuntimeStatus.mode || "DISABLED_DEMO")}</span></div>
                <div class="info-row"><strong>Habilitado</strong><span>${esc(supabaseRuntimeStatus.enabled ? "Si" : "No")}</span></div>
                <div class="info-row"><strong>Configurado</strong><span>${esc(supabaseRuntimeStatus.configured ? "Si" : "No")}</span></div>
                <div class="info-row"><strong>Mensaje</strong><span>${esc(supabaseRuntimeStatus.message || "Supabase desactivado. ERP usando modo local/demo.")}</span></div>
              </div>
            ` : ""}
          </article>
        ` : ""}
        ${repositoryStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">REPOSITORIOS FUTUROS SUPABASE</p>
                <h3>Preparacion por modulo</h3>
              </div>
              <span class="status-badge partial">${esc(repositoryStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${((repositoryReadiness && repositoryReadiness.lines) || repositoryStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
            ${repositoryReadiness?.modules ? `
              <div class="info-stack">
                <div class="info-row"><strong>Core</strong><span>${esc(`${repositoryReadiness.modules.core.total} repos · ${repositoryReadiness.modules.core.activeDataSource}`)}</span></div>
                <div class="info-row"><strong>Comercial</strong><span>${esc(`${repositoryReadiness.modules.comercial.total} repos · ${repositoryReadiness.modules.comercial.activeDataSource}`)}</span></div>
                <div class="info-row"><strong>Operaciones</strong><span>${esc(`${repositoryReadiness.modules.operaciones.total} repos · ${repositoryReadiness.modules.operaciones.activeDataSource}`)}</span></div>
                <div class="info-row"><strong>Inventario materiales</strong><span>${esc(`${repositoryReadiness.modules.inventarioMateriales.total} repos · ${repositoryReadiness.modules.inventarioMateriales.activeDataSource}`)}</span></div>
                <div class="info-row"><strong>Contabilidad</strong><span>${esc(`${repositoryReadiness.modules.contabilidad.total} repos · ${repositoryReadiness.modules.contabilidad.activeDataSource}`)}</span></div>
                <div class="info-row"><strong>Total repositorios</strong><span>${esc(String(BlessERP.getRepositoryRegistryStatus?.().totalRepositories || 0))}</span></div>
              </div>
            ` : ""}
          </article>
        ` : ""}
        ${progressiveMigrationStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">MIGRACION PROGRESIVA SUPABASE</p>
                <h3>Activacion por modulo</h3>
              </div>
              <span class="status-badge partial">${esc(progressiveMigrationStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${((featureFlagsReadiness && featureFlagsReadiness.lines) || progressiveMigrationStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
            ${featureFlagsReadiness?.modules ? `
              <div class="info-stack">
                <div class="info-row"><strong>Core</strong><span>${esc(featureFlagsReadiness.modules.core.activeSource)} · ${esc(featureFlagsReadiness.modules.core.reason)}</span></div>
                <div class="info-row"><strong>Comercial catalogos</strong><span>${esc(featureFlagsReadiness.modules.commercialCatalogs.activeSource)} · ${esc(featureFlagsReadiness.modules.commercialCatalogs.reason)}</span></div>
                <div class="info-row"><strong>Pedido Maestro</strong><span>${esc(featureFlagsReadiness.modules.commercialOrders.activeSource)} · ${esc(featureFlagsReadiness.modules.commercialOrders.reason)}</span></div>
                <div class="info-row"><strong>Operaciones</strong><span>${esc(featureFlagsReadiness.modules.operations.activeSource)} · ${esc(featureFlagsReadiness.modules.operations.reason)}</span></div>
                <div class="info-row"><strong>Scanner</strong><span>${esc(featureFlagsReadiness.modules.scanner.activeSource)} · ${esc(featureFlagsReadiness.modules.scanner.reason)}</span></div>
                <div class="info-row"><strong>Inventario materiales</strong><span>${esc(featureFlagsReadiness.modules.materialInventory.activeSource)} · ${esc(featureFlagsReadiness.modules.materialInventory.reason)}</span></div>
                <div class="info-row"><strong>Contabilidad</strong><span>${esc(featureFlagsReadiness.modules.accounting.activeSource)} · ${esc(featureFlagsReadiness.modules.accounting.reason)}</span></div>
                <div class="info-row"><strong>SRI</strong><span>${esc(featureFlagsReadiness.modules.sri.activeSource)} · ${esc(featureFlagsReadiness.modules.sri.reason)}</span></div>
              </div>
            ` : ""}
          </article>
        ` : ""}
        ${preSupabaseAuditStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">AUDITORIA PRE-SUPABASE</p>
                <h3>Cierre antes de cualquier conexion real</h3>
              </div>
              <span class="status-badge partial">${esc(preSupabaseAuditStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(preSupabaseAuditStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        ${functionalReviewStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">REVISION FUNCIONAL FASE 5A</p>
                <h3>Estado demo/local del ERP</h3>
              </div>
              <span class="status-badge partial">${esc(functionalReviewStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(functionalReviewStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        ${phase5bCorrectionsStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">CORRECCIONES FASE 5B</p>
                <h3>Ajustes pequenos aplicados</h3>
              </div>
              <span class="status-badge authorized">${esc(phase5bCorrectionsStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(phase5bCorrectionsStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        ${guidedDemoStatus ? `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">PRUEBA GUIADA FASE 5C</p>
                <h3>Recorrido de usuario final demo/local</h3>
              </div>
              <span class="status-badge authorized">${esc(guidedDemoStatus.status)}</span>
            </div>
            <ul class="checklist-list">
              ${(guidedDemoStatus.lines || []).map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </article>
        ` : ""}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">BUILD</p>
              <h3>Ultimo build</h3>
            </div>
          </div>
          <p class="panel-note">${esc(diagnostics.lastBuildText || "Manual")}</p>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">FUENTE TECNICA</p>
              <h3>Estado por parte</h3>
            </div>
          </div>
          <div class="base-ready-list">
            ${diagnostics.technicalSources.map(source => `
              <div class="base-ready-item">
                <strong>${esc(source.label)}</strong>
                <span>${esc(source.status)} · ${esc(source.note)}</span>
              </div>
            `).join("")}
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ADVERTENCIAS</p>
              <h3>Reglas de esta fase</h3>
            </div>
          </div>
          <ul class="checklist-list">
            ${diagnostics.warnings.map(item => `<li>${esc(item)}</li>`).join("")}
          </ul>
        </article>
      </section>
      <section class="placeholder-grid">
        ${modules.map(module => `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">${esc(module.group.toUpperCase())}</p>
                <h3>${esc(module.name || module.label)}</h3>
              </div>
              <span class="status-badge ${statusClass(module.statusLabel)}">${esc(module.statusLabel)}</span>
            </div>
            <p class="panel-note">${esc(module.description || module.summary)}</p>
            <div class="info-stack">
              <div class="info-row"><strong>ID</strong><span>${esc(module.id)}</span></div>
              <div class="info-row"><strong>Render</strong><span>${esc(module.renderTarget)}</span></div>
              <div class="info-row"><strong>Componente</strong><span>${esc(module.componentAssigned)}</span></div>
              <div class="info-row"><strong>Dependencias</strong><span>${esc((module.dependencies || []).join(", ") || "Ninguna")}</span></div>
              <div class="info-row"><strong>Nota</strong><span>${esc(module.note)}</span></div>
              <div class="info-row"><strong>Origen</strong><span>${esc(module.source)}</span></div>
              <div class="info-row"><strong>Siguiente fase</strong><span>${esc(module.nextStep)}</span></div>
            </div>
          </article>
        `).join("")}
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CONTRATOS</p>
              <h3>Contratos internos preparados</h3>
            </div>
          </div>
          <ul class="checklist-list">
            ${contracts.map(contract => `<li>${esc(contract.name)} · ${esc(contract.status)} · ${esc(contract.implementationStatus)}</li>`).join("")}
          </ul>
        </article>
        ${contracts.map(contract => `
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">${esc(contract.origin.toUpperCase())}</p>
                <h3>${esc(contract.name)}</h3>
              </div>
              <span class="status-badge ${statusClass(contract.implementationStatus)}">${esc(contract.status)} · ${esc(contract.implementationStatus)}</span>
            </div>
            <p class="panel-note">${esc(contract.description)}</p>
            <div class="info-stack">
              <div class="info-row"><strong>Origen</strong><span>${esc(contract.origin)}</span></div>
              <div class="info-row"><strong>Destino</strong><span>${esc(contract.destination)}</span></div>
              <div class="info-row"><strong>Campos principales</strong><span>${esc(contract.primaryFields.slice(0, 4).join(", "))}...</span></div>
            </div>
          </article>
        `).join("")}
      </section>
    `;
  }

  function renderCommercialPanel(container, route) {
    if (BlessERP.modules.comercial?.render) {
      BlessERP.modules.comercial.render(container, route, BlessERP.state.state);
      return;
    }
    container.innerHTML = "";
  }

  function renderPlaceholder(container, route) {
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.menuLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge ${statusClass(route.status)}">${esc(route.status)}</span>
        </div>
      </section>
      ${renderTabs(route)}
      ${route.future ? `
        <section class="future-banner">
          <strong>Modulo reservado para fase futura</strong>
          <span>Queda visible en la arquitectura, pero no se conecta ni se desarrolla funcionalmente en esta etapa.</span>
        </section>
      ` : ""}
      <section class="placeholder-grid">
        ${renderChecklist(route)}
        ${renderIntegrationContext(route)}
        ${renderNotes(route)}
      </section>
      <section class="placeholder-grid">
        ${renderRelated(route)}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ESTADO ACTUAL</p>
              <h3>Base disponible hoy</h3>
            </div>
          </div>
          <div class="base-ready-list">
            <div class="base-ready-item"><strong>Scope</strong><span>${esc(routeScope(route))}</span></div>
            <div class="base-ready-item"><strong>Layout</strong><span>Sidebar, topbar y pagina principal ya montados</span></div>
            <div class="base-ready-item"><strong>Ruta interna</strong><span>Navegacion por estado sin router externo</span></div>
            <div class="base-ready-item"><strong>Origen</strong><span>${esc(route.source || "Shell unico")}</span></div>
            <div class="base-ready-item"><strong>Expansion futura</strong><span>${esc(route.futureAction || "Definir siguiente fase")}</span></div>
          </div>
        </article>
      </section>
    `;
  }

  function isSettingsRoute(routeId) {
    return ["settings-users", "settings-audit", "settings-sequences", "settings-cost-centers"].includes(routeId);
  }

  function isReceivablesRoute(routeId) {
    return ["portfolios-customers", "portfolios-ar", "portfolios-collections-single", "portfolios-collections-bulk"].includes(routeId);
  }

  function render(container, appState, route) {
    const routeId = String(route?.id || "");

    if (!route || routeId === "dashboard-home") {
      renderDashboard(container, route || navigation.routeMap[navigation.defaultRoute], appState);
      return;
    }
    if (routeId === "core-diagnostics") {
      renderDiagnostics(container, route);
      return;
    }
    if (routeId === "core-guided-demo") {
      container.innerHTML = BlessERP.coreGuidedDemo.render(appState, route);
      BlessERP.coreGuidedDemo.bind(container, appState);
      return;
    }
    if (routeId === "commercial-panel") {
      renderCommercialPanel(container, route);
      return;
    }
    if (routeId.startsWith("operations-")) {
      BlessERP.modules.operaciones.render(container, route, appState);
      return;
    }
    if (routeId.startsWith("commercial-")) {
      BlessERP.modules.comercial.render(container, route, appState);
      return;
    }
    if (routeId === "settings-company") {
      BlessERP.modules.part2Foundation.renderCompany(container, route, appState);
      return;
    }
    if (isSettingsRoute(routeId)) {
      BlessERP.modules.part2Settings.render(container, route, appState);
      return;
    }
    if (routeId === "accounting-chart") {
      BlessERP.modules.part2Foundation.renderChartPage(container, route, appState);
      return;
    }
    if (routeId === "accounting-journal") {
      BlessERP.modules.part2Accounting.renderJournal(container, route, appState);
      return;
    }
    if (routeId === "accounting-ledger") {
      BlessERP.modules.part2Accounting.renderLedger(container, route, appState);
      return;
    }
    if (routeId.startsWith("purchases-")) {
      BlessERP.modules.part2Purchases.render(container, route, appState);
      return;
    }
    if (routeId.startsWith("portfolios-")) {
      if (isReceivablesRoute(routeId)) {
        BlessERP.modules.part2Receivables.render(container, route, appState);
        return;
      }
      BlessERP.modules.part2Portfolios.render(container, route, appState);
      return;
    }
    if (routeId.startsWith("banks-")) {
      BlessERP.modules.part2Banks.render(container, route, appState);
      return;
    }
    if (routeId.startsWith("inventory-")) {
      BlessERP.modules.part2Inventory.render(container, route, appState);
      return;
    }
    if (routeId.startsWith("reports-")) {
      BlessERP.modules.part2Reports.render(container, route, appState);
      return;
    }
    if (routeId === "tax-ats") {
      BlessERP.modules.part2Ats.render(container, route, appState);
      return;
    }
    if (routeId.startsWith("tax-") && ["tax-parameters", "tax-retention-parameters", "tax-withholdings-received"].includes(routeId)) {
      BlessERP.modules.part2Tax.render(container, route, appState);
      return;
    }
    renderPlaceholder(container, route);
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2 = { render };
})();
