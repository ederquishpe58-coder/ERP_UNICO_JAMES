import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let uidSequence = 0;
const context = {
  console,
  structuredClone,
  window: {
    BlessERP: {
      utils: {
        uid: prefix => `${prefix}-TEMPLATE-${++uidSequence}`,
        today: () => "2026-08-28",
        clone: value => structuredClone(value)
      },
      services: {}
    }
  }
};
context.window.window = context.window;
vm.createContext(context);

function load(relativePath) {
  vm.runInContext(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"), context, { filename: relativePath });
}

load("./scripts/config/bless-accounting-plan-v1.js");
load("./scripts/data/demo.js");
load("./scripts/services/sync/entity-registry.js");

const BlessERP = context.window.BlessERP;
const registry = BlessERP.syncEntityRegistry;
const taxDescriptor = registry.descriptor("accounting_tax_parameters");
const retentionDescriptor = registry.descriptor("accounting_retention_parameters");

assert.equal(taxDescriptor.canonicalAuthority, true);
assert.equal(retentionDescriptor.canonicalAuthority, true);

const initial = BlessERP.demo.createOperationalDatabase();
assert.equal(initial.taxParameters.length, 5);
assert.equal(initial.retentionParameters.length, 20);
assert.equal(registry.snapshot(initial).get(taxDescriptor.entity).size, 0);
assert.equal(registry.snapshot(initial).get(retentionDescriptor.entity).size, 0);

const taxPayloads = [
  {
    id: "IVA_0_VENTAS_FLORES",
    internalCode: "IVA_0_VENTAS_FLORES",
    sriCode: "",
    name: "IVA 0% en ventas de flores, follaje y ramas cortadas",
    taxType: "IVA",
    rate: 0,
    appliesTo: "ventas",
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    status: "activa",
    observation: ""
  },
  {
    id: "IVA_13_COMPRAS_GENERAL",
    internalCode: "IVA_13_COMPRAS_GENERAL",
    sriCode: "",
    name: "IVA general vigente en compras gravadas",
    taxType: "IVA",
    rate: 13,
    appliesTo: "compras",
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    status: "activa",
    observation: ""
  }
];

const retentionPayloads = [
  ["RET_IR_0_332", "332", "Otras compras de bienes y servicios no sujetas a retención", "RENTA", 0, "otros"],
  ["RET_IR_10_HONORARIOS_PN", "", "Retención 10% - honorarios a persona natural residente", "RENTA", 10, "honorarios_persona_natural"],
  ["RET_IR_10_SERVICIOS_INTELECTUALES_PN", "", "Retención 10% - servicios donde prevalece el intelecto, persona natural residente", "RENTA", 10, "servicios_intelectuales_pn"],
  ["RET_IR_3_OTRAS", "", "Retención 3% - otras retenciones aplicables / pagos sin porcentaje específico", "RENTA", 3, "otras_retenciones_aplicables"],
  ["RET_IR_1_PRODUCTOR_AGRICOLA", "", "Retención 1% - compra directa a productor agrícola en estado natural", "RENTA", 1, "productor_agricola_directo"],
  ["RET_IVA_100_EXPORTADOR", "", "Retención IVA 100% - compras sujetas a retención efectuadas como exportador habitual, según caso aplicable", "IVA", 100, "exportador_habitual"]
].map(([id, sriCode, description, taxType, percentage, category]) => ({
  id,
  internalCode: id,
  sriCode,
  description,
  taxType,
  percentage,
  appliesTo: "compras",
  category,
  effectiveFrom: "2026-03-01",
  effectiveTo: "",
  status: "activa",
  observation: ""
}));

function serverRecord(entity, payload, version = 1, deletedAt = null) {
  return {
    company_id: "TEST-COMPANY-TAX-CANONICAL",
    entity,
    record_id: payload.id,
    payload,
    version,
    updated_at: `2026-08-28T00:00:0${Math.min(version, 9)}.000Z`,
    last_operation_id: `TEST-${entity}-${payload.id}-${version}`,
    deleted_at: deletedAt
  };
}

const canonical = BlessERP.demo.createOperationalDatabase();
taxPayloads.forEach(payload => registry.applyServerRecord(
  canonical,
  serverRecord(taxDescriptor.entity, payload),
  { forceServer: true }
));
retentionPayloads.forEach(payload => registry.applyServerRecord(
  canonical,
  serverRecord(retentionDescriptor.entity, payload),
  { forceServer: true }
));

assert.equal(canonical.taxParameters.length, 2);
assert.equal(canonical.retentionParameters.length, 6);
assert.equal(canonical.taxParameters.length + canonical.retentionParameters.length, 8);
assert.equal([...canonical.taxParameters, ...canonical.retentionParameters].every(row => Number(row.__syncVersion) === 1), true);

let saves = 0;
BlessERP.state = { state: { db: canonical }, saveDb: () => { saves += 1; } };
BlessERP.services.companySettings = { settings: () => canonical.companySettings || {} };
BlessERP.services.chartOfAccounts = {
  findByCode: code => canonical.chartOfAccounts.find(row => row.code === code),
  movementOptions: () => []
};
load("./scripts/services/tax-config.js");

assert.equal(canonical.taxParameters.length, 2);
assert.equal(canonical.retentionParameters.length, 6);
assert.equal(saves, 1);

for (const payload of [...taxPayloads, ...retentionPayloads]) {
  const descriptor = taxPayloads.includes(payload) ? taxDescriptor : retentionDescriptor;
  registry.applyServerRecord(canonical, serverRecord(descriptor.entity, payload), { forceServer: true });
}
assert.equal(canonical.taxParameters.length + canonical.retentionParameters.length, 8);

const customPayload = {
  id: "TAX-CUSTOM-TEST-9",
  internalCode: "TAX_CUSTOM_TEST_9",
  sriCode: "",
  name: "Parámetro canónico temporal",
  taxType: "OTRO",
  rate: 0,
  appliesTo: "ambos",
  effectiveFrom: "2026-08-28",
  effectiveTo: "",
  status: "activo",
  observation: "Fixture temporal"
};
registry.applyServerRecord(canonical, serverRecord(taxDescriptor.entity, customPayload), { forceServer: true });
assert.equal(canonical.taxParameters.length + canonical.retentionParameters.length, 9);

delete canonical.taxCatalogVersion;
load("./scripts/services/tax-config.js");
assert.equal(canonical.taxParameters.length + canonical.retentionParameters.length, 9);

registry.applyServerRecord(canonical, serverRecord(
  taxDescriptor.entity,
  customPayload,
  2,
  "2026-08-28T00:10:00.000Z"
), { forceServer: true });
assert.equal(canonical.taxParameters.length + canonical.retentionParameters.length, 8);

const incrementalSource = fs.readFileSync(new URL("./scripts/services/sync/incremental-sync.js", import.meta.url), "utf8");
assert.match(incrementalSource, /descriptor\.canonicalAuthority !== true && !registry\(\)\.isExplicitCaptureReady/);
assert.match(incrementalSource, /shouldPruneOnCanonicalFullSnapshot/);

const emptyCompany = BlessERP.demo.createOperationalDatabase();
assert.equal(emptyCompany.taxParameters.length, 5);
assert.equal(emptyCompany.retentionParameters.length, 20);
assert.equal(registry.snapshot(emptyCompany).get(taxDescriptor.entity).size, 0);
assert.equal(registry.snapshot(emptyCompany).get(retentionDescriptor.entity).size, 0);

console.log(JSON.stringify({
  template: { tax: 5, retentions: 20, syncEligible: 0 },
  canonical: { tax: 2, retentions: 6, total: 8 },
  custom: { total: 9, reload: 9, restored: 8 },
  fullPullCachePrune: true,
  saves
}, null, 2));
