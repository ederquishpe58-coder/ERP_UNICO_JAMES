begin;

-- FA-PERF-001: bounded, capability-protected profitability report.
create index if not exists erp_financial_cost_allocation_order_idx
  on public.erp_financial_cost_allocations(company_id, order_id);

create or replace function public.erp_commercial_profitability_report(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_include_annulled boolean default false,
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(100, greatest(10, coalesce(p_page_size, 50)));
  v_offset integer;
  v_result jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id, 'reports.commercial.view');

  if p_date_from is null or p_date_to is null then
    raise exception using errcode = '22023', message = 'COMMERCIAL_PROFITABILITY_DATE_RANGE_REQUIRED';
  end if;
  if p_date_to < p_date_from then
    raise exception using errcode = '22023', message = 'COMMERCIAL_PROFITABILITY_DATE_RANGE_INVALID';
  end if;
  if (p_date_to - p_date_from) > 366 then
    raise exception using errcode = '22023', message = 'COMMERCIAL_PROFITABILITY_DATE_RANGE_TOO_WIDE';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with filtered_orders as materialized (
    select
      record.record_id as order_id,
      record.payload,
      record.version,
      record.updated_at,
      coalesce(record.payload ->> 'issuedAt', '') as issue_date,
      coalesce(record.payload ->> 'number', record.record_id) as order_number
    from public.erp_entity_records record
    where record.company_id = p_company_id
      and record.entity = 'commercial_orders'
      and record.deleted_at is null
      and lower(coalesce(record.payload ->> 'unsavedDraft', 'false')) <> 'true'
      and coalesce(record.payload ->> 'historyArchivedAt', '') = ''
      and coalesce(record.payload ->> 'issuedAt', '') >= p_date_from::text
      and coalesce(record.payload ->> 'issuedAt', '') <= p_date_to::text
      and (
        coalesce(p_include_annulled, false)
        or upper(coalesce(record.payload ->> 'status', '')) <> 'ANULADO'
      )
  ), revenue as (
    select receivable.order_id, sum(receivable.total * receivable.exchange_rate) as revenue
    from public.erp_financial_receivables receivable
    join filtered_orders orders on orders.order_id = receivable.order_id
    where receivable.company_id = p_company_id
      and receivable.status <> 'CANCELLED'
    group by receivable.order_id
  ), direct_cost as (
    select
      component.order_id,
      sum(component.amount * component.exchange_rate) as direct_cost,
      sum(component.amount * component.exchange_rate) filter(where component.category = 'FLOWER') as flower_cost,
      sum(component.amount * component.exchange_rate) filter(where component.category = 'PACKAGING') as packaging_cost,
      sum(component.amount * component.exchange_rate) filter(where component.category = 'LABOR') as labor_cost,
      sum(component.amount * component.exchange_rate) filter(
        where component.category in ('TRANSPORT','CARGO_AGENCY','AIR_FREIGHT','DOCUMENTATION','HANDLING','OTHER')
      ) as direct_logistics_cost
    from public.erp_financial_order_cost_components component
    join filtered_orders orders on orders.order_id = component.order_id
    where component.company_id = p_company_id
      and component.accounting_status <> 'REVERSED'
    group by component.order_id
  ), allocated as (
    select allocation.order_id, sum(allocation.amount * expense.exchange_rate) as allocated_cost
    from public.erp_financial_cost_allocations allocation
    join filtered_orders orders on orders.order_id = allocation.order_id
    join public.erp_financial_shipment_expenses expense
      on expense.company_id = allocation.company_id
     and expense.expense_id = allocation.expense_id
    where allocation.company_id = p_company_id
      and expense.accounting_status <> 'REVERSED'
    group by allocation.order_id
  ), report_rows as materialized (
    select
      orders.order_id,
      orders.order_number,
      orders.issue_date,
      orders.payload,
      orders.version,
      orders.updated_at,
      coalesce(revenue.revenue, 0)::numeric(20,6) as revenue,
      coalesce(direct_cost.flower_cost, 0)::numeric(20,6) as flower_cost,
      coalesce(direct_cost.packaging_cost, 0)::numeric(20,6) as packaging_cost,
      coalesce(direct_cost.labor_cost, 0)::numeric(20,6) as labor_cost,
      coalesce(direct_cost.direct_logistics_cost, 0)::numeric(20,6) as direct_logistics_cost,
      coalesce(direct_cost.direct_cost, 0)::numeric(20,6) as direct_cost,
      coalesce(allocated.allocated_cost, 0)::numeric(20,6) as allocated_cost,
      (
        coalesce(revenue.revenue, 0)
        - coalesce(direct_cost.direct_cost, 0)
        - coalesce(allocated.allocated_cost, 0)
      )::numeric(20,6) as margin
    from filtered_orders orders
    left join revenue using(order_id)
    left join direct_cost using(order_id)
    left join allocated using(order_id)
  ), report_totals as (
    select
      count(*)::bigint as total,
      coalesce(sum(revenue), 0)::numeric(20,6) as revenue,
      coalesce(sum(flower_cost), 0)::numeric(20,6) as flower_cost,
      coalesce(sum(packaging_cost), 0)::numeric(20,6) as packaging_cost,
      coalesce(sum(labor_cost), 0)::numeric(20,6) as labor_cost,
      coalesce(sum(direct_logistics_cost), 0)::numeric(20,6) as direct_logistics_cost,
      coalesce(sum(direct_cost), 0)::numeric(20,6) as direct_cost,
      coalesce(sum(allocated_cost), 0)::numeric(20,6) as allocated_cost,
      coalesce(sum(margin), 0)::numeric(20,6) as margin
    from report_rows
  ), page_rows as (
    select *
    from report_rows
    order by issue_date desc, order_number desc, order_id desc
    limit v_page_size offset v_offset
  )
  select jsonb_build_object(
    'ok', true,
    'serverTime', clock_timestamp(),
    'dateFrom', p_date_from,
    'dateTo', p_date_to,
    'includeAnnulled', coalesce(p_include_annulled, false),
    'page', v_page,
    'pageSize', v_page_size,
    'total', totals.total,
    'totalPages', greatest(1, ceil(totals.total::numeric / v_page_size)::integer),
    'summary', jsonb_build_object(
      'officialRevenue', totals.revenue,
      'flowerCost', totals.flower_cost,
      'packagingCost', totals.packaging_cost,
      'laborCost', totals.labor_cost,
      'directLogisticsCost', totals.direct_logistics_cost,
      'directCost', totals.direct_cost,
      'allocatedCost', totals.allocated_cost,
      'officialCosts', totals.direct_cost + totals.allocated_cost,
      'officialMargin', totals.margin
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'order_id', page.order_id,
          'order_number', page.order_number,
          'issue_date', page.issue_date,
          'order', coalesce(page.payload, '{}'::jsonb) || jsonb_build_object(
            'id', coalesce(nullif(page.payload ->> 'id', ''), page.order_id),
            '__syncVersion', page.version,
            '__syncUpdatedAt', page.updated_at
          ),
          'revenue', page.revenue,
          'flower_cost', page.flower_cost,
          'packaging_cost', page.packaging_cost,
          'labor_cost', page.labor_cost,
          'direct_logistics_cost', page.direct_logistics_cost,
          'direct_cost', page.direct_cost,
          'allocated_cost', page.allocated_cost,
          'margin', page.margin
        ) order by page.issue_date desc, page.order_number desc, page.order_id desc
      )
      from page_rows page
    ), '[]'::jsonb)
  ) into v_result
  from report_totals totals;

  return v_result;
end;
$$;

revoke all on function public.erp_commercial_profitability_report(
  uuid, date, date, boolean, integer, integer
) from public, anon, service_role;
grant execute on function public.erp_commercial_profitability_report(
  uuid, date, date, boolean, integer, integer
) to authenticated;

insert into public.erp_u2c3_read_rpc_capabilities(rpc_name, capability_id)
values ('erp_commercial_profitability_report', 'reports.commercial.view')
on conflict (rpc_name) do update set capability_id = excluded.capability_id;

comment on function public.erp_commercial_profitability_report(
  uuid, date, date, boolean, integer, integer
) is 'FA-PERF-001 bounded Search-First commercial profitability report guarded by reports.commercial.view.';

notify pgrst, 'reload schema';
commit;
