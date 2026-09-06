begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Order/SRI separation. Only function definitions change; no counters, settings or business rows.
do $precheck$ declare v_definition text; begin
  select pg_get_functiondef(oid) into v_definition from pg_proc where pronamespace='public'::regnamespace and proname='erp_reserve_commercial_order_identifiers_u2c3_internal';
  if md5(v_definition) not in ('c40612d945d5edefd3647bd3711bdb64','5879e91d6a545811e6948f7b7ee6b4ef') or v_definition is null then
    raise exception 'ORDER_SRI_BASELINE_MISMATCH:erp_reserve_commercial_order_identifiers_u2c3_internal';
  end if;
  select pg_get_functiondef(oid) into v_definition from pg_proc where pronamespace='public'::regnamespace and proname='erp_save_commercial_order_quality_legacy';
  if md5(v_definition) not in ('89b31af4549a9b59f6f651e01c7c58b9','2c8b3f186559e8c933e6adda9e06f7db') or v_definition is null then
    raise exception 'ORDER_SRI_BASELINE_MISMATCH:erp_save_commercial_order_quality_legacy';
  end if;
  select pg_get_functiondef(oid) into v_definition from pg_proc where pronamespace='public'::regnamespace and proname='create_electronic_document_draft_u2a_internal';
  if md5(v_definition) not in ('f6d51c07135540c57757bb7fffb88073','64754bf1edd01f762d9ea442296033f6') or v_definition is null then
    raise exception 'ORDER_SRI_BASELINE_MISMATCH:create_electronic_document_draft_u2a_internal';
  end if;
end $precheck$;
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
$function$;

