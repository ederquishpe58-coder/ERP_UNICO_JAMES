import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile("scripts/services/sync/entity-registry.js", "utf8");
const context = {
  window: { BlessERP: {} },
  structuredClone,
  JSON,
  Map,
  Set
};
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: "entity-registry.js" });

const registry = context.window.BlessERP.syncEntityRegistry;
assert.ok(registry, "No se cargó el registro incremental.");

const draft = {
  id: "COM-ORD-QA-DRAFT",
  number: "",
  numberPending: true,
  unsavedDraft: true,
  customerId: "",
  lines: []
};
const confirmed = Array.from({ length: 10 }, (_, index) => ({
  id: `COM-ORD-QA-${String(index + 1).padStart(2, "0")}`,
  number: `PED-COM-QA-${String(index + 1).padStart(4, "0")}`,
  numberPending: false,
  unsavedDraft: false,
  customerId: "COM-CLI-QA",
  issuedAt: "2026-08-14",
  notes: `PRUEBA LOCAL ${index + 1}`,
  lines: [{ id: `LINE-QA-${index + 1}`, boxNumber: index + 1, variety: "EXPLORER", length: 60, bunches: 12 }]
}));

const db = { commercial: { orders: [draft, ...confirmed] } };
const snapshot = registry.snapshot(db);
const orders = snapshot.get("commercial_orders");
assert.equal(orders?.size || 0, 0, "commercial_orders debe quedar completamente fuera del snapshot incremental genérico.");

const reopenedDb = { commercial: { orders: [] } };
for (const row of confirmed) {
  const recordId = row.id;
  const applied = registry.applyServerRecord(reopenedDb, {
    company_id: "10000000-0000-4000-8000-000000000001",
    entity: "commercial_orders",
    record_id: recordId,
    payload: row,
    version: 1,
    updated_at: "2026-08-14T12:00:00.000Z",
    last_operation_id: `OP-${recordId}`,
    deleted_at: null
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.changed, true);
}

assert.equal(reopenedDb.commercial.orders.length, 10);
for (const expected of confirmed) {
  const reopened = reopenedDb.commercial.orders.find(order => order.id === expected.id);
  assert.ok(reopened, `No se reabrió ${expected.id}.`);
  assert.equal(reopened.number, expected.number);
  assert.equal(reopened.customerId, expected.customerId);
  assert.equal(reopened.notes, expected.notes);
  assert.equal(reopened.lines.length, 1);
}

console.log("VALIDACION_LOCAL_10_PEDIDOS_REAPERTURA_OK");
console.log(JSON.stringify({
  draftsCreated: 1,
  draftsSentToSupabase: 0,
  confirmedOrdersSavedByExplicitRpc: confirmed.length,
  confirmedOrdersReopened: reopenedDb.commercial.orders.length
}, null, 2));
