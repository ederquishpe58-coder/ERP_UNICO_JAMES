begin;
-- Additive manager metadata only. Existing fiscal rows are not backfilled.
create table if not exists public.erp_sri_document_management (
 company_id uuid not null references public.companies(id), document_id uuid primary key references public.electronic_documents(id),
 automatic_paused boolean not null default false, correction_in_progress boolean not null default false,
 revision bigint not null default 1, version bigint not null default 0,
 updated_at timestamptz not null default clock_timestamp(), updated_by uuid references auth.users(id),
 unique(company_id,document_id)
);
create table if not exists public.erp_sri_document_manager_events (
 operation_id uuid primary key, company_id uuid not null references public.companies(id),document_id uuid not null references public.electronic_documents(id),
 action text not null check(action in ('PAUSE','RESUME','CORRECT','CORRECTION_FINISHED','EXTERNAL_EVIDENCE','CANCELLATION_REQUESTED')),
 actor_user_id uuid not null references auth.users(id), reason text not null,request_hash text not null,
 before_state jsonb not null default '{}',after_state jsonb not null default '{}',evidence jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
alter table public.erp_sri_document_management enable row level security;
alter table public.erp_sri_document_manager_events enable row level security;
revoke all on public.erp_sri_document_management,public.erp_sri_document_manager_events from public,anon,authenticated;
grant select,insert,update on public.erp_sri_document_management,public.erp_sri_document_manager_events to service_role;
-- Independent capabilities, no profile or user grants are changed.
insert into public.erp_security_capabilities(capability_id,module,resource,action,description,risk_level,active) values
 ('commercial.electronic_documents.validate','commercial','electronic_documents','validate','Validar comprobantes SRI sin transmitir','LOW',true),
 ('commercial.electronic_documents.reconcile','commercial','electronic_documents','reconcile','Registrar evidencia externa y verificar autorización SRI','HIGH',true)
on conflict(capability_id) do nothing;

create or replace function public.erp_sri_manager_control(p_company_id uuid,p_document_id uuid,p_action text,p_operation_id uuid,p_expected_version bigint,p_reason text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $manager$
declare d public.electronic_documents%rowtype;m public.erp_sri_document_management%rowtype; prior public.erp_sri_document_manager_events%rowtype;
 h text; before_value jsonb; cap text;
begin
 cap:=case p_action when 'PAUSE' then 'commercial.electronic_documents.authorize' when 'RESUME' then 'commercial.electronic_documents.authorize' else null end;
 if cap is null then raise exception 'SRI_MANAGER_ACTION_INVALID';end if;
 perform public.erp_sri_config_assert_access(p_company_id,cap);
 if p_operation_id is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 or p_payload is distinct from '{}'::jsonb then raise exception 'SRI_MANAGER_REQUEST_INVALID';end if;
 select * into d from public.electronic_documents where company_id=p_company_id and id=p_document_id and document_type in('01','04','07') for update;
 if not found then raise exception 'SRI_DOCUMENT_NOT_FOUND';end if;
 h:=encode(sha256(convert_to(jsonb_build_object('company',p_company_id,'document',p_document_id,'actor',auth.uid(),'action',p_action,'version',p_expected_version,'reason',p_reason)::text,'UTF8')),'hex');
 select * into prior from public.erp_sri_document_manager_events where operation_id=p_operation_id;
 if found then
  if prior.request_hash<>h or prior.company_id<>p_company_id or prior.document_id<>p_document_id or prior.actor_user_id<>auth.uid() then raise exception 'SRI_MANAGER_OPERATION_CONFLICT';end if;
  return jsonb_build_object('ok',true,'reused',true,'management',prior.after_state);
 end if;
 select * into m from public.erp_sri_document_management where document_id=d.id;
 if coalesce(m.version,0) is distinct from p_expected_version then raise exception 'SRI_MANAGER_STALE_VERSION';end if;
 if d.status in('AUTORIZADO','ANULADO') or coalesce(m.correction_in_progress,false) or exists(select 1 from public.sri_transmissions where document_id=d.id and status='PROCESSING') then raise exception 'SRI_MANAGER_ACTION_NOT_ELIGIBLE';end if;
 before_value:=coalesce(to_jsonb(m),'{}');
 if coalesce(m.automatic_paused,false)=(p_action='PAUSE') then return jsonb_build_object('ok',true,'reused',true,'management',before_value);end if;
 insert into public.erp_sri_document_management(company_id,document_id,automatic_paused,version,updated_by)
 values(d.company_id,d.id,p_action='PAUSE',1,auth.uid()) on conflict(document_id) do update
 set automatic_paused=excluded.automatic_paused,version=erp_sri_document_management.version+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into m;
 insert into public.erp_sri_document_manager_events(operation_id,company_id,document_id,action,actor_user_id,reason,request_hash,before_state,after_state)
 values(p_operation_id,d.company_id,d.id,p_action,auth.uid(),btrim(p_reason),h,before_value,to_jsonb(m));
 return jsonb_build_object('ok',true,'reused',false,'management',to_jsonb(m));
end $manager$;
revoke all on function public.erp_sri_manager_control(uuid,uuid,text,uuid,bigint,text,jsonb) from public,anon,service_role;
grant execute on function public.erp_sri_manager_control(uuid,uuid,text,uuid,bigint,text,jsonb) to authenticated;
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

  if cooldown_time>clock_timestamp()-interval '30 seconds' then
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
end $function$;
CREATE OR REPLACE FUNCTION public.assert_sri_manual_authorization_claim(p_transmission_id uuid, p_worker_id text, p_attempt_id uuid, p_actor_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if d.id is null or d.document_type not in ('01','04','07') or j.id is null or j.status<>'PROCESSING'
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
end $function$;
CREATE OR REPLACE FUNCTION public.claim_sri_transmission(p_transmission_id uuid, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if exists(select 1 from public.erp_sri_document_management where company_id=identity_row.company_id and document_id=identity_row.document_id and (automatic_paused or correction_in_progress)) then
    raise exception using errcode='P0001',message='SRI_MANAGER_MANUAL_REVIEW_REQUIRED';
  end if;
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
end $function$;
-- Canonical, bounded scheduler read: paused documents do not starve other jobs.
create or replace function public.erp_sri_manager_due_jobs(p_limit integer default 25)
returns setof public.sri_transmissions language sql stable security definer set search_path=public,pg_temp as $$
 select t.* from public.sri_transmissions t where t.status in('PENDING','RETRY_SCHEDULED')
 and t.next_attempt_at<=now() and t.attempt_number<t.max_attempts
 and not exists(select 1 from public.erp_sri_document_management m where m.document_id=t.document_id and (m.automatic_paused or m.correction_in_progress))
 order by t.next_attempt_at,t.id limit greatest(1,least(coalesce(p_limit,25),25));
$$;
revoke all on function public.erp_sri_manager_due_jobs(integer) from public,anon,authenticated;
grant execute on function public.erp_sri_manager_due_jobs(integer) to service_role;

create or replace function public.erp_sri_manager_list(p_company_id uuid,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare k text;v jsonb;offset_value integer:=0;result jsonb;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'commercial.electronic_documents.view');
 if jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'SRI_MANAGER_FILTER_INVALID';end if;
 for k,v in select * from jsonb_each(p_filters) loop
  if k not in('environment','documentType','status','sriStatus','group','series','sequential','accessKey','party','from','to','offset') or jsonb_typeof(v) not in('string','number','null') or length(coalesce(v#>>'{}',''))>150 then raise exception 'SRI_MANAGER_FILTER_INVALID';end if;
 end loop;
 if nullif(p_filters->>'environment','') is not null and p_filters->>'environment' not in('TEST','PRODUCTION') then raise exception 'SRI_MANAGER_ENVIRONMENT_INVALID';end if;
 if nullif(p_filters->>'documentType','') is not null and p_filters->>'documentType' not in('01','04','07') then raise exception 'SRI_MANAGER_DOCUMENT_TYPE_INVALID';end if;
 if nullif(p_filters->>'series','') is not null and p_filters->>'series'!~'^\d{3}-\d{3}$' then raise exception 'SRI_MANAGER_SERIES_INVALID';end if;
 if nullif(p_filters->>'sequential','') is not null and p_filters->>'sequential'!~'^\d{1,9}$' then raise exception 'SRI_MANAGER_SEQUENTIAL_INVALID';end if;
 if nullif(p_filters->>'accessKey','') is not null and p_filters->>'accessKey'!~'^\d{49}$' then raise exception 'SRI_MANAGER_ACCESS_KEY_INVALID';end if;
 offset_value:=coalesce(nullif(p_filters->>'offset','')::integer,0);
 if offset_value<0 then raise exception 'SRI_MANAGER_OFFSET_INVALID';end if;
 with matched as materialized(
 select d.id,d.company_id,d.environment,d.document_type,d.full_number,d.sequential,d.issue_date,d.status,d.access_key,d.buyer_snapshot,d.last_error,d.authorization_number,d.authorized_at,d.updated_at,latest.sri_status
 from public.electronic_documents d left join lateral(select r.sri_status from public.sri_responses r where r.company_id=d.company_id and r.document_id=d.id order by r.received_at desc,r.id desc limit 1)latest on true
 where d.company_id=p_company_id and d.document_type in('01','04','07')
 and (nullif(p_filters->>'environment','') is null or d.environment=p_filters->>'environment')
 and (nullif(p_filters->>'documentType','') is null or d.document_type=p_filters->>'documentType')
 and (nullif(p_filters->>'status','') is null or d.status=p_filters->>'status')
 and (nullif(p_filters->>'sriStatus','') is null or latest.sri_status=p_filters->>'sriStatus')
 and (nullif(p_filters->>'series','') is null or d.establishment_code||'-'||d.emission_point_code=p_filters->>'series')
 and (nullif(p_filters->>'sequential','') is null or d.sequential=nullif(p_filters->>'sequential','')::bigint)
 and (nullif(p_filters->>'accessKey','') is null or d.access_key=p_filters->>'accessKey')
 and (nullif(p_filters->>'party','') is null or strpos(lower(coalesce(d.buyer_snapshot->>'legalName','')||' '||coalesce(d.buyer_snapshot->>'identification','')),lower(p_filters->>'party'))>0)
 and (nullif(p_filters->>'from','') is null or d.issue_date>=nullif(p_filters->>'from','')::date)
 and (nullif(p_filters->>'to','') is null or d.issue_date<=nullif(p_filters->>'to','')::date)
 and (case coalesce(p_filters->>'group','') when 'PENDING' then d.status in('ENVIADO_SRI','RECIBIDO_SRI','PENDIENTE_REINTENTO','ERROR_ENVIO') when 'ERRORS' then d.status in('DEVUELTO','NO_AUTORIZADO','PENDIENTE_REINTENTO','ERROR_ENVIO') when 'AUTHORIZED' then d.status='AUTORIZADO' else true end)
 ), page as(select * from matched order by issue_date desc,id desc limit 50 offset offset_value)
 select jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(p) order by p.issue_date desc,p.id desc),'[]') from page p),'total',(select count(*) from matched),'limit',50,'offset',offset_value) into result;
 return result;
end $$;
revoke all on function public.erp_sri_manager_list(uuid,jsonb) from public,anon,service_role;
grant execute on function public.erp_sri_manager_list(uuid,jsonb) to authenticated;


create or replace function public.erp_sri_manager_record_evidence(p_company_id uuid,p_document_id uuid,p_operation_id uuid,p_reason text,p_access_key text,p_authorization_number text,p_evidence_sha256 text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.electronic_documents%rowtype;e public.erp_sri_document_manager_events%rowtype;h text;v jsonb;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'commercial.electronic_documents.reconcile');
 select * into d from public.electronic_documents where company_id=p_company_id and id=p_document_id for update;
 if not found then raise exception 'SRI_DOCUMENT_NOT_FOUND';end if;
 if p_operation_id is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 or p_access_key is distinct from d.access_key or p_authorization_number is distinct from d.access_key
 or (p_evidence_sha256 is not null and p_evidence_sha256!~'^[0-9a-f]{64}$') then raise exception 'SRI_MANAGER_EVIDENCE_IDENTITY_MISMATCH';end if;
 h:=encode(sha256(convert_to(jsonb_build_array(p_company_id,p_document_id,auth.uid(),p_reason,p_access_key,p_authorization_number,p_evidence_sha256)::text,'UTF8')),'hex');
 select * into e from public.erp_sri_document_manager_events where operation_id=p_operation_id;
 if found then if e.request_hash is distinct from h then raise exception 'SRI_MANAGER_OPERATION_CONFLICT';end if;return jsonb_build_object('ok',true,'reused',true);end if;
 -- User evidence is not a state mutation. Only the existing canonical SRI engine
 -- may have reconciled this document after its official lookup.
 v:=jsonb_build_object('state',d.status,'authorizationNumber',d.authorization_number,'officiallyReconciled',d.status='AUTORIZADO' and exists(select 1 from public.sri_authorizations a where a.company_id=d.company_id and a.document_id=d.id and a.authorization_number=d.access_key));
 insert into public.erp_sri_document_manager_events(operation_id,company_id,document_id,action,actor_user_id,reason,request_hash,before_state,after_state,evidence)
 values(p_operation_id,d.company_id,d.id,'EXTERNAL_EVIDENCE',auth.uid(),p_reason,h,v,v,jsonb_build_object('accessKey',p_access_key,'authorizationNumber',p_authorization_number,'sha256',p_evidence_sha256));
 return jsonb_build_object('ok',true,'reused',false,'result',v);
end $$;
revoke all on function public.erp_sri_manager_record_evidence(uuid,uuid,uuid,text,text,text,text) from public,anon,service_role;
grant execute on function public.erp_sri_manager_record_evidence(uuid,uuid,uuid,text,text,text,text) to authenticated;

create or replace function public.erp_sri_manager_commit_correction(p_company_id uuid,p_document_id uuid,p_actor_user_id uuid,p_operation_id uuid,p_expected_version bigint,p_expected_updated_at timestamptz,p_reason text,p_fields jsonb,p_certificate_id uuid,p_artifacts jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.electronic_documents%rowtype;n public.electronic_documents%rowtype;m public.erp_sri_document_management%rowtype;e public.erp_sri_document_manager_events%rowtype;
 f jsonb;k text;v jsonb;h text;old_files jsonb;file_ids jsonb;row_id uuid;
begin
 perform public.sri_assert_service_actor_capability(p_company_id,p_actor_user_id,'commercial.electronic_documents.correct');
 if p_operation_id is null or p_expected_version is null or p_expected_updated_at is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500
 or jsonb_typeof(p_fields) is distinct from 'object' or p_fields='{}' then raise exception 'SRI_MANAGER_CORRECTION_INVALID';end if;
 for k,v in select * from jsonb_each(p_fields) loop
  if k not in('buyerAddress','notes') or jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 300 or (v#>>'{}')~'[[:cntrl:]]' then raise exception 'SRI_MANAGER_FIELD_NOT_EDITABLE';end if;
 end loop;
 select * into d from public.electronic_documents where company_id=p_company_id and id=p_document_id for update;
 if not found then raise exception 'SRI_DOCUMENT_NOT_FOUND';end if;
 h:=encode(sha256(convert_to(jsonb_build_array(p_company_id,p_document_id,p_actor_user_id,p_expected_version,p_expected_updated_at,p_reason,p_fields)::text,'UTF8')),'hex');
 select * into e from public.erp_sri_document_manager_events where operation_id=p_operation_id;
 if found then if e.request_hash is distinct from h then raise exception 'SRI_MANAGER_OPERATION_CONFLICT';end if;return jsonb_build_object('ok',true,'reused',true);end if;
 select * into m from public.erp_sri_document_management where document_id=d.id;
 if d.updated_at is distinct from p_expected_updated_at or coalesce(m.version,0)<>p_expected_version then raise exception 'SRI_MANAGER_STALE_VERSION';end if;
 if d.document_type not in('01','04','07') or d.status not in('BORRADOR','VALIDADO','XML_GENERADO','FIRMADO')
 or exists(select 1 from public.sri_transmissions where document_id=d.id)
 or exists(select 1 from public.sri_transmission_attempts where document_id=d.id)
 or exists(select 1 from public.sri_responses where document_id=d.id)
 or exists(select 1 from public.sri_authorizations where document_id=d.id) then raise exception 'SRI_MANAGER_CORRECTION_NOT_ELIGIBLE';end if;
 perform public.sri_assert_environment_enabled(d.company_id,d.environment);
 perform public.sri_assert_document_routing(d.company_id,d.environment,d.emission_point_id,d.document_type);
 if not exists(select 1 from public.digital_certificates c join public.companies co on co.id=c.company_id where c.id=p_certificate_id and c.company_id=d.company_id and c.subject_ruc=co.tax_id and c.active and c.validation_status='VALID' and c.valid_from<=clock_timestamp() and c.valid_until>clock_timestamp()) then raise exception 'SRI_MANAGER_CERTIFICATE_INVALID';end if;
 n:=d;
 if p_fields?'buyerAddress' then
  if d.document_type='07' then raise exception 'SRI_MANAGER_FIELD_NOT_EDITABLE';end if;
  n.buyer_snapshot:=jsonb_set(n.buyer_snapshot,'{address}',p_fields->'buyerAddress');
  n.source_snapshot:=jsonb_set(n.source_snapshot,'{buyer}',coalesce(n.source_snapshot->'buyer','{}')||jsonb_build_object('address',p_fields->'buyerAddress'));
 end if;
 if p_fields?'notes' then n.source_snapshot:=jsonb_set(n.source_snapshot,'{additionalInformation}',coalesce(n.source_snapshot->'additionalInformation','{}')||jsonb_build_object('Observaciones',p_fields->'notes'));end if;
 if n.buyer_snapshot=d.buyer_snapshot and n.source_snapshot=d.source_snapshot then raise exception 'SRI_MANAGER_NO_SOURCE_CHANGE';end if;
 n.status:='FIRMADO';n.certificate_id:=p_certificate_id;n.updated_by:=p_actor_user_id;
 if jsonb_typeof(p_artifacts) is distinct from 'array' or jsonb_array_length(p_artifacts)<>4 or (select count(distinct x->>'file_type') from jsonb_array_elements(p_artifacts)x)<>4 then raise exception 'SRI_MANAGER_ARTIFACTS_REQUIRED';end if;
 for f in select * from jsonb_array_elements(p_artifacts) loop
  k:=f->>'file_type';
  if k not in('SOURCE_JSON','UNSIGNED_XML','XSD_REPORT','SIGNED_XML') or f->>'company_id' is distinct from d.company_id::text or f->>'document_id' is distinct from d.id::text
   or f->>'storage_bucket' is distinct from 'sri-private' or f->>'content_sha256' is null or f->>'content_sha256'!~'^[0-9a-f]{64}$'
   or f->>'storage_object_path' is distinct from ('companies/'||d.company_id||'/documents/'||d.id||'/'||lower(k)||'-'||(f->>'content_sha256')||(case when k in('SOURCE_JSON','XSD_REPORT') then '.json' else '.xml' end))
   or f->>'created_by' is distinct from p_actor_user_id::text or f->>'schema_version' is distinct from d.xml_version
   or (f->>'size_bytes')::bigint not between 1 and 10485760
   or not exists(select 1 from storage.objects s where s.bucket_id='sri-private' and s.name=f->>'storage_object_path') then raise exception 'SRI_MANAGER_ARTIFACT_SCOPE_INVALID';end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',file_type,'hash',content_sha256,'createdAt',created_at)),'[]') into old_files from public.electronic_document_files where company_id=d.company_id and document_id=d.id;
 insert into public.erp_sri_document_manager_events(operation_id,company_id,document_id,action,actor_user_id,reason,request_hash,before_state,after_state,evidence)
 values(p_operation_id,d.company_id,d.id,'CORRECT',p_actor_user_id,p_reason,h,to_jsonb(d),to_jsonb(n),jsonb_build_object('fields',p_fields,'expectedUpdatedAt',p_expected_updated_at,'expectedVersion',p_expected_version,'previousFiles',old_files,'newArtifacts',p_artifacts,'revision',coalesce(m.revision,1)+1));
 perform set_config('app.sri_manager_correction',p_operation_id::text,true);
 update public.electronic_documents set buyer_snapshot=n.buyer_snapshot,source_snapshot=n.source_snapshot,status=n.status,certificate_id=n.certificate_id,updated_by=p_actor_user_id where id=d.id returning * into n;
 perform set_config('app.sri_manager_correction','',true);
 for f in select * from jsonb_array_elements(p_artifacts) loop
  insert into public.electronic_document_files(company_id,document_id,file_type,storage_bucket,storage_object_path,content_type,content_sha256,size_bytes,schema_version,immutable,created_by)
  values(d.company_id,d.id,f->>'file_type','sri-private',f->>'storage_object_path',case when f->>'file_type' in('SOURCE_JSON','XSD_REPORT') then 'application/json' else 'application/xml' end,f->>'content_sha256',(f->>'size_bytes')::bigint,d.xml_version,true,p_actor_user_id)
  on conflict(document_id,file_type,content_sha256) do nothing;
 end loop;
 insert into public.erp_sri_document_management(company_id,document_id,revision,version,updated_by)
 values(d.company_id,d.id,2,1,p_actor_user_id) on conflict(document_id) do update set revision=erp_sri_document_management.revision+1,version=erp_sri_document_management.version+1,updated_by=p_actor_user_id,updated_at=clock_timestamp();
 insert into public.electronic_document_audit_logs(company_id,document_id,actor_user_id,actor_type,action,reason,old_status,new_status,old_values,new_values)
 values(d.company_id,d.id,p_actor_user_id,'USER','SRI_MANAGER_SOURCE_CORRECTED',p_reason,d.status,n.status,jsonb_build_object('buyer',d.buyer_snapshot,'source',d.source_snapshot),jsonb_build_object('operation_id',p_operation_id,'revision',coalesce(m.revision,1)+1,'fields',p_fields,'access_key',d.access_key,'sequential',d.sequential));
 return jsonb_build_object('ok',true,'reused',false,'revision',coalesce(m.revision,1)+1,'document',to_jsonb(n));
end $$;
revoke all on function public.erp_sri_manager_commit_correction(uuid,uuid,uuid,uuid,bigint,timestamptz,text,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.erp_sri_manager_commit_correction(uuid,uuid,uuid,uuid,bigint,timestamptz,text,jsonb,uuid,jsonb) to service_role;

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
  v_manager_correction boolean := false;
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
    if new.status='ENVIADO_SRI' and new.status is distinct from old.status
      and exists(select 1 from public.erp_sri_document_management m where m.document_id=old.id and m.automatic_paused)
      and not exists(select 1 from public.sri_transmissions t join public.electronic_document_audit_logs a
       on a.company_id=t.company_id and a.document_id=t.document_id and a.action='SRI_MANUAL_AUTHORIZATION_CLAIMED'
       and a.new_values->>'worker_id'=t.worker_id and a.new_values->>'transmission_id'=t.id::text
       where t.company_id=old.company_id and t.document_id=old.id and t.transmission_type='AUTHORIZATION_QUERY'
        and t.status='PROCESSING' and t.claimed_at>clock_timestamp()-interval '180 seconds') then
      raise exception 'SRI_MANAGER_MANUAL_REVIEW_REQUIRED';
    end if;
    -- The only exception is the exact row transition committed by the bounded,
    -- service-only correction RPC in this transaction. No client flag alone
    -- can authorize a source or status change.
    v_manager_correction := auth.role()='service_role' and old.status in('BORRADOR','VALIDADO','XML_GENERADO','FIRMADO') and new.status='FIRMADO'
      and (to_jsonb(old)-array['buyer_snapshot','source_snapshot','status','certificate_id','updated_at','updated_by'])=(to_jsonb(new)-array['buyer_snapshot','source_snapshot','status','certificate_id','updated_at','updated_by'])
      and not exists(select 1 from public.sri_transmissions where document_id=old.id)
      and exists(select 1 from public.erp_sri_document_manager_events e where e.operation_id::text=current_setting('app.sri_manager_correction',true)
       and e.company_id=old.company_id and e.document_id=old.id and e.action='CORRECT' and e.actor_user_id=new.updated_by
       and e.created_at>=transaction_timestamp() and e.before_state=to_jsonb(old)
       and (e.after_state-'updated_at')=(to_jsonb(new)-'updated_at'));

    if not v_manager_correction and (new.buyer_snapshot is distinct from old.buyer_snapshot
      or new.source_snapshot is distinct from old.source_snapshot) then
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
      v_transition_allowed := v_manager_correction or case old.status
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
$function$;
-- 01/04: internal follow-up only. This RPC cannot set a fiscal state, reverse
-- accounting or unlock replacement issuance. 07 keeps its existing workflow.
create or replace function public.erp_sri_manager_cancellation_tracking(p_company_id uuid,p_document_id uuid,p_operation_id uuid,p_action text,p_expected_version bigint,p_expected_updated_at timestamptz,p_reason text,p_evidence jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.electronic_documents%rowtype;m public.erp_sri_document_management%rowtype;e public.erp_sri_document_manager_events%rowtype;h text;last_state text;next_state text;
begin
 perform public.erp_sri_config_assert_access(p_company_id,'commercial.electronic_documents.annul');
 if p_operation_id is null or p_action not in('REQUEST','SUBMIT_PORTAL_REFERENCE') or p_action is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'SRI_MANAGER_CANCELLATION_REQUEST_INVALID';end if;
 select * into d from public.electronic_documents where company_id=p_company_id and id=p_document_id for update;
 if not found then raise exception 'SRI_DOCUMENT_NOT_FOUND';end if;
 if d.document_type not in('01','04') or d.status<>'AUTORIZADO' then raise exception 'SRI_MANAGER_CANCELLATION_NOT_ELIGIBLE';end if;
 h:=encode(sha256(convert_to(jsonb_build_array(p_company_id,p_document_id,auth.uid(),p_action,p_expected_version,p_expected_updated_at,p_reason,p_evidence)::text,'UTF8')),'hex');
 select * into e from public.erp_sri_document_manager_events where operation_id=p_operation_id;
 if found then if e.request_hash is distinct from h then raise exception 'SRI_MANAGER_OPERATION_CONFLICT';end if;return jsonb_build_object('ok',true,'reused',true);end if;
 select * into m from public.erp_sri_document_management where document_id=d.id;
 if coalesce(m.version,0) is distinct from p_expected_version or d.updated_at is distinct from p_expected_updated_at then raise exception 'SRI_MANAGER_STALE_VERSION';end if;
 select after_state->>'state' into last_state from public.erp_sri_document_manager_events where company_id=d.company_id and document_id=d.id and action='CANCELLATION_REQUESTED' order by created_at desc limit 1;
 if p_action='REQUEST' then
  if last_state is not null or p_evidence is distinct from '{}'::jsonb then raise exception 'SRI_MANAGER_CANCELLATION_ALREADY_REQUESTED';end if;
  next_state:='CANCELLATION_REQUESTED';
 else
  if last_state is null or p_evidence->>'accessKey' is distinct from d.access_key or length(btrim(coalesce(p_evidence->>'reference',''))) not between 3 and 500
   or (p_evidence-array['accessKey','reference'])<>'{}'::jsonb then raise exception 'SRI_MANAGER_EVIDENCE_IDENTITY_MISMATCH';end if;
  next_state:='PENDING_CANCELLATION';
 end if;
 insert into public.erp_sri_document_manager_events(operation_id,company_id,document_id,action,actor_user_id,reason,request_hash,before_state,after_state,evidence)
 values(p_operation_id,d.company_id,d.id,'CANCELLATION_REQUESTED',auth.uid(),p_reason,h,jsonb_build_object('state',coalesce(last_state,'NONE'),'fiscalStatus',d.status),jsonb_build_object('state',next_state,'fiscalStatus',d.status,'finalAnnulmentBlocked',true),p_evidence);
 insert into public.erp_sri_document_management(company_id,document_id,version,updated_by) values(d.company_id,d.id,1,auth.uid()) on conflict(document_id) do update set version=erp_sri_document_management.version+1,updated_by=auth.uid(),updated_at=clock_timestamp();
 return jsonb_build_object('ok',true,'state',next_state,'fiscalStatus',d.status,'finalAnnulmentBlocked',true);
end $$;
revoke all on function public.erp_sri_manager_cancellation_tracking(uuid,uuid,uuid,text,bigint,timestamptz,text,jsonb) from public,anon,service_role;
grant execute on function public.erp_sri_manager_cancellation_tracking(uuid,uuid,uuid,text,bigint,timestamptz,text,jsonb) to authenticated;

commit;
