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

  function renderLengthOptions(lengths, line, utils) {
    const anyValue = BlessERP.comercialBoxBuilder.ANY_LENGTH;
    const anyLength = isAnyLengthLine(line);
    return `<option value="${anyValue}" ${anyLength ? "selected" : ""}>CUALQUIER MEDIDA</option>${lengths.map(length => `<option value="${utils.esc(length)}" ${!anyLength && Number(length) === Number(line.length) ? "selected" : ""}>${utils.esc(length)} cm</option>`).join("")}`;
  }

  function renderLines(order, appState, options) {
    const { utils, stateApi, boxTypes, operationalVarieties, operationalLengths, linesLocked, disabledAttr } = options;
    const metrics = utils.getOrderMetrics(order);
    const fulfillment = BlessERP.comercialOrderFulfillment.getOrderFulfillment(appState, order.id);
    const progressByLine = new Map((fulfillment?.boxes || []).flatMap(box => box.lines).map(item => [item.line.id, item]));

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

  function renderAvailability(order, appState, options = {}) {
    const utils = BlessERP.comercialUtils;
    const stateApi = BlessERP.comercialState;
    const ui = stateApi.getUi(appState);
    const rows = BlessERP.comercialOrderFulfillment.getAvailabilityRows(appState);
    const filtered = rows.filter(row => {
      if (ui.availabilityFilterVariety && row.variety !== ui.availabilityFilterVariety) return false;
      if (ui.availabilityFilterLength && availabilityLengthValue(row) !== String(ui.availabilityFilterLength)) return false;
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
    const totals = {
      physical: physicalTotal,
      demand: demandTotal,
      available: Math.max(physicalTotal - demandTotal, 0),
      shortage: Math.max(demandTotal - physicalTotal, 0)
    };
    const fulfillment = order ? BlessERP.comercialOrderFulfillment.getOrderFulfillment(appState, order.id) : null;
    const orderRows = fulfillment?.boxes.flatMap(box => box.lines.map(item => ({ box, ...item }))) || [];

    const content = `
      <section class="summary-grid">
        <article class="summary-card"><span>Ramos en inventario</span><strong>${utils.number(totals.physical)}</strong><small>Escaneados y fisicamente disponibles</small></article>
        <article class="summary-card"><span>Ramos en pedidos</span><strong>${utils.number(totals.demand)}</strong><small>Pendientes desde VALIDADO_COMERCIAL</small></article>
        <article class="summary-card"><span>Disponibles para venta</span><strong>${utils.number(totals.available)}</strong><small>Inventario menos pedidos activos</small></article>
        <article class="summary-card"><span>Faltante</span><strong>${utils.number(totals.shortage)}</strong><small>Demanda que supera al inventario</small></article>
      </section>
      <section class="hero-banner commercial-inline-banner">
        <div><strong>Disponibilidad comercial para venta</strong><span>Ramos disponibles en inventario - ramos pendientes de pedidos activos = ramos disponibles para vender. La pantalla es solo de consulta.</span></div>
        <span class="status-badge partial">Sin reservas</span>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">FILTROS</p><h3>Inventario frente a demanda abierta</h3></div><button class="secondary-button" data-route-link="operations-availability">Ver origen operativo</button></div>
        <div class="compact-form-grid">
          <label class="compact-field"><span>Variedad</span><select data-commercial-availability-filter="availabilityFilterVariety"><option value="">Todas</option>${varieties.map(item => `<option value="${utils.esc(item)}" ${item === ui.availabilityFilterVariety ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Medida</span><select data-commercial-availability-filter="availabilityFilterLength"><option value="">Todas</option>${lengths.map(item => `<option value="${utils.esc(item)}" ${String(item) === String(ui.availabilityFilterLength) ? "selected" : ""}>${utils.esc(item === "CUALQUIER MEDIDA" ? item : `${item} cm`)}</option>`).join("")}</select></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">DISPONIBILIDAD PARA VENTA</p><h3>Inventario menos pedidos activos</h3></div><span>${utils.esc(filtered.length)} combinaciones</span></div>
        <p class="panel-note">Los borradores no afectan la disponibilidad. Un pedido empieza a descontar demanda al quedar VALIDADO_COMERCIAL. Al escanear en Bodega bajan simultaneamente el inventario y el pendiente, evitando doble descuento.</p>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Variedad</th><th>Medida</th><th>Ramos inventario</th><th>Tallos/ramo</th><th>Ramos en pedidos</th><th>Disponibles venta</th><th>Faltante</th><th>Estado</th></tr></thead>
          <tbody>${filtered.map(row => `<tr><td><strong>${utils.esc(row.variety)}</strong>${row.openMixed ? `<br><small>Compromiso abierto; Bodega define la composicion al escanear.</small>` : row.anyLength ? `<br><small>Variedad fija con medida abierta.</small>` : ""}</td><td>${utils.esc(row.anyLength ? "CUALQUIER MEDIDA" : `${utils.number(row.length)} cm`)}</td><td>${utils.number(row.physicalBunches)}</td><td>${utils.number(row.stemsPerBunch)}</td><td>${utils.number(row.demandPendingBunches)}</td><td><strong>${utils.number(row.availableForSaleBunches)}</strong></td><td>${utils.number(row.shortageBunches)}</td><td><span class="status-badge ${utils.badgeClass(row.status)}">${utils.esc(row.status)}</span></td></tr>`).join("") || `<tr><td colspan="8">No existen ramos disponibles ni pedidos activos para mostrar.</td></tr>`}</tbody>
        </table></div>
      </section>
      ${order ? `<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">PEDIDO ACTUAL</p><h3>Demanda y avance de ${utils.esc(order.number)}</h3></div><span class="status-badge ${utils.badgeClass(order.warehouseStatus || "NO_LIBERADO")}">${utils.esc(order.warehouseStatus || "NO_LIBERADO")}</span></div>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Caja</th><th>Variedad / composicion real</th><th>Medida</th><th>T/R</th><th>Solicitados</th><th>Escaneados</th><th>Pendientes</th><th>Estado</th></tr></thead><tbody>${orderRows.map(item => `<tr><td>${utils.esc(item.box.boxNumber)}</td><td>${utils.esc(item.line.variety)}${actualComposition(item.line) ? `<br><small class="master-mix-actual">${utils.esc(actualComposition(item.line))}</small>` : ""}</td><td>${utils.esc(isAnyLengthLine(item.line) ? "CUALQUIER MEDIDA" : `${item.line.length} cm`)}</td><td>${utils.esc(item.line.stemsPerBunch)}</td><td>${utils.esc(item.required)}</td><td>${utils.esc(item.scanned)}</td><td>${utils.esc(item.pending)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td></tr>`).join("") || `<tr><td colspan="8">El pedido no tiene lineas.</td></tr>`}</tbody></table></div>
      </section>` : ""}
    `;

    if (!options.standalone) return content;
    return `<section class="page-header"><div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>Disponibilidad para venta</h1><p>Consulta de ramos que pueden venderse despues de descontar la demanda pendiente de pedidos activos.</p></div><div class="page-header-side"><span class="status-badge partial">Solo consulta</span></div></section>${content}`;
  }

  BlessERP.comercialPedidoDemandView = { renderAvailability, renderLines };
})();
