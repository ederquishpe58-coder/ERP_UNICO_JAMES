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

  function renderLengthOptions(lengths, selectedLength, anyLength, utils) {
    const anyValue = BlessERP.comercialBoxBuilder.ANY_LENGTH;
    return `<option value="${anyValue}" ${anyLength ? "selected" : ""}>CUALQUIER MEDIDA</option>${lengths.map(length => `<option value="${utils.esc(length)}" ${!anyLength && Number(length) === Number(selectedLength) ? "selected" : ""}>${utils.esc(length)} cm</option>`).join("")}`;
  }

  function statusBadge(utils, value, fallback = "PENDIENTE") {
    const status = normalize(value) || fallback;
    return `<span class="status-badge ${utils.badgeClass(status)}">${utils.esc(status)}</span>`;
  }

  function disabled(flag) {
    return flag ? "disabled" : "";
  }

  function fieldLocked(order, field, workflow) {
    if (workflow.isSriAuthorized?.(order)) return true;
    if (order.revisionEditing) return !workflow.canEditOrderField(order, field).ok;
    if (RELEASED_STATES.has(normalize(order.warehouseStatus))) return true;
    return !workflow.canEditOrderField(order, field).ok;
  }

  function renderBoxBuilder(order, draft, nextBox, boxTypes, varieties, lengths, linesEditable, utils) {
    const modes = BlessERP.comercialBoxBuilder.MODES;
    const modeLabels = {
      [modes.RANGE]: "Rango igual",
      [modes.MANUAL_MIX]: "Mixto manual",
      [modes.OPEN_MIX]: "Mixto abierto"
    };
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
        <div class="compact-table-wrap master-mix-items"><table class="compact-table"><thead><tr><th>Item</th><th>Variedad</th><th>Medida</th><th>Ramos</th><th>Tallos/ramo</th><th>Precio/tallo</th><th>Accion</th></tr></thead><tbody>
          ${draft.manualItems.map((item, index) => `<tr>
            <td><strong>${index + 1}</strong></td>
            <td><select data-commercial-mix-item-field="${utils.esc(item.id)}|variety" ${disabled(!linesEditable)}>${varieties.map(variety => `<option value="${utils.esc(variety)}" ${variety === item.variety ? "selected" : ""}>${utils.esc(variety)}</option>`).join("")}</select></td>
            <td><select data-commercial-mix-item-field="${utils.esc(item.id)}|lengthSelection" ${disabled(!linesEditable)}>${renderLengthOptions(lengths, item.length, item.anyLength, utils)}</select></td>
            <td><input type="number" min="1" step="1" value="${utils.esc(item.bunches)}" data-commercial-mix-item-field="${utils.esc(item.id)}|bunches" ${disabled(!linesEditable)}></td>
            <td><input type="number" min="1" step="1" value="${utils.esc(item.stemsPerBunch)}" data-commercial-mix-item-field="${utils.esc(item.id)}|stemsPerBunch" ${disabled(!linesEditable)}></td>
            <td><input type="number" min="0.001" step="0.001" value="${utils.esc(item.unitPrice)}" data-commercial-mix-item-field="${utils.esc(item.id)}|unitPrice" ${disabled(!linesEditable)}></td>
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
        <p class="master-range-help">Cuarto frío puede escanear cualquier variedad permitida. La medida se valida exactamente o queda abierta segun la opcion elegida; la composicion real vuelve a Ventas con cada lectura.</p>
      `;
    }

    return `
      <section class="master-order-box-builder" id="master-order-box-builder">
        <div class="master-builder-toolbar">
          <div><strong>Crear cajas</strong><small>Seleccione una forma de armar el pedido.</small></div>
          <div class="table-actions-inline master-builder-modes">
            ${Object.entries(modeLabels).map(([mode, label]) => `<button class="${draft.mode === mode ? "primary-button" : "secondary-button"}" data-commercial-builder-mode="${utils.esc(mode)}" ${disabled(!linesEditable)}>${utils.esc(label)}</button>`).join("")}
            <button class="secondary-button master-builder-close" data-commercial-close-box-builder>Cerrar</button>
          </div>
        </div>
        <div class="master-builder-body ${draft.mode === modes.MANUAL_MIX ? "is-manual-mode" : "is-compact-mode"}">
          <div class="master-builder-title"><strong>${utils.esc(modeLabels[draft.mode])}</strong><span class="status-badge partial">Caja ${utils.esc(draft.firstBox || nextBox)} en adelante</span></div>
          ${modeContent}
          <div class="master-builder-submit"><button class="primary-button" data-commercial-add-box-range ${disabled(!linesEditable)}>Generar ${utils.esc(modeLabels[draft.mode].toLowerCase())}</button></div>
        </div>
      </section>
    `;
  }

  function renderQuickCatalogEditors(order, appState, utils, stateApi) {
    const editorKind = String(stateApi.getUi(appState).quickCatalogEditorKind || "");
    if (!editorKind) return "";
    const data = BlessERP.comercialData;
    const customers = stateApi.getCustomerCatalog(appState);
    const brands = stateApi.getBrandCatalog(appState);
    const countries = stateApi.getCountryCatalog(appState).filter(item => normalize(item.status || "ACTIVO") !== "INACTIVO");
    const destinations = stateApi.getDestinationCatalog(appState).filter(item => normalize(item.status || "ACTIVO") !== "INACTIVO");
    const agencies = stateApi.getAgencyCatalog(appState).filter(item => normalize(item.status || "ACTIVA") !== "INACTIVA");
    const customer = customers.find(item => item.id === order.customerId) || data.createCustomer({ country: "ECUADOR" });
    const brand = brands.find(item => item.id === order.brandId) || data.createBrand({ customerId: order.customerId });

    return `
      <div class="commercial-quick-editor-modal" data-commercial-quick-editor-modal="customer" hidden>
        <section class="panel-card commercial-quick-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-customer-editor-title" tabindex="-1">
          <div class="panel-card-head commercial-quick-editor-head">
            <div><p class="section-kicker">CLIENTE PRINCIPAL</p><h2 id="quick-customer-editor-title">Crear o editar cliente</h2><p class="panel-note">Los cambios actualizan el catalogo comercial y el selector del pedido.</p></div>
            <button class="commercial-order-control-close" type="button" data-commercial-close-quick-editor aria-label="Cerrar editor de cliente">×</button>
          </div>
          <div class="commercial-quick-editor-grid">
            <label class="compact-field"><span>Codigo</span><input value="${utils.esc(customer.code)}" data-commercial-quick-customer-field="code" readonly></label>
            <label class="compact-field"><span>Categoria</span><select data-commercial-quick-customer-field="category">${["EXPORTACION", "LOCAL", "MIXTO"].map(item => `<option ${item === customer.category ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label class="compact-field commercial-quick-span-2"><span>Apellidos y nombres / Razon social</span><input value="${utils.esc(customer.legalName)}" data-commercial-quick-customer-field="legalName"></label>
            <label class="compact-field"><span>Nombre comercial</span><input value="${utils.esc(customer.commercialName)}" data-commercial-quick-customer-field="commercialName"></label>
            <label class="compact-field"><span>Estado</span><select data-commercial-quick-customer-field="status"><option ${customer.status === "ACTIVO" ? "selected" : ""}>ACTIVO</option><option ${customer.status === "INACTIVO" ? "selected" : ""}>INACTIVO</option></select></label>
            <label class="compact-field"><span>Tipo identificacion</span><select data-commercial-quick-customer-field="identificationType">${["RUC", "CEDULA", "PASAPORTE", "TAX ID"].map(item => `<option ${item === customer.identificationType ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label class="compact-field"><span>Identificacion</span><input value="${utils.esc(customer.identification)}" placeholder="Automatico: CE0001" data-commercial-quick-customer-field="identification"><small>Si queda vacio se asigna automaticamente.</small></label>
            <label class="compact-field"><span>Pais</span><select data-commercial-quick-customer-field="country">${countries.map(item => `<option value="${utils.esc(item.name)}" ${normalize(item.name) === normalize(customer.country) ? "selected" : ""}>${utils.esc(item.name)}</option>`).join("")}</select></label>
            <label class="compact-field"><span>Ciudad</span><input value="${utils.esc(customer.city)}" data-commercial-quick-customer-field="city"></label>
            <label class="compact-field commercial-quick-span-2"><span>Direccion</span><textarea rows="2" data-commercial-quick-customer-field="address">${utils.esc(customer.address)}</textarea></label>
            <label class="compact-field"><span>Contacto</span><input value="${utils.esc(customer.contact)}" data-commercial-quick-customer-field="contact"></label>
            <label class="compact-field"><span>Telefono movil</span><input value="${utils.esc(customer.mobilePhone)}" data-commercial-quick-customer-field="mobilePhone"></label>
            <label class="compact-field"><span>Correo contacto</span><input type="email" value="${utils.esc(customer.contactEmail)}" data-commercial-quick-customer-field="contactEmail"></label>
            <label class="compact-field"><span>Correo facturacion</span><input type="email" value="${utils.esc(customer.billingEmail)}" data-commercial-quick-customer-field="billingEmail"></label>
          </div>
          <div class="commercial-quick-editor-actions">
            <button class="secondary-button" type="button" data-commercial-new-quick-customer>Nuevo cliente</button>
            <button class="primary-button" type="button" data-commercial-save-quick-customer>Guardar cliente</button>
          </div>
        </section>
      </div>
      <div class="commercial-quick-editor-modal" data-commercial-quick-editor-modal="brand" hidden>
        <section class="panel-card commercial-quick-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-brand-editor-title" tabindex="-1">
          <div class="panel-card-head commercial-quick-editor-head">
            <div><p class="section-kicker">MARCA / CLIENTE FINAL</p><h2 id="quick-brand-editor-title">Crear o editar marca</h2><p class="panel-note">La marca queda vinculada al cliente principal y parametriza destino, agencia y cuarto frio.</p></div>
            <button class="commercial-order-control-close" type="button" data-commercial-close-quick-editor aria-label="Cerrar editor de marca">×</button>
          </div>
          <div class="commercial-quick-editor-grid">
            <label class="compact-field"><span>Codigo</span><input value="${utils.esc(brand.code)}" data-commercial-quick-brand-field="code" readonly></label>
            <label class="compact-field"><span>Cliente principal</span><select data-commercial-quick-brand-field="customerId"><option value="">Seleccione cliente</option>${customers.filter(item => normalize(item.status || "ACTIVO") !== "INACTIVO").map(item => `<option value="${utils.esc(item.id)}" ${item.id === brand.customerId ? "selected" : ""}>${utils.esc(item.commercialName)}</option>`).join("")}</select></label>
            <label class="compact-field commercial-quick-span-2"><span>Apellidos y nombres / Razon social</span><input value="${utils.esc(brand.finalClientName)}" data-commercial-quick-brand-field="finalClientName"></label>
            <label class="compact-field"><span>Destino</span><select data-commercial-quick-brand-field="destination"><option value="">Seleccione destino</option>${destinations.map(item => `<option value="${utils.esc(item.destination)}" ${normalize(item.destination) === normalize(brand.destination) ? "selected" : ""}>${utils.esc(item.destination)}</option>`).join("")}</select></label>
            <label class="compact-field"><span>Pais automatico</span><input value="${utils.esc(brand.country)}" data-commercial-quick-brand-field="country" readonly></label>
            <label class="compact-field"><span>Agencia automatica</span><select data-commercial-quick-brand-field="defaultAgencyId"><option value="">Sin agencia</option>${agencies.map(item => `<option value="${utils.esc(item.id)}" ${item.id === brand.defaultAgencyId ? "selected" : ""}>${utils.esc(item.name)}</option>`).join("")}</select></label>
            <label class="compact-field"><span>Cuarto frio base</span><input value="${utils.esc(brand.agencyColdRoom)}" data-commercial-quick-brand-field="agencyColdRoom"></label>
            <label class="compact-field commercial-quick-span-2"><span>Direccion</span><textarea rows="2" data-commercial-quick-brand-field="address">${utils.esc(brand.address)}</textarea></label>
            <label class="compact-field"><span>Ciudad</span><input value="${utils.esc(brand.city)}" data-commercial-quick-brand-field="city"></label>
            <label class="compact-field"><span>Contacto</span><input value="${utils.esc(brand.contact)}" data-commercial-quick-brand-field="contact"></label>
            <label class="compact-field"><span>Telefono</span><input value="${utils.esc(brand.phone)}" data-commercial-quick-brand-field="phone"></label>
            <label class="compact-field"><span>Correo</span><input type="email" value="${utils.esc(brand.email)}" data-commercial-quick-brand-field="email"></label>
            <label class="compact-field"><span>Requiere PO</span><select data-commercial-quick-brand-field="requiresPo"><option value="false" ${!brand.requiresPo ? "selected" : ""}>No</option><option value="true" ${brand.requiresPo ? "selected" : ""}>Si</option></select></label>
            <label class="compact-field"><span>Estado</span><select data-commercial-quick-brand-field="status"><option ${brand.status === "ACTIVO" ? "selected" : ""}>ACTIVO</option><option ${brand.status === "INACTIVO" ? "selected" : ""}>INACTIVO</option></select></label>
          </div>
          <div class="commercial-quick-editor-actions">
            <button class="secondary-button" type="button" data-commercial-new-quick-brand>Nueva marca</button>
            <button class="primary-button" type="button" data-commercial-save-quick-brand>Guardar marca</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderHeaderData(order, appState, utils, stateApi, workflow) {
    const customers = stateApi.getCustomerCatalog(appState).filter(item => normalize(item.status) !== "INACTIVO");
    const selectedCustomer = customers.find(item => item.id === order.customerId);
    const brands = stateApi.getBrandCatalog(appState).filter(item => item.customerId === order.customerId && normalize(item.status || "ACTIVO") !== "INACTIVO");
    const salespeople = stateApi.listSalespeople(appState);
    const agencies = stateApi.getAgencyCatalog(appState).filter(item => normalize(item.status || "ACTIVA") !== "INACTIVA");
    const airlines = stateApi.getAirlineCatalog(appState).filter(item => normalize(item.status || "ACTIVA") !== "INACTIVA");
    const daes = utils.getAvailableDaesForOrder(order);
    if (order.daeNumber && !daes.some(item => item.number === order.daeNumber)) {
      daes.unshift({
        number: order.daeNumber,
        expirationDate: order.daeExpirationDate || "",
        destination: order.daeDestination || order.destination || ""
      });
    }
    const transport = normalize(order.transportType) || "AEREO";
    const localSale = utils.isLocalOrder?.(order) || transport === "TERRESTRE";
    const supportsDae = transport === "AEREO";
    const revisionLabel = order.revisionEditing ? `REVISION R${order.revisionDraftNumber}` : order.status || "BORRADOR";
    const released = RELEASED_STATES.has(normalize(order.warehouseStatus));
    const sriAuthorized = workflow.isSriAuthorized?.(order) || false;
    const orderEditable = !workflow.getEditPolicy(order).editBlocked;
    const imperioCompanyId = BlessERP.companyCapabilities?.COMPANY_IDS?.IMPERIO || "COMP-IMPERIO-FLOWERS";
    const isImperioOrder = String(order.sellingCompanyId || order.companyId || "") === imperioCompanyId;
    const supplyMode = normalize(order.inventorySupplyMode || order.inventory_supply_mode || (isImperioOrder ? "EXTERNAL_FARM" : "BLESS_INVENTORY"));
    const externalSupply = supplyMode === "EXTERNAL_FARM";
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
      <section class="panel-card master-order-entry-card ${order.revisionEditing ? "is-data-editing" : ""}">
        <div class="panel-card-head">
          <div><p class="section-kicker">DATOS DEL COMPRADOR</p><h3>Cliente, marca y logistica</h3><p class="panel-note">Seleccione o escriba para buscar. Use + para crear o editar el cliente y la marca sin salir del pedido.</p></div>
          <div class="master-order-entry-actions">
            ${statusBadge(utils, revisionLabel)}
            ${!released && !sriAuthorized && !order.revisionEditing && !externalSupply ? `<button class="primary-button" type="button" data-commercial-release-warehouse>Enviar a Cuarto frío</button>` : ""}
            ${!released && !sriAuthorized && !order.revisionEditing ? `<button class="primary-button" type="button" data-commercial-save-order>Guardar pedido</button>` : ""}
            ${released && orderEditable && !sriAuthorized && !order.revisionEditing ? `<button class="primary-button" type="button" data-commercial-start-revision>Editar pedido</button>` : ""}
            ${order.revisionEditing ? `<button class="primary-button" type="button" data-commercial-submit-revision>Actualizar pedido</button><button class="secondary-button" type="button" data-commercial-cancel-revision>Cancelar</button>` : ""}
            <button class="secondary-button" type="button" data-commercial-new-order>Nuevo</button>
          </div>
        </div>
        ${sriAuthorized ? `<div class="inline-feedback danger"><strong>Factura AUTORIZADA por el SRI</strong> · El pedido queda solo para consulta. Para corregirlo debe anular el comprobante conforme al proceso tributario y generar uno nuevo.</div>` : ""}
        ${externalSupply ? `<div class="inline-feedback info"><strong>${utils.esc(order.sellingCompanyName || (isImperioOrder ? "Imperio Flowers" : "Bless Flower"))} · compra externa</strong> · Este pedido se factura sin reservar, descontar ni enviar inventario a Cuarto frío.</div>` : ""}
        ${order.revisionEditing ? `<div class="inline-feedback warning"><strong>Edicion del pedido activa</strong> · Puede corregir cliente, marca, logistica, cajas, cantidades y precios. Pulse Actualizar pedido para que Cuarto frío reciba la revision.</div>` : ""}
        <div class="master-order-number-strip">
          <div><span>Numero</span><strong>${utils.esc(order.number || "Se asigna al guardar")}</strong></div>
          <div><span>Factura</span><strong>${utils.esc(order.sriInvoiceNumber || order.sriSequential || "Se asigna al guardar")}</strong></div>
        </div>
        <div class="master-order-buyer-layout">
          <section class="master-order-form-section">
            <h4>Comprador</h4>
            <div class="master-order-field-with-action">
              <div class="compact-field master-order-customer-search-field">
                <span>Cliente principal</span>
                <div class="master-order-customer-combobox" data-commercial-customer-combobox>
                  <input type="search" value="${utils.esc(selectedCustomer?.legalName || "")}" placeholder="Escriba la razon social" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" data-commercial-customer-search ${disabled(fieldLocked(order, "customerId", workflow))}>
                  <div class="master-order-customer-results" role="listbox" data-commercial-customer-results hidden>
                    <div class="master-order-customer-empty" data-commercial-customer-empty>Escriba para buscar; se mostraran hasta 50 coincidencias.</div>
                  </div>
                </div>
              </div>
              <button type="button" class="master-order-plus-button" data-commercial-open-quick-editor="customer" aria-label="Crear o editar cliente principal">+</button>
            </div>
            <div class="master-order-field-with-action">
              <label class="compact-field"><span>Marca / cliente final</span><select data-commercial-order-field="brandId" data-commercial-export-only ${localSale ? "hidden" : ""} ${disabled(localSale || fieldLocked(order, "brandId", workflow) || !order.customerId)}><option value="">Seleccione o escriba para buscar</option>${brands.map(item => `<option value="${utils.esc(item.id)}" ${item.id === order.brandId ? "selected" : ""}>${utils.esc(item.finalClientName)} · ${utils.esc(item.destination || "-")}</option>`).join("")}</select><input value="NO APLICA EN VENTA LOCAL" data-commercial-local-only ${localSale ? "" : "hidden"} disabled></label>
              <button type="button" class="master-order-plus-button" data-commercial-open-quick-editor="brand" data-commercial-export-only aria-label="Crear o editar marca" ${localSale ? "hidden disabled" : ""}>+</button>
            </div>
            <label class="compact-field" data-commercial-export-only ${localSale ? "hidden" : ""}><span>Agencia de carga</span><select data-commercial-order-field="agencyId" ${disabled(localSale || fieldLocked(order, "agencyId", workflow))}><option value="">Seleccione agencia</option>${agencies.map(item => `<option value="${utils.esc(item.id)}" ${item.id === order.agencyId ? "selected" : ""}>${utils.esc(item.name)} · ${utils.esc(item.coldRoom || "-")}</option>`).join("")}</select></label>
            <label class="compact-field" data-commercial-export-only ${localSale ? "hidden" : ""}><span>${transport === "AEREO" ? "DAE" : "DAE maritima"}</span>${supportsDae ? `<select data-commercial-order-field="daeNumber" ${disabled(localSale || fieldLocked(order, "daeNumber", workflow))}><option value="">Seleccione DAE</option>${daes.map(item => `<option value="${utils.esc(item.number)}" ${item.number === order.daeNumber ? "selected" : ""}>${utils.esc(item.number)} · ${utils.esc(item.country || item.destination || "SIN PAIS")}</option>`).join("")}</select><small>La DAE se asigna automaticamente segun el pais del cliente final. Puede elegir otra DAE activa y vigente.</small>` : `<input value="Se completa en Documentos electronicos SRI" disabled>`}</label>
          </section>
          <section class="master-order-form-section">
            <h4>Emision y destino</h4>
            <label class="compact-field"><span>Fecha de emision</span><input type="date" value="${utils.esc(order.issuedAt || "")}" data-commercial-order-field="issuedAt" ${disabled(fieldLocked(order, "issuedAt", workflow))}></label>
            <label class="compact-field"><span>Fecha de vuelo / salida</span><input type="date" value="${utils.esc(order.flightDate || "")}" data-commercial-order-field="flightDate" ${disabled(fieldLocked(order, "flightDate", workflow))}></label>
            <label class="compact-field"><span>Cuarto frio</span><input list="master-order-cold-rooms" value="${utils.esc(localSale ? "RETIRA EN FINCA" : (order.coldRoom || ""))}" data-commercial-order-field="coldRoom" ${disabled(localSale || fieldLocked(order, "coldRoom", workflow))}><datalist id="master-order-cold-rooms">${agencyRooms.map(room => `<option value="${utils.esc(room)}"></option>`).join("")}</datalist></label>
            <div class="inline-feedback info" data-commercial-local-only ${localSale ? "" : "hidden"}><strong>Venta local</strong> · Retiro en finca. No requiere agencia ni DAE. Las guias y la linea aerea son opcionales.</div>
            <label class="compact-field"><span>Guia madre / AWB${localSale ? " (opcional)" : ""}</span><input inputmode="numeric" maxlength="12" placeholder="045-12345678" value="${utils.esc(order.awb || "")}" data-commercial-order-field="awb" data-commercial-awb-input data-commercial-guide-input="awb" ${disabled(fieldLocked(order, "awb", workflow))}></label>
          </section>
          <section class="master-order-form-section">
            <h4>Logistica y venta</h4>
            <label class="compact-field"><span>Origen de las cajas</span><select data-commercial-order-field="inventorySupplyMode" ${disabled(fieldLocked(order, "inventorySupplyMode", workflow))}>${isImperioOrder ? `<option value="EXTERNAL_FARM" ${externalSupply ? "selected" : ""}>Compra a finca externa · sin inventario</option><option value="BLESS_SHARED" ${supplyMode === "BLESS_SHARED" ? "selected" : ""}>Disponibilidad compartida de Bless</option>` : `<option value="BLESS_INVENTORY" ${supplyMode !== "EXTERNAL_FARM" ? "selected" : ""}>Inventario propio de Bless · flujo normal</option><option value="EXTERNAL_FARM" ${externalSupply ? "selected" : ""}>Compra a finca externa · sin inventario</option>`}</select><small>La compra externa se factura sin afectar disponibilidad ni pasar por Cuarto frío.</small></label>
            <label class="compact-field master-awb-result"><span>Linea aerea${localSale ? " (opcional)" : ""}</span><input value="${utils.esc(recognizedAirline ? `${recognizedAirline.name} · prefijo ${recognizedAirline.awbPrefix}` : "Se reconoce al ingresar la guia madre")}" data-commercial-awb-airline disabled><small class="${recognizedAirline ? "is-valid" : awbDigits.length >= 3 ? "is-warning" : ""}" data-commercial-awb-status>${utils.esc(awbStatus)}</small></label>
            <label class="compact-field"><span>Tipo</span><select data-commercial-order-field="transportType" ${disabled(fieldLocked(order, "transportType", workflow))}><option value="aereo" ${transport === "AEREO" ? "selected" : ""}>Aereo</option><option value="maritimo" ${transport === "MARITIMO" ? "selected" : ""}>Maritimo</option><option value="terrestre" ${transport === "TERRESTRE" ? "selected" : ""}>Terrestre</option></select></label>
            <label class="compact-field"><span>Guia hija${localSale ? " (opcional)" : ""}</span><input type="text" placeholder="Texto libre, sin limite de caracteres" value="${utils.esc(order.hawb || "")}" data-commercial-order-field="hawb" data-commercial-guide-input="hawb" ${disabled(fieldLocked(order, "hawb", workflow))}><small>Admite letras, numeros, espacios y simbolos sin limite fijo.</small></label>
            <label class="compact-field"><span>Vendedor</span><select data-commercial-order-field="sellerId" ${disabled(fieldLocked(order, "sellerId", workflow) || !salespeople.length)}><option value="">${salespeople.length ? "Seleccione vendedor" : "Parametrice vendedores en Rol de pagos"}</option>${salespeople.map(item => `<option value="${utils.esc(item.seller_id)}" ${item.seller_id === (order.seller_id || order.sellerId) ? "selected" : ""}>${utils.esc(item.full_name)} · ${utils.esc(item.seller_id)}</option>`).join("")}</select></label>
            <label class="compact-field"><span>PO general</span><input value="${utils.esc(order.generalPo || "")}" data-commercial-order-field="generalPo" ${disabled(fieldLocked(order, "generalPo", workflow))}></label>
            <label class="compact-field"><span>Observaciones</span><textarea rows="2" data-commercial-order-field="notes" ${disabled(fieldLocked(order, "notes", workflow))}>${utils.esc(order.notes || "")}</textarea></label>
          </section>
        </div>
      </section>
      ${renderQuickCatalogEditors(order, appState, utils, stateApi)}
    `;
  }

  function commercialBoxes(order) {
    const groups = new Map();
    (order?.lines || []).forEach(line => {
      const boxNumber = Number(line?.boxNumber || 0);
      if (!boxNumber) return;
      if (!groups.has(boxNumber)) groups.set(boxNumber, []);
      groups.get(boxNumber).push({
        line,
        required: Math.max(0, metric(line?.bunches))
      });
    });
    return [...groups.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([boxNumber, lines]) => ({
        boxNumber,
        boxType: lines[0]?.line?.boxType || "HB",
        lines
      }));
  }

  function renderBoxes(order, appState, utils, stateApi, workflow) {
    const metrics = utils.getOrderMetrics(order);
    const boxTypes = BlessERP.comercialData.boxTypes || [];
    const rangeDraft = stateApi.getBoxRangeDraft(appState) || {};
    const boxes = commercialBoxes(order);
    const nextRangeBox = Math.max(0, ...boxes.map(box => Number(box.boxNumber || 0))) + 1;
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
    const released = RELEASED_STATES.has(normalize(order.warehouseStatus));
    const sriAuthorized = workflow.isSriAuthorized?.(order) || false;
    const linesEditable = !sriAuthorized && (released ? Boolean(order.revisionEditing) : workflow.canEditLines(order).ok);
    const canRetireDirectly = released && !sriAuthorized && !order.revisionEditing;
    const builderExpanded = Boolean(stateApi.getUi(appState).boxBuilderExpanded);
    const boxTypeOptionsCache = new Map();
    const varietyOptionsCache = new Map();
    const lengthOptionsCache = new Map();
    const boxTypeOptions = selected => {
      const key = String(selected || "");
      if (!boxTypeOptionsCache.has(key)) {
        boxTypeOptionsCache.set(key, boxTypes.map(type => `<option value="${utils.esc(type.code)}" ${type.code === selected ? "selected" : ""}>${utils.esc(type.code)}</option>`).join(""));
      }
      return boxTypeOptionsCache.get(key);
    };
    const varietyOptions = selected => {
      const key = String(selected || "");
      if (!varietyOptionsCache.has(key)) {
        varietyOptionsCache.set(key, varieties.map(variety => `<option value="${utils.esc(variety)}" ${variety === selected ? "selected" : ""}>${utils.esc(variety)}</option>`).join(""));
      }
      return varietyOptionsCache.get(key);
    };
    const lengthOptions = line => {
      const anyLength = isAnyLengthLine(line);
      const key = `${anyLength ? "ANY" : metric(line.length)}|${metric(line.length)}`;
      if (!lengthOptionsCache.has(key)) {
        lengthOptionsCache.set(key, renderLengthOptions(lengths, line.length, anyLength, utils));
      }
      return lengthOptionsCache.get(key);
    };
    const boxRows = boxes.map((box, boxIndex) => {
      const boxLines = box.lines || [];
      const boxTone = `master-box-tone-${boxIndex % 3}`;
      const itemRows = boxLines.map((item, lineIndex) => {
        const line = item.line;
        const scanned = Array.isArray(line.scannedBunches) ? line.scannedBunches.length : 0;
        const isNewRevisionLine = Number(line.addedRevision || 1) === Number(order.revisionDraftNumber || 0);
        const structuralLocked = !linesEditable || (order.revisionEditing && scanned > 0 && !isNewRevisionLine);
        const boxNumberLocked = !linesEditable || (order.revisionEditing && !isNewRevisionLine);
        return `<tr class="master-order-grid-row ${boxTone} ${lineIndex === 0 ? "is-box-start" : "is-box-continuation"}">
          <td class="master-box-number-cell"><strong>${utils.esc(box.boxNumber)}</strong><input type="hidden" value="${utils.esc(line.boxNumber)}" data-commercial-line-field="${utils.esc(line.id)}|boxNumber" ${disabled(boxNumberLocked)}></td>
          <td><select data-commercial-line-field="${utils.esc(line.id)}|boxType" ${disabled(structuralLocked)}>${boxTypeOptions(line.boxType)}</select></td>
          <td><select data-commercial-line-field="${utils.esc(line.id)}|variety" ${disabled(structuralLocked || line.boxBuildMode === "MIXTO_ABIERTO")}>${varietyOptions(line.variety)}</select>${line.boxBuildMode === "MIXTO_ABIERTO" && line.mixedExcludedVarieties?.length ? `<small class="warn-text">Excluye: ${utils.esc(line.mixedExcludedVarieties.join(", "))}</small>` : ""}</td>
          <td><input value="${utils.esc(line.po || "")}" data-commercial-line-field="${utils.esc(line.id)}|po" ${disabled(!linesEditable)}></td>
          <td><select data-commercial-line-field="${utils.esc(line.id)}|lengthSelection" ${disabled(structuralLocked)}>${lengthOptions(line)}</select></td>
          <td><input type="number" min="${Math.max(1, scanned)}" step="1" value="${utils.esc(line.bunches)}" data-commercial-line-field="${utils.esc(line.id)}|bunches" ${disabled(!linesEditable)}></td>
          <td><input type="number" min="1" step="1" value="${utils.esc(line.stemsPerBunch)}" data-commercial-line-field="${utils.esc(line.id)}|stemsPerBunch" ${disabled(structuralLocked)}></td>
          <td><input type="number" min="0" step="0.001" value="${utils.esc(line.unitPrice)}" data-commercial-line-field="${utils.esc(line.id)}|unitPrice" ${disabled(!linesEditable)}></td>
          <td><details class="master-box-action-menu"><summary>Opciones</summary><div class="master-box-action-menu-popover"><button class="secondary-button" data-commercial-duplicate-line="${utils.esc(line.id)}" ${disabled(!linesEditable)}>Duplicar item</button>${lineIndex === 0 ? `<button class="secondary-button" data-commercial-add-item-box="${utils.esc(box.boxNumber)}" ${disabled(!linesEditable || line.boxBuildMode === "MIXTO_ABIERTO")}>Agregar item</button><button class="secondary-button" data-commercial-duplicate-box="${utils.esc(box.boxNumber)}" ${disabled(!linesEditable)}>Duplicar caja</button><button class="secondary-button" data-commercial-delete-box="${utils.esc(box.boxNumber)}" data-commercial-box-action="${released ? "retire" : "delete"}" ${disabled(!linesEditable && !canRetireDirectly)}>${released ? "Retirar caja" : "Eliminar caja"}</button>` : `<button class="secondary-button" data-commercial-delete-line="${utils.esc(line.id)}" ${disabled(!linesEditable || scanned > 0)}>Eliminar item</button>`}</div></details></td>
        </tr>`;
      }).join("");
      return itemRows;
    }).join("");
    return `
      <section class="panel-card master-order-boxes">
        <div class="panel-card-head master-boxes-head">
          <div><p class="section-kicker">ORDEN DEL CLIENTE</p><h3>Cajas, variedades, cantidades y precios</h3><p class="panel-note">Defina aquí únicamente la composición comercial. El avance operativo se consulta en Seguimiento de pedidos.</p></div>
          <div class="table-actions-inline master-boxes-quick-actions">
            <button class="primary-button" type="button" data-commercial-jump-box-builder ${disabled(!linesEditable)}>Tipo de caja</button>
            <button class="secondary-button" data-route-link="operations-availability">Ver disponibilidad</button>
          </div>
        </div>
        <div data-commercial-box-builder-panel ${builderExpanded ? "" : "hidden"}>${renderBoxBuilder(order, rangeDraft, nextRangeBox, boxTypes, varieties, lengths, linesEditable, utils)}</div>
        ${boxes.length ? `<div class="compact-table-wrap master-order-grid-wrap"><table class="compact-table master-order-entry-table"><colgroup><col class="master-col-box"><col class="master-col-type"><col class="master-col-variety"><col class="master-col-po"><col class="master-col-measure"><col class="master-col-quantity"><col class="master-col-stems"><col class="master-col-price"><col class="master-col-actions"></colgroup><thead><tr><th>Caja</th><th>Tipo</th><th>Variedad</th><th>PO</th><th>Medida</th><th>Ramos</th><th>Tallos/ramo</th><th>Precio/tallo</th><th>Acciones</th></tr></thead><tbody>${boxRows}</tbody></table><small class="master-order-keyboard-help">Teclado: Tab / Shift+Tab y Enter avanzan; flechas recorren filas y columnas. En campos de texto, izquierda/derecha mueven de celda al llegar al borde.</small></div>` : `<div class="master-order-empty"><strong>El pedido no tiene cajas.</strong><span>Use el botón Tipo de caja de la cabecera y elija Rango igual, Mixto manual o Mixto abierto.</span></div>`}
        <div class="master-order-totals"><span data-commercial-grid-total="boxes">${utils.number(metrics.totalBoxes)} cajas</span><span data-commercial-grid-total="fulls">${utils.number(metrics.totalFulls.toFixed(3))} fulls</span><span data-commercial-grid-total="bunches">${utils.number(metrics.totalBunches)} ramos</span><span data-commercial-grid-total="stems">${utils.number(metrics.totalStems)} tallos</span><strong data-commercial-grid-total="usd">${utils.money(metrics.totalUsd)}</strong></div>
      </section>
    `;
  }

  function render(order, appState) {
    const utils = BlessERP.comercialUtils;
    const stateApi = BlessERP.comercialState;
    const workflow = BlessERP.comercialWorkflow;
    return `
      <div class="master-order-compact">
        ${renderHeaderData(order, appState, utils, stateApi, workflow)}
        ${renderBoxes(order, appState, utils, stateApi, workflow)}
      </div>
    `;
  }

  BlessERP.comercialPedidoMasterWorkspace = {
    render
  };
})();
