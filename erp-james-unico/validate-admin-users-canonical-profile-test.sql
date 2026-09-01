\set ON_ERROR_STOP on

begin;

do $$
declare
  v_company_id uuid;
  v_other_company_id uuid;
  v_owner_id uuid;
  v_admin_id uuid := gen_random_uuid();
  v_target_id uuid := gen_random_uuid();
  v_second_target_id uuid := gen_random_uuid();
  v_profile_a text;
  v_profile_b text;
  v_instance_id uuid;
  v_password_before text;
  v_legacy_before bigint;
  v_effective bigint;
  v_result jsonb;
  v_failed boolean;
begin
  select company.id into strict v_company_id
  from public.companies company
  where company.company_key = 'COMP-BLESS-FLOWER' and company.is_active;

  select auth_user.id, auth_user.instance_id
    into strict v_owner_id, v_instance_id
  from auth.users auth_user
  join public.user_company_memberships membership
    on membership.user_id = auth_user.id
   and membership.company_id = v_company_id
   and membership.membership_status = 'ACTIVE'
   and membership.membership_role = 'OWNER'
  join public.erp_security_user_company_profiles assignment
    on assignment.company_id = membership.company_id
   and assignment.user_id = membership.user_id
   and assignment.profile_id = 'GERENCIA_GENERAL'
  where lower(btrim(auth_user.email)) = 'jameslanchimba14@gmail.com';

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  if not public.erp_security_has_capability(v_company_id, 'admin.users.view')
     or not public.erp_security_has_capability(v_company_id, 'admin.users.manage') then
    raise exception 'GERENCIA_ADMIN_USERS_CAPABILITIES_REQUIRED';
  end if;

  select profile.profile_id into v_profile_a
  from public.erp_security_profiles profile
  where profile.active and profile.profile_id not in ('GERENCIA_GENERAL','ADMINISTRADOR_ERP')
  order by profile.profile_id
  limit 1;
  select profile.profile_id into v_profile_b
  from public.erp_security_profiles profile
  where profile.active
    and profile.profile_id not in ('GERENCIA_GENERAL','ADMINISTRADOR_ERP',v_profile_a)
  order by profile.profile_id
  limit 1;
  if v_profile_a is null or v_profile_b is null then
    raise exception 'TWO_ACTIVE_CANONICAL_PROFILES_REQUIRED';
  end if;

  select company.id into v_other_company_id
  from public.companies company
  where company.id <> v_company_id and company.is_active
  order by company.id
  limit 1;
  if v_other_company_id is null then
    raise exception 'SECOND_ACTIVE_TEST_COMPANY_REQUIRED';
  end if;

  insert into auth.users(
    instance_id,id,aud,role,email,email_confirmed_at,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values
    (v_instance_id,v_admin_id,'authenticated','authenticated',
      'temp-admin-users-admin-'||replace(v_admin_id::text,'-','')||'@fixture.invalid',clock_timestamp(),null,
      '{"provider":"email","providers":["email"]}'::jsonb,'{"fixture":"ADMIN_USERS_CANONICAL"}'::jsonb,clock_timestamp(),clock_timestamp()),
    (v_instance_id,v_target_id,'authenticated','authenticated',
      'temp-admin-users-target-'||replace(v_target_id::text,'-','')||'@fixture.invalid',clock_timestamp(),null,
      '{"provider":"email","providers":["email"]}'::jsonb,'{"fixture":"ADMIN_USERS_CANONICAL"}'::jsonb,clock_timestamp(),clock_timestamp()),
    (v_instance_id,v_second_target_id,'authenticated','authenticated',
      'temp-admin-users-target2-'||replace(v_second_target_id::text,'-','')||'@fixture.invalid',clock_timestamp(),null,
      '{"provider":"email","providers":["email"]}'::jsonb,'{"fixture":"ADMIN_USERS_CANONICAL"}'::jsonb,clock_timestamp(),clock_timestamp());

  insert into public.user_profiles(user_id,display_name,username,default_company_id,is_active)
  values(v_admin_id,'TEMP ADMIN USERS ADMIN','temp_admin_users_admin',v_company_id,true);
  insert into public.user_company_memberships(
    company_id,user_id,membership_role,membership_status,is_default,display_name_override,created_by,updated_by
  ) values
    (v_company_id,v_admin_id,'ADMIN','ACTIVE',true,'TEMP ADMIN USERS ADMIN',v_owner_id,v_owner_id),
    (v_other_company_id,v_admin_id,'ADMIN','ACTIVE',false,'TEMP ADMIN USERS ADMIN',v_owner_id,v_owner_id);
  insert into public.erp_security_user_company_profiles(company_id,user_id,profile_id,assigned_by)
  values
    (v_company_id,v_admin_id,'GERENCIA_GENERAL',v_owner_id),
    (v_other_company_id,v_admin_id,'GERENCIA_GENERAL',v_owner_id);

  select encrypted_password into v_password_before from auth.users where id = v_target_id;
  select count(*) into v_legacy_before from public.user_route_permissions where user_id = v_target_id;

  -- CREATE ERP finalization: profile + membership + role + canonical assignment.
  select public.erp_admin_configure_user_access(
    v_target_id,'TEMP ADMIN USERS TARGET','temp_admin_users_target','TEST','Fixture','rollback only',
    jsonb_build_array(jsonb_build_object(
      'company_id',v_company_id,'profile_id',v_profile_a,'membership_role','VIEWER',
      'membership_status','ACTIVE','is_default',true
    )),gen_random_uuid()
  ) into v_result;
  if v_result ->> 'target_user_id' <> v_target_id::text
     or v_result ->> 'legacy_route_permissions_written' <> '0' then
    raise exception 'CREATE_RESULT_CONTRACT_MISMATCH';
  end if;
  if (select count(*) from public.user_profiles where user_id=v_target_id and is_active) <> 1
     or (select count(*) from public.user_company_memberships where company_id=v_company_id and user_id=v_target_id and membership_role='VIEWER' and membership_status='ACTIVE') <> 1
     or (select count(*) from public.erp_security_user_company_profiles where company_id=v_company_id and user_id=v_target_id and profile_id=v_profile_a) <> 1 then
    raise exception 'CREATE_CANONICAL_GRAPH_MISMATCH';
  end if;
  if (select count(*) from public.user_route_permissions where user_id=v_target_id) <> v_legacy_before then
    raise exception 'NEW_LEGACY_ROUTE_PERMISSION_WRITE_DETECTED';
  end if;

  perform set_config('request.jwt.claim.sub', v_target_id::text, true);
  select count(*) into v_effective from public.erp_security_get_effective_capabilities(v_company_id);
  if v_effective <> (select count(*) from public.erp_security_profile_capabilities where profile_id=v_profile_a) then
    raise exception 'PROFILE_CAPABILITIES_NOT_EFFECTIVE';
  end if;

  -- UPDATE profile: Auth UUID and password remain untouched.
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform public.erp_admin_configure_user_access(
    v_target_id,'TEMP ADMIN USERS TARGET UPDATED','temp_admin_users_target','TEST','Fixture updated','rollback only',
    jsonb_build_array(jsonb_build_object(
      'company_id',v_company_id,'profile_id',v_profile_b,'membership_role','EDITOR',
      'membership_status','ACTIVE','is_default',true
    )),gen_random_uuid()
  );
  if (select count(*) from auth.users where id=v_target_id and encrypted_password is not distinct from v_password_before) <> 1
     or (select count(*) from public.erp_security_user_company_profiles where company_id=v_company_id and user_id=v_target_id and profile_id=v_profile_b) <> 1 then
    raise exception 'PROFILE_UPDATE_AUTH_IDENTITY_CHANGED';
  end if;

  -- ACTIVATE / DEACTIVATE keeps canonical profile and Auth.
  perform public.erp_admin_configure_user_access(
    v_target_id,'TEMP ADMIN USERS TARGET UPDATED','temp_admin_users_target','TEST','Fixture updated','rollback only',
    jsonb_build_array(jsonb_build_object(
      'company_id',v_company_id,'profile_id',v_profile_b,'membership_role','EDITOR',
      'membership_status','SUSPENDED','is_default',false
    )),gen_random_uuid()
  );
  perform set_config('request.jwt.claim.sub', v_target_id::text, true);
  v_failed := false;
  begin
    perform public.erp_security_get_effective_capabilities(v_company_id);
  exception when others then v_failed := sqlstate = '42501'; end;
  if not v_failed then raise exception 'SUSPENDED_USER_ACCESS_NOT_DENIED'; end if;
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform public.erp_admin_configure_user_access(
    v_target_id,'TEMP ADMIN USERS TARGET UPDATED','temp_admin_users_target','TEST','Fixture updated','rollback only',
    jsonb_build_array(jsonb_build_object(
      'company_id',v_company_id,'profile_id',v_profile_b,'membership_role','EDITOR',
      'membership_status','ACTIVE','is_default',true
    )),gen_random_uuid()
  );

  -- Negative: missing profile.
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_second_target_id,'NEGATIVE TARGET','negative_target',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_company_id,'profile_id','','membership_role','VIEWER','membership_status','ACTIVE')),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlerrm like '%ACTIVE_CANONICAL_PROFILE_REQUIRED%'; end;
  if not v_failed then raise exception 'NEGATIVE_PROFILE_MISSING_NOT_DENIED'; end if;
  if exists(select 1 from public.user_profiles where user_id=v_second_target_id) then
    raise exception 'FAILED_CREATE_LEFT_PARTIAL_ERP_STATE';
  end if;

  -- Negative: nonexistent profile.
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_second_target_id,'NEGATIVE TARGET','negative_target',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_company_id,'profile_id','PROFILE_DOES_NOT_EXIST','membership_role','VIEWER','membership_status','ACTIVE')),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlerrm like '%ACTIVE_CANONICAL_PROFILE_REQUIRED%'; end;
  if not v_failed then raise exception 'NEGATIVE_PROFILE_UNKNOWN_NOT_DENIED'; end if;

  -- Negative: frontend-supplied individual authority.
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_second_target_id,'NEGATIVE TARGET','negative_target',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_company_id,'profile_id',v_profile_a,'membership_role','VIEWER','membership_status','ACTIVE','capabilities',jsonb_build_array('admin.users.manage'))),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlerrm like '%INDIVIDUAL_PERMISSIONS_NOT_ACCEPTED%'; end;
  if not v_failed then raise exception 'MANUAL_CAPABILITIES_NOT_DENIED'; end if;
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_second_target_id,'NEGATIVE TARGET','negative_target',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_company_id,'profile_id',v_profile_a,'membership_role','VIEWER','membership_status','ACTIVE','user_route_permissions','[]'::jsonb)),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlerrm like '%INDIVIDUAL_PERMISSIONS_NOT_ACCEPTED%'; end;
  if not v_failed then raise exception 'MANUAL_ROUTE_PERMISSIONS_NOT_DENIED'; end if;

  -- Negative: ADMIN cannot assign OWNER.
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_second_target_id,'NEGATIVE TARGET','negative_target',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_company_id,'profile_id',v_profile_a,'membership_role','OWNER','membership_status','ACTIVE')),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlerrm like '%OWNER_ROLE_ASSIGNMENT_REQUIRES_OWNER%'; end;
  if not v_failed then raise exception 'ADMIN_OWNER_ASSIGNMENT_NOT_DENIED'; end if;

  -- Negative: actor without administrative meta-role/capability.
  perform set_config('request.jwt.claim.sub', v_target_id::text, true);
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_second_target_id,'NEGATIVE TARGET','negative_target',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_company_id,'profile_id',v_profile_a,'membership_role','VIEWER','membership_status','ACTIVE')),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlstate = '42501'; end;
  if not v_failed then raise exception 'NON_ADMIN_ACTOR_NOT_DENIED'; end if;

  -- Negative: cross-company attempt. Profiles are global in the real model;
  -- company eligibility is therefore enforced by the actor's company access.
  perform set_config('request.jwt.claim.sub', v_target_id::text, true);
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_second_target_id,'NEGATIVE TARGET','negative_target',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_other_company_id,'profile_id',v_profile_a,'membership_role','VIEWER','membership_status','ACTIVE')),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlstate = '42501'; end;
  if not v_failed then raise exception 'CROSS_COMPANY_ACCESS_NOT_DENIED'; end if;

  -- Positive change-company access by an actor authorized in that company.
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform public.erp_admin_configure_user_access(
    v_target_id,'TEMP ADMIN USERS TARGET UPDATED','temp_admin_users_target','TEST','Fixture updated','rollback only',
    jsonb_build_array(jsonb_build_object(
      'company_id',v_other_company_id,'profile_id',v_profile_a,'membership_role','VIEWER',
      'membership_status','ACTIVE','is_default',false
    )),gen_random_uuid()
  );
  if (select count(*) from public.erp_security_user_company_profiles where company_id=v_other_company_id and user_id=v_target_id and profile_id=v_profile_a) <> 1 then
    raise exception 'CHANGE_COMPANY_ACCESS_FAILED';
  end if;
  perform public.erp_admin_revoke_user_company_access(v_target_id,jsonb_build_array(v_other_company_id),gen_random_uuid());
  if (select count(*) from public.user_company_memberships where company_id=v_other_company_id and user_id=v_target_id and membership_status='REVOKED') <> 1
     or exists(select 1 from public.erp_security_user_company_profiles where company_id=v_other_company_id and user_id=v_target_id) then
    raise exception 'REMOVE_OTHER_COMPANY_MEMBERSHIP_FAILED';
  end if;

  -- Negative: self-elevation is fail-closed.
  v_failed := false;
  begin
    perform public.erp_admin_configure_user_access(
      v_admin_id,'TEMP ADMIN USERS ADMIN','temp_admin_users_admin',null,null,null,
      jsonb_build_array(jsonb_build_object('company_id',v_company_id,'profile_id','GERENCIA_GENERAL','membership_role','OWNER','membership_status','ACTIVE')),
      gen_random_uuid()
    );
  exception when others then v_failed := sqlerrm like '%SECURITY_SELF_ELEVATION_DENIED%'; end;
  if not v_failed then raise exception 'SELF_ELEVATION_NOT_DENIED'; end if;

  -- Remove final company; Auth survives and global ERP profile becomes inactive.
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform public.erp_admin_revoke_user_company_access(v_target_id,jsonb_build_array(v_company_id),gen_random_uuid());
  if (select count(*) from auth.users where id=v_target_id) <> 1
     or (select count(*) from public.user_profiles where user_id=v_target_id and not is_active) <> 1
     or (select count(*) from public.user_company_memberships where company_id=v_company_id and user_id=v_target_id and membership_status='REVOKED') <> 1
     or exists(select 1 from public.erp_security_user_company_profiles where company_id=v_company_id and user_id=v_target_id) then
    raise exception 'FINAL_MEMBERSHIP_REVOCATION_CONTRACT_FAILED';
  end if;
end;
$$;

select jsonb_build_object(
  'result','PASS',
  'create_user','PASS',
  'assign_profile','PASS',
  'update_user','PASS',
  'activate_deactivate','PASS',
  'self_elevation','PASS',
  'cross_company','PASS',
  'remove_membership','PASS',
  'change_company_access','PASS',
  'auth_uuid_preserved',true,
  'password_unchanged',true,
  'legacy_writes',0,
  'fixture','ROLLBACK'
) as result;

rollback;
