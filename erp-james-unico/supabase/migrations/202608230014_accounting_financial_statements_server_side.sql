-- CONT-C / Puntos 2-4: estados financieros agregados y generate-first.
-- READ-ONLY: no modifica asientos, plan de cuentas, periodos ni sincronizacion.

create or replace function public.erp_accounting_financial_statements_health(p_company_id uuid)
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
    'component', 'ACCOUNTING_FINANCIAL_STATEMENTS_READ_V2',
    'migration', '202608230014',
    'balanceRows', to_regprocedure('public.erp_accounting_balance_rows(uuid,date,date,boolean)') is not null,
    'validation', to_regprocedure('public.erp_accounting_financial_validation(uuid,date,date)') is not null,
    'trialBalance', to_regprocedure('public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean)') is not null,
    'incomeStatement', to_regprocedure('public.erp_accounting_income_statement(uuid,date,date)') is not null,
    'balanceSheet', to_regprocedure('public.erp_accounting_balance_sheet(uuid,date,date)') is not null,
    'journalAuthority', to_regclass('public.erp_financial_journal_entries') is not null,
    'journalLinesAuthority', to_regclass('public.erp_financial_journal_lines') is not null,
    'accountPlanAuthority', to_regclass('public.erp_entity_records') is not null
  );
end
$$;

