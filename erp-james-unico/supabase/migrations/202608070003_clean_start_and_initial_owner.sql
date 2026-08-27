begin;

-- Respaldo interno previo a la limpieza. No se copian contraseñas, tokens ni
-- secretos de Auth. El esquema queda fuera de la API pública de Supabase.
create schema if not exists jaeder_backup_20260807;
revoke all on schema jaeder_backup_20260807 from public, anon, authenticated;

create table jaeder_backup_20260807.user_profiles as table public.user_profiles;
create table jaeder_backup_20260807.user_company_memberships as table public.user_company_memberships;
create table jaeder_backup_20260807.user_route_permissions as table public.user_route_permissions;
create table jaeder_backup_20260807.erp_company_state as table public.erp_company_state;
create table jaeder_backup_20260807.erp_access_audit_log as table public.erp_access_audit_log;
create table jaeder_backup_20260807.erp_entity_records as table public.erp_entity_records;
create table jaeder_backup_20260807.erp_sync_operations as table public.erp_sync_operations;
create table jaeder_backup_20260807.erp_sync_field_audit as table public.erp_sync_field_audit;
create table jaeder_backup_20260807.electronic_documents as table public.electronic_documents;
create table jaeder_backup_20260807.electronic_document_lines as table public.electronic_document_lines;
create table jaeder_backup_20260807.electronic_document_taxes as table public.electronic_document_taxes;
create table jaeder_backup_20260807.electronic_document_files as table public.electronic_document_files;
create table jaeder_backup_20260807.sri_transmissions as table public.sri_transmissions;
create table jaeder_backup_20260807.sri_transmission_attempts as table public.sri_transmission_attempts;
create table jaeder_backup_20260807.sri_responses as table public.sri_responses;
create table jaeder_backup_20260807.sri_authorizations as table public.sri_authorizations;
create table jaeder_backup_20260807.sri_error_messages as table public.sri_error_messages;
create table jaeder_backup_20260807.electronic_document_audit_logs as table public.electronic_document_audit_logs;
create table jaeder_backup_20260807.journal_entries as table public.journal_entries;
create table jaeder_backup_20260807.journal_entry_lines as table public.journal_entry_lines;
create table jaeder_backup_20260807.accounting_document_links as table public.accounting_document_links;
create table jaeder_backup_20260807.auth_users_metadata as
select id, email, invited_at, email_confirmed_at, created_at, updated_at,
       last_sign_in_at, raw_app_meta_data, raw_user_meta_data
from auth.users;

create table jaeder_backup_20260807.backup_manifest as
select clock_timestamp() as backed_up_at,
       (select count(*) from auth.users) as auth_users,
       (select count(*) from public.user_profiles) as profiles,
       (select count(*) from public.erp_company_state) as company_snapshots,
       (select count(*) from public.erp_entity_records) as entity_records,
       (select count(*) from public.electronic_documents) as electronic_documents,
       (select count(*) from public.journal_entries) as journal_entries,
       (select count(*) from public.companies) as companies,
       (select count(*) from public.sri_settings) as sri_settings,
       (select count(*) from public.emission_points) as emission_points,
       (select count(*) from public.electronic_document_sequences) as sequences,
       (select count(*) from public.digital_certificates) as certificates,
       (select count(*) from public.accounting_generation_rules) as accounting_rules;

-- Permite una limpieza administrativa explícita sin debilitar la protección
-- normal del último propietario de cada empresa.
create or replace function public.erp_protect_last_company_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removes_owner boolean;
  v_other_owners integer;
  v_validation_company boolean := false;
