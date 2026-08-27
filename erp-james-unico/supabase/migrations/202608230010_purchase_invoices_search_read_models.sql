-- Facturas de compra: lectura bajo demanda sobre Purchase/Supplier Finance V2.
-- Solo lectura. Conserva legacy histórico deduplicado sin usarlo como autoridad de nuevas operaciones.

create index if not exists erp_supplier_purchase_history_issue_idx
  on public.erp_supplier_purchase_documents(company_id, issue_date desc, purchase_document_id);
create index if not exists erp_supplier_purchase_history_accounting_idx
  on public.erp_supplier_purchase_documents(company_id, accounting_date desc, purchase_document_id);
create index if not exists erp_supplier_purchase_history_provider_idx
  on public.erp_supplier_purchase_documents(company_id, provider_id, issue_date desc);

create or replace function public.erp_purchase_invoices_assert_page(p_limit integer, p_offset integer)
returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p_limit not in (25,50) or p_offset < 0 then
    raise exception using errcode='22023',message='PURCHASE_INVOICE_PAGE_INVALID';
  end if;
end $$;

create or replace function public.erp_purchase_invoices_read_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object('ok',true,'component','PURCHASE_INVOICES_READ_V2','migration','202608230010',
    'historyPage',true,'detail',true,'xml',true,'serverTime',clock_timestamp());
end $$;

