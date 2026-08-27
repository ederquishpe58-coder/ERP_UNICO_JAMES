begin;

-- U2C3-1: exact server-side authorization metadata and Commercial/Operations wrappers.
-- The metadata is internal. It never accepts a capability supplied by the caller.
create table public.erp_u2c3_mutation_rpc_capabilities(
  rpc_name text primary key,
  resolution_strategy text not null check (resolution_strategy in ('FIXED','COMMERCIAL_ORDER_STATE','OPERATIONS_COMMAND','OFFLINE_ENTITY_ACTION','SRI_INTERACTIVE')),
  capability_id text null references public.erp_security_capabilities(capability_id),
  constraint erp_u2c3_mutation_rpc_capability_shape check (
    (resolution_strategy in ('FIXED','SRI_INTERACTIVE') and capability_id is not null)
    or (resolution_strategy not in ('FIXED','SRI_INTERACTIVE') and capability_id is null)
  )
);

create table public.erp_u2c3_operations_command_capabilities(
  command text primary key,
  resolution_strategy text not null check (resolution_strategy in ('FIXED','RECEPTION_STATE')),
  capability_id text null references public.erp_security_capabilities(capability_id),
  constraint erp_u2c3_operations_capability_shape check (
    (resolution_strategy='FIXED' and capability_id is not null)
    or (resolution_strategy='RECEPTION_STATE' and capability_id is null)
  )
);

create table public.erp_u2c3_offline_action_capabilities(
  entity text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  capability_id text not null references public.erp_security_capabilities(capability_id),
  primary key(entity,action),
  check (entity !~ '[*%]')
);

insert into public.erp_u2c3_mutation_rpc_capabilities(rpc_name,resolution_strategy,capability_id) values
  ('erp_apply_offline_operation', 'OFFLINE_ENTITY_ACTION', null),
  ('erp_reserve_commercial_order_identifiers', 'COMMERCIAL_ORDER_STATE', null),
  ('erp_save_commercial_order', 'COMMERCIAL_ORDER_STATE', null),
  ('erp_patch_commercial_order_coordination', 'FIXED', 'commercial.coordination.edit'),
  ('erp_patch_commercial_order_sri_issue_date', 'FIXED', 'commercial.electronic_documents.create'),
  ('create_electronic_document_draft', 'SRI_INTERACTIVE', 'commercial.electronic_documents.create'),
  ('erp_export_v2_create', 'FIXED', 'commercial.exports.create'),
  ('erp_export_v2_update_logistics', 'FIXED', 'commercial.exports.edit'),
  ('erp_export_v2_transition', 'FIXED', 'commercial.exports.transition'),
  ('erp_execute_operations_v2', 'OPERATIONS_COMMAND', null),
  ('erp_zebra_v2_create_labels', 'FIXED', 'operations.labels.create'),
  ('erp_zebra_v2_reprint_label', 'FIXED', 'operations.labels.reprint'),
  ('erp_zebra_v2_receive_bunch', 'FIXED', 'operations.bunch_intake.receive'),
  ('erp_destination_v2_create_labels', 'FIXED', 'operations.labels.create'),
  ('erp_destination_v2_receive_bunch', 'FIXED', 'operations.bunch_intake.receive'),
  ('erp_destination_v2_confirm_local_order', 'FIXED', 'operations.destination_orders.confirm'),
  ('erp_destination_v2_reassign_bunch', 'FIXED', 'operations.bunch_intake.reassign'),
  ('erp_warehouse_v2_reserve_order', 'FIXED', 'commercial.availability.reserve'),
  ('erp_warehouse_v2_release_order', 'FIXED', 'operations.boxes.release_order'),
  ('erp_warehouse_v2_cancel_order', 'FIXED', 'operations.boxes.cancel_order'),
  ('erp_warehouse_v2_create_box', 'FIXED', 'operations.boxes.create'),
  ('erp_warehouse_v2_scan_into_box', 'FIXED', 'operations.boxes.scan'),
  ('erp_warehouse_v2_unassign_bunch', 'FIXED', 'operations.boxes.unassign'),
  ('erp_warehouse_v2_close_box', 'FIXED', 'operations.boxes.close'),
  ('erp_warehouse_v2_reopen_box', 'FIXED', 'operations.boxes.reopen'),
  ('erp_dispatch_v2_mark_ready', 'FIXED', 'operations.cold_room.prepare'),
  ('erp_dispatch_v2_confirm', 'FIXED', 'operations.cold_room.confirm_dispatch'),
  ('erp_set_variety_image', 'FIXED', 'operations.parameters.manage'),
  ('erp_financial_v2_post_journal', 'FIXED', 'accounting.journal.post'),
  ('erp_financial_v2_post_invoice', 'FIXED', 'accounting.sales.post'),
  ('erp_financial_v2_post_credit_note', 'FIXED', 'commercial.credit_notes.post'),
  ('erp_financial_v2_record_cost', 'FIXED', 'accounting.costs.record'),
  ('erp_financial_v2_record_shipment_expense', 'FIXED', 'accounting.shipment_expenses.record'),
  ('erp_financial_v2_register_collection', 'FIXED', 'treasury.collections.create'),
  ('erp_financial_v2_reverse_journal', 'FIXED', 'accounting.journal.reverse'),
  ('erp_financial_v2_reverse_collection', 'FIXED', 'treasury.collections.reverse'),
  ('erp_supplier_v2_upsert_provider', 'FIXED', 'purchases.providers.manage'),
  ('erp_supplier_v2_post_purchase', 'FIXED', 'purchases.documents.post'),
  ('erp_supplier_v2_reverse_purchase', 'FIXED', 'purchases.documents.reverse'),
  ('erp_supplier_v2_create_settlement', 'FIXED', 'purchases.settlements.create'),
  ('erp_supplier_v2_reverse_settlement', 'FIXED', 'purchases.settlements.reverse'),
  ('erp_supplier_v2_register_payment', 'FIXED', 'treasury.payments.create'),
  ('erp_supplier_v2_reverse_payment', 'FIXED', 'treasury.payments.reverse'),
  ('erp_treasury_v2_upsert_bank_account', 'FIXED', 'treasury.accounts.manage'),
  ('erp_treasury_v2_upsert_cash_account', 'FIXED', 'treasury.cash_accounts.manage'),
  ('erp_treasury_v2_register_transaction', 'FIXED', 'treasury.movements.create'),
  ('erp_treasury_v2_import_statement', 'FIXED', 'treasury.reconciliation.import'),
  ('erp_treasury_v2_save_reconciliation', 'FIXED', 'treasury.reconciliation.save'),
  ('erp_treasury_v2_reconcile', 'FIXED', 'treasury.reconciliation.execute'),
  ('erp_treasury_v2_reverse_match', 'FIXED', 'treasury.reconciliation.reverse'),
  ('erp_treasury_v2_review_reconciliation', 'FIXED', 'treasury.reconciliation.review'),
  ('erp_treasury_v2_set_reconciliation_status', 'FIXED', 'treasury.reconciliation.set_status'),
  ('erp_treasury_v2_transfer', 'FIXED', 'treasury.transfers.create'),
  ('erp_treasury_v2_register_adjustment', 'FIXED', 'treasury.movements.adjust');

