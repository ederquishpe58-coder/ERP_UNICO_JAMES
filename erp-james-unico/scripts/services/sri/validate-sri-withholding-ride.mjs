import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { buildAccessKey } = require("../../../api/sri/_lib/access-key.cjs");
const { generateRidePdf } = require("../../../api/sri/_lib/ride.cjs");

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

const detail = {
  document: {
    id: "00000000-0000-4000-8000-000000000007",
    document_type: "07",
    status: "AUTORIZADO",
    environment: "TEST",
    full_number: "001-002-000000687",
    access_key: access.accessKey,
    authorization_number: access.accessKey,
    authorized_at: "2026-08-02T10:00:00-05:00",
    issue_date: issueDate,
    currency: "USD",
    subtotal: 6.5,
    discount_total: 0,
    tax_total: 0,
    grand_total: 6.5,
    issuer_snapshot: {
      legalName: "Lanchimba Tutillo Manuel Clemente",
      commercialName: "Bless Flower",
      ruc: "1717637084001",
      headOfficeAddress: "Cangahua, Cayambe, Pichincha",
      branchAddress: "Cangahua, Cayambe, Pichincha",
      logoPath: "scripts/assets/bless-flower-logo-official-transparent.png",
      accountingRequired: true
    },
    buyer_snapshot: {
      legalName: "Lanchimba Tipanluisa Sandy Anahi",
      identification: "1727970137001",
      address: "Cangahua, Cayambe, Pichincha",
      email: "proveedor@example.test"
    },
    source_snapshot: {
      additionalInformation: { "Referencia interna": "VALIDACION RIDE TEST" },
      withholding: {
        fiscalPeriod: "08/2026",
        supportingDocuments: [{
          supportCode: "01",
          documentCode: "01",
          documentNumber: "001001000000002",
          issueDate,
          totalWithoutTax: 100,
          grandTotal: 115,
          retentions: [
            { code: "1", retentionCode: "312", taxableBase: 100, rate: 2, value: 2 },
            { code: "2", retentionCode: "1", taxableBase: 15, rate: 30, value: 4.5 }
          ]
        }]
      }
    }
  },
  lines: []
};

const pdf = await generateRidePdf(detail);
assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
assert.ok(pdf.length > 10_000, "El RIDE generado es demasiado pequeno.");

const outputDirectory = path.resolve(process.env.SRI_RIDE_OUTPUT_DIR || path.join("tmp", "sri-withholding-ride"));
const outputPath = path.join(outputDirectory, process.env.SRI_RIDE_OUTPUT_NAME || "retencion-pruebas-001-002-000000687.pdf");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, pdf);
console.log(JSON.stringify({ ok: true, outputPath, bytes: pdf.length }, null, 2));
