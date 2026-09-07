(function () {
  const ERP = window.BlessERP = window.BlessERP || {};
  let active = null;
  const bound = new WeakSet();
  function failure(error) {
    const code = String(error?.code || error?.message || "REQUEST_FAILED");
    const safe = /^[A-Z0-9_: .áéíóúñ-]{1,140}$/i.test(code) ? code : "REQUEST_FAILED";
    const capability = error?.details?.capability_id;
    return `ERROR = ${safe}` + (["tax.parameters.manage", "admin.sequences.manage"].includes(capability)
      ? `\nPermiso requerido en esta empresa: ${capability}. Solicite revisión a un administrador autorizado.` : "")
      + (code === "AUTHORIZATION_CHECK_FAILED" ? "\nNo se pudo verificar la autorización en el servidor. Vuelva a revisar el estado." : "");
  }
  function state() {
    const company = ERP.sriApi?.certificatePrecheckCompany?.();
    if (!company) { active = null; return null; }
    if (active?.company !== company) active = { company, message: "Revise la configuración canónica antes de aplicar.", pending: false, reviewed: null, checkedFile: null, file: null, confirmation: "" };
    return active;
  }
  function render() {
    if (!state()) return "";
    return `<section class="panel-card" data-sri-test-apply>
      <h3>Configuración SRI TEST</h3>
      <p>Revisión, precheck y aplicación requieren permisos de parámetros tributarios y administración de secuencias en esta empresa.</p>
      <p><strong style="color:#b91c1c">SRI PRODUCCIÓN PERMANECERÁ DESACTIVADO</strong></p>
      <button type="button" class="secondary-button" data-sri-test-review>REVISAR CONFIGURACIÓN SRI TEST</button>
      <pre data-sri-test-summary></pre>
      <label>Certificado .p12 / .pfx de la empresa actual (máximo 3 MB)
        <input type="file" accept=".p12,.pfx" data-sri-test-file>
      </label>
      <p>El precheck no guarda el archivo. Solo el apply confirmado lo guardará en el almacenamiento privado de esta empresa.</p>
      <button type="button" class="secondary-button" data-sri-test-precheck>VALIDAR PRECHECK</button>
      <label>Para confirmar, escriba ACTIVAR TEST
        <input type="text" autocomplete="off" spellcheck="false" data-sri-test-confirmation>
      </label>
      <button type="button" class="primary-button" data-sri-test-submit disabled>APLICAR SRI TEST</button>
      <pre role="status" aria-live="polite" data-sri-test-result></pre>
    </section>`;
  }
  function bind(container) {
    const panel = container.querySelector("[data-sri-test-apply]"), s = state();
    if (!panel || !s) return;
    s.panel = panel;
    const el = name => s.panel?.querySelector(`[data-sri-test-${name}]`);
    function sync() {
      if (active !== s) return;
      const current = s.reviewed;
      if (el("summary")) el("summary").textContent = current ? [
        `Empresa: ${current.plan.company}`, `TEST: ${current.test_enabled ? "ON" : "OFF"} | PROD: OFF`,
        `Establecimiento: ${current.plan.establishment}`, `LOCAL: ${current.plan.local}`, `EXPORT: ${current.plan.export}`,
        `Retención: ${current.plan.retention}`, ...current.plan.sequences.map(q => `${q.point} / ${q.type}: primero ${q.first}`),
        `Filas de configuración: ${current.plan.config_rows}; certificado privado: 1`,
        `Certificado precheck: ${s.checkedFile && s.checkedFile === s.file ? "PASS" : "PENDIENTE"}`
      ].join("\n") : "Estado actual: pendiente de consulta al servidor.";
      if (el("result")) el("result").textContent = s.message;
      for (const name of ["review","precheck","file","confirmation"]) if (el(name)) el(name).disabled = s.pending;
      if (el("confirmation") && el("confirmation").value !== s.confirmation) el("confirmation").value = s.confirmation;
      if (el("precheck")) el("precheck").disabled = s.pending;
      if (el("submit")) el("submit").disabled = s.pending || !current || current.test_enabled || !s.file || s.file !== s.checkedFile || s.confirmation !== "ACTIVAR TEST";
    }
    sync(); if (bound.has(panel)) return; bound.add(panel);
    el("file").addEventListener("change", event => { s.file = event.target.files?.[0] || null; s.checkedFile = null; s.confirmation = ""; sync(); });
    el("confirmation").addEventListener("input", event => { s.confirmation = event.target.value; sync(); });
    async function run(mode) {
      if (s.pending || active !== s || ERP.sriApi.certificatePrecheckCompany() !== s.company) return;
      const selected = s.file;
      if (mode === "precheck" && (!s.reviewed || !selected || s.reviewed.test_enabled)) {
        const reason = !s.reviewed ? (s.reviewError || "ERROR = REVIEW_REQUIRED\nPrimero revise la configuración SRI TEST.")
          : s.reviewed.test_enabled ? "ERROR = ALREADY_APPLIED\nSRI TEST ya está aplicado. Revise la configuración actual."
          : "ERROR = CERTIFICATE_REQUIRED\nSeleccione el certificado .p12 / .pfx de esta empresa.";
        s.checkedFile = null; s.message = `PRECHECK = FAIL\n${reason}`; sync(); return;
      }
      if (mode === "apply" && (!s.reviewed || s.checkedFile !== selected || s.confirmation !== "ACTIVAR TEST")) { s.message = "APPLY = FAIL\nERROR = PRECHECK_REQUIRED"; sync(); return; }
      s.pending = true; s.message = mode === "apply" ? "APLICANDO SRI TEST…" : "VALIDANDO…"; sync();
      try {
        const action = ({ review: "review", precheck: "precheck", apply: "apply" })[mode] + "-sri-test-configuration";
        const result = await ERP.sriApi.testConfigurationRequest(action, s.company, s.reviewed?.approved_plan_hash, s.confirmation, selected);
        if (active !== s || ERP.sriApi.certificatePrecheckCompany() !== s.company) return;
        if (mode === "review") { s.reviewed = result; s.reviewError = null; s.checkedFile = null; s.message = "PLAN = PASS\nRevise los datos, seleccione el certificado y valide el precheck."; }
        else if (mode === "precheck") { s.checkedFile = result.status === "PASS" ? selected : null; s.message = `PRECHECK = ${result.status === "PASS" ? "PASS" : "FAIL"}\nCertificado = ${result.certificate || "PENDIENTE"}\nRUC = ${result.ruc_match || "PENDIENTE"}\nWrites = 0` + (result.status !== "PASS" ? `\n${failure({ code: result.error || result.status })}` : "") + (result.recovery_required ? "\nHay una operación incompleta. El siguiente click ejecutará su rollback; después deberá revisar y confirmar nuevamente." : ""); }
        else {
          s.reviewed.test_enabled = result.test_enabled;
          s.message = [`APPLY = ${result.status}`,`COMPANY = ${s.reviewed.plan.company}`,`TEST = ${result.test_enabled === null ? "REQUIERE VERIFICACIÓN" : result.test_enabled ? "ON" : "OFF"}`,"PROD = OFF",`ROWS = ${result.rows ?? "REVISAR ESTADO"}`,`STORAGE = ${result.storage ?? "REVISAR ESTADO"}`,"SEQUENCES CONSUMED = 0","DOCUMENTS CREATED = 0",`ERROR = ${result.error || "NONE"}`].join("\n");
        }
      } catch (error) {
        if (active === s) {
          const reason = failure(error);
          if (mode === "review") { s.reviewed = null; s.reviewError = reason; }
          s.message = `${mode === "apply" ? "APPLY" : mode === "review" ? "PLAN" : "PRECHECK"} = FAIL\n${reason}\nRevise el estado antes de reintentar.`;
          s.checkedFile = null;
        }
      } finally {
        s.pending = false;
        if (mode === "apply") { s.file = null; s.checkedFile = null; s.confirmation = ""; if (el("file")) el("file").value = ""; }
        sync();
      }
    }
    el("review").addEventListener("click", () => run("review"));
    el("precheck").addEventListener("click", () => run("precheck"));
    el("submit").addEventListener("click", () => run("apply"));
  }
  ERP.sriTestApply = { render, bind };
})();
