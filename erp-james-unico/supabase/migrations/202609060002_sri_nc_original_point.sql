-- Focal SRI NC original-point contract. No settings, points, counters or documents are changed.
begin;

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

  if p_document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = p_company_id and id = p_parent_document_id
      and environment = v_settings.environment
      and document_type = '01' and status = 'AUTORIZADO' for update;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
    if p_emission_point_id is distinct from v_original.emission_point_id then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
    end if;
    p_emission_point_id := v_original.emission_point_id;
  elsif p_parent_document_id is not null then
    raise exception using errcode = '23514', message = 'SRI_PARENT_ONLY_ALLOWED_FOR_CREDIT_NOTE';
  end if;

  -- A credit note derives its point from the locked canonical original invoice.
  -- Reject stale/client overrides before any sequence row is created or incremented.
  select * into v_point from public.emission_points
  where company_id = p_company_id
    and id = case when p_document_type = '04' then v_original.emission_point_id else p_emission_point_id end
    and environment = v_settings.environment and active for update;
  if not found then
    raise exception using errcode = '23503', message = 'SRI_ACTIVE_EMISSION_POINT_REQUIRED';
  end if;
  if p_document_type = '04' and (
    v_point.establishment_code is distinct from v_original.establishment_code
    or v_point.emission_point_code is distinct from v_original.emission_point_code
  ) then
    raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
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

CREATE OR REPLACE FUNCTION public.sri_validate_document_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.sri_settings%rowtype;
  v_point public.emission_points%rowtype;
  v_original public.electronic_documents%rowtype;
  v_expected_key text;
  v_transition_allowed boolean := false;
  v_recovery_query boolean := coalesce(current_setting('app.sri_recovery_query', true), '') = 'on';
  v_registered_annulment boolean := coalesce(current_setting('app.sri_registered_annulment', true), '') = 'on';
begin
  select * into v_settings from public.sri_settings where company_id = new.company_id;
  if not found
     or v_settings.environment not in ('TEST', 'PRODUCTION')
     or new.environment <> v_settings.environment then
    raise exception using errcode = '23514', message = 'SRI_CONFIGURATION_ENVIRONMENT_MISMATCH';
  end if;
  if v_settings.environment = 'TEST' and v_settings.production_enabled then
    raise exception using errcode = '23514', message = 'SRI_TEST_CANNOT_ENABLE_PRODUCTION';
  end if;

  select * into v_point
  from public.emission_points
  where company_id = new.company_id and id = new.emission_point_id;
  if not found
     or v_point.environment <> new.environment
     or v_point.establishment_code <> new.establishment_code
     or v_point.emission_point_code <> new.emission_point_code then
    raise exception using errcode = '23514', message = 'SRI_EMISSION_POINT_MISMATCH';
  end if;

  v_expected_key := public.sri_build_access_key(
    new.issue_date,
    new.document_type,
    v_settings.ruc,
    new.environment,
    new.establishment_code,
    new.emission_point_code,
    new.sequential,
    new.numeric_code
  );
  if new.access_key <> v_expected_key
     or new.verification_digit <> right(v_expected_key, 1)::smallint then
    raise exception using errcode = '23514', message = 'SRI_ACCESS_KEY_INTEGRITY_ERROR';
  end if;
  if new.issuer_snapshot ->> 'ruc' is distinct from v_settings.ruc then
    raise exception using errcode = '23514', message = 'SRI_ISSUER_SNAPSHOT_RUC_MISMATCH';
  end if;

  -- Enforce original-point identity on every new NC, including direct inserts.
  -- Existing documents and later status updates retain their established history.
  if tg_op = 'INSERT' and new.document_type = '04' then
    select * into v_original from public.electronic_documents
    where company_id = new.company_id and id = new.parent_document_id
      and environment = new.environment and document_type = '01'
      and status = 'AUTORIZADO' for share;
    if not found then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_REQUIRES_AUTHORIZED_INVOICE';
    end if;
    if new.emission_point_id is distinct from v_original.emission_point_id
      or new.establishment_code is distinct from v_original.establishment_code
      or new.emission_point_code is distinct from v_original.emission_point_code then
      raise exception using errcode = '23514', message = 'SRI_CREDIT_NOTE_ORIGINAL_POINT_REQUIRED';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.company_id <> old.company_id
       or new.emission_point_id <> old.emission_point_id
       or new.environment <> old.environment
       or new.document_type <> old.document_type
       or new.sequential <> old.sequential
       or new.numeric_code <> old.numeric_code
       or new.establishment_code <> old.establishment_code
       or new.emission_point_code <> old.emission_point_code
       or new.parent_document_id is distinct from old.parent_document_id
       or new.source_order_id is distinct from old.source_order_id
       or new.source_packing_id is distinct from old.source_packing_id
       or new.customer_id is distinct from old.customer_id
       or new.issuer_snapshot is distinct from old.issuer_snapshot
       or new.buyer_snapshot is distinct from old.buyer_snapshot
       or new.source_snapshot is distinct from old.source_snapshot then
      raise exception using errcode = '23514', message = 'SRI_DOCUMENT_IDENTITY_IS_IMMUTABLE';
    end if;

    if (
      new.issue_date <> old.issue_date
      or new.access_key <> old.access_key
      or new.verification_digit <> old.verification_digit
    ) and not (old.status = 'BORRADOR' and new.status = 'BORRADOR') then
      raise exception using errcode = '23514', message = 'SRI_ISSUE_DATE_IS_LOCKED';
    end if;

    if new.status <> old.status then
      v_transition_allowed := case old.status
        when 'BORRADOR' then new.status in ('VALIDADO', 'ANULADO')
        when 'VALIDADO' then new.status in ('XML_GENERADO', 'ANULADO')
        when 'XML_GENERADO' then new.status in ('FIRMADO', 'ANULADO')
        when 'FIRMADO' then new.status in ('ENVIADO_SRI', 'ANULADO')
        when 'ENVIADO_SRI' then new.status in (
          'RECIBIDO_SRI', 'AUTORIZADO', 'NO_AUTORIZADO', 'DEVUELTO',
          'PENDIENTE_REINTENTO', 'ERROR_ENVIO'
        )
        when 'RECIBIDO_SRI' then new.status in (
          'AUTORIZADO', 'NO_AUTORIZADO', 'PENDIENTE_REINTENTO', 'ERROR_ENVIO'
        )
        when 'PENDIENTE_REINTENTO' then new.status in ('ENVIADO_SRI', 'ERROR_ENVIO')
        when 'ERROR_ENVIO' then new.status in ('PENDIENTE_REINTENTO', 'ANULADO')
        when 'DEVUELTO' then new.status in ('ANULADO')
          or (v_recovery_query and new.status in ('AUTORIZADO', 'NO_AUTORIZADO'))
        when 'NO_AUTORIZADO' then new.status in ('ANULADO')
          or (v_recovery_query and new.status in ('AUTORIZADO'))
        when 'AUTORIZADO' then v_registered_annulment and new.status = 'ANULADO'
        else false
      end;
      if not v_transition_allowed then
        raise exception using
          errcode = '23514',
          message = format('SRI_STATUS_TRANSITION_NOT_ALLOWED:%s->%s', old.status, new.status);
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

notify pgrst, 'reload schema';
commit;
