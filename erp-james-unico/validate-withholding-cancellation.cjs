// Isolated PostgreSQL/WASM tests. Never opens a network connection or uses production credentials.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5', I='ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const A='11000000-0000-4000-8000-000000000001', O='22000000-0000-4000-8000-000000000002';
const contract=JSON.parse(fs.readFileSync('tests/fixtures/withholding-cancellation-contract.json','utf8'));
const migration=fs.readFileSync('supabase/migrations/202609080010_purchase_withholding_cancellation.sql','utf8');
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
const results=[];
async function main(){
 const db=new PGlite(); const run=s=>db.exec(s),one=async(s,a)=>(await db.query(s,a)).rows[0];
 const login=async(actor=A)=>run(`reset role;select set_config('request.jwt.claim.sub','${actor}',false),set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',${lit(JSON.stringify({sub:actor,role:'authenticated'}))},false);set role authenticated;`);
 async function test(name,fn){await run('reset role;begin');try{await fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:e.message,where:e.where});}finally{await run('rollback;reset role');}}
 const deny=(fn,msg)=>assert.rejects(fn,e=>e.message.includes(msg));
 const state=async d=>(await one('select erp_purchase_withholding_cancellation_state($1,$2) r',[d.company,d.id])).r;
 async function act(d,action,extra={},overrides={}){
   const p=await state(d);
   return (await one('select erp_purchase_withholding_cancel($1,$2,$3,$4,$5,$6,$7,$8,$9) r',[
     overrides.company||d.company,d.id,overrides.operation||randomUUID(),'OFFLINE-FIXTURE',action,
     overrides.version??p.version,overrides.updatedAt||p.documentUpdatedAt,'Corrección solicitada fixture',extra])).r;
 }
 const evidence=d=>({officialStatus:'ANULADO',accessKey:d.key,authorizationNumber:d.key,verifiedInSriOnline:true,
   annulmentDate:d.date,reference:'SRI PORTAL FIXTURE 001',contentType:'application/pdf',fileBase64:Buffer.from('%PDF-1.7\nfixture-only\n%%EOF').toString('base64')});
 async function snapshot(){return one(`select (select jsonb_agg(to_jsonb(x) order by id) from electronic_documents x) docs,
 (select jsonb_agg(to_jsonb(x) order by company_id,environment,document_type,emission_point_id) from electronic_document_sequences x) seq,
 (select jsonb_agg(to_jsonb(x) order by company_id) from sri_settings x) settings,
 (select count(*) from commercial_invoice_reservations) reservations,
 (select count(*) from sri_transmissions) transmissions`);}
 try {
 let base=fs.readFileSync('tests/fixtures/sri-dual-configuration-fixture.sql','utf8');
 const remaining=[];
 for(const t of contract.ddl){
   const pattern=new RegExp(`create table public\\.${t.table}\\([^;]+\\);`,'i');
   if(pattern.test(base)) base=base.replace(pattern,`create table public.${t.table}(${t.columns}${t.table==='erp_entity_records'?', primary key(company_id,entity,record_id)':''});`);
   else remaining.push(`create table public.${t.table}(${t.columns});`);
 }
 await run(base); await run(remaining.join('\n'));
 await run(`alter table erp_supplier_purchase_documents add primary key(company_id,purchase_document_id);
 alter table erp_supplier_purchase_withholding_links add constraint erp_supplier_purchase_withholding_links_pkey primary key(company_id,purchase_document_id);
 alter table erp_supplier_purchase_withholding_links add unique(company_id,electronic_document_id);
 alter table erp_financial_journal_entries add primary key(company_id,journal_entry_id);
 alter table erp_financial_sequence_counters add primary key(company_id,sequence_type,calendar_year);
 create table sri_responses(company_id uuid,document_id uuid,payload jsonb);
 insert into erp_u2c3_mutation_rpc_capabilities values('erp_financial_v2_reverse_journal','FIXED','accounting.journal.reverse');
 insert into auth.users values('${A}'),('${O}'); insert into user_profiles(user_id) values('${A}'),('${O}');
 insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values
 ('${B}','FIXTURE_B','FIXTURE_B','Fixture B','Fixture B','1717637084001'),('${I}','FIXTURE_I','FIXTURE_I','Fixture I','Fixture I','1727970137001');
 insert into user_company_memberships(company_id,user_id,membership_status,membership_role) values('${B}','${A}','ACTIVE','OWNER'),('${I}','${A}','ACTIVE','OWNER'),('${B}','${O}','ACTIVE','OWNER');
 insert into sri_settings(company_id,legal_name,ruc,head_office_address,test_enabled,production_enabled,withholding_agent_number,technical_spec_version)
 values('${B}','Fixture B','1717637084001','Fixture',true,false,'10','2.34'),('${I}','Fixture I','1727970137001','Fixture',true,false,null,'2.34');
 insert into digital_certificates(company_id,alias,storage_object_path,password_secret_name,subject_ruc,fingerprint_sha256,active,validation_status,valid_from,valid_until,last_validated_at)
 select id,'Fixture','companies/'||id||'/certificates/'||repeat('a',64)||'.p12',case id when '${B}' then 'SRI_P12_PASSWORD_BLESS' else 'SRI_P12_PASSWORD_IMPERIO' end,tax_id,repeat('a',64),true,'VALID',now()-interval '1 day',now()+interval '1 year',now() from companies;
 insert into storage.objects select storage_bucket,storage_object_path from digital_certificates;
 insert into sri_company_memberships(company_id,auth_user_id,role_code,active) values('${B}','${A}','CONTADOR',true),('${I}','${A}','CONTADOR',true);
 insert into emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address,active)
 select id,e,'001','002','Fixture',true from companies cross join(values('TEST'),('PRODUCTION')) v(e);
 insert into electronic_document_sequences(company_id,environment,emission_point_id,document_type,next_value)
 select company_id,environment,id,'07',761 from emission_points;
 `);
 for(const cap of ['purchases.withholdings.view','purchases.withholdings.reverse','purchases.withholdings.create','accounting.journal.reverse']){
   const [module,resource,action]=cap.split('.');await db.query('insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description) values($1,$2,$3,$4,$5,$6) on conflict do nothing',[cap,module,resource,action,'HIGH','Offline fixture']);
 }
 await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
 select c.id,'${A}',capability_id,'GRANT','Fixture' from companies c cross join erp_security_capabilities;`);
 await run(fs.readFileSync('supabase/migrations/202609070020_sri_dual_environment_configuration.sql','utf8'));
 // Live definitions preserve financial guards, entry reversal, publication, and read models.
 for(const f of contract.functions) await run(f.definition);
 await run(fs.readFileSync('supabase/migrations/202608200002_purchase_withholding_v2.sql','utf8').match(/create or replace function public\.erp_supplier_v2_withholding_status_from_sri[\s\S]+?\$\$;/)[0]);
 await run(`insert into erp_entity_records(company_id,entity,record_id,payload) select '${B}','accounting_chart_accounts',code,
 jsonb_build_object('code',code,'name',name,'status','activa','isMovement',true,'type','pasivo','nature','acreedora') from (values ('CXP','Cuentas por pagar'),('IR1','Retención IR 1%'),('IVA100','Retención IVA 100%')) v(code,name);
 insert into erp_entity_records(company_id,entity,record_id,payload) values('${B}','accounting_retention_parameters','PARAM_IR1',
 '{"sriCode":"312A","taxType":"RENTA","status":"activo","percentage":1,"payableAccountCode":"IR1","effectiveFrom":"2020-01-01"}'),
 ('${B}','accounting_retention_parameters','PARAM_IVA100',
 '{"sriCode":"3","taxType":"IVA","status":"activo","percentage":100,"payableAccountCode":"IVA100","effectiveFrom":"2020-01-01"}');`);
 const before=await snapshot();await run(migration);await run(migration);assert.deepEqual(await snapshot(),before);
 results.push({name:'Migration repeat preserves existing documents, SRI settings and fiscal counters',result:'PASS'});
 async function fixture({status='BORRADOR',company=B,environment='TEST',type='07'}={}){
   const d={id:randomUUID(),purchase:randomUUID(),provider:randomUUID(),journal:randomUUID(),company,environment};
   const date=(await one("select ((clock_timestamp() at time zone 'America/Guayaquil')::date-1)::text date")).date;d.date=date;
   // Set fixture status at INSERT, never emulate an official authorization in production.
   await run(`insert into electronic_documents(id,company_id,emission_point_id,document_type,status,issue_date,environment,establishment_code,emission_point_code,sequential,sequential_text,full_number,numeric_code,verification_digit,access_key,xml_version,xsd_version,issuer_snapshot,source_snapshot,created_by,authorization_number,authorized_at)
   select '${d.id}',s.company_id,p.id,'${type}','${status}','${date}','${environment}','001','002',760,'000000760','001-002-000000760','85230878',right(v.key,1)::int,v.key,'2.0.0','2.0.0',jsonb_build_object('ruc',s.ruc),'{}','${A}',
    case when '${status}'='AUTORIZADO' then v.key end,case when '${status}'='AUTORIZADO' then clock_timestamp()-interval '1 day' end
   from sri_settings s join emission_points p on p.company_id=s.company_id and p.environment='${environment}'
   cross join lateral(select sri_build_access_key('${date}','${type}',s.ruc,'${environment}','001','002',760,'85230878') key)v where s.company_id='${company}';
   insert into erp_supplier_providers(company_id,provider_id,provider_code,tax_id,legal_name,commercial_name,created_by,last_operation_id) values('${company}','${d.provider}','PROV-FIXTURE','1790000000001','Fixture','Fixture','${A}',gen_random_uuid());
   insert into erp_supplier_purchase_documents(company_id,purchase_document_id,document_code,provider_id,document_type,external_document_number,source_key,issue_date,accounting_date,due_date,total,status,retention_decision,retention_status,created_by,posted_by,last_operation_id,source)
    values('${company}','${d.purchase}','COMP-FIXTURE','${d.provider}','INVOICE','001-001-000000001','FIXTURE','${date}','${date}','${date}',115,'POSTED','APLICAR','DRAFT_CREATED','${A}','${A}',gen_random_uuid(),'MANUAL');
   insert into erp_financial_journal_entries(company_id,journal_entry_id,entry_number,accounting_date,accounting_period,concept,origin_module,source_type,source_id,event_type,status,total_debit,total_credit,created_by,last_operation_id)
    values('${company}','${d.journal}','ASI-FIXTURE','${date}',left('${date}',7),'Retención fixture','Compras','PURCHASE_WITHHOLDING','${d.id}','POST_WITHHOLDING','POSTED',16,16,'${A}',gen_random_uuid());
   insert into erp_financial_journal_lines(company_id,journal_entry_line_id,journal_entry_id,line_number,account_code,account_name_snapshot,debit,credit)
    select '${company}',gen_random_uuid(),'${d.journal}',n,code,code,debit,credit from(values(1,'CXP',16,0),(2,'IR1',0,1),(3,'IVA100',0,15)) x(n,code,debit,credit);
   insert into erp_supplier_purchase_withholding_links(company_id,purchase_document_id,electronic_document_id,journal_entry_id,status,operation_id,created_by,updated_by)
    values('${company}','${d.purchase}','${d.id}','${d.journal}','ACTIVE',gen_random_uuid(),'${A}','${A}');`);
   d.key=(await one('select access_key from electronic_documents where id=$1',[d.id])).access_key;return d;
 }
 async function newDraft(d) {
   await run('reset role');
   const ap=randomUUID();
   await run(`insert into erp_supplier_accounts_payable(company_id,payable_id,provider_id,source_type,source_id,document_number,issue_date,due_date,total,balance,payable_account_code,journal_entry_id,last_operation_id)
    values('${d.company}','${ap}','${d.provider}','PURCHASE_DOCUMENT','${d.purchase}','FIXTURE','${d.date}','${d.date}',115,115,'CXP','${d.journal}',gen_random_uuid());
    update erp_supplier_purchase_documents set payable_id='${ap}' where company_id='${d.company}' and purchase_document_id='${d.purchase}';`);
   const source={erpEmission:{environment:d.environment},erpPurchase:{purchaseDocumentId:d.purchase,operationId:randomUUID(),deviceId:'OFFLINE-FIXTURE',
     journal:{accountingDate:d.date,concept:'New replacement fixture',lines:[{accountCode:'CXP',debit:16,credit:0},{accountCode:'IR1',debit:0,credit:1},{accountCode:'IVA100',debit:0,credit:15}]}},
     withholding:{supportingDocuments:[{retentions:[{code:'1',retentionCode:'312A',rate:1,taxableBase:100,value:1},{code:'2',retentionCode:'3',rate:100,taxableBase:15,value:15}]}]}};
   const point=(await one('select id from emission_points where company_id=$1 and environment=$2',[d.company,d.environment])).id;
   await login();await run(`reset role;select set_config('request.jwt.claim.role','service_role',false),set_config('request.headers','{"x-erp-service":"sri-electronic-documents"}',false);set role service_role;`);
   return (await one('select create_electronic_document_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) r',
     [d.company,point,'07',d.date,'12345678','2.0.0','2.0.0',{ruc:'1717637084001'},{},source,null,null,null,null,A])).r;
 }
 await test('Draft discard reverses CxP/IR/IVA, preserves identity, reopens purchase, second run no delta',async()=>{
   const d=await fixture(),before=await snapshot();await login();let r=await act(d,'DISCARD');assert.equal(r.state,'DISCARDED');assert.deepEqual(r.actions,['REISSUE']);
   await run('reset role');const lines=(await db.query('select account_code,sum(debit-credit)::numeric n from erp_financial_journal_lines group by account_code')).rows;assert(lines.every(x=>Number(x.n)===0));
   const after=await snapshot();assert.deepEqual(after.seq,before.seq);assert.equal(after.docs.length,before.docs.length);assert.equal(after.docs[0].access_key,d.key);
   const counters=await one('select jsonb_agg(to_jsonb(x)) c from erp_financial_sequence_counters x');
   assert.equal(Number(counters.c[0].last_value),1);
   await login();r=await act(d,'DISCARD');assert.equal(r.reused,true);await run('reset role');assert.deepEqual(await one('select jsonb_agg(to_jsonb(x)) c from erp_financial_sequence_counters x'),counters);
   assert.equal((await one('select retention_status from erp_supplier_purchase_documents')).retention_status,'PENDING_ISSUANCE');
   await login();
   const queue=(await one('select erp_purchase_withholding_v2_pending_page($1,50,0) r',[B])).r;
   assert(queue.items.some(row=>row.purchase_document_id===d.purchase&&row.row_kind==='PURCHASE'));
   const reopened=(await one('select erp_purchase_withholding_v2_detail($1,$2,null) r',[B,d.purchase])).r;
   assert.equal(reopened.document,null);assert.equal(reopened.purchase.purchase_document_id,d.purchase);
   const historical=(await one('select erp_purchase_withholding_v2_detail($1,null,$2) r',[B,d.id])).r;
   assert.equal(historical.document.id,d.id);assert.equal(historical.link.status,'CANCELLED');
   for(const key of ['access_key','sequential','environment','company_id','issuer_snapshot','source_snapshot','authorization_number']) assert.deepEqual(after.docs[0][key],before.docs[0][key]);
 });
 await test('Authorized request and portal submission retain fiscal validity; official evidence reverses exactly once',async()=>{
   const d=await fixture({status:'AUTORIZADO'});await login();assert.deepEqual((await state(d)).actions,['REQUEST']);
   assert.equal((await act(d,'REQUEST')).state,'CANCELLATION_REQUESTED');
   assert.equal((await act(d,'SUBMIT_PORTAL_REFERENCE',{accessKey:d.key,reference:'SRI REQUEST FIXTURE'})).state,'PENDING_CANCELLATION');
   await run('reset role');assert.equal((await one('select status from electronic_documents')).status,'AUTORIZADO');assert.equal(Number((await one('select count(*) n from erp_financial_sequence_counters')).n),0);
   await login();const r=await act(d,'CONFIRM_OFFICIAL_ANNULMENT',evidence(d));assert.equal(r.state,'ANULLED');assert.deepEqual(r.actions,['REISSUE']);
   const ev=(await one('select erp_purchase_withholding_cancellation_evidence($1,$2) r',[B,d.id])).r;assert.equal(ev.evidence.source,'SRI_ONLINE_MANUALLY_VERIFIED');assert.equal(ev.evidence.accessKey,d.key);
   assert.equal((await act(d,'CONFIRM_OFFICIAL_ANNULMENT',evidence(d))).reused,true);
   await run('reset role');assert.equal(Number((await one('select count(*) n from erp_financial_journal_entries')).n),2);
   assert.equal((await one('select authorization_number from electronic_documents')).authorization_number,d.key);
 });
 for(const status of ['ENVIADO_SRI','RECIBIDO_SRI','PENDIENTE_REINTENTO','ERROR_ENVIO','DEVUELTO','NO_AUTORIZADO']) await test(status+' exposes no cancellation or replacement',async()=>{
   const d=await fixture({status});await login();assert.deepEqual((await state(d)).actions,[]);await deny(()=>act(d,'DISCARD'),'NOT_ALLOWED');
 });
 await test('Signed document with queued transmission cannot be discarded',async()=>{
   const d=await fixture({status:'FIRMADO'});await run(`insert into sri_transmissions(company_id,document_id,transmission_type,environment,endpoint_url,status,idempotency_key) values('${B}','${d.id}','RECEPTION','TEST','https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline','PENDING','fixture')`);
   await login();assert.deepEqual((await state(d)).actions,[]);
 });
 await test('Unauthorized direct delete of authorized document blocked',async()=>{const d=await fixture({status:'AUTORIZADO'});await login();await deny(()=>db.query('delete from electronic_documents where id=$1',[d.id]),'permission denied');});
 await test('Manual fiscal ANULADO without canonical workflow blocked',async()=>{const d=await fixture({status:'AUTORIZADO'});await run("select set_config('app.sri_registered_annulment','on',true)");await deny(()=>db.query("update electronic_documents set status='ANULADO' where id=$1",[d.id]),'WITHHOLDING_CANONICAL_CANCELLATION_REQUIRED');});
 await test('Changed document version blocks stale UI',async()=>{const d=await fixture();await login();await deny(()=>act(d,'DISCARD',{}, {version:9}),'STALE_VERSION');});
 await test('OWNER without canonical capabilities blocked',async()=>{const d=await fixture();await login(O);await deny(()=>state(d),'CAPABILITY_REQUIRED');});
 await test('Cross-company document blocked',async()=>{const d=await fixture();await login();await deny(()=>state({...d,company:I}),'NOT_FOUND');});
 await test('Inactive membership blocked',async()=>{const d=await fixture();await run(`update user_company_memberships set membership_status='INACTIVE' where company_id='${B}' and user_id='${A}'`);await login();await deny(()=>state(d),'AUTHENTICATED_COMPANY_ACTOR_REQUIRED');});
 await test('Missing reversal capability blocks discard',async()=>{const d=await fixture();await run(`update erp_security_user_capability_overrides set effect='DENY' where capability_id='accounting.journal.reverse'`);await login();assert.deepEqual((await state(d)).actions,[]);});
 for(const [name,patch] of [['missing attachment',{fileBase64:''}],['wrong key',{accessKey:'9'.repeat(49)}],['wrong authorization',{authorizationNumber:'other'}],['pending official state',{officialStatus:'PENDIENTE'}],['no verification',{verifiedInSriOnline:false}]]) await test('Official confirmation rejects '+name,async()=>{
   const d=await fixture({status:'AUTORIZADO'});await login();await act(d,'REQUEST');await act(d,'SUBMIT_PORTAL_REFERENCE',{accessKey:d.key,reference:'SRI FIXTURE'});
   await deny(()=>act(d,'CONFIRM_OFFICIAL_ANNULMENT',{...evidence(d),...patch}),'EVIDENCE');
 });
 await test('Closed accounting period fails atomically without fiscal cancellation',async()=>{
   const d=await fixture();await run(`insert into erp_financial_period_controls(company_id,accounting_period,status) values('${B}',to_char(current_date,'YYYY-MM'),'CLOSED')`);await login();await deny(()=>act(d,'DISCARD'),'PERIOD_CLOSED');
 });
 await test('Discard then canonical new draft uses NEXT 761, new key, same purchase and predecessor; history remains',async()=>{
   const d=await fixture();await login();await act(d,'DISCARD');const replacement=await newDraft(d);
   assert.notEqual(replacement.id,d.id);assert.notEqual(replacement.access_key,d.key);assert.equal(Number(replacement.sequential),761);
   await run('reset role');const link=await one('select * from erp_supplier_purchase_withholding_links where electronic_document_id=$1',[replacement.id]);
   assert.equal(link.previous_electronic_document_id,d.id);assert.equal(link.purchase_document_id,d.purchase);
   assert.equal(Number((await one('select next_value from electronic_document_sequences where company_id=$1 and environment=$2',[B,'TEST'])).next_value),762);
   assert.equal((await one('select status from electronic_documents where id=$1',[d.id])).status,'ANULADO');
   await login();assert.equal((await state(d)).history.length,2);assert.deepEqual((await state(d)).actions,[]);
 });
 await test('Official annulment then new canonical draft uses new fiscal identity',async()=>{
   const d=await fixture({status:'AUTORIZADO'});await login();await act(d,'REQUEST');await act(d,'SUBMIT_PORTAL_REFERENCE',{accessKey:d.key,reference:'PORTAL FIXTURE'});
   await act(d,'CONFIRM_OFFICIAL_ANNULMENT',evidence(d));const next=await newDraft(d);assert.equal(Number(next.sequential),761);assert.notEqual(next.access_key,d.key);
 });
 await test('Pending cancellation create-or-get returns original, consumes no new fiscal number',async()=>{
   const d=await fixture({status:'AUTORIZADO'});await login();await act(d,'REQUEST');await act(d,'SUBMIT_PORTAL_REFERENCE',{accessKey:d.key,reference:'PORTAL FIXTURE'});
   const next=await newDraft(d);assert.equal(next.id,d.id);await run('reset role');assert.equal(Number((await one('select next_value from electronic_document_sequences where company_id=$1 and environment=$2',[B,'TEST'])).next_value),761);
 });
 await test('IMPERIO remains unable to emit Retención 07',async()=>{await deny(()=>fixture({company:I}),'SRI_WITHHOLDING_COMPANY_NOT_ENABLED');});
 await test('Repeated simultaneous discard commands create one reversal only',async()=>{
   const d=await fixture();await login();const p=await state(d);
   const calls=Array.from({length:20},()=>db.query('select erp_purchase_withholding_cancel($1,$2,$3,$4,$5,$6,$7,$8,$9) r',[B,d.id,randomUUID(),'FIXTURE','DISCARD',p.version,p.documentUpdatedAt,'Repeated fixture',{}]));
   const all=await Promise.all(calls);assert(all.every(x=>x.rows[0].r.state==='DISCARDED'));await run('reset role');assert.equal(Number((await one('select count(*) n from erp_financial_journal_entries')).n),2);
 });
 await test('PRODUCTION discard uses same workflow and leaves TEST/PROD counters untouched',async()=>{
   await run('update sri_settings set production_enabled=true');const d=await fixture({environment:'PRODUCTION'}),before=await snapshot();
   await login();await act(d,'DISCARD');await run('reset role');const after=await snapshot();assert.deepEqual(before.seq,after.seq);assert.deepEqual(before.settings,after.settings);assert.equal(after.docs[0].environment,'PRODUCTION');
 });
 await test('Operation replay with changed payload blocked',async()=>{
   const d=await fixture({status:'AUTORIZADO'});await login();const p=await state(d),operation=randomUUID();
   await act(d,'REQUEST',{}, {operation});
   await deny(()=>act(d,'REQUEST',{unexpected:'changed'}, {operation,version:p.version,updatedAt:p.documentUpdatedAt}),'OPERATION_CONFLICT');
 });
 console.log(JSON.stringify({result:results.every(x=>x.result==='PASS')?'PASS':'FAIL',passed:results.filter(x=>x.result==='PASS').length,results,realSriTransmissions:0,realBusinessMutations:0},null,2));
 process.exitCode=results.every(x=>x.result==='PASS')?0:1;
 } finally {await db.close();}
}
main().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1;});
