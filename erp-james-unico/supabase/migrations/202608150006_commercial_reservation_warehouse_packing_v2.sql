begin;

-- FASE 4: disponibilidad, reserva, asignación física y empaque son estados
-- distintos del mismo inventario. Las tablas de registro siguientes aportan
-- bloqueos y restricciones; los payloads canónicos continúan en
-- erp_entity_records para que el Realtime incremental actual pueda leerlos.

create table if not exists public.erp_order_reservation_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  reservation_id uuid not null,
  order_id text not null,
  order_line_id text not null,
  dimension_key text not null,
  variety text not null,
  length numeric not null default 0,
  quality text not null default 'EXPORTACION',
  stems_per_bunch numeric not null default 0,
  requested_quantity integer not null check (requested_quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  assigned_quantity integer not null default 0 check (assigned_quantity >= 0),
  packed_quantity integer not null default 0 check (packed_quantity >= 0),
  released_quantity integer not null default 0 check (released_quantity >= 0),
  status text not null default 'PENDING' check (status in (
    'PENDING','PENDING_SELECTION','PARTIAL','ACTIVE','CONSUMED','RELEASED','CANCEL_REVIEW_REQUIRED','CANCELLED'
  )),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_operation_id uuid not null,
  primary key (company_id, reservation_id),
  unique (company_id, order_id, order_line_id),
  check (assigned_quantity <= reserved_quantity or status = 'PENDING_SELECTION'),
  check (packed_quantity <= assigned_quantity)
);

create table if not exists public.erp_order_box_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  calendar_year integer not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, calendar_year)
);

create table if not exists public.erp_order_box_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  box_id uuid not null,
  box_code text not null,
  order_id text not null,
  box_number integer not null check (box_number > 0),
  box_type text not null,
  capacity_bunches integer not null check (capacity_bunches > 0),
  packed_bunches integer not null default 0 check (packed_bunches >= 0),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','REOPENED','CANCELLED','CANCEL_REVIEW_REQUIRED')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  last_operation_id uuid not null,
  primary key (company_id, box_id),
  unique (company_id, box_code),
  unique (company_id, order_id, box_number),
  check (packed_bunches <= capacity_bunches)
);

create table if not exists public.erp_bunch_order_assignment_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  bunch_id uuid not null,
  inventory_record_id text not null,
  order_id text not null,
  order_line_id text not null,
  reservation_id uuid,
  box_id uuid not null,
  status text not null check (status in ('ASSIGNED','PACKED','UNASSIGNED','CANCEL_REVIEW_REQUIRED')),
  assigned_at timestamptz not null default now(),
  packed_at timestamptz,
  unassigned_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  last_operation_id uuid not null,
  primary key (company_id, bunch_id),
  foreign key (company_id, reservation_id) references public.erp_order_reservation_registry(company_id, reservation_id),
  foreign key (company_id, box_id) references public.erp_order_box_registry(company_id, box_id)
);

create index if not exists erp_order_reservation_dimension_idx
  on public.erp_order_reservation_registry(company_id, dimension_key, status, updated_at desc);
create index if not exists erp_order_reservation_order_idx
  on public.erp_order_reservation_registry(company_id, order_id, status);
create index if not exists erp_order_box_order_idx
  on public.erp_order_box_registry(company_id, order_id, status, box_number);
create index if not exists erp_bunch_assignment_order_idx
  on public.erp_bunch_order_assignment_registry(company_id, order_id, status);
create index if not exists erp_bunch_assignment_box_idx
  on public.erp_bunch_order_assignment_registry(company_id, box_id, status);

-- Un despliegue progresivo puede encontrar cajas V2 ya materializadas por una
-- versión anterior del frontend. El contador visible continúa desde el máximo
-- canónico conocido y nunca se reinicia ni usa max(local)+1.
insert into public.erp_order_box_sequence_counters(company_id, calendar_year, last_value, updated_at)
select record.company_id,
  substring(record.payload ->> 'boxCode' from '^BOX-([0-9]{4})-')::integer,
  max(substring(record.payload ->> 'boxCode' from '^BOX-[0-9]{4}-([0-9]+)$')::bigint),
  clock_timestamp()
from public.erp_entity_records record
where record.entity = 'operations_order_boxes'
  and record.deleted_at is null
  and coalesce(record.payload ->> 'boxCode', '') ~ '^BOX-[0-9]{4}-[0-9]+$'
group by record.company_id,
  substring(record.payload ->> 'boxCode' from '^BOX-([0-9]{4})-')::integer
on conflict (company_id, calendar_year) do update set
  last_value = greatest(erp_order_box_sequence_counters.last_value, excluded.last_value),
  updated_at = clock_timestamp();

alter table public.erp_order_reservation_registry enable row level security;
alter table public.erp_order_box_sequence_counters enable row level security;
alter table public.erp_order_box_registry enable row level security;
alter table public.erp_bunch_order_assignment_registry enable row level security;

drop policy if exists erp_order_reservation_member_select on public.erp_order_reservation_registry;
create policy erp_order_reservation_member_select on public.erp_order_reservation_registry
for select to authenticated using (exists (
  select 1 from public.user_company_memberships membership
  where membership.company_id = erp_order_reservation_registry.company_id
    and membership.user_id = auth.uid() and membership.membership_status = 'ACTIVE'
));
drop policy if exists erp_order_box_sequence_member_select on public.erp_order_box_sequence_counters;
create policy erp_order_box_sequence_member_select on public.erp_order_box_sequence_counters
for select to authenticated using (exists (
  select 1 from public.user_company_memberships membership
  where membership.company_id = erp_order_box_sequence_counters.company_id
    and membership.user_id = auth.uid() and membership.membership_status = 'ACTIVE'
));
drop policy if exists erp_order_box_member_select on public.erp_order_box_registry;
create policy erp_order_box_member_select on public.erp_order_box_registry
for select to authenticated using (exists (
  select 1 from public.user_company_memberships membership
  where membership.company_id = erp_order_box_registry.company_id
    and membership.user_id = auth.uid() and membership.membership_status = 'ACTIVE'
));
drop policy if exists erp_bunch_assignment_member_select on public.erp_bunch_order_assignment_registry;
create policy erp_bunch_assignment_member_select on public.erp_bunch_order_assignment_registry
for select to authenticated using (exists (
  select 1 from public.user_company_memberships membership
  where membership.company_id = erp_bunch_order_assignment_registry.company_id
    and membership.user_id = auth.uid() and membership.membership_status = 'ACTIVE'
));

-- Las escrituras críticas se realizan exclusivamente mediante RPC
-- transaccionales. Authenticated conserva lectura RLS para diagnóstico/UI.
revoke all on table public.erp_order_reservation_registry from anon, authenticated;
revoke all on table public.erp_order_box_sequence_counters from anon, authenticated;
revoke all on table public.erp_order_box_registry from anon, authenticated;
revoke all on table public.erp_bunch_order_assignment_registry from anon, authenticated;
grant select on table public.erp_order_reservation_registry to authenticated;
grant select on table public.erp_order_box_sequence_counters to authenticated;
grant select on table public.erp_order_box_registry to authenticated;
grant select on table public.erp_bunch_order_assignment_registry to authenticated;

