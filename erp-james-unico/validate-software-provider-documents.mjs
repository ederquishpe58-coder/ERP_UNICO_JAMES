import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const softwareProvider = require("./scripts/config/software-provider.js");
const { buildAccessKey } = require("./api/sri/_lib/access-key.cjs");
const {
  buildInvoiceXml,
  buildCreditNoteXml,
  buildDeliveryGuideXml,
  buildWithholdingXml
} = require("./api/sri/_lib/xml-builders.cjs");
const { assertOfficialXsd } = require("./api/sri/_lib/xsd-validator.cjs");
const { generateRidePdf } = require("./api/sri/_lib/ride.cjs");

const issueDate = "2026-08-31";
const issuer = {
  legalName: "MANUEL CLEMENTE LANCHIMBA TUTILLO",
  commercialName: "BLESS FLOWER",
  ruc: "1717637084001",
  headOfficeAddress: "CAYAMBE, PICHINCHA",
  accountingRequired: true
};

function documentFor(documentType, sequential, version = "1.1.0") {
  const access = buildAccessKey({
    issueDate,
    documentType,
    ruc: issuer.ruc,
    environment: "TEST",
    establishmentCode: "001",
    emissionPointCode: "001",
    sequential,
    numericCode: "31082026",
    emissionType: "1"
  });
  return {
    version,
    environmentCode: "1",
    emissionType: "1",
    accessKey: access.accessKey,
    establishmentCode: "001",
    emissionPointCode: "001",
    sequential: access.sequential,
    issueDate,
    establishmentAddress: issuer.headOfficeAddress,
    issuer
  };
}

const zeroTax = base => ({
  code: "2",
  percentageCode: "0",
  rate: 0,
  taxableBase: base,
  value: 0
});

const buyer = {
  identificationType: "04",
  identification: "1727970137001",
  legalName: "IMPERIO FLOWERS",
  address: "CAYAMBE",
  email: "cliente@example.com"
};
const invoiceDocument = documentFor("01", 951);
const invoicePayload = {
  document: invoiceDocument,
  buyer,
  invoice: {
    commerceType: "LOCAL",
    totalWithoutTax: 10,
    discountTotal: 0,
    grandTotal: 10,
    currency: "DOLAR",
    payments: [{ method: "20", total: 10 }]
  },
  taxes: [zeroTax(10)],
  lines: [{
    mainCode: "ROSA",
    description: "ROSAS",
    quantity: 10,
    unitPrice: 1,
    discount: 0,
    subtotal: 10,
    taxes: [zeroTax(10)]
  }],
  additionalInformation: {
    "Correo cliente": buyer.email,
    "RUC Proveedor": softwareProvider.providerRuc,
    "Proveedor del sistema": softwareProvider.providerName
  }
};

const creditDocument = documentFor("04", 952);
const guideDocument = documentFor("06", 953);
const withholdingDocument = documentFor("07", 954, "2.0.0");
const documents = [
  ["01", "1.1.0", buildInvoiceXml(invoicePayload)],
  ["04", "1.1.0", buildCreditNoteXml({
    document: creditDocument,
    buyer,
    creditNote: {
      totalWithoutTax: 5,
      modificationValue: 5,
      currency: "DOLAR",
      reason: "DEVOLUCION PARCIAL"
    },
    originalInvoice: { status: "AUTORIZADO", fullNumber: "001-001-000000951", issueDate },
    taxes: [zeroTax(5)],
    lines: [{ mainCode: "ROSA", description: "ROSAS", quantity: 5, unitPrice: 1, discount: 0, subtotal: 5, taxes: [zeroTax(5)] }],
    additionalInformation: { "RUC Proveedor": softwareProvider.providerRuc }
  })],
  ["06", "1.1.0", buildDeliveryGuideXml({
    document: guideDocument,
    deliveryGuide: {
      departureAddress: "CAYAMBE",
      startDate: issueDate,
      endDate: issueDate,
      transferReason: "VENTA",
      carrier: { legalName: "TRANSPORTISTA PRUEBA", identificationType: "04", identification: "1790012345001", plate: "PBA1234" },
      recipient: { identification: buyer.identification, legalName: buyer.legalName, address: buyer.address }
    },
    lines: [{ mainCode: "ROSA", description: "ROSAS", quantity: 10, unit: "TALLO" }],
    additionalInformation: { "RUC Proveedor": softwareProvider.providerRuc }
  })],
  ["07", "2.0.0", buildWithholdingXml({
    document: withholdingDocument,
    buyer,
    withholding: {
      relatedParty: false,
      fiscalPeriod: "08/2026",
      supportingDocuments: [{
        supportCode: "01",
        documentCode: "01",
        documentNumber: "001001000000001",
        issueDate,
        accountingDate: issueDate,
        authorizationNumber: "3108202601172797013700110010010000000013108202619",
        paymentLocation: "01",
        totalWithoutTax: 100,
        grandTotal: 115,
        taxes: [{ code: "2", percentageCode: "4", taxableBase: 100, rate: 15, value: 15 }],
        retentions: [{ code: "1", retentionCode: "312", taxableBase: 100, rate: 2, value: 2 }],
        payments: [{ method: "20", total: 115 }]
      }]
    },
    additionalInformation: { "RUC Proveedor": softwareProvider.providerRuc }
  })]
];

