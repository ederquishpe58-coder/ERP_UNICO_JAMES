-- Nómina V2: políticas versionadas de rendimiento y snapshot informativo.
-- Aditiva. No aplica 202608160001 ni modifica datos físicos de Poscosecha.
-- FIXED_PERFORMANCE conserva sueldo base; el cumplimiento no altera remuneración.
begin;

insert into public.erp_payroll_backend_versions(component,version)
values('PAYROLL_CORE_V2','202608210002')
on conflict(component) do update set version=excluded.version,installed_at=clock_timestamp();

alter table public.erp_payroll_employees
  drop constraint if exists erp_payroll_employees_calculation_mode_check;
alter table public.erp_payroll_employees
  add constraint erp_payroll_employees_calculation_mode_check
  check(calculation_mode in (
    'FIXED','FIXED_MANUAL_HOURS','FIXED_PERFORMANCE',
    'MONTHLY','HOURLY','PERFORMANCE','MIXED'
  ));

create table if not exists public.erp_payroll_performance_policies (
  company_id uuid not null references public.companies(id) on delete cascade,
  policy_id uuid not null default gen_random_uuid(),
  policy_series_id uuid not null default gen_random_uuid(),
  code text not null,
  name text not null,
  operational_role text not null check(operational_role in ('BUNCHER','CLASSIFIER')),
  salary_type text not null check(salary_type in ('FIXED','FIXED_MANUAL_HOURS','FIXED_PERFORMANCE')),
  base_salary numeric(20,6) not null default 0 check(base_salary>=0),
  standard_workdays integer not null default 21 check(standard_workdays between 1 and 31),
  primary_unit text not null check(primary_unit in ('BUNCH','MESH')),
  daily_target numeric(20,8) not null check(daily_target>0),
  monthly_target numeric(20,8) not null check(monthly_target>0),
  reference_stems numeric(20,8) not null check(reference_stems>=0),
  stems_per_unit numeric(20,8) not null check(stems_per_unit>0),
  performance_source text not null,
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  policy_version integer not null default 1 check(policy_version>0),
  version bigint not null default 1 check(version>0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  last_operation_id uuid,
  primary key(company_id,policy_id),
  unique(company_id,policy_series_id,policy_version),
  unique(company_id,code,policy_version),
  check(valid_to is null or valid_to>=valid_from),
  check((operational_role='BUNCHER' and primary_unit='BUNCH') or (operational_role='CLASSIFIER' and primary_unit='MESH'))
);
create unique index if not exists erp_payroll_performance_policy_active_code_uq
  on public.erp_payroll_performance_policies(company_id,code)
  where active and valid_to is null;
create index if not exists erp_payroll_performance_policy_validity_idx
  on public.erp_payroll_performance_policies(company_id,operational_role,valid_from,valid_to);

create table if not exists public.erp_payroll_employee_policy_assignments (
  company_id uuid not null references public.companies(id) on delete cascade,
  assignment_id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  policy_id uuid not null,
  operational_role text not null check(operational_role in ('BUNCHER','CLASSIFIER')),
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  version bigint not null default 1 check(version>0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  last_operation_id uuid not null,
  primary key(company_id,assignment_id),
  foreign key(company_id,employee_id) references public.erp_payroll_employees(company_id,employee_id),
  foreign key(company_id,policy_id) references public.erp_payroll_performance_policies(company_id,policy_id),
  check(valid_to is null or valid_to>=valid_from)
);
create unique index if not exists erp_payroll_employee_policy_active_role_uq
  on public.erp_payroll_employee_policy_assignments(company_id,employee_id,operational_role)
  where active and valid_to is null;
create index if not exists erp_payroll_employee_policy_validity_idx
  on public.erp_payroll_employee_policy_assignments(company_id,employee_id,valid_from,valid_to);

create table if not exists public.erp_payroll_performance_policy_snapshots (
  company_id uuid not null,
  policy_snapshot_id uuid not null default gen_random_uuid(),
  role_item_id uuid not null,
  employee_id uuid not null,
  policy_id uuid not null,
  policy_version integer not null check(policy_version>0),
  operational_role text not null check(operational_role in ('BUNCHER','CLASSIFIER')),
  salary_type text not null,
  base_salary numeric(20,6) not null check(base_salary>=0),
  standard_workdays integer not null check(standard_workdays between 1 and 31),
  considered_workdays integer not null check(considered_workdays between 0 and 31),
  primary_unit text not null check(primary_unit in ('BUNCH','MESH')),
  daily_target numeric(20,8) not null check(daily_target>0),
  period_target numeric(20,8) not null check(period_target>0),
  proportional_target numeric(20,8) not null check(proportional_target>=0),
  actual_units numeric(20,8) not null check(actual_units>=0),
  performance_percentage numeric(20,8) not null check(performance_percentage>=0),
  stems_per_unit numeric(20,8) not null check(stems_per_unit>0),
  reference_stems_target numeric(20,8) not null check(reference_stems_target>=0),
  reference_stems_actual numeric(20,8) not null check(reference_stems_actual>=0),
  period_from date not null,
  period_to date not null,
  source_ids jsonb not null default '[]'::jsonb,
  source_fingerprint text not null,
  frozen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(company_id,policy_snapshot_id),
  unique(company_id,role_item_id,policy_id),
  foreign key(company_id,role_item_id) references public.erp_payroll_role_items(company_id,role_item_id) on delete cascade,
  foreign key(company_id,employee_id) references public.erp_payroll_employees(company_id,employee_id),
  foreign key(company_id,policy_id) references public.erp_payroll_performance_policies(company_id,policy_id),
  check(period_to>=period_from)
);
create index if not exists erp_payroll_policy_snapshot_employee_idx
  on public.erp_payroll_performance_policy_snapshots(company_id,employee_id,period_from,period_to);

-- Políticas iniciales solicitadas. No asignan empleados ni modifican históricos.
insert into public.erp_payroll_performance_policies(
  company_id,policy_id,policy_series_id,code,name,operational_role,salary_type,base_salary,standard_workdays,
  primary_unit,daily_target,monthly_target,reference_stems,stems_per_unit,performance_source,valid_from,policy_version
)
select c.id,gen_random_uuid(),gen_random_uuid(),'BUNCHER_STANDARD','EMBONCHADOR - RENDIMIENTO ESTÁNDAR','BUNCHER',
  'FIXED_PERFORMANCE',470,21,'BUNCH',200,4200,105000,25,'operations_bunches',date '2026-08-01',1
from public.companies c
on conflict(company_id,code,policy_version) do nothing;

insert into public.erp_payroll_performance_policies(
  company_id,policy_id,policy_series_id,code,name,operational_role,salary_type,base_salary,standard_workdays,
  primary_unit,daily_target,monthly_target,reference_stems,stems_per_unit,performance_source,valid_from,policy_version
)
select c.id,gen_random_uuid(),gen_random_uuid(),'CLASSIFIER_STANDARD','CLASIFICADOR - RENDIMIENTO ESTÁNDAR','CLASSIFIER',
  'FIXED_PERFORMANCE',470,21,'MESH',200,4200,126000,30,'operations_performances.bunches',date '2026-08-01',1
from public.companies c
on conflict(company_id,code,policy_version) do nothing;

create or replace function public.erp_payroll_performance_v2_save_policy(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,
  p_prior_policy_id uuid default null,p_expected_version bigint default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_command public.erp_operations_commands%rowtype;
  v_prior public.erp_payroll_performance_policies%rowtype;
  v_policy public.erp_payroll_performance_policies%rowtype;
  v_old_assignment public.erp_payroll_employee_policy_assignments%rowtype;
  v_policy_id uuid:=gen_random_uuid(); v_series_id uuid:=gen_random_uuid(); v_policy_version integer:=1;
  v_code text:=upper(btrim(coalesce(p_payload->>'code',''))); v_name text:=btrim(coalesce(p_payload->>'name',''));
  v_role text:=upper(btrim(coalesce(p_payload->>'operationalRole','')));
  v_salary_type text:=upper(btrim(coalesce(p_payload->>'salaryType','FIXED_PERFORMANCE')));
  v_unit text:=upper(btrim(coalesce(p_payload->>'primaryUnit','')));
  v_base numeric:=coalesce(nullif(p_payload->>'baseSalary','')::numeric,0);
  v_days integer:=coalesce(nullif(p_payload->>'standardWorkdays','')::integer,21);
  v_daily numeric:=coalesce(nullif(p_payload->>'dailyTarget','')::numeric,0);
  v_monthly numeric; v_stems_per numeric:=coalesce(nullif(p_payload->>'stemsPerUnit','')::numeric,0); v_reference numeric;
  v_valid_from date:=nullif(p_payload->>'validFrom','')::date; v_valid_to date:=nullif(p_payload->>'validTo','')::date;
  v_source text; v_record jsonb; v_records jsonb:='[]'::jsonb; v_result jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  if v_code='' or v_name='' or v_role not in ('BUNCHER','CLASSIFIER') or v_salary_type not in ('FIXED','FIXED_MANUAL_HOURS','FIXED_PERFORMANCE')
    or v_valid_from is null or v_days not between 1 and 31 or v_daily<=0 or v_base<0 or v_stems_per<=0 then
    raise exception using errcode='22023',message='PAYROLL_V2_POLICY_INVALID';
  end if;
  if (v_role='BUNCHER' and v_unit<>'BUNCH') or (v_role='CLASSIFIER' and v_unit<>'MESH') then
    raise exception using errcode='23514',message='PAYROLL_V2_POLICY_UNIT_ROLE_MISMATCH';
  end if;
  if v_valid_to is not null and v_valid_to<v_valid_from then raise exception using errcode='22023',message='PAYROLL_V2_POLICY_VALIDITY_INVALID'; end if;
  v_monthly:=coalesce(nullif(p_payload->>'monthlyTarget','')::numeric,v_daily*v_days);
  v_reference:=coalesce(nullif(p_payload->>'referenceStems','')::numeric,v_monthly*v_stems_per);
  if v_monthly<=0 or v_reference<0 then raise exception using errcode='22023',message='PAYROLL_V2_POLICY_TARGET_INVALID'; end if;
  v_source:=case v_role when 'BUNCHER' then 'operations_bunches' else 'operations_performances.bunches' end;
  if p_prior_policy_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_POLICY:'||p_prior_policy_id::text,0));
    select * into v_prior from public.erp_payroll_performance_policies where company_id=p_company_id and policy_id=p_prior_policy_id for update;
    if not found then raise exception using errcode='P0002',message='PAYROLL_V2_POLICY_NOT_FOUND'; end if;
    if p_expected_version is null or v_prior.version<>p_expected_version then raise exception using errcode='40001',message='PAYROLL_V2_POLICY_VERSION_CONFLICT'; end if;
    if v_valid_from<=v_prior.valid_from then raise exception using errcode='23514',message='PAYROLL_V2_POLICY_NEW_VERSION_DATE_INVALID'; end if;
    v_code:=v_prior.code; v_role:=v_prior.operational_role; v_unit:=v_prior.primary_unit;
    v_series_id:=v_prior.policy_series_id; v_policy_version:=v_prior.policy_version+1;
    v_source:=v_prior.performance_source;
    update public.erp_payroll_performance_policies set active=false,valid_to=v_valid_from-1,updated_at=clock_timestamp(),updated_by=auth.uid(),
      version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and policy_id=v_prior.policy_id returning * into v_prior;
    v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_performance_policies',v_prior.policy_id::text,
      to_jsonb(v_prior)||jsonb_build_object('id',v_prior.policy_id,'policyId',v_prior.policy_id,'policyVersion',v_prior.policy_version,'syncFlow','PAYROLL_CORE_V2'));
    v_records:=v_records||jsonb_build_array(v_record);
    for v_old_assignment in update public.erp_payroll_employee_policy_assignments set active=false,valid_to=v_valid_from-1,
        updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and policy_id=v_prior.policy_id and active and valid_to is null returning * loop
      v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_policy_assignments',v_old_assignment.assignment_id::text,
        to_jsonb(v_old_assignment)||jsonb_build_object('id',v_old_assignment.assignment_id,'assignmentId',v_old_assignment.assignment_id,'syncFlow','PAYROLL_CORE_V2'));
      v_records:=v_records||jsonb_build_array(v_record);
    end loop;
  else
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_POLICY_CODE:'||v_code,0));
  end if;
  insert into public.erp_payroll_performance_policies(company_id,policy_id,policy_series_id,code,name,operational_role,salary_type,base_salary,
    standard_workdays,primary_unit,daily_target,monthly_target,reference_stems,stems_per_unit,performance_source,valid_from,valid_to,active,
    policy_version,created_by,updated_by,last_operation_id)
  values(p_company_id,v_policy_id,v_series_id,v_code,v_name,v_role,v_salary_type,v_base,v_days,v_unit,v_daily,v_monthly,v_reference,v_stems_per,
    v_source,v_valid_from,v_valid_to,true,v_policy_version,auth.uid(),auth.uid(),p_operation_id) returning * into v_policy;
  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_performance_policies',v_policy.policy_id::text,
    to_jsonb(v_policy)||jsonb_build_object('id',v_policy.policy_id,'policyId',v_policy.policy_id,'policyVersion',v_policy.policy_version,'syncFlow','PAYROLL_CORE_V2'));
  v_records:=v_records||jsonb_build_array(v_record);
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,
    case when p_prior_policy_id is null then 'PERFORMANCE_POLICY_CREATED' else 'PERFORMANCE_POLICY_VERSIONED' end,
    'PERFORMANCE_POLICY',v_policy.policy_id,jsonb_build_object('code',v_policy.code,'policyVersion',v_policy.policy_version,'priorPolicyId',p_prior_policy_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',
    jsonb_build_object('policyId',v_policy.policy_id,'policyVersion',v_policy.policy_version,'code',v_policy.code));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_SAVE_PERFORMANCE_POLICY',v_policy.policy_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_performance_v2_assign_policy(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_employee_id uuid,p_policy_id uuid,
  p_valid_from date,p_valid_to date default null,p_active boolean default true,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_command public.erp_operations_commands%rowtype; v_employee public.erp_payroll_employees%rowtype;
  v_policy public.erp_payroll_performance_policies%rowtype; v_assignment public.erp_payroll_employee_policy_assignments%rowtype;
  v_old public.erp_payroll_employee_policy_assignments%rowtype; v_record jsonb; v_records jsonb:='[]'::jsonb; v_result jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  select * into v_employee from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_employee_id and status='ACTIVE' for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;
  select * into v_policy from public.erp_payroll_performance_policies where company_id=p_company_id and policy_id=p_policy_id for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_POLICY_NOT_FOUND'; end if;
  if not v_policy.active or p_valid_from<v_policy.valid_from or (v_policy.valid_to is not null and p_valid_from>v_policy.valid_to)
    or (p_valid_to is not null and (p_valid_to<p_valid_from or p_valid_to>coalesce(v_policy.valid_to,p_valid_to))) then
    raise exception using errcode='23514',message='PAYROLL_V2_POLICY_ASSIGNMENT_VALIDITY_INVALID';
  end if;
  if v_employee.calculation_mode<>'FIXED_PERFORMANCE' then raise exception using errcode='23514',message='PAYROLL_V2_EMPLOYEE_MODE_NOT_FIXED_PERFORMANCE'; end if;
  if not exists(select 1 from public.erp_payroll_employee_operational_roles l where l.company_id=p_company_id and l.employee_id=p_employee_id
    and l.operational_role=v_policy.operational_role and l.active and l.valid_from<=p_valid_from and coalesce(l.valid_to,'infinity'::date)>=p_valid_from) then
    raise exception using errcode='23514',message='PAYROLL_V2_OPERATIONAL_ROLE_LINK_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':EMPLOYEE_POLICY:'||p_employee_id::text||':'||v_policy.operational_role,0));
  for v_old in update public.erp_payroll_employee_policy_assignments set active=false,valid_to=greatest(valid_from,p_valid_from-1),
      updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and employee_id=p_employee_id and operational_role=v_policy.operational_role and active and valid_to is null
      and policy_id<>p_policy_id returning * loop
    v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_policy_assignments',v_old.assignment_id::text,
      to_jsonb(v_old)||jsonb_build_object('id',v_old.assignment_id,'assignmentId',v_old.assignment_id,'syncFlow','PAYROLL_CORE_V2'));
    v_records:=v_records||jsonb_build_array(v_record);
  end loop;
  select * into v_assignment from public.erp_payroll_employee_policy_assignments where company_id=p_company_id and employee_id=p_employee_id
    and policy_id=p_policy_id order by created_at desc limit 1 for update;
  if found then
    update public.erp_payroll_employee_policy_assignments set operational_role=v_policy.operational_role,valid_from=p_valid_from,valid_to=p_valid_to,
      active=p_active,updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and assignment_id=v_assignment.assignment_id returning * into v_assignment;
  else
    insert into public.erp_payroll_employee_policy_assignments(company_id,employee_id,policy_id,operational_role,valid_from,valid_to,active,created_by,updated_by,last_operation_id)
    values(p_company_id,p_employee_id,p_policy_id,v_policy.operational_role,p_valid_from,p_valid_to,p_active,auth.uid(),auth.uid(),p_operation_id)
    returning * into v_assignment;
  end if;
  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_policy_assignments',v_assignment.assignment_id::text,
    to_jsonb(v_assignment)||jsonb_build_object('id',v_assignment.assignment_id,'assignmentId',v_assignment.assignment_id,'syncFlow','PAYROLL_CORE_V2'));
  v_records:=v_records||jsonb_build_array(v_record);
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'PERFORMANCE_POLICY_ASSIGNED','EMPLOYEE',p_employee_id,
    jsonb_build_object('assignmentId',v_assignment.assignment_id,'policyId',p_policy_id,'operationalRole',v_policy.operational_role));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',
    jsonb_build_object('assignmentId',v_assignment.assignment_id,'employeeId',p_employee_id,'policyId',p_policy_id));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_ASSIGN_PERFORMANCE_POLICY',v_assignment.assignment_id::text,
    jsonb_build_object('employeeId',p_employee_id,'policyId',p_policy_id,'validFrom',p_valid_from,'validTo',p_valid_to,'active',p_active),
    v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_performance_v2_snapshot_item(
  p_company_id uuid,p_role_item_id uuid,p_employee_id uuid,p_period_from date,p_period_to date,p_considered_workdays integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_employee public.erp_payroll_employees%rowtype; v_policy record; v_perf record; v_policy_count integer:=0;
  v_actual numeric; v_percentage numeric; v_source_ids jsonb; v_base_salary numeric:=0; v_distinct_salary integer:=0;
  v_days integer; v_proportional numeric;
begin
  select * into v_employee from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_employee_id;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;
  delete from public.erp_payroll_performance_snapshots where company_id=p_company_id and role_item_id=p_role_item_id;
  delete from public.erp_payroll_performance_policy_snapshots where company_id=p_company_id and role_item_id=p_role_item_id;
  for v_perf in select * from public.erp_payroll_core_v2_performance_rows(p_company_id,p_employee_id,p_period_from,p_period_to) loop
    insert into public.erp_payroll_performance_snapshots(company_id,role_item_id,employee_id,operational_role,source_entity,source_record_id,
      source_version,source_updated_at,period_from,period_to,quantity,unit,applied_rate,calculated_value,source_fingerprint,source_ids)
    values(p_company_id,p_role_item_id,p_employee_id,v_perf.operational_role,v_perf.source_entity,v_perf.source_record_id,v_perf.source_version,
      v_perf.source_updated_at,p_period_from,p_period_to,v_perf.quantity,v_perf.unit,
      case when v_employee.calculation_mode in ('PERFORMANCE','MIXED') then v_employee.performance_rate else 0 end,
      case when v_employee.calculation_mode in ('PERFORMANCE','MIXED') then round(v_perf.quantity*v_employee.performance_rate,6) else 0 end,
      md5(v_perf.source_entity||':'||v_perf.source_record_id||':'||v_perf.source_version::text||':'||v_perf.quantity::text),jsonb_build_array(v_perf.source_record_id));
  end loop;
  for v_policy in
    select p.* from public.erp_payroll_employee_policy_assignments a
    join public.erp_payroll_performance_policies p on p.company_id=a.company_id and p.policy_id=a.policy_id
    where a.company_id=p_company_id and a.employee_id=p_employee_id and a.active
      and a.valid_from<=p_period_to and coalesce(a.valid_to,'infinity'::date)>=p_period_from
      and p.valid_from<=p_period_to and coalesce(p.valid_to,'infinity'::date)>=p_period_from
    order by p.operational_role,p.policy_version desc
  loop
    v_policy_count:=v_policy_count+1;
    select coalesce(sum(s.quantity),0),coalesce(jsonb_agg(s.source_record_id order by s.source_updated_at,s.source_record_id),'[]'::jsonb)
      into v_actual,v_source_ids from public.erp_payroll_performance_snapshots s
      where s.company_id=p_company_id and s.role_item_id=p_role_item_id and s.operational_role=v_policy.operational_role;
    v_days:=coalesce(p_considered_workdays,v_policy.standard_workdays);
    if v_days<0 or v_days>31 then raise exception using errcode='22023',message='PAYROLL_V2_CONSIDERED_WORKDAYS_INVALID'; end if;
    v_proportional:=round(v_policy.daily_target*v_days,8);
    v_percentage:=case when v_policy.monthly_target>0 then round(v_actual/v_policy.monthly_target*100,8) else 0 end;
    insert into public.erp_payroll_performance_policy_snapshots(company_id,role_item_id,employee_id,policy_id,policy_version,operational_role,
      salary_type,base_salary,standard_workdays,considered_workdays,primary_unit,daily_target,period_target,proportional_target,actual_units,
      performance_percentage,stems_per_unit,reference_stems_target,reference_stems_actual,period_from,period_to,source_ids,source_fingerprint)
    values(p_company_id,p_role_item_id,p_employee_id,v_policy.policy_id,v_policy.policy_version,v_policy.operational_role,v_policy.salary_type,
      v_policy.base_salary,v_policy.standard_workdays,v_days,v_policy.primary_unit,v_policy.daily_target,v_policy.monthly_target,v_proportional,
      v_actual,v_percentage,v_policy.stems_per_unit,v_policy.reference_stems,round(v_actual*v_policy.stems_per_unit,8),p_period_from,p_period_to,
      v_source_ids,md5(v_policy.policy_id::text||':'||v_policy.policy_version::text||':'||v_actual::text||':'||v_source_ids::text));
  end loop;
  if v_employee.calculation_mode='FIXED_PERFORMANCE' and v_policy_count=0 then
    raise exception using errcode='23514',message='PAYROLL_V2_PERFORMANCE_POLICY_REQUIRED';
  end if;
  select count(distinct base_salary),coalesce(max(base_salary),0) into v_distinct_salary,v_base_salary
  from public.erp_payroll_performance_policy_snapshots where company_id=p_company_id and role_item_id=p_role_item_id;
  if v_distinct_salary>1 then raise exception using errcode='23514',message='PAYROLL_V2_POLICY_BASE_SALARY_CONFLICT'; end if;
  return jsonb_build_object('policyCount',v_policy_count,'baseSalary',v_base_salary);
end $$;

create or replace function public.erp_payroll_core_v2_calculate_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_period_id uuid,p_payload jsonb,p_expected_version bigint default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_command public.erp_operations_commands%rowtype; v_period public.erp_payroll_periods%rowtype; v_role public.erp_payroll_roles%rowtype;
  v_employee public.erp_payroll_employees%rowtype; v_item_id uuid; v_employee_id uuid; v_payload_item jsonb; v_concept jsonb; v_perf record;
  v_line integer; v_income numeric; v_deductions numeric; v_amount numeric; v_qty numeric; v_rate numeric; v_kind text; v_code text;
  v_role_id uuid; v_records jsonb; v_result jsonb; v_policy_summary jsonb; v_salary numeric; v_considered_days integer;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERIOD:'||p_period_id::text,0));
  select * into v_period from public.erp_payroll_periods where company_id=p_company_id and period_id=p_period_id for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_PERIOD_NOT_FOUND'; end if;
  if v_period.status not in ('OPEN','CALCULATED') then raise exception using errcode='23514',message='PAYROLL_V2_PERIOD_LOCKED'; end if;
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and period_id=p_period_id for update;
  if found and v_role.status not in ('DRAFT','CALCULATED') then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_LOCKED'; end if;
  if found and p_expected_version is not null and v_role.version<>p_expected_version then raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT'; end if;
  if not found then
    v_role_id:=gen_random_uuid();
    insert into public.erp_payroll_roles(company_id,role_id,period_id,role_number,status,notes,created_by,updated_by,last_operation_id)
    values(p_company_id,v_role_id,p_period_id,public.erp_payroll_core_v2_next_code(p_company_id,'ROLE',v_period.date_to),'DRAFT',btrim(coalesce(p_payload->>'notes','')),auth.uid(),auth.uid(),p_operation_id)
    returning * into v_role;
  else v_role_id:=v_role.role_id; delete from public.erp_payroll_role_items where company_id=p_company_id and role_id=v_role_id; end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'))=0 then
    raise exception using errcode='22023',message='PAYROLL_V2_EMPLOYEES_REQUIRED';
  end if;
  for v_payload_item in select value from jsonb_array_elements(p_payload->'items') loop
    v_employee_id:=nullif(v_payload_item->>'employeeId','')::uuid;
    select * into v_employee from public.erp_payroll_employees where company_id=p_company_id and employee_id=v_employee_id and status='ACTIVE';
    if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND:'||coalesce(v_employee_id::text,''); end if;
    v_item_id:=gen_random_uuid(); v_line:=0;
    insert into public.erp_payroll_role_items(company_id,role_item_id,role_id,employee_id,employee_code_snapshot,employee_name_snapshot,
      position_snapshot,calculation_mode_snapshot,last_operation_id)
    values(p_company_id,v_item_id,v_role_id,v_employee_id,v_employee.employee_code,v_employee.full_name,v_employee.position_name,v_employee.calculation_mode,p_operation_id);
    v_considered_days:=nullif(v_payload_item->>'consideredWorkdays','')::integer;
    v_policy_summary:=public.erp_payroll_performance_v2_snapshot_item(p_company_id,v_item_id,v_employee_id,v_period.date_from,v_period.date_to,v_considered_days);
    v_salary:=case
      when v_employee.calculation_mode='FIXED_PERFORMANCE' then coalesce((v_policy_summary->>'baseSalary')::numeric,0)
      when v_employee.calculation_mode in ('FIXED','FIXED_MANUAL_HOURS','MONTHLY','MIXED') then v_employee.monthly_salary
      else 0 end;
    if v_salary>0 then
      v_line:=v_line+1;
      insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type)
      values(p_company_id,v_item_id,v_line,'EARNING','SALARY','Sueldo',1,v_salary,v_salary,v_employee.expense_account_code,
        case when v_employee.calculation_mode='FIXED_PERFORMANCE' then 'PERFORMANCE_POLICY_BASE' else 'EMPLOYEE_MASTER' end);
    end if;
    if v_employee.calculation_mode in ('PERFORMANCE','MIXED') then
      for v_perf in select operational_role,sum(quantity) quantity,min(unit) unit,sum(calculated_value) calculated_value
        from public.erp_payroll_performance_snapshots where company_id=p_company_id and role_item_id=v_item_id group by operational_role loop
        if v_perf.quantity>0 then
          v_line:=v_line+1;
          insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference)
          values(p_company_id,v_item_id,v_line,'EARNING','PERFORMANCE','Rendimiento '||case v_perf.operational_role when 'BUNCHER' then 'Embonche' else 'Clasificación' end,
            v_perf.quantity,v_employee.performance_rate,round(v_perf.calculated_value,6),v_employee.expense_account_code,'POSCOSECHA_UUID',v_perf.operational_role);
        end if;
      end loop;
    end if;
    if jsonb_typeof(coalesce(v_payload_item->'concepts','[]'))='array' then
      for v_concept in select value from jsonb_array_elements(v_payload_item->'concepts') loop
        v_code:=upper(btrim(v_concept->>'code')); v_kind:=upper(btrim(v_concept->>'kind'));
        if (v_kind='EARNING' and v_code not in ('NORMAL_HOURS','OVERTIME','TRANSPORT','BONUS','COMMISSION','OTHER_INCOME'))
          or (v_kind='DEDUCTION' and v_code not in ('FOOD','ADVANCE','OTHER_DISCOUNTS')) then
          raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_NOT_ALLOWED:'||coalesce(v_code,'');
        end if;
        if v_code='NORMAL_HOURS' and v_employee.calculation_mode not in ('FIXED_MANUAL_HOURS','HOURLY','MIXED') then
          raise exception using errcode='23514',message='PAYROLL_V2_MANUAL_HOURS_MODE_REQUIRED';
        end if;
        v_qty:=coalesce(nullif(v_concept->>'quantity','')::numeric,1); v_rate:=coalesce(nullif(v_concept->>'rate','')::numeric,0);
        v_amount:=round(coalesce(nullif(v_concept->>'amount','')::numeric,v_qty*v_rate),6);
        if v_amount<0 or v_qty<0 or v_rate<0 then raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_AMOUNT_INVALID'; end if;
        if v_code='NORMAL_HOURS' and v_rate<>v_employee.hourly_rate then raise exception using errcode='23514',message='PAYROLL_V2_HOURLY_RATE_MISMATCH'; end if;
        v_line:=v_line+1;
        insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference)
        values(p_company_id,v_item_id,v_line,v_kind,v_code,btrim(coalesce(v_concept->>'label',replace(v_code,'_',' '))),v_qty,v_rate,v_amount,
          btrim(coalesce(v_concept->>'accountCode',case when v_kind='EARNING' then v_employee.expense_account_code else '' end)),'MANUAL_REVIEWED',btrim(coalesce(v_concept->>'reference','')));
      end loop;
    end if;
    select coalesce(sum(amount) filter(where line_kind='EARNING'),0),coalesce(sum(amount) filter(where line_kind='DEDUCTION'),0)
      into v_income,v_deductions from public.erp_payroll_role_lines where company_id=p_company_id and role_item_id=v_item_id;
    if v_deductions>v_income then raise exception using errcode='23514',message='PAYROLL_V2_NEGATIVE_NET_NOT_ALLOWED'; end if;
    update public.erp_payroll_role_items set total_income=v_income,total_discounts=v_deductions,net_total=v_income-v_deductions,updated_at=clock_timestamp(),version=version+1
      where company_id=p_company_id and role_item_id=v_item_id;
  end loop;
  select count(*),coalesce(sum(total_income),0),coalesce(sum(total_discounts),0),coalesce(sum(net_total),0)
    into v_line,v_income,v_deductions,v_amount from public.erp_payroll_role_items where company_id=p_company_id and role_id=v_role_id;
  update public.erp_payroll_roles set status='CALCULATED',employee_count=v_line,total_income=v_income,total_discounts=v_deductions,net_total=v_amount,
    notes=btrim(coalesce(p_payload->>'notes',notes)),calculated_at=clock_timestamp(),calculated_by=auth.uid(),updated_at=clock_timestamp(),updated_by=auth.uid(),
    version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=v_role_id returning * into v_role;
  update public.erp_payroll_periods set status='CALCULATED',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and period_id=p_period_id;
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_CALCULATED','ROLE',v_role_id,jsonb_build_object('periodId',p_period_id,'netTotal',v_role.net_total));
  v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,v_role_id);
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('roleId',v_role_id,'roleNumber',v_role.role_number,'status',v_role.status));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_CALCULATE_ROLE',v_role_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_publish_role_bundle(
  p_company_id uuid,p_operation_id uuid,p_device_id text,p_role_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_roles%rowtype; i record; l record; s record; ps record; v_records jsonb:='[]'::jsonb;
