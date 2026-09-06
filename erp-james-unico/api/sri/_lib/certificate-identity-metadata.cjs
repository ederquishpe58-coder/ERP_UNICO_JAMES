const forge = require("node-forge");

const DN_NAMES = Object.freeze({
  "2.5.4.3": "commonName", "2.5.4.4": "surname", "2.5.4.5": "serialNumber",
  "2.5.4.6": "countryName", "2.5.4.7": "localityName", "2.5.4.8": "stateOrProvinceName",
  "2.5.4.10": "organizationName", "2.5.4.11": "organizationalUnitName",
  "2.5.4.42": "givenName", "2.5.4.97": "organizationIdentifier",
  "0.9.2342.19200300.100.1.1": "UID", "1.2.840.113549.1.9.1": "emailAddress"
});
const SAN_NAMES = ["otherName", "rfc822Name", "dNSName", "x400Address", "directoryName", "ediPartyName", "uniformResourceIdentifier", "iPAddress", "registeredID"];
const oidText = value => /^\d+(?:\.\d+){1,30}$/.test(String(value || "")) ? String(value) : "UNKNOWN";

function candidates(value) {
  // Observation only: a numeric candidate can also be an unrelated phone/identifier.
  // These values NEVER feed identityRuc or authorize the precheck.
  if (typeof value !== "string" || value.length > 1024) return [];
  return [...new Set([...value.matchAll(/(?:^|\D)(\d{13}|\d{10})(?=\D|$)/g)].map(m => m[1]))].slice(0, 8);
}

function prefix(value) {
  // Only standards-style identity prefixes; no names, email, address or arbitrary text.
  return typeof value === "string" ? value.match(/^(IDCEC-|PNOEC-|VATEC-|PASEC-)/)?.[1] || null : null;
}

function dnFields(name, issuer = false) {
  return (name?.attributes || []).slice(0, 40).map(attribute => {
    const oid = oidText(attribute.type);
    const field = { oid, name: DN_NAMES[oid] || "other", present: true, value_redacted: true };
    if (oid === "2.5.4.6" && /^[A-Z]{2}$/.test(attribute.value || "")) {
      field.country = attribute.value;
    }
    if (issuer && ["2.5.4.3", "2.5.4.10"].includes(oid)) {
      field.issuer_label = String(attribute.value || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160);
    }
    if (!issuer) {
      field.candidate_identifiers = candidates(attribute.value);
      field.identity_prefix = prefix(attribute.value);
    }
    return field;
  });
}

function scanExtension(extension) {
  const result = { oid: oidText(extension.id), critical: extension.critical === true, embedded_oids: [], asn1_types: [], candidate_identifiers: [], decoded: false, truncated: false };
  let visited = 0;
  function walk(node, route, depth) {
    if (++visited > 256 || depth > 12) { result.truncated = true; return; }
    result.asn1_types.push(`${node.tagClass}:${node.type}`);
    if (node.tagClass === 0 && node.type === forge.asn1.Type.OID && typeof node.value === "string") {
      result.embedded_oids.push(oidText(forge.asn1.derToOid(node.value)));
    }
    if (Array.isArray(node.value)) {
      node.value.slice(0, 64).forEach((child, i) => walk(child, `${route}.${i}`, depth + 1));
      if (node.value.length > 64) result.truncated = true;
    } else if (node.tagClass === 0 && [12, 18, 19, 20, 22, 26, 30].includes(node.type)) {
      let value = node.value;
      if (node.type === 30 && typeof value === "string" && value.length <= 2048 && value.length % 2 === 0) {
        value = Array.from({ length: value.length / 2 }, (_, i) => String.fromCharCode(value.charCodeAt(i * 2) * 256 + value.charCodeAt(i * 2 + 1))).join("");
      }
      for (const valueCandidate of candidates(value)) {
        result.candidate_identifiers.push({ value: valueCandidate, asn1_path: route, identity_prefix: prefix(value), authority: "UNVERIFIED" });
      }
    } else if (node.tagClass === 0 && node.type === 4 && typeof node.value === "string" && node.value.length <= 16384) {
      // Some providers wrap their extension value in an additional OCTET STRING.
      // Decode strict DER; never turn arbitrary bytes into log/response text.
      try { walk(forge.asn1.fromDer(node.value), `${route}.octets`, depth + 1); } catch { /* not nested DER */ }
    }
  }
  if (typeof extension.value !== "string" || extension.value.length > 16384) return result;
  try {
    walk(forge.asn1.fromDer(extension.value), "value", 0);
    result.decoded = true;
  } catch { /* Diagnostic failure must not change crypto/identity validation. */ }
  result.embedded_oids = [...new Set(result.embedded_oids)].slice(0, 32);
  result.asn1_types = [...new Set(result.asn1_types)].slice(0, 32);
  result.candidate_identifiers = result.candidate_identifiers.slice(0, 16);
  return result;
}

function identityDiagnostics(certificate, attributes = {}) {
  try {
    const subjectFields = dnFields(certificate.subject);
    const extensions = (certificate.extensions || []).slice(0, 40).map(scanExtension);
    const san = (certificate.extensions || []).find(e => e.id === "2.5.29.17");
    let sanTypes = (san?.altNames || []).map(n => SAN_NAMES[n.type] || `type-${n.type}`);
    if (san?.value && san.value.length <= 16384) {
      try {
        const root = forge.asn1.fromDer(san.value);
        for (const node of Array.isArray(root.value) ? root.value.slice(0, 64) : []) {
          if (node.tagClass === 128) sanTypes.push(SAN_NAMES[node.type] || `type-${node.type}`);
        }
      } catch { /* no raw fallback */ }
    }
    const candidateIdentifiers = [
      ...subjectFields.flatMap(field => field.candidate_identifiers.map(value => ({ source: "subject", oid: field.oid, value, identity_prefix: field.identity_prefix, authority: "UNVERIFIED" }))),
      ...extensions.flatMap(extension => extension.candidate_identifiers.map(value => ({ source: "extension", oid: extension.oid, ...value })))
    ].slice(0, 64);
    return {
      subject_fields: subjectFields,
      issuer_fields: dnFields(certificate.issuer, true),
      subject_alt_name_types: [...new Set(sanTypes)],
      extensions,
      identity_related_oids: [...new Set(candidateIdentifiers.map(c => c.oid))],
      candidate_identifiers: candidateIdentifiers,
      pkcs12_attributes: {
        friendly_name_present: Array.isArray(attributes.friendlyName) && attributes.friendlyName.length > 0,
        friendly_name_value_redacted: true,
        local_key_id_present: Array.isArray(attributes.localKeyId) && attributes.localKeyId.length > 0,
        authority: "AUXILIARY_ONLY"
      },
      diagnostic_only: true
    };
  } catch {
    return { diagnostic_only: true, unavailable: true };
  }
}

module.exports = { identityDiagnostics };
