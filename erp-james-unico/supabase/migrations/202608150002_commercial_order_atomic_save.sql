begin;

-- Un pedido comercial no puede consumir el numero de pedido/factura y fallar
-- antes de persistir su contenido. Esta RPC ejecuta ambos pasos dentro de la
-- misma transaccion PostgreSQL: si cualquier validacion falla, tampoco queda
-- una reserva huerfana.
create or replace function public.erp_save_commercial_order(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_record_id text,
  p_order_year integer,
  p_establishment_code text,
  p_emission_point_code text,
  p_payload jsonb,
  p_base_payload jsonb default '{}'::jsonb,
  p_field_changes jsonb default '[]'::jsonb,
  p_base_version bigint default 0,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation jsonb;
  v_payload jsonb;
  v_changes jsonb := coalesce(p_field_changes, '[]'::jsonb);
  v_sync record;
  v_key text;
  v_value jsonb;
begin
  if p_operation_id is null
     or nullif(btrim(p_device_id), '') is null
     or nullif(btrim(p_record_id), '') is null
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_base_payload, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_field_changes, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'COMMERCIAL_ORDER_SAVE_INPUT_INVALID';
  end if;

  v_reservation := public.erp_reserve_commercial_order_identifiers(
    p_company_id,
    p_record_id,
    p_order_year,
    p_establishment_code,
    p_emission_point_code,
    '01'
  );

  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'id', p_record_id,
    'number', v_reservation ->> 'orderNumber',
    'numberPending', false,
    'unsavedDraft', false,
    'sriInvoiceNumber', v_reservation ->> 'fullNumber',
    'sriSequential', v_reservation ->> 'invoiceSequential',
    'packingListNumber', v_reservation ->> 'invoiceSequential',
    'invoicePackingNumber', v_reservation ->> 'invoiceSequential',
    'clientInvoiceNumber', v_reservation ->> 'invoiceSequential',
    'invoiceSequence', v_reservation ->> 'invoiceSequential',
    'establishmentCode', v_reservation ->> 'establishmentCode',
    'emissionPointCode', v_reservation ->> 'emissionPointCode',
    'sriSequenceStatus', 'RESERVADO',
    'sriSequenceSource', 'SUPABASE_TRANSACCIONAL',
    'sriSequenceReservationId', v_reservation ->> 'invoiceReservationId',
    'sriSequenceAllocatedAt', v_reservation ->> 'reservedAt'
  );

  -- Los identificadores son calculados por el servidor. Se agregan al parche
  -- para que una edicion concurrente tambien pueda fusionarse por campo.
  for v_key, v_value in
    select key, value
    from jsonb_each(jsonb_build_object(
      'id', to_jsonb(p_record_id),
      'number', v_reservation -> 'orderNumber',
      'numberPending', 'false'::jsonb,
      'unsavedDraft', 'false'::jsonb,
      'sriInvoiceNumber', v_reservation -> 'fullNumber',
      'sriSequential', v_reservation -> 'invoiceSequential',
      'packingListNumber', v_reservation -> 'invoiceSequential',
      'invoicePackingNumber', v_reservation -> 'invoiceSequential',
      'clientInvoiceNumber', v_reservation -> 'invoiceSequential',
      'invoiceSequence', v_reservation -> 'invoiceSequential',
      'establishmentCode', v_reservation -> 'establishmentCode',
      'emissionPointCode', v_reservation -> 'emissionPointCode',
      'sriSequenceStatus', to_jsonb('RESERVADO'::text),
      'sriSequenceSource', to_jsonb('SUPABASE_TRANSACCIONAL'::text),
      'sriSequenceReservationId', v_reservation -> 'invoiceReservationId',
      'sriSequenceAllocatedAt', v_reservation -> 'reservedAt'
    ))
  loop
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'path', jsonb_build_array(v_key),
      'base_exists', coalesce(p_base_payload, '{}'::jsonb) ? v_key,
      'base', coalesce(p_base_payload, '{}'::jsonb) -> v_key,
      'value_exists', true,
      'value', v_value
    ));
  end loop;

  select * into v_sync
  from public.erp_apply_offline_operation(
    p_operation_id,
    p_company_id,
    p_device_id,
    'commercial_orders',
    case when p_base_version > 0 then 'UPDATE' else 'INSERT' end,
    p_record_id,
    v_payload,
    coalesce(p_base_payload, '{}'::jsonb),
    v_changes,
    greatest(coalesce(p_base_version, 0), 0),
    coalesce(p_local_created_at, now())
  );

  if v_sync.operation_id is null or v_sync.status <> 'SYNCED' or v_sync.server_record is null then
    raise exception using errcode = '40001', message = 'COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'reservation', v_reservation,
    'operationId', v_sync.operation_id,
    'status', v_sync.status,
    'resultVersion', v_sync.result_version,
    'serverTime', v_sync.server_time,
    'serverRecord', v_sync.server_record,
    'discardedFields', coalesce(v_sync.discarded_fields, '[]'::jsonb),
    'mergeSummary', coalesce(v_sync.merge_summary, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.erp_save_commercial_order(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb, jsonb, bigint, timestamptz
) from public, anon;
grant execute on function public.erp_save_commercial_order(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb, jsonb, bigint, timestamptz
) to authenticated, service_role;

-- Los intentos fallidos anteriores se conservan como saltos auditables y no se
-- reutilizan. Solo dejan de presentarse como reservas activas.
update public.commercial_invoice_reservations reservation
set status = 'REPLACED',
    replaced_at = coalesce(replaced_at, now()),
    updated_at = now()
where reservation.status = 'ACTIVE'
  and reservation.consumed_document_id is null
  and not exists (
    select 1
    from public.erp_entity_records record
    where record.company_id = reservation.company_id
      and record.entity = 'commercial_orders'
      and record.record_id = reservation.record_id
      and record.deleted_at is null
  );

commit;
