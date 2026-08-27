-- Nómina V2: vínculo desde Parámetros Poscosecha y política de rendimiento real.
-- Aditiva. No aplica 202608160001 y no modifica registros operativos históricos.
begin;

insert into public.erp_payroll_backend_versions(component,version)
values('PAYROLL_CORE_V2','202608210001')
on conflict(component) do update set version=excluded.version,installed_at=clock_timestamp();

create or replace function public.erp_payroll_core_v2_link_operational_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_employee_id uuid,p_operational_role text,p_operational_worker_id text,
  p_valid_from date,p_valid_to date default null,p_active boolean default true,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_command public.erp_operations_commands%rowtype;
  v_link public.erp_payroll_employee_operational_roles%rowtype;
  v_result jsonb;
  v_record jsonb;
  v_role text:=upper(btrim(coalesce(p_operational_role,'')));
  v_worker text:=btrim(coalesce(p_operational_worker_id,''));
  v_reassigned integer:=0;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  if v_role not in ('BUNCHER','CLASSIFIER') or v_worker='' or p_valid_from is null or (p_valid_to is not null and p_valid_to<p_valid_from) then
    raise exception using errcode='22023',message='PAYROLL_V2_OPERATIONAL_ROLE_INVALID';
  end if;
  perform 1 from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_employee_id and status='ACTIVE';
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;

  -- Serializa tanto por trabajador operativo como por empleado/rol. Así una
  -- reasignación desde Parámetros no deja dos vínculos activos.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||v_role||':WORKER:'||v_worker,0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||v_role||':EMPLOYEE:'||p_employee_id::text,0));

  if p_active then
    update public.erp_payroll_employee_operational_roles
    set active=false,
        valid_to=case when valid_from<p_valid_from then p_valid_from-1 else valid_from end,
        updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and operational_role=v_role and active
      and (operational_worker_id=v_worker or employee_id=p_employee_id)
      and not (operational_worker_id=v_worker and employee_id=p_employee_id);
    get diagnostics v_reassigned=row_count;
  end if;

  select * into v_link from public.erp_payroll_employee_operational_roles
  where company_id=p_company_id and employee_id=p_employee_id and operational_role=v_role and operational_worker_id=v_worker
  order by created_at desc limit 1 for update;
  if found then
    update public.erp_payroll_employee_operational_roles
    set valid_from=p_valid_from,valid_to=p_valid_to,active=p_active,updated_at=clock_timestamp(),updated_by=auth.uid(),
        version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and link_id=v_link.link_id returning * into v_link;
  else
    insert into public.erp_payroll_employee_operational_roles(
      company_id,employee_id,operational_role,operational_worker_id,valid_from,valid_to,active,created_by,updated_by,last_operation_id
    ) values(
      p_company_id,p_employee_id,v_role,v_worker,p_valid_from,p_valid_to,p_active,auth.uid(),auth.uid(),p_operation_id
    ) returning * into v_link;
  end if;

  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_operational_roles',v_link.link_id::text,
    jsonb_build_object('id',v_link.link_id,'linkId',v_link.link_id,'employeeId',v_link.employee_id,'operationalModule','POSCOSECHA',
      'operationalRole',v_link.operational_role,'operationalWorkerId',v_link.operational_worker_id,'validFrom',v_link.valid_from,
      'validTo',v_link.valid_to,'active',v_link.active,'version',v_link.version,'syncFlow','PAYROLL_CORE_V2'));
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,
    case when v_reassigned>0 then 'OPERATIONAL_ROLE_REASSIGNED' else 'OPERATIONAL_ROLE_LINKED' end,
    'EMPLOYEE',p_employee_id,jsonb_build_object('linkId',v_link.link_id,'operationalRole',v_role,'operationalWorkerId',v_worker,'reassignedLinks',v_reassigned));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_record),'result',
    jsonb_build_object('linkId',v_link.link_id,'employeeId',p_employee_id,'operationalRole',v_role,'operationalWorkerId',v_worker,'reassignedLinks',v_reassigned));
  insert into public.erp_operations_commands(
    operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at
  ) values(
    p_operation_id,p_company_id,'PAYROLL_V2_LINK_OPERATIONAL_ROLE',v_link.link_id::text,
    jsonb_build_object('employeeId',p_employee_id,'operationalRole',v_role,'operationalWorkerId',v_worker),
    v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()
  );
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_performance_rows(
  p_company_id uuid,p_employee_id uuid,p_date_from date,p_date_to date
) returns table(operational_role text,source_entity text,source_record_id text,source_version bigint,source_updated_at timestamptz,quantity numeric,unit text)
language sql stable security definer set search_path=public,pg_temp as $$
  with links as (
    select l.* from public.erp_payroll_employee_operational_roles l
    where l.company_id=p_company_id and l.employee_id=p_employee_id and l.active
      and l.valid_from<=p_date_to and coalesce(l.valid_to,'infinity'::date)>=p_date_from
  ), buncher_rows as (
    select 'BUNCHER'::text operational_role,r.entity,r.record_id,r.version,r.updated_at,1::numeric quantity,'BUNCHES'::text unit,
      case when coalesce(r.payload->>'receivedAt',r.payload->>'received_at',r.payload->>'scannedAt',r.payload->>'scanned_at','') ~ '^\d{4}-\d{2}-\d{2}'
        then left(coalesce(r.payload->>'receivedAt',r.payload->>'received_at',r.payload->>'scannedAt',r.payload->>'scanned_at'),10)::date
        else r.updated_at::date end work_date
    from links l join public.erp_entity_records r on r.company_id=l.company_id and r.entity='operations_bunches' and r.deleted_at is null
      and l.operational_role='BUNCHER'
      and l.operational_worker_id in (
        coalesce(r.payload->>'buncherOperationalWorkerId',''),coalesce(r.payload->>'buncher_operational_worker_id',''),
        coalesce(r.payload->>'operationalWorkerId',''),coalesce(r.payload->>'operational_worker_id',''),
        coalesce(r.payload->>'buncherEmployeeId',''),coalesce(r.payload->>'buncher_employee_id','')
      )
    where nullif(coalesce(r.payload->>'receivedAt',r.payload->>'received_at',r.payload->>'scannedAt',r.payload->>'scanned_at',''),'') is not null
      and lower(coalesce(r.payload->>'demoValidationSeed','false')) not in ('true','1')
      and upper(coalesce(r.payload->>'state','')) not in ('ANULADO','CANCELADO')
  ), classifier_rows as (
    select 'CLASSIFIER'::text operational_role,r.entity,r.record_id,r.version,r.updated_at,
      greatest(0,case when coalesce(r.payload->>'bunches','') ~ '^\d+(\.\d+)?$' then (r.payload->>'bunches')::numeric else 0 end) quantity,
      'MESHES'::text unit,
      case when coalesce(r.payload->>'date',r.payload->>'workDate',r.payload->>'work_date',r.payload->>'createdAt',r.payload->>'created_at','') ~ '^\d{4}-\d{2}-\d{2}'
        then left(coalesce(r.payload->>'date',r.payload->>'workDate',r.payload->>'work_date',r.payload->>'createdAt',r.payload->>'created_at'),10)::date
        else r.updated_at::date end work_date
    from links l join public.erp_entity_records r on r.company_id=l.company_id and r.entity='operations_performances' and r.deleted_at is null
      and l.operational_role='CLASSIFIER'
      and upper(coalesce(r.payload->>'activity',''))='CLASIFICACION'
      and l.operational_worker_id in (
        coalesce(r.payload->>'operationalWorkerId',''),coalesce(r.payload->>'operational_worker_id',''),
        coalesce(r.payload->>'employeeId',''),coalesce(r.payload->>'employee_id',''),
        coalesce(r.payload->>'classifierEmployeeId',''),coalesce(r.payload->>'classifier_employee_id','')
      )
    where lower(coalesce(r.payload->>'demoValidationSeed','false')) not in ('true','1')
      and upper(coalesce(r.payload->>'status',r.payload->>'state','')) not in ('ANULADO','CANCELADO')
  ), rows as (
    select * from buncher_rows union all select * from classifier_rows
  )
  select operational_role,entity,record_id,version,updated_at,quantity,unit
  from rows where work_date between p_date_from and p_date_to and quantity>0
