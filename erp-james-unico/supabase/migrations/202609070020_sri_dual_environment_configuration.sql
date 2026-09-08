begin;
-- Infrastructure only. No existing company, settings, point, counter or document is changed.
-- The selector is the default for new documents; the two enabled flags are independent.
alter table public.sri_settings drop constraint if exists sri_settings_production_gate;

create or replace function public.sri_validate_settings_company()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_company public.companies%rowtype;
begin
 select * into v_company from public.companies where id=new.company_id;
 if not found or not v_company.is_active then raise exception 'SRI_COMPANY_NOT_ACTIVE'; end if;
 if new.ruc is distinct from v_company.tax_id then raise exception 'SRI_RUC_DOES_NOT_MATCH_COMPANY'; end if;
 if new.environment not in ('TEST','PRODUCTION') or new.environment is distinct from v_company.sri_environment then
   raise exception 'SRI_COMPANY_ENVIRONMENT_MISMATCH'; end if;
 return new;
end $$;

create or replace function public.erp_sri_config_assert_access(p_company_id uuid,p_capability text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not public.erp_is_company_member(p_company_id,auth.uid()) then
   raise exception using errcode='42501',message='SRI_AUTHENTICATED_COMPANY_ACTOR_REQUIRED'; end if;
 perform public.erp_security_assert_capability(p_company_id,p_capability);
end $$;

create or replace function public.erp_sri_config_replay(p_company_id uuid,p_operation_id uuid,p_command text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype;
begin
 if p_operation_id is null then raise exception 'SRI_CONFIGURATION_OPERATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('SRI_CONFIG_OPERATION:'||p_operation_id::text,0));
 select * into v_command from public.erp_operations_commands where operation_id=p_operation_id;
 if found then
   if v_command.company_id is distinct from p_company_id or v_command.command_type is distinct from p_command
     or v_command.user_id is distinct from auth.uid() or (v_command.request_payload-'_transaction_id') is distinct from p_request then
     raise exception using errcode='23505',message='SRI_CONFIGURATION_OPERATION_CONFLICT'; end if;
   return v_command.result;
 end if;
 return null;
end $$;

create or replace function public.erp_sri_configuration_state(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not public.erp_is_company_member(p_company_id,auth.uid()) then
   raise exception using errcode='42501',message='SRI_AUTHENTICATED_COMPANY_ACTOR_REQUIRED'; end if;
 if not (public.erp_security_has_capability(p_company_id,'tax.parameters.view') or public.erp_security_has_capability(p_company_id,'tax.parameters.manage')
   or public.erp_security_has_capability(p_company_id,'admin.sequences.manage')) then raise exception using errcode='42501',message='CAPABILITY_REQUIRED'; end if;
 return jsonb_build_object('settings',(select to_jsonb(s) from public.sri_settings s where company_id=p_company_id),
   'emissionPoints',coalesce((select jsonb_agg(to_jsonb(p) order by environment,establishment_code,emission_point_code) from public.emission_points p where company_id=p_company_id),'[]'::jsonb),
   'sequences',coalesce((select jsonb_agg(to_jsonb(s) order by environment,emission_point_id,document_type) from public.electronic_document_sequences s where company_id=p_company_id),'[]'::jsonb));
end $$;

create or replace function public.erp_sri_config_audit(p_company_id uuid,p_operation_id uuid,p_command text,p_request jsonb,p_result jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,p_command,p_company_id::text,p_request||jsonb_build_object('_transaction_id',txid_current()::text),
 p_result,'CONFIRMED',auth.uid(),'sri-configuration',clock_timestamp(),clock_timestamp());
end $$;

create or replace function public.sri_assert_environment_enabled(p_company_id uuid,p_environment text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.sri_settings%rowtype;
begin
 if p_environment is null or p_environment not in ('TEST','PRODUCTION') then raise exception 'SRI_ENVIRONMENT_INVALID'; end if;
 select * into s from public.sri_settings where company_id=p_company_id;
 if not found then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
 if (p_environment='TEST' and not s.test_enabled) or (p_environment='PRODUCTION' and not s.production_enabled) then
   raise exception using errcode='42501',message=case p_environment when 'TEST' then 'SRI_TEST_DISABLED' else 'SRI_PRODUCTION_DISABLED' end;
 end if;
end $$;

create or replace function public.sri_assert_canonical_certificate(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ruc text; v_count integer;
begin
 select c.tax_id into v_ruc from public.companies c join public.sri_settings s on s.company_id=c.id
   where c.id=p_company_id and c.is_active and s.ruc=c.tax_id;
 if not found then raise exception 'SRI_CANONICAL_COMPANY_RUC_REQUIRED'; end if;
 select count(*) into v_count from public.digital_certificates where company_id=p_company_id and active;
 if v_count<>1 then raise exception 'SRI_SINGLE_ACTIVE_CERTIFICATE_REQUIRED'; end if;
 if not exists(select 1 from public.digital_certificates where company_id=p_company_id and active
   and validation_status='VALID' and subject_ruc=v_ruc and valid_from is not null and valid_until is not null
   and valid_from<=clock_timestamp() and valid_until>clock_timestamp() and last_validated_at is not null
   and fingerprint_sha256 ~ '^[0-9a-f]{64}$' and storage_bucket='sri-private'
   and storage_object_path='companies/'||p_company_id::text||'/certificates/'||fingerprint_sha256||'.p12'
   and exists(select 1 from storage.objects stored where stored.bucket_id=storage_bucket and stored.name=storage_object_path)
   and password_secret_name=case p_company_id
     when 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5'::uuid then 'SRI_P12_PASSWORD_BLESS'
     when 'ab60abdc-fe53-4289-9ae2-8f749ee21cff'::uuid then 'SRI_P12_PASSWORD_IMPERIO' else null end) then
   raise exception 'SRI_VALID_CANONICAL_CERTIFICATE_REQUIRED'; end if;
end $$;

create or replace function public.sri_assert_document_routing(p_company_id uuid,p_environment text,p_point_id uuid,p_document_type text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ruc text; v_point public.emission_points%rowtype;
begin
 if p_environment is null or p_environment not in ('TEST','PRODUCTION') then raise exception 'SRI_ENVIRONMENT_INVALID'; end if;
 select tax_id into v_ruc from public.companies where id=p_company_id and is_active;
 if not found then raise exception 'SRI_COMPANY_NOT_ACTIVE'; end if;
 if p_document_type is null or p_document_type not in ('01','04','07') then raise exception 'SRI_DOCUMENT_TYPE_NOT_ENABLED'; end if;
 -- Retention is enabled only for the canonical configured withholding agent.
 if p_document_type='07' and (v_ruc='1727970137001' or not exists(select 1 from public.sri_settings
   where company_id=p_company_id and nullif(btrim(withholding_agent_number),'') is not null)) then
   raise exception 'SRI_WITHHOLDING_COMPANY_NOT_ENABLED'; end if;
 select * into v_point from public.emission_points where company_id=p_company_id and id=p_point_id
   and environment=p_environment and active;
 if not found then raise exception 'SRI_ACTIVE_EMISSION_POINT_REQUIRED'; end if;
 if v_point.establishment_code<>'001' or (p_document_type in ('01','04') and v_point.emission_point_code not in ('002','003'))
   or (p_document_type='07' and v_point.emission_point_code<>'002') then raise exception 'SRI_DOCUMENT_ROUTING_INVALID'; end if;
end $$;

create or replace function public.erp_sri_set_sequence_next(p_company_id uuid,p_environment text,p_emission_point_id uuid,p_document_type text,
 p_next_value bigint,p_expected_next_value bigint,p_operation_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; r jsonb; v_before bigint; v_highest bigint; v_row public.electronic_document_sequences%rowtype;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'admin.sequences.manage');
 if p_next_value is null or p_next_value not between 1 and 999999999 or nullif(btrim(p_reason),'') is null then raise exception 'SRI_SEQUENCE_INPUT_INVALID'; end if;
 q:=jsonb_build_object('environment',p_environment,'emissionPointId',p_emission_point_id,'documentType',p_document_type,
   'nextValue',p_next_value,'expectedNextValue',p_expected_next_value,'reason',btrim(p_reason));
 r:=public.erp_sri_config_replay(p_company_id,p_operation_id,'SRI_SEQUENCE_SET_NEXT',q); if r is not null then return r; end if;
 perform 1 from public.sri_settings where company_id=p_company_id for update;
 if not found then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
 perform public.sri_assert_document_routing(p_company_id,p_environment,p_emission_point_id,p_document_type);
 perform 1 from public.emission_points where company_id=p_company_id and id=p_emission_point_id for update;
 select * into v_row from public.electronic_document_sequences where company_id=p_company_id and environment=p_environment
   and emission_point_id=p_emission_point_id and document_type=p_document_type for update;
 v_before:=v_row.next_value;
 if v_before is distinct from p_expected_next_value then raise exception using errcode='40001',message='SRI_SEQUENCE_VERSION_CONFLICT'; end if;
 select max(sequential) into v_highest from (
   select sequential from public.electronic_documents where company_id=p_company_id and environment=p_environment and emission_point_id=p_emission_point_id and document_type=p_document_type
   union all select sequential from public.commercial_invoice_reservations where company_id=p_company_id and environment=p_environment and emission_point_id=p_emission_point_id and document_type=p_document_type
 ) used_numbers;
 if p_next_value<=coalesce(v_highest,0) then raise exception 'SRI_SEQUENCE_ALREADY_ASSIGNED'; end if;
 r:=jsonb_build_object('company_id',p_company_id,'environment',p_environment,'emission_point_id',p_emission_point_id,'document_type',p_document_type,
   'previous_next_value',v_before,'next_value',p_next_value,'operation_id',p_operation_id,'documents_created',0,'sequences_consumed',0);
 -- Same-transaction, actor/capability/scope/exact-value evidence authorizes configuration while OFF.
 perform public.erp_sri_config_audit(p_company_id,p_operation_id,'SRI_SEQUENCE_SET_NEXT',q,r);
 if v_before is distinct from p_next_value then
   insert into public.electronic_document_sequences(company_id,environment,emission_point_id,document_type,next_value,updated_by)
   values(p_company_id,p_environment,p_emission_point_id,p_document_type,p_next_value,auth.uid())
   on conflict(company_id,emission_point_id,environment,document_type) do update set next_value=excluded.next_value,updated_by=excluded.updated_by;
 end if;
 return r;
end $$;

create or replace function public.erp_sri_save_emission_point(p_company_id uuid,p_environment text,p_establishment_code text,p_emission_point_code text,
 p_address text,p_name text,p_active boolean,p_expected_updated_at timestamptz,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; r jsonb; v_before public.emission_points%rowtype; v_after public.emission_points%rowtype;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'tax.parameters.manage');
 if p_environment is null or p_environment not in ('TEST','PRODUCTION') or p_establishment_code is distinct from '001'
   or p_emission_point_code is null or p_emission_point_code not in ('002','003') or nullif(btrim(p_address),'') is null or p_active is null then raise exception 'SRI_POINT_INPUT_INVALID'; end if;
 q:=jsonb_build_object('environment',p_environment,'establishmentCode',p_establishment_code,'emissionPointCode',p_emission_point_code,
   'address',btrim(p_address),'name',p_name,'active',p_active,'expectedUpdatedAt',p_expected_updated_at);
 r:=public.erp_sri_config_replay(p_company_id,p_operation_id,'SRI_EMISSION_POINT_SAVE',q); if r is not null then return r; end if;
 perform 1 from public.sri_settings where company_id=p_company_id for update; if not found then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
 select * into v_before from public.emission_points where company_id=p_company_id and environment=p_environment
   and establishment_code=p_establishment_code and emission_point_code=p_emission_point_code for update;
 if v_before.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='SRI_POINT_VERSION_CONFLICT'; end if;
 insert into public.emission_points(company_id,environment,establishment_code,emission_point_code,establishment_address,name,active,created_by,updated_by)
 values(p_company_id,p_environment,p_establishment_code,p_emission_point_code,btrim(p_address),p_name,p_active,auth.uid(),auth.uid())
 on conflict(company_id,environment,establishment_code,emission_point_code) do update
 set establishment_address=excluded.establishment_address,name=excluded.name,active=excluded.active,updated_by=excluded.updated_by,updated_at=clock_timestamp()
 returning * into v_after;
 r:=to_jsonb(v_after);
 perform public.erp_sri_config_audit(p_company_id,p_operation_id,'SRI_EMISSION_POINT_SAVE',q,jsonb_build_object('before',to_jsonb(v_before),'after',r));
 -- Return and replay use an identical shape.
 update public.erp_operations_commands set result=r||jsonb_build_object('audit_before',to_jsonb(v_before)) where operation_id=p_operation_id;
 return r||jsonb_build_object('audit_before',to_jsonb(v_before));
end $$;

create or replace function public.erp_sri_set_environment_enabled(p_company_id uuid,p_environment text,p_enabled boolean,p_expected_enabled boolean,p_operation_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; r jsonb; s public.sri_settings%rowtype; v_flag boolean; v_point public.emission_points%rowtype; v_type text; v_ruc text; v_ep text;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'tax.parameters.manage');
 if p_environment is null or p_environment not in ('TEST','PRODUCTION') or p_enabled is null or p_expected_enabled is null or nullif(btrim(p_reason),'') is null then
   raise exception 'SRI_ACTIVATION_INPUT_INVALID'; end if;
 q:=jsonb_build_object('environment',p_environment,'enabled',p_enabled,'expectedEnabled',p_expected_enabled,'reason',btrim(p_reason));
 r:=public.erp_sri_config_replay(p_company_id,p_operation_id,'SRI_ENVIRONMENT_SET_ENABLED',q); if r is not null then return r; end if;
 -- Issuance and configuration serialize on the settings row; flags never consume identities.
 select * into s from public.sri_settings where company_id=p_company_id for update;
 if not found then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
 v_flag:=case p_environment when 'TEST' then s.test_enabled else s.production_enabled end;
 if v_flag is distinct from p_expected_enabled then raise exception using errcode='40001',message='SRI_ACTIVATION_VERSION_CONFLICT'; end if;
 if p_enabled then
   perform public.sri_assert_canonical_certificate(p_company_id);
   select tax_id into v_ruc from public.companies where id=p_company_id;
   foreach v_ep in array array['002','003'] loop
     select * into v_point from public.emission_points where company_id=p_company_id and environment=p_environment
       and establishment_code='001' and emission_point_code=v_ep and active for share;
     if not found then raise exception 'SRI_ACTIVATION_ROUTING_REQUIRED'; end if;
     foreach v_type in array case when v_ruc='1717637084001' and v_ep='002' then array['01','04','07'] else array['01','04'] end loop
       perform public.sri_assert_document_routing(p_company_id,p_environment,v_point.id,v_type);
       if not exists(select 1 from public.electronic_document_sequences where company_id=p_company_id and environment=p_environment
         and emission_point_id=v_point.id and document_type=v_type and next_value between 1 and 999999999) then raise exception 'SRI_ACTIVATION_SEQUENCE_REQUIRED'; end if;
       if exists(select 1 from public.electronic_document_sequences checked_sequence where checked_sequence.company_id=p_company_id and checked_sequence.environment=p_environment
         and checked_sequence.emission_point_id=v_point.id and checked_sequence.document_type=v_type and checked_sequence.next_value<=coalesce((select max(sequential) from (
           select sequential from public.electronic_documents where company_id=p_company_id and environment=p_environment and emission_point_id=v_point.id and document_type=v_type
           union all select sequential from public.commercial_invoice_reservations where company_id=p_company_id and environment=p_environment and emission_point_id=v_point.id and document_type=v_type
         ) occupied),0)) then raise exception 'SRI_SEQUENCE_ALREADY_ASSIGNED'; end if;
     end loop;
   end loop;
 end if;
 if v_flag is distinct from p_enabled or (p_enabled and s.environment<>p_environment) then
   if p_enabled then update public.companies set sri_environment=p_environment where id=p_company_id and sri_environment is distinct from p_environment; end if;
   update public.sri_settings set
     environment=case when p_enabled then p_environment else environment end,
     test_enabled=case when p_environment='TEST' then p_enabled else test_enabled end,
     production_enabled=case when p_environment='PRODUCTION' then p_enabled else production_enabled end,
     updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=p_company_id;
 end if;
 select to_jsonb(settings) into r from public.sri_settings settings where company_id=p_company_id;
 r:=r||jsonb_build_object('operation_id',p_operation_id,'documents_created',0,'sequences_consumed',0);
 perform public.erp_sri_config_audit(p_company_id,p_operation_id,'SRI_ENVIRONMENT_SET_ENABLED',q,r||jsonb_build_object('audit_before',to_jsonb(s)));
 return r||jsonb_build_object('audit_before',to_jsonb(s));
end $$;

create or replace function public.erp_sri_save_settings(p_company_id uuid,p_settings jsonb,p_expected_updated_at timestamptz,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; r jsonb; s public.sri_settings%rowtype; v_candidate public.sri_settings%rowtype;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'tax.parameters.manage');
 if jsonb_typeof(p_settings) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_settings) k where k not in
   ('legal_name','commercial_name','ruc','head_office_address','accounting_required','special_taxpayer_number','withholding_agent_number','rimpe_label',
   'invoice_xml_version','credit_note_xml_version','delivery_guide_xml_version','withholding_xml_version','retry_initial_seconds','retry_max_seconds','retry_max_attempts','xml_ride_emails')) then
   raise exception 'SRI_SETTINGS_INPUT_INVALID'; end if;
 q:=jsonb_build_object('settings',p_settings,'expectedUpdatedAt',p_expected_updated_at);
 r:=public.erp_sri_config_replay(p_company_id,p_operation_id,'SRI_SETTINGS_SAVE',q); if r is not null then return r; end if;
 select * into s from public.sri_settings where company_id=p_company_id for update;
 if not found then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
 if s.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='SRI_SETTINGS_VERSION_CONFLICT'; end if;
 v_candidate:=jsonb_populate_record(s,p_settings);
 if v_candidate.ruc is distinct from s.ruc then raise exception 'SRI_CANONICAL_RUC_IMMUTABLE'; end if;
 update public.sri_settings set legal_name=v_candidate.legal_name,commercial_name=v_candidate.commercial_name,head_office_address=v_candidate.head_office_address,
   accounting_required=v_candidate.accounting_required,special_taxpayer_number=v_candidate.special_taxpayer_number,withholding_agent_number=v_candidate.withholding_agent_number,
   rimpe_label=v_candidate.rimpe_label,invoice_xml_version=v_candidate.invoice_xml_version,credit_note_xml_version=v_candidate.credit_note_xml_version,
   delivery_guide_xml_version=v_candidate.delivery_guide_xml_version,withholding_xml_version=v_candidate.withholding_xml_version,retry_initial_seconds=v_candidate.retry_initial_seconds,
   retry_max_seconds=v_candidate.retry_max_seconds,retry_max_attempts=v_candidate.retry_max_attempts,xml_ride_emails=v_candidate.xml_ride_emails,
   updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=p_company_id returning * into v_candidate;
 r:=to_jsonb(v_candidate)||jsonb_build_object('audit_before',to_jsonb(s));
 perform public.erp_sri_config_audit(p_company_id,p_operation_id,'SRI_SETTINGS_SAVE',q,r);
 return r;
end $$;

create or replace function public.sri_test_enabled_write_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='electronic_document_sequences' then
   if auth.uid() is not null and auth.role()='authenticated' and public.erp_is_company_member(new.company_id,auth.uid())
     and public.erp_security_has_capability(new.company_id,'admin.sequences.manage') and exists(
       select 1 from public.erp_operations_commands c where c.company_id=new.company_id and c.command_type='SRI_SEQUENCE_SET_NEXT'
       and c.user_id=auth.uid() and c.request_payload->>'_transaction_id'=txid_current()::text
       and c.request_payload->>'environment'=new.environment and c.request_payload->>'emissionPointId'=new.emission_point_id::text
       and c.request_payload->>'documentType'=new.document_type and (c.request_payload->>'nextValue')::bigint=new.next_value) then return new; end if;
   if tg_op='INSERT' and new.environment='TEST' and new.next_value=1 and exists(select 1 from public.sri_test_apply_operations
     where id=new.sri_test_apply_operation_id and company_id=new.company_id and state='PREPARING') then return new; end if;
 end if;
 perform public.sri_assert_environment_enabled(new.company_id,new.environment);
 if tg_table_name='electronic_documents' then
   perform public.sri_assert_document_routing(new.company_id,new.environment,new.emission_point_id,new.document_type);
   perform public.sri_assert_canonical_certificate(new.company_id);
 end if;
 return new;
end $$;

create or replace function public.sri_assert_service_actor_capability(p_company_id uuid,p_actor_user_id uuid,p_capability text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_claims text:=current_setting('request.jwt.claims',true); v_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 if auth.role() is distinct from 'service_role' or p_actor_user_id is null or not public.erp_is_company_member(p_company_id,p_actor_user_id) then
   raise exception using errcode='42501',message='SRI_TRANSPORT_ACTOR_REQUIRED'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_user_id::text,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 begin
   perform public.erp_security_assert_capability(p_company_id,p_capability);
 exception when others then
   perform set_config('request.jwt.claims',coalesce(v_claims,''),true); perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true); raise;
 end;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true); perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
 return true;
end $$;

create or replace function public.erp_sri_assert_transport_actor(p_company_id uuid,p_actor_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return public.sri_assert_service_actor_capability(p_company_id,p_actor_user_id,'commercial.electronic_documents.authorize');
end $$;

revoke all on function public.erp_sri_config_assert_access(uuid,text),public.erp_sri_config_replay(uuid,uuid,text,jsonb),public.erp_sri_config_audit(uuid,uuid,text,jsonb,jsonb),
 public.sri_assert_environment_enabled(uuid,text),public.sri_assert_canonical_certificate(uuid),public.sri_assert_document_routing(uuid,text,uuid,text)
 from public,anon,authenticated,service_role;
revoke all on function public.sri_assert_service_actor_capability(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.erp_sri_set_sequence_next(uuid,text,uuid,text,bigint,bigint,uuid,text),
 public.erp_sri_save_emission_point(uuid,text,text,text,text,text,boolean,timestamptz,uuid),public.erp_sri_set_environment_enabled(uuid,text,boolean,boolean,uuid,text),
 public.erp_sri_save_settings(uuid,jsonb,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.erp_sri_set_sequence_next(uuid,text,uuid,text,bigint,bigint,uuid,text),
 public.erp_sri_save_emission_point(uuid,text,text,text,text,text,boolean,timestamptz,uuid),public.erp_sri_set_environment_enabled(uuid,text,boolean,boolean,uuid,text),
 public.erp_sri_save_settings(uuid,jsonb,timestamptz,uuid) to authenticated;
revoke all on function public.erp_sri_assert_transport_actor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.erp_sri_assert_transport_actor(uuid,uuid) to service_role;
revoke all on function public.erp_sri_configuration_state(uuid) from public,anon,service_role;
grant execute on function public.erp_sri_configuration_state(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
