begin;

-- Recuperación selectiva de clientes y marcas desde el respaldo tomado antes
-- del inicio limpio. No se reemplazan pedidos, inventario ni datos posteriores.
create table if not exists jaeder_backup_20260807.erp_company_state_before_catalog_restore_20260807
as table public.erp_company_state;

revoke all on table jaeder_backup_20260807.erp_company_state_before_catalog_restore_20260807
from public, anon, authenticated;

create or replace function pg_temp.jaeder_merge_recovery_array(
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
  backup_customers bigint;
  backup_brands bigint;
begin
  select
    coalesce(sum(jsonb_array_length(
      case when jsonb_typeof(state_json #> '{commercial,customerCatalog}') = 'array'
        then state_json #> '{commercial,customerCatalog}' else '[]'::jsonb end
    )), 0),
    coalesce(sum(jsonb_array_length(
      case when jsonb_typeof(state_json #> '{commercial,brandCatalog}') = 'array'
        then state_json #> '{commercial,brandCatalog}' else '[]'::jsonb end
    )), 0)
  into backup_customers, backup_brands
  from jaeder_backup_20260807.erp_company_state;

  if backup_customers + backup_brands = 0 then
    raise notice 'Instalación nueva: no existen clientes ni marcas históricos para restaurar.';
  end if;
end;
$validation$;

with recovered as (
  select
    current_state.company_id,
    pg_temp.jaeder_merge_recovery_array(
      backup_state.state_json -> 'customers',
      current_state.state_json -> 'customers',
      array['id', 'code', 'identification']
    ) as accounting_customers,
    pg_temp.jaeder_merge_recovery_array(
      backup_state.state_json #> '{commercial,customerCatalog}',
      current_state.state_json #> '{commercial,customerCatalog}',
      array['id', 'code', 'identification']
    ) as commercial_customers,
    pg_temp.jaeder_merge_recovery_array(
      backup_state.state_json #> '{commercial,brandCatalog}',
      current_state.state_json #> '{commercial,brandCatalog}',
      array['id', 'code', 'finalClientName', 'name']
    ) as commercial_brands
  from public.erp_company_state as current_state
  join jaeder_backup_20260807.erp_company_state as backup_state
    on backup_state.company_id = current_state.company_id
), next_state as (
  select
    recovered.company_id,
    jsonb_build_object('customers', recovered.accounting_customers)
      || jsonb_build_object(
        'commercial',
        coalesce(state.state_json -> 'commercial', '{}'::jsonb)
          || jsonb_build_object(
            'customerCatalog', recovered.commercial_customers,
            'brandCatalog', recovered.commercial_brands
          )
      ) as recovered_fields
  from recovered
  join public.erp_company_state as state using (company_id)
)
update public.erp_company_state as target
set
  state_json = target.state_json || next_state.recovered_fields,
  revision = target.revision + 1,
  updated_at = clock_timestamp()
from next_state
where target.company_id = next_state.company_id;

-- Publica los catálogos recuperados en la fuente incremental oficial. Si un
-- registro ya fue recreado después de la limpieza, se conserva su versión actual.
insert into public.erp_entity_records(company_id, entity, record_id, payload, version)
select
  state.company_id,
  'commercial_customers',
  coalesce(nullif(item ->> 'id', ''), nullif(item ->> 'code', ''), md5(item::text)),
  item,
  1
from public.erp_company_state as state
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(state.state_json #> '{commercial,customerCatalog}') = 'array'
    then state.state_json #> '{commercial,customerCatalog}' else '[]'::jsonb end
) as item
where jsonb_typeof(item) = 'object'
on conflict (company_id, entity, record_id) do nothing;

insert into public.erp_entity_records(company_id, entity, record_id, payload, version)
select
  state.company_id,
  'commercial_brands',
  coalesce(nullif(item ->> 'id', ''), nullif(item ->> 'code', ''), md5(item::text)),
  item,
  1
from public.erp_company_state as state
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(state.state_json #> '{commercial,brandCatalog}') = 'array'
    then state.state_json #> '{commercial,brandCatalog}' else '[]'::jsonb end
) as item
where jsonb_typeof(item) = 'object'
on conflict (company_id, entity, record_id) do nothing;

insert into public.erp_entity_records(company_id, entity, record_id, payload, version)
select
  state.company_id,
  'customers',
  coalesce(nullif(item ->> 'id', ''), nullif(item ->> 'code', ''), md5(item::text)),
  item,
  1
from public.erp_company_state as state
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(state.state_json -> 'customers') = 'array'
    then state.state_json -> 'customers' else '[]'::jsonb end
) as item
where jsonb_typeof(item) = 'object'
on conflict (company_id, entity, record_id) do nothing;

do $result$
declare
  restored_customers bigint;
  restored_brands bigint;
begin
  select count(*) filter (where entity = 'commercial_customers'),
         count(*) filter (where entity = 'commercial_brands')
  into restored_customers, restored_brands
  from public.erp_entity_records
  where deleted_at is null;

  if restored_customers + restored_brands = 0 then
    raise notice 'Instalación nueva: los catálogos comerciales comienzan vacíos.';
    return;
  end if;

  raise notice 'Catálogos recuperados: % clientes principales y % marcas/clientes finales.',
    restored_customers, restored_brands;
end;
$result$;

commit;
