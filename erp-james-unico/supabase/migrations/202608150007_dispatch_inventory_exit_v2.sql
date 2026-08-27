begin;

-- FASE 5: despacho físico definitivo. Esta migración depende de las fases
-- Operaciones V2, Zebra V2 y Warehouse V2. No factura ni transmite datos SRI.

alter table public.erp_order_box_registry
  drop constraint if exists erp_order_box_registry_status_check;
alter table public.erp_order_box_registry
  add constraint erp_order_box_registry_status_check check (status in (
    'OPEN','CLOSED','REOPENED','READY_FOR_DISPATCH','DISPATCHED','CANCELLED','CANCEL_REVIEW_REQUIRED'
  ));
alter table public.erp_order_box_registry
  add column if not exists ready_at timestamptz,
  add column if not exists ready_by uuid references auth.users(id),
  add column if not exists dispatched_at timestamptz,
  add column if not exists dispatched_by uuid references auth.users(id),
  add column if not exists dispatch_id uuid;

alter table public.erp_bunch_order_assignment_registry
  drop constraint if exists erp_bunch_order_assignment_registry_status_check;
alter table public.erp_bunch_order_assignment_registry
  add constraint erp_bunch_order_assignment_registry_status_check check (status in (
    'ASSIGNED','PACKED','DISPATCHED','UNASSIGNED','CANCEL_REVIEW_REQUIRED'
  ));
alter table public.erp_bunch_order_assignment_registry
  add column if not exists dispatched_at timestamptz,
  add column if not exists dispatched_by uuid references auth.users(id),
  add column if not exists dispatch_id uuid;

alter table public.erp_zebra_label_registry
  drop constraint if exists erp_zebra_label_registry_status_check;
alter table public.erp_zebra_label_registry
  add constraint erp_zebra_label_registry_status_check check (
    status in ('LABELED','RECEIVED_IN_INVENTORY','DISPATCHED','ANNULLED')
  );

create table if not exists public.erp_dispatch_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  calendar_year integer not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, calendar_year)
);

create table if not exists public.erp_dispatch_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_id uuid not null,
  dispatch_code text not null,
  order_id text not null,
  status text not null default 'PREPARED' check (status in ('PREPARED','DISPATCHED','REVERSED')),
  box_count integer not null default 0 check (box_count >= 0),
  bunch_count integer not null default 0 check (bunch_count >= 0),
  logistics jsonb not null default '{}'::jsonb,
  observations text not null default '',
  prepared_at timestamptz,
  prepared_by uuid references auth.users(id),
  dispatched_at timestamptz,
  dispatched_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reverse_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_operation_id uuid not null,
  primary key (company_id, dispatch_id),
  unique (company_id, dispatch_code),
  unique (company_id, order_id)
);

-- Arranque no destructivo del secuencial visible. MAX se usa una sola vez al
-- desplegar la migración para continuar después de códigos canónicos/legacy;
-- durante la operación normal la reserva sigue siendo atómica por UPSERT.
with existing_codes as (
  select record.company_id,
    coalesce(nullif(record.payload ->> 'dispatchCode', ''), nullif(record.payload ->> 'dispatch_code', '')) as dispatch_code
  from public.erp_entity_records record
  where record.entity in ('operations_dispatch_records', 'operations_dispatches')
    and record.deleted_at is null
  union all
  select registry.company_id, registry.dispatch_code
  from public.erp_dispatch_registry registry
), parsed_codes as (
  select company_id,
    substring(dispatch_code from '^DSP-([0-9]{4})-[0-9]{6,}$')::integer as calendar_year,
    substring(dispatch_code from '^DSP-[0-9]{4}-([0-9]{6,})$')::bigint as sequence_value
  from existing_codes
  where dispatch_code ~ '^DSP-[0-9]{4}-[0-9]{6,}$'
)
insert into public.erp_dispatch_sequence_counters(company_id, calendar_year, last_value, updated_at)
select company_id, calendar_year, max(sequence_value), now()
from parsed_codes
group by company_id, calendar_year
on conflict (company_id, calendar_year) do update set
  last_value = greatest(erp_dispatch_sequence_counters.last_value, excluded.last_value),
  updated_at = now();

alter table public.erp_order_box_registry
  drop constraint if exists erp_order_box_registry_dispatch_fk;
