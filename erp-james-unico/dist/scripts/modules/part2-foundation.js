(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc } = BlessERP.utils;
  const companyService = BlessERP.services.companySettings;
  const chartService = BlessERP.services.chartOfAccounts;

  const uiState = {
    companyMessage: "",
    companyErrors: [],
    accountSearch: "",
    accountType: "",
    accountStatus: "",
    accountMessage: "",
    accountErrors: [],
    editingAccountId: "",
    accountDraft: null
  };

  const companyFields = [
    { name: "ruc", label: "RUC" },
    { name: "legalName", label: "Razon social" },
    { name: "commercialName", label: "Nombre comercial" },
    { name: "matrixAddress", label: "Direccion matriz", full: true },
    { name: "branchAddress", label: "Direccion establecimiento", full: true },
    { name: "phone", label: "Telefono" },
    { name: "email", label: "Correo" },
    { name: "accountingRequired", label: "Obligado a llevar contabilidad", type: "select", options: ["Si", "No"] },
    { name: "taxRegime", label: "Regimen tributario" },
    { name: "baseCurrency", label: "Moneda base", type: "select", options: ["USD", "EUR"] },
    { name: "activePeriod", label: "Periodo contable activo" },
    { name: "periodLabel", label: "Nombre del periodo" },
    { name: "periodStart", label: "Fecha inicio periodo", type: "date" },
    { name: "periodEnd", label: "Fecha fin periodo", type: "date" },
    { name: "periodStatus", label: "Estado del periodo", type: "select", options: ["Abierto", "Cerrado"] },
    { name: "sriEnvironment", label: "Ambiente SRI", type: "select", options: ["Pruebas", "Produccion"] },
    { name: "mainEstablishment", label: "Establecimiento principal" },
    { name: "mainEmissionPoint", label: "Punto de emision principal" }
  ];

  const accountTypes = ["Activo", "Pasivo", "Patrimonio", "Ingreso", "Costo", "Gasto", "Orden"];
  const accountNatures = ["Deudora", "Acreedora"];

  function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (value.includes("futura")) return "cancelled";
    if (value.includes("inactiva") || value.includes("bloqueado")) return "cancelled";
    if (value.includes("pendiente")) return "pending";
    if (value.includes("activa") || value.includes("completo")) return "authorized";
    return "partial";
  }

  function draftAccount() {
    return {
      id: "",
      code: "",
      name: "",
      type: "",
      nature: "",
      level: 1,
      parentCode: "",
      isMovement: false,
      acceptsCostCenter: false,
      requiresAuxiliary: false,
      status: "Activa",
      notes: ""
    };
  }

  function renderCompanyForm(route) {
    const settings = companyService.settings();
    const defaults = settings.defaultAccounts || {};
    const missing = companyService.missingDefaultAccounts(settings);
    const accountOptions = chartService.sortAccounts(chartService.movementOptions());

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge ${missing.length ? "pending" : "authorized"}">${missing.length ? "Revisar configuracion" : "Configuracion base lista"}</span>
        </div>
      </section>
      <div class="subnav-tabs">
        ${BlessERP.navigation.groupMap[route.groupId].routes.map(item => `
          <button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
      ${missing.length ? `
        <section class="future-banner compact-warning">
          <div>
            <strong>Hay cuentas predeterminadas sin configurar</strong>
            <span>${esc(missing.map(item => item.label).join(", "))}</span>
          </div>
        </section>
      ` : ""}
      ${uiState.companyMessage ? `<section class="inline-feedback success">${esc(uiState.companyMessage)}</section>` : ""}
      ${uiState.companyErrors.length ? `<section class="inline-feedback danger">${uiState.companyErrors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">EMPRESA</p>
              <h3>Parametros generales</h3>
            </div>
            <button class="secondary-button" type="button" data-company-save>Guardar parametros</button>
          </div>
          <form id="company-settings-form" class="compact-form-grid">
            ${companyFields.map(field => `
              <label class="compact-field ${field.full ? "full" : ""}">
                <span>${esc(field.label)}</span>
                ${field.type === "select" ? `
                  <select name="${esc(field.name)}">
                    ${field.options.map(option => `<option value="${esc(option)}" ${settings[field.name] === option ? "selected" : ""}>${esc(option)}</option>`).join("")}
                  </select>
                ` : `
                  <input name="${esc(field.name)}" type="${field.type || "text"}" value="${esc(settings[field.name] || "")}">
                `}
              </label>
            `).join("")}
          </form>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CONTABLE</p>
              <h3>Cuentas predeterminadas</h3>
            </div>
            <button class="secondary-button" type="button" data-company-save>Guardar seleccion</button>
          </div>
          <form id="company-default-accounts-form" class="compact-form-grid">
            ${companyService.accountFields.map(field => `
              <label class="compact-field">
                <span>${esc(field.label)}</span>
                <select name="${esc(field.key)}">
                  <option value="">Seleccionar cuenta</option>
                  ${accountOptions.map(account => `<option value="${esc(account.code)}" ${defaults[field.key] === account.code ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
                </select>
              </label>
            `).join("")}
          </form>
        </article>
      </section>
    `;
  }

  function filteredAccounts() {
    return chartService.sortAccounts(chartService.all()).filter(account => {
      const search = uiState.accountSearch.trim().toLowerCase();
      const haystack = [account.code, account.name, account.type, account.notes].join(" ").toLowerCase();
      return (!search || haystack.includes(search))
        && (!uiState.accountType || account.type === uiState.accountType)
        && (!uiState.accountStatus || account.status === uiState.accountStatus);
    });
  }

  function startEditAccount(account = null) {
    uiState.accountErrors = [];
    uiState.accountMessage = "";
    uiState.editingAccountId = account?.id || "";
    uiState.accountDraft = account ? BlessERP.utils.clone(account) : draftAccount();
  }

  function renderAccountEditor() {
    const account = uiState.accountDraft;
    if (!account) return "";
    const options = chartService.sortAccounts(chartService.all()).filter(item => item.id !== account.id);
    const liveLevel = chartService.levelFromCode(account.code || "");
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">EDICION</p>
            <h3>${account.id ? "Editar cuenta" : "Nueva cuenta"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-account-cancel>Cancelar</button>
            <button class="secondary-button" type="button" data-account-save>Guardar cuenta</button>
          </div>
        </div>
        ${uiState.accountErrors.length ? `<section class="inline-feedback danger">${uiState.accountErrors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
        <form id="chart-account-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo</span><input name="code" value="${esc(account.code)}"></label>
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(account.name)}"></label>
          <label class="compact-field">
            <span>Tipo</span>
            <select name="type">
              <option value="">Seleccionar</option>
              ${accountTypes.map(option => `<option value="${esc(option)}" ${account.type === option ? "selected" : ""}>${esc(option)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Naturaleza</span>
            <select name="nature">
              <option value="">Seleccionar</option>
              ${accountNatures.map(option => `<option value="${esc(option)}" ${account.nature === option ? "selected" : ""}>${esc(option)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Cuenta padre</span>
            <select name="parentCode">
              <option value="">Sin cuenta padre</option>
              ${options.map(option => `<option value="${esc(option.code)}" ${account.parentCode === option.code ? "selected" : ""}>${esc(option.code)} - ${esc(option.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Nivel</span><input value="${esc(String(liveLevel || 1))}" readonly></label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              <option value="Activa" ${account.status === "Activa" ? "selected" : ""}>Activa</option>
              <option value="Inactiva" ${account.status === "Inactiva" ? "selected" : ""}>Inactiva</option>
            </select>
          </label>
          <label class="compact-field full">
            <span>Descripcion / notas</span>
            <textarea name="notes" rows="3">${esc(account.notes || "")}</textarea>
          </label>
          <label class="toggle-field"><input type="checkbox" name="isMovement" ${account.isMovement ? "checked" : ""}> <span>Es cuenta de movimiento</span></label>
          <label class="toggle-field"><input type="checkbox" name="acceptsCostCenter" ${account.acceptsCostCenter ? "checked" : ""}> <span>Acepta centro de costo</span></label>
          <label class="toggle-field"><input type="checkbox" name="requiresAuxiliary" ${account.requiresAuxiliary ? "checked" : ""}> <span>Requiere auxiliar</span></label>
        </form>
      </article>
    `;
  }

  function renderChart(route) {
    const accounts = filteredAccounts();
    const summaryWarning = companyService.missingDefaultAccounts().length;
    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge ${summaryWarning ? "pending" : "authorized"}">${summaryWarning ? "Faltan cuentas por configurar" : "Base contable activa"}</span>
        </div>
      </section>
      <div class="subnav-tabs">
        ${BlessERP.navigation.groupMap[route.groupId].routes.map(item => `
          <button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
      ${uiState.accountMessage ? `<section class="inline-feedback success">${esc(uiState.accountMessage)}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="chart-search" placeholder="Codigo o nombre" value="${esc(uiState.accountSearch)}">
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="chart-type-filter">
              <option value="">Todos</option>
              ${accountTypes.map(option => `<option value="${esc(option)}" ${uiState.accountType === option ? "selected" : ""}>${esc(option)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="chart-status-filter">
              <option value="">Todos</option>
              <option value="Activa" ${uiState.accountStatus === "Activa" ? "selected" : ""}>Activa</option>
              <option value="Inactiva" ${uiState.accountStatus === "Inactiva" ? "selected" : ""}>Inactiva</option>
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-account-new>Nueva cuenta</button>
            <button class="secondary-button" type="button" data-account-export>Exportar</button>
          </div>
        </div>
      </section>
      ${renderAccountEditor()}
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CUENTAS</p>
            <h3>Plan de cuentas</h3>
          </div>
          <span class="status-badge partial">${esc(String(accounts.length))} cuentas visibles</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Cuenta</th>
                <th>Tipo</th>
                <th>Naturaleza</th>
                <th>Nivel</th>
                <th>Movimiento</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${accounts.map(account => `
                <tr>
                  <td><strong>${esc(account.code)}</strong></td>
                  <td>
                    <div class="account-cell" style="--account-level:${Math.max(0, Number(account.level || 1) - 1)}">
                      <span class="account-name ${account.isMovement ? "movement" : "parent"}">${esc(account.name)}</span>
                      <small>${esc(account.notes || "")}</small>
                    </div>
                  </td>
                  <td>${esc(account.type)}</td>
                  <td>${esc(account.nature)}</td>
                  <td>${esc(String(account.level || ""))}</td>
                  <td>${account.isMovement ? "Si" : "No"}</td>
                  <td><span class="status-badge ${account.status === "Activa" ? "authorized" : "cancelled"}">${esc(account.status)}</span></td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-account-edit="${esc(account.id)}">Editar</button>
                      <button class="row-action-button" type="button" data-account-toggle="${esc(account.id)}">${account.status === "Activa" ? "Inactivar" : "Activar"}</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay cuentas para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function validateCompany(settings) {
    const errors = [];
    if (!String(settings.ruc || "").trim()) errors.push("El RUC es obligatorio.");
    if (!String(settings.legalName || "").trim()) errors.push("La razón social es obligatoria.");
    if (!String(settings.commercialName || "").trim()) errors.push("El nombre comercial es obligatorio.");
    if (!String(settings.baseCurrency || "").trim()) errors.push("La moneda base es obligatoria.");
    if (!String(settings.activePeriod || "").trim()) errors.push("El periodo contable activo es obligatorio.");
    if (!String(settings.periodStart || "").trim()) errors.push("La fecha inicial del periodo es obligatoria.");
    if (!String(settings.periodEnd || "").trim()) errors.push("La fecha final del periodo es obligatoria.");
    return errors;
  }

  function collectCompanyForm() {
    const mainForm = document.querySelector("#company-settings-form");
    const defaultForm = document.querySelector("#company-default-accounts-form");
    const current = companyService.settings();
    const next = BlessERP.utils.clone(current);

    companyFields.forEach(field => {
      const node = mainForm?.elements?.[field.name];
      next[field.name] = node ? node.value : current[field.name];
    });

    next.defaultAccounts = { ...(current.defaultAccounts || {}) };
    companyService.accountFields.forEach(field => {
      const node = defaultForm?.elements?.[field.key];
      next.defaultAccounts[field.key] = node ? node.value : next.defaultAccounts[field.key];
    });

    return next;
  }

  function bindCompanyPage() {
    document.querySelectorAll("[data-company-save]").forEach(button => button.addEventListener("click", () => {
      const next = collectCompanyForm();
      const errors = validateCompany(next);
      uiState.companyErrors = errors;
      uiState.companyMessage = "";
      if (errors.length) {
        BlessERP.layout.renderPage();
        return;
      }
      companyService.save(next);
      uiState.companyMessage = "Parametros generales guardados correctamente.";
      BlessERP.layout.renderApp();
    }));
  }

  function readAccountDraftFromForm() {
    const form = document.querySelector("#chart-account-form");
    if (!form || !uiState.accountDraft) return uiState.accountDraft;
    const draft = BlessERP.utils.clone(uiState.accountDraft);
    draft.code = form.elements.code.value;
    draft.name = form.elements.name.value;
    draft.type = form.elements.type.value;
    draft.nature = form.elements.nature.value;
    draft.parentCode = form.elements.parentCode.value;
    draft.status = form.elements.status.value;
    draft.notes = form.elements.notes.value;
    draft.isMovement = form.elements.isMovement.checked;
    draft.acceptsCostCenter = form.elements.acceptsCostCenter.checked;
    draft.requiresAuxiliary = form.elements.requiresAuxiliary.checked;
    draft.level = chartService.levelFromCode(draft.code);
    return draft;
  }

  function bindChartPage() {
    document.querySelector("#chart-search")?.addEventListener("input", event => {
      uiState.accountSearch = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#chart-type-filter")?.addEventListener("change", event => {
      uiState.accountType = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#chart-status-filter")?.addEventListener("change", event => {
      uiState.accountStatus = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-account-new]")?.addEventListener("click", () => {
      startEditAccount();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-account-export]")?.addEventListener("click", () => {
      uiState.accountMessage = "La exportacion quedara habilitada en una siguiente fase.";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-account-cancel]")?.addEventListener("click", () => {
      uiState.accountDraft = null;
      uiState.accountErrors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-account-save]")?.addEventListener("click", () => {
      const draft = readAccountDraftFromForm();
      const result = chartService.saveAccount(draft);
      uiState.accountErrors = result.errors || [];
      uiState.accountMessage = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.accountDraft = null;
      uiState.accountMessage = "Cuenta guardada correctamente.";
      BlessERP.layout.renderApp();
    });
    document.querySelectorAll("[data-account-edit]").forEach(button => button.addEventListener("click", () => {
      const account = chartService.all().find(item => item.id === button.dataset.accountEdit);
      if (!account) return;
      startEditAccount(account);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-account-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = chartService.toggleActive(button.dataset.accountToggle);
      uiState.accountMessage = result.ok ? "Estado de la cuenta actualizado." : (result.message || "No se pudo actualizar la cuenta.");
      uiState.accountErrors = [];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#chart-account-form")?.addEventListener("input", event => {
      if (!uiState.accountDraft) return;
      uiState.accountDraft = readAccountDraftFromForm();
      if (["code", "parentCode"].includes(event.target.name)) BlessERP.layout.renderPage();
    });
  }

  function renderCompany(container, route) {
    container.innerHTML = renderCompanyForm(route);
    bindCompanyPage();
  }

  function renderChartPage(container, route) {
    container.innerHTML = renderChart(route);
    bindChartPage();
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Foundation = {
    renderCompany,
    renderChartPage
  };
})();
