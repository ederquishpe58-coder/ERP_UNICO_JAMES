-- FASE 10: Nómina V2 confirmada, idempotente y multiempresa.
-- Migración aditiva. No elimina ni renumera registros legacy.
begin;

create table if not exists public.erp_payroll_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  sequence_type text not null check (sequence_type in ('EMPLOYEE','ROLE','PAYMENT')),
  calendar_year integer not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, sequence_type, calendar_year)
);

create table if not exists public.erp_payroll_employees (
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null,
  employee_code text not null,
  company_legacy_code text not null default '',
  identification text not null,
  full_name text not null,
  hire_date date,
  area text not null default '',
  position_name text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  monthly_salary numeric(20,6) not null default 0 check (monthly_salary >= 0),
  hourly_rate numeric(20,8) not null default 0 check (hourly_rate >= 0),
  performance_rate numeric(20,8) not null default 0 check (performance_rate >= 0),
  calculation_mode text not null default 'MIXED',
  expense_account_code text not null default '',
  legacy_id text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, employee_id),
  unique (company_id, employee_code),
  unique (company_id, identification)
);
create unique index if not exists erp_payroll_employees_legacy_idx
  on public.erp_payroll_employees(company_id, legacy_id) where legacy_id <> '';

create table if not exists public.erp_payroll_roles (
  company_id uuid not null references public.companies(id) on delete cascade,
  role_id uuid not null,
  role_number text not null,
  period_code text not null,
  date_from date not null,
  date_to date not null,
  generation_date date not null,
  area_filter text not null default 'TODAS',
  status text not null default 'CALCULATED'
    check (status in ('DRAFT','CALCULATED','APPROVED','POSTED','PARTIALLY_PAID','PAID','REVERSED')),
  employee_count integer not null default 0 check (employee_count >= 0),
  total_income numeric(20,6) not null default 0 check (total_income >= 0),
  total_discounts numeric(20,6) not null default 0 check (total_discounts >= 0),
  net_total numeric(20,6) not null default 0 check (net_total >= 0),
  paid_total numeric(20,6) not null default 0 check (paid_total >= 0),
  pending_total numeric(20,6) not null default 0 check (pending_total >= 0),
  accrual_journal_entry_id uuid,
  reverse_journal_entry_id uuid,
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reverse_reason text not null default '',
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, role_id),
  unique (company_id, role_number),
  check (date_to >= date_from),
  check (round(net_total,6) = round(total_income-total_discounts,6)),
  check (round(pending_total,6) = round(net_total-paid_total,6)),
  check (paid_total <= net_total)
);
create unique index if not exists erp_payroll_roles_active_period_idx
  on public.erp_payroll_roles(company_id,date_from,date_to,area_filter)
  where status <> 'REVERSED';

create table if not exists public.erp_payroll_role_items (
  company_id uuid not null,
  role_item_id uuid not null,
  role_id uuid not null,
  employee_id uuid not null,
  employee_code_snapshot text not null,
  employee_name_snapshot text not null,
  area_snapshot text not null default '',
  position_snapshot text not null default '',
  days_worked numeric(10,2) not null default 0 check (days_worked >= 0 and days_worked <= 31),
  total_income numeric(20,6) not null default 0 check (total_income >= 0),
  total_discounts numeric(20,6) not null default 0 check (total_discounts >= 0),
  net_pay numeric(20,6) not null default 0 check (net_pay >= 0),
  paid_amount numeric(20,6) not null default 0 check (paid_amount >= 0),
  pending_balance numeric(20,6) not null default 0 check (pending_balance >= 0),
  payment_status text not null default 'PENDING' check (payment_status in ('PENDING','PARTIAL','PAID','REVERSED')),
  status text not null default 'CALCULATED'
    check (status in ('DRAFT','CALCULATED','APPROVED','POSTED','PARTIALLY_PAID','PAID','REVERSED')),
  calculation_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, role_item_id),
  unique (company_id, role_id, employee_id),
  foreign key (company_id, role_id) references public.erp_payroll_roles(company_id,role_id) on delete restrict,
  foreign key (company_id, employee_id) references public.erp_payroll_employees(company_id,employee_id) on delete restrict,
  check (round(net_pay,6)=round(total_income-total_discounts,6)),
  check (round(pending_balance,6)=round(net_pay-paid_amount,6)),
  check (paid_amount <= net_pay)
);

create table if not exists public.erp_payroll_role_lines (
  company_id uuid not null,
  role_line_id uuid not null,
  role_id uuid not null,
  role_item_id uuid not null,
  employee_id uuid not null,
  line_code text not null,
  label text not null,
  line_type text not null check (line_type in ('EARNING','DEDUCTION','CONTRIBUTION')),
  amount numeric(20,6) not null check (amount >= 0),
  account_key text not null default '',
  calculation_snapshot jsonb not null default '{}'::jsonb,
  manual_override boolean not null default false,
  override_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, role_line_id),
  unique (company_id, role_item_id, line_code),
  foreign key (company_id, role_id) references public.erp_payroll_roles(company_id,role_id) on delete restrict,
  foreign key (company_id, role_item_id) references public.erp_payroll_role_items(company_id,role_item_id) on delete restrict
);

create table if not exists public.erp_payroll_payments (
  company_id uuid not null,
  payment_id uuid not null,
  payment_number text not null,
  role_id uuid not null,
  role_item_id uuid not null,
  employee_id uuid not null,
  payment_date date not null,
  amount numeric(20,6) not null check (amount > 0),
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','REVERSED')),
  journal_entry_id uuid not null,
  reverse_journal_entry_id uuid,
  observation text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reverse_reason text not null default '',
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id,payment_id),
  unique (company_id,payment_number),
  foreign key (company_id,role_id) references public.erp_payroll_roles(company_id,role_id) on delete restrict,
  foreign key (company_id,role_item_id) references public.erp_payroll_role_items(company_id,role_item_id) on delete restrict
);

