begin;

-- Read-models únicamente de consulta. No duplican recepciones, entregas ni
-- resultados y preservan el lineage por UUID almacenado en los payloads V2.
create or replace function public.erp_operations_v2_list_reception_lines(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_supplier text default null,
  p_block text default null,
  p_variety text default null,
  p_status text default null,
  p_search text default null,
  p_only_pending boolean default false,
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
  v_page_size integer := case when p_page_size = 50 then 50 else 25 end;
  v_total bigint := 0;
  v_total_pages integer := 1;
  v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'OPERATIONS_V2_READ_FORBIDDEN';
  end if;

  with reception_lines as (
    select
      reception.record_id as reception_id,
      item.value ->> 'id' as reception_item_id,
      coalesce(nullif(reception.payload ->> 'date', ''), left(reception.payload ->> 'createdAt', 10), reception.created_at::date::text)::date as reception_date,
      coalesce(nullif(reception.payload ->> 'createdAt', ''), reception.created_at::text) as date_time,
      reception.payload ->> 'supplierId' as supplier_id,
      reception.payload ->> 'supplier' as supplier,
      reception.payload ->> 'block' as block,
      item.value ->> 'variety' as variety,
      coalesce(nullif(item.value ->> 'stemType', ''), 'LARGO') as stem_type,
      coalesce(nullif(item.value ->> 'meshCount', '')::numeric, 0) as mesh_count,
      coalesce(nullif(item.value ->> 'stemsPerMesh', '')::numeric, 0) as stems_per_mesh,
      coalesce(nullif(item.value ->> 'extraStems', '')::numeric, 0) as extra_stems,
      coalesce(nullif(item.value ->> 'totalStems', '')::numeric, 0) as received_stems,
      coalesce(delivery.delivered_stems, 0) as delivered_stems,
      greatest(coalesce(nullif(item.value ->> 'totalStems', '')::numeric, 0) - coalesce(delivery.delivered_stems, 0), 0) as pending_stems,
      upper(coalesce(reception.payload ->> 'status', 'PENDIENTE')) as reception_status,
      reception.payload ->> 'observation' as observation,
      reception.version,
      reception.updated_at
    from public.erp_entity_records reception
    cross join lateral jsonb_array_elements(coalesce(reception.payload -> 'items', '[]'::jsonb)) item(value)
    left join lateral (
      select coalesce(sum(coalesce(nullif(assignment.payload ->> 'totalStems', '')::numeric, 0)), 0) as delivered_stems
      from public.erp_entity_records assignment
      where assignment.company_id = p_company_id
        and assignment.entity = 'operations_classifier_assignments'
        and assignment.deleted_at is null
        and assignment.payload ->> 'receptionId' = reception.record_id
        and assignment.payload ->> 'receptionItemId' = item.value ->> 'id'
        and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO'
    ) delivery on true
    where reception.company_id = p_company_id
      and reception.entity = 'operations_receptions'
      and reception.deleted_at is null
  ), filtered as (
    select *, case
      when reception_status = 'ANULADO' then 'ANULADO'
      when pending_stems = 0 and received_stems > 0 then 'COMPLETO'
      when delivered_stems > 0 then 'PARCIAL'
      else 'PENDIENTE'
    end as public_status
    from reception_lines
    where (p_date_from is null or reception_date >= p_date_from)
      and (p_date_to is null or reception_date <= p_date_to)
      and (nullif(btrim(p_supplier), '') is null or supplier ilike '%' || btrim(p_supplier) || '%')
      and (nullif(btrim(p_block), '') is null or block ilike '%' || btrim(p_block) || '%')
      and (nullif(btrim(p_variety), '') is null or variety ilike '%' || btrim(p_variety) || '%')
      and (not coalesce(p_only_pending, false) or pending_stems > 0)
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', reception_id, reception_item_id, supplier, block, variety, stem_type, observation) ilike '%' || btrim(p_search) || '%')
  )
  select count(*) into v_total from filtered
  where nullif(btrim(p_status), '') is null or public_status = upper(btrim(p_status));

  v_total_pages := greatest(1, ceil(v_total::numeric / v_page_size)::integer);
  v_page := least(v_page, v_total_pages);

  with reception_lines as (
    select
      reception.record_id as reception_id,
      item.value ->> 'id' as reception_item_id,
      coalesce(nullif(reception.payload ->> 'date', ''), left(reception.payload ->> 'createdAt', 10), reception.created_at::date::text)::date as reception_date,
      coalesce(nullif(reception.payload ->> 'createdAt', ''), reception.created_at::text) as date_time,
      reception.payload ->> 'supplierId' as supplier_id,
      reception.payload ->> 'supplier' as supplier,
      reception.payload ->> 'block' as block,
      item.value ->> 'variety' as variety,
      coalesce(nullif(item.value ->> 'stemType', ''), 'LARGO') as stem_type,
      coalesce(nullif(item.value ->> 'meshCount', '')::numeric, 0) as mesh_count,
      coalesce(nullif(item.value ->> 'stemsPerMesh', '')::numeric, 0) as stems_per_mesh,
      coalesce(nullif(item.value ->> 'extraStems', '')::numeric, 0) as extra_stems,
      coalesce(nullif(item.value ->> 'totalStems', '')::numeric, 0) as received_stems,
      coalesce(delivery.delivered_stems, 0) as delivered_stems,
      greatest(coalesce(nullif(item.value ->> 'totalStems', '')::numeric, 0) - coalesce(delivery.delivered_stems, 0), 0) as pending_stems,
      upper(coalesce(reception.payload ->> 'status', 'PENDIENTE')) as reception_status,
      reception.payload ->> 'observation' as observation,
      reception.version,
      reception.updated_at
    from public.erp_entity_records reception
    cross join lateral jsonb_array_elements(coalesce(reception.payload -> 'items', '[]'::jsonb)) item(value)
    left join lateral (
      select coalesce(sum(coalesce(nullif(assignment.payload ->> 'totalStems', '')::numeric, 0)), 0) as delivered_stems
      from public.erp_entity_records assignment
      where assignment.company_id = p_company_id and assignment.entity = 'operations_classifier_assignments'
        and assignment.deleted_at is null
        and assignment.payload ->> 'receptionId' = reception.record_id
        and assignment.payload ->> 'receptionItemId' = item.value ->> 'id'
        and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO'
    ) delivery on true
    where reception.company_id = p_company_id and reception.entity = 'operations_receptions' and reception.deleted_at is null
  ), filtered as (
    select *, case when reception_status = 'ANULADO' then 'ANULADO' when pending_stems = 0 and received_stems > 0 then 'COMPLETO' when delivered_stems > 0 then 'PARCIAL' else 'PENDIENTE' end as public_status
    from reception_lines
    where (p_date_from is null or reception_date >= p_date_from) and (p_date_to is null or reception_date <= p_date_to)
      and (nullif(btrim(p_supplier), '') is null or supplier ilike '%' || btrim(p_supplier) || '%')
      and (nullif(btrim(p_block), '') is null or block ilike '%' || btrim(p_block) || '%')
      and (nullif(btrim(p_variety), '') is null or variety ilike '%' || btrim(p_variety) || '%')
      and (not coalesce(p_only_pending, false) or pending_stems > 0)
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', reception_id, reception_item_id, supplier, block, variety, stem_type, observation) ilike '%' || btrim(p_search) || '%')
  ), page_rows as (
    select * from filtered
    where nullif(btrim(p_status), '') is null or public_status = upper(btrim(p_status))
    order by reception_date desc, date_time desc, reception_id desc, reception_item_id
    offset (v_page - 1) * v_page_size limit v_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'receptionId', reception_id, 'receptionItemId', reception_item_id, 'date', reception_date,
    'dateTime', date_time, 'supplierId', supplier_id, 'supplier', supplier, 'block', block,
    'variety', variety, 'stemType', stem_type, 'meshCount', mesh_count, 'stemsPerMesh', stems_per_mesh,
    'extraStems', extra_stems, 'receivedStems', received_stems, 'deliveredStems', delivered_stems,
    'pendingStems', pending_stems, 'status', public_status, 'receptionStatus', reception_status,
    'observation', observation, 'version', version, 'updatedAt', updated_at
  ) order by reception_date desc, date_time desc, reception_id desc, reception_item_id), '[]'::jsonb)
  into v_items from page_rows;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'page', v_page,
    'pageSize', v_page_size, 'totalPages', v_total_pages, 'serverTime', statement_timestamp());
