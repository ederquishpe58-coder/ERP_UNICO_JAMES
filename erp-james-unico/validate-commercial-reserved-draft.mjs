import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
globalThis.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
const db=new PGlite();
const B='cf331b82-7ac3-4065-9e38-d0bbcde96cd5',I='ab60abdc-fe53-4289-9ae2-8f749ee21cff',A='11000000-0000-4000-8000-000000000001';
const read=file=>fs.readFileSync(file,'utf8');
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const results=[];
try {
  await db.exec(read('tests/fixtures/sri-dual-configuration-fixture.sql'));
  await db.exec(`insert into auth.users values('${A}');insert into user_profiles(user_id) values('${A}');
    insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values
    ('${B}','FIXTURE_B','FIXTURE_B','Fixture B','Fixture B','1717637084001'),('${I}','FIXTURE_I','FIXTURE_I','Fixture I','Fixture I','1727970137001');
    insert into user_company_memberships(company_id,user_id,membership_status,membership_role) values ('${B}','${A}','ACTIVE','MEMBER'),('${I}','${A}','ACTIVE','MEMBER');
    insert into sri_company_memberships(company_id,auth_user_id,role_code,active) values('${B}','${A}','EMISOR',true),('${I}','${A}','EMISOR',true);
    insert into sri_settings(company_id,legal_name,ruc,head_office_address,test_enabled,production_enabled,withholding_agent_number,technical_spec_version)
    values('${B}','Fixture B','1717637084001','Fixture',true,false,'10','2.34'),('${I}','Fixture I','1727970137001','Fixture',true,false,null,'2.34');
    insert into digital_certificates(company_id,alias,storage_object_path,password_secret_name,subject_ruc,fingerprint_sha256,active,validation_status,valid_from,valid_until,last_validated_at)
    select id,'Fixture','companies/'||id||'/certificates/'||repeat('a',64)||'.p12',case id when '${B}' then 'SRI_P12_PASSWORD_BLESS' else 'SRI_P12_PASSWORD_IMPERIO' end,tax_id,repeat('a',64),true,'VALID',now()-interval '1 day',now()+interval '1 year',now() from companies;
    insert into storage.objects select storage_bucket,storage_object_path from digital_certificates;
    insert into emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address,active)
    select id,e,'001',p,'Fixture',true from companies cross join(values('TEST'),('PRODUCTION')) v(e) cross join(values('002'),('003')) points(p);
    insert into electronic_document_sequences(company_id,environment,emission_point_id,document_type,next_value)
    select company_id,environment,id,'01',900 from emission_points;
  `);
  // Existing offline schema and existing dual-environment guards, no live migration.
  for(const file of ['202609070020_sri_dual_environment_configuration.sql','202609070021_sri_dual_environment_document_guards.sql']) await db.exec(read('supabase/migrations/'+file));
  await db.exec(read('tests/fixtures/commercial-reserved-draft-installed.sql'));
  await db.exec("update sri_settings set production_enabled=true;create table journal_entries(id uuid);create table erp_financial_receivables(receivable_id uuid)");
  const seqBefore=JSON.stringify((await db.query('select * from electronic_document_sequences order by company_id,environment,emission_point_id')).rows);
  const draft=async(company,point,order,environment,actor=A) => (await one(`select create_electronic_document_draft_u2a_internal($1,$2,'01','2026-09-12','12345678','1.1.0','1.1.0',jsonb_build_object('ruc',(select ruc from sri_settings where company_id=$1)),'{"legalName":"Principal fixture"}',$3,null,null,null,null,$4) r`,[company,point,{erpEmission:{sourceOrderId:order,environment},additionalInformation:{MARCACION:'Final fixture'}},actor])).r;
  for(const [company,env,ep,seq] of [[B,'TEST','002',781],[B,'TEST','003',782],[I,'TEST','002',783],[I,'PRODUCTION','002',784]]) {
    await db.query('update companies set sri_environment=$1 where id=$2',[env,company]);
    await db.query('update sri_settings set environment=$1 where company_id=$2',[env,company]);
    const point=(await one('select id from emission_points where company_id=$1 and environment=$2 and emission_point_code=$3',[company,env,ep])).id;
    // Same textual order ID across environments/companies: scope must remain distinct.
    const order=ep==='002'?'SAME-TEXT-ORDER':'LOCAL-ORDER';
    const reservation=(await one(`insert into commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,establishment_code,emission_point_code,sequential,full_number,status,created_by)
      values($1,$2,$3,$4,'01','001',$5,$6::bigint,'001-'||$5||'-'||lpad(($6::bigint)::text,9,'0'),'ACTIVE',$7) returning *`,[company,order,point,env,ep,seq,A]));
    const doc=await draft(company,point,order,env);
    assert.equal(doc.full_number,reservation.full_number);assert.equal(Number(doc.sequential),seq);
    assert.equal(doc.source_snapshot.erpEmission.sourceOrderId,order);assert.equal(doc.buyer_snapshot.legalName,'Principal fixture');
    assert.equal(doc.source_snapshot.additionalInformation.MARCACION,'Final fixture');
    const consumed=await one('select * from commercial_invoice_reservations where id=$1',[reservation.id]);
    assert.equal(consumed.status,'CONSUMED');assert.equal(consumed.consumed_document_id,doc.id);
    const audit=await one("select new_values from electronic_document_audit_logs where document_id=$1 and action='DRAFT_CREATED'",[doc.id]);
    assert.equal(audit.new_values.commercial_reservation_id,reservation.id);
    for(let n=0;n<3;n++) { const reused=await draft(company,point,order,env);assert.equal(reused.id,doc.id);assert.equal(reused.full_number,reservation.full_number);assert.equal(reused._reservation_reused,true); }
    await assert.rejects(draft(company,point,order,env==='TEST'?'PRODUCTION':'TEST'),/ENVIRONMENT_SELECTION_CHANGED/);
    await assert.rejects(draft(company,point,order,env,null),/ACTOR_CANNOT_CREATE/);
    results.push({company:company===B?'BLESS_FIXTURE':'IMPERIO_FIXTURE',environment:env,point:ep,reserved:seq,document:Number(doc.sequential),repeatDelta:0});
  }
  assert.equal((await one('select count(*)::int n from electronic_documents')).n,4);
  assert.equal((await one('select count(*)::int n from journal_entries')).n,0);
  assert.equal((await one('select count(*)::int n from erp_financial_receivables')).n,0);
  assert.equal(JSON.stringify((await db.query('select * from electronic_document_sequences order by company_id,environment,emission_point_id')).rows),seqBefore);
  console.log(JSON.stringify({result:'PASS',results,sequenceDelta:0,journalDelta:0,cxcDelta:0,
    scope:'Actual installed draft SQL core + existing offline schema/environment guards, PGlite single session. No SRI, no signing, no live auth session; outer API security and physical PDFs not exercised here.'},null,2));
} catch(error) {console.error(JSON.stringify({result:'FAIL',code:error.code,message:error.message,where:error.where},null,2));process.exitCode=1;}
finally {await db.close();}