$$;

create or replace function public.erp_payroll_core_v2_get_performance(p_company_id uuid,p_employee_id uuid,p_period_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_period public.erp_payroll_periods%rowtype; v_rows jsonb; v_unlinked bigint;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'VIEW');
  select * into v_period from public.erp_payroll_periods where company_id=p_company_id and period_id=p_period_id;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_PERIOD_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.source_updated_at,x.source_record_id),'[]') into v_rows
  from public.erp_payroll_core_v2_performance_rows(p_company_id,p_employee_id,v_period.date_from,v_period.date_to) x;
  with candidates as (
    select r.entity,r.updated_at,
      case when r.entity='operations_bunches' then coalesce(r.payload->>'receivedAt',r.payload->>'received_at',r.payload->>'scannedAt',r.payload->>'scanned_at','')
           else coalesce(r.payload->>'date',r.payload->>'workDate',r.payload->>'work_date','') end date_text,
      case when r.entity='operations_bunches' then coalesce(r.payload->>'buncherOperationalWorkerId',r.payload->>'buncher_operational_worker_id',r.payload->>'operationalWorkerId',r.payload->>'operational_worker_id',r.payload->>'buncherEmployeeId',r.payload->>'buncher_employee_id','')
           else coalesce(r.payload->>'operationalWorkerId',r.payload->>'operational_worker_id',r.payload->>'employeeId',r.payload->>'employee_id',r.payload->>'classifierEmployeeId',r.payload->>'classifier_employee_id','') end worker_id
    from public.erp_entity_records r
    where r.company_id=p_company_id and r.deleted_at is null
      and ((r.entity='operations_bunches' and nullif(coalesce(r.payload->>'receivedAt',r.payload->>'received_at',r.payload->>'scannedAt',r.payload->>'scanned_at',''),'') is not null)
        or (r.entity='operations_performances' and upper(coalesce(r.payload->>'activity',''))='CLASIFICACION'))
      and lower(coalesce(r.payload->>'demoValidationSeed','false')) not in ('true','1')
      and upper(coalesce(r.payload->>'status',r.payload->>'state','')) not in ('ANULADO','CANCELADO')
  )
  select count(*) into v_unlinked from candidates
  where nullif(worker_id,'') is null
    and (case when date_text ~ '^\d{4}-\d{2}-\d{2}' then left(date_text,10)::date else updated_at::date end)
      between v_period.date_from and v_period.date_to;
  return jsonb_build_object('ok',true,'employeeId',p_employee_id,'periodId',p_period_id,'rows',v_rows,
    'totals',coalesce((select jsonb_object_agg(operational_role,total) from (
      select operational_role,round(sum(quantity),8) total from public.erp_payroll_core_v2_performance_rows(p_company_id,p_employee_id,v_period.date_from,v_period.date_to) group by operational_role
    ) total_rows),'{}'::jsonb),'unlinkedSourceCount',v_unlinked,'matchingPolicy','OPERATIONAL_WORKER_ID_ONLY',
    'sourcePolicy',jsonb_build_object('BUNCHER','operations_bunches received/scanned = 1 BUNCH','CLASSIFIER','operations_performances.bunches = MESHES'));
