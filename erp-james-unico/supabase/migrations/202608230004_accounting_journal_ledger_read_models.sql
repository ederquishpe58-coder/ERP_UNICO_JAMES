-- Libro Diario + Mayor General search-first.
-- Read-models aditivos: no modifican la contabilizacion ni la sincronizacion existente.

create index if not exists erp_financial_journal_company_date_page_idx
  on public.erp_financial_journal_entries(company_id, accounting_date desc, entry_number desc, journal_entry_id);

create or replace function public.erp_accounting_read_v2_health(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ok', exists (
      select 1 from public.user_company_memberships membership
      where membership.company_id = p_company_id
        and membership.user_id = auth.uid()
        and membership.membership_status = 'ACTIVE'
    ),
    'component', 'ACCOUNTING_READ_V2',
    'migration', '202608230004',
    'journalTable', to_regclass('public.erp_financial_journal_entries') is not null,
    'journalLinesTable', to_regclass('public.erp_financial_journal_lines') is not null,
    'legacyProjectionTable', to_regclass('public.erp_entity_records') is not null,
    'journalPage', to_regprocedure('public.erp_accounting_journal_page(uuid,date,date,text,text,text,text,text,integer,integer)') is not null,
    'journalDetail', to_regprocedure('public.erp_accounting_journal_detail(uuid,text,text)') is not null,
    'ledgerPage', to_regprocedure('public.erp_accounting_ledger_page(uuid,text,date,date,text,text,integer,integer)') is not null
  )
$$;

