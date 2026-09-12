-- Installed commercial numbering helper, read-only snapshot 2026-09-12.
CREATE OR REPLACE FUNCTION public.erp_reserve_commercial_order_identifiers_u2c3_internal(p_company_id uuid, p_record_id text, p_order_year integer, p_establishment_code text, p_emission_point_code text, p_document_type text DEFAULT '01'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_order public.commercial_order_number_reservations%rowtype;
  v_order_sequential bigint;
begin
  if v_actor is null or not public.erp_is_company_member(p_company_id, v_actor) then
    raise exception using errcode = '42501', message = 'ERP_COMPANY_ACCESS_REQUIRED';
  end if;
  if nullif(btrim(p_record_id), '') is null
     or p_order_year not between 2020 and 2200
 then
    raise exception using errcode = '22023', message = 'COMMERCIAL_IDENTIFIER_INPUT_INVALID';
  end if;

  -- Order identity is independent of any tax environment or emission point.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':COMMERCIAL_ORDER:' || p_record_id, 0));

  select * into v_order
  from public.commercial_order_number_reservations reservation
  where reservation.company_id = p_company_id
    and reservation.record_id = p_record_id
  for update;

  if not found then
    insert into public.commercial_order_sequences(company_id, order_year, next_value, updated_by)
    values (p_company_id, p_order_year, 1, v_actor)
    on conflict (company_id, order_year) do nothing;

    select sequence_row.next_value into v_order_sequential
    from public.commercial_order_sequences sequence_row
    where sequence_row.company_id = p_company_id
      and sequence_row.order_year = p_order_year
    for update;
    if v_order_sequential > 99999999 then
      raise exception using errcode = '22003', message = 'COMMERCIAL_ORDER_SEQUENCE_EXHAUSTED';
    end if;

    update public.commercial_order_sequences
    set next_value = v_order_sequential + 1, updated_by = v_actor, updated_at = now()
    where company_id = p_company_id and order_year = p_order_year;

    insert into public.commercial_order_number_reservations(
      company_id, record_id, order_year, sequential, order_number, created_by
    ) values (
      p_company_id,
      p_record_id,
      p_order_year,
      v_order_sequential,
      'PED-COM-' || p_order_year::text || '-' || lpad(v_order_sequential::text, 4, '0'),
      v_actor
    ) returning * into v_order;
  end if;

  return jsonb_build_object(
    'orderReservationId', v_order.id,
    'orderSequential', v_order.sequential,
    'orderNumber', v_order.order_number,
    'reservedAt', v_order.created_at
  );
end;
$function$
