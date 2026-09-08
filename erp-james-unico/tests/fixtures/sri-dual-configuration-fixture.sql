-- Synthetic offline fixture. Live column/check/unique/trigger and function contracts, no real rows.
create role anon; create role authenticated; create role service_role;
create schema auth;
create schema storage;
create table storage.objects(bucket_id text,name text);
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
grant usage on schema public,auth to authenticated,service_role,anon;
create table public.user_profiles(user_id uuid primary key, is_active boolean not null default true);
create table public.sri_test_apply_operations(id uuid primary key,company_id uuid,state text);
create table public.erp_entity_records(company_id uuid,entity text,record_id text,payload jsonb,version bigint default 1,deleted_at timestamptz,primary key(company_id,entity,record_id));
create table public.erp_supplier_purchase_documents(company_id uuid,purchase_document_id uuid,status text,retention_decision text,retention_status text);
create table public.erp_supplier_purchase_withholding_links(company_id uuid,purchase_document_id uuid,electronic_document_id uuid,journal_entry_id uuid,status text);
create table public.electronic_document_files(document_id uuid);
create table public.accounting_document_links(company_id uuid,document_id uuid,status text);


create table public.commercial_invoice_reservations(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"record_id" text not null,
"emission_point_id" uuid not null,
"environment" text default 'TEST'::text not null,
"document_type" text default '01'::text not null,
"establishment_code" text not null,
"emission_point_code" text not null,
"sequential" bigint not null,
"full_number" text not null,
"status" text default 'ACTIVE'::text not null,
"replaced_at" timestamp with time zone,
"consumed_at" timestamp with time zone,
"consumed_document_id" uuid,
"created_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null);

create table public.companies(
"id" uuid default gen_random_uuid() not null,
"company_key" text not null,
"company_code" text not null,
"legal_name" text not null,
"commercial_name" text not null,
"tax_id" text not null,
"sri_environment" text default 'TEST'::text not null,
"is_active" boolean default true not null,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null);

create table public.digital_certificates(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"alias" text not null,
"storage_bucket" text default 'sri-private'::text not null,
"storage_object_path" text not null,
"password_secret_name" text not null,
"certificate_serial" text,
"subject_name" text,
"subject_ruc" text not null,
"issuer_name" text,
"valid_from" timestamp with time zone,
"valid_until" timestamp with time zone,
"fingerprint_sha256" text not null,
"active" boolean default true not null,
"last_validated_at" timestamp with time zone,
"validation_status" text default 'UNVALIDATED'::text not null,
"validation_message" text,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"sri_test_apply_operation_id" uuid);

create table public.electronic_document_audit_logs(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"document_id" uuid not null,
"actor_user_id" uuid,
"actor_type" text default 'USER'::text not null,
"action" text not null,
"old_status" text,
"new_status" text,
"reason" text,
"sri_messages" jsonb,
"old_values" jsonb,
"new_values" jsonb,
"created_at" timestamp with time zone default now() not null);

create table public.electronic_document_sequences(
"company_id" uuid not null,
"emission_point_id" uuid not null,
"environment" text default 'TEST'::text not null,
"document_type" text not null,
"next_value" bigint default 1 not null,
"updated_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"sri_test_apply_operation_id" uuid);

create table public.electronic_documents(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"emission_point_id" uuid not null,
"certificate_id" uuid,
"parent_document_id" uuid,
"source_order_id" uuid,
"source_packing_id" uuid,
"customer_id" uuid,
"document_type" text not null,
"status" text default 'BORRADOR'::text not null,
"issue_date" date not null,
"environment" text default 'TEST'::text not null,
"emission_type" text default '1'::text not null,
"establishment_code" text not null,
"emission_point_code" text not null,
"sequential" bigint not null,
"sequential_text" text not null,
"full_number" text not null,
"numeric_code" text not null,
"verification_digit" smallint not null,
"access_key" text not null,
"xml_version" text not null,
"xsd_version" text not null,
"issuer_snapshot" jsonb not null,
"buyer_snapshot" jsonb default '{}'::jsonb not null,
"source_snapshot" jsonb not null,
"subtotal" numeric(18,6) default 0 not null,
"discount_total" numeric(18,6) default 0 not null,
"tax_total" numeric(18,6) default 0 not null,
"grand_total" numeric(18,6) default 0 not null,
"credited_total" numeric(18,6) default 0 not null,
"currency" text default 'USD'::text not null,
"additional_information" jsonb default '{}'::jsonb not null,
"authorization_number" text,
"authorized_at" timestamp with time zone,
"last_error" text,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null);

create table public.emission_points(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"environment" text default 'TEST'::text not null,
"establishment_code" text not null,
"emission_point_code" text not null,
"establishment_address" text not null,
"name" text,
"active" boolean default true not null,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"sri_test_apply_operation_id" uuid);

create table public.sri_authorizations(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"document_id" uuid not null,
"response_xml" text not null,
"authorization_status" text not null,
"authorization_number" text,
"authorization_date" timestamp with time zone,
"environment" text default 'PRUEBAS'::text not null,
"authorized_xml" text,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null);

create table public.sri_company_memberships(
"company_id" uuid,
"auth_user_id" uuid,
"role_code" text,
"active" boolean);

create table public.sri_settings(
"company_id" uuid not null,
"legal_name" text not null,
"commercial_name" text,
"ruc" text not null,
"head_office_address" text not null,
"accounting_required" boolean default true not null,
"special_taxpayer_number" text,
"withholding_agent_number" text,
"rimpe_label" text,
"environment" text default 'TEST'::text not null,
"emission_type" text default '1'::text not null,
"production_enabled" boolean default false not null,
"immediate_transmission" boolean default true not null,
"invoice_xml_version" text default '1.1.0'::text not null,
"credit_note_xml_version" text default '1.1.0'::text not null,
"delivery_guide_xml_version" text default '1.1.0'::text not null,
"technical_spec_version" text default '2.33'::text not null,
"technical_spec_date" date default '2026-07-13'::date not null,
"reception_test_url" text default 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'::text not null,
"authorization_test_url" text default 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'::text not null,
"retry_initial_seconds" integer default 30 not null,
"retry_max_seconds" integer default 1800 not null,
"retry_max_attempts" integer default 12 not null,
"xml_ride_emails" text[] default '{}'::text[] not null,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"withholding_xml_version" text default '2.0.0'::text not null,
"test_enabled" boolean default false not null,
"sri_test_apply_operation_id" uuid);

create table public.sri_transmission_attempts(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"document_id" uuid not null,
"transmission_id" uuid not null,
"attempt_number" integer not null,
"status" text default 'STARTED'::text not null,
"endpoint_url" text not null,
"request_sha256" text not null,
"response_sha256" text,
"http_status" integer,
"retryable" boolean,
"error_class" text,
"error_message" text,
"started_at" timestamp with time zone default now() not null,
"finished_at" timestamp with time zone,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null);

create table public.sri_transmissions(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"document_id" uuid not null,
"transmission_type" text not null,
"environment" text default 'TEST'::text not null,
"endpoint_url" text not null,
"status" text default 'PENDING'::text not null,
"idempotency_key" text not null,
"attempt_number" integer default 0 not null,
"max_attempts" integer default 12 not null,
"request_file_id" uuid,
"next_attempt_at" timestamp with time zone,
"worker_id" text,
"claimed_at" timestamp with time zone,
"http_status" integer,
"error_class" text,
"error_message" text,
"finished_at" timestamp with time zone,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null);

create table public.user_company_memberships(
"id" uuid default gen_random_uuid() not null,
"company_id" uuid not null,
"user_id" uuid not null,
"membership_role" text default 'VIEWER'::text not null,
"membership_status" text default 'ACTIVE'::text not null,
"is_default" boolean default false not null,
"display_name_override" text,
"area" text,
"job_title" text,
"notes" text,
"valid_from" date,
"valid_until" date,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null);

alter table public.sri_settings add constraint sri_settings_address_not_blank CHECK ((btrim(head_office_address) <> ''::text));

alter table public.sri_settings add constraint sri_settings_environment_check CHECK ((environment = ANY (ARRAY['TEST'::text, 'PRODUCTION'::text])));

alter table public.sri_settings add constraint sri_settings_immediate_transmission CHECK ((immediate_transmission = true));

alter table public.sri_settings add constraint sri_settings_legal_name_not_blank CHECK ((btrim(legal_name) <> ''::text));

alter table public.sri_settings add constraint sri_settings_normal_emission_only CHECK ((emission_type = '1'::text));

alter table public.sri_settings add constraint sri_settings_official_test_endpoints CHECK (((reception_test_url = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'::text) AND (authorization_test_url = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'::text)));

alter table public.sri_settings add constraint sri_settings_pkey PRIMARY KEY (company_id);

alter table public.sri_settings add constraint sri_settings_production_gate CHECK (((environment = 'PRODUCTION'::text) OR (production_enabled = false)));

alter table public.sri_settings add constraint sri_settings_retry_range CHECK ((((retry_initial_seconds >= 5) AND (retry_initial_seconds <= 3600)) AND ((retry_max_seconds >= retry_initial_seconds) AND (retry_max_seconds <= 86400)) AND ((retry_max_attempts >= 1) AND (retry_max_attempts <= 100))));

alter table public.sri_settings add constraint sri_settings_ruc_format CHECK ((ruc ~ '^[0-9]{13}$'::text));

alter table public.sri_settings add constraint sri_settings_ruc_unique UNIQUE (ruc);

alter table public.sri_settings add constraint sri_settings_supported_versions CHECK (((invoice_xml_version = '1.1.0'::text) AND (credit_note_xml_version = '1.1.0'::text) AND (delivery_guide_xml_version = '1.1.0'::text) AND (withholding_xml_version = '2.0.0'::text) AND (technical_spec_version = '2.34'::text)));

alter table public.emission_points add constraint emission_points_address_not_blank CHECK ((btrim(establishment_address) <> ''::text));

alter table public.emission_points add constraint emission_points_business_key_unique UNIQUE (company_id, environment, establishment_code, emission_point_code);

alter table public.emission_points add constraint emission_points_company_id_id_environment_unique UNIQUE (company_id, id, environment);

alter table public.emission_points add constraint emission_points_company_id_id_unique UNIQUE (company_id, id);

alter table public.emission_points add constraint emission_points_environment_check CHECK ((environment = ANY (ARRAY['TEST'::text, 'PRODUCTION'::text])));

alter table public.emission_points add constraint emission_points_establishment_format CHECK ((establishment_code ~ '^[0-9]{3}$'::text));

alter table public.emission_points add constraint emission_points_pkey PRIMARY KEY (id);

alter table public.emission_points add constraint emission_points_point_format CHECK ((emission_point_code ~ '^[0-9]{3}$'::text));

alter table public.electronic_document_sequences add constraint electronic_document_sequences_environment_check CHECK ((environment = ANY (ARRAY['TEST'::text, 'PRODUCTION'::text])));

alter table public.electronic_document_sequences add constraint electronic_document_sequences_pkey PRIMARY KEY (company_id, emission_point_id, environment, document_type);

alter table public.electronic_document_sequences add constraint electronic_document_sequences_range CHECK (((next_value >= 1) AND (next_value <= 1000000000)));

alter table public.electronic_document_sequences add constraint electronic_document_sequences_type_check CHECK ((document_type = ANY (ARRAY['01'::text, '04'::text, '06'::text, '07'::text])));

alter table public.digital_certificates add constraint digital_certificates_alias_not_blank CHECK ((btrim(alias) <> ''::text));

alter table public.digital_certificates add constraint digital_certificates_bucket_private CHECK ((storage_bucket = 'sri-private'::text));

alter table public.digital_certificates add constraint digital_certificates_company_id_id_unique UNIQUE (company_id, id);

alter table public.digital_certificates add constraint digital_certificates_fingerprint_format CHECK ((fingerprint_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table public.digital_certificates add constraint digital_certificates_fingerprint_unique UNIQUE (company_id, fingerprint_sha256);

alter table public.digital_certificates add constraint digital_certificates_path_scope CHECK ((storage_object_path ~ (('^companies/'::text || (company_id)::text) || '/certificates/[0-9a-f]{64}[.]p12$'::text)));

alter table public.digital_certificates add constraint digital_certificates_pkey PRIMARY KEY (id);

alter table public.digital_certificates add constraint digital_certificates_ruc_format CHECK ((subject_ruc ~ '^[0-9]{13}$'::text));

alter table public.digital_certificates add constraint digital_certificates_secret_name CHECK ((password_secret_name ~ '^SRI_P12_PASSWORD_[A-Z0-9_]{1,96}$'::text));

alter table public.digital_certificates add constraint digital_certificates_storage_path_unique UNIQUE (storage_bucket, storage_object_path);

alter table public.digital_certificates add constraint digital_certificates_validation_status CHECK ((validation_status = ANY (ARRAY['UNVALIDATED'::text, 'VALID'::text, 'INVALID'::text, 'EXPIRED'::text, 'RUC_MISMATCH'::text])));

alter table public.digital_certificates add constraint digital_certificates_validity_range CHECK (((valid_until IS NULL) OR (valid_from IS NULL) OR (valid_until > valid_from)));

alter table public.electronic_documents add constraint electronic_documents_access_key_unique UNIQUE (access_key);

alter table public.electronic_documents add constraint electronic_documents_authorization_consistency CHECK ((((status = 'AUTORIZADO'::text) AND (authorization_number IS NOT NULL) AND (btrim(authorization_number) <> ''::text) AND (authorized_at IS NOT NULL)) OR ((status <> 'AUTORIZADO'::text) AND ((authorization_number IS NULL) OR (btrim(authorization_number) <> ''::text)))));

alter table public.electronic_documents add constraint electronic_documents_codes_format CHECK (((establishment_code ~ '^[0-9]{3}$'::text) AND (emission_point_code ~ '^[0-9]{3}$'::text) AND ((sequential >= 1) AND (sequential <= 999999999)) AND (sequential_text = lpad((sequential)::text, 9, '0'::text)) AND (numeric_code ~ '^[0-9]{8}$'::text) AND ((verification_digit >= 0) AND (verification_digit <= 9)) AND (access_key ~ '^[0-9]{49}$'::text) AND ("right"(access_key, 1) = (verification_digit)::text) AND (full_number = ((((establishment_code || '-'::text) || emission_point_code) || '-'::text) || sequential_text))));

alter table public.electronic_documents add constraint electronic_documents_company_id_id_unique UNIQUE (company_id, id);

alter table public.electronic_documents add constraint electronic_documents_environment_access_key_check CHECK ((((environment = 'TEST'::text) AND (SUBSTRING(access_key FROM 24 FOR 1) = '1'::text)) OR ((environment = 'PRODUCTION'::text) AND (SUBSTRING(access_key FROM 24 FOR 1) = '2'::text))));

alter table public.electronic_documents add constraint electronic_documents_full_number_environment_unique UNIQUE (company_id, environment, document_type, full_number);

alter table public.electronic_documents add constraint electronic_documents_json_objects CHECK (((jsonb_typeof(issuer_snapshot) = 'object'::text) AND (jsonb_typeof(buyer_snapshot) = 'object'::text) AND (jsonb_typeof(source_snapshot) = 'object'::text) AND (jsonb_typeof(additional_information) = 'object'::text)));

alter table public.electronic_documents add constraint electronic_documents_nonnegative_totals CHECK (((subtotal >= (0)::numeric) AND (discount_total >= (0)::numeric) AND (tax_total >= (0)::numeric) AND (grand_total >= (0)::numeric) AND (credited_total >= (0)::numeric) AND (credited_total <= grand_total)));

alter table public.electronic_documents add constraint electronic_documents_normal_emission_only CHECK ((emission_type = '1'::text));

alter table public.electronic_documents add constraint electronic_documents_parent_required CHECK ((((document_type = '04'::text) AND (parent_document_id IS NOT NULL)) OR ((document_type <> '04'::text) AND (parent_document_id IS NULL))));

alter table public.electronic_documents add constraint electronic_documents_pkey PRIMARY KEY (id);

alter table public.electronic_documents add constraint electronic_documents_sequence_unique UNIQUE (company_id, environment, establishment_code, emission_point_code, document_type, sequential);

alter table public.electronic_documents add constraint electronic_documents_status_check CHECK ((status = ANY (ARRAY['BORRADOR'::text, 'VALIDADO'::text, 'XML_GENERADO'::text, 'FIRMADO'::text, 'ENVIADO_SRI'::text, 'RECIBIDO_SRI'::text, 'AUTORIZADO'::text, 'NO_AUTORIZADO'::text, 'DEVUELTO'::text, 'PENDIENTE_REINTENTO'::text, 'ERROR_ENVIO'::text, 'ANULADO'::text])));

alter table public.electronic_documents add constraint electronic_documents_supported_xml CHECK ((((document_type = ANY (ARRAY['01'::text, '04'::text, '06'::text])) AND (xml_version = '1.1.0'::text) AND (xsd_version = '1.1.0'::text)) OR ((document_type = '07'::text) AND (xml_version = '2.0.0'::text) AND (xsd_version = '2.0.0'::text))));

alter table public.electronic_documents add constraint electronic_documents_type_check CHECK ((document_type = ANY (ARRAY['01'::text, '04'::text, '06'::text, '07'::text])));

alter table public.sri_transmissions add constraint sri_transmissions_attempt_range CHECK ((((attempt_number >= 0) AND (attempt_number <= max_attempts)) AND ((max_attempts >= 1) AND (max_attempts <= 100))));

alter table public.sri_transmissions add constraint sri_transmissions_company_id_id_unique UNIQUE (company_id, id);

alter table public.sri_transmissions add constraint sri_transmissions_document_type_unique UNIQUE (document_id, transmission_type);

alter table public.sri_transmissions add constraint sri_transmissions_environment_check CHECK ((environment = ANY (ARRAY['TEST'::text, 'PRODUCTION'::text])));

alter table public.sri_transmissions add constraint sri_transmissions_http_status_range CHECK (((http_status IS NULL) OR ((http_status >= 100) AND (http_status <= 599))));

alter table public.sri_transmissions add constraint sri_transmissions_idempotency_unique UNIQUE (idempotency_key);

alter table public.sri_transmissions add constraint sri_transmissions_official_endpoint_only CHECK ((((environment = 'TEST'::text) AND (((transmission_type = 'RECEPTION'::text) AND (endpoint_url = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'::text)) OR ((transmission_type = 'AUTHORIZATION_QUERY'::text) AND (endpoint_url = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'::text)))) OR ((environment = 'PRODUCTION'::text) AND (((transmission_type = 'RECEPTION'::text) AND (endpoint_url = 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline'::text)) OR ((transmission_type = 'AUTHORIZATION_QUERY'::text) AND (endpoint_url = 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'::text))))));

alter table public.sri_transmissions add constraint sri_transmissions_pkey PRIMARY KEY (id);

alter table public.sri_transmissions add constraint sri_transmissions_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'RETRY_SCHEDULED'::text, 'FAILED'::text, 'COMPLETED'::text, 'RECEIVED'::text])));

