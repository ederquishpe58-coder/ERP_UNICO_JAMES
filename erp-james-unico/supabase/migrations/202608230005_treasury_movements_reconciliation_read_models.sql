-- CONT-A / Punto 3: lectura search-first de movimientos y conciliaciones.
-- Aditiva y estrictamente READ-ONLY. No modifica las mutaciones Treasury V2.

create or replace function public.erp_treasury_search_v2_assert_page(p_limit integer, p_offset integer)
returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if coalesce(p_limit,0) not in (25,50) or coalesce(p_offset,-1) < 0 then
    raise exception using errcode='22023',message='TREASURY_SEARCH_PAGE_INVALID';
  end if;
end $$;

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
  from public.erp_treasury_bank_transactions t join public.erp_treasury_bank_accounts a using(company_id,bank_account_id)
  where t.company_id=p_company_id
  union all
  select 'JRN-'||e.journal_entry_id::text||'-'||l.line_number::text,e.entry_number,e.accounting_date,e.accounting_date,a.bank_account_id,
    case when l.debit>0 then 'CREDIT' else 'DEBIT' end,greatest(l.debit,l.credit),e.currency_code,
    coalesce(nullif(l.description,''),e.concept),coalesce(nullif(e.external_reference,''),e.source_document),'SYSTEM','JOURNAL',e.journal_entry_id::text,
    e.journal_entry_id::text,'UNRECONCILED','CONFIRMED',a.account_code,a.bank_name,l.debit,l.credit,
    'LIBRO_DIARIO · '||coalesce(nullif(e.origin_module,''),'MANUAL'),true,true
  from public.erp_financial_journal_entries e join public.erp_financial_journal_lines l using(company_id,journal_entry_id)
  join public.erp_treasury_bank_accounts a on a.company_id=l.company_id and a.ledger_account_code=l.account_code
  where e.company_id=p_company_id and e.status='POSTED' and (l.debit>0 or l.credit>0)
    and not exists(select 1 from public.erp_treasury_bank_transactions t where t.company_id=e.company_id and t.journal_entry_id=e.journal_entry_id)
  union all
  select e.record_id,coalesce(e.payload->>'movementNumber',e.record_id),nullif(e.payload->>'movementDate','')::date,nullif(e.payload->>'movementDate','')::date,
    a.bank_account_id,case when coalesce((e.payload->>'incomeValue')::numeric,0)>0 then 'CREDIT' else 'DEBIT' end,
    greatest(coalesce((e.payload->>'incomeValue')::numeric,0),coalesce((e.payload->>'expenseValue')::numeric,0)),coalesce(nullif(e.payload->>'currency',''),'USD'),
    coalesce(e.payload->>'concept',''),coalesce(e.payload->>'reference',''),'LEGACY',upper(coalesce(nullif(e.payload->>'sourceKind',''),'LEGACY')),
    nullif(e.payload->>'sourceId',''),nullif(e.payload->>'journalEntryId',''),'UNRECONCILED',
    case upper(coalesce(e.payload->>'status','BORRADOR')) when 'CONTABILIZADO' then 'CONFIRMED' when 'ANULADO' then 'VOIDED' else 'DRAFT' end,
    a.account_code,a.bank_name,coalesce((e.payload->>'incomeValue')::numeric,0),coalesce((e.payload->>'expenseValue')::numeric,0),
    'LEGACY · '||upper(coalesce(nullif(e.payload->>'originModule',''),'MANUAL')),false,false
  from public.erp_entity_records e join public.erp_treasury_bank_accounts a on a.company_id=e.company_id
    and (a.bank_account_id::text=e.payload->>'bankAccountId' or a.legacy_id=e.payload->>'bankAccountId')
  where e.company_id=p_company_id and e.entity='bankMovements' and e.deleted_at is null
    and not exists(select 1 from public.erp_treasury_bank_transactions t where t.company_id=e.company_id and
      (t.bank_transaction_id::text=e.record_id or t.bank_transaction_id::text=e.payload->>'treasuryTransactionId' or
       (nullif(e.payload->>'sourceId','') is not null and t.source_type=upper(e.payload->>'sourceKind') and t.source_id=e.payload->>'sourceId')))
$$;

