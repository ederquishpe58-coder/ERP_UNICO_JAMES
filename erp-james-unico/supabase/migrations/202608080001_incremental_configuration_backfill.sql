begin;

-- Migra configuraciones conservadas en el snapshot histórico hacia la fuente
-- incremental oficial. Es aditiva: no borra datos y nunca reemplaza un registro
-- que ya fue confirmado en erp_entity_records.
with collection_sources as (
  select company_id, 'accounting_chart_accounts'::text as entity, state_json -> 'chartOfAccounts' as items from public.erp_company_state
  union all select company_id, 'accounting_tax_parameters', state_json -> 'taxParameters' from public.erp_company_state
  union all select company_id, 'accounting_retention_parameters', state_json -> 'retentionParameters' from public.erp_company_state
  union all select company_id, 'accounting_tax_supports', state_json -> 'taxSupports' from public.erp_company_state
  union all select company_id, 'accounting_purchase_types', state_json -> 'purchaseTypes' from public.erp_company_state
  union all select company_id, 'accounting_purchase_memory', state_json -> 'purchaseMemory' from public.erp_company_state
  union all select company_id, 'accounting_document_sequences', state_json -> 'documentSequences' from public.erp_company_state
  union all select company_id, 'accounting_cost_centers', state_json -> 'costCenters' from public.erp_company_state
  union all select company_id, 'inventory_warehouses', state_json -> 'inventoryWarehouses' from public.erp_company_state
  union all select company_id, 'inventory_items', state_json -> 'inventoryItems' from public.erp_company_state
  union all select company_id, 'inventory_responsibles', state_json -> 'inventoryResponsibles' from public.erp_company_state
  union all select company_id, 'tax_ats_history', state_json -> 'atsHistory' from public.erp_company_state
  union all select company_id, 'commercial_customers', state_json #> '{commercial,customerCatalog}' from public.erp_company_state
  union all select company_id, 'commercial_brands', state_json #> '{commercial,brandCatalog}' from public.erp_company_state
  union all select company_id, 'commercial_agencies', state_json #> '{commercial,agencyCatalog}' from public.erp_company_state
  union all select company_id, 'commercial_airlines', state_json #> '{commercial,airlineCatalog}' from public.erp_company_state
  union all select company_id, 'commercial_countries', state_json #> '{commercial,countryCatalog}' from public.erp_company_state
  union all select company_id, 'commercial_dae', state_json #> '{commercial,daeCatalog}' from public.erp_company_state
  union all select company_id, 'commercial_destinations', state_json #> '{commercial,destinationCatalog}' from public.erp_company_state
  union all select company_id, 'operations_suppliers', state_json #> '{operations,masterData,suppliers}' from public.erp_company_state
  union all select company_id, 'operations_classifiers', state_json #> '{operations,masterData,classifiers}' from public.erp_company_state
  union all select company_id, 'operations_bunchers', state_json #> '{operations,masterData,bunchers}' from public.erp_company_state
  union all select company_id, 'operations_receptionists', state_json #> '{operations,masterData,receptionists}' from public.erp_company_state
  union all select company_id, 'operations_digitizers', state_json #> '{operations,masterData,digitizers}' from public.erp_company_state
  union all select company_id, 'operations_scanners', state_json #> '{operations,masterData,scanners}' from public.erp_company_state
  union all select company_id, 'operations_responsibles', state_json #> '{operations,masterData,responsibles}' from public.erp_company_state
  union all select company_id, 'operations_varieties', state_json #> '{operations,masterData,varieties}' from public.erp_company_state
  union all select company_id, 'operations_lengths', state_json #> '{operations,masterData,lengths}' from public.erp_company_state
  union all select company_id, 'operations_stem_types', state_json #> '{operations,masterData,stemTypes}' from public.erp_company_state
  union all select company_id, 'operations_label_types', state_json #> '{operations,masterData,labelTypes}' from public.erp_company_state
  union all select company_id, 'operations_yield_workday_history', state_json #> '{operations,yieldWorkdayHistory}' from public.erp_company_state
  union all select company_id, 'payroll_rate_rules', state_json #> '{payroll,rate_rules}' from public.erp_company_state
  union all select company_id, 'payroll_obligation_settings', state_json #> '{payroll,obligation_settings}' from public.erp_company_state
), collection_rows as (
  select
    source.company_id,
    source.entity,
    item.value as payload,
    coalesce(
      nullif(item.value ->> 'id', ''),
      nullif(item.value ->> 'code', ''),
      nullif(item.value ->> 'number', ''),
      nullif(item.value ->> 'document', ''),
      nullif(item.value ->> 'inventoryId', ''),
      nullif(item.value ->> 'inventory_id', ''),
      md5(item.value::text)
    ) as record_id
  from collection_sources source
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(source.items) = 'array' then source.items else '[]'::jsonb end
  ) as item(value)
  where jsonb_typeof(item.value) = 'object'
)
insert into public.erp_entity_records(company_id, entity, record_id, payload, version)
select company_id, entity, record_id, payload, 1
from collection_rows
on conflict (company_id, entity, record_id) do nothing;

with singleton_sources as (
  select company_id, 'company_settings'::text as entity, 'company_settings'::text as record_id,
         state_json -> 'companySettings' as payload
  from public.erp_company_state
  union all
  select company_id, 'tax_ats_config', 'tax_ats_config', state_json -> 'atsConfig'
  from public.erp_company_state
  union all
  select company_id, 'operations_yield_workday', 'operations_yield_workday', state_json #> '{operations,yieldWorkday}'
  from public.erp_company_state
  union all
  select company_id, 'operations_yield_settings', 'operations_yield_settings', state_json #> '{operations,yieldSettings}'
  from public.erp_company_state
)
insert into public.erp_entity_records(company_id, entity, record_id, payload, version)
select company_id, entity, record_id, payload, 1
from singleton_sources
where jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb
on conflict (company_id, entity, record_id) do nothing;

comment on table public.erp_entity_records is
  'Fuente oficial incremental de JAEDER SYSTEMS por empresa, entidad y registro. erp_company_state queda como snapshot de respaldo.';

commit;
