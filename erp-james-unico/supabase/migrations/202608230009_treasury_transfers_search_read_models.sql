-- CONT-B / Punto 2: historial search-first de transferencias Treasury V2.
-- Estrictamente READ-ONLY: no modifica la mutacion erp_treasury_v2_transfer.

create index if not exists erp_treasury_transfers_history_idx
  on public.erp_treasury_transfers(company_id,transfer_date desc,transfer_id);

create index if not exists erp_treasury_bank_tx_transfer_idx
  on public.erp_treasury_bank_transactions(company_id,transfer_id)
  where transfer_id is not null;

create index if not exists erp_treasury_cash_tx_transfer_idx
  on public.erp_treasury_cash_transactions(company_id,transfer_id)
  where transfer_id is not null;

create or replace function public.erp_treasury_transfer_read_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok',true,'component','TREASURY_TRANSFERS_SEARCH_V2','migration','202608230009',
    'transfersTable',to_regclass('public.erp_treasury_transfers') is not null,
    'bankTransactionsTable',to_regclass('public.erp_treasury_bank_transactions') is not null,
    'cashTransactionsTable',to_regclass('public.erp_treasury_cash_transactions') is not null,
    'journalEntriesTable',to_regclass('public.erp_financial_journal_entries') is not null,
    'historyPage',to_regprocedure('public.erp_treasury_transfers_history_page(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer)') is not null,
    'detail',to_regprocedure('public.erp_treasury_transfer_detail(uuid,uuid)') is not null
  );
end $$;

