begin;

-- P1 Payroll authorization only. No user, profile, permission, payroll, SRI or accounting data writes.
-- Existing ACLs/signatures and RLS policy definitions are preserved.
-- Historical permission rows and their administrative maintenance remain unchanged.
do $precheck$
begin
  if md5(pg_get_functiondef('erp_payroll_u2c4_assert_access(uuid,text,text)'::regprocedure)) not in ('2db869ed33cb2c90b3c493d599c5ed17','f7142d224c0118f85010b42b65b363dd') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_u2c4_assert_access(uuid,text,text)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_has_permission(uuid,text)'::regprocedure)) not in ('9ef331b64a93a9d328c9faf21f316c97','3e8deccb7633ab3920a474ec1cb9c1d8') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_has_permission(uuid,text)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_get_bundle(uuid,uuid)'::regprocedure)) not in ('e8e83524161bb772171499a6d861589f','79ff2e3aaf472b9bf60ba4345a0ce94d') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_get_bundle(uuid,uuid)'; end if;
  if md5(pg_get_functiondef('erp_payroll_u2c4_authorized_companies(text,text)'::regprocedure)) not in ('6fbd87f1920d4a999c00ce4e4c5501e0','fd77717bef8f71e6606ed8c631c6e462') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_u2c4_authorized_companies(text,text)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_health(uuid)'::regprocedure)) not in ('bcfb7f3be83aa919798d4eec3e95f9b2','458085b3248baebb264ef989a4c11e01') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_health(uuid)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_approve_role_u2c4_internal(uuid,uuid,text,uuid,bigint,timestamp with time zone)'::regprocedure)) not in ('144befdde6cca4c84024244d79207596','ab9e2abf784f6e44c17a3c25678b7b1d') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_approve_role_u2c4_internal(uuid,uuid,text,uuid,bigint,timestamp with time zone)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_calculate_role_u2c4_internal(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone)'::regprocedure)) not in ('49a98d81a610267d87fbfd9db4607b07','e69ef3add430dbed132b6e31c18c4431') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_calculate_role_u2c4_internal(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_create_period_u2c4_internal(uuid,uuid,text,integer,integer,date,date,timestamp with time zone)'::regprocedure)) not in ('2f1aaf9848702535fcfc4e4a3c796c26','245ff41d046029bb49005d636a501b0a') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_create_period_u2c4_internal(uuid,uuid,text,integer,integer,date,date,timestamp with time zone)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_get_performance_u2c4_internal(uuid,uuid,uuid)'::regprocedure)) not in ('c2e53392b8c7f8a6ac546120e4d37e71','01d4cb2e5cf59a22afee9e4261782205') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_get_performance_u2c4_internal(uuid,uuid,uuid)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_link_operational_role_u2c4_internal(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamp with time zone)'::regprocedure)) not in ('517c753c607a5095afa721dd083f4861','105d471885453fd1e671c503311fb7cc') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_link_operational_role_u2c4_internal(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamp with time zone)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_post_role_u2c4_internal(uuid,uuid,text,uuid,bigint,date,timestamp with time zone)'::regprocedure)) not in ('33a858a954fcdd10a2cb4a6b01ac2a25','f0a8f0e6dff83862dfbaa68ea45bec09') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_post_role_u2c4_internal(uuid,uuid,text,uuid,bigint,date,timestamp with time zone)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_save_accounting_settings_u2c4_internal(uuid,uuid,text,text,text,text)'::regprocedure)) not in ('48b45deb28ab978f42d122f067e06240','c9cb47ef8e8e0a74758f2d1bc09c1373') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_save_accounting_settings_u2c4_internal(uuid,uuid,text,text,text,text)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_save_accounting_settings_u2c4_internal(uuid,uuid,text,text,text)'::regprocedure)) not in ('c4d29a2e8ce3386990b94e24d25ba1ea','720ffc344d2f09ef202e6a4e00d9b8e9') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_save_accounting_settings_u2c4_internal(uuid,uuid,text,text,text)'; end if;
  if md5(pg_get_functiondef('erp_payroll_core_v2_upsert_employee_u2c4_internal(uuid,uuid,text,jsonb,bigint,timestamp with time zone)'::regprocedure)) not in ('579dd46d254b7628de7f8438c57f49ff','ca0d421602f7107ec779e9c60228b992') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_core_v2_upsert_employee_u2c4_internal(uuid,uuid,text,jsonb,bigint,timestamp with time zone)'; end if;
  if md5(pg_get_functiondef('erp_payroll_performance_v2_assign_policy_u2c4_internal(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamp with time zone)'::regprocedure)) not in ('61bc8579584e75f5be417d16a8fc4396','28bab1689c3859eab08ce9bb46f42ed5') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_performance_v2_assign_policy_u2c4_internal(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamp with time zone)'; end if;
  if md5(pg_get_functiondef('erp_payroll_performance_v2_save_policy_u2c4_internal(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone)'::regprocedure)) not in ('8d1fa5db83ad775ff618d52c1decdf6d','7c1e6016715cb33c4e3d3b03102be827') then raise exception 'PAYROLL_AUTH_SOURCE_DRIFT: erp_payroll_performance_v2_save_policy_u2c4_internal(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone)'; end if;
end;
$precheck$;