create table if not exists public.erp_payroll_payment_splits (
  company_id uuid not null,
  split_id uuid not null,
  payment_id uuid not null,
  method text not null check (method in ('CASH','TRANSFER','CHECK')),
  amount numeric(20,6) not null check (amount > 0),
  bank_account_id text not null default '',
  account_code text not null default '',
  reference text not null default '',
  check_number text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_operation_id uuid not null,
  primary key (company_id,split_id),
  foreign key (company_id,payment_id) references public.erp_payroll_payments(company_id,payment_id) on delete restrict
);

create table if not exists public.erp_payroll_events (
  company_id uuid not null references public.companies(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  previous_status text not null default '',
  next_status text not null default '',
  reason text not null default '',
  payload jsonb not null default '{}'::jsonb,
  operation_id uuid not null,
  user_id uuid references auth.users(id),
  server_created_at timestamptz not null default now(),
  primary key (company_id,event_id)
);

create or replace function public.erp_payroll_v2_next_code(p_company_id uuid,p_type text,p_date date)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_type text:=upper(btrim(p_type)); v_year integer:=extract(year from p_date)::integer; v_value bigint; v_prefix text;
begin
  if v_type not in ('EMPLOYEE','ROLE','PAYMENT') then raise exception using errcode='22023',message='PAYROLL_V2_SEQUENCE_TYPE_INVALID'; end if;
  insert into public.erp_payroll_sequence_counters(company_id,sequence_type,calendar_year,last_value,updated_at)
  values(p_company_id,v_type,v_year,1,clock_timestamp())
  on conflict(company_id,sequence_type,calendar_year) do update set last_value=erp_payroll_sequence_counters.last_value+1,updated_at=clock_timestamp()
  returning last_value into v_value;
  v_prefix:=case v_type when 'EMPLOYEE' then 'PER' when 'ROLE' then 'ROL' else 'PAG-ROL' end;
  return v_prefix||'-'||v_year||'-'||lpad(v_value::text,case when v_type='EMPLOYEE' then 4 else 6 end,'0');
end $$;

create or replace function public.erp_payroll_v2_event(p_company_id uuid,p_operation_id uuid,p_type text,p_entity text,p_entity_id uuid,p_before text,p_after text,p_reason text,p_payload jsonb default '{}'::jsonb)
returns public.erp_payroll_events language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.erp_payroll_events%rowtype;
begin
 insert into public.erp_payroll_events(company_id,event_id,event_type,entity_type,entity_id,previous_status,next_status,reason,payload,operation_id,user_id,server_created_at)
 values(p_company_id,gen_random_uuid(),upper(p_type),upper(p_entity),p_entity_id,coalesce(p_before,''),coalesce(p_after,''),coalesce(p_reason,''),coalesce(p_payload,'{}'),p_operation_id,auth.uid(),clock_timestamp()) returning * into v_event;
 return v_event;
end $$;

create or replace function public.erp_payroll_v2_publish_employee(p_company_id uuid,p_operation_id uuid,p_device_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_employees%rowtype;
begin select * into strict r from public.erp_payroll_employees where company_id=p_company_id and employee_id=p_id;
 return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'payroll_v2_employees',p_id::text,
  jsonb_build_object('id',r.employee_id::text,'employee_id',r.employee_id::text,'employeeId',r.employee_id::text,'code',r.employee_code,
   'identification',r.identification,'full_name',r.full_name,'fullName',r.full_name,'company_id',coalesce(nullif(r.company_legacy_code,''),r.company_id::text),'companyId',coalesce(nullif(r.company_legacy_code,''),r.company_id::text),'companyUuid',r.company_id::text,
   'hire_date',r.hire_date,'hireDate',r.hire_date,'area',r.area,'position',r.position_name,'status',case when r.status='ACTIVE' then 'ACTIVO' else 'INACTIVO' end,
   'monthly_salary',r.monthly_salary,'monthlySalary',r.monthly_salary,'hourly_rate',r.hourly_rate,'hourlyRate',r.hourly_rate,
   'performance_rate',r.performance_rate,'performanceRate',r.performance_rate,'calculation_mode',r.calculation_mode,'calculationMode',r.calculation_mode,
   'account_code',r.expense_account_code,'accountCode',r.expense_account_code,'legacyId',r.legacy_id,'createdAt',r.created_at,'updatedAtServer',r.updated_at,
   'version',r.version,'syncFlow','PAYROLL_V2'),coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='payroll_v2_employees' and record_id=p_id::text),0));
end $$;

create or replace function public.erp_payroll_v2_publish_role(p_company_id uuid,p_operation_id uuid,p_device_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_roles%rowtype; v_ids jsonb;
begin select * into strict r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_id;
 select coalesce(jsonb_agg(employee_id::text order by employee_id::text),'[]') into v_ids from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_id;
 return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'payroll_v2_roles',p_id::text,
  jsonb_build_object('id',r.role_id::text,'number',r.role_number,'companyId',r.company_id::text,'periodId',r.period_code,'dateFrom',r.date_from,'dateTo',r.date_to,
   'generatedAt',r.generation_date,'area',r.area_filter,'status',case r.status when 'CALCULATED' then 'CALCULADO' when 'APPROVED' then 'APROBADO' when 'POSTED' then 'CONTABILIZADO' when 'PARTIALLY_PAID' then 'PARCIALMENTE_PAGADO' when 'PAID' then 'PAGADO' when 'REVERSED' then 'ANULADO' else 'BORRADOR' end,
   'selectedEmployeeIds',v_ids,'totals',jsonb_build_object('employees',r.employee_count,'income',r.total_income,'discounts',r.total_discounts,'net',r.net_total,'paid',r.paid_total,'pending',r.pending_total),
   'accrualJournalEntryId',coalesce(r.accrual_journal_entry_id::text,''),'accrualReverseEntryId',coalesce(r.reverse_journal_entry_id::text,''),'notes',r.notes,
   'createdAt',r.created_at,'approvedAt',r.approved_at,'accountedAt',r.posted_at,'cancelledAt',r.reversed_at,'cancelReason',r.reverse_reason,
   'version',r.version,'syncFlow','PAYROLL_V2'),coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='payroll_v2_roles' and record_id=p_id::text),0));
end $$;

