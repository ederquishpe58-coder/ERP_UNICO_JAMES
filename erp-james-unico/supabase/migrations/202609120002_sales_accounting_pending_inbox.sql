-- AUD-02 Phase A: read model and manual posting guards.
-- This migration performs no backfill, posting or fiscal operation.
begin;

-- Exact references are opaque strings, never derived from sequence digits.
-- Weak/contradictory references are evidence for review, not merge authority.
create or replace function public.erp_financial_v2_sales_reference_kind(d jsonb, r jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare explicit_ref text; key_ref text:=nullif(r->>'accessKey','');
 refs text[]:=array[d->>'id',nullif(d->>'access_key',''),nullif(d->>'authorization_number','')];
 strong boolean; weak boolean;
begin
 strong:=coalesce(key_ref=d->>'access_key',false)
   or coalesce(nullif(r->>'sourceId','')=any(refs),false)
   or coalesce(nullif(r->>'id','')=any(refs),false);
 weak:=coalesce(r->>'documentNumber'=d->>'full_number',false) and (
   (nullif(r->>'customerTaxId','')=d#>>'{buyer_snapshot,identification}')
   or (nullif(r->>'parentDocumentId','')=d->>'parent_document_id'));
 if nullif(r->>'environment','') is not null and r->>'environment'<>d->>'environment' then
   if d->>'id' in (r->>'sourceDocumentId',r->>'electronicDocumentId',r->>'remoteDocumentId') then return 'CONFLICT'; end if;
   return 'NONE';
 end if;
 foreach explicit_ref in array array[r->>'sourceDocumentId',r->>'electronicDocumentId',r->>'remoteDocumentId'] loop
   if nullif(explicit_ref,'') is not null then
     if explicit_ref<>d->>'id' then
       if strong or weak or d->>'id' in (r->>'sourceDocumentId',r->>'electronicDocumentId',r->>'remoteDocumentId') then return 'CONFLICT'; end if;
       return 'NONE';
     end if;
     strong:=true;
   end if;
 end loop;
 if strong then
   if key_ref is not null and key_ref is distinct from d->>'access_key' then return 'CONFLICT'; end if;
   if nullif(r->>'documentNumber','') is not null and r->>'documentNumber'<>d->>'full_number' then return 'CONFLICT'; end if;
   return 'EXACT';
 end if;
 return case when weak then 'POSSIBLE' else 'NONE' end;
end $$;

create or replace function public.erp_financial_v2_sales_evidence(p_company_id uuid,p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d jsonb; parent jsonb; links jsonb; item jsonb; legacy_rows jsonb; v2_rows jsonb;
 n integer; issue text; state text:='PENDING'; chosen jsonb; due text; due_source text; due_issue text;
begin
 if p_document_id is null then return null; end if;
 select to_jsonb(x) into d from electronic_documents x where x.company_id=p_company_id and x.id=p_document_id;
 if d is null or d->>'environment'<>'PRODUCTION' or d->>'document_type' not in ('01','04') then
   raise exception using errcode='42501',message='SALES_POST_FISCAL_SCOPE_REQUIRED';
 end if;
 select to_jsonb(x) into parent from electronic_documents x where x.company_id=p_company_id
   and x.id::text=d->>'parent_document_id' and x.environment=d->>'environment' and x.document_type='01';
 with raw_legacy as (
   select e.record_id as record_id,e.payload||jsonb_build_object('id',e.record_id) ref,e.deleted_at
   from erp_entity_records e where d->>'document_type'='01' and e.company_id=p_company_id and e.entity='customer_receivables'
   union all
   select e.record_id||'/note/'||coalesce(note->>'id','UNKNOWN'),
     note||jsonb_build_object('parentDocumentId',coalesce(e.payload->>'sourceDocumentId',e.payload->>'electronicDocumentId'),
       'environment',coalesce(note->>'environment',e.payload->>'environment')),e.deleted_at
   from erp_entity_records e cross join lateral jsonb_array_elements(
     case when jsonb_typeof(e.payload->'creditNotes')='array' then e.payload->'creditNotes' else '[]'::jsonb end) note
   where d->>'document_type'='04' and e.company_id=p_company_id and e.entity='customer_receivables'
 ), classified as (
   select *,erp_financial_v2_sales_reference_kind(d,ref) kind from raw_legacy
 ) select coalesce(jsonb_agg(distinct jsonb_build_object('authority','LEGACY','id',record_id,'reference',ref,
     'kind',kind,'journalEntryId',nullif(ref->>'journalEntryId',''),'status',ref->>'postingStatus','deleted',deleted_at is not null)),'[]')
   into legacy_rows from classified where kind<>'NONE';

 with financial as (
   select 'INVOICE' kind,r.receivable_id::text id,r.receivable_id::text receivable_id,r.journal_entry_id journal_id,
     r.source_id,r.total,r.due_date::text due_date,
     jsonb_build_object('electronicDocumentId',r.electronic_document_id,'sourceId',r.source_id,'sourceType',r.source_type,
       'documentNumber',r.document_number,'customerTaxId',r.customer_tax_id_snapshot) ref
   from erp_financial_receivables r where d->>'document_type'='01' and r.company_id=p_company_id
   union all
   select 'CREDIT_NOTE',c.credit_note_id::text,c.receivable_id::text,c.journal_entry_id,c.source_id,c.total,null,
     jsonb_build_object('sourceId',c.source_id,'documentNumber',c.document_number,
       'parentDocumentId',case when erp_financial_v2_sales_reference_kind(parent,
         jsonb_build_object('electronicDocumentId',r.electronic_document_id,'sourceId',r.source_id))='EXACT'
         then parent->>'id' else r.electronic_document_id end)
   from erp_financial_credit_notes c left join erp_financial_receivables r on r.company_id=c.company_id and r.receivable_id=c.receivable_id
   where d->>'document_type'='04' and c.company_id=p_company_id
 ), classified as (
   select f.*,case
     when erp_financial_v2_sales_reference_kind(d,f.ref)<>'NONE' then erp_financial_v2_sales_reference_kind(d,f.ref)
     when exists(select 1 from jsonb_array_elements(legacy_rows) l where l->>'kind'='EXACT'
       and f.source_id in (l->>'id',l#>>'{reference,id}')) then 'EXACT'
     else 'NONE' end relation from financial f
 ) select coalesce(jsonb_agg(jsonb_build_object('authority','V2','id',f.id,'sourceId',f.source_id,'type',f.kind,
   'receivableId',f.receivable_id,'journalEntryId',f.journal_id,'status',j.status,'total',f.total,'dueDate',f.due_date,
   'kind',case when (f.kind='INVOICE' and f.ref->>'sourceType'<>'INVOICE')
     or (f.kind='CREDIT_NOTE' and (parent is null or f.ref->>'parentDocumentId' is distinct from parent->>'id'))
     then 'CONFLICT' else f.relation end)),'[]') into v2_rows
 from classified f left join erp_financial_journal_entries j on j.company_id=p_company_id and j.journal_entry_id=f.journal_id
 where f.relation<>'NONE';
 links:=legacy_rows||v2_rows;
 -- Preserve independent journal evidence; a journal referenced by a CxC is not a second act.
 select links||coalesce(jsonb_agg(jsonb_build_object('authority','LEGACY_JOURNAL','id',e.record_id,
   'journalEntryId',e.record_id,'status',e.payload->>'status','kind','EXACT')),'[]') into links
 from erp_entity_records e where e.company_id=p_company_id and e.entity='accounting_journal_entries'
   and nullif(e.payload->>'externalReference','') in (d->>'access_key',d->>'authorization_number',d->>'id')
   and not exists(select 1 from jsonb_array_elements(links) l where l->>'journalEntryId'=e.record_id);
 select links||coalesce(jsonb_agg(jsonb_build_object('authority','SRI_LINK','id',l.document_id,
   'journalEntryId',l.journal_entry_id,'status',l.status,'kind','EXACT')),'[]') into links
 from accounting_document_links l where l.company_id=p_company_id and l.document_id=p_document_id
   and (l.journal_entry_id is not null or l.status in ('GENERATED','POSTED'))
   and not exists(select 1 from jsonb_array_elements(links) x where x->>'journalEntryId'=l.journal_entry_id::text);
 if exists(select 1 from jsonb_array_elements(links) l where l->>'kind'<>'EXACT' or (l->>'deleted')::boolean) then
   issue:='ACCOUNTING_REFERENCE_REQUIRES_REVIEW';
 elsif jsonb_array_length(v2_rows)>1 or jsonb_array_length(legacy_rows)>1 then issue:='ACCOUNTING_LINKS_AMBIGUOUS';
 elsif jsonb_array_length(v2_rows)=1 then
   chosen:=v2_rows->0;
   if exists(select 1 from jsonb_array_elements(links) l where l->>'authority'<>'V2'
     and (l->>'journalEntryId' is distinct from chosen->>'journalEntryId' or l->>'status' not in ('POSTED','CONTABILIZADO'))) then
     issue:='ACCOUNTING_LEGACY_V2_CONFLICT';
   elsif chosen->>'status'='POSTED' and (chosen->>'total')::numeric=(d->>'grand_total')::numeric then state:='POSTED';
   else issue:='ACCOUNTING_PRIOR_EFFECT_REQUIRES_REVIEW'; end if;
 elsif jsonb_array_length(links)>0 then
   if jsonb_array_length(links)=1 and links->0->>'authority'='LEGACY' and d->>'document_type'='01'
     and nullif(links->0->>'journalEntryId','') is null
     and coalesce(links->0->>'status','') not in ('CONTABILIZADO','POSTED') then null;
   elsif jsonb_array_length(links)=1 and links->0->>'status'='POSTED' then state:='POSTED_LEGACY';
   else state:='REVIEW_LEGACY'; issue:='ACCOUNTING_LEGACY_REQUIRES_REVIEW'; end if;
 end if;
 if issue is not null and state<>'REVIEW_LEGACY' then state:='REVIEW_LINKS'; end if;
 -- Due-date provenance is raw persisted data, never the display normalizer.
 if jsonb_array_length(legacy_rows)=1 and legacy_rows->0->>'kind'='EXACT' then
   due:=nullif(btrim(legacy_rows#>>'{0,reference,dueDate}'),'');
   if due is not null then due_source:='customer_receivables:'||(legacy_rows->0->>'id'); end if;
 end if;
 if due is null then
   select nullif(btrim(e.payload->>'expireDate'),'') into due from erp_entity_records e
   where e.company_id=p_company_id and e.entity='commercial_orders' and e.deleted_at is null
     and e.record_id=coalesce(nullif(d#>>'{source_snapshot,erpEmission,sourceOrderId}',''),d->>'source_order_id');
   if due is not null then due_source:='commercial_orders.expireDate'; end if;
 end if;
 if d->>'document_type'='01' then
   if due is null then due_issue:='SALES_DUE_DATE_REQUIRED';
   else
     begin
       if due !~ '^\d{4}-\d{2}-\d{2}$' or to_char(due::date,'YYYY-MM-DD')<>due then due_issue:='SALES_DUE_DATE_INVALID'; end if;
     exception when invalid_datetime_format or datetime_field_overflow then due_issue:='SALES_DUE_DATE_INVALID'; end;
   end if;
 end if;
 -- Expose linkage provenance, not unrelated legacy customer/payment payloads.
 select coalesce(jsonb_agg(l||case when l ? 'reference' then jsonb_build_object('reference',
   (select coalesce(jsonb_object_agg(k,v),'{}') from jsonb_each(l->'reference') e(k,v)
    where k in ('id','sourceDocumentId','electronicDocumentId','remoteDocumentId','sourceId','accessKey',
      'environment','documentNumber','parentDocumentId','journalEntryId','postingStatus','dueDate'))) else '{}'::jsonb end),'[]')
 into links from jsonb_array_elements(links) l;
 return jsonb_build_object('state',state,'issue',issue,'links',links,'dueDate',due,'dueDateSource',due_source,
   'dueDateIssue',due_issue,'prior',chosen,'receivableId',chosen->>'receivableId');
end $$;

revoke all on function public.erp_financial_v2_sales_reference_kind(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.erp_financial_v2_sales_evidence(uuid,uuid) from public,anon,authenticated,service_role;

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
        'accountingState',ev.data->>'state','accountingEvidence',ev.data,
        'financialCount',(select count(*) from jsonb_array_elements(ev.data->'links') x where x->>'authority'='V2'),
        'journalEntryId',coalesce(ev.data#>>'{prior,journalEntryId}',f.journal_id),
        'receivableId',coalesce(ev.data->>'receivableId',f.receivable_id),'legacyStatus',l.status,
        'legacyJournalId',l.journal_entry_id,'legacyError',l.error_message,
        'linkIssue',case when ev.data->>'issue' is not null then ev.data->>'issue'
          when res.n>1 or res.mismatch then 'RESERVATION_LINK_MISMATCH'
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
    cross join lateral (select public.erp_financial_v2_sales_evidence(p_company_id,d.id) data) ev
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
        and r.receivable_id::text=public.erp_financial_v2_sales_evidence(p_company_id,parent.id)->>'receivableId'
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

-- Both public manual commands use this boundary before entering their unchanged
-- V2 engines. Lock the fiscal identity, not the client's representation of it.
create or replace function public.erp_financial_v2_sales_post_guard(
 p_operation_id uuid,p_company_id uuid,p_payload jsonb,p_type text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[]; doc_id uuid; d jsonb; parent jsonb; evidence jsonb; prior jsonb; op erp_operations_commands%rowtype;
 order_row erp_entity_records%rowtype; settings jsonb; settings_n integer; market text; ar text; revenue text; vat text;
 customer_id text; customer_n integer; customer_status text; reservation_n integer; reservation_bad boolean;
 due text; result jsonb; explicit_id text:=nullif(p_payload->>'electronicDocumentId','');
 source_ref text:=nullif(p_payload->>'sourceId',''); refs text[];
begin
 if p_operation_id is null then raise exception using errcode='22023',message='FINANCE_V2_COMMAND_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 if explicit_id is not null then
   select array_agg(x.id) into ids from electronic_documents x where x.company_id=p_company_id and x.id::text=explicit_id;
 else
   select array_agg(x.id) into ids from electronic_documents x where x.company_id=p_company_id
   and (source_ref in (x.id::text,nullif(x.access_key,''),nullif(x.authorization_number,''))
     or nullif(p_payload->>'accessKey','')=x.access_key
     or (x.document_type=p_type and x.full_number=p_payload->>'documentNumber' and
       ((p_type='01' and nullif(p_payload->>'customerTaxId','')=x.buyer_snapshot->>'identification')
        or (p_type='04' and exists(select 1 from erp_financial_receivables r join electronic_documents tax_parent
          on tax_parent.company_id=r.company_id and tax_parent.document_type='01' and tax_parent.environment=x.environment
          and tax_parent.id=x.parent_document_id
          where r.company_id=p_company_id and r.receivable_id::text=p_payload->>'receivableId'
            and erp_financial_v2_sales_reference_kind(to_jsonb(tax_parent),jsonb_build_object(
              'electronicDocumentId',r.electronic_document_id,'sourceId',r.source_id))='EXACT'))))
     or exists(select 1 from erp_entity_records e where e.company_id=p_company_id and e.entity='customer_receivables'
       and ((p_type='01' and source_ref=e.record_id and erp_financial_v2_sales_reference_kind(to_jsonb(x),e.payload)='EXACT')
         or (p_type='04' and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(e.payload->'creditNotes')='array'
           then e.payload->'creditNotes' else '[]' end) note
           where note->>'id'=source_ref and erp_financial_v2_sales_reference_kind(to_jsonb(x),note)='EXACT')))));
 end if;
 if coalesce(cardinality(ids),0)=0 then
   if explicit_id is not null or lower(coalesce(p_payload->>'documentType','')) like '%sri%'
     or nullif(p_payload->>'accessKey','') is not null then
     raise exception using errcode='23514',message='SALES_POST_FISCAL_IDENTITY_UNRESOLVED';
   end if;
   -- Non-fiscal/imported contracts stay on their existing engine, but a missing
   -- mandatory due date is not supplied silently by the engine's legacy fallback.
   if p_type='01' and nullif(btrim(p_payload->>'dueDate'),'') is null then
     raise exception using errcode='23514',message='SALES_DUE_DATE_REQUIRED';
   end if;
   return jsonb_build_object('payload',p_payload);
 end if;
 if cardinality(ids)<>1 then raise exception using errcode='23514',message='SALES_POST_IDENTITY_AMBIGUOUS'; end if;
 doc_id:=ids[1];
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':FISCAL_SALES:'||doc_id::text,0));
 select to_jsonb(x) into d from electronic_documents x where x.company_id=p_company_id and x.id=doc_id for update;
 if d->>'environment'<>'PRODUCTION' or d->>'document_type'<>p_type
   or (nullif(p_payload->>'environment','') is not null and p_payload->>'environment'<>d->>'environment') then
   raise exception using errcode='42501',message='SALES_POST_FISCAL_SCOPE_REQUIRED'; end if;
 refs:=array[d->>'id',nullif(d->>'access_key',''),nullif(d->>'authorization_number','')];
 evidence:=public.erp_financial_v2_sales_evidence(p_company_id,doc_id); prior:=evidence->'prior';
 if source_ref is not null and not(source_ref=any(array_remove(refs,null)))
   and not exists(select 1 from jsonb_array_elements(evidence->'links') l where l->>'kind'='EXACT'
     and source_ref in (l->>'sourceId',l->>'id',l#>>'{reference,id}')) then
   raise exception using errcode='23514',message='SALES_POST_REFERENCE_CONFLICT'; end if;
 if p_payload->>'documentNumber' is distinct from d->>'full_number'
   or p_payload->>'issueDate' is distinct from d->>'issue_date'
   or (nullif(p_payload->>'accessKey','') is not null and p_payload->>'accessKey' is distinct from d->>'access_key')
   or (p_payload->>'total')::numeric is distinct from (d->>'grand_total')::numeric
   or (p_payload->>'subtotal')::numeric is distinct from (d->>'subtotal')::numeric
   or (p_payload->>'taxTotal')::numeric is distinct from (d->>'tax_total')::numeric then
   raise exception using errcode='23514',message='SALES_POST_FISCAL_SNAPSHOT_MISMATCH'; end if;
 select * into op from erp_operations_commands where company_id=p_company_id and operation_id=p_operation_id;
 if found and (op.user_id is distinct from auth.uid()
   or op.command_type is distinct from case when p_type='01' then 'FINANCE_POST_INVOICE' else 'FINANCE_POST_CREDIT_NOTE' end
   or op.source_record_id not in (d->>'id',coalesce(prior->>'sourceId',''))) then
   raise exception using errcode='23514',message='SALES_POST_OPERATION_CONFLICT'; end if;
 if evidence->>'issue' is not null then
   raise exception using errcode='23514',message='SALES_POST_REQUIRES_REVIEW:'||(evidence->>'issue'); end if;
 if evidence->>'state'='POSTED' then
   if p_type='04' and p_payload->>'receivableId' is distinct from prior->>'receivableId' then
     raise exception using errcode='23514',message='SALES_POST_PARENT_MISMATCH'; end if;
   -- Read-only acknowledgment of the existing economic act; no new operation,
   -- publication event, journal, receivable or application is written on replay.
   result:=jsonb_build_object('journalEntryId',prior->>'journalEntryId','receivableId',prior->>'receivableId');
   if p_type='04' then result:=result||jsonb_build_object('creditNoteId',prior->>'id'); end if;
   return jsonb_build_object('ack',jsonb_build_object('ok',true,'reused',true,'accountingState','POSTED',
     'serverTime',statement_timestamp(),'records','[]'::jsonb,'result',result));
 end if;
 if evidence->>'state'<>'PENDING' then raise exception using errcode='23514',message='SALES_POST_PRIOR_ACCOUNTING_REQUIRES_REVIEW'; end if;
 if d->>'status'<>'AUTORIZADO' or d->>'currency' not in ('USD','DOLAR') then
   raise exception using errcode='23514',message='SALES_POST_FISCAL_PREREQUISITE'; end if;
 select * into order_row from erp_entity_records where company_id=p_company_id and entity='commercial_orders'
   and record_id=coalesce(nullif(d#>>'{source_snapshot,erpEmission,sourceOrderId}',''),d->>'source_order_id') for share;
 if order_row.deleted_at is not null or upper(coalesce(order_row.payload->>'status','')) in ('ANULADO','ANULADA','CANCELADO','CANCELADA','CANCELLED','VOIDED') then
   raise exception using errcode='23514',message='SALES_POST_ORDER_REQUIRES_REVIEW'; end if;
 if nullif(d->>'source_order_id','') is not null and nullif(d#>>'{source_snapshot,erpEmission,sourceOrderId}','') is not null
   and d->>'source_order_id'<>d#>>'{source_snapshot,erpEmission,sourceOrderId}' then
   raise exception using errcode='23514',message='SALES_POST_ORDER_LINK_MISMATCH'; end if;
 select count(*),bool_or((r.consumed_document_id is not null and r.consumed_document_id<>doc_id)
   or r.environment<>d->>'environment' or r.document_type<>p_type or r.full_number<>d->>'full_number')
 into reservation_n,reservation_bad from commercial_invoice_reservations r where r.company_id=p_company_id
   and (r.consumed_document_id=doc_id or (r.environment=d->>'environment' and r.document_type=p_type and r.full_number=d->>'full_number'));
 if reservation_n>1 or reservation_bad then
   raise exception using errcode='23514',message='SALES_POST_RESERVATION_LINK_MISMATCH'; end if;
 if p_type='04' then
   select to_jsonb(x) into parent from electronic_documents x where x.company_id=p_company_id and x.id::text=d->>'parent_document_id'
     and x.environment='PRODUCTION' and x.document_type='01';
   if parent is null or parent->>'status'<>'AUTORIZADO' then raise exception using errcode='23514',message='SALES_POST_PARENT_REQUIRED'; end if;
   prior:=public.erp_financial_v2_sales_evidence(p_company_id,(parent->>'id')::uuid);
   if prior->>'state'<>'POSTED' or prior->>'issue' is not null or p_payload->>'receivableId' is distinct from prior->>'receivableId' then
     raise exception using errcode='23514',message='SALES_POST_PARENT_MISMATCH'; end if;
 else
   parent:=d;
   if evidence->>'dueDateIssue' is not null then raise exception using errcode='23514',message=evidence->>'dueDateIssue'; end if;
   due:=evidence->>'dueDate';
   if p_payload->>'dueDate' is distinct from due then raise exception using errcode='23514',message='SALES_DUE_DATE_SOURCE_MISMATCH'; end if;
   select count(*),min(record_id),min(payload->>'status') into customer_n,customer_id,customer_status from erp_entity_records where company_id=p_company_id
     and entity='customers' and deleted_at is null and payload->>'taxId'=d#>>'{buyer_snapshot,identification}';
   if customer_n<>1 or customer_status is distinct from 'activo' or p_payload->>'customerId' is distinct from customer_id then
     raise exception using errcode='23514',message='SALES_POST_CUSTOMER_REQUIRES_REVIEW'; end if;
 end if;
 market:=parent#>>'{source_snapshot,invoice,commerceType}';
 if market is null or market not in ('LOCAL','EXPORTADOR') then raise exception using errcode='23514',message='SALES_POST_MARKET_REQUIRED'; end if;
 if p_type='01' and ((d->>'full_number' like '001-002-%' and market<>'EXPORTADOR') or (d->>'full_number' like '001-003-%' and market<>'LOCAL')) then
   raise exception using errcode='23514',message='SALES_POST_MARKET_SERIES_MISMATCH'; end if;
 select count(*) into settings_n from erp_entity_records where company_id=p_company_id and entity='company_settings' and deleted_at is null;
 if settings_n<>1 then raise exception using errcode='23514',message='SALES_POST_ACCOUNTS_CONFIGURATION_REQUIRED'; end if;
 select payload->'defaultAccounts' into settings from erp_entity_records where company_id=p_company_id and entity='company_settings' and deleted_at is null;
 ar:=coalesce(nullif(settings->>(case when market='LOCAL' then 'accountsReceivableCustomersLocal' else 'accountsReceivableCustomersExport' end),''),nullif(settings->>'accountsReceivableCustomers',''));
 revenue:=nullif(settings->>(case when market='LOCAL' then 'localSales' else 'exportSales' end),'');vat:=nullif(settings->>'vatSales','');
 if ar is null or revenue is null or ((d->>'tax_total')::numeric>0 and vat is null) then
   raise exception using errcode='23514',message='SALES_POST_ACCOUNTS_CONFIGURATION_REQUIRED'; end if;
 if p_payload->>'receivableAccountCode' is distinct from ar
   or p_payload->>(case when p_type='01' then 'counterAccountCode' else 'revenueAccountCode' end) is distinct from revenue
   or ((d->>'tax_total')::numeric>0 and p_payload->>'taxAccountCode' is distinct from vat) then
   raise exception using errcode='23514',message='SALES_POST_ACCOUNT_SOURCE_MISMATCH'; end if;
 return jsonb_build_object('payload',p_payload||jsonb_build_object('electronicDocumentId',d->>'id','sourceId',d->>'id'));
end $$;
revoke all on function public.erp_financial_v2_sales_post_guard(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.erp_financial_v2_post_invoice(p_operation_id uuid,p_company_id uuid,p_device_id text,p_invoice jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare checked jsonb;
begin
 perform public.erp_u2c3_assert_mutation_capability('erp_financial_v2_post_invoice',p_company_id,'{}');
 checked:=public.erp_financial_v2_sales_post_guard(p_operation_id,p_company_id,p_invoice,'01');
 if checked ? 'ack' then
   perform public.erp_financial_v2_assert_access(p_company_id);
   return checked->'ack';
 end if;
 return public.erp_financial_v2_post_invoice_u2c3_internal(p_operation_id,p_company_id,p_device_id,checked->'payload',p_local_created_at);
end $$;
create or replace function public.erp_financial_v2_post_credit_note(p_operation_id uuid,p_company_id uuid,p_device_id text,p_credit_note jsonb,p_local_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare checked jsonb;
begin
 perform public.erp_u2c3_assert_mutation_capability('erp_financial_v2_post_credit_note',p_company_id,'{}');
 checked:=public.erp_financial_v2_sales_post_guard(p_operation_id,p_company_id,p_credit_note,'04');
 if checked ? 'ack' then
   perform public.erp_financial_v2_assert_access(p_company_id);
   return checked->'ack';
 end if;
 return public.erp_financial_v2_post_credit_note_u2c3_internal(p_operation_id,p_company_id,p_device_id,checked->'payload',p_local_created_at);
end $$;
-- CREATE OR REPLACE preserves existing owners and ACL of these public wrappers.

-- Legacy writers must participate in the same fiscal row lock as V2. Checking
-- only from V2 leaves the reverse race open when a waiting legacy writer resumes.
-- Trigger rejection rolls back the entire legacy statement/transaction, including
-- a journal created before its projection. No historical row is rewritten.
create or replace function public.erp_financial_v2_guard_legacy_sales_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare refs jsonb; owner_id uuid; d electronic_documents%rowtype; evidence jsonb; row_data jsonb:=to_jsonb(new);
begin
 owner_id:=(row_data->>'company_id')::uuid;
 if tg_table_name='journal_entries' then
   refs:=jsonb_build_array(jsonb_build_object('sourceDocumentId',row_data->>'source_document_id'));
 else
   refs:=jsonb_build_array((row_data->'payload')||jsonb_build_object('id',row_data->>'record_id'));
   if row_data->>'entity'='accounting_journal_entries' then
     refs:=jsonb_build_array(jsonb_build_object('sourceId',row_data#>>'{payload,externalReference}'));
   elsif jsonb_typeof(row_data#>'{payload,creditNotes}')='array' then
     select refs||coalesce(jsonb_agg(note||jsonb_build_object(
       'parentDocumentId',coalesce(row_data#>>'{payload,sourceDocumentId}',row_data#>>'{payload,electronicDocumentId}'),
       'environment',coalesce(note->>'environment',row_data#>>'{payload,environment}'))),'[]')
     into refs from jsonb_array_elements(row_data#>'{payload,creditNotes}') note;
   end if;
 end if;
 -- Company and document identity, never a company-wide/table lock or sequence suffix.
 for d in select x.* from electronic_documents x where x.company_id=owner_id
   and x.environment='PRODUCTION' and x.document_type in ('01','04')
   and exists(select 1 from jsonb_array_elements(refs) r
     where public.erp_financial_v2_sales_reference_kind(to_jsonb(x),r)<>'NONE')
   order by x.id for update
 loop
   if exists(select 1 from jsonb_array_elements(refs) r where
     public.erp_financial_v2_sales_reference_kind(to_jsonb(d),r) in ('POSSIBLE','CONFLICT')) then
     raise exception using errcode='23514',message='SALES_POST_REQUIRES_REVIEW:LEGACY_REFERENCE_AMBIGUOUS';
   end if;
   -- A new snapshot after acquiring the lock sees the other committed writer.
   evidence:=public.erp_financial_v2_sales_evidence(owner_id,d.id);
   if exists(select 1 from jsonb_array_elements(evidence->'links') l where l->>'authority'='V2') then
     raise exception using errcode='23514',message='SALES_POST_REQUIRES_REVIEW:LEGACY_V2_PRIOR_EFFECT';
   end if;
 end loop;
 return new;
end $$;
revoke all on function public.erp_financial_v2_guard_legacy_sales_write() from public,anon,authenticated,service_role;
drop trigger if exists aud02_legacy_sales_journal_guard on public.journal_entries;
create trigger aud02_legacy_sales_journal_guard before insert or update on public.journal_entries
for each row when (new.source_type='SRI' and new.source_document_id is not null)
execute function public.erp_financial_v2_guard_legacy_sales_write();
drop trigger if exists aud02_legacy_sales_projection_guard on public.erp_entity_records;
create trigger aud02_legacy_sales_projection_guard before insert or update on public.erp_entity_records
for each row when (new.entity in ('customer_receivables','accounting_journal_entries') and (
 nullif(new.payload->>'journalEntryId','') is not null
 or upper(coalesce(new.payload->>'postingStatus',new.payload->>'status','')) in ('POSTED','CONTABILIZADO')
 or (jsonb_typeof(new.payload->'creditNotes')='array' and new.payload->'creditNotes'<>'[]'::jsonb)))
execute function public.erp_financial_v2_guard_legacy_sales_write();
commit;
