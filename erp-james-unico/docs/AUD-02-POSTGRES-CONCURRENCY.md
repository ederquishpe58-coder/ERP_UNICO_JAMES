# AUD-02 Phase A: real PostgreSQL concurrency gate

Candidate tested first: 1e5bf54b4f81936c1382bff83f9cb7022e53971b.
Only this gate was executed; no PROD connection or deployment.

## Reproduced race

On PostgreSQL 17.11, two independent backend processes and transaction IDs
were observed through pg_stat_activity / pg_blocking_pids.

- V2 invoice versus V2 invoice: one journal and one CxC, including distinct
  operation IDs and UUID versus access-key source representations.
- V2 NC20 versus V2 NC20 on balance100: one NC effect, balance80, never60.
- The reverse legacy/V2 order failed in the original candidate: V2 committed
  while generate_sri_accounting_entry waited for the fiscal row lock. After
  obtaining the lock the legacy generator inserted another journal because
  it did not inspect V2. The exact installed legacy function was executed,
  not replaced by a success mock.

The failure is recorded in the external lab original-candidate-results.json.
The legacy raw-entity case in that first run had an explicit scheduling lock
and was NOT treated as proof that the old entity writer already used that lock.
The final tests remove that scheduling lock from the raw legacy writer.

## Minimal fix

The still-unapplied candidate migration adds one private trigger function,
erp_financial_v2_guard_legacy_sales_write, and two narrow BEFORE triggers:

1. journal_entries: only SRI-linked journal writes.
2. erp_entity_records: only customer_receivables/accounting_journal_entries
   carrying a posted journal/status or credit-note application evidence.

Both resolve only related company/PRODUCTION/01-or-04 fiscal identities using
the existing candidate reference resolver, acquire the same fiscal row lock
used by the V2 guard, and reread prior effects after the lock. A prior V2 act
or ambiguous reference rejects the entire legacy statement. No table-wide
lock, new company mapping, grant, account, or historical rewrite is added.
The underlying legacy generator and V2 posting engines remain unchanged.
07 and unrelated company writes are explicit negative scope controls.

## Final result and scope

12 cases pass, including 10 controlled transaction races with two independent
connections, same/distinct operation IDs, both legacy/V2 directions, raw
legacy evidence without an artificial lock, and ambiguous links.

The failure-injection case rejects a real NC transaction after its journal,
credit row and balance update have happened. SQL error DETAIL observes80
inside the aborted transaction. After rollback the waiting transaction
applies exactly once: balance80, one journal, one credit effect.
An aborted invoice transaction also leaves one complete winning journal/CxC.
No orphan V2 journal/CxC/NC, extra loser command, or incorrect legacy POSTED
link/audit row remains.

These tests exercise PostgreSQL READ COMMITTED transactions, installed engine
snapshots and the actual candidate SQL. Tables/auth identities and the generic
publisher are isolated fixtures, not a James/Alex session or a certification
of live RLS. Historical dangling legacy references in ambiguity fixtures are
inputs to block, not partial effects created by the losing transaction.

The prior11 SQL/service/repository/UI groups and14 adversarial groups also
passed on real PostgreSQL using the existing harness with only its in-memory
adapter replaced. The8 fiscal groups passed with synthetic provider IO.
PGlite was not used for this gate. Build: npm run build PASS.

## Reproduction

Use only an isolated loopback PostgreSQL17 test cluster. No service install:
the executed lab used portable EDB binaries linked from postgresql.org.
Host127.0.0.1, port55432, database aud02_multisession, user lab_admin,
data-directory marker AUD-02-PG-MULTISESSION-20260912/pgdata.
The runner verifies these before resetting fixture schemas; never point it
at another database. It deliberately has no configurable remote connection URL.

Provide node-postgres through PG_TEST_MODULE (local module file) or the isolated
toolchain's pg package. Set AUD02_PG_EVIDENCE_DIR to an existing directory outside
the app, then run npm run validate:aud02:postgres.
No application code, credentials, or SRI endpoints are loaded as connections.
Stop the temporary cluster after testing; keep evidence separately.

## Publication remains separate

No migration applied on a server and no PROD state verified anew in this gate.
202609120002 must still be checked for availability and installed dependencies
immediately before a future authorized apply, together with the current PROD
baseline. Apply only the reviewed candidate migration.
DB guards and compatible frontend/backend are separate release components.
Vercel rollback does not remove triggers or revert SQL; removing the new guards
reopens the demonstrated race and requires separate approval.
No historical repair or phase B is included.
