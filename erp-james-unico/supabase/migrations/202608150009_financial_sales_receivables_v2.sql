begin;

-- FASE 7: contabilidad de ventas, CxC, cobros y costos de exportacion.
-- No migra compras, CxP, bancos, conciliacion, nomina ni activos fijos.

create table if not exists public.erp_financial_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  sequence_type text not null check (sequence_type in ('JOURNAL','COLLECTION')),
  calendar_year integer not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, sequence_type, calendar_year)
);

create table if not exists public.erp_financial_period_controls (
  company_id uuid not null references public.companies(id) on delete cascade,
  accounting_period text not null check (accounting_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  primary key (company_id, accounting_period)
);

create table if not exists public.erp_financial_journal_entries (
  company_id uuid not null references public.companies(id) on delete cascade,
  journal_entry_id uuid not null,
  entry_number text not null,
  accounting_date date not null,
  accounting_period text not null,
  concept text not null,
  origin_module text not null,
  source_type text not null,
  source_id text,
  event_type text not null,
  source_document text not null default '',
  external_reference text not null default '',
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  status text not null default 'POSTED' check (status in ('DRAFT','POSTED','REVERSED','CANCELLED')),
  total_debit numeric(20,6) not null,
  total_credit numeric(20,6) not null,
  reverse_of_id uuid,
  legacy_draft_id text,
  observation text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, journal_entry_id),
  unique (company_id, entry_number)
);

create unique index if not exists erp_financial_journal_source_event_idx
  on public.erp_financial_journal_entries(company_id, source_type, source_id, event_type)
  where source_id is not null and status <> 'CANCELLED';

create table if not exists public.erp_financial_journal_lines (
  company_id uuid not null,
  journal_entry_line_id uuid not null,
  journal_entry_id uuid not null,
  line_number integer not null check (line_number > 0),
  account_code text not null,
  account_name_snapshot text not null default '',
  debit numeric(20,6) not null default 0 check (debit >= 0),
  credit numeric(20,6) not null default 0 check (credit >= 0),
  cost_center text not null default '',
  auxiliary text not null default '',
  description text not null default '',
  document_reference text not null default '',
  primary key (company_id, journal_entry_line_id),
  unique (company_id, journal_entry_id, line_number),
  foreign key (company_id, journal_entry_id)
    references public.erp_financial_journal_entries(company_id, journal_entry_id) on delete restrict,
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table if not exists public.erp_financial_receivables (
  company_id uuid not null references public.companies(id) on delete cascade,
  receivable_id uuid not null,
  customer_id text not null,
  customer_name_snapshot text not null,
  customer_tax_id_snapshot text not null default '',
  source_type text not null,
  source_id text not null,
  electronic_document_id text,
  order_id text,
  shipment_id uuid,
  document_type text not null,
  document_number text not null,
  issue_date date not null,
  due_date date not null,
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  subtotal numeric(20,6) not null default 0,
  tax_total numeric(20,6) not null default 0,
  total numeric(20,6) not null check (total >= 0),
  credited_total numeric(20,6) not null default 0 check (credited_total >= 0),
  balance numeric(20,6) not null check (balance >= 0),
  status text not null default 'OPEN' check (status in ('OPEN','PARTIALLY_PAID','PAID','CANCELLED')),
  journal_entry_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, receivable_id),
  unique (company_id, source_type, source_id),
  unique (company_id, document_type, document_number),
  foreign key (company_id, journal_entry_id)
    references public.erp_financial_journal_entries(company_id, journal_entry_id) on delete restrict,
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict
);

create table if not exists public.erp_financial_credit_notes (
  company_id uuid not null references public.companies(id) on delete cascade,
  credit_note_id uuid not null,
  receivable_id uuid not null,
  source_id text not null,
  document_number text not null,
  issue_date date not null,
  subtotal numeric(20,6) not null default 0,
  tax_total numeric(20,6) not null default 0,
  total numeric(20,6) not null check (total > 0),
  reason text not null default '',
  journal_entry_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  last_operation_id uuid not null,
  primary key (company_id, credit_note_id),
  unique (company_id, source_id),
  foreign key (company_id, receivable_id)
    references public.erp_financial_receivables(company_id, receivable_id) on delete restrict,
  foreign key (company_id, journal_entry_id)
    references public.erp_financial_journal_entries(company_id, journal_entry_id) on delete restrict
);

create table if not exists public.erp_financial_collections (
  company_id uuid not null references public.companies(id) on delete cascade,
  collection_id uuid not null,
  collection_number text not null,
  client_reference_id text,
  customer_id text not null,
  collection_date date not null,
  payment_method text not null,
  reference text not null default '',
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  total numeric(20,6) not null check (total > 0),
  debit_account_code text not null,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','REVERSED')),
  journal_entry_id uuid not null,
  reverse_journal_entry_id uuid,
  reversal_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  last_operation_id uuid not null,
  primary key (company_id, collection_id),
  unique (company_id, collection_number),
  foreign key (company_id, journal_entry_id)
    references public.erp_financial_journal_entries(company_id, journal_entry_id) on delete restrict
);

create unique index if not exists erp_financial_collection_client_ref_idx
  on public.erp_financial_collections(company_id, client_reference_id)
  where client_reference_id is not null;

create table if not exists public.erp_financial_collection_applications (
  company_id uuid not null,
  collection_application_id uuid not null,
  collection_id uuid not null,
  receivable_id uuid not null,
  amount numeric(20,6) not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (company_id, collection_application_id),
  unique (company_id, collection_id, receivable_id),
  foreign key (company_id, collection_id)
    references public.erp_financial_collections(company_id, collection_id) on delete restrict,
  foreign key (company_id, receivable_id)
    references public.erp_financial_receivables(company_id, receivable_id) on delete restrict
);

create table if not exists public.erp_financial_order_cost_components (
  company_id uuid not null references public.companies(id) on delete cascade,
  cost_component_id uuid not null,
  order_id text not null,
  shipment_id uuid,
  category text not null check (category in ('FLOWER','PACKAGING','LABOR','TRANSPORT','CARGO_AGENCY','AIR_FREIGHT','DOCUMENTATION','HANDLING','OTHER')),
  source_type text not null,
  source_id text not null,
  amount numeric(20,6) not null check (amount >= 0),
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  description text not null default '',
  accounting_status text not null default 'UNPOSTED' check (accounting_status in ('UNPOSTED','POSTED','REVERSED')),
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  last_operation_id uuid not null,
  primary key (company_id, cost_component_id),
  unique (company_id, source_type, source_id, category),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict
);

create table if not exists public.erp_financial_shipment_expenses (
  company_id uuid not null references public.companies(id) on delete cascade,
  expense_id uuid not null,
  shipment_id uuid not null,
  category text not null check (category in ('TRANSPORT','CARGO_AGENCY','AIR_FREIGHT','DOCUMENTATION','PHYTOSANITARY','HANDLING','OTHER')),
  source_type text not null,
  source_id text not null,
  provider_id text,
  amount numeric(20,6) not null check (amount > 0),
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  allocation_method text not null check (allocation_method in ('BOXES','WEIGHT','STEMS','BUNCHES','FOB_VALUE','MANUAL')),
  description text not null default '',
  accounting_status text not null default 'UNPOSTED' check (accounting_status in ('UNPOSTED','POSTED','REVERSED')),
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  last_operation_id uuid not null,
  primary key (company_id, expense_id),
  unique (company_id, source_type, source_id, category),
  foreign key (company_id, shipment_id)
    references public.erp_export_shipment_registry(company_id, shipment_id) on delete restrict
);

