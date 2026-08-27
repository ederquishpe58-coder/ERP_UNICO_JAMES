begin;

-- Registro idempotente de comandos de Recepción, Clasificación e Inventario.
-- No reemplaza ni elimina información existente en erp_entity_records.
create table if not exists public.erp_operations_commands (
  operation_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  command_type text not null,
  source_record_id text,
  request_payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','ERROR')),
  user_id uuid not null references auth.users(id),
  device_id text not null,
  local_created_at timestamptz not null,
  server_created_at timestamptz not null default now()
);

create index if not exists erp_operations_commands_company_time_idx
  on public.erp_operations_commands(company_id, server_created_at desc);
create index if not exists erp_operations_assignments_reception_item_idx
  on public.erp_entity_records(company_id, ((payload ->> 'receptionItemId')))
  where entity = 'operations_classifier_assignments' and deleted_at is null;
create index if not exists erp_operations_results_assignment_idx
  on public.erp_entity_records(company_id, ((payload ->> 'assignmentId')))
  where entity = 'operations_classification_results' and deleted_at is null;
create index if not exists erp_operations_inventory_label_idx
  on public.erp_entity_records(company_id, (upper(regexp_replace(coalesce(payload ->> 'labelCode', ''), '\s+', '', 'g'))))
  where entity = 'operations_rose_inventory' and deleted_at is null;
create index if not exists erp_operations_inventory_stock_key_idx
  on public.erp_entity_records(company_id, ((payload ->> 'stockKey')))
  where entity = 'operations_inventory_movements' and deleted_at is null;

alter table public.erp_operations_commands enable row level security;
drop policy if exists erp_operations_commands_company_member_select on public.erp_operations_commands;
create policy erp_operations_commands_company_member_select on public.erp_operations_commands
for select to authenticated using (
  exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = erp_operations_commands.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
);

create or replace function public.erp_operations_v2_write_record(
  p_company_id uuid,
  p_operation_id uuid,
  p_device_id text,
  p_entity text,
  p_record_id text,
  p_payload jsonb,
  p_base_version bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.erp_entity_records%rowtype;
  v_saved public.erp_entity_records%rowtype;
  v_next_version bigint;
  v_now timestamptz := clock_timestamp();
  v_payload jsonb;
begin
  if nullif(btrim(p_entity), '') is null
     or nullif(btrim(p_record_id), '') is null
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'OPERATIONS_V2_RECORD_INVALID';
  end if;

  select * into v_current
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = p_entity
    and record.record_id = p_record_id
  for update;

  if found and v_current.version <> greatest(coalesce(p_base_version, 0), 0) then
    raise exception using errcode = '40001',
      message = format('OPERATIONS_V2_VERSION_CONFLICT:%s:%s:SERVER_%s:CLIENT_%s', p_entity, p_record_id, v_current.version, coalesce(p_base_version, 0));
  end if;
  if not found and coalesce(p_base_version, 0) > 0 then
    raise exception using errcode = '40001',
      message = format('OPERATIONS_V2_RECORD_MISSING:%s:%s', p_entity, p_record_id);
  end if;

  v_next_version := coalesce(v_current.version, 0) + 1;
  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'operation_id', p_operation_id::text,
    'company_id', p_company_id::text,
    'serverUpdatedAt', v_now,
    'updatedAt', to_char(v_now at time zone 'America/Guayaquil', 'YYYY-MM-DD HH24:MI:SS')
  );

  insert into public.erp_entity_records(
    company_id, entity, record_id, payload, version, created_by, updated_by,
    deleted_at, device_id, last_operation_id
  ) values (
    p_company_id, p_entity, p_record_id, v_payload, v_next_version,
    auth.uid(), auth.uid(), null, p_device_id, p_operation_id
  )
  on conflict (company_id, entity, record_id) do update set
    payload = excluded.payload,
    version = v_next_version,
    updated_at = v_now,
    updated_by = auth.uid(),
    deleted_at = null,
    device_id = p_device_id,
    last_operation_id = p_operation_id;

  select * into v_saved
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = p_entity
    and record.record_id = p_record_id;

  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.erp_operations_v2_write_record(uuid,uuid,text,text,text,jsonb,bigint) from public, anon, authenticated;