insert into public.erp_u2c3_operations_command_capabilities(command,resolution_strategy,capability_id) values
  ('SAVE_RECEPTION', 'RECEPTION_STATE', null),
  ('ASSIGN_CLASSIFICATION', 'FIXED', 'operations.classification.record'),
  ('REGISTER_CLASSIFICATION_RESULT', 'FIXED', 'operations.classification.record'),
  ('REGISTER_INVENTORY_INTAKE', 'FIXED', 'operations.bunch_intake.receive'),
  ('UPDATE_RECEPTION_STATUS', 'FIXED', 'operations.reception.edit'),
  ('UPDATE_INVENTORY_STATE', 'FIXED', 'operations.bunch_intake.reassign');

insert into public.erp_u2c3_offline_action_capabilities(entity,action,capability_id) values
  ('company_settings', 'INSERT', 'admin.company.manage'),
  ('company_settings', 'UPDATE', 'admin.company.manage'),
  ('company_settings', 'DELETE', 'admin.company.manage'),
  ('accounting_chart_accounts', 'INSERT', 'accounting.chart.manage'),
  ('accounting_chart_accounts', 'UPDATE', 'accounting.chart.manage'),
  ('accounting_chart_accounts', 'DELETE', 'accounting.chart.manage'),
  ('accounting_tax_parameters', 'INSERT', 'tax.parameters.manage'),
  ('accounting_tax_parameters', 'UPDATE', 'tax.parameters.manage'),
  ('accounting_tax_parameters', 'DELETE', 'tax.parameters.manage'),
  ('accounting_retention_parameters', 'INSERT', 'tax.retention_parameters.manage'),
  ('accounting_retention_parameters', 'UPDATE', 'tax.retention_parameters.manage'),
  ('accounting_retention_parameters', 'DELETE', 'tax.retention_parameters.manage'),
  ('accounting_tax_supports', 'INSERT', 'purchases.tax_supports.manage'),
  ('accounting_tax_supports', 'UPDATE', 'purchases.tax_supports.manage'),
  ('accounting_tax_supports', 'DELETE', 'purchases.tax_supports.manage'),
  ('accounting_purchase_types', 'INSERT', 'purchases.tax_supports.manage'),
  ('accounting_purchase_types', 'UPDATE', 'purchases.tax_supports.manage'),
  ('accounting_purchase_types', 'DELETE', 'purchases.tax_supports.manage'),
  ('accounting_purchase_memory', 'INSERT', 'purchases.documents.create'),
  ('accounting_purchase_memory', 'UPDATE', 'purchases.documents.create'),
  ('accounting_purchase_memory', 'DELETE', 'purchases.documents.reverse'),
  ('accounting_document_sequences', 'INSERT', 'admin.sequences.manage'),
  ('accounting_document_sequences', 'UPDATE', 'admin.sequences.manage'),
  ('accounting_document_sequences', 'DELETE', 'admin.sequences.manage'),
  ('accounting_cost_centers', 'INSERT', 'admin.cost_centers.manage'),
  ('accounting_cost_centers', 'UPDATE', 'admin.cost_centers.manage'),
  ('accounting_cost_centers', 'DELETE', 'admin.cost_centers.manage'),
  ('tax_ats_config', 'INSERT', 'tax.parameters.manage'),
  ('tax_ats_config', 'UPDATE', 'tax.parameters.manage'),
  ('tax_ats_config', 'DELETE', 'tax.parameters.manage'),
  ('tax_ats_history', 'INSERT', 'tax.ats.generate'),
  ('tax_ats_history', 'UPDATE', 'tax.ats.generate'),
  ('commercial_preorders', 'INSERT', 'commercial.preorders.create'),
  ('commercial_preorders', 'UPDATE', 'commercial.preorders.edit'),
  ('commercial_preorders', 'DELETE', 'commercial.preorders.cancel'),
  ('commercial_reservations', 'INSERT', 'commercial.availability.reserve'),
  ('commercial_reservations', 'UPDATE', 'commercial.availability.reserve'),
  ('commercial_reservations', 'DELETE', 'commercial.availability.release'),
  ('commercial_customers', 'INSERT', 'commercial.customers.manage'),
  ('commercial_customers', 'UPDATE', 'commercial.customers.manage'),
  ('commercial_customers', 'DELETE', 'commercial.customers.manage'),
  ('commercial_brands', 'INSERT', 'commercial.brands.manage'),
  ('commercial_brands', 'UPDATE', 'commercial.brands.manage'),
  ('commercial_brands', 'DELETE', 'commercial.brands.manage'),
  ('commercial_agencies', 'INSERT', 'commercial.cargo_agencies.manage'),
  ('commercial_agencies', 'UPDATE', 'commercial.cargo_agencies.manage'),
  ('commercial_agencies', 'DELETE', 'commercial.cargo_agencies.manage'),
  ('commercial_airlines', 'INSERT', 'commercial.airlines.manage'),
  ('commercial_airlines', 'UPDATE', 'commercial.airlines.manage'),
  ('commercial_airlines', 'DELETE', 'commercial.airlines.manage'),
  ('commercial_countries', 'INSERT', 'commercial.countries.manage'),
  ('commercial_countries', 'UPDATE', 'commercial.countries.manage'),
  ('commercial_countries', 'DELETE', 'commercial.countries.manage'),
  ('commercial_dae', 'INSERT', 'commercial.daes.manage'),
  ('commercial_dae', 'UPDATE', 'commercial.daes.manage'),
  ('commercial_dae', 'DELETE', 'commercial.daes.manage'),
  ('commercial_destinations', 'INSERT', 'commercial.cargo_agencies.manage'),
  ('commercial_destinations', 'UPDATE', 'commercial.cargo_agencies.manage'),
  ('commercial_destinations', 'DELETE', 'commercial.cargo_agencies.manage'),
  ('operations_classifications', 'INSERT', 'operations.classification.record'),
  ('operations_mesh_history_audit', 'INSERT', 'operations.classification.record'),
  ('operations_classifications', 'UPDATE', 'operations.classification.edit'),
  ('operations_mesh_history_audit', 'UPDATE', 'operations.classification.edit'),
  ('operations_suppliers', 'INSERT', 'operations.parameters.manage'),
  ('operations_suppliers', 'UPDATE', 'operations.parameters.manage'),
  ('operations_suppliers', 'DELETE', 'operations.parameters.manage'),
  ('operations_classifiers', 'INSERT', 'operations.parameters.manage'),
  ('operations_classifiers', 'UPDATE', 'operations.parameters.manage'),
  ('operations_classifiers', 'DELETE', 'operations.parameters.manage'),
  ('operations_bunchers', 'INSERT', 'operations.parameters.manage'),
  ('operations_bunchers', 'UPDATE', 'operations.parameters.manage'),
  ('operations_bunchers', 'DELETE', 'operations.parameters.manage'),
  ('operations_receptionists', 'INSERT', 'operations.parameters.manage'),
  ('operations_receptionists', 'UPDATE', 'operations.parameters.manage'),
  ('operations_receptionists', 'DELETE', 'operations.parameters.manage'),
  ('operations_digitizers', 'INSERT', 'operations.parameters.manage'),
  ('operations_digitizers', 'UPDATE', 'operations.parameters.manage'),
  ('operations_digitizers', 'DELETE', 'operations.parameters.manage'),
  ('operations_scanners', 'INSERT', 'operations.parameters.manage'),
  ('operations_scanners', 'UPDATE', 'operations.parameters.manage'),
  ('operations_scanners', 'DELETE', 'operations.parameters.manage'),
  ('operations_responsibles', 'INSERT', 'operations.parameters.manage'),
  ('operations_responsibles', 'UPDATE', 'operations.parameters.manage'),
  ('operations_responsibles', 'DELETE', 'operations.parameters.manage'),
  ('operations_varieties', 'INSERT', 'operations.parameters.manage'),
  ('operations_varieties', 'UPDATE', 'operations.parameters.manage'),
  ('operations_varieties', 'DELETE', 'operations.parameters.manage'),
  ('operations_lengths', 'INSERT', 'operations.parameters.manage'),
  ('operations_lengths', 'UPDATE', 'operations.parameters.manage'),
  ('operations_lengths', 'DELETE', 'operations.parameters.manage'),
  ('operations_stem_types', 'INSERT', 'operations.parameters.manage'),
  ('operations_stem_types', 'UPDATE', 'operations.parameters.manage'),
  ('operations_stem_types', 'DELETE', 'operations.parameters.manage'),
  ('operations_label_types', 'INSERT', 'operations.parameters.manage'),
  ('operations_label_types', 'UPDATE', 'operations.parameters.manage'),
  ('operations_label_types', 'DELETE', 'operations.parameters.manage'),
  ('accounting_journal_entries', 'INSERT', 'accounting.journal.post'),
  ('accounting_journal_entries', 'UPDATE', 'accounting.journal.post'),
  ('accounting_journal_entries', 'DELETE', 'accounting.journal.reverse'),
  ('accounting_providers', 'INSERT', 'purchases.providers.manage'),
  ('accounting_providers', 'UPDATE', 'purchases.providers.manage'),
  ('accounting_providers', 'DELETE', 'purchases.providers.manage'),
  ('purchases', 'INSERT', 'purchases.documents.create'),
  ('purchases', 'UPDATE', 'purchases.documents.create'),
  ('purchases', 'DELETE', 'purchases.documents.reverse'),
  ('issued_withholdings', 'INSERT', 'purchases.withholdings.create'),
  ('issued_withholdings', 'UPDATE', 'purchases.withholdings.create'),
  ('issued_withholdings', 'DELETE', 'purchases.withholdings.reverse'),
  ('payments', 'INSERT', 'treasury.payments.create'),
  ('payments', 'DELETE', 'treasury.payments.reverse'),
  ('bank_accounts', 'INSERT', 'treasury.accounts.manage'),
  ('bank_accounts', 'UPDATE', 'treasury.accounts.manage'),
  ('bank_accounts', 'DELETE', 'treasury.accounts.manage'),
  ('bank_movements', 'INSERT', 'treasury.movements.create'),
  ('bank_movements', 'DELETE', 'treasury.movements.reverse'),
  ('bank_statement_movements', 'INSERT', 'treasury.reconciliation.save'),
  ('bank_statement_movements', 'UPDATE', 'treasury.reconciliation.save'),
  ('bank_reconciliations', 'INSERT', 'treasury.reconciliation.save'),
  ('bank_reconciliations', 'UPDATE', 'treasury.reconciliation.save'),
  ('bank_statement_movements', 'DELETE', 'treasury.reconciliation.reverse'),
  ('bank_reconciliations', 'DELETE', 'treasury.reconciliation.reverse'),
  ('customers', 'INSERT', 'commercial.customers.manage'),
  ('customers', 'UPDATE', 'commercial.customers.manage'),
  ('customers', 'DELETE', 'commercial.customers.manage'),
  ('collections', 'INSERT', 'treasury.collections.create'),
  ('collections', 'DELETE', 'treasury.collections.reverse'),
  ('received_withholdings', 'INSERT', 'tax.received_withholdings.import'),
  ('received_withholdings', 'UPDATE', 'tax.received_withholdings.import'),
  ('material_inventory_movements', 'INSERT', 'inventory.consumptions.create'),
  ('material_inventory_movements', 'DELETE', 'inventory.consumptions.reverse'),
  ('supplier_adjustments', 'INSERT', 'purchases.settlements.create'),
  ('supplier_adjustments', 'UPDATE', 'purchases.settlements.create');

