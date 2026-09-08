-- Isolated fixture: missing security dependency definitions read from PROD 2026-09-08. No live data.
create table erp_access_audit_log(id uuid default gen_random_uuid() not null primary key,occurred_at timestamptz default now() not null,company_id uuid,user_id uuid,route_id text not null,requested_action text not null,allowed bool not null,reason_code text not null,request_id text,source text default 'ERP_WEB'::text not null,ip_address inet,user_agent text,details jsonb default '{}'::jsonb not null);
alter table user_profiles add column display_name text, add column username text, add column default_company_id uuid;
CREATE OR REPLACE FUNCTION public.erp_security_u2c4_assert_admin(p_company_id uuid, p_capability_id text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  perform public.erp_security_assert_capability(p_company_id, p_capability_id);
  if not exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = v_actor
      and membership.membership_status = 'ACTIVE'
      and membership.membership_role in ('OWNER','ADMIN')
      and (membership.valid_from is null or membership.valid_from <= current_date)
      and (membership.valid_until is null or membership.valid_until >= current_date)
  ) then
    raise exception using errcode = '42501', message = 'SECURITY_ADMIN_META_ROLE_REQUIRED';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.erp_security_get_permission_version(p_company_id uuid)
 RETURNS TABLE(catalog_version bigint, company_version bigint, security_token text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  return query
  select
    engine.catalog_version,
    coalesce(company_version.permissions_version, 1),
    engine.catalog_version::text || ':' || coalesce(company_version.permissions_version, 1)::text
  from public.erp_security_engine_state engine
  left join public.erp_security_permission_versions company_version
    on company_version.company_id = p_company_id
  where engine.singleton_key = 'GLOBAL';
end;
$function$
;

-- Canonical INSERT triggers observed in PROD; fixtures only.
CREATE OR REPLACE FUNCTION public.erp_security_bump_company_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old_company uuid;
  v_new_company uuid;
begin
  if tg_op <> 'INSERT' then v_old_company := old.company_id; end if;
  if tg_op <> 'DELETE' then v_new_company := new.company_id; end if;
  if v_old_company is not null then
    insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
    values(v_old_company, 1, clock_timestamp())
    on conflict(company_id) do update
      set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
          updated_at = clock_timestamp();
  end if;
  if v_new_company is not null and v_new_company is distinct from v_old_company then
    insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
    values(v_new_company, 1, clock_timestamp())
    on conflict(company_id) do update
      set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
          updated_at = clock_timestamp();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
drop trigger if exists erp_security_membership_version on public.user_company_memberships;
CREATE TRIGGER erp_security_membership_version AFTER INSERT OR DELETE OR UPDATE ON public.user_company_memberships FOR EACH ROW EXECUTE FUNCTION erp_security_bump_company_version();
CREATE OR REPLACE FUNCTION public.erp_stamp_membership_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
      new.updated_by := v_actor;
    end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if v_actor is not null then
      new.updated_by := v_actor;
    end if;
  end if;
  return new;
end;
$function$
;
drop trigger if exists memberships_stamp_actor on public.user_company_memberships;
CREATE TRIGGER memberships_stamp_actor BEFORE INSERT OR UPDATE ON public.user_company_memberships FOR EACH ROW EXECUTE FUNCTION erp_stamp_membership_actor();
CREATE OR REPLACE FUNCTION public.erp_security_validate_profile_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (
    select 1 from public.erp_security_profiles p
    where p.profile_id = new.profile_id and p.active
  ) then
    raise exception using errcode = '23514', message = 'ACTIVE_SECURITY_PROFILE_REQUIRED';
  end if;
  new.assigned_at := case when tg_op = 'INSERT' then clock_timestamp() else old.assigned_at end;
  new.updated_at := clock_timestamp();
  if auth.uid() is not null then
    new.assigned_by := auth.uid();
  end if;
  return new;
end;
$function$
;
drop trigger if exists erp_security_user_profile_validate on public.erp_security_user_company_profiles;
CREATE TRIGGER erp_security_user_profile_validate BEFORE INSERT OR UPDATE ON public.erp_security_user_company_profiles FOR EACH ROW EXECUTE FUNCTION erp_security_validate_profile_assignment();
CREATE OR REPLACE FUNCTION public.erp_security_bump_company_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old_company uuid;
  v_new_company uuid;
begin
  if tg_op <> 'INSERT' then v_old_company := old.company_id; end if;
  if tg_op <> 'DELETE' then v_new_company := new.company_id; end if;
  if v_old_company is not null then
    insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
    values(v_old_company, 1, clock_timestamp())
    on conflict(company_id) do update
      set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
          updated_at = clock_timestamp();
  end if;
  if v_new_company is not null and v_new_company is distinct from v_old_company then
    insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
    values(v_new_company, 1, clock_timestamp())
    on conflict(company_id) do update
      set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
          updated_at = clock_timestamp();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
drop trigger if exists erp_security_user_profile_version on public.erp_security_user_company_profiles;
CREATE TRIGGER erp_security_user_profile_version AFTER INSERT OR DELETE OR UPDATE ON public.erp_security_user_company_profiles FOR EACH ROW EXECUTE FUNCTION erp_security_bump_company_version();
