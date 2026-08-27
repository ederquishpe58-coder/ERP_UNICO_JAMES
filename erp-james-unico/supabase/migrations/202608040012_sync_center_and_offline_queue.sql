begin;

-- BORRADOR LOCAL: no aplicar hasta autorizar la publicación en Supabase.
-- Fuente oficial incremental por empresa y registro lógico.
create table if not exists public.erp_entity_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity text not null,
  record_id text not null,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  constraint erp_entity_records_company_entity_record_key unique (company_id, entity, record_id)
);

create table if not exists public.erp_sync_operations (
  operation_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  entity text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  record_id text not null,
  payload jsonb not null default '{}'::jsonb,
  user_id uuid not null references auth.users(id),
  device_id text not null,
  local_created_at timestamptz not null,
  attempts integer not null default 1,
  status text not null check (status in ('PENDING','SYNCING','SYNCED','ERROR','CONFLICT')),
  last_error text,
  base_version bigint not null default 0,
  result_version bigint,
  conflict_details jsonb,
  server_created_at timestamptz not null default now(),
  server_processed_at timestamptz,
  server_ip inet default null
);

create index if not exists erp_entity_records_incremental_idx
  on public.erp_entity_records(company_id, updated_at, id);
create index if not exists erp_entity_records_active_idx
  on public.erp_entity_records(company_id, entity, record_id) where deleted_at is null;
create index if not exists erp_sync_operations_review_idx
  on public.erp_sync_operations(company_id, status, server_created_at desc);

alter table public.erp_entity_records enable row level security;
alter table public.erp_sync_operations enable row level security;

drop policy if exists erp_entity_records_company_member_select on public.erp_entity_records;
create policy erp_entity_records_company_member_select on public.erp_entity_records
for select to authenticated using (
  exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = erp_entity_records.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
);

drop policy if exists erp_sync_operations_company_member_select on public.erp_sync_operations;
create policy erp_sync_operations_company_member_select on public.erp_sync_operations
for select to authenticated using (
  exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = erp_sync_operations.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
);

create or replace function public.erp_apply_offline_operation(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_entity text,
  p_action text,
  p_record_id text,
  p_payload jsonb,
  p_base_version bigint,
  p_local_created_at timestamptz
) returns table (
  operation_id uuid,
  status text,
  result_version bigint,
  server_time timestamptz,
  last_error text,
  conflict boolean,
  conflict_details jsonb
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_row public.erp_entity_records%rowtype;
  existing_operation public.erp_sync_operations%rowtype;
  next_version bigint;
  detail jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception 'Acceso de empresa no autorizado' using errcode = '42501';
  end if;

  select * into existing_operation from public.erp_sync_operations operation
  where operation.operation_id = p_operation_id;
  if found then
    return query select existing_operation.operation_id, existing_operation.status,
      existing_operation.result_version, coalesce(existing_operation.server_processed_at, existing_operation.server_created_at),
      existing_operation.last_error, existing_operation.status = 'CONFLICT', existing_operation.conflict_details;
    return;
  end if;

  select * into current_row from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = p_entity and record.record_id = p_record_id
  for update;

  if found and current_row.version <> coalesce(p_base_version, 0) then
    detail := jsonb_build_object(
      'message', 'Supabase contiene una versión más reciente.',
      'local_payload', coalesce(p_payload, '{}'::jsonb),
      'server_record', to_jsonb(current_row)
    );
    insert into public.erp_sync_operations(
      operation_id, company_id, entity, action, record_id, payload, user_id, device_id,
      local_created_at, status, last_error, base_version, result_version, conflict_details, server_processed_at
    ) values (
      p_operation_id, p_company_id, p_entity, upper(p_action), p_record_id, coalesce(p_payload, '{}'::jsonb),
      auth.uid(), p_device_id, p_local_created_at, 'CONFLICT', 'Supabase contiene una versión más reciente.',
      coalesce(p_base_version, 0), current_row.version, detail, now()
    );
    return query select p_operation_id, 'CONFLICT'::text, current_row.version, now(),
      'Supabase contiene una versión más reciente.'::text, true, detail;
    return;
  end if;

  next_version := coalesce(current_row.version, 0) + 1;
  insert into public.erp_entity_records(
    company_id, entity, record_id, payload, version, created_by, updated_by, deleted_at
  ) values (
    p_company_id, p_entity, p_record_id, coalesce(p_payload, '{}'::jsonb), next_version,
    auth.uid(), auth.uid(), case when upper(p_action) = 'DELETE' then now() else null end
  ) on conflict (company_id, entity, record_id) do update set
    payload = excluded.payload,
    version = next_version,
    updated_at = now(),
    updated_by = auth.uid(),
    deleted_at = excluded.deleted_at;

  insert into public.erp_sync_operations(
    operation_id, company_id, entity, action, record_id, payload, user_id, device_id,
    local_created_at, status, base_version, result_version, server_processed_at
  ) values (
    p_operation_id, p_company_id, p_entity, upper(p_action), p_record_id, coalesce(p_payload, '{}'::jsonb),
    auth.uid(), p_device_id, p_local_created_at, 'SYNCED', coalesce(p_base_version, 0), next_version, now()
  );
  return query select p_operation_id, 'SYNCED'::text, next_version, now(), null::text, false, null::jsonb;
end;
$$;

revoke all on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,bigint,timestamptz) from public;
grant execute on function public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,bigint,timestamptz) to authenticated;
grant select on public.erp_entity_records, public.erp_sync_operations to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='erp_entity_records') then
    alter publication supabase_realtime add table public.erp_entity_records;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='erp_sync_operations') then
    alter publication supabase_realtime add table public.erp_sync_operations;
  end if;
end $$;

commit;
