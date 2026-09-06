(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};

  let activeView = null;
  const boundPanels = new WeakMap();
  function viewFor(companyId) {
    if (activeView?.companyId !== companyId) activeView = { companyId, pending: false, message: "", diagnostic: "", fixture: "01:LOCAL", panel: null };
    return activeView;
  }

  function render() {
    const companyId = BlessERP.sriApi?.certificatePrecheckCompany?.();
    if (!companyId) { activeView = null; return ""; }
    viewFor(companyId);
    return `<section class="panel-card" data-certificate-precheck>
      <h3>Validar certificado SRI</h3>
      <p>Comprueba el certificado de la empresa seleccionada sin guardarlo ni activar SRI.</p>
      <label>Archivo .p12 / .pfx (máximo 3 MB)
        <input type="file" accept=".p12,.pfx" data-certificate-file>
      </label>
      <button type="button" class="secondary-button" data-certificate-validate>Validar certificado</button>
      <label>Prueba de XML y firma en memoria
        <select data-certificate-fixture>
          <option value="01:LOCAL">Factura LOCAL · 001-003</option>
          <option value="01:EXPORT">Factura EXPORTACIÓN · 001-002</option>
          ${companyId === "cf331b82-7ac3-4065-9e38-d0bbcde96cd5" ? '<option value="07">Retención · 001-002</option>' : ''}
        </select>
      </label>
      <button type="button" class="secondary-button" data-certificate-dry-run>Validar XML y firma</button>
      <p>Usa el archivo seleccionado solo en memoria. No guarda certificados ni comprobantes, no consume secuenciales y no transmite al SRI.</p>
      <p role="status" aria-live="polite" data-certificate-result></p>
      <details data-certificate-diagnostic hidden>
        <summary>Diagnóstico seguro de identidad</summary>
        <p>Comparte este diagnóstico para revisar los campos de identidad. No contiene contraseña, clave privada ni archivo.</p>
        <textarea readonly rows="12" aria-label="Diagnóstico seguro del certificado" data-certificate-diagnostic-text></textarea>
      </details>
    </section>`;
  }

  function bind(container) {
    const panel = container.querySelector("[data-certificate-precheck]");
    if (!panel) return;
    const companyId = BlessERP.sriApi.certificatePrecheckCompany();
    const input = panel.querySelector("[data-certificate-file]");
    const button = panel.querySelector("[data-certificate-validate]");
    const dryButton = panel.querySelector("[data-certificate-dry-run]");
    const fixtureSelect = panel.querySelector("[data-certificate-fixture]");
    const output = panel.querySelector("[data-certificate-result]");
    const diagnostic = panel.querySelector("[data-certificate-diagnostic]");
    const diagnosticText = panel.querySelector("[data-certificate-diagnostic-text]");
    const view = viewFor(companyId);
    view.panel = panel;
    const current = () => activeView === view && companyId === BlessERP.sriApi.certificatePrecheckCompany();
    const sync = () => {
      if (!current() || !view.panel?.isConnected) return;
      const target = view.panel;
      target.querySelector("[data-certificate-result]").textContent = view.message;
      target.querySelector("[data-certificate-diagnostic]").hidden = !view.diagnostic;
      target.querySelector("[data-certificate-diagnostic-text]").value = view.diagnostic;
      for (const selector of ["[data-certificate-validate]", "[data-certificate-dry-run]", "[data-certificate-file]", "[data-certificate-fixture]"]) {
        const control = target.querySelector(selector);
        if (control) control.disabled = view.pending;
      }
      const selection = target.querySelector("[data-certificate-fixture]");
      if (selection) selection.value = view.fixture;
    };
    const stage = value => ["PASS", "FAIL", "UNPROVEN", "NOT_EXECUTED"].includes(value) ? value : "NOT_EXECUTED";
    const dryMessage = (result = {}, reason = "") => {
      const confirmed = result.valid === true && result.certificate_validation === "PASS" && result.ruc_match === "PASS"
        && result.xml_build === "PASS" && result.xades_sign === "PASS" && result.schema_validation === "PASS"
        && result.environment === "TEST" && result.writes === 0;
      const stages = ["FIXTURE", "CERTIFICATE", "XML_BUILD", "XSD_UNSIGNED", "XADES", "XSD_SIGNED"];
      const failure = reason || (stages.includes(result.failure_stage) ? result.failure_stage : "INVALID_RESPONSE");
      return `XML DRY RUN = ${confirmed ? "PASS" : "FAIL"}. Certificado: ${stage(result.certificate_validation)}. RUC: ${stage(result.ruc_match)}. XML: ${stage(result.xml_build)}. XAdES: ${stage(result.xades_sign)}. Esquema: ${stage(result.schema_validation)}. Ambiente: TEST. Escrituras: 0. Error: ${confirmed ? "NONE" : failure}.`;
    };
    sync();
    const previous = boundPanels.get(panel);
    if (previous?.view === view) return;
    if (previous) { button.removeEventListener?.("click", previous.cert); dryButton?.removeEventListener?.("click", previous.dry); fixtureSelect?.removeEventListener?.("change", previous.fixture); }
    const syncFixture = () => { if (current() && !view.pending) view.fixture = fixtureSelect.value; };
    fixtureSelect?.addEventListener("change", syncFixture);
    const run = async (dryRun) => {
      if (view.pending) { sync(); return; }
      if (!current()) { input.value = ""; output.textContent = "La empresa cambió. Abra nuevamente Parámetros tributarios."; diagnostic.hidden = true; diagnosticText.value = ""; return; }
      let file = input.files?.[0];
      if (!file) { view.message = dryRun ? dryMessage({}, "CERTIFICATE_FILE_REQUIRED: Seleccione el certificado de esta empresa.") : "Seleccione el certificado de esta empresa."; sync(); return; }
      view.fixture = fixtureSelect?.value || view.fixture;
      view.pending = true;
      view.message = dryRun ? "VALIDANDO XML Y FIRMA…" : "Validando certificado…";
      view.diagnostic = "";
      sync();
      try {
        const [type, context] = view.fixture.split(":");
        const result = dryRun
          ? await BlessERP.sriApi.validateXmlSignatureDryRun(companyId, file, type, context)
          : await BlessERP.sriApi.validateCertificate(companyId, file);
        if (!current()) return;
        if (dryRun) { view.message = dryMessage(result); sync(); return; }
        const ruc = result.ruc_match === "PASS" ? "RUC coincide" : result.ruc_match === "FAIL" ? "RUC no coincide" : "RUC no demostrado";
        const identity = typeof result.identity_ruc === "string" && result.identity_ruc.length === 13
          && /^[0-9]{13}$/.test(result.identity_ruc) ? result.identity_ruc : "no demostrado";
        const expiry = /^\d{4}-\d{2}-\d{2}T/.test(result.not_after || "") ? result.not_after.slice(0, 10) : "no disponible";
        let status = "No fue posible validar criptográficamente el certificado";
        if (result.crypto_valid === true) {
          if (result.validity_valid !== true) status = "Certificado criptográficamente válido; fuera de vigencia";
          else if (result.ruc_match === "UNPROVEN") status = "Certificado válido; identidad tributaria no pudo demostrarse";
          else if (result.ruc_match === "FAIL") status = "Certificado válido; identidad tributaria no coincide con esta empresa";
          else if (result.valid === true && result.ruc_match === "PASS") status = "Certificado válido; identidad tributaria coincide";
        }
        view.message = `${status}. Certificado criptográficamente válido: ${result.crypto_valid === true ? "sí" : "no"}. RUC demostrado: ${identity}. ${ruc}. Vence: ${expiry}. Clave privada utilizable: ${result.private_key_usable === true ? "sí" : "no"}.`;
        if (result.identity_diagnostics) {
          view.diagnostic = JSON.stringify({
            company_id: result.company_id, valid: result.valid, crypto_valid: result.crypto_valid,
            validity_valid: result.validity_valid, ruc_match: result.ruc_match,
            identity_ruc: result.identity_ruc, identity_ruc_oid: result.identity_ruc_oid,
            serial_number: result.serial_number, not_before: result.not_before, not_after: result.not_after,
            issuer: result.issuer, identity: result.identity_diagnostics
          }, null, 2);
          diagnostic.hidden = false;
        }
        sync();
      } catch (error) {
        if (current()) {
          const codes = ["AUTH_REQUIRED", "CAPABILITY_REQUIRED", "COMPANY_REQUIRED", "COMPANY_CHANGED", "CANONICAL_COMPANY_REQUIRED", "CERTIFICATE_FILE_REQUIRED", "INVALID_CERTIFICATE_FILE", "CERTIFICATE_TOO_LARGE", "DRY_RUN_FIXTURE_REQUIRED", "INVALID_INPUT", "PRECHECK_UNAVAILABLE", "DRY_RUN_TIMEOUT", "INVALID_RESPONSE", "NETWORK_ERROR"];
          const code = codes.includes(error?.code) ? error.code : "DRY_RUN_REQUEST_FAILED";
          view.message = dryRun ? dryMessage({}, code) : (error?.message || "No fue posible validar el certificado.");
          sync();
        }
      } finally {
        file = null;
        input.value = "";
        input.disabled = false;
        button.disabled = false;
        if (dryButton) dryButton.disabled = false;
        if (fixtureSelect) fixtureSelect.disabled = false;
        view.pending = false;
        if (!panel.isConnected) { output.textContent = ""; diagnostic.hidden = true; diagnosticText.value = ""; }
        if (current()) {
          const latestFile = view.panel?.querySelector("[data-certificate-file]");
          if (latestFile) latestFile.value = "";
          sync();
        } else { output.textContent = ""; diagnostic.hidden = true; diagnosticText.value = ""; }
      }
    };
    const certClick = () => run(false), dryClick = () => run(true);
    button.addEventListener("click", certClick);
    dryButton?.addEventListener("click", dryClick);
    boundPanels.set(panel, { view, cert: certClick, dry: dryClick, fixture: syncFixture });
  }

  BlessERP.sriCertificatePrecheck = { render, bind };
})();
