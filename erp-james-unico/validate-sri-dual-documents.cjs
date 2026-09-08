const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { buildAccessKey } = require("./api/sri/_lib/access-key.cjs");
const { buildDocumentXml } = require("./api/sri/_lib/xml-builders.cjs");
const { assertDocumentXmlIdentity } = require("./api/sri/_lib/xml-identity.cjs");
const { assertOfficialXsd } = require("./api/sri/_lib/xsd-validator.cjs");
const { ecuadorDate } = require("./api/sri/_lib/emission-date.cjs");
const certificateApi = require("./api/sri/_lib/certificate.cjs");
const { sha256 } = require("./api/sri/_lib/artifact-store.cjs");
const forge = require("node-forge");
const { signXadesBes, verifyXadesBes } = require("./api/sri/_lib/xades-signer.cjs");

// Synthetic fixtures and in-memory adapters only. There is no Supabase client,
// network request, real certificate, real signature or fiscal persistence here.
global.fetch = async () => { throw new Error("NETWORK_FORBIDDEN"); };
const COMPANIES = [
  { id: "cf331b82-7ac3-4065-9e38-d0bbcde96cd5", ruc: "1717637084001", name: "BLESS SYNTHETIC" },
  { id: "ab60abdc-fe53-4289-9ae2-8f749ee21cff", ruc: "1727970137001", name: "IMPERIO SYNTHETIC" }
];
const TODAY = ecuadorDate();
const YESTERDAY = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function equals(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function rejects(fn, message) { assert.throws(fn, undefined, message); checks++; }
async function rejection(fn, message) { await assert.rejects(fn, undefined, message); checks++; }

function fixture(company = COMPANIES[0], environment = "TEST", type = "01", market = "LOCAL", treatment = "CREDIT") {
  const pointCode = market === "LOCAL" && type !== "07" ? "003" : "002";
  const issuer = { legalName: company.name, commercialName: company.name, ruc: company.ruc,
    headOfficeAddress: "Direccion sintetica", accountingRequired: company === COMPANIES[0],
    withholdingAgentNumber: company === COMPANIES[0] ? "1" : null,
    habitualExporterLegend: company === COMPANIES[0] ? "EXPORTADOR HABITUAL DE BIENES" : "" };
  const source = {
    buyer: { identificationType: "04", identification: "1790011674001", legalName: "CLIENTE SINTETICO", address: "Direccion de prueba" },
    document: { establishmentAddress: "Direccion congelada" },
    lines: [{ mainCode: "SYNTHETIC", description: "Producto de prueba", unit: "UNIDAD", quantity: 1, unitPrice: 100, discount: 0, subtotal: 100,
      taxes: [{ code: "2", percentageCode: "4", taxableBase: 100, rate: 15, value: 15 }] }],
    taxes: [{ code: "2", percentageCode: "4", taxableBase: 100, rate: 15, value: 15 }],
    invoice: { commerceType: market === "LOCAL" ? "LOCAL" : "EXPORTADOR", totalWithoutTax: 100, grandTotal: 115,
      incoterm: "FOB", incotermPlace: "QUITO", originCountryCode: "593", portOfLoading: "QUITO", portOfDestination: "MIAMI", destinationCountryCode: "249", acquisitionCountryCode: "249" },
    creditNote: { totalWithoutTax: 100, modificationValue: 115, reason: "Devolucion sintetica" },
    additionalInformation: { "CORREO CLIENTE": "customer@example.test", AWB: "AWB-SYNTHETIC", HAWB: "HAWB-SYNTHETIC", AGENCIA: "AGENCIA SINTETICA", MARCACION: "MARCA SINTETICA", PIEZAS: "1", DAE: "DAE-SYNTHETIC" },
    erpEmission: { idempotencyKey: "synthetic-operation", environment },
    erpPurchase: { vatCreditTreatment: treatment },
    withholding: { relatedParty: false, fiscalPeriod: `${TODAY.slice(5, 7)}/${TODAY.slice(0, 4)}`, supportingDocuments: [{
      supportCode: treatment === "CREDIT" ? "01" : "02", documentCode: "01", documentNumber: "001001000000999", issueDate: TODAY,
      accountingDate: TODAY, authorizationNumber: "1234567890", paymentLocation: "01", totalWithoutTax: 100, grandTotal: 115,
      taxes: [{ code: "2", percentageCode: "4", taxableBase: 100, rate: 15, value: 15 }],
      retentions: [{ code: "1", retentionCode: "312", taxableBase: 100, rate: 2, value: 2 }, { code: "2", retentionCode: "1", taxableBase: 15, rate: 30, value: 4.5 }],
      payments: [{ method: "20", total: 115 }]
    }] }
  };
  const key = buildAccessKey({ issueDate: TODAY, documentType: type, ruc: company.ruc, environment,
    establishmentCode: "001", emissionPointCode: pointCode, sequential: 10, numericCode: "12345678" });
  const document = {
    id: "00000000-0000-4000-8000-000000000010", company_id: company.id,
    emission_point_id: `00000000-0000-4000-8000-000000000${pointCode}`,
    document_type: type, environment, status: "BORRADOR", establishment_code: "001", emission_point_code: pointCode,
    sequential: 10, sequential_text: key.sequential, full_number: `001-${pointCode}-${key.sequential}`,
    numeric_code: "12345678", issue_date: TODAY, access_key: key.accessKey, emission_type: "1", verification_digit: key.verificationDigit,
    xml_version: type === "07" ? "2.0.0" : "1.1.0", issuer_snapshot: issuer, buyer_snapshot: source.buyer, source_snapshot: source,
    grand_total: 115, credited_total: 0
  };
  const settings = { company_id: company.id, environment, test_enabled: true, production_enabled: environment === "PRODUCTION",
    ruc: company.ruc, legal_name: company.name, commercial_name: company.name, head_office_address: "Direccion de prueba",
    accounting_required: issuer.accountingRequired, withholding_agent_number: issuer.withholdingAgentNumber,
    invoice_xml_version: "1.1.0", credit_note_xml_version: "1.1.0", withholding_xml_version: "2.0.0" };
  const point = { id: document.emission_point_id, company_id: company.id, environment, establishment_code: "001", emission_point_code: pointCode, active: true, establishment_address: "Direccion ACTUAL distinta" };
  const fingerprint = "a".repeat(64);
  const certificate = { id: "00000000-0000-4000-8000-000000000888", company_id: company.id, active: true,
    fingerprint_sha256: fingerprint, storage_bucket: "sri-private", storage_object_path: `companies/${company.id}/certificates/${fingerprint}.p12`,
    password_secret_name: certificateApi.SECRET_REFERENCES[company.id], subject_ruc: company.ruc, validation_status: "VALID",
    valid_from: "2020-01-01T00:00:00Z", valid_until: "2099-01-01T00:00:00Z", last_validated_at: "2026-01-01T00:00:00Z" };
  const sequence = { company_id: company.id, emission_point_id: point.id, environment, document_type: type, next_value: 10 };
  const parent = type === "04" ? fixture(company, environment, "01", market).document : null;
  if (parent) { parent.id = "00000000-0000-4000-8000-000000000001"; parent.status = "AUTORIZADO"; document.parent_document_id = parent.id; }
  return { document, settings, point, certificate, sequence, parent, company: { id: company.id, tax_id: company.ruc, is_active: true } };
}

function effects() { return { writes: 0, create: 0, refresh: 0, sign: 0, parse: 0, p12Download: 0, artifacts: [], loads: 0 }; }

function mockClient(f, calls) {
  const lines = f.document.source_snapshot.lines.map((line, index) => ({ id: `line-${index}`, company_id: f.company.id, document_id: f.document.id,
    line_number: index + 1, main_code: line.mainCode, description: line.description, unit: line.unit, quantity: line.quantity, unit_price: line.unitPrice,
    discount: line.discount, subtotal: line.subtotal, additional_details: {} }));
  const taxes = f.document.source_snapshot.taxes.map(tax => ({ company_id: f.company.id, document_id: f.document.id, document_line_id: null,
    tax_code: tax.code, percentage_code: tax.percentageCode, rate: tax.rate, taxable_base: tax.taxableBase, tax_value: tax.value }));
  const tables = { sri_settings: [f.settings], companies: [f.company], emission_points: [f.point], digital_certificates: f.certificate ? [f.certificate] : [],
    electronic_document_sequences: f.sequence ? [f.sequence] : [], electronic_documents: [f.document, f.parent].filter(Boolean), electronic_document_lines: lines, electronic_document_taxes: taxes };
  const client = {
    from(table) {
      const filters = []; let operation = null; let values = null; let single = false;
      const query = {
        select() { return this; }, eq(key, value) { filters.push(row => row[key] === value); return this; },
        order() { return this; }, limit() { return this; }, range() { return this; },
        is(key, value) { filters.push(row => (row[key] ?? null) === value); return this; },
        insert(rows) { operation = "insert"; values = rows; return this; },
        update(patch) { operation = "update"; values = patch; return this; },
        single() { single = true; return this; }, maybeSingle() { single = true; return this; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            let rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
            if (operation) {
              calls.writes++;
              if (operation === "update") rows.forEach(row => Object.assign(row, values));
              else { rows = (Array.isArray(values) ? values : [values]).map((row, i) => ({ id: `insert-${i}`, ...row })); tables[table] = [...(tables[table] || []), ...rows]; }
            }
            return { data: single ? (rows[0] || null) : rows, error: null };
          }).then(resolve, reject);
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.writes++;
      if (name === "create_electronic_document_draft") {
        calls.create++;
        const d = f.document;
        Object.assign(d, { source_snapshot: structuredClone(args.p_source_snapshot), issuer_snapshot: args.p_issuer_snapshot,
          buyer_snapshot: args.p_buyer_snapshot, issue_date: args.p_issue_date, numeric_code: args.p_numeric_code });
        const key = buildAccessKey({ issueDate: d.issue_date, documentType: d.document_type, environment: d.environment, ruc: d.issuer_snapshot.ruc,
          establishmentCode: d.establishment_code, emissionPointCode: d.emission_point_code, sequential: d.sequential, numericCode: d.numeric_code });
        d.access_key = key.accessKey; d.verification_digit = key.verificationDigit;
        return { data: structuredClone(d) };
      }
      if (name === "refresh_electronic_document_issue_date") {
        calls.refresh++; const d = f.document; d.issue_date = args.p_issue_date;
        d.access_key = buildAccessKey({ issueDate: d.issue_date, documentType: d.document_type, environment: d.environment, ruc: d.issuer_snapshot.ruc,
          establishmentCode: d.establishment_code, emissionPointCode: d.emission_point_code, sequential: d.sequential, numericCode: d.numeric_code }).accessKey;
        return { data: structuredClone(d) };
      }
      if (name === "set_electronic_document_status") { f.document.status = args.p_new_status; return { data: structuredClone(f.document) }; }
      if (name === "validate_credit_note_amount") return { data: true };
      throw new Error(`UNEXPECTED_RPC:${name}`);
    },
    storage: { from() { return { async download() { calls.p12Download++; return f.p12Unavailable ? { error: new Error("SYNTHETIC_MISSING_P12") } : { data: new Blob(["SYNTHETIC_P12_STUB"]) }; } }; } }
  };
  return client;
}

function service(calls, artifact) {
  const filename = path.join(__dirname, "api/sri/_lib/document-service.cjs");
  const localRequire = createRequire(filename);
  const stubs = {
    "./artifact-store.cjs": { sha256,
      async storeArtifact(client, value) { calls.artifacts.push(value); return {}; },
      async loadArtifact() { calls.loads++; return artifact; } },
    "./certificate.cjs": { ...certificateApi,
      parsePkcs12(bytes, secret, options) { calls.parse++; calls.parsedBytes = bytes; if (calls.parseError) throw new Error("SYNTHETIC_PKCS12_INVALID"); return { metadata: { fingerprintSha256: calls.wrongFingerprint ? "b".repeat(64) : "a".repeat(64), holderRuc: options.expectedRuc, serialNumber: "SYNTHETIC", notBefore: "2020-01-01", notAfter: "2099-01-01" } }; },
      releaseCertificateMaterial() { calls.released = true; } },
    "./xades-signer.cjs": { async signXadesBes({ xml }) { calls.sign++; return xml; } }
  };
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(filename, "utf8")}\n})`, { filename })(
    name => Object.hasOwn(stubs, name) ? stubs[name] : localRequire(name), module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

async function payloadFor(f) {
  const calls = effects();
  return service(calls).documentPayload(mockClient(f, calls), f.document);
}

function inputFor(f) { return { companyId: f.company.id, emissionPointId: f.point.id, parentDocumentId: f.document.parent_document_id,
  documentType: f.document.document_type, issueDate: TODAY, idempotencyKey: "synthetic-stable-key", sourcePayload: structuredClone(f.document.source_snapshot) }; }

function unsignedArtifact(f, xml) {
  const buffer = Buffer.from(xml); const hash = sha256(buffer);
  return { buffer, file: { company_id: f.company.id, document_id: f.document.id, file_type: "UNSIGNED_XML",
    storage_bucket: "sri-private", storage_object_path: `companies/${f.company.id}/documents/${f.document.id}/unsigned_xml-${hash}.xml`, content_sha256: hash } };
}

function syntheticCertificate() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  cert.setSubject([{ name: "commonName", value: "SYNTHETIC LOCAL TEST ONLY" }]);
  // Emulate the supported identity encoding for an isolated validator fixture;
  // this self-signed test certificate is never trusted, uploaded or transmitted.
  cert.setIssuer([{ name: "organizationName", value: "SECURITY DATA S.A. 2" }, { name: "countryName", value: "EC" }]);
  cert.setExtensions([{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
    { id: "1.3.6.1.4.1.37746.3.11", value: forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.UTF8, false, COMPANIES[0].ruc)).getBytes() }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const secret = "SYNTHETIC_LOCAL_PKCS12_ONLY";
  const bytes = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], secret, { algorithm: "3des" })).getBytes(), "binary");
  try {
    rejects(() => certificateApi.parsePkcs12(bytes, secret, { companyId: COMPANIES[1].id, expectedRuc: COMPANIES[1].ruc }), "synthetic certificate from another company rejected cryptographically");
    return certificateApi.parsePkcs12(bytes, secret, { companyId: COMPANIES[0].id, expectedRuc: COMPANIES[0].ruc });
  } finally { bytes.fill(0); }
}

async function main() {
  const savedSecrets = Object.fromEntries(COMPANIES.map(company => [certificateApi.SECRET_REFERENCES[company.id], process.env[certificateApi.SECRET_REFERENCES[company.id]]]));
  try {
    for (const name of Object.keys(savedSecrets)) process.env[name] = "SYNTHETIC_TEST_SECRET_NOT_REAL";
    // Sales date policy must never replace the dates of a withholding or NC.
    for (const environment of ["TEST", "PRODUCTION"]) {
      for (const company of COMPANIES) {
        const local = fixture(company, environment, "01", "LOCAL"); const localCalls = effects();
        await assert.rejects(() => service(localCalls).createDraft(mockClient(local, localCalls), { ...inputFor(local), issueDate: YESTERDAY }, "synthetic-actor"), /Las ventas locales/); checks++;
        equals(localCalls.create, 0, "wrong local date blocked before reservation");
        await service(localCalls).createDraft(mockClient(local, localCalls), inputFor(local), "synthetic-actor");
        equals(local.document.issue_date, TODAY, "LOCAL current Ecuador date remains allowed");
        const exp = fixture(company, environment, "01", "EXPORT"); const exportCalls = effects();
        await service(exportCalls).createDraft(mockClient(exp, exportCalls), { ...inputFor(exp), issueDate: YESTERDAY }, "synthetic-actor");
        equals(exp.document.issue_date, YESTERDAY, "EXPORT keeps its own date");
        for (const date of [new Date(Date.parse(`${TODAY}T12:00:00Z`) + 86400000).toISOString().slice(0,10), "2020-01-01"]) {
          const f = fixture(company, environment, "01", "EXPORT"); const calls = effects();
          await rejection(() => service(calls).createDraft(mockClient(f, calls), { ...inputFor(f), issueDate: date }, "synthetic-actor"));
          equals(calls.create, 0, "EXPORT future/60-day guard preserved");
        }
        for (const type of company === COMPANIES[0] ? ["04", "07"] : ["04"]) {
          const f = fixture(company, environment, type); const calls = effects();
          const input = { ...inputFor(f), issueDate: YESTERDAY, sourceOrderDate: "2026-08-01" };
          if (type === "07") {
            input.sourcePayload.withholding.fiscalPeriod = `${YESTERDAY.slice(5,7)}/${YESTERDAY.slice(0,4)}`;
            input.sourcePayload.withholding.supportingDocuments[0].issueDate = "2026-08-01";
          }
          await service(calls).createDraft(mockClient(f, calls), input, "synthetic-actor");
          equals(f.document.issue_date, YESTERDAY, `${type} uses its own issue date`);
          equals(f.document.source_snapshot.erpEmission.issueDateAdjusted, false);
          if (type === "07") equals(f.document.source_snapshot.withholding, input.sourcePayload.withholding, "support date and fiscal period unchanged");
          const preserved = [f.document.id, f.document.issue_date, f.document.access_key, f.document.sequential, f.document.environment];
          for (const status of ["BORRADOR", "VALIDADO"]) {
            f.document.status = status; const xmlCalls = effects();
            await service(xmlCalls).generateXml(mockClient(f, xmlCalls), company.id, f.document.id, "synthetic-actor");
            equals(xmlCalls.refresh, 0, `${type} never receives LOCAL date refresh`);
            equals([f.document.id, f.document.issue_date, f.document.access_key, f.document.sequential, f.document.environment], preserved, `${type} same date/key/identity at XML boundary`);
          }
        }
      }
      const withholding = fixture(COMPANIES[0], environment, "07");
      const payload = await payloadFor(withholding);
      for (const mutate of [p => { p.document.issueDate = "not-a-date"; }, p => { p.withholding.supportingDocuments[0].issueDate = "not-a-date"; }]) {
        const invalid = structuredClone(payload); mutate(invalid);
        rejects(() => buildDocumentXml("07", invalid), "existing retention issue/support/fiscal-period validators preserved");
      }
      const explicitPeriod = structuredClone(payload); explicitPeriod.withholding.fiscalPeriod = "08/2026";
      check(buildDocumentXml("07", explicitPeriod).includes("<periodoFiscal>08/2026</periodoFiscal>"), "explicit canonical fiscal period preserved");
      const derivedPeriod = structuredClone(payload); delete derivedPeriod.withholding.fiscalPeriod;
      check(buildDocumentXml("07", derivedPeriod).includes(`<periodoFiscal>${TODAY.slice(5,7)}/${TODAY.slice(0,4)}</periodoFiscal>`), "existing fiscal-period derivation from issue date preserved");
    }
    let xsdCases = 0;
    for (const company of COMPANIES) for (const environment of ["TEST", "PRODUCTION"]) for (const type of ["01", "04"]) for (const market of ["LOCAL", "EXPORT"]) {
      const f = fixture(company, environment, type, market); const payload = await payloadFor(f);
      const xml = buildDocumentXml(type, payload);
      equals(assertDocumentXmlIdentity(f.document, xml).environment, environment);
      equals(payload.document.issuer, f.document.issuer_snapshot, "issuer snapshot preserved");
      equals(payload.document.establishmentAddress, "Direccion congelada", "address snapshot preserved");
      if (type === "01" && market === "EXPORT") for (const field of ["AWB", "HAWB", "AGENCIA", "MARCACION", "PIEZAS", "DAE"]) check(xml.includes(`nombre="${field}"`), field);
      if (type === "04") check(xml.includes(`<numDocModificado>${f.parent.full_number}</numDocModificado>`), "NC original preserved");
      await assertOfficialXsd({ documentType: type, version: f.document.xml_version, xml }); xsdCases++;
    }
    for (const environment of ["TEST", "PRODUCTION"]) for (const treatment of ["CREDIT", "NO_CREDIT"]) {
      const f = fixture(COMPANIES[0], environment, "07", "EXPORT", treatment);
      const payload = await payloadFor(f); const xml = buildDocumentXml("07", payload);
      equals(payload.withholding.supportingDocuments, f.document.source_snapshot.withholding.supportingDocuments, "DocSustento unchanged");
      equals(payload.erpPurchase.vatCreditTreatment, treatment);
      check(xml.includes("<valorImpuesto>15.00</valorImpuesto>") && xml.includes("<baseImponible>15.00</baseImponible>"), "NO_CREDIT never removes invoice VAT or withholding base");
      assertDocumentXmlIdentity(f.document, xml);
      await assertOfficialXsd({ documentType: "07", version: "2.0.0", xml }); xsdCases++;
    }

    const canonical = fixture(); const payload = await payloadFor(canonical); const xml = buildDocumentXml("01", payload);
    for (const corrupt of [
      xml.replace("<ambiente>1</ambiente>", "<ambiente>2</ambiente>"),
      xml.replace("<ambiente>1</ambiente>", "<ambiente>1</ambiente><ambiente>1</ambiente>"),
      xml.replace("<ruc>1717637084001</ruc>", "<ruc>1727970137001</ruc>"),
      xml.replace("<secuencial>000000010</secuencial>", "<secuencial>000000011</secuencial>"),
      xml.replace("<codDoc>01</codDoc>", "<codDoc>04</codDoc>"),
      xml.replace("<ptoEmi>003</ptoEmi>", "<ptoEmi>002</ptoEmi>"),
      xml.replace("<fechaEmision>", "<fechaEmision>99"),
      xml.replace("<factura ", "<!DOCTYPE factura [<!ENTITY x 'bad'>]><factura "),
      `${xml}<factura/>`, xml.replace("<ambiente>1</ambiente>", "<ambiente><x>1</x></ambiente>")
    ]) rejects(() => assertDocumentXmlIdentity(canonical.document, corrupt), "ambiguous/crossed XML rejected");
    rejects(() => assertDocumentXmlIdentity({ ...canonical.document, environment: "PRODUCTION" }, xml));
    rejects(() => assertDocumentXmlIdentity({ ...canonical.document, issuer_snapshot: { ruc: COMPANIES[1].ruc } }, xml));
    rejects(() => assertDocumentXmlIdentity({ ...canonical.document, access_key: `${canonical.document.access_key}\n` }, xml));
    rejects(() => assertDocumentXmlIdentity({ ...canonical.document, access_key: `${canonical.document.access_key.slice(0, 48)}${(Number(canonical.document.access_key[48]) + 1) % 10}` }, xml));
    const differentKey = buildAccessKey({ issueDate: TODAY, documentType: "01", environment: "TEST", ruc: canonical.company.tax_id,
      establishmentCode: "001", emissionPointCode: "003", sequential: 10, numericCode: "87654321" }).accessKey;
    rejects(() => assertDocumentXmlIdentity(canonical.document, xml.replace(canonical.document.access_key, differentKey)), "same environment but another access key rejected");
    for (const value of [undefined, "", "PROD", "test", "1", null]) rejects(() => buildAccessKey({ environment: value, documentType: "01" }));
    for (const value of [undefined, "", "3", 1]) rejects(() => buildDocumentXml("01", { ...payload, document: { ...payload.document, environmentCode: value } }));

    const mutations = [
      f => { f.settings.production_enabled = false; }, f => { f.certificate = null; },
      f => { f.certificate.company_id = COMPANIES[1].id; }, f => { f.certificate.subject_ruc = COMPANIES[1].ruc; },
      f => { f.certificate.storage_object_path = `companies/${COMPANIES[1].id}/certificates/${"a".repeat(64)}.p12`; },
      f => { f.certificate.valid_until = "2020-01-01"; }, f => { f.certificate.valid_from = "2099-01-01"; },
      f => { f.certificate.validation_status = "INVALID"; }, f => { f.certificate.password_secret_name = "SRI_P12_PASSWORD_IMPERIO"; },
      f => { f.sequence = null; }, f => { f.sequence.environment = "TEST"; }, f => { f.point.company_id = COMPANIES[1].id; },
      f => { f.point.environment = "TEST"; }, f => { f.company.tax_id = COMPANIES[1].ruc; },
      f => { f.document.source_snapshot.document.environmentCode = "1"; }
    ];
    for (const mutate of mutations) {
      const f = fixture(COMPANIES[0], "PRODUCTION"); mutate(f); const calls = effects();
      await rejection(() => service(calls).createDraft(mockClient(f, calls), inputFor(f), "synthetic-actor"));
      equals([calls.writes, calls.create, calls.sign, calls.parse, calls.p12Download], [0, 0, 0, 0, 0], "blocked before numbering or signing");
    }
    for (const environment of ["TEST", "PRODUCTION"]) {
      const f = fixture(COMPANIES[1], environment, "07"); const calls = effects();
      await rejection(() => service(calls).createDraft(mockClient(f, calls), inputFor(f), "synthetic-actor"));
      equals(calls.writes, 0, "IMPERIO 07 cannot reserve");
    }
    {
      const f = fixture(); const calls = effects(); delete process.env[f.certificate.password_secret_name];
      await rejection(() => service(calls).createDraft(mockClient(f, calls), inputFor(f), "synthetic-actor"));
      equals(calls.writes, 0, "missing secret cannot reserve"); process.env[f.certificate.password_secret_name] = "SYNTHETIC_TEST_SECRET_NOT_REAL";
    }
    for (const company of COMPANIES) for (const environment of ["TEST", "PRODUCTION"]) {
      const f = fixture(company, environment); const calls = effects();
      await service(calls).createDraft(mockClient(f, calls), inputFor(f), "synthetic-actor");
      equals(calls.create, 1); equals(f.document.source_snapshot.erpEmission.environment, environment);
      equals(calls.p12Download, 1, "private material verified before numbering");
      equals(calls.sign, 0, "preflight produces no signature");
      check(calls.parsedBytes.every(byte => byte === 0) && calls.released, "preflight releases private material");
    }
    for (const failure of ["p12Unavailable", "parseError", "wrongFingerprint"]) {
      const f = fixture(COMPANIES[0], "PRODUCTION"); const calls = effects();
      if (failure === "p12Unavailable") f.p12Unavailable = true; else calls[failure] = true;
      await rejection(() => service(calls).createDraft(mockClient(f, calls), inputFor(f), "synthetic-actor"), failure);
      equals([calls.writes, calls.create, calls.sign], [0, 0, 0], "invalid private material cannot consume a number");
      if (calls.parsedBytes) check(calls.parsedBytes.every(byte => byte === 0) && calls.released, "failed preflight wipes material");
    }
    {
      const f = fixture(COMPANIES[0], "TEST", "04"); f.settings.environment = "PRODUCTION"; f.settings.production_enabled = true;
      const calls = effects(); await service(calls).createDraft(mockClient(f, calls), inputFor(f), "synthetic-actor");
      equals(calls.create, 1, "historical TEST NC derives original environment"); equals(f.document.environment, "TEST");
    }
    for (const mutate of [f => { f.parent.company_id = COMPANIES[1].id; }, f => { f.parent.environment = "PRODUCTION"; },
      f => { f.parent.emission_point_id = "00000000-0000-4000-8000-000000000099"; }]) {
      const f = fixture(COMPANIES[0], "TEST", "04"); mutate(f); const calls = effects();
      await rejection(() => service(calls).createDraft(mockClient(f, calls), inputFor(f), "synthetic-actor")); equals(calls.writes, 0);
    }
    for (const environment of ["TEST", "PRODUCTION"]) {
      const f = fixture(COMPANIES[0], environment); const calls = effects();
      if (environment === "TEST") { f.settings.environment = "PRODUCTION"; f.settings.production_enabled = true; }
      f.document.issue_date = YESTERDAY;
      f.document.access_key = buildAccessKey({ issueDate: YESTERDAY, documentType: "01", environment, ruc: f.company.tax_id,
        establishmentCode: "001", emissionPointCode: "003", sequential: 10, numericCode: "12345678" }).accessKey;
      const oldKey = f.document.access_key;
      await service(calls).generateXml(mockClient(f, calls), f.company.id, f.document.id, "synthetic-actor");
      equals(calls.refresh, 1); check(oldKey !== f.document.access_key, "date refresh replaces key");
      const generated = calls.artifacts.find(row => row.fileType === "UNSIGNED_XML").content;
      check(generated.includes(f.document.access_key) && !generated.includes(oldKey), "XML uses refreshed persisted key");
      equals(assertDocumentXmlIdentity(f.document, generated).environment, environment);
    }
    for (const action of ["generateXml", "signDocument"]) {
      const f = fixture(COMPANIES[0], "PRODUCTION"); f.settings.production_enabled = false; f.document.status = action === "signDocument" ? "XML_GENERADO" : "BORRADOR";
      const calls = effects(); await rejection(() => service(calls)[action](mockClient(f, calls), f.company.id, f.document.id, "synthetic-actor"));
      equals([calls.writes, calls.loads, calls.parse, calls.sign], [0, 0, 0, 0], "PROD OFF prevents all work");
    }
    for (const crossed of [false, true]) {
      const f = fixture(); f.document.status = "XML_GENERADO"; f.settings.environment = "PRODUCTION"; f.settings.production_enabled = true;
      let unsigned = buildDocumentXml("01", await payloadFor(f));
      if (crossed) unsigned = unsigned.replace("<ambiente>1</ambiente>", "<ambiente>2</ambiente>");
      const calls = effects(); const api = service(calls, unsignedArtifact(f, unsigned)); const invoke = () => api.signDocument(mockClient(f, calls), f.company.id, f.document.id, "synthetic-actor");
      if (crossed) { await rejection(invoke); equals([calls.writes, calls.parse, calls.sign, calls.p12Download], [0, 0, 0, 0], "crossed XML rejected before certificate"); }
      else { await invoke(); equals(calls.sign, 1, "historical TEST reaches synthetic signer despite PROD selector"); }
    }
    for (const company of COMPANIES) for (const environment of ["TEST", "PRODUCTION"]) for (const type of company === COMPANIES[0] ? ["01", "04", "07"] : ["01", "04"]) {
      const f = fixture(company, environment, type); f.document.status = "XML_GENERADO";
      const unsigned = buildDocumentXml(type, await payloadFor(f)); const calls = effects();
      await service(calls, unsignedArtifact(f, unsigned)).signDocument(mockClient(f, calls), f.company.id, f.document.id, "synthetic-actor");
      equals(calls.sign, 1, "enabled environment uses synthetic signer");
      const emitted = calls.artifacts.find(row => row.fileType === "SIGNED_XML").content;
      equals(assertDocumentXmlIdentity(f.document, emitted).environment, environment);
    }
    for (const mutate of [a => { a.file.company_id = COMPANIES[1].id; }, a => { a.file.content_sha256 = "0".repeat(64); },
      a => { a.file.storage_object_path = "companies/other/documents/other/unsigned.xml"; }]) {
      const f = fixture(); f.document.status = "XML_GENERADO"; const artifact = unsignedArtifact(f, xml); mutate(artifact); const calls = effects();
      await rejection(() => service(calls, artifact).signDocument(mockClient(f, calls), f.company.id, f.document.id, "synthetic-actor"));
      equals([calls.writes, calls.parse, calls.sign, calls.p12Download], [0, 0, 0, 0], "artifact substitution rejected before certificate");
    }
    let syntheticXadesSignatures = 0;
    const material = syntheticCertificate();
    try {
      for (const environment of ["TEST", "PRODUCTION"]) for (const type of ["01", "04", "07"]) {
        const f = fixture(COMPANIES[0], environment, type); const payload = await payloadFor(f);
        const unsigned = buildDocumentXml(type, payload);
        const signed = await signXadesBes({ xml: unsigned, certificate: material });
        equals(await verifyXadesBes(signed), true, "real XAdES verification with synthetic key");
        equals(assertDocumentXmlIdentity(f.document, signed).environment, environment);
        await assertOfficialXsd({ documentType: type, version: f.document.xml_version, xml: signed }); xsdCases++;
        check(signed.includes("http://www.w3.org/2000/09/xmldsig#rsa-sha1"), "existing signature algorithm preserved");
        await rejection(() => verifyXadesBes(signed.replace(`<ambiente>${environment === "TEST" ? "1" : "2"}</ambiente>`, `<ambiente>${environment === "TEST" ? "2" : "1"}</ambiente>`)), "environment tampering breaks cryptographic signature");
        syntheticXadesSignatures++;
      }
    } finally { certificateApi.releaseCertificateMaterial(material); }
    console.log(JSON.stringify({ ok: true, checks, officialXsdCases: xsdCases, syntheticXadesSignatures,
      realDatabaseCalls: 0, realCompanyCertificates: 0, realCompanySignatures: 0, networkCalls: 0,
      note: "Synthetic adapters, ephemeral in-memory certificate and XML only" }));
  } finally {
    for (const [name, value] of Object.entries(savedSecrets)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

module.exports = { fixture, payloadFor, COMPANIES, effects, mockClient, service, inputFor };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
