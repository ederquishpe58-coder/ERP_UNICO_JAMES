-- CONT-A / Punto 4: lectura search-first de retenciones recibidas.
-- Aditiva y estrictamente READ-ONLY. La mutacion historica permanece intacta.

create index if not exists erp_received_withholdings_issue_date_read_idx
  on public.erp_entity_records(company_id,(payload->>'issueDate') desc,record_id)
  where entity='received_withholdings' and deleted_at is null
    and coalesce(payload->>'issueDate','') ~ '^\d{4}-\d{2}-\d{2}$';

create index if not exists erp_customer_receivables_lookup_read_idx
  on public.erp_entity_records(company_id,(payload->>'customerId'),(payload->>'documentNumber'))
  where entity='customer_receivables' and deleted_at is null;

create or replace function public.erp_received_withholding_read_assert_page(p_limit integer, p_offset integer)
returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if coalesce(p_limit,0) not in (25,50) or coalesce(p_offset,-1) < 0 then
    raise exception using errcode='22023',message='RECEIVED_WITHHOLDING_PAGE_INVALID';
  end if;
end $$;

create or replace function public.erp_received_withholding_read_rows(p_company_id uuid)
returns table(
  withholding_id text,issue_date date,document_number text,issuer_name text,issuer_tax_id text,resolved_customer_id text,
  support_document_number text,total_rent numeric,total_vat numeric,total_retained numeric,status text,
  related_receivable_id text,related_receivable_number text,related_customer_id text,
  suggested_receivable_id text,suggested_receivable_number text,suggested_customer_id text,
  journal_entry_id text,journal_entry_number text,authorization_number text,access_key text,
  import_status text,source text,applied_at timestamptz,created_at timestamptz,updated_at timestamptz,version bigint
) language sql stable security definer set search_path=public,pg_temp as $$
  select
    e.record_id,
    case when coalesce(e.payload->>'issueDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (e.payload->>'issueDate')::date end,
    coalesce(nullif(e.payload->>'documentNumber',''),e.record_id),
    coalesce(e.payload->>'issuerName',''),coalesce(e.payload->>'issuerTaxId',''),
    coalesce(nullif(e.payload->>'relatedCustomerId',''),nullif(e.payload->>'suggestedCustomerId',''),
      (select c.record_id from public.erp_entity_records c where c.company_id=e.company_id and c.entity in ('customers','commercial_customers')
        and c.deleted_at is null and coalesce(c.payload->>'taxId',c.payload->>'identification','')=coalesce(e.payload->>'issuerTaxId','')
        order by case when c.entity='customers' then 0 else 1 end limit 1),''),
    coalesce(e.payload->>'supportDocumentNumber',''),
    coalesce((select sum(case when upper(coalesce(line->>'taxType','RENTA'))='RENTA' and coalesce(line->>'retainedAmount','') ~ '^-?\d+(\.\d+)?$' then (line->>'retainedAmount')::numeric else 0 end) from jsonb_array_elements(coalesce(e.payload->'lines','[]'::jsonb)) as lines(line)),0),
    coalesce((select sum(case when upper(coalesce(line->>'taxType',''))='IVA' and coalesce(line->>'retainedAmount','') ~ '^-?\d+(\.\d+)?$' then (line->>'retainedAmount')::numeric else 0 end) from jsonb_array_elements(coalesce(e.payload->'lines','[]'::jsonb)) as lines(line)),0),
    case when coalesce(e.payload->>'totalRetained','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'totalRetained')::numeric else 0 end,
    upper(coalesce(nullif(e.payload->>'status',''),'IMPORTADO')),
    coalesce(e.payload->>'relatedReceivableId',''),coalesce(e.payload->>'relatedReceivableNumber',''),coalesce(e.payload->>'relatedCustomerId',''),
    coalesce(e.payload->>'suggestedReceivableId',''),coalesce(e.payload->>'suggestedReceivableNumber',''),coalesce(e.payload->>'suggestedCustomerId',''),
    coalesce(e.payload->>'journalEntryId',''),coalesce(e.payload->>'journalEntryNumber',''),
    coalesce(e.payload->>'authorizationNumber',''),coalesce(e.payload->>'accessKey',''),
    upper(coalesce(nullif(e.payload->>'importStatus',''),'IMPORTADO')),upper(coalesce(nullif(e.payload->>'source',''),'XML')),
    case when coalesce(e.payload->>'appliedAt','') ~ '^\d{4}-\d{2}-\d{2}' then (e.payload->>'appliedAt')::timestamptz end,
    coalesce(case when coalesce(e.payload->>'createdAt','') ~ '^\d{4}-\d{2}-\d{2}' then (e.payload->>'createdAt')::timestamptz end,e.created_at),
    e.updated_at,e.version
  from public.erp_entity_records e
  where e.company_id=p_company_id and e.entity='received_withholdings' and e.deleted_at is null
$$;

create or replace function public.erp_received_withholding_read_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok',true,'component','RECEIVED_WITHHOLDING_READ','migration','202608230006',
    'authority','erp_entity_records.received_withholdings',
    'receivedProjection',to_regclass('public.erp_entity_records') is not null,
    'canonicalReceivables',to_regclass('public.erp_financial_receivables') is not null,
    'page',to_regprocedure('public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer)') is not null,
    'detail',to_regprocedure('public.erp_received_withholding_detail(uuid,text)') is not null,
    'receivableLookup',to_regprocedure('public.erp_received_withholding_receivable_lookup(uuid,text,text,integer)') is not null
  );
end $$;

create or replace function public.erp_received_withholding_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_customer_id text default null,p_status text default null,
  p_number text default null,p_document text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_items jsonb;
  v_total bigint;
  v_summary jsonb;
  v_date_from_iso text;
  v_date_to_iso text;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_received_withholding_read_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then
    raise exception using errcode='22023',message='RECEIVED_WITHHOLDING_DATE_RANGE_REQUIRED';
  end if;
  v_date_from_iso:=to_char(p_date_from,'YYYY-MM-DD');
  v_date_to_iso:=to_char(p_date_to,'YYYY-MM-DD');

  with candidates as (
    select e.record_id
    from public.erp_entity_records e
    where e.company_id=p_company_id and e.entity='received_withholdings' and e.deleted_at is null
      and coalesce(e.payload->>'issueDate','') ~ '^\d{4}-\d{2}-\d{2}$'
      and e.payload->>'issueDate'>=v_date_from_iso and e.payload->>'issueDate'<=v_date_to_iso
  ), filtered as (
    select r.* from public.erp_received_withholding_read_rows(p_company_id) r
    join candidates c on c.record_id=r.withholding_id
    where r.issue_date between p_date_from and p_date_to
      and (nullif(btrim(p_customer_id),'') is null or r.resolved_customer_id=btrim(p_customer_id))
      and (nullif(upper(btrim(p_status)),'') is null or r.status=upper(btrim(p_status)))
      and (nullif(btrim(p_number),'') is null or r.document_number ilike '%'||btrim(p_number)||'%')
      and (nullif(btrim(p_document),'') is null or r.support_document_number ilike '%'||btrim(p_document)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.issuer_name,r.issuer_tax_id,r.document_number,r.support_document_number,r.authorization_number,r.access_key,r.related_receivable_number,r.suggested_receivable_number)) like '%'||lower(btrim(p_search))||'%')
  )
  select count(*),jsonb_build_object(
    'total',count(*),'pendingRelation',count(*) filter(where status='PENDIENTE_RELACION'),
    'imported',count(*) filter(where status='IMPORTADO'),'applied',count(*) filter(where status='APLICADO'),
    'annulled',count(*) filter(where status='ANULADO'),'totalRent',coalesce(sum(total_rent),0),
    'totalVat',coalesce(sum(total_vat),0),'totalRetained',coalesce(sum(total_retained),0)
  ) into v_total,v_summary from filtered;

  with candidates as (
    select e.record_id
    from public.erp_entity_records e
    where e.company_id=p_company_id and e.entity='received_withholdings' and e.deleted_at is null
      and coalesce(e.payload->>'issueDate','') ~ '^\d{4}-\d{2}-\d{2}$'
      and e.payload->>'issueDate'>=v_date_from_iso and e.payload->>'issueDate'<=v_date_to_iso
  ), filtered as (
    select r.* from public.erp_received_withholding_read_rows(p_company_id) r
    join candidates c on c.record_id=r.withholding_id
    where r.issue_date between p_date_from and p_date_to
      and (nullif(btrim(p_customer_id),'') is null or r.resolved_customer_id=btrim(p_customer_id))
      and (nullif(upper(btrim(p_status)),'') is null or r.status=upper(btrim(p_status)))
      and (nullif(btrim(p_number),'') is null or r.document_number ilike '%'||btrim(p_number)||'%')
      and (nullif(btrim(p_document),'') is null or r.support_document_number ilike '%'||btrim(p_document)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.issuer_name,r.issuer_tax_id,r.document_number,r.support_document_number,r.authorization_number,r.access_key,r.related_receivable_number,r.suggested_receivable_number)) like '%'||lower(btrim(p_search))||'%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',withholding_id,'issueDate',issue_date,'documentNumber',document_number,'issuerName',issuer_name,'issuerTaxId',issuer_tax_id,'customerId',resolved_customer_id,
    'supportDocumentNumber',support_document_number,'totalRent',total_rent,'totalVat',total_vat,'totalRetained',total_retained,
    'status',status,'importStatus',import_status,'source',source,
    'relatedReceivableId',related_receivable_id,'relatedReceivableNumber',related_receivable_number,'relatedCustomerId',related_customer_id,
    'suggestedReceivableId',suggested_receivable_id,'suggestedReceivableNumber',suggested_receivable_number,'suggestedCustomerId',suggested_customer_id,
    'journalEntryId',journal_entry_id,'journalEntryNumber',journal_entry_number,'authorizationNumber',authorization_number,
    'appliedAt',applied_at,'updatedAt',updated_at,'version',version
  ) order by issue_date desc,document_number desc),'[]'::jsonb) into v_items
  from (select * from filtered order by issue_date desc,document_number desc limit p_limit offset p_offset) q;

  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_received_withholding_detail(p_company_id uuid,p_received_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_record public.erp_entity_records%rowtype; v_journal jsonb:='null'::jsonb; v_journal_id text;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  select * into v_record from public.erp_entity_records
   where company_id=p_company_id and entity='received_withholdings' and record_id=p_received_id and deleted_at is null;
  if v_record.id is null then raise exception using errcode='P0002',message='RECEIVED_WITHHOLDING_NOT_FOUND'; end if;
  v_journal_id:=nullif(v_record.payload->>'journalEntryId','');
  if v_journal_id is not null then
    if v_journal_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select jsonb_build_object('source','FINANCIAL_V2','header',to_jsonb(e),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_number) from public.erp_financial_journal_lines l where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id),'[]'::jsonb))
      into v_journal from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=v_journal_id::uuid;
    end if;
    if v_journal is null or v_journal='null'::jsonb then
      select jsonb_build_object('source','LEGACY_PROJECTION','header',e.payload,'lines',coalesce(e.payload->'lines','[]'::jsonb))
      into v_journal from public.erp_entity_records e where e.company_id=p_company_id and e.entity='accounting_journal_entries' and e.record_id=v_journal_id and e.deleted_at is null;
    end if;
  end if;
  return jsonb_build_object('ok',true,'item',v_record.payload||jsonb_build_object('id',v_record.record_id,'version',v_record.version,'updatedAt',v_record.updated_at),'journal',coalesce(v_journal,'null'::jsonb));
