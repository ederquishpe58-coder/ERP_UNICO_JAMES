-- CONT-C / Punto 1: Dashboard contable agregado y generate-first.
-- READ-ONLY: no modifica mutaciones, proyecciones ni sincronizacion global.

create or replace function public.erp_accounting_dashboard_health(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok', true,
    'component', 'ACCOUNTING_DASHBOARD_READ_V2',
    'migration', '202608230013',
    'summaryRpc', to_regprocedure('public.erp_accounting_dashboard_summary(uuid,date,date,text,text)') is not null,
    'purchaseAuthority', to_regprocedure('public.erp_purchase_invoice_read_rows(uuid)') is not null,
    'payableAuthority', to_regprocedure('public.erp_supplier_payable_read_rows(uuid)') is not null,
    'receivableAuthority', to_regprocedure('public.erp_customer_receivable_read_rows(uuid)') is not null,
    'treasuryAuthority', to_regclass('public.erp_treasury_v2_bank_balances') is not null,
    'journalAuthority', to_regclass('public.erp_financial_journal_entries') is not null,
    'inventoryProjection', to_regclass('public.erp_entity_records') is not null
  );
end
$$;

create or replace function public.erp_accounting_dashboard_summary(
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
declare
  v_period text := btrim(coalesce(p_period, ''));
  v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'ACCOUNTING_DASHBOARD_DATE_RANGE_REQUIRED';
  end if;
  if v_period !~ '^\d{4}-\d{2}$' then
    raise exception using errcode = '22023', message = 'ACCOUNTING_DASHBOARD_PERIOD_REQUIRED';
  end if;

  with
  purchase_metric as (
    select coalesce(sum(row.total), 0)::numeric as total_purchases
    from public.erp_purchase_invoice_read_rows(p_company_id) row
    where coalesce(row.accounting_date, row.issue_date) between p_date_from and p_date_to
      and (
        nullif(upper(btrim(p_purchase_status)), '') is not null
        or row.status <> 'ANULADO'
      )
      and (
        nullif(upper(btrim(p_purchase_status)), '') is null
        or row.status = upper(btrim(p_purchase_status))
      )
  ),
  payable_metric as (
    select coalesce(sum(row.balance), 0)::numeric as pending_payables
    from public.erp_supplier_payable_read_rows(p_company_id) row
    where row.state in ('PENDIENTE', 'PARCIAL', 'VENCIDO')
      and row.state <> 'ANULADO'
  ),
  receivable_metric as (
    select coalesce(sum(row.balance), 0)::numeric as pending_receivables
    from public.erp_customer_receivable_read_rows(p_company_id) row
    where row.status in ('PENDIENTE', 'PARCIAL', 'VENCIDO')
      and row.status <> 'ANULADO'
  ),
  journal_candidates as (
    select
      entry.journal_entry_id::text as entry_id,
      entry.accounting_period,
      case entry.status
        when 'DRAFT' then 'BORRADOR'
        when 'POSTED' then 'CONTABILIZADO'
        when 'REVERSED' then 'REVERSADO'
        when 'CANCELLED' then 'ANULADO'
        else entry.status
      end as status,
      (entry.total_debit - entry.total_credit)::numeric as difference,
      2 as priority
    from public.erp_financial_journal_entries entry
    where entry.company_id = p_company_id
    union all
    select
      record.record_id,
      coalesce(nullif(record.payload ->> 'accountingPeriod', ''), left(record.payload ->> 'accountingDate', 7)),
      upper(coalesce(nullif(record.payload ->> 'status', ''), 'BORRADOR')),
      coalesce((
        select sum(
          case when coalesce(line ->> 'debit', '') ~ '^-?\d+(\.\d+)?$' then (line ->> 'debit')::numeric else 0 end
          - case when coalesce(line ->> 'credit', '') ~ '^-?\d+(\.\d+)?$' then (line ->> 'credit')::numeric else 0 end
        )
        from jsonb_array_elements(coalesce(record.payload -> 'lines', '[]'::jsonb)) lines(line)
      ), 0),
      1
    from public.erp_entity_records record
    where record.company_id = p_company_id
      and record.entity = 'accounting_journal_entries'
      and record.deleted_at is null
      and not exists (
        select 1
        from public.erp_financial_journal_entries migrated
        where migrated.company_id = record.company_id
          and (migrated.journal_entry_id::text = record.record_id
            or migrated.legacy_draft_id = record.record_id)
      )
  ),
  journal_ranked as (
    select *, row_number() over (partition by entry_id order by priority desc) as winner
    from journal_candidates
  ),
  journal_metric as (
    select
      count(*) filter (where status = 'CONTABILIZADO')::bigint as journal_posted,
      count(*) filter (where status = 'BORRADOR')::bigint as journal_drafts,
      count(*) filter (where abs(difference) > 0.005)::bigint as accounting_alerts
    from journal_ranked
    where winner = 1 and accounting_period = v_period
  ),
  canonical_bank_metric as (
    select coalesce(sum(balance.expected_treasury_balance), 0)::numeric as canonical_balance
    from public.erp_treasury_v2_bank_balances balance
    where balance.company_id = p_company_id
  ),
  legacy_bank_accounts as (
    select
      account.record_id as account_id,
      case when coalesce(account.payload ->> 'openingBalance', '') ~ '^-?\d+(\.\d+)?$'
        then (account.payload ->> 'openingBalance')::numeric else 0 end as opening_balance
    from public.erp_entity_records account
    where account.company_id = p_company_id
      and account.entity = 'bank_accounts'
      and account.deleted_at is null
      and not exists (
        select 1 from public.erp_treasury_bank_accounts canonical
        where canonical.company_id = account.company_id
          and (canonical.bank_account_id::text = account.record_id or canonical.legacy_id = account.record_id)
      )
  ),
  legacy_bank_metric as (
    select coalesce(sum(account.opening_balance + coalesce(movement.net, 0)), 0)::numeric as legacy_balance
    from legacy_bank_accounts account
    left join lateral (
      select sum(
        case when coalesce(record.payload ->> 'incomeValue', '') ~ '^-?\d+(\.\d+)?$'
          then (record.payload ->> 'incomeValue')::numeric else 0 end
        - case when coalesce(record.payload ->> 'expenseValue', '') ~ '^-?\d+(\.\d+)?$'
          then (record.payload ->> 'expenseValue')::numeric else 0 end
      )::numeric as net
      from public.erp_entity_records record
      where record.company_id = p_company_id
        and record.entity = 'bank_movements'
        and record.deleted_at is null
        and record.payload ->> 'bankAccountId' = account.account_id
        and upper(coalesce(record.payload ->> 'status', '')) = 'CONTABILIZADO'
    ) movement on true
  ),
  issued_candidates as (
    select document.id::text as retention_id, upper(document.status) as status, 2 as priority
    from public.erp_supplier_purchase_withholding_links link
    join public.electronic_documents document
      on document.company_id = link.company_id and document.id = link.electronic_document_id
    where link.company_id = p_company_id and document.document_type = '07'
    union all
    select legacy.record_id, upper(coalesce(nullif(legacy.payload ->> 'status', ''), 'BORRADOR')), 1
    from public.erp_entity_records legacy
    where legacy.company_id = p_company_id
      and legacy.entity = 'issued_withholdings'
      and legacy.deleted_at is null
      and not exists (
        select 1 from public.electronic_documents document
        where document.company_id = p_company_id
          and document.document_type = '07'
          and (document.id::text = legacy.record_id
            or document.access_key = legacy.payload ->> 'accessKey'
            or document.authorization_number = legacy.payload ->> 'authorizationNumber')
      )
  ),
  issued_ranked as (
    select *, row_number() over (partition by retention_id order by priority desc) winner
    from issued_candidates
  ),
  issued_metric as (
    select count(*) filter (where status in ('BORRADOR', 'DRAFT', 'LISTA_PARA_AUTORIZAR'))::bigint as pending_issued
    from issued_ranked where winner = 1
  ),
  received_metric as (
    select count(*) filter (where row.status in ('PENDIENTE_RELACION', 'IMPORTADO'))::bigint as pending_received
    from public.erp_received_withholding_read_rows(p_company_id) row
  ),
  reconciliation_candidates as (
    select reconciliation.reconciliation_id::text as reconciliation_id,
      case reconciliation.status when 'OPEN' then 'BORRADOR' when 'IN_REVIEW' then 'EN_REVISION'
        when 'CLOSED' then 'CERRADA' when 'REOPENED' then 'REABIERTA' when 'CANCELLED' then 'ANULADA'
        else reconciliation.status end as status,
      2 as priority
    from public.erp_treasury_reconciliations reconciliation
    where reconciliation.company_id = p_company_id
    union all
    select legacy.record_id, upper(coalesce(nullif(legacy.payload ->> 'status', ''), 'BORRADOR')), 1
    from public.erp_entity_records legacy
    where legacy.company_id = p_company_id
      and legacy.entity = 'bank_reconciliations'
      and legacy.deleted_at is null
      and not exists (
        select 1 from public.erp_treasury_reconciliations canonical
        where canonical.company_id = legacy.company_id
          and canonical.reconciliation_id::text = legacy.record_id
      )
  ),
  reconciliation_ranked as (
    select *, row_number() over (partition by reconciliation_id order by priority desc) winner
    from reconciliation_candidates
  ),
  reconciliation_metric as (
    select
      count(*) filter (where status in ('BORRADOR', 'EN_REVISION', 'REABIERTA'))::bigint as open_reconciliations,
      count(*) filter (where status = 'CERRADA')::bigint as closed_reconciliations
    from reconciliation_ranked where winner = 1
  ),
  inventory_items as (
    select
      item.record_id as item_id,
      coalesce(item.payload ->> 'warehouseId', '') as warehouse_id,
      case when coalesce(item.payload ->> 'minStock', '') ~ '^-?\d+(\.\d+)?$'
        then (item.payload ->> 'minStock')::numeric else 0 end as min_stock
    from public.erp_entity_records item
    where item.company_id = p_company_id and item.entity = 'inventory_items' and item.deleted_at is null
  ),
  inventory_balances as (
    select item.item_id, item.min_stock,
      coalesce(sum(case
        when upper(coalesce(movement.payload ->> 'status', '')) <> 'CONFIRMADO' then 0
        when upper(coalesce(movement.payload ->> 'movementType', '')) = 'TRANSFERENCIA_BODEGA'
          and movement.payload ->> 'warehouseFromId' = item.warehouse_id then -line.quantity
        when upper(coalesce(movement.payload ->> 'movementType', '')) = 'TRANSFERENCIA_BODEGA'
          and movement.payload ->> 'warehouseToId' = item.warehouse_id then line.quantity
        when coalesce(nullif(movement.payload ->> 'warehouseToId', ''), nullif(movement.payload ->> 'warehouseFromId', ''), '') = item.warehouse_id
          and upper(coalesce(movement.payload ->> 'movementType', '')) in ('ENTRADA_COMPRA', 'ENTRADA_AJUSTE', 'AJUSTE_POSITIVO') then line.quantity
        when coalesce(nullif(movement.payload ->> 'warehouseToId', ''), nullif(movement.payload ->> 'warehouseFromId', ''), '') = item.warehouse_id
          and upper(coalesce(movement.payload ->> 'movementType', '')) in ('SALIDA_CONSUMO', 'SALIDA_PROVEEDOR', 'SALIDA_EMPAQUE', 'SALIDA_CAMPO', 'AJUSTE_NEGATIVO') then -line.quantity
        else 0 end), 0)::numeric as quantity,
      coalesce(sum(case
        when upper(coalesce(movement.payload ->> 'status', '')) <> 'CONFIRMADO' then 0
        when upper(coalesce(movement.payload ->> 'movementType', '')) = 'TRANSFERENCIA_BODEGA'
          and movement.payload ->> 'warehouseFromId' = item.warehouse_id then -line.cost_total
        when upper(coalesce(movement.payload ->> 'movementType', '')) = 'TRANSFERENCIA_BODEGA'
          and movement.payload ->> 'warehouseToId' = item.warehouse_id then line.cost_total
        when coalesce(nullif(movement.payload ->> 'warehouseToId', ''), nullif(movement.payload ->> 'warehouseFromId', ''), '') = item.warehouse_id
          and upper(coalesce(movement.payload ->> 'movementType', '')) in ('ENTRADA_COMPRA', 'ENTRADA_AJUSTE', 'AJUSTE_POSITIVO') then line.cost_total
        when coalesce(nullif(movement.payload ->> 'warehouseToId', ''), nullif(movement.payload ->> 'warehouseFromId', ''), '') = item.warehouse_id
          and upper(coalesce(movement.payload ->> 'movementType', '')) in ('SALIDA_CONSUMO', 'SALIDA_PROVEEDOR', 'SALIDA_EMPAQUE', 'SALIDA_CAMPO', 'AJUSTE_NEGATIVO') then -line.cost_total
        else 0 end), 0)::numeric as inventory_value
    from inventory_items item
    left join public.erp_entity_records movement
      on movement.company_id = p_company_id and movement.entity = 'material_inventory_movements' and movement.deleted_at is null
    left join lateral (
      select
        coalesce(entry ->> 'itemId', '') as item_id,
        case when coalesce(entry ->> 'quantity', '') ~ '^-?\d+(\.\d+)?$' then (entry ->> 'quantity')::numeric else 0 end as quantity,
        case when coalesce(entry ->> 'costTotal', '') ~ '^-?\d+(\.\d+)?$' then (entry ->> 'costTotal')::numeric else 0 end as cost_total
      from jsonb_array_elements(coalesce(movement.payload -> 'lines', '[]'::jsonb)) entries(entry)
    ) line on line.item_id = item.item_id
    group by item.item_id, item.min_stock
  ),
  inventory_metric as (
    select
      count(*) filter (where balance.quantity > 0 and balance.min_stock > 0 and balance.quantity <= balance.min_stock)::bigint as low_stock_products,
      coalesce(sum(balance.inventory_value), 0)::numeric as inventory_value
    from inventory_balances balance
  )
  select jsonb_build_object(
    'ok', true,
    'filters', jsonb_build_object('period', v_period, 'dateFrom', p_date_from, 'dateTo', p_date_to,
      'purchaseStatus', coalesce(upper(nullif(btrim(p_purchase_status), '')), '')),
    'summary', jsonb_build_object(
      'totalPurchases', round(purchase.total_purchases, 2),
      'pendingPayables', round(payable.pending_payables, 2),
      'pendingReceivables', round(receivable.pending_receivables, 2),
      'totalBankAuxiliary', round(bank.canonical_balance + legacy_bank.legacy_balance, 2),
      'journalPosted', journal.journal_posted,
      'journalDrafts', journal.journal_drafts,
      'pendingIssuedWithholdings', issued.pending_issued,
      'pendingReceivedWithholdings', received.pending_received,
      'lowStockProducts', inventory.low_stock_products,
      'openReconciliations', reconciliation.open_reconciliations,
      'closedReconciliations', reconciliation.closed_reconciliations,
      'inventoryValue', round(inventory.inventory_value, 2),
      'accountingAlerts', journal.accounting_alerts
    ),
    'series', '{}'::jsonb,
    'meta', jsonb_build_object(
      'generatedAt', clock_timestamp(),
      'queries', 1,
      'rawRowsReturned', 0,
      'legacyPolicy', 'V2_WINS_LEGACY_ONLY'
    )
  ) into v_summary
  from purchase_metric purchase
  cross join payable_metric payable
  cross join receivable_metric receivable
  cross join journal_metric journal
  cross join canonical_bank_metric bank
  cross join legacy_bank_metric legacy_bank
  cross join issued_metric issued
  cross join received_metric received
  cross join reconciliation_metric reconciliation
  cross join inventory_metric inventory;

  return v_summary;
end
$$;

revoke all on function public.erp_accounting_dashboard_health(uuid) from public, anon;
revoke all on function public.erp_accounting_dashboard_summary(uuid,date,date,text,text) from public, anon;
grant execute on function public.erp_accounting_dashboard_health(uuid) to authenticated, service_role;
grant execute on function public.erp_accounting_dashboard_summary(uuid,date,date,text,text) to authenticated, service_role;

comment on function public.erp_accounting_dashboard_summary(uuid,date,date,text,text)
  is 'READ-ONLY: KPIs compactos del Dashboard contable; V2 prevalece y el legado solo cubre historia no migrada.';