create or replace function public.erp_payroll_v2_publish_item(p_company_id uuid,p_operation_id uuid,p_device_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_role_items%rowtype; v_period text;
begin select * into strict r from public.erp_payroll_role_items where company_id=p_company_id and role_item_id=p_id;
 select period_code into v_period from public.erp_payroll_roles where company_id=p_company_id and role_id=r.role_id;
 return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_items',p_id::text,
  jsonb_build_object('id',r.role_item_id::text,'runId',r.role_id::text,'periodId',v_period,'employeeId',r.employee_id::text,'employeeCode',r.employee_code_snapshot,
   'employeeName',r.employee_name_snapshot,'area',r.area_snapshot,'position',r.position_snapshot,'daysWorked',r.days_worked,
   'totalIncome',r.total_income,'totalDiscounts',r.total_discounts,'netPay',r.net_pay,'paidAmount',r.paid_amount,'pendingBalance',r.pending_balance,
   'paymentStatus',case r.payment_status when 'PENDING' then 'PENDIENTE' when 'PARTIAL' then 'PARCIAL' when 'PAID' then 'PAGADO' else 'ANULADO' end,
   'status',case r.status when 'CALCULATED' then 'CALCULADO' when 'APPROVED' then 'APROBADO' when 'POSTED' then 'CONTABILIZADO' when 'PARTIALLY_PAID' then 'PARCIALMENTE_PAGADO' when 'PAID' then 'PAGADO' when 'REVERSED' then 'ANULADO' else 'BORRADOR' end,
   'snapshot',r.calculation_snapshot,'updatedAtServer',r.updated_at,'version',r.version,'syncFlow','PAYROLL_V2'),coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='payroll_v2_role_items' and record_id=p_id::text),0));
end $$;

create or replace function public.erp_payroll_v2_publish_line(p_company_id uuid,p_operation_id uuid,p_device_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_role_lines%rowtype;
begin select * into strict r from public.erp_payroll_role_lines where company_id=p_company_id and role_line_id=p_id;
 return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_lines',p_id::text,
  jsonb_build_object('id',r.role_line_id::text,'runId',r.role_id::text,'employeeItemId',r.role_item_id::text,'employeeId',r.employee_id::text,
   'code',r.line_code,'label',r.label,'type',r.line_type,'amount',r.amount,'accountKey',r.account_key,'snapshot',r.calculation_snapshot,
   'manualOverride',r.manual_override,'overrideReason',r.override_reason,'version',r.version,'syncFlow','PAYROLL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='payroll_v2_role_lines' and record_id=p_id::text),0));
end $$;

create or replace function public.erp_payroll_v2_publish_payment(p_company_id uuid,p_operation_id uuid,p_device_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_payments%rowtype; v_employee_name text; v_period text;
begin select * into strict r from public.erp_payroll_payments where company_id=p_company_id and payment_id=p_id;
 select i.employee_name_snapshot,ro.period_code into v_employee_name,v_period from public.erp_payroll_role_items i join public.erp_payroll_roles ro on ro.company_id=i.company_id and ro.role_id=i.role_id where i.company_id=p_company_id and i.role_item_id=r.role_item_id;
 return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'payroll_v2_payments',p_id::text,
  jsonb_build_object('id',r.payment_id::text,'number',r.payment_number,'companyId',r.company_id::text,'runId',r.role_id::text,'periodId',v_period,
   'employeeItemId',r.role_item_id::text,'employeeId',r.employee_id::text,'employeeName',v_employee_name,'date',r.payment_date,'amount',r.amount,
   'status',case when r.status='CONFIRMED' then 'CONFIRMADO' else 'ANULADO' end,'journalEntryId',r.journal_entry_id::text,
   'reverseJournalEntryId',coalesce(r.reverse_journal_entry_id::text,''),'observation',r.observation,'createdAt',r.created_at,'cancelledAt',r.reversed_at,
   'cancelReason',r.reverse_reason,'version',r.version,'syncFlow','PAYROLL_V2'),coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='payroll_v2_payments' and record_id=p_id::text),0));
end $$;