create or replace function public.erp_treasury_search_v2_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok',true,'component','TREASURY_SEARCH_V2','migration','202608230005',
    'bankTransactionsTable',to_regclass('public.erp_treasury_bank_transactions') is not null,
    'reconciliationsTable',to_regclass('public.erp_treasury_reconciliations') is not null,
    'matchesTable',to_regclass('public.erp_treasury_reconciliation_matches') is not null,
    'reviewsTable',to_regclass('public.erp_treasury_reconciliation_reviews') is not null,
    'movementsPage',to_regprocedure('public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer)') is not null,
    'workspace',to_regprocedure('public.erp_treasury_reconciliation_workspace(uuid,uuid,date,date,uuid,integer)') is not null,
    'historyPage',to_regprocedure('public.erp_treasury_reconciliation_history_page(uuid,date,date,uuid,text,text,text,integer,integer)') is not null,
    'detail',to_regprocedure('public.erp_treasury_reconciliation_detail(uuid,uuid)') is not null
  );
end $$;

create or replace function public.erp_treasury_movements_page(
  p_company_id uuid,p_bank_account_id uuid,p_date_from date,p_date_to date,
  p_type text default null,p_status text default null,p_origin text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint; v_summary jsonb; v_from date; v_to date;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_treasury_search_v2_assert_page(p_limit,p_offset);
  if p_bank_account_id is null then raise exception using errcode='22023',message='TREASURY_SEARCH_BANK_ACCOUNT_REQUIRED'; end if;
  if not exists(select 1 from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=p_bank_account_id) then
    raise exception using errcode='23503',message='TREASURY_V2_BANK_ACCOUNT_NOT_FOUND';
  end if;
  v_from:=coalesce(p_date_from,'1900-01-01'::date); v_to:=coalesce(p_date_to,'9999-12-31'::date);
  if v_from>v_to then raise exception using errcode='22023',message='TREASURY_SEARCH_DATE_INVALID'; end if;

  with filtered as (
    select t.* from public.erp_treasury_search_v2_movement_rows(p_company_id) t
    where t.bank_account_id=p_bank_account_id
      and t.value_date between v_from and v_to
      and (nullif(upper(btrim(p_type)),'') is null or
        (upper(btrim(p_type))='INGRESO' and t.direction='CREDIT') or
        (upper(btrim(p_type))='EGRESO' and t.direction='DEBIT'))
      and (nullif(upper(btrim(p_status)),'') is null or t.status=upper(btrim(p_status)) or t.reconciliation_status=upper(btrim(p_status)))
      and (nullif(upper(btrim(p_origin)),'') is null or t.origin_type=upper(btrim(p_origin)) or coalesce(t.source_type,'')=upper(btrim(p_origin)))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',t.transaction_code,t.reference,t.description,t.source_type,t.source_id,t.account_code,t.bank_name)) like '%'||lower(btrim(p_search))||'%')
  ), numbered as (
    select *,row_number() over(order by value_date,transaction_code,bank_transaction_id) running_no
    from filtered
  ), opening as (
    select a.opening_balance+coalesce(sum(case when t.direction='CREDIT' then t.amount else -t.amount end),0) value
    from public.erp_treasury_bank_accounts a
    left join public.erp_treasury_bank_transactions t on t.company_id=a.company_id and t.bank_account_id=a.bank_account_id
      and t.status='CONFIRMED' and t.origin_type in ('EXPECTED','SYSTEM','MANUAL') and t.value_date<v_from
    where a.company_id=p_company_id and a.bank_account_id=p_bank_account_id group by a.opening_balance
  )
  select count(*),jsonb_build_object(
      'total',count(*),'income',coalesce(sum(income_value),0),'expense',coalesce(sum(expense_value),0),
      'openingBalance',(select value from opening),
      'closingBalance',(select value from opening)+coalesce(sum(case when origin_type in ('EXPECTED','SYSTEM','MANUAL') then income_value-expense_value else 0 end),0),
      'realStatementNet',coalesce(sum(case when origin_type='REAL_STATEMENT' then income_value-expense_value else 0 end),0)
    ) into v_total,v_summary from filtered;

  with filtered as (
    select t.* from public.erp_treasury_search_v2_movement_rows(p_company_id) t
    where t.bank_account_id=p_bank_account_id and t.value_date between v_from and v_to
      and (nullif(upper(btrim(p_type)),'') is null or (upper(btrim(p_type))='INGRESO' and t.direction='CREDIT') or (upper(btrim(p_type))='EGRESO' and t.direction='DEBIT'))
      and (nullif(upper(btrim(p_status)),'') is null or t.status=upper(btrim(p_status)) or t.reconciliation_status=upper(btrim(p_status)))
      and (nullif(upper(btrim(p_origin)),'') is null or t.origin_type=upper(btrim(p_origin)) or coalesce(t.source_type,'')=upper(btrim(p_origin)))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',t.transaction_code,t.reference,t.description,t.source_type,t.source_id,t.account_code,t.bank_name)) like '%'||lower(btrim(p_search))||'%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',bank_transaction_id::text,'movementNumber',transaction_code,'movementDate',value_date,'transactionDate',transaction_date,
    'bankAccountId',bank_account_id::text,'bankAccountCode',account_code,'bankName',bank_name,'bankAccountLabel',account_code||' · '||bank_name,
    'movementType',case when direction='CREDIT' then 'ingreso' else 'egreso' end,'direction',direction,
    'incomeValue',income_value,'expenseValue',expense_value,'amount',amount,'currency',currency_code,
    'reference',reference,'concept',description,'status',case when status='CONFIRMED' then 'CONTABILIZADO' else 'ANULADO' end,
    'originModule',lower(origin_label),'originLabel',origin_label,'originType',origin_type,'sourceKind',source_type,'sourceId',source_id,
    'journalEntryId',journal_entry_id::text,'reconciliationStatus',reconciliation_status,'derived',derived,'canonical',canonical
  ) order by value_date desc,transaction_code desc),'[]'::jsonb) into v_items
  from (select * from filtered order by value_date desc,transaction_code desc limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_treasury_reconciliation_history_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_bank_account_id uuid default null,p_status text default null,
  p_reference text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform public.erp_treasury_search_v2_assert_page(p_limit,p_offset);
  if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then raise exception using errcode='22023',message='TREASURY_SEARCH_DATE_INVALID'; end if;
  with f as (
    select r.*,a.account_code,a.bank_name,
      (select count(*) from public.erp_treasury_reconciliation_matches m where m.company_id=r.company_id and m.reconciliation_id=r.reconciliation_id and m.status='ACTIVE') match_count,
      (select count(*) from public.erp_treasury_reconciliation_reviews v where v.company_id=r.company_id and v.reconciliation_id=r.reconciliation_id and v.status='OBSERVED') review_count
    from public.erp_treasury_reconciliations r join public.erp_treasury_bank_accounts a using(company_id,bank_account_id)
    where r.company_id=p_company_id and (p_date_from is null or r.period_end>=p_date_from) and (p_date_to is null or r.period_start<=p_date_to)
      and (p_bank_account_id is null or r.bank_account_id=p_bank_account_id)
      and (nullif(upper(btrim(p_status)),'') is null or r.status=upper(btrim(p_status)))
      and (nullif(btrim(p_reference),'') is null or r.reconciliation_code ilike '%'||btrim(p_reference)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.reconciliation_code,r.notes,a.account_code,a.bank_name)) like '%'||lower(btrim(p_search))||'%')
  )
  select count(*) into v_total from f;
  with f as (
    select r.*,a.account_code,a.bank_name,
      (select count(*) from public.erp_treasury_reconciliation_matches m where m.company_id=r.company_id and m.reconciliation_id=r.reconciliation_id and m.status='ACTIVE') match_count,
      (select count(*) from public.erp_treasury_reconciliation_reviews v where v.company_id=r.company_id and v.reconciliation_id=r.reconciliation_id and v.status='OBSERVED') review_count
    from public.erp_treasury_reconciliations r join public.erp_treasury_bank_accounts a using(company_id,bank_account_id)
    where r.company_id=p_company_id and (p_date_from is null or r.period_end>=p_date_from) and (p_date_to is null or r.period_start<=p_date_to)
      and (p_bank_account_id is null or r.bank_account_id=p_bank_account_id) and (nullif(upper(btrim(p_status)),'') is null or r.status=upper(btrim(p_status)))
      and (nullif(btrim(p_reference),'') is null or r.reconciliation_code ilike '%'||btrim(p_reference)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.reconciliation_code,r.notes,a.account_code,a.bank_name)) like '%'||lower(btrim(p_search))||'%')
  )
  select coalesce(jsonb_agg(to_jsonb(q) order by period_end desc,reconciliation_code desc),'[]'::jsonb) into v_items
  from (select reconciliation_id::text id,reconciliation_code,bank_account_id::text,account_code,bank_name,period_start,period_end,
    bank_opening_balance,bank_closing_balance,book_closing_balance,difference,status,notes,closed_at,updated_at,version,match_count,review_count
    from f order by period_end desc,reconciliation_code desc limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_treasury_reconciliation_workspace(
  p_company_id uuid,p_bank_account_id uuid,p_date_from date,p_date_to date,p_reconciliation_id uuid default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_system jsonb; v_bank jsonb; v_recon jsonb; v_matches jsonb; v_reviews jsonb; v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_limit not in (25,50) or p_bank_account_id is null or p_date_from is null or p_date_to is null or p_date_from>p_date_to then
    raise exception using errcode='22023',message='TREASURY_RECON_WORKSPACE_FILTERS_REQUIRED';
  end if;
  if p_reconciliation_id is not null and not exists(select 1 from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=p_reconciliation_id and bank_account_id=p_bank_account_id) then
    raise exception using errcode='23503',message='TREASURY_V2_RECON_NOT_FOUND';
  end if;
  select to_jsonb(r) into v_recon from public.erp_treasury_reconciliations r where r.company_id=p_company_id and r.reconciliation_id=p_reconciliation_id;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at),'[]'::jsonb) into v_matches from public.erp_treasury_reconciliation_matches m
    where m.company_id=p_company_id and m.reconciliation_id=p_reconciliation_id and m.status='ACTIVE';
  select coalesce(jsonb_agg(to_jsonb(v) order by v.updated_at),'[]'::jsonb) into v_reviews from public.erp_treasury_reconciliation_reviews v
    where v.company_id=p_company_id and v.reconciliation_id=p_reconciliation_id and v.status='OBSERVED';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',coalesce(t.source_type,'JOURNAL')||':'||coalesce(t.source_id,t.journal_entry_id::text,t.bank_transaction_id::text),
    'bankTransactionId',t.bank_transaction_id::text,'movementNumber',t.transaction_code,'movementDate',t.value_date,
    'bankAccountId',t.bank_account_id::text,'direction',t.direction,'incomeValue',case when t.direction='CREDIT' then t.amount else 0 end,
    'expenseValue',case when t.direction='DEBIT' then t.amount else 0 end,'amount',t.amount,'reference',t.reference,'concept',t.description,
    'originModule',lower(coalesce(t.source_type,t.origin_type)),'originLabel',coalesce(t.source_type,t.origin_type),
    'sourceType',coalesce(t.source_type,'JOURNAL'),'sourceId',coalesce(t.source_id,t.journal_entry_id::text,t.bank_transaction_id::text),'sourceDirection',t.direction,
    'lineState',case when exists(select 1 from public.erp_treasury_reconciliation_matches m where m.company_id=p_company_id and m.reconciliation_id=p_reconciliation_id and m.status='ACTIVE' and m.source_type=coalesce(t.source_type,'JOURNAL') and m.source_id=coalesce(t.source_id,t.journal_entry_id::text,t.bank_transaction_id::text)) then 'conciliado' else 'pendiente' end
  ) order by t.value_date,t.transaction_code),'[]'::jsonb) into v_system
  from (select t.* from public.erp_treasury_search_v2_movement_rows(p_company_id) t
    where t.bank_account_id=p_bank_account_id and t.value_date between p_date_from and p_date_to
      and t.status='CONFIRMED' and t.origin_type in ('EXPECTED','SYSTEM','MANUAL')
      and t.source_type in ('COLLECTION','SUPPLIER_PAYMENT','TRANSFER','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT','JOURNAL')
      and not exists(select 1 from public.erp_treasury_reconciliation_matches m join public.erp_treasury_reconciliations r using(company_id,reconciliation_id)
        where m.company_id=p_company_id and m.status='ACTIVE' and r.status<>'CANCELLED' and r.reconciliation_id is distinct from p_reconciliation_id
          and m.source_type=coalesce(t.source_type,'JOURNAL') and m.source_id=coalesce(t.source_id,t.journal_entry_id::text,t.bank_transaction_id::text))
    order by t.value_date,t.transaction_code limit p_limit) t;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.bank_transaction_id::text,'bankTransactionId',t.bank_transaction_id::text,'statementNumber',t.transaction_code,'movementDate',t.value_date,
    'bankAccountId',t.bank_account_id::text,'direction',t.direction,'incomeValue',case when t.direction='CREDIT' then t.amount else 0 end,
    'expenseValue',case when t.direction='DEBIT' then t.amount else 0 end,'netValue',case when t.direction='CREDIT' then t.amount else -t.amount end,
    'amount',t.amount,'reference',t.reference,'description',t.description,'reconciliationStatus',t.reconciliation_status,
    'lineState',case when t.reconciliation_status='RECONCILED' then 'conciliado' when t.reconciliation_status='PARTIALLY_RECONCILED' then 'observado' else 'pendiente' end
  ) order by t.value_date,t.transaction_code),'[]'::jsonb) into v_bank
  from (select t.* from public.erp_treasury_bank_transactions t where t.company_id=p_company_id and t.bank_account_id=p_bank_account_id
    and t.value_date between p_date_from and p_date_to and t.status='CONFIRMED' and t.origin_type='REAL_STATEMENT'
    and (t.reconciliation_status<>'RECONCILED' or exists(select 1 from public.erp_treasury_reconciliation_matches m where m.company_id=t.company_id and m.reconciliation_id=p_reconciliation_id and m.bank_transaction_id=t.bank_transaction_id and m.status='ACTIVE'))
    order by t.value_date,t.transaction_code limit p_limit) t;
  select jsonb_build_object(
    'systemIncome',coalesce(sum(case when origin_type in ('EXPECTED','SYSTEM','MANUAL') and direction='CREDIT' then amount else 0 end),0),
    'systemExpense',coalesce(sum(case when origin_type in ('EXPECTED','SYSTEM','MANUAL') and direction='DEBIT' then amount else 0 end),0),
    'bankIncome',coalesce(sum(case when origin_type='REAL_STATEMENT' and direction='CREDIT' then amount else 0 end),0),
    'bankExpense',coalesce(sum(case when origin_type='REAL_STATEMENT' and direction='DEBIT' then amount else 0 end),0)
  ) into v_summary from public.erp_treasury_bank_transactions where company_id=p_company_id and bank_account_id=p_bank_account_id and value_date between p_date_from and p_date_to and status='CONFIRMED';
  return jsonb_build_object('ok',true,'reconciliation',coalesce(v_recon,'{}'::jsonb),'matches',v_matches,'reviews',v_reviews,'systemRows',v_system,'statementRows',v_bank,'summary',v_summary);
end $$;

create or replace function public.erp_treasury_reconciliation_detail(p_company_id uuid,p_reconciliation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v public.erp_treasury_reconciliations%rowtype; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  select * into v from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=p_reconciliation_id;
  if not found then raise exception using errcode='P0002',message='TREASURY_V2_RECON_NOT_FOUND'; end if;
  v_result:=public.erp_treasury_reconciliation_workspace(p_company_id,v.bank_account_id,v.period_start,v.period_end,v.reconciliation_id,50);
  return v_result||jsonb_build_object('ok',true);
end $$;

grant execute on function public.erp_treasury_search_v2_health(uuid) to authenticated;
revoke all on function public.erp_treasury_search_v2_movement_rows(uuid) from public,authenticated;
grant execute on function public.erp_treasury_movements_page(uuid,uuid,date,date,text,text,text,text,integer,integer) to authenticated;
grant execute on function public.erp_treasury_reconciliation_workspace(uuid,uuid,date,date,uuid,integer) to authenticated;
grant execute on function public.erp_treasury_reconciliation_history_page(uuid,date,date,uuid,text,text,text,integer,integer) to authenticated;
grant execute on function public.erp_treasury_reconciliation_detail(uuid,uuid) to authenticated;
