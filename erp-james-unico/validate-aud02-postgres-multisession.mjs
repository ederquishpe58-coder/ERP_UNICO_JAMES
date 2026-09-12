import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const pg = (await import(process.env.PG_TEST_MODULE ? pathToFileURL(process.env.PG_TEST_MODULE).href : 'pg')).default;

const root=process.argv[2] || process.cwd();
const outputDirectory=process.env.AUD02_PG_EVIDENCE_DIR;
const appRoot=path.resolve(root).toLowerCase(), reportRoot=path.resolve(outputDirectory||root).toLowerCase();
if(!outputDirectory || reportRoot===appRoot || reportRoot.startsWith(appRoot+path.sep))throw Error('EXTERNAL_EVIDENCE_DIRECTORY_REQUIRED');
const config={host:'127.0.0.1',port:55432,user:'lab_admin',database:'aud02_multisession',application_name:'AUD02_GATE',connectionTimeoutMillis:5000,password:'',ssl:false};
const clients=[];
async function client(name){
 const c=new pg.Client({...config,application_name:name});await c.connect();clients.push(c);
 await c.query("set statement_timeout='15s';set lock_timeout='12s'");
 return c;
}
const monitor=await client('AUD02_MONITOR');
const identity=(await monitor.query("select version(),current_database() db,inet_server_addr() host,inet_server_port() port,current_setting('data_directory') dir")).rows[0];
assert.equal(identity.db,config.database);assert.equal(identity.host,'127.0.0.1');
assert.ok(identity.dir.replaceAll('\\','/').includes('/AUD-02-PG-MULTISESSION-20260912/pgdata'));
const results=[];
try{
 await monitor.query('drop schema public cascade;create schema public;drop schema if exists auth cascade');
 const names=['anon','authenticated','service_role'];
 for(const role of names)if(!(await monitor.query('select 1 from pg_roles where rolname=$1',[role])).rowCount)await monitor.query('create role '+role);
 let harness=await readFile(root+'/validate-aud02-sales-inbox.mjs','utf8');
 harness=harness.slice(0,harness.indexOf('const calls=[];'));
 harness=harness.replace(/const \{PGlite\} = .*?;\r?\nconst db = new PGlite\(\);/,
  'const db=globalThis.__auditPg;');
 harness=harness.replace(/const read = name=>.*;/,'const read=name=>readFile('+JSON.stringify(root+'/')+'+name,"utf8");');
 harness=harness.replace('create role anon; create role authenticated; create role service_role;','');
 globalThis.__auditPg={query:(q,args)=>monitor.query(q,args),exec:q=>monitor.query(q)};
 const bootstrap=await import('data:text/javascript;base64,'+Buffer.from(harness+'\nexport {B,I,id,doc,entity,defaults,actor};').toString('base64'));
 const {B,id,doc,entity,actor}=bootstrap;
 const A=await client('AUD02_TX_A'),Btx=await client('AUD02_TX_B');
 for(const c of [A,Btx])await c.query("set test.company='"+B+"';set test.allowed='yes';set test.post_allowed='yes'");
 const pids=await Promise.all([A,Btx].map(async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid));
 assert.notEqual(...pids);
 async function payload(n,type='01'){
  const d=(await monitor.query('select * from electronic_documents where id=$1',[id(n)])).rows[0];
  const ar=type==='04'?(await monitor.query('select receivable_id from erp_financial_receivables where electronic_document_id=$1',[d.parent_document_id])).rows[0]?.receivable_id:null;
  return {sourceId:d.id,electronicDocumentId:d.id,documentNumber:d.full_number,issueDate:'2026-09-12',dueDate:'2026-09-12',customerId:'customer',customerTaxId:'FIXTURE-TAX',customerName:'Fixture',documentType:'factura sri',accessKey:d.access_key,subtotal:d.subtotal,taxTotal:d.tax_total,total:d.grand_total,receivableAccountCode:'AR',counterAccountCode:'SALES',revenueAccountCode:'SALES',receivableId:ar};
 }
 const post=(c,p,type='01',op=randomUUID())=>c.query('select '+(type==='01'?'erp_financial_v2_post_invoice':'erp_financial_v2_post_credit_note')+'($1,$2,$3,$4,$5) result',[op,B,'isolated-fixture',p,'2026-09-12']).then(r=>r.rows[0].result);
 async function waitBlocked(){
  for(let i=0;i<150;i++){
   const r=(await monitor.query('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[pids[1]])).rows[0];
   if(r?.blockers.includes(pids[0]))return r;
   await new Promise(r=>setTimeout(r,20));
  }throw Error('INDEPENDENT_TX_BLOCKING_NOT_OBSERVED');
 }
 async function race(name,first,second,verify,{rollbackA=false}={}){
  await A.query('begin isolation level read committed');await Btx.query('begin isolation level read committed');
  const txids=[(await A.query('select txid_current() id')).rows[0].id,(await Btx.query('select txid_current() id')).rows[0].id];
  let a,b,blocked;
  try{
   a=await first(A);
   const pending=second(Btx).then(value=>({ok:true,value}),error=>({ok:false,code:error.code,message:error.message}));
   blocked=await waitBlocked();
   await A.query(rollbackA?'rollback':'commit');
   b=await pending;
   await Btx.query(b.ok?'commit':'rollback');
   const state=await verify(a,b);
   results.push({name,pass:true,pids,txids,blocked,a,b,state,rollbackA});
  }catch(error){
   await A.query('rollback');await Btx.query('rollback');
   results.push({name,pass:false,pids,txids,blocked,a,b,error:{code:error.code,message:error.message}});
  }
 }
 const counters=async n=>(await monitor.query(`select
 (select count(*)::int from erp_financial_receivables where electronic_document_id=$1) cxc_count,
 (select count(*)::int from erp_financial_journal_entries where source_id=$1) journal_count,
 (select count(*)::int from erp_financial_credit_notes where source_id=$1) credit_effect_count,
 (select count(*)::int from erp_operations_commands where source_record_id=$1) command_count`,[id(n)])).rows[0];
 const totals=async n=>(await monitor.query('select balance from erp_financial_receivables where electronic_document_id=$1',[id(n)])).rows[0]?.balance;
 const fiscalBefore=async()=>JSON.stringify((await monitor.query('select * from electronic_documents order by id')).rows);
 await doc(70);const inv=await payload(70),ops=[randomUUID(),randomUUID()],frozen=await fiscalBefore();
 await race('INVOICE different operation IDs and accepted source aliases',c=>post(c,inv,'01',ops[0]),c=>post(c,{...inv,electronicDocumentId:'',sourceId:inv.accessKey},'01',ops[1]),async(a,b)=>{
  assert.equal(b.ok,true);assert.equal(b.value.reused,true);
  const state=await counters(70);assert.equal(state.cxc_count,1);assert.equal(state.journal_count,1);assert.equal(state.command_count,1);
  assert.equal(await fiscalBefore(),frozen);return {...state,operationIds:ops};
 });
 await doc(71);await post(A,await payload(71));await doc(72,{type:'04',parent:id(71)});
 await monitor.query('update electronic_documents set subtotal=20,grand_total=20 where id=$1',[id(72)]);
 const nc=await payload(72,'04'),ncOps=[randomUUID(),randomUUID()];
 await race('NC20 on balance100 different operation IDs and aliases',c=>post(c,nc,'04',ncOps[0]),c=>post(c,{...nc,electronicDocumentId:'',sourceId:nc.accessKey},'04',ncOps[1]),async(a,b)=>{
  assert.equal(b.ok,true);assert.equal(b.value.reused,true);
  const state=await counters(72);assert.equal(state.credit_effect_count,1);assert.equal(state.journal_count,1);assert.equal(state.command_count,1);
  assert.equal(Number(await totals(71)),80);return {...state,balance:Number(await totals(71)),operationIds:ncOps};
 });
 await doc(83);const sameOp=randomUUID(),samePayload=await payload(83);
 await race('Same operation ID concurrently reused',c=>post(c,samePayload,'01',sameOp),c=>post(c,samePayload,'01',sameOp),async(a,b)=>{
  assert.equal(b.ok,true);assert.equal(b.value.reused,true);const state=await counters(83);
  assert.equal(state.cxc_count,1);assert.equal(state.journal_count,1);return {...state,operationId:sameOp};
 });
 // Aborted winning transaction must release all journal/CxC/operation effects.
 await doc(73);const aborted=await payload(73);
 await race('Rollback first writer; second writer creates one complete act',c=>post(c,aborted),c=>post(c,aborted),async(a,b)=>{
  assert.equal(b.ok,true);const state=await counters(73);assert.equal(state.cxc_count,1);assert.equal(state.journal_count,1);return state;
 },{rollbackA:true});

 // Exact installed legacy generator; minimal table scaffolding only.
 const legacyDefinition=await readFile(new URL('tests/fixtures/aud02-installed-legacy-generation.sql',import.meta.url),'utf8');
 await monitor.query(`
 alter table electronic_documents add column customer_id uuid, add column discount_total numeric default 0;
 create table accounting_generation_rules(id uuid default gen_random_uuid(),company_id uuid,document_type text,active boolean,effective_from date,effective_until date,customer_id uuid,currency text,sale_type text,country_code text,sales_channel text,product_id uuid,product_category text,tax_code text,priority integer,created_at timestamptz default now(),debit_account_code text,credit_account_code text,tax_account_code text,cost_center_id uuid);
 create table electronic_document_lines(document_id uuid,product_id uuid,additional_details jsonb);
 create table electronic_document_taxes(document_id uuid,tax_code text);
 create table if not exists journal_entries(id uuid primary key default gen_random_uuid(),company_id uuid,entry_number text,entry_date date,description text,status text,source_type text,source_document_id uuid unique,currency text,total_debit numeric,total_credit numeric,created_by uuid,posted_by uuid);
 create table journal_entry_lines(id uuid default gen_random_uuid(),company_id uuid,journal_entry_id uuid,line_number integer,account_code text,description text,debit numeric,credit numeric,customer_id uuid,cost_center_id uuid);
 create table electronic_document_audit_logs(company_id uuid,document_id uuid,actor_user_id uuid,actor_type text,action text,old_status text,new_status text,reason text,new_values jsonb);
 insert into accounting_generation_rules(company_id,document_type,active,priority,debit_account_code,credit_account_code)values('${B}','01',true,1,'AR','SALES');
 `);
 await monitor.query(legacyDefinition);
 const legacy=(c,n)=>c.query('select generate_sri_accounting_entry($1,$2) result',[id(n),actor]).then(r=>r.rows[0].result);
 const legacySetup=async n=>{await doc(n);await monitor.query("insert into accounting_document_links values($1,$2,$3,'PENDING',null,null)",[randomUUID(),B,id(n)]);};
 await legacySetup(74);const p74=await payload(74);
 await race('Legacy generator commits before waiting V2',c=>legacy(c,74),c=>post(c,p74),async(a,b)=>{
  assert.equal(b.ok,false);const state=await counters(74);assert.equal(state.cxc_count,0);assert.equal(state.journal_count,0);return state;
 });
 await legacySetup(75);const p75=await payload(75);
 await race('V2 commits before waiting legacy generator',c=>post(c,p75),c=>legacy(c,75),async(a,b)=>{
  const legacyCount=(await monitor.query('select count(*)::int n from journal_entries where source_document_id=$1',[id(75)])).rows[0].n;
  assert.equal(b.ok,false,'Legacy second writer must be blocked');assert.equal(legacyCount,0);
  const link=(await monitor.query('select status,journal_entry_id from accounting_document_links where document_id=$1',[id(75)])).rows[0];
  assert.equal(link.status,'PENDING');assert.equal(link.journal_entry_id,null);
  assert.equal((await monitor.query('select count(*)::int n from electronic_document_audit_logs where document_id=$1',[id(75)])).rows[0].n,0);
  return {...await counters(75),legacyCount,legacyLink:link};
 });
 await doc(76);const p76=await payload(76);
 await race('Uncommitted legacy entity evidence then V2',async c=>{
  await c.query("insert into erp_entity_records(company_id,entity,record_id,payload)values($1,'customer_receivables','legacy76',$2)",[B,{sourceDocumentId:id(76),documentNumber:p76.documentNumber,journalEntryId:'legacy76journal',postingStatus:'CONTABILIZADO'}]);
  return {legacyFixture:true,explicitSchedulingBarrier:false};
 },c=>post(c,p76),async(a,b)=>{assert.equal(b.ok,false);assert.equal((await counters(76)).cxc_count,0);return await counters(76);});
 await doc(77);const p77=await payload(77);
 await race('V2 before raw legacy CxC projection, no artificial writer lock',c=>post(c,p77),async c=>{
  await c.query("insert into erp_entity_records(company_id,entity,record_id,payload)values($1,'customer_receivables','legacy77',$2)",[B,{sourceDocumentId:id(77),documentNumber:p77.documentNumber,journalEntryId:'legacy77journal',postingStatus:'CONTABILIZADO'}]);
  return {legacyFixture:true};
 },async(a,b)=>{
  assert.equal(b.ok,false);assert.match(b.message,/LEGACY_V2_PRIOR_EFFECT/);
  assert.equal((await monitor.query("select count(*)::int n from erp_entity_records where record_id='legacy77'")).rows[0].n,0);
  const state=await counters(77);assert.equal(state.cxc_count,1);assert.equal(state.journal_count,1);return state;
 });
 await doc(78);const p78=await payload(78);
 await race('Conflicting legacy references committed before waiting V2',async c=>{
  for(const key of ['linkA','linkB'])await c.query("insert into erp_entity_records(company_id,entity,record_id,payload)values($1,'customer_receivables',$2,$3)",[B,key,{sourceDocumentId:id(78),documentNumber:p78.documentNumber,journalEntryId:key+'journal',postingStatus:'CONTABILIZADO'}]);
  return {twoDistinctLegacyLinks:true};
 },c=>post(c,p78),async(a,b)=>{assert.equal(b.ok,false);assert.match(b.message,/AMBIGUOUS|REQUIRES_REVIEW/);return await counters(78);});
 // Fail after the real engine has inserted a journal/NC and reduced the balance.
 // This test-only publisher trigger proves rollback, not an all-success mock.
 await monitor.query(`
 create function aud02_test_abort_publish() returns trigger language plpgsql as $$
 begin if current_setting('test.abort_publish',true)='yes' then
   raise exception using errcode='P0001',message='TEST_ABORT_AFTER_ECONOMIC_WRITES',
   detail=(select jsonb_build_object('balance',balance,'credited',credited_total)::text from erp_financial_receivables where receivable_id=(new.payload->>'receivableId')::uuid);
 end if;return new;end $$;
 create trigger aud02_test_abort_publish before insert or update on erp_entity_records
 for each row when(new.entity='financial_receivables') execute function aud02_test_abort_publish();
 `);
 await doc(79);await post(A,await payload(79));await doc(80,{type:'04',parent:id(79)});
 await monitor.query('update electronic_documents set subtotal=20,grand_total=20 where id=$1',[id(80)]);
 const abortNC=await payload(80,'04');
 await A.query('begin');await Btx.query('begin');
 const abortTx=[(await A.query('select txid_current() id')).rows[0].id,(await Btx.query('select txid_current() id')).rows[0].id];
 await A.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[B+':FISCAL_SALES:'+id(80)]);
 await A.query('select id from electronic_documents where id=$1 for update',[id(80)]);
 const other=post(Btx,abortNC,'04').then(value=>({ok:true,value}),error=>({ok:false,message:error.message}));
 const blocked=await waitBlocked();
 await A.query("set local test.abort_publish='yes'");
 let failed;
 try{await post(A,abortNC,'04');throw Error('FAULT_NOT_TRIGGERED');}catch(error){failed={code:error.code,message:error.message,detail:error.detail};}
 await A.query('rollback');const winner=await other;await Btx.query(winner.ok?'commit':'rollback');
 assert.equal(failed.message,'TEST_ABORT_AFTER_ECONOMIC_WRITES');assert.equal(JSON.parse(failed.detail).balance,80);
 assert.equal(winner.ok,true,JSON.stringify(winner));assert.equal(Number(await totals(79)),80);assert.equal((await counters(80)).credit_effect_count,1);
 results.push({name:'NC losing transaction fails AFTER balance update; all partial effects roll back',pass:true,pids,txids:abortTx,blocked,failed,state:{...await counters(80),balance:Number(await totals(79))}});
 await monitor.query('drop trigger aud02_test_abort_publish on erp_entity_records;drop function aud02_test_abort_publish()');
 // A lock on this fiscal document must not turn into a company/table lock.
 await doc(81);await A.query('begin');await post(A,await payload(81));
 await Btx.query('begin');
 await Btx.query("insert into erp_entity_records(company_id,entity,record_id,payload)values($1,'customer_receivables','other-company-lock-control',$2)",[bootstrap.I,{sourceDocumentId:id(81),journalEntryId:'other',postingStatus:'CONTABILIZADO'}]);
 await Btx.query('commit');await A.query('commit');
 results.push({name:'Unrelated company writes are not blocked by the BLESS fixture document lock',pass:true,pids});
 // Neither a legacy insertion nor the unchanged retention type is widened into V2.
 await doc(82,{type:'07'});
 await monitor.query("insert into journal_entries(company_id,status,source_type,source_document_id)values($1,'POSTED','SRI',$2)",[B,id(82)]);
 results.push({name:'Retention07 legacy record is outside the new trigger guard',pass:true});
 const orphan=(await monitor.query(`select
 (select count(*)::int from erp_financial_receivables r left join erp_financial_journal_entries j on j.journal_entry_id=r.journal_entry_id where j.journal_entry_id is null) cxc_without_journal,
 (select count(*)::int from erp_financial_credit_notes c left join erp_financial_journal_entries j on j.journal_entry_id=c.journal_entry_id where j.journal_entry_id is null) nc_without_journal,
 (select count(*)::int from erp_financial_journal_entries j where source_type='INVOICE' and not exists(select 1 from erp_financial_receivables r where r.journal_entry_id=j.journal_entry_id)) journal_without_cxc,
 (select count(*)::int from erp_financial_journal_entries j where source_type='CREDIT_NOTE' and not exists(select 1 from erp_financial_credit_notes c where c.journal_entry_id=j.journal_entry_id)) journal_without_nc`)).rows[0];
 assert.ok(Object.values(orphan).every(n=>n===0));
 const acl=(await monitor.query("select proacl::text acl from pg_proc where proname='erp_financial_v2_guard_legacy_sales_write'")).rows[0].acl;
 assert.ok(!/authenticated=X|anon=X|service_role=X|[,\\{]=X/.test(acl));
 const output={candidate:root,environment:identity,independentConnections:pids,results,orphan,prodChanges:0,sriRequests:0};
 await writeFile(outputDirectory+'/postgres-multisession-results.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify({...output,results:results.map(({a,b,...r})=>({...r,b:b?{ok:b.ok,code:b.code,message:b.message,reused:b.value?.reused}:null}))},null,2));
 process.exitCode=results.every(r=>r.pass)?0:1;
}finally{for(const c of clients.reverse())await c.end();}
