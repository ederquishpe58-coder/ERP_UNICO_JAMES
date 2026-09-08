-- Add an existing identity to one company. No Auth or default-company writes.
create or replace function public.erp_admin_add_existing_user_membership(
  p_company_id uuid, p_target_user_id uuid, p_membership_role text,
  p_profile_id text, p_operation_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_member public.user_company_memberships%rowtype;
  v_result jsonb; v_context jsonb; v_prior public.erp_access_audit_log%rowtype;
  v_profile public.user_profiles%rowtype;
begin
  perform public.erp_security_u2c4_assert_admin(p_company_id,'admin.users.manage');
  if v_actor=p_target_user_id then
    raise exception using errcode='42501',message='SECURITY_SELF_ELEVATION_DENIED';
  end if;
  if p_target_user_id is null or not exists(select 1 from auth.users where id=p_target_user_id) then
    raise exception using errcode='23503',message='AUTH_USER_REQUIRED';
  end if;
  select * into v_profile from public.user_profiles where user_id=p_target_user_id;
  if not found or v_profile.is_active is not true then
    raise exception using errcode='23514',message='ACTIVE_EXISTING_USER_PROFILE_REQUIRED';
  end if;
  if p_operation_id is null or coalesce(btrim(p_reason),'')='' then
    raise exception using errcode='23514',message='SECURITY_MEMBERSHIP_REQUEST_REQUIRED';
  end if;
  if p_membership_role is null or p_membership_role not in ('OWNER','ADMIN','EDITOR','VIEWER') then
    raise exception using errcode='23514',message='MEMBERSHIP_ROLE_INVALID';
  end if;
  if p_membership_role='OWNER' and not exists(select 1 from public.user_company_memberships
      where company_id=p_company_id and user_id=v_actor and membership_role='OWNER' and membership_status='ACTIVE') then
    raise exception using errcode='42501',message='OWNER_ROLE_ASSIGNMENT_REQUIRES_OWNER';
  end if;
  if not exists(select 1 from public.erp_security_profiles where profile_id=p_profile_id and active) then
    raise exception using errcode='23514',message='ACTIVE_CANONICAL_PROFILE_REQUIRED';
  end if;
  v_context:=jsonb_build_object('actor',v_actor,'company_id',p_company_id,'target_user_id',p_target_user_id,
    'membership_role',p_membership_role,'profile_id',p_profile_id,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_target_user_id::text,0));
  select * into v_prior from public.erp_access_audit_log where id=p_operation_id;
  if found and (v_prior.company_id is distinct from p_company_id or v_prior.user_id is distinct from v_actor
      or v_prior.reason_code is distinct from 'EXISTING_USER_MEMBERSHIP_ADDED'
      or v_prior.details->'context' is distinct from v_context) then
    raise exception using errcode='23514',message='SECURITY_MEMBERSHIP_CONTEXT_MISMATCH';
  end if;
  select * into v_member from public.user_company_memberships
    where company_id=p_company_id and user_id=p_target_user_id for update;
  if found then
    -- A retry/concurrent request never overwrites an existing membership or plan.
    v_result:=public.erp_admin_preview_user_access_plan(p_company_id,p_target_user_id);
    return v_result||jsonb_build_object('confirmed',true,'created',false,'already_member',true,'operation_id',p_operation_id);
  end if;
  if v_prior.id is not null then
    raise exception using errcode='40001',message='SECURITY_MEMBERSHIP_STATE_CHANGED';
  end if;
  -- Orphaned assignments must be reviewed, never activated by adding membership.
  if exists(select 1 from public.erp_security_user_company_profiles where company_id=p_company_id and user_id=p_target_user_id)
    or exists(select 1 from public.erp_security_user_capability_overrides where company_id=p_company_id and user_id=p_target_user_id) then
    raise exception using errcode='23514',message='SECURITY_ORPHAN_ACCESS_REVIEW_REQUIRED';
  end if;
  insert into public.user_company_memberships(company_id,user_id,membership_role,membership_status,is_default,
      display_name_override,created_by,updated_by)
    values(p_company_id,p_target_user_id,p_membership_role,'ACTIVE',false,v_profile.display_name,v_actor,v_actor);
  insert into public.erp_security_user_company_profiles(company_id,user_id,profile_id,assigned_by)
    values(p_company_id,p_target_user_id,p_profile_id,v_actor);
  v_result:=public.erp_admin_preview_user_access_plan(p_company_id,p_target_user_id)
    ||jsonb_build_object('confirmed',true,'created',true,'already_member',false,'operation_id',p_operation_id);
  insert into public.erp_access_audit_log(id,company_id,user_id,route_id,requested_action,allowed,reason_code,request_id,source,details)
    values(p_operation_id,p_company_id,v_actor,'settings-users','edit',true,'EXISTING_USER_MEMBERSHIP_ADDED',p_operation_id::text,'ERP_WEB',
      jsonb_build_object('context',v_context,'before',null,'result',v_result));
  return v_result;
end;
$$;
revoke all on function public.erp_admin_add_existing_user_membership(uuid,uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.erp_admin_add_existing_user_membership(uuid,uuid,text,text,uuid,text) to authenticated;
