-- Nómina V2 Fase 1: empleados, períodos, rendimiento, rol y contabilización.
-- Aditiva. No aplica ni depende de 202608160001_payroll_v2.sql.
-- No crea pagos, IESS, beneficios legales ni reglas tributarias definitivas.
begin;

create table if not exists public.erp_payroll_backend_versions (
  component text primary key,
  version text not null,
  installed_at timestamptz not null default clock_timestamp()
);
insert into public.erp_payroll_backend_versions(component,version)
values('PAYROLL_CORE_V2','202608200004')
on conflict(component) do update set version=excluded.version,installed_at=clock_timestamp();

create table if not exists public.erp_payroll_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  sequence_type text not null check(sequence_type in ('EMPLOYEE','ROLE')),
  calendar_year integer not null check(calendar_year between 2000 and 9999),
  last_value bigint not null default 0 check(last_value>=0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(company_id,sequence_type,calendar_year)
);

create table if not exists public.erp_payroll_user_permissions (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default false,
  can_manage boolean not null default false,
  can_approve boolean not null default false,
  can_post boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key(company_id,user_id)
);

create table if not exists public.erp_payroll_accounting_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  payroll_payable_account_code text not null default '',
  cost_center text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check(version>0)
);

create table if not exists public.erp_payroll_employees (
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null default gen_random_uuid(),
  identification text not null,
  employee_code text not null,
  full_name text not null,
  position_name text not null default '',
  area text not null default '',
  hire_date date,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE')),
  calculation_mode text not null default 'MONTHLY' check(calculation_mode in ('MONTHLY','HOURLY','PERFORMANCE','MIXED')),
  monthly_salary numeric(20,6) not null default 0 check(monthly_salary>=0),
  hourly_rate numeric(20,8) not null default 0 check(hourly_rate>=0),
  performance_rate numeric(20,8) not null default 0 check(performance_rate>=0),
  performance_unit text not null default 'UNITS',
  expense_account_code text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check(version>0),
  last_operation_id uuid not null,
  primary key(company_id,employee_id),
  unique(company_id,identification),
  unique(company_id,employee_code)
);

create table if not exists public.erp_payroll_employee_operational_roles (
  company_id uuid not null references public.companies(id) on delete cascade,
  link_id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  operational_module text not null default 'POSCOSECHA' check(operational_module='POSCOSECHA'),
  operational_role text not null check(operational_role in ('BUNCHER','CLASSIFIER')),
  operational_worker_id text not null,
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check(version>0),
  last_operation_id uuid not null,
  primary key(company_id,link_id),
  foreign key(company_id,employee_id) references public.erp_payroll_employees(company_id,employee_id),
  check(valid_to is null or valid_to>=valid_from)
);
create unique index if not exists erp_payroll_operational_role_active_uq
  on public.erp_payroll_employee_operational_roles(company_id,operational_module,operational_role,operational_worker_id)
  where active and valid_to is null;
create index if not exists erp_payroll_operational_role_employee_idx
  on public.erp_payroll_employee_operational_roles(company_id,employee_id,valid_from,valid_to);

create table if not exists public.erp_payroll_periods (
  company_id uuid not null references public.companies(id) on delete cascade,
  period_id uuid not null default gen_random_uuid(),
  year integer not null check(year between 2000 and 9999),
  month integer not null check(month between 1 and 12),
  date_from date not null,
  date_to date not null,
  status text not null default 'OPEN' check(status in ('OPEN','CALCULATED','APPROVED','POSTED','CLOSED')),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check(version>0),
  last_operation_id uuid not null,
  primary key(company_id,period_id),
  unique(company_id,year,month),
  check(date_to>=date_from)
);
create index if not exists erp_payroll_period_range_idx on public.erp_payroll_periods(company_id,date_from,date_to);

create table if not exists public.erp_payroll_roles (
  company_id uuid not null references public.companies(id) on delete cascade,
  role_id uuid not null default gen_random_uuid(),
  period_id uuid not null,
  role_number text not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','CALCULATED','APPROVED','POSTED')),
  employee_count integer not null default 0 check(employee_count>=0),
  total_income numeric(20,6) not null default 0 check(total_income>=0),
  total_discounts numeric(20,6) not null default 0 check(total_discounts>=0),
  net_total numeric(20,6) not null default 0 check(net_total>=0),
  accrual_journal_entry_id uuid,
  notes text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  calculated_at timestamptz,
  calculated_by uuid references auth.users(id),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check(version>0),
  last_operation_id uuid not null,
  primary key(company_id,role_id),
  unique(company_id,period_id),
  unique(company_id,role_number),
  foreign key(company_id,period_id) references public.erp_payroll_periods(company_id,period_id),
  check(round(net_total,6)=round(total_income-total_discounts,6))
);

