begin;

do $$
declare
  v_company_id uuid;
  v_other_company_id uuid := gen_random_uuid();
  v_user_id uuid;
  v_variety_id text;
  v_other_variety_id text := 'VALIDATOR-CROSS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_version bigint;
  v_result jsonb;
  v_path_one text;
  v_path_two text;
  v_denied boolean;
  v_cross_denied boolean;
  v_profile_both text := 'VAL_IMG_BOTH';
  v_profile_view text := 'VAL_IMG_VIEW';
  v_profile_manage text := 'VAL_IMG_MANAGE';
  v_profile_none text := 'VAL_IMG_NONE';
begin
  if (
    select count(*)
    from public.erp_u2c3_mutation_rpc_capabilities
    where rpc_name = 'erp_set_variety_image'
      and resolution_strategy = 'FIXED'
      and capability_id = 'operations.varieties.manage'
  ) <> 1 then
    raise exception 'VARIETY_IMAGE_MUTATION_MAP_MISMATCH';
  end if;

  if position('operations.parameters.view' in pg_get_functiondef(
       'public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz)'::regprocedure
     )) = 0 then
    raise exception 'VARIETY_IMAGE_VIEW_GUARD_MISSING';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'variety-images'
      and public
  ) then
    raise exception 'VARIETY_IMAGE_BUCKET_MISSING';
  end if;

  if to_regprocedure('public.erp_variety_image_storage_allowed(text)') is null
     or not exists (
       select 1
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname = 'erp_set_variety_image'
         and procedure.prosecdef
         and coalesce(procedure.proconfig, '{}'::text[])
           @> array['search_path=public, pg_temp']::text[]
     ) then
    raise exception 'VARIETY_IMAGE_SECURITY_CONTRACT_REGRESSION';
  end if;

  select membership.company_id,
         membership.user_id,
         variety.record_id,
         variety.version
    into v_company_id, v_user_id, v_variety_id, v_version
  from public.user_company_memberships membership
  join public.companies company
    on company.id = membership.company_id
   and company.is_active
  join public.user_profiles user_profile
    on user_profile.user_id = membership.user_id
   and user_profile.is_active
  join public.erp_entity_records variety
    on variety.company_id = membership.company_id
   and variety.entity = 'operations_varieties'
   and variety.deleted_at is null
  where membership.membership_status = 'ACTIVE'
    and not exists (
      select 1
      from public.erp_security_user_capability_overrides override_row
      where override_row.company_id = membership.company_id
        and override_row.user_id = membership.user_id
    )
  order by membership.company_id, membership.user_id, variety.record_id
  limit 1;

  if v_user_id is null then
    raise exception 'VARIETY_IMAGE_CONTROLLED_ACTOR_OR_VARIETY_MISSING';
  end if;

  if exists (
    select 1
    from public.erp_security_profiles
    where profile_id in (v_profile_both, v_profile_view, v_profile_manage, v_profile_none)
  ) then
    raise exception 'VARIETY_IMAGE_VALIDATOR_PROFILE_COLLISION';
  end if;

  insert into public.erp_security_profiles(
    profile_id, display_name, description, active, system_defined
  ) values
    (v_profile_both, 'Validator image both', 'Fixture transaccional VIEW y MANAGE.', true, false),
    (v_profile_view, 'Validator image view', 'Fixture transaccional solo VIEW.', true, false),
    (v_profile_manage, 'Validator image manage', 'Fixture transaccional solo MANAGE.', true, false),
    (v_profile_none, 'Validator image none', 'Fixture transaccional sin permisos.', true, false);

  insert into public.erp_security_profile_capabilities(profile_id, capability_id)
  values
    (v_profile_both, 'operations.parameters.view'),
    (v_profile_both, 'operations.varieties.manage'),
    (v_profile_view, 'operations.parameters.view'),
    (v_profile_manage, 'operations.varieties.manage');

  update public.user_company_memberships
  set membership_role = 'OWNER',
      membership_status = 'ACTIVE',
      is_default = true
  where company_id = v_company_id
    and user_id = v_user_id;

  insert into public.erp_security_user_company_profiles(company_id, user_id, profile_id)
  values(v_company_id, v_user_id, v_profile_both)
  on conflict(company_id, user_id) do update
  set profile_id = excluded.profile_id,
      updated_at = clock_timestamp();

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_path_one := v_company_id::text || '/' || v_variety_id || '/main-' || gen_random_uuid()::text || '.webp';
  v_path_two := v_company_id::text || '/' || v_variety_id || '/main-' || gen_random_uuid()::text || '.webp';

  -- A: VIEW + MANAGE. Exercise upload, replace and remove using the real RPC.
  select public.erp_set_variety_image(
    v_company_id, v_variety_id, v_path_one, gen_random_uuid(),
    'validator-variety-image', v_version, clock_timestamp()
  ) into v_result;
  if v_result #>> '{payload,imagePath}' <> v_path_one then
    raise exception 'VARIETY_IMAGE_UPLOAD_PATH_NOT_PERSISTED';
  end if;
  v_version := (v_result->>'version')::bigint;

  select public.erp_set_variety_image(
    v_company_id, v_variety_id, v_path_two, gen_random_uuid(),
    'validator-variety-image', v_version, clock_timestamp()
  ) into v_result;
  if v_result #>> '{payload,imagePath}' <> v_path_two then
    raise exception 'VARIETY_IMAGE_REPLACE_PATH_NOT_PERSISTED';
  end if;
  v_version := (v_result->>'version')::bigint;

  select public.erp_set_variety_image(
    v_company_id, v_variety_id, null, gen_random_uuid(),
    'validator-variety-image', v_version, clock_timestamp()
  ) into v_result;
  if (v_result->'payload') ? 'imagePath' then
    raise exception 'VARIETY_IMAGE_REMOVE_PATH_NOT_CLEARED';
  end if;
  v_version := (v_result->>'version')::bigint;

  -- B: VIEW only.
  update public.erp_security_user_company_profiles
  set profile_id = v_profile_view, updated_at = clock_timestamp()
  where company_id = v_company_id and user_id = v_user_id;
  v_denied := false;
  begin
    perform public.erp_set_variety_image(
      v_company_id, v_variety_id, v_path_one, gen_random_uuid(),
      'validator-variety-image', v_version, clock_timestamp()
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'VARIETY_IMAGE_VIEW_ONLY_ALLOWED'; end if;

  -- C: MANAGE only.
  update public.erp_security_user_company_profiles
  set profile_id = v_profile_manage, updated_at = clock_timestamp()
  where company_id = v_company_id and user_id = v_user_id;
  v_denied := false;
  begin
    perform public.erp_set_variety_image(
      v_company_id, v_variety_id, v_path_one, gen_random_uuid(),
      'validator-variety-image', v_version, clock_timestamp()
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'VARIETY_IMAGE_MANAGE_ONLY_ALLOWED'; end if;

  -- D: no permissions. OWNER must not bypass the capability engine.
  update public.erp_security_user_company_profiles
  set profile_id = v_profile_none, updated_at = clock_timestamp()
  where company_id = v_company_id and user_id = v_user_id;
  v_denied := false;
  begin
    perform public.erp_set_variety_image(
      v_company_id, v_variety_id, v_path_one, gen_random_uuid(),
      'validator-variety-image', v_version, clock_timestamp()
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'VARIETY_IMAGE_OWNER_BYPASS'; end if;

  -- E: GERENCIA_GENERAL has the two explicit capabilities, not broad manage.
  update public.erp_security_user_company_profiles
  set profile_id = 'GERENCIA_GENERAL', updated_at = clock_timestamp()
  where company_id = v_company_id and user_id = v_user_id;
  select public.erp_set_variety_image(
    v_company_id, v_variety_id, v_path_one, gen_random_uuid(),
    'validator-variety-image', v_version, clock_timestamp()
  ) into v_result;
  if v_result #>> '{payload,imagePath}' <> v_path_one then
    raise exception 'VARIETY_IMAGE_GERENCIA_GENERAL_NOT_ALLOWED';
  end if;
  v_version := (v_result->>'version')::bigint;

  -- F/G: another company and a manipulated cross-company variety id.
  insert into public.companies(
    id, company_key, company_code, legal_name, commercial_name,
    tax_id, sri_environment, is_active, metadata
  ) values (
    v_other_company_id,
    'COMP-VALIDATOR-' || upper(substr(replace(v_other_company_id::text, '-', ''), 1, 12)),
    'VAL' || upper(substr(replace(v_other_company_id::text, '-', ''), 1, 8)),
    'Validator Variety Image Company',
    'Validator Variety Image',
    '9' || lpad((floor(random() * 1000000000000))::bigint::text, 12, '0'),
    'TEST', true, '{}'::jsonb
  );
  insert into public.erp_entity_records(company_id, entity, record_id, payload)
  values(
    v_other_company_id,
    'operations_varieties',
    v_other_variety_id,
    jsonb_build_object('id', v_other_variety_id, 'code', v_other_variety_id, 'name', 'Cross company validator', 'active', true)
  );

  v_cross_denied := false;
  begin
    perform public.erp_set_variety_image(
      v_other_company_id, v_other_variety_id, null, gen_random_uuid(),
      'validator-variety-image', 1, clock_timestamp()
    );
  exception when sqlstate '42501' then
    v_cross_denied := true;
  end;
  if not v_cross_denied then raise exception 'VARIETY_IMAGE_OTHER_COMPANY_ALLOWED'; end if;

  v_cross_denied := false;
  begin
    perform public.erp_set_variety_image(
      v_company_id, v_other_variety_id, null, gen_random_uuid(),
      'validator-variety-image', 1, clock_timestamp()
    );
  exception when sqlstate 'P0002' then
    v_cross_denied := true;
  end;
  if not v_cross_denied then raise exception 'VARIETY_IMAGE_CROSS_COMPANY_ID_ALLOWED'; end if;

  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where profile_id = 'GERENCIA_GENERAL'
      and capability_id = 'operations.parameters.manage'
  ) then
    raise exception 'GERENCIA_GENERAL_BROAD_PARAMETER_MANAGE_GRANTED';
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
end;
$$;

select jsonb_build_object(
  'rpc', 'public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz)',
  'view_manage', 'PASS',
  'view_only', 'DENIED',
  'manage_only', 'DENIED',
  'no_permissions', 'DENIED',
  'gerencia_general', 'ALLOWED',
  'cross_company', 'DENIED',
  'upload', 'PASS',
  'replace', 'PASS',
  'remove', 'PASS',
  'image_path_persistence', 'PASS',
  'base_denied_granted', 0,
  'fixture', 'ROLLBACK'
) as result;

rollback;
