-- U2A: close demonstrated company-read and SRI actor trust-boundary bypasses.
-- Scope is intentionally limited to the five canonical read authorities and
-- create_electronic_document_draft. Public signatures and result contracts stay unchanged.

do $$
declare
  v_name text;
  v_oid regprocedure;
begin
  foreach v_name in array array[
    'erp_customer_receivable_read_rows(uuid)',
    'erp_purchase_invoice_read_rows(uuid)',
    'erp_received_withholding_read_rows(uuid)',
    'erp_retention_report_rows(uuid)',
    'erp_supplier_payable_read_rows(uuid)',
    'create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)'
  ] loop
    v_oid := to_regprocedure('public.' || v_name);
    if v_oid is null then
      raise exception 'U2A_REQUIRED_FUNCTION_MISSING: %', v_name;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
      raise exception 'U2A_REMOTE_MODE_DRIFT: % is not SECURITY DEFINER', v_name;
    end if;
  end loop;

  if to_regprocedure('public.erp_customer_receivable_read_rows_u2a_internal(uuid)') is not null
     or to_regprocedure('public.erp_purchase_invoice_read_rows_u2a_internal(uuid)') is not null
     or to_regprocedure('public.erp_received_withholding_read_rows_u2a_internal(uuid)') is not null
     or to_regprocedure('public.erp_retention_report_rows_u2a_internal(uuid)') is not null
     or to_regprocedure('public.erp_supplier_payable_read_rows_u2a_internal(uuid)') is not null
     or to_regprocedure('public.create_electronic_document_draft_u2a_internal(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)') is not null then
    raise exception 'U2A_INTERNAL_FUNCTION_ALREADY_EXISTS';
  end if;
end;
$$;