alter table public.erp_u2c3_mutation_rpc_capabilities enable row level security;
alter table public.erp_u2c3_mutation_rpc_capabilities force row level security;
alter table public.erp_u2c3_operations_command_capabilities enable row level security;
alter table public.erp_u2c3_operations_command_capabilities force row level security;
alter table public.erp_u2c3_offline_action_capabilities enable row level security;
alter table public.erp_u2c3_offline_action_capabilities force row level security;
revoke all on public.erp_u2c3_mutation_rpc_capabilities, public.erp_u2c3_operations_command_capabilities, public.erp_u2c3_offline_action_capabilities from public,anon,authenticated;
grant select on public.erp_u2c3_mutation_rpc_capabilities, public.erp_u2c3_operations_command_capabilities, public.erp_u2c3_offline_action_capabilities to service_role;

create function public.erp_u2c3_assert_mutation_capability(
  p_rpc_name text,
  p_company_id uuid,
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.erp_u2c3_mutation_rpc_capabilities%rowtype;
  v_command_rule public.erp_u2c3_operations_command_capabilities%rowtype;
  v_capability text;
  v_entity text := nullif(btrim(coalesce(p_context->>'entity','')), '');
  v_action text := upper(btrim(coalesce(p_context->>'action','')));
  v_record_id text := nullif(btrim(coalesce(p_context->>'record_id','')), '');
  v_command text := upper(btrim(coalesce(p_context->>'command','')));
  v_payload jsonb := coalesce(p_context->'payload','{}'::jsonb);
  v_exists boolean := false;
begin
  select * into v_rule from public.erp_u2c3_mutation_rpc_capabilities where rpc_name=p_rpc_name;
  if not found then
    raise exception using errcode='42501',message='U2C3_MUTATION_RPC_UNMAPPED';
  end if;

  if v_rule.resolution_strategy in ('FIXED','SRI_INTERACTIVE') then
    v_capability := v_rule.capability_id;
  elsif v_rule.resolution_strategy='COMMERCIAL_ORDER_STATE' then
    if v_record_id is null then raise exception using errcode='22023',message='U2C3_COMMERCIAL_RECORD_REQUIRED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':U2C3:COMMERCIAL_ORDER:'||v_record_id,0));
    select exists(select 1 from public.erp_entity_records r where r.company_id=p_company_id and r.entity='commercial_orders' and r.record_id=v_record_id and r.deleted_at is null) into v_exists;
    v_capability := case when v_exists then 'commercial.orders.edit' else 'commercial.orders.create' end;
  elsif v_rule.resolution_strategy='OPERATIONS_COMMAND' then
    select * into v_command_rule from public.erp_u2c3_operations_command_capabilities where command=v_command;
    if not found then raise exception using errcode='42501',message='U2C3_OPERATIONS_COMMAND_UNMAPPED'; end if;
    if v_command_rule.resolution_strategy='RECEPTION_STATE' then
      v_record_id := nullif(btrim(coalesce(v_payload->>'receptionId','')), '');
      if v_record_id is null then raise exception using errcode='22023',message='U2C3_RECEPTION_RECORD_REQUIRED'; end if;
      perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':U2C3:RECEPTION:'||v_record_id,0));
      select exists(select 1 from public.erp_entity_records r where r.company_id=p_company_id and r.entity='operations_receptions' and r.record_id=v_record_id and r.deleted_at is null) into v_exists;
      v_capability := case when v_exists then 'operations.reception.edit' else 'operations.reception.create' end;
    else
      v_capability := v_command_rule.capability_id;
    end if;
  elsif v_rule.resolution_strategy='OFFLINE_ENTITY_ACTION' then
    if v_entity is null or v_record_id is null or v_action not in ('INSERT','UPDATE','DELETE') then
      raise exception using errcode='42501',message='U2C3_OFFLINE_ACTION_UNMAPPED';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':U2C3:OFFLINE:'||v_entity||':'||v_record_id,0));
    if v_entity='commercial_orders' and v_action in ('INSERT','UPDATE') then
      select exists(select 1 from public.erp_entity_records r where r.company_id=p_company_id and r.entity=v_entity and r.record_id=v_record_id and r.deleted_at is null) into v_exists;
      v_capability := case when v_exists then 'commercial.orders.edit' else 'commercial.orders.create' end;
    elsif v_entity='commercial_orders' and v_action='DELETE' then
      v_capability := 'commercial.orders.cancel';
    else
      select capability_id into v_capability from public.erp_u2c3_offline_action_capabilities where entity=v_entity and action=v_action;
    end if;
  end if;

  if v_capability is null then
    raise exception using errcode='42501',message='U2C3_MUTATION_ACTION_UNMAPPED';
  end if;
  perform public.erp_security_assert_capability(p_company_id,v_capability);
