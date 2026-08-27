-- CONT-B / Punto 1: read-models search-first para pagos y cobros individuales.
-- Solo lectura. No altera las mutaciones Supplier Finance V2 / Financial V2.

create or replace function public.erp_payment_collection_read_assert_page(p_limit integer, p_offset integer)
returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p_limit not in (25,50) or p_offset<0 then
    raise exception using errcode='22023',message='PAYMENT_COLLECTION_PAGE_INVALID';
  end if;
end $$;

create or replace function public.erp_supplier_payments_history_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_provider_id text default null,p_bank_account_id text default null,
  p_state text default null,p_document text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform public.erp_payment_collection_read_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then
    raise exception using errcode='22023',message='PAYMENT_DATE_RANGE_REQUIRED';
  end if;
  with canonical as (
    select p.payment_id::text id,'SUPPLIER_FINANCE_V2' source,p.payment_date date,p.payment_code number,
      p.provider_id::text party_id,v.legal_name party_name,v.tax_id party_tax_id,p.payment_method method,
      p.payment_account_code account_code,t.bank_account_id::text bank_account_id,p.reference,p.total,
      case when p.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end status,p.journal_entry_id::text journal_entry_id,
      t.bank_transaction_id::text treasury_transaction_id,(select count(*) from public.erp_supplier_payment_applications a where a.company_id=p.company_id and a.payment_id=p.payment_id) application_count,
      coalesce(nullif(p.client_reference_id,''),p.payment_id::text) dedup_key
    from public.erp_supplier_payments p
    join public.erp_supplier_providers v on v.company_id=p.company_id and v.provider_id=p.provider_id
    left join lateral (select x.bank_account_id,x.bank_transaction_id from public.erp_treasury_bank_transactions x
      where x.company_id=p.company_id and x.source_type='SUPPLIER_PAYMENT' and x.source_id=p.payment_id::text order by x.created_at limit 1) t on true
    where p.company_id=p_company_id
  ), legacy as (
    select e.record_id id,'LEGACY' source,coalesce(case when coalesce(e.payload->>'paymentDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (e.payload->>'paymentDate')::date end,e.updated_at::date) date,
      coalesce(nullif(e.payload->>'paymentNumber',''),e.record_id) number,coalesce(e.payload->>'providerId','') party_id,
      coalesce(e.payload->>'providerName','') party_name,coalesce(e.payload->>'providerRuc','') party_tax_id,
      coalesce(e.payload->>'paymentMethod','') method,coalesce(e.payload->>'paymentAccountCode','') account_code,
      coalesce(e.payload->>'bankAccountId','') bank_account_id,coalesce(e.payload->>'reference','') reference,
      case when coalesce(e.payload->>'total','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end total,upper(coalesce(e.payload->>'status','BORRADOR')) status,
      coalesce(e.payload->>'entryId','') journal_entry_id,'' treasury_transaction_id,
      jsonb_array_length(coalesce(e.payload->'applications','[]'::jsonb)) application_count,e.record_id dedup_key
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='payments'
      and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
  ), rows as (select * from canonical union all select * from legacy), filtered as (
    select * from rows r where r.date between p_date_from and p_date_to
      and (nullif(btrim(p_provider_id),'') is null or r.party_id=btrim(p_provider_id))
      and (nullif(btrim(p_bank_account_id),'') is null or r.bank_account_id=btrim(p_bank_account_id))
      and (nullif(upper(btrim(p_state)),'') is null or r.status=upper(btrim(p_state)))
      and (nullif(btrim(p_document),'') is null or exists(
        select 1 from public.erp_supplier_payment_applications a join public.erp_supplier_accounts_payable q
          on q.company_id=a.company_id and q.payable_id=a.payable_id
        where r.source='SUPPLIER_FINANCE_V2' and a.company_id=p_company_id and a.payment_id::text=r.id and q.document_number ilike '%'||btrim(p_document)||'%')
        or (r.source='LEGACY' and exists(select 1 from public.erp_entity_records e,jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) a
          where e.company_id=p_company_id and e.entity='payments' and e.record_id=r.id and coalesce(a->>'documentNumber','') ilike '%'||btrim(p_document)||'%')))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.number,r.party_name,r.party_tax_id,r.reference,r.account_code)) like '%'||lower(btrim(p_search))||'%')
  )
  select count(*) into v_total from filtered;
  with canonical as (
    select p.payment_id::text id,'SUPPLIER_FINANCE_V2' source,p.payment_date date,p.payment_code number,p.provider_id::text party_id,
      v.legal_name party_name,v.tax_id party_tax_id,p.payment_method method,p.payment_account_code account_code,t.bank_account_id::text bank_account_id,
      p.reference,p.total,case when p.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end status,p.journal_entry_id::text journal_entry_id,
      t.bank_transaction_id::text treasury_transaction_id,(select count(*) from public.erp_supplier_payment_applications a where a.company_id=p.company_id and a.payment_id=p.payment_id) application_count,
      coalesce(nullif(p.client_reference_id,''),p.payment_id::text) dedup_key
    from public.erp_supplier_payments p join public.erp_supplier_providers v on v.company_id=p.company_id and v.provider_id=p.provider_id
    left join lateral (select x.bank_account_id,x.bank_transaction_id from public.erp_treasury_bank_transactions x where x.company_id=p.company_id and x.source_type='SUPPLIER_PAYMENT' and x.source_id=p.payment_id::text order by x.created_at limit 1) t on true
    where p.company_id=p_company_id
  ), legacy as (
    select e.record_id id,'LEGACY' source,coalesce(case when coalesce(e.payload->>'paymentDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (e.payload->>'paymentDate')::date end,e.updated_at::date) date,coalesce(nullif(e.payload->>'paymentNumber',''),e.record_id) number,
      coalesce(e.payload->>'providerId','') party_id,coalesce(e.payload->>'providerName','') party_name,coalesce(e.payload->>'providerRuc','') party_tax_id,
      coalesce(e.payload->>'paymentMethod','') method,coalesce(e.payload->>'paymentAccountCode','') account_code,coalesce(e.payload->>'bankAccountId','') bank_account_id,
      coalesce(e.payload->>'reference','') reference,case when coalesce(e.payload->>'total','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end total,upper(coalesce(e.payload->>'status','BORRADOR')) status,
      coalesce(e.payload->>'entryId','') journal_entry_id,'' treasury_transaction_id,jsonb_array_length(coalesce(e.payload->'applications','[]'::jsonb)) application_count,e.record_id dedup_key
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='payments' and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
  ), rows as (select * from canonical union all select * from legacy), filtered as (
    select * from rows r where r.date between p_date_from and p_date_to
      and (nullif(btrim(p_provider_id),'') is null or r.party_id=btrim(p_provider_id)) and (nullif(btrim(p_bank_account_id),'') is null or r.bank_account_id=btrim(p_bank_account_id))
      and (nullif(upper(btrim(p_state)),'') is null or r.status=upper(btrim(p_state)))
      and (nullif(btrim(p_document),'') is null or (r.source='SUPPLIER_FINANCE_V2' and exists(select 1 from public.erp_supplier_payment_applications a join public.erp_supplier_accounts_payable q on q.company_id=a.company_id and q.payable_id=a.payable_id where a.company_id=p_company_id and a.payment_id::text=r.id and q.document_number ilike '%'||btrim(p_document)||'%')) or (r.source='LEGACY' and exists(select 1 from public.erp_entity_records e,jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) a where e.company_id=p_company_id and e.entity='payments' and e.record_id=r.id and coalesce(a->>'documentNumber','') ilike '%'||btrim(p_document)||'%')))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.number,r.party_name,r.party_tax_id,r.reference,r.account_code)) like '%'||lower(btrim(p_search))||'%')
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'date',date,'number',number,'partyId',party_id,'partyName',party_name,
    'partyTaxId',party_tax_id,'method',method,'accountCode',account_code,'bankAccountId',bank_account_id,'reference',reference,'total',total,
    'status',status,'journalEntryId',journal_entry_id,'treasuryTransactionId',treasury_transaction_id,'applicationCount',application_count)
    order by date desc,number desc),'[]'::jsonb) into v_items from (select * from filtered order by date desc,number desc limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_supplier_payment_detail(p_company_id uuid,p_payment_id text,p_source text default 'SUPPLIER_FINANCE_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_item jsonb; v_apps jsonb; v_journal jsonb; v_legacy jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if upper(coalesce(p_source,''))='LEGACY' then
    select payload into v_legacy from public.erp_entity_records where company_id=p_company_id and entity='payments' and record_id=p_payment_id;
    if v_legacy is null then raise exception using errcode='P0002',message='PAYMENT_NOT_FOUND'; end if;
    return jsonb_build_object('ok',true,'source','LEGACY','item',v_legacy,'applications',coalesce(v_legacy->'applications','[]'::jsonb),'journal','null'::jsonb);
  end if;
  if p_payment_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='P0002',message='PAYMENT_NOT_FOUND'; end if;
  v_id:=p_payment_id::uuid;
  select to_jsonb(p)||jsonb_build_object('provider',to_jsonb(v),'bankTransaction',to_jsonb(t)) into v_item
    from public.erp_supplier_payments p join public.erp_supplier_providers v on v.company_id=p.company_id and v.provider_id=p.provider_id
    left join lateral (select * from public.erp_treasury_bank_transactions x where x.company_id=p.company_id and x.source_type='SUPPLIER_PAYMENT' and x.source_id=p.payment_id::text order by x.created_at limit 1) t on true
    where p.company_id=p_company_id and p.payment_id=v_id;
  if v_item is null then raise exception using errcode='P0002',message='PAYMENT_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.document_number),'[]'::jsonb) into v_apps from (
    select a.*,q.document_number,q.issue_date,q.due_date,q.total document_total,q.balance current_balance,q.source_id,p.legal_name provider_name,p.tax_id provider_ruc
    from public.erp_supplier_payment_applications a join public.erp_supplier_accounts_payable q on q.company_id=a.company_id and q.payable_id=a.payable_id
    join public.erp_supplier_providers p on p.company_id=q.company_id and p.provider_id=q.provider_id where a.company_id=p_company_id and a.payment_id=v_id) x;
  select jsonb_build_object('header',to_jsonb(e),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_number) from public.erp_financial_journal_lines l where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id),'[]'::jsonb)) into v_journal
    from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=(v_item->>'journal_entry_id')::uuid;
  return jsonb_build_object('ok',true,'source','SUPPLIER_FINANCE_V2','item',v_item,'applications',v_apps,'journal',coalesce(v_journal,'null'::jsonb));
