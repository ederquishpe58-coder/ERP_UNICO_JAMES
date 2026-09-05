const fs = require("node:fs/promises");
const path = require("node:path");
const { validateXML } = require("xmllint-wasm");
const { SriValidationError } = require("./errors.cjs");

const SCHEMA_FILES = Object.freeze({
  "01:1.1.0": "factura_v1.1.0.xsd",
  "04:1.1.0": "notacredito_v1.1.0.xsd",
  "06:1.1.0": "guiaremision_v1.1.0.xsd",
  "07:2.0.0": "comprobanteRetencion_v2.0.0.xsd"
});

function schemaRoot() {
  return path.resolve(__dirname, "..", "..", "..", "docs", "sri", "official", "2026-07-v2.34", "schemas");
}

async function validateAgainstOfficialXsd({ documentType, version, xml }) {
  const key = `${documentType}:${version}`;
  const fileName = SCHEMA_FILES[key];
  if (!fileName) {
    throw new SriValidationError(`No existe XSD habilitado para ${key}.`);
  }
  const directory = path.join(schemaRoot(), documentType);
  const [schema, signatureSchema] = await Promise.all([
    fs.readFile(path.join(directory, fileName), "utf8"),
    fs.readFile(path.join(directory, "xmldsig-core-schema.xsd"), "utf8")
  ]);
  const result = await validateXML({
    xml: [{ fileName: `document-${documentType}.xml`, contents: String(xml || "") }],
    schema: [{ fileName, contents: schema }],
    preload: [{ fileName: "xmldsig-core-schema.xsd", contents: signatureSchema }]
  });
  return {
    valid: Boolean(result.valid),
    documentType,
    version,
    schemaFile: fileName,
    technicalSpecVersion: "2.34",
    technicalSpecDate: "2026-07-27",
    errors: (result.errors || []).map(error => ({
      message: error.message || error.rawMessage || String(error),
      fileName: error.loc?.fileName || "",
      lineNumber: error.loc?.lineNumber || null
    })),
    rawOutput: result.rawOutput || ""
  };
}

async function assertOfficialXsd(options) {
  const result = await validateAgainstOfficialXsd(options);
  if (!result.valid) {
    throw new SriValidationError("El XML no cumple el XSD oficial del SRI.", result);
  }
  return result;
}

module.exports = {
  SCHEMA_FILES,
  validateAgainstOfficialXsd,
  assertOfficialXsd
};
