-- Read-only counterpart choices under exact payroll.roles.calculate capability.
-- No memberships, capability rows, employees, chart or settings mutations.
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
  elsif public.erp_security_has_capability(p_company_id,'payroll.roles.calculate') then
    -- Calculators can choose deduction counterparts without employee/settings management.
    -- Do not expose accounting settings, expense defaults or unrelated expense choices.
    v_result := v_result||jsonb_build_object('accountOptions',
      (select coalesce(jsonb_agg(a order by a->>'code'),'[]'::jsonb)
       from jsonb_array_elements(public.erp_payroll_core_v2_account_choices(p_company_id)) a
       where (a->>'type'='Activo' and a->>'nature'='Deudora')
          or (a->>'type'='Pasivo' and a->>'nature'='Acreedora')));
  end if;
  return v_result;
end;
$function$;