create or replace function public.erp_accounting_journal_page(
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
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with access_guard as (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ),
  v2 as (
    select
      entry.journal_entry_id::text as entry_key,
      'FINANCIAL_V2'::text as source_kind,
      entry.entry_number,
      entry.accounting_date,
      entry.accounting_period,
      entry.concept,
      entry.origin_module,
      entry.source_type,
      entry.source_document,
      entry.external_reference,
      case entry.status
        when 'DRAFT' then 'BORRADOR'
        when 'POSTED' then 'CONTABILIZADO'
        when 'REVERSED' then 'REVERSADO'
        when 'CANCELLED' then 'ANULADO'
        else entry.status
      end as status,
      entry.total_debit,
      entry.total_credit,
      (entry.total_debit - entry.total_credit)::numeric as difference,
      coalesce(lines.line_count, 0)::bigint as line_count,
      entry.created_by::text as actor_id,
      entry.created_at,
      entry.version
    from access_guard
    join public.erp_financial_journal_entries entry on entry.company_id = p_company_id
    left join lateral (
      select count(*)::bigint as line_count
      from public.erp_financial_journal_lines line
      where line.company_id = entry.company_id
        and line.journal_entry_id = entry.journal_entry_id
    ) lines on true
  ),
  legacy as (
    select
      record.record_id as entry_key,
      'LEGACY'::text as source_kind,
      coalesce(record.payload ->> 'entryNumber', record.record_id) as entry_number,
      case when coalesce(record.payload ->> 'accountingDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (record.payload ->> 'accountingDate')::date else record.created_at::date end as accounting_date,
      coalesce(record.payload ->> 'accountingPeriod', left(coalesce(record.payload ->> 'accountingDate', ''), 7)) as accounting_period,
      coalesce(record.payload ->> 'concept', '') as concept,
      coalesce(record.payload ->> 'originModule', 'Legacy') as origin_module,
      'LEGACY'::text as source_type,
      coalesce(record.payload ->> 'sourceDocument', '') as source_document,
      coalesce(record.payload ->> 'externalReference', '') as external_reference,
      coalesce(record.payload ->> 'status', 'BORRADOR') as status,
      coalesce(lines.total_debit, 0)::numeric as total_debit,
      coalesce(lines.total_credit, 0)::numeric as total_credit,
      (coalesce(lines.total_debit, 0) - coalesce(lines.total_credit, 0))::numeric as difference,
      coalesce(lines.line_count, 0)::bigint as line_count,
      coalesce(record.payload ->> 'createdById', record.created_by::text, '') as actor_id,
      record.created_at,
      record.version
    from access_guard
    join public.erp_entity_records record
      on record.company_id = p_company_id
     and record.entity = 'accounting_journal_entries'
     and record.deleted_at is null
    left join lateral (
      select
        count(*)::bigint as line_count,
        sum(case when coalesce(item ->> 'debit', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (item ->> 'debit')::numeric else 0 end) as total_debit,
        sum(case when coalesce(item ->> 'credit', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (item ->> 'credit')::numeric else 0 end) as total_credit
      from jsonb_array_elements(coalesce(record.payload -> 'lines', '[]'::jsonb)) item
    ) lines on true
    where not exists (
      select 1 from public.erp_financial_journal_entries migrated
      where migrated.company_id = record.company_id
        and migrated.legacy_draft_id = record.record_id
    )
  ),
  universe as (
    select * from v2
    union all
    select * from legacy
  ),
  filtered as (
    select * from universe row
    where (p_date_from is null or row.accounting_date >= p_date_from)
      and (p_date_to is null or row.accounting_date <= p_date_to)
      and (nullif(btrim(p_status), '') is null or upper(row.status) = upper(btrim(p_status)))
      and (nullif(btrim(p_origin_module), '') is null or upper(row.origin_module) = upper(btrim(p_origin_module)))
      and (nullif(btrim(p_entry_number), '') is null or row.entry_number ilike '%' || btrim(p_entry_number) || '%')
      and (nullif(btrim(p_reference), '') is null
        or row.source_document ilike '%' || btrim(p_reference) || '%'
        or row.external_reference ilike '%' || btrim(p_reference) || '%')
      and (nullif(btrim(p_search), '') is null
        or row.entry_number ilike '%' || btrim(p_search) || '%'
        or row.concept ilike '%' || btrim(p_search) || '%'
        or row.origin_module ilike '%' || btrim(p_search) || '%'
        or row.source_type ilike '%' || btrim(p_search) || '%'
        or row.source_document ilike '%' || btrim(p_search) || '%'
        or row.external_reference ilike '%' || btrim(p_search) || '%')
  ),
  page as (
    select * from filtered
    order by accounting_date desc, entry_number desc, entry_key
    limit least(greatest(coalesce(p_limit, 25), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  summary as (
    select
      count(*)::bigint as total_entries,
      coalesce(sum(total_debit), 0)::numeric as total_debit,
      coalesce(sum(total_credit), 0)::numeric as total_credit,
      coalesce(sum(difference), 0)::numeric as difference,
      coalesce(sum(line_count), 0)::bigint as line_count,
      count(*) filter (where status = 'BORRADOR')::bigint as drafts,
      count(*) filter (where status = 'CONTABILIZADO')::bigint as posted,
      count(*) filter (where status = 'REVERSADO')::bigint as reversed,
      count(*) filter (where status = 'ANULADO')::bigint as cancelled,
      count(*) filter (where abs(difference) > 0.005)::bigint as out_of_balance
    from filtered
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(to_jsonb(page_row) order by page_row.accounting_date desc, page_row.entry_number desc) from page page_row), '[]'::jsonb),
    'total', (select total_entries from summary),
    'summary', (select to_jsonb(summary_row) from summary summary_row),
    'limit', least(greatest(coalesce(p_limit, 25), 1), 50),
    'offset', greatest(coalesce(p_offset, 0), 0)
  )
$$;

create or replace function public.erp_accounting_journal_detail(
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
declare
  v_entry jsonb;
begin
  if not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'Empresa no autorizada.';
  end if;

  if upper(coalesce(p_source_kind, '')) = 'FINANCIAL_V2' then
    select jsonb_build_object(
      'id', entry.journal_entry_id::text,
      'entryNumber', entry.entry_number,
      'accountingDate', entry.accounting_date,
      'accountingPeriod', entry.accounting_period,
      'concept', entry.concept,
      'originModule', entry.origin_module,
      'sourceDocument', entry.source_document,
      'externalReference', entry.external_reference,
      'status', case entry.status when 'DRAFT' then 'BORRADOR' when 'POSTED' then 'CONTABILIZADO' when 'REVERSED' then 'REVERSADO' when 'CANCELLED' then 'ANULADO' else entry.status end,
      'createdBy', coalesce(entry.created_by::text, ''),
      'createdById', coalesce(entry.created_by::text, ''),
      'createdAt', entry.created_at,
      'observation', entry.observation,
      'postedAt', entry.posted_at,
      'reverseOfId', entry.reverse_of_id,
      'syncFlow', 'FINANCIAL_V2',
      'version', entry.version,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', line.journal_entry_line_id::text,
          'accountCode', line.account_code,
          'accountName', line.account_name_snapshot,
          'debit', line.debit,
          'credit', line.credit,
          'costCenter', line.cost_center,
          'auxiliary', line.auxiliary,
          'lineDescription', line.description,
          'documentReference', line.document_reference
        ) order by line.line_number)
        from public.erp_financial_journal_lines line
        where line.company_id = entry.company_id
          and line.journal_entry_id = entry.journal_entry_id
      ), '[]'::jsonb)
    ) into v_entry
    from public.erp_financial_journal_entries entry
    where entry.company_id = p_company_id
      and entry.journal_entry_id::text = p_entry_key;
  else
    select record.payload || jsonb_build_object(
      'id', record.record_id,
      'sourceKind', 'LEGACY',
      'version', record.version
    ) into v_entry
    from public.erp_entity_records record
    where record.company_id = p_company_id
      and record.entity = 'accounting_journal_entries'
      and record.record_id = p_entry_key
      and record.deleted_at is null
      and not exists (
        select 1 from public.erp_financial_journal_entries migrated
        where migrated.company_id = record.company_id
          and migrated.legacy_draft_id = record.record_id
      );
  end if;

  if v_entry is null then
    return jsonb_build_object('ok', false, 'code', 'JOURNAL_ENTRY_NOT_FOUND', 'message', 'Asiento no encontrado.');
  end if;
  return jsonb_build_object('ok', true, 'entry', v_entry);
end
$$;

create or replace function public.erp_accounting_ledger_page(
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
declare
  v_account jsonb;
  v_account_code text;
  v_account_name text;
  v_account_nature text;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'Empresa no autorizada.';
  end if;

  select record.payload
    into v_account
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = 'accounting_chart_accounts'
    and record.record_id = p_account_record_id
    and record.deleted_at is null;

  if v_account is null then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND', 'message', 'La cuenta contable seleccionada no existe en la empresa activa.');
  end if;

  v_account_code := nullif(btrim(v_account ->> 'code'), '');
  v_account_name := coalesce(nullif(btrim(v_account ->> 'name'), ''), v_account_code);
  v_account_nature := coalesce(nullif(btrim(v_account ->> 'nature'), ''), 'Deudora');
  if v_account_code is null then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_CODE_MISSING', 'message', 'La cuenta seleccionada no tiene codigo contable.');
  end if;

  with v2_movements as (
    select
      entry.journal_entry_id::text as entry_key,
      'FINANCIAL_V2'::text as source_kind,
      line.line_number,
      entry.accounting_date as movement_date,
      entry.entry_number,
      entry.concept,
      entry.origin_module,
      entry.source_document,
      entry.external_reference,
      case entry.status when 'POSTED' then 'CONTABILIZADO' when 'REVERSED' then 'REVERSADO' else entry.status end as status,
      line.debit,
      line.credit,
      line.cost_center,
      line.auxiliary,
      line.description,
      line.document_reference
    from public.erp_financial_journal_entries entry
    join public.erp_financial_journal_lines line
      on line.company_id = entry.company_id and line.journal_entry_id = entry.journal_entry_id
    where entry.company_id = p_company_id
      and line.account_code = v_account_code
      and entry.status in ('POSTED', 'REVERSED')
  ),
  legacy_movements as (
    select
      record.record_id as entry_key,
      'LEGACY'::text as source_kind,
      line.ordinality::integer as line_number,
      case when coalesce(record.payload ->> 'accountingDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (record.payload ->> 'accountingDate')::date else record.created_at::date end as movement_date,
      coalesce(record.payload ->> 'entryNumber', record.record_id) as entry_number,
      coalesce(record.payload ->> 'concept', '') as concept,
      coalesce(record.payload ->> 'originModule', 'Legacy') as origin_module,
      coalesce(record.payload ->> 'sourceDocument', '') as source_document,
      coalesce(record.payload ->> 'externalReference', '') as external_reference,
      coalesce(record.payload ->> 'status', '') as status,
      case when coalesce(line.item ->> 'debit', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (line.item ->> 'debit')::numeric else 0 end as debit,
      case when coalesce(line.item ->> 'credit', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (line.item ->> 'credit')::numeric else 0 end as credit,
      coalesce(line.item ->> 'costCenter', '') as cost_center,
      coalesce(line.item ->> 'auxiliary', '') as auxiliary,
      coalesce(line.item ->> 'lineDescription', '') as description,
      coalesce(line.item ->> 'documentReference', '') as document_reference
    from public.erp_entity_records record
    cross join lateral jsonb_array_elements(coalesce(record.payload -> 'lines', '[]'::jsonb)) with ordinality line(item, ordinality)
    where record.company_id = p_company_id
      and record.entity = 'accounting_journal_entries'
      and record.deleted_at is null
      and coalesce(line.item ->> 'accountCode', '') = v_account_code
      and coalesce(record.payload ->> 'status', '') in ('CONTABILIZADO', 'REVERSADO')
      and not exists (
        select 1 from public.erp_financial_journal_entries migrated
        where migrated.company_id = record.company_id
          and migrated.legacy_draft_id = record.record_id
      )
  ),
  universe as (
    select * from v2_movements
    union all
    select * from legacy_movements
  ),
  relevant as (
    select movement.*,
      case when lower(v_account_nature) = 'acreedora'
        then movement.credit - movement.debit
        else movement.debit - movement.credit
      end as signed_amount
    from universe movement
    where (p_date_to is null or movement.movement_date <= p_date_to)
      and (nullif(btrim(p_status), '') is null or upper(movement.status) = upper(btrim(p_status)))
      and (nullif(btrim(p_search), '') is null
        or movement.entry_number ilike '%' || btrim(p_search) || '%'
        or movement.concept ilike '%' || btrim(p_search) || '%'
        or movement.source_document ilike '%' || btrim(p_search) || '%'
        or movement.external_reference ilike '%' || btrim(p_search) || '%'
        or movement.document_reference ilike '%' || btrim(p_search) || '%'
        or movement.description ilike '%' || btrim(p_search) || '%')
  ),
  opening as (
    select coalesce(sum(signed_amount), 0)::numeric as initial_balance
    from relevant
    where p_date_from is not null and movement_date < p_date_from
  ),
  period_rows as (
    select * from relevant
    where (p_date_from is null or movement_date >= p_date_from)
  ),
  running as (
    select row.*,
      (select initial_balance from opening)
      + sum(row.signed_amount) over (
        order by row.movement_date, row.entry_number, row.line_number, row.source_kind, row.entry_key
        rows between unbounded preceding and current row
      ) as balance
    from period_rows row
  ),
  page as (
    select * from running
    order by movement_date, entry_number, line_number, source_kind, entry_key
    limit least(greatest(coalesce(p_limit, 25), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  summary as (
    select
      count(*)::bigint as movement_count,
      coalesce(sum(debit), 0)::numeric as total_debit,
      coalesce(sum(credit), 0)::numeric as total_credit,
      (select initial_balance from opening) as initial_balance,
      (select initial_balance from opening) + coalesce(sum(signed_amount), 0)::numeric as final_balance
    from period_rows
  )
  select jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object(
      'id', p_account_record_id,
      'code', v_account_code,
      'name', v_account_name,
      'nature', v_account_nature
    ),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'entryKey', page_row.entry_key,
      'sourceKind', page_row.source_kind,
      'lineNumber', page_row.line_number,
      'date', page_row.movement_date,
      'entryNumber', page_row.entry_number,
      'concept', page_row.concept,
      'originModule', page_row.origin_module,
      'sourceDocument', page_row.source_document,
      'externalReference', page_row.external_reference,
      'status', page_row.status,
      'debit', page_row.debit,
      'credit', page_row.credit,
      'balance', page_row.balance,
      'costCenter', page_row.cost_center,
      'auxiliary', page_row.auxiliary,
      'description', page_row.description,
      'documentReference', page_row.document_reference
    ) order by page_row.movement_date, page_row.entry_number, page_row.line_number) from page page_row), '[]'::jsonb),
    'total', (select movement_count from summary),
    'summary', (select to_jsonb(summary_row) from summary summary_row),
    'limit', least(greatest(coalesce(p_limit, 25), 1), 50),
    'offset', greatest(coalesce(p_offset, 0), 0)
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.erp_accounting_read_v2_health(uuid) from public, anon;
revoke all on function public.erp_accounting_journal_page(uuid, date, date, text, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.erp_accounting_journal_detail(uuid, text, text) from public, anon;
revoke all on function public.erp_accounting_ledger_page(uuid, text, date, date, text, text, integer, integer) from public, anon;

grant execute on function public.erp_accounting_read_v2_health(uuid) to authenticated, service_role;
grant execute on function public.erp_accounting_journal_page(uuid, date, date, text, text, text, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.erp_accounting_journal_detail(uuid, text, text) to authenticated, service_role;
grant execute on function public.erp_accounting_ledger_page(uuid, text, date, date, text, text, integer, integer) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
