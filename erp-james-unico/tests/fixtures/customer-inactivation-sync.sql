-- Isolated PostgreSQL harness; sync RPC definitions captured from PROD c228bdd.
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table user_company_memberships(company_id uuid,user_id uuid,membership_status text);
create table erp_entity_records(id uuid primary key default gen_random_uuid(),company_id uuid not null,entity text not null,record_id text not null,payload jsonb not null default '{}',version bigint default 1,created_at timestamptz default now(),updated_at timestamptz default now(),created_by uuid,updated_by uuid,device_id text,last_operation_id uuid,deleted_at timestamptz,unique(company_id,entity,record_id));
create table erp_sync_operations(operation_id uuid primary key,company_id uuid,entity text,action text,record_id text,payload jsonb,base_payload jsonb,field_changes jsonb,user_id uuid,device_id text,local_created_at timestamptz,status text,last_error text,base_version bigint,result_version bigint,discarded_fields jsonb,merge_summary jsonb,server_processed_at timestamptz,server_created_at timestamptz default now(),server_ip inet,conflict_details jsonb);
create table erp_sync_field_audit(operation_id uuid,company_id uuid,entity text,record_id text,field_path text,base_value jsonb,local_value jsonb,server_value jsonb,user_id uuid,device_id text,local_created_at timestamptz);
-- Only the capability edge is mocked. The released wrapper and internal sync function below are unchanged.
create function erp_u2c3_assert_mutation_capability(text,uuid,jsonb) returns void language plpgsql as $$begin
if current_setting('test.capability',true) is distinct from 'allowed' then raise exception 'CAPABILITY_REQUIRED'; end if;
end;$$;
CREATE OR REPLACE FUNCTION public.erp_apply_offline_operation_u2c3_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_entity text, p_action text, p_record_id text, p_payload jsonb, p_base_payload jsonb, p_field_changes jsonb, p_base_version bigint, p_local_created_at timestamp with time zone)
 RETURNS TABLE(operation_id uuid, status text, result_version bigint, server_time timestamp with time zone, last_error text, conflict boolean, conflict_details jsonb, server_record jsonb, discarded_fields jsonb, merge_summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_row public.erp_entity_records%rowtype;
  existing_operation public.erp_sync_operations%rowtype;
  row_exists boolean := false;
  next_payload jsonb := '{}'::jsonb;
  next_version bigint := 1;
  normalized_action text := upper(coalesce(p_action, ''));
  change_item jsonb;
  path_tokens text[];
  path_label text;
  base_exists boolean;
  value_exists boolean;
  server_exists boolean;
  base_value jsonb;
  local_value jsonb;
  server_value jsonb;
  same_base boolean;
  applied_count integer := 0;
  discarded_count integer := 0;
  discarded jsonb := '[]'::jsonb;
  summary jsonb := '{}'::jsonb;
  processed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception 'Acceso de empresa no autorizado' using errcode = '42501';
  end if;
  if normalized_action not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'Acción de sincronización no válida' using errcode = '22023';
  end if;

  -- A generic command can persist drafts, never a posted journal.
  if p_entity = 'accounting_journal_entries' and normalized_action <> 'DELETE' then
    perform public.erp_assert_legacy_journal_draft(p_payload);
  end if;

  -- Serialize retries of the same operation before any row mutation.
  -- UUID remains globally unique: a collision in another context must be denied,
  -- never treated as a new operation in the requested company.
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'OPERATIONS_IDEMPOTENCY_ID_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into existing_operation
  from public.erp_sync_operations operation
  where operation.operation_id = p_operation_id;
  if found then
    -- Stored JSONB is the canonical request identity. Transport metadata such
    -- as device and client timestamp is not part of the business operation.
    if existing_operation.company_id is distinct from p_company_id
       or existing_operation.user_id is distinct from auth.uid()
       or existing_operation.entity is distinct from p_entity
       or existing_operation.action is distinct from normalized_action
       or existing_operation.record_id is distinct from p_record_id
       or existing_operation.payload is distinct from coalesce(p_payload, '{}'::jsonb)
       or existing_operation.base_payload is distinct from coalesce(p_base_payload, '{}'::jsonb)
       or existing_operation.field_changes is distinct from coalesce(p_field_changes, '[]'::jsonb)
       or existing_operation.base_version is distinct from coalesce(p_base_version, 0) then
      raise exception using errcode = '42501', message = 'OPERATIONS_IDEMPOTENCY_CONTEXT_MISMATCH';
    end if;
    select * into current_row
    from public.erp_entity_records record
    where record.company_id = existing_operation.company_id
      and record.entity = existing_operation.entity
      and record.record_id = existing_operation.record_id;
    return query select
      existing_operation.operation_id,
      existing_operation.status,
      existing_operation.result_version,
      coalesce(existing_operation.server_processed_at, existing_operation.server_created_at),
      existing_operation.last_error,
      existing_operation.status = 'CONFLICT',
      existing_operation.conflict_details,
      case when found then to_jsonb(current_row) else null::jsonb end,
      coalesce(existing_operation.discarded_fields, '[]'::jsonb),
      coalesce(existing_operation.merge_summary, '{}'::jsonb);
    return;
  end if;

  select * into current_row
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = p_entity
    and record.record_id = p_record_id
  for update;
  row_exists := found;

  if not row_exists then
    next_payload := coalesce(p_payload, '{}'::jsonb);
    next_version := 1;
    applied_count := greatest(jsonb_array_length(coalesce(p_field_changes, '[]'::jsonb)), 1);
    insert into public.erp_entity_records(
      company_id, entity, record_id, payload, version, created_by, updated_by, deleted_at
    ) values (
      p_company_id, p_entity, p_record_id, next_payload, next_version, auth.uid(), auth.uid(),
      case when normalized_action = 'DELETE' then processed_at else null end
    );
  elsif normalized_action = 'DELETE' then
    if current_row.version = coalesce(p_base_version, 0) then
      next_version := current_row.version + 1;
      applied_count := 1;
      update public.erp_entity_records set
        version = next_version,
        updated_at = processed_at,
        updated_by = auth.uid(),
        deleted_at = processed_at
      where id = current_row.id;
    else
      next_version := current_row.version;
      discarded_count := 1;
      discarded := jsonb_build_array(jsonb_build_object(
        'path', jsonb_build_array('$delete'),
        'base', coalesce(p_base_payload, '{}'::jsonb),
        'local', jsonb_build_object('deleted', true),
        'server', current_row.payload,
        'resolution', 'SUPABASE_NEWEST_WINS'
      ));
      insert into public.erp_sync_field_audit(
        operation_id, company_id, entity, record_id, field_path, base_value,
        local_value, server_value, user_id, device_id, local_created_at
      ) values (
        p_operation_id, p_company_id, p_entity, p_record_id, '$delete', p_base_payload,
        jsonb_build_object('deleted', true), current_row.payload, auth.uid(), p_device_id, p_local_created_at
      );
    end if;
  elsif current_row.version = coalesce(p_base_version, 0) then
    next_payload := coalesce(p_payload, '{}'::jsonb);
    next_version := current_row.version + 1;
    applied_count := greatest(jsonb_array_length(coalesce(p_field_changes, '[]'::jsonb)), 1);
    update public.erp_entity_records set
      payload = next_payload,
      version = next_version,
      updated_at = processed_at,
      updated_by = auth.uid(),
      deleted_at = null
    where id = current_row.id;
  else
    next_payload := current_row.payload;
    for change_item in select value from jsonb_array_elements(coalesce(p_field_changes, '[]'::jsonb)) loop
      select coalesce(array_agg(value), array[]::text[]) into path_tokens
      from jsonb_array_elements_text(coalesce(change_item->'path', '[]'::jsonb));
      path_label := case when cardinality(path_tokens) = 0 then '$' else array_to_string(path_tokens, '.') end;
      base_exists := coalesce((change_item->>'base_exists')::boolean, false);
      value_exists := coalesce((change_item->>'value_exists')::boolean, false);
      base_value := change_item->'base';
      local_value := change_item->'value';
      server_value := current_row.payload #> path_tokens;
      server_exists := server_value is not null;
      same_base := server_exists = base_exists and (not base_exists or server_value = base_value);

      if same_base then
        if cardinality(path_tokens) = 0 then
          next_payload := case when value_exists then coalesce(local_value, 'null'::jsonb) else '{}'::jsonb end;
        elsif value_exists then
          next_payload := jsonb_set(next_payload, path_tokens, coalesce(local_value, 'null'::jsonb), true);
        else
          next_payload := next_payload #- path_tokens;
        end if;
        applied_count := applied_count + 1;
      else
        discarded_count := discarded_count + 1;
        discarded := discarded || jsonb_build_array(jsonb_build_object(
          'path', coalesce(change_item->'path', '[]'::jsonb),
          'base', base_value,
          'local', local_value,
          'server', server_value,
          'resolution', 'SUPABASE_NEWEST_WINS'
        ));
        insert into public.erp_sync_field_audit(
          operation_id, company_id, entity, record_id, field_path, base_value,
          local_value, server_value, user_id, device_id, local_created_at
        ) values (
          p_operation_id, p_company_id, p_entity, p_record_id, path_label, base_value,
          local_value, server_value, auth.uid(), p_device_id, p_local_created_at
        );
      end if;
    end loop;

    if applied_count > 0 then
      next_version := current_row.version + 1;
      update public.erp_entity_records set
        payload = next_payload,
        version = next_version,
        updated_at = processed_at,
        updated_by = auth.uid(),
        deleted_at = null
      where id = current_row.id;
    else
      next_version := current_row.version;
    end if;
  end if;

  summary := jsonb_build_object(
    'applied_fields', applied_count,
    'discarded_fields', discarded_count,
    'rule', 'FIELD_LEVEL_MERGE_SUPABASE_NEWEST_WINS'
  );

  insert into public.erp_sync_operations(
    operation_id, company_id, entity, action, record_id, payload, base_payload,
    field_changes, user_id, device_id, local_created_at, status, last_error,
    base_version, result_version, discarded_fields, merge_summary, server_processed_at, server_ip
  ) values (
    p_operation_id, p_company_id, p_entity, normalized_action, p_record_id,
    coalesce(p_payload, '{}'::jsonb), coalesce(p_base_payload, '{}'::jsonb),
    coalesce(p_field_changes, '[]'::jsonb), auth.uid(), p_device_id, p_local_created_at,
    'SYNCED', case when discarded_count > 0 then 'Campos concurrentes conservados desde Supabase; cambio local auditado.' else null end,
    coalesce(p_base_version, 0), next_version, discarded, summary, processed_at, inet_client_addr()
  );

  select * into current_row
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = p_entity
    and record.record_id = p_record_id;

  return query select
    p_operation_id, 'SYNCED'::text, next_version, processed_at,
    case when discarded_count > 0 then 'Campos concurrentes conservados desde Supabase; cambio local auditado.' else null::text end,
    false, null::jsonb, to_jsonb(current_row), discarded, summary;
end;
$function$;
CREATE OR REPLACE FUNCTION public.erp_apply_offline_operation(p_operation_id uuid, p_company_id uuid, p_device_id text, p_entity text, p_action text, p_record_id text, p_payload jsonb, p_base_payload jsonb, p_field_changes jsonb, p_base_version bigint, p_local_created_at timestamp with time zone)
 RETURNS TABLE(operation_id uuid, status text, result_version bigint, server_time timestamp with time zone, last_error text, conflict boolean, conflict_details jsonb, server_record jsonb, discarded_fields jsonb, merge_summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
