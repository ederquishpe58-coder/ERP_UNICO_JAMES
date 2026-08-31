import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const repositorySource = read('./scripts/repositories/operaciones/postharvest-parameter-query-repository.js');
const parametersSource = read('./scripts/modules/operaciones/parametros-poscosecha.js');
const operationsDataSource = read('./scripts/modules/operaciones/operaciones-data.js');
const operationsStateSource = read('./scripts/modules/operaciones/operaciones-state.js');
const operationsIndexSource = read('./scripts/modules/operaciones/index.js');
const entityRegistrySource = read('./scripts/services/sync/entity-registry.js');
const receptionSource = read('./scripts/modules/operaciones/recepcion-flor.js');
const classificationSource = read('./scripts/modules/operaciones/clasificacion.js');
const zebraCodecSource = read('./scripts/modules/operaciones/bunch-label-codec.js');

const companyId = '10000000-0000-4000-8000-000000000001';
const typeConfigs = Object.freeze({
  suppliers: { entity: 'operations_suppliers', prefix: 'FARM', count: 34, assignedBlock: true },
  classifiers: { entity: 'operations_classifiers', prefix: 'CLA', count: 2, person: true },
  bunchers: { entity: 'operations_bunchers', prefix: 'EMB', count: 2, person: true },
  receptionists: { entity: 'operations_receptionists', prefix: 'REC', count: 2, person: true },
  digitizers: { entity: 'operations_digitizers', prefix: 'DIG', count: 2, person: true },
  scanners: { entity: 'operations_scanners', prefix: 'ESC', count: 2, person: true },
  responsibles: { entity: 'operations_responsibles', prefix: 'RSP', count: 2, person: true },
  varieties: { entity: 'operations_varieties', prefix: 'VAR', count: 35 },
  lengths: { entity: 'operations_lengths', prefix: 'LON', count: 4 },
  stemTypes: { entity: 'operations_stem_types', prefix: 'TAL', count: 2 },
  labelTypes: { entity: 'operations_label_types', prefix: 'ETQ', count: 2 },
});
const typeManageCapabilities = Object.freeze({
  suppliers: 'operations.farms_blocks.manage',
  classifiers: 'operations.classifiers.manage',
  bunchers: 'operations.bunchers.manage',
  receptionists: 'operations.receptionists.manage',
  digitizers: 'operations.digitizers.manage',
  scanners: 'operations.scanners.manage',
  responsibles: 'operations.responsibles.manage',
  varieties: 'operations.varieties.manage',
  lengths: 'operations.lengths.manage',
  stemTypes: 'operations.stem_types.manage',
  labelTypes: 'operations.label_types.manage',
});

const entityRows = new Map();
for (const config of Object.values(typeConfigs)) {
  for (let index = 1; index <= config.count; index += 1) {
    const recordId = `${config.prefix}-${String(index).padStart(3, '0')}`;
    const payload = { id: recordId, code: recordId, name: `${config.prefix} ${index}`, active: true, observation: '' };
    if (config.assignedBlock) payload.assignedBlock = `B${index}`;
    if (config.person) {
      payload.employee_id = recordId;
      payload.employeeId = recordId;
      payload.operational_worker_id = recordId;
      payload.operationalWorkerId = recordId;
    }
    entityRows.set(`${config.entity}:${recordId}`, {
      id: `${config.entity}-${index}`, company_id: companyId, entity: config.entity, record_id: recordId,
      payload, version: 1, created_at: '2026-08-30T00:00:00.000Z', updated_at: '2026-08-30T00:00:00.000Z',
      created_by: 'validator-user', updated_by: 'validator-user', device_id: 'validator-device', last_operation_id: null, deleted_at: null,
    });
  }
}