create or replace function public.erp_payroll_v2_publish_split(p_company_id uuid,p_operation_id uuid,p_device_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_payment_splits%rowtype;
begin select * into strict r from public.erp_payroll_payment_splits where company_id=p_company_id and split_id=p_id;
 return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'payroll_v2_payment_splits',p_id::text,
  jsonb_build_object('id',r.split_id::text,'paymentId',r.payment_id::text,'method',r.method,'amount',r.amount,'bankAccountId',r.bank_account_id,
   'accountCode',r.account_code,'reference',r.reference,'checkNumber',r.check_number,'details',r.details,'createdAt',r.created_at,'syncFlow','PAYROLL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='payroll_v2_payment_splits' and record_id=p_id::text),0));
end $$;

create or replace function public.erp_payroll_v2_publish_event(p_company_id uuid,p_operation_id uuid,p_device_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_events%rowtype;
begin select * into strict r from public.erp_payroll_events where company_id=p_company_id and event_id=p_id;
 return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'payroll_v2_events',p_id::text,
  jsonb_build_object('id',r.event_id::text,'eventType',r.event_type,'entityType',r.entity_type,'entityId',r.entity_id::text,'previousStatus',r.previous_status,
   'nextStatus',r.next_status,'reason',r.reason,'payload',r.payload,'operationId',r.operation_id::text,'createdAt',r.server_created_at,'syncFlow','PAYROLL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='payroll_v2_events' and record_id=p_id::text),0));
end $$;

create or replace function public.erp_payroll_v2_refresh_totals(p_company_id uuid,p_role_id uuid,p_operation_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.erp_payroll_roles r set employee_count=x.c,total_income=x.i,total_discounts=x.d,net_total=x.n,paid_total=x.p,pending_total=x.b,
  updated_at=clock_timestamp(),version=r.version+1,last_operation_id=p_operation_id
 from (select count(*)::int c,coalesce(sum(total_income),0) i,coalesce(sum(total_discounts),0) d,coalesce(sum(net_pay),0) n,
       coalesce(sum(paid_amount),0) p,coalesce(sum(pending_balance),0) b from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id and status<>'REVERSED') x
 where r.company_id=p_company_id and r.role_id=p_role_id;
end $$;

create or replace function public.erp_payroll_v2_replace_items(p_company_id uuid,p_role_id uuid,p_operation_id uuid,p_items jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb; v_line jsonb; v_item_id uuid; v_employee public.erp_payroll_employees%rowtype; v_income numeric(20,6); v_discount numeric(20,6); v_net numeric(20,6);
begin
 if jsonb_typeof(coalesce(p_items,'[]'))<>'array' or jsonb_array_length(p_items)=0 then raise exception using errcode='22023',message='PAYROLL_V2_ITEMS_REQUIRED'; end if;
 delete from public.erp_payroll_role_lines where company_id=p_company_id and role_id=p_role_id;
 delete from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_item_id:=gen_random_uuid();
  select * into v_employee from public.erp_payroll_employees where company_id=p_company_id and employee_id=nullif(v_item->>'employeeId','')::uuid;
  if not found then raise exception using errcode='23503',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(v_item->'components','[]'))<>'array' then raise exception using errcode='22023',message='PAYROLL_V2_LINES_REQUIRED'; end if;
  select coalesce(sum(case when upper(value->>'type')='EARNING' then round(coalesce(nullif(value->>'amount','')::numeric,0),6) else 0 end),0),
         coalesce(sum(case when upper(value->>'type') in ('DEDUCTION','CONTRIBUTION') then round(coalesce(nullif(value->>'amount','')::numeric,0),6) else 0 end),0)
    into v_income,v_discount from jsonb_array_elements(v_item->'components');
  v_net:=round(v_income-v_discount,6); if v_net<0 then raise exception using errcode='23514',message='PAYROLL_V2_NEGATIVE_NET'; end if;
  insert into public.erp_payroll_role_items(company_id,role_item_id,role_id,employee_id,employee_code_snapshot,employee_name_snapshot,area_snapshot,position_snapshot,
    days_worked,total_income,total_discounts,net_pay,paid_amount,pending_balance,payment_status,status,calculation_snapshot,last_operation_id)
  values(p_company_id,v_item_id,p_role_id,v_employee.employee_id,v_employee.employee_code,v_employee.full_name,coalesce(v_item->>'area',v_employee.area),
    coalesce(v_item->>'position',v_employee.position_name),coalesce(nullif(v_item->>'daysWorked','')::numeric,0),v_income,v_discount,v_net,0,v_net,'PENDING','CALCULATED',
    coalesce(v_item->'snapshot','{}'),p_operation_id);
  for v_line in select value from jsonb_array_elements(v_item->'components') loop
   if upper(coalesce(v_line->>'type','')) not in ('EARNING','DEDUCTION','CONTRIBUTION') then raise exception using errcode='22023',message='PAYROLL_V2_LINE_TYPE_INVALID'; end if;
   insert into public.erp_payroll_role_lines(company_id,role_line_id,role_id,role_item_id,employee_id,line_code,label,line_type,amount,account_key,
     calculation_snapshot,manual_override,override_reason,last_operation_id)
   values(p_company_id,gen_random_uuid(),p_role_id,v_item_id,v_employee.employee_id,
     btrim(coalesce(v_line->>'code','CONCEPT')),btrim(coalesce(v_line->>'label',v_line->>'code','Concepto')),upper(v_line->>'type'),
     round(coalesce(nullif(v_line->>'amount','')::numeric,0),6),btrim(coalesce(v_line->>'accountKey','')),coalesce(v_line->'snapshot','{}'),
     coalesce((v_line->>'manualOverride')::boolean,false),btrim(coalesce(v_line->>'overrideReason','')),p_operation_id);
  end loop;
 end loop;
 perform public.erp_payroll_v2_refresh_totals(p_company_id,p_role_id,p_operation_id);
end $$;

create or replace function public.erp_payroll_v2_finish(p_operation_id uuid,p_company_id uuid,p_device_id text,p_command text,p_source text,p_request jsonb,p_records jsonb,p_result jsonb,p_local timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_response jsonb;
begin
 v_response:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',coalesce(p_records,'[]'),'result',coalesce(p_result,'{}'));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,p_command,p_source,coalesce(p_request,'{}'),v_response,'CONFIRMED',auth.uid(),p_device_id,p_local,clock_timestamp());
 return v_response;
end $$;

create or replace function public.erp_payroll_v2_upsert_employee(p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; v_id uuid; v_row public.erp_payroll_employees%rowtype; v_code text; v_records jsonb:='[]'; v_event public.erp_payroll_events%rowtype;
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 v_id:=nullif(p_payload->>'employeeId','')::uuid;
 if v_id is null and nullif(btrim(p_payload->>'legacyId'),'') is not null then select employee_id into v_id from public.erp_payroll_employees where company_id=p_company_id and legacy_id=btrim(p_payload->>'legacyId'); end if;
 v_id:=coalesce(v_id,gen_random_uuid());
 if nullif(btrim(p_payload->>'fullName'),'') is null or nullif(btrim(p_payload->>'identification'),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_EMPLOYEE_REQUIRED_FIELDS'; end if;
 select employee_code into v_code from public.erp_payroll_employees where company_id=p_company_id and employee_id=v_id;
 v_code:=coalesce(v_code,nullif(btrim(p_payload->>'employeeCode'),''),public.erp_payroll_v2_next_code(p_company_id,'EMPLOYEE',current_date));
 insert into public.erp_payroll_employees(company_id,employee_id,employee_code,company_legacy_code,identification,full_name,hire_date,area,position_name,status,monthly_salary,hourly_rate,
   performance_rate,calculation_mode,expense_account_code,legacy_id,created_at,created_by,updated_at,updated_by,version,last_operation_id)
 values(p_company_id,v_id,v_code,btrim(coalesce(p_payload->>'companyIdLegacy','')),btrim(p_payload->>'identification'),btrim(p_payload->>'fullName'),nullif(p_payload->>'hireDate','')::date,btrim(coalesce(p_payload->>'area','')),
   btrim(coalesce(p_payload->>'position','')),upper(coalesce(p_payload->>'status','ACTIVE')),coalesce(nullif(p_payload->>'monthlySalary','')::numeric,0),
   coalesce(nullif(p_payload->>'hourlyRate','')::numeric,0),coalesce(nullif(p_payload->>'performanceRate','')::numeric,0),upper(coalesce(p_payload->>'calculationMode','MIXED')),
   btrim(coalesce(p_payload->>'expenseAccountCode','')),btrim(coalesce(p_payload->>'legacyId','')),clock_timestamp(),auth.uid(),clock_timestamp(),auth.uid(),1,p_operation_id)
 on conflict(company_id,employee_id) do update set company_legacy_code=excluded.company_legacy_code,identification=excluded.identification,full_name=excluded.full_name,hire_date=excluded.hire_date,area=excluded.area,
   position_name=excluded.position_name,status=excluded.status,monthly_salary=excluded.monthly_salary,hourly_rate=excluded.hourly_rate,performance_rate=excluded.performance_rate,
   calculation_mode=excluded.calculation_mode,expense_account_code=excluded.expense_account_code,legacy_id=excluded.legacy_id,updated_at=clock_timestamp(),updated_by=auth.uid(),
   version=erp_payroll_employees.version+1,last_operation_id=p_operation_id returning * into v_row;
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'UPSERT_EMPLOYEE','EMPLOYEE',v_id,'',v_row.status,coalesce(p_payload->>'changeReason',''),jsonb_build_object('employeeCode',v_code));
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_employee(p_company_id,p_operation_id,p_device_id,v_id))||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_UPSERT_EMPLOYEE',v_id::text,p_payload,v_records,jsonb_build_object('employeeId',v_id::text,'employeeCode',v_code),p_local_created_at);
end $$;

create or replace function public.erp_payroll_v2_create_role(p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; v_id uuid:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid()); v_number text; v_from date; v_to date; v_records jsonb:='[]'; x record; v_event public.erp_payroll_events%rowtype;
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 v_from:=nullif(p_payload->>'dateFrom','')::date; v_to:=nullif(p_payload->>'dateTo','')::date;
 if v_from is null or v_to is null or v_to<v_from then raise exception using errcode='22023',message='PAYROLL_V2_PERIOD_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||v_from::text||':'||v_to::text||':'||coalesce(p_payload->>'area','TODAS'),0));
 if exists(select 1 from public.erp_payroll_roles where company_id=p_company_id and date_from=v_from and date_to=v_to and area_filter=coalesce(p_payload->>'area','TODAS') and status<>'REVERSED') then raise exception using errcode='23505',message='PAYROLL_V2_ROLE_DUPLICATE_PERIOD'; end if;
 v_number:=public.erp_payroll_v2_next_code(p_company_id,'ROLE',v_to);
 insert into public.erp_payroll_roles(company_id,role_id,role_number,period_code,date_from,date_to,generation_date,area_filter,status,notes,created_by,last_operation_id)
 values(p_company_id,v_id,v_number,to_char(v_from,'YYYY-MM-DD')||':'||to_char(v_to,'YYYY-MM-DD'),v_from,v_to,coalesce(nullif(p_payload->>'generatedAt','')::date,current_date),
   coalesce(p_payload->>'area','TODAS'),'CALCULATED',coalesce(p_payload->>'notes',''),auth.uid(),p_operation_id);
 perform public.erp_payroll_v2_replace_items(p_company_id,v_id,p_operation_id,p_payload->'items');
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'CREATE_ROLE','ROLE',v_id,'','CALCULATED','Cálculo confirmado por servidor',jsonb_build_object('roleNumber',v_number));
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,v_id));
 for x in select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=v_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,x.role_item_id)); end loop;
 for x in select role_line_id from public.erp_payroll_role_lines where company_id=p_company_id and role_id=v_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_line(p_company_id,p_operation_id,p_device_id,x.role_line_id)); end loop;
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_CREATE_ROLE',v_id::text,p_payload,v_records,jsonb_build_object('roleId',v_id::text,'roleNumber',v_number),p_local_created_at);
end $$;

