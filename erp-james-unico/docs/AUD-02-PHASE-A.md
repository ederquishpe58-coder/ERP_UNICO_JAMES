# AUD-02 Phase A: candidate only

## Baseline and scope

- PROD verified 2026-09-12 through authenticated Vercel control plane: `dd38a445f3ad20be85088fd4949c10ff0cb9c6f7`, deployment `dpl_C6SueFXt3nTpcEBEmGZ6gGyTSSHH`.
- Canonical project: `prj_o2JzhrK0BZ85k9F91mIwgwSQxBN8`; canonical domain: `bless-flower-jaeder-prod-indol.vercel.app`.
- Corrected isolated branch: `fix/aud-02-phase-a-guards-20260912`. Original candidate `e36a45fab689b959ab96bf9f8c172a4635655203` and its worktree/evidence are preserved.
- Three served JS files matched this base after EOL normalization: sales-accounting UI, commercial-state, financial-v2-repository. All returned JavaScript, not HTML.
- Installed RPC definitions were read through Supabase Management API `read_only:true`, project `bniamjfkjhekfvcyuvio`. No CLI login-role path, server mutations or SRI calls.
- Source evidence: original `AUD-02-2026-09-10` report/handoff/findings and consolidated decisions. Prior audits remain partial.

## Demonstrated cause and minimal change

`api/sri/_lib/transmission-service.cjs::processAuthorization` called `generateAccountingForDocument` after `record_sri_authorization` / `record_sri_recovery_authorization`. With no matching generation rules, the installed legacy path reports `SRI_ACCOUNTING_RULE_NOT_FOUND` (23514). The baseline service test reproduces the call and error handling using a simulated RPC error; it is not a new real fiscal attempt.

The candidate skips that accounting call only for 01/04. Fiscal persistence, artifacts, identity, RIDE and all 07 behavior remain on their existing paths. Neither accounting helpers nor authorization SQL definitions were changed.

`comercial-state.js::syncSriDocument` no longer calls `syncAuthorizedSale`; `syncSriCreditNote` no longer calls `applyAuthorizedCreditNote`. These fiscal refreshes do not create customers/CxC or label NC as applied. Existing accounting metadata is preserved. The fiscal NC `electronic_documents.credited_total` contract remains unchanged; it is distinct from a V2 receivable balance.

## Canonical inbox

New additive RPC: `erp_financial_v2_sales_inbox(uuid,text,integer,integer,uuid,text,text)`.

- STABLE, SECURITY DEFINER, fixed search_path, company membership/capability through existing `erp_security_assert_capability(...,'accounting.sales.view')`.
- Only authenticated execution; no PUBLIC/anon/service_role execution. No new capability or user grant.
- Fixed PRODUCTION and types 01/04. No inventory-pool resolver: sales/customers remain in the operating company.
- Sources: `commercial_invoice_reservations`, `electronic_documents`, `accounting_document_links`, `erp_financial_receivables`, `erp_financial_credit_notes`, `erp_financial_journal_entries`, and scoped order/customer/settings/legacy CxC/journal records in `erp_entity_records`.
- Reservation/document consolidation uses consumed document ID or complete company/environment/type/full-number identity. Contradictory links are diagnosed, not repaired. No last-digits or customer-name join.
- Aggregated financial links avoid multiplying rows. Legacy entries, reversals, conflicting parents and ambiguous links are not silently declared pending/postable.
- Server-side search, fiscal/accounting filters and paging. Request generations and company checks discard stale reads. Errors are not presented as an empty inbox.
- Native fiscal cycles are shown once in this inbox; existing local/imported documents and received-withholding view remain separate. The legacy import path is not certified as canonical by this change.
- Reads never reserve, create documents, post, create CxC, contact SRI or activate legacy synchronization.

## Explicit posting and limits

`sales-inbox.js::post` requires human confirmation, locks duplicate browser submissions, rereads the requested canonical cycle, and delegates to existing V2 commands. Invoice uses `receivables.postReceivableV2 -> financialV2.postInvoice -> erp_financial_v2_post_invoice`; NC uses the same existing repository/`erp_financial_v2_post_credit_note` with the canonical parent receivable.

Existing mutation authorization is unchanged: invoice `accounting.sales.post`, NC `commercial.credit_notes.post`, plus existing access/command validation. No OWNER bypass. The new read does not confer posting rights.

Existing defaults for local/export CxC, local/export sales and VAT are read by company. Missing/ambiguous settings, missing/inactive customer, contradictory series/type, or non-postable accounts block. No defaults are created or copied. The installed account validator still checks the server's chart inside the transaction.

Vencimiento is reused from an exact existing CxC link or saved order `expireDate`. If not fixed there, the new action blocks for review. Phase A does not select a new credit-term freeze event or recalculate historical due dates. This limitation must be reviewed with AUD-01; it is not silently replaced by current customer terms or a zero-day default.

At the read time, IMPERIO had no configured CxC/sales/VAT defaults. BLESS also returned empty defaults for these fields. This is a configuration observation, not authority to create accounts. Business account approval remains separate.

The corrected candidate adds a private guard to the existing public manual invoice/NC wrappers, after their unchanged capability assertion and before their unchanged V2 engines. Signatures, owners and ACL remain unchanged. Canonical fiscal-document resolution, document-scoped transaction locking, persisted prior-effect/ambiguity checks, raw due-date provenance, parent/company/environment and account-source checks now also run inside the server write boundary. Replaying an unambiguously posted economic act returns its existing IDs without creating another operation, journal, CxC or application. Non-fiscal imported contracts retain their engine, but a mandatory missing due date is no longer silently supplied.

