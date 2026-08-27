-- Compra V2 -> comprobante de retencion SRI tipo 07.
-- Aditiva: no adopta ni modifica los borradores TEST historicos 690/691.

alter table public.erp_supplier_purchase_documents
  add column if not exists updated_at timestamptz not null default now();

alter table public.erp_supplier_purchase_documents
  drop constraint if exists erp_supplier_purchase_retention_status_check;

alter table public.erp_supplier_purchase_documents
  add constraint erp_supplier_purchase_retention_status_check
  check (retention_status in (
    'PENDING_DECISION','PENDING_ISSUANCE','NOT_REQUIRED','DRAFT_CREATED',
    'PROCESSING','AUTHORIZED','RETURNED','NOT_AUTHORIZED','ERROR','CANCELLED'
  ));

create table if not exists public.erp_supplier_purchase_withholding_links (
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_document_id uuid not null,
  electronic_document_id uuid not null,
  journal_entry_id uuid not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED')),
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (company_id, purchase_document_id),
  unique (company_id, electronic_document_id),
  foreign key (company_id, purchase_document_id)
    references public.erp_supplier_purchase_documents(company_id, purchase_document_id) on delete restrict,
  foreign key (company_id, electronic_document_id)
    references public.electronic_documents(company_id, id) on delete restrict,
  foreign key (company_id, journal_entry_id)
    references public.erp_financial_journal_entries(company_id, journal_entry_id) on delete restrict
);

create index if not exists erp_supplier_purchase_withholding_document_idx
  on public.erp_supplier_purchase_withholding_links(company_id, electronic_document_id);

alter table public.erp_supplier_purchase_withholding_links enable row level security;
drop policy if exists erp_supplier_purchase_withholding_links_member_select
  on public.erp_supplier_purchase_withholding_links;
create policy erp_supplier_purchase_withholding_links_member_select
  on public.erp_supplier_purchase_withholding_links
  for select to authenticated
  using (exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = erp_supplier_purchase_withholding_links.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ));

grant select on public.erp_supplier_purchase_withholding_links to authenticated;
revoke insert, update, delete, truncate on public.erp_supplier_purchase_withholding_links from public, anon, authenticated;