create or replace function public.erp_warehouse_v2_assert_access(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'WAREHOUSE_V2_COMPANY_ACCESS_DENIED';
  end if;
end;
$$;

create or replace function public.erp_warehouse_v2_dimension_key(
  p_variety text, p_length numeric, p_quality text
)
returns text
language sql
immutable
as $$
  select upper(btrim(coalesce(p_variety, ''))) || '|' ||
    trim(to_char(coalesce(p_length, 0), 'FM999999990.####')) || '|' ||
    upper(btrim(coalesce(nullif(p_quality, ''), 'EXPORTACION')));
$$;

create or replace function public.erp_warehouse_v2_next_box_code(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from (clock_timestamp() at time zone 'America/Guayaquil'))::integer;
  v_value bigint;
begin
  insert into public.erp_order_box_sequence_counters(company_id, calendar_year, last_value, updated_at)
  values (p_company_id, v_year, 1, clock_timestamp())
  on conflict (company_id, calendar_year) do update set
    last_value = erp_order_box_sequence_counters.last_value + 1,
    updated_at = clock_timestamp()
  returning last_value into v_value;
  return format('BOX-%s-%s', v_year, lpad(v_value::text, 6, '0'));
end;
$$;

create or replace function public.erp_warehouse_v2_write_movement(
  p_company_id uuid,
  p_operation_id uuid,
  p_device_id text,
  p_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := gen_random_uuid()::text;
begin
  return public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_order_movements', v_id,
    jsonb_build_object(
      'id', v_id, 'operationId', p_operation_id::text, 'movementType', upper(p_type),
      'dateTime', clock_timestamp(), 'date', to_char(clock_timestamp() at time zone 'America/Guayaquil', 'YYYY-MM-DD'),
      'syncFlow', 'WAREHOUSE_V2'
    ) || coalesce(p_payload, '{}'::jsonb), 0
  );
end;
$$;

revoke all on function public.erp_warehouse_v2_assert_access(uuid) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_dimension_key(text,numeric,text) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_next_box_code(uuid) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_write_movement(uuid,uuid,text,text,jsonb) from public, anon, authenticated;

create or replace function public.erp_warehouse_v2_availability(p_company_id uuid)
returns table (
  dimension_key text,
  variety text,
  length numeric,
  quality text,
  physical_bunches bigint,
  physical_stems numeric,
  reserved_bunches numeric,
  assigned_bunches bigint,
  packed_bunches bigint,
  blocked_bunches bigint,
  available_bunches numeric,
  available_stems numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  return query
  with inventory as (
    select
      public.erp_warehouse_v2_dimension_key(
        record.payload ->> 'variety',
        coalesce(nullif(record.payload ->> 'length', '')::numeric, 0),
        coalesce(record.payload ->> 'quality', record.payload ->> 'category', 'EXPORTACION')
      ) as key,
      upper(btrim(coalesce(record.payload ->> 'variety', ''))) as variety,
      coalesce(nullif(record.payload ->> 'length', '')::numeric, 0) as length,
      upper(btrim(coalesce(record.payload ->> 'quality', record.payload ->> 'category', 'EXPORTACION'))) as quality,
      upper(coalesce(record.payload ->> 'state', '')) as state,
      coalesce(nullif(record.payload ->> 'stems', '')::numeric, nullif(record.payload ->> 'stemsPerBunch', '')::numeric, 0) as stems
    from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'operations_rose_inventory'
      and record.deleted_at is null and record.payload ->> 'sourceType' = 'ESCANEO_ETIQUETA'
  ), inventory_grouped as (
    select source.key, max(source.variety) as variety, max(source.length) as length, max(source.quality) as quality,
      count(*) filter (where source.state not in ('ANULADO','ANNULLED','CONSUMIDO','DISPATCHED','DESPACHADO')) as physical_bunches,
      coalesce(sum(source.stems) filter (where source.state not in ('ANULADO','ANNULLED','CONSUMIDO','DISPATCHED','DESPACHADO')), 0) as physical_stems,
      count(*) filter (where source.state in ('ASSIGNED_TO_ORDER','ASIGNADO_PEDIDO')) as assigned_bunches,
      count(*) filter (where source.state in ('PACKED','EMPACADO','ASIGNADO_CAJA')) as packed_bunches,
      count(*) filter (where source.state in ('OBSERVADO','VENCIDO','BLOQUEADO','BLOCKED')) as blocked_bunches,
      count(*) filter (where source.state = 'DISPONIBLE') as free_state_bunches,
      coalesce(sum(source.stems) filter (where source.state = 'DISPONIBLE'), 0) as free_state_stems
    from inventory source group by source.key
  ), reservations as (
    select reservation.dimension_key,
      coalesce(sum(greatest(reservation.reserved_quantity - reservation.assigned_quantity - reservation.released_quantity, 0))
        filter (where reservation.status in ('ACTIVE','PARTIAL')), 0) as unassigned_reserved,
      coalesce(sum(greatest(reservation.reserved_quantity - reservation.assigned_quantity - reservation.released_quantity, 0) * reservation.stems_per_bunch)
        filter (where reservation.status in ('ACTIVE','PARTIAL')), 0) as unassigned_reserved_stems
    from public.erp_order_reservation_registry reservation
    where reservation.company_id = p_company_id group by reservation.dimension_key
  )
  select inventory.key, inventory.variety, inventory.length, inventory.quality,
    inventory.physical_bunches, inventory.physical_stems,
    coalesce(reservations.unassigned_reserved, 0)::numeric, inventory.assigned_bunches,
    inventory.packed_bunches, inventory.blocked_bunches,
    greatest(inventory.free_state_bunches - coalesce(reservations.unassigned_reserved, 0), 0)::numeric,
    greatest(inventory.free_state_stems - coalesce(reservations.unassigned_reserved_stems, 0), 0)::numeric
  from inventory_grouped inventory
  left join reservations on reservations.dimension_key = inventory.key
  order by inventory.variety, inventory.length, inventory.quality;
end;
$$;

create or replace function public.erp_warehouse_v2_create_box(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_box_number integer,
  p_box_type text,
  p_capacity_bunches integer,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_order public.erp_entity_records%rowtype;
  v_box public.erp_order_box_registry%rowtype;
  v_saved jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null
     or p_box_number <= 0 or p_capacity_bunches <= 0 or nullif(btrim(p_box_type), '') is null then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_CREATE_BOX_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':BOX:' || p_order_id || ':' || p_box_number::text, 0));
  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.payload ->> 'dispatchStatus', v_order.payload ->> 'status', '')) = 'DISPATCHED' then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_DISPATCHED_ORDER_IMMUTABLE';
  end if;
  if upper(coalesce(v_order.payload ->> 'status', '')) in ('ANULADO','ENVIADO','DISPATCHED') then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_ORDER_STATE_INVALID';
  end if;
  select * into v_box from public.erp_order_box_registry box
  where box.company_id = p_company_id and box.order_id = p_order_id and box.box_number = p_box_number for update;
  if not found then
    insert into public.erp_order_box_registry(
      company_id, box_id, box_code, order_id, box_number, box_type, capacity_bunches,
      created_by, updated_by, last_operation_id
    ) values (
      p_company_id, gen_random_uuid(), public.erp_warehouse_v2_next_box_code(p_company_id), p_order_id,
      p_box_number, upper(btrim(p_box_type)), p_capacity_bunches, auth.uid(), auth.uid(), p_operation_id
    ) returning * into v_box;
  end if;
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_order_boxes', v_box.box_id::text,
    jsonb_build_object(
      'id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
      'orderId', v_box.order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
      'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
      'status', v_box.status, 'createdAt', v_box.created_at, 'updatedAtServer', v_box.updated_at,
      'syncFlow', 'WAREHOUSE_V2'
    ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0)
  );
  v_result := jsonb_build_object('ok', true, 'command', 'CREATE_ORDER_BOX', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', jsonb_build_array(v_saved),
    'result', jsonb_build_object('status', v_box.status, 'boxId', v_box.box_id, 'boxCode', v_box.box_code));
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'CREATE_ORDER_BOX', v_box.box_id::text,
    jsonb_build_object('orderId', p_order_id, 'boxNumber', p_box_number), v_result,
    'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_reserve_order(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_allow_partial boolean default true,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_order public.erp_entity_records%rowtype;
  v_line jsonb;
  v_box_row record;
  v_reservation public.erp_order_reservation_registry%rowtype;
  v_reservation_exists boolean;
  v_box public.erp_order_box_registry%rowtype;
  v_line_id text;
  v_variety text;
  v_length numeric;
  v_quality text;
  v_dimension text;
  v_requested integer;
  v_stems numeric;
  v_available integer;
  v_other_reserved integer;
  v_assignable integer;
  v_target integer;
  v_reserved integer;
  v_previous_reserved integer;
  v_required_total integer := 0;
  v_reserved_total integer := 0;
  v_partial_count integer := 0;
  v_box_capacity integer;
  v_box_type text;
  v_saved jsonb;
  v_saved_order jsonb;
  v_records jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_RESERVE_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ORDER:' || p_order_id, 0));
  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.payload ->> 'inventoryMode', 'WITH_INVENTORY')) = 'NO_INVENTORY'
     or coalesce((v_order.payload ->> 'affectsInventory')::boolean, true) = false then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_ORDER_WITHOUT_INVENTORY';
  end if;
  if upper(coalesce(v_order.payload ->> 'status', '')) in ('ANULADO','ENVIADO','DISPATCHED') then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_ORDER_STATE_INVALID';
  end if;
  if jsonb_typeof(coalesce(v_order.payload -> 'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(v_order.payload -> 'lines', '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_ORDER_WITHOUT_LINES';
  end if;

  -- Un bloqueo por empresa serializa la decisión de cantidad. Los escaneos
  -- posteriores usan bloqueos más granulares por ramo y pedido.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':RESERVATIONS', 0));

  -- Una línea eliminada del pedido debe liberar su compromiso. Si ya tiene
  -- ramos físicos asignados/empacados, la edición se rechaza para evitar
  -- separar silenciosamente la caja de su trazabilidad.
  for v_reservation in
    select * from public.erp_order_reservation_registry reservation
    where reservation.company_id = p_company_id and reservation.order_id = p_order_id
      and reservation.status not in ('RELEASED','CANCELLED')
      and not exists (
        select 1 from jsonb_array_elements(v_order.payload -> 'lines') line
        where coalesce(line ->> 'id', '') = reservation.order_line_id
      ) for update
  loop
    if v_reservation.assigned_quantity > 0 or v_reservation.packed_quantity > 0 then
      raise exception using errcode = '23514', message = format('WAREHOUSE_V2_REMOVED_LINE_HAS_ASSIGNMENTS:%s', v_reservation.order_line_id);
    end if;
    update public.erp_order_reservation_registry set
      released_quantity = greatest(reserved_quantity, released_quantity), status = 'RELEASED',
      updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
    where company_id = p_company_id and reservation_id = v_reservation.reservation_id returning * into v_reservation;
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'commercial_order_reservations', v_reservation.reservation_id::text,
      jsonb_build_object('id', v_reservation.reservation_id::text, 'reservationId', v_reservation.reservation_id::text,
        'orderId', p_order_id, 'orderLineId', v_reservation.order_line_id, 'dimensionKey', v_reservation.dimension_key,
        'variety', v_reservation.variety, 'length', v_reservation.length, 'quality', v_reservation.quality,
        'stemsPerBunch', v_reservation.stems_per_bunch, 'requestedQuantity', v_reservation.requested_quantity,
        'reservedQuantity', v_reservation.reserved_quantity, 'assignedQuantity', 0, 'packedQuantity', 0,
        'releasedQuantity', v_reservation.released_quantity, 'status', 'RELEASED',
        'releaseReason', 'Línea retirada del pedido', 'updatedAtServer', v_now, 'syncFlow', 'WAREHOUSE_V2'),
      coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'commercial_order_reservations' and record_id = v_reservation.reservation_id::text), 0));
    v_records := v_records || jsonb_build_array(v_saved);
    v_saved := public.erp_warehouse_v2_write_movement(p_company_id, p_operation_id, p_device_id,
      'RELEASE_RESERVATION', jsonb_build_object('reservationId', v_reservation.reservation_id::text,
        'orderId', p_order_id, 'orderLineId', v_reservation.order_line_id,
        'dimensionKey', v_reservation.dimension_key, 'quantity', v_reservation.released_quantity,
        'reason', 'Línea retirada del pedido'));
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  for v_box in
    select * from public.erp_order_box_registry box
    where box.company_id = p_company_id and box.order_id = p_order_id
      and not exists (
        select 1 from jsonb_array_elements(v_order.payload -> 'lines') line
        where coalesce(nullif(line ->> 'boxNumber', '')::integer, 0) = box.box_number
      ) and box.status <> 'CANCELLED' for update
  loop
    if v_box.packed_bunches > 0 then
      raise exception using errcode = '23514', message = format('WAREHOUSE_V2_REMOVED_BOX_HAS_PACKED_BUNCHES:%s', v_box.box_number);
    end if;
    update public.erp_order_box_registry set status = 'CANCELLED', updated_by = auth.uid(),
      updated_at = v_now, last_operation_id = p_operation_id
    where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_order_boxes', v_box.box_id::text,
      jsonb_build_object('id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
        'orderId', p_order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
        'capacityBunches', v_box.capacity_bunches, 'packedBunches', 0, 'status', 'CANCELLED',
        'cancelReason', 'Caja retirada del pedido', 'updatedAtServer', v_now, 'syncFlow', 'WAREHOUSE_V2'),
      coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0));
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  for v_line in select value from jsonb_array_elements(v_order.payload -> 'lines') loop
    v_line_id := coalesce(nullif(v_line ->> 'id', ''), gen_random_uuid()::text);
    v_variety := upper(btrim(coalesce(v_line ->> 'variety', '')));
    v_length := coalesce(nullif(v_line ->> 'length', '')::numeric, 0);
    v_quality := upper(btrim(coalesce(v_line ->> 'quality', 'EXPORTACION')));
    v_requested := greatest(coalesce(nullif(v_line ->> 'bunches', '')::integer, 0), 0);
    v_stems := greatest(coalesce(nullif(v_line ->> 'stemsPerBunch', '')::numeric, 0), 0);
    v_required_total := v_required_total + v_requested;
    if v_requested <= 0 then continue; end if;

    if upper(coalesce(v_line ->> 'boxBuildMode', '')) = 'MIXTO_ABIERTO'
       or v_variety = 'MIXTO ABIERTO' then
      v_dimension := 'MIXED_OPEN|' || v_line_id;
      select * into v_reservation from public.erp_order_reservation_registry reservation
      where reservation.company_id = p_company_id and reservation.order_id = p_order_id
        and reservation.order_line_id = v_line_id for update;
      v_reservation_exists := found;
      v_previous_reserved := coalesce(v_reservation.reserved_quantity, 0);
      if not v_reservation_exists then
        insert into public.erp_order_reservation_registry(
          company_id, reservation_id, order_id, order_line_id, dimension_key, variety, length, quality,
          stems_per_bunch, requested_quantity, reserved_quantity, status,
          created_by, updated_by, last_operation_id
        ) values (
          p_company_id, gen_random_uuid(), p_order_id, v_line_id, v_dimension, 'MIXTO ABIERTO', v_length,
          v_quality, v_stems, v_requested, 0, 'PENDING_SELECTION', auth.uid(), auth.uid(), p_operation_id
        ) returning * into v_reservation;
      else
        update public.erp_order_reservation_registry set
          requested_quantity = v_requested, stems_per_bunch = v_stems,
          status = case when packed_quantity >= v_requested then 'CONSUMED' else 'PENDING_SELECTION' end,
          updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
        where company_id = p_company_id and reservation_id = v_reservation.reservation_id
        returning * into v_reservation;
      end if;
      v_partial_count := v_partial_count + case when v_reservation.packed_quantity < v_requested then 1 else 0 end;
    else
      if v_variety = '' or v_length <= 0 then
        raise exception using errcode = '22023', message = format('WAREHOUSE_V2_LINE_INVALID:%s', v_line_id);
      end if;
      v_dimension := public.erp_warehouse_v2_dimension_key(v_variety, v_length, v_quality);
      perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':DIM:' || v_dimension, 0));
      select * into v_reservation from public.erp_order_reservation_registry reservation
      where reservation.company_id = p_company_id and reservation.order_id = p_order_id
        and reservation.order_line_id = v_line_id for update;
      v_reservation_exists := found;
      v_previous_reserved := coalesce(v_reservation.reserved_quantity, 0);

      select count(*)::integer into v_available
      from public.erp_entity_records inventory
      where inventory.company_id = p_company_id and inventory.entity = 'operations_rose_inventory'
        and inventory.deleted_at is null and inventory.payload ->> 'sourceType' = 'ESCANEO_ETIQUETA'
        and upper(coalesce(inventory.payload ->> 'state', '')) = 'DISPONIBLE'
        and public.erp_warehouse_v2_dimension_key(
          inventory.payload ->> 'variety', coalesce(nullif(inventory.payload ->> 'length', '')::numeric, 0),
          coalesce(inventory.payload ->> 'quality', inventory.payload ->> 'category', 'EXPORTACION')
        ) = v_dimension;
      select coalesce(sum(greatest(reserved_quantity - assigned_quantity - released_quantity, 0)), 0)::integer
      into v_other_reserved
      from public.erp_order_reservation_registry reservation
      where reservation.company_id = p_company_id and reservation.dimension_key = v_dimension
        and reservation.status in ('ACTIVE','PARTIAL')
        and (v_reservation.reservation_id is null or reservation.reservation_id <> v_reservation.reservation_id);
      v_assignable := greatest(v_available - v_other_reserved, 0);
      v_target := greatest(v_requested - coalesce(v_reservation.assigned_quantity, 0), 0);
      if not p_allow_partial and v_assignable < v_target then
        raise exception using errcode = '23514', message = format('WAREHOUSE_V2_INSUFFICIENT_AVAILABILITY:%s:%s:%s', v_dimension, v_target, v_assignable);
      end if;
      v_reserved := coalesce(v_reservation.assigned_quantity, 0) + least(v_target, v_assignable);
      if not v_reservation_exists then
        insert into public.erp_order_reservation_registry(
          company_id, reservation_id, order_id, order_line_id, dimension_key, variety, length, quality,
          stems_per_bunch, requested_quantity, reserved_quantity, status,
          created_by, updated_by, last_operation_id
        ) values (
          p_company_id, gen_random_uuid(), p_order_id, v_line_id, v_dimension, v_variety, v_length, v_quality,
          v_stems, v_requested, v_reserved,
          case when v_reserved >= v_requested then 'ACTIVE' when v_reserved > 0 then 'PARTIAL' else 'PENDING' end,
          auth.uid(), auth.uid(), p_operation_id
        ) returning * into v_reservation;
      else
        if v_requested < v_reservation.assigned_quantity then
          raise exception using errcode = '23514', message = format('WAREHOUSE_V2_LINE_BELOW_ASSIGNED:%s', v_line_id);
        end if;
        update public.erp_order_reservation_registry set
          dimension_key = v_dimension, variety = v_variety, length = v_length, quality = v_quality,
          stems_per_bunch = v_stems, requested_quantity = v_requested, reserved_quantity = v_reserved,
          released_quantity = 0,
          status = case when v_reservation.packed_quantity >= v_requested then 'CONSUMED'
            when v_reserved >= v_requested then 'ACTIVE' when v_reserved > 0 then 'PARTIAL' else 'PENDING' end,
          updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
        where company_id = p_company_id and reservation_id = v_reservation.reservation_id
        returning * into v_reservation;
      end if;
      v_reserved_total := v_reserved_total + v_reservation.reserved_quantity;
      v_partial_count := v_partial_count + case when v_reservation.reserved_quantity < v_requested then 1 else 0 end;
    end if;

    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'commercial_order_reservations', v_reservation.reservation_id::text,
      jsonb_build_object(
        'id', v_reservation.reservation_id::text, 'reservationId', v_reservation.reservation_id::text,
        'orderId', p_order_id, 'orderLineId', v_line_id, 'dimensionKey', v_reservation.dimension_key,
        'variety', v_reservation.variety, 'length', v_reservation.length, 'quality', v_reservation.quality,
        'stemsPerBunch', v_reservation.stems_per_bunch, 'requestedQuantity', v_reservation.requested_quantity,
        'reservedQuantity', v_reservation.reserved_quantity, 'assignedQuantity', v_reservation.assigned_quantity,
        'packedQuantity', v_reservation.packed_quantity, 'releasedQuantity', v_reservation.released_quantity,
        'status', v_reservation.status, 'createdAt', v_reservation.created_at, 'updatedAtServer', v_reservation.updated_at,
        'syncFlow', 'WAREHOUSE_V2'
      ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'commercial_order_reservations' and record_id = v_reservation.reservation_id::text), 0)
    );
    v_records := v_records || jsonb_build_array(v_saved);
    if v_reservation.reserved_quantity > v_previous_reserved then
      v_saved := public.erp_warehouse_v2_write_movement(
        p_company_id, p_operation_id, p_device_id, 'RESERVE',
        jsonb_build_object('reservationId', v_reservation.reservation_id::text, 'orderId', p_order_id,
          'orderLineId', v_line_id, 'dimensionKey', v_reservation.dimension_key,
          'quantity', v_reservation.reserved_quantity - v_previous_reserved,
          'variety', v_reservation.variety, 'length', v_reservation.length, 'quality', v_reservation.quality)
      );
      v_records := v_records || jsonb_build_array(v_saved);
    end if;
  end loop;

  for v_box_row in
    select (line ->> 'boxNumber')::integer as box_number,
      max(upper(coalesce(line ->> 'boxType', 'CAJA'))) as box_type,
      sum(greatest(coalesce(nullif(line ->> 'bunches', '')::integer, 0), 0))::integer as capacity
    from jsonb_array_elements(v_order.payload -> 'lines') line
    group by (line ->> 'boxNumber')::integer
  loop
    if v_box_row.box_number <= 0 or v_box_row.capacity <= 0 then continue; end if;
    select * into v_box from public.erp_order_box_registry box
    where box.company_id = p_company_id and box.order_id = p_order_id and box.box_number = v_box_row.box_number for update;
    if not found then
      insert into public.erp_order_box_registry(
        company_id, box_id, box_code, order_id, box_number, box_type, capacity_bunches,
        created_by, updated_by, last_operation_id
      ) values (
        p_company_id, gen_random_uuid(), public.erp_warehouse_v2_next_box_code(p_company_id), p_order_id,
        v_box_row.box_number, v_box_row.box_type, v_box_row.capacity, auth.uid(), auth.uid(), p_operation_id
      ) returning * into v_box;
    else
      if v_box_row.capacity < v_box.packed_bunches then
        raise exception using errcode = '23514', message = format('WAREHOUSE_V2_BOX_BELOW_PACKED:%s', v_box_row.box_number);
      end if;
      update public.erp_order_box_registry set
        box_type = v_box_row.box_type, capacity_bunches = v_box_row.capacity,
        updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
      where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
    end if;
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_order_boxes', v_box.box_id::text,
      jsonb_build_object(
        'id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
        'orderId', p_order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
        'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
        'status', v_box.status, 'createdAt', v_box.created_at, 'updatedAtServer', v_box.updated_at,
        'syncFlow', 'WAREHOUSE_V2'
      ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0)
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  v_saved_order := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'commercial_orders', p_order_id,
    v_order.payload || jsonb_build_object(
      'reservationStatus', case when v_partial_count = 0 then 'RESERVED' when v_reserved_total > 0 then 'PARTIAL' else 'PENDING' end,
      'availabilityCommitmentStatus', case when v_partial_count = 0 then 'RESERVADO' when v_reserved_total > 0 then 'PARCIAL' else 'PENDIENTE' end,
      'requiredBunches', v_required_total, 'reservedBunches', v_reserved_total,
      'reservationUpdatedAt', v_now, 'warehouseFlowVersion', 2
    ), v_order.version
  );
  v_records := v_records || jsonb_build_array(v_saved_order);
  v_result := jsonb_build_object(
    'ok', true, 'command', 'RESERVE_ORDER', 'operationId', p_operation_id, 'serverTime', v_now,
    'records', v_records,
    'result', jsonb_build_object(
      'status', case when v_partial_count = 0 then 'RESERVED' when v_reserved_total > 0 then 'PARTIAL' else 'PENDING' end,
      'requiredBunches', v_required_total, 'reservedBunches', v_reserved_total, 'partialLines', v_partial_count
    )
  );
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'RESERVE_ORDER', p_order_id,
    jsonb_build_object('allowPartial', p_allow_partial), v_result, 'CONFIRMED', auth.uid(), p_device_id,
    coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_scan_into_box(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_box_number integer,
  p_label_code text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_label public.erp_zebra_label_registry%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_bunch public.erp_entity_records%rowtype;
  v_order public.erp_entity_records%rowtype;
  v_box public.erp_order_box_registry%rowtype;
  v_assignment public.erp_bunch_order_assignment_registry%rowtype;
  v_reservation public.erp_order_reservation_registry%rowtype;
  v_code text := upper(regexp_replace(coalesce(p_label_code, ''), '\s+', '', 'g'));
  v_line jsonb;
  v_lines jsonb;
  v_scan jsonb;
  v_line_index integer;
  v_line_id text;
  v_variety text;
  v_length numeric;
  v_quality text;
  v_dimension text;
  v_available integer;
  v_reserved_elsewhere integer;
  v_required_total integer;
  v_packed_total integer;
  v_saved_inventory jsonb;
  v_saved_bunch jsonb;
  v_saved_assignment jsonb;
  v_saved_reservation jsonb;
  v_saved_box jsonb;
  v_saved_order jsonb;
  v_saved_assign_movement jsonb;
  v_saved_pack_movement jsonb;
  v_saved_close_movement jsonb;
  v_records jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null
     or p_box_number <= 0 or v_code !~ '^\d{10}$' then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_SCAN_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;

  select * into v_label from public.erp_zebra_label_registry label
  where label.company_id = p_company_id and label.label_code = v_code for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_LABEL_NOT_FOUND'; end if;
  if v_label.status <> 'RECEIVED_IN_INVENTORY' or v_label.inventory_record_id is null then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_BUNCH_NOT_RECEIVED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':BUNCH:' || v_label.bunch_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ORDER:' || p_order_id, 0));

  select * into v_assignment from public.erp_bunch_order_assignment_registry assignment
  where assignment.company_id = p_company_id and assignment.bunch_id = v_label.bunch_id for update;
  if found and v_assignment.status in ('ASSIGNED','PACKED','CANCEL_REVIEW_REQUIRED') then
    if v_assignment.order_id = p_order_id and v_assignment.status = 'PACKED' then
      select coalesce(jsonb_agg(to_jsonb(record) order by record.entity, record.record_id), '[]'::jsonb)
      into v_records from public.erp_entity_records record
      where record.company_id = p_company_id and record.deleted_at is null and (
        (record.entity = 'commercial_orders' and record.record_id = p_order_id)
        or (record.entity = 'operations_rose_inventory' and record.record_id = v_assignment.inventory_record_id)
        or (record.entity = 'operations_bunch_order_assignments' and record.record_id = v_label.bunch_id::text)
        or (record.entity = 'operations_order_boxes' and record.record_id = v_assignment.box_id::text)
      );
      v_result := jsonb_build_object('ok', true, 'command', 'SCAN_BUNCH_INTO_BOX', 'operationId', p_operation_id,
        'serverTime', v_now, 'records', v_records,
        'result', jsonb_build_object('status', 'ALREADY_PACKED', 'bunchId', v_label.bunch_id,
          'orderId', p_order_id, 'boxId', v_assignment.box_id));
      insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
        request_payload, result, status, user_id, device_id, local_created_at)
      values (p_operation_id, p_company_id, 'SCAN_BUNCH_ALREADY_PACKED', v_label.bunch_id::text,
        jsonb_build_object('orderId', p_order_id, 'labelCode', v_code), v_result, 'CONFIRMED', auth.uid(), p_device_id,
        coalesce(p_local_created_at, now()));
      return v_result;
    end if;
    raise exception using errcode = '23505', message = format('WAREHOUSE_V2_BUNCH_ALREADY_ASSIGNED:%s', v_assignment.order_id);
  end if;

  select * into v_inventory from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_rose_inventory'
    and record.record_id = v_label.inventory_record_id and record.deleted_at is null for update;
  select * into v_bunch from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_bunches'
    and record.record_id = v_label.bunch_id::text and record.deleted_at is null for update;
  if v_inventory.record_id is null or v_bunch.record_id is null then
    raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_BUNCH_LINK_BROKEN';
  end if;
  if upper(coalesce(v_inventory.payload ->> 'state', '')) not in ('DISPONIBLE','ASIGNADO_LOCAL') then
    raise exception using errcode = '23514', message = format('WAREHOUSE_V2_BUNCH_STATE_INVALID:%s', coalesce(v_inventory.payload ->> 'state', ''));
  end if;

  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.payload ->> 'status', '')) not in ('GUARDADO','EN_CUARTO_FRIO','EN_PROCESO','IN_PACKING') then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_ORDER_STATE_INVALID';
  end if;
  if upper(coalesce(v_inventory.payload ->> 'state', '')) = 'ASIGNADO_LOCAL'
     and nullif(coalesce(v_inventory.payload ->> 'localDestinationCustomerId', ''), '') is distinct from
       nullif(coalesce(v_order.payload ->> 'customerId', ''), '') then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_LOCAL_BUNCH_CUSTOMER_MISMATCH';
  end if;
  select * into v_box from public.erp_order_box_registry box
  where box.company_id = p_company_id and box.order_id = p_order_id and box.box_number = p_box_number for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_BOX_NOT_FOUND'; end if;
  if v_box.status not in ('OPEN','REOPENED') then
    raise exception using errcode = '23514', message = format('WAREHOUSE_V2_BOX_NOT_OPEN:%s', v_box.status);
  end if;
  if v_box.packed_bunches >= v_box.capacity_bunches then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_BOX_CAPACITY_EXCEEDED';
  end if;

  v_variety := upper(btrim(coalesce(v_inventory.payload ->> 'variety', '')));
  v_length := coalesce(nullif(v_inventory.payload ->> 'length', '')::numeric, 0);
  v_quality := upper(btrim(coalesce(v_inventory.payload ->> 'quality', v_inventory.payload ->> 'category', 'EXPORTACION')));
  v_dimension := public.erp_warehouse_v2_dimension_key(v_variety, v_length, v_quality);
  select item.value, (item.ordinality - 1)::integer
  into v_line, v_line_index
  from jsonb_array_elements(coalesce(v_order.payload -> 'lines', '[]'::jsonb)) with ordinality item(value, ordinality)
  where coalesce(nullif(item.value ->> 'boxNumber', '')::integer, 0) = p_box_number
    and jsonb_array_length(coalesce(item.value -> 'scannedBunches', '[]'::jsonb))
      < greatest(coalesce(nullif(item.value ->> 'bunches', '')::integer, 0), 0)
    and (
      (
        upper(coalesce(item.value ->> 'boxBuildMode', '')) = 'MIXTO_ABIERTO'
        and not (coalesce(item.value -> 'mixedExcludedVarieties', '[]'::jsonb) ? v_variety)
        and (coalesce((item.value ->> 'anyLength')::boolean, false)
          or coalesce((item.value ->> 'mixedAnyLength')::boolean, true)
          or coalesce(nullif(item.value ->> 'length', '')::numeric, 0) = v_length)
      )
      or (
        upper(coalesce(item.value ->> 'variety', '')) = v_variety
        and (coalesce((item.value ->> 'anyLength')::boolean, false)
          or coalesce(nullif(item.value ->> 'length', '')::numeric, 0) = v_length)
      )
    )
  order by item.ordinality limit 1;
  if v_line is null then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_BUNCH_DOES_NOT_MATCH_ORDER_LINE';
  end if;
  v_line_id := v_line ->> 'id';
  select * into v_reservation from public.erp_order_reservation_registry reservation
  where reservation.company_id = p_company_id and reservation.order_id = p_order_id
    and reservation.order_line_id = v_line_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_RESERVATION_NOT_FOUND'; end if;

  if v_reservation.reserved_quantity <= v_reservation.assigned_quantity then
    if upper(coalesce(v_inventory.payload ->> 'state', '')) <> 'ASIGNADO_LOCAL' then
      perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':DIM:' || v_dimension, 0));
      select count(*)::integer into v_available
      from public.erp_entity_records inventory
      where inventory.company_id = p_company_id and inventory.entity = 'operations_rose_inventory'
        and inventory.deleted_at is null and inventory.payload ->> 'sourceType' = 'ESCANEO_ETIQUETA'
        and upper(coalesce(inventory.payload ->> 'state', '')) = 'DISPONIBLE'
        and public.erp_warehouse_v2_dimension_key(
          inventory.payload ->> 'variety', coalesce(nullif(inventory.payload ->> 'length', '')::numeric, 0),
          coalesce(inventory.payload ->> 'quality', inventory.payload ->> 'category', 'EXPORTACION')
        ) = v_dimension;
      select coalesce(sum(greatest(reserved_quantity - assigned_quantity - released_quantity, 0)), 0)::integer
      into v_reserved_elsewhere
      from public.erp_order_reservation_registry reservation
      where reservation.company_id = p_company_id and reservation.dimension_key = v_dimension
        and reservation.status in ('ACTIVE','PARTIAL') and reservation.reservation_id <> v_reservation.reservation_id;
      if greatest(v_available - v_reserved_elsewhere, 0) <= 0 then
        raise exception using errcode = '23514', message = 'WAREHOUSE_V2_BUNCH_RESERVED_FOR_ANOTHER_ORDER';
      end if;
    end if;
    v_reservation.reserved_quantity := v_reservation.reserved_quantity + 1;
  end if;

  v_reservation.assigned_quantity := v_reservation.assigned_quantity + 1;
  v_reservation.packed_quantity := v_reservation.packed_quantity + 1;
  v_reservation.dimension_key := case when v_reservation.status = 'PENDING_SELECTION' then v_reservation.dimension_key else v_dimension end;
  v_reservation.status := case when v_reservation.packed_quantity >= v_reservation.requested_quantity then 'CONSUMED' else 'ACTIVE' end;
  update public.erp_order_reservation_registry set
    reserved_quantity = v_reservation.reserved_quantity, assigned_quantity = v_reservation.assigned_quantity,
    packed_quantity = v_reservation.packed_quantity, status = v_reservation.status,
    updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
  where company_id = p_company_id and reservation_id = v_reservation.reservation_id
  returning * into v_reservation;

  if v_assignment.bunch_id is null then
    insert into public.erp_bunch_order_assignment_registry(
      company_id, bunch_id, inventory_record_id, order_id, order_line_id, reservation_id, box_id,
      status, assigned_at, packed_at, created_by, updated_by, last_operation_id
    ) values (
      p_company_id, v_label.bunch_id, v_inventory.record_id, p_order_id, v_line_id,
      v_reservation.reservation_id, v_box.box_id, 'PACKED', v_now, v_now, auth.uid(), auth.uid(), p_operation_id
    ) returning * into v_assignment;
  else
    update public.erp_bunch_order_assignment_registry set
      inventory_record_id = v_inventory.record_id, order_id = p_order_id, order_line_id = v_line_id,
      reservation_id = v_reservation.reservation_id, box_id = v_box.box_id, status = 'PACKED',
      assigned_at = v_now, packed_at = v_now, unassigned_at = null,
      updated_by = auth.uid(), last_operation_id = p_operation_id
    where company_id = p_company_id and bunch_id = v_label.bunch_id returning * into v_assignment;
  end if;

  update public.erp_order_box_registry set
    packed_bunches = packed_bunches + 1,
    status = case when packed_bunches + 1 >= capacity_bunches then 'CLOSED' else status end,
    closed_at = case when packed_bunches + 1 >= capacity_bunches then v_now else closed_at end,
    closed_by = case when packed_bunches + 1 >= capacity_bunches then auth.uid() else closed_by end,
    updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
  where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;

  v_scan := jsonb_build_object(
    'code', v_code, 'labelCode', v_code, 'bunchId', v_label.bunch_id::text,
    'inventoryId', v_inventory.record_id, 'boxId', v_box.box_id::text,
    'variety', v_variety, 'length', v_length,
    'stems', coalesce(nullif(v_inventory.payload ->> 'stems', '')::numeric,
      nullif(v_inventory.payload ->> 'stemsPerBunch', '')::numeric, 0),
    'scannedAt', v_now, 'assignedAt', v_now, 'packedAt', v_now, 'syncFlow', 'WAREHOUSE_V2'
  );
  v_line := jsonb_set(v_line, '{scannedBunches}', coalesce(v_line -> 'scannedBunches', '[]'::jsonb) || jsonb_build_array(v_scan), true);
  if upper(coalesce(v_line ->> 'boxBuildMode', '')) = 'MIXTO_ABIERTO' then
    v_line := jsonb_set(v_line, '{mixedActualComposition}', coalesce(v_line -> 'mixedActualComposition', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('variety', v_variety, 'length', v_length, 'bunches', 1,
        'stems', v_scan -> 'stems', 'code', v_code, 'bunchId', v_label.bunch_id::text)), true);
  end if;
  v_lines := jsonb_set(v_order.payload -> 'lines', array[v_line_index::text], v_line, true);
  select coalesce(sum(greatest(coalesce(nullif(line ->> 'bunches', '')::integer, 0), 0)), 0)::integer,
    coalesce(sum(jsonb_array_length(coalesce(line -> 'scannedBunches', '[]'::jsonb))), 0)::integer
  into v_required_total, v_packed_total from jsonb_array_elements(v_lines) line;

  v_saved_inventory := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_rose_inventory', v_inventory.record_id,
    (v_inventory.payload - 'previousState') || jsonb_build_object(
      'previousState', v_inventory.payload ->> 'state', 'state', 'PACKED', 'available', false,
      'orderId', p_order_id, 'orderLineId', v_line_id, 'boxId', v_box.box_id::text,
      'boxNumber', p_box_number, 'assignedAt', v_now, 'packedAt', v_now, 'syncFlow', 'WAREHOUSE_V2'
    ), v_inventory.version
  );
  v_saved_bunch := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch.record_id,
    v_bunch.payload || jsonb_build_object(
      'state', 'PACKED', 'availabilityState', 'PACKED', 'available', false,
      'orderId', p_order_id, 'orderLineId', v_line_id, 'boxId', v_box.box_id::text,
      'packedAt', v_now, 'syncFlow', 'WAREHOUSE_V2'
    ), v_bunch.version
  );
  v_saved_assignment := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_bunch_order_assignments', v_label.bunch_id::text,
    jsonb_build_object(
      'id', v_label.bunch_id::text, 'bunchId', v_label.bunch_id::text, 'inventoryId', v_inventory.record_id,
      'orderId', p_order_id, 'orderLineId', v_line_id, 'reservationId', v_reservation.reservation_id::text,
      'boxId', v_box.box_id::text, 'boxNumber', p_box_number, 'status', 'PACKED',
      'assignedAt', v_now, 'packedAt', v_now, 'syncFlow', 'WAREHOUSE_V2'
    ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'operations_bunch_order_assignments' and record_id = v_label.bunch_id::text), 0)
  );
  v_saved_reservation := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'commercial_order_reservations', v_reservation.reservation_id::text,
    jsonb_build_object(
      'id', v_reservation.reservation_id::text, 'reservationId', v_reservation.reservation_id::text,
      'orderId', p_order_id, 'orderLineId', v_line_id, 'dimensionKey', v_reservation.dimension_key,
      'variety', v_reservation.variety, 'length', v_reservation.length, 'quality', v_reservation.quality,
      'stemsPerBunch', v_reservation.stems_per_bunch, 'requestedQuantity', v_reservation.requested_quantity,
      'reservedQuantity', v_reservation.reserved_quantity, 'assignedQuantity', v_reservation.assigned_quantity,
      'packedQuantity', v_reservation.packed_quantity, 'releasedQuantity', v_reservation.released_quantity,
      'status', v_reservation.status, 'createdAt', v_reservation.created_at, 'updatedAtServer', v_reservation.updated_at,
      'syncFlow', 'WAREHOUSE_V2'
    ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'commercial_order_reservations' and record_id = v_reservation.reservation_id::text), 0)
  );
  v_saved_box := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_order_boxes', v_box.box_id::text,
    jsonb_build_object(
      'id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
      'orderId', p_order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
      'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
      'status', v_box.status, 'closedAt', v_box.closed_at, 'createdAt', v_box.created_at,
      'updatedAtServer', v_box.updated_at, 'syncFlow', 'WAREHOUSE_V2'
    ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0)
  );
  v_saved_order := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'commercial_orders', p_order_id,
    v_order.payload || jsonb_build_object(
      'lines', v_lines, 'status', case when v_packed_total >= v_required_total then 'COMPLETADO' else 'EN_CUARTO_FRIO' end,
      'warehouseStatus', case when v_packed_total >= v_required_total then 'READY_FOR_DISPATCH' else 'IN_PACKING' end,
      'fulfillmentStatus', case when v_packed_total >= v_required_total then 'COMPLETADO' else 'INCOMPLETO' end,
      'requiredBunches', v_required_total, 'packedBunches', v_packed_total,
      'warehouseCompletedAt', case when v_packed_total >= v_required_total then v_now else null end,
      'warehouseFlowVersion', 2
    ), v_order.version
  );
  v_saved_assign_movement := public.erp_warehouse_v2_write_movement(
    p_company_id, p_operation_id, p_device_id, 'ASSIGN_TO_ORDER',
    jsonb_build_object('bunchId', v_label.bunch_id::text, 'inventoryId', v_inventory.record_id,
      'orderId', p_order_id, 'orderLineId', v_line_id, 'boxId', v_box.box_id::text,
      'fromState', 'DISPONIBLE', 'toState', 'ASSIGNED_TO_ORDER', 'quantity', 1,
      'variety', v_variety, 'length', v_length, 'quality', v_quality)
  );
  v_saved_pack_movement := public.erp_warehouse_v2_write_movement(
    p_company_id, p_operation_id, p_device_id, 'PACK_IN_BOX',
    jsonb_build_object('bunchId', v_label.bunch_id::text, 'inventoryId', v_inventory.record_id,
      'orderId', p_order_id, 'orderLineId', v_line_id, 'boxId', v_box.box_id::text,
      'fromState', 'ASSIGNED_TO_ORDER', 'toState', 'PACKED', 'quantity', 1,
      'variety', v_variety, 'length', v_length, 'quality', v_quality)
  );
  v_records := jsonb_build_array(v_saved_inventory, v_saved_bunch, v_saved_assignment,
    v_saved_reservation, v_saved_box, v_saved_order, v_saved_assign_movement, v_saved_pack_movement);
  if v_box.status = 'CLOSED' then
    v_saved_close_movement := public.erp_warehouse_v2_write_movement(
      p_company_id, p_operation_id, p_device_id, 'CLOSE_BOX',
      jsonb_build_object('orderId', p_order_id, 'boxId', v_box.box_id::text, 'boxNumber', p_box_number,
        'packedBunches', v_box.packed_bunches, 'capacityBunches', v_box.capacity_bunches,
        'observation', 'Cierre automático al completar la capacidad validada.')
    );
    v_records := v_records || jsonb_build_array(v_saved_close_movement);
  end if;
  v_result := jsonb_build_object('ok', true, 'command', 'SCAN_BUNCH_INTO_BOX', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object('status', 'PACKED', 'bunchId', v_label.bunch_id, 'labelCode', v_code,
      'orderId', p_order_id, 'orderLineId', v_line_id, 'boxId', v_box.box_id, 'boxNumber', p_box_number,
      'boxStatus', v_box.status, 'requiredBunches', v_required_total, 'packedBunches', v_packed_total,
      'orderComplete', v_packed_total >= v_required_total));
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'SCAN_BUNCH_INTO_BOX', v_label.bunch_id::text,
    jsonb_build_object('orderId', p_order_id, 'boxNumber', p_box_number, 'labelCode', v_code),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_unassign_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_label_code text,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_label public.erp_zebra_label_registry%rowtype;
  v_assignment public.erp_bunch_order_assignment_registry%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_bunch public.erp_entity_records%rowtype;
  v_order public.erp_entity_records%rowtype;
  v_box public.erp_order_box_registry%rowtype;
  v_reservation public.erp_order_reservation_registry%rowtype;
  v_code text := upper(regexp_replace(coalesce(p_label_code, ''), '\s+', '', 'g'));
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_scans jsonb;
  v_composition jsonb;
  v_required_total integer;
  v_packed_total integer;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null
     or nullif(btrim(p_reason), '') is null or v_code !~ '^\d{10}$' then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_UNASSIGN_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  select * into v_label from public.erp_zebra_label_registry label
  where label.company_id = p_company_id and label.label_code = v_code;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_LABEL_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':BUNCH:' || v_label.bunch_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ORDER:' || p_order_id, 0));
  select * into v_assignment from public.erp_bunch_order_assignment_registry assignment
  where assignment.company_id = p_company_id and assignment.bunch_id = v_label.bunch_id for update;
  if not found or v_assignment.status = 'UNASSIGNED' then
    v_result := jsonb_build_object('ok', true, 'command', 'UNASSIGN_BUNCH', 'operationId', p_operation_id,
      'serverTime', v_now, 'records', '[]'::jsonb,
      'result', jsonb_build_object('status', 'ALREADY_UNASSIGNED', 'bunchId', v_label.bunch_id));
    insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
      request_payload, result, status, user_id, device_id, local_created_at)
    values (p_operation_id, p_company_id, 'UNASSIGN_BUNCH_ALREADY_DONE', v_label.bunch_id::text,
      jsonb_build_object('orderId', p_order_id, 'reason', p_reason), v_result, 'CONFIRMED', auth.uid(), p_device_id,
      coalesce(p_local_created_at, now()));
    return v_result;
  end if;
  if v_assignment.order_id <> p_order_id then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_ASSIGNMENT_ORDER_MISMATCH';
  end if;
  select * into v_box from public.erp_order_box_registry box
  where box.company_id = p_company_id and box.box_id = v_assignment.box_id for update;
  if v_box.status = 'CLOSED' then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_REOPEN_BOX_BEFORE_UNASSIGN';
  end if;
  select * into v_inventory from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_rose_inventory'
    and record.record_id = v_assignment.inventory_record_id and record.deleted_at is null for update;
  select * into v_bunch from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_bunches'
    and record.record_id = v_label.bunch_id::text and record.deleted_at is null for update;
  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;
  select * into v_reservation from public.erp_order_reservation_registry reservation
  where reservation.company_id = p_company_id and reservation.reservation_id = v_assignment.reservation_id for update;
  if v_inventory.record_id is null or v_order.record_id is null or v_reservation.reservation_id is null then
    raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_UNASSIGN_LINK_BROKEN';
  end if;

  for v_line in select value from jsonb_array_elements(v_order.payload -> 'lines') loop
    if coalesce(v_line ->> 'id', '') = v_assignment.order_line_id then
      select coalesce(jsonb_agg(scan), '[]'::jsonb) into v_scans
      from jsonb_array_elements(coalesce(v_line -> 'scannedBunches', '[]'::jsonb)) scan
      where coalesce(scan ->> 'bunchId', '') <> v_label.bunch_id::text;
      v_line := jsonb_set(v_line, '{scannedBunches}', v_scans, true);
      if upper(coalesce(v_line ->> 'boxBuildMode', '')) = 'MIXTO_ABIERTO' then
        select coalesce(jsonb_agg(item), '[]'::jsonb) into v_composition
        from jsonb_array_elements(coalesce(v_line -> 'mixedActualComposition', '[]'::jsonb)) item
        where coalesce(item ->> 'bunchId', '') <> v_label.bunch_id::text;
        v_line := jsonb_set(v_line, '{mixedActualComposition}', v_composition, true);
      end if;
    end if;
    v_lines := v_lines || jsonb_build_array(v_line);
  end loop;
  select coalesce(sum(greatest(coalesce(nullif(line ->> 'bunches', '')::integer, 0), 0)), 0)::integer,
    coalesce(sum(jsonb_array_length(coalesce(line -> 'scannedBunches', '[]'::jsonb))), 0)::integer
  into v_required_total, v_packed_total from jsonb_array_elements(v_lines) line;

  update public.erp_bunch_order_assignment_registry set status = 'UNASSIGNED', unassigned_at = v_now,
    updated_by = auth.uid(), last_operation_id = p_operation_id
  where company_id = p_company_id and bunch_id = v_label.bunch_id returning * into v_assignment;
  update public.erp_order_box_registry set packed_bunches = greatest(packed_bunches - 1, 0),
    updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
  where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
  update public.erp_order_reservation_registry set assigned_quantity = greatest(assigned_quantity - 1, 0),
    packed_quantity = greatest(packed_quantity - 1, 0),
    status = case when reserved_quantity > 0 then 'ACTIVE' else 'PENDING' end,
    updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
  where company_id = p_company_id and reservation_id = v_reservation.reservation_id returning * into v_reservation;

  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'operations_rose_inventory', v_inventory.record_id,
    (v_inventory.payload - 'orderId' - 'orderLineId' - 'boxId' - 'boxNumber' - 'assignedAt' - 'packedAt')
      || jsonb_build_object('previousState', v_inventory.payload ->> 'state', 'state', 'DISPONIBLE',
        'available', true, 'unassignedAt', v_now, 'unassignedReason', btrim(p_reason), 'syncFlow', 'WAREHOUSE_V2'),
    v_inventory.version);
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'operations_bunches', v_bunch.record_id,
    (v_bunch.payload - 'orderId' - 'orderLineId' - 'boxId' - 'packedAt') || jsonb_build_object(
      'state', 'RECEIVED_IN_INVENTORY', 'availabilityState', 'DISPONIBLE', 'available', true,
      'unassignedAt', v_now, 'syncFlow', 'WAREHOUSE_V2'), v_bunch.version);
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'operations_bunch_order_assignments', v_label.bunch_id::text,
    jsonb_build_object('id', v_label.bunch_id::text, 'bunchId', v_label.bunch_id::text,
      'inventoryId', v_assignment.inventory_record_id, 'orderId', p_order_id,
      'orderLineId', v_assignment.order_line_id, 'reservationId', v_assignment.reservation_id::text,
      'boxId', v_assignment.box_id::text, 'status', 'UNASSIGNED', 'unassignedAt', v_now,
      'reason', btrim(p_reason), 'syncFlow', 'WAREHOUSE_V2'),
    coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'operations_bunch_order_assignments' and record_id = v_label.bunch_id::text), 0));
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'commercial_order_reservations', v_reservation.reservation_id::text,
    jsonb_build_object('id', v_reservation.reservation_id::text, 'reservationId', v_reservation.reservation_id::text,
      'orderId', p_order_id, 'orderLineId', v_reservation.order_line_id, 'dimensionKey', v_reservation.dimension_key,
      'variety', v_reservation.variety, 'length', v_reservation.length, 'quality', v_reservation.quality,
      'stemsPerBunch', v_reservation.stems_per_bunch, 'requestedQuantity', v_reservation.requested_quantity,
      'reservedQuantity', v_reservation.reserved_quantity, 'assignedQuantity', v_reservation.assigned_quantity,
      'packedQuantity', v_reservation.packed_quantity, 'releasedQuantity', v_reservation.released_quantity,
      'status', v_reservation.status, 'updatedAtServer', v_reservation.updated_at, 'syncFlow', 'WAREHOUSE_V2'),
    coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'commercial_order_reservations' and record_id = v_reservation.reservation_id::text), 0));
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'operations_order_boxes', v_box.box_id::text,
    jsonb_build_object('id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
      'orderId', p_order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
      'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
      'status', v_box.status, 'updatedAtServer', v_box.updated_at, 'syncFlow', 'WAREHOUSE_V2'),
    coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0));
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'commercial_orders', p_order_id,
    v_order.payload || jsonb_build_object('lines', v_lines, 'status', 'EN_CUARTO_FRIO',
      'warehouseStatus', 'IN_PACKING', 'fulfillmentStatus', case when v_packed_total > 0 then 'INCOMPLETO' else 'PENDIENTE' end,
      'requiredBunches', v_required_total, 'packedBunches', v_packed_total, 'warehouseCompletedAt', null,
      'warehouseFlowVersion', 2), v_order.version);
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_warehouse_v2_write_movement(p_company_id, p_operation_id, p_device_id, 'UNPACK_FROM_BOX',
    jsonb_build_object('bunchId', v_label.bunch_id::text, 'inventoryId', v_inventory.record_id,
      'orderId', p_order_id, 'boxId', v_box.box_id::text, 'quantity', 1, 'reason', btrim(p_reason)));
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_warehouse_v2_write_movement(p_company_id, p_operation_id, p_device_id, 'UNASSIGN_FROM_ORDER',
    jsonb_build_object('bunchId', v_label.bunch_id::text, 'inventoryId', v_inventory.record_id,
      'orderId', p_order_id, 'fromState', 'PACKED', 'toState', 'DISPONIBLE', 'quantity', 1,
      'reason', btrim(p_reason)));
  v_records := v_records || jsonb_build_array(v_saved);
  v_result := jsonb_build_object('ok', true, 'command', 'UNASSIGN_BUNCH', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object('status', 'UNASSIGNED', 'bunchId', v_label.bunch_id,
      'orderId', p_order_id, 'boxId', v_box.box_id));
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'UNASSIGN_BUNCH', v_label.bunch_id::text,
    jsonb_build_object('orderId', p_order_id, 'labelCode', v_code, 'reason', btrim(p_reason)),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_close_box(
  p_operation_id uuid, p_company_id uuid, p_device_id text, p_order_id text,
  p_box_number integer, p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_box public.erp_order_box_registry%rowtype;
  v_saved jsonb;
  v_movement jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null or p_box_number <= 0 then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_CLOSE_BOX_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  select * into v_box from public.erp_order_box_registry box
  where box.company_id = p_company_id and box.order_id = p_order_id and box.box_number = p_box_number for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_BOX_NOT_FOUND'; end if;
  if v_box.status = 'CLOSED' then
    v_result := jsonb_build_object('ok', true, 'command', 'CLOSE_BOX', 'operationId', p_operation_id,
      'serverTime', v_now, 'records', '[]'::jsonb, 'result', jsonb_build_object('status', 'ALREADY_CLOSED', 'boxId', v_box.box_id));
  else
    if v_box.packed_bunches <> v_box.capacity_bunches then
      raise exception using errcode = '23514', message = format('WAREHOUSE_V2_BOX_INCOMPLETE:%s:%s', v_box.packed_bunches, v_box.capacity_bunches);
    end if;
    update public.erp_order_box_registry set status = 'CLOSED', closed_at = v_now, closed_by = auth.uid(),
      updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
    where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
    v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
      'operations_order_boxes', v_box.box_id::text,
      jsonb_build_object('id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
        'orderId', p_order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
        'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
        'status', 'CLOSED', 'closedAt', v_now, 'syncFlow', 'WAREHOUSE_V2'),
      coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0));
    v_movement := public.erp_warehouse_v2_write_movement(p_company_id, p_operation_id, p_device_id, 'CLOSE_BOX',
      jsonb_build_object('orderId', p_order_id, 'boxId', v_box.box_id::text, 'boxNumber', p_box_number,
        'packedBunches', v_box.packed_bunches, 'capacityBunches', v_box.capacity_bunches));
    v_result := jsonb_build_object('ok', true, 'command', 'CLOSE_BOX', 'operationId', p_operation_id,
      'serverTime', v_now, 'records', jsonb_build_array(v_saved, v_movement),
      'result', jsonb_build_object('status', 'CLOSED', 'boxId', v_box.box_id));
  end if;
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'CLOSE_BOX', v_box.box_id::text,
    jsonb_build_object('orderId', p_order_id, 'boxNumber', p_box_number), v_result,
    'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_reopen_box(
  p_operation_id uuid, p_company_id uuid, p_device_id text, p_order_id text,
  p_box_number integer, p_reason text, p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_box public.erp_order_box_registry%rowtype;
  v_saved jsonb;
  v_movement jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null
     or p_box_number <= 0 or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_REOPEN_BOX_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  select * into v_box from public.erp_order_box_registry box
  where box.company_id = p_company_id and box.order_id = p_order_id and box.box_number = p_box_number for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_BOX_NOT_FOUND'; end if;
  if v_box.status not in ('CLOSED','REOPENED') then raise exception using errcode = '23514', message = 'WAREHOUSE_V2_BOX_NOT_CLOSED'; end if;
  update public.erp_order_box_registry set status = 'REOPENED', closed_at = null, closed_by = null,
    updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
  where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'operations_order_boxes', v_box.box_id::text,
    jsonb_build_object('id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
      'orderId', p_order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
      'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
      'status', 'REOPENED', 'reopenedAt', v_now, 'reopenReason', btrim(p_reason), 'syncFlow', 'WAREHOUSE_V2'),
    coalesce((select version from public.erp_entity_records where company_id = p_company_id
      and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0));
  v_movement := public.erp_warehouse_v2_write_movement(p_company_id, p_operation_id, p_device_id, 'REOPEN_BOX',
    jsonb_build_object('orderId', p_order_id, 'boxId', v_box.box_id::text, 'boxNumber', p_box_number,
      'reason', btrim(p_reason)));
  v_result := jsonb_build_object('ok', true, 'command', 'REOPEN_BOX', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', jsonb_build_array(v_saved, v_movement),
    'result', jsonb_build_object('status', 'REOPENED', 'boxId', v_box.box_id));
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'REOPEN_BOX', v_box.box_id::text,
    jsonb_build_object('orderId', p_order_id, 'boxNumber', p_box_number, 'reason', btrim(p_reason)),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_release_order_core(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_reason text,
  p_cancel_order boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.erp_entity_records%rowtype;
  v_reservation public.erp_order_reservation_registry%rowtype;
  v_assignment public.erp_bunch_order_assignment_registry%rowtype;
  v_box public.erp_order_box_registry%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_bunch public.erp_entity_records%rowtype;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_released integer := 0;
  v_review integer := 0;
  v_released_here integer;
begin
  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.payload ->> 'dispatchStatus', v_order.payload ->> 'status', '')) = 'DISPATCHED' then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_DISPATCHED_ORDER_IMMUTABLE';
  end if;

  -- Una asignación que todavía no fue empacada puede regresar al inventario.
  -- Una asignación PACKED conserva trazabilidad y exige revisión de caja.
  for v_assignment in
    select * from public.erp_bunch_order_assignment_registry assignment
    where assignment.company_id = p_company_id and assignment.order_id = p_order_id
      and assignment.status in ('ASSIGNED','PACKED') for update
  loop
    if v_assignment.status = 'ASSIGNED' then
      select * into v_inventory from public.erp_entity_records record
      where record.company_id = p_company_id and record.entity = 'operations_rose_inventory'
        and record.record_id = v_assignment.inventory_record_id and record.deleted_at is null for update;
      select * into v_bunch from public.erp_entity_records record
      where record.company_id = p_company_id and record.entity = 'operations_bunches'
        and record.record_id = v_assignment.bunch_id::text and record.deleted_at is null for update;
      if v_inventory.record_id is not null then
        v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
          'operations_rose_inventory', v_inventory.record_id,
          (v_inventory.payload - 'orderId' - 'orderLineId' - 'boxId' - 'boxNumber' - 'assignedAt')
            || jsonb_build_object('previousState', v_inventory.payload ->> 'state', 'state', 'DISPONIBLE',
              'available', true, 'releasedAt', v_now, 'releaseReason', btrim(p_reason), 'syncFlow', 'WAREHOUSE_V2'),
          v_inventory.version);
        v_records := v_records || jsonb_build_array(v_saved);
      end if;
      if v_bunch.record_id is not null then
        v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
          'operations_bunches', v_bunch.record_id,
          (v_bunch.payload - 'orderId' - 'orderLineId' - 'boxId') || jsonb_build_object(
            'state', 'RECEIVED_IN_INVENTORY', 'availabilityState', 'DISPONIBLE', 'available', true,
            'releasedAt', v_now, 'syncFlow', 'WAREHOUSE_V2'), v_bunch.version);
        v_records := v_records || jsonb_build_array(v_saved);
      end if;
      update public.erp_bunch_order_assignment_registry set status = 'UNASSIGNED', unassigned_at = v_now,
        updated_by = auth.uid(), last_operation_id = p_operation_id
      where company_id = p_company_id and bunch_id = v_assignment.bunch_id returning * into v_assignment;
      update public.erp_order_reservation_registry set assigned_quantity = greatest(assigned_quantity - 1, 0),
        updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
      where company_id = p_company_id and reservation_id = v_assignment.reservation_id;
      v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
        'operations_bunch_order_assignments', v_assignment.bunch_id::text,
        jsonb_build_object('id', v_assignment.bunch_id::text, 'bunchId', v_assignment.bunch_id::text,
          'inventoryId', v_assignment.inventory_record_id, 'orderId', p_order_id,
          'orderLineId', v_assignment.order_line_id, 'reservationId', v_assignment.reservation_id::text,
          'boxId', v_assignment.box_id::text, 'status', 'UNASSIGNED', 'unassignedAt', v_now,
          'reason', btrim(p_reason), 'syncFlow', 'WAREHOUSE_V2'),
        coalesce((select version from public.erp_entity_records where company_id = p_company_id
          and entity = 'operations_bunch_order_assignments' and record_id = v_assignment.bunch_id::text), 0));
      v_records := v_records || jsonb_build_array(v_saved);
      v_saved := public.erp_warehouse_v2_write_movement(p_company_id, p_operation_id, p_device_id,
        'UNASSIGN_FROM_ORDER', jsonb_build_object('bunchId', v_assignment.bunch_id::text,
          'inventoryId', v_assignment.inventory_record_id, 'orderId', p_order_id,
          'fromState', 'ASSIGNED_TO_ORDER', 'toState', 'DISPONIBLE', 'quantity', 1, 'reason', btrim(p_reason)));
      v_records := v_records || jsonb_build_array(v_saved);
    else
      update public.erp_bunch_order_assignment_registry set status = 'CANCEL_REVIEW_REQUIRED',
        updated_by = auth.uid(), last_operation_id = p_operation_id
      where company_id = p_company_id and bunch_id = v_assignment.bunch_id returning * into v_assignment;
      v_review := v_review + 1;
      v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
        'operations_bunch_order_assignments', v_assignment.bunch_id::text,
        jsonb_build_object('id', v_assignment.bunch_id::text, 'bunchId', v_assignment.bunch_id::text,
          'inventoryId', v_assignment.inventory_record_id, 'orderId', p_order_id,
          'orderLineId', v_assignment.order_line_id, 'reservationId', v_assignment.reservation_id::text,
          'boxId', v_assignment.box_id::text, 'status', 'CANCEL_REVIEW_REQUIRED',
          'reason', btrim(p_reason), 'updatedAtServer', v_now, 'syncFlow', 'WAREHOUSE_V2'),
        coalesce((select version from public.erp_entity_records where company_id = p_company_id
          and entity = 'operations_bunch_order_assignments' and record_id = v_assignment.bunch_id::text), 0));
      v_records := v_records || jsonb_build_array(v_saved);
    end if;
  end loop;

  for v_reservation in
    select * from public.erp_order_reservation_registry reservation
    where reservation.company_id = p_company_id and reservation.order_id = p_order_id
      and reservation.status not in ('RELEASED','CANCELLED') for update
  loop
    v_released_here := greatest(v_reservation.reserved_quantity - v_reservation.assigned_quantity - v_reservation.released_quantity, 0);
    update public.erp_order_reservation_registry set
      released_quantity = released_quantity + v_released_here,
      status = case when packed_quantity > 0 then 'CANCEL_REVIEW_REQUIRED' else 'RELEASED' end,
      updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
    where company_id = p_company_id and reservation_id = v_reservation.reservation_id returning * into v_reservation;
    v_released := v_released + v_released_here;
    v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
      'commercial_order_reservations', v_reservation.reservation_id::text,
      jsonb_build_object('id', v_reservation.reservation_id::text, 'reservationId', v_reservation.reservation_id::text,
        'orderId', p_order_id, 'orderLineId', v_reservation.order_line_id, 'dimensionKey', v_reservation.dimension_key,
        'variety', v_reservation.variety, 'length', v_reservation.length, 'quality', v_reservation.quality,
        'stemsPerBunch', v_reservation.stems_per_bunch, 'requestedQuantity', v_reservation.requested_quantity,
        'reservedQuantity', v_reservation.reserved_quantity, 'assignedQuantity', v_reservation.assigned_quantity,
        'packedQuantity', v_reservation.packed_quantity, 'releasedQuantity', v_reservation.released_quantity,
        'status', v_reservation.status, 'releaseReason', btrim(p_reason),
        'updatedAtServer', v_reservation.updated_at, 'syncFlow', 'WAREHOUSE_V2'),
      coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'commercial_order_reservations' and record_id = v_reservation.reservation_id::text), 0));
    v_records := v_records || jsonb_build_array(v_saved);
    if v_released_here > 0 then
      v_saved := public.erp_warehouse_v2_write_movement(p_company_id, p_operation_id, p_device_id,
        'RELEASE_RESERVATION', jsonb_build_object('reservationId', v_reservation.reservation_id::text,
          'orderId', p_order_id, 'orderLineId', v_reservation.order_line_id,
          'dimensionKey', v_reservation.dimension_key, 'quantity', v_released_here, 'reason', btrim(p_reason)));
      v_records := v_records || jsonb_build_array(v_saved);
    end if;
  end loop;

  for v_box in select * from public.erp_order_box_registry box
    where box.company_id = p_company_id and box.order_id = p_order_id for update
  loop
    update public.erp_order_box_registry set
      status = case when packed_bunches > 0 then 'CANCEL_REVIEW_REQUIRED' else 'CANCELLED' end,
      updated_by = auth.uid(), updated_at = v_now, last_operation_id = p_operation_id
    where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
    v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
      'operations_order_boxes', v_box.box_id::text,
      jsonb_build_object('id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
        'orderId', p_order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
        'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
        'status', v_box.status, 'cancelReason', btrim(p_reason), 'updatedAtServer', v_now,
        'syncFlow', 'WAREHOUSE_V2'),
      coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0));
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  v_saved := public.erp_operations_v2_write_record(p_company_id, p_operation_id, p_device_id,
    'commercial_orders', p_order_id,
    v_order.payload || jsonb_build_object(
      'status', case when p_cancel_order then 'ANULADO' else coalesce(v_order.payload ->> 'status', 'GUARDADO') end,
      'warehouseStatus', case when p_cancel_order then (case when v_review > 0 then 'CANCEL_REVIEW_REQUIRED' else 'ANULADO' end)
        else coalesce(v_order.payload ->> 'warehouseStatus', 'NO_ENVIADO') end,
      'reservationStatus', case when v_review > 0 then 'CANCEL_REVIEW_REQUIRED' else 'RELEASED' end,
      'availabilityCommitmentStatus', case when v_review > 0 then 'REVISION_CAJA' else 'LIBERADO' end,
      'availabilityReleasedAt', v_now, 'annulReason', case when p_cancel_order then btrim(p_reason)
        else coalesce(v_order.payload ->> 'annulReason', '') end,
      'annulledAt', case when p_cancel_order then to_jsonb(v_now) else v_order.payload -> 'annulledAt' end,
      'warehouseFlowVersion', 2
    ), v_order.version);
  v_records := v_records || jsonb_build_array(v_saved);
  return jsonb_build_object('records', v_records, 'releasedBunches', v_released,
    'reviewRequiredBunches', v_review, 'status', case when v_review > 0 then 'CANCEL_REVIEW_REQUIRED' else 'RELEASED' end);
