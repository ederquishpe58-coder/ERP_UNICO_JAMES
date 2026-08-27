begin;

-- Impide que una pestaña antigua vuelva a activar un registro eliminado por un
-- reinicio operativo. Los nuevos registros usan identificadores distintos, por
-- lo que esta protección no interfiere con el trabajo posterior al reinicio.
create or replace function public.erp_protect_server_reset_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.deleted_at is not null and old.device_id = 'SERVER_RESET' then
    new.payload := '{}'::jsonb;
    new.deleted_at := old.deleted_at;
    new.device_id := 'SERVER_RESET';
    new.last_operation_id := old.last_operation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists erp_entity_records_protect_server_reset on public.erp_entity_records;
create trigger erp_entity_records_protect_server_reset
before update on public.erp_entity_records
for each row execute function public.erp_protect_server_reset_tombstone();

create or replace function public.erp_reset_operational_data(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role()::text, '');
  v_entities text[] := array[
    'tax_ats_history',
    'commercial_orders', 'commercial_preorders', 'commercial_reservations',
    'operations_receptions', 'operations_classifier_assignments',
    'operations_classification_results', 'operations_classifications',
    'operations_label_batches', 'operations_rose_inventory', 'operations_performances',
    'operations_mesh_records', 'operations_mesh_history', 'operations_mesh_history_audit',
    'operations_bunch_entries', 'operations_scanner_events', 'operations_consumptions',
    'operations_kardex', 'operations_dispatches', 'operations_reservations',
    'operations_availability', 'operations_yield_workday_history',
    'accounting_journal_entries', 'accounting_audit_logs',
    'purchases', 'purchase_payables', 'issued_withholdings', 'payments', 'payment_batches',
    'bank_movements', 'bank_statement_movements', 'bank_reconciliations',
    'customer_receivables', 'collections', 'collection_batches', 'received_withholdings',
    'material_inventory_movements', 'sales',
    'payroll_hour_entries', 'payroll_performance_entries', 'payroll_runs',
    'payroll_items', 'payroll_payments'
  ];
  v_active_before bigint := 0;
  v_tombstones bigint := 0;
  v_result jsonb;
begin
  if v_role <> 'service_role' then
    raise exception 'La limpieza operativa está disponible únicamente para service_role' using errcode = '42501';
  end if;
  if p_confirmation <> 'RESET_JAEDER_OPERATIONAL_DATA_20260814' then
    raise exception 'Confirmación de limpieza operativa incorrecta' using errcode = '22023';
  end if;

  select count(*) into v_active_before
  from public.erp_entity_records
  where entity = any(v_entities) and deleted_at is null;

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

  delete from public.erp_sync_field_audit where entity = any(v_entities);
  delete from public.erp_sync_operations where entity = any(v_entities);

  update public.erp_entity_records
     set payload = '{}'::jsonb,
         version = greatest(version + 1, 1000000000),
         updated_at = clock_timestamp(),
         updated_by = null,
         deleted_at = clock_timestamp(),
         device_id = 'SERVER_RESET',
         last_operation_id = null
   where entity = any(v_entities);

  get diagnostics v_tombstones = row_count;

  update public.erp_company_state
     set state_json = public.erp_clean_transaction_state(state_json),
         revision = revision + 1,
         updated_by = null,
         updated_at = clock_timestamp()
   where true;

  delete from public.erp_access_audit_log where true;

  select jsonb_build_object(
    'reset_at', clock_timestamp(),
    'active_records_removed', v_active_before,
    'protected_tombstones', v_tombstones,
    'active_operational_records', (
      select count(*) from public.erp_entity_records
      where entity = any(v_entities) and deleted_at is null
    ),
    'preserved_catalog_records', (
      select count(*) from public.erp_entity_records
      where not (entity = any(v_entities)) and deleted_at is null
    ),
    'users_preserved', (select count(*) from public.user_profiles),
    'memberships_preserved', (select count(*) from public.user_company_memberships),
    'companies_preserved', (select count(*) from public.companies),
    'sri_sequences_preserved', (select count(*) from public.electronic_document_sequences),
    'documents_remaining', (select count(*) from public.electronic_documents),
    'journal_entries_remaining', (select count(*) from public.journal_entries)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.erp_reset_operational_data(text) from public;
grant execute on function public.erp_reset_operational_data(text) to service_role;

commit;
