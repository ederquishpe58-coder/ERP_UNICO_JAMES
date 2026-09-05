import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`OK: ${message}`);
};

const registry = read("scripts/services/sync/entity-registry.js");
const incremental = read("scripts/services/sync/incremental-sync.js");
const realtime = read("scripts/services/sync/realtime-sync.js");
const state = read("scripts/core/state.js");
const cloud = read("scripts/services/supabase/cloud-state-sync.js");
const commercialRepository = read("scripts/repositories/comercial/commercial-order-repository.js");
const operationsState = read("scripts/modules/operaciones/operaciones-state.js");

assert(/ZEBRA_V2_ENTITIES[\s\S]*?operations_label_batches/.test(registry), "Etiquetas Zebra están identificadas para su futura fase V2.");
assert(/function isExplicitCaptureReady[\s\S]*?Las fases 005\+ conservan captura incremental/.test(registry), "Las fases V2 no desplegadas conservan la captura incremental legacy.");
assert(!incremental.includes("recoverLocalRecordsMissingOnServer"), "No existe recuperación automática caché → Supabase.");
assert(incremental.includes("discardCacheOnlyExplicitRecords"), "La carga completa descarta caché V2 ausente en Supabase.");
assert(incremental.includes("isExplicitCaptureReady"), "La limpieza de autoridad se limita a entidades V2 realmente habilitadas.");
assert(incremental.includes("preservedPending") && incremental.includes("findPendingForRecord"), "Las operaciones IndexedDB pendientes se conservan.");
assert(realtime.includes('source: "REALTIME"') && !/source: "REALTIME"[\s\S]{0,500}saveDb\s*\(/.test(realtime), "Realtime aplica caché/UI sin `saveDb()`.");
assert(realtime.includes("erp:canonical-record-updated"), "Realtime expone actualización granular cancelable.");
assert(realtime.includes("rowCompanyId !== activeCompanyId"), "Realtime directo ignora registros de otra empresa.");
assert(state.includes("EXPLICIT_V2_COMMAND_REQUIRED"), "`saveDbConfirmed()` no sustituye una RPC V2 remota.");
assert(state.includes("options.captureIncremental !== false") && state.includes("remoteSource"), "Guardados remotos no disparan captura incremental.");
assert(commercialRepository.includes("repository.remoteRequired = remoteRequired"), "Pedidos distinguen HTML local de contexto remoto obligatorio.");
assert(/function findScannedInventoryByCode[\s\S]{0,420}requiresConfirmedRemoteOperations\(\)/.test(operationsState), "La consulta V2 de un ramo no reconstruye inventario desde caché histórica.");
assert(/function scheduleSave[\s\S]{0,220}return;/.test(cloud), "El snapshot no se programa desde guardado normal.");
assert(/function handleRealtimeChange[\s\S]{0,160}SNAPSHOT_BACKUP_IGNORED/.test(cloud), "Realtime no restaura snapshots empresariales.");
console.log("Consolidación V2 validada.");