end;
$$;

revoke all on function public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb) from public,anon,authenticated,service_role;
comment on function public.erp_u2c3_assert_mutation_capability(text,uuid,jsonb) is
  'Internal U2C3 fail-closed dispatcher. Actor and effective grants are resolved only by erp_security_assert_capability.';

do $$ begin
  if (select count(*) from public.erp_u2c3_mutation_rpc_capabilities)<>54 then raise exception 'U2C3_CRITICAL_RPC_MAP_COUNT'; end if;
  if (select count(*) from public.erp_u2c3_operations_command_capabilities)<>6 then raise exception 'U2C3_OPERATIONS_COMMAND_MAP_COUNT'; end if;
  if exists(select 1 from public.erp_u2c3_mutation_rpc_capabilities where position('*' in rpc_name)>0 or position('%' in rpc_name)>0) then raise exception 'U2C3_RPC_WILDCARD'; end if;
  if exists(select 1 from public.erp_u2c3_offline_action_capabilities where position('*' in entity)>0 or position('%' in entity)>0) then raise exception 'U2C3_OFFLINE_WILDCARD'; end if;
end $$;


alter function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) rename to erp_apply_offline_operation_u2c3_internal;
revoke all on function public.erp_apply_offline_operation_u2c3_internal(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_apply_offline_operation(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_entity text,
  p_action text,
  p_record_id text,
  p_payload jsonb,
  p_base_payload jsonb,
  p_field_changes jsonb,
  p_base_version bigint,
  p_local_created_at timestamptz
)
returns table(
  operation_id uuid,
  status text,
  result_version bigint,
  server_time timestamptz,
  last_error text,
  conflict boolean,
  conflict_details jsonb,
  server_record jsonb,
  discarded_fields jsonb,
  merge_summary jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_apply_offline_operation', p_company_id, jsonb_build_object('entity',p_entity,'action',p_action,'record_id',p_record_id)
  );
  return query select * from public.erp_apply_offline_operation_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_entity, p_action, p_record_id, p_payload, p_base_payload, p_field_changes, p_base_version, p_local_created_at);
