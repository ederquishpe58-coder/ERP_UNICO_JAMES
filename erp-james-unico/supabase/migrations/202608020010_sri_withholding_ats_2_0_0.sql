-- Habilita comprobantes de retencion 07 en ambiente SRI de certificacion.
-- Baseline oficial: ficha tecnica offline 2.34 (2026-07-27), retencion ATS 2.0.0.

alter table public.sri_settings
  add column if not exists withholding_xml_version text not null default '2.0.0';

alter table public.sri_settings
  drop constraint if exists sri_settings_supported_versions;

update public.sri_settings
set
  invoice_xml_version = '1.1.0',
  credit_note_xml_version = '1.1.0',
  delivery_guide_xml_version = '1.1.0',
  withholding_xml_version = '2.0.0',
  technical_spec_version = '2.34',
  technical_spec_date = date '2026-07-27',
  updated_at = now();

alter table public.sri_settings
  add constraint sri_settings_supported_versions check (
    invoice_xml_version = '1.1.0'
    and credit_note_xml_version = '1.1.0'
    and delivery_guide_xml_version = '1.1.0'
    and withholding_xml_version = '2.0.0'
    and technical_spec_version = '2.34'
  );

alter table public.electronic_documents
  drop constraint if exists electronic_documents_type_check;

alter table public.electronic_documents
  add constraint electronic_documents_type_check check (
    document_type in ('01', '04', '06', '07')
  );

alter table public.electronic_documents
  drop constraint if exists electronic_documents_supported_xml;

alter table public.electronic_documents
  add constraint electronic_documents_supported_xml check (
    (
      document_type in ('01', '04', '06')
      and xml_version = '1.1.0'
      and xsd_version = '1.1.0'
    )
    or (
      document_type = '07'
      and xml_version = '2.0.0'
      and xsd_version = '2.0.0'
    )
  );

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
  if (
    p_document_type = '07'
    and (p_xml_version <> '2.0.0' or p_xsd_version <> '2.0.0')
  ) or (
    p_document_type <> '07'
    and (p_xml_version <> '1.1.0' or p_xsd_version <> '1.1.0')
  ) then
    raise exception using errcode = '22023', message = 'SRI_XML_VERSION_NOT_ENABLED';
  end if;
  if jsonb_typeof(p_issuer_snapshot) <> 'object'
     or jsonb_typeof(p_buyer_snapshot) <> 'object'
     or jsonb_typeof(p_source_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'SRI_SNAPSHOT_MUST_BE_OBJECT';
  end if;
  if p_created_by is null
     or not exists (
       select 1
       from public.sri_company_memberships membership
       where membership.company_id = p_company_id
         and membership.auth_user_id = p_created_by
         and membership.active
         and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
     ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_CREATE_DOCUMENT';
  end if;

  select *
  into v_settings
  from public.sri_settings
  where company_id = p_company_id
  for update;

  if not found
     or v_settings.environment <> 'TEST'
     or v_settings.production_enabled
     or not v_settings.immediate_transmission then
    raise exception using errcode = '23514', message = 'SRI_TEST_CONFIGURATION_REQUIRED';
  end if;

  select *
  into v_point
  from public.emission_points
  where company_id = p_company_id
    and id = p_emission_point_id
    and environment = 'TEST'
    and active
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'SRI_ACTIVE_EMISSION_POINT_REQUIRED';
  end if;

  if p_document_type = '04' then
    select *
    into v_original
    from public.electronic_documents
    where company_id = p_company_id
      and id = p_parent_document_id
      and document_type = '01'
      and status = 'AUTORIZADO'
    for update;

    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
  elsif p_parent_document_id is not null then
    raise exception using errcode = '23514', message = 'SRI_PARENT_ONLY_ALLOWED_FOR_CREDIT_NOTE';
  end if;

  insert into public.electronic_document_sequences (
    company_id,
    emission_point_id,
    environment,
    document_type,
    next_value,
    updated_by
  )
  values (
    p_company_id,
    p_emission_point_id,
    'TEST',
    p_document_type,
    1,
    p_created_by
  )
  on conflict (company_id, emission_point_id, environment, document_type)
  do nothing;

  select sequence_row.next_value
  into v_sequential
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
  set
    next_value = v_sequential + 1,
    updated_by = p_created_by
  where company_id = p_company_id
    and emission_point_id = p_emission_point_id
    and environment = 'TEST'
    and document_type = p_document_type;

  v_access_key := public.sri_build_access_key(
    p_issue_date,
    p_document_type,
    v_settings.ruc,
    v_point.establishment_code,
    v_point.emission_point_code,
    v_sequential,
    p_numeric_code
  );

  insert into public.electronic_documents (
    company_id,
    emission_point_id,
    parent_document_id,
    source_order_id,
    source_packing_id,
    customer_id,
    document_type,
    status,
    issue_date,
    environment,
    emission_type,
    establishment_code,
    emission_point_code,
    sequential,
    sequential_text,
    full_number,
    numeric_code,
    verification_digit,
    access_key,
    xml_version,
    xsd_version,
    issuer_snapshot,
    buyer_snapshot,
    source_snapshot,
    created_by,
    updated_by
  )
  values (
    p_company_id,
    p_emission_point_id,
    p_parent_document_id,
    p_source_order_id,
    p_source_packing_id,
    p_customer_id,
    p_document_type,
    'BORRADOR',
    p_issue_date,
    'TEST',
    '1',
    v_point.establishment_code,
    v_point.emission_point_code,
    v_sequential,
    lpad(v_sequential::text, 9, '0'),
    v_point.establishment_code
      || '-' || v_point.emission_point_code
      || '-' || lpad(v_sequential::text, 9, '0'),
    p_numeric_code,
    right(v_access_key, 1)::smallint,
    v_access_key,
    p_xml_version,
    p_xsd_version,
    p_issuer_snapshot,
    p_buyer_snapshot,
    p_source_snapshot,
    p_created_by,
    p_created_by
  )
  returning * into v_document;

  if p_document_type in ('01', '04') then
    insert into public.accounting_document_links (
      company_id,
      document_id,
      status
    )
    values (
      p_company_id,
      v_document.id,
      'PENDING'
    );
  end if;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    new_status,
    reason,
    new_values
  )
  values (
    p_company_id,
    v_document.id,
    p_created_by,
    'USER',
    'DRAFT_CREATED',
    'BORRADOR',
    'Borrador SRI creado con secuencial atomico',
    jsonb_build_object(
      'full_number', v_document.full_number,
      'access_key', v_document.access_key,
      'environment', 'TEST'
    )
  );

  return to_jsonb(v_document);
end;
$$;
