-- P1: extraordinary same-document retry after an unrecoverable reception result.
-- The capability is catalogued but never assigned by this migration.
begin;

do $capability$
declare c public.erp_security_capabilities%rowtype;
begin
  select * into c
  from public.erp_security_capabilities
  where capability_id = 'commercial.electronic_documents.break_glass_retry';
  if not found then
    insert into public.erp_security_capabilities(
      capability_id, module, resource, action, risk_level, description, active
    ) values (
      'commercial.electronic_documents.break_glass_retry',
      'commercial', 'electronic_documents', 'break_glass_retry', 'CRITICAL',
      'Retransmitir bajo responsabilidad el mismo comprobante tras un resultado de recepcion no demostrable',
      true
    );
  elsif c.module is distinct from 'commercial'
     or c.resource is distinct from 'electronic_documents'
     or c.action is distinct from 'break_glass_retry'
     or c.risk_level is distinct from 'CRITICAL'
     or c.active is distinct from true then
    raise exception 'SRI_BREAK_GLASS_CAPABILITY_CONTRACT_DRIFT';
  end if;
end;
$capability$;

create or replace function public.claim_sri_break_glass_reception(
  p_company_id uuid,
  p_document_id uuid,
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_authorization_job_id uuid,
  p_authorization_worker text,
  p_authorization_attempt_id uuid,
  p_lookup_response_id uuid,
  p_signed_file_id uuid,
  p_document_snapshot jsonb,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  d public.electronic_documents%rowtype;
  q public.sri_transmissions%rowtype;
  j public.sri_transmissions%rowtype;
  a public.sri_transmission_attempts%rowtype;
  last_send public.sri_transmission_attempts%rowtype;
  latest_lookup public.sri_transmission_attempts%rowtype;
  f public.electronic_document_files%rowtype;
  r public.sri_responses%rowtype;
  existing public.electronic_document_audit_logs%rowtype;
  n integer;
  at_time timestamptz;
  worker text;
begin
  perform public.sri_assert_service_actor_capability(
    p_company_id, p_actor_user_id,
    'commercial.electronic_documents.break_glass_retry'
  );
  perform public.erp_sri_assert_transport_actor(p_company_id, p_actor_user_id);
  if p_operation_id is null or p_evidence is null
     or jsonb_typeof(p_document_snapshot) is distinct from 'object'
     or jsonb_typeof(p_evidence) is distinct from 'object' then
    raise exception 'SRI_BREAK_GLASS_CONFIRMATION_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'SRI_BREAK_GLASS_OPERATION:' || p_operation_id::text, 0
  ));
  select * into d
  from public.electronic_documents
  where company_id = p_company_id and id = p_document_id
  for update;
  if not found then raise exception 'SRI_DOCUMENT_NOT_FOUND'; end if;

  select * into existing
  from public.electronic_document_audit_logs
  where company_id = p_company_id
    and document_id = p_document_id
    and action = 'SRI_BREAK_GLASS_RETRY'
    and new_values->>'operation_id' = p_operation_id::text
  order by created_at desc, id desc
  limit 1;
  if found then
    select * into j
    from public.sri_transmissions
    where company_id = d.company_id
      and id = nullif(existing.new_values->>'transmission_id', '')::uuid;
    select * into a
    from public.sri_transmission_attempts
    where company_id = d.company_id
      and id = nullif(existing.new_values->>'attempt_id', '')::uuid;
    return to_jsonb(j) || jsonb_build_object(
      'break_glass_same_document', true,
      'reused', true,
      'operation_id', p_operation_id,
      'claim_attempt', to_jsonb(a)
    );
  end if;

  if d.document_type not in ('01', '04', '07')
     or d.status not in ('PENDIENTE_REINTENTO', 'ERROR_ENVIO', 'ENVIADO_SRI') then
    raise exception 'SRI_BREAK_GLASS_DOCUMENT_NOT_ELIGIBLE';
  end if;
  if to_jsonb(d) is distinct from p_document_snapshot then
    raise exception 'SRI_BREAK_GLASS_FROZEN_IDENTITY_CHANGED';
  end if;
  -- Lock the existing accounting relationship before comparing the handoff.
  -- The claim never creates or edits accounting rows, but it must not race a
  -- concurrent link change between the manager read and this same-document send.
  perform 1
  from public.accounting_document_links l
  where l.company_id = d.company_id and l.document_id = d.id
  for update;
  perform public.sri_assert_environment_enabled(d.company_id, d.environment);
  perform public.sri_assert_document_routing(d.company_id, d.environment, d.emission_point_id, d.document_type);
  if exists(select 1 from public.sri_authorizations
            where company_id = d.company_id and document_id = d.id)
     or exists(select 1 from public.sri_responses
               where company_id = d.company_id and document_id = d.id and response_type = 'RECEPTION')
     or exists(select 1 from public.sri_error_messages
               where company_id = d.company_id and document_id = d.id and identifier in ('43', '45', '70'))
     or exists(select 1 from public.erp_sri_document_management
               where company_id = d.company_id and document_id = d.id
                 and (automatic_paused or correction_in_progress))
     or exists(select 1 from public.erp_sri_document_manager_events
               where company_id = d.company_id and document_id = d.id
                 and action = 'CANCELLATION_REQUESTED')
     or exists(select 1 from public.erp_purchase_withholding_cancellations
               where company_id = d.company_id and electronic_document_id = d.id
                 and state in ('CANCELLATION_REQUESTED', 'PENDING_CANCELLATION')) then
    raise exception 'SRI_BREAK_GLASS_REVIEW_REQUIRED';
  end if;

  perform public.assert_sri_manual_authorization_claim(
    p_authorization_job_id, p_authorization_worker,
    p_authorization_attempt_id, p_actor_user_id
  );
  select * into q
  from public.sri_transmissions
  where company_id = d.company_id and id = p_authorization_job_id
    and document_id = d.id and transmission_type = 'AUTHORIZATION_QUERY'
  for update;
  select * into a
  from public.sri_transmission_attempts
  where company_id = d.company_id and document_id = d.id
    and transmission_id = q.id and id = p_authorization_attempt_id
  for update;
  select * into r
  from public.sri_responses
  where company_id = d.company_id and document_id = d.id
    and transmission_id = q.id and id = p_lookup_response_id
    and response_type = 'AUTHORIZATION';
  if q.id is null or q.status <> 'PROCESSING' or q.worker_id is distinct from p_authorization_worker
     or q.environment is distinct from d.environment
     or q.endpoint_url <> (case d.environment
       when 'PRODUCTION' then 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
       when 'TEST' then 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
       else '' end)
     or a.id is null or a.status <> 'STARTED' or a.attempt_number <= q.attempt_number
     or r.id is null or r.sri_status is distinct from 'NO_ENCONTRADO'
     or r.raw_xml is null or btrim(r.raw_xml) = ''
     or r.content_sha256 is distinct from encode(sha256(convert_to(r.raw_xml, 'UTF8')), 'hex')
     or r.payload->>'accessKey' is distinct from d.access_key
     or r.payload->'documentCount' is distinct from '0'::jsonb
     or r.payload->'authorized' is distinct from 'false'::jsonb
     or r.payload->'messages' is distinct from '[]'::jsonb
     or r.payload->'authorizations' is distinct from '[]'::jsonb then
    raise exception 'SRI_BREAK_GLASS_FINAL_LOOKUP_REQUIRED';
  end if;

  select * into j
  from public.sri_transmissions
  where company_id = d.company_id and document_id = d.id and transmission_type = 'RECEPTION'
  for update;
  select * into f
  from public.electronic_document_files
  where id = p_signed_file_id and company_id = d.company_id and document_id = d.id
    and file_type = 'SIGNED_XML';
  select * into last_send
  from public.sri_transmission_attempts
  where company_id = d.company_id and document_id = d.id and transmission_id = j.id
  order by finished_at desc nulls last, attempt_number desc, id desc
  limit 1;
  if j.id is null or j.status not in ('FAILED', 'RETRY_SCHEDULED')
     or j.environment is distinct from d.environment
     or j.request_file_id is distinct from f.id
     or j.endpoint_url <> (case d.environment
       when 'PRODUCTION' then 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'
       when 'TEST' then 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'
       else '' end)
     or j.next_attempt_at is not null and j.next_attempt_at > clock_timestamp()
     or f.id is null or f.storage_bucket <> 'sri-private'
     or f.storage_object_path <> 'companies/' || d.company_id || '/documents/' || d.id
       || '/signed_xml-' || f.content_sha256 || '.xml'
     or last_send.id is null or last_send.finished_at is null
     or last_send.status = 'STARTED'
     or last_send.endpoint_url is distinct from j.endpoint_url
     or last_send.request_sha256 is distinct from f.content_sha256 then
    raise exception 'SRI_BREAK_GLASS_RECEPTION_EVIDENCE_REQUIRED';
  end if;

  if (select count(*)
      from public.sri_transmission_attempts x
      where x.company_id = d.company_id and x.document_id = d.id
        and x.transmission_id = q.id and x.id <> a.id
        and x.status = 'SUCCEEDED' and x.http_status = 200
        and x.response_sha256 = r.content_sha256
        and x.request_sha256 = encode(sha256(convert_to(d.access_key, 'UTF8')), 'hex')
        and x.endpoint_url = q.endpoint_url
        and x.finished_at > last_send.finished_at) < 1 then
    raise exception 'SRI_BREAK_GLASS_LOOKUP_EVIDENCE_REQUIRED';
  end if;
  select * into latest_lookup
  from public.sri_transmission_attempts x
  where x.company_id = d.company_id and x.document_id = d.id
    and x.transmission_id = q.id and x.id <> a.id
  order by x.finished_at desc nulls last, x.attempt_number desc, x.id desc
  limit 1;
  if latest_lookup.id is null
     or latest_lookup.status <> 'SUCCEEDED'
     or latest_lookup.http_status <> 200
     or latest_lookup.response_sha256 is distinct from r.content_sha256
     or latest_lookup.request_sha256 is distinct from encode(sha256(convert_to(d.access_key, 'UTF8')), 'hex')
     or latest_lookup.finished_at <= last_send.finished_at then
    raise exception 'SRI_BREAK_GLASS_LATEST_LOOKUP_NOT_DEFINITIVE';
  end if;
  if p_evidence->>'validation' is distinct from 'PASS'
      or p_evidence->>'signedXmlHash' is distinct from f.content_sha256
      or p_evidence->>'finalLookupHash' is distinct from r.content_sha256
      or p_evidence->>'accountingHash' is null
      or p_evidence->>'accountingHash' !~ '^[0-9a-f]{64}$'
      or coalesce(p_evidence->'accountingLinks', '[]'::jsonb) is distinct from (
           select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb)
           from public.accounting_document_links l
           where l.company_id = d.company_id and l.document_id = d.id
         )
      or p_evidence->'identity'->>'documentId' is distinct from d.id::text
     or p_evidence->'identity'->>'companyId' is distinct from d.company_id::text
     or p_evidence->'identity'->>'environment' is distinct from d.environment
     or p_evidence->'identity'->>'documentType' is distinct from d.document_type
     or p_evidence->'identity'->>'fullNumber' is distinct from d.full_number
     or p_evidence->'identity'->>'establishment' is distinct from d.establishment_code
     or p_evidence->'identity'->>'emissionPoint' is distinct from d.emission_point_code
     or p_evidence->'identity'->>'accessKey' is distinct from d.access_key
     or p_evidence->'identity'->>'issueDate' is distinct from d.issue_date::text
     or p_evidence->'identity'->>'sequential' is distinct from d.sequential_text
     or p_evidence->'identity'->>'signedFileId' is distinct from f.id::text
     or p_evidence->'identity'->>'signedXmlHash' is distinct from f.content_sha256 then
    raise exception 'SRI_BREAK_GLASS_VALIDATION_REQUIRED';
  end if;
  if exists(select 1 from public.sri_transmissions
            where company_id = d.company_id and document_id = d.id
              and status = 'PROCESSING' and id <> q.id)
     or exists(select 1 from public.sri_transmission_attempts
               where company_id = d.company_id and document_id = d.id
                 and status = 'STARTED' and id <> a.id) then
    raise exception 'SRI_TRANSMISSION_ALREADY_PROCESSING';
  end if;

  at_time := clock_timestamp();
  worker := 'break-glass-reception-' || p_operation_id::text;
  update public.sri_transmission_attempts
  set status = 'SUCCEEDED', response_sha256 = r.content_sha256,
      http_status = 200, retryable = false, error_class = null,
      error_message = null, finished_at = at_time
  where id = a.id;
  update public.sri_transmissions
  set status = 'FAILED', next_attempt_at = null, finished_at = at_time,
      http_status = 200, error_class = 'SRI_AUTHORIZATION_PENDING',
      error_message = 'Consulta final sin autorizacion; reintento extraordinario confirmado.'
  where id = q.id;
  select greatest(coalesce(max(attempt_number), 0), j.attempt_number) + 1 into n
  from public.sri_transmission_attempts
  where transmission_id = j.id;
  update public.sri_transmissions
  set status = 'PROCESSING', worker_id = worker, claimed_at = at_time,
      finished_at = null, next_attempt_at = null, error_class = null,
      error_message = null
  where id = j.id
  returning * into j;
  insert into public.sri_transmission_attempts(
    company_id, document_id, transmission_id, attempt_number, status,
    endpoint_url, request_sha256, started_at
  ) values (
    d.company_id, d.id, j.id, n, 'STARTED', j.endpoint_url,
    f.content_sha256, at_time
  ) returning * into a;
  insert into public.electronic_document_audit_logs(
    company_id, document_id, actor_user_id, actor_type, action, reason, new_values
  ) values (
    d.company_id, d.id, p_actor_user_id, 'USER', 'SRI_BREAK_GLASS_RETRY',
    'Reintento extraordinario del mismo XML firmado; identidad congelada y consulta final previa, sin nuevo comprobante ni secuencial.',
    jsonb_build_object(
      'operation_id', p_operation_id,
      'transmission_id', j.id,
      'attempt_id', a.id,
      'worker_id', worker,
      'claimed_at', j.claimed_at,
      'authorization_attempt_id', p_authorization_attempt_id,
      'lookup_response_id', r.id,
      'signed_file_id', f.id,
      'signed_xml_hash', f.content_sha256,
      'document_before', to_jsonb(d),
      'evidence', p_evidence,
      'break_glass', true
    )
  );
  return to_jsonb(j) || jsonb_build_object(
    'break_glass_same_document', true,
    'reused', false,
    'operation_id', p_operation_id,
    'claim_attempt', to_jsonb(a)
  );