end;
$$;

revoke all on function public.erp_warehouse_v2_release_order_core(uuid,uuid,text,text,text,boolean) from public, anon, authenticated;

create or replace function public.erp_warehouse_v2_release_order(
  p_operation_id uuid, p_company_id uuid, p_device_id text, p_order_id text,
  p_reason text, p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_core jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_RELEASE_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ORDER:' || p_order_id, 0));
  v_core := public.erp_warehouse_v2_release_order_core(p_operation_id, p_company_id, p_device_id, p_order_id, p_reason, false);
  v_result := jsonb_build_object('ok', true, 'command', 'RELEASE_ORDER_RESERVATIONS', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', coalesce(v_core -> 'records', '[]'::jsonb), 'result', v_core - 'records');
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'RELEASE_ORDER_RESERVATIONS', p_order_id,
    jsonb_build_object('reason', btrim(p_reason)), v_result, 'CONFIRMED', auth.uid(), p_device_id,
    coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_cancel_order(
  p_operation_id uuid, p_company_id uuid, p_device_id text, p_order_id text,
  p_reason text, p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_order public.erp_entity_records%rowtype;
  v_core jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'WAREHOUSE_V2_CANCEL_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ORDER:' || p_order_id, 0));
  select * into v_order from public.erp_entity_records record where record.company_id = p_company_id
    and record.entity = 'commercial_orders' and record.record_id = p_order_id and record.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'WAREHOUSE_V2_ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.payload ->> 'sriAuthorizationStatus', '')) = 'AUTORIZADO' then
    raise exception using errcode = '23514', message = 'WAREHOUSE_V2_AUTHORIZED_ORDER_CANNOT_CANCEL';
  end if;
  v_core := public.erp_warehouse_v2_release_order_core(p_operation_id, p_company_id, p_device_id, p_order_id, p_reason, true);
  v_result := jsonb_build_object('ok', true, 'command', 'CANCEL_ORDER', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', coalesce(v_core -> 'records', '[]'::jsonb), 'result', v_core - 'records');
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'CANCEL_ORDER', p_order_id,
    jsonb_build_object('reason', btrim(p_reason)), v_result, 'CONFIRMED', auth.uid(), p_device_id,
    coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_warehouse_v2_health(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok', true,
    'component', 'WAREHOUSE_V2',
    'migration', '202608150006',
    'companyId', p_company_id,
    'reservationTable', to_regclass('public.erp_order_reservation_registry') is not null,
    'boxSequenceTable', to_regclass('public.erp_order_box_sequence_counters') is not null,
    'boxTable', to_regclass('public.erp_order_box_registry') is not null,
    'assignmentTable', to_regclass('public.erp_bunch_order_assignment_registry') is not null,
    'operationsDependency', to_regprocedure('public.erp_operations_v2_write_record(uuid,uuid,text,text,text,jsonb,bigint)') is not null,
    'zebraDependency', to_regclass('public.erp_zebra_label_registry') is not null,
    'availabilityRpc', to_regprocedure('public.erp_warehouse_v2_availability(uuid)') is not null,
    'reserveRpc', to_regprocedure('public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz)') is not null,
    'createBoxRpc', to_regprocedure('public.erp_warehouse_v2_create_box(uuid,uuid,text,text,integer,text,integer,timestamptz)') is not null,
    'scanRpc', to_regprocedure('public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz)') is not null,
    'closeRpc', to_regprocedure('public.erp_warehouse_v2_close_box(uuid,uuid,text,text,integer,timestamptz)') is not null,
    'serverTime', clock_timestamp()
  );
end;
$$;

revoke all on function public.erp_warehouse_v2_availability(uuid) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_create_box(uuid,uuid,text,text,integer,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_unassign_bunch(uuid,uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_close_box(uuid,uuid,text,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_reopen_box(uuid,uuid,text,text,integer,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_release_order(uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_cancel_order(uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_warehouse_v2_health(uuid) from public, anon, authenticated;

grant execute on function public.erp_warehouse_v2_availability(uuid) to authenticated;
grant execute on function public.erp_warehouse_v2_create_box(uuid,uuid,text,text,integer,text,integer,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_unassign_bunch(uuid,uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_close_box(uuid,uuid,text,text,integer,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_reopen_box(uuid,uuid,text,text,integer,text,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_release_order(uuid,uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_cancel_order(uuid,uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.erp_warehouse_v2_health(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
