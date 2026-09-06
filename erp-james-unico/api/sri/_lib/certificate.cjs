const { SriConfigurationError, SriValidationError } = require("./errors.cjs");
const { validateSriPkcs12ForCompany, releaseCertificateMaterial, identityRuc, certificateIdentification } = require("./certificate-validator.cjs");

const SECRET_NAME_PATTERN = /^SRI_P12_PASSWORD_[A-Z0-9_]+$/;
const SECRET_REFERENCES = Object.freeze({
  "cf331b82-7ac3-4065-9e38-d0bbcde96cd5": "SRI_P12_PASSWORD_BLESS",
  "ab60abdc-fe53-4289-9ae2-8f749ee21cff": "SRI_P12_PASSWORD_IMPERIO"
});

function certificateSecretName(companyId, suppliedName) {
  const approved = Object.hasOwn(SECRET_REFERENCES, companyId) ? SECRET_REFERENCES[companyId] : null;
  if (!approved || (suppliedName != null && suppliedName !== approved)) {
    throw new SriConfigurationError("La referencia segura del certificado no corresponde a la empresa.");
  }
  return approved;
}

function resolveCertificatePassword(secretName, environment = process.env) {
  const normalized = String(secretName || "").trim();
  if (!SECRET_NAME_PATTERN.test(normalized)) throw new SriConfigurationError("El nombre del secreto del certificado no esta permitido.");
  const password = environment[normalized];
  if (typeof password !== "string" || !password.length) throw new SriConfigurationError("No se encontro la contrasena segura del certificado.");
  return password;
}

async function canonicalCertificateCompany(client, companyId) {
  const { data: company, error } = await client.from("companies")
    .select("id, tax_id, is_active").eq("id", companyId).maybeSingle();
  if (error || company?.id !== companyId || company.is_active !== true
    || typeof company.tax_id !== "string" || company.tax_id.length !== 13 || !/^[0-9]{13}$/.test(company.tax_id)) {
    throw new SriConfigurationError("Falta el RUC canonico de una empresa activa.");
  }
  return company;
}

// Compatibility entrypoint: there is exactly one PKCS12 parser/identity decision.
// All production callers supply expectedRuc from canonical companies.tax_id.
function parsePkcs12(bytes, password, options = {}) {
  const { validation, material } = validateSriPkcs12ForCompany(bytes, password, options.companyId || null,
    options.expectedRuc, options.now instanceof Date ? options.now : new Date());
  if (!validation.valid || !material) {
    releaseCertificateMaterial(material);
    const message = validation.ruc_match === "FAIL" ? "El RUC del certificado no corresponde a la empresa emisora."
      : validation.crypto_valid && !validation.validity_valid ? "El certificado esta fuera de vigencia."
      : validation.crypto_valid && validation.ruc_match === "UNPROVEN" ? "La identidad tributaria del certificado no pudo demostrarse."
      : "No fue posible validar el certificado y su clave privada con el secreto del backend.";
    throw new SriValidationError(message, { ruc_match: validation.ruc_match, crypto_valid: validation.crypto_valid, validity_valid: validation.validity_valid });
  }
  material.metadata.expirationWarning = material.metadata.daysUntilExpiration <= Number(options.expirationWarningDays || 30);
  return material;
}

function assertStoredCertificateScope(row, companyId) {
  const fingerprint = String(row?.fingerprint_sha256 || "");
  if (row?.company_id !== companyId || row.active !== true || row.storage_bucket !== "sri-private"
    || !/^[a-f0-9]{64}$/.test(fingerprint)
    || row.storage_object_path !== "companies/" + companyId + "/certificates/" + fingerprint + ".p12") {
    throw new SriValidationError("El certificado almacenado no pertenece a la empresa del comprobante.");
  }
  certificateSecretName(companyId, row.password_secret_name);
}

module.exports = { SECRET_NAME_PATTERN, SECRET_REFERENCES, certificateSecretName, canonicalCertificateCompany,
  resolveCertificatePassword, parsePkcs12, releaseCertificateMaterial, assertStoredCertificateScope,
  certificateRuc: identityRuc, certificateIdentification };