assert.equal(softwareProvider.billingSystemProviderEnabled, false);
assert.equal(softwareProvider.mode, "OWN_INTERNAL");
assert.equal(softwareProvider.providerRuc, "1754767067001", "El RUC futuro debe permanecer solo en configuracion desactivada.");
assert.equal(softwareProvider.providerName, "LANCHIMBA TIPANLUISA JAMES SANTIAGO");
assert.deepEqual(softwareProvider.publicAdditionalInformation, {});
assert.deepEqual(softwareProvider.mergeAdditionalInformation({
  "Correo cliente": buyer.email,
  "RUC Proveedor": softwareProvider.providerRuc,
  "Proveedor del sistema": softwareProvider.providerName
}), { "Correo cliente": buyer.email });

for (const [documentType, version, xml] of documents) {
  assert.equal(softwareProvider.hasExpectedProviderField(xml), true, `${documentType}: contrato de proveedor inesperado.`);
  assert.doesNotMatch(xml, /RUC Proveedor|Proveedor del sistema|1754767067001/);
  assert.match(xml, new RegExp(`<ruc>${issuer.ruc}<\\/ruc>`));
  await assertOfficialXsd({ documentType, version, xml });
}
assert.match(documents[0][2], new RegExp(`<claveAcceso>${invoiceDocument.accessKey}<\\/claveAcceso>`));
assert.match(documents[0][2], /<campoAdicional nombre="Correo cliente">cliente@example\.com<\/campoAdicional>/);

const ridePdf = await generateRidePdf({
  document: {
    id: "DOC-OWN-INTERNAL-1",
    status: "AUTORIZADO",
    document_type: "01",
    full_number: "001-001-000000951",
    authorization_number: invoiceDocument.accessKey,
    access_key: invoiceDocument.accessKey,
    authorized_at: "2026-08-31 10:00:00",
    environment: "TEST",
    issue_date: issueDate,
    subtotal: 10,
    discount_total: 0,
    tax_total: 0,
    grand_total: 10,
    currency: "DOLAR",
    issuer_snapshot: issuer,
    buyer_snapshot: buyer,
    source_snapshot: {
      invoice: { commerceType: "LOCAL" },
      additionalInformation: {
        "Correo cliente": buyer.email,
        "RUC Proveedor": softwareProvider.providerRuc,
        "Proveedor del sistema": softwareProvider.providerName
      }
    }
  },
  lines: [{ main_code: "ROSA", description: "ROSAS", quantity: 10, unit_price: 1, discount: 0, subtotal: 10 }]
});

