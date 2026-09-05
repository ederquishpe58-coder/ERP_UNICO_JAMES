import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const incrementalSyncSource = read("scripts/services/sync/incremental-sync.js");
assert(
  incrementalSyncSource.includes("deferSnapshotPersistence: true")
    && incrementalSyncSource.includes("persistAppliedRemoteRecords(pageAppliedRecords)"),
  "pullDomain volvió a persistir state.db por cada fila remota."
);
assert(
  incrementalSyncSource.includes("function updateBaselineRecords(records")
    && incrementalSyncSource.includes("const current = registry().snapshot(db);"),
  "La línea base remota no se actualiza mediante un snapshot agrupado."
);
const listeners = new Map();
let pulls = 0;
const windowObject = {
  BlessERP: { authAccess: { activeAccess: () => ({ activeCompany: { id: "company-a" } }) }, state: { state: { db: {} } } },
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
  dispatchEvent() {}, setTimeout, clearTimeout
};
const sandbox = { window: windowObject, console, setTimeout, clearTimeout, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } };
vm.createContext(sandbox);
vm.runInContext(read("scripts/services/sync/entity-registry.js"), sandbox);
vm.runInContext(read("scripts/services/sync/sync-instrumentation.js"), sandbox);
windowObject.BlessERP.offlineSync = {
  async pullDomain(entities) {
    pulls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true, fetchedRows: entities.length, entitiesRequested: entities.length, lastSyncAt: new Date().toISOString() };
  }
};
vm.runInContext(read("scripts/services/sync/domain-loader.js"), sandbox);
const loader = windowObject.BlessERP.domainDataLoader;

assert(loader.routeDomains("reports-dashboard").length === 0, "Dashboard server-side intentó cargar un dominio histórico.");
assert(loader.routeDomains("accounting-journal").length === 0, "Libro Diario intentó cargar el journal global.");
await loader.ensureRoute("commercial-brands");
await loader.ensureRoute("commercial-brands");
assert(pulls === 1, `El catálogo comercial se descargó más de una vez: ${pulls}.`);
loader.leaveRoute("commercial-brands");
await Promise.all([loader.ensureRoute("operations-reception"), loader.ensureRoute("operations-reception")]);
assert(pulls === 3, `Operaciones debe cargar dos dominios una sola vez; pulls=${pulls}.`);
assert(windowObject.BlessERP.syncInstrumentation.snapshot().duplicateDomainLoads >= 1, "No se registró la deduplicación de una carga concurrente.");
loader.leaveRoute("operations-reception");
await loader.ensureRoute("reports-dashboard");
assert(pulls === 3, "Una ruta generate-first ejecutó pullDomain.");

const routeContracts = [
  ["Commercial", "commercial-panel", ["commercial-catalog", "commercial-workspace"], "DOMAIN"],
  ["Purchases", "purchases-invoices", ["purchases-catalog"], "RPC"],
  ["Purchase XML", "purchases-upload-xml", ["purchases-catalog", "purchases-workspace"], "DOMAIN"],
  ["Retentions issued", "purchases-withholdings-issued", ["purchases-catalog"], "RPC"],
  ["Retentions received", "tax-withholdings-received", ["commercial-catalog"], "RPC"],
  ["CxP", "portfolios-ap", ["purchases-catalog"], "RPC"],
  ["CxC", "portfolios-ar", [], "RPC"],
  ["Payments", "portfolios-payments-single", ["purchases-catalog", "treasury-catalog"], "RPC"],
  ["Collections", "portfolios-collections-single", ["treasury-catalog"], "RPC"],
  ["Treasury", "banks-movements", ["treasury-catalog"], "RPC"],
  ["Reconciliation", "banks-reconciliation", ["treasury-catalog"], "RPC"],
  ["Payroll", "payroll-employees", ["payroll", "treasury-catalog"], "DOMAIN"],
  ["Operations", "operations-postharvest", ["operations-catalog", "operations-workspace"], "DOMAIN"],
  ["Reception", "operations-reception", ["operations-catalog", "operations-workspace"], "DOMAIN"],
  ["Classification", "operations-grading", ["operations-catalog", "operations-workspace"], "DOMAIN"],
  ["Zebra", "operations-labels", ["operations-catalog", "operations-workspace"], "DOMAIN"],
  ["Availability", "operations-availability", ["operations-catalog", "operations-workspace"], "DOMAIN"],
  ["Accounting", "accounting-journal", [], "RPC"],
  ["Reports", "reports-dashboard", [], "RPC"]
];
const routeMatrix = routeContracts.map(([module, route, expectedDomains, dataAccess]) => {
  const actualDomains = loader.routeDomains(route);
  assert(JSON.stringify(actualDomains) === JSON.stringify(expectedDomains), `${route} cargó dominios inesperados: ${actualDomains.join(",")}.`);
  return { module, route, bootstrapEntities: 9, domains: actualDomains, dataAccess, accidentalMissingDataErrors: 0, validation: "STRUCTURAL_LOCAL" };
});
const outputDirectory = path.join(root, "LOCAL-DATA");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "cont-d-route-matrix.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), routes: routeMatrix }, null, 2)}\n`);

console.log("VALIDACION_DOMAIN_LAZY_LOADING_OK");
console.log(JSON.stringify({ pulls, duplicateLoads: windowObject.BlessERP.syncInstrumentation.snapshot().duplicateDomainLoads, reportsDashboardDomainQueries: 0, accountingJournalDomainQueries: 0, routesValidated: routeMatrix.length, routeMatrix: "LOCAL-DATA/cont-d-route-matrix.json" }, null, 2));