end;
$$;

create or replace function public.erp_operations_v2_list_classification_deliveries(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_supplier text default null,
  p_block text default null,
  p_variety text default null,
  p_status text default null,
  p_search text default null,
  p_classifier text default null,
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
  v_page_size integer := case when p_page_size = 50 then 50 else 25 end;
  v_total bigint := 0;
  v_total_pages integer := 1;
  v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.erp_is_company_member(p_company_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'OPERATIONS_V2_READ_FORBIDDEN';
  end if;

  with assignments as (
    select assignment.record_id, assignment.payload,
      coalesce(nullif(assignment.payload ->> 'deliveryGroupId', ''), 'LEGACY:' || assignment.record_id) as delivery_group_id,
      coalesce(nullif(left(assignment.payload ->> 'dateTime', 10), '')::date, assignment.created_at::date) as delivery_date,
      coalesce(results.national_stems, 0) as national_stems,
      coalesce(results.national_general_stems, 0) as national_general_stems,
      coalesce(results.national_oidio_stems, 0) as national_oidio_stems,
      coalesce(results.national_velloso_stems, 0) as national_velloso_stems,
      coalesce(results.national_botrytis_stems, 0) as national_botrytis_stems,
      coalesce(results.national_maltrato_stems, 0) as national_maltrato_stems,
      coalesce(results.result_ids, '[]'::jsonb) as result_ids
    from public.erp_entity_records assignment
    left join lateral (
      select
        sum(coalesce(nullif(result.payload ->> 'nationalStems', '')::numeric, 0)) as national_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalGeneralStems', '')::numeric, 0)) as national_general_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalOidioStems', '')::numeric, 0)) as national_oidio_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalVellosoStems', '')::numeric, 0)) as national_velloso_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalBotrytisStems', '')::numeric, 0)) as national_botrytis_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalMaltratoStems', '')::numeric, 0)) as national_maltrato_stems,
        jsonb_agg(result.record_id order by result.record_id) as result_ids
      from public.erp_entity_records result
      where result.company_id = p_company_id and result.entity = 'operations_classification_results'
        and result.deleted_at is null and result.payload ->> 'assignmentId' = assignment.record_id
    ) results on true
    where assignment.company_id = p_company_id and assignment.entity = 'operations_classifier_assignments'
      and assignment.deleted_at is null and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO'
  ), grouped as (
    select delivery_group_id,
      max(payload ->> 'dateTime') as date_time, max(delivery_date) as delivery_date,
      max(payload ->> 'classifier') as classifier, max(payload ->> 'classifier_employee_id') as classifier_employee_id,
      max(payload ->> 'supplier') as supplier, max(payload ->> 'block') as block,
      max(payload ->> 'variety') as variety, max(coalesce(nullif(payload ->> 'stemType', ''), 'LARGO')) as stem_type,
      coalesce(max(nullif(payload ->> 'deliveryRequestedMeshes', '')::numeric), sum(coalesce(nullif(payload ->> 'meshCount', '')::numeric, 0))) as mesh_count,
      coalesce(max(nullif(payload ->> 'deliveryRequestedExtraStems', '')::numeric), sum(coalesce(nullif(payload ->> 'extraStems', '')::numeric, 0))) as extra_stems,
      sum(coalesce(nullif(payload ->> 'totalStems', '')::numeric, 0)) as total_stems,
      sum(national_stems) as national_stems, sum(national_general_stems) as national_general_stems,
      sum(national_oidio_stems) as national_oidio_stems, sum(national_velloso_stems) as national_velloso_stems,
      sum(national_botrytis_stems) as national_botrytis_stems, sum(national_maltrato_stems) as national_maltrato_stems,
      jsonb_agg(record_id order by record_id) as assignment_ids,
      jsonb_agg(distinct payload ->> 'receptionId') as reception_ids,
      jsonb_agg(distinct payload ->> 'receptionItemId') as reception_item_ids,
      coalesce(jsonb_agg(result_ids), '[]'::jsonb) as result_id_groups,
      case when sum(national_stems) > 0 or bool_or(upper(coalesce(payload ->> 'status', '')) in ('COMPLETADO','ENTREGADO + REGISTRADO NACIONAL')) then 'ENTREGADO + REGISTRADO NACIONAL' else 'ENTREGADO' end as public_status
    from assignments group by delivery_group_id
  ), filtered as (
    select * from grouped
    where (p_date_from is null or delivery_date >= p_date_from) and (p_date_to is null or delivery_date <= p_date_to)
      and (nullif(btrim(p_supplier), '') is null or supplier ilike '%' || btrim(p_supplier) || '%')
      and (nullif(btrim(p_block), '') is null or block ilike '%' || btrim(p_block) || '%')
      and (nullif(btrim(p_variety), '') is null or variety ilike '%' || btrim(p_variety) || '%')
      and (nullif(btrim(p_classifier), '') is null or classifier ilike '%' || btrim(p_classifier) || '%')
      and (nullif(btrim(p_status), '') is null or public_status = upper(btrim(p_status)))
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', delivery_group_id, classifier, supplier, block, variety, stem_type) ilike '%' || btrim(p_search) || '%')
  ) select count(*) into v_total from filtered;

  v_total_pages := greatest(1, ceil(v_total::numeric / v_page_size)::integer);
  v_page := least(v_page, v_total_pages);

  -- Se repite la CTE deliberadamente para mantener la función estable y sin tablas/materializaciones auxiliares.
  with assignments as (
    select assignment.record_id, assignment.payload,
      coalesce(nullif(assignment.payload ->> 'deliveryGroupId', ''), 'LEGACY:' || assignment.record_id) as delivery_group_id,
      coalesce(nullif(left(assignment.payload ->> 'dateTime', 10), '')::date, assignment.created_at::date) as delivery_date,
      coalesce(results.national_stems, 0) as national_stems,
      coalesce(results.national_general_stems, 0) as national_general_stems,
      coalesce(results.national_oidio_stems, 0) as national_oidio_stems,
      coalesce(results.national_velloso_stems, 0) as national_velloso_stems,
      coalesce(results.national_botrytis_stems, 0) as national_botrytis_stems,
      coalesce(results.national_maltrato_stems, 0) as national_maltrato_stems,
      coalesce(results.result_ids, '[]'::jsonb) as result_ids
    from public.erp_entity_records assignment
    left join lateral (
      select sum(coalesce(nullif(result.payload ->> 'nationalStems', '')::numeric, 0)) as national_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalGeneralStems', '')::numeric, 0)) as national_general_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalOidioStems', '')::numeric, 0)) as national_oidio_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalVellosoStems', '')::numeric, 0)) as national_velloso_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalBotrytisStems', '')::numeric, 0)) as national_botrytis_stems,
        sum(coalesce(nullif(result.payload ->> 'nationalMaltratoStems', '')::numeric, 0)) as national_maltrato_stems,
        jsonb_agg(result.record_id order by result.record_id) as result_ids
      from public.erp_entity_records result where result.company_id = p_company_id and result.entity = 'operations_classification_results'
        and result.deleted_at is null and result.payload ->> 'assignmentId' = assignment.record_id
    ) results on true
    where assignment.company_id = p_company_id and assignment.entity = 'operations_classifier_assignments'
      and assignment.deleted_at is null and upper(coalesce(assignment.payload ->> 'status', '')) <> 'ANULADO'
  ), grouped as (
    select delivery_group_id, max(payload ->> 'dateTime') as date_time, max(delivery_date) as delivery_date,
      max(payload ->> 'classifier') as classifier, max(payload ->> 'classifier_employee_id') as classifier_employee_id,
      max(payload ->> 'supplier') as supplier, max(payload ->> 'block') as block, max(payload ->> 'variety') as variety,
      max(coalesce(nullif(payload ->> 'stemType', ''), 'LARGO')) as stem_type,
      coalesce(max(nullif(payload ->> 'deliveryRequestedMeshes', '')::numeric), sum(coalesce(nullif(payload ->> 'meshCount', '')::numeric, 0))) as mesh_count,
      coalesce(max(nullif(payload ->> 'deliveryRequestedExtraStems', '')::numeric), sum(coalesce(nullif(payload ->> 'extraStems', '')::numeric, 0))) as extra_stems,
      sum(coalesce(nullif(payload ->> 'totalStems', '')::numeric, 0)) as total_stems,
      sum(national_stems) as national_stems, sum(national_general_stems) as national_general_stems,
      sum(national_oidio_stems) as national_oidio_stems, sum(national_velloso_stems) as national_velloso_stems,
      sum(national_botrytis_stems) as national_botrytis_stems, sum(national_maltrato_stems) as national_maltrato_stems,
      jsonb_agg(record_id order by record_id) as assignment_ids,
      jsonb_agg(distinct payload ->> 'receptionId') as reception_ids,
      jsonb_agg(distinct payload ->> 'receptionItemId') as reception_item_ids,
      jsonb_agg(result_ids order by record_id) as result_id_groups,
      case when sum(national_stems) > 0 or bool_or(upper(coalesce(payload ->> 'status', '')) in ('COMPLETADO','ENTREGADO + REGISTRADO NACIONAL')) then 'ENTREGADO + REGISTRADO NACIONAL' else 'ENTREGADO' end as public_status
    from assignments group by delivery_group_id
  ), filtered as (
    select * from grouped where (p_date_from is null or delivery_date >= p_date_from) and (p_date_to is null or delivery_date <= p_date_to)
      and (nullif(btrim(p_supplier), '') is null or supplier ilike '%' || btrim(p_supplier) || '%')
      and (nullif(btrim(p_block), '') is null or block ilike '%' || btrim(p_block) || '%')
      and (nullif(btrim(p_variety), '') is null or variety ilike '%' || btrim(p_variety) || '%')
      and (nullif(btrim(p_classifier), '') is null or classifier ilike '%' || btrim(p_classifier) || '%')
      and (nullif(btrim(p_status), '') is null or public_status = upper(btrim(p_status)))
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', delivery_group_id, classifier, supplier, block, variety, stem_type) ilike '%' || btrim(p_search) || '%')
  ), page_rows as (
    select * from filtered order by delivery_date desc, date_time desc, delivery_group_id desc
    offset (v_page - 1) * v_page_size limit v_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'deliveryGroupId', delivery_group_id, 'date', delivery_date, 'dateTime', date_time,
    'classifier', classifier, 'classifierEmployeeId', classifier_employee_id, 'supplier', supplier,
    'block', block, 'variety', variety, 'stemType', stem_type, 'meshCount', mesh_count,
    'extraStems', extra_stems, 'totalStems', total_stems, 'nationalStems', national_stems,
    'nationalGeneralStems', national_general_stems, 'nationalOidioStems', national_oidio_stems,
    'nationalVellosoStems', national_velloso_stems, 'nationalBotrytisStems', national_botrytis_stems,
    'nationalMaltratoStems', national_maltrato_stems, 'status', public_status,
    'assignmentIds', assignment_ids, 'receptionIds', reception_ids, 'receptionItemIds', reception_item_ids,
    'resultIdGroups', result_id_groups
  ) order by delivery_date desc, date_time desc, delivery_group_id desc), '[]'::jsonb)
  into v_items from page_rows;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'page', v_page,
    'pageSize', v_page_size, 'totalPages', v_total_pages, 'serverTime', statement_timestamp());
end;
$$;

revoke all on function public.erp_operations_v2_list_reception_lines(uuid,date,date,text,text,text,text,text,boolean,integer,integer) from public, anon;
grant execute on function public.erp_operations_v2_list_reception_lines(uuid,date,date,text,text,text,text,text,boolean,integer,integer) to authenticated, service_role;
revoke all on function public.erp_operations_v2_list_classification_deliveries(uuid,date,date,text,text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.erp_operations_v2_list_classification_deliveries(uuid,date,date,text,text,text,text,text,text,integer,integer) to authenticated, service_role;

commit;
