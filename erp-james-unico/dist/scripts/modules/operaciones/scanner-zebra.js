(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;
  const hidAdapter = BlessERP.operacionesHidScannerDemo;

  function renderTabs(active) {
    return `<div class="subnav-tabs">
      <button class="subnav-tab ${active === "diagnostico" ? "active" : ""}" data-ops-ui-field="scannerTechnicalTab" data-value="diagnostico">Diagnostico</button>
      <button class="subnav-tab ${active === "ingreso" ? "active" : ""}" data-ops-ui-field="scannerTechnicalTab" data-value="ingreso">Ingreso al cuarto frio</button>
      <button class="subnav-tab ${active === "bodega" ? "active" : ""}" data-ops-ui-field="scannerTechnicalTab" data-value="bodega">Bodega / armado</button>
      <button class="subnav-tab ${active === "historial" ? "active" : ""}" data-ops-ui-field="scannerTechnicalTab" data-value="historial">Historial tecnico</button>
    </div>`;
  }

  function renderLastEvent(event) {
    if (!event) return `<div class="empty-inline">Todavia no existen lecturas tecnicas.</div>`;
    return `<div class="info-stack">
      <div class="info-row"><strong>Codigo</strong><span>${utils.esc(event.codigo || event.code || "-")}</span></div>
      <div class="info-row"><strong>Tipo</strong><span>${utils.esc(event.tipo_codigo || event.type || "DESCONOCIDO")}</span></div>
      <div class="info-row"><strong>Resultado</strong><span class="status-badge ${utils.badgeClass(event.resultado || event.result)}">${utils.esc(event.resultado || event.result || "-")}</span></div>
      <div class="info-row"><strong>Observacion</strong><span>${utils.esc(event.observacion || event.observation || "-")}</span></div>
    </div>`;
  }

  function renderDiagnostic(ui, summary, lastEvent, hidStatus) {
    const draft = ui.scannerDraft;
    return `
      ${utils.renderSummaryCards([
        { label: "Conexion real", value: "NO CONECTADA", help: "Validacion mediante teclado" },
        { label: "Modo", value: hidStatus.active ? "HID DEMO ACTIVO" : "HID DEMO INACTIVO", help: "Sin WebUSB ni Bluetooth" },
        { label: "Lecturas demo", value: utils.number(summary.today || 0), help: "Eventos tecnicos del dia" },
        { label: "Errores / duplicados", value: utils.number((summary.notFound || 0) + (summary.duplicates || 0)), help: "Solo diagnostico" }
      ])}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">PRUEBA DEL LECTOR</p><h3>Entrada tipo teclado HID</h3></div><span class="status-badge ${hidStatus.active ? "authorized" : "pending"}">${utils.esc(hidStatus.active ? "Activo demo" : "Inactivo")}</span></div>
          <p class="panel-note">Enfoque el campo y escanee. El lector debe escribir el codigo y enviar Enter como un teclado.</p>
          <label class="compact-field full"><span>Campo de prueba HID</span><input type="text" data-ops-ui-field="scannerHidInput" data-ops-hid-input="true" value="${utils.esc(ui.scannerHidInput || "")}" placeholder="Escanee aqui y presione Enter"></label>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="scanner-hid-start">Activar prueba HID</button><button class="secondary-button" data-ops-action="scanner-hid-stop">Detener</button><button class="secondary-button" data-ops-action="scanner-hid-clear">Limpiar</button></div>
          <div class="info-stack"><div class="info-row"><strong>Ultimo input</strong><span>${utils.esc(hidStatus.last_input || "-")}</span></div><div class="info-row"><strong>Normalizado</strong><span>${utils.esc(hidStatus.last_normalized || "-")}</span></div><div class="info-row"><strong>Resultado</strong><span>${utils.esc(hidStatus.last_result || "-")}</span></div></div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">PRUEBA MANUAL</p><h3>Validar texto recibido</h3></div></div>
          <div class="compact-form-grid"><label class="compact-field full"><span>Codigo</span><input type="text" value="${utils.esc(draft.code || "")}" data-ops-bind="scannerDraft" data-field="code" placeholder="0000000001 o BOX-60334-001"></label><label class="compact-field full"><span>Observacion</span><input type="text" value="${utils.esc(draft.observation || "")}" data-ops-bind="scannerDraft" data-field="observation" placeholder="Prueba tecnica"></label></div>
          <div class="table-actions-inline"><button class="primary-button" data-ops-action="scan-demo">Validar codigo demo</button><button class="secondary-button" data-ops-action="scanner-clear-events">Limpiar historial</button></div>
          <h4>Ultimo resultado</h4>${renderLastEvent(lastEvent)}
        </article>
      </section>
      <section class="hero-banner"><div><strong>Uso de esta pantalla</strong><span>Solo valida que el lector entregue texto correctamente. No crea inventario, no asigna ramos a cajas y no confirma despachos.</span></div></section>`;
  }

  function renderIntake(store) {
    const inventoryCount = (store.roseInventory || []).filter(item => item.sourceType === "ESCANEO_ETIQUETA").length;
    const pendingLabels = (store.labelBatches || []).filter(item => !item.inventoryId).length;
    return `<section class="placeholder-grid">
      <article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">ESCANER 1</p><h3>Ingreso de ramos al cuarto frio</h3></div><span class="status-badge authorized">Estacion operativa</span></div><p>Lee la etiqueta numerica de 10 digitos pegada al ramo. La primera lectura valida crea el ingreso al Inventario de rosas con fecha y hora del escaneo.</p><ul class="checklist-list"><li>Recupera proveedor, bloque, variedad, longitud, tallos y embonchador desde la etiqueta.</li><li>Una etiqueta impresa por si sola no crea inventario.</li><li>Una segunda lectura del mismo codigo se rechaza como duplicada.</li></ul><button class="primary-button" data-route-link="operations-bunch-intake">Abrir estacion de ingreso de ramos</button></article>
      <article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">RESUMEN</p><h3>Estado previo al cuarto frio</h3></div></div><div class="info-stack"><div class="info-row"><strong>Ramos ingresados por escaneo</strong><span>${utils.esc(inventoryCount)}</span></div><div class="info-row"><strong>Etiquetas aun no utilizadas</strong><span>${utils.esc(pendingLabels)}</span></div><div class="info-row"><strong>Codigo esperado</strong><span>10 digitos numericos</span></div><div class="info-row"><strong>Inventario real</strong><span>No conectado</span></div></div></article>
    </section>`;
  }

  function renderWarehouse(appState) {
    const orders = BlessERP.comercialOrderFulfillment?.getWarehouseOrders?.(appState) || [];
    const pendingBoxes = orders.reduce((sum, item) => sum + Math.max(item.totalBoxes - item.completeBoxes, 0), 0);
    const pendingBunches = orders.reduce((sum, item) => sum + item.pendingBunches, 0);
    return `<section class="placeholder-grid">
      <article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">ESTACION DE ARMADO</p><h3>Pedido / caja / lectura de ramos</h3></div><span class="status-badge partial">Ingreso manual temporal</span></div><p>Solo acepta ramos que ya existen en Inventario de rosas. Cada codigo asigna fisicamente el ramo a una linea pendiente de la caja seleccionada.</p><ul class="checklist-list"><li>Valida variedad, medida y tallos por ramo contra el pedido.</li><li>Actualiza caja, inventario y disponibilidad.</li><li>El lector Zebra real sigue pendiente.</li></ul><button class="primary-button" data-route-link="operations-dispatch">Abrir Despacho operativo</button></article>
      <article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">RESUMEN</p><h3>Trabajo pendiente en Bodega</h3></div></div><div class="info-stack"><div class="info-row"><strong>Pedidos liberados</strong><span>${utils.esc(orders.length)}</span></div><div class="info-row"><strong>Cajas pendientes</strong><span>${utils.esc(pendingBoxes)}</span></div><div class="info-row"><strong>Ramos pendientes</strong><span>${utils.esc(pendingBunches)}</span></div><div class="info-row"><strong>Impresora Zebra real</strong><span>Pendiente</span></div></div></article>
    </section>`;
  }

  function renderHistory(events) {
    return `<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">HISTORIAL TECNICO</p><h3>Lecturas de prueba</h3></div><span class="status-badge partial">${utils.esc(events.length)} evento(s)</span></div><div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha/hora</th><th>Codigo</th><th>Tipo</th><th>Resultado</th><th>Modulo</th><th>Observacion</th></tr></thead><tbody>${events.map(item => `<tr><td>${utils.esc(String(item.fecha_hora || item.dateTime || "").replace("T", " ").slice(0, 16))}</td><td>${utils.esc(item.codigo || item.code || "-")}</td><td>${utils.esc(item.tipo_codigo || item.type || "-")}</td><td><span class="status-badge ${utils.badgeClass(item.resultado || item.result)}">${utils.esc(item.resultado || item.result || "-")}</span></td><td>${utils.esc(item.modulo_origen || "Scanner tecnico")}</td><td>${utils.esc(item.observacion || item.observation || "-")}</td></tr>`).join("") || `<tr><td colspan="6">Sin lecturas tecnicas registradas.</td></tr>`}</tbody></table></div><p class="panel-note">Este historial es local/demo y sirve para diagnostico. Los movimientos operativos se revisan en sus estaciones respectivas.</p></section>`;
  }

  function render(appState, route) {
    const store = stateApi.getStore(appState);
    const ui = stateApi.getUi(appState);
    const scanner = BlessERP.operacionesScannerDemo;
    const summary = scanner?.getScannerSummaryDemo ? scanner.getScannerSummaryDemo(appState) : utils.buildScannerSummary(store);
    const events = scanner?.getScannerEventsDemo ? scanner.getScannerEventsDemo(appState) : (store.scannerEvents || []);
    const lastEvent = summary.lastEvent || events[0] || null;
    const hidStatus = hidAdapter?.getHidScannerStatusDemo ? hidAdapter.getHidScannerStatusDemo() : { mode: "TECLADO_HID_DEMO", active: false, last_input: "", last_normalized: "", last_result: "" };
    const active = ui.scannerTechnicalTab || "diagnostico";
    let content = renderDiagnostic(ui, summary, lastEvent, hidStatus);
    if (active === "ingreso") content = renderIntake(store);
    if (active === "bodega") content = renderWarehouse(appState);
    if (active === "historial") content = renderHistory(events);

    return `${utils.renderPageHeader(route, "Validacion tecnica de lectores y acceso a las dos estaciones de escaneo", "partial")}${utils.renderTabs(route)}${utils.renderNotice(ui)}<section class="hero-banner"><div><strong>Scanner / Zebra tecnico</strong><span>Esta pantalla valida el lector. El ingreso al cuarto frio y el armado de cajas se ejecutan en estaciones separadas.</span></div><span class="status-badge pending">Sin hardware real</span></section>${renderTabs(active)}${content}`;
  }

  BlessERP.operacionesScanner = { render };
})();
