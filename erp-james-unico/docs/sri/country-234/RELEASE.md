# SRI country catalog 2.34

Base PROD: 19af30bc31d12345be131b065f50bb30664eb8b3.
Candidate retained: ef4455105f5006bf2af556e58be87e08663f108d.
Branch: fix/sri-country-validation. No changes to the existing country pipeline
were needed for this release.

Official source: SRI offline specification 2.34, updated July 2026,
table 25, printed pages 80-82. Downloaded from the official portal link.
SHA256: 7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9.
Georgia is 246 on page 81, checked both by extraction and rendered page.
source-table.json records the complete extracted table and URL.

The audited catalog contains 505 active records across BLESS and IMPERIO.
All 505 lack a nonempty SRI mapping before this migration; invalid codes: 0.
337 records have exact, unique normalized-name matches and no known historical
alternative entries. 168 remain NEEDS_REVIEW. No ISO conversion, guessed aliases,
telephone prefixes or country IDs are used to derive a fiscal code.
audit-plan.json lists every record, decision and official match.

Migration 202609100001_sri_country_official_234.sql is forward-only and explicit.
It only adds payload.sriCountryCode, advances canonical record version and
updated_at/last_operation_id, and appends erp_sync_field_audit entries.
The audit identifies James as the verified migration requestor; execution is
infrastructure-authorized, not a James browser/RLS session.
Compare-and-swap of the entire prior payload and version aborts concurrent edits.
Repeated application leaves payloads, versions and audit rows unchanged.
Existing ISO, names, internal codes, country IDs, orders and fiscal data are unchanged.

Local PostgreSQL (PGlite) tests apply the full migration to captured catalog rows,
verify 337 exact changes and audit entries, apply it again with delta 0, and
prove that a contradictory concurrent edit aborts the transaction.

The real-order in-memory dry-run uses persisted order/customer/brand/agency
records, the real catalog loader and normalization, localContext, actual
getOrderMetrics and buildInvoicePayload. It does not call any mutation API.
PED-COM-2026-0003 resolves GEORGIA to 246 with destinationId still empty.
Reservation 4190b9f7-8b44-4dfe-a1f4-e1843c057656 remains
001-002-000000748, ACTIVE, PRODUCTION, consumed_document_id NULL.

32 saved/pending IMPERIO export orders inspected: 29 country-ready, 3 missing,
0 ambiguous order references. The remaining cases are:
- PED-COM-2026-0019: NETHERLANDS, no exact match to official full denomination.
- PED-COM-2026-0009: KYRGYSTAN, no exact match to official denomination.
- PED-COM-2026-0013: KYRGYSTAN, same reason.
These are left blocked for mapping review; no order needs to be recreated.

Verification commands:
- node validate-sri-country-migration.cjs
- node validate-sri-country-real-case.cjs planned
- node validate-sri-country-real-case.cjs after
- node validate-sri-country-pipeline.cjs
- node validate-sri-country-pipeline.cjs dist
- node validate-sri-country-reader.cjs
- npm run validate:sri:companies
- npm run validate:sri:documents-grid
- npm run build

Infrastructure captures under output/sri-country-release are excluded from
deployment and Git. Before/after hashes cover all orders, invoice reservations,
electronic documents, commercial order sequences and electronic document sequences.
No certificate, signer, fiscal transport/recovery, permission/profile, activation,
accounting, inventory, credit note or withholding implementation changes.

Menu SRI IMPERIO remains a separate issue. Read-only effective-plan inspection
found commercial.electronic_documents.view/create/correct/authorize for James
in IMPERIO (GERENCIA_GENERAL), as well as commercial.countries.view.
This does not establish browser visibility or membership in the separate SRI
service; root cause is not diagnosed and no access changes are included.
