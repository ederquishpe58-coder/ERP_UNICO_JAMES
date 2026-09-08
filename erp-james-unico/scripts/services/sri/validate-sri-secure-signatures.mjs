import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parsePkcs12 } = require("../../../api/sri/_lib/certificate.cjs");
const { buildAccessKey } = require("../../../api/sri/_lib/access-key.cjs");
const { buildInvoiceXml } = require("../../../api/sri/_lib/xml-builders.cjs");
const { assertOfficialXsd } = require("../../../api/sri/_lib/xsd-validator.cjs");
const { signXadesBes, verifyXadesBes } = require("../../../api/sri/_lib/xades-signer.cjs");
const { sendForReception, queryAuthorization } = require("../../../api/sri/_lib/sri-soap.cjs");

const profiles = [
  {
    key: "BLESS",
    ruc: "1717637084001",
    legalName: "Lanchimba Tutillo Manuel Clemente",
    commercialName: "Bless Flower",
    pathVariable: "SRI_P12_PATH_BLESS",
    passwordVariable: "SRI_P12_PASSWORD_BLESS",
    emissionPointCode: "002",
    numericCode: "24072026",
    accountingRequired: true
  },
  {
    key: "IMPERIO",
    ruc: "1727970137001",
    legalName: "Lanchimba Tipanluisa Sandy Anahi",
    commercialName: "Imperio Flowers",
    pathVariable: "SRI_P12_PATH_IMPERIO",
    passwordVariable: "SRI_P12_PASSWORD_IMPERIO",
    emissionPointCode: "001",
    numericCode: "24072027",
    accountingRequired: false
  }
];

