(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function render() {
    const companyId = BlessERP.sriApi?.certificatePrecheckCompany?.();
    if (!companyId) return "";
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
    const current = () => panel.isConnected && companyId === BlessERP.sriApi.certificatePrecheckCompany();
    const run = async (dryRun) => {
      if (button.disabled || dryButton?.disabled) return;
      if (!current()) { input.value = ""; output.textContent = "La empresa cambió. Abra nuevamente Parámetros tributarios."; diagnostic.hidden = true; diagnosticText.value = ""; return; }
      let file = input.files?.[0];
      if (!file) { output.textContent = "Seleccione el certificado de esta empresa."; return; }
      button.disabled = true;
      if (dryButton) dryButton.disabled = true;
      if (fixtureSelect) fixtureSelect.disabled = true;
      input.disabled = true;
      output.textContent = "Validando certificado…";
      diagnostic.hidden = true;
      diagnosticText.value = "";
      try {
        const [type, context] = String(fixtureSelect?.value || "").split(":");
        const result = dryRun
          ? await BlessERP.sriApi.validateXmlSignatureDryRun(companyId, file, type, context)
          : await BlessERP.sriApi.validateCertificate(companyId, file);
        if (!current()) return;
        if (dryRun) {
          const stage = value => ["PASS", "FAIL", "UNPROVEN", "NOT_EXECUTED"].includes(value) ? value : "NOT_EXECUTED";
          const confirmed = result.valid === true && result.certificate_validation === "PASS" && result.ruc_match === "PASS"
            && result.xml_build === "PASS" && result.xades_sign === "PASS" && result.schema_validation === "PASS"
            && result.environment === "TEST" && result.writes === 0;
          output.textContent = `${confirmed ? "Prueba XML y firma válida" : "Prueba XML y firma no completada"}. Certificado: ${stage(result.certificate_validation)}. RUC: ${stage(result.ruc_match)}. XML: ${stage(result.xml_build)}. XAdES: ${stage(result.xades_sign)}. Esquema: ${stage(result.schema_validation)}. Ambiente: ${result.environment === "TEST" ? "TEST" : "NO CONFIRMADO"}. Escrituras: ${result.writes === 0 ? "0" : "NO CONFIRMADO"}.`;
          return;
        }
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
        output.textContent = `${status}. Certificado criptográficamente válido: ${result.crypto_valid === true ? "sí" : "no"}. RUC demostrado: ${identity}. ${ruc}. Vence: ${expiry}. Clave privada utilizable: ${result.private_key_usable === true ? "sí" : "no"}.`;
        if (result.identity_diagnostics) {
          diagnosticText.value = JSON.stringify({
            company_id: result.company_id, valid: result.valid, crypto_valid: result.crypto_valid,
            validity_valid: result.validity_valid, ruc_match: result.ruc_match,
            identity_ruc: result.identity_ruc, identity_ruc_oid: result.identity_ruc_oid,
            serial_number: result.serial_number, not_before: result.not_before, not_after: result.not_after,
            issuer: result.issuer, identity: result.identity_diagnostics
          }, null, 2);
          diagnostic.hidden = false;
        }
      } catch (error) {
        if (current()) output.textContent = error?.message || "No fue posible validar el certificado.";
      } finally {
        file = null;
        input.value = "";
        input.disabled = false;
        button.disabled = false;
        if (dryButton) dryButton.disabled = false;
        if (fixtureSelect) fixtureSelect.disabled = false;
        if (!current()) { output.textContent = ""; diagnostic.hidden = true; diagnosticText.value = ""; }
      }
    };
    button.addEventListener("click", () => run(false));
    dryButton?.addEventListener("click", () => run(true));
  }

  BlessERP.sriCertificatePrecheck = { render, bind };
})();
