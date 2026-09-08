begin;

-- Service-only, after a live authorization lookup, for a returned 07 whose
-- immutable issue date was in the future at reception and is now today's date.
-- No document, key, XML, sequence, accounting entry or source snapshot is created.
create or replace function public.erp_sri_retry_returned_withholding_date(
 p_company_id uuid,p_document_id uuid,p_actor_user_id uuid,
 p_lookup_response_id uuid,p_lookup_attempt_id uuid,p_reception_response_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 d public.electronic_documents%rowtype;
 r public.sri_responses%rowtype;
 q public.sri_responses%rowtype;
 reception public.sri_transmissions%rowtype;
 lookup public.sri_transmissions%rowtype;
 a public.sri_transmission_attempts%rowtype;
 f public.electronic_document_files%rowtype;
 result jsonb;
begin
 perform public.sri_assert_service_actor_capability(p_company_id,p_actor_user_id,'purchases.withholdings.create');
 perform public.erp_sri_assert_transport_actor(p_company_id,p_actor_user_id);
 select * into d from public.electronic_documents where company_id=p_company_id and id=p_document_id for update;
 if not found then raise exception 'SRI_DOCUMENT_NOT_FOUND'; end if;
 result:=jsonb_build_object('document_id',d.id,'company_id',d.company_id,'environment',d.environment,
   'sequential',d.sequential,'access_key',d.access_key,'requeued',false);
 if exists(select 1 from public.electronic_document_audit_logs where company_id=d.company_id and document_id=d.id
   and action='WITHHOLDING_DATE_RETURN_REQUEUED' and new_values->>'lookup_attempt_id'=p_lookup_attempt_id::text
   and new_values->>'lookup_response_id'=p_lookup_response_id::text
   and new_values->>'reception_response_id'=p_reception_response_id::text) then return result; end if;
 if d.document_type<>'07' or d.status<>'DEVUELTO'
   or d.issue_date<>(clock_timestamp() at time zone 'America/Guayaquil')::date
   or left(d.access_key,8)<>to_char(d.issue_date,'DDMMYYYY')
   or exists(select 1 from public.sri_authorizations where company_id=d.company_id and document_id=d.id) then
   raise exception 'SRI_WITHHOLDING_DATE_RETURN_NOT_RECOVERABLE'; end if;
 perform public.sri_assert_environment_enabled(d.company_id,d.environment);
 perform public.sri_assert_document_routing(d.company_id,d.environment,d.emission_point_id,d.document_type);
 perform public.sri_assert_canonical_certificate(d.company_id);
 select * into r from public.sri_responses where company_id=d.company_id and document_id=d.id
   and response_type='RECEPTION' order by received_at desc,id desc limit 1;
 if r.id is distinct from p_reception_response_id or r.sri_status is distinct from 'DEVUELTA'
   or (r.received_at at time zone 'America/Guayaquil')::date>=d.issue_date
   or r.payload->>'returned' is distinct from 'true'
   or jsonb_array_length(r.payload->'messages') is distinct from 1
   or r.payload#>>'{messages,0,identifier}' is distinct from '65'
   or jsonb_array_length(r.payload->'receipts') is distinct from 1
   or r.payload#>>'{receipts,0,accessKey}' is distinct from d.access_key then
   raise exception 'SRI_DATE_RETURN_RECEIPT_REQUIRED'; end if;
 select * into reception from public.sri_transmissions where company_id=d.company_id and document_id=d.id
   and id=r.transmission_id and transmission_type='RECEPTION' for update;
 if reception.id is null or reception.environment<>d.environment or reception.status<>'COMPLETED'
   or reception.idempotency_key<>d.id::text||':RECEPTION' or reception.attempt_number>=reception.max_attempts then
   raise exception 'SRI_DATE_RETURN_RECEPTION_NOT_REQUEUEABLE'; end if;
 select * into f from public.electronic_document_files where company_id=d.company_id and document_id=d.id
   and id=reception.request_file_id and file_type='SIGNED_XML' and immutable;
 if f.id is null or f.storage_bucket<>'sri-private'
   or f.storage_object_path<>'companies/'||d.company_id||'/documents/'||d.id||'/signed_xml-'||f.content_sha256||'.xml'
   or not exists(select 1 from public.sri_transmission_attempts where company_id=d.company_id and document_id=d.id
     and transmission_id=reception.id and status='SUCCEEDED' and response_sha256=r.content_sha256
     and request_sha256=f.content_sha256) then raise exception 'SRI_DATE_RETURN_SIGNED_FILE_REQUIRED'; end if;
 select * into q from public.sri_responses where company_id=d.company_id and document_id=d.id
   and id=p_lookup_response_id and response_type='AUTHORIZATION';
 if q.id is null or q.sri_status<>'NO_ENCONTRADO' or q.payload->>'state' is distinct from 'NO_ENCONTRADO'
   or q.payload->>'accessKey' is distinct from d.access_key
   or q.payload->'documentCount' is distinct from '0'::jsonb or q.payload->'authorized' is distinct from 'false'::jsonb
   or q.payload->'authorizations' is distinct from '[]'::jsonb or q.payload->'messages' is distinct from '[]'::jsonb
   or q.raw_xml !~ '<([[:alnum:]_]+:)?numeroComprobantes>[[:space:]]*0[[:space:]]*</([[:alnum:]_]+:)?numeroComprobantes>'
   or q.received_at<r.received_at
   or exists(select 1 from public.sri_responses where company_id=d.company_id and document_id=d.id
     and response_type='AUTHORIZATION' and received_at>=r.received_at and sri_status in ('AUTORIZADO','NO AUTORIZADO','NO_AUTORIZADO')) then
   raise exception 'SRI_DATE_RETURN_DEFINITE_AUTHORIZATION_ABSENCE_REQUIRED'; end if;
 select * into lookup from public.sri_transmissions where company_id=d.company_id and document_id=d.id
   and id=q.transmission_id and transmission_type='AUTHORIZATION_QUERY' for update;
 select * into a from public.sri_transmission_attempts where company_id=d.company_id and document_id=d.id
   and transmission_id=lookup.id and id=p_lookup_attempt_id for update;
 if lookup.id is null or lookup.environment<>d.environment or lookup.status<>'PROCESSING'
   or lookup.idempotency_key<>d.id::text||':AUTHORIZATION_QUERY'
   or a.id is null or a.status<>'STARTED' or a.attempt_number<>lookup.attempt_number
   or a.started_at<clock_timestamp()-interval '10 minutes'
   or a.request_sha256<>encode(sha256(convert_to(d.access_key,'UTF8')),'hex') then
   raise exception 'SRI_DATE_RETURN_LIVE_AUTHORIZATION_ATTEMPT_REQUIRED'; end if;
 insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,
   old_status,new_status,reason,old_values,new_values)
 values(d.company_id,d.id,p_actor_user_id,'USER','WITHHOLDING_DATE_RETURN_REQUEUED','DEVUELTO','ENVIADO_SRI',
   'Retencion devuelta 65 antes de su fecha; fecha alcanzada y consulta oficial sin autorizacion. Mismo XML firmado.',
   jsonb_build_object('status',d.status,'access_key',d.access_key,'sequential',d.sequential),
   result||jsonb_build_object('lookup_attempt_id',a.id,'lookup_response_id',q.id,'reception_response_id',r.id,
     'signed_file_id',f.id,'signed_sha256',f.content_sha256));
 perform set_config('app.sri_withholding_date_retry',d.id::text,true);
 update public.electronic_documents set status='ENVIADO_SRI',updated_by=p_actor_user_id where company_id=d.company_id and id=d.id;
 perform set_config('app.sri_withholding_date_retry','',true);
 update public.sri_transmission_attempts set status='SUCCEEDED',response_sha256=q.content_sha256,http_status=200,
   finished_at=clock_timestamp() where id=a.id;
 update public.sri_transmissions set status='RETRY_SCHEDULED',next_attempt_at=clock_timestamp()+interval '5 minutes',
   worker_id=null,claimed_at=null,finished_at=clock_timestamp(),error_class=null,error_message=null where id=lookup.id;
 update public.sri_transmissions set status='PENDING',next_attempt_at=clock_timestamp(),worker_id=null,
   claimed_at=null,finished_at=null,error_class=null,error_message=null where id=reception.id;
 return result||jsonb_build_object('requeued',true);
end $$;
revoke all on function public.erp_sri_retry_returned_withholding_date(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.erp_sri_retry_returned_withholding_date(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;

-- The existing integrity trigger is preserved below, with one audited transition added.

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
     or new.environment not in ('TEST', 'PRODUCTION') then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;
  -- Existing documents retain their own immutable environment after the default changes.

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
  if new.status='AUTORIZADO' and new.authorization_number is distinct from new.access_key then raise exception 'SRI_AUTHORIZATION_NUMBER_MISMATCH'; end if;
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
          or (new.status='ENVIADO_SRI' and old.document_type='07'
            and current_setting('app.sri_withholding_date_retry',true)=old.id::text
            and exists(select 1 from public.electronic_document_audit_logs a where a.company_id=old.company_id
              and a.document_id=old.id and a.action='WITHHOLDING_DATE_RETURN_REQUEUED'
              and a.created_at>=transaction_timestamp() and a.new_values->>'access_key'=old.access_key))
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
commit;