end $$;

create or replace function public.erp_customer_collections_history_page(
  p_company_id uuid,p_date_from date,p_date_to date,p_customer_id text default null,p_bank_account_id text default null,
  p_state text default null,p_document text default null,p_search text default null,p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint;
begin
  perform public.erp_financial_v2_assert_access(p_company_id); perform public.erp_payment_collection_read_assert_page(p_limit,p_offset);
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to then raise exception using errcode='22023',message='COLLECTION_DATE_RANGE_REQUIRED'; end if;
  with canonical as (
    select c.collection_id::text id,'FINANCIAL_V2' source,c.collection_date date,c.collection_number number,c.customer_id party_id,
      coalesce(r.customer_name_snapshot,c.customer_id) party_name,coalesce(r.customer_tax_id_snapshot,'') party_tax_id,c.payment_method method,c.debit_account_code account_code,
      t.bank_account_id::text bank_account_id,c.reference,c.total,case when c.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end status,c.journal_entry_id::text journal_entry_id,
      t.bank_transaction_id::text treasury_transaction_id,(select count(*) from public.erp_financial_collection_applications a where a.company_id=c.company_id and a.collection_id=c.collection_id) application_count,
      coalesce(nullif(c.client_reference_id,''),c.collection_id::text) dedup_key
    from public.erp_financial_collections c
    left join lateral (select q.customer_name_snapshot,q.customer_tax_id_snapshot from public.erp_financial_collection_applications a join public.erp_financial_receivables q on q.company_id=a.company_id and q.receivable_id=a.receivable_id where a.company_id=c.company_id and a.collection_id=c.collection_id order by a.collection_application_id limit 1) r on true
    left join lateral (select x.bank_account_id,x.bank_transaction_id from public.erp_treasury_bank_transactions x where x.company_id=c.company_id and x.source_type='COLLECTION' and x.source_id=c.collection_id::text order by x.created_at limit 1) t on true
    where c.company_id=p_company_id
  ), legacy as (
    select e.record_id id,'LEGACY' source,coalesce(case when coalesce(e.payload->>'collectionDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (e.payload->>'collectionDate')::date end,e.updated_at::date) date,coalesce(nullif(e.payload->>'collectionNumber',''),e.record_id) number,
      coalesce(e.payload->>'customerId','') party_id,coalesce(e.payload->>'customerName','') party_name,coalesce(e.payload->>'customerTaxId','') party_tax_id,
      coalesce(e.payload->>'collectionMethod','') method,coalesce(e.payload->>'collectionAccountCode','') account_code,coalesce(e.payload->>'bankAccountId','') bank_account_id,
      coalesce(e.payload->>'reference','') reference,case when coalesce(e.payload->>'total','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end total,upper(coalesce(e.payload->>'status','BORRADOR')) status,
      coalesce(e.payload->>'entryId','') journal_entry_id,'' treasury_transaction_id,jsonb_array_length(coalesce(e.payload->'applications','[]'::jsonb)) application_count,e.record_id dedup_key
    from public.erp_entity_records e where e.company_id=p_company_id and e.entity='collections' and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
  ), rows as (select * from canonical union all select * from legacy), filtered as (
    select * from rows r where r.date between p_date_from and p_date_to
      and (nullif(btrim(p_customer_id),'') is null or r.party_id=btrim(p_customer_id)) and (nullif(btrim(p_bank_account_id),'') is null or r.bank_account_id=btrim(p_bank_account_id))
      and (nullif(upper(btrim(p_state)),'') is null or r.status=upper(btrim(p_state)))
      and (nullif(btrim(p_document),'') is null or (r.source='FINANCIAL_V2' and exists(select 1 from public.erp_financial_collection_applications a join public.erp_financial_receivables q on q.company_id=a.company_id and q.receivable_id=a.receivable_id where a.company_id=p_company_id and a.collection_id::text=r.id and q.document_number ilike '%'||btrim(p_document)||'%')) or (r.source='LEGACY' and exists(select 1 from public.erp_entity_records e,jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) a where e.company_id=p_company_id and e.entity='collections' and e.record_id=r.id and coalesce(a->>'documentNumber','') ilike '%'||btrim(p_document)||'%')))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.number,r.party_name,r.party_tax_id,r.reference,r.account_code)) like '%'||lower(btrim(p_search))||'%')
  ) select count(*) into v_total from filtered;
  with canonical as (
    select c.collection_id::text id,'FINANCIAL_V2' source,c.collection_date date,c.collection_number number,c.customer_id party_id,coalesce(r.customer_name_snapshot,c.customer_id) party_name,
      coalesce(r.customer_tax_id_snapshot,'') party_tax_id,c.payment_method method,c.debit_account_code account_code,t.bank_account_id::text bank_account_id,c.reference,c.total,
      case when c.status='REVERSED' then 'ANULADO' else 'CONFIRMADO' end status,c.journal_entry_id::text journal_entry_id,t.bank_transaction_id::text treasury_transaction_id,
      (select count(*) from public.erp_financial_collection_applications a where a.company_id=c.company_id and a.collection_id=c.collection_id) application_count,coalesce(nullif(c.client_reference_id,''),c.collection_id::text) dedup_key
    from public.erp_financial_collections c left join lateral (select q.customer_name_snapshot,q.customer_tax_id_snapshot from public.erp_financial_collection_applications a join public.erp_financial_receivables q on q.company_id=a.company_id and q.receivable_id=a.receivable_id where a.company_id=c.company_id and a.collection_id=c.collection_id order by a.collection_application_id limit 1) r on true
    left join lateral (select x.bank_account_id,x.bank_transaction_id from public.erp_treasury_bank_transactions x where x.company_id=c.company_id and x.source_type='COLLECTION' and x.source_id=c.collection_id::text order by x.created_at limit 1) t on true where c.company_id=p_company_id
  ), legacy as (
    select e.record_id id,'LEGACY' source,coalesce(case when coalesce(e.payload->>'collectionDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (e.payload->>'collectionDate')::date end,e.updated_at::date) date,coalesce(nullif(e.payload->>'collectionNumber',''),e.record_id) number,
      coalesce(e.payload->>'customerId','') party_id,coalesce(e.payload->>'customerName','') party_name,coalesce(e.payload->>'customerTaxId','') party_tax_id,coalesce(e.payload->>'collectionMethod','') method,
      coalesce(e.payload->>'collectionAccountCode','') account_code,coalesce(e.payload->>'bankAccountId','') bank_account_id,coalesce(e.payload->>'reference','') reference,
      case when coalesce(e.payload->>'total','') ~ '^-?\d+(\.\d+)?$' then (e.payload->>'total')::numeric else 0 end total,upper(coalesce(e.payload->>'status','BORRADOR')) status,coalesce(e.payload->>'entryId','') journal_entry_id,'' treasury_transaction_id,
      jsonb_array_length(coalesce(e.payload->'applications','[]'::jsonb)) application_count,e.record_id dedup_key from public.erp_entity_records e where e.company_id=p_company_id and e.entity='collections' and not exists(select 1 from canonical c where c.dedup_key=e.record_id)
  ), rows as (select * from canonical union all select * from legacy), filtered as (
    select * from rows r where r.date between p_date_from and p_date_to and (nullif(btrim(p_customer_id),'') is null or r.party_id=btrim(p_customer_id))
      and (nullif(btrim(p_bank_account_id),'') is null or r.bank_account_id=btrim(p_bank_account_id)) and (nullif(upper(btrim(p_state)),'') is null or r.status=upper(btrim(p_state)))
      and (nullif(btrim(p_document),'') is null or (r.source='FINANCIAL_V2' and exists(select 1 from public.erp_financial_collection_applications a join public.erp_financial_receivables q on q.company_id=a.company_id and q.receivable_id=a.receivable_id where a.company_id=p_company_id and a.collection_id::text=r.id and q.document_number ilike '%'||btrim(p_document)||'%')) or (r.source='LEGACY' and exists(select 1 from public.erp_entity_records e,jsonb_array_elements(coalesce(e.payload->'applications','[]'::jsonb)) a where e.company_id=p_company_id and e.entity='collections' and e.record_id=r.id and coalesce(a->>'documentNumber','') ilike '%'||btrim(p_document)||'%')))
      and (nullif(lower(btrim(p_search)),'') is null or lower(concat_ws(' ',r.number,r.party_name,r.party_tax_id,r.reference,r.account_code)) like '%'||lower(btrim(p_search))||'%')
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'date',date,'number',number,'partyId',party_id,'partyName',party_name,'partyTaxId',party_tax_id,
    'method',method,'accountCode',account_code,'bankAccountId',bank_account_id,'reference',reference,'total',total,'status',status,'journalEntryId',journal_entry_id,
    'treasuryTransactionId',treasury_transaction_id,'applicationCount',application_count) order by date desc,number desc),'[]'::jsonb) into v_items
    from (select * from filtered order by date desc,number desc limit p_limit offset p_offset) q;
  return jsonb_build_object('ok',true,'items',v_items,'total',v_total,'limit',p_limit,'offset',p_offset);
