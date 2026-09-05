begin;

do $$
begin
  if to_regclass('public.erp_security_capabilities') is null
     or to_regclass('public.erp_security_profiles') is null
     or to_regclass('public.erp_security_profile_capabilities') is null
     or to_regprocedure('public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamp with time zone)') is null then
    raise exception 'GERENCIA_JOURNAL_REVERSE_FOUNDATION_MISSING';
  end if;

  if not exists (
    select 1
    from public.erp_security_capabilities
    where capability_id = 'accounting.journal.reverse'
      and module = 'accounting'
      and resource = 'journal'
      and action = 'reverse'
      and active
  ) then
    raise exception 'ACCOUNTING_JOURNAL_REVERSE_CAPABILITY_INVALID';
  end if;

  if not exists (
    select 1 from public.erp_security_profiles
    where profile_id = 'GERENCIA_GENERAL' and active
  ) then
    raise exception 'GERENCIA_GENERAL_PROFILE_NOT_ACTIVE';
  end if;
end;
$$;

insert into public.erp_security_profile_capabilities(profile_id, capability_id)
values ('GERENCIA_GENERAL', 'accounting.journal.reverse')
on conflict (profile_id, capability_id) do nothing;

do $$
begin
  if (
    select count(*)
    from public.erp_security_profile_capabilities
    where profile_id = 'GERENCIA_GENERAL'
      and capability_id = 'accounting.journal.reverse'
  ) <> 1 then
    raise exception 'GERENCIA_GENERAL_JOURNAL_REVERSE_GRANT_INVALID';
  end if;

  if exists (
    select 1
    from public.erp_security_profile_capabilities
    where profile_id = 'GERENCIA_GENERAL'
      and capability_id like '%*%'
  ) then
    raise exception 'GERENCIA_GENERAL_WILDCARD_NOT_ALLOWED';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
