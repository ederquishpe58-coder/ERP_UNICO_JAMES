// Appended to the original SQL/service harness in an isolated module. No live IO.
const acceptance=[];
async function check(name,run){await run();acceptance.push({name,result:'PASS'});local.customerReceivables=[];}
async function payload(n,type='01') {
  const snapshot=await inbox.list({documentId:id(n)}),d=snapshot.rows[0].document;
  return {sourceId:d.id,electronicDocumentId:d.id,documentNumber:d.full_number,issueDate:d.issue_date,
    dueDate:'2026-09-12',customerId:'customer',customerName:'Fixture',customerTaxId:'FIXTURE-TAX',
    documentType:'factura sri',accessKey:d.access_key,authorizationNumber:d.authorization_number,
    subtotal:d.subtotal,taxTotal:d.tax_total,total:d.grand_total,receivableAccountCode:'AR',counterAccountCode:'SALES',
    revenueAccountCode:'SALES',taxAccountCode:'',receivableId:snapshot.rows[0].parentReceivable?.id};
}
async function direct(n,p=null,operation=randomUUID(),type='01') {
  const before=JSON.stringify(await sql('select * from electronic_documents order by id'));
  const response=await rpc(type==='01'?'erp_financial_v2_post_invoice':'erp_financial_v2_post_credit_note',{
    p_operation_id:operation,p_company_id:B,p_device_id:'fixture',
    [type==='01'?'p_invoice':'p_credit_note']:p||await payload(n,type),p_local_created_at:'2026-09-12'});
  assert.equal(JSON.stringify(await sql('select * from electronic_documents order by id')),before);
  return response;
}
async function seedOld(command,p) {
  // Execute the original route for historical setup, not a rewritten fixture.
  await db.exec(await read('tests/fixtures/aud02-installed-financial-functions.sql'));
  const r=await direct(0,p,randomUUID(),command);
  assert.equal(r.data?.ok,true,JSON.stringify(r));
  if(!originalMode) await db.exec(migration);
  return r;
}
await sql("update erp_entity_records set payload=jsonb_set(payload,'{isMovement}','true') where company_id=$1 and entity='accounting_chart_accounts' and record_id='AR'",[B]);
await check('R1 persisted legacy journal/CxC, no browser cache; stale direct RPC',async()=>{
  await doc(20);const p=await payload(20);
  await entity(B,'accounting_journal_entries','legacy-entry-20',{id:'legacy-entry-20',status:'CONTABILIZADO',sourceDocument:'001-002-000000020',externalReference:'KEY-20',totalDebit:100,totalCredit:100});
  await entity(B,'customer_receivables','legacy-20',{id:'legacy-20',source:'SRI_AUTORIZADO',sourceDocumentId:id(20),sourceOrderId:'order-20',documentType:'factura sri',documentNumber:'001-002-000000020',customerId:'customer',customerTaxId:'FIXTURE-TAX',issueDate:'2026-09-12',dueDate:'2026-09-12',total:100,journalEntryId:'legacy-entry-20',postingStatus:'CONTABILIZADO'});
  const s=await inbox.list({documentId:id(20)}),before=await counts(),r=await direct(20,p);
  assert.equal(inbox.prepare(s.rows[0],s).ok,originalMode);
  assert.equal(Boolean(r.data?.ok),originalMode);assert.equal(await counts()===before,!originalMode);
});
await check('R1 V2 invoice with prior access-key source returns existing act',async()=>{
  await doc(21);const p=await payload(21);
  await seedOld('01',{...p,electronicDocumentId:'',sourceId:'KEY-21'});
  const s=await inbox.list({documentId:id(21)}),before=await counts(),r=await direct(21,p);
  assert.equal(s.rows[0].accountingState,originalMode?'PENDING':'POSTED');
  assert.equal(Boolean(r.data?.ok),!originalMode);assert.equal(await counts(),before);
  if(originalMode) assert.equal(r.error.code,'23505'); else assert.equal(r.data.reused,true);
});
await check('R3 original missing due date case; no local today/issue fallback',async()=>{
  await doc(22);await entity(B,'commercial_orders','order-22',{number:'order-22',status:'GUARDADO'});
  local.customerReceivables=[{id:'pending-22',sourceDocumentId:id(22),customerId:'customer',documentNumber:'001-002-000000022',documentType:'factura sri',issueDate:'2026-09-01',total:100}];
  const s=await inbox.list({documentId:id(22)}),action=inbox.prepare(s.rows[0],s),before=await counts();
  assert.equal(action.ok,originalMode);
  const r=await direct(22);assert.equal(Boolean(r.data?.ok),originalMode);assert.equal(await counts()===before,!originalMode);
  if(!originalMode){assert.match(r.error.message,/DUE_DATE_REQUIRED/);assert.equal(ERP.services.receivables.normalizeReceivable(local.customerReceivables[0]).dueDate,'');}
});
await check('R4 original contradictory raw cache links, both row orders',async()=>{
  await doc(23);
  const raw=[{id:'posted-23',sourceDocumentId:id(23),customerId:'customer',documentNumber:'001-002-000000023',journalEntryId:'existing-entry',total:100},{id:'pending-23',sourceDocumentId:id(23),customerId:'customer',documentNumber:'001-002-000000023',issueDate:'2026-09-12',total:100}];
  const s=await inbox.list({documentId:id(23)});
  local.customerReceivables=raw;assert.equal(inbox.prepare(s.rows[0],s).ok,originalMode);
  local.customerReceivables=[...raw].reverse();assert.equal(inbox.prepare(s.rows[0],s).ok,false);
  // Same conflict persisted: raw records must be evaluated before any reduction.
  for(const row of raw) await entity(B,'customer_receivables',row.id,row);
  local.customerReceivables=[];const refreshed=await inbox.list({documentId:id(23)}),before=await counts(),r=await direct(23);
  assert.equal(inbox.prepare(refreshed.rows[0],refreshed).ok,originalMode);
  assert.equal(Boolean(r.data?.ok),originalMode);assert.equal(await counts()===before,!originalMode);
  if(!originalMode) {
    assert.equal(refreshed.rows[0].accountingEvidence.links.length,2);
    await sql("delete from erp_entity_records where company_id=$1 and entity='customer_receivables' and record_id in ('posted-23','pending-23')",[B]);
    for(const row of [...raw].reverse()) await entity(B,'customer_receivables',row.id,row);
    const reversed=await inbox.list({documentId:id(23)});
    assert.equal(reversed.rows[0].accountingState,refreshed.rows[0].accountingState);
    assert.equal(reversed.rows[0].linkIssue,refreshed.rows[0].linkIssue);
    assert.deepEqual(reversed.rows[0].accountingEvidence.links.map(l=>l.id).sort(),refreshed.rows[0].accountingEvidence.links.map(l=>l.id).sort());
    assert.equal((await direct(23)).data?.ok,undefined);assert.equal(await counts(),before);
  }
});
await check('R2 original NC alternate reference: 80 remains 80, not 60',async()=>{
  await doc(24);assert.equal((await direct(24)).data.ok,true);
  await doc(25,{type:'04',parent:id(24)});await sql('update electronic_documents set subtotal=20,grand_total=20 where id=$1',[id(25)]);
  const p=await payload(25,'04');await seedOld('04',{...p,electronicDocumentId:'',sourceId:'KEY-25'});
  const balance=async()=>Number((await sql('select balance from erp_financial_receivables where electronic_document_id=$1',[id(24)]))[0].balance);
  assert.equal(await balance(),80);const before=await counts();const r=await direct(25,p,randomUUID(),'04');assert.equal(r.data?.ok,true,JSON.stringify(r));
  assert.equal(await balance(),originalMode?60:80);assert.equal(await counts()===before,!originalMode);
  if(!originalMode){assert.equal(r.data.reused,true);assert.equal((await inbox.list({documentId:id(25)})).rows[0].accountingState,'POSTED');}
});
if(!originalMode) {
 await check('Identical raw link repeated is not a conflict; unknown explicit reference is',async()=>{
   await doc(53);const s=await inbox.list({documentId:id(53)});
   const raw={id:'pending-53',sourceDocumentId:id(53),customerId:'customer',documentNumber:s.rows[0].document.full_number};
   local.customerReceivables=[raw,structuredClone(raw)];assert.equal(inbox.prepare(s.rows[0],s).ok,true);
   const p=await payload(53),before=await counts();
   assert.match((await direct(53,{...p,electronicDocumentId:'UNKNOWN'})).error.message,/IDENTITY_UNRESOLVED/);
   assert.match((await direct(53,{...p,sourceId:'UNRELATED'})).error.message,/REFERENCE_CONFLICT/);
   assert.match((await direct(53,{...p,environment:'TEST'})).error.message,/SCOPE_REQUIRED/);assert.equal(await counts(),before);
 });
 await check('NULL/empty/omitted/invalid persisted due dates remain visible and server-blocked',async()=>{
   let n=40;for(const due of [null,'',undefined,'2026-02-30']) {
     await doc(n);const order={number:`order-${n}`,status:'GUARDADO'};if(due!==undefined)order.expireDate=due;
     await entity(B,'commercial_orders',`order-${n}`,order);
     const s=await inbox.list({documentId:id(n)}),before=await counts(),r=await direct(n);
     assert.equal(s.rows.length,1);assert.equal(inbox.prepare(s.rows[0],s).ok,false);
     assert.match(r.error.message,/DUE_DATE_(REQUIRED|INVALID)/);assert.equal(await counts(),before);n++;
   }
 });
 await check('Explicit valid due date equal to issue/today stays valid; replay and new operation',async()=>{
   await doc(44);const p=await payload(44),op=randomUUID();assert.equal((await direct(44,p,op)).data.ok,true);
   const before=await counts();assert.equal((await direct(44,p,op)).data.reused,true);
   assert.equal((await direct(44,p,randomUUID())).data.reused,true);assert.equal(await counts(),before);
   assert.equal((await sql('select due_date::text date from erp_financial_receivables where electronic_document_id=$1',[id(44)]))[0].date,'2026-09-12');
   await doc(54);assert.match((await direct(54,await payload(54),op)).error.message,/OPERATION_CONFLICT/);
   assert.equal(await counts(),before);
 });
 await check('Stale due date, invented browser date and canceled order rejected inside SQL',async()=>{
   await doc(45);const p=await payload(45),before=await counts();
   await entity(B,'commercial_orders','order-45',{number:'order-45',status:'GUARDADO',expireDate:'2026-10-01'});
   assert.match((await direct(45,p)).error.message,/DUE_DATE_SOURCE_MISMATCH/);
   await entity(B,'commercial_orders','order-45',{number:'order-45',status:'ANULADO',expireDate:'2026-09-12'});
   assert.match((await direct(45,p)).error.message,/ORDER_REQUIRES_REVIEW/);assert.equal(await counts(),before);
 });
 await check('Unrelated company/TEST references cannot suppress or apply a PRODUCTION act',async()=>{
   await doc(46);const p=await payload(46);
   await entity(I,'customer_receivables','other',{sourceDocumentId:id(46),journalEntryId:'elsewhere'});
   await entity(B,'customer_receivables','test',{environment:'TEST',documentNumber:p.documentNumber,customerTaxId:p.customerTaxId,journalEntryId:'test-entry'});
   assert.equal((await direct(46,p)).data.ok,true);
   await doc(47,{environment:'TEST'});
   const testP={...p,electronicDocumentId:id(47),sourceId:id(47)};assert.match((await direct(47,testP)).error.message,/SCOPE_REQUIRED/);
   await doc(48,{company:I});assert.match((await direct(48,{...p,electronicDocumentId:id(48)})).error.message,/IDENTITY_UNRESOLVED/);
 });
 await check('Distinct partial NC documents preserved; duplicate same NC cannot repeat economic act',async()=>{
   await doc(49);assert.equal((await direct(49)).data.ok,true);
   for(const n of [50,51]){await doc(n,{type:'04',parent:id(49)});await sql('update electronic_documents set subtotal=10,grand_total=10 where id=$1',[id(n)]);assert.equal((await direct(n,await payload(n,'04'),randomUUID(),'04')).data.ok,true);}
   const before=await counts();assert.equal((await direct(50,await payload(50,'04'),randomUUID(),'04')).data.reused,true);assert.equal(await counts(),before);
   assert.equal(Number((await sql('select balance from erp_financial_receivables where electronic_document_id=$1',[id(49)]))[0].balance),80);
   const p=await payload(50,'04');assert.match((await direct(50,{...p,electronicDocumentId:'',accessKey:'',sourceId:'arbitrary-new-reference'},randomUUID(),'04')).error.message,/REFERENCE_CONFLICT/);
   assert.equal(await counts(),before);
 });
 await check('NC from other company/environment with same number does not cross applications',async()=>{
   await doc(60);assert.equal((await direct(60)).data.ok,true);
   await doc(61,{type:'04',parent:id(60)});await sql('update electronic_documents set subtotal=10,grand_total=10 where id=$1',[id(61)]);
   const p=await payload(61,'04');
   await entity(I,'customer_receivables','other-nc-parent',{sourceDocumentId:id(60),creditNotes:[{id:id(61),accessKey:'KEY-61',journalEntryId:'other-journal',total:10}]});
   await entity(B,'customer_receivables','test-nc-parent',{environment:'TEST',sourceDocumentId:id(900),creditNotes:[{id:id(901),documentNumber:p.documentNumber,accessKey:'KEY-TEST',total:10}]});
   const s=await inbox.list({documentId:id(61)});assert.equal(s.rows[0].accountingState,'PENDING');
   assert.equal((await direct(61,p,randomUUID(),'04')).data.ok,true);
   assert.equal(Number((await sql('select balance from erp_financial_receivables where electronic_document_id=$1',[id(60)]))[0].balance),90);
 });
 await check('Direct RPC missing configuration, wrong permission and changed customer block before writes',async()=>{
   await doc(52);const p=await payload(52),before=await counts();
   await entity(B,'company_settings','settings',{defaultAccounts:{}});assert.match((await direct(52,p)).error.message,/CONFIGURATION_REQUIRED/);
   await entity(B,'company_settings','settings',{defaultAccounts:defaults});
   await db.exec("set test.post_allowed='no'");assert.match((await direct(52,p)).error.message,/POST_CAPABILITY_REQUIRED/);await db.exec("set test.post_allowed='yes'");
   await entity(B,'customers','duplicate',customer);assert.match((await direct(52,p)).error.message,/CUSTOMER_REQUIRES_REVIEW/);
   await sql("delete from erp_entity_records where entity='customers' and record_id='duplicate'");assert.equal(await counts(),before);
 });
 await check('Readonly repeated list, exact reservation dedup, helper ACLs',async()=>{
   const before=await counts();for(let n=0;n<3;n++)await inbox.list({documentId:id(2)});
   assert.equal((await inbox.list({documentId:id(2)})).rows.length,1);assert.equal(await counts(),before);
   const acl=await sql("select proname,proacl::text acl from pg_proc where proname in ('erp_financial_v2_sales_post_guard','erp_financial_v2_sales_evidence','erp_financial_v2_sales_reference_kind')");
   for(const f of acl) assert.ok(!/authenticated=X|anon=X|service_role=X|[,\\{]=X/.test(f.acl),JSON.stringify(f));
   const wrappers=await sql("select proname,proacl::text acl from pg_proc where proname in ('erp_financial_v2_post_invoice','erp_financial_v2_post_credit_note')");
   for(const f of wrappers){assert.match(f.acl,/authenticated=X/);assert.ok(!/anon=X|service_role=X|[,\\{]=X/.test(f.acl));}
 });
}
console.log(JSON.stringify({mode:originalMode?'ORIGINAL_NEGATIVE_CONTROL':'CORRECTED',originalGroups:checks.length,acceptance,
  interpretation:originalMode?'Assertions reproduce original failures, not functional PASS':'Required outcomes passed',
  concurrency:'PGlite serial execution and original same-browser guard only; not multi-session PostgreSQL proof',prodWrites:0,sriRequests:0},null,2));
await db.close();
