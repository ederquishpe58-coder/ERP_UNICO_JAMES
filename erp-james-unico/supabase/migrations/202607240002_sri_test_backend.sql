-- Bless Flower / Imperio Flowers ERP
-- Backend oficial de comprobantes electronicos SRI, exclusivamente TEST.
--
-- Dependencia:
--   202607240001_core_access.sql
--
-- Seguridad deliberada:
--   * PRODUCCION no puede habilitarse en esta migracion.
--   * El navegador solo consulta metadatos protegidos por RLS.
--   * Toda escritura tributaria y todos los RPC transaccionales son service_role.
--   * La membresia SRI es una vista del acceso editable del ERP; no duplica usuarios.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Acceso SRI derivado de usuarios, empresas y permisos editables del ERP
-- ---------------------------------------------------------------------------

create view public.sri_company_memberships
with (security_invoker = true)
as
select
  membership.company_id,
  membership.user_id as auth_user_id,
  case
    when membership.membership_role in ('OWNER', 'ADMIN') then 'ADMIN'
    when public.erp_has_route_permission(
      membership.company_id,
      'commercial-sri-authorization',
      'approve',
      membership.user_id
    ) then 'TRIBUTACION'
    when public.erp_has_route_permission(
      membership.company_id,
      'commercial-sri-authorization',
      'create',
      membership.user_id
    ) or public.erp_has_route_permission(
      membership.company_id,
      'commercial-sri-authorization',
      'edit',
      membership.user_id
    ) then 'EMISOR'
    else 'CONSULTA'
  end as role_code,
  (
    membership.membership_status = 'ACTIVE'
    and profile.is_active
    and company.is_active
    and (membership.valid_from is null or membership.valid_from <= current_date)
    and (membership.valid_until is null or membership.valid_until >= current_date)
    and (
      membership.membership_role in ('OWNER', 'ADMIN')
      or public.erp_has_route_permission(
        membership.company_id,
        'commercial-sri-authorization',
        'view',
        membership.user_id
      )
      or public.erp_has_route_permission(
        membership.company_id,
        'commercial-sri-authorization',
        'create',
        membership.user_id
      )
      or public.erp_has_route_permission(
        membership.company_id,
        'commercial-sri-authorization',
        'edit',
        membership.user_id
      )
      or public.erp_has_route_permission(
        membership.company_id,
        'commercial-sri-authorization',
        'approve',
        membership.user_id
      )
    )
  ) as active
from public.user_company_memberships membership
join public.user_profiles profile
  on profile.user_id = membership.user_id
join public.companies company
  on company.id = membership.company_id;

comment on view public.sri_company_memberships is
  'Contrato de autenticacion de api/sri: deriva empresa, rol y vigencia de los permisos editables del ERP.';

-- ---------------------------------------------------------------------------
-- Funciones auxiliares, sin acceso anonimo
-- ---------------------------------------------------------------------------

create or replace function public.sri_is_company_member(
  p_company_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.sri_company_memberships membership
    where membership.company_id = p_company_id
      and membership.auth_user_id = p_user_id
      and membership.active
  );
$$;

create or replace function public.sri_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

/*
DEFERRED_SECURITY_BLOCK_BEGIN
El bloque definitivo se ejecuta al final, cuando todas las tablas y funciones existen.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'sri-private',
  'sri-private',
  false,
  5242880,
  array[
    'application/x-pkcs12',
    'application/pkcs12',
    'application/xml',
    'text/xml',
    'application/pdf',
    'application/json'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.sri_settings enable row level security;
alter table public.emission_points enable row level security;
alter table public.electronic_document_sequences enable row level security;
alter table public.digital_certificates enable row level security;
alter table public.electronic_documents enable row level security;
alter table public.electronic_document_lines enable row level security;
alter table public.electronic_document_taxes enable row level security;
alter table public.electronic_document_files enable row level security;
alter table public.sri_transmissions enable row level security;
alter table public.sri_transmission_attempts enable row level security;
alter table public.sri_responses enable row level security;
alter table public.sri_authorizations enable row level security;
alter table public.sri_error_messages enable row level security;
alter table public.electronic_document_audit_logs enable row level security;
alter table public.accounting_generation_rules enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.accounting_document_links enable row level security;

create policy sri_settings_select_member
on public.sri_settings for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy emission_points_select_member
on public.emission_points for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy electronic_document_sequences_select_member
on public.electronic_document_sequences for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy digital_certificates_select_member
on public.digital_certificates for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy electronic_documents_select_member
on public.electronic_documents for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy electronic_document_lines_select_member
on public.electronic_document_lines for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy electronic_document_taxes_select_member
on public.electronic_document_taxes for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy electronic_document_files_select_member
on public.electronic_document_files for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy sri_transmissions_select_member
on public.sri_transmissions for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy sri_transmission_attempts_select_member
on public.sri_transmission_attempts for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy sri_responses_select_member
on public.sri_responses for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy sri_authorizations_select_member
on public.sri_authorizations for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy sri_error_messages_select_member
on public.sri_error_messages for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy electronic_document_audit_logs_select_member
on public.electronic_document_audit_logs for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy accounting_generation_rules_select_member
on public.accounting_generation_rules for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy journal_entries_select_member
on public.journal_entries for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy journal_entry_lines_select_member
on public.journal_entry_lines for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

create policy accounting_document_links_select_member
on public.accounting_document_links for select to authenticated
using (public.sri_is_company_member(company_id, auth.uid()));

revoke all on table public.sri_settings from anon, authenticated;
revoke all on table public.emission_points from anon, authenticated;
revoke all on table public.electronic_document_sequences from anon, authenticated;
revoke all on table public.digital_certificates from anon, authenticated;
revoke all on table public.electronic_documents from anon, authenticated;
revoke all on table public.electronic_document_lines from anon, authenticated;
revoke all on table public.electronic_document_taxes from anon, authenticated;
revoke all on table public.electronic_document_files from anon, authenticated;
revoke all on table public.sri_transmissions from anon, authenticated;
revoke all on table public.sri_transmission_attempts from anon, authenticated;
revoke all on table public.sri_responses from anon, authenticated;
revoke all on table public.sri_authorizations from anon, authenticated;
revoke all on table public.sri_error_messages from anon, authenticated;
revoke all on table public.electronic_document_audit_logs from anon, authenticated;
revoke all on table public.accounting_generation_rules from anon, authenticated;
revoke all on table public.journal_entries from anon, authenticated;
revoke all on table public.journal_entry_lines from anon, authenticated;
revoke all on table public.accounting_document_links from anon, authenticated;
revoke all on table storage.objects from anon, authenticated;

grant select on table public.sri_settings to authenticated;
grant select on table public.emission_points to authenticated;
grant select on table public.electronic_document_sequences to authenticated;
grant select (
  id, company_id, alias, certificate_serial, subject_name, subject_ruc,
  issuer_name, valid_from, valid_until, fingerprint_sha256, active,
  last_validated_at, validation_status, validation_message, created_at, updated_at
) on table public.digital_certificates to authenticated;
grant select on table public.electronic_documents to authenticated;
grant select on table public.electronic_document_lines to authenticated;
grant select on table public.electronic_document_taxes to authenticated;
grant select (
  id, company_id, document_id, file_type, content_type, content_sha256,
  size_bytes, schema_version, immutable, created_by, created_at
) on table public.electronic_document_files to authenticated;
grant select on table public.sri_transmissions to authenticated;
grant select on table public.sri_transmission_attempts to authenticated;
grant select on table public.sri_responses to authenticated;
grant select on table public.sri_authorizations to authenticated;
grant select on table public.sri_error_messages to authenticated;
grant select on table public.electronic_document_audit_logs to authenticated;
grant select on table public.accounting_generation_rules to authenticated;
grant select on table public.journal_entries to authenticated;
grant select on table public.journal_entry_lines to authenticated;
grant select on table public.accounting_document_links to authenticated;
grant select on table public.sri_company_memberships to authenticated, service_role;

grant all on table public.sri_settings to service_role;
grant all on table public.emission_points to service_role;
grant all on table public.electronic_document_sequences to service_role;
grant all on table public.digital_certificates to service_role;
grant all on table public.electronic_documents to service_role;
grant all on table public.electronic_document_lines to service_role;
grant all on table public.electronic_document_taxes to service_role;
grant all on table public.electronic_document_files to service_role;
grant all on table public.sri_transmissions to service_role;
grant all on table public.sri_transmission_attempts to service_role;
grant all on table public.sri_responses to service_role;
grant all on table public.sri_authorizations to service_role;
grant all on table public.sri_error_messages to service_role;
grant all on table public.electronic_document_audit_logs to service_role;
grant all on table public.accounting_generation_rules to service_role;
grant all on table public.journal_entries to service_role;
grant all on table public.journal_entry_lines to service_role;
grant all on table public.accounting_document_links to service_role;

revoke all on function public.sri_touch_updated_at() from public, anon, authenticated;
revoke all on function public.sri_preserve_creation_audit() from public, anon, authenticated;
revoke all on function public.sri_validate_settings_company() from public, anon, authenticated;
revoke all on function public.sri_validate_document_integrity() from public, anon, authenticated;
revoke all on function public.sri_modulo11(text) from public, anon, authenticated;
revoke all on function public.sri_build_access_key(date, text, text, text, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.create_electronic_document_draft(
  uuid, uuid, text, date, text, text, text, jsonb, jsonb, jsonb,
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.set_electronic_document_status(
  uuid, text, text, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.refresh_electronic_document_issue_date(uuid, date, uuid)
  from public, anon, authenticated;
revoke all on function public.validate_credit_note_amount(uuid, numeric, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_sri_transmission(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_sri_authorization(
  uuid, text, text, text, timestamptz, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.generate_sri_accounting_entry(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.sri_is_company_member(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.sri_modulo11(text) to service_role;
grant execute on function public.sri_build_access_key(date, text, text, text, text, bigint, text)
  to service_role;
grant execute on function public.create_electronic_document_draft(
  uuid, uuid, text, date, text, text, text, jsonb, jsonb, jsonb,
  uuid, uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.set_electronic_document_status(
  uuid, text, text, uuid, text, jsonb
) to service_role;
grant execute on function public.refresh_electronic_document_issue_date(uuid, date, uuid)
  to service_role;
grant execute on function public.validate_credit_note_amount(uuid, numeric, uuid)
  to service_role;
grant execute on function public.claim_sri_transmission(uuid, text)
  to service_role;
grant execute on function public.record_sri_authorization(
  uuid, text, text, text, timestamptz, text, text, uuid
) to service_role;
grant execute on function public.generate_sri_accounting_entry(uuid, uuid)
  to service_role;

DEFERRED_SECURITY_BLOCK_END
*/

