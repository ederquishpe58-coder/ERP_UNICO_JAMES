begin;

-- Fase 8: proveedor -> recepción/compra -> obligación -> pago -> contabilidad.
-- No migra ni elimina historia legacy. Las mutaciones se exponen únicamente por RPC.

create table if not exists public.erp_supplier_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  sequence_type text not null check (sequence_type in ('PROVIDER','PURCHASE','SETTLEMENT','PAYMENT')),
  calendar_year integer not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, sequence_type, calendar_year)
);

create table if not exists public.erp_supplier_providers (
  company_id uuid not null references public.companies(id) on delete cascade,
  provider_id uuid not null,
  provider_code text not null,
  tax_id text not null,
  legal_name text not null,
  commercial_name text not null default '',
  provider_type text not null default 'OTHER' check (provider_type in ('EXTERNAL','PRODUCER','PARTNER','SERVICE','TRANSPORT','SUPPLIES','OTHER')),
  settlement_method text not null default 'PURCHASE_DOCUMENT' check (settlement_method in ('PURCHASE_DOCUMENT','RECEIPT_SETTLEMENT','PER_STEM','PER_BUNCH','PERCENTAGE','PARTICIPATION','MANUAL')),
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  payment_terms text not null default '',
  credit_days integer not null default 0 check (credit_days >= 0),
  currency_code text not null default 'USD',
  payable_account_code text not null default '',
  advance_account_code text not null default '',
  operational_supplier_id text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  profile_state text not null default 'COMPLETE' check (profile_state in ('PENDING','COMPLETE')),
  source text not null default 'MANUAL',
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1,
  last_operation_id uuid not null,
  primary key (company_id, provider_id),
  unique (company_id, provider_code),
  unique (company_id, tax_id)
);

create table if not exists public.erp_supplier_purchase_documents (
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_document_id uuid not null,
  document_code text not null,
  provider_id uuid not null,
  document_type text not null check (document_type in ('INVOICE','PURCHASE_SETTLEMENT','CREDIT_NOTE','SALES_NOTE','OTHER','OPENING_BALANCE')),
  external_document_number text not null,
  source_key text not null,
  issue_date date not null,
  accounting_date date not null,
  due_date date not null,
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  subtotal numeric(20,6) not null default 0,
  tax_total numeric(20,6) not null default 0,
  discount_total numeric(20,6) not null default 0,
  withholding_total numeric(20,6) not null default 0,
  total numeric(20,6) not null check (total >= 0),
  settlement_mode text not null default 'CXP' check (settlement_mode in ('CXP','CASH')),
  source text not null default 'MANUAL',
  source_payload jsonb not null default '{}'::jsonb,
  status text not null default 'POSTED' check (status in ('DRAFT','REVIEWED','POSTED','CANCELLED')),
  journal_entry_id uuid,
  payable_id uuid,
  legacy_draft_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancellation_reason text not null default '',
  version bigint not null default 1,
  last_operation_id uuid not null,
  primary key (company_id, purchase_document_id),
  unique (company_id, document_code),
  unique (company_id, source_key),
  foreign key (company_id, provider_id) references public.erp_supplier_providers(company_id, provider_id) on delete restrict
);

create table if not exists public.erp_supplier_purchase_lines (
  company_id uuid not null,
  purchase_line_id uuid not null,
  purchase_document_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_code text not null default '',
  description text not null,
  quantity numeric(20,6) not null default 0,
  unit text not null default '',
  unit_price numeric(20,6) not null default 0,
  taxable_base numeric(20,6) not null default 0,
  tax_rate numeric(10,6) not null default 0,
  tax_value numeric(20,6) not null default 0,
  discount numeric(20,6) not null default 0,
  line_total numeric(20,6) not null default 0,
  account_code text not null,
  cost_center text not null default '',
  line_type text not null default 'EXPENSE',
  reception_id text,
  reception_item_id text,
  primary key (company_id, purchase_line_id),
  unique (company_id, purchase_document_id, line_number),
  foreign key (company_id, purchase_document_id) references public.erp_supplier_purchase_documents(company_id, purchase_document_id) on delete restrict
);

create table if not exists public.erp_supplier_accounts_payable (
  company_id uuid not null references public.companies(id) on delete cascade,
  payable_id uuid not null,
  provider_id uuid not null,
  source_type text not null check (source_type in ('PURCHASE_DOCUMENT','SUPPLIER_SETTLEMENT','OPENING_BALANCE')),
  source_id uuid not null,
  document_number text not null,
  issue_date date not null,
  due_date date not null,
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  total numeric(20,6) not null check (total >= 0),
  balance numeric(20,6) not null check (balance >= 0),
  payable_account_code text not null,
  status text not null default 'OPEN' check (status in ('OPEN','PARTIALLY_PAID','PAID','CANCELLED')),
  journal_entry_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  last_operation_id uuid not null,
  primary key (company_id, payable_id),
  unique (company_id, source_type, source_id),
  foreign key (company_id, provider_id) references public.erp_supplier_providers(company_id, provider_id) on delete restrict
);

create table if not exists public.erp_supplier_settlements (
  company_id uuid not null references public.companies(id) on delete cascade,
  settlement_id uuid not null,
  settlement_code text not null,
  provider_id uuid not null,
  period_start date not null,
  period_end date not null,
  settlement_method text not null check (settlement_method in ('PER_STEM','PER_BUNCH','PER_VARIETY','PER_LENGTH','PERCENTAGE','PARTICIPATION','MANUAL')),
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  gross_total numeric(20,6) not null default 0,
  discount_total numeric(20,6) not null default 0,
  adjustment_total numeric(20,6) not null default 0,
  total numeric(20,6) not null check (total >= 0),
  status text not null default 'POSTED' check (status in ('DRAFT','POSTED','REVERSED')),
  rule_snapshot jsonb not null default '{}'::jsonb,
  journal_entry_id uuid,
  payable_id uuid,
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  posted_at timestamptz,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text not null default '',
  version bigint not null default 1,
  last_operation_id uuid not null,
  primary key (company_id, settlement_id),
  unique (company_id, settlement_code),
  foreign key (company_id, provider_id) references public.erp_supplier_providers(company_id, provider_id) on delete restrict
);

create table if not exists public.erp_supplier_settlement_lines (
  company_id uuid not null,
  settlement_line_id uuid not null,
  settlement_id uuid not null,
  reception_id text not null,
  reception_item_id text,
  variety text not null default '',
  length text not null default '',
  quantity_type text not null check (quantity_type in ('STEM','BUNCH','RECEPTION','PERCENTAGE')),
  quantity numeric(20,6) not null check (quantity > 0),
  unit_price numeric(20,6) not null default 0,
  gross_amount numeric(20,6) not null default 0,
  discount numeric(20,6) not null default 0,
  adjustment numeric(20,6) not null default 0,
  total numeric(20,6) not null check (total >= 0),
  rule_snapshot jsonb not null default '{}'::jsonb,
  primary key (company_id, settlement_line_id),
  foreign key (company_id, settlement_id) references public.erp_supplier_settlements(company_id, settlement_id) on delete restrict
);

create table if not exists public.erp_supplier_reception_cost_allocations (
  company_id uuid not null references public.companies(id) on delete cascade,
  allocation_id uuid not null,
  provider_id uuid not null,
  source_type text not null check (source_type in ('PURCHASE_DOCUMENT','SUPPLIER_SETTLEMENT','ADJUSTMENT')),
  source_id uuid not null,
  reception_id text not null,
  reception_item_id text,
  quantity_type text not null check (quantity_type in ('STEM','BUNCH','RECEPTION','PERCENTAGE')),
  quantity numeric(20,6) not null check (quantity > 0),
  unit_price numeric(20,6) not null default 0,
  amount numeric(20,6) not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVERSED')),
  rule_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_operation_id uuid not null,
  primary key (company_id, allocation_id),
  unique (company_id, source_type, source_id, reception_id, reception_item_id),
  foreign key (company_id, provider_id) references public.erp_supplier_providers(company_id, provider_id) on delete restrict
);

create table if not exists public.erp_supplier_payments (
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_id uuid not null,
  payment_code text not null,
  provider_id uuid not null,
  client_reference_id text,
  payment_date date not null,
  payment_method text not null,
  reference text not null default '',
  currency_code text not null default 'USD',
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  payment_account_code text not null,
  total numeric(20,6) not null check (total > 0),
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','REVERSED')),
  journal_entry_id uuid not null,
  reverse_journal_entry_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text not null default '',
  version bigint not null default 1,
  last_operation_id uuid not null,
  primary key (company_id, payment_id),
  unique (company_id, payment_code),
  unique (company_id, client_reference_id),
  foreign key (company_id, provider_id) references public.erp_supplier_providers(company_id, provider_id) on delete restrict
);