create or replace function public.erp_accounting_balance_rows(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_include_zero boolean default false
)
returns table (
  account_id text,
  code text,
  name text,
  parent_code text,
  level integer,
  account_type text,
  nature text,
  is_movement boolean,
  account_status text,
  opening_debit numeric,
  opening_credit numeric,
  opening_balance numeric,
  period_debit numeric,
  period_credit numeric,
  closing_balance numeric,
  closing_debit numeric,
  closing_credit numeric,
  has_activity boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'ACCOUNTING_FINANCIAL_DATE_RANGE_REQUIRED';
  end if;

  return query
  with recursive
  account_candidates as (
    select
      record.record_id as account_id,
      btrim(coalesce(record.payload ->> 'code', '')) as code,
      coalesce(nullif(btrim(record.payload ->> 'name'), ''), btrim(record.payload ->> 'code')) as name,
      btrim(coalesce(record.payload ->> 'parentCode', '')) as parent_code,
      case when coalesce(record.payload ->> 'level', '') ~ '^[0-9]+$'
        then (record.payload ->> 'level')::integer
        else cardinality(string_to_array(btrim(record.payload ->> 'code'), '.')) end as level,
      btrim(coalesce(record.payload ->> 'type', '')) as account_type,
      coalesce(nullif(btrim(record.payload ->> 'nature'), ''), 'Deudora') as nature,
      lower(coalesce(record.payload ->> 'isMovement', 'false')) = 'true' as is_movement,
      coalesce(nullif(btrim(record.payload ->> 'status'), ''), 'Activa') as account_status,
      row_number() over (
        partition by btrim(coalesce(record.payload ->> 'code', ''))
        order by record.version desc, record.record_id desc
      ) as winner
    from public.erp_entity_records record
    where record.company_id = p_company_id
      and record.entity = 'accounting_chart_accounts'
      and record.deleted_at is null
      and nullif(btrim(record.payload ->> 'code'), '') is not null
  ),
  accounts as (
    select candidate.account_id, candidate.code, candidate.name, candidate.parent_code,
      candidate.level, candidate.account_type, candidate.nature, candidate.is_movement, candidate.account_status
    from account_candidates candidate
    where candidate.winner = 1
  ),
  v2_lines as (
    select entry.journal_entry_id::text as entry_key,
      entry.accounting_date as movement_date,
      line.account_code,
      line.debit::numeric as debit,
      line.credit::numeric as credit
    from public.erp_financial_journal_entries entry
    join public.erp_financial_journal_lines line
      on line.company_id = entry.company_id and line.journal_entry_id = entry.journal_entry_id
    where entry.company_id = p_company_id
      and entry.status in ('POSTED', 'REVERSED')
      and entry.accounting_date <= p_date_to
  ),
  legacy_lines as (
    select record.record_id as entry_key,
      case when coalesce(record.payload ->> 'accountingDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (record.payload ->> 'accountingDate')::date else record.created_at::date end as movement_date,
      btrim(coalesce(line.item ->> 'accountCode', '')) as account_code,
      case when coalesce(line.item ->> 'debit', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (line.item ->> 'debit')::numeric else 0 end as debit,
      case when coalesce(line.item ->> 'credit', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (line.item ->> 'credit')::numeric else 0 end as credit
    from public.erp_entity_records record
    cross join lateral jsonb_array_elements(coalesce(record.payload -> 'lines', '[]'::jsonb)) line(item)
    where record.company_id = p_company_id
      and record.entity = 'accounting_journal_entries'
      and record.deleted_at is null
      and upper(coalesce(record.payload ->> 'status', '')) in ('CONTABILIZADO', 'REVERSADO')
      and (case when coalesce(record.payload ->> 'accountingDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (record.payload ->> 'accountingDate')::date else record.created_at::date end) <= p_date_to
      and not exists (
        select 1 from public.erp_financial_journal_entries migrated
        where migrated.company_id = record.company_id
          and (migrated.journal_entry_id::text = record.record_id or migrated.legacy_draft_id = record.record_id)
      )
  ),
  journal_lines as (
    select * from v2_lines
    union all
    select * from legacy_lines
  ),
  rolled as (
    select line.entry_key, line.movement_date, line.account_code as leaf_account_code,
      account.code as account_code, account.parent_code, line.debit, line.credit, 1 as depth
    from journal_lines line
    join accounts account on account.code = line.account_code
    union all
    select rolled.entry_key, rolled.movement_date, rolled.leaf_account_code,
      parent.code, parent.parent_code, rolled.debit, rolled.credit, rolled.depth + 1
    from rolled
    join accounts parent on parent.code = rolled.parent_code
    where rolled.depth < 10
  ),
  metrics as (
    select account.code,
      coalesce(sum(rolled.debit) filter (where rolled.movement_date < p_date_from), 0)::numeric as opening_debit,
      coalesce(sum(rolled.credit) filter (where rolled.movement_date < p_date_from), 0)::numeric as opening_credit,
      coalesce(sum(rolled.debit) filter (where rolled.movement_date between p_date_from and p_date_to), 0)::numeric as period_debit,
      coalesce(sum(rolled.credit) filter (where rolled.movement_date between p_date_from and p_date_to), 0)::numeric as period_credit
    from accounts account
    left join rolled on rolled.account_code = account.code
    group by account.code
  ),
  balanced as (
    select account.*,
      round(metric.opening_debit, 2) as opening_debit,
      round(metric.opening_credit, 2) as opening_credit,
      round(case when lower(account.nature) = 'acreedora'
        then metric.opening_credit - metric.opening_debit
        else metric.opening_debit - metric.opening_credit end, 2) as opening_balance,
      round(metric.period_debit, 2) as period_debit,
      round(metric.period_credit, 2) as period_credit,
      round(case when lower(account.nature) = 'acreedora'
        then (metric.opening_credit + metric.period_credit) - (metric.opening_debit + metric.period_debit)
        else (metric.opening_debit + metric.period_debit) - (metric.opening_credit + metric.period_credit) end, 2) as closing_balance
    from accounts account
    join metrics metric on metric.code = account.code
  )
  select balanced.account_id, balanced.code, balanced.name, balanced.parent_code,
    balanced.level, balanced.account_type, balanced.nature, balanced.is_movement, balanced.account_status,
    balanced.opening_debit, balanced.opening_credit, balanced.opening_balance,
    balanced.period_debit, balanced.period_credit, balanced.closing_balance,
    round(case
      when lower(balanced.nature) = 'deudora' and balanced.closing_balance >= 0 then balanced.closing_balance
      when lower(balanced.nature) = 'acreedora' and balanced.closing_balance < 0 then abs(balanced.closing_balance)
      else 0 end, 2) as closing_debit,
    round(case
      when lower(balanced.nature) = 'acreedora' and balanced.closing_balance >= 0 then balanced.closing_balance
      when lower(balanced.nature) = 'deudora' and balanced.closing_balance < 0 then abs(balanced.closing_balance)
      else 0 end, 2) as closing_credit,
    (balanced.opening_debit <> 0 or balanced.opening_credit <> 0
      or balanced.period_debit <> 0 or balanced.period_credit <> 0 or balanced.closing_balance <> 0) as has_activity
  from balanced
  where p_include_zero or balanced.opening_debit <> 0 or balanced.opening_credit <> 0
    or balanced.period_debit <> 0 or balanced.period_credit <> 0 or balanced.closing_balance <> 0;
end
$$;

create or replace function public.erp_accounting_financial_validation(
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
declare
  v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'ACCOUNTING_FINANCIAL_DATE_RANGE_REQUIRED';
  end if;

  with
  accounts as (
    select record.record_id,
      btrim(coalesce(record.payload ->> 'code', '')) as code,
      coalesce(record.payload ->> 'name', '') as name,
      btrim(coalesce(record.payload ->> 'parentCode', '')) as parent_code,
      btrim(coalesce(record.payload ->> 'type', '')) as account_type,
      btrim(coalesce(record.payload ->> 'nature', '')) as nature,
      lower(coalesce(record.payload ->> 'isMovement', 'false')) = 'true' as is_movement,
      coalesce(record.payload ->> 'status', 'Activa') as account_status
    from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'accounting_chart_accounts' and record.deleted_at is null
  ),
  catalog_invalid as (
    select account.code
    from accounts account
    where account.code !~ '^[1-5]([.][0-9]{1,3}){0,4}$'
      or account.name = '' or account.account_type = '' or account.nature = ''
      or (split_part(account.code, '.', 1) = '1' and account.account_type <> 'Activo')
      or (split_part(account.code, '.', 1) = '2' and account.account_type <> 'Pasivo')
      or (split_part(account.code, '.', 1) = '3' and account.account_type <> 'Patrimonio')
      or (split_part(account.code, '.', 1) = '4' and account.account_type <> 'Ingreso')
      or (split_part(account.code, '.', 1) = '5' and account.account_type not in ('Costo', 'Gasto'))
      or (split_part(account.code, '.', 1) = '1' and account.nature <> 'Deudora'
        and not (account.nature = 'Acreedora' and (account.code like '1.2.02%'
          or upper(account.name) like any(array['%DEPRECIACION ACUMULADA%','%DEPRECIACIÓN ACUMULADA%','%AMORTIZACION ACUMULADA%','%AMORTIZACIÓN ACUMULADA%','%DETERIORO ACUMULADO%']))))
      or (split_part(account.code, '.', 1) = '2' and account.nature <> 'Acreedora')
      or (split_part(account.code, '.', 1) = '3' and account.nature <> 'Acreedora'
        and not (account.nature = 'Deudora' and (upper(account.name) like '%PERDIDA%' or upper(account.name) like '%PÉRDIDA%')))
      or (split_part(account.code, '.', 1) = '4' and account.nature <> 'Acreedora')
      or (split_part(account.code, '.', 1) = '5' and account.nature <> 'Deudora')
      or (account.parent_code <> case when position('.' in account.code) > 0 then regexp_replace(account.code, '[.][^.]+$', '') else '' end)
      or (account.parent_code <> '' and not exists (select 1 from accounts parent where parent.code = account.parent_code))
      or (account.is_movement and exists (select 1 from accounts child where child.parent_code = account.code))
      or (account.parent_code = '' and account.is_movement)
    union
    select duplicate.code from accounts duplicate group by duplicate.code having count(*) > 1
  ),
  root_missing as (
    select root.code from (values ('1'),('2'),('3'),('4'),('5')) root(code)
    where not exists (select 1 from accounts account where account.code = root.code)
  ),
  v2_entries as (
    select entry.journal_entry_id::text as entry_key, entry.entry_number, entry.origin_module,
      entry.total_debit::numeric as debit, entry.total_credit::numeric as credit,
      (select count(*) from public.erp_financial_journal_lines line
        where line.company_id = entry.company_id and line.journal_entry_id = entry.journal_entry_id)::bigint as line_count,
      exists (
        select 1 from public.erp_financial_journal_lines line
        left join accounts account on account.code = line.account_code
        where line.company_id = entry.company_id and line.journal_entry_id = entry.journal_entry_id
          and (account.code is null or not account.is_movement or account.account_status <> 'Activa')
      ) as invalid_account
    from public.erp_financial_journal_entries entry
    where entry.company_id = p_company_id and entry.status in ('POSTED','REVERSED')
      and entry.accounting_date between p_date_from and p_date_to
  ),
  legacy_entries as (
    select record.record_id as entry_key, coalesce(record.payload ->> 'entryNumber', record.record_id) as entry_number,
      coalesce(record.payload ->> 'originModule', 'Legacy') as origin_module,
      coalesce(sum(case when coalesce(line.item ->> 'debit', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (line.item ->> 'debit')::numeric else 0 end),0) as debit,
      coalesce(sum(case when coalesce(line.item ->> 'credit', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (line.item ->> 'credit')::numeric else 0 end),0) as credit,
      count(line.item)::bigint as line_count,
      bool_or(account.code is null or not account.is_movement or account.account_status <> 'Activa') as invalid_account
    from public.erp_entity_records record
    cross join lateral jsonb_array_elements(coalesce(record.payload -> 'lines', '[]'::jsonb)) line(item)
    left join accounts account on account.code = btrim(coalesce(line.item ->> 'accountCode', ''))
    where record.company_id = p_company_id and record.entity = 'accounting_journal_entries' and record.deleted_at is null
      and upper(coalesce(record.payload ->> 'status', '')) in ('CONTABILIZADO','REVERSADO')
      and (case when coalesce(record.payload ->> 'accountingDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (record.payload ->> 'accountingDate')::date else record.created_at::date end) between p_date_from and p_date_to
      and not exists (select 1 from public.erp_financial_journal_entries migrated
        where migrated.company_id = record.company_id
          and (migrated.journal_entry_id::text = record.record_id or migrated.legacy_draft_id = record.record_id))
    group by record.record_id, record.payload
  ),
  entries as (select * from v2_entries union all select * from legacy_entries),
  invalid_entries as (
    select * from entries where line_count < 2 or abs(debit-credit) > 0.005 or invalid_account
  ),
  totals as (
    select count(*)::bigint total_entries,
      count(*) filter (where origin_module not in ('Ventas','Inventario'))::bigint checked_entries,
      round(coalesce(sum(debit),0),2) total_debit,
      round(coalesce(sum(credit),0),2) total_credit
    from entries
  )
  select jsonb_build_object(
    'difference', round(total.total_debit-total.total_credit,2),
    'isBalanced', round(total.total_debit-total.total_credit,2)=0
      and not exists(select 1 from invalid_entries)
      and not exists(select 1 from catalog_invalid)
      and not exists(select 1 from root_missing),
    'journalAudit', jsonb_build_object(
      'totalEntries', total.total_entries,
      'checkedEntries', total.checked_entries,
      'deferredModules', jsonb_build_array('Ventas','Inventario'),
      'invalidEntries', coalesce((select jsonb_agg(jsonb_build_object('id',entry_key,'entryNumber',entry_number,'originModule',origin_module)) from invalid_entries),'[]'::jsonb),
      'totals', jsonb_build_object('debit',total.total_debit,'credit',total.total_credit,'difference',round(total.total_debit-total.total_credit,2)),
      'isBalanced', round(total.total_debit-total.total_credit,2)=0 and not exists(select 1 from invalid_entries)
    ),
    'catalogAudit', jsonb_build_object(
      'totalAccounts',(select count(*) from accounts),
      'invalidAccounts',coalesce((select jsonb_agg(jsonb_build_object('code',code)) from catalog_invalid),'[]'::jsonb),
      'missingGroups',coalesce((select jsonb_agg(code) from root_missing),'[]'::jsonb),
      'isValid',not exists(select 1 from catalog_invalid) and not exists(select 1 from root_missing)
    )
  ) into v_result
  from totals total;
  return v_result;
end
$$;

create or replace function public.erp_accounting_trial_balance(
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
declare v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  with all_rows as (
    select * from public.erp_accounting_balance_rows(p_company_id,p_date_from,p_date_to,p_include_zero)
  ), visible as (
    select * from all_rows row
    where (nullif(btrim(p_account_code),'') is null or row.code = btrim(p_account_code) or row.code like btrim(p_account_code)||'.%')
      and (nullif(btrim(p_account_type),'') is null or row.account_type = btrim(p_account_type))
  ), visible_totals as (
    select round(coalesce(sum(opening_debit),0),2) opening_debit, round(coalesce(sum(opening_credit),0),2) opening_credit,
      round(coalesce(sum(period_debit),0),2) debit, round(coalesce(sum(period_credit),0),2) credit,
      round(coalesce(sum(closing_debit),0),2) closing_debit, round(coalesce(sum(closing_credit),0),2) closing_credit
    from visible where is_movement
  ), control_totals as (
    select round(coalesce(sum(period_debit),0),2) debit, round(coalesce(sum(period_credit),0),2) credit
    from all_rows where is_movement
  )
  select jsonb_build_object(
    'ok',true,
    'filters',jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to,'accountCode',coalesce(p_account_code,''),'accountType',coalesce(p_account_type,''),'includeZeroRows',p_include_zero),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',row.account_id,'code',row.code,'name',row.name,'parentCode',row.parent_code,'level',row.level,
      'type',row.account_type,'nature',row.nature,'isMovement',row.is_movement,'status',row.account_status,
      'initialSigned',row.opening_balance,'openingDebit',row.opening_debit,'openingCredit',row.opening_credit,
      'debit',row.period_debit,'credit',row.period_credit,'finalSigned',row.closing_balance,
      'saldoDeudor',row.closing_debit,'saldoAcreedor',row.closing_credit,'hasActivity',row.has_activity
    ) order by array_to_string(array(select lpad(part,6,'0') from unnest(string_to_array(row.code,'.')) part),'.')) from visible row),'[]'::jsonb),
    'totals',(select jsonb_build_object('openingDebit',opening_debit,'openingCredit',opening_credit,'debit',debit,'credit',credit,
      'closingDebit',closing_debit,'closingCredit',closing_credit,'difference',round(debit-credit,2)) from visible_totals),
    'controlTotals',(select jsonb_build_object('debit',debit,'credit',credit,'difference',round(debit-credit,2)) from control_totals),
    'validation',public.erp_accounting_financial_validation(p_company_id,p_date_from,p_date_to),
    'meta',jsonb_build_object('source','FINANCIAL_V2_PLUS_LEGACY_ONLY','rawJournalLinesReturned',0,'generatedAt',clock_timestamp())
  ) into v_result;
  return v_result;
end
$$;

create or replace function public.erp_accounting_income_statement(
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
declare v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  with rows as (
    select * from public.erp_accounting_balance_rows(p_company_id,p_date_from,p_date_to,false)
    where account_type in ('Ingreso','Costo','Gasto') and code <> '5'
  ), totals as (
    select
      round(coalesce(sum(closing_balance) filter(where account_type='Ingreso' and is_movement),0),2) income,
      round(coalesce(sum(closing_balance) filter(where account_type='Costo' and is_movement),0),2) cost,
      round(coalesce(sum(closing_balance) filter(where account_type='Gasto' and is_movement),0),2) expense
    from rows
  ), validation as (
    select public.erp_accounting_financial_validation(p_company_id,p_date_from,p_date_to) as value
  )
  select jsonb_build_object(
    'ok',true,'filters',jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to),
    'sections',jsonb_build_array(
      jsonb_build_object('key','Ingreso','label','Ingresos','total',total.income,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.account_id,'code',r.code,'name',r.name,'parentCode',r.parent_code,'level',r.level,'type',r.account_type,'nature',r.nature,'isMovement',r.is_movement,'finalSigned',r.closing_balance,'hasActivity',r.has_activity) order by r.code) from rows r where r.account_type='Ingreso'),'[]'::jsonb)),
      jsonb_build_object('key','Costo','label','Costos','total',total.cost,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.account_id,'code',r.code,'name',r.name,'parentCode',r.parent_code,'level',r.level,'type',r.account_type,'nature',r.nature,'isMovement',r.is_movement,'finalSigned',r.closing_balance,'hasActivity',r.has_activity) order by r.code) from rows r where r.account_type='Costo'),'[]'::jsonb)),
      jsonb_build_object('key','Gasto','label','Gastos','total',total.expense,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.account_id,'code',r.code,'name',r.name,'parentCode',r.parent_code,'level',r.level,'type',r.account_type,'nature',r.nature,'isMovement',r.is_movement,'finalSigned',r.closing_balance,'hasActivity',r.has_activity) order by r.code) from rows r where r.account_type='Gasto'),'[]'::jsonb))
    ),
    'totalIncome',total.income,'totalCost',total.cost,'totalExpense',total.expense,
    'resultPeriod',round(total.income-total.cost-total.expense,2),
    'validation',validation.value
      || jsonb_build_object('difference',0,'isBalanced',coalesce((validation.value->>'isBalanced')::boolean,false)),
    'meta',jsonb_build_object('source','FINANCIAL_V2_PLUS_LEGACY_ONLY','calculation','CUMULATIVE_THROUGH_DATE_TO_PRESERVED','rawJournalLinesReturned',0,'generatedAt',clock_timestamp())
  ) into v_result from totals total cross join validation;
  return v_result;