This does not certify every legacy writer or close coexistence reconciliation. Full journal/CxC/portfolio/statement reconciliation, collections and credit-balance policy remain phase B. No historical cleanup, backfill or reversal is included.

## Acceptance corrections R1-R4

- R1: persisted legacy CxC/journal and alternate V2 source references are inspected without browser-cache dependence. Unambiguous V2 posting is acknowledged; legacy/contradictory evidence blocks another economic effect.
- R2: same fiscal NC resolved through its actual UUID/access key/proven legacy alias and canonical parent cannot be applied again under another technical source ID. The original fixture stays at 80 rather than decreasing again to 60. Two distinct legitimate partial NC documents remain possible; this is not a new partial-application policy.
- R3: receivable defaults/normalization and payload formation preserve missing due dates. The server consumes a raw persisted CxC dueDate or saved order expireDate and validates provenance; today/issueDate is not invented as fallback.
- R4: all raw links are evaluated before presentation grouping; identical links may collapse, distinct or contradictory links remain reviewable. Reversing raw row order does not change eligibility. The same check runs in SQL after the document lock.

## Tests

- `npm run validate:aud02:phase-a`: baseline auto-post reproduced for 01/04; candidate TEST/PRODUCTION authorization and repeated-recovery protection; unchanged 07 accounting; actual frontend fiscal-sync functions with accounting metadata retained.
- `npm run validate:aud02:inbox`: PGlite in-memory database, real read RPC and installed posting SQL snapshots, actual JS service/repository/UI. Installed order-save chain and explicit reservation reuse, dedup, paging/filters, wrong company/TEST, valid manual invoice and NC, double confirmation/idempotency, missing/non-postable accounts, prior posted/legacy/cancelled documents, read-only transactions, read failures and stale company responses.
- The auth session/capability data source, generic sync publication, health and browser DOM are fixture boundaries. This is not live James/Alex/RLS verification. Permission errors, rejected ACKs and real SQL validation failures are exercised; not all-success mocks.
- `npm run validate:aud02:acceptance` runs the original commit as a negative control (five scenarios reproducing R1-R4), then the corrected real JS/repository/SQL paths (14 acceptance groups plus the original 11 groups). The eight fiscal groups are separate. Repeated runs are not additional distinct coverage.
- PGlite migration twice, SQL manual posting/replay, stale confirmations, denied access, company/TEST isolation, source identity and missing configuration checks pass. Fiscal records are compared intact before/after fixture calls. Negative-control assertion PASS means the original defect was reproduced, not that its behavior was acceptable.
- **PostgreSQL concurrency gate completed in the next local candidate:** a portable PostgreSQL17.11 cluster reproduced the reverse legacy/V2 race. A narrow legacy write trigger guard fixes it; independent connection/transaction evidence and partial-effect rollback tests now pass. See AUD-02-POSTGRES-CONCURRENCY.md. PGlite remains only earlier fixture evidence, not the concurrency proof.
- PGlite dependency: install/provide `@electric-sql/pglite` in an isolated test toolchain, or set `PGLITE_MODULE` to its local entry file. No URLs or credentials are accepted by the test.
- Existing safe-retry, manual authorization recovery, break-glass policy/service/browser, dual transport and dual document/XSD/signature suites pass with synthetic IO. No actual provider request or certificate is used.
- Build remains `npm run build`; dist is generated, not edited by hand. No supplier-report/Zebra/normal retry policy files changed.

## Migration and future publication

Candidate migration: `202609120002_sales_accounting_pending_inbox.sql`. Version free and RPC absent at `2026-09-12T18:08:43.619405Z`; wrapper definitions read again and version still free at `2026-09-12T18:09:25.662869Z`. Existing internal engines and validator match review evidence; current public wrappers retain their installed authorization and signature. Revalidate immediately before any future approved apply; concurrent work may occupy the version. Existing migrations are untouched. Migration applied twice only in ephemeral PGlite.

Future gates, NOT executed:
1. Revalidate PROD SHA/configuration, installed definitions, migration version and permissions. Integrate only this change if PROD advances; preserve Zebra/supplier/SRI releases.
2. Review the completed real PostgreSQL gate and obtain separate apply/deployment authorization. Apply only this candidate migration: private helpers/inbox, guarded public manual wrappers and the narrow legacy write triggers. Verify owners, preserved wrapper ACL, private helper ACL, trigger scope and read-only inbox scope.
3. Release frontend/backend together after focal tests/build and asset checks. No fiscal/business action in postcheck.
4. Human review of pending rows, accounts and explicit confirmation; no automatic historical posting.

Compatibility: old callers retain the same public RPC signatures but can now receive specific missing-provenance/review errors instead of an unsafe posting. New UI requires the new inbox/evidence contract. DB first, then a compatible frontend/backend release, with old browser sessions controlled before resuming manual accounting. Do not publish a new UI against the old DB.

Rollback planning: Vercel rollback does not revert PostgreSQL. Leave fiscal histories, accounting entries, CxC and sequences untouched. Preserve the 01/04 auto-post disconnection in any rollback build; a wholesale return to the base would reintroduce the original defect. Keep the server guards in place with the old UI (which may need a read-only operational pause). Restoring pre-guard wrappers would reopen R1/R2 and requires a separately reviewed forward-only DB change, not an automatic rollback. Private helpers cannot be removed while guarded wrappers reference them. Do not delete migration history or restore automatic accounting silently.

## Authorization boundary

Local candidate/build/commit only. PROD data/schema/permission changes, real postings/reversals, SRI requests, sequence consumption and deployments during this work: **0**. Normal concurrent production activity was not frozen or attributed to this candidate.

AUD-02 remains open beyond phase A. This document does not authorize publication or historical repair.