create table if not exists public.erp_payroll_role_items (
  company_id uuid not null,
  role_item_id uuid not null default gen_random_uuid(),
  role_id uuid not null,
  employee_id uuid not null,
  employee_code_snapshot text not null,
  employee_name_snapshot text not null,
  position_snapshot text not null default '',
  calculation_mode_snapshot text not null,
  total_income numeric(20,6) not null default 0 check(total_income>=0),
  total_discounts numeric(20,6) not null default 0 check(total_discounts>=0),
  net_total numeric(20,6) not null default 0 check(net_total>=0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  version bigint not null default 1 check(version>0),
  last_operation_id uuid not null,
  primary key(company_id,role_item_id),
  unique(company_id,role_id,employee_id),
  foreign key(company_id,role_id) references public.erp_payroll_roles(company_id,role_id) on delete cascade,
  foreign key(company_id,employee_id) references public.erp_payroll_employees(company_id,employee_id),
  check(round(net_total,6)=round(total_income-total_discounts,6))
);

create table if not exists public.erp_payroll_role_lines (
  company_id uuid not null,
  role_line_id uuid not null default gen_random_uuid(),
  role_item_id uuid not null,
  line_order integer not null,
  line_kind text not null check(line_kind in ('EARNING','DEDUCTION')),
  concept_code text not null,
  concept_version integer not null default 1 check(concept_version>0),
  concept_label text not null,
  quantity numeric(20,8) not null default 1 check(quantity>=0),
  rate numeric(20,8) not null default 0 check(rate>=0),
  amount numeric(20,6) not null check(amount>=0),
  account_code text not null default '',
  source_type text not null default 'MANUAL',
  source_reference text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  primary key(company_id,role_line_id),
  unique(company_id,role_item_id,line_order),
  foreign key(company_id,role_item_id) references public.erp_payroll_role_items(company_id,role_item_id) on delete cascade
);

create table if not exists public.erp_payroll_performance_snapshots (
  company_id uuid not null,
  snapshot_id uuid not null default gen_random_uuid(),
  role_item_id uuid not null,
  employee_id uuid not null,
  operational_role text not null check(operational_role in ('BUNCHER','CLASSIFIER')),
  source_entity text not null,
  source_record_id text not null,
  source_version bigint not null default 0,
  source_updated_at timestamptz,
  period_from date not null,
  period_to date not null,
  quantity numeric(20,8) not null check(quantity>=0),
  unit text not null,
  applied_rate numeric(20,8) not null check(applied_rate>=0),
  calculated_value numeric(20,6) not null check(calculated_value>=0),
  source_fingerprint text not null,
  source_ids jsonb not null default '[]'::jsonb,
  frozen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(company_id,snapshot_id),
  unique(company_id,role_item_id,operational_role,source_entity,source_record_id),
  foreign key(company_id,role_item_id) references public.erp_payroll_role_items(company_id,role_item_id) on delete cascade,
  foreign key(company_id,employee_id) references public.erp_payroll_employees(company_id,employee_id)
);

create table if not exists public.erp_payroll_events (
  company_id uuid not null references public.companies(id) on delete cascade,
  event_id uuid not null default gen_random_uuid(),
  operation_id uuid not null,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  primary key(company_id,event_id),
  unique(company_id,operation_id,event_type,aggregate_id)
);
create index if not exists erp_payroll_events_aggregate_idx on public.erp_payroll_events(company_id,aggregate_type,aggregate_id,created_at);

-- Continúa por encima de cualquier código histórico sincronizado. No renumera.
insert into public.erp_payroll_sequence_counters(company_id,sequence_type,calendar_year,last_value)
select company_id,'EMPLOYEE',extract(year from current_date)::integer,
  coalesce(max((regexp_match(coalesce(payload->>'employeeCode',payload->>'code',''),'([0-9]+)$'))[1]::bigint),0)
from public.erp_entity_records where entity in ('payroll_employees','payroll_v2_employees') and deleted_at is null group by company_id
on conflict(company_id,sequence_type,calendar_year) do update set last_value=greatest(public.erp_payroll_sequence_counters.last_value,excluded.last_value);
insert into public.erp_payroll_sequence_counters(company_id,sequence_type,calendar_year,last_value)
select company_id,'ROLE',extract(year from current_date)::integer,
  coalesce(max((regexp_match(coalesce(payload->>'roleNumber',payload->>'number',''),'([0-9]+)$'))[1]::bigint),0)
from public.erp_entity_records where entity in ('payroll_runs','payroll_v2_roles') and deleted_at is null group by company_id
on conflict(company_id,sequence_type,calendar_year) do update set last_value=greatest(public.erp_payroll_sequence_counters.last_value,excluded.last_value);

create or replace function public.erp_payroll_core_v2_is_admin(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(public.erp_is_company_admin(p_company_id),false)
$$;

create or replace function public.erp_payroll_core_v2_has_permission(p_company_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.erp_payroll_core_v2_is_admin(p_company_id) or exists(
    select 1 from public.erp_payroll_user_permissions p
    where p.company_id=p_company_id and p.user_id=auth.uid()
      and case upper(btrim(p_capability))
        when 'VIEW' then p.can_view
        when 'MANAGE' then p.can_manage
        when 'APPROVE' then p.can_approve
        when 'POST' then p.can_post
        else false end
  )
$$;

create or replace function public.erp_payroll_core_v2_assert_permission(p_company_id uuid,p_capability text)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id) then
    raise exception using errcode='42501',message='PAYROLL_V2_COMPANY_ACCESS_DENIED';
  end if;
  if not public.erp_payroll_core_v2_has_permission(p_company_id,p_capability) then
    raise exception using errcode='42501',message='PAYROLL_V2_PERMISSION_DENIED:'||upper(btrim(p_capability));
  end if;
end $$;

create or replace function public.erp_payroll_core_v2_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_admin boolean; v_permissions jsonb;
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id) then
    raise exception using errcode='42501',message='PAYROLL_V2_COMPANY_ACCESS_DENIED';
  end if;
  v_admin:=public.erp_payroll_core_v2_is_admin(p_company_id);
  select jsonb_build_object(
    'view',v_admin or coalesce(p.can_view,false),
    'manage',v_admin or coalesce(p.can_manage,false),
    'approve',v_admin or coalesce(p.can_approve,false),
    'post',v_admin or coalesce(p.can_post,false)
  ) into v_permissions
  from (select 1) x left join public.erp_payroll_user_permissions p
    on p.company_id=p_company_id and p.user_id=auth.uid();
  return jsonb_build_object(
    'ok',true,'component','PAYROLL_CORE_V2','migration','202608200004','companyId',p_company_id,
    'permissions',v_permissions,
    'capabilities',jsonb_build_array('payroll.view','payroll.manage','payroll.approve','payroll.post'),
    'employeeTable',to_regclass('public.erp_payroll_employees') is not null,
    'operationalRoleTable',to_regclass('public.erp_payroll_employee_operational_roles') is not null,
    'periodTable',to_regclass('public.erp_payroll_periods') is not null,
    'roleTable',to_regclass('public.erp_payroll_roles') is not null,
    'snapshotTable',to_regclass('public.erp_payroll_performance_snapshots') is not null,
    'financialDependency',to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'serverTime',clock_timestamp()
  );
end $$;

create or replace function public.erp_payroll_core_v2_set_permissions(
  p_company_id uuid,p_user_id uuid,p_can_view boolean,p_can_manage boolean,p_can_approve boolean,p_can_post boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.erp_payroll_core_v2_is_admin(p_company_id) then
    raise exception using errcode='42501',message='PAYROLL_V2_ADMIN_REQUIRED';
  end if;
  if not public.erp_is_company_member(p_company_id,p_user_id) then
    raise exception using errcode='23514',message='PAYROLL_V2_USER_NOT_COMPANY_MEMBER';
  end if;
  insert into public.erp_payroll_user_permissions(company_id,user_id,can_view,can_manage,can_approve,can_post,created_by,updated_by)
  values(p_company_id,p_user_id,p_can_view,p_can_manage,p_can_approve,p_can_post,auth.uid(),auth.uid())
  on conflict(company_id,user_id) do update set can_view=excluded.can_view,can_manage=excluded.can_manage,
    can_approve=excluded.can_approve,can_post=excluded.can_post,updated_at=clock_timestamp(),updated_by=auth.uid();
  return jsonb_build_object('ok',true,'companyId',p_company_id,'userId',p_user_id);
end $$;

create or replace function public.erp_payroll_core_v2_next_code(p_company_id uuid,p_type text,p_date date)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_year integer:=extract(year from coalesce(p_date,current_date)); v_value bigint; v_prefix text;
begin
  if upper(btrim(p_type)) not in ('EMPLOYEE','ROLE') then raise exception using errcode='22023',message='PAYROLL_V2_SEQUENCE_INVALID'; end if;
  v_prefix:=case upper(btrim(p_type)) when 'EMPLOYEE' then 'EMP' else 'ROL' end;
  insert into public.erp_payroll_sequence_counters(company_id,sequence_type,calendar_year,last_value)
  values(p_company_id,upper(btrim(p_type)),v_year,1)
  on conflict(company_id,sequence_type,calendar_year) do update
    set last_value=public.erp_payroll_sequence_counters.last_value+1,updated_at=clock_timestamp()
  returning last_value into v_value;
  return v_prefix||'-'||v_year::text||'-'||lpad(v_value::text,6,'0');
end $$;

create or replace function public.erp_payroll_core_v2_write_event(
  p_company_id uuid,p_operation_id uuid,p_event_type text,p_aggregate_type text,p_aggregate_id uuid,p_payload jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  insert into public.erp_payroll_events(company_id,operation_id,event_type,aggregate_type,aggregate_id,payload,created_by)
  values(p_company_id,p_operation_id,upper(btrim(p_event_type)),upper(btrim(p_aggregate_type)),p_aggregate_id,coalesce(p_payload,'{}'),auth.uid())
  on conflict(company_id,operation_id,event_type,aggregate_id) do update set payload=excluded.payload
  returning event_id into v_id;
  return v_id;
end $$;

create or replace function public.erp_payroll_core_v2_publish(
  p_company_id uuid,p_operation_id uuid,p_device_id text,p_entity text,p_record_id text,p_payload jsonb
) returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,p_entity,p_record_id,
    p_payload,coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity=p_entity and record_id=p_record_id),0))