create table if not exists public.erp_supplier_payment_applications (
  company_id uuid not null,
  payment_application_id uuid not null,
  payment_id uuid not null,
  payable_id uuid not null,
  amount numeric(20,6) not null check (amount > 0),
  balance_before numeric(20,6) not null,
  balance_after numeric(20,6) not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  primary key (company_id, payment_application_id),
  unique (company_id, payment_id, payable_id),
  foreign key (company_id, payment_id) references public.erp_supplier_payments(company_id, payment_id) on delete restrict,
  foreign key (company_id, payable_id) references public.erp_supplier_accounts_payable(company_id, payable_id) on delete restrict
);

create table if not exists public.erp_supplier_adjustments (
  company_id uuid not null references public.companies(id) on delete cascade,
  adjustment_id uuid not null,
  provider_id uuid not null,
  payable_id uuid not null,
  adjustment_type text not null check (adjustment_type in ('CREDIT_NOTE','DEBIT_NOTE','PRICE_ADJUSTMENT','MANUAL')),
  source_reference text not null,
  adjustment_date date not null,
  amount numeric(20,6) not null check (amount > 0),
  reason text not null,
  status text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  journal_entry_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  last_operation_id uuid not null,
  primary key (company_id, adjustment_id),
  unique (company_id, provider_id, source_reference),
  foreign key (company_id, provider_id) references public.erp_supplier_providers(company_id, provider_id) on delete restrict,
  foreign key (company_id, payable_id) references public.erp_supplier_accounts_payable(company_id, payable_id) on delete restrict
);

create index if not exists erp_supplier_document_provider_idx on public.erp_supplier_purchase_documents(company_id,provider_id,issue_date desc);
create index if not exists erp_supplier_payable_provider_idx on public.erp_supplier_accounts_payable(company_id,provider_id,status,due_date);
create index if not exists erp_supplier_settlement_provider_idx on public.erp_supplier_settlements(company_id,provider_id,period_end desc);
create index if not exists erp_supplier_reception_cost_idx on public.erp_supplier_reception_cost_allocations(company_id,reception_id,reception_item_id,status);
create unique index if not exists erp_supplier_reception_cost_source_unique
  on public.erp_supplier_reception_cost_allocations(company_id,source_type,source_id,reception_id,coalesce(reception_item_id,''));
create index if not exists erp_supplier_payment_provider_idx on public.erp_supplier_payments(company_id,provider_id,payment_date desc);

do $$ declare v_table text; begin
  foreach v_table in array array[
    'erp_supplier_sequence_counters','erp_supplier_providers','erp_supplier_purchase_documents','erp_supplier_purchase_lines',
    'erp_supplier_accounts_payable','erp_supplier_settlements','erp_supplier_settlement_lines','erp_supplier_reception_cost_allocations',
    'erp_supplier_payments','erp_supplier_payment_applications','erp_supplier_adjustments'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('drop policy if exists %I on public.%I',v_table||'_member_select',v_table);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_company_memberships m where m.company_id=%I.company_id and m.user_id=auth.uid() and m.membership_status=''ACTIVE''))',v_table||'_member_select',v_table,v_table);
  end loop;
end $$;

create or replace function public.erp_supplier_v2_next_code(p_company_id uuid,p_type text,p_date date)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_type text:=upper(btrim(p_type)); v_year integer:=extract(year from p_date)::integer; v_value bigint; v_prefix text;
begin
  if v_type not in ('PROVIDER','PURCHASE','SETTLEMENT','PAYMENT') then raise exception using errcode='22023',message='SUPPLIER_V2_SEQUENCE_TYPE_INVALID'; end if;
  insert into public.erp_supplier_sequence_counters(company_id,sequence_type,calendar_year,last_value,updated_at)
  values(p_company_id,v_type,v_year,1,clock_timestamp())
  on conflict(company_id,sequence_type,calendar_year) do update set last_value=erp_supplier_sequence_counters.last_value+1,updated_at=clock_timestamp()
  returning last_value into v_value;
  v_prefix:=case v_type when 'PROVIDER' then 'PRV' when 'PURCHASE' then 'COMP' when 'SETTLEMENT' then 'LIQ' else 'PAG' end;
  return v_prefix||'-'||v_year||'-'||lpad(v_value::text,6,'0');
end $$;

create or replace function public.erp_supplier_v2_publish_provider(p_company_id uuid,p_operation_id uuid,p_device_id text,p_provider_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.erp_supplier_providers%rowtype;
begin
  select * into strict v from public.erp_supplier_providers where company_id=p_company_id and provider_id=p_provider_id;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_providers',p_provider_id::text,
    jsonb_build_object('id',v.provider_id::text,'providerId',v.provider_id::text,'code',v.provider_code,'taxId',v.tax_id,'ruc',v.tax_id,
      'name',v.legal_name,'legalName',v.legal_name,'commercialName',v.commercial_name,'providerType',v.provider_type,
      'settlementMethod',v.settlement_method,'contact',v.contact_name,'phone',v.phone,'email',v.email,'address',v.address,
      'paymentCondition',v.payment_terms,'creditDays',v.credit_days,'currencyCode',v.currency_code,'payableAccountCode',v.payable_account_code,
      'advanceAccountCode',v.advance_account_code,'operationalSupplierId',v.operational_supplier_id,'status',lower(v.status),
      'profileState',v.profile_state,'createdSource',v.source,'observation',v.notes,'updatedAt',v.updated_at,'version',v.version,'syncFlow','SUPPLIER_FINANCE_V2'),
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='supplier_providers' and record_id=p_provider_id::text),0));
end $$;

create or replace function public.erp_supplier_v2_publish_payable(p_company_id uuid,p_operation_id uuid,p_device_id text,p_payable_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.erp_supplier_accounts_payable%rowtype; p public.erp_supplier_providers%rowtype;
begin
  select * into strict v from public.erp_supplier_accounts_payable where company_id=p_company_id and payable_id=p_payable_id;
  select * into strict p from public.erp_supplier_providers where company_id=p_company_id and provider_id=v.provider_id;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_payables',p_payable_id::text,
    jsonb_build_object('id',v.payable_id::text,'payableId',v.payable_id::text,'providerId',v.provider_id::text,'providerName',p.legal_name,
      'providerRuc',p.tax_id,'sourceType',v.source_type,'sourceId',v.source_id::text,'documentNumber',v.document_number,
      'issueDate',v.issue_date,'dueDate',v.due_date,'currencyCode',v.currency_code,'exchangeRate',v.exchange_rate,'total',v.total,
      'balance',v.balance,'payableAccountCode',v.payable_account_code,'status',v.status,'journalEntryId',v.journal_entry_id::text,
      'updatedAt',v.updated_at,'version',v.version,'syncFlow','SUPPLIER_FINANCE_V2'),
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='supplier_payables' and record_id=p_payable_id::text),0));
end $$;

create or replace function public.erp_supplier_v2_publish_purchase(p_company_id uuid,p_operation_id uuid,p_device_id text,p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.erp_supplier_purchase_documents%rowtype; p public.erp_supplier_providers%rowtype; v_lines jsonb;
begin
  select * into strict v from public.erp_supplier_purchase_documents where company_id=p_company_id and purchase_document_id=p_purchase_id;
  select * into strict p from public.erp_supplier_providers where company_id=p_company_id and provider_id=v.provider_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',purchase_line_id::text,'productCode',product_code,'description',description,'quantity',quantity,
    'unit',unit,'unitPrice',unit_price,'taxableBase',taxable_base,'vatRate',tax_rate,'vatValue',tax_value,'discount',discount,
    'totalLine',line_total,'accountCode',account_code,'costCenter',cost_center,'lineType',line_type,'receptionId',reception_id,
    'receptionItemId',reception_item_id) order by line_number),'[]') into v_lines
  from public.erp_supplier_purchase_lines where company_id=p_company_id and purchase_document_id=p_purchase_id;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_purchase_documents',p_purchase_id::text,
    jsonb_build_object('id',v.purchase_document_id::text,'purchaseDocumentId',v.purchase_document_id::text,'documentCode',v.document_code,
      'supplierId',v.provider_id::text,'supplierName',p.legal_name,'supplierRuc',p.tax_id,'voucherType',lower(v.document_type),
      'documentNumber',v.external_document_number,'sourceKey',v.source_key,'issueDate',v.issue_date,'accountingDate',v.accounting_date,
      'dueDate',v.due_date,'currencyCode',v.currency_code,'exchangeRate',v.exchange_rate,'totals',jsonb_build_object('subtotal',v.subtotal,
      'iva',v.tax_total,'discount',v.discount_total,'withholdingsTotal',v.withholding_total,'total',v.total,'balanceDue',greatest(v.total-v.withholding_total,0)),
      'settlementMode',v.settlement_mode,'source',v.source,'status',v.status,'journalEntryId',v.journal_entry_id::text,
      'payableId',v.payable_id::text,'legacyDraftId',v.legacy_draft_id,'lines',v_lines,'version',v.version,'syncFlow','SUPPLIER_FINANCE_V2'),
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='supplier_purchase_documents' and record_id=p_purchase_id::text),0));
end $$;

