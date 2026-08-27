begin;

-- Reporte read-only. Mantiene la semántica histórica del reporte: compara por
-- día/proveedor/variedad la entrega a Clasificación con nacional/rechazo y con
-- el ingreso físico confirmado por escaneo. No crea stock ni proyecciones.
create or replace function public.erp_operations_v2_supplier_inventory_report(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_supplier text default null,
  p_block text default null,
  p_variety text default null,
  p_length integer default null,
  p_classification_type text default null,
  p_search text default null,
  p_sort_field text default 'dateTime',
  p_sort_direction text default 'desc',
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
  v_sort_field text := case when p_sort_field in ('dateTime','supplier','variety','nationalStems','exportedStems','classifiedStems','mismatch') then p_sort_field else 'dateTime' end;
  v_sort_direction text := case when lower(coalesce(p_sort_direction, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_result jsonb;
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'OPERATIONS_SUPPLIER_REPORT_FORBIDDEN';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception using errcode = '22023', message = 'OPERATIONS_SUPPLIER_REPORT_DATE_RANGE_REQUIRED';
  end if;
  if p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'OPERATIONS_SUPPLIER_REPORT_DATE_RANGE_INVALID';
  end if;

  with assignment_source as (
    select
      'CLASIFICACION'::text as source_type,
      coalesce(nullif(left(assignment.payload ->> 'dateTime', 10), '')::date, assignment.created_at::date) as report_date,
      coalesce(nullif(reception.payload ->> 'supplier', ''), 'SIN PROVEEDOR') as supplier,
      coalesce(nullif(reception.payload ->> 'block', ''), 'SIN BLOQUE') as block,
      coalesce(nullif(reception_item.value ->> 'variety', ''), 'SIN VARIEDAD') as variety,
      null::integer as length_cm,
      coalesce(nullif(assignment.payload ->> 'totalStems', '')::numeric, 0) as delivered_stems,
      0::numeric as inventory_stems,
      coalesce(result_totals.national_stems, 0) as national_stems,
      not (
        upper(coalesce(assignment.payload ->> 'status', '')) in ('COMPLETADO','ENTREGADO + REGISTRADO NACIONAL')
        or coalesce(result_totals.result_count, 0) > 0
      ) as classification_pending,
      coalesce(nullif(assignment.payload ->> 'classifier', ''), 'SIN RESPONSABLE') as responsible,
      assignment.record_id as assignment_id,
      null::text as inventory_id,
      reception.record_id as reception_id,
      reception_item.value ->> 'id' as reception_item_id,
      coalesce(result_totals.result_ids, '[]'::jsonb) as result_ids
    from public.erp_entity_records assignment
    join public.erp_entity_records reception
      on reception.company_id = p_company_id
     and reception.entity = 'operations_receptions'
     and reception.record_id = assignment.payload ->> 'receptionId'
     and reception.deleted_at is null
    join lateral jsonb_array_elements(coalesce(reception.payload -> 'items', '[]'::jsonb)) reception_item(value)
      on reception_item.value ->> 'id' = assignment.payload ->> 'receptionItemId'
    left join lateral (
      select
        count(*) as result_count,
        coalesce(sum(coalesce(nullif(result.payload ->> 'nationalStems', '')::numeric, 0)), 0) as national_stems,
        coalesce(jsonb_agg(result.record_id order by result.record_id), '[]'::jsonb) as result_ids
      from public.erp_entity_records result
      where result.company_id = p_company_id
        and result.entity = 'operations_classification_results'
        and result.deleted_at is null
        and result.payload ->> 'assignmentId' = assignment.record_id
    ) result_totals on true
    where assignment.company_id = p_company_id
      and assignment.entity = 'operations_classifier_assignments'
      and assignment.deleted_at is null
      and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO'
  ), inventory_source as (
    select
      'INVENTARIO_BONCHES'::text as source_type,
      coalesce(nullif(left(coalesce(inventory.payload ->> 'admittedAt', inventory.payload ->> 'date'), 10), '')::date, inventory.created_at::date) as report_date,
      coalesce(nullif(component.value ->> 'supplier', ''), nullif(inventory.payload ->> 'supplier', ''), 'SIN PROVEEDOR') as supplier,
      coalesce(nullif(component.value ->> 'block', ''), nullif(inventory.payload ->> 'block', ''), 'SIN BLOQUE') as block,
      coalesce(nullif(inventory.payload ->> 'variety', ''), 'SIN VARIEDAD') as variety,
      coalesce(nullif(inventory.payload ->> 'length', '')::integer, 0) as length_cm,
      0::numeric as delivered_stems,
      coalesce(
        nullif(component.value ->> 'stems', '')::numeric,
        nullif(inventory.payload ->> 'stemsPerBunch', '')::numeric,
        nullif(inventory.payload ->> 'stems', '')::numeric,
        0
      ) as inventory_stems,
      0::numeric as national_stems,
      false as classification_pending,
      coalesce(nullif(inventory.payload ->> 'buncher', ''), nullif(inventory.payload ->> 'responsible', ''), 'SIN RESPONSABLE') as responsible,
      null::text as assignment_id,
      inventory.record_id as inventory_id,
      null::text as reception_id,
      null::text as reception_item_id,
      coalesce(inventory.payload -> 'classificationResultIds', '[]'::jsonb) as result_ids
    from public.erp_entity_records inventory
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(inventory.payload -> 'composition') = 'array'
          and jsonb_array_length(inventory.payload -> 'composition') > 0
        then inventory.payload -> 'composition'
        else jsonb_build_array(jsonb_build_object(
          'supplier', inventory.payload ->> 'supplier',
          'block', inventory.payload ->> 'block',
          'stems', coalesce(inventory.payload ->> 'stemsPerBunch', inventory.payload ->> 'stems', '0')
        ))
      end
    ) component(value)
    where inventory.company_id = p_company_id
      and inventory.entity = 'operations_rose_inventory'
      and inventory.deleted_at is null
      and upper(coalesce(inventory.payload ->> 'sourceType', '')) = 'ESCANEO_ETIQUETA'
  ), source_rows as (
    select * from assignment_source
    union all
    select * from inventory_source
  ), source_filtered as (
    select * from source_rows
    where report_date >= p_date_from and report_date <= p_date_to
      and (nullif(btrim(p_supplier), '') is null or supplier ilike '%' || btrim(p_supplier) || '%')
      and (nullif(btrim(p_block), '') is null or block ilike '%' || btrim(p_block) || '%')
      and (nullif(btrim(p_variety), '') is null or variety ilike '%' || btrim(p_variety) || '%')
  ), grouped as (
    select
      report_date,
      supplier,
      variety,
      string_agg(distinct block, '+' order by block) as block,
      sum(case when length_cm = 40 then inventory_stems else 0 end) as length40,
      sum(case when length_cm = 50 then inventory_stems else 0 end) as length50,
      sum(case when length_cm = 60 then inventory_stems else 0 end) as length60,
      sum(case when length_cm = 70 then inventory_stems else 0 end) as length70,
      sum(case when length_cm = 80 then inventory_stems else 0 end) as length80,
      sum(case when length_cm = 90 then inventory_stems else 0 end) as length90,
      sum(case when length_cm = 100 then inventory_stems else 0 end) as length100,
      sum(case when length_cm = 110 then inventory_stems else 0 end) as length110,
      sum(case when length_cm = 120 then inventory_stems else 0 end) as length120,
      sum(case when length_cm = 130 then inventory_stems else 0 end) as length130,
      sum(delivered_stems) as delivered_stems,
      sum(inventory_stems) as inventory_stems,
      sum(national_stems) as national_stems,
      bool_or(classification_pending) as classification_pending,
      string_agg(distinct responsible, ' + ' order by responsible) as responsible,
      coalesce(jsonb_agg(distinct assignment_id) filter (where assignment_id is not null), '[]'::jsonb) as assignment_ids,
      coalesce(jsonb_agg(distinct inventory_id) filter (where inventory_id is not null), '[]'::jsonb) as inventory_ids,
      coalesce(jsonb_agg(distinct reception_id) filter (where reception_id is not null), '[]'::jsonb) as reception_ids,
      coalesce(jsonb_agg(distinct reception_item_id) filter (where reception_item_id is not null), '[]'::jsonb) as reception_item_ids,
      count(*) filter (where source_type = 'CLASIFICACION') as assignment_source_rows,
      count(*) filter (where source_type = 'INVENTARIO_BONCHES') as inventory_source_rows
    from source_filtered
    group by report_date, supplier, variety
  ), projected as (
    select *,
      inventory_stems + national_stems - delivered_stems as mismatch,
      case
        when classification_pending then 'PENDIENTE'
        when national_stems > 0 and inventory_stems > 0 then 'MIXTA'
        when national_stems > 0 then 'NACIONAL'
        else 'EXPORTACION'
      end as classification_type
    from grouped
  ), filtered as (
    select * from projected
    where (p_length is null or case p_length
      when 40 then length40 when 50 then length50 when 60 then length60 when 70 then length70
      when 80 then length80 when 90 then length90 when 100 then length100 when 110 then length110
      when 120 then length120 when 130 then length130 else 0 end > 0)
      and (nullif(btrim(p_classification_type), '') is null or classification_type = upper(btrim(p_classification_type)))
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', report_date, supplier, block, variety, responsible, assignment_ids::text, inventory_ids::text) ilike '%' || btrim(p_search) || '%')
  ), ordered as (
    select *, row_number() over (order by
      case when v_sort_field = 'dateTime' and v_sort_direction = 'asc' then report_date end asc,
      case when v_sort_field = 'dateTime' and v_sort_direction = 'desc' then report_date end desc,
      case when v_sort_field = 'supplier' and v_sort_direction = 'asc' then supplier end asc,
      case when v_sort_field = 'supplier' and v_sort_direction = 'desc' then supplier end desc,
      case when v_sort_field = 'variety' and v_sort_direction = 'asc' then variety end asc,
      case when v_sort_field = 'variety' and v_sort_direction = 'desc' then variety end desc,
      case when v_sort_field = 'nationalStems' and v_sort_direction = 'asc' then national_stems end asc,
      case when v_sort_field = 'nationalStems' and v_sort_direction = 'desc' then national_stems end desc,
      case when v_sort_field = 'exportedStems' and v_sort_direction = 'asc' then inventory_stems end asc,
      case when v_sort_field = 'exportedStems' and v_sort_direction = 'desc' then inventory_stems end desc,
      case when v_sort_field = 'classifiedStems' and v_sort_direction = 'asc' then delivered_stems end asc,
      case when v_sort_field = 'classifiedStems' and v_sort_direction = 'desc' then delivered_stems end desc,
      case when v_sort_field = 'mismatch' and v_sort_direction = 'asc' then mismatch end asc,
      case when v_sort_field = 'mismatch' and v_sort_direction = 'desc' then mismatch end desc,
      report_date desc, supplier, variety
    ) as row_number
    from filtered
  ), totals as (
    select
      count(*) as total,
      count(distinct supplier) as suppliers,
      count(distinct variety) as varieties,
      coalesce(sum(length40), 0) as length40, coalesce(sum(length50), 0) as length50,
      coalesce(sum(length60), 0) as length60, coalesce(sum(length70), 0) as length70,
      coalesce(sum(length80), 0) as length80, coalesce(sum(length90), 0) as length90,
      coalesce(sum(length100), 0) as length100, coalesce(sum(length110), 0) as length110,
      coalesce(sum(length120), 0) as length120, coalesce(sum(length130), 0) as length130,
      coalesce(sum(delivered_stems), 0) as delivered_stems,
      coalesce(sum(inventory_stems), 0) as inventory_stems,
      coalesce(sum(national_stems), 0) as national_stems,
      coalesce(sum(mismatch), 0) as mismatch,
      coalesce(sum(assignment_source_rows), 0) as assignment_source_rows,
      coalesce(sum(inventory_source_rows), 0) as inventory_source_rows
    from filtered
  ), page_rows as (
    select * from ordered
    where row_number > (v_page - 1) * v_page_size
      and row_number <= v_page * v_page_size
    order by row_number
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', concat(report_date, '|', supplier, '|', variety),
      'date', report_date, 'dateTime', report_date, 'supplier', supplier, 'block', block,
      'variety', variety, 'length40', length40, 'length50', length50, 'length60', length60,
      'length70', length70, 'length80', length80, 'length90', length90, 'length100', length100,
      'length110', length110, 'length120', length120, 'length130', length130,
      'nationalStems', national_stems, 'exportedStems', inventory_stems,
      'classifiedStems', delivered_stems, 'mismatch', mismatch,
      'classification', classification_type, 'classificationPending', classification_pending,
      'responsible', responsible, 'assignmentIds', assignment_ids, 'inventoryIds', inventory_ids,
      'receptionIds', reception_ids, 'receptionItemIds', reception_item_ids
    ) order by row_number) from page_rows), '[]'::jsonb),
    'total', totals.total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(totals.total::numeric / v_page_size)::integer),
    'totals', jsonb_build_object(
      'records', totals.total, 'suppliers', totals.suppliers, 'varieties', totals.varieties,
      'length40', totals.length40, 'length50', totals.length50, 'length60', totals.length60,
      'length70', totals.length70, 'length80', totals.length80, 'length90', totals.length90,
      'length100', totals.length100, 'length110', totals.length110, 'length120', totals.length120,
      'length130', totals.length130, 'classifiedStems', totals.delivered_stems,
      'exportedStems', totals.inventory_stems, 'nationalStems', totals.national_stems,
      'mismatch', totals.mismatch, 'assignmentSourceRows', totals.assignment_source_rows,
      'inventorySourceRows', totals.inventory_source_rows
    ),
    'serverTime', statement_timestamp()
  ) into v_result
  from totals;

  return v_result;
end;
$$;

revoke all on function public.erp_operations_v2_supplier_inventory_report(
  uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer
) from public, anon;
grant execute on function public.erp_operations_v2_supplier_inventory_report(
  uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer
) to authenticated, service_role;

commit;