const pdfToTextCandidates = [
  process.env.PDFTOTEXT_EXE,
  "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe",
  "pdftotext"
].filter(Boolean);
const tempDirectory = mkdtempSync(join(tmpdir(), "jaeder-own-internal-"));
try {
  const pdfPath = join(tempDirectory, "ride.pdf");
  writeFileSync(pdfPath, ridePdf);
  let rideText = "";
  let extracted = false;
  for (const executable of pdfToTextCandidates) {
    if (executable.includes("\\") && !existsSync(executable)) continue;
    const result = spawnSync(executable, ["-layout", pdfPath, "-"], { encoding: "utf8" });
    if (result.status !== 0) continue;
    rideText = result.stdout;
    extracted = true;
    break;
  }
  assert.equal(extracted, true, "No se pudo extraer texto del RIDE para la validacion focalizada.");
  assert.doesNotMatch(rideText, /RUC PROVEEDOR|Proveedor del sistema|1754767067001/i);
  assert.match(rideText, /BLESS FLOWER/);
  assert.match(rideText, /1717637084001/);
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

const backendRideSource = readFileSync("api/sri/_lib/ride.cjs", "utf8");
const invoiceRideSource = readFileSync("scripts/modules/comercial/print/sri-invoice-print.js", "utf8");
const retentionRideSource = readFileSync("scripts/modules/purchases/retention-ride.js", "utf8");
const purchasesServiceSource = readFileSync("scripts/services/purchases.js", "utf8");
assert.match(backendRideSource, /softwareProvider\.billingSystemProviderEnabled/);
assert.match(invoiceRideSource, /softwareProvider\.billingSystemProviderEnabled/);
assert.match(retentionRideSource, /softwareProvider\?\.isProviderField/);
assert.match(purchasesServiceSource, /softwareProvider\?\.billingSystemProviderEnabled/);
assert.match(purchasesServiceSource, /softwareProvider\.hasExpectedProviderField/);
assert.doesNotMatch(backendRideSource, /extra\["RUC Proveedor"\]\s*\|\|\s*softwareProvider\.ruc/);
assert.doesNotMatch(invoiceRideSource, /provider\.ruc\s*\|\|\s*"-"/);

const browserWindow = {
  BlessERP: {
    comercialUtils: {
      esc: value => String(value ?? ""),
      dateLabel: value => String(value ?? "")
    },
    comercialPrintUtils: {
      companyLogoUrl: () => "logo.png"
    },
    comercialSriOrderQueueCore: {
      isExportOrder: () => false,
      buildInvoicePayload: () => ({ ok: true, payload: { lines: invoicePayload.lines } })
    },
    code128: { barcodeSvg: () => "<svg></svg>" },
    services: {
      companyContext: { activeCompanyId: () => "COMP-BLESS-FLOWER" },
      companyBranding: { resolve: () => ({ ...issuer, address: issuer.headOfficeAddress }) },
      companySettings: { settings: () => ({}) }
    }
  }
};
browserWindow.window = browserWindow;
browserWindow.globalThis = browserWindow;
runInNewContext(readFileSync("scripts/config/software-provider.js", "utf8"), browserWindow);
runInNewContext(invoiceRideSource, browserWindow);
runInNewContext(retentionRideSource, browserWindow);

const browserInvoiceRide = browserWindow.BlessERP.comercialPrintDocs.SRI_RIDE.render({
  company: { ...issuer, address: issuer.headOfficeAddress },
  customer: buyer,
  brand: null,
  metrics: { totalStems: 10, totalUsd: 10, totalBoxes: 1, lines: invoicePayload.lines },
  order: {
    sriAuthorizationStatus: "AUTORIZADO",
    sriInvoiceNumber: "001-001-000000951",
    sriAuthorizationNumber: invoiceDocument.accessKey,
    sriAccessKey: invoiceDocument.accessKey,
    sriAuthorizedAt: "2026-08-31T10:00:00-05:00",
    sriEnvironment: "PRUEBAS",
    issuedAt: issueDate,
    destinationCountry: "ECUADOR"
  }
});
assert.doesNotMatch(browserInvoiceRide, /RUC Proveedor|Proveedor del sistema|1754767067001/i);

const browserRetentionRide = browserWindow.BlessERP.retentionRide.render({
  status: "AUTORIZADO",
  fullNumber: "001-001-000000954",
  accessKey: withholdingDocument.accessKey,
  authorizationNumber: withholdingDocument.accessKey,
  authorizedAt: "2026-08-31T10:00:00-05:00",
  retentionDate: issueDate,
  totalRetained: 2,
  document: {
    status: "AUTORIZADO",
    full_number: "001-001-000000954",
    access_key: withholdingDocument.accessKey,
    authorization_number: withholdingDocument.accessKey,
    authorized_at: "2026-08-31T10:00:00-05:00",
    issue_date: issueDate,
    issuer_snapshot: issuer,
    buyer_snapshot: buyer,
    source_snapshot: {
      additionalInformation: {
        "Correo cliente": buyer.email,
        "RUC Proveedor": softwareProvider.providerRuc,
        "Proveedor del sistema": softwareProvider.providerName
      },
      withholding: { fiscalPeriod: "08/2026", supportingDocuments: [] }
    }
  }
}, null);
assert.doesNotMatch(browserRetentionRide, /RUC Proveedor|Proveedor del sistema|1754767067001/i);

console.log("BILLING_SYSTEM_PROVIDER_ENABLED=false");
console.log("BILLING_MODE=OWN_INTERNAL");
console.log("RIDE_SIN_PROVEEDOR=PASS");
console.log("XML_SIN_PROVEEDOR=PASS");
console.log("XML_SCHEMA=PASS");
console.log("FACTURACION_NORMAL=PASS");
