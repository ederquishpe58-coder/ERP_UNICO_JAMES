const { createHash } = require("node:crypto");
const forge = require("node-forge");
const { SriConfigurationError, SriValidationError } = require("./errors.cjs");

const SECRET_NAME_PATTERN = /^SRI_P12_PASSWORD_[A-Z0-9_]+$/;

function bytesToBuffer(bytes) {
  return Buffer.from(bytes, "binary");
}

function resolveCertificatePassword(secretName, environment = process.env) {
  const normalized = String(secretName || "").trim();
  if (!SECRET_NAME_PATTERN.test(normalized)) {
    throw new SriConfigurationError("El nombre del secreto del certificado no esta permitido.");
  }
  const password = environment[normalized];
  if (typeof password !== "string" || !password.length) {
    throw new SriConfigurationError("No se encontro la contrasena segura del certificado.");
  }
  return password;
}

function subjectValues(certificate) {
  return (certificate.subject?.attributes || [])
    .flatMap(attribute => [attribute.value, attribute.shortName, attribute.name])
    .filter(Boolean)
    .map(value => String(value));
}

function certificateRuc(certificate) {
  const values = subjectValues(certificate).join(" ");
  const embeddedRuc = values.match(/(?:^|\D)(\d{13})(?:\D|$)/)?.[1] || null;
  if (embeddedRuc) return embeddedRuc;
  const naturalPersonId = values.match(/(?:^|\D)(\d{10})(?:\D|$)/)?.[1] || null;
  return naturalPersonId ? `${naturalPersonId}001` : null;
}

function certificateIdentification(certificate) {
  const values = subjectValues(certificate).join(" ");
  return values.match(/(?:^|\D)(\d{13}|\d{10})(?:\D|$)/)?.[1] || null;
}

function nameText(name) {
  return (name?.attributes || [])
    .map(attribute => `${attribute.shortName || attribute.name || attribute.type}=${attribute.value}`)
    .join(", ");
}

function findBagByLocalKeyId(bags, localKeyId) {
  if (!localKeyId) return bags[0] || null;
  return bags.find(bag => bag.attributes?.localKeyId?.[0] === localKeyId) || bags[0] || null;
}

function parsePkcs12(p12Buffer, password, options = {}) {
  if (!Buffer.isBuffer(p12Buffer) || !p12Buffer.length) {
    throw new SriValidationError("El certificado P12/PFX esta vacio.");
  }
  if (typeof password !== "string") {
    throw new SriConfigurationError("La contrasena del certificado debe provenir de un secreto del backend.");
  }

  let container;
  try {
    const asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
    container = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new SriValidationError("No fue posible abrir el certificado P12/PFX. Verifique el archivo y su secreto.");
  }

  const keyBagTypes = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag];
  const keyBags = keyBagTypes.flatMap(bagType => container.getBags({ bagType })[bagType] || []);
  const certBags = container.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBag = keyBags.find(bag => bag.key) || null;
  if (!keyBag?.key) throw new SriValidationError("El P12/PFX no contiene una clave privada utilizable.");

  const localKeyId = keyBag.attributes?.localKeyId?.[0] || null;
  const certBag = findBagByLocalKeyId(certBags.filter(bag => bag.cert), localKeyId);
  if (!certBag?.cert) throw new SriValidationError("El P12/PFX no contiene el certificado del firmante.");

  const privateKey = keyBag.key;
  const certificate = certBag.cert;
  if (!certificate.publicKey?.n?.equals(privateKey.n)) {
    throw new SriValidationError("La clave privada no corresponde al certificado del firmante.");
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const notBefore = certificate.validity.notBefore;
  const notAfter = certificate.validity.notAfter;
  if (now < notBefore) throw new SriValidationError("El certificado todavia no se encuentra vigente.");
  if (now > notAfter) throw new SriValidationError("El certificado de firma esta vencido.");

  const expectedRuc = String(options.expectedRuc || "").trim();
  const holderRuc = certificateRuc(certificate);
  const holderIdentification = certificateIdentification(certificate);
  if (expectedRuc && holderRuc !== expectedRuc) {
    throw new SriValidationError("El RUC del certificado no corresponde a la empresa emisora.");
  }

  const certificateDer = bytesToBuffer(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes());
  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey));
  const privateKeyDer = bytesToBuffer(forge.asn1.toDer(privateKeyInfo).getBytes());
  const warningDays = Number(options.expirationWarningDays || 30);
  const daysUntilExpiration = Math.ceil((notAfter.getTime() - now.getTime()) / 86400000);

  return {
    certificate,
    privateKey,
    certificateDer,
    certificateBase64: certificateDer.toString("base64"),
    privateKeyPkcs8: privateKeyDer,
    metadata: {
      subject: nameText(certificate.subject),
      issuer: nameText(certificate.issuer),
      serialNumber: certificate.serialNumber,
      holderRuc,
      holderIdentification,
      notBefore: notBefore.toISOString(),
      notAfter: notAfter.toISOString(),
      daysUntilExpiration,
      expirationWarning: daysUntilExpiration <= warningDays,
      fingerprintSha256: createHash("sha256").update(certificateDer).digest("hex").toUpperCase()
    }
  };
}

module.exports = {
  SECRET_NAME_PATTERN,
  resolveCertificatePassword,
  parsePkcs12,
  certificateRuc,
  certificateIdentification
};
