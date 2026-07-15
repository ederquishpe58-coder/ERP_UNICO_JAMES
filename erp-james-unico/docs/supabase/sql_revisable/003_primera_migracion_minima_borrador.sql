-- BORRADOR SQL REVISABLE
-- FASE 4C
-- PRIMERA MIGRACION MINIMA SUPABASE
-- NO EJECUTAR TODAVIA
-- NO ES MIGRACION OFICIAL
-- NO PEGAR EN SUPABASE AUN
-- SOLO DISEÑO PARA REVISION

-- A. EXTENSIONES CONCEPTUALES
-- revisar si se usara:
-- create extension if not exists "pgcrypto";

-- B. CORE

create table if not exists companies (
  id uuid primary key,
  name text not null,
  ruc text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_profiles (
  id uuid primary key,
  company_id uuid not null references companies(id),
  -- auth_user_id uuid, -- revisar cuando se implemente Auth real
  email text not null,
  display_name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key,
  company_id uuid not null references companies(id),
  role_code text not null,
  role_name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_roles (
  id uuid primary key,
  company_id uuid not null references companies(id),
  user_profile_id uuid not null references user_profiles(id),
  role_id uuid not null references roles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  id uuid primary key,
  company_id uuid not null references companies(id),
  setting_key text not null,
  setting_value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sequences (
  id uuid primary key,
  company_id uuid not null references companies(id),
  sequence_key text not null,
  prefix text,
  current_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key,
  company_id uuid not null references companies(id),
  user_profile_id uuid references user_profiles(id),
  module_name text not null,
  action_name text not null,
  document_ref text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- C. CATALOGOS COMERCIALES

create table if not exists customers (
  id uuid primary key,
  company_id uuid not null references companies(id),
  legal_name text not null,
  commercial_name text not null,
  identification_type text,
  identification_number text,
  country text,
  city text,
  address text,
  email text,
  phone text,
  credit_days integer not null default 0,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists final_brands (
  id uuid primary key,
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  brand_name text not null,
  country text,
  city text,
  address text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cargo_agencies (
  id uuid primary key,
  company_id uuid not null references companies(id),
  agency_name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists airlines (
  id uuid primary key,
  company_id uuid not null references companies(id),
  airline_name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dae_records (
  id uuid primary key,
  company_id uuid not null references companies(id),
  dae_number text not null,
  destination_country text,
  expiry_date date,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists export_products (
  id uuid primary key,
  company_id uuid not null references companies(id),
  product_code text not null,
  product_name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- D. PEDIDO COMERCIAL

create table if not exists commercial_orders (
  id uuid primary key,
  company_id uuid not null references companies(id),
  order_number text not null,
  customer_id uuid not null references customers(id),
  final_brand_id uuid references final_brands(id),
  issue_date date,
  flight_date date,
  destination_country text,
  destination_city text,
  dae_id uuid references dae_records(id),
  cargo_agency_id uuid references cargo_agencies(id),
  airline_id uuid references airlines(id),
  awb text,
  hawb text,
  status text not null default 'BORRADOR' check (status in ('BORRADOR','REFERENCIAL','VALIDADO_COMERCIAL','LISTO_BODEGA','LISTO_DESPACHO','DESPACHADO_DEMO','CERRADO_DEMO','ANULADO','REABIERTO_DEMO')),
  total_boxes integer not null default 0,
  total_fulls numeric(12,2) not null default 0,
  total_bunches integer not null default 0,
  total_stems integer not null default 0,
  total_usd numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists commercial_order_boxes (
  id uuid primary key,
  company_id uuid not null references companies(id),
  order_id uuid not null references commercial_orders(id),
  box_number integer not null,
  box_type text not null,
  full_equivalent numeric(12,2) not null default 0,
  po text,
  status text not null default 'BORRADOR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists commercial_order_lines (
  id uuid primary key,
  company_id uuid not null references companies(id),
  order_id uuid not null references commercial_orders(id),
  box_id uuid not null references commercial_order_boxes(id),
  variety text not null,
  stem_length integer,
  bunches integer not null default 0,
  stems_per_bunch integer not null default 0,
  total_stems integer not null default 0,
  unit_price numeric(14,4) not null default 0,
  total_usd numeric(14,2) not null default 0,
  reservation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists commercial_workflow_events (
  id uuid primary key,
  company_id uuid not null references companies(id),
  order_id uuid not null references commercial_orders(id),
  previous_status text,
  new_status text,
  action_name text not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists commercial_documents (
  id uuid primary key,
  company_id uuid not null references companies(id),
  order_id uuid not null references commercial_orders(id),
  document_type text not null,
  document_mode text,
  status text not null default 'BORRADOR',
  reference_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- E. OPERACIONES MINIMA

create table if not exists flower_availability (
  id uuid primary key,
  company_id uuid not null references companies(id),
  variety text not null,
  stem_length integer not null,
  stems_per_bunch integer not null,
  available_bunches integer not null default 0,
  reserved_bunches integer not null default 0,
  balance_bunches integer not null default 0,
  warehouse text,
  supplier text,
  block text,
  category text,
  status text not null default 'DISPONIBLE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists flower_reservations (
  id uuid primary key,
  company_id uuid not null references companies(id),
  availability_id uuid not null references flower_availability(id),
  order_id uuid not null references commercial_orders(id),
  variety text not null,
  stem_length integer not null,
  reserved_bunches integer not null default 0,
  reserved_stems integer not null default 0,
  status text not null default 'RESERVADO',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists operational_dispatches (
  id uuid primary key,
  company_id uuid not null references companies(id),
  order_id uuid not null references commercial_orders(id),
  dispatch_status text not null default 'PENDIENTE' check (dispatch_status in ('PENDIENTE','EN_PREPARACION','LISTO_DESPACHO','DESPACHADO_DEMO','OBSERVADO','ANULADO_DEMO')),
  responsible_user_id uuid references user_profiles(id),
  dispatched_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists operational_dispatch_boxes (
  id uuid primary key,
  company_id uuid not null references companies(id),
  dispatch_id uuid not null references operational_dispatches(id),
  order_box_id uuid not null references commercial_order_boxes(id),
  scan_status text not null default 'PENDIENTE_ESCANEO',
  status text not null default 'PENDIENTE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- F. INDICES SUGERIDOS

create index if not exists idx_customers_company_id on customers(company_id);
create index if not exists idx_final_brands_customer_id on final_brands(customer_id);
create index if not exists idx_commercial_orders_company_id on commercial_orders(company_id);
create index if not exists idx_commercial_orders_customer_id on commercial_orders(customer_id);
create index if not exists idx_commercial_orders_issue_date on commercial_orders(issue_date);
create index if not exists idx_commercial_orders_flight_date on commercial_orders(flight_date);
create index if not exists idx_commercial_orders_status on commercial_orders(status);
create index if not exists idx_commercial_orders_order_number on commercial_orders(order_number);
create index if not exists idx_commercial_orders_dae_id on commercial_orders(dae_id);
create index if not exists idx_boxes_order_id on commercial_order_boxes(order_id);
create index if not exists idx_lines_order_id on commercial_order_lines(order_id);
create index if not exists idx_lines_box_id on commercial_order_lines(box_id);
create index if not exists idx_availability_company_id on flower_availability(company_id);
create index if not exists idx_availability_status on flower_availability(status);
create index if not exists idx_reservations_order_id on flower_reservations(order_id);
create index if not exists idx_dispatches_order_id on operational_dispatches(order_id);
create index if not exists idx_dispatches_status on operational_dispatches(dispatch_status);

-- G. TRIGGERS updated_at SOLO COMO BORRADOR

-- revisar luego:
-- create function set_updated_at() returns trigger as $$
-- begin
--   new.updated_at = now();
--   return new;
-- end;
-- $$ language plpgsql;

-- create trigger trg_companies_updated_at before update on companies
-- for each row execute function set_updated_at();

-- H. COMENTARIOS FINALES

-- RLS pendiente
-- Auth pendiente
-- Seed pendiente
-- Migracion demo pendiente
-- No ejecutar todavia
