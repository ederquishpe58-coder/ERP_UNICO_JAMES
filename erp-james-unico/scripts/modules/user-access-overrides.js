(function () {
  const erp = window.BlessERP = window.BlessERP || {};
  const esc = value => erp.utils.esc(String(value ?? ""));
  let generation = 0;
  window.addEventListener?.("erp:company-changed", () => { generation++; });
  const activeCompany = () => erp.authAccess?.activeAccess?.()?.activeCompanyKey || "";
  function summary(result) {
    const capabilities = result.effective_capabilities.map(row => row.capability_id);
    const flag = pattern => capabilities.some(id => pattern.test(id)) ? "SÍ" : "NO";
    const grants = result.overrides.filter(row => row.effect === "GRANT").map(row => row.capability_id);
    const denies = result.overrides.filter(row => row.effect === "DENY").map(row => row.capability_id);
    return `<strong>Perfil: ${esc(result.profile_id || "SIN PERFIL")}</strong>
      <div>Base: ${result.base_capabilities.length} + GRANT: ${grants.length} − DENY: ${denies.length} = Acceso efectivo: <strong>${capabilities.length}</strong></div>
      <div>Administración de usuarios: ${flag(/^admin\.users\./)} · SRI: ${flag(/^(tax\.|commercial\.(electronic_documents|credit_notes|senae_liquidation)\.)/)} · Tesorería: ${flag(/^treasury\./)} · Contabilidad: ${flag(/^accounting\./)}</div>
      <details><summary>Ver permisos base, agregados, denegados y efectivos</summary>
        <p>BASE: ${esc(result.base_capabilities.map(row => row.capability_id).join(", ") || "Ninguno")}</p>
        <p>GRANT: ${esc(grants.join(", ") || "Ninguno")}</p><p>DENY: ${esc(denies.join(", ") || "Ninguno")}</p>
        <p>EFECTIVOS: ${esc(capabilities.join(", ") || "Ninguno")}</p></details>`;
  }
  function mount(root, { targetUserId, companyKey, onConfirmed }) {
    if (!root) return;
    const epoch = ++generation;
    const current = () => root.isConnected && epoch === generation && activeCompany() === companyKey;
    const canManage = () => erp.capabilityRuntime?.can?.("admin.users.manage") === true;
    const scope = { targetUserId, companyKey };
    let loaded = null, preview = null, pending = null, busy = false;
    root.innerHTML = `<button type="button" class="secondary-button" data-access-plan-open>Perfil y permisos específicos de esta empresa</button><div data-access-plan-body></div><div data-access-plan-feedback role="status" aria-live="polite"></div>`;
    const open = root.querySelector("[data-access-plan-open]");
    open.disabled = !current() || !canManage();
    const feedback = (text, fail = false) => {
      const node = root.querySelector("[data-access-plan-feedback]");
      node.className = `inline-feedback ${fail ? "danger" : "success"}`;
      node.textContent = text;
    };
    const invalidate = () => { preview = null; pending = null; const button = root.querySelector("[data-access-plan-save]"); if (button) button.disabled = true; };
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
      const reason = root.querySelector("[data-access-plan-reason]").value.trim();
      if (!reason) throw new Error("Indique el motivo del cambio.");
      const profileId = root.querySelector("[data-access-plan-profile]").value;
      if (!profileId) throw new Error("Seleccione un perfil canónico.");
      const overrides = [...root.querySelectorAll("[data-access-plan-capability]")]
        .filter(node => node.value).map(node => ({ capability_id: node.dataset.accessPlanCapability, effect: node.value, reason }));
      return { ...scope, profileId, overrides, reason };
    }
    open.addEventListener("click", () => run(async () => {
      loaded = requireResult(await erp.remoteUserAccess.previewAccessPlan(scope));
      if (!current()) return;
      // Separate this atomic membership plan from the legacy identity/multi-company editor.
      const editor = root.closest(".user-access-editor");
      editor?.querySelectorAll("input,select,textarea,button").forEach(node => {
        if (!root.contains(node) && !node.matches("[data-user-cancel]")) node.disabled = true;
      });
      open.hidden = true;
      const effects = new Map(loaded.overrides.map(row => [row.capability_id, row.effect]));
      root.querySelector("[data-access-plan-body]").innerHTML = `<p>Empresa: ${esc(companyKey)}. Se reemplazará el conjunto completo de permisos específicos de esta membresía.</p>
        <label class="compact-field">Perfil canónico<select data-access-plan-profile><option value="">Seleccione</option>${loaded.profiles.map(p => `<option value="${esc(p.profile_id)}" ${p.profile_id === loaded.profile_id ? "selected" : ""}>${esc(p.display_name)} (${esc(p.profile_id)})</option>`).join("")}</select></label>
        <details open><summary>Avanzado / Permisos específicos</summary><div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Capability canónica</th><th>Acceso</th></tr></thead><tbody>${loaded.capability_catalog.map(c => `<tr><td>${esc(c.capability_id)}<small>${esc(c.description)}</small></td><td><select aria-label="${esc(c.capability_id)}" data-access-plan-capability="${esc(c.capability_id)}"><option value="">Por perfil</option><option value="GRANT" ${effects.get(c.capability_id) === "GRANT" ? "selected" : ""}>GRANT / Agregar</option><option value="DENY" ${effects.get(c.capability_id) === "DENY" ? "selected" : ""}>DENY / Denegar</option></select></td></tr>`).join("")}</tbody></table></div></details>
        <label class="compact-field">Motivo del cambio<input data-access-plan-reason maxlength="1000" required></label>
        <button type="button" class="secondary-button" data-access-plan-preview>Revisar acceso efectivo</button>
        <button type="button" class="primary-button" data-access-plan-save disabled>Guardar perfil y permisos</button>
        <div data-access-plan-summary>${summary(loaded)}</div>`;
      root.querySelectorAll("select,input").forEach(node => node.addEventListener("input", invalidate));
      root.querySelectorAll("select").forEach(node => node.addEventListener("change", invalidate));
      root.querySelector("[data-access-plan-preview]").addEventListener("click", () => run(async () => {
        const desired = input();
        const result = requireResult(await erp.remoteUserAccess.previewAccessPlan(desired));
        if (!current()) return;
        preview = result;
        pending = { ...desired, expectedVersion: result.state_token, operationId: window.crypto.randomUUID() };
        root.querySelector("[data-access-plan-summary]").innerHTML = summary(result);
        feedback("Vista previa confirmada por servidor. Revise el acceso efectivo antes de guardar.");
      }));
      root.querySelector("[data-access-plan-save]").addEventListener("click", () => run(async () => {
        if (!preview || !pending) throw new Error("Revise el plan antes de guardar.");
        const result = requireResult(await erp.remoteUserAccess.saveAccessPlan(pending));
        if (!current()) return;
        preview = null; pending = null;
        feedback("Perfil y permisos guardados; segunda lectura canónica confirmada.");
        onConfirmed?.(result);
      }));
      feedback("Acceso actual leído del servidor. No se han guardado cambios.");
    }));
  }
  erp.userAccessOverrides = { mount };
})();
