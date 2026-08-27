-- Retenciones de Compras V2: read-models search-first.
-- Exclusivamente lectura. No modifica el flujo transaccional 202608200002/003.

create or replace function public.erp_purchase_withholding_v2_pending_page(
  p_company_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with access_guard as (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ),
  queue as (
    select
      'RETENTION'::text as row_kind,
      purchase.purchase_document_id,
      document.id as electronic_document_id,
      purchase.provider_id,
      coalesce(nullif(btrim(provider.legal_name), ''), nullif(btrim(provider.commercial_name), ''), 'Proveedor sin nombre') as supplier_name,
      coalesce(provider.tax_id, '') as supplier_ruc,
      purchase.external_document_number as purchase_document_number,
      purchase.issue_date as purchase_issue_date,
      document.issue_date as retention_date,
      document.full_number,
      document.status,
      purchase.retention_status,
      purchase.subtotal,
      purchase.tax_total,
      purchase.total as purchase_total,
      coalesce((
        select sum(
          case when coalesce(retention.item ->> 'value', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then (retention.item ->> 'value')::numeric else 0 end
        )
        from jsonb_array_elements(coalesce(document.source_snapshot #> '{withholding,supportingDocuments}', '[]'::jsonb)) support(item)
        cross join lateral jsonb_array_elements(coalesce(support.item -> 'retentions', '[]'::jsonb)) retention(item)
      ), 0)::numeric as total_retained,
      document.access_key,
      document.authorization_number,
      document.authorized_at,
      link.journal_entry_id,
      journal.entry_number as journal_entry_number,
      link.status as link_status,
      greatest(document.updated_at, link.updated_at, purchase.updated_at) as updated_at,
      case when document.status in ('ERROR_ENVIO', 'PENDIENTE_REINTENTO') then 0 else 1 end as priority,
      greatest(document.updated_at, link.updated_at, purchase.updated_at) as sort_date
    from access_guard
    join public.erp_supplier_purchase_withholding_links link
      on link.company_id = p_company_id and link.status = 'ACTIVE'
    join public.erp_supplier_purchase_documents purchase
      on purchase.company_id = link.company_id
     and purchase.purchase_document_id = link.purchase_document_id
    join public.electronic_documents document
      on document.company_id = link.company_id
     and document.id = link.electronic_document_id
     and document.document_type = '07'
    left join public.erp_supplier_providers provider
      on provider.company_id = purchase.company_id and provider.provider_id = purchase.provider_id
    left join public.erp_financial_journal_entries journal
      on journal.company_id = link.company_id and journal.journal_entry_id = link.journal_entry_id
    where document.status in (
      'BORRADOR', 'VALIDADO', 'XML_GENERADO', 'FIRMADO',
      'ENVIADO_SRI', 'RECIBIDO_SRI', 'PENDIENTE_REINTENTO', 'ERROR_ENVIO'
    )

    union all

    select
      'PURCHASE'::text as row_kind,
      purchase.purchase_document_id,
      null::uuid as electronic_document_id,
      purchase.provider_id,
      coalesce(nullif(btrim(provider.legal_name), ''), nullif(btrim(provider.commercial_name), ''), 'Proveedor sin nombre') as supplier_name,
      coalesce(provider.tax_id, '') as supplier_ruc,
      purchase.external_document_number as purchase_document_number,
      purchase.issue_date as purchase_issue_date,
      null::date as retention_date,
      null::text as full_number,
      'PENDING_ISSUANCE'::text as status,
      purchase.retention_status,
      purchase.subtotal,
      purchase.tax_total,
      purchase.total as purchase_total,
      0::numeric as total_retained,
      null::text as access_key,
      null::text as authorization_number,
      null::timestamptz as authorized_at,
      null::uuid as journal_entry_id,
      null::text as journal_entry_number,
      null::text as link_status,
      purchase.updated_at,
      2 as priority,
      purchase.updated_at as sort_date
    from access_guard
    join public.erp_supplier_purchase_documents purchase
      on purchase.company_id = p_company_id
    left join public.erp_supplier_providers provider
      on provider.company_id = purchase.company_id and provider.provider_id = purchase.provider_id
    where purchase.status = 'POSTED'
      and purchase.retention_decision = 'APLICAR'
      and purchase.retention_status = 'PENDING_ISSUANCE'
      and not exists (
        select 1
        from public.erp_supplier_purchase_withholding_links existing_link
        where existing_link.company_id = purchase.company_id
          and existing_link.purchase_document_id = purchase.purchase_document_id
      )
  ),
  page as (
    select *
    from queue
    order by priority, sort_date desc, purchase_document_id
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(to_jsonb(page_row) - 'priority' - 'sort_date' order by page_row.priority, page_row.sort_date desc, page_row.purchase_document_id)
      from page page_row
    ), '[]'::jsonb),
    'total', (select count(*) from queue),
    'limit', least(greatest(coalesce(p_limit, 50), 1), 50),
    'offset', greatest(coalesce(p_offset, 0), 0)
  )
$$;

revoke all on function public.erp_purchase_withholding_v2_pending_page(uuid, integer, integer) from public, anon;
grant execute on function public.erp_purchase_withholding_v2_pending_page(uuid, integer, integer) to authenticated, service_role;

create or replace function public.erp_purchase_withholding_v2_history_page(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_provider_search text default null,
  p_status text default null,
  p_retention_number text default null,
  p_purchase_number text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with access_guard as (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ),
  filtered as (
    select
      document.id as electronic_document_id,
      purchase.purchase_document_id,
      purchase.provider_id,
      coalesce(nullif(btrim(provider.legal_name), ''), nullif(btrim(provider.commercial_name), ''), 'Proveedor sin nombre') as supplier_name,
      coalesce(provider.tax_id, '') as supplier_ruc,
      purchase.external_document_number as purchase_document_number,
      purchase.issue_date as purchase_issue_date,
      document.issue_date as retention_date,
      document.full_number,
      document.status,
      purchase.retention_status,
      coalesce((
        select sum(
          case when coalesce(retention.item ->> 'value', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then (retention.item ->> 'value')::numeric else 0 end
        )
        from jsonb_array_elements(coalesce(document.source_snapshot #> '{withholding,supportingDocuments}', '[]'::jsonb)) support(item)
        cross join lateral jsonb_array_elements(coalesce(support.item -> 'retentions', '[]'::jsonb)) retention(item)
      ), 0)::numeric as total_retained,
      document.access_key,
      document.authorization_number,
      document.authorized_at,
      link.journal_entry_id,
      journal.entry_number as journal_entry_number,
      journal.status as journal_status,
      link.status as link_status,
      document.updated_at
    from access_guard
    join public.erp_supplier_purchase_withholding_links link
      on link.company_id = p_company_id
    join public.erp_supplier_purchase_documents purchase
      on purchase.company_id = link.company_id
     and purchase.purchase_document_id = link.purchase_document_id
    join public.electronic_documents document
      on document.company_id = link.company_id
     and document.id = link.electronic_document_id
     and document.document_type = '07'
    left join public.erp_supplier_providers provider
      on provider.company_id = purchase.company_id and provider.provider_id = purchase.provider_id
    left join public.erp_financial_journal_entries journal
      on journal.company_id = link.company_id and journal.journal_entry_id = link.journal_entry_id
    where (p_date_from is null or document.issue_date >= p_date_from)
      and (p_date_to is null or document.issue_date <= p_date_to)
      and (nullif(btrim(p_status), '') is null or upper(document.status) = upper(btrim(p_status)))
      and (nullif(btrim(p_provider_search), '') is null
        or provider.legal_name ilike '%' || btrim(p_provider_search) || '%'
        or provider.commercial_name ilike '%' || btrim(p_provider_search) || '%'
        or provider.tax_id ilike '%' || btrim(p_provider_search) || '%')
      and (nullif(btrim(p_retention_number), '') is null
        or document.full_number ilike '%' || btrim(p_retention_number) || '%'
        or document.sequential_text ilike '%' || btrim(p_retention_number) || '%')
      and (nullif(btrim(p_purchase_number), '') is null
        or purchase.external_document_number ilike '%' || btrim(p_purchase_number) || '%')
      and (nullif(btrim(p_search), '') is null
        or document.full_number ilike '%' || btrim(p_search) || '%'
        or document.access_key ilike '%' || btrim(p_search) || '%'
        or document.authorization_number ilike '%' || btrim(p_search) || '%'
        or purchase.external_document_number ilike '%' || btrim(p_search) || '%'
        or provider.legal_name ilike '%' || btrim(p_search) || '%'
        or provider.commercial_name ilike '%' || btrim(p_search) || '%'
        or provider.tax_id ilike '%' || btrim(p_search) || '%')
  ),
  page as (
    select *
    from filtered
    order by retention_date desc, full_number desc, electronic_document_id
    limit least(greatest(coalesce(p_limit, 25), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(to_jsonb(page_row) order by page_row.retention_date desc, page_row.full_number desc) from page page_row), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'limit', least(greatest(coalesce(p_limit, 25), 1), 50),
    'offset', greatest(coalesce(p_offset, 0), 0)
  )
$$;

revoke all on function public.erp_purchase_withholding_v2_history_page(uuid, date, date, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.erp_purchase_withholding_v2_history_page(uuid, date, date, text, text, text, text, text, integer, integer) to authenticated, service_role;

create or replace function public.erp_purchase_withholding_v2_detail(
  p_company_id uuid,
  p_purchase_document_id uuid default null,
  p_electronic_document_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.erp_supplier_purchase_documents%rowtype;
  v_provider public.erp_supplier_providers%rowtype;
  v_link public.erp_supplier_purchase_withholding_links%rowtype;
  v_document public.electronic_documents%rowtype;
  v_journal public.erp_financial_journal_entries%rowtype;
begin
  if not exists (
    select 1
    from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'SUPPLIER_WITHHOLDING_V2_ACCESS_DENIED';
  end if;
  if p_purchase_document_id is null and p_electronic_document_id is null then
    raise exception using errcode = '22023', message = 'SUPPLIER_WITHHOLDING_V2_DETAIL_ID_REQUIRED';
  end if;

  if p_electronic_document_id is not null then
    select * into v_link
    from public.erp_supplier_purchase_withholding_links link
    where link.company_id = p_company_id
      and link.electronic_document_id = p_electronic_document_id;
    if not found then
      raise exception using errcode = '23503', message = 'SUPPLIER_WITHHOLDING_V2_LINK_NOT_FOUND';
    end if;
    if p_purchase_document_id is not null and p_purchase_document_id <> v_link.purchase_document_id then
      raise exception using errcode = '23514', message = 'SUPPLIER_WITHHOLDING_V2_DETAIL_MISMATCH';
    end if;
    p_purchase_document_id := v_link.purchase_document_id;
  else
    select * into v_link
    from public.erp_supplier_purchase_withholding_links link
    where link.company_id = p_company_id
      and link.purchase_document_id = p_purchase_document_id;
  end if;

  select * into v_purchase
  from public.erp_supplier_purchase_documents purchase
  where purchase.company_id = p_company_id
    and purchase.purchase_document_id = p_purchase_document_id;
  if not found then
    raise exception using errcode = '23503', message = 'SUPPLIER_WITHHOLDING_V2_PURCHASE_NOT_FOUND';
  end if;

  select * into v_provider
  from public.erp_supplier_providers provider
  where provider.company_id = p_company_id
    and provider.provider_id = v_purchase.provider_id;

  if v_link.electronic_document_id is not null then
    select * into v_document
    from public.electronic_documents document
    where document.company_id = p_company_id
      and document.id = v_link.electronic_document_id
      and document.document_type = '07';
    select * into v_journal
    from public.erp_financial_journal_entries journal
    where journal.company_id = p_company_id
      and journal.journal_entry_id = v_link.journal_entry_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'purchase', to_jsonb(v_purchase),
    'provider', to_jsonb(v_provider),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(line) order by line.line_number)
      from public.erp_supplier_purchase_lines line
      where line.company_id = p_company_id
        and line.purchase_document_id = v_purchase.purchase_document_id
    ), '[]'::jsonb),
    'link', case when v_link.purchase_document_id is null then null else to_jsonb(v_link) end,
    'document', case when v_document.id is null then null else to_jsonb(v_document) end,
    'journal', case when v_journal.journal_entry_id is null then null else to_jsonb(v_journal) end,
    'journalLines', case when v_journal.journal_entry_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(to_jsonb(line) order by line.line_number)
      from public.erp_financial_journal_lines line
      where line.company_id = p_company_id
        and line.journal_entry_id = v_journal.journal_entry_id
    ), '[]'::jsonb) end
  );
end
$$;

revoke all on function public.erp_purchase_withholding_v2_detail(uuid, uuid, uuid) from public, anon;
grant execute on function public.erp_purchase_withholding_v2_detail(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.erp_purchase_withholding_v2_health(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.user_company_memberships membership
    where membership.company_id = p_company_id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'SUPPLIER_WITHHOLDING_V2_ACCESS_DENIED';
  end if;
  return jsonb_build_object(
    'ok', true,
    'component', 'PURCHASE_WITHHOLDING_V2',
    'migration', '202608200002',
    'readModelMigration', '202608230003',
    'linksTable', to_regclass('public.erp_supplier_purchase_withholding_links') is not null,
    'draftRpc', to_regprocedure('public.create_electronic_document_draft(uuid,uuid,text,date,text,text,text,jsonb,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid)') is not null,
    'financialV2', to_regprocedure('public.erp_financial_v2_create_entry_internal(uuid,uuid,text,jsonb,text,text,text)') is not null,
    'pendingReadModel', to_regprocedure('public.erp_purchase_withholding_v2_pending_page(uuid,integer,integer)') is not null,
    'historyReadModel', to_regprocedure('public.erp_purchase_withholding_v2_history_page(uuid,date,date,text,text,text,text,text,integer,integer)') is not null,
    'detailReadModel', to_regprocedure('public.erp_purchase_withholding_v2_detail(uuid,uuid,uuid)') is not null
  );
end
$$;

revoke all on function public.erp_purchase_withholding_v2_health(uuid) from public, anon;
grant execute on function public.erp_purchase_withholding_v2_health(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
