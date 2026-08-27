-- Registro auditado de una anulación ya realizada por el usuario en el portal SRI.
-- Es aditivo: no elimina ni modifica XML, autorizaciones, respuestas, intentos,
-- claves de acceso, números de comprobante ni contadores secuenciales.

create unique index if not exists electronic_document_audit_annulment_operation_uidx
  on public.electronic_document_audit_logs (
    document_id,
    ((new_values ->> 'operation_id')::uuid)
  )
  where action = 'SRI_ANNULMENT_REGISTERED'
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
  v_registered_annulment boolean := coalesce(current_setting('app.sri_registered_annulment', true), '') = 'on';
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
$$;

create or replace function public.register_sri_document_annulment(
  p_document_id uuid,
  p_operation_id uuid,
  p_annulment_date date,
  p_reason text,
  p_access_key text,
  p_evidence_reference text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document public.electronic_documents%rowtype;
  v_existing jsonb;
  v_audit jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_evidence text := nullif(btrim(coalesce(p_evidence_reference, '')), '');
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'SRI_ANNULMENT_OPERATION_ID_REQUIRED';
  end if;

  -- Serialize retries of the same logical command before checking the audit log.
  -- A concurrent double click therefore waits and then reuses the first result.
  perform pg_advisory_xact_lock(
    hashtextextended(coalesce(p_document_id::text, '') || ':' || p_operation_id::text, 0)
  );

  select to_jsonb(audit) into v_existing
  from public.electronic_document_audit_logs audit
  where audit.document_id = p_document_id
    and audit.action = 'SRI_ANNULMENT_REGISTERED'
    and audit.new_values ->> 'operation_id' = p_operation_id::text
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('reused', true, 'audit', v_existing);
  end if;

  select * into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.document_type <> '01' or v_document.status <> 'AUTORIZADO' then
    raise exception using errcode = '23514', message = 'SRI_ANNULMENT_REQUIRES_AUTHORIZED_INVOICE';
  end if;
  if p_actor_user_id is null or not exists (
    select 1 from public.sri_company_memberships membership
    where membership.company_id = v_document.company_id
      and membership.auth_user_id = p_actor_user_id
      and membership.active
      and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_REGISTER_ANNULMENT';
  end if;
  if p_annulment_date is null or p_annulment_date > current_date then
    raise exception using errcode = '22023', message = 'SRI_ANNULMENT_DATE_INVALID';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'SRI_ANNULMENT_REASON_INVALID';
  end if;
  if p_access_key is distinct from v_document.access_key then
    raise exception using errcode = '23514', message = 'SRI_ANNULMENT_ACCESS_KEY_MISMATCH';
  end if;
  if length(coalesce(v_evidence, '')) > 500 then
    raise exception using errcode = '22023', message = 'SRI_ANNULMENT_EVIDENCE_TOO_LONG';
  end if;

  perform set_config('app.sri_registered_annulment', 'on', true);
  update public.electronic_documents
  set status = 'ANULADO',
      updated_by = p_actor_user_id
  where id = v_document.id;

  insert into public.electronic_document_audit_logs (
    company_id, document_id, actor_user_id, actor_type, action,
    old_status, new_status, reason, old_values, new_values
  ) values (
    v_document.company_id, v_document.id, p_actor_user_id, 'USER',
    'SRI_ANNULMENT_REGISTERED', 'AUTORIZADO', 'ANULADO', v_reason,
    jsonb_build_object(
      'status', 'AUTORIZADO',
      'access_key', v_document.access_key,
      'authorization_number', v_document.authorization_number,
      'authorized_at', v_document.authorized_at
    ),
    jsonb_build_object(
      'operation_id', p_operation_id,
      'status', 'ANULADO',
      'annulment_date', p_annulment_date,
      'access_key', v_document.access_key,
      'evidence_reference', v_evidence,
      'artifacts_preserved', true,
      'sequential_preserved', v_document.sequential
    )
  ) returning to_jsonb(electronic_document_audit_logs) into v_audit;

  return jsonb_build_object('reused', false, 'audit', v_audit);
end;
$$;

revoke all on function public.register_sri_document_annulment(
  uuid, uuid, date, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.register_sri_document_annulment(
  uuid, uuid, date, text, text, text, uuid
) to service_role;

comment on function public.register_sri_document_annulment(
  uuid, uuid, date, text, text, text, uuid
) is 'Idempotently records an SRI portal annulment for an authorized invoice without changing its immutable fiscal artifacts or sequence.';
