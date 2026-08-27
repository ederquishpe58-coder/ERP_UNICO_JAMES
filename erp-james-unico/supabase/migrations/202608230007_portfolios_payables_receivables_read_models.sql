-- CONT-A / Punto 5: CxP + CxC search-first.
-- Read-models aditivos. No modifica las mutaciones Supplier Finance V2 / Financial V2.

create index if not exists erp_supplier_payable_history_read_idx
  on public.erp_supplier_accounts_payable(company_id,issue_date desc,payable_id);
create index if not exists erp_financial_receivable_history_read_idx
  on public.erp_financial_receivables(company_id,issue_date desc,receivable_id);

create or replace function public.erp_portfolio_read_assert_page(p_limit integer,p_offset integer)
returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if coalesce(p_limit,0) not in (25,50) or coalesce(p_offset,-1)<0 then
    raise exception using errcode='22023',message='PORTFOLIO_PAGE_INVALID';
  end if;
end $$;

create or replace function public.erp_portfolio_read_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok',true,'component','PORTFOLIO_READ_V2','migration','202608230007',
    'supplierPayables',to_regclass('public.erp_supplier_accounts_payable') is not null,
    'customerReceivables',to_regclass('public.erp_financial_receivables') is not null,
    'apOpen',to_regprocedure('public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer)') is not null,
    'apHistory',to_regprocedure('public.erp_supplier_payables_history_page(uuid,date,date,text,text,text,text,integer,integer)') is not null,
    'apDetail',to_regprocedure('public.erp_supplier_payable_detail(uuid,text,text)') is not null,
    'arOpen',to_regprocedure('public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer)') is not null,
    'arHistory',to_regprocedure('public.erp_customer_receivables_history_page(uuid,date,date,text,text,text,text,text,integer,integer)') is not null,
    'arDetail',to_regprocedure('public.erp_customer_receivable_detail(uuid,text,text)') is not null
  );
end $$;