create or replace function public.erp_supplier_v2_publish_reception_cost(p_company_id uuid,p_operation_id uuid,p_device_id text,p_allocation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.erp_supplier_reception_cost_allocations%rowtype;
begin
  select * into strict v from public.erp_supplier_reception_cost_allocations where company_id=p_company_id and allocation_id=p_allocation_id;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_reception_costs',p_allocation_id::text,
    jsonb_build_object('id',v.allocation_id::text,'allocationId',v.allocation_id::text,'providerId',v.provider_id::text,'sourceType',v.source_type,
      'sourceId',v.source_id::text,'receptionId',v.reception_id,'receptionItemId',v.reception_item_id,'quantityType',v.quantity_type,
      'quantity',v.quantity,'unitPrice',v.unit_price,'amount',v.amount,'status',v.status,'ruleSnapshot',v.rule_snapshot,
      'createdAt',v.created_at,'syncFlow','SUPPLIER_FINANCE_V2'),
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='supplier_reception_costs' and record_id=p_allocation_id::text),0));
end $$;

create or replace function public.erp_supplier_v2_publish_settlement(p_company_id uuid,p_operation_id uuid,p_device_id text,p_settlement_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.erp_supplier_settlements%rowtype; p public.erp_supplier_providers%rowtype; v_lines jsonb;
begin
  select * into strict v from public.erp_supplier_settlements where company_id=p_company_id and settlement_id=p_settlement_id;
  select * into strict p from public.erp_supplier_providers where company_id=p_company_id and provider_id=v.provider_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',settlement_line_id::text,'settlementLineId',settlement_line_id::text,
    'receptionId',reception_id,'receptionItemId',reception_item_id,'variety',variety,'length',length,'quantityType',quantity_type,
    'quantity',quantity,'unitPrice',unit_price,'grossAmount',gross_amount,'discount',discount,'adjustment',adjustment,'total',total,
    'ruleSnapshot',rule_snapshot) order by settlement_line_id),'[]') into v_lines
  from public.erp_supplier_settlement_lines where company_id=p_company_id and settlement_id=p_settlement_id;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_settlements',p_settlement_id::text,
    jsonb_build_object('id',v.settlement_id::text,'settlementId',v.settlement_id::text,'settlementCode',v.settlement_code,
      'providerId',v.provider_id::text,'providerName',p.legal_name,'providerRuc',p.tax_id,'periodStart',v.period_start,'periodEnd',v.period_end,
      'settlementMethod',v.settlement_method,'currencyCode',v.currency_code,'exchangeRate',v.exchange_rate,'grossTotal',v.gross_total,
      'discountTotal',v.discount_total,'adjustmentTotal',v.adjustment_total,'total',v.total,'status',v.status,
      'journalEntryId',v.journal_entry_id::text,'payableId',v.payable_id::text,'ruleSnapshot',v.rule_snapshot,'lines',v_lines,
      'reversalReason',v.reversal_reason,'version',v.version,'syncFlow','SUPPLIER_FINANCE_V2'),
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='supplier_settlements' and record_id=p_settlement_id::text),0));
end $$;