create or replace function public.sri_preserve_creation_audit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.sri_modulo11(p_value text)
returns smallint
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_index integer;
  v_factor integer := 2;
  v_sum integer := 0;
  v_result integer;
begin
  if p_value !~ '^[0-9]+$' then
    raise exception using
      errcode = '22023',
      message = 'SRI_MODULO11_REQUIRES_DIGITS';
  end if;

  for v_index in reverse length(p_value)..1 loop
    v_sum := v_sum + substring(p_value from v_index for 1)::integer * v_factor;
    v_factor := case when v_factor = 7 then 2 else v_factor + 1 end;
  end loop;

  v_result := 11 - (v_sum % 11);
  if v_result = 11 then
    return 0;
  elsif v_result = 10 then
    return 1;
  end if;
  return v_result::smallint;
end;
$$;

create or replace function public.sri_build_access_key(
  p_issue_date date,
  p_document_type text,
  p_ruc text,
  p_establishment_code text,
  p_emission_point_code text,
  p_sequential bigint,
  p_numeric_code text
)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = public, pg_temp
as $$
declare
  v_base text;
begin
  if p_document_type not in ('01', '04', '06') then
    raise exception using errcode = '22023', message = 'SRI_DOCUMENT_TYPE_NOT_ENABLED';
  end if;
  if p_ruc !~ '^[0-9]{13}$'
     or p_establishment_code !~ '^[0-9]{3}$'
     or p_emission_point_code !~ '^[0-9]{3}$'
     or p_numeric_code !~ '^[0-9]{8}$'
     or p_sequential < 1
     or p_sequential > 999999999 then
    raise exception using errcode = '22023', message = 'SRI_ACCESS_KEY_INPUT_INVALID';
  end if;

  v_base :=
    to_char(p_issue_date, 'DDMMYYYY')
    || p_document_type
    || p_ruc
    || '1'
    || p_establishment_code
    || p_emission_point_code
    || lpad(p_sequential::text, 9, '0')
    || p_numeric_code
    || '1';

  if length(v_base) <> 48 then
    raise exception using errcode = '22023', message = 'SRI_ACCESS_KEY_BASE_LENGTH_INVALID';
  end if;

  return v_base || public.sri_modulo11(v_base)::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuracion tributaria y puntos de emision
-- ---------------------------------------------------------------------------

create table public.sri_settings (
  company_id uuid primary key references public.companies(id) on delete restrict,
  legal_name text not null,
  commercial_name text,
  ruc text not null,
  head_office_address text not null,
  accounting_required boolean not null default true,
  special_taxpayer_number text,
  withholding_agent_number text,
  rimpe_label text,
  environment text not null default 'TEST',
  emission_type text not null default '1',
  production_enabled boolean not null default false,
  immediate_transmission boolean not null default true,
  invoice_xml_version text not null default '1.1.0',
  credit_note_xml_version text not null default '1.1.0',
  delivery_guide_xml_version text not null default '1.1.0',
  technical_spec_version text not null default '2.33',
  technical_spec_date date not null default date '2026-07-13',
  reception_test_url text not null default
    'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
  authorization_test_url text not null default
    'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
  retry_initial_seconds integer not null default 30,
  retry_max_seconds integer not null default 1800,
  retry_max_attempts integer not null default 12,
  xml_ride_emails text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sri_settings_legal_name_not_blank check (btrim(legal_name) <> ''),
  constraint sri_settings_address_not_blank check (btrim(head_office_address) <> ''),
  constraint sri_settings_ruc_format check (ruc ~ '^[0-9]{13}$'),
  constraint sri_settings_ruc_unique unique (ruc),
  constraint sri_settings_test_only check (environment = 'TEST'),
  constraint sri_settings_production_disabled check (production_enabled = false),
  constraint sri_settings_normal_emission_only check (emission_type = '1'),
  constraint sri_settings_immediate_transmission check (immediate_transmission = true),
  constraint sri_settings_supported_versions check (
    invoice_xml_version = '1.1.0'
    and credit_note_xml_version = '1.1.0'
    and delivery_guide_xml_version = '1.1.0'
    and technical_spec_version = '2.33'
  ),
  constraint sri_settings_official_test_endpoints check (
    reception_test_url =
      'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'
    and authorization_test_url =
      'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
  ),
  constraint sri_settings_retry_range check (
    retry_initial_seconds between 5 and 3600
    and retry_max_seconds between retry_initial_seconds and 86400
    and retry_max_attempts between 1 and 100
  )
);

create or replace function public.sri_validate_settings_company()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
begin
  select *
  into v_company
  from public.companies
  where id = new.company_id;

  if not found or not v_company.is_active then
    raise exception using errcode = '23514', message = 'SRI_COMPANY_NOT_ACTIVE';
  end if;
  if v_company.tax_id <> new.ruc then
    raise exception using errcode = '23514', message = 'SRI_RUC_DOES_NOT_MATCH_COMPANY';
  end if;
  if v_company.sri_environment <> 'TEST' then
    raise exception using errcode = '23514', message = 'SRI_COMPANY_MUST_REMAIN_IN_TEST';
  end if;
  return new;
end;
$$;

create trigger sri_settings_validate_company
before insert or update of company_id, ruc, environment, production_enabled
on public.sri_settings
for each row execute function public.sri_validate_settings_company();

create trigger sri_settings_preserve_creation
before update on public.sri_settings
for each row execute function public.sri_preserve_creation_audit();

create table public.emission_points (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  environment text not null default 'TEST',
  establishment_code text not null,
  emission_point_code text not null,
  establishment_address text not null,
  name text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint emission_points_company_id_id_unique unique (company_id, id),
  constraint emission_points_business_key_unique unique (
    company_id,
    environment,
    establishment_code,
    emission_point_code
  ),
  constraint emission_points_test_only check (environment = 'TEST'),
  constraint emission_points_establishment_format check (
    establishment_code ~ '^[0-9]{3}$'
  ),
  constraint emission_points_point_format check (
    emission_point_code ~ '^[0-9]{3}$'
  ),
  constraint emission_points_address_not_blank check (
    btrim(establishment_address) <> ''
  )
);

create index emission_points_company_active_idx
  on public.emission_points (company_id, active, establishment_code, emission_point_code);

create trigger emission_points_preserve_creation
before update on public.emission_points
for each row execute function public.sri_preserve_creation_audit();

create table public.electronic_document_sequences (
  company_id uuid not null,
  emission_point_id uuid not null,
  environment text not null default 'TEST',
  document_type text not null,
  next_value bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (company_id, emission_point_id, environment, document_type),
  constraint electronic_document_sequences_point_fk
    foreign key (company_id, emission_point_id)
    references public.emission_points(company_id, id)
    on delete restrict,
  constraint electronic_document_sequences_test_only check (environment = 'TEST'),
  constraint electronic_document_sequences_type_check check (
    document_type in ('01', '04', '06')
  ),
  constraint electronic_document_sequences_range check (
    next_value between 1 and 1000000000
  )
);

