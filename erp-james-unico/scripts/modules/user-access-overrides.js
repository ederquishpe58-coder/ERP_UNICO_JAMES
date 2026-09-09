(function () {
  const erp = window.BlessERP = window.BlessERP || {};
  const esc = value => erp.utils.esc(String(value ?? ""));
  let generation = 0;
  window.addEventListener?.("erp:company-changed", () => { generation++; });
  const activeCompany = () => erp.authAccess?.activeAccess?.()?.activeCompanyKey || "";
  const display = () => erp.capabilityPresentation;
  const technical = (id, translated = true) => translated
    ? '<code class="access-technical-name">' + esc(id) + '</code>'
    : '<code class="access-untranslated-name">' + esc(id) + '</code>';
  function groupedPermissions(rows, sourceFor = () => '') {
    const groups = new Map();
    [...rows].sort(display().compare).forEach(row => {
      const item = display().capability(row);
      if (!groups.has(item.module)) groups.set(item.module, []);
      groups.get(item.module).push({ row, item });
    });
    return [...groups].map(([name, items]) => {
      const categories = [...new Set(items.map(({ item }) => item.category))];
      return '<details class="access-effective-group"><summary>' + esc(name) + ' · ' + items.length + ' permisos <small>' + esc(categories.join(' · ')) + '</small></summary><ul>'
        + items.map(({ row, item }) => '<li><div><strong>' + esc(item.label) + '</strong><small>' + esc(item.description) + '</small>' + technical(row.capability_id, item.translated) + '</div><span class="access-origin">' + esc(sourceFor(row)) + '</span></li>').join('') + '</ul></details>';
    }).join('') || '<p>Ninguno.</p>';
  }
  function summary(result) {
    const capabilities = result.effective_capabilities.map(row => row.capability_id);
    const flag = pattern => capabilities.some(id => pattern.test(id)) ? 'SÍ' : 'NO';
    const grants = result.overrides.filter(row => row.effect === 'GRANT');
    const denies = result.overrides.filter(row => row.effect === 'DENY');
    const granted = new Set(grants.map(row => row.capability_id));
    const profile = display().profile(result.profiles?.find(p => p.profile_id === result.profile_id) || result.profile_id || '');
    return '<strong>Perfil base: ' + esc(profile.label) + '</strong><p>' + esc(profile.description) + '</p>' + technical(result.profile_id || 'PROFILE_MISSING', profile.translated)
      + '<div>Base: ' + result.base_capabilities.length + ' · Permisos adicionales: ' + grants.length + ' · Bloqueados: ' + denies.length + '</div>'
      + '<p class="access-effective-count">Resultado: <strong>' + capabilities.length + '</strong> permisos efectivos</p>'
      + '<div>Administración de usuarios: ' + flag(/^admin\.users\./) + ' · SRI: ' + flag(/^(tax\.|commercial\.(electronic_documents|credit_notes|senae_liquidation)\.)/) + ' · Tesorería: ' + flag(/^treasury\./) + ' · Contabilidad: ' + flag(/^accounting\./) + '</div>'
      + '<details><summary>Permisos del perfil base (' + result.base_capabilities.length + ')</summary>' + groupedPermissions(result.base_capabilities, () => '✓ Perfil base') + '</details>'
      + '<details><summary>+ Permisos adicionales (' + grants.length + ')</summary>' + groupedPermissions(grants, () => '+ Permiso adicional') + '</details>'
      + '<details><summary>− Permisos bloqueados (' + denies.length + ')</summary>' + groupedPermissions(denies, () => '− Bloqueado') + '</details>'
      + '<h4>Acceso efectivo por módulo</h4>' + groupedPermissions(result.effective_capabilities, row => granted.has(row.capability_id) ? '+ Permiso adicional' : '✓ Perfil base');
  }
  function catalogMarkup(rows, effects) {
    const groups = new Map();
    [...rows].sort(display().compare).forEach(row => {
      const item = display().capability(row);
      const key = item.module + ' · ' + item.category;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, item });
    });
    return [...groups].map(([name, items]) => '<section data-access-category><h4>' + esc(name) + '</h4>' + items.map(({ row, item }) => {
      const id = row.capability_id;
      return '<div class="access-permission-row" data-access-row="' + esc(id) + '"><div><strong>' + esc(item.label) + '</strong><small>' + esc(item.description) + '</small>' + technical(id, item.translated) + '</div><label class="access-permission-choice"><span class="access-origin" data-access-origin></span><select aria-label="' + esc(item.label) + '" data-access-plan-capability="' + esc(id) + '"><option value="">Por perfil</option><option value="GRANT" ' + (effects.get(id) === 'GRANT' ? 'selected' : '') + '>PERMITIR</option><option value="DENY" ' + (effects.get(id) === 'DENY' ? 'selected' : '') + '>BLOQUEAR</option></select></label></div>';
    }).join('') + '</section>').join('');
  }
  function mount(root, { targetUserId, companyKey, onConfirmed, openImmediately = false }) {
    if (!root) return;
    root.classList.add("user-access-plan");
    const epoch = ++generation;
    const current = () => root.isConnected && epoch === generation && activeCompany() === companyKey;
    const canManage = () => erp.capabilityRuntime?.can?.("admin.users.manage") === true;
    const scope = { targetUserId, companyKey };
    let loaded = null, preview = null, pending = null, busy = false, reviewed = null;
    root.innerHTML = `<h4>Permisos específicos de esta empresa</h4><button type="button" class="secondary-button" data-access-plan-open>Consultar perfil y permisos</button><div data-access-plan-body></div><div data-access-plan-feedback role="status" aria-live="polite"></div>`;
    const open = root.querySelector("[data-access-plan-open]");
    open.disabled = !current() || !canManage();
    const feedback = (text, fail = false) => {
      const node = root.querySelector("[data-access-plan-feedback]");
      node.className = `inline-feedback ${fail ? "danger" : "success"}`;
      node.textContent = text;
    };
    const invalidate = () => { preview = null; pending = null; const notice = root.querySelector("[data-access-review-stale]"); if (notice) notice.hidden = false; const button = root.querySelector("[data-access-plan-save]"); if (button) button.disabled = true; };
    async function run(task) {
      if (busy) return;
      if (!current() || !canManage()) { feedback("SECURITY_COMPANY_CONTEXT_MISMATCH: vuelva a abrir el usuario en la empresa activa.", true); return; }
      busy = true;
      const controls = [...root.querySelectorAll("button,select,input,textarea")].map(node => [node, node.disabled]);
      controls.forEach(([node]) => { node.disabled = true; });
      feedback("Consultando servidor...");
      try { await task(); }
      catch (error) { if (current()) feedback(error?.message || "No se pudo confirmar el acceso con el servidor.", true); }
      finally { busy = false; if (current()) { controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; }); const save = root.querySelector("[data-access-plan-save]"); if (save) save.disabled = !preview; } }
    }
    const requireResult = result => { if (!result?.ok) throw new Error(result?.errors?.join(" · ") || "CANONICAL_ACCESS_PLAN_NOT_CONFIRMED"); return result.data; };
    function input() {
      if (loaded?.can_edit !== true) throw new Error("Estos permisos son de solo lectura. Solicite el cambio a otro administrador autorizado de esta empresa.");
      const reason = root.querySelector("[data-access-plan-reason]").value.trim();
      if (!reason) throw new Error("Indique el motivo del cambio.");
      const profileId = root.querySelector("[data-access-plan-profile]").value;
      if (!profileId) throw new Error("Seleccione un perfil canónico.");
      const overrides = [...root.querySelectorAll("[data-access-plan-capability]")]
        .filter(node => node.value).map(node => ({ capability_id: node.dataset.accessPlanCapability, effect: node.value, reason }));
      return { ...scope, profileId, overrides, reason };
    }
    const loadCatalog = () => run(async () => {
      loaded = requireResult(await erp.remoteUserAccess.previewAccessPlan(scope));
      reviewed = loaded;
      if (!current()) return;
      if (!Array.isArray(loaded.profiles) || !loaded.profiles.length) {
        throw new Error("CANONICAL_PROFILE_CATALOG_EMPTY: no hay perfiles canónicos disponibles. Vuelva a consultar el servidor.");
      }
      // Separate this atomic membership plan from the legacy identity/multi-company editor.
      const editor = root.closest(".user-access-editor");
      editor?.querySelectorAll("input,select,textarea,button").forEach(node => {
        if (!root.contains(node) && !node.matches("[data-user-cancel]")) node.disabled = true;
      });
      open.hidden = true;
      const effects = new Map(loaded.overrides.map(row => [row.capability_id, row.effect]));
      root.querySelector("[data-access-plan-body]").innerHTML = `<p>Empresa: ${esc(companyKey)}.</p>
        ${loaded.can_edit === true ? "" : '<p role="note">Puede consultar sus permisos. Para cambiarlos, solicítelo a otro administrador autorizado de esta empresa. La protección contra autoelevación permanece activa.</p>'}
        <label class="compact-field">Perfil base<select data-access-plan-profile><option value="">Seleccione un perfil</option>${loaded.profiles.map(p => `<option value="${esc(p.profile_id)}" ${p.profile_id === loaded.profile_id ? "selected" : ""}>${esc(display().profile(p).label)}</option>`).join("")}</select></label>
        <div data-access-profile-description></div>
        <p>Bloquear prevalece sobre permitir y sobre el perfil base. Los permisos se confirman en el servidor.</p>
        <label class="access-technical-toggle"><input type="checkbox" data-access-technical-toggle> Ver nombres técnicos</label>
        <details open><summary>Permisos específicos</summary>
          <p><strong>PERMITIR</strong>: agrega este permiso aunque el perfil base no lo incluya.<br><strong>BLOQUEAR</strong>: quita este permiso aunque el perfil base lo incluya.</p>
          <label class="compact-field">Buscar permiso<input type="search" data-access-search placeholder="Ej.: etiqueta, recepción, operations.labels" autocomplete="off"></label>
          <small data-access-search-count role="status" aria-live="polite"></small>
          <div class="access-permission-catalog">${catalogMarkup(loaded.capability_catalog, effects)}</div>
        </details>
        <label class="compact-field">Motivo del cambio<input data-access-plan-reason maxlength="1000" required></label>
        <button type="button" class="secondary-button" data-access-plan-preview>Revisar acceso efectivo</button>
        <button type="button" class="primary-button" data-access-plan-save disabled>Guardar perfil y permisos</button>
        <p data-access-review-stale hidden>Hay cambios pendientes de revisión. El resumen muestra el último acceso confirmado por el servidor.</p>
        <div data-access-plan-summary>${summary(loaded)}</div>`;
      const updatePresentation = () => {
        const selected = root.querySelector("[data-access-plan-profile]").value;
        const profile = display().profile(loaded.profiles.find(p => p.profile_id === selected) || selected);
        root.querySelector("[data-access-profile-description]").innerHTML = '<p>' + esc(profile.description) + '</p>' + technical(selected || 'PROFILE_MISSING', profile.translated);
        const sameProfile = reviewed?.profile_id === selected;
        const base = new Set(sameProfile ? reviewed.base_capabilities.map(row => row.capability_id) : []);
        root.querySelectorAll("[data-access-row]").forEach(row => {
          const control = row.querySelector("[data-access-plan-capability]");
          const effect = control.value;
          row.dataset.accessEffect = effect || (sameProfile && base.has(control.dataset.accessPlanCapability) ? 'PROFILE' : 'NONE');
          row.querySelector("[data-access-origin]").textContent = effect === 'DENY' ? '− Bloqueado específicamente' : effect === 'GRANT' ? '+ Permitido específicamente' : !sameProfile ? 'Por perfil · pendiente de revisión' : base.has(control.dataset.accessPlanCapability) ? '✓ Heredado del perfil' : 'Sin permiso en el perfil';
        });
      };
      const filter = () => {
        const query = root.querySelector("[data-access-search]").value;
        const catalog = new Map(loaded.capability_catalog.map(row => [row.capability_id, row]));
        let shown = 0;
        root.querySelectorAll("[data-access-row]").forEach(row => { row.hidden = !display().matches(catalog.get(row.dataset.accessRow), query); if (!row.hidden) shown++; });
        root.querySelectorAll("[data-access-category]").forEach(group => { group.hidden = ![...group.querySelectorAll("[data-access-row]")].some(row => !row.hidden); });
        root.querySelector("[data-access-search-count]").textContent = shown ? shown + ' de ' + loaded.capability_catalog.length + ' permisos' : 'No se encontraron permisos. Pruebe otro nombre o código.';
      };
      root.querySelector("[data-access-search]").addEventListener("input", filter);
      root.querySelector("[data-access-technical-toggle]").addEventListener("change", event => root.classList.toggle("show-technical-names", event.target.checked));
      root.querySelectorAll("[data-access-plan-profile],[data-access-plan-capability],[data-access-plan-reason]").forEach(node => {
        node.addEventListener("input", () => { invalidate(); updatePresentation(); });
        if (node.tagName === 'SELECT') node.addEventListener("change", () => { invalidate(); updatePresentation(); });
      });
      updatePresentation(); filter();
      root.querySelector("[data-access-plan-preview]").addEventListener("click", () => run(async () => {
        const desired = input();
        const result = requireResult(await erp.remoteUserAccess.previewAccessPlan(desired));
        if (!current()) return;
        if (result.state_token !== loaded.state_token) throw new Error("Los permisos cambiaron en el servidor. Cierre y vuelva a abrir el editor antes de guardar.");
        preview = result; reviewed = result;
        root.querySelector("[data-access-review-stale]").hidden = true;
        updatePresentation();
        pending = { ...desired, expectedVersion: result.state_token, operationId: window.crypto.randomUUID() };
        root.querySelector("[data-access-plan-summary]").innerHTML = summary(result);
        feedback("Vista previa confirmada por servidor. Revise el acceso efectivo antes de guardar.");
      }));
      root.querySelector("[data-access-plan-save]").addEventListener("click", () => run(async () => {
        if (!preview || !pending) throw new Error("Revise el plan antes de guardar.");
        const result = requireResult(await erp.remoteUserAccess.saveAccessPlan(pending));
        if (!current()) return;
        loaded = result; reviewed = result;
        preview = null; pending = null;
        root.querySelector("[data-access-plan-summary]").innerHTML = summary(result);
        feedback("Perfil y permisos guardados; segunda lectura canónica confirmada.");
        onConfirmed?.(result);
      }));
      if (loaded.can_edit !== true) {
        root.querySelectorAll("[data-access-plan-profile],[data-access-plan-capability],[data-access-plan-reason],[data-access-plan-preview],[data-access-plan-save]").forEach(node => { node.disabled = true; });
      }
      feedback("Acceso actual leído del servidor. No se han guardado cambios.");
    });
    open.addEventListener("click", loadCatalog);
    if (openImmediately) void loadCatalog();
  }
  erp.userAccessOverrides = { mount };
})();
