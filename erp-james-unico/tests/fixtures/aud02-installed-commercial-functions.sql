-- Installed commercial save/reservation definitions. READ-ONLY snapshot 2026-09-12; tests only.
CREATE OR REPLACE FUNCTION public.erp_commercial_reserve_invoice_for_documents(p_company_id uuid, p_order_id text, p_document_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid:=auth.uid(); v_order jsonb; v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype; v_res public.commercial_invoice_reservations%rowtype;
  v_doc public.electronic_documents%rowtype; v_ep text; v_count integer; v_next bigint;
  v_number text; v_created boolean:=false;
begin
  if v_actor is null or not public.erp_is_company_member(p_company_id,v_actor) then
    raise exception 'ERP_COMPANY_ACCESS_REQUIRED';
  end if;
  perform public.erp_security_assert_capability(p_company_id,'commercial.orders.view');
  perform public.erp_security_assert_capability(p_company_id,'commercial.electronic_documents.create');
  if p_document_code is null or p_document_code not in ('ETIQUETAS','INVOICE_PACKING_REFERENCIAL','COMMERCIAL_INVOICE_CLIENT','HR')
    or nullif(btrim(p_order_id),'') is null then raise exception 'COMMERCIAL_RESERVATION_INPUT_INVALID'; end if;
  -- Same lock order as create_electronic_document_draft: settings, point, invoice key.
  select * into v_settings from public.sri_settings where company_id=p_company_id for update;
  if not found or v_settings.environment not in ('TEST','PRODUCTION') then raise exception 'SRI_CONFIGURATION_REQUIRED'; end if;
  select payload into v_order from public.erp_entity_records
    where company_id=p_company_id and entity='commercial_orders' and record_id=p_order_id and deleted_at is null for share;
  if not found or nullif(v_order->>'number','') is null or coalesce((v_order->>'unsavedDraft')::boolean,false)
    or coalesce((v_order->>'numberPending')::boolean,false) then raise exception 'COMMERCIAL_SAVED_ORDER_REQUIRED'; end if;
  if upper(coalesce(v_order->>'status','')) in ('ANULADO','CANCELLED','VOIDED') then raise exception 'COMMERCIAL_ORDER_CANCELLED'; end if;
  -- Reuse the validated LOCAL / EXPORT routing, deriving it from the saved order.
  v_ep:=case when coalesce(v_order->>'saleType','') ~* 'LOCAL'
    or coalesce(v_order->>'transportType','') ~* 'TERRESTRE|LOCAL' then '003' else '002' end;
  select count(*) into v_count from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active;
  if v_count<>1 then raise exception 'SRI_ACTIVE_EMISSION_POINT_REQUIRED'; end if;
  select * into v_point from public.emission_points where company_id=p_company_id
    and environment=v_settings.environment and establishment_code='001' and emission_point_code=v_ep and active for update;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':SRI_INVOICE:'||v_settings.environment||':'||p_order_id,0));
  select count(*) into v_count from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED');
  if v_count>1 then raise exception 'COMMERCIAL_INVOICE_RESERVATION_AMBIGUOUS'; end if;
  select * into v_res from public.commercial_invoice_reservations where company_id=p_company_id
    and record_id=p_order_id and environment=v_settings.environment and document_type='01' and status in ('ACTIVE','CONSUMED') for update;
  if v_res.id is not null and (v_res.emission_point_id<>v_point.id or v_res.establishment_code<>'001' or v_res.emission_point_code<>v_ep) then
    raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
  if v_res.status='CONSUMED' then
    select * into v_doc from public.electronic_documents where id=v_res.consumed_document_id
      and company_id=p_company_id and environment=v_settings.environment and document_type='01';
    if not found then raise exception 'SRI_INVOICE_IDEMPOTENCY_DOCUMENT_MISSING'; end if;
  else
    select count(*) into v_count from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
    if v_count>1 then raise exception 'COMMERCIAL_INVOICE_DOCUMENT_AMBIGUOUS'; end if;
    select * into v_doc from public.electronic_documents where company_id=p_company_id
      and environment=v_settings.environment and document_type='01'
      and (source_order_id::text=p_order_id or source_snapshot#>>'{erpEmission,sourceOrderId}'=p_order_id);
  end if;
  if v_doc.id is not null then
    if v_doc.emission_point_id<>v_point.id or v_doc.establishment_code<>'001' or v_doc.emission_point_code<>v_ep
      or (v_res.id is not null and (v_res.full_number<>v_doc.full_number or v_res.sequential<>v_doc.sequential)) then
      raise exception 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT'; end if;
    v_number:=v_doc.full_number; v_next:=v_doc.sequential;
    -- Adopt an existing canonical document without touching it or the counter.
    -- This also makes the later Factura 01 retry use the existing consumed link.
    if v_res.id is null then
      insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
        establishment_code,emission_point_code,sequential,full_number,status,created_by,consumed_document_id,consumed_at)
        values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'CONSUMED',v_actor,v_doc.id,now())
        returning * into v_res;
    elsif v_res.status='ACTIVE' then
      update public.commercial_invoice_reservations set status='CONSUMED',consumed_document_id=v_doc.id,consumed_at=now(),updated_at=now()
        where id=v_res.id returning * into v_res;
    end if;
  elsif v_res.id is not null then
    v_number:=v_res.full_number; v_next:=v_res.sequential;
  else
    -- OFF remains OFF. Reading an existing identity does not enable issuance.
    perform public.sri_assert_environment_enabled(p_company_id,v_settings.environment);
    perform public.sri_assert_canonical_certificate(p_company_id);
    perform public.sri_assert_document_routing(p_company_id,v_settings.environment,v_point.id,'01');
    select next_value into v_next from public.electronic_document_sequences where company_id=p_company_id
      and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01' for update;
    if v_next is null then raise exception 'SRI_SEQUENCE_CONFIGURATION_REQUIRED'; end if;
    if v_next<1 or v_next>999999999 then raise exception 'SRI_SEQUENTIAL_EXHAUSTED'; end if;
    v_number:='001-'||v_ep||'-'||lpad(v_next::text,9,'0');
    update public.electronic_document_sequences set next_value=v_next+1,updated_by=v_actor
      where company_id=p_company_id and emission_point_id=v_point.id and environment=v_settings.environment and document_type='01';
    insert into public.commercial_invoice_reservations(company_id,record_id,emission_point_id,environment,document_type,
      establishment_code,emission_point_code,sequential,full_number,status,created_by)
      values(p_company_id,p_order_id,v_point.id,v_settings.environment,'01','001',v_ep,v_next,v_number,'ACTIVE',v_actor) returning * into v_res;
    v_created:=true;
  end if;
  if v_number is distinct from '001-'||v_ep||'-'||lpad(v_next::text,9,'0') then raise exception 'COMMERCIAL_INVOICE_IDENTITY_INVALID'; end if;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'orderId',p_order_id,'orderNumber',v_order->>'number',
    'environment',v_settings.environment,'documentType','01','emissionPointId',v_point.id,
    'establishmentCode','001','emissionPointCode',v_ep,'sequential',lpad(v_next::text,9,'0'),'fullNumber',v_number,
    'reservationId',v_res.id,'documentId',v_doc.id,'status',case when v_doc.id is not null then 'DOCUMENT' else 'ACTIVE' end,
    'created',v_created,'reused',not v_created);
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_save_commercial_order(p_operation_id uuid, p_company_id uuid, p_device_id text, p_record_id text, p_order_year integer, p_establishment_code text, p_emission_point_code text, p_payload jsonb, p_base_payload jsonb DEFAULT '{}'::jsonb, p_field_changes jsonb DEFAULT '[]'::jsonb, p_base_version bigint DEFAULT 0, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_save_commercial_order', p_company_id, jsonb_build_object('record_id',p_record_id)
  );
  return public.erp_save_commercial_order_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_record_id, p_order_year, p_establishment_code, p_emission_point_code, p_payload, p_base_payload, p_field_changes, p_base_version, p_local_created_at);
