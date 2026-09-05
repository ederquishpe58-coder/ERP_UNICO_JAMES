import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const incrementalSource = readFileSync("scripts/services/sync/incremental-sync.js", "utf8");
const indexedDbSource = readFileSync("scripts/services/sync/indexeddb-store.js", "utf8");
const registrySource = readFileSync("scripts/services/sync/entity-registry.js", "utf8");
const realtimeSource = readFileSync("scripts/services/sync/realtime-sync.js", "utf8");
const cloudSource = readFileSync("scripts/services/supabase/cloud-state-sync.js", "utf8");
const layoutSource = readFileSync("scripts/ui/layout.js", "utf8");
const appSource = readFileSync("app.js", "utf8");
const migration = readFileSync("supabase/migrations/202608110001_sync_record_authority.sql", "utf8");
const serviceWorkerSource = readFileSync("service-worker.js", "utf8");

const registryWindow = { BlessERP: {} };
vm.runInNewContext(registrySource, {
  window: registryWindow,
  structuredClone,
  JSON,
  Map,
  Set
}, { filename: "entity-registry.js" });
const registry = registryWindow.BlessERP.syncEntityRegistry;
const db = { commercial: { orders: [{ id: "PED-1", total: 150 }] } };
assert.equal(registry.applyServerRecord(db, {
  company_id: "COMPANY",
  entity: "commercial_orders",
  record_id: "PED-1",
  payload: { id: "PED-1", total: 200 },
  version: 15,
  updated_at: "2026-08-11T12:00:00Z",
  last_operation_id: "00000000-0000-4000-8000-000000000015"
}).changed, true);
const ignored = registry.applyServerRecord(db, {
  company_id: "COMPANY",
  entity: "commercial_orders",
  record_id: "PED-1",
  payload: { id: "PED-1", total: 100 },
  version: 14,
  updated_at: "2026-08-11T11:00:00Z",
  last_operation_id: "00000000-0000-4000-8000-000000000014"
});
assert.equal(ignored.ignoredOlder, true);
assert.equal(db.commercial.orders[0].total, 200);
const authoritative = registry.applyServerRecord(db, {
  company_id: "COMPANY",
  entity: "commercial_orders",
  record_id: "PED-1",
  payload: { id: "PED-1", total: 225 },
  version: 15,
  updated_at: "2026-08-11T12:05:00Z",
  last_operation_id: "00000000-0000-4000-8000-000000000016"
}, { forceServer: true });
assert.equal(authoritative.changed, true);
assert.equal(db.commercial.orders[0].total, 225, "Supabase debe reemplazar la cache cuando no existe una operacion pendiente.");

const indexedWindow = { BlessERP: {} };
vm.runInNewContext(indexedDbSource, {
  window: indexedWindow,
  indexedDB: undefined,
  structuredClone,
  JSON,
  Map,
  Promise,
  Date
}, { filename: "indexeddb-store.js" });
const cache = indexedWindow.BlessERP.syncIndexedDb;
await cache.putEntity({
  company_id: "COMPANY", entity: "commercial_orders", record_id: "PED-1",
  payload: { total: 200 }, version: 15, updated_at: "2026-08-11T12:00:00Z"
});
const cacheResult = await cache.putEntity({
  company_id: "COMPANY", entity: "commercial_orders", record_id: "PED-1",
  payload: { total: 100 }, version: 14, updated_at: "2026-08-11T11:00:00Z"
});
assert.equal(cacheResult._cache_write, "IGNORED_OLDER_VERSION");
assert.equal((await cache.getEntity("COMPANY", "commercial_orders", "PED-1")).version, 15);

