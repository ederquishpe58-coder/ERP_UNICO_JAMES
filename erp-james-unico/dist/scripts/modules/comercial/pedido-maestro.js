(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const stateApi = BlessERP.comercialState;
  const utils = BlessERP.comercialUtils;
  const workflow = BlessERP.comercialWorkflow;

  const orderTabGroups = [
    {
      label: "1. Pedido",
      tabs: [
        ["summary", "Orden maestra"],
        ["customer-brand", "Cliente / Marca"],
        ["logistics", "Logistica"],
        ["lines", "Cajas y variedades"],
        ["po", "PO / Marcaciones"],
        ["availability", "Disponibilidad"]
      ]
    },
    {
      label: "2. Operacion",
      tabs: [
        ["warehouse", "Bodega / materiales"],
        ["dispatch", "Despacho"],
        ["validations", "Validaciones"],
        ["history", "Historial"]
      ]
    },
    {
      label: "3. Documentos",
      tabs: [
        ["packing", "Packing"],
        ["invoice", "Invoice carguera"],
        ["client-invoice", "Factura cliente"],
        ["route-sheet", "HR"],
        ["master-packing", "MP"],
        ["labels", "Etiquetas"],
        ["print", "Centro de impresion"]
      ]
    },
    {
      label: "4. Futuro",
      tabs: [["future-accounting", "Contabilidad futura"]]
    }
  ];

  function renderNotice(appState) {
    const ui = stateApi.getUi(appState);
    if (!ui.notice) return "";
    const className = ui.noticeTone === "success"
      ? "authorized"
      : ui.noticeTone === "warning"
        ? "pending"
        : "partial";
    return `
      <section class="hero-banner commercial-inline-banner">
        <div>
          <strong>Actualizacion del pedido</strong>
          <span>${utils.esc(ui.notice)}</span>
        </div>
        <span class="status-badge ${className}">${utils.esc(ui.noticeTone || "info")}</span>
      </section>
    `;
  }

  function disabledAttr(flag) {
    return flag ? "disabled" : "";
  }

  function isFieldLocked(order, field) {
    if (["LIBERADO_BODEGA", "EN_ARMADO", "PARCIAL_FALTANTE", "COMPLETO_BODEGA"].includes(order.warehouseStatus) && ["customerId", "brandId", "transportType"].includes(field)) return true;
    return !workflow.canEditOrderField(order, field).ok;
  }

  function areLinesLocked(order) {
    if (order.revisionEditing) return false;
    if (["LIBERADO_BODEGA", "EN_ARMADO", "PARCIAL_FALTANTE", "ACTUALIZADO_POR_VENTAS", "CAMBIO_REVISADO_BODEGA", "COMPLETO_BODEGA"].includes(order.warehouseStatus)) return true;
    return !workflow.canEditLines(order).ok;
  }

  function getOperationalVarieties(appState, order) {
    const operationalStore = BlessERP.operacionesState?.getStore?.(appState);
    const active = (operationalStore?.masterData?.varieties || [])
      .filter(item => item.active !== false)
      .map(item => item.name)
      .filter(Boolean);
    return [...new Set([...(active.length ? active : data.varieties), ...(order?.lines || []).map(item => item.variety).filter(Boolean)])].sort();
  }

  function getOperationalLengths(appState, order) {
    const operationalStore = BlessERP.operacionesState?.getStore?.(appState);
    const active = (operationalStore?.masterData?.lengths || [])
      .filter(item => item.active !== false)
      .map(item => Number(item.name))
      .filter(item => Number.isFinite(item) && item > 0);
    const current = (order?.lines || []).map(item => Number(item.length)).filter(item => Number.isFinite(item) && item > 0);
    return [...new Set([...(active.length ? active : [40, 50, 60, 70]), ...current])].sort((left, right) => left - right);
  }

  function renderWorkflowPanel(order, appState) {
    const summary = workflow.buildWorkflowSummary(order, appState);
    const latestAction = summary.latestAction;
    const suggested = summary.suggestedNext;

    return `
      <section class="panel-card commercial-workflow-panel">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ESTADO DEL PEDIDO</p>
            <h3>${utils.esc(summary.definition.shortLabel)}</h3>
          </div>
          <span class="status-badge ${utils.esc(summary.definition.tone)}">${utils.esc(summary.status)}</span>
        </div>
        <div class="summary-grid commercial-workflow-grid">
          <article class="summary-card">
            <span>Estado actual</span>
            <strong>${utils.esc(summary.definition.shortLabel)}</strong>
            <small>${utils.esc(summary.definition.description)}</small>
          </article>
          <article class="summary-card">
            <span>Siguiente accion</span>
            <strong>${utils.esc(suggested?.label || "Sin siguiente paso")}</strong>
            <small>${utils.esc(suggested ? (suggested.ready ? "Lista para ejecutarse" : "Requiere revisar validaciones") : "No hay transicion sugerida")}</small>
          </article>
          <article class="summary-card">
            <span>Errores criticos</span>
            <strong>${utils.esc(summary.validation.errors.length)}</strong>
            <small>Bloquean VALIDADO_COMERCIAL y etapas posteriores</small>
          </article>
          <article class="summary-card">
            <span>Advertencias</span>
            <strong>${utils.esc(summary.validation.warnings.length)}</strong>
            <small>Se mantienen visibles en el flujo comercial</small>
          </article>
        </div>
        <div class="commercial-stage-track">
          ${summary.progressSteps.map(step => `
            <div class="commercial-stage ${step.completed ? "completed" : ""} ${step.current ? "current" : ""}">
              <strong>${utils.esc(step.definition.shortLabel)}</strong>
              <small>${utils.esc(step.definition.label)}</small>
            </div>
          `).join("")}
        </div>
        <div class="placeholder-grid">
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">TRANSICIONES</p>
                <h3>Acciones permitidas</h3>
              </div>
            </div>
            <div class="table-actions-inline commercial-transition-actions">
              ${summary.allowedTransitions.map(item => `
                <button
                  class="secondary-button"
                  data-commercial-status-target="${utils.esc(item.targetStatus)}"
                  data-commercial-status-reason="${utils.esc(["ANULADO", "REABIERTO_DEMO"].includes(item.targetStatus) ? "required" : "optional")}"
                >${utils.esc(item.label)}</button>
              `).join("") || `<span class="empty-inline">Sin transiciones disponibles.</span>`}
            </div>
            <div class="base-ready-list">
              ${summary.allowedTransitions.map(item => `
                <div class="base-ready-item">
                  <strong>${utils.esc(item.label)}</strong>
                  <span>${utils.esc(item.ready ? "Lista" : (item.errors[0] || item.description))}</span>
                </div>
              `).join("") || `<div class="base-ready-item"><strong>Estado estable</strong><span>No hay acciones adicionales en esta etapa.</span></div>`}
            </div>
          </article>
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">EDICION</p>
                <h3>Bloqueos activos</h3>
              </div>
            </div>
            <ul class="checklist-list">
              <li>${utils.esc(summary.editPolicy.message || "Pedido editable completo.")}</li>
              <li>${utils.esc(summary.status === "ANULADO" ? "Solo se permite consulta y copia anulada." : "Anular y reabrir quedan registrados con motivo.")}</li>
              <li>${utils.esc(summary.status === "CERRADO_DEMO" ? "Solo reimpresion permitida." : "El historial comercial conserva cada cambio de estado y documento.")}</li>
            </ul>
          </article>
          <article class="panel-card">
            <div class="panel-card-head">
              <div>
                <p class="section-kicker">ULTIMA ACCION</p>
                <h3>Historial reciente</h3>
              </div>
            </div>
            <div class="info-stack">
              <div class="info-row"><strong>Accion</strong><span>${utils.esc(latestAction?.actionLabel || "-")}</span></div>
              <div class="info-row"><strong>Usuario</strong><span>${utils.esc(latestAction?.userName || "-")}</span></div>
              <div class="info-row"><strong>Fecha</strong><span>${utils.esc(latestAction?.createdAt ? latestAction.createdAt.replace("T", " ").slice(0, 16) : "-")}</span></div>
              <div class="info-row"><strong>Resultado</strong><span>${utils.esc(latestAction?.result || "-")}</span></div>
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function renderKeyValueCard(title, rows) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">PEDIDO MAESTRO</p>
            <h3>${utils.esc(title)}</h3>
          </div>
        </div>
        <div class="info-stack">
          ${rows.map(([label, value]) => `
            <div class="info-row">
              <strong>${utils.esc(label)}</strong>
              <span>${utils.esc(value)}</span>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  function renderGroupedSummary(title, rows, formatter = value => value) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">RESUMEN</p>
            <h3>${utils.esc(title)}</h3>
          </div>
        </div>
        <div class="base-ready-list">
          ${rows.length ? rows.map(item => `
            <div class="base-ready-item">
              <strong>${utils.esc(item.label)}</strong>
              <span>${utils.esc(formatter(item.value))}</span>
            </div>
          `).join("") : `<div class="empty-inline">Sin datos cargados todavia.</div>`}
        </div>
      </article>
    `;
  }

  function renderSummaryTab(order, appState) {
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);
    const agency = utils.findAgency(order.agencyId);
    const airline = utils.findAirline(order.airlineId);
    const metrics = utils.getOrderMetrics(order);
    const contract = utils.buildCommercialOrderContract(order);

    const byLength = Object.entries(metrics.byLength)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([label, value]) => ({ label: `${label} cm`, value: `${utils.number(value)} tallos` }));
    const byVariety = Object.entries(metrics.byVariety)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value: `${utils.number(value)} tallos` }));
    const byBoxType = Object.entries(metrics.byBoxType)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value: `${utils.number(value)} cajas` }));

    return `
      <section class="summary-grid">
        <article class="summary-card">
          <span>Total cajas fisicas</span>
          <strong>${utils.esc(metrics.totalBoxes)}</strong>
          <small>Segun detalle por caja</small>
        </article>
        <article class="summary-card">
          <span>Total fulls</span>
          <strong>${metrics.totalFulls.toFixed(2)}</strong>
          <small>HB 0.5 · QB 0.25 · EB configurable</small>
        </article>
        <article class="summary-card">
          <span>Total tallos</span>
          <strong>${utils.esc(utils.number(metrics.totalStems))}</strong>
          <small>Ramos x tallos por ramo</small>
        </article>
        <article class="summary-card">
          <span>Total USD</span>
          <strong>${utils.esc(utils.money(metrics.totalUsd))}</strong>
          <small>Precio promedio ${metrics.averagePricePerStem.toFixed(3)} por tallo</small>
        </article>
      </section>
      <section class="placeholder-grid">
        ${renderKeyValueCard("Cabecera comercial", [
          ["Numero pedido", order.number],
          ["Cliente principal", customer?.commercialName || "-"],
          ["Marca / cliente final", brand?.name || "-"],
          ["Destino", order.destination || "-"],
          ["DAE", order.daeNumber || "-"],
          ["Estado", order.status || "BORRADOR"]
        ])}
        ${renderKeyValueCard("Logistica actual", [
          ["Agencia de carga", agency?.name || "-"],
          ["Carrier", airline?.name || "-"],
          ["Vuelo", order.flightNumber || "-"],
          ["AWB", order.awb || "-"],
          ["HAWB", order.hawb || "-"],
          ["Cuarto frio", order.coldRoom || "-"]
        ])}
        ${renderGroupedSummary("Resumen por longitud", byLength)}
        ${renderGroupedSummary("Resumen por variedad", byVariety)}
        ${renderGroupedSummary("Resumen por tipo de caja", byBoxType)}
        ${renderKeyValueCard("Contrato comercial demo", [
          ["commercialOrderContract", "Demo preparado"],
          ["Pedido id", contract.pedido_id],
          ["Cliente principal", contract.cliente_principal_nombre || "-"],
          ["Marca", contract.marca_nombre || "-"],
          ["Total cajas", String(contract.total_cajas)],
          ["Total USD", utils.money(contract.total_usd)]
        ])}
      </section>
    `;
  }

  function renderCustomerBrandTab(order) {
    const customer = utils.findCustomer(order.customerId);
    const brand = utils.findBrand(order.brandId);
    const relatedBrands = utils.findBrandsByCustomer(order.customerId);
    const customerLocked = isFieldLocked(order, "customerId");
    const brandLocked = isFieldLocked(order, "brandId");

    return `
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RELACION COMERCIAL</p>
              <h3>Cliente principal y marca</h3>
            </div>
          </div>
          <p class="panel-note">El cliente principal es interno para control comercial y cartera futura. La marca / cliente final alimenta el documento carguera.</p>
          <div class="compact-form-grid commercial-form-grid">
            <label class="compact-field">
              <span>Cliente principal</span>
              <select data-commercial-order-field="customerId" ${disabledAttr(customerLocked)}>
                <option value="">Seleccione cliente</option>
                ${data.customers.map(item => `
                  <option value="${utils.esc(item.id)}" ${item.id === order.customerId ? "selected" : ""}>
                    ${utils.esc(item.commercialName)} · ${utils.esc(item.code)}
                  </option>
                `).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Marca / cliente final</span>
              <select data-commercial-order-field="brandId" ${disabledAttr(brandLocked)}>
                <option value="">Seleccione marca</option>
                ${relatedBrands.map(item => `
                  <option value="${utils.esc(item.id)}" ${item.id === order.brandId ? "selected" : ""}>
                    ${utils.esc(item.name)} · ${utils.esc(item.destination)}
                  </option>
                `).join("")}
              </select>
            </label>
          </div>
          <div class="table-actions-inline">
            <button class="secondary-button" data-route-link="commercial-customers-brands">Ver catalogo Clientes / Marcas</button>
          </div>
        </article>
        ${renderKeyValueCard("Cliente principal interno", [
          ["Codigo", customer?.code || "-"],
          ["Nombre comercial", customer?.commercialName || "-"],
          ["Razon social", customer?.legalName || "-"],
          ["Identificacion", customer?.identification || "-"],
          ["Correo facturacion", customer?.billingEmail || "-"],
          ["Credito", customer ? `${customer.creditDays} dias · ${utils.money(customer.creditAmount)}` : "-"]
        ])}
        ${renderKeyValueCard("Marca / cliente final", [
          ["Codigo", brand?.code || "-"],
          ["Marca", brand?.name || "-"],
          ["Cliente final", brand?.finalClientName || "-"],
          ["Destino", brand?.destination || "-"],
          ["Contacto", brand?.contact || "-"],
          ["Requiere PO", brand ? (brand.requiresPo ? "Si" : "No") : "-"]
        ])}
      </section>
    `;
  }

  function renderLogisticsTab(order) {
    const agency = utils.findAgency(order.agencyId);
    const airline = utils.findAirline(order.airlineId);
    const dae = utils.findDae(order.daeNumber);
    const availableDaes = utils.getAvailableDaesForOrder(order);
    const issuedLocked = isFieldLocked(order, "issuedAt");
    const flightLocked = isFieldLocked(order, "flightDate");
    const agencyLocked = isFieldLocked(order, "agencyId");
    const awbLocked = isFieldLocked(order, "awb");
    const hawbLocked = isFieldLocked(order, "hawb");
    const airlineLocked = isFieldLocked(order, "airlineId");
    const flightNumberLocked = isFieldLocked(order, "flightNumber");
    const transportLocked = isFieldLocked(order, "transportType");
    const coldRoomLocked = isFieldLocked(order, "coldRoom");
    const daeLocked = isFieldLocked(order, "daeNumber");

    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">LOGISTICA</p>
            <h3>Datos editables del embarque demo</h3>
          </div>
          <span class="status-badge partial">${utils.esc(order.transportType || "aereo")}</span>
        </div>
        <div class="compact-form-grid commercial-form-grid">
          <label class="compact-field">
            <span>Fecha emision</span>
            <input type="date" value="${utils.esc(order.issuedAt)}" data-commercial-order-field="issuedAt" ${disabledAttr(issuedLocked)}>
          </label>
          <label class="compact-field">
            <span>Fecha vuelo</span>
            <input type="date" value="${utils.esc(order.flightDate)}" data-commercial-order-field="flightDate" ${disabledAttr(flightLocked)}>
          </label>
          <label class="compact-field">
            <span>Agencia de carga</span>
            <select data-commercial-order-field="agencyId" ${disabledAttr(agencyLocked)}>
              <option value="">Seleccione agencia</option>
              ${data.agencies.map(item => `
                <option value="${utils.esc(item.id)}" ${item.id === order.agencyId ? "selected" : ""}>
                  ${utils.esc(item.name)}
                </option>
              `).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>AWB / guia madre</span>
            <input type="text" value="${utils.esc(order.awb)}" data-commercial-order-field="awb" ${disabledAttr(awbLocked)}>
          </label>
          <label class="compact-field">
            <span>HAWB / guia hija</span>
            <input type="text" value="${utils.esc(order.hawb)}" data-commercial-order-field="hawb" ${disabledAttr(hawbLocked)}>
          </label>
          <label class="compact-field">
            <span>Carrier / linea aerea</span>
            <select data-commercial-order-field="airlineId" ${disabledAttr(airlineLocked)}>
              <option value="">Seleccione carrier</option>
              ${data.airlines.map(item => `
                <option value="${utils.esc(item.id)}" ${item.id === order.airlineId ? "selected" : ""}>
                  ${utils.esc(item.name)}
                </option>
              `).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Vuelo</span>
            <input type="text" value="${utils.esc(order.flightNumber)}" data-commercial-order-field="flightNumber" ${disabledAttr(flightNumberLocked)}>
          </label>
          <label class="compact-field">
            <span>Tipo transporte</span>
            <select data-commercial-order-field="transportType" ${disabledAttr(transportLocked)}>
              ${[
                ["aereo", "Aereo"],
                ["maritimo", "Maritimo"],
                ["terrestre", "Terrestre"]
              ].map(([value, label]) => `
                <option value="${value}" ${value === order.transportType ? "selected" : ""}>${label}</option>
              `).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuarto frio</span>
            <input type="text" value="${utils.esc(order.coldRoom)}" data-commercial-order-field="coldRoom" ${disabledAttr(coldRoomLocked)}>
          </label>
          <label class="compact-field">
            <span>Destino</span>
            <input type="text" value="${utils.esc(order.destination)}" disabled>
          </label>
          <label class="compact-field">
            <span>DAE asignada</span>
            <select data-commercial-order-field="daeNumber" ${order.transportType !== "aereo" || daeLocked ? "disabled" : ""}>
              <option value="">${order.transportType !== "aereo" ? "Bloqueada para transporte no aereo" : "Seleccione DAE"}</option>
              ${availableDaes.map(item => `
                <option value="${utils.esc(item.number)}" ${item.number === order.daeNumber ? "selected" : ""}>
                  ${utils.esc(item.number)} · ${utils.esc(item.destination)}
                </option>
              `).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Caducidad DAE</span>
            <input type="text" value="${utils.esc(utils.dateLabel(order.daeExpirationDate))}" disabled>
          </label>
        </div>
        <div class="hero-banner commercial-inline-banner">
          <div>
            <strong>Regla activa</strong>
            <span>Marca -> destino -> DAE automatica. La agencia y el cuarto frio se sugieren desde la marca, pero pueden ajustarse en demo.</span>
          </div>
          <span class="status-badge ${utils.badgeClass(dae && utils.isDaeNearExpiry(dae) ? "warning" : "demo")}">
            ${utils.esc(dae ? (utils.isDaeNearExpiry(dae) ? "DAE proxima a caducar" : "DAE asignada") : "Sin DAE")}
          </span>
        </div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-route-link="commercial-daes">Ver catalogo DAE</button>
          <button class="secondary-button" data-route-link="commercial-cargo-agencies">Ver agencias</button>
        </div>
      </section>
      <section class="placeholder-grid">
        ${renderKeyValueCard("Resumen logistico", [
          ["Agencia", agency?.name || "-"],
          ["Carrier", airline?.name || "-"],
          ["AWB", order.awb || "-"],
          ["HAWB", order.hawb || "-"],
          ["DAE", order.daeNumber || "-"],
          ["Destino", order.destination || "-"]
        ])}
        ${renderKeyValueCard("Estado de DAE", [
          ["Autoasignada", order.daeAssignedAutomatically ? "Si" : "No"],
          ["Modificada manual", order.daeModifiedManual ? "Si" : "No"],
          ["Destino DAE", order.daeDestination || "-"],
          ["Caducidad", utils.dateLabel(order.daeExpirationDate)],
          ["Linea sugerida", airline?.name || "-"],
          ["Alertas", dae && utils.isDaeNearExpiry(dae) ? "Proxima a caducar" : "Sin alertas criticas"]
        ])}
      </section>
    `;
  }

  function renderLinesTab(order, appState) {
    const brand = utils.findBrand(order.brandId);
    const metrics = utils.getOrderMetrics(order);
    const linesLocked = areLinesLocked(order);
    const reservationUsage = utils.getReservationUsageSummary(order, stateApi.getReservations(appState));
    const operationalVarieties = getOperationalVarieties(appState, order);

    return `
      <section class="summary-grid">
        <article class="summary-card"><span>Reservas activas demo</span><strong>${utils.esc(reservationUsage.activeCount)}</strong><small>Ligadas al pedido actual</small></article>
        <article class="summary-card"><span>Ramos reservados</span><strong>${utils.esc(utils.number(reservationUsage.reservedBunches))}</strong><small>Desde Operaciones / Disponibilidad</small></article>
        <article class="summary-card"><span>Ramos sin usar</span><strong>${utils.esc(utils.number(reservationUsage.unusedBunches))}</strong><small>Aun no pasados a cajas</small></article>
        <article class="summary-card"><span>Lineas sin reserva</span><strong>${utils.esc(reservationUsage.linesWithoutReservation)}</strong><small>Advertencia comercial, no bloqueo</small></article>
      </section>
      <section class="hero-banner commercial-inline-banner">
        <div>
          <strong>Uso de reservas demo</strong>
          <span>${utils.esc(reservationUsage.linesWithoutReservation > 0 ? "Existen lineas de cajas sin reserva demo asociada. Revise la pestaña Disponibilidad / Reservas." : "Las lineas pueden referenciar reservas demo de Operaciones sin tocar inventario real.")}</span>
        </div>
        <span class="status-badge ${utils.badgeClass(reservationUsage.linesWithoutReservation > 0 ? "pendiente" : "activo")}">${utils.esc(reservationUsage.linesWithoutReservation > 0 ? "Con advertencias" : "Enlazado demo")}</span>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CAJAS Y VARIEDADES</p>
            <h3>Tabla editable demo</h3>
          </div>
          <button class="secondary-button" data-commercial-add-line ${disabledAttr(linesLocked)}>Agregar linea</button>
        </div>
        <p class="panel-note">Cada linea recalcula tallos y total automaticamente. Si una linea nace desde una reserva demo, mantiene referencia a la disponibilidad de Operaciones.</p>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table commercial-lines-table">
            <thead>
              <tr>
                <th>Caja numero</th>
                <th>Tipo caja</th>
                <th>Variedad</th>
                <th>PO</th>
                <th>Longitud</th>
                <th>Ramos</th>
                <th>Tallos por ramo</th>
                <th>Total tallos</th>
                <th>Precio unitario</th>
                <th>Total linea</th>
                <th>Reserva demo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${metrics.lines.map((line, index) => `
                <tr class="${index > 0 && metrics.lines[index - 1].boxNumber !== line.boxNumber ? "commercial-box-break" : ""}">
                  <td><input type="number" min="1" value="${utils.esc(line.boxNumber)}" data-commercial-line-field="${utils.esc(line.id)}|boxNumber" ${disabledAttr(linesLocked)}></td>
                  <td>
                    <select data-commercial-line-field="${utils.esc(line.id)}|boxType" ${disabledAttr(linesLocked)}>
                      ${data.boxTypes.map(item => `
                        <option value="${utils.esc(item.code)}" ${item.code === line.boxType ? "selected" : ""}>${utils.esc(item.code)}</option>
                      `).join("")}
                    </select>
                  </td>
                  <td>
                    <select data-commercial-line-field="${utils.esc(line.id)}|variety" ${disabledAttr(linesLocked)}>
                      ${operationalVarieties.map(item => `
                        <option value="${utils.esc(item)}" ${item === line.variety ? "selected" : ""}>${utils.esc(item)}</option>
                      `).join("")}
                    </select>
                  </td>
                  <td>
                    <input type="text" value="${utils.esc(line.po || "")}" data-commercial-line-field="${utils.esc(line.id)}|po" ${disabledAttr(linesLocked)}>
                    ${brand?.requiresPo && !String(line.po || "").trim() ? `<small class="warn-text">PO requerida</small>` : ""}
                  </td>
                  <td><input type="number" min="30" max="120" step="10" value="${utils.esc(line.length)}" data-commercial-line-field="${utils.esc(line.id)}|length" ${disabledAttr(linesLocked)}></td>
                  <td><input type="number" min="0" step="1" value="${utils.esc(line.bunches)}" data-commercial-line-field="${utils.esc(line.id)}|bunches" ${disabledAttr(linesLocked)}></td>
                  <td><input type="number" min="0" step="1" value="${utils.esc(line.stemsPerBunch)}" data-commercial-line-field="${utils.esc(line.id)}|stemsPerBunch" ${disabledAttr(linesLocked)}></td>
                  <td class="numeric">${utils.esc(utils.number(line.totalStems))}</td>
                  <td><input type="number" min="0" step="0.001" value="${utils.esc(line.unitPrice)}" data-commercial-line-field="${utils.esc(line.id)}|unitPrice" ${disabledAttr(linesLocked)}></td>
                  <td class="numeric">${utils.esc(utils.money(line.totalLine))}</td>
                  <td>
                    ${line.reservationId ? `
                      <div class="info-stack">
                        <div class="info-row"><strong>Reserva</strong><span>${utils.esc(line.reservationId)}</span></div>
                        <div class="info-row"><strong>Origen</strong><span>${utils.esc(line.reservationSourceId || "-")}</span></div>
                        <div class="info-row"><strong>Uso</strong><span>${utils.esc(utils.number(line.reservationBunchesUsed || line.bunches))} ramos</span></div>
                      </div>
                    ` : `<small class="warn-text">Sin reserva asociada</small>`}
                  </td>
                  <td>
                    <select data-commercial-line-field="${utils.esc(line.id)}|state" ${disabledAttr(linesLocked)}>
                      ${["borrador", "reservado", "confirmado"].map(item => `
                        <option value="${item}" ${item === line.state ? "selected" : ""}>${item}</option>
                      `).join("")}
                    </select>
                  </td>
                  <td>
                    <div class="table-actions-inline commercial-action-stack">
                      <button class="secondary-button" data-commercial-duplicate-line="${utils.esc(line.id)}" ${disabledAttr(linesLocked)}>Duplicar</button>
                      <button class="secondary-button" data-commercial-delete-line="${utils.esc(line.id)}" ${disabledAttr(linesLocked)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="13">No hay lineas demo. Agregue la primera caja o cree una desde reserva.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPoTab(order) {
    const brand = utils.findBrand(order.brandId);
    const generalPoLocked = isFieldLocked(order, "generalPo");
    const notesLocked = isFieldLocked(order, "notes");
    return `
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">PO / MARCACIONES</p>
              <h3>Reglas de PO</h3>
            </div>
          </div>
          <div class="compact-form-grid commercial-form-grid">
            <label class="compact-field">
              <span>PO general del pedido</span>
              <input type="text" value="${utils.esc(order.generalPo)}" data-commercial-order-field="generalPo" ${disabledAttr(generalPoLocked)}>
            </label>
            <label class="compact-field full">
              <span>Observaciones comerciales</span>
              <textarea data-commercial-order-field="notes" ${disabledAttr(notesLocked)}>${utils.esc(order.notes)}</textarea>
            </label>
          </div>
          <p class="panel-note">Prioridad activa: PO por linea > PO general del pedido. No se digita una tercera vez en packing.</p>
        </article>
        ${renderKeyValueCard("Politica de la marca", [
          ["Marca actual", brand?.name || "-"],
          ["Requiere PO", brand ? (brand.requiresPo ? "Si" : "No") : "-"],
          ["Observacion", brand?.observation || "-"]
        ])}
      </section>
    `;
  }

  function renderAvailabilityBoard(order, appState, standalone = false) {
    const ui = stateApi.getUi(appState);
    const rows = utils.getAvailabilityRowsWithReservations(appState);
    const reserveLocked = areLinesLocked(order);
    const reservationSummary = utils.getReservationSummary(order, stateApi.getReservations(appState));
    const reservationUsage = utils.getReservationUsageSummary(order, stateApi.getReservations(appState));
    const filteredRows = rows.filter(item => {
      if (ui.availabilityFilterVariety && String(item.variety) !== String(ui.availabilityFilterVariety)) return false;
      if (ui.availabilityFilterLength && String(item.length) !== String(ui.availabilityFilterLength)) return false;
      if (ui.availabilityFilterCategory && String(item.category || item.categoria || "").toUpperCase() !== String(ui.availabilityFilterCategory).toUpperCase()) return false;
      if (ui.availabilityFilterWarehouse && String(item.warehouse || item.bodega || "").toUpperCase() !== String(ui.availabilityFilterWarehouse).toUpperCase()) return false;
      if (ui.availabilityFilterState && String(item.status || item.estado || "").toUpperCase() !== String(ui.availabilityFilterState).toUpperCase()) return false;
      return true;
    });
    const varieties = [...new Set(rows.map(item => item.variety).filter(Boolean))].sort();
    const lengths = [...new Set(rows.map(item => Number(item.length)).filter(Boolean))].sort((a, b) => a - b);
    const categories = [...new Set(rows.map(item => item.category || item.categoria).filter(Boolean))].sort();
    const warehouses = [...new Set(rows.map(item => item.warehouse || item.bodega).filter(Boolean))].sort();
    const states = [...new Set(rows.map(item => item.status || item.estado).filter(Boolean))].sort();

    const reservationsMarkup = reservationSummary.rows.map((item, index) => {
      const reservationId = item.reservation_id || item.id;
      const lineDraft = ui.reservationLineDrafts?.[reservationId] || {
        boxNumber: utils.getOrderMetrics(order).totalBoxes + index + 1,
        boxType: "HB",
        unitPrice: 0.28,
        po: order.generalPo || "",
        bunchesUsed: utils.parseNumber(item.ramos_reservados || item.bunchesReserved, 1)
      };

      return `
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESERVA DEMO</p>
              <h3>${utils.esc(item.variedad || item.variety)} · ${utils.esc(item.longitud || item.length)} cm</h3>
            </div>
            <span class="status-badge ${utils.badgeClass(item.estado || item.status)}">${utils.esc(item.estado || item.status)}</span>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>ID reserva</strong><span>${utils.esc(reservationId)}</span></div>
            <div class="info-row"><strong>Origen disponibilidad</strong><span>${utils.esc(item.availability_id || item.availabilityId || "-")}</span></div>
            <div class="info-row"><strong>Ramos reservados</strong><span>${utils.esc(utils.number(item.ramos_reservados || item.bunchesReserved || 0))}</span></div>
            <div class="info-row"><strong>Tallos reservados</strong><span>${utils.esc(utils.number(item.tallos_reservados || item.stemsReserved || 0))}</span></div>
            <div class="info-row"><strong>Bodega</strong><span>${utils.esc(item.bodega || "-")}</span></div>
            <div class="info-row"><strong>Fecha / usuario</strong><span>${utils.esc(String(item.fecha_hora || "").replace("T", " ").slice(0, 16) || "-")} · ${utils.esc(item.usuario_demo || item.userDemo || "-")}</span></div>
          </div>
          <div class="compact-form-grid commercial-form-grid">
            <label class="compact-field">
              <span>Caja</span>
              <input type="number" min="1" value="${utils.esc(lineDraft.boxNumber)}" data-commercial-reservation-line-field="${utils.esc(reservationId)}|boxNumber" ${disabledAttr(reserveLocked)}>
            </label>
            <label class="compact-field">
              <span>Tipo caja</span>
              <select data-commercial-reservation-line-field="${utils.esc(reservationId)}|boxType" ${disabledAttr(reserveLocked)}>
                ${data.boxTypes.map(box => `<option value="${utils.esc(box.code)}" ${box.code === lineDraft.boxType ? "selected" : ""}>${utils.esc(box.code)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field">
              <span>Ramos a usar</span>
              <input type="number" min="1" max="${utils.esc(utils.parseNumber(item.ramos_reservados || item.bunchesReserved, 1))}" value="${utils.esc(lineDraft.bunchesUsed)}" data-commercial-reservation-line-field="${utils.esc(reservationId)}|bunchesUsed" ${disabledAttr(reserveLocked)}>
            </label>
            <label class="compact-field">
              <span>Precio unitario</span>
              <input type="number" min="0" step="0.001" value="${utils.esc(lineDraft.unitPrice)}" data-commercial-reservation-line-field="${utils.esc(reservationId)}|unitPrice" ${disabledAttr(reserveLocked)}>
            </label>
            <label class="compact-field">
              <span>PO linea</span>
              <input type="text" value="${utils.esc(lineDraft.po || "")}" data-commercial-reservation-line-field="${utils.esc(reservationId)}|po" ${disabledAttr(reserveLocked)}>
            </label>
          </div>
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-create-line-from-reservation="${utils.esc(reservationId)}" ${disabledAttr(reserveLocked || !utils.isReservationActive(item))}>Crear linea desde reserva</button>
            <button class="secondary-button" data-commercial-confirm-reservation="${utils.esc(reservationId)}">Confirmar</button>
            <button class="secondary-button" data-commercial-release-reservation="${utils.esc(reservationId)}">Liberar</button>
            <button class="secondary-button" data-commercial-open-availability-origin="${utils.esc(item.availability_id || item.availabilityId || "")}">Ver origen en Operaciones</button>
          </div>
        </article>
      `;
    }).join("");

    const content = `
      <section class="summary-grid">
        <article class="summary-card"><span>Filas visibles</span><strong>${utils.esc(filteredRows.length)}</strong><small>Disponibilidad demo compartida</small></article>
        <article class="summary-card"><span>Reservas activas pedido</span><strong>${utils.esc(reservationSummary.count)}</strong><small>reservationContract demo</small></article>
        <article class="summary-card"><span>Ramos reservados</span><strong>${utils.esc(utils.number(reservationSummary.totalBunches))}</strong><small>Sin inventario real</small></article>
        <article class="summary-card"><span>Ramos sin usar</span><strong>${utils.esc(utils.number(reservationUsage.unusedBunches))}</strong><small>Reservados pero aun no pasados a cajas</small></article>
      </section>
      <section class="hero-banner commercial-inline-banner">
        <div>
          <strong>Disponibilidad real pendiente de integracion con Operaciones / Poscosecha</strong>
          <span>Esta fase usa el mismo origen demo de Operaciones. Comercial reserva, confirma y libera en modo visual, pero no modifica inventario real de rosas.</span>
        </div>
        <span class="status-badge partial">availabilityContract / reservationContract demo</span>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">FILTROS</p>
            <h3>Consulta compartida Operaciones -> Comercial</h3>
          </div>
          <button class="secondary-button" data-route-link="operations-availability">Abrir disponibilidad operativa</button>
        </div>
        <div class="compact-form-grid commercial-form-grid">
          <label class="compact-field">
            <span>Variedad</span>
            <select data-commercial-availability-filter="availabilityFilterVariety">
              <option value="">Todas</option>
              ${varieties.map(item => `<option value="${utils.esc(item)}" ${item === ui.availabilityFilterVariety ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Longitud</span>
            <select data-commercial-availability-filter="availabilityFilterLength">
              <option value="">Todas</option>
              ${lengths.map(item => `<option value="${utils.esc(item)}" ${String(item) === String(ui.availabilityFilterLength) ? "selected" : ""}>${utils.esc(item)} cm</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Categoria</span>
            <select data-commercial-availability-filter="availabilityFilterCategory">
              <option value="">Todas</option>
              ${categories.map(item => `<option value="${utils.esc(item)}" ${String(item) === String(ui.availabilityFilterCategory) ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Bodega</span>
            <select data-commercial-availability-filter="availabilityFilterWarehouse">
              <option value="">Todas</option>
              ${warehouses.map(item => `<option value="${utils.esc(item)}" ${String(item) === String(ui.availabilityFilterWarehouse) ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Estado</span>
            <select data-commercial-availability-filter="availabilityFilterState">
              <option value="">Todos</option>
              ${states.map(item => `<option value="${utils.esc(item)}" ${String(item) === String(ui.availabilityFilterState) ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}
            </select>
          </label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">DISPONIBILIDAD / RESERVAS</p>
            <h3>Consulta y reserva demo</h3>
          </div>
          <span class="status-badge partial">${utils.esc(filteredRows.length)} filas</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table">
            <thead>
              <tr>
                <th>availability_id</th>
                <th>Variedad</th>
                <th>Longitud</th>
                <th>Categoria</th>
                <th>Ramos iniciales</th>
                <th>Ramos reservados demo</th>
                <th>Ramos saldo demo</th>
                <th>Tallos saldo demo</th>
                <th>Bodega</th>
                <th>Estado</th>
                <th>Edad dias</th>
                <th>Reservar ramos</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRows.map(item => `
                <tr>
                  <td>${utils.esc(item.availability_id)}</td>
                  <td>${utils.esc(item.variety)}</td>
                  <td>${utils.esc(item.length)} cm</td>
                  <td>${utils.esc(item.category || item.categoria || "-")}</td>
                  <td>${utils.esc(utils.number(item.bunchesAvailable || item.ramos_disponibles || 0))}</td>
                  <td>${utils.esc(utils.number(item.reservedBunches || item.ramos_reservados_demo || 0))}</td>
                  <td>${utils.esc(utils.number(item.remainingBunches || item.ramos_saldo_demo || 0))}</td>
                  <td>${utils.esc(utils.number(item.remainingStems || item.tallos_saldo_demo || 0))}</td>
                  <td>${utils.esc(item.warehouse || item.bodega || "-")}</td>
                  <td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td>
                  <td>${utils.esc(item.ageDays)}</td>
                  <td><input type="number" min="1" max="${utils.esc(utils.parseNumber(item.remainingBunches || item.ramos_saldo_demo || 1, 1))}" value="${utils.esc(ui.availabilityReserveDrafts?.[item.id] || 1)}" data-commercial-reserve-qty="${utils.esc(item.id)}" ${disabledAttr(reserveLocked || !item.reservable_demo)}></td>
                  <td><button class="secondary-button" data-commercial-reserve-availability="${utils.esc(item.id)}" ${disabledAttr(reserveLocked || !item.reservable_demo)}>Reservar demo</button></td>
                </tr>
              `).join("") || `<tr><td colspan="13">No existen filas para los filtros seleccionados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESERVAS</p>
              <h3>Reservas del pedido activo</h3>
            </div>
          </div>
          <div class="base-ready-list">
            ${reservationsMarkup || `<div class="empty-inline">Aun no hay reservas demo ligadas a este pedido. Consulte disponibilidad y reserve ramos desde la tabla superior.</div>`}
          </div>
        </article>
        ${renderKeyValueCard("Reglas demo", [
          ["Origen", "Operaciones / Disponibilidad demo compartida"],
          ["Destino", "Pedido Maestro comercial demo"],
          ["Consumo real", "No aplica en esta fase"],
          ["Inventario de rosas", "No se modifica desde Comercial"],
          ["Reserva", "Reduce saldo visual demo y puede liberarse"],
          ["Contrato", "reservationContract demo activo"]
        ])}
      </section>
    `;

    if (!standalone) return content;

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Disponibilidad / Reservas</h1>
          <p>Consulta visual demo de disponibilidad de rosas y reservas comerciales. Sin tocar Operaciones reales.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Demo conectado</span>
        </div>
      </section>
      ${content}
    `;
  }

  function renderInvoiceTab(order, appState) {
    return BlessERP.comercialPrintSystem.renderWorkspace("INVOICE_PACKING_REFERENCIAL", order, appState, {
      title: "Invoice / Packing carguera",
      description: "Documento comercial/logistico demo basado en el pedido activo. No reemplaza factura cliente ni SRI.",
      actionsMarkup: `
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-preview-doc="INVOICE_PACKING_REFERENCIAL">Vista previa referencial</button>
          <button class="secondary-button" data-commercial-print-doc="INVOICE_PACKING_REFERENCIAL">Imprimir referencial</button>
          <button class="secondary-button" data-commercial-preview-doc="INVOICE_PACKING_REAL">Vista previa real demo</button>
          <button class="secondary-button" data-commercial-doc-placeholder="pdf|INVOICE_PACKING_REFERENCIAL">Descargar PDF</button>
        </div>
      `
    });
  }

  function renderClientInvoiceTab(order, appState) {
    return BlessERP.comercialClientInvoice.renderWorkspace(order, appState);
  }

  function renderPackingTab(order, appState) {
    return BlessERP.comercialPrintSystem.renderWorkspace("PACKING_LIST", order, appState, {
      title: "Packing List",
      description: "Packing separado del invoice, generado desde las mismas cajas del pedido.",
      controlsMarkup: `
        <div class="commercial-doc-toolbar screen-only">
          <label class="compact-field">
            <span>Mostrar precios</span>
            <input type="checkbox" data-commercial-packing-prices-toggle>
          </label>
          <p class="panel-note">Por defecto el packing sale sin valores. Active el control solo para una vista interna demo.</p>
        </div>
      `,
      actionsMarkup: `
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-preview-doc="PACKING_LIST">Vista previa sin valores</button>
          <button class="secondary-button" data-commercial-print-doc="PACKING_LIST">Imprimir sin valores</button>
          <button class="secondary-button" data-commercial-preview-doc="PACKING_LIST" data-commercial-doc-options-source="packing-prices">Vista previa con precios</button>
          <button class="secondary-button" data-commercial-print-doc="PACKING_LIST" data-commercial-doc-options-source="packing-prices">Imprimir con precios</button>
        </div>
      `
    });
  }

  function renderRouteSheetTab(order, appState) {
    return BlessERP.comercialPrintSystem.renderWorkspace("HR", order, appState, {
      title: "HR / Hoja de Ruta",
      description: "Documento operativo de despacho construido desde cajas, agencia y vuelo del pedido.",
      actionsMarkup: `
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-preview-doc="HR">Vista previa</button>
          <button class="secondary-button" data-commercial-print-doc="HR">Imprimir</button>
          <button class="secondary-button" data-commercial-doc-placeholder="email|HR">Enviar por correo</button>
        </div>
      `
    });
  }

  function renderMasterPackingTab(order, appState) {
    return BlessERP.comercialPrintSystem.renderWorkspace("MP", order, appState, {
      title: "MP / Master Packing",
      description: "Consolidado maestro del pedido para revision comercial y logistica interna.",
      actionsMarkup: `
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-preview-doc="MP">Vista previa</button>
          <button class="secondary-button" data-commercial-print-doc="MP">Imprimir</button>
          <button class="secondary-button" data-commercial-doc-placeholder="pdf|MP">Descargar PDF</button>
        </div>
      `
    });
  }

  function renderLabelsTab(order, appState) {
    return BlessERP.comercialLabels.renderWorkspace(order, appState);
  }

  function renderWarehouseTab(order, appState) {
    return BlessERP.comercialPackaging.renderWorkspace(order, appState);
  }

  function renderDispatchTab(order, appState) {
    const dispatchService = utils.getDispatchService?.();
    const consumptionService = BlessERP.operacionesConsumptionDemo;
    const cycleService = BlessERP.operacionesCycleDemo;
    const dispatch = dispatchService?.getDispatchByOrderDemo
      ? dispatchService.getDispatchByOrderDemo(appState, order.id)
      : null;
    const review = dispatchService?.validateDispatchReadinessDemo
      ? dispatchService.validateDispatchReadinessDemo(appState, order.id)
      : { ok: false, errors: ["Servicio demo de despacho no disponible."], warnings: [], checklist: [] };
    const dispatchState = dispatch?.estado_despacho || "PENDIENTE";
    const orderStatus = workflow.normalizeStatus(order.status);
    const boxRows = dispatch?.cajas || [];
    const reservationRows = dispatch?.reservas_relacionadas || [];
    const materialRows = dispatch?.materiales_requeridos || [];
    const materialMissing = materialRows.filter(item => Number(item.faltante || item.missing || 0) > 0 || String(item.estado || item.state || "").toUpperCase() === "FALTANTE");
    const materialOk = materialRows.filter(item => String(item.estado || item.state || "").toUpperCase() === "OK");
    const scannerStatus = BlessERP.operacionesScannerDemo?.getBoxScanStatusDemo
      ? BlessERP.operacionesScannerDemo.getBoxScanStatusDemo(appState, order.id)
      : { summary: { total: boxRows.length, scanned: 0, pending: boxRows.length, duplicated: 0, observed: 0 }, message: "Scanner demo no disponible.", boxes: [] };
    const documentChecks = (review.checklist || []).filter(item => ["INVOICE_PACKING_REAL", "PACKING_LIST", "HR", "MP"].includes(item.id));
    const consumptionRows = consumptionService?.getConsumptionsByOrderDemo
      ? consumptionService.getConsumptionsByOrderDemo(appState, order.id)
      : [];
    const activeConsumptionRows = consumptionRows.filter(item => String(item.estado_consumo || "").toUpperCase() === "SIMULADO");
    const revertedConsumptionRows = consumptionRows.filter(item => String(item.estado_consumo || "").toUpperCase() === "REVERTIDO_DEMO");
    const consumptionKardex = consumptionService?.getKardexByOrderDemo
      ? consumptionService.getKardexByOrderDemo(appState, order.id)
      : [];
    const consumptionReview = consumptionService?.validateConsumptionReadinessDemo
      ? consumptionService.validateConsumptionReadinessDemo(appState, order.id)
      : { warnings: ["Servicio demo de consumo no disponible."], groupedSummary: [] };
    const cycle = cycleService?.getOperationalCycleByOrderDemo
      ? cycleService.getOperationalCycleByOrderDemo(appState, order.id)
      : { estado_ciclo: "SIN_INICIAR", disponibilidad_relacionada: [], reservas: reservationRows, cajas: boxRows, escaneos: { summary: scannerStatus.summary || {} }, consumos: consumptionRows, kardex: consumptionKardex, advertencias: ["Servicio de ciclo operativo demo no disponible."] };
    const cycleTimeline = cycleService?.getOperationalCycleTimelineDemo
      ? cycleService.getOperationalCycleTimelineDemo(appState, order.id)
      : [];
    const consumptionStatus = activeConsumptionRows.length
      ? "SIMULADO"
      : revertedConsumptionRows.length
        ? "REVERTIDO_DEMO"
        : dispatchState === "DESPACHADO_DEMO"
          ? "ADVERTENCIA"
          : "PENDIENTE";
    const consumedBunches = activeConsumptionRows.reduce((sum, item) => sum + Number(item.ramos_consumidos_demo || 0), 0);
    const consumedStems = activeConsumptionRows.reduce((sum, item) => sum + Number(item.tallos_consumidos_demo || 0), 0);
    const currentUser = BlessERP.adminConfig?.activeUser ? BlessERP.adminConfig.activeUser() : null;
    const isFinalBlocked = ["ANULADO", "CERRADO_DEMO"].includes(orderStatus);
    const canPrepare = !isFinalBlocked && orderStatus !== "ANULADO";
    const canReady = ["PENDIENTE", "EN_PREPARACION"].includes(dispatchState) && !review.errors.length && !isFinalBlocked;
    const canConfirm = dispatchState === "LISTO_DESPACHO" && !["BORRADOR", "REFERENCIAL", "ANULADO", "CERRADO_DEMO"].includes(orderStatus);
    const canObserve = dispatchState !== "ANULADO_DEMO";
    const canReopen = ["OBSERVADO", "ANULADO_DEMO"].includes(dispatchState);
    const daeState = review.checklist?.find(item => item.id === "dae_vigente")?.status || (dispatch?.dae ? "OK" : "ERROR");
    const sync = dispatch?.sincronizacion_pedido || {};
    const statusMessage = orderStatus === "BORRADOR"
      ? "El pedido aun esta en borrador. Debe pasar al menos a validado comercial para despacho."
      : orderStatus === "REFERENCIAL"
        ? "Pedido referencial: puede revisar checklist, pero no confirmar despacho."
        : orderStatus === "ANULADO"
          ? "Pedido anulado. Despacho bloqueado."
          : orderStatus === "CERRADO_DEMO"
            ? "Pedido cerrado demo. Solo consulta y reimpresion."
            : "Despacho demo sincronizado visualmente con Operaciones. No descuenta inventario real de rosas ni materiales.";
    const documentRows = [
      ["Invoice carguera", order.documentActivity?.INVOICE_PACKING_REAL?.printedAt ? "IMPRESO" : order.documentActivity?.INVOICE_PACKING_REAL?.previewedAt ? "PREVIEW" : "PENDIENTE"],
      ["Packing List", order.documentActivity?.PACKING_LIST?.printedAt ? "IMPRESO" : order.documentActivity?.PACKING_LIST?.previewedAt ? "PREVIEW" : "PENDIENTE"],
      ["HR / Hoja de Ruta", order.documentActivity?.HR?.printedAt ? "IMPRESO" : order.documentActivity?.HR?.previewedAt ? "PREVIEW" : "PENDIENTE"],
      ["MP / Master Packing", order.documentActivity?.MP?.printedAt ? "IMPRESO" : order.documentActivity?.MP?.previewedAt ? "PREVIEW" : "PENDIENTE"],
      ["Etiquetas", order.documentActivity?.ETIQUETAS?.printedAt ? "IMPRESO" : order.documentActivity?.ETIQUETAS?.previewedAt ? "PREVIEW" : "PENDIENTE"]
    ];

    return `
      <section class="summary-grid">
        <article class="summary-card"><span>Total cajas</span><strong>${utils.esc(utils.number(dispatch?.total_cajas || 0))}</strong><small>Cajas del despacho demo</small></article>
        <article class="summary-card"><span>Total fulls</span><strong>${utils.esc(utils.number(Number(dispatch?.total_fulls || 0).toFixed(2)))}</strong><small>Full equivalente</small></article>
        <article class="summary-card"><span>Total ramos</span><strong>${utils.esc(utils.number(dispatch?.total_ramos || 0))}</strong><small>Ramos en cajas</small></article>
        <article class="summary-card"><span>Total tallos</span><strong>${utils.esc(utils.number(dispatch?.total_tallos || 0))}</strong><small>Tallos a despachar</small></article>
        <article class="summary-card"><span>Cajas listas</span><strong>${utils.esc(utils.number(boxRows.filter(item => String(item.estado_caja || "").toUpperCase() === "LISTA").length))}</strong><small>${utils.esc(utils.number(boxRows.length))} caja(s)</small></article>
        <article class="summary-card"><span>Cajas escaneadas</span><strong>${utils.esc(utils.number(scannerStatus.summary.scanned || 0))}</strong><small>${utils.esc(utils.number(scannerStatus.summary.pending || 0))} pendiente(s)</small></article>
        <article class="summary-card"><span>Etiquetas generadas</span><strong>${utils.esc(utils.number(dispatch?.etiquetas_generadas || 0))}</strong><small>${utils.esc(dispatch?.estado_etiquetas || "PENDIENTE")}</small></article>
        <article class="summary-card"><span>Materiales OK / faltantes</span><strong>${utils.esc(utils.number(materialOk.length))} / ${utils.esc(utils.number(materialMissing.length))}</strong><small>No consume inventario real</small></article>
        <article class="summary-card"><span>Reservas revisadas</span><strong>${utils.esc(utils.number(reservationRows.length))}</strong><small>${utils.esc(review.warnings.includes("Cajas sin reserva.") ? "Con cajas sin reserva" : "Revision demo")}</small></article>
        <article class="summary-card"><span>Estado DAE</span><strong>${utils.esc(daeState)}</strong><small>${utils.esc(dispatch?.dae || "Sin DAE")}</small></article>
      </section>
      <section class="hero-banner commercial-inline-banner">
        <div>
          <strong>Despacho demo sincronizado visualmente con Operaciones</strong>
          <span>Despacho demo. No descuenta inventario real de rosas, no consume materiales reales, no genera contabilidad y no conecta scanner real.</span>
        </div>
        <button class="secondary-button" data-commercial-dispatch-open-operations data-order-id="${utils.esc(order.id)}">Ver en Despacho operativo</button>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ESCANEO DE CAJAS DEMO</p>
            <h3>Estado visual de scanner</h3>
          </div>
          <span class="status-badge ${utils.badgeClass(scannerStatus.summary.pending ? "PENDIENTE" : "OK")}">${utils.esc(scannerStatus.summary.pending ? "Con pendientes" : "Completo demo")}</span>
        </div>
        <p class="panel-note">Escaneo demo. No equivale a confirmacion real con lector Zebra y no descuenta inventario.</p>
        <div class="info-stack">
          <div class="info-row"><strong>Cajas escaneadas</strong><span>${utils.esc(utils.number(scannerStatus.summary.scanned || 0))}</span></div>
          <div class="info-row"><strong>Cajas pendientes</strong><span>${utils.esc(utils.number(scannerStatus.summary.pending || 0))}</span></div>
          <div class="info-row"><strong>Duplicadas</strong><span>${utils.esc(utils.number(scannerStatus.summary.duplicated || 0))}</span></div>
          <div class="info-row"><strong>Estado general</strong><span>${utils.esc(scannerStatus.message || "-")}</span></div>
        </div>
        <div class="table-actions-inline">
          <button class="secondary-button" data-commercial-dispatch-open-scanner data-order-id="${utils.esc(order.id)}">Ver en Scanner / Zebra</button>
          <button class="secondary-button" data-commercial-dispatch-open-operations data-order-id="${utils.esc(order.id)}">Ver en Despacho operativo</button>
        </div>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CONSUMO OPERATIVO DEMO</p>
              <h3>Consumo de rosas por despacho</h3>
            </div>
            <span class="status-badge ${utils.badgeClass(consumptionStatus)}">${utils.esc(consumptionStatus)}</span>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Estado consumo demo</strong><span>${utils.esc(consumptionStatus)}</span></div>
            <div class="info-row"><strong>Ramos consumidos demo</strong><span>${utils.esc(utils.number(consumedBunches))}</span></div>
            <div class="info-row"><strong>Tallos consumidos demo</strong><span>${utils.esc(utils.number(consumedStems))}</span></div>
            <div class="info-row"><strong>Kardex demo</strong><span>${utils.esc(utils.number(consumptionKardex.length))} fila(s)</span></div>
          </div>
          <div class="base-ready-list">
            ${(consumptionReview.warnings || []).map(item => `<div class="base-ready-item"><strong>Advertencia</strong><span>${utils.esc(item)}</span></div>`).join("") || `<div class="base-ready-item"><strong>Sin advertencias</strong><span>Consumo demo listo para revisar en Operaciones.</span></div>`}
          </div>
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-dispatch-open-operations data-order-id="${utils.esc(order.id)}">Ver consumo en Operaciones</button>
            <button class="secondary-button" data-commercial-dispatch-action="simulate-consumption">Simular consumo demo</button>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CICLO OPERATIVO DEMO</p>
              <h3>Disponibilidad, reservas, despacho y kardex</h3>
            </div>
            <span class="status-badge ${utils.badgeClass(cycle.estado_ciclo || "PENDIENTE")}">${utils.esc(cycle.estado_ciclo || "SIN_INICIAR")}</span>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Disponibilidad origen</strong><span>${utils.esc((cycle.disponibilidad_relacionada || []).map(item => item.availability_id).join(", ") || "Pendiente demo")}</span></div>
            <div class="info-row"><strong>Reservas del pedido</strong><span>${utils.esc(utils.number((cycle.reservas || []).length))}</span></div>
            <div class="info-row"><strong>Cajas creadas</strong><span>${utils.esc(utils.number((cycle.cajas || []).length))}</span></div>
            <div class="info-row"><strong>Escaneo demo</strong><span>${utils.esc(utils.number(cycle.escaneos?.summary?.scanned || 0))} / ${utils.esc(utils.number(cycle.escaneos?.summary?.total || 0))} caja(s)</span></div>
            <div class="info-row"><strong>Despacho demo</strong><span>${utils.esc(dispatchState)}</span></div>
            <div class="info-row"><strong>Consumo demo</strong><span>${utils.esc(utils.number((cycle.consumos || []).filter(item => String(item.estado_consumo || "").toUpperCase() === "SIMULADO").length))} linea(s)</span></div>
            <div class="info-row"><strong>Kardex demo</strong><span>${utils.esc(utils.number((cycle.kardex || []).length))} movimiento(s)</span></div>
          </div>
          <div class="base-ready-list">
            ${(cycle.advertencias || []).slice(0, 6).map(item => `<div class="base-ready-item"><strong>Advertencia</strong><span>${utils.esc(item)}</span></div>`).join("") || `<div class="base-ready-item"><strong>Sin advertencias</strong><span>Ciclo operativo demo visible desde Pedido Maestro.</span></div>`}
          </div>
          <div class="base-ready-list">
            ${cycleTimeline.slice(0, 5).map(item => `
              <div class="base-ready-item">
                <strong>${utils.esc(item.label)}</strong>
                <span>${utils.esc(item.status)} - ${utils.esc(item.detail)}</span>
              </div>
            `).join("") || `<div class="base-ready-item"><strong>Sin timeline</strong><span>No hay eventos demo suficientes.</span></div>`}
          </div>
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-dispatch-open-operations data-order-id="${utils.esc(order.id)}">Ver ciclo en Operaciones</button>
            <button class="secondary-button" data-commercial-dispatch-open-scanner data-order-id="${utils.esc(order.id)}">Ver escaneo demo</button>
          </div>
          <p class="panel-note">Advertencias visibles: inventario real pendiente, consumo real pendiente y conexion Parte 1 pendiente.</p>
        </article>
        ${renderKeyValueCard("Estado general de despacho", [
          ["Pedido", dispatch?.numero_pedido || order.number],
          ["Marca / cliente final", dispatch?.marca_cliente_final || utils.findBrand(order.brandId)?.name || "-"],
          ["Destino", dispatch?.destino || order.destination || "-"],
          ["Fecha vuelo", dispatch?.fecha_vuelo || order.flightDate || "-"],
          ["DAE", dispatch?.dae || order.daeNumber || "-"],
          ["AWB", dispatch?.awb || order.awb || "-"],
          ["HAWB", dispatch?.hawb || order.hawb || "-"],
          ["Agencia de carga", dispatch?.agencia_carga || utils.findAgency(order.agencyId)?.name || "-"],
          ["Carrier / vuelo", `${dispatch?.carrier || utils.findAirline(order.airlineId)?.name || "-"} / ${dispatch?.vuelo || order.flightNumber || "-"}`],
          ["Estado comercial pedido", orderStatus],
          ["Estado despacho demo", dispatchState],
          ["Responsable demo", dispatch?.responsable_demo || currentUser?.name || "Usuario demo"],
          ["Fecha/hora despacho", dispatch?.fecha_hora_despacho ? dispatch.fecha_hora_despacho.replace("T", " ").slice(0, 16) : "-"],
          ["Observacion", dispatch?.observacion || "-"]
        ])}
        ${renderKeyValueCard("Sincronizacion", [
          ["Pedido sugerido", sync.estado_pedido_sugerido || "-"],
          ["Sincronizado", sync.sincronizado ? "Si" : "No / visual"],
          ["Ultima actualizacion demo", dispatch?.actualizado_en_demo ? dispatch.actualizado_en_demo.replace("T", " ").slice(0, 16) : "-"],
          ["Observacion", sync.observacion || "Estado comercial pendiente de sincronizacion real."]
        ])}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ACCIONES</p>
              <h3>Control del despacho demo</h3>
            </div>
            <span class="status-badge ${utils.badgeClass(dispatchState)}">${utils.esc(dispatchState)}</span>
          </div>
          <div class="inline-feedback ${review.errors.length ? "warning" : "success"}">${utils.esc(statusMessage)}</div>
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-dispatch-action="prepare" ${!canPrepare ? "disabled" : ""}>Preparar despacho demo</button>
            <button class="secondary-button" data-commercial-dispatch-action="ready" ${!canReady ? "disabled" : ""}>Marcar listo despacho</button>
            <button class="secondary-button" data-commercial-dispatch-action="confirm" ${!canConfirm ? "disabled" : ""}>Confirmar despacho demo</button>
            <button class="secondary-button" data-commercial-dispatch-action="observe" ${!canObserve ? "disabled" : ""}>Observar despacho</button>
            <button class="secondary-button" data-commercial-dispatch-action="reopen" ${!canReopen ? "disabled" : ""}>Reabrir despacho</button>
          </div>
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-print-doc="HR">Imprimir HR</button>
            <button class="secondary-button" data-commercial-print-doc="MP">Imprimir MP</button>
            <button class="secondary-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Imprimir etiquetas</button>
          </div>
        </article>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">CHECKLIST</p><h3>Checklist unico de despacho</h3></div><span class="status-badge ${utils.badgeClass(review.errors.length ? "anulado" : review.warnings.length ? "parcial" : "listo")}">${utils.esc(review.errors.length ? "Con errores" : review.warnings.length ? "Con advertencias" : "Listo")}</span></div>
          <div class="base-ready-list">
            ${(review.checklist || []).map(item => `<div class="base-ready-item"><strong>${utils.esc(item.label)}</strong><span>${utils.esc(item.status)} - ${utils.esc(item.detail)}</span></div>`).join("") || `<div class="base-ready-item"><strong>Sin checklist</strong><span>No hay revision disponible.</span></div>`}
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">VALIDACION</p><h3>Errores y advertencias</h3></div></div>
          <div class="info-stack">
            <div class="info-row"><strong>Errores criticos</strong><span>${utils.esc(review.errors.length)}</span></div>
            ${(review.errors.length ? review.errors : ["Sin errores criticos"]).map(item => `<div class="inline-feedback ${review.errors.length ? "danger" : "success"}">${utils.esc(item)}</div>`).join("")}
            <div class="info-row"><strong>Advertencias</strong><span>${utils.esc(review.warnings.length)}</span></div>
            ${(review.warnings.length ? review.warnings : ["Sin advertencias"]).map(item => `<div class="inline-feedback ${review.warnings.length ? "warning" : "success"}">${utils.esc(item)}</div>`).join("")}
          </div>
        </article>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">CAJAS</p><h3>Detalle de despacho</h3></div></div>
          <div class="compact-table-wrap">
            <table class="compact-table commercial-table">
              <thead><tr><th>Caja No.</th><th>Tipo caja</th><th>PO</th><th>Contenido resumido</th><th>Etiqueta generada</th><th>Estado caja</th><th>Accion</th></tr></thead>
              <tbody>
                ${boxRows.map(item => `<tr><td>${utils.esc(item.numero_caja)}</td><td>${utils.esc(item.tipo_caja)}</td><td>${utils.esc(item.po || "-")}</td><td>${utils.esc(item.contenido_resumido)}</td><td>${utils.esc(item.etiqueta_generada ? "Si" : "No")}</td><td><span class="status-badge ${utils.badgeClass(item.estado_caja)}">${utils.esc(item.estado_caja)}</span></td><td><button class="row-action-button" data-commercial-print-doc="ETIQUETAS" data-commercial-doc-options-source="labels-selection">Imprimir etiqueta</button></td></tr>`).join("") || `<tr><td colspan="7">No existen cajas listas para despacho demo.</td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">RESERVAS</p><h3>Uso de reservas</h3></div></div>
          ${reservationRows.length ? "" : `<div class="inline-feedback warning">Pedido sin reservas conectadas. Puede continuar en demo, pero falta conexion real de disponibilidad.</div>`}
          <div class="compact-table-wrap">
            <table class="compact-table commercial-table">
              <thead><tr><th>Variedad</th><th>Longitud</th><th>Ramos reservados</th><th>Ramos usados en cajas</th><th>Diferencia</th><th>Estado reserva</th></tr></thead>
              <tbody>
                ${reservationRows.map(item => `<tr><td>${utils.esc(item.variedad)}</td><td>${utils.esc(item.longitud)} cm</td><td>${utils.esc(utils.number(item.ramos_reservados))}</td><td>${utils.esc(utils.number(item.ramos_usados_cajas))}</td><td>${utils.esc(utils.number(item.diferencia))}</td><td><span class="status-badge ${utils.badgeClass(item.estado_reserva)}">${utils.esc(item.estado_reserva)}</span></td></tr>`).join("") || `<tr><td colspan="6">No hay reservas demo asociadas.</td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">BODEGA / MATERIALES</p><h3>Revision visual previa al despacho</h3></div><span class="status-badge ${utils.badgeClass(materialMissing.length ? "pendiente" : "ok")}">${utils.esc(materialMissing.length ? "Con faltantes" : "OK")}</span></div>
          <div class="compact-table-wrap">
            <table class="compact-table commercial-table">
              <thead><tr><th>Material</th><th>Requerido</th><th>Disponible demo</th><th>Faltante</th><th>Estado</th></tr></thead>
              <tbody>
                ${materialRows.map(item => `<tr><td>${utils.esc(item.material_nombre || item.material || "-")}</td><td>${utils.esc(utils.number(item.requerido || item.required || 0))}</td><td>${utils.esc(utils.number(item.disponible || item.disponible_demo || item.available || 0))}</td><td>${utils.esc(utils.number(item.faltante || item.missing || 0))}</td><td><span class="status-badge ${utils.badgeClass(item.estado || item.state)}">${utils.esc(item.estado || item.state || "-")}</span></td></tr>`).join("") || `<tr><td colspan="5">No hay materiales calculados para este pedido.</td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head"><div><p class="section-kicker">DOCUMENTOS</p><h3>Estado documental</h3></div></div>
          <div class="info-stack">
            ${documentRows.map(([label, state]) => `<div class="info-row"><strong>${utils.esc(label)}</strong><span class="status-badge ${utils.badgeClass(state)}">${utils.esc(state)}</span></div>`).join("")}
          </div>
        </article>
      </section>
    `;
  }

  function renderValidationsTab(order, appState) {
    const summary = workflow.buildWorkflowSummary(order, appState);
    const statusRows = [
      "BORRADOR",
      "REFERENCIAL",
      "VALIDADO_COMERCIAL",
      "LISTO_BODEGA",
      "LISTO_DESPACHO",
      "DESPACHADO_DEMO",
      "CERRADO_DEMO",
      "ANULADO",
      "REABIERTO_DEMO",
      "AUTORIZADO_SRI_FUTURO"
    ].map(status => [
      status,
      workflow.getStatusDefinition(status).description
    ]);

    return `
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">VALIDACIONES</p>
              <h3>Errores criticos</h3>
            </div>
            <span class="status-badge ${summary.validation.errors.length ? "cancelled" : "authorized"}">${summary.validation.errors.length ? summary.validation.errors.length : "0"}</span>
          </div>
          <ul class="checklist-list">
            ${(summary.validation.errors.length ? summary.validation.errors : ["Sin errores criticos"]).map(item => `<li>${utils.esc(item)}</li>`).join("")}
          </ul>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">VALIDACIONES</p>
              <h3>Advertencias</h3>
            </div>
            <span class="status-badge pending">${summary.validation.warnings.length}</span>
          </div>
          <ul class="checklist-list">
            ${(summary.validation.warnings.length ? summary.validation.warnings : ["Sin advertencias"]).map(item => `<li>${utils.esc(item)}</li>`).join("")}
          </ul>
        </article>
        ${renderKeyValueCard("Estados del pedido", [
          ["Actual", summary.status],
          ["Siguiente sugerido", summary.suggestedNext?.label || "-"],
          ["Ultima accion", summary.latestAction?.actionLabel || "-"],
          ["Usuario", summary.latestAction?.userName || "-"],
          ["Bloqueo edicion", summary.editPolicy.editBlocked || summary.editPolicy.criticalLocked ? "Si" : "No"],
          ["Motivo ultimo cambio", order.lastTransitionReason || "-"]
        ])}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ETAPAS</p>
              <h3>Matriz del flujo comercial</h3>
            </div>
          </div>
          <div class="info-stack">
            ${statusRows.map(([status, description]) => `
              <div class="info-row">
                <strong>${utils.esc(status)}</strong>
                <span>${utils.esc(description)}</span>
              </div>
            `).join("")}
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">TRANSICIONES</p>
              <h3>Chequeo por etapa</h3>
            </div>
          </div>
          <div class="base-ready-list">
            ${summary.allowedTransitions.map(item => `
              <div class="base-ready-item">
                <strong>${utils.esc(item.label)}</strong>
                <span>${utils.esc(item.ready ? "Lista para ejecutar" : (item.errors[0] || item.description))}</span>
              </div>
            `).join("") || `<div class="base-ready-item"><strong>Sin transiciones</strong><span>El pedido se encuentra en una etapa sin siguiente accion automatica.</span></div>`}
          </div>
        </article>
      </section>
    `;
  }

  function renderHistoryTab(order, appState) {
    const history = workflow.getHistory(order);
    const contract = workflow.buildCommercialWorkflowContract(order, appState);

    return `
      <section class="summary-grid">
        <article class="summary-card">
          <span>Eventos registrados</span>
          <strong>${utils.esc(history.length)}</strong>
          <small>Historial demo del pedido actual</small>
        </article>
        <article class="summary-card">
          <span>Ultima accion</span>
          <strong>${utils.esc(history[0]?.actionLabel || "-")}</strong>
          <small>${utils.esc(history[0]?.userName || "Sin usuario")}</small>
        </article>
        <article class="summary-card">
          <span>Estado actual</span>
          <strong>${utils.esc(contract.estado_actual)}</strong>
          <small>${utils.esc(contract.transicion || "-")}</small>
        </article>
        <article class="summary-card">
          <span>Documentos habilitados</span>
          <strong>${utils.esc(contract.documentos_habilitados.length)}</strong>
          <small>Segun flujo comercial demo</small>
        </article>
      </section>
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">HISTORIAL COMERCIAL</p>
              <h3>Bitacora del pedido</h3>
            </div>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table commercial-table">
              <thead>
                <tr>
                  <th>Fecha / hora</th>
                  <th>Usuario</th>
                  <th>Accion</th>
                  <th>Estado anterior</th>
                  <th>Estado nuevo</th>
                  <th>Descripcion</th>
                  <th>Motivo</th>
                  <th>Resultado</th>
                  <th>Documento</th>
                </tr>
              </thead>
              <tbody>
                ${history.map(item => `
                  <tr>
                    <td>${utils.esc(String(item.createdAt || "-").replace("T", " ").slice(0, 16))}</td>
                    <td>${utils.esc(item.userName || "-")}</td>
                    <td>${utils.esc(item.actionLabel || item.action || "-")}</td>
                    <td>${utils.esc(item.previousStatus || "-")}</td>
                    <td>${utils.esc(item.nextStatus || "-")}</td>
                    <td>${utils.esc(item.description || "-")}</td>
                    <td>${utils.esc(item.reason || "-")}</td>
                    <td><span class="status-badge ${utils.badgeClass(item.result)}">${utils.esc(item.result || "-")}</span></td>
                    <td>${utils.esc(item.documentLabel || "-")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="9">No hay eventos registrados todavia.</td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
        ${renderKeyValueCard("commercialWorkflowContract", [
          ["Estado actual", contract.estado_actual],
          ["Estado anterior", contract.estado_anterior],
          ["Transicion", contract.transicion],
          ["Usuario", contract.usuario],
          ["Errores", String(contract.errores.length)],
          ["Advertencias", String(contract.advertencias.length)]
        ])}
        ${renderKeyValueCard("Bloqueos y documentos", [
          ["Edicion bloqueada", contract.edicion_bloqueada ? "Si" : "No"],
          ["Documentos habilitados", contract.documentos_habilitados.join(", ") || "-"],
          ["Motivo", contract.motivo || "-"],
          ["Fecha referencia", contract.fecha_hora.replace("T", " ").slice(0, 16)]
        ])}
      </section>
    `;
  }

  function renderCurrentTab(order, appState) {
    const tab = stateApi.getUi(appState).orderTab || "summary";
    if (tab === "summary") return BlessERP.comercialPedidoMasterWorkspace?.render
      ? BlessERP.comercialPedidoMasterWorkspace.render(order, appState)
      : renderSummaryTab(order, appState);
    if (tab === "customer-brand") return renderCustomerBrandTab(order);
    if (tab === "logistics") return renderLogisticsTab(order);
    if (tab === "lines") return BlessERP.comercialPedidoDemandView.renderLines(order, appState, {
      utils,
      stateApi,
      boxTypes: data.boxTypes,
      operationalVarieties: getOperationalVarieties(appState, order),
      operationalLengths: getOperationalLengths(appState, order),
      linesLocked: areLinesLocked(order),
      disabledAttr
    });
    if (tab === "po") return renderPoTab(order);
    if (tab === "availability") return BlessERP.comercialPedidoDemandView.renderAvailability(order, appState);
    if (tab === "packing") return renderPackingTab(order, appState);
    if (tab === "invoice") return renderInvoiceTab(order, appState);
    if (tab === "client-invoice") return renderClientInvoiceTab(order, appState);
    if (tab === "route-sheet") return renderRouteSheetTab(order, appState);
    if (tab === "master-packing") return renderMasterPackingTab(order, appState);
    if (tab === "labels") return renderLabelsTab(order, appState);
    if (tab === "warehouse") return renderWarehouseTab(order, appState);
    if (tab === "dispatch") return renderDispatchTab(order, appState);
    if (tab === "future-accounting") return BlessERP.comercialAccountingPreview.renderOrderTab(order, appState);
    if (tab === "validations") return `${renderWorkflowPanel(order, appState)}${renderValidationsTab(order, appState)}`;
    if (tab === "history") return renderHistoryTab(order, appState);
    if (tab === "print") return BlessERP.comercialPrint.renderPrintCards(order, appState);
    return renderSummaryTab(order, appState);
  }

  function parseDocOptions(rawValue) {
    if (!rawValue) return {};
    try {
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function readLabelOptions(container, appState) {
    const current = BlessERP.comercialLabels.getCurrentSelection(appState);
    const printType = String(container.querySelector("[data-commercial-label-mode]")?.value || current.printType || "all");
    const fromValue = Number(container.querySelector("[data-commercial-label-field='fromBox']")?.value || current.fromBox || 1);
    const toValue = Number(container.querySelector("[data-commercial-label-field='toBox']")?.value || current.toBox || 1);
    const singleValue = Number(container.querySelector("[data-commercial-label-field='singleBox']")?.value || current.singleBox || 1);
    return {
      printType,
      fromBox: fromValue > 0 ? fromValue : 1,
      toBox: toValue > 0 ? toValue : Math.max(fromValue, 1),
      singleBox: singleValue > 0 ? singleValue : 1
    };
  }

  function readDocOptions(container, source, appState) {
    if (source === "packing-prices") {
      return {
        showPrices: Boolean(container.querySelector("[data-commercial-packing-prices-toggle]")?.checked)
      };
    }

    if (source === "client-invoice-current") {
      return BlessERP.comercialClientInvoice.getCurrentOptions(appState);
    }

    if (source === "client-invoice-referential") {
      return {
        ...BlessERP.comercialClientInvoice.getCurrentOptions(appState),
        mode: "REFERENCIAL"
      };
    }

    if (source === "client-invoice-real-demo") {
      return {
        ...BlessERP.comercialClientInvoice.getCurrentOptions(appState),
        mode: "REAL_DEMO"
      };
    }

    if (source === "labels-selection") {
      return readLabelOptions(container, appState);
    }

    if (source === "labels-all") {
      return {
        ...readLabelOptions(container, appState),
        printType: "all"
      };
    }

    if (source === "labels-range") {
      const options = readLabelOptions(container, appState);
      return {
        ...options,
        printType: "range"
      };
    }

    if (source === "labels-individual") {
      const options = readLabelOptions(container, appState);
      return {
        ...options,
        printType: "individual"
      };
    }

    return {};
  }

  function resolveDocOptions(button, container, appState) {
    return {
      ...parseDocOptions(button.dataset.commercialDocOptions),
      ...readDocOptions(container, button.dataset.commercialDocOptionsSource, appState)
    };
  }

  function openDocumentPreview(docCode, order, appState, options, autoPrint) {
    const normalizedOrder = utils.normalizeOrder(order);
    const finalOptions = docCode === "ETIQUETAS"
      ? { ...BlessERP.comercialLabels.getCurrentSelection(appState), ...options }
      : options;
    const action = autoPrint ? "print" : "preview";

    if (docCode === "ETIQUETAS") {
      const validation = BlessERP.comercialLabels.validatePrintRequest(normalizedOrder, appState, finalOptions);
      if (!validation.isValid) {
        BlessERP.layout.toast(validation.errors[0] || "No se puede imprimir etiquetas con la seleccion actual.");
        return false;
      }
    }

    const workflowReview = workflow.canExecuteDocumentAction(docCode, normalizedOrder, appState, action, finalOptions);
    if (!workflowReview.allowed) {
      const message = workflowReview.errors[0] || "El estado actual del pedido no permite esta accion documental.";
      workflow.recordEvent(order, appState, {
        action: "BLOQUEAR_DOCUMENTO",
        actionLabel: "Bloqueo documental",
        previousStatus: order.status,
        nextStatus: order.status,
        description: message,
        documentCode: docCode,
        documentLabel: data.printDocs.find(item => item.code === docCode)?.name || docCode,
        result: "bloqueado"
      });
      BlessERP.layout.toast(message);
      return false;
    }

    const opened = BlessERP.comercialPrintSystem.openPreview(
      docCode,
      [normalizedOrder],
      appState,
      {
        autoPrint,
        options: finalOptions
      }
    );

    if (opened) {
      workflow.markDocumentActivity(order, appState, docCode, action, finalOptions);
      BlessERP.state.saveDb();
    }
    return opened;
  }

  function render(appState) {
    const order = stateApi.currentOrder(appState);
    const summary = order ? workflow.buildWorkflowSummary(order, appState) : null;

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Pedido Maestro</h1>
          <p>Centro del flujo comercial demo para crear la orden, validar su cobertura, liberar cajas a Bodega y seguir el armado fisico sin reservas.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Demo integrado</span>
          <span class="status-badge ${utils.badgeClass(order?.status)}">${utils.esc(summary?.definition?.shortLabel || order?.status || "BORRADOR")}</span>
        </div>
      </section>
      <section class="hero-banner">
        <div>
          <strong>Modo comercial actual</strong>
          <span>Datos demo. No genera factura SRI, asiento contable real ni CxC real.</span>
        </div>
      </section>
      ${renderNotice(appState)}
      ${order?.revisionEditing ? `<section class="hero-banner"><div><strong>Revision ${utils.esc(order.revisionDraftNumber)} en edicion</strong><span>Motivo: ${utils.esc(order.revisionReason)}. Puede corregir datos y cajas sin lecturas; una caja con ramos leidos protege su estructura.</span></div><span class="status-badge pending">CAMBIO BORRADOR</span></section>` : ""}
      ${order?.changeNotifications?.[0] ? `<section class="hero-banner"><div><strong>Ultima actualizacion R${utils.esc(order.changeNotifications[0].revision)}</strong><span>${utils.esc(order.changeNotifications[0].message)} ${utils.esc(order.changeNotifications[0].acknowledgedAt ? `Revisada por ${order.changeNotifications[0].acknowledgedBy}.` : "Pendiente de revision en Bodega.")}</span></div><span class="status-badge ${order.changeNotifications[0].acknowledgedAt ? "authorized" : "pending"}">${utils.esc(order.changeNotifications[0].status)}</span></section>` : ""}
      ${order && BlessERP.comercialPedidoMasterWorkspace?.render
        ? BlessERP.comercialPedidoMasterWorkspace.render(order, appState)
        : `<section class="panel-card"><p class="panel-note">No hay pedido activo o la pantalla maestra no esta disponible.</p></section>`}
    `;
  }

  function bind(container, appState) {
    const awbInput = container.querySelector("[data-commercial-awb-input]");
    const refreshAwbRecognition = value => {
      const digits = utils.getAwbDigits(value);
      const airline = utils.findAirlineByAwb(value, appState);
      const airlineOutput = container.querySelector("[data-commercial-awb-airline]");
      const statusOutput = container.querySelector("[data-commercial-awb-status]");

      if (airlineOutput) {
        airlineOutput.value = airline
          ? `${airline.name} · prefijo ${airline.awbPrefix}`
          : "Prefijo AWB no reconocido";
      }
      if (statusOutput) {
        statusOutput.textContent = airline
          ? `${airline.name} reconocida por el prefijo ${airline.awbPrefix}.`
          : digits.length >= 3
            ? `No existe una linea aerea activa con el prefijo ${digits.slice(0, 3)}.`
            : "Ingrese los 3 primeros digitos para reconocer la linea aerea.";
        statusOutput.classList.toggle("is-valid", Boolean(airline));
        statusOutput.classList.toggle("is-warning", !airline && digits.length >= 3);
      }
    };

    awbInput?.addEventListener("input", event => refreshAwbRecognition(event.target.value));

    container.querySelector("[data-commercial-master-select-order]")?.addEventListener("change", event => {
      if (!stateApi.setCurrentOrder(appState, event.target.value)) return;
      stateApi.setOrderTab(appState, "summary");
      BlessERP.layout.renderPage();
    });

    container.querySelectorAll("[data-commercial-tab]").forEach(button => button.addEventListener("click", () => {
      stateApi.setOrderTab(appState, button.dataset.commercialTab);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-open-tab-direct]").forEach(button => button.addEventListener("click", () => {
      stateApi.setOrderTab(appState, button.dataset.commercialOpenTabDirect);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-release-warehouse]").forEach(button => button.addEventListener("click", () => {
      const result = stateApi.markReadyWarehouse(appState);
      if (result?.ok === false) BlessERP.layout.toast(result.validation?.errors?.join(" | ") || result.error || result.message || "No se pudo liberar el pedido.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-start-revision]").forEach(button => button.addEventListener("click", () => {
      const reason = window.prompt("Motivo de la modificacion solicitada por el cliente:", "Cliente solicito una caja adicional.") || "";
      if (!String(reason).trim()) return;
      const result = stateApi.startOrderRevision(appState, reason);
      if (!result?.ok) BlessERP.layout.toast(result?.error || "No se pudo iniciar la revision.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-submit-revision]").forEach(button => button.addEventListener("click", () => {
      const result = stateApi.submitOrderRevision(appState);
      BlessERP.layout.toast(result?.ok ? result.notification.message : result?.error || "No se pudo enviar la revision.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-cancel-revision]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("Cancelar la revision y retirar las cajas nuevas aun no enviadas?")) return;
      const result = stateApi.cancelOrderRevision(appState);
      if (!result?.ok) BlessERP.layout.toast(result?.error || "No se pudo cancelar la revision.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-open-warehouse]").forEach(button => button.addEventListener("click", () => {
      const order = stateApi.currentOrder(appState);
      if (order) BlessERP.operacionesState?.setUiValue?.(appState, "warehouseOrderId", order.id);
      BlessERP.state.setRoute("operations-warehouse");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-status-target]").forEach(button => button.addEventListener("click", () => {
      const target = button.dataset.commercialStatusTarget;
      const order = stateApi.currentOrder(appState);
      const dispatchService = utils.getDispatchService?.();
      let reason = "";

      if (button.dataset.commercialStatusReason === "required") {
        reason = window.prompt(
          target === "ANULADO"
            ? "Motivo de anulacion del pedido:"
            : "Motivo de reapertura del pedido:",
          ""
        ) || "";
        if (!String(reason).trim()) return;
      }

      if (["DESPACHADO_DEMO", "CERRADO_DEMO"].includes(target)) {
        const confirmed = window.confirm(
          target === "DESPACHADO_DEMO"
            ? "Confirme que el pedido pasa a DESPACHADO_DEMO."
            : "Confirme que el pedido pasa a CERRADO_DEMO."
        );
        if (!confirmed) return;
      }

      if (order && target === "LISTO_BODEGA") {
        const result = stateApi.markReadyWarehouse(appState);
        if (!result?.ok) BlessERP.layout.toast(result?.validation?.errors?.join(" | ") || result?.error || result?.message || "No se pudo liberar el pedido a Bodega.");
        BlessERP.layout.renderPage();
        return;
      }

      if (order && dispatchService && target === "LISTO_DESPACHO") {
        const result = dispatchService.markDispatchReadyDemo(appState, order.id);
        if (!result?.ok) BlessERP.layout.toast(result?.error || result?.message || "No se pudo marcar listo despacho.");
        BlessERP.layout.renderPage();
        return;
      }

      if (order && dispatchService && target === "DESPACHADO_DEMO") {
        const responsable = window.prompt("Responsable demo del despacho:", "") || "";
        if (!String(responsable).trim()) return;
        const observacion = window.prompt("Observacion del despacho demo:", "Despacho demo confirmado.") || "";
        const result = dispatchService.confirmDispatchDemo(appState, order.id, {
          responsable_demo: responsable,
          observacion
        });
        if (!result?.ok) BlessERP.layout.toast(result?.error || result?.message || "No se pudo confirmar el despacho demo.");
        BlessERP.layout.renderPage();
        return;
      }

      const result = stateApi.changeOrderStatus(appState, target, reason);
      if (result?.ok && order && dispatchService && target === "ANULADO") {
        dispatchService.cancelDispatchDemo(appState, order.id, reason);
      }
      if (result?.ok && order && dispatchService && target === "REABIERTO_DEMO") {
        dispatchService.reopenDispatchDemo(appState, order.id, reason);
      }
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-dispatch-action]").forEach(button => button.addEventListener("click", () => {
      const order = stateApi.currentOrder(appState);
      const dispatchService = utils.getDispatchService?.();
      if (!order || !dispatchService) {
        BlessERP.layout.toast("Servicio demo de despacho no disponible.");
        return;
      }

      let result = null;
      if (button.dataset.commercialDispatchAction === "prepare") {
        result = dispatchService.prepareDispatchFromOrderDemo(appState, order.id);
      } else if (button.dataset.commercialDispatchAction === "ready") {
        result = dispatchService.markDispatchReadyDemo(appState, order.id);
      } else if (button.dataset.commercialDispatchAction === "confirm") {
        const responsable = window.prompt("Responsable demo del despacho:", "") || "";
        if (!String(responsable).trim()) return;
        const observacion = window.prompt("Observacion del despacho demo:", "Despacho demo confirmado.") || "";
        result = dispatchService.confirmDispatchDemo(appState, order.id, {
          responsable_demo: responsable,
          observacion
        });
      } else if (button.dataset.commercialDispatchAction === "observe") {
        const motivo = window.prompt("Motivo de observacion del despacho:", "") || "";
        if (!String(motivo).trim()) return;
        result = dispatchService.observeDispatchDemo(appState, order.id, motivo);
      } else if (button.dataset.commercialDispatchAction === "reopen") {
        const motivo = window.prompt("Motivo de reapertura del despacho:", "Reabierto desde Pedido Maestro demo.") || "";
        if (!String(motivo).trim()) return;
        result = dispatchService.reopenDispatchDemo(appState, order.id, motivo);
      } else if (button.dataset.commercialDispatchAction === "simulate-consumption") {
        result = BlessERP.operacionesConsumptionDemo?.simulateConsumptionFromDispatchDemo
          ? BlessERP.operacionesConsumptionDemo.simulateConsumptionFromDispatchDemo(appState, order.id)
          : { ok: false, error: "Servicio demo de consumo no disponible." };
      }

      if (result && result.ok === false) {
        const details = result.validation?.errors?.length
          ? ` ${result.validation.errors.join(" | ")}`
          : "";
        BlessERP.layout.toast(`${result.error || result.message || "No se pudo completar la accion de despacho."}${details}`);
      } else if (button.dataset.commercialDispatchAction === "simulate-consumption" && result?.ok) {
        BlessERP.layout.toast(`Consumo demo simulado: ${result.consumptions?.length || 0} linea(s).`);
      } else if (result?.sync && !result.sync.sincronizado) {
        BlessERP.layout.toast(result.sync.observacion || "Despacho actualizado; estado comercial queda como sincronizacion visual demo.");
      }
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-dispatch-open-operations]").forEach(button => button.addEventListener("click", () => {
      BlessERP.operacionesState?.setUiValue?.(appState, "selectedDispatchOrderId", button.dataset.orderId || stateApi.currentOrder(appState)?.id || "");
      BlessERP.state.setRoute("operations-dispatch");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-dispatch-open-scanner]").forEach(button => button.addEventListener("click", () => {
      BlessERP.operacionesState?.setUiValue?.(appState, "scannerDispatchPedidoId", button.dataset.orderId || stateApi.currentOrder(appState)?.id || "");
      BlessERP.state.setRoute("operations-scanner");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-order-field]").forEach(field => {
      field.addEventListener("change", event => {
        stateApi.updateOrderField(appState, event.target.dataset.commercialOrderField, event.target.value);
        BlessERP.layout.renderPage();
      });
    });

    container.querySelectorAll("[data-commercial-line-field]").forEach(field => {
      field.addEventListener("change", event => {
        const [lineId, key] = String(event.target.dataset.commercialLineField || "").split("|");
        stateApi.updateLineField(appState, lineId, key, event.target.value);
        BlessERP.layout.renderPage();
      });
    });

    container.querySelectorAll("[data-commercial-add-line]").forEach(button => button.addEventListener("click", () => {
      stateApi.addLine(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-builder-single]").forEach(button => button.addEventListener("click", () => {
      stateApi.setBoxBuilderMode(appState, BlessERP.comercialBoxBuilder.MODES.RANGE);
      stateApi.updateBoxRangeDraft(appState, "quantity", 1);
      BlessERP.layout.renderPage();
      requestAnimationFrame(() => document.querySelector("#master-order-box-builder")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }));

    container.querySelector("[data-commercial-jump-box-builder]")?.addEventListener("click", () => {
      container.querySelector("#master-order-box-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    container.querySelectorAll("[data-commercial-builder-mode]").forEach(button => button.addEventListener("click", () => {
      if (!stateApi.setBoxBuilderMode(appState, button.dataset.commercialBuilderMode)) return;
      BlessERP.layout.renderPage();
      requestAnimationFrame(() => document.querySelector("#master-order-box-builder")?.scrollIntoView({ block: "start" }));
    }));

    container.querySelectorAll("[data-commercial-range-field]").forEach(field => {
      field.addEventListener("change", event => {
        stateApi.updateBoxRangeDraft(appState, event.target.dataset.commercialRangeField, event.target.value);
        BlessERP.layout.renderPage();
        requestAnimationFrame(() => document.querySelector("#master-order-box-builder")?.scrollIntoView({ block: "start" }));
      });
    });

    container.querySelectorAll("[data-commercial-mix-item-field]").forEach(field => {
      field.addEventListener("change", event => {
        const [itemId, key] = String(event.target.dataset.commercialMixItemField || "").split("|");
        stateApi.updateManualMixDraftItem(appState, itemId, key, event.target.value);
        BlessERP.layout.renderPage();
        requestAnimationFrame(() => document.querySelector("#master-order-box-builder")?.scrollIntoView({ block: "start" }));
      });
    });

    container.querySelector("[data-commercial-add-mix-item]")?.addEventListener("click", () => {
      stateApi.addManualMixDraftItem(appState);
      BlessERP.layout.renderPage();
      requestAnimationFrame(() => document.querySelector("#master-order-box-builder")?.scrollIntoView({ block: "start" }));
    });

    container.querySelectorAll("[data-commercial-remove-mix-item]").forEach(button => button.addEventListener("click", () => {
      if (!stateApi.removeManualMixDraftItem(appState, button.dataset.commercialRemoveMixItem)) return;
      BlessERP.layout.renderPage();
      requestAnimationFrame(() => document.querySelector("#master-order-box-builder")?.scrollIntoView({ block: "start" }));
    }));

    container.querySelector("[data-commercial-add-box-range]")?.addEventListener("click", () => {
      const result = stateApi.addBoxRange(appState);
      if (!result?.ok) BlessERP.layout.toast(result?.error || "No se pudo generar el rango de cajas.");
      BlessERP.layout.renderPage();
    });

    container.querySelectorAll("[data-commercial-add-item-box]").forEach(button => button.addEventListener("click", () => {
      const result = stateApi.addItemToBox(appState, button.dataset.commercialAddItemBox);
      if (!result?.ok) BlessERP.layout.toast(result?.error || "No se pudo agregar el item a la caja.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-duplicate-box]").forEach(button => button.addEventListener("click", () => {
      const result = stateApi.duplicateBox(appState, button.dataset.commercialDuplicateBox);
      if (!result?.ok) BlessERP.layout.toast(result?.error || "No se pudo duplicar la caja.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-delete-box]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm(`Eliminar la caja ${button.dataset.commercialDeleteBox} completa?`)) return;
      const result = stateApi.deleteBox(appState, button.dataset.commercialDeleteBox);
      if (!result?.ok) BlessERP.layout.toast(result?.error || "No se pudo eliminar la caja.");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-duplicate-line]").forEach(button => button.addEventListener("click", () => {
      stateApi.duplicateLine(appState, button.dataset.commercialDuplicateLine);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-delete-line]").forEach(button => button.addEventListener("click", () => {
      stateApi.deleteLine(appState, button.dataset.commercialDeleteLine);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-availability-filter]").forEach(field => field.addEventListener("change", event => {
      stateApi.setAvailabilityFilter(appState, event.target.dataset.commercialAvailabilityFilter, event.target.value);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-reserve-qty]").forEach(field => field.addEventListener("change", event => {
      stateApi.setAvailabilityReserveQty(appState, event.target.dataset.commercialReserveQty, event.target.value);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-reserve-availability]").forEach(button => button.addEventListener("click", () => {
      stateApi.reserveAvailability(appState, button.dataset.commercialReserveAvailability);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-release-reservation]").forEach(button => button.addEventListener("click", () => {
      stateApi.releaseReservation(appState, button.dataset.commercialReleaseReservation);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-confirm-reservation]").forEach(button => button.addEventListener("click", () => {
      stateApi.confirmReservation(appState, button.dataset.commercialConfirmReservation);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-create-line-from-reservation]").forEach(button => button.addEventListener("click", () => {
      stateApi.createLineFromReservation(appState, button.dataset.commercialCreateLineFromReservation);
      stateApi.setOrderTab(appState, "lines");
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-reservation-line-field]").forEach(field => field.addEventListener("change", event => {
      const [reservationId, key] = String(event.target.dataset.commercialReservationLineField || "").split("|");
      stateApi.setReservationLineDraft(appState, reservationId, key, event.target.value);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-open-availability-origin]").forEach(button => button.addEventListener("click", () => {
      BlessERP.operacionesState?.setUiValue?.(appState, "selectedAvailabilityId", button.dataset.commercialOpenAvailabilityOrigin);
      BlessERP.state.setRoute("operations-availability");
      BlessERP.layout.renderApp();
    }));

    container.querySelectorAll("[data-commercial-packaging-recalculate]").forEach(button => button.addEventListener("click", () => {
      stateApi.recalculatePackaging(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-packaging-view]").forEach(button => button.addEventListener("click", () => {
      stateApi.setPackagingViewMode(appState, button.dataset.commercialPackagingView);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-packaging-prepared]").forEach(button => button.addEventListener("click", () => {
      stateApi.markPackagingPrepared(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-packaging-consumed]").forEach(button => button.addEventListener("click", () => {
      stateApi.markPackagingConsumed(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-packaging-placeholder]").forEach(button => button.addEventListener("click", () => {
      BlessERP.layout.toast(
        button.dataset.commercialPackagingPlaceholder === "restock"
          ? "Pendiente fase futura. Solicitud de reposicion pendiente; esta fase solo deja el flujo visual demo."
          : "Pendiente fase futura. Accion visual reservada para una fase posterior."
      );
    }));

    container.querySelector("[data-commercial-client-invoice-view]")?.addEventListener("change", event => {
      stateApi.setClientInvoiceViewMode(appState, event.target.value);
      BlessERP.layout.renderPage();
    });

    container.querySelectorAll("[data-commercial-client-invoice-toggle]").forEach(field => field.addEventListener("change", event => {
      stateApi.setClientInvoiceToggle(appState, event.target.dataset.commercialClientInvoiceToggle, event.target.checked);
      BlessERP.layout.renderPage();
    }));

    container.querySelector("[data-commercial-label-mode]")?.addEventListener("change", event => {
      stateApi.setLabelPrintMode(appState, event.target.value);
      BlessERP.layout.renderPage();
    });

    container.querySelectorAll("[data-commercial-label-field]").forEach(field => field.addEventListener("change", event => {
      stateApi.setLabelPrintField(appState, event.target.dataset.commercialLabelField, event.target.value);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-preview-doc]").forEach(button => button.addEventListener("click", () => {
      const order = stateApi.currentOrder(appState);
      if (!order) return;
      openDocumentPreview(
        button.dataset.commercialPreviewDoc,
        order,
        appState,
        resolveDocOptions(button, container, appState),
        false
      );
    }));

    container.querySelectorAll("[data-commercial-print-doc]").forEach(button => button.addEventListener("click", () => {
      const order = stateApi.currentOrder(appState);
      if (!order) return;
      openDocumentPreview(
        button.dataset.commercialPrintDoc,
        order,
        appState,
        resolveDocOptions(button, container, appState),
        true
      );
    }));

    container.querySelectorAll("[data-commercial-doc-placeholder]").forEach(button => button.addEventListener("click", () => {
      const [action, docCode] = String(button.dataset.commercialDocPlaceholder || "").split("|");
      BlessERP.layout.toast(
        action === "pdf"
          ? `Pendiente fase futura. PDF real pendiente para ${docCode || "documento"}; esta fase solo deja preview e impresion demo.`
          : action === "zebra"
            ? `Pendiente fase futura. Zebra real pendiente para ${docCode || "documento"}; esta fase deja solo etiquetas demo, impresion por rango y reimpresion individual.`
            : `Pendiente fase futura. Envio por correo pendiente para ${docCode || "documento"}; esta fase no genera despacho real.`
      );
    }));

    container.querySelectorAll("[data-commercial-new-order]").forEach(button => button.addEventListener("click", () => {
      stateApi.createNewOrder(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-save-order]").forEach(button => button.addEventListener("click", () => {
      stateApi.saveCurrentOrder(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-mark-referential]").forEach(button => button.addEventListener("click", () => {
      stateApi.markReferential(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-validate-order]").forEach(button => button.addEventListener("click", () => {
      stateApi.validateCurrentOrder(appState);
      BlessERP.layout.renderPage();
    }));

    container.querySelectorAll("[data-commercial-annul-order]").forEach(button => button.addEventListener("click", () => {
      stateApi.annulCurrentOrder(appState);
      BlessERP.layout.renderPage();
    }));

    BlessERP.comercialAccountingPreview?.bind?.(container, appState);
  }

  BlessERP.comercialPedido = {
    bind,
    render,
    renderAvailabilityBoard(order, appState, standalone) {
      return BlessERP.comercialPedidoDemandView.renderAvailability(order, appState, { standalone });
    }
  };
})();
