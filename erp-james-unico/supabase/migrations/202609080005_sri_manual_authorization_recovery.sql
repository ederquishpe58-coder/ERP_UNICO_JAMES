begin;

-- A finished AUTHORIZATION_QUERY can exhaust its automatic budget while the SRI
-- still returns no authorization. An explicit human lookup may use the SAME job
-- and key without resetting that budget or making reception eligible again.
-- No existing rows are changed by applying this migration.
-- Rollback: restore the previous application, let all in-flight manual lookups
-- finish, then restore the captured previous claim_sri_transmission definition.
-- Drop only settle_sri_manual_authorization, assert_sri_manual_authorization_claim
-- and claim_sri_manual_authorization (in that order). Preserve every document,
-- transmission, attempt and audit row; rollback performs no job-data reset.
create or replace function public.claim_sri_manual_authorization(
  p_transmission_id uuid, p_worker_id text, p_company_id uuid,
  p_document_id uuid, p_actor_user_id uuid
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
  if d.document_type<>'07' or d.status not in ('ENVIADO_SRI','RECIBIDO_SRI','PENDIENTE_REINTENTO','ERROR_ENVIO')
    or j.transmission_type<>'AUTHORIZATION_QUERY' or j.environment<>d.environment
    or j.idempotency_key<>d.id::text||':AUTHORIZATION_QUERY'
    or j.endpoint_url<>(case d.environment
      when 'PRODUCTION' then 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
      when 'TEST' then 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline' else '' end)
    or exists(select 1 from public.sri_authorizations where company_id=d.company_id and document_id=d.id) then
    raise exception using errcode='23514',message='SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE';
  end if;
  perform public.sri_assert_environment_enabled(d.company_id,d.environment);
  perform public.sri_assert_document_routing(d.company_id,d.environment,d.emission_point_id,d.document_type);
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
  elsif j.status<>'FAILED' or j.error_class is distinct from 'SRI_TRANSPORT_RESULT_UNCERTAIN' then
    raise exception using errcode='23514',message='SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE';
  end if;
  if j.attempt_number<j.max_attempts or j.attempt_number<1 then
    raise exception using errcode='23514',message='SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE';
  end if;
  if not was_expired and exists(select 1 from public.sri_transmission_attempts where transmission_id=j.id and status='STARTED') then
    raise exception using errcode='55P03',message='SRI_TRANSMISSION_ALREADY_PROCESSING',hint='{"retryAfterSeconds":5}';
  end if;
  cooldown_time:=greatest(j.finished_at,j.claimed_at);
  if cooldown_time is null then
    raise exception using errcode='23514',message='SRI_MANUAL_AUTHORIZATION_NOT_ELIGIBLE';
  end if;
  if cooldown_time>clock_timestamp()-interval '30 seconds' then
    raise exception using errcode='55P03',message='SRI_MANUAL_AUTHORIZATION_COOLDOWN',
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
end $$;

-- A fencing check for the owned manual attempt. This does not keep a transaction
-- open across a network call; the service checks before and after SRI and before
-- persisting an official response. Settlement repeats the check atomically.
create or replace function public.assert_sri_manual_authorization_claim(
  p_transmission_id uuid,p_worker_id text,p_attempt_id uuid,p_actor_user_id uuid
)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  identity_row public.sri_transmissions%rowtype;
  d public.electronic_documents%rowtype;
  j public.sri_transmissions%rowtype;
  a public.sri_transmission_attempts%rowtype;
begin
  select * into identity_row from public.sri_transmissions where id=p_transmission_id;
  if not found then raise exception using errcode='P0002',message='SRI_TRANSMISSION_NOT_FOUND'; end if;
  perform public.erp_sri_assert_transport_actor(identity_row.company_id,p_actor_user_id);
  select * into d from public.electronic_documents where company_id=identity_row.company_id and id=identity_row.document_id for update;
  select * into j from public.sri_transmissions where id=p_transmission_id and company_id=d.company_id and document_id=d.id for update;
  select * into a from public.sri_transmission_attempts
    where id=p_attempt_id and company_id=d.company_id and document_id=d.id and transmission_id=j.id for update;
  if d.id is null or d.document_type<>'07' or j.id is null or j.status<>'PROCESSING'
    or j.transmission_type<>'AUTHORIZATION_QUERY' or j.environment<>d.environment
    or j.idempotency_key<>d.id::text||':AUTHORIZATION_QUERY'
    or j.endpoint_url<>(case d.environment
      when 'PRODUCTION' then 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
      when 'TEST' then 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline' else '' end)
    or p_worker_id is null or j.worker_id is distinct from p_worker_id
    or j.claimed_at is null or j.claimed_at<=clock_timestamp()-interval '180 seconds' or j.claimed_at>clock_timestamp()
    or a.id is null or a.status<>'STARTED' or a.attempt_number<=j.attempt_number
    or a.endpoint_url<>j.endpoint_url or a.request_sha256<>encode(sha256(convert_to(d.access_key,'UTF8')),'hex')
    or exists(select 1 from public.sri_transmission_attempts where transmission_id=j.id and attempt_number>a.attempt_number)
    or not exists(select 1 from public.electronic_document_audit_logs
      where company_id=d.company_id and document_id=d.id and actor_user_id=p_actor_user_id
        and action='SRI_MANUAL_AUTHORIZATION_CLAIMED' and new_values->>'transmission_id'=j.id::text
        and new_values->>'worker_id'=j.worker_id and new_values->>'attempt_id'=a.id::text
        and new_values->>'claimed_at'=to_jsonb(j.claimed_at)#>>'{}') then
    raise exception using errcode='55000',message='SRI_MANUAL_AUTHORIZATION_CLAIM_LOST';
  end if;
  perform public.sri_assert_environment_enabled(d.company_id,d.environment);
  return true;
end $$;

create or replace function public.settle_sri_manual_authorization(
  p_transmission_id uuid,p_worker_id text,p_attempt_id uuid,p_actor_user_id uuid,
  p_success boolean,p_response_sha256 text,p_http_status integer,p_error_class text,p_error_message text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  j public.sri_transmissions%rowtype;
  settled_time timestamptz;
begin
  perform public.assert_sri_manual_authorization_claim(p_transmission_id,p_worker_id,p_attempt_id,p_actor_user_id);
  select * into j from public.sri_transmissions where id=p_transmission_id;
  if p_success is null or (p_http_status is not null and p_http_status not between 100 and 599)
    or (p_response_sha256 is not null and p_response_sha256 !~ '^[0-9a-f]{64}$')
    or (not p_success and (p_error_class is null or p_error_class !~ '^SRI_[A-Z0-9_]{1,120}$')) then
    raise exception using errcode='22023',message='SRI_MANUAL_AUTHORIZATION_SETTLEMENT_INVALID';
  end if;
  if p_success and (p_response_sha256 is null or p_http_status is distinct from 200
    or not exists(select 1 from public.sri_responses r join public.electronic_documents d on d.id=r.document_id
      where r.company_id=j.company_id and r.document_id=j.document_id and r.transmission_id=j.id
        and r.response_type='AUTHORIZATION' and r.content_sha256=p_response_sha256
        and r.sri_status in ('AUTORIZADO','NO AUTORIZADO','NO_AUTORIZADO')
        and d.status in ('AUTORIZADO','NO_AUTORIZADO'))) then
    raise exception using errcode='23514',message='SRI_MANUAL_AUTHORIZATION_OFFICIAL_RESPONSE_REQUIRED';
  end if;
  settled_time:=clock_timestamp();
  update public.sri_transmission_attempts set status=case when p_success then 'SUCCEEDED' else 'FAILED' end,
    response_sha256=p_response_sha256,http_status=p_http_status,retryable=false,
    error_class=case when p_success then null else p_error_class end,
    error_message=case when p_success then null else left(coalesce(p_error_message,''),2000) end,
    finished_at=settled_time where id=p_attempt_id;
  update public.sri_transmissions set status=case when p_success then 'COMPLETED' else 'FAILED' end,
    next_attempt_at=null,http_status=p_http_status,finished_at=settled_time,
    error_class=case when p_success then null else p_error_class end,
    error_message=case when p_success then null else left(coalesce(p_error_message,''),2000) end
    where id=j.id returning * into j;
  insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,reason,new_values)
    values(j.company_id,j.document_id,p_actor_user_id,'USER','SRI_MANUAL_AUTHORIZATION_SETTLED',
      'Consulta manual cerrada sin reenvio ni ampliacion del presupuesto automatico.',
      jsonb_build_object('transmission_id',j.id,'worker_id',p_worker_id,'attempt_id',p_attempt_id,
        'success',p_success,'automatic_attempt_number',j.attempt_number,'max_attempts',j.max_attempts,
        'response_sha256',p_response_sha256,'error_class',j.error_class,'reception_resends',0));
  return to_jsonb(j)||jsonb_build_object('manual_recovery',true);
end $$;

revoke all on function public.claim_sri_manual_authorization(uuid,text,uuid,uuid,uuid),
  public.assert_sri_manual_authorization_claim(uuid,text,uuid,uuid),
  public.settle_sri_manual_authorization(uuid,text,uuid,uuid,boolean,text,integer,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_sri_manual_authorization(uuid,text,uuid,uuid,uuid),
  public.assert_sri_manual_authorization_claim(uuid,text,uuid,uuid),
  public.settle_sri_manual_authorization(uuid,text,uuid,uuid,boolean,text,integer,text,text) to service_role;

-- Keep the existing automatic budget/status contract. Serialize the short claim
-- transaction on the document first, so reception and authorization cannot both
-- own active work for the same document. Other documents do not share this lock.
create or replace function public.claim_sri_transmission(p_transmission_id uuid,p_worker_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  identity_row public.sri_transmissions%rowtype;
  v_transmission public.sri_transmissions%rowtype;
begin
  if p_worker_id is null or btrim(p_worker_id)='' then
    raise exception using errcode='22023',message='SRI_WORKER_ID_REQUIRED';
  end if;
  select * into identity_row from public.sri_transmissions where id=p_transmission_id;
  if not found then raise exception using errcode='P0002',message='SRI_TRANSMISSION_NOT_FOUND'; end if;
  perform 1 from public.electronic_documents
    where company_id=identity_row.company_id and id=identity_row.document_id for update;
  if not found then raise exception using errcode='P0002',message='SRI_DOCUMENT_NOT_FOUND'; end if;
  select * into v_transmission from public.sri_transmissions
    where id=p_transmission_id and company_id=identity_row.company_id and document_id=identity_row.document_id for update;
  if not found then raise exception using errcode='P0002',message='SRI_TRANSMISSION_NOT_FOUND'; end if;
  if v_transmission.status not in ('PENDING','RETRY_SCHEDULED') then
    raise exception using errcode='55P03',message='SRI_TRANSMISSION_NOT_CLAIMABLE';
  end if;
  if exists(select 1 from public.sri_transmissions
    where document_id=v_transmission.document_id and id<>v_transmission.id and status='PROCESSING') then
    raise exception using errcode='55P03',message='SRI_TRANSMISSION_ALREADY_PROCESSING',hint='{"retryAfterSeconds":5}';
  end if;
  if v_transmission.next_attempt_at is not null and v_transmission.next_attempt_at>now() then
    raise exception using errcode='55P03',message='SRI_TRANSMISSION_NOT_DUE';
  end if;
  if v_transmission.attempt_number>=v_transmission.max_attempts then
    raise exception using errcode='23514',message='SRI_TRANSMISSION_ATTEMPTS_EXHAUSTED';
  end if;
  perform public.sri_assert_environment_enabled(v_transmission.company_id,v_transmission.environment);
  update public.sri_transmissions set status='PROCESSING',attempt_number=attempt_number+1,
    worker_id=left(p_worker_id,200),claimed_at=now(),finished_at=null,error_class=null,error_message=null
    where id=p_transmission_id returning * into v_transmission;
  return to_jsonb(v_transmission);
end $$;

notify pgrst,'reload schema';
commit;
