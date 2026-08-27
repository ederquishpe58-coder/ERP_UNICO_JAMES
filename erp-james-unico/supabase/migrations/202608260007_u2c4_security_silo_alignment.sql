begin;

-- U2C4: align historical Payroll authorization with the capability engine.
-- Capability is mandatory. The legacy Payroll flags remain an additional
-- restriction and can never turn a capability deny into allow.

create or replace function public.erp_payroll_u2c4_has_legacy_permission(
  p_company_id uuid,
  p_permission text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and public.erp_is_company_member(p_company_id, p_user_id)
    and exists (
      select 1
      from public.erp_payroll_user_permissions permission
      where permission.company_id = p_company_id
        and permission.user_id = p_user_id
        and case upper(btrim(p_permission))
          when 'VIEW' then permission.can_view
          when 'MANAGE' then permission.can_manage
          when 'APPROVE' then permission.can_approve
          when 'POST' then permission.can_post
          else false
        end
    );
$$;

create or replace function public.erp_payroll_u2c4_assert_access(
  p_company_id uuid,
  p_capability_id text,
  p_legacy_permission text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- The capability assertion runs first. A legacy allow never widens access.
  perform public.erp_security_assert_capability(p_company_id, p_capability_id);
  if not public.erp_payroll_u2c4_has_legacy_permission(p_company_id, p_legacy_permission) then
    raise exception using errcode = '42501', message = 'PAYROLL_V2_LEGACY_RESTRICTION_REQUIRED';
  end if;
end;
$$;

create or replace function public.erp_security_u2c4_assert_admin(
  p_company_id uuid,
  p_capability_id text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.erp_security_assert_capability(p_company_id, p_capability_id);
  if not exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = v_actor
      and membership.membership_status = 'ACTIVE'
      and membership.membership_role in ('OWNER','ADMIN')
      and (membership.valid_from is null or membership.valid_from <= current_date)
      and (membership.valid_until is null or membership.valid_until >= current_date)
  ) then
    raise exception using errcode = '42501', message = 'SECURITY_ADMIN_META_ROLE_REQUIRED';
  end if;
end;
$$;

-- Coarse compatibility helper remains capability-and-legacy intersection.
create or replace function public.erp_payroll_core_v2_has_permission(
  p_company_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text := upper(btrim(coalesce(p_capability, '')));
begin
  if not public.erp_payroll_u2c4_has_legacy_permission(p_company_id, v_permission) then
    return false;
  end if;
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
$$;

create or replace function public.erp_payroll_core_v2_assert_permission(
  p_company_id uuid,
  p_capability text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id) then
    raise exception using errcode='42501',message='PAYROLL_V2_COMPANY_ACCESS_DENIED';
  end if;
  if not public.erp_payroll_core_v2_has_permission(p_company_id,p_capability) then
    raise exception using errcode='42501',message='PAYROLL_V2_PERMISSION_DENIED:'||upper(btrim(p_capability));
  end if;
end;
$$;


alter function public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid) rename to erp_payroll_core_v2_get_performance_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_get_performance_u2c4_internal(uuid,uuid,uuid) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_get_performance(p_company_id uuid, p_employee_id uuid, p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.performance_policies.view', 'VIEW');
  return public.erp_payroll_core_v2_get_performance_u2c4_internal(p_company_id, p_employee_id, p_period_id);
end;
$$;

revoke all on function public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid) to authenticated;
comment on function public.erp_payroll_core_v2_get_performance(uuid,uuid,uuid) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamp with time zone) rename to erp_payroll_core_v2_upsert_employee_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_upsert_employee_u2c4_internal(uuid,uuid,text,jsonb,bigint,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_upsert_employee(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payload jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.employees.manage', 'MANAGE');
  return public.erp_payroll_core_v2_upsert_employee_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_expected_version, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamp with time zone) rename to erp_payroll_core_v2_link_operational_role_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_link_operational_role_u2c4_internal(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_link_operational_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_employee_id uuid, p_operational_role text, p_operational_worker_id text, p_valid_from date, p_valid_to date DEFAULT NULL::date, p_active boolean DEFAULT true, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.employees.manage', 'MANAGE');
  return public.erp_payroll_core_v2_link_operational_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_employee_id, p_operational_role, p_operational_worker_id, p_valid_from, p_valid_to, p_active, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_core_v2_link_operational_role(uuid,uuid,text,uuid,text,text,date,date,boolean,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_performance_v2_save_policy(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone) rename to erp_payroll_performance_v2_save_policy_u2c4_internal;
revoke all on function public.erp_payroll_performance_v2_save_policy_u2c4_internal(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_performance_v2_save_policy(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payload jsonb, p_prior_policy_id uuid DEFAULT NULL::uuid, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.performance_policies.manage', 'MANAGE');
  return public.erp_payroll_performance_v2_save_policy_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_prior_policy_id, p_expected_version, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_performance_v2_save_policy(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_performance_v2_save_policy(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_performance_v2_save_policy(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_performance_v2_assign_policy(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamp with time zone) rename to erp_payroll_performance_v2_assign_policy_u2c4_internal;
revoke all on function public.erp_payroll_performance_v2_assign_policy_u2c4_internal(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_performance_v2_assign_policy(p_operation_id uuid, p_company_id uuid, p_device_id text, p_employee_id uuid, p_policy_id uuid, p_valid_from date, p_valid_to date DEFAULT NULL::date, p_active boolean DEFAULT true, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.performance_policies.manage', 'MANAGE');
  return public.erp_payroll_performance_v2_assign_policy_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_employee_id, p_policy_id, p_valid_from, p_valid_to, p_active, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_performance_v2_assign_policy(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_performance_v2_assign_policy(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_performance_v2_assign_policy(uuid,uuid,text,uuid,uuid,date,date,boolean,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_create_period(uuid,uuid,text,integer,integer,date,date,timestamp with time zone) rename to erp_payroll_core_v2_create_period_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_create_period_u2c4_internal(uuid,uuid,text,integer,integer,date,date,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_create_period(p_operation_id uuid, p_company_id uuid, p_device_id text, p_year integer, p_month integer, p_date_from date, p_date_to date, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.calculate', 'MANAGE');
  return public.erp_payroll_core_v2_create_period_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_year, p_month, p_date_from, p_date_to, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_core_v2_create_period(uuid,uuid,text,integer,integer,date,date,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_create_period(uuid,uuid,text,integer,integer,date,date,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_core_v2_create_period(uuid,uuid,text,integer,integer,date,date,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_calculate_role(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone) rename to erp_payroll_core_v2_calculate_role_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_calculate_role_u2c4_internal(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_calculate_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_period_id uuid, p_payload jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.calculate', 'MANAGE');
  return public.erp_payroll_core_v2_calculate_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_period_id, p_payload, p_expected_version, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_core_v2_calculate_role(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_calculate_role(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_core_v2_calculate_role(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_approve_role(uuid,uuid,text,uuid,bigint,timestamp with time zone) rename to erp_payroll_core_v2_approve_role_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_approve_role_u2c4_internal(uuid,uuid,text,uuid,bigint,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_approve_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.approve', 'APPROVE');
  return public.erp_payroll_core_v2_approve_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_role_id, p_expected_version, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_core_v2_approve_role(uuid,uuid,text,uuid,bigint,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_approve_role(uuid,uuid,text,uuid,bigint,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_core_v2_approve_role(uuid,uuid,text,uuid,bigint,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_post_role(uuid,uuid,text,uuid,bigint,date,timestamp with time zone) rename to erp_payroll_core_v2_post_role_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_post_role_u2c4_internal(uuid,uuid,text,uuid,bigint,date,timestamp with time zone) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_post_role(p_operation_id uuid, p_company_id uuid, p_device_id text, p_role_id uuid, p_expected_version bigint, p_accounting_date date DEFAULT NULL::date, p_local_created_at timestamp with time zone DEFAULT now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.roles.post', 'POST');
  return public.erp_payroll_core_v2_post_role_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_role_id, p_expected_version, p_accounting_date, p_local_created_at);
end;
$$;

revoke all on function public.erp_payroll_core_v2_post_role(uuid,uuid,text,uuid,bigint,date,timestamp with time zone) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_post_role(uuid,uuid,text,uuid,bigint,date,timestamp with time zone) to authenticated;
comment on function public.erp_payroll_core_v2_post_role(uuid,uuid,text,uuid,bigint,date,timestamp with time zone) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text) rename to erp_payroll_core_v2_save_accounting_settings_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_save_accounting_settings_u2c4_internal(uuid,uuid,text,text,text,text) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_save_accounting_settings(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payroll_payable_account_code text, p_deduction_account_code text, p_cost_center text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.accounting_settings.manage', 'POST');
  return public.erp_payroll_core_v2_save_accounting_settings_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_payroll_payable_account_code, p_deduction_account_code, p_cost_center);
end;
$$;

revoke all on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text) to authenticated;
comment on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text,text) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text) rename to erp_payroll_core_v2_save_accounting_settings_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_save_accounting_settings_u2c4_internal(uuid,uuid,text,text,text) from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_save_accounting_settings(p_operation_id uuid, p_company_id uuid, p_device_id text, p_payroll_payable_account_code text, p_cost_center text DEFAULT ''::text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_payroll_u2c4_assert_access(p_company_id, 'payroll.accounting_settings.manage', 'POST');
  return public.erp_payroll_core_v2_save_accounting_settings_u2c4_internal(p_operation_id, p_company_id, p_device_id, p_payroll_payable_account_code, p_cost_center);
end;
$$;

revoke all on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text) from public, anon, service_role;
grant execute on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text) to authenticated;
comment on function public.erp_payroll_core_v2_save_accounting_settings(uuid,uuid,text,text,text) is
  'U2C4 exact capability plus legacy Payroll restriction. OWNER/ADMIN membership never grants business access.';


alter function public.erp_payroll_core_v2_get_bundle(uuid,uuid)
  rename to erp_payroll_core_v2_get_bundle_u2c4_internal;
revoke all on function public.erp_payroll_core_v2_get_bundle_u2c4_internal(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.erp_payroll_core_v2_get_bundle(
  p_company_id uuid,
  p_role_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_roles boolean;
  v_employees boolean;
  v_performance boolean;
  v_accounting boolean;
begin
  if not public.erp_payroll_u2c4_has_legacy_permission(p_company_id, 'VIEW') then
    raise exception using errcode='42501',message='PAYROLL_V2_LEGACY_RESTRICTION_REQUIRED';
  end if;
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
$$;
revoke all on function public.erp_payroll_core_v2_get_bundle(uuid,uuid) from public,anon,service_role;
grant execute on function public.erp_payroll_core_v2_get_bundle(uuid,uuid) to authenticated;

create or replace function public.erp_payroll_core_v2_health(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
    'permissions',v_permissions,'capabilities',v_capabilities,'securityAlignment','U2C4_CAPABILITY_AND_LEGACY',
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
$$;

create or replace function public.erp_payroll_core_v2_set_permissions(
  p_company_id uuid,
  p_user_id uuid,
  p_can_view boolean,
  p_can_manage boolean,
  p_can_approve boolean,
  p_can_post boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_u2c4_assert_admin(p_company_id, 'admin.users.manage');
  if p_user_id = auth.uid() then
    raise exception using errcode='42501',message='SECURITY_SELF_ELEVATION_DENIED';
  end if;
  if not public.erp_is_company_member(p_company_id,p_user_id) then
    raise exception using errcode='23514',message='PAYROLL_V2_USER_NOT_COMPANY_MEMBER';
  end if;
  insert into public.erp_payroll_user_permissions(
    company_id,user_id,can_view,can_manage,can_approve,can_post,created_by,updated_by
  ) values (
    p_company_id,p_user_id,p_can_view,p_can_manage,p_can_approve,p_can_post,auth.uid(),auth.uid()
  )
  on conflict(company_id,user_id) do update set
    can_view=excluded.can_view,can_manage=excluded.can_manage,
    can_approve=excluded.can_approve,can_post=excluded.can_post,
    updated_at=clock_timestamp(),updated_by=auth.uid();
  return jsonb_build_object('ok',true,'companyId',p_company_id,'userId',p_user_id);
end;
$$;

create or replace function public.erp_payroll_u2c4_authorized_companies(
  p_capability_id text,
  p_legacy_permission text
)
returns table(company_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select membership.company_id
  from public.user_company_memberships membership
  join public.companies company on company.id = membership.company_id and company.is_active
  join public.user_profiles profile on profile.user_id = membership.user_id and profile.is_active
  where membership.user_id = auth.uid()
    and membership.membership_status = 'ACTIVE'
    and (membership.valid_from is null or membership.valid_from <= current_date)
    and (membership.valid_until is null or membership.valid_until >= current_date)
    and public.erp_payroll_u2c4_has_legacy_permission(membership.company_id, p_legacy_permission)
    and public.erp_security_has_capability(membership.company_id, p_capability_id);
$$;

create or replace function public.erp_security_u2c4_admin_companies(p_capability_id text)
returns table(company_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select membership.company_id
  from public.user_company_memberships membership
  join public.companies company on company.id = membership.company_id and company.is_active
  join public.user_profiles profile on profile.user_id = membership.user_id and profile.is_active
  where membership.user_id = auth.uid()
    and membership.membership_status = 'ACTIVE'
    and membership.membership_role in ('OWNER','ADMIN')
    and (membership.valid_from is null or membership.valid_from <= current_date)
    and (membership.valid_until is null or membership.valid_until >= current_date)
    and public.erp_security_has_capability(membership.company_id, p_capability_id);
$$;

drop policy if exists payroll_v2_select on public.erp_payroll_accounting_settings;
create policy payroll_v2_select on public.erp_payroll_accounting_settings for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.accounting_settings.view','VIEW') allowed));

drop policy if exists payroll_v2_select on public.erp_payroll_employees;
create policy payroll_v2_select on public.erp_payroll_employees for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.employees.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_employee_operational_roles;
create policy payroll_v2_select on public.erp_payroll_employee_operational_roles for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.employees.view','VIEW') allowed));

drop policy if exists payroll_v2_select on public.erp_payroll_performance_policies;
create policy payroll_v2_select on public.erp_payroll_performance_policies for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.performance_policies.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_employee_policy_assignments;
create policy payroll_v2_select on public.erp_payroll_employee_policy_assignments for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.performance_policies.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_performance_policy_snapshots;
create policy payroll_v2_select on public.erp_payroll_performance_policy_snapshots for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.performance_policies.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_performance_snapshots;
create policy payroll_v2_select on public.erp_payroll_performance_snapshots for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.performance_policies.view','VIEW') allowed));

drop policy if exists payroll_v2_select on public.erp_payroll_periods;
create policy payroll_v2_select on public.erp_payroll_periods for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.roles.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_roles;
create policy payroll_v2_select on public.erp_payroll_roles for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.roles.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_role_items;
create policy payroll_v2_select on public.erp_payroll_role_items for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.roles.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_role_lines;
create policy payroll_v2_select on public.erp_payroll_role_lines for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.roles.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_events;
create policy payroll_v2_select on public.erp_payroll_events for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.roles.view','VIEW') allowed));
drop policy if exists payroll_v2_select on public.erp_payroll_sequence_counters;
create policy payroll_v2_select on public.erp_payroll_sequence_counters for select to authenticated
using (company_id in (select allowed.company_id from public.erp_payroll_u2c4_authorized_companies('payroll.roles.view','VIEW') allowed));

drop policy if exists payroll_v2_select on public.erp_payroll_user_permissions;
create policy payroll_v2_select on public.erp_payroll_user_permissions for select to authenticated
using (company_id in (select allowed.company_id from public.erp_security_u2c4_admin_companies('admin.users.manage') allowed));

drop trigger if exists erp_payroll_u2c4_permission_version on public.erp_payroll_user_permissions;
create trigger erp_payroll_u2c4_permission_version
after insert or update or delete on public.erp_payroll_user_permissions
for each row execute function public.erp_security_bump_company_version();

revoke all on function public.erp_payroll_u2c4_has_legacy_permission(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_u2c4_assert_access(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.erp_security_u2c4_assert_admin(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.erp_payroll_u2c4_authorized_companies(text,text) from public,anon,authenticated,service_role;
revoke all on function public.erp_security_u2c4_admin_companies(text) from public,anon,authenticated,service_role;

-- Direct interactive SRI draft calls choose the exact capability from the
-- canonical document type. The U2A actor binding and explicit service path
-- remain in the internal implementation.
create or replace function public.create_electronic_document_draft(
  p_company_id uuid,p_emission_point_id uuid,p_document_type text,p_issue_date date,
  p_numeric_code text,p_xml_version text,p_xsd_version text,p_issuer_snapshot jsonb,
  p_buyer_snapshot jsonb,p_source_snapshot jsonb,p_source_order_id uuid,
  p_source_packing_id uuid,p_customer_id uuid,p_parent_document_id uuid,p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capability text;
begin
  if auth.uid() is not null then
    v_capability := case p_document_type
      when '04' then 'commercial.credit_notes.create'
      when '07' then 'purchases.withholdings.create'
      else 'commercial.electronic_documents.create'
    end;
    perform public.erp_security_assert_capability(p_company_id, v_capability);
  end if;
  return public.create_electronic_document_draft_u2c3_internal(
    p_company_id,p_emission_point_id,p_document_type,p_issue_date,p_numeric_code,
    p_xml_version,p_xsd_version,p_issuer_snapshot,p_buyer_snapshot,p_source_snapshot,
    p_source_order_id,p_source_packing_id,p_customer_id,p_parent_document_id,p_created_by
  );
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where capability_id = any(array[
      'operations.parameters.manage','operations.reception.cancel','operations.boxes.cancel_order',
      'commercial.orders.cancel','commercial.preorders.cancel','commercial.export_products.manage',
      'commercial.box_types.manage','commercial.credit_notes.reverse',
      'commercial.electronic_documents.annul','accounting.journal.reverse',
      'purchases.documents.reverse','purchases.settlements.reverse','purchases.withholdings.reverse',
      'purchases.tax_supports.manage','treasury.payments.reverse','treasury.collections.reverse',
      'treasury.movements.reverse','treasury.reconciliation.reverse','inventory.consumptions.reverse',
      'inventory.adjustments.approve','inventory.adjustments.reverse','admin.sequences.manage'
    ]::text[])
  ) then
    raise exception 'U2C4_BASE_DENIED_PROFILE_GRANT_FOUND';
  end if;
end;
$$;

commit;
