begin;

create or replace function public.erp_protect_last_company_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removes_owner boolean;
  v_other_owners integer;
begin
  -- Una eliminación en cascada de la empresa debe poder retirar su última
  -- membresía. La protección sigue activa cuando la empresa continúa vigente.
  if tg_op = 'DELETE'
    and not exists (
      select 1
      from public.companies company_row
      where company_row.id = old.company_id
    )
  then
    return old;
  end if;

  if old.membership_role <> 'OWNER' or old.membership_status <> 'ACTIVE' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_removes_owner := true;
  else
    v_removes_owner :=
      new.company_id <> old.company_id
      or new.membership_role <> 'OWNER'
      or new.membership_status <> 'ACTIVE';
  end if;

  if not v_removes_owner then
    return new;
  end if;

  select count(*)
    into v_other_owners
  from public.user_company_memberships membership_row
  where membership_row.company_id = old.company_id
    and membership_row.membership_role = 'OWNER'
    and membership_row.membership_status = 'ACTIVE'
    and membership_row.id <> old.id;

  if v_other_owners = 0 then
    raise exception 'No se puede quitar el último OWNER activo de la empresa'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

commit;
