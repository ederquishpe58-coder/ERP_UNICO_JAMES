import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import forge from "node-forge";

const require = createRequire(import.meta.url);
const backendAccessKey = require("../../../api/sri/_lib/access-key.cjs");
const sriQueueCore = require("../../modules/comercial/sri-order-queue-core.js");
const sourcePath = resolve("scripts/services/sri/sri-api-client.js");
const source = readFileSync(sourcePath, "utf8");
const sessionValues = new Map();
const sessionStorage = {
  getItem(key) {
    return sessionValues.has(key) ? sessionValues.get(key) : null;
  },
  setItem(key, value) {
    sessionValues.set(String(key), String(value));
  },
  removeItem(key) {
    sessionValues.delete(String(key));
  }
};
const window = {
  BlessERP: {
    getEnvConfig: () => ({}),
    getSupabaseStatus: () => ({})
  },
  sessionStorage
};
const context = vm.createContext({
  window,
  URLSearchParams,
  URL,
  Date,
  Intl,
  console,
  setTimeout,
  clearTimeout
});
vm.runInContext(source, context, { filename: sourcePath });
const api = window.BlessERP.sriApi;

function certificate(companyKey, ruc) {
  return {
    id: `cert-${companyKey.toLowerCase()}`,
    alias: `Firmante ${companyKey}`,
    subject_name: `CN=${companyKey}`,
    subject_ruc: ruc,
    valid_from: "2025-01-01T00:00:00.000Z",
    valid_until: "2030-12-31T23:59:59.000Z",
    active: true,
    validation_status: "VALID"
  };
}

function configuration(profile) {
  const pointId = `point-${profile.key.toLowerCase()}`;
  return {
    settings: {
      ruc: profile.ruc,
      legal_name: profile.legalName,
      commercial_name: profile.commercialName,
      environment: "TEST",
      production_enabled: false
    },
    emissionPoints: [{
      id: pointId,
      establishment_code: "001",
      emission_point_code: "001",
      establishment_address: "Direccion de prueba",
      environment: "TEST",
      active: true
    }],
    sequences: [{
      company_id: profile.companyId || "",
      emission_point_id: pointId,
      environment: "TEST",
      document_type: "01",
      next_value: profile.key === "BLESS_FLOWER" ? 675 : 1
    }],
    certificates: [certificate(profile.key, profile.ruc)]
  };
}

function inspectProtectedContainer(pathValue, companyLabel) {
  const path = resolve(pathValue);
  const extension = extname(path).toLowerCase();
  assert.ok([".p12", ".pfx"].includes(extension), `${companyLabel}: extension P12/PFX esperada`);
  const size = statSync(path).size;
  assert.ok(size > 0 && size <= 5 * 1024 * 1024, `${companyLabel}: tamano de certificado fuera de rango`);
  const bytes = readFileSync(path);
  const root = forge.asn1.fromDer(bytes.toString("binary"), false);
  assert.equal(root?.type, forge.asn1.Type.SEQUENCE, `${companyLabel}: contenedor ASN.1 no reconocido`);
  return { company: companyLabel, readable: true, asn1Container: true, bytes: size };
}

const profiles = api.companyProfiles();
assert.equal(profiles.length, 2, "Deben existir exactamente dos perfiles tributarios");
const bless = profiles.find(profile => profile.key === "BLESS_FLOWER");
const imperio = profiles.find(profile => profile.key === "IMPERIO_FLOWERS");
assert.ok(bless && imperio, "Faltan perfiles Bless o Imperio");
assert.notEqual(bless.ruc, imperio.ruc, "Cada empresa debe conservar RUC independiente");
assert.equal(bless.environmentCode, "1");
assert.equal(imperio.environmentCode, "1");
assert.equal(bless.defaultEmissionPoint, "003", "Bless debe usar por defecto el punto 003 para facturas");
assert.equal(imperio.defaultEmissionPoint, "001", "Imperio debe conservar una serie independiente pendiente de confirmacion");

const commonInput = {
  issueDate: "2026-07-24",
  documentType: "01",
  establishmentCode: "001",
  emissionPointCode: "001",
  sequential: 37,
  numericCode: "24681357"
};
const blessKey = api.buildTestAccessKey({ ...commonInput, companyKey: bless.key });
const imperioKey = api.buildTestAccessKey({ ...commonInput, companyKey: imperio.key });
assert.equal(blessKey.accessKey.length, 49);
assert.equal(imperioKey.accessKey.length, 49);
assert.notEqual(blessKey.accessKey, imperioKey.accessKey, "Las claves deben diferir por identidad emisora");
assert.equal(api.validateTestAccessKey(blessKey.accessKey, bless.key).ok, true);
assert.equal(api.validateTestAccessKey(imperioKey.accessKey, imperio.key).ok, true);
assert.equal(api.validateTestAccessKey(blessKey.accessKey, imperio.key).ok, false, "No se debe aceptar una clave cruzada");
assert.equal(api.validateTestAccessKey(imperioKey.accessKey, bless.key).ok, false, "No se debe aceptar una clave cruzada");
for (const [profile, localKey] of [[bless, blessKey], [imperio, imperioKey]]) {
  const backendKey = backendAccessKey.buildAccessKey({
    issueDate: commonInput.issueDate,
    documentType: commonInput.documentType,
    ruc: profile.ruc,
    environment: "TEST",
    establishmentCode: commonInput.establishmentCode,
    emissionPointCode: commonInput.emissionPointCode,
    sequential: commonInput.sequential,
    numericCode: commonInput.numericCode,
    emissionType: "1"
  });
  assert.equal(localKey.accessKey, backendKey.accessKey, `${profile.key}: la clave local debe coincidir con el backend`);
  assert.equal(backendAccessKey.validateAccessKey(localKey.accessKey), true);
}

