import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./scripts/modules/operaciones/parametros-poscosecha.js", import.meta.url), "utf8");
const listeners = new Map();
class HarnessFormData {
  constructor(form) { this.form = form; }
  get(name) { return this.form.values[name] ?? null; }
}
const window = {
  BlessERP: {
    state: { state: { currentRoute: "operations-parameters" } }
  },
  addEventListener(type, listener) { listeners.set(type, listener); },
  clearTimeout() {},
  setTimeout() { return 1; }
};

vm.runInNewContext(source, {
  window,
  URL: { revokeObjectURL() {}, createObjectURL() { return ""; } },
  AbortController,
  FormData: HarnessFormData,
  queueMicrotask() {}
});

const parameters = window.BlessERP.operacionesParametros;
assert.ok(parameters, "POSTHARVEST_PARAMETERS_RUNTIME_MISSING");
assert.equal(parameters.isParameterRoute(), true, "CURRENT_ROUTE_GUARD_NOT_RESOLVED");
assert.equal(parameters.isParameterRoute("operations-parameters"), true, "GENERIC_PARAMETER_ROUTE_NOT_ALLOWED");
assert.equal(parameters.isParameterRoute("operations-farms-blocks"), true, "FARMS_BLOCKS_ROUTE_NOT_ALLOWED");
assert.equal(parameters.isParameterRoute("operations-varieties"), true, "VARIETIES_ROUTE_NOT_ALLOWED");
assert.equal(parameters.isParameterRoute("accounting-dashboard"), false, "UNRELATED_ROUTE_ALLOWED");

window.BlessERP.state.state.currentRoute = "operations-farms-blocks";
assert.equal(parameters.isParameterRoute(), true, "FARMS_BLOCKS_CURRENT_ROUTE_NOT_RESOLVED");
window.BlessERP.state.state.currentRoute = "operations-varieties";
assert.equal(parameters.isParameterRoute(), true, "VARIETIES_CURRENT_ROUTE_NOT_RESOLVED");
window.BlessERP.state.state.currentRoute = "";
window.BlessERP.state.state.route = "operations-parameters";
assert.equal(parameters.isParameterRoute(), true, "LEGACY_ROUTE_FALLBACK_NOT_RESOLVED");

assert.match(source, /data-ops-parameter-query-form/);
assert.match(source, /void queryCatalog\(1, event\.currentTarget\)/);
assert.match(source, /!payrollUi\.loading && !payrollUi\.error/);
assert.doesNotMatch(source, /routeId = BlessERP\.state\?\.state\?\.route/);

const types = ["suppliers", "classifiers", "bunchers", "receptionists", "digitizers", "scanners", "responsibles", "varieties", "lengths", "stemTypes", "labelTypes"];
const repositoryCalls = [];
window.BlessERP.getPostharvestParameterQueryRepository = () => ({
  normalizePageSize: value => Number(value || 25),
  async list(filters) {
    repositoryCalls.push({ ...filters });
    return {
      ok: true,
      rows: [{ id: `CANONICAL-${filters.type}`, type: filters.type, name: filters.type, active: true }],
      total: 1,
      page: 1,
      pageSize: Number(filters.pageSize || 25),
      elapsedMs: 1,
      payloadBytes: 64
    };
  }
});
window.BlessERP.layout = { renderPage() {}, toast() {} };
window.BlessERP.operacionesState = { getStore: () => ({ ui: { parameterDraft: {} }, masterData: {} }) };

let submitListener = null;
const form = {
  values: { type: "varieties", search: "", status: "TODOS", pageSize: "25" },
  addEventListener(type, listener) { if (type === "submit") submitListener = listener; }
};
const container = {
  querySelector(selector) { return selector === "[data-ops-parameter-query-form]" ? form : null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};
parameters.mount(container, window.BlessERP.state.state);
assert.equal(typeof submitListener, "function", "CONSULT_SUBMIT_HANDLER_NOT_BOUND");

for (const type of types) {
  form.values.type = type;
  let prevented = false;
  submitListener({ preventDefault() { prevented = true; }, currentTarget: form });
  await new Promise(resolve => setImmediate(resolve));
  const state = parameters.queryState();
  assert.equal(prevented, true, `${type}_SUBMIT_NOT_PREVENTED`);
  assert.equal(state.queried, true, `${type}_NOT_QUERIED`);
  assert.equal(state.loading, false, `${type}_QUERY_STILL_LOADING`);
  assert.equal(state.type, type, `${type}_TYPE_MAPPING_MISMATCH`);
  assert.equal(state.total, 1, `${type}_TOTAL_MISMATCH`);
  assert.equal(state.rows[0]?.id, `CANONICAL-${type}`, `${type}_CANONICAL_ID_MISMATCH`);
}
assert.deepEqual(repositoryCalls.map(call => call.type), types, "ELEVEN_CATALOG_QUERY_SET_MISMATCH");
assert.ok(repositoryCalls.every(call => call.status === "TODOS" && call.search === ""), "CONSULT_FILTER_MAPPING_MISMATCH");

console.log("POSTHARVEST CONSULT ROUTE VALIDATION: PASS");
