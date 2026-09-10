const fs = require("node:fs");
const assert = require("node:assert/strict");
const plan = JSON.parse(fs.readFileSync("output/sri-country-release/plan.json"));
assert.equal(plan.source.version, "2.34");
assert.equal(plan.source.sha256, "7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9");
const entries = plan.rows.filter(row => row.status === "ADD").map(row => ({
  company_id: row.company_id, record_id: row.record_id, expected_payload: row.payload,
  expected_version: row.version, sri_code: row.matches[0].code,
  official_name: row.matches[0].name, official_page: row.matches[0].page
}));
assert.ok(entries.some(row => row.record_id === "COM-PAIS-7mlebo-mtt9qih3" && row.sri_code === "246"));
const json = JSON.stringify(entries);
assert.ok(!json.includes("$countries$"));
const sql = `-- SRI offline 2.34, July 2026, table 25, pages 80-82.
-- Source SHA256: ${plan.source.sha256}
-- Source: ${plan.source.url}
-- Forward-only approved exact matches; no ISO conversion; no historical edits.
-- Audited in erp_sync_field_audit; only country payload.sriCountryCode is added.
BEGIN;
DO $migration$
DECLARE
 target record;
 current_row public.erp_entity_records%rowtype;
 operation uuid;
 changed integer := 0;
 actor constant uuid := '8d1ff40d-6d1c-427e-925e-361dbca834ec';
BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=actor AND email='jameslanchimba14@gmail.com') THEN
   RAISE EXCEPTION 'SRI_COUNTRY_MIGRATION_REQUESTOR_NOT_VERIFIED';
 END IF;
 FOR target IN SELECT * FROM jsonb_to_recordset($countries$${json}$countries$::jsonb)
 AS x(company_id uuid,record_id text,expected_payload jsonb,expected_version bigint,sri_code text,official_name text,official_page integer)
 LOOP
   SELECT * INTO STRICT current_row FROM public.erp_entity_records
   WHERE company_id=target.company_id AND entity='commercial_countries' AND record_id=target.record_id FOR UPDATE;
   IF current_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SRI_COUNTRY_RECORD_CHANGED: %',target.record_id; END IF;
   IF current_row.payload = target.expected_payload || jsonb_build_object('sriCountryCode',target.sri_code) THEN
     CONTINUE;
   END IF;
   IF current_row.payload <> target.expected_payload OR current_row.version <> target.expected_version THEN
     RAISE EXCEPTION 'SRI_COUNTRY_CONCURRENT_CHANGE: %',target.record_id;
   END IF;
   IF target.sri_code !~ '^[0-9]{3}$' OR EXISTS (
      SELECT 1 FROM jsonb_each_text(current_row.payload) field
      WHERE field.key IN ('sriCountryCode','sri_country_code','sriCode','sri_code','countrySriCode',
        'country_sri_code','codigoSri','codigo_sri','codigoSriPais','codigo_sri_pais')
      AND btrim(coalesce(field.value,'')) <> ''
   ) THEN RAISE EXCEPTION 'SRI_COUNTRY_NONEMPTY_MAPPING: %',target.record_id; END IF;
   operation := gen_random_uuid();
   INSERT INTO public.erp_sync_field_audit(operation_id,company_id,entity,record_id,field_path,
     base_value,local_value,server_value,resolution,user_id,device_id)
   VALUES(operation,target.company_id,'commercial_countries',target.record_id,'sriCountryCode',
     current_row.payload->'sriCountryCode',to_jsonb(target.sri_code),to_jsonb(target.sri_code),
     'SRI_OFFLINE_2.34_TABLE25_PAGE_' || target.official_page || ': ' || target.official_name,
     actor,'MIGRATION-202609100001-SRI-COUNTRIES');
   UPDATE public.erp_entity_records
   SET payload=payload || jsonb_build_object('sriCountryCode',target.sri_code),
       version=version+1,updated_at=now(),last_operation_id=operation
   WHERE company_id=target.company_id AND entity='commercial_countries' AND record_id=target.record_id;
   changed := changed+1;
 END LOOP;
 RAISE NOTICE 'SRI_COUNTRY_MAPPING_DELTA=%',changed;
END $migration$;
COMMIT;
`;
const file = "supabase/migrations/202609100001_sri_country_official_234.sql";
fs.writeFileSync(file, sql);
fs.mkdirSync("docs/sri/country-234", {recursive:true});
fs.writeFileSync("docs/sri/country-234/source-table.json", JSON.stringify({source:plan.source, table:plan.official},null,2));
fs.writeFileSync("docs/sri/country-234/audit-plan.json",JSON.stringify({summary:plan.summary,
  rows:plan.rows.map(r=>({companyId:r.company_id,id:r.record_id,name:r.payload.name,iso2:r.payload.iso2,iso3:r.payload.iso3,
    status:r.status,reason:r.reviewReason,official:r.matches}))},null,2));
console.log(file, entries.length, "approved exact matches");
