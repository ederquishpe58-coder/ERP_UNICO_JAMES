import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

// PGlite in memory only; no URL, credentials or network client is accepted.
globalThis.fetch = async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
const {PGlite} = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const read = name=>readFile(new URL(name,import.meta.url),'utf8');
const B='11111111-1111-4111-8111-111111111111', I='22222222-2222-4222-8222-222222222222';
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const checks=[];
async function test(name,run){await run();checks.push({name,result:'PASS'});}
async function sql(query,args=[]){return (await db.query(query,args)).rows;}
const migration=await read('supabase/migrations/202609120002_sales_accounting_pending_inbox.sql');
const finance=await read('supabase/migrations/202608150009_financial_sales_receivables_v2.sql');
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values('${actor}');
create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
create table public.companies(id uuid primary key);
insert into companies values('${B}'),('${I}');
create table public.erp_export_shipment_registry(company_id uuid,shipment_id uuid,primary key(company_id,shipment_id));
create table public.erp_entity_records(company_id uuid,entity text,record_id text,payload jsonb,version bigint default 1,deleted_at timestamptz,primary key(company_id,entity,record_id));
create table public.erp_operations_commands(operation_id uuid,company_id uuid,command_type text,source_record_id text,
 request_payload jsonb,result jsonb,status text,user_id uuid,device_id text,local_created_at timestamptz,server_created_at timestamptz,primary key(company_id,operation_id));
create table public.electronic_documents(id uuid primary key,company_id uuid,environment text,document_type text,status text,
 full_number text,buyer_snapshot jsonb,source_snapshot jsonb,source_order_id uuid,parent_document_id uuid,issue_date date,
 subtotal numeric,tax_total numeric,grand_total numeric,currency text,access_key text,authorization_number text,created_at timestamptz default now());
create table public.commercial_invoice_reservations(id uuid primary key,company_id uuid,environment text,document_type text,
 full_number text,status text,consumed_document_id uuid,record_id text,created_at timestamptz default now());
create table public.accounting_document_links(id uuid,company_id uuid,document_id uuid unique,status text,journal_entry_id uuid,error_message text);
-- Auth/session and sync publication boundaries are fixtures, not live RLS proof.
create function public.erp_security_assert_capability(p_company_id uuid,p_capability_id text) returns void language plpgsql stable as $$
begin if p_company_id::text<>current_setting('test.company') or current_setting('test.allowed')<>'yes'
 then raise exception using errcode='42501',message='CAPABILITY_REQUIRED'; end if; end $$;
create function public.erp_financial_v2_assert_access(p_company_id uuid) returns void language plpgsql as $$
begin perform erp_security_assert_capability(p_company_id,'accounting.sales.view'); end $$;
create function public.erp_u2c3_assert_mutation_capability(p_rpc text,p_company_id uuid,p_context jsonb) returns void language plpgsql as $$
begin perform erp_security_assert_capability(p_company_id,'accounting.sales.post');
 if current_setting('test.post_allowed')<>'yes' then raise exception using errcode='42501',message='POST_CAPABILITY_REQUIRED';end if;end $$;
create function public.erp_operations_v2_write_record(p_company_id uuid,p_operation_id uuid,p_device_id text,p_entity text,p_record_id text,p_payload jsonb,p_version bigint) returns jsonb language plpgsql as $$
begin insert into erp_entity_records(company_id,entity,record_id,payload) values(p_company_id,p_entity,p_record_id,p_payload)
 on conflict(company_id,entity,record_id) do update set payload=excluded.payload,version=erp_entity_records.version+1;
 return jsonb_build_object('company_id',p_company_id,'entity',p_entity,'record_id',p_record_id,'payload',p_payload);end $$;
set test.company='${B}';set test.allowed='yes';set test.post_allowed='yes';
`);
await db.exec(finance.slice(0,finance.indexOf('do $$ declare v_table'))+'commit;');
await db.exec(await read('tests/fixtures/aud02-installed-financial-helpers.sql'));
await db.exec(await read('tests/fixtures/aud02-installed-financial-functions.sql'));
// Match installed execution ACL before testing replacement of the public guards.
await db.exec(`
revoke all on function erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz),erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz),
 erp_financial_v2_post_invoice_u2c3_internal(uuid,uuid,text,jsonb,timestamptz),erp_financial_v2_post_credit_note_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz),erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz) to authenticated;
