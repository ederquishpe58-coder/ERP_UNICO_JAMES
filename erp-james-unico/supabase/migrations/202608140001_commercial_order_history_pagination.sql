begin;

-- El historial consulta la fuente incremental oficial sin duplicar pedidos en
-- otra tabla. RLS de erp_entity_records se conserva porque la función trabaja
-- con los permisos del usuario que la invoca.
create extension if not exists pg_trgm;

create index if not exists erp_entity_records_commercial_issue_idx
  on public.erp_entity_records (
    company_id,
    ((payload ->> 'issuedAt')) desc,
    ((payload ->> 'number')) desc
  )
  where entity = 'commercial_orders' and deleted_at is null;

create index if not exists erp_entity_records_commercial_customer_idx
  on public.erp_entity_records (company_id, ((payload ->> 'customerId')))
  where entity = 'commercial_orders' and deleted_at is null;

create index if not exists erp_entity_records_commercial_brand_idx
  on public.erp_entity_records (company_id, ((payload ->> 'brandId')))
  where entity = 'commercial_orders' and deleted_at is null;

create index if not exists erp_entity_records_commercial_destination_idx
  on public.erp_entity_records (company_id, (lower(coalesce(payload ->> 'destination', ''))))
  where entity = 'commercial_orders' and deleted_at is null;

create index if not exists erp_entity_records_commercial_number_search_idx
  on public.erp_entity_records using gin ((lower(coalesce(payload ->> 'number', ''))) gin_trgm_ops)
  where entity = 'commercial_orders' and deleted_at is null;

