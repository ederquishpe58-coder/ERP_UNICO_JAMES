begin;

-- Liquidacion SENAE V2: consumidor estrictamente READ-ONLY de documentos
-- electronicos canonicos. No proyecta pedidos ni modifica el flujo SRI.
create or replace function public.erp_sri_v2_senae_liquidation(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_commerce_type text default null,
  p_page integer default 1,
  p_page_size integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := case when p_page_size in (25, 50, 200) then p_page_size else 25 end;
  v_commerce_type text := nullif(upper(btrim(coalesce(p_commerce_type, ''))), 'TODOS');
  v_result jsonb;
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'SENAE_LIQUIDATION_FORBIDDEN';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception using errcode = '22023', message = 'SENAE_LIQUIDATION_DATE_RANGE_REQUIRED';
  end if;
  if p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'SENAE_LIQUIDATION_DATE_RANGE_INVALID';
  end if;
  if v_commerce_type is not null and v_commerce_type not in ('LOCAL', 'EXPORTADOR') then
    raise exception using errcode = '22023', message = 'SENAE_LIQUIDATION_COMMERCE_TYPE_INVALID';
  end if;

  with source_rows as (
    select
      document.id,
      document.company_id,
      document.document_type,
      document.status,
      document.issue_date,
      document.full_number,
      document.access_key,
      document.authorization_number,
      document.authorized_at,
      document.subtotal,
      document.tax_total,
      document.grand_total,
      document.currency,
      document.buyer_snapshot,
      document.source_snapshot,
      case upper(btrim(coalesce(document.source_snapshot #>> '{invoice,commerceType}', '')))
        when 'LOCAL' then 'LOCAL'
        when 'EXPORTADOR' then 'EXPORTADOR'
        else 'SIN_CLASIFICAR'
      end as commerce_type
    from public.electronic_documents document
    where document.company_id = p_company_id
      and document.document_type = '01'
      and document.status = 'AUTORIZADO'
      and document.issue_date >= p_date_from
      and document.issue_date <= p_date_to
  ), filtered as (
    select *
    from source_rows
    where v_commerce_type is null or commerce_type = v_commerce_type
  ), ordered as (
    select filtered.*,
      row_number() over (order by issue_date desc, full_number desc, id desc) as row_number
    from filtered
  ), page_rows as (
    select *
    from ordered
    where row_number > (v_page - 1) * v_page_size
      and row_number <= v_page * v_page_size
    order by row_number
  ), summary as (
    select
      count(*) as total_documents,
      count(*) filter (where commerce_type = 'LOCAL') as local_documents,
      count(*) filter (where commerce_type = 'EXPORTADOR') as export_documents,
      count(*) filter (where commerce_type = 'SIN_CLASIFICAR') as unclassified_documents,
      coalesce(sum(grand_total) filter (where commerce_type = 'LOCAL'), 0) as local_sales,
      coalesce(sum(grand_total) filter (where commerce_type = 'EXPORTADOR'), 0) as export_sales,
      coalesce(sum(grand_total) filter (where commerce_type = 'SIN_CLASIFICAR'), 0) as unclassified_sales,
      coalesce(sum(subtotal), 0) as subtotal,
      coalesce(sum(tax_total), 0) as tax_total,
      coalesce(sum(grand_total), 0) as grand_total
    from filtered
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id,
      'company_id', company_id,
      'document_type', document_type,
      'status', status,
      'issue_date', issue_date,
      'full_number', full_number,
      'access_key', access_key,
      'authorization_number', authorization_number,
      'authorized_at', authorized_at,
      'subtotal', subtotal,
      'tax_total', tax_total,
      'grand_total', grand_total,
      'currency', currency,
      'buyer_snapshot', buyer_snapshot,
      'source_snapshot', source_snapshot,
      'commerce_type', commerce_type
    ) order by row_number) from page_rows), '[]'::jsonb),
    'total', summary.total_documents,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(summary.total_documents::numeric / v_page_size)::integer),
    'summary', jsonb_build_object(
      'totalDocuments', summary.total_documents,
      'localDocuments', summary.local_documents,
      'exportDocuments', summary.export_documents,
      'unclassifiedDocuments', summary.unclassified_documents,
      'localSales', summary.local_sales,
      'exportSales', summary.export_sales,
      'unclassifiedSales', summary.unclassified_sales,
      'subtotal', summary.subtotal,
      'taxTotal', summary.tax_total,
      'grandTotal', summary.grand_total
    ),
    'serverTime', statement_timestamp()
  ) into v_result
  from summary;

  return v_result;
end;
$$;

revoke all on function public.erp_sri_v2_senae_liquidation(uuid,date,date,text,integer,integer) from public, anon;
grant execute on function public.erp_sri_v2_senae_liquidation(uuid,date,date,text,integer,integer) to authenticated, service_role;

comment on function public.erp_sri_v2_senae_liquidation(uuid,date,date,text,integer,integer)
  is 'Read-only, company-scoped Liquidacion SENAE V2 over authorized type 01 electronic_documents.';

commit;