`);
await db.exec(`
create function erp_is_company_member(company uuid, actor uuid) returns boolean language sql stable as $$
 select company::text=current_setting('test.company') and current_setting('test.allowed')='yes' and actor=auth.uid()$$;
create table commercial_order_number_reservations(id uuid default gen_random_uuid(),company_id uuid,record_id text,order_year int,sequential bigint,order_number text,created_by uuid,created_at timestamptz default now());
create table commercial_order_sequences(company_id uuid,order_year int,next_value bigint,updated_by uuid,updated_at timestamptz,primary key(company_id,order_year));
create table erp_sync_operations(operation_id uuid primary key,company_id uuid,user_id uuid,entity text,action text,record_id text,payload jsonb,field_changes jsonb,commercial_order_request_context jsonb);
create table erp_payroll_employees(employee_id uuid,company_id uuid,user_id uuid,status text,area text,full_name text);
insert into erp_payroll_employees values('${id(500)}','${B}','${actor}','ACTIVE','VENTAS','Fixture seller');
create table sri_settings(company_id uuid,environment text);
create table emission_points(id uuid,company_id uuid,environment text,establishment_code text,emission_point_code text,active boolean);
insert into sri_settings values('${B}','PRODUCTION');
insert into emission_points values('${id(501)}','${B}','PRODUCTION','001','002',true);
create table electronic_document_sequences(company_id uuid,emission_point_id uuid,environment text,document_type text,next_value bigint,updated_by uuid);
insert into electronic_document_sequences values('${B}','${id(501)}','PRODUCTION','01',900,null);
alter table commercial_invoice_reservations add column emission_point_id uuid default '${id(501)}',add column establishment_code text default '001',add column emission_point_code text default '002',add column sequential bigint,add column consumed_at timestamptz,add column updated_at timestamptz,add column created_by uuid;
alter table electronic_documents add column emission_point_id uuid,add column establishment_code text,add column emission_point_code text,add column sequential bigint;
create function erp_apply_offline_operation_u2c3_internal(op uuid,company uuid,device text,ent text,act text,rec text,pay jsonb,base jsonb,changes jsonb,ver bigint,created timestamptz)
returns table(operation_id uuid,status text,server_record jsonb,result_version bigint,server_time timestamptz,discarded_fields jsonb,merge_summary jsonb)
language plpgsql as $$begin
 insert into erp_entity_records(company_id,entity,record_id,payload) values(company,ent,rec,pay)
 on conflict(company_id,entity,record_id) do update set payload=excluded.payload,version=erp_entity_records.version+1;
 insert into erp_sync_operations(operation_id,company_id,user_id,entity,action,record_id,payload,field_changes) values(op,company,auth.uid(),ent,act,rec,pay,changes)
 on conflict on constraint erp_sync_operations_pkey do nothing;
 return query select op,'SYNCED'::text,jsonb_build_object('company_id',company,'record_id',rec,'payload',pay,'version',1),1::bigint,now(),'[]'::jsonb,'{}'::jsonb;
