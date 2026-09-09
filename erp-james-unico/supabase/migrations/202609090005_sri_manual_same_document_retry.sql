-- Focal manual reception handoff. No existing documents, counters or permissions are changed.
begin;
create or replace function public.claim_sri_manual_same_document_reception(
 p_company_id uuid,p_document_id uuid,p_actor_user_id uuid,p_operation_id uuid,
 p_authorization_job_id uuid,p_authorization_worker text,p_authorization_attempt_id uuid,
 p_lookup_response_id uuid,p_signed_file_id uuid,p_document_snapshot jsonb,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.electronic_documents%rowtype;q public.sri_transmissions%rowtype;j public.sri_transmissions%rowtype;
 a public.sri_transmission_attempts%rowtype;last_send public.sri_transmission_attempts%rowtype;
 f public.electronic_document_files%rowtype;r public.sri_responses%rowtype;n integer;worker text;fault text;at_time timestamptz;
begin
 perform public.erp_sri_assert_transport_actor(p_company_id,p_actor_user_id);
 select * into d from public.electronic_documents where id=p_document_id and company_id=p_company_id for update;
 if d.id is null then raise exception 'SRI_DOCUMENT_NOT_FOUND';end if;
 if p_operation_id is null or p_evidence is null then raise exception 'SRI_MANUAL_RETRY_CONFIRMATION_REQUIRED';end if;
 if exists(select 1 from public.electronic_document_audit_logs where action='SRI_MANUAL_SAME_DOCUMENT_RETRY' and new_values->>'operation_id'=p_operation_id::text) then raise exception 'SRI_MANUAL_RETRY_OPERATION_CONSUMED';end if;
 perform public.assert_sri_manual_authorization_claim(p_authorization_job_id,p_authorization_worker,p_authorization_attempt_id,p_actor_user_id);
 select * into q from public.sri_transmissions where id=p_authorization_job_id and company_id=d.company_id and document_id=d.id;
 if q.id is null or to_jsonb(d) is distinct from p_document_snapshot or d.status not in('PENDIENTE_REINTENTO','ERROR_ENVIO','ENVIADO_SRI') then raise exception 'SRI_MANUAL_RETRY_FROZEN_IDENTITY_CHANGED';end if;
 perform public.sri_assert_document_routing(d.company_id,d.environment,d.emission_point_id,d.document_type);
 if exists(select 1 from public.erp_sri_document_management where document_id=d.id and (automatic_paused or correction_in_progress))
 or exists(select 1 from public.erp_sri_document_manager_events where document_id=d.id and action='CANCELLATION_REQUESTED') then raise exception 'SRI_MANUAL_RETRY_REVIEW_REQUIRED';end if;
 if exists(select 1 from public.sri_authorizations where document_id=d.id)
 or exists(select 1 from public.sri_responses where document_id=d.id and response_type='RECEPTION')
 or exists(select 1 from public.sri_error_messages where document_id=d.id and identifier in('43','45','70')) then raise exception 'SRI_MANUAL_RETRY_FISCAL_RESPONSE_EXISTS';end if;
 select * into j from public.sri_transmissions where company_id=d.company_id and document_id=d.id and transmission_type='RECEPTION' for update;
 select * into f from public.electronic_document_files where id=p_signed_file_id and company_id=d.company_id and document_id=d.id and file_type='SIGNED_XML';
 if j.id is null or j.status not in('FAILED','RETRY_SCHEDULED') or j.environment is distinct from d.environment or f.id is null or j.request_file_id is distinct from f.id
 or f.storage_bucket<>'sri-private' or f.storage_object_path<>'companies/'||d.company_id||'/documents/'||d.id||'/signed_xml-'||f.content_sha256||'.xml'
 or j.endpoint_url<>(case d.environment when 'PRODUCTION' then 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline' when 'TEST' then 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline' else '' end)
 or j.next_attempt_at>clock_timestamp() then raise exception 'SRI_MANUAL_RETRY_RECEPTION_NOT_ELIGIBLE';end if;
 if exists(select 1 from public.sri_transmissions where document_id=d.id and status='PROCESSING' and id<>q.id)
 or exists(select 1 from public.sri_transmission_attempts where document_id=d.id and status='STARTED' and id<>p_authorization_attempt_id) then raise exception 'SRI_TRANSMISSION_ALREADY_PROCESSING';end if;
 select * into last_send from public.sri_transmission_attempts where transmission_id=j.id order by attempt_number desc limit 1;
 select x.new_values#>>'{transport,response,faultString}' into fault from public.electronic_document_audit_logs x
 where x.company_id=d.company_id and x.document_id=d.id and x.action='TRANSPORT_DIAGNOSTIC'
 and x.new_values->>'phase'='RECEPTION' and x.new_values->>'attemptId'=last_send.id::text and x.new_values->>'transmissionId'=j.id::text
 and x.new_values#>>'{transport,httpStatus}'='500' and x.new_values#>>'{transport,environment}'=d.environment
 and x.new_values#>>'{transport,response,faultCode}'='soap:Server' order by created_at desc limit 1;
 if last_send.id is null or last_send.finished_at is null or last_send.http_status is distinct from 500 or last_send.request_sha256 is distinct from f.content_sha256
 or last_send.endpoint_url is distinct from j.endpoint_url or fault is null or fault not in(
 'javax.persistence.PersistenceException: org.hibernate.exception.GenericJDBCException: Could not open connection',
 'JBAS014559: Invocation cannot proceed as component is shutting down') then raise exception 'SRI_MANUAL_RETRY_RECEPTION_EVIDENCE_REQUIRED';end if;
 select * into r from public.sri_responses where id=p_lookup_response_id and company_id=d.company_id and document_id=d.id and transmission_id=q.id and response_type='AUTHORIZATION';
 if r.id is null or r.sri_status is distinct from 'NO_ENCONTRADO' or r.raw_xml is null or r.content_sha256 is distinct from encode(sha256(convert_to(r.raw_xml,'UTF8')),'hex')
 or r.payload->>'accessKey' is distinct from d.access_key or r.payload->'documentCount' is distinct from '0'::jsonb
 or r.payload->'authorized' is distinct from 'false'::jsonb or r.payload->'messages' is distinct from '[]'::jsonb
 or r.payload->'authorizations' is distinct from '[]'::jsonb then raise exception 'SRI_MANUAL_RETRY_FINAL_LOOKUP_REQUIRED';end if;
 if (select count(*) from public.sri_transmission_attempts x where x.transmission_id=q.id and x.company_id=d.company_id and x.document_id=d.id
 and x.http_status=200 and x.response_sha256=r.content_sha256 and x.request_sha256=encode(sha256(convert_to(d.access_key,'UTF8')),'hex')
 and x.finished_at>last_send.finished_at and x.endpoint_url=q.endpoint_url)<2 then raise exception 'SRI_MANUAL_RETRY_LOOKUP_EVIDENCE_REQUIRED';end if;
 if p_evidence->>'validation' is distinct from 'PASS' or p_evidence->>'signedXmlHash' is distinct from f.content_sha256
 or p_evidence->>'finalLookupHash' is distinct from r.content_sha256 then raise exception 'SRI_MANUAL_RETRY_VALIDATION_REQUIRED';end if;
 -- Short transaction: atomically close lookup and transfer the same document lease to reception.
 at_time:=clock_timestamp();worker:='manual-reception-'||p_operation_id;
 update public.sri_transmission_attempts set status='SUCCEEDED',response_sha256=r.content_sha256,http_status=200,retryable=false,error_class=null,error_message=null,finished_at=at_time where id=p_authorization_attempt_id;
 update public.sri_transmissions set status='FAILED',next_attempt_at=null,finished_at=at_time,http_status=200,error_class='SRI_AUTHORIZATION_PENDING',error_message='Consulta final sin autorización; reintento humano confirmado.' where id=q.id;
 select greatest(coalesce(max(attempt_number),0),j.attempt_number)+1 into n from public.sri_transmission_attempts where transmission_id=j.id;
 update public.sri_transmissions set status='PROCESSING',worker_id=worker,claimed_at=at_time,finished_at=null,next_attempt_at=null,error_class=null,error_message=null where id=j.id returning * into j;
 insert into public.sri_transmission_attempts(company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256,started_at)
 values(d.company_id,d.id,j.id,n,'STARTED',j.endpoint_url,f.content_sha256,at_time) returning * into a;
 insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,reason,new_values)
 values(d.company_id,d.id,p_actor_user_id,'USER','SRI_MANUAL_SAME_DOCUMENT_RETRY','Reintento humano del mismo XML firmado; identidad congelada, consulta final previa, sin nuevo comprobante ni consumo de secuencia.',
 jsonb_build_object('operation_id',p_operation_id,'transmission_id',j.id,'attempt_id',a.id,'worker_id',worker,'claimed_at',j.claimed_at,
 'authorization_attempt_id',p_authorization_attempt_id,'lookup_response_id',r.id,'signed_file_id',f.id,'signed_xml_hash',f.content_sha256,'document_before',to_jsonb(d),'evidence',p_evidence));
 return to_jsonb(j)||jsonb_build_object('manual_same_document',true,'claim_attempt',to_jsonb(a),'operation_id',p_operation_id);
