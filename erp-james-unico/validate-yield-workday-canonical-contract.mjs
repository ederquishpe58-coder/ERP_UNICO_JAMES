import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const policy = read("./scripts/config/capability-policy.js");
const state = read("./scripts/modules/operaciones/operaciones-state.js");
const workdaySync = read("./scripts/services/supabase/operations-workday-sync.js");
const yieldsUi = read("./scripts/modules/operaciones/rendimientos.js");
const operationsUi = read("./scripts/modules/operaciones/index.js");
const migration = read("./supabase/migrations/202608300004_yield_workday_canonical_contract.sql");

assert.match(policy, /"operations\.yield_workday": \["manage"\]/);
assert.match(state, /id: uuid\(\)/);
assert.match(state, /workdayId: gate\.workday\.id/);
assert.match(state, /JORNADA_REQUERIDA/);
assert.ok((state.match(/workdayId: gate\.workday\.id/g) || []).length >= 6);
assert.doesNotMatch(workdaySync, /\.from\("operations_workdays"\)/);
assert.doesNotMatch(workdaySync, /operations_workday_pauses/);
assert.match(workdaySync, /CANONICAL_INCREMENTAL/);
assert.match(yieldsUi, /operations\.yield_workday\.manage/);
assert.match(operationsUi, /operations\.yield_workday\.manage/);

for (const fragment of [
  "operations.yield_workday.manage",
  "operations_yield_workday','INSERT'",
  "operations_yield_workday','UPDATE'",
  "erp_yield_active_workday",
  "OPERATIONS_ACTIVE_WORKDAY_REQUIRED",
  "erp_yield_assert_command_workday",
  "ASSIGN_CLASSIFICATION",
  "REGISTER_CLASSIFICATION_RESULT",
  "erp_yield_attach_scanner_workday",
  "OPERATIONS_SCANNER_WORKDAY_MISMATCH",
  "RECEPCIONISTA_P1_GRANTS_CHANGED"
]) assert.ok(migration.includes(fragment), `Missing migration contract: ${fragment}`);

assert.doesNotMatch(migration, /insert into public\.operations_workdays/i);
assert.doesNotMatch(migration, /update public\.operations_workdays/i);
assert.doesNotMatch(migration, /delete from public\.operations_workdays/i);
assert.doesNotMatch(migration, /QUARANTIN|replay/i);

console.log(JSON.stringify({
  capability: "operations.yield_workday.manage",
  canonicalEntity: "operations_yield_workday",
  legacyWriterRemoved: true,
  classificationBackendGate: true,
  scannerBackendGate: true,
  receptionGateAdded: false,
  quarantinedReplay: 0,
  result: "PASS"
}, null, 2));
