import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const navigation = read('./scripts/config/navigation.js');
const policy = read('./scripts/config/capability-policy.js');
const moduleIndex = read('./scripts/modules/operaciones/index.js');
const parameters = read('./scripts/modules/operaciones/parametros-poscosecha.js');
const repository = read('./scripts/repositories/operaciones/postharvest-parameter-query-repository.js');
const menu = read('./scripts/services/navigation/menu-service.js');
const migration = read('./supabase/migrations/202608290002_postharvest_farms_varieties_capabilities.sql');

const ROUTES = Object.freeze({
  farmsBlocks: Object.freeze({
    id: 'operations-farms-blocks',
    view: 'operations.parameters.view',
    manage: 'operations.farms_blocks.manage',
  }),
  varieties: Object.freeze({
    id: 'operations-varieties',
    view: 'operations.parameters.view',
    manage: 'operations.varieties.manage',
  }),
});

const permissionDecision = (capabilities, route) => ({
  menuVisible: capabilities.has(route.view),
  directRouteAllowed: capabilities.has(route.view),
  canView: capabilities.has(route.view),
  canModify: capabilities.has(route.manage),
});

for (const routeId of ['operations-farms-blocks', 'operations-varieties']) {
  assert.match(navigation, new RegExp(`id: ["']${routeId}["']`));
  assert.match(policy, new RegExp(`["']${routeId}["']:\\s*["']operations\\.parameters\\.view["']`));
  assert.ok(menu.includes(`"${routeId}"`), `${routeId} missing from operations menu order`);
}

assert.ok(parameters.includes('"operations-farms-blocks": "suppliers"'));
assert.ok(parameters.includes('"operations-varieties": "varieties"'));
assert.ok(parameters.includes('suppliers: "operations.farms_blocks.manage"'));
assert.ok(parameters.includes('varieties: "operations.varieties.manage"'));
assert.ok(parameters.includes('function assertManageType(type)'));
assert.ok(moduleIndex.includes('assertManageType?.(parameterType)'));
assert.ok(moduleIndex.includes('assertManageType?.(String(action.dataset.type || ""))'));
assert.ok(repository.includes('label: "Fincas / Bloques"'));

for (const capability of ['operations.farms_blocks.manage', 'operations.varieties.manage']) {
  assert.ok(policy.includes(capability.replace('.manage', '')));
  assert.ok(migration.includes(capability));
}

assert.ok(migration.includes("('GERENCIA_GENERAL', 'operations.farms_blocks.manage')"));
assert.ok(migration.includes("('GERENCIA_GENERAL', 'operations.varieties.manage')"));
assert.ok(migration.includes("capability_id='operations.parameters.manage'"));
assert.ok(migration.includes('U2C3_OFFLINE_PRIMARY_MAP_REGRESSION'));
assert.ok(!migration.includes("('GERENCIA_GENERAL', 'operations.parameters.manage')"));

const gerenciaCapabilities = new Set([
  'operations.parameters.view',
  'operations.farms_blocks.manage',
  'operations.varieties.manage',
]);
const viewOnlyCapabilities = new Set(['operations.parameters.view']);
const unauthorizedCapabilities = new Set();

for (const route of Object.values(ROUTES)) {
  assert.deepEqual(permissionDecision(gerenciaCapabilities, route), {
    menuVisible: true,
    directRouteAllowed: true,
    canView: true,
    canModify: true,
  });
  assert.deepEqual(permissionDecision(viewOnlyCapabilities, route), {
    menuVisible: true,
    directRouteAllowed: true,
    canView: true,
    canModify: false,
  });
  assert.deepEqual(permissionDecision(unauthorizedCapabilities, route), {
    menuVisible: false,
    directRouteAllowed: false,
    canView: false,
    canModify: false,
  });
}

assert.ok(parameters.includes('queried: false'));
assert.ok(parameters.includes('data-ops-parameter-query-form'));
assert.ok(parameters.includes('void queryCatalog(1, event.currentTarget)'));
assert.ok(moduleIndex.includes('if (!BlessERP.operacionesParametros?.assertManageType?.(parameterType)) return;'));
assert.ok(repository.includes('.from("erp_entity_records")'));
assert.ok(repository.includes('.eq("entity", config.entity)'));
assert.ok(repository.includes('.eq("company_id", companyId)'));
assert.ok(!parameters.includes('operationsCycleDemo'));

