\set ON_ERROR_STOP on
begin;

create temporary table pg_temp.expected_postharvest_specific_capabilities(
  entity text primary key,
  capability_id text not null unique
) on commit drop;

insert into pg_temp.expected_postharvest_specific_capabilities(entity, capability_id)
values
  ('operations_classifiers', 'operations.classifiers.manage'),
  ('operations_bunchers', 'operations.bunchers.manage'),
  ('operations_receptionists', 'operations.receptionists.manage'),
  ('operations_digitizers', 'operations.digitizers.manage'),
  ('operations_scanners', 'operations.scanners.manage'),
  ('operations_responsibles', 'operations.responsibles.manage'),
  ('operations_lengths', 'operations.lengths.manage'),
  ('operations_stem_types', 'operations.stem_types.manage'),
  ('operations_label_types', 'operations.label_types.manage');

do $$
declare
  v_function_definition text;
begin
  if (select count(*) from pg_temp.expected_postharvest_specific_capabilities) <> 9 then
    raise exception 'EXPECTED_POSTHARVEST_SPECIFIC_CAPABILITIES_INVALID';
  end if;

  if exists (
    select 1
    from pg_temp.expected_postharvest_specific_capabilities expected
    left join public.erp_security_capabilities capability
      on capability.capability_id = expected.capability_id
     and capability.active
    where capability.capability_id is null
  ) then
    raise exception 'POSTHARVEST_SPECIFIC_CAPABILITY_MISSING';
  end if;

  if exists (
    select 1
    from pg_temp.expected_postharvest_specific_capabilities expected
    left join public.erp_security_profile_capabilities grant_row
      on grant_row.profile_id = 'GERENCIA_GENERAL'
     and grant_row.capability_id = expected.capability_id
    where grant_row.capability_id is null
  ) then
    raise exception 'GERENCIA_GENERAL_POSTHARVEST_SPECIFIC_GRANT_MISSING';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id = 'GERENCIA_GENERAL') <> 184 then
    raise exception 'GERENCIA_GENERAL_TOTAL_MISMATCH';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id = 'RECEPCIONISTA_P1') <> 9 then
    raise exception 'RECEPCIONISTA_P1_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where profile_id in ('GERENCIA_GENERAL', 'RECEPCIONISTA_P1')
      and capability_id = 'operations.parameters.manage'
  ) then
    raise exception 'BROAD_PARAMETERS_MANAGE_GRANTED';
  end if;

  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where profile_id = 'RECEPCIONISTA_P1'
      and capability_id in (select capability_id from pg_temp.expected_postharvest_specific_capabilities)
  ) then
    raise exception 'RECEPCIONISTA_P1_WAS_EXPANDED';
  end if;

  if (
    select count(*)
    from public.erp_u2c3_offline_action_capabilities action_map
    join pg_temp.expected_postharvest_specific_capabilities expected
      on expected.entity = action_map.entity
     and expected.capability_id = action_map.capability_id
    where action_map.action in ('INSERT', 'UPDATE', 'DELETE')
  ) <> 27 then
    raise exception 'POSTHARVEST_SPECIFIC_ACTION_MAP_MISMATCH';
  end if;

  if exists (
    select 1
    from public.erp_u2c3_offline_action_capabilities action_map
    join pg_temp.expected_postharvest_specific_capabilities expected
      on expected.entity = action_map.entity
    where action_map.action in ('INSERT', 'UPDATE', 'DELETE')
      and action_map.capability_id = 'operations.parameters.manage'
  ) then
    raise exception 'POSTHARVEST_BROAD_ACTION_MAP_REMAINS';
  end if;

  select pg_get_functiondef(
    'public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)'::regprocedure
  ) into v_function_definition;

  if position('operations.parameters.view' in v_function_definition) = 0
     or position('operations.classifiers.manage' in v_function_definition) = 0
     or position('operations.label_types.manage' in v_function_definition) = 0
     or position('perform public.erp_security_assert_capability(p_company_id, v_specific_capability)' in v_function_definition) = 0 then
    raise exception 'POSTHARVEST_VIEW_AND_SPECIFIC_FUNCTION_GUARD_MISSING';
  end if;
end;
$$;

select jsonb_build_object(
  'p0', 0,
  'p1', 0,
  'new_capabilities', (
    select jsonb_agg(capability_id order by capability_id)
    from pg_temp.expected_postharvest_specific_capabilities
  ),
  'new_capabilities_count', 9,
  'gerencia_general_total', (
    select count(*) from public.erp_security_profile_capabilities where profile_id = 'GERENCIA_GENERAL'
  ),
  'recepcionista_p1_total', (
    select count(*) from public.erp_security_profile_capabilities where profile_id = 'RECEPCIONISTA_P1'
  ),
  'operations_parameters_manage_granted', exists (
    select 1 from public.erp_security_profile_capabilities
    where profile_id in ('GERENCIA_GENERAL', 'RECEPCIONISTA_P1')
      and capability_id = 'operations.parameters.manage'
  ),
  'specific_action_guards', 27,
  'result', 'PASS'
) as validation_result;

rollback;
