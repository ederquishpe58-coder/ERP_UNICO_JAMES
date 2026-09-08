const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require('C:/Users/Contador J/Documents/ERP_UNICO_JAMES/node_modules/@electric-sql/pglite'));}
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff',A='11000000-0000-4000-8000-000000000001',O='22000000-0000-4000-8000-000000000002';
const lit=x=>"'"+String(x).replaceAll("'","''")+"'",results=[];
const { endpointFor }=require('./api/sri/_lib/environment.cjs');
async function main(){
 const db=new PGlite(),run=sql=>db.exec(sql),one=async(sql,args)=>(await db.query(sql,args)).rows[0];
 const migration=fs.readFileSync('supabase/migrations/202609080001_sri_withholding_date_return_recovery.sql','utf8');
 async function login(actor=A,role='service_role'){await run(`reset role;select set_config('request.jwt.claim.sub',${lit(actor)},false),set_config('request.jwt.claim.role',${lit(role)},false),set_config('request.jwt.claims',${lit(JSON.stringify({sub:actor,role}))},false);set role ${role};`);}
 async function test(name,fn){await run('reset role;begin');try{await fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:e.message});}finally{await run('rollback;reset role');}}
 const call=(d,actor=A,company=d.company)=>one('select erp_sri_retry_returned_withholding_date($1,$2,$3,$4,$5,$6) r',[company,d.id,actor,d.query,d.attempt,d.receipt]);
 async function deny(fn,message){await assert.rejects(fn,e=>e.message.includes(message));}
 async function snapshot(){return one(`select (select jsonb_agg(to_jsonb(x) order by company_id,environment,document_type) from electronic_document_sequences x) seq,
 (select jsonb_agg(to_jsonb(x)) from accounting_document_links x) accounting,
 (select count(*) from commercial_invoice_reservations) reservations,(select count(*) from electronic_documents) documents,
 (select jsonb_agg(to_jsonb(x) order by company_id) from sri_settings x) settings`);}
 try{
 await run(fs.readFileSync('tests/fixtures/sri-dual-configuration-fixture.sql','utf8'));
 await run(`alter table electronic_document_files add column id uuid default gen_random_uuid(),add column company_id uuid,add column file_type text,add column immutable boolean default true,
 add column storage_bucket text default 'sri-private',add column storage_object_path text,add column content_sha256 text;
 create table sri_responses(id uuid primary key default gen_random_uuid(),company_id uuid not null,document_id uuid not null,transmission_id uuid not null,
 response_type text not null,sri_status text,raw_xml text not null,payload jsonb not null default '{}',content_sha256 text not null,received_at timestamptz not null default now(),created_at timestamptz not null default now());
 insert into auth.users values('${A}'),('${O}');insert into user_profiles(user_id) values('${A}'),('${O}');
 insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values
 ('${B}','FIXTURE_B','FIXTURE_B','Fixture B','Fixture B','1717637084001'),('${I}','FIXTURE_I','FIXTURE_I','Fixture I','Fixture I','1727970137001');
 insert into user_company_memberships(company_id,user_id,membership_status,membership_role) values('${B}','${A}','ACTIVE','OWNER'),('${I}','${A}','ACTIVE','OWNER'),('${B}','${O}','ACTIVE','OWNER');
 insert into sri_settings(company_id,legal_name,ruc,head_office_address,test_enabled,production_enabled,withholding_agent_number,technical_spec_version)
 values('${B}','Fixture B','1717637084001','Fixture',true,false,'10','2.34'),('${I}','Fixture I','1727970137001','Fixture',true,false,null,'2.34');
 insert into digital_certificates(company_id,alias,storage_object_path,password_secret_name,subject_ruc,fingerprint_sha256,active,validation_status,valid_from,valid_until,last_validated_at)
 select id,'Fixture','companies/'||id||'/certificates/'||repeat('a',64)||'.p12',case id when '${B}' then 'SRI_P12_PASSWORD_BLESS' else 'SRI_P12_PASSWORD_IMPERIO' end,tax_id,repeat('a',64),true,'VALID',now()-interval '1 day',now()+interval '1 year',now() from companies;
 insert into storage.objects select storage_bucket,storage_object_path from digital_certificates;
 insert into emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address,active) select id,e,'001','002','Fixture',true from companies cross join(values('TEST'),('PRODUCTION')) v(e);
 insert into electronic_document_sequences(company_id,environment,emission_point_id,document_type,next_value) select company_id,environment,id,'07',747 from emission_points;
 `);
 for(const cap of ['purchases.withholdings.create','commercial.electronic_documents.authorize']){const [m,r,a]=cap.split('.');await db.query('insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description) values($1,$2,$3,$4,$5,$6) on conflict do nothing',[cap,m,r,a,'HIGH','Fixture']);}
 await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) select c.id,'${A}',capability_id,'GRANT','Fixture' from companies c cross join erp_security_capabilities;`);
 for(const file of ['202609070020_sri_dual_environment_configuration.sql','202609070021_sri_dual_environment_document_guards.sql'])await run(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await run(`update sri_settings set production_enabled=true;`);
 const before=await snapshot();await run(migration);await run(migration);assert.deepEqual(await snapshot(),before);results.push({name:'Forward migration twice preserves rows, counters, settings',result:'PASS'});
 async function fixture({company=B,environment='PRODUCTION',type='07',dateOffset=0,receiptToday=false,status='DEVUELTO'}={}){
   const d={id:randomUUID(),company,receipt:randomUUID(),query:randomUUID(),attempt:randomUUID(),receptionJob:randomUUID(),queryJob:randomUUID(),file:randomUUID()};
   await run(`insert into electronic_documents(id,company_id,emission_point_id,document_type,status,issue_date,environment,establishment_code,emission_point_code,sequential,sequential_text,full_number,numeric_code,verification_digit,access_key,xml_version,xsd_version,issuer_snapshot,source_snapshot,created_by)
    select '${d.id}',s.company_id,p.id,'${type}','${status}',v.dt,'${environment}','001','002',746,'000000746','001-002-000000746','85230878',right(v.key,1)::int,v.key,'${type==='07'?'2.0.0':'1.1.0'}','${type==='07'?'2.0.0':'1.1.0'}',jsonb_build_object('ruc',s.ruc),'{}','${A}'
    from sri_settings s join emission_points p on p.company_id=s.company_id and p.environment='${environment}'
    cross join lateral(select (clock_timestamp() at time zone 'America/Guayaquil')::date+${dateOffset} dt) date
    cross join lateral(select date.dt,sri_build_access_key(date.dt,'${type}',s.ruc,'${environment}','001','002',746,'85230878') key) v where s.company_id='${company}';
    insert into electronic_document_files(document_id,id,company_id,file_type,content_sha256,storage_object_path) values('${d.id}','${d.file}','${company}','SIGNED_XML',repeat('b',64),'companies/${company}/documents/${d.id}/signed_xml-'||repeat('b',64)||'.xml');
    insert into sri_transmissions(id,company_id,document_id,transmission_type,environment,endpoint_url,status,idempotency_key,attempt_number,max_attempts,request_file_id)
    values('${d.receptionJob}','${company}','${d.id}','RECEPTION','${environment}','${endpointFor(environment,'RECEPTION')}','COMPLETED','${d.id}:RECEPTION',1,12,'${d.file}'),
    ('${d.queryJob}','${company}','${d.id}','AUTHORIZATION_QUERY','${environment}','${endpointFor(environment,'AUTHORIZATION_QUERY')}','PROCESSING','${d.id}:AUTHORIZATION_QUERY',1,12,null);
    insert into sri_responses(id,company_id,document_id,transmission_id,response_type,sri_status,raw_xml,payload,content_sha256,received_at)
    select '${d.receipt}','${company}','${d.id}','${d.receptionJob}','RECEPTION','DEVUELTA','<fixture/>',jsonb_build_object('returned',true,'messages',jsonb_build_array(jsonb_build_object('identifier','65')),'receipts',jsonb_build_array(jsonb_build_object('accessKey',access_key))),repeat('c',64),${receiptToday?'clock_timestamp()':"((issue_date::timestamp at time zone 'America/Guayaquil')-interval '5 minutes')"} from electronic_documents where id='${d.id}';
    insert into sri_transmission_attempts(company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256,response_sha256) values('${company}','${d.id}','${d.receptionJob}',1,'SUCCEEDED','${endpointFor(environment,'RECEPTION')}',repeat('b',64),repeat('c',64));
    insert into sri_responses(id,company_id,document_id,transmission_id,response_type,sri_status,raw_xml,payload,content_sha256)
    select '${d.query}','${company}','${d.id}','${d.queryJob}','AUTHORIZATION','NO_ENCONTRADO','<numeroComprobantes>0</numeroComprobantes>',jsonb_build_object('state','NO_ENCONTRADO','accessKey',access_key,'documentCount',0,'authorized',false,'authorizations','[]'::jsonb,'messages','[]'::jsonb),repeat('d',64) from electronic_documents where id='${d.id}';
    insert into sri_transmission_attempts(id,company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256)
    select '${d.attempt}','${company}','${d.id}','${d.queryJob}',1,'STARTED','${endpointFor(environment,'AUTHORIZATION_QUERY')}',encode(sha256(convert_to(access_key,'UTF8')),'hex') from electronic_documents where id='${d.id}';
    insert into accounting_document_links values('${company}','${d.id}','POSTED');`);
   return d;
 }
 await test('Canonical RPC requeues same 746 and same jobs; zero sequence/document/journal delta',async()=>{
   const d=await fixture(),state=await snapshot(),original=await one('select to_jsonb(d) d from electronic_documents d where id=$1',[d.id]);
   await login();const first=(await call(d)).r;assert.equal(first.requeued,true);assert.equal(first.sequential,746);
   await run('reset role');const after=await one('select to_jsonb(d) d from electronic_documents d where id=$1',[d.id]);
   for(const field of ['status','updated_at','updated_by']){delete original.d[field];delete after.d[field];}assert.deepEqual(after,original);
   assert.deepEqual(await snapshot(),state);
   const hashes=await one("select (select md5(jsonb_agg(to_jsonb(t))::text) from sri_transmissions t) jobs,(select count(*) from electronic_document_audit_logs) audits");
   await login();assert.equal((await call(d)).r.requeued,false);await run('reset role');
   assert.deepEqual(await one("select (select md5(jsonb_agg(to_jsonb(t))::text) from sri_transmissions t) jobs,(select count(*) from electronic_document_audit_logs) audits"),hashes);
   assert.deepEqual(await snapshot(),state);
 });
 for(const [name,options,patch,error] of [
 ['Wrong company',{},null,'SRI_DOCUMENT_NOT_FOUND'],
 ['Future date',{dateOffset:1},null,'NOT_RECOVERABLE'],['Expired date',{dateOffset:-1},null,'NOT_RECOVERABLE'],
 ['Invoice01',{type:'01'},null,'NOT_RECOVERABLE'],
 ['NO_AUTORIZADO',{status:'NO_AUTORIZADO'},null,'NOT_RECOVERABLE'],
 ['Same-day rejection', {receiptToday:true},null,'RECEIPT_REQUIRED'],
 ['Other reception error',{},d=>`update sri_responses set payload=jsonb_set(payload,'{messages,0,identifier}','"45"') where id='${d.receipt}'`,'RECEIPT_REQUIRED'],
 ['Wrong response company',{},d=>`update sri_responses set company_id='${I}' where id='${d.query}'`,'ABSENCE_REQUIRED'],
 ['Pending official response',{},d=>`update sri_responses set payload=jsonb_set(payload,'{documentCount}','1') where id='${d.query}'`,'ABSENCE_REQUIRED'],
 ['Missing raw count',{},d=>`update sri_responses set raw_xml='<fixture/>' where id='${d.query}'`,'ABSENCE_REQUIRED'],
 ['Wrong lookup key',{},d=>`update sri_responses set payload=jsonb_set(payload,'{accessKey}','"wrong"') where id='${d.query}'`,'ABSENCE_REQUIRED'],
 ['Stale lookup attempt',{},d=>`update sri_transmission_attempts set started_at=now()-interval '1 hour' where id='${d.attempt}'`,'LIVE_AUTHORIZATION_ATTEMPT_REQUIRED'],
 ['Exhausted reception',{},d=>`update sri_transmissions set attempt_number=max_attempts where id='${d.receptionJob}'`,'RECEPTION_NOT_REQUEUEABLE'],
 ['Wrong signed file',{},d=>`update electronic_document_files set company_id='${I}' where id='${d.file}'`,'SIGNED_FILE_REQUIRED'],
 ['TEST job cannot serve PROD',{},d=>`alter table sri_transmissions disable trigger all;update sri_transmissions set environment='TEST',endpoint_url='${endpointFor('TEST','AUTHORIZATION_QUERY')}' where id='${d.queryJob}';alter table sri_transmissions enable trigger all`,'LIVE_AUTHORIZATION_ATTEMPT_REQUIRED'],
 ['PROD OFF',{},()=>`update sri_settings set production_enabled=false where company_id='${B}'`,'PRODUCTION_DISABLED'],
 ['Invalid certificate',{},()=>`update digital_certificates set valid_until=now()-interval '1 day' where company_id='${B}'`,'VALID_CANONICAL_CERTIFICATE_REQUIRED'],
 ['Inactive membership',{},()=>`update user_company_memberships set membership_status='INACTIVE' where company_id='${B}' and user_id='${A}'`,'TRANSPORT_ACTOR_REQUIRED']
 ])await test(name+' blocked by real PostgreSQL RPC',async()=>{const d=await fixture(options);if(patch)await run(patch(d));await login();await deny(()=>call(d,A,name==='Wrong company'?I:d.company),error);});
 await test('IMPERIO 07 remains blocked before transmission creation',async()=>{await deny(()=>fixture({company:I}),'SRI_WITHHOLDING_COMPANY_NOT_ENABLED');});
 await test('NC without parent remains blocked by canonical NC guard',async()=>{await deny(()=>fixture({type:'04'}),'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE');});
 await test('Explicit capability DENY wins',async()=>{const d=await fixture();await run(`update erp_security_user_capability_overrides set effect='DENY' where company_id='${B}' and user_id='${A}' and capability_id='purchases.withholdings.create'`);await login();await deny(()=>call(d),'CAPABILITY_REQUIRED');});
 await test('OWNER without capabilities blocked',async()=>{const d=await fixture();await login(O);await deny(()=>call(d,O),'CAPABILITY_REQUIRED');});
 for(const role of ['authenticated','anon'])await test(role+' cannot call requeue directly',async()=>{const d=await fixture();await login(A,role);await deny(()=>call(d),'permission denied');});
 await test('Direct status update without audited RPC is blocked',async()=>{const d=await fixture();await deny(()=>run(`update electronic_documents set status='ENVIADO_SRI' where id='${d.id}'`),'SRI_STATUS_TRANSITION_NOT_ALLOWED');});
 await test('TEST recovery retains environment and all counters',async()=>{const d=await fixture({environment:'TEST'}),before=await snapshot();await login();assert.equal((await call(d)).r.environment,'TEST');await run('reset role');assert.deepEqual(await snapshot(),before);});
 console.log(JSON.stringify({result:results.every(x=>x.result==='PASS')?'PASS':'FAIL',passed:results.filter(x=>x.result==='PASS').length,results,realDatabaseWrites:0},null,2));
 process.exitCode=results.every(x=>x.result==='PASS')?0:1;
 }finally{await db.close();}
}
main().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1;});
