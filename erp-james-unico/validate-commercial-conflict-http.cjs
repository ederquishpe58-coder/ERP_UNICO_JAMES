const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.fetch = async () => { throw Error("REAL_NETWORK_FORBIDDEN"); };
const read = file => fs.readFileSync(path.join(__dirname, file), "utf8");
const repositorySource = read("scripts/repositories/comercial/commercial-master-data-repository.js");
const stateSource = read("scripts/modules/comercial/comercial-state.js");
const uiSource = stateSource.slice(stateSource.indexOf("  async function persistCatalogRecord("), stateSource.indexOf("  async function removeCatalogRecord("));
const companyId = "10000000-0000-4000-8000-000000000001";
const companyKey = "COMP-BLESS-FLOWER";
const operationId = "20000000-0000-4000-8000-000000000001";
const conflictMessage = "La ficha cambió en el servidor. Actualice el catálogo y revise sus cambios antes de guardar.";
const results = [];

function fixture(databaseError) {
  const current = {
    company_id: companyId, entity: "commercial_brands", record_id: "fixture-brand", version: 3, deleted_at: null,
    payload: { id: "fixture-brand", code: "FIXTURE", name: "Before", companyId: companyKey, company_id: companyKey }
  };
  const local = { ...structuredClone(current.payload), name: "User draft", __syncVersion: 3 };
  const calls = { reads: 0, rpcs: [], generatedIds: 0, cacheWrites: 0, localSaves: 0, notices: [] };
  let repositoryResult = null;
  const client = {
    from(table) {
      assert.equal(table, "erp_entity_records");
      const filters = {};
      const query = {
        select() { return query; },
        eq(field, value) { filters[field] = value; return query; },
        async maybeSingle() {
          calls.reads++;
          assert.deepEqual(filters, { company_id: companyId, entity: "commercial_brands", record_id: "fixture-brand" });
          return { data: structuredClone(current), error: null };
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.rpcs.push({ name, args: structuredClone(args) });
      assert.equal(name, "erp_apply_offline_operation");
      return { data: null, error: databaseError };
    }
  };
  const app = {
    getEnvConfig: () => ({ supabaseEnabled: true, authEnabled: true, incrementalSyncEnabled: true, commercialCatalogsSupabaseEnabled: true }),
    getSupabaseClient: () => client,
    authAccess: { activeAccess: () => ({ activeCompany: { id: companyId }, activeCompanyKey: companyKey }) },
    state: { state: { db: { commercial: { brandCatalog: [local] } } }, saveDbLocalOnly() { calls.localSaves++; } },
    syncEntityRegistry: {
      sanitizePayload: (_entity, row) => Object.fromEntries(Object.entries(row).filter(([field]) => !field.startsWith("__sync")))
    },
    offlineSync: {
      createOperationId() { calls.generatedIds++; return operationId; },
      getDeviceId: async () => "SYNTHETIC_DEVICE",
      buildFieldChanges: () => [{ path: ["name"], base: "Before", value: "User draft" }],
      async applyRemoteRecord() { calls.cacheWrites++; return { ok: true }; }
    }
  };
  vm.runInNewContext(repositorySource, { window: { BlessERP: app, location: { protocol: "https:" } }, structuredClone, console });
  const repository = app.getFinalBrandRepository();
  const observedRepository = {
    configured: repository.configured,
    async save(draft) { repositoryResult = await repository.save(draft); return repositoryResult; }
  };
  const ui = { save: null, setNotice: (_state, message, tone) => calls.notices.push({ message, tone }) };
  vm.runInNewContext(uiSource + ";save=persistCatalogRecord;", ui);
  return { current, local, calls, repositoryResult: () => repositoryResult,
    save: () => ui.save(app.state.state, observedRepository, local, "la ficha") };
}

async function verifyError(code, message, details) {
  const databaseError = { code, message, details, hint: null };
  const sample = fixture(databaseError);
  const before = JSON.stringify({ current: sample.current, local: sample.local });
  const uiResult = await sample.save();
  const result = sample.repositoryResult();
  assert.equal(uiResult.ok, false);
  assert.equal(uiResult.mode, code);
  assert.equal(uiResult.message, message);
  assert.equal(result.ok, false);
  assert.equal(result.confirmed, false);
  assert.equal(result.status, "ERROR");
  assert.equal(result.error, databaseError);
  assert.equal(result.error.code, code);
  assert.equal(result.error.details, details);
  assert.equal(result.operationId, operationId);
  assert.equal(sample.calls.reads, 1);
  assert.equal(sample.calls.rpcs.length, 1, "One explicit save must never automatically replay the mutation.");
  assert.equal(sample.calls.generatedIds, 1);
  assert.equal(sample.calls.rpcs[0].args.p_operation_id, operationId);
  assert.equal(sample.calls.rpcs[0].args.p_company_id, companyId);
  assert.equal(sample.calls.rpcs[0].args.p_record_id, "fixture-brand");
  assert.equal(sample.calls.rpcs[0].args.p_action, "UPDATE");
  assert.equal(sample.calls.rpcs[0].args.p_base_version, 3);
  assert.equal(sample.calls.cacheWrites, 0);
  assert.equal(sample.calls.localSaves, 0);
  assert.equal(JSON.stringify({ current: sample.current, local: sample.local }), before);
  assert.deepEqual(sample.calls.notices, [{ message, tone: "warning" }]);
  results.push({ code, result: "PASS", canonicalDetail: details, mutationCalls: 1, automaticRetries: 0,
    confirmed: false, sameRecord: true, sameOperation: true, cacheWrites: 0, localSaves: 0 });
}

(async () => {
  await verifyError("PT409", conflictMessage, "COMMERCIAL_CATALOG_VERSION_CONFLICT");
  await verifyError("40001", conflictMessage, "COMMERCIAL_CATALOG_VERSION_CONFLICT");
  // Availability remains distinguishable from a business conflict. This suite
  // tests compatibility, without introducing automatic retries or remapping codes.
  await verifyError("PGRST002", "Could not query the database for the schema cache. Retrying.", null);
  assert.notEqual(results[0].code, results[2].code);
  console.log(JSON.stringify({ result: "PASS", checks: results.length, results,
    realNetwork: 0, realDatabaseChanges: 0, additionalDocuments: 0, additionalSequences: 0, additionalJournals: 0 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