create or replace function public.erp_supplier_payables_open_page(
  p_company_id uuid,p_provider_id text default null,p_state text default null,p_due_mode text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint; v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_portfolio_read_assert_page(p_limit,p_offset);
  with rows as (
    select a.payable_id::text id,'SUPPLIER_FINANCE_V2' source,a.provider_id::text provider_id,
      p.provider_code,p.legal_name provider_name,p.tax_id provider_ruc,a.source_id::text purchase_id,
      a.document_number,a.issue_date,a.due_date,a.total,a.balance,
      greatest(a.total-a.balance,0) paid,0::numeric retention_applied,0::numeric advance_applied,
      case when a.status='CANCELLED' then 'ANULADO' when a.balance<=0 or a.status='PAID' then 'PAGADO'
        when a.due_date<current_date then 'VENCIDO' when a.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,
      a.status canonical_status,a.journal_entry_id::text journal_entry_id,a.updated_at,a.version
    from public.erp_supplier_accounts_payable a
    join public.erp_supplier_providers p on p.company_id=a.company_id and p.provider_id=a.provider_id
    where a.company_id=p_company_id and a.status in ('OPEN','PARTIALLY_PAID') and a.balance>0
  ), filtered as (
    select * from rows r where
      (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id)) and
      (nullif(upper(btrim(p_state)),'') is null or r.state=upper(btrim(p_state))) and
      (nullif(upper(btrim(p_due_mode)),'') is null or (upper(btrim(p_due_mode))='OVERDUE' and r.due_date<current_date)
        or (upper(btrim(p_due_mode))='UPCOMING' and r.due_date>=current_date)) and
      (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%')
  )
  select count(*),jsonb_build_object('totalPending',coalesce(sum(balance),0),'totalOverdue',coalesce(sum(balance) filter(where due_date<current_date),0),
    'totalUpcoming',coalesce(sum(balance) filter(where due_date>=current_date),0),'totalPaid',coalesce(sum(paid),0),'openDocuments',count(*))
    into v_total,v_summary from filtered;
  with rows as (
    select a.payable_id::text id,'SUPPLIER_FINANCE_V2' source,a.provider_id::text provider_id,
      p.provider_code,p.legal_name provider_name,p.tax_id provider_ruc,a.source_id::text purchase_id,
      a.document_number,a.issue_date,a.due_date,a.total,a.balance,greatest(a.total-a.balance,0) paid,
      0::numeric retention_applied,0::numeric advance_applied,
      case when a.status='CANCELLED' then 'ANULADO' when a.balance<=0 or a.status='PAID' then 'PAGADO'
        when a.due_date<current_date then 'VENCIDO' when a.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,
      a.status canonical_status,a.journal_entry_id::text journal_entry_id,a.updated_at,a.version
    from public.erp_supplier_accounts_payable a join public.erp_supplier_providers p on p.company_id=a.company_id and p.provider_id=a.provider_id
    where a.company_id=p_company_id and a.status in ('OPEN','PARTIALLY_PAID') and a.balance>0
  ), filtered as (select * from rows r where
      (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id)) and
      (nullif(upper(btrim(p_state)),'') is null or r.state=upper(btrim(p_state))) and
      (nullif(upper(btrim(p_due_mode)),'') is null or (upper(btrim(p_due_mode))='OVERDUE' and r.due_date<current_date) or (upper(btrim(p_due_mode))='UPCOMING' and r.due_date>=current_date)) and
      (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%'))
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'providerId',provider_id,'providerCode',provider_code,'providerName',provider_name,
    'providerRuc',provider_ruc,'purchaseId',purchase_id,'documentNumber',document_number,'issueDate',issue_date,'dueDate',due_date,
    'totalDocument',total,'balance',balance,'paid',paid,'retentionApplied',retention_applied,'advanceApplied',advance_applied,
    'state',state,'canonicalStatus',canonical_status,'journalEntryId',journal_entry_id,'updatedAt',updated_at,'version',version)
    order by due_date,issue_date desc,document_number),'[]'::jsonb) into v_items
  from (select * from filtered order by due_date,issue_date desc,document_number limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_supplier_payables_history_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_provider_id text default null,p_state text default null,p_document text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint; v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform public.erp_portfolio_read_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then raise exception using errcode='22023',message='PORTFOLIO_DATE_RANGE_REQUIRED'; end if;
  with rows as (
    select a.payable_id::text id,'SUPPLIER_FINANCE_V2' source,a.provider_id::text provider_id,p.provider_code,p.legal_name provider_name,p.tax_id provider_ruc,
      a.source_id::text purchase_id,a.document_number,a.issue_date,a.due_date,a.total,a.balance,greatest(a.total-a.balance,0) paid,
      case when a.status='CANCELLED' then 'ANULADO' when a.balance<=0 or a.status='PAID' then 'PAGADO' when a.due_date<current_date then 'VENCIDO'
        when a.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,a.status canonical_status,a.journal_entry_id::text journal_entry_id,a.updated_at,a.version
    from public.erp_supplier_accounts_payable a join public.erp_supplier_providers p on p.company_id=a.company_id and p.provider_id=a.provider_id where a.company_id=p_company_id
  ), filtered as (select * from rows r where r.issue_date between p_date_from and p_date_to
    and (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id))
    and (nullif(upper(btrim(p_state)),'') is null or r.state=upper(btrim(p_state)))
    and (nullif(btrim(p_document),'') is null or r.document_number ilike '%'||btrim(p_document)||'%')
    and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%'))
  select count(*),jsonb_build_object('totalDocuments',count(*),'totalOriginal',coalesce(sum(total),0),'totalBalance',coalesce(sum(balance),0),'totalApplied',coalesce(sum(total-balance),0)) into v_total,v_summary from filtered;
  with rows as (
    select a.payable_id::text id,'SUPPLIER_FINANCE_V2' source,a.provider_id::text provider_id,p.provider_code,p.legal_name provider_name,p.tax_id provider_ruc,
      a.source_id::text purchase_id,a.document_number,a.issue_date,a.due_date,a.total,a.balance,greatest(a.total-a.balance,0) paid,
      case when a.status='CANCELLED' then 'ANULADO' when a.balance<=0 or a.status='PAID' then 'PAGADO' when a.due_date<current_date then 'VENCIDO'
        when a.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,a.status canonical_status,a.journal_entry_id::text journal_entry_id,a.updated_at,a.version
    from public.erp_supplier_accounts_payable a join public.erp_supplier_providers p on p.company_id=a.company_id and p.provider_id=a.provider_id where a.company_id=p_company_id
  ), filtered as (select * from rows r where r.issue_date between p_date_from and p_date_to
    and (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id)) and (nullif(upper(btrim(p_state)),'') is null or r.state=upper(btrim(p_state)))
    and (nullif(btrim(p_document),'') is null or r.document_number ilike '%'||btrim(p_document)||'%')
    and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%'))
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'providerId',provider_id,'providerCode',provider_code,'providerName',provider_name,'providerRuc',provider_ruc,
    'purchaseId',purchase_id,'documentNumber',document_number,'issueDate',issue_date,'dueDate',due_date,'totalDocument',total,'balance',balance,'paid',paid,
    'retentionApplied',0,'advanceApplied',0,'state',state,'canonicalStatus',canonical_status,'journalEntryId',journal_entry_id,'updatedAt',updated_at,'version',version)
    order by issue_date desc,document_number desc),'[]'::jsonb) into v_items from (select * from filtered order by issue_date desc,document_number desc limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_supplier_payable_detail(p_company_id uuid,p_payable_id text,p_source text default 'SUPPLIER_FINANCE_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_item jsonb; v_apps jsonb; v_adjustments jsonb; v_journal jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if upper(coalesce(p_source,''))<>'SUPPLIER_FINANCE_V2' or p_payable_id !~* '^[0-9a-f-]{36}$' then raise exception using errcode='P0002',message='PAYABLE_NOT_FOUND'; end if;
  v_id:=p_payable_id::uuid;
  select to_jsonb(a)||jsonb_build_object('provider',to_jsonb(p),'purchase',to_jsonb(d)) into v_item
    from public.erp_supplier_accounts_payable a join public.erp_supplier_providers p on p.company_id=a.company_id and p.provider_id=a.provider_id
    left join public.erp_supplier_purchase_documents d on d.company_id=a.company_id and d.purchase_document_id=a.source_id
    where a.company_id=p_company_id and a.payable_id=v_id;
  if v_item is null then raise exception using errcode='P0002',message='PAYABLE_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_date desc),'[]'::jsonb) into v_apps from (
    select a.*,p.payment_code,p.payment_date,p.payment_method,p.reference,p.status payment_status,p.journal_entry_id
    from public.erp_supplier_payment_applications a join public.erp_supplier_payments p on p.company_id=a.company_id and p.payment_id=a.payment_id
    where a.company_id=p_company_id and a.payable_id=v_id) x;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.adjustment_date desc),'[]'::jsonb) into v_adjustments from public.erp_supplier_adjustments a where a.company_id=p_company_id and a.payable_id=v_id;
  select jsonb_build_object('header',to_jsonb(e),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_number) from public.erp_financial_journal_lines l where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id),'[]'::jsonb)) into v_journal
    from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=(v_item->>'journal_entry_id')::uuid;
  return jsonb_build_object('ok',true,'item',v_item,'applications',v_apps,'adjustments',v_adjustments,'journal',coalesce(v_journal,'null'::jsonb));
