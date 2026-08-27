begin;

-- FASE 3: Etiqueta, inventario y disponibilidad son conceptos separados.
-- Esta migración no elimina ni transforma registros anteriores. Las etiquetas
-- legacy se enlazan a un bunch_id UUID solamente cuando vuelven a escanearse.

create table if not exists public.erp_zebra_sequence_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  calendar_year integer not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, calendar_year)
);

create table if not exists public.erp_zebra_label_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  bunch_id uuid not null,
  label_code text not null,
  label_record_id text not null,
  status text not null default 'LABELED' check (status in ('LABELED','RECEIVED_IN_INVENTORY','ANNULLED')),
  inventory_record_id text,
  receipt_operation_id uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, bunch_id),
  unique (company_id, label_code),
  unique (company_id, label_record_id)
);

create index if not exists erp_zebra_registry_company_status_idx
  on public.erp_zebra_label_registry(company_id, status, updated_at desc);
create index if not exists erp_zebra_label_code_entity_idx
  on public.erp_entity_records(company_id, (upper(coalesce(payload ->> 'code', ''))))
  where entity = 'operations_label_batches' and deleted_at is null;
create index if not exists erp_zebra_bunch_id_entity_idx
  on public.erp_entity_records(company_id, ((payload ->> 'bunchId')))
  where entity in ('operations_bunches','operations_label_batches','operations_rose_inventory','operations_inventory_movements')
    and deleted_at is null;

-- Arranque no destructivo: el contador global comienza después del mayor
-- código canónico anterior. MAX se usa una sola vez en la migración, nunca
-- para reservar códigos durante la operación concurrente.
insert into public.erp_zebra_sequence_counters(company_id, calendar_year, last_value, updated_at)
select existing.company_id, 0, max(existing.label_code::bigint), now()
from (
  select record.company_id, record.payload ->> 'code' as label_code
  from public.erp_entity_records record
  where record.entity = 'operations_label_batches'
    and record.deleted_at is null
    and coalesce(record.payload ->> 'code', '') ~ '^\d{10}$'
  union all
  select inventory.company_id, inventory.payload ->> 'labelCode' as label_code
  from public.erp_entity_records inventory
  where inventory.entity = 'operations_rose_inventory'
    and inventory.deleted_at is null
    and coalesce(inventory.payload ->> 'labelCode', '') ~ '^\d{10}$'
) existing
group by existing.company_id
on conflict (company_id, calendar_year) do update set
  last_value = greatest(erp_zebra_sequence_counters.last_value, excluded.last_value),
  updated_at = now();

alter table public.erp_zebra_sequence_counters enable row level security;
alter table public.erp_zebra_label_registry enable row level security;

drop policy if exists erp_zebra_sequence_member_select on public.erp_zebra_sequence_counters;
create policy erp_zebra_sequence_member_select on public.erp_zebra_sequence_counters
for select to authenticated using (
  exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = erp_zebra_sequence_counters.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
);

drop policy if exists erp_zebra_registry_member_select on public.erp_zebra_label_registry;
create policy erp_zebra_registry_member_select on public.erp_zebra_label_registry
for select to authenticated using (
  exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = erp_zebra_label_registry.company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
);

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
  -- El código físico de 10 dígitos nunca se reinicia por año. El valor 0
  -- identifica el contador global de la empresa y evita reutilizar códigos.
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
  v_result jsonb;
  v_source_record_id text;
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
    if nullif(btrim(coalesce(v_label ->> 'classificationResultId', '')), '') is not null
       and not exists (
         select 1 from public.erp_entity_records result
         where result.company_id = p_company_id
           and result.entity = 'operations_classification_results'
           and result.record_id = v_label ->> 'classificationResultId'
           and result.deleted_at is null
       ) then
      raise exception using errcode = '23503', message = 'ZEBRA_V2_CLASSIFICATION_RESULT_NOT_FOUND';
    end if;
    if exists (
      select 1 from public.erp_zebra_label_registry registry
      where registry.company_id = p_company_id and registry.bunch_id = v_bunch_id
    ) then
      raise exception using errcode = '23505', message = 'ZEBRA_V2_BUNCH_ALREADY_HAS_LABEL';
    end if;

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
      'receptionId', coalesce(v_label ->> 'receptionId', ''),
      'classificationResultId', coalesce(v_label ->> 'classificationResultId', ''),
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
    jsonb_build_object('labels', p_labels), v_result, 'CONFIRMED', auth.uid(), p_device_id,
    coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

