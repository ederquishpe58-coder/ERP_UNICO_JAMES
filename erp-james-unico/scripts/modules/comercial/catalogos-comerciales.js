(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const data = BlessERP.comercialData;
  const utils = BlessERP.comercialUtils;

  function renderTable(title, description, columns, rows) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CATALOGO DEMO</p>
            <h3>${utils.esc(title)}</h3>
          </div>
        </div>
        <p class="panel-note">${utils.esc(description)}</p>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table">
            <thead>
              <tr>${columns.map(column => `<th>${utils.esc(column)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${rows.join("") || `<tr><td colspan="${columns.length}">Sin datos demo.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderCustomersBrandsPage(appState) {
    const stateApi = BlessERP.comercialState;
    const customers = stateApi.getCustomerCatalog(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.customerDraft || data.createCustomer();
    const isExisting = customers.some(item => item.id === draft.id);
    const countries = [...new Set(["ECUADOR", "USA", "KAZAJSTAN", "REPUBLICA DOMINICANA", "NETHERLANDS", ...customers.map(item => item.country)].filter(Boolean))].sort();
    const notice = ui.notice ? `<div class="inline-feedback ${utils.esc(ui.noticeTone || "info")}">${utils.esc(ui.notice)}</div>` : "";

    return `
      <section class="page-header commercial-customers-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>Clientes principales</h1><p>Catalogo editable para relacion comercial, credito y datos operativos del Pedido Maestro.</p></div>
        <div class="page-header-side"><button class="secondary-button" data-customer-new>Nuevo cliente</button><button class="primary-button" data-customer-save>Guardar cliente</button></div>
      </section>
      ${notice}
      <section class="commercial-customers-workspace">
        <article class="panel-card commercial-customers-list">
          <div class="panel-card-head"><div><p class="section-kicker">CATALOGO</p><h3>Clientes registrados</h3></div><span>${customers.length} cliente(s)</span></div>
          <div class="compact-table-wrap"><table class="compact-table commercial-customers-table">
            <thead><tr><th>Codigo</th><th>Nombre comercial</th><th>Razon social</th><th>Categoria</th><th>Identificacion</th><th>Pais</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>${customers.map(item => `<tr class="${item.id === ui.selectedCustomerId ? "selected" : ""}">
              <td>${utils.esc(item.code)}</td><td>${utils.esc(item.commercialName)}</td><td>${utils.esc(item.legalName)}</td><td>${utils.esc(item.category)}</td>
              <td>${utils.esc(item.identification)}</td><td>${utils.esc(item.country)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td>
              <td><button class="row-action-button" data-customer-select="${utils.esc(item.id)}">Editar</button></td>
            </tr>`).join("") || `<tr><td colspan="8">No existen clientes registrados.</td></tr>`}</tbody>
          </table></div>
        </article>
        <article class="commercial-customer-editor">
          <div class="commercial-customer-editor-head"><div><p class="section-kicker">${isExisting ? "EDITAR CLIENTE" : "NUEVO CLIENTE"}</p><h2>${utils.esc(draft.commercialName || "Cliente principal")}</h2><p>Ficha comercial para Pedido Maestro. Las marcas se configuraran en el siguiente paso.</p></div><span class="status-badge ${utils.badgeClass(draft.status)}">${utils.esc(draft.status)}</span></div>
          <section class="customer-editor-section">
            <h3>Detalle cliente</h3>
            <div class="customer-editor-grid">
              <label class="compact-inline-field"><span>Codigo automatico</span><input value="${utils.esc(draft.code)}" data-customer-field="code" readonly></label>
              <label class="compact-inline-field"><span>Categoria</span><select data-customer-field="category"><option ${draft.category === "EXPORTACION" ? "selected" : ""}>EXPORTACION</option><option ${draft.category === "LOCAL" ? "selected" : ""}>LOCAL</option><option ${draft.category === "MIXTO" ? "selected" : ""}>MIXTO</option></select></label>
              <label class="customer-check-field"><span>Relacionado</span><input type="checkbox" ${draft.related ? "checked" : ""} data-customer-field="related"></label>
              <label class="customer-check-field"><span>Flor tipo B</span><input type="checkbox" ${draft.flowerTypeB ? "checked" : ""} data-customer-field="flowerTypeB"></label>
              <label class="compact-inline-field customer-span-2"><span>Apellidos y nombres / Razon social</span><input value="${utils.esc(draft.legalName)}" data-customer-field="legalName"></label>
              <label class="compact-inline-field"><span>Nombre comercial</span><input value="${utils.esc(draft.commercialName)}" data-customer-field="commercialName"></label>
              <label class="compact-inline-field"><span>Estado</span><select data-customer-field="status"><option ${draft.status === "ACTIVO" ? "selected" : ""}>ACTIVO</option><option ${draft.status === "INACTIVO" ? "selected" : ""}>INACTIVO</option></select></label>
              <label class="compact-inline-field"><span>Tipo identificacion</span><select data-customer-field="identificationType">${["RUC", "CEDULA", "PASAPORTE", "TAX ID"].map(item => `<option ${item === draft.identificationType ? "selected" : ""}>${item}</option>`).join("")}</select></label>
              <label class="compact-inline-field"><span>Numero identificacion</span><input value="${utils.esc(draft.identification)}" data-customer-field="identification"></label>
              <label class="compact-inline-field customer-span-2 customer-address"><span>Direccion</span><textarea rows="2" data-customer-field="address">${utils.esc(draft.address)}</textarea></label>
              <label class="compact-inline-field"><span>Ciudad</span><input value="${utils.esc(draft.city)}" data-customer-field="city"></label>
              <label class="compact-inline-field"><span>Pais</span><select data-customer-field="country">${countries.map(item => `<option ${item === draft.country ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
              <label class="compact-inline-field"><span>Contacto</span><input value="${utils.esc(draft.contact)}" data-customer-field="contact"></label>
              <label class="compact-inline-field"><span>Tel. fijo</span><input value="${utils.esc(draft.fixedPhone)}" data-customer-field="fixedPhone"></label>
              <label class="compact-inline-field"><span>Tel. movil</span><input value="${utils.esc(draft.mobilePhone)}" data-customer-field="mobilePhone"></label>
              <label class="compact-inline-field customer-span-2"><span>Correo contacto</span><input type="email" value="${utils.esc(draft.contactEmail)}" data-customer-field="contactEmail"></label>
            </div>
          </section>
          <section class="customer-editor-section">
            <h3>Credito</h3>
            <div class="customer-credit-grid">
              <label class="compact-inline-field"><span>Dias</span><input type="number" min="0" value="${utils.esc(draft.creditDays)}" data-customer-field="creditDays"></label>
              <label class="compact-inline-field"><span>Monto</span><input type="number" min="0" step="0.01" value="${utils.esc(draft.creditAmount)}" data-customer-field="creditAmount"></label>
              <label class="compact-inline-field"><span>Correo facturacion</span><input type="email" value="${utils.esc(draft.billingEmail)}" data-customer-field="billingEmail"></label>
              <label class="compact-inline-field customer-span-2"><span>Correo estados de cuenta</span><input type="email" value="${utils.esc(draft.statementEmail)}" data-customer-field="statementEmail"></label>
            </div>
          </section>
        </article>
      </section>
    `;
  }

  function bindCustomersPage(container, appState) {
    const stateApi = BlessERP.comercialState;
    container.querySelector("[data-customer-new]")?.addEventListener("click", () => { stateApi.newCustomer(appState); BlessERP.layout.renderPage(); });
    container.querySelector("[data-customer-save]")?.addEventListener("click", () => { stateApi.saveCustomer(appState); BlessERP.layout.renderPage(); });
    container.querySelectorAll("[data-customer-select]").forEach(button => button.addEventListener("click", () => { stateApi.selectCustomer(appState, button.dataset.customerSelect); BlessERP.layout.renderPage(); }));
    container.querySelectorAll("[data-customer-field]").forEach(field => {
      const update = () => stateApi.updateCustomerDraftField(appState, field.dataset.customerField, field.type === "checkbox" ? field.checked : field.value);
      field.addEventListener(field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input", update);
    });
  }

  function renderBrandsPage(appState) {
    const stateApi = BlessERP.comercialState;
    const brands = stateApi.getBrandCatalog(appState);
    const customers = stateApi.getCustomerCatalog(appState);
    const destinations = stateApi.getDestinationCatalog(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.brandDraft || data.createBrand();
    const isExisting = brands.some(item => item.id === draft.id);
    const agency = data.agencies.find(item => item.id === draft.defaultAgencyId) || null;
    const countries = [...new Set(["ECUADOR", "USA", "KAZAJSTAN", "REPUBLICA DOMINICANA", "NETHERLANDS", "RUSIA", ...brands.map(item => item.country)].filter(Boolean))].sort();
    const customerName = customerId => customers.find(item => item.id === customerId)?.commercialName || "Sin cliente";
    const agencyValue = (field, fallbackField) => draft[field] || agency?.[fallbackField] || "";
    const notice = ui.notice ? `<div class="inline-feedback ${utils.esc(ui.noticeTone || "info")}">${utils.esc(ui.notice)}</div>` : "";

    return `
      <section class="page-header commercial-customers-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>Marcas / clientes finales</h1><p>Catalogo editable ligado al cliente principal. Define destino, contacto y comportamiento comercial.</p></div>
        <div class="page-header-side"><button class="secondary-button" data-brand-new>Nueva marca</button><button class="secondary-button" data-route-link="commercial-cargo-agencies">Crear / editar agencias</button><button class="primary-button" data-brand-save>Guardar marca</button></div>
      </section>
      ${notice}
      <section class="commercial-customers-workspace commercial-brands-workspace">
        <article class="panel-card commercial-customers-list">
          <div class="panel-card-head"><div><p class="section-kicker">CATALOGO</p><h3>Marcas registradas</h3></div><span>${brands.length} marca(s)</span></div>
          <div class="compact-table-wrap"><table class="compact-table commercial-customers-table commercial-brands-table">
            <thead><tr><th>Codigo</th><th>Cliente principal</th><th>Marca</th><th>Razon social</th><th>Pais</th><th>Comercializadora</th><th>Accion</th></tr></thead>
            <tbody>${brands.map(item => `<tr class="${item.id === ui.selectedBrandId ? "selected" : ""}">
              <td>${utils.esc(item.code)}</td><td>${utils.esc(customerName(item.customerId))}</td><td>${utils.esc(item.name)}</td><td>${utils.esc(item.finalClientName)}</td>
              <td>${utils.esc(item.country)}</td><td>${item.commercializer ? "Si" : "No"}</td><td><button class="row-action-button" data-brand-select="${utils.esc(item.id)}">Editar</button></td>
            </tr>`).join("") || `<tr><td colspan="7">No existen marcas registradas.</td></tr>`}</tbody>
          </table></div>
        </article>
        <article class="commercial-customer-editor commercial-brand-editor">
          <div class="commercial-customer-editor-head"><div><p class="section-kicker">${isExisting ? "EDITAR MARCA" : "NUEVA MARCA"}</p><h2>${utils.esc(draft.name || "Marca / cliente final")}</h2><p>Una marca final pertenece a un cliente principal y puede tener razon social, pais y operacion propios.</p></div><span class="status-badge authorized">${utils.esc(draft.country || "SIN PAIS")}</span></div>
          <section class="customer-editor-section">
            <h3>Detalle marcacion</h3>
            <div class="customer-editor-grid brand-editor-grid">
              <label class="compact-inline-field"><span>Codigo automatico</span><input value="${utils.esc(draft.code)}" data-brand-field="code" readonly></label>
              <label class="compact-inline-field"><span>Cliente principal</span><select data-brand-field="customerId"><option value="">Seleccione...</option>${customers.map(item => `<option value="${utils.esc(item.id)}" ${item.id === draft.customerId ? "selected" : ""}>${utils.esc(item.commercialName)} · ${utils.esc(item.code)}</option>`).join("")}</select></label>
              <label class="customer-check-field"><span>Comercializadora</span><input type="checkbox" ${draft.commercializer ? "checked" : ""} data-brand-field="commercializer"></label>
              <label class="compact-inline-field"><span>Marca / referencia corta</span><input value="${utils.esc(draft.name)}" data-brand-field="name"></label>
              <label class="compact-inline-field customer-span-2"><span>Apellidos y nombres / Razon social</span><input value="${utils.esc(draft.finalClientName)}" data-brand-field="finalClientName"></label>
              <label class="compact-inline-field customer-span-2 customer-address"><span>Direccion</span><textarea rows="2" data-brand-field="address">${utils.esc(draft.address)}</textarea></label>
              <label class="compact-inline-field"><span>Ciudad</span><input value="${utils.esc(draft.city)}" data-brand-field="city"></label>
              <label class="compact-inline-field"><span>Pais</span><select data-brand-field="country">${countries.map(item => `<option ${item === draft.country ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
              <label class="compact-inline-field"><span>Tel. fijo</span><input value="${utils.esc(draft.fixedPhone)}" data-brand-field="fixedPhone"></label>
              <label class="compact-inline-field"><span>Tel. movil</span><input value="${utils.esc(draft.phone)}" data-brand-field="phone"></label>
            </div>
          </section>
          <section class="customer-editor-section">
            <h3>Datos operativos</h3>
            <div class="customer-editor-grid brand-operations-grid">
              <label class="compact-inline-field"><span>Agencia automatica</span><select data-brand-field="defaultAgencyId"><option value="">Sin agencia</option>${data.agencies.map(item => `<option value="${utils.esc(item.id)}" ${item.id === draft.defaultAgencyId ? "selected" : ""}>${utils.esc(item.name)}</option>`).join("")}</select></label>
              <label class="compact-inline-field"><span>Contacto agencia</span><input value="${utils.esc(agencyValue("agencyContact", "contact"))}" data-brand-field="agencyContact"></label>
              <label class="compact-inline-field customer-span-2"><span>Correo agencia</span><input type="email" value="${utils.esc(agencyValue("agencyEmail", "email"))}" data-brand-field="agencyEmail"></label>
              <label class="compact-inline-field"><span>Cuarto frio base</span><input value="${utils.esc(agencyValue("agencyColdRoom", "coldRoom"))}" data-brand-field="agencyColdRoom"></label>
              <label class="compact-inline-field"><span>Ciudad agencia</span><input value="${utils.esc(agencyValue("agencyCity", "city"))}" data-brand-field="agencyCity"></label>
              <label class="compact-inline-field"><span>Destino</span><select data-brand-field="destination"><option value="">Seleccione...</option>${destinations.filter(item => item.status === "ACTIVO").map(item => `<option value="${utils.esc(item.destination)}" ${item.destination === draft.destination ? "selected" : ""}>${utils.esc(item.destination)}</option>`).join("")}</select></label>
              <label class="compact-inline-field"><span>Contacto</span><input value="${utils.esc(draft.contact)}" data-brand-field="contact"></label>
              <label class="compact-inline-field customer-span-2"><span>Correo</span><input type="email" value="${utils.esc(draft.email)}" data-brand-field="email"></label>
              <label class="compact-inline-field"><span>Consignee impreso</span><input value="${utils.esc(draft.printedConsignee)}" data-brand-field="printedConsignee"></label>
              <label class="compact-inline-field"><span>Bill to / marca impresa</span><input value="${utils.esc(draft.printedMark)}" data-brand-field="printedMark"></label>
              <label class="compact-inline-field customer-span-2"><span>Direccion impresa invoice</span><input value="${utils.esc(draft.printedInvoiceAddress)}" data-brand-field="printedInvoiceAddress"></label>
              <label class="compact-inline-field"><span>Requiere PO</span><select data-brand-field="requiresPo"><option value="false" ${!draft.requiresPo ? "selected" : ""}>No</option><option value="true" ${draft.requiresPo ? "selected" : ""}>Si</option></select></label>
              <label class="compact-inline-field customer-span-2 customer-address"><span>Observacion</span><textarea rows="2" data-brand-field="observation">${utils.esc(draft.observation)}</textarea></label>
            </div>
          </section>
        </article>
      </section>
    `;
  }

  function bindBrandsPage(container, appState) {
    const stateApi = BlessERP.comercialState;
    container.querySelector("[data-brand-new]")?.addEventListener("click", () => { stateApi.newBrand(appState); BlessERP.layout.renderPage(); });
    container.querySelector("[data-brand-save]")?.addEventListener("click", () => { stateApi.saveBrand(appState); BlessERP.layout.renderPage(); });
    container.querySelectorAll("[data-brand-select]").forEach(button => button.addEventListener("click", () => { stateApi.selectBrand(appState, button.dataset.brandSelect); BlessERP.layout.renderPage(); }));
    container.querySelectorAll("[data-brand-field]").forEach(field => {
      const update = () => {
        stateApi.updateBrandDraftField(appState, field.dataset.brandField, field.type === "checkbox" ? field.checked : field.value);
        if (field.dataset.brandField === "defaultAgencyId") BlessERP.layout.renderPage();
      };
      field.addEventListener(field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input", update);
    });
  }

  function renderAgenciesPage(appState) {
    const stateApi = BlessERP.comercialState;
    const agencies = stateApi.getAgencyCatalog(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.agencyDraft || data.createAgency();
    const isExisting = agencies.some(item => item.id === draft.id);
    const notice = ui.notice ? `<div class="inline-feedback ${utils.esc(ui.noticeTone || "info")}">${utils.esc(ui.notice)}</div>` : "";

    return `
      <section class="page-header commercial-customers-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>Agencias de carga</h1><p>Primero se parametriza la agencia aqui. Luego, en Marca, solo se selecciona y el sistema trae sus datos operativos.</p></div>
        <div class="page-header-side"><button class="secondary-button" data-agency-new>Nueva agencia</button><button class="primary-button" data-agency-save>Guardar agencia</button></div>
      </section>
      ${notice}
      <section class="commercial-customers-workspace commercial-agencies-workspace">
        <article class="panel-card commercial-customers-list">
          <div class="panel-card-head"><div><p class="section-kicker">CATALOGO</p><h3>Agencias registradas</h3></div><span>${agencies.length} agencia(s)</span></div>
          <div class="compact-table-wrap"><table class="compact-table commercial-customers-table commercial-agencies-table">
            <thead><tr><th>Codigo</th><th>Agencia</th><th>Cuarto frio</th><th>Ciudad</th><th>Contacto</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>${agencies.map(item => `<tr class="${item.id === ui.selectedAgencyId ? "selected" : ""}">
              <td>${utils.esc(item.code)}</td><td>${utils.esc(item.name)}</td><td>${utils.esc((item.coldRooms || [item.coldRoom]).filter(Boolean).join(", "))}</td><td>${utils.esc(item.city)}</td><td>${utils.esc(item.contact)}</td>
              <td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td><td><button class="row-action-button" data-agency-select="${utils.esc(item.id)}">Editar</button></td>
            </tr>`).join("") || `<tr><td colspan="7">No existen agencias registradas.</td></tr>`}</tbody>
          </table></div>
        </article>
        <article class="commercial-customer-editor commercial-agency-editor">
          <div class="commercial-customer-editor-head"><div><p class="section-kicker">${isExisting ? "EDITAR AGENCIA" : "NUEVA AGENCIA"}</p><h2>${utils.esc(draft.name || "Agencia de carga")}</h2><p>Este catalogo alimenta la marca y despues la logistica del Pedido Maestro.</p></div><span class="status-badge authorized">${utils.esc(draft.coldRoom || "SIN CUARTO FRIO")}</span></div>
          <section class="customer-editor-section">
            <h3>Datos base</h3>
            <div class="customer-editor-grid agency-editor-grid">
              <label class="compact-inline-field"><span>Codigo automatico</span><input value="${utils.esc(draft.code)}" data-agency-field="code" readonly></label>
              <label class="compact-inline-field"><span>Agencia</span><input value="${utils.esc(draft.name)}" data-agency-field="name"></label>
              <label class="compact-inline-field"><span>Cuarto frio principal</span><input value="${utils.esc(draft.coldRoom)}" data-agency-field="coldRoom"></label>
              <label class="compact-inline-field customer-span-2 customer-address"><span>Cuartos frios asociados</span><textarea rows="2" placeholder="Uno por linea o separados por coma" data-agency-field="coldRooms">${utils.esc((draft.coldRooms || []).join("\n"))}</textarea></label>
              <label class="compact-inline-field"><span>Ciudad</span><input value="${utils.esc(draft.city)}" data-agency-field="city"></label>
              <label class="compact-inline-field"><span>Contacto</span><input value="${utils.esc(draft.contact)}" data-agency-field="contact"></label>
              <label class="compact-inline-field customer-span-2"><span>Correo</span><input type="email" value="${utils.esc(draft.email)}" data-agency-field="email"></label>
              <label class="compact-inline-field"><span>Telefono</span><input value="${utils.esc(draft.phone)}" data-agency-field="phone"></label>
              <label class="compact-inline-field"><span>Estado</span><select data-agency-field="status"><option ${draft.status === "ACTIVA" ? "selected" : ""}>ACTIVA</option><option ${draft.status === "INACTIVA" ? "selected" : ""}>INACTIVA</option></select></label>
              <label class="compact-inline-field customer-span-2 customer-address"><span>Observacion</span><textarea rows="2" data-agency-field="observation">${utils.esc(draft.observation)}</textarea></label>
            </div>
          </section>
        </article>
      </section>
    `;
  }

  function bindAgenciesPage(container, appState) {
    const stateApi = BlessERP.comercialState;
    container.querySelector("[data-agency-new]")?.addEventListener("click", () => { stateApi.newAgency(appState); BlessERP.layout.renderPage(); });
    container.querySelector("[data-agency-save]")?.addEventListener("click", () => { stateApi.saveAgency(appState); BlessERP.layout.renderPage(); });
    container.querySelectorAll("[data-agency-select]").forEach(button => button.addEventListener("click", () => { stateApi.selectAgency(appState, button.dataset.agencySelect); BlessERP.layout.renderPage(); }));
    container.querySelectorAll("[data-agency-field]").forEach(field => {
      const update = () => stateApi.updateAgencyDraftField(appState, field.dataset.agencyField, field.value);
      field.addEventListener(field.tagName === "SELECT" ? "change" : "input", update);
    });
  }

  function renderDestinationsPage(appState) {
    const stateApi = BlessERP.comercialState;
    const destinations = stateApi.getDestinationCatalog(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.destinationDraft || data.createDestination();
    const isExisting = destinations.some(item => item.id === draft.id);
    const notice = ui.notice ? `<div class="inline-feedback ${utils.esc(ui.noticeTone || "info")}">${utils.esc(ui.notice)}</div>` : "";

    return `
      <section class="page-header commercial-customers-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>Destinos / paises</h1><p>Catalogo editable usado para transporte, Marca, sugerencia de DAE y Pedido Maestro.</p></div>
        <div class="page-header-side"><button class="secondary-button" data-destination-new>Nuevo destino</button><button class="primary-button" data-destination-save>Guardar destino</button></div>
      </section>
      ${notice}
      <section class="commercial-customers-workspace commercial-destinations-workspace">
        <article class="panel-card commercial-customers-list">
          <div class="panel-card-head"><div><p class="section-kicker">CATALOGO</p><h3>Destinos y paises registrados</h3></div><span>${destinations.length} destino(s)</span></div>
          <div class="compact-table-wrap"><table class="compact-table commercial-customers-table commercial-destinations-table">
            <thead><tr><th>Codigo</th><th>Destino</th><th>Pais</th><th>Transporte sugerido</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>${destinations.map(item => `<tr class="${item.id === ui.selectedDestinationId ? "selected" : ""}">
              <td>${utils.esc(item.code)}</td><td>${utils.esc(item.destination)}</td><td>${utils.esc(item.country)}</td><td>${utils.esc(item.suggestedTransport)}</td>
              <td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td><td><button class="row-action-button" data-destination-select="${utils.esc(item.id)}">Editar</button></td>
            </tr>`).join("") || `<tr><td colspan="6">No existen destinos registrados.</td></tr>`}</tbody>
          </table></div>
        </article>
        <article class="commercial-customer-editor commercial-destination-editor">
          <div class="commercial-customer-editor-head"><div><p class="section-kicker">${isExisting ? "EDITAR DESTINO" : "NUEVO DESTINO"}</p><h2>${utils.esc(draft.destination || "Destino / pais")}</h2><p>Los destinos activos apareceran al parametrizar Marcas y DAEs.</p></div><span class="status-badge authorized">${utils.esc(draft.country || "SIN PAIS")}</span></div>
          <section class="customer-editor-section">
            <h3>Datos base</h3>
            <div class="customer-editor-grid destination-editor-grid">
              <label class="compact-inline-field"><span>Codigo automatico</span><input value="${utils.esc(draft.code)}" data-destination-field="code" readonly></label>
              <label class="compact-inline-field"><span>Destino</span><input value="${utils.esc(draft.destination)}" data-destination-field="destination"></label>
              <label class="compact-inline-field"><span>Pais</span><input value="${utils.esc(draft.country)}" data-destination-field="country"></label>
              <label class="compact-inline-field"><span>Transporte sugerido</span><select data-destination-field="suggestedTransport"><option value="aereo" ${draft.suggestedTransport === "aereo" ? "selected" : ""}>Aereo</option><option value="terrestre" ${draft.suggestedTransport === "terrestre" ? "selected" : ""}>Terrestre</option><option value="maritimo" ${draft.suggestedTransport === "maritimo" ? "selected" : ""}>Maritimo</option></select></label>
              <label class="compact-inline-field"><span>Estado</span><select data-destination-field="status"><option ${draft.status === "ACTIVO" ? "selected" : ""}>ACTIVO</option><option ${draft.status === "INACTIVO" ? "selected" : ""}>INACTIVO</option></select></label>
            </div>
          </section>
        </article>
      </section>
    `;
  }

  function bindDestinationsPage(container, appState) {
    const stateApi = BlessERP.comercialState;
    container.querySelector("[data-destination-new]")?.addEventListener("click", () => { stateApi.newDestination(appState); BlessERP.layout.renderPage(); });
    container.querySelector("[data-destination-save]")?.addEventListener("click", () => { stateApi.saveDestination(appState); BlessERP.layout.renderPage(); });
    container.querySelectorAll("[data-destination-select]").forEach(button => button.addEventListener("click", () => { stateApi.selectDestination(appState, button.dataset.destinationSelect); BlessERP.layout.renderPage(); }));
    container.querySelectorAll("[data-destination-field]").forEach(field => {
      const update = () => stateApi.updateDestinationDraftField(appState, field.dataset.destinationField, field.value);
      field.addEventListener(field.tagName === "SELECT" ? "change" : "input", update);
    });
  }

  function renderDaesPage(appState) {
    const stateApi = BlessERP.comercialState;
    const daes = stateApi.getDaeCatalog(appState);
    const customers = stateApi.getCustomerCatalog(appState);
    const airlines = stateApi.getAirlineCatalog(appState);
    const destinationCatalog = stateApi.getDestinationCatalog(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.daeDraft || data.createDae();
    const isExisting = daes.some(item => item.id === draft.id);
    const destinations = destinationCatalog.filter(item => item.status === "ACTIVO").map(item => item.destination);
    const clientNames = item => (item.customerIds || []).map(id => customers.find(customer => customer.id === id)?.commercialName).filter(Boolean).join(", ") || "-";
    const displayState = item => utils.isDaeExpired(item) ? "CADUCADA" : item.status;
    const notice = ui.notice ? `<div class="inline-feedback ${utils.esc(ui.noticeTone || "info")}">${utils.esc(ui.notice)}</div>` : "";

    return `
      <section class="page-header commercial-customers-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>DAEs</h1><p>Catalogo mensual editable. Aqui se actualiza destino, caducidad, cliente permitido y linea aerea asociada.</p></div>
        <div class="page-header-side"><button class="secondary-button" data-dae-new>Nueva DAE</button><button class="primary-button" data-dae-save>Guardar DAE</button></div>
      </section>
      ${notice}
      <section class="commercial-customers-workspace commercial-daes-workspace">
        <article class="panel-card commercial-customers-list">
          <div class="panel-card-head"><div><p class="section-kicker">CATALOGO MENSUAL</p><h3>DAEs registradas</h3></div><span>${daes.length} DAE(s)</span></div>
          <div class="compact-table-wrap"><table class="compact-table commercial-customers-table commercial-daes-table">
            <thead><tr><th>Numero DAE</th><th>Destino</th><th>Caducidad</th><th>Linea aerea</th><th>Clientes</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>${daes.map(item => `<tr class="${item.id === ui.selectedDaeId ? "selected" : ""}">
              <td>${utils.esc(item.number)}</td><td>${utils.esc(item.destination)}</td><td>${utils.esc(item.expirationDate)}</td><td>${utils.esc(utils.findAirline(item.airlineId)?.name || "-")}</td>
              <td>${utils.esc(clientNames(item))}</td><td><span class="status-badge ${utils.badgeClass(displayState(item))}">${utils.esc(displayState(item))}</span></td><td><button class="row-action-button" data-dae-select="${utils.esc(item.id)}">Editar</button></td>
            </tr>`).join("") || `<tr><td colspan="7">No existen DAEs registradas.</td></tr>`}</tbody>
          </table></div>
        </article>
        <article class="commercial-customer-editor commercial-dae-editor">
          <div class="commercial-customer-editor-head"><div><p class="section-kicker">${isExisting ? "EDITAR DAE" : "NUEVA DAE"}</p><h2>${utils.esc(draft.number || "DAE")}</h2><p>La DAE se conecta por cliente principal y destino. La linea aerea se autocompleta en Pedido Maestro segun esta parametrizacion.</p></div><span class="status-badge ${utils.badgeClass(displayState(draft))}">${utils.esc(displayState(draft))}</span></div>
          <section class="customer-editor-section">
            <h3>Datos base</h3>
            <div class="customer-editor-grid dae-editor-grid">
              <label class="compact-inline-field"><span>Numero DAE</span><input value="${utils.esc(draft.number)}" data-dae-field="number"></label>
              <label class="compact-inline-field"><span>Destino</span><select data-dae-field="destination"><option value="">Seleccione...</option>${destinations.map(item => `<option ${item === draft.destination ? "selected" : ""}>${utils.esc(item)}</option>`).join("")}</select></label>
              <label class="compact-inline-field"><span>Pais</span><input value="${utils.esc(draft.country)}" data-dae-field="country"></label>
              <label class="compact-inline-field"><span>Fecha caducidad</span><input type="date" value="${utils.esc(draft.expirationDate)}" data-dae-field="expirationDate"></label>
              <label class="compact-inline-field"><span>Linea aerea</span><select data-dae-field="airlineId"><option value="">Seleccione...</option>${airlines.map(item => `<option value="${utils.esc(item.id)}" ${item.id === draft.airlineId ? "selected" : ""}>${utils.esc(item.name)} · ${utils.esc(item.awbPrefix)}</option>`).join("")}</select></label>
              <label class="compact-inline-field"><span>Estado</span><select data-dae-field="status"><option ${draft.status === "ACTIVA" ? "selected" : ""}>ACTIVA</option><option ${draft.status === "INACTIVA" ? "selected" : ""}>INACTIVA</option></select></label>
              <label class="compact-inline-field customer-span-2 customer-address"><span>Observacion</span><textarea rows="2" data-dae-field="observation">${utils.esc(draft.observation)}</textarea></label>
            </div>
          </section>
          <section class="customer-editor-section">
            <h3>Clientes habilitados</h3>
            <div class="dae-customer-grid">${customers.map(item => `<label class="dae-customer-option"><span>${utils.esc(item.commercialName)}</span><input type="checkbox" data-dae-customer="${utils.esc(item.id)}" ${(draft.customerIds || []).includes(item.id) ? "checked" : ""}></label>`).join("") || `<p>No existen clientes principales.</p>`}</div>
          </section>
        </article>
      </section>
    `;
  }

  function bindDaesPage(container, appState) {
    const stateApi = BlessERP.comercialState;
    container.querySelector("[data-dae-new]")?.addEventListener("click", () => { stateApi.newDae(appState); BlessERP.layout.renderPage(); });
    container.querySelector("[data-dae-save]")?.addEventListener("click", () => { stateApi.saveDae(appState); BlessERP.layout.renderPage(); });
    container.querySelectorAll("[data-dae-select]").forEach(button => button.addEventListener("click", () => { stateApi.selectDae(appState, button.dataset.daeSelect); BlessERP.layout.renderPage(); }));
    container.querySelectorAll("[data-dae-customer]").forEach(field => field.addEventListener("change", () => stateApi.toggleDaeCustomer(appState, field.dataset.daeCustomer, field.checked)));
    container.querySelectorAll("[data-dae-field]").forEach(field => {
      const update = () => {
        stateApi.updateDaeDraftField(appState, field.dataset.daeField, field.value);
        if (field.dataset.daeField === "destination") BlessERP.layout.renderPage();
      };
      field.addEventListener(field.tagName === "SELECT" || field.type === "date" ? "change" : "input", update);
    });
  }

  function renderAirlinesPage(appState) {
    const stateApi = BlessERP.comercialState;
    const airlines = stateApi.getAirlineCatalog(appState);
    const ui = stateApi.getUi(appState);
    const draft = ui.airlineDraft || data.createAirline();
    const isExisting = airlines.some(item => item.id === draft.id);
    const notice = ui.notice ? `<div class="inline-feedback ${utils.esc(ui.noticeTone || "info")}">${utils.esc(ui.notice)}</div>` : "";

    return `
      <section class="page-header commercial-customers-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>Lineas aereas</h1><p>Catalogo editable de carriers y prefijos AWB. Alimenta DAE, Pedido Maestro y factura comercial.</p></div>
        <div class="page-header-side"><button class="secondary-button" data-airline-new>Nueva linea</button><button class="primary-button" data-airline-save>Guardar linea</button></div>
      </section>
      ${notice}
      <section class="commercial-customers-workspace commercial-airlines-workspace">
        <article class="panel-card commercial-customers-list">
          <div class="panel-card-head"><div><p class="section-kicker">CATALOGO</p><h3>Lineas aereas registradas</h3></div><span>${airlines.length} linea(s)</span></div>
          <div class="compact-table-wrap"><table class="compact-table commercial-customers-table commercial-airlines-table">
            <thead><tr><th>Codigo</th><th>Linea aerea</th><th>Prefijo AWB</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>${airlines.map(item => `<tr class="${item.id === ui.selectedAirlineId ? "selected" : ""}">
              <td>${utils.esc(item.code)}</td><td>${utils.esc(item.name)}</td><td>${utils.esc(item.awbPrefix)}</td><td><span class="status-badge ${utils.badgeClass(item.status)}">${utils.esc(item.status)}</span></td>
              <td><div class="table-actions-inline"><button class="row-action-button" data-airline-select="${utils.esc(item.id)}">Editar</button><button class="row-action-button danger" data-airline-delete="${utils.esc(item.id)}">Borrar</button></div></td>
            </tr>`).join("") || `<tr><td colspan="5">No existen lineas aereas registradas.</td></tr>`}</tbody>
          </table></div>
        </article>
        <article class="commercial-customer-editor commercial-airline-editor">
          <div class="commercial-customer-editor-head"><div><p class="section-kicker">${isExisting ? "EDITAR LINEA" : "NUEVA LINEA"}</p><h2>${utils.esc(draft.name || "Linea aerea")}</h2><p>Este catalogo autocompleta la linea aerea desde la DAE y valida los prefijos AWB.</p></div><span class="status-badge authorized">${utils.esc(draft.awbPrefix || "SIN PREFIJO")}</span></div>
          <section class="customer-editor-section">
            <h3>Datos base</h3>
            <div class="customer-editor-grid airline-editor-grid">
              <label class="compact-inline-field"><span>Codigo</span><input value="${utils.esc(draft.code)}" data-airline-field="code"></label>
              <label class="compact-inline-field"><span>Linea aerea</span><input value="${utils.esc(draft.name)}" data-airline-field="name"></label>
              <label class="compact-inline-field"><span>Prefijo AWB</span><input inputmode="numeric" maxlength="3" value="${utils.esc(draft.awbPrefix)}" data-airline-field="awbPrefix"></label>
              <label class="compact-inline-field"><span>Estado</span><select data-airline-field="status"><option ${draft.status === "ACTIVA" ? "selected" : ""}>ACTIVA</option><option ${draft.status === "INACTIVA" ? "selected" : ""}>INACTIVA</option></select></label>
            </div>
          </section>
          <section class="customer-editor-section airline-rules-card">
            <h3>Reglas</h3>
            <ul class="checklist-list">
              <li>El prefijo AWB debe tener 3 digitos.</li>
              <li>No se puede repetir el codigo ni el prefijo.</li>
              <li>No se puede borrar una linea aerea si ya esta usada en DAE o pedidos.</li>
            </ul>
          </section>
        </article>
      </section>
    `;
  }

  function bindAirlinesPage(container, appState) {
    const stateApi = BlessERP.comercialState;
    container.querySelector("[data-airline-new]")?.addEventListener("click", () => { stateApi.newAirline(appState); BlessERP.layout.renderPage(); });
    container.querySelector("[data-airline-save]")?.addEventListener("click", () => { stateApi.saveAirline(appState); BlessERP.layout.renderPage(); });
    container.querySelectorAll("[data-airline-select]").forEach(button => button.addEventListener("click", () => { stateApi.selectAirline(appState, button.dataset.airlineSelect); BlessERP.layout.renderPage(); }));
    container.querySelectorAll("[data-airline-delete]").forEach(button => button.addEventListener("click", () => {
      const airline = stateApi.getAirlineCatalog(appState).find(item => item.id === button.dataset.airlineDelete);
      if (window.confirm && !window.confirm(`Borrar la linea aerea ${airline?.name || "seleccionada"}?`)) return;
      stateApi.deleteAirline(appState, button.dataset.airlineDelete);
      BlessERP.layout.renderPage();
    }));
    container.querySelectorAll("[data-airline-field]").forEach(field => {
      const update = () => stateApi.updateAirlineDraftField(appState, field.dataset.airlineField, field.value);
      field.addEventListener(field.tagName === "SELECT" ? "change" : "input", update);
    });
  }

  function renderProductsPage(appState) {
    const product = data.products[0];
    const operationalStore = BlessERP.operacionesState?.getStore?.(appState);
    const operationalVarieties = (operationalStore?.masterData?.varieties || [])
      .filter(item => item.active !== false)
      .map(item => item.name)
      .filter(Boolean);
    const varieties = operationalVarieties.length ? operationalVarieties : data.varieties;

    return `
      <section class="page-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>Productos exportables</h1><p>Vista comercial alimentada por las variedades activas de Operaciones / Parametros de Poscosecha.</p></div>
        <div class="page-header-side"><span class="status-badge authorized">Fuente Operaciones</span></div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">PRODUCTO BASE Y VARIEDADES</p><h3>${utils.esc(product.name)}</h3><p class="panel-note">No es inventario de rosas. Para crear o editar variedades use Operaciones / Poscosecha → Parametros de Poscosecha.</p></div><span>${varieties.length} variedad(es) activa(s)</span></div>
        <div class="compact-table-wrap"><table class="compact-table commercial-products-table">
          <thead><tr><th>Variedad</th><th>Genero</th><th>Especie</th><th>HTS</th><th>NANDINA</th></tr></thead>
          <tbody>${varieties.map(item => `<tr><td>${utils.esc(item)}</td><td>${utils.esc(product.genus)}</td><td>${utils.esc(product.species)}</td><td>${utils.esc(product.hts)}</td><td>${utils.esc(product.nandina)}</td></tr>`).join("") || `<tr><td colspan="5">No existen variedades activas en Parametros de Poscosecha.</td></tr>`}</tbody>
        </table></div>
      </section>
    `;
  }

  function renderBoxTypesPage() {
    return `
      <section class="page-header">
        <div><p class="section-kicker">ADMINISTRACION COMERCIAL</p><h1>Tipos de caja</h1><p>Equivalencias, pesos y nombres alternos predeterminados para pedidos, coordinacion y reportes.</p></div>
        <div class="page-header-side"><span class="status-badge partial">Catalogo predeterminado</span></div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">TIPOS DE BOX</p><h3>Catalogo base</h3><p class="panel-note">Estos valores alimentan directamente el Tipo de caja del Pedido Maestro y el calculo de full equivalente.</p></div><span>${data.boxTypes.length} tipo(s)</span></div>
        <div class="compact-table-wrap"><table class="compact-table commercial-box-types-table">
          <thead><tr><th>Codigo</th><th>Caja</th><th>Conversion</th><th>Peso neto</th><th>Peso bruto</th><th>Nombre alterno</th></tr></thead>
          <tbody>${data.boxTypes.map(item => `<tr><td>${utils.esc(item.code)}</td><td>${utils.esc(item.name)}</td><td>${utils.esc(item.fullEquivalent)}</td><td>${utils.esc(item.netWeight)}</td><td>${utils.esc(item.grossWeight)}</td><td>${utils.esc(item.alternateName)}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>
    `;
  }

  BlessERP.comercialCatalogs = {
    bindAgenciesPage,
    bindAirlinesPage,
    bindBrandsPage,
    bindCustomersPage,
    bindDaesPage,
    bindDestinationsPage,
    renderAgenciesPage,
    renderAirlinesPage,
    renderCustomersBrandsPage,
    renderBrandsPage,
    renderBoxTypesPage,
    renderDaesPage,
    renderDestinationsPage,
    renderProductsPage
  };
})();
