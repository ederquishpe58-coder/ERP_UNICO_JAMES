import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const registrySource = readFileSync("scripts/services/sync/entity-registry.js", "utf8");
const syncSource = readFileSync("scripts/services/sync/incremental-sync.js", "utf8");
const operationsSource = readFileSync("scripts/modules/operaciones/operaciones-state.js", "utf8");
const realtimeSource = readFileSync("scripts/services/sync/realtime-sync.js", "utf8");

const windowObject = {
  BlessERP: {},
  addEventListener() {},
  dispatchEvent() {},
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {}
};
const baseSandbox = {
  window: windowObject,
  globalThis: { crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000099" }, navigator: { onLine: false } },
  navigator: { onLine: false },
  document: { visibilityState: "hidden", addEventListener() {} },
  CustomEvent: class CustomEvent {},
  URL,
  Map,
  Set,
  Date,
  JSON,
  Promise,
  structuredClone,
  console
};
vm.createContext(baseSandbox);
vm.runInContext(registrySource, baseSandbox, { filename: "entity-registry.js" });
const registry = windowObject.BlessERP.syncEntityRegistry;

assert.deepEqual(Array.from(registry.derivedFieldsForEntity("operations_rose_inventory")), ["ageDays"]);
assert.deepEqual(Array.from(registry.derivedFieldsForEntity("operations_availability")), ["edad_dias"]);

const db = {
  operations: {
    roseInventory: [{
      inventoryId: "INV-HARDEN-1",
      admittedAt: "2026-08-24T10:00:00Z",
      state: "DISPONIBLE",
      ageDays: 0
    }],
    availabilityDemo: [{
      availability_id: "AVL-HARDEN-1",
      estado: "DISPONIBLE",
      edad_dias: 0
    }]
  }
};
const firstSnapshot = registry.snapshot(db);
for (let index = 1; index <= 100; index += 1) {
  db.operations.roseInventory[0].ageDays = index;
  db.operations.availabilityDemo[0].edad_dias = index;
}
const renderSnapshot = registry.snapshot(db);
assert.equal(
  firstSnapshot.get("operations_rose_inventory").get("INV-HARDEN-1").fingerprint,
  renderSnapshot.get("operations_rose_inventory").get("INV-HARDEN-1").fingerprint,
  "Recalcular ageDays durante 100 renders no puede cambiar el snapshot canónico."
);
assert.equal(
  firstSnapshot.get("operations_availability").get("AVL-HARDEN-1").fingerprint,
  renderSnapshot.get("operations_availability").get("AVL-HARDEN-1").fingerprint,
  "edad_dias no puede formar parte del snapshot persistible."
);
assert.equal(registry.isDerivedOnlyPayloadChange(
  "operations_rose_inventory",
  { inventoryId: "INV-HARDEN-1", state: "DISPONIBLE", ageDays: 1 },
  { inventoryId: "INV-HARDEN-1", state: "DISPONIBLE", ageDays: 2 }
), true);

const operations = [];
const metadata = new Map();
const indexedStore = {
  async open() {},
  async getMeta(key, fallback) { return metadata.has(key) ? structuredClone(metadata.get(key)) : fallback; },
  async setMeta(key, value) { metadata.set(key, structuredClone(value)); return value; },
  async listOperations({ statuses, companyId } = {}) {
    return operations.filter(row => (
      (!statuses || statuses.includes(row.status))
      && (!companyId || row.company_id === companyId)
    ));
  },
  async findPendingForRecord(companyId, entity, recordId) {
    return operations.find(row => row.company_id === companyId
      && row.entity === entity
      && row.record_id === recordId
      && ["pending", "syncing", "error", "conflict"].includes(row.status)) || null;
  },
  async putOperation(operation) { operations.push(structuredClone(operation)); return operation; },
  async updateOperation(operationId, patch) {
    const row = operations.find(item => item.operation_id === operationId);
    if (!row) return null;
    Object.assign(row, structuredClone(patch));
    return structuredClone(row);
  },
  async clearSyncedOperations() { return 0; },
  async putEntity(record) { return record; },
  async removeCachedEntities() { return { removed: 0, preserved: 0 }; },
  async listEntityCache() { return []; }
};
Object.assign(windowObject.BlessERP, {
  syncIndexedDb: indexedStore,
  state: { state: { db } },
  storage: { save() { return true; } },
  getEnvConfig: () => ({
    supabaseEnabled: true,
    authEnabled: true,
    rlsEnabled: true,
    coreSupabaseEnabled: true,
    incrementalSyncEnabled: true,
    supabaseUrl: "https://lmurmntscqnvkmvielaw.supabase.co",
    raw: { VITE_APP_VERSION: "1.0.0-test" }
  }),
  getSupabaseClient: () => ({}),
  authAccess: {
    activeAccess: () => ({
      activeCompany: { id: "10000000-0000-4000-8000-000000000001" },
      activeCompanyKey: "BLESS-FLOWER",
      session: { user: { id: "20000000-0000-4000-8000-000000000001" } }
    })
  }
});
vm.runInContext(syncSource, baseSandbox, { filename: "incremental-sync.js" });
const sync = windowObject.BlessERP.offlineSync;
await sync.start(db);

for (let index = 0; index < 100; index += 1) {
  db.operations.roseInventory[0].ageDays = index;
  const captured = await sync.captureChanges(db, { origin: "RENDER_DERIVATION" });
  assert.equal(captured.length, 0);
}
assert.equal(operations.length, 0, "Render/edad derivada no puede crear operaciones.");
assert.equal((await sync.captureChanges(db, { origin: "SERVER_HYDRATE" })).length, 0);
assert.equal((await sync.captureChanges(db, { origin: "REALTIME" })).length, 0);

db.operations.roseInventory[0].state = "OBSERVADO";
const explicit = await sync.captureChanges(db, { origin: "USER_MUTATION" });
assert.equal(explicit.length, 1, "Una edición explícita debe producir exactamente una operación.");
assert.equal(operations.length, 1);
const operation = operations[0];
assert.equal(operation.project_ref, "lmurmntscqnvkmvielaw");
assert.equal(operation.company_id, "10000000-0000-4000-8000-000000000001");
assert.equal(operation.user_id, "20000000-0000-4000-8000-000000000001");
assert.equal(operation.queue_schema_version, 2);
assert.equal(operation.operation_schema_version, 2);
assert.equal(operation.application_version, "1.0.0-test");
assert.equal(sync.replayGate(operation).ok, true);

assert.equal(sync.replayGate({ ...operation, project_ref: "otro-proyecto" }).reason, "PROJECT_MISMATCH");
assert.equal(sync.replayGate({ ...operation, project_ref: "" }).reason, "LEGACY_NO_ENVIRONMENT");
assert.equal(sync.replayGate({ ...operation, company_id: "30000000-0000-4000-8000-000000000001" }).reason, "COMPANY_MISMATCH");
assert.equal(sync.replayGate({ ...operation, user_id: "40000000-0000-4000-8000-000000000001" }).reason, "USER_MISMATCH");
assert.equal(sync.replayGate({ ...operation, user_id: "" }).reason, "USER_MISMATCH");
assert.equal(sync.replayGate({ ...operation, operation_schema_version: 1 }).reason, "SCHEMA_VERSION_MISMATCH");
assert.equal(sync.replayGate({ ...operation, local_created_at: "2026-01-01T00:00:00.000Z" }, undefined, Date.parse("2026-08-24T00:00:00Z")).reason, "STALE_OPERATION");

const legacy = {
  ...operation,
  operation_id: "10000000-0000-4000-8000-000000000098",
  project_ref: "",
  status: "pending",
  entity: "operations_rose_inventory",
  payload: { inventoryId: "INV-LEGACY", state: "DISPONIBLE", ageDays: 4 },
  base_payload: { inventoryId: "INV-LEGACY", state: "DISPONIBLE", ageDays: 3 },
  field_changes: [{ path: ["ageDays"], base: 3, value: 4 }]
};
operations.push(legacy);
const quarantine = await sync.quarantineUnverifiedOperations();
assert.equal(quarantine.quarantined, 1);
assert.equal(legacy.status, "quarantined");
assert.equal(legacy.quarantine_reason, "DERIVED_FIELD_ONLY");
assert.equal(legacy.legacy_classification, "LEGACY_UNVERIFIED");
assert.ok(legacy.quarantine_reasons.includes("LEGACY_NO_ENVIRONMENT"));

const normalizedBody = operationsSource.slice(
  operationsSource.indexOf("function normalizeOperationalStore("),
  operationsSource.indexOf("function ensureStore(")
);
assert.doesNotMatch(normalizedBody, /item\.ageDays\s*=/, "ensureStore no puede escribir ageDays.");
assert.doesNotMatch(normalizedBody, /refreshAvailabilityFromScannedInventory\(store\)/, "ensureStore no puede regenerar disponibilidad persistida.");
assert.match(realtimeSource, /isDerivedOnlyPayloadChange/);
assert.match(syncSource, /if \(processingPromise\) return processingPromise/);
assert.match(syncSource, /const alreadyProcessed = await findRemoteOperation\(operation\.operation_id\)/);
assert.ok(syncSource.indexOf("const alreadyProcessed = await findRemoteOperation") < syncSource.indexOf('supabase.rpc("erp_apply_offline_operation"'));

// Idempotencia dinámica: aun si una respuesta confirmada vuelve localmente a
// pending, el segundo replay consulta operation_id antes de invocar la mutación.
const replayRows = [{
  ...structuredClone(operation),
  operation_id: "10000000-0000-4000-8000-000000000097",
  status: "pending",
  payload: { inventoryId: "INV-HARDEN-REPLAY", state: "OBSERVADO" },
  base_payload: { inventoryId: "INV-HARDEN-REPLAY", state: "DISPONIBLE" },
  field_changes: [{ path: ["state"], base: "DISPONIBLE", value: "OBSERVADO" }],
  local_created_at: new Date().toISOString(),
  created_at: new Date().toISOString()
}];
const replayMeta = new Map();
const ledger = new Map();
let serverMutationCount = 0;
const replayDb = { operations: { roseInventory: [{ inventoryId: "INV-HARDEN-REPLAY", state: "DISPONIBLE" }] } };
const replayStore = {
  async open() {},
  async getMeta(key, fallback) { return replayMeta.has(key) ? replayMeta.get(key) : fallback; },
  async setMeta(key, value) { replayMeta.set(key, structuredClone(value)); return value; },
  async listOperations({ statuses, companyId } = {}) {
    return replayRows.filter(row => (!statuses || statuses.includes(row.status)) && (!companyId || row.company_id === companyId));
  },
  async findPendingForRecord(companyId, entity, recordId) {
    return replayRows.find(row => row.company_id === companyId && row.entity === entity && row.record_id === recordId
      && ["pending", "syncing", "error", "conflict"].includes(row.status)) || null;
  },
  async updateOperation(operationId, patch) {
    const row = replayRows.find(item => item.operation_id === operationId);
    if (row) Object.assign(row, structuredClone(patch));
    return row || null;
  },
  async putOperation(row) { replayRows.push(structuredClone(row)); return row; },
  async putEntity(row) { return row; },
  async clearSyncedOperations() { return 0; },
  async listEntityCache() { return []; },
  async removeCachedEntities() { return { removed: 0, preserved: 0 }; }
};
function queryBuilder(table) {
  const filters = {};
  const builder = {
    select() { return builder; },
    eq(key, value) { filters[key] = value; return builder; },
    in() { return builder; },
    gt() { return builder; },
    order() { return builder; },
    range() { return Promise.resolve({ data: [], error: null }); },
    maybeSingle() {
      if (table === "erp_sync_operations") return Promise.resolve({ data: ledger.get(filters.operation_id) || null, error: null });
      return Promise.resolve({ data: null, error: null });
    }
  };
  return builder;
}
const replaySupabase = {
  from: queryBuilder,
  async rpc(name, args = {}) {
    if (name === "erp_sync_health") return { data: [{ server_time: new Date().toISOString() }], error: null };
    if (name !== "erp_apply_offline_operation") throw new Error(`RPC inesperada: ${name}`);
    if (args.p_record_id === "INV-AUTH-DENY") {
      return { data: null, error: { code: "42501", message: "CAPABILITY_REQUIRED" } };
    }
    serverMutationCount += 1;
    const result = {
      operation_id: args.p_operation_id,
      status: "APPLIED",
      result_version: 1,
      server_processed_at: new Date().toISOString(),
      server_record: {
        company_id: args.p_company_id,
        entity: args.p_entity,
        record_id: args.p_record_id,
        payload: args.p_payload,
        version: 1,
        updated_at: new Date().toISOString(),
        last_operation_id: args.p_operation_id,
        deleted_at: null
      }
    };
    ledger.set(args.p_operation_id, result);
    return { data: [result], error: null };
  }
};
const replayWindow = {
  BlessERP: {}, addEventListener() {}, dispatchEvent() {},
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}
};
const replaySandbox = {
  ...baseSandbox,
  window: replayWindow,
  globalThis: { crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000096" }, navigator: { onLine: true } },
  navigator: { onLine: true },
  document: { visibilityState: "hidden", addEventListener() {} }
};
vm.createContext(replaySandbox);
vm.runInContext(registrySource, replaySandbox, { filename: "entity-registry-replay.js" });
Object.assign(replayWindow.BlessERP, {
  syncIndexedDb: replayStore,
  state: { state: { db: replayDb } },
  storage: { save() { return true; } },
  getEnvConfig: windowObject.BlessERP.getEnvConfig,
  getSupabaseClient: () => replaySupabase,
  authAccess: windowObject.BlessERP.authAccess
});
vm.runInContext(syncSource, replaySandbox, { filename: "incremental-sync-replay.js" });
const replaySync = replayWindow.BlessERP.offlineSync;
assert.equal((await replaySync.processQueue()).ok, true);
assert.equal(serverMutationCount, 1);
replayRows[0].status = "pending"; // simula respuesta local perdida tras COMMIT
assert.equal((await replaySync.processQueue()).ok, true);
assert.equal(serverMutationCount, 1, "Repetir operation_id no puede duplicar la mutación de servidor.");

// Un 42501 es terminal: queda fuera del conjunto replayable, sin backoff ni
// segundo intento. Se conserva solo como evidencia forense en cuarentena.
const authorizationDenied = {
  ...structuredClone(operation),
  operation_id: "10000000-0000-4000-8000-000000000095",
  record_id: "INV-AUTH-DENY",
  status: "pending",
  attempts: 0,
  payload: { inventoryId: "INV-AUTH-DENY", state: "OBSERVADO" },
  base_payload: { inventoryId: "INV-AUTH-DENY", state: "DISPONIBLE" },
  field_changes: [{ path: ["state"], base: "DISPONIBLE", value: "OBSERVADO" }],
  local_created_at: new Date().toISOString(),
  created_at: new Date().toISOString()
};
replayRows.push(authorizationDenied);
assert.equal((await replaySync.processQueue()).ok, true);
assert.equal(authorizationDenied.status, "quarantined");
assert.equal(authorizationDenied.quarantine_reason, "AUTHORIZATION_DENIED");
assert.equal(authorizationDenied.next_retry_at, "");
assert.equal(serverMutationCount, 1, "Un rechazo de autorización no puede mutar ni reintentarse.");
assert.equal((await replayStore.listOperations({ statuses: ["pending", "syncing", "error", "conflict"] })).length, 0);

console.log("VALIDACION_OFFLINE_QUEUE_HARDENING_OK");
console.log("Derived-only=0 ops, provenance, authorization terminal, replay guards y single-flight: OK");