create or replace function public.erp_zebra_v2_reprint_label(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_output_type text default 'ZEBRA',
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_registry public.erp_zebra_label_registry%rowtype;
  v_label public.erp_entity_records%rowtype;
  v_saved jsonb;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_code text := upper(regexp_replace(coalesce(p_label_code, ''), '\s+', '', 'g'));
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then raise exception using errcode = '42501', message = 'ZEBRA_V2_COMPANY_ACCESS_DENIED'; end if;
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or v_code !~ '^\d{10}$' then
    raise exception using errcode = '22023', message = 'ZEBRA_V2_REPRINT_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  select * into v_registry from public.erp_zebra_label_registry registry
  where registry.company_id = p_company_id and registry.label_code = v_code for update;
  if not found or v_registry.status = 'ANNULLED' then
    raise exception using errcode = 'P0002', message = 'ZEBRA_V2_ACTIVE_LABEL_NOT_FOUND';
  end if;
  select * into v_label from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_label_batches'
    and record.record_id = v_registry.label_record_id and record.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'ZEBRA_V2_LABEL_RECORD_NOT_FOUND'; end if;
  v_saved := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_label_batches', v_label.record_id,
    v_label.payload || jsonb_build_object(
      'printedAt', v_now,
      'lastReprintedAt', v_now,
      'printCount', coalesce(nullif(v_label.payload ->> 'printCount', '')::integer, 0) + 1,
      'outputType', upper(coalesce(nullif(btrim(p_output_type), ''), 'ZEBRA')),
      'syncFlow', 'ZEBRA_V2'
    ),
    v_label.version
  );
  update public.erp_zebra_label_registry set updated_at = v_now
  where company_id = p_company_id and bunch_id = v_registry.bunch_id;
  v_result := jsonb_build_object(
    'ok', true, 'command', 'REPRINT_ZEBRA_LABEL', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', jsonb_build_array(v_saved),
    'result', jsonb_build_object('status', 'REPRINTED', 'bunchId', v_registry.bunch_id,
      'labelId', v_registry.label_record_id, 'labelCode', v_code)
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'REPRINT_ZEBRA_LABEL', v_registry.label_record_id,
    jsonb_build_object('labelCode', v_code, 'outputType', p_output_type), v_result,
    'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

create or replace function public.erp_zebra_v2_receive_bunch(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_label_code text,
  p_payload jsonb default '{}'::jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_registry public.erp_zebra_label_registry%rowtype;
  v_label public.erp_entity_records%rowtype;
  v_bunch public.erp_entity_records%rowtype;
  v_inventory public.erp_entity_records%rowtype;
  v_code text := upper(regexp_replace(coalesce(p_label_code, ''), '\s+', '', 'g'));
  v_now timestamptz := clock_timestamp();
  v_bunch_id uuid;
  v_inventory_id text;
  v_entry_id text;
  v_event_id text;
  v_movement_id text;
  v_variety text;
  v_length numeric;
  v_quality text;
  v_category text;
  v_stems numeric;
  v_inventory_state text;
  v_stock_key text;
  v_saved_bunch jsonb;
  v_saved_label jsonb;
  v_saved_inventory jsonb;
  v_saved_entry jsonb;
  v_saved_event jsonb;
  v_saved_movement jsonb;
  v_records jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then raise exception using errcode = '42501', message = 'ZEBRA_V2_COMPANY_ACCESS_DENIED'; end if;
  if p_operation_id is null or nullif(btrim(p_device_id), '') is null or v_code !~ '^\d{10}$'
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'ZEBRA_V2_RECEIPT_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.erp_operations_commands command
  where command.operation_id = p_operation_id and command.company_id = p_company_id;
  if found then return v_existing.result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || v_code, 0));

  select * into v_registry from public.erp_zebra_label_registry registry
  where registry.company_id = p_company_id and registry.label_code = v_code for update;

  if not found then
    -- Compatibilidad no destructiva: una etiqueta anterior recibe identidad
    -- UUID y registro canónico solamente al intentar un ingreso real.
    select * into v_label from public.erp_entity_records record
    where record.company_id = p_company_id and record.entity = 'operations_label_batches'
      and record.deleted_at is null and upper(coalesce(record.payload ->> 'code', '')) = v_code
    order by record.updated_at desc limit 1 for update;
    if not found then raise exception using errcode = 'P0002', message = 'ZEBRA_V2_LABEL_NOT_FOUND'; end if;
    v_bunch_id := case
      when coalesce(v_label.payload ->> 'bunchId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (v_label.payload ->> 'bunchId')::uuid
      else gen_random_uuid()
    end;
    v_saved_bunch := public.erp_operations_v2_write_record(
      p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch_id::text,
      jsonb_build_object(
        'id', v_bunch_id::text, 'bunchId', v_bunch_id::text, 'labelId', v_label.record_id,
        'labelCode', v_code, 'state', 'LABELED', 'availabilityState', 'NOT_RECEIVED',
        'available', false, 'variety', coalesce(v_label.payload ->> 'variety', ''),
        'length', coalesce(nullif(v_label.payload ->> 'length', '')::numeric, 0),
        'quality', upper(coalesce(v_label.payload ->> 'quality', v_label.payload ->> 'category', 'EXPORTACION')),
        'category', upper(coalesce(v_label.payload ->> 'category', 'EXPORTACION')),
        'stemsPerBunch', coalesce(nullif(v_label.payload ->> 'stemsPerBunch', '')::numeric, 0),
        'components', coalesce(v_label.payload -> 'composition', '[]'::jsonb),
        'labeledAt', coalesce(v_label.payload -> 'printedAt', to_jsonb(v_now)),
        'syncFlow', 'ZEBRA_V2_LEGACY_LINK'
      ), 0
    );
    insert into public.erp_zebra_label_registry(
      company_id, bunch_id, label_code, label_record_id, status, created_by, created_at, updated_at
    ) values (p_company_id, v_bunch_id, v_code, v_label.record_id, 'LABELED', auth.uid(), v_now, v_now);
    select * into v_registry from public.erp_zebra_label_registry registry
    where registry.company_id = p_company_id and registry.label_code = v_code for update;
  end if;

  select * into v_label from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_label_batches'
    and record.record_id = v_registry.label_record_id and record.deleted_at is null for update;
  select * into v_bunch from public.erp_entity_records record
  where record.company_id = p_company_id and record.entity = 'operations_bunches'
    and record.record_id = v_registry.bunch_id::text and record.deleted_at is null for update;
  if v_label.record_id is null or v_bunch.record_id is null then
    raise exception using errcode = 'P0002', message = 'ZEBRA_V2_LABEL_BUNCH_LINK_BROKEN';
  end if;
  -- Una etiqueta legacy o un ingreso confirmado previamente por la fase 004
  -- puede tener ya su único inventario físico. Ese registro gana y se enlaza;
  -- nunca se crea una segunda entrada por volver a escanear.
  select * into v_inventory
  from public.erp_entity_records inventory
  where inventory.company_id = p_company_id
    and inventory.entity = 'operations_rose_inventory'
    and inventory.deleted_at is null
    and (
      inventory.record_id = coalesce(v_registry.inventory_record_id, '')
      or inventory.payload ->> 'bunchId' = v_registry.bunch_id::text
      or upper(regexp_replace(coalesce(inventory.payload ->> 'labelCode', ''), '\s+', '', 'g')) = v_code
    )
  order by
    (inventory.record_id = coalesce(v_registry.inventory_record_id, '')) desc,
    inventory.updated_at desc
  limit 1
  for update;
  if v_registry.status = 'ANNULLED' or upper(coalesce(v_label.payload ->> 'state', '')) in ('ANULADA','ANULADO','OBSERVADA') then
    raise exception using errcode = '23514', message = 'ZEBRA_V2_LABEL_BLOCKED';
  end if;

  if v_registry.status = 'RECEIVED_IN_INVENTORY'
     or upper(coalesce(v_bunch.payload ->> 'state', '')) = 'RECEIVED_IN_INVENTORY'
     or v_inventory.record_id is not null then
    if v_inventory.record_id is not null
       and (
         v_registry.status <> 'RECEIVED_IN_INVENTORY'
         or upper(coalesce(v_bunch.payload ->> 'state', '')) <> 'RECEIVED_IN_INVENTORY'
       ) then
      v_inventory_state := upper(coalesce(nullif(v_inventory.payload ->> 'state', ''), 'DISPONIBLE'));
      v_saved_bunch := public.erp_operations_v2_write_record(
        p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch.record_id,
        v_bunch.payload || jsonb_build_object(
          'state', 'RECEIVED_IN_INVENTORY',
          'availabilityState', v_inventory_state,
          'available', v_inventory_state = 'DISPONIBLE',
          'receivedAt', coalesce(v_inventory.payload -> 'admittedAt', to_jsonb(v_now)),
          'inventoryId', v_inventory.record_id,
          'syncFlow', 'ZEBRA_V2_LEGACY_INVENTORY_LINK'
        ),
        v_bunch.version
      );
      v_saved_label := public.erp_operations_v2_write_record(
        p_company_id, p_operation_id, p_device_id, 'operations_label_batches', v_label.record_id,
        v_label.payload || jsonb_build_object(
          'bunchId', v_registry.bunch_id::text,
          'state', 'ESCANEADA',
          'scannedAt', coalesce(v_label.payload -> 'scannedAt', v_inventory.payload -> 'admittedAt', to_jsonb(v_now)),
          'inventoryId', v_inventory.record_id,
          'syncFlow', 'ZEBRA_V2_LEGACY_INVENTORY_LINK'
        ),
        v_label.version
      );
      update public.erp_zebra_label_registry set
        status = 'RECEIVED_IN_INVENTORY',
        inventory_record_id = v_inventory.record_id,
        updated_at = v_now
      where company_id = p_company_id and bunch_id = v_registry.bunch_id;
      v_registry.status := 'RECEIVED_IN_INVENTORY';
      v_registry.inventory_record_id := v_inventory.record_id;
    end if;
    select coalesce(jsonb_agg(to_jsonb(record) order by record.entity, record.record_id), '[]'::jsonb)
    into v_records
    from public.erp_entity_records record
    where record.company_id = p_company_id and record.deleted_at is null and (
      (record.entity = 'operations_bunches' and record.record_id = v_registry.bunch_id::text)
      or (record.entity = 'operations_label_batches' and record.record_id = v_registry.label_record_id)
      or (record.entity = 'operations_rose_inventory' and record.record_id = coalesce(v_inventory.record_id, v_registry.inventory_record_id))
      or (record.entity in ('operations_rose_inventory','operations_bunch_entries','operations_scanner_events','operations_inventory_movements')
          and record.payload ->> 'bunchId' = v_registry.bunch_id::text)
    );
    v_result := jsonb_build_object(
      'ok', true, 'command', 'RECEIVE_ZEBRA_BUNCH', 'operationId', p_operation_id,
      'serverTime', v_now, 'records', v_records,
      'result', jsonb_build_object('status', 'ALREADY_RECEIVED', 'bunchId', v_registry.bunch_id,
        'labelId', v_registry.label_record_id, 'labelCode', v_code,
        'inventoryId', coalesce(v_inventory.record_id, v_registry.inventory_record_id, ''))
    );
    insert into public.erp_operations_commands(
      operation_id, company_id, command_type, source_record_id, request_payload,
      result, status, user_id, device_id, local_created_at
    ) values (
      p_operation_id, p_company_id, 'RECEIVE_ZEBRA_BUNCH_ALREADY_RECEIVED', v_registry.bunch_id::text,
      jsonb_build_object('labelCode', v_code), v_result, 'CONFIRMED', auth.uid(), p_device_id,
      coalesce(p_local_created_at, now())
    );
    return v_result;
  end if;

  if upper(coalesce(v_bunch.payload ->> 'state', '')) not in ('CLASSIFIED','LABELED') then
    raise exception using errcode = '23514', message = 'ZEBRA_V2_BUNCH_STATE_NOT_ALLOWED';
  end if;
  if coalesce(v_label.payload ->> 'bunchId', v_registry.bunch_id::text) <> v_registry.bunch_id::text then
    raise exception using errcode = '23514', message = 'ZEBRA_V2_LABEL_BUNCH_MISMATCH';
  end if;

  v_bunch_id := v_registry.bunch_id;
  v_variety := upper(btrim(coalesce(v_bunch.payload ->> 'variety', v_label.payload ->> 'variety', '')));
  v_length := coalesce(nullif(v_bunch.payload ->> 'length', '')::numeric, nullif(v_label.payload ->> 'length', '')::numeric, 0);
  v_quality := upper(btrim(coalesce(v_bunch.payload ->> 'quality', v_label.payload ->> 'quality', v_label.payload ->> 'category', 'EXPORTACION')));
  v_category := upper(btrim(coalesce(v_bunch.payload ->> 'category', v_label.payload ->> 'category', 'EXPORTACION')));
  v_stems := coalesce(nullif(v_bunch.payload ->> 'stemsPerBunch', '')::numeric, nullif(v_label.payload ->> 'stemsPerBunch', '')::numeric, 0);
  if v_variety = '' or v_length <= 0 or v_stems <= 0 then
    raise exception using errcode = '22023', message = 'ZEBRA_V2_BUNCH_DATA_INVALID';
  end if;
  v_inventory_state := case when nullif(coalesce(v_label.payload ->> 'localDestinationCustomerId', ''), '') is null
    then 'DISPONIBLE' else 'ASIGNADO_LOCAL' end;
  v_stock_key := concat_ws('|', v_variety, v_length::text, v_quality, 'PENDIENTE UBICACION', 'PENDIENTE UBICACION');
  v_inventory_id := gen_random_uuid()::text;
  v_entry_id := gen_random_uuid()::text;
  v_event_id := gen_random_uuid()::text;
  v_movement_id := gen_random_uuid()::text;

  v_saved_bunch := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_bunches', v_bunch.record_id,
    v_bunch.payload || jsonb_build_object(
      'state', 'RECEIVED_IN_INVENTORY', 'availabilityState', v_inventory_state,
      'available', v_inventory_state = 'DISPONIBLE', 'receivedAt', v_now,
      'inventoryId', v_inventory_id, 'syncFlow', 'ZEBRA_V2'
    ), v_bunch.version
  );
  v_saved_label := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_label_batches', v_label.record_id,
    v_label.payload || jsonb_build_object(
      'bunchId', v_bunch_id::text, 'state', 'ESCANEADA', 'scannedAt', v_now,
      'inventoryId', v_inventory_id, 'syncFlow', 'ZEBRA_V2'
    ), v_label.version
  );
  v_saved_inventory := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_rose_inventory', v_inventory_id,
    jsonb_build_object(
      'id', v_inventory_id, 'inventoryId', v_inventory_id, 'bunchId', v_bunch_id::text,
      'date', to_char(v_now at time zone 'America/Guayaquil', 'YYYY-MM-DD'), 'admittedAt', v_now,
      'labelCode', v_code, 'variety', v_variety, 'length', v_length, 'quality', v_quality,
      'category', v_category, 'stemsPerBunch', v_stems, 'bunches', 1, 'stems', v_stems,
      'warehouse', 'PENDIENTE UBICACION', 'location', 'PENDIENTE UBICACION',
      'supplier', coalesce(v_label.payload ->> 'supplier', ''), 'block', coalesce(v_label.payload ->> 'block', ''),
      'buncher', coalesce(v_label.payload ->> 'buncher', ''),
      'buncherEmployeeId', coalesce(v_label.payload ->> 'buncherEmployeeId', ''),
      'responsible', coalesce(p_payload ->> 'responsible', ''), 'state', v_inventory_state,
      'composition', coalesce(v_label.payload -> 'components', v_label.payload -> 'composition', '[]'::jsonb),
      'sourceType', 'ESCANEO_ETIQUETA', 'sourceLabelId', v_label.record_id,
      'sourceBunchEntryId', v_entry_id, 'sourceScannerEventId', v_event_id,
      'stockKey', v_stock_key, 'syncFlow', 'ZEBRA_V2'
    ), 0
  );
  v_saved_entry := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_bunch_entries', v_entry_id,
    jsonb_build_object(
      'id', v_entry_id, 'bunchId', v_bunch_id::text, 'code', v_code,
      'date', to_char(v_now at time zone 'America/Guayaquil', 'YYYY-MM-DD'), 'registeredAt', v_now,
      'labelId', v_label.record_id, 'inventoryId', v_inventory_id, 'variety', v_variety,
      'length', v_length, 'quality', v_quality, 'stemsPerBunch', v_stems,
      'supplier', coalesce(v_label.payload ->> 'supplier', ''), 'block', coalesce(v_label.payload ->> 'block', ''),
      'buncher', coalesce(v_label.payload ->> 'buncher', ''), 'responsible', coalesce(p_payload ->> 'responsible', ''),
      'state', 'INGRESADO_POR_ESCANEO', 'intakeState', 'INGRESADO_POR_ESCANEO',
      'admissionSource', 'ESCANEO_ETIQUETA', 'operationalState', v_inventory_state,
      'composition', coalesce(v_label.payload -> 'components', v_label.payload -> 'composition', '[]'::jsonb),
      'syncFlow', 'ZEBRA_V2'
    ), 0
  );
  v_saved_event := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_scanner_events', v_event_id,
    jsonb_build_object(
      'id', v_event_id, 'eventId', v_event_id, 'operationId', p_operation_id::text,
      'bunchId', v_bunch_id::text, 'dateTime', v_now, 'code', v_code, 'type', 'RAMO',
      'moduleOrigin', 'Ingreso de ramos por escáner', 'result', 'INVENTARIO_CREADO',
      'inventoryId', v_inventory_id, 'labelId', v_label.record_id,
      'observation', coalesce(nullif(p_payload ->> 'observation', ''), 'Primer escaneo confirmado por el servidor.'),
      'syncFlow', 'ZEBRA_V2'
    ), 0
  );
  v_saved_movement := public.erp_operations_v2_write_record(
    p_company_id, p_operation_id, p_device_id, 'operations_inventory_movements', v_movement_id,
    jsonb_build_object(
      'id', v_movement_id, 'operationId', p_operation_id::text, 'bunchId', v_bunch_id::text,
      'date', to_char(v_now at time zone 'America/Guayaquil', 'YYYY-MM-DD'), 'dateTime', v_now,
      'movementType', 'BUNCH_RECEIPT', 'direction', 'IN', 'sourceEntity', 'operations_bunch_entries',
      'sourceId', v_entry_id, 'inventoryId', v_inventory_id, 'labelCode', v_code,
      'variety', v_variety, 'length', v_length, 'quality', v_quality,
      'warehouse', 'PENDIENTE UBICACION', 'location', 'PENDIENTE UBICACION',
      'stockKey', v_stock_key, 'bunches', 1, 'stems', v_stems,
      'availabilityDeltaBunches', case when v_inventory_state = 'DISPONIBLE' then 1 else 0 end,
      'availabilityDeltaStems', case when v_inventory_state = 'DISPONIBLE' then v_stems else 0 end,
      'observation', 'Entrada inicial creada exclusivamente por el primer escaneo válido.',
      'syncFlow', 'ZEBRA_V2'
    ), 0
  );
  v_records := jsonb_build_array(v_saved_bunch, v_saved_label, v_saved_inventory, v_saved_entry, v_saved_event, v_saved_movement);
  update public.erp_zebra_label_registry set
    status = 'RECEIVED_IN_INVENTORY', inventory_record_id = v_inventory_id,
    receipt_operation_id = p_operation_id, updated_at = v_now
  where company_id = p_company_id and bunch_id = v_bunch_id;
  v_result := jsonb_build_object(
    'ok', true, 'command', 'RECEIVE_ZEBRA_BUNCH', 'operationId', p_operation_id,
    'serverTime', v_now, 'records', v_records,
    'result', jsonb_build_object('status', 'RECEIVED_IN_INVENTORY', 'bunchId', v_bunch_id,
      'labelId', v_label.record_id, 'labelCode', v_code, 'inventoryId', v_inventory_id,
      'movementId', v_movement_id)
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'RECEIVE_ZEBRA_BUNCH', v_bunch_id::text,
    jsonb_build_object('labelCode', v_code, 'payload', p_payload), v_result,
    'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

-- Disponibilidad es una consulta derivada. No existe tabla editable de saldos.
create or replace function public.erp_zebra_v2_availability(p_company_id uuid)
returns table (
  stock_key text,
  variety text,
  length numeric,
  quality text,
  physical_bunches numeric,
  physical_stems numeric,
  reserved_bunches numeric,
  packed_bunches numeric,
  blocked_bunches numeric,
  available_bunches numeric,
  available_stems numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with inventory_rows as (
    select
      inventory.record_id,
      inventory.payload,
      coalesce(
        nullif(inventory.payload ->> 'stockKey', ''),
        concat_ws('|',
          upper(btrim(coalesce(inventory.payload ->> 'variety', ''))),
          coalesce(nullif(inventory.payload ->> 'length', '')::numeric, 0)::text,
          upper(btrim(coalesce(inventory.payload ->> 'quality', inventory.payload ->> 'category', 'EXPORTACION'))),
          upper(btrim(coalesce(nullif(inventory.payload ->> 'warehouse', ''), 'PENDIENTE UBICACION'))),
          upper(btrim(coalesce(nullif(inventory.payload ->> 'location', ''), 'PENDIENTE UBICACION')))
        )
      ) as stock_key
    from public.erp_entity_records inventory
    where inventory.company_id = p_company_id
      and inventory.entity = 'operations_rose_inventory'
      and inventory.deleted_at is null
  ), movement_stock as (
    select
      movement.payload ->> 'stockKey' as stock_key,
      max(movement.payload ->> 'variety') as variety,
      max(coalesce(nullif(movement.payload ->> 'length', '')::numeric, 0)) as length,
      max(coalesce(movement.payload ->> 'quality', 'EXPORTACION')) as quality,
      sum(case upper(coalesce(movement.payload ->> 'direction', ''))
        when 'IN' then coalesce(nullif(movement.payload ->> 'bunches', '')::numeric, 0)
        when 'OUT' then -coalesce(nullif(movement.payload ->> 'bunches', '')::numeric, 0)
        else 0 end) as physical_bunches,
      sum(case upper(coalesce(movement.payload ->> 'direction', ''))
        when 'IN' then coalesce(nullif(movement.payload ->> 'stems', '')::numeric, 0)
        when 'OUT' then -coalesce(nullif(movement.payload ->> 'stems', '')::numeric, 0)
        else 0 end) as physical_stems
    from public.erp_entity_records movement
    where movement.company_id = p_company_id
      and movement.entity = 'operations_inventory_movements'
      and movement.deleted_at is null
      and nullif(movement.payload ->> 'stockKey', '') is not null
    group by movement.payload ->> 'stockKey'
  ), legacy_inventory_stock as (
    -- Los ingresos anteriores a V2 no tenían movimiento canónico. Se cuentan
    -- desde su único registro físico solamente mientras no exista un IN que ya
    -- los represente, evitando tanto pérdida como doble conteo.
    select
      inventory.stock_key,
      max(inventory.payload ->> 'variety') as variety,
      max(coalesce(nullif(inventory.payload ->> 'length', '')::numeric, 0)) as length,
      max(upper(coalesce(inventory.payload ->> 'quality', inventory.payload ->> 'category', 'EXPORTACION'))) as quality,
      sum(coalesce(nullif(inventory.payload ->> 'bunches', '')::numeric, 1)) as physical_bunches,
      sum(coalesce(nullif(inventory.payload ->> 'stems', '')::numeric,
        nullif(inventory.payload ->> 'stemsPerBunch', '')::numeric, 0)) as physical_stems
    from inventory_rows inventory
    where not exists (
      select 1
      from public.erp_entity_records movement
      where movement.company_id = p_company_id
        and movement.entity = 'operations_inventory_movements'
        and movement.deleted_at is null
        and upper(coalesce(movement.payload ->> 'direction', '')) = 'IN'
        and (
          movement.payload ->> 'inventoryId' = inventory.record_id
          or (
            nullif(inventory.payload ->> 'bunchId', '') is not null
            and movement.payload ->> 'bunchId' = inventory.payload ->> 'bunchId'
          )
        )
    )
    group by inventory.stock_key
  ), physical_stock as (
    select
      combined.stock_key,
      max(combined.variety) as variety,
      max(combined.length) as length,
      max(combined.quality) as quality,
      sum(combined.physical_bunches) as physical_bunches,
      sum(combined.physical_stems) as physical_stems
    from (
      select * from movement_stock
      union all
      select * from legacy_inventory_stock
    ) combined
    group by combined.stock_key
  ), inventory_states as (
    select
      inventory.stock_key,
      sum(case when upper(coalesce(inventory.payload ->> 'state', '')) in ('RESERVADO','RESERVED') then 1 else 0 end) as reserved_bunches,
      sum(case when upper(coalesce(inventory.payload ->> 'state', '')) in ('ASIGNADO_CAJA','EMPACADO','PACKED') then 1 else 0 end) as packed_bunches,
      sum(case when upper(coalesce(inventory.payload ->> 'state', '')) in ('OBSERVADO','VENCIDO','BLOQUEADO','ANULADO') then 1 else 0 end) as blocked_bunches,
      sum(case when upper(coalesce(inventory.payload ->> 'state', '')) = 'DISPONIBLE' then 1 else 0 end) as available_bunches,
      sum(case when upper(coalesce(inventory.payload ->> 'state', '')) = 'DISPONIBLE'
        then coalesce(nullif(inventory.payload ->> 'stems', '')::numeric, nullif(inventory.payload ->> 'stemsPerBunch', '')::numeric, 0)
        else 0 end) as available_stems
    from inventory_rows inventory
    group by inventory.stock_key
  )
  select
    stock.stock_key, stock.variety, stock.length, stock.quality,
    stock.physical_bunches, stock.physical_stems,
    coalesce(states.reserved_bunches, 0), coalesce(states.packed_bunches, 0),
    coalesce(states.blocked_bunches, 0),
    least(greatest(stock.physical_bunches, 0), coalesce(states.available_bunches, 0)),
    least(greatest(stock.physical_stems, 0), coalesce(states.available_stems, 0))
  from physical_stock stock
  left join inventory_states states using (stock_key)
  where exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  )
  order by stock.variety, stock.length, stock.quality;
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
revoke all on function public.erp_zebra_v2_reprint_label(uuid,uuid,text,text,text,timestamptz) from public, anon;
revoke all on function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) from public, anon;
revoke all on function public.erp_zebra_v2_availability(uuid) from public, anon;
revoke all on function public.erp_zebra_v2_health(uuid) from public, anon;
grant execute on function public.erp_zebra_v2_create_labels(uuid,uuid,text,jsonb,timestamptz) to authenticated, service_role;
grant execute on function public.erp_zebra_v2_reprint_label(uuid,uuid,text,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.erp_zebra_v2_receive_bunch(uuid,uuid,text,text,jsonb,timestamptz) to authenticated, service_role;
grant execute on function public.erp_zebra_v2_availability(uuid) to authenticated, service_role;
grant execute on function public.erp_zebra_v2_health(uuid) to authenticated, service_role;
revoke all on table public.erp_zebra_sequence_counters from anon, authenticated;
revoke all on table public.erp_zebra_label_registry from anon, authenticated;
grant select on public.erp_zebra_sequence_counters to authenticated;
grant select on public.erp_zebra_label_registry to authenticated;

commit;
