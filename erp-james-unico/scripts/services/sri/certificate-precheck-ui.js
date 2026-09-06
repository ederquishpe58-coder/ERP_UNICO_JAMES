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
    </section>`;
  }

  function bind(container) {
    const panel = container.querySelector("[data-certificate-precheck]");
    if (!panel) return;
    const companyId = BlessERP.sriApi.certificatePrecheckCompany();
    const input = panel.querySelector("[data-certificate-file]");
    const button = panel.querySelector("[data-certificate-validate]");
    const output = panel.querySelector("[data-certificate-result]");
    const current = () => panel.isConnected && companyId === BlessERP.sriApi.certificatePrecheckCompany();
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      if (!current()) { input.value = ""; output.textContent = "La empresa cambió. Abra nuevamente Parámetros tributarios."; return; }
      let file = input.files?.[0];
      if (!file) { output.textContent = "Seleccione el certificado de esta empresa."; return; }
      button.disabled = true;
      input.disabled = true;
      output.textContent = "Validando certificado…";
      try {
        const result = await BlessERP.sriApi.validateCertificate(companyId, file);
        if (!current()) return;
        const ruc = result.ruc_match === "PASS" ? "RUC coincide" : result.ruc_match === "FAIL" ? "RUC no coincide" : "RUC no demostrado";
        const expiry = /^\d{4}-\d{2}-\d{2}T/.test(result.not_after || "") ? result.not_after.slice(0, 10) : "no disponible";
        output.textContent = `${result.valid === true ? "Certificado válido" : "Certificado no validado"}. ${ruc}. Vence: ${expiry}. Clave privada utilizable: ${result.private_key_usable === true ? "sí" : "no"}.`;
      } catch (error) {
        if (current()) output.textContent = error?.message || "No fue posible validar el certificado.";
      } finally {
        file = null;
        input.value = "";
        input.disabled = false;
        button.disabled = false;
        if (!current()) output.textContent = "";
      }
    });
  }

  BlessERP.sriCertificatePrecheck = { render, bind };
})();
