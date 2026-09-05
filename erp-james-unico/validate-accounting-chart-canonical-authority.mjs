import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = {
  console,
  structuredClone,
  window: { BlessERP: {} }
};
context.window.window = context.window;
vm.createContext(context);

function load(relativePath) {
  vm.runInContext(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"), context, { filename: relativePath });
}

load("./scripts/config/bless-accounting-plan-v1.js");
load("./scripts/services/sync/entity-registry.js");

const plan = context.window.BlessERP.accountingPlanBlessV1;
const registry = context.window.BlessERP.syncEntityRegistry;
const descriptor = registry.descriptor("accounting_chart_accounts");
const template = plan.createAccounts();

assert.equal(template.length, 172);
assert.equal(registry.snapshot({ chartOfAccounts: template }).get(descriptor.entity).size, 0);

function serverRecord(index, overrides = {}) {
  const id = overrides.id || `ACC-MASTER-${String(index).padStart(3, "0")}`;
  return {
    company_id: "COMP-BLESS-FLOWER",
    entity: descriptor.entity,
    record_id: id,
    payload: {
      id,
      code: overrides.code || `9.${String(index).padStart(3, "0")}`,
      name: overrides.name || `CUENTA CANONICA ${index}`,
      parentCode: "",
      level: 1,
      type: "Activo",
      nature: "Deudora",
      isMovement: true,
      status: "Activa",
      requiresAuxiliary: false,
      acceptsCostCenter: false,
      notes: ""
    },
    version: overrides.version || 1,
    updated_at: overrides.updated_at || "2026-08-28T00:00:00.000Z",
    last_operation_id: overrides.operation_id || `OP-${id}`,
    deleted_at: overrides.deleted_at || null
  };
}

const canonical = { chartOfAccounts: plan.createAccounts(), companySettings: {} };
for (let index = 1; index <= 116; index += 1) {
  registry.applyServerRecord(canonical, serverRecord(index), { forceServer: true });
}
assert.equal(canonical.chartOfAccounts.length, 116);
assert.equal(canonical.chartOfAccounts.every(row => Number(row.__syncVersion) === 1), true);

plan.migrateStore(canonical);
assert.equal(canonical.chartOfAccounts.length, 116);

const contaminatedCache = {
  chartOfAccounts: [...plan.createAccounts(), ...structuredClone(canonical.chartOfAccounts)],
  companySettings: {}
};
plan.migrateStore(contaminatedCache);
assert.equal(contaminatedCache.chartOfAccounts.length, 116);

const custom = serverRecord(117, { id: "ACC-CUSTOM-117", code: "9.117", name: "CUENTA PERSONALIZADA" });
registry.applyServerRecord(canonical, custom, { forceServer: true });
assert.equal(canonical.chartOfAccounts.length, 117);
plan.migrateStore(canonical);
assert.equal(canonical.chartOfAccounts.length, 117);

registry.applyServerRecord(canonical, { ...custom, deleted_at: "2026-08-28T01:00:00.000Z", version: 2 }, { forceServer: true });
assert.equal(canonical.chartOfAccounts.length, 116);
plan.migrateStore(canonical);
assert.equal(canonical.chartOfAccounts.length, 116);

const emptyCompany = { chartOfAccounts: [], companySettings: {} };
plan.migrateStore(emptyCompany);
assert.equal(emptyCompany.chartOfAccounts.length, 172);
assert.equal(registry.snapshot(emptyCompany).get(descriptor.entity).size, 0);

console.log("Canonical accounting chart authority validated: template=172, server=116, custom=117, restored=116, empty bootstrap=172.");
