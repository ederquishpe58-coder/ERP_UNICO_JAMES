begin;

-- Vínculo canónico y opcional entre Employee V2 y el usuario autenticado.
alter table public.erp_payroll_employees
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists erp_payroll_employees_company_user_uidx
  on public.erp_payroll_employees(company_id,user_id)
  where user_id is not null;

create or replace function public.erp_commercial_v2_normalize_reference(
  p_transport_type text,
  p_value text,
  p_mother boolean default false
) returns text
language plpgsql immutable
set search_path=public,pg_temp
as $$
declare
  v_transport text:=upper(btrim(coalesce(p_transport_type,'')));
  v_value text:=upper(regexp_replace(btrim(coalesce(p_value,'')),'[[:space:]]+',' ','g'));
  v_digits text;
begin
  if v_transport in ('AEREO','AIR') and p_mother then
    v_digits:=regexp_replace(v_value,'[^0-9]','','g');
    if v_digits='' then return ''; end if;
    if length(v_digits)<>11 then
      raise exception using errcode='22023',message='COMMERCIAL_AIR_MAWB_FORMAT_INVALID';
    end if;
    return left(v_digits,3)||'-'||substr(v_digits,4);
  end if;
  if v_value<>'' and v_value !~ '^[A-Z0-9 ./-]+$' then
    raise exception using errcode='22023',message='COMMERCIAL_GUIDE_CHARACTERS_INVALID';
  end if;
  return v_value;
end $$;

revoke all on function public.erp_commercial_v2_normalize_reference(text,text,boolean) from public,anon,authenticated;
grant execute on function public.erp_commercial_v2_normalize_reference(text,text,boolean) to service_role;

create or replace function public.erp_commercial_v2_list_sales_representatives(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId',employee.employee_id,
    'sellerId',employee.employee_id,
    'userId',employee.user_id,
    'fullName',employee.full_name,
    'employeeCode',employee.employee_code,
    'area',employee.area,
    'position',employee.position_name,
    'status',employee.status
  ) order by employee.full_name),'[]'::jsonb)
  into v_items
  from public.erp_payroll_employees employee
  where employee.company_id=p_company_id
    and employee.status='ACTIVE'
    and upper(btrim(employee.area)) in ('VENTAS','COMERCIAL');
  return jsonb_build_object('ok',true,'companyId',p_company_id,'items',v_items,'serverTime',clock_timestamp());
end $$;

revoke all on function public.erp_commercial_v2_list_sales_representatives(uuid) from public,anon;
grant execute on function public.erp_commercial_v2_list_sales_representatives(uuid) to authenticated,service_role;

