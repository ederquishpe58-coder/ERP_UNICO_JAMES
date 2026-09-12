begin;

-- Do not create an unguarded internal entry point when its dependency is absent.
-- CREATE OR REPLACE below preserves the installed function's owner and ACL.
do $$
begin
  if to_regprocedure('public.erp_operations_v2_supplier_inventory_report_u2c3_internal(uuid,date,date,text,text,text,integer,text,text,text,text,integer,integer)') is null then
    raise exception 'SUPPLIER_REPORT_INTERNAL_DEPENDENCY_MISSING';
  end if;
  if to_regprocedure('public.erp_inventory_pool_company(uuid)') is null then
    raise exception 'SUPPLIER_REPORT_POOL_DEPENDENCY_MISSING';
  end if;
end;
$$;

-- Forward-only read-model correction. Source records remain unchanged: the
-- report resolves a canonical supplier only when the scoped catalog produces
-- one compatible identity, and keeps unresolved sources separate.
-- The public capability-guarded wrapper remains untouched; only its internal
-- read implementation is replaced below.
create or replace function public.erp_operations_v2_supplier_inventory_report_u2c3_internal(
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
  v_source_company_id uuid;
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

  -- Authorize the operator above; resolve only the operational pool below.
  -- The public capability guard and private resolver ACL remain unchanged.
  v_source_company_id := public.erp_inventory_pool_company(p_company_id);

  with supplier_catalog as (
    select
      record_id::text as canonical_supplier_id,
      company_id::text as supplier_scope,
      coalesce(nullif(payload ->> 'code', ''), record_id::text) as canonical_code,
      nullif(payload ->> 'name', '') as canonical_name,
      nullif(coalesce(payload ->> 'assignedBlock', payload ->> 'block'), '') as assigned_block,
      payload
    from public.erp_entity_records
    where company_id = v_source_company_id
      and entity = 'operations_suppliers'
      and deleted_at is null
  ), supplier_catalog_aliases as (
    select c.canonical_supplier_id, btrim(alias_value) as alias_value
    from supplier_catalog c
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(c.payload -> 'aliases') = 'array'
          and jsonb_typeof(c.payload -> 'supplierAliases') = 'array'
          then (c.payload -> 'aliases') || (c.payload -> 'supplierAliases')
        when jsonb_typeof(c.payload -> 'aliases') = 'array' then c.payload -> 'aliases'
        when nullif(btrim(c.payload ->> 'aliases'), '') is not null then jsonb_build_array(c.payload ->> 'aliases')
        else '[]'::jsonb
      end
    ) aliases(alias_value)
    where btrim(alias_value) <> ''
    union all
    select c.canonical_supplier_id, btrim(alias_value)
    from supplier_catalog c
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(c.payload -> 'supplierAliases') = 'array' then c.payload -> 'supplierAliases'
        when nullif(btrim(c.payload ->> 'supplierAliases'), '') is not null then jsonb_build_array(c.payload ->> 'supplierAliases')
        else '[]'::jsonb
      end
    ) aliases(alias_value)
    where btrim(alias_value) <> ''
    union all
    select c.canonical_supplier_id, btrim(value)
    from supplier_catalog c
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(c.payload -> 'legacyCodes') = 'array'
          and jsonb_typeof(c.payload -> 'legacy_codes') = 'array'
          then (c.payload -> 'legacyCodes') || (c.payload -> 'legacy_codes')
        when jsonb_typeof(c.payload -> 'legacyCodes') = 'array' then c.payload -> 'legacyCodes'
        when nullif(btrim(c.payload ->> 'legacyCodes'), '') is not null then jsonb_build_array(c.payload ->> 'legacyCodes')
        when jsonb_typeof(c.payload -> 'legacy_codes') = 'array' then c.payload -> 'legacy_codes'
        when nullif(btrim(c.payload ->> 'legacy_codes'), '') is not null then jsonb_build_array(c.payload ->> 'legacy_codes')
        else '[]'::jsonb
      end
    ) legacy(value)
    where btrim(value) <> ''
    union all
    select canonical_supplier_id, btrim(payload ->> field_name)
    from supplier_catalog
    cross join lateral unnest(array['legacyCode','legacy_code','supplierCode','supplier_code','providerCode','provider_code']) fields(field_name)
    where nullif(btrim(payload ->> field_name), '') is not null
  ), supplier_catalog_matchable as (
    select
      c.*,
      array(select distinct nullif(nullif(regexp_replace(upper(regexp_replace(blocks.value, '[^A-Za-z0-9]', '', 'g')), '^(BLOQUE|BQ|B)0*([0-9]+)$', 'B\2'), 'SINBLOQUE'), '')
        from jsonb_each(c.payload) field
        cross join lateral jsonb_array_elements_text(case when jsonb_typeof(field.value) = 'array' then field.value else jsonb_build_array(field.value) end) blocks(value)
        where field.key in ('assignedBlock','assigned_block','block','assignedBlocks','assigned_blocks','blocks','blockCodes','block_codes')) as block_tokens,
      coalesce((
        select array_agg(distinct upper(btrim(a.alias_value)))
        from supplier_catalog_aliases a
        where a.canonical_supplier_id = c.canonical_supplier_id
          and btrim(a.alias_value) <> ''
      ), ARRAY[]::text[]) as aliases,
      case
        -- This is the legacy supplier-code contract used by bunch-label-codec:
        -- it is an alias candidate only when the scoped block also matches.
        when regexp_replace(upper(coalesce(c.canonical_code, '')), '[^0-9]', '', 'g') <> ''
          then 'P' || right('000' || regexp_replace(upper(coalesce(c.canonical_code, '')), '[^0-9]', '', 'g'), 3)
        else left(regexp_replace(upper(coalesce(c.canonical_code, '')), '[^A-Z0-9]', '', 'g'), 6)
      end as legacy_transport_code,
      upper(regexp_replace(btrim(coalesce(c.canonical_name, '')), '\s+', ' ', 'g')) as canonical_name_norm
    from supplier_catalog c
  ), assignment_source as (
    select
      concat('ASSIGNMENT:', assignment.record_id) as source_row_id,
      'CLASIFICACION'::text as source_type,
      coalesce(nullif(left(assignment.payload ->> 'dateTime', 10), '')::date, assignment.created_at::date) as report_date,
      coalesce(nullif(reception.payload ->> 'supplier', ''), 'SIN PROVEEDOR') as supplier,
      coalesce(
         nullif(reception.payload ->> 'supplierId', ''),
         nullif(reception.payload ->> 'supplier_id', ''),
         nullif(reception.payload ->> 'providerId', ''),
         nullif(reception.payload ->> 'provider_id', ''),
         nullif(reception.payload ->> 'canonicalSupplierId', ''),
         nullif(reception.payload ->> 'canonical_supplier_id', ''),
         nullif(assignment.payload ->> 'supplierId', ''),
         nullif(assignment.payload ->> 'supplier_id', ''),
         nullif(assignment.payload ->> 'providerId', ''),
         nullif(assignment.payload ->> 'provider_id', ''),
         nullif(assignment.payload ->> 'canonicalSupplierId', ''),
         nullif(assignment.payload ->> 'canonical_supplier_id', '')
      ) as supplier_id_hint,
      coalesce(
        nullif(reception.payload ->> 'supplierCode', ''),
        nullif(reception.payload ->> 'supplier_code', ''),
        nullif(reception.payload ->> 'providerCode', ''),
        nullif(reception.payload ->> 'provider_code', ''),
        nullif(assignment.payload ->> 'supplierCode', ''),
        nullif(assignment.payload ->> 'supplier_code', ''),
        nullif(assignment.payload ->> 'providerCode', ''),
        nullif(assignment.payload ->> 'provider_code', '')
      ) as supplier_code_hint,
      coalesce(nullif(reception.payload ->> 'block', ''), 'SIN BLOQUE') as block,
      nullif(nullif(regexp_replace(upper(regexp_replace(coalesce(reception.payload ->> 'block', ''), '[^A-Za-z0-9]', '', 'g')), '^(BLOQUE|BQ|B)0*([0-9]+)$', 'B\2'), 'SINBLOQUE'), '') as block_token,
      coalesce(nullif(reception_item.value ->> 'variety', ''), 'SIN VARIEDAD') as variety,
      coalesce(nullif(assignment.payload ->> 'quality', ''), reception_item.value ->> 'quality', '') as quality,
      null::integer as length_cm,
      coalesce(nullif(assignment.payload ->> 'totalStems', '')::numeric, 0) as delivered_stems,
      0::numeric as inventory_stems,
      0::numeric as national_stems,
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
      on reception.company_id = v_source_company_id
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
      where result.company_id = v_source_company_id
        and result.entity = 'operations_classification_results'
        and result.deleted_at is null
        and result.payload ->> 'assignmentId' = assignment.record_id
    ) result_totals on true
    where assignment.company_id = v_source_company_id
      and assignment.entity = 'operations_classifier_assignments'
      and assignment.deleted_at is null
      and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO'
  ), closure_source as (
    select concat('CLOSURE:', result.record_id) as source_row_id,
      'CIERRE_CLASIFICACION'::text as source_type,
      a.report_date, a.supplier, a.supplier_id_hint, a.supplier_code_hint,
      a.block, a.block_token, a.variety,
      coalesce(nullif(btrim(result.payload ->> 'quality'), ''), a.quality) as quality,
      null::integer as length_cm,
      0::numeric as delivered_stems, 0::numeric as inventory_stems,
      coalesce(nullif(result.payload ->> 'nationalStems', '')::numeric, 0) as national_stems,
      a.classification_pending, a.responsible, a.assignment_id,
      null::text as inventory_id, a.reception_id, a.reception_item_id,
      jsonb_build_array(result.record_id) as result_ids
    from assignment_source a
    join public.erp_entity_records result
      on result.company_id = v_source_company_id
      and result.entity = 'operations_classification_results'
      and result.deleted_at is null
      and result.payload ->> 'assignmentId' = a.assignment_id
  ), inventory_source as (
    select
      concat('INVENTORY:', inventory.record_id, ':', component.component_no) as source_row_id,
      'INVENTARIO_BONCHES'::text as source_type,
      coalesce(nullif(left(coalesce(inventory.payload ->> 'admittedAt', inventory.payload ->> 'date'), 10), '')::date, inventory.created_at::date) as report_date,
      coalesce(nullif(component.value ->> 'supplier', ''), nullif(inventory.payload ->> 'supplier', ''), 'SIN PROVEEDOR') as supplier,
      coalesce(
         nullif(component.value ->> 'supplierId', ''),
         nullif(component.value ->> 'supplier_id', ''),
         nullif(component.value ->> 'providerId', ''),
         nullif(component.value ->> 'provider_id', ''),
         nullif(component.value ->> 'canonicalSupplierId', ''),
         nullif(component.value ->> 'canonical_supplier_id', ''),
         nullif(inventory.payload ->> 'supplierId', ''),
         nullif(inventory.payload ->> 'supplier_id', ''),
         nullif(inventory.payload ->> 'providerId', ''),
         nullif(inventory.payload ->> 'provider_id', ''),
         nullif(inventory.payload ->> 'canonicalSupplierId', ''),
         nullif(inventory.payload ->> 'canonical_supplier_id', '')
      ) as supplier_id_hint,
      coalesce(
        nullif(component.value ->> 'supplierCode', ''),
        nullif(component.value ->> 'supplier_code', ''),
        nullif(component.value ->> 'providerCode', ''),
        nullif(component.value ->> 'provider_code', ''),
        nullif(inventory.payload ->> 'supplierCode', ''),
        nullif(inventory.payload ->> 'supplier_code', ''),
        nullif(inventory.payload ->> 'providerCode', ''),
        nullif(inventory.payload ->> 'provider_code', '')
      ) as supplier_code_hint,
      coalesce(nullif(component.value ->> 'block', ''), nullif(inventory.payload ->> 'block', ''), 'SIN BLOQUE') as block,
      nullif(nullif(regexp_replace(upper(regexp_replace(coalesce(component.value ->> 'block', inventory.payload ->> 'block', ''), '[^A-Za-z0-9]', '', 'g')), '^(BLOQUE|BQ|B)0*([0-9]+)$', 'B\2'), 'SINBLOQUE'), '') as block_token,
      coalesce(nullif(inventory.payload ->> 'variety', ''), 'SIN VARIEDAD') as variety,
      coalesce(inventory.payload ->> 'quality', '') as quality,
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
    ) with ordinality as component(value, component_no)
    where inventory.company_id = v_source_company_id
      and inventory.entity = 'operations_rose_inventory'
      and inventory.deleted_at is null
      and upper(coalesce(inventory.payload ->> 'sourceType', '')) = 'ESCANEO_ETIQUETA'
      and upper(coalesce(inventory.payload ->> 'state', '')) <> 'ANULADO'
  ), source_rows as (
    select * from assignment_source
    union all
    select * from closure_source
    union all
    select * from inventory_source
  ), supplier_candidates as (
    select
      s.source_row_id,
      c.canonical_supplier_id,
      c.canonical_code,
      c.canonical_name,
      row_number() over (partition by s.source_row_id order by c.canonical_supplier_id) as candidate_order
    from source_rows s
    join supplier_catalog_matchable c
      on c.supplier_scope = v_source_company_id::text
     and case when nullif(btrim(s.supplier_id_hint), '') is not null
       then upper(btrim(s.supplier_id_hint)) = upper(btrim(c.canonical_supplier_id))
       else (
       (
         nullif(btrim(s.supplier_code_hint), '') is not null
         and upper(btrim(s.supplier_code_hint)) = upper(btrim(c.canonical_code))
       )
       or upper(btrim(s.supplier)) = upper(btrim(c.canonical_code))
       or (
         s.block_token is not null
         and s.block_token = any(c.block_tokens)
         and (
           upper(regexp_replace(btrim(s.supplier), '\s+', ' ', 'g')) = c.canonical_name_norm
           or upper(btrim(s.supplier)) = any(array_append(c.aliases, c.legacy_transport_code))
           or (
             nullif(btrim(s.supplier_code_hint), '') is not null
             and upper(btrim(s.supplier_code_hint)) = any(array_append(c.aliases, c.legacy_transport_code))
           )
         )
       )
     ) end
  ), supplier_candidate_summary as (
    select
      source_row_id,
      count(distinct canonical_supplier_id) as candidate_count,
      min(canonical_supplier_id) as canonical_supplier_id,
      min(canonical_code) as canonical_code,
      min(canonical_name) as canonical_name
    from supplier_candidates
    group by source_row_id
  ), source_resolved as (
    select
      s.*,
      coalesce(summary.candidate_count, 0) as supplier_candidate_count,
      case when summary.candidate_count = 1 then summary.canonical_supplier_id else null end as canonical_supplier_id,
      case when summary.candidate_count = 1 then summary.canonical_code else null end as canonical_code,
      case when summary.candidate_count = 1 then summary.canonical_name else s.supplier end as resolved_supplier,
      case
        when summary.candidate_count = 1 then 'RESOLVED'
        when summary.candidate_count > 1 then 'AMBIGUOUS'
        else 'UNKNOWN'
      end as supplier_resolution,
      case
        when summary.candidate_count = 1 then concat('CANONICAL:', v_source_company_id::text, ':', summary.canonical_supplier_id)
        when summary.candidate_count > 1 then concat('AMBIGUOUS:', v_source_company_id::text, ':', jsonb_build_array(s.source_type, s.supplier_id_hint, s.supplier_code_hint, s.supplier, s.block_token, s.source_row_id)::text)
        else concat('UNKNOWN:', v_source_company_id::text, ':', jsonb_build_array(s.source_type, s.supplier_id_hint, s.supplier_code_hint, s.supplier, s.block_token, s.source_row_id)::text)
      end as supplier_group_key
    from source_rows s
    left join supplier_candidate_summary summary on summary.source_row_id = s.source_row_id
  ), source_filtered as (
    select * from source_resolved
    where report_date >= p_date_from and report_date <= p_date_to
      and (
        nullif(btrim(p_supplier), '') is null
        or resolved_supplier ilike '%' || btrim(p_supplier) || '%'
        or supplier ilike '%' || btrim(p_supplier) || '%'
        or coalesce(canonical_code, '') ilike '%' || btrim(p_supplier) || '%'
      )
      and (nullif(btrim(p_block), '') is null or block ilike '%' || btrim(p_block) || '%')
      and (nullif(btrim(p_variety), '') is null or variety ilike '%' || btrim(p_variety) || '%')
  ), stage_grouped as (
    select
      report_date,
      source_type,
      supplier_group_key,
      resolved_supplier as supplier,
      supplier_resolution,
      canonical_supplier_id,
      canonical_code,
      variety,
      quality,
      coalesce(block_token, 'SIN BLOQUE') as block,
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
    group by source_type, report_date, supplier_group_key, resolved_supplier, supplier_resolution, canonical_supplier_id, canonical_code, block_token, variety, quality
  ), stage_combined as (
    -- Combine independently aggregated stages, never deliveries x scanner rows.
    select report_date, supplier_group_key, supplier, supplier_resolution,
      canonical_supplier_id, canonical_code, block, variety, quality,
      sum(length40) as length40, sum(length50) as length50,
      sum(length60) as length60, sum(length70) as length70,
      sum(length80) as length80, sum(length90) as length90,
      sum(length100) as length100, sum(length110) as length110,
      sum(length120) as length120, sum(length130) as length130,
      sum(delivered_stems) as delivered_stems,
      sum(inventory_stems) as inventory_stems,
      sum(national_stems) as national_stems,
      bool_or(classification_pending) as classification_pending,
      string_agg(distinct responsible, ' + ' order by responsible) as responsible,
      jsonb_agg(assignment_ids) as assignment_id_sets,
      jsonb_agg(inventory_ids) as inventory_id_sets,
      jsonb_agg(reception_ids) as reception_id_sets,
      jsonb_agg(reception_item_ids) as reception_item_id_sets,
      sum(assignment_source_rows) as assignment_source_rows,
      sum(inventory_source_rows) as inventory_source_rows
    from stage_grouped
    group by report_date, supplier_group_key, supplier, supplier_resolution,
      canonical_supplier_id, canonical_code, block, variety, quality
  ), grouped as (
    select c.*,
      coalesce((select jsonb_agg(distinct id.value) from jsonb_array_elements(c.assignment_id_sets) sets cross join lateral jsonb_array_elements(sets.value) id), '[]'::jsonb) as assignment_ids,
      coalesce((select jsonb_agg(distinct id.value) from jsonb_array_elements(c.inventory_id_sets) sets cross join lateral jsonb_array_elements(sets.value) id), '[]'::jsonb) as inventory_ids,
      coalesce((select jsonb_agg(distinct id.value) from jsonb_array_elements(c.reception_id_sets) sets cross join lateral jsonb_array_elements(sets.value) id), '[]'::jsonb) as reception_ids,
      coalesce((select jsonb_agg(distinct id.value) from jsonb_array_elements(c.reception_item_id_sets) sets cross join lateral jsonb_array_elements(sets.value) id), '[]'::jsonb) as reception_item_ids
    from stage_combined c
  ), projected as (
    select *,
      delivered_stems - (inventory_stems + national_stems) as mismatch,
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
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', report_date, supplier, canonical_code, supplier_resolution, supplier_group_key, block, variety, responsible, assignment_ids::text, inventory_ids::text) ilike '%' || btrim(p_search) || '%'
      )
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
      report_date desc, supplier, supplier_group_key, block, variety, quality
    ) as row_number
    from filtered
  ), totals as (
    select
      count(*) as total,
      count(distinct supplier_group_key) as suppliers,
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
    'operatingCompanyId', p_company_id,
    'inventoryOwnerCompanyId', v_source_company_id,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', jsonb_build_array(report_date, supplier_group_key, block, variety, quality)::text,
      'date', report_date, 'dateTime', report_date, 'supplier', supplier, 'block', block,
      'variety', variety, 'quality', quality, 'supplierId', canonical_supplier_id, 'supplierCode', canonical_code,
      'supplierResolution', supplier_resolution, 'supplierIdentityKey', supplier_group_key,
      'supplierScope', v_source_company_id::text,
      'length40', length40, 'length50', length50, 'length60', length60, 'length70', length70,
      'length80', length80, 'length90', length90, 'length100', length100, 'length110', length110,
      'length120', length120, 'length130', length130,
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
      'length40', totals.length40, 'length50', totals.length50,
      'length60', totals.length60, 'length70', totals.length70,
      'length80', totals.length80, 'length90', totals.length90,
      'length100', totals.length100, 'length110', totals.length110,
      'length120', totals.length120, 'length130', totals.length130,
      'classifiedStems', totals.delivered_stems, 'exportedStems', totals.inventory_stems,
      'nationalStems', totals.national_stems, 'mismatch', totals.mismatch,
      'assignmentSourceRows', totals.assignment_source_rows,
      'inventorySourceRows', totals.inventory_source_rows
    ),
    'serverTime', statement_timestamp()
  ) into v_result
  from totals;

  return v_result;
end;
$$;

commit;
