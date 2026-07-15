(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc } = BlessERP.utils;

  const STEP_STATUS = {
    pending: { label: "Pendiente", tone: "pending" },
    reviewed: { label: "Revisado", tone: "authorized" },
    observed: { label: "Observado", tone: "partial" }
  };

  const PRIORITIES = ["baja", "media", "alta", "critica"];

  function createSteps() {
    return [
      {
        id: "step-1",
        title: "PASO 1: Revisar diagnostico",
        module: "Core del sistema",
        action: "Abrir Core -> Diagnostico / Estado del ERP.",
        routeId: "core-diagnostics",
        routeLabel: "Core -> Diagnostico / Estado del ERP",
        expected: [
          "Supabase desactivado",
          "Servicios reales pendientes",
          "ERP en modo local/demo"
        ]
      },
      {
        id: "step-2",
        title: "PASO 2: Revisar Panel Comercial",
        module: "Comercial / Exportaciones",
        action: "Abrir Comercial / Exportaciones -> Panel comercial.",
        routeId: "commercial-panel",
        routeLabel: "Comercial / Exportaciones -> Panel comercial",
        expected: [
          "Pedidos demo visibles",
          "Documentos demo disponibles",
          "Preview contable demo"
        ]
      },
      {
        id: "step-3",
        title: "PASO 3: Revisar Pedido Maestro",
        module: "Comercial / Exportaciones",
        action: "Abrir Pedido Maestro y revisar cliente/marca, logistica, DAE y cajas.",
        routeId: "commercial-order-master",
        routeLabel: "Comercial / Exportaciones -> Pedido Maestro",
        expected: [
          "Cliente / marca visible",
          "Logistica visible",
          "DAE visible",
          "Cajas y variedades visibles"
        ]
      },
      {
        id: "step-4",
    title: "PASO 4: Revisar Disponibilidad para venta",
        module: "Comercial / Exportaciones",
    action: "Ir a Disponibilidad y comparar inventario, pedidos activos y ramos disponibles para venta.",
        routeId: "commercial-availability-reservations",
    routeLabel: "Comercial / Exportaciones -> Disponibilidad",
        expected: [
          "Stock fisico visible",
          "Demanda de ordenes liberadas visible",
          "No se apartan ni descuentan ramos antes del escaneo en Bodega"
        ]
      },
      {
        id: "step-5",
        title: "PASO 5: Revisar documentos comerciales",
        module: "Comercial / Exportaciones",
        action: "Revisar Invoice / Packing carguera, Factura Comercial Cliente, HR, MP y Etiquetas.",
        routeId: "commercial-print-center",
        routeLabel: "Comercial / Exportaciones -> Centro de impresion",
        expected: [
          "Documentos demo/preliminares visibles",
          "No factura SRI",
          "No XML real"
        ]
      },
      {
        id: "step-6",
        title: "PASO 6: Probar Despacho demo",
        module: "Comercial / Exportaciones / Operaciones",
        action: "Abrir Pedido Maestro -> Despacho, preparar despacho demo, marcar listo y confirmar despacho demo.",
        routeId: "operations-dispatch",
        routeLabel: "Operaciones / Poscosecha -> Despacho operativo",
        expected: [
          "Estado DESPACHADO_DEMO visual",
          "Despacho operativo refleja estado demo",
          "No descuenta inventario real"
        ]
      },
      {
        id: "step-7",
        title: "PASO 7: Probar Scanner / Zebra demo",
        module: "Operaciones / Poscosecha",
        action: "Ir a Scanner / Zebra y escanear BOX-60334-001, BUNCH-EXP-50-001, PED-60334 y DSP-60334.",
        routeId: "operations-scanner",
        routeLabel: "Operaciones / Poscosecha -> Scanner / Zebra",
        expected: [
          "Codigos leidos demo",
          "Duplicados detectados si se repiten",
          "No hay lector Zebra real conectado"
        ]
      },
      {
        id: "step-8",
        title: "PASO 8: Probar Consumo demo / Kardex demo",
        module: "Operaciones / Poscosecha",
        action: "Ir a Despacho operativo, simular consumo demo y revisar Inventario de rosas / Kardex operativo demo.",
        routeId: "operations-roses-inventory",
        routeLabel: "Operaciones / Poscosecha -> Inventario de rosas",
        expected: [
          "Consumo demo registrado",
          "Kardex demo visible",
          "No inventario real afectado"
        ]
      },
      {
        id: "step-9",
        title: "PASO 9: Revisar Contabilidad local/demo",
        module: "Administracion / Contabilidad",
        action: "Abrir Libro Diario, Mayor General y revisar Preview contable comercial.",
        routeId: "accounting-journal",
        routeLabel: "Administracion / Contabilidad -> Libro diario",
        expected: [
          "Comercial no genera asiento real",
          "Preview contable sigue como preview",
          "Libro Diario real/local no cambia por factura comercial demo"
        ]
      },
      {
        id: "step-10",
        title: "PASO 10: Confirmacion final",
        module: "Core del sistema",
        action: "Confirmar que no se conecto nada real y que el ERP sigue en modo local/demo.",
        routeId: "core-diagnostics",
        routeLabel: "Core -> Diagnostico / Estado del ERP",
        expected: [
          "Supabase no conectado",
          "SRI no activado",
          "Scanner real no conectado",
          "Inventario real no descontado",
          "Contabilidad real de ventas no generada",
          "ERP sigue modo local/demo"
        ]
      }
    ].map(step => ({
      ...step,
      status: "pending",
      observation: "",
      finding: "",
      priority: "media"
    }));
  }

  const guidedState = {
    started: false,
    steps: createSteps()
  };

  function getStep(stepId) {
    return guidedState.steps.find(step => step.id === stepId) || null;
  }

  function summary() {
    const total = guidedState.steps.length;
    const reviewed = guidedState.steps.filter(step => step.status === "reviewed").length;
    const observed = guidedState.steps.filter(step => step.status === "observed").length;
    const pending = total - reviewed - observed;
    return {
      total,
      reviewed,
      observed,
      pending
    };
  }

  function renderSummaryCards() {
    const stats = summary();
    return `
      <section class="summary-grid">
        <article class="summary-card"><span>Pasos totales</span><strong>${esc(String(stats.total))}</strong><small>Recorrido completo</small></article>
        <article class="summary-card"><span>Pasos revisados</span><strong>${esc(String(stats.reviewed))}</strong><small>Marcados como revisado</small></article>
        <article class="summary-card"><span>Pasos observados</span><strong>${esc(String(stats.observed))}</strong><small>Con hallazgo manual</small></article>
        <article class="summary-card"><span>Pendientes</span><strong>${esc(String(stats.pending))}</strong><small>Sin confirmar por usuario</small></article>
        <article class="summary-card"><span>Servicios reales conectados</span><strong>0</strong><small>Debe mantenerse en cero</small></article>
        <article class="summary-card"><span>Modo actual</span><strong>demo/local</strong><small>Sin Supabase, SRI ni inventario real</small></article>
      </section>
    `;
  }

  function renderStep(step, index) {
    const statusInfo = STEP_STATUS[step.status] || STEP_STATUS.pending;
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">${esc(step.module.toUpperCase())}</p>
            <h3>${esc(step.title)}</h3>
          </div>
          <span class="status-badge ${esc(statusInfo.tone)}">${esc(statusInfo.label)}</span>
        </div>
        <div class="info-stack">
          <div class="info-row"><strong>Modulo</strong><span>${esc(step.module)}</span></div>
          <div class="info-row"><strong>Accion sugerida</strong><span>${esc(step.action)}</span></div>
          <div class="info-row"><strong>Ruta sugerida</strong><span>${esc(step.routeLabel)}</span></div>
        </div>
        <div class="panel-note"><strong>Resultado esperado:</strong></div>
        <ul class="checklist-list">
          ${step.expected.map(item => `<li>${esc(item)}</li>`).join("")}
        </ul>
        <div class="table-actions-inline">
          <button class="secondary-button" data-route-link="${esc(step.routeId)}">Ir a modulo</button>
          <button class="secondary-button" data-guided-action="reviewed" data-step-id="${esc(step.id)}">Marcar revisado</button>
          <button class="secondary-button" data-guided-action="observed" data-step-id="${esc(step.id)}">Marcar observado</button>
          <button class="secondary-button" data-guided-action="pending" data-step-id="${esc(step.id)}">Marcar pendiente</button>
        </div>
        <div class="ops-form-grid">
          <label class="compact-inline-field ops-form-span-2">
            <span>Observacion del usuario</span>
            <textarea rows="2" data-guided-field="observation" data-step-id="${esc(step.id)}" placeholder="Observacion manual del paso ${index + 1}">${esc(step.observation || "")}</textarea>
          </label>
          <label class="compact-inline-field ops-form-span-2">
            <span>Hallazgo</span>
            <input type="text" value="${esc(step.finding || "")}" data-guided-field="finding" data-step-id="${esc(step.id)}" placeholder="Detalle del hallazgo o confirmacion manual">
          </label>
          <label class="compact-inline-field">
            <span>Prioridad</span>
            <select data-guided-field="priority" data-step-id="${esc(step.id)}">
              ${PRIORITIES.map(priority => `<option value="${esc(priority)}" ${step.priority === priority ? "selected" : ""}>${esc(priority)}</option>`).join("")}
            </select>
          </label>
        </div>
      </article>
    `;
  }

  function render(appState, route) {
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">CORE DEL SISTEMA</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Guia demo activa</span>
        </div>
      </section>
      <div class="subnav-tabs">
        <button class="subnav-tab" data-route-link="dashboard-home">Panel general</button>
        <button class="subnav-tab" data-route-link="core-diagnostics">Diagnostico / Estado del ERP</button>
        <button class="subnav-tab active" data-route-link="core-guided-demo">Prueba guiada demo</button>
      </div>
      <section class="hero-banner">
        <div>
          <strong>Prueba guiada demo/local del ERP unico</strong>
          <span>Esta prueba recorre el ERP en modo demo/local. No conecta Supabase, no genera SRI, no descuenta inventario real y no genera contabilidad real.</span>
        </div>
        <button class="secondary-button" data-route-link="core-diagnostics">Ver diagnostico</button>
      </section>
      ${renderSummaryCards()}
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ACCIONES PRINCIPALES</p>
            <h3>Control de la prueba guiada</h3>
          </div>
          <span class="status-badge ${guidedState.started ? "authorized" : "pending"}">${esc(guidedState.started ? "Iniciada" : "Pendiente")}</span>
        </div>
        <div class="table-actions-inline">
          <button class="primary-button" data-guided-control="start">Iniciar prueba demo</button>
          <button class="secondary-button" data-guided-control="pending-all">Marcar todo como pendiente</button>
          <button class="secondary-button" data-guided-control="reset">Reiniciar prueba</button>
          <button class="secondary-button" data-guided-control="export">Exportar reporte demo</button>
          <button class="secondary-button" data-route-link="core-diagnostics">Ver diagnostico</button>
          <button class="secondary-button" data-guided-control="checklist-phase5a">Ver checklist funcional FASE 5A</button>
        </div>
        <ul class="checklist-list">
          <li>La prueba es manual y guiada; no automatiza el flujo.</li>
          <li>Los estados del paso se guardan solo en memoria/local de esta sesion.</li>
          <li>Los hallazgos del usuario ayudan a preparar la siguiente fase de correccion.</li>
        </ul>
      </section>
      <section class="placeholder-grid">
        ${guidedState.steps.map((step, index) => renderStep(step, index)).join("")}
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CONFIRMACION DE NO IMPACTO REAL</p>
            <h3>Lo que no debe ocurrir durante esta prueba</h3>
          </div>
        </div>
        <ul class="checklist-list">
          <li>Supabase no debe conectarse.</li>
          <li>SRI no debe activarse.</li>
          <li>Scanner real no debe conectarse.</li>
          <li>Inventario real de rosas no debe descontarse.</li>
          <li>Contabilidad real de ventas no debe generarse.</li>
          <li>Los servicios demo/locales deben seguir siendo la fuente activa.</li>
        </ul>
      </section>
    `;
  }

  function rerender() {
    BlessERP.layout.renderPage();
  }

  function setAllStatus(status) {
    guidedState.steps.forEach(step => {
      step.status = status;
    });
  }

  function resetState() {
    guidedState.started = false;
    guidedState.steps = createSteps();
  }

  function bind(container, appState) {
    container.querySelectorAll("[data-guided-control]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.guidedControl;
      if (action === "start") {
        guidedState.started = true;
        BlessERP.layout.toast("Prueba guiada demo iniciada.");
        rerender();
        return;
      }
      if (action === "pending-all") {
        setAllStatus("pending");
        BlessERP.layout.toast("Todos los pasos vuelven a pendiente.");
        rerender();
        return;
      }
      if (action === "reset") {
        resetState();
        BlessERP.layout.toast("Prueba guiada demo reiniciada.");
        rerender();
        return;
      }
      if (action === "export") {
        BlessERP.layout.toast("Exportacion de reporte pendiente fase futura.");
        return;
      }
      if (action === "checklist-phase5a") {
        BlessERP.layout.toast("Revise docs/FASE_5A_CHECKLIST_FUNCIONAL_GENERAL.md como base de la prueba manual.");
      }
    }));

    container.querySelectorAll("[data-guided-action]").forEach(button => button.addEventListener("click", () => {
      const step = getStep(button.dataset.stepId);
      if (!step) return;
      guidedState.started = true;
      step.status = button.dataset.guidedAction;
      BlessERP.layout.toast(`${step.title} marcado como ${STEP_STATUS[step.status]?.label || "Pendiente"}.`);
      rerender();
    }));

    container.querySelectorAll("[data-guided-field]").forEach(field => {
      const eventName = field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(eventName, event => {
        const step = getStep(event.target.dataset.stepId);
        if (!step) return;
        const fieldName = event.target.dataset.guidedField;
        step[fieldName] = event.target.value;
      });
    });
  }

  BlessERP.coreGuidedDemo = {
    bind,
    render,
    resetState
  };
})();