end $$;

create or replace function public.erp_customer_receivables_open_page(
  p_company_id uuid,p_customer_id text default null,p_state text default null,p_due_mode text default null,p_search text default null,
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint; v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform public.erp_portfolio_read_assert_page(p_limit,p_offset);
  with filtered as (
    select r.*,case when r.due_date<current_date then 'VENCIDO' when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,
      greatest(r.total-r.balance-r.credited_total,0) collected
    from public.erp_financial_receivables r where r.company_id=p_company_id and r.status in ('OPEN','PARTIALLY_PAID') and r.balance>0
      and (nullif(btrim(p_customer_id),'') is null or r.customer_id=btrim(p_customer_id))
      and (nullif(upper(btrim(p_state)),'') is null or (case when r.due_date<current_date then 'VENCIDO' when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end)=upper(btrim(p_state)))
      and (nullif(upper(btrim(p_due_mode)),'') is null or (upper(btrim(p_due_mode))='OVERDUE' and r.due_date<current_date) or (upper(btrim(p_due_mode))='UPCOMING' and r.due_date>=current_date))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.customer_name_snapshot,r.customer_tax_id_snapshot,r.document_number,r.source_id,r.journal_entry_id::text)) like '%'||lower(btrim(p_search))||'%')
  )
  select count(*),jsonb_build_object('totalPending',coalesce(sum(balance),0),'totalOverdue',coalesce(sum(balance) filter(where due_date<current_date),0),
    'totalUpcoming',coalesce(sum(balance) filter(where due_date>=current_date),0),'totalCollected',coalesce(sum(collected),0),'openDocuments',count(*)) into v_total,v_summary from filtered;
  with filtered as (
    select r.*,case when r.due_date<current_date then 'VENCIDO' when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,
      greatest(r.total-r.balance-r.credited_total,0) collected
    from public.erp_financial_receivables r where r.company_id=p_company_id and r.status in ('OPEN','PARTIALLY_PAID') and r.balance>0
      and (nullif(btrim(p_customer_id),'') is null or r.customer_id=btrim(p_customer_id))
      and (nullif(upper(btrim(p_state)),'') is null or (case when r.due_date<current_date then 'VENCIDO' when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end)=upper(btrim(p_state)))
      and (nullif(upper(btrim(p_due_mode)),'') is null or (upper(btrim(p_due_mode))='OVERDUE' and r.due_date<current_date) or (upper(btrim(p_due_mode))='UPCOMING' and r.due_date>=current_date))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.customer_name_snapshot,r.customer_tax_id_snapshot,r.document_number,r.source_id,r.journal_entry_id::text)) like '%'||lower(btrim(p_search))||'%')
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',receivable_id::text,'source','FINANCIAL_V2','customerId',customer_id,'customerName',customer_name_snapshot,
    'customerTaxId',customer_tax_id_snapshot,'sourceId',source_id,'documentType',document_type,'documentNumber',document_number,'issueDate',issue_date,'dueDate',due_date,
    'total',total,'credited',credited_total,'collected',collected,'withheld',0,'balance',balance,'status',state,'canonicalStatus',status,
    'journalEntryId',journal_entry_id::text,'updatedAt',updated_at,'version',version) order by due_date,issue_date desc,document_number),'[]'::jsonb) into v_items
  from (select * from filtered order by due_date,issue_date desc,document_number limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_customer_receivables_history_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_customer_id text default null,p_state text default null,p_document_type text default null,
  p_document text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint; v_summary jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform public.erp_portfolio_read_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then raise exception using errcode='22023',message='PORTFOLIO_DATE_RANGE_REQUIRED'; end if;
  with filtered as (
    select r.*,case when r.status='CANCELLED' then 'ANULADO' when r.status='PAID' or r.balance<=0 then 'COBRADO' when r.due_date<current_date then 'VENCIDO'
      when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,greatest(r.total-r.balance-r.credited_total,0) collected
    from public.erp_financial_receivables r where r.company_id=p_company_id and r.issue_date between p_date_from and p_date_to
      and (nullif(btrim(p_customer_id),'') is null or r.customer_id=btrim(p_customer_id))
      and (nullif(upper(btrim(p_state)),'') is null or (case when r.status='CANCELLED' then 'ANULADO' when r.status='PAID' or r.balance<=0 then 'COBRADO' when r.due_date<current_date then 'VENCIDO' when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end)=upper(btrim(p_state)))
      and (nullif(upper(btrim(p_document_type)),'') is null or upper(r.document_type)=upper(btrim(p_document_type)))
      and (nullif(btrim(p_document),'') is null or r.document_number ilike '%'||btrim(p_document)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.customer_name_snapshot,r.customer_tax_id_snapshot,r.document_number,r.source_id,r.journal_entry_id::text)) like '%'||lower(btrim(p_search))||'%')
  )
  select count(*),jsonb_build_object('totalDocuments',count(*),'totalOriginal',coalesce(sum(total),0),'totalBalance',coalesce(sum(balance),0),
    'totalCollected',coalesce(sum(collected),0),'totalCredited',coalesce(sum(credited_total),0)) into v_total,v_summary from filtered;
  with filtered as (
    select r.*,case when r.status='CANCELLED' then 'ANULADO' when r.status='PAID' or r.balance<=0 then 'COBRADO' when r.due_date<current_date then 'VENCIDO'
      when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,greatest(r.total-r.balance-r.credited_total,0) collected
    from public.erp_financial_receivables r where r.company_id=p_company_id and r.issue_date between p_date_from and p_date_to
      and (nullif(btrim(p_customer_id),'') is null or r.customer_id=btrim(p_customer_id))
      and (nullif(upper(btrim(p_state)),'') is null or (case when r.status='CANCELLED' then 'ANULADO' when r.status='PAID' or r.balance<=0 then 'COBRADO' when r.due_date<current_date then 'VENCIDO' when r.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end)=upper(btrim(p_state)))
      and (nullif(upper(btrim(p_document_type)),'') is null or upper(r.document_type)=upper(btrim(p_document_type)))
      and (nullif(btrim(p_document),'') is null or r.document_number ilike '%'||btrim(p_document)||'%')
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.customer_name_snapshot,r.customer_tax_id_snapshot,r.document_number,r.source_id,r.journal_entry_id::text)) like '%'||lower(btrim(p_search))||'%')
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',receivable_id::text,'source','FINANCIAL_V2','customerId',customer_id,'customerName',customer_name_snapshot,
    'customerTaxId',customer_tax_id_snapshot,'sourceId',source_id,'documentType',document_type,'documentNumber',document_number,'issueDate',issue_date,'dueDate',due_date,
    'total',total,'credited',credited_total,'collected',collected,'withheld',0,'balance',balance,'status',state,'canonicalStatus',status,
    'journalEntryId',journal_entry_id::text,'updatedAt',updated_at,'version',version) order by issue_date desc,document_number desc),'[]'::jsonb) into v_items
  from (select * from filtered order by issue_date desc,document_number desc limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_customer_receivable_detail(p_company_id uuid,p_receivable_id text,p_source text default 'FINANCIAL_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_item jsonb; v_apps jsonb; v_credits jsonb; v_withholdings jsonb; v_journal jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if upper(coalesce(p_source,''))<>'FINANCIAL_V2' or p_receivable_id !~* '^[0-9a-f-]{36}$' then raise exception using errcode='P0002',message='RECEIVABLE_NOT_FOUND'; end if;
  v_id:=p_receivable_id::uuid;
  select to_jsonb(r) into v_item from public.erp_financial_receivables r where r.company_id=p_company_id and r.receivable_id=v_id;
  if v_item is null then raise exception using errcode='P0002',message='RECEIVABLE_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.collection_date desc),'[]'::jsonb) into v_apps from (
    select a.*,c.collection_number,c.collection_date,c.payment_method,c.reference,c.status collection_status,c.journal_entry_id
    from public.erp_financial_collection_applications a join public.erp_financial_collections c on c.company_id=a.company_id and c.collection_id=a.collection_id
    where a.company_id=p_company_id and a.receivable_id=v_id) x;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.issue_date desc),'[]'::jsonb) into v_credits from public.erp_financial_credit_notes c where c.company_id=p_company_id and c.receivable_id=v_id;
  select coalesce(jsonb_agg(e.payload||jsonb_build_object('id',e.record_id) order by e.updated_at desc),'[]'::jsonb) into v_withholdings
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='received_withholdings' and e.deleted_at is null and e.payload->>'relatedReceivableId'=p_receivable_id;
  select jsonb_build_object('header',to_jsonb(e),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_number) from public.erp_financial_journal_lines l where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id),'[]'::jsonb)) into v_journal
    from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=(v_item->>'journal_entry_id')::uuid;
  return jsonb_build_object('ok',true,'item',v_item,'applications',v_apps,'creditNotes',v_credits,'receivedWithholdings',v_withholdings,'journal',coalesce(v_journal,'null'::jsonb));
