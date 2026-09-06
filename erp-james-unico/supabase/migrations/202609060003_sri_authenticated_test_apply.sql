-- Canonical per-company SRI TEST apply infrastructure only. No configuration/data apply.
begin;
alter table public.sri_settings add column test_enabled boolean not null default false;
create table public.sri_test_apply_operations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 plan_hash text not null, actor_id uuid not null references auth.users(id),
 state text not null check(state in ('PREPARING','CONFIGURED','CERTIFIED','COMPLETE','ROLLING_BACK','ROLLED_BACK')),
 lease_token uuid, lease_until timestamptz, storage_path text, certificate_fingerprint text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,plan_hash), unique(company_id,id)
);
alter table public.sri_test_apply_operations enable row level security;
revoke all on public.sri_test_apply_operations from public,anon,authenticated;
grant select on public.sri_test_apply_operations to service_role;
alter table public.sri_settings add column sri_test_apply_operation_id uuid;
alter table public.sri_settings add constraint sri_settings_test_apply_owner_fk foreign key(company_id,sri_test_apply_operation_id) references public.sri_test_apply_operations(company_id,id);
alter table public.emission_points add column sri_test_apply_operation_id uuid;
alter table public.emission_points add constraint emission_points_test_apply_owner_fk foreign key(company_id,sri_test_apply_operation_id) references public.sri_test_apply_operations(company_id,id);
alter table public.electronic_document_sequences add column sri_test_apply_operation_id uuid;
alter table public.electronic_document_sequences add constraint electronic_document_sequences_test_apply_owner_fk foreign key(company_id,sri_test_apply_operation_id) references public.sri_test_apply_operations(company_id,id);
alter table public.digital_certificates add column sri_test_apply_operation_id uuid;
alter table public.digital_certificates add constraint digital_certificates_test_apply_owner_fk foreign key(company_id,sri_test_apply_operation_id) references public.sri_test_apply_operations(company_id,id);

