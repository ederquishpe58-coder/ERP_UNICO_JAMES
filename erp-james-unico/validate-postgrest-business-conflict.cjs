// Offline PostgreSQL only. The Hasql policy adapter below is bounded by the TEST,
// not by the actual 1.1.0.1 implementation, which has no retry counter or backoff.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const read = file => fs.readFileSync(__dirname + '/' + file, 'utf8');
const migrationName = 'supabase/migrations/202609080006_commercial_catalog_nonretryable_conflict.sql';
const migration = read(migrationName);
const baselineName = 'supabase/migrations/202609080004_commercial_catalog_identity_updates.sql';
const signature = 'public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamp with time zone)';
const oldRaise = "raise exception using errcode='40001',message='La ficha cambió en el servidor. Actualice el catálogo y revise sus cambios antes de guardar.',detail='COMMERCIAL_CATALOG_VERSION_CONFLICT';";
const newRaise = oldRaise.replace("errcode='40001'", "errcode='PT409'");
const B = '10000000-0000-4000-8000-000000000002';
const I = '10000000-0000-4000-8000-000000000001';
const actor = '20000000-0000-4000-8000-000000000001';
const checks = [];
const evidenceSources = {
  postgrestRunner: 'https://github.com/PostgREST/postgrest/blob/v14.5/src/PostgREST/MainTx.hs#L93',
  pinnedDependency: 'https://github.com/PostgREST/postgrest/blob/v14.5/nix/overlays/haskell-packages.nix#L74',
  hasqlRetry: 'https://github.com/nikita-volkov/hasql-transaction/blob/1.1.0.1/library/Hasql/Transaction/Private/Sessions.hs',
  customHttpStatus: 'https://github.com/PostgREST/postgrest/blob/v14.5/src/PostgREST/Error.hs#L591'
};
async function check(name, fn) {
  await fn(); checks.push({ name, result: 'PASS' });
}

// Reuse all 52 existing canonical catalog tests without editing that test or 004.
// Whenever its setup reapplies 004, apply the forward 006 immediately afterward.
async function existingCatalogRegressions() {
  let existingReport;
  const sandboxProcess = { exitCode: 0 };
  const patchedFs = { ...fs, readFileSync(file, ...args) {
    const value = fs.readFileSync(file, ...args);
    if (String(file).replaceAll('\\', '/').endsWith('/' + baselineName)) return String(value) + '\n' + migration;
    return value;
  } };
  const fixtureConsole = { log: value => { existingReport = JSON.parse(value); }, error: (...args) => { sandboxProcess.failure = args.map(String).join(' '); } };
  const source = read('validate-commercial-master-safe-update.cjs');
  assert.equal(source.split('(async()=>{').length, 2, 'Existing fixture entrypoint must remain explicit');
  // Compile in the current realm so baseline strict comparisons against PGlite
  // rows retain their original semantics; only dependencies/output are injected.
  const runFixture = vm.compileFunction(source.replace('(async()=>{', 'const fixtureCompletion=(async()=>{') + '\nreturn fixtureCompletion;',
    ['require', '__dirname', 'console', 'process'], { filename: 'validate-commercial-master-safe-update.cjs' });
  await runFixture(name => name === 'node:fs' ? patchedFs : require(name), __dirname, fixtureConsole, sandboxProcess);
  assert.equal(sandboxProcess.exitCode, 0, sandboxProcess.failure);
  assert.equal(existingReport?.result, 'PASS');
  assert.equal(existingReport.checks.length, 52);
  checks.push(...existingReport.checks.map(item => ({ ...item, name: 'Existing canonical contract: ' + item.name })));
}

// Faithful branch adapter of the pinned Hasql inRetryingTransaction/handleTransactionError.
// This is NOT an execution of the Haskell binary. Real PostgreSQL errors enter
// this adapter, and the artificial cap prevents a deliberately infinite test.
async function hasqlPolicyProbe(statement, testCap = 24) {
  let attempts = 0;
  for (;;) {
    attempts++;
    try { return { attempts, value: await statement(), stopped: true, releasedPoolSlot: true }; }
    catch (error) {
      if (!['40001', '40P01'].includes(error.code)) {
        return { attempts, error, stopped: true, releasedPoolSlot: true };
      }
      if (attempts === testCap) return { attempts, error, stopped: false, releasedPoolSlot: false, artificialTestCap: testCap };
    }
  }
}

