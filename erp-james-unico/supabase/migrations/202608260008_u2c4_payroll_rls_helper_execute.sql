begin;

-- U2C4 follow-up: PostgreSQL evaluates RLS policy expressions as the caller.
-- These two statement-scoped helpers are fail-closed and return only companies
-- authorized for auth.uid(), but authenticated needs EXECUTE for the policies
-- to evaluate. No mutation or assertion helper is exposed here.

revoke all on function public.erp_payroll_u2c4_authorized_companies(text,text)
  from public, anon, service_role;
grant execute on function public.erp_payroll_u2c4_authorized_companies(text,text)
  to authenticated;

revoke all on function public.erp_security_u2c4_admin_companies(text)
  from public, anon, service_role;
grant execute on function public.erp_security_u2c4_admin_companies(text)
  to authenticated;

comment on function public.erp_payroll_u2c4_authorized_companies(text,text) is
  'U2C4 RLS-only statement helper. Returns only auth.uid companies allowed by exact capability plus the legacy Payroll restriction.';
comment on function public.erp_security_u2c4_admin_companies(text) is
  'U2C4 RLS-only statement helper. Returns only auth.uid companies allowed by OWNER/ADMIN meta-role plus the exact admin capability.';

commit;