alter table public.erp_order_box_registry
  add constraint erp_order_box_registry_dispatch_fk
  foreign key (company_id, dispatch_id)
  references public.erp_dispatch_registry(company_id, dispatch_id);

alter table public.erp_bunch_order_assignment_registry
  drop constraint if exists erp_bunch_order_assignment_registry_dispatch_fk;
alter table public.erp_bunch_order_assignment_registry
  add constraint erp_bunch_order_assignment_registry_dispatch_fk
  foreign key (company_id, dispatch_id)
  references public.erp_dispatch_registry(company_id, dispatch_id);

create index if not exists erp_dispatch_registry_status_idx
  on public.erp_dispatch_registry(company_id, status, dispatched_at desc);
create index if not exists erp_order_box_dispatch_idx
  on public.erp_order_box_registry(company_id, dispatch_id, status);
create index if not exists erp_bunch_assignment_dispatch_idx
  on public.erp_bunch_order_assignment_registry(company_id, dispatch_id, status);

alter table public.erp_dispatch_sequence_counters enable row level security;
alter table public.erp_dispatch_registry enable row level security;

revoke all on table public.erp_dispatch_sequence_counters, public.erp_dispatch_registry
  from anon, authenticated;
grant select on table public.erp_dispatch_sequence_counters, public.erp_dispatch_registry
  to authenticated;

drop policy if exists erp_dispatch_sequence_member_select on public.erp_dispatch_sequence_counters;
create policy erp_dispatch_sequence_member_select on public.erp_dispatch_sequence_counters
for select to authenticated using (exists (
  select 1 from public.user_company_memberships membership
  where membership.company_id = erp_dispatch_sequence_counters.company_id
    and membership.user_id = auth.uid() and membership.membership_status = 'ACTIVE'
));

drop policy if exists erp_dispatch_registry_member_select on public.erp_dispatch_registry;
create policy erp_dispatch_registry_member_select on public.erp_dispatch_registry
for select to authenticated using (exists (
  select 1 from public.user_company_memberships membership
  where membership.company_id = erp_dispatch_registry.company_id
    and membership.user_id = auth.uid() and membership.membership_status = 'ACTIVE'
));