create table if not exists public.erp_financial_cost_allocations (
  company_id uuid not null,
  allocation_id uuid not null,
  expense_id uuid not null,
  order_id text not null,
  allocation_method text not null,
  basis_value numeric(20,6) not null default 0,
  percentage numeric(12,8) not null default 0,
  amount numeric(20,6) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (company_id, allocation_id),
  unique (company_id, expense_id, order_id),
  foreign key (company_id, expense_id)
    references public.erp_financial_shipment_expenses(company_id, expense_id) on delete restrict
);

create table if not exists public.erp_financial_events (
  company_id uuid not null references public.companies(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  source_type text not null,
  source_id text not null,
  payload jsonb not null default '{}'::jsonb,
  operation_id uuid not null,
  device_id text not null,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  primary key (company_id, event_id)
);

create index if not exists erp_financial_journal_period_idx on public.erp_financial_journal_entries(company_id, accounting_period, accounting_date, entry_number);
create index if not exists erp_financial_journal_account_idx on public.erp_financial_journal_lines(company_id, account_code, journal_entry_id);
create index if not exists erp_financial_receivable_status_idx on public.erp_financial_receivables(company_id, status, due_date);
create index if not exists erp_financial_receivable_order_idx on public.erp_financial_receivables(company_id, order_id);
create index if not exists erp_financial_collection_date_idx on public.erp_financial_collections(company_id, collection_date desc);
create index if not exists erp_financial_cost_order_idx on public.erp_financial_order_cost_components(company_id, order_id, category);
create index if not exists erp_financial_expense_shipment_idx on public.erp_financial_shipment_expenses(company_id, shipment_id, category);
create index if not exists erp_financial_event_source_idx on public.erp_financial_events(company_id, source_type, source_id, occurred_at desc);

do $$ declare v_table text; begin
  foreach v_table in array array[
    'erp_financial_sequence_counters','erp_financial_period_controls','erp_financial_journal_entries',
    'erp_financial_journal_lines','erp_financial_receivables','erp_financial_credit_notes','erp_financial_collections',
    'erp_financial_collection_applications','erp_financial_order_cost_components',
    'erp_financial_shipment_expenses','erp_financial_cost_allocations','erp_financial_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_member_select', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_company_memberships m where m.company_id=%I.company_id and m.user_id=auth.uid() and m.membership_status=''ACTIVE''))',
      v_table || '_member_select', v_table, v_table
    );
  end loop;
end $$;

do $$ declare v_table text; begin
  foreach v_table in array array[
    'erp_financial_sequence_counters','erp_financial_period_controls','erp_financial_journal_entries',
    'erp_financial_journal_lines','erp_financial_receivables','erp_financial_credit_notes','erp_financial_collections',
    'erp_financial_collection_applications','erp_financial_order_cost_components',
    'erp_financial_shipment_expenses','erp_financial_cost_allocations','erp_financial_events'
  ] loop
    execute format('revoke all on table public.%I from anon,authenticated',v_table);
    execute format('grant select on table public.%I to authenticated',v_table);
  end loop;
end $$;

create or replace function public.erp_financial_v2_assert_access(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.erp_export_v2_assert_access(p_company_id); end $$;

create or replace function public.erp_financial_v2_next_code(p_company_id uuid,p_type text,p_date date)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_type text:=upper(btrim(p_type)); v_year integer:=extract(year from p_date)::integer; v_value bigint;
begin
  if v_type not in ('JOURNAL','COLLECTION') then raise exception using errcode='22023',message='FINANCE_V2_SEQUENCE_TYPE_INVALID'; end if;
  insert into public.erp_financial_sequence_counters(company_id,sequence_type,calendar_year,last_value,updated_at)
  values(p_company_id,v_type,v_year,1,clock_timestamp())
  on conflict(company_id,sequence_type,calendar_year) do update set
    last_value=erp_financial_sequence_counters.last_value+1,updated_at=clock_timestamp()
  returning last_value into v_value;
  return (case when v_type='JOURNAL' then 'ASI-' else 'COB-' end)||v_year||'-'||lpad(v_value::text,6,'0');
end $$;

create or replace function public.erp_financial_v2_validate_account(p_company_id uuid,p_code text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payload jsonb;
begin
  select payload into v_payload from public.erp_entity_records
   where company_id=p_company_id and entity='accounting_chart_accounts' and deleted_at is null
     and coalesce(payload->>'code',record_id)=btrim(p_code) limit 1;
  if not found then raise exception using errcode='23503',message='FINANCE_V2_ACCOUNT_NOT_FOUND:'||btrim(p_code); end if;
  if lower(coalesce(v_payload->>'status','activa')) not in ('activa','active')
     or lower(coalesce(v_payload->>'isMovement',v_payload->>'is_movement','false')) not in ('true','1') then
    raise exception using errcode='23514',message='FINANCE_V2_ACCOUNT_NOT_POSTABLE:'||btrim(p_code);
  end if;
  return coalesce(v_payload->>'name',btrim(p_code));
end $$;

create or replace function public.erp_financial_v2_write_event(
 p_company_id uuid,p_operation_id uuid,p_device_id text,p_event_type text,p_source_type text,p_source_id text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid:=gen_random_uuid(); v_saved jsonb;
begin
 insert into public.erp_financial_events(company_id,event_id,event_type,source_type,source_id,payload,operation_id,device_id,occurred_at,user_id)
 values(p_company_id,v_id,upper(btrim(p_event_type)),upper(btrim(p_source_type)),p_source_id,coalesce(p_payload,'{}'),p_operation_id,p_device_id,clock_timestamp(),auth.uid());
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_events',v_id::text,
   jsonb_build_object('id',v_id::text,'eventId',v_id::text,'eventType',upper(btrim(p_event_type)),'sourceType',upper(btrim(p_source_type)),
   'sourceId',p_source_id,'payload',coalesce(p_payload,'{}'),'operationId',p_operation_id::text,'occurredAt',clock_timestamp(),'syncFlow','FINANCIAL_V2'),0);
 return v_saved;
end $$;

create or replace function public.erp_financial_v2_publish_entry(
 p_company_id uuid,p_operation_id uuid,p_device_id text,p_entry_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.erp_financial_journal_entries%rowtype; v_lines jsonb; v_saved jsonb;
begin
 select * into v_entry from public.erp_financial_journal_entries where company_id=p_company_id and journal_entry_id=p_entry_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',journal_entry_line_id::text,'accountCode',account_code,'accountName',account_name_snapshot,
   'debit',debit,'credit',credit,'costCenter',cost_center,'auxiliary',auxiliary,'lineDescription',description,
   'documentReference',document_reference) order by line_number),'[]') into v_lines
 from public.erp_financial_journal_lines where company_id=p_company_id and journal_entry_id=p_entry_id;
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_journal_entries',p_entry_id::text,
   jsonb_build_object('id',p_entry_id::text,'journalEntryId',p_entry_id::text,'entryNumber',v_entry.entry_number,
   'accountingDate',v_entry.accounting_date,'accountingPeriod',v_entry.accounting_period,'concept',v_entry.concept,
   'originModule',v_entry.origin_module,'sourceType',v_entry.source_type,'sourceId',v_entry.source_id,'eventType',v_entry.event_type,
   'sourceDocument',v_entry.source_document,'externalReference',v_entry.external_reference,'currencyCode',v_entry.currency_code,
   'exchangeRate',v_entry.exchange_rate,'status',v_entry.status,'totalDebit',v_entry.total_debit,'totalCredit',v_entry.total_credit,
   'reverseOfId',v_entry.reverse_of_id::text,'legacyDraftId',v_entry.legacy_draft_id,'observation',v_entry.observation,
   'createdAt',v_entry.created_at,'postedAt',v_entry.posted_at,'reversedAt',v_entry.reversed_at,'lines',v_lines,
   'version',v_entry.version,'syncFlow','FINANCIAL_V2'),
   coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_journal_entries' and record_id=p_entry_id::text),0));
 return v_saved;
