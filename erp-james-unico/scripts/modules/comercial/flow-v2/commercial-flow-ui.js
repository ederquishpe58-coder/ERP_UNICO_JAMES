(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const flow = BlessERP.commercialFlowV2;
  const utils = BlessERP.comercialUtils;
  const trackingBindControllers = new WeakMap();
  let routeSheetPrintInProgress = false;

  function esc(value) {
    return utils?.esc ? utils.esc(value) : String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function upper(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function money(value) {
    return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(number(value));
  }

  function dateLabel(value) {
    if (!value) return "-";
    const [year, month, day] = String(value).slice(0, 10).split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  function toast(message, tone = "info") {
    BlessERP.layout?.toast?.(message, { tone });
  }

  function route(routeId) {
    BlessERP.state.setRoute(routeId);
    BlessERP.layout.renderApp();
  }

  function rerenderPage() {
    BlessERP.layout.renderPage();
  }

  function activeCompanyName(appState) {
    return /IMPERIO/i.test(flow.activeCompanyId(appState)) ? "Imperio Flowers" : "Bless Flower";
  }

  function customerName(appState, id) {
    const row = flow.customerFor(appState, id);
    return row?.legalName || row?.commercialName || "Sin cliente";
  }

  function brandName(appState, id) {
    const row = flow.catalogs(appState).brands.find(item => String(item.id) === String(id));
    return row?.finalClientName || row?.name || "-";
  }

  function brandOptionLabel(row) {
    const name = String(row?.finalClientName || row?.name || "").trim();
    const destination = String(row?.destination || row?.country || "").trim();
    return [name, destination].filter(Boolean).join(" · ");
  }

  function brandForSearchValue(rows, value) {
    const expected = upper(value);
    if (!expected) return null;
    return rows.find(row => upper(brandOptionLabel(row)) === expected)
      || rows.find(row => upper(row?.finalClientName || row?.name) === expected)
      || null;
  }

  function selectedDestinationId(order, destinations) {
    const explicit = String(order?.destinationId || order?.destination_id || "");
    if (destinations.some(row => String(row.id) === explicit)) return explicit;
    const destination = upper(order?.destination);
    const country = upper(order?.destinationCountry);
    return String(destinations.find(row => (
      (destination && upper(row.destination) === destination)
      || (country && upper(row.country || row.destination) === country)
    ))?.id || "");
  }

  function options(rows, selected, label, empty = "Seleccione") {
    return `<option value="">${esc(empty)}</option>${rows.map(row => `<option value="${esc(row.id)}" ${String(row.id) === String(selected) ? "selected" : ""}>${esc(label(row))}</option>`).join("")}`;
  }

  function textOptions(values, selected, empty = "Seleccione") {
    return `<option value="">${esc(empty)}</option>${values.map(value => `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(value)}</option>`).join("")}`;
  }

  function catalogValue(row) {
    if (row && typeof row === "object") return String(row.name ?? row.value ?? row.code ?? "").trim();
    return String(row ?? "").trim();
  }

  function boxTypeValue(row) {
    if (row && typeof row === "object") return String(row.code ?? row.name ?? row.value ?? "").trim().toUpperCase();
    return String(row ?? "").trim().toUpperCase();
  }

  function catalogOptions(rows, selected, empty = "Seleccione") {
    const configured = rows.map(catalogValue).filter(Boolean);
    const values = [...new Set([...configured, catalogValue(selected)].filter(Boolean))];
    return textOptions(values, selected, empty);
  }

  function openMixLengthOptions(rows, selected, anyLength) {
    const anyLengthValue = BlessERP.comercialBoxBuilder.ANY_LENGTH;
    const configured = rows.map(catalogValue).filter(Boolean);
    const values = [...new Set([...configured, anyLength ? "" : catalogValue(selected)].filter(Boolean))];
    return `<option value="">Seleccione medida</option><option value="${esc(anyLengthValue)}" ${anyLength ? "selected" : ""}>CUALQUIER MEDIDA</option>${values.map(value => `<option value="${esc(value)}" ${!anyLength && String(value) === String(selected) ? "selected" : ""}>${esc(value)}</option>`).join("")}`;
  }

  function qualityOptions(selected) {
    return BlessERP.flowerQuality?.options?.(selected, { placeholder: "Seleccione calidad" }) || '<option value="">Seleccione calidad</option>';
  }

  function varietyImageUrl(appState, varietyName) {
    const store = BlessERP.operacionesState?.getStore?.(appState);
    const normalized = upper(varietyName);
    const variety = (store?.masterData?.varieties || []).find(item => upper(item?.name) === normalized);
    const imagePath = String(variety?.imagePath || "").trim();
    if (imagePath) return BlessERP.getVarietyImageRepository?.()?.publicUrl?.(imagePath) || "";
    const existing = String(variety?.imageUrl || variety?.photoUrl || variety?.image || variety?.photo || "").trim();
    return /^(https?:\/\/|blob:|data:image\/)/i.test(existing) ? existing : "";
  }

  function varietyInitials(value) {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "FL").toUpperCase();
  }

  function varietyIdentity(appState, varietyName) {
    const name = String(varietyName || "Sin variedad");
    const imageUrl = varietyImageUrl(appState, name);
    const visual = imageUrl
      ? `<img class="erp-variety-thumb" src="${esc(imageUrl)}" alt="Fotografía de ${esc(name)}" loading="lazy" decoding="async">`
      : `<span class="erp-variety-thumb erp-variety-placeholder" aria-hidden="true">${esc(varietyInitials(name))}</span>`;
    return `<div class="erp-variety-cell">${visual}<span class="erp-variety-copy"><strong>${esc(name)}</strong></span></div>`;
  }

  function orderTotals(order) {
    const boxes = flow.boxNumbers(order).length;
    const bunches = (order.lines || []).reduce((sum, line) => sum + number(line.bunches), 0);
    const stems = (order.lines || []).reduce((sum, line) => sum + number(line.bunches) * number(line.stemsPerBunch), 0);
    const economics = utils.calculateOrderEconomics(order);
    return { boxes, bunches, stems, total: economics.netTotal, ...economics };
  }

  function orderHeader(order, appState) {
    const totals = orderTotals(order);
    const local = flow.isLocalOrder(order, appState);
    const usesInventory = flow.orderUsesInventory(order);
    return `<section class="commercial-v2-order-strip">
      <div><span>Pedido</span><strong>${esc(order.number || "Se asigna al guardar")}</strong></div>
      <div><span>Factura</span><strong>${esc(BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order) || "Se asigna al guardar")}</strong></div>
      <div><span>Mercado</span><strong>${local ? "LOCAL" : "EXPORTACIÓN"}</strong></div>
      <div><span>Operación</span><strong>${usesInventory ? "CON INVENTARIO" : "SIN INVENTARIO"}</strong></div>
      <div><span>Cajas</span><strong>${totals.boxes}</strong></div>
      <div><span>Ramos</span><strong>${totals.bunches}</strong></div>
      <div><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
      <div><span>Descuento</span><strong>${totals.discountPercentage}% · ${money(totals.discountAmount)}</strong></div>
      <div><span>Total neto</span><strong>${money(totals.netTotal)}</strong></div>
    </section>`;
  }

  function orderFields(order, appState) {
    const catalogs = flow.catalogs(appState);
    const local = flow.isLocalOrder(order, appState);
    const transport = upper(utils.normalizeTransportType?.(order.transportType) || order.transportType || "AEREO");
    const maritime = transport === "MARITIMO";
    const sellers = flow.salesRepresentatives?.(appState) || [];
    const sellerEditable = Boolean(order.unsavedDraft && flow.canAssignSalesRepresentative?.(appState));
    const brands = catalogs.brands.filter(row => !order.customerId || String(row.customerId) === String(order.customerId));
    const selectedBrand = brands.find(row => String(row.id) === String(order.brandId));
    const destinations = catalogs.destinations || [];
    const destinationId = selectedDestinationId(order, destinations);
    const daes = catalogs.daes.filter(row => !order.destinationCountry || upper(row.country || row.destination) === upper(order.destinationCountry));
    return `<section class="panel-card commercial-v2-section commercial-v2-buyer-section erp-page-card">
      <div class="panel-card-head commercial-v2-buyer-head">
        <div><p class="section-kicker">DATOS DEL COMPRADOR</p><h3>Cliente, marca y logística</h3></div>
        <span class="status-badge commercial-v2-market-badge ${local ? "partial" : "authorized"}">${local ? "VENTA LOCAL" : "EXPORTACIÓN"}</span>
      </div>
      <div class="commercial-v2-buyer-body">
        <section class="commercial-v2-buyer-group" aria-label="Información comercial del pedido">
          <div class="commercial-v2-buyer-group-head"><strong>Cliente</strong><span>Información comercial del pedido</span></div>
          <div class="commercial-v2-buyer-grid commercial-v2-buyer-grid-client">
            <label><span class="commercial-v2-field-label">Cliente principal</span><select data-order-field="customerId">${options(catalogs.customers, order.customerId, row => row.legalName || row.commercialName)}</select></label>
            <label><span class="commercial-v2-field-label">Cliente final / marca / marcación</span><input value="${esc(selectedBrand ? brandOptionLabel(selectedBrand) : "")}" data-order-brand-search list="commercial-v2-brand-options" autocomplete="off" placeholder="${local ? "Opcional · escriba para buscar" : "Escriba para buscar"}"><datalist id="commercial-v2-brand-options">${brands.map(row => `<option value="${esc(brandOptionLabel(row))}"></option>`).join("")}</datalist><input type="hidden" value="${esc(order.brandId || "")}" data-order-field="brandId"><small class="commercial-v2-field-help">Guarda únicamente la marca canónica seleccionada; no crea registros nuevos.</small></label>
            <label><span class="commercial-v2-field-label">Tipo de venta</span><select data-order-field="saleType"><option value="EXPORTACION" ${!local ? "selected" : ""}>EXPORTACIÓN</option><option value="LOCAL" ${local ? "selected" : ""}>LOCAL</option></select></label>
            <label><span class="commercial-v2-field-label">Vendedor / Sales Representative</span><select data-order-field="sellerId" ${sellerEditable ? "" : "disabled"}><option value="">${order.unsavedDraft ? "Seleccione vendedor" : "Vendedor no registrado"}</option>${sellers.map(row => `<option value="${esc(row.sellerId || row.employeeId)}" ${String(row.sellerId || row.employeeId) === String(order.seller_id || order.sellerId) ? "selected" : ""}>${esc(row.fullName || row.name)}</option>`).join("")}${!sellers.length && order.seller_name ? `<option value="${esc(order.seller_id || order.sellerId)}" selected>${esc(order.seller_name)}</option>` : ""}</select><small class="commercial-v2-field-help">${order.unsavedDraft ? "Se guarda por Employee V2 y queda congelado al crear el pedido." : esc(order.seller_name || order.sellerName || "Vendedor no registrado")}</small></label>
            <label><span class="commercial-v2-field-label">Manejo de inventario</span><select data-order-field="inventoryMode"><option value="WITH_INVENTORY" ${flow.orderUsesInventory(order) ? "selected" : ""}>CON INVENTARIO</option><option value="NO_INVENTORY" ${!flow.orderUsesInventory(order) ? "selected" : ""}>VENTA SIN INVENTARIO</option></select><small class="commercial-v2-field-help" data-inventory-mode-help>${flow.orderUsesInventory(order) ? "Compromete disponibilidad y puede enviarse a Cuarto Frío." : "Solo historial, documentos SRI, invoices y etiquetas; no afecta disponibilidad."}</small></label>
          </div>
        </section>
        <section class="commercial-v2-buyer-group" aria-label="Logística del pedido">
          <div class="commercial-v2-buyer-group-head"><strong>Logística</strong><span>Fechas, transporte y documentación de salida</span></div>
          <div class="commercial-v2-buyer-grid commercial-v2-buyer-grid-logistics">
            <label><span class="commercial-v2-field-label">Fecha de emisión</span><input type="date" value="${esc(order.issuedAt)}" data-order-field="issuedAt"></label>
            <label><span class="commercial-v2-field-label">Fecha de vuelo / salida</span><input type="date" value="${esc(order.flightDate)}" data-order-field="flightDate"></label>
            <label><span class="commercial-v2-field-label">Transporte</span><select data-order-field="transportType"><option value="aereo" ${upper(order.transportType) === "AEREO" ? "selected" : ""}>AÉREO</option><option value="maritimo" ${upper(order.transportType) === "MARITIMO" ? "selected" : ""}>MARÍTIMO</option><option value="terrestre" ${upper(order.transportType) === "TERRESTRE" ? "selected" : ""}>TERRESTRE</option></select></label>
            ${maritime
              ? `<label><span class="commercial-v2-field-label">Destino</span><select data-order-field="destinationId">${options(destinations, destinationId, row => [row.destination, row.country].filter(Boolean).join(" · "), "Seleccione destino canónico")}</select><small class="commercial-v2-field-help">Catálogo canónico de destinos activos.</small></label>`
              : `<label><span class="commercial-v2-field-label">País</span><input value="${esc(order.destinationCountry || (local ? "ECUADOR" : ""))}" data-order-field="destinationCountry" ${local ? "readonly" : ""}></label>`}
            <label><span class="commercial-v2-field-label">DAE</span><select data-order-field="daeNumber" ${local ? "disabled" : ""}><option value="">${local ? "No aplica / opcional" : maritime ? "DAE pendiente · puede registrarse después" : "Seleccione DAE"}</option>${daes.map(row => `<option value="${esc(row.number)}" ${String(row.number) === String(order.daeNumber) ? "selected" : ""}>${esc(row.number)} · ${esc(row.country || row.destination)}</option>`).join("")}</select><small class="commercial-v2-field-help">${maritime && !order.daeNumber ? "La coordinación marítima puede continuar. SRI permanecerá pendiente de la DAE fiscal real." : ""}</small></label>
            <label><span class="commercial-v2-field-label">Agencia de carga</span><select data-order-field="agencyId"><option value="">${local ? "Retira en finca / opcional" : "Seleccione"}</option>${catalogs.agencies.map(row => `<option value="${esc(row.id)}" ${String(row.id) === String(order.agencyId) ? "selected" : ""}>${esc(row.name)}</option>`).join("")}</select></label>
            <label><span class="commercial-v2-field-label">Aerolínea</span><select data-order-field="airlineId" ${transport === "AEREO" ? "" : "disabled"}><option value="">${transport !== "AEREO" ? "No aplica" : order.awb ? "Prefijo no configurado" : "Opcional"}</option>${catalogs.airlines.map(row => `<option value="${esc(row.id)}" ${String(row.id) === String(order.airlineId) ? "selected" : ""}>${esc(row.awbPrefix)} · ${esc(row.name)}</option>`).join("")}</select><small class="commercial-v2-field-help" data-airline-prefix-help>${transport !== "AEREO" ? "No se infiere aerolínea para transporte marítimo o terrestre." : order.airlineId ? "Detectada automáticamente desde la guía madre." : "Se reconoce con los tres primeros caracteres de la guía madre."}</small></label>
      <label><span class="commercial-v2-field-label">${transport === "AEREO" ? "MAWB / guía madre" : "Guía madre"}</span><input value="${esc(order.awb)}" data-order-field="awb" placeholder="${local ? "Opcional en ventas locales" : maritime ? "ABC123 o MAR-00048904" : transport === "AEREO" ? "014-12345678" : "Referencia logística"}" ${maritime ? 'required maxlength="14" pattern="[A-Za-z0-9-]{1,14}" aria-required="true"' : ""}><small class="commercial-v2-field-help">${transport === "AEREO" ? "Prefijo alfanumérico de 3 caracteres y 8 dígitos." : maritime ? "Referencia alfanumérica de máximo 14 caracteres; el guion y MAR son opcionales." : "La exportación terrestre permanece pendiente hasta definir su regla."}</small></label>
            <label><span class="commercial-v2-field-label">${transport === "AEREO" ? "HAWB / guía hija" : "Guía hija"}</span><input value="${esc(order.hawb)}" data-order-field="hawb" placeholder="${maritime ? "BL-8899" : "HF-001"}"></label>
          </div>
        </section>
        <section class="commercial-v2-buyer-group commercial-v2-buyer-group-additional" aria-label="Información adicional del pedido">
          <div class="commercial-v2-buyer-group-head"><strong>Información adicional</strong><span>Datos complementarios de operación</span></div>
          <div class="commercial-v2-buyer-grid commercial-v2-buyer-grid-additional">
            <label><span class="commercial-v2-field-label">Cuarto frío</span><input value="${esc(order.coldRoom || (local ? "RETIRA EN FINCA" : ""))}" data-order-field="coldRoom"></label>
            <label><span class="commercial-v2-field-label">PO manual del cliente</span><input value="${esc(order.generalPo)}" data-order-field="generalPo" placeholder="Solo si el cliente lo solicita"><small class="commercial-v2-field-help">Solo si el cliente lo solicita</small></label>
            <label><span class="commercial-v2-field-label">Descuento (%)</span><input type="number" min="0" max="100" step="0.01" value="${esc(order.discountPercentage ?? 0)}" data-order-field="discountPercentage"><small class="commercial-v2-field-help">Opcional. Vacío equivale a 0% y aplica al total del pedido.</small></label>
          </div>
        </section>
      </div>
    </section>`;
  }

  function manualItems(boxDraft, catalogs) {
    if (upper(boxDraft.mode) !== "MIXTO_MANUAL") return "";
    return `<div class="commercial-v2-mix-items">
      ${(boxDraft.manualItems || []).map((item, index) => `<div class="commercial-v2-mix-row" data-excel-row>
        <strong>${index + 1}</strong>
        <select data-box-item="${esc(item.id)}" data-box-item-field="variety" data-excel-cell aria-label="Variedad">${catalogOptions(catalogs.varieties || [], item.variety, "Variedad")}</select>
        <select data-box-item="${esc(item.id)}" data-box-item-field="quality" data-excel-cell aria-label="Calidad">${qualityOptions(item.quality)}</select>
        <select data-box-item="${esc(item.id)}" data-box-item-field="length" data-excel-cell aria-label="Medida">${catalogOptions(catalogs.lengths || [], item.length, "Medida")}</select>
        <input type="number" value="${esc(item.bunches)}" data-box-item="${esc(item.id)}" data-box-item-field="bunches" data-excel-cell placeholder="Ramos">
        <input type="number" value="${esc(item.stemsPerBunch)}" data-box-item="${esc(item.id)}" data-box-item-field="stemsPerBunch" data-excel-cell placeholder="Tallos">
        <input type="number" step="0.0001" value="${esc(item.unitPrice)}" data-box-item="${esc(item.id)}" data-box-item-field="unitPrice" data-excel-cell placeholder="Precio">
        <button type="button" class="icon-button" data-box-remove-item="${esc(item.id)}" aria-label="Eliminar item">×</button>
      </div>`).join("")}
      <button type="button" class="secondary-button" data-box-add-item>+ Agregar variedad</button>
    </div>`;
  }

  function boxBuilderPanel(appState) {
    const draft = flow.getBoxDraft(appState);
    const catalogs = flow.catalogs(appState);
    const mode = upper(draft.mode || "RANGO");
    const openMix = mode === "MIXTO_ABIERTO";
    const boxTypes = [...new Set((catalogs.boxTypes || []).map(boxTypeValue).filter(Boolean))];
    const singleFields = mode !== "MIXTO_MANUAL" ? `<label>Variedad<select data-box-field="variety" data-excel-cell ${openMix ? "disabled" : ""}>${openMix ? '<option value="">Se completa en Cuarto Frío</option>' : catalogOptions(catalogs.varieties || [], draft.variety, "Seleccione variedad")}</select></label>` : "";
    const lengthField = openMix ? "lengthSelection" : "length";
    const lengthOptions = openMix
      ? openMixLengthOptions(catalogs.lengths || [], draft.length, draft.anyLength)
      : catalogOptions(catalogs.lengths || [], draft.length, "Seleccione medida");
    return `<section class="panel-card commercial-v2-box-builder commercial-v2-box-builder-compact" data-box-builder ${flow.sessionFor(appState).boxBuilderOpen ? "" : "hidden"}>
      <div class="panel-card-head commercial-v2-box-builder-head"><div><p class="section-kicker">ARMADO</p><h3>Generar cajas</h3></div><button type="button" class="icon-button" data-box-builder-close aria-label="Cerrar">×</button></div>
      <div class="commercial-v2-mode-tabs">
        <button type="button" class="${mode === "RANGO" ? "is-active" : ""}" data-box-mode="RANGO">Rango igual</button>
        <button type="button" class="${mode === "MIXTO_MANUAL" ? "is-active" : ""}" data-box-mode="MIXTO_MANUAL">Mixto manual</button>
        <button type="button" class="${mode === "MIXTO_ABIERTO" ? "is-active" : ""}" data-box-mode="MIXTO_ABIERTO">Mixto abierto</button>
      </div>
      <div class="commercial-v2-builder-grid commercial-v2-box-builder-grid" data-excel-row>
        <label>Tipo de caja<select data-box-field="boxType" data-excel-cell>${textOptions(boxTypes, draft.boxType)}</select></label>
        <label>Cantidad de cajas<input type="number" min="1" max="200" value="${esc(draft.quantity)}" data-box-field="quantity" data-excel-cell></label>
        ${singleFields}
        ${mode !== "MIXTO_MANUAL" ? `<label>Calidad<select data-box-field="quality" data-excel-cell>${qualityOptions(draft.quality)}</select></label>` : ""}
        ${mode !== "MIXTO_MANUAL" ? `<label>Medida<select data-box-field="${lengthField}" data-excel-cell>${lengthOptions}</select></label><label>Ramos por caja<input type="number" value="${esc(draft.bunches)}" data-box-field="bunches" data-excel-cell></label><label>Tallos por ramo<input type="number" value="${esc(draft.stemsPerBunch)}" data-box-field="stemsPerBunch" data-excel-cell></label><label>Precio por tallo<input type="number" step="0.0001" value="${esc(draft.unitPrice)}" data-box-field="unitPrice" data-excel-cell></label>` : ""}
        <label>PO manual<input value="${esc(draft.po)}" data-box-field="po" data-excel-cell></label>
      </div>
      ${manualItems(draft, catalogs)}
      <div class="commercial-v2-builder-actions"><button type="button" class="primary-button" data-box-generate>Agregar cajas al pedido</button></div>
    </section>`;
  }

  function boxTable(order, catalogs) {
    const boxes = flow.groupOrderBoxes(order);
    const boxTypes = [...new Set((catalogs.boxTypes || []).map(boxTypeValue).filter(Boolean))];
    if (!boxes.length) return `<div class="empty-state compact"><strong>Sin cajas</strong><span>Pulse “Tipo de caja” para iniciar el armado.</span></div>`;
    return `<div class="table-wrap commercial-v2-lines"><table><thead><tr><th>Caja</th><th>Tipo</th><th>Variedad</th><th>Calidad</th><th>Medida</th><th>Ramos</th><th>Tallos</th><th>Precio</th><th>PO</th><th>Acciones</th></tr></thead><tbody>
      ${boxes.map(box => box.lines.map((line, lineIndex) => `<tr class="${lineIndex === 0 ? "commercial-v2-box-start" : "commercial-v2-box-continuation"}" data-order-line-row="${esc(line.id)}" data-excel-row>
        ${lineIndex === 0 ? `<td rowspan="${box.lines.length}"><strong>${box.boxNumber}</strong></td>` : ""}
        <td><select data-line-id="${esc(line.id)}" data-line-field="boxType" data-excel-cell>${textOptions(boxTypes, line.boxType)}</select></td>
        <td><select data-line-id="${esc(line.id)}" data-line-field="variety" data-excel-cell>${catalogOptions(catalogs.varieties || [], line.variety, "Variedad")}</select></td>
        <td><select data-line-id="${esc(line.id)}" data-line-field="quality" data-excel-cell>${qualityOptions(line.quality)}</select></td>
        <td><select data-line-id="${esc(line.id)}" data-line-field="length" data-excel-cell>${catalogOptions(catalogs.lengths || [], line.length, "Medida")}</select></td>
        <td><input type="number" value="${esc(line.bunches)}" data-line-id="${esc(line.id)}" data-line-field="bunches" data-excel-cell></td>
        <td><input type="number" value="${esc(line.stemsPerBunch)}" data-line-id="${esc(line.id)}" data-line-field="stemsPerBunch" data-excel-cell></td>
        <td><input type="number" step="0.0001" value="${esc(line.unitPrice)}" data-line-id="${esc(line.id)}" data-line-field="unitPrice" data-excel-cell></td>
        <td><input value="${esc(line.po)}" data-line-id="${esc(line.id)}" data-line-field="po" data-excel-cell></td>
        <td><details class="commercial-v2-action-menu"><summary>Opciones <span aria-hidden="true">⌄</span></summary><div class="commercial-v2-action-list">
          ${lineIndex === 0 ? `<button type="button" class="secondary-button" data-box-duplicate="${box.boxNumber}">Duplicar caja</button><button type="button" class="secondary-button" data-box-add-line="${box.boxNumber}">Agregar ítem</button>` : ""}
          <button type="button" class="secondary-button" data-line-delete="${esc(line.id)}">Eliminar ítem</button>
          ${lineIndex === 0 ? `<button type="button" class="danger-button" data-box-delete="${box.boxNumber}">Eliminar caja</button>` : ""}
        </div></details></td>
      </tr>`).join("")).join("")}
    </tbody></table></div>`;
  }

  function renderOrder(appState) {
    const order = flow.getDraft(appState);
    const session = flow.sessionFor(appState);
    const catalogs = flow.catalogs(appState);
    const usesInventory = flow.orderUsesInventory(order);
    return `<section class="page-header"><div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>${session.mode === "EDIT" ? "Editar pedido" : "Crear pedido"}</h1><p>El formulario permanece en memoria. Solo Guardar pedido confirma datos, secuencial y disponibilidad.</p></div><div class="page-header-side"><span class="status-badge ${session.mode === "EDIT" ? "authorized" : "partial"}">${session.mode === "EDIT" ? "PEDIDO GUARDADO" : "NUEVO"}</span></div></section>
      ${orderHeader(order, appState)}
      ${orderFields(order, appState)}
      <section class="panel-card commercial-v2-section">
        <div class="panel-card-head"><div><p class="section-kicker">ORDEN DEL CLIENTE</p><h3>Cajas, variedades, cantidades y precios</h3><small>Digitación tipo Excel: Tab, Shift + Tab y flechas para moverse entre celdas.</small></div><button type="button" class="primary-button" data-box-builder-open>Tipo de caja</button></div>
        ${boxBuilderPanel(appState)}
        ${boxTable(order, catalogs)}
      </section>
      <section class="commercial-v2-sticky-actions">
        <button type="button" class="secondary-button" data-order-new>Nuevo</button>
        <button type="button" class="primary-button" data-order-save>Guardar pedido</button>
        <button type="button" class="success-button" data-order-send ${session.mode !== "EDIT" || !usesInventory ? "disabled" : ""}>${usesInventory ? "Enviar a Cuarto Frío" : "Sin Cuarto Frío"}</button>
      </section>`;
  }

  function refreshOrderDependencies(container, appState) {
    const order = flow.getDraft(appState);
    const local = flow.isLocalOrder(order, appState);
    const catalogs = flow.catalogs(appState);
    const brandField = container.querySelector('[data-order-field="brandId"]');
    const brandSearch = container.querySelector("[data-order-brand-search]");
    if (brandField) {
      const brands = catalogs.brands.filter(row => !order.customerId || String(row.customerId) === String(order.customerId));
      const selectedBrand = brands.find(row => String(row.id) === String(order.brandId));
      brandField.value = selectedBrand?.id || "";
      if (brandSearch) {
        brandSearch.value = selectedBrand ? brandOptionLabel(selectedBrand) : "";
        brandSearch.placeholder = local ? "Opcional · escriba para buscar" : "Escriba para buscar";
        const list = container.querySelector(`#${brandSearch.getAttribute("list")}`);
        if (list) list.innerHTML = brands.map(row => `<option value="${esc(brandOptionLabel(row))}"></option>`).join("");
      }
    }
    ["destinationId", "destinationCountry", "coldRoom", "daeNumber", "agencyId"].forEach(field => {
      const input = container.querySelector(`[data-order-field="${field}"]`);
      if (!input) return;
      if (field === "destinationId") {
        input.value = selectedDestinationId(order, catalogs.destinations || []);
      } else if (field === "daeNumber") {
        const daes = catalogs.daes.filter(row => !order.destinationCountry || upper(row.country || row.destination) === upper(order.destinationCountry));
        const maritime = upper(utils.normalizeTransportType?.(order.transportType) || order.transportType) === "MARITIMO";
        input.innerHTML = `<option value="">${local ? "No aplica / opcional" : maritime ? "DAE pendiente · puede registrarse después" : "Seleccione DAE"}</option>${daes.map(row => `<option value="${esc(row.number)}" ${String(row.number) === String(order.daeNumber) ? "selected" : ""}>${esc(row.number)} · ${esc(row.country || row.destination)}</option>`).join("")}`;
        input.disabled = local;
      } else {
        input.value = order[field] || "";
      if (field === "destinationCountry") input.readOnly = local;
      }
    });
    const market = container.querySelector('[data-order-field="saleType"]');
    if (market) market.value = local ? "LOCAL" : "EXPORTACION";
    const sendButton = container.querySelector("[data-order-send]");
    if (sendButton) {
      const usesInventory = flow.orderUsesInventory(order);
      sendButton.disabled = flow.sessionFor(appState).mode !== "EDIT" || !usesInventory;
      sendButton.textContent = usesInventory ? "Enviar a Cuarto Frío" : "Sin Cuarto Frío";
    }
    const inventoryHelp = container.querySelector("[data-inventory-mode-help]");
    if (inventoryHelp) inventoryHelp.textContent = flow.orderUsesInventory(order)
      ? "Compromete disponibilidad y puede enviarse a Cuarto Frío."
      : "Solo historial, documentos SRI, invoices y etiquetas; no afecta disponibilidad.";
    const strip = container.querySelector(".commercial-v2-order-strip");
    if (strip) strip.outerHTML = orderHeader(order, appState);
  }

  function excelCells(container) {
    return [...container.querySelectorAll("[data-excel-cell]")].filter(cell => !cell.disabled && !cell.hidden && cell.getClientRects().length);
  }

  function focusExcelCell(cell) {
    if (!cell) return;
    cell.focus();
    if (typeof cell.select === "function") {
      try { cell.select(); } catch (_) { /* Algunos tipos de input no permiten seleccionar texto. */ }
    }
  }

  function moveExcelCell(container, current, key, shiftKey) {
    const cells = excelCells(container);
    if (!cells.length) return false;
    if (key === "Tab") {
      const index = cells.indexOf(current);
      const target = cells[index + (shiftKey ? -1 : 1)];
      if (!target) return false;
      focusExcelCell(target);
      return true;
    }

    const row = current.closest("[data-excel-row]");
    if (!row) return false;
    const rows = [...container.querySelectorAll("[data-excel-row]")]
      .map(rowElement => ({ row: rowElement, cells: [...rowElement.querySelectorAll("[data-excel-cell]")].filter(cell => !cell.disabled && !cell.hidden && cell.getClientRects().length) }))
      .filter(item => item.cells.length);
    const rowIndex = rows.findIndex(item => item.row === row);
    const columnIndex = rows[rowIndex]?.cells.indexOf(current) ?? -1;
    if (rowIndex < 0 || columnIndex < 0) return false;

    let target = null;
    if (key === "ArrowLeft") target = rows[rowIndex].cells[columnIndex - 1];
    if (key === "ArrowRight") target = rows[rowIndex].cells[columnIndex + 1];
    if (key === "ArrowUp" && rows[rowIndex - 1]) target = rows[rowIndex - 1].cells[Math.min(columnIndex, rows[rowIndex - 1].cells.length - 1)];
    if (key === "ArrowDown" && rows[rowIndex + 1]) target = rows[rowIndex + 1].cells[Math.min(columnIndex, rows[rowIndex + 1].cells.length - 1)];
    if (!target) return false;
    focusExcelCell(target);
    return true;
  }

  function bindOrder(container, appState) {
    if (container.dataset.commercialV2OrderBound === "true") return;
    container.dataset.commercialV2OrderBound = "true";
    if (!flow.sessionFor(appState).salesRepresentativesLoaded) {
      flow.loadSalesRepresentatives?.(appState).then(result => {
        if (result?.ok && container.isConnected) rerenderPage();
      });
    }
    container.addEventListener("input", event => {
      const brandSearch = event.target.closest("[data-order-brand-search]");
      if (brandSearch) {
        const draft = flow.getDraft(appState);
        const brands = flow.catalogs(appState).brands.filter(row => !draft.customerId || String(row.customerId) === String(draft.customerId));
        const selected = brandForSearchValue(brands, brandSearch.value);
        const nextBrandId = selected?.id || "";
        if (String(draft.brandId || "") !== String(nextBrandId)) flow.updateDraftField(appState, "brandId", nextBrandId);
        if (selected) refreshOrderDependencies(container, appState);
        return;
      }
      const orderField = event.target.closest("[data-order-field]");
      if (orderField && !["customerId", "brandId", "saleType", "inventoryMode", "transportType", "destinationId", "daeNumber", "agencyId", "airlineId"].includes(orderField.dataset.orderField)) {
        flow.updateDraftField(appState, orderField.dataset.orderField, orderField.value);
        if (orderField.dataset.orderField === "awb") {
          const draft = flow.getDraft(appState);
          orderField.value = draft.awb || "";
          const airlineField = container.querySelector('[data-order-field="airlineId"]');
          if (airlineField) airlineField.value = draft.airlineId || "";
          const help = container.querySelector("[data-airline-prefix-help]");
          const airline = flow.catalogs(appState).airlines.find(row => String(row.id) === String(draft.airlineId));
          if (help) help.textContent = airline
            ? `${airline.name} detectada por el prefijo ${airline.awbPrefix}.`
            : ((utils.getAwbPrefix?.(draft.awb) || "").length >= 3 ? "Prefijo no configurado en Líneas aéreas." : "Se reconoce con los tres primeros caracteres de la guía madre.");
        }
        return;
      }
      const boxField = event.target.closest("[data-box-field]");
      if (boxField) { flow.updateBoxDraft(appState, boxField.dataset.boxField, boxField.value); return; }
      const boxItem = event.target.closest("[data-box-item]");
      if (boxItem) { flow.updateManualBoxItem(appState, boxItem.dataset.boxItem, boxItem.dataset.boxItemField, boxItem.value); return; }
      const line = event.target.closest("[data-line-id]");
      if (line) flow.updateLine(appState, line.dataset.lineId, line.dataset.lineField, line.value);
    });
    container.addEventListener("change", event => {
      const brandSearch = event.target.closest("[data-order-brand-search]");
      if (brandSearch) {
        const draft = flow.getDraft(appState);
        const brands = flow.catalogs(appState).brands.filter(row => !draft.customerId || String(row.customerId) === String(draft.customerId));
        const selected = brandForSearchValue(brands, brandSearch.value);
        flow.updateDraftField(appState, "brandId", selected?.id || "");
        if (!selected && brandSearch.value.trim()) {
          brandSearch.value = "";
          toast("Seleccione una marca existente del catálogo; no se guardó texto libre.", "warning");
        }
        refreshOrderDependencies(container, appState);
        return;
      }
      const boxField = event.target.closest("[data-box-field]");
      if (boxField) { flow.updateBoxDraft(appState, boxField.dataset.boxField, boxField.value); return; }
      const boxItem = event.target.closest("[data-box-item]");
      if (boxItem) { flow.updateManualBoxItem(appState, boxItem.dataset.boxItem, boxItem.dataset.boxItemField, boxItem.value); return; }
      const line = event.target.closest("[data-line-id]");
      if (line) { flow.updateLine(appState, line.dataset.lineId, line.dataset.lineField, line.value); return; }
      const field = event.target.closest("[data-order-field]");
      if (!field) return;
      flow.updateDraftField(appState, field.dataset.orderField, field.value);
      if (["customerId", "brandId", "saleType", "inventoryMode", "transportType", "destinationId", "destinationCountry", "agencyId"].includes(field.dataset.orderField)) {
        if (field.dataset.orderField === "transportType") rerenderPage();
        else refreshOrderDependencies(container, appState);
      }
    });
    container.addEventListener("keydown", event => {
      const cell = event.target.closest("[data-excel-cell]");
      if (!cell || !["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      if (moveExcelCell(container, cell, event.key, event.shiftKey)) event.preventDefault();
    });
    container.addEventListener("click", async event => {
      const action = event.target.closest("button");
      if (!action) return;
      if (action.matches("[data-box-builder-open]")) { flow.sessionFor(appState).boxBuilderOpen = true; const panel = container.querySelector("[data-box-builder]"); panel.hidden = false; panel.querySelector("input,select")?.focus(); return; }
      if (action.matches("[data-box-builder-close]")) { flow.sessionFor(appState).boxBuilderOpen = false; container.querySelector("[data-box-builder]").hidden = true; return; }
      if (action.dataset.boxMode) { flow.sessionFor(appState).boxBuilderOpen = true; flow.setBoxMode(appState, action.dataset.boxMode); rerenderPage(); return; }
      if (action.hasAttribute("data-box-add-item")) { flow.sessionFor(appState).boxBuilderOpen = true; flow.addManualBoxItem(appState); rerenderPage(); return; }
      if (action.dataset.boxRemoveItem) { flow.sessionFor(appState).boxBuilderOpen = true; flow.removeManualBoxItem(appState, action.dataset.boxRemoveItem); rerenderPage(); return; }
      if (action.hasAttribute("data-box-generate")) {
        const result = flow.addBoxes(appState);
        if (!result.ok) toast((result.errors || ["No se pudo generar la caja."]).join(" "), "warning");
        else { flow.sessionFor(appState).boxBuilderOpen = false; toast(`${result.boxNumbers.length} caja(s) agregadas.`, "success"); rerenderPage(); }
        return;
      }
      if (action.dataset.boxDelete) { if (confirm(`¿Eliminar la caja ${action.dataset.boxDelete}?`)) { flow.deleteBox(appState, action.dataset.boxDelete); rerenderPage(); } return; }
      if (action.dataset.boxDuplicate) { flow.duplicateBox(appState, action.dataset.boxDuplicate); rerenderPage(); return; }
      if (action.dataset.boxAddLine) { flow.addItemToBox(appState, action.dataset.boxAddLine); rerenderPage(); return; }
      if (action.dataset.lineDelete) { flow.deleteLine(appState, action.dataset.lineDelete); rerenderPage(); return; }
      if (action.hasAttribute("data-order-new")) { if (!flow.getDraft(appState).formDirty || confirm("Los cambios no guardados se descartarán. ¿Crear un pedido nuevo?")) { flow.newDraft(appState); rerenderPage(); } return; }
      if (action.hasAttribute("data-order-save")) {
        action.disabled = true;
        try {
          const result = await flow.saveOrderConfirmed(appState);
          if (!result.ok) toast((result.errors || ["No se pudo guardar."]).join(" "), "warning");
          else {
            const inventoryOrder = flow.orderUsesInventory(result.order);
            const reservationWarning = inventoryOrder && result.reservationConfirmed === false;
            toast(
              reservationWarning
                ? `Pedido ${result.order.number} guardado. Reserva pendiente: ${result.reservationError || "Supabase no confirmó disponibilidad."}`
                : inventoryOrder
                  ? `Pedido ${result.order.number} guardado. Reserva ${result.reservationStatus === "PARTIAL" ? "parcial" : "confirmada"}.`
                  : `Venta ${result.order.number} guardada sin afectar inventario.`,
              reservationWarning ? "warning" : "success"
            );
            rerenderPage();
          }
        } catch (error) { toast(error.message, "danger"); action.disabled = false; }
        return;
      }
      if (action.hasAttribute("data-order-send")) {
        action.disabled = true;
        try {
          const result = await flow.sendToColdRoomConfirmed(appState);
          if (!result.ok) { toast(result.error, "warning"); action.disabled = false; }
          else { toast(`${result.order.number} enviado a Cuarto Frío.`, "success"); rerenderPage(); }
        } catch (error) { toast(error.message, "danger"); action.disabled = false; }
      }
    });
  }

  function orderRows(appState, state, mode = "history") {
    const orders = flow.activeCompanyId(appState) ? appState.db.commercial.orders.filter(row => String(row.sellingCompanyId || row.companyId || row.company_id) === flow.activeCompanyId(appState)) : appState.db.commercial.orders;
    const filtered = orders.filter(order => {
      const date = String(order.issuedAt || "").slice(0, 10);
      if (state.date && date !== state.date) return false;
      if (state.market && state.market !== "TODOS" && (flow.isLocalOrder(order, appState) ? "LOCAL" : "EXPORTACION") !== state.market) return false;
      if (state.search) {
        const haystack = upper(`${order.number} ${order.sriInvoiceNumber} ${customerName(appState, order.customerId)} ${brandName(appState, order.brandId)}`);
        if (!haystack.includes(upper(state.search))) return false;
      }
      if (mode === "tracking" && ["ANULADO", "ENVIADO"].includes(upper(order.status))) return false;
      if (mode === "tracking" && !flow.orderUsesInventory(order)) return false;
      if (mode === "coordination" && ["ANULADO", "ENVIADO"].includes(upper(order.status))) return false;
      if (mode === "coordination" && !flow.orderUsesInventory(order)) return false;
      if (mode === "coordination" && ["PENDIENTE", "COORDINADA"].includes(upper(state.status))) {
        return flow.deriveCoordinationStatus(order, appState) === upper(state.status);
      }
      return true;
    }).sort((a, b) => String(b.createdAt || b.issuedAt).localeCompare(String(a.createdAt || a.issuedAt)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    return { rows: filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize), total: filtered.length, totalPages };
  }

  function routeSheetModel(appState, state) {
    const companyId = flow.activeCompanyId(appState);
    const orders = companyId
      ? appState.db.commercial.orders.filter(order => String(order.sellingCompanyId || order.companyId || order.company_id) === companyId)
      : appState.db.commercial.orders;
    return BlessERP.comercialRouteSheetModel.build(orders, appState, { date: state.date });
  }

  function routeSheetSelectedIds(state) {
    return new Set(Array.isArray(state.routeSheetSelectedIds) ? state.routeSheetSelectedIds.map(String) : []);
  }

  function renderRouteSheetModal(appState, state) {
    if (!state.routeSheetOpen) return "";
    const model = routeSheetModel(appState, state);
    const selected = routeSheetSelectedIds(state);
    const selectedRows = model.rows.filter(row => row.agencyValid && selected.has(String(row.orderId)));
    const totals = selectedRows.reduce((sum, row) => {
      const orderSummary = orderTotals(row.order);
      sum.boxes += orderSummary.boxes;
      sum.orders += 1;
      return sum;
    }, { boxes: 0, orders: 0 });
    const groupRows = model.groups.map(group => `
      <tr class="commercial-route-sheet-agency-row"><td colspan="10"><strong>${esc(group.agencyName)}</strong><small>${group.agencyValid ? `${group.rows.length} pedido(s) · ID ${esc(group.agencyId)}` : "Debe asignar una Agencia de Carga antes de imprimir."}</small></td></tr>
      ${group.rows.map(row => {
        const summary = orderTotals(row.order);
        const checked = row.agencyValid && selected.has(String(row.orderId));
        return `<tr class="${row.agencyValid ? "" : "is-pending"}">
          <td><input type="checkbox" data-route-sheet-order="${esc(row.orderId)}" ${checked ? "checked" : ""} ${row.agencyValid ? "" : "disabled"}></td>
          <td><strong>${esc(row.order.number || row.orderId)}</strong></td>
          <td>${esc(BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(row.order) || "Pendiente")}</td>
          <td>${esc(customerName(appState, row.order.customerId))}</td>
          <td><strong>${esc(row.transportLabel)}</strong></td>
          <td>${esc(row.motherGuide || "Pendiente")}</td>
          <td>${esc(row.destination)}</td>
          <td>${esc(row.agencyName)}</td>
          <td>${summary.boxes}</td>
          <td><span class="status-badge ${row.agencyValid ? "authorized" : "pending"}">${row.agencyValid ? "LISTO" : "SIN AGENCIA"}</span></td>
        </tr>`;
      }).join("")}
    `).join("");

    return `<div class="commercial-quick-editor-modal commercial-route-sheet-modal" data-route-sheet-backdrop>
      <section class="panel-card commercial-quick-editor-dialog commercial-route-sheet-dialog" role="dialog" aria-modal="true" aria-label="Hoja de Ruta del ${esc(state.date)}">
        <div class="panel-card-head commercial-quick-editor-head"><div><p class="section-kicker">COORDINACIÓN DIARIA</p><h2>Hoja de Ruta por Agencia de Carga</h2><p class="panel-note">Incluye pedidos aéreos y marítimos. La Agencia de Carga define la agrupación principal.</p></div><button class="commercial-order-control-close" type="button" data-route-sheet-close aria-label="Cerrar">×</button></div>
        <div class="commercial-route-sheet-controls"><label class="compact-field"><span>Fecha del pedido</span><input type="date" value="${esc(state.date)}" disabled></label><button class="secondary-button" type="button" data-route-sheet-select-all ${model.rows.some(row => row.agencyValid) ? "" : "disabled"}>Marcar válidos</button><button class="secondary-button" type="button" data-route-sheet-clear ${selectedRows.length ? "" : "disabled"}>Desmarcar</button><div class="commercial-route-sheet-summary"><strong>${totals.orders} pedido(s)</strong><span>${totals.boxes} pieza(s) · ${model.groups.filter(group => group.agencyValid).length} agencia(s)</span></div></div>
        <div class="compact-table-wrap commercial-route-sheet-table-wrap"><table class="compact-table commercial-route-sheet-table"><thead><tr><th>Elegir</th><th>Pedido</th><th>Factura</th><th>Cliente</th><th>Tipo</th><th>Guía madre</th><th>Destino</th><th>Agencia</th><th>Piezas</th><th>Estado</th></tr></thead><tbody>${groupRows || `<tr><td colspan="10">No existen pedidos aéreos o marítimos para la fecha seleccionada.</td></tr>`}</tbody></table></div>
        <div class="commercial-route-sheet-actions"><button class="secondary-button" type="button" data-route-sheet-preview ${selectedRows.length ? "" : "disabled"}>Vista previa</button><button class="primary-button" type="button" data-route-sheet-print ${selectedRows.length ? "" : "disabled"}>Imprimir / guardar PDF</button></div>
      </section>
    </div>`;
  }

  function pagination(state, page) {
    return `<div class="commercial-v2-pagination"><button type="button" class="secondary-button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${state.page} de ${page.totalPages} · ${page.total} registro(s)</span><button type="button" class="secondary-button" data-page="${state.page + 1}" ${state.page >= page.totalPages ? "disabled" : ""}>Siguiente</button></div>`;
  }

  function trackingProgress(progress) {
    const total = Math.max(0, number(progress?.requiredBunches));
    const scanned = Math.max(0, number(progress?.scannedBunches));
    const percent = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;
    return `<div class="commercial-v2-tracking-progress"><strong>${scanned}/${total}</strong><span><i style="width:${percent}%"></i></span><small>${percent}%</small></div>`;
  }

  function renderTracking(appState, view = "SEGUIMIENTO") {
    const session = flow.sessionFor(appState);
    const isCoordination = view === "COORDINACION";
    const state = isCoordination ? session.coordination : session.tracking;
    const page = orderRows(appState, state, isCoordination ? "coordination" : "tracking");
    const selected = session.selectedOrderId ? flow.findOrder(appState, session.selectedOrderId) : null;
    return `<section class="page-header"><div><p class="section-kicker">COMERCIAL / PEDIDOS</p><h1>${isCoordination ? "Coordinación diaria" : "Seguimiento de pedidos"}</h1><p>${isCoordination ? "Editor de guías y acceso operativo a la Hoja de Ruta." : "Consulta de cajas, variedades, medidas y avance de Cuarto Frío. No modifica el pedido."}</p></div>${isCoordination ? `<div class="page-header-side"><button type="button" class="primary-button" data-route-sheet-open>Hoja de Ruta</button></div>` : ""}</section>
      <section class="panel-card commercial-v2-section commercial-v2-tracking-panel ${isCoordination ? "commercial-v2-coordination-panel" : ""}">
        <form class="commercial-v2-filters" data-tracking-filter><label>Fecha<input type="date" name="date" value="${esc(state.date)}"></label><label>Buscar<input name="search" value="${esc(state.search || "")}" placeholder="Pedido o cliente"></label>${isCoordination ? `<label>Estado<select name="status"><option value="TODOS" ${state.status === "TODOS" ? "selected" : ""}>Todas</option><option value="PENDIENTE" ${state.status === "PENDIENTE" ? "selected" : ""}>Pendientes</option><option value="COORDINADA" ${state.status === "COORDINADA" ? "selected" : ""}>Coordinadas</option></select></label>` : ""}<button class="primary-button" type="submit">Aplicar</button></form>
        <div class="table-wrap commercial-v2-tracking-table ${isCoordination ? "commercial-v2-coordination-table" : ""}"><table><thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Cajas</th><th>Ramos</th><th>Estado</th>${isCoordination ? "<th>DAE</th><th>Guía madre</th><th>Guía hija</th>" : ""}<th>Acción</th></tr></thead><tbody>
          ${page.rows.map(order => { const progress = flow.buildOrderFulfillment(order); const totals = orderTotals(order); const transport = upper(utils.normalizeTransportType?.(order.transportType) || order.transportType || "AEREO"); const maritime = transport === "MARITIMO"; return `<tr><td><strong>${dateLabel(order.issuedAt)}</strong></td><td><strong>${esc(order.number)}</strong><small>Factura ${esc(BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order) || "pendiente")}</small></td><td><strong>${esc(customerName(appState, order.customerId))}</strong></td><td><span class="commercial-v2-count-chip">${totals.boxes}</span></td><td>${trackingProgress(progress)}</td><td><span class="status-badge ${flow.deriveCoordinationStatus(order, appState) === "COORDINADA" ? "authorized" : flow.deriveCoordinationStatus(order, appState) === "NO_APLICA" ? "partial" : "pending"}">${esc(flow.deriveCoordinationStatus(order, appState))}</span></td>${isCoordination ? `<td><input value="${esc(order.daeNumber)}" placeholder="${maritime && !order.daeNumber ? "DAE pendiente" : "DAE"}" data-coordination-order="${esc(order.id)}" data-coordination-field="daeNumber"></td><td><input value="${esc(order.awb)}" data-coordination-order="${esc(order.id)}" data-coordination-field="awb" data-coordination-transport="${esc(transport)}" placeholder="${maritime ? "ABC123" : transport === "AEREO" ? "014-12345678" : "Referencia"}"></td><td><input value="${esc(order.hawb)}" data-coordination-order="${esc(order.id)}" data-coordination-field="hawb" data-coordination-transport="${esc(transport)}" placeholder="${maritime ? "BL-8899" : "HF-001"}"></td>` : ""}<td>${isCoordination ? `<button type="button" class="primary-button" data-coordination-save="${esc(order.id)}">Guardar</button>` : `<button type="button" class="secondary-button" data-tracking-open="${esc(order.id)}">Ver contenido</button>`}</td></tr>`; }).join("") || `<tr><td colspan="10"><div class="empty-state compact">No existen pedidos para esta fecha.</div></td></tr>`}
        </tbody></table></div>${pagination(state, page)}
      </section>
      ${!isCoordination && selected ? trackingDetail(selected, appState) : ""}
      ${isCoordination ? renderRouteSheetModal(appState, state) : ""}`;
  }

  async function printRouteSheet(appState, state, autoPrint, button) {
    if (routeSheetPrintInProgress) return;
    const model = routeSheetModel(appState, state);
    const selected = routeSheetSelectedIds(state);
    const orders = model.rows.filter(row => row.agencyValid && selected.has(String(row.orderId))).map(row => row.order);
    if (!orders.length) {
      toast("Seleccione al menos un pedido con Agencia de Carga válida.", "warning");
      return;
    }
    routeSheetPrintInProgress = true;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Preparando...";
    try {
      await BlessERP.moduleLoader.loadGroup("commercial-coordination-print");
      const result = BlessERP.comercialPrintSystem.openDocuments("HR", orders, appState, {
        autoPrint,
        saveAsPdf: autoPrint,
        pageSize: "A4",
        options: { routeOrders: orders, routeDate: state.date }
      });
      if (result && typeof result.then === "function") await result;
    } catch (error) {
      toast(error?.message || "No se pudo preparar la Hoja de Ruta.", "warning");
    } finally {
      routeSheetPrintInProgress = false;
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function trackingDetail(order, appState) {
    const progress = flow.buildOrderFulfillment(order);
    return `<section class="panel-card commercial-v2-section commercial-v2-tracking-detail"><div class="panel-card-head"><div><p class="section-kicker">RESUMEN DEL PEDIDO</p><h3>${esc(order.number)}</h3></div><button type="button" class="icon-button" data-tracking-close>×</button></div>
      <section class="summary-grid">${[["Cajas", progress.boxes.length], ["Ramos pedidos", progress.requiredBunches], ["Ingresados", progress.scannedBunches], ["Faltantes", progress.pendingBunches]].map(item => `<article class="summary-card"><span>${item[0]}</span><strong>${item[1]}</strong></article>`).join("")}</section>
      <div class="table-wrap commercial-v2-tracking-detail-table"><table><thead><tr><th>Caja</th><th>Tipo</th><th>Variedad</th><th>Calidad</th><th>Medida</th><th>Pedido</th><th>Ingresado</th><th>Faltante</th></tr></thead><tbody>${progress.boxes.flatMap(box => box.lines.map((line, index) => `<tr>${index === 0 ? `<td rowspan="${box.lines.length}"><strong class="commercial-v2-box-number">${box.boxNumber}</strong><small>${box.status}</small></td><td rowspan="${box.lines.length}"><span class="commercial-v2-count-chip">${esc(box.boxType)}</span></td>` : ""}<td><strong>${esc(line.variety)}</strong></td><td>${esc(BlessERP.flowerQuality?.label?.(line.quality) || "SIN CALIDAD")}</td><td>${line.length} CM</td><td>${line.requiredBunches}</td><td>${line.scannedBunches}</td><td><strong>${line.pendingBunches}</strong></td></tr>`)).join("")}</tbody></table></div></section>`;
  }

  function bindTracking(container, appState, view = "SEGUIMIENTO") {
    trackingBindControllers.get(container)?.abort();
    const controller = new window.AbortController();
    trackingBindControllers.set(container, controller);
    const listenerOptions = { signal: controller.signal };
    const state = view === "COORDINACION" ? flow.sessionFor(appState).coordination : flow.sessionFor(appState).tracking;
    const pending = new Map();
    if (view === "COORDINACION") {
      container.querySelectorAll('[data-coordination-field="awb"]').forEach(field => {
        const transport = field.dataset.coordinationTransport || "AEREO";
        field.value = flow.normalizeMotherGuide(field.value, transport);
        if (upper(transport) === "AEREO") {
          field.inputMode = "numeric";
          field.maxLength = 12;
          field.pattern = "[0-9]{3}-[0-9]{8}";
          field.setAttribute("aria-label", "MAWB: prefijo alfanumérico de 3 caracteres, guion y 8 dígitos");
        } else {
          field.inputMode = "text";
          field.maxLength = upper(transport) === "MARITIMO" ? 14 : 50;
          field.removeAttribute("pattern");
          field.setAttribute("aria-label", "Guía madre alfanumérica");
        }
      });
    }
    container.addEventListener("input", event => {
      const field = event.target.closest("[data-coordination-order]");
      if (!field) return;
      if (field.dataset.coordinationField === "awb") field.value = flow.normalizeMotherGuide(field.value, field.dataset.coordinationTransport);
      if (field.dataset.coordinationField === "hawb") field.value = utils.normalizeLogisticsReference?.(field.value) || field.value;
      const id = field.dataset.coordinationOrder;
      const payload = pending.get(id) || {};
      payload[field.dataset.coordinationField] = field.value;
      pending.set(id, payload);
    }, listenerOptions);
    container.addEventListener("submit", event => {
      if (!event.target.matches("[data-tracking-filter]")) return;
      event.preventDefault();
      const form = new FormData(event.target);
      state.date = String(form.get("date") || ""); state.search = String(form.get("search") || ""); state.status = String(form.get("status") || state.status || "TODOS"); state.page = 1; state.routeSheetOpen = false; rerenderPage();
    }, listenerOptions);
    container.addEventListener("click", async event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.dataset.page) { state.page = Number(button.dataset.page); rerenderPage(); return; }
      if (button.hasAttribute("data-route-sheet-open")) {
        const model = routeSheetModel(appState, state);
        state.routeSheetSelectedIds = model.rows.filter(row => row.agencyValid).map(row => String(row.orderId));
        state.routeSheetOpen = true;
        void BlessERP.moduleLoader.loadGroup("commercial-coordination-print").catch(() => {});
        rerenderPage();
        return;
      }
      if (button.hasAttribute("data-route-sheet-close")) { state.routeSheetOpen = false; rerenderPage(); return; }
      if (button.hasAttribute("data-route-sheet-select-all")) { state.routeSheetSelectedIds = routeSheetModel(appState, state).rows.filter(row => row.agencyValid).map(row => String(row.orderId)); rerenderPage(); return; }
      if (button.hasAttribute("data-route-sheet-clear")) { state.routeSheetSelectedIds = []; rerenderPage(); return; }
      if (button.hasAttribute("data-route-sheet-preview")) { await printRouteSheet(appState, state, false, button); return; }
      if (button.hasAttribute("data-route-sheet-print")) { await printRouteSheet(appState, state, true, button); return; }
      if (button.dataset.trackingOpen) { flow.sessionFor(appState).selectedOrderId = button.dataset.trackingOpen; rerenderPage(); return; }
      if (button.hasAttribute("data-tracking-close")) { flow.sessionFor(appState).selectedOrderId = ""; rerenderPage(); return; }
      if (button.dataset.coordinationSave) {
        button.disabled = true;
        const result = await flow.updateCoordination(appState, button.dataset.coordinationSave, pending.get(button.dataset.coordinationSave) || {});
        toast(result.ok
          ? (result.unchanged ? "Sin cambios por guardar." : "Coordinación confirmada en Supabase.")
          : result.error, result.ok ? (result.unchanged ? "info" : "success") : "warning");
        if (result.ok) pending.delete(button.dataset.coordinationSave);
        if (button.isConnected) button.disabled = false;
        if (!result.unchanged || result.cacheAdvanced) rerenderPage();
      }
    }, listenerOptions);
    container.addEventListener("change", event => {
      const field = event.target.closest("[data-route-sheet-order]");
      if (!field) return;
      const selected = routeSheetSelectedIds(state);
      if (field.checked) selected.add(String(field.dataset.routeSheetOrder));
      else selected.delete(String(field.dataset.routeSheetOrder));
      state.routeSheetSelectedIds = [...selected];
      rerenderPage();
    }, listenerOptions);
  }

  function unmountTracking(container) {
    const controller = trackingBindControllers.get(container);
    if (!controller) return false;
    controller.abort();
    trackingBindControllers.delete(container);
    return true;
  }

  const historySelection = new Set();
  const historyPrintPending = new Set();

  function historyPrintGroups(docCode) {
    return docCode === "ETIQUETAS"
      ? ["commercial-history-print-core", "commercial-history-print-labels"]
      : docCode === "COMMERCIAL_INVOICE_CLIENT"
        ? ["commercial-history-print-core", "commercial-history-print-client"]
        : ["commercial-history-print-core", "commercial-history-print-invoice"];
  }

  async function loadHistoryPrintResources(docCode) {
    const results = [];
    for (const group of historyPrintGroups(docCode)) {
      results.push(await BlessERP.moduleLoader.loadGroup(group));
    }
    return results;
  }

  function prefetchHistoryPrint(docCode) {
    if (!docCode || historyPrintPending.has(docCode)) return;
    loadHistoryPrintResources(docCode).catch(error => {
      console.warn(`[JAEDER PERF] No se pudo precargar ${docCode}.`, error);
    });
  }

  function renderHistory(appState) {
    const state = flow.sessionFor(appState).history;
    const page = orderRows(appState, state, "history");
    return `<section class="page-header commercial-history-v2-header"><div><p class="section-kicker">PEDIDOS / HISTORIAL</p><h1>Pedidos confirmados</h1><p>Lista ligera. Los documentos se generan únicamente al solicitarlos.</p></div><div class="page-header-side"><button type="button" class="primary-button" data-history-new>+ Nuevo pedido</button></div></section>
      <section class="panel-card commercial-v2-section commercial-history-v2-card">
        <form class="commercial-v2-filters commercial-history-v2-filters" data-history-filter><label>Fecha<input type="date" name="date" value="${esc(state.date)}"></label><label>Mercado<select name="market"><option value="TODOS">Todos</option><option value="EXPORTACION" ${state.market === "EXPORTACION" ? "selected" : ""}>Exportación</option><option value="LOCAL" ${state.market === "LOCAL" ? "selected" : ""}>Local</option></select></label><label>Buscar<input name="search" value="${esc(state.search)}" placeholder="Pedido, factura o cliente"></label><button class="primary-button" type="submit">Aplicar</button><button class="secondary-button" type="button" data-history-all>Todo</button></form>
        <div class="commercial-v2-document-actions commercial-history-v2-document-actions"><span><strong>${historySelection.size}</strong> seleccionado(s)</span><button type="button" class="secondary-button" data-history-print="COMMERCIAL_INVOICE_CLIENT" ${historySelection.size ? "" : "disabled"}>Factura cliente</button><button type="button" class="secondary-button" data-history-print="INVOICE_PACKING_REFERENCIAL" ${historySelection.size ? "" : "disabled"}>Commercial Invoice</button><button type="button" class="secondary-button" data-history-print="ETIQUETAS" ${historySelection.size ? "" : "disabled"}>Etiquetas</button></div>
        <div class="table-wrap commercial-history-v2-table-wrap"><table class="commercial-history-v2-table"><thead><tr><th></th><th>Fecha</th><th>Pedido</th><th>Factura</th><th>Cliente</th><th>Cliente final</th><th>Cajas</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${page.rows.map(order => { const totals = orderTotals(order); const usesInventory = flow.orderUsesInventory(order); return `<tr class="commercial-history-v2-row"><td><input type="checkbox" data-history-select="${esc(order.id)}" ${historySelection.has(order.id) ? "checked" : ""}></td><td>${dateLabel(order.issuedAt)}</td><td><strong>${esc(order.number)}</strong>${usesInventory ? "" : "<small>SIN INVENTARIO</small>"}</td><td>${esc(BlessERP.comercialInvoiceSequence?.visibleInvoiceNumber?.(order) || "Pendiente")}</td><td>${esc(customerName(appState, order.customerId))}</td><td>${esc(brandName(appState, order.brandId))}</td><td>${totals.boxes}</td><td>${money(totals.total)}</td><td><span class="status-badge ${upper(order.status) === "ANULADO" ? "cancelled" : upper(order.status) === "COMPLETADO" ? "authorized" : "partial"}">${usesInventory ? esc(order.status) : "SIN INVENTARIO"}</span></td><td><div class="table-actions-inline commercial-history-v2-row-actions"><button type="button" class="secondary-button" data-history-edit="${esc(order.id)}">Editar</button>${usesInventory ? `<button type="button" class="secondary-button" data-history-track="${esc(order.id)}">Ver</button>` : ""}${usesInventory && upper(order.status) === "GUARDADO" ? `<button type="button" class="success-button" data-history-send="${esc(order.id)}">Cuarto Frío</button>` : ""}<button type="button" class="danger-button" data-history-annul="${esc(order.id)}">Anular</button></div></td></tr>`; }).join("") || `<tr><td colspan="10"><div class="empty-state compact">No existen pedidos con estos filtros.</div></td></tr>`}</tbody></table></div>${pagination(state, page)}
      </section>`;
  }

  async function printHistory(appState, docCode, button) {
    if (historyPrintPending.has(docCode)) return;
    const orders = [...historySelection].map(id => flow.findOrder(appState, id)).filter(Boolean);
    if (!orders.length) return toast("Seleccione al menos un pedido.", "warning");
    historyPrintPending.add(docCode);
    const original = button.textContent;
    const startedAt = BlessERP.performance?.now?.() || performance.now();
    const timings = { dataReady: startedAt };
    const mark = (stage, detail = {}) => {
      timings[stage] = BlessERP.performance?.now?.() || performance.now();
      BlessERP.performance?.record?.(`historial-documento:${docCode}:${stage}`, startedAt, detail);
    };
    button.disabled = true;
    button.textContent = "Generando...";
    try {
      mark("data-ready", { orders: orders.length });
      await loadHistoryPrintResources(docCode);
      mark("resources-ready", { groups: historyPrintGroups(docCode).length });
      if (button.isConnected) button.textContent = docCode === "ETIQUETAS" ? "Preparando etiquetas..." : "Preparando documento...";
      const result = await BlessERP.comercialPrintSystem.openDocuments(docCode, orders, appState, {
        autoPrint: true,
        awaitPrintReady: true,
        nonBlocking: true,
        onProgress: progress => {
          if (docCode !== "ETIQUETAS") return;
          if (progress.phase === "pages") mark("template-ready", { labels: progress.total });
          if (progress.phase === "file") mark("file-ready", { labels: progress.total });
          if (progress.phase === "download") mark("download-started", { labels: progress.total });
          if (!button.isConnected) return;
          button.textContent = progress.phase === "file"
            ? "PDF listo..."
            : progress.phase === "download"
              ? "Iniciando descarga..."
              : `Etiquetas ${progress.current}/${progress.total}...`;
        },
        onStage: (stage, detail = {}) => {
          mark(stage, { ...detail, orders: orders.length });
          if (!button.isConnected) return;
          if (stage === "template-ready") button.textContent = "Documento listo...";
          if (stage === "file-ready") button.textContent = "Iniciando descarga...";
        },
        pageSize: docCode === "ETIQUETAS" ? "CUSTOMS_LABEL" : "A4",
        options: docCode === "ETIQUETAS" ? { printType: "all" } : {}
      });
      mark("completed", { orders: orders.length, ok: Boolean(result) });
      console.info("[JAEDER PERF] Documento de Historial", {
        docCode,
        orders: orders.length,
        dataMs: Math.round(timings["data-ready"] - startedAt),
        resourcesMs: Math.round((timings["resources-ready"] || timings.completed) - startedAt),
        templateMs: timings["template-ready"] ? Math.round(timings["template-ready"] - startedAt) : null,
        fileMs: timings["file-ready"] ? Math.round(timings["file-ready"] - startedAt) : null,
        downloadMs: timings["download-started"] ? Math.round(timings["download-started"] - startedAt) : null,
        totalMs: Math.round((timings.completed || performance.now()) - startedAt)
      });
    } catch (error) { toast(error.message || "No se pudo generar el documento.", "danger"); }
    finally {
      historyPrintPending.delete(docCode);
      if (button.isConnected) { button.disabled = false; button.textContent = original; }
    }
  }

  function bindHistory(container, appState) {
    const state = flow.sessionFor(appState).history;
    const warmPrintCore = () => BlessERP.moduleLoader.loadGroup("commercial-history-print-core").catch(error => {
      console.warn("[JAEDER PERF] No se pudo precargar el núcleo de documentos.", error);
    });
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(warmPrintCore, { timeout: 1200 });
    else window.setTimeout(warmPrintCore, 0);
    container.addEventListener("change", event => {
      const field = event.target.closest("[data-history-select]"); if (!field) return;
      if (field.checked) historySelection.add(field.dataset.historySelect); else historySelection.delete(field.dataset.historySelect); rerenderPage();
    });
    container.addEventListener("pointerover", event => {
      const button = event.target.closest?.("[data-history-print]");
      if (button) prefetchHistoryPrint(button.dataset.historyPrint);
    });
    container.addEventListener("focusin", event => {
      const button = event.target.closest?.("[data-history-print]");
      if (button) prefetchHistoryPrint(button.dataset.historyPrint);
    });
    container.addEventListener("submit", event => {
      if (!event.target.matches("[data-history-filter]")) return; event.preventDefault(); const form = new FormData(event.target); state.date = String(form.get("date") || ""); state.market = String(form.get("market") || "TODOS"); state.search = String(form.get("search") || ""); state.page = 1; rerenderPage();
    });
    container.addEventListener("click", async event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.dataset.page) { state.page = Number(button.dataset.page); rerenderPage(); return; }
      if (button.hasAttribute("data-history-new")) { flow.newDraft(appState); route("commercial-order-master"); return; }
      if (button.hasAttribute("data-history-all")) { state.date = ""; state.page = 1; rerenderPage(); return; }
      if (button.dataset.historyEdit) { flow.openOrder(appState, button.dataset.historyEdit); route("commercial-order-master"); return; }
      if (button.dataset.historyTrack) { flow.sessionFor(appState).selectedOrderId = button.dataset.historyTrack; route("commercial-order-detail"); return; }
      if (button.dataset.historySend) { flow.openOrder(appState, button.dataset.historySend); button.disabled = true; const result = await flow.sendToColdRoomConfirmed(appState); toast(result.ok ? "Pedido enviado a Cuarto Frío." : result.error, result.ok ? "success" : "warning"); if (!result.ok && button.isConnected) button.disabled = false; rerenderPage(); return; }
      if (button.dataset.historyAnnul) {
        const reason = prompt("Motivo de anulación:", "Pedido cancelado antes de autorización SRI.");
        if (reason) {
          button.disabled = true;
          const result = await flow.annulOrder(appState, button.dataset.historyAnnul, reason);
          toast(result.ok ? "Pedido anulado y disponibilidad liberada." : result.error, result.ok ? "success" : "warning");
          if (!result.ok && button.isConnected) button.disabled = false;
          rerenderPage();
        }
        return;
      }
      if (button.dataset.historyPrint) void printHistory(appState, button.dataset.historyPrint, button);
    });
  }

  function getVisibleAvailabilityRows(appState) {
    const state = flow.sessionFor(appState).availability;
    const all = flow.getAvailabilityRows(appState);
    const varieties = [...new Set(all.map(row => row.variety))];
    const lengths = [...new Set(all.map(row => row.length))].sort((a, b) => a - b);
    const rows = all.filter(row => (state.variety === "TODAS" || row.variety === state.variety) && (state.length === "TODAS" || String(row.length) === String(state.length)));
    return { all, lengths, rows, state, varieties };
  }

  function availabilityRowsMarkup(appState, rows, state, valueMarkup) {
    const remoteActive = Boolean(flow.warehouseRepository?.());
    if (remoteActive && (state.remoteLoading || (!state.remoteAttempted && !state.remoteLoaded))) {
      return `<tr><td colspan="11"><div class="empty-state compact">Consultando disponibilidad compartida en Supabase…</div></td></tr>`;
    }
    if (remoteActive && state.remoteError) {
      return `<tr><td colspan="11"><div class="empty-state compact"><strong>No se pudo cargar la disponibilidad.</strong><br>${esc(state.remoteError)}<br>No se muestran existencias en cero porque Supabase no confirmó el resultado.</div></td></tr>`;
    }
    return rows.map(row => {
      const missingBunches = Math.max(row.demandBunches - row.scannedBunches - number(row.reservedBunches), 0);
      return `<tr><td>${varietyIdentity(appState, row.variety)}</td><td><span class="erp-table-chip availability-v2-measure">${row.length} CM</span></td><td><span class="availability-v2-quality">${esc(row.quality || "EXPORTACIÓN")}</span></td><td class="availability-v2-number-cell">${valueMarkup(row.physicalBunches)}</td><td class="availability-v2-number-cell">${valueMarkup(number(row.reservedBunches))}</td><td class="availability-v2-number-cell">${valueMarkup(number(row.packedBunches))}</td><td class="availability-v2-number-cell">${valueMarkup(number(row.blockedBunches))}</td><td class="availability-v2-number-cell">${valueMarkup(row.demandBunches)}</td><td class="availability-v2-number-cell availability-v2-missing-cell">${valueMarkup(missingBunches, missingBunches > 0 ? "has-shortage" : "")}</td><td class="availability-v2-number-cell availability-v2-available-cell"><strong class="availability-v2-available">${row.availableBunches}</strong></td><td class="availability-v2-number-cell availability-v2-stems-cell"><strong class="availability-v2-stems">${row.availableStems}</strong></td></tr>`;
    }).join("") || `<tr><td colspan="11"><div class="empty-state compact">No existe inventario disponible para estos filtros.</div></td></tr>`;
  }

  function buildAvailabilityCopyText(rows) {
    const lines = (rows || []).map(row => {
      const available = Math.max(number(row.availableBunches), 0);
      const variety = String(row.variety || "SIN VARIEDAD").trim() || "SIN VARIEDAD";
      const length = number(row.length);
      return `${variety} ${length} cm - ${available} ${available === 1 ? "ramo" : "ramos"}`;
    });
    return lines.length ? ["DISPONIBILIDAD", "", ...lines].join("\n") : "";
  }

  async function copyVisibleAvailability(appState) {
    const view = getVisibleAvailabilityRows(appState);
    if (!view.rows.length) {
      return { ok: false, empty: true, message: "No hay disponibilidad para copiar con los filtros actuales.", rows: [] };
    }
    const text = buildAvailabilityCopyText(view.rows);
    await BlessERP.operacionesAvailabilityPieces.writeText(text);
    return { ok: true, message: "Disponibilidad copiada", rows: view.rows, text };
  }

  function renderAvailability(appState, options = {}) {
    const { lengths, rows, state, varieties } = getVisibleAvailabilityRows(appState);
    const valueMarkup = (value, className = "") => `<span class="availability-v2-value ${Number(value) === 0 ? "is-zero" : ""} ${className}">${value}</span>`;
    return `<section class="page-header"><div><p class="section-kicker">DISPONIBILIDAD</p><h1>Inventario frente a pedidos guardados</h1><p>Guardar compromete la flor. Enviar a Cuarto Frío no descuenta una segunda vez.</p></div></section>
      <section class="panel-card commercial-v2-section availability-v2-card"><div class="commercial-v2-filters availability-v2-filters"><label>Variedad<select data-availability-field="variety">${textOptions(["TODAS", ...varieties], state.variety, "Todas")}</select></label><label>Medida<select data-availability-field="length">${textOptions(["TODAS", ...lengths], state.length, "Todas")}</select></label>${options.enableAvailabilityCopy === true ? `<button type="button" class="secondary-button" data-availability-copy>Copiar disponibilidad</button>` : ""}</div>
      <div class="table-wrap erp-table-scroll availability-v2-table-wrap"><table class="erp-data-table availability-v2-table"><thead><tr><th>Variedad</th><th>Medida</th><th>Calidad</th><th>Físico</th><th>Reservado</th><th>Empacado</th><th>Bloqueado</th><th>En pedido</th><th>Faltante</th><th>Disponible</th><th>Tallos disponibles</th></tr></thead><tbody>${availabilityRowsMarkup(appState, rows, state, valueMarkup)}</tbody></table></div></section>`;
  }

  function bindAvailability(container, appState) {
    const state = flow.sessionFor(appState).availability;
    if (flow.warehouseRepository?.() && !state.remoteLoaded && !state.remoteLoading && !state.remoteAttempted) {
      void flow.refreshAvailability(appState).then(() => rerenderPage());
    }
    container.addEventListener("change", event => { const field = event.target.closest("[data-availability-field]"); if (!field) return; flow.sessionFor(appState).availability[field.dataset.availabilityField] = field.value; rerenderPage(); });
    container.addEventListener("click", async event => {
      const button = event.target.closest("[data-availability-copy]");
      if (!button) return;
      button.disabled = true;
      try {
        const result = await copyVisibleAvailability(appState);
        toast(result.ok ? "Disponibilidad copiada" : result.message, result.ok ? "success" : "warning");
      } catch {
        toast("No se pudo copiar la disponibilidad.", "warning");
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
  }

  function renderPreorders(appState) {
    const draft = flow.preorderDraft(appState); const cats = flow.catalogs(appState); const preorders = appState.db.commercial.preorders || [];
    return `<section class="page-header"><div><p class="section-kicker">COMERCIAL / PO</p><h1>PO Nuevo</h1><p>Borrador opcional. No afecta disponibilidad, Cuarto Frío ni SRI hasta generar y guardar un pedido.</p></div></section>
      <section class="panel-card commercial-v2-section"><div class="commercial-v2-form-grid"><label>Número PO manual<input value="${esc(draft.number)}" data-po-field="number" placeholder="Opcional"></label><label>Cliente<select data-po-field="customerId">${options(cats.customers, draft.customerId, row => row.legalName || row.commercialName)}</select></label><label>Marca<select data-po-field="brandId">${options(cats.brands.filter(row => !draft.customerId || String(row.customerId) === String(draft.customerId)), draft.brandId, row => row.finalClientName || row.name)}</select></label><label>País<input value="${esc(draft.country)}" data-po-field="country" readonly></label><label>Fecha solicitada<input type="date" value="${esc(draft.requestedDate)}" data-po-field="requestedDate"></label></div>
      <div class="panel-card-head"><h3>Líneas / cajas</h3><button type="button" class="secondary-button" data-po-add-line>+ Línea</button></div><div class="table-wrap"><table><thead><tr><th>Caja</th><th>Tipo</th><th>Variedad</th><th>Calidad</th><th>Medida</th><th>Ramos</th><th>Tallos</th><th>Precio</th><th></th></tr></thead><tbody>${(draft.lines || []).map(line => `<tr><td><input type="number" value="${esc(line.boxNumber)}" data-po-line="${esc(line.id)}" data-po-line-field="boxNumber"></td><td><input value="${esc(line.boxType)}" data-po-line="${esc(line.id)}" data-po-line-field="boxType"></td><td><input value="${esc(line.variety)}" data-po-line="${esc(line.id)}" data-po-line-field="variety"></td><td><select data-po-line="${esc(line.id)}" data-po-line-field="quality">${qualityOptions(line.quality)}</select></td><td><input type="number" value="${esc(line.length)}" data-po-line="${esc(line.id)}" data-po-line-field="length"></td><td><input type="number" value="${esc(line.bunches)}" data-po-line="${esc(line.id)}" data-po-line-field="bunches"></td><td><input type="number" value="${esc(line.stemsPerBunch)}" data-po-line="${esc(line.id)}" data-po-line-field="stemsPerBunch"></td><td><input type="number" step="0.0001" value="${esc(line.unitPrice)}" data-po-line="${esc(line.id)}" data-po-line-field="unitPrice"></td><td><button type="button" class="icon-button" data-po-delete-line="${esc(line.id)}">×</button></td></tr>`).join("") || `<tr><td colspan="9"><div class="empty-state compact">Agregue las cajas probables del PO.</div></td></tr>`}</tbody></table></div><div class="commercial-v2-sticky-actions inline"><button type="button" class="primary-button" data-po-save>Guardar borrador PO</button></div></section>
      <section class="panel-card commercial-v2-section"><div class="panel-card-head"><h3>PO guardados</h3></div><div class="table-wrap"><table><thead><tr><th>PO</th><th>Fecha</th><th>Cliente</th><th>País</th><th>Líneas</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${preorders.map(row => `<tr><td>${esc(row.number)}</td><td>${dateLabel(row.requestedDate)}</td><td>${esc(customerName(appState, row.customerId))}</td><td>${esc(row.country)}</td><td>${row.lines?.length || 0}</td><td>${esc(row.status)}</td><td><button type="button" class="success-button" data-po-generate="${esc(row.id)}">Generar pedido</button></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty-state compact">Sin PO guardados.</div></td></tr>`}</tbody></table></div></section>`;
  }

  function bindPreorders(container, appState) {
    const draft = flow.preorderDraft(appState);
    container.addEventListener("input", event => {
      const field = event.target.closest("[data-po-field]"); if (field) { draft[field.dataset.poField] = field.value; return; }
      const lineField = event.target.closest("[data-po-line]"); if (lineField) { const line = draft.lines.find(row => row.id === lineField.dataset.poLine); if (line) line[lineField.dataset.poLineField] = ["boxNumber", "length", "bunches", "stemsPerBunch", "unitPrice"].includes(lineField.dataset.poLineField) ? number(lineField.value) : lineField.value; }
    });
    container.addEventListener("change", event => { const field = event.target.closest("[data-po-field]"); if (!field) return; draft[field.dataset.poField] = field.value; if (field.dataset.poField === "brandId") draft.country = flow.catalogs(appState).brands.find(row => row.id === field.value)?.country || ""; rerenderPage(); });
    container.addEventListener("click", event => { const button = event.target.closest("button"); if (!button) return;
      if (button.hasAttribute("data-po-add-line")) { draft.lines.push(BlessERP.comercialData.createLine({ boxNumber: draft.lines.length + 1, boxType: "HB", quality: "PREMIUM", unitPrice: 0 })); rerenderPage(); return; }
      if (button.dataset.poDeleteLine) { draft.lines = draft.lines.filter(row => row.id !== button.dataset.poDeleteLine); rerenderPage(); return; }
      if (button.hasAttribute("data-po-save")) { const result = flow.savePreorder(appState); toast(result.ok ? `PO ${result.preorder.number} guardado.` : result.error, result.ok ? "success" : "warning"); if (result.ok) rerenderPage(); return; }
      if (button.dataset.poGenerate) { const result = flow.preorderToOrder(appState, button.dataset.poGenerate); if (!result.ok) toast(result.error, "warning"); else route("commercial-order-master"); }
    });
  }

  BlessERP.comercialPedido = { render: renderOrder, bind: bindOrder };
  BlessERP.comercialPreorders = { render: renderPreorders, bind: bindPreorders };
  BlessERP.comercialOrderDetail = {
    render: (appState, view = "SEGUIMIENTO") => renderTracking(appState, view),
    bind: (container, appState, view) => bindTracking(container, appState, view || (BlessERP.state.currentRoute()?.id === "commercial-order-coordination" ? "COORDINACION" : "SEGUIMIENTO")),
    unmount: unmountTracking,
    open(orderId) {
      const appState = BlessERP.state?.state;
      if (appState) flow.sessionFor(appState).selectedOrderId = orderId;
    }
  };
  BlessERP.comercialHistory = { render: renderHistory, bind: bindHistory, invalidateRemotePage() {} };
  BlessERP.comercialAvailability = {
    bind: bindAvailability,
    buildCopyText: buildAvailabilityCopyText,
    copyVisible: copyVisibleAvailability,
    getVisibleRows: appState => getVisibleAvailabilityRows(appState).rows,
    render: renderAvailability
  };
  BlessERP.comercialPedidoDemandView = {
    renderAvailability: (_order, appState, options = {}) => renderAvailability(appState, options),
    bindAvailability: (container, appState) => bindAvailability(container, appState)
  };
})();
