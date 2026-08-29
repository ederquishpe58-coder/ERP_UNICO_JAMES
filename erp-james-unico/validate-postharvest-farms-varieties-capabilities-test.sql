begin;

do $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_denied boolean := false;
begin
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL') <> 175 then
    raise exception 'GERENCIA_GENERAL_EXPECTED_175';
  end if;
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='ADMINISTRADOR_ERP') <> 15 then
    raise exception 'ADMINISTRADOR_ERP_GRANT_REGRESSION';
  end if;
  if not exists (
    select 1 from public.erp_security_profile_capabilities
    where profile_id='GERENCIA_GENERAL' and capability_id='operations.farms_blocks.manage'
  ) or not exists (
    select 1 from public.erp_security_profile_capabilities
    where profile_id='GERENCIA_GENERAL' and capability_id='operations.varieties.manage'
  ) then
    raise exception 'GERENCIA_GENERAL_SPECIFIC_GRANTS_MISSING';
  end if;
  if exists (
    select 1 from public.erp_security_profile_capabilities
    where profile_id='GERENCIA_GENERAL' and capability_id='operations.parameters.manage'
  ) then
    raise exception 'BASE_DENIED_PARAMETER_MANAGE_GRANTED';
  end if;

  select membership.company_id, membership.user_id
    into v_company_id, v_user_id
  from public.user_company_memberships membership
  join public.companies company on company.id=membership.company_id and company.is_active
  join public.user_profiles profile on profile.user_id=membership.user_id and profile.is_active
  where membership.membership_status='ACTIVE'
    and not exists (
      select 1 from public.erp_security_user_capability_overrides override_row
      where override_row.company_id=membership.company_id and override_row.user_id=membership.user_id
    )
  order by membership.company_id, membership.user_id
  limit 1;

  if v_user_id is null then raise exception 'CONTROLLED_FIXTURE_ACTOR_NOT_FOUND'; end if;

  update public.user_company_memberships
  set membership_role='OWNER', membership_status='ACTIVE', is_default=true
  where company_id=v_company_id and user_id=v_user_id;

  insert into public.erp_security_user_company_profiles(company_id,user_id,profile_id)
  values(v_company_id,v_user_id,'GERENCIA_GENERAL')
  on conflict(company_id,user_id) do update
  set profile_id=excluded.profile_id, updated_at=clock_timestamp();

  perform set_config('request.jwt.claim.sub',v_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  if not public.erp_security_has_capability(v_company_id,'operations.parameters.view')
     or not public.erp_security_has_capability(v_company_id,'operations.farms_blocks.manage')
     or not public.erp_security_has_capability(v_company_id,'operations.varieties.manage') then
    raise exception 'POSTHARVEST_EFFECTIVE_CAPABILITY_MISMATCH';
  end if;

  perform public.erp_u2c3_assert_mutation_capability(
    'erp_apply_offline_operation',v_company_id,
    jsonb_build_object('entity','operations_suppliers','action','UPDATE','record_id','VALIDATOR-FARM')
  );
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_apply_offline_operation',v_company_id,
    jsonb_build_object('entity','operations_varieties','action','UPDATE','record_id','VALIDATOR-VARIETY')
  );

  begin
    perform public.erp_u2c3_assert_mutation_capability(
      'erp_apply_offline_operation',v_company_id,
      jsonb_build_object('entity','operations_lengths','action','UPDATE','record_id','VALIDATOR-LENGTH')
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'BROAD_PARAMETER_MANAGE_BYPASS'; end if;

  if public.erp_security_has_capability(v_company_id,'accounting.journal.reverse') then
    raise exception 'BASE_DENIED_BYPASS';
  end if;
end;
$$;

select jsonb_build_object(
  'profile','GERENCIA_GENERAL',
  'effective_capabilities',175,
  'farms_blocks_view','operations.parameters.view',
  'farms_blocks_manage','operations.farms_blocks.manage',
  'varieties_view','operations.parameters.view',
  'varieties_manage','operations.varieties.manage',
  'broad_parameter_manage',false,
  'base_denied_granted',0,
  'fixture','ROLLBACK'
) as result;

rollback;
