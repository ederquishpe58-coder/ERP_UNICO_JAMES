-- CONT-C cierre / Reportes bancarios Generate-First.
-- Solo lectura: Treasury V2 es autoridad; legacy solo entra cuando no existe equivalente canonico.

create or replace function public.erp_accounting_bank_report_assert_page(p_limit integer,p_offset integer)
returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if coalesce(p_limit,0) not in (25,50) or coalesce(p_offset,-1)<0 then
    raise exception using errcode='22023',message='BANK_REPORT_PAGE_INVALID';
  end if;
end $$;

create or replace function public.erp_accounting_bank_report_page(
  p_company_id uuid,p_view text,p_date_from date,p_date_to date,p_bank_account_id uuid default null,
  p_type text default null,p_status text default null,p_origin text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_view text:=upper(btrim(coalesce(p_view,'')));
  v_items jsonb:='[]'::jsonb;
  v_summary jsonb:='{}'::jsonb;
  v_total bigint:=0;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_accounting_bank_report_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then
    raise exception using errcode='22023',message='BANK_REPORT_DATE_RANGE_REQUIRED';
  end if;
  if p_bank_account_id is not null and not exists(select 1 from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=p_bank_account_id) then
    raise exception using errcode='23503',message='TREASURY_V2_BANK_ACCOUNT_NOT_FOUND';
  end if;
  if v_view not in ('MOVEMENTS','BALANCES','RECONCILIATIONS') then
    raise exception using errcode='22023',message='BANK_REPORT_VIEW_INVALID';
  end if;

  if v_view='MOVEMENTS' then
    with filtered as (
      select t.* from public.erp_treasury_search_v2_movement_rows(p_company_id) t
      where (p_bank_account_id is null or t.bank_account_id=p_bank_account_id)
        and t.value_date between p_date_from and p_date_to
        and (nullif(upper(btrim(p_type)),'') is null or (upper(btrim(p_type))='INGRESO' and t.direction='CREDIT') or (upper(btrim(p_type))='EGRESO' and t.direction='DEBIT'))
        and (nullif(upper(btrim(p_status)),'') is null or t.status=upper(btrim(p_status)) or t.reconciliation_status=upper(btrim(p_status))
          or (upper(btrim(p_status))='CONTABILIZADO' and t.status='CONFIRMED') or (upper(btrim(p_status))='ANULADO' and t.status='VOIDED'))
        and (nullif(upper(btrim(p_origin)),'') is null or t.origin_type=upper(btrim(p_origin)) or coalesce(t.source_type,'')=upper(btrim(p_origin)) or replace(t.origin_label,'_',' ')=replace(upper(btrim(p_origin)),'_',' '))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',t.transaction_code,t.reference,t.description,t.source_type,t.source_id,t.account_code,t.bank_name)) like '%'||lower(btrim(p_search))||'%')
    ), selected_accounts as (
      select a.* from public.erp_treasury_bank_accounts a where a.company_id=p_company_id and (p_bank_account_id is null or a.bank_account_id=p_bank_account_id)
    ), opening_by_account as (
      select a.bank_account_id,a.opening_balance+coalesce(sum(case when t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.income_value-t.expense_value else 0 end),0) opening_balance
      from selected_accounts a left join public.erp_treasury_search_v2_movement_rows(p_company_id) t on t.bank_account_id=a.bank_account_id and t.value_date<p_date_from
      group by a.bank_account_id,a.opening_balance
    )
    select count(*),jsonb_build_object(
      'totalMovements',count(*),'totalIncome',coalesce(sum(income_value),0),'totalExpense',coalesce(sum(expense_value),0),
      'openingBalance',coalesce((select sum(opening_balance) from opening_by_account),0),
      'closingBalance',coalesce((select sum(opening_balance) from opening_by_account),0)+coalesce(sum(case when status='CONFIRMED' and origin_type<>'REAL_STATEMENT' then income_value-expense_value else 0 end),0),
      'realStatementNet',coalesce(sum(case when status='CONFIRMED' and origin_type='REAL_STATEMENT' then income_value-expense_value else 0 end),0)
    ) into v_total,v_summary from filtered;

    with filtered as (
      select t.* from public.erp_treasury_search_v2_movement_rows(p_company_id) t
      where (p_bank_account_id is null or t.bank_account_id=p_bank_account_id) and t.value_date between p_date_from and p_date_to
        and (nullif(upper(btrim(p_type)),'') is null or (upper(btrim(p_type))='INGRESO' and t.direction='CREDIT') or (upper(btrim(p_type))='EGRESO' and t.direction='DEBIT'))
        and (nullif(upper(btrim(p_status)),'') is null or t.status=upper(btrim(p_status)) or t.reconciliation_status=upper(btrim(p_status)) or (upper(btrim(p_status))='CONTABILIZADO' and t.status='CONFIRMED') or (upper(btrim(p_status))='ANULADO' and t.status='VOIDED'))
        and (nullif(upper(btrim(p_origin)),'') is null or t.origin_type=upper(btrim(p_origin)) or coalesce(t.source_type,'')=upper(btrim(p_origin)) or replace(t.origin_label,'_',' ')=replace(upper(btrim(p_origin)),'_',' '))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',t.transaction_code,t.reference,t.description,t.source_type,t.source_id,t.account_code,t.bank_name)) like '%'||lower(btrim(p_search))||'%')
    ), opening_by_account as (
      select a.bank_account_id,a.opening_balance+coalesce(sum(case when t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.income_value-t.expense_value else 0 end),0) opening_balance
      from public.erp_treasury_bank_accounts a left join public.erp_treasury_search_v2_movement_rows(p_company_id) t on t.bank_account_id=a.bank_account_id and t.value_date<p_date_from
      where a.company_id=p_company_id and (p_bank_account_id is null or a.bank_account_id=p_bank_account_id)
      group by a.bank_account_id,a.opening_balance
    ), running as (
      select f.*,o.opening_balance+sum(case when f.status='CONFIRMED' and f.origin_type<>'REAL_STATEMENT' then f.income_value-f.expense_value else 0 end)
        over(partition by f.bank_account_id order by f.value_date,f.transaction_code,f.bank_transaction_id rows between unbounded preceding and current row) auxiliary_balance
      from filtered f join opening_by_account o using(bank_account_id)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',bank_transaction_id,'movementNumber',transaction_code,'movementDate',value_date,'transactionDate',transaction_date,
      'bankAccountId',bank_account_id::text,'bankAccountCode',account_code,'bankName',bank_name,'movementType',case when direction='CREDIT' then 'ingreso' else 'egreso' end,
      'medium',coalesce(source_type,''),'reference',reference,'beneficiary','','concept',description,'incomeValue',income_value,'expenseValue',expense_value,
      'auxiliaryBalance',auxiliary_balance,'status',case status when 'CONFIRMED' then 'CONTABILIZADO' when 'VOIDED' then 'ANULADO' else status end,
      'originModule',origin_label,'originType',origin_type,'sourceKind',source_type,'sourceId',source_id,'journalEntryId',journal_entry_id,
      'reconciliationStatus',reconciliation_status,'canonical',canonical) order by value_date desc,transaction_code desc),'[]'::jsonb) into v_items
    from(select * from running order by value_date desc,transaction_code desc,bank_transaction_id desc limit p_limit offset p_offset) q;

  elsif v_view='BALANCES' then
    with accounts as (
      select a.* from public.erp_treasury_bank_accounts a where a.company_id=p_company_id
        and (p_bank_account_id is null or a.bank_account_id=p_bank_account_id)
        and (nullif(upper(btrim(p_status)),'') is null or a.status=upper(btrim(p_status)) or (upper(btrim(p_status))='ACTIVA' and a.status='ACTIVE') or (upper(btrim(p_status))='INACTIVA' and a.status='INACTIVE'))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',a.account_code,a.bank_name,a.masked_number,a.ledger_account_code)) like '%'||lower(btrim(p_search))||'%')
    ), balances as (
      select a.*,a.opening_balance+coalesce(sum(case when t.value_date<p_date_from and t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.income_value-t.expense_value else 0 end),0) range_opening,
        coalesce(sum(case when t.value_date between p_date_from and p_date_to and t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.income_value else 0 end),0) incomes,
        coalesce(sum(case when t.value_date between p_date_from and p_date_to and t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.expense_value else 0 end),0) expenses,
        coalesce(sum(case when t.value_date between p_date_from and p_date_to and t.status='CONFIRMED' and t.origin_type='REAL_STATEMENT' then t.income_value-t.expense_value else 0 end),0) real_statement_net
      from accounts a left join public.erp_treasury_search_v2_movement_rows(p_company_id) t using(bank_account_id)
      group by a.company_id,a.bank_account_id,a.account_code,a.bank_name,a.account_holder,a.masked_number,a.account_type,a.currency_code,a.ledger_account_code,a.opening_balance,a.opening_balance_date,a.status,a.notes,a.legacy_id,a.created_at,a.created_by,a.updated_at,a.updated_by,a.version,a.last_operation_id
    ) select count(*),jsonb_build_object('totalAccounts',count(*),'openingBalance',coalesce(sum(range_opening),0),'totalIncome',coalesce(sum(incomes),0),'totalExpense',coalesce(sum(expenses),0),'closingBalance',coalesce(sum(range_opening+incomes-expenses),0),'realStatementNet',coalesce(sum(real_statement_net),0)) into v_total,v_summary from balances;

    with accounts as (
      select a.* from public.erp_treasury_bank_accounts a where a.company_id=p_company_id and (p_bank_account_id is null or a.bank_account_id=p_bank_account_id)
        and (nullif(upper(btrim(p_status)),'') is null or a.status=upper(btrim(p_status)) or (upper(btrim(p_status))='ACTIVA' and a.status='ACTIVE') or (upper(btrim(p_status))='INACTIVA' and a.status='INACTIVE'))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',a.account_code,a.bank_name,a.masked_number,a.ledger_account_code)) like '%'||lower(btrim(p_search))||'%')
    ), balances as (
      select a.bank_account_id,a.account_code,a.bank_name,a.ledger_account_code,a.status,
        a.opening_balance+coalesce(sum(case when t.value_date<p_date_from and t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.income_value-t.expense_value else 0 end),0) range_opening,
        coalesce(sum(case when t.value_date between p_date_from and p_date_to and t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.income_value else 0 end),0) incomes,
        coalesce(sum(case when t.value_date between p_date_from and p_date_to and t.status='CONFIRMED' and t.origin_type<>'REAL_STATEMENT' then t.expense_value else 0 end),0) expenses,
        coalesce(sum(case when t.value_date between p_date_from and p_date_to and t.status='CONFIRMED' and t.origin_type='REAL_STATEMENT' then t.income_value-t.expense_value else 0 end),0) real_statement_net
      from accounts a left join public.erp_treasury_search_v2_movement_rows(p_company_id) t using(bank_account_id)
      group by a.bank_account_id,a.account_code,a.bank_name,a.ledger_account_code,a.status,a.opening_balance
    ) select coalesce(jsonb_agg(jsonb_build_object('id',bank_account_id::text,'bankName',bank_name,'code',account_code,'linkedAccountCode',ledger_account_code,
      'openingBalance',range_opening,'incomes',incomes,'expenses',expenses,'currentBalance',range_opening+incomes-expenses,'realStatementNet',real_statement_net,
      'status',case status when 'ACTIVE' then 'activa' else 'inactiva' end) order by bank_name,account_code),'[]'::jsonb) into v_items
    from(select * from balances order by bank_name,account_code limit p_limit offset p_offset) q;

  else
    with canonical as (
      select r.reconciliation_id::text id,'TREASURY_V2' source,r.reconciliation_code,r.bank_account_id,a.account_code,a.bank_name,r.period_start,r.period_end,
        r.bank_opening_balance,r.bank_closing_balance,r.book_closing_balance,r.difference,r.status,r.notes,r.closed_at,r.updated_at
      from public.erp_treasury_reconciliations r join public.erp_treasury_bank_accounts a using(company_id,bank_account_id) where r.company_id=p_company_id
    ), legacy as (
      select e.record_id,'LEGACY',coalesce(e.payload->>'reconciliationNumber',e.record_id),a.bank_account_id,a.account_code,a.bank_name,
        case when coalesce(e.payload->>'dateFrom','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dateFrom')::date end,
        case when coalesce(e.payload->>'dateTo','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dateTo')::date end,
        case when coalesce(e.payload->>'openingBankBalance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'openingBankBalance')::numeric else 0 end,
        case when coalesce(e.payload->>'closingBankBalance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'closingBankBalance')::numeric else 0 end,
        case when coalesce(e.payload->>'systemBalance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'systemBalance')::numeric else 0 end,
        case when coalesce(e.payload->>'difference','')~'^-?\d+(\.\d+)?$' then (e.payload->>'difference')::numeric else 0 end,
        upper(coalesce(e.payload->>'status','BORRADOR')),coalesce(e.payload->>'notes',e.payload->>'differenceJustification',''),nullif(e.payload->>'closeDate','')::timestamptz,e.updated_at
      from public.erp_entity_records e join public.erp_treasury_bank_accounts a on a.company_id=e.company_id and (a.bank_account_id::text=e.payload->>'bankAccountId' or a.legacy_id=e.payload->>'bankAccountId')
      where e.company_id=p_company_id and e.entity='bank_reconciliations' and e.deleted_at is null and not exists(select 1 from canonical c where c.id=e.record_id)
    ), rows as (select * from canonical union all select * from legacy), f as (
      select *,case status when 'OPEN' then 'BORRADOR' when 'IN_REVIEW' then 'EN_REVISION' when 'CLOSED' then 'CERRADA' when 'REOPENED' then 'REABIERTA' when 'CANCELLED' then 'ANULADA' else status end display_status
      from rows where period_end>=p_date_from and period_start<=p_date_to and (p_bank_account_id is null or bank_account_id=p_bank_account_id)
        and (nullif(upper(btrim(p_status)),'') is null or status=upper(btrim(p_status)) or case status when 'OPEN' then 'BORRADOR' when 'IN_REVIEW' then 'EN_REVISION' when 'CLOSED' then 'CERRADA' when 'REOPENED' then 'REABIERTA' when 'CANCELLED' then 'ANULADA' else status end=upper(btrim(p_status)))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',reconciliation_code,bank_name,account_code,notes)) like '%'||lower(btrim(p_search))||'%')
    ) select count(*),jsonb_build_object('totalReconciliations',count(*),'closed',count(*) filter(where display_status='CERRADA'),'open',count(*) filter(where display_status<>'CERRADA'),'totalDifference',coalesce(sum(difference),0)) into v_total,v_summary from f;

    with canonical as (
      select r.reconciliation_id::text id,'TREASURY_V2' source,r.reconciliation_code,r.bank_account_id,a.account_code,a.bank_name,r.period_start,r.period_end,r.bank_opening_balance,r.bank_closing_balance,r.book_closing_balance,r.difference,r.status,r.notes,r.closed_at,r.updated_at
      from public.erp_treasury_reconciliations r join public.erp_treasury_bank_accounts a using(company_id,bank_account_id) where r.company_id=p_company_id
    ), legacy as (
      select e.record_id,'LEGACY',coalesce(e.payload->>'reconciliationNumber',e.record_id),a.bank_account_id,a.account_code,a.bank_name,case when coalesce(e.payload->>'dateFrom','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dateFrom')::date end,case when coalesce(e.payload->>'dateTo','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dateTo')::date end,
        case when coalesce(e.payload->>'openingBankBalance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'openingBankBalance')::numeric else 0 end,case when coalesce(e.payload->>'closingBankBalance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'closingBankBalance')::numeric else 0 end,case when coalesce(e.payload->>'systemBalance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'systemBalance')::numeric else 0 end,case when coalesce(e.payload->>'difference','')~'^-?\d+(\.\d+)?$' then (e.payload->>'difference')::numeric else 0 end,upper(coalesce(e.payload->>'status','BORRADOR')),coalesce(e.payload->>'notes',e.payload->>'differenceJustification',''),nullif(e.payload->>'closeDate','')::timestamptz,e.updated_at
      from public.erp_entity_records e join public.erp_treasury_bank_accounts a on a.company_id=e.company_id and (a.bank_account_id::text=e.payload->>'bankAccountId' or a.legacy_id=e.payload->>'bankAccountId') where e.company_id=p_company_id and e.entity='bank_reconciliations' and e.deleted_at is null and not exists(select 1 from canonical c where c.id=e.record_id)
    ), rows as (select * from canonical union all select * from legacy), f as (
      select *,case status when 'OPEN' then 'BORRADOR' when 'IN_REVIEW' then 'EN_REVISION' when 'CLOSED' then 'CERRADA' when 'REOPENED' then 'REABIERTA' when 'CANCELLED' then 'ANULADA' else status end display_status from rows
      where period_end>=p_date_from and period_start<=p_date_to and (p_bank_account_id is null or bank_account_id=p_bank_account_id)
        and (nullif(upper(btrim(p_status)),'') is null or status=upper(btrim(p_status)) or case status when 'OPEN' then 'BORRADOR' when 'IN_REVIEW' then 'EN_REVISION' when 'CLOSED' then 'CERRADA' when 'REOPENED' then 'REABIERTA' when 'CANCELLED' then 'ANULADA' else status end=upper(btrim(p_status)))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',reconciliation_code,bank_name,account_code,notes)) like '%'||lower(btrim(p_search))||'%')
    ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'reconciliationNumber',reconciliation_code,'bankAccountId',bank_account_id::text,'bankAccount',bank_name||' · '||account_code,
      'period',to_char(period_start,'YYYY-MM')||' · '||period_start||' a '||period_end,'dateFrom',period_start,'dateTo',period_end,'openingBalance',bank_opening_balance,
      'closingBankBalance',bank_closing_balance,'systemBalance',book_closing_balance,'difference',difference,'status',display_status,'closeDate',closed_at,'notes',notes) order by period_end desc,reconciliation_code desc),'[]'::jsonb) into v_items
    from(select * from f order by period_end desc,reconciliation_code desc limit p_limit offset p_offset) q;
  end if;

  return jsonb_build_object('ok',true,'view',lower(v_view),'items',v_items,'total',v_total,'summary',v_summary,
    'filters',jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to,'bankAccountId',coalesce(p_bank_account_id::text,''),'type',coalesce(p_type,''),'status',coalesce(p_status,''),'originModule',coalesce(p_origin,''),'search',coalesce(p_search,'')),
    'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_accounting_bank_report_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object('ok',true,'component','ACCOUNTING_BANK_REPORT_V2','migration','202608230016',
    'reportPage',to_regprocedure('public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer)') is not null,
    'movementAuthority',to_regclass('public.erp_treasury_bank_transactions') is not null,
    'accountAuthority',to_regclass('public.erp_treasury_bank_accounts') is not null,
    'reconciliationAuthority',to_regclass('public.erp_treasury_reconciliations') is not null,
    'movementRows',to_regprocedure('public.erp_treasury_search_v2_movement_rows(uuid)') is not null,
    'reconciliationDetail',to_regprocedure('public.erp_treasury_reconciliation_detail(uuid,uuid)') is not null);
end $$;

revoke all on function public.erp_accounting_bank_report_assert_page(integer,integer) from public,anon;
revoke all on function public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_accounting_bank_report_health(uuid) from public,anon;
grant execute on function public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_accounting_bank_report_health(uuid) to authenticated,service_role;

comment on function public.erp_accounting_bank_report_page(uuid,text,date,date,uuid,text,text,text,text,integer,integer)
is 'READ-ONLY Generate-First: reportes bancarios, saldos libros y conciliaciones resumidas sin reconstrucciones browser.';
