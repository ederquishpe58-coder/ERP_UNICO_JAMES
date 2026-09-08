const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); } catch { ({ PGlite } = require('C:/Users/Contador J/Documents/ERP_UNICO_JAMES/node_modules/@electric-sql/pglite')); }
const config = require('./api/sri/_lib/configuration-service.cjs');
const B = 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5', I = 'ab60abdc-fe53-4289-9ae2-8f749ee21cff';
const A = '11000000-0000-4000-8000-000000000001', OWNER = '22000000-0000-4000-8000-000000000002';
const lit = value => value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
async function main() {
 const db = new PGlite();
 const run = sql => db.exec(sql);
 const rows = async (sql, args) => (await db.query(sql, args)).rows;
 const one = async (sql, args) => (await rows(sql, args))[0];
 async function deny(action, message) { await assert.rejects(action, e => String(e.message).includes(message)); checks++; }
 async function login(actor = A, role = 'authenticated') {
   await run(`reset role; select set_config('request.jwt.claims',${lit(JSON.stringify({sub: actor, role}))},false),set_config('request.jwt.claim.sub',${lit(actor || '')},false),set_config('request.jwt.claim.role',${lit(role)},false); set role ${role};`);
 }
 async function admin(sql) { await run('reset role'); return run(sql); }
 const sideTables = ['electronic_documents','commercial_invoice_reservations','electronic_document_files','sri_transmissions','sri_transmission_attempts','sri_authorizations','electronic_document_audit_logs','accounting_document_links'];
 async function sideEffects() { return one('select '+sideTables.map(t=>`(select count(*)::int from public.${t}) as ${t}`).join(',')); }
 async function testHash() {
   return one("select md5(coalesce((select jsonb_agg(to_jsonb(t) order by id)::text from emission_points t where environment='TEST'),'')) points,md5(coalesce((select jsonb_agg(to_jsonb(t) order by company_id,emission_point_id,document_type)::text from electronic_document_sequences t where environment='TEST'),'')) sequences");
 }
 const setNext = (company, point, type, next, expected, op = randomUUID(), env = 'PRODUCTION') => one('select erp_sri_set_sequence_next($1,$2,$3,$4,$5,$6,$7,$8) as result',[company,env,point,type,next,expected,op,'Prueba sintetica de configuracion explicita']);
 const activate = (company, enabled, expected, op = randomUUID(), env = 'PRODUCTION') => one('select erp_sri_set_environment_enabled($1,$2,$3,$4,$5,$6) as result',[company,env,enabled,expected,op,'Prueba sintetica de activacion']);
 try {
  await run(fs.readFileSync(path.join(__dirname,'tests/fixtures/sri-dual-configuration-fixture.sql'),'utf8'));
  // This existing worker RPC is service-only in the verified live ACL.
  await run('revoke all on function public.claim_sri_transmission(uuid,text) from public,anon,authenticated; grant execute on function public.claim_sri_transmission(uuid,text) to service_role;');
  await run(`insert into auth.users values(${lit(A)}),(${lit(OWNER)});insert into user_profiles(user_id) values(${lit(A)}),(${lit(OWNER)});
   insert into companies(id,company_key,company_code,legal_name,commercial_name,tax_id) values
   (${lit(B)},'SYNTHETIC_BLESS','SYNTHETIC_BLESS','Synthetic Bless','Synthetic Bless','1717637084001'),
   (${lit(I)},'SYNTHETIC_IMPERIO','SYNTHETIC_IMPERIO','Synthetic Imperio','Synthetic Imperio','1727970137001');
   insert into user_company_memberships(company_id,user_id,membership_status,membership_role) values
   (${lit(B)},${lit(A)},'ACTIVE','OWNER'),(${lit(I)},${lit(A)},'ACTIVE','OWNER'),(${lit(B)},${lit(OWNER)},'ACTIVE','OWNER');
   insert into sri_company_memberships(company_id,auth_user_id,active,role_code) values(${lit(B)},${lit(A)},true,'ADMIN'),(${lit(I)},${lit(A)},true,'ADMIN');
   insert into sri_settings(company_id,legal_name,ruc,head_office_address,test_enabled,production_enabled,withholding_agent_number,technical_spec_version)
   values(${lit(B)},'Synthetic Bless','1717637084001','Synthetic address',true,false,'10','2.34'),(${lit(I)},'Synthetic Imperio','1727970137001','Synthetic address',true,false,null,'2.34');
   insert into digital_certificates(company_id,alias,storage_object_path,password_secret_name,subject_ruc,fingerprint_sha256,active,validation_status,valid_from,valid_until,last_validated_at)
   select id,'Synthetic certificate metadata','companies/'||id||'/certificates/'||repeat('a',64)||'.p12',case id when ${lit(B)} then 'SRI_P12_PASSWORD_BLESS' else 'SRI_P12_PASSWORD_IMPERIO' end,tax_id,repeat('a',64),true,'VALID',now()-interval '1 day',now()+interval '1 year',now() from companies;
   insert into storage.objects(bucket_id,name) select storage_bucket,storage_object_path from digital_certificates;
   insert into emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address,active)
   select id,'TEST','001',ep,'Synthetic address',true from companies cross join (values('002'),('003')) p(ep);
   insert into electronic_document_sequences(company_id,environment,emission_point_id,document_type,next_value)
   select company_id,'TEST',id,doc,37 from emission_points cross join (values('01'),('04')) d(doc);
   insert into electronic_document_sequences(company_id,environment,emission_point_id,document_type,next_value)
   select company_id,'TEST',id,'07',55 from emission_points where company_id=${lit(B)} and emission_point_code='002';`);
  const caps = ['admin.sequences.manage','tax.parameters.manage','commercial.orders.view','commercial.electronic_documents.create','commercial.electronic_documents.authorize','commercial.credit_notes.create','purchases.withholdings.create'];
  for (const cap of caps) { const [m,r,a] = cap.split('.'); await db.query('insert into erp_security_capabilities(capability_id,module,resource,action,risk_level,description) values($1,$2,$3,$4,$5,$6) on conflict(capability_id) do nothing',[cap,m,r,a,'HIGH','Synthetic explicit capability']); }
  await run(`insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason) select c.id,${lit(A)},capability_id,'GRANT','Synthetic explicit permission' from companies c cross join erp_security_capabilities;`);
  const preserved = await testHash(), before = await sideEffects();
  const settingsBefore = await rows('select to_jsonb(s) settings from sri_settings s order by company_id');
  for (const file of ['202609070020_sri_dual_environment_configuration.sql','202609070021_sri_dual_environment_document_guards.sql']) await run(fs.readFileSync(path.join(__dirname,'supabase/migrations',file),'utf8'));
  for (const file of ['202609070020_sri_dual_environment_configuration.sql','202609070021_sri_dual_environment_document_guards.sql']) await run(fs.readFileSync(path.join(__dirname,'supabase/migrations',file),'utf8'));
  checks++;
  equal(await testHash(),preserved,'Migration preserves every TEST point and sequence byte');
  equal(await sideEffects(),before,'Migration has zero tax side effects');
  equal(await rows('select to_jsonb(s) settings from sri_settings s order by company_id'),settingsBefore,'Migration preserves settings flags/default/metadata');
  await run(fs.readFileSync(path.join(__dirname,'tests/fixtures/sri-dual-configuration-rollback.sql'),'utf8'));
  equal(await testHash(),preserved,'Infrastructure rollback preserves all TEST points/sequences');
  equal(await sideEffects(),before,'Infrastructure rollback has zero tax side effects');
  equal(await rows('select to_jsonb(s) settings from sri_settings s order by company_id'),settingsBefore,'Rollback never changes flags or selectors');
  equal((await one("select to_regprocedure('public.erp_sri_set_sequence_next(uuid,text,uuid,text,bigint,bigint,uuid,text)') is null absent")).absent,true,'Rollback removes the new configuration entrypoint');
  for (const file of ['202609070020_sri_dual_environment_configuration.sql','202609070021_sri_dual_environment_document_guards.sql']) await run(fs.readFileSync(path.join(__dirname,'supabase/migrations',file),'utf8'));
  const testPoint = (await one(`select id from emission_points where company_id=${lit(B)} and environment='TEST' and emission_point_code='002'`)).id;
  await login(null); await deny(()=>setNext(B,testPoint,'01',40,37,randomUUID(),'TEST'),'SRI_AUTHENTICATED_COMPANY_ACTOR_REQUIRED');
  await login(OWNER); await deny(()=>setNext(B,testPoint,'01',40,37,randomUUID(),'TEST'),'CAPABILITY_REQUIRED');
  await deny(()=>activate(B,true,false),'CAPABILITY_REQUIRED');
  await login(A,'service_role'); await deny(()=>setNext(B,testPoint,'01',40,37,randomUUID(),'TEST'),'permission denied');
  await login();
  await deny(()=>setNext(B,testPoint,'01',40,37),'SRI_ACTIVE_EMISSION_POINT_REQUIRED');
  await deny(()=>setNext(I,testPoint,'01',40,37,randomUUID(),'TEST'),'SRI_ACTIVE_EMISSION_POINT_REQUIRED');
  await deny(()=>setNext(B,testPoint,'01',0,37,randomUUID(),'TEST'),'SRI_SEQUENCE_INPUT_INVALID');
  await deny(()=>activate(B,true,false),'SRI_ACTIVATION_ROUTING_REQUIRED');
  await admin(`update user_company_memberships set membership_status='SUSPENDED' where company_id=${lit(B)} and user_id=${lit(A)}`);
  await login();await deny(()=>activate(B,true,false),'SRI_AUTHENTICATED_COMPANY_ACTOR_REQUIRED');
  await admin(`update user_company_memberships set membership_status='ACTIVE' where company_id=${lit(B)} and user_id=${lit(A)}`);
  await login();
  const points = {};
  for (const company of [B,I]) for (const ep of ['002','003']) {
   const op=randomUUID();
   const args=[company,'PRODUCTION','001',ep,'Synthetic PROD address','Synthetic point',true,null,op];
   const saved=(await one('select erp_sri_save_emission_point($1,$2,$3,$4,$5,$6,$7,$8,$9) result',args)).result;
   points[company+ep]=saved.id;
   equal((await one('select erp_sri_save_emission_point($1,$2,$3,$4,$5,$6,$7,$8,$9) result',args)).result,saved,'Point retry returns identical canonical result');
  }
  await deny(()=>activate(B,true,false),'SRI_ACTIVATION_SEQUENCE_REQUIRED');
  const op=randomUUID(); const bPoint=points[B+'002'];
  const saved=(await setNext(B,bPoint,'01',100,null,op)).result;
  equal(saved.next_value,100,'Exact next value is not incremented');
  equal((await setNext(B,bPoint,'01',100,null,op)).result,saved,'Sequence retry is idempotent');
  await deny(()=>setNext(B,bPoint,'01',101,null,op),'SRI_CONFIGURATION_OPERATION_CONFLICT');
  await deny(()=>setNext(I,points[I+'002'],'01',100,null,op),'SRI_CONFIGURATION_OPERATION_CONFLICT');
  await deny(()=>setNext(B,bPoint,'01',101,null),'SRI_SEQUENCE_VERSION_CONFLICT');
  await deny(()=>setNext(I,points[I+'002'],'07',1,null),'SRI_WITHHOLDING_COMPANY_NOT_ENABLED');
  await deny(()=>setNext(B,bPoint,'06',1,null),'SRI_DOCUMENT_TYPE_NOT_ENABLED');
  for(const company of [B,I]) for(const ep of ['002','003']) for(const type of ['01','04']) {
   if(company===B&&ep==='002'&&type==='01')continue;
   await setNext(company,points[company+ep],type,100,null);
  }
  await setNext(B,bPoint,'07',100,null);
  await run('reset role'); equal(await sideEffects(),before,'Configuration while OFF creates no identities/artifacts');equal(await testHash(),preserved,'PROD configuration preserves all TEST rows');
  await admin(`update digital_certificates set valid_until=now()-interval '1 second' where company_id=${lit(B)}`);
  await login();await deny(()=>activate(B,true,false),'SRI_VALID_CANONICAL_CERTIFICATE_REQUIRED');
  await admin(`update digital_certificates set valid_until=now()+interval '1 year',subject_ruc='1727970137001' where company_id=${lit(B)}`);
  await login();await deny(()=>activate(B,true,false),'SRI_VALID_CANONICAL_CERTIFICATE_REQUIRED');
  await admin(`update digital_certificates set subject_ruc='1717637084001' where company_id=${lit(B)}`);
  await admin(`update digital_certificates set password_secret_name='SRI_P12_PASSWORD_IMPERIO' where company_id=${lit(B)}`);
  await login();await deny(()=>activate(B,true,false),'SRI_VALID_CANONICAL_CERTIFICATE_REQUIRED');
  await admin(`update digital_certificates set password_secret_name='SRI_P12_PASSWORD_BLESS' where company_id=${lit(B)}`);
  await admin(`delete from storage.objects where name like 'companies/${B}/%'`);
  await login();await deny(()=>activate(B,true,false),'SRI_VALID_CANONICAL_CERTIFICATE_REQUIRED');
  await admin(`insert into storage.objects(bucket_id,name) select storage_bucket,storage_object_path from digital_certificates where company_id=${lit(B)}`);
  await login();
  const activationId=randomUUID();const enabled=(await activate(B,true,false,activationId)).result;
  equal([enabled.test_enabled,enabled.production_enabled,enabled.environment],[true,true,'PRODUCTION'],'Activation preserves TEST gate and selects PROD');
  equal((await activate(B,true,false,activationId)).result,enabled,'Activation replay is pure and identical');
  await run('reset role');equal((await one(`select sri_environment from companies where id=${lit(B)}`)).sri_environment,'PRODUCTION','Company selector synchronized atomically');
  equal(await sideEffects(),before,'Activation has zero tax side effects');equal(await testHash(),preserved,'Activation leaves TEST points/sequences unchanged');
  // Real canonical transport capability evaluator, including explicit DENY and JWT restoration.
  await login(A,'service_role');equal((await one('select erp_sri_assert_transport_actor($1,$2) ok',[B,A])).ok,true,'Canonical transport actor permitted');
  equal((await one('select auth.role() role,auth.uid() actor')).role,'service_role','Service JWT role restored');
  await deny(()=>one('select erp_sri_assert_transport_actor($1,$2)',[B,OWNER]),'CAPABILITY_REQUIRED');
  await admin(`update erp_security_user_capability_overrides set effect='DENY' where company_id=${lit(B)} and user_id=${lit(A)} and capability_id='commercial.electronic_documents.authorize'`);
  await login(A,'service_role');await deny(()=>one('select erp_sri_assert_transport_actor($1,$2)',[B,A]),'CAPABILITY_REQUIRED');
  await admin(`update erp_security_user_capability_overrides set effect='GRANT' where company_id=${lit(B)} and user_id=${lit(A)} and capability_id='commercial.electronic_documents.authorize'`);
  // Actual reservation RPC: explicit sequence, environment-isolated reuse, no implicit counter 1.
  await admin(`insert into erp_entity_records(company_id,entity,record_id,payload) values(${lit(B)},'commercial_orders','SYNTHETIC_ORDER','{"number":"SYN-1","saleType":"EXPORT","status":"DRAFT"}');`);
  await login();const reservation=(await one('select erp_commercial_reserve_invoice_for_documents($1,$2,$3) result',[B,'SYNTHETIC_ORDER','HR'])).result;
  equal(reservation.sequential,'000000100','First reserved PROD identity is exact configured next');
  const repeat=(await one('select erp_commercial_reserve_invoice_for_documents($1,$2,$3) result',[B,'SYNTHETIC_ORDER','ETIQUETAS'])).result;
  equal(repeat.fullNumber,reservation.fullNumber,'HR and labels reuse one reservation');ok(!repeat.created,'Retry does not consume a second counter');
  await deny(()=>setNext(B,bPoint,'01',100,101),'SRI_SEQUENCE_ALREADY_ASSIGNED');
  await admin(`update electronic_document_sequences set next_value=100 where company_id=${lit(B)} and environment='PRODUCTION' and emission_point_id=${lit(bPoint)} and document_type='01'`);
  await login();await deny(()=>activate(B,true,true),'SRI_SEQUENCE_ALREADY_ASSIGNED');
  await admin(`update electronic_document_sequences set next_value=101 where company_id=${lit(B)} and environment='PRODUCTION' and emission_point_id=${lit(bPoint)} and document_type='01'`);
  await admin(`update commercial_invoice_reservations set status='REPLACED' where id=${lit(reservation.reservationId)}`);
  await login();await deny(()=>setNext(B,bPoint,'01',100,101),'SRI_SEQUENCE_ALREADY_ASSIGNED');
  await admin(`delete from electronic_document_sequences where company_id=${lit(B)} and environment='PRODUCTION' and emission_point_id=${lit(bPoint)} and document_type='01';`);
  await login();await deny(()=>one('select erp_commercial_reserve_invoice_for_documents($1,$2,$3)',[B,'SYNTHETIC_ORDER','HR']),'SRI_SEQUENCE_CONFIGURATION_REQUIRED');
  await run('reset role');equal((await one(`select count(*)::int n from electronic_document_sequences where company_id=${lit(B)} and environment='PRODUCTION' and emission_point_id=${lit(bPoint)} and document_type='01'`)).n,0,'Missing sequence remains absent');
  await login();await setNext(B,bPoint,'01',101,null);
  // Actual document creation and immutable TEST history across selector changes.
  const draftArgs = [B,testPoint,'01','2026-09-07','12345678','1.1.0','1.1.0',{ruc:'1717637084001'}, {identification:'1712345678',name:'Synthetic buyer'}, {erpEmission:{idempotencyKey:'SYNTHETIC_HISTORY',environment:'TEST'}},null,null,null,null,A];
  await login(A,'service_role');await run("select set_config('request.headers','{\"x-erp-service\":\"sri-electronic-documents\"}',false)");
  const draftSql='select create_electronic_document_draft('+draftArgs.map((_,i)=>'$'+(i+1)).join(',')+') result';
  await deny(()=>one(draftSql,draftArgs),'SRI_ENVIRONMENT_SELECTION_CHANGED');
  await login();await activate(B,true,true,randomUUID(),'TEST');await login(A,'service_role');
  const testDoc=(await one(draftSql,draftArgs)).result;
  equal(testDoc.environment,'TEST','TEST document emitted with its own enabled flag while PROD stays ON');
  await login();await activate(B,true,true);
  await login(A,'service_role');
  await one('select refresh_electronic_document_issue_date($1,$2,$3)',[testDoc.id,'2026-09-08',A]);checks++;
  await run('reset role');
  const changed=await one('select environment,sequential,access_key from electronic_documents where id=$1',[testDoc.id]);
  equal([changed.environment,changed.sequential],['TEST',37],'Historical TEST identity survives PROD default');equal(changed.access_key[23],'1','Historical key remains TEST');
  await one('select sri_assert_authorization_environment($1,$2,$3,$4)',[B,'TEST',changed.access_key,'PRUEBAS']);checks++;
  await deny(()=>one('select sri_assert_authorization_environment($1,$2,$3,$4)',[B,'TEST',changed.access_key,'PRODUCCION']),'SRI_AUTHORIZATION_ENVIRONMENT_MISMATCH');
  // Direct document mutation cannot switch an established environment.
  await deny(()=>run(`update electronic_documents set environment='PRODUCTION' where id=${lit(testDoc.id)}`),'SRI_EMISSION_POINT_MISMATCH');
  await deny(()=>one('select record_sri_authorization($1,$2,$3,$4,$5,$6,$7,$8)',[testDoc.id,'<response/>','AUTORIZADO','0'.repeat(49),'2026-09-08T12:00:00Z','PRUEBAS','<invoice/>',A]),'SRI_AUTHORIZATION_NUMBER_MISMATCH');
  for(const status of ['VALIDADO','XML_GENERADO','FIRMADO','ENVIADO_SRI']) await run(`update electronic_documents set status=${lit(status)} where id=${lit(testDoc.id)}`);
  await one('select record_sri_authorization($1,$2,$3,$4,$5,$6,$7,$8)',[testDoc.id,'<response/>','AUTORIZADO',changed.access_key,'2026-09-08T12:00:00Z','PRUEBAS','<invoice/>',A]);checks++;
  await login();
  const ncArgs=[...draftArgs];ncArgs[2]='04';ncArgs[9]={erpEmission:{environment:'TEST'}};ncArgs[13]=testDoc.id;
  await deny(()=>one(draftSql,ncArgs),'permission denied');
  await login(A,'service_role');
  const nc=(await one(draftSql,ncArgs)).result;
  equal([nc.environment,nc.emission_point_id,nc.parent_document_id],['TEST',testPoint,testDoc.id],'NC derives environment and original point while default remains PROD');
  await login();
  const imperioTestPoint=(await one('select erp_sri_configuration_state($1) state',[I])).state.emissionPoints.find(p=>p.environment==='TEST'&&p.emission_point_code==='002').id;
  const invalidRetention=[...draftArgs];invalidRetention[0]=I;invalidRetention[1]=imperioTestPoint;invalidRetention[2]='07';invalidRetention[5]='2.0.0';invalidRetention[6]='2.0.0';invalidRetention[7]={ruc:'1727970137001'};
  await login(A,'service_role');
  await deny(()=>one(draftSql,invalidRetention),'SRI_WITHHOLDING_COMPANY_NOT_ENABLED');
  // A document creator may lack AUTHORIZE. An independently authorized colleague can transmit it.
  const creatorOnly='33000000-0000-4000-8000-000000000003';
  await admin(`insert into auth.users(id) values(${lit(creatorOnly)});insert into user_profiles(user_id) values(${lit(creatorOnly)});
    insert into user_company_memberships(company_id,user_id,membership_status,membership_role) values(${lit(B)},${lit(creatorOnly)},'ACTIVE','MEMBER');
    insert into sri_company_memberships(company_id,auth_user_id,active,role_code) values(${lit(B)},${lit(creatorOnly)},true,'EMISOR');
    insert into erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason)
      values(${lit(B)},${lit(creatorOnly)},'commercial.electronic_documents.create','GRANT','Synthetic creator without authorization');`);
  const creatorArgs=[...draftArgs];creatorArgs[1]=bPoint;creatorArgs[9]={erpEmission:{idempotencyKey:'SYNTHETIC_OTHER_AUTHORIZER',environment:'PRODUCTION'}};creatorArgs[14]=creatorOnly;
  await login(creatorOnly,'service_role');
  const colleagueDoc=(await one(draftSql,creatorArgs)).result;
  equal(colleagueDoc.created_by,creatorOnly,'Document records its CREATE-only actor');
  await login(A,'service_role');
  await deny(()=>one('select erp_sri_assert_transport_actor($1,$2)',[B,creatorOnly]),'CAPABILITY_REQUIRED');
  equal((await one('select erp_sri_assert_transport_actor($1,$2) allowed',[B,A])).allowed,true,'Current authorizer passes canonical transport preflight');
  await admin(`insert into sri_transmissions(company_id,document_id,environment,transmission_type,endpoint_url,idempotency_key)
    values(${lit(B)},${lit(colleagueDoc.id)},'PRODUCTION','RECEPTION','https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',${lit(colleagueDoc.id+':RECEPTION')});`);
  const colleagueJob=(await one('select id from sri_transmissions where document_id=$1',[colleagueDoc.id])).id;
  await login();await deny(()=>one('select claim_sri_transmission($1,$2)',[colleagueJob,'SYNTHETIC_WORKER']),'permission denied');
  await login(A,'service_role');
  const claimed=(await one('select claim_sri_transmission($1,$2) job',[colleagueJob,'SYNTHETIC_WORKER'])).job;
  equal([claimed.status,claimed.attempt_number],['PROCESSING',1],'Service claim succeeds for current authorizer despite creator lacking AUTHORIZE');
  await login();const disabled=(await activate(B,false,true)).result;
  equal([disabled.test_enabled,disabled.production_enabled],[true,false],'PROD OFF preserves TEST ON');
  await deny(()=>one('select erp_commercial_reserve_invoice_for_documents($1,$2,$3)',[B,'SYNTHETIC_ORDER','HR']),'SRI_PRODUCTION_DISABLED');
  // API validates explicit environments and canonical server acknowledgments without network.
  const validInput={environment:'PRODUCTION',emissionPointId:bPoint,documentType:'01',nextValue:200,expectedNextValue:101,reason:'Synthetic'};
  const dummy={rpc:async()=>({data:{},error:null})};
  for(const environment of ['',undefined,'UNKNOWN']) await deny(()=>config.saveDocumentSequence(dummy,B,{...validInput,environment},randomUUID()),'ambiente');
  await deny(()=>config.saveDocumentSequence(dummy,B,validInput,randomUUID()),'confirmacion');
  await deny(()=>config.saveEmissionPoint(dummy,B,{environment:'',expectedUpdatedAt:null},randomUUID()),'ambiente');
  await deny(()=>config.setEnvironmentEnabled(dummy,B,{environment:'PRODUCTION',enabled:true,expectedEnabled:false,operationId:randomUUID(),reason:'Synthetic'}),'confirmacion');
  await deny(()=>run(`update sri_settings set production_enabled=true where company_id=${lit(B)}`),'permission denied');
  await deny(()=>run(`update electronic_document_sequences set next_value=1 where company_id=${lit(B)}`),'permission denied');
  await run('reset role');
  ok((await one("select count(*)::int n from erp_operations_commands where command_type='SRI_SEQUENCE_SET_NEXT'")).n>=10,'Every successful configuration operation is audited');
  console.log(`SRI dual configuration PASS ${checks}; real PostgreSQL functions, synthetic offline fixtures; real DB changes=0.`);
 } finally { await db.close(); }
}
main().catch(error=>{ console.error(error.message);if(error.position)console.error('SQL position',error.position);if(error.where)console.error(error.where);process.exitCode=1; });