$$;

create or replace function public.erp_payroll_core_v2_upsert_employee(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_expected_version bigint default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_row public.erp_payroll_employees%rowtype;
 v_id uuid:=coalesce(nullif(p_payload->>'employeeId','')::uuid,gen_random_uuid()); v_code text; v_result jsonb; v_record jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  if nullif(btrim(p_payload->>'identification'),'') is null or nullif(btrim(p_payload->>'fullName'),'') is null then
    raise exception using errcode='22023',message='PAYROLL_V2_EMPLOYEE_REQUIRED_FIELDS';
  end if;
  select * into v_row from public.erp_payroll_employees where company_id=p_company_id and employee_id=v_id for update;
  if not found then
    select * into v_row from public.erp_payroll_employees where company_id=p_company_id and identification=btrim(p_payload->>'identification') for update;
    if found then v_id:=v_row.employee_id; end if;
  end if;
  if found and p_expected_version is not null and v_row.version<>p_expected_version then
    raise exception using errcode='40001',message='PAYROLL_V2_EMPLOYEE_VERSION_CONFLICT';
  end if;
  v_code:=case when found then v_row.employee_code else public.erp_payroll_core_v2_next_code(p_company_id,'EMPLOYEE',current_date) end;
  insert into public.erp_payroll_employees(company_id,employee_id,identification,employee_code,full_name,position_name,area,hire_date,status,
    calculation_mode,monthly_salary,hourly_rate,performance_rate,performance_unit,expense_account_code,created_by,updated_by,last_operation_id)
  values(p_company_id,v_id,btrim(p_payload->>'identification'),v_code,btrim(p_payload->>'fullName'),btrim(coalesce(p_payload->>'position','')),
    btrim(coalesce(p_payload->>'area','')),nullif(p_payload->>'hireDate','')::date,upper(coalesce(nullif(p_payload->>'status',''),'ACTIVE')),
    upper(coalesce(nullif(p_payload->>'calculationMode',''),'MONTHLY')),coalesce(nullif(p_payload->>'monthlySalary','')::numeric,0),
    coalesce(nullif(p_payload->>'hourlyRate','')::numeric,0),coalesce(nullif(p_payload->>'performanceRate','')::numeric,0),
    upper(coalesce(nullif(p_payload->>'performanceUnit',''),'UNITS')),btrim(coalesce(p_payload->>'expenseAccountCode','')),auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,employee_id) do update set identification=excluded.identification,full_name=excluded.full_name,
    position_name=excluded.position_name,area=excluded.area,hire_date=excluded.hire_date,status=excluded.status,
    calculation_mode=excluded.calculation_mode,monthly_salary=excluded.monthly_salary,hourly_rate=excluded.hourly_rate,
    performance_rate=excluded.performance_rate,performance_unit=excluded.performance_unit,expense_account_code=excluded.expense_account_code,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=public.erp_payroll_employees.version+1,last_operation_id=p_operation_id
  returning * into v_row;
  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_employees',v_id::text,
    jsonb_build_object('id',v_id,'employeeId',v_id,'employeeCode',v_row.employee_code,'identification',v_row.identification,
      'fullName',v_row.full_name,'position',v_row.position_name,'area',v_row.area,'hireDate',v_row.hire_date,'status',v_row.status,
      'calculationMode',v_row.calculation_mode,'monthlySalary',v_row.monthly_salary,'hourlyRate',v_row.hourly_rate,
      'performanceRate',v_row.performance_rate,'performanceUnit',v_row.performance_unit,'expenseAccountCode',v_row.expense_account_code,
      'version',v_row.version,'updatedAtServer',v_row.updated_at,'syncFlow','PAYROLL_CORE_V2'));
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'EMPLOYEE_UPSERTED','EMPLOYEE',v_id,jsonb_build_object('version',v_row.version));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_record),'result',jsonb_build_object('employeeId',v_id,'employeeCode',v_row.employee_code));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_UPSERT_EMPLOYEE',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_link_operational_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_employee_id uuid,p_operational_role text,p_operational_worker_id text,
  p_valid_from date,p_valid_to date default null,p_active boolean default true,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_link public.erp_payroll_employee_operational_roles%rowtype; v_result jsonb; v_record jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  if upper(btrim(p_operational_role)) not in ('BUNCHER','CLASSIFIER') or nullif(btrim(p_operational_worker_id),'') is null then
    raise exception using errcode='22023',message='PAYROLL_V2_OPERATIONAL_ROLE_INVALID';
  end if;
  perform 1 from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_employee_id and status='ACTIVE';
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||upper(btrim(p_operational_role))||':'||btrim(p_operational_worker_id),0));
  select * into v_link from public.erp_payroll_employee_operational_roles where company_id=p_company_id and employee_id=p_employee_id
    and operational_role=upper(btrim(p_operational_role)) and operational_worker_id=btrim(p_operational_worker_id)
    order by created_at desc limit 1 for update;
  if found then
    update public.erp_payroll_employee_operational_roles set valid_from=p_valid_from,valid_to=p_valid_to,active=p_active,
      updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and link_id=v_link.link_id returning * into v_link;
  else
    insert into public.erp_payroll_employee_operational_roles(company_id,employee_id,operational_role,operational_worker_id,valid_from,valid_to,active,created_by,updated_by,last_operation_id)
    values(p_company_id,p_employee_id,upper(btrim(p_operational_role)),btrim(p_operational_worker_id),p_valid_from,p_valid_to,p_active,auth.uid(),auth.uid(),p_operation_id)
    returning * into v_link;
  end if;
  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_operational_roles',v_link.link_id::text,
    jsonb_build_object('id',v_link.link_id,'linkId',v_link.link_id,'employeeId',v_link.employee_id,'operationalModule','POSCOSECHA',
      'operationalRole',v_link.operational_role,'operationalWorkerId',v_link.operational_worker_id,'validFrom',v_link.valid_from,
      'validTo',v_link.valid_to,'active',v_link.active,'version',v_link.version,'syncFlow','PAYROLL_CORE_V2'));
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'OPERATIONAL_ROLE_LINKED','EMPLOYEE',p_employee_id,jsonb_build_object('linkId',v_link.link_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_record),'result',jsonb_build_object('linkId',v_link.link_id));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_LINK_OPERATIONAL_ROLE',v_link.link_id::text,jsonb_build_object('employeeId',p_employee_id,'operationalRole',p_operational_role,'operationalWorkerId',p_operational_worker_id),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_create_period(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_year integer,p_month integer,p_date_from date,p_date_to date,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_period public.erp_payroll_periods%rowtype; v_result jsonb; v_record jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PERIOD:'||p_year::text||':'||p_month::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  if p_month not between 1 and 12 or p_date_to<p_date_from or extract(year from p_date_from)<>p_year or extract(month from p_date_from)<>p_month then
    raise exception using errcode='22023',message='PAYROLL_V2_PERIOD_INVALID';
  end if;
  if exists(select 1 from public.erp_payroll_periods where company_id=p_company_id and daterange(date_from,date_to,'[]') && daterange(p_date_from,p_date_to,'[]') and (year<>p_year or month<>p_month)) then
    raise exception using errcode='23505',message='PAYROLL_V2_PERIOD_OVERLAP';
  end if;
  insert into public.erp_payroll_periods(company_id,year,month,date_from,date_to,created_by,updated_by,last_operation_id)
  values(p_company_id,p_year,p_month,p_date_from,p_date_to,auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,year,month) do nothing;
  select * into v_period from public.erp_payroll_periods where company_id=p_company_id and year=p_year and month=p_month;
  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_periods',v_period.period_id::text,
    jsonb_build_object('id',v_period.period_id,'periodId',v_period.period_id,'year',v_period.year,'month',v_period.month,
      'dateFrom',v_period.date_from,'dateTo',v_period.date_to,'status',v_period.status,'version',v_period.version,'syncFlow','PAYROLL_CORE_V2'));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_record),'result',jsonb_build_object('periodId',v_period.period_id));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_CREATE_PERIOD',v_period.period_id::text,jsonb_build_object('year',p_year,'month',p_month),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
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
  ), source_rows as (
    select l.operational_role,r.entity,r.record_id,r.version,r.updated_at,r.payload,
      case
        when coalesce(r.payload->>'date',r.payload->>'workDate',r.payload->>'work_date',r.payload->>'createdAt',r.payload->>'created_at','') ~ '^\d{4}-\d{2}-\d{2}'
        then left(coalesce(r.payload->>'date',r.payload->>'workDate',r.payload->>'work_date',r.payload->>'createdAt',r.payload->>'created_at'),10)::date
        else r.updated_at::date end as work_date
    from links l join public.erp_entity_records r on r.company_id=l.company_id and r.deleted_at is null
      and r.entity=case l.operational_role when 'BUNCHER' then 'operations_bunch_entries' else 'operations_mesh_records' end
      and l.operational_worker_id in (
        coalesce(r.payload->>'operational_worker_id',''),coalesce(r.payload->>'operationalWorkerId',''),
        coalesce(r.payload->>'buncher_id',''),coalesce(r.payload->>'buncherId',''),
        coalesce(r.payload->>'classifier_id',''),coalesce(r.payload->>'classifierId',''),
        coalesce(r.payload->>'buncher_employee_id',''),coalesce(r.payload->>'buncherEmployeeId',''),
        coalesce(r.payload->>'classifier_employee_id',''),coalesce(r.payload->>'classifierEmployeeId',''),
        coalesce(r.payload->>'employee_id',''),coalesce(r.payload->>'employeeId','')
      )
  )
  select operational_role,entity,record_id,version,updated_at,
    greatest(0,case operational_role
      when 'BUNCHER' then coalesce(nullif(payload->>'quantity','')::numeric,nullif(payload->>'bunchCount','')::numeric,1)
      else coalesce(nullif(payload->>'totalStems','')::numeric,nullif(payload->>'total_stems','')::numeric,
        nullif(payload->>'stems','')::numeric,nullif(payload->>'quantity','')::numeric,0) end),
    case operational_role when 'BUNCHER' then 'BUNCHES' else 'STEMS' end
  from source_rows where work_date between p_date_from and p_date_to
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
  select count(*) into v_unlinked from public.erp_entity_records r
  where r.company_id=p_company_id and r.deleted_at is null and r.entity in ('operations_bunch_entries','operations_mesh_records')
    and r.updated_at::date between v_period.date_from and v_period.date_to
    and nullif(coalesce(r.payload->>'employee_id',r.payload->>'employeeId',r.payload->>'buncher_employee_id',r.payload->>'buncherEmployeeId',
      r.payload->>'classifier_employee_id',r.payload->>'classifierEmployeeId',r.payload->>'operational_worker_id',r.payload->>'operationalWorkerId',''),'') is null;
  return jsonb_build_object('ok',true,'employeeId',p_employee_id,'periodId',p_period_id,'rows',v_rows,
    'totals',coalesce((select jsonb_object_agg(operational_role,total) from (
      select operational_role,round(sum(quantity),8) total from public.erp_payroll_core_v2_performance_rows(p_company_id,p_employee_id,v_period.date_from,v_period.date_to) group by operational_role
    ) t),'{}'::jsonb),'unlinkedSourceCount',v_unlinked,'matchingPolicy','UUID_ONLY');