const exportInvoice = sriQueueCore.buildInvoicePayload({
  order: {
    number: "PED-TEST-001",
    issuedAt: new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }),
    transportType: "MARITIMO",
    daeNumber: "",
    sriDaeNumber: "028-2026-TEST",
    awb: "014-12345678",
    hawb: "HAWB-TEST-001",
    packingListNumber: "000000037",
    destinationCountryCode: "840"
  },
  customer: {
    identification: "9999999999999",
    legalName: "CLIENTE EXTERIOR PRUEBA"
  },
  brand: {
    name: "CLIENTE FINAL PRUEBA",
    country: "ESTADOS UNIDOS"
  },
  company: {
    incoterm: "FCA UIO"
  },
  metrics: {
    totalStems: 100,
    totalUsd: 45,
    lines: [{
      id: "LINE-1",
      variety: "FREEDOM",
      length: 60,
      totalStems: 100,
      unitPrice: 0.45
    }]
  }
});
assert.equal(exportInvoice.ok, true);
assert.equal(exportInvoice.payload.invoice.originCountryCode, "593", "El país de origen Ecuador debe usar el catálogo SRI");
assert.equal(exportInvoice.payload.invoice.destinationCountryCode, "110", "Estados Unidos debe usar código SRI 110, no ISO 840");

for (const profile of [bless, imperio]) {
  const numbers = api.synchronizedDocumentNumbers({
    companyKey: profile.key,
    establishmentCode: "001",
    emissionPointCode: "001",
    sequential: 37
  });
  assert.equal(numbers.sriInvoiceNumber, "001-001-000000037");
  assert.equal(numbers.commercialInvoiceNumber, "000000037");
  assert.equal(numbers.clientInvoiceNumber, "000000037");
  assert.equal(numbers.packingListNumber, "000000037");
  assert.equal(api.validateSynchronizedDocumentNumbers(numbers).ok, true);
}

api.bindRuntimeCompany(bless.key, "11111111-1111-4111-8111-111111111111", configuration(bless), "ADMIN");
api.bindRuntimeCompany(imperio.key, "22222222-2222-4222-8222-222222222222", configuration(imperio), "ADMIN");
for (const profile of [bless, imperio]) {
  const validation = api.validateCompanyConfiguration(configuration(profile), profile.key, new Date("2026-07-24T12:00:00Z"));
  assert.equal(validation.readyForInvoice, true, `${profile.key}: configuracion de factura no lista`);
  assert.equal(validation.readyForSignature, true, `${profile.key}: seleccion de firmante no lista`);
  assert.equal(validation.signer.subjectRuc, profile.ruc);
  api.selectCompany(profile.key);
  assert.equal(api.activeCompanyKey(), profile.key);
  assert.equal(api.activeCompany().companyId.length, 36);
}

const persisted = JSON.stringify(Object.fromEntries(sessionValues));
assert.equal(/password|contrasena|p12|pfx|secret/i.test(persisted), false, "La sesion no debe persistir secretos ni certificados");
assert.equal(/password|contrasena|p12|pfx|secret/i.test(JSON.stringify(api.companyProfiles())), false, "Los perfiles publicos no deben exponer secretos");

const externalCertificates = process.argv.slice(2).map((path, index) => (
  inspectProtectedContainer(path, index === 0 ? "BLESS FLOWER" : "IMPERIO FLOWERS")
));

console.log(JSON.stringify({
  ok: true,
  companies: profiles.map(profile => ({
    key: profile.key,
    environment: profile.environment,
    accessKeyValidated: true,
    synchronizedSequenceValidated: true,
    signerSelectionValidated: true
  })),
  externalCertificates,
  note: externalCertificates.length
    ? "Los P12 son legibles como contenedores ASN.1 externos. La vigencia y el RUC se validan en backend al recibir la clave desde un secreto seguro."
    : "No se inspeccionaron archivos P12; la validacion de vigencia y RUC requiere el backend y un secreto seguro."
}, null, 2));
