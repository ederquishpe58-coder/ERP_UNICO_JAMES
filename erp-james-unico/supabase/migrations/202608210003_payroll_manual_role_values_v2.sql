begin;

-- Nómina V2 Fase 3: valores manuales por período, auditoría del valor base y
-- congelamiento explícito. No incorpora fórmulas laborales ni modifica
-- Poscosecha, secuenciales o la migración histórica 202608160001.

insert into public.erp_payroll_backend_versions(component,version)
values('PAYROLL_CORE_V2','202608210003')
on conflict(component) do update set version=excluded.version,installed_at=clock_timestamp();

alter table public.erp_payroll_role_items
  add column if not exists employee_identification_snapshot text not null default '',
  add column if not exists reference_base_salary numeric(20,6) not null default 0,
  add column if not exists base_amount_used numeric(20,6) not null default 0,
  add column if not exists base_adjustment_reason text not null default '',
  add column if not exists base_adjusted_at timestamptz,
  add column if not exists base_adjusted_by uuid references auth.users(id),
  add column if not exists employee_notes text not null default '',
  add column if not exists frozen_at timestamptz;

alter table public.erp_payroll_role_items
  drop constraint if exists erp_payroll_role_items_reference_base_nonnegative,
  add constraint erp_payroll_role_items_reference_base_nonnegative check(reference_base_salary>=0),
  drop constraint if exists erp_payroll_role_items_base_used_nonnegative,
  add constraint erp_payroll_role_items_base_used_nonnegative check(base_amount_used>=0),
  drop constraint if exists erp_payroll_role_items_base_adjustment_reason_required,
  add constraint erp_payroll_role_items_base_adjustment_reason_required check(
    abs(base_amount_used-reference_base_salary)<=0.000001 or nullif(btrim(base_adjustment_reason),'') is not null
  );

alter table public.erp_payroll_role_lines
  add column if not exists line_notes text not null default '';

alter table public.erp_payroll_accounting_settings
  add column if not exists payroll_deduction_account_code text not null default '';