end $$;

create or replace function public.erp_payroll_core_v2_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_admin boolean; v_permissions jsonb;
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id) then
    raise exception using errcode='42501',message='PAYROLL_V2_COMPANY_ACCESS_DENIED';
  end if;
  v_admin:=public.erp_payroll_core_v2_is_admin(p_company_id);
  select jsonb_build_object('view',v_admin or coalesce(p.can_view,false),'manage',v_admin or coalesce(p.can_manage,false),
    'approve',v_admin or coalesce(p.can_approve,false),'post',v_admin or coalesce(p.can_post,false)) into v_permissions
  from (select 1) x left join public.erp_payroll_user_permissions p on p.company_id=p_company_id and p.user_id=auth.uid();
  return jsonb_build_object(
    'ok',true,'component','PAYROLL_CORE_V2','migration','202608210001','companyId',p_company_id,'permissions',v_permissions,
    'capabilities',jsonb_build_array('payroll.view','payroll.manage','payroll.approve','payroll.post'),
    'employeeTable',to_regclass('public.erp_payroll_employees') is not null,
    'operationalRoleTable',to_regclass('public.erp_payroll_employee_operational_roles') is not null,
    'periodTable',to_regclass('public.erp_payroll_periods') is not null,'roleTable',to_regclass('public.erp_payroll_roles') is not null,
    'snapshotTable',to_regclass('public.erp_payroll_performance_snapshots') is not null,
    'financialDependency',to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'postharvestParameterLink',true,'performancePolicy','OPERATIONS_REAL_V2','buncherSource','operations_bunches',
    'classifierSource','operations_performances','serverTime',clock_timestamp()
  );
end $$;

revoke execute on function public.erp_payroll_core_v2_performance_rows(uuid,uuid,date,date) from public,anon,authenticated;
revoke execute on function public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamptz),
  public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid),public.erp_payroll_core_v2_health(uuid) from public,anon;
grant execute on function public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamptz),
  public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid),public.erp_payroll_core_v2_health(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
