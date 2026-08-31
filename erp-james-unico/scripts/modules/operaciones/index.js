(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;
  let zebraIntakeBuffer = "";
  let zebraIntakeTimer = 0;
  let zebraIntakeHidAbortController = null;
  const ZEBRA_INTAKE_RESULT_LIMIT = 10;
  const ZEBRA_INTAKE_MAX_QUEUE = 100;
  const ZEBRA_INTAKE_MAX_ATTEMPTS = 2;
  const zebraIntakeSession = {
    queue: [],
    pendingCodes: new Set(),
    results: [],
    processing: false,
    mounted: false,
    container: null,
    appState: null,
    confirmed: 0,
    errors: 0,
    activeMutations: 0,
    maxConcurrentMutations: 0,
    remoteSyncAt: "",
    idleWaiters: []
  };
  let zebraSearchBuffer = "";
  let zebraSearchTimer = 0;
  let zebraDispatchBuffer = "";
  let zebraDispatchTimer = 0;
  let zebraDispatchCommitTimer = 0;
  let zebraDispatchRenderTimer = 0;
  let deferredRerenderTimer = 0;
  let dispatchDeferredRenderToken = 0;

  function renderDispatchLoading() {
    return `
      <section class="page-header">
        <div><p class="section-kicker">OPERACIONES / POSCOSECHA</p><h1>Cuarto frío</h1><p>Historial de pedidos y escáner de cajas.</p></div>
        <div class="page-header-side"><span class="order-tracking-loading-status"><span class="jaeder-loading-spinner" aria-hidden="true"></span>Preparando pedidos...</span></div>
      </section>
      <section class="order-tracking-progress" data-jaeder-deferred-content role="status" aria-live="polite" aria-busy="true">
        <div class="order-tracking-skeleton-grid" aria-hidden="true">
          ${Array.from({ length: 3 }, () => `<article><span class="order-tracking-skeleton-line short"></span><span class="order-tracking-skeleton-line metric"></span><span class="order-tracking-skeleton-line"></span></article>`).join("")}
        </div>
        <section class="panel-card order-tracking-skeleton-panel" aria-hidden="true">
          <div class="order-tracking-skeleton-filters"><span class="order-tracking-skeleton-line"></span><span class="order-tracking-skeleton-line"></span></div>
          ${Array.from({ length: 5 }, () => `<div class="order-tracking-skeleton-row"><span></span><span></span><span></span><span></span></div>`).join("")}
        </section>
        <p>Organizando pedidos y estados de cajas. El Cuarto frío se completará automáticamente.</p>
      </section>
    `;
  }

  function renderDispatchDeferred(container, appState, route) {
    const token = ++dispatchDeferredRenderToken;
    container.innerHTML = renderDispatchLoading();
    const complete = () => {
      if (token !== dispatchDeferredRenderToken || BlessERP.state.currentRoute().id !== "operations-dispatch") return;
      try {
        BlessERP.performance?.measureSync?.("render:operations-dispatch:contenido", () => {
          container.innerHTML = BlessERP.operacionesCuartoFrioV2.render(appState, route);
          BlessERP.operacionesCuartoFrioV2.bind(container, appState);
          BlessERP.layout.finalizeDeferredContent?.(container);
          window.setTimeout(() => container.querySelector("[data-ops-dispatch-bunch-scan]:not(:disabled)")?.focus(), 0);
        }, { routeId: "operations-dispatch" });
        BlessERP.performance?.finishRouteTransition?.("operations-dispatch", {
          domNodes: container.querySelectorAll("*").length,
          progressive: true
        });
      } catch (error) {
        container.innerHTML = `<section class="panel-card"><h2>No se pudo abrir Cuarto frío</h2><p>${utils.esc(error?.message || "Error de carga")}</p></section>`;
        BlessERP.performance?.finishRouteTransition?.("operations-dispatch", { error: true, progressive: true });
        console.error("[JAEDER][operations-dispatch]", error);
      }
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(complete));
    } else {
      window.setTimeout(complete, 20);
    }
  }

  function isZebraBarcodeKey(key) {
    return typeof key === "string" && key.length === 1 && /^[A-Za-z0-9|:_-]$/.test(key);
  }

  function isStructuredBarcode(value) {
    return BlessERP.bunchLabelCodec?.isStructuredCode?.(value) || false;
  }

  function isStructuredBarcodeCandidate(value) {
    const compact = String(value || "").replace(/[\r\n\t ]+/g, "").toUpperCase();
    return compact === "B" || compact.startsWith("BF");
  }

  function isCompleteStructuredBarcode(value) {
    const compact = String(value || "").replace(/[\r\n\t ]+/g, "").toUpperCase();
    return BlessERP.bunchLabelCodec?.isCompleteCode?.(compact) || false;
  }

  function normalizeBunchSearchInput(value) {
    const compact = String(value || "").replace(/[\r\n\t ]+/g, "").slice(0, 180);
    if (isStructuredBarcodeCandidate(compact)) {
      return compact.toUpperCase().replace(/[^A-Z0-9|:_-]/g, "");
    }
    return compact.replace(/\D/g, "").slice(0, 10);
  }

  function resetZebraIntakeBuffer() {
    zebraIntakeBuffer = "";
    if (zebraIntakeTimer) clearTimeout(zebraIntakeTimer);
    zebraIntakeTimer = 0;
  }

  function updateBunchIntakeReader(container, item) {
    if (!container || !item) return;
    const reader = container.querySelector("[data-ops-bunch-intake-auto]");
    if (reader) {
      const codeNode = reader.querySelector("strong");
      const resultNode = reader.querySelector("small");
      if (codeNode) codeNode.textContent = item.code ? `ETIQUETA ${item.code}` : "ESPERANDO ETIQUETA";
      if (resultNode) resultNode.textContent = item.message || item.status || "LECTURA RECIBIDA";
      reader.dataset.result = item.status === "INGRESADO" ? "ok" : item.status === "ERROR" ? "error" : "pending";
    }
    const scanInput = container.querySelector("[data-ops-bunch-intake-scan]");
    if (scanInput) scanInput.value = "";
  }

  function getZebraIntakeSnapshot() {
    return {
      pending: zebraIntakeSession.queue.length,
      confirmed: zebraIntakeSession.confirmed,
      errors: zebraIntakeSession.errors,
      processing: zebraIntakeSession.processing,
      mounted: zebraIntakeSession.mounted,
      remoteSyncAt: zebraIntakeSession.remoteSyncAt,
      maxConcurrentMutations: zebraIntakeSession.maxConcurrentMutations,
      results: zebraIntakeSession.results.map(item => ({
        code: item.code,
        operationId: item.operationId,
        status: item.status,
        message: item.message,
        retryable: item.retryable === true,
        attempts: item.attempts
      })),
      last: zebraIntakeSession.results[0] ? {
        code: zebraIntakeSession.results[0].code,
        operationId: zebraIntakeSession.results[0].operationId,
        status: zebraIntakeSession.results[0].status,
        message: zebraIntakeSession.results[0].message,
        retryable: zebraIntakeSession.results[0].retryable === true
      } : null
    };
  }

  function publishZebraIntakeState() {
    const container = zebraIntakeSession.container;
    if (!container || BlessERP.state.currentRoute()?.id !== "operations-bunch-intake") return;
    const snapshot = getZebraIntakeSnapshot();
    const sessionNode = container.querySelector("[data-ops-zebra-session]");
    if (sessionNode && BlessERP.operacionesIngresoRamos?.renderSession) {
      sessionNode.innerHTML = BlessERP.operacionesIngresoRamos.renderSession(snapshot);
    }
    if (snapshot.last) updateBunchIntakeReader(container, snapshot.last);
    const remoteNode = container.querySelector("[data-ops-zebra-remote-sync]");
    if (remoteNode && snapshot.remoteSyncAt) remoteNode.textContent = "INVENTARIO SINCRONIZADO";
  }

  function addZebraSessionResult(item) {
    const existingIndex = zebraIntakeSession.results.indexOf(item);
    if (existingIndex >= 0) zebraIntakeSession.results.splice(existingIndex, 1);
    zebraIntakeSession.results.unshift(item);
    zebraIntakeSession.results = zebraIntakeSession.results.slice(0, ZEBRA_INTAKE_RESULT_LIMIT);
  }

  function newZebraOperationId() {
    return BlessERP.getLocalDestinationV2Repository?.()?.uuid?.()
      || BlessERP.offlineSync?.createOperationId?.()
      || globalThis.crypto?.randomUUID?.()
      || `ZEBRA-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function actionableZebraError(result = {}) {
    const mode = String(result.mode || "").toUpperCase();
    const code = String(result.errorCode || "").toUpperCase();
    const message = String(result.observation || result.message || "");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { message: "Sin conexión. El ramo no fue confirmado.", retryable: true, toast: true };
    }
    if (["PGRST301", "401", "JWT_EXPIRED"].includes(code) || /jwt|sesión|session|token.*expired/i.test(message)) {
      return { message: "La sesión venció. Inicie sesión nuevamente.", retryable: false, toast: true };
    }
    if (code === "42501" || /empresa|company|acceso.*denegado|permission denied/i.test(message)) {
      return { message: "La empresa activa no tiene acceso para confirmar este ramo.", retryable: false, toast: true };
    }
    if (/timeout|tiempo.*espera/i.test(message)) {
      return { message: "Tiempo de espera agotado. Se verificará con la misma operación.", retryable: true, toast: true };
    }
    if (["SUPABASE_ERROR", "UNAVAILABLE", "BACKEND_UNAVAILABLE", "CANONICAL_CACHE_ERROR"].includes(mode)
      || /network|fetch|conexión|connection/i.test(message)) {
      return { message: "No se pudo confirmar con Supabase. Puede reintentar la misma operación.", retryable: true, toast: true };
    }
    if (result.result === "FORMATO_INVALIDO") return { message: "Código Zebra inválido.", retryable: false, toast: false };
    return { message: "El servidor rechazó el ingreso del ramo.", retryable: false, toast: true };
  }

  function zebraResultDescription(result = {}) {
    const inventory = result.inventory || {};
    const variety = String(inventory.variety || result.bunch?.variety || "").trim();
    const length = Number(inventory.length || result.bunch?.length || 0);
    const description = [variety, length > 0 ? `${length} cm` : ""].filter(Boolean).join(" ");
    return description ? `${description} — Ingresado` : `${result.code || "Ramo"} — Ingresado`;
  }

  function notifyZebraIdle() {
    if (zebraIntakeSession.processing || zebraIntakeSession.queue.length) return;
    zebraIntakeSession.idleWaiters.splice(0).forEach(resolve => resolve(getZebraIntakeSnapshot()));
  }

  function waitForZebraIntakeIdle() {
    if (!zebraIntakeSession.processing && !zebraIntakeSession.queue.length) return Promise.resolve(getZebraIntakeSnapshot());
    return new Promise(resolve => zebraIntakeSession.idleWaiters.push(resolve));
  }

  async function executeZebraQueueItem(item) {
    let result = null;
    while (item.attempts < ZEBRA_INTAKE_MAX_ATTEMPTS) {
      item.attempts += 1;
      zebraIntakeSession.activeMutations += 1;
      zebraIntakeSession.maxConcurrentMutations = Math.max(zebraIntakeSession.maxConcurrentMutations, zebraIntakeSession.activeMutations);
      try {
        result = await stateApi.scanBunchLabelIntoInventory(item.appState, item.code, {
          automaticConfirmation: true,
          operationId: item.operationId,
          suppressToast: true
        });
      } finally {
        zebraIntakeSession.activeMutations = Math.max(0, zebraIntakeSession.activeMutations - 1);
      }
      if (result?.ok || result?.result === "DUPLICADO" || result?.pendingComposition) return result;
      const classified = actionableZebraError(result);
      if (!classified.retryable || item.attempts >= ZEBRA_INTAKE_MAX_ATTEMPTS) return result;
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    return result;
  }

  async function drainZebraIntakeQueue() {
    if (zebraIntakeSession.processing) return;
    zebraIntakeSession.processing = true;
    try {
      while (zebraIntakeSession.queue.length) {
        const item = zebraIntakeSession.queue[0];
        item.status = "CONFIRMANDO";
        item.message = "Confirmando con Supabase...";
        addZebraSessionResult(item);
        publishZebraIntakeState();
        const result = await executeZebraQueueItem(item);
        item.rawResult = result;
        if (result?.ok) {
          item.status = "INGRESADO";
          item.message = zebraResultDescription(result);
          item.retryable = false;
          zebraIntakeSession.confirmed += 1;
        } else if (result?.result === "DUPLICADO") {
          item.status = "DUPLICADO";
          item.message = "Ramo ya ingresado. El inventario no cambió.";
          item.retryable = false;
        } else if (result?.pendingComposition) {
          item.status = "PENDIENTE_COMPOSICION";
          item.message = "Complete la composición antes de ingresar el ramo.";
          item.retryable = false;
        } else {
          const classified = actionableZebraError(result);
          item.status = "ERROR";
          item.message = classified.message;
          item.retryable = classified.retryable;
          zebraIntakeSession.errors += 1;
          if (classified.toast) BlessERP.layout?.toast?.(classified.message, { tone: "danger" });
        }
        zebraIntakeSession.pendingCodes.delete(item.code);
        zebraIntakeSession.queue.shift();
        addZebraSessionResult(item);
        publishZebraIntakeState();
        if (result?.pendingComposition && BlessERP.state.currentRoute()?.id === "operations-bunch-intake") rerender();
      }
    } finally {
      zebraIntakeSession.processing = false;
      publishZebraIntakeState();
      notifyZebraIdle();
    }
  }

  function recordLocalZebraFeedback(code, status, message) {
    const item = { code: String(code || ""), operationId: "", status, message, retryable: false, attempts: 0, localOnly: true };
    if (status === "ERROR") zebraIntakeSession.errors += 1;
    addZebraSessionResult(item);
    publishZebraIntakeState();
    return item;
  }

  function enqueueBunchIntakeCode(appState, rawCode, options = {}) {
    const code = normalizeBunchSearchInput(rawCode);
    const valid = /^\d{10}$/.test(code) || isCompleteStructuredBarcode(code);
    if (!valid) return { accepted: false, reason: "INVALID", item: recordLocalZebraFeedback(code, "ERROR", code ? "Lectura incompleta o código Zebra inválido." : "Código Zebra inválido.") };
    if (zebraIntakeSession.pendingCodes.has(code)) {
      return { accepted: false, reason: "PENDING_DUPLICATE", item: recordLocalZebraFeedback(code, "EN_COLA", "Este código ya está pendiente de confirmación.") };
    }
    if (zebraIntakeSession.queue.length >= ZEBRA_INTAKE_MAX_QUEUE) {
      const item = recordLocalZebraFeedback(code, "ERROR", "La cola llegó a su límite. Espere la confirmación de los ramos pendientes.");
      BlessERP.layout?.toast?.(item.message, { tone: "danger" });
      return { accepted: false, reason: "QUEUE_FULL", item };
    }
    const item = {
      code,
      operationId: String(options.operationId || newZebraOperationId()),
      status: "LEIDO",
      message: "Lectura recibida.",
      retryable: false,
      attempts: 0,
      acceptedAt: new Date().toISOString(),
      appState
    };
    zebraIntakeSession.appState = appState;
    zebraIntakeSession.pendingCodes.add(code);
    zebraIntakeSession.queue.push(item);
    addZebraSessionResult(item);
    publishZebraIntakeState();
    window.setTimeout(() => {
      if (item.status === "LEIDO") {
        item.status = "EN_COLA";
        item.message = "En cola para confirmar.";
        addZebraSessionResult(item);
        publishZebraIntakeState();
      }
      void drainZebraIntakeQueue();
    }, 0);
    return { accepted: true, item };
  }

  function retryBunchIntake(operationId) {
    const item = zebraIntakeSession.results.find(candidate => candidate.operationId === operationId && candidate.status === "ERROR" && candidate.retryable);
    if (!item || zebraIntakeSession.pendingCodes.has(item.code)) return { accepted: false };
    zebraIntakeSession.errors = Math.max(0, zebraIntakeSession.errors - 1);
    item.status = "EN_COLA";
    item.message = "Reintento en cola con la misma operación.";
    item.retryable = false;
    item.attempts = 0;
    zebraIntakeSession.pendingCodes.add(item.code);
    zebraIntakeSession.queue.push(item);
    addZebraSessionResult(item);
    publishZebraIntakeState();
    void drainZebraIntakeQueue();
    return { accepted: true, item };
  }

  function resetZebraSearchBuffer() {
    zebraSearchBuffer = "";
    if (zebraSearchTimer) clearTimeout(zebraSearchTimer);
    zebraSearchTimer = 0;
    document.querySelectorAll("[data-ops-bunch-search-scan]").forEach(field => {
      field.value = "";
    });
  }

  function resetZebraDispatchBuffer() {
    zebraDispatchBuffer = "";
    if (zebraDispatchTimer) clearTimeout(zebraDispatchTimer);
    if (zebraDispatchCommitTimer) clearTimeout(zebraDispatchCommitTimer);
    zebraDispatchTimer = 0;
    zebraDispatchCommitTimer = 0;
    document.querySelectorAll("[data-ops-dispatch-bunch-scan]").forEach(field => {
      field.value = "";
    });
  }

  function dispatchBarcodeDigits(value) {
    return String(value || "")
      .replace(/[\r\n\t ]+/g, "")
      .replace(/^C1(?=\d)/i, "")
      .replace(/\D+/g, "");
  }

  function scheduleDispatchRerender(delay = 35) {
    if (zebraDispatchRenderTimer) window.clearTimeout(zebraDispatchRenderTimer);
    zebraDispatchRenderTimer = window.setTimeout(() => {
      zebraDispatchRenderTimer = 0;
      rerender();
    }, delay);
  }

  function scannerResultMessage(result, progress) {
    if (result?.ok) {
      if (progress?.status === "PEDIDO_COMPLETADO" || result.orderCompleted) return "PEDIDO COMPLETADO";
      if (result.boxCompleted) return "CAJA COMPLETADA";
      return "ETIQUETA CORRECTA";
    }
    const messages = {
      DUPLICADO: "ETIQUETA YA UTILIZADA",
      NO_ENCONTRADO: "ETIQUETA NO INGRESADA AL INVENTARIO",
      NO_DISPONIBLE: "RAMO NO DISPONIBLE",
      NO_COINCIDE: "VARIEDAD O MEDIDA INCORRECTA",
      FORMATO_INVALIDO: "LECTURA INCOMPLETA",
      BLOQUEADA: "ETIQUETA BLOQUEADA"
    };
    return messages[result?.result] || "ERROR DE LECTURA";
  }

  function updateFastScannerIndicator(payload) {
    document.querySelectorAll("[data-ops-dispatch-reader-status]").forEach(node => {
      node.classList.toggle("is-success", payload?.ok === true);
      node.classList.toggle("is-error", payload?.ok === false);
      const title = node.querySelector("strong");
      const detail = node.querySelector("small");
      if (title) title.textContent = payload?.message || "LISTO PARA ESCANEAR";
      if (detail) detail.textContent = payload?.ok ? "Lectura validada y guardada" : "Vuelva a escanear la etiqueta";
    });
  }

  function playBoxCompletedFeedback() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        const audioContext = new AudioContextClass();
        const startedAt = audioContext.currentTime;
        [660, 880].forEach((frequency, index) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const toneStart = startedAt + (index * 0.13);
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, toneStart);
          gain.gain.setValueAtTime(0.0001, toneStart);
          gain.gain.exponentialRampToValueAtTime(0.18, toneStart + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.12);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(toneStart);
          oscillator.stop(toneStart + 0.13);
        });
        setTimeout(() => audioContext.close?.(), 450);
      } catch (error) {
        console.warn("No se pudo reproducir el tono de caja completada.", error);
      }
    }
    if ("speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function") {
      try {
        const message = new window.SpeechSynthesisUtterance("Caja completada");
        message.lang = "es-EC";
        message.rate = 0.95;
        message.pitch = 1;
        message.volume = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(message);
      } catch (error) {
        console.warn("No se pudo reproducir la voz de caja completada.", error);
      }
    }
  }

  function scanDispatchBunch(appState, rawCode) {
    const ui = stateApi.getUi(appState);
    const code = BlessERP.comercialOrderFulfillment?.normalizeBunchBarcodeCode?.(rawCode)
      || String(rawCode || "").replace(/[\r\n\t ]+/g, "").trim();
    const dispatchService = BlessERP.operacionesDispatchDemo;
    const result = BlessERP.comercialOrderFulfillment?.scanBunchForOrder?.(
      appState,
      ui.selectedDispatchOrderId,
      ui.dispatchAssemblyBoxNumber,
      code
    ) || { ok: false, error: "Servicio de armado no disponible." };
    const progress = result.ok
      ? dispatchService?.refreshDispatchProgressDemo?.(appState, ui.selectedDispatchOrderId, { action: "ESCANEAR_RAMO_CAJA" })
      : null;
    if (result.ok && result.boxCompleted) playBoxCompletedFeedback();
    if (result.ok && result.boxCompleted && !result.orderCompleted) {
      const nextBox = result.summary?.boxes?.find(box => !box.automaticComplete && box.boxNumber !== result.boxNumber);
      if (nextBox) ui.dispatchAssemblyBoxNumber = nextBox.boxNumber;
    }
    const feedback = {
      ok: Boolean(result.ok),
      message: scannerResultMessage(result, progress),
      warning: String(result.warning || "").replace(/\b\d{10}\b/g, "la etiqueta")
    };
    ui.dispatchLastBunchScan = feedback;
    ui.dispatchBunchScanCode = "";
    updateFastScannerIndicator(feedback);
    if (!result.ok) console.warn("Lectura rechazada en Cuarto frío.", { result: result.result, error: result.error });
    return result;
  }

  function finishZebraDispatchScan(appState) {
    const rawCode = zebraDispatchBuffer;
    const digitCount = dispatchBarcodeDigits(rawCode).length;
    const code = BlessERP.comercialOrderFulfillment?.normalizeBunchBarcodeCode?.(rawCode)
      || String(rawCode || "").replace(/[\r\n\t ]+/g, "").trim();
    resetZebraDispatchBuffer();
    if (!isStructuredBarcode(code) && digitCount < 10) {
      const ui = stateApi.getUi(appState);
      const feedback = {
        ok: false,
        message: "LECTURA INCOMPLETA",
        warning: ""
      };
      ui.dispatchLastBunchScan = feedback;
      ui.dispatchBunchScanCode = "";
      updateFastScannerIndicator(feedback);
      scheduleDispatchRerender();
      return false;
    }
    const result = scanDispatchBunch(appState, code);
    scheduleDispatchRerender();
    return Boolean(result?.ok);
  }

  function captureZebraDispatchKey(event, appState) {
    if (BlessERP.state.currentRoute()?.id !== "operations-dispatch") return false;
    const ui = stateApi.getUi(appState);
    const target = event.target;
    const dispatchScannerField = target?.closest?.("[data-ops-dispatch-bunch-scan]");
    const editableTarget = target?.closest?.("textarea, select, [contenteditable='true'], input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit'])");
    const activeScannerField = event.currentTarget?.querySelector?.("[data-ops-dispatch-bunch-scan]:not(:disabled)");
    const scannerActive = ui.dispatchViewMode === "detail" && (ui.dispatchDetailTab || "boxes") === "boxes";
    if (!scannerActive || !activeScannerField || (editableTarget && !dispatchScannerField) || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false;

    if (isZebraBarcodeKey(event.key)) {
      event.preventDefault();
      zebraDispatchBuffer = `${zebraDispatchBuffer}${event.key}`.slice(-180);
      const capturedDigits = dispatchBarcodeDigits(zebraDispatchBuffer);
      activeScannerField.value = "";
      if (zebraDispatchTimer) clearTimeout(zebraDispatchTimer);
      zebraDispatchTimer = setTimeout(resetZebraDispatchBuffer, 2500);
      if (zebraDispatchCommitTimer) clearTimeout(zebraDispatchCommitTimer);
      if (!isStructuredBarcodeCandidate(zebraDispatchBuffer) && capturedDigits.length === 10) {
        finishZebraDispatchScan(appState);
      } else if (isCompleteStructuredBarcode(zebraDispatchBuffer)) {
        finishZebraDispatchScan(appState);
      }
      return true;
    }

    if (event.key === "Enter" && (dispatchScannerField || zebraDispatchBuffer)) {
      event.preventDefault();
      if (zebraDispatchBuffer) finishZebraDispatchScan(appState);
      else resetZebraDispatchBuffer();
      return true;
    }

    return false;
  }

  function captureZebraSearchKey(event, appState) {
    if (BlessERP.state.currentRoute()?.id !== "operations-bunch-intake") return false;
    const target = event.target;
    const editableTarget = target?.closest?.("textarea, select, [contenteditable='true'], input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit'])");
    if (!BlessERP.operacionesIngresoRamos.isSearchPanelOpen() || editableTarget) return false;

    if (isZebraBarcodeKey(event.key)) {
      event.preventDefault();
      zebraSearchBuffer = `${zebraSearchBuffer}${event.key}`.slice(-180);
      const searchField = event.currentTarget?.querySelector?.("[data-ops-bunch-search-scan]");
      if (searchField) searchField.value = zebraSearchBuffer;
      if (zebraSearchTimer) clearTimeout(zebraSearchTimer);
      zebraSearchTimer = setTimeout(resetZebraSearchBuffer, 700);
      if (!isStructuredBarcode(zebraSearchBuffer) && zebraSearchBuffer.length === 10) {
        const code = zebraSearchBuffer;
        resetZebraSearchBuffer();
        stateApi.addBunchToSearch(appState, code);
        rerender();
      } else if (isCompleteStructuredBarcode(zebraSearchBuffer)) {
        const code = zebraSearchBuffer;
        resetZebraSearchBuffer();
        stateApi.addBunchToSearch(appState, code);
        rerender();
      }
      return true;
    }

    if (event.key === "Enter" && zebraSearchBuffer) {
      event.preventDefault();
      const code = zebraSearchBuffer;
      resetZebraSearchBuffer();
      stateApi.addBunchToSearch(appState, code);
      rerender();
      return true;
    }

    return false;
  }

  function captureZebraIntakeKey(event, appState, container) {
    if (BlessERP.state.currentRoute()?.id !== "operations-bunch-intake") return false;
    const target = event.target;
    const mixedCompositionOpen = target?.closest?.("[data-ops-mixed-composition]");
    const editing = target?.closest?.("input:not([data-ops-bunch-intake-scan]), textarea, select, [contenteditable='true']");
    if (BlessERP.operacionesIngresoRamos.isSearchPanelOpen()
      || BlessERP.operacionesRamosIngresados?.isOpen?.()
      || mixedCompositionOpen
      || editing
      || event.ctrlKey
      || event.altKey
      || event.metaKey
      || event.isComposing) return false;

    if (isZebraBarcodeKey(event.key)) {
      event.preventDefault();
      zebraIntakeBuffer = `${zebraIntakeBuffer}${event.key}`.slice(-180);
      if (zebraIntakeTimer) clearTimeout(zebraIntakeTimer);
      zebraIntakeTimer = setTimeout(() => {
        const incompleteCode = zebraIntakeBuffer;
        resetZebraIntakeBuffer();
        if (incompleteCode) recordLocalZebraFeedback(incompleteCode, "ERROR", "Lectura incompleta. El lector está listo nuevamente.");
      }, 500);
      if (!isStructuredBarcode(zebraIntakeBuffer) && zebraIntakeBuffer.length === 10) {
        const code = zebraIntakeBuffer;
        resetZebraIntakeBuffer();
        enqueueBunchIntakeCode(appState, code);
      } else if (isCompleteStructuredBarcode(zebraIntakeBuffer)) {
        const code = zebraIntakeBuffer;
        resetZebraIntakeBuffer();
        enqueueBunchIntakeCode(appState, code);
      }
      return true;
    }

    if (event.key === "Enter" && zebraIntakeBuffer) {
      event.preventDefault();
      const code = zebraIntakeBuffer;
      resetZebraIntakeBuffer();
      enqueueBunchIntakeCode(appState, code);
      return true;
    }

    return false;
  }

  function unmountZebraIntakeHid() {
    zebraIntakeHidAbortController?.abort?.();
    zebraIntakeHidAbortController = null;
    zebraIntakeSession.mounted = false;
    zebraIntakeSession.container = null;
    resetZebraIntakeBuffer();
  }

  function mountZebraIntakeHid(container, appState) {
    unmountZebraIntakeHid();
    if (BlessERP.state.currentRoute()?.id !== "operations-bunch-intake") return;
    zebraIntakeHidAbortController = new AbortController();
    zebraIntakeSession.mounted = true;
    zebraIntakeSession.container = container;
    zebraIntakeSession.appState = appState;
    document.addEventListener("keydown", event => {
      captureZebraIntakeKey(event, zebraIntakeSession.appState, zebraIntakeSession.container);
    }, { signal: zebraIntakeHidAbortController.signal });
    publishZebraIntakeState();
  }

  function isOperationsRoute() {
    const routeId = String(BlessERP.state.currentRoute()?.id || "");
    return routeId.startsWith("operations-") || routeId === "commercial-availability-reservations";
  }

  function refreshCalculatedNodes(container, appState) {
    if (!isOperationsRoute()) return;
    const ui = stateApi.getUi(appState);
    const totalNode = container.querySelector("[data-ops-reception-total]");
    if (totalNode) {
      totalNode.textContent = `${utils.number(ui.receptionDraft.totalDeclared)} tallos`;
    }
    const receptionItemTotalNode = container.querySelector("[data-ops-reception-item-total]");
    if (receptionItemTotalNode) {
      receptionItemTotalNode.textContent = `${utils.number(ui.receptionItemDraft?.totalStems)} tallos`;
    }
    const receptionSupplierNode = container.querySelector("[data-ops-reception-supplier]");
    if (receptionSupplierNode) {
      receptionSupplierNode.value = ui.receptionDraft?.supplier || "Seleccione un bloque";
    }
    const codeNode = container.querySelector("[data-ops-label-code-preview]");
    if (codeNode) {
      const store = stateApi.getStore(appState);
      codeNode.textContent = utils.buildLabelCode({ sequence: store.sequences.bunchLabel });
    }
    const yieldMeshNode = container.querySelector("[data-ops-yield-mesh-total]");
    if (yieldMeshNode) {
      const total = (utils.parseNumber(ui.yieldMeshDraft?.meshCount) * 25) + utils.parseNumber(ui.yieldMeshDraft?.extraStems);
      yieldMeshNode.textContent = `${utils.number(total)} tallos`;
    }
    const nationalCauseTotalNode = container.querySelector("[data-ops-national-cause-total]");
    if (nationalCauseTotalNode) {
      const resultDraft = ui.classificationResultDraft || {};
      const total = [
        resultDraft.nationalOidioStems,
        resultDraft.nationalVellosoStems,
        resultDraft.nationalBotrytisStems,
        resultDraft.nationalMaltratoStems
      ].reduce((sum, value) => sum + utils.parseNumber(value), 0);
      nationalCauseTotalNode.textContent = utils.number(total);
    }
  }

  function normalizeAutocompleteText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  }

  function visibleClassificationBlockOptions(container) {
    return [...container.querySelectorAll("[data-ops-classification-block-option]")]
      .filter(option => !option.hidden);
  }

  function filterClassificationBlockOptions(container, query) {
    const normalizedQuery = normalizeAutocompleteText(query);
    const options = [...container.querySelectorAll("[data-ops-classification-block-option]")];
    let visible = 0;
    options.forEach(option => {
      const searchable = normalizeAutocompleteText(`${option.dataset.block || ""} ${option.dataset.supplier || ""}`);
      option.hidden = Boolean(normalizedQuery && !searchable.includes(normalizedQuery));
      option.classList.remove("is-active");
      if (!option.hidden) visible += 1;
    });
    const firstVisible = options.find(option => !option.hidden);
    firstVisible?.classList.add("is-active");
    const menu = container.querySelector("[data-ops-classification-block-menu]");
    if (menu) menu.classList.toggle("is-empty", visible === 0);
    return visible;
  }

  function moveClassificationBlockSelection(container, direction) {
    const options = visibleClassificationBlockOptions(container);
    if (!options.length) return null;
    const currentIndex = options.findIndex(option => option.classList.contains("is-active"));
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + options.length) % options.length;
    options.forEach(option => option.classList.remove("is-active"));
    options[nextIndex].classList.add("is-active");
    options[nextIndex].scrollIntoView?.({ block: "nearest" });
    return options[nextIndex];
  }

  function refreshMixedCompositionNodes(container, appState) {
    const draft = stateApi.getUi(appState).mixedBunchIntakeDraft;
    if (!draft) return;
    (draft.lines || []).forEach((line, index) => {
      const supplierNode = container.querySelector(`[data-mixed-line="${index}"] [data-mixed-supplier]`);
      if (supplierNode) supplierNode.value = line.supplier || "Seleccione un bloque";
    });
    const total = (draft.lines || []).reduce((sum, item) => sum + utils.parseNumber(item.stems), 0);
    const expected = utils.parseNumber(draft.expectedStems);
    const totalNode = container.querySelector("[data-mixed-total]");
    const remainingNode = container.querySelector("[data-mixed-remaining]");
    const confirmButton = container.querySelector("[data-mixed-confirm]");
    if (totalNode) totalNode.textContent = utils.number(total);
    if (remainingNode) remainingNode.textContent = utils.number(Math.max(expected - total, 0));
    if (confirmButton) confirmButton.disabled = total !== expected;
  }

  function rerender() {
    BlessERP.layout.renderPage();
  }

  function deferRerender() {
    if (deferredRerenderTimer) clearTimeout(deferredRerenderTimer);
    deferredRerenderTimer = setTimeout(() => {
      deferredRerenderTimer = 0;
      rerender();
    }, 0);
  }

  function selectedParameterVariety(appState) {
    const store = stateApi.getStore(appState);
    const draft = store.ui?.parameterDraft || {};
    if (draft.type !== "varieties" || !draft.id) return null;
    return draft;
  }

  function applyParameterVarietyImageConfirmation(appState, result) {
    const queryRepository = BlessERP.getPostharvestParameterQueryRepository?.();
    const record = result?.serverRecord && queryRepository?.mapRecord
      ? queryRepository.mapRecord(result.serverRecord, "varieties")
      : null;
    if (!record) return null;
    BlessERP.operacionesParametros?.applyCanonicalResult?.(appState, "varieties", {
      ok: true,
      record,
      serverRecord: result.serverRecord
    }, { keepDraft: true });
    return record;
  }

  async function uploadParameterVarietyImage(appState, file) {
    const repository = BlessERP.getVarietyImageRepository?.();
    const variety = selectedParameterVariety(appState);
    if (!repository) {
      stateApi.setNotice(appState, "El repositorio canónico de imágenes no está disponible.", "warning", false);
      return { ok: false };
    }
    const validation = repository.validateImageFile(file);
    if (!validation.ok) {
      stateApi.setNotice(appState, validation.message, "warning", false);
      return { ok: false };
    }
    if (!variety || Number(variety.__syncVersion || 0) < 1) {
      const staged = BlessERP.operacionesParametros?.stagePendingVarietyImage?.(file) || { ok: false };
      stateApi.setNotice(appState,
        staged.ok ? "Fotografía preparada. Pulse GUARDAR para crear la variedad y subir la imagen." : (staged.message || "No se pudo preparar la fotografía."),
        staged.ok ? "info" : "warning",
        false
      );
      return staged;
    }
    stateApi.setNotice(appState, "Optimizando y subiendo la imagen de la variedad...", "info", false);
    const result = await repository.upload(variety, file);
    if (!result.ok) {
      stateApi.setNotice(appState, result.message || "No se pudo guardar la imagen.", "danger", false);
      return result;
    }
    applyParameterVarietyImageConfirmation(appState, result);
    stateApi.setNotice(appState,
      result.cleanupWarning || `Imagen actualizada para ${variety.name}.`,
      result.cleanupWarning ? "warning" : "success",
      false
    );
    return result;
  }

  async function removeParameterVarietyImage(appState) {
    if (BlessERP.operacionesParametros?.pendingVarietyImage?.()?.file) {
      BlessERP.operacionesParametros.clearPendingVarietyImage?.();
      stateApi.setNotice(appState, "Fotografía opcional retirada. La variedad puede guardarse sin imagen.", "info", false);
      return { ok: true, staged: true };
    }
    const repository = BlessERP.getVarietyImageRepository?.();
    const variety = selectedParameterVariety(appState);
    if (!repository || !variety) return { ok: false, message: "No existe una variedad seleccionada." };
    stateApi.setNotice(appState, "Eliminando la imagen de la variedad...", "info", false);
    const result = await repository.remove(variety);
    if (!result.ok) {
      stateApi.setNotice(appState, result.message || "No se pudo eliminar la imagen.", "danger", false);
      return result;
    }
    applyParameterVarietyImageConfirmation(appState, result);
    stateApi.setNotice(appState,
      result.cleanupWarning || `Imagen eliminada de ${variety.name}.`,
      result.cleanupWarning ? "warning" : "success",
      false
    );
    return result;
  }

  function openCommercialDocumentFromDispatch(appState, orderId, docCode) {
    const order = BlessERP.comercialState?.findOrder ? BlessERP.comercialState.findOrder(appState, orderId) : null;
    if (!order || !BlessERP.comercialPrintSystem?.openPreview) return false;

    const options = docCode === "ETIQUETAS"
      ? (BlessERP.comercialLabels?.getCurrentSelection ? BlessERP.comercialLabels.getCurrentSelection(appState) : {})
      : docCode === "COMMERCIAL_INVOICE_CLIENT"
        ? { ...(BlessERP.comercialClientInvoice?.getCurrentOptions ? BlessERP.comercialClientInvoice.getCurrentOptions(appState) : {}), mode: "REFERENCIAL" }
        : {};
    const review = BlessERP.comercialWorkflow?.canExecuteDocumentAction
      ? BlessERP.comercialWorkflow.canExecuteDocumentAction(docCode, order, appState, "print", options)
      : { allowed: true, errors: [] };

    if (!review.allowed) {
      BlessERP.layout.toast(review.errors?.[0] || "El documento no puede imprimirse desde el estado actual del pedido.");
      return false;
    }

    const opened = BlessERP.comercialPrintSystem.openPreview(docCode, [order], appState, {
      autoPrint: true,
      options
    });

    if (opened && BlessERP.comercialWorkflow?.markDocumentActivity) {
      BlessERP.comercialWorkflow.markDocumentActivity(order, appState, docCode, "print", options);
      BlessERP.state.saveDb();
    }

    return opened;
  }

  function render(container, route, appState) {
    let html = "";
    if (route.id !== "operations-bunch-intake") unmountZebraIntakeHid();
    if (route.id !== "operations-dispatch") BlessERP.operacionesCuartoFrioV2?.unmount?.();
    if (route.id !== "operations-labels") BlessERP.operacionesEtiquetas?.unmount?.(container);
    if (!BlessERP.operacionesParametros?.isParameterRoute?.(route.id)) BlessERP.operacionesParametros?.unmount?.();
    const presentationRoute = route.id === "operations-yield-screen";
    document.body.classList.toggle("yield-presentation-route", presentationRoute);
    if (!presentationRoute) BlessERP.operacionesPantallaRendimientos?.unmount?.();
    BlessERP.operacionesRegistrosRendimientos?.unmount?.();
    BlessERP.operacionesRendimientos?.unmount?.();
    if (route.id === "operations-postharvest") {
      const defaultRoute = BlessERP.menuService?.resolveOperationsDefaultRoute?.(appState?.db || appState);
      if (defaultRoute && BlessERP.state.setRoute(defaultRoute)) {
        BlessERP.layout.renderApp();
        return;
      }
      container.replaceChildren();
      return;
    } else if (BlessERP.operacionesParametros?.isParameterRoute?.(route.id)) {
      html = BlessERP.operacionesParametros.render(appState, route);
    } else if (route.id === "operations-reception") {
      html = BlessERP.operacionesRecepcion.render(appState, route);
    } else if (route.id === "operations-grading") {
      html = BlessERP.operacionesClasificacion.render(appState, route);
    } else if (route.id === "operations-labels") {
      html = BlessERP.operacionesEtiquetas.render(appState, route);
    } else if (route.id === "operations-bunch-intake") {
      html = BlessERP.operacionesIngresoRamos.render(appState, route);
    } else if (route.id === "operations-roses-inventory") {
      html = BlessERP.operacionesInventario.render(appState, route);
    } else if (route.id === "operations-availability") {
      html = BlessERP.operacionesDisponibilidad.render(appState, route);
    } else if (route.id === "operations-yields") {
      html = BlessERP.operacionesRendimientos.render(appState, route);
    } else if (presentationRoute) {
      html = BlessERP.operacionesPantallaRendimientos.render(appState, route);
    } else if (route.id === "operations-dispatch") {
      if (BlessERP.performance?.isRouteTransitionPending?.(route.id)) {
        renderDispatchDeferred(container, appState, route);
        return;
      }
      html = BlessERP.operacionesCuartoFrioV2.render(appState, route);
    }

    container.innerHTML = html;
    if (route.id === "operations-dispatch") {
      BlessERP.operacionesCuartoFrioV2.bind(container, appState);
      return;
    }
    if (route.id === "operations-availability") {
      BlessERP.operacionesDisponibilidad.bind(container, appState);
      return;
    }
    bind(container, appState);
    if (route.id === "operations-bunch-intake") mountZebraIntakeHid(container, appState);
    if (BlessERP.operacionesParametros?.isParameterRoute?.(route.id)) BlessERP.operacionesParametros?.mount?.(container, appState);
    if (route.id === "operations-labels") BlessERP.operacionesEtiquetas?.mount?.(container, appState);
    if (presentationRoute) BlessERP.operacionesPantallaRendimientos.mount(container, appState);
    if (route.id === "operations-yields" && stateApi.getUi(appState).yieldsView === "records") {
      BlessERP.operacionesRegistrosRendimientos.mount(appState);
    }
    if (route.id === "operations-yields") BlessERP.operacionesRendimientos.mount(container, appState);
    refreshCalculatedNodes(container, appState);
    const mixedModal = container.querySelector("[data-ops-mixed-composition]");
    const bunchSearchModal = container.querySelector("[data-ops-bunch-search-dialog]");
    if (mixedModal) setTimeout(() => mixedModal.querySelector("select, input[type='number']")?.focus(), 0);
    if (bunchSearchModal) setTimeout(() => bunchSearchModal.querySelector("textarea, button")?.focus(), 0);
    if (route.id === "operations-bunch-intake" && !mixedModal && !bunchSearchModal && !BlessERP.operacionesRamosIngresados?.isOpen?.()) {
      const searchOpen = BlessERP.operacionesIngresoRamos.isSearchPanelOpen();
      const focusTarget = searchOpen ? "[data-ops-bunch-search-scan]" : "[data-ops-bunch-intake-scan]";
      setTimeout(() => container.querySelector(focusTarget)?.focus({ preventScroll: true }), 0);
    }
    if (route.id === "operations-dispatch") {
      setTimeout(() => container.querySelector("[data-ops-dispatch-bunch-scan]:not(:disabled)")?.focus(), 0);
    }
  }

  function bind(container, appState) {
    if (container.dataset.operationsBound === "true") return;
    container.dataset.operationsBound = "true";
    const rerenderSearch = BlessERP.performance?.debounce?.(fieldName => {
      rerender();
      window.setTimeout(() => {
        const target = container.querySelector(`[data-ops-ui-field="${fieldName}"]`);
        target?.focus();
        if (target?.setSelectionRange) target.setSelectionRange(target.value.length, target.value.length);
      }, 0);
    }, 120);

    container.addEventListener("input", event => {
      if (!isOperationsRoute()) return;

      const searchFirstField = event.target.closest("[data-ops-search-field]");
      if (searchFirstField) {
        BlessERP.operacionesReceptionClassificationSearch?.setFilter?.(
          searchFirstField.dataset.opsSearchView,
          searchFirstField.dataset.opsSearchField,
          searchFirstField.value
        );
        return;
      }

      const supplierReportField = event.target.closest("[data-ops-supplier-report-field]");
      if (supplierReportField) {
        BlessERP.operacionesInventarioProveedoresReport?.setSupplierReportFilter?.(
          supplierReportField.dataset.opsSupplierReportField,
          supplierReportField.value
        );
        return;
      }

      const bunchHistoryField = event.target.closest("[data-ops-bunch-history-field]");
      if (bunchHistoryField) {
        BlessERP.operacionesRamosIngresados?.setFilter?.(bunchHistoryField.dataset.opsBunchHistoryField, bunchHistoryField.value);
        return;
      }

      const classificationBlockInput = event.target.closest("[data-ops-classification-block-input]");
      if (classificationBlockInput) {
        const currentDraft = stateApi.getUi(appState).classificationAssignmentDraft || {};
        if (currentDraft.block || currentDraft.supplier || currentDraft.receptionId || currentDraft.receptionItemId) {
          stateApi.beginClassificationAssignmentSearch(appState);
        }
        const supplierDisplay = container.querySelector("[data-ops-classification-supplier-display]");
        if (supplierDisplay) {
          supplierDisplay.value = "Seleccione una coincidencia";
        }
        filterClassificationBlockOptions(container, classificationBlockInput.value);
        return;
      }

      const bunchIntakeScan = event.target.closest("[data-ops-bunch-intake-scan]");
      if (bunchIntakeScan) {
        const code = normalizeBunchSearchInput(bunchIntakeScan.value);
        bunchIntakeScan.value = code;
        if (/^\d{10}$/.test(code)) {
          resetZebraIntakeBuffer();
          enqueueBunchIntakeCode(appState, code);
        }
        return;
      }

      const bunchSearchScan = event.target.closest("[data-ops-bunch-search-scan]");
      if (bunchSearchScan) {
        const code = normalizeBunchSearchInput(bunchSearchScan.value);
        bunchSearchScan.value = code;
        stateApi.getUi(appState).bunchSearchScanCode = code;
        if (!isStructuredBarcode(code) && code.length === 10) {
          resetZebraSearchBuffer();
          stateApi.addBunchToSearch(appState, code);
          rerender();
        } else if (isCompleteStructuredBarcode(code)) {
          resetZebraSearchBuffer();
          stateApi.addBunchToSearch(appState, code);
          rerender();
        }
        return;
      }
      const bunchDeleteReason = event.target.closest("[data-ops-bunch-search-delete-reason]");
      if (bunchDeleteReason) {
        stateApi.getUi(appState).bunchSearchDeleteReason = bunchDeleteReason.value;
        const confirmButton = container.querySelector('[data-ops-action="bunch-search-delete-confirm"]');
        if (confirmButton) confirmButton.disabled = !String(bunchDeleteReason.value || "").trim();
        return;
      }
      const mixedField = event.target.closest("[data-ops-mixed-field]");
      if (mixedField) {
        stateApi.updateMixedBunchCompositionLine(appState, mixedField.dataset.lineIndex, mixedField.dataset.opsMixedField, mixedField.value);
        refreshMixedCompositionNodes(container, appState);
        return;
      }
      const numericOnlyField = event.target.closest("[data-ops-numeric-only]");
      if (numericOnlyField) {
        const sanitizedValue = String(numericOnlyField.value || "").replace(/\D/g, "");
        if (numericOnlyField.value !== sanitizedValue) numericOnlyField.value = sanitizedValue;
      }
      const field = event.target.closest("[data-ops-bind]");
      if (!field) {
        const uiField = event.target.closest("[data-ops-ui-field]");
        if (uiField) {
          if (uiField.dataset.opsUiField === "dispatchFilterSearch") {
            const ui = appState?.db?.operations?.ui || stateApi.getUi(appState);
            ui.dispatchFilterSearch = uiField.value;
            BlessERP.performance?.resetPage?.("operations-cold-room-orders");
            if (rerenderSearch) rerenderSearch("dispatchFilterSearch");
            return;
          }
          if (uiField.dataset.opsUiField.startsWith("dispatchFilter")) return;
          stateApi.setUiValue(appState, uiField.dataset.opsUiField, uiField.value);
          const yieldHistorySearchFields = ["yieldHistoryBuncherSearch", "yieldHistoryClassifierSearch"];
          const inventoryFilterFields = ["roseInventorySearch", "roseInventoryDate"];
          if (["bunchSearchFilter", "bunchSearchTargetLength", ...yieldHistorySearchFields, ...inventoryFilterFields].includes(uiField.dataset.opsUiField)) {
            const shouldRefocusFilter = uiField.dataset.opsUiField === "bunchSearchFilter" || yieldHistorySearchFields.includes(uiField.dataset.opsUiField) || uiField.dataset.opsUiField === "roseInventorySearch";
            if (uiField.dataset.opsUiField === "roseInventorySearch") {
              BlessERP.performance?.resetPage?.("operations-rose-inventory");
            }
            if (shouldRefocusFilter && rerenderSearch) {
              rerenderSearch(uiField.dataset.opsUiField);
              return;
            }
            rerender();
            if (shouldRefocusFilter) setTimeout(() => {
              const selector = `[data-ops-ui-field="${uiField.dataset.opsUiField}"]`;
              const target = container.querySelector(selector);
              target?.focus();
              if (target?.setSelectionRange) target.setSelectionRange(target.value.length, target.value.length);
            }, 0);
          }
        }
        return;
      }
      stateApi.updateDraftField(appState, field.dataset.opsBind, field.dataset.field, field.value);
      refreshCalculatedNodes(container, appState);
    });

    container.addEventListener("change", event => {
      if (!isOperationsRoute()) return;

      const searchFirstField = event.target.closest("[data-ops-search-field]");
      if (searchFirstField) {
        BlessERP.operacionesReceptionClassificationSearch?.setFilter?.(
          searchFirstField.dataset.opsSearchView,
          searchFirstField.dataset.opsSearchField,
          searchFirstField.value
        );
        return;
      }

      const supplierReportField = event.target.closest("[data-ops-supplier-report-field]");
      if (supplierReportField) {
        BlessERP.operacionesInventarioProveedoresReport?.setSupplierReportFilter?.(
          supplierReportField.dataset.opsSupplierReportField,
          supplierReportField.value
        );
        return;
      }

      const bunchHistoryField = event.target.closest("[data-ops-bunch-history-field]");
      if (bunchHistoryField) {
        BlessERP.operacionesRamosIngresados?.setFilter?.(bunchHistoryField.dataset.opsBunchHistoryField, bunchHistoryField.value);
        return;
      }

      const varietyImageInput = event.target.closest("[data-ops-variety-image-input]");
      if (varietyImageInput) {
        const [file] = varietyImageInput.files || [];
        if (file) void uploadParameterVarietyImage(appState, file).finally(() => rerender());
        return;
      }

      const availabilitySetting = event.target.closest("[data-ops-availability-setting]");
      if (availabilitySetting) {
        const value = availabilitySetting.type === "checkbox" ? availabilitySetting.checked : availabilitySetting.value;
        BlessERP.operacionesAvailabilityPolicy?.updateSetting?.(appState, availabilitySetting.dataset.opsAvailabilitySetting, value);
        rerender();
        return;
      }
      const bunchSearchSelection = event.target.closest("[data-ops-bunch-search-select]");
      if (bunchSearchSelection) {
        stateApi.toggleBunchSearchSelection(appState, bunchSearchSelection.dataset.code || "", bunchSearchSelection.checked);
        rerender();
        return;
      }
      const mixedField = event.target.closest("[data-ops-mixed-field]");
      if (mixedField) {
        stateApi.updateMixedBunchCompositionLine(appState, mixedField.dataset.lineIndex, mixedField.dataset.opsMixedField, mixedField.value);
        refreshMixedCompositionNodes(container, appState);
        return;
      }
      const boundField = event.target.closest("[data-ops-bind]");
      if (boundField) {
        stateApi.updateDraftField(appState, boundField.dataset.opsBind, boundField.dataset.field, boundField.value);
        refreshCalculatedNodes(container, appState);
        const classificationAssignmentRelationChanged = boundField.dataset.opsBind === "classificationAssignmentDraft"
          && ["block", "supplier", "variety", "receptionItemId"].includes(boundField.dataset.field);
        const classificationResultRelationChanged = boundField.dataset.opsBind === "classificationResultDraft"
          && ["block", "supplier", "classifier", "variety"].includes(boundField.dataset.field);
        if (
          classificationAssignmentRelationChanged ||
          classificationResultRelationChanged ||
          (boundField.dataset.opsBind === "labelDraft" && ["block", "labelType", "printWidthMm", "printHeightMm"].includes(boundField.dataset.field)) ||
          (boundField.dataset.opsBind === "receptionDraft" && ["supplier", "block"].includes(boundField.dataset.field)) ||
          (boundField.dataset.opsBind === "parameterDraft" && ["type", "employee_id"].includes(boundField.dataset.field))
        ) {
          deferRerender();
        }
        return;
      }
      const uiField = event.target.closest("[data-ops-ui-field]");
      if (!uiField) return;
      stateApi.setUiValue(appState, uiField.dataset.opsUiField, uiField.value);
      if (uiField.dataset.opsUiField.startsWith("dispatchFilter")) {
        BlessERP.performance?.resetPage?.("operations-cold-room-orders");
      }
      if (uiField.dataset.opsUiField.startsWith("receptionHistory")) {
        BlessERP.performance?.resetPage?.("operations-reception-history");
      }
      if (uiField.dataset.opsUiField.startsWith("roseInventory")) {
        BlessERP.performance?.resetPage?.("operations-rose-inventory");
      }
      rerender();
    });

    container.addEventListener("keydown", event => {
      if (!isOperationsRoute()) return;
      const searchFirstField = event.target.closest("[data-ops-search-field]");
      if (searchFirstField && event.key === "Enter") {
        event.preventDefault();
        const view = searchFirstField.dataset.opsSearchView;
        void Promise.resolve(BlessERP.operacionesReceptionClassificationSearch?.query?.(view, 1)).then(() => rerender());
        return;
      }
      const supplierReportField = event.target.closest("[data-ops-supplier-report-field]");
      if (supplierReportField && event.key === "Enter") {
        event.preventDefault();
        void Promise.resolve(BlessERP.operacionesInventarioProveedoresReport?.querySupplierReportPage?.(1)).then(result => {
          stateApi.setNotice(appState, result?.ok ? "Reporte de proveedores actualizado." : (result?.message || "No se pudo consultar el reporte."), result?.ok ? "success" : "warning");
          rerender();
        });
        return;
      }
      const classificationBlockInput = event.target.closest("[data-ops-classification-block-input]");
      if (classificationBlockInput && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        moveClassificationBlockSelection(container, event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (classificationBlockInput && event.key === "Enter") {
        const selected = container.querySelector("[data-ops-classification-block-option].is-active")
          || visibleClassificationBlockOptions(container)[0];
        if (selected) {
          event.preventDefault();
          selected.click();
        }
        return;
      }
      const availabilityPiecesDialog = event.target.closest("[data-ops-availability-pieces-dialog]");
      if (availabilityPiecesDialog && event.key === "Escape") {
        event.preventDefault();
        stateApi.setUiValue(appState, "availabilityPiecesOpen", false);
        rerender();
        return;
      }
      const mixedModal = event.target.closest("[data-ops-mixed-composition]");
      if (mixedModal && event.key === "Escape") {
        event.preventDefault();
        stateApi.cancelMixedBunchIntake(appState);
        rerender();
        return;
      }
      const bunchSearchWorkspace = event.target.closest("[data-ops-bunch-search-workspace]");
      if (bunchSearchWorkspace && event.key === "Escape" && !event.target.closest("[data-ops-bunch-search-dialog]")) {
        event.preventDefault();
        BlessERP.operacionesIngresoRamos.setSearchPanelOpen(false);
        resetZebraSearchBuffer();
        rerender();
        return;
      }
      const bunchSearchDialog = event.target.closest("[data-ops-bunch-search-dialog]");
      if (bunchSearchDialog && event.key === "Escape") {
        event.preventDefault();
        const ui = stateApi.getUi(appState);
        ui.bunchSearchDialog = "";
        ui.bunchSearchDeleteReason = "";
        rerender();
        return;
      }
      if (mixedModal && event.key === "Enter" && event.target.matches("input[type='number'][data-ops-mixed-field='stems']")) {
        event.preventDefault();
        void Promise.resolve(stateApi.confirmMixedBunchIntake(appState)).then(() => rerender());
        return;
      }
      if (captureZebraDispatchKey(event, appState)) return;
      if (captureZebraSearchKey(event, appState)) return;
      const bunchSearchField = event.target.closest("[data-ops-bunch-search-scan]");
      if (bunchSearchField && event.key === "Enter") {
        event.preventDefault();
        if (String(bunchSearchField.value || "").trim()) {
          stateApi.addBunchToSearch(appState, bunchSearchField.value);
          rerender();
        }
        return;
      }
      const meshHistoryCode = event.target.closest("[data-ops-mesh-history-code]");
      if (meshHistoryCode && event.key === "Enter") {
        event.preventDefault();
        stateApi.applyMeshHistoryFilters(appState, "SEARCH");
        rerender();
        return;
      }
    });

    container.addEventListener("click", async event => {
      if (!isOperationsRoute()) return;

      const searchFirstAction = event.target.closest("[data-ops-search-action]");
      if (searchFirstAction) {
        const controller = BlessERP.operacionesReceptionClassificationSearch;
        const view = searchFirstAction.dataset.view;
        const intent = searchFirstAction.dataset.opsSearchAction;
        if (intent === "open") controller?.open?.(view);
        if (intent === "close") controller?.close?.(view);
        if (intent === "query") await controller?.query?.(view, 1);
        if (intent === "page") await controller?.query?.(view, Number(searchFirstAction.dataset.page || 1));
        if (intent === "export") await controller?.exportCurrent?.(appState);
        rerender();
        return;
      }

      if (event.target.matches?.("[data-ops-preview-backdrop]")) {
        stateApi.setUiValue(appState, "dispatchPreviewOrderId", "");
        rerender();
        return;
      }

      const classificationBlockOption = event.target.closest("[data-ops-classification-block-option]");
      if (classificationBlockOption) {
        stateApi.updateDraftField(
          appState,
          "classificationAssignmentDraft",
          "block",
          classificationBlockOption.dataset.block || ""
        );
        rerender();
        setTimeout(() => {
          container.querySelector('[data-ops-bind="classificationAssignmentDraft"][data-field="variety"]')?.focus();
        }, 0);
        return;
      }

      const uiButton = event.target.closest("[data-ops-ui-field][data-value]");
      if (uiButton) {
        stateApi.setUiValue(appState, uiButton.dataset.opsUiField, uiButton.dataset.value);
        rerender();
        return;
      }

      const action = event.target.closest("[data-ops-action]");
      if (!action) return;
      const ui = stateApi.getUi(appState);

      if (action.dataset.opsAction === "bunch-history-open") {
        BlessERP.operacionesRamosIngresados?.open?.();
        resetZebraIntakeBuffer();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-history-close") {
        BlessERP.operacionesRamosIngresados?.close?.();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-history-query") {
        action.disabled = true;
        action.textContent = "Consultando...";
        await BlessERP.operacionesRamosIngresados?.query?.(1);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-history-page") {
        action.disabled = true;
        await BlessERP.operacionesRamosIngresados?.query?.(Number(action.dataset.page || 1));
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-intake-retry") {
        retryBunchIntake(String(action.dataset.operationId || ""));
        return;
      }

      if (action.dataset.opsAction === "parameter-image-select") {
        container.querySelector("[data-ops-variety-image-input]")?.click();
        return;
      }

      if (action.dataset.opsAction === "parameter-image-remove") {
        const variety = selectedParameterVariety(appState);
        const pendingImage = BlessERP.operacionesParametros?.pendingVarietyImage?.()?.file;
        if (!pendingImage && (!variety || !confirm(`¿Eliminar la imagen de ${variety.name}?`))) return;
        action.disabled = true;
        await removeParameterVarietyImage(appState);
        rerender();
        return;
      }

      if (action.dataset.opsAction === "availability-pieces-open") {
        stateApi.setUiValue(appState, "availabilityLastUpdated", new Date().toISOString());
        stateApi.setUiValue(appState, "availabilityPiecesOpen", true);
        rerender();
        return;
      }

      if (action.dataset.opsAction === "availability-pieces-close") {
        stateApi.setUiValue(appState, "availabilityPiecesOpen", false);
        rerender();
        return;
      }

      if (action.dataset.opsAction === "availability-pieces-copy") {
        const ui = stateApi.getUi(appState);
        const rows = BlessERP.operacionesAvailabilityPieces?.getRows?.(appState, {
          variety: ui.availabilityFilterVariety || "TODOS",
          length: ui.availabilityFilterLength || "TODOS"
        }) || [];
        try {
          await BlessERP.operacionesAvailabilityPieces?.copyRows?.(rows);
          const originalLabel = action.textContent;
          action.textContent = "Disponibilidad copiada";
          action.classList.add("is-copied");
          setTimeout(() => {
            action.textContent = originalLabel;
            action.classList.remove("is-copied");
          }, 1800);
          BlessERP.layout.toast(`${rows.length} fila(s) copiadas: pieza, variedad y medida.`);
        } catch (error) {
          BlessERP.layout.toast(error?.message || "No se pudo copiar la disponibilidad.");
        }
        return;
      }

      if (action.dataset.opsAction === "availability-refresh") {
        const result = BlessERP.operacionesAvailabilityPolicy?.synchronizeDueOrders?.(appState, { force: true });
        const message = result?.activated?.length
          ? `${result.activated.length} pedido(s) pasaron a Activo.`
          : "Disponibilidad actualizada; no había pedidos pendientes de activación.";
        BlessERP.layout.toast(message);
        rerender();
        return;
      }

      if (action.dataset.opsAction === "availability-reserve-order" || action.dataset.opsAction === "availability-release-order") {
        const reserve = action.dataset.opsAction === "availability-reserve-order";
        const result = BlessERP.operacionesAvailabilityPolicy?.setFutureReservation?.(
          appState,
          action.dataset.orderId || "",
          reserve
        );
        BlessERP.layout.toast(result?.ok
          ? reserve
            ? "Reserva aplicada. El pedido ya descuenta la disponibilidad."
            : "Reserva liberada. La flor volvió al Disponible Spot."
          : result?.error || "No se pudo actualizar la reserva futura.");
        if (result?.ok) rerender();
        return;
      }

      if (action.dataset.opsAction === "dispatch-preview-close") {
        stateApi.setUiValue(appState, "dispatchPreviewOrderId", "");
        rerender();
        return;
      }

      if (action.dataset.opsAction === "dispatch-preview-order") {
        stateApi.setUiValue(appState, "dispatchPreviewOrderId", action.dataset.orderId || "");
        rerender();
        return;
      }

      if (action.dataset.opsAction === "dispatch-view-detail") {
        stateApi.setUiValue(appState, "selectedDispatchOrderId", action.dataset.orderId || "");
        stateApi.setUiValue(appState, "dispatchPreviewOrderId", "");
        stateApi.setUiValue(appState, "dispatchReturnRoute", "");
        stateApi.setUiValue(appState, "dispatchDetailTab", "boxes");
        const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, action.dataset.orderId || "");
        stateApi.setUiValue(appState, "dispatchAssemblyBoxNumber", fulfillment?.boxes?.find(box => !box.automaticComplete)?.boxNumber || fulfillment?.boxes?.[0]?.boxNumber || 1);
        stateApi.setUiValue(appState, "dispatchLastBunchScan", null);
        stateApi.setUiValue(appState, "dispatchViewMode", "detail");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-back-list") {
        event.preventDefault();
        if (ui.selectedDispatchOrderId) {
          BlessERP.operacionesDispatchDemo?.refreshDispatchProgressDemo?.(appState, ui.selectedDispatchOrderId, {
            action: "GUARDAR_AVANCE_AUTOMATICO"
          });
        }
        stateApi.setUiValue(appState, "dispatchViewMode", "list");
        stateApi.setUiValue(appState, "selectedDispatchOrderId", "");
        stateApi.setUiValue(appState, "dispatchLastBunchScan", null);
        stateApi.setUiValue(appState, "dispatchPreviewOrderId", "");
        stateApi.setUiValue(appState, "dispatchReturnRoute", "");
        resetZebraDispatchBuffer();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-return-order") {
        const returnRoute = String(ui.dispatchReturnRoute || "commercial-order-master");
        stateApi.setUiValue(appState, "dispatchViewMode", "list");
        stateApi.setUiValue(appState, "dispatchReturnRoute", "");
        BlessERP.state.setRoute(returnRoute);
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "dispatch-select-assembly-box") {
        stateApi.setUiValue(appState, "dispatchAssemblyBoxNumber", Number(action.dataset.boxNumber || 1));
        stateApi.setUiValue(appState, "dispatchLastBunchScan", null);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-acknowledge-revision") {
        const dispatch = BlessERP.operacionesDispatchDemo?.getDispatchByOrderDemo?.(appState, action.dataset.orderId);
        const user = dispatch?.responsable_demo || BlessERP.operacionesDispatchDemo?.getDefaultDispatchResponsibleDemo?.(appState) || appState.db.session?.activeUser?.name || "Responsable de despacho";
        const result = BlessERP.comercialOrderFulfillment?.acknowledgeOrderRevision?.(appState, action.dataset.orderId, user);
        if (result?.ok) {
          BlessERP.operacionesDispatchDemo?.refreshDispatchProgressDemo?.(appState, action.dataset.orderId, {
            action: "REVISAR_ACTUALIZACION_PEDIDO"
          });
        }
        BlessERP.layout.toast(result?.ok ? "Actualizacion revisada; el estado de las cajas fue recalculado." : result?.error || "No se pudo revisar la actualizacion.");
        rerender();
        return;
      }

      if (action.dataset.opsAction === "warehouse-open-order-detail") {
        const orderId = action.dataset.orderId || "";
        const fulfillment = BlessERP.comercialOrderFulfillment?.getOrderFulfillment?.(appState, orderId);
        stateApi.setUiValue(appState, "selectedDispatchOrderId", orderId);
        stateApi.setUiValue(appState, "dispatchDetailTab", "boxes");
        stateApi.setUiValue(appState, "dispatchAssemblyBoxNumber", fulfillment?.boxes?.find(box => !box.automaticComplete)?.boxNumber || fulfillment?.boxes?.[0]?.boxNumber || 1);
        stateApi.setUiValue(appState, "dispatchLastBunchScan", null);
        stateApi.setUiValue(appState, "dispatchViewMode", "detail");
        stateApi.setUiValue(appState, "dispatchReturnRoute", "");
        BlessERP.state.setRoute("operations-dispatch");
        BlessERP.layout.renderApp();
        return;
      }

      if (action.dataset.opsAction === "parameter-save") {
        try {
          const parameterForm = action.closest("[data-ops-parameter-form]") || container.querySelector("[data-ops-parameter-form]");
          parameterForm?.querySelectorAll('[data-ops-bind="parameterDraft"][data-field]').forEach(field => {
            stateApi.updateDraftField(appState, "parameterDraft", field.dataset.field, field.value);
          });
          const parameterType = String(stateApi.getUi(appState).parameterDraft?.type || "");
          if (!BlessERP.operacionesParametros?.assertManageType?.(parameterType)) return;
          const canonicalRepository = BlessERP.getPostharvestParameterQueryRepository?.();
          if (canonicalRepository?.isCanonicalEditableType?.(parameterType)) {
            action.disabled = true;
            const pendingImage = parameterType === "varieties"
              ? BlessERP.operacionesParametros?.pendingVarietyImage?.()?.file || null
              : null;
            const result = await BlessERP.operacionesParametros?.saveCanonicalParameter?.(appState, parameterType, {
              keepDraft: Boolean(pendingImage)
            });
            if (result?.ok && pendingImage) {
              const imageResult = await uploadParameterVarietyImage(appState, pendingImage);
              if (imageResult?.ok) {
                BlessERP.operacionesParametros?.clearPendingVarietyImage?.();
                BlessERP.operacionesParametros?.resetCanonicalDraft?.(appState, parameterType);
              } else {
                BlessERP.layout.toast(`Variedad creada, pero la fotografía no pudo guardarse: ${imageResult?.message || "reintente la fotografía"}.`);
                return;
              }
            }
            BlessERP.layout.toast(result?.ok
              ? `Parámetro confirmado por Supabase: ${result.record.name}`
              : (result?.message || "No se pudo confirmar el parámetro en Supabase."));
            return;
          }
          throw new Error("El tipo seleccionado no tiene un contrato canónico explícito.");
        } catch (error) {
          console.error("Error al guardar el parametro de Poscosecha.", error);
          stateApi.setNotice(appState, `No se pudo guardar el parametro: ${error.message || "error inesperado"}.`, "warning");
        } finally {
          rerender();
        }
        return;
      }
      if (action.dataset.opsAction === "parameter-reset") {
        const parameterType = String(stateApi.getUi(appState).parameterDraft?.type || "");
        const canonicalRepository = BlessERP.getPostharvestParameterQueryRepository?.();
        BlessERP.operacionesParametros?.resetCanonicalDraft?.(appState, parameterType);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parameter-edit") {
        const parameterType = String(action.dataset.type || "");
        if (!BlessERP.operacionesParametros?.assertManageType?.(parameterType)) return;
        const canonicalRepository = BlessERP.getPostharvestParameterQueryRepository?.();
        if (!canonicalRepository?.isCanonicalEditableType?.(parameterType)) {
          BlessERP.layout.toast("El tipo seleccionado no tiene un contrato canónico explícito.");
          return;
        }
        BlessERP.operacionesParametros?.editCanonicalParameter?.(appState, parameterType, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parameter-toggle") {
        const parameterType = String(action.dataset.type || "");
        if (!BlessERP.operacionesParametros?.assertManageType?.(parameterType)) return;
        const canonicalRepository = BlessERP.getPostharvestParameterQueryRepository?.();
        if (canonicalRepository?.isCanonicalEditableType?.(parameterType)) {
          action.disabled = true;
          const result = await BlessERP.operacionesParametros?.setCanonicalParameterActive?.(appState, parameterType, action.dataset.id);
          BlessERP.layout.toast(result?.ok
            ? `${result.record.name}: ${result.record.active !== false ? "ACTIVO" : "INACTIVO"}`
            : (result?.message || "No se pudo confirmar el estado en Supabase."));
          rerender();
          return;
        }
        BlessERP.layout.toast("El tipo seleccionado no tiene un contrato canónico explícito.");
        return;
      }
      if (action.dataset.opsAction === "parameter-delete") {
        const parameterType = String(action.dataset.type || "");
        if (!BlessERP.operacionesParametros?.assertManageType?.(parameterType)) return;
        BlessERP.layout.toast("Este catálogo conserva auditoría: use Activar o Desactivar.");
        return;
      }
      if (action.dataset.opsAction === "classification-assignment-save") {
        action.disabled = true;
        const entry = await stateApi.registerClassifierAssignment(appState);
        if (entry && entry.ok === false) BlessERP.layout.toast(entry.message || "La entrega no fue confirmada por Supabase.", { tone: "danger" });
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-assignment-reset") {
        stateApi.resetClassificationAssignmentDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-result-save") {
        const result = await stateApi.registerClassificationResult(appState);
        if (result && result.ok === false) BlessERP.layout.toast(result.message || "El resultado no fue confirmado por Supabase.", { tone: "danger" });
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-result-reset") {
        stateApi.resetClassificationResultDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "classification-export-xlsx") {
        const ui = stateApi.getUi(appState);
        const rows = BlessERP.operacionesClasificacion.getClassificationHistoryRows(appState).filter(item =>
          (!ui.classificationHistoryFrom || String(item.dateTime).slice(0, 10) >= ui.classificationHistoryFrom) &&
          (!ui.classificationHistoryTo || String(item.dateTime).slice(0, 10) <= ui.classificationHistoryTo) &&
          (!ui.classificationHistoryVariety || item.variety === ui.classificationHistoryVariety)
        );
        BlessERP.operacionesClasificacion.exportClassificationXlsx(appState, rows);
        return;
      }
      if (action.dataset.opsAction === "bunch-search-toggle") {
        const searchOpen = BlessERP.operacionesIngresoRamos.setSearchPanelOpen(!BlessERP.operacionesIngresoRamos.isSearchPanelOpen());
        stateApi.getUi(appState).bunchSearchScanCode = "";
        if (searchOpen) resetZebraIntakeBuffer();
        if (!searchOpen) resetZebraSearchBuffer();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-close") {
        BlessERP.operacionesIngresoRamos.setSearchPanelOpen(false);
        resetZebraSearchBuffer();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-select-visible") {
        stateApi.setVisibleBunchSearchRowsSelection(appState, String(action.dataset.codes || "").split(",").filter(Boolean), true);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-view-rendimientos") {
        stateApi.setUiValue(appState, "yieldsView", "rendimientos");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-view-records") {
        stateApi.setUiValue(appState, "yieldsView", "records");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-view-screen") {
        BlessERP.state.setRoute("operations-yield-screen");
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report") {
        stateApi.setUiValue(appState, "meshHistoryOpen", false);
        stateApi.setUiValue(appState, "inventorySupplierReportOpen", true);
        BlessERP.operacionesInventarioProveedoresReport?.openSupplierReport?.();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "rose-inventory-clear-filters") {
        stateApi.setUiValue(appState, "roseInventorySearch", "");
        stateApi.setUiValue(appState, "roseInventorySupplier", "");
        stateApi.setUiValue(appState, "roseInventoryVariety", "");
        stateApi.setUiValue(appState, "roseInventoryBuncher", "");
        stateApi.setUiValue(appState, "roseInventoryDate", "");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report-close") {
        stateApi.setUiValue(appState, "inventorySupplierReportOpen", false);
        BlessERP.operacionesInventarioProveedoresReport?.closeSupplierReport?.();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report-generate") {
        const result = await BlessERP.operacionesInventarioProveedoresReport?.querySupplierReportPage?.(1) || { ok: false, message: "El reporte por proveedor no está disponible." };
        stateApi.setNotice(appState, result.ok ? "Reporte de proveedores actualizado con los filtros seleccionados." : (result.message || "No se pudo consultar el reporte."), result.ok ? "success" : "warning");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report-clear") {
        BlessERP.operacionesInventarioProveedoresReport?.clearSupplierReport?.();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report-sort") {
        const field = action.dataset.sortField || "dateTime";
        await BlessERP.operacionesInventarioProveedoresReport?.sortSupplierReport?.(field);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report-reset-sort") {
        await BlessERP.operacionesInventarioProveedoresReport?.resetSupplierReportSort?.();
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report-page") {
        const page = Math.max(1, Number(action.dataset.page || 1));
        await BlessERP.operacionesInventarioProveedoresReport?.querySupplierReportPage?.(page, { reuseApplied: true });
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-supplier-report-export") {
        action.disabled = true;
        try {
          const result = await BlessERP.operacionesInventarioProveedoresReport?.exportSupplierClassificationXlsx?.(appState) || { ok: false, message: "El reporte por proveedor no esta disponible." };
          if (result.ok) {
            BlessERP.layout.toast(`Excel generado con ${result.report.rows.length} resultado(s) en ${result.sheets.length} hoja(s).`);
          } else {
            stateApi.setNotice(appState, result.message, "warning");
            rerender();
          }
        } catch (error) {
          stateApi.setNotice(appState, `No se pudo generar el reporte por proveedor: ${error.message}`, "warning");
          rerender();
        } finally {
          if (action.isConnected) action.disabled = false;
        }
        return;
      }
      if (action.dataset.opsAction === "mesh-history-toggle") {
        const openingHistory = !stateApi.getUi(appState).meshHistoryOpen;
        stateApi.setUiValue(appState, "meshHistoryOpen", openingHistory);
        if (openingHistory) stateApi.setUiValue(appState, "inventorySupplierReportOpen", false);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-search") {
        stateApi.applyMeshHistoryFilters(appState, "SEARCH");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-clear") {
        stateApi.applyMeshHistoryFilters(appState, "CLEAR");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-today") {
        stateApi.applyMeshHistoryFilters(appState, "TODAY");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-all") {
        stateApi.applyMeshHistoryFilters(appState, "ALL");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-export") {
        const result = BlessERP.operacionesHistorialMallas.exportHistoryXlsx(appState);
        BlessERP.layout.toast(result.ok ? `${result.rows.length} registro(s) exportado(s).` : result.message);
        return;
      }
      if (action.dataset.opsAction === "mesh-history-page") {
        stateApi.setUiValue(appState, "meshHistoryPage", Number(action.dataset.page || 1));
        rerender();
        return;
      }
      if (["mesh-history-detail", "mesh-history-edit", "mesh-history-annul"].includes(action.dataset.opsAction)) {
        const type = action.dataset.opsAction === "mesh-history-detail" ? "DETAIL" : action.dataset.opsAction === "mesh-history-edit" ? "EDIT" : "ANNUL";
        stateApi.openMeshHistoryDialog(appState, type, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-dialog-close") {
        stateApi.closeMeshHistoryDialog(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-edit-save") {
        stateApi.saveMeshHistoryEdit(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mesh-history-annul-confirm") {
        stateApi.annulProcessedMeshHistory(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-deselect-visible") {
        stateApi.setVisibleBunchSearchRowsSelection(appState, String(action.dataset.codes || "").split(",").filter(Boolean), false);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-apply-length") {
        const ui = stateApi.getUi(appState);
        const selectedCount = ui.bunchSearchSelectedCodes.length;
        const targetLength = ui.bunchSearchTargetLength;
        if (!selectedCount || !targetLength) return;
        ui.bunchSearchDialog = "UPDATE";
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-remove") {
        stateApi.removeBunchSearchRows(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-delete") {
        const ui = stateApi.getUi(appState);
        const selectedCount = ui.bunchSearchSelectedCodes.length;
        if (!selectedCount) return;
        ui.bunchSearchDeleteReason = "";
        ui.bunchSearchDialog = "DELETE";
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-update-confirm") {
        const ui = stateApi.getUi(appState);
        const targetLength = ui.bunchSearchTargetLength;
        ui.bunchSearchDialog = "";
        const updated = stateApi.updateBunchSearchLengths(appState, targetLength);
        if (updated?.length) BlessERP.operacionesIngresoRamos.setSearchPanelOpen(false);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-delete-confirm") {
        const ui = stateApi.getUi(appState);
        const reason = ui.bunchSearchDeleteReason;
        ui.bunchSearchDialog = "";
        ui.bunchSearchDeleteReason = "";
        const result = stateApi.deleteBunchSearchRows(appState, reason);
        if (result?.deleted?.length) {
          ui.bunchSearchCodes = [];
          ui.bunchSearchSelectedCodes = [];
          ui.bunchSearchTargetLength = "";
          ui.bunchSearchScanCode = "";
          BlessERP.operacionesIngresoRamos.setSearchPanelOpen(false);
        }
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-search-dialog-cancel") {
        const ui = stateApi.getUi(appState);
        ui.bunchSearchDialog = "";
        ui.bunchSearchDeleteReason = "";
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mixed-bunch-confirm") {
        action.disabled = true;
        await stateApi.confirmMixedBunchIntake(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "mixed-bunch-cancel") {
        stateApi.cancelMixedBunchIntake(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "bunch-report-export-xlsx") {
        const ui = stateApi.getUi(appState);
        try {
          const result = BlessERP.operacionesRamosReportXlsx?.exportBunchReportXlsx?.(appState, {
            from: ui.bunchReportFrom,
            to: ui.bunchReportTo
          }) || { ok: false, message: "El generador XLSX no esta disponible." };
          if (result.ok) {
            BlessERP.layout.toast(`Reporte Excel generado: ${result.report.records.length} ramos en ${result.sheets} hojas.`);
          } else {
            stateApi.setNotice(appState, result.message, "warning");
            rerender();
          }
        } catch (error) {
          stateApi.setNotice(appState, `No se pudo generar el reporte Excel: ${error.message}`, "warning");
          rerender();
        }
        return;
      }

      if (action.dataset.opsAction === "yield-workday-start") {
        const result = stateApi.updateYieldWorkday(appState, "START");
        if (result.ok) BlessERP.layout.toast("Jornada laboral iniciada");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-workday-pause") {
        const result = stateApi.updateYieldWorkday(appState, "PAUSE");
        if (result.ok) BlessERP.layout.toast("Jornada laboral pausada");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-workday-resume") {
        const result = stateApi.updateYieldWorkday(appState, "RESUME");
        if (result.ok) BlessERP.layout.toast("Jornada laboral reanudada");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-workday-close") {
        const summary = stateApi.getYieldWorkdaySummary(appState);
        const confirmed = window.confirm(`Se finalizara la jornada con ${utils.number(summary.totalBunches)} ramos y ${utils.number(summary.totalMeshes)} mallas. Esta accion cierra definitivamente la jornada. ¿Deseas continuar?`);
        if (!confirmed) return;
        const result = stateApi.updateYieldWorkday(appState, "FINISH");
        if (result.ok) BlessERP.layout.toast("Jornada finalizada y resumen guardado");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-mesh-save") {
        const entry = stateApi.registerYieldMeshProcessing(appState);
        if (entry) BlessERP.layout.toast(`Mallas registradas: ${entry.id}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "yield-mesh-reset") {
        stateApi.resetYieldMeshDraft(appState);
        BlessERP.layout.toast("Borrador de mallas procesadas reiniciado");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "save-reception") {
        action.disabled = true;
        const entry = await stateApi.registerReception(appState);
        if (entry?.confirmed === true) BlessERP.layout.toast(`Recepción confirmada en Supabase: ${entry.id}`);
        else if (entry && entry.ok !== false) BlessERP.layout.toast(`Recepción registrada: ${entry.id}`);
        else if (entry) BlessERP.layout.toast(entry.message || "La recepción no fue confirmada por Supabase.", { tone: "danger" });
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-save") {
        stateApi.addOrUpdateReceptionItem(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-reset") {
        stateApi.resetReceptionItemDraft(appState);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-edit") {
        stateApi.editReceptionItem(appState, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-item-delete") {
        stateApi.removeReceptionItem(appState, action.dataset.id);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-edit") {
        BlessERP.operacionesReceptionClassificationSearch?.close?.("receptionHistory");
        stateApi.editReception(appState, action.dataset.id);
        rerender();
        setTimeout(() => container.querySelector("[data-ops-reception-form]")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        return;
      }
      if (action.dataset.opsAction === "clear-reception") {
        stateApi.resetReceptionDraft(appState);
        BlessERP.layout.toast("Borrador de recepcion reiniciado");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "reception-status") {
        action.disabled = true;
        const updated = await stateApi.updateReceptionStatus(appState, action.dataset.id, action.dataset.status);
        if (updated) BlessERP.layout.toast(`Recepción actualizada a ${action.dataset.status}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "review-classification") {
        stateApi.reviewClassification(appState, action.dataset.id);
        BlessERP.layout.toast("Clasificacion demo marcada para cierre con motivo futuro");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "generate-labels") {
        const batch = await stateApi.generateLabelBatch(appState);
        if (batch) {
          BlessERP.layout.toast(`${batch.count} etiqueta(s): ${batch.firstCode} a ${batch.lastCode}. Inventario: 0.`);
          BlessERP.operacionesEtiquetas.printLabels(batch.labels);
        } else {
          BlessERP.layout.toast(stateApi.getUi(appState).notice || "Complete los datos requeridos para generar las etiquetas.");
        }
        rerender();
        return;
      }
      if (action.dataset.opsAction === "label-print-draft") {
        stateApi.setNotice(appState, "Impresion demo preparada. No conecta impresora real ni Zebra.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "label-open-intake") {
        stateApi.updateDraftField(appState, "bunchIntakeDraft", "code", action.dataset.code || "");
        BlessERP.state.setRoute("operations-bunch-intake");
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "clear-label-draft") {
        stateApi.resetLabelDraft(appState);
        BlessERP.layout.toast("Borrador de etiquetas reiniciado");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "label-state") {
        const label = stateApi.getStore(appState).labelBatches.find(item => item.id === action.dataset.id);
        const updatedLabel = await stateApi.updateLabelState(appState, action.dataset.id, action.dataset.status);
        if (action.dataset.status === "REIMPRESA" && updatedLabel) BlessERP.operacionesEtiquetas.printLabels([updatedLabel]);
        BlessERP.layout.toast(updatedLabel ? `Etiqueta marcada como ${action.dataset.status}; inventario sin cambios.` : "No se pudo confirmar la acción de la etiqueta.");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "inventory-state") {
        action.disabled = true;
        const updated = await stateApi.updateInventoryState(appState, action.dataset.id, action.dataset.status);
        BlessERP.layout.toast(updated
          ? `Inventario actualizado a ${action.dataset.status}`
          : "El ramo ya esta asignado a una caja y no puede liberarse manualmente.");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-status") {
        const adapterStatus = BlessERP.operacionesParte1Adapter?.getParte1AdapterStatus?.();
        stateApi.setNotice(
          appState,
          `Adapter Parte 1: ${adapterStatus?.status || "PENDIENTE_INTEGRACION_REAL"} / ${adapterStatus?.mode || "ADAPTADOR_DEMO"} / contratos: ${(adapterStatus?.supported_contracts || []).join(", ") || "sin definir"}.`,
          "info"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-validate") {
        const sampleRaw = BlessERP.operacionesParte1Adapter?.loadInventarioRosasFromParte1?.().rawRows?.[0];
        const review = BlessERP.operacionesParte1Adapter?.validateParte1InventoryPayload?.(sampleRaw);
        stateApi.setNotice(
          appState,
          review?.valid
            ? `Payload demo validado. Errores: 0. Advertencias: ${(review.warnings || []).length}.`
            : `Payload demo con observaciones. Errores: ${(review?.errors || []).length}. Advertencias: ${(review?.warnings || []).length}.`,
          review?.valid ? "info" : "warning"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-map-inventory") {
        const sampleRaw = BlessERP.operacionesParte1Adapter?.loadInventarioRosasFromParte1?.().rawRows?.[0];
        const mapped = BlessERP.operacionesParte1Adapter?.mapParte1InventoryToOperationalInventoryContract?.(sampleRaw);
        stateApi.setNotice(
          appState,
          `Mapeo demo listo: ${mapped?.source_record_id || "-"} -> ${mapped?.inventory_id || "-"} / ${mapped?.variedad || "-"} / ${mapped?.ramos_disponibles || 0} ramos / ${mapped?.estado || "PENDIENTE_SINCRONIZACION"}.`,
          "info"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "parte1-adapter-warnings") {
        const warnings = BlessERP.operacionesParte1Adapter?.getParte1IntegrationWarnings?.() || [];
        stateApi.setNotice(
          appState,
          warnings.length ? `Advertencias del adapter Parte 1: ${warnings.join(" | ")}` : "Sin advertencias configuradas para el adapter Parte 1.",
          "warning"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-reservations") {
        stateApi.setUiValue(appState, "selectedAvailabilityId", action.dataset.id);
        stateApi.setNotice(appState, "La demanda comercial se consulta sin apartar ramos; la asignacion ocurre al leer el ramo dentro del detalle operativo del pedido.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-send-commercial") {
        stateApi.setNotice(appState, "Comercial ya consulta el mismo stock y su demanda proyectada. No se crean reservas de ramos.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-release-reservation") {
        stateApi.releaseAvailabilityReservation(appState, action.dataset.reservationId);
        BlessERP.layout.toast("Reserva demo liberada desde Operaciones.");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "availability-open-commercial") {
        if (action.dataset.orderId) {
          BlessERP.comercialState?.openOrder?.(appState, action.dataset.orderId);
          BlessERP.comercialState?.setOrderTab?.(appState, "availability");
        }
        BlessERP.state.setRoute("commercial-order-master");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-state") {
        stateApi.updateDispatchState(appState, action.dataset.id, action.dataset.status);
        BlessERP.layout.toast(`Despacho demo actualizado a ${action.dataset.status}`);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-link-commercial") {
        stateApi.setNotice(appState, "Conexion preparada: Comercial / Crear pedido -> Cuarto frío.", "info");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-prepare") {
        stateApi.prepareDispatchDemo(appState, action.dataset.orderId);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-ready") {
        stateApi.markDispatchReady(appState, action.dataset.orderId);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-confirm") {
        const dispatch = BlessERP.operacionesDispatchDemo?.getDispatchByOrderDemo?.(appState, action.dataset.orderId);
        const responsible = dispatch?.responsable_demo || BlessERP.operacionesDispatchDemo?.getDefaultDispatchResponsibleDemo?.(appState) || "";
        const result = stateApi.confirmDispatchDemo(appState, action.dataset.orderId, {
          responsable_demo: responsible,
          observacion: "Carga verificada y confirmada en camion."
        });
        BlessERP.layout.toast(result?.ok ? "Carga en camion confirmada." : result?.error || "No se pudo confirmar la carga.");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-observe") {
        const motivo = window.prompt("Motivo de observacion del despacho:", "") || "";
        if (!String(motivo).trim()) return;
        stateApi.observeDispatchDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-cancel") {
        const motivo = window.prompt("Motivo de anulacion demo:", "Anulado desde despacho operativo demo.") || "";
        if (!String(motivo).trim()) return;
        stateApi.cancelDispatchDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-reopen") {
        const motivo = window.prompt("Motivo de reapertura demo:", "Reabierto para revision operativa demo.") || "";
        if (!String(motivo).trim()) return;
        stateApi.reopenDispatchDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-consumption-simulate") {
        stateApi.simulateConsumptionDemo(appState, action.dataset.orderId);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-consumption-reverse") {
        const motivo = window.prompt("Motivo de reverso del consumo demo:", "Reverso demo desde despacho operativo.") || "";
        if (!String(motivo).trim()) return;
        stateApi.reverseConsumptionDemo(appState, action.dataset.orderId, motivo);
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-consumption-kardex") {
        stateApi.setNotice(appState, "Kardex operativo demo visible en Inventario de rosas. No corresponde al inventario real ni contabilidad.", "info");
        BlessERP.state.setRoute("operations-roses-inventory");
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "dispatch-cycle-view") {
        const cycle = BlessERP.operacionesCycleDemo?.getOperationalCycleByOrderDemo?.(appState, action.dataset.orderId || "");
        stateApi.setNotice(
          appState,
          cycle
            ? `Ciclo operativo demo: ${cycle.estado_ciclo || "SIN_INICIAR"} / reservas ${cycle.reservas?.length || 0} / cajas ${cycle.cajas?.length || 0} / consumo ${cycle.consumos?.length || 0} / kardex ${cycle.kardex?.length || 0}.`
            : "Servicio de ciclo operativo demo no disponible.",
          cycle ? "info" : "warning"
        );
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-clear-filters") {
        ["dispatchFilterState", "dispatchFilterOrderDate", "dispatchFilterSearch", "dispatchFilterDestination", "dispatchFilterBrand", "dispatchFilterFlightDate"].forEach(field => {
          stateApi.setUiValue(appState, field, "");
        });
        BlessERP.performance?.resetPage?.("operations-cold-room-orders");
        rerender();
        return;
      }
      if (action.dataset.opsAction === "dispatch-open-order") {
        if (action.dataset.orderId) {
          BlessERP.comercialState?.openOrder?.(appState, action.dataset.orderId);
          BlessERP.comercialState?.setOrderTab?.(appState, "dispatch");
        }
        BlessERP.state.setRoute("commercial-order-master");
        BlessERP.layout.renderApp();
        return;
      }
      if (action.dataset.opsAction === "dispatch-print-doc") {
        openCommercialDocumentFromDispatch(appState, action.dataset.orderId, action.dataset.docCode);
        rerender();
        return;
      }
    });
  }

  function unmount(container) {
    unmountZebraIntakeHid();
    BlessERP.operacionesCuartoFrioV2?.unmount?.();
    BlessERP.operacionesEtiquetas?.unmount?.(container);
    BlessERP.operacionesPantallaRendimientos?.unmount?.();
    BlessERP.operacionesRegistrosRendimientos?.unmount?.();
    BlessERP.operacionesRendimientos?.unmount?.();
  }

  function handleZebraIntakeRealtime(detail = {}) {
    const entities = new Set([
      detail.entity,
      ...(Array.isArray(detail.entities) ? detail.entities : [])
    ].filter(Boolean));
    const relevant = [
      "operations_bunches",
      "operations_bunch_entries",
      "operations_label_batches",
      "operations_rose_inventory",
      "operations_inventory_movements",
      "operations_scanner_events"
    ].some(entity => entities.has(entity));
    if (!relevant) return false;
    zebraIntakeSession.remoteSyncAt = new Date().toISOString();
    publishZebraIntakeState();
    return true;
  }

  function resetZebraIntakeSessionForValidation() {
    unmountZebraIntakeHid();
    zebraIntakeSession.queue.splice(0);
    zebraIntakeSession.pendingCodes.clear();
    zebraIntakeSession.results.splice(0);
    zebraIntakeSession.processing = false;
    zebraIntakeSession.container = null;
    zebraIntakeSession.appState = null;
    zebraIntakeSession.confirmed = 0;
    zebraIntakeSession.errors = 0;
    zebraIntakeSession.activeMutations = 0;
    zebraIntakeSession.maxConcurrentMutations = 0;
    zebraIntakeSession.remoteSyncAt = "";
    zebraIntakeSession.idleWaiters.splice(0).forEach(resolve => resolve(getZebraIntakeSnapshot()));
  }

  BlessERP.operacionesZebraIntakeController = Object.freeze({
    enqueue: enqueueBunchIntakeCode,
    getSnapshot: getZebraIntakeSnapshot,
    handleRealtime: handleZebraIntakeRealtime,
    mount: mountZebraIntakeHid,
    resetForValidation: resetZebraIntakeSessionForValidation,
    retry: retryBunchIntake,
    unmount: unmountZebraIntakeHid,
    waitForIdle: waitForZebraIntakeIdle
  });

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.operaciones = { render, bind, unmount };
})();