create or replace function public.erp_dispatch_v2_assert_access(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
end;
$$;

create or replace function public.erp_dispatch_v2_next_code(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from (clock_timestamp() at time zone 'America/Guayaquil'))::integer;
  v_value bigint;
begin
  insert into public.erp_dispatch_sequence_counters(company_id, calendar_year, last_value, updated_at)
  values (p_company_id, v_year, 1, clock_timestamp())
  on conflict (company_id, calendar_year) do update set
    last_value = erp_dispatch_sequence_counters.last_value + 1,
    updated_at = clock_timestamp()
  returning last_value into v_value;
  return format('DSP-%s-%s', v_year, lpad(v_value::text, 6, '0'));
end;
$$;

revoke all on function public.erp_dispatch_v2_assert_access(uuid) from public, anon, authenticated;
revoke all on function public.erp_dispatch_v2_next_code(uuid) from public, anon, authenticated;

create or replace function public.erp_dispatch_v2_validate_ready(
  p_company_id uuid,
  p_order_id text,
  p_lock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.erp_entity_records%rowtype;
  v_required integer;
  v_packed integer;
  v_boxes integer;
  v_closed integer;
  v_open integer;
  v_conflicts integer;
begin
  perform public.erp_dispatch_v2_assert_access(p_company_id);
  if nullif(btrim(p_order_id), '') is null then
    raise exception using errcode = '22023', message = 'DISPATCH_V2_ORDER_REQUIRED';
  end if;
  if p_lock then
    select * into v_order from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'commercial_orders'
      and record.record_id = p_order_id and record.deleted_at is null for update;
  else
    select * into v_order from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'commercial_orders'
      and record.record_id = p_order_id and record.deleted_at is null;
  end if;
  if not found then raise exception using errcode = 'P0002', message = 'DISPATCH_V2_ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.payload ->> 'status', '')) in ('ANULADO','CANCELLED') then
    raise exception using errcode = '23514', message = 'DISPATCH_V2_ORDER_CANCELLED';
  end if;
  if upper(coalesce(v_order.payload ->> 'dispatchStatus', v_order.payload ->> 'status', '')) = 'DISPATCHED' then
    return jsonb_build_object('ok', false, 'orderId', p_order_id, 'status', 'ALREADY_DISPATCHED');
  end if;

  select coalesce(sum(greatest(coalesce(nullif(line.value ->> 'bunches', '')::integer, 0), 0)), 0)::integer
  into v_required from jsonb_array_elements(coalesce(v_order.payload -> 'lines', '[]'::jsonb)) line(value);
  select count(*)::integer into v_packed
  from public.erp_bunch_order_assignment_registry assignment
  where assignment.company_id = p_company_id and assignment.order_id = p_order_id
    and assignment.status in ('PACKED','DISPATCHED');
  select count(*)::integer,
    count(*) filter (where box.status in ('CLOSED','READY_FOR_DISPATCH','DISPATCHED'))::integer,
    count(*) filter (where box.status in ('OPEN','REOPENED'))::integer
  into v_boxes, v_closed, v_open
  from public.erp_order_box_registry box
  where box.company_id = p_company_id and box.order_id = p_order_id
    and box.status not in ('CANCELLED');
  select
    (select count(*) from public.erp_order_box_registry box
      where box.company_id = p_company_id and box.order_id = p_order_id
        and (box.status = 'CANCEL_REVIEW_REQUIRED' or box.packed_bunches <> box.capacity_bunches))
    +
    (select count(*) from public.erp_order_reservation_registry reservation
      where reservation.company_id = p_company_id and reservation.order_id = p_order_id
        and reservation.status = 'CANCEL_REVIEW_REQUIRED')
    +
    (select count(*) from public.erp_bunch_order_assignment_registry assignment
      where assignment.company_id = p_company_id and assignment.order_id = p_order_id
        and assignment.status = 'CANCEL_REVIEW_REQUIRED')
  into v_conflicts;

  return jsonb_build_object(
    'ok', v_required > 0 and v_packed = v_required and v_boxes > 0 and v_closed = v_boxes and v_open = 0 and v_conflicts = 0,
    'orderId', p_order_id, 'requiredBunches', v_required, 'packedBunches', v_packed,
    'boxCount', v_boxes, 'closedBoxCount', v_closed, 'openBoxCount', v_open,
    'conflictCount', v_conflicts,
    'status', case
      when v_required <= 0 then 'NO_LINES'
      when v_packed <> v_required then 'INCOMPLETE_QUANTITY'
      when v_boxes <= 0 then 'NO_BOXES'
      when v_open > 0 or v_closed <> v_boxes then 'BOXES_NOT_CLOSED'
      when v_conflicts > 0 then 'ACTIVE_CONFLICTS'
      else 'READY_FOR_DISPATCH'
    end
  );
end;
$$;

create or replace function public.erp_dispatch_v2_mark_ready(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
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
  v_validation jsonb;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_dispatch_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null then
    raise exception using errcode = '22023', message = 'DISPATCH_V2_READY_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':DISPATCH:' || p_order_id, 0));
  v_validation := public.erp_dispatch_v2_validate_ready(p_company_id, p_order_id, true);
  if not coalesce((v_validation ->> 'ok')::boolean, false) then
    raise exception using errcode = '23514', message = 'DISPATCH_V2_NOT_READY:' || coalesce(v_validation ->> 'status', 'UNKNOWN');
  end if;

  for v_box in select * from public.erp_order_box_registry box
    where box.company_id = p_company_id and box.order_id = p_order_id
      and box.status in ('CLOSED','READY_FOR_DISPATCH') order by box.box_number for update
  loop
    update public.erp_order_box_registry set status = 'READY_FOR_DISPATCH',
      ready_at = coalesce(ready_at, v_now), ready_by = coalesce(ready_by, auth.uid()),
      updated_at = v_now, updated_by = auth.uid(), last_operation_id = p_operation_id
    where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_order_boxes', v_box.box_id::text,
      jsonb_build_object(
        'id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
        'orderId', v_box.order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
        'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
        'status', v_box.status, 'readyAt', v_box.ready_at, 'updatedAtServer', v_box.updated_at,
        'syncFlow', 'DISPATCH_V2'
      ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0)
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'commercial_orders', p_order_id,
    v_order.payload || jsonb_build_object(
      'status', 'READY_FOR_DISPATCH', 'warehouseStatus', 'READY_FOR_DISPATCH',
      'dispatchStatus', 'READY_FOR_DISPATCH', 'readyForDispatchAt', v_now,
      'dispatchValidation', v_validation, 'dispatchFlowVersion', 2
    ), v_order.version
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_warehouse_v2_write_movement(
    p_company_id, p_operation_id, p_device_id, 'READY_FOR_DISPATCH',
    jsonb_build_object('orderId', p_order_id, 'boxCount', v_validation -> 'boxCount',
      'bunchCount', v_validation -> 'packedBunches', 'status', 'READY_FOR_DISPATCH')
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_result := jsonb_build_object('ok', true, 'command', 'MARK_READY_FOR_DISPATCH',
    'operationId', p_operation_id, 'serverTime', v_now, 'records', v_records,
    'result', v_validation || jsonb_build_object('status', 'READY_FOR_DISPATCH'));
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'MARK_READY_FOR_DISPATCH', p_order_id,
    jsonb_build_object('orderId', p_order_id), v_result, 'CONFIRMED', auth.uid(), p_device_id,
    coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_dispatch_v2_confirm(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_order_id text,
  p_logistics jsonb default '{}'::jsonb,
  p_observations text default '',
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_prior public.erp_dispatch_registry%rowtype;
  v_dispatch public.erp_dispatch_registry%rowtype;
  v_order public.erp_entity_records%rowtype;
  v_box public.erp_order_box_registry%rowtype;
  v_assignment public.erp_bunch_order_assignment_registry%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_bunch public.erp_entity_records%rowtype;
  v_validation jsonb;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_dispatch_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_order_id), '') is null then
    raise exception using errcode = '22023', message = 'DISPATCH_V2_CONFIRM_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':DISPATCH:' || p_order_id, 0));
  select * into v_prior from public.erp_dispatch_registry dispatch
  where dispatch.company_id = p_company_id and dispatch.order_id = p_order_id for update;
  if found and v_prior.status = 'DISPATCHED' then
    select coalesce(jsonb_agg(to_jsonb(record) order by record.entity, record.record_id), '[]'::jsonb)
    into v_records from public.erp_entity_records record
    where record.company_id = p_company_id and record.deleted_at is null and (
      (record.entity = 'commercial_orders' and record.record_id = p_order_id)
      or (record.entity = 'operations_dispatch_records' and record.record_id = v_prior.dispatch_id::text)
      or (record.entity = 'operations_order_boxes' and record.payload ->> 'orderId' = p_order_id)
      or (record.entity = 'operations_bunch_order_assignments' and record.payload ->> 'orderId' = p_order_id)
      or (record.entity in ('operations_rose_inventory','operations_bunches')
        and record.payload ->> 'dispatchId' = v_prior.dispatch_id::text)
    );
    v_result := jsonb_build_object('ok', true, 'command', 'CONFIRM_DISPATCH',
      'operationId', p_operation_id, 'serverTime', v_now, 'records', v_records,
      'result', jsonb_build_object('status', 'ALREADY_DISPATCHED', 'dispatchId', v_prior.dispatch_id,
        'dispatchCode', v_prior.dispatch_code, 'orderId', p_order_id));
    insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
      request_payload, result, status, user_id, device_id, local_created_at)
    values (p_operation_id, p_company_id, 'CONFIRM_DISPATCH_ALREADY_DONE', p_order_id,
      jsonb_build_object('orderId', p_order_id), v_result, 'CONFIRMED', auth.uid(), p_device_id,
      coalesce(p_local_created_at, now()));
    return v_result;
  end if;

  v_validation := public.erp_dispatch_v2_validate_ready(p_company_id, p_order_id, true);
  if not coalesce((v_validation ->> 'ok')::boolean, false) then
    raise exception using errcode = '23514', message = 'DISPATCH_V2_NOT_READY:' || coalesce(v_validation ->> 'status', 'UNKNOWN');
  end if;
  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;
  if upper(coalesce(v_order.payload ->> 'dispatchStatus', v_order.payload ->> 'status', '')) <> 'READY_FOR_DISPATCH' then
    raise exception using errcode = '23514', message = 'DISPATCH_V2_READY_CONFIRMATION_REQUIRED';
  end if;

  insert into public.erp_dispatch_registry(
    company_id, dispatch_id, dispatch_code, order_id, status, box_count, bunch_count,
    logistics, observations, prepared_at, prepared_by, dispatched_at, dispatched_by,
    created_at, updated_at, last_operation_id
  ) values (
    p_company_id, gen_random_uuid(), public.erp_dispatch_v2_next_code(p_company_id), p_order_id,
    'DISPATCHED', (v_validation ->> 'boxCount')::integer, (v_validation ->> 'packedBunches')::integer,
    coalesce(p_logistics, '{}'::jsonb), btrim(coalesce(p_observations, '')),
    coalesce(nullif(v_order.payload ->> 'readyForDispatchAt', '')::timestamptz, v_now), auth.uid(),
    v_now, auth.uid(), v_now, v_now, p_operation_id
  ) returning * into v_dispatch;

  for v_box in select * from public.erp_order_box_registry box
    where box.company_id = p_company_id and box.order_id = p_order_id order by box.box_number for update
  loop
    if v_box.status not in ('CLOSED','READY_FOR_DISPATCH') or v_box.packed_bunches <> v_box.capacity_bunches then
      raise exception using errcode = '23514', message = 'DISPATCH_V2_BOX_NOT_READY:' || v_box.box_code;
    end if;
    update public.erp_order_box_registry set status = 'DISPATCHED', dispatch_id = v_dispatch.dispatch_id,
      dispatched_at = v_now, dispatched_by = auth.uid(), updated_at = v_now,
      updated_by = auth.uid(), last_operation_id = p_operation_id
    where company_id = p_company_id and box_id = v_box.box_id returning * into v_box;
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_order_boxes', v_box.box_id::text,
      jsonb_build_object(
        'id', v_box.box_id::text, 'boxId', v_box.box_id::text, 'boxCode', v_box.box_code,
        'orderId', v_box.order_id, 'boxNumber', v_box.box_number, 'boxType', v_box.box_type,
        'capacityBunches', v_box.capacity_bunches, 'packedBunches', v_box.packed_bunches,
        'status', 'DISPATCHED', 'dispatchId', v_dispatch.dispatch_id::text,
        'dispatchCode', v_dispatch.dispatch_code, 'dispatchedAt', v_now,
        'updatedAtServer', v_box.updated_at, 'syncFlow', 'DISPATCH_V2'
      ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'operations_order_boxes' and record_id = v_box.box_id::text), 0)
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  for v_assignment in select * from public.erp_bunch_order_assignment_registry assignment
    where assignment.company_id = p_company_id and assignment.order_id = p_order_id
      and assignment.status = 'PACKED'
    order by assignment.bunch_id for update
  loop
    select * into v_inventory from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'operations_rose_inventory'
      and record.record_id = v_assignment.inventory_record_id and record.deleted_at is null for update;
    select * into v_bunch from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'operations_bunches'
      and record.record_id = v_assignment.bunch_id::text and record.deleted_at is null for update;
    if v_inventory.record_id is null or v_bunch.record_id is null
       or upper(coalesce(v_inventory.payload ->> 'state', '')) <> 'PACKED'
       or upper(coalesce(v_bunch.payload ->> 'state', '')) <> 'PACKED' then
      raise exception using errcode = '23514', message = 'DISPATCH_V2_BUNCH_STATE_INCONSISTENT:' || v_assignment.bunch_id::text;
    end if;
    update public.erp_bunch_order_assignment_registry set status = 'DISPATCHED',
      dispatch_id = v_dispatch.dispatch_id, dispatched_at = v_now, dispatched_by = auth.uid(),
      updated_by = auth.uid(), last_operation_id = p_operation_id
    where company_id = p_company_id and bunch_id = v_assignment.bunch_id returning * into v_assignment;
    update public.erp_zebra_label_registry set status = 'DISPATCHED', updated_at = v_now
    where company_id = p_company_id and bunch_id = v_assignment.bunch_id;

    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_rose_inventory', v_inventory.record_id,
      v_inventory.payload || jsonb_build_object(
        'previousState', v_inventory.payload ->> 'state', 'state', 'DISPATCHED', 'available', false,
        'dispatchId', v_dispatch.dispatch_id::text, 'dispatchCode', v_dispatch.dispatch_code,
        'dispatchedAt', v_now, 'dispatchedBy', auth.uid()::text, 'syncFlow', 'DISPATCH_V2'
      ), v_inventory.version
    );
    v_records := v_records || jsonb_build_array(v_saved);
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch.record_id,
      v_bunch.payload || jsonb_build_object(
        'state', 'DISPATCHED', 'availabilityState', 'DISPATCHED', 'available', false,
        'dispatchId', v_dispatch.dispatch_id::text, 'dispatchCode', v_dispatch.dispatch_code,
        'dispatchedAt', v_now, 'dispatchedBy', auth.uid()::text, 'syncFlow', 'DISPATCH_V2'
      ), v_bunch.version
    );
    v_records := v_records || jsonb_build_array(v_saved);
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_bunch_order_assignments', v_assignment.bunch_id::text,
      jsonb_build_object(
        'id', v_assignment.bunch_id::text, 'bunchId', v_assignment.bunch_id::text,
        'inventoryId', v_assignment.inventory_record_id, 'orderId', v_assignment.order_id,
        'orderLineId', v_assignment.order_line_id, 'reservationId', v_assignment.reservation_id::text,
        'boxId', v_assignment.box_id::text, 'status', 'DISPATCHED',
        'dispatchId', v_dispatch.dispatch_id::text, 'dispatchCode', v_dispatch.dispatch_code,
        'assignedAt', v_assignment.assigned_at, 'packedAt', v_assignment.packed_at,
        'dispatchedAt', v_now, 'syncFlow', 'DISPATCH_V2'
      ), coalesce((select version from public.erp_entity_records where company_id = p_company_id
        and entity = 'operations_bunch_order_assignments' and record_id = v_assignment.bunch_id::text), 0)
    );
    v_records := v_records || jsonb_build_array(v_saved);
    v_saved := public.erp_warehouse_v2_write_movement(
      p_company_id, p_operation_id, p_device_id, 'DISPATCH_OUT',
      jsonb_build_object(
        'dispatchId', v_dispatch.dispatch_id::text, 'dispatchCode', v_dispatch.dispatch_code,
        'orderId', p_order_id, 'boxId', v_assignment.box_id::text,
        'bunchId', v_assignment.bunch_id::text, 'inventoryId', v_assignment.inventory_record_id,
        'quantity', -1, 'origin', 'CUARTO_FRIO', 'destination', coalesce(p_logistics ->> 'destination', '')
      )
    );
    v_records := v_records || jsonb_build_array(v_saved);

    -- La bitácora de bodega anterior no sustituye al libro físico de stock.
    -- Este es el único OUT físico de la fase: reserva y empaque solo cambian
    -- disponibilidad/estado, mientras despacho reduce el inventario real.
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_inventory_movements',
      'DISPATCH-OUT:' || v_assignment.bunch_id::text,
      jsonb_build_object(
        'id', 'DISPATCH-OUT:' || v_assignment.bunch_id::text,
        'operationId', p_operation_id::text,
        'date', to_char(v_now at time zone 'America/Guayaquil', 'YYYY-MM-DD'),
        'dateTime', v_now,
        'movementType', 'DISPATCH_OUT',
        'direction', 'OUT',
        'sourceEntity', 'operations_dispatch_records',
        'sourceId', v_dispatch.dispatch_id::text,
        'dispatchId', v_dispatch.dispatch_id::text,
        'dispatchCode', v_dispatch.dispatch_code,
        'orderId', p_order_id,
        'boxId', v_assignment.box_id::text,
        'bunchId', v_assignment.bunch_id::text,
        'inventoryId', v_assignment.inventory_record_id,
        'labelCode', coalesce(v_inventory.payload ->> 'labelCode', ''),
        'variety', coalesce(v_inventory.payload ->> 'variety', ''),
        'length', coalesce(nullif(v_inventory.payload ->> 'length', '')::numeric, 0),
        'quality', upper(coalesce(v_inventory.payload ->> 'quality', v_inventory.payload ->> 'category', 'EXPORTACION')),
        'warehouse', coalesce(v_inventory.payload ->> 'warehouse', 'PENDIENTE UBICACION'),
        'location', coalesce(v_inventory.payload ->> 'location', 'PENDIENTE UBICACION'),
        'stockKey', coalesce(v_inventory.payload ->> 'stockKey', ''),
        'bunches', 1,
        'stems', coalesce(nullif(v_inventory.payload ->> 'stems', '')::numeric,
          nullif(v_inventory.payload ->> 'stemsPerBunch', '')::numeric, 0),
        'availabilityDeltaBunches', 0,
        'availabilityDeltaStems', 0,
        'origin', 'CUARTO_FRIO',
        'destination', coalesce(p_logistics ->> 'destination', ''),
        'observation', 'Salida física definitiva confirmada por despacho.',
        'syncFlow', 'DISPATCH_V2'
      ), 0
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'commercial_orders', p_order_id,
    v_order.payload || jsonb_build_object(
      'status', 'DISPATCHED', 'warehouseStatus', 'DISPATCHED', 'dispatchStatus', 'DISPATCHED',
      'dispatchId', v_dispatch.dispatch_id::text, 'dispatchCode', v_dispatch.dispatch_code,
      'dispatchedAt', v_now, 'shippedAt', v_now, 'dispatchLogistics', v_dispatch.logistics,
      'dispatchObservations', v_dispatch.observations, 'dispatchFlowVersion', 2
    ), v_order.version
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_dispatch_records', v_dispatch.dispatch_id::text,
    jsonb_build_object(
      'id', v_dispatch.dispatch_id::text, 'dispatchId', v_dispatch.dispatch_id::text,
      'dispatchCode', v_dispatch.dispatch_code, 'orderId', p_order_id, 'status', v_dispatch.status,
      'boxCount', v_dispatch.box_count, 'bunchCount', v_dispatch.bunch_count,
      'logistics', v_dispatch.logistics, 'observations', v_dispatch.observations,
      'preparedAt', v_dispatch.prepared_at, 'dispatchedAt', v_dispatch.dispatched_at,
      'createdAt', v_dispatch.created_at, 'updatedAtServer', v_dispatch.updated_at,
      'syncFlow', 'DISPATCH_V2'
    ), 0
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_result := jsonb_build_object('ok', true, 'command', 'CONFIRM_DISPATCH',
    'operationId', p_operation_id, 'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object('status', 'DISPATCHED', 'dispatchId', v_dispatch.dispatch_id,
      'dispatchCode', v_dispatch.dispatch_code, 'orderId', p_order_id,
      'boxCount', v_dispatch.box_count, 'bunchCount', v_dispatch.bunch_count));
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'CONFIRM_DISPATCH', p_order_id,
    jsonb_build_object('orderId', p_order_id, 'logistics', coalesce(p_logistics, '{}'::jsonb)),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

