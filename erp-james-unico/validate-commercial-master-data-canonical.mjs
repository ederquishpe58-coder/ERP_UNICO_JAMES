import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const repositorySource = read("scripts/repositories/comercial/commercial-master-data-repository.js");
const registrySource = read("scripts/services/sync/entity-registry.js");
const domainLoaderSource = read("scripts/services/sync/domain-loader.js");
const stateSource = read("scripts/modules/comercial/comercial-state.js");
const catalogUiSource = read("scripts/modules/comercial/catalogos-comerciales.js");
const incrementalSource = read("scripts/services/sync/incremental-sync.js");
const runtimeSource = read("scripts/config/runtime-env.js");
const indexSource = read("index.html");

const BLESS = Object.freeze({ id: "10000000-0000-4000-8000-000000000001", key: "COMP-BLESS-FLOWER" });
const IMPERIO = Object.freeze({ id: "10000000-0000-4000-8000-000000000002", key: "COMP-IMPERIO-FLOWERS" });
const entities = Object.freeze([
  "commercial_customers",
  "commercial_brands",
  "commercial_countries",
  "commercial_dae",
  "commercial_agencies",
  "commercial_airlines"
]);

function buildFieldChanges(base, value) {
  if (JSON.stringify(base) === JSON.stringify(value)) return [];
  return [{ path: [], base_exists: true, base, value_exists: true, value }];
}

function fakeSupabase(server, controls) {
  function queryBuilder() {
    const filters = {};
    let activeOnly = false;
    const builder = {
      select() { return builder; },
      eq(column, value) { filters[column] = value; return builder; },
      is(column, value) { if (column === "deleted_at" && value === null) activeOnly = true; return builder; },
      order() { return builder; },
      async maybeSingle() {
        const row = server.get(`${filters.company_id}:${filters.entity}:${filters.record_id}`);
        return { data: row ? structuredClone(row) : null, error: null };
      },
      then(resolve, reject) {
        const readRows = () => {
          const rows = [...server.values()].filter(row => (
            row.company_id === filters.company_id
            && row.entity === filters.entity
            && (!activeOnly || !row.deleted_at)
          )).map(row => structuredClone(row));
          return { data: rows, error: null };
        };
        return Promise.resolve(controls.listGate).then(readRows).then(resolve, reject);
      }
    };
    return builder;
  }

  return {
    from(table) {
      assert.equal(table, "erp_entity_records");
      return queryBuilder();
    },
    async rpc(name, parameters) {
      assert.equal(name, "erp_apply_offline_operation");
      controls.rpcCalls += 1;
      if (controls.failNextRpc) {
        controls.failNextRpc = false;
        return { data: null, error: { code: "TEST_RPC_FAILURE", message: "forced failure" } };
      }
      assert.ok(entities.includes(parameters.p_entity));
      assert.ok([BLESS.id, IMPERIO.id].includes(parameters.p_company_id));
      const key = `${parameters.p_company_id}:${parameters.p_entity}:${parameters.p_record_id}`;
      const previous = server.get(key);
      const version = Number(previous?.version || 0) + 1;
      const deleted = parameters.p_action === "DELETE";
      const row = {
        id: `ROW-${parameters.p_record_id}`,
        company_id: parameters.p_company_id,
        entity: parameters.p_entity,
        record_id: parameters.p_record_id,
        payload: structuredClone(parameters.p_payload || {}),
        version,
        created_at: previous?.created_at || "2026-09-04T10:00:00.000Z",
        updated_at: "2026-09-04T10:01:00.000Z",
        created_by: "actor-test",
        updated_by: "actor-test",
        device_id: parameters.p_device_id,
        last_operation_id: parameters.p_operation_id,
        deleted_at: deleted ? "2026-09-04T10:01:00.000Z" : null
      };
      server.set(key, row);
      return { data: [{ status: "SYNCED", conflict: false, server_record: structuredClone(row), discarded_fields: [] }], error: null };
    }
  };
}