create or replace function public.erp_payroll_core_v2_publish_role_bundle(
  p_company_id uuid,p_operation_id uuid,p_device_id text,p_role_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_payroll_roles%rowtype; i record; l record; ps record; v_records jsonb:='[]'::jsonb;
begin
  select * into r from public.erp_payroll_roles where company_id=p_company_id and role_id=p_role_id;
  v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_roles',r.role_id::text,
    jsonb_build_object('id',r.role_id,'roleId',r.role_id,'periodId',r.period_id,'roleNumber',r.role_number,'status',r.status,
      'employeeCount',r.employee_count,'totalIncome',r.total_income,'totalDiscounts',r.total_discounts,'netTotal',r.net_total,
      'journalEntryId',r.accrual_journal_entry_id,'notes',r.notes,'createdAt',r.created_at,'calculatedAt',r.calculated_at,'approvedAt',r.approved_at,
      'postedAt',r.posted_at,'version',r.version,'syncFlow','PAYROLL_CORE_V2')));
  for i in select * from public.erp_payroll_role_items where company_id=p_company_id and role_id=p_role_id loop
    v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_items',i.role_item_id::text,
      jsonb_build_object('id',i.role_item_id,'roleItemId',i.role_item_id,'roleId',i.role_id,'employeeId',i.employee_id,
        'employeeCode',i.employee_code_snapshot,'employeeName',i.employee_name_snapshot,'employeeIdentification',i.employee_identification_snapshot,'position',i.position_snapshot,
        'calculationMode',i.calculation_mode_snapshot,'referenceBaseSalary',i.reference_base_salary,'baseAmountUsed',i.base_amount_used,
        'baseAdjustmentReason',i.base_adjustment_reason,'baseAdjustedAt',i.base_adjusted_at,'baseAdjustedBy',i.base_adjusted_by,
        'employeeNotes',i.employee_notes,'frozenAt',i.frozen_at,'performanceSnapshotCount',(select count(*) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),
        'totalIncome',i.total_income,'totalDiscounts',i.total_discounts,'netTotal',i.net_total,
        'version',i.version,'syncFlow','PAYROLL_CORE_V2')));
    for l in select * from public.erp_payroll_role_lines where company_id=i.company_id and role_item_id=i.role_item_id order by line_order loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_role_lines',l.role_line_id::text,
        to_jsonb(l)||jsonb_build_object('id',l.role_line_id,'roleLineId',l.role_line_id,'roleItemId',l.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
    -- El detalle fuente permanece canónico en PostgreSQL y se consulta con
    -- get_performance. No se replica masivamente a la caché en cada posteo.
    for ps in select * from public.erp_payroll_performance_policy_snapshots where company_id=i.company_id and role_item_id=i.role_item_id loop
      v_records:=v_records||jsonb_build_array(public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_policy_snapshots',ps.policy_snapshot_id::text,
        to_jsonb(ps)||jsonb_build_object('id',ps.policy_snapshot_id,'policySnapshotId',ps.policy_snapshot_id,'roleItemId',ps.role_item_id,'syncFlow','PAYROLL_CORE_V2')));
    end loop;
  end loop;
  return v_records;
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
    'company_id',r.company_id,'role_id',r.role_id,'period_id',r.period_id,'role_number',r.role_number,'status',r.status,'notes',r.notes,
    'employee_count',r.employee_count,'total_income',r.total_income,'total_discounts',r.total_discounts,'net_total',r.net_total,
    'accrual_journal_entry_id',r.accrual_journal_entry_id,'created_at',r.created_at,'calculated_at',r.calculated_at,'approved_at',r.approved_at,
    'posted_at',r.posted_at,'version',r.version,'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_order) from public.erp_payroll_role_lines l where l.company_id=i.company_id and l.role_item_id=i.role_item_id),'[]'::jsonb),
      'performance_snapshot_count',(select count(*) from public.erp_payroll_performance_snapshots s where s.company_id=i.company_id and s.role_item_id=i.role_item_id),
      'performance_policy_snapshots',coalesce((select jsonb_agg(to_jsonb(ps) order by ps.operational_role) from public.erp_payroll_performance_policy_snapshots ps where ps.company_id=i.company_id and ps.role_item_id=i.role_item_id),'[]'::jsonb)
    ) order by i.employee_name_snapshot) from public.erp_payroll_role_items i where i.company_id=r.company_id and i.role_id=r.role_id),'[]'::jsonb)
  ) order by r.created_at desc),'[]') into v_roles from public.erp_payroll_roles r where r.company_id=p_company_id and (p_role_id is null or r.role_id=p_role_id);
  select coalesce(to_jsonb(s),'{}') into v_settings from public.erp_payroll_accounting_settings s where s.company_id=p_company_id;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'employees',v_employees,'operationalRoles',v_links,
    'performancePolicies',v_policies,'policyAssignments',v_assignments,'periods',v_periods,'roles',v_roles,
    'accountingSettings',v_settings,'serverTime',clock_timestamp());
end $$;

create or replace function public.erp_payroll_core_v2_calculate_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_period_id uuid,p_payload jsonb,p_expected_version bigint default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_command public.erp_operations_commands%rowtype; v_period public.erp_payroll_periods%rowtype; v_role public.erp_payroll_roles%rowtype;
  v_employee public.erp_payroll_employees%rowtype; v_settings public.erp_payroll_accounting_settings%rowtype; v_item_id uuid; v_employee_id uuid;
  v_payload_item jsonb; v_concept jsonb; v_perf record; v_line integer; v_income numeric; v_deductions numeric; v_amount numeric;
  v_qty numeric; v_kind text; v_code text; v_label text; v_account text; v_notes text; v_role_id uuid; v_records jsonb; v_result jsonb;
  v_policy_summary jsonb; v_reference_salary numeric; v_base_used numeric; v_adjustment_reason text; v_considered_days integer;
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
      employee_identification_snapshot,position_snapshot,calculation_mode_snapshot,last_operation_id)
    values(p_company_id,v_item_id,v_role_id,v_employee_id,v_employee.employee_code,v_employee.full_name,v_employee.identification,v_employee.position_name,v_employee.calculation_mode,p_operation_id);
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
      values(p_company_id,v_item_id,v_line,'EARNING','BASE_AMOUNT','Valor base del período',1,0,v_base_used,v_employee.expense_account_code,
        case when v_employee.calculation_mode='FIXED_PERFORMANCE' then 'PERFORMANCE_POLICY_BASE' else 'EMPLOYEE_MASTER' end,v_adjustment_reason);
    end if;
    -- Los snapshots de rendimiento son informativos para las modalidades nuevas.
    -- Solo se conserva la remuneración por unidad para modalidades históricas.
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
        if v_account='' then v_account:=case when v_kind='EARNING' then v_employee.expense_account_code else coalesce(v_settings.payroll_deduction_account_code,'') end; end if;
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
  update public.erp_payroll_roles set status='CALCULATED',employee_count=v_line,total_income=v_income,total_discounts=v_deductions,net_total=v_amount,
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
end $$;

