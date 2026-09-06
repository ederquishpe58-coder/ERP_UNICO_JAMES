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
    const output = panel.querySelector("[data-certificate-result]");
    const diagnostic = panel.querySelector("[data-certificate-diagnostic]");
    const diagnosticText = panel.querySelector("[data-certificate-diagnostic-text]");
    const current = () => panel.isConnected && companyId === BlessERP.sriApi.certificatePrecheckCompany();
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      if (!current()) { input.value = ""; output.textContent = "La empresa cambió. Abra nuevamente Parámetros tributarios."; diagnostic.hidden = true; diagnosticText.value = ""; return; }
      let file = input.files?.[0];
      if (!file) { output.textContent = "Seleccione el certificado de esta empresa."; return; }
      button.disabled = true;
      input.disabled = true;
      output.textContent = "Validando certificado…";
      diagnostic.hidden = true;
      diagnosticText.value = "";
      try {
        const result = await BlessERP.sriApi.validateCertificate(companyId, file);
        if (!current()) return;
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
        if (!current()) { output.textContent = ""; diagnostic.hidden = true; diagnosticText.value = ""; }
      }
    });
  }

  BlessERP.sriCertificatePrecheck = { render, bind };
})();