CREATE OR REPLACE FUNCTION public.erp_save_commercial_order_quality_legacy(p_operation_id uuid, p_company_id uuid, p_device_id text, p_record_id text, p_order_year integer, p_establishment_code text, p_emission_point_code text, p_payload jsonb, p_base_payload jsonb DEFAULT '{}'::jsonb, p_field_changes jsonb DEFAULT '[]'::jsonb, p_base_version bigint DEFAULT 0, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
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
  select * into v_sync from public.erp_apply_offline_operation_u2c3_internal(p_operation_id,p_company_id,p_device_id,'commercial_orders',
    case when p_base_version>0 then 'UPDATE' else 'INSERT' end,p_record_id,v_payload,coalesce(p_base_payload,'{}'::jsonb),v_changes,
    greatest(coalesce(p_base_version,0),0),coalesce(p_local_created_at,now()));
  if v_sync.operation_id is null or v_sync.status<>'SYNCED' or v_sync.server_record is null then
    raise exception using errcode='40001',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';
  end if;
  return jsonb_build_object('ok',true,'reservation',v_reservation,'operationId',v_sync.operation_id,'status',v_sync.status,
    'resultVersion',v_sync.result_version,'serverTime',v_sync.server_time,'serverRecord',v_sync.server_record,
    'discardedFields',coalesce(v_sync.discarded_fields,'[]'::jsonb),'mergeSummary',coalesce(v_sync.merge_summary,'{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.create_electronic_document_draft_u2a_internal(p_company_id uuid, p_emission_point_id uuid, p_document_type text, p_issue_date date, p_numeric_code text, p_xml_version text, p_xsd_version text, p_issuer_snapshot jsonb, p_buyer_snapshot jsonb, p_source_snapshot jsonb, p_source_order_id uuid, p_source_packing_id uuid, p_customer_id uuid, p_parent_document_id uuid, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype;
  v_original public.electronic_documents%rowtype;
  v_reservation public.commercial_invoice_reservations%rowtype;
  v_source_record_id text := coalesce(
    nullif(btrim(p_source_snapshot #>> '{erpEmission,sourceOrderId}'), ''),
    p_source_order_id::text,
    case when nullif(btrim(p_source_snapshot #>> '{erpEmission,idempotencyKey}'), '') is not null
      then 'SRI-IDEMP:' || btrim(p_source_snapshot #>> '{erpEmission,idempotencyKey}') end
  );
  v_purchase_text text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,purchaseDocumentId}'), '');
  v_operation_text text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,operationId}'), '');
  v_device_id text := nullif(btrim(p_source_snapshot #>> '{erpPurchase,deviceId}'), '');
  v_purchase_id uuid;
  v_operation_id uuid;
  v_purchase public.erp_supplier_purchase_documents%rowtype;
  v_link public.erp_supplier_purchase_withholding_links%rowtype;
  v_existing_command public.erp_operations_commands%rowtype;
  v_journal_entry_id uuid;
  v_command_result jsonb;
  v_sequential bigint;
  v_access_key text;
  v_document public.electronic_documents%rowtype;
begin
  if p_document_type not in ('01', '04', '06', '07') then
    raise exception using errcode = '22023', message = 'SRI_DOCUMENT_TYPE_NOT_ENABLED';
  end if;
  if p_issue_date is null or p_numeric_code !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'SRI_DRAFT_IDENTIFIERS_INVALID';
  end if;
  if (p_document_type = '07' and (p_xml_version <> '2.0.0' or p_xsd_version <> '2.0.0'))
     or (p_document_type <> '07' and (p_xml_version <> '1.1.0' or p_xsd_version <> '1.1.0')) then
    raise exception using errcode = '22023', message = 'SRI_XML_VERSION_NOT_ENABLED';
  end if;
  if jsonb_typeof(p_issuer_snapshot) <> 'object'
     or jsonb_typeof(p_buyer_snapshot) <> 'object'
     or jsonb_typeof(p_source_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'SRI_SNAPSHOT_MUST_BE_OBJECT';
  end if;
  if p_created_by is null or not exists (
    select 1 from public.sri_company_memberships membership
    where membership.company_id = p_company_id
      and membership.auth_user_id = p_created_by
      and membership.active
      and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_CREATE_DOCUMENT';
  end if;

  if p_document_type = '07' and v_purchase_text is not null then
    if v_purchase_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_operation_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_device_id is null then
      raise exception using errcode = '22023', message = 'SUPPLIER_WITHHOLDING_V2_COMMAND_INVALID';
    end if;
    v_purchase_id := v_purchase_text::uuid;
    v_operation_id := v_operation_text::uuid;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':PURCHASE_WITHHOLDING:' || v_purchase_id::text, 0));

    select * into v_existing_command
    from public.erp_operations_commands
    where operation_id = v_operation_id and company_id = p_company_id;
    if found and v_existing_command.command_type <> 'SUPPLIER_CREATE_WITHHOLDING' then
      raise exception using errcode = '23505', message = 'SUPPLIER_WITHHOLDING_V2_OPERATION_CONFLICT';
    end if;

    select * into v_purchase
    from public.erp_supplier_purchase_documents
    where company_id = p_company_id and purchase_document_id = v_purchase_id
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'SUPPLIER_WITHHOLDING_V2_PURCHASE_NOT_FOUND';
    end if;
    if v_purchase.status <> 'POSTED' or v_purchase.retention_decision <> 'APLICAR' then
      raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_PURCHASE_NOT_ELIGIBLE';
    end if;
    if v_purchase.retention_status not in (
      'PENDING_ISSUANCE','DRAFT_CREATED','PROCESSING','AUTHORIZED','RETURNED','NOT_AUTHORIZED','ERROR'
    ) then
      raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_STATUS_INVALID';
    end if;

    select * into v_link
    from public.erp_supplier_purchase_withholding_links
    where company_id = p_company_id and purchase_document_id = v_purchase_id
    for update;
    if found then
      select * into v_document from public.electronic_documents
      where company_id = p_company_id and id = v_link.electronic_document_id and document_type = '07'
        and environment = (select environment from public.sri_settings where company_id = p_company_id);
      if not found then
        raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_LINK_INVALID';
      end if;
      v_command_result := jsonb_build_object(
        'ok', true, 'serverTime', clock_timestamp(),
        'result', jsonb_build_object(
          'purchaseDocumentId', v_purchase_id::text,
          'electronicDocumentId', v_document.id::text,
          'journalEntryId', v_link.journal_entry_id::text,
          'reused', true
        )
      );
      insert into public.erp_operations_commands(
        operation_id, company_id, command_type, source_record_id, request_payload,
        result, status, user_id, device_id, local_created_at, server_created_at
      ) values (
        v_operation_id, p_company_id, 'SUPPLIER_CREATE_WITHHOLDING', v_purchase_id::text,
        jsonb_build_object('purchaseDocumentId', v_purchase_id::text), v_command_result,
        'CONFIRMED', p_created_by, v_device_id, clock_timestamp(), clock_timestamp()
      ) on conflict (operation_id) do nothing;
      return to_jsonb(v_document) || jsonb_build_object(
        '_reservation_reused', true,
        '_purchase_document_id', v_purchase_id::text,
        '_journal_entry_id', v_link.journal_entry_id::text
      );
    end if;
  elsif p_document_type = '07' then
    -- Se mantienen legibles los comprobantes historicos, pero el flujo activo
    -- de Compras V2 siempre debe declarar la compra explicita.
    v_purchase_id := null;
  end if;

  select * into v_settings from public.sri_settings
  where company_id = p_company_id for update;
  if not found or v_settings.environment not in ('TEST', 'PRODUCTION') or not v_settings.immediate_transmission then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_REQUIRED';
  end if;
  if v_settings.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;

  -- Fail before touching tax counters, reservations or documents.
  if v_settings.environment = 'PRODUCTION' and not v_settings.production_enabled then
    raise exception using errcode = '42501', message = 'SRI_PRODUCTION_DOCUMENT_CREATION_DISABLED';
  end if;
  if p_document_type = '01' and (v_source_record_id is null or length(v_source_record_id) > 240) then
    raise exception using errcode = '22023', message = 'SRI_INVOICE_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  select * into v_point from public.emission_points
  where company_id = p_company_id and id = p_emission_point_id
    and environment = v_settings.environment and active for update;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_ACTIVE_EMISSION_POINT_REQUIRED';
  end if;

  if p_document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = p_company_id and id = p_parent_document_id
      and environment = v_settings.environment
      and document_type = '01' and status = 'AUTORIZADO' for update;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
  elsif p_parent_document_id is not null then
    raise exception using errcode = '23514', message = 'SRI_PARENT_ONLY_ALLOWED_FOR_CREDIT_NOTE';
  end if;

  if p_document_type = '01' and v_source_record_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      p_company_id::text || ':SRI_INVOICE:' || v_settings.environment || ':' || v_source_record_id, 0));
    select * into v_reservation
    from public.commercial_invoice_reservations reservation
    where reservation.company_id = p_company_id
      and reservation.record_id = v_source_record_id
      and reservation.environment = v_settings.environment
      and reservation.document_type = '01'
      and reservation.status in ('ACTIVE', 'CONSUMED')
    order by reservation.created_at desc
    limit 1
    for update;
    if found and v_reservation.emission_point_id <> p_emission_point_id then
      raise exception using errcode = '23514', message = 'SRI_INVOICE_IDEMPOTENCY_POINT_CONFLICT';
    end if;
    if found and v_reservation.status = 'CONSUMED' and v_reservation.consumed_document_id is not null then
      select * into v_document from public.electronic_documents
      where company_id = p_company_id and id = v_reservation.consumed_document_id
        and environment = v_settings.environment;
      if found then
        return to_jsonb(v_document) || jsonb_build_object('_reservation_reused', true);
      end if;
      raise exception using errcode = '23514', message = 'SRI_INVOICE_IDEMPOTENCY_DOCUMENT_MISSING';
    end if;
  end if;

  if v_reservation.id is not null and v_reservation.status = 'ACTIVE' then
    v_sequential := v_reservation.sequential;
  else
    insert into public.electronic_document_sequences(
      company_id, emission_point_id, environment, document_type, next_value, updated_by
    ) values (
      p_company_id, p_emission_point_id, v_settings.environment, p_document_type, 1, p_created_by
    ) on conflict (company_id, emission_point_id, environment, document_type) do nothing;
    select sequence_row.next_value into v_sequential
    from public.electronic_document_sequences sequence_row
    where sequence_row.company_id = p_company_id
      and sequence_row.emission_point_id = p_emission_point_id
      and sequence_row.environment = v_settings.environment
      and sequence_row.document_type = p_document_type
    for update;
    if v_sequential > 999999999 then
      raise exception using errcode = '22003', message = 'SRI_SEQUENTIAL_EXHAUSTED';
    end if;
    update public.electronic_document_sequences
    set next_value = v_sequential + 1, updated_by = p_created_by
    where company_id = p_company_id
      and emission_point_id = p_emission_point_id
      and environment = v_settings.environment
      and document_type = p_document_type;
  end if;

  -- The invoice reservation now belongs to document generation, in this transaction.
  if p_document_type = '01' and v_reservation.id is null then
    insert into public.commercial_invoice_reservations(
      company_id,record_id,emission_point_id,environment,document_type,
      establishment_code,emission_point_code,sequential,full_number,status,created_by
    ) values (
      p_company_id,v_source_record_id,p_emission_point_id,v_settings.environment,'01',
      v_point.establishment_code,v_point.emission_point_code,v_sequential,
      v_point.establishment_code || '-' || v_point.emission_point_code || '-' || lpad(v_sequential::text,9,'0'),
      'ACTIVE',p_created_by
    ) returning * into v_reservation;
  end if;

  v_access_key := public.sri_build_access_key(
    p_issue_date, p_document_type, v_settings.ruc, v_settings.environment,
    v_point.establishment_code, v_point.emission_point_code,
    v_sequential, p_numeric_code
  );

  insert into public.electronic_documents (
    company_id, emission_point_id, parent_document_id, source_order_id,
    source_packing_id, customer_id, document_type, status, issue_date,
    environment, emission_type, establishment_code, emission_point_code,
    sequential, sequential_text, full_number, numeric_code,
    verification_digit, access_key, xml_version, xsd_version,
    issuer_snapshot, buyer_snapshot, source_snapshot, created_by, updated_by
  ) values (
    p_company_id, p_emission_point_id, p_parent_document_id, p_source_order_id,
    p_source_packing_id, p_customer_id, p_document_type, 'BORRADOR', p_issue_date,
    v_settings.environment, '1', v_point.establishment_code, v_point.emission_point_code,
    v_sequential, lpad(v_sequential::text, 9, '0'),
    v_point.establishment_code || '-' || v_point.emission_point_code || '-' || lpad(v_sequential::text, 9, '0'),
    p_numeric_code, right(v_access_key, 1)::smallint, v_access_key,
    p_xml_version, p_xsd_version, p_issuer_snapshot, p_buyer_snapshot,
    p_source_snapshot, p_created_by, p_created_by
  ) returning * into v_document;

  if v_reservation.id is not null and v_reservation.status = 'ACTIVE' then
    update public.commercial_invoice_reservations
    set status = 'CONSUMED', consumed_at = now(), consumed_document_id = v_document.id, updated_at = now()
    where id = v_reservation.id;
  end if;

  if p_document_type in ('01', '04') then
    insert into public.accounting_document_links(company_id, document_id, status)
    values (p_company_id, v_document.id, 'PENDING');
  end if;

  if p_document_type = '07' and v_purchase_id is not null then
    if jsonb_typeof(p_source_snapshot #> '{erpPurchase,journal}') <> 'object' then
      raise exception using errcode = '22023', message = 'SUPPLIER_WITHHOLDING_V2_JOURNAL_REQUIRED';
    end if;
    perform set_config('request.jwt.claim.sub', p_created_by::text, true);
    v_journal_entry_id := public.erp_financial_v2_create_entry_internal(
      p_company_id, v_operation_id, v_device_id,
      p_source_snapshot #> '{erpPurchase,journal}',
      'PURCHASE_WITHHOLDING', v_document.id::text, 'POST_WITHHOLDING'
    );
    insert into public.erp_supplier_purchase_withholding_links(
      company_id, purchase_document_id, electronic_document_id, journal_entry_id,
      status, operation_id, created_at, created_by, updated_at, updated_by
    ) values (
      p_company_id, v_purchase_id, v_document.id, v_journal_entry_id,
      'ACTIVE', v_operation_id, clock_timestamp(), p_created_by, clock_timestamp(), p_created_by
    );
    update public.erp_supplier_purchase_documents
    set retention_status = 'DRAFT_CREATED', updated_at = clock_timestamp(),
        version = version + 1, last_operation_id = v_operation_id
    where company_id = p_company_id and purchase_document_id = v_purchase_id;
    perform public.erp_financial_v2_write_event(
      p_company_id, v_operation_id, v_device_id, 'POST_WITHHOLDING',
      'PURCHASE_WITHHOLDING', v_document.id::text,
      jsonb_build_object(
        'purchaseDocumentId', v_purchase_id::text,
        'electronicDocumentId', v_document.id::text,
        'journalEntryId', v_journal_entry_id::text
      )
    );
    v_command_result := jsonb_build_object(
      'ok', true, 'serverTime', clock_timestamp(),
      'result', jsonb_build_object(
        'purchaseDocumentId', v_purchase_id::text,
        'electronicDocumentId', v_document.id::text,
        'journalEntryId', v_journal_entry_id::text,
        'reused', false
      )
    );
    insert into public.erp_operations_commands(
      operation_id, company_id, command_type, source_record_id, request_payload,
      result, status, user_id, device_id, local_created_at, server_created_at
    ) values (
      v_operation_id, p_company_id, 'SUPPLIER_CREATE_WITHHOLDING', v_purchase_id::text,
      jsonb_build_object('purchaseDocumentId', v_purchase_id::text), v_command_result,
      'CONFIRMED', p_created_by, v_device_id, clock_timestamp(), clock_timestamp()
    );
  end if;

  insert into public.electronic_document_audit_logs(
    company_id, document_id, actor_user_id, actor_type, action,
    new_status, reason, new_values
  ) values (
    p_company_id, v_document.id, p_created_by, 'USER', 'DRAFT_CREATED',
    'BORRADOR',
    case
      when v_purchase_id is not null then 'Retencion de compra V2 creada con vinculo, asiento y secuencial atomicos'
      when v_reservation.id is not null then 'Borrador SRI creado con reserva idempotente de factura'
      else 'Borrador SRI creado con secuencial atomico'
    end,
    jsonb_build_object(
      'full_number', v_document.full_number,
      'access_key', v_document.access_key,
      'environment', v_settings.environment,
      'commercial_reservation_id', v_reservation.id,
      'purchase_document_id', v_purchase_id,
      'journal_entry_id', v_journal_entry_id,
      'operation_id', v_operation_id
    )
  );

  return to_jsonb(v_document) || jsonb_build_object(
    '_reservation_reused', false,
    '_purchase_document_id', v_purchase_id::text,
    '_journal_entry_id', v_journal_entry_id::text
  );
end;
$function$;
notify pgrst, 'reload schema';
commit;
