begin;

-- A stale catalog version is a business conflict, not a serialization failure.
-- PostgREST 14.5 pins hasql-transaction 1.1.0.1: SQLSTATE 40001/40P01 retries
-- the whole transaction without a retry limit, retaining its pool connection.
-- PT409 returns HTTP 409 once with the same message/detail, preserving all guards.
-- Sources:
-- https://github.com/PostgREST/postgrest/blob/v14.5/src/PostgREST/MainTx.hs
-- https://github.com/PostgREST/postgrest/blob/v14.5/nix/overlays/haskell-packages.nix
-- https://github.com/nikita-volkov/hasql-transaction/blob/1.1.0.1/library/Hasql/Transaction/Private/Sessions.hs
-- No business rows, grants, ownership, signatures, settings or retry budgets change.
-- Do not compensate by restoring 40001: that would restore the unbounded retry.
do $migration$
declare
  target_oid oid;
  previous_definition text;
  replacement_definition text;
  old_raise constant text := $old$raise exception using errcode='40001',message='La ficha cambió en el servidor. Actualice el catálogo y revise sus cambios antes de guardar.',detail='COMMERCIAL_CATALOG_VERSION_CONFLICT';$old$;
  new_raise constant text := $new$raise exception using errcode='PT409',message='La ficha cambió en el servidor. Actualice el catálogo y revise sus cambios antes de guardar.',detail='COMMERCIAL_CATALOG_VERSION_CONFLICT';$new$;
  old_count integer;
  new_count integer;
begin
  target_oid:=to_regprocedure('public.erp_apply_offline_operation(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint,timestamp with time zone)');
  if target_oid is null then
    raise exception 'COMMERCIAL_CATALOG_CONFLICT_TARGET_MISSING';
  end if;
  previous_definition:=pg_get_functiondef(target_oid);
  old_count:=(length(previous_definition)-length(replace(previous_definition,old_raise,'')))/length(old_raise);
  new_count:=(length(previous_definition)-length(replace(previous_definition,new_raise,'')))/length(new_raise);
  if old_count=0 and new_count=1 then return; end if;
  if old_count<>1 or new_count<>0 then
    raise exception 'COMMERCIAL_CATALOG_CONFLICT_GUARD_MISMATCH';
  end if;
  replacement_definition:=replace(previous_definition,old_raise,new_raise);
  execute replacement_definition;
  if pg_get_functiondef(target_oid) is distinct from replacement_definition then
    raise exception 'COMMERCIAL_CATALOG_CONFLICT_REPLACEMENT_MISMATCH';
  end if;
end;
$migration$;

commit;
