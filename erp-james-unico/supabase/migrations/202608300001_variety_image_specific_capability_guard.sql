begin;

-- Preserve the existing company, variety, version and path validation. Only
-- replace the broad parameter capability at the public RPC boundary.
do $$
begin
  if to_regprocedure(
       'public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz)'
     ) is null
     or to_regprocedure(
       'public.erp_set_variety_image_u2c3_internal(uuid,text,text,uuid,text,bigint,timestamptz)'
     ) is null
     or to_regprocedure(
       'public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb)'
     ) is null
     or to_regclass('public.erp_u2c3_mutation_rpc_capabilities') is null then
    raise exception 'VARIETY_IMAGE_CAPABILITY_FOUNDATION_MISSING';
  end if;

  if not exists (
       select 1
       from public.erp_security_capabilities
       where capability_id = 'operations.parameters.view'
         and active
     )
     or not exists (
       select 1
       from public.erp_security_capabilities
       where capability_id = 'operations.varieties.manage'
         and active
     ) then
    raise exception 'VARIETY_IMAGE_REQUIRED_CAPABILITIES_MISSING';
  end if;
end;
$$;

update public.erp_u2c3_mutation_rpc_capabilities
set capability_id = 'operations.varieties.manage'
where rpc_name = 'erp_set_variety_image'
  and resolution_strategy = 'FIXED';

do $$
begin
  if not exists (
    select 1
    from public.erp_u2c3_mutation_rpc_capabilities
    where rpc_name = 'erp_set_variety_image'
      and resolution_strategy = 'FIXED'
      and capability_id = 'operations.varieties.manage'
  ) then
    raise exception 'VARIETY_IMAGE_SPECIFIC_MUTATION_MAP_MISSING';
  end if;
end;
$$;

create or replace function public.erp_set_variety_image(
  p_company_id uuid,
  p_variety_id text,
  p_image_path text,
  p_operation_id uuid,
  p_device_id text,
  p_expected_version bigint,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(
    p_company_id,
    'operations.parameters.view'
  );

  perform public.erp_u2c3_assert_mutation_capability(
    'erp_set_variety_image',
    p_company_id,
    '{}'::jsonb
  );

  return public.erp_set_variety_image_u2c3_internal(
    p_company_id,
    p_variety_id,
    p_image_path,
    p_operation_id,
    p_device_id,
    p_expected_version,
    p_local_created_at
  );
end;
$$;

revoke all on function public.erp_set_variety_image(
  uuid,text,text,uuid,text,bigint,timestamptz
) from public, anon, service_role;
grant execute on function public.erp_set_variety_image(
  uuid,text,text,uuid,text,bigint,timestamptz
) to authenticated;

comment on function public.erp_set_variety_image(
  uuid,text,text,uuid,text,bigint,timestamptz
) is
  'Variety image mutation entrypoint. Requires operations.parameters.view AND operations.varieties.manage; the private implementation preserves company, variety, version and image-path validation.';

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz)'::regprocedure
  ) into v_definition;

  if position('operations.parameters.view' in v_definition) = 0
     or position('erp_u2c3_assert_mutation_capability' in v_definition) = 0 then
    raise exception 'VARIETY_IMAGE_COMPOSITE_GUARD_MISSING';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'erp_set_variety_image'
      and procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[])
        @> array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'VARIETY_IMAGE_SECURITY_DEFINER_OR_SEARCH_PATH_REGRESSION';
  end if;

  if has_function_privilege(
       'anon',
       'public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz)',
       'EXECUTE'
     ) then
    raise exception 'VARIETY_IMAGE_EXECUTE_GRANT_REGRESSION';
  end if;

  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where profile_id = 'GERENCIA_GENERAL'
      and capability_id = 'operations.parameters.manage'
  ) then
    raise exception 'GERENCIA_GENERAL_BROAD_PARAMETER_MANAGE_NOT_ALLOWED';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