end $$;

create or replace function public.erp_payroll_core_v2_publish_role_bundle(
  p_company_id uuid,p_operation_id uuid,p_device_id text,p_role_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_roles%rowtype; i record; l record; s record; v_records jsonb:='[]'::jsonb;
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
    for l in select * from public.erp_payroll_role_lines where company_id=p_company_id and role_item_id=i.role_item_id order by line_order loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_lines',l.role_line_id::text,
        jsonb_build_object('id',l.role_line_id,'roleLineId',l.role_line_id,'roleItemId',l.role_item_id,'lineOrder',l.line_order,
          'lineKind',l.line_kind,'conceptCode',l.concept_code,'conceptVersion',l.concept_version,'conceptLabel',l.concept_label,
          'quantity',l.quantity,'rate',l.rate,'amount',l.amount,'accountCode',l.account_code,'sourceType',l.source_type,
          'sourceReference',l.source_reference,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
    for s in select * from public.erp_payroll_performance_snapshots where company_id=p_company_id and role_item_id=i.role_item_id loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_performance_snapshots',s.snapshot_id::text,
        jsonb_build_object('id',s.snapshot_id,'snapshotId',s.snapshot_id,'roleItemId',s.role_item_id,'employeeId',s.employee_id,
          'operationalRole',s.operational_role,'sourceEntity',s.source_entity,'sourceRecordId',s.source_record_id,'sourceVersion',s.source_version,
          'sourceUpdatedAt',s.source_updated_at,'periodFrom',s.period_from,'periodTo',s.period_to,'quantity',s.quantity,'unit',s.unit,
          'appliedRate',s.applied_rate,'calculatedValue',s.calculated_value,'sourceIds',s.source_ids,'frozenAt',s.frozen_at,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
  end loop;
  return v_records;
end $$;

create or replace function public.erp_payroll_core_v2_calculate_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_period_id uuid,p_payload jsonb,p_expected_version bigint default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_period public.erp_payroll_periods%rowtype; v_role public.erp_payroll_roles%rowtype;
 v_employee public.erp_payroll_employees%rowtype; v_item_id uuid; v_employee_id uuid; v_payload_item jsonb; v_concept jsonb; v_perf record;
 v_line integer; v_income numeric; v_deductions numeric; v_amount numeric; v_qty numeric; v_rate numeric; v_kind text; v_code text;
 v_role_id uuid; v_records jsonb; v_result jsonb;
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
    if v_employee.calculation_mode in ('MONTHLY','MIXED') and v_employee.monthly_salary>0 then
      v_line:=v_line+1;
      insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type)
      values(p_company_id,v_item_id,v_line,'EARNING','SALARY','Sueldo',1,v_employee.monthly_salary,v_employee.monthly_salary,v_employee.expense_account_code,'EMPLOYEE_MASTER');
    end if;
    for v_perf in select operational_role,source_entity,source_record_id,source_version,source_updated_at,quantity,unit
      from public.erp_payroll_core_v2_performance_rows(p_company_id,v_employee_id,v_period.date_from,v_period.date_to) loop
      v_rate:=v_employee.performance_rate; v_amount:=round(v_perf.quantity*v_rate,6);
      insert into public.erp_payroll_performance_snapshots(company_id,role_item_id,employee_id,operational_role,source_entity,source_record_id,
        source_version,source_updated_at,period_from,period_to,quantity,unit,applied_rate,calculated_value,source_fingerprint,source_ids)
      values(p_company_id,v_item_id,v_employee_id,v_perf.operational_role,v_perf.source_entity,v_perf.source_record_id,v_perf.source_version,
        v_perf.source_updated_at,v_period.date_from,v_period.date_to,v_perf.quantity,v_perf.unit,v_rate,v_amount,
        md5(v_perf.source_entity||':'||v_perf.source_record_id||':'||v_perf.source_version::text||':'||v_perf.quantity::text),jsonb_build_array(v_perf.source_record_id));
    end loop;
    for v_perf in select operational_role,sum(quantity) quantity,min(unit) unit,sum(calculated_value) calculated_value
      from public.erp_payroll_performance_snapshots where company_id=p_company_id and role_item_id=v_item_id group by operational_role loop
      if v_perf.quantity>0 then
        v_line:=v_line+1;
        insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference)
        values(p_company_id,v_item_id,v_line,'EARNING','PERFORMANCE','Rendimiento '||case v_perf.operational_role when 'BUNCHER' then 'Embonche' else 'Clasificación' end,
          v_perf.quantity,v_employee.performance_rate,round(v_perf.calculated_value,6),v_employee.expense_account_code,'POSCOSECHA_UUID',v_perf.operational_role);
      end if;
    end loop;
    if jsonb_typeof(coalesce(v_payload_item->'concepts','[]'))='array' then
      for v_concept in select value from jsonb_array_elements(v_payload_item->'concepts') loop
        v_code:=upper(btrim(v_concept->>'code')); v_kind:=upper(btrim(v_concept->>'kind'));
        if (v_kind='EARNING' and v_code not in ('NORMAL_HOURS','OVERTIME','TRANSPORT','BONUS','COMMISSION','OTHER_INCOME'))
          or (v_kind='DEDUCTION' and v_code not in ('FOOD','ADVANCE','OTHER_DISCOUNTS')) then
          raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_NOT_ALLOWED:'||coalesce(v_code,'');
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
    if v_role.employee_count<=0 or v_role.net_total<0 then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_TOTAL_INVALID'; end if;
    update public.erp_payroll_performance_snapshots set frozen_at=clock_timestamp()
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

create or replace function public.erp_payroll_core_v2_post_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_expected_version bigint,p_accounting_date date default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_period public.erp_payroll_periods%rowtype;
 v_settings public.erp_payroll_accounting_settings%rowtype; v_entry_id uuid; v_lines jsonb; v_records jsonb; v_result jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'POST');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_ROLE:'||p_role_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  select * into v_role from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update;
  if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
  if v_role.status='POSTED' and v_role.accrual_journal_entry_id is not null then
    v_entry_id:=v_role.accrual_journal_entry_id;
  else
    if v_role.status<>'APPROVED' then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_NOT_APPROVED'; end if;
    if p_expected_version is null or v_role.version<>p_expected_version then raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT'; end if;
    select * into v_settings from public.erp_payroll_accounting_settings where company_id=p_company_id;
    if not found or nullif(btrim(v_settings.payroll_payable_account_code),'') is null then raise exception using errcode='23514',message='PAYROLL_V2_ACCOUNTING_SETTINGS_REQUIRED'; end if;
    if exists(select 1 from public.erp_payroll_role_lines l join public.erp_payroll_role_items i on i.company_id=l.company_id and i.role_item_id=l.role_item_id
      where i.company_id=p_company_id and i.role_id=p_role_id and l.amount>0 and nullif(btrim(l.account_code),'') is null) then
      raise exception using errcode='23514',message='PAYROLL_V2_LINE_ACCOUNT_REQUIRED';
    end if;
    select * into v_period from public.erp_payroll_periods where company_id=p_company_id and period_id=v_role.period_id;
    select jsonb_agg(x.line order by x.sort_key,x.account_code) into v_lines from (
      select 1 sort_key,l.account_code,jsonb_build_object('accountCode',l.account_code,'debit',round(sum(l.amount),6),'credit',0,
        'costCenter',v_settings.cost_center,'auxiliary','','lineDescription','Gasto nómina '||v_role.role_number,'documentReference',v_role.role_number) line
      from public.erp_payroll_role_lines l join public.erp_payroll_role_items i on i.company_id=l.company_id and i.role_item_id=l.role_item_id
      where i.company_id=p_company_id and i.role_id=p_role_id and l.line_kind='EARNING' and l.amount>0 group by l.account_code
      union all
      select 2,l.account_code,jsonb_build_object('accountCode',l.account_code,'debit',0,'credit',round(sum(l.amount),6),
        'costCenter',v_settings.cost_center,'auxiliary','','lineDescription','Descuento nómina '||v_role.role_number,'documentReference',v_role.role_number)
      from public.erp_payroll_role_lines l join public.erp_payroll_role_items i on i.company_id=l.company_id and i.role_item_id=l.role_item_id
      where i.company_id=p_company_id and i.role_id=p_role_id and l.line_kind='DEDUCTION' and l.amount>0 group by l.account_code
      union all
      select 3,v_settings.payroll_payable_account_code,jsonb_build_object('accountCode',v_settings.payroll_payable_account_code,'debit',0,'credit',v_role.net_total,
        'costCenter',v_settings.cost_center,'auxiliary','','lineDescription','Nómina por pagar '||v_role.role_number,'documentReference',v_role.role_number)
    ) x;
    v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
      jsonb_build_object('accountingDate',coalesce(p_accounting_date,v_period.date_to),'concept','Rol de pagos '||v_role.role_number,
        'originModule','Nómina','sourceDocument',v_role.role_number,'externalReference',v_role.period_id,'currencyCode','USD','exchangeRate',1,
        'lines',v_lines,'observation','Nómina V2 Fase 1'),'PAYROLL_ROLE',p_role_id::text,'POST_PAYROLL_ROLE');
    update public.erp_payroll_roles set status='POSTED',accrual_journal_entry_id=v_entry_id,posted_at=clock_timestamp(),posted_by=auth.uid(),
      updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and role_id=p_role_id returning * into v_role;
    update public.erp_payroll_periods set status='POSTED',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and period_id=v_role.period_id;
    perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_POSTED','ROLE',p_role_id,jsonb_build_object('journalEntryId',v_entry_id));
  end if;
  v_records:=jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id))
    ||public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,p_role_id);
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('roleId',p_role_id,'status','POSTED','journalEntryId',v_entry_id));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_POST_ROLE',p_role_id::text,jsonb_build_object('expectedVersion',p_expected_version,'accountingDate',p_accounting_date),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_get_bundle(p_company_id uuid,p_role_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_roles jsonb; v_periods jsonb; v_employees jsonb; v_links jsonb; v_settings jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'VIEW');
  select coalesce(jsonb_agg(to_jsonb(e) order by e.employee_code),'[]') into v_employees from public.erp_payroll_employees e where e.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.employee_id,l.operational_role),'[]') into v_links from public.erp_payroll_employee_operational_roles l where l.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.date_from desc),'[]') into v_periods from public.erp_payroll_periods p where p.company_id=p_company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id',r.company_id,'role_id',r.role_id,'period_id',r.period_id,'role_number',r.role_number,'status',r.status,
    'employee_count',r.employee_count,'total_income',r.total_income,'total_discounts',r.total_discounts,'net_total',r.net_total,
    'accrual_journal_entry_id',r.accrual_journal_entry_id,'created_at',r.created_at,'calculated_at',r.calculated_at,'approved_at',r.approved_at,
    'posted_at',r.posted_at,'version',r.version,'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_order) from public.erp_payroll_role_lines l where l.company_id=i.company_id and l.role_item_id=i.role_item_id),'[]'::jsonb),
      'performance_snapshots',coalesce((select jsonb_agg(to_jsonb(s) order by s.operational_role,s.source_updated_at,s.source_record_id) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),'[]'::jsonb)
    ) order by i.employee_name_snapshot) from public.erp_payroll_role_items i where i.company_id=r.company_id and i.role_id=r.role_id),'[]'::jsonb)
  ) order by r.created_at desc),'[]') into v_roles from public.erp_payroll_roles r where r.company_id=p_company_id and (p_role_id is null or r.role_id=p_role_id);
  select coalesce(to_jsonb(s),'{}') into v_settings from public.erp_payroll_accounting_settings s where s.company_id=p_company_id;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'employees',v_employees,'operationalRoles',v_links,'periods',v_periods,
    'roles',v_roles,'accountingSettings',v_settings,'serverTime',clock_timestamp());