begin
  select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id;
  v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_roles',r.role_id::text,
    jsonb_build_object('id',r.role_id,'roleId',r.role_id,'periodId',r.period_id,'roleNumber',r.role_number,'status',r.status,
      'employeeCount',r.employee_count,'totalIncome',r.total_income,'totalDiscounts',r.total_discounts,'netTotal',r.net_total,
      'journalEntryId',r.accrual_journal_entry_id,'createdAt',r.created_at,'calculatedAt',r.calculated_at,'approvedAt',r.approved_at,
      'postedAt',r.posted_at,'version',r.version,'syncFlow','PAYROLL_CORE_V2')));
  for i in select * from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop
    v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_items',i.role_item_id::text,
      jsonb_build_object('id',i.role_item_id,'roleItemId',i.role_item_id,'roleId',i.role_id,'employeeId',i.employee_id,
        'employeeCode',i.employee_code_snapshot,'employeeName',i.employee_name_snapshot,'position',i.position_snapshot,
        'calculationMode',i.calculation_mode_snapshot,'totalIncome',i.total_income,'totalDiscounts',i.total_discounts,'netTotal',i.net_total,
        'version',i.version,'syncFlow','PAYROLL_CORE_V2')));
    for l in select * from public.erp_payroll_role_lines where company_id=i.company_id and role_item_id=i.role_item_id order by line_order loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_lines',l.role_line_id::text,
        to_jsonb(l)||jsonb_build_object('id',l.role_line_id,'roleLineId',l.role_line_id,'roleItemId',l.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
    for s in select * from public.erp_payroll_performance_snapshots where company_id=i.company_id and role_item_id=i.role_item_id loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_performance_snapshots',s.snapshot_id::text,
        to_jsonb(s)||jsonb_build_object('id',s.snapshot_id,'snapshotId',s.snapshot_id,'roleItemId',s.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
    for ps in select * from public.erp_payroll_performance_policy_snapshots where company_id=i.company_id and role_item_id=i.role_item_id loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_policy_snapshots',ps.policy_snapshot_id::text,
        to_jsonb(ps)||jsonb_build_object('id',ps.policy_snapshot_id,'policySnapshotId',ps.policy_snapshot_id,'roleItemId',ps.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
  end loop;
  return v_records;
end $$;

create or replace function public.erp_payroll_core_v2_approve_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_expected_version bigint,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_records jsonb; v_result jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'APPROVE');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_ROLE:'||p_role_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
  if v_role.status='APPROVED' then
    v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,p_role_id);
  else
    if v_role.status<>'CALCULATED' then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_NOT_CALCULATED'; end if;
    if p_expected_version is null or v_role.version<>p_expected_version then raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT'; end if;
    update public.erp_payroll_performance_snapshots set frozen_at=clock_timestamp()
      where company_id=p_company_id and role_item_id in (select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id);
    update public.erp_payroll_performance_policy_snapshots set frozen_at=clock_timestamp()
      where company_id=p_company_id and role_item_id in (select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id);
    update public.erp_payroll_roles set status='APPROVED',approved_at=clock_timestamp(),approved_by=auth.uid(),updated_at=clock_timestamp(),
      updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id returning * into v_role;
    update public.erp_payroll_periods set status='APPROVED',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and period_id=v_role.period_id;
    perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_APPROVED','ROLE',p_role_id,jsonb_build_object('version',v_role.version));
    v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,p_role_id);
  end if;
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('roleId',p_role_id,'status','APPROVED'));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_APPROVE_ROLE',p_role_id::text,jsonb_build_object('expectedVersion',p_expected_version),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_get_performance(p_company_id uuid,p_employee_id uuid,p_period_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_period public.erp_payroll_periods%rowtype; v_rows jsonb; v_unlinked bigint; v_metrics jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'VIEW');
  select * into v_period from public.erp_payroll_periods where company_id=p_company_id and period_id=p_period_id;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_PERIOD_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.source_updated_at,x.source_record_id),'[]') into v_rows
  from public.erp_payroll_core_v2_performance_rows(p_company_id,p_employee_id,v_period.date_from,v_period.date_to) x;
  select count(*) into v_unlinked from public.erp_entity_records r where r.company_id=p_company_id and r.deleted_at is null
    and r.entity in ('operations_bunches','operations_performances') and r.updated_at::date between v_period.date_from and v_period.date_to
    and nullif(coalesce(r.payload->>'employee_id',r.payload->>'employeeId',r.payload->>'buncher_employee_id',r.payload->>'buncherEmployeeId',
      r.payload->>'operational_worker_id',r.payload->>'operationalWorkerId',''),'') is null;
  select coalesce(jsonb_agg(jsonb_build_object('policyId',p.policy_id,'policyVersion',p.policy_version,'operationalRole',p.operational_role,
    'salaryType',p.salary_type,'baseSalary',p.base_salary,'standardWorkdays',p.standard_workdays,'dailyTarget',p.daily_target,
    'periodTarget',p.monthly_target,'primaryUnit',p.primary_unit,'actualUnits',coalesce(x.actual,0),
    'performancePercentage',case when p.monthly_target>0 then round(coalesce(x.actual,0)/p.monthly_target*100,8) else 0 end,
    'referenceStemsTarget',p.reference_stems,'referenceStemsActual',round(coalesce(x.actual,0)*p.stems_per_unit,8)) order by p.operational_role),'[]') into v_metrics
  from public.erp_payroll_employee_policy_assignments a join public.erp_payroll_performance_policies p on p.company_id=a.company_id and p.policy_id=a.policy_id
  left join lateral (select sum(r.quantity) actual from public.erp_payroll_core_v2_performance_rows(p_company_id,p_employee_id,v_period.date_from,v_period.date_to) r
    where r.operational_role=p.operational_role) x on true
  where a.company_id=p_company_id and a.employee_id=p_employee_id and a.active and a.valid_from<=v_period.date_to
    and coalesce(a.valid_to,'infinity'::date)>=v_period.date_from and p.valid_from<=v_period.date_to and coalesce(p.valid_to,'infinity'::date)>=v_period.date_from;
  return jsonb_build_object('ok',true,'employeeId',p_employee_id,'periodId',p_period_id,'rows',v_rows,'policyMetrics',v_metrics,
    'totals',coalesce((select jsonb_object_agg(operational_role,total) from (select operational_role,round(sum(quantity),8) total
      from public.erp_payroll_core_v2_performance_rows(p_company_id,p_employee_id,v_period.date_from,v_period.date_to) group by operational_role) t),'{}'::jsonb),
    'unlinkedSourceCount',v_unlinked,'matchingPolicy','OPERATIONAL_WORKER_ID_ONLY');