create or replace function public.erp_payroll_v2_replace_calculation(p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_payload jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; r public.erp_payroll_roles%rowtype; v_records jsonb:='[]'; x record; v_event public.erp_payroll_events%rowtype;
begin perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update; if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
 if r.status not in ('DRAFT','CALCULATED') then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_LOCKED'; end if;
 perform public.erp_payroll_v2_replace_items(p_company_id,p_role_id,p_operation_id,p_payload->'items');
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'RECALCULATE_ROLE','ROLE',p_role_id,r.status,'CALCULATED','Recálculo confirmado por servidor','{}');
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,p_role_id));
 for x in select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,x.role_item_id)); end loop;
 for x in select role_line_id from public.erp_payroll_role_lines where company_id=p_company_id and role_id=p_role_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_line(p_company_id,p_operation_id,p_device_id,x.role_line_id)); end loop;
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_RECALCULATE_ROLE',p_role_id::text,p_payload,v_records,jsonb_build_object('roleId',p_role_id::text),p_local_created_at); end $$;

create or replace function public.erp_payroll_v2_update_role_item(p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_item_id uuid,p_payload jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; i public.erp_payroll_role_items%rowtype; r public.erp_payroll_roles%rowtype; v_change jsonb; l public.erp_payroll_role_lines%rowtype; v_income numeric; v_discount numeric; v_records jsonb:='[]'; x record; v_event public.erp_payroll_events%rowtype;
begin perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 select * into i from public.erp_payroll_role_items where company_id=p_company_id and role_item_id=p_role_item_id for update; if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_ITEM_NOT_FOUND'; end if;
 select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=i.role_id for update; if r.status not in ('DRAFT','CALCULATED') then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_LOCKED'; end if;
 if nullif(btrim(p_payload->>'reason'),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_ADJUSTMENT_REASON_REQUIRED'; end if;
 for v_change in select value from jsonb_array_elements(coalesce(p_payload->'components','[]')) loop
  select * into l from public.erp_payroll_role_lines where company_id=p_company_id and role_item_id=p_role_item_id and role_line_id=nullif(v_change->>'componentId','')::uuid for update;
  if not found then raise exception using errcode='23503',message='PAYROLL_V2_ROLE_LINE_NOT_FOUND'; end if;
  if coalesce(nullif(v_change->>'value','')::numeric,-1)<0 then raise exception using errcode='23514',message='PAYROLL_V2_LINE_AMOUNT_INVALID'; end if;
  update public.erp_payroll_role_lines set amount=round((v_change->>'value')::numeric,6),manual_override=true,override_reason=btrim(p_payload->>'reason'),updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_line_id=l.role_line_id;
 end loop;
 if nullif(p_payload->>'daysWorked','') is not null then update public.erp_payroll_role_items set days_worked=(p_payload->>'daysWorked')::numeric where company_id=p_company_id and role_item_id=p_role_item_id; end if;
 select coalesce(sum(case when line_type='EARNING' then amount else 0 end),0),coalesce(sum(case when line_type in ('DEDUCTION','CONTRIBUTION') then amount else 0 end),0) into v_income,v_discount from public.erp_payroll_role_lines where company_id=p_company_id and role_item_id=p_role_item_id;
 if v_income-v_discount<0 then raise exception using errcode='23514',message='PAYROLL_V2_NEGATIVE_NET'; end if;
 update public.erp_payroll_role_items set total_income=v_income,total_discounts=v_discount,net_pay=v_income-v_discount,pending_balance=v_income-v_discount,updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_item_id=p_role_item_id;
 perform public.erp_payroll_v2_refresh_totals(p_company_id,i.role_id,p_operation_id);
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'ADJUST_ROLE_ITEM','ROLE_ITEM',p_role_item_id,r.status,r.status,btrim(p_payload->>'reason'),p_payload);
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,p_role_item_id))||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,i.role_id));
 for x in select role_line_id from public.erp_payroll_role_lines where company_id=p_company_id and role_item_id=p_role_item_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_line(p_company_id,p_operation_id,p_device_id,x.role_line_id)); end loop;
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_ADJUST_ITEM',p_role_item_id::text,p_payload,v_records,jsonb_build_object('roleItemId',p_role_item_id::text),p_local_created_at); end $$;

