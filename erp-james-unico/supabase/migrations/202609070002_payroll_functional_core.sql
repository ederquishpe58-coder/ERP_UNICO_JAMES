-- Payroll functional core. No payroll run, employee edit, account mapping or SRI change.
begin;
create table public.erp_payroll_concept_settings (
  company_id uuid not null references public.companies(id),
  concept_code text not null check (concept_code in (
    'BASE_AMOUNT','ADDITIONAL_HOURS','OVERTIME','TRANSPORT','BONUS','COMMISSION','OTHER_INCOME',
    'FOOD','ADVANCE','MANUAL_DISCOUNT','OTHER_DISCOUNTS','PERFORMANCE',
    'DECIMO_TERCERO','DECIMO_CUARTO','FONDOS_RESERVA','VACACIONES_PROVISIONADAS','UTILIDADES',
    'IESS_PERSONAL','IESS_PATRONAL','PRESTAMO_QUIROGRAFARIO','PRESTAMO_HIPOTECARIO')),
  enabled boolean not null,
  version bigint not null default 1 check (version > 0),
  configured_at timestamptz not null default now(),
  configuration_reason text not null default 'HUMAN_APPROVED_GO_LIVE_20260907',
  primary key(company_id,concept_code)
);
alter table public.erp_payroll_concept_settings enable row level security;
revoke all on public.erp_payroll_concept_settings from public,anon,authenticated;
grant select on public.erp_payroll_concept_settings to authenticated;
grant all on public.erp_payroll_concept_settings to service_role;
create policy payroll_concepts_read on public.erp_payroll_concept_settings for select to authenticated
using (public.erp_security_has_capability(company_id,'payroll.roles.view')
  or public.erp_security_has_capability(company_id,'payroll.employees.view')
  or public.erp_security_has_capability(company_id,'payroll.accounting_settings.view'));

-- Only existing codes. Configuration rows are the explicitly approved technical seed.
insert into public.erp_payroll_concept_settings(company_id,concept_code,enabled)
select c.id,v.code,v.enabled from public.companies c cross join (values
 ('BASE_AMOUNT',true),('ADDITIONAL_HOURS',true),('OVERTIME',true),('TRANSPORT',true),
 ('BONUS',true),('COMMISSION',true),('OTHER_INCOME',true),
 ('FOOD',true),('ADVANCE',true),('MANUAL_DISCOUNT',true),('OTHER_DISCOUNTS',true),
 ('PERFORMANCE',false),('DECIMO_TERCERO',false),('DECIMO_CUARTO',false),
 ('FONDOS_RESERVA',false),('VACACIONES_PROVISIONADAS',false),('UTILIDADES',false),
 ('IESS_PERSONAL',false),('IESS_PATRONAL',false),('PRESTAMO_QUIROGRAFARIO',false),('PRESTAMO_HIPOTECARIO',false)
) v(code,enabled)
where c.id in ('cf331b82-7ac3-4065-9e38-d0bbcde96cd5'::uuid,'ab60abdc-fe53-4289-9ae2-8f749ee21cff'::uuid);

alter table public.erp_payroll_accounting_settings add column default_expense_account_code text not null default '';
alter table public.erp_payroll_roles add column calculation_config_snapshot jsonb;
alter table public.erp_payroll_role_items add column employee_area_snapshot text;

create function public.erp_payroll_core_v2_concept_enabled(p_company_id uuid,p_code text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_enabled boolean;
begin
 select enabled into v_enabled from public.erp_payroll_concept_settings where company_id=p_company_id and concept_code=p_code;
 if not found then raise exception using errcode='23514',message='PAYROLL_CONCEPT_CONFIGURATION_REQUIRED:'||coalesce(p_code,''); end if;
 return v_enabled;
end $$;

-- Narrow chart projection for Payroll selectors. No balances or unrelated company data.
create function public.erp_payroll_core_v2_account_choices(p_company_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('company_id',r.company_id,'code',r.payload->>'code',
   'name',r.payload->>'name','type',r.payload->>'type','nature',r.payload->>'nature',
   'status',r.payload->>'status','isMovement',true) order by r.payload->>'code'),'[]'::jsonb)
 from public.erp_entity_records r where r.company_id=p_company_id and r.entity='accounting_chart_accounts'
 and r.deleted_at is null and nullif(r.payload->>'deleted_at','') is null
 and coalesce(r.payload->>'__deleted','false')='false'
 and (not r.payload?'company_id' or r.payload->>'company_id'=p_company_id::text)
 and (not r.payload?'companyId' or r.payload->>'companyId'=p_company_id::text)
 and lower(r.payload->>'status') in ('activa','active')
 and lower(coalesce(r.payload->>'isMovement',r.payload->>'is_movement','false')) in ('true','1')
 and nullif(btrim(r.payload->>'code'),'') is not null
 and ((r.payload->>'type' in ('Gasto','Costo') and r.payload->>'nature'='Deudora')
   or (r.payload->>'type'='Pasivo' and r.payload->>'nature'='Acreedora')
   or (r.payload->>'type'='Activo' and r.payload->>'nature'='Deudora'))
$$;

create function public.erp_payroll_core_v2_validate_account_choice(p_company_id uuid,p_code text,p_purpose text)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if nullif(btrim(p_code),'') is null then return; end if;
 if not exists(select 1 from jsonb_array_elements(public.erp_payroll_core_v2_account_choices(p_company_id)) a
   where a->>'code'=btrim(p_code)
   and ((p_purpose='EXPENSE' and a->>'type' in ('Gasto','Costo') and a->>'nature'='Deudora')
     or (p_purpose in ('PAYABLE','DEDUCTION') and a->>'type'='Pasivo' and a->>'nature'='Acreedora')
     or (p_purpose='DEDUCTION_LINE' and ((a->>'type'='Pasivo' and a->>'nature'='Acreedora') or (a->>'type'='Activo' and a->>'nature'='Deudora')))))
 then raise exception using errcode='23514',message='PAYROLL_ACCOUNT_SELECTION_REQUIRED:'||p_purpose; end if;
