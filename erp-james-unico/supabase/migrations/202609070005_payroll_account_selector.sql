-- Payroll account authority and explicit deduction counterparts.
-- Function definitions only; no chart, employee, settings or business-row changes.
-- company_id on erp_entity_records is canonical; payload company aliases are historical metadata.

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_account_choices(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('company_id',r.company_id,'code',r.payload->>'code',
   'name',r.payload->>'name','type',r.payload->>'type','nature',r.payload->>'nature',
   'status',r.payload->>'status','isMovement',true) order by r.payload->>'code'),'[]'::jsonb)
 from public.erp_entity_records r where r.company_id=p_company_id and r.entity='accounting_chart_accounts'
 and r.deleted_at is null and nullif(r.payload->>'deleted_at','') is null
 and coalesce(r.payload->>'__deleted','false')='false'
 and lower(r.payload->>'status') in ('activa','active')
 and lower(coalesce(r.payload->>'isMovement',r.payload->>'is_movement','false')) in ('true','1')
 and nullif(btrim(r.payload->>'code'),'') is not null
 and ((r.payload->>'type' in ('Gasto','Costo') and r.payload->>'nature'='Deudora')
   or (r.payload->>'type'='Pasivo' and r.payload->>'nature'='Acreedora')
   or (r.payload->>'type'='Activo' and r.payload->>'nature'='Deudora'))
$function$;

CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_validate_account_choice(p_company_id uuid, p_code text, p_purpose text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if nullif(btrim(p_code),'') is null then return; end if;
 if not exists(select 1 from jsonb_array_elements(public.erp_payroll_core_v2_account_choices(p_company_id)) a
   where a->>'code'=btrim(p_code)
   and ((p_purpose='EXPENSE' and a->>'type' in ('Gasto','Costo') and a->>'nature'='Deudora')
     or (p_purpose in ('PAYABLE','DEDUCTION') and a->>'type'='Pasivo' and a->>'nature'='Acreedora')
     or (p_purpose='ADVANCE_LINE' and a->>'type'='Activo' and a->>'nature'='Deudora')
     or (p_purpose='DEDUCTION_LINE' and ((a->>'type'='Pasivo' and a->>'nature'='Acreedora') or (a->>'type'='Activo' and a->>'nature'='Deudora')))))
 then raise exception using errcode='23514',message='PAYROLL_ACCOUNT_SELECTION_REQUIRED:'||p_purpose; end if;
end $function$;

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
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PAYROLL_PERFORMANCE_SOURCE',0));
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
    v_considered_days:=nullif(v_payload_item->>'consideredWorkdays','')::integer;
    if nullif(v_payload_item->>'consideredWorkdays','') is not null and (v_payload_item->>'consideredWorkdays') !~ '^\d+$' then raise exception using errcode='22023',message='PAYROLL_PERFORMANCE_WORKED_DAYS_REQUIRED'; end if;
    if v_considered_days<0 or v_considered_days>31 then raise exception using errcode='23514',message='PAYROLL_V2_CONSIDERED_DAYS_INVALID'; end if;
    v_policy_summary:=public.erp_payroll_performance_v2_snapshot_item(p_company_id,v_item_id,v_employee_id,v_period.date_from,v_period.date_to,v_considered_days);
    v_reference_salary:=case
      when coalesce((v_policy_summary->>'performance')::boolean,false) then 470
      when v_employee.calculation_mode in ('FIXED','FIXED_MANUAL_HOURS','MONTHLY','MIXED') then v_employee.monthly_salary
      else 0 end;
    v_base_used:=round(coalesce(nullif(v_payload_item->>'baseAmount','')::numeric,v_reference_salary),6);
    if coalesce((v_policy_summary->>'performance')::boolean,false) and not public.erp_payroll_core_v2_concept_enabled(p_company_id,'BASE_AMOUNT') then raise exception using errcode='23514',message='PAYROLL_CONCEPT_DISABLED:BASE_AMOUNT'; end if;
    v_adjustment_reason:=btrim(coalesce(v_payload_item->>'baseAdjustmentReason',''));
    if coalesce((v_policy_summary->>'performance')::boolean,false) and v_base_used<>470 then raise exception using errcode='23514',message='PAYROLL_PERFORMANCE_BASE_FIXED_470'; end if;
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
        case when coalesce((v_policy_summary->>'performance')::boolean,false) then 'PERFORMANCE_POLICY_BASE' else 'EMPLOYEE_MASTER' end,v_adjustment_reason);
    end if;
    -- Existing OTHER_INCOME, explicitly typed as automatic period excess.
    -- Historical PERFORMANCE remains disabled; no all-unit proportional payment.
    if coalesce((v_policy_summary->>'performance')::boolean,false) and (v_policy_summary->>'extraPay')::numeric>0 then
      if not public.erp_payroll_core_v2_concept_enabled(p_company_id,'OTHER_INCOME') then
        raise exception using errcode='23514',message='PAYROLL_CONCEPT_DISABLED:OTHER_INCOME';
      end if;
      v_line:=v_line+1;
      insert into public.erp_payroll_role_lines(company_id,role_item_id,line_order,line_kind,concept_code,concept_label,quantity,rate,amount,account_code,source_type,source_reference)
      values(p_company_id,v_item_id,v_line,'EARNING','OTHER_INCOME','Excedente de rendimiento del período',
        (v_policy_summary->>'excessUnits')::numeric,(v_policy_summary->>'unitCost')::numeric,(v_policy_summary->>'extraPay')::numeric,
        coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,''),'PERFORMANCE_PERIOD_EXCESS',v_policy_summary->>'operationalRole');
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
        if v_kind='DEDUCTION' and v_account='' then
          raise exception using errcode='23514',message='PAYROLL_DEDUCTION_LINE_ACCOUNT_REQUIRED:'||v_code;
        end if;
        if v_account<>'' then perform public.erp_payroll_core_v2_validate_account_choice(p_company_id,v_account,case when v_kind='EARNING' then 'EXPENSE' when v_code='ADVANCE' then 'ADVANCE_LINE' else 'DEDUCTION_LINE' end); end if;
        if v_account='' and v_kind='EARNING' then v_account:=coalesce(nullif(v_employee.expense_account_code,''),v_settings.default_expense_account_code,''); end if;
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