end $$;

create or replace function public.erp_payroll_core_v2_get_bundle(p_company_id uuid,p_role_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_roles jsonb; v_periods jsonb; v_employees jsonb; v_links jsonb; v_settings jsonb; v_policies jsonb; v_assignments jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'VIEW');
  select coalesce(jsonb_agg(to_jsonb(e) order by e.employee_code),'[]') into v_employees from public.erp_payroll_employees e where e.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.employee_id,l.operational_role),'[]') into v_links from public.erp_payroll_employee_operational_roles l where l.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.operational_role,p.code,p.policy_version desc),'[]') into v_policies from public.erp_payroll_performance_policies p where p.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id,a.operational_role,a.valid_from desc),'[]') into v_assignments from public.erp_payroll_employee_policy_assignments a where a.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.date_from desc),'[]') into v_periods from public.erp_payroll_periods p where p.company_id=p_company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id',r.company_id,'role_id',r.role_id,'period_id',r.period_id,'role_number',r.role_number,'status',r.status,
    'employee_count',r.employee_count,'total_income',r.total_income,'total_discounts',r.total_discounts,'net_total',r.net_total,
    'accrual_journal_entry_id',r.accrual_journal_entry_id,'created_at',r.created_at,'calculated_at',r.calculated_at,'approved_at',r.approved_at,
    'posted_at',r.posted_at,'version',r.version,'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_order) from public.erp_payroll_role_lines l where l.company_id=i.company_id and l.role_item_id=i.role_item_id),'[]'::jsonb),
      'performance_snapshots',coalesce((select jsonb_agg(to_jsonb(s) order by s.operational_role,s.source_updated_at,s.source_record_id) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),'[]'::jsonb),
      'performance_policy_snapshots',coalesce((select jsonb_agg(to_jsonb(ps) order by ps.operational_role) from public.erp_payroll_performance_policy_snapshots ps where ps.company_id=i.company_id and ps.role_item_id=i.role_item_id),'[]'::jsonb)
    ) order by i.employee_name_snapshot) from public.erp_payroll_role_items i where i.company_id=r.company_id and i.role_id=r.role_id),'[]'::jsonb)
  ) order by r.created_at desc),'[]') into v_roles from public.erp_payroll_roles r where r.company_id=p_company_id and (p_role_id is null or r.role_id=p_role_id);
  select coalesce(to_jsonb(s),'{}') into v_settings from public.erp_payroll_accounting_settings s where s.company_id=p_company_id;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'employees',v_employees,'operationalRoles',v_links,
    'performancePolicies',v_policies,'policyAssignments',v_assignments,'periods',v_periods,'roles',v_roles,
    'accountingSettings',v_settings,'serverTime',clock_timestamp());
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
  return jsonb_build_object('ok',true,'component','PAYROLL_CORE_V2','migration','202608210002','companyId',p_company_id,
    'permissions',v_permissions,'capabilities',jsonb_build_array('payroll.view','payroll.manage','payroll.approve','payroll.post'),
    'employeeTable',to_regclass('public.erp_payroll_employees') is not null,'operationalRoleTable',to_regclass('public.erp_payroll_employee_operational_roles') is not null,
    'periodTable',to_regclass('public.erp_payroll_periods') is not null,'roleTable',to_regclass('public.erp_payroll_roles') is not null,
    'snapshotTable',to_regclass('public.erp_payroll_performance_snapshots') is not null,
    'performancePolicyTable',to_regclass('public.erp_payroll_performance_policies') is not null,
    'policyAssignmentTable',to_regclass('public.erp_payroll_employee_policy_assignments') is not null,
    'policySnapshotTable',to_regclass('public.erp_payroll_performance_policy_snapshots') is not null,
    'financialDependency',to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'postharvestParameterLink',true,'performancePolicy','VERSIONED_MEASUREMENT_V2','salaryImpact','NONE',
    'buncherSource','operations_bunches','classifierSource','operations_performances','serverTime',clock_timestamp());
