import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const repositorySource = read('./scripts/repositories/operaciones/postharvest-parameter-query-repository.js');
const parametersSource = read('./scripts/modules/operaciones/parametros-poscosecha.js');
const operationsStateSource = read('./scripts/modules/operaciones/operaciones-state.js');
const operationsIndexSource = read('./scripts/modules/operaciones/index.js');
const entityRegistrySource = read('./scripts/services/sync/entity-registry.js');
const receptionSource = read('./scripts/modules/operaciones/recepcion-flor.js');
const classificationSource = read('./scripts/modules/operaciones/clasificacion.js');
const zebraCodecSource = read('./scripts/modules/operaciones/bunch-label-codec.js');
const imageRepositorySource = read('./scripts/repositories/operaciones/variety-image-repository.js');
const imageMigrationSource = read('./supabase/migrations/202608160004_variety_images_storage.sql');
const u2MigrationSource = read('./supabase/migrations/202608260003_u2c3_commercial_operations_capability_guards.sql');
const imageCapabilityMigrationSource = read('./supabase/migrations/202608300001_variety_image_specific_capability_guard.sql');

const companyId = '10000000-0000-4000-8000-000000000001';
const entityRows = new Map();
const seed = (entity, count, prefix) => {
  for (let index = 1; index <= count; index += 1) {
    const recordId = `${prefix}-${String(index).padStart(3, '0')}`;
    entityRows.set(`${entity}:${recordId}`, {
      id: `${entity}-${index}`,
      company_id: companyId,
      entity,
      record_id: recordId,
      payload: {
        id: recordId,
        code: recordId,
        name: `${prefix} ${index}`,
        assignedBlock: entity === 'operations_suppliers' ? `B${index}` : '',
        active: true,
        observation: '',
      },
      version: 1,
      created_at: '2026-08-29T00:00:00.000Z',
      updated_at: '2026-08-29T00:00:00.000Z',
      created_by: 'validator-user',
      updated_by: 'validator-user',
      device_id: 'validator-device',
      last_operation_id: null,
      deleted_at: null,
    });
  }
};
seed('operations_suppliers', 34, 'FARM');
seed('operations_varieties', 35, 'VAR');

let reads = 0;
let writes = 0;
const appliedServerRecords = [];

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.rangeValue = null;
    this.limitValue = null;
    this.countRequested = false;
  }
  select(_fields, options = {}) { this.countRequested = options.count === 'exact'; return this; }
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
  maybeSingle() {
    const result = this.rows();
    return Promise.resolve({ data: result.data[0] || null, error: null });
  }
  then(resolve, reject) { return Promise.resolve(this.rows()).then(resolve, reject); }
}

const client = {
  from: table => new Query(table),
  rpc: async (name, args) => {
    assert.equal(name, 'erp_apply_offline_operation');
    assert.equal(args.p_company_id, companyId);
    assert.ok(['operations_suppliers', 'operations_varieties'].includes(args.p_entity));
    writes += 1;
    const key = `${args.p_entity}:${args.p_record_id}`;
    const prior = entityRows.get(key);
    const serverRecord = {
      ...(prior || {}),
      id: prior?.id || `${args.p_entity}-created`,
      company_id: companyId,
      entity: args.p_entity,
      record_id: args.p_record_id,
      payload: structuredClone(args.p_payload),
      version: Number(prior?.version || 0) + 1,
      created_at: prior?.created_at || '2026-08-29T00:00:00.000Z',
      updated_at: '2026-08-29T01:00:00.000Z',
      created_by: 'validator-user',
      updated_by: 'validator-user',
      device_id: args.p_device_id,
      last_operation_id: args.p_operation_id,
      deleted_at: null,
    };
    entityRows.set(key, serverRecord);
    return { data: [{ status: 'SYNCED', conflict: false, server_record: structuredClone(serverRecord) }], error: null };
  },
};

const context = {
  console,
  performance: { now: () => 1 },
  TextEncoder,
  structuredClone,
  crypto: { randomUUID: () => '12345678-1234-4123-8123-123456789abc' },
  window: {
    location: { protocol: 'https:' },
    BlessERP: {
      authAccess: { activeAccess: () => ({ activeCompany: { id: companyId } }) },
      state: { state: { db: { authAccess: {} } } },
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      offlineSync: {
        createOperationId: () => '12345678-1234-4123-8123-123456789abc',
        getDeviceId: async () => 'validator-device',
        buildFieldChanges: (base, value) => [{ path: [], base, value, base_exists: true, value_exists: true }],
        applyRemoteRecord: async record => { appliedServerRecords.push(structuredClone(record)); return { ok: true, changed: true }; },
      },
    },
  },
};
context.globalThis = context;
vm.runInNewContext(repositorySource, context, { filename: 'postharvest-parameter-query-repository.js' });
const repository = context.window.BlessERP.getPostharvestParameterQueryRepository();

