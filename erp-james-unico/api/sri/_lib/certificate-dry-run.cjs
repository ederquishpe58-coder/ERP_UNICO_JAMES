const { validateSriPkcs12ForCompany, releaseCertificateMaterial } = require("./certificate-validator.cjs");
const { buildAccessKey } = require("./access-key.cjs");
const { ecuadorDate } = require("./emission-date.cjs");
const { buildDocumentXml } = require("./xml-builders.cjs");
const { assertOfficialXsd } = require("./xsd-validator.cjs");
const { signXadesBes } = require("./xades-signer.cjs");

// Approved diagnostic fixtures only. These values never configure SRI or allocate
// identifiers. Company RUC/name are supplied by the authenticated server lookup.
const FIXTURE_PROFILES = Object.freeze({
  "cf331b82-7ac3-4065-9e38-d0bbcde96cd5": { accountingRequired: true, withholdingAgentNumber: "10" },
  "ab60abdc-fe53-4289-9ae2-8f749ee21cff": { accountingRequired: false, withholdingAgentNumber: null }
});

function allowedDryRun(companyId, type, context) {
  const profile = FIXTURE_PROFILES[companyId];
  return Boolean(profile && ((type === "01" && ["LOCAL", "EXPORT"].includes(context))
    || (type === "07" && context == null && profile.withholdingAgentNumber === "10")));
}

function dryRunFixture(company, type, context) {
  if (!allowedDryRun(company.id, type, context)) throw new Error("UNSUPPORTED_DRY_RUN");
  const profile = FIXTURE_PROFILES[company.id];
  const point = type === "07" || context === "EXPORT" ? "002" : "003";
  const issueDate = ecuadorDate();
  // Literal fixture number in memory, not a reservation/sequence API call.
  const access = buildAccessKey({ issueDate, documentType: type, ruc: company.tax_id,
    environment: "TEST", establishmentCode: "001", emissionPointCode: point,
    sequential: 1, numericCode: "12345678", emissionType: "1" });
  if (access.environmentCode !== "1" || access.accessKey[23] !== "1") throw new Error("TEST_REQUIRED");
  const document = {
    version: type === "07" ? "2.0.0" : "1.1.0", environmentCode: "1", emissionType: "1",
    accessKey: access.accessKey, establishmentCode: "001", emissionPointCode: point,
    sequential: access.sequential, issueDate, establishmentAddress: "DIRECCION DE PRUEBA TECNICA",
    issuer: { legalName: company.legal_name, commercialName: company.commercial_name,
      ruc: company.tax_id, headOfficeAddress: "DIRECCION DE PRUEBA TECNICA", ...profile }
  };
  const isExport = type === "01" && context === "EXPORT";
  const tax = { code: "2", percentageCode: "0", rate: 0, taxableBase: 10, value: 0 };
  const payload = {
    document,
    buyer: { identificationType: isExport ? "08" : "04",
      identification: isExport ? "9999999999999" : "1790000000001", legalName: "RECEPTOR DE PRUEBA TECNICA", address: "DIRECCION DE PRUEBA" },
    invoice: { totalWithoutTax: 10, discountTotal: 0, grandTotal: 10, currency: "USD", payments: [{ method: "20", total: 10 }],
      ...(isExport ? { incoterm: "FCA", incotermPlace: "QUITO", originCountryCode: "593", portOfLoading: "UIO", portOfDestination: "MIA",
        destinationCountryCode: "110", acquisitionCountryCode: "593", totalWithoutTaxIncoterm: "FCA", internationalFreight: 0,
        internationalInsurance: 0, customsExpenses: 0, otherTransportExpenses: 0 } : {}) },
    taxes: [tax], lines: [{ mainCode: "PRUEBA", description: "VALIDACION TECNICA SIN EMISION", quantity: 1,
      unitPrice: 10, subtotal: 10, discount: 0, taxes: [tax] }],
    additionalInformation: { Observacion: "PRUEBA TECNICA EN MEMORIA; NO EMITIDA NI TRANSMITIDA" }
  };
  if (type === "07") payload.withholding = {
    relatedParty: false, fiscalPeriod: issueDate.slice(5, 7) + "/" + issueDate.slice(0, 4),
    supportingDocuments: [{ supportCode: "01", documentCode: "01", documentNumber: "001003000000001",
      issueDate, accountingDate: issueDate, authorizationNumber: access.accessKey, paymentLocation: "01",
      totalWithoutTax: 10, grandTotal: 10, taxes: [tax],
      retentions: [{ code: "1", retentionCode: "312", taxableBase: 10, rate: 2, value: 0.2 }], payments: [{ method: "20", total: 10 }] }]
  };
  return payload;
}

async function validateSriXmlSignatureDryRun(bytes, password, company, type, context) {
  const result = { valid: false, company_id: company.id, document_type: type,
    commercial_context: type === "07" ? "RETENTION" : context,
    certificate_validation: "FAIL", ruc_match: "UNPROVEN", xml_build: "NOT_EXECUTED",
    xades_sign: "NOT_EXECUTED", schema_validation: "NOT_EXECUTED", environment: "TEST",
    environment_code: "1", writes: 0, failure_stage: "CERTIFICATE" };
  let material;
  let xml = "";
  let signedXml = "";
  try {
    if (!allowedDryRun(company.id, type, context)) { result.failure_stage = "FIXTURE"; return result; }
    const checked = validateSriPkcs12ForCompany(bytes, password, company.id, company.tax_id);
    material = checked.material;
    result.ruc_match = checked.validation.ruc_match;
    if (!checked.validation.valid || !material) return result;
    result.certificate_validation = "PASS";
    result.failure_stage = "XML_BUILD";
    const payload = dryRunFixture(company, type, context);
    xml = buildDocumentXml(type, payload);
    if (!xml.includes("<ambiente>1</ambiente>") || !xml.includes("<ptoEmi>" + payload.document.emissionPointCode + "</ptoEmi>")) throw new Error("FIXTURE_CONTRACT");
    if (FIXTURE_PROFILES[company.id].withholdingAgentNumber === null && xml.includes("<agenteRetencion>")) throw new Error("IMPERIO_AGENT_FORBIDDEN");
    result.xml_build = "PASS";
    result.series = "001-" + payload.document.emissionPointCode;
    result.failure_stage = "XSD_UNSIGNED";
    await assertOfficialXsd({ documentType: type, version: payload.document.version, xml });
    result.failure_stage = "XADES";
    signedXml = await signXadesBes({ xml, certificate: material });
    result.xades_sign = "PASS"; // signXadesBes verifies the generated signature in memory.
    result.failure_stage = "XSD_SIGNED";
    await assertOfficialXsd({ documentType: type, version: payload.document.version, xml: signedXml });
    result.schema_validation = "PASS";
    result.valid = true;
    result.failure_stage = null;
  } catch {
    // Schema/crypto errors can contain input data. Return only the failed stage.
    if (result.failure_stage === "XML_BUILD") result.xml_build = "FAIL";
    if (result.failure_stage === "XADES") result.xades_sign = "FAIL";
    if (result.failure_stage?.startsWith("XSD_")) result.schema_validation = "FAIL";
  } finally {
    releaseCertificateMaterial(material);
    xml = "";
    signedXml = "";
  }
  return result;
}

module.exports = { allowedDryRun, dryRunFixture, validateSriXmlSignatureDryRun };