create or replace function public.erp_supplier_v2_upsert_provider(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_id uuid; v_existing_provider_id uuid; v_tax text; v_code text; v_saved jsonb; v_records jsonb:='[]'; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
  v_tax:=regexp_replace(upper(btrim(coalesce(p_payload->>'taxId',p_payload->>'ruc',''))),'[^0-9A-Z]','','g');
  if v_tax='' or btrim(coalesce(p_payload->>'legalName',p_payload->>'name',''))='' then raise exception using errcode='22023',message='SUPPLIER_V2_PROVIDER_IDENTITY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PROVIDER:'||v_tax,0));
  select provider_id into v_existing_provider_id from public.erp_supplier_providers where company_id=p_company_id and (provider_id=nullif(p_payload->>'providerId','')::uuid or tax_id=v_tax) for update;
  if v_existing_provider_id is null then
    v_id:=coalesce(nullif(p_payload->>'providerId','')::uuid,gen_random_uuid()); v_code:=public.erp_supplier_v2_next_code(p_company_id,'PROVIDER',current_date);
    insert into public.erp_supplier_providers(company_id,provider_id,provider_code,tax_id,legal_name,commercial_name,provider_type,settlement_method,
      contact_name,phone,email,address,payment_terms,credit_days,currency_code,payable_account_code,advance_account_code,operational_supplier_id,
      status,profile_state,source,notes,created_at,created_by,updated_at,updated_by,last_operation_id)
    values(p_company_id,v_id,v_code,v_tax,btrim(coalesce(p_payload->>'legalName',p_payload->>'name')),btrim(coalesce(p_payload->>'commercialName','')),
      upper(coalesce(nullif(p_payload->>'providerType',''),'OTHER')),upper(coalesce(nullif(p_payload->>'settlementMethod',''),'PURCHASE_DOCUMENT')),
      btrim(coalesce(p_payload->>'contact','')),btrim(coalesce(p_payload->>'phone','')),btrim(coalesce(p_payload->>'email','')),btrim(coalesce(p_payload->>'address','')),
      btrim(coalesce(p_payload->>'paymentCondition','')),coalesce(nullif(p_payload->>'creditDays','')::integer,0),upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),
      btrim(coalesce(p_payload->>'payableAccountCode','')),btrim(coalesce(p_payload->>'advanceAccountCode','')),nullif(p_payload->>'operationalSupplierId',''),
      case when lower(coalesce(p_payload->>'status','activo')) in ('activo','active') then 'ACTIVE' else 'INACTIVE' end,
      upper(coalesce(nullif(p_payload->>'profileState',''),'COMPLETE')),upper(coalesce(nullif(p_payload->>'source',''),'MANUAL')),btrim(coalesce(p_payload->>'observation','')),
      clock_timestamp(),auth.uid(),clock_timestamp(),auth.uid(),p_operation_id);
  else
    v_id:=v_existing_provider_id;
    update public.erp_supplier_providers set legal_name=btrim(coalesce(nullif(p_payload->>'legalName',''),nullif(p_payload->>'name',''),legal_name)),
      commercial_name=btrim(coalesce(p_payload->>'commercialName',commercial_name)),provider_type=upper(coalesce(nullif(p_payload->>'providerType',''),provider_type)),
      settlement_method=upper(coalesce(nullif(p_payload->>'settlementMethod',''),settlement_method)),contact_name=btrim(coalesce(p_payload->>'contact',contact_name)),
      phone=btrim(coalesce(p_payload->>'phone',phone)),email=btrim(coalesce(p_payload->>'email',email)),address=btrim(coalesce(p_payload->>'address',address)),
      payment_terms=btrim(coalesce(p_payload->>'paymentCondition',payment_terms)),credit_days=coalesce(nullif(p_payload->>'creditDays','')::integer,credit_days),
      currency_code=upper(coalesce(nullif(p_payload->>'currencyCode',''),currency_code)),payable_account_code=btrim(coalesce(p_payload->>'payableAccountCode',payable_account_code)),
      advance_account_code=btrim(coalesce(p_payload->>'advanceAccountCode',advance_account_code)),operational_supplier_id=coalesce(nullif(p_payload->>'operationalSupplierId',''),operational_supplier_id),
      status=case when lower(coalesce(p_payload->>'status',lower(status))) in ('activo','active') then 'ACTIVE' else 'INACTIVE' end,
      profile_state=upper(coalesce(nullif(p_payload->>'profileState',''),profile_state)),notes=btrim(coalesce(p_payload->>'observation',notes)),
      updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and provider_id=v_id;
  end if;
  v_saved:=public.erp_supplier_v2_publish_provider(p_company_id,p_operation_id,p_device_id,v_id); v_records:=v_records||jsonb_build_array(v_saved);
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('providerId',v_id::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_UPSERT_PROVIDER',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_supplier_v2_reverse_purchase(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_purchase_document_id uuid,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_purchase public.erp_supplier_purchase_documents%rowtype;
 v_original public.erp_financial_journal_entries%rowtype; v_payable public.erp_supplier_accounts_payable%rowtype;
 v_cost public.erp_supplier_reception_cost_allocations%rowtype; v_reverse uuid; v_payload jsonb; v_lines jsonb;
 v_records jsonb:='[]'; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
  if found then return v_existing.result; end if;
  if btrim(coalesce(p_reason,''))='' then raise exception using errcode='22023',message='SUPPLIER_V2_REVERSAL_REASON_REQUIRED'; end if;

  select * into v_purchase from public.erp_supplier_purchase_documents
  where company_id=p_company_id and purchase_document_id=p_purchase_document_id for update;
  if not found then raise exception using errcode='23503',message='SUPPLIER_V2_PURCHASE_NOT_FOUND'; end if;
  if v_purchase.status='CANCELLED' then raise exception using errcode='23514',message='SUPPLIER_V2_PURCHASE_ALREADY_CANCELLED'; end if;
  if v_purchase.payable_id is not null then
    select * into strict v_payable from public.erp_supplier_accounts_payable
    where company_id=p_company_id and payable_id=v_purchase.payable_id for update;
    if v_payable.balance<>v_payable.total then
      raise exception using errcode='23514',message='SUPPLIER_V2_PURCHASE_HAS_PAYMENTS';
    end if;
  end if;

  select * into strict v_original from public.erp_financial_journal_entries
  where company_id=p_company_id and journal_entry_id=v_purchase.journal_entry_id for update;
  select jsonb_agg(jsonb_build_object('accountCode',account_code,'debit',credit,'credit',debit,'costCenter',cost_center,
    'auxiliary',auxiliary,'lineDescription','Reversión: '||description,'documentReference',document_reference) order by line_number)
  into v_lines from public.erp_financial_journal_lines
  where company_id=p_company_id and journal_entry_id=v_original.journal_entry_id;
  v_payload:=jsonb_build_object('accountingDate',current_date,'concept','Reversión '||v_original.entry_number||' - '||p_reason,
    'originModule','Compras','sourceDocument',v_purchase.document_code,'externalReference',v_original.entry_number,
    'currencyCode',v_original.currency_code,'exchangeRate',v_original.exchange_rate,'observation',p_reason,'lines',v_lines);
  v_reverse:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,v_payload,
    'PURCHASE_REVERSAL',p_purchase_document_id::text,'REVERSE_PURCHASE');

  update public.erp_financial_journal_entries set status='REVERSED',reversed_at=clock_timestamp(),reversed_by=auth.uid(),
    version=version+1,last_operation_id=p_operation_id
  where company_id=p_company_id and journal_entry_id=v_original.journal_entry_id;
  update public.erp_supplier_purchase_documents set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),
    cancellation_reason=p_reason,version=version+1,last_operation_id=p_operation_id
  where company_id=p_company_id and purchase_document_id=p_purchase_document_id;
  if v_purchase.payable_id is not null then
    update public.erp_supplier_accounts_payable set status='CANCELLED',balance=0,updated_at=clock_timestamp(),
      version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and payable_id=v_purchase.payable_id;
    v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_purchase.payable_id));
  end if;
  for v_cost in select * from public.erp_supplier_reception_cost_allocations
    where company_id=p_company_id and source_type='PURCHASE_DOCUMENT' and source_id=p_purchase_document_id and status='ACTIVE' for update
  loop
    update public.erp_supplier_reception_cost_allocations set status='REVERSED',last_operation_id=p_operation_id
    where company_id=p_company_id and allocation_id=v_cost.allocation_id;
    v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_reception_cost(p_company_id,p_operation_id,p_device_id,v_cost.allocation_id));
  end loop;
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_purchase(p_company_id,p_operation_id,p_device_id,p_purchase_document_id));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_original.journal_entry_id));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,
    'REVERSE_PURCHASE','PURCHASE_DOCUMENT',p_purchase_document_id::text,jsonb_build_object('reason',p_reason)));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,
    'result',jsonb_build_object('purchaseDocumentId',p_purchase_document_id::text,'reverseJournalEntryId',v_reverse::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_REVERSE_PURCHASE',p_purchase_document_id::text,jsonb_build_object('reason',p_reason),
    v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_supplier_v2_post_purchase(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_doc public.erp_supplier_purchase_documents%rowtype; v_provider public.erp_supplier_providers%rowtype;
  v_id uuid:=gen_random_uuid(); v_payable_id uuid; v_entry_id uuid; v_code text; v_line jsonb; v_idx integer:=0; v_total numeric(20,6);
  v_saved jsonb; v_records jsonb:='[]'; v_result jsonb; v_source_key text; v_reception public.erp_entity_records%rowtype;
  v_allocation_id uuid; v_available numeric(20,6); v_prior numeric(20,6); v_quantity numeric(20,6);
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
  v_source_key:=btrim(coalesce(p_payload->>'sourceKey','')); v_total:=round(coalesce(nullif(p_payload#>>'{totals,total}','')::numeric,0),6);
  if v_source_key='' or v_total<=0 or nullif(p_payload->>'providerId','') is null then raise exception using errcode='22023',message='SUPPLIER_V2_PURCHASE_INCOMPLETE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PURCHASE:'||v_source_key,0));
  select * into v_doc from public.erp_supplier_purchase_documents where company_id=p_company_id and source_key=v_source_key;
  if found then
    v_saved:=public.erp_supplier_v2_publish_purchase(p_company_id,p_operation_id,p_device_id,v_doc.purchase_document_id); v_records:=v_records||jsonb_build_array(v_saved);
    if v_doc.payable_id is not null then v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_doc.payable_id)); end if;
    if v_doc.journal_entry_id is not null then v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_doc.journal_entry_id)); end if;
    v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('purchaseDocumentId',v_doc.purchase_document_id::text,'reused',true));
    insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
    values(p_operation_id,p_company_id,'SUPPLIER_POST_PURCHASE',v_doc.purchase_document_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
  end if;
  select * into v_provider from public.erp_supplier_providers where company_id=p_company_id and provider_id=(p_payload->>'providerId')::uuid and status='ACTIVE' for share;
  if not found then raise exception using errcode='23503',message='SUPPLIER_V2_PROVIDER_NOT_FOUND'; end if;
  v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_payload->'journal','PURCHASE_DOCUMENT',v_id::text,'POST_PURCHASE');
  v_code:=public.erp_supplier_v2_next_code(p_company_id,'PURCHASE',coalesce(nullif(p_payload->>'accountingDate','')::date,current_date));
  if upper(coalesce(p_payload->>'settlementMode','CXP'))='CXP' then v_payable_id:=gen_random_uuid(); end if;
  insert into public.erp_supplier_purchase_documents(company_id,purchase_document_id,document_code,provider_id,document_type,external_document_number,source_key,
    issue_date,accounting_date,due_date,currency_code,exchange_rate,subtotal,tax_total,discount_total,withholding_total,total,settlement_mode,source,source_payload,
    status,journal_entry_id,payable_id,legacy_draft_id,created_at,created_by,posted_at,posted_by,last_operation_id)
  values(p_company_id,v_id,v_code,v_provider.provider_id,upper(coalesce(nullif(p_payload->>'documentType',''),'INVOICE')),btrim(p_payload->>'documentNumber'),v_source_key,
    (p_payload->>'issueDate')::date,(p_payload->>'accountingDate')::date,coalesce(nullif(p_payload->>'dueDate','')::date,(p_payload->>'issueDate')::date),
    upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
    round(coalesce(nullif(p_payload#>>'{totals,subtotal}','')::numeric,0),6),round(coalesce(nullif(p_payload#>>'{totals,taxTotal}','')::numeric,0),6),
    round(coalesce(nullif(p_payload#>>'{totals,discountTotal}','')::numeric,0),6),round(coalesce(nullif(p_payload#>>'{totals,withholdingTotal}','')::numeric,0),6),
    v_total,upper(coalesce(p_payload->>'settlementMode','CXP')),upper(coalesce(p_payload->>'source','MANUAL')),coalesce(p_payload->'sourcePayload','{}'),'POSTED',
    v_entry_id,v_payable_id,nullif(p_payload->>'legacyDraftId',''),clock_timestamp(),auth.uid(),clock_timestamp(),auth.uid(),p_operation_id);
  for v_line in select value from jsonb_array_elements(coalesce(p_payload->'lines','[]')) loop
    v_idx:=v_idx+1;
    insert into public.erp_supplier_purchase_lines(company_id,purchase_line_id,purchase_document_id,line_number,product_code,description,quantity,unit,unit_price,
      taxable_base,tax_rate,tax_value,discount,line_total,account_code,cost_center,line_type,reception_id,reception_item_id)
    values(p_company_id,gen_random_uuid(),v_id,v_idx,btrim(coalesce(v_line->>'productCode','')),btrim(coalesce(v_line->>'description','Compra')),
      coalesce(nullif(v_line->>'quantity','')::numeric,0),btrim(coalesce(v_line->>'unit','')),coalesce(nullif(v_line->>'unitPrice','')::numeric,0),
      coalesce(nullif(v_line->>'taxableBase','')::numeric,0),coalesce(nullif(v_line->>'vatRate','')::numeric,0),coalesce(nullif(v_line->>'vatValue','')::numeric,0),
      coalesce(nullif(v_line->>'discount','')::numeric,0),coalesce(nullif(v_line->>'totalLine','')::numeric,0),btrim(v_line->>'accountCode'),
      btrim(coalesce(v_line->>'costCenter','')),upper(coalesce(nullif(v_line->>'lineType',''),'EXPENSE')),nullif(v_line->>'receptionId',''),nullif(v_line->>'receptionItemId',''));
    if nullif(v_line->>'receptionId','') is not null then
      select * into v_reception from public.erp_entity_records
      where company_id=p_company_id and entity='operations_receptions' and record_id=v_line->>'receptionId' and deleted_at is null for update;
      if not found then raise exception using errcode='23503',message='SUPPLIER_V2_RECEPTION_NOT_FOUND'; end if;
      if nullif(v_reception.payload->>'providerId','') is not null and (v_reception.payload->>'providerId')::uuid<>v_provider.provider_id then
        raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_PROVIDER_MISMATCH';
      end if;
      if nullif(v_reception.payload->>'providerId','') is null and upper(btrim(coalesce(v_reception.payload->>'supplier',''))) not in (upper(v_provider.legal_name),upper(v_provider.commercial_name)) then
        raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_PROVIDER_MISMATCH';
      end if;
      select coalesce((select nullif(item->>'totalStems','')::numeric from jsonb_array_elements(coalesce(v_reception.payload->'items','[]')) item
        where item->>'id'=v_line->>'receptionItemId'),nullif(v_reception.payload->>'totalDeclared','')::numeric,0) into v_available;
      select coalesce(sum(quantity),0) into v_prior from public.erp_supplier_reception_cost_allocations
      where company_id=p_company_id and reception_id=v_line->>'receptionId'
        and coalesce(reception_item_id,'')=coalesce(v_line->>'receptionItemId','') and status='ACTIVE';
      v_quantity:=round(coalesce(nullif(v_line->>'quantity','')::numeric,0),6);
      if v_quantity<=0 or v_prior+v_quantity>v_available then
        raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_QUANTITY_EXCEEDED';
      end if;
      v_allocation_id:=gen_random_uuid();
      insert into public.erp_supplier_reception_cost_allocations(company_id,allocation_id,provider_id,source_type,source_id,reception_id,reception_item_id,
        quantity_type,quantity,unit_price,amount,status,rule_snapshot,created_at,last_operation_id)
      values(p_company_id,v_allocation_id,v_provider.provider_id,'PURCHASE_DOCUMENT',v_id,v_line->>'receptionId',nullif(v_line->>'receptionItemId',''),
        upper(coalesce(nullif(v_line->>'quantityType',''),'STEM')),v_quantity,coalesce(nullif(v_line->>'unitPrice','')::numeric,0),
        coalesce(nullif(v_line->>'totalLine','')::numeric,0),'ACTIVE',coalesce(v_line->'ruleSnapshot','{}'),clock_timestamp(),p_operation_id);
      v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_reception_cost(p_company_id,p_operation_id,p_device_id,v_allocation_id));
    end if;
  end loop;
  if v_payable_id is not null then
    insert into public.erp_supplier_accounts_payable(company_id,payable_id,provider_id,source_type,source_id,document_number,issue_date,due_date,currency_code,
      exchange_rate,total,balance,payable_account_code,status,journal_entry_id,created_at,created_by,updated_at,last_operation_id)
    values(p_company_id,v_payable_id,v_provider.provider_id,'PURCHASE_DOCUMENT',v_id,btrim(p_payload->>'documentNumber'),(p_payload->>'issueDate')::date,
      coalesce(nullif(p_payload->>'dueDate','')::date,(p_payload->>'issueDate')::date),upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),
      coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),greatest(v_total-round(coalesce(nullif(p_payload#>>'{totals,withholdingTotal}','')::numeric,0),6),0),
      greatest(v_total-round(coalesce(nullif(p_payload#>>'{totals,withholdingTotal}','')::numeric,0),6),0),btrim(p_payload->>'payableAccountCode'),'OPEN',v_entry_id,
      clock_timestamp(),auth.uid(),clock_timestamp(),p_operation_id);
  end if;
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id));
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_purchase(p_company_id,p_operation_id,p_device_id,v_id));
  if v_payable_id is not null then v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_payable_id)); end if;
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_PURCHASE','PURCHASE_DOCUMENT',v_id::text,jsonb_build_object('providerId',v_provider.provider_id,'total',v_total)));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('purchaseDocumentId',v_id::text,'payableId',v_payable_id::text,'journalEntryId',v_entry_id::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_POST_PURCHASE',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_supplier_v2_publish_payment(p_company_id uuid,p_operation_id uuid,p_device_id text,p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.erp_supplier_payments%rowtype; p public.erp_supplier_providers%rowtype; v_apps jsonb;
begin
  select * into strict v from public.erp_supplier_payments where company_id=p_company_id and payment_id=p_payment_id;
  select * into strict p from public.erp_supplier_providers where company_id=p_company_id and provider_id=v.provider_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',payment_application_id::text,'payableId',payable_id::text,'amount',amount,
    'originalBalance',balance_before,'resultingBalance',balance_after) order by created_at),'[]') into v_apps
  from public.erp_supplier_payment_applications where company_id=p_company_id and payment_id=p_payment_id;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_payments',p_payment_id::text,
    jsonb_build_object('id',v.payment_id::text,'paymentId',v.payment_id::text,'paymentNumber',v.payment_code,'providerId',v.provider_id::text,
      'providerName',p.legal_name,'providerRuc',p.tax_id,'clientReferenceId',v.client_reference_id,'paymentDate',v.payment_date,
      'paymentMethod',v.payment_method,'reference',v.reference,'currencyCode',v.currency_code,'exchangeRate',v.exchange_rate,
      'paymentAccountCode',v.payment_account_code,'total',v.total,'status',v.status,'entryId',v.journal_entry_id::text,
      'reverseEntryId',v.reverse_journal_entry_id::text,'applications',v_apps,'version',v.version,'syncFlow','SUPPLIER_FINANCE_V2'),
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='supplier_payments' and record_id=p_payment_id::text),0));
end $$;

create or replace function public.erp_supplier_v2_register_payment(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_provider uuid:=(p_payload->>'providerId')::uuid; v_id uuid:=gen_random_uuid(); v_entry uuid;
 v_app jsonb; v_payable public.erp_supplier_accounts_payable%rowtype; v_total numeric(20,6):=0; v_amount numeric(20,6); v_code text;
 v_saved jsonb; v_records jsonb:='[]'; v_result jsonb; v_application_id uuid;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
  if not exists(select 1 from public.erp_supplier_providers where company_id=p_company_id and provider_id=v_provider and status='ACTIVE') then raise exception using errcode='23503',message='SUPPLIER_V2_PROVIDER_NOT_FOUND'; end if;
  if jsonb_array_length(coalesce(p_payload->'applications','[]'))=0 then raise exception using errcode='22023',message='SUPPLIER_V2_PAYMENT_APPLICATIONS_REQUIRED'; end if;
  for v_app in select value from jsonb_array_elements(p_payload->'applications') order by value->>'payableId' loop
    select * into v_payable from public.erp_supplier_accounts_payable where company_id=p_company_id and payable_id=(v_app->>'payableId')::uuid for update;
    v_amount:=round(coalesce(nullif(v_app->>'amount','')::numeric,0),6);
    if not found or v_payable.provider_id<>v_provider or v_payable.status in ('PAID','CANCELLED') then raise exception using errcode='23514',message='SUPPLIER_V2_PAYABLE_NOT_AVAILABLE'; end if;
    if v_amount<=0 or v_amount>v_payable.balance then raise exception using errcode='23514',message='SUPPLIER_V2_PAYMENT_EXCEEDS_BALANCE'; end if;
    v_total:=v_total+v_amount;
  end loop;
  if round(v_total,6)<>round(coalesce(nullif(p_payload->>'total','')::numeric,0),6) then raise exception using errcode='23514',message='SUPPLIER_V2_PAYMENT_TOTAL_MISMATCH'; end if;
  v_entry:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_payload->'journal','SUPPLIER_PAYMENT',v_id::text,'POST_SUPPLIER_PAYMENT');
  v_code:=public.erp_supplier_v2_next_code(p_company_id,'PAYMENT',(p_payload->>'paymentDate')::date);
  insert into public.erp_supplier_payments(company_id,payment_id,payment_code,provider_id,client_reference_id,payment_date,payment_method,reference,
    currency_code,exchange_rate,payment_account_code,total,status,journal_entry_id,created_at,created_by,last_operation_id)
  values(p_company_id,v_id,v_code,v_provider,nullif(p_payload->>'clientReferenceId',''),(p_payload->>'paymentDate')::date,upper(btrim(p_payload->>'paymentMethod')),
    btrim(coalesce(p_payload->>'reference','')),upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
    btrim(p_payload->>'paymentAccountCode'),v_total,'CONFIRMED',v_entry,clock_timestamp(),auth.uid(),p_operation_id);
  for v_app in select value from jsonb_array_elements(p_payload->'applications') loop
    select * into strict v_payable from public.erp_supplier_accounts_payable where company_id=p_company_id and payable_id=(v_app->>'payableId')::uuid for update;
    v_amount:=round((v_app->>'amount')::numeric,6); v_application_id:=gen_random_uuid();
    insert into public.erp_supplier_payment_applications(company_id,payment_application_id,payment_id,payable_id,amount,balance_before,balance_after)
    values(p_company_id,v_application_id,v_id,v_payable.payable_id,v_amount,v_payable.balance,v_payable.balance-v_amount);
    update public.erp_supplier_accounts_payable set balance=balance-v_amount,status=case when balance-v_amount=0 then 'PAID' else 'PARTIALLY_PAID' end,
      updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and payable_id=v_payable.payable_id;
    v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_payable.payable_id));
  end loop;
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry));
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payment(p_company_id,p_operation_id,p_device_id,v_id));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_SUPPLIER_PAYMENT','SUPPLIER_PAYMENT',v_id::text,jsonb_build_object('providerId',v_provider,'total',v_total)));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('paymentId',v_id::text,'journalEntryId',v_entry::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_REGISTER_PAYMENT',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_supplier_v2_reverse_payment(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payment_id uuid,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_payment public.erp_supplier_payments%rowtype; v_original public.erp_financial_journal_entries%rowtype;
 v_reverse uuid; v_payload jsonb; v_lines jsonb; v_app public.erp_supplier_payment_applications%rowtype; v_records jsonb:='[]'; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
  select * into v_payment from public.erp_supplier_payments where company_id=p_company_id and payment_id=p_payment_id for update;
  if not found then raise exception using errcode='23503',message='SUPPLIER_V2_PAYMENT_NOT_FOUND'; end if;
  if v_payment.status='REVERSED' then raise exception using errcode='23514',message='SUPPLIER_V2_PAYMENT_ALREADY_REVERSED'; end if;
  if btrim(coalesce(p_reason,''))='' then raise exception using errcode='22023',message='SUPPLIER_V2_REVERSAL_REASON_REQUIRED'; end if;
  for v_app in select * from public.erp_supplier_payment_applications where company_id=p_company_id and payment_id=p_payment_id order by payable_id for update loop
    update public.erp_supplier_accounts_payable set balance=balance+v_app.amount,status=case when balance+v_app.amount>=total then 'OPEN' else 'PARTIALLY_PAID' end,
      updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and payable_id=v_app.payable_id;
    v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_app.payable_id));
  end loop;
  select * into strict v_original from public.erp_financial_journal_entries where company_id=p_company_id and journal_entry_id=v_payment.journal_entry_id for update;
  select jsonb_agg(jsonb_build_object('accountCode',account_code,'debit',credit,'credit',debit,'costCenter',cost_center,'auxiliary',auxiliary,
    'lineDescription','Reversión: '||description,'documentReference',document_reference) order by line_number) into v_lines
  from public.erp_financial_journal_lines where company_id=p_company_id and journal_entry_id=v_original.journal_entry_id;
  v_payload:=jsonb_build_object('accountingDate',current_date,'concept','Reversión '||v_original.entry_number||' - '||p_reason,'originModule','Pagos',
    'sourceDocument',v_payment.payment_code,'externalReference',v_original.entry_number,'currencyCode',v_original.currency_code,'exchangeRate',v_original.exchange_rate,
    'observation',p_reason,'lines',v_lines);
  v_reverse:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,v_payload,'SUPPLIER_PAYMENT_REVERSAL',p_payment_id::text,'REVERSE_SUPPLIER_PAYMENT');
  update public.erp_financial_journal_entries set status='REVERSED',reversed_at=clock_timestamp(),reversed_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
    where company_id=p_company_id and journal_entry_id=v_original.journal_entry_id;
  update public.erp_supplier_payments set status='REVERSED',reverse_journal_entry_id=v_reverse,reversed_at=clock_timestamp(),reversed_by=auth.uid(),reversal_reason=p_reason,
    version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and payment_id=p_payment_id;
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_original.journal_entry_id));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse));
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payment(p_company_id,p_operation_id,p_device_id,p_payment_id));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'REVERSE_SUPPLIER_PAYMENT','SUPPLIER_PAYMENT',p_payment_id::text,jsonb_build_object('reason',p_reason)));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('paymentId',p_payment_id::text,'reverseJournalEntryId',v_reverse::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_REVERSE_PAYMENT',p_payment_id::text,jsonb_build_object('reason',p_reason),v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

-- La liquidación valida cantidades contra la recepción canónica y crea obligación/asiento en una sola transacción.
create or replace function public.erp_supplier_v2_create_settlement(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_provider public.erp_supplier_providers%rowtype; v_reception public.erp_entity_records%rowtype;
 v_id uuid:=gen_random_uuid(); v_payable uuid:=gen_random_uuid(); v_entry uuid; v_code text; v_line jsonb; v_line_id uuid; v_allocation uuid;
 v_available numeric(20,6); v_prior numeric(20,6); v_quantity numeric(20,6); v_line_total numeric(20,6); v_total numeric(20,6):=0;
 v_saved jsonb; v_records jsonb:='[]'; v_result jsonb; v_idx integer:=0;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
  select * into v_provider from public.erp_supplier_providers where company_id=p_company_id and provider_id=(p_payload->>'providerId')::uuid and status='ACTIVE' for share;
  if not found or jsonb_array_length(coalesce(p_payload->'lines','[]'))=0 then raise exception using errcode='22023',message='SUPPLIER_V2_SETTLEMENT_INCOMPLETE'; end if;
  for v_line in select value from jsonb_array_elements(p_payload->'lines') order by value->>'receptionId',value->>'receptionItemId' loop
    select * into v_reception from public.erp_entity_records where company_id=p_company_id and entity='operations_receptions' and record_id=v_line->>'receptionId' and deleted_at is null for update;
    if not found then raise exception using errcode='23503',message='SUPPLIER_V2_RECEPTION_NOT_FOUND'; end if;
    if nullif(v_reception.payload->>'providerId','') is not null and (v_reception.payload->>'providerId')::uuid<>v_provider.provider_id then raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_PROVIDER_MISMATCH'; end if;
    if nullif(v_reception.payload->>'providerId','') is null and upper(btrim(coalesce(v_reception.payload->>'supplier',''))) not in (upper(v_provider.legal_name),upper(v_provider.commercial_name)) then raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_PROVIDER_MISMATCH'; end if;
    select coalesce((select case when upper(coalesce(nullif(v_line->>'quantityType',''),'STEM'))='BUNCH'
      then nullif(item->>'meshCount','')::numeric else nullif(item->>'totalStems','')::numeric end
      from jsonb_array_elements(coalesce(v_reception.payload->'items','[]')) item where item->>'id'=v_line->>'receptionItemId'),
      case when upper(coalesce(nullif(v_line->>'quantityType',''),'STEM'))='BUNCH' then nullif(v_reception.payload->>'meshCount','')::numeric
        else nullif(v_reception.payload->>'totalDeclared','')::numeric end,0) into v_available;
    select coalesce(sum(quantity),0) into v_prior from public.erp_supplier_reception_cost_allocations where company_id=p_company_id and reception_id=v_line->>'receptionId'
      and coalesce(reception_item_id,'')=coalesce(v_line->>'receptionItemId','')
      and quantity_type=upper(coalesce(nullif(v_line->>'quantityType',''),'STEM')) and status='ACTIVE';
    v_quantity:=round(coalesce(nullif(v_line->>'quantity','')::numeric,0),6); v_line_total:=round(coalesce(nullif(v_line->>'total','')::numeric,0),6);
    if v_quantity<=0 or v_prior+v_quantity>v_available then raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_QUANTITY_EXCEEDED'; end if;
    if v_line_total<>round(v_quantity*coalesce(nullif(v_line->>'unitPrice','')::numeric,0)-coalesce(nullif(v_line->>'discount','')::numeric,0)+coalesce(nullif(v_line->>'adjustment','')::numeric,0),6) then
      raise exception using errcode='23514',message='SUPPLIER_V2_SETTLEMENT_LINE_TOTAL_INVALID'; end if;
    v_total:=v_total+v_line_total;
  end loop;
  if round(v_total,6)<>round(coalesce(nullif(p_payload->>'total','')::numeric,0),6) then raise exception using errcode='23514',message='SUPPLIER_V2_SETTLEMENT_TOTAL_MISMATCH'; end if;
  v_entry:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_payload->'journal','SUPPLIER_SETTLEMENT',v_id::text,'POST_SUPPLIER_SETTLEMENT');
  v_code:=public.erp_supplier_v2_next_code(p_company_id,'SETTLEMENT',(p_payload->>'periodEnd')::date);
  insert into public.erp_supplier_settlements(company_id,settlement_id,settlement_code,provider_id,period_start,period_end,settlement_method,currency_code,
    exchange_rate,gross_total,discount_total,adjustment_total,total,status,rule_snapshot,journal_entry_id,payable_id,notes,created_at,created_by,posted_at,last_operation_id)
  values(p_company_id,v_id,v_code,v_provider.provider_id,(p_payload->>'periodStart')::date,(p_payload->>'periodEnd')::date,upper(p_payload->>'settlementMethod'),
    upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
    round(coalesce(nullif(p_payload->>'grossTotal','')::numeric,v_total),6),round(coalesce(nullif(p_payload->>'discountTotal','')::numeric,0),6),
    round(coalesce(nullif(p_payload->>'adjustmentTotal','')::numeric,0),6),v_total,'POSTED',coalesce(p_payload->'ruleSnapshot','{}'),v_entry,v_payable,
    btrim(coalesce(p_payload->>'notes','')),clock_timestamp(),auth.uid(),clock_timestamp(),p_operation_id);
  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    v_idx:=v_idx+1; v_line_id:=gen_random_uuid(); v_allocation:=gen_random_uuid(); v_quantity:=round((v_line->>'quantity')::numeric,6); v_line_total:=round((v_line->>'total')::numeric,6);
    insert into public.erp_supplier_settlement_lines(company_id,settlement_line_id,settlement_id,reception_id,reception_item_id,variety,length,quantity_type,
      quantity,unit_price,gross_amount,discount,adjustment,total,rule_snapshot)
    values(p_company_id,v_line_id,v_id,v_line->>'receptionId',nullif(v_line->>'receptionItemId',''),btrim(coalesce(v_line->>'variety','')),
      btrim(coalesce(v_line->>'length','')),upper(coalesce(nullif(v_line->>'quantityType',''),'STEM')),v_quantity,
      coalesce(nullif(v_line->>'unitPrice','')::numeric,0),coalesce(nullif(v_line->>'grossAmount','')::numeric,v_quantity*coalesce(nullif(v_line->>'unitPrice','')::numeric,0)),
      coalesce(nullif(v_line->>'discount','')::numeric,0),coalesce(nullif(v_line->>'adjustment','')::numeric,0),v_line_total,coalesce(v_line->'ruleSnapshot','{}'));
    insert into public.erp_supplier_reception_cost_allocations(company_id,allocation_id,provider_id,source_type,source_id,reception_id,reception_item_id,
      quantity_type,quantity,unit_price,amount,status,rule_snapshot,created_at,last_operation_id)
    values(p_company_id,v_allocation,v_provider.provider_id,'SUPPLIER_SETTLEMENT',v_id,v_line->>'receptionId',nullif(v_line->>'receptionItemId',''),
      upper(coalesce(nullif(v_line->>'quantityType',''),'STEM')),v_quantity,coalesce(nullif(v_line->>'unitPrice','')::numeric,0),v_line_total,'ACTIVE',
      coalesce(v_line->'ruleSnapshot','{}'),clock_timestamp(),p_operation_id);
    v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_reception_costs',v_allocation::text,
      jsonb_build_object('id',v_allocation::text,'allocationId',v_allocation::text,'providerId',v_provider.provider_id::text,'sourceType','SUPPLIER_SETTLEMENT',
      'sourceId',v_id::text,'receptionId',v_line->>'receptionId','receptionItemId',v_line->>'receptionItemId','quantityType',upper(coalesce(nullif(v_line->>'quantityType',''),'STEM')),
      'quantity',v_quantity,'unitPrice',v_line->>'unitPrice','amount',v_line_total,'status','ACTIVE','syncFlow','SUPPLIER_FINANCE_V2'),0);
    v_records:=v_records||jsonb_build_array(v_saved);
  end loop;
  insert into public.erp_supplier_accounts_payable(company_id,payable_id,provider_id,source_type,source_id,document_number,issue_date,due_date,currency_code,
    exchange_rate,total,balance,payable_account_code,status,journal_entry_id,created_at,created_by,updated_at,last_operation_id)
  values(p_company_id,v_payable,v_provider.provider_id,'SUPPLIER_SETTLEMENT',v_id,v_code,(p_payload->>'periodEnd')::date,coalesce(nullif(p_payload->>'dueDate','')::date,(p_payload->>'periodEnd')::date),
    upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),v_total,v_total,
    btrim(p_payload->>'payableAccountCode'),'OPEN',v_entry,clock_timestamp(),auth.uid(),clock_timestamp(),p_operation_id);
  v_saved:=public.erp_supplier_v2_publish_settlement(p_company_id,p_operation_id,p_device_id,v_id);
  v_records:=v_records||jsonb_build_array(v_saved);
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_payable));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_SUPPLIER_SETTLEMENT','SUPPLIER_SETTLEMENT',v_id::text,jsonb_build_object('providerId',v_provider.provider_id,'total',v_total)));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('settlementId',v_id::text,'payableId',v_payable::text,'journalEntryId',v_entry::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_CREATE_SETTLEMENT',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $$;

