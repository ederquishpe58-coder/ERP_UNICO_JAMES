import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./scripts/modules/operaciones/parametros-poscosecha.js", import.meta.url), "utf8");
const operationsIndex = fs.readFileSync(new URL("./scripts/modules/operaciones/index.js", import.meta.url), "utf8");
const companyId = "10000000-0000-4000-8000-000000000001";
let reads = 0;
let writes = 0;
let payrollLoads = 0;
let renderedPages = 0;

const capabilities = new Set([
  "operations.parameters.view",
  "operations.farms_blocks.manage",
  "operations.varieties.manage"
]);
const store = {
  ui: {
    parameterType: "suppliers",
    parameterDraft: {
      id: "legacy-local-draft", type: "suppliers", code: "LOCAL", name: "Proveedores",
      assignedBlock: "", observation: "Borrador anterior", active: true
    }
  },
  masterData: { suppliers: [], varieties: [] }
};
const routeState = { route: "operations-varieties" };
const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const repository = {
  activeCompanyId: () => companyId,
  isCanonicalEditableType: type => ["suppliers", "varieties"].includes(String(type)),
  async list() { reads += 1; return { ok: true, rows: [], total: 0, page: 1, pageSize: 25 }; },
  async save(type, draft) {
    writes += 1;
    return {
      ok: true,
      record: {
        ...structuredClone(draft),
        id: draft.id || `${type === "suppliers" ? "FARM" : "VAR"}-NEW`,
        type,
        __syncVersion: Number(draft.__syncVersion || 0) + 1
      }
    };
  }
};

const objectUrls = new Set();
const TestURL = {
  createObjectURL(file) { const url = `blob:test/${file.name}`; objectUrls.add(url); return url; },
  revokeObjectURL(url) { objectUrls.delete(url); }
};
const imageRepository = {
  publicUrl: path => `https://storage.example/${path}`,
  validateImageFile: file => file?.type === "image/png"
    ? { ok: true }
    : { ok: false, message: "Formato no permitido." }
};

const context = {
  console, Date, Intl, AbortController, File, URL: TestURL, queueMicrotask,
  setTimeout, clearTimeout, structuredClone,
  window: {
    addEventListener() {}, clearTimeout, setTimeout,
    BlessERP: {
      state: { state: routeState },
      capabilityRuntime: { can: capability => capabilities.has(capability) },
      layout: { renderPage: () => { renderedPages += 1; }, toast() {} },
      performance: { invalidateCache() {} },
      services: {
        payrollV2: {
          snapshot: () => ({ employees: [], operationalRoles: [] }),
          health: async () => { payrollLoads += 1; return { ok: true }; },
          refresh: async () => ({ ok: true })
        }
      },
      operacionesData: {
        createParameterDraft: seed => ({
          id: "", type: "suppliers", code: "", name: "", assignedBlock: "", labelColor: "",
          active: true, observation: "", ...seed
        })
      },
      operacionesState: {
        getStore: () => store, getUi: () => store.ui, setNotice() {}, syncCatalogsFromMasterData() {}
      },
      operacionesUtils: {
        esc: escapeHtml, number: value => String(value),
        renderPageHeader: (_route, badge, _tone, description) => `<header><span>${escapeHtml(badge)}</span><p>${escapeHtml(description)}</p></header>`,
        renderTabs: () => "", renderNotice: () => "", renderSummaryCards: () => "SHOULD_NOT_RENDER"
      },
      getPostharvestParameterQueryRepository: () => repository,
      getVarietyImageRepository: () => imageRepository
    }
  }
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "parametros-poscosecha.js" });
const module = context.window.BlessERP.operacionesParametros;
const fakeContainer = { querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };

let html = module.render(routeState, { id: "operations-varieties" });
assert.equal(store.ui.parameterDraft.type, "varieties");
assert.equal(store.ui.parameterDraft.id, "");
assert.match(html, /<h3>Nueva variedad<\/h3>/);
assert.match(html, /Nombre de variedad/);
assert.match(html, /Fotografía opcional/);
assert.match(html, /Seleccionar foto/);
assert.match(html, /data-ops-variety-image-input/);
assert.match(html, />GUARDAR<\/button>/);
assert.doesNotMatch(html, /data-ops-parameter-query-form/);
assert.doesNotMatch(html, /CONSULTAR \/ EDITAR|HISTORIAL INDIVIDUAL|SHOULD_NOT_RENDER/);
assert.doesNotMatch(html, /<select[^>]+data-field="type"/);
assert.equal(reads, 0);
assert.equal(writes, 0);

module.mount(fakeContainer, routeState);
await Promise.resolve();
assert.equal(payrollLoads, 0);
assert.equal(reads, 0, "Abrir la ruta no debe consultar.");
assert.equal(writes, 0, "Abrir la ruta no debe escribir.");

store.ui.parameterDraft.code = "VAR-NEW";
store.ui.parameterDraft.name = "Variedad nueva";
store.ui.parameterDraft.observation = "Ingreso manual";
const photo = new File([new Uint8Array([137, 80, 78, 71])], "variedad.png", { type: "image/png" });
assert.equal(module.stagePendingVarietyImage(photo).ok, true);
html = module.render(routeState, { id: "operations-varieties" });
assert.match(html, /variedad\.png/);
assert.match(html, /Reemplazar foto/);
const varietySave = await module.saveCanonicalParameter(routeState, "varieties", { keepDraft: true });
assert.equal(varietySave.ok, true);
assert.equal(varietySave.record.id, "VAR-NEW");
assert.equal(module.pendingVarietyImage().file, photo);
module.clearPendingVarietyImage();
module.resetCanonicalDraft(routeState, "varieties");
assert.equal(objectUrls.size, 0);

routeState.route = "operations-farms-blocks";
html = module.render(routeState, { id: "operations-farms-blocks" });
assert.equal(store.ui.parameterDraft.type, "suppliers");
assert.match(html, /<h3>Nueva finca \/ bloque<\/h3>/);
assert.match(html, /Nombre de finca \/ proveedor/);
assert.match(html, /Bloque asignado/);
assert.match(html, />GUARDAR<\/button>/);
assert.doesNotMatch(html, /data-ops-parameter-query-form/);
assert.doesNotMatch(html, /CONSULTAR \/ EDITAR|HISTORIAL INDIVIDUAL/);
store.ui.parameterDraft.code = "FARM-NEW";
store.ui.parameterDraft.name = "Finca nueva";
store.ui.parameterDraft.assignedBlock = "B99";
const farmSave = await module.saveCanonicalParameter(routeState, "suppliers");
assert.equal(farmSave.ok, true);
assert.equal(farmSave.record.id, "FARM-NEW");

assert.match(operationsIndex, /pendingVarietyImage/);
assert.match(operationsIndex, /keepDraft: Boolean\(pendingImage\)/);
assert.match(operationsIndex, /uploadParameterVarietyImage\(appState, pendingImage\)/);
assert.match(source, /catalogRepository\(\)\.save\(type, store\.ui\.parameterDraft/);
assert.doesNotMatch(source, /saveDb\(/);

process.stdout.write(`${JSON.stringify({
  result: "PASS",
  varieties: { manualInsert: true, imageOptionalBeforeSave: true, canonicalId: varietySave.record.id },
  farmsBlocks: { manualInsert: true, canonicalId: farmSave.record.id },
  routeOpenReads: 0,
  routeOpenWrites: 0,
  canonicalWrites: writes,
  genericSelectorVisible: false,
  genericHistoryVisible: false,
  payrollLoads,
  rendersTriggered: renderedPages
}, null, 2)}\n`);
