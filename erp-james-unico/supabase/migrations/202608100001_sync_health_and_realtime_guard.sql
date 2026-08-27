begin;

-- Health check autenticado utilizado por el supervisor incremental. No expone
-- datos empresariales y confirma que la sesión, la membresía y el backend de
-- sincronización están disponibles antes de procesar la cola offline.
create or replace function public.erp_sync_health(p_company_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.erp_is_active_user(auth.uid()) then
    raise exception 'Se requiere una sesión ERP activa' using errcode = '42501';
  end if;

  if p_company_id is not null
     and not public.erp_is_company_member(p_company_id, auth.uid()) then
    raise exception 'El usuario no tiene acceso activo a la empresa' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'server_time', clock_timestamp(),
    'user_id', auth.uid(),
    'company_id', p_company_id,
    'incremental_ready', to_regclass('public.erp_entity_records') is not null
      and to_regclass('public.erp_sync_operations') is not null,
    'realtime_ready', exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'erp_entity_records'
    )
  );
end;
$$;

revoke all on function public.erp_sync_health(uuid) from public;
grant execute on function public.erp_sync_health(uuid) to authenticated;

commit;