create or replace function public.erp_supplier_v2_reverse_settlement(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_settlement_id uuid,p_reason text,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.erp_operations_commands%rowtype; v_settlement public.erp_supplier_settlements%rowtype;
 v_payable public.erp_supplier_accounts_payable%rowtype; v_original public.erp_financial_journal_entries%rowtype;
 v_cost public.erp_supplier_reception_cost_allocations%rowtype; v_reverse uuid; v_payload jsonb; v_lines jsonb;
 v_records jsonb:='[]'; v_result jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
  if found then return v_existing.result; end if;
  if btrim(coalesce(p_reason,''))='' then raise exception using errcode='22023',message='SUPPLIER_V2_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_settlement from public.erp_supplier_settlements
  where company_id=p_company_id and settlement_id=p_settlement_id for update;
  if not found then raise exception using errcode='23503',message='SUPPLIER_V2_SETTLEMENT_NOT_FOUND'; end if;
  if v_settlement.status='REVERSED' then raise exception using errcode='23514',message='SUPPLIER_V2_SETTLEMENT_ALREADY_REVERSED'; end if;
  select * into strict v_payable from public.erp_supplier_accounts_payable
  where company_id=p_company_id and payable_id=v_settlement.payable_id for update;
  if v_payable.balance<>v_payable.total then raise exception using errcode='23514',message='SUPPLIER_V2_SETTLEMENT_HAS_PAYMENTS'; end if;
  select * into strict v_original from public.erp_financial_journal_entries
  where company_id=p_company_id and journal_entry_id=v_settlement.journal_entry_id for update;
  select jsonb_agg(jsonb_build_object('accountCode',account_code,'debit',credit,'credit',debit,'costCenter',cost_center,
    'auxiliary',auxiliary,'lineDescription','Reversión: '||description,'documentReference',document_reference) order by line_number)
  into v_lines from public.erp_financial_journal_lines
  where company_id=p_company_id and journal_entry_id=v_original.journal_entry_id;
  v_payload:=jsonb_build_object('accountingDate',current_date,'concept','Reversión '||v_original.entry_number||' - '||p_reason,
    'originModule','Compras','sourceDocument',v_settlement.settlement_code,'externalReference',v_original.entry_number,
    'currencyCode',v_original.currency_code,'exchangeRate',v_original.exchange_rate,'observation',p_reason,'lines',v_lines);
  v_reverse:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,v_payload,
    'SUPPLIER_SETTLEMENT_REVERSAL',p_settlement_id::text,'REVERSE_SUPPLIER_SETTLEMENT');
  update public.erp_financial_journal_entries set status='REVERSED',reversed_at=clock_timestamp(),reversed_by=auth.uid(),
    version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and journal_entry_id=v_original.journal_entry_id;
  update public.erp_supplier_settlements set status='REVERSED',reversed_at=clock_timestamp(),reversed_by=auth.uid(),reversal_reason=p_reason,
    version=version+1,last_operation_id=p_operation_id where company_id=p_company_id and settlement_id=p_settlement_id;
  update public.erp_supplier_accounts_payable set status='CANCELLED',balance=0,updated_at=clock_timestamp(),version=version+1,last_operation_id=p_operation_id
  where company_id=p_company_id and payable_id=v_settlement.payable_id;
  for v_cost in select * from public.erp_supplier_reception_cost_allocations
    where company_id=p_company_id and source_type='SUPPLIER_SETTLEMENT' and source_id=p_settlement_id and status='ACTIVE' for update
  loop
    update public.erp_supplier_reception_cost_allocations set status='REVERSED',last_operation_id=p_operation_id
    where company_id=p_company_id and allocation_id=v_cost.allocation_id;
    v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_reception_cost(p_company_id,p_operation_id,p_device_id,v_cost.allocation_id));
  end loop;
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_settlement(p_company_id,p_operation_id,p_device_id,p_settlement_id));
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_settlement.payable_id));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_original.journal_entry_id));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_reverse));
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,
    'REVERSE_SUPPLIER_SETTLEMENT','SUPPLIER_SETTLEMENT',p_settlement_id::text,jsonb_build_object('reason',p_reason)));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,
    'result',jsonb_build_object('settlementId',p_settlement_id::text,'reverseJournalEntryId',v_reverse::text));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_REVERSE_SETTLEMENT',p_settlement_id::text,jsonb_build_object('reason',p_reason),
    v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace view public.erp_supplier_v2_provider_balances with (security_invoker=true) as
