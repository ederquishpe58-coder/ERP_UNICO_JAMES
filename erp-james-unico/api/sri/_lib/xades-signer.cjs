const { webcrypto } = require("node:crypto");
const { createRequire } = require("node:module");
const xmldom = require("@xmldom/xmldom");
const xpath = require("xpath");
const xadesjs = require("xadesjs");
const { SriValidationError } = require("./errors.cjs");
const xmldsigRequire = createRequire(require.resolve("xmldsigjs"));
const xmldsigXmlCore = xmldsigRequire("xml-core");

let engineConfigured = false;

function configureEngine() {
  if (engineConfigured) return;
  const nodeDependencies = {
    XMLSerializer: xmldom.XMLSerializer,
    DOMParser: xmldom.DOMParser,
    DOMImplementation: xmldom.DOMImplementation,
    xpath
  };
  xadesjs.setNodeDependencies(nodeDependencies);
  xmldsigXmlCore.setNodeDependencies(nodeDependencies);
  xadesjs.Application.setEngine("NodeJS", webcrypto);
  engineConfigured = true;
}

async function importSigningKey(privateKeyPkcs8) {
  return webcrypto.subtle.importKey(
    "pkcs8",
    privateKeyPkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" },
    false,
    ["sign"]
  );
}

async function signXadesBes({ xml, certificate, signingTime = new Date() }) {
  configureEngine();
  const source = String(xml || "").trim();
  if (!source) throw new SriValidationError("No existe XML para firmar.");
  if (!certificate?.certificateBase64 || !certificate?.privateKeyPkcs8) {
    throw new SriValidationError("No existe material criptografico valido para firmar.");
  }

  const document = xadesjs.Parse(source);
  if (document.documentElement?.getAttribute("id") !== "comprobante") {
    throw new SriValidationError("El XML debe identificar su raiz como comprobante.");
  }
  if (document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature").length) {
    throw new SriValidationError("El XML ya contiene una firma electronica.");
  }

  const privateKey = await importSigningKey(certificate.privateKeyPkcs8);
  const signed = new xadesjs.SignedXml();
  await signed.Sign(
    { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-1" } },
    privateKey,
    document,
    {
      x509: [certificate.certificateBase64],
      signingCertificate: {
        certificate: certificate.certificateBase64,
        digestAlgorithm: "SHA-1"
      },
      signingTime: { value: signingTime },
      signerRole: { claimed: ["EMISOR"] },
      references: [{
        uri: "#comprobante",
        hash: "SHA-1",
        transforms: ["enveloped", "c14n"]
      }]
    }
  );

  const signature = signed.GetXml();
  document.documentElement.appendChild(document.importNode(signature, true));
  const signedXml = new xmldom.XMLSerializer().serializeToString(document);
  const verified = await verifyXadesBes(signedXml);
  if (!verified) throw new SriValidationError("La firma XAdES-BES generada no supera su verificacion local.");
  return signedXml;
}

async function verifyXadesBes(xml) {
  configureEngine();
  const document = xadesjs.Parse(String(xml || ""));
  const signatures = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
  if (signatures.length !== 1) return false;
  const signed = new xadesjs.SignedXml(document);
  signed.LoadXml(signatures[0]);
  return signed.Verify();
}

module.exports = {
  configureEngine,
  importSigningKey,
  signXadesBes,
  verifyXadesBes
};