create or replace function public.erp_payroll_core_v2_upsert_employee(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_expected_version bigint default null,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_command public.erp_operations_commands%rowtype;
  v_row public.erp_payroll_employees%rowtype;
  v_id uuid:=coalesce(nullif(p_payload->>'employeeId','')::uuid,gen_random_uuid());
  v_code text; v_result jsonb; v_record jsonb; v_exists boolean:=false; v_user_id uuid;
begin
  perform public.erp_payroll_core_v2_assert_permission(p_company_id,'MANAGE');
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='PAYROLL_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_command from public.erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
  if found then return v_command.result; end if;
  if nullif(btrim(p_payload->>'identification'),'') is null or nullif(btrim(p_payload->>'fullName'),'') is null then
    raise exception using errcode='22023',message='PAYROLL_V2_EMPLOYEE_REQUIRED_FIELDS';
  end if;
  select * into v_row from public.erp_payroll_employees where company_id=p_company_id and employee_id=v_id for update;
  v_exists:=found;
  if not v_exists then
    select * into v_row from public.erp_payroll_employees where company_id=p_company_id and identification=btrim(p_payload->>'identification') for update;
    v_exists:=found;
    if v_exists then v_id:=v_row.employee_id; end if;
  end if;
  if v_exists and p_expected_version is not null and v_row.version<>p_expected_version then
    raise exception using errcode='40001',message='PAYROLL_V2_EMPLOYEE_VERSION_CONFLICT';
  end if;
  v_user_id:=case when p_payload?'userId' then nullif(btrim(p_payload->>'userId'),'')::uuid else v_row.user_id end;
  if v_user_id is not null and not exists(
    select 1 from public.user_company_memberships membership
    where membership.company_id=p_company_id and membership.user_id=v_user_id and membership.membership_status='ACTIVE'
  ) then raise exception using errcode='23514',message='PAYROLL_V2_EMPLOYEE_USER_NOT_ACTIVE_IN_COMPANY'; end if;
  v_code:=case when v_exists then v_row.employee_code else public.erp_payroll_core_v2_next_code(p_company_id,'EMPLOYEE',current_date) end;
  insert into public.erp_payroll_employees(company_id,employee_id,user_id,identification,employee_code,full_name,position_name,area,hire_date,status,
    calculation_mode,monthly_salary,hourly_rate,performance_rate,performance_unit,expense_account_code,created_by,updated_by,last_operation_id)
  values(p_company_id,v_id,v_user_id,btrim(p_payload->>'identification'),v_code,btrim(p_payload->>'fullName'),btrim(coalesce(p_payload->>'position','')),
    btrim(coalesce(p_payload->>'area','')),nullif(p_payload->>'hireDate','')::date,upper(coalesce(nullif(p_payload->>'status',''),'ACTIVE')),
    upper(coalesce(nullif(p_payload->>'calculationMode',''),'FIXED')),coalesce(nullif(p_payload->>'monthlySalary','')::numeric,0),
    coalesce(nullif(p_payload->>'hourlyRate','')::numeric,0),coalesce(nullif(p_payload->>'performanceRate','')::numeric,0),
    upper(coalesce(nullif(p_payload->>'performanceUnit',''),'UNITS')),btrim(coalesce(p_payload->>'expenseAccountCode','')),auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,employee_id) do update set user_id=excluded.user_id,identification=excluded.identification,full_name=excluded.full_name,
    position_name=excluded.position_name,area=excluded.area,hire_date=excluded.hire_date,status=excluded.status,
    calculation_mode=excluded.calculation_mode,monthly_salary=excluded.monthly_salary,hourly_rate=excluded.hourly_rate,
    performance_rate=excluded.performance_rate,performance_unit=excluded.performance_unit,expense_account_code=excluded.expense_account_code,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=public.erp_payroll_employees.version+1,last_operation_id=p_operation_id
  returning * into v_row;
  v_record:=public.erp_payroll_core_v2_publish(p_company_id,p_operation_id,p_device_id,'payroll_v2_employees',v_id::text,
    jsonb_build_object('id',v_id,'employeeId',v_id,'userId',v_row.user_id,'employeeCode',v_row.employee_code,'identification',v_row.identification,
      'fullName',v_row.full_name,'position',v_row.position_name,'area',v_row.area,'hireDate',v_row.hire_date,'status',v_row.status,
      'calculationMode',v_row.calculation_mode,'monthlySalary',v_row.monthly_salary,'hourlyRate',v_row.hourly_rate,
      'performanceRate',v_row.performance_rate,'performanceUnit',v_row.performance_unit,'expenseAccountCode',v_row.expense_account_code,
      'version',v_row.version,'updatedAtServer',v_row.updated_at,'syncFlow','PAYROLL_CORE_V2'));
  perform public.erp_payroll_core_v2_write_event(p_company_id,p_operation_id,'EMPLOYEE_UPSERTED','EMPLOYEE',v_id,jsonb_build_object('version',v_row.version,'userId',v_row.user_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',jsonb_build_array(v_record),'result',jsonb_build_object('employeeId',v_id,'employeeCode',v_row.employee_code));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'PAYROLL_V2_UPSERT_EMPLOYEE',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

revoke all on function public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamptz) from public,anon;
grant execute on function public.erp_payroll_core_v2_upsert_employee(uuid,uuid,text,jsonb,bigint,timestamptz) to authenticated,service_role;

-- El vendedor se resuelve una sola vez al crear y luego queda inmutable.
create or replace function public.erp_save_commercial_order(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_record_id text,p_order_year integer,
  p_establishment_code text,p_emission_point_code text,p_payload jsonb,p_base_payload jsonb default '{}'::jsonb,
  p_field_changes jsonb default '[]'::jsonb,p_base_version bigint default 0,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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

  v_reservation:=public.erp_reserve_commercial_order_identifiers(p_company_id,p_record_id,p_order_year,p_establishment_code,p_emission_point_code,'01');
  v_payload:=v_payload||jsonb_build_object(
    'id',p_record_id,'number',v_reservation->>'orderNumber','numberPending',false,'unsavedDraft',false,
    'sriInvoiceNumber',v_reservation->>'fullNumber','sriSequential',v_reservation->>'invoiceSequential',
    'packingListNumber',v_reservation->>'invoiceSequential','invoicePackingNumber',v_reservation->>'invoiceSequential',
    'clientInvoiceNumber',v_reservation->>'invoiceSequential','invoiceSequence',v_reservation->>'invoiceSequential',
    'establishmentCode',v_reservation->>'establishmentCode','emissionPointCode',v_reservation->>'emissionPointCode',
    'sriSequenceStatus','RESERVADO','sriSequenceSource','SUPABASE_TRANSACCIONAL',
    'sriSequenceReservationId',v_reservation->>'invoiceReservationId','sriSequenceAllocatedAt',v_reservation->>'reservedAt');
  for v_key,v_value in select key,value from jsonb_each(jsonb_build_object(
    'id',to_jsonb(p_record_id),'number',v_reservation->'orderNumber','numberPending','false'::jsonb,'unsavedDraft','false'::jsonb,
    'sriInvoiceNumber',v_reservation->'fullNumber','sriSequential',v_reservation->'invoiceSequential',
    'packingListNumber',v_reservation->'invoiceSequential','invoicePackingNumber',v_reservation->'invoiceSequential',
    'clientInvoiceNumber',v_reservation->'invoiceSequential','invoiceSequence',v_reservation->'invoiceSequential',
    'establishmentCode',v_reservation->'establishmentCode','emissionPointCode',v_reservation->'emissionPointCode',
    'sriSequenceStatus',to_jsonb('RESERVADO'::text),'sriSequenceSource',to_jsonb('SUPABASE_TRANSACCIONAL'::text),
    'sriSequenceReservationId',v_reservation->'invoiceReservationId','sriSequenceAllocatedAt',v_reservation->'reservedAt')) loop
    v_changes:=v_changes||jsonb_build_array(jsonb_build_object('path',jsonb_build_array(v_key),'base_exists',coalesce(p_base_payload,'{}'::jsonb)?v_key,
      'base',coalesce(p_base_payload,'{}'::jsonb)->v_key,'value_exists',true,'value',v_value));
  end loop;
  select * into v_sync from public.erp_apply_offline_operation(p_operation_id,p_company_id,p_device_id,'commercial_orders',
    case when p_base_version>0 then 'UPDATE' else 'INSERT' end,p_record_id,v_payload,coalesce(p_base_payload,'{}'::jsonb),v_changes,
    greatest(coalesce(p_base_version,0),0),coalesce(p_local_created_at,now()));
  if v_sync.operation_id is null or v_sync.status<>'SYNCED' or v_sync.server_record is null then
    raise exception using errcode='40001',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';
  end if;
  return jsonb_build_object('ok',true,'reservation',v_reservation,'operationId',v_sync.operation_id,'status',v_sync.status,
    'resultVersion',v_sync.result_version,'serverTime',v_sync.server_time,'serverRecord',v_sync.server_record,
    'discardedFields',coalesce(v_sync.discarded_fields,'[]'::jsonb),'mergeSummary',coalesce(v_sync.merge_summary,'{}'::jsonb));
end $$;

revoke all on function public.erp_save_commercial_order(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) from public,anon;
grant execute on function public.erp_save_commercial_order(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) to authenticated,service_role;

create or replace function public.erp_patch_commercial_order_coordination(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_record_id text,p_expected_version bigint,p_patch jsonb,
  p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_order public.erp_entity_records%rowtype; v_prior public.erp_operations_commands%rowtype;
  v_saved jsonb; v_payload jsonb; v_result jsonb; v_normalized_patch jsonb:='{}'::jsonb;
  v_allowed_keys constant text[]:=array['daeNumber','awb','hawb','airlineId'];
  v_key text; v_value text; v_current_value text; v_awb_digits text; v_transport text; v_airline_id text;
  v_has_changes boolean:=false;
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null or nullif(btrim(p_record_id),'') is null
    or jsonb_typeof(coalesce(p_patch,'{}'::jsonb))<>'object' or coalesce(p_expected_version,0)<1 then
    raise exception using errcode='22023',message='COMMERCIAL_ORDER_COORDINATION_PATCH_INVALID';
  end if;
  if exists(select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) keys(key) where key<>all(v_allowed_keys)) then
    raise exception using errcode='22023',message='COMMERCIAL_ORDER_COORDINATION_FIELD_NOT_ALLOWED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':COMMERCIAL_COORDINATION:'||p_record_id,0));
  select * into v_prior from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
  if found then return v_prior.result; end if;
  select * into v_order from public.erp_entity_records record where record.company_id=p_company_id
    and record.entity='commercial_orders' and record.record_id=p_record_id and record.deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='COMMERCIAL_ORDER_NOT_FOUND'; end if;
  if v_order.version<>p_expected_version then raise exception using errcode='P0001',
    message=format('COMMERCIAL_ORDER_VERSION_CONFLICT:SERVER_%s:CLIENT_%s',v_order.version,p_expected_version); end if;
  v_transport:=upper(btrim(coalesce(v_order.payload->>'transportType','AEREO')));
  if v_transport='AIR' then v_transport:='AEREO'; end if;
  if v_transport in ('SEA','MARITIME') then v_transport:='MARITIMO'; end if;
  if p_patch?'daeNumber' then v_normalized_patch:=jsonb_set(v_normalized_patch,'{daeNumber}',to_jsonb(btrim(coalesce(p_patch->>'daeNumber',''))),true); end if;
  if p_patch?'hawb' then v_normalized_patch:=jsonb_set(v_normalized_patch,'{hawb}',to_jsonb(public.erp_commercial_v2_normalize_reference(v_transport,p_patch->>'hawb',false)),true); end if;
  if p_patch?'awb' then
    v_value:=public.erp_commercial_v2_normalize_reference(v_transport,p_patch->>'awb',true);
    v_normalized_patch:=jsonb_set(v_normalized_patch,'{awb}',to_jsonb(v_value),true);
  end if;
  if p_patch?'airlineId' then
    v_normalized_patch:=jsonb_set(v_normalized_patch,'{airlineId}',to_jsonb(case when v_transport='AEREO' then btrim(coalesce(p_patch->>'airlineId','')) else '' end),true);
  end if;
  if v_transport='AEREO' and nullif(v_normalized_patch->>'awb','') is not null then
    v_awb_digits:=regexp_replace(v_normalized_patch->>'awb','[^0-9]','','g');
    v_airline_id:=coalesce(nullif(v_normalized_patch->>'airlineId',''),nullif(v_order.payload->>'airlineId',''));
    if v_airline_id is null then
      select airline.record_id into v_airline_id from public.erp_entity_records airline
      where airline.company_id=p_company_id and airline.entity='commercial_airlines' and airline.deleted_at is null
        and lpad(coalesce(airline.payload->>'awbPrefix',''),3,'0')=left(v_awb_digits,3)
      order by airline.record_id limit 1;
      if v_airline_id is not null then v_normalized_patch:=jsonb_set(v_normalized_patch,'{airlineId}',to_jsonb(v_airline_id),true); end if;
    end if;
    if v_airline_id is null then raise exception using errcode='23514',message='COMMERCIAL_ORDER_AIRLINE_REQUIRED_FOR_MAWB'; end if;
    if not exists(select 1 from public.erp_entity_records airline where airline.company_id=p_company_id
      and airline.entity='commercial_airlines' and airline.record_id=v_airline_id and airline.deleted_at is null
      and lpad(coalesce(airline.payload->>'awbPrefix',''),3,'0')=left(v_awb_digits,3)) then
      raise exception using errcode='23514',message='COMMERCIAL_ORDER_MAWB_PREFIX_AIRLINE_MISMATCH';
    end if;
  end if;
  for v_key,v_value in select key,value from jsonb_each_text(v_normalized_patch) loop
    if v_key in ('awb','hawb') then v_current_value:=public.erp_commercial_v2_normalize_reference(v_transport,v_order.payload->>v_key,v_key='awb');
    elsif v_key='airlineId' and v_transport<>'AEREO' then v_current_value:='';
    else v_current_value:=btrim(coalesce(v_order.payload->>v_key,'')); end if;
    if v_current_value is distinct from v_value then v_has_changes:=true; exit; end if;
  end loop;
  if not v_has_changes then return jsonb_build_object('ok',true,'noChange',true,'unchanged',true,'reused',true,
    'operationId',p_operation_id,'serverTime',v_order.updated_at,'serverRecord',to_jsonb(v_order),
    'result',jsonb_build_object('status','COORDINATION_UNCHANGED')); end if;
  v_payload:=v_order.payload||v_normalized_patch||jsonb_build_object('status',v_order.payload->'status',
    'warehouseStatus',v_order.payload->'warehouseStatus','fulfillmentStatus',v_order.payload->'fulfillmentStatus',
    'coordinationUpdatedAt',clock_timestamp());
  v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'commercial_orders',p_record_id,v_payload,v_order.version);
  v_result:=jsonb_build_object('ok',true,'noChange',false,'operationId',p_operation_id,'serverTime',clock_timestamp(),
    'serverRecord',v_saved,'result',jsonb_build_object('status','COORDINATION_UPDATED'));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at)
  values(p_operation_id,p_company_id,'UPDATE_ORDER_COORDINATION',p_record_id,v_normalized_patch,v_result,'CONFIRMED',auth.uid(),p_device_id,coalesce(p_local_created_at,now()));
  return v_result;
end $$;

revoke all on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_patch_commercial_order_coordination(uuid,uuid,text,text,bigint,jsonb,timestamptz) to authenticated,service_role;

create or replace function public.erp_export_v2_update_logistics(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_shipment_id uuid,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_existing public.erp_operations_commands%rowtype; v_shipment public.erp_export_shipment_registry%rowtype;
  v_document jsonb; v_document_id uuid; v_revision integer; v_records jsonb; v_saved jsonb;
  v_before jsonb; v_status text; v_result jsonb; v_now timestamptz:=clock_timestamp();
  v_mawb text; v_hawb text; v_mawb_digits text; v_transport text; v_transport_count integer;
begin
  perform public.erp_export_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null or p_shipment_id is null then
    raise exception using errcode='22023',message='EXPORT_V2_UPDATE_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands command where command.operation_id=p_operation_id and command.company_id=p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':EXPORT:'||p_shipment_id::text,0));
  select * into v_shipment from public.erp_export_shipment_registry shipment
    where shipment.company_id=p_company_id and shipment.shipment_id=p_shipment_id for update;
  if not found then raise exception using errcode='P0002',message='EXPORT_V2_SHIPMENT_NOT_FOUND'; end if;
  if v_shipment.status='CLOSED' then raise exception using errcode='23514',message='EXPORT_V2_CLOSED_IMMUTABLE'; end if;
  v_before:=to_jsonb(v_shipment);
  select count(distinct case
      when upper(coalesce(order_record.payload->>'transportType','AEREO')) in ('SEA','MARITIME','MARITIMO') then 'MARITIMO'
      when upper(coalesce(order_record.payload->>'transportType','AEREO')) in ('AIR','AEREO') then 'AEREO'
      else upper(coalesce(order_record.payload->>'transportType','OTRO')) end),
    min(case when upper(coalesce(order_record.payload->>'transportType','AEREO')) in ('SEA','MARITIME','MARITIMO') then 'MARITIMO'
      when upper(coalesce(order_record.payload->>'transportType','AEREO')) in ('AIR','AEREO') then 'AEREO'
      else upper(coalesce(order_record.payload->>'transportType','OTRO')) end)
  into v_transport_count,v_transport
  from public.erp_export_shipment_order_links link
  join public.erp_entity_records order_record on order_record.company_id=link.company_id
    and order_record.entity='commercial_orders' and order_record.record_id=link.order_id and order_record.deleted_at is null
  where link.company_id=p_company_id and link.shipment_id=p_shipment_id;
  if coalesce(v_transport_count,0)<>1 then raise exception using errcode='23514',message='EXPORT_V2_LINKED_ORDER_TRANSPORT_AMBIGUOUS'; end if;
  if nullif(p_payload->>'transportType','') is not null and
    (case when upper(p_payload->>'transportType') in ('SEA','MARITIME','MARITIMO') then 'MARITIMO'
      when upper(p_payload->>'transportType') in ('AIR','AEREO') then 'AEREO' else upper(p_payload->>'transportType') end)<>v_transport then
    raise exception using errcode='23514',message='EXPORT_V2_TRANSPORT_MISMATCH'; end if;
  if nullif(p_payload->>'cargoAgencyId','') is not null and not exists(select 1 from public.erp_entity_records agency
    where agency.company_id=p_company_id and agency.entity='commercial_agencies' and agency.record_id=p_payload->>'cargoAgencyId' and agency.deleted_at is null)
    then raise exception using errcode='23514',message='EXPORT_V2_CARGO_AGENCY_NOT_FOUND'; end if;
  if v_transport='AEREO' and nullif(p_payload->>'airlineId','') is not null and not exists(select 1 from public.erp_entity_records airline
    where airline.company_id=p_company_id and airline.entity='commercial_airlines' and airline.record_id=p_payload->>'airlineId' and airline.deleted_at is null)
    then raise exception using errcode='23514',message='EXPORT_V2_AIRLINE_NOT_FOUND'; end if;
  if nullif(p_payload#>>'{dae,catalogId}','') is not null and not exists(select 1 from public.erp_entity_records dae
    where dae.company_id=p_company_id and dae.entity='commercial_dae' and dae.record_id=p_payload#>>'{dae,catalogId}' and dae.deleted_at is null)
    then raise exception using errcode='23514',message='EXPORT_V2_DAE_CATALOG_NOT_FOUND'; end if;
  v_mawb:=public.erp_commercial_v2_normalize_reference(v_transport,coalesce(p_payload#>>'{waybills,mawb}',v_shipment.waybills->>'mawb',''),true);
  v_hawb:=public.erp_commercial_v2_normalize_reference(v_transport,coalesce(p_payload#>>'{waybills,hawb}',v_shipment.waybills->>'hawb',''),false);
  if v_transport='AEREO' and v_mawb<>'' then
    v_mawb_digits:=regexp_replace(v_mawb,'[^0-9]','','g');
    if nullif(coalesce(p_payload->>'airlineId',v_shipment.airline_id),'') is null then raise exception using errcode='23514',message='EXPORT_V2_AIRLINE_REQUIRED_FOR_MAWB'; end if;
    if not exists(select 1 from public.erp_entity_records airline where airline.company_id=p_company_id
      and airline.entity='commercial_airlines' and airline.record_id=coalesce(nullif(p_payload->>'airlineId',''),v_shipment.airline_id)
      and airline.deleted_at is null and lpad(coalesce(airline.payload->>'awbPrefix',''),3,'0')=left(v_mawb_digits,3)) then
      raise exception using errcode='23514',message='EXPORT_V2_MAWB_PREFIX_AIRLINE_MISMATCH'; end if;
  end if;
  update public.erp_export_shipment_registry set
    required_document_types=case when v_transport='MARITIMO' then array_remove(required_document_types,'DAE') else required_document_types end,
    cargo_agency_id=coalesce(nullif(p_payload->>'cargoAgencyId',''),cargo_agency_id),
    airline_id=case when v_transport='AEREO' then coalesce(nullif(p_payload->>'airlineId',''),airline_id) else null end,
    origin_airport=coalesce(nullif(upper(p_payload->>'originAirport'),''),origin_airport),
    destination_airport=coalesce(nullif(upper(p_payload->>'destinationAirport'),''),destination_airport),
    planned_departure_at=coalesce(nullif(p_payload->>'plannedDepartureAt','')::timestamptz,planned_departure_at),
    dae=case when p_payload?'dae' then coalesce(p_payload->'dae','{}'::jsonb) else dae end,
    waybills=case when p_payload?'waybills' then
      (coalesce(p_payload->'waybills','{}'::jsonb)||jsonb_build_object('mawb',v_mawb,'hawb',v_hawb,'transportType',v_transport)
        ||case when v_transport='AEREO' then jsonb_build_object('mawbDigits',v_mawb_digits) else '{}'::jsonb end)-case when v_transport='AEREO' then '__none__' else 'mawbDigits' end
      else waybills end,
    flight=case when p_payload?'flight' then coalesce(p_payload->'flight','{}'::jsonb) else flight end,
    weights=case when p_payload?'weights' then coalesce(p_payload->'weights','{}'::jsonb) else weights end,
    logistics=logistics||coalesce(p_payload->'logistics','{}'::jsonb)||jsonb_build_object('transportType',v_transport),
    observations=coalesce(p_payload->>'observations',observations),updated_at=v_now,updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
  where company_id=p_company_id and shipment_id=p_shipment_id returning * into v_shipment;
  if p_payload?'flight' and coalesce(p_payload#>>'{flight,flightNumber}','') is distinct from coalesce(v_before#>>'{flight,flightNumber}','') then
    update public.erp_export_shipment_flight_history set status='SUPERSEDED' where company_id=p_company_id and shipment_id=p_shipment_id and status='ACTIVE';
    select coalesce(max(revision),0)+1 into v_revision from public.erp_export_shipment_flight_history where company_id=p_company_id and shipment_id=p_shipment_id;
    insert into public.erp_export_shipment_flight_history(company_id,flight_revision_id,shipment_id,revision,airline_id,flight_number,
      planned_departure_at,origin_airport,destination_airport,connections,status,changed_at,changed_by,operation_id)
    values(p_company_id,gen_random_uuid(),p_shipment_id,v_revision,v_shipment.airline_id,coalesce(p_payload#>>'{flight,flightNumber}',''),
      v_shipment.planned_departure_at,v_shipment.origin_airport,v_shipment.destination_airport,coalesce(p_payload#>'{flight,connections}','[]'::jsonb),
      'ACTIVE',v_now,auth.uid(),p_operation_id);
  end if;
  for v_document in select value from jsonb_array_elements(coalesce(p_payload->'documents','[]'::jsonb)) loop
    if nullif(upper(btrim(v_document->>'type')),'') is null then continue; end if;
    select document_id into v_document_id from public.erp_export_shipment_documents document where document.company_id=p_company_id
      and document.shipment_id=p_shipment_id and document.document_type=upper(btrim(v_document->>'type')) for update;
    if v_document_id is null then v_document_id:=gen_random_uuid(); end if;
    insert into public.erp_export_shipment_documents(company_id,document_id,shipment_id,document_type,status,reference,storage_path,metadata,created_at,created_by,updated_at,updated_by,last_operation_id)
    values(p_company_id,v_document_id,p_shipment_id,upper(btrim(v_document->>'type')),upper(coalesce(nullif(v_document->>'status',''),'PENDING')),
      coalesce(v_document->>'reference',''),nullif(v_document->>'storagePath',''),coalesce(v_document->'metadata','{}'::jsonb),v_now,auth.uid(),v_now,auth.uid(),p_operation_id)
    on conflict(company_id,shipment_id,document_type) do update set status=excluded.status,reference=excluded.reference,
      storage_path=excluded.storage_path,metadata=excluded.metadata,updated_at=v_now,updated_by=auth.uid(),last_operation_id=p_operation_id;
  end loop;
  v_status:=public.erp_export_v2_refresh_documentation_status(p_company_id,p_shipment_id);
  v_records:=public.erp_export_v2_canonical_records(p_company_id,p_operation_id,p_device_id,p_shipment_id);
  v_saved:=public.erp_export_v2_write_event(p_company_id,p_operation_id,p_device_id,p_shipment_id,'LOGISTICS_UPDATED',
    jsonb_build_object('before',v_before,'after',p_payload,'status',v_status,'transportType',v_transport));
  v_records:=v_records||jsonb_build_array(v_saved);
  v_result:=jsonb_build_object('ok',true,'command','UPDATE_EXPORT_LOGISTICS','operationId',p_operation_id,
    'serverTime',v_now,'records',v_records,'result',jsonb_build_object('shipmentId',p_shipment_id,'status',v_status));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at)
  values(p_operation_id,p_company_id,'UPDATE_EXPORT_LOGISTICS',p_shipment_id::text,coalesce(p_payload,'{}'::jsonb),v_result,'CONFIRMED',auth.uid(),p_device_id,coalesce(p_local_created_at,now()));
  return v_result;
end $$;

revoke all on function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_export_v2_update_logistics(uuid,uuid,text,uuid,jsonb,timestamptz) to authenticated,service_role;

commit;
