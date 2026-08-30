begin;

do $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_effective integer;
  v_missing integer;
  v_extra integer;
  v_cross_company uuid;
  v_cross_denied boolean := false;
begin
  if (select count(*) from public.erp_security_profiles where profile_id = 'RECEPCIONISTA_P1' and active) <> 1 then
    raise exception 'RECEPCIONISTA_P1_PROFILE_MISSING';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id = 'RECEPCIONISTA_P1') <> 9 then
    raise exception 'RECEPCIONISTA_P1_GRANT_COUNT_MISMATCH';
  end if;

  select membership.company_id, membership.user_id
  into v_company_id, v_user_id
  from public.user_company_memberships membership
  join public.companies company on company.id = membership.company_id and company.is_active
  join public.user_profiles profile on profile.user_id = membership.user_id and profile.is_active
  where membership.membership_status = 'ACTIVE'
  order by membership.company_id, membership.user_id
  limit 1;

  if v_user_id is null then
    raise exception 'RECEPCIONISTA_P1_CONTROLLED_ACTOR_NOT_FOUND';
  end if;

  update public.user_company_memberships
  set membership_role = 'EDITOR', membership_status = 'ACTIVE'
  where company_id = v_company_id and user_id = v_user_id;

  update public.user_company_memberships
  set membership_status = 'SUSPENDED', is_default = false
  where company_id <> v_company_id
    and user_id = v_user_id
    and membership_status = 'ACTIVE';

  insert into public.erp_security_user_company_profiles(company_id, user_id, profile_id)
  values(v_company_id, v_user_id, 'RECEPCIONISTA_P1')
  on conflict(company_id, user_id) do update
  set profile_id = excluded.profile_id, updated_at = clock_timestamp();

  delete from public.erp_security_user_capability_overrides
  where company_id = v_company_id and user_id = v_user_id;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*) into v_effective
  from public.erp_security_get_effective_capabilities(v_company_id);

  select count(*) into v_missing
  from public.erp_security_profile_capabilities expected
  where expected.profile_id = 'RECEPCIONISTA_P1'
    and not exists (
      select 1 from public.erp_security_get_effective_capabilities(v_company_id) effective
      where effective.capability_id = expected.capability_id
    );

  select count(*) into v_extra
  from public.erp_security_get_effective_capabilities(v_company_id) effective
  where not exists (
    select 1 from public.erp_security_profile_capabilities expected
    where expected.profile_id = 'RECEPCIONISTA_P1'
      and expected.capability_id = effective.capability_id
  );

  if (v_effective, v_missing, v_extra) <> (9, 0, 0) then
    raise exception 'RECEPCIONISTA_P1_EFFECTIVE_MISMATCH: effective=%, missing=%, extra=%',
      v_effective, v_missing, v_extra;
  end if;

  if not public.erp_security_has_capability(v_company_id, 'operations.parameters.view')
     or not public.erp_security_has_capability(v_company_id, 'operations.farms_blocks.manage')
     or not public.erp_security_has_capability(v_company_id, 'operations.varieties.manage')
     or not public.erp_security_has_capability(v_company_id, 'operations.reception.view')
     or not public.erp_security_has_capability(v_company_id, 'operations.reception.create')
     or not public.erp_security_has_capability(v_company_id, 'operations.reception.edit')
     or not public.erp_security_has_capability(v_company_id, 'operations.classification.view')
     or not public.erp_security_has_capability(v_company_id, 'operations.classification.record')
     or not public.erp_security_has_capability(v_company_id, 'operations.classification.edit') then
    raise exception 'RECEPCIONISTA_P1_REQUIRED_ACCESS_MISSING';
  end if;

  if public.erp_security_has_capability(v_company_id, 'admin.users.view')
     or public.erp_security_has_capability(v_company_id, 'commercial.orders.view')
     or public.erp_security_has_capability(v_company_id, 'operations.inventory.view')
     or public.erp_security_has_capability(v_company_id, 'accounting.chart.view')
     or public.erp_security_has_capability(v_company_id, 'operations.parameters.manage')
     or public.erp_security_has_capability(v_company_id, 'operations.reception.cancel') then
    raise exception 'RECEPCIONISTA_P1_UNEXPECTED_ACCESS';
  end if;

  select id into v_cross_company
  from public.companies
  where id <> v_company_id
    and is_active
    and not exists (
      select 1
      from public.user_company_memberships cross_membership
      where cross_membership.company_id = public.companies.id
        and cross_membership.user_id = v_user_id
        and cross_membership.membership_status = 'ACTIVE'
    )
  order by company_key
  limit 1;

  if v_cross_company is not null then
    begin
      perform public.erp_security_get_effective_capabilities(v_cross_company);
    exception when sqlstate '42501' then
      v_cross_denied := true;
    end;
    if not v_cross_denied then
      raise exception 'RECEPCIONISTA_P1_CROSS_COMPANY_NOT_DENIED';
    end if;
  end if;
end;
$$;

select jsonb_build_object(
  'profile', 'RECEPCIONISTA_P1',
  'profile_capabilities', 9,
  'missing', 0,
  'extra', 0,
  'owner_bypass', false,
  'cross_company', 'DENIED',
  'fixture', 'ROLLBACK'
) as result;

rollback;
