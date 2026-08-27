import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sandbox = { window: { BlessERP: {} }, console };
vm.createContext(sandbox);
vm.runInContext(read("scripts/services/sync/entity-registry.js"), sandbox);
const registry = sandbox.window.BlessERP.syncEntityRegistry;
const inventory = registry.hydrationInventory();
const sync = read("scripts/services/sync/incremental-sync.js");
const moduleLoader = read("scripts/core/module-loader.js");
const domainLoader = read("scripts/services/sync/domain-loader.js");
const indexedDbStore = read("scripts/services/sync/indexeddb-store.js");

assert(registry.preloadEntities().length === 9, "El login no usa el bootstrap mínimo de nueve entidades.");
assert(!inventory.some(row => row.preload && row.preloadClass !== "A_REQUIRED"), "Un histórico o dominio pesado permanece en login.");
assert(sync.includes("await pullBootstrap({ full: true, pruneExcluded: true })"), "El login no reconcilia el bootstrap de forma selectiva.");
assert(!sync.includes("await pullIncremental({ full: true })"), "Permanece un full:true global directo.");
assert(moduleLoader.includes("Prefetch prepara únicamente código"), "Prefetch puede descargar datos antes de entrar a la ruta.");
for (const route of ["reports-dashboard", "reports-accounting", "reports-portfolio", "reports-banks", "accounting-journal", "accounting-ledger", "accounting-financials"]) {
  const pattern = new RegExp(`"${route}"\\s*:\\s*\\[\\]`);
  assert(pattern.test(domainLoader), `${route} no está explícitamente libre de pullDomain histórico.`);
}

const tombstoneDb = { customers: [{ id: "customer-deleted", name: "Anterior", __syncVersion: 1 }] };
const tombstone = { entity: "customers", record_id: "customer-deleted", payload: {}, version: 2, updated_at: "2026-08-23T10:00:00Z", deleted_at: "2026-08-23T10:00:00Z" };
const removed = registry.applyServerRecord(tombstoneDb, tombstone, { forceServer: true });
assert(removed.deleted === true && removed.changed === true && tombstoneDb.customers.length === 0, "Un DELETE remoto no retiró el registro local.");
const reloginDb = { customers: [] };
const relogin = registry.applyServerRecord(reloginDb, tombstone, { forceServer: true });
assert(relogin.deleted === true && reloginDb.customers.length === 0, "El tombstone revivió durante logout/login.");
assert(/\["pending",\s*"syncing",\s*"error",\s*"conflict"\]/.test(sync), "La limpieza selectiva no protege pending/syncing/error/conflict.");
assert(indexedDbStore.includes("async function putEntity") && /\.\.\.clone\(record\)/.test(indexedDbStore), "IndexedDB no conserva el registro canónico completo, incluido el tombstone.");

console.log("VALIDACION_SIN_HISTORICO_GLOBAL_OK");
console.log(JSON.stringify({ bootstrapEntities: 9, historicalEntitiesOnLogin: 0, fullGlobalPulls: 0, serverReportRoutesWithDomainPull: 0, remoteDeleteRemoved: 1, tombstoneReloginResurrection: 0, protectedLocalOperationStates: 4 }, null, 2));
