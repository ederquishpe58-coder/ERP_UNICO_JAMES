-- BORRADOR SQL REVISABLE
-- NO EJECUTAR TODAVÍA
-- NO ES MIGRACIÓN OFICIAL
-- SOLO DISEÑO CONCEPTUAL FASE 4B

create table if not exists companies (
  id uuid primary key,
  code text not null unique,
  name text not null,
  legal_name text,
  ruc text,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists users_profile (
  id uuid primary key,
  company_id uuid not null references companies(id),
  email text not null unique,
  display_name text not null,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists roles (
  id uuid primary key,
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  scope text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists audit_logs (
  id uuid primary key,
  company_id uuid not null references companies(id),
  user_id uuid,
  module text not null,
  action text not null,
  document_ref text,
  payload jsonb,
  created_at timestamptz default now()
);

create table if not exists sequences (
  id uuid primary key,
  company_id uuid not null references companies(id),
  sequence_key text not null,
  prefix text,
  current_value bigint default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists customers (
  id uuid primary key,
  company_id uuid not null references companies(id),
  code text not null,
  commercial_name text not null,
  legal_name text,
  identification text,
  country text,
  city text,
  billing_email text,
  credit_days integer default 0,
  credit_amount numeric(14,2) default 0,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists final_brands (
  id uuid primary key,
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  name text not null,
  address text,
  city text,
  country text,
  destination text,
  contact text,
  email text,
  requires_po boolean default false,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists cargo_agencies (
  id uuid primary key,
  company_id uuid not null references companies(id),
  name text not null,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists airlines (
  id uuid primary key,
  company_id uuid not null references companies(id),
  name text not null,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists dae_records (
  id uuid primary key,
  company_id uuid not null references companies(id),
  dae_number text not null,
  destination_country text,
  expiry_date date,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists commercial_orders (
  id uuid primary key,
  company_id uuid not null references companies(id),
  order_number text not null,
  customer_id uuid not null references customers(id),
  brand_id uuid references final_brands(id),
  dae_record_id uuid references dae_records(id),
  cargo_agency_id uuid references cargo_agencies(id),
  airline_id uuid references airlines(id),
  issue_date date,
  flight_date date,
  destination text,
  awb text,
  hawb text,
  status text default 'BORRADOR',
  total_boxes integer default 0,
  total_fulls numeric(10,2) default 0,
  total_bunches integer default 0,
  total_stems integer default 0,
  total_usd numeric(14,2) default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists commercial_order_boxes (
  id uuid primary key,
  company_id uuid not null references companies(id),
  commercial_order_id uuid not null references commercial_orders(id),
  box_number integer not null,
  box_type text not null,
  full_equivalent numeric(10,2) default 0,
  po text,
  status text default 'BORRADOR',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists commercial_order_lines (
  id uuid primary key,
  company_id uuid not null references companies(id),
  commercial_order_box_id uuid not null references commercial_order_boxes(id),
  variety text not null,
  length integer,
  bunches integer default 0,
  stems_per_bunch integer default 0,
  total_stems integer default 0,
  unit_price numeric(12,4) default 0,
  total_line numeric(14,2) default 0,
  po text,
  status text default 'BORRADOR',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists commercial_workflow_events (
  id uuid primary key,
  company_id uuid not null references companies(id),
  commercial_order_id uuid not null references commercial_orders(id),
  previous_status text,
  next_status text,
  action text,
  reason text,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists flower_inventory (
  id uuid primary key,
  company_id uuid not null references companies(id),
  source_system text,
  source_record_id text,
  entry_date date,
  variety text not null,
  length integer not null,
  stems_per_bunch integer not null,
  initial_bunches integer default 0,
  initial_stems integer default 0,
  available_bunches integer default 0,
  available_stems integer default 0,
  reserved_bunches integer default 0,
  reserved_stems integer default 0,
  consumed_bunches integer default 0,
  consumed_stems integer default 0,
  warehouse text,
  supplier text,
  block text,
  category text,
  age_days integer default 0,
  status text default 'PENDIENTE_SINCRONIZACION',
  observation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists flower_availability (
  id uuid primary key,
  company_id uuid not null references companies(id),
  flower_inventory_id uuid references flower_inventory(id),
  availability_date date,
  variety text not null,
  length integer not null,
  stems_per_bunch integer not null,
  available_bunches integer default 0,
  available_stems integer default 0,
  warehouse text,
  supplier text,
  block text,
  category text,
  status text default 'DISPONIBLE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists flower_reservations (
  id uuid primary key,
  company_id uuid not null references companies(id),
  flower_availability_id uuid not null references flower_availability(id),
  commercial_order_id uuid references commercial_orders(id),
  variety text not null,
  length integer not null,
  reserved_bunches integer default 0,
  reserved_stems integer default 0,
  status text default 'RESERVADO',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists operational_dispatches (
  id uuid primary key,
  company_id uuid not null references companies(id),
  commercial_order_id uuid not null references commercial_orders(id),
  dispatch_number text,
  dispatch_status text default 'PENDIENTE',
  flight_date date,
  dae_number text,
  awb text,
  hawb text,
  cargo_agency_name text,
  carrier text,
  flight_code text,
  total_boxes integer default 0,
  total_fulls numeric(10,2) default 0,
  total_bunches integer default 0,
  total_stems integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists operational_dispatch_boxes (
  id uuid primary key,
  company_id uuid not null references companies(id),
  operational_dispatch_id uuid not null references operational_dispatches(id),
  commercial_order_box_id uuid references commercial_order_boxes(id),
  box_code text,
  scan_status text default 'PENDIENTE_ESCANEO',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists scanner_events (
  id uuid primary key,
  company_id uuid not null references companies(id),
  operational_dispatch_id uuid references operational_dispatches(id),
  dispatch_box_id uuid references operational_dispatch_boxes(id),
  code text not null,
  code_type text not null,
  result text not null,
  observation text,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists operational_consumptions (
  id uuid primary key,
  company_id uuid not null references companies(id),
  operational_dispatch_id uuid not null references operational_dispatches(id),
  flower_reservation_id uuid references flower_reservations(id),
  flower_availability_id uuid references flower_availability(id),
  variety text not null,
  length integer not null,
  stems_per_bunch integer not null,
  consumed_bunches integer default 0,
  consumed_stems integer default 0,
  status text default 'PENDIENTE',
  observation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists operational_kardex (
  id uuid primary key,
  company_id uuid not null references companies(id),
  operational_consumption_id uuid references operational_consumptions(id),
  movement_type text not null,
  variety text not null,
  length integer not null,
  bunches integer default 0,
  stems integer default 0,
  balance_bunches integer default 0,
  balance_stems integer default 0,
  observation text,
  created_at timestamptz default now()
);

-- FUTURO:
-- alter table ... enable row level security;
-- create policy ...;
