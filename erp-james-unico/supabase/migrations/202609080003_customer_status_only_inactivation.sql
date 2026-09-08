-- Historical customer duplicates remain reserved. No customer rows are changed here.
-- Existing mutation RPC authorization, audit and optimistic merge remain authoritative.
create or replace function public.erp_customer_identity_write_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_code text;
  v_identification text;
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id
      or new.entity is distinct from old.entity or new.record_id is distinct from old.record_id then
      raise exception 'CUSTOMER_IDENTITY_SCOPE_IMMUTABLE';
    end if;
    if new.payload is not distinct from old.payload
      and new.deleted_at is not distinct from old.deleted_at then
      return new; -- metadata-only update, not a business transition
    end if;
    if old.deleted_at is null and new.deleted_at is null
      and old.payload->>'status' = 'ACTIVO' and new.payload->>'status' = 'INACTIVO'
      and (new.payload - 'status') is not distinct from (old.payload - 'status') then
      return new; -- the only exception: every persisted non-status field is identical
    end if;
  end if;
  if new.deleted_at is not null then return new; end if;
  -- Serialize competing creates/identity updates in the canonical company, independent
  -- of legacy payload company aliases. Inactive customers also occupy their identities.
  perform pg_advisory_xact_lock(hashtextextended('commercial_customers:identity:' || new.company_id::text, 0));
  v_code := upper(btrim(coalesce(new.payload->>'code', '')));
  v_identification := btrim(coalesce(new.payload->>'identification', ''));
  if v_code <> '' and exists (
    select 1 from public.erp_entity_records r
    where r.company_id = new.company_id and r.entity = 'commercial_customers'
      and r.deleted_at is null and r.record_id <> new.record_id
      and upper(btrim(coalesce(r.payload->>'code', ''))) = v_code
  ) then
    raise exception using errcode = '23505',
      message = 'Ya existe otro cliente de esta empresa con ese código. Resuelva el duplicado antes de modificar la identidad o reactivar.',
      detail = 'CUSTOMER_CODE_DUPLICATE';
  end if;
  if v_identification <> '' and exists (
    select 1 from public.erp_entity_records r
    where r.company_id = new.company_id and r.entity = 'commercial_customers'
      and r.deleted_at is null and r.record_id <> new.record_id
      and btrim(coalesce(r.payload->>'identification', '')) = v_identification
  ) then
    raise exception using errcode = '23505',
      message = 'Ya existe otro cliente de esta empresa con esa identificación. Resuelva el duplicado antes de modificar la identidad o reactivar.',
      detail = 'CUSTOMER_IDENTIFICATION_DUPLICATE';
  end if;
  return new;
end;
$function$;
revoke all on function public.erp_customer_identity_write_guard() from public, anon, authenticated;

drop trigger if exists erp_customer_identity_insert_guard on public.erp_entity_records;
create trigger erp_customer_identity_insert_guard
before insert on public.erp_entity_records for each row
when (new.entity = 'commercial_customers')
execute function public.erp_customer_identity_write_guard();

drop trigger if exists erp_customer_identity_update_guard on public.erp_entity_records;
create trigger erp_customer_identity_update_guard
before update of id, company_id, entity, record_id, payload, deleted_at
on public.erp_entity_records for each row
when (old.entity = 'commercial_customers' or new.entity = 'commercial_customers')
execute function public.erp_customer_identity_write_guard();

comment on function public.erp_customer_identity_write_guard() is
'Company-scoped customer uniqueness; only exact ACTIVO to INACTIVO payloads may retain historical collisions. No inactive identity reuse.';
-- Compensation: remove these two triggers and this function in a forward migration,
-- together with reverting the UI exception. Never rename or delete historical customers.