end $$;

create or replace function public.erp_customer_collection_detail(p_company_id uuid,p_collection_id text,p_source text default 'FINANCIAL_V2')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_item jsonb; v_apps jsonb; v_journal jsonb; v_legacy jsonb;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if upper(coalesce(p_source,''))='LEGACY' then
    select payload into v_legacy from public.erp_entity_records where company_id=p_company_id and entity='collections' and record_id=p_collection_id;
    if v_legacy is null then raise exception using errcode='P0002',message='COLLECTION_NOT_FOUND'; end if;
    return jsonb_build_object('ok',true,'source','LEGACY','item',v_legacy,'applications',coalesce(v_legacy->'applications','[]'::jsonb),'journal','null'::jsonb);
  end if;
  if p_collection_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='P0002',message='COLLECTION_NOT_FOUND'; end if;
  v_id:=p_collection_id::uuid;
  select to_jsonb(c)||jsonb_build_object('bankTransaction',to_jsonb(t)) into v_item from public.erp_financial_collections c
    left join lateral (select * from public.erp_treasury_bank_transactions x where x.company_id=c.company_id and x.source_type='COLLECTION' and x.source_id=c.collection_id::text order by x.created_at limit 1) t on true
    where c.company_id=p_company_id and c.collection_id=v_id;
  if v_item is null then raise exception using errcode='P0002',message='COLLECTION_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.document_number),'[]'::jsonb) into v_apps from (
    select a.*,r.document_number,r.issue_date,r.due_date,r.total document_total,r.balance current_balance,r.customer_name_snapshot,r.customer_tax_id_snapshot
    from public.erp_financial_collection_applications a join public.erp_financial_receivables r on r.company_id=a.company_id and r.receivable_id=a.receivable_id
    where a.company_id=p_company_id and a.collection_id=v_id) x;
  select jsonb_build_object('header',to_jsonb(e),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_number) from public.erp_financial_journal_lines l where l.company_id=e.company_id and l.journal_entry_id=e.journal_entry_id),'[]'::jsonb)) into v_journal
    from public.erp_financial_journal_entries e where e.company_id=p_company_id and e.journal_entry_id=(v_item->>'journal_entry_id')::uuid;
  return jsonb_build_object('ok',true,'source','FINANCIAL_V2','item',v_item,'applications',v_apps,'journal',coalesce(v_journal,'null'::jsonb));