end $$;

revoke all on function public.erp_portfolio_read_assert_page(integer,integer) from public,anon;
revoke all on function public.erp_portfolio_read_health(uuid) from public,anon;
revoke all on function public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_supplier_payables_history_page(uuid,date,date,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_supplier_payable_detail(uuid,text,text) from public,anon;
revoke all on function public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_customer_receivables_history_page(uuid,date,date,text,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_customer_receivable_detail(uuid,text,text) from public,anon;
grant execute on function public.erp_portfolio_read_health(uuid) to authenticated,service_role;
grant execute on function public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_supplier_payables_history_page(uuid,date,date,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_supplier_payable_detail(uuid,text,text) to authenticated,service_role;
grant execute on function public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_customer_receivables_history_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_customer_receivable_detail(uuid,text,text) to authenticated,service_role;

comment on function public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer) is 'READ-ONLY: cartera operativa CxP canónica, paginada y resumida server-side.';
comment on function public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer) is 'READ-ONLY: cartera operativa CxC canónica, paginada y resumida server-side.';

-- Compatibilidad histórica: V2 gana por source id; el legado nunca participa en mutaciones nuevas.
create or replace function public.erp_supplier_payable_read_rows(p_company_id uuid)
returns table(id text,source text,provider_id text,provider_code text,provider_name text,provider_ruc text,purchase_id text,
  document_number text,issue_date date,due_date date,total numeric,balance numeric,paid numeric,retention_applied numeric,advance_applied numeric,
  state text,canonical_status text,journal_entry_id text,updated_at timestamptz,version bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  with candidates as (
    select a.payable_id::text id,'SUPPLIER_FINANCE_V2' source,a.provider_id::text provider_id,p.provider_code,p.legal_name provider_name,p.tax_id provider_ruc,
      a.source_id::text purchase_id,a.document_number,a.issue_date,a.due_date,a.total,a.balance,greatest(a.total-a.balance,0) paid,
      0::numeric retention_applied,0::numeric advance_applied,
      case when a.status='CANCELLED' then 'ANULADO' when a.balance<=0 or a.status='PAID' then 'PAGADO' when a.due_date<current_date then 'VENCIDO'
        when a.status='PARTIALLY_PAID' then 'PARCIAL' else 'PENDIENTE' end state,a.status canonical_status,a.journal_entry_id::text,
      a.updated_at,a.version,'REL|'||a.source_id::text dedup_key,2 priority
    from public.erp_supplier_accounts_payable a join public.erp_supplier_providers p on p.company_id=a.company_id and p.provider_id=a.provider_id
    where a.company_id=p_company_id
    union all
    select e.record_id,'LEGACY_PROJECTION',coalesce(e.payload->>'providerId',e.payload->>'supplierId',''),coalesce(e.payload->>'providerCode',''),
      coalesce(e.payload->>'providerName',e.payload->>'supplierName',''),coalesce(e.payload->>'providerRuc',e.payload->>'supplierRuc',''),
      coalesce(e.payload->>'purchaseId',e.payload->>'sourceId',''),coalesce(e.payload->>'documentNumber',e.record_id),
      case when coalesce(e.payload->>'issueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'issueDate')::date end,
      case when coalesce(e.payload->>'dueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dueDate')::date when coalesce(e.payload->>'issueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'issueDate')::date end,
      case when coalesce(e.payload->>'totalDocument',e.payload->>'total','')~'^-?\d+(\.\d+)?$' then coalesce(e.payload->>'totalDocument',e.payload->>'total')::numeric else 0 end,
      case when coalesce(e.payload->>'balance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'balance')::numeric else 0 end,
      case when coalesce(e.payload->>'paid','')~'^-?\d+(\.\d+)?$' then (e.payload->>'paid')::numeric else 0 end,
      case when coalesce(e.payload->>'retentionApplied','')~'^-?\d+(\.\d+)?$' then (e.payload->>'retentionApplied')::numeric else 0 end,
      case when coalesce(e.payload->>'advanceApplied','')~'^-?\d+(\.\d+)?$' then (e.payload->>'advanceApplied')::numeric else 0 end,
      case
        when upper(coalesce(e.payload->>'state',e.payload->>'status','')) in ('ANULADO','CANCELLED') then 'ANULADO'
        when (case when coalesce(e.payload->>'balance','')~'^-?\d+(\.\d+)?$' then (e.payload->>'balance')::numeric else 0 end)<=0
          or upper(coalesce(e.payload->>'state',e.payload->>'status','')) in ('PAGADO','PAID') then 'PAGADO'
        when (case when coalesce(e.payload->>'dueDate','')~'^\d{4}-\d{2}-\d{2}$' then (e.payload->>'dueDate')::date end)<current_date then 'VENCIDO'
        when upper(coalesce(e.payload->>'state',e.payload->>'status','')) in ('PARCIAL','PARTIALLY_PAID')
          or (case when coalesce(e.payload->>'paid','')~'^-?\d+(\.\d+)?$' then (e.payload->>'paid')::numeric else 0 end)>0
          or (case when coalesce(e.payload->>'retentionApplied','')~'^-?\d+(\.\d+)?$' then (e.payload->>'retentionApplied')::numeric else 0 end)>0
          or (case when coalesce(e.payload->>'advanceApplied','')~'^-?\d+(\.\d+)?$' then (e.payload->>'advanceApplied')::numeric else 0 end)>0 then 'PARCIAL'
        else 'PENDIENTE' end,
      upper(coalesce(nullif(e.payload->>'status',''),'OPEN')),
      coalesce(e.payload->>'originEntryId',e.payload->>'journalEntryId',''),e.updated_at,e.version,
      case when nullif(coalesce(e.payload->>'purchaseId',e.payload->>'sourceId',''),'') is not null then 'REL|'||coalesce(e.payload->>'purchaseId',e.payload->>'sourceId') else 'LEG|'||e.record_id end,1
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='purchase_payables' and e.deleted_at is null
  ), ranked as (select *,row_number() over(partition by dedup_key order by priority desc) winner from candidates)
  select id,source,provider_id,provider_code,provider_name,provider_ruc,purchase_id,document_number,issue_date,due_date,total,balance,paid,
    retention_applied,advance_applied,state,canonical_status,journal_entry_id,updated_at,version from ranked where winner=1
$$;

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
      'DOC|'||r.customer_id||'|'||upper(r.document_type)||'|'||r.document_number dedup_key,2 priority
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
      'DOC|'||coalesce(e.payload->>'customerId','')||'|'||upper(replace(coalesce(e.payload->>'documentType','DOCUMENTO_MANUAL'),' ','_'))||'|'||coalesce(e.payload->>'documentNumber',e.record_id),1
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='customer_receivables' and e.deleted_at is null
  ), ranked as (select *,row_number() over(partition by dedup_key order by priority desc) winner from candidates)
  select id,source,customer_id,customer_name,customer_tax_id,source_id,document_type,document_number,issue_date,due_date,total,credited,collected,withheld,
    balance,status,canonical_status,journal_entry_id,updated_at,version from ranked where winner=1
$$;

-- Las cuatro páginas se redefinen sobre el universo V2 + legado deduplicado.
create or replace function public.erp_supplier_payables_open_page(p_company_id uuid,p_provider_id text default null,p_state text default null,p_due_mode text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_summary jsonb;
begin perform public.erp_financial_v2_assert_access(p_company_id);perform public.erp_portfolio_read_assert_page(p_limit,p_offset);
 with f as (select * from public.erp_supplier_payable_read_rows(p_company_id) r where r.balance>0 and r.state not in('PAGADO','ANULADO')
  and (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id)) and (nullif(upper(btrim(p_state)),'') is null or r.state=upper(btrim(p_state)))
  and (nullif(upper(btrim(p_due_mode)),'') is null or (upper(btrim(p_due_mode))='OVERDUE' and r.due_date<current_date) or (upper(btrim(p_due_mode))='UPCOMING' and r.due_date>=current_date))
  and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%'))
 select count(*),jsonb_build_object('totalPending',coalesce(sum(balance),0),'totalOverdue',coalesce(sum(balance)filter(where due_date<current_date),0),'totalUpcoming',coalesce(sum(balance)filter(where due_date>=current_date),0),'totalPaid',coalesce(sum(paid),0),'openDocuments',count(*)) into v_total,v_summary from f;
 with f as (select * from public.erp_supplier_payable_read_rows(p_company_id) r where r.balance>0 and r.state not in('PAGADO','ANULADO')
  and (nullif(btrim(p_provider_id),'') is null or r.provider_id=btrim(p_provider_id)) and (nullif(upper(btrim(p_state)),'') is null or r.state=upper(btrim(p_state)))
  and (nullif(upper(btrim(p_due_mode)),'') is null or (upper(btrim(p_due_mode))='OVERDUE' and r.due_date<current_date) or (upper(btrim(p_due_mode))='UPCOMING' and r.due_date>=current_date))
  and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.provider_name,r.provider_ruc,r.provider_code,r.document_number,r.journal_entry_id)) like '%'||lower(btrim(p_search))||'%'))
 select coalesce(jsonb_agg(to_jsonb(q) order by due_date,issue_date desc,document_number),'[]') into v_items from(select * from f order by due_date,issue_date desc,document_number limit p_limit offset p_offset)q;
 return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);end $$;

create or replace function public.erp_supplier_payables_history_page(p_company_id uuid,p_date_from date,p_date_to date,p_provider_id text default null,p_state text default null,p_document text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_summary jsonb;begin perform public.erp_financial_v2_assert_access(p_company_id);perform public.erp_portfolio_read_assert_page(p_limit,p_offset);if p_date_from is null or p_date_to is null or p_date_from>p_date_to then raise exception using errcode='22023',message='PORTFOLIO_DATE_RANGE_REQUIRED';end if;
 with f as(select * from public.erp_supplier_payable_read_rows(p_company_id)r where issue_date between p_date_from and p_date_to and(nullif(btrim(p_provider_id),'')is null or provider_id=btrim(p_provider_id))and(nullif(upper(btrim(p_state)),'')is null or state=upper(btrim(p_state)))and(nullif(btrim(p_document),'')is null or document_number ilike '%'||btrim(p_document)||'%')and(nullif(lower(btrim(p_search)),'')is null or lower(concat_ws(' ',provider_name,provider_ruc,provider_code,document_number,journal_entry_id))like '%'||lower(btrim(p_search))||'%'))
 select count(*),jsonb_build_object('totalDocuments',count(*),'totalOriginal',coalesce(sum(total),0),'totalBalance',coalesce(sum(balance),0),'totalApplied',coalesce(sum(total-balance),0))into v_total,v_summary from f;
 with f as(select * from public.erp_supplier_payable_read_rows(p_company_id)r where issue_date between p_date_from and p_date_to and(nullif(btrim(p_provider_id),'')is null or provider_id=btrim(p_provider_id))and(nullif(upper(btrim(p_state)),'')is null or state=upper(btrim(p_state)))and(nullif(btrim(p_document),'')is null or document_number ilike '%'||btrim(p_document)||'%')and(nullif(lower(btrim(p_search)),'')is null or lower(concat_ws(' ',provider_name,provider_ruc,provider_code,document_number,journal_entry_id))like '%'||lower(btrim(p_search))||'%'))
 select coalesce(jsonb_agg(to_jsonb(q)order by issue_date desc,document_number desc),'[]')into v_items from(select * from f order by issue_date desc,document_number desc limit p_limit offset p_offset)q;return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);end $$;

create or replace function public.erp_customer_receivables_open_page(p_company_id uuid,p_customer_id text default null,p_state text default null,p_due_mode text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_summary jsonb;begin perform public.erp_financial_v2_assert_access(p_company_id);perform public.erp_portfolio_read_assert_page(p_limit,p_offset);
 with f as(select * from public.erp_customer_receivable_read_rows(p_company_id)r where balance>0 and status not in('COBRADO','ANULADO')and(nullif(btrim(p_customer_id),'')is null or customer_id=btrim(p_customer_id))and(nullif(upper(btrim(p_state)),'')is null or status=upper(btrim(p_state)))and(nullif(upper(btrim(p_due_mode)),'')is null or(upper(btrim(p_due_mode))='OVERDUE'and due_date<current_date)or(upper(btrim(p_due_mode))='UPCOMING'and due_date>=current_date))and(nullif(lower(btrim(p_search)),'')is null or lower(concat_ws(' ',customer_name,customer_tax_id,document_number,source_id,journal_entry_id))like '%'||lower(btrim(p_search))||'%'))
 select count(*),jsonb_build_object('totalPending',coalesce(sum(balance),0),'totalOverdue',coalesce(sum(balance)filter(where due_date<current_date),0),'totalUpcoming',coalesce(sum(balance)filter(where due_date>=current_date),0),'totalCollected',coalesce(sum(collected),0),'openDocuments',count(*))into v_total,v_summary from f;
 with f as(select * from public.erp_customer_receivable_read_rows(p_company_id)r where balance>0 and status not in('COBRADO','ANULADO')and(nullif(btrim(p_customer_id),'')is null or customer_id=btrim(p_customer_id))and(nullif(upper(btrim(p_state)),'')is null or status=upper(btrim(p_state)))and(nullif(upper(btrim(p_due_mode)),'')is null or(upper(btrim(p_due_mode))='OVERDUE'and due_date<current_date)or(upper(btrim(p_due_mode))='UPCOMING'and due_date>=current_date))and(nullif(lower(btrim(p_search)),'')is null or lower(concat_ws(' ',customer_name,customer_tax_id,document_number,source_id,journal_entry_id))like '%'||lower(btrim(p_search))||'%'))
 select coalesce(jsonb_agg(to_jsonb(q)order by due_date,issue_date desc,document_number),'[]')into v_items from(select * from f order by due_date,issue_date desc,document_number limit p_limit offset p_offset)q;return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);end $$;

create or replace function public.erp_customer_receivables_history_page(p_company_id uuid,p_date_from date,p_date_to date,p_customer_id text default null,p_state text default null,p_document_type text default null,p_document text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_summary jsonb;begin perform public.erp_financial_v2_assert_access(p_company_id);perform public.erp_portfolio_read_assert_page(p_limit,p_offset);if p_date_from is null or p_date_to is null or p_date_from>p_date_to then raise exception using errcode='22023',message='PORTFOLIO_DATE_RANGE_REQUIRED';end if;
 with f as(select * from public.erp_customer_receivable_read_rows(p_company_id)r where issue_date between p_date_from and p_date_to and(nullif(btrim(p_customer_id),'')is null or customer_id=btrim(p_customer_id))and(nullif(upper(btrim(p_state)),'')is null or status=upper(btrim(p_state)))and(nullif(upper(btrim(p_document_type)),'')is null or upper(document_type)=upper(btrim(p_document_type)))and(nullif(btrim(p_document),'')is null or document_number ilike '%'||btrim(p_document)||'%')and(nullif(lower(btrim(p_search)),'')is null or lower(concat_ws(' ',customer_name,customer_tax_id,document_number,source_id,journal_entry_id))like '%'||lower(btrim(p_search))||'%'))
 select count(*),jsonb_build_object('totalDocuments',count(*),'totalOriginal',coalesce(sum(total),0),'totalBalance',coalesce(sum(balance),0),'totalCollected',coalesce(sum(collected),0),'totalCredited',coalesce(sum(credited),0))into v_total,v_summary from f;
 with f as(select * from public.erp_customer_receivable_read_rows(p_company_id)r where issue_date between p_date_from and p_date_to and(nullif(btrim(p_customer_id),'')is null or customer_id=btrim(p_customer_id))and(nullif(upper(btrim(p_state)),'')is null or status=upper(btrim(p_state)))and(nullif(upper(btrim(p_document_type)),'')is null or upper(document_type)=upper(btrim(p_document_type)))and(nullif(btrim(p_document),'')is null or document_number ilike '%'||btrim(p_document)||'%')and(nullif(lower(btrim(p_search)),'')is null or lower(concat_ws(' ',customer_name,customer_tax_id,document_number,source_id,journal_entry_id))like '%'||lower(btrim(p_search))||'%'))
 select coalesce(jsonb_agg(to_jsonb(q)order by issue_date desc,document_number desc),'[]')into v_items from(select * from f order by issue_date desc,document_number desc limit p_limit offset p_offset)q;return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'summary',v_summary,'limit',p_limit,'offset',p_offset);end $$;

revoke all on function public.erp_supplier_payable_read_rows(uuid) from public,anon;
revoke all on function public.erp_customer_receivable_read_rows(uuid) from public,anon;

create or replace function public.erp_supplier_payable_detail(p_company_id uuid,p_payable_id text,p_source text default 'SUPPLIER_FINANCE_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_item jsonb;v_apps jsonb:='[]';v_adjustments jsonb:='[]';v_journal jsonb:='null';v_journal_id text;
begin perform public.erp_financial_v2_assert_access(p_company_id);
 if upper(coalesce(p_source,''))='LEGACY_PROJECTION' then
  select e.payload||jsonb_build_object('id',e.record_id,'source','LEGACY_PROJECTION','version',e.version,'updatedAt',e.updated_at) into v_item from public.erp_entity_records e where e.company_id=p_company_id and e.entity='purchase_payables' and e.record_id=p_payable_id and e.deleted_at is null;
  if v_item is null then raise exception using errcode='P0002',message='PAYABLE_NOT_FOUND';end if;
  select coalesce(jsonb_agg(jsonb_build_object('payment',e.payload-'applications','application',a.value)),'[]') into v_apps from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'))a(value) where e.company_id=p_company_id and e.entity in('payments','payment_batches')and e.deleted_at is null and upper(coalesce(e.payload->>'status',''))='CONFIRMADO' and(coalesce(a.value->>'payableId','')=p_payable_id or coalesce(a.value->>'purchaseId','')=coalesce(v_item->>'purchaseId',''));
  v_journal_id:=coalesce(v_item->>'originEntryId',v_item->>'journalEntryId','');
 else
  if p_payable_id!~*'^[0-9a-f-]{36}$' then raise exception using errcode='P0002',message='PAYABLE_NOT_FOUND';end if;v_id:=p_payable_id::uuid;
  select to_jsonb(a)||jsonb_build_object('provider',to_jsonb(p),'purchase',to_jsonb(d),'source','SUPPLIER_FINANCE_V2') into v_item from public.erp_supplier_accounts_payable a join public.erp_supplier_providers p on p.company_id=a.company_id and p.provider_id=a.provider_id left join public.erp_supplier_purchase_documents d on d.company_id=a.company_id and d.purchase_document_id=a.source_id where a.company_id=p_company_id and a.payable_id=v_id;
  if v_item is null then raise exception using errcode='P0002',message='PAYABLE_NOT_FOUND';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.payment_date desc),'[]')into v_apps from(select a.*,p.payment_code,p.payment_date,p.payment_method,p.reference,p.status payment_status,p.journal_entry_id from public.erp_supplier_payment_applications a join public.erp_supplier_payments p on p.company_id=a.company_id and p.payment_id=a.payment_id where a.company_id=p_company_id and a.payable_id=v_id)x;
  select coalesce(jsonb_agg(to_jsonb(a)order by a.adjustment_date desc),'[]')into v_adjustments from public.erp_supplier_adjustments a where a.company_id=p_company_id and a.payable_id=v_id;v_journal_id:=v_item->>'journal_entry_id';
 end if;
 if coalesce(v_journal_id,'')~*'^[0-9a-f-]{36}$' then select jsonb_build_object('header',to_jsonb(e),'lines',coalesce((select jsonb_agg(to_jsonb(l)order by l.line_number)from public.erp_financial_journal_lines l where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id),'[]'))into v_journal from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=v_journal_id::uuid;end if;
 return jsonb_build_object('ok',true,'item',v_item,'applications',v_apps,'adjustments',v_adjustments,'journal',coalesce(v_journal,'null'));end $$;

