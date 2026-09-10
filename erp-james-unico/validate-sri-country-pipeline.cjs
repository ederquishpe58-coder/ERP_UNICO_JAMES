const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const {buildInvoiceXml} = require("./api/sri/_lib/xml-builders.cjs");
const {buildAccessKey} = require("./api/sri/_lib/access-key.cjs");
const {XMLParser} = require("fast-xml-parser");
const root = process.argv[2] || ".";
const read = name => fs.readFileSync(path.join(root, name), "utf8");
let company = "IMPERIO", actor = "synthetic-actor", rows = [], deny = false, changeDuringRead = false;
let calls = [];
const ERP = {
  utils: {clone: structuredClone, uid: prefix => prefix + "-fixture"},
  getEnvConfig: () => ({supabaseEnabled: true}),
  authAccess: {activeAccess: () => ({activeCompany: {id: company}, session: {user: {id: actor}}})},
  comercialUtils: {
    findCustomer: () => ({identification: "SYNTHETIC", legalName: "Fixture", address: "Synthetic address"}),
    findBrand: () => ({country: "BUYER-OTHER-COUNTRY", name: "Fixture"}),
    findAgency: () => ({}),
    getOrderMetrics: () => ({totalStems: 10, totalUsd: 10,
      lines: [{unitPrice: 1, totalStems: 10, variety: "Fixture"}]})
  },
  comercialState: {getOrders: () => []},
  getSupabaseClient: () => ({
    async rpc(name, args) {
      assert.equal(name, "erp_commercial_order_countries");
      assert.equal(args.p_company_id, company);
      calls.push(name);
      return {data: {company_id: company, source: "commercial_countries", read_only: true,
        records: rows.map(row => ({id: row.record_id, name: row.payload.name, legacy_name: row.payload.name,
          code: "XX", active: true}))}};
    },
    from(table) {
      assert.equal(table, "erp_entity_records");
      const filters = {};
      return {
        select() { return this; }, eq(key, value) { filters[key] = value; return this; },
        is() { return this; }, order() { return this; },
        async range(start, end) {
          assert.equal(filters.company_id, company); assert.equal(filters.entity, "commercial_countries");
          calls.push("SELECT");
          if (changeDuringRead) company = "BLESS";
          return deny ? {error: {code: "42501"}} : {data: structuredClone(rows.slice(start, end + 1))};
        }
      };
    }
  })
};
const sandbox = {BlessERP: ERP, console, structuredClone, setTimeout, clearTimeout, Intl, Date};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ["scripts/modules/comercial/comercial-data.js",
  "scripts/modules/comercial/sri-order-queue-core.js", "scripts/repositories/comercial/order-country-catalog.js"]) {
  vm.runInContext(read(file), sandbox, {filename: file});
}
// Expose the real context builder only inside this isolated test VM.
vm.runInContext(read("scripts/modules/comercial/sri-authorization.js")
  .replace("    render,\n", "    localContext,\n    render,\n")
  .replace("    render,\r\n", "    localContext,\r\n    render,\r\n"), sandbox);
const core = ERP.comercialSriOrderQueueCore, catalog = ERP.orderCountryCatalog;
const order = () => ({id: "fixture-order", number: "fixture-number", company_id: company,
  saleType: "EXPORT", destinationId: "fixture-country", destinationCountry: "FIXTURE COUNTRY",
  destinationCountryModifiedManual: true, issuedAt: "2026-09-09", sriDaeNumber: "fixture-dae",
  awb: "fixture-awb", hawb: "fixture-hawb", transportType: "AEREO"});
const context = item => ({...ERP.comercialSriAuthorization.localContext({}, item), today: "2026-09-09"});
const seed = (code = "110") => { rows = [{company_id: company, record_id: "fixture-country",
  payload: {name: "FIXTURE COUNTRY", sri_country_code: code}}]; };
let checks = 0;
function reason(item, expected) {
  const ctx = context(item), result = core.resolveDestinationCountry(item, ctx.countries, ctx.countryCompanyId);
  assert.equal(result.reason, expected);
  const payload = core.buildInvoicePayload(ctx);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.includes(result.message));
  checks++;
}
(async () => {
  seed(); reason(order(), "CATALOG_NOT_LOADED");
  for (const owner of ["IMPERIO", "BLESS"]) {
    company = owner; seed();
    await catalog.loadFiscal({});
    for (const transport of ["AEREO", "MARITIMO"]) {
      const item = {...order(), transportType: transport};
      const before = JSON.stringify(item), result = core.buildInvoicePayload(context(item));
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.equal(result.payload.invoice.destinationCountryCode, "110");
      assert.equal(result.payload.erpEmission.transportType, transport);
      const document = {documentType: "01", environment: "TEST", environmentCode: "1",
        issueDate: "2026-09-09", establishmentCode: "001", emissionPointCode: "001",
        sequential: "000000001", issuer: {ruc: "9999999999999", legalName: "SYNTHETIC",
          headOfficeAddress: "Synthetic address"}};
      document.accessKey = buildAccessKey({...document, ruc: document.issuer.ruc, numericCode: "12345678"}).accessKey;
      const xml = buildInvoiceXml({...result.payload, document});
      const parsed = new XMLParser({parseTagValue: false}).parse(xml);
      assert.equal(parsed.factura.infoFactura.paisDestino, "110");
      assert.equal(JSON.stringify(item), before);
      checks++;
    }
    reason({...order(), company_id: owner === "BLESS" ? "IMPERIO" : "BLESS"}, "COUNTRY_COMPANY_CONFLICT");
    reason({...order(), destinationCountryCode: "149"}, "SRI_CODE_CONFLICT");
    reason({...order(), destinationId: "", destinationCountry: ""}, "COUNTRY_ABSENT");
    reason({...order(), destinationId: "missing"}, "COUNTRY_NOT_FOUND");
    reason({...order(), destinationCountry: "WRONG"}, "COUNTRY_CONFLICT");
    seed(""); await catalog.loadFiscal({}); reason(order(), "SRI_MAPPING_ABSENT");
    seed("ISO840"); await catalog.loadFiscal({}); reason(order(), "SRI_MAPPING_INVALID");
    seed(); rows[0].payload.sriCountryCode = "149";
    await catalog.loadFiscal({}); reason(order(), "SRI_MAPPING_INVALID");
    seed(); rows.push({...structuredClone(rows[0]), record_id: "duplicate"});
    await catalog.loadFiscal({}); reason({...order(), destinationId: ""}, "COUNTRY_AMBIGUOUS");
  }
  deny = true; seed(); await assert.rejects(catalog.loadFiscal({}), /leer el codigo/);
  reason(order(), "CATALOG_NOT_LOADED"); deny = false;
  changeDuringRead = true; company = "IMPERIO"; seed();
  await assert.rejects(catalog.loadFiscal({}), /empresa o sesion/);
  changeDuringRead = false; checks++;
  const local = {...order(), saleType: "LOCAL", destinationId: "", destinationCountry: "", sriDaeNumber: "", awb: "", hawb: ""};
  const result = core.buildInvoicePayload(context(local));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.payload.invoice.commerceType, "LOCAL");
  assert.equal(result.payload.invoice.destinationCountryCode, undefined); checks++;
  assert.ok(calls.every(call => ["erp_commercial_order_countries", "SELECT"].includes(call)));
  console.log("PASS full country pipeline:", checks, "checks; synthetic catalog codes, no external writes.");
})().catch(error => {console.error(error); process.exitCode = 1;});