end;
$function$;

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
    raise exception using errcode='PT409',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';
  end if;
  if not v_replay then
    -- Same transaction as order, reservation and operation; no orphan context on failure.
    update public.erp_sync_operations operation
    set commercial_order_request_context=jsonb_build_object('request',v_request_identity,'reservation',v_reservation)
    where operation.operation_id=p_operation_id and operation.company_id=p_company_id
      and operation.user_id=auth.uid() and operation.entity='commercial_orders'
      and operation.record_id=p_record_id;
    if not found then
      raise exception using errcode='PT409',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';
    end if;
  end if;
  return jsonb_build_object('ok',true,'reservation',v_reservation,'operationId',v_sync.operation_id,'status',v_sync.status,
    'resultVersion',v_sync.result_version,'serverTime',v_sync.server_time,'serverRecord',v_sync.server_record,
    'discardedFields',coalesce(v_sync.discarded_fields,'[]'::jsonb),'mergeSummary',coalesce(v_sync.merge_summary,'{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.erp_save_commercial_order_u2c3_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_record_id text, p_order_year integer, p_establishment_code text, p_emission_point_code text, p_payload jsonb, p_base_payload jsonb DEFAULT '{}'::jsonb, p_field_changes jsonb DEFAULT '[]'::jsonb, p_base_version bigint DEFAULT 0, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_line jsonb;
  v_quality text;
  v_existing boolean;
begin
  select exists(
    select 1 from public.erp_entity_records record
    where record.company_id=p_company_id and record.entity='commercial_orders'
      and record.record_id=p_record_id and record.deleted_at is null
  ) into v_existing;
  if jsonb_typeof(coalesce(p_payload->'lines','[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='COMMERCIAL_ORDER_LINES_INVALID';
  end if;
  for v_line in select value from jsonb_array_elements(coalesce(p_payload->'lines','[]'::jsonb))
  loop
    v_quality := upper(btrim(coalesce(v_line->>'quality','')));
    if (not v_existing and v_quality not in ('PREMIUM','TIPO_B'))
       or (v_quality <> '' and v_quality not in ('PREMIUM','TIPO_B')) then
      raise exception using errcode='22023', message='COMMERCIAL_ORDER_LINE_QUALITY_INVALID';
    end if;
  end loop;
  return public.erp_save_commercial_order_quality_legacy(
    p_operation_id,p_company_id,p_device_id,p_record_id,p_order_year,
    p_establishment_code,p_emission_point_code,p_payload,p_base_payload,
    p_field_changes,p_base_version,p_local_created_at
  );
end;
$function$;
