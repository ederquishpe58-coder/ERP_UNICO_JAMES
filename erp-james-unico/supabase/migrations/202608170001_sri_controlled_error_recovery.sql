-- Recuperación controlada de comprobantes SRI en ambiente TEST.
-- No cambia secuenciales, claves de acceso, XML, documentos existentes ni datos históricos.

create unique index if not exists electronic_document_audit_recovery_operation_uidx
  on public.electronic_document_audit_logs (
    document_id,
    ((new_values ->> 'operation_id')::uuid)
  )
  where action = 'SRI_CORRECTION_PREPARED'
    and new_values ? 'operation_id';

create or replace function public.sri_validate_document_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype;
  v_expected_key text;
  v_transition_allowed boolean := false;
  v_recovery_query boolean := coalesce(current_setting('app.sri_recovery_query', true), '') = 'on';
begin
  select * into v_settings from public.sri_settings where company_id = new.company_id;
  if not found or v_settings.environment <> 'TEST' or v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CONFIGURATION_REQUIRED';
  end if;

  select * into v_point
  from public.emission_points
  where company_id = new.company_id and id = new.emission_point_id;
  if not found
     or v_point.environment <> 'TEST'
     or v_point.establishment_code <> new.establishment_code
     or v_point.emission_point_code <> new.emission_point_code then
    raise exception using errcode = '23514', message = 'SRI_EMISSION_POINT_MISMATCH';
  end if;

  v_expected_key := public.sri_build_access_key(
    new.issue_date,
    new.document_type,
    v_settings.ruc,
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

  if tg_op = 'UPDATE' then
    if new.company_id <> old.company_id
       or new.emission_point_id <> old.emission_point_id
       or new.document_type <> old.document_type
       or new.sequential <> old.sequential
       or new.numeric_code <> old.numeric_code
       or new.establishment_code <> old.establishment_code
       or new.emission_point_code <> old.emission_point_code
       or new.parent_document_id is distinct from old.parent_document_id
       or new.source_order_id is distinct from old.source_order_id
       or new.source_packing_id is distinct from old.source_packing_id
       or new.customer_id is distinct from old.customer_id
       or new.issuer_snapshot is distinct from old.issuer_snapshot
       or new.buyer_snapshot is distinct from old.buyer_snapshot
       or new.source_snapshot is distinct from old.source_snapshot then
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
$$;

create or replace function public.record_sri_recovery_authorization(
  p_document_id uuid,
  p_response_xml text,
  p_authorization_status text,
  p_authorization_number text,
  p_authorization_date timestamptz,
  p_environment text,
  p_authorized_xml text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  if v_document.environment <> 'TEST'
     or substring(v_document.access_key from 24 for 1) <> '1'
     or upper(coalesce(p_environment, '')) not in ('PRUEBAS', 'TEST', '1') then
    raise exception using errcode = '23514', message = 'SRI_RECOVERY_QUERY_MUST_BE_TEST';
  end if;
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
  if coalesce(v_identifier, '') not in ('45', '70') then
    raise exception using errcode = '23514', message = 'SRI_RECOVERY_QUERY_REQUIRES_CODE_45_OR_70';
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
    v_number, p_authorization_date, 'PRUEBAS', p_authorized_xml,
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
$$;

create or replace function public.prepare_sri_document_correction(
  p_document_id uuid,
  p_operation_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document public.electronic_documents%rowtype;
  v_identifier text;
  v_existing jsonb;
begin
  select * into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.environment <> 'TEST'
     or v_document.status not in ('DEVUELTO', 'NO_AUTORIZADO', 'ERROR_ENVIO') then
    raise exception using errcode = '23514', message = 'SRI_CORRECTION_NOT_ALLOWED';
  end if;
  if p_actor_user_id is null or not exists (
    select 1 from public.sri_company_memberships membership
    where membership.company_id = v_document.company_id
      and membership.auth_user_id = p_actor_user_id
      and membership.active
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_PREPARE_CORRECTION';
  end if;
  select regexp_replace(coalesce(error.identifier, ''), '\D', '', 'g')
  into v_identifier
  from public.sri_error_messages error
  where error.document_id = v_document.id
  order by error.created_at desc
  limit 1;
  if coalesce(v_identifier, '') in ('45', '70') then
    raise exception using errcode = '23514', message = 'SRI_QUERY_REQUIRED_BEFORE_CORRECTION';
  end if;

  select to_jsonb(audit) into v_existing
  from public.electronic_document_audit_logs audit
  where audit.document_id = v_document.id
    and audit.action = 'SRI_CORRECTION_PREPARED'
    and audit.new_values ->> 'operation_id' = p_operation_id::text
  limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into public.electronic_document_audit_logs (
    company_id, document_id, actor_user_id, actor_type, action,
    old_status, new_status, reason, new_values
  ) values (
    v_document.company_id, v_document.id, p_actor_user_id, 'USER',
    'SRI_CORRECTION_PREPARED', v_document.status, v_document.status,
    'Corrección explícita preparada sin reenvío ni cambio de secuencial',
    jsonb_build_object(
      'operation_id', p_operation_id,
      'access_key', v_document.access_key,
      'sequential', v_document.sequential,
      'status_preserved', true
    )
  ) returning to_jsonb(electronic_document_audit_logs) into v_existing;
  return v_existing;
end;
$$;

revoke all on function public.record_sri_recovery_authorization(
  uuid, text, text, text, timestamptz, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_sri_recovery_authorization(
  uuid, text, text, text, timestamptz, text, text, uuid
) to service_role;

revoke all on function public.prepare_sri_document_correction(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_sri_document_correction(uuid, uuid, uuid)
  to service_role;

comment on function public.record_sri_recovery_authorization(
  uuid, text, text, text, timestamptz, text, text, uuid
) is 'Reconciles only TEST invoices returned with SRI code 45/70 after querying the same access key.';
comment on function public.prepare_sri_document_correction(uuid, uuid, uuid)
  is 'Idempotently audits an explicit correction decision without retransmission or sequence changes.';
