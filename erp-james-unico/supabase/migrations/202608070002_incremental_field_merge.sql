begin;

-- Sincronización oficial por registro y por campo. El snapshot de empresa queda
-- únicamente como respaldo y no participa en la resolución de concurrencia.
alter table public.erp_sync_operations
  add column if not exists base_payload jsonb not null default '{}'::jsonb,
  add column if not exists field_changes jsonb not null default '[]'::jsonb,
  add column if not exists discarded_fields jsonb not null default '[]'::jsonb,
  add column if not exists merge_summary jsonb not null default '{}'::jsonb;

create table if not exists public.erp_sync_field_audit (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  entity text not null,
  record_id text not null,
  field_path text not null,
  base_value jsonb,
  local_value jsonb,
  server_value jsonb,
  resolution text not null default 'SUPABASE_NEWEST_WINS',
  user_id uuid not null references auth.users(id),
  device_id text not null,
  local_created_at timestamptz,
  server_created_at timestamptz not null default now()
);

create index if not exists erp_sync_field_audit_record_idx
  on public.erp_sync_field_audit(company_id, entity, record_id, server_created_at desc);
create index if not exists erp_sync_field_audit_operation_idx
  on public.erp_sync_field_audit(operation_id);

alter table public.erp_sync_field_audit enable row level security;
drop policy if exists erp_sync_field_audit_company_member_select on public.erp_sync_field_audit;
create policy erp_sync_field_audit_company_member_select on public.erp_sync_field_audit
for select to authenticated using (
  exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = erp_sync_field_audit.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
);

drop function if exists public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,bigint,timestamptz);

create or replace function public.erp_apply_offline_operation(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_entity text,
  p_action text,
  p_record_id text,
  p_payload jsonb,
  p_base_payload jsonb,
  p_field_changes jsonb,
  p_base_version bigint,
  p_local_created_at timestamptz
) returns table (
  operation_id uuid,
  status text,
  result_version bigint,
  server_time timestamptz,
  last_error text,
  conflict boolean,
  conflict_details jsonb,
  server_record jsonb,
  discarded_fields jsonb,
  merge_summary jsonb
) language plpgsql security definer set search_path = public, pg_temp as $$
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

  select * into existing_operation
  from public.erp_sync_operations operation
  where operation.operation_id = p_operation_id;
  if found then
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
$$;

revoke all on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) from public;
grant execute on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamptz) to authenticated;
grant select on public.erp_sync_field_audit to authenticated;

commit;