end $$;

create or replace function public.erp_financial_v2_create_entry_internal(
 p_company_id uuid,p_operation_id uuid,p_device_id text,p_payload jsonb,p_source_type text,p_source_id text,p_event_type text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid:=coalesce(nullif(p_payload->>'journalEntryId','')::uuid,gen_random_uuid()); v_date date; v_period text; v_line jsonb;
 v_debit numeric(20,6):=0; v_credit numeric(20,6):=0; v_number text; v_index integer:=0; v_account_name text;
begin
 v_date:=coalesce(nullif(p_payload->>'accountingDate','')::date,current_date);
 v_period:=to_char(v_date,'YYYY-MM');
 if exists(select 1 from public.erp_financial_period_controls where company_id=p_company_id and accounting_period=v_period and status='CLOSED') then
   raise exception using errcode='23514',message='FINANCE_V2_PERIOD_CLOSED:'||v_period;
 end if;
 if jsonb_typeof(coalesce(p_payload->'lines','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'lines','[]'))<2 then
   raise exception using errcode='22023',message='FINANCE_V2_LINES_REQUIRED';
 end if;
 for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
   v_debit:=v_debit+round(coalesce(nullif(v_line->>'debit','')::numeric,0),6);
   v_credit:=v_credit+round(coalesce(nullif(v_line->>'credit','')::numeric,0),6);
   if (coalesce(nullif(v_line->>'debit','')::numeric,0)>0)=(coalesce(nullif(v_line->>'credit','')::numeric,0)>0) then
     raise exception using errcode='23514',message='FINANCE_V2_LINE_SIDE_INVALID';
   end if;
 end loop;
 if round(v_debit,6)<>round(v_credit,6) or v_debit<=0 then
   raise exception using errcode='23514',message='FINANCE_V2_UNBALANCED_ENTRY';
 end if;
 v_number:=public.erp_financial_v2_next_code(p_company_id,'JOURNAL',v_date);
 insert into public.erp_financial_journal_entries(company_id,journal_entry_id,entry_number,accounting_date,accounting_period,concept,
   origin_module,source_type,source_id,event_type,source_document,external_reference,currency_code,exchange_rate,status,
   total_debit,total_credit,legacy_draft_id,observation,created_at,created_by,posted_at,posted_by,last_operation_id)
 values(p_company_id,v_id,v_number,v_date,v_period,btrim(coalesce(p_payload->>'concept','Asiento contable')),
   btrim(coalesce(p_payload->>'originModule','Manual')),upper(btrim(p_source_type)),nullif(btrim(p_source_id),''),upper(btrim(p_event_type)),
   btrim(coalesce(p_payload->>'sourceDocument','')),btrim(coalesce(p_payload->>'externalReference','')),
   upper(btrim(coalesce(p_payload->>'currencyCode','USD'))),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
   'POSTED',v_debit,v_credit,nullif(p_payload->>'legacyDraftId',''),btrim(coalesce(p_payload->>'observation','')),
   clock_timestamp(),auth.uid(),clock_timestamp(),auth.uid(),p_operation_id);
 for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
   v_index:=v_index+1; v_account_name:=public.erp_financial_v2_validate_account(p_company_id,v_line->>'accountCode');
   insert into public.erp_financial_journal_lines(company_id,journal_entry_line_id,journal_entry_id,line_number,account_code,
    account_name_snapshot,debit,credit,cost_center,auxiliary,description,document_reference)
   values(p_company_id,gen_random_uuid(),v_id,v_index,btrim(v_line->>'accountCode'),v_account_name,
    round(coalesce(nullif(v_line->>'debit','')::numeric,0),6),round(coalesce(nullif(v_line->>'credit','')::numeric,0),6),
    btrim(coalesce(v_line->>'costCenter','')),btrim(coalesce(v_line->>'auxiliary','')),
    btrim(coalesce(v_line->>'lineDescription','')),btrim(coalesce(v_line->>'documentReference','')));
 end loop;
 return v_id;
end $$;

create or replace function public.erp_financial_v2_post_journal(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_source_type text default 'MANUAL',
 p_source_id text default null,p_event_type text default 'POST_JOURNAL',p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_id uuid; v_records jsonb:='[]'; v_result jsonb;
begin
 perform public.erp_financial_v2_assert_access(p_company_id);
 if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='FINANCE_V2_COMMAND_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
 if found then return v_existing.result; end if;
 if nullif(btrim(p_source_id),'') is not null then
   select journal_entry_id into v_id from public.erp_financial_journal_entries where company_id=p_company_id and source_type=upper(btrim(p_source_type)) and source_id=p_source_id and event_type=upper(btrim(p_event_type)) and status<>'CANCELLED';
 end if;
 if v_id is null then v_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_payload,p_source_type,p_source_id,p_event_type); end if;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_id));
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,p_event_type,p_source_type,coalesce(p_source_id,v_id::text),jsonb_build_object('journalEntryId',v_id::text)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('journalEntryId',v_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_POST_JOURNAL',coalesce(p_source_id,v_id::text),p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
 return v_result;
end $$;

create or replace function public.erp_financial_v2_post_invoice(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_invoice jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_source_id text; v_receivable public.erp_financial_receivables%rowtype;
 v_entry_id uuid; v_receivable_id uuid:=gen_random_uuid(); v_total numeric(20,6); v_subtotal numeric(20,6); v_tax numeric(20,6);
 v_lines jsonb; v_records jsonb:='[]'; v_saved jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform public.erp_financial_v2_assert_access(p_company_id);
 if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='FINANCE_V2_COMMAND_INVALID'; end if;
 v_source_id:=coalesce(nullif(btrim(p_invoice->>'electronicDocumentId'),''),nullif(btrim(p_invoice->>'sourceId'),''));
 if v_source_id is null then raise exception using errcode='22023',message='FINANCE_V2_INVOICE_SOURCE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
 if found then return v_existing.result; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':INVOICE:'||v_source_id,0));
 select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and source_type='INVOICE' and source_id=v_source_id;
 if not found then
   v_total:=round(coalesce(nullif(p_invoice->>'total','')::numeric,0),6); v_tax:=round(coalesce(nullif(p_invoice->>'taxTotal','')::numeric,0),6);
   v_subtotal:=round(coalesce(nullif(p_invoice->>'subtotal','')::numeric,v_total-v_tax),6);
   if v_total<0 or v_subtotal<0 or round(v_subtotal+v_tax,6)<>v_total then raise exception using errcode='23514',message='FINANCE_V2_INVOICE_TOTAL_INVALID'; end if;
   v_lines:=jsonb_build_array(
    jsonb_build_object('accountCode',p_invoice->>'receivableAccountCode','debit',v_total,'credit',0,'auxiliary',coalesce(p_invoice->>'customerTaxId',p_invoice->>'customerName'),'lineDescription','CxC '||coalesce(p_invoice->>'documentNumber','')),
    jsonb_build_object('accountCode',p_invoice->>'counterAccountCode','debit',0,'credit',v_subtotal,'lineDescription','Venta '||coalesce(p_invoice->>'documentNumber',''))
   );
   if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode',p_invoice->>'taxAccountCode','debit',0,'credit',v_tax,'lineDescription','IVA venta '||coalesce(p_invoice->>'documentNumber',''))); end if;
   v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
    jsonb_build_object('accountingDate',p_invoice->>'issueDate','concept','Venta '||coalesce(p_invoice->>'documentNumber',''),
      'originModule','Ventas','sourceDocument',p_invoice->>'documentNumber','externalReference',coalesce(p_invoice->>'accessKey',p_invoice->>'authorizationNumber',''),
      'currencyCode',coalesce(p_invoice->>'currencyCode','USD'),'exchangeRate',coalesce(p_invoice->>'exchangeRate','1'),'lines',v_lines),
    'INVOICE',v_source_id,'POST_INVOICE');
   insert into public.erp_financial_receivables(company_id,receivable_id,customer_id,customer_name_snapshot,customer_tax_id_snapshot,
    source_type,source_id,electronic_document_id,order_id,shipment_id,document_type,document_number,issue_date,due_date,
    currency_code,exchange_rate,subtotal,tax_total,total,balance,status,journal_entry_id,created_at,created_by,updated_at,updated_by,last_operation_id)
   values(p_company_id,v_receivable_id,btrim(p_invoice->>'customerId'),btrim(p_invoice->>'customerName'),btrim(coalesce(p_invoice->>'customerTaxId','')),
    'INVOICE',v_source_id,nullif(p_invoice->>'electronicDocumentId',''),nullif(p_invoice->>'orderId',''),nullif(p_invoice->>'shipmentId','')::uuid,
    coalesce(nullif(upper(p_invoice->>'documentType'),''),'INVOICE'),btrim(p_invoice->>'documentNumber'),(p_invoice->>'issueDate')::date,
    coalesce(nullif(p_invoice->>'dueDate','')::date,(p_invoice->>'issueDate')::date),upper(coalesce(p_invoice->>'currencyCode','USD')),
    coalesce(nullif(p_invoice->>'exchangeRate','')::numeric,1),v_subtotal,v_tax,v_total,v_total,'OPEN',v_entry_id,v_now,auth.uid(),v_now,auth.uid(),p_operation_id);
   select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and receivable_id=v_receivable_id;
 else v_entry_id:=v_receivable.journal_entry_id;
 end if;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id));
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_receivables',v_receivable.receivable_id::text,
  jsonb_build_object('id',v_receivable.receivable_id::text,'receivableId',v_receivable.receivable_id::text,'customerId',v_receivable.customer_id,
   'customerName',v_receivable.customer_name_snapshot,'customerTaxId',v_receivable.customer_tax_id_snapshot,'sourceType',v_receivable.source_type,
   'sourceId',v_receivable.source_id,'electronicDocumentId',v_receivable.electronic_document_id,'orderId',v_receivable.order_id,
   'shipmentId',v_receivable.shipment_id::text,'documentType',v_receivable.document_type,'documentNumber',v_receivable.document_number,
   'issueDate',v_receivable.issue_date,'dueDate',v_receivable.due_date,'currencyCode',v_receivable.currency_code,'exchangeRate',v_receivable.exchange_rate,
   'subtotal',v_receivable.subtotal,'taxTotal',v_receivable.tax_total,'total',v_receivable.total,'balance',v_receivable.balance,
   'status',v_receivable.status,'postingStatus','CONTABILIZADO','journalEntryId',v_entry_id::text,
   'createdAt',v_receivable.created_at,'updatedAtServer',v_receivable.updated_at,'version',v_receivable.version,'syncFlow','FINANCIAL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_receivables' and record_id=v_receivable.receivable_id::text),0));
 v_records:=v_records||jsonb_build_array(v_saved)||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_INVOICE','INVOICE',v_source_id,jsonb_build_object('receivableId',v_receivable.receivable_id::text,'journalEntryId',v_entry_id::text)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('receivableId',v_receivable.receivable_id::text,'journalEntryId',v_entry_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_POST_INVOICE',v_source_id,p_invoice,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_financial_v2_reverse_journal(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_journal_entry_id uuid,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_source public.erp_financial_journal_entries%rowtype; v_lines jsonb;
 v_reverse_id uuid; v_records jsonb:='[]'; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
 select * into v_source from public.erp_financial_journal_entries where company_id=p_company_id and journal_entry_id=p_journal_entry_id for update;
 if not found then raise exception using errcode='P0002',message='FINANCE_V2_JOURNAL_NOT_FOUND'; end if;
 if v_source.status<>'POSTED' then raise exception using errcode='23514',message='FINANCE_V2_JOURNAL_NOT_POSTED'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='FINANCE_V2_REVERSAL_REASON_REQUIRED'; end if;
 select jsonb_agg(jsonb_build_object('accountCode',account_code,'debit',credit,'credit',debit,'costCenter',cost_center,
  'auxiliary',auxiliary,'lineDescription','Reverso: '||description,'documentReference',document_reference) order by line_number) into v_lines
 from public.erp_financial_journal_lines where company_id=p_company_id and journal_entry_id=p_journal_entry_id;
 v_reverse_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
  jsonb_build_object('accountingDate',current_date,'concept','Reverso de '||v_source.entry_number||' - '||v_source.concept,
   'originModule','Ajustes','sourceDocument',v_source.source_document,'externalReference',v_source.entry_number,
   'currencyCode',v_source.currency_code,'exchangeRate',v_source.exchange_rate,'lines',v_lines,'observation',p_reason),
  'JOURNAL_ENTRY',p_journal_entry_id::text,'REVERSE_JOURNAL');
 update public.erp_financial_journal_entries set status='REVERSED',reversed_at=v_now,reversed_by=auth.uid(),version=version+1,
  last_operation_id=p_operation_id where company_id=p_company_id and journal_entry_id=p_journal_entry_id;
 update public.erp_financial_journal_entries set reverse_of_id=p_journal_entry_id where company_id=p_company_id and journal_entry_id=v_reverse_id;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,p_journal_entry_id))
  ||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse_id))
  ||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'REVERSE_JOURNAL','JOURNAL_ENTRY',p_journal_entry_id::text,jsonb_build_object('reverseJournalEntryId',v_reverse_id::text,'reason',p_reason)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('journalEntryId',p_journal_entry_id::text,'reverseJournalEntryId',v_reverse_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_REVERSE_JOURNAL',p_journal_entry_id::text,jsonb_build_object('reason',p_reason),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_financial_v2_post_credit_note(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_credit_note jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_receivable public.erp_financial_receivables%rowtype;
 v_credit public.erp_financial_credit_notes%rowtype; v_credit_id uuid:=gen_random_uuid(); v_source_id text; v_entry_id uuid;
 v_subtotal numeric(20,6); v_tax numeric(20,6); v_total numeric(20,6); v_lines jsonb; v_records jsonb:='[]'; v_saved jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
 v_source_id:=coalesce(nullif(btrim(p_credit_note->>'electronicDocumentId'),''),nullif(btrim(p_credit_note->>'sourceId'),''));
 if v_source_id is null then raise exception using errcode='22023',message='FINANCE_V2_CREDIT_NOTE_SOURCE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':CREDIT_NOTE:'||v_source_id,0));
 select * into v_credit from public.erp_financial_credit_notes where company_id=p_company_id and source_id=v_source_id;
 if found then v_credit_id:=v_credit.credit_note_id; v_entry_id:=v_credit.journal_entry_id;
 else
  select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and receivable_id=(p_credit_note->>'receivableId')::uuid for update;
  if not found or v_receivable.status='CANCELLED' then raise exception using errcode='P0002',message='FINANCE_V2_RECEIVABLE_NOT_FOUND'; end if;
  v_total:=round(coalesce(nullif(p_credit_note->>'total','')::numeric,0),6); v_tax:=round(coalesce(nullif(p_credit_note->>'taxTotal','')::numeric,0),6);
  v_subtotal:=round(coalesce(nullif(p_credit_note->>'subtotal','')::numeric,v_total-v_tax),6);
  if v_total<=0 or round(v_subtotal+v_tax,6)<>v_total or v_total>v_receivable.balance then raise exception using errcode='23514',message='FINANCE_V2_CREDIT_NOTE_EXCEEDS_BALANCE'; end if;
  v_lines:=jsonb_build_array(jsonb_build_object('accountCode',p_credit_note->>'revenueAccountCode','debit',v_subtotal,'credit',0,'lineDescription','Nota de crédito '||coalesce(p_credit_note->>'documentNumber','')));
  if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode',p_credit_note->>'taxAccountCode','debit',v_tax,'credit',0,'lineDescription','Reverso IVA '||coalesce(p_credit_note->>'documentNumber',''))); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode',p_credit_note->>'receivableAccountCode','debit',0,'credit',v_total,'auxiliary',v_receivable.customer_tax_id_snapshot,'lineDescription','Disminución CxC '||v_receivable.document_number));
  v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
   jsonb_build_object('accountingDate',p_credit_note->>'issueDate','concept','Nota de crédito '||coalesce(p_credit_note->>'documentNumber',''),
    'originModule','Ventas','sourceDocument',p_credit_note->>'documentNumber','externalReference',coalesce(p_credit_note->>'accessKey',p_credit_note->>'authorizationNumber',''),
    'currencyCode',v_receivable.currency_code,'exchangeRate',v_receivable.exchange_rate,'lines',v_lines,'observation',coalesce(p_credit_note->>'reason','')),
   'CREDIT_NOTE',v_source_id,'POST_CREDIT_NOTE');
  insert into public.erp_financial_credit_notes(company_id,credit_note_id,receivable_id,source_id,document_number,issue_date,subtotal,tax_total,total,reason,journal_entry_id,created_at,created_by,last_operation_id)
   values(p_company_id,v_credit_id,v_receivable.receivable_id,v_source_id,btrim(p_credit_note->>'documentNumber'),(p_credit_note->>'issueDate')::date,v_subtotal,v_tax,v_total,btrim(coalesce(p_credit_note->>'reason','')),v_entry_id,v_now,auth.uid(),p_operation_id);
  update public.erp_financial_receivables set credited_total=round(credited_total+v_total,6),balance=round(balance-v_total,6),
   status=case when round(balance-v_total,6)=0 then 'PAID' else 'PARTIALLY_PAID' end,updated_at=v_now,updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
   where company_id=p_company_id and receivable_id=v_receivable.receivable_id returning * into v_receivable;
 end if;
 if v_receivable.receivable_id is null then select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and receivable_id=v_credit.receivable_id; end if;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id));
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_receivables',v_receivable.receivable_id::text,
  jsonb_build_object('id',v_receivable.receivable_id::text,'receivableId',v_receivable.receivable_id::text,'customerId',v_receivable.customer_id,
   'customerName',v_receivable.customer_name_snapshot,'customerTaxId',v_receivable.customer_tax_id_snapshot,'sourceType',v_receivable.source_type,
   'sourceId',v_receivable.source_id,'orderId',v_receivable.order_id,'shipmentId',v_receivable.shipment_id::text,'documentType',v_receivable.document_type,
   'documentNumber',v_receivable.document_number,'issueDate',v_receivable.issue_date,'dueDate',v_receivable.due_date,'currencyCode',v_receivable.currency_code,
   'subtotal',v_receivable.subtotal,'taxTotal',v_receivable.tax_total,'total',v_receivable.total,'creditedTotal',v_receivable.credited_total,
   'balance',v_receivable.balance,'status',v_receivable.status,'postingStatus','CONTABILIZADO','journalEntryId',v_receivable.journal_entry_id::text,
   'updatedAtServer',v_receivable.updated_at,'version',v_receivable.version,'syncFlow','FINANCIAL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_receivables' and record_id=v_receivable.receivable_id::text),0));
 v_records:=v_records||jsonb_build_array(v_saved);
 select * into v_credit from public.erp_financial_credit_notes where company_id=p_company_id and credit_note_id=v_credit_id;
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_credit_notes',v_credit_id::text,
  jsonb_build_object('id',v_credit_id::text,'creditNoteId',v_credit_id::text,'receivableId',v_credit.receivable_id::text,'sourceId',v_credit.source_id,
   'documentNumber',v_credit.document_number,'issueDate',v_credit.issue_date,'subtotal',v_credit.subtotal,'taxTotal',v_credit.tax_total,'total',v_credit.total,
   'reason',v_credit.reason,'journalEntryId',v_credit.journal_entry_id::text,'postingStatus','CONTABILIZADO','createdAt',v_credit.created_at,'syncFlow','FINANCIAL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_credit_notes' and record_id=v_credit_id::text),0));
 v_records:=v_records||jsonb_build_array(v_saved)||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_CREDIT_NOTE','CREDIT_NOTE',v_source_id,jsonb_build_object('creditNoteId',v_credit_id::text,'journalEntryId',v_entry_id::text)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('creditNoteId',v_credit_id::text,'journalEntryId',v_entry_id::text,'receivableId',v_receivable.receivable_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_POST_CREDIT_NOTE',v_source_id,p_credit_note,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

