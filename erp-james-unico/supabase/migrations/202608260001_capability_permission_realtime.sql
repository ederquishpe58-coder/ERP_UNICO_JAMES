-- U2C2B: permission-version invalidation over the existing company/user channel.
-- Business tables, grants, profiles and RPC authorization remain unchanged.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'erp_security_permission_versions'
  ) then
    alter publication supabase_realtime
      add table public.erp_security_permission_versions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'erp_security_engine_state'
  ) then
    alter publication supabase_realtime
      add table public.erp_security_engine_state;
  end if;
end;
$$;

do $$
begin
  if (
    select count(*)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in (
        'erp_security_permission_versions',
        'erp_security_engine_state'
      )
  ) <> 2 then
    raise exception 'U2C2B_SECURITY_REALTIME_PUBLICATION_INCOMPLETE';
  end if;
end;
$$;