create trigger electronic_document_sequences_touch_updated_at
before update on public.electronic_document_sequences
for each row execute function public.sri_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Certificados privados: la tabla nunca se concede al navegador
-- ---------------------------------------------------------------------------

create table public.digital_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  alias text not null,
  storage_bucket text not null default 'sri-private',
  storage_object_path text not null,
  password_secret_name text not null,
  certificate_serial text,
  subject_name text,
  subject_ruc text not null,
  issuer_name text,
  valid_from timestamptz,
  valid_until timestamptz,
  fingerprint_sha256 text not null,
  active boolean not null default true,
  last_validated_at timestamptz,
  validation_status text not null default 'UNVALIDATED',
  validation_message text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint digital_certificates_company_id_id_unique unique (company_id, id),
  constraint digital_certificates_fingerprint_unique unique (company_id, fingerprint_sha256),
  constraint digital_certificates_storage_path_unique unique (storage_bucket, storage_object_path),
  constraint digital_certificates_alias_not_blank check (btrim(alias) <> ''),
  constraint digital_certificates_bucket_private check (storage_bucket = 'sri-private'),
  constraint digital_certificates_path_scope check (
    storage_object_path ~
      ('^companies/' || company_id::text || '/certificates/[0-9a-f]{64}[.]p12$')
  ),
  constraint digital_certificates_secret_name check (
    password_secret_name ~ '^SRI_P12_PASSWORD_[A-Z0-9_]{1,96}$'
  ),
  constraint digital_certificates_ruc_format check (subject_ruc ~ '^[0-9]{13}$'),
  constraint digital_certificates_fingerprint_format check (
    fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint digital_certificates_validation_status check (
    validation_status in ('UNVALIDATED', 'VALID', 'INVALID', 'EXPIRED', 'RUC_MISMATCH')
  ),
  constraint digital_certificates_validity_range check (
    valid_until is null or valid_from is null or valid_until > valid_from
  )
);

create unique index digital_certificates_one_active_per_company
  on public.digital_certificates (company_id)
  where active;

create trigger digital_certificates_preserve_creation
before update on public.digital_certificates
for each row execute function public.sri_preserve_creation_audit();

-- ---------------------------------------------------------------------------
-- Comprobantes, lineas, impuestos y artefactos inmutables
-- ---------------------------------------------------------------------------

create table public.electronic_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  emission_point_id uuid not null,
  certificate_id uuid,
  parent_document_id uuid,
  source_order_id uuid,
  source_packing_id uuid,
  customer_id uuid,
  document_type text not null,
  status text not null default 'BORRADOR',
  issue_date date not null,
  environment text not null default 'TEST',
  emission_type text not null default '1',
  establishment_code text not null,
  emission_point_code text not null,
  sequential bigint not null,
  sequential_text text not null,
  full_number text not null,
  numeric_code text not null,
  verification_digit smallint not null,
  access_key text not null,
  xml_version text not null,
  xsd_version text not null,
  issuer_snapshot jsonb not null,
  buyer_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null,
  subtotal numeric(18, 6) not null default 0,
  discount_total numeric(18, 6) not null default 0,
  tax_total numeric(18, 6) not null default 0,
  grand_total numeric(18, 6) not null default 0,
  credited_total numeric(18, 6) not null default 0,
  currency text not null default 'USD',
  additional_information jsonb not null default '{}'::jsonb,
  authorization_number text,
  authorized_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint electronic_documents_company_id_id_unique unique (company_id, id),
  constraint electronic_documents_access_key_unique unique (access_key),
  constraint electronic_documents_sequence_unique unique (
    company_id,
    environment,
    establishment_code,
    emission_point_code,
    document_type,
    sequential
  ),
  constraint electronic_documents_full_number_unique unique (
    company_id,
    document_type,
    full_number
  ),
  constraint electronic_documents_point_fk
    foreign key (company_id, emission_point_id)
    references public.emission_points(company_id, id)
    on delete restrict,
  constraint electronic_documents_certificate_fk
    foreign key (company_id, certificate_id)
    references public.digital_certificates(company_id, id)
    on delete restrict,
  constraint electronic_documents_parent_fk
    foreign key (company_id, parent_document_id)
    references public.electronic_documents(company_id, id)
    on delete restrict,
  constraint electronic_documents_type_check check (
    document_type in ('01', '04', '06')
  ),
  constraint electronic_documents_status_check check (
    status in (
      'BORRADOR',
      'VALIDADO',
      'XML_GENERADO',
      'FIRMADO',
      'ENVIADO_SRI',
      'RECIBIDO_SRI',
      'AUTORIZADO',
      'NO_AUTORIZADO',
      'DEVUELTO',
      'PENDIENTE_REINTENTO',
      'ERROR_ENVIO',
      'ANULADO'
    )
  ),
  constraint electronic_documents_test_only check (
    environment = 'TEST'
    and substring(access_key from 24 for 1) = '1'
  ),
  constraint electronic_documents_normal_emission_only check (emission_type = '1'),
  constraint electronic_documents_codes_format check (
    establishment_code ~ '^[0-9]{3}$'
    and emission_point_code ~ '^[0-9]{3}$'
    and sequential between 1 and 999999999
    and sequential_text = lpad(sequential::text, 9, '0')
    and numeric_code ~ '^[0-9]{8}$'
    and verification_digit between 0 and 9
    and access_key ~ '^[0-9]{49}$'
    and right(access_key, 1) = verification_digit::text
    and full_number =
      establishment_code || '-' || emission_point_code || '-' || sequential_text
  ),
  constraint electronic_documents_supported_xml check (
    xml_version = '1.1.0' and xsd_version = '1.1.0'
  ),
  constraint electronic_documents_json_objects check (
    jsonb_typeof(issuer_snapshot) = 'object'
    and jsonb_typeof(buyer_snapshot) = 'object'
    and jsonb_typeof(source_snapshot) = 'object'
    and jsonb_typeof(additional_information) = 'object'
  ),
  constraint electronic_documents_nonnegative_totals check (
    subtotal >= 0
    and discount_total >= 0
    and tax_total >= 0
    and grand_total >= 0
    and credited_total >= 0
    and credited_total <= grand_total
  ),
  constraint electronic_documents_parent_required check (
    (document_type = '04' and parent_document_id is not null)
    or (document_type <> '04' and parent_document_id is null)
  ),
  constraint electronic_documents_authorization_consistency check (
    (
      status = 'AUTORIZADO'
      and authorization_number is not null
      and btrim(authorization_number) <> ''
      and authorized_at is not null
    )
    or (
      status <> 'AUTORIZADO'
      and (
        authorization_number is null
        or btrim(authorization_number) <> ''
      )
    )
  )
);

create index electronic_documents_company_status_idx
  on public.electronic_documents (company_id, status, created_at desc);
create index electronic_documents_company_issue_date_idx
  on public.electronic_documents (company_id, issue_date desc, document_type);
create index electronic_documents_customer_idx
  on public.electronic_documents (company_id, customer_id, issue_date desc)
  where customer_id is not null;
create index electronic_documents_parent_idx
  on public.electronic_documents (parent_document_id)
  where parent_document_id is not null;

create table public.electronic_document_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  line_number integer not null,
  source_line_id uuid,
  product_id uuid,
  main_code text not null,
  auxiliary_code text,
  description text not null,
  variety text,
  measure text,
  unit text,
  quantity numeric(18, 6) not null,
  unit_price numeric(18, 6) not null default 0,
  discount numeric(18, 6) not null default 0,
  subtotal numeric(18, 6) not null default 0,
  affected_quantity numeric(18, 6),
  affected_amount numeric(18, 6),
  additional_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint electronic_document_lines_company_document_id_unique
    unique (company_id, document_id, id),
  constraint electronic_document_lines_number_unique unique (document_id, line_number),
  constraint electronic_document_lines_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint electronic_document_lines_number_positive check (line_number > 0),
  constraint electronic_document_lines_code_not_blank check (btrim(main_code) <> ''),
  constraint electronic_document_lines_description_not_blank check (btrim(description) <> ''),
  constraint electronic_document_lines_amounts check (
    quantity > 0
    and unit_price >= 0
    and discount >= 0
    and subtotal >= 0
    and (affected_quantity is null or affected_quantity >= 0)
    and (affected_amount is null or affected_amount >= 0)
  ),
  constraint electronic_document_lines_details_object check (
    jsonb_typeof(additional_details) = 'object'
  )
);

create index electronic_document_lines_document_idx
  on public.electronic_document_lines (document_id, line_number);