select p.company_id,p.provider_id,p.provider_code,p.tax_id,p.legal_name,
 coalesce(sum(a.total) filter(where a.status<>'CANCELLED'),0)::numeric(20,6) total_obligations,
 coalesce(sum(a.balance) filter(where a.status<>'CANCELLED'),0)::numeric(20,6) balance,
 count(a.payable_id) filter(where a.status in ('OPEN','PARTIALLY_PAID')) open_documents
from public.erp_supplier_providers p left join public.erp_supplier_accounts_payable a
 on a.company_id=p.company_id and a.provider_id=p.provider_id
group by p.company_id,p.provider_id,p.provider_code,p.tax_id,p.legal_name;

create or replace view public.erp_supplier_v2_reception_cost_summary with (security_invoker=true) as
select allocation.company_id,allocation.provider_id,provider.tax_id,provider.legal_name,
  allocation.reception_id,allocation.reception_item_id,allocation.quantity_type,
  sum(allocation.quantity)::numeric(20,6) confirmed_quantity,
  sum(allocation.amount)::numeric(20,6) confirmed_cost,
  case when sum(allocation.quantity)=0 then 0
    else (sum(allocation.amount)/sum(allocation.quantity))::numeric(20,6) end average_unit_cost
from public.erp_supplier_reception_cost_allocations allocation
join public.erp_supplier_providers provider
  on provider.company_id=allocation.company_id and provider.provider_id=allocation.provider_id
