const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { fixture, payloadFor, COMPANIES, effects, mockClient, service, inputFor } = require("./validate-sri-dual-documents.cjs");
const { ecuadorDate, emissionDatePolicy } = require("./api/sri/_lib/emission-date.cjs");
const { buildDocumentXml } = require("./api/sri/_lib/xml-builders.cjs");
const { assertDocumentXmlIdentity } = require("./api/sri/_lib/xml-identity.cjs");
const { SECRET_REFERENCES } = require("./api/sri/_lib/certificate.cjs");

// All RPCs, certificates, repository reads and writes are isolated adapters.
global.fetch = async () => { throw Error("REAL_NETWORK_FORBIDDEN"); };
const RealDate = Date;
let instant = "2026-09-08T04:59:00Z";
class Clock extends RealDate {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return new RealDate(instant).getTime(); }
}
let checks = 0;
const equal = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

function browser() {
  const window = { BlessERP: { offlineSync: { createOperationId: () => "synthetic-id-only" }, services: {} } };
  const ctx = vm.createContext({ window, Date: Clock, Intl, console, setTimeout, clearTimeout });
  for (const name of ["scripts/services/sri/fiscal-date.js", "scripts/services/purchase-withholding-v2.js", "scripts/modules/comercial/sri-authorization.js"]) {
    vm.runInContext(fs.readFileSync(name, "utf8"), ctx, { filename: name });
  }
  window.BlessERP.purchaseWithholdingV2Repository = {
    pendingPage: async () => ({ ok: true, items: [], total: 0 }),
    purchasePayable: async () => ({ ok: true, payable: { accountCode: "SYNTHETIC-CXP" } }),
    detailContext: async () => ({ ok: true, purchase: {
      purchase_document_id: "synthetic-purchase", issue_date: "2026-09-01", accounting_date: "2026-09-01",
      external_document_number: "001001000000999", subtotal: 100, tax_total: 15, total: 115,
      supplier_ruc: "1790011674001", supplier_name: "SUPPLIER SYNTHETIC",
      source_payload: { taxSupportCode: "01", authorizationNumber: "1234567890" }
    }, lines: [{ line_number: 1, description: "Synthetic", tax_base: 100, tax_amount: 15 }] })
  };
  return window.BlessERP;
}