create or replace function public.erp_payroll_core_v2_save_accounting_settings(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payroll_payable_account_code text,p_deduction_account_code text,p_cost_center text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_settings public.erp_payroll_accounting_settings%rowtype; v_result jsonb;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'POST');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  insert into public.erp_payroll_accounting_settings(company_id,payroll_payable_account_code,payroll_deduction_account_code,cost_center,created_by,updated_by)
  values(p_company_id,btrim(coalesce(p_payroll_payable_account_code,'')),btrim(coalesce(p_deduction_account_code,'')),btrim(coalesce(p_cost_center,'')),auth.uid(),auth.uid())
  on conflict(company_id) do update set payroll_payable_account_code=excluded.payroll_payable_account_code,
    payroll_deduction_account_code=excluded.payroll_deduction_account_code,cost_center=excluded.cost_center,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=public.erp_payroll_accounting_settings.version+1
  returning * into v_settings;
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ACCOUNTING_SETTINGS_UPDATED','ACCOUNTING_SETTINGS',p_company_id,
    jsonb_build_object('payrollPayableAccountCode',v_settings.payroll_payable_account_code,'deductionAccountCode',v_settings.payroll_deduction_account_code,'costCenter',v_settings.cost_center));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records','[]'::jsonb,'result',to_jsonb(v_settings));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_SAVE_ACCOUNTING_SETTINGS',p_company_id::text,
    jsonb_build_object('payrollPayableAccountCode',p_payroll_payable_account_code,'deductionAccountCode',p_deduction_account_code,'costCenter',p_cost_center),
    v_result,'CONFIRMED',auth.uid(),p_device_id,clock_timestamp(),clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_payroll_core_v2_post_role(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_role_id uuid,p_expected_version bigint,p_accounting_date date default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_period public.erp_payroll_periods%rowtype;
 v_settings public.erp_payroll_accounting_settings%rowtype; v_entry_id uuid; v_lines jsonb; v_records jsonb; v_result jsonb; v_missing text;
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
    if not found or nullif(btrim(v_settings.payroll_payable_account_code),'') is null then
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
  return jsonb_build_object('ok',true,'component','PAYROLL_CORE_V2','migration','202608210003','companyId',p_company_id,
    'permissions',v_permissions,'capabilities',jsonb_build_array('payroll.view','payroll.manage','payroll.approve','payroll.post'),
    'employeeTable',to_regclass('public.erp_payroll_employees') is not null,'operationalRoleTable',to_regclass('public.erp_payroll_employee_operational_roles') is not null,
    'periodTable',to_regclass('public.erp_payroll_periods') is not null,'roleTable',to_regclass('public.erp_payroll_roles') is not null,
    'snapshotTable',to_regclass('public.erp_payroll_performance_snapshots') is not null,
    'performancePolicyTable',to_regclass('public.erp_payroll_performance_policies') is not null,
    'policyAssignmentTable',to_regclass('public.erp_payroll_employee_policy_assignments') is not null,
    'policySnapshotTable',to_regclass('public.erp_payroll_performance_policy_snapshots') is not null,
    'manualRoleValues',true,'serverTotals',true,'baseAdjustmentAudit',true,'performanceDetailsOnDemand',true,
    'financialDependency',to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'postharvestParameterLink',true,'performancePolicy','VERSIONED_MEASUREMENT_V2','salaryImpact','NONE',
    'buncherSource','operations_bunches','classifierSource','operations_performances','serverTime',clock_timestamp());
end $$;

revoke execute on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
