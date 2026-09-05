begin;

do $$
begin
  if to_regclass('public.erp_security_capabilities') is null
     or to_regclass('public.erp_security_profile_capabilities') is null
     or to_regclass('public.erp_u2c3_offline_action_capabilities') is null
     or to_regprocedure('public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)') is null then
    raise exception 'POSTHARVEST_SPECIFIC_CAPABILITY_FOUNDATION_MISSING';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id = 'RECEPCIONISTA_P1') <> 9 then
    raise exception 'RECEPCIONISTA_P1_PREEXISTING_GRANT_COUNT_MISMATCH';
  end if;
end;
$$;

create temporary table pg_temp.postharvest_specific_capabilities(
  entity text primary key,
  capability_id text not null unique,
  resource text not null,
  description text not null
) on commit drop;

insert into pg_temp.postharvest_specific_capabilities(entity, capability_id, resource, description)
values
  ('operations_classifiers', 'operations.classifiers.manage', 'classifiers', 'Administra exclusivamente el catálogo canónico de clasificadores de Poscosecha.'),
  ('operations_bunchers', 'operations.bunchers.manage', 'bunchers', 'Administra exclusivamente el catálogo canónico de embonchadores de Poscosecha.'),
  ('operations_receptionists', 'operations.receptionists.manage', 'receptionists', 'Administra exclusivamente el catálogo canónico de recepcionistas de Poscosecha.'),
  ('operations_digitizers', 'operations.digitizers.manage', 'digitizers', 'Administra exclusivamente el catálogo canónico de digitadores de Poscosecha.'),
  ('operations_scanners', 'operations.scanners.manage', 'scanners', 'Administra exclusivamente el catálogo canónico de responsables de escaneo de Poscosecha.'),
  ('operations_responsibles', 'operations.responsibles.manage', 'responsibles', 'Administra exclusivamente el catálogo canónico de responsables de despacho de Poscosecha.'),
  ('operations_lengths', 'operations.lengths.manage', 'lengths', 'Administra exclusivamente el catálogo canónico de medidas de Poscosecha.'),
  ('operations_stem_types', 'operations.stem_types.manage', 'stem_types', 'Administra exclusivamente el catálogo canónico de tipos de tallo de Poscosecha.'),
  ('operations_label_types', 'operations.label_types.manage', 'label_types', 'Administra exclusivamente el catálogo canónico de tipos de etiqueta de Poscosecha.');

insert into public.erp_security_capabilities(
  capability_id, module, resource, action, risk_level, description, active
)
select capability_id, 'operations', resource, 'manage', 'MEDIUM', description, true
from pg_temp.postharvest_specific_capabilities
on conflict (capability_id) do update
set module = excluded.module,
    resource = excluded.resource,
    action = excluded.action,
    risk_level = excluded.risk_level,
    description = excluded.description,
    active = excluded.active,
    updated_at = clock_timestamp();

insert into public.erp_security_profile_capabilities(profile_id, capability_id)
select 'GERENCIA_GENERAL', capability_id
from pg_temp.postharvest_specific_capabilities
on conflict (profile_id, capability_id) do nothing;

update public.erp_u2c3_offline_action_capabilities action_map
set capability_id = specific.capability_id
from pg_temp.postharvest_specific_capabilities specific
where action_map.entity = specific.entity
  and action_map.action in ('INSERT', 'UPDATE', 'DELETE');