create or replace function public.erp_dispatch_v2_health(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_dispatch_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok', true,
    'component', 'DISPATCH_V2',
    'migration', '202608150007',
    'companyId', p_company_id,
    'sequenceTable', to_regclass('public.erp_dispatch_sequence_counters') is not null,
    'dispatchTable', to_regclass('public.erp_dispatch_registry') is not null,
    'operationsDependency', to_regprocedure('public.erp_operations_v2_write_record(uuid,uuid,text,text,text,jsonb,bigint)') is not null,
    'warehouseDependency', to_regprocedure('public.erp_warehouse_v2_health(uuid)') is not null,
    'inventoryStockDependency', to_regprocedure('public.erp_operations_inventory_stock(uuid)') is not null,
    'validateRpc', to_regprocedure('public.erp_dispatch_v2_validate_ready(uuid,text,boolean)') is not null,
    'markReadyRpc', to_regprocedure('public.erp_dispatch_v2_mark_ready(uuid,uuid,text,text,timestamptz)') is not null,
    'confirmRpc', to_regprocedure('public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz)') is not null,
    'serverTime', clock_timestamp()
  );
end;
$$;

revoke all on function public.erp_dispatch_v2_validate_ready(uuid,text,boolean) from public, anon;
revoke all on function public.erp_dispatch_v2_mark_ready(uuid,uuid,text,text,timestamptz) from public, anon;
revoke all on function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) from public, anon;
revoke all on function public.erp_dispatch_v2_health(uuid) from public, anon, authenticated;
grant execute on function public.erp_dispatch_v2_validate_ready(uuid,text,boolean) to authenticated;
grant execute on function public.erp_dispatch_v2_mark_ready(uuid,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) to authenticated;
grant execute on function public.erp_dispatch_v2_health(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
