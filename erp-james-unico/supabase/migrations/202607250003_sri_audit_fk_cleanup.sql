begin;

create or replace function public.sri_preserve_creation_audit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.created_at := old.created_at;

  -- Las ediciones normales no pueden cambiar al creador. Cuando una FK
  -- ON DELETE SET NULL actualiza la fila desde un trigger referencial,
  -- pg_trigger_depth() es mayor que 1 y debe permitirse el NULL.
  if pg_trigger_depth() <= 1 then
    new.created_by := old.created_by;
  end if;

  return new;
end;
$$;

commit;