async function main() {
  const previous = Object.fromEntries(Object.values(SECRET_REFERENCES).map(key => [key, process.env[key]]));
  try {
    Object.keys(previous).forEach(key => { process.env[key] = "SYNTHETIC_ONLY"; });
    global.Date = Clock;
    const ui = browser();
    const api = ui.services.purchaseWithholdingV2;
    const companyId = COMPANIES[0].id;
    Object.assign(ui.services, {
      companyContext: { activeCompanyId: () => companyId, activeCompany: () => ({ id: companyId }) },
      purchaseAccountContract: { enabled: () => true, payableForDocument: () => "SYNTHETIC-CXP" },
      chartOfAccounts: { findByCode: () => ({ company_id: companyId, status: "Activa", isMovement: true }) },
      taxConfig: { resolveRetentionPayable: line => ({ ...line, payableAccountCode: "SYNTHETIC-IR" }) },
      adminConfig: { findSequenceByCode: () => ({ establishmentCode: "001", emissionPointCode: "002" }) }
    });
    ui.purchaseVatCore = { supportingTax: () => ({ code: "2", percentageCode: "4", taxableBase: 100, rate: 15, value: 15 }) };
    const rows = [];
    for (const [now, expected] of [
      ["2026-09-08T04:59:00Z", "2026-09-07"],
      ["2026-09-08T05:01:00Z", "2026-09-08"],
      ["2027-01-01T04:59:00Z", "2026-12-31"],
      ["2027-01-01T05:01:00Z", "2027-01-01"]
    ]) {
      instant = now;
      const draft = await api.prepareDraft("synthetic-purchase");
      equal(draft.retentionDate, expected, "Actual withholding draft uses Ecuador, even with a browser kept open across midnight");
      equal(ecuadorDate(), expected, "Backend and browser agree");
      equal(ui.comercialSriAuthorization.ecuadorToday(), expected, "Invoice/NC frontend use the same day");
      equal(api.purchaseById("synthetic-purchase").issueDate, "2026-09-01", "Underlying purchase date untouched");
      // Capture the real browser service's API payload, including its original
      // purchase date, without executing any write or transmission.
      let captured;
      ui.sriApi = {
        status: () => ({ ready: true }), activeCompany: () => ({ companyId }),
        environmentDefinition: name => ({ name }),
        configuration: async () => ({ settings: { company_id: companyId, environment: "PRODUCTION" },
          emissionPoints: [{ id: "synthetic-point", company_id: companyId, environment: "PRODUCTION", active: true, establishment_code: "001", emission_point_code: "002" }] }),
        post: async (action, payload) => { equal(action, "create-draft"); captured = payload; return { document: { id: "synthetic-doc", issue_date: payload.issueDate, status: "BORRADOR" } }; }
      };
      await api.createOrGet({ ...draft, retentionLines: [{ code: "312A", taxType: "RENTA", baseAmount: 100, percentage: 1 }] });
      equal(captured.issueDate, expected);
      equal(captured.sourceOrderDate, "2026-09-01");
      equal(captured.sourcePayload.withholding.supportingDocuments[0].issueDate, "2026-09-01");
      equal(captured.sourcePayload.withholding.fiscalPeriod, `${expected.slice(5, 7)}/${expected.slice(0, 4)}`);
      for (const environment of ["TEST", "PRODUCTION"]) {
        for (const company of COMPANIES) {
          for (const [type, market] of [["01", "LOCAL"], ["01", "EXPORT"], ["04", "LOCAL"], ["04", "EXPORT"], ["07", "LOCAL"]]) {
            if (type === "07" && company === COMPANIES[1]) continue; // Existing issuer restriction preserved.
            const f = fixture(company, environment, type, market), calls = effects();
            const input = { ...inputFor(f), issueDate: type === "07" ? draft.retentionDate : ui.comercialSriAuthorization.ecuadorToday(), sourceOrderDate: "2026-09-01" };
            input.sourcePayload.withholding.fiscalPeriod = `${expected.slice(5, 7)}/${expected.slice(0, 4)}`;
            input.sourcePayload.withholding.supportingDocuments[0].issueDate = "2026-09-01";
            input.sourcePayload.withholding.supportingDocuments[0].accountingDate = "2026-09-01";
            await service(calls).createDraft(mockClient(f, calls), input, "synthetic-actor");
            const keyDate = expected.slice(8, 10) + expected.slice(5, 7) + expected.slice(0, 4);
            equal(f.document.issue_date, expected);
            equal(f.document.access_key.slice(0, 8), keyDate, "Canonical RPC key uses the fiscal date supplied");
            equal(f.document.access_key[23], environment === "TEST" ? "1" : "2");
            const xml = buildDocumentXml(type, await payloadFor(f));
            const display = `${expected.slice(8, 10)}/${expected.slice(5, 7)}/${expected.slice(0, 4)}`;
            assert.ok(xml.includes(`<fechaEmision>${display}</fechaEmision>`)); checks++;
            assertDocumentXmlIdentity(f.document, xml); checks++;
            if (type === "07") {
              assert.ok(xml.includes("<fechaEmisionDocSustento>01/09/2026</fechaEmisionDocSustento>")); checks++;
              assert.ok(xml.includes(`<periodoFiscal>${expected.slice(5, 7)}/${expected.slice(0, 4)}</periodoFiscal>`)); checks++;
            }
            assert.throws(() => assertDocumentXmlIdentity({ ...f.document, issue_date: "2026-08-31" }, xml)); checks++;
            f.document.status = "AUTORIZADO";
            const frozen = JSON.stringify(f.document), noWrites = effects();
            await service(noWrites).generateXml(mockClient(f, noWrites), company.id, f.document.id, "synthetic-actor");
            equal(JSON.stringify(f.document), frozen, "Authorized documents are preserved, including historical dates");
            equal(noWrites.writes, 0); equal(noWrites.artifacts.length, 0);
            rows.push({ now, expected, environment, company: company.id, type, market, result: "PASS" });
          }
        }
      }
    }
    instant = "2026-09-08T04:59:00Z";
    // Prove the original expression's UTC rollover, without accepting it as a date source.
    equal(new Clock().toISOString().slice(0, 10), "2026-09-08");
    equal(ecuadorDate(), "2026-09-07");
    assert.throws(() => emissionDatePolicy({ issueDate: "2026-09-08", isExport: false }), /ventas locales/); checks++;
    assert.throws(() => emissionDatePolicy({ issueDate: "2026-09-08", isExport: true }), /futura/); checks++;
    assert.throws(() => ecuadorDate("invalid")); checks++;
    equal(emissionDatePolicy({ issueDate: "2026-09-01", isExport: true }).issueDate, "2026-09-01", "Explicit historical export date is not rewritten");
    const html = fs.readFileSync("index.html", "utf8");
    assert.ok(html.indexOf('src="scripts/services/sri/fiscal-date.js') < html.indexOf('src="scripts/services/sri/sri-api-client.js')); checks++;
    console.log(JSON.stringify({ result: "PASS", checks, cases: rows, realDocuments: 0, realSequencesConsumed: 0, realTransmissions: 0 }));
  } finally {
    global.Date = RealDate;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