-- Cobro confirmado y asiento se crean juntos. El bloqueo de cada CxC evita sobrecobros.
create or replace function public.erp_financial_v2_register_collection(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_collection_id uuid:=gen_random_uuid(); v_existing_collection_id uuid; v_number text; v_date date;
 v_application jsonb; v_receivable public.erp_financial_receivables%rowtype; v_total numeric(20,6):=0; v_amount numeric(20,6);
 v_lines jsonb:='[]'; v_entry_id uuid; v_records jsonb:='[]'; v_saved jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
 if found then return v_existing.result; end if;
 if nullif(btrim(p_payload->>'clientReferenceId'),'') is not null then
  select collection_id into v_existing_collection_id from public.erp_financial_collections
   where company_id=p_company_id and client_reference_id=btrim(p_payload->>'clientReferenceId');
  if found then
   raise exception using errcode='23505',message='FINANCE_V2_COLLECTION_ALREADY_CONFIRMED:'||v_existing_collection_id::text;
  end if;
 end if;
 v_date:=coalesce(nullif(p_payload->>'collectionDate','')::date,current_date);
 if jsonb_typeof(coalesce(p_payload->'applications','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'applications','[]'))=0 then raise exception using errcode='22023',message='FINANCE_V2_COLLECTION_APPLICATIONS_REQUIRED'; end if;
 for v_application in select value from jsonb_array_elements(p_payload->'applications') order by value->>'receivableId' loop
   v_amount:=round(coalesce(nullif(v_application->>'amount','')::numeric,0),6);
   select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and receivable_id=(v_application->>'receivableId')::uuid for update;
   if not found or v_receivable.status in ('PAID','CANCELLED') or v_amount<=0 or v_amount>v_receivable.balance then raise exception using errcode='23514',message='FINANCE_V2_COLLECTION_EXCEEDS_BALANCE:'||coalesce(v_application->>'receivableId',''); end if;
   v_total:=v_total+v_amount;
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode',coalesce(v_application->>'receivableAccountCode',p_payload->>'receivableAccountCode'),'debit',0,'credit',v_amount,'auxiliary',v_receivable.customer_tax_id_snapshot,'lineDescription','Cobro '||v_receivable.document_number));
 end loop;
 v_lines:=jsonb_build_array(jsonb_build_object('accountCode',p_payload->>'debitAccountCode','debit',v_total,'credit',0,'lineDescription','Cobro recibido'))||v_lines;
 v_number:=public.erp_financial_v2_next_code(p_company_id,'COLLECTION',v_date);
 v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
  jsonb_build_object('accountingDate',v_date,'concept','Cobro '||v_number,'originModule','Cobros','sourceDocument',v_number,
   'externalReference',coalesce(p_payload->>'reference',''),'currencyCode',coalesce(p_payload->>'currencyCode','USD'),
   'exchangeRate',coalesce(p_payload->>'exchangeRate','1'),'lines',v_lines),'COLLECTION',v_collection_id::text,'POST_COLLECTION');
 insert into public.erp_financial_collections(company_id,collection_id,collection_number,client_reference_id,customer_id,collection_date,payment_method,
  reference,currency_code,exchange_rate,total,debit_account_code,status,journal_entry_id,created_at,created_by,last_operation_id)
 values(p_company_id,v_collection_id,v_number,nullif(btrim(p_payload->>'clientReferenceId'),''),btrim(p_payload->>'customerId'),v_date,btrim(p_payload->>'paymentMethod'),
  btrim(coalesce(p_payload->>'reference','')),upper(coalesce(p_payload->>'currencyCode','USD')),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
  v_total,btrim(p_payload->>'debitAccountCode'),'CONFIRMED',v_entry_id,v_now,auth.uid(),p_operation_id);
 for v_application in select value from jsonb_array_elements(p_payload->'applications') loop
   v_amount:=round((v_application->>'amount')::numeric,6);
   update public.erp_financial_receivables set balance=round(balance-v_amount,6),
    status=case when round(balance-v_amount,6)=0 then 'PAID' else 'PARTIALLY_PAID' end,
    updated_at=v_now,updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and receivable_id=(v_application->>'receivableId')::uuid returning * into v_receivable;
   insert into public.erp_financial_collection_applications(company_id,collection_application_id,collection_id,receivable_id,amount)
    values(p_company_id,gen_random_uuid(),v_collection_id,v_receivable.receivable_id,v_amount);
   v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_receivables',v_receivable.receivable_id::text,
    jsonb_build_object('id',v_receivable.receivable_id::text,'receivableId',v_receivable.receivable_id::text,'customerId',v_receivable.customer_id,
     'customerName',v_receivable.customer_name_snapshot,'customerTaxId',v_receivable.customer_tax_id_snapshot,'sourceType',v_receivable.source_type,
     'sourceId',v_receivable.source_id,'documentType',v_receivable.document_type,'documentNumber',v_receivable.document_number,
     'issueDate',v_receivable.issue_date,'dueDate',v_receivable.due_date,'currencyCode',v_receivable.currency_code,'total',v_receivable.total,
     'balance',v_receivable.balance,'status',v_receivable.status,'journalEntryId',v_receivable.journal_entry_id::text,'updatedAtServer',v_receivable.updated_at,
     'version',v_receivable.version,'syncFlow','FINANCIAL_V2'),coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_receivables' and record_id=v_receivable.receivable_id::text),0));
   v_records:=v_records||jsonb_build_array(v_saved);
 end loop;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id));
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_collections',v_collection_id::text,
  jsonb_build_object('id',v_collection_id::text,'collectionId',v_collection_id::text,'collectionNumber',v_number,'customerId',p_payload->>'customerId',
   'collectionDate',v_date,'paymentMethod',p_payload->>'paymentMethod','reference',coalesce(p_payload->>'reference',''),'currencyCode',coalesce(p_payload->>'currencyCode','USD'),
   'total',v_total,'collectionAccountCode',p_payload->>'debitAccountCode','status','CONFIRMADO','journalEntryId',v_entry_id::text,
   'applications',p_payload->'applications','createdAt',v_now,'syncFlow','FINANCIAL_V2'),0);
 v_records:=v_records||jsonb_build_array(v_saved)||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_COLLECTION','COLLECTION',v_collection_id::text,jsonb_build_object('total',v_total,'journalEntryId',v_entry_id::text)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('collectionId',v_collection_id::text,'journalEntryId',v_entry_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_REGISTER_COLLECTION',v_collection_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_financial_v2_reverse_collection(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_collection_id uuid,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_collection public.erp_financial_collections%rowtype; v_source public.erp_financial_journal_entries%rowtype;
 v_application public.erp_financial_collection_applications%rowtype; v_receivable public.erp_financial_receivables%rowtype;
 v_lines jsonb; v_reverse_id uuid; v_records jsonb:='[]'; v_saved jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
 select * into v_collection from public.erp_financial_collections where company_id=p_company_id and collection_id=p_collection_id for update;
 if not found then raise exception using errcode='P0002',message='FINANCE_V2_COLLECTION_NOT_FOUND'; end if;
 if v_collection.status='REVERSED' then raise exception using errcode='23514',message='FINANCE_V2_COLLECTION_ALREADY_REVERSED'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='FINANCE_V2_REVERSAL_REASON_REQUIRED'; end if;
 select * into v_source from public.erp_financial_journal_entries where company_id=p_company_id and journal_entry_id=v_collection.journal_entry_id for update;
 select jsonb_agg(jsonb_build_object('accountCode',account_code,'debit',credit,'credit',debit,'costCenter',cost_center,
  'auxiliary',auxiliary,'lineDescription','Reverso: '||description,'documentReference',document_reference) order by line_number) into v_lines
 from public.erp_financial_journal_lines where company_id=p_company_id and journal_entry_id=v_collection.journal_entry_id;
 v_reverse_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
  jsonb_build_object('accountingDate',current_date,'concept','Reverso '||v_collection.collection_number,'originModule','Cobros',
   'sourceDocument',v_collection.collection_number,'externalReference',v_collection.reference,'currencyCode',v_collection.currency_code,
   'exchangeRate',v_collection.exchange_rate,'lines',v_lines,'observation',p_reason),'COLLECTION',p_collection_id::text,'REVERSE_COLLECTION');
 update public.erp_financial_journal_entries set status='REVERSED',reversed_at=v_now,reversed_by=auth.uid(),version=version+1,
  last_operation_id=p_operation_id where company_id=p_company_id and journal_entry_id=v_collection.journal_entry_id;
 for v_application in select * from public.erp_financial_collection_applications where company_id=p_company_id and collection_id=p_collection_id order by receivable_id for update loop
  update public.erp_financial_receivables set balance=least(total,round(balance+v_application.amount,6)),status='OPEN',updated_at=v_now,
   updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and receivable_id=v_application.receivable_id returning * into v_receivable;
  if v_receivable.balance<v_receivable.total then update public.erp_financial_receivables set status='PARTIALLY_PAID' where company_id=p_company_id and receivable_id=v_receivable.receivable_id returning * into v_receivable; end if;
  v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_receivables',v_receivable.receivable_id::text,
   jsonb_build_object('id',v_receivable.receivable_id::text,'receivableId',v_receivable.receivable_id::text,'customerId',v_receivable.customer_id,
    'customerName',v_receivable.customer_name_snapshot,'documentNumber',v_receivable.document_number,'total',v_receivable.total,
    'balance',v_receivable.balance,'status',v_receivable.status,'journalEntryId',v_receivable.journal_entry_id::text,'version',v_receivable.version,
    'updatedAtServer',v_receivable.updated_at,'syncFlow','FINANCIAL_V2'),coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_receivables' and record_id=v_receivable.receivable_id::text),0));
  v_records:=v_records||jsonb_build_array(v_saved);
 end loop;
 update public.erp_financial_collections set status='REVERSED',reverse_journal_entry_id=v_reverse_id,reversal_reason=btrim(p_reason),
  reversed_at=v_now,reversed_by=auth.uid(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and collection_id=p_collection_id;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_collection.journal_entry_id))
  ||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse_id));
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_collections',p_collection_id::text,
  jsonb_build_object('id',p_collection_id::text,'collectionId',p_collection_id::text,'collectionNumber',v_collection.collection_number,
   'customerId',v_collection.customer_id,'collectionDate',v_collection.collection_date,'paymentMethod',v_collection.payment_method,
   'reference',v_collection.reference,'total',v_collection.total,'status','ANULADO','journalEntryId',v_collection.journal_entry_id::text,
   'reverseJournalEntryId',v_reverse_id::text,'reversalReason',btrim(p_reason),'reversedAt',v_now,'syncFlow','FINANCIAL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_collections' and record_id=p_collection_id::text),0));
 v_records:=v_records||jsonb_build_array(v_saved)||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'REVERSE_COLLECTION','COLLECTION',p_collection_id::text,jsonb_build_object('reverseJournalEntryId',v_reverse_id::text,'reason',p_reason)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('collectionId',p_collection_id::text,'reverseJournalEntryId',v_reverse_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_REVERSE_COLLECTION',p_collection_id::text,jsonb_build_object('reason',p_reason),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_financial_v2_record_cost(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_id uuid:=gen_random_uuid(); v_saved jsonb; v_result jsonb; v_amount numeric(20,6);
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
 v_amount:=round(coalesce(nullif(p_payload->>'amount','')::numeric,0),6);
 if nullif(btrim(p_payload->>'orderId'),'') is null or v_amount<0 then raise exception using errcode='22023',message='FINANCE_V2_COST_INVALID'; end if;
 insert into public.erp_financial_order_cost_components(company_id,cost_component_id,order_id,shipment_id,category,source_type,source_id,amount,
  currency_code,exchange_rate,description,accounting_status,created_at,created_by,last_operation_id)
 values(p_company_id,v_id,btrim(p_payload->>'orderId'),nullif(p_payload->>'shipmentId','')::uuid,upper(btrim(p_payload->>'category')),
  upper(btrim(p_payload->>'sourceType')),btrim(p_payload->>'sourceId'),v_amount,upper(coalesce(p_payload->>'currencyCode','USD')),
  coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),btrim(coalesce(p_payload->>'description','')),'UNPOSTED',clock_timestamp(),auth.uid(),p_operation_id)
 on conflict(company_id,source_type,source_id,category) do nothing;
 select cost_component_id into v_id from public.erp_financial_order_cost_components where company_id=p_company_id and source_type=upper(btrim(p_payload->>'sourceType')) and source_id=btrim(p_payload->>'sourceId') and category=upper(btrim(p_payload->>'category'));
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_order_costs',v_id::text,
  jsonb_build_object('id',v_id::text,'costComponentId',v_id::text,'orderId',p_payload->>'orderId','shipmentId',p_payload->>'shipmentId',
   'category',upper(p_payload->>'category'),'sourceType',upper(p_payload->>'sourceType'),'sourceId',p_payload->>'sourceId',
   'amount',v_amount,'currencyCode',coalesce(p_payload->>'currencyCode','USD'),'exchangeRate',coalesce(p_payload->>'exchangeRate','1'),
   'description',coalesce(p_payload->>'description',''),'accountingStatus','UNPOSTED','syncFlow','FINANCIAL_V2'),0);
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_saved),'result',jsonb_build_object('costComponentId',v_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_RECORD_ORDER_COST',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_financial_v2_record_shipment_expense(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_id uuid:=gen_random_uuid(); v_allocation jsonb; v_amount numeric(20,6); v_sum numeric(20,6):=0;
 v_saved jsonb; v_records jsonb:='[]'; v_result jsonb; v_allocation_id uuid;
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
 v_amount:=round(coalesce(nullif(p_payload->>'amount','')::numeric,0),6);
 if v_amount<=0 or not exists(select 1 from public.erp_export_shipment_registry where company_id=p_company_id and shipment_id=(p_payload->>'shipmentId')::uuid) then raise exception using errcode='23514',message='FINANCE_V2_EXPENSE_INVALID'; end if;
 for v_allocation in select value from jsonb_array_elements(coalesce(p_payload->'allocations','[]')) loop v_sum:=v_sum+round(coalesce(nullif(v_allocation->>'amount','')::numeric,0),6); end loop;
 if round(v_sum,6)<>v_amount then raise exception using errcode='23514',message='FINANCE_V2_ALLOCATION_TOTAL_MISMATCH'; end if;
 insert into public.erp_financial_shipment_expenses(company_id,expense_id,shipment_id,category,source_type,source_id,provider_id,amount,
  currency_code,exchange_rate,allocation_method,description,accounting_status,created_at,created_by,last_operation_id)
 values(p_company_id,v_id,(p_payload->>'shipmentId')::uuid,upper(p_payload->>'category'),upper(p_payload->>'sourceType'),p_payload->>'sourceId',
  nullif(p_payload->>'providerId',''),v_amount,upper(coalesce(p_payload->>'currencyCode','USD')),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
  upper(p_payload->>'allocationMethod'),coalesce(p_payload->>'description',''),'UNPOSTED',clock_timestamp(),auth.uid(),p_operation_id)
 on conflict(company_id,source_type,source_id,category) do nothing;
 select expense_id into v_id from public.erp_financial_shipment_expenses where company_id=p_company_id and source_type=upper(p_payload->>'sourceType') and source_id=p_payload->>'sourceId' and category=upper(p_payload->>'category');
 if not exists(select 1 from public.erp_financial_cost_allocations where company_id=p_company_id and expense_id=v_id) then
  for v_allocation in select value from jsonb_array_elements(coalesce(p_payload->'allocations','[]')) loop
   if not exists(select 1 from public.erp_export_shipment_order_links where company_id=p_company_id and shipment_id=(p_payload->>'shipmentId')::uuid and order_id=v_allocation->>'orderId') then raise exception using errcode='23514',message='FINANCE_V2_ALLOCATION_ORDER_NOT_IN_SHIPMENT'; end if;
   v_allocation_id:=gen_random_uuid();
   insert into public.erp_financial_cost_allocations(company_id,allocation_id,expense_id,order_id,allocation_method,basis_value,percentage,amount)
   values(p_company_id,v_allocation_id,v_id,v_allocation->>'orderId',upper(p_payload->>'allocationMethod'),coalesce(nullif(v_allocation->>'basisValue','')::numeric,0),
    coalesce(nullif(v_allocation->>'percentage','')::numeric,0),round((v_allocation->>'amount')::numeric,6));
   v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_cost_allocations',v_allocation_id::text,
    jsonb_build_object('id',v_allocation_id::text,'allocationId',v_allocation_id::text,'expenseId',v_id::text,'orderId',v_allocation->>'orderId',
     'allocationMethod',upper(p_payload->>'allocationMethod'),'basisValue',coalesce(v_allocation->>'basisValue','0'),'percentage',coalesce(v_allocation->>'percentage','0'),
     'amount',v_allocation->>'amount','syncFlow','FINANCIAL_V2'),0); v_records:=v_records||jsonb_build_array(v_saved);
  end loop;
 end if;
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_shipment_expenses',v_id::text,
  jsonb_build_object('id',v_id::text,'expenseId',v_id::text,'shipmentId',p_payload->>'shipmentId','category',upper(p_payload->>'category'),
   'sourceType',upper(p_payload->>'sourceType'),'sourceId',p_payload->>'sourceId','providerId',p_payload->>'providerId','amount',v_amount,
   'currencyCode',coalesce(p_payload->>'currencyCode','USD'),'exchangeRate',coalesce(p_payload->>'exchangeRate','1'),
   'allocationMethod',upper(p_payload->>'allocationMethod'),'description',coalesce(p_payload->>'description',''),'accountingStatus','UNPOSTED','syncFlow','FINANCIAL_V2'),0);
 v_records:=v_records||jsonb_build_array(v_saved);
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('expenseId',v_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_RECORD_SHIPMENT_EXPENSE',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace view public.erp_financial_v2_order_profitability with (security_invoker=true) as
with revenue as (
 select company_id,order_id,sum(total*exchange_rate) revenue
 from public.erp_financial_receivables where status<>'CANCELLED' and order_id is not null group by company_id,order_id
), direct_cost as (
 select company_id,order_id,sum(amount*exchange_rate) direct_cost,
  sum(amount*exchange_rate) filter(where category='FLOWER') flower_cost,
  sum(amount*exchange_rate) filter(where category='PACKAGING') packaging_cost,
  sum(amount*exchange_rate) filter(where category='LABOR') labor_cost,
  sum(amount*exchange_rate) filter(where category in ('TRANSPORT','CARGO_AGENCY','AIR_FREIGHT','DOCUMENTATION','HANDLING','OTHER')) direct_logistics_cost
 from public.erp_financial_order_cost_components where accounting_status<>'REVERSED' group by company_id,order_id
), allocated as (
 select allocation.company_id,allocation.order_id,sum(allocation.amount*expense.exchange_rate) allocated_cost
 from public.erp_financial_cost_allocations allocation join public.erp_financial_shipment_expenses expense
 on expense.company_id=allocation.company_id and expense.expense_id=allocation.expense_id
 where expense.accounting_status<>'REVERSED' group by allocation.company_id,allocation.order_id
)
select coalesce(revenue.company_id,direct_cost.company_id,allocated.company_id) company_id,
 coalesce(revenue.order_id,direct_cost.order_id,allocated.order_id) order_id,
 coalesce(revenue.revenue,0)::numeric(20,6) revenue,
 coalesce(direct_cost.flower_cost,0)::numeric(20,6) flower_cost,
 coalesce(direct_cost.packaging_cost,0)::numeric(20,6) packaging_cost,
 coalesce(direct_cost.labor_cost,0)::numeric(20,6) labor_cost,
 coalesce(direct_cost.direct_logistics_cost,0)::numeric(20,6) direct_logistics_cost,
 coalesce(direct_cost.direct_cost,0)::numeric(20,6) direct_cost,
 coalesce(allocated.allocated_cost,0)::numeric(20,6) allocated_cost,
 (coalesce(revenue.revenue,0)-coalesce(direct_cost.direct_cost,0)-coalesce(allocated.allocated_cost,0))::numeric(20,6) margin
from revenue full join direct_cost using(company_id,order_id) full join allocated using(company_id,order_id);

create or replace view public.erp_financial_v2_shipment_profitability with (security_invoker=true) as
select link.company_id,link.shipment_id,sum(coalesce(profit.revenue,0))::numeric(20,6) revenue,
 sum(coalesce(profit.flower_cost,0))::numeric(20,6) flower_cost,
 sum(coalesce(profit.packaging_cost,0))::numeric(20,6) packaging_cost,
 sum(coalesce(profit.labor_cost,0))::numeric(20,6) labor_cost,
 sum(coalesce(profit.direct_logistics_cost,0))::numeric(20,6) direct_logistics_cost,
 sum(coalesce(profit.direct_cost,0))::numeric(20,6) direct_cost,
 sum(coalesce(profit.allocated_cost,0))::numeric(20,6) allocated_cost,
 sum(coalesce(profit.margin,0))::numeric(20,6) margin
from public.erp_export_shipment_order_links link left join public.erp_financial_v2_order_profitability profit
 on profit.company_id=link.company_id and profit.order_id=link.order_id group by link.company_id,link.shipment_id;

create or replace function public.erp_financial_v2_health(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.erp_financial_v2_assert_access(p_company_id);
 return jsonb_build_object(
  'ok',true,'component','FINANCIAL_V2','migration','202608150009','companyId',p_company_id::text,'serverTime',clock_timestamp(),
  'sequenceTable',to_regclass('public.erp_financial_sequence_counters') is not null,
  'journalTable',to_regclass('public.erp_financial_journal_entries') is not null,
  'journalLinesTable',to_regclass('public.erp_financial_journal_lines') is not null,
  'receivablesTable',to_regclass('public.erp_financial_receivables') is not null,
  'creditNotesTable',to_regclass('public.erp_financial_credit_notes') is not null,
  'collectionsTable',to_regclass('public.erp_financial_collections') is not null,
  'applicationsTable',to_regclass('public.erp_financial_collection_applications') is not null,
  'costsTable',to_regclass('public.erp_financial_order_cost_components') is not null,
  'expensesTable',to_regclass('public.erp_financial_shipment_expenses') is not null,
  'allocationsTable',to_regclass('public.erp_financial_cost_allocations') is not null,
  'eventsTable',to_regclass('public.erp_financial_events') is not null,
  'orderProfitabilityView',to_regclass('public.erp_financial_v2_order_profitability') is not null,
  'shipmentProfitabilityView',to_regclass('public.erp_financial_v2_shipment_profitability') is not null,
  'operationsDependency',to_regprocedure('public.erp_operations_v2_write_record(uuid,uuid,text,text,text,jsonb,bigint)') is not null,
  'exportDependency',to_regclass('public.erp_export_shipment_registry') is not null,
  'postJournalRpc',to_regprocedure('public.erp_financial_v2_post_journal(uuid,uuid,text,jsonb,text,text,text,timestamptz)') is not null,
  'postInvoiceRpc',to_regprocedure('public.erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz)') is not null,
  'postCreditNoteRpc',to_regprocedure('public.erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz)') is not null,
  'reverseJournalRpc',to_regprocedure('public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamptz)') is not null,
  'registerCollectionRpc',to_regprocedure('public.erp_financial_v2_register_collection(uuid,uuid,text,jsonb,timestamptz)') is not null,
  'reverseCollectionRpc',to_regprocedure('public.erp_financial_v2_reverse_collection(uuid,uuid,text,uuid,text,timestamptz)') is not null,
  'recordCostRpc',to_regprocedure('public.erp_financial_v2_record_cost(uuid,uuid,text,jsonb,timestamptz)') is not null,
  'recordShipmentExpenseRpc',to_regprocedure('public.erp_financial_v2_record_shipment_expense(uuid,uuid,text,jsonb,timestamptz)') is not null
 );
end $$;

revoke all on function public.erp_financial_v2_assert_access(uuid) from public,anon,authenticated;
revoke all on function public.erp_financial_v2_next_code(uuid,text,date) from public,anon,authenticated;
revoke all on function public.erp_financial_v2_validate_account(uuid,text) from public,anon,authenticated;
revoke all on function public.erp_financial_v2_write_event(uuid,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.erp_financial_v2_publish_entry(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.erp_financial_v2_health(uuid) from public,anon,authenticated;
grant execute on function public.erp_financial_v2_health(uuid) to authenticated;

revoke all on function public.erp_financial_v2_post_journal(uuid,uuid,text,jsonb,text,text,text,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_post_journal(uuid,uuid,text,jsonb,text,text,text,timestamptz) to authenticated;
revoke all on function public.erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
revoke all on function public.erp_financial_v2_register_collection(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_register_collection(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_financial_v2_reverse_collection(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_reverse_collection(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
revoke all on function public.erp_financial_v2_record_cost(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_record_cost(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_financial_v2_record_shipment_expense(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_financial_v2_record_shipment_expense(uuid,uuid,text,jsonb,timestamptz) to authenticated;

grant select on public.erp_financial_v2_order_profitability,public.erp_financial_v2_shipment_profitability to authenticated;

do $$ declare v_table text; begin
 foreach v_table in array array['erp_financial_journal_entries','erp_financial_receivables','erp_financial_credit_notes','erp_financial_collections','erp_financial_order_cost_components','erp_financial_shipment_expenses','erp_financial_cost_allocations','erp_financial_events'] loop
  begin execute format('alter publication supabase_realtime add table public.%I',v_table); exception when duplicate_object then null; end;
 end loop;
end $$;

notify pgrst,'reload schema';

commit;