end $$;

create or replace function public.erp_payroll_core_v2_save_accounting_settings(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payroll_payable_account_code text,p_cost_center text default ''
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'POST');
  perform public.erp_financial_v2_validate_account(p_company_id,p_payroll_payable_account_code);
  insert into public.erp_payroll_accounting_settings(company_id,payroll_payable_account_code,cost_center,created_by,updated_by)
  values(p_company_id,btrim(p_payroll_payable_account_code),btrim(coalesce(p_cost_center,'')),auth.uid(),auth.uid())
  on conflict(company_id) do update set payroll_payable_account_code=excluded.payroll_payable_account_code,cost_center=excluded.cost_center,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=public.erp_payroll_accounting_settings.version+1;
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ACCOUNTING_SETTINGS_UPDATED','COMPANY',p_company_id,
    jsonb_build_object('payrollPayableAccountCode',p_payroll_payable_account_code,'costCenter',p_cost_center));
  return jsonb_build_object('ok',true,'companyId',p_company_id);
end $$;

alter table public.erp_payroll_sequence_counters enable row level security;
alter table public.erp_payroll_user_permissions enable row level security;
alter table public.erp_payroll_accounting_settings enable row level security;
alter table public.erp_payroll_employees enable row level security;
alter table public.erp_payroll_employee_operational_roles enable row level security;
alter table public.erp_payroll_periods enable row level security;
alter table public.erp_payroll_roles enable row level security;
alter table public.erp_payroll_role_items enable row level security;
alter table public.erp_payroll_role_lines enable row level security;
alter table public.erp_payroll_performance_snapshots enable row level security;
alter table public.erp_payroll_events enable row level security;

