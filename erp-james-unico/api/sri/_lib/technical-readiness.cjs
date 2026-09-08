const { requireEnvironment, assertEnvironmentEnabled } = require("./environment.cjs");
const SUPPORTED_XML = Object.freeze({
  "01": "1.1.0",
  "04": "1.1.0",
  "06": "1.1.0",
  "07": "2.0.0"
});

function validateSriConfiguration(input = {}) {
  const settings = input.settings || null;
  const points = Array.isArray(input.emissionPoints) ? input.emissionPoints : [];
  const sequences = Array.isArray(input.sequences) ? input.sequences : [];
  const certificates = Array.isArray(input.certificates) ? input.certificates : [];
  const blockers = [];
  const signatureBlockers = [];
  const warnings = [];
  const companyId = settings?.company_id;
  let environment = null;
  try {
    environment = requireEnvironment(input.environment ?? settings?.environment);
    assertEnvironmentEnabled(settings, environment, companyId);
  } catch (error) { blockers.push(error.message); }

  if (!settings) {
    blockers.push("Falta la configuracion tributaria de la empresa.");
  } else {
    if (!/^\d{13}$/.test(String(settings.ruc || ""))) blockers.push("El RUC emisor debe contener 13 digitos.");
    if (!String(settings.legal_name || "").trim()) blockers.push("Falta la razon social del emisor.");
    if (!String(settings.head_office_address || "").trim()) blockers.push("Falta la direccion matriz.");
    if (String(settings.emission_type || "") !== "1") blockers.push("El esquema offline admite tipo de emision normal 1.");
    if (!settings.immediate_transmission) blockers.push("La transmision inmediata debe permanecer activa.");
    if (settings.technical_spec_version !== "2.34") blockers.push("La ficha tecnica configurada debe ser la version 2.34.");
    if (settings.invoice_xml_version !== SUPPORTED_XML["01"]) blockers.push("La factura debe usar el XSD habilitado 1.1.0.");
    if (settings.credit_note_xml_version !== SUPPORTED_XML["04"]) blockers.push("La nota de credito debe usar el XSD habilitado 1.1.0.");
    if (settings.withholding_xml_version !== SUPPORTED_XML["07"]) blockers.push("La retencion debe usar el XSD habilitado 2.0.0.");
  }

  const activePoints = points.filter(point => companyId && point.company_id === companyId
    && point.active === true && environment && point.environment === environment);
  if (!activePoints.length) blockers.push("Falta un establecimiento y punto de emision activo en el ambiente seleccionado.");
  activePoints.forEach(point => {
    if (!/^\d{3}$/.test(String(point.establishment_code || ""))) blockers.push("El codigo de establecimiento debe contener 3 digitos.");
    if (!/^\d{3}$/.test(String(point.emission_point_code || ""))) blockers.push("El punto de emision debe contener 3 digitos.");
    if (!String(point.establishment_address || "").trim()) blockers.push("Falta la direccion del establecimiento.");
  });
  const routes = [["01", "003"], ["01", "002"], ["04", "003"], ["04", "002"]];
  if (settings?.ruc === "1717637084001" && String(settings.withholding_agent_number || "").trim()) routes.push(["07", "002"]);
  for (const [type, code] of routes) {
    const matchingPoints = activePoints.filter(point => point.establishment_code === "001" && point.emission_point_code === code);
    const matches = sequences.filter(sequence => sequence.company_id === companyId && sequence.environment === environment
      && sequence.document_type === type && matchingPoints.length === 1 && sequence.emission_point_id === matchingPoints[0].id);
    if (matchingPoints.length !== 1 || matches.length !== 1) {
      blockers.push(`Falta configurar una ruta y secuencia unica ${type} / 001-${code} en ${environment || "el ambiente seleccionado"}.`);
      continue;
    }
    const nextValue = Number(matches[0].next_value);
    if (!Number.isSafeInteger(nextValue) || nextValue < 1 || nextValue > 999999999) blockers.push(`El proximo secuencial ${type} / 001-${code} esta fuera del rango permitido.`);
  }

  const matchingCertificates = certificates.filter(certificate => companyId && certificate.company_id === companyId
    && certificate.active === true);
  const activeCertificate = matchingCertificates.length === 1 ? matchingCertificates[0] : null;
  if (!activeCertificate) {
    signatureBlockers.push("Falta integrar un certificado P12/PFX activo.");
  } else {
    if (activeCertificate.validation_status !== "VALID") signatureBlockers.push("El certificado activo no tiene validacion vigente.");
    if (settings?.ruc && activeCertificate.subject_ruc !== settings.ruc) signatureBlockers.push("El RUC del certificado no coincide con el emisor.");
    const now = input.now || new Date();
    const validFrom = Date.parse(activeCertificate.valid_from);
    const validUntil = Date.parse(activeCertificate.valid_until);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validFrom > Number(now) || validUntil <= Number(now)) {
      signatureBlockers.push("El certificado activo no tiene un periodo de vigencia valido.");
    }
    if (activeCertificate.validation_message) warnings.push(activeCertificate.validation_message);
  }

  return {
    readyForXml: blockers.length === 0,
    readyForSignature: blockers.length === 0 && signatureBlockers.length === 0,
    blockers: [...new Set(blockers)],
    signatureBlockers: [...new Set(signatureBlockers)],
    warnings: [...new Set(warnings)],
    baseline: {
      technicalSpecVersion: "2.34",
      technicalSpecDate: "2026-07-27",
      environment,
      emissionType: "1",
      invoiceXmlVersion: SUPPORTED_XML["01"],
      creditNoteXmlVersion: SUPPORTED_XML["04"],
      deliveryGuides: "DESHABILITADAS",
      withholdingXmlVersion: SUPPORTED_XML["07"],
      signature: "XAdES-BES 1.3.2 / enveloped / UTF-8 / RSA-SHA1 / 2048 bits",
      certificateContainer: "PKCS12 P12/PFX privado en backend"
    }
  };
}

module.exports = { SUPPORTED_XML, validateSriConfiguration };
