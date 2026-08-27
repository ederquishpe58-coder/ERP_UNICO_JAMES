begin;

-- U2C3-3: capability-protected read RPCs and targeted direct-read boundaries.
create table public.erp_u2c3_read_rpc_capabilities(
  rpc_name text primary key,
  capability_id text not null references public.erp_security_capabilities(capability_id),
  created_at timestamptz not null default now(),
  constraint erp_u2c3_read_rpc_exact check(position('*' in rpc_name)=0 and position('%' in rpc_name)=0)
);
alter table public.erp_u2c3_read_rpc_capabilities enable row level security;
alter table public.erp_u2c3_read_rpc_capabilities force row level security;
revoke all on table public.erp_u2c3_read_rpc_capabilities from public, anon, authenticated;
grant select on table public.erp_u2c3_read_rpc_capabilities to service_role;

insert into public.erp_u2c3_read_rpc_capabilities(rpc_name,capability_id) values
  ('erp_list_commercial_order_history', 'commercial.orders.view'),
  ('erp_commercial_v2_list_sales_representatives', 'commercial.orders.view'),
  ('erp_operations_v2_list_classification_deliveries', 'operations.classification.view'),
  ('erp_operations_v2_list_reception_lines', 'operations.reception.view'),
  ('erp_operations_v2_supplier_inventory_report', 'operations.inventory.view'),
  ('erp_destination_v2_availability', 'operations.availability.view'),
  ('erp_zebra_v2_availability', 'operations.availability.view'),
  ('erp_warehouse_v2_availability', 'operations.availability.view'),
  ('erp_dispatch_v2_validate_ready', 'operations.cold_room.view'),
  ('erp_accounting_journal_page', 'accounting.journal.view'),
  ('erp_accounting_journal_detail', 'accounting.journal.view'),
  ('erp_accounting_ledger_page', 'accounting.ledger.view'),
  ('erp_accounting_trial_balance', 'accounting.financial_statements.view'),
  ('erp_accounting_balance_sheet', 'accounting.financial_statements.view'),
  ('erp_accounting_income_statement', 'accounting.financial_statements.view'),
  ('erp_accounting_dashboard_summary', 'reports.dashboard.view'),
  ('erp_accounting_portfolio_report_page', 'reports.portfolio.view'),
  ('erp_accounting_bank_report_page', 'reports.banks.view'),
  ('erp_supplier_payable_read_rows', 'portfolio.payables.view'),
  ('erp_supplier_payables_open_page', 'portfolio.payables.view'),
  ('erp_supplier_payables_history_page', 'portfolio.payables.view'),
  ('erp_supplier_payable_detail', 'portfolio.payables.view'),
  ('erp_supplier_payments_history_page', 'treasury.payments.view'),
  ('erp_supplier_payment_detail', 'treasury.payments.view'),
  ('erp_customer_receivable_read_rows', 'portfolio.receivables.view'),
  ('erp_customer_receivables_open_page', 'portfolio.receivables.view'),
  ('erp_customer_receivables_history_page', 'portfolio.receivables.view'),
  ('erp_customer_receivable_detail', 'portfolio.receivables.view'),
  ('erp_customer_collections_history_page', 'treasury.collections.view'),
  ('erp_customer_collection_detail', 'treasury.collections.view'),
  ('erp_purchase_invoice_read_rows', 'purchases.documents.view'),
  ('erp_purchase_invoices_history_page', 'purchases.documents.view'),
  ('erp_purchase_invoice_detail', 'purchases.documents.view'),
  ('erp_purchase_invoice_xml', 'purchases.documents.view'),
  ('erp_purchase_withholding_v2_pending_page', 'purchases.withholdings.view'),
  ('erp_purchase_withholding_v2_history_page', 'purchases.withholdings.view'),
  ('erp_purchase_withholding_v2_detail', 'purchases.withholdings.view'),
  ('erp_received_withholding_read_rows', 'tax.received_withholdings.view'),
  ('erp_received_withholding_page', 'tax.received_withholdings.view'),
  ('erp_received_withholding_detail', 'tax.received_withholdings.view'),
  ('erp_received_withholding_receivable_lookup', 'tax.received_withholdings.view'),
  ('erp_retention_report_rows', 'purchases.retention_report.view'),
  ('erp_retention_report_page', 'purchases.retention_report.view'),
  ('erp_retention_report_legacy_detail', 'purchases.retention_report.view'),
  ('erp_supplier_settlement_candidates', 'purchases.settlements.view'),
  ('erp_supplier_settlement_history_page', 'purchases.settlements.view'),
  ('erp_supplier_settlement_detail', 'purchases.settlements.view'),
  ('erp_treasury_movements_page', 'treasury.movements.view'),
  ('erp_treasury_reconciliation_history_page', 'treasury.reconciliation.view'),
  ('erp_treasury_reconciliation_workspace', 'treasury.reconciliation.view'),
  ('erp_treasury_reconciliation_detail', 'treasury.reconciliation.view'),
  ('erp_treasury_transfers_history_page', 'treasury.transfers.view'),
  ('erp_treasury_transfer_detail', 'treasury.transfers.view');

create table public.erp_u2c3_entity_read_capabilities(
  entity text not null,
  capability_id text not null references public.erp_security_capabilities(capability_id),
  created_at timestamptz not null default now(),
  primary key(entity,capability_id),
  constraint erp_u2c3_entity_exact check(position('*' in entity)=0 and position('%' in entity)=0)
);
alter table public.erp_u2c3_entity_read_capabilities enable row level security;
alter table public.erp_u2c3_entity_read_capabilities force row level security;
revoke all on table public.erp_u2c3_entity_read_capabilities from public, anon, authenticated;
grant select on table public.erp_u2c3_entity_read_capabilities to service_role;

