begin;

-- Patch separado: las entidades operativas viven en erp_entity_records y su
-- identidad canónica es (company_id, entity, record_id). No se agregan
-- columnas físicas ni FKs que invaliden etiquetas legacy sin lineage.
create or replace function public.erp_zebra_v2_create_labels(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_labels jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_label jsonb;
  v_component jsonb;
  v_bunch_id uuid;
  v_label_id text;
  v_label_code text;
  v_counter_scope integer := 0;
  v_sequence bigint;
  v_now timestamptz := clock_timestamp();
  v_stems numeric;
  v_component_stems numeric;
  v_components jsonb;
  v_variety text;
  v_length numeric;
  v_quality text;
  v_category text;
  v_label_type text;
  v_bunch_payload jsonb;
  v_label_payload jsonb;
  v_saved_bunch jsonb;
  v_saved_label jsonb;
  v_records jsonb := '[]'::jsonb;
  v_labels jsonb := '[]'::jsonb;
  v_effective_labels jsonb := '[]'::jsonb;
  v_result jsonb;
  v_source_record_id text;
  v_source_flow text;
  v_assignment_id text;
  v_reception_id text;
  v_reception_item_id text;
  v_classification_result_id text;
  v_assignment_payload jsonb;
  v_reception_payload jsonb;
  v_classification_result_payload jsonb;
  v_derived_reception_id text;
  v_derived_reception_item_id text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'ZEBRA_V2_COMPANY_ACCESS_DENIED';
  end if;
  if p_operation_id is null
     or nullif(btrim(p_device_id), '') is null
     or jsonb_typeof(coalesce(p_labels, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(p_labels) < 1
     or jsonb_array_length(p_labels) > 99 then
    raise exception using errcode = '22023', message = 'ZEBRA_V2_LABEL_REQUEST_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing
  from public.erp_operations_commands command
  where command.operation_id = p_operation_id
    and command.company_id = p_company_id;
  if found then return v_existing.result; end if;

  insert into public.erp_zebra_sequence_counters(company_id, calendar_year, last_value)
  values (p_company_id, v_counter_scope, 0)
  on conflict (company_id, calendar_year) do nothing;
  select counter.last_value into v_sequence
  from public.erp_zebra_sequence_counters counter
  where counter.company_id = p_company_id and counter.calendar_year = v_counter_scope
  for update;

  for v_label in select value from jsonb_array_elements(p_labels)
  loop
    v_source_flow := upper(btrim(coalesce(v_label ->> 'sourceFlow', '')));
    v_assignment_id := nullif(btrim(coalesce(v_label ->> 'classificationAssignmentId', '')), '');
    v_reception_id := nullif(btrim(coalesce(v_label ->> 'receptionId', '')), '');
    v_reception_item_id := nullif(btrim(coalesce(v_label ->> 'receptionItemId', '')), '');
    v_classification_result_id := nullif(btrim(coalesce(v_label ->> 'classificationResultId', '')), '');
    v_assignment_payload := null;
    v_reception_payload := null;
    v_classification_result_payload := null;
    v_derived_reception_id := null;
    v_derived_reception_item_id := null;

    if v_source_flow = 'CLASSIFICATION_V2' and v_assignment_id is null then
      raise exception using errcode = '23502', message = 'CANONICAL_LINEAGE_REQUIRED';
    end if;

    if v_assignment_id is not null then
      select assignment.payload into v_assignment_payload
      from public.erp_entity_records assignment
      where assignment.company_id = p_company_id
        and assignment.entity = 'operations_classifier_assignments'
        and assignment.record_id = v_assignment_id
        and assignment.deleted_at is null;
      if not found then
        raise exception using errcode = '23503', message = 'ZEBRA_V2_CLASSIFICATION_ASSIGNMENT_NOT_FOUND';
      end if;

      v_derived_reception_id := nullif(btrim(coalesce(v_assignment_payload ->> 'receptionId', '')), '');
      v_derived_reception_item_id := nullif(btrim(coalesce(v_assignment_payload ->> 'receptionItemId', '')), '');
      if v_derived_reception_id is null or v_derived_reception_item_id is null then
        raise exception using errcode = '23503', message = 'ZEBRA_V2_ASSIGNMENT_LINEAGE_INCOMPLETE';
      end if;
      if (v_reception_id is not null and v_reception_id <> v_derived_reception_id)
         or (v_reception_item_id is not null and v_reception_item_id <> v_derived_reception_item_id) then
        raise exception using errcode = '23514', message = 'CANONICAL_LINEAGE_MISMATCH';
      end if;

      select reception.payload into v_reception_payload
      from public.erp_entity_records reception
      where reception.company_id = p_company_id
        and reception.entity = 'operations_receptions'
        and reception.record_id = v_derived_reception_id
        and reception.deleted_at is null;
      if not found or not exists (
        select 1
        from jsonb_array_elements(coalesce(v_reception_payload -> 'items', '[]'::jsonb)) reception_item
        where reception_item ->> 'id' = v_derived_reception_item_id
      ) then
        raise exception using errcode = '23503', message = 'ZEBRA_V2_RECEPTION_ITEM_NOT_FOUND';
      end if;

      v_reception_id := v_derived_reception_id;
      v_reception_item_id := v_derived_reception_item_id;
    end if;

    if v_classification_result_id is not null then
      select classification_result.payload into v_classification_result_payload
      from public.erp_entity_records classification_result
      where classification_result.company_id = p_company_id
        and classification_result.entity = 'operations_classification_results'
        and classification_result.record_id = v_classification_result_id
        and classification_result.deleted_at is null;
      if not found then
        raise exception using errcode = '23503', message = 'ZEBRA_V2_CLASSIFICATION_RESULT_NOT_FOUND';
      end if;
      if v_assignment_id is not null
         and coalesce(v_classification_result_payload ->> 'assignmentId', '') <> v_assignment_id then
        raise exception using errcode = '23514', message = 'CANONICAL_LINEAGE_MISMATCH';
      end if;
    end if;

    if coalesce(v_label ->> 'bunchId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'ZEBRA_V2_BUNCH_UUID_INVALID';
    end if;
    v_bunch_id := (v_label ->> 'bunchId')::uuid;
    v_variety := upper(btrim(coalesce(v_label ->> 'variety', '')));
    v_length := coalesce(nullif(v_label ->> 'length', '')::numeric, 0);
    v_quality := upper(btrim(coalesce(v_label ->> 'quality', v_label ->> 'category', 'EXPORTACION')));
    v_category := upper(btrim(coalesce(v_label ->> 'category', 'EXPORTACION')));
    v_stems := coalesce(nullif(v_label ->> 'stemsPerBunch', '')::numeric, 0);
    v_components := coalesce(v_label -> 'components', '[]'::jsonb);
    if v_variety = '' or v_length <= 0 or v_stems <= 0
       or nullif(btrim(coalesce(v_label ->> 'color', '')), '') is null
       or jsonb_typeof(v_components) <> 'array'
       or jsonb_array_length(v_components) < 1
       or jsonb_array_length(v_components) > 4 then
      raise exception using errcode = '22023', message = 'ZEBRA_V2_LABEL_INCOMPLETE';
    end if;
    v_component_stems := 0;
    for v_component in select value from jsonb_array_elements(v_components)
    loop
      if nullif(btrim(coalesce(v_component ->> 'provider', '')), '') is null
         or nullif(btrim(coalesce(v_component ->> 'block', '')), '') is null
         or coalesce(nullif(v_component ->> 'stems', '')::numeric, 0) <= 0 then
        raise exception using errcode = '22023', message = 'ZEBRA_V2_COMPONENT_INVALID';
      end if;
      v_component_stems := v_component_stems + nullif(v_component ->> 'stems', '')::numeric;
    end loop;
    if v_component_stems <> v_stems then
      raise exception using errcode = '23514', message = 'ZEBRA_V2_COMPONENT_TOTAL_MISMATCH';
    end if;
    if exists (
      select 1 from public.erp_zebra_label_registry registry
      where registry.company_id = p_company_id and registry.bunch_id = v_bunch_id
    ) then
      raise exception using errcode = '23505', message = 'ZEBRA_V2_BUNCH_ALREADY_HAS_LABEL';
    end if;

    v_label := v_label || jsonb_build_object(
      'sourceFlow', v_source_flow,
      'classificationAssignmentId', coalesce(v_assignment_id, ''),
      'receptionId', coalesce(v_reception_id, ''),
      'receptionItemId', coalesce(v_reception_item_id, ''),
      'classificationResultId', coalesce(v_classification_result_id, '')
    );
    v_effective_labels := v_effective_labels || jsonb_build_array(v_label);

    v_sequence := v_sequence + 1;
    if v_sequence > 9999999999 then
      raise exception using errcode = '22003', message = 'ZEBRA_V2_SEQUENCE_EXHAUSTED';
    end if;
    v_label_code := lpad(v_sequence::text, 10, '0');
    v_label_id := 'LBL-ZB-' || replace(gen_random_uuid()::text, '-', '');
    v_label_type := case when jsonb_array_length(v_components) > 1 then 'MIXTA' else 'NORMAL' end;
    if v_source_record_id is null then v_source_record_id := v_label_id; end if;

    v_bunch_payload := jsonb_build_object(
      'id', v_bunch_id::text,
      'bunchId', v_bunch_id::text,
      'labelId', v_label_id,
      'labelCode', v_label_code,
      'state', 'LABELED',
      'availabilityState', 'NOT_RECEIVED',
      'available', false,
      'variety', v_variety,
      'length', v_length,
      'quality', v_quality,
      'category', v_category,
      'stemsPerBunch', v_stems,
      'color', upper(btrim(v_label ->> 'color')),
      'buncher', coalesce(v_label ->> 'buncher', ''),
      'buncherEmployeeId', coalesce(v_label ->> 'buncherEmployeeId', ''),
      'supplier', coalesce(v_label ->> 'supplier', ''),
      'block', coalesce(v_label ->> 'block', ''),
      'components', v_components,
      'sourceFlow', v_source_flow,
      'classificationAssignmentId', coalesce(v_assignment_id, ''),
      'receptionId', coalesce(v_reception_id, ''),
      'receptionItemId', coalesce(v_reception_item_id, ''),
      'classificationResultId', coalesce(v_classification_result_id, ''),
      'createdAt', v_now,
      'labeledAt', v_now,
      'syncFlow', 'ZEBRA_V2'
    );
    v_label_payload := v_bunch_payload || jsonb_build_object(
      'id', v_label_id,
      'code', v_label_code,
      'bunchId', v_bunch_id::text,
      'state', 'IMPRESA',
      'labelType', v_label_type,
      'quantity', 1,
      'date', to_char(v_now at time zone 'America/Guayaquil', 'YYYY-MM-DD'),
      'createdAt', v_now,
      'printedAt', v_now,
      'scannedAt', '',
      'inventoryId', '',
      'printCount', 1,
      'outputType', upper(coalesce(v_label ->> 'outputType', 'ZEBRA')),
      'sourceType', 'DIGITACION_ETIQUETA_ZEBRA',
      'storedComposition', true,
      'destinationMode', coalesce(v_label ->> 'destinationMode', 'BLESS_EXPORT'),
      'localDestinationCustomerId', coalesce(v_label ->> 'localDestinationCustomerId', ''),
      'localDestinationName', coalesce(v_label ->> 'localDestinationName', ''),
      'observation', 'Etiqueta confirmada en Supabase. No crea inventario hasta el primer escaneo válido.'
    );

    v_saved_bunch := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id,
      'operations_bunches', v_bunch_id::text, v_bunch_payload, 0
    );
    v_saved_label := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id,
      'operations_label_batches', v_label_id, v_label_payload, 0
    );
    insert into public.erp_zebra_label_registry(
      company_id, bunch_id, label_code, label_record_id, status, created_by, created_at, updated_at
    ) values (
      p_company_id, v_bunch_id, v_label_code, v_label_id, 'LABELED', auth.uid(), v_now, v_now
    );
    v_records := v_records || jsonb_build_array(v_saved_bunch, v_saved_label);
    v_labels := v_labels || jsonb_build_array(jsonb_build_object(
      'bunchId', v_bunch_id, 'labelId', v_label_id, 'labelCode', v_label_code
    ));
  end loop;

  update public.erp_zebra_sequence_counters
  set last_value = v_sequence, updated_at = v_now
  where company_id = p_company_id and calendar_year = v_counter_scope;

  v_result := jsonb_build_object(
    'ok', true,
    'command', 'CREATE_ZEBRA_LABELS',
    'operationId', p_operation_id,
    'serverTime', v_now,
    'records', v_records,
    'result', jsonb_build_object('labels', v_labels, 'count', jsonb_array_length(v_labels))
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'CREATE_ZEBRA_LABELS', v_source_record_id,
    jsonb_build_object('labels', v_effective_labels), v_result, 'CONFIRMED', auth.uid(), p_device_id,
    coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

create or replace function public.erp_zebra_v2_health(p_company_id uuid)
returns jsonb
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
    raise exception using errcode = '42501', message = 'ZEBRA_V2_COMPANY_ACCESS_DENIED';
  end if;
  return jsonb_build_object(
    'ok', true,
    'component', 'ZEBRA_V2',
    'migration', '202608150005',
    'lineagePatch', '202608240001',
    'assignmentLineage', true,
    'companyId', p_company_id,
    'sequenceTable', to_regclass('public.erp_zebra_sequence_counters') is not null,
    'registryTable', to_regclass('public.erp_zebra_label_registry') is not null,
    'operationsDependency', to_regprocedure('public.erp_operations_v2_write_record(uuid,uuid,text,text,text,jsonb,bigint)') is not null,
    'createRpc', to_regprocedure('public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reprintRpc', to_regprocedure('public.erp_zebra_v2_reprint_label(uuid,uuid,text,text,text,timestamp with time zone)') is not null,
    'receiveRpc', to_regprocedure('public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamp with time zone)') is not null,
    'availabilityRpc', to_regprocedure('public.erp_zebra_v2_availability(uuid)') is not null,
    'serverTime', clock_timestamp()
  );
end;
$$;

revoke all on function public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz) from public, anon;
revoke all on function public.erp_zebra_v2_health(uuid) from public, anon;
grant execute on function public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz) to authenticated, service_role;
grant execute on function public.erp_zebra_v2_health(uuid) to authenticated, service_role;

commit;
