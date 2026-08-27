begin;

-- Sincroniza en V2 la fecha efectiva de una venta LOCAL únicamente después de
-- que el backend SRI creó el borrador canónico. No modifica el comprobante,
-- su clave, su secuencial ni artefactos XML.
create or replace function public.erp_patch_commercial_order_sri_issue_date(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_record_id text,
  p_document_id uuid,
  p_expected_version bigint,
  p_issue_date date,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.erp_entity_records%rowtype;
  v_document public.electronic_documents%rowtype;
  v_prior public.erp_operations_commands%rowtype;
  v_payload jsonb;
  v_saved jsonb;
  v_result jsonb;
  v_original_issue_date text;
begin
  perform public.erp_warehouse_v2_assert_access(p_company_id);
  if p_operation_id is null
     or nullif(btrim(p_device_id), '') is null
     or nullif(btrim(p_record_id), '') is null
     or p_document_id is null
     or p_issue_date is null
     or coalesce(p_expected_version, 0) < 1 then
    raise exception using errcode = '22023', message = 'COMMERCIAL_ORDER_SRI_DATE_PATCH_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':COMMERCIAL_SRI_DATE:' || p_record_id,
    0
  ));
  select * into v_prior
  from public.erp_operations_commands
  where operation_id = p_operation_id
    and company_id = p_company_id;
  if found then return v_prior.result; end if;

  select * into v_order
  from public.erp_entity_records record
  where record.company_id = p_company_id
    and record.entity = 'commercial_orders'
    and record.record_id = p_record_id
    and record.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COMMERCIAL_ORDER_NOT_FOUND';
  end if;
  if v_order.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = format(
      'COMMERCIAL_ORDER_VERSION_CONFLICT:SERVER_%s:CLIENT_%s',
      v_order.version,
      p_expected_version
    );
  end if;
  if upper(coalesce(v_order.payload ->> 'saleType', v_order.payload ->> 'tipoVenta', ''))
     not in ('LOCAL', 'VENTA_LOCAL') then
    raise exception using errcode = '23514', message = 'COMMERCIAL_ORDER_SRI_DATE_REQUIRES_LOCAL_SALE';
  end if;

  select * into v_document
  from public.electronic_documents document
  where document.id = p_document_id
    and document.company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.document_type <> '01'
     or v_document.environment <> 'TEST'
     or v_document.status <> 'BORRADOR'
     or coalesce(
       v_document.source_order_id::text,
       nullif(v_document.source_snapshot #>> '{erpEmission,sourceOrderId}', '')
     ) <> p_record_id
     or v_document.issue_date <> p_issue_date then
    raise exception using errcode = '23514', message = 'COMMERCIAL_ORDER_SRI_DATE_DOCUMENT_MISMATCH';
  end if;

  v_original_issue_date := coalesce(
    nullif(v_order.payload ->> 'sriOriginalIssueDate', ''),
    nullif(v_order.payload ->> 'issuedAt', ''),
    p_issue_date::text
  );
  v_payload := v_order.payload || jsonb_build_object(
    'issuedAt', p_issue_date::text,
    'sriIssueDate', p_issue_date::text,
    'sriOriginalIssueDate', v_original_issue_date,
    'localSriIssueDateAdjustedAt', clock_timestamp(),
    'localSriIssueDateAdjustedBy', auth.uid()::text,
    'status', v_order.payload -> 'status',
    'warehouseStatus', v_order.payload -> 'warehouseStatus',
    'fulfillmentStatus', v_order.payload -> 'fulfillmentStatus'
  );
  v_saved := public.erp_operations_v2_write_record(
    p_company_id,
    p_operation_id,
    p_device_id,
    'commercial_orders',
    p_record_id,
    v_payload,
    v_order.version
  );
  v_result := jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'serverTime', clock_timestamp(),
    'serverRecord', v_saved,
    'result', jsonb_build_object(
      'status', 'SRI_ISSUE_DATE_UPDATED',
      'documentId', p_document_id,
      'issueDate', p_issue_date
    )
  );
  insert into public.erp_operations_commands(
    operation_id, company_id, command_type, source_record_id, request_payload,
    result, status, user_id, device_id, local_created_at
  ) values (
    p_operation_id, p_company_id, 'UPDATE_ORDER_SRI_ISSUE_DATE', p_record_id,
    jsonb_build_object('documentId', p_document_id, 'issueDate', p_issue_date),
    v_result, 'CONFIRMED', auth.uid(), p_device_id, coalesce(p_local_created_at, now())
  );
  return v_result;
end;
$$;

revoke all on function public.erp_patch_commercial_order_sri_issue_date(
  uuid, uuid, text, text, uuid, bigint, date, timestamptz
) from public, anon;
grant execute on function public.erp_patch_commercial_order_sri_issue_date(
  uuid, uuid, text, text, uuid, bigint, date, timestamptz
) to authenticated, service_role;

comment on function public.erp_patch_commercial_order_sri_issue_date(
  uuid, uuid, text, text, uuid, bigint, date, timestamptz
) is 'Patches the canonical LOCAL commercial order date only from its matching TEST SRI draft with optimistic concurrency.';

commit;
