-- Permite que dos dispositivos converjan al mismo estado de Coordinación.
-- Un expected_version obsoleto solo se acepta cuando el patch normalizado ya
-- coincide exactamente con los campos canónicos solicitados.

create or replace function public.erp_patch_commercial_order_coordination(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_record_id text,
  p_expected_version bigint,
  p_patch jsonb,
  p_local_created_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_order public.erp_entity_records%rowtype;
  v_prior public.erp_operations_commands%rowtype;
  v_saved jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_normalized_patch jsonb:='{}'::jsonb;
  v_allowed_keys constant text[]:=array['daeNumber','awb','hawb','airlineId'];
  v_key text;
  v_value text;
  v_current_value text;
  v_awb_digits text;
  v_transport text;
  v_airline_id text;
  v_has_changes boolean:=false;
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);

  if p_operation_id is null
    or nullif(btrim(p_device_id),'') is null
    or nullif(btrim(p_record_id),'') is null
    or jsonb_typeof(coalesce(p_patch,'{}'::jsonb))<>'object'
    or coalesce(p_expected_version,0)<1 then
    raise exception using errcode='22023',message='COMMERCIAL_ORDER_COORDINATION_PATCH_INVALID';
  end if;

  if exists(
    select 1
    from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) keys(key)
    where key<>all(v_allowed_keys)
  ) then
    raise exception using errcode='22023',message='COMMERCIAL_ORDER_COORDINATION_FIELD_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':COMMERCIAL_COORDINATION:'||p_record_id,0));

  select * into v_prior
  from public.erp_operations_commands
  where operation_id=p_operation_id
    and company_id=p_company_id;

  if found then
    return v_prior.result;
  end if;

  select * into v_order
  from public.erp_entity_records record
  where record.company_id=p_company_id
    and record.entity='commercial_orders'
    and record.record_id=p_record_id
    and record.deleted_at is null
  for update;

  if not found then
    raise exception using errcode='P0002',message='COMMERCIAL_ORDER_NOT_FOUND';
  end if;

  v_transport:=upper(btrim(coalesce(v_order.payload->>'transportType','AEREO')));
  if v_transport='AIR' then v_transport:='AEREO'; end if;
  if v_transport in ('SEA','MARITIME') then v_transport:='MARITIMO'; end if;

  if p_patch?'daeNumber' then
    v_normalized_patch:=jsonb_set(
      v_normalized_patch,
      '{daeNumber}',
      to_jsonb(btrim(coalesce(p_patch->>'daeNumber',''))),
      true
    );
  end if;

  if p_patch?'hawb' then
    v_normalized_patch:=jsonb_set(
      v_normalized_patch,
      '{hawb}',
      to_jsonb(public.erp_commercial_v2_normalize_reference(v_transport,p_patch->>'hawb',false)),
      true
    );
  end if;

  if p_patch?'awb' then
    v_value:=public.erp_commercial_v2_normalize_reference(v_transport,p_patch->>'awb',true);
    v_normalized_patch:=jsonb_set(v_normalized_patch,'{awb}',to_jsonb(v_value),true);
  end if;

  if p_patch?'airlineId' then
    v_normalized_patch:=jsonb_set(
      v_normalized_patch,
      '{airlineId}',
      to_jsonb(case when v_transport='AEREO' then btrim(coalesce(p_patch->>'airlineId','')) else '' end),
      true
    );
  end if;

  if v_transport='AEREO' and nullif(v_normalized_patch->>'awb','') is not null then
    v_awb_digits:=regexp_replace(v_normalized_patch->>'awb','[^0-9]','','g');
    v_airline_id:=coalesce(
      nullif(v_normalized_patch->>'airlineId',''),
      nullif(v_order.payload->>'airlineId','')
    );

    if v_airline_id is null then
      select airline.record_id into v_airline_id
      from public.erp_entity_records airline
      where airline.company_id=p_company_id
        and airline.entity='commercial_airlines'
        and airline.deleted_at is null
        and lpad(coalesce(airline.payload->>'awbPrefix',''),3,'0')=left(v_awb_digits,3)
      order by airline.record_id
      limit 1;

      if v_airline_id is not null then
        v_normalized_patch:=jsonb_set(v_normalized_patch,'{airlineId}',to_jsonb(v_airline_id),true);
      end if;
    end if;

    if v_airline_id is null then
      raise exception using errcode='23514',message='COMMERCIAL_ORDER_AIRLINE_REQUIRED_FOR_MAWB';
    end if;

    if not exists(
      select 1
      from public.erp_entity_records airline
      where airline.company_id=p_company_id
        and airline.entity='commercial_airlines'
        and airline.record_id=v_airline_id
        and airline.deleted_at is null
        and lpad(coalesce(airline.payload->>'awbPrefix',''),3,'0')=left(v_awb_digits,3)
    ) then
      raise exception using errcode='23514',message='COMMERCIAL_ORDER_MAWB_PREFIX_AIRLINE_MISMATCH';
    end if;
  end if;

  for v_key,v_value in
    select key,value
    from jsonb_each_text(v_normalized_patch)
  loop
    if v_key in ('awb','hawb') then
      v_current_value:=public.erp_commercial_v2_normalize_reference(
        v_transport,
        v_order.payload->>v_key,
        v_key='awb'
      );
    elsif v_key='airlineId' and v_transport<>'AEREO' then
      v_current_value:='';
    else
      v_current_value:=btrim(coalesce(v_order.payload->>v_key,''));
    end if;

    if v_current_value is distinct from v_value then
      v_has_changes:=true;
      exit;
    end if;
  end loop;

  if not v_has_changes then
    return jsonb_build_object(
      'ok',true,
      'noChange',true,
      'unchanged',true,
      'reused',true,
      'operationId',p_operation_id,
      'serverTime',v_order.updated_at,
      'serverRecord',to_jsonb(v_order),
      'result',jsonb_build_object('status','COORDINATION_UNCHANGED')
    );
  end if;

  if v_order.version<>p_expected_version then
    raise exception using
      errcode='P0001',
      message=format(
        'COMMERCIAL_ORDER_VERSION_CONFLICT:SERVER_%s:CLIENT_%s',
        v_order.version,
        p_expected_version
      );
  end if;

  v_payload:=v_order.payload||v_normalized_patch||jsonb_build_object(
    'status',v_order.payload->'status',
    'warehouseStatus',v_order.payload->'warehouseStatus',
    'fulfillmentStatus',v_order.payload->'fulfillmentStatus',
    'coordinationUpdatedAt',clock_timestamp()
  );

  v_saved:=public.erp_operations_v2_write_record(
    p_company_id,
    p_operation_id,
    p_device_id,
    'commercial_orders',
    p_record_id,
    v_payload,
    v_order.version
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'noChange',false,
    'operationId',p_operation_id,
    'serverTime',clock_timestamp(),
    'serverRecord',v_saved,
    'result',jsonb_build_object('status','COORDINATION_UPDATED')
  );

  insert into public.erp_operations_commands(
    operation_id,
    company_id,
    command_type,
    source_record_id,
    request_payload,
    result,
    status,
    user_id,
    device_id,
    local_created_at
  ) values (
    p_operation_id,
    p_company_id,
    'UPDATE_ORDER_COORDINATION',
    p_record_id,
    v_normalized_patch,
    v_result,
    'CONFIRMED',
    auth.uid(),
    p_device_id,
    coalesce(p_local_created_at,now())
  );

  return v_result;
end
$$;

revoke all on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) to authenticated,service_role;