begin
  if current_setting('app.jaeder_reset_users', true) = 'on'
     and coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role()::text, '') = 'service_role' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    select coalesce((company_row.metadata ->> 'validation_only')::boolean, false)
      into v_validation_company
    from public.companies company_row
    where company_row.id = old.company_id;
    if v_validation_company or not exists (
      select 1 from public.companies company_row where company_row.id = old.company_id
    ) then
      return old;
    end if;
  end if;

  if old.membership_role <> 'OWNER' or old.membership_status <> 'ACTIVE' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    v_removes_owner := true;
  else
    v_removes_owner := new.company_id <> old.company_id
      or new.membership_role <> old.membership_role
      or new.membership_status <> 'ACTIVE';
    if not v_removes_owner then return new; end if;
  end if;

  select count(*) into v_other_owners
  from public.user_company_memberships membership_row
  where membership_row.company_id = old.company_id
    and membership_row.membership_role = 'OWNER'
    and membership_row.membership_status = 'ACTIVE'
    and membership_row.id <> old.id;
  if v_other_owners = 0 then
    raise exception 'No se puede quitar el último OWNER activo de la empresa' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- El primer usuario debe haber sido invitado por Supabase. Solo puede reclamar
-- el acceso cuando todavía no existe ningún perfil ni membresía en el ERP.
create or replace function public.erp_claim_initial_owner()
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user auth.users%rowtype;
  v_company public.companies%rowtype;
  v_display_name text;
  v_username text;
  v_first boolean := true;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('jaeder-initial-owner'));
  if exists (select 1 from public.user_profiles)
     or exists (select 1 from public.user_company_memberships) then
    return false;
  end if;
  select * into v_user from auth.users where id = auth.uid();
  if not found or v_user.invited_at is null then
    raise exception 'El primer propietario debe provenir de una invitación de Supabase' using errcode = '42501';
  end if;

  v_display_name := coalesce(nullif(v_user.raw_user_meta_data->>'display_name', ''), nullif(v_user.raw_user_meta_data->>'full_name', ''), split_part(v_user.email, '@', 1), 'Administrador');
  v_username := upper(regexp_replace(coalesce(nullif(v_user.raw_user_meta_data->>'username', ''), split_part(v_user.email, '@', 1)), '[^A-Za-z0-9._-]', '', 'g'));
  if length(v_username) < 3 then v_username := 'USR' || left(replace(v_user.id::text, '-', ''), 8); end if;

  insert into public.user_profiles(user_id, display_name, username, is_active)
  values (v_user.id, v_display_name, v_username, true);

  for v_company in select * from public.companies where is_active order by created_at, id loop
    insert into public.user_company_memberships(
      company_id, user_id, membership_role, membership_status, is_default,
      display_name_override, area, job_title, notes
    ) values (
      v_company.id, v_user.id, 'OWNER', 'ACTIVE', v_first,
      v_display_name, 'ADMINISTRACION', 'PROPIETARIO INICIAL',
      'Primer acceso creado desde invitación segura de Supabase.'
    );
    insert into public.user_route_permissions(
      company_id, user_id, route_id, can_view, can_create, can_edit,
      can_delete, can_approve, can_print, can_export, granted_by
    ) values (
      v_company.id, v_user.id, '*', true, true, true, true, true, true, true, v_user.id
    );
    v_first := false;
  end loop;
  return true;
end;
$$;

revoke all on function public.erp_claim_initial_owner() from public;
grant execute on function public.erp_claim_initial_owner() to authenticated;