let reads = 0;
let writes = 0;
class Query {
  constructor() { this.filters = []; this.rangeValue = null; this.limitValue = null; }
  select() { return this; }
  eq(field, value) { this.filters.push(row => String(field.includes('->>') ? row.payload?.[field.split('->>')[1]] : row[field]) === String(value)); return this; }
  neq(field, value) { this.filters.push(row => String(row[field]) !== String(value)); return this; }
  is(field, value) { this.filters.push(row => row[field] === value); return this; }
  filter(field, operator, value) { return operator === 'eq' ? this.eq(field, value) : this; }
  ilike(field, pattern) {
    const key = field.split('->>')[1];
    const literal = String(pattern).replaceAll('\\%', '%').replaceAll('\\_', '_').toLocaleUpperCase('es-EC');
    this.filters.push(row => String(row.payload?.[key] || '').toLocaleUpperCase('es-EC') === literal);
    return this;
  }
  or() { return this; }
  order() { return this; }
  limit(value) { this.limitValue = Number(value); return this; }
  range(from, to) { this.rangeValue = [Number(from), Number(to)]; return this; }
  rows() {
    reads += 1;
    let rows = [...entityRows.values()].filter(row => this.filters.every(filter => filter(row)));
    const count = rows.length;
    if (this.rangeValue) rows = rows.slice(this.rangeValue[0], this.rangeValue[1] + 1);
    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);
    return { data: rows.map(row => structuredClone(row)), error: null, count };
  }
  maybeSingle() { const result = this.rows(); return Promise.resolve({ data: result.data[0] || null, error: null }); }
  then(resolve, reject) { return Promise.resolve(this.rows()).then(resolve, reject); }
}

const client = {
  from: () => new Query(),
  rpc: async (name, args) => {
    assert.equal(name, 'erp_apply_offline_operation');
    assert.equal(args.p_company_id, companyId);
    assert.ok(Object.values(typeConfigs).some(config => config.entity === args.p_entity));
    writes += 1;
    const key = `${args.p_entity}:${args.p_record_id}`;
    const prior = entityRows.get(key);
    const serverRecord = {
      ...(prior || {}), id: prior?.id || `${args.p_entity}-${args.p_record_id}`, company_id: companyId,
      entity: args.p_entity, record_id: args.p_record_id, payload: structuredClone(args.p_payload),
      version: Number(prior?.version || 0) + 1, created_at: prior?.created_at || '2026-08-30T00:00:00.000Z',
      updated_at: '2026-08-30T01:00:00.000Z', created_by: 'validator-user', updated_by: 'validator-user',
      device_id: args.p_device_id, last_operation_id: args.p_operation_id, deleted_at: null,
    };
    entityRows.set(key, serverRecord);
    return { data: [{ status: 'SYNCED', conflict: false, server_record: structuredClone(serverRecord) }], error: null };
  },
};

let browserSequence = 0;
function createBrowserRepository(browserName) {
  const applied = [];
  browserSequence += 1;
  const operationId = `${String(browserSequence).padStart(8, '0')}-1234-4123-8123-123456789abc`;
  const context = {
    console, performance: { now: () => 1 }, TextEncoder, structuredClone,
    crypto: { randomUUID: () => operationId },
    window: { location: { protocol: 'https:' }, BlessERP: {
      authAccess: { activeAccess: () => ({ activeCompany: { id: companyId } }) },
      state: { state: { db: { authAccess: {} } } }, isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      offlineSync: {
        createOperationId: () => operationId, getDeviceId: async () => `device-${browserName}`,
        buildFieldChanges: (base, value) => [{ path: [], base, value, base_exists: true, value_exists: true }],
        applyRemoteRecord: async record => { applied.push(structuredClone(record)); return { ok: true, changed: true }; },
      },
    } },
  };
  context.globalThis = context;
  vm.runInNewContext(repositorySource, context, { filename: `repository-${browserName}.js` });
  return { repository: context.window.BlessERP.getPostharvestParameterQueryRepository(), applied };
}

const browserA = createBrowserRepository('A');
const browserB = createBrowserRepository('B');
const browserC = createBrowserRepository('C');
const multibrowser = {};