insert into public.erp_u2c3_entity_read_capabilities(entity,capability_id) values
  ('company_settings', 'core.dashboard.view'),
  ('company_settings', 'admin.company.view'),
  ('accounting_chart_accounts', 'accounting.chart.view'),
  ('accounting_chart_accounts', 'purchases.documents.view'),
  ('accounting_chart_accounts', 'treasury.accounts.view'),
  ('accounting_chart_accounts', 'payroll.accounting_settings.view'),
  ('accounting_tax_parameters', 'tax.parameters.view'),
  ('accounting_tax_parameters', 'purchases.documents.view'),
  ('accounting_tax_parameters', 'purchases.withholdings.view'),
  ('accounting_tax_parameters', 'tax.ats.view'),
  ('accounting_retention_parameters', 'tax.retention_parameters.view'),
  ('accounting_retention_parameters', 'purchases.withholdings.view'),
  ('accounting_tax_supports', 'purchases.documents.view'),
  ('accounting_purchase_types', 'purchases.documents.view'),
  ('accounting_purchase_memory', 'purchases.documents.view'),
  ('accounting_document_sequences', 'admin.sequences.view'),
  ('accounting_document_sequences', 'commercial.orders.view'),
  ('accounting_document_sequences', 'purchases.documents.view'),
  ('accounting_document_sequences', 'commercial.electronic_documents.view'),
  ('accounting_cost_centers', 'admin.cost_centers.view'),
  ('accounting_cost_centers', 'accounting.chart.view'),
  ('accounting_cost_centers', 'accounting.journal.view'),
  ('accounting_cost_centers', 'payroll.accounting_settings.view'),
  ('tax_ats_config', 'tax.ats.view'),
  ('tax_ats_history', 'tax.ats.view'),
  ('commercial_orders', 'commercial.orders.view'),
  ('commercial_preorders', 'commercial.preorders.view'),
  ('commercial_reservations', 'commercial.availability.view'),
  ('commercial_order_reservations', 'commercial.availability.view'),
  ('commercial_customers', 'commercial.customers.view'),
  ('commercial_customers', 'portfolio.customers.view'),
  ('customers', 'commercial.customers.view'),
  ('customers', 'portfolio.customers.view'),
  ('commercial_brands', 'commercial.brands.view'),
  ('commercial_agencies', 'commercial.cargo_agencies.view'),
  ('commercial_destinations', 'commercial.cargo_agencies.view'),
  ('commercial_airlines', 'commercial.airlines.view'),
  ('commercial_countries', 'commercial.countries.view'),
  ('commercial_dae', 'commercial.daes.view'),
  ('commercial_export_shipments', 'commercial.exports.view'),
  ('commercial_export_shipment_documents', 'commercial.exports.view'),
  ('commercial_export_shipment_flights', 'commercial.exports.view'),
  ('commercial_export_shipment_events', 'commercial.exports.view'),
  ('sales', 'commercial.orders.view'),
  ('sales', 'accounting.sales.view'),
  ('operations_suppliers', 'operations.parameters.view'),
  ('operations_suppliers', 'operations.reception.view'),
  ('operations_suppliers', 'operations.classification.view'),
  ('operations_suppliers', 'operations.labels.view'),
  ('operations_suppliers', 'operations.bunch_intake.view'),
  ('operations_suppliers', 'operations.inventory.view'),
  ('operations_suppliers', 'operations.availability.view'),
  ('operations_suppliers', 'operations.cold_room.view'),
  ('operations_classifiers', 'operations.parameters.view'),
  ('operations_classifiers', 'operations.reception.view'),
  ('operations_classifiers', 'operations.classification.view'),
  ('operations_classifiers', 'operations.labels.view'),
  ('operations_classifiers', 'operations.bunch_intake.view'),
  ('operations_classifiers', 'operations.inventory.view'),
  ('operations_classifiers', 'operations.availability.view'),
  ('operations_classifiers', 'operations.cold_room.view'),
  ('operations_bunchers', 'operations.parameters.view'),
  ('operations_bunchers', 'operations.reception.view'),
  ('operations_bunchers', 'operations.classification.view'),
  ('operations_bunchers', 'operations.labels.view'),
  ('operations_bunchers', 'operations.bunch_intake.view'),
  ('operations_bunchers', 'operations.inventory.view'),
  ('operations_bunchers', 'operations.availability.view'),
  ('operations_bunchers', 'operations.cold_room.view'),
  ('operations_receptionists', 'operations.parameters.view'),
  ('operations_receptionists', 'operations.reception.view'),
  ('operations_receptionists', 'operations.classification.view'),
  ('operations_receptionists', 'operations.labels.view'),
  ('operations_receptionists', 'operations.bunch_intake.view'),
  ('operations_receptionists', 'operations.inventory.view'),
  ('operations_receptionists', 'operations.availability.view'),
  ('operations_receptionists', 'operations.cold_room.view'),
  ('operations_digitizers', 'operations.parameters.view'),
  ('operations_digitizers', 'operations.reception.view'),
  ('operations_digitizers', 'operations.classification.view'),
  ('operations_digitizers', 'operations.labels.view'),
  ('operations_digitizers', 'operations.bunch_intake.view'),
  ('operations_digitizers', 'operations.inventory.view'),
  ('operations_digitizers', 'operations.availability.view'),
  ('operations_digitizers', 'operations.cold_room.view'),
  ('operations_scanners', 'operations.parameters.view'),
  ('operations_scanners', 'operations.reception.view'),
  ('operations_scanners', 'operations.classification.view'),
  ('operations_scanners', 'operations.labels.view'),
  ('operations_scanners', 'operations.bunch_intake.view'),
  ('operations_scanners', 'operations.inventory.view'),
  ('operations_scanners', 'operations.availability.view'),
  ('operations_scanners', 'operations.cold_room.view'),
  ('operations_responsibles', 'operations.parameters.view'),
  ('operations_responsibles', 'operations.reception.view'),
  ('operations_responsibles', 'operations.classification.view'),
  ('operations_responsibles', 'operations.labels.view'),
  ('operations_responsibles', 'operations.bunch_intake.view'),
  ('operations_responsibles', 'operations.inventory.view'),
  ('operations_responsibles', 'operations.availability.view'),
  ('operations_responsibles', 'operations.cold_room.view'),
  ('operations_varieties', 'operations.parameters.view'),
  ('operations_varieties', 'operations.reception.view'),
  ('operations_varieties', 'operations.classification.view'),
  ('operations_varieties', 'operations.labels.view'),
  ('operations_varieties', 'operations.bunch_intake.view'),
  ('operations_varieties', 'operations.inventory.view'),
  ('operations_varieties', 'operations.availability.view'),
  ('operations_varieties', 'operations.cold_room.view'),
  ('operations_lengths', 'operations.parameters.view'),
  ('operations_lengths', 'operations.reception.view'),
  ('operations_lengths', 'operations.classification.view'),
  ('operations_lengths', 'operations.labels.view'),
  ('operations_lengths', 'operations.bunch_intake.view'),
  ('operations_lengths', 'operations.inventory.view'),
  ('operations_lengths', 'operations.availability.view'),
  ('operations_lengths', 'operations.cold_room.view'),
  ('operations_stem_types', 'operations.parameters.view'),
  ('operations_stem_types', 'operations.reception.view'),
  ('operations_stem_types', 'operations.classification.view'),
  ('operations_stem_types', 'operations.labels.view'),
  ('operations_stem_types', 'operations.bunch_intake.view'),
  ('operations_stem_types', 'operations.inventory.view'),
  ('operations_stem_types', 'operations.availability.view'),
  ('operations_stem_types', 'operations.cold_room.view'),
  ('operations_label_types', 'operations.parameters.view'),
  ('operations_label_types', 'operations.reception.view'),
  ('operations_label_types', 'operations.classification.view'),
  ('operations_label_types', 'operations.labels.view'),
  ('operations_label_types', 'operations.bunch_intake.view'),
  ('operations_label_types', 'operations.inventory.view'),
  ('operations_label_types', 'operations.availability.view'),
  ('operations_label_types', 'operations.cold_room.view'),
  ('operations_yield_settings', 'operations.parameters.view'),
  ('operations_yield_settings', 'operations.reception.view'),
  ('operations_yield_settings', 'operations.classification.view'),
  ('operations_yield_settings', 'operations.labels.view'),
  ('operations_yield_settings', 'operations.bunch_intake.view'),
  ('operations_yield_settings', 'operations.inventory.view'),
  ('operations_yield_settings', 'operations.availability.view'),
  ('operations_yield_settings', 'operations.cold_room.view'),
  ('operations_receptions', 'operations.reception.view'),
  ('operations_receptions', 'operations.classification.view'),
  ('operations_classifier_assignments', 'operations.classification.view'),
  ('operations_classification_results', 'operations.classification.view'),
  ('operations_classifications', 'operations.classification.view'),
  ('operations_mesh_records', 'operations.classification.view'),
  ('operations_mesh_history', 'operations.classification.view'),
  ('operations_mesh_history_audit', 'operations.classification.view'),
  ('operations_bunches', 'operations.bunch_intake.view'),
  ('operations_bunches', 'operations.inventory.view'),
  ('operations_bunches', 'operations.availability.view'),
  ('operations_bunches', 'operations.cold_room.view'),
  ('operations_bunch_entries', 'operations.bunch_intake.view'),
  ('operations_bunch_entries', 'operations.inventory.view'),
  ('operations_bunch_entries', 'operations.availability.view'),
  ('operations_bunch_entries', 'operations.cold_room.view'),
  ('operations_scanner_events', 'operations.bunch_intake.view'),
  ('operations_scanner_events', 'operations.inventory.view'),
  ('operations_scanner_events', 'operations.availability.view'),
  ('operations_scanner_events', 'operations.cold_room.view'),
  ('operations_inventory_movements', 'operations.bunch_intake.view'),
  ('operations_inventory_movements', 'operations.inventory.view'),
  ('operations_inventory_movements', 'operations.availability.view'),
  ('operations_inventory_movements', 'operations.cold_room.view'),
  ('operations_rose_inventory', 'operations.bunch_intake.view'),
  ('operations_rose_inventory', 'operations.inventory.view'),
  ('operations_rose_inventory', 'operations.availability.view'),
  ('operations_rose_inventory', 'operations.cold_room.view'),
  ('operations_destination_lots', 'operations.inventory.view'),
  ('operations_destination_lots', 'operations.availability.view'),
  ('operations_destination_lots', 'operations.cold_room.view'),
  ('operations_label_batches', 'operations.labels.view'),
  ('operations_bunch_order_assignments', 'operations.inventory.view'),
  ('operations_bunch_order_assignments', 'operations.availability.view'),
  ('operations_bunch_order_assignments', 'operations.cold_room.view'),
  ('operations_order_boxes', 'operations.inventory.view'),
  ('operations_order_boxes', 'operations.availability.view'),
  ('operations_order_boxes', 'operations.cold_room.view'),
  ('operations_order_movements', 'operations.inventory.view'),
  ('operations_order_movements', 'operations.availability.view'),
  ('operations_order_movements', 'operations.cold_room.view'),
  ('operations_dispatch_records', 'operations.cold_room.view'),
  ('operations_dispatches', 'operations.cold_room.view'),
  ('operations_performances', 'operations.yields.view'),
  ('operations_yield_workday', 'operations.yields.view'),
  ('operations_yield_workday_history', 'operations.yields.view'),
  ('operations_consumptions', 'operations.inventory.view'),
  ('operations_consumptions', 'inventory.kardex.view'),
  ('operations_kardex', 'operations.inventory.view'),
  ('operations_kardex', 'inventory.kardex.view'),
  ('operations_reservations', 'operations.availability.view'),
  ('operations_availability', 'operations.availability.view'),
  ('accounting_journal_entries', 'accounting.journal.view'),
  ('financial_journal_entries', 'accounting.journal.view'),
  ('accounting_providers', 'purchases.providers.view'),
  ('accounting_providers', 'portfolio.suppliers.view'),
  ('supplier_providers', 'purchases.providers.view'),
  ('supplier_providers', 'portfolio.suppliers.view'),
  ('accounting_audit_logs', 'admin.audit.view'),
  ('purchases', 'purchases.documents.view'),
  ('supplier_purchase_documents', 'purchases.documents.view'),
  ('purchase_payables', 'portfolio.payables.view'),
  ('supplier_payables', 'portfolio.payables.view'),
  ('issued_withholdings', 'purchases.withholdings.view'),
  ('payments', 'treasury.payments.view'),
  ('payment_batches', 'treasury.payments.view'),
  ('supplier_payments', 'treasury.payments.view'),
  ('customer_receivables', 'portfolio.receivables.view'),
  ('financial_receivables', 'portfolio.receivables.view'),
  ('collections', 'treasury.collections.view'),
  ('collection_batches', 'treasury.collections.view'),
  ('financial_collections', 'treasury.collections.view'),
  ('received_withholdings', 'tax.received_withholdings.view'),
  ('financial_credit_notes', 'commercial.credit_notes.view'),
  ('financial_order_costs', 'accounting.journal.view'),
  ('financial_order_costs', 'reports.accounting.view'),
  ('financial_shipment_expenses', 'accounting.journal.view'),
  ('financial_shipment_expenses', 'reports.accounting.view'),
  ('financial_cost_allocations', 'accounting.journal.view'),
  ('financial_cost_allocations', 'reports.accounting.view'),
  ('financial_events', 'accounting.journal.view'),
  ('financial_events', 'reports.accounting.view'),
  ('supplier_settlements', 'purchases.settlements.view'),
  ('supplier_reception_costs', 'purchases.settlements.view'),
  ('supplier_adjustments', 'purchases.settlements.view'),
  ('bank_accounts', 'treasury.accounts.view'),
  ('bank_accounts', 'treasury.payments.view'),
  ('bank_accounts', 'treasury.collections.view'),
  ('bank_accounts', 'treasury.reconciliation.view'),
  ('bank_accounts', 'treasury.transfers.view'),
  ('bank_accounts', 'payroll.accounting_settings.view'),
  ('treasury_bank_accounts', 'treasury.accounts.view'),
  ('treasury_bank_accounts', 'treasury.payments.view'),
  ('treasury_bank_accounts', 'treasury.collections.view'),
  ('treasury_bank_accounts', 'treasury.reconciliation.view'),
  ('treasury_bank_accounts', 'treasury.transfers.view'),
  ('treasury_bank_accounts', 'payroll.accounting_settings.view'),
  ('treasury_cash_accounts', 'treasury.cash_accounts.view'),
  ('treasury_cash_accounts', 'treasury.movements.view'),
  ('treasury_cash_accounts', 'treasury.transfers.view'),
  ('bank_movements', 'treasury.movements.view'),
  ('treasury_bank_transactions', 'treasury.movements.view'),
  ('treasury_cash_transactions', 'treasury.movements.view'),
  ('bank_statement_movements', 'treasury.reconciliation.view'),
  ('bank_reconciliations', 'treasury.reconciliation.view'),
  ('treasury_reconciliations', 'treasury.reconciliation.view'),
  ('treasury_reconciliation_matches', 'treasury.reconciliation.view'),
  ('treasury_reconciliation_reviews', 'treasury.reconciliation.view'),
  ('treasury_transfers', 'treasury.transfers.view'),
  ('treasury_adjustments', 'treasury.movements.view'),
  ('inventory_warehouses', 'inventory.summary.view'),
  ('inventory_warehouses', 'inventory.kardex.view'),
  ('inventory_items', 'inventory.summary.view'),
  ('inventory_items', 'inventory.kardex.view'),
  ('inventory_responsibles', 'inventory.summary.view'),
  ('inventory_responsibles', 'inventory.kardex.view'),
  ('material_inventory_movements', 'inventory.kardex.view'),
  ('material_inventory_movements', 'inventory.consumptions.view'),
  ('material_inventory_movements', 'inventory.adjustments.view'),
  ('payroll_employees', 'payroll.employees.view'),
  ('payroll_v2_employees', 'payroll.employees.view'),
  ('payroll_v2_operational_roles', 'payroll.employees.view'),
  ('payroll_rate_rules', 'payroll.performance_policies.view'),
  ('payroll_rate_rules', 'payroll.accounting_settings.view'),
  ('payroll_obligation_settings', 'payroll.performance_policies.view'),
  ('payroll_obligation_settings', 'payroll.accounting_settings.view'),
  ('payroll_v2_performance_policies', 'payroll.performance_policies.view'),
  ('payroll_v2_performance_policies', 'payroll.accounting_settings.view'),
  ('payroll_v2_policy_assignments', 'payroll.performance_policies.view'),
  ('payroll_v2_policy_assignments', 'payroll.accounting_settings.view'),
  ('payroll_v2_policy_snapshots', 'payroll.performance_policies.view'),
  ('payroll_v2_policy_snapshots', 'payroll.accounting_settings.view'),
  ('payroll_hour_entries', 'payroll.roles.view'),
  ('payroll_performance_entries', 'payroll.roles.view'),
  ('payroll_runs', 'payroll.roles.view'),
  ('payroll_items', 'payroll.roles.view'),
  ('payroll_payments', 'payroll.roles.view'),
  ('payroll_v2_periods', 'payroll.roles.view'),
  ('payroll_v2_roles', 'payroll.roles.view'),
  ('payroll_v2_role_items', 'payroll.roles.view'),
  ('payroll_v2_role_lines', 'payroll.roles.view'),
  ('payroll_v2_performance_snapshots', 'payroll.roles.view'),
  ('payroll_v2_events', 'payroll.roles.view');