where allocation.status='ACTIVE'
group by allocation.company_id,allocation.provider_id,provider.tax_id,provider.legal_name,
  allocation.reception_id,allocation.reception_item_id,allocation.quantity_type;

create or replace function public.erp_supplier_v2_health(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok',true,'component','SUPPLIER_FINANCE_V2','migration','202608150010','companyId',p_company_id::text,
    'providersTable',to_regclass('public.erp_supplier_providers') is not null,
    'purchaseDocumentsTable',to_regclass('public.erp_supplier_purchase_documents') is not null,
    'purchaseLinesTable',to_regclass('public.erp_supplier_purchase_lines') is not null,
    'payablesTable',to_regclass('public.erp_supplier_accounts_payable') is not null,
    'settlementsTable',to_regclass('public.erp_supplier_settlements') is not null,
    'settlementLinesTable',to_regclass('public.erp_supplier_settlement_lines') is not null,
    'receptionCostsTable',to_regclass('public.erp_supplier_reception_cost_allocations') is not null,
    'paymentsTable',to_regclass('public.erp_supplier_payments') is not null,
    'paymentApplicationsTable',to_regclass('public.erp_supplier_payment_applications') is not null,
    'adjustmentsTable',to_regclass('public.erp_supplier_adjustments') is not null,
    'providerBalancesView',to_regclass('public.erp_supplier_v2_provider_balances') is not null,
    'receptionCostView',to_regclass('public.erp_supplier_v2_reception_cost_summary') is not null,
    'upsertProviderRpc',to_regprocedure('public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'postPurchaseRpc',to_regprocedure('public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reversePurchaseRpc',to_regprocedure('public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamp with time zone)') is not null,
    'registerPaymentRpc',to_regprocedure('public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reversePaymentRpc',to_regprocedure('public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamp with time zone)') is not null,
    'createSettlementRpc',to_regprocedure('public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reverseSettlementRpc',to_regprocedure('public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamp with time zone)') is not null
  );
end $$;

revoke all on function public.erp_supplier_v2_next_code(uuid,text,date) from public,anon,authenticated;
revoke all on function public.erp_supplier_v2_publish_provider(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_supplier_v2_publish_payable(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_supplier_v2_publish_purchase(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_supplier_v2_publish_reception_cost(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_supplier_v2_publish_settlement(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_supplier_v2_publish_payment(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erp_supplier_v2_health(uuid) from public,anon;
grant execute on function public.erp_supplier_v2_health(uuid) to authenticated;

revoke all on function public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
revoke all on function public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
revoke all on function public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
grant select on public.erp_supplier_v2_provider_balances to authenticated;
grant select on public.erp_supplier_v2_reception_cost_summary to authenticated;
grant select on public.erp_supplier_providers,public.erp_supplier_purchase_documents,public.erp_supplier_purchase_lines,
  public.erp_supplier_accounts_payable,public.erp_supplier_settlements,public.erp_supplier_settlement_lines,
  public.erp_supplier_reception_cost_allocations,public.erp_supplier_payments,public.erp_supplier_payment_applications,
  public.erp_supplier_adjustments to authenticated;
revoke insert,update,delete,truncate on public.erp_supplier_providers,public.erp_supplier_purchase_documents,public.erp_supplier_purchase_lines,
  public.erp_supplier_accounts_payable,public.erp_supplier_settlements,public.erp_supplier_settlement_lines,
  public.erp_supplier_reception_cost_allocations,public.erp_supplier_payments,public.erp_supplier_payment_applications,
  public.erp_supplier_adjustments from authenticated,anon;

do $$ declare v_table text; begin
  foreach v_table in array array['erp_supplier_providers','erp_supplier_purchase_documents','erp_supplier_accounts_payable','erp_supplier_settlements',
    'erp_supplier_reception_cost_allocations','erp_supplier_payments','erp_supplier_adjustments'] loop
    begin execute format('alter publication supabase_realtime add table public.%I',v_table); exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst,'reload schema';

commit;