end $$;

create or replace function public.erp_payment_collection_read_health(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object('ok',true,'component','PAYMENT_COLLECTION_READ_V2','migration','202608230008',
    'paymentHistory',to_regprocedure('public.erp_supplier_payments_history_page(uuid,date,date,text,text,text,text,text,integer,integer)') is not null,
    'paymentDetail',to_regprocedure('public.erp_supplier_payment_detail(uuid,text,text)') is not null,
    'collectionHistory',to_regprocedure('public.erp_customer_collections_history_page(uuid,date,date,text,text,text,text,text,integer,integer)') is not null,
    'collectionDetail',to_regprocedure('public.erp_customer_collection_detail(uuid,text,text)') is not null,
    'payableLookup',to_regprocedure('public.erp_supplier_payables_open_page(uuid,text,text,text,text,integer,integer)') is not null,
    'receivableLookup',to_regprocedure('public.erp_customer_receivables_open_page(uuid,text,text,text,text,integer,integer)') is not null);
end $$;

revoke all on function public.erp_payment_collection_read_health(uuid) from public,anon;
revoke all on function public.erp_supplier_payments_history_page(uuid,date,date,text,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_supplier_payment_detail(uuid,text,text) from public,anon;
revoke all on function public.erp_customer_collections_history_page(uuid,date,date,text,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.erp_customer_collection_detail(uuid,text,text) from public,anon;
grant execute on function public.erp_payment_collection_read_health(uuid) to authenticated,service_role;
grant execute on function public.erp_supplier_payments_history_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_supplier_payment_detail(uuid,text,text) to authenticated,service_role;
grant execute on function public.erp_customer_collections_history_page(uuid,date,date,text,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.erp_customer_collection_detail(uuid,text,text) to authenticated,service_role;