create function public.erp_u2c3_has_any_capability(p_company_id uuid,p_capability_ids text[])
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if p_company_id is null or coalesce(cardinality(p_capability_ids),0)=0 then return false; end if;
  return exists(
    select 1
    from public.erp_security_get_effective_capabilities(p_company_id) effective
    where effective.capability_id=any(p_capability_ids)
  );
exception when sqlstate '42501' or sqlstate '22023' then return false;
end;
$$;
revoke all on function public.erp_u2c3_has_any_capability(uuid,text[]) from public,anon,service_role;
grant execute on function public.erp_u2c3_has_any_capability(uuid,text[]) to authenticated;

create function public.erp_u2c3_can_read_entity(p_company_id uuid,p_entity text)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare v_allowed boolean;
begin
  if p_company_id is null or nullif(btrim(p_entity),'') is null then return false; end if;
  select exists(
    select 1
    from public.erp_u2c3_entity_read_capabilities mapping
    join public.erp_security_get_effective_capabilities(p_company_id) effective
      on effective.capability_id=mapping.capability_id
    where mapping.entity=p_entity
  ) into v_allowed;
  if not v_allowed then return false; end if;
  if p_entity like 'payroll\_%' escape '\' then
    return public.erp_payroll_core_v2_has_permission(p_company_id,'VIEW');
  end if;
  return true;
exception when sqlstate '42501' or sqlstate '22023' then return false;
end;
$$;
revoke all on function public.erp_u2c3_can_read_entity(uuid,text) from public,anon,service_role;
grant execute on function public.erp_u2c3_can_read_entity(uuid,text) to authenticated;


alter function public.erp_list_commercial_order_history(uuid,integer,integer,text,date,date,text,text,text,text[],text[],text[]) rename to erp_list_commercial_order_history_u2c3_internal;
revoke all on function public.erp_list_commercial_order_history_u2c3_internal(uuid,integer,integer,text,date,date,text,text,text,text[],text[],text[]) from public, anon, authenticated, service_role;

create function public.erp_list_commercial_order_history(
  p_company_id uuid,
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_customer_id text default null,
  p_brand_id text default null,
  p_destination text default null,
  p_customer_matches text[] default null,
  p_brand_matches text[] default null,
  p_airline_matches text[] default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'commercial.orders.view');
  return public.erp_list_commercial_order_history_u2c3_internal(p_company_id, p_page, p_page_size, p_search, p_date_from, p_date_to, p_customer_id, p_brand_id, p_destination, p_customer_matches, p_brand_matches, p_airline_matches);
end;
$$;

revoke all on function public.erp_list_commercial_order_history(uuid,integer,integer,text,date,date,text,text,text,text[],text[],text[]) from public, anon, service_role;
grant execute on function public.erp_list_commercial_order_history(uuid,integer,integer,text,date,date,text,text,text,text[],text[],text[]) to authenticated;
comment on function public.erp_list_commercial_order_history(uuid,integer,integer,text,date,date,text,text,text,text[],text[],text[]) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_commercial_v2_list_sales_representatives(uuid) rename to erp_commercial_v2_list_sales_representatives_u2c3_internal;
revoke all on function public.erp_commercial_v2_list_sales_representatives_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_commercial_v2_list_sales_representatives(
  p_company_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'commercial.orders.view');
  return public.erp_commercial_v2_list_sales_representatives_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_commercial_v2_list_sales_representatives(uuid) from public, anon, service_role;
