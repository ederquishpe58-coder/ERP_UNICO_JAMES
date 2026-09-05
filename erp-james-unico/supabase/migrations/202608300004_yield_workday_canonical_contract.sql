begin;

do $$
begin
  if to_regclass('public.erp_entity_records') is null
     or to_regclass('public.erp_u2c3_offline_action_capabilities') is null
     or to_regprocedure('public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamp with time zone)') is null
     or to_regprocedure('public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamp with time zone)') is null
     or to_regprocedure('public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamp with time zone)') is null
     or to_regprocedure('public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamp with time zone)') is null then
    raise exception 'YIELD_WORKDAY_CANONICAL_FOUNDATION_MISSING';
  end if;
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL') <> 184 then
    raise exception 'GERENCIA_GENERAL_PREEXISTING_GRANT_COUNT_MISMATCH';
  end if;
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='RECEPCIONISTA_P1') <> 9 then
    raise exception 'RECEPCIONISTA_P1_PREEXISTING_GRANT_COUNT_MISMATCH';
  end if;
end;
$$;

insert into public.erp_security_capabilities(
  capability_id,module,resource,action,risk_level,description,active
) values (
  'operations.yield_workday.manage','operations','yield_workday','manage','MEDIUM',
  'Inicia, pausa, reanuda y finaliza la jornada canónica utilizada por Rendimientos.',true
)
on conflict (capability_id) do update set
  module=excluded.module,
  resource=excluded.resource,
  action=excluded.action,
  risk_level=excluded.risk_level,
  description=excluded.description,
  active=excluded.active,
  updated_at=clock_timestamp();

insert into public.erp_security_profile_capabilities(profile_id,capability_id)
values ('GERENCIA_GENERAL','operations.yield_workday.manage')
on conflict (profile_id,capability_id) do nothing;

insert into public.erp_u2c3_offline_action_capabilities(entity,action,capability_id)
values
  ('operations_yield_workday','INSERT','operations.yield_workday.manage'),
  ('operations_yield_workday','UPDATE','operations.yield_workday.manage'),
  ('operations_yield_workday_history','INSERT','operations.yield_workday.manage'),
  ('operations_yield_workday_history','UPDATE','operations.yield_workday.manage')
on conflict (entity,action) do update set capability_id=excluded.capability_id;

