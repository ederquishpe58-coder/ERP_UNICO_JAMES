begin;

-- La fila por empresa es la fuente oficial compartida actual del ERP.
-- FULL permite que Realtime entregue una identidad consistente en cambios y bajas.
alter table public.erp_company_state replica identity full;

-- La tabla ya tiene RLS y la política erp_company_state_select_member.
-- Solo se agrega a la publicación si todavía no está incluida.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'erp_company_state'
  ) then
    alter publication supabase_realtime add table public.erp_company_state;
  end if;
end;
$$;

grant select on table public.erp_company_state to authenticated;

comment on table public.erp_company_state is
  'Fuente oficial compartida por empresa. Escritura versionada exclusivamente mediante erp_save_company_state y lectura protegida por RLS.';

commit;
