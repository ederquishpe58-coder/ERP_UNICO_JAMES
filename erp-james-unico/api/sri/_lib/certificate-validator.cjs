const forge = require("node-forge");
const { randomBytes, createHash } = require("node:crypto");
const { identityDiagnostics } = require("./certificate-identity-metadata.cjs");
const MAX_BYTES = 3 * 1024 * 1024;

const SECURITY_DATA_RUC_OID = "1.3.6.1.4.1.37746.3.11";

function securityDataProfile(certificate) {
  // Select the demonstrated issuer profile, not arbitrary enterprise OIDs. This is
  // profile compatibility, not a new certification-path/revocation trust policy.
  const attributes = certificate.issuer?.attributes || [];
  const organizations = attributes.filter(a => a.type === "2.5.4.10");
  const names = organizations.length ? organizations : attributes.filter(a => a.type === "2.5.4.3");
  const countries = attributes.filter(a => a.type === "2.5.4.6");
  return names.length === 1 && names[0].value === "SECURITY DATA S.A. 2"
    && countries.every(a => a.value === "EC");
}

function extensionRuc(value) {
  if (typeof value !== "string" || !value.length || value.length > 128) return null;
  try {
    // extnValue contains DER, never scan arbitrary bytes for a matching substring.
    // Accept only a single textual scalar, optionally OCTET-wrapped, with no tail.
    let node;
    for (let depth = 0; depth < 3; depth++) {
      const bytes = forge.util.createBuffer(value, "raw");
      node = forge.asn1.fromDer(bytes, true);
      if (bytes.length() || node.tagClass !== 0 || node.constructed || typeof node.value !== "string") return null;
      if (node.type !== forge.asn1.Type.OCTETSTRING) break;
      value = node.value;
    }
    const supportedStrings = [forge.asn1.Type.UTF8, forge.asn1.Type.PRINTABLESTRING,
      forge.asn1.Type.IA5STRING, forge.asn1.Type.BMPSTRING, 18 /* NumericString */];
    if (!supportedStrings.includes(node.type)) return null;
    const ruc = node.value;
    // Same structural contract as the ERP SRI settings/readiness validator: 13 digits.
    // No trimming, prefix stripping, cedula derivation or invented checksum policy.
    return ruc.length === 13 && /^[0-9]{13}$/.test(ruc) ? ruc : null;
  } catch { return null; }
}

function identityRuc(certificate) {
  if (!securityDataProfile(certificate)) return null;
  const extensions = (certificate.extensions || []).filter(e => e.id === SECURITY_DATA_RUC_OID);
  // A duplicate/ambiguous extension is not an authoritative identity. Missing or
  // unsupported identity remains UNPROVEN, even if subject/CN contains company RUC.
  if (extensions.length !== 1) return null;
  // Security Data's published OID catalog: .3.11 = RUC; .3.1 = cedula; .3.8 = phone.
  // https://www.securitydata.net.ec/wp-content/downloads/descargas/Manuales/Oids/OID.pdf
  return extensionRuc(extensions[0].value);
}

function safeName(name) {
  const attribute = name?.attributes?.find(a => a.type === "2.5.4.10")
    || name?.attributes?.find(a => a.type === "2.5.4.3");
  return String(attribute?.value || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160);
}

function boundedDer(node, depth = 0) {
  if (depth > 32) throw new Error("UNSUPPORTED_CONTAINER");
  if (Array.isArray(node.value)) {
    for (const child of node.value) boundedDer(child, depth + 1);
    // PKCS#12 MacData, PKCS#12 PBE and PBKDF2 iteration counts use INTEGER.
    // A certificate INTEGER (e.g. serial/modulus) is inside an OCTET STRING here.
    for (const child of node.value) {
      if (child.tagClass === 0 && child.type === forge.asn1.Type.INTEGER) {
        if (child.value.length > 4) throw new Error("UNSUPPORTED_CONTAINER");
        let n = 0;
        for (const byte of child.value) n = n * 256 + byte.charCodeAt(0);
        if (n > 1000000) throw new Error("UNSUPPORTED_CONTAINER");
      }
    }
  }
}

