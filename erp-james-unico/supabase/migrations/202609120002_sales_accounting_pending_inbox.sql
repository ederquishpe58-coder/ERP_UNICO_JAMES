-- AUD-02 Phase A: read model only. No backfill, posting or fiscal operation.
begin;

create or replace function public.erp_financial_v2_sales_inbox(
  p_company_id uuid, p_search text default '', p_offset integer default 0,
  p_limit integer default 50, p_document_id uuid default null,
  p_fiscal_state text default '', p_accounting_state text default ''
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $function$
declare v_result jsonb;
begin
  perform public.erp_security_assert_capability(p_company_id, 'accounting.sales.view');
  if p_offset < 0 or p_offset is null or p_limit not between 1 and 100 or p_limit is null then
    raise exception using errcode='22023', message='SALES_INBOX_PAGE_INVALID';
  end if;
  with docs as materialized (
    select d.* from public.electronic_documents d
    where d.company_id=p_company_id and d.environment='PRODUCTION'
      and d.document_type in ('01','04')
  ), cycles as (
    select d.id::text as cycle_id, d.created_at as sort_at,
      d.full_number as number, d.buyer_snapshot->>'legalName' as customer,
      jsonb_build_object(
        'cycleId',d.id, 'companyId',d.company_id, 'environment',d.environment,
        'document',jsonb_build_object('id',d.id,'document_type',d.document_type,
          'company_id',d.company_id,'environment',d.environment,'full_number',d.full_number,
          'status',d.status,'issue_date',d.issue_date,'buyer_snapshot',d.buyer_snapshot,
          'source_snapshot',jsonb_build_object('invoice',d.source_snapshot->'invoice',
            'creditNote',d.source_snapshot->'creditNote','erpEmission',d.source_snapshot->'erpEmission'),
          'subtotal',d.subtotal,'tax_total',d.tax_total,'grand_total',d.grand_total,
          'currency',d.currency,'access_key',d.access_key,'authorization_number',d.authorization_number,
          'parent_document_id',d.parent_document_id),
        'reservationIds',coalesce(res.ids,'[]'::jsonb),
        'orderId',coalesce(nullif(d.source_snapshot#>>'{erpEmission,sourceOrderId}',''),d.source_order_id::text),
        'orderState',o.payload->>'status','orderDueDate',o.payload->>'expireDate',
        'orderNumber',coalesce(o.payload->>'number',d.source_snapshot#>>'{erpEmission,sourceOrderNumber}'),
        'orderDeleted',o.deleted_at is not null,
        'customers',coalesce(cust.rows,'[]'::jsonb),
        'fiscalState',d.status,
        'accountingState',case
          when f.n>1 or f.mismatch or (f.n>0 and l.journal_entry_id is not null) then 'REVIEW_LINKS'
          when f.n=1 then coalesce(f.journal_status,'REVIEW_LINKS')
          when l.status='POSTED' then 'POSTED_LEGACY'
          when l.journal_entry_id is not null or l.status='GENERATED' then 'REVIEW_LEGACY'
          else 'PENDING' end,
        'financialCount',f.n,'journalEntryId',f.journal_id,
        'receivableId',f.receivable_id,'legacyStatus',l.status,
        'legacyJournalId',l.journal_entry_id,'legacyError',l.error_message,
        'linkIssue',case when res.n>1 or res.mismatch then 'RESERVATION_LINK_MISMATCH'
          when d.source_order_id is not null and nullif(d.source_snapshot#>>'{erpEmission,sourceOrderId}','') is not null
            and d.source_order_id::text<>d.source_snapshot#>>'{erpEmission,sourceOrderId}' then 'ORDER_LINK_MISMATCH'
          when d.document_type='04' and parent.id is null then 'PARENT_SCOPE_OR_LINK_MISSING'
          when d.document_type='04' and pf.n<>1 then 'PARENT_RECEIVABLE_NOT_UNIQUE'
          when d.document_type='04' and f.n>0 and f.receivable_id<>pf.receivable->>'id' then 'CREDIT_NOTE_PARENT_MISMATCH'
          else null end,
        'parentDocument',case when parent.id is not null then jsonb_build_object(
          'id',parent.id,'company_id',parent.company_id,'environment',parent.environment,
          'status',parent.status,'source_snapshot',jsonb_build_object('invoice',parent.source_snapshot->'invoice'),
          'buyer_snapshot',parent.buyer_snapshot) end,
        'parentReceivable',pf.receivable
      ) as row
    from docs d
    left join public.erp_entity_records o on o.company_id=d.company_id and o.entity='commercial_orders'
      and o.record_id=coalesce(nullif(d.source_snapshot#>>'{erpEmission,sourceOrderId}',''),d.source_order_id::text)
    left join public.accounting_document_links l on l.company_id=d.company_id and l.document_id=d.id
    left join docs parent on parent.id=d.parent_document_id and parent.document_type='01'
    left join lateral (
      select jsonb_agg(jsonb_build_object('id',c.record_id,'companyId',c.company_id,
        'taxId',c.payload->>'taxId','status',c.payload->>'status')) rows
      from public.erp_entity_records c where c.company_id=d.company_id and c.entity='customers'
        and c.deleted_at is null and nullif(c.payload->>'taxId','')=nullif(d.buyer_snapshot->>'identification','')
    ) cust on true
    left join lateral (
      select count(*) n, jsonb_agg(r.id order by r.id) ids,
        bool_or((r.consumed_document_id is not null and r.consumed_document_id<>d.id)
          or r.environment<>d.environment or r.document_type<>d.document_type or r.full_number<>d.full_number) mismatch
      from public.commercial_invoice_reservations r where r.company_id=d.company_id
        and (r.consumed_document_id=d.id or (r.environment=d.environment
          and r.document_type=d.document_type and r.full_number=d.full_number))
    ) res on true
    left join lateral (
      select count(*) n, min(x.journal_id::text) journal_id, min(j.status) journal_status,
        min(x.receivable_id::text) receivable_id, bool_or(x.mismatch) mismatch
      from (
        select r.journal_entry_id journal_id,r.receivable_id,
          (nullif(r.electronic_document_id,'') is not null and r.electronic_document_id<>d.id::text)
          or (r.source_type<>'INVOICE' or r.source_id<>d.id::text) mismatch
        from public.erp_financial_receivables r where d.document_type='01' and r.company_id=d.company_id
          and (r.electronic_document_id=d.id::text or (r.source_type='INVOICE' and r.source_id=d.id::text))
        union all
        select c.journal_entry_id,c.receivable_id,false from public.erp_financial_credit_notes c
        where d.document_type='04' and c.company_id=d.company_id and c.source_id=d.id::text
      ) x left join public.erp_financial_journal_entries j on j.company_id=d.company_id and j.journal_entry_id=x.journal_id
    ) f on true
    left join lateral (
      select count(*) n, (jsonb_agg(jsonb_build_object('id',r.receivable_id,
        'electronicDocumentId',r.electronic_document_id,'sourceId',r.source_id,
        'customerId',r.customer_id,'customerName',r.customer_name_snapshot,'customerTaxId',r.customer_tax_id_snapshot,
        'journalEntryId',r.journal_entry_id,'journalStatus',j.status,'status',r.status,
        'documentNumber',r.document_number,'balance',r.balance,'total',r.total)))->0 receivable
      from public.erp_financial_receivables r
      left join public.erp_financial_journal_entries j on j.company_id=r.company_id and j.journal_entry_id=r.journal_entry_id
      where r.company_id=d.company_id and parent.id is not null
        and (r.electronic_document_id=parent.id::text or (r.source_type='INVOICE' and r.source_id=parent.id::text))
    ) pf on true
    union all
    select 'reservation:'||r.id,r.created_at,r.full_number,null,
      jsonb_build_object('cycleId','reservation:'||r.id,'companyId',r.company_id,'environment',r.environment,
        'reservationIds',jsonb_build_array(r.id),'reservationState',r.status,'documentNumber',r.full_number,
        'orderId',r.record_id,'orderNumber',o.payload->>'number','orderState',o.payload->>'status',
        'orderDeleted',o.deleted_at is not null,'fiscalState','NO_DOCUMENT','accountingState','NO_DOCUMENT',
        'linkIssue',case when r.consumed_document_id is not null then 'RESERVATION_DOCUMENT_MISSING' end)
    from public.commercial_invoice_reservations r
    left join public.erp_entity_records o on o.company_id=r.company_id and o.entity='commercial_orders' and o.record_id=r.record_id
    where r.company_id=p_company_id and r.environment='PRODUCTION' and r.document_type='01'
      and not exists(select 1 from docs d where d.id=r.consumed_document_id
        or (d.document_type=r.document_type and d.full_number=r.full_number))
  ), filtered as (
    select * from cycles where (p_document_id is null or cycle_id=p_document_id::text)
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(concat_ws(' ',number,customer,row->>'orderNumber',row->>'orderId')))>0)
      and (coalesce(p_fiscal_state,'')='' or row->>'fiscalState'=p_fiscal_state)
      and (coalesce(p_accounting_state,'')='' or row->>'accountingState'=p_accounting_state)
  ), page as (select * from filtered order by sort_at desc,cycle_id limit p_limit offset p_offset)
  select jsonb_build_object('companyId',p_company_id,'environment','PRODUCTION','readAt',statement_timestamp(),
    'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(row order by sort_at desc,cycle_id) from page),'[]'::jsonb),
    'settingsCount',(select count(*) from public.erp_entity_records where company_id=p_company_id and entity='company_settings' and deleted_at is null),
    'defaultAccounts',(select payload->'defaultAccounts' from public.erp_entity_records where company_id=p_company_id and entity='company_settings' and deleted_at is null order by record_id limit 1))
    into v_result;
  return v_result;
end;
$function$;

revoke all on function public.erp_financial_v2_sales_inbox(uuid,text,integer,integer,uuid,text,text) from public,anon,service_role;
grant execute on function public.erp_financial_v2_sales_inbox(uuid,text,integer,integer,uuid,text,text) to authenticated;
comment on function public.erp_financial_v2_sales_inbox(uuid,text,integer,integer,uuid,text,text) is
  'AUD-02 Phase A. Company/capability-scoped PRODUCTION fiscal cycles; no business effects. Legacy links require review.';
commit;
