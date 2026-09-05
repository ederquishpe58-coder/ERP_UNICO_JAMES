(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function isOpenMixedLine(line) {
    return String(line?.boxBuildMode || "").toUpperCase() === "MIXTO_ABIERTO";
  }

  function isAnyLengthLine(line) {
    return line?.anyLength === true || (isOpenMixedLine(line) && line?.mixedAnyLength !== false);
  }

  function actualComposition(line) {
    if (!isOpenMixedLine(line)) return "";
    const rows = Array.isArray(line.mixedActualComposition) ? line.mixedActualComposition : [];
    if (!rows.length) return "Pendiente de escaneo en Bodega";
    return rows.map(item => `${item.variety} ${item.length} cm: ${item.bunches}`).join(" · ");
  }

  function availabilityLengthValue(row) {
    return row?.anyLength ? "CUALQUIER MEDIDA" : String(row?.length || "");
  }

  function availabilityDisplayStatus(row) {
    if (row?.pendingMixedPlaceholder) return "PENDIENTE_ESCANEO_MIXTO";
    if (Number(row?.availableForSaleBunches || 0) > 0) return "DISPONIBLE";
    if (Number(row?.shortageBunches || 0) > 0) return "SIN_DISPONIBILIDAD";
    return "AGOTADO";
  }

  function varietyImageUrl(appState, variety) {
    const store = BlessERP.operacionesState?.getStore?.(appState);
    const normalized = String(variety || "").trim().toUpperCase();
    const item = (store?.masterData?.varieties || []).find(entry => String(entry?.name || "").trim().toUpperCase() === normalized);
    const imagePath = String(item?.imagePath || "").trim();
    if (imagePath) return BlessERP.getVarietyImageRepository?.()?.publicUrl?.(imagePath) || "";
    const candidate = String(item?.imageUrl || item?.photoUrl || item?.image || item?.photo || "").trim();
    return /^(https?:\/\/|blob:|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(candidate) ? candidate : "";
  }

  function varietyInitials(variety) {
    const words = String(variety || "").trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "FL").toUpperCase();
  }

  function renderVarietyIdentity(appState, row, utils) {
    const name = String(row?.variety || "Sin variedad");
    const imageUrl = varietyImageUrl(appState, name);
    const visual = imageUrl
      ? `<img class="erp-variety-thumb" src="${utils.esc(imageUrl)}" alt="Fotografía de ${utils.esc(name)}" loading="lazy" decoding="async">`
      : `<span class="erp-variety-thumb erp-variety-placeholder" aria-hidden="true">${utils.esc(varietyInitials(name))}</span>`;
    const detail = row?.pendingMixedPlaceholder
      ? "Composición pendiente de confirmar en Caja y escáner"
      : Number(row?.mixedScannedBunches || 0) > 0
        ? `${utils.number(row.mixedScannedBunches)} ramo(s) consumido(s) por caja mixta`
        : row?.openMixed ? "Mixto abierto" : "";
    return `<div class="erp-variety-cell">${visual}<span class="erp-variety-copy"><strong>${utils.esc(name)}</strong>${detail ? `<small>${utils.esc(detail)}</small>` : ""}</span></div>`;
  }

  function renderLengthOptions(lengths, line, utils) {
    const anyValue = BlessERP.comercialBoxBuilder.ANY_LENGTH;
    const anyLength = isAnyLengthLine(line);
    return `<option value="${anyValue}" ${anyLength ? "selected" : ""}>CUALQUIER MEDIDA</option>${lengths.map(length => `<option value="${utils.esc(length)}" ${!anyLength && Number(length) === Number(line.length) ? "selected" : ""}>${utils.esc(length)} cm</option>`).join("")}`;
  }

  function renderLines(order, appState, options) {
    const { utils, stateApi, boxTypes, operationalVarieties, operationalLengths, linesLocked, disabledAttr } = options;
    const metrics = utils.getOrderMetrics(order);
    const fulfillment = BlessERP.comercialOrderFulfillment.getOrderFulfillment(appState, order.id);
    const fulfillmentBoxes = (Array.isArray(fulfillment?.boxes) ? fulfillment.boxes : [])
      .filter(box => box && typeof box === "object");
    const progressByLine = new Map(fulfillmentBoxes
      .flatMap(box => (Array.isArray(box.lines) ? box.lines : []))
      .filter(item => item?.line?.id)
      .map(item => [item.line.id, item]));

    return `
      <section class="summary-grid">
        <article class="summary-card"><span>Cajas del pedido</span><strong>${utils.esc(fulfillment?.totalBoxes || 0)}</strong><small>Definidas por Comercial</small></article>
        <article class="summary-card"><span>Ramos solicitados</span><strong>${utils.esc(fulfillment?.requiredBunches || 0)}</strong><small>Demanda comercial</small></article>
        <article class="summary-card"><span>Ramos escaneados</span><strong>${utils.esc(fulfillment?.scannedBunches || 0)}</strong><small>Asignados fisicamente por Bodega</small></article>
        <article class="summary-card"><span>Ramos pendientes</span><strong>${utils.esc(fulfillment?.pendingBunches || 0)}</strong><small>Sin reserva previa</small></article>
      </section>
      <section class="hero-banner commercial-inline-banner">
        <div><strong>Flujo sin reservas de ramos</strong><span>La orden genera demanda proyectada. La flor sigue disponible hasta validar su codigo dentro de una caja del pedido.</span></div>
        <span class="status-badge ${utils.badgeClass(order.warehouseStatus || "NO_LIBERADO")}">${utils.esc(order.warehouseStatus || "NO_LIBERADO")}</span>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">CAJAS Y VARIEDADES</p><h3>Detalle solicitado por el cliente</h3></div>
          <button class="secondary-button" data-commercial-add-line ${disabledAttr(linesLocked)}>${order.revisionEditing ? "Agregar caja nueva" : "Agregar linea"}</button>
        </div>
        <p class="panel-note">Al liberar el pedido a Bodega, las cajas quedan bloqueadas para evitar diferencias durante el armado. Bodega completa cada linea mediante escaneo.</p>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table commercial-lines-table">
            <thead><tr><th>Caja</th><th>Tipo</th><th>Variedad</th><th>PO</th><th>cm</th><th>Ramos</th><th>T/R</th><th>Tallos</th><th>P.Unit</th><th>Total</th><th>Armado Bodega</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>${metrics.lines.map((line, index) => {
              const progress = progressByLine.get(line.id) || { scanned: 0, pending: line.bunches, status: "PENDIENTE" };
              const rowLocked = order.revisionEditing
                ? Number(line.addedRevision || 1) !== Number(order.revisionDraftNumber)
                : linesLocked;
              const revisionBadge = Number(line.addedRevision || 1) > 1
                ? `<small class="status-badge ${Number(line.addedRevision) === Number(order.revisionNumber || order.revisionDraftNumber) ? "pending" : "partial"}">R${utils.esc(line.addedRevision)}</small>`
                : "";
              return `<tr class="${index > 0 && metrics.lines[index - 1].boxNumber !== line.boxNumber ? "commercial-box-break" : ""}">
                <td><input type="number" min="1" value="${utils.esc(line.boxNumber)}" data-commercial-line-field="${utils.esc(line.id)}|boxNumber" ${disabledAttr(rowLocked)}>${revisionBadge}</td>
                <td><select data-commercial-line-field="${utils.esc(line.id)}|boxType" ${disabledAttr(rowLocked)}>${boxTypes.map(item => `<option value="${utils.esc(item.code)}" ${item.code === line.boxType ? "selected" : ""}>${utils.esc(item.code)}</option>`).join("")}</select></td>
                <td>${isOpenMixedLine(line) ? `<input value="MIXTO ABIERTO" disabled><small class="master-mix-actual">${utils.esc(actualComposition(line))}</small>` : `<select data-commercial-line-field="${utils.esc(line.id)}|variety" ${disabledAttr(rowLocked)}>${operationalVarieties.map(item => `<option value="${utils.esc(item)}" ${item === line.variety ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select>`}</td>
                <td><input type="text" value="${utils.esc(line.po || "")}" data-commercial-line-field="${utils.esc(line.id)}|po" ${disabledAttr(rowLocked)}></td>
                <td><select data-commercial-line-field="${utils.esc(line.id)}|lengthSelection" ${disabledAttr(rowLocked)}>${renderLengthOptions(operationalLengths, line, utils)}</select></td>
                <td><input type="number" min="1" value="${utils.esc(line.bunches)}" data-commercial-line-field="${utils.esc(line.id)}|bunches" ${disabledAttr(rowLocked)}></td>
                <td><input type="number" min="1" value="${utils.esc(line.stemsPerBunch)}" data-commercial-line-field="${utils.esc(line.id)}|stemsPerBunch" ${disabledAttr(rowLocked)}></td>
                <td class="numeric">${utils.esc(utils.number(line.totalStems))}</td>
                <td><input type="number" min="0" step="0.001" value="${utils.esc(line.unitPrice)}" data-commercial-line-field="${utils.esc(line.id)}|unitPrice" ${disabledAttr(rowLocked)}></td>
                <td class="numeric">${utils.esc(utils.money(line.totalLine))}</td>
                <td><strong>${utils.esc(progress.scanned)} / ${utils.esc(line.bunches)}</strong><br><small>${utils.esc(progress.pending)} pendiente(s)</small></td>
                <td><span class="status-badge ${utils.badgeClass(progress.status)}">${utils.esc(progress.status)}</span></td>
                <td><div class="table-actions-inline"><button class="secondary-button" data-commercial-duplicate-line="${utils.esc(line.id)}" ${disabledAttr(rowLocked)}>Duplicar</button><button class="secondary-button" data-commercial-delete-line="${utils.esc(line.id)}" ${disabledAttr(rowLocked)}>Eliminar</button></div></td>
              </tr>`;
            }).join("") || `<tr><td colspan="13">No hay lineas. Agregue la primera caja.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderOperationalAvailability(appState, utils, stateApi, options = {}) {
    const commercialAccess = options.commercialAccess === true;
    const policy = BlessERP.operacionesAvailabilityPolicy;
    const fulfillmentApi = BlessERP.comercialOrderFulfillment;
    const ui = stateApi.getUi(appState);
    const settings = policy.getSettings(appState);
    const horizon = String(ui.availabilityHorizon || "HOY").toUpperCase();
    const range = policy.horizonRange(horizon);
    const sourceRows = fulfillmentApi.getAvailabilityRows(appState);
    const inventoryRows = sourceRows.filter(row => (
      Number(row.physicalInventoryBunches || 0) > 0
      || Number(row.activeOrderBunches || 0) > 0
      || Number(row.demandPendingBunches || 0) > 0
      || Number(row.mixedScannedBunches || 0) > 0
      || (row.pendingMixedPlaceholder && Number(row.demandPendingBunches || 0) > 0)
    ));
    const availableVarieties = [...new Set(inventoryRows
      .filter(row => !row.pendingMixedPlaceholder && Number(row.physicalInventoryBunches || 0) > 0)
      .map(row => String(row.variety || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "es"));
    const requestedVariety = String(ui.availabilityFilterVariety || "TODOS");
    const selectedVariety = availableVarieties.includes(requestedVariety) ? requestedVariety : "TODOS";
    const rowsForMeasures = selectedVariety === "TODOS"
      ? inventoryRows
      : inventoryRows.filter(row => row.variety === selectedVariety);
    const measureKey = row => row.anyLength ? "CUALQUIER_MEDIDA" : String(Number(row.length) || row.length || "");
    const measureLabel = key => key === "CUALQUIER_MEDIDA" ? "CUALQUIER MEDIDA" : `${key} cm`;
    const availableMeasures = [...new Set(rowsForMeasures.map(measureKey).filter(Boolean))]
      .sort((left, right) => left === "CUALQUIER_MEDIDA" ? 1 : right === "CUALQUIER_MEDIDA" ? -1 : Number(left) - Number(right));
    const requestedMeasure = String(ui.availabilityFilterLength || "TODOS");
    const selectedMeasure = availableMeasures.includes(requestedMeasure) ? requestedMeasure : "TODOS";
    const rows = rowsForMeasures.filter(row => selectedMeasure === "TODOS" || measureKey(row) === selectedMeasure);
    const availabilityPage = BlessERP.performance?.paginate?.(rows, "commercial-availability", { pageSize: 50 })
      || { items: rows.slice(0, 50), total: rows.length, pageSize: 50 };
    const pieceRows = BlessERP.operacionesAvailabilityPieces?.getRows?.(appState, {
      variety: selectedVariety,
      length: selectedMeasure,
      bunchesPerPiece: ui.availabilityBunchesPerPiece
    }) || [];
    const bunchesPerPiece = BlessERP.operacionesAvailabilityPieces?.normalizeBunchesPerPiece?.(ui.availabilityBunchesPerPiece) || 12;
    const pieceExampleBunches = 65;
    const pieceExampleCount = Math.ceil(pieceExampleBunches / bunchesPerPiece);
    const pieceExampleRemainder = pieceExampleBunches % bunchesPerPiece;
    const pieceExampleMissing = pieceExampleRemainder ? bunchesPerPiece - pieceExampleRemainder : 0;
    const scheduledOrders = settings.showFutureOrders
      ? (BlessERP.comercialIntercompany?.getScheduledOrders?.(appState, horizon) || policy.getScheduledOrders(appState, horizon))
      : [];
    const totals = {
      futureOrders: scheduledOrders.length,
      futureBunches: scheduledOrders.reduce((sum, item) => sum + Number(item.bunches || 0), 0),
      reservedOrders: scheduledOrders.filter(item => item.reserved).length,
      reservedBunches: scheduledOrders.filter(item => item.reserved).reduce((sum, item) => sum + Number(item.bunches || 0), 0),
      informativeOrders: scheduledOrders.filter(item => !item.reserved).length
    };
    const booleanSetting = (field, label, help) => `
      <label class="availability-setting-toggle">
        <input type="checkbox" data-ops-availability-setting="${field}" ${settings[field] ? "checked" : ""}>
        <span><strong>${utils.esc(label)}</strong><small>${utils.esc(help)}</small></span>
      </label>
    `;
    const lastUpdated = ui.availabilityLastUpdated
      ? new Date(ui.availabilityLastUpdated).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })
      : "Pendiente";

    return `
      <section class="page-header availability-page-header erp-page-card erp-page-hero">
        <div><p class="section-kicker">${commercialAccess ? "COMERCIAL / EXPORTACIONES" : "OPERACIONES / POSCOSECHA"}</p><h1>Disponibilidad</h1><p class="erp-page-lead"><strong>Inventario frente a pedidos guardados</strong><span>Inventario físico frente a pedidos activos. Los pedidos futuros son informativos por defecto y pueden reservarse desde esta pantalla.</span></p></div>
        <div class="page-header-side"><span class="status-badge authorized">Disponible Spot en tiempo real</span><small>Actualizado: ${utils.esc(lastUpdated)}</small></div>
      </section>
      <section class="panel-card availability-control-card erp-page-card erp-filter-bar">
        <div class="panel-card-head">
          <div><p class="section-kicker">PERIODO DE CONSULTA</p><h3>${utils.esc(range.label)}</h3></div>
          <div class="table-actions-inline availability-period-actions">
            <button class="${horizon === "HOY" ? "primary-button" : "secondary-button"}" data-ops-ui-field="availabilityHorizon" data-value="HOY">Hoy</button>
            <button class="${horizon === "MANANA" ? "primary-button" : "secondary-button"}" data-ops-ui-field="availabilityHorizon" data-value="MANANA">Mañana</button>
            <button class="${horizon === "SEMANA" ? "primary-button" : "secondary-button"}" data-ops-ui-field="availabilityHorizon" data-value="SEMANA">Semana</button>
            <button class="secondary-button availability-pieces-button" data-ops-action="availability-pieces-open">Disponibilidad por piezas</button>
            <button class="secondary-button" data-ops-action="availability-refresh">Actualizar</button>
          </div>
        </div>
        <p class="panel-note">Use Mañana o Semana para revisar pedidos futuros. Reservar un pedido descuenta inmediatamente su variedad y medida del Disponible Spot; liberarlo devuelve esa disponibilidad.</p>
        <div class="availability-filter-grid">
          <label class="compact-field"><span>Variedad disponible</span><select data-ops-ui-field="availabilityFilterVariety"><option value="TODOS">Todas las variedades</option>${availableVarieties.map(variety => `<option value="${utils.esc(variety)}" ${selectedVariety === variety ? "selected" : ""}>${utils.esc(variety)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Medida disponible</span><select data-ops-ui-field="availabilityFilterLength"><option value="TODOS">Todas las medidas</option>${availableMeasures.map(measure => `<option value="${utils.esc(measure)}" ${selectedMeasure === measure ? "selected" : ""}>${utils.esc(measureLabel(measure))}</option>`).join("")}</select></label>
          <div class="availability-filter-result"><span>Combinaciones mostradas</span><strong>${utils.number(rows.length)} de ${utils.number(inventoryRows.length)}</strong><small>Inventario físico o pedidos pendientes</small></div>
        </div>
      </section>
      ${settings.showFutureOrders ? `<section class="hero-banner commercial-inline-banner availability-future-banner">
        <div><strong>Pedidos futuros: informativos o reservados</strong><span>${totals.futureOrders ? `${totals.informativeOrders} informativo(s) y ${totals.reservedOrders} reservado(s) en ${range.label.toLowerCase()}. Las reservas descuentan ${totals.reservedBunches} bonches del Disponible Spot.` : `No existen pedidos futuros en el periodo ${range.label.toLowerCase()}. Pruebe con Mañana o Semana.`}</span></div>
        <span class="status-badge ${totals.reservedOrders ? "authorized" : "partial"}">${totals.reservedOrders ? "RESERVAS ACTIVAS" : "SIN RESERVAS"}</span>
      </section>` : ""}
      <section class="panel-card availability-main-table erp-page-card erp-data-card">
        <div class="panel-card-head"><div><p class="section-kicker">INVENTARIO Y DEMANDA</p><h3>Disponibilidad por variedad y medida</h3></div><span>${utils.number(rows.length)} existencia(s)</span></div>
        <p class="panel-note">Las cajas mixtas pendientes se muestran separadas y no se reparten entre variedades. Cada lectura de Bodega descuenta únicamente la variedad y medida reales del ramo escaneado; al completar el mixto, el pendiente desaparece.</p>
        <div class="compact-table-wrap erp-table-scroll"><table class="compact-table availability-operational-table erp-data-table"><thead><tr><th>Variedad</th><th>Medida</th><th>Físico</th><th>Pedido Bless</th><th>Pedido Imperio</th><th>Pedido Activo</th><th>Pendiente</th><th>Disponible Spot</th><th>Tallos disponibles</th></tr></thead><tbody>
          ${availabilityPage.items.map(row => `<tr>
            <td>${renderVarietyIdentity(appState, row, utils)}</td>
            <td><span class="erp-table-chip">${utils.esc(row.pendingMixedPlaceholder && row.anyLength ? "POR CONFIRMAR" : row.anyLength ? "CUALQUIER MEDIDA" : `${utils.number(row.length)} cm`)}</span></td>
            <td class="erp-numeric-cell">${row.pendingMixedPlaceholder ? "—" : utils.number(row.physicalInventoryBunches || 0)}</td>
            <td class="erp-numeric-cell">${utils.number(row.blessActiveOrderBunches || 0)}</td>
            <td class="erp-numeric-cell">${utils.number(row.imperioActiveOrderBunches || 0)}</td>
            <td class="erp-numeric-cell">${utils.number(row.activeOrderBunches || 0)}</td>
            <td class="erp-numeric-cell"><span class="${Number(row.demandPendingBunches || 0) > 0 ? "availability-risk-number" : ""}">${utils.number(row.demandPendingBunches || 0)}</span></td>
            <td class="erp-numeric-cell availability-spot-cell">${row.pendingMixedPlaceholder ? "—" : `<strong class="availability-spot-number">${utils.number(row.spotAvailableBunches || 0)}</strong>`}</td>
            <td class="erp-numeric-cell">${row.pendingMixedPlaceholder ? "—" : utils.number(Number(row.spotAvailableBunches || 0) * Number(row.stemsPerBunch || 0))}</td>
          </tr>`).join("") || `<tr><td colspan="9">No existe inventario físico disponible para los filtros seleccionados.</td></tr>`}
        </tbody></table></div>
        <div class="erp-pagination">${BlessERP.performance?.renderPager?.(availabilityPage) || ""}</div>
      </section>
      ${settings.showFutureOrders && scheduledOrders.length ? `<section class="panel-card availability-future-orders"><div class="panel-card-head"><div><p class="section-kicker">RESERVAS FUTURAS</p><h3>Pedidos futuros de ${utils.esc(range.label.toLowerCase())}</h3><p class="panel-note">La reserva aplica a todo el pedido. “CUALQUIER MEDIDA” conserva su condición flexible y los mixtos abiertos se descuentan conforme se confirma su composición real.</p></div><span class="status-badge authorized">Gestión desde Disponibilidad</span></div><div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Pedido</th><th>Fecha preparación</th><th>Cliente</th><th>Bonches</th><th>Tratamiento</th><th>Acción</th></tr></thead><tbody>${scheduledOrders.map(item => `<tr><td><strong>${utils.esc(item.order.number || item.order.id)}</strong></td><td>${utils.esc(item.preparationDate)}</td><td>${utils.esc(item.order.customerName || item.order.customerId || "-")}</td><td>${utils.number(item.bunches)}</td><td><span class="status-badge ${item.reserved ? "authorized" : "partial"}">${item.reserved ? "RESERVADO · DESCUENTA" : "ALERTA INFORMATIVA"}</span></td><td><button class="${item.reserved ? "secondary-button" : "primary-button"}" type="button" data-ops-action="${item.reserved ? "availability-release-order" : "availability-reserve-order"}" data-order-id="${utils.esc(item.order.id)}">${item.reserved ? "Liberar reserva" : "Reservar disponibilidad"}</button></td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${commercialAccess ? "" : `<section class="panel-card availability-settings-card">
        <div class="panel-card-head"><div><p class="section-kicker">PARÁMETROS</p><h3>Activación y alertas</h3></div><span class="status-badge authorized">Persistentes</span></div>
        <div class="availability-settings-grid">
          ${booleanSetting("autoActivateOrders", "Activar pedidos automáticamente al iniciar el día", "El pedido del día pasa a Activo desde la hora configurada.")}
          <label class="compact-field"><span>Hora de activación</span><input type="time" value="${utils.esc(settings.activationTime)}" data-ops-availability-setting="activationTime"></label>
          ${booleanSetting("mondayToSaturday", "Trabajar lunes a sábado", "El domingo no ejecuta activación automática.")}
          ${booleanSetting("showFutureOrders", "Mostrar pedidos futuros", "Aparecen informativos por defecto y permiten reservarlos manualmente.")}
          ${booleanSetting("allowRiskSales", "Permitir ventas con alerta", "El riesgo futuro se advierte, pero no bloquea la venta.")}
          ${booleanSetting("requireRiskObservation", "Solicitar observación al continuar una venta con riesgo", "La observación queda guardada en el historial del pedido.")}
          <label class="compact-field"><span>Días de proyección</span><select data-ops-availability-setting="projectionDays">${[1, 3, 7].map(days => `<option value="${days}" ${settings.projectionDays === days ? "selected" : ""}>${days} día${days === 1 ? "" : "s"}</option>`).join("")}</select></label>
        </div>
      </section>`}
      ${ui.availabilityPiecesOpen ? `<div class="ops-mixed-modal-backdrop availability-pieces-backdrop" data-ops-availability-pieces-dialog role="dialog" aria-modal="true" aria-labelledby="availability-pieces-title">
        <article class="panel-card availability-pieces-dialog">
          <div class="panel-card-head availability-pieces-head">
            <div><p class="section-kicker">DISPONIBILIDAD BLESS FLOWER</p><h3 id="availability-pieces-title">Disponibilidad por piezas</h3></div>
            <button class="ops-modal-close" type="button" data-ops-action="availability-pieces-close" aria-label="Cerrar">×</button>
          </div>
          <div class="availability-pieces-config">
            <p class="panel-note">Cada pieza usa bonches de la misma variedad y medida. La última pieza también se muestra cuando está incompleta.</p>
            <label class="compact-field"><span>Bonches por pieza</span><select data-ops-ui-field="availabilityBunchesPerPiece">${[4, 12, 14].map(value => `<option value="${value}" ${bunchesPerPiece === value ? "selected" : ""}>${value} bonches</option>`).join("")}</select></label>
          </div>
          <div class="availability-pieces-summary">
            <span><strong>${utils.number(pieceRows.length)}</strong> combinaciones disponibles</span>
            <span><strong>${utils.number(bunchesPerPiece)}</strong> bonches por pieza · Solo se copiarán las tres primeras columnas.</span>
          </div>
          <div class="compact-table-wrap availability-pieces-table-wrap">
            <table class="compact-table availability-pieces-table">
              <thead><tr><th>NRO. PIEZA</th><th>VARIEDAD</th><th>MEDIDA</th><th class="availability-pieces-internal">ESTADO</th><th class="availability-pieces-internal">RAMOS DISPONIBLES</th><th class="availability-pieces-internal">FALTANTES</th></tr></thead>
              <tbody>${pieceRows.map(row => `<tr>
                <td class="numeric"><strong>${utils.number(row.pieces)}</strong></td>
                <td><strong>${utils.esc(row.variety)}</strong></td>
                <td>${utils.number(row.length)} CM</td>
                <td class="availability-pieces-internal"><strong class="${row.missingBunches ? "availability-piece-incomplete" : "availability-piece-complete"}">${utils.esc(row.status)}</strong></td>
                <td class="numeric availability-pieces-internal"><strong>${utils.number(row.availableBunches)}</strong></td>
                <td class="numeric availability-pieces-internal"><strong>${utils.number(row.missingBunches)}</strong></td>
              </tr>`).join("") || `<tr><td colspan="6">No hay bonches disponibles para formar piezas con los filtros seleccionados.</td></tr>`}</tbody>
            </table>
          </div>
          <div class="availability-pieces-footer">
            <small>Ejemplo actual: ${utils.number(pieceExampleBunches)} bonches = ${utils.number(pieceExampleCount)} pieza(s) de ${utils.number(bunchesPerPiece)}${pieceExampleMissing ? `; faltan ${utils.number(pieceExampleMissing)} para completar la última` : "; todas completas"}.</small>
            <div class="table-actions-inline">
              <button class="primary-button" data-ops-action="availability-pieces-copy" ${pieceRows.length ? "" : "disabled"}>Copiar disponibilidad</button>
              <button class="secondary-button" data-ops-action="availability-pieces-close">Cerrar</button>
            </div>
          </div>
        </article>
      </div>` : ""}
    `;
  }

  function renderAvailability(order, appState, options = {}) {
    const utils = BlessERP.comercialUtils;
    const operationsContext = options.context === "operations";
    const stateApi = operationsContext ? BlessERP.operacionesState : BlessERP.comercialState;
    if (operationsContext && BlessERP.operacionesAvailabilityPolicy) return renderOperationalAvailability(appState, utils, stateApi, options);
    const ui = stateApi.getUi(appState);
    const allValue = operationsContext ? "TODOS" : "";
    const hasFilter = value => Boolean(value && String(value).toUpperCase() !== "TODOS");
    const filterAttribute = field => operationsContext
      ? `data-ops-ui-field="${field}"`
      : `data-commercial-availability-filter="${field}"`;
    const rows = BlessERP.comercialOrderFulfillment.getAvailabilityRows(appState);
    const filtered = rows.filter(row => {
      if (hasFilter(ui.availabilityFilterVariety) && row.variety !== ui.availabilityFilterVariety) return false;
      if (hasFilter(ui.availabilityFilterLength) && availabilityLengthValue(row) !== String(ui.availabilityFilterLength).replace("CUALQUIER_MEDIDA", "CUALQUIER MEDIDA")) return false;
      return true;
    });
    const varieties = [...new Set(rows.map(row => row.variety).filter(Boolean))].sort();
    const lengths = [...new Set(rows.map(availabilityLengthValue).filter(Boolean))].sort((a, b) => {
      if (a === "CUALQUIER MEDIDA") return -1;
      if (b === "CUALQUIER MEDIDA") return 1;
      return Number(a) - Number(b);
    });
    const physicalTotal = rows.filter(row => !row.openMixed && !row.anyLength).reduce((sum, row) => sum + row.physicalBunches, 0);
    const demandTotal = rows.reduce((sum, row) => sum + row.demandPendingBunches, 0);
    const fixedDemandTotal = rows.filter(row => !row.pendingMixedPlaceholder).reduce((sum, row) => sum + row.demandPendingBunches, 0);
    const mixedPendingTotal = Math.max(demandTotal - fixedDemandTotal, 0);
    const totals = {
      physical: physicalTotal,
      demand: demandTotal,
      available: Math.max(physicalTotal - fixedDemandTotal, 0),
      shortage: Math.max(fixedDemandTotal - physicalTotal, 0),
      mixedPending: mixedPendingTotal
    };
    const fulfillment = order ? BlessERP.comercialOrderFulfillment.getOrderFulfillment(appState, order.id) : null;
    const orderRows = (Array.isArray(fulfillment?.boxes) ? fulfillment.boxes : [])
      .filter(box => box && typeof box === "object")
      .flatMap(box => (Array.isArray(box.lines) ? box.lines : [])
        .filter(item => item && typeof item === "object")
        .map(item => ({ box, ...item })));

    const content = `
      <section class="summary-grid">
        <article class="summary-card"><span>Ramos en inventario</span><strong>${utils.number(totals.physical)}</strong><small>Escaneados y fisicamente disponibles</small></article>
        <article class="summary-card"><span>Ramos en pedidos</span><strong>${utils.number(totals.demand)}</strong><small>${totals.mixedPending ? `${utils.number(totals.mixedPending)} mixto(s) pendientes de composición` : "Pendientes desde VALIDADO_COMERCIAL"}</small></article>
        <article class="summary-card"><span>Disponibles para venta</span><strong>${utils.number(totals.available)}</strong><small>Inventario menos pedidos activos</small></article>
        <article class="summary-card"><span>Faltante</span><strong>${utils.number(totals.shortage)}</strong><small>Demanda que supera al inventario</small></article>
      </section>
      <section class="hero-banner commercial-inline-banner">
        <div><strong>Disponibilidad comercial para venta</strong><span>Los pedidos sólidos descuentan su variedad y medida. Los mixtos permanecen como compromiso pendiente y descuentan la combinación real conforme Bodega escanea cada ramo.</span></div>
        <span class="status-badge partial">Sin reservas</span>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">FILTROS</p><h3>Inventario frente a demanda abierta</h3></div><button class="secondary-button" data-route-link="${operationsContext ? "commercial-availability-reservations" : "operations-availability"}">${operationsContext ? "Abrir Ventas / Exportaciones" : "Ver origen operativo"}</button></div>
        <div class="compact-form-grid">
          <label class="compact-field"><span>Variedad</span><select ${filterAttribute("availabilityFilterVariety")}><option value="${allValue}">Todas</option>${varieties.map(item => `<option value="${utils.esc(item)}" ${item === ui.availabilityFilterVariety ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Medida</span><select ${filterAttribute("availabilityFilterLength")}><option value="${allValue}">Todas</option>${lengths.map(item => `<option value="${utils.esc(operationsContext && item === "CUALQUIER MEDIDA" ? "CUALQUIER_MEDIDA" : item)}" ${String(item) === String(ui.availabilityFilterLength).replace("CUALQUIER_MEDIDA", "CUALQUIER MEDIDA") ? "selected" : ""}>${utils.esc(item === "CUALQUIER MEDIDA" ? item : `${item} cm`)}</option>`).join("")}</select></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">DISPONIBILIDAD PARA VENTA</p><h3>Inventario menos pedidos activos</h3></div><span>${utils.esc(filtered.length)} combinaciones</span></div>
        <p class="panel-note">Los borradores no afectan la disponibilidad. En cajas mixtas, el pendiente se muestra aparte: no se asigna a Explorer, Mondial u otra variedad hasta leer la etiqueta real en Cuarto frío.</p>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Variedad</th><th>Medida</th><th>Ramos inventario</th><th>Tallos/ramo</th><th>Pedido Bless</th><th>Pedido Imperio</th><th>Total pedidos</th><th>Disponibles venta</th><th>Faltante</th><th>Estado</th></tr></thead>
          <tbody>${filtered.map(row => {
            const displayStatus = availabilityDisplayStatus(row);
            return `<tr><td><strong>${utils.esc(row.variety)}</strong>${row.pendingMixedPlaceholder ? `<br><small>Compromiso temporal; Bodega define variedad y medida al escanear.</small>` : Number(row.mixedScannedBunches || 0) > 0 ? `<br><small>${utils.number(row.mixedScannedBunches)} ramo(s) confirmado(s) desde mixto.</small>` : row.anyLength ? `<br><small>Variedad fija con medida abierta.</small>` : ""}</td><td>${utils.esc(row.pendingMixedPlaceholder && row.anyLength ? "POR CONFIRMAR" : row.anyLength ? "CUALQUIER MEDIDA" : `${utils.number(row.length)} cm`)}</td><td>${row.pendingMixedPlaceholder ? "—" : utils.number(row.physicalBunches)}</td><td>${utils.number(row.stemsPerBunch)}</td><td>${utils.number(row.blessPendingOrderBunches)}</td><td>${utils.number(row.imperioPendingOrderBunches)}</td><td>${utils.number(row.demandPendingBunches)}</td><td>${row.pendingMixedPlaceholder ? "—" : `<strong>${utils.number(row.availableForSaleBunches)}</strong>`}</td><td>${row.pendingMixedPlaceholder ? "—" : utils.number(row.shortageBunches)}</td><td><span class="status-badge ${utils.badgeClass(displayStatus)}">${utils.esc(displayStatus)}</span></td></tr>`;
          }).join("") || `<tr><td colspan="10">No existen ramos disponibles ni pedidos activos para mostrar.</td></tr>`}</tbody>
        </table></div>
      </section>
      ${order ? `<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">PEDIDO ACTUAL</p><h3>Demanda y avance de ${utils.esc(order.number)}</h3></div><span class="status-badge ${utils.badgeClass(order.warehouseStatus || "NO_LIBERADO")}">${utils.esc(order.warehouseStatus || "NO_LIBERADO")}</span></div>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Caja</th><th>Variedad / composicion real</th><th>Medida</th><th>T/R</th><th>Solicitados</th><th>Escaneados</th><th>Pendientes</th><th>Estado</th></tr></thead><tbody>${orderRows.map(item => `<tr><td>${utils.esc(item.box.boxNumber)}</td><td>${utils.esc(item.line.variety)}${actualComposition(item.line) ? `<br><small class="master-mix-actual">${utils.esc(actualComposition(item.line))}</small>` : ""}</td><td>${utils.esc(isAnyLengthLine(item.line) ? "CUALQUIER MEDIDA" : `${item.line.length} cm`)}</td><td>${utils.esc(item.line.stemsPerBunch)}</td><td>${utils.esc(item.required)}</td><td>${utils.esc(item.scanned)}</td><td>${utils.esc(item.pending)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td></tr>`).join("") || `<tr><td colspan="8">El pedido no tiene lineas.</td></tr>`}</tbody></table></div>
      </section>` : ""}
    `;

    if (!options.standalone) return content;
    return `<section class="page-header"><div><p class="section-kicker">${operationsContext ? "OPERACIONES / POSCOSECHA" : "COMERCIAL / EXPORTACIONES"}</p><h1>Disponibilidad para venta</h1><p>Consulta de ramos que pueden venderse despues de descontar la demanda pendiente de pedidos activos.</p></div><div class="page-header-side"><span class="status-badge authorized">Inventario real</span></div></section>${content}`;
  }

  BlessERP.comercialPedidoDemandView = { renderAvailability, renderLines };
})();
