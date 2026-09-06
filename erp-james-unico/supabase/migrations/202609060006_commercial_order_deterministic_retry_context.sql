-- ORDER-RETRY-03: preserve the semantic request before server-derived seller changes.
-- No existing row is updated. No policies/grants/sequences/seller rules are changed.
begin;
alter table public.erp_sync_operations add column commercial_order_request_context jsonb;
comment on column public.erp_sync_operations.commercial_order_request_context is 'Server-owned semantic request and original order reservation; written only after canonical order ACK in the same transaction. NULL historic context is not accepted as an equivalent retry.';
CREATE OR REPLACE FUNCTION public.erp_save_commercial_order_quality_legacy(p_operation_id uuid, p_company_id uuid, p_device_id text, p_record_id text, p_order_year integer, p_establishment_code text, p_emission_point_code text, p_payload jsonb, p_base_payload jsonb DEFAULT '{}'::jsonb, p_field_changes jsonb DEFAULT '[]'::jsonb, p_base_version bigint DEFAULT 0, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request_identity jsonb; v_previous public.erp_sync_operations%rowtype; v_replay boolean:=false;
  v_reservation jsonb; v_payload jsonb; v_changes jsonb:=coalesce(p_field_changes,'[]'::jsonb);
  v_sync record; v_key text; v_value jsonb; v_existing public.erp_entity_records%rowtype;
  v_existing_found boolean:=false; v_seller public.erp_payroll_employees%rowtype; v_seller_id_text text;
  v_seller_id uuid; v_seller_keys constant text[]:=array['seller_id','sellerId','seller_name','sellerName','sellerEmployeeId','seller_employee_id'];
begin
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null or nullif(btrim(p_record_id),'') is null
    or jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object'
    or jsonb_typeof(coalesce(p_base_payload,'{}'::jsonb))<>'object'
    or jsonb_typeof(coalesce(p_field_changes,'[]'::jsonb))<>'array' then
    raise exception using errcode='22023',message='COMMERCIAL_ORDER_SAVE_INPUT_INVALID';
  end if;
  -- Capture every semantic client value before seller/tax/number normalization.
  -- JSONB canonicalizes object key order; field-change array order remains significant.
  -- Device and request time are transport metadata, as in the generic context contract.
  v_request_identity:=jsonb_build_object(
    'version',1,'company_id',p_company_id,'actor_id',auth.uid(),
    'entity','commercial_orders','action',case when p_base_version>0 then 'UPDATE' else 'INSERT' end,
    'record_id',p_record_id,'order_year',p_order_year,
    'establishment_code',p_establishment_code,'emission_point_code',p_emission_point_code,
    'payload',coalesce(p_payload,'{}'::jsonb),'base_payload',coalesce(p_base_payload,'{}'::jsonb),
    'field_changes',coalesce(p_field_changes,'[]'::jsonb),'base_version',coalesce(p_base_version,0));
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_previous from public.erp_sync_operations operation where operation.operation_id=p_operation_id;
  v_replay:=found;
  if v_replay then
    -- Never infer an original client request from already-normalized seller state.
    -- Operations predating this context cannot prove equivalence and stay fail closed.
    if v_previous.company_id is distinct from p_company_id
       or v_previous.user_id is distinct from auth.uid()
       or v_previous.entity is distinct from 'commercial_orders'
       or v_previous.action is distinct from (case when p_base_version>0 then 'UPDATE' else 'INSERT' end)
       or v_previous.record_id is distinct from p_record_id
       or v_previous.commercial_order_request_context->'request' is distinct from v_request_identity
       or jsonb_typeof(v_previous.commercial_order_request_context->'reservation') is distinct from 'object' then
      raise exception using errcode='42501',message='OPERATIONS_IDEMPOTENCY_CONTEXT_MISMATCH';
    end if;
    -- The exact semantic request was proved. Reuse its original derived command,
    -- retaining the generic company/actor/payload/field_changes checks unchanged.
    v_payload:=v_previous.payload;
    v_changes:=v_previous.field_changes;
    v_reservation:=v_previous.commercial_order_request_context->'reservation';
  else
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':COMMERCIAL_ORDER:'||p_record_id,0));
  select * into v_existing from public.erp_entity_records record
  where record.company_id=p_company_id and record.entity='commercial_orders'
    and record.record_id=p_record_id and record.deleted_at is null for update;
  v_existing_found:=found;

  v_payload:=coalesce(p_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(change),'[]'::jsonb) into v_changes
  from jsonb_array_elements(v_changes) change
  where coalesce(change#>>'{path,0}','')<>all(v_seller_keys);

  if v_existing_found then
    foreach v_key in array v_seller_keys loop
      if v_existing.payload?v_key then v_payload:=jsonb_set(v_payload,array[v_key],v_existing.payload->v_key,true);
      else v_payload:=v_payload-v_key; end if;
    end loop;
  else
    v_seller_id_text:=coalesce(nullif(v_payload->>'sellerEmployeeId',''),nullif(v_payload->>'seller_employee_id',''),nullif(v_payload->>'seller_id',''),nullif(v_payload->>'sellerId',''));
    if v_seller_id_text is null then
      select employee.* into v_seller from public.erp_payroll_employees employee
      where employee.company_id=p_company_id and employee.user_id=auth.uid() and employee.status='ACTIVE'
        and upper(btrim(employee.area)) in ('VENTAS','COMERCIAL');
      if found then v_seller_id:=v_seller.employee_id; end if;
    else
      begin v_seller_id:=v_seller_id_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode='22023',message='COMMERCIAL_ORDER_SELLER_ID_INVALID';
      end;
    end if;
    if v_seller_id is not null and v_seller.employee_id is null then
      select employee.* into v_seller from public.erp_payroll_employees employee
      where employee.company_id=p_company_id and employee.employee_id=v_seller_id and employee.status='ACTIVE'
        and upper(btrim(employee.area)) in ('VENTAS','COMERCIAL');
    end if;
    if v_seller.employee_id is null then
      raise exception using errcode='23514',message='COMMERCIAL_ORDER_SALES_REPRESENTATIVE_REQUIRED';
    end if;
    v_payload:=v_payload||jsonb_build_object(
      'seller_id',v_seller.employee_id::text,'sellerId',v_seller.employee_id::text,
      'sellerEmployeeId',v_seller.employee_id,'seller_employee_id',v_seller.employee_id,
      'seller_name',v_seller.full_name,'sellerName',v_seller.full_name
    );
    for v_key,v_value in select key,value from jsonb_each(jsonb_build_object(
      'seller_id',to_jsonb(v_seller.employee_id::text),'sellerId',to_jsonb(v_seller.employee_id::text),
      'sellerEmployeeId',to_jsonb(v_seller.employee_id),'seller_employee_id',to_jsonb(v_seller.employee_id),
      'seller_name',to_jsonb(v_seller.full_name),'sellerName',to_jsonb(v_seller.full_name)
    )) loop
      v_changes:=v_changes||jsonb_build_array(jsonb_build_object('path',jsonb_build_array(v_key),'base_exists',false,'base',null,'value_exists',true,'value',v_value));
    end loop;
  end if;

  -- Preserve existing tax identities; never accept or allocate them in an order save.
  select coalesce(jsonb_agg(change),'[]'::jsonb) into v_changes
  from jsonb_array_elements(v_changes) change
  where coalesce(change#>>'{path,0}','') <> all(array['sriInvoiceNumber','sriSequential','packingListNumber','invoicePackingNumber','clientInvoiceNumber','invoiceSequence','establishmentCode','emissionPointCode','sriSequenceStatus','sriSequenceSource','sriSequenceReservationId','sriSequenceAllocatedAt']);
  foreach v_key in array array['sriInvoiceNumber','sriSequential','packingListNumber','invoicePackingNumber','clientInvoiceNumber','invoiceSequence','establishmentCode','emissionPointCode','sriSequenceStatus','sriSequenceSource','sriSequenceReservationId','sriSequenceAllocatedAt'] loop
    if v_existing_found and v_existing.payload ? v_key then
      v_payload := jsonb_set(v_payload,array[v_key],v_existing.payload->v_key,true);
    else
      v_payload := v_payload - v_key;
    end if;
  end loop;
  v_reservation:=public.erp_reserve_commercial_order_identifiers_u2c3_internal(p_company_id,p_record_id,p_order_year,null,null,'01');
  v_payload:=v_payload||jsonb_build_object(
    'id',p_record_id,'number',v_reservation->>'orderNumber','numberPending',false,'unsavedDraft',false);
  for v_key,v_value in select key,value from jsonb_each(jsonb_build_object(
    'id',to_jsonb(p_record_id),'number',v_reservation->'orderNumber','numberPending','false'::jsonb,'unsavedDraft','false'::jsonb)) loop
    v_changes:=v_changes||jsonb_build_array(jsonb_build_object('path',jsonb_build_array(v_key),'base_exists',coalesce(p_base_payload,'{}'::jsonb)?v_key,
      'base',coalesce(p_base_payload,'{}'::jsonb)->v_key,'value_exists',true,'value',v_value));
  end loop;
  end if; -- first-attempt business normalization only
  select * into v_sync from public.erp_apply_offline_operation_u2c3_internal(p_operation_id,p_company_id,p_device_id,'commercial_orders',
    case when p_base_version>0 then 'UPDATE' else 'INSERT' end,p_record_id,v_payload,coalesce(p_base_payload,'{}'::jsonb),v_changes,
    greatest(coalesce(p_base_version,0),0),coalesce(p_local_created_at,now()));
  if v_sync.operation_id is null or v_sync.status<>'SYNCED' or v_sync.server_record is null then
    raise exception using errcode='40001',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';
  end if;
  if not v_replay then
    -- Same transaction as order, reservation and operation; no orphan context on failure.
    update public.erp_sync_operations operation
    set commercial_order_request_context=jsonb_build_object('request',v_request_identity,'reservation',v_reservation)
    where operation.operation_id=p_operation_id and operation.company_id=p_company_id
      and operation.user_id=auth.uid() and operation.entity='commercial_orders'
      and operation.record_id=p_record_id;
    if not found then
      raise exception using errcode='40001',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';
    end if;
  end if;
  return jsonb_build_object('ok',true,'reservation',v_reservation,'operationId',v_sync.operation_id,'status',v_sync.status,
    'resultVersion',v_sync.result_version,'serverTime',v_sync.server_time,'serverRecord',v_sync.server_record,
    'discardedFields',coalesce(v_sync.discarded_fields,'[]'::jsonb),'mergeSummary',coalesce(v_sync.merge_summary,'{}'::jsonb));
end $function$
;
commit;
