(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const flow = BlessERP.commercialFlowV2;
  const ZEBRA_CODE_LENGTH = 10;
  const HID_COMMIT_DELAY_MS = 75;
  const HID_INCOMPLETE_TIMEOUT_MS = 700;
  const FEEDBACK_VISIBLE_MS = 1800;
  const scanner = {
    container: null,
    appState: null,
    orderId: "",
    sellingCompanyId: "",
    buffer: "",
    bufferTimer: 0,
    commitTimer: 0,
    queue: [],
    processing: false,
    listenerMounted: false,
    contextVersion: 0,
    feedbackTimer: 0,
    feedback: null,
    lastRead: null,
    pendingScrollBox: 0,
    lastVisibleActiveBox: 0
  };

  function esc(value) {
    return BlessERP.comercialUtils?.esc?.(value) || String(value ?? "");
  }

  function upper(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dateLabel(value) {
    const [year, month, day] = String(value || "").slice(0, 10).split("-");
    return year && month && day ? `${day}/${month}/${year}` : "-";
  }

  function customerName(appState, id) {
    const row = flow.customerFor(appState, id);
    return row?.legalName || row?.commercialName || "Sin cliente";
  }

  function warehouseOrder(appState, orderId, sellingCompanyId = "") {
    if (typeof flow.findWarehouseOrder === "function") return flow.findWarehouseOrder(appState, orderId, sellingCompanyId);
    return (flow.getWarehouseOrders?.(appState) || []).find(order => String(order.id) === String(orderId)) || null;
  }

  function progressVisual(progress) {
    const total = Math.max(0, number(progress?.requiredBunches));
    const scanned = Math.max(0, number(progress?.scannedBunches));
    const percent = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;
    return `<div class="commercial-v2-tracking-progress"><strong>${scanned}/${total}</strong><span><i style="width:${percent}%"></i></span><small>${percent}%</small></div>`;
  }

  function renderList(appState) {
    const ui = flow.sessionFor(appState).coldRoom;
    const all = flow.getWarehouseOrders(appState);
    const filtered = all.filter(order => {
      if (ui.date && String(order.issuedAt).slice(0, 10) !== ui.date) return false;
      const status = upper(order.dispatchStatus) === "DISPATCHED" ? "DESPACHADO"
        : upper(order.dispatchStatus) === "READY_FOR_DISPATCH" ? "LISTO_DESPACHO"
          : flow.buildOrderFulfillment(order).status;
      return ui.status === "TODOS" || status === ui.status;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / ui.pageSize));
    ui.page = Math.min(Math.max(1, ui.page), totalPages);
    const rows = filtered.slice((ui.page - 1) * ui.pageSize, ui.page * ui.pageSize);
    return `<section class="page-header"><div><p class="section-kicker">OPERACIONES / POSCOSECHA</p><h1>Cuarto Frío</h1><p>Pedidos guardados y enviados desde Comercial. Abra uno para completar sus cajas.</p></div><div class="page-header-side"><span class="status-badge authorized">ESCÁNER ACTIVO AL ABRIR</span></div></section>
      <section class="panel-card commercial-v2-section commercial-v2-tracking-panel commercial-v2-cold-room-panel">
        <div class="commercial-v2-filters"><label>Fecha del pedido<input type="date" value="${esc(ui.date)}" data-cold-filter="date"></label><label>Estado<select data-cold-filter="status"><option value="TODOS">Todos</option><option value="PENDIENTE" ${ui.status === "PENDIENTE" ? "selected" : ""}>Pendientes</option><option value="INCOMPLETO" ${ui.status === "INCOMPLETO" ? "selected" : ""}>Incompletos</option><option value="COMPLETADO" ${ui.status === "COMPLETADO" ? "selected" : ""}>Completados</option><option value="LISTO_DESPACHO" ${ui.status === "LISTO_DESPACHO" ? "selected" : ""}>Listos para despacho</option><option value="DESPACHADO" ${ui.status === "DESPACHADO" ? "selected" : ""}>Despachados</option></select></label><button type="button" class="secondary-button" data-cold-all>Ver todas las fechas</button></div>
        <div class="table-wrap commercial-v2-tracking-table commercial-v2-cold-room-table"><table><thead><tr><th>Fecha</th><th>Pedido</th><th>Empresa</th><th>Cajas</th><th>Ramos</th><th>Faltantes</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows.map(order => { const progress = flow.buildOrderFulfillment(order); const dispatchStatus = upper(order.dispatchStatus); const visibleStatus = dispatchStatus === "DISPATCHED" ? "DESPACHADO" : dispatchStatus === "READY_FOR_DISPATCH" ? "LISTO_DESPACHO" : progress.status; return `<tr><td><strong>${dateLabel(order.issuedAt)}</strong></td><td><strong>${esc(order.number)}</strong></td><td>${esc(order.sellingCompanyName || order.sellingCompanyKey || "BLESS FLOWER")}</td><td><span class="commercial-v2-count-chip">${progress.boxes.length}</span></td><td>${progressVisual(progress)}</td><td><span class="commercial-v2-pending-chip ${progress.pendingBunches ? "has-pending" : ""}">${progress.pendingBunches}</span></td><td><span class="status-badge ${["DISPATCHED", "READY_FOR_DISPATCH"].includes(dispatchStatus) || progress.allBoxesComplete ? "authorized" : progress.scannedBunches ? "partial" : "pending"}">${visibleStatus}</span></td><td><button type="button" class="primary-button" data-cold-open="${esc(order.id)}" data-cold-seller="${esc(order.sellingCompanyId || "")}">${dispatchStatus === "DISPATCHED" ? "Ver despacho" : "Abrir escáner"}</button></td></tr>`; }).join("") || `<tr><td colspan="8"><div class="empty-state compact">No existen pedidos enviados a Cuarto Frío con estos filtros.</div></td></tr>`}</tbody></table></div>
        <div class="commercial-v2-pagination"><button class="secondary-button" data-cold-page="${ui.page - 1}" ${ui.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${ui.page} de ${totalPages} · ${filtered.length} pedido(s)</span><button class="secondary-button" data-cold-page="${ui.page + 1}" ${ui.page >= totalPages ? "disabled" : ""}>Siguiente</button></div>
      </section>`;
  }

  function renderBox(box, activeBoxNumber, order) {
    const isCurrent = !box.automaticComplete && Number(box.boxNumber) === Number(activeBoxNumber);
    const status = box.automaticComplete ? "COMPLETA" : (isCurrent ? "EN LLENADO" : box.status);
    const scans = box.lines.flatMap(line => line.scans || []).sort((left, right) => String(left.packedAt || left.scannedAt || "").localeCompare(String(right.packedAt || right.scannedAt || "")));
    const lastScan = scans[scans.length - 1] || null;
    const boxStatus = upper(box.boxStatus);
    const closed = boxStatus === "CLOSED";
    const immutable = ["READY_FOR_DISPATCH", "DISPATCHED"].includes(boxStatus);
    const sharedSeller = Boolean(order?.sellingCompanyId && order?.inventoryPoolCompanyId
      && String(order.sellingCompanyId) !== String(order.inventoryPoolCompanyId));
    const visibleStatus = boxStatus === "READY_FOR_DISPATCH" ? "LISTA PARA SALIDA" : boxStatus === "DISPATCHED" ? "DESPACHADA" : closed ? "CERRADA" : status;
    const closedAction = sharedSeller && lastScan
      ? `<button type="button" class="danger-button" data-cold-box-unassign="${esc(lastScan.labelCode || lastScan.code)}">Desasignar último</button>`
      : `<button type="button" class="secondary-button" data-cold-box-reopen="${box.boxNumber}">Reabrir</button>`;
    return `<article class="commercial-v2-cold-box ${box.automaticComplete ? "is-complete" : ""} ${isCurrent ? "is-current" : ""}" data-cold-box-card="${box.boxNumber}"><header><div><span>Caja</span><strong>${box.boxNumber}</strong><small>${esc(box.boxCode || box.boxType)}</small></div><span class="status-badge ${box.automaticComplete || immutable ? "authorized" : box.scannedBunches || isCurrent ? "partial" : "pending"}">${visibleStatus}</span></header><div class="commercial-v2-cold-lines">${box.lines.map(line => `<div><strong>${esc(line.variety)}</strong><span>${line.length} CM</span><span>CALIDAD: ${esc(BlessERP.flowerQuality?.label?.(line.quality) || "SIN CALIDAD")}</span><span>${line.scannedBunches}/${line.requiredBunches}</span><small>${line.pendingBunches ? `${line.pendingBunches} falta(n)` : "Completo"}</small></div>`).join("")}</div>${box.boxId && !immutable ? `<footer class="commercial-v2-cold-box-actions">${closed ? closedAction : `${lastScan ? `<button type="button" class="danger-button" data-cold-box-unassign="${esc(lastScan.labelCode || lastScan.code)}">Desasignar último</button>` : ""}${box.automaticComplete ? `<button type="button" class="secondary-button" data-cold-box-close="${box.boxNumber}">Cerrar</button>` : ""}`}</footer>` : ""}</article>`;
  }

  function activeScannerMessage(progress) {
    if (progress?.allBoxesComplete) return { tone: "complete", title: "✅ PEDIDO COMPLETO", detail: "Todas las cajas han sido empacadas." };
    if (scanner.feedback) return scanner.feedback;
    return { tone: "active", title: "🟢 Lector Zebra activo", detail: "Escanee la etiqueta del siguiente ramo." };
  }

  function renderScannerPanel(progress) {
    const message = activeScannerMessage(progress);
    const queueCount = scanner.queue.length + (scanner.processing ? 1 : 0);
    return `<div class="commercial-v2-hid-status is-${esc(message.tone)}" data-cold-hid-status data-tone="${esc(message.tone)}" role="status" aria-live="polite">
      <div class="commercial-v2-hid-status-main"><span class="commercial-v2-hid-dot" aria-hidden="true"></span><div><strong data-cold-reader-status>${esc(message.title)}</strong><small data-cold-reader-detail>${esc(message.detail)}</small></div></div>
      <div class="commercial-v2-hid-meta"><span data-cold-last-read>${scanner.lastRead ? `Última lectura: ${esc(scanner.lastRead.code)}` : "Última lectura: —"}</span><span data-cold-queue ${queueCount ? "" : "hidden"}>En cola: ${queueCount}</span></div>
    </div>`;
  }

  function renderDetail(appState, order) {
    const ui = flow.sessionFor(appState).coldRoom;
    const progress = flow.buildOrderFulfillment(order);
    const dispatch = flow.getDispatchRecord(appState, order.id, order.sellingCompanyId);
    const dispatchStatus = upper(dispatch?.status || order.dispatchStatus || "");
    const local = flow.isLocalOrder(order, appState)
      && (!order.sellingCompanyId || !order.inventoryPoolCompanyId || String(order.sellingCompanyId) === String(order.inventoryPoolCompanyId));
    const pool = local ? flow.localPoolFor(appState, order.customerId) : [];
    const lots = local ? flow.localLotsFor(appState, order.customerId) : [];
    const selectedActiveBox = progress.boxes.find(box => !box.automaticComplete && Number(box.boxNumber) === Number(ui.boxNumber));
    const activeBox = selectedActiveBox || progress.boxes.find(box => !box.automaticComplete) || null;
    const activeBoxNumber = activeBox?.boxNumber || 0;
    const completedBoxes = progress.boxes.filter(box => box.automaticComplete).length;
    const activeBoxLabel = activeBox ? `${activeBox.boxNumber}/${progress.boxes.length}` : `${progress.boxes.length}/${progress.boxes.length}`;
    const scannerPanel = !local ? renderScannerPanel(progress) : "";
    const visibleCustomer = order.customerDisplay || customerName(appState, order.customerId);
    return `<section class="page-header"><div><p class="section-kicker">CUARTO FRÍO / PEDIDO</p><h1>${esc(order.number)}</h1><p>${esc(visibleCustomer)} · ${local ? "Asignación automática desde la bolsa local" : "Escaneo Zebra automático por caja compatible"}</p></div><div class="page-header-side"><button type="button" class="secondary-button" data-cold-back>Regresar a Cuarto Frío</button></div></section>
      <section class="commercial-v2-cold-compact-summary">${[["Cajas completadas", `${completedBoxes}/${progress.boxes.length}`], ["Caja actual", activeBoxLabel], ["Requerido", progress.requiredBunches], [local ? "Ingresado / asignado" : "Leídos", progress.scannedBunches], ["Pendiente", progress.pendingBunches]].map(item => `<div><span>${item[0]}</span><strong>${item[1]}</strong></div>`).join("")}</section>
      <section class="panel-card commercial-v2-section commercial-v2-dispatch-final"><div class="panel-card-head"><div><p class="section-kicker">SALIDA FÍSICA</p><h3>Despacho del pedido</h3><p class="panel-note">Empacado no significa despachado. La salida física ocurre únicamente al confirmar esta acción en Supabase.</p></div><span class="status-badge ${dispatchStatus === "DISPATCHED" || progress.allBoxesComplete ? "authorized" : "pending"}">${dispatchStatus === "DISPATCHED" ? "DESPACHADO" : progress.allBoxesComplete ? "PEDIDO COMPLETO" : "PEDIDO INCOMPLETO"}</span></div>${dispatchStatus === "DISPATCHED" ? `<div class="inline-feedback success"><strong>${esc(dispatch?.dispatchCode || order.dispatchCode || "DESPACHO CONFIRMADO")}</strong> · ${esc(String(dispatch?.dispatchedAt || order.dispatchedAt || "").replace("T", " ").slice(0, 16))}</div>` : `<div class="table-actions-inline"><button type="button" class="primary-button" data-cold-dispatch-confirm ${progress.allBoxesComplete || dispatchStatus === "READY_FOR_DISPATCH" ? "" : "disabled"}>Despachar pedido</button></div>`}</section>
      <section class="panel-card commercial-v2-section commercial-v2-cold-detail">
        <div class="panel-card-head"><div><p class="section-kicker">${local ? "VENTA LOCAL" : "ESCÁNER AUTOMÁTICO"}</p><h3>${local ? `Bolsa ${esc(visibleCustomer)}` : "Cajas y contenido del pedido"}</h3></div><span class="status-badge ${progress.allBoxesComplete ? "authorized" : "partial"}">${progress.allBoxesComplete ? "PEDIDO COMPLETADO" : "HID ACTIVO"}</span></div>
        ${local ? `<div class="commercial-v2-local-confirm"><div><strong>${pool.length} ramo(s) preparados · ${lots.length} lote(s)</strong><span>Se asignan por variedad y medida, del más antiguo al más reciente. No se reescanea la etiqueta Bless.</span></div><button type="button" class="primary-button" data-cold-confirm-local ${progress.allBoxesComplete ? "disabled" : ""}>Confirmar pedido local</button></div>
        <div class="table-wrap"><table><thead><tr><th>Lote</th><th>Etiqueta</th><th>Variedad</th><th>Medida</th><th>Calidad</th><th>Estado</th><th>Acción explícita</th></tr></thead><tbody>${pool.slice(0, 100).map(item => `<tr><td>${esc(item.lotCode || "SIN LOTE")}</td><td>${esc(item.labelCode)}</td><td>${esc(item.variety)}</td><td>${number(item.length)} CM</td><td>${esc(BlessERP.flowerQuality?.label?.(item.quality) || "SIN CALIDAD")}</td><td><span class="status-badge pending">DESTINADO</span></td><td><button type="button" class="secondary-button" data-cold-reassign-export="${esc(item.inventoryId)}">Mover a BLESS / Exportación</button></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty-state compact">No hay ramos ingresados disponibles para este cliente.</div></td></tr>`}</tbody></table></div>` : `${scannerPanel}<input class="commercial-v2-scanner-capture" id="cold-room-zebra-input" inputmode="numeric" autocomplete="off" maxlength="32" tabindex="-1" readonly data-cold-scan aria-hidden="true" aria-label="Buffer Zebra automático" ${progress.allBoxesComplete ? "disabled" : ""}>`}
        <div class="commercial-v2-cold-boxes">${progress.boxes.map(box => renderBox(box, activeBoxNumber, order)).join("")}</div>
      </section>`;
  }

  function render(appState) {
    const ui = flow.sessionFor(appState).coldRoom;
    const order = ui.orderId ? warehouseOrder(appState, ui.orderId, ui.sellingCompanyId) : null;
    if (ui.orderId && !order) { ui.orderId = ""; ui.sellingCompanyId = ""; }
    return order ? renderDetail(appState, order) : renderList(appState);
  }

  function clearBuffer() {
    scanner.buffer = "";
    if (scanner.bufferTimer) window.clearTimeout(scanner.bufferTimer);
    if (scanner.commitTimer) window.clearTimeout(scanner.commitTimer);
    scanner.bufferTimer = 0;
    scanner.commitTimer = 0;
  }

  function normalizedHidCode(rawValue) {
    const compact = upper(rawValue).replace(/[\r\n\t ]+/g, "");
    if (/^\d{10}$/.test(compact)) return compact;
    if (/^C1\d{10}$/.test(compact)) return compact.slice(2);
    if (/^\]C1\d{10}$/.test(compact)) return compact.slice(3);
    return "";
  }

  function isCompleteCandidate(rawValue) {
    return Boolean(normalizedHidCode(rawValue));
  }

  function isEditableTarget(target) {
    const editor = target?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']");
    return Boolean(editor && !editor.matches?.("[data-cold-scan]"));
  }

  function scannerProgress() {
    const order = scanner.orderId && scanner.appState ? warehouseOrder(scanner.appState, scanner.orderId, scanner.sellingCompanyId) : null;
    return order ? flow.buildOrderFulfillment(order) : null;
  }

  function setFeedback(tone, title, detail, options = {}) {
    scanner.feedback = { tone, title, detail };
    if (options.lastRead) scanner.lastRead = options.lastRead;
    if (scanner.feedbackTimer) window.clearTimeout(scanner.feedbackTimer);
    updateScannerDom();
    if (options.sticky) return;
    scanner.feedbackTimer = window.setTimeout(() => {
      scanner.feedbackTimer = 0;
      scanner.feedback = null;
      updateScannerDom();
    }, FEEDBACK_VISIBLE_MS);
  }

  function updateScannerDom() {
    const container = scanner.container;
    if (!container?.isConnected && typeof container?.isConnected === "boolean") return;
    const progress = scannerProgress();
    const message = activeScannerMessage(progress);
    const panel = container?.querySelector?.("[data-cold-hid-status]");
    if (panel) {
      panel.className = `commercial-v2-hid-status is-${message.tone}`;
      panel.dataset.tone = message.tone;
      const title = panel.querySelector("[data-cold-reader-status]");
      const detail = panel.querySelector("[data-cold-reader-detail]");
      const last = panel.querySelector("[data-cold-last-read]");
      const queue = panel.querySelector("[data-cold-queue]");
      if (title) title.textContent = message.title;
      if (detail) detail.textContent = message.detail;
      if (last) last.textContent = scanner.lastRead ? `Última lectura: ${scanner.lastRead.code}` : "Última lectura: —";
      const queueCount = scanner.queue.length + (scanner.processing ? 1 : 0);
      if (queue) {
        queue.hidden = queueCount === 0;
        queue.textContent = `En cola: ${queueCount}`;
      }
    }
  }

  function finishHidBuffer(options = {}) {
    const raw = scanner.buffer;
    const code = normalizedHidCode(raw);
    clearBuffer();
    if (!raw) return false;
    if (!code) {
      if (!options.silent) setFeedback("error", "❌ Etiqueta Zebra inválida", `Se esperan exactamente ${ZEBRA_CODE_LENGTH} dígitos.`);
      return false;
    }
    enqueueScan(code);
    return true;
  }

  function scheduleBufferTimers() {
    if (scanner.bufferTimer) window.clearTimeout(scanner.bufferTimer);
    if (scanner.commitTimer) window.clearTimeout(scanner.commitTimer);
    scanner.commitTimer = 0;
    if (isCompleteCandidate(scanner.buffer)) {
      scanner.commitTimer = window.setTimeout(() => finishHidBuffer(), HID_COMMIT_DELAY_MS);
    }
    scanner.bufferTimer = window.setTimeout(() => {
      if (!scanner.buffer) return;
      const incomplete = scanner.buffer;
      clearBuffer();
      setFeedback("warning", "⚠ Lectura incompleta", `${incomplete.length} carácter(es) recibidos. Lector listo nuevamente.`);
    }, HID_INCOMPLETE_TIMEOUT_MS);
  }

  function captureHidKey(event) {
    if (!scanner.listenerMounted || !scanner.orderId || isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.key === "Enter" || event.key === "Tab") {
      if (!scanner.buffer) return;
      event.preventDefault();
      finishHidBuffer();
      return;
    }
    if (event.key === "Escape") {
      if (!scanner.buffer) return;
      event.preventDefault();
      clearBuffer();
      setFeedback("active", "🟢 Lector Zebra activo", "Lectura cancelada. Puede escanear nuevamente.");
      return;
    }
    if (typeof event.key !== "string" || event.key.length !== 1 || !/^[A-Za-z0-9\]]$/.test(event.key)) return;
    event.preventDefault();
    if (scanner.buffer.length >= 32) {
      clearBuffer();
      setFeedback("error", "❌ Etiqueta Zebra inválida", "La lectura excede el formato permitido.");
      return;
    }
    scanner.buffer += event.key;
    scheduleBufferTimers();
  }

  function resetBufferOnReturn() {
    if (document.visibilityState === "visible") clearBuffer();
    updateScannerDom();
  }

  function mountHid(container, appState, orderId, sellingCompanyId = "") {
    const changedContext = scanner.orderId && (String(scanner.orderId) !== String(orderId) || String(scanner.sellingCompanyId) !== String(sellingCompanyId));
    if (changedContext) {
      scanner.contextVersion += 1;
      scanner.queue.length = 0;
      scanner.feedback = null;
      scanner.lastRead = null;
      scanner.lastVisibleActiveBox = 0;
      clearBuffer();
    }
    scanner.container = container;
    scanner.appState = appState;
    scanner.orderId = String(orderId || "");
    scanner.sellingCompanyId = String(sellingCompanyId || "");
    if (!scanner.listenerMounted) {
      document.addEventListener("keydown", captureHidKey, true);
      document.addEventListener("visibilitychange", resetBufferOnReturn);
      window.addEventListener("focus", resetBufferOnReturn);
      scanner.listenerMounted = true;
    }
    updateScannerDom();
  }

  function deactivateHid() {
    if (scanner.listenerMounted) {
      document.removeEventListener("keydown", captureHidKey, true);
      document.removeEventListener("visibilitychange", resetBufferOnReturn);
      window.removeEventListener("focus", resetBufferOnReturn);
    }
    scanner.listenerMounted = false;
    clearBuffer();
  }

  function unmount() {
    deactivateHid();
    scanner.contextVersion += 1;
    scanner.queue.length = 0;
    scanner.container = null;
    scanner.appState = null;
    scanner.orderId = "";
    scanner.sellingCompanyId = "";
    scanner.feedback = null;
    scanner.lastRead = null;
    scanner.pendingScrollBox = 0;
    scanner.lastVisibleActiveBox = 0;
    if (scanner.feedbackTimer) window.clearTimeout(scanner.feedbackTimer);
    scanner.feedbackTimer = 0;
  }

  function scanDetail(summary, code, assignedBoxNumber) {
    for (const box of summary?.boxes || []) {
      for (const line of box.lines || []) {
        const found = (line.scans || []).some(scan => String(scan.labelCode || scan.code || "") === String(code));
        if (found || Number(box.boxNumber) === Number(assignedBoxNumber)) {
          return { variety: line.variety || "Ramo", length: number(line.length), boxNumber: number(assignedBoxNumber || box.boxNumber), boxCode: box.boxCode || "" };
        }
      }
    }
    return { variety: "Ramo", length: 0, boxNumber: number(assignedBoxNumber), boxCode: "" };
  }

  function errorFeedback(result) {
    const message = upper(result?.error || result?.message || "");
    if (result?.alreadyPacked || upper(result?.status) === "ALREADY_PACKED" || message.includes("ALREADY_PACKED")) {
      return { tone: "warning", title: "⚠ Esta etiqueta ya fue empacada", detail: "No se incrementó ninguna caja." };
    }
    if (message.includes("BUNCH_ALREADY_ASSIGNED") || message.includes("OTRO PEDIDO") || message.includes("PERTENECE A OTRO")) {
      return { tone: "error", title: "❌ Esta etiqueta pertenece a otro pedido", detail: "No se modificó el pedido actual." };
    }
    if (message.includes("DOES_NOT_MATCH") || message.includes("NO CORRESPONDE A NINGUNA CAJA") || message.includes("VARIEDAD O MEDIDA")) {
      return { tone: "error", title: "❌ No existe caja compatible para esta variedad/medida", detail: "Verifique la etiqueta o el armado del pedido." };
    }
    if (message.includes("LABEL_NOT_FOUND") || message.includes("NO CORRESPONDE A UN RAMO") || message.includes("NO ENCONTR")) {
      return { tone: "error", title: "❌ Etiqueta Zebra no encontrada", detail: "La lectura no produjo cambios." };
    }
    return { tone: "error", title: "❌ Lectura rechazada", detail: result?.error || result?.message || "Supabase no confirmó el escaneo." };
  }

  function scrollToActiveBox() {
    const boxNumber = number(scanner.pendingScrollBox);
    if (!boxNumber || boxNumber === scanner.lastVisibleActiveBox) return;
    scanner.pendingScrollBox = 0;
    scanner.lastVisibleActiveBox = boxNumber;
    window.setTimeout(() => {
      const card = scanner.container?.querySelector?.(`[data-cold-box-card="${boxNumber}"]`);
      if (!card?.getBoundingClientRect) return;
      const rect = card.getBoundingClientRect();
      const outside = rect.top < 0 || rect.bottom > (window.innerHeight || document.documentElement?.clientHeight || 0);
      if (outside) card.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }, 30);
  }

  function rerenderScannerPage() {
    BlessERP.layout.renderPage();
    scrollToActiveBox();
  }

  async function drainQueue() {
    if (scanner.processing) return;
    scanner.processing = true;
    updateScannerDom();
    while (scanner.queue.length) {
      const item = scanner.queue.shift();
      const contextVersion = item.contextVersion;
      const before = scannerProgress();
      const beforeActive = before?.boxes?.find(box => !box.automaticComplete)?.boxNumber || 0;
      setFeedback("processing", "Procesando etiqueta...", item.code, { sticky: true });
      let result;
      try {
        result = await flow.scanBunchAutomatically(scanner.appState, item.orderId, item.code, item.sellingCompanyId);
      } catch (error) {
        result = { ok: false, error: error?.message || "No se pudo procesar la etiqueta." };
      }
      if (contextVersion !== scanner.contextVersion || String(item.orderId) !== String(scanner.orderId)) continue;
      const duplicate = result?.alreadyPacked || upper(result?.status) === "ALREADY_PACKED";
      if (result?.ok && !duplicate) {
        const after = result.summary || scannerProgress();
        const detail = scanDetail(after, item.code, result.assignedBoxNumber);
        const assignedBoxNumber = number(result.assignedBoxNumber || detail.boxNumber || beforeActive);
        const beforeAssigned = before?.boxes?.find(box => Number(box.boxNumber) === assignedBoxNumber);
        const afterAssigned = after?.boxes?.find(box => Number(box.boxNumber) === assignedBoxNumber);
        const boxCompleted = Boolean(beforeAssigned && !beforeAssigned.automaticComplete && afterAssigned?.automaticComplete);
        const compatibleNext = after?.boxes?.find(box => !box.automaticComplete && (box.lines || []).some(line => (
          number(line.pendingBunches) > 0
          && upper(line.variety) === upper(detail.variety)
          && number(line.length) === number(detail.length)
        )));
        const nextActive = boxCompleted
          ? number(compatibleNext?.boxNumber || after?.boxes?.find(box => !box.automaticComplete)?.boxNumber)
          : assignedBoxNumber;
        const boxReference = detail.boxCode || `Caja ${detail.boxNumber}`;
        const successText = `${item.code} — ${detail.variety}${detail.length ? ` ${detail.length}` : ""} → ${boxReference}`;
        scanner.lastRead = { code: item.code, detail: successText };
        if (after?.allBoxesComplete) {
          setFeedback("complete", "✅ PEDIDO COMPLETO", "Todas las cajas han sido empacadas.", { lastRead: scanner.lastRead, sticky: true });
        } else if (boxCompleted) {
          const next = after?.boxes?.find(box => Number(box.boxNumber) === Number(nextActive));
          setFeedback("success", `✅ Caja ${beforeActive} completada`, `Continuando con ${next?.boxCode || `Caja ${nextActive}`} · ${successText}`, { lastRead: scanner.lastRead });
          scanner.pendingScrollBox = nextActive;
        } else {
          setFeedback("success", `✅ ${successText}`, "Lectura confirmada. Lector listo para la siguiente etiqueta.", { lastRead: scanner.lastRead });
        }
        const ui = flow.sessionFor(scanner.appState).coldRoom;
        ui.boxNumber = nextActive || result.assignedBoxNumber || ui.boxNumber || 1;
        rerenderScannerPage();
      } else {
        const feedback = duplicate
          ? { tone: "warning", title: "⚠ Esta etiqueta ya fue empacada", detail: "No se incrementó ninguna caja." }
          : errorFeedback(result);
        scanner.lastRead = { code: item.code, detail: feedback.title };
        setFeedback(feedback.tone, feedback.title, feedback.detail, { lastRead: scanner.lastRead });
      }
      updateScannerDom();
    }
    scanner.processing = false;
    updateScannerDom();
  }

  function enqueueScan(code) {
    if (!scanner.orderId) return false;
    scanner.queue.push({ code, orderId: scanner.orderId, sellingCompanyId: scanner.sellingCompanyId, contextVersion: scanner.contextVersion });
    updateScannerDom();
    void drainQueue();
    return true;
  }

  function bindContainerEvents(container, appState) {
    if (container.dataset.coldRoomV2Bound === "true") return;
    container.dataset.coldRoomV2Bound = "true";
    container.addEventListener("change", event => {
      const filter = event.target.closest("[data-cold-filter]");
      if (!filter) return;
      const ui = flow.sessionFor(appState).coldRoom;
      ui[filter.dataset.coldFilter] = filter.value;
      ui.page = 1;
      BlessERP.layout.renderPage();
    });
    container.addEventListener("input", event => {
      const field = event.target.closest("[data-cold-scan]");
      if (!field || !field.value) return;
      scanner.buffer = field.value;
      field.value = "";
      finishHidBuffer();
    });
    container.addEventListener("keydown", event => {
      const field = event.target.closest("[data-cold-scan]");
      if (!field || event.key !== "Enter") return;
      event.preventDefault();
      scanner.buffer = field.value;
      field.value = "";
      finishHidBuffer();
    });
    container.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button) return;
      const ui = flow.sessionFor(appState).coldRoom;
      if (button.dataset.coldOpen) { ui.orderId = button.dataset.coldOpen; ui.sellingCompanyId = button.dataset.coldSeller || ""; BlessERP.layout.renderPage(); return; }
      if (button.hasAttribute("data-cold-back")) { ui.orderId = ""; ui.sellingCompanyId = ""; BlessERP.layout.renderPage(); return; }
      if (button.dataset.coldPage) { ui.page = Number(button.dataset.coldPage); BlessERP.layout.renderPage(); return; }
      if (button.hasAttribute("data-cold-all")) { ui.date = ""; ui.page = 1; BlessERP.layout.renderPage(); return; }
      if (button.hasAttribute("data-cold-confirm-local")) {
        button.disabled = true;
        const result = await flow.confirmLocalOrder(appState, ui.orderId);
        BlessERP.layout.toast(result.ok ? `${result.assigned} ramo(s) asignados.` : result.error, { tone: result.ok ? "success" : "warning" });
        if (!result.ok && button.isConnected) button.disabled = false;
        BlessERP.layout.renderPage();
        return;
      }
      if (button.dataset.coldReassignExport) {
        const reason = prompt("Motivo para mover este ramo a BLESS / Exportación:");
        if (!reason) return;
        button.disabled = true;
        const result = await flow.unassignInventory(appState, button.dataset.coldReassignExport, reason);
        BlessERP.layout.toast(result.ok ? "Destino comercial actualizado en Supabase." : result.error, { tone: result.ok ? "success" : "danger" });
        BlessERP.layout.renderPage();
        return;
      }
      if (button.dataset.coldBoxClose) {
        button.disabled = true;
        const result = await flow.closeWarehouseBox(appState, ui.orderId, Number(button.dataset.coldBoxClose), ui.sellingCompanyId);
        if (!result.ok) BlessERP.layout.toast(result.error, { tone: "danger" });
        BlessERP.layout.renderPage();
        return;
      }
      if (button.dataset.coldBoxReopen) {
        const reason = prompt("Motivo de reapertura de la caja:");
        if (!reason) return;
        button.disabled = true;
        const result = await flow.reopenWarehouseBox(appState, ui.orderId, Number(button.dataset.coldBoxReopen), reason, ui.sellingCompanyId);
        if (!result.ok) BlessERP.layout.toast(result.error, { tone: "danger" });
        BlessERP.layout.renderPage();
        return;
      }
      if (button.dataset.coldBoxUnassign) {
        const reason = prompt("Motivo para retirar el ramo de la caja:");
        if (!reason) return;
        button.disabled = true;
        const result = await flow.unassignBunchFromOrder(appState, ui.orderId, button.dataset.coldBoxUnassign, reason, ui.sellingCompanyId);
        if (!result.ok) BlessERP.layout.toast(result.error, { tone: "danger" });
        BlessERP.layout.renderPage();
        return;
      }
      if (button.hasAttribute("data-cold-dispatch-confirm")) {
        if (!confirm("¿Confirma que el pedido y todas sus cajas salieron físicamente de la empresa?")) return;
        const observations = prompt("Observación del despacho (opcional):", "Salida física confirmada desde Cuarto Frío.") || "";
        button.disabled = true;
        const result = await flow.confirmDispatch(appState, ui.orderId, { observations }, ui.sellingCompanyId);
        BlessERP.layout.toast(result.ok ? `Despacho ${result.result?.dispatchCode || ""} confirmado.` : result.error, { tone: result.ok ? "success" : "danger" });
        BlessERP.layout.renderPage();
      }
    });
  }

  function bind(container, appState) {
    bindContainerEvents(container, appState);
    const ui = flow.sessionFor(appState).coldRoom;
    if (!ui.sharedLoaded && !ui.sharedLoading && typeof flow.refreshWarehouseOrders === "function") {
      void flow.refreshWarehouseOrders(appState).then(result => {
        if (!result?.ok) BlessERP.layout.toast(result?.message || "No se pudo cargar la cola compartida de Cuarto Frío.", { tone: "warning" });
        if (container.isConnected) BlessERP.layout.renderPage();
      });
    }
    const scannerField = container.querySelector("[data-cold-scan]:not(:disabled)");
    if (scannerField && ui.orderId) {
      mountHid(container, appState, ui.orderId, ui.sellingCompanyId);
      scrollToActiveBox();
    } else {
      scanner.container = container;
      scanner.appState = appState;
      deactivateHid();
    }
  }

  function scannerDiagnostics() {
    return {
      mounted: scanner.listenerMounted,
      orderId: scanner.orderId,
      queueLength: scanner.queue.length,
      processing: scanner.processing,
      bufferLength: scanner.buffer.length,
      contextVersion: scanner.contextVersion
    };
  }

  BlessERP.operacionesCuartoFrioV2 = { render, bind, unmount, scannerDiagnostics };
})();
