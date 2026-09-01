begin;

-- Admin Users canonical access finalizer. Supabase Auth remains outside this
-- transaction; the API compensates a newly-created Auth identity on failure.
create or replace function public.erp_admin_configure_user_access(
  p_target_user_id uuid,
  p_display_name text,
  p_username text,
  p_area text,
  p_job_title text,
  p_notes text,
  p_company_access jsonb,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_access jsonb;
  v_company_id uuid;
  v_profile_id text;
  v_role text;
  v_status text;
  v_is_default boolean;
  v_actor_role text;
  v_current_role text;
  v_current_status text;
  v_default_company_id uuid;
  v_active_memberships integer;
  v_result jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATED_ACTOR_REQUIRED';
  end if;
  if p_target_user_id is null or not exists (
    select 1 from auth.users auth_user where auth_user.id = p_target_user_id
  ) then
    raise exception using errcode = '23503', message = 'AUTH_USER_REQUIRED';
  end if;
  if p_target_user_id = v_actor then
    raise exception using errcode = '42501', message = 'SECURITY_SELF_ELEVATION_DENIED';
  end if;
  if btrim(coalesce(p_display_name, '')) = '' then
    raise exception using errcode = '22023', message = 'DISPLAY_NAME_REQUIRED';
  end if;
  if p_username is not null and btrim(p_username) <> ''
     and btrim(p_username) !~ '^[A-Za-z0-9._-]{3,64}$' then
    raise exception using errcode = '22023', message = 'USERNAME_INVALID';
  end if;
  if p_company_access is null
     or jsonb_typeof(p_company_access) <> 'array'
     or jsonb_array_length(p_company_access) = 0 then
    raise exception using errcode = '22023', message = 'COMPANY_ACCESS_REQUIRED';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'OPERATION_ID_REQUIRED';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_company_access) item
    where jsonb_typeof(item.value) <> 'object'
       or item.value ? 'permissions'
       or item.value ? 'capabilities'
       or item.value ? 'route_permissions'
       or item.value ? 'user_route_permissions'
  ) then
    raise exception using errcode = '22023', message = 'INDIVIDUAL_PERMISSIONS_NOT_ACCEPTED';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_company_access)
  ) <> (
    select count(distinct item.value ->> 'company_id') from jsonb_array_elements(p_company_access) item
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_COMPANY_ACCESS';
  end if;

  -- Validate the complete request before the first ERP write.
  for v_access in select value from jsonb_array_elements(p_company_access)
  loop
    begin
      v_company_id := (v_access ->> 'company_id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'COMPANY_ID_INVALID';
    end;
    v_profile_id := upper(btrim(coalesce(v_access ->> 'profile_id', '')));
    v_role := upper(btrim(coalesce(v_access ->> 'membership_role', '')));
    v_status := upper(btrim(coalesce(v_access ->> 'membership_status', 'ACTIVE')));

    if not exists (
      select 1 from public.companies company
      where company.id = v_company_id and company.is_active
    ) then
      raise exception using errcode = '23503', message = 'COMPANY_NOT_ACTIVE';
    end if;
    perform public.erp_security_u2c4_assert_admin(v_company_id, 'admin.users.manage');
    select membership.membership_role into v_actor_role
    from public.user_company_memberships membership
    where membership.company_id = v_company_id
      and membership.user_id = v_actor
      and membership.membership_status = 'ACTIVE';

    if v_role not in ('OWNER','ADMIN','EDITOR','VIEWER') then
      raise exception using errcode = '22023', message = 'MEMBERSHIP_ROLE_INVALID';
    end if;
    if v_status not in ('ACTIVE','SUSPENDED') then
      raise exception using errcode = '22023', message = 'MEMBERSHIP_STATUS_INVALID';
    end if;
    if v_role = 'OWNER' and v_actor_role <> 'OWNER' then
      raise exception using errcode = '42501', message = 'OWNER_ROLE_ASSIGNMENT_REQUIRES_OWNER';
    end if;
    if v_profile_id = '' or not exists (
      select 1 from public.erp_security_profiles security_profile
      where security_profile.profile_id = v_profile_id and security_profile.active
    ) then
      raise exception using errcode = '23514', message = 'ACTIVE_CANONICAL_PROFILE_REQUIRED';
    end if;

    select membership.membership_role, membership.membership_status
      into v_current_role, v_current_status
    from public.user_company_memberships membership
    where membership.company_id = v_company_id
      and membership.user_id = p_target_user_id;
    if v_current_role = 'OWNER' and (v_role <> 'OWNER' or v_status <> 'ACTIVE') then
      if v_actor_role <> 'OWNER' then
        raise exception using errcode = '42501', message = 'OWNER_ROLE_CHANGE_REQUIRES_OWNER';
      end if;
      if (
        select count(*)
        from public.user_company_memberships owner_membership
        where owner_membership.company_id = v_company_id
          and owner_membership.user_id <> p_target_user_id
          and owner_membership.membership_role = 'OWNER'
          and owner_membership.membership_status = 'ACTIVE'
      ) = 0 then
        raise exception using errcode = '23514', message = 'LAST_ACTIVE_OWNER_REQUIRED';
      end if;
    end if;
  end loop;

  select (item.value ->> 'company_id')::uuid into v_default_company_id
  from jsonb_array_elements(p_company_access) item
  where coalesce((item.value ->> 'is_default')::boolean, false)
    and upper(coalesce(item.value ->> 'membership_status', 'ACTIVE')) = 'ACTIVE'
  limit 1;
  if v_default_company_id is null then
    select (item.value ->> 'company_id')::uuid into v_default_company_id
    from jsonb_array_elements(p_company_access) item
    where upper(coalesce(item.value ->> 'membership_status', 'ACTIVE')) = 'ACTIVE'
    limit 1;
  end if;

  insert into public.user_profiles(
    user_id, display_name, username, default_company_id, is_active
  ) values (
    p_target_user_id,
    btrim(p_display_name),
    nullif(btrim(coalesce(p_username, '')), ''),
    v_default_company_id,
    true
  )
  on conflict(user_id) do update set
    display_name = excluded.display_name,
    username = excluded.username,
    updated_at = clock_timestamp()
  where (public.user_profiles.display_name, public.user_profiles.username)
    is distinct from (excluded.display_name, excluded.username);

  if v_default_company_id is not null then
    update public.user_company_memberships
    set is_default = false, updated_by = v_actor, updated_at = clock_timestamp()
    where user_id = p_target_user_id
      and is_default
      and company_id <> v_default_company_id;
  end if;

  for v_access in select value from jsonb_array_elements(p_company_access)
  loop
    v_company_id := (v_access ->> 'company_id')::uuid;
    v_profile_id := upper(btrim(v_access ->> 'profile_id'));
    v_role := upper(btrim(v_access ->> 'membership_role'));
    v_status := upper(btrim(coalesce(v_access ->> 'membership_status', 'ACTIVE')));
    v_is_default := v_status = 'ACTIVE' and v_company_id = v_default_company_id;

    insert into public.user_company_memberships(
      company_id, user_id, membership_role, membership_status, is_default,
      display_name_override, area, job_title, notes, created_by, updated_by
    ) values (
      v_company_id, p_target_user_id, v_role, v_status, v_is_default,
      btrim(p_display_name), nullif(btrim(coalesce(p_area, '')), ''),
      nullif(btrim(coalesce(p_job_title, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
      v_actor, v_actor
    )
    on conflict(company_id, user_id) do update set
      membership_role = excluded.membership_role,
      membership_status = excluded.membership_status,
      is_default = excluded.is_default,
      display_name_override = excluded.display_name_override,
      area = excluded.area,
      job_title = excluded.job_title,
      notes = excluded.notes,
      updated_by = v_actor,
      updated_at = clock_timestamp()
    where (
      public.user_company_memberships.membership_role,
      public.user_company_memberships.membership_status,
      public.user_company_memberships.is_default,
      public.user_company_memberships.display_name_override,
      public.user_company_memberships.area,
      public.user_company_memberships.job_title,
      public.user_company_memberships.notes
    ) is distinct from (
      excluded.membership_role, excluded.membership_status, excluded.is_default,
      excluded.display_name_override, excluded.area, excluded.job_title, excluded.notes
    );

    insert into public.erp_security_user_company_profiles(
      company_id, user_id, profile_id, assigned_by
    ) values (
      v_company_id, p_target_user_id, v_profile_id, v_actor
    )
    on conflict(company_id, user_id) do update set
      profile_id = excluded.profile_id,
      assigned_by = v_actor
    where public.erp_security_user_company_profiles.profile_id is distinct from excluded.profile_id;

    insert into public.erp_access_audit_log(
      company_id, user_id, route_id, requested_action, allowed, reason_code, request_id, details
    ) values (
      v_company_id, v_actor, 'settings-users', 'edit', true,
      'CANONICAL_USER_ACCESS_CONFIGURED', p_operation_id::text,
      jsonb_build_object(
        'target_user_id', p_target_user_id,
        'profile_id', v_profile_id,
        'membership_role', v_role,
        'membership_status', v_status,
        'legacy_route_permissions_written', 0
      )
    );

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'company_id', v_company_id,
      'membership_role', v_role,
      'membership_status', v_status,
      'canonical_profile_id', v_profile_id,
      'capability_count', (
        select count(*) from public.erp_security_profile_capabilities grant_row
        join public.erp_security_capabilities capability
          on capability.capability_id = grant_row.capability_id and capability.active
        where grant_row.profile_id = v_profile_id
      )
    ));
  end loop;

  select count(*) into v_active_memberships
  from public.user_company_memberships membership
  join public.companies company on company.id = membership.company_id and company.is_active
  where membership.user_id = p_target_user_id
    and membership.membership_status = 'ACTIVE'
    and (membership.valid_from is null or membership.valid_from <= current_date)
    and (membership.valid_until is null or membership.valid_until >= current_date);

  update public.user_profiles
  set is_active = v_active_memberships > 0,
      default_company_id = case
        when v_active_memberships = 0 then null
        when exists (
          select 1 from public.user_company_memberships membership
          where membership.user_id = p_target_user_id
            and membership.company_id = v_default_company_id
            and membership.membership_status = 'ACTIVE'
        ) then v_default_company_id
        else (
          select membership.company_id
          from public.user_company_memberships membership
          where membership.user_id = p_target_user_id
            and membership.membership_status = 'ACTIVE'
          order by membership.is_default desc, membership.created_at
          limit 1
        )
      end,
      updated_at = clock_timestamp()
  where user_id = p_target_user_id
    and (is_active, default_company_id) is distinct from (
      v_active_memberships > 0,
      case
        when v_active_memberships = 0 then null
        when exists (
          select 1 from public.user_company_memberships membership
          where membership.user_id = p_target_user_id
            and membership.company_id = v_default_company_id
            and membership.membership_status = 'ACTIVE'
        ) then v_default_company_id
        else (
          select membership.company_id
          from public.user_company_memberships membership
          where membership.user_id = p_target_user_id
            and membership.membership_status = 'ACTIVE'
          order by membership.is_default desc, membership.created_at
          limit 1
        )
      end
    );

  return jsonb_build_object(
    'target_user_id', p_target_user_id,
    'active', v_active_memberships > 0,
    'companies', v_result,
    'legacy_route_permissions_written', 0,
    'operation_id', p_operation_id
  );
end;
$$;

create or replace function public.erp_admin_revoke_user_company_access(
  p_target_user_id uuid,
  p_company_ids jsonb,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_company_value jsonb;
  v_company_id uuid;
  v_target_role text;
  v_active_memberships integer;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATED_ACTOR_REQUIRED';
  end if;
  if p_target_user_id is null or p_target_user_id = v_actor then
    raise exception using errcode = '42501', message = 'SECURITY_SELF_ELEVATION_DENIED';
  end if;
  if p_company_ids is null or jsonb_typeof(p_company_ids) <> 'array'
     or jsonb_array_length(p_company_ids) = 0 then
    raise exception using errcode = '22023', message = 'COMPANY_ACCESS_REQUIRED';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'OPERATION_ID_REQUIRED';
  end if;
  if (select count(*) from jsonb_array_elements(p_company_ids)) <>
     (select count(distinct value #>> '{}') from jsonb_array_elements(p_company_ids)) then
    raise exception using errcode = '22023', message = 'DUPLICATE_COMPANY_ACCESS';
  end if;

  -- Validate every company before changing any membership.
  for v_company_value in select value from jsonb_array_elements(p_company_ids)
  loop
    begin
      v_company_id := trim(both '"' from v_company_value::text)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'COMPANY_ID_INVALID';
    end;
    perform public.erp_security_u2c4_assert_admin(v_company_id, 'admin.users.manage');
    v_target_role := null;
    select membership.membership_role into v_target_role
    from public.user_company_memberships membership
    where membership.company_id = v_company_id and membership.user_id = p_target_user_id;
    if v_target_role is null then
      raise exception using errcode = '23503', message = 'TARGET_MEMBERSHIP_REQUIRED';
    end if;
    if v_target_role = 'OWNER' then
      raise exception using errcode = '42501', message = 'OWNER_TRANSFER_REQUIRED';
    end if;
  end loop;

  for v_company_value in select value from jsonb_array_elements(p_company_ids)
  loop
    v_company_id := trim(both '"' from v_company_value::text)::uuid;
    update public.user_company_memberships
    set membership_status = 'REVOKED', is_default = false,
        updated_by = v_actor, updated_at = clock_timestamp()
    where company_id = v_company_id and user_id = p_target_user_id;
    delete from public.erp_security_user_company_profiles
    where company_id = v_company_id and user_id = p_target_user_id;
    insert into public.erp_access_audit_log(
      company_id, user_id, route_id, requested_action, allowed, reason_code, request_id, details
    ) values (
      v_company_id, v_actor, 'settings-users', 'delete', true,
      'CANONICAL_COMPANY_ACCESS_REVOKED', p_operation_id::text,
      jsonb_build_object('target_user_id', p_target_user_id, 'legacy_route_permissions_written', 0)
    );
  end loop;

  select count(*) into v_active_memberships
  from public.user_company_memberships membership
  join public.companies company on company.id = membership.company_id and company.is_active
  where membership.user_id = p_target_user_id
    and membership.membership_status = 'ACTIVE'
    and (membership.valid_from is null or membership.valid_from <= current_date)
    and (membership.valid_until is null or membership.valid_until >= current_date);

  update public.user_profiles
  set is_active = v_active_memberships > 0,
      default_company_id = case when v_active_memberships = 0 then null else (
        select membership.company_id
        from public.user_company_memberships membership
        where membership.user_id = p_target_user_id
          and membership.membership_status = 'ACTIVE'
        order by membership.is_default desc, membership.created_at
        limit 1
      ) end,
      updated_at = clock_timestamp()
  where user_id = p_target_user_id;

  return jsonb_build_object(
    'target_user_id', p_target_user_id,
    'revoked', true,
    'active', v_active_memberships > 0,
    'legacy_route_permissions_written', 0,
    'operation_id', p_operation_id
  );
end;
$$;

revoke all on function public.erp_admin_configure_user_access(uuid,text,text,text,text,text,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.erp_admin_configure_user_access(uuid,text,text,text,text,text,jsonb,uuid)
  to authenticated;
revoke all on function public.erp_admin_revoke_user_company_access(uuid,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.erp_admin_revoke_user_company_access(uuid,jsonb,uuid)
  to authenticated;

comment on function public.erp_admin_configure_user_access(uuid,text,text,text,text,text,jsonb,uuid) is
  'Transactional Admin Users finalizer: profile, memberships, meta-role and canonical company profile. Never writes legacy route permissions.';
comment on function public.erp_admin_revoke_user_company_access(uuid,jsonb,uuid) is
  'Transactional company-access revocation. Preserves Auth and other active companies; removes the revoked canonical profile assignment.';

commit;
