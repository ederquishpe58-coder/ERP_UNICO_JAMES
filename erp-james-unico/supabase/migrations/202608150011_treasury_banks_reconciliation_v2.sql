-- FASE 9: tesoreria, bancos, caja y conciliacion V2.
-- Migracion aditiva/no destructiva. No copia ni elimina datos legacy.

create table if not exists public.erp_treasury_sequence_counters (
  company_id uuid not null,
  sequence_type text not null,
  calendar_year integer not null,
  last_value bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(company_id,sequence_type,calendar_year)
);

create table if not exists public.erp_treasury_bank_accounts (
  company_id uuid not null,
  bank_account_id uuid not null default gen_random_uuid(),
  account_code text not null,
  bank_name text not null,
  account_holder text not null default '',
  masked_number text not null default '',
  account_type text not null default 'CHECKING',
  currency_code text not null default 'USD',
  ledger_account_code text not null,
  opening_balance numeric(20,6) not null default 0,
  opening_balance_date date not null default current_date,
  status text not null default 'ACTIVE',
  notes text not null default '',
  legacy_id text,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,bank_account_id),
  constraint erp_treasury_bank_account_status_chk check(status in ('ACTIVE','INACTIVE')),
  constraint erp_treasury_bank_account_type_chk check(account_type in ('CHECKING','SAVINGS','CREDIT_CARD','OTHER')),
  constraint erp_treasury_bank_account_code_uk unique(company_id,account_code)
);
create unique index if not exists erp_treasury_bank_account_legacy_idx on public.erp_treasury_bank_accounts(company_id,legacy_id) where legacy_id is not null;

create table if not exists public.erp_treasury_cash_accounts (
  company_id uuid not null,
  cash_account_id uuid not null default gen_random_uuid(),
  account_code text not null,
  name text not null,
  currency_code text not null default 'USD',
  ledger_account_code text not null,
  opening_balance numeric(20,6) not null default 0,
  opening_balance_date date not null default current_date,
  status text not null default 'ACTIVE',
  notes text not null default '',
  legacy_id text,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,cash_account_id),
  constraint erp_treasury_cash_account_status_chk check(status in ('ACTIVE','INACTIVE')),
  constraint erp_treasury_cash_account_code_uk unique(company_id,account_code)
);
create unique index if not exists erp_treasury_cash_account_legacy_idx on public.erp_treasury_cash_accounts(company_id,legacy_id) where legacy_id is not null;

create table if not exists public.erp_treasury_statement_imports (
  company_id uuid not null,
  statement_import_id uuid not null default gen_random_uuid(),
  bank_account_id uuid not null,
  file_name text not null default '',
  file_fingerprint text not null,
  imported_rows integer not null default 0,
  imported_at timestamptz not null default clock_timestamp(),
  imported_by uuid,
  operation_id uuid not null,
  primary key(company_id,statement_import_id),
  constraint erp_treasury_statement_import_account_fk foreign key(company_id,bank_account_id)
    references public.erp_treasury_bank_accounts(company_id,bank_account_id),
  constraint erp_treasury_statement_import_uk unique(company_id,bank_account_id,file_fingerprint)
);

create table if not exists public.erp_treasury_bank_transactions (
  company_id uuid not null,
  bank_transaction_id uuid not null default gen_random_uuid(),
  bank_account_id uuid not null,
  transaction_code text not null,
  transaction_date date not null,
  value_date date not null,
  direction text not null,
  amount numeric(20,6) not null,
  currency_code text not null default 'USD',
  description text not null default '',
  reference text not null default '',
  bank_external_id text,
  logical_fingerprint text,
  origin_type text not null default 'EXPECTED',
  source_type text,
  source_id text,
  journal_entry_id uuid,
  transfer_id uuid,
  statement_import_id uuid,
  reconciliation_status text not null default 'UNRECONCILED',
  reconciled_amount numeric(20,6) not null default 0,
  status text not null default 'CONFIRMED',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,bank_transaction_id),
  constraint erp_treasury_bank_tx_account_fk foreign key(company_id,bank_account_id)
    references public.erp_treasury_bank_accounts(company_id,bank_account_id),
  constraint erp_treasury_bank_tx_import_fk foreign key(company_id,statement_import_id)
    references public.erp_treasury_statement_imports(company_id,statement_import_id),
  constraint erp_treasury_bank_tx_direction_chk check(direction in ('DEBIT','CREDIT')),
  constraint erp_treasury_bank_tx_amount_chk check(amount>0 and reconciled_amount>=0 and reconciled_amount<=amount),
  constraint erp_treasury_bank_tx_origin_chk check(origin_type in ('REAL_STATEMENT','EXPECTED','SYSTEM','MANUAL')),
  constraint erp_treasury_bank_tx_recon_chk check(reconciliation_status in ('UNIDENTIFIED','UNRECONCILED','PARTIALLY_RECONCILED','RECONCILED','VOIDED')),
  constraint erp_treasury_bank_tx_status_chk check(status in ('CONFIRMED','VOIDED')),
  constraint erp_treasury_bank_tx_code_uk unique(company_id,transaction_code)
);
create unique index if not exists erp_treasury_bank_tx_external_idx on public.erp_treasury_bank_transactions(company_id,bank_account_id,bank_external_id) where bank_external_id is not null;
create unique index if not exists erp_treasury_bank_tx_fingerprint_idx on public.erp_treasury_bank_transactions(company_id,bank_account_id,logical_fingerprint) where logical_fingerprint is not null and origin_type='REAL_STATEMENT';
create index if not exists erp_treasury_bank_tx_date_idx on public.erp_treasury_bank_transactions(company_id,bank_account_id,value_date desc);
create index if not exists erp_treasury_bank_tx_source_idx on public.erp_treasury_bank_transactions(company_id,source_type,source_id);
create unique index if not exists erp_treasury_bank_tx_expected_source_idx on public.erp_treasury_bank_transactions(company_id,bank_account_id,source_type,source_id,direction) where source_id is not null and origin_type='EXPECTED' and status='CONFIRMED';

create table if not exists public.erp_treasury_cash_transactions (
  company_id uuid not null,
  cash_transaction_id uuid not null default gen_random_uuid(),
  cash_account_id uuid not null,
  transaction_code text not null,
  transaction_date date not null,
  direction text not null,
  amount numeric(20,6) not null,
  currency_code text not null default 'USD',
  description text not null default '',
  reference text not null default '',
  source_type text,
  source_id text,
  journal_entry_id uuid,
  transfer_id uuid,
  status text not null default 'CONFIRMED',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,cash_transaction_id),
  constraint erp_treasury_cash_tx_account_fk foreign key(company_id,cash_account_id)
    references public.erp_treasury_cash_accounts(company_id,cash_account_id),
  constraint erp_treasury_cash_tx_direction_chk check(direction in ('DEBIT','CREDIT')),
  constraint erp_treasury_cash_tx_amount_chk check(amount>0),
  constraint erp_treasury_cash_tx_status_chk check(status in ('CONFIRMED','VOIDED')),
  constraint erp_treasury_cash_tx_code_uk unique(company_id,transaction_code)
);
create index if not exists erp_treasury_cash_tx_date_idx on public.erp_treasury_cash_transactions(company_id,cash_account_id,transaction_date desc);
create unique index if not exists erp_treasury_cash_tx_source_idx on public.erp_treasury_cash_transactions(company_id,cash_account_id,source_type,source_id,direction) where source_id is not null and status='CONFIRMED';

create table if not exists public.erp_treasury_transfers (
  company_id uuid not null,
  transfer_id uuid not null default gen_random_uuid(),
  transfer_code text not null,
  transfer_date date not null,
  source_account_type text not null,
  source_account_id uuid not null,
  destination_account_type text not null,
  destination_account_id uuid not null,
  currency_code text not null default 'USD',
  amount numeric(20,6) not null,
  reference text not null default '',
  notes text not null default '',
  status text not null default 'CONFIRMED',
  journal_entry_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,transfer_id),
  constraint erp_treasury_transfer_type_chk check(source_account_type in ('BANK','CASH') and destination_account_type in ('BANK','CASH')),
  constraint erp_treasury_transfer_distinct_chk check(source_account_type<>destination_account_type or source_account_id<>destination_account_id),
  constraint erp_treasury_transfer_amount_chk check(amount>0),
  constraint erp_treasury_transfer_status_chk check(status in ('CONFIRMED','REVERSED')),
  constraint erp_treasury_transfer_code_uk unique(company_id,transfer_code)
);

create table if not exists public.erp_treasury_reconciliations (
  company_id uuid not null,
  reconciliation_id uuid not null default gen_random_uuid(),
  reconciliation_code text not null,
  bank_account_id uuid not null,
  period_start date not null,
  period_end date not null,
  bank_opening_balance numeric(20,6) not null default 0,
  bank_closing_balance numeric(20,6) not null default 0,
  book_closing_balance numeric(20,6) not null default 0,
  difference numeric(20,6) not null default 0,
  status text not null default 'OPEN',
  notes text not null default '',
  closed_at timestamptz,
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,reconciliation_id),
  constraint erp_treasury_recon_account_fk foreign key(company_id,bank_account_id)
    references public.erp_treasury_bank_accounts(company_id,bank_account_id),
  constraint erp_treasury_recon_status_chk check(status in ('OPEN','IN_REVIEW','CLOSED','REOPENED','CANCELLED')),
  constraint erp_treasury_recon_range_chk check(period_start<=period_end),
  constraint erp_treasury_recon_code_uk unique(company_id,reconciliation_code)
);
create unique index if not exists erp_treasury_recon_period_idx on public.erp_treasury_reconciliations(company_id,bank_account_id,period_start,period_end) where status<>'CANCELLED';