end $$;
revoke all on function public.claim_sri_manual_same_document_reception(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claim_sri_manual_same_document_reception(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb) to service_role;

create or replace function public.assert_sri_manual_reception_claim(p_transmission_id uuid,p_worker_id text,p_attempt_id uuid,p_actor_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.sri_transmissions%rowtype;d public.electronic_documents%rowtype;a public.sri_transmission_attempts%rowtype;e public.electronic_document_audit_logs%rowtype;
begin
 select * into j from public.sri_transmissions where id=p_transmission_id;
 perform public.erp_sri_assert_transport_actor(j.company_id,p_actor_user_id);
 select * into d from public.electronic_documents where id=j.document_id and company_id=j.company_id for update;
 select * into j from public.sri_transmissions where id=p_transmission_id for update;
 select * into a from public.sri_transmission_attempts where id=p_attempt_id and transmission_id=j.id and document_id=d.id and company_id=d.company_id;
 select * into e from public.electronic_document_audit_logs where document_id=d.id and company_id=d.company_id and action='SRI_MANUAL_SAME_DOCUMENT_RETRY'
 and actor_user_id=p_actor_user_id and new_values->>'attempt_id'=a.id::text and new_values->>'worker_id'=p_worker_id order by created_at desc limit 1;
 if d.id is null or j.status<>'PROCESSING' or j.transmission_type<>'RECEPTION' or j.worker_id is distinct from p_worker_id or j.environment<>d.environment
 or j.claimed_at is null or j.claimed_at<=clock_timestamp()-interval '180 seconds' or j.claimed_at>clock_timestamp() or a.id is null or a.status<>'STARTED' or e.id is null
 or a.request_sha256 is distinct from e.new_values->>'signed_xml_hash'
 or (to_jsonb(d)-array['status','updated_at','updated_by','last_error']) is distinct from ((e.new_values->'document_before')-array['status','updated_at','updated_by','last_error'])
 then raise exception 'SRI_MANUAL_RECEPTION_CLAIM_LOST';end if;
 perform public.sri_assert_environment_enabled(d.company_id,d.environment);
 return true;
end $$;
revoke all on function public.assert_sri_manual_reception_claim(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_sri_manual_reception_claim(uuid,text,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.claim_sri_manual_authorization(p_transmission_id uuid, p_worker_id text, p_company_id uuid, p_document_id uuid, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d public.electronic_documents%rowtype;
  j public.sri_transmissions%rowtype;
  a public.sri_transmission_attempts%rowtype;
  previous_claim public.electronic_document_audit_logs%rowtype;
  previous_attempt public.sri_transmission_attempts%rowtype;
  claimed_time timestamptz;
  cooldown_time timestamptz;
  manual_number integer;
  was_expired boolean := false;
  abandoned record;
begin
  perform public.erp_sri_assert_transport_actor(p_company_id,p_actor_user_id);
  if p_worker_id is null or p_worker_id !~ '^manual-auth-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='SRI_MANUAL_AUTHORIZATION_WORKER_REQUIRED';
  end if;
  select * into d from public.electronic_documents
    where company_id=p_company_id and id=p_document_id for update;
  if not found then raise exception using errcode='P0002',message='SRI_DOCUMENT_NOT_FOUND'; end if;
  select * into j from public.sri_transmissions
    where id=p_transmission_id and company_id=d.company_id and document_id=d.id for update;
  if not found then raise exception using errcode='P0002',message='SRI_TRANSMISSION_NOT_FOUND'; end if;
  if d.document_type not in ('01','04','07') or d.status not in ('ENVIADO_SRI','RECIBIDO_SRI','PENDIENTE_REINTENTO','ERROR_ENVIO','DEVUELTO','NO_AUTORIZADO')
    or j.transmission_type<>'AUTHORIZATION_QUERY' or j.environment<>d.environment
    or j.idempotency_key<>d.id::text||':AUTHORIZATION_QUERY'
    or j.endpoint_url<>(case d.environment
      when 'PRODUCTION' then 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
      when 'TEST' then 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline' else '' end)
    or exists(select 1 from public.sri_authorizations where company_id=d.company_id and document_id=d.id) then
    raise exception using errcode='23514',message='SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE';
  end if;
  if exists(select 1 from public.erp_sri_document_management where company_id=d.company_id and document_id=d.id and correction_in_progress) then raise exception 'SRI_MANAGER_CORRECTION_IN_PROGRESS'; end if;
  perform public.sri_assert_environment_enabled(d.company_id,d.environment);
  perform public.sri_assert_document_routing(d.company_id,d.environment,d.emission_point_id,d.document_type);
  -- Only an audited manual reception beyond the 120s runtime + 60s margin is reclaimable.
  for abandoned in select t.id,t.worker_id,t.claimed_at,ta.id attempt_id from public.sri_transmissions t
    join public.sri_transmission_attempts ta on ta.transmission_id=t.id and ta.status='STARTED'
    join public.electronic_document_audit_logs e on e.document_id=t.document_id and e.company_id=t.company_id
      and e.action='SRI_MANUAL_SAME_DOCUMENT_RETRY' and e.new_values->>'attempt_id'=ta.id::text
      and e.new_values->>'worker_id'=t.worker_id and e.new_values->>'claimed_at'=to_jsonb(t.claimed_at)#>>'{}'
    where t.document_id=d.id and t.company_id=d.company_id and t.transmission_type='RECEPTION'
      and t.status='PROCESSING' and t.worker_id like 'manual-reception-%' and t.claimed_at<=clock_timestamp()-interval '180 seconds'
    for update of t,ta
  loop
    update public.sri_transmission_attempts set status='FAILED',retryable=false,error_class='SRI_TRANSPORT_RESULT_UNCERTAIN',
      error_message='Claim de recepción manual vencido; consultar autorización antes de cualquier reenvío.',finished_at=clock_timestamp() where id=abandoned.attempt_id;
    update public.sri_transmissions set status='FAILED',next_attempt_at=null,error_class='SRI_TRANSPORT_RESULT_UNCERTAIN',
      error_message='Recepción manual vencida; resultado incierto.',finished_at=clock_timestamp() where id=abandoned.id;
    insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,reason,new_values)
      values(d.company_id,d.id,p_actor_user_id,'USER','SRI_MANUAL_RECEPTION_EXPIRED','Lease manual vencido; se recupera exclusivamente para consulta de autorización.',
      jsonb_build_object('transmission_id',abandoned.id,'attempt_id',abandoned.attempt_id,'worker_id',abandoned.worker_id,'reception_resends',0));
  end loop;
  if exists(select 1 from public.sri_transmissions
    where document_id=d.id and id<>j.id and status='PROCESSING') then
    raise exception using errcode='55P03',message='SRI_TRANSMISSION_ALREADY_PROCESSING',hint='{"retryAfterSeconds":5}';
  end if;
  if j.status='PROCESSING' then
    -- Only claims created and audited by THIS manual RPC may expire here.
    -- Legacy/automatic PROCESSING is never inferred to be abandoned.
    select * into previous_claim from public.electronic_document_audit_logs
      where company_id=d.company_id and document_id=d.id and action='SRI_MANUAL_AUTHORIZATION_CLAIMED'
        and new_values->>'transmission_id'=j.id::text and new_values->>'worker_id'=j.worker_id
        and new_values->>'claimed_at'=to_jsonb(j.claimed_at)#>>'{}'
      order by created_at desc,id desc limit 1;
    select * into previous_attempt from public.sri_transmission_attempts
      where company_id=d.company_id and document_id=d.id and transmission_id=j.id
        and id::text=previous_claim.new_values->>'attempt_id' and status='STARTED' for update;
    if previous_claim.id is null or previous_attempt.id is null or j.claimed_at is null
      or previous_attempt.attempt_number<=j.attempt_number
      or j.claimed_at>clock_timestamp()-interval '180 seconds' then
      raise exception using errcode='55P03',message='SRI_TRANSMISSION_ALREADY_PROCESSING',hint='{"retryAfterSeconds":5}';
    end if;
    if exists(select 1 from public.sri_transmission_attempts
      where transmission_id=j.id and status='STARTED' and id<>previous_attempt.id) then
      raise exception using errcode='55P03',message='SRI_TRANSMISSION_ALREADY_PROCESSING',hint='{"retryAfterSeconds":5}';
    end if;
    update public.sri_transmission_attempts set status='FAILED',retryable=false,
      error_class='SRI_TRANSPORT_RESULT_UNCERTAIN',error_message='La consulta manual excedio su plazo de ejecucion; debe consultarse la misma clave.',
      finished_at=clock_timestamp() where id=previous_attempt.id;
    insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,reason,old_values,new_values)
      values(d.company_id,d.id,p_actor_user_id,'USER','SRI_MANUAL_AUTHORIZATION_EXPIRED',
        'Claim manual vencido despues del limite de ejecucion de 120 segundos y 60 segundos de margen; sin reenvio.',
        jsonb_build_object('transmission_id',j.id,'worker_id',j.worker_id,'claimed_at',j.claimed_at,'attempt_id',previous_attempt.id),
        jsonb_build_object('access_key',d.access_key,'sequential',d.sequential,'reception_resends',0));
    was_expired:=true;
  elsif j.status not in ('FAILED','PENDING','RETRY_SCHEDULED','COMPLETED') then
    raise exception using errcode='23514',message='SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE';
  end if;
  if j.next_attempt_at is not null and j.next_attempt_at>clock_timestamp() then
    raise exception using errcode='P0001',message='SRI_MANAGER_WAIT_SCHEDULED',hint=j.next_attempt_at::text;
  end if;
  if not was_expired and exists(select 1 from public.sri_transmission_attempts where transmission_id=j.id and status='STARTED') then
    raise exception using errcode='55P03',message='SRI_TRANSMISSION_ALREADY_PROCESSING',hint='{"retryAfterSeconds":5}';
  end if;
  cooldown_time:=greatest(j.finished_at,j.claimed_at);

  if cooldown_time>clock_timestamp()-interval '30 seconds' and not exists(
    select 1 from public.sri_transmissions t join public.electronic_document_audit_logs e
      on e.document_id=t.document_id and e.company_id=t.company_id and e.action='SRI_MANUAL_SAME_DOCUMENT_RETRY'
      and e.new_values->>'worker_id'=t.worker_id
    join public.sri_transmission_attempts ta on ta.id::text=e.new_values->>'attempt_id' and ta.transmission_id=t.id
    where t.document_id=d.id and t.transmission_type='RECEPTION' and t.status='COMPLETED' and ta.status='SUCCEEDED'
      and t.finished_at>cooldown_time and ta.finished_at>cooldown_time
  ) then
    raise exception using errcode='P0001',message='SRI_MANAGER_WAIT_SCHEDULED',
      hint=jsonb_build_object('retryAfterSeconds',greatest(1,ceil(extract(epoch from cooldown_time+interval '30 seconds'-clock_timestamp()))))::text;
  end if;
  select greatest(coalesce(max(attempt_number),0),j.attempt_number)+1 into manual_number
    from public.sri_transmission_attempts where transmission_id=j.id;
  claimed_time:=clock_timestamp();
  update public.sri_transmissions set status='PROCESSING',worker_id=p_worker_id,claimed_at=claimed_time,
    finished_at=null,next_attempt_at=null,error_class=null,error_message=null where id=j.id returning * into j;
  insert into public.sri_transmission_attempts(company_id,document_id,transmission_id,attempt_number,status,endpoint_url,request_sha256,started_at)
    values(d.company_id,d.id,j.id,manual_number,'STARTED',j.endpoint_url,
      encode(sha256(convert_to(d.access_key,'UTF8')),'hex'),claimed_time) returning * into a;
  insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,reason,new_values)
    values(d.company_id,d.id,p_actor_user_id,'USER','SRI_MANUAL_AUTHORIZATION_CLAIMED',
      'Consulta humana de autorizacion con la misma clave; presupuesto automatico agotado preservado.',
      jsonb_build_object('transmission_id',j.id,'worker_id',j.worker_id,'claimed_at',j.claimed_at,'attempt_id',a.id,
        'attempt_number',a.attempt_number,'automatic_attempt_number',j.attempt_number,'max_attempts',j.max_attempts,
        'access_key',d.access_key,'sequential',d.sequential,'environment',d.environment,'lease_seconds',180,'reception_resends',0));
  return to_jsonb(j)||jsonb_build_object('manual_recovery',true,'claim_attempt',to_jsonb(a));
end $function$
;
revoke all on function public.claim_sri_manual_authorization(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_sri_manual_authorization(uuid,text,uuid,uuid,uuid) to service_role;
commit;