end;
$$;

revoke all on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) from public, anon, service_role;
grant execute on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) to authenticated;
comment on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_reserve_commercial_order_identifiers(uuid,text,integer,text,text,text) rename to erp_reserve_commercial_order_identifiers_u2c3_internal;
revoke all on function public.erp_reserve_commercial_order_identifiers_u2c3_internal(uuid,text,integer,text,text,text) from public, anon, authenticated, service_role;

create function public.erp_reserve_commercial_order_identifiers(
  p_company_id uuid,
  p_record_id text,
  p_order_year integer,
  p_establishment_code text,
  p_emission_point_code text,
  p_document_type text default '01'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_reserve_commercial_order_identifiers', p_company_id, jsonb_build_object('record_id',p_record_id)
  );
  return public.erp_reserve_commercial_order_identifiers_u2c3_internal(p_company_id, p_record_id, p_order_year, p_establishment_code, p_emission_point_code, p_document_type);
end;
$$;

revoke all on function public.erp_reserve_commercial_order_identifiers(uuid,text,integer,text,text,text) from public, anon, service_role;
grant execute on function public.erp_reserve_commercial_order_identifiers(uuid,text,integer,text,text,text) to authenticated;
comment on function public.erp_reserve_commercial_order_identifiers(uuid,text,integer,text,text,text) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_save_commercial_order(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) rename to erp_save_commercial_order_u2c3_internal;
revoke all on function public.erp_save_commercial_order_u2c3_internal(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_save_commercial_order(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_record_id text,
  p_order_year integer,
  p_establishment_code text,
  p_emission_point_code text,
  p_payload jsonb,
  p_base_payload jsonb default '{}'::jsonb,
  p_field_changes jsonb default '[]'::jsonb,
  p_base_version bigint default 0,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_save_commercial_order', p_company_id, jsonb_build_object('record_id',p_record_id)
  );
  return public.erp_save_commercial_order_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_record_id, p_order_year, p_establishment_code, p_emission_point_code, p_payload, p_base_payload, p_field_changes, p_base_version, p_local_created_at);
end;
$$;

revoke all on function public.erp_save_commercial_order(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) from public, anon, service_role;
grant execute on function public.erp_save_commercial_order(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) to authenticated;
comment on function public.erp_save_commercial_order(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) rename to erp_patch_commercial_order_coordination_u2c3_internal;
revoke all on function public.erp_patch_commercial_order_coordination_u2c3_internal(uuid,uuid,text,text,bigint,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_patch_commercial_order_coordination(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_record_id text,
  p_expected_version bigint,
  p_patch jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_patch_commercial_order_coordination', p_company_id, '{}'::jsonb
  );
  return public.erp_patch_commercial_order_coordination_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_record_id, p_expected_version, p_patch, p_local_created_at);
end;
$$;

revoke all on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) to authenticated;
comment on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_patch_commercial_order_sri_issue_date(uuid,uuid,text,text,uuid,bigint,date,timestamptz) rename to erp_patch_commercial_order_sri_issue_date_u2c3_internal;
revoke all on function public.erp_patch_commercial_order_sri_issue_date_u2c3_internal(uuid,uuid,text,text,uuid,bigint,date,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_patch_commercial_order_sri_issue_date(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_record_id text,
  p_document_id uuid,
  p_expected_version bigint,
  p_issue_date date,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_patch_commercial_order_sri_issue_date', p_company_id, '{}'::jsonb
  );
  return public.erp_patch_commercial_order_sri_issue_date_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_record_id, p_document_id, p_expected_version, p_issue_date, p_local_created_at);
