-- Manual infrastructure rollback. No business/configuration row changes or deletes.
begin;
do $rollback$ begin
if exists(select 1 from public.sri_settings where production_enabled or environment<>'TEST') or exists(select 1 from public.companies where sri_environment<>'TEST') then raise exception 'SRI_ROLLBACK_REQUIRES_EXISTING_TEST_DEFAULT_AND_PRODUCTION_OFF'; end if;
end $rollback$;

CREATE OR REPLACE FUNCTION public.claim_sri_transmission(p_transmission_id uuid, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_transmission public.sri_transmissions%rowtype;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception using errcode = '22023', message = 'SRI_WORKER_ID_REQUIRED';
  end if;

  select *
  into v_transmission
  from public.sri_transmissions
  where id = p_transmission_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_TRANSMISSION_NOT_FOUND';
  end if;
  if v_transmission.status not in ('PENDING', 'RETRY_SCHEDULED') then
    raise exception using
      errcode = '55P03',
      message = 'SRI_TRANSMISSION_NOT_CLAIMABLE';
  end if;
  if v_transmission.next_attempt_at is not null
     and v_transmission.next_attempt_at > now() then
    raise exception using
      errcode = '55P03',
      message = 'SRI_TRANSMISSION_NOT_DUE';
  end if;
  if v_transmission.attempt_number >= v_transmission.max_attempts then
    raise exception using
      errcode = '23514',
      message = 'SRI_TRANSMISSION_ATTEMPTS_EXHAUSTED';
  end if;

  update public.sri_transmissions
  set
    status = 'PROCESSING',
    attempt_number = attempt_number + 1,
    worker_id = left(p_worker_id, 200),
    claimed_at = now(),
    finished_at = null,
    error_class = null,
    error_message = null
  where id = p_transmission_id
  returning * into v_transmission;

  return to_jsonb(v_transmission);
end;
$function$
;

revoke all on function public.claim_sri_transmission(uuid,text) from public,anon,authenticated,service_role;

grant execute on function public.claim_sri_transmission(uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.sri_validate_settings_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company public.companies%rowtype;
begin
  select * into v_company
  from public.companies
  where id = new.company_id;

  if not found or not v_company.is_active then
    raise exception using errcode = '23514', message = 'SRI_COMPANY_NOT_ACTIVE';
  end if;
  if v_company.tax_id <> new.ruc then
    raise exception using errcode = '23514', message = 'SRI_RUC_DOES_NOT_MATCH_COMPANY';
  end if;
  if new.environment not in ('TEST', 'PRODUCTION')
     or v_company.sri_environment not in ('TEST', 'PRODUCTION')
     or new.environment <> v_company.sri_environment then
    raise exception using errcode = '23514', message = 'SRI_COMPANY_ENVIRONMENT_MISMATCH';
  end if;
  if new.environment = 'TEST' and new.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;
  return new;
end;
$function$
;

revoke all on function public.sri_validate_settings_company() from public,anon,authenticated,service_role;

grant execute on function public.sri_validate_settings_company() to service_role;

CREATE OR REPLACE FUNCTION public.record_sri_authorization(p_document_id uuid, p_response_xml text, p_authorization_status text, p_authorization_number text, p_authorization_date timestamp with time zone, p_environment text, p_authorized_xml text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_document public.electronic_documents%rowtype;
  v_existing public.sri_authorizations%rowtype;
  v_target_status text;
  v_number text;
begin
  select *
  into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  perform public.sri_assert_authorization_environment(
    v_document.company_id, v_document.environment, v_document.access_key, p_environment
  );
  if p_response_xml is null or btrim(p_response_xml) = '' then
    raise exception using errcode = '22023', message = 'SRI_AUTHORIZATION_RESPONSE_REQUIRED';
  end if;

  v_target_status := case upper(btrim(p_authorization_status))
    when 'AUTORIZADO' then 'AUTORIZADO'
    when 'NO AUTORIZADO' then 'NO_AUTORIZADO'
    when 'NO_AUTORIZADO' then 'NO_AUTORIZADO'
    else null
  end;
  if v_target_status is null then
    raise exception using errcode = '22023', message = 'SRI_AUTHORIZATION_STATUS_INVALID';
  end if;

  select *
  into v_existing
  from public.sri_authorizations
  where document_id = p_document_id
  for update;

  if found then
    if v_existing.authorization_status = (
      case
        when v_target_status = 'AUTORIZADO' then 'AUTORIZADO'
        else 'NO AUTORIZADO'
      end
    ) then
      return to_jsonb(v_document);
    end if;
    raise exception using errcode = '23514', message = 'SRI_AUTHORIZATION_IS_TERMINAL';
  end if;

  if v_document.status not in ('ENVIADO_SRI', 'RECIBIDO_SRI') then
    raise exception using
      errcode = '23514',
      message = format('SRI_AUTHORIZATION_NOT_ALLOWED_FROM:%s', v_document.status);
  end if;

  if v_target_status = 'AUTORIZADO' then
    v_number := nullif(btrim(p_authorization_number), '');
    if v_number is null
       or p_authorization_date is null
       or p_authorized_xml is null
       or btrim(p_authorized_xml) = '' then
      raise exception using errcode = '22023', message = 'SRI_AUTHORIZED_CONTENT_INCOMPLETE';
    end if;

    if v_document.document_type = '04' then
      perform 1
      from public.electronic_documents original
      where original.company_id = v_document.company_id
        and original.id = v_document.parent_document_id
        and original.document_type = '01'
        and original.environment = v_document.environment
        and original.status = 'AUTORIZADO'
        and original.credited_total + v_document.grand_total <= original.grand_total
      for update;

      if not found then
        raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_AUTHORIZATION_EXCEEDS_INVOICE';
      end if;

      update public.electronic_documents
      set credited_total = credited_total + v_document.grand_total
      where company_id = v_document.company_id
        and id = v_document.parent_document_id;
    end if;
  else
    v_number := null;
    p_authorization_date := null;
    p_authorized_xml := null;
  end if;

  insert into public.sri_authorizations (
    company_id,
    document_id,
    response_xml,
    authorization_status,
    authorization_number,
    authorization_date,
    environment,
    authorized_xml,
    created_by,
    updated_by
  )
  values (
    v_document.company_id,
    v_document.id,
    p_response_xml,
    case when v_target_status = 'AUTORIZADO' then 'AUTORIZADO' else 'NO AUTORIZADO' end,
    v_number,
    p_authorization_date,
    public.sri_assert_authorization_environment(
      v_document.company_id, v_document.environment, v_document.access_key, p_environment
    ),
    p_authorized_xml,
    p_actor_user_id,
    p_actor_user_id
  );

  update public.electronic_documents
  set
    status = v_target_status,
    authorization_number = v_number,
    authorized_at = p_authorization_date,
    last_error = case
      when v_target_status = 'NO_AUTORIZADO' then 'SRI respondio NO AUTORIZADO'
      else null
    end,
    updated_by = p_actor_user_id
  where id = v_document.id
  returning * into v_document;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    old_status,
    new_status,
    reason,
    new_values
  )
  values (
    v_document.company_id,
    v_document.id,
    p_actor_user_id,
    case when p_actor_user_id is null then 'SYSTEM' else 'USER' end,
    case
      when v_target_status = 'AUTORIZADO' then 'SRI_AUTHORIZED'
      else 'SRI_NOT_AUTHORIZED'
    end,
    case
      when v_document.status = 'AUTORIZADO' then 'RECIBIDO_SRI'
      else 'RECIBIDO_SRI'
    end,
    v_target_status,
    'Respuesta oficial persistida',
    jsonb_build_object(
      'authorization_number', v_number,
      'authorization_date', p_authorization_date,
      'environment', public.sri_assert_authorization_environment(
        v_document.company_id, v_document.environment, v_document.access_key, p_environment
      )
    )
  );

  return to_jsonb(v_document);
end;
$function$
;

revoke all on function public.record_sri_authorization(uuid,text,text,text,timestamp with time zone,text,text,uuid) from public,anon,authenticated,service_role;

grant execute on function public.record_sri_authorization(uuid,text,text,text,timestamp with time zone,text,text,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_electronic_document_issue_date(p_document_id uuid, p_issue_date date, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_document public.electronic_documents%rowtype;
  v_settings public.sri_settings%rowtype;
  v_old_date date;
  v_old_key text;
  v_new_key text;
begin
  select *
  into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;

  if not found or v_document.status <> 'BORRADOR' then
    raise exception using errcode = '23514', message = 'SRI_ONLY_DRAFT_DATE_CAN_BE_REFRESHED';
  end if;
  if p_actor_user_id is null
     or not exists (
       select 1
       from public.sri_company_memberships membership
       where membership.company_id = v_document.company_id
         and membership.auth_user_id = p_actor_user_id
         and membership.active
         and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
     ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_REFRESH_DOCUMENT';
  end if;

  select *
  into v_settings
  from public.sri_settings
  where company_id = v_document.company_id;
  if not found
     or v_settings.environment not in ('TEST', 'PRODUCTION')
     or v_settings.environment <> v_document.environment then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;

  v_old_date := v_document.issue_date;
  v_old_key := v_document.access_key;
  v_new_key := public.sri_build_access_key(
    p_issue_date,
    v_document.document_type,
    v_settings.ruc,
    v_document.environment,
    v_document.establishment_code,
    v_document.emission_point_code,
    v_document.sequential,
    v_document.numeric_code
  );

  update public.electronic_documents
  set
    issue_date = p_issue_date,
    access_key = v_new_key,
    verification_digit = right(v_new_key, 1)::smallint,
    updated_by = p_actor_user_id,
    last_error = null
  where id = p_document_id
  returning * into v_document;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    old_status,
    new_status,
    reason,
    old_values,
    new_values
  )
  values (
    v_document.company_id,
    v_document.id,
    p_actor_user_id,
    'USER',
    'ISSUE_DATE_REFRESHED',
    'BORRADOR',
    'BORRADOR',
    'Fecha SRI ajustada antes de generar XML',
    jsonb_build_object('issue_date', v_old_date, 'access_key', v_old_key),
    jsonb_build_object('issue_date', p_issue_date, 'access_key', v_new_key)
  );

  return to_jsonb(v_document);
end;
$function$
;

revoke all on function public.refresh_electronic_document_issue_date(uuid,date,uuid) from public,anon,authenticated,service_role;

grant execute on function public.refresh_electronic_document_issue_date(uuid,date,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.sri_assert_authorization_environment(p_company_id uuid, p_document_environment text, p_access_key text, p_response_environment text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_response text := translate(upper(btrim(coalesce(p_response_environment, ''))), 'Ó', 'O');
  v_expected_digit text;
begin
  select * into v_settings
  from public.sri_settings
  where company_id = p_company_id;
  if not found
     or p_document_environment not in ('TEST', 'PRODUCTION')
     or v_settings.environment <> p_document_environment then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;
  v_expected_digit := case p_document_environment when 'TEST' then '1' else '2' end;
  if substring(p_access_key from 24 for 1) <> v_expected_digit then
    raise exception using errcode = '23514', message = 'SRI_ACCESS_KEY_ENVIRONMENT_MISMATCH';
  end if;
  if (p_document_environment = 'TEST' and v_response not in ('PRUEBAS', 'TEST', '1'))
     or (p_document_environment = 'PRODUCTION' and v_response not in ('PRODUCCION', 'PRODUCTION', '2')) then
    raise exception using errcode = '23514', message = 'SRI_AUTHORIZATION_ENVIRONMENT_MISMATCH';
  end if;
  if p_document_environment = 'PRODUCTION' and not v_settings.production_enabled then
    raise exception using errcode = '42501', message = 'SRI_PRODUCTION_TRANSMISSION_DISABLED';
  end if;
  return case p_document_environment when 'TEST' then 'PRUEBAS' else 'PRODUCCION' end;
end;
$function$
;

revoke all on function public.sri_assert_authorization_environment(uuid,text,text,text) from public,anon,authenticated,service_role;

grant execute on function public.sri_assert_authorization_environment(uuid,text,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.sri_validate_authorization_environment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_document public.electronic_documents%rowtype;
begin
  select * into v_document
  from public.electronic_documents
  where company_id = new.company_id and id = new.document_id;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_AUTHORIZATION_DOCUMENT_NOT_FOUND';
  end if;
  new.environment := public.sri_assert_authorization_environment(
    new.company_id, v_document.environment, v_document.access_key, new.environment
  );
  return new;
end;
$function$
;

revoke all on function public.sri_validate_authorization_environment() from public,anon,authenticated,service_role;

grant execute on function public.sri_validate_authorization_environment() to service_role;

CREATE OR REPLACE FUNCTION public.sri_validate_transmission_environment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_document_environment text;
begin
  select * into v_settings
  from public.sri_settings
  where company_id = new.company_id;
  select environment into v_document_environment
  from public.electronic_documents
  where company_id = new.company_id and id = new.document_id;
  if v_settings.company_id is null
     or v_document_environment is null
     or v_settings.environment not in ('TEST', 'PRODUCTION')
     or new.environment <> v_settings.environment
     or v_document_environment <> new.environment then
    raise exception using errcode = '23514', message = 'SRI_TRANSMISSION_ENVIRONMENT_MISMATCH';
  end if;
  if new.environment = 'PRODUCTION' and not v_settings.production_enabled then
    raise exception using errcode = '42501', message = 'SRI_PRODUCTION_TRANSMISSION_DISABLED';
  end if;
  if new.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;
  return new;
end;
$function$
;

revoke all on function public.sri_validate_transmission_environment() from public,anon,authenticated,service_role;

grant execute on function public.sri_validate_transmission_environment() to service_role;

CREATE OR REPLACE FUNCTION public.sri_validate_document_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_address_source jsonb;
  v_point public.emission_points%rowtype;
  v_original public.electronic_documents%rowtype;
  v_expected_key text;
  v_transition_allowed boolean := false;
  v_recovery_query boolean := coalesce(current_setting('app.sri_recovery_query', true), '') = 'on';
  v_registered_annulment boolean := coalesce(current_setting('app.sri_registered_annulment', true), '') = 'on';
begin
  select * into v_settings from public.sri_settings where company_id = new.company_id;
  if not found
     or v_settings.environment not in ('TEST', 'PRODUCTION')
     or new.environment <> v_settings.environment then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;
  if v_settings.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;

  select * into v_point
  from public.emission_points
  where company_id = new.company_id and id = new.emission_point_id;
  if not found
     or v_point.environment <> new.environment
     or v_point.establishment_code <> new.establishment_code
     or v_point.emission_point_code <> new.emission_point_code then
    raise exception using errcode = '23514', message = 'SRI_EMISSION_POINT_MISMATCH';
  end if;

  v_expected_key := public.sri_build_access_key(
    new.issue_date,
    new.document_type,
    v_settings.ruc,
    new.environment,
    new.establishment_code,
    new.emission_point_code,
    new.sequential,
    new.numeric_code
  );
  if new.access_key <> v_expected_key
     or new.verification_digit <> right(v_expected_key, 1)::smallint then
    raise exception using errcode = '23514', message = 'SRI_ACCESS_KEY_INTEGRITY_ERROR';
  end if;
  if new.issuer_snapshot ->> 'ruc' is distinct from v_settings.ruc then
    raise exception using errcode = '23514', message = 'SRI_ISSUER_SNAPSHOT_RUC_MISMATCH';
  end if;

  -- Enforce original-point identity on every new NC, including direct inserts.
  -- Existing documents and later status updates retain their established history.
  if tg_op = 'INSERT' and new.document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = new.company_id and id = new.parent_document_id
      and environment = new.environment and document_type = '01'
      and status = 'AUTORIZADO' for share;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
    if new.emission_point_id is distinct from v_original.emission_point_id
      or new.establishment_code is distinct from v_original.establishment_code
      or new.emission_point_code is distinct from v_original.emission_point_code then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.buyer_snapshot is distinct from old.buyer_snapshot
      or new.source_snapshot is distinct from old.source_snapshot then
      v_address_source := public.sri_draft_buyer_address_source(old);
      if (to_jsonb(new) - array['buyer_snapshot','source_snapshot','updated_at','updated_by'])
          is distinct from (to_jsonb(old) - array['buyer_snapshot','source_snapshot','updated_at','updated_by'])
        or new.updated_by is distinct from auth.uid()
        or new.buyer_snapshot is distinct from jsonb_set(old.buyer_snapshot,'{address}',v_address_source->'address')
        or new.source_snapshot is distinct from jsonb_set(old.source_snapshot,'{buyer,address}',v_address_source->'address') then
        raise exception using errcode='23514',message='SRI_DOCUMENT_IDENTITY_IS_IMMUTABLE';
      end if;
      insert into public.electronic_document_audit_logs(
        company_id,document_id,actor_user_id,actor_type,action,old_status,new_status,reason,old_values,new_values
      ) values (
        old.company_id,old.id,auth.uid(),'USER','DRAFT_BUYER_ADDRESS_REFRESHED',old.status,new.status,
        'Direccion del comprador recuperada de cliente canonico antes de generar XML',
        jsonb_build_object('buyer_address',old.buyer_snapshot->'address','source_address',old.source_snapshot#>'{buyer,address}'),
        v_address_source || jsonb_build_object('document_id',old.id,'sequential',old.sequential,'access_key_preserved',true)
      );
    end if;
    if new.company_id <> old.company_id
       or new.emission_point_id <> old.emission_point_id
       or new.environment <> old.environment
       or new.document_type <> old.document_type
       or new.sequential <> old.sequential
       or new.numeric_code <> old.numeric_code
       or new.establishment_code <> old.establishment_code
       or new.emission_point_code <> old.emission_point_code
       or new.parent_document_id is distinct from old.parent_document_id
       or new.source_order_id is distinct from old.source_order_id
       or new.source_packing_id is distinct from old.source_packing_id
       or new.customer_id is distinct from old.customer_id
       or new.issuer_snapshot is distinct from old.issuer_snapshot then
      raise exception using errcode = '23514', message = 'SRI_DOCUMENT_IDENTITY_IS_IMMUTABLE';
    end if;

    if (
      new.issue_date <> old.issue_date
      or new.access_key <> old.access_key
      or new.verification_digit <> old.verification_digit
    ) and not (old.status = 'BORRADOR' and new.status = 'BORRADOR') then
      raise exception using errcode = '23514', message = 'SRI_ISSUE_DATE_IS_LOCKED';
    end if;

    if new.status <> old.status then
      v_transition_allowed := case old.status
        when 'BORRADOR' then new.status in ('VALIDADO', 'ANULADO')
        when 'VALIDADO' then new.status in ('XML_GENERADO', 'ANULADO')
        when 'XML_GENERADO' then new.status in ('FIRMADO', 'ANULADO')
        when 'FIRMADO' then new.status in ('ENVIADO_SRI', 'ANULADO')
        when 'ENVIADO_SRI' then new.status in (
          'RECIBIDO_SRI', 'AUTORIZADO', 'NO_AUTORIZADO', 'DEVUELTO',
          'PENDIENTE_REINTENTO', 'ERROR_ENVIO'
        )
        when 'RECIBIDO_SRI' then new.status in (
          'AUTORIZADO', 'NO_AUTORIZADO', 'PENDIENTE_REINTENTO', 'ERROR_ENVIO'
        )
        when 'PENDIENTE_REINTENTO' then new.status in ('ENVIADO_SRI', 'ERROR_ENVIO')
        when 'ERROR_ENVIO' then new.status in ('PENDIENTE_REINTENTO', 'ANULADO')
        when 'DEVUELTO' then new.status in ('ANULADO')
          or (v_recovery_query and new.status in ('AUTORIZADO', 'NO_AUTORIZADO'))
        when 'NO_AUTORIZADO' then new.status in ('ANULADO')
          or (v_recovery_query and new.status in ('AUTORIZADO'))
        when 'AUTORIZADO' then v_registered_annulment and new.status = 'ANULADO'
        else false
      end;
      if not v_transition_allowed then
        raise exception using
          errcode = '23514',
          message = format('SRI_STATUS_TRANSITION_NOT_ALLOWED:%s->%s', old.status, new.status);
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$
;

revoke all on function public.sri_validate_document_integrity() from public,anon,authenticated,service_role;

grant execute on function public.sri_validate_document_integrity() to service_role;

CREATE OR REPLACE FUNCTION public.record_sri_recovery_authorization(p_document_id uuid, p_response_xml text, p_authorization_status text, p_authorization_number text, p_authorization_date timestamp with time zone, p_environment text, p_authorized_xml text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_document public.electronic_documents%rowtype;
  v_old_status text;
  v_target_status text;
  v_number text;
  v_identifier text;
begin
  select * into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  v_old_status := v_document.status;
  if v_document.document_type <> '01'
     or v_document.status not in ('DEVUELTO', 'NO_AUTORIZADO') then
    raise exception using errcode = '23514', message = 'SRI_RECOVERY_QUERY_NOT_ALLOWED';
  end if;
  perform public.sri_assert_authorization_environment(
    v_document.company_id, v_document.environment, v_document.access_key, p_environment
  );
  if p_actor_user_id is null or not exists (
    select 1 from public.sri_company_memberships membership
    where membership.company_id = v_document.company_id
      and membership.auth_user_id = p_actor_user_id
      and membership.active
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_RECOVER_DOCUMENT';
  end if;
  select regexp_replace(coalesce(error.identifier, ''), '\D', '', 'g')
  into v_identifier
  from public.sri_error_messages error
  where error.document_id = v_document.id
  order by error.created_at desc
  limit 1;
  if coalesce(v_identifier, '') not in ('43', '45', '70') then
    raise exception using errcode = '23514', message = 'SRI_RECOVERY_QUERY_REQUIRES_CODE_43_45_OR_70';
  end if;
  if p_response_xml is null or btrim(p_response_xml) = '' then
    raise exception using errcode = '22023', message = 'SRI_AUTHORIZATION_RESPONSE_REQUIRED';
  end if;

  v_target_status := case upper(btrim(p_authorization_status))
    when 'AUTORIZADO' then 'AUTORIZADO'
    when 'NO AUTORIZADO' then 'NO_AUTORIZADO'
    when 'NO_AUTORIZADO' then 'NO_AUTORIZADO'
    else null
  end;
  if v_target_status is null then
    raise exception using errcode = '22023', message = 'SRI_AUTHORIZATION_STATUS_INVALID';
  end if;
  if v_target_status = 'AUTORIZADO' then
    v_number := nullif(btrim(p_authorization_number), '');
    if v_number is null
       or p_authorization_date is null
       or p_authorized_xml is null
       or btrim(p_authorized_xml) = '' then
      raise exception using errcode = '22023', message = 'SRI_AUTHORIZED_CONTENT_INCOMPLETE';
    end if;
  else
    v_number := null;
    p_authorization_date := null;
    p_authorized_xml := null;
  end if;

  perform set_config('app.sri_recovery_query', 'on', true);
  insert into public.sri_authorizations (
    company_id, document_id, response_xml, authorization_status,
    authorization_number, authorization_date, environment, authorized_xml,
    created_by, updated_by
  ) values (
    v_document.company_id, v_document.id, p_response_xml,
    case when v_target_status = 'AUTORIZADO' then 'AUTORIZADO' else 'NO AUTORIZADO' end,
    v_number, p_authorization_date, public.sri_assert_authorization_environment(
      v_document.company_id, v_document.environment, v_document.access_key, p_environment
    ), p_authorized_xml,
    p_actor_user_id, p_actor_user_id
  )
  on conflict (document_id) do update set
    response_xml = excluded.response_xml,
    authorization_status = excluded.authorization_status,
    authorization_number = excluded.authorization_number,
    authorization_date = excluded.authorization_date,
    environment = excluded.environment,
    authorized_xml = excluded.authorized_xml,
    updated_by = excluded.updated_by,
    updated_at = now();

  update public.electronic_documents
  set status = v_target_status,
      authorization_number = v_number,
      authorized_at = p_authorization_date,
      last_error = case when v_target_status = 'AUTORIZADO' then null else last_error end,
      updated_by = p_actor_user_id
  where id = v_document.id
  returning * into v_document;

  insert into public.electronic_document_audit_logs (
    company_id, document_id, actor_user_id, actor_type, action,
    old_status, new_status, reason, new_values
  ) values (
    v_document.company_id, v_document.id, p_actor_user_id, 'USER',
    'SRI_RECOVERY_AUTHORIZATION_QUERY', v_old_status, v_target_status,
    'Consulta explícita de autorización con la misma clave de acceso',
    jsonb_build_object(
      'access_key', v_document.access_key,
      'identifier', v_identifier,
      'authorization_number', v_number,
      'authorization_date', p_authorization_date
    )
  );
  return to_jsonb(v_document);
end;
$function$
;

revoke all on function public.record_sri_recovery_authorization(uuid,text,text,text,timestamp with time zone,text,text,uuid) from public,anon,authenticated,service_role;

grant execute on function public.record_sri_recovery_authorization(uuid,text,text,text,timestamp with time zone,text,text,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.create_electronic_document_draft_u2a_internal(p_company_id uuid, p_emission_point_id uuid, p_document_type text, p_issue_date date, p_numeric_code text, p_xml_version text, p_xsd_version text, p_issuer_snapshot jsonb, p_buyer_snapshot jsonb, p_source_snapshot jsonb, p_source_order_id uuid, p_source_packing_id uuid, p_customer_id uuid, p_parent_document_id uuid, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype;
  v_original public.electronic_documents%rowtype;
  v_reservation public.commercial_invoice_reservations%rowtype;
  v_source_record_id text := coalesce(
    nullif(btrim(p_source_snapshot #>> '{erpEmission,sourceOrderId}'), ''),
    p_source_order_id::text,
    case when nullif(btrim(p_source_snapshot #>> '{erpEmission,idempotencyKey}'), '') is not null
      then 'SRI-IDEMP:' || btrim(p_source_snapshot #>> '{erpEmission,idempotencyKey}') end
  );
  v_purchase_text text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,purchaseDocumentId}'), '');
  v_operation_text text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,operationId}'), '');
  v_device_id text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,deviceId}'), '');
  v_purchase_id uuid;
  v_operation_id uuid;
  v_purchase public.erp_supplier_purchase_documents%rowtype;
  v_link public.erp_supplier_purchase_withholding_links%rowtype;
  v_existing_command public.erp_operations_commands%rowtype;
  v_journal_entry_id uuid;
  v_command_result jsonb;
  v_sequential bigint;
  v_access_key text;
  v_document public.electronic_documents%rowtype;
begin
  if p_document_type not in ('01', '04', '06', '07') then
    raise exception using errcode = '22023', message = 'SRI_DOCUMENT_TYPE_NOT_ENABLED';
  end if;
  if p_issue_date is null or p_numeric_code !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'SRI_DRAFT_IDENTIFIERS_INVALID';
  end if;
  if (p_document_type = '07' and (p_xml_version <> '2.0.0' or p_xsd_version <> '2.0.0'))
     or (p_document_type <> '07' and (p_xml_version <> '1.1.0' or p_xsd_version <> '1.1.0')) then
    raise exception using errcode = '22023', message = 'SRI_XML_VERSION_NOT_ENABLED';
  end if;
  if jsonb_typeof(p_issuer_snapshot) <> 'object'
     or jsonb_typeof(p_buyer_snapshot) <> 'object'
     or jsonb_typeof(p_source_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'SRI_SNAPSHOT_MUST_BE_OBJECT';
  end if;
  if p_created_by is null or not exists (
    select 1 from public.sri_company_memberships membership
    where membership.company_id = p_company_id
      and membership.auth_user_id = p_created_by
      and membership.active
      and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_CREATE_DOCUMENT';
  end if;

  if p_document_type = '07' and v_purchase_text is not null then
    if v_purchase_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_operation_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_device_id is null then
      raise exception using errcode = '22023', message = 'SUPPLIER_WITHHOLDING_V2_COMMAND_INVALID';
    end if;
    v_purchase_id := v_purchase_text::uuid;
    v_operation_id := v_operation_text::uuid;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':PURCHASE_WITHHOLDING:' || v_purchase_id::text, 0));

    select * into v_existing_command
    from public.erp_operations_commands
    where operation_id = v_operation_id and company_id = p_company_id;
    if found and v_existing_command.command_type <> 'SUPPLIER_CREATE_WITHHOLDING' then
      raise exception using errcode = '23505', message = 'SUPPLIER_WITHHOLDING_V2_OPERATION_CONFLICT';
    end if;

    select * into v_purchase
    from public.erp_supplier_purchase_documents
    where company_id = p_company_id and purchase_document_id = v_purchase_id
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'SUPPLIER_WITHHOLDING_V2_PURCHASE_NOT_FOUND';
    end if;
    if v_purchase.status <> 'POSTED' or v_purchase.retention_decision <> 'APLICAR' then
      raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_PURCHASE_NOT_ELIGIBLE';
    end if;
    if v_purchase.retention_status not in (
      'PENDING_ISSUANCE','DRAFT_CREATED','PROCESSING','AUTHORIZED','RETURNED','NOT_AUTHORIZED','ERROR'
    ) then
      raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_STATUS_INVALID';
    end if;

    select * into v_link
    from public.erp_supplier_purchase_withholding_links
    where company_id = p_company_id and purchase_document_id = v_purchase_id
    for update;
    if found then
      select * into v_document from public.electronic_documents
      where company_id = p_company_id and id = v_link.electronic_document_id and document_type = '07'
        and environment = (select environment from public.sri_settings where company_id = p_company_id);
      if not found then
        raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_LINK_INVALID';
      end if;
      v_command_result := jsonb_build_object(
        'ok', true, 'serverTime', clock_timestamp(),
        'result', jsonb_build_object(
          'purchaseDocumentId', v_purchase_id::text,
          'electronicDocumentId', v_document.id::text,
          'journalEntryId', v_link.journal_entry_id::text,
          'reused', true
        )
      );
      insert into public.erp_operations_commands(
        operation_id, company_id, command_type, source_record_id, request_payload,
        result, status, user_id, device_id, local_created_at, server_created_at
      ) values (
        v_operation_id, p_company_id, 'SUPPLIER_CREATE_WITHHOLDING', v_purchase_id::text,
        jsonb_build_object('purchaseDocumentId', v_purchase_id::text), v_command_result,
        'CONFIRMED', p_created_by, v_device_id, clock_timestamp(), clock_timestamp()
      ) on conflict (operation_id) do nothing;
      return to_jsonb(v_document) || jsonb_build_object(
        '_reservation_reused', true,
        '_purchase_document_id', v_purchase_id::text,
        '_journal_entry_id', v_link.journal_entry_id::text
      );
    end if;
  elsif p_document_type = '07' then
    -- Se mantienen legibles los comprobantes historicos, pero el flujo activo
    -- de Compras V2 siempre debe declarar la compra explicita.
    v_purchase_id := null;
  end if;

  if p_document_type = '07' and v_purchase_id is not null then
    perform public.erp_purchase_withholding_assert_accounts(p_company_id, p_issue_date, p_source_snapshot);
  end if;

  select * into v_settings from public.sri_settings
  where company_id = p_company_id for update;
  if not found or v_settings.environment not in ('TEST', 'PRODUCTION') or not v_settings.immediate_transmission then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_REQUIRED';
  end if;
  if v_settings.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;

  -- Fail before touching tax counters, reservations or documents.
  if v_settings.environment = 'PRODUCTION' and not v_settings.production_enabled then
    raise exception using errcode = '42501', message = 'SRI_PRODUCTION_DOCUMENT_CREATION_DISABLED';
  end if;
  if p_document_type = '01' and (v_source_record_id is null or length(v_source_record_id) > 240) then
    raise exception using errcode = '22023', message = 'SRI_INVOICE_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  if p_document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = p_company_id and id = p_parent_document_id
      and environment = v_settings.environment
      and document_type = '01' and status = 'AUTORIZADO' for update;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
    if p_emission_point_id is distinct from v_original.emission_point_id then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
    end if;
    p_emission_point_id := v_original.emission_point_id;
  elsif p_parent_document_id is not null then
    raise exception using errcode = '23514', message = 'SRI_PARENT_ONLY_ALLOWED_FOR_CREDIT_NOTE';
  end if;

  -- A credit note derives its point from the locked canonical original invoice.
  -- Reject stale/client overrides before any sequence row is created or incremented.
  select * into v_point from public.emission_points
  where company_id = p_company_id
    and id = case when p_document_type = '04' then v_original.emission_point_id else p_emission_point_id end
    and environment = v_settings.environment and active for update;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_ACTIVE_EMISSION_POINT_REQUIRED';
  end if;
  if p_document_type = '04' and (
    v_point.establishment_code is distinct from v_original.establishment_code
    or v_point.emission_point_code is distinct from v_original.emission_point_code
  ) then
    raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
  end if;

  if p_document_type = '01' and v_source_record_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      p_company_id::text || ':SRI_INVOICE:' || v_settings.environment || ':' || v_source_record_id, 0));
    select * into v_reservation
    from public.commercial_invoice_reservations reservation
    where reservation.company_id = p_company_id
      and reservation.record_id = v_source_record_id
      and reservation.environment = v_settings.environment
      and reservation.document_type = '01'
      and reservation.status in ('ACTIVE', 'CONSUMED')
    order by reservation.created_at desc
    limit 1
    for update;
    if found and v_reservation.emission_point_id <> p_emission_point_id then
      raise exception using errcode = '23514', message = 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT';
    end if;
    if found and v_reservation.status = 'CONSUMED' and v_reservation.consumed_document_id is not null then
      select * into v_document from public.electronic_documents
      where company_id = p_company_id and id = v_reservation.consumed_document_id
        and environment = v_settings.environment;
      if found then
        return to_jsonb(v_document) || jsonb_build_object('_reservation_reused', true);
      end if;
      raise exception using errcode = '23514', message = 'SRI_INVOICE_IDEMPOTENCY_DOCUMENT_MISSING';
    end if;
  end if;

  if v_reservation.id is not null and v_reservation.status = 'ACTIVE' then
    v_sequential := v_reservation.sequential;
  else
    insert into public.electronic_document_sequences(
      company_id, emission_point_id, environment, document_type, next_value, updated_by
    ) values (
      p_company_id, p_emission_point_id, v_settings.environment, p_document_type, 1, p_created_by
    ) on conflict (company_id, emission_point_id, environment, document_type) do nothing;
    select sequence_row.next_value into v_sequential
    from public.electronic_document_sequences sequence_row
    where sequence_row.company_id = p_company_id
      and sequence_row.emission_point_id = p_emission_point_id
      and sequence_row.environment = v_settings.environment
      and sequence_row.document_type = p_document_type
    for update;
    if v_sequential > 999999999 then
      raise exception using errcode = '22003', message = 'SRI_SEQUENTIAL_EXHAUSTED';
    end if;
    update public.electronic_document_sequences
    set next_value = v_sequential + 1, updated_by = p_created_by
    where company_id = p_company_id
      and emission_point_id = p_emission_point_id
      and environment = v_settings.environment
      and document_type = p_document_type;
  end if;

  -- The invoice reservation now belongs to document generation, in this transaction.
  if p_document_type = '01' and v_reservation.id is null then
    insert into public.commercial_invoice_reservations(
      company_id,record_id,emission_point_id,environment,document_type,
      establishment_code,emission_point_code,sequential,full_number,status,created_by
    ) values (
      p_company_id,v_source_record_id,p_emission_point_id,v_settings.environment,'01',
      v_point.establishment_code,v_point.emission_point_code,v_sequential,
      v_point.establishment_code || '-' || v_point.emission_point_code || '-' || lpad(v_sequential::text,9,'0'),
      'ACTIVE',p_created_by
    ) returning * into v_reservation;
  end if;

  v_access_key := public.sri_build_access_key(
    p_issue_date, p_document_type, v_settings.ruc, v_settings.environment,
    v_point.establishment_code, v_point.emission_point_code,
    v_sequential, p_numeric_code
  );

  insert into public.electronic_documents (
    company_id, emission_point_id, parent_document_id, source_order_id,
    source_packing_id, customer_id, document_type, status, issue_date,
    environment, emission_type, establishment_code, emission_point_code,
    sequential, sequential_text, full_number, numeric_code,
    verification_digit, access_key, xml_version, xsd_version,
    issuer_snapshot, buyer_snapshot, source_snapshot, created_by, updated_by
  ) values (
    p_company_id, p_emission_point_id, p_parent_document_id, p_source_order_id,
    p_source_packing_id, p_customer_id, p_document_type, 'BORRADOR', p_issue_date,
    v_settings.environment, '1', v_point.establishment_code, v_point.emission_point_code,
    v_sequential, lpad(v_sequential::text, 9, '0'),
    v_point.establishment_code || '-' || v_point.emission_point_code || '-' || lpad(v_sequential::text, 9, '0'),
    p_numeric_code, right(v_access_key, 1)::smallint, v_access_key,
    p_xml_version, p_xsd_version, p_issuer_snapshot, p_buyer_snapshot,
    p_source_snapshot, p_created_by, p_created_by
  ) returning * into v_document;

  if v_reservation.id is not null and v_reservation.status = 'ACTIVE' then
    update public.commercial_invoice_reservations
    set status = 'CONSUMED', consumed_at = now(), consumed_document_id = v_document.id, updated_at = now()
    where id = v_reservation.id;
  end if;

  if p_document_type in ('01', '04') then
    insert into public.accounting_document_links(company_id, document_id, status)
    values (p_company_id, v_document.id, 'PENDING');
  end if;

  if p_document_type = '07' and v_purchase_id is not null then
    if jsonb_typeof(p_source_snapshot #> '{erpPurchase,journal}') <> 'object' then
      raise exception using errcode = '22023', message = 'SUPPLIER_WITHHOLDING_V2_JOURNAL_REQUIRED';
    end if;
    perform set_config('request.jwt.claim.sub', p_created_by::text, true);
    v_journal_entry_id := public.erp_financial_v2_create_entry_internal(
      p_company_id, v_operation_id, v_device_id,
      p_source_snapshot #> '{erpPurchase,journal}',
      'PURCHASE_WITHHOLDING', v_document.id::text, 'POST_WITHHOLDING'
    );
    insert into public.erp_supplier_purchase_withholding_links(
      company_id, purchase_document_id, electronic_document_id, journal_entry_id,
      status, operation_id, created_at, created_by, updated_at, updated_by
    ) values (
      p_company_id, v_purchase_id, v_document.id, v_journal_entry_id,
      'ACTIVE', v_operation_id, clock_timestamp(), p_created_by, clock_timestamp(), p_created_by
    );
    update public.erp_supplier_purchase_documents
    set retention_status = 'DRAFT_CREATED', updated_at = clock_timestamp(),
        version = version + 1, last_operation_id = v_operation_id
    where company_id = p_company_id and purchase_document_id = v_purchase_id;
    perform public.erp_financial_v2_write_event(
      p_company_id, v_operation_id, v_device_id, 'POST_WITHHOLDING',
      'PURCHASE_WITHHOLDING', v_document.id::text,
      jsonb_build_object(
        'purchaseDocumentId', v_purchase_id::text,
        'electronicDocumentId', v_document.id::text,
        'journalEntryId', v_journal_entry_id::text
      )
    );
    v_command_result := jsonb_build_object(
      'ok', true, 'serverTime', clock_timestamp(),
      'result', jsonb_build_object(
        'purchaseDocumentId', v_purchase_id::text,
        'electronicDocumentId', v_document.id::text,
        'journalEntryId', v_journal_entry_id::text,
        'reused', false
      )
    );
    insert into public.erp_operations_commands(
      operation_id, company_id, command_type, source_record_id, request_payload,
      result, status, user_id, device_id, local_created_at, server_created_at
    ) values (
      v_operation_id, p_company_id, 'SUPPLIER_CREATE_WITHHOLDING', v_purchase_id::text,
      jsonb_build_object('purchaseDocumentId', v_purchase_id::text), v_command_result,
      'CONFIRMED', p_created_by, v_device_id, clock_timestamp(), clock_timestamp()
    );
  end if;

  insert into public.electronic_document_audit_logs(
    company_id, document_id, actor_user_id, actor_type, action,
    new_status, reason, new_values
  ) values (
    p_company_id, v_document.id, p_created_by, 'USER', 'DRAFT_CREATED',
    'BORRADOR',
    case
      when v_purchase_id is not null then 'Retencion de compra V2 creada con vinculo, asiento y secuencial atomicos'
      when v_reservation.id is not null then 'Borrador SRI creado con reserva idempotente de factura'
      else 'Borrador SRI creado con secuencial atomico'
    end,
    jsonb_build_object(
      'full_number', v_document.full_number,
      'access_key', v_document.access_key,
      'environment', v_settings.environment,
      'commercial_reservation_id', v_reservation.id,
      'purchase_document_id', v_purchase_id,
      'journal_entry_id', v_journal_entry_id,
      'operation_id', v_operation_id
    )
  );

  return to_jsonb(v_document) || jsonb_build_object(
    '_reservation_reused', false,
    '_purchase_document_id', v_purchase_id::text,
    '_journal_entry_id', v_journal_entry_id::text
  );
end;
$function$
;

revoke all on function public.create_electronic_document_draft_u2a_internal(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sri_test_enabled_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

revoke all on function public.sri_test_enabled_write_guard() from public,anon,authenticated,service_role;

grant execute on function public.sri_test_enabled_write_guard() to service_role;

CREATE OR REPLACE FUNCTION public.create_electronic_document_draft(p_company_id uuid, p_emission_point_id uuid, p_document_type text, p_issue_date date, p_numeric_code text, p_xml_version text, p_xsd_version text, p_issuer_snapshot jsonb, p_buyer_snapshot jsonb, p_source_snapshot jsonb, p_source_order_id uuid, p_source_packing_id uuid, p_customer_id uuid, p_parent_document_id uuid, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_capability text;
begin
  if auth.uid() is not null then
    v_capability := case p_document_type
      when '04' then 'commercial.credit_notes.create'
      when '07' then 'purchases.withholdings.create'
      else 'commercial.electronic_documents.create'
    end;
    perform public.erp_security_assert_capability(p_company_id, v_capability);
  end if;
  return public.create_electronic_document_draft_u2c3_internal(
    p_company_id,p_emission_point_id,p_document_type,p_issue_date,p_numeric_code,
    p_xml_version,p_xsd_version,p_issuer_snapshot,p_buyer_snapshot,p_source_snapshot,
    p_source_order_id,p_source_packing_id,p_customer_id,p_parent_document_id,p_created_by
  );
end;
$function$
;

revoke all on function public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

grant execute on function public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) to authenticated;

grant execute on function public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.erp_commercial_reserve_invoice_for_documents(p_company_id uuid, p_order_id text, p_document_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid:=auth.uid(); v_order jsonb; v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype; v_res public.commercial_invoice_reservations%rowtype;
  v_doc public.electronic_documents%rowtype; v_ep text; v_count integer; v_next bigint;
  v_number text; v_created boolean:=false;
begin
  if v_actor is null or not public.erp_is_company_member(p_company_id,v_actor) then
    raise exception 'ERP_COMPANY_ACCESS_REQUIRED';
  end if;
  perform public.erp_security_assert_capability(p_company_id,'commercial.orders.view');
  perform public.erp_security_assert_capability(p_company_id,'commercial.electronic_documents.create');
  if p_document_code is null or p_document_code not in ('ETIQUETAS','INVOICE_PACKING_REFERENCIAL','COMMERCIAL_INVOICE_CLIENT','HR')
    or nullif(btrim(p_order_id),'') is null then raise exception 'COMMERCIAL_RESERVATION_INPUT_INVALID'; end if;
  -- Same lock order as create_electronic_document_draft: settings, point, invoice key.
  select * into v_settings from public.sri_settings where company_id=p_company_id for update;
  if not found or v_settings.environment not in ('TEST','PRODUCTION') then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
  select payload into v_order from public.erp_entity_records
    where company_id=p_company_id and entity='commercial_orders' and record_id=p_order_id and deleted_at is null for share;
  if not found or nullif(v_order->>'number','') is null or coalesce((v_order->>'unsavedDraft')::boolean,false)
    or coalesce((v_order->>'numberPending')::boolean,false) then raise exception 'COMMERCIAL_SAVED_ORDER_REQUIRED'; end if;
  if upper(coalesce(v_order->>'status','')) in ('ANULADO','CANCELLED','VOIDED') then raise exception 'COMMERCIAL_ORDER_CANCELLED'; end if;
  -- Reuse the validated LOCAL / EXPORT routing, deriving it from the saved order.
  v_ep:=case when coalesce(v_order->>'saleType','') ~* 'LOCAL'
    or coalesce(v_order->>'transportType','') ~* 'TERRESTRE|LOCAL' then '003' else '002' end;
  select count(*) into v_count from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active;
  if v_count<>1 then raise exception 'SRI_ACTIVE_EMISSION_POINT_REQUIRED'; end if;
  select * into v_point from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active for update;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':SRI_INVOICE:'||v_settings.environment||':'||p_order_id,0));
  select count(*) into v_count from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED');
  if v_count>1 then raise exception 'COMMERCIAL_INVOICE_RESERVATION_AMBIGUOUS'; end if;
  select * into v_res from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED') for update;
  if v_res.id is not null and (v_res.emission_point_id<>v_point.id or v_res.establishment_code<>'001' or v_res.emission_point_code<>v_ep) then
    raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
  if v_res.status='CONSUMED' then
    select * into v_doc from public.electronic_documents where id=v_res.consumed_document_id
      and company_id=p_company_id and environment=v_settings.environment and document_type='01';
    if not found then raise exception 'SRI_INVOICE_IDEMPOTENCY_DOCUMENT_MISSING'; end if;
  else
    select count(*) into v_count from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
    if v_count>1 then raise exception 'COMMERCIAL_INVOICE_DOCUMENT_AMBIGUOUS'; end if;
    select * into v_doc from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
  end if;
  if v_doc.id is not null then
    if v_doc.emission_point_id<>v_point.id or v_doc.establishment_code<>'001' or v_doc.emission_point_code<>v_ep
      or (v_res.id is not null and (v_res.full_number<>v_doc.full_number or v_res.sequential<>v_doc.sequential)) then
      raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
    v_number:=v_doc.full_number; v_next:=v_doc.sequential;
    -- Adopt an existing canonical document without touching it or the counter.
    -- This also makes the later Factura 01 retry use the existing consumed link.
    if v_res.id is null then
      insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
        establishment_code,emission_point_code,sequential,full_number,status,created_by,consumed_document_id,consumed_at)
        values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'CONSUMED',v_actor,v_doc.id,now())
        returning * into v_res;
    elsif v_res.status='ACTIVE' then
      update public.commercial_invoice_reservations set status='CONSUMED',consumed_document_id=v_doc.id,consumed_at=now(),updated_at=now()
        where id=v_res.id returning * into v_res;
    end if;
  elsif v_res.id is not null then
    v_number:=v_res.full_number; v_next:=v_res.sequential;
  else
    -- OFF remains OFF. Reading an existing identity does not enable issuance.
    if (v_settings.environment='TEST' and (not v_settings.test_enabled or v_settings.production_enabled))
      or (v_settings.environment='PRODUCTION' and not v_settings.production_enabled) then
      raise exception 'SRI_ENVIRONMENT_RESERVATION_DISABLED'; end if;
    insert into public.electronic_document_sequences(company_id,emission_point_id,environment,document_type,next_value,updated_by)
      values(p_company_id,v_point.id,v_settings.environment,'01',1,v_actor)
      on conflict(company_id,emission_point_id,environment,document_type) do nothing;
    select next_value into v_next from public.electronic_document_sequences where company_id=p_company_id
      and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01' for update;
    if v_next is null or v_next<1 or v_next>999999999 then raise exception 'SRI_SEQUENTIAL_EXHAUSTED'; end if;
    v_number:='001-'||v_ep||'-'||lpad(v_next::text,9,'0');
    update public.electronic_document_sequences set next_value=v_next+1,updated_by=v_actor
      where company_id=p_company_id and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01';
    insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
      establishment_code,emission_point_code,sequential,full_number,status,created_by)
      values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'ACTIVE',v_actor) returning * into v_res;
    v_created:=true;
  end if;
  if v_number is distinct from '001-'||v_ep||'-'||lpad(v_next::text,9,'0') then raise exception 'COMMERCIAL_INVOICE_IDENTITY_INVALID'; end if;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'orderId',p_order_id,'orderNumber',v_order->>'number',
    'environment',v_settings.environment,'documentType','01','emissionPointId',v_point.id,
    'establishmentCode','001','emissionPointCode',v_ep,'sequential',lpad(v_next::text,9,'0'),'fullNumber',v_number,
    'reservationId',v_res.id,'documentId',v_doc.id,'status',case when v_doc.id is not null then 'DOCUMENT' else 'ACTIVE' end,
    'created',v_created,'reused',not v_created);
end;
$function$
;

revoke all on function public.erp_commercial_reserve_invoice_for_documents(uuid,text,text) from public,anon,authenticated,service_role;

grant execute on function public.erp_commercial_reserve_invoice_for_documents(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.sri_draft_buyer_address_source(p_document electronic_documents)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.erp_entity_records%rowtype;
  v_customer public.erp_entity_records%rowtype;
  v_address text;
begin
  perform public.erp_security_assert_capability(p_document.company_id,'commercial.electronic_documents.authorize');
  if auth.uid() is null or p_document.environment <> 'TEST' or p_document.document_type <> '01'
    or p_document.status not in ('BORRADOR','VALIDADO')
    or p_document.certificate_id is not null
    or p_document.authorization_number is not null or p_document.authorized_at is not null
    or exists(select 1 from public.electronic_document_files where document_id=p_document.id)
    or exists(select 1 from public.sri_transmissions where document_id=p_document.id)
    or exists(select 1 from public.sri_transmission_attempts where document_id=p_document.id)
    or exists(select 1 from public.sri_authorizations where document_id=p_document.id) then
    raise exception using errcode='23514',message='SRI_DRAFT_ADDRESS_REFRESH_NOT_ALLOWED';
  end if;
  perform 1 from public.sri_settings where company_id=p_document.company_id
    and environment='TEST' and test_enabled and not production_enabled for share;
  if not found then raise exception 'SRI_TEST_DISABLED'; end if;
  select * into v_order from public.erp_entity_records
    where company_id=p_document.company_id and entity='commercial_orders'
      and record_id=p_document.source_snapshot#>>'{erpEmission,sourceOrderId}'
      and deleted_at is null for share;
  if not found then raise exception 'SRI_CANONICAL_SOURCE_ORDER_REQUIRED'; end if;
  select * into v_customer from public.erp_entity_records
    where company_id=p_document.company_id and entity='commercial_customers'
      and record_id=v_order.payload->>'customerId' and deleted_at is null for share;
  if not found then raise exception 'SRI_CANONICAL_CUSTOMER_REQUIRED'; end if;
  -- Identity is not editable through address refresh. Never match by name.
  if nullif(btrim(v_customer.payload->>'identification'),'') is null
    or btrim(v_customer.payload->>'identification') is distinct from btrim(p_document.buyer_snapshot->>'identification')
    or p_document.source_snapshot#>>'{buyer,identification}' is distinct from p_document.buyer_snapshot->>'identification' then
    raise exception 'SRI_CANONICAL_BUYER_IDENTITY_MISMATCH';
  end if;
  v_address := btrim(v_customer.payload->>'address');
  if coalesce(v_address,'')='' then raise exception 'SRI_BUYER_ADDRESS_REQUIRED'; end if;
  if length(v_address)>300 then raise exception 'SRI_BUYER_ADDRESS_TOO_LONG'; end if;
  return jsonb_build_object('address',v_address,'order_id',v_order.record_id,
    'order_version',v_order.version,'customer_id',v_customer.record_id,'customer_version',v_customer.version);
end $function$
;

drop function if exists public.erp_sri_set_sequence_next(uuid,text,uuid,text,bigint,bigint,uuid,text);

drop function if exists public.erp_sri_save_emission_point(uuid,text,text,text,text,text,boolean,timestamptz,uuid);

drop function if exists public.erp_sri_set_environment_enabled(uuid,text,boolean,boolean,uuid,text);

drop function if exists public.erp_sri_save_settings(uuid,jsonb,timestamptz,uuid);

drop function if exists public.erp_sri_configuration_state(uuid);

drop function if exists public.erp_sri_assert_transport_actor(uuid,uuid);

drop function if exists public.sri_assert_service_actor_capability(uuid,uuid,text);

drop function if exists public.erp_sri_config_assert_access(uuid,text);

drop function if exists public.erp_sri_config_replay(uuid,uuid,text,jsonb);

drop function if exists public.erp_sri_config_audit(uuid,uuid,text,jsonb,jsonb);

drop function if exists public.sri_assert_environment_enabled(uuid,text);

drop function if exists public.sri_assert_canonical_certificate(uuid);

drop function if exists public.sri_assert_document_routing(uuid,text,uuid,text);

alter table public.sri_settings drop constraint if exists sri_settings_production_gate;
alter table public.sri_settings add constraint sri_settings_production_gate check(environment='PRODUCTION' or production_enabled=false);
notify pgrst,'reload schema';
commit;