import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./scripts/modules/operaciones/parametros-poscosecha.js', import.meta.url), 'utf8');
const operationsIndex = fs.readFileSync(new URL('./scripts/modules/operaciones/index.js', import.meta.url), 'utf8');
const companyId = '10000000-0000-4000-8000-000000000001';
const canonicalRows = {
  suppliers: Array.from({ length: 34 }, (_, index) => ({
    id: `farm-${index + 1}`,
    code: `FARM-${String(index + 1).padStart(3, '0')}`,
    name: `Finca ${index + 1}`,
    assignedBlock: `B${index + 1}`,
    observation: `Bloque canónico ${index + 1}`,
    active: true,
    type: 'suppliers',
    __syncVersion: 1,
  })),
  varieties: Array.from({ length: 35 }, (_, index) => ({
    id: `variety-${index + 1}`,
    code: `VAR-${String(index + 1).padStart(3, '0')}`,
    name: `Variedad ${index + 1}`,
    observation: `Variedad canónica ${index + 1}`,
    imagePath: index === 0 ? `${companyId}/variety-1/photo.webp` : '',
    active: true,
    type: 'varieties',
    __syncVersion: 1,
  })),
};

let reads = 0;
let writes = 0;
let payrollLoads = 0;
let renderedPages = 0;
const capabilities = new Set([
  'operations.parameters.view',
  'operations.farms_blocks.manage',
  'operations.varieties.manage',
]);
const store = {
  ui: {
    parameterType: 'suppliers',
    parameterDraft: {
      id: 'legacy-local-draft',
      type: 'suppliers',
      code: 'LOCAL',
      name: 'Proveedores',
      assignedBlock: '',
      observation: 'Borrador anterior',
      active: true,
    },
  },
  masterData: { suppliers: [], varieties: [] },
};
const routeState = { route: 'operations-varieties' };
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const repository = {
  activeCompanyId: () => companyId,
  normalizePageSize: value => Number(value) === 50 ? 50 : 25,
  isCanonicalEditableType: type => ['suppliers', 'varieties'].includes(String(type)),
  list: async ({ type, page, pageSize }) => {
    reads += 1;
    const allRows = canonicalRows[type] || [];
    const from = (page - 1) * pageSize;
    return {
      ok: true,
      rows: structuredClone(allRows.slice(from, from + pageSize)),
      total: allRows.length,
      page,
      pageSize,
      elapsedMs: 2,
      payloadBytes: 1024,
    };
  },
  save: async (type, draft) => {
    writes += 1;
    return { ok: true, record: { ...structuredClone(draft), type, __syncVersion: Number(draft.__syncVersion || 1) + 1 } };
  },
  publicUrl: path => `https://storage.example/${path}`,
};

const context = {
  console,
  Date,
  Intl,
  AbortController,
  queueMicrotask,
  setTimeout,
  clearTimeout,
  structuredClone,
  window: {
    addEventListener() {},
    clearTimeout,
    setTimeout,
    BlessERP: {
      state: { state: routeState },
      capabilityRuntime: { can: capability => capabilities.has(capability) },
      layout: {
        renderPage: () => { renderedPages += 1; },
        toast() {},
      },
      performance: { invalidateCache() {} },
      services: {
        payrollV2: {
          snapshot: () => ({ employees: [], operationalRoles: [] }),
          health: async () => { payrollLoads += 1; return { ok: true }; },
          refresh: async () => ({ ok: true }),
        },
      },
      operacionesData: {
        createParameterDraft: seed => ({
          id: '', type: 'suppliers', code: '', name: '', assignedBlock: '', labelColor: '',
          active: true, observation: '', ...seed,
        }),
      },
      operacionesState: {
        getStore: () => store,
        getUi: () => store.ui,
        setNotice() {},
        syncCatalogsFromMasterData() {},
      },
      operacionesUtils: {
        esc: escapeHtml,
        number: value => String(value),
        renderPageHeader: (_route, badge, _tone, description) => `<header><span>${escapeHtml(badge)}</span><p>${escapeHtml(description)}</p></header>`,
        renderTabs: () => '',
        renderNotice: () => '',
        renderSummaryCards: cards => `<div>${cards.map(card => `<span>${escapeHtml(card.label)}:${escapeHtml(card.value)}</span>`).join('')}</div>`,
      },
      getPostharvestParameterQueryRepository: () => repository,
      getVarietyImageRepository: () => ({ publicUrl: repository.publicUrl }),
    },
  },
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'parametros-poscosecha.js' });
const module = context.window.BlessERP.operacionesParametros;
const rowCount = html => (html.match(/data-ops-parameter-query-row/g) || []).length;
const fakeContainer = {
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener() {},
};

