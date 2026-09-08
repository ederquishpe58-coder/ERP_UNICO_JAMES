// Offline only. Supply the private READ ONLY definition snapshot explicitly:
// node validate-explicit-business-conflicts.cjs --snapshot <general-conflict-manifest-definitions-before.json>
// Missing evidence fails closed. Full definitions/approval identities are not copied into the repository.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const digest = value => createHash('md5').update(value, 'utf8').digest('hex');
const migration = fs.readFileSync(path.join(__dirname, 'supabase/migrations/202609080007_explicit_business_conflicts_fast_fail.sql'), 'utf8');
const manifestMatch = migration.match(/\$reviewed\$\s*([\s\S]*?)\s*\$reviewed\$::jsonb/);
assert.ok(manifestMatch, 'Explicit reviewed manifest required');
const manifest = JSON.parse(manifestMatch[1]);
const snapshotFlag = process.argv.indexOf('--snapshot');
if (snapshotFlag < 0 || !process.argv[snapshotFlag + 1]) throw new Error('READ_ONLY_DEFINITION_SNAPSHOT_REQUIRED: use --snapshot <file>');
const snapshotPath = path.resolve(process.argv[snapshotFlag + 1]);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const checks = [];
const definitions = new Map(snapshot.map(item => ['public.' + item.signature, item]));
const transform = (definition, target) => target.replacements.reduce((value, group) => value.split(group.old_raise).join(group.new_raise), definition);
async function check(name, fn) { await fn(); checks.push({ name, result: 'PASS' }); }