grant execute on function public.erp_commercial_v2_list_sales_representatives(uuid) to authenticated;
comment on function public.erp_commercial_v2_list_sales_representatives(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_operations_v2_list_classification_deliveries(uuid,date,date,text,text,text,text,text,text,integer,integer) rename to erp_operations_v2_list_classification_deliveries_u2c3_internal;
revoke all on function public.erp_operations_v2_list_classification_deliveries_u2c3_internal(uuid,date,date,text,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_operations_v2_list_classification_deliveries(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_supplier text default null,
  p_block text default null,
  p_variety text default null,
  p_status text default null,
  p_search text default null,
  p_classifier text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'operations.classification.view');
  return public.erp_operations_v2_list_classification_deliveries_u2c3_internal(p_company_id, p_date_from, p_date_to, p_supplier, p_block, p_variety, p_status, p_search, p_classifier, p_page, p_page_size);
end;
$$;

revoke all on function public.erp_operations_v2_list_classification_deliveries(uuid,date,date,text,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_operations_v2_list_classification_deliveries(uuid,date,date,text,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_operations_v2_list_classification_deliveries(uuid,date,date,text,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_operations_v2_list_reception_lines(uuid,date,date,text,text,text,text,text,boolean,integer,integer) rename to erp_operations_v2_list_reception_lines_u2c3_internal;
revoke all on function public.erp_operations_v2_list_reception_lines_u2c3_internal(uuid,date,date,text,text,text,text,text,boolean,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_operations_v2_list_reception_lines(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_supplier text default null,
  p_block text default null,
  p_variety text default null,
  p_status text default null,
  p_search text default null,
  p_only_pending boolean default false,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'operations.reception.view');
  return public.erp_operations_v2_list_reception_lines_u2c3_internal(p_company_id, p_date_from, p_date_to, p_supplier, p_block, p_variety, p_status, p_search, p_only_pending, p_page, p_page_size);
end;
$$;

revoke all on function public.erp_operations_v2_list_reception_lines(uuid,date,date,text,text,text,text,text,boolean,integer,integer) from public, anon, service_role;
grant execute on function public.erp_operations_v2_list_reception_lines(uuid,date,date,text,text,text,text,text,boolean,integer,integer) to authenticated;
comment on function public.erp_operations_v2_list_reception_lines(uuid,date,date,text,text,text,text,text,boolean,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_operations_v2_supplier_inventory_report(uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer) rename to erp_operations_v2_supplier_inventory_report_u2c3_internal;
revoke all on function public.erp_operations_v2_supplier_inventory_report_u2c3_internal(uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_operations_v2_supplier_inventory_report(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_supplier text default null,
  p_block text default null,
  p_variety text default null,
  p_length integer default null,
  p_classification_type text default null,
  p_search text default null,
  p_sort_field text default 'dateTime',
  p_sort_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'operations.inventory.view');
  return public.erp_operations_v2_supplier_inventory_report_u2c3_internal(p_company_id, p_date_from, p_date_to, p_supplier, p_block, p_variety, p_length, p_classification_type, p_search, p_sort_field, p_sort_direction, p_page, p_page_size);
end;
$$;

revoke all on function public.erp_operations_v2_supplier_inventory_report(uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_operations_v2_supplier_inventory_report(uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_operations_v2_supplier_inventory_report(uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_destination_v2_availability(uuid) rename to erp_destination_v2_availability_u2c3_internal;
revoke all on function public.erp_destination_v2_availability_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_destination_v2_availability(
  p_company_id uuid
)
returns table(
  destination_type text, destination_customer_id text, destination_customer_name text,
  lot_id text, lot_code text, variety text, length numeric, quality text,
  physical_bunches bigint, available_bunches bigint, assigned_bunches bigint, packed_bunches bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'operations.availability.view');
  return query select * from public.erp_destination_v2_availability_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_destination_v2_availability(uuid) from public, anon, service_role;
grant execute on function public.erp_destination_v2_availability(uuid) to authenticated;
comment on function public.erp_destination_v2_availability(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_zebra_v2_availability(uuid) rename to erp_zebra_v2_availability_u2c3_internal;
revoke all on function public.erp_zebra_v2_availability_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_zebra_v2_availability(
  p_company_id uuid
)
returns table(
  stock_key text, variety text, length numeric, quality text, physical_bunches numeric,
  physical_stems numeric, reserved_bunches numeric, packed_bunches numeric,
  blocked_bunches numeric, available_bunches numeric, available_stems numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'operations.availability.view');
  return query select * from public.erp_zebra_v2_availability_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_zebra_v2_availability(uuid) from public, anon, service_role;
grant execute on function public.erp_zebra_v2_availability(uuid) to authenticated;
comment on function public.erp_zebra_v2_availability(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_warehouse_v2_availability(uuid) rename to erp_warehouse_v2_availability_u2c3_internal;
revoke all on function public.erp_warehouse_v2_availability_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_warehouse_v2_availability(
  p_company_id uuid
)
returns table(
  dimension_key text, variety text, length numeric, quality text, physical_bunches bigint,
  physical_stems numeric, reserved_bunches numeric, assigned_bunches bigint,
  packed_bunches bigint, blocked_bunches bigint, available_bunches numeric, available_stems numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'operations.availability.view');
  return query select * from public.erp_warehouse_v2_availability_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_warehouse_v2_availability(uuid) from public, anon, service_role;
grant execute on function public.erp_warehouse_v2_availability(uuid) to authenticated;
comment on function public.erp_warehouse_v2_availability(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_dispatch_v2_validate_ready(uuid,text,boolean) rename to erp_dispatch_v2_validate_ready_u2c3_internal;
revoke all on function public.erp_dispatch_v2_validate_ready_u2c3_internal(uuid,text,boolean) from public, anon, authenticated, service_role;

create function public.erp_dispatch_v2_validate_ready(
  p_company_id uuid,
  p_order_id text,
  p_lock boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'operations.cold_room.view');
  return public.erp_dispatch_v2_validate_ready_u2c3_internal(p_company_id, p_order_id, p_lock);
end;
$$;

revoke all on function public.erp_dispatch_v2_validate_ready(uuid,text,boolean) from public, anon, service_role;
grant execute on function public.erp_dispatch_v2_validate_ready(uuid,text,boolean) to authenticated;
comment on function public.erp_dispatch_v2_validate_ready(uuid,text,boolean) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_journal_page(uuid,date,date,text,text,text,text,text,integer,integer) rename to erp_accounting_journal_page_u2c3_internal;
revoke all on function public.erp_accounting_journal_page_u2c3_internal(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_accounting_journal_page(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null,
  p_origin_module text default null,
  p_entry_number text default null,
  p_reference text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'accounting.journal.view');
  return public.erp_accounting_journal_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_status, p_origin_module, p_entry_number, p_reference, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_accounting_journal_page(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_accounting_journal_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_accounting_journal_page(uuid,date,date,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_journal_detail(uuid,text,text) rename to erp_accounting_journal_detail_u2c3_internal;
revoke all on function public.erp_accounting_journal_detail_u2c3_internal(uuid,text,text) from public, anon, authenticated, service_role;

create function public.erp_accounting_journal_detail(
  p_company_id uuid,
  p_entry_key text,
  p_source_kind text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'accounting.journal.view');
  return public.erp_accounting_journal_detail_u2c3_internal(p_company_id, p_entry_key, p_source_kind);
end;
$$;

revoke all on function public.erp_accounting_journal_detail(uuid,text,text) from public, anon, service_role;
grant execute on function public.erp_accounting_journal_detail(uuid,text,text) to authenticated;
comment on function public.erp_accounting_journal_detail(uuid,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_ledger_page(uuid,text,date,date,text,text,integer,integer) rename to erp_accounting_ledger_page_u2c3_internal;
revoke all on function public.erp_accounting_ledger_page_u2c3_internal(uuid,text,date,date,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_accounting_ledger_page(
  p_company_id uuid,
  p_account_record_id text,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'accounting.ledger.view');
  return public.erp_accounting_ledger_page_u2c3_internal(p_company_id, p_account_record_id, p_date_from, p_date_to, p_status, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_accounting_ledger_page(uuid,text,date,date,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_accounting_ledger_page(uuid,text,date,date,text,text,integer,integer) to authenticated;
comment on function public.erp_accounting_ledger_page(uuid,text,date,date,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean) rename to erp_accounting_trial_balance_u2c3_internal;
revoke all on function public.erp_accounting_trial_balance_u2c3_internal(uuid,date,date,text,text,boolean) from public, anon, authenticated, service_role;

create function public.erp_accounting_trial_balance(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_account_code text default null,
  p_account_type text default null,
  p_include_zero boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'accounting.financial_statements.view');
  return public.erp_accounting_trial_balance_u2c3_internal(p_company_id, p_date_from, p_date_to, p_account_code, p_account_type, p_include_zero);
end;
$$;

revoke all on function public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean) from public, anon, service_role;
grant execute on function public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean) to authenticated;
comment on function public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_balance_sheet(uuid,date,date) rename to erp_accounting_balance_sheet_u2c3_internal;
revoke all on function public.erp_accounting_balance_sheet_u2c3_internal(uuid,date,date) from public, anon, authenticated, service_role;

create function public.erp_accounting_balance_sheet(
  p_company_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'accounting.financial_statements.view');
  return public.erp_accounting_balance_sheet_u2c3_internal(p_company_id, p_date_from, p_date_to);
end;
$$;

revoke all on function public.erp_accounting_balance_sheet(uuid,date,date) from public, anon, service_role;
grant execute on function public.erp_accounting_balance_sheet(uuid,date,date) to authenticated;
comment on function public.erp_accounting_balance_sheet(uuid,date,date) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_income_statement(uuid,date,date) rename to erp_accounting_income_statement_u2c3_internal;
revoke all on function public.erp_accounting_income_statement_u2c3_internal(uuid,date,date) from public, anon, authenticated, service_role;

create function public.erp_accounting_income_statement(
  p_company_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'accounting.financial_statements.view');
  return public.erp_accounting_income_statement_u2c3_internal(p_company_id, p_date_from, p_date_to);
end;
$$;

revoke all on function public.erp_accounting_income_statement(uuid,date,date) from public, anon, service_role;
grant execute on function public.erp_accounting_income_statement(uuid,date,date) to authenticated;
comment on function public.erp_accounting_income_statement(uuid,date,date) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_dashboard_summary(uuid,date,date,text,text) rename to erp_accounting_dashboard_summary_u2c3_internal;
revoke all on function public.erp_accounting_dashboard_summary_u2c3_internal(uuid,date,date,text,text) from public, anon, authenticated, service_role;

create function public.erp_accounting_dashboard_summary(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_period text,
  p_purchase_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'reports.dashboard.view');
  return public.erp_accounting_dashboard_summary_u2c3_internal(p_company_id, p_date_from, p_date_to, p_period, p_purchase_status);
end;
$$;

revoke all on function public.erp_accounting_dashboard_summary(uuid,date,date,text,text) from public, anon, service_role;
grant execute on function public.erp_accounting_dashboard_summary(uuid,date,date,text,text) to authenticated;
comment on function public.erp_accounting_dashboard_summary(uuid,date,date,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer) rename to erp_accounting_portfolio_report_page_u2c3_internal;
revoke all on function public.erp_accounting_portfolio_report_page_u2c3_internal(uuid,text,date,date,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_accounting_portfolio_report_page(
  p_company_id uuid,
  p_view text,
  p_date_from date,
  p_date_to date,
  p_provider_id text default null,
  p_customer_id text default null,
  p_status text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'reports.portfolio.view');
  return public.erp_accounting_portfolio_report_page_u2c3_internal(p_company_id, p_view, p_date_from, p_date_to, p_provider_id, p_customer_id, p_status, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer) rename to erp_accounting_bank_report_page_u2c3_internal;
revoke all on function public.erp_accounting_bank_report_page_u2c3_internal(uuid,text,date,date,uuid,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_accounting_bank_report_page(
  p_company_id uuid,
  p_view text,
  p_date_from date,
  p_date_to date,
  p_bank_account_id uuid default null,
  p_type text default null,
  p_status text default null,
  p_origin text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'reports.banks.view');
  return public.erp_accounting_bank_report_page_u2c3_internal(p_company_id, p_view, p_date_from, p_date_to, p_bank_account_id, p_type, p_status, p_origin, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_payable_read_rows(uuid) rename to erp_supplier_payable_read_rows_u2c3_internal;
revoke all on function public.erp_supplier_payable_read_rows_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_supplier_payable_read_rows(
  p_company_id uuid
)
returns table(
  id text, source text, provider_id text, provider_code text, provider_name text,
  provider_ruc text, purchase_id text, document_number text, issue_date date, due_date date,
  total numeric, balance numeric, paid numeric, retention_applied numeric, advance_applied numeric,
  state text, canonical_status text, journal_entry_id text, updated_at timestamptz, version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.payables.view');
  return query select * from public.erp_supplier_payable_read_rows_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_supplier_payable_read_rows(uuid) from public, anon, service_role;
grant execute on function public.erp_supplier_payable_read_rows(uuid) to authenticated;
comment on function public.erp_supplier_payable_read_rows(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer) rename to erp_supplier_payables_open_page_u2c3_internal;
revoke all on function public.erp_supplier_payables_open_page_u2c3_internal(uuid,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_supplier_payables_open_page(
  p_company_id uuid,
  p_provider_id text default null,
  p_state text default null,
  p_due_mode text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.payables.view');
  return public.erp_supplier_payables_open_page_u2c3_internal(p_company_id, p_provider_id, p_state, p_due_mode, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_payables_history_page(uuid,date,date,text,text,text,text,integer,integer) rename to erp_supplier_payables_history_page_u2c3_internal;
revoke all on function public.erp_supplier_payables_history_page_u2c3_internal(uuid,date,date,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_supplier_payables_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_provider_id text default null,
  p_state text default null,
  p_document text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.payables.view');
  return public.erp_supplier_payables_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_provider_id, p_state, p_document, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_supplier_payables_history_page(uuid,date,date,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_supplier_payables_history_page(uuid,date,date,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_supplier_payables_history_page(uuid,date,date,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_payable_detail(uuid,text,text) rename to erp_supplier_payable_detail_u2c3_internal;
revoke all on function public.erp_supplier_payable_detail_u2c3_internal(uuid,text,text) from public, anon, authenticated, service_role;

create function public.erp_supplier_payable_detail(
  p_company_id uuid,
  p_payable_id text,
  p_source text default 'SUPPLIER_FINANCE_V2'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.payables.view');
  return public.erp_supplier_payable_detail_u2c3_internal(p_company_id, p_payable_id, p_source);
end;
$$;

revoke all on function public.erp_supplier_payable_detail(uuid,text,text) from public, anon, service_role;
grant execute on function public.erp_supplier_payable_detail(uuid,text,text) to authenticated;
comment on function public.erp_supplier_payable_detail(uuid,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_payments_history_page(uuid,date,date,text,text,text,text,text,integer,integer) rename to erp_supplier_payments_history_page_u2c3_internal;
revoke all on function public.erp_supplier_payments_history_page_u2c3_internal(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_supplier_payments_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_provider_id text default null,
  p_bank_account_id text default null,
  p_state text default null,
  p_document text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.payments.view');
  return public.erp_supplier_payments_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_provider_id, p_bank_account_id, p_state, p_document, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_supplier_payments_history_page(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_supplier_payments_history_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_supplier_payments_history_page(uuid,date,date,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_payment_detail(uuid,text,text) rename to erp_supplier_payment_detail_u2c3_internal;
revoke all on function public.erp_supplier_payment_detail_u2c3_internal(uuid,text,text) from public, anon, authenticated, service_role;

create function public.erp_supplier_payment_detail(
  p_company_id uuid,
  p_payment_id text,
  p_source text default 'SUPPLIER_FINANCE_V2'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.payments.view');
  return public.erp_supplier_payment_detail_u2c3_internal(p_company_id, p_payment_id, p_source);
end;
$$;

revoke all on function public.erp_supplier_payment_detail(uuid,text,text) from public, anon, service_role;
grant execute on function public.erp_supplier_payment_detail(uuid,text,text) to authenticated;
comment on function public.erp_supplier_payment_detail(uuid,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_customer_receivable_read_rows(uuid) rename to erp_customer_receivable_read_rows_u2c3_internal;
revoke all on function public.erp_customer_receivable_read_rows_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_customer_receivable_read_rows(
  p_company_id uuid
)
returns table(
  id text, source text, customer_id text, customer_name text, customer_tax_id text,
  source_id text, document_type text, document_number text, issue_date date, due_date date,
  total numeric, credited numeric, collected numeric, withheld numeric, balance numeric,
  status text, canonical_status text, journal_entry_id text, updated_at timestamptz, version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.receivables.view');
  return query select * from public.erp_customer_receivable_read_rows_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_customer_receivable_read_rows(uuid) from public, anon, service_role;
grant execute on function public.erp_customer_receivable_read_rows(uuid) to authenticated;
comment on function public.erp_customer_receivable_read_rows(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer) rename to erp_customer_receivables_open_page_u2c3_internal;
revoke all on function public.erp_customer_receivables_open_page_u2c3_internal(uuid,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_customer_receivables_open_page(
  p_company_id uuid,
  p_customer_id text default null,
  p_state text default null,
  p_due_mode text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.receivables.view');
  return public.erp_customer_receivables_open_page_u2c3_internal(p_company_id, p_customer_id, p_state, p_due_mode, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_customer_receivables_history_page(uuid,date,date,text,text,text,text,text,integer,integer) rename to erp_customer_receivables_history_page_u2c3_internal;
revoke all on function public.erp_customer_receivables_history_page_u2c3_internal(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_customer_receivables_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_customer_id text default null,
  p_state text default null,
  p_document_type text default null,
  p_document text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.receivables.view');
  return public.erp_customer_receivables_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_customer_id, p_state, p_document_type, p_document, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_customer_receivables_history_page(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_customer_receivables_history_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_customer_receivables_history_page(uuid,date,date,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_customer_receivable_detail(uuid,text,text) rename to erp_customer_receivable_detail_u2c3_internal;
revoke all on function public.erp_customer_receivable_detail_u2c3_internal(uuid,text,text) from public, anon, authenticated, service_role;

create function public.erp_customer_receivable_detail(
  p_company_id uuid,
  p_receivable_id text,
  p_source text default 'FINANCIAL_V2'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'portfolio.receivables.view');
  return public.erp_customer_receivable_detail_u2c3_internal(p_company_id, p_receivable_id, p_source);
end;
$$;

revoke all on function public.erp_customer_receivable_detail(uuid,text,text) from public, anon, service_role;
grant execute on function public.erp_customer_receivable_detail(uuid,text,text) to authenticated;
comment on function public.erp_customer_receivable_detail(uuid,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_customer_collections_history_page(uuid,date,date,text,text,text,text,text,integer,integer) rename to erp_customer_collections_history_page_u2c3_internal;
revoke all on function public.erp_customer_collections_history_page_u2c3_internal(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_customer_collections_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_customer_id text default null,
  p_bank_account_id text default null,
  p_state text default null,
  p_document text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.collections.view');
  return public.erp_customer_collections_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_customer_id, p_bank_account_id, p_state, p_document, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_customer_collections_history_page(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_customer_collections_history_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_customer_collections_history_page(uuid,date,date,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_customer_collection_detail(uuid,text,text) rename to erp_customer_collection_detail_u2c3_internal;
revoke all on function public.erp_customer_collection_detail_u2c3_internal(uuid,text,text) from public, anon, authenticated, service_role;

create function public.erp_customer_collection_detail(
  p_company_id uuid,
  p_collection_id text,
  p_source text default 'FINANCIAL_V2'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.collections.view');
  return public.erp_customer_collection_detail_u2c3_internal(p_company_id, p_collection_id, p_source);
end;
$$;

revoke all on function public.erp_customer_collection_detail(uuid,text,text) from public, anon, service_role;
grant execute on function public.erp_customer_collection_detail(uuid,text,text) to authenticated;
comment on function public.erp_customer_collection_detail(uuid,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_purchase_invoice_read_rows(uuid) rename to erp_purchase_invoice_read_rows_u2c3_internal;
revoke all on function public.erp_purchase_invoice_read_rows_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_purchase_invoice_read_rows(
  p_company_id uuid
)
returns table(
  id text, source text, canonical boolean, supplier_id text, supplier_name text, supplier_ruc text,
  issue_date date, accounting_date date, document_type text, document_number text,
  authorization_summary text, access_key_summary text, subtotal numeric, tax_total numeric,
  total numeric, status text, accounting_status text, retention_status text, payable_id text,
  payable_balance numeric, payable_status text, journal_entry_id text, journal_entry_number text,
  line_count bigint, source_type text, updated_at timestamptz, dedup_key text, priority integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.documents.view');
  return query select * from public.erp_purchase_invoice_read_rows_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_purchase_invoice_read_rows(uuid) from public, anon, service_role;
grant execute on function public.erp_purchase_invoice_read_rows(uuid) to authenticated;
comment on function public.erp_purchase_invoice_read_rows(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_purchase_invoices_history_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) rename to erp_purchase_invoices_history_page_u2c3_internal;
revoke all on function public.erp_purchase_invoices_history_page_u2c3_internal(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_purchase_invoices_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_date_kind text default 'ISSUE',
  p_provider_id text default null,
  p_status text default null,
  p_document_type text default null,
  p_posting_state text default null,
  p_retention_status text default null,
  p_document_number text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.documents.view');
  return public.erp_purchase_invoices_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_date_kind, p_provider_id, p_status, p_document_type, p_posting_state, p_retention_status, p_document_number, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_purchase_invoices_history_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_purchase_invoices_history_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_purchase_invoices_history_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_purchase_invoice_detail(uuid,text,text) rename to erp_purchase_invoice_detail_u2c3_internal;
revoke all on function public.erp_purchase_invoice_detail_u2c3_internal(uuid,text,text) from public, anon, authenticated, service_role;

create function public.erp_purchase_invoice_detail(
  p_company_id uuid,
  p_purchase_id text,
  p_source text default 'SUPPLIER_FINANCE_V2'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.documents.view');
  return public.erp_purchase_invoice_detail_u2c3_internal(p_company_id, p_purchase_id, p_source);
end;
$$;

revoke all on function public.erp_purchase_invoice_detail(uuid,text,text) from public, anon, service_role;
grant execute on function public.erp_purchase_invoice_detail(uuid,text,text) to authenticated;
comment on function public.erp_purchase_invoice_detail(uuid,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_purchase_invoice_xml(uuid,text,text) rename to erp_purchase_invoice_xml_u2c3_internal;
revoke all on function public.erp_purchase_invoice_xml_u2c3_internal(uuid,text,text) from public, anon, authenticated, service_role;

create function public.erp_purchase_invoice_xml(
  p_company_id uuid,
  p_purchase_id text,
  p_source text default 'SUPPLIER_FINANCE_V2'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.documents.view');
  return public.erp_purchase_invoice_xml_u2c3_internal(p_company_id, p_purchase_id, p_source);
end;
$$;

revoke all on function public.erp_purchase_invoice_xml(uuid,text,text) from public, anon, service_role;
grant execute on function public.erp_purchase_invoice_xml(uuid,text,text) to authenticated;
comment on function public.erp_purchase_invoice_xml(uuid,text,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_purchase_withholding_v2_pending_page(uuid,integer,integer) rename to erp_purchase_withholding_v2_pending_page_u2c3_internal;
revoke all on function public.erp_purchase_withholding_v2_pending_page_u2c3_internal(uuid,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_purchase_withholding_v2_pending_page(
  p_company_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.withholdings.view');
  return public.erp_purchase_withholding_v2_pending_page_u2c3_internal(p_company_id, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_purchase_withholding_v2_pending_page(uuid,integer,integer) from public, anon, service_role;
grant execute on function public.erp_purchase_withholding_v2_pending_page(uuid,integer,integer) to authenticated;
comment on function public.erp_purchase_withholding_v2_pending_page(uuid,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_purchase_withholding_v2_history_page(uuid,date,date,text,text,text,text,text,integer,integer) rename to erp_purchase_withholding_v2_history_page_u2c3_internal;
revoke all on function public.erp_purchase_withholding_v2_history_page_u2c3_internal(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_purchase_withholding_v2_history_page(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_provider_search text default null,
  p_status text default null,
  p_retention_number text default null,
  p_purchase_number text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.withholdings.view');
  return public.erp_purchase_withholding_v2_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_provider_search, p_status, p_retention_number, p_purchase_number, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_purchase_withholding_v2_history_page(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_purchase_withholding_v2_history_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_purchase_withholding_v2_history_page(uuid,date,date,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_purchase_withholding_v2_detail(uuid,uuid,uuid) rename to erp_purchase_withholding_v2_detail_u2c3_internal;
revoke all on function public.erp_purchase_withholding_v2_detail_u2c3_internal(uuid,uuid,uuid) from public, anon, authenticated, service_role;

create function public.erp_purchase_withholding_v2_detail(
  p_company_id uuid,
  p_purchase_document_id uuid default null,
  p_electronic_document_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.withholdings.view');
  return public.erp_purchase_withholding_v2_detail_u2c3_internal(p_company_id, p_purchase_document_id, p_electronic_document_id);
end;
$$;

revoke all on function public.erp_purchase_withholding_v2_detail(uuid,uuid,uuid) from public, anon, service_role;
grant execute on function public.erp_purchase_withholding_v2_detail(uuid,uuid,uuid) to authenticated;
comment on function public.erp_purchase_withholding_v2_detail(uuid,uuid,uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_received_withholding_read_rows(uuid) rename to erp_received_withholding_read_rows_u2c3_internal;
revoke all on function public.erp_received_withholding_read_rows_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_received_withholding_read_rows(
  p_company_id uuid
)
returns table(
  withholding_id text, issue_date date, document_number text, issuer_name text, issuer_tax_id text,
  resolved_customer_id text, support_document_number text, total_rent numeric, total_vat numeric,
  total_retained numeric, status text, related_receivable_id text, related_receivable_number text,
  related_customer_id text, suggested_receivable_id text, suggested_receivable_number text,
  suggested_customer_id text, journal_entry_id text, journal_entry_number text,
  authorization_number text, access_key text, import_status text, source text, applied_at timestamptz,
  created_at timestamptz, updated_at timestamptz, version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'tax.received_withholdings.view');
  return query select * from public.erp_received_withholding_read_rows_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_received_withholding_read_rows(uuid) from public, anon, service_role;
grant execute on function public.erp_received_withholding_read_rows(uuid) to authenticated;
comment on function public.erp_received_withholding_read_rows(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer) rename to erp_received_withholding_page_u2c3_internal;
revoke all on function public.erp_received_withholding_page_u2c3_internal(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_received_withholding_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_customer_id text default null,
  p_status text default null,
  p_number text default null,
  p_document text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'tax.received_withholdings.view');
  return public.erp_received_withholding_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_customer_id, p_status, p_number, p_document, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_received_withholding_detail(uuid,text) rename to erp_received_withholding_detail_u2c3_internal;
revoke all on function public.erp_received_withholding_detail_u2c3_internal(uuid,text) from public, anon, authenticated, service_role;

create function public.erp_received_withholding_detail(
  p_company_id uuid,
  p_received_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'tax.received_withholdings.view');
  return public.erp_received_withholding_detail_u2c3_internal(p_company_id, p_received_id);
end;
$$;

revoke all on function public.erp_received_withholding_detail(uuid,text) from public, anon, service_role;
grant execute on function public.erp_received_withholding_detail(uuid,text) to authenticated;
comment on function public.erp_received_withholding_detail(uuid,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_received_withholding_receivable_lookup(uuid,text,text,integer) rename to erp_received_withholding_receivable_lookup_u2c3_internal;
revoke all on function public.erp_received_withholding_receivable_lookup_u2c3_internal(uuid,text,text,integer) from public, anon, authenticated, service_role;

create function public.erp_received_withholding_receivable_lookup(
  p_company_id uuid,
  p_customer_id text,
  p_search text default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'tax.received_withholdings.view');
  return public.erp_received_withholding_receivable_lookup_u2c3_internal(p_company_id, p_customer_id, p_search, p_limit);
end;
$$;

revoke all on function public.erp_received_withholding_receivable_lookup(uuid,text,text,integer) from public, anon, service_role;
grant execute on function public.erp_received_withholding_receivable_lookup(uuid,text,text,integer) to authenticated;
comment on function public.erp_received_withholding_receivable_lookup(uuid,text,text,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_retention_report_rows(uuid) rename to erp_retention_report_rows_u2c3_internal;
revoke all on function public.erp_retention_report_rows_u2c3_internal(uuid) from public, anon, authenticated, service_role;

create function public.erp_retention_report_rows(
  p_company_id uuid
)
returns table(
  report_type text, source text, retention_id text, line_id text, retention_date date,
  third_party_id text, third_party_name text, third_party_tax_id text, origin_document_id text,
  origin_document_number text, retention_number text, tax_type text, retention_code text,
  percentage numeric, taxable_base numeric, retained_amount numeric, status text,
  authorization_number text, access_key text, journal_entry_id text, journal_entry_number text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.retention_report.view');
  return query select * from public.erp_retention_report_rows_u2c3_internal(p_company_id);
end;
$$;

revoke all on function public.erp_retention_report_rows(uuid) from public, anon, service_role;
grant execute on function public.erp_retention_report_rows(uuid) to authenticated;
comment on function public.erp_retention_report_rows(uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) rename to erp_retention_report_page_u2c3_internal;
revoke all on function public.erp_retention_report_page_u2c3_internal(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_retention_report_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_type text default 'ALL',
  p_status text default null,
  p_supplier_id text default null,
  p_customer_id text default null,
  p_retention_code text default null,
  p_retention_number text default null,
  p_document_number text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.retention_report.view');
  return public.erp_retention_report_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_type, p_status, p_supplier_id, p_customer_id, p_retention_code, p_retention_number, p_document_number, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_retention_report_legacy_detail(uuid,text) rename to erp_retention_report_legacy_detail_u2c3_internal;
revoke all on function public.erp_retention_report_legacy_detail_u2c3_internal(uuid,text) from public, anon, authenticated, service_role;

create function public.erp_retention_report_legacy_detail(
  p_company_id uuid,
  p_retention_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.retention_report.view');
  return public.erp_retention_report_legacy_detail_u2c3_internal(p_company_id, p_retention_id);
end;
$$;

revoke all on function public.erp_retention_report_legacy_detail(uuid,text) from public, anon, service_role;
grant execute on function public.erp_retention_report_legacy_detail(uuid,text) to authenticated;
comment on function public.erp_retention_report_legacy_detail(uuid,text) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_settlement_candidates(uuid,uuid,date,date,text,integer) rename to erp_supplier_settlement_candidates_u2c3_internal;
revoke all on function public.erp_supplier_settlement_candidates_u2c3_internal(uuid,uuid,date,date,text,integer) from public, anon, authenticated, service_role;

create function public.erp_supplier_settlement_candidates(
  p_company_id uuid,
  p_provider_id uuid,
  p_period_start date,
  p_period_end date,
  p_quantity_type text default 'STEM',
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.settlements.view');
  return public.erp_supplier_settlement_candidates_u2c3_internal(p_company_id, p_provider_id, p_period_start, p_period_end, p_quantity_type, p_limit);
end;
$$;

revoke all on function public.erp_supplier_settlement_candidates(uuid,uuid,date,date,text,integer) from public, anon, service_role;
grant execute on function public.erp_supplier_settlement_candidates(uuid,uuid,date,date,text,integer) to authenticated;
comment on function public.erp_supplier_settlement_candidates(uuid,uuid,date,date,text,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_settlement_history_page(uuid,date,date,uuid,text,text,text,integer,integer) rename to erp_supplier_settlement_history_page_u2c3_internal;
revoke all on function public.erp_supplier_settlement_history_page_u2c3_internal(uuid,date,date,uuid,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_supplier_settlement_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_provider_id uuid default null,
  p_status text default null,
  p_reference text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.settlements.view');
  return public.erp_supplier_settlement_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_provider_id, p_status, p_reference, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_supplier_settlement_history_page(uuid,date,date,uuid,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_supplier_settlement_history_page(uuid,date,date,uuid,text,text,text,integer,integer) to authenticated;
comment on function public.erp_supplier_settlement_history_page(uuid,date,date,uuid,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_supplier_settlement_detail(uuid,uuid) rename to erp_supplier_settlement_detail_u2c3_internal;
revoke all on function public.erp_supplier_settlement_detail_u2c3_internal(uuid,uuid) from public, anon, authenticated, service_role;

create function public.erp_supplier_settlement_detail(
  p_company_id uuid,
  p_settlement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'purchases.settlements.view');
  return public.erp_supplier_settlement_detail_u2c3_internal(p_company_id, p_settlement_id);
end;
$$;

revoke all on function public.erp_supplier_settlement_detail(uuid,uuid) from public, anon, service_role;
grant execute on function public.erp_supplier_settlement_detail(uuid,uuid) to authenticated;
comment on function public.erp_supplier_settlement_detail(uuid,uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer) rename to erp_treasury_movements_page_u2c3_internal;
revoke all on function public.erp_treasury_movements_page_u2c3_internal(uuid,uuid,date,date,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_treasury_movements_page(
  p_company_id uuid,
  p_bank_account_id uuid,
  p_date_from date,
  p_date_to date,
  p_type text default null,
  p_status text default null,
  p_origin text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.movements.view');
  return public.erp_treasury_movements_page_u2c3_internal(p_company_id, p_bank_account_id, p_date_from, p_date_to, p_type, p_status, p_origin, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer) to authenticated;
comment on function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_treasury_reconciliation_history_page(uuid,date,date,uuid,text,text,text,integer,integer) rename to erp_treasury_reconciliation_history_page_u2c3_internal;
revoke all on function public.erp_treasury_reconciliation_history_page_u2c3_internal(uuid,date,date,uuid,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_treasury_reconciliation_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_bank_account_id uuid default null,
  p_status text default null,
  p_reference text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.reconciliation.view');
  return public.erp_treasury_reconciliation_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_bank_account_id, p_status, p_reference, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_treasury_reconciliation_history_page(uuid,date,date,uuid,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_treasury_reconciliation_history_page(uuid,date,date,uuid,text,text,text,integer,integer) to authenticated;
comment on function public.erp_treasury_reconciliation_history_page(uuid,date,date,uuid,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_treasury_reconciliation_workspace(uuid,uuid,date,date,uuid,integer) rename to erp_treasury_reconciliation_workspace_u2c3_internal;
revoke all on function public.erp_treasury_reconciliation_workspace_u2c3_internal(uuid,uuid,date,date,uuid,integer) from public, anon, authenticated, service_role;

create function public.erp_treasury_reconciliation_workspace(
  p_company_id uuid,
  p_bank_account_id uuid,
  p_date_from date,
  p_date_to date,
  p_reconciliation_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.reconciliation.view');
  return public.erp_treasury_reconciliation_workspace_u2c3_internal(p_company_id, p_bank_account_id, p_date_from, p_date_to, p_reconciliation_id, p_limit);
end;
$$;

revoke all on function public.erp_treasury_reconciliation_workspace(uuid,uuid,date,date,uuid,integer) from public, anon, service_role;
grant execute on function public.erp_treasury_reconciliation_workspace(uuid,uuid,date,date,uuid,integer) to authenticated;
comment on function public.erp_treasury_reconciliation_workspace(uuid,uuid,date,date,uuid,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_treasury_reconciliation_detail(uuid,uuid) rename to erp_treasury_reconciliation_detail_u2c3_internal;
revoke all on function public.erp_treasury_reconciliation_detail_u2c3_internal(uuid,uuid) from public, anon, authenticated, service_role;

create function public.erp_treasury_reconciliation_detail(
  p_company_id uuid,
  p_reconciliation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.reconciliation.view');
  return public.erp_treasury_reconciliation_detail_u2c3_internal(p_company_id, p_reconciliation_id);
end;
$$;

revoke all on function public.erp_treasury_reconciliation_detail(uuid,uuid) from public, anon, service_role;
grant execute on function public.erp_treasury_reconciliation_detail(uuid,uuid) to authenticated;
comment on function public.erp_treasury_reconciliation_detail(uuid,uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_treasury_transfers_history_page(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer) rename to erp_treasury_transfers_history_page_u2c3_internal;
revoke all on function public.erp_treasury_transfers_history_page_u2c3_internal(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer) from public, anon, authenticated, service_role;

create function public.erp_treasury_transfers_history_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_source_account_type text default null,
  p_source_account_id uuid default null,
  p_destination_account_type text default null,
  p_destination_account_id uuid default null,
  p_status text default null,
  p_reference text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.transfers.view');
  return public.erp_treasury_transfers_history_page_u2c3_internal(p_company_id, p_date_from, p_date_to, p_source_account_type, p_source_account_id, p_destination_account_type, p_destination_account_id, p_status, p_reference, p_search, p_limit, p_offset);
end;
$$;

revoke all on function public.erp_treasury_transfers_history_page(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer) from public, anon, service_role;
grant execute on function public.erp_treasury_transfers_history_page(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer) to authenticated;
comment on function public.erp_treasury_transfers_history_page(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


alter function public.erp_treasury_transfer_detail(uuid,uuid) rename to erp_treasury_transfer_detail_u2c3_internal;
revoke all on function public.erp_treasury_transfer_detail_u2c3_internal(uuid,uuid) from public, anon, authenticated, service_role;

create function public.erp_treasury_transfer_detail(
  p_company_id uuid,
  p_transfer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_security_assert_capability(p_company_id, 'treasury.transfers.view');
  return public.erp_treasury_transfer_detail_u2c3_internal(p_company_id, p_transfer_id);
end;
$$;

revoke all on function public.erp_treasury_transfer_detail(uuid,uuid) from public, anon, service_role;
grant execute on function public.erp_treasury_transfer_detail(uuid,uuid) to authenticated;
comment on function public.erp_treasury_transfer_detail(uuid,uuid) is
  'U2C3 capability-guarded read entrypoint; original company guard and read contract are preserved internally.';


drop policy if exists erp_entity_records_company_member_select on public.erp_entity_records;
create policy erp_entity_records_company_member_select on public.erp_entity_records for select to authenticated
using (public.erp_u2c3_can_read_entity(company_id,entity));

drop policy if exists erp_sync_operations_company_member_select on public.erp_sync_operations;
create policy erp_sync_operations_company_member_select on public.erp_sync_operations for select to authenticated
using (user_id=auth.uid() and public.erp_u2c3_can_read_entity(company_id,entity));

drop policy if exists accounting_document_links_select_member on public.accounting_document_links;
create policy accounting_document_links_select_member on public.accounting_document_links for select to authenticated
using (sri_is_company_member(company_id, auth.uid()) and public.erp_u2c3_has_any_capability(company_id, array['accounting.journal.view','purchases.documents.view','commercial.electronic_documents.view' ]::text[]));

drop policy if exists electronic_documents_select_member on public.electronic_documents;
create policy electronic_documents_select_member on public.electronic_documents for select to authenticated
using (sri_is_company_member(company_id, auth.uid()) and public.erp_u2c3_has_any_capability(company_id, array['commercial.electronic_documents.view' ]::text[]));

drop policy if exists erp_company_state_select_member on public.erp_company_state;
create policy erp_company_state_select_member on public.erp_company_state for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['admin.company_state.view' ]::text[]));

drop policy if exists erp_financial_collection_applications_member_select on public.erp_financial_collection_applications;
create policy erp_financial_collection_applications_member_select on public.erp_financial_collection_applications for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.collections.view' ]::text[]));

drop policy if exists erp_financial_collections_member_select on public.erp_financial_collections;
create policy erp_financial_collections_member_select on public.erp_financial_collections for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.collections.view' ]::text[]));

drop policy if exists erp_financial_credit_notes_member_select on public.erp_financial_credit_notes;
create policy erp_financial_credit_notes_member_select on public.erp_financial_credit_notes for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['commercial.credit_notes.view' ]::text[]));

drop policy if exists erp_financial_journal_entries_member_select on public.erp_financial_journal_entries;
create policy erp_financial_journal_entries_member_select on public.erp_financial_journal_entries for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['accounting.journal.view' ]::text[]));

drop policy if exists erp_financial_journal_lines_member_select on public.erp_financial_journal_lines;
create policy erp_financial_journal_lines_member_select on public.erp_financial_journal_lines for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['accounting.journal.view' ]::text[]));

drop policy if exists erp_financial_receivables_member_select on public.erp_financial_receivables;
create policy erp_financial_receivables_member_select on public.erp_financial_receivables for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['portfolio.receivables.view' ]::text[]));

drop policy if exists erp_supplier_accounts_payable_member_select on public.erp_supplier_accounts_payable;
create policy erp_supplier_accounts_payable_member_select on public.erp_supplier_accounts_payable for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['portfolio.payables.view' ]::text[]));

drop policy if exists erp_supplier_payment_applications_member_select on public.erp_supplier_payment_applications;
create policy erp_supplier_payment_applications_member_select on public.erp_supplier_payment_applications for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.payments.view' ]::text[]));

drop policy if exists erp_supplier_payments_member_select on public.erp_supplier_payments;
create policy erp_supplier_payments_member_select on public.erp_supplier_payments for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.payments.view' ]::text[]));

drop policy if exists erp_supplier_providers_member_select on public.erp_supplier_providers;
create policy erp_supplier_providers_member_select on public.erp_supplier_providers for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['purchases.providers.view','portfolio.suppliers.view' ]::text[]));

drop policy if exists erp_supplier_purchase_documents_member_select on public.erp_supplier_purchase_documents;
create policy erp_supplier_purchase_documents_member_select on public.erp_supplier_purchase_documents for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['purchases.documents.view' ]::text[]));

drop policy if exists erp_supplier_purchase_lines_member_select on public.erp_supplier_purchase_lines;
create policy erp_supplier_purchase_lines_member_select on public.erp_supplier_purchase_lines for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['purchases.documents.view' ]::text[]));

drop policy if exists erp_supplier_purchase_withholding_links_member_select on public.erp_supplier_purchase_withholding_links;
create policy erp_supplier_purchase_withholding_links_member_select on public.erp_supplier_purchase_withholding_links for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['purchases.withholdings.view' ]::text[]));

drop policy if exists erp_supplier_reception_cost_allocations_member_select on public.erp_supplier_reception_cost_allocations;
create policy erp_supplier_reception_cost_allocations_member_select on public.erp_supplier_reception_cost_allocations for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['purchases.settlements.view' ]::text[]));

drop policy if exists erp_supplier_settlement_lines_member_select on public.erp_supplier_settlement_lines;
create policy erp_supplier_settlement_lines_member_select on public.erp_supplier_settlement_lines for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['purchases.settlements.view' ]::text[]));

drop policy if exists erp_supplier_settlements_member_select on public.erp_supplier_settlements;
create policy erp_supplier_settlements_member_select on public.erp_supplier_settlements for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['purchases.settlements.view' ]::text[]));

drop policy if exists erp_treasury_bank_accounts_member_select on public.erp_treasury_bank_accounts;
create policy erp_treasury_bank_accounts_member_select on public.erp_treasury_bank_accounts for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.accounts.view','treasury.payments.view','treasury.collections.view','treasury.reconciliation.view','treasury.transfers.view','payroll.accounting_settings.view' ]::text[]));

drop policy if exists erp_treasury_bank_transactions_member_select on public.erp_treasury_bank_transactions;
create policy erp_treasury_bank_transactions_member_select on public.erp_treasury_bank_transactions for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.movements.view' ]::text[]));

drop policy if exists erp_treasury_cash_transactions_member_select on public.erp_treasury_cash_transactions;
create policy erp_treasury_cash_transactions_member_select on public.erp_treasury_cash_transactions for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.movements.view' ]::text[]));

drop policy if exists erp_treasury_reconciliation_matches_member_select on public.erp_treasury_reconciliation_matches;
create policy erp_treasury_reconciliation_matches_member_select on public.erp_treasury_reconciliation_matches for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.reconciliation.view' ]::text[]));

drop policy if exists erp_treasury_reconciliation_reviews_member_select on public.erp_treasury_reconciliation_reviews;
create policy erp_treasury_reconciliation_reviews_member_select on public.erp_treasury_reconciliation_reviews for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.reconciliation.view' ]::text[]));

drop policy if exists erp_treasury_reconciliations_member_select on public.erp_treasury_reconciliations;
create policy erp_treasury_reconciliations_member_select on public.erp_treasury_reconciliations for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.reconciliation.view' ]::text[]));

drop policy if exists erp_treasury_transfers_member_select on public.erp_treasury_transfers;
create policy erp_treasury_transfers_member_select on public.erp_treasury_transfers for select to authenticated
using (public.erp_u2c3_has_any_capability(company_id, array['treasury.transfers.view' ]::text[]));

drop policy if exists sri_transmissions_select_member on public.sri_transmissions;
create policy sri_transmissions_select_member on public.sri_transmissions for select to authenticated
using (sri_is_company_member(company_id, auth.uid()) and public.erp_u2c3_has_any_capability(company_id, array['commercial.electronic_documents.view' ]::text[]));

do $$ begin
  if (select count(*) from public.erp_u2c3_read_rpc_capabilities)<>53 then raise exception 'U2C3_READ_RPC_MAP_COUNT'; end if;
  if exists(select 1 from public.erp_u2c3_read_rpc_capabilities r left join public.erp_security_capabilities c using(capability_id) where c.capability_id is null or not c.active) then raise exception 'U2C3_READ_RPC_UNKNOWN_CAPABILITY'; end if;
  if exists(select 1 from public.erp_u2c3_entity_read_capabilities r left join public.erp_security_capabilities c using(capability_id) where c.capability_id is null or not c.active) then raise exception 'U2C3_ENTITY_UNKNOWN_CAPABILITY'; end if;
end $$;

notify pgrst,'reload schema';
commit;