end
$$;

create or replace function public.erp_accounting_balance_sheet(
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
declare v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  with rows as (
    select * from public.erp_accounting_balance_rows(p_company_id,p_date_from,p_date_to,false)
    where account_type in ('Activo','Pasivo','Patrimonio')
  ), income_rows as (
    select * from public.erp_accounting_balance_rows(p_company_id,p_date_from,p_date_to,false)
    where account_type in ('Ingreso','Costo','Gasto') and is_movement
  ), totals as (
    select
      round(coalesce(sum(closing_balance) filter(where account_type='Activo' and parent_code=''),0),2) assets,
      round(coalesce(sum(closing_balance) filter(where account_type='Pasivo' and parent_code=''),0),2) liabilities,
      round(coalesce(sum(closing_balance) filter(where account_type='Patrimonio' and parent_code=''),0),2) patrimony,
      round(coalesce((select sum(case when account_type='Ingreso' then closing_balance else -closing_balance end) from income_rows),0),2) result_period
    from rows
  ), validation as (
    select public.erp_accounting_financial_validation(p_company_id,p_date_from,p_date_to) as value
  )
  select jsonb_build_object(
    'ok',true,'filters',jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to),
    'sections',jsonb_build_array(
      jsonb_build_object('key','Activo','label','Activos','total',total.assets,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.account_id,'code',r.code,'name',r.name,'parentCode',r.parent_code,'level',r.level,'type',r.account_type,'nature',r.nature,'isMovement',r.is_movement,'finalSigned',r.closing_balance,'hasActivity',r.has_activity) order by r.code) from rows r where r.account_type='Activo'),'[]'::jsonb)),
      jsonb_build_object('key','Pasivo','label','Pasivos','total',total.liabilities,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.account_id,'code',r.code,'name',r.name,'parentCode',r.parent_code,'level',r.level,'type',r.account_type,'nature',r.nature,'isMovement',r.is_movement,'finalSigned',r.closing_balance,'hasActivity',r.has_activity) order by r.code) from rows r where r.account_type='Pasivo'),'[]'::jsonb)),
      jsonb_build_object('key','Patrimonio','label','Patrimonio','total',total.patrimony,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.account_id,'code',r.code,'name',r.name,'parentCode',r.parent_code,'level',r.level,'type',r.account_type,'nature',r.nature,'isMovement',r.is_movement,'finalSigned',r.closing_balance,'hasActivity',r.has_activity) order by r.code) from rows r where r.account_type='Patrimonio'),'[]'::jsonb))
    ),
    'totalAssets',total.assets,'totalLiabilities',total.liabilities,'totalPatrimony',total.patrimony,
    'resultPeriod',total.result_period,'patrimonyWithResult',round(total.patrimony+total.result_period,2),
    'validation',validation.value
      || jsonb_build_object('difference',round(total.assets-total.liabilities-total.patrimony-total.result_period,2),
        'isBalanced',round(total.assets-total.liabilities-total.patrimony-total.result_period,2)=0
          and coalesce((validation.value->>'isBalanced')::boolean,false)),
    'meta',jsonb_build_object('source','FINANCIAL_V2_PLUS_LEGACY_ONLY','resultTreatment','DYNAMIC_RESULT_ADDED_ONCE','rawJournalLinesReturned',0,'generatedAt',clock_timestamp())
  ) into v_result from totals total cross join validation;
  return v_result;