end;
$function$;

revoke all on function public.claim_sri_break_glass_reception(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.claim_sri_break_glass_reception(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb
) to service_role;

create or replace function public.assert_sri_break_glass_reception_claim(
  p_transmission_id uuid,
  p_worker_id text,
  p_attempt_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  j public.sri_transmissions%rowtype;
  d public.electronic_documents%rowtype;
  a public.sri_transmission_attempts%rowtype;
  e public.electronic_document_audit_logs%rowtype;
begin
  select * into j from public.sri_transmissions where id = p_transmission_id;
  if j.id is null then raise exception 'SRI_BREAK_GLASS_CLAIM_LOST'; end if;
  perform public.sri_assert_service_actor_capability(j.company_id, p_actor_user_id,
    'commercial.electronic_documents.break_glass_retry');
  perform public.erp_sri_assert_transport_actor(j.company_id, p_actor_user_id);
  select * into d
  from public.electronic_documents
  where company_id = j.company_id and id = j.document_id
  for update;
  select * into j from public.sri_transmissions where id = p_transmission_id for update;
  select * into a
  from public.sri_transmission_attempts
  where company_id = j.company_id and document_id = j.document_id
    and transmission_id = j.id and id = p_attempt_id;
  select * into e
  from public.electronic_document_audit_logs
  where company_id = j.company_id and document_id = j.document_id
    and action = 'SRI_BREAK_GLASS_RETRY'
    and actor_user_id = p_actor_user_id
    and new_values->>'attempt_id' = a.id::text
    and new_values->>'worker_id' = p_worker_id
  order by created_at desc, id desc
  limit 1;
  if d.id is null or j.status <> 'PROCESSING' or j.transmission_type <> 'RECEPTION'
     or j.worker_id is distinct from p_worker_id
     or p_worker_id not like 'break-glass-reception-%'
     or j.environment is distinct from d.environment
     or j.claimed_at is null
     or j.claimed_at <= clock_timestamp() - interval '180 seconds'
     or j.claimed_at > clock_timestamp()
     or a.id is null or a.status <> 'STARTED'
     or e.id is null
     or a.request_sha256 is distinct from e.new_values->>'signed_xml_hash'
     or (to_jsonb(d) - array['status', 'updated_at', 'updated_by', 'last_error']) is distinct from
        ((e.new_values->'document_before') - array['status', 'updated_at', 'updated_by', 'last_error'])
     or exists(select 1 from public.sri_authorizations
               where company_id = d.company_id and document_id = d.id)
     or exists(select 1 from public.sri_responses
               where company_id = d.company_id and document_id = d.id and response_type = 'RECEPTION')
     or exists(select 1 from public.sri_error_messages
               where company_id = d.company_id and document_id = d.id and identifier in ('43', '45', '70'))
     or exists(select 1 from public.erp_sri_document_manager_events
               where company_id = d.company_id and document_id = d.id and action = 'CANCELLATION_REQUESTED')
     or exists(select 1 from public.erp_purchase_withholding_cancellations
               where company_id = d.company_id and electronic_document_id = d.id
                 and state in ('CANCELLATION_REQUESTED', 'PENDING_CANCELLATION')) then
    raise exception 'SRI_BREAK_GLASS_CLAIM_LOST';
  end if;
  perform public.sri_assert_environment_enabled(d.company_id, d.environment);
  return true;
end;
$function$;

revoke all on function public.assert_sri_break_glass_reception_claim(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_sri_break_glass_reception_claim(uuid, text, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
