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
      errors: [],
      draft: null,
      accessCompanyId: "",
      preview: null,
      password: "",
      passwordConfirmation: "",
      unlinkedUsers: [],
      profilesByCompany: {},
      unlinkedLoaded: false,
      unlinkedLoading: false
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
    const db = BlessERP.state?.state?.db;
    return `
      <div class="subnav-tabs">
        ${(navigation.groupMap[route.groupId]?.routes || [])
          .filter(item => BlessERP.menuService?.canCurrentUserAccessRoute?.(item.id, db) !== false)
          .map(item => `
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
      documentType: "",
      environment: "",
      establishmentCode: "",
      emissionPointCode: "",
      configurationStatus: "",
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

  function userAccessFor(draft, companyId) {
    draft.companyAccess = draft.companyAccess || {};
    if (!draft.companyAccess[companyId]) {
      draft.companyAccess[companyId] = {
        enabled: false,
        status: "inactivo",
        roleCode: "INVITADO",
        membershipRole: "VIEWER",
        profileId: "",
        profileName: "PROFILE_MISSING",
        profileState: "PROFILE_MISSING",
        legacyRoutePermissionCount: 0,
        legacyDependent: false,
        routeAccess: {}
      };
    }
    draft.companyAccess[companyId].routeAccess = draft.companyAccess[companyId].routeAccess || {};
    return draft.companyAccess[companyId];
  }

  function userRoleLabel(roleCode) {
    return BlessERP.menuService?.ROLE_LABELS?.[roleCode] || roleCode || "Sin rol";
  }

  function membershipRoleLabel(roleCode) {
    return ({ OWNER: "Propietario", ADMIN: "Administrador", EDITOR: "Editor", VIEWER: "Consulta" })[
      String(roleCode || "VIEWER").toUpperCase()
    ] || "Consulta";
  }

  function membershipRoleAsLegacyRole(roleCode) {
    const role = String(roleCode || "VIEWER").toUpperCase();
    if (["OWNER", "ADMIN"].includes(role)) return "ADMIN";
    if (role === "EDITOR") return "SOPORTE";
    return "INVITADO";
  }

  function canonicalProfilesFor(companyId) {
    return Array.isArray(uiState.users.profilesByCompany?.[companyId])
      ? uiState.users.profilesByCompany[companyId].filter(profile => profile.active !== false)
      : [];
  }

  function userRouteMatrix(draft, companyId) {
    const membership = userAccessFor(draft, companyId);
    const inheritedUser = BlessERP.utils.clone(draft);
    userAccessFor(inheritedUser, companyId).routeAccess = {};
    const inherited = new Set(
      (BlessERP.menuService?.getVisiblePagesForUser?.(inheritedUser, companyId) || []).map(item => item.ruta)
    );
    const effective = new Set(
      (BlessERP.menuService?.getVisiblePagesForUser?.(draft, companyId) || []).map(item => item.ruta)
    );
    return (BlessERP.menuService?.getCompanyAvailablePages?.(companyId) || []).map(page => {
      const route = navigation.routeMap[page.ruta] || {};
      const override = membership.routeAccess[page.ruta];
      return {
        id: page.ruta,
        label: route.label || page.nombre || page.ruta,
        menuLabel: route.menuLabel || "General",
        groupLabel: route.groupLabel || route.menuLabel || "General",
        inherited: inherited.has(page.ruta),
        effective: effective.has(page.ruta),
        override: override === true ? "allow" : override === false ? "deny" : "inherit"
      };
    });
  }

  function groupRouteMatrix(rows) {
    const groups = new Map();
    rows.forEach(row => {
      const key = `${row.menuLabel} / ${row.groupLabel}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return [...groups.entries()];
  }

  function syncUserDraftFromForm() {
    const form = document.querySelector("#user-access-form");
    if (!form || !uiState.users.draft) return;
    const data = Object.fromEntries(new FormData(form).entries());
    uiState.users.password = String(document.querySelector("#settings-user-password")?.value || "");
    uiState.users.passwordConfirmation = String(document.querySelector("#settings-user-password-confirmation")?.value || "");
    uiState.users.draft = {
      ...uiState.users.draft,
      code: String(data.code || "").trim(),
      name: String(data.fullName || "").trim(),
      fullName: String(data.fullName || "").trim(),
      email: String(data.email || "").trim(),
      username: String(data.username || "").trim(),
      role: String(data.cargo || "").trim(),
      cargo: String(data.cargo || "").trim(),
      area: String(data.area || "").trim(),
      status: data.status || "activo",
      observation: String(data.observation || "").trim(),
      changeReason: String(data.changeReason || "").trim()
    };
  }

  function renderUserRouteGroups(draft, companyId, membership) {
    const routeRows = userRouteMatrix(draft, companyId);
    return groupRouteMatrix(routeRows).map(([groupLabel, items]) => `
      <section class="user-route-group">
        <h5>${esc(groupLabel)}</h5>
        <div class="user-route-list">
          ${items.map(item => `
            <label class="user-route-row">
              <span>
                <strong>${esc(item.label)}</strong>
                <small>${item.inherited ? "Permitido por rol" : "No incluido en el rol"}</small>
              </span>
              <span class="status-badge ${item.effective ? "authorized" : "cancelled"}">${item.effective ? "Visible" : "Oculto"}</span>
              <select data-user-route-access="${esc(item.id)}" ${membership.enabled && membership.status === "activo" ? "" : "disabled"}>
                <option value="inherit" ${item.override === "inherit" ? "selected" : ""}>Por rol</option>
                <option value="allow" ${item.override === "allow" ? "selected" : ""}>Permitir</option>
                <option value="deny" ${item.override === "deny" ? "selected" : ""}>Ocultar</option>
              </select>
            </label>
          `).join("")}
        </div>
      </section>
    `).join("") || `<div class="empty-inline">Esta empresa no tiene rutas habilitadas para asignar.</div>`;
  }

  function renderUserEditor() {
    const draft = uiState.users.draft;
    if (!draft) return "";
    const companies = adminService.companyProfiles();
    const selectedCompanyId = uiState.users.accessCompanyId || companies[0]?.id || "";
    uiState.users.accessCompanyId = selectedCompanyId;
    const membership = userAccessFor(draft, selectedCompanyId);
    const currentUserId = BlessERP.state.state.db.session?.activeUser?.id;
    const stored = draft.id ? adminService.findUser(draft.id) : null;
    const remoteCanonical = BlessERP.remoteUserAccess?.enabled?.() === true;
    const canonicalProfiles = canonicalProfilesFor(selectedCompanyId);

    return `
      <section class="panel-card user-access-editor">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">USUARIO Y ACCESOS</p>
            <h3>${stored ? "Editar usuario" : "Nuevo usuario"}</h3>
            <small>${remoteCanonical ? "Los permisos efectivos se derivan exclusivamente del perfil canónico asignado por empresa." : "Los permisos individuales nunca pueden superar las funciones habilitadas para cada empresa."}</small>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-user-cancel>Cancelar</button>
            ${stored ? `<button class="danger-button" type="button" data-user-delete ${draft.id === currentUserId ? "disabled" : ""}>Eliminar</button>` : ""}
            ${remoteCanonical ? "" : `<button class="primary-button" type="button" data-user-preview>Vista previa</button>`}
            <button class="primary-button" type="button" data-user-save>${stored ? "Guardar" : (remoteCanonical ? "Crear e invitar" : "Guardar")}</button>
          </div>
        </div>
        ${uiState.users.errors.length ? `<section class="inline-feedback danger">${uiState.users.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
        <form id="user-access-form" class="compact-form-grid user-profile-form">
          <label class="compact-field"><span>Codigo</span><input name="code" value="${esc(draft.code || "")}" required></label>
          <label class="compact-field"><span>Nombres y apellidos</span><input name="fullName" value="${esc(draft.fullName || draft.name || "")}" required></label>
          <label class="compact-field"><span>Usuario de ingreso</span><input name="username" autocomplete="username" value="${esc(draft.username || draft.code || "")}" required></label>
          <label class="compact-field"><span>Correo</span><input name="email" type="email" value="${esc(draft.email || "")}"></label>
          ${window.__ERP_LOCAL_MODE__ === true ? `
            <label class="compact-field">
              <span>${stored ? "Nueva contraseña (opcional)" : "Contraseña inicial"}</span>
              <input id="settings-user-password" type="password" autocomplete="new-password" minlength="12" value="${esc(uiState.users.password)}" placeholder="12 caracteres, mayúscula, número y símbolo">
            </label>
            <label class="compact-field">
              <span>Confirmar contraseña</span>
              <input id="settings-user-password-confirmation" type="password" autocomplete="new-password" minlength="12" value="${esc(uiState.users.passwordConfirmation)}">
            </label>
            <small class="compact-field full">La contraseña se guarda localmente con hash PBKDF2 y nunca se muestra nuevamente.</small>
          ` : ""}
          ${BlessERP.remoteUserAccess?.enabled?.() ? `<small class="compact-field full">Al crear el usuario se enviará una invitación al correo. El usuario definirá su primera contraseña en la ruta segura Crear contraseña.</small>` : ""}
          <label class="compact-field"><span>Cargo</span><input name="cargo" value="${esc(draft.cargo || "")}" required></label>
          <label class="compact-field"><span>Area</span><input name="area" value="${esc(draft.area || "")}"></label>
          <label class="compact-field">
            <span>${remoteCanonical ? "Estado de identidad (informativo)" : "Estado general"}</span>
            <select name="status" ${remoteCanonical ? "disabled" : ""}>
              ${adminService.userStates.map(item => `<option value="${esc(item)}" ${draft.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2">${esc(draft.observation || "")}</textarea></label>
          <label class="compact-field full"><span>Motivo del cambio de accesos</span><input name="changeReason" value="${esc(draft.changeReason || "")}" placeholder="Obligatorio cuando se modifica una membresia, rol o ruta"></label>
        </form>

        <div class="user-company-tabs" role="tablist" aria-label="Empresas del usuario">
          ${companies.map(company => {
            const access = userAccessFor(draft, company.id);
            return `<button class="subnav-tab ${company.id === selectedCompanyId ? "active" : ""}" type="button" data-user-access-company="${esc(company.id)}">
              ${esc(company.commercialName)}
              <small>${access.enabled && access.status === "activo" ? esc(remoteCanonical ? (access.profileName || access.profileId || "PROFILE_MISSING") : userRoleLabel(access.roleCode)) : "Sin acceso"}</small>
            </button>`;
          }).join("")}
        </div>

        <section class="user-membership-controls">
          <label class="user-access-switch">
            <input type="checkbox" data-user-company-enabled="${esc(selectedCompanyId)}" ${membership.enabled ? "checked" : ""}>
            <span>Permitir ingreso a esta empresa</span>
          </label>
          <label class="compact-field">
            <span>Rol en la empresa</span>
            <select data-user-company-role="${esc(selectedCompanyId)}" ${membership.enabled ? "" : "disabled"}>
              ${remoteCanonical
                ? ["OWNER", "ADMIN", "EDITOR", "VIEWER"].map(code => `<option value="${code}" ${String(membership.membershipRole || "VIEWER").toUpperCase() === code ? "selected" : ""}>${esc(membershipRoleLabel(code))}</option>`).join("")
                : adminService.roleOptions.map(item => `<option value="${esc(item.code)}" ${membership.roleCode === item.code ? "selected" : ""}>${esc(item.label)}</option>`).join("")}
            </select>
          </label>
          ${remoteCanonical ? `
            <label class="compact-field">
              <span>Perfil canónico</span>
              <select data-user-company-profile="${esc(selectedCompanyId)}" ${membership.enabled ? "required" : "disabled"}>
                <option value="">Seleccione un perfil</option>
                ${canonicalProfiles.map(profile => `<option value="${esc(profile.id)}" ${membership.profileId === profile.id ? "selected" : ""}>${esc(profile.name)} (${esc(profile.id)})</option>`).join("")}
              </select>
            </label>
          ` : ""}
          <label class="compact-field">
            <span>Estado de membresia</span>
            <select data-user-company-status="${esc(selectedCompanyId)}" ${membership.enabled ? "" : "disabled"}>
              ${adminService.userStates.map(item => `<option value="${esc(item)}" ${membership.status === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          ${remoteCanonical ? "" : `<button class="secondary-button" type="button" data-user-routes-reset="${esc(selectedCompanyId)}" ${membership.enabled ? "" : "disabled"}>Restaurar permisos del rol</button>`}
        </section>

        ${remoteCanonical ? `
          <section class="inline-feedback ${membership.profileState === "PROFILE_MISSING" ? "danger" : "success"}">
            <strong>${membership.profileState === "PROFILE_MISSING" ? "PROFILE_MISSING" : `Perfil efectivo: ${esc(membership.profileName || membership.profileId)}`}</strong>
            <div>Las capabilities se resuelven en servidor desde el perfil. Admin Users no crea permisos individuales.</div>
            ${membership.legacyDependent ? `<div>LEGACY VISIBLE: existen ${esc(String(membership.legacyRoutePermissionCount || 0))} registro(s) históricos en user_route_permissions. No se editan ni se usan para construir este perfil.</div>` : ""}
          </section>
        ` : `<div class="user-route-matrix">
          <div class="user-route-matrix-head">
            <div>
              <p class="section-kicker">VISUALIZACIONES</p>
              <h4>Rutas disponibles en ${esc(companies.find(item => item.id === selectedCompanyId)?.commercialName || "la empresa")}</h4>
            </div>
            <small>Por rol usa la configuracion base. Permitir u ocultar crea una excepcion individual.</small>
          </div>
          ${renderUserRouteGroups(draft, selectedCompanyId, membership)}
        </div>`}
      </section>
    `;
  }

  function renderUserPreview() {
    const preview = uiState.users.preview;
    if (!preview?.ok) return "";
    const company = adminService.companyProfiles().find(item => item.id === preview.companyId);
    const grouped = new Map();
    preview.routes.forEach(item => {
      const route = navigation.routeMap[item.id] || {};
      const group = route.menuLabel || "General";
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(route.label || item.label || item.id);
    });
    const groups = [...grouped.entries()].map(([group, labels]) => `
      <article><strong>${esc(group)}</strong><span>${labels.map(esc).join(" · ")}</span></article>
    `).join("");
    return `
      <section class="panel-card user-access-preview">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">VISTA PREVIA SEGURA</p>
            <h3>${esc(preview.user.fullName || preview.user.name)} · ${esc(company?.commercialName || "")}</h3>
            <small>Esta vista no cambia el usuario activo ni modifica el menu del administrador.</small>
          </div>
          <button class="secondary-button" type="button" data-user-preview-close>Cerrar</button>
        </div>
        <div class="user-preview-summary">
          <span class="status-badge ${preview.context.active ? "authorized" : "cancelled"}">${preview.context.active ? "Membresia activa" : "Sin acceso"}</span>
          <strong>${esc(preview.context.roleLabel || "Sin rol")}</strong>
          <span>${esc(String(preview.routes.length))} pantalla(s) visibles</span>
        </div>
        <div class="user-preview-groups">${groups || `<div class="empty-inline">El usuario no vera ninguna pantalla en esta empresa.</div>`}</div>
      </section>
    `;
  }

  function renderUnlinkedUsers() {
    if (!BlessERP.remoteUserAccess?.enabled?.()) return "";
    const users = uiState.users.unlinkedUsers;
    return `
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
          <p class="section-kicker">CUENTAS SIN ACCESO A JAEDER SYSTEMS</p>
            <h3>Usuarios existentes únicamente en Supabase</h3>
            <small>Estas cuentas ya existen en Supabase Auth. Puede habilitarlas en el ERP y asignarles empresa, rol y pantallas, o eliminarlas.</small>
          </div>
          <span class="status-badge ${users.length ? "pending" : "authorized"}">
            ${uiState.users.unlinkedLoading ? "Consultando..." : `${users.length} cuenta(s)`}
          </span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Correo</th><th>Confirmación</th><th>Acción</th></tr></thead>
            <tbody>
              ${users.map(user => `
                <tr>
                  <td>
                    <strong>${esc(user.email || user.loginEmail || "Cuenta sin correo visible")}</strong>
                    ${user.displayName ? `<small>${esc(user.displayName)}</small>` : ""}
                  </td>
                  <td><span class="status-badge ${user.emailConfirmed ? "authorized" : "pending"}">${user.emailConfirmed ? "Confirmado" : "Pendiente"}</span></td>
                  <td>
                    <div class="table-actions">
                      <button class="primary-button" type="button" data-unlinked-user-enable="${esc(user.id)}">Dar acceso</button>
                      <button class="danger-button" type="button" data-unlinked-user-delete="${esc(user.id)}">Eliminar cuenta</button>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="3"><div class="empty-inline">No existen cuentas de Supabase sin acceso a JAEDER SYSTEMS.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderUsers(container, route) {
    const activeUser = adminService.activeUser();
    const users = adminService.visualUsers({
      search: uiState.users.search,
      status: uiState.users.status
    });
    const activeCount = adminService.visualUsers({ status: "activo" }).length;
    if (
      BlessERP.remoteUserAccess?.enabled?.()
      && !uiState.users.unlinkedLoaded
      && !uiState.users.unlinkedLoading
    ) {
      uiState.users.unlinkedLoading = true;
      BlessERP.remoteUserAccess.listDirectory().then(result => {
        uiState.users.unlinkedLoading = false;
        uiState.users.unlinkedLoaded = true;
        if (result.ok) {
          uiState.users.unlinkedUsers = result.data?.unlinked || [];
          uiState.users.profilesByCompany = result.data?.profilesByCompany || {};
          adminService.replaceCloudDirectory(result.data?.users || []);
        }
        else uiState.users.errors = result.errors || ["No se pudieron consultar las cuentas sin acceso a JAEDER SYSTEMS."];
        BlessERP.layout.renderPage();
      });
    }

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">${BlessERP.remoteUserAccess?.enabled?.() ? "Accesos sincronizados con Supabase" : "Accesos locales editables"}</span>
          <span class="status-badge authorized">Usuario activo: ${esc(activeUser.name)}</span>
        </div>
      </section>
      ${renderTabs(route)}
      <section class="future-banner">
        <div>
          <strong>Control por usuario, empresa y pantalla</strong>
          <span>La capacidad funcional de Bless Flower o Imperio Flowers es el limite superior. Aqui se define que vera cada usuario dentro de ese limite.</span>
        </div>
      </section>
      ${uiState.users.message ? `<section class="inline-feedback success">${esc(uiState.users.message)}</section>` : ""}
      ${uiState.users.errors.length ? `<section class="inline-feedback danger">${uiState.users.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="summary-grid summary-grid-settings">
        <article class="summary-card"><span>Usuarios</span><strong>${esc(String(users.length))}</strong><small>Mostrados con filtro actual</small></article>
        <article class="summary-card"><span>Activos</span><strong>${esc(String(activeCount))}</strong><small>Con acceso configurable</small></article>
        <article class="summary-card"><span>${BlessERP.remoteUserAccess?.enabled?.() ? "Sesion Supabase" : "Sesion local"}</span><strong>${esc(activeUser.name)}</strong><small>${esc(activeUser.area || activeUser.role || "-")}</small></article>
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
            <button class="primary-button" type="button" data-user-new>Nuevo usuario</button>
          </div>
        </div>
      </section>
      ${renderUserPreview()}
      ${renderUserEditor()}
      ${renderUnlinkedUsers()}
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">USUARIOS</p>
            <h3>Usuarios y alcance de visualizacion</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Usuario / correo</th>
                <th>Cargo</th>
                <th>Acceso por empresa</th>
                <th>Perfil canónico</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(user => `
                <tr>
                  <td><strong>${esc(user.code || "-")}</strong></td>
                  <td><strong>${esc(user.fullName || user.name)}</strong><small>${esc(user.name)}</small></td>
                  <td><strong>${esc(user.username || user.code || "-")}</strong><small>${esc(user.email || "Sin correo")}</small></td>
                  <td>${esc(user.cargo || user.role || "-")}</td>
                  <td>
                    <div class="user-company-badges">
                      ${adminService.companyProfiles().map(company => {
                        const access = userAccessFor(user, company.id);
                        const enabled = access.enabled && access.status === "activo";
                        return `<span class="status-badge ${enabled ? "authorized" : "cancelled"}">${esc(company.code || company.commercialName)}: ${enabled ? esc(userRoleLabel(access.roleCode)) : "Sin acceso"}</span>`;
                      }).join("")}
                    </div>
                  </td>
                  <td>${adminService.companyProfiles().map(company => {
                    const access = userAccessFor(user, company.id);
                    return `<div><strong>${esc(company.code || company.commercialName)}:</strong> <span class="status-badge ${access.profileState === "CANONICAL" ? "authorized" : "cancelled"}">${esc(access.profileName || access.profileId || "PROFILE_MISSING")}</span></div>`;
                  }).join("")}</td>
                  <td><span class="status-badge ${statusClass(user.status)}">${esc(user.status)}</span></td>
                  <td>
                    <div class="table-actions">
                      <button class="row-action-button" type="button" data-user-edit="${esc(user.id)}">Editar</button>
                      ${BlessERP.remoteUserAccess?.enabled?.() ? "" : `<button class="row-action-button" type="button" data-user-preview-row="${esc(user.id)}">Vista previa</button>`}
                      ${activeUser.id === user.id ? `<span class="status-badge authorized">Sesion local</span>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="8"><div class="empty-inline">No hay usuarios para estos filtros.</div></td></tr>`}
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
      uiState.users.draft = null;
      uiState.users.preview = null;
      uiState.users.password = "";
      uiState.users.passwordConfirmation = "";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-user-new]")?.addEventListener("click", () => {
      uiState.users.draft = adminService.createUserDraft();
      uiState.users.accessCompanyId = adminService.companyProfiles()[0]?.id || "";
      uiState.users.preview = null;
      uiState.users.errors = [];
      uiState.users.password = "";
      uiState.users.passwordConfirmation = "";
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-user-edit]").forEach(button => button.addEventListener("click", () => {
      uiState.users.draft = BlessERP.utils.clone(adminService.findUser(button.dataset.userEdit));
      uiState.users.accessCompanyId = BlessERP.services.companyContext?.activeCompanyId?.() || adminService.companyProfiles()[0]?.id || "";
      uiState.users.preview = null;
      uiState.users.errors = [];
      uiState.users.password = "";
      uiState.users.passwordConfirmation = "";
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-user-preview-row]").forEach(button => button.addEventListener("click", () => {
      const companyId = BlessERP.services.companyContext?.activeCompanyId?.() || adminService.companyProfiles()[0]?.id || "";
      uiState.users.preview = adminService.accessPreview(button.dataset.userPreviewRow, companyId);
      uiState.users.draft = null;
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-unlinked-user-enable]").forEach(button => button.addEventListener("click", event => {
      const authUser = uiState.users.unlinkedUsers.find(item => item.id === event.currentTarget.dataset.unlinkedUserEnable);
      if (!authUser) return;
      const draft = adminService.createUserDraft();
      const loginEmail = String(authUser.loginEmail || authUser.email || "").trim();
      const contactEmail = String(authUser.contactEmail || "").trim();
      const rawLoginName = String(authUser.username || loginEmail.split("@")[0] || draft.code).trim();
      const loginName = (rawLoginName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || draft.code)
        .padEnd(3, "_");
      const displayName = String(authUser.displayName || loginName || "Usuario").trim();
      const selectedCompanyId = BlessERP.services.companyContext?.activeCompanyId?.()
        || adminService.companyProfiles()[0]?.id
        || "";
      Object.keys(draft.companyAccess || {}).forEach(companyId => {
        draft.companyAccess[companyId] = {
          enabled: companyId === selectedCompanyId,
          status: companyId === selectedCompanyId ? "activo" : "inactivo",
          roleCode: "INVITADO",
          membershipRole: "VIEWER",
          profileId: "",
          profileName: "PROFILE_MISSING",
          profileState: "PROFILE_MISSING",
          routeAccess: {}
        };
      });
      uiState.users.draft = {
        ...draft,
        id: authUser.id,
        name: displayName,
        fullName: displayName,
        email: contactEmail || (/(@users\.jaeder\.systems)$/i.test(loginEmail) ? "" : loginEmail),
        username: loginName,
        cloudManaged: true,
        preserveAuthEmail: true,
        __newUser: false,
        observation: "Cuenta existente en Supabase Auth habilitada desde JAEDER SYSTEMS."
      };
      uiState.users.accessCompanyId = selectedCompanyId;
      uiState.users.preview = null;
      uiState.users.errors = [];
      uiState.users.message = "Complete el nombre, cargo, rol y perfil canónico; luego pulse Guardar para habilitar esta cuenta.";
      BlessERP.layout.renderPage();
      requestAnimationFrame(() => document.querySelector("#user-access-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }));
    document.querySelectorAll("[data-unlinked-user-delete]").forEach(button => button.addEventListener("click", async event => {
      const user = uiState.users.unlinkedUsers.find(item => item.id === event.currentTarget.dataset.unlinkedUserDelete);
      if (!user) return;
      if (!window.confirm(`¿Eliminar definitivamente la cuenta ${user.email || ""}?`)) return;
      event.currentTarget.disabled = true;
      const result = await BlessERP.remoteUserAccess.remove(user);
      if (!result.ok) {
        uiState.users.errors = result.errors || ["No se pudo eliminar la cuenta."];
      } else {
        uiState.users.unlinkedUsers = uiState.users.unlinkedUsers.filter(item => item.id !== user.id);
        uiState.users.unlinkedLoaded = false;
        uiState.users.message = `Cuenta ${user.email || ""} eliminada de Supabase.`;
        uiState.users.errors = [];
      }
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-user-preview-close]")?.addEventListener("click", () => {
      uiState.users.preview = null;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-user-cancel]")?.addEventListener("click", () => {
      uiState.users.draft = null;
      uiState.users.preview = null;
      uiState.users.errors = [];
      uiState.users.password = "";
      uiState.users.passwordConfirmation = "";
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-user-access-company]").forEach(button => button.addEventListener("click", () => {
      syncUserDraftFromForm();
      uiState.users.accessCompanyId = button.dataset.userAccessCompany;
      uiState.users.preview = null;
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-user-company-enabled]")?.addEventListener("change", event => {
      syncUserDraftFromForm();
      const access = userAccessFor(uiState.users.draft, event.target.dataset.userCompanyEnabled);
      access.enabled = event.target.checked;
      access.status = event.target.checked ? "activo" : "inactivo";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-user-company-role]")?.addEventListener("change", event => {
      syncUserDraftFromForm();
      const access = userAccessFor(uiState.users.draft, event.target.dataset.userCompanyRole);
      if (BlessERP.remoteUserAccess?.enabled?.()) {
        access.membershipRole = event.target.value;
        access.roleCode = membershipRoleAsLegacyRole(event.target.value);
      } else {
        access.roleCode = event.target.value;
      }
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-user-company-profile]")?.addEventListener("change", event => {
      syncUserDraftFromForm();
      const access = userAccessFor(uiState.users.draft, event.target.dataset.userCompanyProfile);
      access.profileId = String(event.target.value || "").trim().toUpperCase();
      const profile = canonicalProfilesFor(event.target.dataset.userCompanyProfile)
        .find(item => item.id === access.profileId);
      access.profileName = profile?.name || "PROFILE_MISSING";
      access.profileState = profile ? "CANONICAL" : "PROFILE_MISSING";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-user-company-status]")?.addEventListener("change", event => {
      syncUserDraftFromForm();
      userAccessFor(uiState.users.draft, event.target.dataset.userCompanyStatus).status = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-user-route-access]").forEach(select => select.addEventListener("change", () => {
      syncUserDraftFromForm();
      const access = userAccessFor(uiState.users.draft, uiState.users.accessCompanyId);
      if (select.value === "inherit") delete access.routeAccess[select.dataset.userRouteAccess];
      else access.routeAccess[select.dataset.userRouteAccess] = select.value === "allow";
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-user-routes-reset]")?.addEventListener("click", event => {
      syncUserDraftFromForm();
      userAccessFor(uiState.users.draft, event.target.dataset.userRoutesReset).routeAccess = {};
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-user-preview]")?.addEventListener("click", () => {
      syncUserDraftFromForm();
      uiState.users.preview = adminService.accessPreview(uiState.users.draft, uiState.users.accessCompanyId);
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-user-save]")?.addEventListener("click", async event => {
      syncUserDraftFromForm();
      uiState.users.message = "";
      const button = event.currentTarget;
      button.disabled = true;
      let candidate = uiState.users.draft;
      let remoteResult = null;
      if (BlessERP.remoteUserAccess?.enabled?.()) {
        if (!candidate.cloudManaged && !String(candidate.email || "").trim()) {
          uiState.users.errors = ["El correo es obligatorio para enviar la invitación."];
          button.disabled = false;
          BlessERP.layout.renderPage();
          return;
        }
        const missingProfile = Object.entries(candidate.companyAccess || {}).find(([, access]) =>
          access?.enabled !== false
          && String(access?.status || "activo").toLowerCase() === "activo"
          && !String(access?.profileId || "").trim()
        );
        if (missingProfile) {
          uiState.users.errors = [`Seleccione el perfil canónico para ${missingProfile[0]}.`];
          button.disabled = false;
          BlessERP.layout.renderPage();
          return;
        }
        const remote = await BlessERP.remoteUserAccess.save(candidate);
        if (!remote.ok) {
          uiState.users.errors = remote.errors || ["No se pudo guardar el acceso en Supabase."];
          button.disabled = false;
          BlessERP.layout.renderPage();
          return;
        }
        remoteResult = remote;
        candidate = remote.user;
      } else if (window.__ERP_LOCAL_MODE__ === true) {
        const storedUser = candidate.id ? adminService.findUser(candidate.id) : null;
        const needsPassword = !BlessERP.localAuth?.credentialOf?.(storedUser);
        const activeUserId = BlessERP.state.state.db.session?.activeUser?.id;
        if (!BlessERP.localAuth?.isConfigured?.() && candidate.id !== activeUserId) {
          uiState.users.errors = ["Primero edite el usuario administrador activo y establezca su contraseña local."];
          button.disabled = false;
          BlessERP.layout.renderPage();
          return;
        }
        if (needsPassword && !uiState.users.password) {
          uiState.users.errors = ["El administrador debe establecer la contraseña inicial del usuario."];
          button.disabled = false;
          BlessERP.layout.renderPage();
          return;
        }
        if (uiState.users.password !== uiState.users.passwordConfirmation) {
          uiState.users.errors = ["La contraseña y su confirmación no coinciden."];
          button.disabled = false;
          BlessERP.layout.renderPage();
          return;
        }
        if (uiState.users.password) {
          const credentialResult = await BlessERP.localAuth.createCredential(uiState.users.password);
          if (!credentialResult.ok) {
            uiState.users.errors = credentialResult.errors || ["No se pudo proteger la contraseña local."];
            button.disabled = false;
            BlessERP.layout.renderPage();
            return;
          }
          candidate.localCredential = credentialResult.credential;
        }
      }
      const result = BlessERP.remoteUserAccess?.enabled?.()
        ? (remoteResult?.confirmed === true ? { ok: true, user: candidate } : { ok: false, errors: ["Supabase no confirmó el acceso."] })
        : adminService.saveUser(candidate, { reason: candidate.changeReason });
      if (!result.ok) {
        uiState.users.errors = result.errors || ["No se pudo guardar el usuario."];
      } else {
        uiState.users.errors = [];
        uiState.users.unlinkedLoaded = false;
        uiState.users.draft = null;
        uiState.users.preview = null;
        uiState.users.password = "";
        uiState.users.passwordConfirmation = "";
        const userName = result.user.fullName || result.user.name;
        if (window.__ERP_LOCAL_MODE__ === true && result.user.id === BlessERP.state.state.db.session?.activeUser?.id) {
          BlessERP.localAuth?.markCurrentSession?.(result.user.id);
        }
        if (remoteResult?.invited) {
          uiState.users.message = `Invitación enviada a ${result.user.email || userName}. El usuario debe crear su contraseña desde el enlace recibido.`;
        } else if (remoteResult?.linkedExisting) {
          uiState.users.message = `Usuario ${userName} vinculado desde Supabase.`;
        } else if (remoteResult?.created) {
          uiState.users.message = `Usuario ${userName} creado y habilitado. Ya puede ingresar con la contraseña entregada por el administrador.`;
        } else if (remoteResult?.passwordUpdated) {
          uiState.users.message = `Usuario ${userName} actualizado, incluida su contraseña de acceso.`;
        } else if (window.__ERP_LOCAL_MODE__ === true) {
          uiState.users.message = `Usuario ${userName} guardado. Ya puede ingresar localmente con el usuario y la contraseña definidos.`;
        } else {
          uiState.users.message = `Usuario ${userName} guardado correctamente.`;
        }
      }
      button.disabled = false;
      BlessERP.layout.renderApp();
    });
    document.querySelector("[data-user-delete]")?.addEventListener("click", async event => {
      syncUserDraftFromForm();
      uiState.users.message = "";
      const button = event.currentTarget;
      button.disabled = true;
      if (BlessERP.remoteUserAccess?.enabled?.()) {
        const remote = await BlessERP.remoteUserAccess.remove(uiState.users.draft);
        if (!remote.ok) {
          uiState.users.errors = remote.errors || ["No se pudo eliminar la cuenta en Supabase."];
          button.disabled = false;
          BlessERP.layout.renderPage();
          return;
        }
      }
      const result = BlessERP.remoteUserAccess?.enabled?.()
        ? adminService.removeCloudUser(uiState.users.draft.id, { reason: uiState.users.draft.changeReason, confirmed: true })
        : adminService.removeUser(uiState.users.draft.id, { reason: uiState.users.draft.changeReason });
      if (!result.ok) {
        uiState.users.errors = result.errors || ["No se pudo eliminar el usuario."];
      } else {
        uiState.users.errors = [];
        uiState.users.unlinkedLoaded = false;
        uiState.users.draft = null;
        uiState.users.preview = null;
        uiState.users.message = `Usuario ${result.user.fullName || result.user.name} eliminado.`;
      }
      button.disabled = false;
      BlessERP.layout.renderPage();
    });
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
          <h3>Eventos importantes de JAEDER SYSTEMS</h3>
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
    const sriSequence = Boolean(draft.documentType || String(draft.code || "").toUpperCase() === "RETE");
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
          <label class="compact-field"><span>Codigo</span><input name="code" value="${esc(draft.code)}" ${sriSequence ? "disabled" : ""}></label>
          <label class="compact-field"><span>Nombre</span><input name="name" value="${esc(draft.name)}" ${sriSequence ? "disabled" : ""}></label>
          ${sriSequence ? `
            <label class="compact-field"><span>Tipo comprobante SRI</span><input name="documentType" value="${esc(draft.documentType)}" readonly></label>
            <label class="compact-field"><span>Ambiente</span><input name="environment" value="PRUEBAS" readonly></label>
            <label class="compact-field"><span>Establecimiento</span><input name="establishmentCode" inputmode="numeric" maxlength="3" pattern="[0-9]{3}" value="${esc(draft.establishmentCode || "001")}" required></label>
            <label class="compact-field"><span>Punto de emision</span><input name="emissionPointCode" inputmode="numeric" maxlength="3" pattern="[0-9]{3}" value="${esc(draft.emissionPointCode || "001")}" required></label>
            <label class="compact-field"><span>Ultimo secuencial emitido</span><input name="currentNumber" type="number" min="0" max="999999999" step="1" value="${esc(String(draft.currentNumber))}"></label>
            <label class="compact-field"><span>Proximo comprobante</span><input value="${esc(adminService.formatSequencePreview(draft))}" readonly></label>
            <section class="inline-feedback warning full">Los tres campos forman la numeracion SRI: establecimiento (3) + punto de emision (3) + secuencial (9). Registre el ultimo numero ya emitido; JAEDER SYSTEMS mostrara el siguiente sin reutilizar numeros.</section>
          ` : `
            <label class="compact-field"><span>Prefijo</span><input name="prefix" value="${esc(draft.prefix)}"></label>
            <label class="compact-field"><span>Modulo</span><input name="module" value="${esc(draft.module)}"></label>
            <label class="compact-field"><span>Ano</span><input name="year" value="${esc(draft.year)}"></label>
            <label class="compact-field"><span>Mes</span><input name="month" value="${esc(draft.month)}" placeholder="Opcional"></label>
            <label class="compact-field"><span>Numero actual</span><input name="currentNumber" type="number" min="0" value="${esc(String(draft.currentNumber))}"></label>
            <label class="compact-field"><span>Longitud</span><input name="length" type="number" min="3" value="${esc(String(draft.length))}"></label>
          `}
          <label class="compact-field">
            <span>Reinicio</span>
            <select name="reset" ${sriSequence ? "disabled" : ""}>
              ${adminService.sequenceResets.map(item => `<option value="${esc(item)}" ${draft.reset === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field">
            <span>Estado</span>
            <select name="status" ${sriSequence ? "disabled" : ""}>
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
      <section class="panel-card sri-readiness-panel">
        <div class="panel-card-head">
          <div><p class="section-kicker">NUMERACION TRIBUTARIA</p><h3>${esc(adminService.companyProfiles().find(item => item.id === BlessERP.services?.companyContext?.activeCompanyId?.())?.commercialName || "Empresa activa")}</h3></div>
          <span class="status-badge pending">AMBIENTE PRUEBAS</span>
        </div>
        <p>Factura y retencion mantienen series y contadores independientes por empresa. Los cambios quedan auditados y no pueden retroceder sobre comprobantes ya generados con la misma serie.</p>
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
          <h3>Secuenciales tributarios e internos de JAEDER SYSTEMS</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Tipo SRI</th>
                <th>Modulo</th>
                <th>Estab.</th>
                <th>Pto. emision</th>
                <th>Ultimo</th>
                <th>Proximo</th>
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
                  <td>${esc(item.documentType || "Interno")}</td>
                  <td>${esc(item.module || "-")}</td>
                  <td>${esc(item.establishmentCode || "-")}</td>
                  <td>${esc(item.emissionPointCode || "-")}</td>
                  <td>${esc(String(item.currentNumber))}</td>
                  <td><strong>${esc(adminService.formatSequencePreview(item))}</strong></td>
                  <td>${esc(item.reset)}</td>
                  <td><span class="status-badge ${statusClass(item.status)}">${esc(item.status)}</span></td>
                  <td><button class="row-action-button" type="button" data-sequence-edit="${esc(item.id)}">Editar</button></td>
                </tr>
              `).join("") || `<tr><td colspan="11"><div class="empty-inline">No hay secuenciales para estos filtros.</div></td></tr>`}
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
        length: Number(data.length || uiState.sequences.draft.length || 6),
        establishmentCode: data.establishmentCode || uiState.sequences.draft.establishmentCode || "",
        emissionPointCode: data.emissionPointCode || uiState.sequences.draft.emissionPointCode || ""
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