create table if not exists public.erp_treasury_reconciliation_matches (
  company_id uuid not null,
  reconciliation_match_id uuid not null default gen_random_uuid(),
  reconciliation_id uuid not null,
  bank_transaction_id uuid not null,
  source_type text not null,
  source_id text not null,
  amount numeric(20,6) not null,
  status text not null default 'ACTIVE',
  notes text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  reversed_at timestamptz,
  reversed_by uuid,
  reverse_reason text,
  operation_id uuid not null,
  primary key(company_id,reconciliation_match_id),
  constraint erp_treasury_match_recon_fk foreign key(company_id,reconciliation_id)
    references public.erp_treasury_reconciliations(company_id,reconciliation_id),
  constraint erp_treasury_match_tx_fk foreign key(company_id,bank_transaction_id)
    references public.erp_treasury_bank_transactions(company_id,bank_transaction_id),
  constraint erp_treasury_match_amount_chk check(amount>0),
  constraint erp_treasury_match_status_chk check(status in ('ACTIVE','REVERSED'))
);
create unique index if not exists erp_treasury_match_operation_idx on public.erp_treasury_reconciliation_matches(company_id,operation_id,bank_transaction_id,source_type,source_id) where status='ACTIVE';
create index if not exists erp_treasury_match_source_idx on public.erp_treasury_reconciliation_matches(company_id,source_type,source_id,status);

create table if not exists public.erp_treasury_reconciliation_reviews (
  company_id uuid not null,
  reconciliation_review_id uuid not null default gen_random_uuid(),
  reconciliation_id uuid not null,
  review_side text not null,
  record_id text not null,
  status text not null default 'OBSERVED',
  observation text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,reconciliation_review_id),
  constraint erp_treasury_review_recon_fk foreign key(company_id,reconciliation_id)
    references public.erp_treasury_reconciliations(company_id,reconciliation_id),
  constraint erp_treasury_review_side_chk check(review_side in ('SYSTEM','BANK')),
  constraint erp_treasury_review_status_chk check(status in ('OBSERVED','CLEARED')),
  constraint erp_treasury_review_uk unique(company_id,reconciliation_id,review_side,record_id)
);

create table if not exists public.erp_treasury_adjustments (
  company_id uuid not null,
  adjustment_id uuid not null default gen_random_uuid(),
  adjustment_code text not null,
  bank_transaction_id uuid,
  bank_account_id uuid,
  cash_account_id uuid,
  adjustment_type text not null,
  adjustment_date date not null,
  amount numeric(20,6) not null,
  description text not null,
  counter_account_code text not null,
  status text not null default 'POSTED',
  journal_entry_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  version bigint not null default 1,
  last_operation_id uuid,
  primary key(company_id,adjustment_id),
  constraint erp_treasury_adjustment_target_chk check((bank_account_id is not null)::integer+(cash_account_id is not null)::integer=1),
  constraint erp_treasury_adjustment_amount_chk check(amount>0),
  constraint erp_treasury_adjustment_status_chk check(status in ('POSTED','REVERSED')),
  constraint erp_treasury_adjustment_code_uk unique(company_id,adjustment_code)
);
create unique index if not exists erp_treasury_adjustment_bank_tx_idx on public.erp_treasury_adjustments(company_id,bank_transaction_id) where bank_transaction_id is not null and status='POSTED';

do $$ declare v_table text; begin
  foreach v_table in array array[
    'erp_treasury_sequence_counters','erp_treasury_bank_accounts','erp_treasury_cash_accounts','erp_treasury_statement_imports',
    'erp_treasury_bank_transactions','erp_treasury_cash_transactions','erp_treasury_transfers','erp_treasury_reconciliations',
    'erp_treasury_reconciliation_matches','erp_treasury_reconciliation_reviews','erp_treasury_adjustments'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke insert,update,delete on public.%I from authenticated',v_table);
    execute format('drop policy if exists %I on public.%I',v_table||'_member_select',v_table);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_company_memberships m where m.company_id=%I.company_id and m.user_id=auth.uid() and m.membership_status=''ACTIVE''))',v_table||'_member_select',v_table,v_table);
  end loop;
end $$;

create or replace function public.erp_treasury_v2_next_code(p_company_id uuid,p_type text,p_date date)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_type text:=upper(btrim(p_type)); v_year integer:=extract(year from p_date)::integer; v_value bigint; v_prefix text;
begin
  if v_type not in ('BANK_ACCOUNT','CASH_ACCOUNT','BANK_TRANSACTION','CASH_TRANSACTION','TRANSFER','RECONCILIATION','ADJUSTMENT') then
    raise exception using errcode='22023',message='TREASURY_V2_SEQUENCE_TYPE_INVALID';
  end if;
  insert into public.erp_treasury_sequence_counters(company_id,sequence_type,calendar_year,last_value,updated_at)
  values(p_company_id,v_type,v_year,1,clock_timestamp())
  on conflict(company_id,sequence_type,calendar_year) do update set last_value=erp_treasury_sequence_counters.last_value+1,updated_at=clock_timestamp()
  returning last_value into v_value;
  v_prefix:=case v_type when 'BANK_ACCOUNT' then 'BNK' when 'CASH_ACCOUNT' then 'CAJ' when 'BANK_TRANSACTION' then 'MBN'
    when 'CASH_TRANSACTION' then 'MCA' when 'TRANSFER' then 'TRF' when 'RECONCILIATION' then 'CON' else 'AJT' end;
  return v_prefix||'-'||v_year||'-'||lpad(v_value::text,6,'0');
end $$;

