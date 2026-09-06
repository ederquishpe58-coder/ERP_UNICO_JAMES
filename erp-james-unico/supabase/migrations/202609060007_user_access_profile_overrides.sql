-- ACCESS-01: administration mechanism only; no assignments or capability data.
-- Shared resolver is private. Existing membership authorization remains unchanged.
create or replace function public.erp_security_resolve_access_plan_internal(p_profile_id text, p_overrides jsonb)
returns table(capability_id text,module text,resource text,action text,risk_level text,description text,permission_source text)
language sql stable security definer set search_path=public,pg_temp as $$
  with candidates as (
    select pc.capability_id,1 priority,'PROFILE'::text source
    from public.erp_security_profile_capabilities pc where pc.profile_id=p_profile_id
    union all
    select o->>'capability_id',2,'USER_GRANT' from jsonb_array_elements(p_overrides) o where o->>'effect'='GRANT'
  ), chosen as (
    select distinct on (c.capability_id) c.capability_id,c.source from candidates c
    where not exists(select 1 from jsonb_array_elements(p_overrides) o where o->>'capability_id'=c.capability_id and o->>'effect'='DENY')
    order by c.capability_id,c.priority desc
  )
  select c.capability_id,c.module,c.resource,c.action,c.risk_level,c.description,s.source
  from chosen s join public.erp_security_capabilities c on c.capability_id=s.capability_id and c.active
  where p_profile_id is null or exists(select 1 from public.erp_security_profiles p where p.profile_id=p_profile_id and p.active)
  order by c.capability_id;