end;
$$;

revoke all on function public.erp_patch_commercial_order_sri_issue_date(uuid,uuid,text,text,uuid,bigint,date,timestamptz) from public, anon, service_role;
grant execute on function public.erp_patch_commercial_order_sri_issue_date(uuid,uuid,text,text,uuid,bigint,date,timestamptz) to authenticated;
comment on function public.erp_patch_commercial_order_sri_issue_date(uuid,uuid,text,text,uuid,bigint,date,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_export_v2_create(uuid,uuid,text,text[],uuid[],text[],timestamptz) rename to erp_export_v2_create_u2c3_internal;
revoke all on function public.erp_export_v2_create_u2c3_internal(uuid,uuid,text,text[],uuid[],text[],timestamptz) from public, anon, authenticated, service_role;

create function public.erp_export_v2_create(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_ids text[],
  p_dispatch_ids uuid[],
  p_required_document_types text[] default '{}'::text[],
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_export_v2_create', p_company_id, '{}'::jsonb
  );
  return public.erp_export_v2_create_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_ids, p_dispatch_ids, p_required_document_types, p_local_created_at);
end;
$$;

revoke all on function public.erp_export_v2_create(uuid,uuid,text,text[],uuid[],text[],timestamptz) from public, anon, service_role;
grant execute on function public.erp_export_v2_create(uuid,uuid,text,text[],uuid[],text[],timestamptz) to authenticated;
comment on function public.erp_export_v2_create(uuid,uuid,text,text[],uuid[],text[],timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) rename to erp_export_v2_update_logistics_u2c3_internal;
revoke all on function public.erp_export_v2_update_logistics_u2c3_internal(uuid,uuid,text,uuid,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_export_v2_update_logistics(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_shipment_id uuid,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_export_v2_update_logistics', p_company_id, '{}'::jsonb
  );
  return public.erp_export_v2_update_logistics_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_shipment_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) to authenticated;
