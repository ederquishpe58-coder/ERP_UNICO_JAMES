const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
let active = "IMPERIO", canonicalName = "IMPERIO", queries = [], status = "BORRADOR";
let denied = false;
const input = {companyId: "IMPERIO", companyName: "IMPERIO", orderNumber: "SYNTHETIC-ORDER"};
function fixtures(table) {
  if (table === "companies") return {id: "IMPERIO", name: canonicalName};
  if (table === "commercial_invoice_reservations") return [{id: "fixture-reservation", status: "CONSUMED", consumed_document_id: "fixture-document"}];
  if (table === "electronic_documents") return [{id: "fixture-document", status,
    source_snapshot: {invoice: {destinationCountryCode: null}}}];
}
const ERP = {
  authAccess: {activeAccess: () => ({activeCompany: {id: active}, session: {user: {id: "fixture-james"}}})},
  getCommercialOrderRepository: () => ({listPage: async () => ({
    ok: true, mode: "SUPABASE_ENTITY_RECORDS", companyId: active,
    totalPages: 1, items: [{id: "canonical-order", number: input.orderNumber}]
  })}),
  getSupabaseClient: () => ({
    auth: {getUser: async () => ({data: {user: {id: "fixture-james"}}})},
    rpc: async (name, args) => {
      assert.equal(name, "erp_commercial_order_countries"); assert.equal(args.p_company_id, "IMPERIO");
      queries.push(name);
      return {data: {company_id: "IMPERIO", read_only: true, source: "commercial_countries",
        records: [{id: "canonical-country", name: "FIXTURE COUNTRY"}]}};
    },
    from(table) {
      assert.ok(["companies", "erp_entity_records", "commercial_invoice_reservations", "electronic_documents"].includes(table));
      const filters = {};
      return {
        select() {return this;}, eq(key, value) {filters[key] = value; return this;},
        is() {return this;}, in() {return this;}, single() {return this;},
        then(resolve) {
          assert.equal(filters[table === "companies" ? "id" : "company_id"], "IMPERIO");
          queries.push({table, filters});
          if (denied && table === "electronic_documents") return Promise.resolve({error: {code: "42501"}}).then(resolve);
          let data = fixtures(table);
          if (table === "erp_entity_records") data = filters.entity === "commercial_orders"
            ? [{company_id: "IMPERIO", record_id: "canonical-order", payload: {id: "canonical-order",
              number: input.orderNumber, transportType: "MARITIMO", destinationId: "canonical-country",
              destinationCountry: "FIXTURE COUNTRY", sriRemoteDocumentId: "fixture-document"}}]
            : [{record_id: "canonical-country", payload: {sri_code: "110"}}];
          return Promise.resolve({data: structuredClone(data)}).then(resolve);
        }
      };
    }
  })
};
const sandbox = {BlessERP: ERP}; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("tools/read-sri-country-case.js", "utf8"), sandbox);
(async () => {
  assert.equal(queries.length, 0, "loading the reader must not execute reads");
  for (status of ["BORRADOR", "XML_GENERADO", "FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "AUTORIZADO", "TRANSMISSION_UNKNOWN"]) {
    const before = JSON.stringify(fixtures("electronic_documents"));
    const result = await sandbox.readSriCountryCase(input);
    assert.equal(result.orderId, "canonical-order");
    assert.equal(result.canonicalSriCountryCode.codes[0], "110");
    assert.equal(result.fiscal.documents[0].status, status);
    assert.equal(result.fiscal.documents[0].snapshotCountryCode, null);
    assert.equal(JSON.stringify(fixtures("electronic_documents")), before);
    assert.deepEqual(Object.keys(result).sort(), ["canonicalSriCountryCode", "company", "fiscal", "orderId", "savedDestination", "transport"]);
  }
  denied = true;
  assert.equal((await sandbox.readSriCountryCase(input)).fiscal.read, "NOT_VERIFIED");
  active = "BLESS";
  await assert.rejects(sandbox.readSriCountryCase(input), /empresa solicitada/);
  active = "IMPERIO"; canonicalName = "BLESS";
  await assert.rejects(sandbox.readSriCountryCase(input), /no coincide/);
  console.log("PASS reader: 7 fiscal states immutable, company mismatch rejected, denied read explicit, no mutation APIs.");
})().catch(error => {console.error(error); process.exitCode = 1;});
