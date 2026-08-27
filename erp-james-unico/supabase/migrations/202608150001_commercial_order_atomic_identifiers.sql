begin;

-- Numeracion interna de pedidos comerciales. El navegador deja de calcular el
-- maximo usando su cache local; Supabase reserva cada numero bajo bloqueo.
create table if not exists public.commercial_order_sequences (
  company_id uuid not null references public.companies(id) on delete cascade,
  order_year integer not null check (order_year between 2020 and 2200),
  next_value bigint not null default 1 check (next_value between 1 and 100000000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, order_year)
);

create table if not exists public.commercial_order_number_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_id text not null,
  order_year integer not null check (order_year between 2020 and 2200),
  sequential bigint not null check (sequential between 1 and 99999999),
  order_number text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint commercial_order_reservation_record_unique unique (company_id, record_id),
  constraint commercial_order_reservation_sequence_unique unique (company_id, order_year, sequential),
  constraint commercial_order_reservation_number_unique unique (company_id, order_number),
  constraint commercial_order_reservation_number_format check (order_number ~ '^PED-COM-[0-9]{4}-[0-9]{4,8}$')
);

-- La factura se reserva al guardar el pedido. El mismo registro se consume
-- posteriormente al crear el borrador SRI, sin tomar un segundo numero.
create table if not exists public.commercial_invoice_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_id text not null,
  emission_point_id uuid not null,
  environment text not null default 'TEST' check (environment = 'TEST'),
  document_type text not null default '01' check (document_type = '01'),
  establishment_code text not null check (establishment_code ~ '^[0-9]{3}$'),
  emission_point_code text not null check (emission_point_code ~ '^[0-9]{3}$'),
  sequential bigint not null check (sequential between 1 and 999999999),
  full_number text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REPLACED', 'CONSUMED')),
  replaced_at timestamptz,
  consumed_at timestamptz,
  consumed_document_id uuid references public.electronic_documents(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_invoice_reservation_point_fk
    foreign key (company_id, emission_point_id)
    references public.emission_points(company_id, id)
    on delete restrict,
  constraint commercial_invoice_reservation_sequence_unique
    unique (company_id, emission_point_id, environment, document_type, sequential),
  constraint commercial_invoice_reservation_full_number_unique
    unique (company_id, document_type, full_number),
  constraint commercial_invoice_reservation_full_number_format check (
    full_number = establishment_code || '-' || emission_point_code || '-' || lpad(sequential::text, 9, '0')
  )
);

create unique index if not exists commercial_invoice_reservation_one_active_order_idx
  on public.commercial_invoice_reservations(company_id, record_id, document_type)
  where status = 'ACTIVE';

create index if not exists commercial_invoice_reservation_record_idx
  on public.commercial_invoice_reservations(company_id, record_id, status, created_at desc);

alter table public.commercial_order_sequences enable row level security;
alter table public.commercial_order_number_reservations enable row level security;
alter table public.commercial_invoice_reservations enable row level security;

drop policy if exists commercial_order_sequences_member_select on public.commercial_order_sequences;
create policy commercial_order_sequences_member_select
on public.commercial_order_sequences for select to authenticated
using (public.erp_is_company_member(company_id, auth.uid()));

drop policy if exists commercial_order_reservations_member_select on public.commercial_order_number_reservations;
create policy commercial_order_reservations_member_select
on public.commercial_order_number_reservations for select to authenticated
using (public.erp_is_company_member(company_id, auth.uid()));

drop policy if exists commercial_invoice_reservations_member_select on public.commercial_invoice_reservations;
create policy commercial_invoice_reservations_member_select
on public.commercial_invoice_reservations for select to authenticated
using (public.erp_is_company_member(company_id, auth.uid()));

revoke all on public.commercial_order_sequences from public, anon;
revoke all on public.commercial_order_number_reservations from public, anon;
revoke all on public.commercial_invoice_reservations from public, anon;
grant select on public.commercial_order_sequences to authenticated, service_role;
grant select on public.commercial_order_number_reservations to authenticated, service_role;
grant select on public.commercial_invoice_reservations to authenticated, service_role;