create or replace function public.erp_list_commercial_order_history(
  p_company_id uuid,
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_customer_id text default null,
  p_brand_id text default null,
  p_destination text default null,
  p_customer_matches text[] default null,
  p_brand_matches text[] default null,
  p_airline_matches text[] default null
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(100, greatest(10, coalesce(p_page_size, 25)));
  v_total bigint := 0;
  v_total_pages integer := 1;
  v_offset integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  select count(*)
    into v_total
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = 'commercial_orders'
    and record.deleted_at is null
    and lower(coalesce(record.payload ->> 'unsavedDraft', 'false')) <> 'true'
    and coalesce(record.payload ->> 'historyArchivedAt', '') = ''
    and (p_date_from is null or coalesce(record.payload ->> 'issuedAt', '') >= p_date_from::text)
    and (p_date_to is null or coalesce(record.payload ->> 'issuedAt', '') <= p_date_to::text)
    and (nullif(p_customer_id, '') is null or record.payload ->> 'customerId' = p_customer_id)
    and (nullif(p_brand_id, '') is null or record.payload ->> 'brandId' = p_brand_id)
    and (nullif(p_destination, '') is null or lower(coalesce(record.payload ->> 'destination', '')) = lower(p_destination))
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ',
        record.record_id,
        record.payload ->> 'number',
        record.payload ->> 'sriSequential',
        record.payload ->> 'sriInvoiceNumber',
        record.payload ->> 'issuedAt',
        record.payload ->> 'flightDate',
        record.payload ->> 'destination',
        record.payload ->> 'daeNumber',
        record.payload ->> 'awb',
        record.payload ->> 'hawb',
        coalesce(record.payload -> 'lines', '[]'::jsonb)::text
      ) ilike ('%' || btrim(p_search) || '%')
      or (
        coalesce(array_length(p_customer_matches, 1), 0) > 0
        and record.payload ->> 'customerId' = any(p_customer_matches)
      )
      or (
        coalesce(array_length(p_brand_matches, 1), 0) > 0
        and record.payload ->> 'brandId' = any(p_brand_matches)
      )
      or (
        coalesce(array_length(p_airline_matches, 1), 0) > 0
        and record.payload ->> 'airlineId' = any(p_airline_matches)
      )
    );

  v_total_pages := greatest(1, ceil(v_total::numeric / v_page_size)::integer);
  v_page := least(v_page, v_total_pages);
  v_offset := (v_page - 1) * v_page_size;

  select coalesce(
    jsonb_agg(page_row.item order by page_row.issue_date desc, page_row.order_number desc),
    '[]'::jsonb
  )
    into v_items
  from (
    with page_base as (
      select record.record_id, record.payload, record.version, record.updated_at
      from public.erp_entity_records record
      where record.company_id = p_company_id
        and record.entity = 'commercial_orders'
        and record.deleted_at is null
        and lower(coalesce(record.payload ->> 'unsavedDraft', 'false')) <> 'true'
        and coalesce(record.payload ->> 'historyArchivedAt', '') = ''
        and (p_date_from is null or coalesce(record.payload ->> 'issuedAt', '') >= p_date_from::text)
        and (p_date_to is null or coalesce(record.payload ->> 'issuedAt', '') <= p_date_to::text)
        and (nullif(p_customer_id, '') is null or record.payload ->> 'customerId' = p_customer_id)
        and (nullif(p_brand_id, '') is null or record.payload ->> 'brandId' = p_brand_id)
        and (nullif(p_destination, '') is null or lower(coalesce(record.payload ->> 'destination', '')) = lower(p_destination))
        and (
          nullif(btrim(p_search), '') is null
          or concat_ws(' ',
            record.record_id,
            record.payload ->> 'number',
            record.payload ->> 'sriSequential',
            record.payload ->> 'sriInvoiceNumber',
            record.payload ->> 'issuedAt',
            record.payload ->> 'flightDate',
            record.payload ->> 'destination',
            record.payload ->> 'daeNumber',
            record.payload ->> 'awb',
            record.payload ->> 'hawb',
            coalesce(record.payload -> 'lines', '[]'::jsonb)::text
          ) ilike ('%' || btrim(p_search) || '%')
          or (
            coalesce(array_length(p_customer_matches, 1), 0) > 0
            and record.payload ->> 'customerId' = any(p_customer_matches)
          )
          or (
            coalesce(array_length(p_brand_matches, 1), 0) > 0
            and record.payload ->> 'brandId' = any(p_brand_matches)
          )
          or (
            coalesce(array_length(p_airline_matches, 1), 0) > 0
            and record.payload ->> 'airlineId' = any(p_airline_matches)
          )
        )
      order by
        coalesce(record.payload ->> 'issuedAt', '') desc,
        coalesce(record.payload ->> 'number', record.record_id) desc
      offset v_offset
      limit v_page_size
    )
    select
      (coalesce(page_base.payload, '{}'::jsonb) - 'lines')
        || jsonb_build_object(
          'id', coalesce(nullif(page_base.payload ->> 'id', ''), page_base.record_id),
          '__syncVersion', page_base.version,
          '__syncUpdatedAt', page_base.updated_at,
          '__historyServerPage', true,
          '_historyMetrics', jsonb_build_object(
            'totalBoxes', coalesce(line_stats.total_boxes, 0),
            'totalFulls', coalesce(box_stats.total_fulls, 0),
            'totalBunches', coalesce(line_stats.total_bunches, 0),
            'totalStems', coalesce(line_stats.total_stems, 0),
            'totalUsd', coalesce(line_stats.total_usd, 0)
          )
        ) as item,
      coalesce(page_base.payload ->> 'issuedAt', '') as issue_date,
      coalesce(page_base.payload ->> 'number', page_base.record_id) as order_number
    from page_base
    left join lateral (
      select
        count(distinct nullif(line ->> 'boxNumber', '')) as total_boxes,
        sum(coalesce(nullif(line ->> 'bunches', ''), '0')::numeric) as total_bunches,
        sum(
          coalesce(nullif(line ->> 'bunches', ''), '0')::numeric
          * coalesce(nullif(line ->> 'stemsPerBunch', ''), '0')::numeric
        ) as total_stems,
        sum(
          coalesce(nullif(line ->> 'bunches', ''), '0')::numeric
          * coalesce(nullif(line ->> 'stemsPerBunch', ''), '0')::numeric
          * coalesce(nullif(line ->> 'unitPrice', ''), '0')::numeric
        ) as total_usd
      from jsonb_array_elements(coalesce(page_base.payload -> 'lines', '[]'::jsonb)) line
    ) line_stats on true
    left join lateral (
      select sum(
        case upper(box.box_type)
          when 'FB' then 1
          when 'HB' then 0.5
          when 'QB' then 0.25
          when 'EB' then 0.125
          when 'JB' then 0.5
          else 0
        end
      ) as total_fulls
      from (
        select distinct line ->> 'boxNumber' as box_number, line ->> 'boxType' as box_type
        from jsonb_array_elements(coalesce(page_base.payload -> 'lines', '[]'::jsonb)) line
        where nullif(line ->> 'boxNumber', '') is not null
      ) box
    ) box_stats on true
  ) page_row;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', v_total_pages,
    'start', case when v_total = 0 then 0 else v_offset + 1 end,
    'end', least(v_total, v_offset + jsonb_array_length(v_items))
  );
end;
$$;

revoke all on function public.erp_list_commercial_order_history(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) from public;
grant execute on function public.erp_list_commercial_order_history(
  uuid, integer, integer, text, date, date, text, text, text, text[], text[], text[]
) to authenticated;

commit;
