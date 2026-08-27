begin;

-- Imágenes del catálogo de variedades.
-- La variedad continúa siendo el registro canónico operations_varieties de
-- erp_entity_records; PostgreSQL conserva únicamente la ruta del objeto.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'variety-images',
  'variety-images',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.erp_variety_image_storage_allowed(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_object_name, ''), '/');
  v_company_id uuid;
  v_variety_id text;
  v_file_name text;
begin
  if auth.uid() is null or coalesce(array_length(v_parts, 1), 0) <> 3 then
    return false;
  end if;

  begin
    v_company_id := v_parts[1]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  v_variety_id := nullif(btrim(v_parts[2]), '');
  v_file_name := coalesce(v_parts[3], '');
  if v_variety_id is null
     or v_variety_id ~ '[/\\]'
     or v_file_name !~ '^main-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' then
    return false;
  end if;

  return exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = v_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) and exists (
    select 1
    from public.erp_entity_records variety
    where variety.company_id = v_company_id
      and variety.entity = 'operations_varieties'
      and variety.record_id = v_variety_id
      and variety.deleted_at is null
  );
end;
$$;

revoke all on function public.erp_variety_image_storage_allowed(text) from public, anon;
grant execute on function public.erp_variety_image_storage_allowed(text) to authenticated, service_role;

drop policy if exists variety_images_member_select on storage.objects;
create policy variety_images_member_select
on storage.objects for select to authenticated
using (
  bucket_id = 'variety-images'
  and public.erp_variety_image_storage_allowed(name)
);

drop policy if exists variety_images_member_insert on storage.objects;
create policy variety_images_member_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'variety-images'
  and public.erp_variety_image_storage_allowed(name)
);

drop policy if exists variety_images_member_update on storage.objects;
create policy variety_images_member_update
on storage.objects for update to authenticated
using (
  bucket_id = 'variety-images'
  and public.erp_variety_image_storage_allowed(name)
)
with check (
  bucket_id = 'variety-images'
  and public.erp_variety_image_storage_allowed(name)
);

drop policy if exists variety_images_member_delete on storage.objects;
create policy variety_images_member_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'variety-images'
  and public.erp_variety_image_storage_allowed(name)
);

revoke all on table storage.objects from anon;
grant select, insert, update, delete on table storage.objects to authenticated;

create or replace function public.erp_set_variety_image(
  p_company_id uuid,
  p_variety_id text,
  p_image_path text,
  p_operation_id uuid,
  p_device_id text,
  p_expected_version bigint,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_command public.erp_operations_commands%rowtype;
  v_variety public.erp_entity_records%rowtype;
  v_saved public.erp_entity_records%rowtype;
  v_parts text[];
  v_path text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_payload jsonb;
  v_inserted integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'VARIETY_IMAGE_COMPANY_FORBIDDEN';
  end if;

  if p_operation_id is null
     or nullif(btrim(coalesce(p_variety_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_id, '')), '') is null
     or p_expected_version is null
     or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'VARIETY_IMAGE_COMMAND_INVALID';
  end if;

  if v_path is not null then
    v_parts := string_to_array(v_path, '/');
    if coalesce(array_length(v_parts, 1), 0) <> 3
       or v_parts[1] <> p_company_id::text
       or v_parts[2] <> p_variety_id
       or v_parts[3] !~ '^main-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' then
      raise exception using errcode = '22023', message = 'VARIETY_IMAGE_PATH_INVALID';
    end if;
  end if;

  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id,
    request_payload, result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'SET_VARIETY_IMAGE', p_variety_id,
    jsonb_build_object('varietyId', p_variety_id, 'imagePath', v_path),
    '{}'::jsonb, 'CONFIRMED', auth.uid(), p_device_id,
    coalesce(p_local_created_at, now())
  ) on conflict (operation_id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing_command
  from public.erp_operations_commands command
  where command.operation_id = p_operation_id
  for update;

  if v_existing_command.company_id <> p_company_id
     or v_existing_command.command_type <> 'SET_VARIETY_IMAGE'
     or v_existing_command.source_record_id <> p_variety_id then
    raise exception using errcode = '22023', message = 'VARIETY_IMAGE_OPERATION_REUSED';
  end if;

  if v_inserted = 0 then
    return v_existing_command.result;
  end if;

  select * into v_variety
  from public.erp_entity_records variety
  where variety.company_id = p_company_id
    and variety.entity = 'operations_varieties'
    and variety.record_id = p_variety_id
    and variety.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'VARIETY_IMAGE_VARIETY_NOT_FOUND';
  end if;

  if v_variety.version <> p_expected_version then
    raise exception using errcode = '40001',
      message = format('VARIETY_IMAGE_VERSION_CONFLICT:SERVER_%s:CLIENT_%s', v_variety.version, p_expected_version);
  end if;

  v_payload := case
    when v_path is null then v_variety.payload - 'imagePath'
    else jsonb_set(v_variety.payload, '{imagePath}', to_jsonb(v_path), true)
  end;

  update public.erp_entity_records
  set payload = v_payload,
      version = v_variety.version + 1,
      updated_at = clock_timestamp(),
      updated_by = auth.uid(),
      device_id = p_device_id,
      last_operation_id = p_operation_id
  where id = v_variety.id
  returning * into v_saved;

  update public.erp_operations_commands
  set result = to_jsonb(v_saved)
  where operation_id = p_operation_id;

  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz) from public, anon;
grant execute on function public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz) to authenticated, service_role;

create or replace function public.erp_variety_images_health(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_member boolean;
begin
  select exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) into v_member;

  if auth.uid() is null or not v_member then
    raise exception using errcode = '42501', message = 'VARIETY_IMAGE_COMPANY_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'ok', true,
    'component', 'VARIETY_IMAGES',
    'migration', '202608160004',
    'bucket', exists(select 1 from storage.buckets where id = 'variety-images' and public),
    'recordTable', to_regclass('public.erp_entity_records') is not null,
    'commandTable', to_regclass('public.erp_operations_commands') is not null,
    'setImageRpc', to_regprocedure('public.erp_set_variety_image(uuid,text,text,uuid,text,bigint,timestamptz)') is not null,
    'storageGuard', to_regprocedure('public.erp_variety_image_storage_allowed(text)') is not null,
    'storagePolicies', (
      select count(*) = 4
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname in (
          'variety_images_member_select',
          'variety_images_member_insert',
          'variety_images_member_update',
          'variety_images_member_delete'
        )
    )
  );
end;
$$;

revoke all on function public.erp_variety_images_health(uuid) from public, anon;
grant execute on function public.erp_variety_images_health(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