create or replace function public.erp_yield_active_workday(p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_id_text text;
  v_count integer;
begin
  select count(*),min(record.payload->>'id')
  into v_count,v_id_text
  from public.erp_entity_records record
  where record.company_id=p_company_id
    and record.entity='operations_yield_workday'
    and record.record_id='operations_yield_workday'
    and record.deleted_at is null
    and upper(coalesce(record.payload->>'status',''))='ACTIVA';

  if v_count <> 1
     or coalesce(v_id_text,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='23514',message='OPERATIONS_ACTIVE_WORKDAY_REQUIRED';
  end if;
  return v_id_text::uuid;
end;
$$;
revoke all on function public.erp_yield_active_workday(uuid) from public,anon,authenticated,service_role;

create or replace function public.erp_yield_validate_workday_mutation(
  p_company_id uuid,
  p_entity text,
  p_action text,
  p_record_id text,
  p_payload jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $$
declare
  v_current public.erp_entity_records%rowtype;
  v_current_status text;
  v_next_status text:=upper(btrim(coalesce(p_payload->>'status','')));
  v_current_id text;
  v_next_id text:=nullif(btrim(coalesce(p_payload->>'id','')),'');
begin
  if upper(coalesce(p_action,'')) not in ('INSERT','UPDATE')
     or jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object'
     or v_next_id is null
     or v_next_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='23514',message='OPERATIONS_WORKDAY_MUTATION_INVALID';
  end if;

  if p_entity='operations_yield_workday_history' then
    if v_next_status <> 'FINALIZADA' or nullif(btrim(coalesce(p_payload->>'endedAt','')),'') is null then
      raise exception using errcode='23514',message='OPERATIONS_WORKDAY_HISTORY_MUST_BE_FINAL';
    end if;
    return;
  end if;

  if p_entity <> 'operations_yield_workday' or p_record_id <> 'operations_yield_workday'
     or v_next_status not in ('ACTIVA','PAUSADA','FINALIZADA') then
    raise exception using errcode='23514',message='OPERATIONS_WORKDAY_SINGLETON_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':YIELD_WORKDAY',0));
  select * into v_current
  from public.erp_entity_records record
  where record.company_id=p_company_id
    and record.entity='operations_yield_workday'
    and record.record_id='operations_yield_workday'
    and record.deleted_at is null
  for update;

  if not found then
    if upper(p_action) <> 'INSERT' or v_next_status <> 'ACTIVA' then
      raise exception using errcode='23514',message='OPERATIONS_WORKDAY_MUST_START_ACTIVE';
    end if;
    return;
  end if;

  v_current_status:=upper(coalesce(v_current.payload->>'status',''));
  v_current_id:=nullif(btrim(coalesce(v_current.payload->>'id','')),'');

  if v_current_status in ('ACTIVA','PAUSADA') and v_next_id <> v_current_id then
    raise exception using errcode='23514',message='OPERATIONS_SECOND_ACTIVE_WORKDAY_DENIED';
  end if;
  if v_current_status='ACTIVA' and v_next_status not in ('ACTIVA','PAUSADA','FINALIZADA') then
    raise exception using errcode='23514',message='OPERATIONS_WORKDAY_TRANSITION_INVALID';
  end if;
  if v_current_status='PAUSADA' and v_next_status not in ('PAUSADA','ACTIVA','FINALIZADA') then
    raise exception using errcode='23514',message='OPERATIONS_WORKDAY_TRANSITION_INVALID';
  end if;
  if v_current_status='FINALIZADA' and (v_next_status <> 'ACTIVA' or v_next_id=v_current_id) then
    raise exception using errcode='23514',message='OPERATIONS_NEW_WORKDAY_ID_REQUIRED';
  end if;
  if v_next_status='FINALIZADA' and nullif(btrim(coalesce(p_payload->>'endedAt','')),'') is null then
    raise exception using errcode='23514',message='OPERATIONS_WORKDAY_END_REQUIRED';
  end if;
end;
$$;
revoke all on function public.erp_yield_validate_workday_mutation(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.erp_yield_assert_command_workday(
  p_company_id uuid,
  p_command text,
  p_payload jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_workday_id uuid:=public.erp_yield_active_workday(p_company_id);
  v_record jsonb;
  v_relevant integer:=0;
begin
  for v_record in select value from jsonb_array_elements(coalesce(p_payload->'records','[]'::jsonb))
  loop
    if (upper(p_command)='ASSIGN_CLASSIFICATION' and v_record->>'entity' in (
          'operations_classifier_assignments','operations_mesh_records','operations_mesh_history','operations_performances'
        ))
       or (upper(p_command)='REGISTER_CLASSIFICATION_RESULT' and v_record->>'entity' in (
          'operations_classification_results','operations_classifier_assignments','operations_performances'
        ))
       or (upper(p_command)='REGISTER_INVENTORY_INTAKE' and v_record->>'entity' in (
          'operations_rose_inventory','operations_bunch_entries','operations_scanner_events',
          'operations_inventory_movements','operations_performances'
        )) then
      v_relevant:=v_relevant+1;
      if coalesce(v_record#>>'{payload,workdayId}','') <> v_workday_id::text then
        raise exception using errcode='23514',message='OPERATIONS_COMMAND_WORKDAY_MISMATCH';
      end if;
    end if;
  end loop;
  if v_relevant=0 then
    raise exception using errcode='23514',message='OPERATIONS_COMMAND_WORKDAY_RECORD_REQUIRED';
  end if;
  return v_workday_id;
end;
$$;
revoke all on function public.erp_yield_assert_command_workday(uuid,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.erp_yield_attach_scanner_workday(
  p_company_id uuid,
  p_operation_id uuid,
  p_device_id text,
  p_result jsonb,
  p_workday_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $$
declare
  v_row public.erp_entity_records%rowtype;
  v_saved jsonb;
  v_performance public.erp_entity_records%rowtype;
  v_entry public.erp_entity_records%rowtype;
  v_performance_id text:='SCANNER-YIELD-'||p_operation_id::text;
  v_records jsonb;
begin
  if upper(coalesce(p_result#>>'{result,status}',''))='ALREADY_RECEIVED' then
    return p_result;
  end if;

  for v_row in
    select distinct on (record.entity,record.record_id) record.*
    from public.erp_entity_records record
    where record.company_id=p_company_id
      and record.deleted_at is null
      and record.entity in ('operations_rose_inventory','operations_bunch_entries','operations_scanner_events','operations_inventory_movements')
      and exists (
        select 1 from jsonb_array_elements(coalesce(p_result->'records','[]'::jsonb)) item
        where item->>'entity'=record.entity
          and coalesce(item->>'record_id',item->>'recordId')=record.record_id
      )
    order by record.entity,record.record_id,record.updated_at desc
  loop
    if nullif(coalesce(v_row.payload->>'workdayId',''),'') is not null
       and v_row.payload->>'workdayId' <> p_workday_id::text then
      raise exception using errcode='23514',message='OPERATIONS_SCANNER_WORKDAY_MISMATCH';
    end if;
    if coalesce(v_row.payload->>'workdayId','')='' then
      v_saved:=public.erp_operations_v2_write_record(
        p_company_id,p_operation_id,p_device_id,v_row.entity,v_row.record_id,
        v_row.payload||jsonb_build_object('workdayId',p_workday_id::text),v_row.version
      );
    end if;
  end loop;

  select record.* into v_entry
  from public.erp_entity_records record
  where record.company_id=p_company_id
    and record.entity='operations_bunch_entries'
    and record.deleted_at is null
    and exists (
      select 1 from jsonb_array_elements(coalesce(p_result->'records','[]'::jsonb)) item
      where item->>'entity'=record.entity
        and coalesce(item->>'record_id',item->>'recordId')=record.record_id
    )
  order by record.updated_at desc limit 1;

  if v_entry.record_id is null then
    raise exception using errcode='23514',message='OPERATIONS_SCANNER_ENTRY_REQUIRED';
  end if;

  select * into v_performance from public.erp_entity_records record
  where record.company_id=p_company_id and record.entity='operations_performances'
    and record.record_id=v_performance_id and record.deleted_at is null for update;
  if found and coalesce(v_performance.payload->>'workdayId','')<>p_workday_id::text then
    raise exception using errcode='23514',message='OPERATIONS_SCANNER_PERFORMANCE_WORKDAY_MISMATCH';
  elsif not found then
    v_saved:=public.erp_operations_v2_write_record(
      p_company_id,p_operation_id,p_device_id,'operations_performances',v_performance_id,
      jsonb_build_object(
        'id',v_performance_id,
        'date',coalesce(v_entry.payload->>'date',to_char(clock_timestamp() at time zone 'America/Guayaquil','YYYY-MM-DD')),
        'dateTime',coalesce(v_entry.payload->'registeredAt',to_jsonb(clock_timestamp())),
        'employeeId',coalesce(v_entry.payload->>'buncherEmployeeId',v_entry.payload->>'buncher_employee_id',''),
        'operationalWorkerId',coalesce(v_entry.payload->>'buncherEmployeeId',v_entry.payload->>'buncher_employee_id',''),
        'worker',coalesce(v_entry.payload->>'buncher',''),
        'activity','EMBONCHADO',
        'variety',coalesce(v_entry.payload->>'variety',''),
        'bunches',1,
        'stems',coalesce(nullif(v_entry.payload->>'stemsPerBunch','')::numeric,0),
        'workdayId',p_workday_id::text,
        'observation','Rendimiento confirmado por ingreso canónico de ramo mediante escáner.'
      ),0
    );
  end if;

  select coalesce(jsonb_agg(
    case when current_record.record_id is null then item else to_jsonb(current_record) end
    order by ordinal
  ),'[]'::jsonb)
  into v_records
  from jsonb_array_elements(coalesce(p_result->'records','[]'::jsonb)) with ordinality source(item,ordinal)
  left join public.erp_entity_records current_record
    on current_record.company_id=p_company_id
   and current_record.entity=item->>'entity'
   and current_record.record_id=coalesce(item->>'record_id',item->>'recordId')
   and current_record.deleted_at is null;

  select * into v_performance from public.erp_entity_records record
  where record.company_id=p_company_id and record.entity='operations_performances'
    and record.record_id=v_performance_id and record.deleted_at is null;
  v_records:=v_records||jsonb_build_array(to_jsonb(v_performance));
  return jsonb_set(p_result,'{records}',v_records,true);
end;
$$;
revoke all on function public.erp_yield_attach_scanner_workday(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.erp_apply_offline_operation(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_entity text,p_action text,p_record_id text,
  p_payload jsonb,p_base_payload jsonb,p_field_changes jsonb,p_base_version bigint,p_local_created_at timestamptz
)
returns table(operation_id uuid,status text,result_version bigint,server_time timestamptz,last_error text,
  conflict boolean,conflict_details jsonb,server_record jsonb,discarded_fields jsonb,merge_summary jsonb)
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_apply_offline_operation',p_company_id,
    jsonb_build_object('entity',p_entity,'action',p_action,'record_id',p_record_id,'payload',coalesce(p_payload,'{}'::jsonb))
  );
  if p_entity in ('operations_yield_workday','operations_yield_workday_history')
     and not exists(select 1 from public.erp_sync_operations operation where operation.operation_id=p_operation_id) then
    perform public.erp_yield_validate_workday_mutation(p_company_id,p_entity,p_action,p_record_id,p_payload);
  end if;
  return query select * from public.erp_apply_offline_operation_u2c3_internal(
    p_operation_id,p_company_id,p_device_id,p_entity,p_action,p_record_id,p_payload,p_base_payload,
    p_field_changes,p_base_version,p_local_created_at
  );
end;
$$;
revoke all on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) from public,anon,service_role;
grant execute on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) to authenticated;

create or replace function public.erp_execute_operations_v2(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_command text,p_payload jsonb,p_local_created_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_existing jsonb;
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_execute_operations_v2',p_company_id,jsonb_build_object('command',p_command,'payload',coalesce(p_payload,'{}'::jsonb))
  );
  select command.result into v_existing from public.erp_operations_commands command
  where command.operation_id=p_operation_id and command.company_id=p_company_id;
  if found then return v_existing; end if;
  if upper(p_command) in ('ASSIGN_CLASSIFICATION','REGISTER_CLASSIFICATION_RESULT','REGISTER_INVENTORY_INTAKE') then
    perform public.erp_yield_assert_command_workday(p_company_id,p_command,p_payload);
  end if;
  return public.erp_execute_operations_v2_u2c3_internal(p_operation_id,p_company_id,p_device_id,p_command,p_payload,p_local_created_at);
end;
$$;
revoke all on function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) from public,anon,service_role;
grant execute on function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;

create or replace function public.erp_zebra_v2_receive_bunch(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_label_code text,p_payload jsonb default '{}'::jsonb,p_local_created_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_existing jsonb; v_workday_id uuid; v_result jsonb;
begin
  perform public.erp_u2c3_assert_mutation_capability('erp_zebra_v2_receive_bunch',p_company_id,'{}'::jsonb);
  select command.result into v_existing from public.erp_operations_commands command
  where command.operation_id=p_operation_id and command.company_id=p_company_id;
  if found then return v_existing; end if;
  v_workday_id:=public.erp_yield_active_workday(p_company_id);
  if coalesce(p_payload->>'workdayId','')<>v_workday_id::text then
    raise exception using errcode='23514',message='OPERATIONS_SCANNER_WORKDAY_MISMATCH';
  end if;
  v_result:=public.erp_zebra_v2_receive_bunch_u2c3_internal(p_operation_id,p_company_id,p_device_id,p_label_code,p_payload,p_local_created_at);
  v_result:=public.erp_yield_attach_scanner_workday(p_company_id,p_operation_id,p_device_id,v_result,v_workday_id);
  update public.erp_operations_commands set result=v_result where operation_id=p_operation_id and company_id=p_company_id;
  return v_result;
end;
$$;
revoke all on function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) from public,anon,service_role;
grant execute on function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;

create or replace function public.erp_destination_v2_receive_bunch(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_label_code text,p_payload jsonb default '{}'::jsonb,p_local_created_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_existing jsonb; v_workday_id uuid; v_result jsonb;
begin
  perform public.erp_u2c3_assert_mutation_capability('erp_destination_v2_receive_bunch',p_company_id,'{}'::jsonb);
  select command.result into v_existing from public.erp_operations_commands command
  where command.operation_id=p_operation_id and command.company_id=p_company_id;
  if found then return v_existing; end if;
  v_workday_id:=public.erp_yield_active_workday(p_company_id);
  if coalesce(p_payload->>'workdayId','')<>v_workday_id::text then
    raise exception using errcode='23514',message='OPERATIONS_SCANNER_WORKDAY_MISMATCH';
  end if;
  v_result:=public.erp_destination_v2_receive_bunch_u2c3_internal(p_operation_id,p_company_id,p_device_id,p_label_code,p_payload,p_local_created_at);
  v_result:=public.erp_yield_attach_scanner_workday(p_company_id,p_operation_id,p_device_id,v_result,v_workday_id);
  update public.erp_operations_commands set result=v_result where operation_id=p_operation_id and company_id=p_company_id;
  return v_result;
end;
$$;
revoke all on function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) from public,anon,service_role;
grant execute on function public.erp_destination_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;

do $$
begin
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL') <> 185 then
    raise exception 'GERENCIA_GENERAL_WORKDAY_GRANT_COUNT_MISMATCH';
  end if;
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='RECEPCIONISTA_P1') <> 9 then
    raise exception 'RECEPCIONISTA_P1_GRANTS_CHANGED';
  end if;
  if exists (
    select 1 from public.erp_security_profile_capabilities
    where profile_id in ('GERENCIA_GENERAL','RECEPCIONISTA_P1') and capability_id='operations.parameters.manage'
  ) then raise exception 'BROAD_PARAMETERS_MANAGE_NOT_ALLOWED'; end if;
  if (select count(*) from public.erp_u2c3_offline_action_capabilities
      where entity in ('operations_yield_workday','operations_yield_workday_history')
        and action in ('INSERT','UPDATE') and capability_id='operations.yield_workday.manage') <> 4 then
    raise exception 'YIELD_WORKDAY_OFFLINE_MAPPING_MISMATCH';
  end if;
  if exists (
    select 1 from public.erp_security_profile_capabilities
    where profile_id='RECEPCIONISTA_P1' and capability_id='operations.yield_workday.manage'
  ) then raise exception 'RECEPCIONISTA_P1_WORKDAY_GRANT_NOT_ALLOWED'; end if;
end;
$$;

notify pgrst,'reload schema';
commit;
