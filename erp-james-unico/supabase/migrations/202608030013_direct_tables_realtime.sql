begin;

-- Tablas que se consultan directamente (fuera de erp_company_state) y cuyos
-- cambios deben avisarse entre sesiones. RLS continúa filtrando cada evento.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'electronic_documents',
    'electronic_document_files',
    'electronic_document_sequences',
    'emission_points',
    'sri_settings',
    'sri_transmissions',
    'accounting_generation_rules',
    'companies',
    'user_profiles',
    'user_company_memberships',
    'user_route_permissions'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = table_name
       ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;