-- Exact capability, active membership and company checks; no legacy intersection
CREATE OR REPLACE FUNCTION public.erp_payroll_u2c4_assert_access(p_company_id uuid, p_capability_id text, p_legacy_permission text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Keep the existing signature for callers; legacy flags are not authorization.
  perform public.erp_security_assert_capability(p_company_id, p_capability_id);
end;
$function$;

-- Remove historical flags from health/read summaries; no write authority
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_has_permission(p_company_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_permission text := upper(btrim(coalesce(p_capability, '')));
begin
  -- Compatibility summary only. Every business RPC checks its exact capability.
  -- Never consult historical user flags.
  if v_permission = 'VIEW' then
    return public.erp_security_has_capability(p_company_id, 'payroll.employees.view')
      or public.erp_security_has_capability(p_company_id, 'payroll.roles.view')
      or public.erp_security_has_capability(p_company_id, 'payroll.performance_policies.view')
      or public.erp_security_has_capability(p_company_id, 'payroll.accounting_settings.view');
  elsif v_permission = 'MANAGE' then
    return public.erp_security_has_capability(p_company_id, 'payroll.employees.manage')
      or public.erp_security_has_capability(p_company_id, 'payroll.roles.calculate')
      or public.erp_security_has_capability(p_company_id, 'payroll.performance_policies.manage')
      or public.erp_security_has_capability(p_company_id, 'payroll.accounting_settings.manage');
  elsif v_permission = 'APPROVE' then
    return public.erp_security_has_capability(p_company_id, 'payroll.roles.approve');
  elsif v_permission = 'POST' then
    return public.erp_security_has_capability(p_company_id, 'payroll.roles.post');
  end if;
  return false;
end;
$function$;

-- Keep per-capability section filtering; authenticated active company required
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
  return v_result;
end;
$function$;

-- 13 existing Payroll SELECT policies retain exact capabilities and company membership
CREATE OR REPLACE FUNCTION public.erp_payroll_u2c4_authorized_companies(p_capability_id text, p_legacy_permission text)
 RETURNS TABLE(company_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select membership.company_id
  from public.user_company_memberships membership
  join public.companies company on company.id = membership.company_id and company.is_active
  join public.user_profiles profile on profile.user_id = membership.user_id and profile.is_active
  where membership.user_id = auth.uid()
    and membership.membership_status = 'ACTIVE'
    and (membership.valid_from is null or membership.valid_from <= current_date)
    and (membership.valid_until is null or membership.valid_until >= current_date)
    and public.erp_security_has_capability(membership.company_id, p_capability_id);
$function$;

-- Describe canonical authority; capabilities array already server-derived
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
    'ok',true,'component','PAYROLL_CORE_V2','migration','202608210003','companyId',p_company_id,
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

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_approve_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_command public.erp_operations_commands%rowtype; v_role public.erp_payroll_roles%rowtype; v_records jsonb; v_result jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.approve');
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_create_period_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_year integer, p_month integer, p_date_from date, p_date_to date, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_command public.erp_operations_commands%rowtype; v_period public.erp_payroll_periods%rowtype; v_result jsonb; v_record jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.roles.calculate');
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_get_performance_u2c4_internal(p_company_id uuid, p_employee_id uuid, p_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_period public.erp_payroll_periods%rowtype; v_rows jsonb; v_unlinked bigint; v_metrics jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.performance_policies.view');
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_link_operational_role_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_employee_id uuid, p_operational_role text, p_operational_worker_id text, p_valid_from date, p_valid_to date DEFAULT NULL::date, p_active boolean DEFAULT true, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_command public.erp_operations_commands%rowtype;
  v_link public.erp_payroll_employee_operational_roles%rowtype;
  v_result jsonb;
  v_record jsonb;
  v_role text:=upper(btrim(coalesce(p_operational_role,'')));
  v_worker text:=btrim(coalesce(p_operational_worker_id,''));
  v_reassigned integer:=0;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.employees.manage');
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_save_accounting_settings_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payroll_payable_account_code text, p_deduction_account_code text, p_cost_center text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_command public.erp_operations_commands%rowtype; v_settings public.erp_payroll_accounting_settings%rowtype; v_result jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.accounting_settings.manage');
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_core_v2_save_accounting_settings_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payroll_payable_account_code text, p_cost_center text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.accounting_settings.manage');
  perform public.erp_financial_v2_validate_account(p_company_id,p_payroll_payable_account_code);
  insert into public.erp_payroll_accounting_settings(company_id,payroll_payable_account_code,cost_center,created_by,updated_by)
  values(p_company_id,btrim(p_payroll_payable_account_code),btrim(coalesce(p_cost_center,'')),auth.uid(),auth.uid())
  on conflict(company_id) do update set payroll_payable_account_code=excluded.payroll_payable_account_code,cost_center=excluded.cost_center,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=public.erp_payroll_accounting_settings.version+1;
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'ACCOUNTING_SETTINGS_UPDATED','COMPANY',p_company_id,
    jsonb_build_object('payrollPayableAccountCode',p_payroll_payable_account_code,'costCenter',p_cost_center));
  return jsonb_build_object('ok',true,'companyId',p_company_id);
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
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

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_performance_v2_assign_policy_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_employee_id uuid, p_policy_id uuid, p_valid_from date, p_valid_to date DEFAULT NULL::date, p_active boolean DEFAULT true, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_command public.erp_operations_commands%rowtype; v_employee public.erp_payroll_employees%rowtype;
  v_policy public.erp_payroll_performance_policies%rowtype; v_assignment public.erp_payroll_employee_policy_assignments%rowtype;
  v_old public.erp_payroll_employee_policy_assignments%rowtype; v_record jsonb; v_records jsonb:='[]'::jsonb; v_result jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id,'payroll.performance_policies.manage');
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
end $function$;

-- Only replace internal coarse auth assertion with exact canonical capability; business body unchanged
CREATE OR REPLACE FUNCTION public.erp_payroll_performance_v2_save_policy_u2c4_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payload jsonb, p_prior_policy_id uuid DEFAULT NULL::uuid, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  perform public.erp_security_assert_capability(p_company_id,'payroll.performance_policies.manage');
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
end $function$;

commit;