create or replace function public.erp_u2c3_assert_mutation_capability(
  p_rpc_name text,
  p_company_id uuid,
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.erp_u2c3_mutation_rpc_capabilities%rowtype;
  v_command_rule public.erp_u2c3_operations_command_capabilities%rowtype;
  v_capability text;
  v_specific_capability text;
  v_entity text := nullif(btrim(coalesce(p_context->>'entity','')), '');
  v_action text := upper(btrim(coalesce(p_context->>'action','')));
  v_record_id text := nullif(btrim(coalesce(p_context->>'record_id','')), '');
  v_command text := upper(btrim(coalesce(p_context->>'command','')));
  v_payload jsonb := coalesce(p_context->'payload','{}'::jsonb);
  v_exists boolean := false;
begin
  select * into v_rule from public.erp_u2c3_mutation_rpc_capabilities where rpc_name=p_rpc_name;
  if not found then
    raise exception using errcode='42501',message='U2C3_MUTATION_RPC_UNMAPPED';
  end if;

  if v_rule.resolution_strategy in ('FIXED','SRI_INTERACTIVE') then
    v_capability := v_rule.capability_id;
  elsif v_rule.resolution_strategy='COMMERCIAL_ORDER_STATE' then
    if v_record_id is null then raise exception using errcode='22023',message='U2C3_COMMERCIAL_RECORD_REQUIRED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':U2C3:COMMERCIAL_ORDER:'||v_record_id,0));
    select exists(select 1 from public.erp_entity_records r where r.company_id=p_company_id and r.entity='commercial_orders' and r.record_id=v_record_id and r.deleted_at is null) into v_exists;
    v_capability := case when v_exists then 'commercial.orders.edit' else 'commercial.orders.create' end;
  elsif v_rule.resolution_strategy='OPERATIONS_COMMAND' then
    select * into v_command_rule from public.erp_u2c3_operations_command_capabilities where command=v_command;
    if not found then raise exception using errcode='42501',message='U2C3_OPERATIONS_COMMAND_UNMAPPED'; end if;
    if v_command_rule.resolution_strategy='RECEPTION_STATE' then
      v_record_id := nullif(btrim(coalesce(v_payload->>'receptionId','')), '');
      if v_record_id is null then raise exception using errcode='22023',message='U2C3_RECEPTION_RECORD_REQUIRED'; end if;
      perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':U2C3:RECEPTION:'||v_record_id,0));
      select exists(select 1 from public.erp_entity_records r where r.company_id=p_company_id and r.entity='operations_receptions' and r.record_id=v_record_id and r.deleted_at is null) into v_exists;
      v_capability := case when v_exists then 'operations.reception.edit' else 'operations.reception.create' end;
    else
      v_capability := v_command_rule.capability_id;
    end if;
  elsif v_rule.resolution_strategy='OFFLINE_ENTITY_ACTION' then
    if v_entity is null or v_record_id is null or v_action not in ('INSERT','UPDATE','DELETE') then
      raise exception using errcode='42501',message='U2C3_OFFLINE_ACTION_UNMAPPED';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':U2C3:OFFLINE:'||v_entity||':'||v_record_id,0));
    if v_entity='commercial_orders' and v_action in ('INSERT','UPDATE') then
      select exists(select 1 from public.erp_entity_records r where r.company_id=p_company_id and r.entity=v_entity and r.record_id=v_record_id and r.deleted_at is null) into v_exists;
      v_capability := case when v_exists then 'commercial.orders.edit' else 'commercial.orders.create' end;
    elsif v_entity='commercial_orders' and v_action='DELETE' then
      v_capability := 'commercial.orders.cancel';
    else
      select capability_id into v_capability
      from public.erp_u2c3_offline_action_capabilities
      where entity=v_entity and action=v_action;

      v_specific_capability := case v_entity
        when 'operations_suppliers' then 'operations.farms_blocks.manage'
        when 'operations_classifiers' then 'operations.classifiers.manage'
        when 'operations_bunchers' then 'operations.bunchers.manage'
        when 'operations_receptionists' then 'operations.receptionists.manage'
        when 'operations_digitizers' then 'operations.digitizers.manage'
        when 'operations_scanners' then 'operations.scanners.manage'
        when 'operations_responsibles' then 'operations.responsibles.manage'
        when 'operations_varieties' then 'operations.varieties.manage'
        when 'operations_lengths' then 'operations.lengths.manage'
        when 'operations_stem_types' then 'operations.stem_types.manage'
        when 'operations_label_types' then 'operations.label_types.manage'
        else null
      end;
    end if;
  end if;

  if v_capability is null then
    raise exception using errcode='42501',message='U2C3_MUTATION_ACTION_UNMAPPED';
  end if;

  if v_specific_capability is not null then
    perform public.erp_security_assert_capability(p_company_id, 'operations.parameters.view');
    perform public.erp_security_assert_capability(p_company_id, v_specific_capability);
    return;
  end if;

  perform public.erp_security_assert_capability(p_company_id,v_capability);
end;
$$;

revoke all on function public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)
  from public, anon, authenticated, service_role;

do $$
declare
  v_function_definition text;
begin
  if (select count(*) from pg_temp.postharvest_specific_capabilities) <> 9 then
    raise exception 'POSTHARVEST_SPECIFIC_CAPABILITY_MATRIX_COUNT_MISMATCH';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL') <> 184 then
    raise exception 'GERENCIA_GENERAL_POSTHARVEST_GRANT_COUNT_MISMATCH';
  end if;

  if (select count(*) from public.erp_security_profile_capabilities where profile_id='RECEPCIONISTA_P1') <> 9 then
    raise exception 'RECEPCIONISTA_P1_FINAL_GRANT_COUNT_MISMATCH';
  end if;

  if exists (
    select 1 from public.erp_security_profile_capabilities
    where capability_id = 'operations.parameters.manage'
      and profile_id in ('GERENCIA_GENERAL', 'RECEPCIONISTA_P1')
  ) then
    raise exception 'POSTHARVEST_BROAD_PARAMETER_MANAGE_NOT_ALLOWED';
  end if;

  if exists (
    select 1
    from pg_temp.postharvest_specific_capabilities specific
    left join public.erp_security_profile_capabilities grant_row
      on grant_row.profile_id = 'GERENCIA_GENERAL'
     and grant_row.capability_id = specific.capability_id
    where grant_row.capability_id is null
  ) then
    raise exception 'GERENCIA_GENERAL_POSTHARVEST_SPECIFIC_GRANT_MISSING';
  end if;

  if (
    select count(*)
    from public.erp_u2c3_offline_action_capabilities action_map
    join pg_temp.postharvest_specific_capabilities specific
      on specific.entity = action_map.entity
     and specific.capability_id = action_map.capability_id
    where action_map.action in ('INSERT', 'UPDATE', 'DELETE')
  ) <> 27 then
    raise exception 'POSTHARVEST_SPECIFIC_OFFLINE_GUARD_MATRIX_MISMATCH';
  end if;

  select pg_get_functiondef(
    'public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)'::regprocedure
  ) into v_function_definition;

  if position('operations.parameters.view' in v_function_definition) = 0
     or position('operations.label_types.manage' in v_function_definition) = 0
     or position('perform public.erp_security_assert_capability(p_company_id, v_specific_capability)' in v_function_definition) = 0 then
    raise exception 'POSTHARVEST_VIEW_AND_SPECIFIC_GUARD_MISSING';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