end $$;

alter table public.erp_payroll_performance_policies enable row level security;
alter table public.erp_payroll_employee_policy_assignments enable row level security;
alter table public.erp_payroll_performance_policy_snapshots enable row level security;

drop policy if exists payroll_v2_select on public.erp_payroll_performance_policies;
create policy payroll_v2_select on public.erp_payroll_performance_policies for select to authenticated
  using(public.erp_payroll_core_v2_has_permission(company_id,'VIEW'));
drop policy if exists payroll_v2_select on public.erp_payroll_employee_policy_assignments;
create policy payroll_v2_select on public.erp_payroll_employee_policy_assignments for select to authenticated
  using(public.erp_payroll_core_v2_has_permission(company_id,'VIEW'));
drop policy if exists payroll_v2_select on public.erp_payroll_performance_policy_snapshots;
create policy payroll_v2_select on public.erp_payroll_performance_policy_snapshots for select to authenticated
  using(public.erp_payroll_core_v2_has_permission(company_id,'VIEW'));

revoke all on public.erp_payroll_performance_policies,public.erp_payroll_employee_policy_assignments,
  public.erp_payroll_performance_policy_snapshots from anon,authenticated;
grant select on public.erp_payroll_performance_policies,public.erp_payroll_employee_policy_assignments,
  public.erp_payroll_performance_policy_snapshots to authenticated;

revoke execute on function public.erp_payroll_performance_v2_snapshot_item(uuid,uuid,uuid,date,date,integer) from public,anon,authenticated;
revoke execute on function public.erp_payroll_performance_v2_save_policy(uuid,uuid,text,jsonb,uuid,bigint,timestamptz),
  public.erp_payroll_performance_v2_assign_policy(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamptz) from public,anon;
grant execute on function public.erp_payroll_performance_v2_save_policy(uuid,uuid,text,jsonb,uuid,bigint,timestamptz),
  public.erp_payroll_performance_v2_assign_policy(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamptz) to authenticated;

notify pgrst,'reload schema';
commit;