create or replace function public.erp_reserve_commercial_order_identifiers(
  p_company_id uuid,
  p_record_id text,
  p_order_year integer,
  p_establishment_code text,
  p_emission_point_code text,
  p_document_type text default '01'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.commercial_order_number_reservations%rowtype;
  v_invoice public.commercial_invoice_reservations%rowtype;
  v_point public.emission_points%rowtype;
  v_order_sequential bigint;
  v_invoice_sequential bigint;
begin
  if v_actor is null or not public.erp_is_company_member(p_company_id, v_actor) then
    raise exception using errcode = '42501', message = 'ERP_COMPANY_ACCESS_REQUIRED';
  end if;
  if nullif(btrim(p_record_id), '') is null
     or p_order_year not between 2020 and 2200
     or p_establishment_code !~ '^[0-9]{3}$'
     or p_emission_point_code !~ '^[0-9]{3}$'
     or p_document_type <> '01' then
    raise exception using errcode = '22023', message = 'COMMERCIAL_IDENTIFIER_INPUT_INVALID';
  end if;

  select * into v_point
  from public.emission_points point
  where point.company_id = p_company_id
    and point.environment = 'TEST'
    and point.establishment_code = p_establishment_code
    and point.emission_point_code = p_emission_point_code
    and point.active
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_ACTIVE_EMISSION_POINT_REQUIRED';
  end if;

  select * into v_order
  from public.commercial_order_number_reservations reservation
  where reservation.company_id = p_company_id
    and reservation.record_id = p_record_id
  for update;

  if not found then
    insert into public.commercial_order_sequences(company_id, order_year, next_value, updated_by)
    values (p_company_id, p_order_year, 1, v_actor)
    on conflict (company_id, order_year) do nothing;

    select sequence_row.next_value into v_order_sequential
    from public.commercial_order_sequences sequence_row
    where sequence_row.company_id = p_company_id
      and sequence_row.order_year = p_order_year
    for update;
    if v_order_sequential > 99999999 then
      raise exception using errcode = '22003', message = 'COMMERCIAL_ORDER_SEQUENCE_EXHAUSTED';
    end if;

    update public.commercial_order_sequences
    set next_value = v_order_sequential + 1, updated_by = v_actor, updated_at = now()
    where company_id = p_company_id and order_year = p_order_year;

    insert into public.commercial_order_number_reservations(
      company_id, record_id, order_year, sequential, order_number, created_by
    ) values (
      p_company_id,
      p_record_id,
      p_order_year,
      v_order_sequential,
      'PED-COM-' || p_order_year::text || '-' || lpad(v_order_sequential::text, 4, '0'),
      v_actor
    ) returning * into v_order;
  end if;

  select * into v_invoice
  from public.commercial_invoice_reservations reservation
  where reservation.company_id = p_company_id
    and reservation.record_id = p_record_id
    and reservation.document_type = p_document_type
    and reservation.status = 'ACTIVE'
  for update;

  if found and v_invoice.emission_point_id <> v_point.id then
    update public.commercial_invoice_reservations
    set status = 'REPLACED', replaced_at = now(), updated_at = now()
    where id = v_invoice.id;
    v_invoice.id := null;
  end if;

  if v_invoice.id is null then
    insert into public.electronic_document_sequences(
      company_id, emission_point_id, environment, document_type, next_value, updated_by
    ) values (
      p_company_id, v_point.id, 'TEST', p_document_type, 1, v_actor
    ) on conflict (company_id, emission_point_id, environment, document_type) do nothing;

    select sequence_row.next_value into v_invoice_sequential
    from public.electronic_document_sequences sequence_row
    where sequence_row.company_id = p_company_id
      and sequence_row.emission_point_id = v_point.id
      and sequence_row.environment = 'TEST'
      and sequence_row.document_type = p_document_type
    for update;
    if v_invoice_sequential > 999999999 then
      raise exception using errcode = '22003', message = 'SRI_SEQUENTIAL_EXHAUSTED';
    end if;

    update public.electronic_document_sequences
    set next_value = v_invoice_sequential + 1, updated_by = v_actor, updated_at = now()
    where company_id = p_company_id
      and emission_point_id = v_point.id
      and environment = 'TEST'
      and document_type = p_document_type;

    insert into public.commercial_invoice_reservations(
      company_id, record_id, emission_point_id, environment, document_type,
      establishment_code, emission_point_code, sequential, full_number,
      status, created_by
    ) values (
      p_company_id, p_record_id, v_point.id, 'TEST', p_document_type,
      v_point.establishment_code, v_point.emission_point_code, v_invoice_sequential,
      v_point.establishment_code || '-' || v_point.emission_point_code || '-' || lpad(v_invoice_sequential::text, 9, '0'),
      'ACTIVE', v_actor
    ) returning * into v_invoice;
  end if;

  return jsonb_build_object(
    'orderReservationId', v_order.id,
    'orderSequential', v_order.sequential,
    'orderNumber', v_order.order_number,
    'invoiceReservationId', v_invoice.id,
    'invoiceSequential', lpad(v_invoice.sequential::text, 9, '0'),
    'fullNumber', v_invoice.full_number,
    'establishmentCode', v_invoice.establishment_code,
    'emissionPointCode', v_invoice.emission_point_code,
    'emissionPointId', v_invoice.emission_point_id,
    'reservedAt', v_invoice.created_at
  );
end;
$$;

revoke all on function public.erp_reserve_commercial_order_identifiers(uuid, text, integer, text, text, text) from public, anon;
grant execute on function public.erp_reserve_commercial_order_identifiers(uuid, text, integer, text, text, text) to authenticated, service_role;

-- create_electronic_document_draft conserva su firma publica, pero para
-- facturas de pedidos toma el numero ya reservado por el ERP.
create or replace function public.create_electronic_document_draft(
  p_company_id uuid,
  p_emission_point_id uuid,
  p_document_type text,
  p_issue_date date,
  p_numeric_code text,
  p_xml_version text,
  p_xsd_version text,
  p_issuer_snapshot jsonb,
  p_buyer_snapshot jsonb,
  p_source_snapshot jsonb,
  p_source_order_id uuid,
  p_source_packing_id uuid,
  p_customer_id uuid,
  p_parent_document_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype;
  v_original public.electronic_documents%rowtype;
  v_reservation public.commercial_invoice_reservations%rowtype;
  v_source_record_id text := nullif(btrim(p_source_snapshot #>> '{erpEmission,sourceOrderId}'), '');
  v_sequential bigint;
  v_access_key text;
  v_document public.electronic_documents%rowtype;
begin
  if p_document_type not in ('01', '04', '06', '07') then
    raise exception using errcode = '22023', message = 'SRI_DOCUMENT_TYPE_NOT_ENABLED';
  end if;
  if p_issue_date is null or p_numeric_code !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'SRI_DRAFT_IDENTIFIERS_INVALID';
  end if;
  if (p_document_type = '07' and (p_xml_version <> '2.0.0' or p_xsd_version <> '2.0.0'))
     or (p_document_type <> '07' and (p_xml_version <> '1.1.0' or p_xsd_version <> '1.1.0')) then
    raise exception using errcode = '22023', message = 'SRI_XML_VERSION_NOT_ENABLED';
  end if;
  if jsonb_typeof(p_issuer_snapshot) <> 'object'
     or jsonb_typeof(p_buyer_snapshot) <> 'object'
     or jsonb_typeof(p_source_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'SRI_SNAPSHOT_MUST_BE_OBJECT';
  end if;
  if p_created_by is null or not exists (
    select 1 from public.sri_company_memberships membership
    where membership.company_id = p_company_id
      and membership.auth_user_id = p_created_by
      and membership.active
      and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_CREATE_DOCUMENT';
  end if;

  select * into v_settings from public.sri_settings
  where company_id = p_company_id for update;
  if not found or v_settings.environment <> 'TEST' or v_settings.production_enabled or not v_settings.immediate_transmission then
    raise exception using errcode = '23514', message = 'SRI_TEST_CONFIGURATION_REQUIRED';
  end if;

  select * into v_point from public.emission_points
  where company_id = p_company_id and id = p_emission_point_id
    and environment = 'TEST' and active for update;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_ACTIVE_EMISSION_POINT_REQUIRED';
  end if;

  if p_document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = p_company_id and id = p_parent_document_id
      and document_type = '01' and status = 'AUTORIZADO' for update;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
  elsif p_parent_document_id is not null then
    raise exception using errcode = '23514', message = 'SRI_PARENT_ONLY_ALLOWED_FOR_CREDIT_NOTE';
  end if;

  if p_document_type = '01' and v_source_record_id is not null then
    select * into v_reservation
    from public.commercial_invoice_reservations reservation
    where reservation.company_id = p_company_id
      and reservation.record_id = v_source_record_id
      and reservation.emission_point_id = p_emission_point_id
      and reservation.document_type = '01'
      and reservation.status in ('ACTIVE', 'CONSUMED')
    order by reservation.created_at desc
    limit 1
    for update;

    if found and v_reservation.status = 'CONSUMED' and v_reservation.consumed_document_id is not null then
      select * into v_document from public.electronic_documents
      where company_id = p_company_id and id = v_reservation.consumed_document_id;
      if found then
        return to_jsonb(v_document) || jsonb_build_object('_reservation_reused', true);
      end if;
    end if;
  end if;

  if v_reservation.id is not null and v_reservation.status = 'ACTIVE' then
    v_sequential := v_reservation.sequential;
  else
    insert into public.electronic_document_sequences(
      company_id, emission_point_id, environment, document_type, next_value, updated_by
    ) values (
      p_company_id, p_emission_point_id, 'TEST', p_document_type, 1, p_created_by
    ) on conflict (company_id, emission_point_id, environment, document_type) do nothing;

    select sequence_row.next_value into v_sequential
    from public.electronic_document_sequences sequence_row
    where sequence_row.company_id = p_company_id
      and sequence_row.emission_point_id = p_emission_point_id
      and sequence_row.environment = 'TEST'
      and sequence_row.document_type = p_document_type
    for update;
    if v_sequential > 999999999 then
      raise exception using errcode = '22003', message = 'SRI_SEQUENTIAL_EXHAUSTED';
    end if;

    update public.electronic_document_sequences
    set next_value = v_sequential + 1, updated_by = p_created_by
    where company_id = p_company_id
      and emission_point_id = p_emission_point_id
      and environment = 'TEST'
      and document_type = p_document_type;
  end if;

  v_access_key := public.sri_build_access_key(
    p_issue_date, p_document_type, v_settings.ruc,
    v_point.establishment_code, v_point.emission_point_code,
    v_sequential, p_numeric_code
  );

  insert into public.electronic_documents (
    company_id, emission_point_id, parent_document_id, source_order_id,
    source_packing_id, customer_id, document_type, status, issue_date,
    environment, emission_type, establishment_code, emission_point_code,
    sequential, sequential_text, full_number, numeric_code,
    verification_digit, access_key, xml_version, xsd_version,
    issuer_snapshot, buyer_snapshot, source_snapshot, created_by, updated_by
  ) values (
    p_company_id, p_emission_point_id, p_parent_document_id, p_source_order_id,
    p_source_packing_id, p_customer_id, p_document_type, 'BORRADOR', p_issue_date,
    'TEST', '1', v_point.establishment_code, v_point.emission_point_code,
    v_sequential, lpad(v_sequential::text, 9, '0'),
    v_point.establishment_code || '-' || v_point.emission_point_code || '-' || lpad(v_sequential::text, 9, '0'),
    p_numeric_code, right(v_access_key, 1)::smallint, v_access_key,
    p_xml_version, p_xsd_version, p_issuer_snapshot, p_buyer_snapshot,
    p_source_snapshot, p_created_by, p_created_by
  ) returning * into v_document;

  if v_reservation.id is not null and v_reservation.status = 'ACTIVE' then
    update public.commercial_invoice_reservations
    set status = 'CONSUMED', consumed_at = now(), consumed_document_id = v_document.id, updated_at = now()
    where id = v_reservation.id;
  end if;

  if p_document_type in ('01', '04') then
    insert into public.accounting_document_links(company_id, document_id, status)
    values (p_company_id, v_document.id, 'PENDING');
  end if;

  insert into public.electronic_document_audit_logs(
    company_id, document_id, actor_user_id, actor_type, action,
    new_status, reason, new_values
  ) values (
    p_company_id, v_document.id, p_created_by, 'USER', 'DRAFT_CREATED',
    'BORRADOR',
    case when v_reservation.id is not null then 'Borrador SRI creado con secuencial reservado al guardar el pedido'
         else 'Borrador SRI creado con secuencial atomico' end,
    jsonb_build_object(
      'full_number', v_document.full_number,
      'access_key', v_document.access_key,
      'environment', 'TEST',
      'commercial_reservation_id', v_reservation.id
    )
  );

  return to_jsonb(v_document) || jsonb_build_object('_reservation_reused', false);
end;
$$;

-- Repara exclusivamente el pedido diagnosticado. No existe borrador, clave ni
-- autorización SRI, por lo que los numeros 0003/000000004 no tienen efecto
-- tributario y pueden alinearse con el inicio limpio solicitado.
do $$
declare
  v_company uuid := '10000000-0000-4000-8000-000000000001'::uuid;
  v_record text := 'COM-ORD-mgfasn-mstohm1t';
  v_point uuid := '13e02737-6e6e-4c7f-a5cd-9da72703f7ce'::uuid;
  v_actor uuid;
begin
  select coalesce(updated_by, created_by) into v_actor
  from public.erp_entity_records
  where company_id = v_company and entity = 'commercial_orders'
    and record_id = v_record and deleted_at is null
  for update;

  if found
     and not exists (
       select 1 from public.electronic_documents document
       where document.company_id = v_company
         and document.source_snapshot #>> '{erpEmission,sourceOrderId}' = v_record
     ) then
    insert into public.commercial_order_sequences(company_id, order_year, next_value, updated_by)
    values (v_company, 2026, 2, v_actor)
    on conflict (company_id, order_year) do update
      set next_value = greatest(public.commercial_order_sequences.next_value, 2), updated_by = excluded.updated_by, updated_at = now();

    insert into public.commercial_order_number_reservations(
      company_id, record_id, order_year, sequential, order_number, created_by
    ) values (v_company, v_record, 2026, 1, 'PED-COM-2026-0001', v_actor)
    on conflict (company_id, record_id) do nothing;

    insert into public.commercial_invoice_reservations(
      company_id, record_id, emission_point_id, environment, document_type,
      establishment_code, emission_point_code, sequential, full_number, status, created_by
    ) values (
      v_company, v_record, v_point, 'TEST', '01', '001', '002', 1,
      '001-002-000000001', 'ACTIVE', v_actor
    ) on conflict (company_id, emission_point_id, environment, document_type, sequential) do nothing;

    update public.electronic_document_sequences
    set next_value = greatest(next_value, 2), updated_by = v_actor, updated_at = now()
    where company_id = v_company and emission_point_id = v_point
      and environment = 'TEST' and document_type = '01';

    update public.erp_entity_records
    set payload = payload || jsonb_build_object(
          'number', 'PED-COM-2026-0001',
          'numberPending', false,
          'sriInvoiceNumber', '001-002-000000001',
          'sriSequential', '000000001',
          'packingListNumber', '000000001',
          'invoicePackingNumber', '000000001',
          'clientInvoiceNumber', '000000001',
          'invoiceSequence', '000000001',
          'sriSeriesCode', 'FAC_EXPORT',
          'sriMarket', 'EXPORTACION',
          'establishmentCode', '001',
          'emissionPointCode', '002',
          'sriSequenceStatus', 'RESERVADO',
          'sriSequenceSource', 'SUPABASE_ATOMICO'
        ),
        version = version + 1,
        updated_at = now(),
        updated_by = v_actor
    where company_id = v_company and entity = 'commercial_orders'
      and record_id = v_record and deleted_at is null;

    update public.erp_entity_records
    set payload = jsonb_set(payload, '{currentNumber}', '1'::jsonb, true),
        version = version + 1,
        updated_at = now(),
        updated_by = v_actor
    where company_id = v_company and entity = 'accounting_document_sequences'
      and record_id = 'SEQ-FAC-EXPORT' and deleted_at is null
      and coalesce((payload ->> 'currentNumber')::bigint, 0) = 4;
  end if;
end;
$$;

commit;