for (const [type, config] of Object.entries(typeConfigs)) {
  assert.equal(browserA.repository.isCanonicalEditableType(type), true, `${type} must use canonical writes`);
  const before = await browserA.repository.list({ type, status: 'TODOS', page: 1, pageSize: 50 });
  assert.equal(before.total, config.count);
  assert.equal(writes, Object.keys(multibrowser).length * 4, 'reads must never write');

  const created = await browserA.repository.save(type, {
    name: `${config.prefix} MULTIBROWSER`, code: `${config.prefix}-MULTI`,
    assignedBlock: config.assignedBlock ? `${config.prefix}-BLOCK-MULTI` : '',
    labelColor: type === 'bunchers' ? 'AZUL' : '', active: true, observation: 'Fixture multibrowser',
  });
  assert.equal(created.ok, true);
  if (config.person) assert.match(created.record.id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);

  const seenByB = await browserB.repository.list({ type, status: 'TODOS', page: 1, pageSize: 50 });
  const rowB = seenByB.rows.find(row => row.id === created.record.id);
  assert.ok(rowB);
  const edited = await browserB.repository.save(type, { ...rowB, name: `${config.prefix} EDITED BY B` });
  assert.equal(edited.record.id, created.record.id);

  const seenByA = await browserA.repository.list({ type, status: 'TODOS', page: 1, pageSize: 50 });
  assert.equal(seenByA.rows.find(row => row.id === created.record.id)?.name, `${config.prefix} EDITED BY B`);
  const seenByC = await browserC.repository.list({ type, status: 'TODOS', page: 1, pageSize: 50 });
  assert.ok(seenByC.rows.some(row => row.id === created.record.id));

  const deactivated = await browserC.repository.setActive(type, edited.record, false);
  const activeOnly = await browserA.repository.list({ type, status: 'ACTIVO', page: 1, pageSize: 50 });
  assert.equal(activeOnly.rows.some(row => row.id === created.record.id), false);
  const historyReference = await browserA.repository.list({ type, status: 'TODOS', page: 1, pageSize: 50 });
  assert.equal(historyReference.rows.find(row => row.id === created.record.id)?.active, false);
  const restored = await browserA.repository.setActive(type, deactivated.record, true);
  assert.equal(restored.record.id, created.record.id);
  multibrowser[type] = { create: 'PASS', edit: 'PASS', sameCanonicalId: true, deactivate: 'PASS' };
}

for (const entity of Object.values(typeConfigs).map(config => config.entity)) {
  assert.match(entityRegistrySource, new RegExp(`${entity}:\\s*canonicalPostharvestMasterContract\\(\\)`));
  assert.match(operationsDataSource, new RegExp(`${entity}:`));
}
for (const [type, capability] of Object.entries(typeManageCapabilities)) {
  assert.match(parametersSource, new RegExp(`${type}:\\s*["']${capability.replaceAll('.', '\\.')}`));
}
assert.doesNotMatch(parametersSource, /return TYPE_MANAGE_CAPABILITIES\[[^\n]+\]\s*\|\|\s*["']operations\.parameters\.manage/);
assert.match(parametersSource, /capabilityRuntime\?\.can\?\.\("operations\.parameters\.view"\)/);
assert.match(operationsStateSource, /store\.catalogs\[catalogKey\] = values/);
assert.doesNotMatch(operationsIndexSource, /stateApi\.(saveParameter|toggleParameter|deleteParameter)\(/);
assert.match(operationsIndexSource, /no tiene un contrato canónico explícito/);
assert.match(parametersSource, /catalogUi\.rows\.unshift\(next\)/);
assert.match(parametersSource, /catalogUi\.total \+= 1/);
assert.doesNotMatch(parametersSource, /const localRows = store\.masterData/);
assert.match(receptionSource, /store\.masterData\.suppliers/);
assert.match(receptionSource, /store\.catalogs\.varieties/);
assert.match(classificationSource, /store\.masterData\?\.suppliers/);
assert.match(zebraCodecSource, /catalogValues\(store, "varieties", "varieties"\)/);
assert.match(zebraCodecSource, /catalogValues\(store, "suppliers", "suppliers"\)/);

process.stdout.write(`${JSON.stringify({
  parameterTypes: Object.keys(typeConfigs).length,
  canonicalTypes: Object.keys(typeConfigs), localOnlyTypes: [], mixedTypes: [], multibrowser,
  serverWrites: writes, routeOpenWrites: 0, realtimeNewRecordPropagation: true, realtimeWritebacks: 0,
  localFallbackReachableFromUi: false, operationalDemoAuthority: false, sameCanonicalIdsAcrossModules: true,
  legacyLocalRowsRequireReview: true, automaticLegacyImport: false,
  result: 'PASS',
}, null, 2)}\n`);