let runtimeCapabilities = new Set(gerenciaCapabilities);
const canonicalRows = type => Array.from({ length: 6 }, (_, index) => ({
  id: `${type.toUpperCase()}-${index + 1}`,
  code: `${type.slice(0, 3).toUpperCase()}-${index + 1}`,
  name: `${type} ${index + 1}`,
  type,
  active: true,
  assignedBlock: type === 'suppliers' ? `B${index + 1}` : '',
  __syncVersion: 1,
  __syncUpdatedAt: '2026-08-29T00:00:00.000Z',
}));
const store = {
  ui: {
    parameterDraft: {
      id: '', code: '', name: '', type: 'varieties', observation: '', assignedBlock: '', labelColor: '',
    },
  },
  masterData: { suppliers: [], varieties: [] },
};
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const context = {
  console,
  Date,
  Intl,
  AbortController,
  queueMicrotask,
  setTimeout,
  clearTimeout,
  window: {
    addEventListener() {},
    clearTimeout,
    setTimeout,
    BlessERP: {
      state: { state: { route: 'operations-farms-blocks' } },
      capabilityRuntime: { can: capability => runtimeCapabilities.has(capability) },
      layout: { renderPage() {}, toast() {} },
      services: { payrollV2: { snapshot: () => ({ employees: [], operationalRoles: [] }) } },
      operacionesState: { getStore: () => store },
      operacionesUtils: {
        esc: escapeHtml,
        number: value => String(value),
        renderPageHeader: () => '',
        renderTabs: () => '',
        renderNotice: () => '',
        renderSummaryCards: () => '',
      },
      getPostharvestParameterQueryRepository: () => ({
        activeCompanyId: () => '00000000-0000-4000-8000-000000000001',
        normalizePageSize: value => Number(value) === 50 ? 50 : 25,
        list: async ({ type, page, pageSize }) => ({
          ok: true,
          rows: canonicalRows(type),
          total: 6,
          page,
          pageSize,
          elapsedMs: 1,
          payloadBytes: 600,
        }),
      }),
    },
  },
};
vm.runInNewContext(parameters, context, { filename: 'parametros-poscosecha.js' });
const parametersModule = context.window.BlessERP.operacionesParametros;
const rowCount = html => (html.match(/data-ops-parameter-query-row/g) || []).length;

const farmsRoute = { id: ROUTES.farmsBlocks.id };
let html = parametersModule.render({}, farmsRoute);
assert.equal(rowCount(html), 0);
assert.match(html, />Consultar<\/button>/);
await parametersModule.queryCatalog(1);
html = parametersModule.render({}, farmsRoute);
assert.equal(rowCount(html), 6);
assert.ok(html.includes('data-ops-parameter-form'));

context.window.BlessERP.state.state.route = ROUTES.varieties.id;
const varietiesRoute = { id: ROUTES.varieties.id };
html = parametersModule.render({}, varietiesRoute);
assert.equal(rowCount(html), 0);
await parametersModule.queryCatalog(1);
html = parametersModule.render({}, varietiesRoute);
assert.equal(rowCount(html), 6);
assert.ok(html.includes('data-ops-parameter-form'));

runtimeCapabilities = new Set(viewOnlyCapabilities);
html = parametersModule.render({}, varietiesRoute);
assert.equal(rowCount(html), 6);
assert.ok(!html.includes('data-ops-parameter-form'));
assert.ok(!html.includes('data-ops-action="parameter-edit"'));
assert.ok(!html.includes('data-ops-action="parameter-toggle"'));
assert.ok(!html.includes('data-ops-action="parameter-delete"'));

process.stdout.write(`${JSON.stringify({
  routes: 2,
  viewCapability: 'operations.parameters.view',
  manageCapabilities: ['operations.farms_blocks.manage', 'operations.varieties.manage'],
  broadBaseDeniedGrant: 0,
  mutationGuards: 2,
  gerenciaGeneral: {
    farmsBlocks: permissionDecision(gerenciaCapabilities, ROUTES.farmsBlocks),
    varieties: permissionDecision(gerenciaCapabilities, ROUTES.varieties),
  },
  viewOnly: {
    farmsBlocks: permissionDecision(viewOnlyCapabilities, ROUTES.farmsBlocks),
    varieties: permissionDecision(viewOnlyCapabilities, ROUTES.varieties),
  },
  unauthorized: {
    farmsBlocks: permissionDecision(unauthorizedCapabilities, ROUTES.farmsBlocks),
    varieties: permissionDecision(unauthorizedCapabilities, ROUTES.varieties),
  },
  canonicalRepository: true,
  routeOpenWrites: 0,
  farmsBlocksRowsRendered: 6,
  varietiesRowsRendered: 6,
  result: 'PASS',
}, null, 2)}\n`);
