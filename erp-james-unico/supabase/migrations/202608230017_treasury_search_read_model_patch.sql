-- PATCH READ-ONLY posterior a 202608230016.
-- Corrige dos deudas del read-model 202608230005 sin editar su migracion:
-- 1) entidad legacy bank_movements; 2) alias inexistente en la busqueda del listado.

create or replace function public.erp_treasury_search_v2_movement_rows(p_company_id uuid)
returns table(
  bank_transaction_id text,transaction_code text,transaction_date date,value_date date,bank_account_id uuid,
  direction text,amount numeric,currency_code text,description text,reference text,origin_type text,source_type text,source_id text,
  journal_entry_id text,reconciliation_status text,status text,account_code text,bank_name text,income_value numeric,expense_value numeric,
  origin_label text,derived boolean,canonical boolean
) language sql stable security definer set search_path=public,pg_temp as $$
  select t.bank_transaction_id::text,t.transaction_code,t.transaction_date,t.value_date,t.bank_account_id,t.direction,t.amount,t.currency_code,
    t.description,t.reference,t.origin_type,t.source_type,t.source_id,t.journal_entry_id::text,t.reconciliation_status,t.status,a.account_code,a.bank_name,
    case when t.direction='CREDIT' then t.amount else 0 end,case when t.direction='DEBIT' then t.amount else 0 end,
    case when t.origin_type='REAL_STATEMENT' then 'ESTADO_BANCO' when t.source_type='COLLECTION' then 'COBROS'
         when t.source_type='SUPPLIER_PAYMENT' then 'PAGOS' when t.source_type like 'TRANSFER%' then 'TRANSFERENCIAS'
         when t.source_type='ADJUSTMENT' then 'AJUSTES' when t.source_type='JOURNAL' then 'LIBRO_DIARIO'
         else coalesce(t.source_type,t.origin_type,'MANUAL') end,true,true
  from public.erp_treasury_bank_transactions t
  join public.erp_treasury_bank_accounts a using(company_id,bank_account_id)
  where t.company_id=p_company_id
  union all
  select 'JRN-'||e.journal_entry_id::text||'-'||l.line_number::text,e.entry_number,e.accounting_date,e.accounting_date,a.bank_account_id,
    case when l.debit>0 then 'CREDIT' else 'DEBIT' end,greatest(l.debit,l.credit),e.currency_code,
    coalesce(nullif(l.description,''),e.concept),coalesce(nullif(e.external_reference,''),e.source_document),'SYSTEM','JOURNAL',e.journal_entry_id::text,
    e.journal_entry_id::text,'UNRECONCILED','CONFIRMED',a.account_code,a.bank_name,l.debit,l.credit,
    'LIBRO_DIARIO · '||coalesce(nullif(e.origin_module,''),'MANUAL'),true,true
  from public.erp_financial_journal_entries e
  join public.erp_financial_journal_lines l using(company_id,journal_entry_id)
  join public.erp_treasury_bank_accounts a on a.company_id=l.company_id and a.ledger_account_code=l.account_code
  where e.company_id=p_company_id and e.status='POSTED' and (l.debit>0 or l.credit>0)
    and not exists(select 1 from public.erp_treasury_bank_transactions t where t.company_id=e.company_id and t.journal_entry_id=e.journal_entry_id)
  union all
  select e.record_id,coalesce(e.payload->>'movementNumber',e.record_id),
    case when coalesce(e.payload->>'movementDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'movementDate')::date end,
    case when coalesce(e.payload->>'movementDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'movementDate')::date end,
    a.bank_account_id,
    case when case when coalesce(e.payload->>'incomeValue','')~'^-?\d+(\.\d+)?$' then (e.payload->>'incomeValue')::numeric else 0 end>0 then 'CREDIT' else 'DEBIT' end,
    greatest(
      case when coalesce(e.payload->>'incomeValue','')~'^-?\d+(\.\d+)?$' then (e.payload->>'incomeValue')::numeric else 0 end,
      case when coalesce(e.payload->>'expenseValue','')~'^-?\d+(\.\d+)?$' then (e.payload->>'expenseValue')::numeric else 0 end
    ),coalesce(nullif(e.payload->>'currency',''),'USD'),coalesce(e.payload->>'concept',''),coalesce(e.payload->>'reference',''),'LEGACY',
    upper(coalesce(nullif(e.payload->>'sourceKind',''),'LEGACY')),nullif(e.payload->>'sourceId',''),nullif(e.payload->>'journalEntryId',''),'UNRECONCILED',
    case upper(coalesce(e.payload->>'status','BORRADOR')) when 'CONTABILIZADO' then 'CONFIRMED' when 'ANULADO' then 'VOIDED' else 'DRAFT' end,
    a.account_code,a.bank_name,
    case when coalesce(e.payload->>'incomeValue','')~'^-?\d+(\.\d+)?$' then (e.payload->>'incomeValue')::numeric else 0 end,
    case when coalesce(e.payload->>'expenseValue','')~'^-?\d+(\.\d+)?$' then (e.payload->>'expenseValue')::numeric else 0 end,
    'LEGACY · '||upper(coalesce(nullif(e.payload->>'originModule',''),'MANUAL')),false,false
  from public.erp_entity_records e
  join public.erp_treasury_bank_accounts a on a.company_id=e.company_id
    and (a.bank_account_id::text=e.payload->>'bankAccountId' or a.legacy_id=e.payload->>'bankAccountId')
  where e.company_id=p_company_id and e.entity in ('bank_movements','bankMovements') and e.deleted_at is null
    and not exists(select 1 from public.erp_treasury_bank_transactions t where t.company_id=e.company_id and
      (t.bank_transaction_id::text=e.record_id or t.bank_transaction_id::text=e.payload->>'treasuryTransactionId' or
       (nullif(e.payload->>'sourceId','') is not null and t.source_type=upper(e.payload->>'sourceKind') and t.source_id=e.payload->>'sourceId')))
$$;

create or replace function public.erp_treasury_movements_page(
  p_company_id uuid,p_bank_account_id uuid,p_date_from date,p_date_to date,
  p_type text default null,p_status text default null,p_origin text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select public.erp_accounting_bank_report_page(
    p_company_id,'MOVEMENTS',p_date_from,p_date_to,p_bank_account_id,
    p_type,p_status,p_origin,p_search,p_limit,p_offset
  )
$$;

revoke all on function public.erp_treasury_search_v2_movement_rows(uuid) from public,anon,authenticated;
revoke all on function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.erp_treasury_search_v2_movement_rows(uuid) to service_role;
grant execute on function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer) to authenticated,service_role;

comment on function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer)
is 'PATCH READ-ONLY: delega el listado bancario previo al read-model server-side validado de 202608230016.';
