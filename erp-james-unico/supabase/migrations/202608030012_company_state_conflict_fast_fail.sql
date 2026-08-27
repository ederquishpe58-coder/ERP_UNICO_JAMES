begin;

-- 40001 significa serialization_failure y algunos intermediarios vuelven a
-- intentar la transacción. Para un conflicto de revisión del ERP se necesita
-- una excepción de negocio inmediata, no un reintento automático del servidor.
create or replace function public.erp_save_company_state(
  p_company_id uuid,
  p_state_json jsonb,
  p_expected_revision bigint,
  p_schema_version integer default 1
)
returns table (
  company_id uuid,
  revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_saved public.erp_company_state%rowtype;
begin
  if v_actor is null then
    raise exception 'Se requiere un usuario autenticado' using errcode = '28000';
  end if;

  if not public.erp_has_route_permission(p_company_id, 'erp-company-state', 'edit', v_actor) then
    raise exception 'Sin permiso para guardar el estado de esta empresa' using errcode = '42501';
  end if;

  if p_state_json is null or jsonb_typeof(p_state_json) <> 'object' then
    raise exception 'state_json debe ser un objeto JSON' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected_revision debe ser mayor o igual a cero' using errcode = '22023';
  end if;
  if p_schema_version is null or p_schema_version < 1 then
    raise exception 'schema_version debe ser mayor a cero' using errcode = '22023';
  end if;

  if p_expected_revision = 0 then
    insert into public.erp_company_state (company_id, state_json, schema_version, revision, updated_by)
    values (p_company_id, p_state_json, p_schema_version, 1, v_actor)
    on conflict on constraint erp_company_state_pkey do nothing
    returning * into v_saved;
  else
    update public.erp_company_state state_row
      set state_json = p_state_json,
          schema_version = p_schema_version,
          revision = state_row.revision + 1,
          updated_by = v_actor,
          updated_at = now()
    where state_row.company_id = p_company_id
      and state_row.revision = p_expected_revision
    returning state_row.* into v_saved;
  end if;

  if v_saved.company_id is null then
    raise exception 'Conflicto de revisión: el estado cambió en otra sesión'
      using errcode = 'P0001',
            hint = 'Vuelva a consultar Supabase antes de decidir cómo resolver el conflicto.';
  end if;

  return query select v_saved.company_id, v_saved.revision, v_saved.updated_at;
end;
$$;

comment on function public.erp_save_company_state(uuid, jsonb, bigint, integer) is
  'Guarda el estado empresarial con revisión optimista y devuelve inmediatamente los conflictos sin reintentos de serialización.';

commit;