-- No browser may call this phase engine. The canonical API first validates the
-- actual ERP JWT and erp_security_assert_capability for this company. Only that
-- server boundary has service_role credentials; it supplies the verified actor.
create function public.erp_sri_test_apply_phase(p_company_id uuid,p_actor_id uuid,p_plan_hash text,p_phase text,p_lease uuid default null,p_certificate jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
 approved constant jsonb := $plan$[{"companyId":"cf331b82-7ac3-4065-9e38-d0bbcde96cd5","code":"BLESS","settings":{"legalName":"LANCHIMBA TUTILLO MANUEL CLEMENTE","commercialName":"BLESS FLOWER","ruc":"1717637084001","headOfficeAddress":"COMUNIDAD CARRERA\nCALLE CENTRAL S/N\nINTERSECCIÓN SANTA ROSA\nVÍA A OYACACHI\nREFERENCIA: A TRES CUADRAS DEL PARQUE CENTRAL\nCANGAHUA - CAYAMBE - PICHINCHA\nECUADOR","accountingRequired":true,"withholdingAgentNumber":"10","specialTaxpayerNumber":null,"rimpeLabel":null,"environment":"TEST","productionEnabled":false},"points":[{"establishmentCode":"001","emissionPointCode":"003","establishmentAddress":"COMUNIDAD CARRERA\nCALLE CENTRAL S/N\nINTERSECCIÓN SANTA ROSA\nVÍA A OYACACHI\nREFERENCIA: A TRES CUADRAS DEL PARQUE CENTRAL\nCANGAHUA - CAYAMBE - PICHINCHA\nECUADOR","name":"LOCAL","active":true},{"establishmentCode":"001","emissionPointCode":"002","establishmentAddress":"COMUNIDAD CARRERA\nCALLE CENTRAL S/N\nINTERSECCIÓN SANTA ROSA\nVÍA A OYACACHI\nREFERENCIA: A TRES CUADRAS DEL PARQUE CENTRAL\nCANGAHUA - CAYAMBE - PICHINCHA\nECUADOR","name":"EXPORT","active":true}],"sequences":[{"establishmentCode":"001","emissionPointCode":"003","environment":"TEST","documentType":"01","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"},{"establishmentCode":"001","emissionPointCode":"003","environment":"TEST","documentType":"04","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"},{"establishmentCode":"001","emissionPointCode":"002","environment":"TEST","documentType":"01","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"},{"establishmentCode":"001","emissionPointCode":"002","environment":"TEST","documentType":"04","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"},{"establishmentCode":"001","emissionPointCode":"002","environment":"TEST","documentType":"07","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"}],"certificate":{"path":"EXISTING_LOCAL_FILE_CONFIRMED","passwordSecretName":"SRI_P12_PASSWORD_BLESS","secretStatus":"SENSITIVE_PRODUCTION_PRESENT","storageBucket":"sri-private","canonicalObjectPath":"companies/cf331b82-7ac3-4065-9e38-d0bbcde96cd5/certificates/<sha256-fingerprint>.p12","status":"NOT_UPLOADED","humanRuntimePrecheck":"PASS","humanExpiration":"2029-03-28"},"productionEnabled":false,"retentionAuto":"No emission during apply"},{"companyId":"ab60abdc-fe53-4289-9ae2-8f749ee21cff","code":"IMPERIO","settings":{"legalName":"LANCHIMBA TIPANLUISA SANDY ANAHI","commercialName":"IMPERIO FLOWERS","ruc":"1727970137001","headOfficeAddress":"CALLE 3 DE NOVIEMBRE\nNÚMERO LOTE 4\nINTERSECCIÓN CACHICUNGO\nREFERENCIA: A DOS CUADRAS DE LA CANCHA COMUNAL CARRERA\nCANGAHUA - CAYAMBE - PICHINCHA\nECUADOR","accountingRequired":false,"withholdingAgentNumber":null,"specialTaxpayerNumber":null,"rimpeLabel":null,"environment":"TEST","productionEnabled":false},"points":[{"establishmentCode":"001","emissionPointCode":"003","establishmentAddress":"CALLE 3 DE NOVIEMBRE\nNÚMERO LOTE 4\nINTERSECCIÓN CACHICUNGO\nREFERENCIA: A DOS CUADRAS DE LA CANCHA COMUNAL CARRERA\nCANGAHUA - CAYAMBE - PICHINCHA\nECUADOR","name":"LOCAL","active":true},{"establishmentCode":"001","emissionPointCode":"002","establishmentAddress":"CALLE 3 DE NOVIEMBRE\nNÚMERO LOTE 4\nINTERSECCIÓN CACHICUNGO\nREFERENCIA: A DOS CUADRAS DE LA CANCHA COMUNAL CARRERA\nCANGAHUA - CAYAMBE - PICHINCHA\nECUADOR","name":"EXPORT","active":true}],"sequences":[{"establishmentCode":"001","emissionPointCode":"003","environment":"TEST","documentType":"01","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"},{"establishmentCode":"001","emissionPointCode":"003","environment":"TEST","documentType":"04","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"},{"establishmentCode":"001","emissionPointCode":"002","environment":"TEST","documentType":"01","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"},{"establishmentCode":"001","emissionPointCode":"002","environment":"TEST","documentType":"04","lastIssuedNumber":0,"expectedStoredNext":1,"expectedFirst":"000000001"}],"certificate":{"path":"EXISTING_LOCAL_FILE_CONFIRMED","passwordSecretName":"SRI_P12_PASSWORD_IMPERIO","secretStatus":"SENSITIVE_PRODUCTION_PRESENT","storageBucket":"sri-private","canonicalObjectPath":"companies/ab60abdc-fe53-4289-9ae2-8f749ee21cff/certificates/<sha256-fingerprint>.p12","status":"NOT_UPLOADED","humanRuntimePrecheck":"PASS","humanExpiration":"2030-06-19"},"productionEnabled":false,"retentionAuto":"DISABLED; no 07 sequence row"}]$plan$::jsonb;
 c jsonb; s jsonb; p jsonb; q jsonb; o public.sri_test_apply_operations%rowtype;
 point_id uuid; cert_id uuid; expected_n integer; n integer; setting_on boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='SERVER_ACTION_REQUIRED';end if;
 if p_actor_id is null or (p_phase not in ('disable','rollback') and not public.erp_is_company_member(p_company_id,p_actor_id)) then raise exception using errcode='42501',message='COMPANY_ACCESS_REQUIRED';end if;
 if p_plan_hash is distinct from '6bb2a1af90e761a31bb97b1b85d73c658fc9ba0f64cbac05da71a68585c6b107' then raise exception 'PLAN_DRIFT';end if;
 select value into c from jsonb_array_elements(approved) where value->>'companyId'=p_company_id::text;
 if c is null then raise exception 'COMPANY_NOT_APPROVED';end if;
 s:=c->'settings';expected_n:=jsonb_array_length(c->'sequences');
 if p_phase not in ('disable','rollback') then
 if not exists(select 1 from companies where id=p_company_id and is_active and tax_id=s->>'ruc' and sri_environment='TEST') then raise exception 'CANONICAL_COMPANY_DRIFT';end if;
 if not exists(select 1 from storage.buckets where id='sri-private' and not public) then raise exception 'PRIVATE_STORAGE_REQUIRED';end if;
 if (select md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname='erp_reserve_commercial_order_identifiers_u2c3_internal') is distinct from '5879e91d6a545811e6948f7b7ee6b4ef'
 or (select md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname='create_electronic_document_draft_u2a_internal') is distinct from 'f2bc3ce75d7e022b0c7353ba77a91b41' then raise exception 'PLAN_DRIFT';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':SRI_TEST_APPLY',0));
 select * into o from sri_test_apply_operations where company_id=p_company_id and plan_hash=p_plan_hash for update;
 select coalesce(test_enabled,false) into setting_on from sri_settings where company_id=p_company_id;
 if p_phase='status' then
   if o.state='COMPLETE' then return jsonb_build_object('status','ALREADY_APPLIED','operation_id',o.id,'test_enabled',coalesce(setting_on,false),'production_enabled',false);end if;
   if o.id is null or o.state='ROLLED_BACK' then
     if exists(select 1 from sri_settings where company_id=p_company_id) or exists(select 1 from emission_points where company_id=p_company_id)
       or exists(select 1 from electronic_document_sequences where company_id=p_company_id) or exists(select 1 from digital_certificates where company_id=p_company_id)
       or exists(select 1 from electronic_documents where company_id=p_company_id) then raise exception 'BASELINE_DRIFT';end if;
   end if;
   return jsonb_build_object('status',coalesce(o.state,'READY'),'operation_id',o.id,'test_enabled',coalesce(setting_on,false),'production_enabled',false);
 end if;
 if p_phase='begin' then
   if o.state='COMPLETE' then return jsonb_build_object('status','ALREADY_APPLIED','operation_id',o.id,'test_enabled',coalesce(setting_on,false),'production_enabled',false);end if;
   if o.id is not null and o.state not in ('ROLLED_BACK') then
     if o.lease_until>now() then raise exception 'APPLY_IN_PROGRESS';end if;
     -- A timed-out request can only recover by compensating its own operation.
     update sri_test_apply_operations set lease_token=p_lease,lease_until=now()+interval '5 minutes',actor_id=p_actor_id,updated_at=now() where id=o.id;
     return jsonb_build_object('status','RECOVERY_REQUIRED','operation_id',o.id,'storage_path',o.storage_path);
   end if;
   if p_lease is null then raise exception 'LEASE_REQUIRED';end if;
   if exists(select 1 from sri_settings where company_id=p_company_id) or exists(select 1 from emission_points where company_id=p_company_id)
    or exists(select 1 from electronic_document_sequences where company_id=p_company_id) or exists(select 1 from digital_certificates where company_id=p_company_id)
    or exists(select 1 from electronic_documents where company_id=p_company_id) then raise exception 'BASELINE_DRIFT';end if;
   if o.id is null then
     insert into sri_test_apply_operations(company_id,plan_hash,actor_id,state,lease_token,lease_until) values(p_company_id,p_plan_hash,p_actor_id,'PREPARING',p_lease,now()+interval '5 minutes') returning * into o;
   else
     update sri_test_apply_operations set state='PREPARING',actor_id=p_actor_id,lease_token=p_lease,lease_until=now()+interval '5 minutes',storage_path=null,certificate_fingerprint=null,updated_at=now() where id=o.id returning * into o;
   end if;
   insert into sri_settings(company_id,legal_name,commercial_name,ruc,head_office_address,accounting_required,special_taxpayer_number,withholding_agent_number,rimpe_label,
    environment,production_enabled,test_enabled,emission_type,immediate_transmission,invoice_xml_version,credit_note_xml_version,delivery_guide_xml_version,withholding_xml_version,technical_spec_version,technical_spec_date,created_by,updated_by,sri_test_apply_operation_id)
   values(p_company_id,s->>'legalName',s->>'commercialName',s->>'ruc',s->>'headOfficeAddress',(s->>'accountingRequired')::boolean,null,s->>'withholdingAgentNumber',null,
    'TEST',false,false,'1',true,'1.1.0','1.1.0','1.1.0','2.0.0','2.34','2026-07-27',p_actor_id,p_actor_id,o.id);
   for p in select value from jsonb_array_elements(c->'points') loop
     insert into emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address,name,active,created_by,updated_by,sri_test_apply_operation_id)
     values(p_company_id,'TEST','001',p->>'emissionPointCode',p->>'establishmentAddress',p->>'name',true,p_actor_id,p_actor_id,o.id) returning id into point_id;
     for q in select value from jsonb_array_elements(c->'sequences') where value->>'emissionPointCode'=p->>'emissionPointCode' loop
       insert into electronic_document_sequences(company_id,emission_point_id,environment,document_type,next_value,updated_by,sri_test_apply_operation_id)
       values(p_company_id,point_id,'TEST',q->>'documentType',1,p_actor_id,o.id);
     end loop;
   end loop;
   update sri_test_apply_operations set state='CONFIGURED',updated_at=now() where id=o.id;
   return jsonb_build_object('status','CONFIGURED','operation_id',o.id,'rows',3+expected_n,'test_enabled',false,'production_enabled',false);
 end if;
 if o.id is null or o.lease_token is distinct from p_lease or o.actor_id<>p_actor_id then raise exception 'OPERATION_LEASE_MISMATCH';end if;
 if p_phase='storage-intent' then
   if o.state<>'CONFIGURED' or coalesce(p_certificate->>'fingerprint','') !~ '^[a-f0-9]{64}$' then raise exception 'CERTIFICATE_METADATA_INVALID';end if;
   update sri_test_apply_operations set storage_path='companies/'||p_company_id||'/certificates/'||(p_certificate->>'fingerprint')||'.p12',certificate_fingerprint=p_certificate->>'fingerprint',updated_at=now() where id=o.id returning * into o;
   return jsonb_build_object('operation_id',o.id,'storage_path',o.storage_path);
 elsif p_phase='certificate' then
   if o.state<>'CONFIGURED' or o.storage_path is null or p_certificate->>'holderRuc' is distinct from s->>'ruc'
     or lower(p_certificate->>'fingerprintSha256') is distinct from o.certificate_fingerprint
     or p_certificate->>'notAfter' is null or p_certificate->>'notBefore' is null
     or (p_certificate->>'notAfter')::timestamptz<=now() or (p_certificate->>'notBefore')::timestamptz>now() then raise exception 'CERTIFICATE_METADATA_INVALID';end if;
   insert into digital_certificates(company_id,alias,storage_bucket,storage_object_path,password_secret_name,certificate_serial,subject_name,subject_ruc,issuer_name,valid_from,valid_until,fingerprint_sha256,active,last_validated_at,validation_status,created_by,updated_by,sri_test_apply_operation_id)
   values(p_company_id,'Certificado SRI '||(c->>'code'),'sri-private',o.storage_path,c#>>'{certificate,passwordSecretName}',p_certificate->>'serialNumber','RUC '||(s->>'ruc'),s->>'ruc',p_certificate->>'issuer',(p_certificate->>'notBefore')::timestamptz,(p_certificate->>'notAfter')::timestamptz,o.certificate_fingerprint,true,now(),'VALID',p_actor_id,p_actor_id,o.id) returning id into cert_id;
   update sri_test_apply_operations set state='CERTIFIED',updated_at=now() where id=o.id;
   return jsonb_build_object('status','CERTIFIED','certificate_id',cert_id,'operation_id',o.id);
 elsif p_phase='disable' then
   update sri_settings set test_enabled=false,updated_by=p_actor_id where company_id=p_company_id and sri_test_apply_operation_id=o.id;
   update sri_test_apply_operations set state='ROLLING_BACK',updated_at=now() where id=o.id;
   return jsonb_build_object('status','ROLLING_BACK','operation_id',o.id,'storage_path',o.storage_path,'test_enabled',false);
 elsif p_phase='rollback' then
   if o.state<>'ROLLING_BACK' then raise exception 'DISABLE_FIRST';end if;
   if exists(select 1 from electronic_documents where company_id=p_company_id) or exists(select 1 from electronic_document_sequences where company_id=p_company_id and sri_test_apply_operation_id=o.id and next_value<>1) then raise exception 'ROLLBACK_HAS_BUSINESS_REFERENCES';end if;
   if exists(select 1 from storage.objects where bucket_id='sri-private' and name=o.storage_path and user_metadata->>'operation_id'=o.id::text) then raise exception 'STORAGE_CLEANUP_REQUIRED';end if;
   delete from digital_certificates where company_id=p_company_id and sri_test_apply_operation_id=o.id;
   delete from electronic_document_sequences where company_id=p_company_id and sri_test_apply_operation_id=o.id and environment='TEST' and next_value=1;
   delete from emission_points where company_id=p_company_id and sri_test_apply_operation_id=o.id and environment='TEST';
   delete from sri_settings where company_id=p_company_id and sri_test_apply_operation_id=o.id and not test_enabled and not production_enabled;
   update sri_test_apply_operations set state='ROLLED_BACK',lease_until=null,updated_at=now() where id=o.id;
   return jsonb_build_object('status','ROLLED_BACK','operation_id',o.id,'test_enabled',false,'production_enabled',false,'rows',0,'storage',0);
 elsif p_phase='enable' then
   if o.state<>'CERTIFIED' then raise exception 'CERTIFICATE_REQUIRED';end if;
   if exists(select 1 from electronic_documents where company_id=p_company_id)
     or exists(select 1 from electronic_document_sequences where company_id=p_company_id and (environment<>'TEST' or next_value<>1 or sri_test_apply_operation_id is distinct from o.id)) then raise exception 'SEQUENCE_OR_DOCUMENT_DRIFT';end if;
   select count(*) into n from electronic_document_sequences where company_id=p_company_id and sri_test_apply_operation_id=o.id;
   if n<>expected_n then raise exception 'SEQUENCE_COUNT_DRIFT';end if;
   if not exists(select 1 from digital_certificates where company_id=p_company_id and sri_test_apply_operation_id=o.id and active and validation_status='VALID' and subject_ruc=s->>'ruc' and valid_until>now()) then raise exception 'CERTIFICATE_REQUIRED';end if;
   if not exists(select 1 from storage.objects where bucket_id='sri-private' and name=o.storage_path) then raise exception 'CERTIFICATE_STORAGE_REQUIRED';end if;
   if exists(select 1 from emission_points where company_id=p_company_id and (environment<>'TEST' or establishment_code<>'001' or emission_point_code not in ('002','003') or sri_test_apply_operation_id is distinct from o.id)) then raise exception 'POINT_DRIFT';end if;
   if (select count(*) from emission_points where company_id=p_company_id)<>2 then raise exception 'POINT_DRIFT';end if;
   if exists(select 1 from jsonb_array_elements(c->'sequences') expected where not exists(
     select 1 from electronic_document_sequences seq join emission_points pt on pt.id=seq.emission_point_id and pt.company_id=seq.company_id
     where seq.company_id=p_company_id and seq.document_type=expected->>'documentType' and pt.emission_point_code=expected->>'emissionPointCode' and pt.active and pt.establishment_address=s->>'headOfficeAddress')) then raise exception 'POINT_DRIFT';end if;
   update sri_settings set test_enabled=true,updated_by=p_actor_id where company_id=p_company_id and sri_test_apply_operation_id=o.id and environment='TEST' and not production_enabled and ruc=s->>'ruc'
    and legal_name=s->>'legalName' and commercial_name=s->>'commercialName' and head_office_address=s->>'headOfficeAddress'
    and accounting_required=(s->>'accountingRequired')::boolean and withholding_agent_number is not distinct from s->>'withholdingAgentNumber' and rimpe_label is null and special_taxpayer_number is null;
   if not found then raise exception 'SETTINGS_DRIFT';end if;
   update sri_test_apply_operations set state='COMPLETE',lease_until=null,updated_at=now() where id=o.id;
   return jsonb_build_object('status','PASS','operation_id',o.id,'test_enabled',true,'production_enabled',false,'rows',4+expected_n,'storage',1,'sequences_consumed',0,'documents_created',0);
 end if;
 raise exception 'INVALID_PHASE';
end $fn$;
revoke all on function public.erp_sri_test_apply_phase(uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.erp_sri_test_apply_phase(uuid,uuid,text,text,uuid,jsonb) to service_role;

-- Guard all counter changes and document creation while the company is OFF.
-- The apply's initialization is the sole exception: owned TEST row next_value=1.
create function public.sri_test_enabled_write_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $g$
declare enabled boolean; begin
 if new.environment='TEST' then
   select test_enabled into enabled from sri_settings where company_id=new.company_id;
   if coalesce(enabled,false)=false then
     if tg_table_name='electronic_document_sequences' and tg_op='INSERT' then
       if new.next_value=1 and exists(select 1 from sri_test_apply_operations where id=new.sri_test_apply_operation_id and company_id=new.company_id and state='PREPARING') then return new;end if;
     end if;
     raise exception 'SRI_TEST_DISABLED';
   end if;
 end if;return new;
end $g$;
revoke all on function public.sri_test_enabled_write_guard() from public,anon,authenticated;
create trigger sri_test_counter_enabled before insert or update of next_value on public.electronic_document_sequences for each row execute function public.sri_test_enabled_write_guard();
create trigger sri_test_document_enabled before insert on public.electronic_documents for each row execute function public.sri_test_enabled_write_guard();
notify pgrst,'reload schema';
commit;