end $$;

create or replace function public.erp_received_withholding_receivable_lookup(
  p_company_id uuid,p_customer_id text,p_search text default null,p_limit integer default 25
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_limit not in (25,50) then raise exception using errcode='22023',message='RECEIVED_WITHHOLDING_LOOKUP_LIMIT_INVALID'; end if;
  if nullif(btrim(p_customer_id),'') is null then raise exception using errcode='22023',message='RECEIVED_WITHHOLDING_CUSTOMER_REQUIRED'; end if;
  with candidates as (
    select r.receivable_id::text id,r.customer_id,r.customer_name_snapshot customer_name,r.customer_tax_id_snapshot customer_tax_id,
      r.document_type,r.document_number,r.issue_date,r.due_date,r.total,r.balance,r.status,'FINANCIAL_V2' source,2 priority
    from public.erp_financial_receivables r
    where r.company_id=p_company_id and r.customer_id=p_customer_id and r.status in ('OPEN','PARTIALLY_PAID')
    union all
    select e.record_id,coalesce(e.payload->>'customerId',''),coalesce(e.payload->>'customerName',''),coalesce(e.payload->>'customerTaxId',''),
      case lower(coalesce(nullif(e.payload->>'documentType',''),'documento manual'))
        when 'factura sri' then 'INVOICE' when 'factura futura' then 'INVOICE'
        else upper(replace(coalesce(nullif(e.payload->>'documentType',''),'documento manual'),' ','_')) end,
      coalesce(e.payload->>'documentNumber',e.record_id),
      case when coalesce(e.payload->>'issueDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (e.payload->>'issueDate')::date end,
      case when coalesce(e.payload->>'dueDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dueDate')::date end,
      case when coalesce(e.payload->>'total','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end,
      case when coalesce(e.payload->>'balance','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'balance')::numeric else case when coalesce(e.payload->>'total','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end end,
      upper(coalesce(nullif(e.payload->>'status',''),'PENDIENTE')),'LEGACY_PROJECTION',1
    from public.erp_entity_records e
    where e.company_id=p_company_id and e.entity='customer_receivables' and e.deleted_at is null
      and e.payload->>'customerId'=p_customer_id and upper(coalesce(e.payload->>'status','PENDIENTE')) not in ('COBRADO','ANULADO')
  ), ranked as (
    select *,row_number() over(partition by customer_id,document_type,document_number order by priority desc) winner
    from candidates
    where nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',document_number,customer_name,customer_tax_id)) like '%'||lower(btrim(p_search))||'%'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'customerId',customer_id,'customerName',customer_name,'customerTaxId',customer_tax_id,
    'documentType',document_type,'documentNumber',document_number,'issueDate',issue_date,'dueDate',due_date,'total',total,'balance',balance,'status',status,'source',source
  ) order by issue_date desc,document_number desc),'[]'::jsonb) into v_items
  from (select * from ranked where winner=1 order by issue_date desc,document_number desc limit p_limit) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',jsonb_array_length(v_items));
end $$;

revoke all on function public.erp_received_withholding_read_assert_page(integer,integer) from public,anon;
revoke all on function public.erp_received_withholding_read_rows(uuid) from public,anon;
revoke all on function public.erp_received_withholding_read_health(uuid) from public,anon;
revoke all on function public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_received_withholding_detail(uuid,text) from public,anon;
revoke all on function public.erp_received_withholding_receivable_lookup(uuid,text,text,integer) from public,anon;
grant execute on function public.erp_received_withholding_read_health(uuid) to authenticated,service_role;
grant execute on function public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_received_withholding_detail(uuid,text) to authenticated,service_role;
grant execute on function public.erp_received_withholding_receivable_lookup(uuid,text,text,integer) to authenticated,service_role;

comment on function public.erp_received_withholding_page(uuid,date,date,text,text,text,text,text,integer,integer) is
'READ-ONLY search-first sobre received_withholdings. Fecha funcional: payload.issueDate inclusiva.';
