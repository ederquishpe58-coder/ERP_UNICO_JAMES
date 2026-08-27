begin;

-- Supabase activa una protección que exige WHERE en DELETE. La función sigue
-- siendo exclusiva de service_role y requiere la confirmación exacta, pero
-- ahora es compatible con esa protección para permitir un inicio realmente
-- limpio sin eliminar empresas ni parámetros tributarios.
create or replace function public.erp_reset_to_clean_start(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role()::text, '');
  v_result jsonb;
begin
  if v_role <> 'service_role' then
    raise exception 'La limpieza está disponible únicamente para service_role' using errcode = '42501';
  end if;
  if p_confirmation <> 'RESET_JAEDER_DATA_20260807' then
    raise exception 'Confirmación de limpieza incorrecta' using errcode = '22023';
  end if;

  perform set_config('app.jaeder_reset_users', 'on', true);

  delete from public.accounting_document_links where true;
  delete from public.journal_entry_lines where true;
  delete from public.journal_entries where true;
  delete from public.electronic_document_audit_logs where true;
  delete from public.sri_error_messages where true;
  delete from public.sri_authorizations where true;
  delete from public.sri_responses where true;
  delete from public.sri_transmission_attempts where true;
  delete from public.sri_transmissions where true;
  delete from public.electronic_document_files where true;
  delete from public.electronic_document_taxes where true;
  delete from public.electronic_document_lines where true;
  delete from public.electronic_documents where true;
  delete from public.erp_sync_field_audit where true;
  delete from public.erp_sync_operations where true;
  delete from public.erp_entity_records where true;

  update public.erp_company_state
  set state_json = public.erp_clean_transaction_state(state_json),
      revision = revision + 1,
      updated_by = null,
      updated_at = clock_timestamp()
  where true;

  delete from public.erp_access_audit_log where true;
  delete from public.user_route_permissions where true;
  delete from public.user_company_memberships where true;
  delete from public.user_profiles where true;

  select jsonb_build_object(
    'reset_at', clock_timestamp(),
    'companies_preserved', (select count(*) from public.companies),
    'sri_settings_preserved', (select count(*) from public.sri_settings),
    'emission_points_preserved', (select count(*) from public.emission_points),
    'sequences_preserved', (select count(*) from public.electronic_document_sequences),
    'certificates_preserved', (select count(*) from public.digital_certificates),
    'profiles_remaining', (select count(*) from public.user_profiles),
    'entity_records_remaining', (select count(*) from public.erp_entity_records),
    'documents_remaining', (select count(*) from public.electronic_documents)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.erp_reset_to_clean_start(text) from public;
grant execute on function public.erp_reset_to_clean_start(text) to service_role;

commit;
