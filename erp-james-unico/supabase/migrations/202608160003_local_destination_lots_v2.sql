begin;

-- Destino de lote + venta local sobre Zebra 005 y Bodega 006.
-- No duplica inventario, etiquetas, pedidos ni clientes: conserva sus IDs
-- canónicos y agrega solamente el agrupador/auditoría del lote.

create table if not exists public.erp_destination_lot_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  lot_id uuid not null,
  lot_code text not null,
  destination_type text not null check (destination_type in ('EXPORT','LOCAL')),
  destination_customer_id text,
  initial_order_id text,
  total_bunches integer not null check (total_bunches > 0),
  status text not null default 'OPEN' check (status in ('OPEN','PARTIAL','CONSUMED','CLOSED')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_operation_id uuid not null,
  primary key (company_id, lot_id),
  unique (company_id, lot_code),
  check (
    (destination_type = 'EXPORT' and destination_customer_id is null)
    or (destination_type = 'LOCAL' and nullif(btrim(destination_customer_id), '') is not null)
  )
);

create index if not exists erp_destination_lot_customer_idx
  on public.erp_destination_lot_registry(company_id, destination_type, destination_customer_id, status, created_at);
create index if not exists erp_destination_lot_order_idx
  on public.erp_destination_lot_registry(company_id, initial_order_id)
  where initial_order_id is not null;
create index if not exists erp_destination_inventory_customer_idx
  on public.erp_entity_records(company_id, ((payload ->> 'destinationCustomerId')), ((payload ->> 'state')))
  where entity = 'operations_rose_inventory' and deleted_at is null;
create index if not exists erp_destination_inventory_lot_idx
  on public.erp_entity_records(company_id, ((payload ->> 'lotId')))
  where entity = 'operations_rose_inventory' and deleted_at is null;

alter table public.erp_destination_lot_registry enable row level security;
drop policy if exists erp_destination_lot_member_select on public.erp_destination_lot_registry;
create policy erp_destination_lot_member_select on public.erp_destination_lot_registry
for select to authenticated using (
  exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = erp_destination_lot_registry.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
);

revoke all on table public.erp_destination_lot_registry from anon, authenticated;
grant select on table public.erp_destination_lot_registry to authenticated;

