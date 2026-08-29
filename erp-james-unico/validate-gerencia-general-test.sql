begin;

do $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_effective integer;
  v_missing integer;
  v_extra integer;
  v_base_denied_effective integer;
  v_admin_effective integer;
begin
  if (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'erp_security_capabilities',
        'erp_security_profiles',
        'erp_security_profile_capabilities',
        'erp_security_user_company_profiles',
        'erp_security_user_capability_overrides',
        'erp_security_engine_state',
        'erp_security_permission_versions'
      ]::text[])
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) <> 7 then
    raise exception 'SECURITY_RLS_REGRESSION';
  end if;

  if to_regprocedure('public.erp_security_assert_capability(uuid,text)') is null
     or to_regprocedure('public.erp_security_has_capability(uuid,text)') is null
     or to_regprocedure('public.erp_security_get_effective_capabilities(uuid)') is null then
    raise exception 'CAPABILITY_CHECK_FUNCTION_REGRESSION';
  end if;

  if (select count(*) from public.erp_security_profiles where profile_id = 'GERENCIA_GENERAL' and active) <> 1 then
    raise exception 'GERENCIA_GENERAL_PROFILE_MISSING';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id = 'GERENCIA_GENERAL') <> 173 then
    raise exception 'GERENCIA_GENERAL_GRANT_COUNT_MISMATCH';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id = 'ADMINISTRADOR_ERP') <> 15 then
    raise exception 'ADMINISTRADOR_ERP_GRANT_REGRESSION';
  end if;

  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where profile_id = 'GERENCIA_GENERAL'
      and capability_id like '%*%'
  ) then
    raise exception 'GERENCIA_GENERAL_WILDCARD_FOUND';
  end if;

  if (
    select count(*)
    from public.erp_security_capabilities capability
    where capability.active
      and not exists (
        select 1
        from public.erp_security_profile_capabilities profile_capability
        where profile_capability.capability_id = capability.capability_id
      )
  ) <> 22 then
    raise exception 'BASE_DENIED_COUNT_REGRESSION';
  end if;

  select membership.company_id, membership.user_id
  into v_company_id, v_user_id
  from public.user_company_memberships membership
  join public.companies company
    on company.id = membership.company_id
   and company.is_active
  join public.user_profiles profile
    on profile.user_id = membership.user_id
   and profile.is_active
  where membership.membership_status = 'ACTIVE'
    and not exists (
      select 1
      from public.erp_security_user_capability_overrides override_row
      where override_row.company_id = membership.company_id
        and override_row.user_id = membership.user_id
    )
  order by membership.company_id, membership.user_id
  limit 1;

  if v_user_id is null then
    raise exception 'GERENCIA_GENERAL_CONTROLLED_FIXTURE_ACTOR_NOT_FOUND';
  end if;

  update public.user_company_memberships
  set membership_role = 'OWNER',
      membership_status = 'ACTIVE',
      is_default = true
  where company_id = v_company_id
    and user_id = v_user_id;

  insert into public.erp_security_user_company_profiles(company_id, user_id, profile_id)
  values(v_company_id, v_user_id, 'ADMINISTRADOR_ERP')
  on conflict(company_id, user_id) do update
    set profile_id = excluded.profile_id,
        updated_at = clock_timestamp();

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*) into v_admin_effective
  from public.erp_security_get_effective_capabilities(v_company_id);

  if v_admin_effective <> 15 then
    raise exception 'OWNER_OR_ADMIN_BYPASS_DETECTED: %', v_admin_effective;
  end if;

  update public.erp_security_user_company_profiles
  set profile_id = 'GERENCIA_GENERAL',
      updated_at = clock_timestamp()
  where company_id = v_company_id
    and user_id = v_user_id;

  select count(*) into v_effective
  from public.erp_security_get_effective_capabilities(v_company_id);

  select count(*) into v_missing
  from public.erp_security_profile_capabilities expected
  where expected.profile_id = 'GERENCIA_GENERAL'
    and not exists (
      select 1
      from public.erp_security_get_effective_capabilities(v_company_id) effective
      where effective.capability_id = expected.capability_id
    );

  select count(*) into v_extra
  from public.erp_security_get_effective_capabilities(v_company_id) effective
  where not exists (
    select 1
    from public.erp_security_profile_capabilities expected
    where expected.profile_id = 'GERENCIA_GENERAL'
      and expected.capability_id = effective.capability_id
  );

  select count(*) into v_base_denied_effective
  from public.erp_security_get_effective_capabilities(v_company_id) effective
  where not exists (
    select 1
    from public.erp_security_profile_capabilities profile_capability
    where profile_capability.capability_id = effective.capability_id
  );

  if (v_effective, v_missing, v_extra, v_base_denied_effective) <> (173, 0, 0, 0) then
    raise exception 'GERENCIA_GENERAL_EFFECTIVE_MISMATCH: effective=%, missing=%, extra=%, base_denied=%',
      v_effective, v_missing, v_extra, v_base_denied_effective;
  end if;

  if not public.erp_security_has_capability(v_company_id, 'core.dashboard.view')
     or not public.erp_security_has_capability(v_company_id, 'admin.users.manage')
     or not public.erp_security_has_capability(v_company_id, 'commercial.orders.edit')
     or not public.erp_security_has_capability(v_company_id, 'commercial.exports.transition')
     or not public.erp_security_has_capability(v_company_id, 'operations.reception.create')
     or not public.erp_security_has_capability(v_company_id, 'operations.inventory.view')
     or not public.erp_security_has_capability(v_company_id, 'operations.availability.view')
     or not public.erp_security_has_capability(v_company_id, 'inventory.adjustments.create')
     or not public.erp_security_has_capability(v_company_id, 'purchases.documents.post')
     or not public.erp_security_has_capability(v_company_id, 'accounting.journal.post')
     or not public.erp_security_has_capability(v_company_id, 'treasury.reconciliation.execute')
     or not public.erp_security_has_capability(v_company_id, 'payroll.roles.post')
     or not public.erp_security_has_capability(v_company_id, 'reports.accounting.export')
     or not public.erp_security_has_capability(v_company_id, 'tax.ats.generate')
     or not public.erp_security_has_capability(v_company_id, 'portfolio.receivables.view') then
    raise exception 'GERENCIA_GENERAL_MODULE_COVERAGE_MISMATCH';
  end if;

  if public.erp_security_has_capability(v_company_id, 'accounting.journal.reverse') then
    raise exception 'GERENCIA_GENERAL_BASE_DENIED_BYPASS';
  end if;

  if position('erp_payroll_u2c4_has_legacy_permission' in pg_get_functiondef(
    'public.erp_payroll_u2c4_authorized_companies(text,text)'::regprocedure
  )) = 0 or position('erp_security_has_capability' in pg_get_functiondef(
    'public.erp_payroll_u2c4_authorized_companies(text,text)'::regprocedure
  )) = 0 then
    raise exception 'PAYROLL_DUAL_AUTHORIZATION_REGRESSION';
  end if;
end;
$$;

select jsonb_build_object(
  'profile', 'GERENCIA_GENERAL',
  'expected_capabilities', 173,
  'actual_profile_capabilities', (
    select count(*)
    from public.erp_security_profile_capabilities
    where profile_id = 'GERENCIA_GENERAL'
  ),
  'base_denied_total', 22,
  'base_denied_granted', 0,
  'administrador_erp', (
    select count(*)
    from public.erp_security_profile_capabilities
    where profile_id = 'ADMINISTRADOR_ERP'
  ),
  'owner_bypass', false,
  'payroll_dual_authorization', true,
  'fixture', 'ROLLBACK'
) as result;

rollback;