create or replace function public.erp_supplier_v2_withholding_status_from_sri(p_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case upper(coalesce(p_status, ''))
    when 'BORRADOR' then 'DRAFT_CREATED'
    when 'VALIDADO' then 'DRAFT_CREATED'
    when 'XML_GENERADO' then 'DRAFT_CREATED'
    when 'FIRMADO' then 'DRAFT_CREATED'
    when 'ENVIADO_SRI' then 'PROCESSING'
    when 'RECIBIDO_SRI' then 'PROCESSING'
    when 'PENDIENTE_REINTENTO' then 'PROCESSING'
    when 'AUTORIZADO' then 'AUTHORIZED'
    when 'DEVUELTO' then 'RETURNED'
    when 'NO_AUTORIZADO' then 'NOT_AUTHORIZED'
    when 'ERROR_ENVIO' then 'ERROR'
    when 'ANULADO' then 'CANCELLED'
    else 'DRAFT_CREATED'
  end
$$;

create or replace function public.erp_supplier_v2_sync_withholding_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase_id uuid;
begin
  if new.document_type <> '07' or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return new;
  end if;
  select link.purchase_document_id into v_purchase_id
  from public.erp_supplier_purchase_withholding_links link
  where link.company_id = new.company_id
    and link.electronic_document_id = new.id
    and link.status = 'ACTIVE';
  if v_purchase_id is not null then
    update public.erp_supplier_purchase_documents
    set retention_status = public.erp_supplier_v2_withholding_status_from_sri(new.status),
        updated_at = clock_timestamp(),
        version = version + 1
    where company_id = new.company_id
      and purchase_document_id = v_purchase_id
      and retention_status is distinct from public.erp_supplier_v2_withholding_status_from_sri(new.status);
  end if;
  return new;
end
$$;

drop trigger if exists erp_supplier_v2_sync_withholding_status_trigger on public.electronic_documents;
create trigger erp_supplier_v2_sync_withholding_status_trigger
after insert or update of status on public.electronic_documents
for each row execute function public.erp_supplier_v2_sync_withholding_status();

-- Conserva la firma publica del backend SRI. Para tipo 07, la metadata
-- erpPurchase activa el vinculo/lock/idempotencia de Compra V2.
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
  v_purchase_text text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,purchaseDocumentId}'), '');
  v_operation_text text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,operationId}'), '');
  v_device_id text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,deviceId}'), '');
  v_purchase_id uuid;
  v_operation_id uuid;
  v_purchase public.erp_supplier_purchase_documents%rowtype;
  v_link public.erp_supplier_purchase_withholding_links%rowtype;
  v_existing_command public.erp_operations_commands%rowtype;
  v_journal_entry_id uuid;
  v_command_result jsonb;
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

  if p_document_type = '07' and v_purchase_text is not null then
    if v_purchase_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_operation_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_device_id is null then
      raise exception using errcode = '22023', message = 'SUPPLIER_WITHHOLDING_V2_COMMAND_INVALID';
    end if;
    v_purchase_id := v_purchase_text::uuid;
    v_operation_id := v_operation_text::uuid;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':PURCHASE_WITHHOLDING:' || v_purchase_id::text, 0));

    select * into v_existing_command
    from public.erp_operations_commands
    where operation_id = v_operation_id and company_id = p_company_id;
    if found and v_existing_command.command_type <> 'SUPPLIER_CREATE_WITHHOLDING' then
      raise exception using errcode = '23505', message = 'SUPPLIER_WITHHOLDING_V2_OPERATION_CONFLICT';
    end if;

    select * into v_purchase
    from public.erp_supplier_purchase_documents
    where company_id = p_company_id and purchase_document_id = v_purchase_id
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'SUPPLIER_WITHHOLDING_V2_PURCHASE_NOT_FOUND';
    end if;
    if v_purchase.status <> 'POSTED' or v_purchase.retention_decision <> 'APLICAR' then
      raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_PURCHASE_NOT_ELIGIBLE';
    end if;
    if v_purchase.retention_status not in (
      'PENDING_ISSUANCE','DRAFT_CREATED','PROCESSING','AUTHORIZED','RETURNED','NOT_AUTHORIZED','ERROR'
    ) then
      raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_STATUS_INVALID';
    end if;

    select * into v_link
    from public.erp_supplier_purchase_withholding_links
    where company_id = p_company_id and purchase_document_id = v_purchase_id
    for update;
    if found then
      select * into v_document from public.electronic_documents
      where company_id = p_company_id and id = v_link.electronic_document_id and document_type = '07';
      if not found then
        raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_LINK_INVALID';
      end if;
      v_command_result := jsonb_build_object(
        'ok', true, 'serverTime', clock_timestamp(),
        'result', jsonb_build_object(
          'purchaseDocumentId', v_purchase_id::text,
          'electronicDocumentId', v_document.id::text,
          'journalEntryId', v_link.journal_entry_id::text,
          'reused', true
        )
      );
      insert into public.erp_operations_commands(
        operation_id, company_id, command_type, source_record_id, request_payload,
        result, status, user_id, device_id, local_created_at, server_created_at
      ) values (
        v_operation_id, p_company_id, 'SUPPLIER_CREATE_WITHHOLDING', v_purchase_id::text,
        jsonb_build_object('purchaseDocumentId', v_purchase_id::text), v_command_result,
        'CONFIRMED', p_created_by, v_device_id, clock_timestamp(), clock_timestamp()
      ) on conflict (operation_id) do nothing;
      return to_jsonb(v_document) || jsonb_build_object(
        '_reservation_reused', true,
        '_purchase_document_id', v_purchase_id::text,
        '_journal_entry_id', v_link.journal_entry_id::text
      );
    end if;
  elsif p_document_type = '07' then
    -- Se mantienen legibles los comprobantes historicos, pero el flujo activo
    -- de Compras V2 siempre debe declarar la compra explicita.
    v_purchase_id := null;
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

  if p_document_type = '07' and v_purchase_id is not null then
    if jsonb_typeof(p_source_snapshot #> '{erpPurchase,journal}') <> 'object' then
      raise exception using errcode = '22023', message = 'SUPPLIER_WITHHOLDING_V2_JOURNAL_REQUIRED';
    end if;
    perform set_config('request.jwt.claim.sub', p_created_by::text, true);
    v_journal_entry_id := public.erp_financial_v2_create_entry_internal(
      p_company_id, v_operation_id, v_device_id,
      p_source_snapshot #> '{erpPurchase,journal}',
      'PURCHASE_WITHHOLDING', v_document.id::text, 'POST_WITHHOLDING'
    );
    insert into public.erp_supplier_purchase_withholding_links(
      company_id, purchase_document_id, electronic_document_id, journal_entry_id,
      status, operation_id, created_at, created_by, updated_at, updated_by
    ) values (
      p_company_id, v_purchase_id, v_document.id, v_journal_entry_id,
      'ACTIVE', v_operation_id, clock_timestamp(), p_created_by, clock_timestamp(), p_created_by
    );
    update public.erp_supplier_purchase_documents
    set retention_status = 'DRAFT_CREATED', updated_at = clock_timestamp(),
        version = version + 1, last_operation_id = v_operation_id
    where company_id = p_company_id and purchase_document_id = v_purchase_id;
    perform public.erp_financial_v2_write_event(
      p_company_id, v_operation_id, v_device_id, 'POST_WITHHOLDING',
      'PURCHASE_WITHHOLDING', v_document.id::text,
      jsonb_build_object(
        'purchaseDocumentId', v_purchase_id::text,
        'electronicDocumentId', v_document.id::text,
        'journalEntryId', v_journal_entry_id::text
      )
    );
    v_command_result := jsonb_build_object(
      'ok', true, 'serverTime', clock_timestamp(),
      'result', jsonb_build_object(
        'purchaseDocumentId', v_purchase_id::text,
        'electronicDocumentId', v_document.id::text,
        'journalEntryId', v_journal_entry_id::text,
        'reused', false
      )
    );
    insert into public.erp_operations_commands(
      operation_id, company_id, command_type, source_record_id, request_payload,
      result, status, user_id, device_id, local_created_at, server_created_at
    ) values (
      v_operation_id, p_company_id, 'SUPPLIER_CREATE_WITHHOLDING', v_purchase_id::text,
      jsonb_build_object('purchaseDocumentId', v_purchase_id::text), v_command_result,
      'CONFIRMED', p_created_by, v_device_id, clock_timestamp(), clock_timestamp()
    );
  end if;

  insert into public.electronic_document_audit_logs(
    company_id, document_id, actor_user_id, actor_type, action,
    new_status, reason, new_values
  ) values (
    p_company_id, v_document.id, p_created_by, 'USER', 'DRAFT_CREATED',
    'BORRADOR',
    case
      when v_purchase_id is not null then 'Retencion de compra V2 creada con vinculo, asiento y secuencial atomicos'
      when v_reservation.id is not null then 'Borrador SRI creado con secuencial reservado al guardar el pedido'
      else 'Borrador SRI creado con secuencial atomico'
    end,
    jsonb_build_object(
      'full_number', v_document.full_number,
      'access_key', v_document.access_key,
      'environment', 'TEST',
      'commercial_reservation_id', v_reservation.id,
      'purchase_document_id', v_purchase_id,
      'journal_entry_id', v_journal_entry_id,
      'operation_id', v_operation_id
    )
  );

  return to_jsonb(v_document) || jsonb_build_object(
    '_reservation_reused', false,
    '_purchase_document_id', v_purchase_id::text,
    '_journal_entry_id', v_journal_entry_id::text
  );
end;
$$;

revoke all on function public.create_electronic_document_draft(
  uuid, uuid, text, date, text, text, text, jsonb, jsonb, jsonb,
  uuid, uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function public.create_electronic_document_draft(
  uuid, uuid, text, date, text, text, text, jsonb, jsonb, jsonb,
  uuid, uuid, uuid, uuid, uuid
) to authenticated, service_role;

create or replace function public.erp_purchase_withholding_v2_health(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'SUPPLIER_WITHHOLDING_V2_ACCESS_DENIED';
  end if;
  return jsonb_build_object(
    'ok', true,
    'component', 'PURCHASE_WITHHOLDING_V2',
    'migration', '202608200002',
    'linksTable', to_regclass('public.erp_supplier_purchase_withholding_links') is not null,
    'draftRpc', to_regprocedure('public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)') is not null,
    'financialV2', to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null
  );
end
$$;

revoke all on function public.erp_purchase_withholding_v2_health(uuid) from public, anon;
grant execute on function public.erp_purchase_withholding_v2_health(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.erp_supplier_purchase_withholding_links;
exception when duplicate_object then null;
end $$;

select pg_notify('pgrst', 'reload schema');