create or replace function public.erp_payroll_v2_approve_role(p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; r public.erp_payroll_roles%rowtype; v_records jsonb:='[]'; x record; v_event public.erp_payroll_events%rowtype;
begin perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update; if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
 if r.status='APPROVED' then null; elsif r.status<>'CALCULATED' then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_NOT_CALCULATED'; else
  if r.employee_count<=0 or round(r.net_total,6)<>round(r.total_income-r.total_discounts,6) then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_TOTALS_INVALID'; end if;
  update public.erp_payroll_roles set status='APPROVED',approved_at=clock_timestamp(),approved_by=auth.uid(),updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id;
  update public.erp_payroll_role_items set status='APPROVED',updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id;
 end if;
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'APPROVE_ROLE','ROLE',p_role_id,r.status,'APPROVED','Aprobación confirmada por servidor','{}');
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,p_role_id)); for x in select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,x.role_item_id)); end loop;
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_APPROVE_ROLE',p_role_id::text,'{}',v_records,jsonb_build_object('roleId',p_role_id::text),p_local_created_at); end $$;

create or replace function public.erp_payroll_v2_post_role(p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_journal jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; r public.erp_payroll_roles%rowtype; v_entry uuid; v_records jsonb:='[]'; x record; v_event public.erp_payroll_events%rowtype;
begin perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update; if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
 if r.status='POSTED' then v_entry:=r.accrual_journal_entry_id; elsif r.status<>'APPROVED' then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_NOT_APPROVED'; else
  v_entry:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_journal,'PAYROLL_ROLE',p_role_id::text,'POST_PAYROLL');
  update public.erp_payroll_roles set status='POSTED',accrual_journal_entry_id=v_entry,posted_at=clock_timestamp(),posted_by=auth.uid(),updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id;
  update public.erp_payroll_role_items set status='POSTED',updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id;
 end if;
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'POST_ROLE','ROLE',p_role_id,r.status,'POSTED','Contabilización confirmada',jsonb_build_object('journalEntryId',v_entry::text));
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,p_role_id))||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry));
 for x in select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,x.role_item_id)); end loop;
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_POST_ROLE',p_role_id::text,p_journal,v_records,jsonb_build_object('roleId',p_role_id::text,'journalEntryId',v_entry::text),p_local_created_at); end $$;