alter table public.sri_transmissions add constraint sri_transmissions_type_check CHECK ((transmission_type = ANY (ARRAY['RECEPTION'::text, 'AUTHORIZATION_QUERY'::text])));

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_finished_range CHECK (((finished_at IS NULL) OR (finished_at >= started_at)));

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_http_status_range CHECK (((http_status IS NULL) OR ((http_status >= 100) AND (http_status <= 599))));

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_number_positive CHECK ((attempt_number > 0));

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_number_unique UNIQUE (transmission_id, attempt_number);

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_pkey PRIMARY KEY (id);

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_request_hash CHECK ((request_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_response_hash CHECK (((response_sha256 IS NULL) OR (response_sha256 ~ '^[0-9a-f]{64}$'::text)));

alter table public.sri_transmission_attempts add constraint sri_transmission_attempts_status_check CHECK ((status = ANY (ARRAY['STARTED'::text, 'SUCCEEDED'::text, 'RETRY_SCHEDULED'::text, 'FAILED'::text])));

alter table public.sri_authorizations add constraint sri_authorizations_content_consistency CHECK ((((authorization_status = 'AUTORIZADO'::text) AND (authorization_number IS NOT NULL) AND (btrim(authorization_number) <> ''::text) AND (authorization_date IS NOT NULL) AND (authorized_xml IS NOT NULL) AND (btrim(authorized_xml) <> ''::text)) OR ((authorization_status = 'NO AUTORIZADO'::text) AND (authorization_number IS NULL) AND (authorization_date IS NULL) AND (authorized_xml IS NULL))));

alter table public.sri_authorizations add constraint sri_authorizations_document_unique UNIQUE (document_id);

alter table public.sri_authorizations add constraint sri_authorizations_environment_check CHECK ((translate(upper(btrim(environment)), 'Ó'::text, 'O'::text) = ANY (ARRAY['PRUEBAS'::text, 'TEST'::text, '1'::text, 'PRODUCCION'::text, 'PRODUCTION'::text, '2'::text])));

alter table public.sri_authorizations add constraint sri_authorizations_pkey PRIMARY KEY (id);

alter table public.sri_authorizations add constraint sri_authorizations_response_not_blank CHECK ((btrim(response_xml) <> ''::text));

alter table public.sri_authorizations add constraint sri_authorizations_status_check CHECK ((authorization_status = ANY (ARRAY['AUTORIZADO'::text, 'NO AUTORIZADO'::text])));

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservation_full_number_environment_unique UNIQUE (company_id, environment, document_type, full_number);

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservation_full_number_format CHECK ((full_number = ((((establishment_code || '-'::text) || emission_point_code) || '-'::text) || lpad((sequential)::text, 9, '0'::text))));

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservation_sequence_unique UNIQUE (company_id, emission_point_id, environment, document_type, sequential);

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_document_type_check CHECK ((document_type = '01'::text));

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_emission_point_code_check CHECK ((emission_point_code ~ '^[0-9]{3}$'::text));

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_environment_check CHECK ((environment = ANY (ARRAY['TEST'::text, 'PRODUCTION'::text])));

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_establishment_code_check CHECK ((establishment_code ~ '^[0-9]{3}$'::text));

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_pkey PRIMARY KEY (id);

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_sequential_check CHECK (((sequential >= 1) AND (sequential <= 999999999)));

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REPLACED'::text, 'CONSUMED'::text])));

alter table public.companies add primary key(id); alter table public.user_company_memberships add unique(company_id,user_id);

alter table public.electronic_document_sequences add constraint electronic_document_sequences_point_environment_fk FOREIGN KEY (company_id, emission_point_id, environment) REFERENCES emission_points(company_id, id, environment) ON DELETE RESTRICT;

alter table public.electronic_documents add constraint electronic_documents_point_environment_fk FOREIGN KEY (company_id, emission_point_id, environment) REFERENCES emission_points(company_id, id, environment) ON DELETE RESTRICT;

alter table public.commercial_invoice_reservations add constraint commercial_invoice_reservations_point_environment_fk FOREIGN KEY (company_id, emission_point_id, environment) REFERENCES emission_points(company_id, id, environment) ON DELETE RESTRICT;

create table if not exists public.erp_operations_commands (
  operation_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  command_type text not null,
  source_record_id text,
  request_payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','ERROR')),
  user_id uuid not null references auth.users(id),
  device_id text not null,
  local_created_at timestamptz not null,
  server_created_at timestamptz not null default now()
);



create table public.erp_security_capabilities (
  capability_id text primary key,
  module text not null,
  resource text not null,
  action text not null,
  risk_level text not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint erp_security_capability_id_format check (
    capability_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$'
    and capability_id !~ '[*]'
  ),
  constraint erp_security_capability_parts check (
    capability_id = module || '.' || resource || '.' || action
  ),
  constraint erp_security_capability_module_format check (module ~ '^[a-z][a-z0-9_]*$'),
  constraint erp_security_capability_resource_format check (resource ~ '^[a-z][a-z0-9_]*$'),
  constraint erp_security_capability_action_format check (action ~ '^[a-z][a-z0-9_]*$'),
  constraint erp_security_capability_risk check (
    risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  ),
  constraint erp_security_capability_description_not_blank check (btrim(description) <> '')
);

create table public.erp_security_profiles (
  profile_id text primary key,
  display_name text not null,
  description text not null,
  active boolean not null default true,
  system_defined boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint erp_security_profile_id_format check (profile_id ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint erp_security_profile_display_not_blank check (btrim(display_name) <> ''),
  constraint erp_security_profile_description_not_blank check (btrim(description) <> '')
);

create table public.erp_security_profile_capabilities (
  profile_id text not null references public.erp_security_profiles(profile_id) on delete cascade,
  capability_id text not null references public.erp_security_capabilities(capability_id) on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default clock_timestamp(),
  primary key (profile_id, capability_id)
);

create table public.erp_security_user_company_profiles (
  company_id uuid not null,
  user_id uuid not null,
  profile_id text not null references public.erp_security_profiles(profile_id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_id, user_id),
  constraint erp_security_user_company_profile_membership_fk
    foreign key (company_id, user_id)
    references public.user_company_memberships(company_id, user_id)
    on delete cascade
);

create table public.erp_security_user_capability_overrides (
  company_id uuid not null,
  user_id uuid not null,
  capability_id text not null references public.erp_security_capabilities(capability_id) on delete restrict,
  effect text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default clock_timestamp(),
  primary key (company_id, user_id, capability_id),
  constraint erp_security_override_membership_fk
    foreign key (company_id, user_id)
    references public.user_company_memberships(company_id, user_id)
    on delete cascade,
  constraint erp_security_override_effect check (effect in ('GRANT', 'DENY')),
  constraint erp_security_override_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint erp_security_override_reason_not_blank check (reason is null or btrim(reason) <> '')
);

create table public.erp_security_engine_state (
  singleton_key text primary key default 'GLOBAL',
  catalog_version bigint not null default 1 check (catalog_version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  constraint erp_security_engine_singleton check (singleton_key = 'GLOBAL')
);

create table public.erp_security_permission_versions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  permissions_version bigint not null default 1 check (permissions_version > 0),
  updated_at timestamptz not null default clock_timestamp()
);

create index erp_security_capabilities_module_resource_idx
  on public.erp_security_capabilities(module, resource, action)
  where active;
create index erp_security_profile_capabilities_capability_idx
  on public.erp_security_profile_capabilities(capability_id, profile_id);
create index erp_security_user_profiles_profile_idx
  on public.erp_security_user_company_profiles(profile_id, company_id);
create index erp_security_user_overrides_user_idx
  on public.erp_security_user_capability_overrides(user_id, company_id, effect);

comment on table public.erp_security_capabilities is
  'U2C1 exact capability catalog. Wildcards and implicit all-access entries are forbidden.';
comment on table public.erp_security_profiles is
  'U2C1 base security profiles. Membership roles remain separate from functional capabilities.';
comment on table public.erp_security_profile_capabilities is
  'Explicit default grants only. Missing capability means default deny.';
comment on table public.erp_security_user_company_profiles is
  'One base profile per user and company. No global functional role is stored on user_profiles.';
comment on table public.erp_security_user_capability_overrides is
  'Exact user/company GRANT or DENY override. The primary key forbids contradictory effective rows.';
comment on table public.erp_security_engine_state is
  'Global catalog/profile version for future bounded capability-cache invalidation.';
comment on table public.erp_security_permission_versions is
  'Company-scoped permission version. It never authorizes access by itself.';

with capability_families(module, resource, actions) as (
  values
    ('core','dashboard','{"view":"LOW"}'::jsonb),
    ('admin','diagnostics','{"view":"MEDIUM"}'::jsonb),
    ('admin','company_state','{"view":"LOW","edit":"HIGH"}'::jsonb),
    ('operations','dashboard','{"view":"LOW"}'::jsonb),
    ('operations','parameters','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('operations','reception','{"view":"LOW","create":"MEDIUM","edit":"MEDIUM","cancel":"HIGH"}'::jsonb),
    ('operations','classification','{"view":"LOW","record":"MEDIUM","edit":"MEDIUM"}'::jsonb),
    ('operations','labels','{"view":"LOW","create":"MEDIUM","reprint":"MEDIUM"}'::jsonb),
    ('operations','bunch_intake','{"view":"LOW","receive":"HIGH","reassign":"HIGH"}'::jsonb),
    ('operations','destination_orders','{"confirm":"HIGH"}'::jsonb),
    ('operations','boxes','{"create":"HIGH","scan":"HIGH","close":"HIGH","reopen":"HIGH","unassign":"HIGH","release_order":"CRITICAL","cancel_order":"CRITICAL"}'::jsonb),
    ('operations','inventory','{"view":"LOW"}'::jsonb),
    ('operations','availability','{"view":"LOW"}'::jsonb),
    ('operations','yields','{"view":"LOW"}'::jsonb),
    ('operations','cold_room','{"view":"LOW","prepare":"HIGH","confirm_dispatch":"CRITICAL"}'::jsonb),
    ('commercial','dashboard','{"view":"LOW"}'::jsonb),
    ('commercial','orders','{"view":"LOW","create":"MEDIUM","edit":"MEDIUM","cancel":"HIGH"}'::jsonb),
    ('commercial','coordination','{"view":"LOW","edit":"MEDIUM"}'::jsonb),
    ('commercial','preorders','{"view":"LOW","create":"MEDIUM","edit":"MEDIUM","cancel":"HIGH"}'::jsonb),
    ('commercial','availability','{"view":"LOW","reserve":"HIGH","release":"HIGH"}'::jsonb),
    ('commercial','customers','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','brands','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','cargo_agencies','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','countries','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','daes','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('commercial','airlines','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','export_products','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','box_types','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','exports','{"view":"LOW","create":"HIGH","edit":"HIGH","transition":"HIGH"}'::jsonb),
    ('commercial','senae_liquidation','{"view":"LOW","generate":"CRITICAL"}'::jsonb),
    ('commercial','credit_notes','{"view":"LOW","create":"HIGH","post":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('commercial','electronic_documents','{"view":"LOW","create":"CRITICAL","authorize":"CRITICAL","correct":"CRITICAL","annul":"CRITICAL"}'::jsonb),
    ('commercial','route_sheet','{"print":"MEDIUM"}'::jsonb),
    ('payroll','employees','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('payroll','roles','{"view":"LOW","calculate":"HIGH","approve":"CRITICAL","post":"CRITICAL","print":"MEDIUM"}'::jsonb),
    ('payroll','performance_policies','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('payroll','accounting_settings','{"view":"LOW","manage":"CRITICAL"}'::jsonb),
    ('accounting','chart','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('accounting','sales','{"view":"LOW","post":"CRITICAL"}'::jsonb),
    ('accounting','journal','{"view":"LOW","post":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('accounting','ledger','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('accounting','financial_statements','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('accounting','costs','{"record":"HIGH"}'::jsonb),
    ('accounting','shipment_expenses','{"record":"HIGH"}'::jsonb),
    ('purchases','documents','{"view":"LOW","import":"MEDIUM","create":"MEDIUM","post":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('purchases','providers','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('purchases','settlements','{"view":"LOW","create":"HIGH","reverse":"HIGH"}'::jsonb),
    ('purchases','withholdings','{"view":"LOW","create":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('purchases','retention_report','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('purchases','tax_supports','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('portfolio','suppliers','{"view":"LOW"}'::jsonb),
    ('portfolio','customers','{"view":"LOW"}'::jsonb),
    ('portfolio','payables','{"view":"LOW"}'::jsonb),
    ('portfolio','receivables','{"view":"LOW"}'::jsonb),
    ('treasury','payments','{"view":"LOW","create":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('treasury','collections','{"view":"LOW","create":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('treasury','accounts','{"view":"LOW","manage":"CRITICAL"}'::jsonb),
    ('treasury','movements','{"view":"LOW","create":"HIGH","adjust":"HIGH","reverse":"CRITICAL"}'::jsonb),
    ('treasury','reconciliation','{"view":"LOW","import":"HIGH","save":"HIGH","execute":"CRITICAL","review":"HIGH","reverse":"CRITICAL","set_status":"HIGH"}'::jsonb),
    ('treasury','cash_accounts','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('treasury','transfers','{"view":"LOW","create":"CRITICAL"}'::jsonb),
    ('treasury','cash_flow','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('tax','parameters','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('tax','retention_parameters','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('tax','received_withholdings','{"view":"LOW","import":"HIGH"}'::jsonb),
    ('tax','ats','{"view":"LOW","generate":"CRITICAL","export":"HIGH"}'::jsonb),
    ('inventory','summary','{"view":"LOW"}'::jsonb),
    ('inventory','purchase_entries','{"view":"LOW"}'::jsonb),
    ('inventory','kardex','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('inventory','consumptions','{"view":"LOW","create":"HIGH","reverse":"HIGH"}'::jsonb),
    ('inventory','adjustments','{"view":"LOW","create":"HIGH","approve":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('reports','dashboard','{"view":"LOW"}'::jsonb),
    ('reports','accounting','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','tax','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','portfolio','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','banks','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','inventory','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','commercial','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('admin','company','{"view":"LOW","manage":"CRITICAL"}'::jsonb),
    ('admin','users','{"view":"HIGH","manage":"CRITICAL"}'::jsonb),
    ('admin','audit','{"view":"HIGH","export":"HIGH"}'::jsonb),
    ('admin','sequences','{"view":"HIGH","manage":"CRITICAL"}'::jsonb),
    ('admin','cost_centers','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('admin','synchronization','{"view":"HIGH","manage":"CRITICAL"}'::jsonb)
)
insert into public.erp_security_capabilities(
  capability_id, module, resource, action, risk_level, description
)
select
  f.module || '.' || f.resource || '.' || action_entry.key,
  f.module,
  f.resource,
  action_entry.key,
  action_entry.value,
  'U2B2 capability: ' || f.module || '.' || f.resource || '.' || action_entry.key
from capability_families f
cross join lateral jsonb_each_text(f.actions) action_entry;

insert into public.erp_security_profiles(profile_id, display_name, description)
values
  ('DIRECCION','DirecciÃ³n','VisiÃ³n ejecutiva principalmente de lectura, reportes y exportaciÃ³n.'),
  ('COMERCIAL','Comercial','GestiÃ³n comercial operativa con privilegio mÃ­nimo.'),
  ('COORDINACION','CoordinaciÃ³n','CoordinaciÃ³n logÃ­stica y exportadora, separada de autorizaciÃ³n tributaria.'),
  ('RECEPCION','RecepciÃ³n','RecepciÃ³n operativa de flor.'),
  ('CLASIFICACION','ClasificaciÃ³n','ClasificaciÃ³n y rendimiento operativo.'),
  ('EMBONCHE_ZEBRA','Embonche / Zebra','Embonche, etiquetas Zebra e ingreso operativo.'),
  ('BODEGA_CUARTO_FRIO','Bodega / Cuarto frÃ­o','PreparaciÃ³n de bodega y cuarto frÃ­o.'),
  ('DESPACHO','Despacho','ConfirmaciÃ³n controlada de despacho y lectura relacionada.'),
  ('COMPRAS','Compras','Documentos de compra y proveedores, sin pagos implÃ­citos.'),
  ('CONTABILIDAD','Contabilidad','ContabilizaciÃ³n, libros y reportes contables.'),
  ('FINANZAS_TREASURY','Finanzas / Treasury','Pagos, cobros, bancos, transferencias y conciliaciÃ³n.'),
  ('TRIBUTACION_SRI','TributaciÃ³n / SRI','Documentos electrÃ³nicos y obligaciones tributarias.'),
  ('INVENTARIO_MATERIALES','Inventario de materiales','KÃ¡rdex, consumos y ajustes administrativos.'),
  ('NOMINA','NÃ³mina','NÃ³mina con coexistencia del guard probado actual.'),
  ('ADMINISTRADOR_ERP','Administrador ERP','AdministraciÃ³n tÃ©cnica sin privilegios financieros implÃ­citos.'),
  ('AUDITORIA_SOPORTE','AuditorÃ­a / Soporte','Lectura, diagnÃ³stico y exportaciÃ³n sin mutaciones de negocio.');

create temporary table u2c1_profile_grants (
  profile_id text not null,
  capability_id text not null,
  primary key(profile_id, capability_id)
) on commit drop;

-- DIRECCION: broad read/report visibility, excluding technical and payroll-maintenance details.
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'DIRECCION', capability_id
from public.erp_security_capabilities
where action = 'view'
  and capability_id !~ '^(admin\.(diagnostics|company_state|company|users|sequences|cost_centers|synchronization)|payroll\.(employees|performance_policies|accounting_settings))\.';
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'DIRECCION', unnest(array[
  'reports.accounting.export','reports.tax.export','reports.portfolio.export',
  'reports.banks.export','reports.inventory.export','reports.commercial.export',
  'accounting.ledger.export','accounting.financial_statements.export',
  'purchases.retention_report.export','treasury.cash_flow.export','tax.ats.export',
  'inventory.kardex.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'COMERCIAL', unnest(array[
  'core.dashboard.view','commercial.dashboard.view','commercial.orders.view',
  'commercial.orders.create','commercial.orders.edit','commercial.preorders.view',
  'commercial.preorders.create','commercial.preorders.edit','commercial.availability.view',
  'commercial.availability.reserve','commercial.availability.release','commercial.customers.view',
  'commercial.customers.manage','commercial.brands.view','commercial.brands.manage',
  'commercial.cargo_agencies.view','commercial.countries.view','commercial.daes.view',
  'commercial.airlines.view','commercial.export_products.view','commercial.box_types.view',
  'commercial.exports.view','operations.availability.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'COORDINACION', unnest(array[
  'core.dashboard.view','commercial.dashboard.view','commercial.orders.view',
  'commercial.coordination.view','commercial.coordination.edit','commercial.preorders.view',
  'commercial.availability.view','commercial.customers.view','commercial.brands.view',
  'commercial.cargo_agencies.view','commercial.cargo_agencies.manage','commercial.countries.view',
  'commercial.countries.manage','commercial.daes.view','commercial.daes.manage',
  'commercial.airlines.view','commercial.airlines.manage','commercial.export_products.view',
  'commercial.box_types.view','commercial.exports.view','commercial.exports.create',
  'commercial.exports.edit','commercial.exports.transition','commercial.route_sheet.print',
  'operations.availability.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'RECEPCION', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.reception.view','operations.reception.create','operations.reception.edit',
  'operations.yields.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'CLASIFICACION', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.reception.view','operations.classification.view','operations.classification.record',
  'operations.classification.edit','operations.yields.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'EMBONCHE_ZEBRA', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.labels.view','operations.labels.create','operations.labels.reprint',
  'operations.bunch_intake.view','operations.bunch_intake.receive',
  'operations.bunch_intake.reassign','operations.inventory.view','operations.availability.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'BODEGA_CUARTO_FRIO', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.labels.view','operations.bunch_intake.view','operations.inventory.view',
  'operations.availability.view','operations.cold_room.view','operations.cold_room.prepare',
  'operations.destination_orders.confirm','operations.boxes.create','operations.boxes.scan',
  'operations.boxes.close','operations.boxes.reopen','operations.boxes.unassign',
  'operations.boxes.release_order','commercial.orders.view','commercial.availability.view',
  'commercial.availability.reserve'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'DESPACHO', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.inventory.view',
  'operations.availability.view','operations.cold_room.view','operations.cold_room.prepare',
  'operations.cold_room.confirm_dispatch','commercial.orders.view',
  'commercial.coordination.view','commercial.exports.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'COMPRAS', unnest(array[
  'core.dashboard.view','purchases.documents.view','purchases.documents.import',
  'purchases.documents.create','purchases.documents.post','purchases.providers.view',
  'purchases.providers.manage','purchases.settlements.view','purchases.settlements.create',
  'purchases.withholdings.view','purchases.withholdings.create',
  'purchases.retention_report.view','purchases.retention_report.export',
  'purchases.tax_supports.view','portfolio.suppliers.view','portfolio.payables.view',
  'inventory.purchase_entries.view','reports.portfolio.view','reports.tax.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'CONTABILIDAD', unnest(array[
  'core.dashboard.view','accounting.chart.view','accounting.chart.manage',
  'accounting.sales.view','accounting.sales.post','accounting.journal.view',
  'accounting.journal.post','accounting.ledger.view','accounting.ledger.export',
  'accounting.financial_statements.view','accounting.financial_statements.export',
  'accounting.costs.record','accounting.shipment_expenses.record','purchases.documents.view',
  'purchases.withholdings.view','purchases.retention_report.view',
  'purchases.retention_report.export','portfolio.suppliers.view','portfolio.customers.view',
  'portfolio.payables.view','portfolio.receivables.view','treasury.payments.view',
  'treasury.collections.view','tax.received_withholdings.view','tax.ats.view',
  'reports.dashboard.view','reports.accounting.view','reports.accounting.export',
  'reports.tax.view','reports.tax.export','reports.portfolio.view','reports.portfolio.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'FINANZAS_TREASURY', unnest(array[
  'core.dashboard.view','portfolio.suppliers.view','portfolio.customers.view',
  'portfolio.payables.view','portfolio.receivables.view','treasury.payments.view',
  'treasury.payments.create','treasury.collections.view','treasury.collections.create',
  'treasury.accounts.view','treasury.accounts.manage','treasury.movements.view',
  'treasury.movements.create','treasury.movements.adjust','treasury.reconciliation.view',
  'treasury.reconciliation.import','treasury.reconciliation.save',
  'treasury.reconciliation.execute','treasury.reconciliation.review',
  'treasury.reconciliation.set_status','treasury.cash_accounts.view',
  'treasury.cash_accounts.manage','treasury.transfers.view','treasury.transfers.create',
  'treasury.cash_flow.view','treasury.cash_flow.export','accounting.journal.view',
  'accounting.ledger.view','reports.dashboard.view','reports.portfolio.view',
  'reports.portfolio.export','reports.banks.view','reports.banks.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'TRIBUTACION_SRI', unnest(array[
  'core.dashboard.view','commercial.orders.view','commercial.credit_notes.view',
  'commercial.credit_notes.create','commercial.credit_notes.post',
  'commercial.electronic_documents.view','commercial.electronic_documents.create',
  'commercial.electronic_documents.authorize','commercial.electronic_documents.correct',
  'commercial.senae_liquidation.view','commercial.senae_liquidation.generate',
  'purchases.documents.view','purchases.withholdings.view','purchases.withholdings.create',
  'purchases.retention_report.view','purchases.retention_report.export','tax.parameters.view',
  'tax.parameters.manage','tax.retention_parameters.view','tax.retention_parameters.manage',
  'tax.received_withholdings.view','tax.received_withholdings.import','tax.ats.view',
  'tax.ats.generate','tax.ats.export','accounting.sales.view','accounting.journal.view',
  'reports.tax.view','reports.tax.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'INVENTARIO_MATERIALES', unnest(array[
  'core.dashboard.view','inventory.summary.view','inventory.purchase_entries.view',
  'inventory.kardex.view','inventory.kardex.export','inventory.consumptions.view',
  'inventory.consumptions.create','inventory.adjustments.view',
  'inventory.adjustments.create','reports.inventory.view','reports.inventory.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'NOMINA', unnest(array[
  'core.dashboard.view','payroll.employees.view','payroll.employees.manage',
  'payroll.roles.view','payroll.roles.calculate','payroll.roles.approve',
  'payroll.roles.post','payroll.roles.print','payroll.performance_policies.view',
  'payroll.performance_policies.manage','payroll.accounting_settings.view',
  'payroll.accounting_settings.manage'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'ADMINISTRADOR_ERP', unnest(array[
  'core.dashboard.view','admin.diagnostics.view','admin.company_state.view',
  'admin.company_state.edit','admin.company.view','admin.company.manage',
  'admin.users.view','admin.users.manage','admin.audit.view','admin.audit.export',
  'admin.sequences.view','admin.cost_centers.view','admin.cost_centers.manage',
  'admin.synchronization.view','admin.synchronization.manage'
]);

-- AUDITORIA_SOPORTE: read/diagnostic/export only; no business mutations.
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'AUDITORIA_SOPORTE', capability_id
from public.erp_security_capabilities
where action = 'view'
  and capability_id !~ '^(admin\.(company_state|company|sequences|cost_centers|synchronization)|payroll\.(employees|performance_policies|accounting_settings))\.';
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'AUDITORIA_SOPORTE', unnest(array[
  'admin.audit.export','reports.accounting.export','reports.tax.export',
  'reports.portfolio.export','reports.banks.export','reports.inventory.export',
  'reports.commercial.export','accounting.ledger.export',
  'accounting.financial_statements.export','purchases.retention_report.export',
  'treasury.cash_flow.export','tax.ats.export','inventory.kardex.export'
]);

do $$
declare
  v_capabilities integer;
  v_views integer;
  v_actions integer;
  v_high_critical integer;
  v_profiles integer;
  v_wildcards integer;
  v_sensitive_grants integer;
  v_bad_profile text;
begin
  select count(*), count(*) filter(where action = 'view'), count(*) filter(where action <> 'view'),
         count(*) filter(where risk_level in ('HIGH','CRITICAL'))
  into v_capabilities, v_views, v_actions, v_high_critical
  from public.erp_security_capabilities;
  select count(*) into v_profiles from public.erp_security_profiles;
  select count(*) into v_wildcards from public.erp_security_capabilities where capability_id like '%*%';

  if (v_capabilities, v_views, v_actions, v_high_critical, v_profiles, v_wildcards)
     <> (195, 79, 116, 85, 16, 0) then
    raise exception 'U2C1_CATALOG_MATRIX_MISMATCH: capabilities=%, views=%, actions=%, high_critical=%, profiles=%, wildcards=%',
      v_capabilities, v_views, v_actions, v_high_critical, v_profiles, v_wildcards;
  end if;

  select count(*) into v_sensitive_grants
  from pg_temp.u2c1_profile_grants
  where capability_id = any(array[
    'operations.parameters.manage','operations.reception.cancel','operations.boxes.cancel_order',
    'commercial.orders.cancel','commercial.preorders.cancel','commercial.export_products.manage',
    'commercial.box_types.manage','commercial.credit_notes.reverse',
    'commercial.electronic_documents.annul','accounting.journal.reverse',
    'purchases.documents.reverse','purchases.settlements.reverse',
    'purchases.withholdings.reverse','purchases.tax_supports.manage',
    'treasury.payments.reverse','treasury.collections.reverse','treasury.movements.reverse',
    'treasury.reconciliation.reverse','inventory.consumptions.reverse',
    'inventory.adjustments.approve','inventory.adjustments.reverse','admin.sequences.manage'
  ]);
  if v_sensitive_grants <> 0 then
    raise exception 'U2C1_SENSITIVE_BASE_GRANT_MISMATCH: %', v_sensitive_grants;
  end if;

  with expected(profile_id, grant_count) as (
    values
      ('DIRECCION',81),('COMERCIAL',23),('COORDINACION',25),('RECEPCION',7),
      ('CLASIFICACION',8),('EMBONCHE_ZEBRA',11),('BODEGA_CUARTO_FRIO',19),
      ('DESPACHO',10),('COMPRAS',19),('CONTABILIDAD',32),('FINANZAS_TREASURY',33),
      ('TRIBUTACION_SRI',29),('INVENTARIO_MATERIALES',11),('NOMINA',12),
      ('ADMINISTRADOR_ERP',15),('AUDITORIA_SOPORTE',84)
  ), actual as (
    select profile_id, count(*)::integer grant_count
    from pg_temp.u2c1_profile_grants
    group by profile_id
  )
  select expected.profile_id into v_bad_profile
  from expected
  left join actual using(profile_id)
  where coalesce(actual.grant_count, -1) <> expected.grant_count
  limit 1;
  if v_bad_profile is not null then
    raise exception 'U2C1_PROFILE_GRANT_COUNT_MISMATCH: %', v_bad_profile;
  end if;

  if exists (
    select 1 from pg_temp.u2c1_profile_grants g
    left join public.erp_security_profiles p using(profile_id)
    left join public.erp_security_capabilities c using(capability_id)
    where p.profile_id is null or c.capability_id is null or not c.active
  ) then
    raise exception 'U2C1_UNKNOWN_OR_INACTIVE_GRANT';
  end if;
end;
$$;

insert into public.erp_security_profile_capabilities(profile_id, capability_id)
select profile_id, capability_id
from pg_temp.u2c1_profile_grants;



insert into public.erp_security_engine_state(singleton_key,catalog_version) values('GLOBAL',1);

CREATE OR REPLACE FUNCTION public.erp_is_company_member(p_company_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (
      p_user_id = auth.uid()
      or coalesce(auth.role()::text, '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin')
    )
    and exists (
      select 1
      from public.user_company_memberships m
      join public.user_profiles p on p.user_id = m.user_id
      join public.companies c on c.id = m.company_id
      where m.company_id = p_company_id
        and m.user_id = p_user_id
        and m.membership_status = 'ACTIVE'
        and (m.valid_from is null or m.valid_from <= current_date)
        and (m.valid_until is null or m.valid_until >= current_date)
        and p.is_active
        and c.is_active
    );
$function$
;

create or replace function public.erp_u2a_assert_company_read_access(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_company_id is null then
    raise exception using errcode = '22023', message = 'COMPANY_ID_REQUIRED';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATED_USER_REQUIRED';
  end if;
  if not public.erp_is_company_member(p_company_id, v_actor) then
    raise exception using errcode = '42501', message = 'COMPANY_MEMBERSHIP_REQUIRED';
  end if;
  return v_actor;
end;
$$;

create or replace function public.erp_security_get_effective_capabilities(p_company_id uuid)
returns table(
  capability_id text,
  module text,
  resource text,
  action text,
  risk_level text,
  description text,
  permission_source text,
  catalog_version bigint,
  company_version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_assigned_profile text;
  v_assigned_profile_active boolean;
begin
  v_actor := public.erp_u2a_assert_company_read_access(p_company_id);

  select ucp.profile_id, p.active
  into v_assigned_profile, v_assigned_profile_active
  from public.erp_security_user_company_profiles ucp
  join public.erp_security_profiles p on p.profile_id = ucp.profile_id
  where ucp.company_id = p_company_id
    and ucp.user_id = v_actor;

  -- An explicitly assigned but inactive profile is an absolute deny.
  if v_assigned_profile is not null and not coalesce(v_assigned_profile_active, false) then
    return;
  end if;

  return query
  with profile_allowed as (
    select pc.capability_id, 1 as source_priority, 'PROFILE'::text as source_name
    from public.erp_security_profile_capabilities pc
    where pc.profile_id = v_assigned_profile
  ), user_allowed as (
    select o.capability_id, 2 as source_priority, 'USER_GRANT'::text as source_name
    from public.erp_security_user_capability_overrides o
    where o.company_id = p_company_id
      and o.user_id = v_actor
      and o.effect = 'GRANT'
  ), candidates as (
    select * from profile_allowed
    union all
    select * from user_allowed
  ), selected as (
    select distinct on (candidate.capability_id)
      candidate.capability_id,
      candidate.source_name
    from candidates candidate
    where not exists (
      select 1
      from public.erp_security_user_capability_overrides denied
      where denied.company_id = p_company_id
        and denied.user_id = v_actor
        and denied.capability_id = candidate.capability_id
        and denied.effect = 'DENY'
    )
    order by candidate.capability_id, candidate.source_priority desc
  )
  select
    capability.capability_id,
    capability.module,
    capability.resource,
    capability.action,
    capability.risk_level,
    capability.description,
    selected.source_name,
    engine.catalog_version,
    coalesce(company_version.permissions_version, 1)
  from selected
  join public.erp_security_capabilities capability
    on capability.capability_id = selected.capability_id
   and capability.active
  cross join public.erp_security_engine_state engine
  left join public.erp_security_permission_versions company_version
    on company_version.company_id = p_company_id
  where engine.singleton_key = 'GLOBAL'
  order by capability.capability_id;
end;
$$;

create or replace function public.erp_security_has_capability(
  p_company_id uuid,
  p_capability_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null or p_capability_id is null or btrim(p_capability_id) = '' then
    return false;
  end if;
  return exists (
    select 1
    from public.erp_security_get_effective_capabilities(p_company_id) effective
    where effective.capability_id = p_capability_id
  );
exception
  when sqlstate '42501' or sqlstate '22023' then
    return false;
end;
$$;

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

create function public.erp_u2c3_authorized_companies(p_capability_ids text[])
returns table(company_id uuid)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select membership.company_id
  from public.user_company_memberships membership
  where membership.user_id=auth.uid()
    and membership.membership_status='ACTIVE'
    and (membership.valid_from is null or membership.valid_from<=current_date)
    and (membership.valid_until is null or membership.valid_until>=current_date)
    and exists(
      select 1
      from public.erp_security_get_effective_capabilities(membership.company_id) effective
      where effective.capability_id=any(coalesce(p_capability_ids,array[]::text[]))
    )
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
  if p_document_type not in ('01', '04', '06', '07') then
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

CREATE OR REPLACE FUNCTION public.claim_sri_transmission(p_transmission_id uuid, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sri_validate_settings_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company public.companies%rowtype;
begin
  select * into v_company
  from public.companies
  where id = new.company_id;

  if not found or not v_company.is_active then
    raise exception using errcode = '23514', message = 'SRI_COMPANY_NOT_ACTIVE';
  end if;
  if v_company.tax_id <> new.ruc then
    raise exception using errcode = '23514', message = 'SRI_RUC_DOES_NOT_MATCH_COMPANY';
  end if;
  if new.environment not in ('TEST', 'PRODUCTION')
     or v_company.sri_environment not in ('TEST', 'PRODUCTION')
     or new.environment <> v_company.sri_environment then
    raise exception using errcode = '23514', message = 'SRI_COMPANY_ENVIRONMENT_MISMATCH';
  end if;
  if new.environment = 'TEST' and new.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sri_is_company_member(p_company_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.sri_company_memberships membership
    where membership.company_id = p_company_id
      and membership.auth_user_id = p_user_id
      and membership.active
  );
$function$
;

CREATE OR REPLACE FUNCTION public.record_sri_authorization(p_document_id uuid, p_response_xml text, p_authorization_status text, p_authorization_number text, p_authorization_date timestamp with time zone, p_environment text, p_authorized_xml text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  perform public.sri_assert_authorization_environment(
    v_document.company_id, v_document.environment, v_document.access_key, p_environment
  );
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
        and original.environment = v_document.environment
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
    public.sri_assert_authorization_environment(
      v_document.company_id, v_document.environment, v_document.access_key, p_environment
    ),
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
      'environment', public.sri_assert_authorization_environment(
        v_document.company_id, v_document.environment, v_document.access_key, p_environment
      )
    )
  );

  return to_jsonb(v_document);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_electronic_document_issue_date(p_document_id uuid, p_issue_date date, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if not found
     or v_settings.environment not in ('TEST', 'PRODUCTION')
     or v_settings.environment <> v_document.environment then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;

  v_old_date := v_document.issue_date;
  v_old_key := v_document.access_key;
  v_new_key := public.sri_build_access_key(
    p_issue_date,
    v_document.document_type,
    v_settings.ruc,
    v_document.environment,
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
$function$
;

CREATE OR REPLACE FUNCTION public.sri_assert_authorization_environment(p_company_id uuid, p_document_environment text, p_access_key text, p_response_environment text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_response text := translate(upper(btrim(coalesce(p_response_environment, ''))), 'Ó', 'O');
  v_expected_digit text;
begin
  select * into v_settings
  from public.sri_settings
  where company_id = p_company_id;
  if not found
     or p_document_environment not in ('TEST', 'PRODUCTION')
     or v_settings.environment <> p_document_environment then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;
  v_expected_digit := case p_document_environment when 'TEST' then '1' else '2' end;
  if substring(p_access_key from 24 for 1) <> v_expected_digit then
    raise exception using errcode = '23514', message = 'SRI_ACCESS_KEY_ENVIRONMENT_MISMATCH';
  end if;
  if (p_document_environment = 'TEST' and v_response not in ('PRUEBAS', 'TEST', '1'))
     or (p_document_environment = 'PRODUCTION' and v_response not in ('PRODUCCION', 'PRODUCTION', '2')) then
    raise exception using errcode = '23514', message = 'SRI_AUTHORIZATION_ENVIRONMENT_MISMATCH';
  end if;
  if p_document_environment = 'PRODUCTION' and not v_settings.production_enabled then
    raise exception using errcode = '42501', message = 'SRI_PRODUCTION_TRANSMISSION_DISABLED';
  end if;
  return case p_document_environment when 'TEST' then 'PRUEBAS' else 'PRODUCCION' end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sri_validate_authorization_environment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_document public.electronic_documents%rowtype;
begin
  select * into v_document
  from public.electronic_documents
  where company_id = new.company_id and id = new.document_id;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_AUTHORIZATION_DOCUMENT_NOT_FOUND';
  end if;
  new.environment := public.sri_assert_authorization_environment(
    new.company_id, v_document.environment, v_document.access_key, new.environment
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sri_validate_transmission_environment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_document_environment text;
begin
  select * into v_settings
  from public.sri_settings
  where company_id = new.company_id;
  select environment into v_document_environment
  from public.electronic_documents
  where company_id = new.company_id and id = new.document_id;
  if v_settings.company_id is null
     or v_document_environment is null
     or v_settings.environment not in ('TEST', 'PRODUCTION')
     or new.environment <> v_settings.environment
     or v_document_environment <> new.environment then
    raise exception using errcode = '23514', message = 'SRI_TRANSMISSION_ENVIRONMENT_MISMATCH';
  end if;
  if new.environment = 'PRODUCTION' and not v_settings.production_enabled then
    raise exception using errcode = '42501', message = 'SRI_PRODUCTION_TRANSMISSION_DISABLED';
  end if;
  if new.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sri_validate_document_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_address_source jsonb;
  v_point public.emission_points%rowtype;
  v_original public.electronic_documents%rowtype;
  v_expected_key text;
  v_transition_allowed boolean := false;
  v_recovery_query boolean := coalesce(current_setting('app.sri_recovery_query', true), '') = 'on';
  v_registered_annulment boolean := coalesce(current_setting('app.sri_registered_annulment', true), '') = 'on';
begin
  select * into v_settings from public.sri_settings where company_id = new.company_id;
  if not found
     or v_settings.environment not in ('TEST', 'PRODUCTION')
     or new.environment <> v_settings.environment then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;
  if v_settings.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;

  select * into v_point
  from public.emission_points
  where company_id = new.company_id and id = new.emission_point_id;
  if not found
     or v_point.environment <> new.environment
     or v_point.establishment_code <> new.establishment_code
     or v_point.emission_point_code <> new.emission_point_code then
    raise exception using errcode = '23514', message = 'SRI_EMISSION_POINT_MISMATCH';
  end if;

  v_expected_key := public.sri_build_access_key(
    new.issue_date,
    new.document_type,
    v_settings.ruc,
    new.environment,
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

  -- Enforce original-point identity on every new NC, including direct inserts.
  -- Existing documents and later status updates retain their established history.
  if tg_op = 'INSERT' and new.document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = new.company_id and id = new.parent_document_id
      and environment = new.environment and document_type = '01'
      and status = 'AUTORIZADO' for share;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
    if new.emission_point_id is distinct from v_original.emission_point_id
      or new.establishment_code is distinct from v_original.establishment_code
      or new.emission_point_code is distinct from v_original.emission_point_code then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.buyer_snapshot is distinct from old.buyer_snapshot
      or new.source_snapshot is distinct from old.source_snapshot then
      v_address_source := public.sri_draft_buyer_address_source(old);
      if (to_jsonb(new) - array['buyer_snapshot','source_snapshot','updated_at','updated_by'])
          is distinct from (to_jsonb(old) - array['buyer_snapshot','source_snapshot','updated_at','updated_by'])
        or new.updated_by is distinct from auth.uid()
        or new.buyer_snapshot is distinct from jsonb_set(old.buyer_snapshot,'{address}',v_address_source->'address')
        or new.source_snapshot is distinct from jsonb_set(old.source_snapshot,'{buyer,address}',v_address_source->'address') then
        raise exception using errcode='23514',message='SRI_DOCUMENT_IDENTITY_IS_IMMUTABLE';
      end if;
      insert into public.electronic_document_audit_logs(
        company_id,document_id,actor_user_id,actor_type,action,old_status,new_status,reason,old_values,new_values
      ) values (
        old.company_id,old.id,auth.uid(),'USER','DRAFT_BUYER_ADDRESS_REFRESHED',old.status,new.status,
        'Direccion del comprador recuperada de cliente canonico antes de generar XML',
        jsonb_build_object('buyer_address',old.buyer_snapshot->'address','source_address',old.source_snapshot#>'{buyer,address}'),
        v_address_source || jsonb_build_object('document_id',old.id,'sequential',old.sequential,'access_key_preserved',true)
      );
    end if;
    if new.company_id <> old.company_id
       or new.emission_point_id <> old.emission_point_id
       or new.environment <> old.environment
       or new.document_type <> old.document_type
       or new.sequential <> old.sequential
       or new.numeric_code <> old.numeric_code
       or new.establishment_code <> old.establishment_code
       or new.emission_point_code <> old.emission_point_code
       or new.parent_document_id is distinct from old.parent_document_id
       or new.source_order_id is distinct from old.source_order_id
       or new.source_packing_id is distinct from old.source_packing_id
       or new.customer_id is distinct from old.customer_id
       or new.issuer_snapshot is distinct from old.issuer_snapshot then
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
          'RECIBIDO_SRI', 'AUTORIZADO', 'NO_AUTORIZADO', 'DEVUELTO',
          'PENDIENTE_REINTENTO', 'ERROR_ENVIO'
        )
        when 'RECIBIDO_SRI' then new.status in (
          'AUTORIZADO', 'NO_AUTORIZADO', 'PENDIENTE_REINTENTO', 'ERROR_ENVIO'
        )
        when 'PENDIENTE_REINTENTO' then new.status in ('ENVIADO_SRI', 'ERROR_ENVIO')
        when 'ERROR_ENVIO' then new.status in ('PENDIENTE_REINTENTO', 'ANULADO')
        when 'DEVUELTO' then new.status in ('ANULADO')
          or (v_recovery_query and new.status in ('AUTORIZADO', 'NO_AUTORIZADO'))
        when 'NO_AUTORIZADO' then new.status in ('ANULADO')
          or (v_recovery_query and new.status in ('AUTORIZADO'))
        when 'AUTORIZADO' then v_registered_annulment and new.status = 'ANULADO'
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_sri_recovery_authorization(p_document_id uuid, p_response_xml text, p_authorization_status text, p_authorization_number text, p_authorization_date timestamp with time zone, p_environment text, p_authorized_xml text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_document public.electronic_documents%rowtype;
  v_old_status text;
  v_target_status text;
  v_number text;
  v_identifier text;
begin
  select * into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  v_old_status := v_document.status;
  if v_document.document_type <> '01'
     or v_document.status not in ('DEVUELTO', 'NO_AUTORIZADO') then
    raise exception using errcode = '23514', message = 'SRI_RECOVERY_QUERY_NOT_ALLOWED';
  end if;
  perform public.sri_assert_authorization_environment(
    v_document.company_id, v_document.environment, v_document.access_key, p_environment
  );
  if p_actor_user_id is null or not exists (
    select 1 from public.sri_company_memberships membership
    where membership.company_id = v_document.company_id
      and membership.auth_user_id = p_actor_user_id
      and membership.active
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_RECOVER_DOCUMENT';
  end if;
  select regexp_replace(coalesce(error.identifier, ''), '\D', '', 'g')
  into v_identifier
  from public.sri_error_messages error
  where error.document_id = v_document.id
  order by error.created_at desc
  limit 1;
  if coalesce(v_identifier, '') not in ('43', '45', '70') then
    raise exception using errcode = '23514', message = 'SRI_RECOVERY_QUERY_REQUIRES_CODE_43_45_OR_70';
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
  if v_target_status = 'AUTORIZADO' then
    v_number := nullif(btrim(p_authorization_number), '');
    if v_number is null
       or p_authorization_date is null
       or p_authorized_xml is null
       or btrim(p_authorized_xml) = '' then
      raise exception using errcode = '22023', message = 'SRI_AUTHORIZED_CONTENT_INCOMPLETE';
    end if;
  else
    v_number := null;
    p_authorization_date := null;
    p_authorized_xml := null;
  end if;

  perform set_config('app.sri_recovery_query', 'on', true);
  insert into public.sri_authorizations (
    company_id, document_id, response_xml, authorization_status,
    authorization_number, authorization_date, environment, authorized_xml,
    created_by, updated_by
  ) values (
    v_document.company_id, v_document.id, p_response_xml,
    case when v_target_status = 'AUTORIZADO' then 'AUTORIZADO' else 'NO AUTORIZADO' end,
    v_number, p_authorization_date, public.sri_assert_authorization_environment(
      v_document.company_id, v_document.environment, v_document.access_key, p_environment
    ), p_authorized_xml,
    p_actor_user_id, p_actor_user_id
  )
  on conflict (document_id) do update set
    response_xml = excluded.response_xml,
    authorization_status = excluded.authorization_status,
    authorization_number = excluded.authorization_number,
    authorization_date = excluded.authorization_date,
    environment = excluded.environment,
    authorized_xml = excluded.authorized_xml,
    updated_by = excluded.updated_by,
    updated_at = now();

  update public.electronic_documents
  set status = v_target_status,
      authorization_number = v_number,
      authorized_at = p_authorization_date,
      last_error = case when v_target_status = 'AUTORIZADO' then null else last_error end,
      updated_by = p_actor_user_id
  where id = v_document.id
  returning * into v_document;

  insert into public.electronic_document_audit_logs (
    company_id, document_id, actor_user_id, actor_type, action,
    old_status, new_status, reason, new_values
  ) values (
    v_document.company_id, v_document.id, p_actor_user_id, 'USER',
    'SRI_RECOVERY_AUTHORIZATION_QUERY', v_old_status, v_target_status,
    'Consulta explícita de autorización con la misma clave de acceso',
    jsonb_build_object(
      'access_key', v_document.access_key,
      'identifier', v_identifier,
      'authorization_number', v_number,
      'authorization_date', p_authorization_date
    )
  );
  return to_jsonb(v_document);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_electronic_document_draft_u2a_internal(p_company_id uuid, p_emission_point_id uuid, p_document_type text, p_issue_date date, p_numeric_code text, p_xml_version text, p_xsd_version text, p_issuer_snapshot jsonb, p_buyer_snapshot jsonb, p_source_snapshot jsonb, p_source_order_id uuid, p_source_packing_id uuid, p_customer_id uuid, p_parent_document_id uuid, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype;
  v_original public.electronic_documents%rowtype;
  v_reservation public.commercial_invoice_reservations%rowtype;
  v_source_record_id text := coalesce(
    nullif(btrim(p_source_snapshot #>> '{erpEmission,sourceOrderId}'), ''),
    p_source_order_id::text,
    case when nullif(btrim(p_source_snapshot #>> '{erpEmission,idempotencyKey}'), '') is not null
      then 'SRI-IDEMP:' || btrim(p_source_snapshot #>> '{erpEmission,idempotencyKey}') end
  );
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
      where company_id = p_company_id and id = v_link.electronic_document_id and document_type = '07'
        and environment = (select environment from public.sri_settings where company_id = p_company_id);
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

  if p_document_type = '07' and v_purchase_id is not null then
    perform public.erp_purchase_withholding_assert_accounts(p_company_id, p_issue_date, p_source_snapshot);
  end if;

  select * into v_settings from public.sri_settings
  where company_id = p_company_id for update;
  if not found or v_settings.environment not in ('TEST', 'PRODUCTION') or not v_settings.immediate_transmission then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_REQUIRED';
  end if;
  if v_settings.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;

  -- Fail before touching tax counters, reservations or documents.
  if v_settings.environment = 'PRODUCTION' and not v_settings.production_enabled then
    raise exception using errcode = '42501', message = 'SRI_PRODUCTION_DOCUMENT_CREATION_DISABLED';
  end if;
  if p_document_type = '01' and (v_source_record_id is null or length(v_source_record_id) > 240) then
    raise exception using errcode = '22023', message = 'SRI_INVOICE_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  if p_document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = p_company_id and id = p_parent_document_id
      and environment = v_settings.environment
      and document_type = '01' and status = 'AUTORIZADO' for update;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
    if p_emission_point_id is distinct from v_original.emission_point_id then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
    end if;
    p_emission_point_id := v_original.emission_point_id;
  elsif p_parent_document_id is not null then
    raise exception using errcode = '23514', message = 'SRI_PARENT_ONLY_ALLOWED_FOR_CREDIT_NOTE';
  end if;

  -- A credit note derives its point from the locked canonical original invoice.
  -- Reject stale/client overrides before any sequence row is created or incremented.
  select * into v_point from public.emission_points
  where company_id = p_company_id
    and id = case when p_document_type = '04' then v_original.emission_point_id else p_emission_point_id end
    and environment = v_settings.environment and active for update;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_ACTIVE_EMISSION_POINT_REQUIRED';
  end if;
  if p_document_type = '04' and (
    v_point.establishment_code is distinct from v_original.establishment_code
    or v_point.emission_point_code is distinct from v_original.emission_point_code
  ) then
    raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
  end if;

  if p_document_type = '01' and v_source_record_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      p_company_id::text || ':SRI_INVOICE:' || v_settings.environment || ':' || v_source_record_id, 0));
    select * into v_reservation
    from public.commercial_invoice_reservations reservation
    where reservation.company_id = p_company_id
      and reservation.record_id = v_source_record_id
      and reservation.environment = v_settings.environment
      and reservation.document_type = '01'
      and reservation.status in ('ACTIVE', 'CONSUMED')
    order by reservation.created_at desc
    limit 1
    for update;
    if found and v_reservation.emission_point_id <> p_emission_point_id then
      raise exception using errcode = '23514', message = 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT';
    end if;
    if found and v_reservation.status = 'CONSUMED' and v_reservation.consumed_document_id is not null then
      select * into v_document from public.electronic_documents
      where company_id = p_company_id and id = v_reservation.consumed_document_id
        and environment = v_settings.environment;
      if found then
        return to_jsonb(v_document) || jsonb_build_object('_reservation_reused', true);
      end if;
      raise exception using errcode = '23514', message = 'SRI_INVOICE_IDEMPOTENCY_DOCUMENT_MISSING';
    end if;
  end if;

  if v_reservation.id is not null and v_reservation.status = 'ACTIVE' then
    v_sequential := v_reservation.sequential;
  else
    insert into public.electronic_document_sequences(
      company_id, emission_point_id, environment, document_type, next_value, updated_by
    ) values (
      p_company_id, p_emission_point_id, v_settings.environment, p_document_type, 1, p_created_by
    ) on conflict (company_id, emission_point_id, environment, document_type) do nothing;
    select sequence_row.next_value into v_sequential
    from public.electronic_document_sequences sequence_row
    where sequence_row.company_id = p_company_id
      and sequence_row.emission_point_id = p_emission_point_id
      and sequence_row.environment = v_settings.environment
      and sequence_row.document_type = p_document_type
    for update;
    if v_sequential > 999999999 then
      raise exception using errcode = '22003', message = 'SRI_SEQUENTIAL_EXHAUSTED';
    end if;
    update public.electronic_document_sequences
    set next_value = v_sequential + 1, updated_by = p_created_by
    where company_id = p_company_id
      and emission_point_id = p_emission_point_id
      and environment = v_settings.environment
      and document_type = p_document_type;
  end if;

  -- The invoice reservation now belongs to document generation, in this transaction.
  if p_document_type = '01' and v_reservation.id is null then
    insert into public.commercial_invoice_reservations(
      company_id,record_id,emission_point_id,environment,document_type,
      establishment_code,emission_point_code,sequential,full_number,status,created_by
    ) values (
      p_company_id,v_source_record_id,p_emission_point_id,v_settings.environment,'01',
      v_point.establishment_code,v_point.emission_point_code,v_sequential,
      v_point.establishment_code || '-' || v_point.emission_point_code || '-' || lpad(v_sequential::text,9,'0'),
      'ACTIVE',p_created_by
    ) returning * into v_reservation;
  end if;

  v_access_key := public.sri_build_access_key(
    p_issue_date, p_document_type, v_settings.ruc, v_settings.environment,
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
    v_settings.environment, '1', v_point.establishment_code, v_point.emission_point_code,
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
      when v_reservation.id is not null then 'Borrador SRI creado con reserva idempotente de factura'
      else 'Borrador SRI creado con secuencial atomico'
    end,
    jsonb_build_object(
      'full_number', v_document.full_number,
      'access_key', v_document.access_key,
      'environment', v_settings.environment,
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
$function$
;

CREATE OR REPLACE FUNCTION public.sri_test_enabled_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare enabled boolean; begin
 if new.environment='TEST' then
   select test_enabled into enabled from sri_settings where company_id=new.company_id;
   if coalesce(enabled,false)=false then
     if tg_table_name='electronic_document_sequences' and tg_op='INSERT' then
       if new.next_value=1 and exists(select 1 from sri_test_apply_operations where id=new.sri_test_apply_operation_id and company_id=new.company_id and state='PREPARING') then return new;end if;
     end if;
     raise exception 'SRI_TEST_DISABLED';
   end if;
 end if;return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_electronic_document_draft_u2c3_internal(p_company_id uuid, p_emission_point_id uuid, p_document_type text, p_issue_date date, p_numeric_code text, p_xml_version text, p_xsd_version text, p_issuer_snapshot jsonb, p_buyer_snapshot jsonb, p_source_snapshot jsonb, p_source_order_id uuid, p_source_packing_id uuid, p_customer_id uuid, p_parent_document_id uuid, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_authenticated_actor uuid := auth.uid();
  v_actor uuid;
  v_request_role text := coalesce(auth.role()::text, '');
  v_request_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
  v_service_name text;
begin
  v_service_name := coalesce(v_request_headers ->> 'x-erp-service', '');

  if v_authenticated_actor is not null then
    if p_created_by is null or p_created_by <> v_authenticated_actor then
      raise exception using errcode = '42501', message = 'SRI_ACTOR_MISMATCH';
    end if;
    v_actor := v_authenticated_actor;
  elsif v_request_role = 'service_role'
        and v_service_name = 'sri-electronic-documents' then
    if p_created_by is null then
      raise exception using errcode = '42501', message = 'SRI_SERVICE_ACTOR_REQUIRED';
    end if;
    v_actor := p_created_by;
  else
    raise exception using errcode = '42501', message = 'SRI_AUTHENTICATED_ACTOR_REQUIRED';
  end if;

  if not public.erp_is_company_member(p_company_id, v_actor) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_COMPANY_ACCESS_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.sri_company_memberships membership
    where membership.company_id = p_company_id
      and membership.auth_user_id = v_actor
      and membership.active
      and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_CREATE_DOCUMENT';
  end if;

  return public.create_electronic_document_draft_u2a_internal(
    p_company_id,
    p_emission_point_id,
    p_document_type,
    p_issue_date,
    p_numeric_code,
    p_xml_version,
    p_xsd_version,
    p_issuer_snapshot,
    p_buyer_snapshot,
    p_source_snapshot,
    p_source_order_id,
    p_source_packing_id,
    p_customer_id,
    p_parent_document_id,
    v_actor
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.erp_security_assert_capability(p_company_id uuid, p_capability_id text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  if not exists (
    select 1 from public.erp_security_capabilities capability
    where capability.capability_id = p_capability_id and capability.active
  ) then
    raise exception using errcode = '42501', message = 'ACTIVE_CAPABILITY_REQUIRED';
  end if;
  if not public.erp_security_has_capability(p_company_id, p_capability_id) then
    raise exception using errcode = '42501', message = 'CAPABILITY_REQUIRED';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_electronic_document_draft(p_company_id uuid, p_emission_point_id uuid, p_document_type text, p_issue_date date, p_numeric_code text, p_xml_version text, p_xsd_version text, p_issuer_snapshot jsonb, p_buyer_snapshot jsonb, p_source_snapshot jsonb, p_source_order_id uuid, p_source_packing_id uuid, p_customer_id uuid, p_parent_document_id uuid, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_capability text;
begin
  if auth.uid() is not null then
    v_capability := case p_document_type
      when '04' then 'commercial.credit_notes.create'
      when '07' then 'purchases.withholdings.create'
      else 'commercial.electronic_documents.create'
    end;
    perform public.erp_security_assert_capability(p_company_id, v_capability);
  end if;
  return public.create_electronic_document_draft_u2c3_internal(
    p_company_id,p_emission_point_id,p_document_type,p_issue_date,p_numeric_code,
    p_xml_version,p_xsd_version,p_issuer_snapshot,p_buyer_snapshot,p_source_snapshot,
    p_source_order_id,p_source_packing_id,p_customer_id,p_parent_document_id,p_created_by
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.erp_commercial_reserve_invoice_for_documents(p_company_id uuid, p_order_id text, p_document_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid:=auth.uid(); v_order jsonb; v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype; v_res public.commercial_invoice_reservations%rowtype;
  v_doc public.electronic_documents%rowtype; v_ep text; v_count integer; v_next bigint;
  v_number text; v_created boolean:=false;
begin
  if v_actor is null or not public.erp_is_company_member(p_company_id,v_actor) then
    raise exception 'ERP_COMPANY_ACCESS_REQUIRED';
  end if;
  perform public.erp_security_assert_capability(p_company_id,'commercial.orders.view');
  perform public.erp_security_assert_capability(p_company_id,'commercial.electronic_documents.create');
  if p_document_code is null or p_document_code not in ('ETIQUETAS','INVOICE_PACKING_REFERENCIAL','COMMERCIAL_INVOICE_CLIENT','HR')
    or nullif(btrim(p_order_id),'') is null then raise exception 'COMMERCIAL_RESERVATION_INPUT_INVALID'; end if;
  -- Same lock order as create_electronic_document_draft: settings, point, invoice key.
  select * into v_settings from public.sri_settings where company_id=p_company_id for update;
  if not found or v_settings.environment not in ('TEST','PRODUCTION') then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
  select payload into v_order from public.erp_entity_records
    where company_id=p_company_id and entity='commercial_orders' and record_id=p_order_id and deleted_at is null for share;
  if not found or nullif(v_order->>'number','') is null or coalesce((v_order->>'unsavedDraft')::boolean,false)
    or coalesce((v_order->>'numberPending')::boolean,false) then raise exception 'COMMERCIAL_SAVED_ORDER_REQUIRED'; end if;
  if upper(coalesce(v_order->>'status','')) in ('ANULADO','CANCELLED','VOIDED') then raise exception 'COMMERCIAL_ORDER_CANCELLED'; end if;
  -- Reuse the validated LOCAL / EXPORT routing, deriving it from the saved order.
  v_ep:=case when coalesce(v_order->>'saleType','') ~* 'LOCAL'
    or coalesce(v_order->>'transportType','') ~* 'TERRESTRE|LOCAL' then '003' else '002' end;
  select count(*) into v_count from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active;
  if v_count<>1 then raise exception 'SRI_ACTIVE_EMISSION_POINT_REQUIRED'; end if;
  select * into v_point from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active for update;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':SRI_INVOICE:'||v_settings.environment||':'||p_order_id,0));
  select count(*) into v_count from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED');
  if v_count>1 then raise exception 'COMMERCIAL_INVOICE_RESERVATION_AMBIGUOUS'; end if;
  select * into v_res from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED') for update;
  if v_res.id is not null and (v_res.emission_point_id<>v_point.id or v_res.establishment_code<>'001' or v_res.emission_point_code<>v_ep) then
    raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
  if v_res.status='CONSUMED' then
    select * into v_doc from public.electronic_documents where id=v_res.consumed_document_id
      and company_id=p_company_id and environment=v_settings.environment and document_type='01';
    if not found then raise exception 'SRI_INVOICE_IDEMPOTENCY_DOCUMENT_MISSING'; end if;
  else
    select count(*) into v_count from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
    if v_count>1 then raise exception 'COMMERCIAL_INVOICE_DOCUMENT_AMBIGUOUS'; end if;
    select * into v_doc from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
  end if;
  if v_doc.id is not null then
    if v_doc.emission_point_id<>v_point.id or v_doc.establishment_code<>'001' or v_doc.emission_point_code<>v_ep
      or (v_res.id is not null and (v_res.full_number<>v_doc.full_number or v_res.sequential<>v_doc.sequential)) then
      raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
    v_number:=v_doc.full_number; v_next:=v_doc.sequential;
    -- Adopt an existing canonical document without touching it or the counter.
    -- This also makes the later Factura 01 retry use the existing consumed link.
    if v_res.id is null then
      insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
        establishment_code,emission_point_code,sequential,full_number,status,created_by,consumed_document_id,consumed_at)
        values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'CONSUMED',v_actor,v_doc.id,now())
        returning * into v_res;
    elsif v_res.status='ACTIVE' then
      update public.commercial_invoice_reservations set status='CONSUMED',consumed_document_id=v_doc.id,consumed_at=now(),updated_at=now()
        where id=v_res.id returning * into v_res;
    end if;
  elsif v_res.id is not null then
    v_number:=v_res.full_number; v_next:=v_res.sequential;
  else
    -- OFF remains OFF. Reading an existing identity does not enable issuance.
    if (v_settings.environment='TEST' and (not v_settings.test_enabled or v_settings.production_enabled))
      or (v_settings.environment='PRODUCTION' and not v_settings.production_enabled) then
      raise exception 'SRI_ENVIRONMENT_RESERVATION_DISABLED'; end if;
    insert into public.electronic_document_sequences(company_id,emission_point_id,environment,document_type,next_value,updated_by)
      values(p_company_id,v_point.id,v_settings.environment,'01',1,v_actor)
      on conflict(company_id,emission_point_id,environment,document_type) do nothing;
    select next_value into v_next from public.electronic_document_sequences where company_id=p_company_id
      and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01' for update;
    if v_next is null or v_next<1 or v_next>999999999 then raise exception 'SRI_SEQUENTIAL_EXHAUSTED'; end if;
    v_number:='001-'||v_ep||'-'||lpad(v_next::text,9,'0');
    update public.electronic_document_sequences set next_value=v_next+1,updated_by=v_actor
      where company_id=p_company_id and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01';
    insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
      establishment_code,emission_point_code,sequential,full_number,status,created_by)
      values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'ACTIVE',v_actor) returning * into v_res;
    v_created:=true;
  end if;
  if v_number is distinct from '001-'||v_ep||'-'||lpad(v_next::text,9,'0') then raise exception 'COMMERCIAL_INVOICE_IDENTITY_INVALID'; end if;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'orderId',p_order_id,'orderNumber',v_order->>'number',
    'environment',v_settings.environment,'documentType','01','emissionPointId',v_point.id,
    'establishmentCode','001','emissionPointCode',v_ep,'sequential',lpad(v_next::text,9,'0'),'fullNumber',v_number,
    'reservationId',v_res.id,'documentId',v_doc.id,'status',case when v_doc.id is not null then 'DOCUMENT' else 'ACTIVE' end,
    'created',v_created,'reused',not v_created);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sri_draft_buyer_address_source(p_document electronic_documents)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.erp_entity_records%rowtype;
  v_customer public.erp_entity_records%rowtype;
  v_address text;
begin
  perform public.erp_security_assert_capability(p_document.company_id,'commercial.electronic_documents.authorize');
  if auth.uid() is null or p_document.environment <> 'TEST' or p_document.document_type <> '01'
    or p_document.status not in ('BORRADOR','VALIDADO')
    or p_document.certificate_id is not null
    or p_document.authorization_number is not null or p_document.authorized_at is not null
    or exists(select 1 from public.electronic_document_files where document_id=p_document.id)
    or exists(select 1 from public.sri_transmissions where document_id=p_document.id)
    or exists(select 1 from public.sri_transmission_attempts where document_id=p_document.id)
    or exists(select 1 from public.sri_authorizations where document_id=p_document.id) then
    raise exception using errcode='23514',message='SRI_DRAFT_ADDRESS_REFRESH_NOT_ALLOWED';
  end if;
  perform 1 from public.sri_settings where company_id=p_document.company_id
    and environment='TEST' and test_enabled and not production_enabled for share;
  if not found then raise exception 'SRI_TEST_DISABLED'; end if;
  select * into v_order from public.erp_entity_records
    where company_id=p_document.company_id and entity='commercial_orders'
      and record_id=p_document.source_snapshot#>>'{erpEmission,sourceOrderId}'
      and deleted_at is null for share;
  if not found then raise exception 'SRI_CANONICAL_SOURCE_ORDER_REQUIRED'; end if;
  select * into v_customer from public.erp_entity_records
    where company_id=p_document.company_id and entity='commercial_customers'
      and record_id=v_order.payload->>'customerId' and deleted_at is null for share;
  if not found then raise exception 'SRI_CANONICAL_CUSTOMER_REQUIRED'; end if;
  -- Identity is not editable through address refresh. Never match by name.
  if nullif(btrim(v_customer.payload->>'identification'),'') is null
    or btrim(v_customer.payload->>'identification') is distinct from btrim(p_document.buyer_snapshot->>'identification')
    or p_document.source_snapshot#>>'{buyer,identification}' is distinct from p_document.buyer_snapshot->>'identification' then
    raise exception 'SRI_CANONICAL_BUYER_IDENTITY_MISMATCH';
  end if;
  v_address := btrim(v_customer.payload->>'address');
  if coalesce(v_address,'')='' then raise exception 'SRI_BUYER_ADDRESS_REQUIRED'; end if;
  if length(v_address)>300 then raise exception 'SRI_BUYER_ADDRESS_TOO_LONG'; end if;
  return jsonb_build_object('address',v_address,'order_id',v_order.record_id,
    'order_version',v_order.version,'customer_id',v_customer.record_id,'customer_version',v_customer.version);
end $function$
;

CREATE TRIGGER sri_settings_preserve_creation BEFORE UPDATE ON public.sri_settings FOR EACH ROW EXECUTE FUNCTION sri_preserve_creation_audit();

CREATE TRIGGER sri_settings_validate_company BEFORE INSERT OR UPDATE OF company_id, ruc, environment, production_enabled ON public.sri_settings FOR EACH ROW EXECUTE FUNCTION sri_validate_settings_company();

CREATE TRIGGER emission_points_preserve_creation BEFORE UPDATE ON public.emission_points FOR EACH ROW EXECUTE FUNCTION sri_preserve_creation_audit();

CREATE TRIGGER electronic_document_sequences_touch_updated_at BEFORE UPDATE ON public.electronic_document_sequences FOR EACH ROW EXECUTE FUNCTION sri_touch_updated_at();

CREATE TRIGGER sri_test_counter_enabled BEFORE INSERT OR UPDATE OF next_value ON public.electronic_document_sequences FOR EACH ROW EXECUTE FUNCTION sri_test_enabled_write_guard();

CREATE TRIGGER digital_certificates_preserve_creation BEFORE UPDATE ON public.digital_certificates FOR EACH ROW EXECUTE FUNCTION sri_preserve_creation_audit();

CREATE TRIGGER electronic_documents_validate_integrity BEFORE INSERT OR UPDATE ON public.electronic_documents FOR EACH ROW EXECUTE FUNCTION sri_validate_document_integrity();

CREATE TRIGGER erp_supplier_v2_sync_withholding_status_trigger AFTER INSERT OR UPDATE OF status ON public.electronic_documents FOR EACH ROW EXECUTE FUNCTION erp_supplier_v2_sync_withholding_status();

CREATE TRIGGER sri_test_document_enabled BEFORE INSERT ON public.electronic_documents FOR EACH ROW EXECUTE FUNCTION sri_test_enabled_write_guard();

CREATE TRIGGER sri_transmissions_touch_updated_at BEFORE UPDATE ON public.sri_transmissions FOR EACH ROW EXECUTE FUNCTION sri_touch_updated_at();

CREATE TRIGGER sri_transmissions_validate_environment BEFORE INSERT OR UPDATE OF company_id, document_id, transmission_type, environment, endpoint_url ON public.sri_transmissions FOR EACH ROW EXECUTE FUNCTION sri_validate_transmission_environment();

CREATE TRIGGER sri_transmission_attempts_touch_updated_at BEFORE UPDATE ON public.sri_transmission_attempts FOR EACH ROW EXECUTE FUNCTION sri_touch_updated_at();

CREATE TRIGGER sri_authorizations_preserve_creation BEFORE UPDATE ON public.sri_authorizations FOR EACH ROW EXECUTE FUNCTION sri_preserve_creation_audit();

CREATE TRIGGER sri_authorizations_validate_environment BEFORE INSERT OR UPDATE OF company_id, document_id, environment ON public.sri_authorizations FOR EACH ROW EXECUTE FUNCTION sri_validate_authorization_environment();

alter table public.erp_operations_commands enable row level security;
grant execute on all functions in schema public to authenticated,service_role;
revoke execute on function public.create_electronic_document_draft_u2a_internal(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) from public,authenticated,service_role;
revoke execute on function public.create_electronic_document_draft_u2c3_internal(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid) from public,authenticated,service_role;


alter table public.electronic_documents enable row level security;

alter table public.electronic_document_sequences enable row level security;

alter table public.sri_settings enable row level security;

alter table public.erp_operations_commands enable row level security;

alter table public.emission_points enable row level security;

alter table public.commercial_invoice_reservations enable row level security;

alter table public.companies enable row level security;

create policy commercial_invoice_reservations_member_select on public.commercial_invoice_reservations for SELECT to authenticated using (erp_is_company_member(company_id, auth.uid()));

create policy companies_select_member on public.companies for SELECT to authenticated using (erp_is_company_member(id, auth.uid()));

create policy electronic_document_sequences_select_member on public.electronic_document_sequences for SELECT to authenticated using (sri_is_company_member(company_id, auth.uid()));

create policy electronic_documents_select_member on public.electronic_documents for SELECT to authenticated using ((sri_is_company_member(company_id, auth.uid()) AND (company_id IN ( SELECT allowed.company_id
   FROM erp_u2c3_authorized_companies(ARRAY['commercial.electronic_documents.view'::text]) allowed(company_id)))));

create policy emission_points_select_member on public.emission_points for SELECT to authenticated using (sri_is_company_member(company_id, auth.uid()));

create policy erp_operations_commands_company_member_select on public.erp_operations_commands for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM user_company_memberships membership
  WHERE ((membership.company_id = erp_operations_commands.company_id) AND (membership.user_id = auth.uid()) AND (membership.membership_status = 'ACTIVE'::text)))));

create policy sri_settings_select_member on public.sri_settings for SELECT to authenticated using (sri_is_company_member(company_id, auth.uid()));

grant INSERT on public.commercial_invoice_reservations to authenticated;

grant SELECT on public.commercial_invoice_reservations to authenticated;

grant UPDATE on public.commercial_invoice_reservations to authenticated;

grant DELETE on public.commercial_invoice_reservations to authenticated;

grant TRUNCATE on public.commercial_invoice_reservations to authenticated;

grant REFERENCES on public.commercial_invoice_reservations to authenticated;

grant TRIGGER on public.commercial_invoice_reservations to authenticated;

grant INSERT on public.commercial_invoice_reservations to service_role;

grant SELECT on public.commercial_invoice_reservations to service_role;

grant UPDATE on public.commercial_invoice_reservations to service_role;

grant DELETE on public.commercial_invoice_reservations to service_role;

grant TRUNCATE on public.commercial_invoice_reservations to service_role;

grant REFERENCES on public.commercial_invoice_reservations to service_role;

grant TRIGGER on public.commercial_invoice_reservations to service_role;

grant INSERT on public.companies to service_role;

grant SELECT on public.companies to service_role;

grant UPDATE on public.companies to service_role;

grant DELETE on public.companies to service_role;

grant TRUNCATE on public.companies to service_role;

grant REFERENCES on public.companies to service_role;

grant TRIGGER on public.companies to service_role;

grant SELECT on public.companies to authenticated;

grant INSERT on public.electronic_document_sequences to service_role;

grant SELECT on public.electronic_document_sequences to service_role;

grant UPDATE on public.electronic_document_sequences to service_role;

grant DELETE on public.electronic_document_sequences to service_role;

grant TRUNCATE on public.electronic_document_sequences to service_role;

grant REFERENCES on public.electronic_document_sequences to service_role;

grant TRIGGER on public.electronic_document_sequences to service_role;

grant SELECT on public.electronic_document_sequences to authenticated;

grant INSERT on public.electronic_documents to service_role;

grant SELECT on public.electronic_documents to service_role;

grant UPDATE on public.electronic_documents to service_role;

grant DELETE on public.electronic_documents to service_role;

grant TRUNCATE on public.electronic_documents to service_role;

grant REFERENCES on public.electronic_documents to service_role;

grant TRIGGER on public.electronic_documents to service_role;

grant SELECT on public.electronic_documents to authenticated;

grant INSERT on public.emission_points to service_role;

grant SELECT on public.emission_points to service_role;

grant UPDATE on public.emission_points to service_role;

grant DELETE on public.emission_points to service_role;

grant TRUNCATE on public.emission_points to service_role;

grant REFERENCES on public.emission_points to service_role;

grant TRIGGER on public.emission_points to service_role;

grant SELECT on public.emission_points to authenticated;

grant INSERT on public.erp_operations_commands to service_role;

grant SELECT on public.erp_operations_commands to service_role;

grant UPDATE on public.erp_operations_commands to service_role;

grant DELETE on public.erp_operations_commands to service_role;

grant TRUNCATE on public.erp_operations_commands to service_role;

grant REFERENCES on public.erp_operations_commands to service_role;

grant TRIGGER on public.erp_operations_commands to service_role;

grant SELECT on public.erp_operations_commands to authenticated;

grant INSERT on public.sri_settings to service_role;

grant SELECT on public.sri_settings to service_role;

grant UPDATE on public.sri_settings to service_role;

grant DELETE on public.sri_settings to service_role;

grant TRUNCATE on public.sri_settings to service_role;

grant REFERENCES on public.sri_settings to service_role;

grant TRIGGER on public.sri_settings to service_role;

grant SELECT on public.sri_settings to authenticated;

grant select on public.user_company_memberships to authenticated;

CREATE OR REPLACE FUNCTION public.sri_build_access_key(p_issue_date date, p_document_type text, p_ruc text, p_environment text, p_establishment_code text, p_emission_point_code text, p_sequential bigint, p_numeric_code text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_environment_code text;
  v_base text;
begin
  v_environment_code := case p_environment
    when 'TEST' then '1'
    when 'PRODUCTION' then '2'
    else null
  end;
  if v_environment_code is null then
    raise exception using errcode = '22023', message = 'SRI_ENVIRONMENT_INVALID';
  end if;
  if p_document_type not in ('01', '04', '06', '07') then
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
    || v_environment_code
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
$function$
;

CREATE OR REPLACE FUNCTION public.sri_modulo11(p_value text)
 RETURNS smallint
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
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
$function$
;