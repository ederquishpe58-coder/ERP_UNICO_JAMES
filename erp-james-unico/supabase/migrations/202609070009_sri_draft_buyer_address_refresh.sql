-- Refresh only the canonical buyer address of an unmaterialized TEST invoice.
-- No reservation, sequence, access-key, totals, identity or issued-document changes.
create or replace function public.sri_draft_buyer_address_source(p_document public.electronic_documents)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;
revoke all on function public.sri_draft_buyer_address_source(public.electronic_documents) from public,anon,authenticated,service_role;

create or replace function public.refresh_electronic_document_buyer_address(p_company_id uuid,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_document public.electronic_documents%rowtype; v_source jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'commercial.electronic_documents.authorize');
  select * into v_document from public.electronic_documents
    where company_id=p_company_id and id=p_document_id for update;
  if not found then raise exception 'SRI_DOCUMENT_NOT_FOUND'; end if;
  v_source := public.sri_draft_buyer_address_source(v_document);
  if v_document.buyer_snapshot->>'address' is distinct from v_source->>'address'
    or v_document.source_snapshot#>>'{buyer,address}' is distinct from v_source->>'address' then
    update public.electronic_documents set
      buyer_snapshot=jsonb_set(buyer_snapshot,'{address}',v_source->'address'),
      source_snapshot=jsonb_set(source_snapshot,'{buyer,address}',v_source->'address'),
      updated_by=auth.uid()
    where id=v_document.id and company_id=p_company_id returning * into v_document;
  end if;
  return jsonb_build_object('ok',true,'document',to_jsonb(v_document),'source',v_source);
end $$;
revoke all on function public.refresh_electronic_document_buyer_address(uuid,uuid) from public,anon,service_role,authenticated;
grant execute on function public.refresh_electronic_document_buyer_address(uuid,uuid) to authenticated;

-- Preserve the existing integrity/transition guards; only the audited address exception is new.
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