create or replace function public.erp_payroll_v2_reverse_entry(p_company_id uuid,p_operation_id uuid,p_device_id text,p_entry_id uuid,p_source_type text,p_source_id text,p_event_type text,p_reason text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.erp_financial_journal_entries%rowtype; v_lines jsonb; v_reverse uuid;
begin select * into e from public.erp_financial_journal_entries where company_id=p_company_id and journal_entry_id=p_entry_id for update; if not found or e.status<>'POSTED' then raise exception using errcode='23514',message='PAYROLL_V2_JOURNAL_NOT_POSTED'; end if;
 select jsonb_agg(jsonb_build_object('accountCode',account_code,'debit',credit,'credit',debit,'costCenter',cost_center,'auxiliary',auxiliary,'lineDescription','Reverso: '||description,'documentReference',document_reference) order by line_number) into v_lines from public.erp_financial_journal_lines where company_id=p_company_id and journal_entry_id=p_entry_id;
 v_reverse:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,jsonb_build_object('accountingDate',current_date,'concept','Reverso '||e.entry_number,'originModule','Rol de pagos','sourceDocument',e.source_document,'externalReference',e.entry_number,'lines',v_lines,'observation',p_reason),p_source_type,p_source_id,p_event_type);
 update public.erp_financial_journal_entries set status='REVERSED',reversed_at=clock_timestamp(),reversed_by=auth.uid(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and journal_entry_id=p_entry_id;
 update public.erp_financial_journal_entries set reverse_of_id=p_entry_id where company_id=p_company_id and journal_entry_id=v_reverse; return v_reverse; end $$;

create or replace function public.erp_payroll_v2_pay_role(p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; i public.erp_payroll_role_items%rowtype; r public.erp_payroll_roles%rowtype; v_id uuid:=gen_random_uuid(); v_number text; v_amount numeric(20,6); v_sum numeric(20,6); v_entry uuid; v_split jsonb; v_split_id uuid; v_records jsonb:='[]'; x record; v_event public.erp_payroll_events%rowtype;
begin perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 select * into i from public.erp_payroll_role_items where company_id=p_company_id and role_item_id=nullif(p_payload->>'roleItemId','')::uuid for update; if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_ITEM_NOT_FOUND'; end if;
 select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=i.role_id for update; if r.status not in ('POSTED','PARTIALLY_PAID') then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_NOT_PAYABLE'; end if;
 select coalesce(sum(round(coalesce(nullif(value->>'amount','')::numeric,0),6)),0) into v_sum from jsonb_array_elements(coalesce(p_payload->'splits','[]')); v_amount:=v_sum;
 if v_amount<=0 or v_amount>i.pending_balance then raise exception using errcode='23514',message='PAYROLL_V2_PAYMENT_EXCEEDS_BALANCE'; end if;
 v_number:=public.erp_payroll_v2_next_code(p_company_id,'PAYMENT',coalesce(nullif(p_payload->>'date','')::date,current_date));
 v_entry:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_payload->'journal','PAYROLL_PAYMENT',v_id::text,'PAY_PAYROLL');
 insert into public.erp_payroll_payments(company_id,payment_id,payment_number,role_id,role_item_id,employee_id,payment_date,amount,status,journal_entry_id,observation,created_by,last_operation_id)
 values(p_company_id,v_id,v_number,i.role_id,i.role_item_id,i.employee_id,coalesce(nullif(p_payload->>'date','')::date,current_date),v_amount,'CONFIRMED',v_entry,coalesce(p_payload->>'observation',''),auth.uid(),p_operation_id);
 for v_split in select value from jsonb_array_elements(p_payload->'splits') loop v_split_id:=gen_random_uuid();
  insert into public.erp_payroll_payment_splits(company_id,split_id,payment_id,method,amount,bank_account_id,account_code,reference,check_number,details,last_operation_id)
  values(p_company_id,v_split_id,v_id,upper(v_split->>'method'),round((v_split->>'amount')::numeric,6),coalesce(v_split->>'bankAccountId',''),coalesce(v_split->>'accountCode',''),coalesce(v_split->>'reference',''),coalesce(v_split->>'checkNumber',''),v_split,p_operation_id);
 end loop;
 update public.erp_payroll_role_items set paid_amount=paid_amount+v_amount,pending_balance=pending_balance-v_amount,payment_status=case when pending_balance-v_amount=0 then 'PAID' else 'PARTIAL' end,status=case when pending_balance-v_amount=0 then 'PAID' else 'PARTIALLY_PAID' end,updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_item_id=i.role_item_id;
 perform public.erp_payroll_v2_refresh_totals(p_company_id,i.role_id,p_operation_id);
 update public.erp_payroll_roles set status=case when pending_total=0 then 'PAID' else 'PARTIALLY_PAID' end,updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=i.role_id;
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'PAY_ROLE','PAYMENT',v_id,'','CONFIRMED','Pago confirmado',jsonb_build_object('amount',v_amount,'roleItemId',i.role_item_id::text));
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_payment(p_company_id,p_operation_id,p_device_id,v_id))||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,i.role_item_id))||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,i.role_id))||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry));
 for x in select split_id from public.erp_payroll_payment_splits where company_id=p_company_id and payment_id=v_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_split(p_company_id,p_operation_id,p_device_id,x.split_id)); end loop;
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_PAY_ROLE',v_id::text,p_payload,v_records,jsonb_build_object('paymentId',v_id::text,'paymentNumber',v_number,'journalEntryId',v_entry::text),p_local_created_at); end $$;

create or replace function public.erp_payroll_v2_reverse_payment(p_operation_id uuid,p_company_id uuid,p_device_id text,p_payment_id uuid,p_reason text,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; p public.erp_payroll_payments%rowtype; i public.erp_payroll_role_items%rowtype; v_reverse uuid; v_records jsonb:='[]'; v_event public.erp_payroll_events%rowtype;
begin perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_REVERSAL_REASON_REQUIRED'; end if;
 select * into p from public.erp_payroll_payments where company_id=p_company_id and payment_id=p_payment_id for update; if not found then raise exception using errcode='P0002',message='PAYROLL_V2_PAYMENT_NOT_FOUND'; end if; if p.status='REVERSED' then raise exception using errcode='23514',message='PAYROLL_V2_PAYMENT_ALREADY_REVERSED'; end if;
 select * into i from public.erp_payroll_role_items where company_id=p_company_id and role_item_id=p.role_item_id for update;
 v_reverse:=public.erp_payroll_v2_reverse_entry(p_company_id,p_operation_id,p_device_id,p.journal_entry_id,'PAYROLL_PAYMENT_REVERSAL',p.payment_id::text,'REVERSE_PAYROLL_PAYMENT',p_reason);
 update public.erp_payroll_payments set status='REVERSED',reverse_journal_entry_id=v_reverse,reversed_at=clock_timestamp(),reversed_by=auth.uid(),reverse_reason=p_reason,version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and payment_id=p_payment_id;
 update public.erp_payroll_role_items set paid_amount=paid_amount-p.amount,pending_balance=pending_balance+p.amount,payment_status=case when paid_amount-p.amount=0 then 'PENDING' else 'PARTIAL' end,status=case when paid_amount-p.amount=0 then 'POSTED' else 'PARTIALLY_PAID' end,updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_item_id=p.role_item_id;
 perform public.erp_payroll_v2_refresh_totals(p_company_id,p.role_id,p_operation_id); update public.erp_payroll_roles set status=case when paid_total=0 then 'POSTED' else 'PARTIALLY_PAID' end,updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p.role_id;
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'REVERSE_PAYMENT','PAYMENT',p_payment_id,'CONFIRMED','REVERSED',p_reason,jsonb_build_object('reverseJournalEntryId',v_reverse::text));
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_payment(p_company_id,p_operation_id,p_device_id,p_payment_id))||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,p.role_item_id))||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,p.role_id))||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,p.journal_entry_id))||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse))||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_REVERSE_PAYMENT',p_payment_id::text,jsonb_build_object('reason',p_reason),v_records,jsonb_build_object('paymentId',p_payment_id::text,'reverseJournalEntryId',v_reverse::text),p_local_created_at); end $$;

