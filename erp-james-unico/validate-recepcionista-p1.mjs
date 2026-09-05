import fs from "node:fs";

const profileMigration = fs.readFileSync(
  new URL("./supabase/migrations/202608300002_recepcionista_p1_profile.sql", import.meta.url),
  "utf8"
);
const operationsState = fs.readFileSync(
  new URL("./scripts/modules/operaciones/operaciones-state.js", import.meta.url),
  "utf8"
);

const expected = [
  "operations.parameters.view",
  "operations.farms_blocks.manage",
  "operations.varieties.manage",
  "operations.reception.view",
  "operations.reception.create",
  "operations.reception.edit",
  "operations.classification.view",
  "operations.classification.record",
  "operations.classification.edit"
];

const forbidden = [
  "operations.parameters.manage",
  "operations.reception.cancel",
  "operations.inventory.view",
  "admin.users.view",
  "commercial.orders.view",
  "accounting.chart.view"
];

const errors = [];
const explicitMatrix = profileMigration.match(
  /insert into pg_temp\.recepcionista_p1_expected_capabilities\(capability_id\)\s*values([\s\S]*?);/i
)?.[1] || "";
expected.forEach(capability => {
  if (!explicitMatrix.includes(`('${capability}')`)) {
    errors.push(`Falta capability explícita: ${capability}`);
  }
});
forbidden.forEach(capability => {
  if (explicitMatrix.includes(`('${capability}')`)) {
    errors.push(`Capability no permitida concedida: ${capability}`);
  }
});

if (!operationsState.includes('capabilityRuntime?.can?.("operations.classification.edit") === true')) {
  errors.push("El historial de clasificación no respeta operations.classification.edit.");
}
if (!operationsState.includes("canAnnulProcessedMeshHistory")) {
  errors.push("La anulación legacy no quedó separada de la edición autorizada.");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("RECEPCIONISTA_P1 VALIDATOR = PASS");
console.log(`SELECTED CAPABILITIES = ${expected.length}`);
console.log("UNEXPECTED CAPABILITIES = 0");
console.log("HISTORY EDIT GUARD = operations.classification.edit");