$$;
revoke all on function public.erp_security_resolve_access_plan_internal(text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.erp_security_get_effective_capabilities(p_company_id uuid)
returns table(capability_id text,module text,resource text,action text,risk_level text,description text,permission_source text,catalog_version bigint,company_version bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_actor uuid; v_profile text; v_overrides jsonb;
begin
  v_actor:=public.erp_u2a_assert_company_read_access(p_company_id);
  select u.profile_id into v_profile from public.erp_security_user_company_profiles u join public.erp_security_profiles p using(profile_id)
    where u.company_id=p_company_id and u.user_id=v_actor;
  select coalesce(jsonb_agg(to_jsonb(o)),'[]') into v_overrides from public.erp_security_user_capability_overrides o
    where o.company_id=p_company_id and o.user_id=v_actor;
  return query select r.*,e.catalog_version,coalesce(v.permissions_version,1)
    from public.erp_security_resolve_access_plan_internal(v_profile,v_overrides) r
    cross join public.erp_security_engine_state e
    left join public.erp_security_permission_versions v on v.company_id=p_company_id
    where e.singleton_key='GLOBAL' order by r.capability_id;
end;
$$;

-- Both preview and save require the published administrative capability AND meta-role.
create or replace function public.erp_admin_preview_user_access_plan(
  p_company_id uuid,p_target_user_id uuid,p_profile_id text default null,p_overrides jsonb default null
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_member public.user_company_memberships%rowtype;
  v_current_profile jsonb; v_current_overrides jsonb; v_profile text; v_overrides jsonb;
  v_effective jsonb; v_base jsonb; v_version jsonb; v_item jsonb; v_token text;
begin
  perform public.erp_security_u2c4_assert_admin(p_company_id,'admin.users.manage');
  if v_actor=p_target_user_id then raise exception using errcode='42501',message='SECURITY_SELF_ELEVATION_DENIED'; end if;
  select * into v_member from public.user_company_memberships where company_id=p_company_id and user_id=p_target_user_id;
  if not found then raise exception using errcode='42501',message='SECURITY_TARGET_MEMBERSHIP_REQUIRED'; end if;
  if v_member.membership_role='OWNER' and not exists(select 1 from public.user_company_memberships where company_id=p_company_id and user_id=v_actor and membership_role='OWNER') then
    raise exception using errcode='42501',message='SECURITY_OWNER_ADMIN_REQUIRED';
  end if;
  select to_jsonb(p) into v_current_profile from public.erp_security_user_company_profiles p where company_id=p_company_id and user_id=p_target_user_id;
  select coalesce(jsonb_agg(to_jsonb(o) order by capability_id),'[]') into v_current_overrides
    from public.erp_security_user_capability_overrides o where company_id=p_company_id and user_id=p_target_user_id;
  select to_jsonb(v) into v_version from public.erp_security_get_permission_version(p_company_id) v;
  v_token:=md5(jsonb_build_object('membership',to_jsonb(v_member),'profile',v_current_profile,'overrides',v_current_overrides,'version',v_version)::text);
  v_profile:=coalesce(p_profile_id,v_current_profile->>'profile_id');
  v_overrides:=coalesce(p_overrides,v_current_overrides);
  if p_profile_id is not null or p_overrides is not null then
    if p_profile_id is null or p_overrides is null or not exists(select 1 from public.erp_security_profiles where profile_id=p_profile_id and active) then
      raise exception using errcode='23514',message='ACTIVE_PROFILE_REQUIRED';
    end if;
    if jsonb_typeof(p_overrides) is distinct from 'array' or jsonb_array_length(p_overrides)>500 then
      raise exception using errcode='23514',message='SECURITY_OVERRIDE_SET_INVALID';
    end if;
    for v_item in select value from jsonb_array_elements(p_overrides) loop
      if jsonb_typeof(v_item) is distinct from 'object' or (v_item - array['capability_id','effect','reason']) <> '{}'::jsonb
        or coalesce(v_item->>'effect','') not in ('GRANT','DENY')
        or jsonb_typeof(v_item->'capability_id') is distinct from 'string'
        or not exists(select 1 from public.erp_security_capabilities where capability_id=v_item->>'capability_id' and active) then
        raise exception using errcode='23514',message='ACTIVE_CAPABILITY_REQUIRED';
      end if;
      if exists(select 1 from public.erp_security_capabilities where capability_id=v_item->>'capability_id' and risk_level in ('HIGH','CRITICAL'))
         and coalesce(btrim(v_item->>'reason'),'')='' then
        raise exception using errcode='23514',message='SECURITY_OVERRIDE_REASON_REQUIRED';
      end if;
    end loop;
    if (select count(*)<>count(distinct value->>'capability_id') from jsonb_array_elements(p_overrides)) then
      raise exception using errcode='23514',message='SECURITY_OVERRIDE_DUPLICATE';
    end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by capability_id),'[]') into v_effective from public.erp_security_resolve_access_plan_internal(v_profile,v_overrides) r;
  select coalesce(jsonb_agg(to_jsonb(r) order by capability_id),'[]') into v_base from public.erp_security_resolve_access_plan_internal(v_profile,'[]') r;
  return jsonb_build_object('company_id',p_company_id,'target_user_id',p_target_user_id,'membership',to_jsonb(v_member),
    'profile_id',v_profile,'overrides',v_overrides,'effective_capabilities',v_effective,'base_capabilities',v_base,
    'version',v_version,'state_token',v_token,'current_profile',v_current_profile,'current_overrides',v_current_overrides,
    'profiles',(select coalesce(jsonb_agg(jsonb_build_object('profile_id',profile_id,'display_name',display_name) order by profile_id),'[]') from public.erp_security_profiles where active),
    'capability_catalog',(select coalesce(jsonb_agg(jsonb_build_object('capability_id',capability_id,'description',description,'risk_level',risk_level) order by capability_id),'[]') from public.erp_security_capabilities where active));
end;
$$;
revoke all on function public.erp_admin_preview_user_access_plan(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.erp_admin_preview_user_access_plan(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.erp_admin_configure_user_access_plan(
  p_company_id uuid,p_target_user_id uuid,p_profile_id text,p_overrides jsonb,p_expected_version text,p_operation_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before jsonb; v_after jsonb; v_context jsonb; v_prior public.erp_access_audit_log%rowtype; v_normalized jsonb;
begin
  -- Authorization precedes even the idempotency lookup. No cross-company replay.
  perform public.erp_security_u2c4_assert_admin(p_company_id,'admin.users.manage');
  if auth.uid()=p_target_user_id then raise exception using errcode='42501',message='SECURITY_SELF_ELEVATION_DENIED'; end if;
  if p_operation_id is null or coalesce(btrim(p_reason),'')='' or coalesce(p_expected_version,'')='' or p_profile_id is null or p_overrides is null then
    raise exception using errcode='23514',message='SECURITY_ACCESS_PLAN_REQUIRED';
  end if;
  if jsonb_typeof(p_overrides) is distinct from 'array' then raise exception using errcode='23514',message='SECURITY_OVERRIDE_SET_INVALID'; end if;
  select coalesce(jsonb_agg(value order by value->>'capability_id'),'[]') into v_normalized from jsonb_array_elements(p_overrides);
  v_context:=jsonb_build_object('company_id',p_company_id,'actor',auth.uid(),'target_user_id',p_target_user_id,
    'profile_id',p_profile_id,'overrides',v_normalized,'expected_version',p_expected_version,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_target_user_id::text,0));
  perform 1 from public.user_company_memberships where company_id=p_company_id and user_id=p_target_user_id for update;
  v_before:=public.erp_admin_preview_user_access_plan(p_company_id,p_target_user_id);
  select * into v_prior from public.erp_access_audit_log where id=p_operation_id;
  if found then
    if v_prior.company_id is distinct from p_company_id or v_prior.user_id is distinct from auth.uid()
      or v_prior.reason_code is distinct from 'USER_ACCESS_PLAN_REPLACED' or v_prior.details->'context' is distinct from v_context then
      raise exception using errcode='23514',message='SECURITY_ACCESS_PLAN_CONTEXT_MISMATCH';
    end if;
    if v_before->>'state_token' is distinct from v_prior.details->'result'->>'state_token' then
      raise exception using errcode='40001',message='SECURITY_ACCESS_PLAN_STALE';
    end if;
    return v_prior.details->'result';
  end if;
  if v_before->>'state_token' is distinct from p_expected_version then raise exception using errcode='40001',message='SECURITY_ACCESS_PLAN_STALE'; end if;
  -- Complete validation before any mutation. Any subsequent failure rolls back this RPC.
  perform public.erp_admin_preview_user_access_plan(p_company_id,p_target_user_id,p_profile_id,v_normalized);
  insert into public.erp_security_user_company_profiles(company_id,user_id,profile_id,assigned_by)
    values(p_company_id,p_target_user_id,p_profile_id,auth.uid())
    on conflict(company_id,user_id) do update set profile_id=excluded.profile_id,assigned_by=excluded.assigned_by,updated_at=clock_timestamp();
  delete from public.erp_security_user_capability_overrides where company_id=p_company_id and user_id=p_target_user_id;
  insert into public.erp_security_user_capability_overrides(company_id,user_id,capability_id,effect,reason,metadata,changed_by)
    select p_company_id,p_target_user_id,o->>'capability_id',o->>'effect',nullif(btrim(o->>'reason'),''),jsonb_build_object('operation_id',p_operation_id),auth.uid()
    from jsonb_array_elements(v_normalized) o;
  v_after:=public.erp_admin_preview_user_access_plan(p_company_id,p_target_user_id);
  v_after:=v_after||jsonb_build_object('confirmed',true,'operation_id',p_operation_id,'mode','REPLACE');
  insert into public.erp_access_audit_log(id,company_id,user_id,route_id,requested_action,allowed,reason_code,request_id,source,details)
    values(p_operation_id,p_company_id,auth.uid(),'settings-users','edit',true,'USER_ACCESS_PLAN_REPLACED',p_operation_id::text,'ERP_WEB',
      jsonb_build_object('context',v_context,'before',jsonb_build_object('membership',v_before->'membership','profile',v_before->'current_profile','overrides',v_before->'current_overrides'),
        'after',jsonb_build_object('membership',v_after->'membership','profile',v_after->'current_profile','overrides',v_after->'current_overrides'),'result',v_after));
  return v_after;
end;
$$;
revoke all on function public.erp_admin_configure_user_access_plan(uuid,uuid,text,jsonb,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.erp_admin_configure_user_access_plan(uuid,uuid,text,jsonb,text,uuid,text) to authenticated;