create or replace function public.erp_treasury_transfers_history_page(
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
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_treasury_search_v2_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then
    raise exception using errcode='22023',message='TREASURY_TRANSFER_DATE_RANGE_REQUIRED';
  end if;

  with filtered as (
    select t.transfer_id,t.transfer_code,t.transfer_date,t.source_account_type,t.source_account_id,
      t.destination_account_type,t.destination_account_id,t.currency_code,t.amount,t.reference,t.notes,t.status,
      t.journal_entry_id,t.created_at,t.created_by,t.reversed_at,t.reversed_by,t.reversal_reason,t.version,
      coalesce(src.label,'Cuenta origen no catalogada') source_account_label,
      coalesce(dst.label,'Cuenta destino no catalogada') destination_account_label,
      e.entry_number journal_entry_number
    from public.erp_treasury_transfers t
    left join lateral (
      select b.account_code||' · '||b.bank_name label
      from public.erp_treasury_bank_accounts b
      where t.source_account_type='BANK' and b.company_id=t.company_id and b.bank_account_id=t.source_account_id
      union all
      select c.account_code||' · '||c.name
      from public.erp_treasury_cash_accounts c
      where t.source_account_type='CASH' and c.company_id=t.company_id and c.cash_account_id=t.source_account_id
      limit 1
    ) src on true
    left join lateral (
      select b.account_code||' · '||b.bank_name label
      from public.erp_treasury_bank_accounts b
      where t.destination_account_type='BANK' and b.company_id=t.company_id and b.bank_account_id=t.destination_account_id
      union all
      select c.account_code||' · '||c.name
      from public.erp_treasury_cash_accounts c
      where t.destination_account_type='CASH' and c.company_id=t.company_id and c.cash_account_id=t.destination_account_id
      limit 1
    ) dst on true
    left join public.erp_financial_journal_entries e on e.company_id=t.company_id and e.journal_entry_id=t.journal_entry_id
    where t.company_id=p_company_id and t.transfer_date between p_date_from and p_date_to
      and (nullif(upper(btrim(p_source_account_type)),'') is null or t.source_account_type=upper(btrim(p_source_account_type)))
      and (p_source_account_id is null or t.source_account_id=p_source_account_id)
      and (nullif(upper(btrim(p_destination_account_type)),'') is null or t.destination_account_type=upper(btrim(p_destination_account_type)))
      and (p_destination_account_id is null or t.destination_account_id=p_destination_account_id)
      and (nullif(upper(btrim(p_status)),'') is null or t.status=upper(btrim(p_status)))
      and (nullif(btrim(p_reference),'') is null or t.reference ilike '%'||btrim(p_reference)||'%' or t.transfer_code ilike '%'||btrim(p_reference)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',t.transfer_code,t.reference,t.notes,src.label,dst.label,e.entry_number)) like '%'||lower(btrim(p_search))||'%')
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select t.transfer_id,t.transfer_code,t.transfer_date,t.source_account_type,t.source_account_id,
      t.destination_account_type,t.destination_account_id,t.currency_code,t.amount,t.reference,t.notes,t.status,
      t.journal_entry_id,t.created_at,t.created_by,t.reversed_at,t.reversed_by,t.reversal_reason,t.version,
      coalesce(src.label,'Cuenta origen no catalogada') source_account_label,
      coalesce(dst.label,'Cuenta destino no catalogada') destination_account_label,
      e.entry_number journal_entry_number
    from public.erp_treasury_transfers t
    left join lateral (
      select b.account_code||' · '||b.bank_name label from public.erp_treasury_bank_accounts b
      where t.source_account_type='BANK' and b.company_id=t.company_id and b.bank_account_id=t.source_account_id
      union all
      select c.account_code||' · '||c.name from public.erp_treasury_cash_accounts c
      where t.source_account_type='CASH' and c.company_id=t.company_id and c.cash_account_id=t.source_account_id limit 1
    ) src on true
    left join lateral (
      select b.account_code||' · '||b.bank_name label from public.erp_treasury_bank_accounts b
      where t.destination_account_type='BANK' and b.company_id=t.company_id and b.bank_account_id=t.destination_account_id
      union all
      select c.account_code||' · '||c.name from public.erp_treasury_cash_accounts c
      where t.destination_account_type='CASH' and c.company_id=t.company_id and c.cash_account_id=t.destination_account_id limit 1
    ) dst on true
    left join public.erp_financial_journal_entries e on e.company_id=t.company_id and e.journal_entry_id=t.journal_entry_id
    where t.company_id=p_company_id and t.transfer_date between p_date_from and p_date_to
      and (nullif(upper(btrim(p_source_account_type)),'') is null or t.source_account_type=upper(btrim(p_source_account_type)))
      and (p_source_account_id is null or t.source_account_id=p_source_account_id)
      and (nullif(upper(btrim(p_destination_account_type)),'') is null or t.destination_account_type=upper(btrim(p_destination_account_type)))
      and (p_destination_account_id is null or t.destination_account_id=p_destination_account_id)
      and (nullif(upper(btrim(p_status)),'') is null or t.status=upper(btrim(p_status)))
      and (nullif(btrim(p_reference),'') is null or t.reference ilike '%'||btrim(p_reference)||'%' or t.transfer_code ilike '%'||btrim(p_reference)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',t.transfer_code,t.reference,t.notes,src.label,dst.label,e.entry_number)) like '%'||lower(btrim(p_search))||'%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.transfer_id::text,'transferId',q.transfer_id::text,'transferNumber',q.transfer_code,
    'transferDate',q.transfer_date,'effectiveDate',q.transfer_date,
    'sourceAccountType',q.source_account_type,'sourceAccountId',q.source_account_id::text,'sourceAccountLabel',q.source_account_label,
    'destinationAccountType',q.destination_account_type,'destinationAccountId',q.destination_account_id::text,'destinationAccountLabel',q.destination_account_label,
    'currency',q.currency_code,'currencyCode',q.currency_code,'amount',q.amount,'reference',q.reference,'notes',q.notes,'status',q.status,
    'journalEntryId',q.journal_entry_id::text,'journalEntryNumber',q.journal_entry_number,
    'createdAt',q.created_at,'createdBy',q.created_by::text,'reversedAt',q.reversed_at,'reversedBy',q.reversed_by::text,
    'reversalReason',q.reversal_reason,'version',q.version,'canonical',true
  ) order by q.transfer_date desc,q.transfer_code desc),'[]'::jsonb) into v_items
  from (select * from filtered order by transfer_date desc,transfer_code desc limit p_limit offset p_offset) q;

  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_treasury_transfer_detail(p_company_id uuid,p_transfer_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v public.erp_treasury_transfers%rowtype; v_header jsonb; v_movements jsonb; v_journal jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  select * into v from public.erp_treasury_transfers where company_id=p_company_id and transfer_id=p_transfer_id;
  if not found then raise exception using errcode='P0002',message='TREASURY_V2_TRANSFER_NOT_FOUND'; end if;

  select to_jsonb(v)||jsonb_build_object(
    'id',v.transfer_id::text,'transferId',v.transfer_id::text,'transferNumber',v.transfer_code,
    'transferDate',v.transfer_date,'effectiveDate',v.transfer_date,
    'sourceAccount',case when v.source_account_type='BANK' then
      (select jsonb_build_object('type','BANK','id',b.bank_account_id::text,'code',b.account_code,'name',b.bank_name,'maskedNumber',b.masked_number)
       from public.erp_treasury_bank_accounts b where b.company_id=p_company_id and b.bank_account_id=v.source_account_id)
      else (select jsonb_build_object('type','CASH','id',c.cash_account_id::text,'code',c.account_code,'name',c.name)
       from public.erp_treasury_cash_accounts c where c.company_id=p_company_id and c.cash_account_id=v.source_account_id) end,
    'destinationAccount',case when v.destination_account_type='BANK' then
      (select jsonb_build_object('type','BANK','id',b.bank_account_id::text,'code',b.account_code,'name',b.bank_name,'maskedNumber',b.masked_number)
       from public.erp_treasury_bank_accounts b where b.company_id=p_company_id and b.bank_account_id=v.destination_account_id)
      else (select jsonb_build_object('type','CASH','id',c.cash_account_id::text,'code',c.account_code,'name',c.name)
       from public.erp_treasury_cash_accounts c where c.company_id=p_company_id and c.cash_account_id=v.destination_account_id) end
  ) into v_header;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.transaction_date,m.direction),'[]'::jsonb) into v_movements from (
    select 'BANK' account_type,t.bank_transaction_id::text movement_id,t.bank_account_id::text account_id,t.transaction_code,
      t.value_date transaction_date,t.direction,t.amount,t.currency_code,t.description,t.reference,t.status,t.journal_entry_id::text
    from public.erp_treasury_bank_transactions t where t.company_id=p_company_id and t.transfer_id=p_transfer_id
    union all
    select 'CASH',t.cash_transaction_id::text,t.cash_account_id::text,t.transaction_code,t.transaction_date,t.direction,t.amount,
      t.currency_code,t.description,t.reference,t.status,t.journal_entry_id::text
    from public.erp_treasury_cash_transactions t where t.company_id=p_company_id and t.transfer_id=p_transfer_id
  ) m;

  select to_jsonb(e)||jsonb_build_object('lines',coalesce((
    select jsonb_agg(to_jsonb(l) order by l.line_number) from public.erp_financial_journal_lines l
    where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id
  ),'[]'::jsonb)) into v_journal
  from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=v.journal_entry_id;

  return jsonb_build_object('ok',true,'transfer',v_header,'movements',v_movements,'journal',coalesce(v_journal,'{}'::jsonb));
end $$;

revoke all on function public.erp_treasury_transfer_read_health(uuid) from public;
revoke all on function public.erp_treasury_transfers_history_page(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer) from public;
revoke all on function public.erp_treasury_transfer_detail(uuid,uuid) from public;
grant execute on function public.erp_treasury_transfer_read_health(uuid) to authenticated;
grant execute on function public.erp_treasury_transfers_history_page(uuid,date,date,text,uuid,text,uuid,text,text,text,integer,integer) to authenticated;
grant execute on function public.erp_treasury_transfer_detail(uuid,uuid) to authenticated;
