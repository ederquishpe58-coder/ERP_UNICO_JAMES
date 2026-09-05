begin;

-- Access writes use the existing actor-authenticated canonical RPCs. Keep
-- historical tables and read access; do not alter memberships or profile grants.
do $$
begin
  if to_regprocedure('public.erp_admin_configure_user_access(uuid,text,text,text,text,text,jsonb,uuid)') is null
     or to_regprocedure('public.erp_admin_revoke_user_company_access(uuid,jsonb,uuid)') is null then
    raise exception 'CANONICAL_ADMIN_RPC_REQUIRED';
  end if;
end;
$$;

revoke insert, update, delete on public.user_company_memberships from authenticated;
revoke insert, update, delete on public.user_route_permissions from authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.user_company_memberships', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.user_route_permissions', 'INSERT,UPDATE,DELETE') then
    raise exception 'LEGACY_ADMIN_DML_STILL_REACHABLE';
  end if;
  if not has_table_privilege('authenticated', 'public.user_company_memberships', 'SELECT')
     or not has_table_privilege('authenticated', 'public.user_route_permissions', 'SELECT')
     or not has_function_privilege('authenticated', 'public.erp_admin_configure_user_access(uuid,text,text,text,text,text,jsonb,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.erp_admin_revoke_user_company_access(uuid,jsonb,uuid)', 'EXECUTE') then
    raise exception 'CANONICAL_ADMIN_ACCESS_REGRESSION';
  end if;
end;
$$;

commit;