create or replace function public.erp_customer_receivable_detail(p_company_id uuid,p_receivable_id text,p_source text default 'FINANCIAL_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_item jsonb;v_apps jsonb:='[]';v_credits jsonb:='[]';v_withholdings jsonb:='[]';v_journal jsonb:='null';v_journal_id text;
begin perform public.erp_financial_v2_assert_access(p_company_id);
 if upper(coalesce(p_source,''))='LEGACY_PROJECTION' then
  select e.payload||jsonb_build_object('id',e.record_id,'source','LEGACY_PROJECTION','version',e.version,'updatedAt',e.updated_at)into v_item from public.erp_entity_records e where e.company_id=p_company_id and e.entity='customer_receivables' and e.record_id=p_receivable_id and e.deleted_at is null;
  if v_item is null then raise exception using errcode='P0002',message='RECEIVABLE_NOT_FOUND';end if;
  select coalesce(jsonb_agg(jsonb_build_object('collection',e.payload-'applications','application',a.value)),'[]')into v_apps from public.erp_entity_records e cross join lateral jsonb_array_elements(coalesce(e.payload->'applications','[]'))a(value) where e.company_id=p_company_id and e.entity in('collections','collection_batches')and e.deleted_at is null and upper(coalesce(e.payload->>'status',''))='CONFIRMADO' and a.value->>'receivableId'=p_receivable_id;
  v_credits:=coalesce(v_item->'creditNotes','[]');v_journal_id:=coalesce(v_item->>'journalEntryId','');
 else
  if p_receivable_id!~*'^[0-9a-f-]{36}$' then raise exception using errcode='P0002',message='RECEIVABLE_NOT_FOUND';end if;v_id:=p_receivable_id::uuid;
  select to_jsonb(r)||jsonb_build_object('source','FINANCIAL_V2')into v_item from public.erp_financial_receivables r where r.company_id=p_company_id and r.receivable_id=v_id;if v_item is null then raise exception using errcode='P0002',message='RECEIVABLE_NOT_FOUND';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.collection_date desc),'[]')into v_apps from(select a.*,c.collection_number,c.collection_date,c.payment_method,c.reference,c.status collection_status,c.journal_entry_id from public.erp_financial_collection_applications a join public.erp_financial_collections c on c.company_id=a.company_id and c.collection_id=a.collection_id where a.company_id=p_company_id and a.receivable_id=v_id)x;
  select coalesce(jsonb_agg(to_jsonb(c)order by c.issue_date desc),'[]')into v_credits from public.erp_financial_credit_notes c where c.company_id=p_company_id and c.receivable_id=v_id;v_journal_id:=v_item->>'journal_entry_id';
 end if;
 select coalesce(jsonb_agg(e.payload||jsonb_build_object('id',e.record_id)order by e.updated_at desc),'[]')into v_withholdings from public.erp_entity_records e where e.company_id=p_company_id and e.entity='received_withholdings'and e.deleted_at is null and e.payload->>'relatedReceivableId'=p_receivable_id;
 if coalesce(v_journal_id,'')~*'^[0-9a-f-]{36}$' then select jsonb_build_object('header',to_jsonb(e),'lines',coalesce((select jsonb_agg(to_jsonb(l)order by l.line_number)from public.erp_financial_journal_lines l where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id),'[]'))into v_journal from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=v_journal_id::uuid;end if;
 return jsonb_build_object('ok',true,'item',v_item,'applications',v_apps,'creditNotes',v_credits,'receivedWithholdings',v_withholdings,'journal',coalesce(v_journal,'null'));end $$;
