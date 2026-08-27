import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildAccessKey } = require("../../../api/sri/_lib/access-key.cjs");
const { buildWithholdingXml } = require("../../../api/sri/_lib/xml-builders.cjs");
const { assertOfficialXsd } = require("../../../api/sri/_lib/xsd-validator.cjs");
const { parsePkcs12 } = require("../../../api/sri/_lib/certificate.cjs");
const { signXadesBes, verifyXadesBes } = require("../../../api/sri/_lib/xades-signer.cjs");
const { dbError } = require("../../../api/sri/_lib/document-service.cjs");
const { claimJob } = require("../../../api/sri/_lib/transmission-service.cjs");

const issueDate = "2026-08-02";
const access = buildAccessKey({
  issueDate,
  documentType: "07",
  ruc: "1717637084001",
  environment: "TEST",
  establishmentCode: "001",
  emissionPointCode: "002",
  sequential: 687,
  numericCode: "02082026",
  emissionType: "1"
});

const payload = {
  document: {
    version: "2.0.0",
    environmentCode: "1",
    emissionType: "1",
    accessKey: access.accessKey,
    establishmentCode: "001",
    emissionPointCode: "002",
    sequential: access.sequential,
    issueDate,
    establishmentAddress: "Cangahua, Cayambe, Pichincha",
    issuer: {
      legalName: "Lanchimba Tutillo Manuel Clemente",
      commercialName: "Bless Flower",
      ruc: "1717637084001",
      headOfficeAddress: "Cangahua, Cayambe, Pichincha",
      accountingRequired: true,
      withholdingAgentNumber: "1"
    }
  },
  buyer: {
    identificationType: "04",
    identification: "1727970137001",
    legalName: "Lanchimba Tipanluisa Sandy Anahi",
    address: "Cangahua, Cayambe, Pichincha"
  },
  withholding: {
    relatedParty: false,
    fiscalPeriod: "08/2026",
    supportingDocuments: [{
      supportCode: "01",
      documentCode: "01",
      documentNumber: "001001000000001",
      issueDate,
      accountingDate: issueDate,
      authorizationNumber: "0208202601172797013700110010010000000010208202619",
      paymentLocation: "01",
      totalWithoutTax: 100,
      grandTotal: 115,
      taxes: [{ code: "2", percentageCode: "4", taxableBase: 100, rate: 15, value: 15 }],
      retentions: [
        { code: "1", retentionCode: "312", taxableBase: 100, rate: 2, value: 2 },
        { code: "2", retentionCode: "1", taxableBase: 15, rate: 30, value: 4.5 }
      ],
      payments: [{ method: "20", total: 115 }]
    }]
  }
};

const unsignedXml = buildWithholdingXml(payload);
assert.match(unsignedXml, /<comprobanteRetencion[^>]+version="2\.0\.0"/);
assert.match(unsignedXml, /<codDoc>07<\/codDoc>/);
assert.match(unsignedXml, /<codigoRetencion>312<\/codigoRetencion>/);
assert.match(unsignedXml, /<codigoRetencion>1<\/codigoRetencion>/);
assert.match(unsignedXml, /<campoAdicional nombre="RUC Proveedor">1754767067001<\/campoAdicional>/);
const unsignedReport = await assertOfficialXsd({ documentType: "07", version: "2.0.0", xml: unsignedXml });

assert.throws(
  () => dbError({ error: { code: "TEST_DB", message: "detalle interno" } }, "Prueba backend"),
  error => error.code === "SRI_BACKEND_ERROR"
    && error.details?.stage === "Prueba backend"
    && error.details?.databaseCode === "TEST_DB"
);
assert.throws(
  () => dbError({ error: { code: "22023", message: "SRI_DOCUMENT_TYPE_NOT_ENABLED" } }, "Creacion de borrador SRI"),
  error => error.code === "SRI_CONFIGURATION_ERROR"
    && /retencion 07/i.test(error.message)
    && error.details?.databaseMessage === "SRI_DOCUMENT_TYPE_NOT_ENABLED"
);

const retentionMigration = await readFile(
  new URL("../../../supabase/migrations/202608020010_sri_withholding_ats_2_0_0.sql", import.meta.url),
  "utf8"
);
assert.match(retentionMigration, /p_document_type not in \('01', '04', '06', '07'\)/);
assert.match(retentionMigration, /p_document_type = '07'[\s\S]*p_xml_version <> '2\.0\.0'/);

const purchasesUiSource = await readFile(
  new URL("../../modules/part2-purchases.js", import.meta.url),
  "utf8"
);
const prepareIndex = purchasesUiSource.indexOf("await ensureRetentionSriDraft(draft)");
const accountingIndex = purchasesUiSource.indexOf("purchaseService.confirmRetentionDraft(draft.id)", prepareIndex);
assert.ok(prepareIndex >= 0 && accountingIndex > prepareIndex, "El borrador SRI debe reservarse antes de contabilizar.");

const scheduledJob = {
  id: "10000000-0000-4000-8000-000000000099",
  company_id: "10000000-0000-4000-8000-000000000001",
  document_id: "10000000-0000-4000-8000-000000000098",
  transmission_type: "AUTHORIZATION_QUERY",
  status: "RETRY_SCHEDULED",
  attempt_number: 1,
  max_attempts: 12,
  next_attempt_at: new Date(Date.now() + 60000).toISOString()
};
await assert.rejects(
  () => claimJob({ rpc: () => { throw new Error("No debe reclamar antes del plazo."); } }, scheduledJob, false),
  error => error.code === "SRI_TRANSMISSION_NOT_DUE" && error.retryable === true
);

let forcedUpdate = false;
let rpcCalls = 0;
const forcedBuilder = {
  update(patch) {
    forcedUpdate = Boolean(patch.next_attempt_at);
    return this;
  },
  eq() { return this; },
  select() { return this; },
  async single() {
    return { data: { ...scheduledJob, next_attempt_at: new Date().toISOString() }, error: null };
  }
};
const claimedJob = await claimJob({
  from(table) {
    assert.equal(table, "sri_transmissions");
    return forcedBuilder;
  },
  async rpc(name) {
    assert.equal(name, "claim_sri_transmission");
    rpcCalls += 1;
    return { data: { ...scheduledJob, status: "PROCESSING", attempt_number: 2 }, error: null };
  }
}, scheduledJob, true);
assert.equal(forcedUpdate, true);
assert.equal(rpcCalls, 1);
assert.equal(claimedJob.status, "PROCESSING");

let signatureVerified = false;
let signedReport = null;
if (process.env.SRI_P12_PATH_BLESS && process.env.SRI_P12_PASSWORD_BLESS) {
  const certificate = parsePkcs12(
    await readFile(process.env.SRI_P12_PATH_BLESS),
    process.env.SRI_P12_PASSWORD_BLESS,
    { expectedRuc: "1717637084001" }
  );
  const signedXml = await signXadesBes({ xml: unsignedXml, certificate, signingTime: new Date() });
  signatureVerified = await verifyXadesBes(signedXml);
  signedReport = await assertOfficialXsd({ documentType: "07", version: "2.0.0", xml: signedXml });
  assert.equal(signatureVerified, true);
}

console.log(JSON.stringify({
  ok: true,
  environment: "TEST",
  technicalSpec: "2.34",
  documentType: "07",
  xmlVersion: "2.0.0",
  manualRetry: true,
  backendDiagnostics: true,
  unsignedXsd: unsignedReport.valid,
  signedXsd: signedReport?.valid ?? null,
  signatureVerified
}, null, 2));
