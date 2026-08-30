begin;

create temporary table pg_temp.recepcionista_p1_expected_capabilities (
  capability_id text primary key
) on commit drop;

insert into pg_temp.recepcionista_p1_expected_capabilities(capability_id)
values
  ('operations.parameters.view'),
  ('operations.farms_blocks.manage'),
  ('operations.varieties.manage'),
  ('operations.reception.view'),
  ('operations.reception.create'),
  ('operations.reception.edit'),
  ('operations.classification.view'),
  ('operations.classification.record'),
  ('operations.classification.edit');

do $$
begin
  if (select count(*) from pg_temp.recepcionista_p1_expected_capabilities) <> 9 then
    raise exception 'RECEPCIONISTA_P1_EXPECTED_MATRIX_INVALID';
  end if;

  if exists (
    select 1
    from pg_temp.recepcionista_p1_expected_capabilities expected
    left join public.erp_security_capabilities capability
      on capability.capability_id = expected.capability_id
     and capability.active
    where capability.capability_id is null
  ) then
    raise exception 'RECEPCIONISTA_P1_UNKNOWN_OR_INACTIVE_CAPABILITY';
  end if;

  if exists (
    select 1
    from pg_temp.recepcionista_p1_expected_capabilities
    where capability_id like '%*%'
  ) then
    raise exception 'RECEPCIONISTA_P1_WILDCARD_NOT_ALLOWED';
  end if;
end;
$$;

insert into public.erp_security_profiles(
  profile_id, display_name, description, active, system_defined
)
values (
  'RECEPCIONISTA_P1',
  'RECEPCIONISTA P1',
  'Recepción, clasificación y parámetros específicos de Poscosecha mediante capabilities explícitas.',
  true,
  true
)
on conflict(profile_id) do update
set display_name = excluded.display_name,
    description = excluded.description,
    active = true,
    system_defined = true,
    updated_at = clock_timestamp();

do $$
begin
  if exists (
    select 1
    from public.erp_security_profile_capabilities existing
    where existing.profile_id = 'RECEPCIONISTA_P1'
      and not exists (
        select 1
        from pg_temp.recepcionista_p1_expected_capabilities expected
        where expected.capability_id = existing.capability_id
      )
  ) then
    raise exception 'RECEPCIONISTA_P1_UNEXPECTED_EXISTING_GRANT';
  end if;
end;
$$;

insert into public.erp_security_profile_capabilities(profile_id, capability_id)
select 'RECEPCIONISTA_P1', capability_id
from pg_temp.recepcionista_p1_expected_capabilities
on conflict(profile_id, capability_id) do nothing;

do $$
begin
  if (select count(*) from public.erp_security_profile_capabilities where profile_id = 'RECEPCIONISTA_P1') <> 9 then
    raise exception 'RECEPCIONISTA_P1_FINAL_GRANT_COUNT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.erp_security_profile_capabilities grant_row
    where grant_row.profile_id = 'RECEPCIONISTA_P1'
      and grant_row.capability_id in (
        'operations.parameters.manage',
        'operations.reception.cancel',
        'operations.boxes.cancel_order'
      )
  ) then
    raise exception 'RECEPCIONISTA_P1_BROAD_OR_CANCEL_GRANT_NOT_ALLOWED';
  end if;
end;
$$;

commit;
