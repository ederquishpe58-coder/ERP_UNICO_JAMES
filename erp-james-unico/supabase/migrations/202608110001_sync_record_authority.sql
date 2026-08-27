begin;

-- Metadatos de autoridad por registro. Esta migración no copia ni elimina
-- información empresarial; únicamente identifica la última operación que el
-- servidor confirmó para cada registro lógico.
alter table public.erp_entity_records
  add column if not exists device_id text,
  add column if not exists last_operation_id uuid;

create index if not exists erp_entity_records_incremental_cursor_idx
  on public.erp_entity_records(company_id, updated_at, id);

create index if not exists erp_entity_records_last_operation_idx
  on public.erp_entity_records(last_operation_id)
  where last_operation_id is not null;

create or replace function public.erp_stamp_entity_record_operation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'SYNCED' and new.result_version is not null then
    update public.erp_entity_records record
       set device_id = new.device_id,
           last_operation_id = new.operation_id
     where record.company_id = new.company_id
       and record.entity = new.entity
       and record.record_id = new.record_id
       and record.version = new.result_version
       and record.last_operation_id is distinct from new.operation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists erp_sync_operation_stamp_record on public.erp_sync_operations;
create trigger erp_sync_operation_stamp_record
after insert or update of status, result_version
on public.erp_sync_operations
for each row
execute function public.erp_stamp_entity_record_operation();

-- Completa metadatos históricos con la operación confirmada más reciente que
-- coincide con la versión vigente. No modifica payload, version ni updated_at.
with latest_operation as (
  select distinct on (operation.company_id, operation.entity, operation.record_id)
    operation.company_id,
    operation.entity,
    operation.record_id,
    operation.operation_id,
    operation.device_id,
    operation.result_version
  from public.erp_sync_operations operation
  where operation.status = 'SYNCED'
    and operation.result_version is not null
  order by
    operation.company_id,
    operation.entity,
    operation.record_id,
    operation.server_processed_at desc nulls last,
    operation.server_created_at desc
)
update public.erp_entity_records record
   set device_id = latest.device_id,
       last_operation_id = latest.operation_id
  from latest_operation latest
 where record.company_id = latest.company_id
   and record.entity = latest.entity
   and record.record_id = latest.record_id
   and record.version = latest.result_version
   and record.last_operation_id is null;

commit;