create or replace function public.erp_purchase_invoice_read_rows(p_company_id uuid)
returns table(
  id text, source text, canonical boolean, supplier_id text, supplier_name text, supplier_ruc text,
  issue_date date, accounting_date date, document_type text, document_number text,
  authorization_summary text, access_key_summary text, subtotal numeric, tax_total numeric, total numeric,
  status text, accounting_status text, retention_status text, payable_id text, payable_balance numeric,
  payable_status text, journal_entry_id text, journal_entry_number text, line_count bigint,
  source_type text, updated_at timestamptz, dedup_key text, priority integer
)
language sql stable security definer set search_path=public,pg_temp as $$
  with candidates as (
    select d.purchase_document_id::text as id, 'SUPPLIER_FINANCE_V2'::text as source, true as canonical, d.provider_id::text as supplier_id,
      coalesce(nullif(p.commercial_name,''),p.legal_name) as supplier_name, p.tax_id as supplier_ruc,
      d.issue_date as issue_date, d.accounting_date as accounting_date,
      d.document_type::text as document_type, d.external_document_number as document_number,
      left(coalesce(d.source_payload->>'authorizationNumber',''),24) as authorization_summary,
      case when length(coalesce(d.source_payload->>'accessKey',''))>16
        then left(d.source_payload->>'accessKey',8)||'…'||right(d.source_payload->>'accessKey',8)
        else coalesce(d.source_payload->>'accessKey','') end as access_key_summary,
      d.subtotal as subtotal,d.tax_total as tax_total,d.total as total,
      case d.status::text when 'DRAFT' then 'BORRADOR' when 'REVIEWED' then 'REVISADO'
        when 'POSTED' then case when d.retention_decision='APLICAR' and d.retention_status in ('PENDING_ISSUANCE','PENDING_DECISION')
          then 'PENDIENTE_RETENCION' else 'CONTABILIZADO' end when 'CANCELLED' then 'ANULADO' else d.status::text end as status,
      case when d.status::text='POSTED' then 'CONTABILIZADA' when d.status::text='CANCELLED' then 'ANULADA' else 'PENDIENTE' end as accounting_status,
      d.retention_status::text as retention_status,coalesce(d.payable_id::text,'') as payable_id,
      coalesce(a.balance,0)::numeric as payable_balance,coalesce(a.status::text,'') as payable_status,
      coalesce(d.journal_entry_id::text,'') as journal_entry_id,coalesce(j.entry_number,'') as journal_entry_number,
      (select count(*) from public.erp_supplier_purchase_lines l where l.company_id=d.company_id and l.purchase_document_id=d.purchase_document_id) as line_count,
      d.source::text as source_type,d.updated_at as updated_at,
      case when nullif(d.legacy_draft_id,'') is not null then 'LEG|'||d.legacy_draft_id
        when nullif(d.source_key,'') is not null then 'SRC|'||d.source_key
        when nullif(d.source_payload->>'accessKey','') is not null then 'AK|'||(d.source_payload->>'accessKey')
        else 'V2|'||d.purchase_document_id::text end as dedup_key, 2::integer as priority
    from public.erp_supplier_purchase_documents d
    join public.erp_supplier_providers p on p.company_id=d.company_id and p.provider_id=d.provider_id
    left join public.erp_supplier_accounts_payable a on a.company_id=d.company_id and a.payable_id=d.payable_id
    left join public.erp_financial_journal_entries j on j.company_id=d.company_id and j.journal_entry_id=d.journal_entry_id
    where d.company_id=p_company_id
    union all
    select e.record_id as id,'LEGACY_PROJECTION'::text as source,false as canonical,
      coalesce(e.payload->>'supplierId',e.payload->>'providerId','') as supplier_id,
      coalesce(e.payload->>'supplierName',e.payload->>'providerName','') as supplier_name,
      coalesce(e.payload->>'supplierRuc',e.payload->>'providerRuc','') as supplier_ruc,
      case when coalesce(e.payload->>'issueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'issueDate')::date end as issue_date,
      case when coalesce(e.payload->>'accountingDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'accountingDate')::date end as accounting_date,
      upper(coalesce(e.payload->>'voucherType',e.payload->>'documentType','OTHER')) as document_type,
      coalesce(e.payload->>'documentNumber',e.record_id) as document_number,
      left(coalesce(e.payload->>'authorizationNumber',''),24) as authorization_summary,
      case when length(coalesce(e.payload->>'accessKey',''))>16 then left(e.payload->>'accessKey',8)||'…'||right(e.payload->>'accessKey',8) else coalesce(e.payload->>'accessKey','') end as access_key_summary,
      case when coalesce(e.payload#>>'{totals,subtotal}',e.payload->>'subtotal','')~'^-?\d+(\.\d+)?$' then coalesce(e.payload#>>'{totals,subtotal}',e.payload->>'subtotal')::numeric else 0 end as subtotal,
      case when coalesce(e.payload#>>'{totals,iva}',e.payload->>'iva','')~'^-?\d+(\.\d+)?$' then coalesce(e.payload#>>'{totals,iva}',e.payload->>'iva')::numeric else 0 end as tax_total,
      case when coalesce(e.payload#>>'{totals,total}',e.payload->>'total','')~'^-?\d+(\.\d+)?$' then coalesce(e.payload#>>'{totals,total}',e.payload->>'total')::numeric else 0 end as total,
      upper(coalesce(e.payload->>'status','BORRADOR')) as status,
      case when upper(coalesce(e.payload->>'status','')) in ('CONTABILIZADO','POSTED','RETENIDO') then 'CONTABILIZADA'
        when upper(coalesce(e.payload->>'status','')) in ('ANULADO','CANCELLED') then 'ANULADA' else 'PENDIENTE' end as accounting_status,
      upper(coalesce(e.payload->>'retentionCanonicalStatus',e.payload->>'retentionStatus','')) as retention_status,
      coalesce(e.payload->>'payableId','') as payable_id,0::numeric as payable_balance,''::text as payable_status,
      coalesce(e.payload->>'journalEntryId','') as journal_entry_id,''::text as journal_entry_number,
      (case when jsonb_typeof(e.payload->'lines')='array' then jsonb_array_length(e.payload->'lines') else 0 end)::bigint as line_count,
      coalesce(e.payload->>'source','LEGACY') as source_type,e.updated_at as updated_at,
      case when nullif(e.payload->>'sourceKey','') is not null then 'SRC|'||(e.payload->>'sourceKey')
        when nullif(e.payload->>'accessKey','') is not null then 'AK|'||(e.payload->>'accessKey')
        else 'LEG|'||e.record_id end as dedup_key,1::integer as priority
    from public.erp_entity_records e
    where e.company_id=p_company_id and e.entity='purchases' and e.deleted_at is null
      and not exists (
        select 1 from public.erp_supplier_purchase_documents d
        where d.company_id=e.company_id
          and (
            nullif(d.legacy_draft_id,'')=e.record_id
            or (nullif(d.source_key,'') is not null and d.source_key=nullif(e.payload->>'sourceKey',''))
            or (nullif(d.source_payload->>'accessKey','') is not null and d.source_payload->>'accessKey'=nullif(e.payload->>'accessKey',''))
          )
      )
  ), ranked as (
    select *,row_number() over(partition by dedup_key order by priority desc,updated_at desc) winner from candidates
  )
  select id,source,canonical,supplier_id,supplier_name,supplier_ruc,issue_date,accounting_date,document_type,document_number,
    authorization_summary,access_key_summary,subtotal,tax_total,total,status,accounting_status,retention_status,payable_id,payable_balance,
    payable_status,journal_entry_id,journal_entry_number,line_count,source_type,updated_at,dedup_key,priority
  from ranked where winner=1
$$;

create or replace function public.erp_purchase_invoices_history_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_date_kind text default 'ISSUE',p_provider_id text default null,
  p_status text default null,p_document_type text default null,p_posting_state text default null,
  p_retention_status text default null,p_document_number text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_summary jsonb;v_kind text:=upper(coalesce(p_date_kind,'ISSUE'));
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_purchase_invoices_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to or v_kind not in('ISSUE','ACCOUNTING') then
    raise exception using errcode='22023',message='PURCHASE_INVOICE_DATE_RANGE_INVALID';
  end if;
  with f as (
    select * from public.erp_purchase_invoice_read_rows(p_company_id) r
    where (case when v_kind='ACCOUNTING' then r.accounting_date else r.issue_date end) between p_date_from and p_date_to
      and (nullif(btrim(p_provider_id),'') is null or r.supplier_id=btrim(p_provider_id))
      and (nullif(upper(btrim(p_status)),'') is null or r.status=upper(btrim(p_status)))
      and (nullif(upper(btrim(p_document_type)),'') is null or r.document_type=upper(btrim(p_document_type)))
      and (nullif(upper(btrim(p_posting_state)),'') is null or r.accounting_status=upper(btrim(p_posting_state)))
      and (nullif(upper(btrim(p_retention_status)),'') is null or r.retention_status=upper(btrim(p_retention_status)))
      and (nullif(btrim(p_document_number),'') is null or r.document_number ilike '%'||btrim(p_document_number)||'%')
      and (nullif(btrim(p_search),'') is null or concat_ws(' ',r.document_number,r.supplier_name,r.supplier_ruc,r.authorization_summary,r.access_key_summary,r.source_type) ilike '%'||btrim(p_search)||'%')
  ), page as (select * from f order by (case when v_kind='ACCOUNTING' then accounting_date else issue_date end) desc nulls last,document_number desc limit p_limit offset p_offset)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'canonical',canonical,'supplierId',supplier_id,'supplierName',supplier_name,
    'supplierRuc',supplier_ruc,'issueDate',issue_date,'accountingDate',accounting_date,'documentType',document_type,'documentNumber',document_number,
    'authorizationSummary',authorization_summary,'accessKeySummary',access_key_summary,'subtotal',subtotal,'iva',tax_total,'total',total,
    'status',status,'accountingStatus',accounting_status,'retentionStatus',retention_status,'payableId',payable_id,'payableBalance',payable_balance,
    'payableStatus',payable_status,'journalEntryId',journal_entry_id,'journalEntryNumber',journal_entry_number,'lineCount',line_count,
    'sourceType',source_type,'updatedAt',updated_at) order by (case when v_kind='ACCOUNTING' then accounting_date else issue_date end) desc nulls last,document_number desc),'[]') into v_items from page;
  with f as (
    select * from public.erp_purchase_invoice_read_rows(p_company_id) r
    where (case when v_kind='ACCOUNTING' then r.accounting_date else r.issue_date end) between p_date_from and p_date_to
      and (nullif(btrim(p_provider_id),'') is null or r.supplier_id=btrim(p_provider_id))
      and (nullif(upper(btrim(p_status)),'') is null or r.status=upper(btrim(p_status)))
      and (nullif(upper(btrim(p_document_type)),'') is null or r.document_type=upper(btrim(p_document_type)))
      and (nullif(upper(btrim(p_posting_state)),'') is null or r.accounting_status=upper(btrim(p_posting_state)))
      and (nullif(upper(btrim(p_retention_status)),'') is null or r.retention_status=upper(btrim(p_retention_status)))
      and (nullif(btrim(p_document_number),'') is null or r.document_number ilike '%'||btrim(p_document_number)||'%')
      and (nullif(btrim(p_search),'') is null or concat_ws(' ',r.document_number,r.supplier_name,r.supplier_ruc,r.authorization_summary,r.access_key_summary,r.source_type) ilike '%'||btrim(p_search)||'%')
  ) select count(*),jsonb_build_object('documents',count(*),'total',coalesce(sum(total),0),'posted',count(*)filter(where accounting_status='CONTABILIZADA'),
    'pending',count(*)filter(where accounting_status='PENDIENTE'),'withRetention',count(*)filter(where retention_status in('AUTHORIZED','ISSUED','DRAFT_CREATED','PROCESSING')),
    'legacy',count(*)filter(where not canonical)) into v_total,v_summary from f;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset,'dateKind',v_kind);
end $$;

create or replace function public.erp_purchase_invoice_detail(p_company_id uuid,p_purchase_id text,p_source text default 'SUPPLIER_FINANCE_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_purchase jsonb;v_lines jsonb:='[]';v_provider jsonb:='null';v_payable jsonb:='null';v_retention jsonb:='null';v_journal jsonb:='null';
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if upper(coalesce(p_source,''))='LEGACY_PROJECTION' then
    select e.payload||jsonb_build_object('id',e.record_id,'sourceKind','LEGACY_PROJECTION','version',e.version,'updatedAt',e.updated_at) into v_purchase
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='purchases' and e.record_id=p_purchase_id and e.deleted_at is null;
    if v_purchase is null then raise exception using errcode='P0002',message='PURCHASE_INVOICE_NOT_FOUND';end if;
    v_lines:=coalesce(v_purchase->'lines','[]'::jsonb);
    return jsonb_build_object('ok',true,'purchase',v_purchase-'lines'-'sourcePayload','lines',v_lines,'provider',v_provider,
      'payable',v_payable,'retention',v_retention,'journal',v_journal,'source','LEGACY_PROJECTION');
  end if;
  if p_purchase_id!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='P0002',message='PURCHASE_INVOICE_NOT_FOUND';
  end if;
  v_id:=p_purchase_id::uuid;
  select jsonb_build_object('id',d.purchase_document_id::text,'purchaseDocumentId',d.purchase_document_id::text,'documentCode',d.document_code,
    'supplierId',d.provider_id::text,'supplierName',coalesce(nullif(p.commercial_name,''),p.legal_name),'supplierRuc',p.tax_id,
    'voucherType',lower(d.document_type),'documentNumber',d.external_document_number,'sourceKey',d.source_key,'issueDate',d.issue_date,
    'accountingDate',d.accounting_date,'dueDate',d.due_date,'currencyCode',d.currency_code,'exchangeRate',d.exchange_rate,
    'totals',jsonb_build_object('subtotal',d.subtotal,'iva',d.tax_total,'discount',d.discount_total,'withholdingsTotal',d.withholding_total,
      'total',d.total,'balanceDue',coalesce(a.balance,greatest(d.total-d.withholding_total,0))),
    'settlementMode',d.settlement_mode,'source',d.source,'authorizationNumber',coalesce(d.source_payload->>'authorizationNumber',''),
    'accessKey',coalesce(d.source_payload->>'accessKey',''),'status',case d.status::text when 'DRAFT' then 'BORRADOR' when 'REVIEWED' then 'REVISADO'
      when 'POSTED' then case when d.retention_decision='APLICAR' and d.retention_status in('PENDING_ISSUANCE','PENDING_DECISION') then 'PENDIENTE_RETENCION' else 'CONTABILIZADO' end
      when 'CANCELLED' then 'ANULADO' else d.status::text end,'journalEntryId',coalesce(d.journal_entry_id::text,''),'payableId',coalesce(d.payable_id::text,''),
    'legacyDraftId',d.legacy_draft_id,'retentionDecision',d.retention_decision,'retentionCanonicalStatus',d.retention_status,
    'retentionStatus',d.retention_status,'version',d.version,'syncFlow','SUPPLIER_FINANCE_V2','sourceKind','SUPPLIER_FINANCE_V2') ,to_jsonb(p),
    coalesce(to_jsonb(a),'null'::jsonb) into v_purchase,v_provider,v_payable
  from public.erp_supplier_purchase_documents d join public.erp_supplier_providers p on p.company_id=d.company_id and p.provider_id=d.provider_id
  left join public.erp_supplier_accounts_payable a on a.company_id=d.company_id and a.payable_id=d.payable_id
  where d.company_id=p_company_id and d.purchase_document_id=v_id;
  if v_purchase is null then raise exception using errcode='P0002',message='PURCHASE_INVOICE_NOT_FOUND';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.purchase_line_id::text,'productCode',l.product_code,'description',l.description,'quantity',l.quantity,
    'unit',l.unit,'unitPrice',l.unit_price,'taxableBase',l.taxable_base,'vatRate',l.tax_rate,'vatValue',l.tax_value,'discount',l.discount,
    'totalLine',l.line_total,'accountCode',l.account_code,'costCenter',l.cost_center,'lineType',l.line_type,'receptionId',l.reception_id,
    'receptionItemId',l.reception_item_id) order by l.line_number),'[]') into v_lines
  from public.erp_supplier_purchase_lines l where l.company_id=p_company_id and l.purchase_document_id=v_id;
  v_purchase:=v_purchase||jsonb_build_object('lines',v_lines);
  select jsonb_build_object('link',to_jsonb(w),'document',jsonb_build_object('id',e.id,'status',e.status,'sequential',e.sequential,
    'accessKey',e.access_key,'authorizationNumber',e.authorization_number,'issueDate',e.issue_date)) into v_retention
  from public.erp_supplier_purchase_withholding_links w join public.electronic_documents e on e.company_id=w.company_id and e.id=w.electronic_document_id
  where w.company_id=p_company_id and w.purchase_document_id=v_id;
  select jsonb_build_object('id',j.journal_entry_id,'number',j.entry_number,'accountingDate',j.accounting_date,'status',j.status,'concept',j.concept) into v_journal
  from public.erp_financial_journal_entries j where j.company_id=p_company_id and j.journal_entry_id=nullif(v_purchase->>'journalEntryId','')::uuid;
  return jsonb_build_object('ok',true,'purchase',v_purchase,'lines',v_lines,'provider',v_provider,'payable',coalesce(v_payable,'null'),
    'retention',coalesce(v_retention,'null'),'journal',coalesce(v_journal,'null'),'source','SUPPLIER_FINANCE_V2');