create table public.electronic_document_taxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  document_line_id uuid,
  tax_code text not null,
  percentage_code text not null,
  rate numeric(9, 4) not null default 0,
  taxable_base numeric(18, 6) not null default 0,
  tax_value numeric(18, 6) not null default 0,
  created_at timestamptz not null default now(),

  constraint electronic_document_taxes_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint electronic_document_taxes_line_fk
    foreign key (company_id, document_id, document_line_id)
    references public.electronic_document_lines(company_id, document_id, id)
    on delete cascade,
  constraint electronic_document_taxes_codes_not_blank check (
    btrim(tax_code) <> '' and btrim(percentage_code) <> ''
  ),
  constraint electronic_document_taxes_amounts check (
    rate >= 0 and taxable_base >= 0 and tax_value >= 0
  )
);

create index electronic_document_taxes_document_idx
  on public.electronic_document_taxes (document_id, document_line_id);

create table public.electronic_document_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  file_type text not null,
  storage_bucket text not null default 'sri-private',
  storage_object_path text not null,
  content_type text not null,
  content_sha256 text not null,
  size_bytes bigint not null,
  schema_version text,
  immutable boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint electronic_document_files_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint electronic_document_files_content_unique
    unique (document_id, file_type, content_sha256),
  constraint electronic_document_files_storage_path_unique
    unique (storage_bucket, storage_object_path),
  constraint electronic_document_files_type_check check (
    file_type in (
      'SOURCE_JSON',
      'UNSIGNED_XML',
      'XSD_REPORT',
      'SIGNED_XML',
      'RECEPTION_RESPONSE',
      'AUTHORIZATION_RESPONSE',
      'AUTHORIZED_XML',
      'RIDE_PDF',
      'CANCELLATION_RESPONSE'
    )
  ),
  constraint electronic_document_files_bucket_private check (
    storage_bucket = 'sri-private'
  ),
  constraint electronic_document_files_path_scope check (
    storage_object_path like
      ('companies/' || company_id::text || '/documents/' || document_id::text || '/%')
  ),
  constraint electronic_document_files_content_hash check (
    content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint electronic_document_files_size_positive check (size_bytes > 0),
  constraint electronic_document_files_immutable check (immutable = true)
);

create index electronic_document_files_document_created_idx
  on public.electronic_document_files (document_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Transmisiones, intentos, respuestas, autorizaciones, errores y auditoria
-- ---------------------------------------------------------------------------

create table public.sri_transmissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  transmission_type text not null,
  environment text not null default 'TEST',
  endpoint_url text not null,
  status text not null default 'PENDING',
  idempotency_key text not null,
  attempt_number integer not null default 0,
  max_attempts integer not null default 12,
  request_file_id uuid,
  next_attempt_at timestamptz,
  worker_id text,
  claimed_at timestamptz,
  http_status integer,
  error_class text,
  error_message text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sri_transmissions_company_id_id_unique unique (company_id, id),
  constraint sri_transmissions_idempotency_unique unique (idempotency_key),
  constraint sri_transmissions_document_type_unique
    unique (document_id, transmission_type),
  constraint sri_transmissions_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint sri_transmissions_request_file_fk
    foreign key (request_file_id)
    references public.electronic_document_files(id)
    on delete restrict,
  constraint sri_transmissions_type_check check (
    transmission_type in ('RECEPTION', 'AUTHORIZATION_QUERY')
  ),
  constraint sri_transmissions_test_only check (environment = 'TEST'),
  constraint sri_transmissions_official_endpoint_only check (
    (
      transmission_type = 'RECEPTION'
      and endpoint_url =
        'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'
    )
    or (
      transmission_type = 'AUTHORIZATION_QUERY'
      and endpoint_url =
        'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
    )
  ),
  constraint sri_transmissions_status_check check (
    status in (
      'PENDING',
      'PROCESSING',
      'RETRY_SCHEDULED',
      'FAILED',
      'COMPLETED',
      'RECEIVED'
    )
  ),
  constraint sri_transmissions_attempt_range check (
    attempt_number between 0 and max_attempts
    and max_attempts between 1 and 100
  ),
  constraint sri_transmissions_http_status_range check (
    http_status is null or http_status between 100 and 599
  )
);

create index sri_transmissions_due_idx
  on public.sri_transmissions (next_attempt_at, status)
  where status in ('PENDING', 'RETRY_SCHEDULED');
create index sri_transmissions_document_idx
  on public.sri_transmissions (document_id, created_at desc);

create trigger sri_transmissions_touch_updated_at
before update on public.sri_transmissions
for each row execute function public.sri_touch_updated_at();

create table public.sri_transmission_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  transmission_id uuid not null,
  attempt_number integer not null,
  status text not null default 'STARTED',
  endpoint_url text not null,
  request_sha256 text not null,
  response_sha256 text,
  http_status integer,
  retryable boolean,
  error_class text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sri_transmission_attempts_number_unique
    unique (transmission_id, attempt_number),
  constraint sri_transmission_attempts_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint sri_transmission_attempts_transmission_fk
    foreign key (company_id, transmission_id)
    references public.sri_transmissions(company_id, id)
    on delete cascade,
  constraint sri_transmission_attempts_status_check check (
    status in ('STARTED', 'SUCCEEDED', 'RETRY_SCHEDULED', 'FAILED')
  ),
  constraint sri_transmission_attempts_number_positive check (attempt_number > 0),
  constraint sri_transmission_attempts_request_hash check (
    request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint sri_transmission_attempts_response_hash check (
    response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint sri_transmission_attempts_http_status_range check (
    http_status is null or http_status between 100 and 599
  ),
  constraint sri_transmission_attempts_finished_range check (
    finished_at is null or finished_at >= started_at
  )
);

create index sri_transmission_attempts_document_idx
  on public.sri_transmission_attempts (document_id, created_at desc);

create trigger sri_transmission_attempts_touch_updated_at
before update on public.sri_transmission_attempts
for each row execute function public.sri_touch_updated_at();

create table public.sri_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  transmission_id uuid not null,
  response_type text not null,
  sri_status text,
  raw_xml text not null,
  payload jsonb not null default '{}'::jsonb,
  content_sha256 text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint sri_responses_company_id_id_unique unique (company_id, id),
  constraint sri_responses_content_unique
    unique (document_id, response_type, content_sha256),
  constraint sri_responses_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint sri_responses_transmission_fk
    foreign key (company_id, transmission_id)
    references public.sri_transmissions(company_id, id)
    on delete cascade,
  constraint sri_responses_type_check check (
    response_type in ('RECEPTION', 'AUTHORIZATION', 'CANCELLATION')
  ),
  constraint sri_responses_xml_not_blank check (btrim(raw_xml) <> ''),
  constraint sri_responses_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint sri_responses_hash_format check (
    content_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create index sri_responses_document_idx
  on public.sri_responses (document_id, received_at desc);

create table public.sri_authorizations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  response_xml text not null,
  authorization_status text not null,
  authorization_number text,
  authorization_date timestamptz,
  environment text not null default 'PRUEBAS',
  authorized_xml text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sri_authorizations_document_unique unique (document_id),
  constraint sri_authorizations_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint sri_authorizations_status_check check (
    authorization_status in ('AUTORIZADO', 'NO AUTORIZADO')
  ),
  constraint sri_authorizations_test_only check (
    upper(environment) in ('PRUEBAS', 'TEST', '1')
  ),
  constraint sri_authorizations_response_not_blank check (btrim(response_xml) <> ''),
  constraint sri_authorizations_content_consistency check (
    (
      authorization_status = 'AUTORIZADO'
      and authorization_number is not null
      and btrim(authorization_number) <> ''
      and authorization_date is not null
      and authorized_xml is not null
      and btrim(authorized_xml) <> ''
    )
    or (
      authorization_status = 'NO AUTORIZADO'
      and authorization_number is null
      and authorization_date is null
      and authorized_xml is null
    )
  )
);

create trigger sri_authorizations_preserve_creation
before update on public.sri_authorizations
for each row execute function public.sri_preserve_creation_audit();

create table public.sri_error_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  transmission_id uuid,
  response_id uuid,
  stage text not null,
  identifier text,
  message_type text,
  message text not null,
  additional_information text,
  retryable boolean not null default false,
  created_at timestamptz not null default now(),

  constraint sri_error_messages_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint sri_error_messages_transmission_fk
    foreign key (company_id, transmission_id)
    references public.sri_transmissions(company_id, id)
    on delete cascade,
  constraint sri_error_messages_response_fk
    foreign key (company_id, response_id)
    references public.sri_responses(company_id, id)
    on delete cascade,
  constraint sri_error_messages_stage_not_blank check (btrim(stage) <> ''),
  constraint sri_error_messages_message_not_blank check (btrim(message) <> '')
);

