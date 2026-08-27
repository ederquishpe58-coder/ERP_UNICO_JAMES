-- CONT-C cierre / Reportes de cartera Generate-First.
-- Solo lectura: reutiliza las autoridades y read-models V2/legacy deduplicados de 007/008.

create or replace function public.erp_accounting_portfolio_report_assert_page(p_limit integer,p_offset integer)
returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if coalesce(p_limit,0) not in (25,50) or coalesce(p_offset,-1)<0 then
    raise exception using errcode='22023',message='PORTFOLIO_REPORT_PAGE_INVALID';
  end if;
end $$;

create or replace function public.erp_accounting_portfolio_report_page(
  p_company_id uuid,p_view text,p_date_from date,p_date_to date,
  p_provider_id text default null,p_customer_id text default null,p_status text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_view text:=upper(btrim(coalesce(p_view,'')));
  v_items jsonb:='[]'::jsonb;
  v_summary jsonb:='{}'::jsonb;
  v_total bigint:=0;
  v_period_activity numeric:=0;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_accounting_portfolio_report_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then
    raise exception using errcode='22023',message='PORTFOLIO_REPORT_DATE_RANGE_REQUIRED';
  end if;
  if v_view not in ('PAYABLES','RECEIVABLES','PAYMENTS','COLLECTIONS') then
    raise exception using errcode='22023',message='PORTFOLIO_REPORT_VIEW_INVALID';
  end if;

  if v_view='PAYABLES' then
    with f as (
      select r.*,coalesce(d.accounting_date,l.accounting_date,r.issue_date) report_date,
        greatest(current_date-coalesce(r.due_date,current_date),0) overdue_days
      from public.erp_supplier_payable_read_rows(p_company_id) r
      left join public.erp_supplier_purchase_documents d
        on d.company_id=p_company_id
       and d.purchase_document_id=case
         when coalesce(r.purchase_id,'')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           then r.purchase_id::uuid
         else null
       end
      left join lateral (
        select case
          when coalesce(e.payload->>'accountingDate','')~'^\d{4}-\d{2}-\d{2}$'
            then (e.payload->>'accountingDate')::date
          else null
        end accounting_date
        from public.erp_entity_records e
        where e.company_id=p_company_id
          and e.entity='supplier_purchase_documents'
          and e.record_id=r.purchase_id
          and e.deleted_at is null
        limit 1
      ) l on true
      where coalesce(d.accounting_date,l.accounting_date,r.issue_date) between p_date_from and p_date_to
        and (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id))
        and (nullif(upper(btrim(p_status)),'') is null or r.state=upper(btrim(p_status)))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.purchase_id,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%')
    )
    select count(*),jsonb_build_object(
      'totalDocuments',count(*),
      'totalPending',coalesce(sum(balance) filter(where state in ('PENDIENTE','PARCIAL','VENCIDO')),0),
      'totalOverdue',coalesce(sum(balance) filter(where state='VENCIDO'),0),
      'totalUpcoming',coalesce(sum(balance) filter(where state in ('PENDIENTE','PARCIAL') and overdue_days=0),0),
      'totalOriginal',coalesce(sum(total),0),'totalBalance',coalesce(sum(balance),0)
    ) into v_total,v_summary from f;

    with payment_rows as (
      select p.payment_date row_date,p.provider_id::text party_id,
        case when p.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end row_status,a.amount
      from public.erp_supplier_payments p join public.erp_supplier_payment_applications a using(company_id,payment_id)
      where p.company_id=p_company_id
      union all
      select case when coalesce(e.payload->>'paymentDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'paymentDate')::date end,
        coalesce(e.payload->>'providerId',a.value->>'providerId',''),upper(coalesce(e.payload->>'status','BORRADOR')),
        case when coalesce(a.value->>'amount','')~'^-?\d+(\.\d+)?$' then (a.value->>'amount')::numeric else 0 end
      from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) a(value)
      where e.company_id=p_company_id and e.entity in ('payments','payment_batches') and e.deleted_at is null
        and not exists(select 1 from public.erp_supplier_payments p where p.company_id=e.company_id and coalesce(nullif(p.client_reference_id,''),p.payment_id::text)=e.record_id)
    )
    select coalesce(sum(amount),0) into v_period_activity from payment_rows
    where row_date between p_date_from and p_date_to
      and (nullif(btrim(p_provider_id),'') is null or party_id=btrim(p_provider_id))
      and row_status='CONFIRMADO'
      and (nullif(upper(btrim(p_status)),'') is null or row_status=upper(btrim(p_status)));
    v_summary:=v_summary||jsonb_build_object('totalPaidPeriod',v_period_activity);

    with f as (
      select r.*,coalesce(d.accounting_date,l.accounting_date,r.issue_date) report_date,
        greatest(current_date-coalesce(r.due_date,current_date),0) overdue_days
      from public.erp_supplier_payable_read_rows(p_company_id) r
      left join public.erp_supplier_purchase_documents d
        on d.company_id=p_company_id
       and d.purchase_document_id=case
         when coalesce(r.purchase_id,'')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           then r.purchase_id::uuid
         else null
       end
      left join lateral (
        select case
          when coalesce(e.payload->>'accountingDate','')~'^\d{4}-\d{2}-\d{2}$'
            then (e.payload->>'accountingDate')::date
          else null
        end accounting_date
        from public.erp_entity_records e
        where e.company_id=p_company_id
          and e.entity='supplier_purchase_documents'
          and e.record_id=r.purchase_id
          and e.deleted_at is null
        limit 1
      ) l on true
      where coalesce(d.accounting_date,l.accounting_date,r.issue_date) between p_date_from and p_date_to
        and (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id))
        and (nullif(upper(btrim(p_status)),'') is null or r.state=upper(btrim(p_status)))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.purchase_id,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%')
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'source',source,'providerId',provider_id,'providerName',provider_name,'providerRuc',provider_ruc,
      'documentNumber',document_number,'issueDate',issue_date,'accountingDate',report_date,'dueDate',due_date,'totalDocument',total,
      'retentionApplied',retention_applied,'paid',paid,'balance',balance,'state',state,'overdueDays',overdue_days,
      'journalEntryId',journal_entry_id) order by report_date desc,document_number desc),'[]'::jsonb) into v_items
    from (select * from f order by report_date desc,document_number desc limit p_limit offset p_offset) q;

  elsif v_view='RECEIVABLES' then
    with f as (
      select r.*,greatest(current_date-coalesce(r.due_date,current_date),0) overdue_days
      from public.erp_customer_receivable_read_rows(p_company_id) r
      where r.issue_date between p_date_from and p_date_to
        and (nullif(btrim(p_customer_id),'') is null or r.customer_id=btrim(p_customer_id))
        and (nullif(upper(btrim(p_status)),'') is null or r.status=case when upper(btrim(p_status))='PAGADO' then 'COBRADO' else upper(btrim(p_status)) end)
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.customer_name,r.customer_tax_id,r.document_number,r.source_id,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%')
    )
    select count(*),jsonb_build_object(
      'totalDocuments',count(*),
      'totalPending',coalesce(sum(balance) filter(where status in ('PENDIENTE','PARCIAL','VENCIDO')),0),
      'totalOverdue',coalesce(sum(balance) filter(where status='VENCIDO'),0),
      'totalUpcoming',coalesce(sum(balance) filter(where status in ('PENDIENTE','PARCIAL') and overdue_days=0),0),
      'totalOriginal',coalesce(sum(total),0),'totalBalance',coalesce(sum(balance),0)
    ) into v_total,v_summary from f;

    with collection_rows as (
      select c.collection_date row_date,c.customer_id party_id,case when c.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end row_status,a.amount
      from public.erp_financial_collections c join public.erp_financial_collection_applications a using(company_id,collection_id)
      where c.company_id=p_company_id
      union all
      select case when coalesce(e.payload->>'collectionDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'collectionDate')::date end,
        coalesce(e.payload->>'customerId',a.value->>'customerId',''),upper(coalesce(e.payload->>'status','BORRADOR')),
        case when coalesce(a.value->>'amount','')~'^-?\d+(\.\d+)?$' then (a.value->>'amount')::numeric else 0 end
      from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) a(value)
      where e.company_id=p_company_id and e.entity in ('collections','collection_batches') and e.deleted_at is null
        and not exists(select 1 from public.erp_financial_collections c where c.company_id=e.company_id and coalesce(nullif(c.client_reference_id,''),c.collection_id::text)=e.record_id)
    )
    select coalesce(sum(amount),0) into v_period_activity from collection_rows
    where row_date between p_date_from and p_date_to
      and (nullif(btrim(p_customer_id),'') is null or party_id=btrim(p_customer_id))
      and row_status='CONFIRMADO'
      and (nullif(upper(btrim(p_status)),'') is null or row_status=upper(btrim(p_status)));
    v_summary:=v_summary||jsonb_build_object('totalCollectedPeriod',v_period_activity);

    with f as (
      select r.*,greatest(current_date-coalesce(r.due_date,current_date),0) overdue_days
      from public.erp_customer_receivable_read_rows(p_company_id) r
      where r.issue_date between p_date_from and p_date_to
        and (nullif(btrim(p_customer_id),'') is null or r.customer_id=btrim(p_customer_id))
        and (nullif(upper(btrim(p_status)),'') is null or r.status=case when upper(btrim(p_status))='PAGADO' then 'COBRADO' else upper(btrim(p_status)) end)
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.customer_name,r.customer_tax_id,r.document_number,r.source_id,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%')
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'source',source,'customerId',customer_id,'customerName',customer_name,'customerTaxId',customer_tax_id,
      'documentNumber',document_number,'issueDate',issue_date,'dueDate',due_date,'total',total,'withheld',withheld,
      'collected',collected,'credited',credited,'balance',balance,'status',status,'overdueDays',overdue_days,
      'journalEntryId',journal_entry_id) order by issue_date desc,document_number desc),'[]'::jsonb) into v_items
    from (select * from f order by issue_date desc,document_number desc limit p_limit offset p_offset) q;

  elsif v_view='PAYMENTS' then
    with canonical as (
      select a.payment_application_id::text id,'SUPPLIER_FINANCE_V2' source,p.payment_id::text operation_id,p.payment_date row_date,
        p.payment_code operation_number,p.provider_id::text party_id,v.legal_name party_name,q.payable_id::text document_id,q.document_number,
        p.payment_method method,p.payment_account_code account_code,a.amount value,
        case when p.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end state,p.journal_entry_id::text journal_entry_id,
        coalesce(nullif(p.client_reference_id,''),p.payment_id::text) dedup_key
      from public.erp_supplier_payments p join public.erp_supplier_payment_applications a using(company_id,payment_id)
      join public.erp_supplier_accounts_payable q using(company_id,payable_id)
      join public.erp_supplier_providers v on v.company_id=p.company_id and v.provider_id=p.provider_id
      where p.company_id=p_company_id
    ), legacy as (
      select e.record_id||':'||a.ordinality::text,'LEGACY',e.record_id,
        case when coalesce(e.payload->>'paymentDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'paymentDate')::date end,
        coalesce(e.payload->>'paymentNumber',e.payload->>'batchNumber',e.record_id),coalesce(e.payload->>'providerId',a.value->>'providerId',''),
        coalesce(e.payload->>'providerName',a.value->>'supplierName',''),coalesce(a.value->>'payableId',a.value->>'purchaseId',''),
        coalesce(a.value->>'documentNumber',a.value->>'purchaseDocumentNumber',''),coalesce(e.payload->>'paymentMethod',''),
        coalesce(e.payload->>'paymentAccountName',e.payload->>'paymentAccountCode',''),
        case when coalesce(a.value->>'amount','')~'^-?\d+(\.\d+)?$' then (a.value->>'amount')::numeric else 0 end,
        upper(coalesce(e.payload->>'status','BORRADOR')),coalesce(e.payload->>'entryNumber',e.payload->>'entryId',''),e.record_id
      from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) with ordinality a(value,ordinality)
      where e.company_id=p_company_id and e.entity in ('payments','payment_batches') and e.deleted_at is null
        and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
    ), rows as (select * from canonical union all select * from legacy), f as (
      select * from rows r where r.row_date between p_date_from and p_date_to
        and (nullif(btrim(p_provider_id),'') is null or r.party_id=btrim(p_provider_id))
        and (nullif(upper(btrim(p_status)),'') is null or r.state=upper(btrim(p_status)))
        and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.operation_number,r.party_name,r.document_number,r.method,r.account_code)) like '%'||lower(btrim(p_search))||'%')
    ) select count(*),jsonb_build_object('totalRows',count(*),'totalValue',coalesce(sum(value),0),'confirmedValue',coalesce(sum(value) filter(where state='CONFIRMADO'),0)) into v_total,v_summary from f;
    with canonical as (
      select a.payment_application_id::text id,'SUPPLIER_FINANCE_V2' source,p.payment_id::text operation_id,p.payment_date row_date,p.payment_code operation_number,p.provider_id::text party_id,v.legal_name party_name,q.payable_id::text document_id,q.document_number,p.payment_method method,p.payment_account_code account_code,a.amount value,case when p.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end state,p.journal_entry_id::text journal_entry_id,coalesce(nullif(p.client_reference_id,''),p.payment_id::text) dedup_key
      from public.erp_supplier_payments p join public.erp_supplier_payment_applications a using(company_id,payment_id) join public.erp_supplier_accounts_payable q using(company_id,payable_id) join public.erp_supplier_providers v on v.company_id=p.company_id and v.provider_id=p.provider_id where p.company_id=p_company_id
    ), legacy as (
      select e.record_id||':'||a.ordinality::text,'LEGACY',e.record_id,case when coalesce(e.payload->>'paymentDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'paymentDate')::date end,coalesce(e.payload->>'paymentNumber',e.payload->>'batchNumber',e.record_id),coalesce(e.payload->>'providerId',a.value->>'providerId',''),coalesce(e.payload->>'providerName',a.value->>'supplierName',''),coalesce(a.value->>'payableId',a.value->>'purchaseId',''),coalesce(a.value->>'documentNumber',a.value->>'purchaseDocumentNumber',''),coalesce(e.payload->>'paymentMethod',''),coalesce(e.payload->>'paymentAccountName',e.payload->>'paymentAccountCode',''),case when coalesce(a.value->>'amount','')~'^-?\d+(\.\d+)?$' then (a.value->>'amount')::numeric else 0 end,upper(coalesce(e.payload->>'status','BORRADOR')),coalesce(e.payload->>'entryNumber',e.payload->>'entryId',''),e.record_id
      from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) with ordinality a(value,ordinality) where e.company_id=p_company_id and e.entity in ('payments','payment_batches') and e.deleted_at is null and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
    ), rows as (select * from canonical union all select * from legacy), f as (
      select * from rows r where r.row_date between p_date_from and p_date_to and (nullif(btrim(p_provider_id),'') is null or r.party_id=btrim(p_provider_id)) and (nullif(upper(btrim(p_status)),'') is null or r.state=upper(btrim(p_status))) and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.operation_number,r.party_name,r.document_number,r.method,r.account_code)) like '%'||lower(btrim(p_search))||'%')
    ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'operationId',operation_id,'date',row_date,'paymentNumber',operation_number,'providerId',party_id,'providerName',party_name,'documentId',document_id,'documentNumber',document_number,'paymentMethod',method,'paymentAccount',account_code,'value',value,'status',state,'entryNumber',journal_entry_id) order by row_date desc,operation_number desc,document_number),'[]'::jsonb) into v_items from(select * from f order by row_date desc,operation_number desc,document_number limit p_limit offset p_offset)q;

  else
    with canonical as (
      select a.collection_application_id::text id,'FINANCIAL_V2' source,c.collection_id::text operation_id,c.collection_date row_date,c.collection_number operation_number,c.customer_id party_id,r.customer_name_snapshot party_name,r.receivable_id::text document_id,r.document_number,c.payment_method method,c.debit_account_code account_code,a.amount value,case when c.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end state,c.journal_entry_id::text journal_entry_id,coalesce(nullif(c.client_reference_id,''),c.collection_id::text) dedup_key
      from public.erp_financial_collections c join public.erp_financial_collection_applications a using(company_id,collection_id) join public.erp_financial_receivables r using(company_id,receivable_id) where c.company_id=p_company_id
    ), legacy as (
      select e.record_id||':'||a.ordinality::text,'LEGACY',e.record_id,case when coalesce(e.payload->>'collectionDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'collectionDate')::date end,coalesce(e.payload->>'collectionNumber',e.payload->>'batchNumber',e.record_id),coalesce(e.payload->>'customerId',a.value->>'customerId',''),coalesce(e.payload->>'customerName',a.value->>'customerName',''),coalesce(a.value->>'receivableId',''),coalesce(a.value->>'documentNumber',''),coalesce(e.payload->>'collectionMethod',''),coalesce(e.payload->>'collectionAccountName',e.payload->>'collectionAccountCode',''),case when coalesce(a.value->>'amount','')~'^-?\d+(\.\d+)?$' then (a.value->>'amount')::numeric else 0 end,upper(coalesce(e.payload->>'status','BORRADOR')),coalesce(e.payload->>'entryNumber',e.payload->>'entryId',''),e.record_id
      from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) with ordinality a(value,ordinality) where e.company_id=p_company_id and e.entity in ('collections','collection_batches') and e.deleted_at is null and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
    ), rows as (select * from canonical union all select * from legacy), f as (
      select * from rows r where r.row_date between p_date_from and p_date_to and (nullif(btrim(p_customer_id),'') is null or r.party_id=btrim(p_customer_id)) and (nullif(upper(btrim(p_status)),'') is null or r.state=upper(btrim(p_status))) and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.operation_number,r.party_name,r.document_number,r.method,r.account_code)) like '%'||lower(btrim(p_search))||'%')
    ) select count(*),jsonb_build_object('totalRows',count(*),'totalValue',coalesce(sum(value),0),'confirmedValue',coalesce(sum(value) filter(where state='CONFIRMADO'),0)) into v_total,v_summary from f;
    with canonical as (
      select a.collection_application_id::text id,'FINANCIAL_V2' source,c.collection_id::text operation_id,c.collection_date row_date,c.collection_number operation_number,c.customer_id party_id,r.customer_name_snapshot party_name,r.receivable_id::text document_id,r.document_number,c.payment_method method,c.debit_account_code account_code,a.amount value,case when c.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end state,c.journal_entry_id::text journal_entry_id,coalesce(nullif(c.client_reference_id,''),c.collection_id::text) dedup_key
      from public.erp_financial_collections c join public.erp_financial_collection_applications a using(company_id,collection_id) join public.erp_financial_receivables r using(company_id,receivable_id) where c.company_id=p_company_id
    ), legacy as (
      select e.record_id||':'||a.ordinality::text,'LEGACY',e.record_id,case when coalesce(e.payload->>'collectionDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'collectionDate')::date end,coalesce(e.payload->>'collectionNumber',e.payload->>'batchNumber',e.record_id),coalesce(e.payload->>'customerId',a.value->>'customerId',''),coalesce(e.payload->>'customerName',a.value->>'customerName',''),coalesce(a.value->>'receivableId',''),coalesce(a.value->>'documentNumber',''),coalesce(e.payload->>'collectionMethod',''),coalesce(e.payload->>'collectionAccountName',e.payload->>'collectionAccountCode',''),case when coalesce(a.value->>'amount','')~'^-?\d+(\.\d+)?$' then (a.value->>'amount')::numeric else 0 end,upper(coalesce(e.payload->>'status','BORRADOR')),coalesce(e.payload->>'entryNumber',e.payload->>'entryId',''),e.record_id
      from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) with ordinality a(value,ordinality) where e.company_id=p_company_id and e.entity in ('collections','collection_batches') and e.deleted_at is null and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
    ), rows as (select * from canonical union all select * from legacy), f as (
      select * from rows r where r.row_date between p_date_from and p_date_to and (nullif(btrim(p_customer_id),'') is null or r.party_id=btrim(p_customer_id)) and (nullif(upper(btrim(p_status)),'') is null or r.state=upper(btrim(p_status))) and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.operation_number,r.party_name,r.document_number,r.method,r.account_code)) like '%'||lower(btrim(p_search))||'%')
    ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'operationId',operation_id,'date',row_date,'collectionNumber',operation_number,'customerId',party_id,'customerName',party_name,'documentId',document_id,'documentNumber',document_number,'collectionMethod',method,'collectionAccount',account_code,'value',value,'status',state,'entryNumber',journal_entry_id) order by row_date desc,operation_number desc,document_number),'[]'::jsonb) into v_items from(select * from f order by row_date desc,operation_number desc,document_number limit p_limit offset p_offset)q;
  end if;

  return jsonb_build_object('ok',true,'view',lower(v_view),'items',v_items,'total',v_total,'summary',v_summary,
    'filters',jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to,'providerId',coalesce(p_provider_id,''),'customerId',coalesce(p_customer_id,''),'status',coalesce(p_status,''),'search',coalesce(p_search,'')),
    'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_accounting_portfolio_report_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object('ok',true,'component','ACCOUNTING_PORTFOLIO_REPORT_V2','migration','202608230015',
    'reportPage',to_regprocedure('public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer)') is not null,
    'payableAuthority',to_regclass('public.erp_supplier_accounts_payable') is not null,
    'receivableAuthority',to_regclass('public.erp_financial_receivables') is not null,
    'payableDetail',to_regprocedure('public.erp_supplier_payable_detail(uuid,text,text)') is not null,
    'receivableDetail',to_regprocedure('public.erp_customer_receivable_detail(uuid,text,text)') is not null,
    'paymentDetail',to_regprocedure('public.erp_supplier_payment_detail(uuid,text,text)') is not null,
    'collectionDetail',to_regprocedure('public.erp_customer_collection_detail(uuid,text,text)') is not null);
end $$;

revoke all on function public.erp_accounting_portfolio_report_assert_page(integer,integer) from public,anon;
revoke all on function public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_accounting_portfolio_report_health(uuid) from public,anon;
grant execute on function public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_accounting_portfolio_report_health(uuid) to authenticated,service_role;

comment on function public.erp_accounting_portfolio_report_page(uuid,text,date,date,text,text,text,text,integer,integer)
is 'READ-ONLY Generate-First: reportes de cartera paginados, resumidos y aislados por empresa.';
