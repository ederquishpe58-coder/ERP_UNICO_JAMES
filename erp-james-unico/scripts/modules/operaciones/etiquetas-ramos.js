(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const codec = BlessERP.bunchLabelCodec;
  const ROW_FIELDS = [
    "color", "variety", "length",
    "block0", "stems0",
    "block1", "stems1",
    "block2", "stems2",
    "block3", "stems3"
  ];
  let rows = [];
  let rowSequence = 0;
  let repeatHeader = false;
  let destinationCustomerId = "";
  let destinationType = "EXPORT";
  let destinationOrderId = "";
  let activeContainer = null;
  let activeAppState = null;
  let lifecycleController = null;
  let batchPrintInProgress = false;
  let connectPromise = null;
  let printerState = { status: "CHECKING", message: "Comprobando Zebra Browser Print...", deviceName: "" };
  let suggestionState = { rowId: "", field: "", items: [], activeIndex: 0 };

  const OUTPUT_STATES = Object.freeze({
    DRAFT: "DRAFT",
    CREATING: "CREATING",
    READY_TO_SEND: "READY_TO_SEND",
    SENDING: "SENDING",
    WAITING_CONFIRMATION: "WAITING_CONFIRMATION",
    ERROR: "ERROR"
  });

  function createRow(seed = {}) {
    const target = Number(seed.target || 25);
    const hasSeedComponents = Array.isArray(seed.components) && seed.components.some(item => item?.provider || item?.block || Number(item?.stems || 0) > 0);
    return {
      id: `zebra-row-${++rowSequence}`,
      quality: BlessERP.flowerQuality?.preserve?.(seed.quality) || "PREMIUM",
      color: seed.color || "",
      variety: seed.variety || "",
      length: seed.length || "",
      target,
      copies: Math.max(1, Math.min(99, Number(seed.copies || 1))),
      nonce: codec.uniqueCode(),
      confirmedLabels: [],
      pendingOperationId: "",
      pendingBunchIds: [],
      outputState: seed.outputState || OUTPUT_STATES.DRAFT,
      outputMessage: seed.outputMessage || "",
      lastOutputMode: seed.lastOutputMode || "",
      outputLocked: false,
      components: Array.from({ length: 4 }, (_, index) => ({
        provider: seed.components?.[index]?.provider || "",
        block: seed.components?.[index]?.block || "",
        stems: seed.components?.[index]?.stems ?? (!hasSeedComponents && index === 0 ? String(target) : ""),
        stemsMode: seed.components?.[index]?.stemsMode || (hasSeedComponents && Number(seed.components?.[index]?.stems || 0) > 0 ? "manual" : (!hasSeedComponents && index === 0 ? "auto" : "empty"))
      }))
    };
  }

  function ensureRows() {
    if (!rows.length) rows = [createRow()];
    return rows;
  }

  function esc(value) {
    return BlessERP.operacionesUtils?.esc?.(value) || String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function storeOf(appState) {
    const resolvedState = appState || activeAppState || BlessERP.state?.state || null;
    return resolvedState ? BlessERP.operacionesState.getStore(resolvedState) : null;
  }

  function activeCompanyId(appState = activeAppState) {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || appState?.db?.activeCompanyId
      || "";
  }

  function localCustomersFor(appState = activeAppState) {
    const companyId = activeCompanyId(appState);
    const customerRows = BlessERP.comercialState?.getCustomerCatalog?.(appState, companyId)
      || appState?.db?.commercial?.customerCatalog
      || [];
    return customerRows
      .filter(item => (!companyId || String(item.companyId || item.company_id || "") === String(companyId))
        && item.active !== false
        && !["INACTIVO", "INACTIVE"].includes(String(item.status || "ACTIVO").trim().toUpperCase())
        && ["LOCAL", "MIXTO"].includes(String(item.category || item.marketType || item.market || "").trim().toUpperCase()))
      .sort((a, b) => String(a.legalName || a.commercialName || a.name || "")
        .localeCompare(String(b.legalName || b.commercialName || b.name || ""), "es"));
  }

  function customerRecordId(customer) {
    return String(customer?.record_id || customer?.recordId || customer?.id || "");
  }

  function destinationValue() {
    return destinationType === "LOCAL" && destinationCustomerId
      ? `LOCAL:${destinationCustomerId}`
      : "EXPORT";
  }

  function parseDestinationValue(value) {
    const raw = String(value || "").trim();
    if (raw.startsWith("LOCAL:") && raw.slice(6)) {
      return { type: "LOCAL", customerId: raw.slice(6), orderId: "", mode: "LOCAL_COMPANY" };
    }
    return { type: "EXPORT", customerId: "", orderId: "", mode: "BLESS_EXPORT" };
  }

  function hasCanonicalLabels(row) {
    return Boolean(Array.isArray(row?.confirmedLabels) && row.confirmedLabels.length && row.confirmedLabels.every(label => label?.id && label?.code));
  }

  function activeMaster(store, type) {
    return (store?.masterData?.[type] || []).filter(item => item.active !== false);
  }

  function buildCatalogs(appState) {
    const store = storeOf(appState);
    const suppliers = activeMaster(store, "suppliers").map(item => ({
      value: codec.supplierCode(item.code || item.name),
      label: `${codec.supplierCode(item.code || item.name)} — ${item.name}`,
      name: item.name,
      block: String(item.assignedBlock || "").trim()
    }));
    const varieties = activeMaster(store, "varieties").map(item => item.name);
    const lengths = activeMaster(store, "lengths").map(item => `${Number(item.name)} CM`).filter(item => !item.startsWith("0 "));
    const buncherColors = activeMaster(store, "bunchers").map(item => item.labelColor || item.color).filter(Boolean);
    const colors = [...new Set(buncherColors.map(codec.text).filter(Boolean))];
    const blocks = [...new Set([
      ...suppliers.map(item => item.block),
      ...(store?.catalogs?.blocks || [])
    ].map(item => codec.text(item)).filter(Boolean))];
    return {
      colors,
      varieties: varieties.length ? varieties : (store?.catalogs?.varieties || []),
      lengths: lengths.length ? lengths : (store?.catalogs?.lengths || []).map(item => `${Number(item)} CM`),
      suppliers,
      blocks
    };
  }

  function catalogs(appState) {
    const companyId = BlessERP.services?.companyContext?.activeCompanyId?.()
      || appState?.db?.activeCompanyId
      || "default";
    return BlessERP.performance?.getCached?.(
      `ops-catalogs:${companyId}`,
      60000,
      () => buildCatalogs(appState)
    ) || buildCatalogs(appState);
  }

  function totalOf(row) {
    return row.components.reduce((sum, item) => sum + Number(item.stems || 0), 0);
  }

  function usedComponents(row) {
    return row.components.filter(item => item.provider || item.block || Number(item.stems || 0) > 0);
  }

  function supplierForBlock(block, appState = activeAppState) {
    const normalizedBlock = codec.text(block);
    if (!normalizedBlock) return null;
    return catalogs(appState).suppliers.find(item => codec.text(item.block) === normalizedBlock) || null;
  }

  function syncComponentProvider(row, componentIndex, appState = activeAppState) {
    const component = row?.components?.[componentIndex];
    if (!component) return null;
    const supplier = supplierForBlock(component.block, appState);
    component.provider = supplier?.value || "";
    return supplier;
  }

  function rebalanceAutomaticStems(row) {
    if (!row?.components?.length) return row;
    const manualIndexes = row.components
      .map((component, index) => component.stemsMode === "manual" && Number(component.stems || 0) > 0 ? index : -1)
      .filter(index => index >= 0);
    const lastManualIndex = manualIndexes.length ? Math.max(...manualIndexes) : -1;
    const manualTotal = row.components.reduce((sum, component) => sum + (component.stemsMode === "manual" ? Number(component.stems || 0) : 0), 0);
    const remaining = Math.max(0, Number(row.target || 0) - manualTotal);
    let automaticIndex = row.components.findIndex((component, index) => index > lastManualIndex && component.stemsMode !== "manual");
    if (automaticIndex < 0 && lastManualIndex < 0) automaticIndex = 0;
    row.components.forEach((component, index) => {
      if (component.stemsMode === "manual") return;
      if (index === automaticIndex && remaining > 0) {
        component.stems = String(remaining);
        component.stemsMode = "auto";
      } else {
        component.stems = "";
        component.stemsMode = "empty";
      }
    });
    return row;
  }

  function statusOf(row) {
    const total = totalOf(row);
    if (total < row.target) return "PENDIENTE";
    if (total > row.target) return "EXCEDIDO";
    return "COMPLETO";
  }

  function typeOf(row) {
    return usedComponents(row).length <= 1 ? "INDIVIDUAL" : "MIXTO";
  }

  function validate(row, appState = activeAppState) {
    const errors = [];
    if (!BlessERP.flowerQuality?.isValid?.(row.quality)) errors.push("calidad canónica");
    if (!String(row.color || "").trim()) errors.push("color");
    if (!String(row.variety || "").trim()) errors.push("variedad");
    if (!Number(String(row.length || "").replace(/\D+/g, ""))) errors.push("medida");
    if (!Number(row.target || 0)) errors.push("tallos objetivo");
    const components = usedComponents(row);
    if (!components.length) errors.push("al menos un componente");
    components.forEach((item, index) => {
      if (!item.block || Number(item.stems || 0) <= 0) errors.push(`componente ${index + 1} incompleto`);
      if (item.block && !item.provider) errors.push(`bloque ${item.block} sin proveedor parametrizado`);
    });
    const total = totalOf(row);
    if (total !== row.target) errors.push(`total ${total}/${row.target}`);
    return { ok: !errors.length, errors, components, total };
  }

  function fieldValue(row, field) {
    const match = /^(provider|block|stems)(\d)$/.exec(field);
    if (match) return row.components[Number(match[2])][match[1]];
    return row[field];
  }

  function setFieldValue(row, field, value) {
    const match = /^(provider|block|stems)(\d)$/.exec(field);
    if (match) {
      const component = row.components[Number(match[2])];
      component[match[1]] = match[1] === "stems" ? String(value).replace(/\D+/g, "").slice(0, 3) : codec.text(value);
      return;
    }
    if (field === "target") row.target = Math.max(1, Number(String(value).replace(/\D+/g, "")) || 25);
    else if (field === "length") row.length = String(value).replace(/[^0-9]/g, "").slice(0, 3);
    else row[field] = codec.text(value);
  }

  function inputCell(row, field, accessibleLabel, className = "") {
    const numeric = field === "target" || field.startsWith("stems");
    const hasCatalog = !numeric;
    const locked = hasCanonicalLabels(row);
    return `<div class="zebra-autocomplete zebra-field-${esc(field.replace(/\d+$/, ""))} ${className}">
      <input ${numeric ? 'inputmode="numeric"' : 'autocomplete="off"'} value="${esc(fieldValue(row, field))}" data-zebra-row="${esc(row.id)}" data-zebra-field="${esc(field)}" aria-label="${esc(accessibleLabel)}"${hasCatalog ? ' aria-autocomplete="list" aria-expanded="false"' : ""}${locked ? " disabled" : ""}>
      <div class="zebra-autocomplete-menu" data-zebra-suggestions="${esc(row.id)}:${esc(field)}" role="listbox" hidden></div>
    </div>`;
  }

  function outputStatusLabel(row) {
    const count = row?.confirmedLabels?.length || 0;
    if (row?.outputState === OUTPUT_STATES.CREATING) return "Creando etiquetas canónicas...";
    if (row?.outputState === OUTPUT_STATES.READY_TO_SEND) return `${count} etiqueta(s) creadas — listas para enviar`;
    if (row?.outputState === OUTPUT_STATES.SENDING) return `Enviando ${count || row.copies} etiqueta(s) a la Zebra...`;
    if (row?.outputState === OUTPUT_STATES.WAITING_CONFIRMATION) return row.outputMessage || "Enviado a impresora — pendiente de confirmar";
    if (row?.outputState === OUTPUT_STATES.ERROR) return row.outputMessage || "No se pudo completar la salida";
    return "";
  }

  function outputStatusTone(row) {
    if (row?.outputState === OUTPUT_STATES.ERROR) return "is-pending";
    if (row?.outputState === OUTPUT_STATES.WAITING_CONFIRMATION) return "is-ready";
    return "is-pending";
  }

  function rowMarkup(row, appState = activeAppState) {
    const total = totalOf(row);
    const status = statusOf(row);
    const type = typeOf(row);
    const validation = validate(row, appState);
    const valid = validation.ok;
    const canonical = hasCanonicalLabels(row);
    const busy = row.outputLocked || [OUTPUT_STATES.CREATING, OUTPUT_STATES.READY_TO_SEND, OUTPUT_STATES.SENDING].includes(row.outputState);
    const outputLabel = outputStatusLabel(row);
    const componentCells = row.components.map((_, index) => `
      <td>${inputCell(row, `block${index}`, `Bloque del componente ${index + 1}`)}</td>
      <td>${inputCell(row, `stems${index}`, `Tallos del componente ${index + 1}`, `is-number${row.components[index].stemsMode === "auto" ? " is-auto-stems" : ""}`)}</td>`).join("");
    return `<tr data-zebra-row-view="${esc(row.id)}">
      <td>${inputCell(row, "color", "Color del embonchador")}</td>
      <td>${inputCell(row, "variety", "Variedad")}</td>
      <td>${inputCell(row, "length", "Medida")}</td>
      <td>${inputCell(row, "target", "Tallos objetivo", "is-number")}</td>
      ${componentCells}
      <td class="zebra-total-cell"><strong data-zebra-total>${total}/${row.target}</strong><span class="zebra-row-status is-${status.toLowerCase()}" data-zebra-status>${status}</span></td>
      <td><strong data-zebra-type>${type}</strong></td>
      <td><div class="zebra-copy-control" aria-label="Cantidad de etiquetas">
        <button type="button" data-zebra-copy-change="-1" data-zebra-copy-row="${esc(row.id)}" aria-label="Reducir etiquetas"${canonical || busy ? " disabled" : ""}>−</button>
        <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${row.copies}" data-zebra-copy-input data-zebra-copy-count data-zebra-copy-row="${esc(row.id)}" aria-label="Cantidad manual de etiquetas"${canonical || busy ? " disabled" : ""}>
        <button type="button" data-zebra-copy-change="1" data-zebra-copy-row="${esc(row.id)}" aria-label="Aumentar etiquetas"${canonical || busy ? " disabled" : ""}>+</button>
      </div><label class="compact-check-field zebra-quality-checkbox"><span>TIPO B</span><input type="checkbox" data-zebra-quality-tipo-b="${esc(row.id)}" ${BlessERP.flowerQuality.isTipoB(row.quality) ? "checked" : ""} ${canonical || busy ? "disabled" : ""}></label><div class="zebra-output-actions">
        <button type="button" class="primary-button zebra-print-row" data-zebra-print="${esc(row.id)}"${busy || batchPrintInProgress ? " disabled" : ""}>${canonical ? "REIMPRIMIR ZEBRA" : "IMPRIMIR ZEBRA"} · ${row.copies}</button>
        <button type="button" class="secondary-button zebra-print-row" data-zebra-pdf="${esc(row.id)}"${busy || batchPrintInProgress ? " disabled" : ""}>${canonical ? "DESCARGAR PDF DE NUEVO" : "DESCARGAR PDF"} · ${row.copies}</button>
        <small class="zebra-output-validation ${valid ? "is-ready" : "is-pending"}" data-zebra-validation>${valid ? "LISTO" : esc(validation.errors.join(" · "))}</small>
        <small class="zebra-output-validation ${outputStatusTone(row)}" data-zebra-output-status${outputLabel ? "" : " hidden"}>${esc(outputLabel)}</small>
      </div></td>
    </tr>`;
  }

  function connectionClass() {
    if (printerState.status === "CONNECTED") return "authorized";
    if (printerState.status === "CHECKING" || printerState.status === "PRINTING") return "partial";
    return "pending";
  }

  function connectionLabel() {
    return {
      CONNECTED: "Zebra conectada",
      DISCONNECTED: "Zebra desconectada",
      NOT_STARTED: "Zebra Browser Print no iniciado",
      CHECKING: "Comprobando Zebra",
      PRINTING: "Imprimiendo",
      ERROR: "Error al imprimir"
    }[printerState.status] || "Zebra desconectada";
  }

  function batchSummary() {
    const waiting = rows.filter(row => row.outputState === OUTPUT_STATES.WAITING_CONFIRMATION).length;
    const errors = rows.filter(row => row.outputState === OUTPUT_STATES.ERROR).length;
    const processing = rows.filter(row => [OUTPUT_STATES.CREATING, OUTPUT_STATES.READY_TO_SEND, OUTPUT_STATES.SENDING].includes(row.outputState)).length;
    const drafts = rows.filter(row => row.outputState === OUTPUT_STATES.DRAFT).length;
    return { waiting, errors, processing, drafts, total: rows.length };
  }

  function batchCanBeConfirmed() {
    return rows.length > 0 && rows.every(row => row.outputState === OUTPUT_STATES.WAITING_CONFIRMATION);
  }

  function render(appState, route) {
    ensureRows();
    const pendingLabels = (storeOf(appState)?.labelBatches || []).filter(item => item.sourceType === "DIGITACION_ETIQUETA_ZEBRA" && item.state === "IMPRESA").length;
    const localCustomers = localCustomersFor(appState);
    const companyId = activeCompanyId(appState);
    const localOrders = (appState?.db?.commercial?.orders || [])
      .filter(order => String(order.customerId || "") === destinationCustomerId
        && (!companyId || String(order.companyId || order.company_id || "") === String(companyId))
        && (String(order.saleType || "").trim().toUpperCase() === "LOCAL"
          || String(order.transportType || "").trim().toUpperCase() === "TERRESTRE")
        && !["ANULADO", "CANCELLED", "DISPATCHED", "DESPACHADO"].includes(String(order.status || "").trim().toUpperCase()))
      .sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")));
    const summary = batchSummary();
    const destinationLocked = batchPrintInProgress || rows.some(hasCanonicalLabels);
    const selectedLocalCustomerAvailable = destinationType !== "LOCAL"
      || localCustomers.some(customer => customerRecordId(customer) === String(destinationCustomerId));
    return `
      <section class="page-header">
        <div><h1>${esc(route.title)}</h1><p>La etiqueta se registra internamente al imprimir; el ramo entra al inventario únicamente cuando se escanea.</p></div>
        <div class="page-header-side"><button type="button" class="primary-button" data-route-link="operations-bunch-intake">ESCÁNER</button></div>
      </section>
      ${BlessERP.operacionesUtils.renderTabs(route)}
      <section class="panel-card zebra-label-station">
        <div class="panel-card-head zebra-label-toolbar">
          <div><p class="section-kicker">IMPRESIÓN DIRECTA</p><h3>Etiquetas para Zebra · 76,2 × 58 mm</h3><p>Los catálogos se leen de Parámetros de Poscosecha. Pendientes de ingresar por escáner: <strong>${pendingLabels}</strong>.</p></div>
          <div class="zebra-connection-box">
            <span class="status-badge ${connectionClass()}" data-zebra-connection-badge>${connectionLabel()}</span>
            <strong data-zebra-device>${esc(printerState.deviceName || "Sin impresora seleccionada")}</strong>
            <small data-zebra-message>${esc(printerState.message)} El PDF de prueba puede descargarse aunque la Zebra esté desconectada.</small>
            <button type="button" class="secondary-button" data-zebra-connect>Comprobar conexión</button>
          </div>
        </div>
        <div class="zebra-label-options">
          <label class="zebra-destination-option">Destino
            <select data-zebra-destination${destinationLocked ? " disabled" : ""}>
              <option value="EXPORT" ${destinationValue() === "EXPORT" ? "selected" : ""}>BLESS / EXPORTACIÓN</option>
              ${destinationType === "LOCAL" && !selectedLocalCustomerAvailable ? `<option value="${esc(destinationValue())}" selected disabled>CLIENTE LOCAL NO DISPONIBLE</option>` : ""}
              ${localCustomers.map(customer => {
                const id = customerRecordId(customer);
                return `<option value="${esc(`LOCAL:${id}`)}" ${destinationValue() === `LOCAL:${id}` ? "selected" : ""}>${esc(customer.legalName || customer.commercialName || customer.name)}</option>`;
              }).join("")}
            </select>
          </label>
          ${destinationType === "LOCAL" ? `<label class="zebra-destination-option">Pedido local (opcional)
            <select data-zebra-destination-order ${destinationCustomerId && !destinationLocked ? "" : "disabled"}><option value="">SIN PEDIDO</option>${localOrders.map(order => `<option value="${esc(order.id)}" ${String(order.id) === destinationOrderId ? "selected" : ""}>${esc(order.number || order.id)}</option>`).join("")}</select>
          </label>` : ""}
          <label class="zebra-repeat-option"><input type="checkbox" data-zebra-repeat ${repeatHeader ? "checked" : ""}> Repetir color, variedad y medida después de imprimir</label>
          <span class="zebra-autocomplete-help">Escriba para filtrar. Enter o Tab confirma. <strong>Ctrl + Shift + +</strong> aumenta copias. <strong>Ctrl + I</strong> imprime el lote.</span>
          <button type="button" class="secondary-button" data-zebra-add-row${destinationLocked ? " disabled" : ""}>+ Nueva fila</button>
          <button type="button" class="primary-button" data-zebra-print-all${batchPrintInProgress ? " disabled" : ""}>${summary.errors ? "Reintentar lote" : "Imprimir todos"}</button>
          <button type="button" class="secondary-button" data-zebra-clear${batchPrintInProgress ? " disabled" : ""}>Limpiar todo</button>
        </div>
        <div class="zebra-label-table-wrap">
          <table class="zebra-label-grid">
            <thead>
              <tr><th rowspan="2">Color embonchador</th><th rowspan="2">Variedad</th><th rowspan="2">Medida</th><th rowspan="2">Tallos objetivo</th><th colspan="2">Componente 1</th><th colspan="2">Componente 2</th><th colspan="2">Componente 3</th><th colspan="2">Componente 4</th><th rowspan="2">Total</th><th rowspan="2">Tipo</th><th rowspan="2">Acción</th></tr>
              <tr>${Array.from({ length: 4 }, () => "<th>Bloque</th><th>Tallos</th>").join("")}</tr>
            </thead>
            <tbody data-zebra-rows>${rows.map(row => rowMarkup(row, appState)).join("")}</tbody>
          </table>
        </div>
        ${summary.waiting ? `<div class="inline-feedback ${summary.errors || !batchCanBeConfirmed() ? "warning" : "success"}" data-zebra-batch-confirmation>
          <strong>${batchCanBeConfirmed() ? "Lote enviado a impresión." : "Envío parcial del lote."}</strong>
          <span>${summary.waiting} fila(s) enviada(s) · ${summary.errors} error(es) · ${summary.drafts} pendiente(s). Browser Print no confirma la salida física del papel.</span>
          <div class="zebra-output-actions">
            ${batchCanBeConfirmed() ? `<button type="button" class="primary-button" data-zebra-confirm-batch>Confirmar lote impreso</button>
            <button type="button" class="secondary-button" data-zebra-reprint-batch>Volver a imprimir</button>` : `<button type="button" class="primary-button" data-zebra-print-all>Reintentar pendientes/error</button>`}
          </div>
        </div>` : ""}
        <div class="inline-feedback info zebra-no-persistence-note"><strong>Flujo seguro:</strong> imprimir registra una ficha pendiente, pero no aumenta existencias. El primer escaneo válido crea el ramo, actualiza disponibilidad y rendimiento, y bloquea duplicados.</div>
      </section>`;
  }

  function updateConnectionDom() {
    if (!activeContainer) return;
    const badge = activeContainer.querySelector("[data-zebra-connection-badge]");
    if (badge) {
      badge.className = `status-badge ${connectionClass()}`;
      badge.textContent = connectionLabel();
    }
    const device = activeContainer.querySelector("[data-zebra-device]");
    if (device) device.textContent = printerState.deviceName || "Sin impresora seleccionada";
    const message = activeContainer.querySelector("[data-zebra-message]");
    if (message) message.textContent = `${printerState.message} El PDF de prueba puede descargarse aunque la Zebra esté desconectada.`;
  }

  async function connect() {
    if (connectPromise) return connectPromise;
    connectPromise = (async () => {
      printerState = { status: "CHECKING", message: "Buscando la impresora predeterminada...", deviceName: "" };
      updateConnectionDom();
      try {
        const device = await BlessERP.zebraBrowserPrint.getDefaultPrinter();
        printerState = { status: "CONNECTED", message: "Lista para recibir ZPL directamente.", deviceName: device.name || device.uid || "Zebra predeterminada" };
        updateConnectionDom();
        return device;
      } catch (error) {
        const notStarted = error?.code === "BROWSER_PRINT_NOT_STARTED" || /no respond|failed to fetch|conectar/i.test(error?.message || "");
        printerState = { status: notStarted ? "NOT_STARTED" : "DISCONNECTED", message: error?.message || "No se encontró una impresora Zebra.", deviceName: "" };
        updateConnectionDom();
        return null;
      }
    })();
    try {
      return await connectPromise;
    } finally {
      connectPromise = null;
    }
  }

  function zplSafe(value) {
    return codec.text(value).replace(/[\^~]/g, " ");
  }

  function buncherCodeFor(row, appState = activeAppState) {
    const store = storeOf(appState);
    const color = codec.text(row?.color);
    const buncher = activeMaster(store, "bunchers")
      .find(item => codec.text(item.labelColor || item.color) === color);
    return zplSafe(buncher?.code || color || "BUN").slice(0, 8);
  }

  function providerBlockFor(row) {
    const components = usedComponents(row);
    const first = components[0] || {};
    const base = `${zplSafe(first.provider)} ${zplSafe(first.block)}`.trim();
    return components.length > 1 ? `${base} +${components.length - 1}` : base;
  }

  function zplBarcodeGraphic(barcode) {
    const encoded = BlessERP.code128?.barcodeBits?.(barcode);
    if (!encoded?.bits) {
      return {
        zpl: `^BY2,2,89\n^FO145,59^BCN,89,N,N,N^FD${barcode}^FS`,
        sourceBarWidth: 0,
        barWidth: 0,
        height: 89,
        width: 319,
        x: 145
      };
    }
    const sourceBarWidth = encoded.moduleCount * 3;
    const barWidth = Math.round(sourceBarWidth * 1.075);
    const quietZone = Math.round(10 * 3 * 1.075);
    const scaledBars = Array.from({ length: barWidth }, (_, index) => (
      encoded.bits[Math.min(encoded.bits.length - 1, Math.floor(index * encoded.bits.length / barWidth))]
    ));
    const pixels = [
      ...Array(quietZone).fill("0"),
      ...scaledBars,
      ...Array(quietZone).fill("0")
    ];
    const bytesPerRow = Math.ceil(pixels.length / 8);
    while (pixels.length < bytesPerRow * 8) pixels.push("0");
    let rowHex = "";
    for (let offset = 0; offset < pixels.length; offset += 8) {
      rowHex += Number.parseInt(pixels.slice(offset, offset + 8).join(""), 2).toString(16).padStart(2, "0").toUpperCase();
    }
    const height = 89;
    const totalBytes = bytesPerRow * height;
    const width = bytesPerRow * 8;
    const x = Math.max(0, Math.round((609 - width) / 2));
    return {
      zpl: `^FO${x},59^GFA,${totalBytes},${totalBytes},${bytesPerRow},${rowHex.repeat(height)}^FS`,
      sourceBarWidth,
      barWidth,
      quietZone,
      height,
      width,
      x
    };
  }

  function zplFor(row, barcode) {
    const variety = zplSafe(row.variety).slice(0, 24);
    const length = Number(String(row.length).replace(/\D+/g, ""));
    const buncherCode = buncherCodeFor(row);
    const providerBlock = zplSafe(providerBlockFor(row)).slice(0, 16);
    const barcodeGraphic = zplBarcodeGraphic(barcode);
    const typeBMarker = BlessERP.flowerQuality?.isTipoB?.(row.quality)
      ? "\n^FO18,175^FB573,1,0,R^A0N,26,24^FDTIPO B^FS"
      : "";
    return `^XA
^CI28
^PW609
^LL464
^LH0,0
^LS0
^LT0
^PON
^FO18,0^FB573,1,0,C^A0N,33,30^FD${variety}^FS
^FO114,34^FB173,1,0,C^A0N,23,21^FD${row.target} STEAMS^FS
^FO287,34^FB81,1,0,C^A0N,23,21^FD${length}CM^FS
^FO368,34^FB127,1,0,C^A0N,23,21^FD${buncherCode}^FS
${barcodeGraphic.zpl}
^FO30,149^A0N,14,13^FD${providerBlock}^FS
^FO150,149^A0N,14,13^FD${barcode}^FS
^FO270,149^A0N,14,13^FDPRODUCT GROWN IN ECUADOR^FS${typeBMarker}
^PQ1,0,1,N
^XZ`;
  }

  function zplBatchFor(row, barcodes = []) {
    return barcodes.map(barcode => zplFor(row, barcode)).join("\n");
  }

  function freshRowAfterBatch(previousRows = rows) {
    const last = previousRows.at(-1);
    const seed = repeatHeader && last
      ? { quality: last.quality, color: last.color, variety: last.variety, length: last.length, target: last.target }
      : { target: last?.target || 25 };
    return createRow(seed);
  }

  function confirmVisualBatch() {
    if (!batchCanBeConfirmed() || batchPrintInProgress) return false;
    const previousRows = [...rows];
    rows = rows.filter(row => row.outputState !== OUTPUT_STATES.WAITING_CONFIRMATION);
    if (!rows.length) rows = [freshRowAfterBatch(previousRows)];
    rerender();
    BlessERP.layout.toast("Lote visual confirmado y limpiado. Las etiquetas canónicas permanecen intactas.");
    return true;
  }

  function clearVisualBatch() {
    if (batchPrintInProgress) return false;
    const hasCreatedLabels = rows.some(hasCanonicalLabels);
    if (hasCreatedLabels) {
      const accepted = window.confirm("Las etiquetas ya creadas no se eliminarán. Solo se limpiará esta pantalla. ¿Desea continuar?");
      if (!accepted) return false;
    }
    const previousRows = [...rows];
    rows = [freshRowAfterBatch(previousRows)];
    rerender();
    return true;
  }

  function barcodesForRow(row, quantity = row?.copies || 1) {
    const copies = Math.max(1, Math.min(99, Number(quantity || 1)));
    const seed = String(row?.nonce || codec.uniqueCode()).split("").reduce((hash, char) => ((hash * 33) + char.charCodeAt(0)) >>> 0, 5381);
    const base = (seed % 90000000) * 100;
    return Array.from({ length: copies }, (_, index) => String((base + index + 1) % 10000000000).padStart(10, "0"));
  }

  function pdfLabelsForRow(row, barcodes = barcodesForRow(row)) {
    const components = usedComponents(row);
    const labelType = components.length > 1 ? "MIXTA" : "NORMAL";
    const localCustomer = destinationType === "LOCAL"
      ? localCustomersFor(activeAppState).find(item => customerRecordId(item) === String(destinationCustomerId))
      : null;
    return barcodes.map(barcode => Object.freeze({
      block: components[0]?.block || "",
      code: barcode,
      compactZebra: true,
      color: row.color,
      colorDay: row.color,
      quality: BlessERP.flowerQuality.normalize(row.quality),
      componentCount: components.length,
      components: components.map(item => ({ ...item })),
      labelType,
      length: Number(String(row.length).replace(/\D+/g, "")),
      destinationType: localCustomer ? "LOCAL" : "EXPORT",
      destinationMode: localCustomer ? "LOCAL_COMPANY" : "BLESS_EXPORT",
      localDestinationCustomerId: customerRecordId(localCustomer),
      localDestinationName: localCustomer?.legalName || localCustomer?.commercialName || localCustomer?.name || "",
      destinationOrderId: localCustomer ? destinationOrderId : "",
      provider: components[0]?.provider || "",
      stemsPerBunch: row.target,
      type: labelType === "MIXTA" ? `MIXTO - ${components.length} COMPONENTES` : "INDIVIDUAL",
      variety: row.variety
    }));
  }

  async function confirmedLabelsForOutput(row, drafts, outputType) {
    const localCustomer = destinationType === "LOCAL"
      ? localCustomersFor(activeAppState).find(item => customerRecordId(item) === String(destinationCustomerId))
      : null;
    if (destinationType === "LOCAL" && !localCustomer) {
      return { ok: false, error: "Seleccione un cliente local activo de la empresa antes de crear las etiquetas.", labels: [] };
    }
    const reusable = Array.isArray(row.confirmedLabels)
      && row.confirmedLabels.length === row.copies
      && row.confirmedLabels.every(label => label?.id && label?.code);
    if (reusable) {
      const reprinted = [];
      for (const label of row.confirmedLabels) {
        label.__pendingReprintOperationId = label.__pendingReprintOperationId
          || BlessERP.getZebraV2Repository?.()?.uuid?.()
          || undefined;
        const confirmed = await BlessERP.operacionesState.updateLabelState(
          activeAppState,
          label.id,
          "REIMPRESA",
          { outputType, operationId: label.__pendingReprintOperationId }
        );
        if (!confirmed) return { ok: false, error: `No se pudo confirmar la reimpresión de ${label.code}.`, labels: [] };
        delete label.__pendingReprintOperationId;
        reprinted.push(confirmed);
      }
      row.confirmedLabels = reprinted;
      return { ok: true, confirmed: true, reprint: true, labels: reprinted, count: reprinted.length };
    }
    const zebraRepository = BlessERP.getZebraV2Repository?.();
    const remoteFlow = zebraRepository?.remoteRequired?.() === true;
    if (remoteFlow) {
      row.pendingOperationId = row.pendingOperationId || zebraRepository.uuid();
      if (!Array.isArray(row.pendingBunchIds) || row.pendingBunchIds.length !== drafts.length) {
        row.pendingBunchIds = drafts.map(() => zebraRepository.uuid());
      }
      drafts = drafts.map((draft, index) => ({
        ...draft,
        bunchId: row.pendingBunchIds[index]
      }));
    }
    const registered = await BlessERP.operacionesState.registerPrintedZebraLabels(
      activeAppState,
      drafts,
      {
        outputType,
        assignNumericCodes: true,
        operationId: row.pendingOperationId || undefined,
        destinationType,
        destinationCustomerId,
        destinationOrderId
      }
    );
    if (registered?.ok) {
      row.confirmedLabels = registered.labels.map(label => ({ ...label }));
      row.pendingOperationId = "";
      row.pendingBunchIds = [];
    }
    return registered;
  }

  function resetPendingIdentity(row) {
    if (!row) return;
    row.confirmedLabels = [];
    row.pendingOperationId = "";
    row.pendingBunchIds = [];
    row.outputState = OUTPUT_STATES.DRAFT;
    row.outputMessage = "";
    row.lastOutputMode = "";
  }

  async function printRow(rowId, outputMode = "ZEBRA", options = {}) {
    const row = rows.find(item => item.id === rowId);
    const validation = row ? validate(row) : { ok: false, errors: ["fila inexistente"] };
    if (!validation.ok) {
      BlessERP.layout.toast(`No se puede imprimir: ${validation.errors.join(", ")}.`);
      refreshRowDom(row);
      return false;
    }
    if (row.outputLocked) return false;
    row.outputLocked = true;
    row.outputState = hasCanonicalLabels(row) ? OUTPUT_STATES.READY_TO_SEND : OUTPUT_STATES.CREATING;
    row.outputMessage = hasCanonicalLabels(row) ? "Reutilizando etiquetas canónicas existentes" : "Creando etiquetas canónicas";
    refreshRowDom(row);
    const drafts = pdfLabelsForRow(row, Array.from({ length: row.copies }, () => ""));
    try {
      if (String(outputMode).toUpperCase() === "PDF" && !BlessERP.labelPdf?.downloadBunchLabels) {
        throw Object.assign(new Error("El generador PDF de etiquetas no está disponible."), { code: "PDF_NOT_AVAILABLE" });
      }
      const registered = await confirmedLabelsForOutput(row, drafts, String(outputMode).toUpperCase());
      if (!registered?.ok) throw Object.assign(new Error(registered?.error || "No se pudo registrar internamente la etiqueta."), { code: "LABEL_REGISTRATION_FAILED" });
      const barcodes = registered.labels.map(label => label.code);
      row.outputState = OUTPUT_STATES.READY_TO_SEND;
      row.outputMessage = `${barcodes.length} etiqueta(s) canónicas listas`;
      refreshRowDom(row);
      if (String(outputMode).toUpperCase() === "PDF") {
        const labelPayloads = drafts.map((draft, index) => ({ ...draft, code: registered.labels[index].code }));
        const downloaded = BlessERP.labelPdf.downloadBunchLabels(labelPayloads);
        if (!downloaded) throw Object.assign(new Error("No se pudo descargar el PDF de etiquetas."), { code: "PDF_DOWNLOAD_FAILED" });
        row.outputState = OUTPUT_STATES.WAITING_CONFIRMATION;
        row.outputMessage = registered.reprint
          ? "PDF de reimpresión descargado — pendiente de confirmar"
          : "PDF descargado — pendiente de confirmar";
        row.lastOutputMode = "PDF";
        return true;
      }
      if (!options.deviceReady) {
        const device = printerState.status === "CONNECTED" ? true : await connect();
        if (!device) throw Object.assign(new Error(printerState.message), { code: "PRINTER_NOT_AVAILABLE" });
      }
      row.outputState = OUTPUT_STATES.SENDING;
      row.outputMessage = `Enviando ${barcodes.length} etiqueta(s) a la Zebra`;
      printerState.status = "PRINTING";
      printerState.message = `Enviando ${barcodes.length} etiqueta(s) ZPL...`;
      refreshRowDom(row);
      updateConnectionDom();
      await BlessERP.zebraBrowserPrint.send(zplBatchFor(row, barcodes));
      printerState.status = "CONNECTED";
      printerState.message = `${barcodes.length} etiqueta(s) enviada(s). Pendiente de confirmación del operador.`;
      row.outputState = OUTPUT_STATES.WAITING_CONFIRMATION;
      row.outputMessage = registered.reprint
        ? "Reimpresión enviada — pendiente de confirmar"
        : "Enviado a impresora — pendiente de confirmar";
      row.lastOutputMode = "ZEBRA";
      updateConnectionDom();
      return true;
    } catch (error) {
      row.outputState = OUTPUT_STATES.ERROR;
      row.outputMessage = error?.message || "Error al imprimir.";
      if (String(outputMode).toUpperCase() === "ZEBRA") {
        printerState.status = "ERROR";
        printerState.message = row.outputMessage;
        updateConnectionDom();
      }
      BlessERP.layout.toast(row.outputMessage);
      return false;
    } finally {
      row.outputLocked = false;
      refreshRowDom(row);
    }
  }

  function suggestionsFor(field, query, appState = activeAppState) {
    const data = catalogs(appState);
    let values = [];
    if (field === "color") values = data.colors.map(value => ({ value, label: value }));
    else if (field === "variety") values = data.varieties.map(value => ({ value, label: value }));
    else if (field === "length") values = data.lengths.map(value => ({ value: String(value).replace(/\D+/g, ""), label: value }));
    else if (field.startsWith("block")) {
      const assigned = data.suppliers.filter(item => item.block).map(item => ({
        value: codec.text(item.block),
        label: `${codec.text(item.block)} — ${item.name}`,
        provider: item.value
      }));
      const assignedBlocks = new Set(assigned.map(item => item.value));
      values = [
        ...assigned,
        ...data.blocks.filter(value => !assignedBlocks.has(codec.text(value))).map(value => ({ value, label: value, provider: "" }))
      ];
    }
    const needle = codec.text(query).replace(/[^A-Z0-9]/g, "");
    return values.map((item, position) => {
      const haystack = codec.text(`${item.value} ${item.label}`).replace(/[^A-Z0-9]/g, "");
      const normalizedSupplier = haystack.replace(/^P0*/, "");
      const normalizedNeedle = needle.replace(/^P0*/, "");
      const starts = !needle || haystack.startsWith(needle) || normalizedSupplier.startsWith(normalizedNeedle);
      const contains = !needle || haystack.includes(needle);
      return { ...item, position, matchRank: starts ? 0 : (contains ? 1 : 2) };
    }).filter(item => item.matchRank < 2)
      .sort((left, right) => left.matchRank - right.matchRank || left.position - right.position)
      .slice(0, 8)
      .map(({ position, matchRank, ...item }) => item);
  }

  function applyInlineFirstMatch(input, item, typedValue) {
    if (!item || !typedValue || !["color", "variety", "length"].includes(input.dataset.zebraField)) return false;
    const typed = codec.text(typedValue);
    const candidate = codec.text(item.value);
    if (!candidate.startsWith(typed) || candidate === typed) return false;
    const row = rows.find(entry => entry.id === input.dataset.zebraRow);
    if (!row) return false;
    setFieldValue(row, input.dataset.zebraField, item.value);
    input.value = fieldValue(row, input.dataset.zebraField);
    try { input.setSelectionRange(String(typedValue).length, String(input.value).length); } catch {}
    refreshRowDom(row);
    return true;
  }

  function showSuggestions(input) {
    const field = input.dataset.zebraField;
    if (field === "target" || field.startsWith("stems")) return hideSuggestions();
    const typedValue = input.value;
    const items = suggestionsFor(field, typedValue);
    suggestionState = { rowId: input.dataset.zebraRow, field, items, activeIndex: 0 };
    const menu = input.parentElement.querySelector("[data-zebra-suggestions]");
    if (!menu) return;
    menu.innerHTML = items.map((item, index) => `<button type="button" role="option" aria-selected="${index === 0 ? "true" : "false"}" class="zebra-suggestion${index === 0 ? " is-active" : ""}" data-zebra-suggestion-index="${index}"><strong>${esc(item.value)}</strong>${item.label !== item.value ? `<small>${esc(item.label.replace(`${item.value} — `, ""))}</small>` : ""}</button>`).join("");
    menu.hidden = !items.length;
    input.setAttribute("aria-expanded", items.length ? "true" : "false");
    applyInlineFirstMatch(input, items[0], typedValue);
  }

  function hideSuggestions() {
    activeContainer?.querySelectorAll("[data-zebra-suggestions]").forEach(menu => { menu.hidden = true; });
    activeContainer?.querySelectorAll('[aria-autocomplete="list"]').forEach(input => input.setAttribute("aria-expanded", "false"));
    suggestionState = { rowId: "", field: "", items: [], activeIndex: 0 };
  }

  function selectSuggestion(input, index = suggestionState.activeIndex) {
    const item = suggestionState.items[index];
    const row = rows.find(entry => entry.id === input.dataset.zebraRow);
    if (!item || !row) return false;
    setFieldValue(row, input.dataset.zebraField, item.value);
    input.value = fieldValue(row, input.dataset.zebraField);
    if (input.dataset.zebraField.startsWith("block")) {
      const componentIndex = Number(input.dataset.zebraField.slice(-1));
      row.components[componentIndex].provider = item.provider || supplierForBlock(item.value)?.value || "";
    }
    hideSuggestions();
    refreshRowDom(row);
    return true;
  }

  function shouldFocusPrint(row, field) {
    return Boolean(row && String(field || "").startsWith("stems") && statusOf(row) === "COMPLETO" && validate(row).ok);
  }

  function nextField(input) {
    const rowId = input.dataset.zebraRow;
    const field = input.dataset.zebraField;
    const row = rows.find(item => item.id === rowId);
    if (shouldFocusPrint(row, field)) {
      activeContainer.querySelector(`[data-zebra-print="${rowId}"]`)?.focus();
      return;
    }
    const position = ROW_FIELDS.indexOf(field);
    const next = position >= 0 && position < ROW_FIELDS.length - 1
      ? activeContainer.querySelector(`[data-zebra-row="${rowId}"][data-zebra-field="${ROW_FIELDS[position + 1]}"]`)
      : activeContainer.querySelector(`[data-zebra-print="${rowId}"]`);
    next?.focus();
  }

  function refreshRowDom(row) {
    if (!row || !activeContainer) return;
    const view = activeContainer.querySelector(`[data-zebra-row-view="${row.id}"]`);
    if (!view) return;
    const status = statusOf(row);
    const total = view.querySelector("[data-zebra-total]");
    if (total) total.textContent = `${totalOf(row)}/${row.target}`;
    const statusNode = view.querySelector("[data-zebra-status]");
    if (statusNode) {
      statusNode.textContent = status;
      statusNode.className = `zebra-row-status is-${status.toLowerCase()}`;
    }
    const type = view.querySelector("[data-zebra-type]");
    if (type) type.textContent = typeOf(row);
    const validation = validate(row);
    const canonical = hasCanonicalLabels(row);
    const busy = row.outputLocked || [OUTPUT_STATES.CREATING, OUTPUT_STATES.READY_TO_SEND, OUTPUT_STATES.SENDING].includes(row.outputState);
    const print = view.querySelector("[data-zebra-print]");
    if (print) {
      print.disabled = busy || batchPrintInProgress;
      print.textContent = `${canonical ? "REIMPRIMIR ZEBRA" : "IMPRIMIR ZEBRA"} · ${row.copies}`;
    }
    const pdf = view.querySelector("[data-zebra-pdf]");
    if (pdf) {
      pdf.disabled = busy || batchPrintInProgress;
      pdf.textContent = `${canonical ? "DESCARGAR PDF DE NUEVO" : "DESCARGAR PDF"} · ${row.copies}`;
    }
    const validationNode = view.querySelector("[data-zebra-validation]");
    if (validationNode) {
      validationNode.textContent = validation.ok ? "LISTO" : validation.errors.join(" · ");
      validationNode.className = `zebra-output-validation ${validation.ok ? "is-ready" : "is-pending"}`;
    }
    const copies = view.querySelector("[data-zebra-copy-count]");
    if (copies) {
      copies.value = String(row.copies);
      copies.disabled = canonical || busy;
    }
    view.querySelectorAll("[data-zebra-copy-change]").forEach(button => { button.disabled = canonical || busy; });
    view.querySelectorAll("[data-zebra-field]").forEach(input => { input.disabled = canonical || busy; });
    view.querySelectorAll("[data-zebra-quality-tipo-b]").forEach(input => {
      input.checked = BlessERP.flowerQuality.isTipoB(row.quality);
      input.disabled = canonical || busy;
    });
    const outputNode = view.querySelector("[data-zebra-output-status]");
    if (outputNode) {
      const label = outputStatusLabel(row);
      outputNode.hidden = !label;
      outputNode.textContent = label;
      outputNode.className = `zebra-output-validation ${outputStatusTone(row)}`;
    }
    row.components.forEach((component, index) => {
      const stemsInput = view.querySelector(`[data-zebra-field="stems${index}"]`);
      if (stemsInput && stemsInput !== document.activeElement) stemsInput.value = component.stems;
      stemsInput?.closest(".zebra-autocomplete")?.classList.toggle("is-auto-stems", component.stemsMode === "auto");
    });
  }

  function rerender() {
    if (!activeContainer || !activeAppState) return;
    const route = BlessERP.state.currentRoute();
    activeContainer.innerHTML = render(activeAppState, route);
  }

  function onInput(event) {
    const copiesInput = event.target.closest("[data-zebra-copy-input]");
    if (copiesInput) {
      const row = rows.find(item => item.id === copiesInput.dataset.zebraCopyRow);
      if (!row || hasCanonicalLabels(row) || row.outputLocked) return;
      const digits = String(copiesInput.value || "").replace(/\D/g, "").slice(0, 2);
      copiesInput.value = digits;
      if (!digits) return;
      row.copies = Math.max(1, Math.min(99, Number(digits)));
      resetPendingIdentity(row);
      refreshRowDom(row);
      return;
    }
    const input = event.target.closest("[data-zebra-field]");
    if (!input) return;
    const row = rows.find(item => item.id === input.dataset.zebraRow);
    if (!row || hasCanonicalLabels(row) || row.outputLocked) return;
    resetPendingIdentity(row);
    setFieldValue(row, input.dataset.zebraField, input.value);
    if (input.dataset.zebraField === "target") {
      rebalanceAutomaticStems(row);
    }
    if (input.dataset.zebraField.startsWith("stems")) {
      const component = row.components[Number(input.dataset.zebraField.slice(-1))];
      component.stemsMode = Number(component.stems || 0) > 0 ? "manual" : "empty";
      rebalanceAutomaticStems(row);
    }
    if (input.dataset.zebraField.startsWith("block")) {
      syncComponentProvider(row, Number(input.dataset.zebraField.slice(-1)));
    }
    if (input.dataset.zebraField === "length" || input.dataset.zebraField === "target" || input.dataset.zebraField.startsWith("stems")) input.value = fieldValue(row, input.dataset.zebraField);
    refreshRowDom(row);
    showSuggestions(input);
  }

  function onKeydown(event) {
    const increaseCopies = event.ctrlKey && event.shiftKey && (event.key === "+" || event.code === "Equal" || event.code === "NumpadAdd");
    if (increaseCopies) {
      const rowView = event.target.closest("[data-zebra-row-view]") || activeContainer?.querySelector("[data-zebra-row-view]");
      const row = rows.find(item => item.id === rowView?.dataset.zebraRowView);
      if (row && !hasCanonicalLabels(row) && !row.outputLocked) {
        event.preventDefault();
        row.copies = Math.min(99, row.copies + 1);
        resetPendingIdentity(row);
        refreshRowDom(row);
        BlessERP.layout.toast(`${row.copies} etiquetas iguales, cada una con código diferente.`);
      }
      return;
    }
    const copiesInput = event.target.closest("[data-zebra-copy-input]");
    if (copiesInput && event.key === "Enter") {
      event.preventDefault();
      const row = rows.find(item => item.id === copiesInput.dataset.zebraCopyRow);
      activeContainer.querySelector(`[data-zebra-print="${row?.id || ""}"]`)?.focus();
      return;
    }
    const input = event.target.closest("[data-zebra-field]");
    if (!input) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key) && suggestionState.items.length) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      suggestionState.activeIndex = (suggestionState.activeIndex + direction + suggestionState.items.length) % suggestionState.items.length;
      input.parentElement.querySelectorAll("[data-zebra-suggestion-index]").forEach((item, index) => {
        const active = index === suggestionState.activeIndex;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (suggestionState.items.length && suggestionState.rowId === input.dataset.zebraRow && suggestionState.field === input.dataset.zebraField) selectSuggestion(input);
      nextField(input);
      return;
    }
    if (event.key === "Tab" && input.value && suggestionState.items.length && suggestionState.rowId === input.dataset.zebraRow && suggestionState.field === input.dataset.zebraField) {
      selectSuggestion(input);
      return;
    }
    if (event.key === "Tab") {
      const row = rows.find(item => item.id === input.dataset.zebraRow);
      if (shouldFocusPrint(row, input.dataset.zebraField)) {
        event.preventDefault();
        activeContainer.querySelector(`[data-zebra-print="${row.id}"]`)?.focus();
      }
    }
  }

  function onClick(event) {
    const suggestion = event.target.closest("[data-zebra-suggestion-index]");
    if (suggestion) {
      const input = suggestion.closest(".zebra-autocomplete").querySelector("[data-zebra-field]");
      selectSuggestion(input, Number(suggestion.dataset.zebraSuggestionIndex));
      nextField(input);
      return;
    }
    const print = event.target.closest("[data-zebra-print]");
    if (print) return void runOutput(print.dataset.zebraPrint, "ZEBRA");
    const pdf = event.target.closest("[data-zebra-pdf]");
    if (pdf) return void runOutput(pdf.dataset.zebraPdf, "PDF");
    if (event.target.closest("[data-zebra-print-all]")) return void printAll();
    if (event.target.closest("[data-zebra-reprint-batch]")) return void reprintBatch();
    if (event.target.closest("[data-zebra-confirm-batch]")) return void confirmVisualBatch();
    const copyChange = event.target.closest("[data-zebra-copy-change]");
    if (copyChange) {
      const row = rows.find(item => item.id === copyChange.dataset.zebraCopyRow);
      if (row && !hasCanonicalLabels(row) && !row.outputLocked) {
        row.copies = Math.max(1, Math.min(99, row.copies + Number(copyChange.dataset.zebraCopyChange || 0)));
        resetPendingIdentity(row);
        refreshRowDom(row);
      }
      return;
    }
    if (event.target.closest("[data-zebra-connect]")) return void connect();
    if (event.target.closest("[data-zebra-add-row]")) {
      if (rows.some(hasCanonicalLabels)) return;
      rows.push(createRow());
      rerender();
      return;
    }
    if (event.target.closest("[data-zebra-clear]")) {
      clearVisualBatch();
    }
  }

  function validateOutputRows(targetRows) {
    const issues = [];
    const localCustomer = destinationType === "LOCAL"
      ? localCustomersFor(activeAppState).find(item => customerRecordId(item) === String(destinationCustomerId))
      : null;
    if (destinationType === "LOCAL" && !localCustomer) issues.push("El destino local no corresponde a un cliente activo de la empresa.");
    targetRows.forEach((row, index) => {
      const validation = validate(row);
      if (!validation.ok) issues.push(`Fila ${index + 1}: ${validation.errors.join(", ")}`);
      if (Number(row.copies || 0) < 1 || Number(row.copies || 0) > 99) issues.push(`Fila ${index + 1}: la cantidad debe estar entre 1 y 99.`);
    });
    return { ok: issues.length === 0, issues };
  }

  async function runRowsOutput(targetRows, outputMode = "ZEBRA") {
    const selectedRows = targetRows.filter(Boolean);
    if (batchPrintInProgress || !selectedRows.length) return false;
    const review = validateOutputRows(selectedRows);
    if (!review.ok) {
      BlessERP.layout.toast(`${review.issues.length} dato(s) requieren corrección antes de iniciar. ${review.issues.slice(0, 2).join(" ")}`);
      selectedRows.forEach(refreshRowDom);
      return false;
    }
    batchPrintInProgress = true;
    rerender();
    try {
      if (String(outputMode).toUpperCase() === "ZEBRA") {
        const device = printerState.status === "CONNECTED" ? true : await connect();
        if (!device) {
          BlessERP.layout.toast(printerState.message);
          return false;
        }
      }
      for (const row of selectedRows) {
        const execute = () => printRow(row.id, outputMode, { deviceReady: String(outputMode).toUpperCase() === "ZEBRA" });
        const completed = await (BlessERP.performance?.measureAsync?.(
          `etiqueta:${String(outputMode || "salida").toLowerCase()}`,
          execute,
          { outputMode, rowId: row.id }
        ) || execute());
        if (!completed) return false;
      }
      return true;
    } catch (error) {
      console.error(`No se pudo generar la salida ${outputMode} de la etiqueta.`, error);
      BlessERP.layout.toast(`No se pudo ${outputMode === "PDF" ? "descargar el PDF" : "imprimir en Zebra"}: ${error?.message || "error inesperado"}.`);
      return false;
    } finally {
      batchPrintInProgress = false;
      rerender();
    }
  }

  async function runOutput(rowId, outputMode) {
    const row = rows.find(item => item.id === rowId);
    return runRowsOutput(row ? [row] : [], outputMode);
  }

  async function printAll() {
    if (batchPrintInProgress) return false;
    if (batchCanBeConfirmed()) {
      BlessERP.layout.toast("El lote ya fue enviado. Use Volver a imprimir o confirme la limpieza visual.");
      return false;
    }
    const review = validateOutputRows(rows);
    if (!review.ok) {
      BlessERP.layout.toast(`${review.issues.length} fila(s)/dato(s) requieren corrección. ${review.issues.slice(0, 2).join(" ")}`);
      rows.forEach(refreshRowDom);
      return false;
    }
    const pendingRows = rows.filter(row => row.outputState !== OUTPUT_STATES.WAITING_CONFIRMATION);
    return runRowsOutput(pendingRows, "ZEBRA");
  }

  async function reprintBatch() {
    if (batchPrintInProgress) return false;
    const printable = rows.filter(row => row.outputState === OUTPUT_STATES.WAITING_CONFIRMATION && hasCanonicalLabels(row));
    return runRowsOutput(printable, "ZEBRA");
  }

  function onChange(event) {
    const qualityCheckbox = event.target.closest("[data-zebra-quality-tipo-b]");
    if (qualityCheckbox) {
      const row = rows.find(item => item.id === qualityCheckbox.dataset.zebraQualityTipoB);
      if (!row || hasCanonicalLabels(row) || row.outputLocked) return;
      row.quality = BlessERP.flowerQuality.fromTipoB(qualityCheckbox.checked);
      resetPendingIdentity(row);
      refreshRowDom(row);
      return;
    }
    if (event.target.matches("[data-zebra-repeat]")) repeatHeader = event.target.checked;
    if (event.target.matches("[data-zebra-destination]")) {
      if (rows.some(hasCanonicalLabels)) {
        BlessERP.layout.toast("Confirme o limpie el lote visual antes de cambiar el destino.");
        rerender();
        return;
      }
      const destination = parseDestinationValue(event.target.value);
      destinationType = destination.type;
      destinationCustomerId = destination.customerId;
      destinationOrderId = destination.orderId;
      rows.forEach(resetPendingIdentity);
      rerender();
    }
    if (event.target.matches("[data-zebra-destination-order]")) {
      destinationOrderId = String(event.target.value || "");
      rows.forEach(resetPendingIdentity);
    }
    const copiesInput = event.target.closest("[data-zebra-copy-input]");
    if (copiesInput) {
      const row = rows.find(item => item.id === copiesInput.dataset.zebraCopyRow);
      if (!row || hasCanonicalLabels(row) || row.outputLocked) return;
      row.copies = Math.max(1, Math.min(99, Number(String(copiesInput.value || "").replace(/\D/g, "")) || 1));
      resetPendingIdentity(row);
      refreshRowDom(row);
    }
  }

  function onFocusIn(event) {
    const copiesInput = event.target.closest("[data-zebra-copy-input]");
    if (copiesInput) {
      copiesInput.select();
      return;
    }
    const input = event.target.closest("[data-zebra-field]");
    if (input) showSuggestions(input);
  }

  function onFocusOut(event) {
    if (event.target.closest("[data-zebra-field]")) setTimeout(() => {
      if (!activeContainer?.querySelector(".zebra-autocomplete:focus-within")) hideSuggestions();
    }, 100);
  }

  function isEditingControl(target) {
    if (!target?.closest) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
  }

  function onScreenShortcut(event) {
    const currentRoute = BlessERP.state?.currentRoute?.();
    const printAllShortcut = event.ctrlKey && !event.shiftKey && !event.altKey && String(event.key || "").toLowerCase() === "i";
    if (!printAllShortcut || currentRoute?.id !== "operations-labels" || !activeContainer || isEditingControl(event.target)) return;
    event.preventDefault();
    if (event.repeat || batchPrintInProgress) return;
    void printAll();
  }

  function abortLifecycle() {
    lifecycleController?.abort?.();
    lifecycleController = null;
  }

  function mount(container, appState) {
    abortLifecycle();
    activeContainer = container;
    activeAppState = appState;
    lifecycleController = new window.AbortController();
    const listenerOptions = { signal: lifecycleController.signal };
    container.addEventListener("input", onInput, listenerOptions);
    container.addEventListener("keydown", onKeydown, listenerOptions);
    container.addEventListener("click", onClick, listenerOptions);
    container.addEventListener("change", onChange, listenerOptions);
    container.addEventListener("focusin", onFocusIn, listenerOptions);
    container.addEventListener("focusout", onFocusOut, listenerOptions);
    window.document.addEventListener("keydown", onScreenShortcut, listenerOptions);
    setTimeout(() => container.querySelector("[data-zebra-field='color']")?.focus({ preventScroll: true }), 0);
    if (printerState.status !== "CONNECTED") connect();
  }

  function unmount(container) {
    if (container && activeContainer !== container) return;
    abortLifecycle();
    hideSuggestions();
    activeContainer = null;
    activeAppState = null;
  }

  const api = BlessERP.operacionesEtiquetas = {
    barcodesForRow,
    batchCanBeConfirmed,
    batchSummary,
    catalogs,
    confirmVisualBatch,
    createRow,
    customerRecordId,
    destinationValue,
    hasCanonicalLabels,
    localCustomersFor,
    mount,
    parseDestinationValue,
    pdfLabelsForRow,
    printAll,
    reprintBatch,
    render,
    statusOf,
    shouldFocusPrint,
    suggestionsFor,
    supplierForBlock,
    rebalanceAutomaticStems,
    totalOf,
    typeOf,
    unmount,
    validate,
    zplBarcodeGraphic,
    zplBatchFor,
    zplFor
  };
  Object.defineProperty(api, "__testing", {
    enumerable: false,
    value: {
      getRows: () => rows,
      getBatchPrintInProgress: () => batchPrintInProgress,
      isEditingControl,
      setDestination(value) {
        const parsed = parseDestinationValue(value);
        destinationType = parsed.type;
        destinationCustomerId = parsed.customerId;
        destinationOrderId = parsed.orderId;
      },
      setRows(nextRows) {
        rows = Array.isArray(nextRows) ? nextRows : [];
      }
    }
  });
})();