end $$;

create function public.erp_payroll_core_v2_configuration_snapshot(p_company_id uuid,p_role_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with config as (
 select jsonb_build_object(
  'settings',coalesce((select jsonb_build_object('default_expense_account_code',s.default_expense_account_code,
    'payroll_payable_account_code',s.payroll_payable_account_code,'payroll_deduction_account_code',s.payroll_deduction_account_code,
    'cost_center',s.cost_center) from public.erp_payroll_accounting_settings s where s.company_id=p_company_id),
    jsonb_build_object('default_expense_account_code','','payroll_payable_account_code','','payroll_deduction_account_code','','cost_center','')),
  'employeeAccounts',(select coalesce(jsonb_agg(jsonb_build_object('employeeId',i.employee_id,'override',e.expense_account_code) order by i.employee_id),'[]')
    from public.erp_payroll_role_items i join public.erp_payroll_employees e on e.company_id=i.company_id and e.employee_id=i.employee_id
    where i.company_id=p_company_id and i.role_id=p_role_id),
  'concepts',(select coalesce(jsonb_agg(jsonb_build_object('code',concept_code,'enabled',enabled) order by concept_code),'[]')
    from public.erp_payroll_concept_settings where company_id=p_company_id)
 ) value)
 select value||jsonb_build_object('configurationHash',md5(value::text)) from config
$$;

create function public.erp_payroll_core_v2_requires_recalculation(p_company_id uuid,p_role_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select r.status='CALCULATED' and (
   r.calculation_config_snapshot is null or
   r.calculation_config_snapshot->>'configurationHash' is distinct from
     public.erp_payroll_core_v2_configuration_snapshot(p_company_id,p_role_id)->>'configurationHash')
   from public.erp_payroll_roles r where r.company_id=p_company_id and r.role_id=p_role_id),true)
$$;

create function public.erp_payroll_core_v2_confirm_ack(p_company_id uuid,p_operation_id uuid,p_command_type text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype;
begin
 select * into v_command from public.erp_operations_commands
 where company_id=p_company_id and operation_id=p_operation_id and command_type=p_command_type
   and status='CONFIRMED' and user_id=auth.uid();
 if not found or v_command.result is distinct from p_result or p_result->'ok' is distinct from 'true'::jsonb
   or jsonb_typeof(p_result->'records') is distinct from 'array'
   or jsonb_typeof(p_result->'result') is distinct from 'object' or nullif(p_result->>'serverTime','') is null
 then raise exception using errcode='23514',message='PAYROLL_CANONICAL_ACK_REQUIRED'; end if;
 return p_result||jsonb_build_object('companyId',p_company_id,'confirmation',
   jsonb_build_object('operationId',p_operation_id,'companyId',p_company_id,'commandType',p_command_type,'status','CONFIRMED'));
end $$;

-- This overload prepares the future settings UI; this migration inserts no settings row.
create function public.erp_payroll_core_v2_save_accounting_settings(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payroll_payable_account_code text,
 p_deduction_account_code text,p_cost_center text,p_default_expense_account_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_settings public.erp_payroll_accounting_settings%rowtype; v_result jsonb;
begin
 perform public.erp_security_assert_capability(p_company_id,'payroll.accounting_settings.manage');
 if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_COMMAND_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
 select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
 if found then return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_SAVE_ACCOUNTING_SETTINGS',v_command.result); end if;
 perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,p_default_expense_account_code,'EXPENSE');
 perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,p_payroll_payable_account_code,'PAYABLE');
 perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,p_deduction_account_code,'DEDUCTION');
 insert into public.erp_payroll_accounting_settings(company_id,default_expense_account_code,payroll_payable_account_code,payroll_deduction_account_code,cost_center,created_by,updated_by)
 values(p_company_id,btrim(coalesce(p_default_expense_account_code,'')),btrim(coalesce(p_payroll_payable_account_code,'')),btrim(coalesce(p_deduction_account_code,'')),btrim(coalesce(p_cost_center,'')),auth.uid(),auth.uid())
 on conflict(company_id) do update set default_expense_account_code=excluded.default_expense_account_code,
 payroll_payable_account_code=excluded.payroll_payable_account_code,payroll_deduction_account_code=excluded.payroll_deduction_account_code,
 cost_center=excluded.cost_center,updated_at=clock_timestamp(),updated_by=auth.uid(),version=public.erp_payroll_accounting_settings.version+1
 returning * into v_settings;
 perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ACCOUNTING_SETTINGS_UPDATED','ACCOUNTING_SETTINGS',p_company_id,to_jsonb(v_settings));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records','[]'::jsonb,'result',to_jsonb(v_settings));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'PAYROLL_V2_SAVE_ACCOUNTING_SETTINGS',p_company_id::text,to_jsonb(v_settings),v_result,'CONFIRMED',auth.uid(),p_device_id,clock_timestamp(),clock_timestamp());
 return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_SAVE_ACCOUNTING_SETTINGS',v_result);
end $$;