create or replace function public.erp_u2a_assert_company_read_access(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_company_id is null then
    raise exception using errcode = '22023', message = 'COMPANY_ID_REQUIRED';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATED_USER_REQUIRED';
  end if;
  if not public.erp_is_company_member(p_company_id, v_actor) then
    raise exception using errcode = '42501', message = 'COMPANY_MEMBERSHIP_REQUIRED';
  end if;
  return v_actor;
end;
$$;

revoke all on function public.erp_u2a_assert_company_read_access(uuid)
  from public, anon, authenticated, service_role;

alter function public.erp_customer_receivable_read_rows(uuid)
  rename to erp_customer_receivable_read_rows_u2a_internal;
alter function public.erp_purchase_invoice_read_rows(uuid)
  rename to erp_purchase_invoice_read_rows_u2a_internal;
alter function public.erp_received_withholding_read_rows(uuid)
  rename to erp_received_withholding_read_rows_u2a_internal;
alter function public.erp_retention_report_rows(uuid)
  rename to erp_retention_report_rows_u2a_internal;
alter function public.erp_supplier_payable_read_rows(uuid)
  rename to erp_supplier_payable_read_rows_u2a_internal;

revoke all on function public.erp_customer_receivable_read_rows_u2a_internal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.erp_purchase_invoice_read_rows_u2a_internal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.erp_received_withholding_read_rows_u2a_internal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.erp_retention_report_rows_u2a_internal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.erp_supplier_payable_read_rows_u2a_internal(uuid)
  from public, anon, authenticated, service_role;

create function public.erp_customer_receivable_read_rows(p_company_id uuid)
returns table(
  id text, source text, customer_id text, customer_name text, customer_tax_id text,
  source_id text, document_type text, document_number text, issue_date date, due_date date,
  total numeric, credited numeric, collected numeric, withheld numeric, balance numeric,
  status text, canonical_status text, journal_entry_id text, updated_at timestamptz, version bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  return query
    select * from public.erp_customer_receivable_read_rows_u2a_internal(p_company_id);
end;
$$;

create function public.erp_purchase_invoice_read_rows(p_company_id uuid)
returns table(
  id text, source text, canonical boolean, supplier_id text, supplier_name text, supplier_ruc text,
  issue_date date, accounting_date date, document_type text, document_number text,
  authorization_summary text, access_key_summary text, subtotal numeric, tax_total numeric, total numeric,
  status text, accounting_status text, retention_status text, payable_id text, payable_balance numeric,
  payable_status text, journal_entry_id text, journal_entry_number text, line_count bigint,
  source_type text, updated_at timestamptz, dedup_key text, priority integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  return query
    select * from public.erp_purchase_invoice_read_rows_u2a_internal(p_company_id);
end;
$$;

create function public.erp_received_withholding_read_rows(p_company_id uuid)
returns table(
  withholding_id text, issue_date date, document_number text, issuer_name text, issuer_tax_id text,
  resolved_customer_id text, support_document_number text, total_rent numeric, total_vat numeric,
  total_retained numeric, status text, related_receivable_id text, related_receivable_number text,
  related_customer_id text, suggested_receivable_id text, suggested_receivable_number text,
  suggested_customer_id text, journal_entry_id text, journal_entry_number text,
  authorization_number text, access_key text, import_status text, source text,
  applied_at timestamptz, created_at timestamptz, updated_at timestamptz, version bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  return query
    select * from public.erp_received_withholding_read_rows_u2a_internal(p_company_id);
end;
$$;

create function public.erp_retention_report_rows(p_company_id uuid)
returns table(
  report_type text, source text, retention_id text, line_id text, retention_date date,
  third_party_id text, third_party_name text, third_party_tax_id text,
  origin_document_id text, origin_document_number text, retention_number text,
  tax_type text, retention_code text, percentage numeric, taxable_base numeric,
  retained_amount numeric, status text, authorization_number text, access_key text,
  journal_entry_id text, journal_entry_number text, updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  return query
    select * from public.erp_retention_report_rows_u2a_internal(p_company_id);
end;
$$;

create function public.erp_supplier_payable_read_rows(p_company_id uuid)
returns table(
  id text, source text, provider_id text, provider_code text, provider_name text, provider_ruc text,
  purchase_id text, document_number text, issue_date date, due_date date, total numeric,
  balance numeric, paid numeric, retention_applied numeric, advance_applied numeric,
  state text, canonical_status text, journal_entry_id text, updated_at timestamptz, version bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  return query
    select * from public.erp_supplier_payable_read_rows_u2a_internal(p_company_id);
end;
$$;

revoke all on function public.erp_customer_receivable_read_rows(uuid) from public, anon;
revoke all on function public.erp_purchase_invoice_read_rows(uuid) from public, anon;
revoke all on function public.erp_received_withholding_read_rows(uuid) from public, anon;
revoke all on function public.erp_retention_report_rows(uuid) from public, anon;
revoke all on function public.erp_supplier_payable_read_rows(uuid) from public, anon;

grant execute on function public.erp_customer_receivable_read_rows(uuid) to authenticated, service_role;
grant execute on function public.erp_purchase_invoice_read_rows(uuid) to authenticated, service_role;
grant execute on function public.erp_received_withholding_read_rows(uuid) to authenticated, service_role;
grant execute on function public.erp_retention_report_rows(uuid) to authenticated, service_role;
grant execute on function public.erp_supplier_payable_read_rows(uuid) to authenticated, service_role;

comment on function public.erp_customer_receivable_read_rows(uuid) is
  'U2A guarded authority: requires auth.uid() with active profile, company and membership.';
comment on function public.erp_purchase_invoice_read_rows(uuid) is
  'U2A guarded authority: requires auth.uid() with active profile, company and membership.';
comment on function public.erp_received_withholding_read_rows(uuid) is
  'U2A guarded authority: requires auth.uid() with active profile, company and membership.';
comment on function public.erp_retention_report_rows(uuid) is
  'U2A guarded authority: requires auth.uid() with active profile, company and membership.';
comment on function public.erp_supplier_payable_read_rows(uuid) is
  'U2A guarded authority: requires auth.uid() with active profile, company and membership.';

alter function public.create_electronic_document_draft(
  uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid
) rename to create_electronic_document_draft_u2a_internal;

revoke all on function public.create_electronic_document_draft_u2a_internal(
  uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid
) from public, anon, authenticated, service_role;

create function public.create_electronic_document_draft(
  p_company_id uuid,
  p_emission_point_id uuid,
  p_document_type text,
  p_issue_date date,
  p_numeric_code text,
  p_xml_version text,
  p_xsd_version text,
  p_issuer_snapshot jsonb,
  p_buyer_snapshot jsonb,
  p_source_snapshot jsonb,
  p_source_order_id uuid,
  p_source_packing_id uuid,
  p_customer_id uuid,
  p_parent_document_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authenticated_actor uuid := auth.uid();
  v_actor uuid;
  v_request_role text := coalesce(auth.role()::text, '');
  v_request_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
  v_service_name text;
begin
  v_service_name := coalesce(v_request_headers ->> 'x-erp-service', '');

  if v_authenticated_actor is not null then
    if p_created_by is null or p_created_by <> v_authenticated_actor then
      raise exception using errcode = '42501', message = 'SRI_ACTOR_MISMATCH';
    end if;
    v_actor := v_authenticated_actor;
  elsif v_request_role = 'service_role'
        and v_service_name = 'sri-electronic-documents' then
    if p_created_by is null then
      raise exception using errcode = '42501', message = 'SRI_SERVICE_ACTOR_REQUIRED';
    end if;
    v_actor := p_created_by;
  else
    raise exception using errcode = '42501', message = 'SRI_AUTHENTICATED_ACTOR_REQUIRED';
  end if;

  if not public.erp_is_company_member(p_company_id, v_actor) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_COMPANY_ACCESS_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.sri_company_memberships membership
    where membership.company_id = p_company_id
      and membership.auth_user_id = v_actor
      and membership.active
      and membership.role_code in ('ADMIN', 'TRIBUTACION', 'CONTADOR', 'EMISOR')
  ) then
    raise exception using errcode = '42501', message = 'SRI_ACTOR_CANNOT_CREATE_DOCUMENT';
  end if;

  return public.create_electronic_document_draft_u2a_internal(
    p_company_id,
    p_emission_point_id,
    p_document_type,
    p_issue_date,
    p_numeric_code,
    p_xml_version,
    p_xsd_version,
    p_issuer_snapshot,
    p_buyer_snapshot,
    p_source_snapshot,
    p_source_order_id,
    p_source_packing_id,
    p_customer_id,
    p_parent_document_id,
    v_actor
  );
end;
$$;

revoke all on function public.create_electronic_document_draft(
  uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid
) from public, anon;
grant execute on function public.create_electronic_document_draft(
  uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid
) to authenticated, service_role;

comment on function public.create_electronic_document_draft(
  uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid
) is
  'U2A actor-bound SRI draft entrypoint. Interactive callers must match auth.uid(); the verified SRI service path is explicit.';