(async () => {
  await check('External snapshot matches all 18 authoritative hashes and 25 individually allowlisted RAISE statements', async () => {
    assert.equal(manifest.length, 18); assert.equal(snapshot.length, 18);
    assert.equal(manifest.reduce((count, target) => count + target.count, 0), 25);
    assert.equal(new Set(manifest.map(target => target.signature)).size, 18);
    for (const target of manifest) {
      const source = definitions.get(target.signature); assert.ok(source);
      assert.equal(digest(source.definition), target.before_md5);
      assert.equal(source.definition_md5, target.before_md5);
      assert.equal(digest(source.source), source.source_md5);
      for (const group of target.replacements) {
        assert.equal(source.definition.split(group.old_raise).length - 1, group.count);
        assert.equal(source.definition.split(group.new_raise).length - 1, 0);
        assert.equal(group.new_raise, group.old_raise.replace(/(\berrcode\s*=\s*)'40001'/i, "$1'PT409'"));
      }
      const after = transform(source.definition, target);
      assert.equal(digest(after), target.after_md5);
      assert.equal(after.replace(/(\berrcode\s*=\s*)'PT409'/gi, "$1'40001'"), source.definition);
    }
  });
  const db = new PGlite();
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const definition = async signature => (await rows('select pg_get_functiondef($1::regprocedure) definition', [signature]))[0].definition;
  const allDefinitions = () => rows("select oid,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace order by oid");
  const protectedState = async () => ({
    metadata: await rows("select oid,to_jsonb(p)-'prosrc' metadata from pg_proc p where pronamespace='public'::regnamespace order by oid"),
    rows: await rows('select * from fixture_business_rows order by company,kind'),
    writes: await rows('select * from fixture_write_probe order by id')
  });
  async function restoreBefore() { for (const target of manifest) await db.exec(definitions.get(target.signature).definition); }
  async function emitExactRaise(statement) {
    let failure;
    try {
      await db.exec(`begin;
        insert into fixture_write_probe(id) values(1);
        do $probe$
        declare
          p_entity text := 'fixture_entity'; p_record_id text := 'fixture_record';
          p_base_version bigint := 1; p_expected_version bigint := 1;
          p_expected_status text := 'BORRADOR';
          v_current record; v_variety record; v_document record;
        begin
          select 2::bigint version into v_current;
          select 2::bigint version into v_variety;
          select 'FIRMADO'::text status into v_document;
          ${statement}
        end;
        $probe$;
        commit;`);
    } catch (error) { failure = error; }
    await db.exec('rollback');
    assert.ok(failure, 'The original RAISE must fail closed');
    assert.equal((await rows('select count(*)::int n from fixture_write_probe'))[0].n, 0, 'Whole transaction rolled back');
    return { code: failure.code, message: failure.message, detail: failure.detail || null, hint: failure.hint || null };
  }
  try {
    // Store the real function bodies without compiling or running dependencies.
    // These tests do not simulate a complete payroll/security/inventory/SRI database.
    await db.exec(`set check_function_bodies=false;
      create role authenticated; create role service_role; create role anon;
      create table fixture_business_rows(company text,kind text,payload jsonb,primary key(company,kind));
      insert into fixture_business_rows values
        ('BLESS','journal','{"entries":1}'),('BLESS','sequence','{"next":752}'),
        ('BLESS','SRI_PRODUCTION','{"enabled":true}'),('IMPERIO','inventory','{"movements":1}'),
        ('BLESS','SRI_TEST','{"enabled":true}');
      create table fixture_write_probe(id integer primary key);
      create function public.fixture_native_condition_control(p_deadlock boolean) returns void language plpgsql as $control$
        begin
          if p_deadlock then raise deadlock_detected; else raise serialization_failure; end if;
        end;
      $control$;`);
    await check('All copied function definitions install byte-exactly with original ACL grants and metadata', async () => {
      for (const target of manifest) {
        const source = definitions.get(target.signature);
        await db.exec(source.definition);
        await db.exec(`revoke all on function ${target.signature} from public,anon,authenticated,service_role;`);
        for (const role of ['authenticated', 'service_role']) {
          if (source.acl.includes(role + '=X/')) await db.exec(`grant execute on function ${target.signature} to ${role};`);
        }
        assert.equal(await definition(target.signature), source.definition);
        const metadata = (await rows('select pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef security_definer,proconfig config from pg_proc where oid=$1::regprocedure', [target.signature]))[0];
        assert.equal(metadata.owner, source.owner); assert.equal(metadata.acl, source.acl);
        assert.equal(metadata.security_definer, source.security_definer);
      }
    });
    await check('Migration changes only 25 SQLSTATE literals; all OIDs, ACLs, owners, arguments, configuration and synthetic business rows preserved', async () => {
      const before = await protectedState();
      const originalDefinitions = await allDefinitions();
      await db.exec(migration);
      assert.deepEqual(await protectedState(), before);
      for (const target of manifest) assert.equal(await definition(target.signature), transform(definitions.get(target.signature).definition, target));
      const targetOids = new Set((await rows('select unnest($1::regprocedure[])::oid oid', [manifest.map(target => target.signature)])).map(row => row.oid));
      assert.deepEqual((await allDefinitions()).filter(row => !targetOids.has(row.oid)), originalDefinitions.filter(row => !targetOids.has(row.oid)));
    });
    await check('Second application is idempotent for definitions, metadata and all synthetic business rows', async () => {
      const state = await protectedState(); const defs = await allDefinitions(); await db.exec(migration);
      assert.deepEqual(await protectedState(), state); assert.deepEqual(await allDefinitions(), defs);
    });
    for (const target of manifest) {
      const source = definitions.get(target.signature).source;
      const exactRaises = [...source.matchAll(/raise\s+exception\b[^;]*;/gi)].map(match => match[0]).filter(statement => /\berrcode\s*=\s*'40001'/i.test(statement));
      assert.equal(exactRaises.length, target.count);
      for (const [index, statement] of exactRaises.entries()) {
        await check(target.signature.split('(')[0] + ': exact RAISE ' + (index + 1) + ' retains message/detail/hint and full rollback, now PT409', async () => {
          const before = await protectedState();
          const original = await emitExactRaise(statement);
          const after = await emitExactRaise(statement.replace(/(\berrcode\s*=\s*)'40001'/i, "$1'PT409'"));
          assert.equal(original.code, '40001'); assert.equal(after.code, 'PT409');
          assert.deepEqual(after, { ...original, code: 'PT409' });
          assert.deepEqual(await protectedState(), before);
        });
      }
    }
    await check('Unlisted PostgreSQL serialization/deadlock condition controls still emit 40001 and 40P01', async () => {
      await assert.rejects(() => rows('select fixture_native_condition_control(false)'), error => error.code === '40001');
      await assert.rejects(() => rows('select fixture_native_condition_control(true)'), error => error.code === '40P01');
    });
    await check('Mixed already-fixed and old reviewed functions safely converge without metadata or business writes', async () => {
      await restoreBefore();
      await db.exec(transform(definitions.get(manifest[0].signature).definition, manifest[0]));
      const before = await protectedState(); await db.exec(migration); assert.deepEqual(await protectedState(), before);
      for (const target of manifest) assert.equal(digest(await definition(target.signature)), target.after_md5);
    });
    await check('A drifted final target rejects the entire migration before changing earlier targets', async () => {
      await restoreBefore(); const last = manifest.at(-1);
      await db.exec(definitions.get(last.signature).definition.replace('SRI_STATUS_CONFLICT:', 'UNREVIEWED_STATUS_CONFLICT:'));
      const defs = await allDefinitions(); const state = await protectedState();
      await assert.rejects(() => db.exec(migration), /EXPLICIT_BUSINESS_CONFLICT_DEFINITION_DRIFT/); await db.exec('rollback');
      assert.deepEqual(await allDefinitions(), defs); assert.deepEqual(await protectedState(), state); await restoreBefore();
    });
    await check('Missing final function fails closed without creating or modifying any replacement', async () => {
      const last = manifest.at(-1); await db.exec(`drop function ${last.signature}`);
      const defs = await allDefinitions(); const state = await protectedState();
      await assert.rejects(() => db.exec(migration), /EXPLICIT_BUSINESS_CONFLICT_TARGET_MISSING/); await db.exec('rollback');
      assert.deepEqual(await allDefinitions(), defs); assert.deepEqual(await protectedState(), state); await db.exec(definitions.get(last.signature).definition);
    });
    await check('Incorrect statement multiplicity is rejected atomically', async () => {
      const tampered = structuredClone(manifest); tampered[0].replacements[0].count++;
      const testMigration = migration.replace(manifestMatch[1], JSON.stringify(tampered));
      const defs = await allDefinitions(); const state = await protectedState();
      await assert.rejects(() => db.exec(testMigration), /EXPLICIT_BUSINESS_CONFLICT_BEFORE_COUNT_MISMATCH/); await db.exec('rollback');
      assert.deepEqual(await allDefinitions(), defs); assert.deepEqual(await protectedState(), state);
    });
    console.log(JSON.stringify({ result: 'PASS', passed: checks.length, checks,
      functions: 18, exactRaiseBranches: 25, testEngine: 'Isolated PGlite',
      fullBusinessWorkflowsExecuted: false, definitionBodiesStoredWithoutDependencyExecution: true,
      limitations: 'Tests prove SQLSTATE-only definition changes, metadata/data preservation and extracted error/rollback contracts; no complete payroll, inventory, security or SRI workflow is executed. Native-condition controls emit named PostgreSQL conditions; real serialization contention is not simulated.',
      snapshotFile: path.basename(snapshotPath), productionCalls: 0, productionWrites: 0 }, null, 2));
  } finally { await db.close(); }
})().catch(error => { console.error(error.stack, error.detail || ''); process.exitCode = 1; });
