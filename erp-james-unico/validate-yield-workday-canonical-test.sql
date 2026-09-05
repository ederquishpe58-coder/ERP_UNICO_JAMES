\set ON_ERROR_STOP on
begin;

create temporary table pg_temp.yield_contract_result(
  test_name text primary key,
  passed boolean not null,
  detail text not null default ''
) on commit drop;

create temporary table pg_temp.yield_actor_result(
  actor_mode text not null,
  user_id uuid not null,
  company_id uuid not null
) on commit drop;

do $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_reception_id text:=gen_random_uuid()::text;
  v_reception_item_id text:=gen_random_uuid()::text;
  v_assignment_id text:=gen_random_uuid()::text;
  v_assignment_denied_id text:=gen_random_uuid()::text;
  v_delivery_group text:=gen_random_uuid()::text;
  v_workday_id uuid:=gen_random_uuid();
  v_second_workday_id uuid:=gen_random_uuid();
  v_start_operation uuid:=gen_random_uuid();
  v_finish_operation uuid:=gen_random_uuid();
  v_label_operation uuid:=gen_random_uuid();
  v_scan_operation uuid:=gen_random_uuid();
  v_denied_scan_operation uuid:=gen_random_uuid();
  v_label_result jsonb;
  v_scan_result jsonb;
  v_label_code text;
  v_second_label_code text;
  v_before_classification integer;
  v_before_inventory integer;
  v_before_history integer;
  v_after_classification integer;
  v_after_inventory integer;
  v_after_history integer;
  v_denied boolean;
  v_actor_mode text:='EXISTING_GERENCIA_GENERAL';
  v_empty_base_payload jsonb:='{}'::jsonb;
  v_no_field_changes jsonb:='[]'::jsonb;