let html = module.render(routeState, { id: 'operations-varieties' });
assert.equal(store.ui.parameterDraft.type, 'varieties', 'the top draft must follow the explicit varieties route');
assert.equal(store.ui.parameterDraft.id, '', 'a draft from another catalog must not leak into varieties');
assert.equal(reads, 0, 'opening varieties must not query the backend');
assert.equal(writes, 0, 'opening varieties must not write');
assert.equal(rowCount(html), 0, 'the initial route must remain unqueried');
assert.match(html, /data-ops-context-type="varieties"/);
assert.match(html, /<h3>Nueva variedad<\/h3>/);
assert.match(html, /<h3>Variedades<\/h3>/);
assert.match(html, /Nombre de variedad/);
assert.match(html, /Subir imagen/);
assert.match(html, /data-ops-variety-image-input/);
assert.match(html, /value="varieties"/);
assert.doesNotMatch(html, /<select[^>]+data-field="type"/);
assert.doesNotMatch(html, /<select[^>]+name="type"/);
assert.doesNotMatch(html, /Local\/demo/i);

module.mount(fakeContainer, routeState);
await Promise.resolve();
assert.equal(payrollLoads, 0, 'the contextual route must not preload Payroll');
assert.equal(reads, 0, 'mounting varieties must remain query-free');
assert.equal(writes, 0, 'mounting varieties must remain write-free');

await module.queryCatalog(1);
html = module.render(routeState, { id: 'operations-varieties' });
assert.equal(module.queryState().total, 35);
assert.equal(rowCount(html), 25, 'server pagination must render only the first page');
assert.match(html, /Resultados:35/);
assert.match(html, /Nombre de variedad/);
assert.doesNotMatch(html, /Empleado vinculado/);

const variety = module.queryState().rows[0];
assert.equal(module.editCanonicalParameter(routeState, 'varieties', variety.id), true);
html = module.render(routeState, { id: 'operations-varieties' });
assert.equal(store.ui.parameterDraft.id, variety.id);
assert.match(html, /Editar variedad/);
assert.match(html, /Cambiar imagen/);
const saved = await module.saveCanonicalParameter(routeState, 'varieties');
assert.equal(saved.record.id, variety.id, 'editing must preserve the canonical id');
assert.equal(store.ui.parameterDraft.id, '', 'a confirmed save must reset only the in-memory canonical draft');

routeState.route = 'operations-farms-blocks';
html = module.render(routeState, { id: 'operations-farms-blocks' });
assert.equal(store.ui.parameterDraft.type, 'suppliers', 'the top draft must follow the explicit farms route');
assert.equal(reads, 1, 'opening farms must not issue another read');
assert.equal(writes, 1, 'opening farms must not issue another write');
assert.equal(rowCount(html), 0);
assert.match(html, /data-ops-context-type="suppliers"/);
assert.match(html, /<h3>Nueva finca \/ bloque<\/h3>/);
assert.match(html, /<h3>Fincas \/ Bloques<\/h3>/);
assert.match(html, /Nombre de finca \/ proveedor/);
assert.match(html, /Bloque asignado/);
assert.doesNotMatch(html, /<select[^>]+data-field="type"/);
assert.doesNotMatch(html, /<select[^>]+name="type"/);
assert.doesNotMatch(html, /Local\/demo/i);

await module.queryCatalog(1);
html = module.render(routeState, { id: 'operations-farms-blocks' });
assert.equal(module.queryState().total, 34);
assert.equal(rowCount(html), 25);
assert.match(html, /Resultados:34/);
assert.match(html, /Nombre finca \/ proveedor/);
assert.doesNotMatch(html, /Fotografía/);

assert.match(source, /if \(!fixedTypeForRoute\(\) && !payrollUi\.loaded/);
assert.match(source, /resetCanonicalDraft\(appState, type\)/);
assert.match(operationsIndex, /isCanonicalEditableType\?\.\(parameterType\)/);
assert.match(operationsIndex, /resetCanonicalDraft\?\.\(appState, parameterType\)/);
assert.doesNotMatch(operationsIndex, /parameter-reset"\) \{\s*stateApi\.resetParameterDraft\(appState\)/);

process.stdout.write(`${JSON.stringify({
  rootCause: 'fixed route constrained the visible selector but not the real draft, query context, or unrelated payroll mount',
  varieties: {
    topForm: 'VARIEDADES',
    bottomQuery: 'VARIEDADES',
    canonicalCount: 35,
    imageControls: true,
  },
  farmsBlocks: {
    topForm: 'FARMS/BLOCKS',
    bottomQuery: 'FARMS/BLOCKS',
    canonicalCount: 34,
  },
  routeOpenQueries: 0,
  routeOpenWrites: 0,
  localDemoBadge: false,
  sameCanonicalIdAfterEdit: saved.record.id === variety.id,
  serverSidePagination: true,
  rendersTriggered: renderedPages,
  result: 'PASS',
}, null, 2)}\n`);
