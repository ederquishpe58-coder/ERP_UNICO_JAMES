begin;

-- Protección mínima del ciclo V2: una escritura genérica o una copia local
-- obsoleta no puede degradar un pedido confirmado a un borrador anterior.
create or replace function public.erp_guard_commercial_order_status_regression()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_status text := upper(nullif(btrim(old.payload ->> 'status'), ''));
  v_new_status text := upper(nullif(btrim(new.payload ->> 'status'), ''));
  v_explicit_reversal boolean := coalesce(
    nullif(current_setting('app.commercial_order_explicit_reversal', true), '')::boolean,
    false
  );
begin
  if old.entity <> 'commercial_orders' or new.entity <> 'commercial_orders' or v_explicit_reversal then
    return new;
  end if;

  if v_old_status in ('EN_CUARTO_FRIO', 'COMPLETADO', 'PACKED', 'READY_FOR_DISPATCH')
     and coalesce(v_new_status, '') in ('BORRADOR', 'BORRADOR_LOCAL', 'GUARDADO') then
    raise exception using
      errcode = '23514',
      message = format('COMMERCIAL_ORDER_STATUS_REGRESSION_BLOCKED:%s:%s', v_old_status, coalesce(v_new_status, 'NULL'));
  end if;

  if v_old_status = 'DISPATCHED' and coalesce(v_new_status, '') <> 'DISPATCHED' then
    raise exception using
      errcode = '23514',
      message = format('COMMERCIAL_ORDER_DISPATCHED_IMMUTABLE:%s', coalesce(v_new_status, 'NULL'));
  end if;

  return new;
end;
$$;

drop trigger if exists erp_commercial_order_status_regression_guard on public.erp_entity_records;
create trigger erp_commercial_order_status_regression_guard
before update of payload on public.erp_entity_records
for each row
when (old.entity = 'commercial_orders' and new.entity = 'commercial_orders')
execute function public.erp_guard_commercial_order_status_regression();

revoke all on function public.erp_guard_commercial_order_status_regression() from public, anon, authenticated;

create or replace function public.erp_patch_commercial_order_coordination(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_record_id text,
  p_expected_version bigint,
  p_patch jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.erp_entity_records%rowtype;
  v_prior public.erp_operations_commands%rowtype;
  v_saved jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_allowed_keys constant text[] := array['daeNumber', 'awb', 'hawb', 'airlineId'];
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null
     or nullif(btrim(p_device_id), '') is null
     or nullif(btrim(p_record_id), '') is null
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or coalesce(p_expected_version, 0) < 1 then
    raise exception using errcode = '22023', message = 'COMMERCIAL_ORDER_COORDINATION_PATCH_INVALID';
  end if;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as keys(key)
    where key <> all(v_allowed_keys)
  ) then
    raise exception using errcode = '22023', message = 'COMMERCIAL_ORDER_COORDINATION_FIELD_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':COMMERCIAL_COORDINATION:' || p_record_id, 0));
  select * into v_prior from public.erp_operations_commands
  where operation_id = p_operation_id and company_id = p_company_id;
  if found then return v_prior.result; end if;

  select * into v_order from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = 'commercial_orders'
    and record.record_id = p_record_id
    and record.deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'COMMERCIAL_ORDER_NOT_FOUND'; end if;
  if v_order.version <> p_expected_version then
    -- No usar 40001: PostgreSQL/PostgREST lo interpreta como fallo de
    -- serialización reintentable. Este es un conflicto empresarial definitivo.
    raise exception using errcode = 'P0001',
      message = format('COMMERCIAL_ORDER_VERSION_CONFLICT:SERVER_%s:CLIENT_%s', v_order.version, p_expected_version);
  end if;

  v_payload := v_order.payload || p_patch || jsonb_build_object(
    'status', v_order.payload -> 'status',
    'warehouseStatus', v_order.payload -> 'warehouseStatus',
    'fulfillmentStatus', v_order.payload -> 'fulfillmentStatus',
    'coordinationUpdatedAt', clock_timestamp()
  );
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'commercial_orders', p_record_id,
    v_payload, v_order.version
  );
  v_result := jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'serverTime', clock_timestamp(),
    'serverRecord', v_saved,
    'result', jsonb_build_object('status', 'COORDINATION_UPDATED')
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'UPDATE_ORDER_COORDINATION', p_record_id,
    p_patch, v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

revoke all on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz)
from public, anon;
grant execute on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz)
to authenticated, service_role;

commit;