create or replace function public.erp_treasury_v2_publish(p_company_id uuid,p_operation_id uuid,p_device_id text,p_entity text,p_record_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payload jsonb; v_version bigint:=1; v_sync text:='TREASURY_V2';
begin
  if p_entity='treasury_bank_accounts' then
    select jsonb_build_object('id',bank_account_id::text,'bankAccountId',bank_account_id::text,'code',account_code,'bankName',bank_name,'holder',account_holder,
      'accountNumber',masked_number,'accountType',account_type,'currency',currency_code,'linkedAccountCode',ledger_account_code,
      'openingBalance',opening_balance,'openingBalanceDate',opening_balance_date,'status',status,'observation',notes,'legacyId',legacy_id,
      'version',version,'updatedAtServer',updated_at,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=p_record_id;
  elsif p_entity='treasury_cash_accounts' then
    select jsonb_build_object('id',cash_account_id::text,'cashAccountId',cash_account_id::text,'code',account_code,'name',name,'currency',currency_code,
      'linkedAccountCode',ledger_account_code,'openingBalance',opening_balance,'openingBalanceDate',opening_balance_date,'status',status,
      'observation',notes,'legacyId',legacy_id,'version',version,'updatedAtServer',updated_at,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_cash_accounts where company_id=p_company_id and cash_account_id=p_record_id;
  elsif p_entity='treasury_bank_transactions' then
    select jsonb_build_object('id',bank_transaction_id::text,'bankTransactionId',bank_transaction_id::text,'bankAccountId',bank_account_id::text,
      'movementNumber',transaction_code,'movementDate',transaction_date,'valueDate',value_date,'direction',direction,'amount',amount,
      'incomeValue',case when direction='CREDIT' then amount else 0 end,'expenseValue',case when direction='DEBIT' then amount else 0 end,
      'currency',currency_code,'concept',description,'reference',reference,'externalUniqueCode',bank_external_id,'originType',origin_type,
      'sourceKind',source_type,'sourceId',source_id,'journalEntryId',journal_entry_id::text,'transferId',transfer_id::text,'statementImportId',statement_import_id::text,
      'reconciliationStatus',reconciliation_status,'reconciledAmount',reconciled_amount,'status',status,'version',version,
      'updatedAtServer',updated_at,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_bank_transactions where company_id=p_company_id and bank_transaction_id=p_record_id;
  elsif p_entity='treasury_cash_transactions' then
    select jsonb_build_object('id',cash_transaction_id::text,'cashTransactionId',cash_transaction_id::text,'cashAccountId',cash_account_id::text,
      'movementNumber',transaction_code,'movementDate',transaction_date,'direction',direction,'amount',amount,'currency',currency_code,
      'concept',description,'reference',reference,'sourceKind',source_type,'sourceId',source_id,'journalEntryId',journal_entry_id::text,'transferId',transfer_id::text,
      'status',status,'version',version,'updatedAtServer',updated_at,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_cash_transactions where company_id=p_company_id and cash_transaction_id=p_record_id;
  elsif p_entity='treasury_transfers' then
    select jsonb_build_object('id',transfer_id::text,'transferId',transfer_id::text,'transferNumber',transfer_code,'transferDate',transfer_date,
      'sourceAccountType',source_account_type,'sourceAccountId',source_account_id::text,'destinationAccountType',destination_account_type,
      'destinationAccountId',destination_account_id::text,'currency',currency_code,'amount',amount,'reference',reference,'observation',notes,
      'status',status,'journalEntryId',journal_entry_id::text,'version',version,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_transfers where company_id=p_company_id and transfer_id=p_record_id;
  elsif p_entity='treasury_reconciliations' then
    select jsonb_build_object('id',reconciliation_id::text,'reconciliationId',reconciliation_id::text,'reconciliationNumber',reconciliation_code,
      'bankAccountId',bank_account_id::text,'dateFrom',period_start,'dateTo',period_end,'period',to_char(period_start,'YYYY-MM'),
      'openingBankBalance',bank_opening_balance,'closingBankBalance',bank_closing_balance,'bookClosingBalance',book_closing_balance,
      'difference',difference,'status',status,'observation',notes,'closeDate',closed_at,'reopenedAt',reopened_at,'reopenReason',reopen_reason,
      'version',version,'updatedAtServer',updated_at,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=p_record_id;
  elsif p_entity='treasury_reconciliation_matches' then
    select jsonb_build_object('id',reconciliation_match_id::text,'matchId',reconciliation_match_id::text,'reconciliationId',reconciliation_id::text,
      'bankTransactionId',bank_transaction_id::text,'sourceType',source_type,'sourceId',source_id,'amount',amount,'status',status,
      'note',notes,'createdAt',created_at,'reversedAt',reversed_at,'reverseReason',reverse_reason,'operationId',operation_id::text,'syncFlow',v_sync),1 into v_payload,v_version
    from public.erp_treasury_reconciliation_matches where company_id=p_company_id and reconciliation_match_id=p_record_id;
  elsif p_entity='treasury_reconciliation_reviews' then
    select jsonb_build_object('id',reconciliation_review_id::text,'reviewId',reconciliation_review_id::text,'reconciliationId',reconciliation_id::text,
      'kind',case when review_side='BANK' then 'statement' else 'system' end,'movementId',record_id,
      'status',case when status='OBSERVED' then 'observado' else 'pendiente' end,'observation',observation,
      'version',version,'updatedAtServer',updated_at,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_reconciliation_reviews where company_id=p_company_id and reconciliation_review_id=p_record_id;
  elsif p_entity='treasury_adjustments' then
    select jsonb_build_object('id',adjustment_id::text,'adjustmentId',adjustment_id::text,'adjustmentNumber',adjustment_code,
      'bankTransactionId',bank_transaction_id::text,'bankAccountId',bank_account_id::text,'cashAccountId',cash_account_id::text,
      'adjustmentType',adjustment_type,'adjustmentDate',adjustment_date,'amount',amount,'description',description,
      'counterAccountCode',counter_account_code,'status',status,'journalEntryId',journal_entry_id::text,'version',version,'syncFlow',v_sync),version into v_payload,v_version
    from public.erp_treasury_adjustments where company_id=p_company_id and adjustment_id=p_record_id;
  end if;
  if v_payload is null then raise exception using errcode='P0002',message='TREASURY_V2_RECORD_NOT_FOUND'; end if;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,p_entity,p_record_id::text,v_payload,
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity=p_entity and record_id=p_record_id::text),0));
end $$;

create or replace function public.erp_treasury_v2_command_result(p_operation_id uuid,p_company_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select result from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id
$$;

create or replace function public.erp_treasury_v2_review_reconciliation(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_reconciliation_id uuid,p_side text,p_record_id text,p_action text,p_observation text default '',p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_recon_status text; v_id uuid; v_status text; v_records jsonb; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  select status into v_recon_status from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=p_reconciliation_id for update;
  if v_recon_status is null or v_recon_status in ('CLOSED','CANCELLED') then raise exception using errcode='23514',message='TREASURY_V2_RECON_NOT_EDITABLE'; end if;
  if upper(p_side) not in ('SYSTEM','BANK') or btrim(coalesce(p_record_id,''))='' then raise exception using errcode='22023',message='TREASURY_V2_REVIEW_INVALID'; end if;
  if upper(p_side)='BANK' and not exists(select 1 from public.erp_treasury_bank_transactions where company_id=p_company_id and bank_transaction_id=p_record_id::uuid) then
    raise exception using errcode='23503',message='TREASURY_V2_BANK_TRANSACTION_NOT_FOUND';
  end if;
  v_status:=case when upper(p_action)='CLEAR' then 'CLEARED' else 'OBSERVED' end;
  if v_status='OBSERVED' and btrim(coalesce(p_observation,''))='' then raise exception using errcode='22023',message='TREASURY_V2_REVIEW_NOTE_REQUIRED'; end if;
  select reconciliation_review_id into v_id from public.erp_treasury_reconciliation_reviews
   where company_id=p_company_id and reconciliation_id=p_reconciliation_id and review_side=upper(p_side) and record_id=p_record_id for update;
  v_id:=coalesce(v_id,gen_random_uuid());
  insert into public.erp_treasury_reconciliation_reviews(company_id,reconciliation_review_id,reconciliation_id,review_side,record_id,status,observation,created_by,updated_by,last_operation_id)
  values(p_company_id,v_id,p_reconciliation_id,upper(p_side),p_record_id,v_status,btrim(coalesce(p_observation,'')),auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,reconciliation_id,review_side,record_id) do update set status=excluded.status,observation=excluded.observation,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=erp_treasury_reconciliation_reviews.version+1,last_operation_id=p_operation_id;
  v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_reconciliation_reviews',v_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('reviewId',v_id::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_REVIEW_RECONCILIATION',v_id::text,jsonb_build_object('reconciliationId',p_reconciliation_id,'side',p_side,'recordId',p_record_id,'action',p_action),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_treasury_v2_upsert_bank_account(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_id uuid; v_code text; v_records jsonb:='[]'; v_result jsonb; v_date date;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  v_id:=coalesce(nullif(p_payload->>'bankAccountId','')::uuid,nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  v_date:=coalesce(nullif(p_payload->>'openingBalanceDate','')::date,current_date);
  perform public.erp_financial_v2_validate_account(p_company_id,p_payload->>'ledgerAccountCode');
  select account_code into v_code from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=v_id for update;
  v_code:=coalesce(v_code,nullif(btrim(p_payload->>'accountCode'),''),public.erp_treasury_v2_next_code(p_company_id,'BANK_ACCOUNT',v_date));
  insert into public.erp_treasury_bank_accounts(company_id,bank_account_id,account_code,bank_name,account_holder,masked_number,account_type,currency_code,
    ledger_account_code,opening_balance,opening_balance_date,status,notes,legacy_id,created_by,updated_by,last_operation_id)
  values(p_company_id,v_id,v_code,btrim(p_payload->>'bankName'),btrim(coalesce(p_payload->>'holder','')),btrim(coalesce(p_payload->>'maskedNumber','')),upper(coalesce(nullif(p_payload->>'accountType',''),'CHECKING')),
    upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),btrim(p_payload->>'ledgerAccountCode'),coalesce(nullif(p_payload->>'openingBalance','')::numeric,0),
    v_date,upper(coalesce(nullif(p_payload->>'status',''),'ACTIVE')),btrim(coalesce(p_payload->>'notes','')),nullif(p_payload->>'legacyId',''),auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,bank_account_id) do update set bank_name=excluded.bank_name,account_holder=excluded.account_holder,masked_number=excluded.masked_number,account_type=excluded.account_type,
    currency_code=excluded.currency_code,ledger_account_code=excluded.ledger_account_code,status=excluded.status,notes=excluded.notes,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=erp_treasury_bank_accounts.version+1,last_operation_id=p_operation_id;
  v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_accounts',v_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('bankAccountId',v_id::text,'accountCode',v_code));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_UPSERT_BANK_ACCOUNT',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_upsert_cash_account(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_id uuid; v_code text; v_records jsonb; v_result jsonb; v_date date;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  v_id:=coalesce(nullif(p_payload->>'cashAccountId','')::uuid,nullif(p_payload->>'id','')::uuid,gen_random_uuid()); v_date:=coalesce(nullif(p_payload->>'openingBalanceDate','')::date,current_date);
  perform public.erp_financial_v2_validate_account(p_company_id,p_payload->>'ledgerAccountCode');
  select account_code into v_code from public.erp_treasury_cash_accounts where company_id=p_company_id and cash_account_id=v_id for update;
  v_code:=coalesce(v_code,nullif(btrim(p_payload->>'accountCode'),''),public.erp_treasury_v2_next_code(p_company_id,'CASH_ACCOUNT',v_date));
  insert into public.erp_treasury_cash_accounts(company_id,cash_account_id,account_code,name,currency_code,ledger_account_code,opening_balance,
    opening_balance_date,status,notes,legacy_id,created_by,updated_by,last_operation_id)
  values(p_company_id,v_id,v_code,btrim(p_payload->>'name'),upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),btrim(p_payload->>'ledgerAccountCode'),
    coalesce(nullif(p_payload->>'openingBalance','')::numeric,0),v_date,upper(coalesce(nullif(p_payload->>'status',''),'ACTIVE')),
    btrim(coalesce(p_payload->>'notes','')),nullif(p_payload->>'legacyId',''),auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,cash_account_id) do update set name=excluded.name,currency_code=excluded.currency_code,ledger_account_code=excluded.ledger_account_code,
    status=excluded.status,notes=excluded.notes,updated_at=clock_timestamp(),updated_by=auth.uid(),version=erp_treasury_cash_accounts.version+1,last_operation_id=p_operation_id;
  v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_cash_accounts',v_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('cashAccountId',v_id::text,'accountCode',v_code));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_UPSERT_CASH_ACCOUNT',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_register_transaction(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_kind text:=upper(p_payload->>'accountType'); v_id uuid:=gen_random_uuid(); v_code text; v_date date;
 v_records jsonb:='[]'; v_result jsonb; v_account uuid; v_amount numeric; v_direction text; v_journal uuid;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  v_account:=(p_payload->>'accountId')::uuid; v_amount:=round((p_payload->>'amount')::numeric,6); v_direction:=upper(p_payload->>'direction');
  v_date:=coalesce(nullif(p_payload->>'transactionDate','')::date,current_date);
  if v_amount<=0 or v_direction not in ('DEBIT','CREDIT') then raise exception using errcode='22023',message='TREASURY_V2_TRANSACTION_INVALID'; end if;
  if jsonb_typeof(p_payload->'journal')='object' then
    v_journal:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_payload->'journal','TREASURY_TRANSACTION',v_id::text,'POST_TREASURY_TRANSACTION');
  end if;
  if v_kind='BANK' then
    if not exists(select 1 from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=v_account and status='ACTIVE') then raise exception using errcode='23503',message='TREASURY_V2_BANK_ACCOUNT_NOT_FOUND'; end if;
    v_code:=public.erp_treasury_v2_next_code(p_company_id,'BANK_TRANSACTION',v_date);
    insert into public.erp_treasury_bank_transactions(company_id,bank_transaction_id,bank_account_id,transaction_code,transaction_date,value_date,direction,amount,currency_code,
      description,reference,origin_type,source_type,source_id,journal_entry_id,reconciliation_status,created_by,updated_by,last_operation_id)
    values(p_company_id,v_id,v_account,v_code,v_date,coalesce(nullif(p_payload->>'valueDate','')::date,v_date),v_direction,v_amount,
      upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),btrim(coalesce(p_payload->>'description','')),btrim(coalesce(p_payload->>'reference','')),
      upper(coalesce(nullif(p_payload->>'originType',''),'EXPECTED')),nullif(upper(btrim(p_payload->>'sourceType')),''),nullif(btrim(p_payload->>'sourceId'),''),v_journal,
      case when upper(coalesce(nullif(p_payload->>'originType',''),'EXPECTED'))='REAL_STATEMENT' then 'UNIDENTIFIED' else 'UNRECONCILED' end,auth.uid(),auth.uid(),p_operation_id);
    v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_transactions',v_id));
  elsif v_kind='CASH' then
    if not exists(select 1 from public.erp_treasury_cash_accounts where company_id=p_company_id and cash_account_id=v_account and status='ACTIVE') then raise exception using errcode='23503',message='TREASURY_V2_CASH_ACCOUNT_NOT_FOUND'; end if;
    v_code:=public.erp_treasury_v2_next_code(p_company_id,'CASH_TRANSACTION',v_date);
    insert into public.erp_treasury_cash_transactions(company_id,cash_transaction_id,cash_account_id,transaction_code,transaction_date,direction,amount,currency_code,
      description,reference,source_type,source_id,journal_entry_id,created_by,updated_by,last_operation_id)
    values(p_company_id,v_id,v_account,v_code,v_date,v_direction,v_amount,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),
      btrim(coalesce(p_payload->>'description','')),btrim(coalesce(p_payload->>'reference','')),nullif(upper(btrim(p_payload->>'sourceType')),''),
      nullif(btrim(p_payload->>'sourceId'),''),v_journal,auth.uid(),auth.uid(),p_operation_id);
    v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_cash_transactions',v_id));
  else raise exception using errcode='22023',message='TREASURY_V2_ACCOUNT_TYPE_INVALID'; end if;
  if v_journal is not null then v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_journal)); end if;
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('transactionId',v_id::text,'transactionCode',v_code,'accountType',v_kind,'journalEntryId',v_journal::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_REGISTER_TRANSACTION',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_import_statement(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_bank_account_id uuid,p_file_name text,p_file_fingerprint text,p_rows jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_import uuid; v_row jsonb; v_id uuid; v_code text; v_date date; v_amount numeric; v_direction text;
 v_fingerprint text; v_records jsonb:='[]'; v_count integer:=0; v_result jsonb; v_duplicate integer:=0;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  if not exists(select 1 from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=p_bank_account_id and status='ACTIVE') then raise exception using errcode='23503',message='TREASURY_V2_BANK_ACCOUNT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|'||p_bank_account_id::text||'|'||p_file_fingerprint,0));
  select statement_import_id into v_import from public.erp_treasury_statement_imports where company_id=p_company_id and bank_account_id=p_bank_account_id and file_fingerprint=p_file_fingerprint;
  if found then
    v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records','[]'::jsonb,'result',jsonb_build_object('statementImportId',v_import::text,'imported',0,'duplicates',jsonb_array_length(coalesce(p_rows,'[]')),'reused',true));
    insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
    values(p_operation_id,p_company_id,'TREASURY_IMPORT_STATEMENT',v_import::text,jsonb_build_object('file',p_file_name),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
  end if;
  v_import:=gen_random_uuid(); insert into public.erp_treasury_statement_imports(company_id,statement_import_id,bank_account_id,file_name,file_fingerprint,imported_by,operation_id)
    values(p_company_id,v_import,p_bank_account_id,coalesce(p_file_name,''),btrim(p_file_fingerprint),auth.uid(),p_operation_id);
  for v_row in select value from jsonb_array_elements(coalesce(p_rows,'[]')) loop
    v_date:=coalesce(nullif(v_row->>'valueDate','')::date,nullif(v_row->>'transactionDate','')::date); v_amount:=round((v_row->>'amount')::numeric,6); v_direction:=upper(v_row->>'direction');
    if v_date is null or v_amount<=0 or v_direction not in ('DEBIT','CREDIT') then raise exception using errcode='22023',message='TREASURY_V2_STATEMENT_ROW_INVALID'; end if;
    v_fingerprint:=coalesce(nullif(v_row->>'logicalFingerprint',''),md5(concat_ws('|',p_bank_account_id::text,v_date::text,upper(coalesce(v_row->>'reference','')),v_direction,v_amount::text,upper(coalesce(v_row->>'description','')),coalesce(v_row->>'occurrence','1'))));
    if exists(select 1 from public.erp_treasury_bank_transactions where company_id=p_company_id and bank_account_id=p_bank_account_id and origin_type='REAL_STATEMENT'
      and (logical_fingerprint=v_fingerprint or (nullif(v_row->>'externalId','') is not null and bank_external_id=v_row->>'externalId'))) then v_duplicate:=v_duplicate+1; continue; end if;
    v_id:=gen_random_uuid(); v_code:=public.erp_treasury_v2_next_code(p_company_id,'BANK_TRANSACTION',v_date);
    insert into public.erp_treasury_bank_transactions(company_id,bank_transaction_id,bank_account_id,transaction_code,transaction_date,value_date,direction,amount,currency_code,
      description,reference,bank_external_id,logical_fingerprint,origin_type,statement_import_id,reconciliation_status,created_by,updated_by,last_operation_id)
    values(p_company_id,v_id,p_bank_account_id,v_code,coalesce(nullif(v_row->>'transactionDate','')::date,v_date),v_date,v_direction,v_amount,
      upper(coalesce(nullif(v_row->>'currencyCode',''),'USD')),btrim(coalesce(v_row->>'description','')),btrim(coalesce(v_row->>'reference','')),
      nullif(btrim(v_row->>'externalId'),''),v_fingerprint,'REAL_STATEMENT',v_import,'UNIDENTIFIED',auth.uid(),auth.uid(),p_operation_id);
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_transactions',v_id)); v_count:=v_count+1;
  end loop;
  update public.erp_treasury_statement_imports set imported_rows=v_count where company_id=p_company_id and statement_import_id=v_import;
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('statementImportId',v_import::text,'imported',v_count,'duplicates',v_duplicate,'reused',false));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_IMPORT_STATEMENT',v_import::text,jsonb_build_object('file',p_file_name,'fingerprint',p_file_fingerprint),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_source_total(p_company_id uuid,p_source_type text,p_source_id text)
returns numeric language plpgsql security definer set search_path=public,pg_temp as $$
declare v_total numeric;
begin
  case upper(btrim(p_source_type))
    when 'COLLECTION' then select total into v_total from public.erp_financial_collections where company_id=p_company_id and collection_id=p_source_id::uuid and status='CONFIRMED';
    when 'SUPPLIER_PAYMENT' then select total into v_total from public.erp_supplier_payments where company_id=p_company_id and payment_id=p_source_id::uuid and status='CONFIRMED';
    when 'TRANSFER_OUT' then select amount into v_total from public.erp_treasury_transfers where company_id=p_company_id and transfer_id=p_source_id::uuid and status='CONFIRMED';
    when 'TRANSFER_IN' then select amount into v_total from public.erp_treasury_transfers where company_id=p_company_id and transfer_id=p_source_id::uuid and status='CONFIRMED';
    when 'ADJUSTMENT' then select amount into v_total from public.erp_treasury_adjustments where company_id=p_company_id and adjustment_id=p_source_id::uuid and status='POSTED';
    when 'JOURNAL' then select total_debit into v_total from public.erp_financial_journal_entries where company_id=p_company_id and journal_entry_id=p_source_id::uuid and status='POSTED';
    else raise exception using errcode='22023',message='TREASURY_V2_RECON_SOURCE_INVALID';
  end case;
  if v_total is null then raise exception using errcode='23503',message='TREASURY_V2_RECON_SOURCE_NOT_FOUND'; end if; return v_total;
end $$;

create or replace function public.erp_treasury_v2_save_reconciliation(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_id uuid; v_code text; v_status text; v_from date; v_to date; v_records jsonb; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  v_id:=coalesce(nullif(p_payload->>'reconciliationId','')::uuid,nullif(p_payload->>'id','')::uuid,gen_random_uuid()); v_from:=(p_payload->>'dateFrom')::date; v_to:=(p_payload->>'dateTo')::date;
  if v_from>v_to then raise exception using errcode='22023',message='TREASURY_V2_RECON_DATE_INVALID'; end if;
  if not exists(select 1 from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=(p_payload->>'bankAccountId')::uuid) then raise exception using errcode='23503',message='TREASURY_V2_BANK_ACCOUNT_NOT_FOUND'; end if;
  select reconciliation_code,status into v_code,v_status from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=v_id for update;
  if v_status='CLOSED' then raise exception using errcode='23514',message='TREASURY_V2_RECON_CLOSED'; end if;
  v_code:=coalesce(v_code,public.erp_treasury_v2_next_code(p_company_id,'RECONCILIATION',v_to));
  insert into public.erp_treasury_reconciliations(company_id,reconciliation_id,reconciliation_code,bank_account_id,period_start,period_end,bank_opening_balance,
    bank_closing_balance,book_closing_balance,difference,status,notes,created_by,last_operation_id)
  values(p_company_id,v_id,v_code,(p_payload->>'bankAccountId')::uuid,v_from,v_to,coalesce(nullif(p_payload->>'openingBankBalance','')::numeric,0),
    coalesce(nullif(p_payload->>'closingBankBalance','')::numeric,0),coalesce(nullif(p_payload->>'bookClosingBalance','')::numeric,0),
    coalesce(nullif(p_payload->>'difference','')::numeric,0),'OPEN',btrim(coalesce(p_payload->>'notes','')),auth.uid(),p_operation_id)
  on conflict(company_id,reconciliation_id) do update set period_start=excluded.period_start,period_end=excluded.period_end,
    bank_opening_balance=excluded.bank_opening_balance,bank_closing_balance=excluded.bank_closing_balance,book_closing_balance=excluded.book_closing_balance,
    difference=excluded.difference,notes=excluded.notes,status=case when erp_treasury_reconciliations.status='OPEN' then 'IN_REVIEW' else erp_treasury_reconciliations.status end,
    updated_at=clock_timestamp(),version=erp_treasury_reconciliations.version+1,last_operation_id=p_operation_id;
  v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_reconciliations',v_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('reconciliationId',v_id::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_SAVE_RECONCILIATION',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_reconcile(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_reconciliation_id uuid,p_matches jsonb,p_notes text default '',p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_recon public.erp_treasury_reconciliations%rowtype; v_match jsonb; v_tx public.erp_treasury_bank_transactions%rowtype;
 v_amount numeric; v_source_total numeric; v_source_used numeric; v_id uuid; v_records jsonb:='[]'; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  select * into v_recon from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=p_reconciliation_id for update;
  if not found or v_recon.status in ('CLOSED','CANCELLED') then raise exception using errcode='23514',message='TREASURY_V2_RECON_NOT_EDITABLE'; end if;
  for v_match in select value from jsonb_array_elements(coalesce(p_matches,'[]')) order by value->>'bankTransactionId',value->>'sourceType',value->>'sourceId' loop
    v_amount:=round((v_match->>'amount')::numeric,6); if v_amount<=0 then raise exception using errcode='22023',message='TREASURY_V2_MATCH_AMOUNT_INVALID'; end if;
    select * into v_tx from public.erp_treasury_bank_transactions where company_id=p_company_id and bank_transaction_id=(v_match->>'bankTransactionId')::uuid for update;
    if not found or v_tx.bank_account_id<>v_recon.bank_account_id or v_tx.status='VOIDED' or v_tx.origin_type<>'REAL_STATEMENT' then raise exception using errcode='23514',message='TREASURY_V2_BANK_TRANSACTION_NOT_RECONCILABLE'; end if;
    if upper(coalesce(v_match->>'sourceDirection','')) not in ('DEBIT','CREDIT') or upper(v_match->>'sourceDirection')<>v_tx.direction then
      raise exception using errcode='23514',message='TREASURY_V2_RECON_DIRECTION_MISMATCH';
    end if;
    if v_tx.reconciled_amount+v_amount>v_tx.amount then raise exception using errcode='23514',message='TREASURY_V2_BANK_TRANSACTION_OVERRECONCILED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|'||upper(v_match->>'sourceType')||'|'||(v_match->>'sourceId'),0));
    v_source_total:=public.erp_treasury_v2_source_total(p_company_id,v_match->>'sourceType',v_match->>'sourceId');
    select coalesce(sum(amount),0) into v_source_used from public.erp_treasury_reconciliation_matches where company_id=p_company_id and source_type=upper(v_match->>'sourceType') and source_id=v_match->>'sourceId' and status='ACTIVE';
    if v_source_used+v_amount>v_source_total then raise exception using errcode='23514',message='TREASURY_V2_SOURCE_OVERRECONCILED'; end if;
    v_id:=gen_random_uuid(); insert into public.erp_treasury_reconciliation_matches(company_id,reconciliation_match_id,reconciliation_id,bank_transaction_id,source_type,source_id,amount,notes,created_by,operation_id)
      values(p_company_id,v_id,p_reconciliation_id,v_tx.bank_transaction_id,upper(v_match->>'sourceType'),v_match->>'sourceId',v_amount,coalesce(p_notes,''),auth.uid(),p_operation_id);
    update public.erp_treasury_bank_transactions set reconciled_amount=reconciled_amount+v_amount,
      reconciliation_status=case when reconciled_amount+v_amount=amount then 'RECONCILED' else 'PARTIALLY_RECONCILED' end,
      updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and bank_transaction_id=v_tx.bank_transaction_id;
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_reconciliation_matches',v_id))
      ||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_transactions',v_tx.bank_transaction_id));
  end loop;
  update public.erp_treasury_reconciliations set status='IN_REVIEW',updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and reconciliation_id=p_reconciliation_id;
  v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_reconciliations',p_reconciliation_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('reconciliationId',p_reconciliation_id::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_RECONCILE',p_reconciliation_id::text,p_matches,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_reverse_match(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_match_id uuid,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_match public.erp_treasury_reconciliation_matches%rowtype; v_tx public.erp_treasury_bank_transactions%rowtype; v_recon public.erp_treasury_reconciliations%rowtype; v_records jsonb; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  select * into v_match from public.erp_treasury_reconciliation_matches where company_id=p_company_id and reconciliation_match_id=p_match_id for update;
  if not found or v_match.status='REVERSED' then raise exception using errcode='23514',message='TREASURY_V2_MATCH_NOT_ACTIVE'; end if;
  select * into strict v_recon from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=v_match.reconciliation_id for update;
  if v_recon.status='CLOSED' then raise exception using errcode='23514',message='TREASURY_V2_RECON_CLOSED'; end if;
  if btrim(coalesce(p_reason,''))='' then raise exception using errcode='22023',message='TREASURY_V2_REVERSE_REASON_REQUIRED'; end if;
  update public.erp_treasury_reconciliation_matches set status='REVERSED',reversed_at=clock_timestamp(),reversed_by=auth.uid(),reverse_reason=btrim(p_reason) where company_id=p_company_id and reconciliation_match_id=p_match_id;
  update public.erp_treasury_bank_transactions set reconciled_amount=greatest(0,reconciled_amount-v_match.amount),
    reconciliation_status=case when greatest(0,reconciled_amount-v_match.amount)=0 then 'UNRECONCILED' else 'PARTIALLY_RECONCILED' end,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and bank_transaction_id=v_match.bank_transaction_id returning * into v_tx;
  v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_reconciliation_matches',p_match_id))
    ||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_transactions',v_match.bank_transaction_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('matchId',p_match_id::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_REVERSE_MATCH',p_match_id::text,jsonb_build_object('reason',p_reason),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_set_reconciliation_status(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_reconciliation_id uuid,p_action text,p_payload jsonb default '{}'::jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v public.erp_treasury_reconciliations%rowtype; v_action text:=upper(btrim(p_action)); v_records jsonb; v_result jsonb; v_book numeric; v_bank numeric;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  select * into v from public.erp_treasury_reconciliations where company_id=p_company_id and reconciliation_id=p_reconciliation_id for update;
  if not found then raise exception using errcode='P0002',message='TREASURY_V2_RECON_NOT_FOUND'; end if;
  if v_action='CLOSE' then
    if v.status='CLOSED' then raise exception using errcode='23514',message='TREASURY_V2_RECON_ALREADY_CLOSED'; end if;
    v_bank:=coalesce(nullif(p_payload->>'bankClosingBalance','')::numeric,v.bank_closing_balance);
    select coalesce(sum(case when direction='CREDIT' then amount else -amount end),0)+a.opening_balance into v_book
      from public.erp_treasury_bank_accounts a left join public.erp_treasury_bank_transactions t on t.company_id=a.company_id and t.bank_account_id=a.bank_account_id
       and t.status='CONFIRMED' and t.origin_type in ('EXPECTED','SYSTEM','MANUAL') and t.value_date<=v.period_end
      where a.company_id=p_company_id and a.bank_account_id=v.bank_account_id group by a.opening_balance;
    if abs(v_bank-coalesce(v_book,0))>0.01 and btrim(coalesce(v.notes,''))='' then
      raise exception using errcode='23514',message='TREASURY_V2_RECON_DIFFERENCE_REASON_REQUIRED';
    end if;
    update public.erp_treasury_reconciliations set status='CLOSED',bank_closing_balance=v_bank,book_closing_balance=coalesce(v_book,0),
      difference=v_bank-coalesce(v_book,0),closed_at=clock_timestamp(),closed_by=auth.uid(),updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id
      where company_id=p_company_id and reconciliation_id=p_reconciliation_id;
  elsif v_action='REOPEN' then
    if v.status<>'CLOSED' or btrim(coalesce(p_payload->>'reason',''))='' then raise exception using errcode='23514',message='TREASURY_V2_REOPEN_INVALID'; end if;
    update public.erp_treasury_reconciliations set status='REOPENED',reopened_at=clock_timestamp(),reopened_by=auth.uid(),reopen_reason=btrim(p_payload->>'reason'),
      updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and reconciliation_id=p_reconciliation_id;
  else raise exception using errcode='22023',message='TREASURY_V2_RECON_ACTION_INVALID'; end if;
  v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_reconciliations',p_reconciliation_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('reconciliationId',p_reconciliation_id::text,'action',v_action));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_RECON_'||v_action,p_reconciliation_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_transfer(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_id uuid:=gen_random_uuid(); v_code text; v_date date; v_amount numeric; v_src_type text; v_dst_type text; v_src uuid; v_dst uuid;
 v_src_ledger text; v_dst_ledger text; v_src_currency text; v_dst_currency text; v_journal uuid; v_tx uuid; v_tx_code text; v_records jsonb:='[]'; v_result jsonb; v_lines jsonb; v_available numeric;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  v_date:=coalesce(nullif(p_payload->>'transferDate','')::date,current_date); v_amount:=round((p_payload->>'amount')::numeric,6);
  v_src_type:=upper(p_payload->>'sourceAccountType'); v_dst_type:=upper(p_payload->>'destinationAccountType'); v_src:=(p_payload->>'sourceAccountId')::uuid; v_dst:=(p_payload->>'destinationAccountId')::uuid;
  if v_amount<=0 or v_src_type not in ('BANK','CASH') or v_dst_type not in ('BANK','CASH') or (v_src_type=v_dst_type and v_src=v_dst) then raise exception using errcode='22023',message='TREASURY_V2_TRANSFER_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(least(v_src::text,v_dst::text),0)); perform pg_advisory_xact_lock(hashtextextended(greatest(v_src::text,v_dst::text),0));
  if v_src_type='BANK' then select ledger_account_code,currency_code into v_src_ledger,v_src_currency from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=v_src and status='ACTIVE' for update;
  else select ledger_account_code,currency_code into v_src_ledger,v_src_currency from public.erp_treasury_cash_accounts where company_id=p_company_id and cash_account_id=v_src and status='ACTIVE' for update; end if;
  if v_dst_type='BANK' then select ledger_account_code,currency_code into v_dst_ledger,v_dst_currency from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=v_dst and status='ACTIVE' for update;
  else select ledger_account_code,currency_code into v_dst_ledger,v_dst_currency from public.erp_treasury_cash_accounts where company_id=p_company_id and cash_account_id=v_dst and status='ACTIVE' for update; end if;
  if v_src_ledger is null or v_dst_ledger is null then raise exception using errcode='23503',message='TREASURY_V2_TRANSFER_ACCOUNT_NOT_FOUND'; end if;
  if v_src_currency<>v_dst_currency or upper(coalesce(nullif(p_payload->>'currencyCode',''),v_src_currency))<>v_src_currency then
    raise exception using errcode='23514',message='TREASURY_V2_TRANSFER_CURRENCY_MISMATCH';
  end if;
  if v_src_type='BANK' then
    select a.opening_balance+coalesce(sum(case when t.status='CONFIRMED' and t.origin_type in ('EXPECTED','SYSTEM','MANUAL') then case when t.direction='CREDIT' then t.amount else -t.amount end else 0 end),0)
      into v_available from public.erp_treasury_bank_accounts a left join public.erp_treasury_bank_transactions t on t.company_id=a.company_id and t.bank_account_id=a.bank_account_id
      where a.company_id=p_company_id and a.bank_account_id=v_src group by a.opening_balance;
  else
    select a.opening_balance+coalesce(sum(case when t.status='CONFIRMED' then case when t.direction='CREDIT' then t.amount else -t.amount end else 0 end),0)
      into v_available from public.erp_treasury_cash_accounts a left join public.erp_treasury_cash_transactions t on t.company_id=a.company_id and t.cash_account_id=a.cash_account_id
      where a.company_id=p_company_id and a.cash_account_id=v_src group by a.opening_balance;
  end if;
  if coalesce(v_available,0)<v_amount then raise exception using errcode='23514',message='TREASURY_V2_TRANSFER_INSUFFICIENT_BALANCE'; end if;
  v_code:=public.erp_treasury_v2_next_code(p_company_id,'TRANSFER',v_date);
  v_lines:=jsonb_build_array(jsonb_build_object('accountCode',v_dst_ledger,'debit',v_amount,'credit',0,'lineDescription','Transferencia recibida '||v_code),
    jsonb_build_object('accountCode',v_src_ledger,'debit',0,'credit',v_amount,'lineDescription','Transferencia enviada '||v_code));
  v_journal:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
    jsonb_build_object('accountingDate',v_date,'concept','Transferencia '||v_code,'originModule','Tesoreria','sourceDocument',v_code,
      'externalReference',coalesce(p_payload->>'reference',''),'currencyCode',coalesce(p_payload->>'currencyCode','USD'),'lines',v_lines),
    'TREASURY_TRANSFER',v_id::text,'POST_TRANSFER');
  insert into public.erp_treasury_transfers(company_id,transfer_id,transfer_code,transfer_date,source_account_type,source_account_id,destination_account_type,destination_account_id,
    currency_code,amount,reference,notes,status,journal_entry_id,created_by,last_operation_id)
  values(p_company_id,v_id,v_code,v_date,v_src_type,v_src,v_dst_type,v_dst,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),v_amount,
    btrim(coalesce(p_payload->>'reference','')),btrim(coalesce(p_payload->>'notes','')),'CONFIRMED',v_journal,auth.uid(),p_operation_id);
  if v_src_type='BANK' then v_tx:=gen_random_uuid();v_tx_code:=public.erp_treasury_v2_next_code(p_company_id,'BANK_TRANSACTION',v_date);
    insert into public.erp_treasury_bank_transactions(company_id,bank_transaction_id,bank_account_id,transaction_code,transaction_date,value_date,direction,amount,currency_code,description,reference,origin_type,source_type,source_id,transfer_id,created_by,updated_by,last_operation_id)
    values(p_company_id,v_tx,v_src,v_tx_code,v_date,v_date,'DEBIT',v_amount,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),'Transferencia enviada '||v_code,coalesce(p_payload->>'reference',''),'EXPECTED','TRANSFER',v_id::text,v_id,auth.uid(),auth.uid(),p_operation_id);
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_transactions',v_tx));
  else v_tx:=gen_random_uuid();v_tx_code:=public.erp_treasury_v2_next_code(p_company_id,'CASH_TRANSACTION',v_date);
    insert into public.erp_treasury_cash_transactions(company_id,cash_transaction_id,cash_account_id,transaction_code,transaction_date,direction,amount,currency_code,description,reference,source_type,source_id,transfer_id,created_by,updated_by,last_operation_id)
    values(p_company_id,v_tx,v_src,v_tx_code,v_date,'DEBIT',v_amount,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),'Transferencia enviada '||v_code,coalesce(p_payload->>'reference',''),'TRANSFER',v_id::text,v_id,auth.uid(),auth.uid(),p_operation_id);
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_cash_transactions',v_tx)); end if;
  if v_dst_type='BANK' then v_tx:=gen_random_uuid();v_tx_code:=public.erp_treasury_v2_next_code(p_company_id,'BANK_TRANSACTION',v_date);
    insert into public.erp_treasury_bank_transactions(company_id,bank_transaction_id,bank_account_id,transaction_code,transaction_date,value_date,direction,amount,currency_code,description,reference,origin_type,source_type,source_id,transfer_id,created_by,updated_by,last_operation_id)
    values(p_company_id,v_tx,v_dst,v_tx_code,v_date,v_date,'CREDIT',v_amount,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),'Transferencia recibida '||v_code,coalesce(p_payload->>'reference',''),'EXPECTED','TRANSFER',v_id::text,v_id,auth.uid(),auth.uid(),p_operation_id);
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_transactions',v_tx));
  else v_tx:=gen_random_uuid();v_tx_code:=public.erp_treasury_v2_next_code(p_company_id,'CASH_TRANSACTION',v_date);
    insert into public.erp_treasury_cash_transactions(company_id,cash_transaction_id,cash_account_id,transaction_code,transaction_date,direction,amount,currency_code,description,reference,source_type,source_id,transfer_id,created_by,updated_by,last_operation_id)
    values(p_company_id,v_tx,v_dst,v_tx_code,v_date,'CREDIT',v_amount,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),'Transferencia recibida '||v_code,coalesce(p_payload->>'reference',''),'TRANSFER',v_id::text,v_id,auth.uid(),auth.uid(),p_operation_id);
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_cash_transactions',v_tx)); end if;
  v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_transfers',v_id))
    ||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_journal));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('transferId',v_id::text,'journalEntryId',v_journal::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_TRANSFER',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_treasury_v2_register_adjustment(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing jsonb; v_id uuid:=gen_random_uuid(); v_code text; v_date date; v_amount numeric; v_kind text; v_account uuid; v_ledger text;
 v_direction text; v_journal uuid; v_tx uuid; v_tx_code text; v_lines jsonb; v_records jsonb:='[]'; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id); if v_existing is not null then return v_existing; end if;
  v_kind:=upper(p_payload->>'accountType'); v_account:=(p_payload->>'accountId')::uuid; v_date:=coalesce(nullif(p_payload->>'adjustmentDate','')::date,current_date);
  v_amount:=round((p_payload->>'amount')::numeric,6); v_direction:=upper(coalesce(nullif(p_payload->>'direction',''),'DEBIT'));
  if v_amount<=0 or v_direction not in ('DEBIT','CREDIT') or btrim(coalesce(p_payload->>'reason',''))='' then raise exception using errcode='22023',message='TREASURY_V2_ADJUSTMENT_INVALID'; end if;
  if v_kind='BANK' then select ledger_account_code into v_ledger from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=v_account and status='ACTIVE' for update;
  elsif v_kind='CASH' then select ledger_account_code into v_ledger from public.erp_treasury_cash_accounts where company_id=p_company_id and cash_account_id=v_account and status='ACTIVE' for update;
  else raise exception using errcode='22023',message='TREASURY_V2_ACCOUNT_TYPE_INVALID'; end if;
  if v_ledger is null then raise exception using errcode='23503',message='TREASURY_V2_ACCOUNT_NOT_FOUND'; end if;
  perform public.erp_financial_v2_validate_account(p_company_id,p_payload->>'counterAccountCode');
  v_code:=public.erp_treasury_v2_next_code(p_company_id,'ADJUSTMENT',v_date);
  v_lines:=case when v_direction='DEBIT' then jsonb_build_array(
    jsonb_build_object('accountCode',p_payload->>'counterAccountCode','debit',v_amount,'credit',0,'lineDescription',p_payload->>'reason'),
    jsonb_build_object('accountCode',v_ledger,'debit',0,'credit',v_amount,'lineDescription',p_payload->>'reason'))
  else jsonb_build_array(
    jsonb_build_object('accountCode',v_ledger,'debit',v_amount,'credit',0,'lineDescription',p_payload->>'reason'),
    jsonb_build_object('accountCode',p_payload->>'counterAccountCode','debit',0,'credit',v_amount,'lineDescription',p_payload->>'reason')) end;
  v_journal:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
    jsonb_build_object('accountingDate',v_date,'concept','Ajuste de tesoreria '||v_code,'originModule','Tesoreria','sourceDocument',v_code,
      'externalReference',coalesce(p_payload->>'reference',''),'currencyCode',coalesce(p_payload->>'currencyCode','USD'),'observation',p_payload->>'reason','lines',v_lines),
    'TREASURY_ADJUSTMENT',v_id::text,'POST_TREASURY_ADJUSTMENT');
  insert into public.erp_treasury_adjustments(company_id,adjustment_id,adjustment_code,bank_transaction_id,bank_account_id,cash_account_id,adjustment_type,
    adjustment_date,amount,description,counter_account_code,status,journal_entry_id,created_by,last_operation_id)
  values(p_company_id,v_id,v_code,nullif(p_payload->>'bankTransactionId','')::uuid,case when v_kind='BANK' then v_account end,case when v_kind='CASH' then v_account end,
    upper(coalesce(nullif(p_payload->>'adjustmentType',''),'ADJUSTMENT')),v_date,v_amount,btrim(p_payload->>'reason'),btrim(p_payload->>'counterAccountCode'),'POSTED',v_journal,auth.uid(),p_operation_id);
  if v_kind='BANK' then v_tx:=gen_random_uuid();v_tx_code:=public.erp_treasury_v2_next_code(p_company_id,'BANK_TRANSACTION',v_date);
    insert into public.erp_treasury_bank_transactions(company_id,bank_transaction_id,bank_account_id,transaction_code,transaction_date,value_date,direction,amount,currency_code,
      description,reference,origin_type,source_type,source_id,journal_entry_id,created_by,updated_by,last_operation_id)
    values(p_company_id,v_tx,v_account,v_tx_code,v_date,v_date,v_direction,v_amount,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),btrim(p_payload->>'reason'),
      btrim(coalesce(p_payload->>'reference','')),'EXPECTED','ADJUSTMENT',v_id::text,v_journal,auth.uid(),auth.uid(),p_operation_id);
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_transactions',v_tx));
  else v_tx:=gen_random_uuid();v_tx_code:=public.erp_treasury_v2_next_code(p_company_id,'CASH_TRANSACTION',v_date);
    insert into public.erp_treasury_cash_transactions(company_id,cash_transaction_id,cash_account_id,transaction_code,transaction_date,direction,amount,currency_code,
      description,reference,source_type,source_id,journal_entry_id,created_by,updated_by,last_operation_id)
    values(p_company_id,v_tx,v_account,v_tx_code,v_date,v_direction,v_amount,upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),btrim(p_payload->>'reason'),
      btrim(coalesce(p_payload->>'reference','')),'ADJUSTMENT',v_id::text,v_journal,auth.uid(),auth.uid(),p_operation_id);
    v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_cash_transactions',v_tx)); end if;
  v_records:=v_records||jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_adjustments',v_id))
    ||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_journal));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('adjustmentId',v_id::text,'journalEntryId',v_journal::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_ADJUSTMENT',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace view public.erp_treasury_v2_bank_balances with (security_invoker=true) as
select a.company_id,a.bank_account_id,a.account_code,a.bank_name,a.currency_code,a.opening_balance,
 a.opening_balance+coalesce((select sum(case when t.direction='CREDIT' then t.amount else -t.amount end) from public.erp_treasury_bank_transactions t
   where t.company_id=a.company_id and t.bank_account_id=a.bank_account_id and t.status='CONFIRMED' and t.origin_type='REAL_STATEMENT'),0) bank_statement_balance,
 a.opening_balance+coalesce((select sum(case when t.direction='CREDIT' then t.amount else -t.amount end) from public.erp_treasury_bank_transactions t
   where t.company_id=a.company_id and t.bank_account_id=a.bank_account_id and t.status='CONFIRMED' and t.origin_type in ('EXPECTED','SYSTEM','MANUAL')),0) expected_treasury_balance,
 a.opening_balance+coalesce((select sum(l.debit-l.credit) from public.erp_financial_journal_lines l join public.erp_financial_journal_entries e
   on e.company_id=l.company_id and e.journal_entry_id=l.journal_entry_id where l.company_id=a.company_id and l.account_code=a.ledger_account_code
   and e.status='POSTED' and e.accounting_date>=a.opening_balance_date),0) book_balance
from public.erp_treasury_bank_accounts a;

create or replace view public.erp_treasury_v2_cash_balances with (security_invoker=true) as
select a.company_id,a.cash_account_id,a.account_code,a.name,a.currency_code,a.opening_balance+
 coalesce((select sum(case when t.direction='CREDIT' then t.amount else -t.amount end) from public.erp_treasury_cash_transactions t
  where t.company_id=a.company_id and t.cash_account_id=a.cash_account_id and t.status='CONFIRMED'),0) current_balance,
 a.opening_balance+coalesce((select sum(l.debit-l.credit) from public.erp_financial_journal_lines l join public.erp_financial_journal_entries e
  on e.company_id=l.company_id and e.journal_entry_id=l.journal_entry_id where l.company_id=a.company_id and l.account_code=a.ledger_account_code
  and e.status='POSTED' and e.accounting_date>=a.opening_balance_date),0) book_balance
from public.erp_treasury_cash_accounts a;

create or replace view public.erp_treasury_v2_cash_flow with (security_invoker=true) as
select company_id,'BANK'::text account_type,bank_account_id account_id,value_date flow_date,currency_code,
 case when origin_type='REAL_STATEMENT' then 'REAL' else 'EXPECTED' end flow_kind,
 sum(case when direction='CREDIT' then amount else -amount end) net_amount
from public.erp_treasury_bank_transactions where status='CONFIRMED' group by company_id,bank_account_id,value_date,currency_code,case when origin_type='REAL_STATEMENT' then 'REAL' else 'EXPECTED' end
union all
select company_id,'CASH',cash_account_id,transaction_date,currency_code,'REAL',sum(case when direction='CREDIT' then amount else -amount end)
from public.erp_treasury_cash_transactions where status='CONFIRMED' group by company_id,cash_account_id,transaction_date,currency_code;

create or replace function public.erp_treasury_v2_capture_financial_source()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_account uuid; v_cash uuid; v_id uuid; v_code text; v_date date; v_amount numeric; v_direction text; v_source_type text; v_source_id text; v_ledger text; v_operation uuid;
begin
  if tg_table_name='erp_financial_collections' then
    if new.status<>'CONFIRMED' then return new; end if;
    v_date:=new.collection_date;v_amount:=new.total;v_direction:='CREDIT';v_source_type:='COLLECTION';v_source_id:=new.collection_id::text;v_ledger:=new.debit_account_code;v_operation:=new.last_operation_id;
  elsif tg_table_name='erp_supplier_payments' then
    if new.status<>'CONFIRMED' then return new; end if;
    v_date:=new.payment_date;v_amount:=new.total;v_direction:='DEBIT';v_source_type:='SUPPLIER_PAYMENT';v_source_id:=new.payment_id::text;v_ledger:=new.payment_account_code;v_operation:=new.last_operation_id;
  else return new; end if;
  select bank_account_id into v_account from public.erp_treasury_bank_accounts where company_id=new.company_id and ledger_account_code=v_ledger and status='ACTIVE' limit 1;
  if v_account is not null then
    v_id:=gen_random_uuid();v_code:=public.erp_treasury_v2_next_code(new.company_id,'BANK_TRANSACTION',v_date);
    insert into public.erp_treasury_bank_transactions(company_id,bank_transaction_id,bank_account_id,transaction_code,transaction_date,value_date,direction,amount,currency_code,
      description,reference,origin_type,source_type,source_id,journal_entry_id,created_by,updated_by,last_operation_id)
    values(new.company_id,v_id,v_account,v_code,v_date,v_date,v_direction,v_amount,new.currency_code,
      case when v_source_type='COLLECTION' then 'Cobro esperado ' else 'Pago esperado ' end||v_source_id,coalesce(new.reference,''),'EXPECTED',v_source_type,v_source_id,new.journal_entry_id,auth.uid(),auth.uid(),v_operation)
    on conflict do nothing;
    if found then perform public.erp_treasury_v2_publish(new.company_id,v_operation,'SERVER-FINANCIAL-EVENT','treasury_bank_transactions',v_id); end if;
    return new;
  end if;
  select cash_account_id into v_cash from public.erp_treasury_cash_accounts where company_id=new.company_id and ledger_account_code=v_ledger and status='ACTIVE' limit 1;
  if v_cash is not null then
    v_id:=gen_random_uuid();v_code:=public.erp_treasury_v2_next_code(new.company_id,'CASH_TRANSACTION',v_date);
    insert into public.erp_treasury_cash_transactions(company_id,cash_transaction_id,cash_account_id,transaction_code,transaction_date,direction,amount,currency_code,
      description,reference,source_type,source_id,journal_entry_id,created_by,updated_by,last_operation_id)
    values(new.company_id,v_id,v_cash,v_code,v_date,v_direction,v_amount,new.currency_code,
      case when v_source_type='COLLECTION' then 'Cobro de caja ' else 'Pago de caja ' end||v_source_id,coalesce(new.reference,''),v_source_type,v_source_id,new.journal_entry_id,auth.uid(),auth.uid(),v_operation)
    on conflict do nothing;
    if found then perform public.erp_treasury_v2_publish(new.company_id,v_operation,'SERVER-FINANCIAL-EVENT','treasury_cash_transactions',v_id); end if;
  end if;
  return new;
end $$;

drop trigger if exists erp_treasury_capture_collection on public.erp_financial_collections;
create trigger erp_treasury_capture_collection after insert on public.erp_financial_collections for each row execute function public.erp_treasury_v2_capture_financial_source();
drop trigger if exists erp_treasury_capture_supplier_payment on public.erp_supplier_payments;
create trigger erp_treasury_capture_supplier_payment after insert on public.erp_supplier_payments for each row execute function public.erp_treasury_v2_capture_financial_source();

create or replace function public.erp_treasury_v2_health(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok',true,'component','TREASURY_V2','migration','202608150011','companyId',p_company_id::text,
    'bankAccountsTable',to_regclass('public.erp_treasury_bank_accounts') is not null,
    'cashAccountsTable',to_regclass('public.erp_treasury_cash_accounts') is not null,
    'statementImportsTable',to_regclass('public.erp_treasury_statement_imports') is not null,
    'bankTransactionsTable',to_regclass('public.erp_treasury_bank_transactions') is not null,
    'cashTransactionsTable',to_regclass('public.erp_treasury_cash_transactions') is not null,
    'transfersTable',to_regclass('public.erp_treasury_transfers') is not null,
    'reconciliationsTable',to_regclass('public.erp_treasury_reconciliations') is not null,
    'matchesTable',to_regclass('public.erp_treasury_reconciliation_matches') is not null,
    'reviewsTable',to_regclass('public.erp_treasury_reconciliation_reviews') is not null,
    'adjustmentsTable',to_regclass('public.erp_treasury_adjustments') is not null,
    'bankBalancesView',to_regclass('public.erp_treasury_v2_bank_balances') is not null,
    'cashBalancesView',to_regclass('public.erp_treasury_v2_cash_balances') is not null,
    'cashFlowView',to_regclass('public.erp_treasury_v2_cash_flow') is not null,
    'upsertBankRpc',to_regprocedure('public.erp_treasury_v2_upsert_bank_account(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'upsertCashRpc',to_regprocedure('public.erp_treasury_v2_upsert_cash_account(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'registerTransactionRpc',to_regprocedure('public.erp_treasury_v2_register_transaction(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'importStatementRpc',to_regprocedure('public.erp_treasury_v2_import_statement(uuid,uuid,text,uuid,text,text,jsonb,timestamp with time zone)') is not null,
    'saveReconciliationRpc',to_regprocedure('public.erp_treasury_v2_save_reconciliation(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reconcileRpc',to_regprocedure('public.erp_treasury_v2_reconcile(uuid,uuid,text,uuid,jsonb,text,timestamp with time zone)') is not null,
    'reverseMatchRpc',to_regprocedure('public.erp_treasury_v2_reverse_match(uuid,uuid,text,uuid,text,timestamp with time zone)') is not null,
    'reviewRpc',to_regprocedure('public.erp_treasury_v2_review_reconciliation(uuid,uuid,text,uuid,text,text,text,text,timestamp with time zone)') is not null,
    'statusRpc',to_regprocedure('public.erp_treasury_v2_set_reconciliation_status(uuid,uuid,text,uuid,text,jsonb,timestamp with time zone)') is not null,
    'transferRpc',to_regprocedure('public.erp_treasury_v2_transfer(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'adjustmentRpc',to_regprocedure('public.erp_treasury_v2_register_adjustment(uuid,uuid,text,jsonb,timestamp with time zone)') is not null
  );
end $$;

grant select on public.erp_treasury_bank_accounts,public.erp_treasury_cash_accounts,public.erp_treasury_statement_imports,
  public.erp_treasury_bank_transactions,public.erp_treasury_cash_transactions,public.erp_treasury_transfers,
  public.erp_treasury_reconciliations,public.erp_treasury_reconciliation_matches,public.erp_treasury_reconciliation_reviews,
  public.erp_treasury_adjustments to authenticated;
revoke insert,update,delete,truncate on public.erp_treasury_bank_accounts,public.erp_treasury_cash_accounts,public.erp_treasury_statement_imports,
  public.erp_treasury_bank_transactions,public.erp_treasury_cash_transactions,public.erp_treasury_transfers,
  public.erp_treasury_reconciliations,public.erp_treasury_reconciliation_matches,public.erp_treasury_reconciliation_reviews,
  public.erp_treasury_adjustments from authenticated,anon;

revoke all on function public.erp_treasury_v2_next_code(uuid,text,date) from public,anon,authenticated;
revoke all on function public.erp_treasury_v2_publish(uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_treasury_v2_command_result(uuid,uuid) from public,anon,authenticated;
revoke all on function public.erp_treasury_v2_source_total(uuid,text,text) from public,anon,authenticated;
revoke all on function public.erp_treasury_v2_capture_financial_source() from public,anon,authenticated;
revoke all on function public.erp_treasury_v2_health(uuid) from public,anon;
grant execute on function public.erp_treasury_v2_health(uuid) to authenticated;

grant select on public.erp_treasury_v2_bank_balances,public.erp_treasury_v2_cash_balances,public.erp_treasury_v2_cash_flow to authenticated;
revoke all on function public.erp_treasury_v2_upsert_bank_account(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_upsert_cash_account(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_register_transaction(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_import_statement(uuid,uuid,text,uuid,text,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_save_reconciliation(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_reconcile(uuid,uuid,text,uuid,jsonb,text,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_reverse_match(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_review_reconciliation(uuid,uuid,text,uuid,text,text,text,text,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_set_reconciliation_status(uuid,uuid,text,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_transfer(uuid,uuid,text,jsonb,timestamptz) from public,anon;
revoke all on function public.erp_treasury_v2_register_adjustment(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_treasury_v2_upsert_bank_account(uuid,uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_upsert_cash_account(uuid,uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_register_transaction(uuid,uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_import_statement(uuid,uuid,text,uuid,text,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_save_reconciliation(uuid,uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_reconcile(uuid,uuid,text,uuid,jsonb,text,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_reverse_match(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_review_reconciliation(uuid,uuid,text,uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_set_reconciliation_status(uuid,uuid,text,uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_transfer(uuid,uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_treasury_v2_register_adjustment(uuid,uuid,text,jsonb,timestamptz) to authenticated;

select pg_notify('pgrst','reload schema');
