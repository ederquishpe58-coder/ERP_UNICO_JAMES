-- U2C2B: permit Realtime to deliver only non-business permission-version
-- metadata. Effective capability rows remain RPC-only and security tables stay
-- non-writable for authenticated users.

grant select on table public.erp_security_permission_versions to authenticated;
grant select on table public.erp_security_engine_state to authenticated;

create policy erp_security_permission_versions_member_select
on public.erp_security_permission_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.user_company_memberships membership
    join public.user_profiles profile on profile.user_id = membership.user_id
    join public.companies company on company.id = membership.company_id
    where membership.user_id = auth.uid()
      and membership.company_id = erp_security_permission_versions.company_id
      and profile.is_active
      and company.is_active
      and membership.membership_status = 'ACTIVE'
      and (membership.valid_from is null or membership.valid_from <= current_date)
      and (membership.valid_until is null or membership.valid_until >= current_date)
  )
);

create policy erp_security_engine_state_active_user_select
on public.erp_security_engine_state
for select
to authenticated
using (
  exists (
    select 1
    from public.user_company_memberships membership
    join public.user_profiles profile on profile.user_id = membership.user_id
    join public.companies company on company.id = membership.company_id
    where membership.user_id = auth.uid()
      and profile.is_active
      and company.is_active
      and membership.membership_status = 'ACTIVE'
      and (membership.valid_from is null or membership.valid_from <= current_date)
      and (membership.valid_until is null or membership.valid_until >= current_date)
  )
);

do $$
begin
  if has_table_privilege('authenticated', 'public.erp_security_permission_versions', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.erp_security_engine_state', 'INSERT,UPDATE,DELETE') then
    raise exception 'U2C2B_SECURITY_VERSION_TABLE_WRITE_PRIVILEGE';
  end if;
end;
$$;
