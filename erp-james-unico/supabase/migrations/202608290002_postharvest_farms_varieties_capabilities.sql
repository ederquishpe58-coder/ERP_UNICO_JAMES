begin;

do $$
begin
  if to_regclass('public.erp_security_capabilities') is null
     or to_regclass('public.erp_security_profile_capabilities') is null
     or to_regclass('public.erp_u2c3_offline_action_capabilities') is null
     or to_regprocedure('public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)') is null then
    raise exception 'POSTHARVEST_PARAMETER_CAPABILITY_FOUNDATION_MISSING';
  end if;
end;
$$;

insert into public.erp_security_capabilities(
  capability_id, module, resource, action, risk_level, description, active
)
values
  (
    'operations.farms_blocks.manage', 'operations', 'farms_blocks', 'manage', 'MEDIUM',
    'Administra exclusivamente el catálogo canónico de fincas y bloques de Poscosecha.', true
  ),
  (
    'operations.varieties.manage', 'operations', 'varieties', 'manage', 'MEDIUM',
    'Administra exclusivamente el catálogo canónico de variedades de Poscosecha.', true
  )
on conflict (capability_id) do update
set module = excluded.module,
    resource = excluded.resource,
    action = excluded.action,
    risk_level = excluded.risk_level,
    description = excluded.description,
    active = excluded.active,
    updated_at = clock_timestamp();

insert into public.erp_security_profile_capabilities(profile_id, capability_id)
values
  ('GERENCIA_GENERAL', 'operations.farms_blocks.manage'),
  ('GERENCIA_GENERAL', 'operations.varieties.manage')
on conflict (profile_id, capability_id) do nothing;

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
      select capability_id into v_capability from public.erp_u2c3_offline_action_capabilities where entity=v_entity and action=v_action;
      v_specific_capability := case v_entity
        when 'operations_suppliers' then 'operations.farms_blocks.manage'
        when 'operations_varieties' then 'operations.varieties.manage'
        else null
      end;
    end if;
  end if;

  if v_capability is null then
    raise exception using errcode='42501',message='U2C3_MUTATION_ACTION_UNMAPPED';
  end if;

  if v_specific_capability is not null
     and public.erp_security_has_capability(p_company_id, 'operations.parameters.view')
     and public.erp_security_has_capability(p_company_id, v_specific_capability) then
    return;
  end if;

  perform public.erp_security_assert_capability(p_company_id,v_capability);
end;
$$;

revoke all on function public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)
  from public, anon, authenticated, service_role;

do $$
begin
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL') <> 175 then
    raise exception 'GERENCIA_GENERAL_POSTHARVEST_GRANT_COUNT_MISMATCH';
  end if;
  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where profile_id='GERENCIA_GENERAL'
      and capability_id='operations.parameters.manage'
  ) then
    raise exception 'GERENCIA_GENERAL_BROAD_PARAMETER_MANAGE_NOT_ALLOWED';
  end if;
  if (select count(*) from public.erp_u2c3_offline_action_capabilities) <> 132 then
    raise exception 'U2C3_OFFLINE_PRIMARY_MAP_REGRESSION';
  end if;
  if position('operations.farms_blocks.manage' in pg_get_functiondef(
       'public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)'::regprocedure
     )) = 0
     or position('operations.varieties.manage' in pg_get_functiondef(
       'public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)'::regprocedure
     )) = 0 then
    raise exception 'POSTHARVEST_SPECIFIC_MUTATION_GUARDS_MISSING';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
