begin;

-- Recupera los catálogos administrativos de Comercial sin tocar pedidos,
-- inventario ni el catálogo obsoleto de destinos (Países es la fuente actual).
create table if not exists jaeder_backup_20260807.erp_company_state_before_admin_catalog_restore_20260807
as table public.erp_company_state;

revoke all on table jaeder_backup_20260807.erp_company_state_before_admin_catalog_restore_20260807
from public, anon, authenticated;

create or replace function pg_temp.jaeder_merge_admin_catalog_array(
  p_backup jsonb,
  p_current jsonb,
  p_key_fields text[]
) returns jsonb
language sql
immutable
as $function$
  with source_rows as (
    select value as item, 0 as priority, ordinality::bigint as item_order
    from jsonb_array_elements(
      case when jsonb_typeof(p_backup) = 'array' then p_backup else '[]'::jsonb end
    ) with ordinality
    union all
    select value as item, 1 as priority, ordinality::bigint as item_order
    from jsonb_array_elements(
      case when jsonb_typeof(p_current) = 'array' then p_current else '[]'::jsonb end
    ) with ordinality
  ), keyed as (
    select
      item,
      priority,
      item_order,
      coalesce(
        (
          select nullif(item ->> field_name, '')
          from unnest(p_key_fields) as field_name
          where nullif(item ->> field_name, '') is not null
          limit 1
        ),
        md5(item::text)
      ) as record_key
    from source_rows
    where jsonb_typeof(item) = 'object'
  ), chosen as (
    select distinct on (record_key) item, priority, item_order
    from keyed
    order by record_key, priority desc, item_order asc
  )
  select coalesce(jsonb_agg(item order by priority desc, item_order asc), '[]'::jsonb)
  from chosen;
$function$;

do $validation$
declare
  recoverable_count bigint;
begin
  select coalesce(sum(
    jsonb_array_length(case when jsonb_typeof(state_json #> '{commercial,countryCatalog}') = 'array' then state_json #> '{commercial,countryCatalog}' else '[]'::jsonb end)
    + jsonb_array_length(case when jsonb_typeof(state_json #> '{commercial,airlineCatalog}') = 'array' then state_json #> '{commercial,airlineCatalog}' else '[]'::jsonb end)
    + jsonb_array_length(case when jsonb_typeof(state_json #> '{commercial,agencyCatalog}') = 'array' then state_json #> '{commercial,agencyCatalog}' else '[]'::jsonb end)
    + jsonb_array_length(case when jsonb_typeof(state_json #> '{commercial,daeCatalog}') = 'array' then state_json #> '{commercial,daeCatalog}' else '[]'::jsonb end)
  ), 0)
  into recoverable_count
  from jaeder_backup_20260807.erp_company_state;

  if recoverable_count = 0 then
    raise notice 'Instalación nueva: no existen catálogos administrativos históricos para restaurar.';
  end if;
end;
$validation$;

with recovered as (
  select
    current_state.company_id,
    pg_temp.jaeder_merge_admin_catalog_array(
      backup_state.state_json #> '{commercial,countryCatalog}',
      current_state.state_json #> '{commercial,countryCatalog}',
      array['id', 'code', 'name']
    ) as countries,
    pg_temp.jaeder_merge_admin_catalog_array(
      backup_state.state_json #> '{commercial,airlineCatalog}',
      current_state.state_json #> '{commercial,airlineCatalog}',
      array['id', 'code', 'name', 'awbPrefix']
    ) as airlines,
    pg_temp.jaeder_merge_admin_catalog_array(
      backup_state.state_json #> '{commercial,agencyCatalog}',
      current_state.state_json #> '{commercial,agencyCatalog}',
      array['id', 'code', 'name']
    ) as agencies,
    pg_temp.jaeder_merge_admin_catalog_array(
      backup_state.state_json #> '{commercial,daeCatalog}',
      current_state.state_json #> '{commercial,daeCatalog}',
      array['id', 'number']
    ) as daes
  from public.erp_company_state as current_state
  join jaeder_backup_20260807.erp_company_state as backup_state
    on backup_state.company_id = current_state.company_id
), next_state as (
  select
    recovered.company_id,
    coalesce(state.state_json -> 'commercial', '{}'::jsonb)
      || jsonb_build_object(
        'countryCatalog', recovered.countries,
        'airlineCatalog', recovered.airlines,
        'agencyCatalog', recovered.agencies,
        'daeCatalog', recovered.daes
      ) as recovered_commercial
  from recovered
  join public.erp_company_state as state using (company_id)
)
update public.erp_company_state as target
set
  state_json = target.state_json || jsonb_build_object('commercial', next_state.recovered_commercial),
  revision = target.revision + 1,
  updated_at = clock_timestamp()
from next_state
where target.company_id = next_state.company_id;

with catalogs(entity, state_path, key_fields) as (
  values
    ('commercial_countries'::text, array['commercial', 'countryCatalog']::text[], array['id', 'code', 'name']::text[]),
    ('commercial_airlines'::text, array['commercial', 'airlineCatalog']::text[], array['id', 'code', 'name', 'awbPrefix']::text[]),
    ('commercial_agencies'::text, array['commercial', 'agencyCatalog']::text[], array['id', 'code', 'name']::text[]),
    ('commercial_dae'::text, array['commercial', 'daeCatalog']::text[], array['id', 'number']::text[])
), catalog_rows as (
  select
    state.company_id,
    catalogs.entity,
    item,
    catalogs.key_fields
  from public.erp_company_state as state
  cross join catalogs
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(state.state_json #> catalogs.state_path) = 'array'
      then state.state_json #> catalogs.state_path else '[]'::jsonb end
  ) as item
  where jsonb_typeof(item) = 'object'
), identified as (
  select
    company_id,
    entity,
    item,
    coalesce(
      (
        select nullif(item ->> field_name, '')
        from unnest(key_fields) as field_name
        where nullif(item ->> field_name, '') is not null
        limit 1
      ),
      md5(item::text)
    ) as record_id
  from catalog_rows
)
insert into public.erp_entity_records(company_id, entity, record_id, payload, version)
select company_id, entity, record_id, item, 1
from identified
on conflict (company_id, entity, record_id) do nothing;

do $result$
declare
  recovered_rows bigint;
begin
  select count(*)
  into recovered_rows
  from public.erp_entity_records
  where entity in ('commercial_countries', 'commercial_airlines', 'commercial_agencies', 'commercial_dae')
    and deleted_at is null;

  if recovered_rows = 0 then
    raise notice 'Instalación nueva: los catálogos administrativos comienzan vacíos.';
    return;
  end if;

  raise notice 'Catálogos administrativos recuperados y publicados: % registros.', recovered_rows;
end;
$result$;

commit;
