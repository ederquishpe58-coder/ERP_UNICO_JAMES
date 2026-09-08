-- Forward-only extension of the status-only customer exception. No business row updates.
create or replace function public.erp_commercial_catalog_unique_fields(p_entity text)
returns text[] language sql immutable strict set search_path=public,pg_temp as $f$
select case p_entity
 when 'commercial_customers' then array['code','identification']
 when 'commercial_brands' then array['code']
 when 'commercial_airlines' then array['code','awbPrefix']
 when 'commercial_agencies' then array['code','name']
 when 'commercial_dae' then array['number']
 else null::text[] end
$f$;
revoke all on function public.erp_commercial_catalog_unique_fields(text) from public,anon,authenticated;

create or replace function public.erp_commercial_catalog_identity_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $f$
declare
 fields text[]; field text; target text; retained boolean := true; reactivating boolean := false;
begin
 fields := public.erp_commercial_catalog_unique_fields(new.entity);
 if TG_OP='INSERT' and new.payload->>'id' is distinct from new.record_id then raise exception 'COMMERCIAL_CATALOG_IDENTITY_SCOPE_IMMUTABLE'; end if;
 if TG_OP='UPDATE' then
  if new.id is distinct from old.id or new.company_id is distinct from old.company_id
    or new.entity is distinct from old.entity or new.record_id is distinct from old.record_id
    or new.payload->'id' is distinct from old.payload->'id' then
   raise exception 'COMMERCIAL_CATALOG_IDENTITY_SCOPE_IMMUTABLE';
  end if;
  if new.payload is not distinct from old.payload and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  reactivating := upper(coalesce(old.payload->>'status','')) in ('INACTIVO','INACTIVA','INACTIVE')
    and upper(coalesce(new.payload->>'status','')) not in ('INACTIVO','INACTIVA','INACTIVE');
  foreach field in array fields loop
   retained := retained and (new.payload->field is not distinct from old.payload->field);
  end loop;
  if retained and not reactivating and old.deleted_at is null and new.deleted_at is null then return new; end if;
 end if;
 if new.deleted_at is not null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('commercial_catalog_identity:'||new.company_id::text||':'||new.entity,0));
 foreach field in array fields loop
  target := btrim(coalesce(new.payload->>field,''));
  if field <> 'identification' then target := upper(target); end if;
  if target <> '' and exists(select 1 from public.erp_entity_records r
    where r.company_id=new.company_id and r.entity=new.entity and r.deleted_at is null and r.record_id<>new.record_id
      and (case when field='identification' then btrim(coalesce(r.payload->>field,''))
        else upper(btrim(coalesce(r.payload->>field,''))) end)=target) then
   raise exception using errcode='23505', message='Ya existe otro registro de esta empresa con ese código / identificador ('||field||'). Resuelva el conflicto antes de crear, cambiar la identidad o reactivar.',
      detail='COMMERCIAL_CATALOG_DUPLICATE:'||new.entity||':'||field;
  end if;
 end loop;
 return new;
end;
$f$;
revoke all on function public.erp_commercial_catalog_identity_guard() from public,anon,authenticated;

drop trigger if exists erp_customer_identity_insert_guard on public.erp_entity_records;
drop trigger if exists erp_customer_identity_update_guard on public.erp_entity_records;
drop trigger if exists erp_commercial_catalog_identity_insert_guard on public.erp_entity_records;
create trigger erp_commercial_catalog_identity_insert_guard before insert on public.erp_entity_records
 for each row when(new.entity in ('commercial_customers','commercial_brands','commercial_airlines','commercial_agencies','commercial_dae')) execute function public.erp_commercial_catalog_identity_guard();
drop trigger if exists erp_commercial_catalog_identity_update_guard on public.erp_entity_records;
create trigger erp_commercial_catalog_identity_update_guard before update of id,company_id,entity,record_id,payload,deleted_at on public.erp_entity_records
 for each row when(old.entity in ('commercial_customers','commercial_brands','commercial_airlines','commercial_agencies','commercial_dae') or new.entity in ('commercial_customers','commercial_brands','commercial_airlines','commercial_agencies','commercial_dae')) execute function public.erp_commercial_catalog_identity_guard();

CREATE OR REPLACE FUNCTION public.erp_apply_offline_operation(p_operation_id uuid, p_company_id uuid, p_device_id text, p_entity text, p_action text, p_record_id text, p_payload jsonb, p_base_payload jsonb, p_field_changes jsonb, p_base_version bigint, p_local_created_at timestamp with time zone)
 RETURNS TABLE(operation_id uuid, status text, result_version bigint, server_time timestamp with time zone, last_error text, conflict boolean, conflict_details jsonb, server_record jsonb, discarded_fields jsonb, merge_summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare catalog_row public.erp_entity_records%rowtype;
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_apply_offline_operation',p_company_id,
    jsonb_build_object('entity',p_entity,'action',p_action,'record_id',p_record_id,'payload',coalesce(p_payload,'{}'::jsonb))
  );
  -- Guard the existing write RPC, before its field-merge implementation. Retries of
  -- already committed operation IDs retain the original canonical idempotency checks.
  if public.erp_commercial_catalog_unique_fields(p_entity) is not null
     and upper(p_action) in ('INSERT','UPDATE') then
    perform pg_advisory_xact_lock(hashtextextended('commercial_catalog_identity:'||p_company_id::text||':'||p_entity,0));
    -- Recheck after the company/entity lock: a concurrent identical retry may have committed.
    if not exists(select 1 from public.erp_sync_operations o where o.operation_id=p_operation_id) then
    select * into catalog_row from public.erp_entity_records r
      where r.company_id=p_company_id and r.entity=p_entity and r.record_id=p_record_id for update;
    if (found and (catalog_row.version is distinct from p_base_version or catalog_row.deleted_at is not null))
      or (not found and coalesce(p_base_version,0)<>0) then
      raise exception using errcode='40001',message='La ficha cambió en el servidor. Actualice el catálogo y revise sus cambios antes de guardar.',detail='COMMERCIAL_CATALOG_VERSION_CONFLICT';
    end if;
    end if;
  end if;
  if p_entity in ('operations_yield_workday','operations_yield_workday_history')
     and not exists(select 1 from public.erp_sync_operations operation where operation.operation_id=p_operation_id) then
    perform public.erp_yield_validate_workday_mutation(p_company_id,p_entity,p_action,p_record_id,p_payload);
  end if;
  return query select * from public.erp_apply_offline_operation_u2c3_internal(
    p_operation_id,p_company_id,p_device_id,p_entity,p_action,p_record_id,p_payload,p_base_payload,
    p_field_changes,p_base_version,p_local_created_at
  );
end;
$function$
;

-- Existing RPC grants/capabilities are preserved by CREATE OR REPLACE.
-- Compensation: restore prior wrapper and customer triggers from the previous release
-- in a forward migration, together with its frontend; do not change historical rows.