function todayEcuador(now = new Date()) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${values.year}-${values.month}-${values.day}`;
}

function samplePayload(profile, access, issueDate) {
  const subtotal = 45;
  const zeroTax = {
    code: "2",
    percentageCode: "0",
    rate: 0,
    taxableBase: subtotal,
    value: 0
  };
  return {
    document: {
      version: "1.1.0",
      environmentCode: "1",
      emissionType: "1",
      accessKey: access.accessKey,
      establishmentCode: "001",
      emissionPointCode: profile.emissionPointCode,
      sequential: access.sequential,
      issueDate,
      establishmentAddress: "Cayambe, Pichincha, Ecuador",
      issuer: {
        legalName: profile.legalName,
        commercialName: profile.commercialName,
        ruc: profile.ruc,
        headOfficeAddress: "Cayambe, Pichincha, Ecuador",
        accountingRequired: profile.accountingRequired
      }
    },
    buyer: {
      identificationType: "08",
      identification: "9999999999999",
      legalName: "CLIENTE EXTERIOR PRUEBA",
      address: "MIAMI, FLORIDA, ESTADOS UNIDOS"
    },
    invoice: {
      incoterm: "FCA",
      incotermPlace: "QUITO",
      originCountryCode: "593",
      portOfLoading: "UIO",
      portOfDestination: "MIA",
      destinationCountryCode: "110",
      acquisitionCountryCode: "593",
      totalWithoutTax: subtotal,
      totalWithoutTaxIncoterm: "FCA",
      discountTotal: 0,
      internationalFreight: 0,
      internationalInsurance: 0,
      customsExpenses: 0,
      otherTransportExpenses: 0,
      grandTotal: subtotal,
      currency: "USD",
      payments: [{ method: "20", total: subtotal }]
    },
    taxes: [zeroTax],
    lines: [{
      mainCode: "ROSAS",
      auxiliaryCode: "FREEDOM-60",
      description: "ROSAS DE CORTE PARA EXPORTACION - PRUEBA",
      unit: "TALLO",
      quantity: 100,
      unitPrice: 0.45,
      discount: 0,
      subtotal,
      variety: "FREEDOM",
      measure: "60 CM",
      taxes: [zeroTax]
    }],
    additionalInformation: {
      Observacion: "DOCUMENTO DE PRUEBA SIN VALIDEZ TRIBUTARIA",
      Empresa: profile.commercialName
    }
  };
}

const issueDate = process.env.SRI_TEST_ISSUE_DATE || todayEcuador();
const sequence = Number(process.env.SRI_TEST_SEQUENCE || 1);
const shouldTransmit = process.env.SRI_TEST_TRANSMIT === "1";
const results = [];

for (const profile of profiles) {
  const p12Path = process.env[profile.pathVariable];
  const password = process.env[profile.passwordVariable];
  assert.ok(p12Path, `Falta ${profile.pathVariable}.`);
  assert.ok(password, `Falta el secreto ${profile.passwordVariable}.`);

  const certificate = parsePkcs12(await readFile(p12Path), password, {
    expectedRuc: profile.ruc,
    expirationWarningDays: 90
  });
  assert.equal(certificate.metadata.holderRuc, profile.ruc);
  assert.equal(certificate.metadata.holderIdentification, profile.ruc.slice(0, 10));

  const access = buildAccessKey({
    issueDate,
    documentType: "01",
    ruc: profile.ruc,
    environment: "TEST",
    establishmentCode: "001",
    emissionPointCode: profile.emissionPointCode,
    sequential: sequence,
    numericCode: profile.numericCode,
    emissionType: "1"
  });
  assert.equal(access.environmentCode, "1");
  assert.equal(access.accessKey[23], "1");

  const unsignedXml = buildInvoiceXml(samplePayload(profile, access, issueDate));
  const unsignedValidation = await assertOfficialXsd({
    documentType: "01",
    version: "1.1.0",
    xml: unsignedXml
  });
  const signedXml = await signXadesBes({
    xml: unsignedXml,
    certificate,
    signingTime: new Date()
  });
  const signedValidation = await assertOfficialXsd({
    documentType: "01",
    version: "1.1.0",
    xml: signedXml
  });
  assert.equal(await verifyXadesBes(signedXml), true);
  assert.match(signedXml, new RegExp(`<ruc>${profile.ruc}</ruc>`));
  assert.match(signedXml, /<ds:Signature|<Signature/);

  let reception = null;
  let authorization = null;
  if (shouldTransmit) {
    reception = await sendForReception(signedXml, { environment: "TEST", timeoutMs: 30000,
      document: { environment: "TEST", access_key: access.accessKey, document_type: "01", issuer_snapshot: { ruc: profile.ruc },
        issue_date: issueDate, establishment_code: "001", emission_point_code: profile.emissionPointCode,
        sequential_text: access.sequential, xml_version: "1.1.0" }
    });
    assert.equal(
      reception.received,
      true,
      `${profile.commercialName}: el SRI devolvió el comprobante. ${reception.messages.map(item => [item.identifier, item.message, item.additionalInformation].filter(Boolean).join(" - ")).join(" | ")}`
    );
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 2000));
      authorization = await queryAuthorization(access.accessKey, { environment: "TEST", timeoutMs: 30000 });
      if (authorization.state !== "NO_ENCONTRADO") break;
    }
    assert.equal(
      authorization?.state,
      "AUTORIZADO",
      `${profile.commercialName}: el comprobante de prueba no fue autorizado. ${(authorization?.messages || []).map(item => [item.identifier, item.message, item.additionalInformation].filter(Boolean).join(" - ")).join(" | ")}`
    );
  }

  results.push({
    company: profile.commercialName,
    ruc: profile.ruc,
    environment: "TEST",
    environmentCode: access.environmentCode,
    sequence: access.sequential,
    emissionPoint: `001-${profile.emissionPointCode}`,
    certificateSubject: certificate.metadata.subject,
    certificateValidFrom: certificate.metadata.notBefore,
    certificateValidUntil: certificate.metadata.notAfter,
    privateKeyMatched: true,
    unsignedXsd: unsignedValidation.valid,
    xadesSignatureVerified: true,
    signedXsd: signedValidation.valid,
    receptionState: reception?.state || "NO_TRANSMITIDO",
    authorizationState: authorization?.state || "NO_CONSULTADO",
    sriMessages: [
      ...(reception?.messages || []),
      ...(authorization?.messages || [])
    ].map(item => ({
      identifier: item.identifier,
      message: item.message,
      additionalInformation: item.additionalInformation,
      type: item.type
    }))
  });
}

assert.notEqual(results[0].ruc, results[1].ruc);
assert.equal(results[0].sequence, results[1].sequence);

console.log(JSON.stringify({
  ok: true,
  technicalSpec: "2.34",
  invoiceXmlVersion: "1.1.0",
  transmittedToSri: shouldTransmit,
  companies: results
}, null, 2));
