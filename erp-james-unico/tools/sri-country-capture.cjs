const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const out = path.resolve("output/sri-country-release");
fs.mkdirSync(out, {recursive: true});
const project = "bniamjfkjhekfvcyuvio";
function query(sql) {
  if (!/^SELECT\b/i.test(sql.trim())) throw Error("SELECT only");
  const command = "npx --yes supabase db query --linked --project-ref " + project
    + " --output json \"" + sql.replace(/"/g, '\\"') + "\"";
  const result = cp.execSync(command, {encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 90000});
  const parsed = JSON.parse(result.slice(result.indexOf("{")));
  if (!Array.isArray(parsed.rows)) throw Error("Invalid rows");
  return parsed.rows;
}
const mode = process.argv[2] || "before";
if (!["before", "after", "second"].includes(mode)) throw Error("Invalid phase");
const countries = query("SELECT company_id,record_id,payload,version FROM public.erp_entity_records WHERE entity='commercial_countries' AND deleted_at IS NULL AND upper(coalesce(payload->>'status','ACTIVO')) NOT IN ('INACTIVO','INACTIVE') AND coalesce(payload->>'active','true')<>'false' ORDER BY company_id,record_id");
const orders = query("SELECT record_id,payload FROM public.erp_entity_records WHERE company_id='ab60abdc-fe53-4289-9ae2-8f749ee21cff'::uuid AND entity='commercial_orders' AND deleted_at IS NULL AND payload->>'status' IN ('GUARDADO','PENDIENTE') ORDER BY record_id");
const parties = query("SELECT entity,record_id,payload FROM public.erp_entity_records WHERE company_id='ab60abdc-fe53-4289-9ae2-8f749ee21cff'::uuid AND entity IN ('commercial_customers','commercial_brands','commercial_agencies') AND record_id IN ('COM-CLI-noqiym-mtta2ugf','COM-MAR-ier30p-mtsumq9c','COM-AGE-0sxci1-mtt9w0d5') AND deleted_at IS NULL");
const preservation = query("SELECT (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY company_id,record_id)::text,'')) FROM public.erp_entity_records r WHERE entity='commercial_orders') AS orders_hash, (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.commercial_invoice_reservations r) AS reservations_hash, (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.electronic_documents r) AS documents_hash, (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY company_id,order_year)::text,'')) FROM public.commercial_order_sequences r) AS order_sequences_hash, (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) FROM public.electronic_document_sequences r) AS fiscal_sequences_hash");
const reservation = query("SELECT id,full_number,status,environment,consumed_document_id FROM public.commercial_invoice_reservations WHERE company_id='ab60abdc-fe53-4289-9ae2-8f749ee21cff'::uuid AND record_id='COM-DRAFT-gtnrqk-mttanusr'");
fs.writeFileSync(path.join(out, mode + ".json"), JSON.stringify({capturedAt: new Date().toISOString(), countries, orders, parties, preservation, reservation}, null, 2));
console.log(JSON.stringify({mode, countries: countries.length, orders: orders.length, preservation, reservation}));