const recoverBody = incrementalSource.slice(
  incrementalSource.indexOf("async function recover("),
  incrementalSource.indexOf("async function start(")
);
const applyRemoteBody = incrementalSource.slice(
  incrementalSource.indexOf("async function applyRemoteRecord("),
  incrementalSource.indexOf("async function flushDeferredRemoteRecords(")
);
const cacheAuthorityBody = incrementalSource.slice(
  incrementalSource.indexOf("async function discardCacheOnlyExplicitRecords("),
  incrementalSource.indexOf("function captureChanges(")
);
assert.ok(recoverBody.indexOf("await pullIncremental()") < recoverBody.indexOf("await processQueue()"));
assert.ok(recoverBody.indexOf("await processQueue()") < recoverBody.indexOf("realtimeSync?.reconnect"));
assert.match(incrementalSource, /const pullPromises = new Map\(\)/);
assert.match(incrementalSource, /if \(pullPromises\.has\(pullScope\.scope\)\) return pullPromises\.get\(pullScope\.scope\)/);
assert.match(incrementalSource, /last_sync:\$\{syncContext\.projectRef\}:\$\{syncContext\.companyId\}/);
[
  "LOCAL_EDIT",
  "SUPABASE_SEND",
  "SUPABASE_CONFIRMED",
  "REALTIME_RECEIVED",
  "REMOTE_IGNORED_OLDER_VERSION",
  "OFFLINE_QUEUED",
  "OFFLINE_SYNCED",
  "CONFLICT",
  "DUPLICATE_IGNORED"
].forEach(eventName => assert.match(incrementalSource, new RegExp(`\\"${eventName}\\"`)));

assert.match(layoutSource, /activePageEditor/);
assert.match(layoutSource, /flushDeferredRemoteRecords/);
assert.match(layoutSource, /isEditing\(\)/);
assert.doesNotMatch(appSource, /recuperado\(s\) desde Supabase/);
assert.equal((appSource.match(/erp:incremental-sync-applied/g) || []).length, 0);
assert.doesNotMatch(cloudSource, /replaceAll:\s*true/);
assert.match(cloudSource, /SNAPSHOT_RESTORE_DISABLED/);
assert.equal((realtimeSource.match(/let channel = null/g) || []).length, 1);
assert.match(realtimeSource, /await closeChannel\(\)/);
assert.match(migration, /last_operation_id uuid/);
assert.match(migration, /device_id text/);
assert.match(migration, /record\.version = new\.result_version/);
assert.match(serviceWorkerSource, /const CACHE_VERSION = "jaeder-shell-[^"]+"/);
assert.match(incrementalSource, /await pullBootstrap\(\{ full: true, pruneExcluded: true \}\)/, "Al abrir debe reconciliar el bootstrap selectivo contra la fuente oficial.");
assert.doesNotMatch(incrementalSource, /await pullIncremental\(\{ full: true \}\)/, "El login no debe hidratar nuevamente todo el historial.");
assert.match(incrementalSource, /discardCacheOnlyExplicitRecords/, "La carga completa debe reconciliar la caché V2 contra la autoridad remota.");
assert.match(cacheAuthorityBody, /isExplicitCaptureReady/, "Solo las entidades V2 desplegadas y habilitadas pueden podarse desde la autoridad remota.");
assert.match(cacheAuthorityBody, /findPendingForRecord/, "Una operación offline explícita pendiente debe conservar su registro local.");
assert.doesNotMatch(cacheAuthorityBody, /enqueueChange\(/, "Un registro presente solo en caché no puede transformarse en INSERT.");
assert.doesNotMatch(incrementalSource, /RECOVERED_LOCAL_RECORD_MISSING_ON_SERVER/);
assert.match(applyRemoteBody, /persistAppliedRemoteRecords\(\[\{/);
assert.match(applyRemoteBody, /recordId: serverRecord\.record_id/);
assert.doesNotMatch(applyRemoteBody, /baseline = registry\(\)\.snapshot\(db\)/, "Un evento remoto no puede absorber cambios locales de otras colecciones.");
assert.match(registrySource, /SUPABASE_AUTHORITY/, "El servidor debe poder reemplazar una cache local sin operaciones pendientes.");
assert.match(serviceWorkerSource, /networkFirstAsset/);

console.log("VALIDACION_AUTORIDAD_VERSIONADA_OK");
console.log("Versiones antiguas ignoradas, cola idempotente, reconexión ordenada y formularios protegidos: OK");
