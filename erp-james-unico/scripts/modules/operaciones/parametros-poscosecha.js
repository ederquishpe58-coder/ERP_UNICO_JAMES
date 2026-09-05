(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const TYPE_LABELS = {
    suppliers: "Fincas / Bloques",
    classifiers: "Clasificadores",
    bunchers: "Embonchadores",
    receptionists: "Recepcionistas",
    digitizers: "Digitadores",
    scanners: "Responsables de escaneo",
    responsibles: "Responsables de despacho",
    varieties: "Variedades",
    lengths: "Medidas",
    stemTypes: "Tipos de tallo",
    labelTypes: "Tipos de etiqueta"
  };
  const PARAMETER_ROUTE_TYPES = Object.freeze({
    "operations-parameters": "",
    "operations-farms-blocks": "suppliers",
    "operations-varieties": "varieties"
  });
  const TYPE_MANAGE_CAPABILITIES = Object.freeze({
    suppliers: "operations.farms_blocks.manage",
    classifiers: "operations.classifiers.manage",
    bunchers: "operations.bunchers.manage",
    receptionists: "operations.receptionists.manage",
    digitizers: "operations.digitizers.manage",
    scanners: "operations.scanners.manage",
    responsibles: "operations.responsibles.manage",
    varieties: "operations.varieties.manage",
    lengths: "operations.lengths.manage",
    stemTypes: "operations.stem_types.manage",
    labelTypes: "operations.label_types.manage"
  });
  const PERSON_TYPES = new Set(["classifiers", "bunchers", "receptionists", "digitizers", "scanners", "responsibles"]);
  const PAYROLL_LINK_TYPES = Object.freeze({ classifiers: "CLASSIFIER", bunchers: "BUNCHER" });
  const payrollUi = { loading: false, loaded: false, error: "" };
  const catalogUi = {
    companyId: "",
    routeId: "",
    type: "varieties",
    search: "",
    status: "ACTIVO",
    page: 1,
    pageSize: 25,
    queried: false,
    loading: false,
    rows: [],
    total: 0,
    error: "",
    elapsedMs: 0,
    payloadBytes: 0,
    requestId: 0,
    detailId: "",
    historyId: "",
    historyLoading: false,
    historyRows: [],
    historyError: ""
  };
  let mountController = null;
  let pendingVarietyImageFile = null;
  let pendingVarietyImageUrl = "";

  function clearPendingVarietyImage() {
    if (pendingVarietyImageUrl) URL.revokeObjectURL?.(pendingVarietyImageUrl);
    pendingVarietyImageFile = null;
    pendingVarietyImageUrl = "";
    return true;
  }

  function stagePendingVarietyImage(file) {
    const validation = BlessERP.getVarietyImageRepository?.()?.validateImageFile?.(file)
      || { ok: false, message: "Seleccione una fotografía válida." };
    if (!validation.ok) return validation;
    clearPendingVarietyImage();
    pendingVarietyImageFile = file;
    pendingVarietyImageUrl = URL.createObjectURL?.(file) || "";
    return { ok: true, staged: true, file };
  }

  function currentParameterRouteId() {
    return BlessERP.state?.state?.currentRoute || BlessERP.state?.state?.route || "";
  }

  function isParameterRoute(routeId = currentParameterRouteId()) {
    return Object.prototype.hasOwnProperty.call(PARAMETER_ROUTE_TYPES, String(routeId || ""));
  }

  function fixedTypeForRoute(routeId = currentParameterRouteId()) {
    return PARAMETER_ROUTE_TYPES[String(routeId || "")] || "";
  }

  function createContextualDraft(type, seed = {}) {
    return BlessERP.operacionesData?.createParameterDraft?.({ ...seed, type }) || {
      id: "",
      type,
      code: "",
      name: "",
      assignedBlock: "",
      labelColor: "",
      active: true,
      observation: "",
      ...seed
    };
  }

  function resetCanonicalDraft(appState, type = fixedTypeForRoute()) {
    const normalizedType = String(type || "");
    if (!normalizedType) return false;
    if (normalizedType === "varieties") clearPendingVarietyImage();
    const store = BlessERP.operacionesState.getStore(appState);
    store.ui.parameterType = normalizedType;
    store.ui.parameterDraft = createContextualDraft(normalizedType);
    return true;
  }

  function ensureContextualDraft(store, fixedType) {
    const source = store.ui.parameterDraft || {};
    if (!fixedType || source.type === fixedType) return source;
    store.ui.parameterType = fixedType;
    store.ui.parameterDraft = createContextualDraft(fixedType);
    return store.ui.parameterDraft;
  }

  function manageCapabilityForType(type) {
    return TYPE_MANAGE_CAPABILITIES[String(type || "")] || "";
  }

  function canManageType(type) {
    const capability = manageCapabilityForType(type);
    return Boolean(capability)
      && BlessERP.capabilityRuntime?.can?.("operations.parameters.view") === true
      && BlessERP.capabilityRuntime?.can?.(capability) === true;
  }

  function assertManageType(type) {
    if (canManageType(type)) return true;
    BlessERP.layout?.toast?.("No tiene permiso para administrar este catálogo.", { tone: "danger" });
    return false;
  }

  function payrollService() {
    return BlessERP.services?.payrollV2 || null;
  }

  function payrollRepository() {
    return BlessERP.getPayrollV2Repository?.() || null;
  }

  function catalogRepository() {
    return BlessERP.getPostharvestParameterQueryRepository?.() || null;
  }

  function ensureCatalogCompany() {
    const companyId = String(catalogRepository()?.activeCompanyId?.() || "");
    if (catalogUi.companyId === companyId) return;
    Object.assign(catalogUi, {
      companyId,
      page: 1,
      queried: false,
      loading: false,
      rows: [],
      total: 0,
      error: "",
      elapsedMs: 0,
      payloadBytes: 0,
      detailId: "",
      historyId: "",
      historyLoading: false,
      historyRows: [],
      historyError: ""
    });
  }

  function ensureCatalogRoute(routeId) {
    const normalizedRouteId = String(routeId || "");
    if (!isParameterRoute(normalizedRouteId) || catalogUi.routeId === normalizedRouteId) return;
    const fixedType = PARAMETER_ROUTE_TYPES[normalizedRouteId];
    Object.assign(catalogUi, {
      routeId: normalizedRouteId,
      type: fixedType || catalogUi.type || "varieties",
      page: 1,
      queried: false,
      loading: false,
      rows: [],
      total: 0,
      error: "",
      elapsedMs: 0,
      payloadBytes: 0,
      detailId: "",
      historyId: "",
      historyLoading: false,
      historyRows: [],
      historyError: ""
    });
  }

  function normalizeSearch(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  }

  function matchesCatalogQuery(item, type = catalogUi.type) {
    if (!item || String(item.type || type) !== String(catalogUi.type)) return false;
    if (catalogUi.status === "ACTIVO" && item.active === false) return false;
    if (catalogUi.status === "INACTIVO" && item.active !== false) return false;
    const search = normalizeSearch(catalogUi.search);
    if (!search) return true;
    return normalizeSearch([
      item.code,
      item.name,
      item.observation,
      item.assignedBlock,
      item.labelColor
    ].join(" ")).includes(search);
  }

  function catalogRows() {
    // La consulta paginada ya proviene de erp_entity_records. No se mezcla con
    // defaults, caché legacy ni borradores locales: el snapshot del backend es
    // el conjunto autoritativo visible en Parámetros.
    return [...catalogUi.rows];
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("es-EC", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function parameterDetail(item, type, utils) {
    if (type === "suppliers") return item.assignedBlock ? `Bloque ${utils.esc(item.assignedBlock)}` : "Sin bloque";
    if (type === "bunchers") return item.labelColor ? `Etiqueta ${utils.esc(item.labelColor)}` : "Sin color";
    if (PERSON_TYPES.has(type)) return utils.esc(item.observation || "Personal operativo");
    return utils.esc(item.observation || "-");
  }

  function operationalWorkerId(item = {}) {
    return String(item.operational_worker_id || item.operationalWorkerId || item.employee_id || item.employeeId || item.id || "").trim();
  }

  function canonicalPayrollData() {
    const snapshot = payrollService()?.snapshot?.() || {};
    const employees = (snapshot.employees || [])
      .filter(item => !["INACTIVO", "INACTIVE"].includes(String(item.status || item.state || "").toUpperCase()));
    const links = (snapshot.operationalRoles || []).filter(item => item.active !== false && !item.valid_to && !item.validTo);
    return { employees, links };
  }

  function canonicalLinkFor(item, type, links) {
    const role = PAYROLL_LINK_TYPES[type];
    const workerId = operationalWorkerId(item);
    if (!role || !workerId) return null;
    return links.find(link => String(link.operational_role || link.operationalRole) === role
      && String(link.operational_worker_id || link.operationalWorkerId) === workerId) || null;
  }

  function varietyImageUrl(item) {
    const imagePath = String(item?.imagePath || "").trim();
    if (imagePath) return BlessERP.getVarietyImageRepository?.()?.publicUrl?.(imagePath) || "";
    const existing = String(item?.imageUrl || item?.photoUrl || item?.image || item?.photo || "").trim();
    return /^(https?:\/\/|blob:|data:image\/)/i.test(existing) ? existing : "";
  }

  function varietyInitials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "FL").toUpperCase();
  }

  function renderVarietyImage(item, utils, className = "") {
    const name = String(item?.name || "Variedad");
    const url = varietyImageUrl(item);
    return url
      ? `<img class="ops-variety-image ${className}" src="${utils.esc(url)}" alt="Fotografía de ${utils.esc(name)}" loading="lazy" decoding="async">`
      : `<span class="ops-variety-image ops-variety-image-placeholder ${className}" aria-hidden="true">${utils.esc(varietyInitials(name))}</span>`;
  }

  function renderVarietyImageEditor(draft, store, utils) {
    if (draft.type !== "varieties") return "";
    const variety = draft;
    const hasCanonicalVersion = Number(variety?.__syncVersion || 0) > 0;
    const hasPendingImage = Boolean(pendingVarietyImageFile);
    const imageSource = hasPendingImage
      ? { ...variety, imagePath: "", imageUrl: pendingVarietyImageUrl }
      : variety;
    const hasImage = hasPendingImage || Boolean(String(variety?.imagePath || "").trim() || varietyImageUrl(variety));
    return `<div class="ops-variety-image-editor ops-form-span-2">
      ${renderVarietyImage(imageSource, utils, "is-editor")}
      <div class="ops-variety-image-editor-copy">
        <strong>Imagen de ${utils.esc(variety.name || "la variedad")}</strong>
        <small>${hasPendingImage
          ? `Fotografía opcional preparada: ${utils.esc(pendingVarietyImageFile.name || "imagen")}. Se subirá después de confirmar la variedad.`
          : draft.id
          ? hasCanonicalVersion
            ? "JPG, PNG o WEBP. Se optimiza a WEBP de hasta 1024 px y 3 MB."
            : "Espere la confirmación de esta variedad en Supabase antes de subir la imagen."
          : "Fotografía opcional. Puede seleccionarla ahora o guardar la variedad sin imagen."}</small>
        <div class="table-actions-inline">
          <button type="button" class="secondary-button" data-ops-action="parameter-image-select">${hasImage ? "Reemplazar foto" : "Seleccionar foto"}</button>
          ${hasImage ? `<button type="button" class="danger-outline-button" data-ops-action="parameter-image-remove">Quitar foto</button>` : ""}
        </div>
        <input type="file" accept="image/jpeg,image/png,image/webp" data-ops-variety-image-input hidden>
      </div>
    </div>`;
  }

  function renderCatalogActions(item, utils) {
    return `<details class="ops-parameter-options">
      <summary aria-label="Opciones para ${utils.esc(item.name || item.code)}">Opciones</summary>
      <div class="ops-parameter-options-menu">
        ${canManageType(item.type) ? `<button type="button" data-ops-action="parameter-edit" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">Editar</button>` : ""}
        <button type="button" data-ops-parameter-query-action="detail" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">Ver detalle</button>
        <button type="button" data-ops-parameter-query-action="history" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">Ver historial</button>
        ${canManageType(item.type) ? `<button type="button" data-ops-action="parameter-toggle" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">${item.active !== false ? "Desactivar" : "Activar"}</button>
        ${catalogRepository()?.isCanonicalEditableType?.(item.type) ? "" : `<button type="button" class="is-danger" data-ops-action="parameter-delete" data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">Eliminar</button>`}` : ""}
      </div>
    </details>`;
  }

  function renderCatalogRows(rows, store, payroll, utils, fixedType = "") {
    if (fixedType === "varieties") {
      return `<div class="compact-table-wrap ops-parameter-table-wrap"><table class="compact-table ops-parameter-catalog-table">
        <thead><tr><th>Código</th><th>Nombre de variedad</th><th>Fotografía</th><th>Observación</th><th>Estado</th><th>Actualizado</th><th>Acciones</th></tr></thead>
        <tbody>${rows.map(item => `<tr data-ops-parameter-query-row data-type="varieties" data-id="${utils.esc(item.id)}">
          <td>${utils.esc(item.code || "-")}</td>
          <td><strong>${utils.esc(item.name || "-")}</strong></td>
          <td>${renderVarietyImage(item, utils, "is-table")}</td>
          <td>${utils.esc(item.observation || "-")}</td>
          <td><span class="status-badge ${item.active !== false ? "authorized" : "pending"}">${item.active !== false ? "ACTIVO" : "INACTIVO"}</span></td>
          <td>${utils.esc(formatDateTime(item.__syncUpdatedAt || item.updated_at))}</td>
          <td>${renderCatalogActions(item, utils)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
    }
    if (fixedType === "suppliers") {
      return `<div class="compact-table-wrap ops-parameter-table-wrap"><table class="compact-table ops-parameter-catalog-table">
        <thead><tr><th>Código</th><th>Nombre finca / proveedor</th><th>Bloque asignado</th><th>Observación</th><th>Estado</th><th>Actualizado</th><th>Acciones</th></tr></thead>
        <tbody>${rows.map(item => `<tr data-ops-parameter-query-row data-type="suppliers" data-id="${utils.esc(item.id)}">
          <td>${utils.esc(item.code || "-")}</td>
          <td><strong>${utils.esc(item.name || "-")}</strong></td>
          <td>${utils.esc(item.assignedBlock || "-")}</td>
          <td>${utils.esc(item.observation || "-")}</td>
          <td><span class="status-badge ${item.active !== false ? "authorized" : "pending"}">${item.active !== false ? "ACTIVO" : "INACTIVO"}</span></td>
          <td>${utils.esc(formatDateTime(item.__syncUpdatedAt || item.updated_at))}</td>
          <td>${renderCatalogActions(item, utils)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
    }
    const employeeNames = new Map(payroll.employees.map(item => [String(item.employee_id || item.employeeId), item.full_name || item.fullName]));
    return `<div class="compact-table-wrap ops-parameter-table-wrap"><table class="compact-table ops-parameter-catalog-table">
      <thead><tr><th>Código</th><th>Nombre</th><th>Imagen</th><th>Detalle</th><th>Empleado vinculado</th><th>Estado</th><th>Actualizado</th><th>Acciones</th></tr></thead>
      <tbody>${rows.map(item => `<tr data-ops-parameter-query-row data-type="${utils.esc(item.type)}" data-id="${utils.esc(item.id)}">
        <td>${utils.esc(item.code || "-")}</td>
        <td><strong>${utils.esc(item.name || "-")}</strong><br><small>${utils.esc(TYPE_LABELS[item.type] || item.type)}</small></td>
        <td>${item.type === "varieties" ? renderVarietyImage(item, utils, "is-table") : "-"}</td>
        <td>${parameterDetail(item, item.type, utils)}</td>
        <td>${(() => { const link = canonicalLinkFor(item, item.type, payroll.links); const employeeId = String(link?.employee_id || link?.employeeId || ""); return link ? `${utils.esc(employeeNames.get(employeeId) || "Empleado V2")}<br><small>${utils.esc(employeeId)}</small>` : (PAYROLL_LINK_TYPES[item.type] ? '<span class="status-badge pending">SIN VÍNCULO V2</span>' : "-"); })()}</td>
        <td><span class="status-badge ${item.active !== false ? "authorized" : "pending"}">${item.active !== false ? "ACTIVO" : "INACTIVO"}</span></td>
        <td>${utils.esc(formatDateTime(item.__syncUpdatedAt || item.updated_at))}</td>
        <td>${renderCatalogActions(item, utils)}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  function renderCatalogDetail(rows, utils) {
    const selected = rows.find(item => String(item.id) === String(catalogUi.detailId));
    if (!selected) return "";
    return `<aside class="ops-parameter-query-detail" data-ops-parameter-query-detail>
      <div><p class="section-kicker">DETALLE</p><h4>${utils.esc(selected.name || selected.code || "Parámetro")}</h4></div>
      <dl>
        <div><dt>Tipo</dt><dd>${utils.esc(TYPE_LABELS[selected.type] || selected.type)}</dd></div>
        <div><dt>Código</dt><dd>${utils.esc(selected.code || "-")}</dd></div>
        <div><dt>Estado</dt><dd>${selected.active !== false ? "ACTIVO" : "INACTIVO"}</dd></div>
        <div><dt>Última actualización</dt><dd>${utils.esc(formatDateTime(selected.__syncUpdatedAt || selected.updated_at))}</dd></div>
        ${selected.assignedBlock ? `<div><dt>Bloque</dt><dd>${utils.esc(selected.assignedBlock)}</dd></div>` : ""}
        ${selected.labelColor ? `<div><dt>Color de etiqueta</dt><dd>${utils.esc(selected.labelColor)}</dd></div>` : ""}
        ${selected.observation ? `<div class="is-wide"><dt>Observación</dt><dd>${utils.esc(selected.observation)}</dd></div>` : ""}
      </dl>
      <button type="button" class="secondary-button" data-ops-parameter-query-action="close-detail">Cerrar detalle</button>
    </aside>`;
  }

  function renderCatalogHistory(rows, utils) {
    const selected = rows.find(item => String(item.id) === String(catalogUi.historyId));
    if (!selected) return "";
    const body = catalogUi.historyLoading
      ? '<div class="empty-state compact"><strong>Consultando historial…</strong></div>'
      : catalogUi.historyError
        ? `<div class="inline-alert warning">${utils.esc(catalogUi.historyError)}</div>`
        : catalogUi.historyRows.length
          ? `<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Estado</th><th>Versión</th></tr></thead><tbody>${catalogUi.historyRows.map(item => `<tr><td>${utils.esc(formatDateTime(item.server_created_at))}</td><td>${utils.esc(item.action || "-")}</td><td>${utils.esc(item.status || "-")}</td><td>${utils.esc(item.result_version ?? "-")}</td></tr>`).join("")}</tbody></table></div>`
          : '<div class="empty-state compact"><strong>Sin operaciones históricas registradas para este parámetro.</strong></div>';
    return `<aside class="ops-parameter-query-history" data-ops-parameter-query-history>
      <div class="panel-card-head"><div><p class="section-kicker">HISTORIAL INDIVIDUAL</p><h4>${utils.esc(selected.name || selected.code || "Parámetro")}</h4></div><button type="button" class="secondary-button" data-ops-parameter-query-action="close-history">Cerrar</button></div>
      ${body}
    </aside>`;
  }

  function renderCatalogResult(rows, store, payroll, utils, fixedType = "") {
    const catalogName = TYPE_LABELS[fixedType] || "parámetros";
    if (!catalogUi.queried) return `<div class="empty-state ops-parameter-query-empty"><strong>${fixedType ? `Consulta ${utils.esc(catalogName)} cuando lo necesites.` : "Busca un parámetro para consultar o editar."}</strong><span>${fixedType ? "Define los filtros y pulsa Consultar. No se ha cargado el catálogo automáticamente." : "Selecciona un tipo, define los filtros y pulsa Consultar. No se ha cargado historial."}</span></div>`;
    if (catalogUi.loading) return '<div class="empty-state ops-parameter-query-empty"><strong>Consultando parámetros…</strong></div>';
    if (catalogUi.error) return `<div class="inline-alert warning">${utils.esc(catalogUi.error)}</div>`;
    if (!rows.length) return '<div class="empty-state ops-parameter-query-empty"><strong>Sin resultados.</strong><span>La consulta no encontró parámetros con esos filtros.</span></div>';
    return `${renderCatalogRows(rows, store, payroll, utils, fixedType)}${renderCatalogDetail(rows, utils)}${renderCatalogHistory(rows, utils)}`;
  }

  function render(appState, route) {
    const stateApi = BlessERP.operacionesState;
    const utils = BlessERP.operacionesUtils;
    const store = stateApi.getStore(appState);
    ensureCatalogCompany();
    ensureCatalogRoute(route?.id);
    const fixedType = fixedTypeForRoute(route?.id);
    const draft = ensureContextualDraft(store, fixedType);
    const typeEntries = Object.entries(TYPE_LABELS).filter(([type]) => !fixedType || type === fixedType);
    const manageAllowed = canManageType(draft.type);
    const contextualLabel = TYPE_LABELS[fixedType] || "Parámetros de Operaciones / Poscosecha";
    const contextualSingular = fixedType === "varieties" ? "variedad" : fixedType === "suppliers" ? "finca / bloque" : "parámetro";
    const contextualNewLabel = fixedType ? `Nueva ${contextualSingular}` : "Nuevo parámetro";
    const payroll = canonicalPayrollData();
    const employees = payroll.employees;
    const rows = catalogRows();
    const pageCount = Math.max(1, Math.ceil(catalogUi.total / catalogUi.pageSize));
    const from = catalogUi.total ? ((catalogUi.page - 1) * catalogUi.pageSize) + 1 : 0;
    const to = catalogUi.total ? Math.min(catalogUi.page * catalogUi.pageSize, catalogUi.total) : 0;

    return `
      <div class="ops-parameter-page">
      ${utils.renderPageHeader(route, "Catálogo canónico", "authorized", "Catálogos maestros confirmados por Supabase y reutilizados por Recepción, Clasificación, Etiquetas y Escaneo.")}
      ${utils.renderTabs(route)}
      ${utils.renderNotice(store.ui)}
      ${fixedType ? "" : utils.renderSummaryCards([
        { label: "Historial cargado", value: catalogUi.queried ? utils.number(rows.length) : "0", help: catalogUi.queried ? "Solo la página consultada" : "Sin consulta automática" },
        { label: "Resultados", value: catalogUi.queried ? utils.number(catalogUi.total) : "—", help: "Conteo server-side" },
        { label: "Página", value: catalogUi.queried ? `${catalogUi.page} / ${pageCount}` : "—", help: catalogUi.queried ? `${from}–${to}` : "Consulta bajo demanda" },
        { label: fixedType ? "Catálogo" : "Catálogos", value: fixedType ? contextualLabel : utils.number(Object.keys(TYPE_LABELS).length), help: fixedType ? "Autoridad canónica" : "Administración central" }
      ])}
      ${manageAllowed ? `<section class="panel-card ops-parameter-form-card" data-ops-parameter-form data-ops-context-type="${utils.esc(fixedType || draft.type)}">
          <div class="panel-card-head">
            <div><p class="section-kicker">${utils.esc(fixedType ? contextualLabel.toUpperCase() : "PARÁMETRO")}</p><h3>${fixedType ? utils.esc(contextualNewLabel) : draft.id ? `Editar ${utils.esc(contextualSingular)}` : utils.esc(contextualNewLabel)}</h3></div>
            <span class="status-badge authorized">SUPABASE CANÓNICO</span>
          </div>
          <div class="ops-form-grid">
            ${fixedType ? `<input type="hidden" data-ops-bind="parameterDraft" data-field="type" value="${utils.esc(fixedType)}">` : `<label class="compact-inline-field"><span>Tipo</span><select data-ops-bind="parameterDraft" data-field="type">${typeEntries.map(([value, label]) => `<option value="${utils.esc(value)}" ${value === draft.type ? "selected" : ""}>${utils.esc(label)}</option>`).join("")}</select></label>`}
            <label class="compact-inline-field"><span>Código</span><input value="${utils.esc(draft.code)}" data-ops-bind="parameterDraft" data-field="code" placeholder="Automático si queda vacío"></label>
            <label class="compact-inline-field"><span>${draft.type === "suppliers" ? "Nombre de finca / proveedor" : draft.type === "varieties" ? "Nombre de variedad" : "Nombre / valor"}</span><input value="${utils.esc(draft.name)}" data-ops-bind="parameterDraft" data-field="name" autocomplete="off"></label>
            ${PAYROLL_LINK_TYPES[draft.type] ? (() => {
              const link = canonicalLinkFor(draft, draft.type, payroll.links);
              const selectedEmployeeId = String(link?.employee_id || link?.employeeId || "");
              const permission = payrollRepository()?.healthStatus?.()?.data?.permissions?.manage === true;
              return `<div class="compact-inline-field ops-payroll-v2-link-field"><span>Empleado Nómina V2</span><select data-ops-payroll-employee ${!draft.id || payrollUi.loading || !permission ? "disabled" : ""}><option value="">${payrollUi.loading ? "Cargando empleados V2…" : "Seleccione empleado V2"}</option>${employees.map(item => `<option value="${utils.esc(item.employee_id)}" ${String(item.employee_id) === selectedEmployeeId ? "selected" : ""}>${utils.esc(item.full_name)} · ${utils.esc(item.employee_code || item.employee_id)}</option>`).join("")}</select><small>${draft.id ? `Vínculo UUID por trabajador operativo ${utils.esc(operationalWorkerId(draft))}.` : "Guarde primero el trabajador operativo."}${payrollUi.error ? ` ${utils.esc(payrollUi.error)}` : ""}</small><button type="button" class="secondary-button" data-ops-payroll-link data-type="${utils.esc(draft.type)}" data-id="${utils.esc(draft.id || "")}" ${!draft.id || payrollUi.loading || !permission ? "disabled" : ""}>Confirmar vínculo V2</button></div>`;
            })() : ""}
            ${draft.type === "bunchers" ? `<label class="compact-inline-field"><span>Color de etiqueta</span><input value="${utils.esc(draft.labelColor || "")}" data-ops-bind="parameterDraft" data-field="labelColor" placeholder="Ej. ROJO"><small>Identifica al embonchador en la etiqueta Zebra.</small></label>` : ""}
            ${draft.type === "suppliers" ? `<label class="compact-inline-field"><span>Bloque asignado</span><input value="${utils.esc(draft.assignedBlock || "")}" data-ops-bind="parameterDraft" data-field="assignedBlock" placeholder="Ej. B1"></label>` : ""}
            ${fixedType ? `<div class="compact-inline-field"><span>Estado inicial</span><span class="status-badge authorized">ACTIVO</span><small>El nuevo registro se crea activo mediante el backend canónico.</small></div>` : ""}
            <label class="compact-inline-field ops-form-span-2"><span>Observación</span><textarea rows="2" data-ops-bind="parameterDraft" data-field="observation">${utils.esc(draft.observation)}</textarea></label>
            ${renderVarietyImageEditor(draft, store, utils)}
          </div>
          <div class="table-actions-inline">
            <button class="primary-button" data-ops-action="parameter-save">GUARDAR</button>
            <button class="secondary-button" data-ops-action="parameter-reset">Nuevo / limpiar</button>
          </div>
      </section>` : `<section class="inline-alert warning"><strong>Consulta autorizada.</strong> La administración de ${utils.esc(TYPE_LABELS[draft.type] || "este catálogo")} requiere ${utils.esc(manageCapabilityForType(draft.type))}.</section>`}
      ${fixedType ? "" : `<section class="panel-card ops-parameter-catalog-card">
        <div class="panel-card-head"><div><p class="section-kicker">CONSULTAR / EDITAR</p><h3>${utils.esc(contextualLabel)}</h3></div><span class="status-badge ${catalogUi.queried ? "authorized" : "pending"}">${catalogUi.queried ? "CONSULTA REALIZADA" : "SIN CONSULTAR"}</span></div>
        <form class="ops-catalog-filter-bar" data-ops-parameter-query-form>
          ${fixedType ? `<input type="hidden" name="type" value="${utils.esc(fixedType)}">` : `<label><span>Tipo de parámetro</span><select name="type" required>${typeEntries.map(([value, label]) => `<option value="${utils.esc(value)}" ${catalogUi.type === value ? "selected" : ""}>${utils.esc(label)}</option>`).join("")}</select></label>`}
          <label><span>Buscar</span><input type="search" name="search" value="${utils.esc(catalogUi.search)}" placeholder="Nombre, código, descripción o identificación" autocomplete="off"></label>
          <label><span>Estado</span><select name="status"><option value="ACTIVO" ${catalogUi.status === "ACTIVO" ? "selected" : ""}>Activos</option><option value="INACTIVO" ${catalogUi.status === "INACTIVO" ? "selected" : ""}>Inactivos</option><option value="TODOS" ${catalogUi.status === "TODOS" ? "selected" : ""}>Todos</option></select></label>
          <label><span>Por página</span><select name="pageSize"><option value="25" ${catalogUi.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${catalogUi.pageSize === 50 ? "selected" : ""}>50</option></select></label>
          <button type="submit" class="primary-button" ${catalogUi.loading ? "disabled" : ""}>${catalogUi.loading ? "Consultando…" : "Consultar"}</button>
        </form>
        ${catalogUi.queried && !catalogUi.loading && !catalogUi.error ? `<div class="ops-catalog-query-meta"><span>Mostrando ${utils.number(from)}–${utils.number(to)} de ${utils.number(catalogUi.total)}</span><span>Página ${utils.number(catalogUi.page)} de ${utils.number(pageCount)}</span><span>${utils.number(catalogUi.payloadBytes)} bytes · ${utils.number(Math.round(catalogUi.elapsedMs))} ms</span></div>` : ""}
        ${renderCatalogResult(rows, store, payroll, utils, fixedType)}
        ${catalogUi.queried && !catalogUi.loading && !catalogUi.error && pageCount > 1 ? `<nav class="ops-catalog-pagination" aria-label="Paginación de parámetros"><button type="button" class="secondary-button" data-ops-parameter-query-action="page" data-page="${catalogUi.page - 1}" ${catalogUi.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${utils.number(catalogUi.page)} / ${utils.number(pageCount)}</span><button type="button" class="secondary-button" data-ops-parameter-query-action="page" data-page="${catalogUi.page + 1}" ${catalogUi.page >= pageCount ? "disabled" : ""}>Siguiente</button></nav>` : ""}
      </section>`}
      </div>
    `;
  }

  async function loadPayrollV2(force = false) {
    if (payrollUi.loading || (payrollUi.loaded && !force)) return;
    payrollUi.loading = true;
    payrollUi.error = "";
    try {
      const health = await payrollService()?.health?.({ force });
      if (!health?.ok) throw new Error(health?.message || "Nómina V2 no disponible.");
      const refreshed = await payrollService()?.refresh?.();
      if (!refreshed?.ok) throw new Error(refreshed?.message || "No se pudieron leer los empleados V2.");
      payrollUi.loaded = true;
    } catch (error) {
      payrollUi.loaded = false;
      payrollUi.error = error?.message || "No se pudo verificar Nómina V2.";
    } finally {
      payrollUi.loading = false;
      if (isParameterRoute()) BlessERP.layout?.renderPage?.();
    }
  }

  async function queryCatalog(page = 1, form = null) {
    const repository = catalogRepository();
    if (!repository?.list) {
      catalogUi.queried = true;
      catalogUi.error = "El repositorio de consulta de parámetros no está disponible.";
      BlessERP.layout?.renderPage?.();
      return { ok: false, message: catalogUi.error };
    }
    if (form) {
      const values = new FormData(form);
      catalogUi.type = String(values.get("type") || "varieties");
      catalogUi.search = String(values.get("search") || "").trim();
      catalogUi.status = String(values.get("status") || "ACTIVO").toUpperCase();
      catalogUi.pageSize = repository.normalizePageSize?.(values.get("pageSize")) || 25;
    }
    catalogUi.page = Math.max(1, Number(page || 1));
    catalogUi.queried = true;
    catalogUi.loading = true;
    catalogUi.error = "";
    catalogUi.detailId = "";
    catalogUi.historyId = "";
    catalogUi.historyRows = [];
    const requestId = ++catalogUi.requestId;
    const result = await repository.list({
      type: catalogUi.type,
      search: catalogUi.search,
      status: catalogUi.status,
      page: catalogUi.page,
      pageSize: catalogUi.pageSize
    });
    if (requestId !== catalogUi.requestId) return { ok: false, stale: true };
    catalogUi.loading = false;
    if (!result?.ok) {
      catalogUi.rows = [];
      catalogUi.total = 0;
      catalogUi.error = result?.message || "No se pudo consultar el catálogo.";
    } else {
      catalogUi.rows = result.rows || [];
      catalogUi.total = Number(result.total || 0);
      catalogUi.page = Number(result.page || catalogUi.page);
      catalogUi.pageSize = Number(result.pageSize || catalogUi.pageSize);
      catalogUi.elapsedMs = Number(result.elapsedMs || 0);
      catalogUi.payloadBytes = Number(result.payloadBytes || 0);
    }
    BlessERP.layout?.renderPage?.();
    return result;
  }

  async function queryHistory(type, recordId) {
    catalogUi.historyId = String(recordId || "");
    catalogUi.historyLoading = true;
    catalogUi.historyRows = [];
    catalogUi.historyError = "";
    BlessERP.layout?.renderPage?.();
    const result = await catalogRepository()?.history?.({ type, recordId });
    catalogUi.historyLoading = false;
    if (result?.ok) catalogUi.historyRows = result.rows || [];
    else catalogUi.historyError = result?.message || "No se pudo consultar el historial individual.";
    if (isParameterRoute()) BlessERP.layout?.renderPage?.();
    return result;
  }

  function queriedRecord(type, id) {
    return catalogUi.rows.find(item => (
      String(item.type) === String(type) && String(item.id) === String(id)
    )) || null;
  }

  function setCanonicalDraft(appState, record) {
    if (!record) return false;
    const store = BlessERP.operacionesState.getStore(appState);
    store.ui.parameterType = String(record.type || catalogUi.type);
    store.ui.parameterDraft = { ...record, type: store.ui.parameterType };
    return true;
  }

  function editCanonicalParameter(appState, type, id) {
    if (!catalogRepository()?.isCanonicalEditableType?.(type)) return false;
    return setCanonicalDraft(appState, queriedRecord(type, id));
  }

  function applyCanonicalResult(appState, type, result, options = {}) {
    if (!result?.ok || !result.record) return false;
    const record = { ...result.record, type };
    const store = BlessERP.operacionesState.getStore(appState);
    BlessERP.operacionesState.syncCatalogsFromMasterData?.(store);
    const index = catalogUi.rows.findIndex(item => String(item.id) === String(record.id));
    const visible = matchesCatalogQuery(record, type);
    if (!visible && index >= 0) {
      catalogUi.rows.splice(index, 1);
      catalogUi.total = Math.max(0, catalogUi.total - 1);
    } else if (visible && index >= 0) {
      catalogUi.rows[index] = record;
    } else if (visible && catalogUi.queried && catalogUi.page === 1 && type === catalogUi.type) {
      catalogUi.rows.unshift(record);
      catalogUi.rows = catalogUi.rows.slice(0, catalogUi.pageSize);
      catalogUi.total += 1;
    }
    if (options.keepDraft) setCanonicalDraft(appState, record);
    return true;
  }

  async function saveCanonicalParameter(appState, type, options = {}) {
    if (!catalogRepository()?.isCanonicalEditableType?.(type)) return null;
    const stateApi = BlessERP.operacionesState;
    const store = stateApi.getStore(appState);
    const result = await catalogRepository().save(type, store.ui.parameterDraft || {});
    if (!result?.ok) {
      stateApi.setNotice(appState, result?.message || "No se pudo confirmar el parámetro en Supabase.", "warning", false);
      return result;
    }
    applyCanonicalResult(appState, type, result, { keepDraft: options.keepDraft === true });
    if (options.keepDraft !== true) resetCanonicalDraft(appState, type);
    stateApi.setNotice(appState, `Parámetro confirmado por Supabase: ${result.record.name}.`, "success", false);
    BlessERP.performance?.invalidateCache?.("ops-catalogs:");
    return result;
  }

  async function setCanonicalParameterActive(appState, type, id) {
    if (!catalogRepository()?.isCanonicalEditableType?.(type)) return null;
    const stateApi = BlessERP.operacionesState;
    const current = queriedRecord(type, id);
    if (!current) return { ok: false, mode: "NOT_QUERIED", message: "Consulte nuevamente el registro canónico." };
    const result = await catalogRepository().setActive(type, current, current.active === false);
    if (!result?.ok) {
      stateApi.setNotice(appState, result?.message || "No se pudo confirmar el estado en Supabase.", "warning", false);
      return result;
    }
    applyCanonicalResult(appState, type, result);
    stateApi.setNotice(appState, `${result.record.name}: ${result.record.active !== false ? "ACTIVO" : "INACTIVO"}, confirmado por Supabase.`, "success", false);
    BlessERP.performance?.invalidateCache?.("ops-catalogs:");
    return result;
  }

  function noteLocalMutation(appState, type, id) {
    if (!catalogUi.queried || String(type) !== String(catalogUi.type)) return false;
    const store = BlessERP.operacionesState.getStore(appState);
    const local = (store.masterData?.[type] || []).find(item => String(item.id) === String(id));
    const index = catalogUi.rows.findIndex(item => String(item.id) === String(id));
    if (!local || !matchesCatalogQuery({ ...local, type }, type)) {
      if (index < 0) return false;
      catalogUi.rows.splice(index, 1);
      catalogUi.total = Math.max(0, catalogUi.total - 1);
      if (catalogUi.detailId === String(id)) catalogUi.detailId = "";
      if (catalogUi.historyId === String(id)) catalogUi.historyId = "";
      return true;
    }
    const next = { ...(index >= 0 ? catalogUi.rows[index] : {}), ...local, type };
    if (index >= 0) catalogUi.rows[index] = next;
    else if (catalogUi.page === 1) {
      catalogUi.rows.unshift(next);
      catalogUi.rows = catalogUi.rows.slice(0, catalogUi.pageSize);
      catalogUi.total += 1;
    }
    return true;
  }

  function mount(container, appState) {
    mountController?.abort?.();
    mountController = new AbortController();
    const { signal } = mountController;
    if (!fixedTypeForRoute() && !payrollUi.loaded && !payrollUi.loading && !payrollUi.error) {
      queueMicrotask(() => loadPayrollV2());
    }
    container.querySelectorAll("[data-ops-payroll-link]").forEach(button => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const type = String(button.dataset.type || "");
      const role = PAYROLL_LINK_TYPES[type];
      const store = BlessERP.operacionesState.getStore(appState);
      const worker = (store.masterData?.[type] || []).find(item => String(item.id) === String(button.dataset.id || ""));
      const employeeId = String(container.querySelector("[data-ops-payroll-employee]")?.value || "").trim();
      if (!role || !worker || !employeeId) return BlessERP.layout?.toast?.("Seleccione un empleado V2.");
      button.disabled = true;
      const result = await payrollService()?.linkOperationalRole?.({
        employeeId,
        operationalRole: role,
        operationalWorkerId: operationalWorkerId(worker),
        validFrom: new Date().toISOString().slice(0, 10)
      });
      BlessERP.layout?.toast?.(result?.ok ? "Vínculo Empleado V2 confirmado por Supabase." : (result?.message || "No se pudo confirmar el vínculo V2."));
      if (result?.ok) BlessERP.layout?.renderPage?.();
      else button.disabled = false;
    }, { signal }));

    container.querySelector("[data-ops-parameter-query-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      if (!isParameterRoute()) return;
      void queryCatalog(1, event.currentTarget);
    }, { signal });

    container.addEventListener("click", event => {
      if (!isParameterRoute()) return;
      const action = event.target.closest("[data-ops-parameter-query-action]");
      if (!action) return;
      const intention = String(action.dataset.opsParameterQueryAction || "");
      if (intention === "page") {
        action.disabled = true;
        void queryCatalog(Number(action.dataset.page || 1));
        return;
      }
      if (intention === "detail") {
        catalogUi.detailId = String(action.dataset.id || "");
        catalogUi.historyId = "";
        BlessERP.layout?.renderPage?.();
        return;
      }
      if (intention === "close-detail") {
        catalogUi.detailId = "";
        BlessERP.layout?.renderPage?.();
        return;
      }
      if (intention === "history") {
        void queryHistory(String(action.dataset.type || ""), String(action.dataset.id || ""));
        return;
      }
      if (intention === "close-history") {
        catalogUi.historyId = "";
        catalogUi.historyRows = [];
        catalogUi.historyError = "";
        BlessERP.layout?.renderPage?.();
        return;
      }
      if (intention === "edit") {
        const type = String(action.dataset.type || "");
        const id = String(action.dataset.id || "");
        if (editCanonicalParameter(appState, type, id)) {
          BlessERP.layout?.renderPage?.();
        }
      }
    }, { signal });
  }

  function unmount() {
    mountController?.abort?.();
    mountController = null;
    clearPendingVarietyImage();
  }

  if (!window.__OPS_PARAMETERS_PAYROLL_V2_REALTIME_BOUND__) {
    window.__OPS_PARAMETERS_PAYROLL_V2_REALTIME_BOUND__ = true;
    let refreshTimer = 0;
    window.addEventListener("erp:canonical-record-updated", event => {
      if (!String(event.detail?.entity || "").startsWith("payroll_v2_")) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(async () => {
        await payrollService()?.refresh?.();
        if (isParameterRoute()) BlessERP.layout?.renderPage?.();
      }, 120);
    });
  }

  if (!window.__OPS_PARAMETERS_SEARCH_REALTIME_BOUND__) {
    window.__OPS_PARAMETERS_SEARCH_REALTIME_BOUND__ = true;
    window.addEventListener("erp:canonical-record-updated", event => {
      const repository = catalogRepository();
      const type = repository?.typeForEntity?.(event.detail?.entity);
      if (!type) return;
      const appState = BlessERP.state?.state;
      const store = appState ? BlessERP.operacionesState?.getStore?.(appState) : null;
      if (store) BlessERP.operacionesState.syncCatalogsFromMasterData?.(store);
      if (!isParameterRoute()) return;
      event.preventDefault?.();
      if (!catalogUi.queried || type !== catalogUi.type) return;
      const recordId = String(event.detail?.recordId || "");
      const index = catalogUi.rows.findIndex(item => String(item.id) === recordId || String(item.__canonicalRecordId) === recordId);
      const serverRecord = event.detail?.serverRecord || {};
      if (serverRecord.deleted_at) {
        if (index < 0) return;
        catalogUi.rows.splice(index, 1);
        catalogUi.total = Math.max(0, catalogUi.total - 1);
      } else {
        const next = repository.mapRecord?.(serverRecord, type);
        if (!matchesCatalogQuery(next, type)) {
          if (index < 0) return;
          catalogUi.rows.splice(index, 1);
          catalogUi.total = Math.max(0, catalogUi.total - 1);
        } else if (index >= 0) {
          catalogUi.rows[index] = next;
        } else {
          catalogUi.total += 1;
          if (catalogUi.page === 1) {
            catalogUi.rows.unshift(next);
            catalogUi.rows = catalogUi.rows.slice(0, catalogUi.pageSize);
          }
        }
      }
      BlessERP.layout?.renderPage?.();
    });
  }

  BlessERP.operacionesParametros = {
    render,
    mount,
    unmount,
    loadPayrollV2,
    operationalWorkerId,
    queryCatalog,
    queryHistory,
    queriedRecord,
    editCanonicalParameter,
    saveCanonicalParameter,
    setCanonicalParameterActive,
    applyCanonicalResult,
    noteLocalMutation,
    isParameterRoute,
    manageCapabilityForType,
    canManageType,
    assertManageType,
    resetCanonicalDraft,
    stagePendingVarietyImage,
    clearPendingVarietyImage,
    pendingVarietyImage: () => ({ file: pendingVarietyImageFile, url: pendingVarietyImageUrl }),
    queryState: () => ({ ...catalogUi, rows: [...catalogUi.rows], historyRows: [...catalogUi.historyRows] })
  };
})();