create or replace function public.erp_payroll_v2_reverse_role(p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_reason text,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.erp_operations_commands%rowtype; r public.erp_payroll_roles%rowtype; p public.erp_payroll_payments%rowtype; v_reverse uuid; v_records jsonb:='[]'; x record; v_event public.erp_payroll_events%rowtype;
begin perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); select * into v_old from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_old.result; end if;
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_REVERSAL_REASON_REQUIRED'; end if;
 select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id for update; if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if; if r.status='REVERSED' then raise exception using errcode='23514',message='PAYROLL_V2_ROLE_ALREADY_REVERSED'; end if;
 for p in select * from public.erp_payroll_payments where company_id=p_company_id and role_id=p_role_id and status='CONFIRMED' for update loop
  v_reverse:=public.erp_payroll_v2_reverse_entry(p_company_id,p_operation_id,p_device_id,p.journal_entry_id,'PAYROLL_PAYMENT_REVERSAL',p.payment_id::text,'REVERSE_PAYMENT_WITH_ROLE',p_reason);
  update public.erp_payroll_payments set status='REVERSED',reverse_journal_entry_id=v_reverse,reversed_at=clock_timestamp(),reversed_by=auth.uid(),reverse_reason=p_reason,version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and payment_id=p.payment_id;
  v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_payment(p_company_id,p_operation_id,p_device_id,p.payment_id))||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,p.journal_entry_id))||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse));
 end loop;
 if r.accrual_journal_entry_id is not null then v_reverse:=public.erp_payroll_v2_reverse_entry(p_company_id,p_operation_id,p_device_id,r.accrual_journal_entry_id,'PAYROLL_ROLE_REVERSAL',p_role_id::text,'REVERSE_PAYROLL_ROLE',p_reason); end if;
 update public.erp_payroll_roles set status='REVERSED',reverse_journal_entry_id=v_reverse,reversed_at=clock_timestamp(),reversed_by=auth.uid(),reverse_reason=p_reason,updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id;
 update public.erp_payroll_role_items set status='REVERSED',payment_status='REVERSED',updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id;
 v_event:=public.erp_payroll_v2_event(p_company_id,p_operation_id,'REVERSE_ROLE','ROLE',p_role_id,r.status,'REVERSED',p_reason,'{}');
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_role(p_company_id,p_operation_id,p_device_id,p_role_id)); for x in select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_item(p_company_id,p_operation_id,p_device_id,x.role_item_id)); end loop;
 if r.accrual_journal_entry_id is not null then v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,r.accrual_journal_entry_id))||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse)); end if;
 v_records:=v_records||jsonb_build_array(public.erp_payroll_v2_publish_event(p_company_id,p_operation_id,p_device_id,v_event.event_id));
 return public.erp_payroll_v2_finish(p_operation_id,p_company_id,p_device_id,'PAYROLL_REVERSE_ROLE',p_role_id::text,jsonb_build_object('reason',p_reason),v_records,jsonb_build_object('roleId',p_role_id::text),p_local_created_at); end $$;

alter table public.erp_payroll_sequence_counters enable row level security;
alter table public.erp_payroll_employees enable row level security;
alter table public.erp_payroll_roles enable row level security;
alter table public.erp_payroll_role_items enable row level security;
alter table public.erp_payroll_role_lines enable row level security;
alter table public.erp_payroll_payments enable row level security;
alter table public.erp_payroll_payment_splits enable row level security;
alter table public.erp_payroll_events enable row level security;

do $$ declare t text; begin foreach t in array array['erp_payroll_employees','erp_payroll_roles','erp_payroll_role_items','erp_payroll_role_lines','erp_payroll_payments','erp_payroll_payment_splits','erp_payroll_events'] loop
 execute format('drop policy if exists payroll_v2_select on public.%I',t);
 execute format('create policy payroll_v2_select on public.%I for select to authenticated using (exists(select 1 from public.user_company_memberships m where m.company_id=%I.company_id and m.user_id=auth.uid() and m.membership_status=''ACTIVE''))',t,t);
end loop; end $$;

revoke all on public.erp_payroll_sequence_counters,public.erp_payroll_employees,public.erp_payroll_roles,public.erp_payroll_role_items,public.erp_payroll_role_lines,public.erp_payroll_payments,public.erp_payroll_payment_splits,public.erp_payroll_events from anon,authenticated;
grant select on public.erp_payroll_employees,public.erp_payroll_roles,public.erp_payroll_role_items,public.erp_payroll_role_lines,public.erp_payroll_payments,public.erp_payroll_payment_splits,public.erp_payroll_events to authenticated;

revoke all on function public.erp_payroll_v2_upsert_employee(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_create_role(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_replace_calculation(uuid,uuid,text,uuid,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_update_role_item(uuid,uuid,text,uuid,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_approve_role(uuid,uuid,text,uuid,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_post_role(uuid,uuid,text,uuid,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_pay_role(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
revoke all on function public.erp_payroll_v2_reverse_role(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.erp_payroll_v2_upsert_employee(uuid,uuid,text,jsonb,timestamptz),public.erp_payroll_v2_create_role(uuid,uuid,text,jsonb,timestamptz),public.erp_payroll_v2_replace_calculation(uuid,uuid,text,uuid,jsonb,timestamptz),public.erp_payroll_v2_update_role_item(uuid,uuid,text,uuid,jsonb,timestamptz),public.erp_payroll_v2_approve_role(uuid,uuid,text,uuid,timestamptz),public.erp_payroll_v2_post_role(uuid,uuid,text,uuid,jsonb,timestamptz),public.erp_payroll_v2_pay_role(uuid,uuid,text,jsonb,timestamptz),public.erp_payroll_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz),public.erp_payroll_v2_reverse_role(uuid,uuid,text,uuid,text,timestamptz) to authenticated;

commit;
