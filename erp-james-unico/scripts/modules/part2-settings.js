(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc } = BlessERP.utils;
  const navigation = BlessERP.navigation;
  const adminService = BlessERP.services.adminConfig;

  const uiState = {
    users: {
      search: "",
      status: "",
      message: "",
      errors: []
    },
    audit: {
      search: "",
      userId: "",
      module: "",
      action: "",
      result: "",
      dateFrom: "",
      dateTo: ""
    },
    sequences: {
      search: "",
      module: "",
      status: "",
      message: "",
      errors: [],
      draft: null
    },
    costCenters: {
      search: "",
      type: "",
      status: "",
      message: "",
      errors: [],
      draft: null
    }
  };

  function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (value.includes("activo") || value.includes("exitoso")) return "authorized";
    if (value.includes("inactivo") || value.includes("error")) return "cancelled";
    if (value.includes("bloqueado") || value.includes("pendiente")) return "pending";
    return "partial";
  }

  function moneylessDate(value = "") {
    if (!value) return "-";
    return String(value).replace("T", " ").slice(0, 16);
  }

  function renderTabs(route) {
    return `
      <div class="subnav-tabs">
        ${(navigation.groupMap[route.groupId]?.routes || []).map(item => `
          <button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function sequenceDraft(sequence = null) {
    return sequence ? BlessERP.utils.clone(sequence) : {
      id: "",
      code: "",
      name: "",
      prefix: "",
      year: "2026",
      month: "",
      currentNumber: 0,
      length: 6,
      reset: "anual",
      module: "",
      status: "activo",
      observation: ""
    };
  }

  function costCenterDraft(costCenter = null) {
    return costCenter ? BlessERP.utils.clone(costCenter) : {
      id: "",
      code: "",
      name: "",
      type: "administrativo",
      responsible: "",
      status: "activo",
      relatedAccount: "",
      observation: ""
    };
  }

  function renderUsers(container, route) {
    const activeUser = adminService.activeUser();
    const users = adminService.visualUsers({
      search: uiState.users.search,
      status: uiState.users.status
    });
    const activeCount = adminService.visualUsers({ status: "activo" }).length;

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Sin login real</span>
          <span class="status-badge authorized">Usuario activo: ${esc(activeUser.name)}</span>
        </div>
      </section>
      ${renderTabs(route)}
      <section class="future-banner compact-warning">
        <div>
          <strong>Roles y permisos se integraran despues</strong>
          <span>En esta fase solo se simula el usuario activo para auditoria. El control real vendra desde el sistema principal / Parte 1.</span>
        </div>
      </section>
      ${uiState.users.message ? `<section class="inline-feedback success">${esc(uiState.users.message)}</section>` : ""}
      ${uiState.users.errors.length ? `<section class="inline-feedback danger">${uiState.users.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="summary-grid summary-grid-settings">
        <article class="summary-card"><span>Usuarios visuales</span><strong>${esc(String(users.length))}</strong><small>Mostrados con filtro actual</small></article>
        <article class="summary-card"><span>Activos</span><strong>${esc(String(activeCount))}</strong><small>Disponibles para pruebas</small></article>
        <article class="summary-card"><span>Usuario temporal</span><strong>${esc(activeUser.name)}</strong><small>${esc(activeUser.area || activeUser.role || "-")}</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-settings-users">
          <label class="compact-inline-field"><span>Buscar</span><input id="settings-users-search" placeholder="Nombre, codigo, cargo o area" value="${esc(uiState.users.search)}"></label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="settings-users-status">
              <option value="">Todos</option>
              ${adminService.userStates.map(item => `<option value="${esc(item)}" ${uiState.users.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-settings-users-clear>Limpiar</button>
          </div>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">USUARIOS</p>
            <h3>Referencia visual para auditoria</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Cargo</th>
                <th>Area</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(user => `
                <tr>
                  <td><strong>${esc(user.code || "-")}</strong></td>
                  <td><strong>${esc(user.fullName || user.name)}</strong><small>${esc(user.name)}</small></td>
                  <td>${esc(user.email || "-")}</td>
                  <td>${esc(user.cargo || user.role || "-")}</td>
                  <td>${esc(user.area || "-")}</td>
                  <td><span class="status-badge ${statusClass(user.status)}">${esc(user.status)}</span></td>
                  <td>
                    ${activeUser.id === user.id
                      ? `<span class="status-badge authorized">Activo</span>`
                      : `<button class="row-action-button" type="button" data-set-active-user="${esc(user.id)}" ${user.status !== "activo" ? "disabled" : ""}>Usar</button>`}
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay usuarios visuales para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.querySelector("#settings-users-search")?.addEventListener("input", event => {
      uiState.users.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#settings-users-status")?.addEventListener("change", event => {
      uiState.users.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-settings-users-clear]")?.addEventListener("click", () => {
      uiState.users.search = "";
      uiState.users.status = "";
      uiState.users.message = "";
      uiState.users.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-set-active-user]").forEach(button => button.addEventListener("click", () => {
      const result = adminService.setActiveUser(button.dataset.setActiveUser);
      if (!result.ok) {
        uiState.users.errors = [result.message || "No se pudo cambiar el usuario activo."];
        uiState.users.message = "";
      } else {
        uiState.users.errors = [];
        uiState.users.message = `Usuario activo temporal: ${result.user.name}.`;
      }
      BlessERP.layout.renderApp();
    }));
  }

  function renderAudit(container, route) {
    const summary = adminService.auditSummary();
    const logs = adminService.auditLogs(uiState.audit);
    const userOptions = adminService.visualUsers();
    const modules = [...new Set(adminService.auditLogs().map(item => item.module).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const actions = [...new Set(adminService.auditLogs().map(item => item.action).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Historial no editable</span>
        </div>
      </section>
      ${renderTabs(route)}
      <section class="summary-grid summary-grid-settings">
        <article class="summary-card"><span>Total eventos</span><strong>${esc(String(summary.total))}</strong><small>Bitacora acumulada</small></article>
        <article class="summary-card"><span>Hoy</span><strong>${esc(String(summary.today))}</strong><small>Eventos del dia actual</small></article>
        <article class="summary-card"><span>Exitosos</span><strong>${esc(String(summary.success))}</strong><small>Acciones completadas</small></article>
        <article class="summary-card"><span>Bloqueados / error</span><strong>${esc(String(summary.blocked + summary.errors))}</strong><small>Validaciones o fallos registrados</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-settings-audit">
          <label class="compact-inline-field"><span>Buscar</span><input id="audit-search" placeholder="Documento, descripcion o usuario" value="${esc(uiState.audit.search)}"></label>
          <label class="compact-inline-field">
            <span>Usuario</span>
            <select id="audit-user">
              <option value="">Todos</option>
              ${userOptions.map(item => `<option value="${esc(item.id)}" ${uiState.audit.userId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Modulo</span>
            <select id="audit-module">
              <option value="">Todos</option>
              ${modules.map(item => `<option value="${esc(item)}" ${uiState.audit.module === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Accion</span>
            <select id="audit-action">
              <option value="">Todas</option>
              ${actions.map(item => `<option value="${esc(item)}" ${uiState.audit.action === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Resultado</span>
            <select id="audit-result">
              <option value="">Todos</option>
              ${adminService.auditResults.map(item => `<option value="${esc(item)}" ${uiState.audit.result === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Desde</span><input id="audit-from" type="date" value="${esc(uiState.audit.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Hasta</span><input id="audit-to" type="date" value="${esc(uiState.audit.dateTo)}"></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BITACORA</p>
            <h3>Eventos importantes del ERP</h3>
          </div>
          <span class="status-badge partial">${esc(String(logs.length))} resultados</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha / hora</th>
                <th>Usuario</th>
                <th>Modulo</th>
                <th>Accion</th>
                <th>Documento</th>
                <th>Estados</th>
                <th>Resultado</th>
                <th>Descripcion</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(item => `
                <tr>
                  <td>${esc(moneylessDate(item.createdAt))}</td>
                  <td><strong>${esc(item.userName || "-")}</strong><small>${esc(item.userRole || item.userArea || "-")}</small></td>
                  <td>${esc(item.module || "-")}</td>
                  <td>${esc(item.action || "-")}</td>
                  <td><strong>${esc(item.documentLabel || item.entityLabel || "-")}</strong><small>${esc(item.entityType || "-")}</small></td>
                  <td>${esc(item.previousStatus || "-")} ${item.nextStatus ? `→ ${esc(item.nextStatus)}` : ""}</td>
                  <td><span class="status-badge ${statusClass(item.result)}">${esc(item.result)}</span></td>
                  <td>${esc(item.description || item.reason || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay eventos para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;

    [
      ["#audit-search", "search"],
      ["#audit-user", "userId"],
      ["#audit-module", "module"],
      ["#audit-action", "action"],
      ["#audit-result", "result"],
      ["#audit-from", "dateFrom"],
      ["#audit-to", "dateTo"]
    ].forEach(([selector, key]) => {
      document.querySelector(selector)?.addEventListener(selector.includes("search") ? "input" : "change", event => {
        uiState.audit[key] = event.target.value;
        BlessERP.layout.renderPage();
      });
    });
  }

  function renderSequenceEditor() {
    if (!uiState.sequences.draft) return "";
    const draft = uiState.sequences.draft;
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">EDICION</p>
            <h3>${draft.id ? "Editar secuencial" : "Nuevo secuencial"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-sequence-cancel>Cancelar</button>
            <button class="secondary-button" type="button" data-sequence-save>Guardar</button>
          </div>
        </div>
        ${uiState.sequences.errors.length ? `<section class="inline-feedback danger">${uiState.sequences.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
        <form id="sequence-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo</span><input name="code" value="${esc(draft.code)}"></label>
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(draft.name)}"></label>
          <label class="compact-field"><span>Prefijo</span><input name="prefix" value="${esc(draft.prefix)}"></label>
          <label class="compact-field"><span>Modulo</span><input name="module" value="${esc(draft.module)}"></label>
          <label class="compact-field"><span>Ano</span><input name="year" value="${esc(draft.year)}"></label>
          <label class="compact-field"><span>Mes</span><input name="month" value="${esc(draft.month)}" placeholder="Opcional"></label>
          <label class="compact-field"><span>Numero actual</span><input name="currentNumber" type="number" min="0" value="${esc(String(draft.currentNumber))}"></label>
          <label class="compact-field"><span>Longitud</span><input name="length" type="number" min="3" value="${esc(String(draft.length))}"></label>
          <label class="compact-field">
            <span>Reinicio</span>
            <select name="reset">
              ${adminService.sequenceResets.map(item => `<option value="${esc(item)}" ${draft.reset === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              ${adminService.sequenceStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="3">${esc(draft.observation || "")}</textarea></label>
        </form>
      </article>
    `;
  }

  function renderSequences(container, route) {
    const rows = adminService.sequences({
      search: uiState.sequences.search,
      module: uiState.sequences.module,
      status: uiState.sequences.status
    });
    const activeRows = adminService.sequences({ status: "activo" });
    const modules = [...new Set(adminService.sequences().map(item => item.module).filter(Boolean))];

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Preparado para integracion total</span>
        </div>
      </section>
      ${renderTabs(route)}
      ${uiState.sequences.message ? `<section class="inline-feedback success">${esc(uiState.sequences.message)}</section>` : ""}
      <section class="summary-grid summary-grid-settings">
        <article class="summary-card"><span>Secuenciales</span><strong>${esc(String(rows.length))}</strong><small>Segun filtros actuales</small></article>
        <article class="summary-card"><span>Activos</span><strong>${esc(String(activeRows.length))}</strong><small>Disponibles para generar vistas previas</small></article>
        <article class="summary-card"><span>Proximo asiento</span><strong>${esc(adminService.formatSequencePreview(adminService.findSequenceByCode("ASI") || {}))}</strong><small>Vista previa interna</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-settings-sequences">
          <label class="compact-inline-field"><span>Buscar</span><input id="sequence-search" placeholder="Codigo, nombre o prefijo" value="${esc(uiState.sequences.search)}"></label>
          <label class="compact-inline-field">
            <span>Modulo</span>
            <select id="sequence-module">
              <option value="">Todos</option>
              ${modules.map(item => `<option value="${esc(item)}" ${uiState.sequences.module === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="sequence-status">
              <option value="">Todos</option>
              ${adminService.sequenceStates.map(item => `<option value="${esc(item)}" ${uiState.sequences.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-sequence-new>Nuevo</button>
          </div>
        </div>
      </section>
      ${renderSequenceEditor()}
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CATALOGO</p>
            <h3>Secuenciales internos del ERP</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Prefijo</th>
                <th>Modulo</th>
                <th>Actual</th>
                <th>Vista previa</th>
                <th>Reinicio</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td><strong>${esc(item.code)}</strong></td>
                  <td>${esc(item.name)}</td>
                  <td>${esc(item.prefix)}</td>
                  <td>${esc(item.module || "-")}</td>
                  <td>${esc(String(item.currentNumber))}</td>
                  <td><strong>${esc(adminService.formatSequencePreview(item))}</strong></td>
                  <td>${esc(item.reset)}</td>
                  <td><span class="status-badge ${statusClass(item.status)}">${esc(item.status)}</span></td>
                  <td><button class="row-action-button" type="button" data-sequence-edit="${esc(item.id)}">Editar</button></td>
                </tr>
              `).join("") || `<tr><td colspan="9"><div class="empty-inline">No hay secuenciales para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.querySelector("#sequence-search")?.addEventListener("input", event => {
      uiState.sequences.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#sequence-module")?.addEventListener("change", event => {
      uiState.sequences.module = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#sequence-status")?.addEventListener("change", event => {
      uiState.sequences.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-sequence-new]")?.addEventListener("click", () => {
      uiState.sequences.draft = sequenceDraft();
      uiState.sequences.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-sequence-cancel]")?.addEventListener("click", () => {
      uiState.sequences.draft = null;
      uiState.sequences.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-sequence-save]")?.addEventListener("click", () => {
      const form = document.querySelector("#sequence-form");
      const data = Object.fromEntries(new FormData(form).entries());
      const result = adminService.saveSequence({
        ...uiState.sequences.draft,
        ...data,
        currentNumber: Number(data.currentNumber || 0),
        length: Number(data.length || 6)
      });
      if (!result.ok) {
        uiState.sequences.errors = result.errors || ["No se pudo guardar el secuencial."];
      } else {
        uiState.sequences.errors = [];
        uiState.sequences.draft = null;
        uiState.sequences.message = `Secuencial ${result.sequence.code} guardado correctamente.`;
      }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-sequence-edit]").forEach(button => button.addEventListener("click", () => {
      const current = adminService.sequences().find(item => item.id === button.dataset.sequenceEdit);
      uiState.sequences.draft = sequenceDraft(current);
      uiState.sequences.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  function renderCostCenterEditor() {
    if (!uiState.costCenters.draft) return "";
    const draft = uiState.costCenters.draft;
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">EDICION</p>
            <h3>${draft.id ? "Editar centro de costo" : "Nuevo centro de costo"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-cost-center-cancel>Cancelar</button>
            <button class="secondary-button" type="button" data-cost-center-save>Guardar</button>
          </div>
        </div>
        ${uiState.costCenters.errors.length ? `<section class="inline-feedback danger">${uiState.costCenters.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
        <form id="cost-center-form" class="compact-form-grid">
          <label class="compact-field"><span>Codigo</span><input name="code" value="${esc(draft.code)}"></label>
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(draft.name)}"></label>
          <label class="compact-field">
            <span>Tipo</span>
            <select name="type">
              ${adminService.costCenterTypes.map(item => `<option value="${esc(item)}" ${draft.type === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Responsable</span><input name="responsible" value="${esc(draft.responsible)}"></label>
          <label class="compact-field"><span>Cuenta / grupo relacionado</span><input name="relatedAccount" value="${esc(draft.relatedAccount)}"></label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status">
              ${adminService.costCenterStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="3">${esc(draft.observation || "")}</textarea></label>
        </form>
      </article>
    `;
  }

  function renderCostCenters(container, route) {
    const rows = adminService.costCenters({
      search: uiState.costCenters.search,
      type: uiState.costCenters.type,
      status: uiState.costCenters.status
    });
    const activeRows = adminService.costCenters({ status: "activo" });

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Usables en diario, compras, bancos e inventario</span>
        </div>
      </section>
      ${renderTabs(route)}
      ${uiState.costCenters.message ? `<section class="inline-feedback success">${esc(uiState.costCenters.message)}</section>` : ""}
      <section class="summary-grid summary-grid-settings">
        <article class="summary-card"><span>Centros</span><strong>${esc(String(rows.length))}</strong><small>Segun filtros actuales</small></article>
        <article class="summary-card"><span>Activos</span><strong>${esc(String(activeRows.length))}</strong><small>Disponibles para uso operativo</small></article>
        <article class="summary-card"><span>Tipos</span><strong>${esc(String(adminService.costCenterTypes.length))}</strong><small>Clasificaciones base</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-settings-cost-centers">
          <label class="compact-inline-field"><span>Buscar</span><input id="cost-center-search" placeholder="Codigo, nombre o responsable" value="${esc(uiState.costCenters.search)}"></label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="cost-center-type">
              <option value="">Todos</option>
              ${adminService.costCenterTypes.map(item => `<option value="${esc(item)}" ${uiState.costCenters.type === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="cost-center-status">
              <option value="">Todos</option>
              ${adminService.costCenterStates.map(item => `<option value="${esc(item)}" ${uiState.costCenters.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-cost-center-new>Nuevo</button>
          </div>
        </div>
      </section>
      ${renderCostCenterEditor()}
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CATALOGO</p>
            <h3>Centros de costo base</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Responsable</th>
                <th>Cuenta</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td><strong>${esc(item.code)}</strong></td>
                  <td>${esc(item.name)}</td>
                  <td>${esc(item.type)}</td>
                  <td>${esc(item.responsible || "-")}</td>
                  <td>${esc(item.relatedAccount || "-")}</td>
                  <td><span class="status-badge ${statusClass(item.status)}">${esc(item.status)}</span></td>
                  <td class="table-actions-inline">
                    <button class="row-action-button" type="button" data-cost-center-edit="${esc(item.id)}">Editar</button>
                    <button class="row-action-button" type="button" data-cost-center-toggle="${esc(item.id)}">${item.status === "activo" ? "Inactivar" : "Activar"}</button>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay centros de costo para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.querySelector("#cost-center-search")?.addEventListener("input", event => {
      uiState.costCenters.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#cost-center-type")?.addEventListener("change", event => {
      uiState.costCenters.type = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#cost-center-status")?.addEventListener("change", event => {
      uiState.costCenters.status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-cost-center-new]")?.addEventListener("click", () => {
      uiState.costCenters.draft = costCenterDraft();
      uiState.costCenters.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-cost-center-cancel]")?.addEventListener("click", () => {
      uiState.costCenters.draft = null;
      uiState.costCenters.errors = [];
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-cost-center-save]")?.addEventListener("click", () => {
      const form = document.querySelector("#cost-center-form");
      const result = adminService.saveCostCenter({
        ...uiState.costCenters.draft,
        ...Object.fromEntries(new FormData(form).entries())
      });
      if (!result.ok) {
        uiState.costCenters.errors = result.errors || ["No se pudo guardar el centro de costo."];
      } else {
        uiState.costCenters.errors = [];
        uiState.costCenters.draft = null;
        uiState.costCenters.message = `Centro de costo ${result.costCenter.code} guardado correctamente.`;
      }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-cost-center-edit]").forEach(button => button.addEventListener("click", () => {
      const current = adminService.costCenters().find(item => item.id === button.dataset.costCenterEdit);
      uiState.costCenters.draft = costCenterDraft(current);
      uiState.costCenters.errors = [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-cost-center-toggle]").forEach(button => button.addEventListener("click", () => {
      const result = adminService.toggleCostCenterStatus(button.dataset.costCenterToggle);
      if (result.ok) uiState.costCenters.message = `Centro de costo ${result.costCenter.code} actualizado a ${result.costCenter.status}.`;
      BlessERP.layout.renderPage();
    }));
  }

  function render(container, route) {
    adminService.ensureStore();
    if (route.id === "settings-users") return renderUsers(container, route);
    if (route.id === "settings-audit") return renderAudit(container, route);
    if (route.id === "settings-sequences") return renderSequences(container, route);
    if (route.id === "settings-cost-centers") return renderCostCenters(container, route);
    return false;
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Settings = { render };
})();