end $$;
`);
await db.exec(await read('tests/fixtures/aud02-installed-order-number.sql'));
await db.exec(await read('tests/fixtures/aud02-installed-commercial-functions.sql'));
await test('Migration twice is idempotent; no business rows created',async()=>{
  await db.exec(migration);await db.exec(migration);
  assert.equal((await sql('select count(*)::int n from erp_financial_receivables'))[0].n,0);
  const attrs=(await sql("select provolatile,prosecdef,proacl::text acl from pg_proc where proname='erp_financial_v2_sales_inbox'"))[0];
  assert.equal(attrs.provolatile,'s');assert.equal(attrs.prosecdef,true);assert.ok(attrs.acl.includes('authenticated=X'));
  assert.ok(!attrs.acl.includes('anon=X')&&!attrs.acl.includes('service_role=X'));
});
const defaults={accountsReceivableCustomersExport:'AR',accountsReceivableCustomersLocal:'AR',exportSales:'SALES',localSales:'SALES',vatSales:'VAT'};
const customer={id:'customer',taxId:'FIXTURE-TAX',name:'Fixture',status:'activo',creditDays:0,customerType:'exterior',companyId:B};
async function entity(company,entity,record,payload){await sql('insert into erp_entity_records(company_id,entity,record_id,payload) values($1,$2,$3,$4) on conflict(company_id,entity,record_id) do update set payload=excluded.payload',[company,entity,record,JSON.stringify(payload)]);}
await entity(B,'company_settings','settings',{defaultAccounts:defaults});await entity(I,'company_settings','settings',{defaultAccounts:{}});
await entity(B,'customers','customer',customer);
await entity(I,'customers','customer',{...customer,companyId:I});
for(const code of ['AR','SALES','VAT']) await entity(B,'accounting_chart_accounts',code,{code,name:code,status:'Activa',isMovement:true});
await entity(B,'commercial_orders','order-only',{number:'ORDER-ONLY',status:'GUARDADO'});
async function doc(n,{company=B,environment='PRODUCTION',type='01',status='AUTORIZADO',parent=null,order=`order-${n}`}={}){
  await entity(company,'commercial_orders',order,{number:order,status:'GUARDADO',expireDate:'2026-09-12'});
  await sql(`insert into electronic_documents(id,company_id,environment,document_type,status,full_number,buyer_snapshot,source_snapshot,issue_date,subtotal,tax_total,grand_total,currency,access_key,authorization_number,parent_document_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-12',100,0,100,'USD',$9,$9,$10)`,
    [id(n),company,environment,type,status,`001-002-${String(n).padStart(9,'0')}`,JSON.stringify({identification:'FIXTURE-TAX',legalName:'Fixture'}),JSON.stringify({invoice:{commerceType:'EXPORTADOR',payments:[{term:0,unit:'dias'}]},erpEmission:{sourceOrderId:order,sourceOrderNumber:order},creditNote:{reason:'Fixture'}}),`KEY-${n}`,parent]);
}
async function reservation(n,document=null,status='ACTIVE'){
  await sql('insert into commercial_invoice_reservations(id,company_id,environment,document_type,full_number,status,consumed_document_id,record_id,sequential) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(100+n),B,'PRODUCTION','01',`001-002-${String(n).padStart(9,'0')}`,status,document,`order-${n}`,n]);
}
await reservation(1);await reservation(2,id(2),'CONSUMED');await doc(2);
await doc(3,{status:'BORRADOR'});await doc(4,{type:'04',parent:id(2)});
await doc(5,{environment:'TEST'});await doc(6,{company:I});await doc(7);
await entity(B,'commercial_orders','order-7',{number:'cancelled',status:'ANULADO'});
await doc(8);await sql("insert into accounting_document_links values($1,$2,$3,'POSTED',$4,null)",[id(208),B,id(8),id(308)]);
await doc(9);await sql("insert into accounting_document_links values($1,$2,$3,'GENERATED',$4,null)",[id(209),B,id(9),id(309)]);
const calls=[];let activeCompany=B, readFailure=false;
async function rpc(name,args){
  calls.push({name,args:structuredClone(args)});
  try{
    if(name==='erp_financial_v2_sales_inbox'){
      if(readFailure)return {error:{code:'NETWORK',message:'fixture read unavailable'}};
      return {data:(await sql('select erp_financial_v2_sales_inbox($1,$2,$3,$4,$5,$6,$7) result',[args.p_company_id,args.p_search,args.p_offset,args.p_limit,args.p_document_id,args.p_fiscal_state,args.p_accounting_state]))[0].result};
    }
    if(name==='erp_financial_v2_health'){
      const keys=['sequenceTable','journalTable','journalLinesTable','receivablesTable','creditNotesTable','collectionsTable','applicationsTable','costsTable','expensesTable','allocationsTable','eventsTable','orderProfitabilityView','shipmentProfitabilityView','operationsDependency','exportDependency','postJournalRpc','postInvoiceRpc','postCreditNoteRpc','reverseJournalRpc','registerCollectionRpc','reverseCollectionRpc','recordCostRpc','recordShipmentExpenseRpc'];
      return {data:{ok:true,component:'FINANCIAL_V2',migration:'202608150009',...Object.fromEntries(keys.map(k=>[k,true]))}};
    }
    assert.ok(['erp_financial_v2_post_invoice','erp_financial_v2_post_credit_note'].includes(name),`Unexpected RPC ${name}`);
    const payload=args.p_invoice||args.p_credit_note;
    return {data:(await sql(`select ${name}($1,$2,$3,$4,$5) result`,[args.p_operation_id,args.p_company_id,args.p_device_id,JSON.stringify(payload),args.p_local_created_at]))[0].result};
  }catch(error){return {error:{code:error.code,message:error.message}};}
}
const local={customers:[customer],customerReceivables:[],financeV2:{},authAccess:{activeCompanyUuid:B}};
const ERP={state:{state:{db:local},saveDb(){throw Error('UNEXPECTED_LOCAL_BUSINESS_SAVE');}},
  utils:{clone:structuredClone,uid:()=>randomUUID(),today:()=> '2026-09-12',esc:value=>String(value??'')},
  authAccess:{activeAccess:()=>({activeCompany:{id:activeCompany}})},
  getEnvConfig:()=>({supabaseEnabled:true,financialV2CaptureEnabled:true}),getSupabaseClient:()=>({rpc}),
  offlineSync:{getDeviceId:async()=> 'fixture-device',createOperationId:randomUUID,applyRemoteRecord:async()=>({ok:true})},
  services:{companySettings:{settings:()=>({defaultAccounts:defaults})},chartOfAccounts:{findByCode:code=>['AR','SALES','VAT'].includes(code)?{code,status:'Activa',isMovement:true}:null},journal:{all:()=>[]},adminConfig:{activeUser:()=>({id:actor})}}
};
const context={window:{BlessERP:ERP,location:{protocol:'https:'}},console:{info(){},error(){}},Intl,Date,JSON,structuredClone,crypto:{randomUUID},setTimeout,clearTimeout};
for(const file of ['scripts/repositories/contabilidad/financial-v2-repository.js','scripts/services/financial-v2.js','scripts/services/receivables.js','scripts/services/sales-inbox.js']) vm.runInNewContext(await read(file),context,{filename:file});
const inbox=ERP.services.salesInbox;
const counts=async()=>JSON.stringify((await sql(`select (select count(*) from erp_financial_receivables) ar,
 (select count(*) from erp_financial_journal_entries) journals,(select count(*) from erp_financial_credit_notes) nc,
 (select count(*) from erp_operations_commands) commands,(select coalesce(sum(last_value),0) from erp_financial_sequence_counters) sequence`))[0]);
await test('Installed order-save chain preserves commercial number without fiscal/accounting effects',async()=>{
  const before=await counts(), fiscalBefore=JSON.stringify(await sql('select * from electronic_document_sequences'));
  const reservations=(await sql('select count(*)::int n from commercial_invoice_reservations'))[0].n;
  const payload={lines:[],issuedAt:'2026-09-12',sriInvoiceNumber:'MUST-NOT-BE-SAVED',status:'GUARDADO'};
  const op=randomUUID();
  const args=[op,B,'fixture','new-order',2026,JSON.stringify(payload)];
  const query='select erp_save_commercial_order($1,$2,$3,$4,$5,null,null,$6) result';
  const first=(await sql(query,args))[0].result;
  assert.equal(first.ok,true);assert.match(first.serverRecord.payload.number,/^PED-COM-2026-/);
  assert.equal(first.serverRecord.payload.sriInvoiceNumber,undefined);
  const second=(await sql(query,args))[0].result;assert.equal(second.serverRecord.payload.number,first.serverRecord.payload.number);
  await assert.rejects(sql(query,[randomUUID(),B,'fixture','invalid-order',2026,JSON.stringify({lines:[{quality:'INVALID'}]})]),/COMMERCIAL_ORDER_LINE_QUALITY_INVALID/);
  assert.equal(await counts(),before);assert.equal(JSON.stringify(await sql('select * from electronic_document_sequences')),fiscalBefore);
  assert.equal((await sql('select count(*)::int n from commercial_invoice_reservations'))[0].n,reservations);
});
await test('Installed explicit document reservation reuses active identity with no accounting',async()=>{
  await entity(B,'commercial_orders','order-1',{number:'PED-COM-2026-0001',status:'GUARDADO',saleType:'EXPORT'});
  const before=await counts(), fiscalBefore=JSON.stringify(await sql('select * from electronic_document_sequences'));
  for(let n=0;n<2;n++){
    const r=(await sql("select erp_commercial_reserve_invoice_for_documents($1,'order-1','COMMERCIAL_INVOICE_CLIENT') result",[B]))[0].result;
    assert.equal(r.reservationId,id(101));assert.equal(r.reused,true);assert.equal(r.created,false);
  }
  assert.equal(await counts(),before);assert.equal(JSON.stringify(await sql('select * from electronic_document_sequences')),fiscalBefore);
});
await test('Read-only inbox: reservation/document one cycle, order alone absent, scopes and prior posted',async()=>{
  const before=await counts(), snapshot=await inbox.list({});
  assert.equal(snapshot.rows.filter(r=>r.document?.id===id(2)||r.reservationIds.includes(id(102))).length,1);
  assert.ok(snapshot.rows.some(r=>r.reservationState==='ACTIVE'&&r.accountingState==='NO_DOCUMENT'));
  assert.ok(snapshot.rows.every(r=>r.environment==='PRODUCTION'&&r.companyId===B));
  assert.ok(!snapshot.rows.some(r=>r.orderId==='order-only'));
  assert.equal(snapshot.rows.find(r=>r.document?.id===id(8)).accountingState,'POSTED_LEGACY');
  assert.equal(snapshot.rows.find(r=>r.document?.id===id(9)).accountingState,'REVIEW_LEGACY');
  await inbox.list({});await inbox.list({search:'Fixture'});
  const drafts=await inbox.list({fiscalState:'BORRADOR'});assert.equal(drafts.total,1);assert.equal(drafts.rows[0].document.id,id(3));
  const posted=await inbox.list({accountingState:'POSTED_LEGACY'});assert.equal(posted.total,1);
  await db.exec('begin read only');await sql('select erp_financial_v2_sales_inbox($1)',[B]);await db.exec('commit');
  assert.equal(await counts(),before);
});
await test('Explicit manual action uses real service/repository + installed posting SQL; no auto-post prerequisite',async()=>{
  const before=await counts();assert.equal((await inbox.post(B,id(2),false)).ok,false);assert.equal(await counts(),before);
  const results=await Promise.all(Array.from({length:20},()=>inbox.post(B,id(2),true)));
  assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));
  const snapshot=await inbox.list({documentId:id(2)});assert.equal(snapshot.rows[0].accountingState,'POSTED');
  assert.equal((await sql('select count(*)::int n from erp_financial_journal_entries'))[0].n,1);
  assert.equal((await sql('select count(*)::int n from erp_financial_receivables'))[0].n,1);
  const after=await counts();await inbox.post(B,id(2),true);assert.equal(await counts(),after);
  const postedCall=calls.find(c=>c.name==='erp_financial_v2_post_invoice');
  const ack=await rpc(postedCall.name,postedCall.args);assert.equal(ack.data.ok,true);assert.equal(await counts(),after);
  const secondOp=await rpc(postedCall.name,{...postedCall.args,p_operation_id:randomUUID()});assert.equal(secondOp.data.ok,true);
  assert.equal((await sql('select count(*)::int n from erp_financial_receivables'))[0].n,1);
});
await test('NC authorized is pending without CxC reduction; manual NC uses canonical parent',async()=>{
  const balance=(await sql('select balance from erp_financial_receivables'))[0].balance;
  assert.equal(Number(balance),100);
  const snapshot=await inbox.list({documentId:id(4)});assert.equal(snapshot.rows[0].accountingState,'PENDING');
  assert.equal(Number((await sql('select balance from erp_financial_receivables'))[0].balance),100);
  const result=await inbox.post(B,id(4),true);assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(Number((await sql('select balance from erp_financial_receivables'))[0].balance),0);
  const after=await counts();await inbox.post(B,id(4),true);assert.equal(await counts(),after);
});
await test('Draft/cancelled/posted/legacy/TEST/missing accounts blocks; no writes',async()=>{
  const before=await counts();
  for(const n of [3,5,7,8,9]) assert.equal((await inbox.post(B,id(n),true)).ok,false);
  activeCompany=I;await db.exec(`set test.company='${I}'`);
  const result=await inbox.post(I,id(6),true);assert.equal(result.ok,false);assert.match(result.message,/configuracion contable incompleta/i);
  assert.ok((await inbox.list({})).rows.every(r=>r.companyId===I));
  assert.equal(await counts(),before);
  activeCompany=B;await db.exec(`set test.company='${B}'`);
});
await test('Read error, unauthorized actor/company, and no post capability fail closed',async()=>{
  const before=await counts();readFailure=true;await assert.rejects(inbox.list({}),/fixture read unavailable/);readFailure=false;
  await db.exec("set test.allowed='no'");await assert.rejects(inbox.list({}),/CAPABILITY_REQUIRED/);
  await db.exec("set test.allowed='yes';set test.post_allowed='no'");
  await doc(10);const result=await inbox.post(B,id(10),true);assert.equal(result.ok,false);assert.match(result.message,/POST_CAPABILITY_REQUIRED/);
  activeCompany=I;await assert.rejects(inbox.list({}),/CAPABILITY_REQUIRED/);activeCompany=B;
  await db.exec("set test.post_allowed='yes'");assert.equal(await counts(),before);
});
await test('Missing or non-postable account remains a real SQL rejection',async()=>{
  const before=await counts();await sql("update erp_entity_records set payload=jsonb_set(payload,'{isMovement}','false') where company_id=$1 and entity='accounting_chart_accounts' and record_id='AR'",[B]);
  const result=await inbox.post(B,id(10),true);assert.equal(result.ok,false);assert.match(result.message,/FINANCE_V2_ACCOUNT_NOT_POSTABLE/);
  assert.equal(await counts(),before);
});
await test('Unfixed due date, ambiguous customer, contradictory series and scope are not guessed',async()=>{
  const snapshot=await inbox.list({documentId:id(10)}), row=snapshot.rows[0];
  assert.equal(inbox.prepare(row,snapshot).payload.dueDate,'2026-09-12');
  const missing=structuredClone(row);delete missing.orderDueDate;
  delete missing.accountingEvidence.dueDate;
  assert.match(inbox.prepare(missing,snapshot).message,/Vencimiento no fijado/);
  const duplicate=structuredClone(row);duplicate.customers.push({...duplicate.customers[0],id:'other'});
  assert.match(inbox.prepare(duplicate,snapshot).message,/ambiguo/);
  const wrong=structuredClone(row);wrong.document.source_snapshot.invoice.commerceType='LOCAL';
  assert.match(inbox.prepare(wrong,snapshot).message,/contradictorios/);
  assert.match(inbox.prepare({...row,orderState:'VOIDED'},snapshot).message,/cancelado/);
  assert.equal(inbox.prepare({...row,companyId:I},snapshot).ok,false);
  const before=await counts();let complete;
  const oldClient=ERP.getSupabaseClient;
  ERP.getSupabaseClient=()=>({rpc:()=>new Promise(resolve=>{complete=resolve;})});
  const held=inbox.list({});activeCompany=I;complete({data:snapshot});
  await assert.rejects(held,/empresa activa cambio/);activeCompany=B;ERP.getSupabaseClient=oldClient;
  assert.equal(await counts(),before);
});
await test('Real UI: canonical states/filter, read error distinct from empty, refresh is read-only',async()=>{
  const before=await counts();
  const elements=new Map();
  const node=key=>{
    if(!elements.has(key)) elements.set(key,{handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});
    return elements.get(key);
  };
  const container={innerHTML:'',querySelector:node,querySelectorAll:()=>[]};
  context.document={querySelector:node,querySelectorAll:()=>[]};
  ERP.services.taxWithholdings={receivedWithholdings:()=>[]};
  ERP.performance={paginate:rows=>({items:rows}),renderPager:()=>'',debounce:fn=>fn,resetPage(){}};
  ERP.layout={renderPage(){ERP.modules.part2SalesAccounting.render(container,{title:'Ventas',description:''});}};
  vm.runInNewContext(await read('scripts/modules/part2-sales-accounting.js'),context);
  const settle=async()=>{
    for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,5));if(!container.innerHTML.includes('Consultando pendientes...'))return;}
    throw Error('UI_READ_DID_NOT_SETTLE');
  };
  ERP.layout.renderPage();await settle();
  assert.match(container.innerHTML,/Bandeja fiscal y contable/);assert.match(container.innerHTML,/POSTED_LEGACY/);
  assert.match(container.innerHTML,/NO_DOCUMENT/);
  const readCount=calls.length;ERP.layout.renderPage();await settle();assert.equal(calls.length,readCount);
  node('[data-inbox-fiscal]').handlers.change({target:{value:'BORRADOR'}});await settle();
  assert.match(container.innerHTML,/000000003/);assert.ok(!container.innerHTML.includes('000000008'));
  readFailure=true;node('[data-inbox-refresh]').handlers.click();await settle();
  assert.match(container.innerHTML,/fixture read unavailable/);assert.ok(!container.innerHTML.includes('Sin documentos para esta busqueda.'));
  readFailure=false;node('[data-inbox-refresh]').handlers.click();await settle();
  assert.equal(await counts(),before);
  assert.ok(calls.slice(readCount).every(call=>call.name==='erp_financial_v2_sales_inbox'));
});
console.log(JSON.stringify({result:'PASS',checks,boundaries:{engine:'PGlite in-memory',actualRoutes:'sales-inbox -> receivables -> financialV2 repository -> installed SQL',mocked:'auth session/capability source, sync publication, health/catalog IO',liveHumanSession:'NOT_VERIFIED'},prodWrites:0,realSriRequests:0},null,2));
await db.close();
