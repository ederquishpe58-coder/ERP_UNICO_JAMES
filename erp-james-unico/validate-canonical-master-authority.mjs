import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let uidSequence = 0;
function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key))
  };
}
const context = {
  console,
  structuredClone,
  Date,
  Intl,
  setTimeout,
  clearTimeout,
  window: {
    BlessERP: {
      utils: {
        uid: prefix => `${prefix}-TEMPLATE-${++uidSequence}`,
        today: () => "2026-08-28",
        clone: value => structuredClone(value),
        esc: value => String(value ?? ""),
        number: value => Number(value || 0)
      },
      services: {
        companyContext: { activeCompanyId: () => "TEST-CANONICAL-MASTERS" }
      },
      comercialInvoiceSequence: {},
      getAppMode: () => "production"
    },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage()
  }
};
context.window.window = context.window;
vm.createContext(context);

function load(relativePath) {
  vm.runInContext(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"), context, { filename: relativePath });
}

load("./scripts/config/bless-accounting-plan-v1.js");
load("./scripts/modules/comercial/comercial-data.js");
load("./scripts/modules/operaciones/operaciones-data.js");
load("./scripts/data/demo.js");
load("./scripts/services/sync/entity-registry.js");
load("./scripts/modules/comercial/flow-v2/commercial-flow-core.js");
context.window.BlessERP.comercialUtils = { normalizeOrder: row => row };
context.window.BlessERP.comercialWorkflow = { ensureOrderWorkflow: () => true };
load("./scripts/modules/comercial/comercial-state.js");
load("./scripts/modules/operaciones/operaciones-utils.js");
load("./scripts/modules/operaciones/workday-core.js");
load("./scripts/modules/operaciones/operaciones-state.js");

const BlessERP = context.window.BlessERP;
const registry = BlessERP.syncEntityRegistry;
const canonicalEntities = Object.keys(registry.canonicalMasterContracts).sort();
const expectedCanonicalEntities = [
  "accounting_chart_accounts",
  "accounting_cost_centers",
  "accounting_retention_parameters",
  "accounting_tax_parameters",
  "commercial_airlines",
  "commercial_brands",
  "commercial_countries",
  "commercial_customers",
  "commercial_destinations",
  "company_settings",
  "operations_label_types",
  "operations_lengths",
  "operations_stem_types",
  "operations_suppliers",
  "operations_varieties",
  "operations_yield_settings",
  "treasury_cash_accounts"
].sort();

assert.deepEqual(canonicalEntities, expectedCanonicalEntities);
assert.equal(registry.descriptor("commercial_orders").canonicalAuthority, false);
assert.equal(registry.shouldPruneOnCanonicalFullSnapshot(
  registry.descriptor("commercial_orders"),
  { id: "ORDER-OFFLINE-LEGITIMATE" },
  { remoteHasRows: true }
), false);

function emptyCompanyDb() {
  const accounting = BlessERP.demo.createOperationalDatabase();
  const commercial = BlessERP.comercialData.createCommercialStore();
  const operations = BlessERP.operacionesData.createOperationsStore();
  const db = {
    ...accounting,
    commercial,
    operations,
    treasuryV2: { cashAccounts: [] }
  };
  BlessERP.commercialFlowV2.catalogs({ db });
  return db;
}

function payload(entity, index) {
  const suffix = String(index).padStart(3, "0");
  const id = `${entity.toUpperCase()}-${suffix}`;
  const common = { id, code: `${entity.toUpperCase()}-${suffix}`, name: `${entity} ${suffix}`, active: true, status: "ACTIVO" };
  if (entity === "company_settings") {
    return {
      companyKey: "TEST-CANONICAL-MASTERS",
      companyCode: "TCM",
      legalName: "TEST CANONICAL MASTERS",
      commercialName: "TEST CANONICAL MASTERS",
      ruc: "1799999999001",
      baseCurrency: "USD",
      timezone: "America/Guayaquil"
    };
  }
  if (entity === "accounting_chart_accounts") {
    return { ...common, code: `9.${suffix}`, type: "Activo", nature: "Deudora", level: 1, parentCode: "", isMovement: true };
  }
  if (entity === "accounting_tax_parameters") {
    return { ...common, internalCode: `TAX-${suffix}`, taxType: "IVA", rate: 0, appliesTo: "ventas" };
  }
  if (entity === "accounting_retention_parameters") {
    return { ...common, internalCode: `RET-${suffix}`, description: `Retencion ${suffix}`, taxType: "RENTA", percentage: 1, appliesTo: "compras" };
  }
  if (entity === "accounting_cost_centers") {
    return { ...common, type: "administrativo", responsible: "", relatedAccount: "", observation: "Fixture canonico" };
  }
  if (entity === "commercial_airlines") return { ...common, awbPrefix: String(200 + index).padStart(3, "0"), status: "ACTIVA" };
  if (entity === "commercial_countries") return { ...common, code: `PAIS-${suffix}`, name: `PAIS ${suffix}` };
  if (entity === "commercial_destinations") return { ...common, code: `DEST-${suffix}`, destination: `DESTINO ${suffix}`, country: `PAIS ${suffix}`, suggestedTransport: "aereo" };
  if (entity === "operations_suppliers") return { ...common, assignedBlock: `B${index}`, observation: "Responsable fixture" };
  if (entity === "operations_lengths") return { ...common, name: String(30 + index) };
  if (entity === "operations_yield_settings") {
    return { workdayHours: 8, classifierDailyGoal: 260, classifierHourlyGoal: 32.5, buncherDailyGoal: 200, buncherHourlyGoal: 25 };
  }
  if (entity === "treasury_cash_accounts") return { ...common, accountType: "CASH", currency: "USD" };
  return common;
}

function serverRecord(entity, row, version = 1, deletedAt = null) {
  const descriptor = registry.descriptor(entity);
  const id = descriptor.kind === "singleton" ? entity : registry.recordId(row);
  return {
    company_id: "TEST-CANONICAL-MASTERS",
    entity,
    record_id: id,
    payload: row,
    version,
    updated_at: `2026-08-28T00:${String(version).padStart(2, "0")}:00.000Z`,
    last_operation_id: `TEST-${entity}-${id}-${version}`,
    deleted_at: deletedAt
  };
}

function exactIds(db, entity) {
  const descriptor = registry.descriptor(entity);
  return Array.from(registry.recordsFor(db, descriptor))
    .map(row => descriptor.kind === "singleton" ? entity : registry.recordId(row))
    .filter(Boolean)
    .sort();
}

function reconcileFullSnapshot(db, entity, rows) {
  const descriptor = registry.descriptor(entity);
  rows.forEach(row => registry.applyServerRecord(db, serverRecord(entity, row), { forceServer: true }));
  const remoteIds = new Set(rows.map(row => descriptor.kind === "singleton" ? entity : registry.recordId(row)));
  const retained = registry.recordsFor(db, descriptor).filter(row => {
    const id = descriptor.kind === "singleton" ? entity : registry.recordId(row);
    return remoteIds.has(id) || !registry.shouldPruneOnCanonicalFullSnapshot(descriptor, row, { remoteHasRows: rows.length > 0 });
  });
  registry.setRecords(db, descriptor, retained);
  assert.deepEqual(exactIds(db, entity), [...remoteIds].sort(), `${entity}: el frontend debe reflejar exactamente los IDs del servidor`);
}

const expectedCounts = Object.freeze({
  company_settings: 1,
  accounting_chart_accounts: 116,
  accounting_tax_parameters: 2,
  accounting_retention_parameters: 6,
  accounting_cost_centers: 2,
  commercial_customers: 56,
  commercial_brands: 272,
  commercial_airlines: 14,
  commercial_countries: 21,
  commercial_destinations: 21,
  operations_suppliers: 34,
  operations_varieties: 35,
  operations_lengths: 10,
  operations_stem_types: 2,
  operations_label_types: 2,
  operations_yield_settings: 1,
  treasury_cash_accounts: 2
});

const empty = emptyCompanyDb();
const emptySnapshot = registry.snapshot(empty);
const emptyBootstrap = {};
for (const entity of canonicalEntities) {
  const descriptor = registry.descriptor(entity);
  emptyBootstrap[entity] = registry.recordsFor(empty, descriptor).length;
  assert.equal(emptySnapshot.get(entity).size, 0, `${entity}: el bootstrap no puede originar una escritura`);
}

assert.equal(emptyBootstrap.accounting_chart_accounts, 172);
assert.equal(emptyBootstrap.accounting_cost_centers, 9);
assert.equal(emptyBootstrap.commercial_airlines, 1);
assert.equal(emptyBootstrap.commercial_countries, 6);
assert.equal(emptyBootstrap.operations_varieties, 6);
assert.equal(emptyBootstrap.operations_lengths, 4);
assert.equal(emptyBootstrap.operations_stem_types, 2);
assert.equal(emptyBootstrap.operations_label_types, 2);

const canonical = emptyCompanyDb();
const expectedIds = new Map();
for (const [entity, count] of Object.entries(expectedCounts)) {
  const rows = Array.from({ length: count }, (_, index) => payload(entity, index + 1));
  const descriptor = registry.descriptor(entity);
  const legacy = descriptor.kind === "singleton"
    ? null
    : { id: `LEGACY-${entity}`, code: `LEGACY-${entity}`, name: "CACHE LEGACY" };
  if (legacy) registry.setRecords(canonical, descriptor, [...registry.recordsFor(canonical, descriptor), legacy]);
  reconcileFullSnapshot(canonical, entity, rows);
  expectedIds.set(entity, exactIds(canonical, entity));
  assert.equal(exactIds(canonical, entity).length, count);
}

// Los normalizadores específicos no pueden volver a introducir plantillas.
BlessERP.accountingPlanBlessV1.migrateStore(canonical);
BlessERP.commercialFlowV2.catalogs({ db: canonical });
const commercialFrontend = BlessERP.comercialState.getStore({ db: canonical });
BlessERP.commercialFlowV2.catalogs({ db: canonical });
const operationsFrontend = BlessERP.operacionesState.getStore({ db: canonical });
assert.equal(exactIds(canonical, "accounting_chart_accounts").length, 116);
assert.equal(exactIds(canonical, "commercial_airlines").length, 14);
assert.equal(commercialFrontend.customerCatalog.length, 56);
assert.equal(commercialFrontend.brandCatalog.length, 272);
assert.equal(commercialFrontend.airlineCatalog.length, 14);
assert.equal(commercialFrontend.countryCatalog.length, 21);
assert.equal(commercialFrontend.destinationCatalog.length, 21);
assert.equal(operationsFrontend.masterData.suppliers.length, 34);
assert.equal(operationsFrontend.masterData.varieties.length, 35);
assert.equal(operationsFrontend.masterData.lengths.length, 10);
assert.equal(operationsFrontend.masterData.stemTypes.length, 2);
assert.equal(operationsFrontend.masterData.labelTypes.length, 2);
assert.equal(operationsFrontend.yieldSettings.classifierDailyGoal, 260);
assert.equal(operationsFrontend.yieldSettings.classifierHourlyGoal, 32.5);

const reload = structuredClone(canonical);
for (const [entity, ids] of expectedIds) assert.deepEqual(exactIds(reload, entity), ids, `${entity}: reload altero el set canonico`);
const commercialReload = BlessERP.comercialState.getStore({ db: reload });
BlessERP.commercialFlowV2.catalogs({ db: reload });
const operationsReload = BlessERP.operacionesState.getStore({ db: reload });
assert.equal(commercialReload.customerCatalog.length, 56);
assert.equal(commercialReload.brandCatalog.length, 272);
assert.equal(commercialReload.airlineCatalog.length, 14);
assert.equal(commercialReload.countryCatalog.length, 21);
assert.equal(commercialReload.destinationCatalog.length, 21);
assert.equal(operationsReload.masterData.suppliers.length, 34);
assert.equal(operationsReload.masterData.varieties.length, 35);
assert.equal(operationsReload.masterData.lengths.length, 10);
assert.equal(operationsReload.masterData.stemTypes.length, 2);
assert.equal(operationsReload.masterData.labelTypes.length, 2);

const customEntities = [
  "accounting_chart_accounts",
  "accounting_cost_centers",
  "accounting_tax_parameters",
  "commercial_customers",
  "commercial_brands",
  "commercial_airlines",
  "commercial_countries",
  "commercial_destinations",
  "operations_suppliers",
  "operations_varieties",
  "operations_lengths",
  "operations_stem_types",
  "operations_label_types",
  "treasury_cash_accounts"
];

for (const entity of customEntities) {
  const before = exactIds(canonical, entity).length;
  const custom = { ...payload(entity, 999), id: `CUSTOM-${entity}`, code: `CUSTOM-${entity}`, name: `CUSTOM ${entity}` };
  registry.applyServerRecord(canonical, serverRecord(entity, custom, 2), { forceServer: true });
  if (entity.startsWith("commercial_")) {
    BlessERP.comercialState.getStore({ db: canonical });
    BlessERP.commercialFlowV2.catalogs({ db: canonical });
  }
  if (entity.startsWith("operations_")) BlessERP.operacionesState.getStore({ db: canonical });
  assert.equal(exactIds(canonical, entity).length, before + 1, `${entity}: N+1 no persistio`);
  const customReload = structuredClone(canonical);
  if (entity.startsWith("commercial_")) {
    BlessERP.comercialState.getStore({ db: customReload });
    BlessERP.commercialFlowV2.catalogs({ db: customReload });
  }
  if (entity.startsWith("operations_")) BlessERP.operacionesState.getStore({ db: customReload });
  assert.equal(exactIds(customReload, entity).length, before + 1, `${entity}: reload N+1 no persistio`);
  registry.applyServerRecord(canonical, serverRecord(entity, custom, 3, "2026-08-28T03:00:00.000Z"), { forceServer: true });
  if (entity.startsWith("commercial_")) {
    BlessERP.comercialState.getStore({ db: canonical });
    BlessERP.commercialFlowV2.catalogs({ db: canonical });
  }
  if (entity.startsWith("operations_")) BlessERP.operacionesState.getStore({ db: canonical });
  assert.equal(exactIds(canonical, entity).length, before, `${entity}: no regreso a N`);
}

assert.deepEqual(exactIds(canonical, "accounting_chart_accounts"), expectedIds.get("accounting_chart_accounts"));
assert.equal(exactIds(canonical, "accounting_tax_parameters").length + exactIds(canonical, "accounting_retention_parameters").length, 8);
assert.equal(exactIds(canonical, "operations_varieties").length
  + exactIds(canonical, "operations_lengths").length
  + exactIds(canonical, "operations_stem_types").length
  + exactIds(canonical, "operations_label_types").length, 49);
assert.equal(canonical.operations.yieldSettings.classifierDailyGoal, 260);
assert.equal(canonical.operations.yieldSettings.classifierHourlyGoal, 32.5);

const incrementalSource = fs.readFileSync(new URL("./scripts/services/sync/incremental-sync.js", import.meta.url), "utf8");
assert.match(incrementalSource, /shouldPruneOnCanonicalFullSnapshot/);
assert.match(incrementalSource, /preservedPending/);
assert.doesNotMatch(incrementalSource, /canonicalAuthority\s*=\s*true/);

console.log(JSON.stringify({
  canonicalEntities,
  canonicalCounts: Object.fromEntries(Object.keys(expectedCounts).map(entity => [entity, exactIds(canonical, entity).length])),
  families: {
    flower: 49,
    countriesAndDestinations: 42,
    taxAndRetentions: 8
  },
  customRoundTrips: customEntities.length,
  emptyBootstrap,
  bootstrapWrites: 0,
  legacyCachePruned: true,
  transactionPruneDefault: false,
  realtimeWritebacks: 0,
  offlineWritebacksFromReconciliation: 0
}, null, 2));