do $$ declare t text; begin
  foreach t in array array['erp_payroll_sequence_counters','erp_payroll_user_permissions','erp_payroll_accounting_settings','erp_payroll_employees',
    'erp_payroll_employee_operational_roles','erp_payroll_periods','erp_payroll_roles','erp_payroll_role_items','erp_payroll_role_lines',
    'erp_payroll_performance_snapshots','erp_payroll_events'] loop
    execute format('drop policy if exists payroll_v2_select on public.%I',t);
    execute format('create policy payroll_v2_select on public.%I for select to authenticated using (public.erp_payroll_core_v2_has_permission(company_id,''VIEW''))',t);
  end loop;
end $$;

revoke all on public.erp_payroll_backend_versions,public.erp_payroll_sequence_counters,public.erp_payroll_user_permissions,
  public.erp_payroll_accounting_settings,public.erp_payroll_employees,public.erp_payroll_employee_operational_roles,
  public.erp_payroll_periods,public.erp_payroll_roles,public.erp_payroll_role_items,public.erp_payroll_role_lines,
  public.erp_payroll_performance_snapshots,public.erp_payroll_events from anon,authenticated;
grant select on public.erp_payroll_user_permissions,public.erp_payroll_accounting_settings,public.erp_payroll_employees,
  public.erp_payroll_employee_operational_roles,public.erp_payroll_periods,public.erp_payroll_roles,public.erp_payroll_role_items,
  public.erp_payroll_role_lines,public.erp_payroll_performance_snapshots,public.erp_payroll_events to authenticated;