end
$$;

revoke all on function public.erp_accounting_financial_statements_health(uuid) from public, anon;
revoke all on function public.erp_accounting_balance_rows(uuid,date,date,boolean) from public, anon, authenticated;
revoke all on function public.erp_accounting_financial_validation(uuid,date,date) from public, anon, authenticated;
revoke all on function public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean) from public, anon;
revoke all on function public.erp_accounting_income_statement(uuid,date,date) from public, anon;
revoke all on function public.erp_accounting_balance_sheet(uuid,date,date) from public, anon;

grant execute on function public.erp_accounting_financial_statements_health(uuid) to authenticated, service_role;
grant execute on function public.erp_accounting_balance_rows(uuid,date,date,boolean) to service_role;
grant execute on function public.erp_accounting_financial_validation(uuid,date,date) to service_role;
grant execute on function public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean) to authenticated, service_role;
grant execute on function public.erp_accounting_income_statement(uuid,date,date) to authenticated, service_role;
grant execute on function public.erp_accounting_balance_sheet(uuid,date,date) to authenticated, service_role;

comment on function public.erp_accounting_balance_rows(uuid,date,date,boolean)
  is 'READ-ONLY internal common balance base: Financial V2 plus legacy-only journal, rolled up through canonical account parentCode.';
comment on function public.erp_accounting_trial_balance(uuid,date,date,text,text,boolean)
  is 'READ-ONLY Balance de Comprobacion agregado; no retorna lineas de diario.';
comment on function public.erp_accounting_income_statement(uuid,date,date)
  is 'READ-ONLY Estado de Resultados con clasificacion canonica del plan de cuentas.';
comment on function public.erp_accounting_balance_sheet(uuid,date,date)
  is 'READ-ONLY Balance General con resultado dinamico agregado una sola vez.';

select pg_notify('pgrst', 'reload schema');
