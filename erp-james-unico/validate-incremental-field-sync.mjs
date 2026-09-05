import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("scripts/services/sync/incremental-sync.js", "utf8");
const cloudSource = readFileSync("scripts/services/supabase/cloud-state-sync.js", "utf8");
const realtimeSource = readFileSync("scripts/services/sync/realtime-sync.js", "utf8");
const stateSource = readFileSync("scripts/core/state.js", "utf8");
const layoutSource = readFileSync("scripts/ui/layout.js", "utf8");
const registrySource = readFileSync("scripts/services/sync/entity-registry.js", "utf8");
const appSource = readFileSync("app.js", "utf8");
const migration = readFileSync("supabase/migrations/202608070002_incremental_field_merge.sql", "utf8");
const authorityMigration = readFileSync("supabase/migrations/202608110001_sync_record_authority.sql", "utf8");
const configurationBackfill = readFileSync("supabase/migrations/202608080001_incremental_configuration_backfill.sql", "utf8");

const window = {
  BlessERP: {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  addEventListener() {},
  dispatchEvent() {}
};
const sandbox = {
  window,
  globalThis: { crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" } },
  navigator: { onLine: true },
  document: { visibilityState: "visible", addEventListener() {} },
  CustomEvent: class CustomEvent {},
  structuredClone,
  console,
  Map,
  Set,
  Date,
  JSON,
  Promise
};
vm.runInNewContext(source, sandbox, { filename: "incremental-sync.js" });

const registryWindow = { BlessERP: {} };
vm.runInNewContext(registrySource, {
  window: registryWindow,
  structuredClone,
  JSON,
  Map,
  Set
}, { filename: "entity-registry.js" });
const registry = registryWindow.BlessERP.syncEntityRegistry;
const registryDb = {
  companySettings: { commercialName: "Bless Flower", sriEnvironment: "PRUEBAS" },
  documentSequences: [{ code: "FAC_EXPORT", currentNumber: 674 }]
};
const registrySnapshot = registry.snapshot(registryDb);
assert.equal(registrySnapshot.get("company_settings").get("company_settings").value.commercialName, "Bless Flower");
assert.equal(registrySnapshot.get("accounting_document_sequences").get("FAC_EXPORT").value.currentNumber, 674);
registry.applyServerRecord(registryDb, {
  entity: "company_settings",
  record_id: "company_settings",
  payload: { commercialName: "Bless Flower Ecuador", sriEnvironment: "PRUEBAS" },
  version: 2,
  updated_at: "2026-08-08T12:00:00Z"
});
assert.equal(registryDb.companySettings.commercialName, "Bless Flower Ecuador");
const version15 = registry.applyServerRecord(registryDb, {
  entity: "company_settings",
  record_id: "company_settings",
  payload: { commercialName: "Servidor v15", sriEnvironment: "PRUEBAS" },
  version: 15,
  updated_at: "2026-08-08T15:00:00Z",
  last_operation_id: "00000000-0000-4000-8000-000000000015"
});
assert.equal(version15.changed, true);
const stale14 = registry.applyServerRecord(registryDb, {
  entity: "company_settings",
  record_id: "company_settings",
  payload: { commercialName: "Servidor antiguo v14", sriEnvironment: "PRUEBAS" },
  version: 14,
  updated_at: "2026-08-08T14:00:00Z",
  last_operation_id: "00000000-0000-4000-8000-000000000014"
});
assert.equal(stale14.ignoredOlder, true);
assert.equal(registryDb.companySettings.commercialName, "Servidor v15");
const duplicate15 = registry.applyServerRecord(registryDb, {
  entity: "company_settings",
  record_id: "company_settings",
  payload: { commercialName: "Servidor v15", sriEnvironment: "PRUEBAS" },
  version: 15,
  updated_at: "2026-08-08T15:00:00Z",
  last_operation_id: "00000000-0000-4000-8000-000000000015"
});
assert.equal(duplicate15.duplicate, true);

const changes = window.BlessERP.offlineSync.buildFieldChanges(
  { customer: "A", total: 10, logistics: { dae: "D1", agency: "X" }, lines: [1, 2] },
  { customer: "B", total: 10, logistics: { dae: "D1", agency: "Y" }, lines: [1, 2, 3], note: "ok" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(changes.map(change => Array.from(change.path).join(".")))),
  ["customer", "logistics.agency", "lines", "note"]
);
assert.equal(changes.find(change => change.path.join(".") === "note").base_exists, false);
assert.equal(changes.find(change => change.path.join(".") === "lines").value_exists, true);

assert.match(cloudSource, /backupOnly: incrementalPrimary\(\)/);
assert.match(cloudSource, /SNAPSHOT_BACKUP_ONLY/);
assert.match(cloudSource, /SNAPSHOT_RESTORE_DISABLED/);
assert.match(cloudSource, /options\.backup !== true/);
assert.doesNotMatch(cloudSource, /replaceAll:\s*true/);
assert.match(cloudSource, /clearLegacyCoordinationFlags/);
assert.match(realtimeSource, /erp_entity_records/);
assert.match(realtimeSource, /applyRemoteRecord/);
assert.match(stateSource, /REMOTE_CONFIRMED_INCREMENTAL/);
assert.doesNotMatch(source, /autoResolveByRichness|payloadRichness/);
assert.match(source, /autoResolveConflictOperation/);
assert.match(source, /AUTO_FIELD_MERGE_REQUEUED/);
assert.match(source, /AUTO_SERVER_LATEST_AUDITED/);
assert.match(source, /NETWORK_INTERFACE_CHANGE/);
assert.match(source, /REMOTE_IGNORED_OLDER_VERSION/);
assert.match(source, /DUPLICATE_IGNORED/);
assert.match(source, /SUPABASE_CONFIRMED/);
assert.match(source, /flushDeferredRemoteRecords/);
assert.match(source, /const pullPromises = new Map\(\)/);
assert.match(source, /\.in\("entity", pullScope\.entities\)/);
assert.doesNotMatch(source, /IDEMPOTENT_CONFIRMATION", force: true/);
assert.doesNotMatch(source, /SERVER_CONFIRMATION", force: true/);
assert.doesNotMatch(appSource, /cambio\(s\) recuperado\(s\)/);
assert.equal((appSource.match(/erp:incremental-sync-applied/g) || []).length, 0);
assert.match(layoutSource, /erp:incremental-sync-applied/);
assert.match(layoutSource, /pullBootstrap/);
assert.match(layoutSource, /localStorage es solo caché/);
assert.match(registrySource, /company_settings/);
assert.match(registrySource, /accounting_document_sequences/);
assert.match(registrySource, /operations_digitizers/);
assert.match(registrySource, /operations_yield_settings/);
assert.match(registrySource, /descriptor\.kind === "singleton"/);
assert.match(migration, /erp_sync_field_audit/);
assert.match(migration, /SUPABASE_NEWEST_WINS/);
assert.match(migration, /jsonb_array_elements\(coalesce\(p_field_changes/);
assert.match(migration, /current_row\.version = coalesce\(p_base_version/);
assert.match(authorityMigration, /last_operation_id/);
assert.match(authorityMigration, /device_id/);
assert.match(authorityMigration, /erp_sync_operation_stamp_record/);
assert.doesNotMatch(authorityMigration, /\bdelete\s+from\b/i);
assert.match(configurationBackfill, /accounting_document_sequences/);
assert.match(configurationBackfill, /operations_digitizers/);
assert.match(configurationBackfill, /on conflict \(company_id, entity, record_id\) do nothing/);
assert.doesNotMatch(configurationBackfill, /\bdelete\s+from\b/i);

console.log("VALIDACION_INCREMENTAL_POR_CAMPO_OK");
console.log("Registro por registro, fusión por campo, auditoría y snapshot de respaldo: OK");