end $$;

create or replace function public.erp_purchase_invoice_xml(p_company_id uuid,p_purchase_id text,p_source text default 'SUPPLIER_FINANCE_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_payload jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if upper(coalesce(p_source,''))='LEGACY_PROJECTION' then
    select coalesce(e.payload->'sourcePayload',jsonb_build_object('xml',e.payload->'xml','rawXml',e.payload->'rawXml','accessKey',e.payload->>'accessKey')) into v_payload
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='purchases' and e.record_id=p_purchase_id and e.deleted_at is null;
  else
    if p_purchase_id!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception using errcode='P0002',message='PURCHASE_INVOICE_NOT_FOUND';end if;
    v_id:=p_purchase_id::uuid;
    select d.source_payload into v_payload from public.erp_supplier_purchase_documents d where d.company_id=p_company_id and d.purchase_document_id=v_id;
  end if;
  if v_payload is null then raise exception using errcode='P0002',message='PURCHASE_INVOICE_XML_NOT_FOUND';end if;
  return jsonb_build_object('ok',true,'purchaseId',p_purchase_id,'source',p_source,'sourcePayload',v_payload);
end $$;

revoke all on function public.erp_purchase_invoices_assert_page(integer,integer) from public,anon;
revoke all on function public.erp_purchase_invoices_read_health(uuid) from public,anon;
revoke all on function public.erp_purchase_invoice_read_rows(uuid) from public,anon;
revoke all on function public.erp_purchase_invoices_history_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_purchase_invoice_detail(uuid,text,text) from public,anon;
revoke all on function public.erp_purchase_invoice_xml(uuid,text,text) from public,anon;
grant execute on function public.erp_purchase_invoices_read_health(uuid) to authenticated;
grant execute on function public.erp_purchase_invoices_history_page(uuid,date,date,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
grant execute on function public.erp_purchase_invoice_detail(uuid,text,text) to authenticated;
grant execute on function public.erp_purchase_invoice_xml(uuid,text,text) to authenticated;