async function focusedDbTests() {
  const db = new PGlite();
  const query = (sql, params = []) => db.query(sql, params);
  const one = async (sql, params) => (await query(sql, params)).rows[0];
  const definition = async () => (await one('select pg_get_functiondef($1::regprocedure) definition', [signature])).definition;
  const get = (id = 'brand-main', company = B, entity = 'commercial_brands') => one('select * from erp_entity_records where company_id=$1 and entity=$2 and record_id=$3', [company, entity, id]);
  const rpc = request => query('select * from erp_apply_offline_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', request);
  const request = (row, patch, operation = randomUUID()) => [operation, row.company_id, 'fixture', row.entity, 'UPDATE', row.record_id,
    JSON.stringify({ ...row.payload, ...patch }), JSON.stringify(row.payload), JSON.stringify(Object.entries(patch).map(([key, value]) =>
      ({ path: [key], base_exists: key in row.payload, base: row.payload[key] ?? null, value_exists: true, value }))), row.version, new Date().toISOString()];
  async function protectedState() {
    return one(`select
      (select jsonb_agg(to_jsonb(x) order by id) from erp_entity_records x) records,
      (select jsonb_agg(to_jsonb(x) order by operation_id) from erp_sync_operations x) operations,
      (select jsonb_agg(to_jsonb(x) order by operation_id,field_path) from erp_sync_field_audit x) audits,
      (select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig,'signature',p.oid::regprocedure::text) order by p.oid)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') function_metadata`);
  }
  try {
    await db.exec(read('tests/fixtures/customer-inactivation-sync.sql'));
    await query("select set_config('test.actor',$1,false),set_config('test.capability','allowed',false)", [actor]);
    await query("insert into user_company_memberships values($1,$2,'ACTIVE'),($3,$2,'ACTIVE')", [B, actor, I]);
    await query("insert into erp_entity_records(company_id,entity,record_id,payload) values($1,'commercial_brands','brand-main',$3),($2,'commercial_brands','brand-main',$3)",
      [B, I, JSON.stringify({ id: 'brand-main', code: 'MAIN', name: 'Initial', status: 'ACTIVO' })]);
    await db.exec(read('supabase/migrations/202609080003_customer_status_only_inactivation.sql'));
    await db.exec(read(baselineName));
    // Exercise ACL preservation using the live target's authenticated-only execute grant.
    await db.exec(`revoke all on function ${signature} from public,anon;grant execute on function ${signature} to authenticated;`);
    const stale = request(await get(), { name: 'Stale writer' });
    await rpc(request(await get(), { name: 'Current writer' }));
    await check('Before fix: real stale business conflict emits 40001 and retains exact detail', async () => {
      await assert.rejects(() => rpc(stale), error => error.code === '40001' && error.detail === 'COMMERCIAL_CATALOG_VERSION_CONFLICT');
    });
    await check('Pinned Hasql adapter repeats real 40001 at all 24 test attempts without releasing its modeled pool slot', async () => {
      const before = await protectedState(); const result = await hasqlPolicyProbe(() => rpc(stale));
      assert.equal(result.attempts, 24); assert.equal(result.stopped, false); assert.equal(result.releasedPoolSlot, false);
      assert.deepEqual(await protectedState(), before);
    });
    const oldDefinition = await definition();
    await check('Forward migration changes exactly one SQLSTATE; metadata, grants, owner and all business rows unchanged', async () => {
      const before = await protectedState();
      const otherFunctions = (await query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid<>$1::regprocedure order by p.oid", [signature])).rows;
      await db.exec(migration);
      assert.equal(await definition(), oldDefinition.replace(oldRaise, newRaise));
      assert.deepEqual(await protectedState(), before);
      assert.deepEqual((await query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid<>$1::regprocedure order by p.oid", [signature])).rows, otherFunctions);
    });
    await check('Reapplying migration is idempotent for function and every business row', async () => {
      const before = await protectedState(); const def = await definition(); await db.exec(migration);
      assert.deepEqual(await protectedState(), before); assert.equal(await definition(), def);
    });
    await check('After fix: same stale request returns PT409 once with unchanged human message and detail', async () => {
      const before = await protectedState(); const result = await hasqlPolicyProbe(() => rpc(stale));
      assert.equal(result.attempts, 1); assert.equal(result.stopped, true); assert.equal(result.releasedPoolSlot, true);
      assert.equal(result.error.code, 'PT409'); assert.equal(result.error.detail, 'COMMERCIAL_CATALOG_VERSION_CONFLICT');
      assert.equal(result.error.message, 'La ficha cambió en el servidor. Actualice el catálogo y revise sus cambios antes de guardar.');
      assert.deepEqual(await protectedState(), before);
    });
    await check('Valid save returns canonical ACK; concurrent identical retry persists one version and operation', async () => {
      const row = await get(); const save = request(row, { name: 'Valid confirmed save' });
      const replies = await Promise.all([rpc(save), rpc(save)]);
      assert.ok(replies.every(reply => reply.rows[0].status === 'SYNCED' && reply.rows[0].conflict === false));
      assert.equal((await get()).version, row.version + 1);
      assert.equal((await one('select count(*)::int n from erp_sync_operations where operation_id=$1', [save[0]])).n, 1);
      assert.deepEqual(replies[0].rows[0].server_record, replies[1].rows[0].server_record);
    });
    await check('Two concurrent same-version writes produce one ACK and one terminal PT409', async () => {
      const row = await get(); const attempts = [request(row, { name: 'Writer one' }), request(row, { name: 'Writer two' })];
      const replies = await Promise.allSettled(attempts.map(rpc));
      assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
      const failed = replies.find(reply => reply.status === 'rejected').reason;
      assert.equal(failed.code, 'PT409'); assert.equal(failed.detail, 'COMMERCIAL_CATALOG_VERSION_CONFLICT');
      assert.equal((await get()).version, row.version + 1);
    });
    await check('Company isolation and existing operation-context idempotency guard remain intact', async () => {
      const bless = await get(); const imperio = await get('brand-main', I);
      const save = request(imperio, { name: 'Only IMPERIO' }); await rpc(save);
      assert.deepEqual(await get(), bless);
      const moved = [...save]; moved[1] = B;
      await assert.rejects(() => rpc(moved), error => error.code === '42501' && error.message === 'OPERATIONS_IDEMPOTENCY_CONTEXT_MISMATCH');
    });
    await check('Missing exact guard text fails migration closed and preserves the target definition', async () => {
      const canonical = await definition(); const unexpected = canonical.replace(newRaise, newRaise.replace('COMMERCIAL_CATALOG_VERSION_CONFLICT', 'UNEXPECTED_CATALOG_CONFLICT'));
      await db.exec(unexpected); const before = await protectedState();
      await assert.rejects(() => db.exec(migration), /COMMERCIAL_CATALOG_CONFLICT_GUARD_MISMATCH/);
      await db.exec('rollback'); assert.equal(await definition(), unexpected); assert.deepEqual(await protectedState(), before);
      await db.exec(canonical);
    });
    await check('Multiple old guard matches fail closed instead of patching several statements', async () => {
      const canonical = await definition();
      const duplicate = canonical.replace(newRaise, oldRaise + '\n      ' + oldRaise);
      await db.exec(duplicate); const before = await protectedState();
      await assert.rejects(() => db.exec(migration), /COMMERCIAL_CATALOG_CONFLICT_GUARD_MISMATCH/);
      await db.exec('rollback'); assert.equal(await definition(), duplicate); assert.deepEqual(await protectedState(), before);
      await db.exec(canonical);
    });
    await check('No target function fails closed without creating a replacement', async () => {
      const canonical = await definition(); await db.exec(`drop function ${signature}`);
      await assert.rejects(() => db.exec(migration), /COMMERCIAL_CATALOG_CONFLICT_TARGET_MISSING/); await db.exec('rollback');
      assert.equal((await one('select to_regprocedure($1) target', [signature])).target, null);
      await db.exec(canonical);
    });
  } finally { await db.close(); }
}

(async () => {
  await existingCatalogRegressions();
  await focusedDbTests();
  console.log(JSON.stringify({ result: 'PASS', passed: checks.length, checks, evidenceSources,
    hasqlPolicyTest: 'Cited 1.1.0.1 retry branches adapted with an artificial 24-attempt test cap; Haskell binary not executed',
    postgresTestEngine: 'PGlite, synthetic rows, concurrent submitted queries', productionCalls: 0, productionWrites: 0 }, null, 2));
})().catch(error => { console.error(error.stack, error.detail || ''); process.exitCode = 1; });
