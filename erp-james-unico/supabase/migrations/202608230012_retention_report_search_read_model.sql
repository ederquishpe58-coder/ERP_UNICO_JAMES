-- CONT-B / Punto 5: Reporte unificado de retenciones search-first.
-- READ-ONLY: consume las autoridades existentes de retenciones emitidas y recibidas.

create or replace function public.erp_retention_report_assert_page(p_limit integer, p_offset integer)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if coalesce(p_limit, 0) not in (25, 50) or coalesce(p_offset, -1) < 0 then
    raise exception using errcode = '22023', message = 'RETENTION_REPORT_PAGE_INVALID';
  end if;
end
$$;

create or replace function public.erp_retention_report_rows(p_company_id uuid)
returns table(
  report_type text,
  source text,
  retention_id text,
  line_id text,
  retention_date date,
  third_party_id text,
  third_party_name text,
  third_party_tax_id text,
  origin_document_id text,
  origin_document_number text,
  retention_number text,
  tax_type text,
  retention_code text,
  percentage numeric,
  taxable_base numeric,
  retained_amount numeric,
  status text,
  authorization_number text,
  access_key text,
  journal_entry_id text,
  journal_entry_number text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    'ISSUED'::text,
    'PURCHASE_WITHHOLDING_V2'::text,
    document.id::text,
    concat(document.id::text, ':', support.ordinality::text, ':', retention.ordinality::text),
    document.issue_date,
    purchase.provider_id::text,
    coalesce(nullif(btrim(provider.legal_name), ''), nullif(btrim(provider.commercial_name), ''), 'Proveedor sin nombre'),
    coalesce(provider.tax_id, ''),
    purchase.purchase_document_id::text,
    coalesce(purchase.external_document_number, ''),
    coalesce(document.full_number, document.sequential_text, document.id::text),
    case coalesce(retention.item ->> 'code', '') when '2' then 'IVA' else 'RENTA' end,
    coalesce(retention.item ->> 'retentionCode', ''),
    case when coalesce(retention.item ->> 'rate', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (retention.item ->> 'rate')::numeric else 0 end,
    case when coalesce(retention.item ->> 'taxableBase', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (retention.item ->> 'taxableBase')::numeric else 0 end,
    case when coalesce(retention.item ->> 'value', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (retention.item ->> 'value')::numeric else 0 end,
    upper(coalesce(document.status, 'BORRADOR')),
    coalesce(document.authorization_number, ''),
    coalesce(document.access_key, ''),
    coalesce(link.journal_entry_id::text, ''),
    coalesce(journal.entry_number, ''),
    greatest(document.updated_at, link.updated_at, purchase.updated_at)
  from public.erp_supplier_purchase_withholding_links link
  join public.erp_supplier_purchase_documents purchase
    on purchase.company_id = link.company_id
   and purchase.purchase_document_id = link.purchase_document_id
  join public.electronic_documents document
    on document.company_id = link.company_id
   and document.id = link.electronic_document_id
   and document.document_type = '07'
  left join public.erp_supplier_providers provider
    on provider.company_id = purchase.company_id
   and provider.provider_id = purchase.provider_id
  left join public.erp_financial_journal_entries journal
    on journal.company_id = link.company_id
   and journal.journal_entry_id = link.journal_entry_id
  cross join lateral jsonb_array_elements(coalesce(document.source_snapshot #> '{withholding,supportingDocuments}', '[]'::jsonb))
    with ordinality support(item, ordinality)
  cross join lateral jsonb_array_elements(coalesce(support.item -> 'retentions', '[]'::jsonb))
    with ordinality retention(item, ordinality)
  where link.company_id = p_company_id

  union all

  select
    'ISSUED'::text,
    'LEGACY_ISSUED_HISTORY'::text,
    legacy.record_id,
    concat(legacy.record_id, ':', line.ordinality::text),
    case when coalesce(legacy.payload ->> 'retentionDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (legacy.payload ->> 'retentionDate')::date end,
    ''::text,
    coalesce(legacy.payload ->> 'supplierName', 'Proveedor histórico'),
    coalesce(legacy.payload ->> 'supplierRuc', ''),
    coalesce(legacy.payload ->> 'purchaseId', ''),
    coalesce(legacy.payload ->> 'purchaseDocumentNumber', ''),
    coalesce(nullif(legacy.payload ->> 'fullNumber', ''), nullif(legacy.payload ->> 'draftNumber', ''), legacy.record_id),
    case when upper(coalesce(line.item ->> 'taxType', 'RENTA')) = 'IVA' then 'IVA' else 'RENTA' end,
    coalesce(nullif(line.item ->> 'sriCode', ''), line.item ->> 'code', ''),
    case when coalesce(line.item ->> 'percentage', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (line.item ->> 'percentage')::numeric else 0 end,
    case when coalesce(line.item ->> 'baseAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (line.item ->> 'baseAmount')::numeric else 0 end,
    case when coalesce(line.item ->> 'retainedAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (line.item ->> 'retainedAmount')::numeric else 0 end,
    upper(coalesce(nullif(legacy.payload ->> 'status', ''), 'BORRADOR')),
    coalesce(legacy.payload ->> 'authorizationNumber', ''),
    coalesce(legacy.payload ->> 'accessKey', ''),
    coalesce(legacy.payload ->> 'journalEntryId', ''),
    coalesce(legacy.payload ->> 'journalEntryNumber', ''),
    legacy.updated_at
  from public.erp_entity_records legacy
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(legacy.payload -> 'retentionLines') = 'array'
       and jsonb_array_length(legacy.payload -> 'retentionLines') > 0
        then legacy.payload -> 'retentionLines'
      else
        (case when nullif(coalesce(legacy.payload ->> 'rentSriCode', legacy.payload ->> 'rentCode', ''), '') is not null
          then jsonb_build_array(jsonb_build_object(
            'taxType', 'RENTA', 'sriCode', coalesce(legacy.payload ->> 'rentSriCode', legacy.payload ->> 'rentCode', ''),
            'baseAmount', coalesce(legacy.payload ->> 'rentBaseAmount', '0'), 'percentage', coalesce(legacy.payload ->> 'rentPercentage', '0'),
            'retainedAmount', coalesce(legacy.payload ->> 'rentRetainedAmount', '0')
          )) else '[]'::jsonb end)
        ||
        (case when nullif(coalesce(legacy.payload ->> 'vatSriCode', legacy.payload ->> 'vatCode', ''), '') is not null
          then jsonb_build_array(jsonb_build_object(
            'taxType', 'IVA', 'sriCode', coalesce(legacy.payload ->> 'vatSriCode', legacy.payload ->> 'vatCode', ''),
            'baseAmount', coalesce(legacy.payload ->> 'vatBaseAmount', '0'), 'percentage', coalesce(legacy.payload ->> 'vatPercentage', '0'),
            'retainedAmount', coalesce(legacy.payload ->> 'vatRetainedAmount', '0')
          )) else '[]'::jsonb end)
    end
  ) with ordinality line(item, ordinality)
  where legacy.company_id = p_company_id
    and legacy.entity = 'issued_withholdings'
    and legacy.deleted_at is null
    and not exists (
      select 1
      from public.electronic_documents document
      where document.company_id = p_company_id
        and document.document_type = '07'
        and (
          (nullif(legacy.payload ->> 'sriRemoteDocumentId', '') is not null and document.id::text = legacy.payload ->> 'sriRemoteDocumentId')
          or (nullif(legacy.payload ->> 'accessKey', '') is not null and document.access_key = legacy.payload ->> 'accessKey')
        )
    )

  union all

  select
    'RECEIVED'::text,
    'RECEIVED_WITHHOLDING_READ_V2'::text,
    received.withholding_id,
    concat(received.withholding_id, ':', line.ordinality::text),
    received.issue_date,
    received.resolved_customer_id,
    received.issuer_name,
    received.issuer_tax_id,
    coalesce(nullif(received.related_receivable_id, ''), nullif(received.suggested_receivable_id, ''), ''),
    coalesce(nullif(received.related_receivable_number, ''), nullif(received.suggested_receivable_number, ''), received.support_document_number),
    received.document_number,
    case when upper(coalesce(line.item ->> 'taxType', 'RENTA')) = 'IVA' then 'IVA' else 'RENTA' end,
    coalesce(nullif(line.item ->> 'sriCode', ''), line.item ->> 'code', ''),
    case when coalesce(line.item ->> 'percentage', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (line.item ->> 'percentage')::numeric else 0 end,
    case when coalesce(line.item ->> 'baseAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (line.item ->> 'baseAmount')::numeric else 0 end,
    case when coalesce(line.item ->> 'retainedAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (line.item ->> 'retainedAmount')::numeric else 0 end,
    received.status,
    received.authorization_number,
    received.access_key,
    received.journal_entry_id,
    received.journal_entry_number,
    received.updated_at
  from public.erp_received_withholding_read_rows(p_company_id) received
  join public.erp_entity_records record
    on record.company_id = p_company_id
   and record.entity = 'received_withholdings'
   and record.record_id = received.withholding_id
   and record.deleted_at is null
  cross join lateral jsonb_array_elements(coalesce(record.payload -> 'lines', '[]'::jsonb))
    with ordinality line(item, ordinality)
$$;

create or replace function public.erp_retention_report_health(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok', true,
    'component', 'RETENTION_REPORT_READ_V2',
    'migration', '202608230012',
    'issuedAuthority', to_regclass('public.erp_supplier_purchase_withholding_links') is not null
      and to_regclass('public.electronic_documents') is not null,
    'receivedAuthority', to_regprocedure('public.erp_received_withholding_read_rows(uuid)') is not null,
    'legacyCompatibility', to_regclass('public.erp_entity_records') is not null,
    'page', to_regprocedure('public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer)') is not null,
    'issuedDetail', to_regprocedure('public.erp_purchase_withholding_v2_detail(uuid,uuid,uuid)') is not null,
    'receivedDetail', to_regprocedure('public.erp_received_withholding_detail(uuid,text)') is not null
  );
end
$$;

create or replace function public.erp_retention_report_legacy_detail(p_company_id uuid, p_retention_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_record public.erp_entity_records%rowtype;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  select * into v_record
  from public.erp_entity_records
  where company_id = p_company_id and entity = 'issued_withholdings'
    and record_id = p_retention_id and deleted_at is null;
  if v_record.id is null then
    raise exception using errcode = 'P0002', message = 'RETENTION_REPORT_LEGACY_NOT_FOUND';
  end if;
  return jsonb_build_object('ok', true, 'item', v_record.payload || jsonb_build_object(
    'id', v_record.record_id, 'version', v_record.version, 'updatedAt', v_record.updated_at
  ));
end
$$;

create or replace function public.erp_retention_report_page(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_type text default 'ALL',
  p_status text default null,
  p_supplier_id text default null,
  p_customer_id text default null,
  p_retention_code text default null,
  p_retention_number text default null,
  p_document_number text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := upper(coalesce(nullif(btrim(p_type), ''), 'ALL'));
  v_items jsonb;
  v_total bigint;
  v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_retention_report_assert_page(p_limit, p_offset);
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'RETENTION_REPORT_DATE_RANGE_REQUIRED';
  end if;
  if v_type not in ('ALL', 'ISSUED', 'RECEIVED') then
    raise exception using errcode = '22023', message = 'RETENTION_REPORT_TYPE_INVALID';
  end if;

  with filtered as (
    select row.*
    from public.erp_retention_report_rows(p_company_id) row
    where row.retention_date between p_date_from and p_date_to
      and (v_type = 'ALL' or row.report_type = v_type)
      and (nullif(upper(btrim(p_status)), '') is null or row.status = upper(btrim(p_status)))
      and (nullif(btrim(p_supplier_id), '') is null or (row.report_type = 'ISSUED' and row.third_party_id = btrim(p_supplier_id)))
      and (nullif(btrim(p_customer_id), '') is null or (row.report_type = 'RECEIVED' and row.third_party_id = btrim(p_customer_id)))
      and (nullif(btrim(p_retention_code), '') is null or row.retention_code ilike '%' || btrim(p_retention_code) || '%')
      and (nullif(btrim(p_retention_number), '') is null or row.retention_number ilike '%' || btrim(p_retention_number) || '%')
      and (nullif(btrim(p_document_number), '') is null or row.origin_document_number ilike '%' || btrim(p_document_number) || '%')
      and (nullif(lower(btrim(p_search)), '') is null or lower(concat_ws(' ',
        row.third_party_name, row.third_party_tax_id, row.origin_document_number, row.retention_number,
        row.retention_code, row.authorization_number, row.access_key, row.journal_entry_number
      )) like '%' || lower(btrim(p_search)) || '%')
  )
  select count(*), jsonb_build_object(
    'rowCount', count(*),
    'documentCount', count(distinct report_type || ':' || retention_id),
    'issuedDocuments', count(distinct retention_id) filter (where report_type = 'ISSUED'),
    'receivedDocuments', count(distinct retention_id) filter (where report_type = 'RECEIVED'),
    'taxableBase', coalesce(sum(taxable_base), 0),
    'rentRetained', coalesce(sum(retained_amount) filter (where tax_type = 'RENTA'), 0),
    'vatRetained', coalesce(sum(retained_amount) filter (where tax_type = 'IVA'), 0),
    'totalRetained', coalesce(sum(retained_amount), 0),
    'issuedTotal', coalesce(sum(retained_amount) filter (where report_type = 'ISSUED'), 0),
    'receivedTotal', coalesce(sum(retained_amount) filter (where report_type = 'RECEIVED'), 0)
  ) into v_total, v_summary
  from filtered;

  with filtered as (
    select row.*
    from public.erp_retention_report_rows(p_company_id) row
    where row.retention_date between p_date_from and p_date_to
      and (v_type = 'ALL' or row.report_type = v_type)
      and (nullif(upper(btrim(p_status)), '') is null or row.status = upper(btrim(p_status)))
      and (nullif(btrim(p_supplier_id), '') is null or (row.report_type = 'ISSUED' and row.third_party_id = btrim(p_supplier_id)))
      and (nullif(btrim(p_customer_id), '') is null or (row.report_type = 'RECEIVED' and row.third_party_id = btrim(p_customer_id)))
      and (nullif(btrim(p_retention_code), '') is null or row.retention_code ilike '%' || btrim(p_retention_code) || '%')
      and (nullif(btrim(p_retention_number), '') is null or row.retention_number ilike '%' || btrim(p_retention_number) || '%')
      and (nullif(btrim(p_document_number), '') is null or row.origin_document_number ilike '%' || btrim(p_document_number) || '%')
      and (nullif(lower(btrim(p_search)), '') is null or lower(concat_ws(' ',
        row.third_party_name, row.third_party_tax_id, row.origin_document_number, row.retention_number,
        row.retention_code, row.authorization_number, row.access_key, row.journal_entry_number
      )) like '%' || lower(btrim(p_search)) || '%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', report_type,
    'source', source,
    'retentionId', retention_id,
    'lineId', line_id,
    'date', retention_date,
    'thirdPartyId', third_party_id,
    'thirdPartyName', third_party_name,
    'thirdPartyTaxId', third_party_tax_id,
    'originDocumentId', origin_document_id,
    'originDocumentNumber', origin_document_number,
    'retentionNumber', retention_number,
    'taxType', tax_type,
    'retentionCode', retention_code,
    'percentage', percentage,
    'taxableBase', taxable_base,
    'retainedAmount', retained_amount,
    'status', status,
    'authorizationNumber', authorization_number,
    'accessKey', access_key,
    'journalEntryId', journal_entry_id,
    'journalEntryNumber', journal_entry_number,
    'updatedAt', updated_at
  ) order by retention_date desc, retention_number desc, line_id), '[]'::jsonb)
  into v_items
  from (
    select * from filtered
    order by retention_date desc, retention_number desc, line_id
    limit p_limit offset p_offset
  ) page;

  return jsonb_build_object(
    'ok', true,
    'items', v_items,
    'total', v_total,
    'summary', v_summary,
    'limit', p_limit,
    'offset', p_offset
  );
end
$$;

revoke all on function public.erp_retention_report_assert_page(integer, integer) from public, anon;
revoke all on function public.erp_retention_report_rows(uuid) from public, anon;
revoke all on function public.erp_retention_report_health(uuid) from public, anon;
revoke all on function public.erp_retention_report_legacy_detail(uuid,text) from public, anon;
revoke all on function public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.erp_retention_report_health(uuid) to authenticated, service_role;
grant execute on function public.erp_retention_report_legacy_detail(uuid,text) to authenticated, service_role;
grant execute on function public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) to authenticated, service_role;

comment on function public.erp_retention_report_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) is
  'READ-ONLY. Una fila por linea/codigo de retencion; resumen por universo tributario filtrado y fechas de emision inclusivas.';

select pg_notify('pgrst', 'reload schema');