begin
  select membership.company_id,membership.user_id
  into v_company_id,v_user_id
  from public.user_company_memberships membership
  join public.companies company on company.id=membership.company_id
  join public.erp_security_user_company_profiles assignment
    on assignment.company_id=membership.company_id and assignment.user_id=membership.user_id
  where company.company_key='COMP-BLESS-FLOWER'
    and company.is_active
    and membership.membership_status='ACTIVE'
    and assignment.profile_id='GERENCIA_GENERAL'
  order by membership.user_id
  limit 1;

  if v_company_id is null or v_user_id is null then
    v_actor_mode:='TEMP_PROFILE_FIXTURE';
    select membership.company_id,membership.user_id
    into v_company_id,v_user_id
    from public.user_company_memberships membership
    join public.companies company on company.id=membership.company_id
    where company.company_key='COMP-BLESS-FLOWER'
      and company.is_active
      and membership.membership_status='ACTIVE'
    order by membership.user_id
    limit 1;
    if v_company_id is null or v_user_id is null then
      raise exception 'YIELD_TEST_SAFE_MEMBERSHIP_ACTOR_MISSING';
    end if;
    insert into public.erp_security_user_company_profiles(company_id,user_id,profile_id)
    values(v_company_id,v_user_id,'GERENCIA_GENERAL')
    on conflict(company_id,user_id) do update
    set profile_id=excluded.profile_id,updated_at=clock_timestamp();
    delete from public.erp_security_user_capability_overrides
    where company_id=v_company_id and user_id=v_user_id;
  end if;
  insert into pg_temp.yield_actor_result values(v_actor_mode,v_user_id,v_company_id);
  perform set_config('request.jwt.claim.sub',v_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  if not public.erp_security_has_capability(v_company_id,'operations.yield_workday.manage') then
    raise exception 'YIELD_WORKDAY_MANAGE_NOT_EFFECTIVE';
  end if;
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL')<>185 then
    raise exception 'GERENCIA_GENERAL_TOTAL_NOT_185';
  end if;
  if (select count(*) from public.erp_security_profile_capabilities where profile_id='RECEPCIONISTA_P1')<>9 then
    raise exception 'RECEPCIONISTA_P1_TOTAL_CHANGED';
  end if;
  if exists(select 1 from public.erp_security_profile_capabilities where profile_id='RECEPCIONISTA_P1' and capability_id='operations.yield_workday.manage') then
    raise exception 'RECEPCIONISTA_P1_WORKDAY_CAPABILITY_GRANTED';
  end if;
  if jsonb_typeof(v_empty_base_payload)<>'object' then
    raise exception 'YIELD_TEST_BASE_PAYLOAD_TYPE_INVALID:%:%',jsonb_typeof(v_empty_base_payload),v_empty_base_payload;
  end if;
  if jsonb_typeof(v_no_field_changes)<>'array' then
    raise exception 'YIELD_TEST_FIELD_CHANGES_TYPE_INVALID:%:%',jsonb_typeof(v_no_field_changes),v_no_field_changes;
  end if;

  -- El fixture es transaccional: aparta temporalmente el singleton TEST y todo se revierte.
  delete from public.erp_entity_records
  where company_id=v_company_id and entity in ('operations_yield_workday','operations_yield_workday_history');

  -- Recepción no depende de jornada.
  perform public.erp_execute_operations_v2(
    gen_random_uuid(),v_company_id,'yield-contract-test','SAVE_RECEPTION',
    jsonb_build_object(
      'receptionId',v_reception_id,
      'records',jsonb_build_array(jsonb_build_object(
        'entity','operations_receptions','recordId',v_reception_id,'baseVersion',0,
        'payload',jsonb_build_object(
          'id',v_reception_id,'supplier','TEST SUPPLIER','block','TEST BLOCK',
          'receptionist','TEST RECEPTIONIST','status','PENDIENTE',
          'items',jsonb_build_array(jsonb_build_object(
            'id',v_reception_item_id,'variety','TEST VARIETY','totalStems',100,
            'meshCount',4,'stemsPerMesh',25,'extraStems',0
          ))
        )
      ))
    ),clock_timestamp()
  );
  insert into pg_temp.yield_contract_result values('RECEPTION_WITHOUT_WORKDAY',true,'PASS');

  perform * from public.erp_apply_offline_operation(
    v_start_operation,v_company_id,'yield-contract-test','operations_yield_workday','INSERT',
    'operations_yield_workday',
    jsonb_build_object('id',v_workday_id::text,'date',current_date::text,'status','ACTIVA',
      'startedAt',clock_timestamp(),'pauses','[]'::jsonb,'observation','TEST WORKDAY'),
    v_empty_base_payload,v_no_field_changes,0,clock_timestamp()
  );
  if public.erp_yield_active_workday(v_company_id)<>v_workday_id then
    raise exception 'ACTIVE_WORKDAY_CANONICAL_MISMATCH';
  end if;
  insert into pg_temp.yield_contract_result values('START_WORKDAY',true,v_workday_id::text);

  v_denied:=false;
  begin
    perform * from public.erp_apply_offline_operation(
      gen_random_uuid(),v_company_id,'yield-contract-test','operations_yield_workday','UPDATE',
      'operations_yield_workday',
      jsonb_build_object('id',v_second_workday_id::text,'date',current_date::text,'status','ACTIVA','startedAt',clock_timestamp()),
      v_empty_base_payload,v_no_field_changes,1,clock_timestamp()
    );
  exception when sqlstate '23514' then v_denied:=true;
  end;
  if not v_denied then raise exception 'SECOND_ACTIVE_WORKDAY_NOT_DENIED'; end if;
  insert into pg_temp.yield_contract_result values('SECOND_ACTIVE_WORKDAY',true,'DENIED');

  select count(*) into v_before_classification from public.erp_entity_records
  where company_id=v_company_id and entity='operations_classifier_assignments' and deleted_at is null;
  perform public.erp_execute_operations_v2(
    gen_random_uuid(),v_company_id,'yield-contract-test','ASSIGN_CLASSIFICATION',
    jsonb_build_object(
      'deliveryGroupId',v_delivery_group,
      'assignmentIds',jsonb_build_array(v_assignment_id),
      'records',jsonb_build_array(jsonb_build_object(
        'entity','operations_classifier_assignments','recordId',v_assignment_id,'baseVersion',0,
        'payload',jsonb_build_object(
          'id',v_assignment_id,'receptionId',v_reception_id,'receptionItemId',v_reception_item_id,
          'deliveryGroupId',v_delivery_group,'classifier','TEST CLASSIFIER','supplier','TEST SUPPLIER',
          'block','TEST BLOCK','variety','TEST VARIETY','totalStems',25,'status','ENTREGADO',
          'workdayId',v_workday_id::text
        )
      ))
    ),clock_timestamp()
  );
  insert into pg_temp.yield_contract_result values('CLASSIFICATION_WITH_ACTIVE_WORKDAY',true,'PASS');

  select public.erp_zebra_v2_create_labels(
    v_label_operation,v_company_id,'yield-contract-test',
    jsonb_build_array(
      jsonb_build_object('bunchId',gen_random_uuid(),'variety','TEST VARIETY','length',50,'quality','EXPORTACION',
        'category','EXPORTACION','stemsPerBunch',25,'color','RED','buncher','TEST BUNCHER',
        'components',jsonb_build_array(jsonb_build_object('provider','TEST SUPPLIER','block','TEST BLOCK','stems',25))),
      jsonb_build_object('bunchId',gen_random_uuid(),'variety','TEST VARIETY','length',50,'quality','EXPORTACION',
        'category','EXPORTACION','stemsPerBunch',25,'color','RED','buncher','TEST BUNCHER',
        'components',jsonb_build_array(jsonb_build_object('provider','TEST SUPPLIER','block','TEST BLOCK','stems',25)))
    ),clock_timestamp()
  ) into v_label_result;
  v_label_code:=v_label_result#>>'{result,labels,0,labelCode}';
  v_second_label_code:=v_label_result#>>'{result,labels,1,labelCode}';
  if coalesce(v_label_code,'')='' or coalesce(v_second_label_code,'')='' then
    raise exception 'YIELD_SCANNER_LABEL_FIXTURES_MISSING';
  end if;

  select public.erp_zebra_v2_receive_bunch(
    v_scan_operation,v_company_id,'yield-contract-test',v_label_code,
    jsonb_build_object('responsible','TEST SCANNER','workdayId',v_workday_id::text),clock_timestamp()
  ) into v_scan_result;
  if coalesce(v_scan_result#>>'{result,status}','')<>'RECEIVED_IN_INVENTORY' then
    raise exception 'SCANNER_WITH_ACTIVE_WORKDAY_FAILED';
  end if;
  if exists(
    select 1 from public.erp_entity_records record
    where record.company_id=v_company_id
      and record.entity in ('operations_rose_inventory','operations_bunch_entries','operations_scanner_events','operations_inventory_movements','operations_performances')
      and record.last_operation_id=v_scan_operation
      and coalesce(record.payload->>'workdayId','')<>v_workday_id::text
  ) or not exists(
    select 1 from public.erp_entity_records record
    where record.company_id=v_company_id and record.entity='operations_performances'
      and record.record_id='SCANNER-YIELD-'||v_scan_operation::text
      and record.payload->>'workdayId'=v_workday_id::text
  ) then raise exception 'SCANNER_CANONICAL_WORKDAY_NOT_PERSISTED'; end if;
  insert into pg_temp.yield_contract_result values('SCANNER_WITH_ACTIVE_WORKDAY',true,v_workday_id::text);

  select count(*) into v_before_inventory from public.erp_entity_records
  where company_id=v_company_id and entity='operations_rose_inventory' and deleted_at is null;
  select count(*) into v_before_history from public.erp_entity_records
  where company_id=v_company_id and entity in ('operations_classifier_assignments','operations_scanner_events','operations_performances') and deleted_at is null;

  perform * from public.erp_apply_offline_operation(
    v_finish_operation,v_company_id,'yield-contract-test','operations_yield_workday','UPDATE',
    'operations_yield_workday',
    jsonb_build_object('id',v_workday_id::text,'date',current_date::text,'status','FINALIZADA',
      'startedAt',clock_timestamp()-interval '1 hour','endedAt',clock_timestamp(),
      'pauses','[]'::jsonb,'summary',jsonb_build_object('test',true)),
    v_empty_base_payload,v_no_field_changes,1,clock_timestamp()
  );
  perform * from public.erp_apply_offline_operation(
    gen_random_uuid(),v_company_id,'yield-contract-test','operations_yield_workday_history','INSERT',
    v_workday_id::text,
    jsonb_build_object('id',v_workday_id::text,'date',current_date::text,'status','FINALIZADA',
      'startedAt',clock_timestamp()-interval '1 hour','endedAt',clock_timestamp(),'summary',jsonb_build_object('test',true)),
    v_empty_base_payload,v_no_field_changes,0,clock_timestamp()
  );
  insert into pg_temp.yield_contract_result values('FINISH_WORKDAY',true,'PASS');

  v_denied:=false;
  begin
    perform public.erp_execute_operations_v2(
      gen_random_uuid(),v_company_id,'yield-contract-test','ASSIGN_CLASSIFICATION',
      jsonb_build_object('deliveryGroupId',gen_random_uuid()::text,'assignmentIds',jsonb_build_array(v_assignment_denied_id),
        'records',jsonb_build_array(jsonb_build_object(
          'entity','operations_classifier_assignments','recordId',v_assignment_denied_id,'baseVersion',0,
          'payload',jsonb_build_object('id',v_assignment_denied_id,'receptionId',v_reception_id,
            'receptionItemId',v_reception_item_id,'classifier','TEST CLASSIFIER','totalStems',1,
            'status','ENTREGADO','workdayId',v_workday_id::text)
        )))
      ,clock_timestamp()
    );
  exception when sqlstate '23514' then v_denied:=true;
  end;
  if not v_denied then raise exception 'CLASSIFICATION_WITHOUT_WORKDAY_NOT_DENIED'; end if;
  insert into pg_temp.yield_contract_result values('CLASSIFICATION_WITHOUT_WORKDAY',true,'DENIED');

  v_denied:=false;
  begin
    perform public.erp_zebra_v2_receive_bunch(
      v_denied_scan_operation,v_company_id,'yield-contract-test',v_second_label_code,
      jsonb_build_object('responsible','TEST SCANNER','workdayId',v_workday_id::text),clock_timestamp()
    );
  exception when sqlstate '23514' then v_denied:=true;
  end;
  if not v_denied then raise exception 'SCANNER_WITHOUT_WORKDAY_NOT_DENIED'; end if;
  insert into pg_temp.yield_contract_result values('SCANNER_WITHOUT_WORKDAY',true,'DENIED');

  select count(*) into v_after_inventory from public.erp_entity_records
  where company_id=v_company_id and entity='operations_rose_inventory' and deleted_at is null;
  select count(*) into v_after_history from public.erp_entity_records
  where company_id=v_company_id and entity in ('operations_classifier_assignments','operations_scanner_events','operations_performances') and deleted_at is null;
  select count(*) into v_after_classification from public.erp_entity_records
  where company_id=v_company_id and entity='operations_classifier_assignments' and deleted_at is null;
  if v_after_inventory<>v_before_inventory or v_after_history<>v_before_history
     or v_after_classification<>v_before_classification+1 then
    raise exception 'FINISH_WORKDAY_DELETED_HISTORY_OR_INVENTORY';
  end if;
  insert into pg_temp.yield_contract_result values('HISTORY_PRESERVED',true,'PASS');
  insert into pg_temp.yield_contract_result values('INVENTORY_PRESERVED',true,'PASS');
end;
$$;

select jsonb_build_object(
  'start_workday','PASS',
  'active_workday_canonical',1,
  'classification_with_active','PASS',
  'classification_without_active','DENIED',
  'scanner_with_active','PASS',
  'scanner_without_active','DENIED',
  'scanner_workday_id','SAME_CANONICAL_UUID',
  'reception_without_workday','PASS',
  'finish_workday','PASS',
  'history_preserved','PASS',
  'inventory_preserved','PASS',
  'second_active_workday','DENIED',
  'gerencia_general_capabilities',185,
  'recepcionista_p1_capabilities',9,
  'test_actor',(select actor_mode from pg_temp.yield_actor_result limit 1),
  'fixture','ROLLBACK',
  'result',case when count(*)=10 and bool_and(passed) then 'PASS' else 'FAIL' end
) as validation_result
from pg_temp.yield_contract_result;

rollback;