create index sri_error_messages_document_idx
  on public.sri_error_messages (document_id, created_at desc);

create table public.electronic_document_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'USER',
  action text not null,
  old_status text,
  new_status text,
  reason text,
  sri_messages jsonb,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now(),

  constraint electronic_document_audit_logs_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint electronic_document_audit_logs_actor_type_check check (
    actor_type in ('USER', 'SYSTEM', 'SERVICE')
  ),
  constraint electronic_document_audit_logs_action_not_blank check (btrim(action) <> ''),
  constraint electronic_document_audit_logs_messages_json check (
    sri_messages is null
    or jsonb_typeof(sri_messages) in ('object', 'array')
  ),
  constraint electronic_document_audit_logs_old_values_json check (
    old_values is null or jsonb_typeof(old_values) = 'object'
  ),
  constraint electronic_document_audit_logs_new_values_json check (
    new_values is null or jsonb_typeof(new_values) = 'object'
  )
);

create index electronic_document_audit_logs_document_idx
  on public.electronic_document_audit_logs (document_id, created_at desc);
create index electronic_document_audit_logs_company_idx
  on public.electronic_document_audit_logs (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Puente contable de documentos SRI autorizados
-- ---------------------------------------------------------------------------

create table public.accounting_generation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  document_type text not null,
  sale_type text,
  customer_id uuid,
  product_id uuid,
  product_category text,
  tax_code text,
  cost_center_id uuid,
  currency text,
  country_code text,
  sales_channel text,
  debit_account_code text not null,
  credit_account_code text not null,
  tax_account_code text,
  priority integer not null default 100,
  active boolean not null default true,
  effective_from date,
  effective_until date,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounting_generation_rules_type_check check (
    document_type in ('01', '04')
  ),
  constraint accounting_generation_rules_accounts_not_blank check (
    btrim(debit_account_code) <> ''
    and btrim(credit_account_code) <> ''
    and (tax_account_code is null or btrim(tax_account_code) <> '')
  ),
  constraint accounting_generation_rules_priority_range check (
    priority between 1 and 100000
  ),
  constraint accounting_generation_rules_date_range check (
    effective_until is null
    or effective_from is null
    or effective_until >= effective_from
  )
);

create index accounting_generation_rules_resolution_idx
  on public.accounting_generation_rules (
    company_id,
    document_type,
    active,
    priority
  );

create trigger accounting_generation_rules_preserve_creation
before update on public.accounting_generation_rules
for each row execute function public.sri_preserve_creation_audit();

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  entry_number text not null,
  entry_date date not null,
  description text not null,
  status text not null default 'POSTED',
  source_type text not null default 'SRI',
  source_document_id uuid not null,
  currency text not null default 'USD',
  total_debit numeric(18, 6) not null,
  total_credit numeric(18, 6) not null,
  created_by uuid references auth.users(id) on delete set null,
  posted_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint journal_entries_company_id_id_unique unique (company_id, id),
  constraint journal_entries_number_unique unique (company_id, entry_number),
  constraint journal_entries_source_document_unique unique (source_document_id),
  constraint journal_entries_document_fk
    foreign key (company_id, source_document_id)
    references public.electronic_documents(company_id, id)
    on delete restrict,
  constraint journal_entries_description_not_blank check (btrim(description) <> ''),
  constraint journal_entries_status_check check (status in ('POSTED', 'REVERSED')),
  constraint journal_entries_source_check check (source_type = 'SRI'),
  constraint journal_entries_balanced check (
    total_debit > 0
    and total_credit > 0
    and total_debit = total_credit
  )
);

create index journal_entries_company_date_idx
  on public.journal_entries (company_id, entry_date desc, created_at desc);

create trigger journal_entries_touch_updated_at
before update on public.journal_entries
for each row execute function public.sri_touch_updated_at();

create table public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  journal_entry_id uuid not null,
  line_number integer not null,
  account_code text not null,
  description text,
  debit numeric(18, 6) not null default 0,
  credit numeric(18, 6) not null default 0,
  customer_id uuid,
  cost_center_id uuid,
  created_at timestamptz not null default now(),

  constraint journal_entry_lines_number_unique unique (journal_entry_id, line_number),
  constraint journal_entry_lines_entry_fk
    foreign key (company_id, journal_entry_id)
    references public.journal_entries(company_id, id)
    on delete cascade,
  constraint journal_entry_lines_number_positive check (line_number > 0),
  constraint journal_entry_lines_account_not_blank check (btrim(account_code) <> ''),
  constraint journal_entry_lines_one_side check (
    (debit > 0 and credit = 0)
    or (credit > 0 and debit = 0)
  )
);

create index journal_entry_lines_entry_idx
  on public.journal_entry_lines (journal_entry_id, line_number);

create table public.accounting_document_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  status text not null default 'PENDING',
  journal_entry_id uuid,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounting_document_links_document_unique unique (document_id),
  constraint accounting_document_links_company_id_id_unique unique (company_id, id),
  constraint accounting_document_links_document_fk
    foreign key (company_id, document_id)
    references public.electronic_documents(company_id, id)
    on delete cascade,
  constraint accounting_document_links_journal_fk
    foreign key (company_id, journal_entry_id)
    references public.journal_entries(company_id, id)
    on delete restrict,
  constraint accounting_document_links_status_check check (
    status in ('PENDING', 'FAILED', 'GENERATED', 'POSTED')
  ),
  constraint accounting_document_links_posted_consistency check (
    (status = 'POSTED' and journal_entry_id is not null)
    or status <> 'POSTED'
  )
);

create index accounting_document_links_company_status_idx
  on public.accounting_document_links (company_id, status, created_at desc);

create trigger accounting_document_links_touch_updated_at
before update on public.accounting_document_links
for each row execute function public.sri_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Integridad y maquina de estados
-- ---------------------------------------------------------------------------

create or replace function public.sri_validate_document_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype;
  v_expected_key text;
  v_transition_allowed boolean := false;
begin
  select *
  into v_settings
  from public.sri_settings
  where company_id = new.company_id;

  if not found
     or v_settings.environment <> 'TEST'
     or v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CONFIGURATION_REQUIRED';
  end if;

  select *
  into v_point
  from public.emission_points
  where company_id = new.company_id
    and id = new.emission_point_id;

  if not found
     or v_point.environment <> 'TEST'
     or v_point.establishment_code <> new.establishment_code
     or v_point.emission_point_code <> new.emission_point_code then
    raise exception using errcode = '23514', message = 'SRI_EMISSION_POINT_MISMATCH';
  end if;

  v_expected_key := public.sri_build_access_key(
    new.issue_date,
    new.document_type,
    v_settings.ruc,
    new.establishment_code,
    new.emission_point_code,
    new.sequential,
    new.numeric_code
  );

  if new.access_key <> v_expected_key
     or new.verification_digit <> right(v_expected_key, 1)::smallint then
    raise exception using errcode = '23514', message = 'SRI_ACCESS_KEY_INTEGRITY_ERROR';
  end if;

  if new.issuer_snapshot ->> 'ruc' is distinct from v_settings.ruc then
    raise exception using errcode = '23514', message = 'SRI_ISSUER_SNAPSHOT_RUC_MISMATCH';
  end if;

  if tg_op = 'UPDATE' then
    if new.company_id <> old.company_id
       or new.emission_point_id <> old.emission_point_id
       or new.document_type <> old.document_type
       or new.sequential <> old.sequential
       or new.numeric_code <> old.numeric_code
       or new.establishment_code <> old.establishment_code
       or new.emission_point_code <> old.emission_point_code
       or new.parent_document_id is distinct from old.parent_document_id
       or new.source_order_id is distinct from old.source_order_id
       or new.source_packing_id is distinct from old.source_packing_id
       or new.customer_id is distinct from old.customer_id
       or new.issuer_snapshot is distinct from old.issuer_snapshot
       or new.buyer_snapshot is distinct from old.buyer_snapshot
       or new.source_snapshot is distinct from old.source_snapshot then
      raise exception using errcode = '23514', message = 'SRI_DOCUMENT_IDENTITY_IS_IMMUTABLE';
    end if;

    if (
      new.issue_date <> old.issue_date
      or new.access_key <> old.access_key
      or new.verification_digit <> old.verification_digit
    ) and not (old.status = 'BORRADOR' and new.status = 'BORRADOR') then
      raise exception using errcode = '23514', message = 'SRI_ISSUE_DATE_IS_LOCKED';
    end if;

    if new.status <> old.status then
      v_transition_allowed := case old.status
        when 'BORRADOR' then new.status in ('VALIDADO', 'ANULADO')
        when 'VALIDADO' then new.status in ('XML_GENERADO', 'ANULADO')
        when 'XML_GENERADO' then new.status in ('FIRMADO', 'ANULADO')
        when 'FIRMADO' then new.status in ('ENVIADO_SRI', 'ANULADO')
        when 'ENVIADO_SRI' then new.status in (
          'RECIBIDO_SRI',
          'AUTORIZADO',
          'NO_AUTORIZADO',
          'DEVUELTO',
          'PENDIENTE_REINTENTO',
          'ERROR_ENVIO'
        )
        when 'RECIBIDO_SRI' then new.status in (
          'AUTORIZADO',
          'NO_AUTORIZADO',
          'PENDIENTE_REINTENTO',
          'ERROR_ENVIO'
        )
        when 'PENDIENTE_REINTENTO' then new.status in ('ENVIADO_SRI', 'ERROR_ENVIO')
        when 'ERROR_ENVIO' then new.status in ('PENDIENTE_REINTENTO', 'ANULADO')
        when 'DEVUELTO' then new.status in ('ANULADO')
        when 'NO_AUTORIZADO' then new.status in ('ANULADO')
        else false
      end;

      if not v_transition_allowed then
        raise exception using
          errcode = '23514',
          message = format('SRI_STATUS_TRANSITION_NOT_ALLOWED:%s->%s', old.status, new.status);
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger electronic_documents_validate_integrity
before insert or update on public.electronic_documents
for each row execute function public.sri_validate_document_integrity();