comment on function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_export_v2_transition(uuid,uuid,text,uuid,text,jsonb,timestamptz) rename to erp_export_v2_transition_u2c3_internal;
revoke all on function public.erp_export_v2_transition_u2c3_internal(uuid,uuid,text,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_export_v2_transition(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_shipment_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_export_v2_transition', p_company_id, jsonb_build_object('action',p_action)
  );
  return public.erp_export_v2_transition_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_shipment_id, p_action, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_export_v2_transition(uuid,uuid,text,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_export_v2_transition(uuid,uuid,text,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_export_v2_transition(uuid,uuid,text,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) rename to erp_execute_operations_v2_u2c3_internal;
revoke all on function public.erp_execute_operations_v2_u2c3_internal(uuid,uuid,text,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_execute_operations_v2(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_command text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_execute_operations_v2', p_company_id, jsonb_build_object('command',p_command,'payload',coalesce(p_payload,'{}'::jsonb))
  );
  return public.erp_execute_operations_v2_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_command, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz) rename to erp_zebra_v2_create_labels_u2c3_internal;
revoke all on function public.erp_zebra_v2_create_labels_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_zebra_v2_create_labels(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_labels jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_zebra_v2_create_labels', p_company_id, '{}'::jsonb
  );
  return public.erp_zebra_v2_create_labels_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_labels, p_local_created_at);
end;
$$;

revoke all on function public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_zebra_v2_reprint_label(uuid,uuid,text,text,text,timestamptz) rename to erp_zebra_v2_reprint_label_u2c3_internal;
revoke all on function public.erp_zebra_v2_reprint_label_u2c3_internal(uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_zebra_v2_reprint_label(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_output_type text default 'ZEBRA',
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_zebra_v2_reprint_label', p_company_id, '{}'::jsonb
  );
  return public.erp_zebra_v2_reprint_label_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_label_code, p_output_type, p_local_created_at);
end;
$$;

revoke all on function public.erp_zebra_v2_reprint_label(uuid,uuid,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_zebra_v2_reprint_label(uuid,uuid,text,text,text,timestamptz) to authenticated;
comment on function public.erp_zebra_v2_reprint_label(uuid,uuid,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) rename to erp_zebra_v2_receive_bunch_u2c3_internal;
revoke all on function public.erp_zebra_v2_receive_bunch_u2c3_internal(uuid,uuid,text,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_zebra_v2_receive_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_payload jsonb default '{}'::jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_zebra_v2_receive_bunch', p_company_id, '{}'::jsonb
  );
  return public.erp_zebra_v2_receive_bunch_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_label_code, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_destination_v2_create_labels(uuid,uuid,text,jsonb,text,text,text,timestamptz) rename to erp_destination_v2_create_labels_u2c3_internal;
revoke all on function public.erp_destination_v2_create_labels_u2c3_internal(uuid,uuid,text,jsonb,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_destination_v2_create_labels(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_labels jsonb,
  p_destination_type text default 'EXPORT',
  p_destination_customer_id text default null,
  p_destination_order_id text default null,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_destination_v2_create_labels', p_company_id, '{}'::jsonb
  );
  return public.erp_destination_v2_create_labels_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_labels, p_destination_type, p_destination_customer_id, p_destination_order_id, p_local_created_at);
end;
$$;

revoke all on function public.erp_destination_v2_create_labels(uuid,uuid,text,jsonb,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_destination_v2_create_labels(uuid,uuid,text,jsonb,text,text,text,timestamptz) to authenticated;
comment on function public.erp_destination_v2_create_labels(uuid,uuid,text,jsonb,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) rename to erp_destination_v2_receive_bunch_u2c3_internal;
revoke all on function public.erp_destination_v2_receive_bunch_u2c3_internal(uuid,uuid,text,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_destination_v2_receive_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_payload jsonb default '{}'::jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_destination_v2_receive_bunch', p_company_id, '{}'::jsonb
  );
  return public.erp_destination_v2_receive_bunch_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_label_code, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_destination_v2_confirm_local_order(uuid,uuid,text,text,timestamptz) rename to erp_destination_v2_confirm_local_order_u2c3_internal;
revoke all on function public.erp_destination_v2_confirm_local_order_u2c3_internal(uuid,uuid,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_destination_v2_confirm_local_order(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_destination_v2_confirm_local_order', p_company_id, '{}'::jsonb
  );
  return public.erp_destination_v2_confirm_local_order_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_local_created_at);
end;
$$;

revoke all on function public.erp_destination_v2_confirm_local_order(uuid,uuid,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_destination_v2_confirm_local_order(uuid,uuid,text,text,timestamptz) to authenticated;
comment on function public.erp_destination_v2_confirm_local_order(uuid,uuid,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_destination_v2_reassign_bunch(uuid,uuid,text,text,text,text,text,timestamptz) rename to erp_destination_v2_reassign_bunch_u2c3_internal;
revoke all on function public.erp_destination_v2_reassign_bunch_u2c3_internal(uuid,uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_destination_v2_reassign_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_target_destination_type text,
  p_target_customer_id text default null,
  p_reason text default null,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_destination_v2_reassign_bunch', p_company_id, '{}'::jsonb
  );
  return public.erp_destination_v2_reassign_bunch_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_label_code, p_target_destination_type, p_target_customer_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_destination_v2_reassign_bunch(uuid,uuid,text,text,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_destination_v2_reassign_bunch(uuid,uuid,text,text,text,text,text,timestamptz) to authenticated;
comment on function public.erp_destination_v2_reassign_bunch(uuid,uuid,text,text,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz) rename to erp_warehouse_v2_reserve_order_u2c3_internal;
revoke all on function public.erp_warehouse_v2_reserve_order_u2c3_internal(uuid,uuid,text,text,boolean,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_reserve_order(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_allow_partial boolean default true,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_reserve_order', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_reserve_order_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_allow_partial, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_release_order(uuid,uuid,text,text,text,timestamptz) rename to erp_warehouse_v2_release_order_u2c3_internal;
revoke all on function public.erp_warehouse_v2_release_order_u2c3_internal(uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_release_order(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_release_order', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_release_order_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_release_order(uuid,uuid,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_release_order(uuid,uuid,text,text,text,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_release_order(uuid,uuid,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_cancel_order(uuid,uuid,text,text,text,timestamptz) rename to erp_warehouse_v2_cancel_order_u2c3_internal;
revoke all on function public.erp_warehouse_v2_cancel_order_u2c3_internal(uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_cancel_order(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_cancel_order', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_cancel_order_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_cancel_order(uuid,uuid,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_cancel_order(uuid,uuid,text,text,text,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_cancel_order(uuid,uuid,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_create_box(uuid,uuid,text,text,integer,text,integer,timestamptz) rename to erp_warehouse_v2_create_box_u2c3_internal;
revoke all on function public.erp_warehouse_v2_create_box_u2c3_internal(uuid,uuid,text,text,integer,text,integer,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_create_box(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_box_number integer,
  p_box_type text,
  p_capacity_bunches integer,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_create_box', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_create_box_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_box_number, p_box_type, p_capacity_bunches, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_create_box(uuid,uuid,text,text,integer,text,integer,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_create_box(uuid,uuid,text,text,integer,text,integer,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_create_box(uuid,uuid,text,text,integer,text,integer,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz) rename to erp_warehouse_v2_scan_into_box_u2c3_internal;
revoke all on function public.erp_warehouse_v2_scan_into_box_u2c3_internal(uuid,uuid,text,text,integer,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_scan_into_box(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_box_number integer,
  p_label_code text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_scan_into_box', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_scan_into_box_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_box_number, p_label_code, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_unassign_bunch(uuid,uuid,text,text,text,text,timestamptz) rename to erp_warehouse_v2_unassign_bunch_u2c3_internal;
revoke all on function public.erp_warehouse_v2_unassign_bunch_u2c3_internal(uuid,uuid,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_unassign_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_label_code text,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_unassign_bunch', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_unassign_bunch_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_label_code, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_unassign_bunch(uuid,uuid,text,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_unassign_bunch(uuid,uuid,text,text,text,text,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_unassign_bunch(uuid,uuid,text,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_close_box(uuid,uuid,text,text,integer,timestamptz) rename to erp_warehouse_v2_close_box_u2c3_internal;
revoke all on function public.erp_warehouse_v2_close_box_u2c3_internal(uuid,uuid,text,text,integer,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_close_box(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_box_number integer,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_close_box', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_close_box_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_box_number, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_close_box(uuid,uuid,text,text,integer,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_close_box(uuid,uuid,text,text,integer,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_close_box(uuid,uuid,text,text,integer,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_warehouse_v2_reopen_box(uuid,uuid,text,text,integer,text,timestamptz) rename to erp_warehouse_v2_reopen_box_u2c3_internal;
revoke all on function public.erp_warehouse_v2_reopen_box_u2c3_internal(uuid,uuid,text,text,integer,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_reopen_box(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_box_number integer,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_warehouse_v2_reopen_box', p_company_id, '{}'::jsonb
  );
  return public.erp_warehouse_v2_reopen_box_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_box_number, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_warehouse_v2_reopen_box(uuid,uuid,text,text,integer,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_reopen_box(uuid,uuid,text,text,integer,text,timestamptz) to authenticated;
comment on function public.erp_warehouse_v2_reopen_box(uuid,uuid,text,text,integer,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_dispatch_v2_mark_ready(uuid,uuid,text,text,timestamptz) rename to erp_dispatch_v2_mark_ready_u2c3_internal;
revoke all on function public.erp_dispatch_v2_mark_ready_u2c3_internal(uuid,uuid,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_dispatch_v2_mark_ready(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_dispatch_v2_mark_ready', p_company_id, '{}'::jsonb
  );
  return public.erp_dispatch_v2_mark_ready_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_local_created_at);
end;
$$;

revoke all on function public.erp_dispatch_v2_mark_ready(uuid,uuid,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_dispatch_v2_mark_ready(uuid,uuid,text,text,timestamptz) to authenticated;
comment on function public.erp_dispatch_v2_mark_ready(uuid,uuid,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) rename to erp_dispatch_v2_confirm_u2c3_internal;
revoke all on function public.erp_dispatch_v2_confirm_u2c3_internal(uuid,uuid,text,text,jsonb,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_dispatch_v2_confirm(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_logistics jsonb default '{}'::jsonb,
  p_observations text default '',
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_dispatch_v2_confirm', p_company_id, '{}'::jsonb
  );
  return public.erp_dispatch_v2_confirm_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_order_id, p_logistics, p_observations, p_local_created_at);
end;
$$;

revoke all on function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) to authenticated;
comment on function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz) rename to erp_set_variety_image_u2c3_internal;
revoke all on function public.erp_set_variety_image_u2c3_internal(uuid,text,text,uuid,text,bigint,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_set_variety_image(
  p_company_id uuid,
  p_variety_id text,
  p_image_path text,
  p_operation_id uuid,
  p_device_id text,
  p_expected_version bigint,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_set_variety_image', p_company_id, '{}'::jsonb
  );
  return public.erp_set_variety_image_u2c3_internal(p_company_id, p_variety_id, p_image_path, p_operation_id, p_device_id, p_expected_version, p_local_created_at);
end;
$$;

revoke all on function public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz) from public, anon, service_role;
grant execute on function public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz) to authenticated;
comment on function public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


-- Composite RPCs own one business authorization decision. Their already
-- authorized implementation calls private child implementations so a user is
-- not required to hold unrelated child capabilities for one atomic command.
do $$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.erp_save_commercial_order_u2c3_internal(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz)'::regprocedure);
  v_definition:=replace(v_definition,'public.erp_reserve_commercial_order_identifiers(','public.erp_reserve_commercial_order_identifiers_u2c3_internal(');
  v_definition:=replace(v_definition,'public.erp_apply_offline_operation(','public.erp_apply_offline_operation_u2c3_internal(');
  execute v_definition;

  v_definition:=pg_get_functiondef('public.erp_destination_v2_create_labels_u2c3_internal(uuid,uuid,text,jsonb,text,text,text,timestamptz)'::regprocedure);
  v_definition:=replace(v_definition,'public.erp_zebra_v2_create_labels(','public.erp_zebra_v2_create_labels_u2c3_internal(');
  execute v_definition;

  v_definition:=pg_get_functiondef('public.erp_destination_v2_receive_bunch_u2c3_internal(uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure);
  v_definition:=replace(v_definition,'public.erp_zebra_v2_receive_bunch(','public.erp_zebra_v2_receive_bunch_u2c3_internal(');
  v_definition:=replace(v_definition,'public.erp_warehouse_v2_reserve_order(','public.erp_warehouse_v2_reserve_order_u2c3_internal(');
  v_definition:=replace(v_definition,'public.erp_warehouse_v2_scan_into_box(','public.erp_warehouse_v2_scan_into_box_u2c3_internal(');
  execute v_definition;

  v_definition:=pg_get_functiondef('public.erp_destination_v2_confirm_local_order_u2c3_internal(uuid,uuid,text,text,timestamptz)'::regprocedure);
  v_definition:=replace(v_definition,'public.erp_warehouse_v2_reserve_order(','public.erp_warehouse_v2_reserve_order_u2c3_internal(');
  v_definition:=replace(v_definition,'public.erp_warehouse_v2_scan_into_box(','public.erp_warehouse_v2_scan_into_box_u2c3_internal(');
  execute v_definition;
end $$;


alter function public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)
  rename to create_electronic_document_draft_u2c3_internal;
revoke all on function public.create_electronic_document_draft_u2c3_internal(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.create_electronic_document_draft(
  p_company_id uuid,
  p_emission_point_id uuid,
  p_document_type text,
  p_issue_date date,
  p_numeric_code text,
  p_xml_version text,
  p_xsd_version text,
  p_issuer_snapshot jsonb,
  p_buyer_snapshot jsonb,
  p_source_snapshot jsonb,
  p_source_order_id uuid,
  p_source_packing_id uuid,
  p_customer_id uuid,
  p_parent_document_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  -- Interactive actors require the functional capability. The explicit SRI
  -- service contract remains inside the U2A wrapper and is not converted into
  -- an implicit service_role capability bypass.
  if auth.uid() is not null then
    perform public.erp_u2c3_assert_mutation_capability(
      'create_electronic_document_draft',p_company_id,'{}'::jsonb
    );
  end if;
  return public.create_electronic_document_draft_u2c3_internal(
    p_company_id,p_emission_point_id,p_document_type,p_issue_date,p_numeric_code,
    p_xml_version,p_xsd_version,p_issuer_snapshot,p_buyer_snapshot,p_source_snapshot,
    p_source_order_id,p_source_packing_id,p_customer_id,p_parent_document_id,p_created_by
  );
end;
$$;
revoke all on function public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) to authenticated,service_role;
comment on function public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) is
  'U2C3 capability + U2A actor/SRI-membership guard for interactive calls; explicit verified SRI service contract preserved.';

notify pgrst,'reload schema';
commit;