revoke execute on function public.erp_payroll_core_v2_is_admin(uuid),public.erp_payroll_core_v2_has_permission(uuid,text),
  public.erp_payroll_core_v2_assert_permission(uuid,text),public.erp_payroll_core_v2_next_code(uuid,text,date),
  public.erp_payroll_core_v2_write_event(uuid,uuid,text,text,uuid,jsonb),public.erp_payroll_core_v2_publish(uuid,uuid,text,text,text,jsonb),
  public.erp_payroll_core_v2_performance_rows(uuid,uuid,date,date),public.erp_payroll_core_v2_publish_role_bundle(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.erp_payroll_core_v2_health(uuid),public.erp_payroll_core_v2_set_permissions(uuid,uuid,boolean,boolean,boolean,boolean),
  public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamptz),
  public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamptz),
  public.erp_payroll_core_v2_create_period(uuid,uuid,text,integer,integer,date,date,timestamptz),
  public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid),
  public.erp_payroll_core_v2_calculate_role(uuid,uuid,text,uuid,jsonb,bigint,timestamptz),
  public.erp_payroll_core_v2_approve_role(uuid,uuid,text,uuid,bigint,timestamptz),
  public.erp_payroll_core_v2_post_role(uuid,uuid,text,uuid,bigint,date,timestamptz),
  public.erp_payroll_core_v2_get_bundle(uuid,uuid),public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.erp_payroll_core_v2_health(uuid),public.erp_payroll_core_v2_set_permissions(uuid,uuid,boolean,boolean,boolean,boolean),
  public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamptz),
  public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamptz),
  public.erp_payroll_core_v2_create_period(uuid,uuid,text,integer,integer,date,date,timestamptz),
  public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid),
  public.erp_payroll_core_v2_calculate_role(uuid,uuid,text,uuid,jsonb,bigint,timestamptz),
  public.erp_payroll_core_v2_approve_role(uuid,uuid,text,uuid,bigint,timestamptz),
  public.erp_payroll_core_v2_post_role(uuid,uuid,text,uuid,bigint,date,timestamptz),
  public.erp_payroll_core_v2_get_bundle(uuid,uuid),public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