function createSession(server, company, controls) {
  let activeCompany = company;
  const cache = new Map(entities.map(entity => [entity, []]));
  const client = fakeSupabase(server, controls);
  const BlessERP = {
    getEnvConfig: () => ({
      supabaseEnabled: true,
      authEnabled: true,
      incrementalSyncEnabled: true,
      commercialCatalogsSupabaseEnabled: controls.enabled
    }),
    getSupabaseClient: () => client,
    authAccess: { activeAccess: () => ({ activeCompany: { id: activeCompany.id, company_key: activeCompany.key }, activeCompanyKey: activeCompany.key }) },
    state: {
      state: { db: { activeCompanyId: activeCompany.key, authAccess: { activeCompanyUuid: activeCompany.id, activeCompanyKey: activeCompany.key } } },
      saveDbLocalOnly() { return true; }
    },
    syncEntityRegistry: {
      entitiesForDomain(domain) { return domain === "commercial-catalog" ? [...entities] : []; },
      setRecords(_db, entity, rows) { cache.set(entity, structuredClone(rows)); return true; },
      sanitizePayload(entity, value) {
        assert.ok(entities.includes(entity));
        return Object.fromEntries(Object.entries(structuredClone(value || {})).filter(([key]) => !key.startsWith("__sync")));
      }
    },
    offlineSync: {
      createOperationId: (() => { let id = 0; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`; })(),
      getDeviceId: async () => `DEVICE-${activeCompany.key}`,
      buildFieldChanges,
      async pullDomain() {
        controls.pullCalls = Number(controls.pullCalls || 0) + 1;
        return { ok: false, mode: "UNAVAILABLE", fetchedRows: 0 };
      },
      async applyRemoteRecord(row) {
        const rows = cache.get(row.entity) || [];
        const index = rows.findIndex(item => item.id === row.record_id);
        if (row.deleted_at) {
          if (index >= 0) rows.splice(index, 1);
        } else {
          const next = { ...structuredClone(row.payload), id: row.record_id, __syncVersion: row.version };
          if (index >= 0) rows[index] = next;
          else rows.push(next);
        }
        cache.set(row.entity, rows);
        return { ok: true, changed: true };
      }
    }
  };
  const windowObject = {
    BlessERP,
    location: { protocol: "https:" },
    addEventListener() {},
    dispatchEvent() { return true; },
    clearTimeout
  };
  const context = vm.createContext({
    window: windowObject,
    globalThis: null,
    structuredClone,
    console,
    Date,
    JSON,
    Map,
    Object,
    String,
    Number,
    Boolean,
    Array,
    Math,
    Set,
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  });
  context.globalThis = context;
  vm.runInContext(repositorySource, context, { filename: "commercial-master-data-repository.js" });
  vm.runInContext(domainLoaderSource, context, { filename: "domain-loader.js" });
  return {
    BlessERP,
    cache,
    switchCompany(next) {
      activeCompany = next;
      BlessERP.state.state.db.activeCompanyId = next.key;
      BlessERP.state.state.db.authAccess = { activeCompanyUuid: next.id, activeCompanyKey: next.key };
    }
  };
}

const server = new Map();
const controlsA = { enabled: true, rpcCalls: 0, pullCalls: 0, failNextRpc: false };
const controlsB = { enabled: true, rpcCalls: 0, pullCalls: 0, failNextRpc: false };
const sessionA = createSession(server, BLESS, controlsA);
const sessionB = createSession(server, BLESS, controlsB);

const getters = [
  ["getCustomerRepository", "commercial_customers"],
  ["getFinalBrandRepository", "commercial_brands"],
  ["getCountryRepository", "commercial_countries"],
  ["getDaeRepository", "commercial_dae"],
  ["getCargoAgencyRepository", "commercial_agencies"],
  ["getAirlineRepository", "commercial_airlines"]
];
for (const [getter, entity] of getters) {
  assert.equal(sessionA.BlessERP[getter]().entity, entity);
  assert.equal(sessionA.BlessERP[getter]().configured(), true);
}

const customer = { id: "test-persistence-bless", companyId: BLESS.key, code: "CLI-TEST-PERSIST", legalName: "TEST PERSISTENCIA BLESS", commercialName: "TEST PERSISTENCIA BLESS" };
const brand = { id: "test-brand-bless", companyId: BLESS.key, code: "MAR-TEST-PERSIST", customerId: customer.id, finalClientName: "TEST BRAND BLESS" };
const savedCustomer = await sessionA.BlessERP.getCustomerRepository().save(customer);
const savedBrand = await sessionA.BlessERP.getFinalBrandRepository().save(brand);
assert.equal(savedCustomer.confirmed, true);
assert.equal(savedBrand.confirmed, true);
assert.equal(server.get(`${BLESS.id}:commercial_customers:${customer.id}`).payload.commercialName, customer.commercialName);

const secondSessionCustomers = await sessionB.BlessERP.getCustomerRepository().list();
const secondSessionBrands = await sessionB.BlessERP.getFinalBrandRepository().list();
assert.equal(secondSessionCustomers.ok, true, JSON.stringify(secondSessionCustomers));
assert.equal(secondSessionBrands.ok, true, JSON.stringify(secondSessionBrands));
assert.equal(secondSessionCustomers.rows.some(row => row.id === customer.id), true);
assert.equal(secondSessionBrands.rows.some(row => row.id === brand.id), true);

const blessCatalogFixtures = [
  ["getCountryRepository", "commercial_countries", { id: "test-country-bless", companyId: BLESS.key, code: "EC", name: "TEST COUNTRY BLESS" }],
  ["getDaeRepository", "commercial_dae", { id: "test-dae-bless", companyId: BLESS.key, number: "055-TEST-BLESS", destination: "TEST" }],
  ["getCargoAgencyRepository", "commercial_agencies", { id: "test-agency-bless", companyId: BLESS.key, code: "AG-TEST", name: "TEST AGENCY BLESS" }],
  ["getAirlineRepository", "commercial_airlines", { id: "test-airline-bless", companyId: BLESS.key, code: "TB", name: "TEST AIRLINE BLESS", awbPrefix: "999" }]
];
for (const [getter, entity, fixture] of blessCatalogFixtures) {
  assert.equal((await sessionA.BlessERP[getter]().save(fixture)).confirmed, true);
  assert.equal((await sessionB.BlessERP[getter]().list()).rows.some(row => row.id === fixture.id), true);
  sessionB.cache.set(entity, []);
  assert.equal((await sessionB.BlessERP[getter]().list()).rows.some(row => row.id === fixture.id), true);
}
const freshBlessControls = { enabled: true, rpcCalls: 0, pullCalls: 0, failNextRpc: false };
const freshBless = createSession(server, BLESS, freshBlessControls);
const freshBlessHydration = await freshBless.BlessERP.domainDataLoader.ensureDomain("commercial-catalog");
assert.equal(freshBlessHydration.ok, true, JSON.stringify(freshBlessHydration));
assert.equal(freshBlessHydration.mode, "CANONICAL_COMMERCIAL_MASTER_DATA");
assert.equal(freshBlessControls.pullCalls, 1);
assert.equal(freshBless.cache.get("commercial_customers").some(row => row.id === customer.id), true);
sessionB.cache.set("commercial_customers", []);
sessionB.cache.set("commercial_brands", []);
assert.equal((await sessionB.BlessERP.getCustomerRepository().list()).rows.some(row => row.id === customer.id), true);
assert.equal((await sessionB.BlessERP.getFinalBrandRepository().list()).rows.some(row => row.id === brand.id), true);

sessionA.switchCompany(IMPERIO);
const imperioCustomer = { id: "test-persistence-imperio", companyId: IMPERIO.key, code: "CLI-TEST-IMP", legalName: "TEST PERSISTENCIA IMPERIO", commercialName: "TEST PERSISTENCIA IMPERIO" };
assert.equal((await sessionA.BlessERP.getCustomerRepository().save(imperioCustomer)).confirmed, true);
assert.equal((await sessionA.BlessERP.getCustomerRepository().list()).rows.some(row => row.id === customer.id), false);
for (const [getter, , blessFixture] of blessCatalogFixtures) {
  const imperioFixture = { ...blessFixture, id: `${blessFixture.id}-imperio`, companyId: IMPERIO.key };
  assert.equal((await sessionA.BlessERP[getter]().save(imperioFixture)).confirmed, true);
  const imperioRows = (await sessionA.BlessERP[getter]().list()).rows;
  assert.equal(imperioRows.some(row => row.id === imperioFixture.id), true);
  assert.equal(imperioRows.some(row => row.id === blessFixture.id), false);
}
const freshImperioControls = { enabled: true, rpcCalls: 0, pullCalls: 0, failNextRpc: false };
const freshImperio = createSession(server, IMPERIO, freshImperioControls);
const freshImperioHydration = await freshImperio.BlessERP.domainDataLoader.ensureDomain("commercial-catalog");
assert.equal(freshImperioHydration.ok, true, JSON.stringify(freshImperioHydration));
assert.equal(freshImperioHydration.mode, "CANONICAL_COMMERCIAL_MASTER_DATA");
assert.equal(freshImperioControls.pullCalls, 1);
assert.equal(freshImperio.cache.get("commercial_customers").some(row => row.id === imperioCustomer.id), true);
assert.equal(freshImperio.cache.get("commercial_customers").some(row => row.id === customer.id), false);
for (const [, entity, blessFixture] of blessCatalogFixtures) {
  assert.equal(freshImperio.cache.get(entity).some(row => row.id === `${blessFixture.id}-imperio`), true);
  assert.equal(freshImperio.cache.get(entity).some(row => row.id === blessFixture.id), false);
}
for (const entity of entities) freshImperio.cache.set(entity, []);
freshImperio.cache.get("commercial_customers").push({ id: "stale-local-only-imperio", companyId: IMPERIO.key });
const freshImperioRehydrate = await freshImperio.BlessERP.domainDataLoader.ensureDomain("commercial-catalog", { force: true });
assert.equal(freshImperioRehydrate.ok, true, JSON.stringify(freshImperioRehydrate));
assert.equal(freshImperio.cache.get("commercial_customers").some(row => row.id === imperioCustomer.id), true);
assert.equal(freshImperio.cache.get("commercial_customers").some(row => row.id === "stale-local-only-imperio"), false);

let releaseDelayedList;
const delayedControls = {
  enabled: true,
  rpcCalls: 0,
  pullCalls: 0,
  failNextRpc: false,
  listGate: new Promise(resolve => { releaseDelayedList = resolve; })
};
const switchingSession = createSession(server, IMPERIO, delayedControls);
const delayedImperioList = switchingSession.BlessERP.getCustomerRepository().list();
switchingSession.switchCompany(BLESS);
releaseDelayedList();
const rejectedCrossCompanyHydration = await delayedImperioList;
assert.equal(rejectedCrossCompanyHydration.ok, false);
assert.equal(rejectedCrossCompanyHydration.mode, "COMMERCIAL_MASTER_DATA_COMPANY_CONTEXT_CHANGED");
assert.equal(switchingSession.cache.get("commercial_customers").some(row => row.id === imperioCustomer.id), false);
sessionA.switchCompany(BLESS);
assert.equal((await sessionA.BlessERP.getCustomerRepository().list()).rows.some(row => row.id === imperioCustomer.id), false);
for (const [getter, , blessFixture] of blessCatalogFixtures) {
  const blessRows = (await sessionA.BlessERP[getter]().list()).rows;
  assert.equal(blessRows.some(row => row.id === blessFixture.id), true);
  assert.equal(blessRows.some(row => row.id === `${blessFixture.id}-imperio`), false);
}

controlsA.failNextRpc = true;
const failedId = "test-rpc-failure";
const failed = await sessionA.BlessERP.getCountryRepository().save({ id: failedId, companyId: BLESS.key, code: "FAIL", name: "FAIL" });
assert.equal(failed.ok, false);
assert.equal(server.has(`${BLESS.id}:commercial_countries:${failedId}`), false);
assert.equal(sessionA.cache.get("commercial_countries").some(row => row.id === failedId), false);

const beforeIdempotent = controlsA.rpcCalls;
assert.equal((await sessionA.BlessERP.getCustomerRepository().save(customer)).confirmed, true);
assert.equal(controlsA.rpcCalls, beforeIdempotent);
assert.equal([...server.keys()].filter(key => key.endsWith(`:${customer.id}`)).length, 1);
assert.equal((await sessionA.BlessERP.getCustomerRepository().remove(customer)).confirmed, true);
assert.ok(server.get(`${BLESS.id}:commercial_customers:${customer.id}`).deleted_at);
for (const [getter, , fixture] of blessCatalogFixtures) {
  assert.equal((await sessionA.BlessERP[getter]().remove(fixture)).confirmed, true);
  assert.equal((await sessionB.BlessERP[getter]().list()).rows.some(row => row.id === fixture.id), false);
}

const registryContext = vm.createContext({
  window: { BlessERP: {
    getEnvConfig: () => ({ commercialCatalogsSupabaseEnabled: true }),
    getCommercialMasterDataRepository: entity => ({ entity, canExecute: () => true })
  } },
  console, Map, Set, Object, String, Number, Boolean, Array, JSON, structuredClone
});
vm.runInContext(registrySource, registryContext, { filename: "entity-registry.js" });
for (const entity of entities) {
  const descriptor = registryContext.window.BlessERP.syncEntityRegistry.descriptor(entity);
  assert.equal(descriptor.syncMode, "EXPLICIT_COMMERCIAL_MASTER_DATA");
  assert.equal(descriptor.canonicalAuthority, true);
  assert.equal(registryContext.window.BlessERP.syncEntityRegistry.shouldSkipIncrementalCapture(descriptor), true);
  assert.equal(registryContext.window.BlessERP.syncEntityRegistry.isExplicitCaptureReady(descriptor), true);
  assert.equal(registryContext.window.BlessERP.syncEntityRegistry.hasCanonicalServerEvidence({}, entity), true);
}

assert.match(runtimeSource, /"VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE":"true"/);
assert.match(indexSource, /commercial-master-data-repository\.js\?v=20260908-customer-inactivation-1/);
assert.match(incrementalSource, /EXPLICIT_SERVER_AUTHORITY/);
assert.match(incrementalSource, /syncMode === "EXPLICIT_COMMERCIAL_MASTER_DATA"/);
assert.match(incrementalSource, /!explicitServerAuthority && pending && pending\.status !== "synced"/);
for (const name of ["Country", "Customer", "Brand", "Dae", "Agency", "Airline"]) {
  assert.match(stateSource, new RegExp(`async function save${name}\\(appState\\)`));
}
const catalogSaveCalls = [...catalogUiSource.matchAll(/(?:await\s+)?stateApi\.save(?:Customer|Brand|Agency|Country|Dae|Airline)\(appState\);/g)];
assert.equal(catalogSaveCalls.length, 6);
catalogSaveCalls.forEach(match => assert.match(match[0], /^await\s+/));
assert.match(stateSource, /saveConfirmedCatalogCache\(\)/);
assert.match(stateSource, /Supabase debe confirmar/);
assert.doesNotMatch(repositorySource, /localStorage|indexedDB|erp_company_state/);
assert.match(repositorySource, /p_company_id: context\.companyId/);
assert.match(repositorySource, /p_entity: entity/);
assert.match(repositorySource, /p_operation_id: operationId/);
assert.match(repositorySource, /domainDataHydrators\["commercial-catalog"\]/);
assert.match(repositorySource, /CANONICAL_COMMERCIAL_MASTER_DATA/);
assert.match(repositorySource, /COMMERCIAL_MASTER_DATA_COMPANY_CONTEXT_CHANGED/);

console.log(JSON.stringify({
  ok: true,
  entities,
  canonicalTable: "public.erp_entity_records",
  canonicalRpc: "public.erp_apply_offline_operation",
  secondSession: "PASS",
  clearCacheRehydrate: "PASS",
  earlyRouteHydrationBeforeIncrementalStart: "PASS",
  companySwitchHydrationGuard: "PASS",
  blessIsolation: "PASS",
  imperioIsolation: "PASS",
  rpcFailureLeavesLocalCacheUnchanged: "PASS",
  idempotentRecordIdentity: "PASS",
  legacyQueueResurrectionGuard: "PASS",
  sqlRequired: false,
  businessMutations: 0,
  prodMutations: 0
}, null, 2));
