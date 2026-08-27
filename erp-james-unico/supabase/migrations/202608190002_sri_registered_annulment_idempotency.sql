-- Harden concurrent retries for the controlled SRI annulment-registration command.
-- Data, fiscal artifacts and sequences are not modified by this migration.

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

  -- Serialize only identical logical commands. Other documents and operation IDs
  -- remain independent, while a concurrent retry waits for and reuses the audit row.
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
