const fs = require("node:fs");
const assert = require("node:assert/strict");
const {PGlite} = require("@electric-sql/pglite");
const before = JSON.parse(fs.readFileSync("output/sri-country-release/before.json"));
const migration = fs.readFileSync("supabase/migrations/202609100001_sri_country_official_234.sql","utf8");
(async()=>{
 const db = new PGlite();
 await db.exec(`CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid primary key,email text);
 INSERT INTO auth.users VALUES('8d1ff40d-6d1c-427e-925e-361dbca834ec','jameslanchimba14@gmail.com');
 CREATE TABLE public.erp_entity_records(company_id uuid,entity text,record_id text,payload jsonb,version bigint,
 deleted_at timestamptz,updated_at timestamptz,last_operation_id uuid,primary key(company_id,entity,record_id));
 CREATE TABLE public.erp_sync_field_audit(operation_id uuid,company_id uuid,entity text,record_id text,field_path text,
 base_value jsonb,local_value jsonb,server_value jsonb,resolution text,user_id uuid,device_id text);`);
 for(const row of before.countries) await db.query("INSERT INTO public.erp_entity_records(company_id,entity,record_id,payload,version) VALUES($1,'commercial_countries',$2,$3,$4)",[row.company_id,row.record_id,row.payload,row.version]);
 await db.exec(migration);
 const read = async()=> (await db.query("SELECT company_id,record_id,payload,version FROM public.erp_entity_records ORDER BY company_id,record_id")).rows;
 const after = await read();
 let changed=0;
 for(let i=0;i<after.length;i++){
   const a=after[i], b=before.countries.find(r=>r.company_id===a.company_id && r.record_id===a.record_id), p={...a.payload};
   if(p.sriCountryCode !== b.payload.sriCountryCode){changed++;assert.match(p.sriCountryCode,/^\d{3}$/);delete p.sriCountryCode;assert.equal(Number(a.version),Number(b.version)+1);}
   assert.deepEqual(p,b.payload);
 }
 assert.equal(changed,JSON.parse(fs.readFileSync("output/sri-country-release/plan.json")).summary.safelyAdded);
 assert.equal(after.find(r=>r.record_id==="COM-PAIS-7mlebo-mtt9qih3").payload.sriCountryCode,"246");
 const audits = await db.query("SELECT count(*)::int AS n FROM public.erp_sync_field_audit");
 assert.equal(audits.rows[0].n,changed);
 await db.exec(migration);
 assert.deepEqual(await read(),after);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.erp_sync_field_audit")).rows[0].n,changed);
 // Concurrent changes must abort atomically rather than overwrite a human edit.
 await db.query("UPDATE public.erp_entity_records SET payload=payload || '{\"sriCountryCode\":\"999\"}'::jsonb WHERE record_id='COM-PAIS-7mlebo-mtt9qih3'");
 await assert.rejects(db.exec(migration),/CONCURRENT_CHANGE/);
 await db.exec("ROLLBACK");
 console.log("PASS catalog migration: "+changed+" audited additions; second delta=0; no other payload fields changed; conflict abort.");
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