-- Existing function replacements and grants follow, generated from verified PROD definitions.

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_calculate_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_period_id uuid, p_payload jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_command public.erp_operations_commands%rowtype; v_period public.erp_payroll_periods%rowtype; v_role public.erp_payroll_roles%rowtype;
  v_employee public.erp_payroll_employees%rowtype; v_settings public.erp_payroll_accounting_settings%rowtype; v_item_id uuid; v_employee_id uuid;
  v_payload_item jsonb; v_concept jsonb; v_perf record; v_line integer; v_income numeric; v_deductions numeric; v_amount numeric;
  v_qty numeric; v_kind text; v_code text; v_label text; v_account text; v_notes text; v_role_id uuid; v_records jsonb; v_result jsonb;
  v_policy_summary jsonb; v_reference_salary numeric; v_base_used numeric; v_adjustment_reason text; v_considered_days integer;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.calculate');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
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
  else
    v_role_id:=v_role.role_id;
    delete from public.erp_payroll_role_items where company_id=p_company_id and role_id=v_role_id;
  end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'))=0 then
    raise exception using errcode='22023',message='PAYROLL_V2_EMPLOYEES_REQUIRED';
  end if;
  select * into v_settings from public.erp_payroll_accounting_settings where company_id=p_company_id;
  for v_payload_item in select value from jsonb_array_elements(p_payload->'items') loop
    v_employee_id:=nullif(v_payload_item->>'employeeId','')::uuid;
    select * into v_employee from public.erp_payroll_employees where company_id=p_company_id and employee_id=v_employee_id and status='ACTIVE';
    if not found then raise exception using errcode='P0002',message='PAYROLL_V2_EMPLOYEE_NOT_FOUND:'||coalesce(v_employee_id::text,''); end if;
    v_item_id:=gen_random_uuid(); v_line:=0;
    insert into public.erp_payroll_role_items(company_id,role_item_id,role_id,employee_id,employee_code_snapshot,employee_name_snapshot,
      employee_identification_snapshot,position_snapshot,calculation_mode_snapshot,employee_area_snapshot,last_operation_id)
    values(p_company_id,v_item_id,v_role_id,v_employee_id,v_employee.employee_code,v_employee.full_name,v_employee.identification,v_employee.position_name,v_employee.calculation_mode,v_employee.area,p_operation_id);
    v_considered_days:=coalesce(nullif(v_payload_item->>'consideredWorkdays','')::integer,21);
    if v_considered_days<0 or v_considered_days>31 then raise exception using errcode='23514',message='PAYROLL_V2_CONSIDERED_DAYS_INVALID'; end if;
    v_policy_summary:=public.erp_payroll_performance_v2_snapshot_item(p_company_id,v_item_id,v_employee_id,v_period.date_from,v_period.date_to,v_considered_days);
    v_reference_salary:=case
      when v_employee.calculation_mode='FIXED_PERFORMANCE' then coalesce((v_policy_summary->>'baseSalary')::numeric,0)
      when v_employee.calculation_mode in ('FIXED','FIXED_MANUAL_HOURS','MONTHLY','MIXED') then v_employee.monthly_salary
      else 0 end;
    v_base_used:=round(coalesce(nullif(v_payload_item->>'baseAmount','')::numeric,v_reference_salary),6);
    v_adjustment_reason:=btrim(coalesce(v_payload_item->>'baseAdjustmentReason',''));
    if v_base_used<0 then raise exception using errcode='23514',message='PAYROLL_V2_BASE_AMOUNT_INVALID'; end if;
    if not public.erp_payroll_core_v2_concept_enabled(p_company_id,'BASE_AMOUNT') then
      v_base_used:=0; v_adjustment_reason:='Concepto desactivado por configuración canónica';
    end if;
    if abs(v_base_used-v_reference_salary)>0.000001 and nullif(v_adjustment_reason,'') is null then
      raise exception using errcode='23514',message='PAYROLL_V2_BASE_ADJUSTMENT_REASON_REQUIRED';
    end if;
    update public.erp_payroll_role_items set reference_base_salary=v_reference_salary,base_amount_used=v_base_used,
      base_adjustment_reason=v_adjustment_reason,base_adjusted_at=case when abs(v_base_used-v_reference_salary)>0.000001 then clock_timestamp() end,
      base_adjusted_by=case when abs(v_base_used-v_reference_salary)>0.000001 then auth.uid() end,
      employee_notes=btrim(coalesce(v_payload_item->>'notes','')) where company_id=p_company_id and role_item_id=v_item_id;
    if v_base_used>0 then
      v_line:=v_line+1;
      insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,line_notes)
      values(p_company_id,v_item_id,v_line,'EARNING','BASE_AMOUNT','Valor base del período',1,0,v_base_used,coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,''),
        case when v_employee.calculation_mode='FIXED_PERFORMANCE' then 'PERFORMANCE_POLICY_BASE' else 'EMPLOYEE_MASTER' end,v_adjustment_reason);
    end if;
    -- Los snapshots de rendimiento son informativos para las modalidades nuevas.
    -- Solo se conserva la remuneración por unidad para modalidades históricas.
    if v_employee.calculation_mode in ('PERFORMANCE','MIXED') and public.erp_payroll_core_v2_concept_enabled(p_company_id,'PERFORMANCE') then
      for v_perf in select operational_role,sum(quantity) quantity,min(unit) unit,sum(calculated_value) calculated_value
        from public.erp_payroll_performance_snapshots where company_id=p_company_id and role_item_id=v_item_id group by operational_role loop
        if v_perf.quantity>0 then
          v_line:=v_line+1;
          insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference)
          values(p_company_id,v_item_id,v_line,'EARNING','PERFORMANCE','Rendimiento '||case v_perf.operational_role when 'BUNCHER' then 'Embonche' else 'Clasificación' end,
            v_perf.quantity,v_employee.performance_rate,round(v_perf.calculated_value,6),coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,''),'POSCOSECHA_UUID',v_perf.operational_role);
        end if;
      end loop;
    end if;
    if jsonb_typeof(coalesce(v_payload_item->'concepts','[]'))='array' then
      for v_concept in select value from jsonb_array_elements(v_payload_item->'concepts') loop
        v_code:=upper(btrim(v_concept->>'code')); v_kind:=upper(btrim(v_concept->>'kind'));
        v_amount:=round(coalesce(nullif(v_concept->>'amount','')::numeric,0),6);
        v_qty:=coalesce(nullif(v_concept->>'quantity','')::numeric,0);
        if v_amount<0 or v_qty<0 then raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_AMOUNT_INVALID'; end if;
        if not public.erp_payroll_core_v2_concept_enabled(p_company_id,v_code) then
          if v_amount<>0 then raise exception using errcode='23514',message='PAYROLL_CONCEPT_DISABLED:'||v_code; end if;
          continue;
        end if;
        if (v_kind='EARNING' and v_code not in ('ADDITIONAL_HOURS','OVERTIME','TRANSPORT','BONUS','COMMISSION','OTHER_INCOME'))
          or (v_kind='DEDUCTION' and v_code not in ('FOOD','ADVANCE','MANUAL_DISCOUNT','OTHER_DISCOUNTS')) then
          raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_NOT_ALLOWED:'||coalesce(v_code,'');
        end if;
        v_amount:=round(coalesce(nullif(v_concept->>'amount','')::numeric,0),6);
        v_qty:=coalesce(nullif(v_concept->>'quantity','')::numeric,0);
        if v_amount<0 or v_qty<0 then raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_AMOUNT_INVALID'; end if;
        if v_amount=0 then continue; end if;
        v_label:=btrim(coalesce(v_concept->>'label',replace(v_code,'_',' ')));
        if v_code in ('OTHER_INCOME','OTHER_DISCOUNTS','MANUAL_DISCOUNT') and nullif(v_label,'') is null then
          raise exception using errcode='23514',message='PAYROLL_V2_CONCEPT_DESCRIPTION_REQUIRED';
        end if;
        v_notes:=btrim(coalesce(v_concept->>'notes',v_concept->>'reference',''));
        v_account:=btrim(coalesce(v_concept->>'accountCode',''));
        if v_account<>'' then perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,v_account,case when v_kind='EARNING' then 'EXPENSE' else 'DEDUCTION_LINE' end); end if;
        if v_account='' then v_account:=case when v_kind='EARNING' then coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,'') else coalesce(v_settings.payroll_deduction_account_code,'') end; end if;
        v_line:=v_line+1;
        insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference,line_notes)
        values(p_company_id,v_item_id,v_line,v_kind,v_code,v_label,v_qty,0,v_amount,v_account,'MANUAL_PERIOD',v_notes,v_notes);
      end loop;
    end if;
    select coalesce(sum(amount) filter(where line_kind='EARNING'),0),coalesce(sum(amount) filter(where line_kind='DEDUCTION'),0)
      into v_income,v_deductions from public.erp_payroll_role_lines where company_id=p_company_id and role_item_id=v_item_id;
    if v_deductions>v_income then raise exception using errcode='23514',message='PAYROLL_V2_NEGATIVE_NET_NOT_ALLOWED'; end if;
    update public.erp_payroll_role_items set total_income=v_income,total_discounts=v_deductions,net_total=v_income-v_deductions,updated_at=clock_timestamp(),version=version+1
      where company_id=p_company_id and role_item_id=v_item_id;
    if abs(v_base_used-v_reference_salary)>0.000001 then
      perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_ITEM_BASE_ADJUSTED','ROLE_ITEM',v_item_id,
        jsonb_build_object('employeeId',v_employee_id,'configuredValue',v_reference_salary,'usedValue',v_base_used,'reason',v_adjustment_reason,'adjustedBy',auth.uid(),'adjustedAt',clock_timestamp()));
    end if;
  end loop;
  select count(*),coalesce(sum(total_income),0),coalesce(sum(total_discounts),0),coalesce(sum(net_total),0)
    into v_line,v_income,v_deductions,v_amount from public.erp_payroll_role_items where company_id=p_company_id and role_id=v_role_id;
  update public.erp_payroll_roles set calculation_config_snapshot=public.erp_payroll_core_v2_configuration_snapshot(p_company_id,v_role_id),status='CALCULATED',employee_count=v_line,total_income=v_income,total_discounts=v_deductions,net_total=v_amount,
    notes=btrim(coalesce(p_payload->>'notes',notes)),calculated_at=clock_timestamp(),calculated_by=auth.uid(),updated_at=clock_timestamp(),updated_by=auth.uid(),
    version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=v_role_id returning * into v_role;
  update public.erp_payroll_periods set status='CALCULATED',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and period_id=p_period_id;
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_CALCULATED','ROLE',v_role_id,
    jsonb_build_object('periodId',p_period_id,'totalIncome',v_role.total_income,'totalDiscounts',v_role.total_discounts,'netTotal',v_role.net_total));
  v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,v_role_id);
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('roleId',v_role_id,'roleNumber',v_role.role_number,'status',v_role.status));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_CALCULATE_ROLE',v_role_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_performance_v2_snapshot_item(p_company_id uuid, p_role_item_id uuid, p_employee_id uuid, p_period_from date, p_period_to date, p_considered_workdays integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      case when v_employee.calculation_mode in ('PERFORMANCE','MIXED') and public.erp_payroll_core_v2_concept_enabled(p_company_id,'PERFORMANCE') then v_employee.performance_rate else 0 end,
      case when v_employee.calculation_mode in ('PERFORMANCE','MIXED') and public.erp_payroll_core_v2_concept_enabled(p_company_id,'PERFORMANCE') then round(v_perf.quantity*v_employee.performance_rate,6) else 0 end,
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
end $function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_upsert_employee_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payload jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_command public.erp_operations_commands%rowtype;
  v_row public.erp_payroll_employees%rowtype;
  v_id uuid:=coalesce(nullif(p_payload->>'employeeId','')::uuid,gen_random_uuid());
  v_code text; v_result jsonb; v_record jsonb; v_exists boolean:=false; v_user_id uuid;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.employees.manage');
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
  perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,p_payload->>'expenseAccountCode','EXPENSE');
  if nullif(btrim(p_payload->>'identification'),'') is null or nullif(btrim(p_payload->>'fullName'),'') is null then
    raise exception using errcode='22023',message='PAYROLL_V2_EMPLOYEE_REQUIRED_FIELDS';
  end if;
  select * into v_row from public.erp_payroll_employees where company_id=p_company_id and employee_id=v_id for update;
  v_exists:=found;
  if not v_exists then
    select * into v_row from public.erp_payroll_employees where company_id=p_company_id and identification=btrim(p_payload->>'identification') for update;
    v_exists:=found;
    if v_exists then v_id:=v_row.employee_id; end if;
  end if;
  if v_exists and p_expected_version is not null and v_row.version<>p_expected_version then
    raise exception using errcode='40001',message='PAYROLL_V2_EMPLOYEE_VERSION_CONFLICT';
  end if;
  v_user_id:=case when p_payload?'userId' then nullif(btrim(p_payload->>'userId'),'')::uuid else v_row.user_id end;
  if v_user_id is not null and not exists(
    select 1 from public.user_company_memberships membership
    where membership.company_id=p_company_id and membership.user_id=v_user_id and membership.membership_status='ACTIVE'
  ) then raise exception using errcode='23514',message='PAYROLL_V2_EMPLOYEE_USER_NOT_ACTIVE_IN_COMPANY'; end if;
  v_code:=case when v_exists then v_row.employee_code else public.erp_payroll_core_v2_next_code(p_company_id,'EMPLOYEE',current_date) end;
  insert into public.erp_payroll_employees(company_id,employee_id,user_id,identification,employee_code,full_name,position_name,area,hire_date,status,
    calculation_mode,monthly_salary,hourly_rate,performance_rate,performance_unit,expense_account_code,created_by,updated_by,last_operation_id)
  values(p_company_id,v_id,v_user_id,btrim(p_payload->>'identification'),v_code,btrim(p_payload->>'fullName'),btrim(coalesce(p_payload->>'position','')),
    btrim(coalesce(p_payload->>'area','')),nullif(p_payload->>'hireDate','')::date,upper(coalesce(nullif(p_payload->>'status',''),'ACTIVE')),
    upper(coalesce(nullif(p_payload->>'calculationMode',''),'FIXED')),coalesce(nullif(p_payload->>'monthlySalary','')::numeric,0),
    coalesce(nullif(p_payload->>'hourlyRate','')::numeric,0),coalesce(nullif(p_payload->>'performanceRate','')::numeric,0),
    upper(coalesce(nullif(p_payload->>'performanceUnit',''),'UNITS')),btrim(coalesce(p_payload->>'expenseAccountCode','')),auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,employee_id) do update set user_id=excluded.user_id,identification=excluded.identification,full_name=excluded.full_name,
    position_name=excluded.position_name,area=excluded.area,hire_date=excluded.hire_date,status=excluded.status,
    calculation_mode=excluded.calculation_mode,monthly_salary=excluded.monthly_salary,hourly_rate=excluded.hourly_rate,
    performance_rate=excluded.performance_rate,performance_unit=excluded.performance_unit,expense_account_code=excluded.expense_account_code,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=public.erp_payroll_employees.version+1,last_operation_id=p_operation_id
  returning * into v_row;
  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_employees',v_id::text,
    jsonb_build_object('id',v_id,'employeeId',v_id,'userId',v_row.user_id,'employeeCode',v_row.employee_code,'identification',v_row.identification,
      'fullName',v_row.full_name,'position',v_row.position_name,'area',v_row.area,'hireDate',v_row.hire_date,'status',v_row.status,
      'calculationMode',v_row.calculation_mode,'monthlySalary',v_row.monthly_salary,'hourlyRate',v_row.hourly_rate,
      'performanceRate',v_row.performance_rate,'performanceUnit',v_row.performance_unit,'expenseAccountCode',v_row.expense_account_code,
      'version',v_row.version,'updatedAtServer',v_row.updated_at,'syncFlow','PAYROLL_CORE_V2'));
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'EMPLOYEE_UPSERTED','EMPLOYEE',v_id,jsonb_build_object('version',v_row.version,'userId',v_row.user_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_record),'result',jsonb_build_object('employeeId',v_id,'employeeCode',v_row.employee_code));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_UPSERT_EMPLOYEE',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_approve_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_records jsonb; v_result jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.approve');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
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
    if public.erp_payroll_core_v2_requires_recalculation(p_company_id,p_role_id) then raise exception using errcode='23514',message='PAYROLL_RECALCULATION_REQUIRED'; end if;
    if not exists(select 1 from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id) then
      raise exception using errcode='23514',message='PAYROLL_V2_ROLE_ITEMS_REQUIRED';
    end if;
    if exists(select 1 from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id
      and (net_total<0 or abs(base_amount_used-reference_base_salary)>0.000001 and nullif(btrim(base_adjustment_reason),'') is null)) then
      raise exception using errcode='23514',message='PAYROLL_V2_ROLE_ITEM_INVALID';
    end if;
    if exists(select 1 from public.erp_payroll_role_items i where i.company_id=p_company_id and i.role_id=p_role_id
      and i.calculation_mode_snapshot='FIXED_PERFORMANCE' and not exists(select 1 from public.erp_payroll_performance_policy_snapshots ps where ps.company_id=i.company_id and ps.role_item_id=i.role_item_id)) then
      raise exception using errcode='23514',message='PAYROLL_V2_PERFORMANCE_SNAPSHOT_REQUIRED';
    end if;
    update public.erp_payroll_performance_snapshots set frozen_at=clock_timestamp()
      where company_id=p_company_id and role_item_id in (select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id);
    update public.erp_payroll_performance_policy_snapshots set frozen_at=clock_timestamp()
      where company_id=p_company_id and role_item_id in (select role_item_id from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id);
    update public.erp_payroll_role_items set frozen_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
      where company_id=p_company_id and role_id=p_role_id;
    update public.erp_payroll_roles set status='APPROVED',approved_at=clock_timestamp(),approved_by=auth.uid(),updated_at=clock_timestamp(),
      updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and role_id=p_role_id returning * into v_role;
    update public.erp_payroll_periods set status='APPROVED',updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and period_id=v_role.period_id;
    perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ROLE_APPROVED','ROLE',p_role_id,
      jsonb_build_object('version',v_role.version,'employeeCount',v_role.employee_count,'totalIncome',v_role.total_income,'totalDiscounts',v_role.total_discounts,'netTotal',v_role.net_total));
    v_records:=public.erp_payroll_core_v2_publish_role_bundle(p_company_id,p_operation_id,p_device_id,p_role_id);
  end if;
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('roleId',p_role_id,'status','APPROVED'));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_APPROVE_ROLE',p_role_id::text,jsonb_build_object('expectedVersion',p_expected_version),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_post_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_accounting_date date DEFAULT NULL::date, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_period public.erp_payroll_periods%rowtype;
 v_settings public.erp_payroll_accounting_settings%rowtype; v_entry_id uuid; v_lines jsonb; v_records jsonb; v_result jsonb; v_missing text;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.post');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_CONFIGURATION',0));
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
    if v_role.calculation_config_snapshot is null then raise exception using errcode='23514',message='PAYROLL_APPROVED_CONFIGURATION_SNAPSHOT_REQUIRED'; end if;
    if exists(select 1 from public.erp_payroll_role_lines l join public.erp_payroll_role_items i on i.company_id=l.company_id and i.role_item_id=l.role_item_id
      where i.company_id=p_company_id and i.role_id=p_role_id and l.amount>0 and not public.erp_payroll_core_v2_concept_enabled(p_company_id,l.concept_code))
    then raise exception using errcode='23514',message='PAYROLL_CONCEPT_DISABLED'; end if;
    select * into v_settings from jsonb_populate_record(null::public.erp_payroll_accounting_settings,v_role.calculation_config_snapshot->'settings');
    if nullif(btrim(v_settings.payroll_payable_account_code),'') is null then
      raise exception using errcode='23514',message='PAYROLL_V2_ACCOUNT_REQUIRED:NOMINA_POR_PAGAR';
    end if;
    select i.employee_name_snapshot||' / '||l.concept_label into v_missing
      from public.erp_payroll_role_lines l join public.erp_payroll_role_items i on i.company_id=l.company_id and i.role_item_id=l.role_item_id
     where i.company_id=p_company_id and i.role_id=p_role_id and l.amount>0 and nullif(btrim(l.account_code),'') is null
     order by i.employee_name_snapshot,l.line_order limit 1;
    if v_missing is not null then raise exception using errcode='23514',message='PAYROLL_V2_ACCOUNT_REQUIRED:'||v_missing; end if;
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
        'lines',v_lines,'observation','Nómina V2 · valores manuales y rendimiento informativo'),'PAYROLL_ROLE',p_role_id::text,'POST_PAYROLL_ROLE');
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
end $function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_get_bundle_u2c4_internal(p_company_id uuid, p_role_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_roles jsonb; v_periods jsonb; v_employees jsonb; v_links jsonb; v_settings jsonb; v_policies jsonb; v_assignments jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'VIEW');
  select coalesce(jsonb_agg(to_jsonb(e) order by e.employee_code),'[]') into v_employees from public.erp_payroll_employees e where e.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.employee_id,l.operational_role),'[]') into v_links from public.erp_payroll_employee_operational_roles l where l.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.operational_role,p.code,p.policy_version desc),'[]') into v_policies from public.erp_payroll_performance_policies p where p.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id,a.operational_role,a.valid_from desc),'[]') into v_assignments from public.erp_payroll_employee_policy_assignments a where a.company_id=p_company_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.date_from desc),'[]') into v_periods from public.erp_payroll_periods p where p.company_id=p_company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id',r.company_id,'role_id',r.role_id,'period_id',r.period_id,'role_number',r.role_number,'status',r.status,'notes',r.notes,
    'employee_count',r.employee_count,'total_income',r.total_income,'total_discounts',r.total_discounts,'net_total',r.net_total,
    'accrual_journal_entry_id',r.accrual_journal_entry_id,'created_at',r.created_at,'calculated_at',r.calculated_at,'approved_at',r.approved_at,
    'posted_at',r.posted_at,'version',r.version,'requires_recalculation',public.erp_payroll_core_v2_requires_recalculation(p_company_id,r.role_id),'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_order) from public.erp_payroll_role_lines l where l.company_id=i.company_id and l.role_item_id=i.role_item_id),'[]'::jsonb),
      'performance_snapshot_count',(select count(*) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),
      'performance_policy_snapshots',coalesce((select jsonb_agg(to_jsonb(ps) order by ps.operational_role) from public.erp_payroll_performance_policy_snapshots ps where ps.company_id=i.company_id and ps.role_item_id=i.role_item_id),'[]'::jsonb)
    ) order by i.employee_name_snapshot) from public.erp_payroll_role_items i where i.company_id=r.company_id and i.role_id=r.role_id),'[]'::jsonb)
  ) order by r.created_at desc),'[]') into v_roles from public.erp_payroll_roles r where r.company_id=p_company_id and (p_role_id is null or r.role_id=p_role_id);
  select coalesce(to_jsonb(s),'{}') into v_settings from public.erp_payroll_accounting_settings s where s.company_id=p_company_id;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'employees',v_employees,'operationalRoles',v_links,
    'performancePolicies',v_policies,'policyAssignments',v_assignments,'periods',v_periods,'roles',v_roles,
    'accountingSettings',v_settings,'serverTime',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_get_bundle(p_company_id uuid, p_role_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
  v_roles boolean;
  v_employees boolean;
  v_performance boolean;
  v_accounting boolean;
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  v_roles := public.erp_security_has_capability(p_company_id, 'payroll.roles.view');
  v_employees := public.erp_security_has_capability(p_company_id, 'payroll.employees.view');
  v_performance := public.erp_security_has_capability(p_company_id, 'payroll.performance_policies.view');
  v_accounting := public.erp_security_has_capability(p_company_id, 'payroll.accounting_settings.view');
  if not (v_roles or v_employees or v_performance or v_accounting) then
    raise exception using errcode='42501',message='CAPABILITY_REQUIRED';
  end if;
  v_result := public.erp_payroll_core_v2_get_bundle_u2c4_internal(p_company_id, p_role_id);
  if not v_roles then
    v_result := jsonb_set(jsonb_set(v_result, '{roles}', '[]'::jsonb), '{periods}', '[]'::jsonb);
  end if;
  if not v_employees then
    v_result := jsonb_set(jsonb_set(v_result, '{employees}', '[]'::jsonb), '{operationalRoles}', '[]'::jsonb);
  end if;
  if not v_performance then
    v_result := jsonb_set(jsonb_set(v_result, '{performancePolicies}', '[]'::jsonb), '{policyAssignments}', '[]'::jsonb);
  end if;
  if not v_accounting then
    v_result := jsonb_set(v_result, '{accountingSettings}', '{}'::jsonb);
  end if;
  v_result := v_result||jsonb_build_object('functionalCore','PAYROLL_GO_LIVE_20260907',
    'conceptSettings',(select coalesce(jsonb_agg(to_jsonb(c) order by c.concept_code),'[]') from public.erp_payroll_concept_settings c where c.company_id=p_company_id),
    'accountOptions','[]'::jsonb,'accountDefaults','{}'::jsonb);
  if public.erp_security_has_capability(p_company_id,'payroll.employees.manage') or public.erp_security_has_capability(p_company_id,'payroll.accounting_settings.manage') then
    v_result := v_result||jsonb_build_object('accountOptions',public.erp_payroll_core_v2_account_choices(p_company_id),
      'accountDefaults',jsonb_build_object('company_id',p_company_id,'default_expense_account_code',coalesce((select default_expense_account_code from public.erp_payroll_accounting_settings where company_id=p_company_id),'')));
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_health(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_permissions jsonb;
  v_capabilities jsonb;
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  select coalesce(jsonb_agg(effective.capability_id order by effective.capability_id), '[]'::jsonb)
  into v_capabilities
  from public.erp_security_get_effective_capabilities(p_company_id) effective
  where effective.module = 'payroll';
  v_permissions := jsonb_build_object(
    'view', public.erp_payroll_core_v2_has_permission(p_company_id,'VIEW'),
    'manage', public.erp_payroll_core_v2_has_permission(p_company_id,'MANAGE'),
    'approve', public.erp_payroll_core_v2_has_permission(p_company_id,'APPROVE'),
    'post', public.erp_payroll_core_v2_has_permission(p_company_id,'POST')
  );
  return jsonb_build_object(
    'ok',true,'functionalCore','PAYROLL_GO_LIVE_20260907','okContract','PAYROLL_COMMAND_CONFIRMATION_V1','component','PAYROLL_CORE_V2','migration','202608210003','companyId',p_company_id,
    'permissions',v_permissions,'capabilities',v_capabilities,'securityAlignment','PAYROLL_CANONICAL_CAPABILITIES',
    'employeeTable',to_regclass('public.erp_payroll_employees') is not null,
    'operationalRoleTable',to_regclass('public.erp_payroll_employee_operational_roles') is not null,
    'periodTable',to_regclass('public.erp_payroll_periods') is not null,
    'roleTable',to_regclass('public.erp_payroll_roles') is not null,
    'snapshotTable',to_regclass('public.erp_payroll_performance_snapshots') is not null,
    'performancePolicyTable',to_regclass('public.erp_payroll_performance_policies') is not null,
    'policyAssignmentTable',to_regclass('public.erp_payroll_employee_policy_assignments') is not null,
    'policySnapshotTable',to_regclass('public.erp_payroll_performance_policy_snapshots') is not null,
    'manualRoleValues',true,'serverTotals',true,'baseAdjustmentAudit',true,'performanceDetailsOnDemand',true,
    'financialDependency',to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'postharvestParameterLink',true,'performancePolicy','VERSIONED_MEASUREMENT_V2','salaryImpact','NONE',
    'buncherSource','operations_bunches','classifierSource','operations_performances','serverTime',clock_timestamp()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_calculate_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_period_id uuid, p_payload jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.calculate', 'MANAGE');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_CALCULATE_ROLE',public.erp_payroll_core_v2_calculate_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_period_id, p_payload, p_expected_version, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_approve_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.approve', 'APPROVE');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_APPROVE_ROLE',public.erp_payroll_core_v2_approve_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_role_id, p_expected_version, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_post_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_accounting_date date DEFAULT NULL::date, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.post', 'POST');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_POST_ROLE',public.erp_payroll_core_v2_post_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_role_id, p_expected_version, p_accounting_date, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_create_period(p_operation_id uuid, p_company_id uuid, p_device_id text, p_year integer, p_month integer, p_date_from date, p_date_to date, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.calculate', 'MANAGE');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_CREATE_PERIOD',public.erp_payroll_core_v2_create_period_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_year, p_month, p_date_from, p_date_to, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_upsert_employee(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payload jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.employees.manage', 'MANAGE');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_UPSERT_EMPLOYEE',public.erp_payroll_core_v2_upsert_employee_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_expected_version, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_link_operational_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_employee_id uuid, p_operational_role text, p_operational_worker_id text, p_valid_from date, p_valid_to date DEFAULT NULL::date, p_active boolean DEFAULT true, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.employees.manage', 'MANAGE');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_LINK_OPERATIONAL_ROLE',public.erp_payroll_core_v2_link_operational_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_employee_id, p_operational_role, p_operational_worker_id, p_valid_from, p_valid_to, p_active, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_performance_v2_save_policy(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payload jsonb, p_prior_policy_id uuid DEFAULT NULL::uuid, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.performance_policies.manage', 'MANAGE');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_SAVE_PERFORMANCE_POLICY',public.erp_payroll_performance_v2_save_policy_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_prior_policy_id, p_expected_version, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_performance_v2_assign_policy(p_operation_id uuid, p_company_id uuid, p_device_id text, p_employee_id uuid, p_policy_id uuid, p_valid_from date, p_valid_to date DEFAULT NULL::date, p_active boolean DEFAULT true, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.performance_policies.manage', 'MANAGE');
  return public.erp_payroll_core_v2_confirm_ack(p_company_id,p_operation_id,'PAYROLL_V2_ASSIGN_PERFORMANCE_POLICY',public.erp_payroll_performance_v2_assign_policy_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_employee_id, p_policy_id, p_valid_from, p_valid_to, p_active, p_local_created_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_save_accounting_settings(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payroll_payable_account_code text, p_cost_center text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.accounting_settings.manage', 'POST');
  return public.erp_payroll_core_v2_save_accounting_settings(p_operation_id,p_company_id,p_device_id,p_payroll_payable_account_code,(select payroll_deduction_account_code from public.erp_payroll_accounting_settings where company_id=p_company_id),p_cost_center,(select default_expense_account_code from public.erp_payroll_accounting_settings where company_id=p_company_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_save_accounting_settings(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payroll_payable_account_code text, p_deduction_account_code text, p_cost_center text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.accounting_settings.manage', 'POST');
  return public.erp_payroll_core_v2_save_accounting_settings(p_operation_id,p_company_id,p_device_id,p_payroll_payable_account_code,p_deduction_account_code,p_cost_center,(select default_expense_account_code from public.erp_payroll_accounting_settings where company_id=p_company_id));
end;
$function$;

revoke all on function public.erp_payroll_core_v2_concept_enabled(uuid,text) from public,anon,authenticated;

grant execute on function public.erp_payroll_core_v2_concept_enabled(uuid,text) to service_role;

revoke all on function public.erp_payroll_core_v2_account_choices(uuid) from public,anon,authenticated;

grant execute on function public.erp_payroll_core_v2_account_choices(uuid) to service_role;

revoke all on function public.erp_payroll_core_v2_validate_account_choice(uuid,text,text) from public,anon,authenticated;

grant execute on function public.erp_payroll_core_v2_validate_account_choice(uuid,text,text) to service_role;

revoke all on function public.erp_payroll_core_v2_configuration_snapshot(uuid,uuid) from public,anon,authenticated;

grant execute on function public.erp_payroll_core_v2_configuration_snapshot(uuid,uuid) to service_role;

revoke all on function public.erp_payroll_core_v2_requires_recalculation(uuid,uuid) from public,anon,authenticated;

grant execute on function public.erp_payroll_core_v2_requires_recalculation(uuid,uuid) to service_role;

revoke all on function public.erp_payroll_core_v2_confirm_ack(uuid,uuid,text,jsonb) from public,anon,authenticated;

grant execute on function public.erp_payroll_core_v2_confirm_ack(uuid,uuid,text,jsonb) to service_role;

revoke all on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text,text) from public,anon;

grant execute on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text,text) to authenticated,service_role;

create function public.erp_payroll_core_v2_get_print_bundle(p_company_id uuid,p_role_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_roles%rowtype; p public.erp_payroll_periods%rowtype; c public.companies%rowtype; v_items jsonb;
begin
 perform public.erp_security_assert_capability(p_company_id,'payroll.roles.print');
 perform public.erp_security_assert_capability(p_company_id,'payroll.roles.view');
 select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id;
 if not found then raise exception using errcode='P0002',message='PAYROLL_V2_ROLE_NOT_FOUND'; end if;
 select * into p from public.erp_payroll_periods where company_id=r.company_id and period_id=r.period_id;
 select * into c from public.companies where id=r.company_id and is_active;
 if c.id is null or p.period_id is null then raise exception using errcode='23514',message='PAYROLL_PRINT_CANONICAL_COMPANY_REQUIRED'; end if;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object(
   'total_income',i.total_income::text,'total_discounts',i.total_discounts::text,'net_total',i.net_total::text,
   'reference_base_salary',i.reference_base_salary::text,'base_amount_used',i.base_amount_used::text,
   'lines',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('amount',l.amount::text) order by l.line_order),'[]')
      from public.erp_payroll_role_lines l where l.company_id=i.company_id and l.role_item_id=i.role_item_id and l.amount<>0),
   'summary',(select jsonb_build_object(
     'salary',coalesce(sum(l.amount) filter(where l.line_kind='EARNING' and l.concept_code in ('BASE_AMOUNT','SALARY')),0)::text,
     'overtime',coalesce(sum(l.amount) filter(where l.line_kind='EARNING' and l.concept_code in ('ADDITIONAL_HOURS','OVERTIME')),0)::text,
     'otherIncome',coalesce(sum(l.amount) filter(where l.line_kind='EARNING' and l.concept_code not in ('BASE_AMOUNT','SALARY','ADDITIONAL_HOURS','OVERTIME')),0)::text,
     'otherDeductions',coalesce(sum(l.amount) filter(where l.line_kind='DEDUCTION'),0)::text)
     from public.erp_payroll_role_lines l where l.company_id=i.company_id and l.role_item_id=i.role_item_id)
 ) order by i.employee_name_snapshot,i.role_item_id),'[]') into v_items from public.erp_payroll_role_items i where i.company_id=r.company_id and i.role_id=r.role_id;
 return jsonb_build_object('ok',true,'contract','PAYROLL_PRINT_V1','companyId',r.company_id,
   'company',jsonb_build_object('company_id',c.id,'commercial_name',c.commercial_name,'legal_name',c.legal_name,'tax_id',c.tax_id),
   'period',to_jsonb(p),'role',(to_jsonb(r)-'calculation_config_snapshot')||jsonb_build_object('total_income',r.total_income::text,'total_discounts',r.total_discounts::text,'net_total',r.net_total::text,'items',v_items),
   'serverTime',clock_timestamp());
end $$;
revoke all on function public.erp_payroll_core_v2_get_print_bundle(uuid,uuid) from public,anon;
grant execute on function public.erp_payroll_core_v2_get_print_bundle(uuid,uuid) to authenticated,service_role;

commit;