assert.equal(writes, 0, 'loading the repository must not write');
const farms = await repository.list({ type: 'suppliers', status: 'TODOS', page: 1, pageSize: 50 });
const varieties = await repository.list({ type: 'varieties', status: 'TODOS', page: 1, pageSize: 50 });
assert.equal(farms.total, 34);
assert.equal(varieties.total, 35);
assert.equal(writes, 0, 'canonical reads must not write');

const variety = varieties.rows[0];
const updated = await repository.save('varieties', { ...variety, name: 'VARIEDAD CANÓNICA EDITADA' });
assert.equal(updated.ok, true);
assert.equal(updated.record.id, variety.id);
assert.equal(updated.record.name, 'VARIEDAD CANÓNICA EDITADA');
assert.equal(writes, 1);
assert.equal(appliedServerRecords.length, 1);
assert.equal(appliedServerRecords[0].record_id, variety.id);

const disabled = await repository.setActive('varieties', updated.record, false);
assert.equal(disabled.ok, true);
assert.equal(disabled.record.id, variety.id);
assert.equal(disabled.record.active, false);
assert.equal(writes, 2);

assert.match(entityRegistrySource, /operations_suppliers:\s*canonicalMasterContract\(false\)/);
assert.match(entityRegistrySource, /operations_varieties:\s*canonicalMasterContract\(true\)/);
assert.match(entityRegistrySource, /\["operations_suppliers",\s*"operations\.masterData\.suppliers"\]/);
assert.match(entityRegistrySource, /\["operations_varieties",\s*"operations\.masterData\.varieties"\]/);
assert.match(operationsStateSource, /store\.masterData\?\.\[type\]/);
assert.match(operationsStateSource, /activeMasterNames\(store, masterKey\)/);
assert.match(operationsStateSource, /\["suppliers", "varieties"\]\.includes\(masterKey\)/);
assert.match(operationsStateSource, /syncCatalogsFromMasterData,/);
assert.match(operationsIndexSource, /getPostharvestParameterQueryRepository/);
assert.match(operationsIndexSource, /saveCanonicalParameter/);
assert.match(operationsIndexSource, /setCanonicalParameterActive/);
assert.doesNotMatch(parametersSource, /const localRows = store\.masterData/);
assert.doesNotMatch(parametersSource, /localVersion >= remoteVersion/);
assert.match(parametersSource, /return \[\.\.\.catalogUi\.rows\]/);
assert.match(parametersSource, /SUPABASE CANÓNICO/);
assert.match(parametersSource, /operations\.farms_blocks\.manage/);
assert.match(parametersSource, /operations\.varieties\.manage/);
assert.match(parametersSource, /syncCatalogsFromMasterData\?\.\(store\)/);
assert.match(receptionSource, /store\.masterData\.suppliers/);
assert.match(receptionSource, /store\.catalogs\.varieties/);
assert.match(classificationSource, /store\.masterData\?\.suppliers/);
assert.match(zebraCodecSource, /catalogValues\(store, "varieties", "varieties"\)/);
assert.match(zebraCodecSource, /catalogValues\(store, "suppliers", "suppliers"\)/);

assert.match(imageMigrationSource, /'variety-images'/);
assert.match(imageMigrationSource, /payload - 'imagePath'/);
assert.match(imageMigrationSource, /jsonb_set\(v_variety\.payload, '\{imagePath\}'/);
assert.match(imageRepositorySource, /const BUCKET = "variety-images"/);
assert.match(imageRepositorySource, /erp_set_variety_image/);
assert.doesNotMatch(imageRepositorySource, /localStorage|data:image\/.*base64/i);

const historicalImageGuardUsesBroadCapability = /\('erp_set_variety_image',\s*'FIXED',\s*'operations\.parameters\.manage'\)/.test(u2MigrationSource);
assert.equal(historicalImageGuardUsesBroadCapability, true, 'the historical migration must remain unchanged');
assert.match(imageCapabilityMigrationSource, /set capability_id = 'operations\.varieties\.manage'/);
assert.match(imageCapabilityMigrationSource, /'operations\.parameters\.view'/);
assert.match(imageCapabilityMigrationSource, /erp_u2c3_assert_mutation_capability/);
assert.doesNotMatch(imageCapabilityMigrationSource, /insert into public\.erp_security_profile_capabilities/i);

process.stdout.write(`${JSON.stringify({
  farmsBlocksCanonicalSource: 'erp_entity_records:operations_suppliers',
  varietiesCanonicalSource: 'erp_entity_records:operations_varieties',
  farmsBlocksCount: farms.total,
  varietiesCount: varieties.total,
  routeOpenWrites: 0,
  serverConfirmedWrites: writes,
  sameCanonicalIdAfterEdit: updated.record.id === variety.id,
  sameCanonicalEntitiesAcrossModules: true,
  derivedOperationalCatalogRefresh: true,
  canonicalCacheApplied: appliedServerRecords.length === writes,
  localDemoMergeRemoved: true,
  imageSupportExists: true,
  imageStorage: 'variety-images',
  imageField: 'payload.imagePath',
  imageSpecificManageGuard: true,
  result: 'PASS',
}, null, 2)}\n`);
