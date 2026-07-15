(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const RELEASED_STATES = new Set([
    "LIBERADO_BODEGA",
    "EN_ARMADO",
    "PARCIAL_FALTANTE",
    "ACTUALIZADO_POR_VENTAS",
    "CAMBIO_REVISADO_BODEGA",
    "COMPLETO_BODEGA"
  ]);

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function metric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isOpenMixedLine(line) {
    return normalize(line?.boxBuildMode) === "MIXTO_ABIERTO";
  }

  function isAnyLengthLine(line) {
    return line?.anyLength === true || (isOpenMixedLine(line) && line?.mixedAnyLength !== false);
  }

  function exclusionsKey(values) {
    return (Array.isArray(values) ? values : []).map(normalize).filter(Boolean).sort().join(",");
  }

  function measureLabel(line) {
    return isAnyLengthLine(line) ? "CUALQUIER MEDIDA" : `${metric(line?.length)} cm`;
  }

  function renderLengthOptions(lengths, selectedLength, anyLength, utils) {
    const anyValue = BlessERP.comercialBoxBuilder.ANY_LENGTH;
    return `<option value="${anyValue}" ${anyLength ? "selected" : ""}>CUALQUIER MEDIDA</option>${lengths.map(length => `<option value="${utils.esc(length)}" ${!anyLength && Number(length) === Number(selectedLength) ? "selected" : ""}>${utils.esc(length)} cm</option>`).join("")}`;
  }

  function statusBadge(utils, value, fallback = "PENDIENTE") {
    const status = normalize(value) || fallback;
    return `<span class="status-badge ${utils.badgeClass(status)}">${utils.esc(status)}</span>`;
  }

  function stageState(ok, warning) {
    if (ok) return "OK";
    return warning ? "ADVERTENCIA" : "PENDIENTE";
  }

  function disabled(flag) {
    return flag ? "disabled" : "";
  }

  function fieldLocked(order, field, workflow) {
    if (order.revisionEditing) return ["customerId", "brandId", "transportType"].includes(field);
    return !workflow.canEditOrderField(order, field).ok;
  }

  function buildCoverageRows(appState, fulfillment) {
    const availability = BlessERP.comercialOrderFulfillment?.getAvailabilityRows?.(appState) || [];
    const byKey = new Map(availability.filter(item => !item.anyLength && !item.openMixed).map(item => [
      `${normalize(item.variety)}|${metric(item.length)}|${metric(item.stemsPerBunch)}`,
      item
    ]));

    return (fulfillment?.boxes || []).flatMap(box => box.lines.map(progress => {
      const line = progress.line;
      const key = `${normalize(line.variety)}|${metric(line.length)}|${metric(line.stemsPerBunch)}`;
      const openMixed = isOpenMixedLine(line);
      const anyLength = isAnyLengthLine(line);
      const stock = openMixed
        ? availability.find(item => (
          item.openMixed
          && Boolean(item.anyLength) === anyLength
          && (anyLength || metric(item.length) === metric(line.length))
          && metric(item.stemsPerBunch) === metric(line.stemsPerBunch)
          && exclusionsKey(item.excludedVarieties) === exclusionsKey(line.mixedExcludedVarieties)
        )) || {}
        : anyLength
          ? availability.find(item => (
            !item.openMixed
            && item.anyLength
            && normalize(item.variety) === normalize(line.variety)
            && metric(item.stemsPerBunch) === metric(line.stemsPerBunch)
          )) || {}
          : byKey.get(key) || {};
      const physical = metric(stock.physicalBunches);
      const pending = metric(progress.pending);
      const covered = Math.min(physical, pending);
      return {
        boxNumber: box.boxNumber,
        line,
        required: metric(progress.required),
        scanned: metric(progress.scanned),
        pending,
        physical,
        projected: metric(stock.projectedBunches),
        shortage: Math.max(pending - physical, 0),
        coverage: pending === 0 ? "COMPLETA" : covered >= pending ? "DISPONIBLE" : covered > 0 ? "PARCIAL" : "FALTANTE"
      };
    }));
  }

  function renderOrderSelector(order, appState, utils, stateApi) {
    const orders = stateApi.getOrders(appState)
      .slice()
      .sort((left, right) => String(right.issuedAt || "").localeCompare(String(left.issuedAt || "")) || String(right.number || "").localeCompare(String(left.number || "")));
    return `
      <section class="panel-card master-order-selector">
        <div>
          <p class="section-kicker">PEDIDO ACTIVO</p>
          <strong>${utils.esc(order.number || "Sin numero")}</strong>
          <small>Seleccione otra orden sin salir del Pedido Maestro.</small>
        </div>
        <label class="compact-inline-field">
          <span>Pedido / orden</span>
          <select data-commercial-master-select-order>
            ${orders.map(item => `<option value="${utils.esc(item.id)}" ${item.id === order.id ? "selected" : ""}>${utils.esc(item.number)} | ${utils.esc(item.issuedAt || "Sin fecha")} | ${utils.esc(item.status || "BORRADOR")}</option>`).join("")}
          </select>
        </label>
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-new-order>Nuevo pedido</button>
          <button class="primary-button" data-commercial-jump-box-builder>Crear cajas</button>
          <button class="secondary-button" data-route-link="commercial-orders-day">Ordenes del dia</button>
          <button class="secondary-button" data-route-link="commercial-order-history">Historial</button>
        </div>
      </section>
    `;
  }

  function renderBoxBuilder(order, draft, nextBox, boxTypes, varieties, lengths, linesEditable, utils) {
    const modes = BlessERP.comercialBoxBuilder.MODES;
    const modeLabels = {
      [modes.RANGE]: "Rango igual",
      [modes.MANUAL_MIX]: "Mixto manual",
      [modes.OPEN_MIX]: "Mixto abierto"
    };
    const templateItems = draft.mode === modes.MANUAL_MIX ? draft.manualItems : [draft];
    const perBoxBunches = templateItems.reduce((sum, item) => sum + metric(item.bunches), 0);
    const perBoxStems = templateItems.reduce((sum, item) => sum + metric(item.bunches) * metric(item.stemsPerBunch), 0);
    const perBoxUsd = templateItems.reduce((sum, item) => sum + metric(item.bunches) * metric(item.stemsPerBunch) * metric(item.unitPrice), 0);
    const commonFields = `
      <label class="compact-field"><span>Caja inicial</span><input type="number" min="1" step="1" value="${utils.esc(draft.firstBox || nextBox)}" data-commercial-range-field="firstBox" ${disabled(!linesEditable)}></label>
      <label class="compact-field"><span>Cantidad cajas</span><input type="number" min="1" max="200" step="1" value="${utils.esc(draft.quantity || 1)}" data-commercial-range-field="quantity" ${disabled(!linesEditable)}></label>
      <label class="compact-field"><span>Tipo caja</span><select data-commercial-range-field="boxType" ${disabled(!linesEditable)}>${boxTypes.map(type => `<option value="${utils.esc(type.code)}" ${type.code === draft.boxType ? "selected" : ""}>${utils.esc(type.code)}</option>`).join("")}</select></label>
      <label class="compact-field master-range-po"><span>PO / marcacion</span><input type="text" value="${utils.esc(draft.po || "")}" data-commercial-range-field="po" ${disabled(!linesEditable)}></label>
    `;

    let modeContent = "";
    if (draft.mode === modes.RANGE) {
      modeContent = `
        <div class="master-order-range-grid master-builder-range-grid">
          ${commonFields}
          <label class="compact-field master-range-variety"><span>Variedad</span><select data-commercial-range-field="variety" ${disabled(!linesEditable)}>${varieties.map(variety => `<option value="${utils.esc(variety)}" ${variety === draft.variety ? "selected" : ""}>${utils.esc(variety)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Medida</span><select data-commercial-range-field="lengthSelection" ${disabled(!linesEditable)}>${renderLengthOptions(lengths, draft.length, draft.anyLength, utils)}</select></label>
          <label class="compact-field"><span>Ramos/caja</span><input type="number" min="1" step="1" value="${utils.esc(draft.bunches || 1)}" data-commercial-range-field="bunches" ${disabled(!linesEditable)}></label>
          <label class="compact-field"><span>Tallos/ramo</span><input type="number" min="1" step="1" value="${utils.esc(draft.stemsPerBunch || 25)}" data-commercial-range-field="stemsPerBunch" ${disabled(!linesEditable)}></label>
          <label class="compact-field"><span>Precio/tallo</span><input type="number" min="0.001" step="0.001" value="${utils.esc(draft.unitPrice || 0)}" data-commercial-range-field="unitPrice" ${disabled(!linesEditable)}></label>
        </div>
        <p class="master-range-help">Genera cajas consecutivas con la misma variedad, regla de medida, cantidad y precio. Con cantidad 1 funciona como caja individual; luego cada caja puede corregirse por separado.</p>
      `;
    }

    if (draft.mode === modes.MANUAL_MIX) {
      modeContent = `
        <div class="master-order-range-grid master-builder-common-grid">${commonFields}</div>
        <div class="compact-table-wrap master-mix-items"><table class="compact-table"><thead><tr><th>Item</th><th>Variedad</th><th>Medida</th><th>Ramos</th><th>Tallos/ramo</th><th>Precio/tallo</th><th>Total/caja</th><th></th></tr></thead><tbody>
          ${draft.manualItems.map((item, index) => `<tr>
            <td><strong>${index + 1}</strong></td>
            <td><select data-commercial-mix-item-field="${utils.esc(item.id)}|variety" ${disabled(!linesEditable)}>${varieties.map(variety => `<option value="${utils.esc(variety)}" ${variety === item.variety ? "selected" : ""}>${utils.esc(variety)}</option>`).join("")}</select></td>
            <td><select data-commercial-mix-item-field="${utils.esc(item.id)}|lengthSelection" ${disabled(!linesEditable)}>${renderLengthOptions(lengths, item.length, item.anyLength, utils)}</select></td>
            <td><input type="number" min="1" step="1" value="${utils.esc(item.bunches)}" data-commercial-mix-item-field="${utils.esc(item.id)}|bunches" ${disabled(!linesEditable)}></td>
            <td><input type="number" min="1" step="1" value="${utils.esc(item.stemsPerBunch)}" data-commercial-mix-item-field="${utils.esc(item.id)}|stemsPerBunch" ${disabled(!linesEditable)}></td>
            <td><input type="number" min="0.001" step="0.001" value="${utils.esc(item.unitPrice)}" data-commercial-mix-item-field="${utils.esc(item.id)}|unitPrice" ${disabled(!linesEditable)}></td>
            <td class="numeric"><strong>${utils.money(metric(item.bunches) * metric(item.stemsPerBunch) * metric(item.unitPrice))}</strong></td>
            <td><button class="secondary-button" data-commercial-remove-mix-item="${utils.esc(item.id)}" ${disabled(!linesEditable || draft.manualItems.length <= 2)}>Quitar</button></td>
          </tr>`).join("")}
        </tbody></table></div>
        <div class="master-mix-footer"><button class="secondary-button" data-commercial-add-mix-item ${disabled(!linesEditable)}>Agregar variedad</button><small>Ventas define exactamente las variedades, medidas, ramos y precios de cada caja.</small></div>
      `;
    }

    if (draft.mode === modes.OPEN_MIX) {
      modeContent = `
        <div class="master-order-range-grid master-builder-open-grid">
          ${commonFields}
          <label class="compact-field"><span>Medida</span><select data-commercial-range-field="lengthSelection" ${disabled(!linesEditable)}>${renderLengthOptions(lengths, draft.length, draft.anyLength, utils)}</select></label>
          <label class="compact-field"><span>Ramos/caja</span><input type="number" min="1" step="1" value="${utils.esc(draft.bunches || 1)}" data-commercial-range-field="bunches" ${disabled(!linesEditable)}></label>
          <label class="compact-field"><span>Tallos/ramo</span><input type="number" min="1" step="1" value="${utils.esc(draft.stemsPerBunch || 25)}" data-commercial-range-field="stemsPerBunch" ${disabled(!linesEditable)}></label>
          <label class="compact-field"><span>Precio comun/tallo</span><input type="number" min="0.001" step="0.001" value="${utils.esc(draft.unitPrice || 0)}" data-commercial-range-field="unitPrice" ${disabled(!linesEditable)}></label>
          <label class="compact-field master-range-exclusions"><span>Variedades excluidas</span><input type="text" value="${utils.esc(draft.excludedVarieties || "")}" placeholder="Ej. PLAYA BLANCA, MONDIAL" data-commercial-range-field="excludedVarieties" ${disabled(!linesEditable)}></label>
        </div>
        <p class="master-range-help">Bodega puede escanear cualquier variedad permitida. La medida se valida exactamente o queda abierta segun la opcion elegida; la composicion real vuelve a Ventas con cada lectura.</p>
      `;
    }

    return `
      <section class="master-order-box-builder" id="master-order-box-builder">
        <div class="master-builder-toolbar">
          <div><strong>Crear cajas</strong><small>Seleccione una forma de armar el pedido.</small></div>
          <div class="table-actions-inline master-builder-modes">
            <button class="secondary-button" data-commercial-builder-single ${disabled(!linesEditable)}>Caja individual</button>
            ${Object.entries(modeLabels).map(([mode, label]) => `<button class="${draft.mode === mode ? "primary-button" : "secondary-button"}" data-commercial-builder-mode="${utils.esc(mode)}" ${disabled(!linesEditable)}>${utils.esc(label)}</button>`).join("")}
          </div>
        </div>
        <div class="master-builder-body">
          <div class="master-builder-title"><strong>${utils.esc(modeLabels[draft.mode])}</strong><span class="status-badge partial">Caja ${utils.esc(draft.firstBox || nextBox)} en adelante</span></div>
          ${modeContent}
          <div class="master-order-totals"><span>Por caja: ${utils.number(perBoxBunches)} ramos</span><span>${utils.number(perBoxStems)} tallos</span><strong>${utils.money(perBoxUsd)}</strong><span>Rango: ${utils.number(perBoxBunches * metric(draft.quantity))} ramos</span><span>${utils.number(perBoxStems * metric(draft.quantity))} tallos</span><strong>${utils.money(perBoxUsd * metric(draft.quantity))}</strong></div>
          <div class="master-builder-submit"><button class="primary-button" data-commercial-add-box-range ${disabled(!linesEditable)}>Generar ${utils.esc(modeLabels[draft.mode].toLowerCase())}</button></div>
        </div>
      </section>
    `;
  }

  function mixedActualSummary(line) {
    if (line?.boxBuildMode !== "MIXTO_ABIERTO") return "";
    const rows = Array.isArray(line.mixedActualComposition) ? line.mixedActualComposition : [];
    if (!rows.length) return isAnyLengthLine(line) ? "Pendiente: Bodega define variedad y medida" : `Pendiente: Bodega define variedad en ${metric(line.length)} cm`;
    return rows.map(item => `${item.variety} ${item.length} cm: ${item.bunches} ramo(s)`).join(" · ");
  }

  function scannedMeasureSummary(line) {
    if (!isAnyLengthLine(line) || isOpenMixedLine(line)) return "";
    const grouped = new Map();
    (line.scannedBunches || []).forEach(scan => grouped.set(metric(scan.length), (grouped.get(metric(scan.length)) || 0) + 1));
    if (!grouped.size) return "Pendiente de lectura en Bodega";
    return [...grouped.entries()].sort((left, right) => left[0] - right[0]).map(([length, bunches]) => `${length} cm: ${bunches} ramo(s)`).join(" · ");
  }

  function renderStages(order, workflowSummary, fulfillment, utils) {
    const transport = normalize(order.transportType);
    const daeOk = transport !== "AEREO" || Boolean(order.daeNumber);
    const stages = [
      { label: "1. Cliente", state: stageState(Boolean(order.customerId && order.brandId)), help: "Cliente principal y marca final" },
      { label: "2. Logistica", state: stageState(Boolean(order.destination && order.flightDate && order.agencyId && daeOk), Boolean(!order.awb || !order.hawb)), help: transport === "MARITIMO" ? "Maritimo: DAE pendiente permitida" : "Destino, DAE, agencia y vuelo" },
      { label: "3. Cajas", state: stageState(Boolean(fulfillment?.totalBoxes && fulfillment?.requiredBunches)), help: `${fulfillment?.totalBoxes || 0} caja(s), ${fulfillment?.requiredBunches || 0} ramo(s)` },
      { label: "4. Validacion", state: workflowSummary.validation.errors.length ? "ERROR" : workflowSummary.validation.warnings.length ? "ADVERTENCIA" : "OK", help: `${workflowSummary.validation.errors.length} error(es), ${workflowSummary.validation.warnings.length} advertencia(s)` },
      { label: "5. Bodega", state: RELEASED_STATES.has(normalize(order.warehouseStatus)) ? (fulfillment?.allBoxesComplete ? "OK" : "EN_PROCESO") : "PENDIENTE", help: order.warehouseStatus || "NO_LIBERADO" }
    ];
    return `<section class="master-order-stage-track">${stages.map(item => `<article class="master-order-stage ${utils.badgeClass(item.state)}"><span>${utils.esc(item.label)}</span><strong>${utils.esc(item.state)}</strong><small>${utils.esc(item.help)}</small></article>`).join("")}</section>`;
  }

  function renderHeaderData(order, appState, utils, stateApi, workflow) {
    const customers = stateApi.getCustomerCatalog(appState).filter(item => normalize(item.status) !== "INACTIVO");
    const brands = stateApi.getBrandCatalog(appState).filter(item => item.customerId === order.customerId && normalize(item.status || "ACTIVO") !== "INACTIVO");
    const agencies = stateApi.getAgencyCatalog(appState).filter(item => normalize(item.status || "ACTIVA") !== "INACTIVA");
    const daes = utils.getAvailableDaesForOrder(order);
    const transport = normalize(order.transportType) || "AEREO";
    const revisionLabel = order.revisionEditing ? `REVISION R${order.revisionDraftNumber}` : order.status || "BORRADOR";
    const selectedAgency = agencies.find(item => item.id === order.agencyId);
    const agencyRooms = [...new Set([...(selectedAgency?.coldRooms || []), selectedAgency?.coldRoom, order.coldRoom].filter(Boolean))];
    const recognizedAirline = utils.findAirlineByAwb(order.awb, appState)
      || utils.findAirline(order.airlineId, appState);
    const awbDigits = utils.getAwbDigits(order.awb);
    const awbStatus = recognizedAirline
      ? `${recognizedAirline.name} reconocida por el prefijo ${recognizedAirline.awbPrefix}.`
      : awbDigits.length >= 3
        ? `No existe una linea aerea activa con el prefijo ${awbDigits.slice(0, 3)}.`
        : "Ingrese los 3 primeros digitos para reconocer la linea aerea.";

    return `
      <section class="panel-card master-order-entry-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">PEDIDO MAESTRO</p><h3>Cliente, marca y logistica</h3></div>
          ${statusBadge(utils, revisionLabel)}
        </div>
        <p class="panel-note">Complete el pedido directamente en esta pantalla. Cliente y marca parametrizan destino, agencia, cuarto frio y DAE sugerida.</p>
        <div class="master-order-form-grid">
          <label class="compact-field"><span>Pedido</span><input value="${utils.esc(order.number || "")}" disabled></label>
          <label class="compact-field"><span>Fecha pedido</span><input type="date" value="${utils.esc(order.issuedAt || "")}" data-commercial-order-field="issuedAt" ${disabled(fieldLocked(order, "issuedAt", workflow))}></label>
          <label class="compact-field master-field-wide"><span>Cliente principal</span><select data-commercial-order-field="customerId" ${disabled(fieldLocked(order, "customerId", workflow))}><option value="">Seleccione cliente</option>${customers.map(item => `<option value="${utils.esc(item.id)}" ${item.id === order.customerId ? "selected" : ""}>${utils.esc(item.commercialName)} · ${utils.esc(item.code)}</option>`).join("")}</select></label>
          <label class="compact-field master-field-wide"><span>Marca / cliente final</span><select data-commercial-order-field="brandId" ${disabled(fieldLocked(order, "brandId", workflow) || !order.customerId)}><option value="">Seleccione marca</option>${brands.map(item => `<option value="${utils.esc(item.id)}" ${item.id === order.brandId ? "selected" : ""}>${utils.esc(item.name)} · ${utils.esc(item.destination || "-")}</option>`).join("")}</select></label>
          <label class="compact-field"><span>PO general</span><input value="${utils.esc(order.generalPo || "")}" data-commercial-order-field="generalPo" ${disabled(fieldLocked(order, "generalPo", workflow))}></label>
          <label class="compact-field"><span>Transporte</span><select data-commercial-order-field="transportType" ${disabled(fieldLocked(order, "transportType", workflow))}><option value="aereo" ${transport === "AEREO" ? "selected" : ""}>Aereo</option><option value="maritimo" ${transport === "MARITIMO" ? "selected" : ""}>Maritimo</option><option value="terrestre" ${transport === "TERRESTRE" ? "selected" : ""}>Terrestre</option></select></label>
          <label class="compact-field"><span>Destino</span><input value="${utils.esc(order.destination || "")}" disabled></label>
          <label class="compact-field"><span>Pais</span><input value="${utils.esc(order.destinationCountry || "")}" disabled></label>
          <label class="compact-field"><span>Fecha vuelo / salida</span><input type="date" value="${utils.esc(order.flightDate || "")}" data-commercial-order-field="flightDate" ${disabled(fieldLocked(order, "flightDate", workflow))}></label>
          <label class="compact-field master-field-wide"><span>Agencia de carga</span><select data-commercial-order-field="agencyId" ${disabled(fieldLocked(order, "agencyId", workflow))}><option value="">Seleccione agencia</option>${agencies.map(item => `<option value="${utils.esc(item.id)}" ${item.id === order.agencyId ? "selected" : ""}>${utils.esc(item.name)} · ${utils.esc(item.coldRoom || "-")}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Cuarto frio</span><input list="master-order-cold-rooms" value="${utils.esc(order.coldRoom || "")}" data-commercial-order-field="coldRoom" ${disabled(fieldLocked(order, "coldRoom", workflow))}><datalist id="master-order-cold-rooms">${agencyRooms.map(room => `<option value="${utils.esc(room)}"></option>`).join("")}</datalist></label>
          <label class="compact-field master-field-wide"><span>DAE ${transport === "AEREO" ? "obligatoria" : "pendiente permitida"}</span><select data-commercial-order-field="daeNumber" ${disabled(transport !== "AEREO" || fieldLocked(order, "daeNumber", workflow))}><option value="">${transport === "AEREO" ? "Seleccione DAE" : "No requerida para enviar a Bodega"}</option>${daes.map(item => `<option value="${utils.esc(item.number)}" ${item.number === order.daeNumber ? "selected" : ""}>${utils.esc(item.number)} · vence ${utils.esc(item.expiresAt || "-")}</option>`).join("")}</select></label>
          <label class="compact-field"><span>AWB / guia madre</span><input inputmode="numeric" maxlength="12" placeholder="045-12345678" value="${utils.esc(order.awb || "")}" data-commercial-order-field="awb" data-commercial-awb-input ${disabled(fieldLocked(order, "awb", workflow))}></label>
          <label class="compact-field master-field-wide master-awb-result"><span>Linea aerea automatica</span><input value="${utils.esc(recognizedAirline ? `${recognizedAirline.name} · prefijo ${recognizedAirline.awbPrefix}` : "Prefijo AWB no reconocido")}" data-commercial-awb-airline disabled><small class="${recognizedAirline ? "is-valid" : awbDigits.length >= 3 ? "is-warning" : ""}" data-commercial-awb-status>${utils.esc(awbStatus)}</small></label>
          <label class="compact-field"><span>Vuelo</span><input value="${utils.esc(order.flightNumber || "")}" data-commercial-order-field="flightNumber" ${disabled(fieldLocked(order, "flightNumber", workflow))}></label>
          <label class="compact-field"><span>HAWB / guia hija</span><input value="${utils.esc(order.hawb || "")}" data-commercial-order-field="hawb" ${disabled(fieldLocked(order, "hawb", workflow))}></label>
          <label class="compact-field master-field-full"><span>Observaciones</span><textarea data-commercial-order-field="notes" ${disabled(fieldLocked(order, "notes", workflow))}>${utils.esc(order.notes || "")}</textarea></label>
        </div>
        <div class="table-actions-inline"><button class="secondary-button" data-route-link="commercial-customers-brands">Administrar clientes</button><button class="secondary-button" data-route-link="commercial-brands">Administrar marcas</button><button class="secondary-button" data-route-link="commercial-cargo-agencies">Administrar agencias</button></div>
      </section>
    `;
  }

  function renderReadiness(order, workflowSummary, fulfillment, coverageRows, utils) {
    const missingCoverage = coverageRows.reduce((sum, item) => sum + item.shortage, 0);
    const released = RELEASED_STATES.has(normalize(order.warehouseStatus));
    const operationalWarnings = workflowSummary.validation.warnings.filter(message => ![
      "Supabase",
      "SRI",
      "Contabilidad real",
      "inventario real",
      "Scanner real",
      "reservas"
    ].some(token => message.toLowerCase().includes(token.toLowerCase())));
    const messages = [
      ...workflowSummary.validation.errors.map(message => ({ tone: "ERROR", message })),
      ...operationalWarnings.map(message => ({ tone: "ADVERTENCIA", message }))
    ].slice(0, 8);
    if (missingCoverage > 0) messages.unshift({ tone: "ADVERTENCIA", message: `Faltante proyectado de ${missingCoverage} ramo(s). El pedido puede prepararse, pero Bodega debe revisar disponibilidad fisica.` });
    if (order.labelReprintRequired) messages.unshift({ tone: "REIMPRESION", message: `Las etiquetas anteriores fueron anuladas. Corresponde imprimir la revision R${order.labelRevision || 1}.` });
    return `
      <article class="panel-card master-order-readiness">
        <div class="panel-card-head"><div><p class="section-kicker">GUARDAR Y ENVIAR</p><h3>Control del pedido</h3></div>${statusBadge(utils, order.warehouseStatus || "NO_LIBERADO")}</div>
        <div class="master-order-kpis">
          <div><span>Cajas</span><strong>${utils.number(fulfillment?.totalBoxes || 0)}</strong></div>
          <div><span>Ramos</span><strong>${utils.number(fulfillment?.requiredBunches || 0)}</strong></div>
          <div><span>Leidos</span><strong>${utils.number(fulfillment?.scannedBunches || 0)}</strong></div>
          <div><span>Pendientes</span><strong>${utils.number(fulfillment?.pendingBunches || 0)}</strong></div>
        </div>
        <div class="base-ready-list master-order-alerts">
          ${messages.map(item => `<div class="base-ready-item"><strong>${utils.esc(item.tone)}</strong><span>${utils.esc(item.message)}</span></div>`).join("") || `<div class="base-ready-item"><strong>LISTO</strong><span>La cabecera y el detalle no presentan errores criticos.</span></div>`}
        </div>
        <div class="table-actions-inline">
          ${!released ? `<button class="secondary-button" data-commercial-save-order>Guardar borrador</button><button class="primary-button" data-commercial-release-warehouse>Enviar a Bodega</button>` : ""}
          ${released && !order.revisionEditing ? `<button class="primary-button" data-commercial-start-revision>Modificar pedido</button>` : ""}
          ${order.revisionEditing ? `<button class="primary-button" data-commercial-submit-revision>Enviar actualizacion a Bodega</button><button class="secondary-button" data-commercial-cancel-revision>Cancelar revision</button>` : ""}
          <button class="secondary-button" data-commercial-open-warehouse>Ver en Bodega</button>
        </div>
        <p class="panel-note">Enviar a Bodega ejecuta la validacion automaticamente. AWB, HAWB y vuelo pueden completarse despues, pero seran obligatorios antes de imprimir etiquetas finales.</p>
      </article>
    `;
  }

  function renderBoxes(order, appState, fulfillment, utils, stateApi, workflow) {
    const metrics = utils.getOrderMetrics(order);
    const boxTypes = BlessERP.comercialData.boxTypes || [];
    const rangeDraft = stateApi.getBoxRangeDraft(appState) || {};
    const nextRangeBox = Math.max(0, ...(fulfillment?.boxes || []).map(box => Number(box.boxNumber || 0))) + 1;
    const operationalStore = BlessERP.operacionesState?.getStore?.(appState);
    const varieties = [...new Set([
      ...(operationalStore?.masterData?.varieties || []).filter(item => item.active !== false).map(item => item.name),
      ...(order.lines || []).map(line => line.variety)
    ].filter(Boolean))].sort();
    const lengths = [...new Set([
      ...(operationalStore?.masterData?.lengths || []).filter(item => item.active !== false).map(item => metric(item.name)),
      ...(operationalStore?.catalogs?.lengths || []).map(metric),
      ...(order.lines || []).filter(line => !isAnyLengthLine(line)).map(line => metric(line.length)),
      metric(rangeDraft.length),
      ...(rangeDraft.manualItems || []).map(item => metric(item.length))
    ].filter(length => length > 0))].sort((left, right) => left - right);
    const linesEditable = order.revisionEditing || workflow.canEditLines(order).ok;
    return `
      <section class="panel-card master-order-boxes">
        <div class="panel-card-head">
          <div><p class="section-kicker">ORDEN DEL CLIENTE</p><h3>Cajas, variedades, cantidades y precios</h3></div>
          <div class="table-actions-inline"><button class="primary-button" data-commercial-builder-single ${disabled(!linesEditable)}>Agregar caja</button><button class="secondary-button" data-route-link="operations-availability">Ver disponibilidad</button></div>
        </div>
        <p class="panel-note">El precio es manual por tallo. Use Agregar item cuando una caja contenga varias variedades o medidas. Bodega no visualiza precios.</p>
        ${renderBoxBuilder(order, rangeDraft, nextRangeBox, boxTypes, varieties, lengths, linesEditable, utils)}
        <div class="master-order-box-list">
          ${(fulfillment?.boxes || []).map(box => {
            const boxLines = box.lines || [];
            const boxTotal = boxLines.reduce((sum, item) => sum + metric(item.line.bunches) * metric(item.line.stemsPerBunch) * metric(item.line.unitPrice), 0);
            const boxHasScans = boxLines.some(item => item.scanned > 0);
            const rangeLine = boxLines[0]?.line;
            const buildLabel = rangeLine?.boxBuildMode === "MIXTO_MANUAL" ? "Mixto manual" : rangeLine?.boxBuildMode === "MIXTO_ABIERTO" ? "Mixto abierto" : "";
            const rangeInfo = rangeLine?.boxRangeId
              ? `${buildLabel ? `${buildLabel} · ` : ""}${rangeLine.boxRangeLabel} · ${rangeLine.boxRangeSequence}/${rangeLine.boxRangeTotal}`
              : "";
            return `<details class="master-order-box" open>
              <summary><span><strong>Caja ${utils.esc(box.boxNumber)} · ${utils.esc(box.boxType)}</strong><small>${utils.esc([rangeInfo, boxLines[0]?.line?.po || order.generalPo || "Sin PO"].filter(Boolean).join(" · "))}</small></span><span>${utils.number(box.scanned)} / ${utils.number(box.required)} ramos</span>${statusBadge(utils, box.status)}<span>${utils.money(boxTotal)}</span></summary>
              <div class="master-order-box-actions"><button class="secondary-button" data-commercial-add-item-box="${utils.esc(box.boxNumber)}" ${disabled(!linesEditable || rangeLine?.boxBuildMode === "MIXTO_ABIERTO")}>Agregar item</button><button class="secondary-button" data-commercial-duplicate-box="${utils.esc(box.boxNumber)}" ${disabled(!linesEditable)}>Duplicar caja</button><button class="secondary-button" data-commercial-delete-box="${utils.esc(box.boxNumber)}" ${disabled(!linesEditable || boxHasScans)}>Eliminar caja</button></div>
              <div class="compact-table-wrap"><table class="compact-table master-order-entry-table"><thead><tr><th>Tipo</th><th>Variedad</th><th>PO</th><th>Medida</th><th>Ramos</th><th>Tallos/ramo</th><th>Total tallos</th><th>Precio/tallo</th><th>Total USD</th><th>Leidos</th><th>Acciones</th></tr></thead><tbody>
                ${boxLines.map(item => {
                  const line = item.line;
                  const isNewRevisionLine = Number(line.addedRevision || 1) === Number(order.revisionDraftNumber || 0);
                  const structuralLocked = !linesEditable || (order.revisionEditing && item.scanned > 0 && !isNewRevisionLine);
                  const boxNumberLocked = !linesEditable || (order.revisionEditing && !isNewRevisionLine);
                  const lineTotal = metric(line.bunches) * metric(line.stemsPerBunch) * metric(line.unitPrice);
                  return `<tr>
                    <td><select data-commercial-line-field="${utils.esc(line.id)}|boxType" ${disabled(structuralLocked)}>${boxTypes.map(type => `<option value="${utils.esc(type.code)}" ${type.code === line.boxType ? "selected" : ""}>${utils.esc(type.code)}</option>`).join("")}</select><input type="hidden" value="${utils.esc(line.boxNumber)}" data-commercial-line-field="${utils.esc(line.id)}|boxNumber" ${disabled(boxNumberLocked)}></td>
                    <td><select data-commercial-line-field="${utils.esc(line.id)}|variety" ${disabled(structuralLocked || line.boxBuildMode === "MIXTO_ABIERTO")}>${varieties.map(variety => `<option value="${utils.esc(variety)}" ${variety === line.variety ? "selected" : ""}>${utils.esc(variety)}</option>`).join("")}</select>${mixedActualSummary(line) ? `<small class="master-mix-actual">${utils.esc(mixedActualSummary(line))}</small>` : ""}${line.boxBuildMode === "MIXTO_ABIERTO" && line.mixedExcludedVarieties?.length ? `<small class="warn-text">Excluye: ${utils.esc(line.mixedExcludedVarieties.join(", "))}</small>` : ""}</td>
                    <td><input value="${utils.esc(line.po || "")}" data-commercial-line-field="${utils.esc(line.id)}|po" ${disabled(!linesEditable)}></td>
                    <td><select data-commercial-line-field="${utils.esc(line.id)}|lengthSelection" ${disabled(structuralLocked)}>${renderLengthOptions(lengths, line.length, isAnyLengthLine(line), utils)}</select>${scannedMeasureSummary(line) ? `<small class="master-mix-actual">${utils.esc(scannedMeasureSummary(line))}</small>` : ""}</td>
                    <td><input type="number" min="${Math.max(1, item.scanned)}" step="1" value="${utils.esc(line.bunches)}" data-commercial-line-field="${utils.esc(line.id)}|bunches" ${disabled(!linesEditable)}></td>
                    <td><input type="number" min="1" step="1" value="${utils.esc(line.stemsPerBunch)}" data-commercial-line-field="${utils.esc(line.id)}|stemsPerBunch" ${disabled(structuralLocked)}></td>
                    <td class="numeric"><strong>${utils.number(metric(line.bunches) * metric(line.stemsPerBunch))}</strong></td>
                    <td><input type="number" min="0" step="0.001" value="${utils.esc(line.unitPrice)}" data-commercial-line-field="${utils.esc(line.id)}|unitPrice" ${disabled(!linesEditable)}></td>
                    <td class="numeric"><strong>${utils.money(lineTotal)}</strong></td>
                    <td><strong>${utils.number(item.scanned)} / ${utils.number(item.required)}</strong><br><small>${utils.esc(item.status)}</small></td>
                    <td><div class="table-actions-inline"><button class="secondary-button" data-commercial-duplicate-line="${utils.esc(line.id)}" ${disabled(!linesEditable)}>Duplicar item</button><button class="secondary-button" data-commercial-delete-line="${utils.esc(line.id)}" ${disabled(!linesEditable || item.scanned > 0)}>Eliminar</button></div></td>
                  </tr>`;
                }).join("")}
              </tbody></table></div>
            </details>`;
          }).join("") || `<div class="master-order-empty"><strong>El pedido no tiene cajas.</strong><span>Pulse Agregar caja para completar la misma plantilla con cantidad 1.</span><button class="primary-button" data-commercial-builder-single ${disabled(!linesEditable)}>Agregar primera caja</button></div>`}
        </div>
        <div class="master-order-totals"><span>${utils.number(metrics.totalBoxes)} cajas</span><span>${utils.number(metrics.totalFulls.toFixed(3))} fulls</span><span>${utils.number(metrics.totalBunches)} ramos</span><span>${utils.number(metrics.totalStems)} tallos</span><strong>${utils.money(metrics.totalUsd)}</strong></div>
      </section>
    `;
  }

  function renderCoverage(coverageRows, utils) {
    return `
      <section class="panel-card master-order-coverage">
        <div class="panel-card-head"><div><p class="section-kicker">COBERTURA OPERATIVA</p><h3>Inventario fisico frente al pedido</h3></div><span class="status-badge partial">Sin reservas</span></div>
        <p class="panel-note">La cobertura es informativa. La flor solo se asigna cuando Bodega valida el codigo del ramo dentro de una caja.</p>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Caja</th><th>Variedad</th><th>Medida</th><th>Solicitados</th><th>Leidos</th><th>Pendientes</th><th>Fisico disponible</th><th>Faltante</th><th>Cobertura</th></tr></thead><tbody>
          ${coverageRows.map(item => `<tr><td>${utils.esc(item.boxNumber)}</td><td><strong>${utils.esc(item.line.variety)}</strong></td><td>${utils.esc(measureLabel(item.line))}</td><td>${utils.number(item.required)}</td><td>${utils.number(item.scanned)}</td><td>${utils.number(item.pending)}</td><td>${utils.number(item.physical)}</td><td>${utils.number(item.shortage)}</td><td>${statusBadge(utils, item.coverage)}</td></tr>`).join("") || `<tr><td colspan="9">Agregue cajas para calcular cobertura.</td></tr>`}
        </tbody></table></div>
      </section>
    `;
  }

  function render(order, appState) {
    const utils = BlessERP.comercialUtils;
    const stateApi = BlessERP.comercialState;
    const workflow = BlessERP.comercialWorkflow;
    const workflowSummary = workflow.buildWorkflowSummary(order, appState);
    const fulfillment = BlessERP.comercialOrderFulfillment.getOrderFulfillment(appState, order.id);
    const coverageRows = buildCoverageRows(appState, fulfillment);

    return `
      <div class="master-order-compact">
        ${renderOrderSelector(order, appState, utils, stateApi)}
        ${renderStages(order, workflowSummary, fulfillment, utils)}
        <section class="master-order-main-grid">
          ${renderHeaderData(order, appState, utils, stateApi, workflow)}
          ${renderReadiness(order, workflowSummary, fulfillment, coverageRows, utils)}
        </section>
        ${renderBoxes(order, appState, fulfillment, utils, stateApi, workflow)}
        ${renderCoverage(coverageRows, utils)}
      </div>
    `;
  }

  BlessERP.comercialPedidoMasterWorkspace = { render };
})();
