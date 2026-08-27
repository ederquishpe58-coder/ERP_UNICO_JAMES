-- CxC read-model patch: canonicaliza únicamente aliases conocidos de FACTURA SRI
-- para la identidad de deduplicación. El valor mostrado de document_type no cambia.
-- V2 conserva prioridad 2 y la proyección legacy prioridad 1.

create or replace function public.erp_customer_receivable_read_rows(p_company_id uuid)
returns table(id text,source text,customer_id text,customer_name text,customer_tax_id text,source_id text,document_type text,document_number text,
  issue_date date,due_date date,total numeric,credited numeric,collected numeric,withheld numeric,balance numeric,status text,canonical_status text,
  journal_entry_id text,updated_at timestamptz,version bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  with candidates as (
    select r.receivable_id::text id,'FINANCIAL_V2' source,r.customer_id,r.customer_name_snapshot as customer_name,r.customer_tax_id_snapshot as customer_tax_id,r.source_id,r.document_type,r.document_number,
      r.issue_date,r.due_date,r.total,r.credited_total credited,greatest(r.total-r.balance-r.credited_total,0) collected,0::numeric withheld,r.balance,
      case when r.status='CANCELLED' then 'ANULADO' when r.status='PAID' or r.balance<=0 then 'COBRADO' when r.due_date<current_date then 'VENCIDO'
        when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end status,r.status canonical_status,r.journal_entry_id::text,r.updated_at,r.version,
      'DOC|'||r.customer_id||'|'||
        case upper(btrim(r.document_type))
          when 'FACTURA SRI' then 'FACTURA_SRI'
          when 'FACTURA_SRI' then 'FACTURA_SRI'
          else upper(r.document_type)
        end||'|'||r.document_number dedup_key,2 priority
    from public.erp_financial_receivables r where r.company_id=p_company_id
    union all
    select e.record_id,'LEGACY_PROJECTION',coalesce(e.payload->>'customerId',''),coalesce(e.payload->>'customerName',''),coalesce(e.payload->>'customerTaxId',''),
      coalesce(e.payload->>'sourceId',e.record_id),upper(replace(coalesce(e.payload->>'documentType','DOCUMENTO_MANUAL'),' ','_')),coalesce(e.payload->>'documentNumber',e.record_id),
      case when coalesce(e.payload->>'issueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'issueDate')::date end,
      case when coalesce(e.payload->>'dueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dueDate')::date end,
      case when coalesce(e.payload->>'total','')~'^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end,
      case when coalesce(e.payload->>'credited','')~'^-?\d+(\.\d+)?$' then (e.payload->>'credited')::numeric else 0 end,
      case when coalesce(e.payload->>'collected','')~'^-?\d+(\.\d+)?$' then (e.payload->>'collected')::numeric else 0 end,
      case when coalesce(e.payload->>'withheld','')~'^-?\d+(\.\d+)?$' then (e.payload->>'withheld')::numeric else 0 end,
      case when coalesce(e.payload->>'balance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'balance')::numeric else case when coalesce(e.payload->>'total','')~'^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end end,
      case
        when upper(coalesce(e.payload->>'status','')) in ('ANULADO','CANCELLED') then 'ANULADO'
        when (case when coalesce(e.payload->>'balance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'balance')::numeric else case when coalesce(e.payload->>'total','')~'^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end end)<=0
          or upper(coalesce(e.payload->>'status','')) in ('COBRADO','PAID') then 'COBRADO'
        when (case when coalesce(e.payload->>'dueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dueDate')::date end)<current_date then 'VENCIDO'
        when upper(coalesce(e.payload->>'status','')) in ('PARCIAL','PARTIALLY_PAID')
          or (case when coalesce(e.payload->>'collected','')~'^-?\d+(\.\d+)?$' then (e.payload->>'collected')::numeric else 0 end)>0
          or (case when coalesce(e.payload->>'withheld','')~'^-?\d+(\.\d+)?$' then (e.payload->>'withheld')::numeric else 0 end)>0
          or (case when coalesce(e.payload->>'credited','')~'^-?\d+(\.\d+)?$' then (e.payload->>'credited')::numeric else 0 end)>0 then 'PARCIAL'
        else 'PENDIENTE' end,
      upper(coalesce(nullif(e.payload->>'status',''),'OPEN')),
      coalesce(e.payload->>'journalEntryId',''),e.updated_at,e.version,
      'DOC|'||coalesce(e.payload->>'customerId','')||'|'||
        case upper(btrim(coalesce(e.payload->>'documentType','DOCUMENTO_MANUAL')))
          when 'FACTURA SRI' then 'FACTURA_SRI'
          when 'FACTURA_SRI' then 'FACTURA_SRI'
          else upper(replace(coalesce(e.payload->>'documentType','DOCUMENTO_MANUAL'),' ','_'))
        end||'|'||coalesce(e.payload->>'documentNumber',e.record_id),1
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='customer_receivables' and e.deleted_at is null
  ), ranked as (select *,row_number() over(partition by dedup_key order by priority desc) winner from candidates)
  select id,source,customer_id,customer_name,customer_tax_id,source_id,document_type,document_number,issue_date,due_date,total,credited,collected,withheld,
    balance,status,canonical_status,journal_entry_id,updated_at,version from ranked where winner=1
$$;

revoke all on function public.erp_customer_receivable_read_rows(uuid) from public,anon;
grant execute on function public.erp_customer_receivable_read_rows(uuid) to authenticated,service_role;

comment on function public.erp_customer_receivable_read_rows(uuid) is
  'READ-ONLY: CxC V2 + legado deduplicado; FACTURA SRI y FACTURA_SRI comparten identidad canónica y V2 gana.';