-- El snapshot antiguo deja de ser fuente operativa, pero conserva catálogos,
-- parámetros y configuraciones. Solo se vacían usuarios maestros y movimientos.
create or replace function public.erp_clean_transaction_state(p_state jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_commercial jsonb := coalesce(p_state->'commercial', '{}'::jsonb);
  v_operations jsonb := coalesce(p_state->'operations', '{}'::jsonb);
  v_payroll jsonb := coalesce(p_state->'payroll', '{}'::jsonb);
begin
  v_state := v_state - 'visualUsers' - 'authAccess';
  v_state := v_state || jsonb_build_object(
    'journalEntries', '[]'::jsonb,
    'purchaseMemory', '[]'::jsonb,
    'auditLogs', '[]'::jsonb,
    'purchases', '[]'::jsonb,
    'purchasePayables', '[]'::jsonb,
    'issuedWithholdings', '[]'::jsonb,
    'payments', '[]'::jsonb,
    'paymentBatches', '[]'::jsonb,
    'bankMovements', '[]'::jsonb,
    'bankStatementMovements', '[]'::jsonb,
    'bankReconciliations', '[]'::jsonb,
    'customerReceivables', '[]'::jsonb,
    'collections', '[]'::jsonb,
    'collectionBatches', '[]'::jsonb,
    'receivedWithholdings', '[]'::jsonb,
    'inventoryMovements', '[]'::jsonb,
    'sales', '[]'::jsonb,
    'atsHistory', '[]'::jsonb,
    'providers', '[]'::jsonb,
    'customers', '[]'::jsonb
  );

  v_commercial := v_commercial || jsonb_build_object(
    'orders', '[]'::jsonb,
    'preorders', '[]'::jsonb,
    'reservations', '[]'::jsonb,
    'intercompanySettlements', '[]'::jsonb,
    'intercompanyInvoices', '[]'::jsonb,
    'intercompanyAudit', '[]'::jsonb,
    'customerCatalog', '[]'::jsonb,
    'brandCatalog', '[]'::jsonb
  );
  v_operations := v_operations || jsonb_build_object(
    'availabilityDemo', '[]'::jsonb,
    'demoReservations', '[]'::jsonb,
    'receptions', '[]'::jsonb,
    'classifierAssignments', '[]'::jsonb,
    'classificationResults', '[]'::jsonb,
    'classifications', '[]'::jsonb,
    'labelBatches', '[]'::jsonb,
    'roseInventory', '[]'::jsonb,
    'performances', '[]'::jsonb,
    'meshProcessingRecords', '[]'::jsonb,
    'processedMeshHistory', '[]'::jsonb,
    'processedMeshHistoryAudit', '[]'::jsonb,
    'receptionEditAudit', '[]'::jsonb,
    'bunchEntries', '[]'::jsonb,
    'bunchDeletionAudit', '[]'::jsonb,
    'scannerEvents', '[]'::jsonb,
    'consumptionsDemo', '[]'::jsonb,
    'kardexOperativoDemo', '[]'::jsonb,
    'dispatches', '[]'::jsonb,
    'yieldWorkdayHistory', '[]'::jsonb,
    'yieldWorkday', 'null'::jsonb
  );
  v_payroll := v_payroll || jsonb_build_object(
    'employees', '[]'::jsonb,
    'hour_entries', '[]'::jsonb,
    'performance_entries', '[]'::jsonb,
    'payroll_periods', '[]'::jsonb,
    'payrolls', '[]'::jsonb,
    'payroll_details', '[]'::jsonb,
    'payroll_runs', '[]'::jsonb,
    'payroll_items', '[]'::jsonb,
    'commission_entries', '[]'::jsonb,
    'payments', '[]'::jsonb,
    'audit_log', '[]'::jsonb
  );
  return v_state || jsonb_build_object(
    'commercial', v_commercial,
    'operations', v_operations,
    'payroll', v_payroll
  );
end;
$$;

-- Operación destructiva deliberadamente limitada a service_role y a una frase
-- de confirmación exacta. Conserva empresas, certificados, secuenciales,
-- puntos de emisión, parámetros SRI y reglas contables.
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

  delete from public.accounting_document_links;
  delete from public.journal_entry_lines;
  delete from public.journal_entries;
  delete from public.electronic_document_audit_logs;
  delete from public.sri_error_messages;
  delete from public.sri_authorizations;
  delete from public.sri_responses;
  delete from public.sri_transmission_attempts;
  delete from public.sri_transmissions;
  delete from public.electronic_document_files;
  delete from public.electronic_document_taxes;
  delete from public.electronic_document_lines;
  delete from public.electronic_documents;
  delete from public.erp_sync_field_audit;
  delete from public.erp_sync_operations;
  delete from public.erp_entity_records;
  update public.erp_company_state
  set state_json = public.erp_clean_transaction_state(state_json),
      revision = revision + 1,
      updated_by = null,
      updated_at = clock_timestamp();
  delete from public.erp_access_audit_log;
  delete from public.user_route_permissions;
  delete from public.user_company_memberships;
  delete from public.user_profiles;

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

-- La función administrativa queda disponible para una limpieza futura y
-- explícita, pero una migración nunca debe borrar usuarios ni transacciones.
-- Un proyecto nuevo ya inicia vacío; en proyectos existentes la migración
-- conserva íntegramente la información presente.

commit;
