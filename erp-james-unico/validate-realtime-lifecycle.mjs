import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const listeners = new Map();
const windowObject = {
  BlessERP: { authAccess: { activeAccess: () => ({ activeCompany: { id: "company-a" } }) }, state: { state: { db: {} } } },
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
  dispatchEvent() {}, setTimeout, clearTimeout
};
const sandbox = { window: windowObject, console, setTimeout, clearTimeout, CustomEvent: class {} };
vm.createContext(sandbox);
vm.runInContext(read("scripts/services/sync/entity-registry.js"), sandbox);
vm.runInContext(read("scripts/services/sync/sync-instrumentation.js"), sandbox);
windowObject.BlessERP.offlineSync = { pullDomain: async entities => ({ ok: true, fetchedRows: entities.length, entitiesRequested: entities.length }) };
vm.runInContext(read("scripts/services/sync/domain-loader.js"), sandbox);
for (let index = 0; index < 10; index += 1) {
  await windowObject.BlessERP.domainDataLoader.ensureRoute("commercial-brands");
  windowObject.BlessERP.domainDataLoader.leaveRoute("commercial-brands");
}
assert((listeners.get("erp:lazy-entity-invalidated") || []).length === 1, "Diez mounts acumularon listeners de dominio.");
windowObject.BlessERP.syncInstrumentation.setRealtimeSubscription("route-a", true);
windowObject.BlessERP.syncInstrumentation.setRealtimeSubscription("route-a", true);
assert(windowObject.BlessERP.syncInstrumentation.snapshot().activeRealtimeSubscriptions === 1, "La instrumentación duplicó una suscripción activa.");
windowObject.BlessERP.syncInstrumentation.setRealtimeSubscription("route-a", false);
assert(windowObject.BlessERP.syncInstrumentation.snapshot().activeRealtimeSubscriptions === 0, "La instrumentación no retiró la suscripción al desmontar.");

const repositories = [
  "accounting-portfolio-report-v2-repository.js", "accounting-bank-report-v2-repository.js",
  "accounting-dashboard-read-v2-repository.js", "financial-statements-read-v2-repository.js",
  "accounting-read-v2-repository.js", "payment-collection-read-v2-repository.js",
  "portfolio-read-v2-repository.js", "purchase-invoice-read-v2-repository.js",
  "purchase-withholding-v2-repository.js", "received-withholding-read-repository.js",
  "retention-report-read-v2-repository.js", "supplier-settlement-read-v2-repository.js",
  "treasury-read-v2-repository.js"
].map(file => read(`scripts/repositories/contabilidad/${file}`));
const services = [
  "accounting-portfolio-report-v2.js", "accounting-bank-report-v2.js",
  "accounting-dashboard-read-v2.js", "financial-statements-read-v2.js",
  "accounting-read-v2.js", "payment-collection-read-v2.js", "portfolio-read-v2.js",
  "purchase-invoice-read-v2.js", "purchase-withholding-v2.js",
  "received-withholding-read.js", "retention-report-read-v2.js",
  "supplier-settlement-read-v2.js", "treasury-read-v2.js"
].map(file => read(`scripts/services/${file}`));
assert(repositories.every(source => /function unsubscribe\s*\(/.test(source)), "Un repository Search-First no desuscribe su canal.");
assert(repositories.every(source => /setRealtimeSubscription/.test(source)), "Un repository Search-First no instrumenta su canal.");
assert(services.every(source => /async function stop\s*\(/.test(source)), "Un servicio Search-First no expone lifecycle stop.");
const layout = read("scripts/ui/layout.js");
assert(layout.includes("accountingPortfolioReportV2?.stop") && layout.includes("accountingBankReportV2?.stop") && layout.includes("accountingDashboardReadV2?.stop") && layout.includes("financialStatementsReadV2?.stop"), "Layout no desmonta todos los reportes server-side.");
for (const serviceName of ["accountingReadV2", "portfolioReadV2", "paymentCollectionReadV2", "treasuryReadV2", "purchaseInvoiceReadV2", "purchaseWithholdingV2", "receivedWithholdingRead", "retentionReportReadV2", "supplierSettlementReadV2"]) {
  assert(layout.includes(`${serviceName}?.stop`), `Layout no desmonta ${serviceName}.`);
}

console.log("VALIDACION_REALTIME_LIFECYCLE_OK");
console.log(JSON.stringify({ mounts: 10, domainListeners: 1, searchFirstRepositoriesWithUnsubscribe: repositories.length, searchFirstServicesWithStop: services.length }, null, 2));
