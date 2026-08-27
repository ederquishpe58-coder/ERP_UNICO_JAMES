begin;

-- Cuarto Frío conserva una sola intención humana: confirmar la salida física.
-- La validación canónica sigue siendo obligatoria y se ejecuta bajo el mismo
-- lock/transacción que produce el único DISPATCH_OUT.
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
  v_prepared_internally boolean := false;
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

  -- Autoridad única de completitud. Esta función bloquea el pedido cuando p_lock=true
  -- y conserva todas las reglas agregadas de cajas, cantidades y conflictos.
  v_validation := public.erp_dispatch_v2_validate_ready(p_company_id, p_order_id, true);
  if not coalesce((v_validation ->> 'ok')::boolean, false) then
    raise exception using errcode = '23514', message = 'DISPATCH_V2_NOT_READY:' || coalesce(v_validation ->> 'status', 'UNKNOWN');
  end if;
  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'commercial_orders'
    and record.record_id = p_order_id and record.deleted_at is null for update;

  if upper(coalesce(v_order.payload ->> 'dispatchStatus', v_order.payload ->> 'status', '')) = 'READY_FOR_DISPATCH' then
    v_prepared_internally := false;
  elsif upper(coalesce(v_order.payload ->> 'status', '')) = 'COMPLETADO'
    and upper(coalesce(v_order.payload ->> 'fulfillmentStatus', '')) = 'COMPLETADO' then
    v_prepared_internally := true;
  else
    raise exception using errcode = '23514', message = 'DISPATCH_V2_DIRECT_CONFIRM_STATE_INVALID';
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
      ready_at = coalesce(ready_at, v_now), ready_by = coalesce(ready_by, auth.uid()),
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
        'dispatchCode', v_dispatch.dispatch_code, 'readyAt', v_box.ready_at,
        'dispatchedAt', v_now, 'updatedAtServer', v_box.updated_at, 'syncFlow', 'DISPATCH_V2'
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

    -- Único OUT físico: completar/preparar nunca reduce inventario.
    v_saved := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_inventory_movements',
      'DISPATCH-OUT:' || v_assignment.bunch_id::text,
      jsonb_build_object(
        'id', 'DISPATCH-OUT:' || v_assignment.bunch_id::text,
        'operationId', p_operation_id::text,
        'date', to_char(v_now at time zone 'America/Guayaquil', 'YYYY-MM-DD'),
        'dateTime', v_now, 'movementType', 'DISPATCH_OUT', 'direction', 'OUT',
        'sourceEntity', 'operations_dispatch_records', 'sourceId', v_dispatch.dispatch_id::text,
        'dispatchId', v_dispatch.dispatch_id::text, 'dispatchCode', v_dispatch.dispatch_code,
        'orderId', p_order_id, 'boxId', v_assignment.box_id::text,
        'bunchId', v_assignment.bunch_id::text, 'inventoryId', v_assignment.inventory_record_id,
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
        'availabilityDeltaBunches', 0, 'availabilityDeltaStems', 0,
        'origin', 'CUARTO_FRIO', 'destination', coalesce(p_logistics ->> 'destination', ''),
        'observation', 'Salida física definitiva confirmada por despacho.', 'syncFlow', 'DISPATCH_V2'
      ), 0
    );
    v_records := v_records || jsonb_build_array(v_saved);
  end loop;

  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'commercial_orders', p_order_id,
    v_order.payload || jsonb_build_object(
      'status', 'DISPATCHED', 'warehouseStatus', 'DISPATCHED', 'dispatchStatus', 'DISPATCHED',
      'readyForDispatchAt', coalesce(nullif(v_order.payload ->> 'readyForDispatchAt', '')::timestamptz, v_now),
      'dispatchPreparedInternally', v_prepared_internally, 'dispatchValidation', v_validation,
      'dispatchId', v_dispatch.dispatch_id::text, 'dispatchCode', v_dispatch.dispatch_code,
      'dispatchedAt', v_now, 'shippedAt', v_now, 'dispatchLogistics', v_dispatch.logistics,
      'dispatchObservations', v_dispatch.observations, 'dispatchFlowVersion', 3
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
      'preparedAt', v_dispatch.prepared_at, 'preparedInternally', v_prepared_internally,
      'dispatchValidation', v_validation, 'dispatchedAt', v_dispatch.dispatched_at,
      'createdAt', v_dispatch.created_at, 'updatedAtServer', v_dispatch.updated_at,
      'syncFlow', 'DISPATCH_V2'
    ), 0
  );
  v_records := v_records || jsonb_build_array(v_saved);
  v_result := jsonb_build_object('ok', true, 'command', 'CONFIRM_DISPATCH',
    'operationId', p_operation_id, 'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object('status', 'DISPATCHED', 'dispatchId', v_dispatch.dispatch_id,
      'dispatchCode', v_dispatch.dispatch_code, 'orderId', p_order_id,
      'boxCount', v_dispatch.box_count, 'bunchCount', v_dispatch.bunch_count,
      'preparedInternally', v_prepared_internally, 'validation', v_validation));
  insert into public.erp_operations_commands(operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at)
  values (p_operation_id, p_company_id, 'CONFIRM_DISPATCH', p_order_id,
    jsonb_build_object('orderId', p_order_id, 'logistics', coalesce(p_logistics, '{}'::jsonb),
      'preparedInternally', v_prepared_internally),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now()));
  return v_result;
end;
$$;

-- Se conserva migration=202608150007 para no bloquear el frontend TEST anterior.
-- El capability aditivo permite que el frontend nuevo exija el patch sin romper callers previos.
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
    'patch', '202608220002',
    'directConfirmReady', true,
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

revoke all on function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) from public, anon;
revoke all on function public.erp_dispatch_v2_health(uuid) from public, anon, authenticated;
grant execute on function public.erp_dispatch_v2_confirm(uuid,uuid,text,text,jsonb,text,timestamptz) to authenticated;
grant execute on function public.erp_dispatch_v2_health(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