function validateSriPkcs12ForCompany(bytes, password, companyId, expectedRuc, now = new Date()) {
  let material = null;
  const result = {
    valid: false, crypto_valid: false, validity_valid: false, identity_diagnostics: null,
    company_id: companyId, ruc_match: "UNPROVEN", identity_ruc: null, identity_ruc_oid: null,
    subject_safe_summary: "", issuer: "", serial_number: "",
    not_before: null, not_after: null, expired: false,
    private_key_present: false, private_key_usable: false,
    secret_resolution: typeof password === "string" && password.length ? "PASS" : "FAIL",
    certificate_format: "PKCS12"
  };
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES || typeof expectedRuc !== "string" || expectedRuc.length !== 13 || !/^[0-9]{13}$/.test(expectedRuc) || result.secret_resolution !== "PASS") return { validation: result, material };
  try {
    const asn1 = forge.asn1.fromDer(bytes.toString("binary"));
    boundedDer(asn1);
    // The authenticatedSafe is DER wrapped in an OCTET STRING. Inspect it before KDF work.
    const authenticatedSafe = asn1.value?.[1]?.value?.[1]?.value?.[0]?.value;
    if (typeof authenticatedSafe !== "string") return { validation: result, material };
    boundedDer(forge.asn1.fromDer(authenticatedSafe));
    const container = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const keys = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]
      .flatMap(bagType => container.getBags({ bagType })[bagType] || []).filter(bag => bag.key);
    const certs = (container.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])
      .filter(bag => bag.cert);
    result.private_key_present = keys.length > 0;
    if (keys.length !== 1 || certs.length > 16) return { validation: result, material };
    const key = keys[0].key;
    const matching = certs.filter(b => b.cert.publicKey?.n?.equals(key.n) && b.cert.publicKey?.e?.equals(key.e));
    if (matching.length !== 1) return { validation: result, material };
    const certificate = matching[0].cert;
    const challenge = randomBytes(32).toString("binary");
    const digest = forge.md.sha256.create().update(challenge);
    result.private_key_usable = certificate.publicKey.verify(digest.digest().getBytes(), key.sign(digest));
    result.crypto_valid = result.private_key_usable;
    const start = certificate.validity.notBefore;
    const end = certificate.validity.notAfter;
    result.not_before = start.toISOString();
    result.not_after = end.toISOString();
    result.expired = end <= now;
    result.validity_valid = !result.expired && start <= now;
    result.serial_number = /^[a-f0-9]{1,128}$/i.test(certificate.serialNumber) ? certificate.serialNumber : "";
    result.issuer = safeName(certificate.issuer);
    const ruc = identityRuc(certificate);
    result.identity_ruc = ruc;
    result.identity_ruc_oid = ruc ? SECURITY_DATA_RUC_OID : null;
    result.ruc_match = ruc ? (ruc === expectedRuc ? "PASS" : "FAIL") : "UNPROVEN";
    result.subject_safe_summary = ruc ? "Identidad tributaria presente" : "Identidad tributaria no demostrada";
    result.valid = result.ruc_match === "PASS" && result.private_key_usable && !result.expired && start <= now;
    result.identity_diagnostics = identityDiagnostics(certificate, matching[0].attributes);
    if (result.valid) {
      const certificateDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(), "binary");
      const privateKeyPkcs8 = Buffer.from(forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))).getBytes(), "binary");
      const daysUntilExpiration = Math.ceil((end.getTime() - now.getTime()) / 86400000);
      material = {
        certificate, privateKey: key, certificateDer, certificateBase64: certificateDer.toString("base64"), privateKeyPkcs8,
        metadata: { subject: "RUC " + ruc, issuer: result.issuer, serialNumber: result.serial_number,
          holderRuc: ruc, holderIdentification: certificateIdentification(certificate),
          notBefore: result.not_before, notAfter: result.not_after, daysUntilExpiration,
          expirationWarning: daysUntilExpiration <= 30,
          fingerprintSha256: createHash("sha256").update(certificateDer).digest("hex").toUpperCase() }
      };
    }
  } catch {
    // Never propagate parser/crypto exceptions, which can contain certificate or secret data.
    result.valid = false;
    releaseCertificateMaterial(material);
    material = null;
  }
  return { validation: result, material };
}


function certificateIdentification(certificate) {
  const ids = (certificate.subject?.attributes || []).filter(a => a.type === "2.5.4.5")
    .map(a => a.value).filter(v => typeof v === "string" && v.length === 10 && /^[0-9]{10}$/.test(v));
  return ids.length === 1 ? ids[0] : null; // Secondary metadata only, never RUC authority.
}

function releaseCertificateMaterial(material) {
  if (!material) return;
  material.privateKeyPkcs8?.fill(0);
  material.certificateDer?.fill(0);
  material.privateKey = null;
  material.certificate = null;
  material.certificateBase64 = "";
}

function validateInMemory(...args) {
  const { validation, material } = validateSriPkcs12ForCompany(...args);
  releaseCertificateMaterial(material);
  return validation;
}

module.exports = { validateSriPkcs12ForCompany, validateInMemory, releaseCertificateMaterial, identityRuc, certificateIdentification, MAX_BYTES };