create or replace function public.erp_destination_v2_assert_access(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'DESTINATION_V2_COMPANY_ACCESS_DENIED';
  end if;
end;
$$;

create or replace function public.erp_destination_v2_customer(
  p_company_id uuid,
  p_customer_id text
)
returns public.erp_entity_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer public.erp_entity_records%rowtype;
begin
  perform public.erp_destination_v2_assert_access(p_company_id);
  select * into v_customer
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = 'commercial_customers'
    and record.record_id = btrim(coalesce(p_customer_id, ''))
    and record.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'DESTINATION_V2_CUSTOMER_NOT_FOUND';
  end if;
  if upper(coalesce(v_customer.payload ->> 'status', 'ACTIVO')) = 'INACTIVO' then
    raise exception using errcode = '23514', message = 'DESTINATION_V2_CUSTOMER_INACTIVE';
  end if;
  if upper(coalesce(v_customer.payload ->> 'category', v_customer.payload ->> 'marketType', '')) not in ('LOCAL','MIXTO') then
    raise exception using errcode = '23514', message = 'DESTINATION_V2_CUSTOMER_NOT_LOCAL';
  end if;
  return v_customer;
end;
$$;

create or replace function public.erp_destination_v2_confirm_local_order(
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
  v_customer public.erp_entity_records%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_line jsonb;
  v_reserve jsonb;
  v_pack jsonb;
  v_records jsonb := '[]'::jsonb;
  v_order_id text := btrim(coalesce(p_order_id, ''));
  v_customer_id text;
  v_box_number integer;
  v_label_code text;
  v_assigned integer := 0;
  v_required integer := 0;
  v_packed integer := 0;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_destination_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or v_order_id = '' then
    raise exception using errcode = '22023', message = 'DESTINATION_V2_CONFIRM_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ORDER:' || v_order_id, 0));

  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = v_order_id and record.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'DESTINATION_V2_ORDER_NOT_FOUND'; end if;
  v_customer_id := nullif(coalesce(v_order.payload ->> 'customerId', ''), '');
  v_customer := public.erp_destination_v2_customer(p_company_id, v_customer_id);
  if upper(coalesce(v_order.payload ->> 'saleType', '')) <> 'LOCAL'
     and upper(coalesce(v_order.payload ->> 'transportType', '')) <> 'TERRESTRE' then
    raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_NOT_LOCAL';
  end if;
  if upper(coalesce(v_order.payload ->> 'status', '')) in ('ANULADO','CANCELLED','DISPATCHED','DESPACHADO') then
    raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_STATE_INVALID';
  end if;
  if upper(coalesce(v_order.payload ->> 'inventoryMode', 'WITH_INVENTORY')) = 'NO_INVENTORY'
     or coalesce((v_order.payload ->> 'affectsInventory')::boolean, true) = false then
    raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_WITHOUT_INVENTORY';
  end if;

  select public.erp_warehouse_v2_reserve_order(
    gen_random_uuid(), p_company_id, p_device_id, v_order_id, true, coalesce(p_local_created_at, now())
  ) into v_reserve;
  if coalesce((v_reserve ->> 'ok')::boolean, false) = false then
    raise exception using errcode = 'P0001', message = 'DESTINATION_V2_ORDER_RESERVATION_FAILED';
  end if;
  v_records := v_records || coalesce(v_reserve -> 'records', '[]'::jsonb);

  loop
    select * into v_order from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'commercial_orders'
      and record.record_id = v_order_id and record.deleted_at is null for update;
    select coalesce(sum(greatest(coalesce(nullif(line ->> 'bunches', '')::integer, 0), 0)), 0)::integer,
      coalesce(sum(jsonb_array_length(coalesce(line -> 'scannedBunches', '[]'::jsonb))), 0)::integer
    into v_required, v_packed
    from jsonb_array_elements(coalesce(v_order.payload -> 'lines', '[]'::jsonb)) line;
    exit when v_packed >= v_required and v_required > 0;

    select item.value into v_line
    from jsonb_array_elements(coalesce(v_order.payload -> 'lines', '[]'::jsonb)) with ordinality item(value, ordinality)
    where jsonb_array_length(coalesce(item.value -> 'scannedBunches', '[]'::jsonb))
      < greatest(coalesce(nullif(item.value ->> 'bunches', '')::integer, 0), 0)
    order by item.ordinality limit 1;
    if v_line is null then
      raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_REQUIREMENTS_INVALID';
    end if;
    v_box_number := coalesce(nullif(v_line ->> 'boxNumber', '')::integer, 0);
    if v_box_number <= 0 then
      raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_BOX_REQUIRED';
    end if;

    select * into v_inventory
    from public.erp_entity_records inventory
    where inventory.company_id = p_company_id
      and inventory.entity = 'operations_rose_inventory'
      and inventory.deleted_at is null
      and upper(coalesce(inventory.payload ->> 'state', '')) = 'ASIGNADO_LOCAL'
      and coalesce(inventory.payload ->> 'destinationCustomerId', inventory.payload ->> 'localDestinationCustomerId', '') = v_customer_id
      and nullif(coalesce(inventory.payload ->> 'destinationOrderId', ''), '') is null
      and upper(btrim(coalesce(inventory.payload ->> 'variety', ''))) = upper(btrim(coalesce(v_line ->> 'variety', '')))
      and (coalesce((v_line ->> 'anyLength')::boolean, false)
        or coalesce(nullif(inventory.payload ->> 'length', '')::numeric, 0) = coalesce(nullif(v_line ->> 'length', '')::numeric, 0))
      and not exists (
        select 1 from public.erp_bunch_order_assignment_registry assignment
        where assignment.company_id = p_company_id
          and assignment.bunch_id::text = inventory.payload ->> 'bunchId'
          and assignment.status in ('ASSIGNED','PACKED','CANCEL_REVIEW_REQUIRED')
      )
    order by coalesce(inventory.payload ->> 'admittedAt', inventory.updated_at::text), inventory.record_id
    limit 1 for update skip locked;
    if not found then
      raise exception using errcode = '23514', message = format(
        'DESTINATION_V2_LOCAL_INVENTORY_INSUFFICIENT:%s:%s',
        coalesce(v_line ->> 'variety', ''), coalesce(v_line ->> 'length', '')
      );
    end if;
    v_label_code := coalesce(v_inventory.payload ->> 'labelCode', '');
    select public.erp_warehouse_v2_scan_into_box(
      gen_random_uuid(), p_company_id, p_device_id, v_order_id, v_box_number,
      v_label_code, coalesce(p_local_created_at, now())
    ) into v_pack;
    if coalesce((v_pack ->> 'ok')::boolean, false) = false then
      raise exception using errcode = 'P0001', message = 'DESTINATION_V2_LOCAL_ASSIGNMENT_FAILED';
    end if;
    v_records := v_records || coalesce(v_pack -> 'records', '[]'::jsonb);
    v_assigned := v_assigned + case when v_pack -> 'result' ->> 'status' = 'ALREADY_PACKED' then 0 else 1 end;
  end loop;

  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = v_order_id and record.deleted_at is null;
  v_result := jsonb_build_object(
    'ok', true, 'command', 'CONFIRM_LOCAL_ORDER', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', v_records || jsonb_build_array(to_jsonb(v_order)),
    'result', jsonb_build_object(
      'status', case when v_assigned = 0 then 'ALREADY_COMPLETE' else 'COMPLETED' end,
      'orderId', v_order_id, 'customerId', v_customer_id, 'assigned', v_assigned,
      'requiredBunches', v_required, 'packedBunches', v_packed, 'pendingBunches', greatest(v_required - v_packed, 0)
    )
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'CONFIRM_LOCAL_ORDER', v_order_id,
    jsonb_build_object('orderId', v_order_id, 'customerId', v_customer_id),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

create or replace function public.erp_destination_v2_reassign_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_target_destination_type text,
  p_target_customer_id text default null,
  p_reason text default null,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_registry public.erp_zebra_label_registry%rowtype;
  v_label public.erp_entity_records%rowtype;
  v_bunch public.erp_entity_records%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_customer public.erp_entity_records%rowtype;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_code text := upper(regexp_replace(coalesce(p_label_code, ''), '\s+', '', 'g'));
  v_target text := upper(btrim(coalesce(p_target_destination_type, '')));
  v_customer_id text := nullif(btrim(coalesce(p_target_customer_id, '')), '');
  v_customer_name text := '';
  v_previous_customer_id text;
  v_previous_customer_name text;
  v_movement_id text := gen_random_uuid()::text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_destination_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or v_code !~ '^\d{10}$'
     or v_target not in ('EXPORT','LOCAL') or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'DESTINATION_V2_REASSIGN_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;

  select * into v_registry from public.erp_zebra_label_registry registry
  where registry.company_id = p_company_id and registry.label_code = v_code for update;
  if not found or v_registry.inventory_record_id is null then
    raise exception using errcode = 'P0002', message = 'DESTINATION_V2_RECEIVED_LABEL_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':BUNCH:' || v_registry.bunch_id::text, 0));
  if exists (
    select 1 from public.erp_bunch_order_assignment_registry assignment
    where assignment.company_id = p_company_id and assignment.bunch_id = v_registry.bunch_id
      and assignment.status in ('ASSIGNED','PACKED','CANCEL_REVIEW_REQUIRED')
  ) then
    raise exception using errcode = '23514', message = 'DESTINATION_V2_ASSIGNED_BUNCH_IMMUTABLE';
  end if;

  select * into v_label from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_label_batches'
    and record.record_id = v_registry.label_record_id and record.deleted_at is null for update;
  select * into v_bunch from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_bunches'
    and record.record_id = v_registry.bunch_id::text and record.deleted_at is null for update;
  select * into v_inventory from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_rose_inventory'
    and record.record_id = v_registry.inventory_record_id and record.deleted_at is null for update;
  if v_label.record_id is null or v_bunch.record_id is null or v_inventory.record_id is null then
    raise exception using errcode = 'P0002', message = 'DESTINATION_V2_REASSIGN_LINK_BROKEN';
  end if;
  if upper(coalesce(v_inventory.payload ->> 'state', '')) not in ('ASIGNADO_LOCAL','DISPONIBLE') then
    raise exception using errcode = '23514', message = 'DESTINATION_V2_BUNCH_STATE_IMMUTABLE';
  end if;
  v_previous_customer_id := coalesce(v_inventory.payload ->> 'destinationCustomerId', v_inventory.payload ->> 'localDestinationCustomerId', '');
  v_previous_customer_name := coalesce(v_inventory.payload ->> 'destinationCustomerName', v_inventory.payload ->> 'localDestinationName', '');
  if v_target = 'EXPORT' then
    v_customer_id := null;
  else
    if v_customer_id is null then raise exception using errcode = '22023', message = 'DESTINATION_V2_TARGET_CUSTOMER_REQUIRED'; end if;
    v_customer := public.erp_destination_v2_customer(p_company_id, v_customer_id);
    v_customer_name := coalesce(nullif(v_customer.payload ->> 'legalName', ''),
      nullif(v_customer.payload ->> 'commercialName', ''), nullif(v_customer.payload ->> 'name', ''), v_customer.record_id);
  end if;

  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_rose_inventory', v_inventory.record_id,
    (v_inventory.payload - 'destinationOrderId' - 'orderId' - 'orderLineId' - 'boxId' - 'boxNumber') || jsonb_build_object(
      'previousDestinationType', coalesce(v_inventory.payload ->> 'destinationType', case when v_previous_customer_id = '' then 'EXPORT' else 'LOCAL' end),
      'previousDestinationCustomerId', v_previous_customer_id, 'previousDestinationCustomerName', v_previous_customer_name,
      'destinationType', v_target, 'destinationMode', case when v_target = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
      'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
      'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
      'state', case when v_target = 'LOCAL' then 'ASIGNADO_LOCAL' else 'DISPONIBLE' end,
      'available', v_target = 'EXPORT', 'destinationReassignedAt', v_now,
      'destinationReassignedReason', btrim(p_reason), 'syncFlow', 'DESTINATION_V2'
    ), v_inventory.version
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch.record_id,
    (v_bunch.payload - 'destinationOrderId' - 'orderId' - 'orderLineId' - 'boxId') || jsonb_build_object(
      'destinationType', v_target, 'destinationMode', case when v_target = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
      'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
      'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
      'availabilityState', case when v_target = 'LOCAL' then 'ASIGNADO_LOCAL' else 'DISPONIBLE' end,
      'available', v_target = 'EXPORT', 'destinationReassignedAt', v_now,
      'destinationReassignedReason', btrim(p_reason), 'syncFlow', 'DESTINATION_V2'
    ), v_bunch.version
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_label_batches', v_label.record_id,
    (v_label.payload - 'destinationOrderId') || jsonb_build_object(
      'destinationType', v_target, 'destinationMode', case when v_target = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
      'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
      'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
      'destinationReassignedAt', v_now, 'destinationReassignedReason', btrim(p_reason), 'syncFlow', 'DESTINATION_V2'
    ), v_label.version
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_inventory_movements', v_movement_id,
    jsonb_build_object(
      'id', v_movement_id, 'operationId', p_operation_id::text, 'bunchId', v_registry.bunch_id::text,
      'inventoryId', v_inventory.record_id, 'labelCode', v_code, 'dateTime', v_now,
      'movementType', 'REASSIGN_DESTINATION', 'direction', 'NONE',
      'sourceEntity', 'operations_rose_inventory', 'sourceId', v_inventory.record_id,
      'fromDestinationType', coalesce(v_inventory.payload ->> 'destinationType', case when v_previous_customer_id = '' then 'EXPORT' else 'LOCAL' end),
      'fromCustomerId', v_previous_customer_id, 'toDestinationType', v_target,
      'toCustomerId', coalesce(v_customer_id, ''), 'bunches', 0, 'stems', 0,
      'availabilityDeltaBunches', case when v_target = 'EXPORT' and v_previous_customer_id <> '' then 1
        when v_target = 'LOCAL' and v_previous_customer_id = '' then -1 else 0 end,
      'reason', btrim(p_reason), 'syncFlow', 'DESTINATION_V2'
    ), 0
  );
  v_records := v_records || jsonb_build_array(v_saved);

  v_result := jsonb_build_object(
    'ok', true, 'command', 'REASSIGN_DESTINATION', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object('status', 'DESTINATION_REASSIGNED', 'bunchId', v_registry.bunch_id,
      'labelCode', v_code, 'destinationType', v_target, 'destinationCustomerId', coalesce(v_customer_id, ''))
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'REASSIGN_DESTINATION', v_registry.bunch_id::text,
    jsonb_build_object('labelCode', v_code, 'targetDestinationType', v_target,
      'targetCustomerId', coalesce(v_customer_id, ''), 'reason', btrim(p_reason)),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

-- Se declara antes de las RPC que la consumen. La misma definición se repite
-- más abajo de forma idempotente para mantener agrupadas las utilidades.
create or replace function public.erp_destination_v2_receive_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_payload jsonb default '{}'::jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_registry public.erp_zebra_label_registry%rowtype;
  v_label public.erp_entity_records%rowtype;
  v_bunch public.erp_entity_records%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_entry public.erp_entity_records%rowtype;
  v_base jsonb;
  v_reserve jsonb;
  v_pack jsonb;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_code text := upper(regexp_replace(coalesce(p_label_code, ''), '\s+', '', 'g'));
  v_destination text;
  v_customer_id text;
  v_customer_name text;
  v_order_id text;
  v_lot_id text;
  v_lot_code text;
  v_inventory_id text;
  v_box_number integer;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.erp_destination_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null
     or v_code !~ '^\d{10}$' or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'DESTINATION_V2_RECEIPT_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;

  select * into v_registry from public.erp_zebra_label_registry registry
  where registry.company_id = p_company_id and registry.label_code = v_code;
  if not found then raise exception using errcode = 'P0002', message = 'DESTINATION_V2_LABEL_NOT_FOUND'; end if;
  select * into v_label from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_label_batches'
    and record.record_id = v_registry.label_record_id and record.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'DESTINATION_V2_LABEL_RECORD_NOT_FOUND'; end if;

  v_destination := upper(coalesce(nullif(v_label.payload ->> 'destinationType', ''),
    case when nullif(v_label.payload ->> 'localDestinationCustomerId', '') is null then 'EXPORT' else 'LOCAL' end));
  v_customer_id := nullif(coalesce(v_label.payload ->> 'destinationCustomerId', v_label.payload ->> 'localDestinationCustomerId', ''), '');
  v_customer_name := coalesce(v_label.payload ->> 'destinationCustomerName', v_label.payload ->> 'localDestinationName', '');
  v_order_id := nullif(coalesce(v_label.payload ->> 'destinationOrderId', ''), '');
  v_lot_id := nullif(coalesce(v_label.payload ->> 'lotId', ''), '');
  v_lot_code := coalesce(v_label.payload ->> 'lotCode', '');
  if v_destination = 'LOCAL' then
    perform public.erp_destination_v2_customer(p_company_id, v_customer_id);
  end if;

  select public.erp_zebra_v2_receive_bunch(
    gen_random_uuid(), p_company_id, p_device_id, v_code, p_payload, coalesce(p_local_created_at, now())
  ) into v_base;
  if coalesce((v_base ->> 'ok')::boolean, false) = false then
    raise exception using errcode = 'P0001', message = 'DESTINATION_V2_ZEBRA_RECEIPT_FAILED';
  end if;
  v_inventory_id := coalesce(v_base -> 'result' ->> 'inventoryId', v_registry.inventory_record_id);

  select * into v_label from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_label_batches'
    and record.record_id = v_registry.label_record_id and record.deleted_at is null for update;
  select * into v_bunch from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_bunches'
    and record.record_id = v_registry.bunch_id::text and record.deleted_at is null for update;
  select * into v_inventory from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_rose_inventory'
    and record.record_id = v_inventory_id and record.deleted_at is null for update;
  select * into v_entry from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_bunch_entries'
    and record.payload ->> 'bunchId' = v_registry.bunch_id::text and record.deleted_at is null
  order by record.updated_at desc limit 1 for update;
  if v_bunch.record_id is null or v_inventory.record_id is null then
    raise exception using errcode = 'P0002', message = 'DESTINATION_V2_RECEIPT_LINK_BROKEN';
  end if;

  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch.record_id,
    v_bunch.payload || jsonb_build_object(
      'lotId', coalesce(v_lot_id, ''), 'lotCode', v_lot_code,
      'destinationType', v_destination, 'destinationMode', case when v_destination = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
      'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
      'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
      'destinationOrderId', coalesce(v_order_id, ''),
      'availabilityState', case when v_destination = 'LOCAL' then 'ASIGNADO_LOCAL' else 'DISPONIBLE' end,
      'available', v_destination = 'EXPORT', 'syncFlow', 'DESTINATION_V2'
    ), v_bunch.version
  );
  v_records := v_records || jsonb_build_array(v_saved);

  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_label_batches', v_label.record_id,
    v_label.payload || jsonb_build_object(
      'lotId', coalesce(v_lot_id, ''), 'lotCode', v_lot_code,
      'destinationType', v_destination, 'destinationMode', case when v_destination = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
      'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
      'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
      'destinationOrderId', coalesce(v_order_id, ''), 'syncFlow', 'DESTINATION_V2'
    ), v_label.version
  );
  v_records := v_records || jsonb_build_array(v_saved);

  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_rose_inventory', v_inventory.record_id,
    v_inventory.payload || jsonb_build_object(
      'lotId', coalesce(v_lot_id, ''), 'lotCode', v_lot_code,
      'destinationType', v_destination, 'destinationMode', case when v_destination = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
      'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
      'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
      'destinationOrderId', coalesce(v_order_id, ''),
      'state', case when v_destination = 'LOCAL' then 'ASIGNADO_LOCAL' else 'DISPONIBLE' end,
      'available', v_destination = 'EXPORT', 'syncFlow', 'DESTINATION_V2'
    ), v_inventory.version
  );
  v_records := v_records || jsonb_build_array(v_saved);

  if v_entry.record_id is not null then
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_bunch_entries', v_entry.record_id,
      v_entry.payload || jsonb_build_object(
        'lotId', coalesce(v_lot_id, ''), 'lotCode', v_lot_code,
        'destinationType', v_destination, 'destinationMode', case when v_destination = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
        'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
        'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
        'destinationOrderId', coalesce(v_order_id, ''),
        'operationalState', case when v_destination = 'LOCAL' then 'ASIGNADO_LOCAL' else 'DISPONIBLE' end,
        'syncFlow', 'DESTINATION_V2'
      ), v_entry.version
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end if;

  -- Si la etiqueta nació vinculada a un pedido local, el único escaneo físico
  -- también realiza la asignación/empaque canónicos dentro de esta transacción.
  if v_destination = 'LOCAL' and v_order_id is not null
     and upper(coalesce(v_inventory.payload ->> 'state', '')) <> 'PACKED' then
    select public.erp_warehouse_v2_reserve_order(
      gen_random_uuid(), p_company_id, p_device_id, v_order_id, true, coalesce(p_local_created_at, now())
    ) into v_reserve;
    if coalesce((v_reserve ->> 'ok')::boolean, false) = false then
      raise exception using errcode = 'P0001', message = 'DESTINATION_V2_DIRECT_ORDER_RESERVATION_FAILED';
    end if;
    select coalesce(nullif(line ->> 'boxNumber', '')::integer, 0)
    into v_box_number
    from public.erp_entity_records order_record,
      lateral jsonb_array_elements(coalesce(order_record.payload -> 'lines', '[]'::jsonb)) line
    where order_record.company_id = p_company_id and order_record.entity = 'commercial_orders'
      and order_record.record_id = v_order_id and order_record.deleted_at is null
      and upper(btrim(coalesce(line ->> 'variety', ''))) = upper(btrim(coalesce(v_inventory.payload ->> 'variety', '')))
      and (coalesce((line ->> 'anyLength')::boolean, false)
        or coalesce(nullif(line ->> 'length', '')::numeric, 0) = coalesce(nullif(v_inventory.payload ->> 'length', '')::numeric, 0))
      and jsonb_array_length(coalesce(line -> 'scannedBunches', '[]'::jsonb))
        < greatest(coalesce(nullif(line ->> 'bunches', '')::integer, 0), 0)
    order by coalesce(nullif(line ->> 'boxNumber', '')::integer, 0)
    limit 1;
    if coalesce(v_box_number, 0) <= 0 then
      raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_HAS_NO_PENDING_MATCH';
    end if;
    select public.erp_warehouse_v2_scan_into_box(
      gen_random_uuid(), p_company_id, p_device_id, v_order_id, v_box_number, v_code, coalesce(p_local_created_at, now())
    ) into v_pack;
    if coalesce((v_pack ->> 'ok')::boolean, false) = false then
      raise exception using errcode = 'P0001', message = 'DESTINATION_V2_DIRECT_ORDER_ASSIGNMENT_FAILED';
    end if;
  end if;

  v_records := coalesce(v_base -> 'records', '[]'::jsonb)
    || v_records || coalesce(v_reserve -> 'records', '[]'::jsonb) || coalesce(v_pack -> 'records', '[]'::jsonb);
  v_result := jsonb_build_object(
    'ok', true, 'command', 'RECEIVE_DESTINATION_BUNCH', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object(
      'status', case when v_pack is not null then 'RECEIVED_AND_PACKED'
        else coalesce(v_base -> 'result' ->> 'status', 'RECEIVED_IN_INVENTORY') end,
      'bunchId', v_registry.bunch_id, 'labelId', v_registry.label_record_id, 'labelCode', v_code,
      'inventoryId', v_inventory_id, 'lotId', coalesce(v_lot_id, ''), 'lotCode', v_lot_code,
      'destinationType', v_destination, 'destinationCustomerId', coalesce(v_customer_id, ''),
      'destinationOrderId', coalesce(v_order_id, ''), 'boxNumber', coalesce(v_box_number, 0)
    )
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'RECEIVE_DESTINATION_BUNCH', v_registry.bunch_id::text,
    jsonb_build_object('labelCode', v_code, 'destinationType', v_destination,
      'destinationCustomerId', coalesce(v_customer_id, ''), 'destinationOrderId', coalesce(v_order_id, '')),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

create or replace function public.erp_destination_v2_create_labels(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_labels jsonb,
  p_destination_type text default 'EXPORT',
  p_destination_customer_id text default null,
  p_destination_order_id text default null,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_customer public.erp_entity_records%rowtype;
  v_order public.erp_entity_records%rowtype;
  v_label_record public.erp_entity_records%rowtype;
  v_bunch_record public.erp_entity_records%rowtype;
  v_lot public.erp_destination_lot_registry%rowtype;
  v_base jsonb;
  v_saved jsonb;
  v_records jsonb := '[]'::jsonb;
  v_labels jsonb := '[]'::jsonb;
  v_created_label jsonb;
  v_destination text := upper(btrim(coalesce(p_destination_type, 'EXPORT')));
  v_customer_id text := nullif(btrim(coalesce(p_destination_customer_id, '')), '');
  v_order_id text := nullif(btrim(coalesce(p_destination_order_id, '')), '');
  v_customer_name text := '';
  v_lot_id uuid := gen_random_uuid();
  v_lot_code text;
  v_now timestamptz := clock_timestamp();
  v_child_operation uuid := gen_random_uuid();
  v_result jsonb;
begin
  perform public.erp_destination_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null
     or v_destination not in ('EXPORT','LOCAL')
     or jsonb_typeof(coalesce(p_labels, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(p_labels) < 1 then
    raise exception using errcode = '22023', message = 'DESTINATION_V2_LABEL_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;

  if v_destination = 'EXPORT' then
    if v_customer_id is not null or v_order_id is not null then
      raise exception using errcode = '23514', message = 'DESTINATION_V2_EXPORT_CANNOT_HAVE_LOCAL_LINK';
    end if;
  else
    if v_customer_id is null then
      raise exception using errcode = '22023', message = 'DESTINATION_V2_LOCAL_CUSTOMER_REQUIRED';
    end if;
    v_customer := public.erp_destination_v2_customer(p_company_id, v_customer_id);
    v_customer_name := coalesce(nullif(v_customer.payload ->> 'legalName', ''),
      nullif(v_customer.payload ->> 'commercialName', ''), nullif(v_customer.payload ->> 'name', ''), v_customer.record_id);

    if v_order_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ORDER:' || v_order_id, 0));
      select * into v_order from public.erp_entity_records record
      where record.company_id = p_company_id and record.entity = 'commercial_orders'
        and record.record_id = v_order_id and record.deleted_at is null for update;
      if not found then raise exception using errcode = 'P0002', message = 'DESTINATION_V2_ORDER_NOT_FOUND'; end if;
      if coalesce(v_order.payload ->> 'customerId', '') <> v_customer_id then
        raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_CUSTOMER_MISMATCH';
      end if;
      if upper(coalesce(v_order.payload ->> 'saleType', '')) <> 'LOCAL'
         and upper(coalesce(v_order.payload ->> 'transportType', '')) <> 'TERRESTRE' then
        raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_NOT_LOCAL';
      end if;
      if upper(coalesce(v_order.payload ->> 'status', '')) in ('ANULADO','CANCELLED','DISPATCHED','DESPACHADO') then
        raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_STATE_INVALID';
      end if;
      if upper(coalesce(v_order.payload ->> 'inventoryMode', 'WITH_INVENTORY')) = 'NO_INVENTORY'
         or coalesce((v_order.payload ->> 'affectsInventory')::boolean, true) = false then
        raise exception using errcode = '23514', message = 'DESTINATION_V2_ORDER_WITHOUT_INVENTORY';
      end if;
      if exists (
        select 1 from jsonb_array_elements(p_labels) label
        where not exists (
          select 1 from jsonb_array_elements(coalesce(v_order.payload -> 'lines', '[]'::jsonb)) line
          where upper(btrim(coalesce(line ->> 'variety', ''))) = upper(btrim(coalesce(label ->> 'variety', '')))
            and (coalesce((line ->> 'anyLength')::boolean, false)
              or coalesce(nullif(line ->> 'length', '')::numeric, 0) = coalesce(nullif(label ->> 'length', '')::numeric, 0))
        )
      ) then
        raise exception using errcode = '23514', message = 'DESTINATION_V2_LABEL_DOES_NOT_MATCH_ORDER';
      end if;
    end if;
  end if;

  v_lot_code := 'LOT-' || upper(substr(replace(v_lot_id::text, '-', ''), 1, 12));
  select public.erp_zebra_v2_create_labels(
    v_child_operation, p_company_id, p_device_id, p_labels, coalesce(p_local_created_at, now())
  ) into v_base;
  if coalesce((v_base ->> 'ok')::boolean, false) = false then
    raise exception using errcode = 'P0001', message = 'DESTINATION_V2_ZEBRA_CREATE_FAILED';
  end if;

  insert into public.erp_destination_lot_registry(
    company_id, lot_id, lot_code, destination_type, destination_customer_id, initial_order_id,
    total_bunches, status, created_by, updated_by, created_at, updated_at, last_operation_id
  ) values (
    p_company_id, v_lot_id, v_lot_code, v_destination, v_customer_id, v_order_id,
    jsonb_array_length(p_labels), 'OPEN', auth.uid(), auth.uid(), v_now, v_now, p_operation_id
  ) returning * into v_lot;

  for v_created_label in select value from jsonb_array_elements(coalesce(v_base -> 'result' -> 'labels', '[]'::jsonb))
  loop
    select * into v_label_record from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'operations_label_batches'
      and record.record_id = v_created_label ->> 'labelId' and record.deleted_at is null for update;
    select * into v_bunch_record from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'operations_bunches'
      and record.record_id = v_created_label ->> 'bunchId' and record.deleted_at is null for update;
    if v_label_record.record_id is null or v_bunch_record.record_id is null then
      raise exception using errcode = 'P0002', message = 'DESTINATION_V2_CREATED_LABEL_LINK_BROKEN';
    end if;

    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch_record.record_id,
      v_bunch_record.payload || jsonb_build_object(
        'lotId', v_lot_id::text, 'lotCode', v_lot_code,
        'destinationType', v_destination, 'destinationMode', case when v_destination = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
        'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
        'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
        'destinationOrderId', coalesce(v_order_id, ''), 'syncFlow', 'DESTINATION_V2'
      ), v_bunch_record.version
    );
    v_records := v_records || jsonb_build_array(v_saved);

    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_label_batches', v_label_record.record_id,
      v_label_record.payload || jsonb_build_object(
        'lotId', v_lot_id::text, 'lotCode', v_lot_code,
        'destinationType', v_destination, 'destinationMode', case when v_destination = 'LOCAL' then 'LOCAL_COMPANY' else 'BLESS_EXPORT' end,
        'destinationCustomerId', coalesce(v_customer_id, ''), 'localDestinationCustomerId', coalesce(v_customer_id, ''),
        'destinationCustomerName', v_customer_name, 'localDestinationName', v_customer_name,
        'destinationOrderId', coalesce(v_order_id, ''), 'syncFlow', 'DESTINATION_V2'
      ), v_label_record.version
    );
    v_records := v_records || jsonb_build_array(v_saved);
    v_labels := v_labels || jsonb_build_array(v_created_label || jsonb_build_object(
      'lotId', v_lot_id::text, 'lotCode', v_lot_code,
      'destinationType', v_destination, 'destinationCustomerId', coalesce(v_customer_id, ''),
      'destinationOrderId', coalesce(v_order_id, '')
    ));
  end loop;

  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_destination_lots', v_lot_id::text,
    jsonb_build_object(
      'id', v_lot_id::text, 'lotId', v_lot_id::text, 'lotCode', v_lot_code,
      'destinationType', v_destination, 'destinationCustomerId', coalesce(v_customer_id, ''),
      'destinationCustomerName', v_customer_name, 'initialOrderId', coalesce(v_order_id, ''),
      'totalBunches', v_lot.total_bunches, 'status', v_lot.status,
      'createdAt', v_now, 'updatedAtServer', v_now, 'syncFlow', 'DESTINATION_V2'
    ), 0
  );
  v_records := v_records || jsonb_build_array(v_saved);

  v_result := jsonb_build_object(
    'ok', true, 'command', 'CREATE_DESTINATION_LABELS', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object(
      'status', 'LABELS_CREATED', 'lotId', v_lot_id, 'lotCode', v_lot_code,
      'destinationType', v_destination, 'destinationCustomerId', coalesce(v_customer_id, ''),
      'destinationOrderId', coalesce(v_order_id, ''), 'labels', v_labels
    )
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'CREATE_DESTINATION_LABELS', v_lot_id::text,
    jsonb_build_object('destinationType', v_destination, 'destinationCustomerId', coalesce(v_customer_id, ''),
      'destinationOrderId', coalesce(v_order_id, ''), 'labelCount', jsonb_array_length(p_labels)),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

create or replace function public.erp_destination_v2_availability(p_company_id uuid)
returns table (
  destination_type text,
  destination_customer_id text,
  destination_customer_name text,
  lot_id text,
  lot_code text,
  variety text,
  length numeric,
  quality text,
  physical_bunches bigint,
  available_bunches bigint,
  assigned_bunches bigint,
  packed_bunches bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_destination_v2_assert_access(p_company_id);
  return query
  select
    upper(coalesce(nullif(inventory.payload ->> 'destinationType', ''),
      case when nullif(coalesce(inventory.payload ->> 'destinationCustomerId', inventory.payload ->> 'localDestinationCustomerId', ''), '') is null
        then 'EXPORT' else 'LOCAL' end)) as destination_type,
    coalesce(inventory.payload ->> 'destinationCustomerId', inventory.payload ->> 'localDestinationCustomerId', '') as destination_customer_id,
    max(coalesce(inventory.payload ->> 'destinationCustomerName', inventory.payload ->> 'localDestinationName', '')) as destination_customer_name,
    coalesce(inventory.payload ->> 'lotId', '') as lot_id,
    max(coalesce(inventory.payload ->> 'lotCode', '')) as lot_code,
    upper(btrim(coalesce(inventory.payload ->> 'variety', ''))) as variety,
    coalesce(nullif(inventory.payload ->> 'length', '')::numeric, 0) as length,
    upper(btrim(coalesce(inventory.payload ->> 'quality', inventory.payload ->> 'category', 'EXPORTACION'))) as quality,
    count(*) filter (where upper(coalesce(inventory.payload ->> 'state', ''))
      not in ('ANULADO','ANNULLED','CONSUMIDO','DISPATCHED','DESPACHADO')) as physical_bunches,
    count(*) filter (where upper(coalesce(inventory.payload ->> 'state', '')) in ('DISPONIBLE','ASIGNADO_LOCAL')) as available_bunches,
    count(*) filter (where upper(coalesce(inventory.payload ->> 'state', '')) in ('ASSIGNED_TO_ORDER','ASIGNADO_PEDIDO')) as assigned_bunches,
    count(*) filter (where upper(coalesce(inventory.payload ->> 'state', '')) in ('PACKED','EMPACADO','ASIGNADO_CAJA')) as packed_bunches
  from public.erp_entity_records inventory
  where inventory.company_id = p_company_id
    and inventory.entity = 'operations_rose_inventory'
    and inventory.deleted_at is null
    and inventory.payload ->> 'sourceType' = 'ESCANEO_ETIQUETA'
  group by
    upper(coalesce(nullif(inventory.payload ->> 'destinationType', ''),
      case when nullif(coalesce(inventory.payload ->> 'destinationCustomerId', inventory.payload ->> 'localDestinationCustomerId', ''), '') is null
        then 'EXPORT' else 'LOCAL' end)),
    coalesce(inventory.payload ->> 'destinationCustomerId', inventory.payload ->> 'localDestinationCustomerId', ''),
    coalesce(inventory.payload ->> 'lotId', ''),
    upper(btrim(coalesce(inventory.payload ->> 'variety', ''))),
    coalesce(nullif(inventory.payload ->> 'length', '')::numeric, 0),
    upper(btrim(coalesce(inventory.payload ->> 'quality', inventory.payload ->> 'category', 'EXPORTACION')))
  order by destination_type, destination_customer_name, variety, length, quality, lot_code;
end;
$$;

create or replace function public.erp_destination_v2_health(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_destination_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok', true,
    'component', 'DESTINATION_LOTS_V2',
    'migration', '202608160003',
    'lotTable', to_regclass('public.erp_destination_lot_registry') is not null,
    'zebraCreateDependency', to_regprocedure('public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz)') is not null,
    'zebraReceiveDependency', to_regprocedure('public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz)') is not null,
    'warehouseReserveDependency', to_regprocedure('public.erp_warehouse_v2_reserve_order(uuid,uuid,text,text,boolean,timestamptz)') is not null,
    'warehouseScanDependency', to_regprocedure('public.erp_warehouse_v2_scan_into_box(uuid,uuid,text,text,integer,text,timestamptz)') is not null,
    'createRpc', to_regprocedure('public.erp_destination_v2_create_labels(uuid,uuid,text,jsonb,text,text,text,timestamptz)') is not null,
    'receiveRpc', to_regprocedure('public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz)') is not null,
    'confirmRpc', to_regprocedure('public.erp_destination_v2_confirm_local_order(uuid,uuid,text,text,timestamptz)') is not null,
    'reassignRpc', to_regprocedure('public.erp_destination_v2_reassign_bunch(uuid,uuid,text,text,text,text,text,timestamptz)') is not null,
    'availabilityRpc', to_regprocedure('public.erp_destination_v2_availability(uuid)') is not null
  );
end;
$$;

revoke all on function public.erp_destination_v2_assert_access(uuid) from public, anon, authenticated;
revoke all on function public.erp_destination_v2_customer(uuid,text) from public, anon, authenticated;
revoke all on function public.erp_destination_v2_create_labels(uuid,uuid,text,jsonb,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_destination_v2_confirm_local_order(uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_destination_v2_reassign_bunch(uuid,uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.erp_destination_v2_availability(uuid) from public, anon, authenticated;
revoke all on function public.erp_destination_v2_health(uuid) from public, anon, authenticated;

grant execute on function public.erp_destination_v2_create_labels(uuid,uuid,text,jsonb,text,text,text,timestamptz) to authenticated;
grant execute on function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;
grant execute on function public.erp_destination_v2_confirm_local_order(uuid,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.erp_destination_v2_reassign_bunch(uuid,uuid,text,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.erp_destination_v2_availability(uuid) to authenticated;
grant execute on function public.erp_destination_v2_health(uuid) to authenticated;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

commit;