-- ---------------------------------------------------------------------------
-- RPC 1: borrador y secuencial atomico
-- ---------------------------------------------------------------------------

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
  if p_document_type not in ('01', '04', '06') then
    raise exception using errcode = '22023', message = 'SRI_DOCUMENT_TYPE_NOT_ENABLED';
  end if;
  if p_issue_date is null or p_numeric_code !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'SRI_DRAFT_IDENTIFIERS_INVALID';
  end if;
  if p_xml_version <> '1.1.0' or p_xsd_version <> '1.1.0' then
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

-- ---------------------------------------------------------------------------
-- RPC 2: transicion optimista y auditada
-- ---------------------------------------------------------------------------

create or replace function public.set_electronic_document_status(
  p_document_id uuid,
  p_expected_status text,
  p_new_status text,
  p_actor_user_id uuid,
  p_reason text,
  p_sri_messages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document public.electronic_documents%rowtype;
begin
  select *
  into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.status <> p_expected_status then
    raise exception using
      errcode = '40001',
      message = format(
        'SRI_STATUS_CONFLICT:expected=%s,actual=%s',
        p_expected_status,
        v_document.status
      );
  end if;
  if p_actor_user_id is not null
     and not exists (
       select 1
       from public.sri_company_memberships membership
       where membership.company_id = v_document.company_id
         and membership.auth_user_id = p_actor_user_id
         and membership.active
         and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
     ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_TRANSITION_DOCUMENT';
  end if;

  update public.electronic_documents
  set
    status = p_new_status,
    last_error = case
      when p_new_status in ('PENDIENTE_REINTENTO', 'ERROR_ENVIO', 'DEVUELTO', 'NO_AUTORIZADO')
        then nullif(btrim(p_reason), '')
      else null
    end,
    updated_by = p_actor_user_id
  where id = p_document_id
  returning * into v_document;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    old_status,
    new_status,
    reason,
    sri_messages
  )
  values (
    v_document.company_id,
    v_document.id,
    p_actor_user_id,
    case when p_actor_user_id is null then 'SYSTEM' else 'USER' end,
    'STATUS_CHANGED',
    p_expected_status,
    p_new_status,
    nullif(btrim(p_reason), ''),
    p_sri_messages
  );

  return to_jsonb(v_document);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC 3: refresco seguro de fecha y clave antes del XML
-- ---------------------------------------------------------------------------

create or replace function public.refresh_electronic_document_issue_date(
  p_document_id uuid,
  p_issue_date date,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document public.electronic_documents%rowtype;
  v_settings public.sri_settings%rowtype;
  v_old_date date;
  v_old_key text;
  v_new_key text;
begin
  select *
  into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;

  if not found or v_document.status <> 'BORRADOR' then
    raise exception using errcode = '23514', message = 'SRI_ONLY_DRAFT_DATE_CAN_BE_REFRESHED';
  end if;
  if p_actor_user_id is null
     or not exists (
       select 1
       from public.sri_company_memberships membership
       where membership.company_id = v_document.company_id
         and membership.auth_user_id = p_actor_user_id
         and membership.active
         and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
     ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_REFRESH_DOCUMENT';
  end if;

  select *
  into v_settings
  from public.sri_settings
  where company_id = v_document.company_id;

  v_old_date := v_document.issue_date;
  v_old_key := v_document.access_key;
  v_new_key := public.sri_build_access_key(
    p_issue_date,
    v_document.document_type,
    v_settings.ruc,
    v_document.establishment_code,
    v_document.emission_point_code,
    v_document.sequential,
    v_document.numeric_code
  );

  update public.electronic_documents
  set
    issue_date = p_issue_date,
    access_key = v_new_key,
    verification_digit = right(v_new_key, 1)::smallint,
    updated_by = p_actor_user_id,
    last_error = null
  where id = p_document_id
  returning * into v_document;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    old_status,
    new_status,
    reason,
    old_values,
    new_values
  )
  values (
    v_document.company_id,
    v_document.id,
    p_actor_user_id,
    'USER',
    'ISSUE_DATE_REFRESHED',
    'BORRADOR',
    'BORRADOR',
    'Fecha SRI ajustada antes de generar XML',
    jsonb_build_object('issue_date', v_old_date, 'access_key', v_old_key),
    jsonb_build_object('issue_date', p_issue_date, 'access_key', v_new_key)
  );

  return to_jsonb(v_document);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC 4: limite concurrente de notas de credito
-- ---------------------------------------------------------------------------

create or replace function public.validate_credit_note_amount(
  p_credit_note_id uuid,
  p_amount numeric,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credit_note public.electronic_documents%rowtype;
  v_original public.electronic_documents%rowtype;
  v_reserved numeric(18, 6);
  v_available numeric(18, 6);
begin
  select *
  into v_credit_note
  from public.electronic_documents
  where id = p_credit_note_id
    and document_type = '04'
  for update;

  if not found or v_credit_note.parent_document_id is null then
    raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_INVALID';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> v_credit_note.grand_total then
    raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_AMOUNT_INVALID';
  end if;
  if p_actor_user_id is null
     or not exists (
       select 1
       from public.sri_company_memberships membership
       where membership.company_id = v_credit_note.company_id
         and membership.auth_user_id = p_actor_user_id
         and membership.active
         and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
     ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_VALIDATE_CREDIT_NOTE';
  end if;

  select *
  into v_original
  from public.electronic_documents
  where company_id = v_credit_note.company_id
    and id = v_credit_note.parent_document_id
    and document_type = '01'
    and status = 'AUTORIZADO'
  for update;

  if not found then
    raise exception using errcode = '23514', message = 'SRI_ORIGINAL_INVOICE_NOT_AUTHORIZED';
  end if;

  select coalesce(sum(note.grand_total), 0)
  into v_reserved
  from public.electronic_documents note
  where note.company_id = v_credit_note.company_id
    and note.parent_document_id = v_original.id
    and note.document_type = '04'
    and note.id <> v_credit_note.id
    and note.status in (
      'BORRADOR',
      'VALIDADO',
      'XML_GENERADO',
      'FIRMADO',
      'ENVIADO_SRI',
      'RECIBIDO_SRI',
      'PENDIENTE_REINTENTO',
      'ERROR_ENVIO'
    );

  v_available := v_original.grand_total - v_original.credited_total - v_reserved;
  if p_amount > v_available then
    raise exception using
      errcode = '23514',
      message = 'SRI_CREDIT_NOTE_EXCEEDS_AVAILABLE_AMOUNT',
      detail = jsonb_build_object(
        'invoice_total', v_original.grand_total,
        'already_credited', v_original.credited_total,
        'reserved', v_reserved,
        'available', greatest(v_available, 0),
        'requested', p_amount
      )::text;
  end if;

  return jsonb_build_object(
    'valid', true,
    'invoice_id', v_original.id,
    'invoice_total', v_original.grand_total,
    'already_credited', v_original.credited_total,
    'reserved', v_reserved,
    'available_after', v_available - p_amount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC 5: toma atomica de trabajos de transmision
-- ---------------------------------------------------------------------------

create or replace function public.claim_sri_transmission(
  p_transmission_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transmission public.sri_transmissions%rowtype;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception using errcode = '22023', message = 'SRI_WORKER_ID_REQUIRED';
  end if;

  select *
  into v_transmission
  from public.sri_transmissions
  where id = p_transmission_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_TRANSMISSION_NOT_FOUND';
  end if;
  if v_transmission.status not in ('PENDING', 'RETRY_SCHEDULED') then
    raise exception using
      errcode = '55P03',
      message = 'SRI_TRANSMISSION_NOT_CLAIMABLE';
  end if;
  if v_transmission.next_attempt_at is not null
     and v_transmission.next_attempt_at > now() then
    raise exception using
      errcode = '55P03',
      message = 'SRI_TRANSMISSION_NOT_DUE';
  end if;
  if v_transmission.attempt_number >= v_transmission.max_attempts then
    raise exception using
      errcode = '23514',
      message = 'SRI_TRANSMISSION_ATTEMPTS_EXHAUSTED';
  end if;

  update public.sri_transmissions
  set
    status = 'PROCESSING',
    attempt_number = attempt_number + 1,
    worker_id = left(p_worker_id, 200),
    claimed_at = now(),
    finished_at = null,
    error_class = null,
    error_message = null
  where id = p_transmission_id
  returning * into v_transmission;

  return to_jsonb(v_transmission);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC 6: autorizacion oficial, terminal, idempotente y auditada
-- ---------------------------------------------------------------------------

create or replace function public.record_sri_authorization(
  p_document_id uuid,
  p_response_xml text,
  p_authorization_status text,
  p_authorization_number text,
  p_authorization_date timestamptz,
  p_environment text,
  p_authorized_xml text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document public.electronic_documents%rowtype;
  v_existing public.sri_authorizations%rowtype;
  v_target_status text;
  v_number text;
begin
  select *
  into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.environment <> 'TEST'
     or substring(v_document.access_key from 24 for 1) <> '1'
     or upper(coalesce(p_environment, '')) not in ('PRUEBAS', 'TEST', '1') then
    raise exception using errcode = '23514', message = 'SRI_AUTHORIZATION_MUST_BE_TEST';
  end if;
  if p_response_xml is null or btrim(p_response_xml) = '' then
    raise exception using errcode = '22023', message = 'SRI_AUTHORIZATION_RESPONSE_REQUIRED';
  end if;

  v_target_status := case upper(btrim(p_authorization_status))
    when 'AUTORIZADO' then 'AUTORIZADO'
    when 'NO AUTORIZADO' then 'NO_AUTORIZADO'
    when 'NO_AUTORIZADO' then 'NO_AUTORIZADO'
    else null
  end;
  if v_target_status is null then
    raise exception using errcode = '22023', message = 'SRI_AUTHORIZATION_STATUS_INVALID';
  end if;

  select *
  into v_existing
  from public.sri_authorizations
  where document_id = p_document_id
  for update;

  if found then
    if v_existing.authorization_status = (
      case
        when v_target_status = 'AUTORIZADO' then 'AUTORIZADO'
        else 'NO AUTORIZADO'
      end
    ) then
      return to_jsonb(v_document);
    end if;
    raise exception using errcode = '23514', message = 'SRI_AUTHORIZATION_IS_TERMINAL';
  end if;

  if v_document.status not in ('ENVIADO_SRI', 'RECIBIDO_SRI') then
    raise exception using
      errcode = '23514',
      message = format('SRI_AUTHORIZATION_NOT_ALLOWED_FROM:%s', v_document.status);
  end if;

  if v_target_status = 'AUTORIZADO' then
    v_number := nullif(btrim(p_authorization_number), '');
    if v_number is null
       or p_authorization_date is null
       or p_authorized_xml is null
       or btrim(p_authorized_xml) = '' then
      raise exception using errcode = '22023', message = 'SRI_AUTHORIZED_CONTENT_INCOMPLETE';
    end if;

    if v_document.document_type = '04' then
      perform 1
      from public.electronic_documents original
      where original.company_id = v_document.company_id
        and original.id = v_document.parent_document_id
        and original.document_type = '01'
        and original.status = 'AUTORIZADO'
        and original.credited_total + v_document.grand_total <= original.grand_total
      for update;

      if not found then
        raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_AUTHORIZATION_EXCEEDS_INVOICE';
      end if;

      update public.electronic_documents
      set credited_total = credited_total + v_document.grand_total
      where company_id = v_document.company_id
        and id = v_document.parent_document_id;
    end if;
  else
    v_number := null;
    p_authorization_date := null;
    p_authorized_xml := null;
  end if;

  insert into public.sri_authorizations (
    company_id,
    document_id,
    response_xml,
    authorization_status,
    authorization_number,
    authorization_date,
    environment,
    authorized_xml,
    created_by,
    updated_by
  )
  values (
    v_document.company_id,
    v_document.id,
    p_response_xml,
    case when v_target_status = 'AUTORIZADO' then 'AUTORIZADO' else 'NO AUTORIZADO' end,
    v_number,
    p_authorization_date,
    'PRUEBAS',
    p_authorized_xml,
    p_actor_user_id,
    p_actor_user_id
  );

  update public.electronic_documents
  set
    status = v_target_status,
    authorization_number = v_number,
    authorized_at = p_authorization_date,
    last_error = case
      when v_target_status = 'NO_AUTORIZADO' then 'SRI respondio NO AUTORIZADO'
      else null
    end,
    updated_by = p_actor_user_id
  where id = v_document.id
  returning * into v_document;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    old_status,
    new_status,
    reason,
    new_values
  )
  values (
    v_document.company_id,
    v_document.id,
    p_actor_user_id,
    case when p_actor_user_id is null then 'SYSTEM' else 'USER' end,
    case
      when v_target_status = 'AUTORIZADO' then 'SRI_AUTHORIZED'
      else 'SRI_NOT_AUTHORIZED'
    end,
    case
      when v_document.status = 'AUTORIZADO' then 'RECIBIDO_SRI'
      else 'RECIBIDO_SRI'
    end,
    v_target_status,
    'Respuesta oficial persistida',
    jsonb_build_object(
      'authorization_number', v_number,
      'authorization_date', p_authorization_date,
      'environment', 'PRUEBAS'
    )
  );

  return to_jsonb(v_document);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC 7: asiento idempotente despues de AUTORIZADO
-- ---------------------------------------------------------------------------

create or replace function public.generate_sri_accounting_entry(
  p_document_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document public.electronic_documents%rowtype;
  v_link public.accounting_document_links%rowtype;
  v_rule public.accounting_generation_rules%rowtype;
  v_entry public.journal_entries%rowtype;
  v_net numeric(18, 6);
  v_sale_type text;
  v_country_code text;
  v_sales_channel text;
  v_lines jsonb;
begin
  select *
  into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;

  if not found
     or v_document.status <> 'AUTORIZADO'
     or v_document.document_type not in ('01', '04') then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_REQUIRES_AUTHORIZED_FINANCIAL_DOCUMENT';
  end if;

  select *
  into v_link
  from public.accounting_document_links
  where document_id = p_document_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_ACCOUNTING_LINK_NOT_FOUND';
  end if;
  if v_link.status = 'POSTED' and v_link.journal_entry_id is not null then
    select *
    into v_entry
    from public.journal_entries
    where id = v_link.journal_entry_id;

    select coalesce(jsonb_agg(to_jsonb(entry_line) order by entry_line.line_number), '[]'::jsonb)
    into v_lines
    from public.journal_entry_lines entry_line
    where entry_line.journal_entry_id = v_entry.id;

    return to_jsonb(v_entry) || jsonb_build_object('journal_entry_lines', v_lines);
  end if;

  v_sale_type := upper(coalesce(
    v_document.source_snapshot #>> '{invoice,commerceType}',
    v_document.source_snapshot ->> 'saleType',
    ''
  ));
  v_country_code := upper(coalesce(
    v_document.source_snapshot #>> '{invoice,destinationCountryCode}',
    v_document.source_snapshot #>> '{buyer,countryCode}',
    ''
  ));
  v_sales_channel := upper(coalesce(
    v_document.source_snapshot #>> '{invoice,salesChannel}',
    v_document.source_snapshot ->> 'salesChannel',
    ''
  ));

  select rule.*
  into v_rule
  from public.accounting_generation_rules rule
  where rule.company_id = v_document.company_id
    and rule.document_type = v_document.document_type
    and rule.active
    and (rule.effective_from is null or rule.effective_from <= v_document.issue_date)
    and (rule.effective_until is null or rule.effective_until >= v_document.issue_date)
    and (rule.customer_id is null or rule.customer_id = v_document.customer_id)
    and (rule.currency is null or upper(rule.currency) = upper(v_document.currency))
    and (rule.sale_type is null or upper(rule.sale_type) = v_sale_type)
    and (rule.country_code is null or upper(rule.country_code) = v_country_code)
    and (rule.sales_channel is null or upper(rule.sales_channel) = v_sales_channel)
    and (
      rule.product_id is null
      or exists (
        select 1
        from public.electronic_document_lines document_line
        where document_line.document_id = v_document.id
          and document_line.product_id = rule.product_id
      )
    )
    and (
      rule.product_category is null
      or exists (
        select 1
        from public.electronic_document_lines document_line
        where document_line.document_id = v_document.id
          and upper(coalesce(document_line.additional_details ->> 'productCategory', ''))
            = upper(rule.product_category)
      )
    )
    and (
      rule.tax_code is null
      or exists (
        select 1
        from public.electronic_document_taxes document_tax
        where document_tax.document_id = v_document.id
          and document_tax.tax_code = rule.tax_code
      )
    )
  order by
    rule.priority asc,
    (
      (rule.customer_id is not null)::integer
      + (rule.product_id is not null)::integer
      + (rule.product_category is not null)::integer
      + (rule.tax_code is not null)::integer
      + (rule.currency is not null)::integer
      + (rule.sale_type is not null)::integer
      + (rule.country_code is not null)::integer
      + (rule.sales_channel is not null)::integer
    ) desc,
    rule.created_at asc
  limit 1;

  if not found then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_RULE_NOT_FOUND';
  end if;
  if v_document.grand_total <= 0 then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_TOTAL_MUST_BE_POSITIVE';
  end if;
  if v_document.tax_total > 0 and v_rule.tax_account_code is null then
    raise exception using errcode = '23514', message = 'SRI_TAX_ACCOUNT_REQUIRED';
  end if;

  v_net := v_document.subtotal - v_document.discount_total;
  if v_net < 0 or v_net + v_document.tax_total <> v_document.grand_total then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_TOTALS_DO_NOT_BALANCE';
  end if;

  insert into public.journal_entries (
    company_id,
    entry_number,
    entry_date,
    description,
    status,
    source_type,
    source_document_id,
    currency,
    total_debit,
    total_credit,
    created_by,
    posted_by
  )
  values (
    v_document.company_id,
    'SRI-' || v_document.document_type || '-' || v_document.full_number,
    v_document.issue_date,
    case
      when v_document.document_type = '01' then 'Factura SRI ' || v_document.full_number
      else 'Nota de credito SRI ' || v_document.full_number
    end,
    'POSTED',
    'SRI',
    v_document.id,
    v_document.currency,
    v_document.grand_total,
    v_document.grand_total,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (source_document_id) do update
    set source_document_id = excluded.source_document_id
  returning * into v_entry;

  if not exists (
    select 1
    from public.journal_entry_lines existing_line
    where existing_line.journal_entry_id = v_entry.id
  ) then
    if v_document.document_type = '01' then
      insert into public.journal_entry_lines (
        company_id, journal_entry_id, line_number, account_code,
        description, debit, credit, customer_id, cost_center_id
      )
      values (
        v_document.company_id, v_entry.id, 1, v_rule.debit_account_code,
        'Cuenta por cobrar ' || v_document.full_number,
        v_document.grand_total, 0, v_document.customer_id, v_rule.cost_center_id
      );

      if v_net > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 2, v_rule.credit_account_code,
          'Ingreso factura ' || v_document.full_number,
          0, v_net, v_document.customer_id, v_rule.cost_center_id
        );
      end if;

      if v_document.tax_total > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 3, v_rule.tax_account_code,
          'Impuesto factura ' || v_document.full_number,
          0, v_document.tax_total, v_document.customer_id, v_rule.cost_center_id
        );
      end if;
    else
      if v_net > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 1, v_rule.credit_account_code,
          'Reversion ingreso ' || v_document.full_number,
          v_net, 0, v_document.customer_id, v_rule.cost_center_id
        );
      end if;

      if v_document.tax_total > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 2, v_rule.tax_account_code,
          'Reversion impuesto ' || v_document.full_number,
          v_document.tax_total, 0, v_document.customer_id, v_rule.cost_center_id
        );
      end if;

      insert into public.journal_entry_lines (
        company_id, journal_entry_id, line_number, account_code,
        description, debit, credit, customer_id, cost_center_id
      )
      values (
        v_document.company_id, v_entry.id, 3, v_rule.debit_account_code,
        'Disminucion cuenta por cobrar ' || v_document.full_number,
        0, v_document.grand_total, v_document.customer_id, v_rule.cost_center_id
      );
    end if;
  end if;

  update public.accounting_document_links
  set
    status = 'POSTED',
    journal_entry_id = v_entry.id,
    error_message = null
  where id = v_link.id;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    old_status,
    new_status,
    reason,
    new_values
  )
  values (
    v_document.company_id,
    v_document.id,
    p_actor_user_id,
    case when p_actor_user_id is null then 'SYSTEM' else 'USER' end,
    'ACCOUNTING_ENTRY_POSTED',
    v_document.status,
    v_document.status,
    'Asiento contable generado desde documento SRI autorizado',
    jsonb_build_object(
      'journal_entry_id', v_entry.id,
      'entry_number', v_entry.entry_number
    )
  );

  select coalesce(jsonb_agg(to_jsonb(entry_line) order by entry_line.line_number), '[]'::jsonb)
  into v_lines
  from public.journal_entry_lines entry_line
  where entry_line.journal_entry_id = v_entry.id;

  return to_jsonb(v_entry) || jsonb_build_object('journal_entry_lines', v_lines);
end;
$$;

-- ---------------------------------------------------------------------------
-- Almacenamiento privado, RLS y privilegios mínimos
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'sri-private',
  'sri-private',
  false,
  5242880,
  array[
    'application/x-pkcs12',
    'application/pkcs12',
    'application/xml',
    'text/xml',
    'application/pdf',
    'application/json'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $security$
declare
  v_table text;
  v_tables constant text[] := array[
    'sri_settings',
    'emission_points',
    'electronic_document_sequences',
    'digital_certificates',
    'electronic_documents',
    'electronic_document_lines',
    'electronic_document_taxes',
    'electronic_document_files',
    'sri_transmissions',
    'sri_transmission_attempts',
    'sri_responses',
    'sri_authorizations',
    'sri_error_messages',
    'electronic_document_audit_logs',
    'accounting_generation_rules',
    'journal_entries',
    'journal_entry_lines',
    'accounting_document_links'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.sri_is_company_member(company_id, auth.uid()))',
      v_table || '_select_member',
      v_table
    );
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
    if v_table not in ('digital_certificates', 'electronic_document_files') then
      execute format('grant select on table public.%I to authenticated', v_table);
    end if;
  end loop;
end;
$security$;

grant select (
  id, company_id, alias, certificate_serial, subject_name, subject_ruc,
  issuer_name, valid_from, valid_until, fingerprint_sha256, active,
  last_validated_at, validation_status, validation_message, created_at, updated_at
) on table public.digital_certificates to authenticated;

grant select (
  id, company_id, document_id, file_type, content_type, content_sha256,
  size_bytes, schema_version, immutable, created_by, created_at
) on table public.electronic_document_files to authenticated;

grant select on table public.sri_company_memberships to authenticated, service_role;

revoke all on function public.sri_touch_updated_at() from public, anon, authenticated;
revoke all on function public.sri_preserve_creation_audit() from public, anon, authenticated;
revoke all on function public.sri_validate_settings_company() from public, anon, authenticated;
revoke all on function public.sri_validate_document_integrity() from public, anon, authenticated;
revoke all on function public.sri_modulo11(text) from public, anon, authenticated;
revoke all on function public.sri_build_access_key(date, text, text, text, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.create_electronic_document_draft(
  uuid, uuid, text, date, text, text, text, jsonb, jsonb, jsonb,
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.set_electronic_document_status(
  uuid, text, text, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.refresh_electronic_document_issue_date(uuid, date, uuid)
  from public, anon, authenticated;
revoke all on function public.validate_credit_note_amount(uuid, numeric, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_sri_transmission(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_sri_authorization(
  uuid, text, text, text, timestamptz, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.generate_sri_accounting_entry(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.sri_is_company_member(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.sri_modulo11(text) to service_role;
grant execute on function public.sri_build_access_key(date, text, text, text, text, bigint, text)
  to service_role;
grant execute on function public.create_electronic_document_draft(
  uuid, uuid, text, date, text, text, text, jsonb, jsonb, jsonb,
  uuid, uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.set_electronic_document_status(
  uuid, text, text, uuid, text, jsonb
) to service_role;
grant execute on function public.refresh_electronic_document_issue_date(uuid, date, uuid)
  to service_role;
grant execute on function public.validate_credit_note_amount(uuid, numeric, uuid)
  to service_role;
grant execute on function public.claim_sri_transmission(uuid, text)
  to service_role;
grant execute on function public.record_sri_authorization(
  uuid, text, text, text, timestamptz, text, text, uuid
) to service_role;
grant execute on function public.generate_sri_accounting_entry(uuid, uuid)
  to service_role;

commit;