create or replace function public.erp_execute_operations_v2(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_command text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_command text := upper(btrim(coalesce(p_command, '')));
  v_existing public.erp_operations_commands%rowtype;
  v_records jsonb := coalesce(p_payload -> 'records', '[]'::jsonb);
  v_record jsonb;
  v_entity text;
  v_record_id text;
  v_allowed text[];
  v_saved jsonb;
  v_output jsonb := '[]'::jsonb;
  v_result jsonb;
  v_reception public.erp_entity_records%rowtype;
  v_assignment public.erp_entity_records%rowtype;
  v_item jsonb;
  v_assignment_row jsonb;
  v_reception_id text;
  v_reception_item_id text;
  v_assignment_id text;
  v_item_total numeric;
  v_existing_total numeric;
  v_requested_total numeric;
  v_national numeric;
  v_label_code text;
  v_source_record_id text;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'OPERATIONS_V2_COMPANY_ACCESS_DENIED';
  end if;
  if p_operation_id is null
     or nullif(btrim(p_device_id), '') is null
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(v_records) <> 'array'
     or jsonb_array_length(v_records) = 0
     or jsonb_array_length(v_records) > 100 then
    raise exception using errcode = '22023', message = 'OPERATIONS_V2_COMMAND_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing
  from public.erp_operations_commands command
  where command.operation_id = p_operation_id;
  if found then
    return v_existing.result;
  end if;

  case v_command
    when 'SAVE_RECEPTION' then
      v_allowed := array['operations_receptions','operations_classifier_assignments','operations_mesh_records','operations_mesh_history'];
      v_source_record_id := nullif(p_payload ->> 'receptionId', '');
    when 'ASSIGN_CLASSIFICATION' then
      v_allowed := array['operations_receptions','operations_classifier_assignments','operations_mesh_records','operations_mesh_history','operations_performances'];
      v_source_record_id := nullif(p_payload ->> 'deliveryGroupId', '');
    when 'REGISTER_CLASSIFICATION_RESULT' then
      v_allowed := array['operations_classification_results','operations_classifier_assignments','operations_performances'];
      v_source_record_id := nullif(p_payload ->> 'resultId', '');
    when 'REGISTER_INVENTORY_INTAKE' then
      v_allowed := array['operations_rose_inventory','operations_bunch_entries','operations_scanner_events','operations_inventory_movements','operations_performances'];
      v_source_record_id := nullif(p_payload ->> 'inventoryId', '');
    when 'UPDATE_RECEPTION_STATUS' then
      v_allowed := array['operations_receptions'];
      v_source_record_id := nullif(p_payload ->> 'receptionId', '');
    when 'UPDATE_INVENTORY_STATE' then
      v_allowed := array['operations_rose_inventory','operations_bunch_entries','operations_inventory_movements'];
      v_source_record_id := nullif(p_payload ->> 'inventoryId', '');
    else
      raise exception using errcode = '22023', message = 'OPERATIONS_V2_COMMAND_NOT_ALLOWED';
  end case;

  for v_record in select value from jsonb_array_elements(v_records)
  loop
    v_entity := nullif(btrim(v_record ->> 'entity'), '');
    v_record_id := nullif(btrim(coalesce(v_record ->> 'recordId', v_record ->> 'record_id')), '');
    if v_entity is null or v_record_id is null or not (v_entity = any(v_allowed))
       or jsonb_typeof(coalesce(v_record -> 'payload', '{}'::jsonb)) <> 'object' then
      raise exception using errcode = '22023', message = 'OPERATIONS_V2_RECORD_NOT_ALLOWED';
    end if;
  end loop;

  if v_command = 'SAVE_RECEPTION' then
    select value into v_record
    from jsonb_array_elements(v_records)
    where value ->> 'entity' = 'operations_receptions'
      and coalesce(value ->> 'recordId', value ->> 'record_id') = v_source_record_id
    limit 1;
    if v_record is null
       or nullif(btrim(v_record #>> '{payload,supplier}'), '') is null
       or nullif(btrim(v_record #>> '{payload,block}'), '') is null
       or nullif(btrim(coalesce(v_record #>> '{payload,receptionist}', v_record #>> '{payload,responsible}')), '') is null
       or jsonb_typeof(coalesce(v_record #> '{payload,items}', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_record #> '{payload,items}', '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'OPERATIONS_V2_RECEPTION_INCOMPLETE';
    end if;
    for v_item in select value from jsonb_array_elements(v_record #> '{payload,items}')
    loop
      if nullif(btrim(v_item ->> 'id'), '') is null
         or nullif(btrim(v_item ->> 'variety'), '') is null
         or coalesce((v_item ->> 'totalStems')::numeric, 0) <= 0 then
        raise exception using errcode = '22023', message = 'OPERATIONS_V2_RECEPTION_ITEM_INVALID';
      end if;
      select coalesce(sum((assignment.payload ->> 'totalStems')::numeric), 0)
      into v_existing_total
      from public.erp_entity_records assignment
      where assignment.company_id = p_company_id
        and assignment.entity = 'operations_classifier_assignments'
        and assignment.deleted_at is null
        and assignment.payload ->> 'receptionItemId' = v_item ->> 'id'
        and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO';
      if coalesce((v_item ->> 'totalStems')::numeric, 0) < v_existing_total then
        raise exception using errcode = '23514', message = 'OPERATIONS_V2_RECEPTION_BELOW_ASSIGNED_QUANTITY';
      end if;
    end loop;
  elsif v_command = 'ASSIGN_CLASSIFICATION' then
    if not exists (select 1 from jsonb_array_elements(v_records) row where row ->> 'entity' = 'operations_classifier_assignments') then
      raise exception using errcode = '22023', message = 'OPERATIONS_V2_ASSIGNMENT_REQUIRED';
    end if;
    perform 1
    from public.erp_entity_records reception
    where reception.company_id = p_company_id
      and reception.entity = 'operations_receptions'
      and reception.record_id in (
        select distinct row #>> '{payload,receptionId}'
        from jsonb_array_elements(v_records) row
        where row ->> 'entity' = 'operations_classifier_assignments'
      )
    order by reception.record_id
    for update;

    for v_assignment_row in
      select value from jsonb_array_elements(v_records)
      where value ->> 'entity' = 'operations_classifier_assignments'
    loop
      v_reception_id := v_assignment_row #>> '{payload,receptionId}';
      v_reception_item_id := v_assignment_row #>> '{payload,receptionItemId}';
      select * into v_reception
      from public.erp_entity_records reception
      where reception.company_id = p_company_id
        and reception.entity = 'operations_receptions'
        and reception.record_id = v_reception_id
        and reception.deleted_at is null;
      if not found then
        raise exception using errcode = '23503', message = 'OPERATIONS_V2_RECEPTION_NOT_FOUND';
      end if;
      select value into v_item
      from jsonb_array_elements(coalesce(v_reception.payload -> 'items', '[]'::jsonb))
      where value ->> 'id' = v_reception_item_id
      limit 1;
      if v_item is null then
        raise exception using errcode = '23503', message = 'OPERATIONS_V2_RECEPTION_ITEM_NOT_FOUND';
      end if;
      v_item_total := coalesce((v_item ->> 'totalStems')::numeric, 0);
      select coalesce(sum((assignment.payload ->> 'totalStems')::numeric), 0)
      into v_existing_total
      from public.erp_entity_records assignment
      where assignment.company_id = p_company_id
        and assignment.entity = 'operations_classifier_assignments'
        and assignment.deleted_at is null
        and assignment.payload ->> 'receptionItemId' = v_reception_item_id
        and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO';
      select coalesce(sum((row #>> '{payload,totalStems}')::numeric), 0)
      into v_requested_total
      from jsonb_array_elements(v_records) row
      where row ->> 'entity' = 'operations_classifier_assignments'
        and row #>> '{payload,receptionItemId}' = v_reception_item_id;
      if v_existing_total + v_requested_total > v_item_total then
        raise exception using errcode = '23514',
          message = format('OPERATIONS_V2_CLASSIFICATION_EXCEEDS_PENDING:%s:AVAILABLE_%s:REQUESTED_%s', v_reception_item_id, greatest(v_item_total - v_existing_total, 0), v_requested_total);
      end if;
    end loop;
  elsif v_command = 'REGISTER_CLASSIFICATION_RESULT' then
    v_assignment_id := nullif(p_payload ->> 'assignmentId', '');
    v_national := greatest(coalesce((p_payload ->> 'nationalStems')::numeric, 0), 0);
    select * into v_assignment
    from public.erp_entity_records assignment
    where assignment.company_id = p_company_id
      and assignment.entity = 'operations_classifier_assignments'
      and assignment.record_id = v_assignment_id
      and assignment.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'OPERATIONS_V2_ASSIGNMENT_NOT_FOUND';
    end if;
    select coalesce(sum((result.payload ->> 'nationalStems')::numeric), 0)
    into v_existing_total
    from public.erp_entity_records result
    where result.company_id = p_company_id
      and result.entity = 'operations_classification_results'
      and result.deleted_at is null
      and result.payload ->> 'assignmentId' = v_assignment_id;
    if v_existing_total + v_national > coalesce((v_assignment.payload ->> 'totalStems')::numeric, 0) then
      raise exception using errcode = '23514', message = 'OPERATIONS_V2_CLASSIFICATION_RESULT_EXCEEDS_ASSIGNMENT';
    end if;
  elsif v_command = 'REGISTER_INVENTORY_INTAKE' then
    v_label_code := upper(regexp_replace(coalesce(p_payload ->> 'labelCode', ''), '\s+', '', 'g'));
    if v_label_code = '' then
      raise exception using errcode = '22023', message = 'OPERATIONS_V2_LABEL_CODE_REQUIRED';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || v_label_code, 0));
    if exists (
      select 1 from public.erp_entity_records inventory
      where inventory.company_id = p_company_id
        and inventory.entity = 'operations_rose_inventory'
        and inventory.deleted_at is null
        and upper(regexp_replace(coalesce(inventory.payload ->> 'labelCode', ''), '\s+', '', 'g')) = v_label_code
    ) then
      raise exception using errcode = '23505', message = 'OPERATIONS_V2_LABEL_ALREADY_IN_INVENTORY';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_records) row where row ->> 'entity' = 'operations_rose_inventory')
       or not exists (select 1 from jsonb_array_elements(v_records) row where row ->> 'entity' = 'operations_bunch_entries')
       or not exists (select 1 from jsonb_array_elements(v_records) row where row ->> 'entity' = 'operations_scanner_events')
       or not exists (select 1 from jsonb_array_elements(v_records) row where row ->> 'entity' = 'operations_inventory_movements') then
      raise exception using errcode = '22023', message = 'OPERATIONS_V2_INVENTORY_TRANSACTION_INCOMPLETE';
    end if;
  end if;

  for v_record in select value from jsonb_array_elements(v_records)
  loop
    v_saved := public.erp_operations_v2_write_record(
      p_company_id,
      p_operation_id,
      p_device_id,
      v_record ->> 'entity',
      coalesce(v_record ->> 'recordId', v_record ->> 'record_id'),
      v_record -> 'payload',
      greatest(coalesce((v_record ->> 'baseVersion')::bigint, 0), 0)
    );
    v_output := v_output || jsonb_build_array(v_saved);
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'command', v_command,
    'operationId', p_operation_id,
    'serverTime', clock_timestamp(),
    'records', v_output,
    'result', jsonb_build_object(
      'sourceRecordId', v_source_record_id,
      'recordCount', jsonb_array_length(v_output)
    )
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, v_command, v_source_record_id, p_payload,
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

revoke all on function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) from public, anon;
grant execute on function public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz) to authenticated, service_role;

create or replace function public.erp_operations_v2_health(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'OPERATIONS_V2_COMPANY_ACCESS_DENIED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'component', 'OPERATIONS_V2',
    'migration', '202608150004',
    'companyId', p_company_id,
    'serverTime', clock_timestamp(),
    'commandsTable', to_regclass('public.erp_operations_commands') is not null,
    'executeRpc', to_regprocedure('public.erp_execute_operations_v2(uuid,uuid,text,text,jsonb,timestamptz)') is not null,
    'stockRpc', to_regprocedure('public.erp_operations_inventory_stock(uuid)') is not null
  );
end;
$$;

revoke all on function public.erp_operations_v2_health(uuid) from public, anon;
grant execute on function public.erp_operations_v2_health(uuid) to authenticated, service_role;

revoke all on table public.erp_operations_commands from public, anon, authenticated;
grant select on public.erp_operations_commands to authenticated;

-- Proyección del stock por movimientos. No almacena ni permite editar un saldo.
create or replace function public.erp_operations_inventory_stock(p_company_id uuid)
returns table (
  stock_key text,
  variety text,
  length numeric,
  quality text,
  warehouse text,
  location text,
  bunches numeric,
  stems numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    movement.payload ->> 'stockKey' as stock_key,
    max(movement.payload ->> 'variety') as variety,
    max(coalesce((movement.payload ->> 'length')::numeric, 0)) as length,
    max(movement.payload ->> 'quality') as quality,
    max(movement.payload ->> 'warehouse') as warehouse,
    max(movement.payload ->> 'location') as location,
    sum(case upper(coalesce(movement.payload ->> 'direction', ''))
      when 'IN' then coalesce((movement.payload ->> 'bunches')::numeric, 0)
      when 'OUT' then -coalesce((movement.payload ->> 'bunches')::numeric, 0)
      else 0 end) as bunches,
    sum(case upper(coalesce(movement.payload ->> 'direction', ''))
      when 'IN' then coalesce((movement.payload ->> 'stems')::numeric, 0)
      when 'OUT' then -coalesce((movement.payload ->> 'stems')::numeric, 0)
      else 0 end) as stems
  from public.erp_entity_records movement
  where movement.company_id = p_company_id
    and movement.entity = 'operations_inventory_movements'
    and movement.deleted_at is null
    and exists (
      select 1 from public.user_company_memberships membership
      where membership.company_id = p_company_id
        and membership.user_id = auth.uid()
        and membership.membership_status = 'ACTIVE'
    )
  group by movement.payload ->> 'stockKey';
$$;

revoke all on function public.erp_operations_inventory_stock(uuid) from public, anon;
grant execute on function public.erp_operations_inventory_stock(uuid) to authenticated, service_role;

-- Cierre de grants legacy revisado durante el despliegue progresivo. Supabase
-- había asignado EXECUTE explícito a anon, por lo que revocar solo PUBLIC no
-- era suficiente. Se conservan únicamente los consumidores reales.
revoke all on function public.erp_apply_offline_operation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, bigint, timestamptz
) from public, anon;
grant execute on function public.erp_apply_offline_operation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, bigint, timestamptz
) to authenticated, service_role;

revoke all on function public.erp_claim_initial_owner() from public, anon;
grant execute on function public.erp_claim_initial_owner() to authenticated, service_role;

revoke all on function public.erp_protect_server_reset_tombstone() from public, anon, authenticated;
revoke all on function public.erp_stamp_entity_record_operation() from public, anon, authenticated;
grant execute on function public.erp_protect_server_reset_tombstone() to service_role;
grant execute on function public.erp_stamp_entity_record_operation() to service_role;

revoke all on function public.erp_reset_operational_data(text) from public, anon, authenticated;
revoke all on function public.erp_reset_to_clean_start(text) from public, anon, authenticated;
grant execute on function public.erp_reset_operational_data(text) to service_role;
grant execute on function public.erp_reset_to_clean_start(text) to service_role;

revoke all on function public.erp_sync_health(uuid) from public, anon;
grant execute on function public.erp_sync_health(uuid) to authenticated, service_role;

revoke all on function public.sri_is_company_member(uuid, uuid) from public, anon;
grant execute on function public.sri_is_company_member(uuid, uuid) to authenticated, service_role;

commit;
