begin;

-- Compras XML: la revisión permanece en memoria. La única persistencia ocurre
-- al contabilizar y resuelve proveedor + compra + contabilidad en esta RPC.
alter table public.erp_supplier_purchase_documents
  add column if not exists retention_decision text not null default 'PENDIENTE',
  add column if not exists retention_status text not null default 'PENDING_DECISION',
  add column if not exists retention_decision_code text not null default '',
  add column if not exists retention_decision_reason text not null default '',
  add column if not exists retention_decision_at timestamptz,
  add column if not exists retention_decision_by uuid references auth.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='erp_supplier_purchase_retention_decision_check') then
    alter table public.erp_supplier_purchase_documents
      add constraint erp_supplier_purchase_retention_decision_check
      check (retention_decision in ('PENDIENTE','APLICAR','NO_SUJETO_332'));
  end if;
  if not exists (select 1 from pg_constraint where conname='erp_supplier_purchase_retention_status_check') then
    alter table public.erp_supplier_purchase_documents
      add constraint erp_supplier_purchase_retention_status_check
      check (retention_status in ('PENDING_DECISION','PENDING_ISSUANCE','NOT_REQUIRED','ISSUED','CANCELLED'));
  end if;
end $$;

create or replace function public.erp_supplier_v2_publish_purchase(
  p_company_id uuid,p_operation_id uuid,p_device_id text,p_purchase_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.erp_supplier_purchase_documents%rowtype; p public.erp_supplier_providers%rowtype; v_lines jsonb;
begin
  select * into strict v from public.erp_supplier_purchase_documents where company_id=p_company_id and purchase_document_id=p_purchase_id;
  select * into strict p from public.erp_supplier_providers where company_id=p_company_id and provider_id=v.provider_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',purchase_line_id::text,'productCode',product_code,'description',description,'quantity',quantity,
    'unit',unit,'unitPrice',unit_price,'taxableBase',taxable_base,'vatRate',tax_rate,'vatValue',tax_value,'discount',discount,
    'totalLine',line_total,'accountCode',account_code,'costCenter',cost_center,'lineType',line_type,'receptionId',reception_id,
    'receptionItemId',reception_item_id) order by line_number),'[]') into v_lines
  from public.erp_supplier_purchase_lines where company_id=p_company_id and purchase_document_id=p_purchase_id;
  return public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'supplier_purchase_documents',p_purchase_id::text,
    jsonb_build_object('id',v.purchase_document_id::text,'purchaseDocumentId',v.purchase_document_id::text,'documentCode',v.document_code,
      'supplierId',v.provider_id::text,'supplierName',p.legal_name,'supplierRuc',p.tax_id,'voucherType',lower(v.document_type),
      'documentNumber',v.external_document_number,'sourceKey',v.source_key,'issueDate',v.issue_date,'accountingDate',v.accounting_date,
      'dueDate',v.due_date,'currencyCode',v.currency_code,'exchangeRate',v.exchange_rate,'totals',jsonb_build_object('subtotal',v.subtotal,
      'iva',v.tax_total,'discount',v.discount_total,'withholdingsTotal',v.withholding_total,'total',v.total,'balanceDue',greatest(v.total-v.withholding_total,0)),
      'settlementMode',v.settlement_mode,'source',v.source,'sourcePayload',v.source_payload,
      'authorizationNumber',coalesce(v.source_payload->>'authorizationNumber',''),'accessKey',coalesce(v.source_payload->>'accessKey',''),
      'status',v.status,'journalEntryId',v.journal_entry_id::text,'payableId',v.payable_id::text,'legacyDraftId',v.legacy_draft_id,
      'retentionDecision',v.retention_decision,'retentionCanonicalStatus',v.retention_status,
      'retentionStatus',case v.retention_status when 'PENDING_ISSUANCE' then 'Pendiente de emitir' when 'NOT_REQUIRED' then 'No sujeta (332)'
        when 'ISSUED' then 'Emitida' when 'CANCELLED' then 'Anulada' else 'Pendiente de decision' end,
      'retentionDecisionCode',v.retention_decision_code,'retentionDecisionReason',v.retention_decision_reason,
      'retentionDecisionAt',v.retention_decision_at,'retentionDecisionById',v.retention_decision_by::text,
      'lines',v_lines,'version',v.version,'syncFlow','SUPPLIER_FINANCE_V2'),
    coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='supplier_purchase_documents' and record_id=p_purchase_id::text),0));
end $$;

create or replace function public.erp_supplier_v2_post_purchase(
  p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_existing public.erp_operations_commands%rowtype;
  v_doc public.erp_supplier_purchase_documents%rowtype;
  v_provider public.erp_supplier_providers%rowtype;
  v_id uuid:=gen_random_uuid(); v_payable_id uuid; v_entry_id uuid; v_code text; v_line jsonb; v_idx integer:=0; v_total numeric(20,6);
  v_saved jsonb; v_records jsonb:='[]'; v_result jsonb; v_source_key text; v_reception public.erp_entity_records%rowtype;
  v_allocation_id uuid; v_available numeric(20,6); v_prior numeric(20,6); v_quantity numeric(20,6);
  v_provider_payload jsonb:=coalesce(p_payload->'provider','{}'::jsonb); v_provider_tax text; v_provider_name text;
  v_provider_id uuid; v_provider_created boolean:=false; v_retention_decision text; v_retention_status text; v_retention_code text;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='SUPPLIER_V2_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
  if found then return v_existing.result; end if;

  v_source_key:=btrim(coalesce(p_payload->>'sourceKey',''));
  v_total:=round(coalesce(nullif(p_payload#>>'{totals,total}','')::numeric,0),6);
  if v_source_key='' or v_total<=0 then raise exception using errcode='22023',message='SUPPLIER_V2_PURCHASE_INCOMPLETE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PURCHASE:'||v_source_key,0));
  select * into v_doc from public.erp_supplier_purchase_documents where company_id=p_company_id and source_key=v_source_key;
  if found then
    v_saved:=public.erp_supplier_v2_publish_purchase(p_company_id,p_operation_id,p_device_id,v_doc.purchase_document_id); v_records:=v_records||jsonb_build_array(v_saved);
    if v_doc.payable_id is not null then v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_doc.payable_id)); end if;
    if v_doc.journal_entry_id is not null then v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_doc.journal_entry_id)); end if;
    v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('purchaseDocumentId',v_doc.purchase_document_id::text,'reused',true));
    insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
    values(p_operation_id,p_company_id,'SUPPLIER_POST_PURCHASE',v_doc.purchase_document_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
    return v_result;
  end if;

  v_provider_tax:=regexp_replace(upper(btrim(coalesce(v_provider_payload->>'taxId',v_provider_payload->>'ruc',''))),'[^0-9A-Z]','','g');
  v_provider_name:=btrim(coalesce(v_provider_payload->>'legalName',v_provider_payload->>'name',''));
  if v_provider_tax='' or v_provider_name='' then raise exception using errcode='22023',message='SUPPLIER_V2_PROVIDER_IDENTITY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':PROVIDER:'||v_provider_tax,0));
  v_provider_id:=nullif(p_payload->>'providerId','')::uuid;
  if v_provider_id is not null then
    select * into v_provider from public.erp_supplier_providers where company_id=p_company_id and provider_id=v_provider_id for update;
    if found and v_provider.tax_id<>v_provider_tax then raise exception using errcode='23514',message='SUPPLIER_V2_PROVIDER_IDENTITY_MISMATCH'; end if;
  end if;
  if v_provider.provider_id is null then
    select * into v_provider from public.erp_supplier_providers where company_id=p_company_id and tax_id=v_provider_tax for update;
  end if;
  if v_provider.provider_id is null then
    v_provider_id:=gen_random_uuid();
    insert into public.erp_supplier_providers(company_id,provider_id,provider_code,tax_id,legal_name,commercial_name,provider_type,settlement_method,
      contact_name,phone,email,address,payment_terms,credit_days,currency_code,payable_account_code,advance_account_code,operational_supplier_id,
      status,profile_state,source,notes,created_at,created_by,updated_at,updated_by,last_operation_id)
    values(p_company_id,v_provider_id,public.erp_supplier_v2_next_code(p_company_id,'PROVIDER',current_date),v_provider_tax,v_provider_name,
      btrim(coalesce(v_provider_payload->>'commercialName','')),upper(coalesce(nullif(v_provider_payload->>'providerType',''),'OTHER')),
      upper(coalesce(nullif(v_provider_payload->>'settlementMethod',''),'PURCHASE_DOCUMENT')),btrim(coalesce(v_provider_payload->>'contact','')),
      btrim(coalesce(v_provider_payload->>'phone','')),btrim(coalesce(v_provider_payload->>'email','')),btrim(coalesce(v_provider_payload->>'address','')),
      btrim(coalesce(v_provider_payload->>'paymentCondition','')),coalesce(nullif(v_provider_payload->>'creditDays','')::integer,0),
      upper(coalesce(nullif(v_provider_payload->>'currencyCode',''),'USD')),btrim(coalesce(v_provider_payload->>'payableAccountCode','')),
      btrim(coalesce(v_provider_payload->>'advanceAccountCode','')),nullif(v_provider_payload->>'operationalSupplierId',''),'ACTIVE',
      case when nullif(btrim(coalesce(v_provider_payload->>'address','')),'') is not null
        and (nullif(btrim(coalesce(v_provider_payload->>'email','')),'') is not null or nullif(btrim(coalesce(v_provider_payload->>'phone','')),'') is not null)
        then 'COMPLETE' else 'PENDING' end,upper(coalesce(nullif(v_provider_payload->>'source',''),'PURCHASE')),
      btrim(coalesce(v_provider_payload->>'observation','')),clock_timestamp(),auth.uid(),clock_timestamp(),auth.uid(),p_operation_id)
    returning * into v_provider;
    v_provider_created:=true;
  end if;
  if v_provider.status<>'ACTIVE' then raise exception using errcode='23514',message='SUPPLIER_V2_PROVIDER_NOT_FOUND'; end if;

  v_retention_decision:=upper(coalesce(nullif(p_payload->>'retentionDecision',''),'PENDIENTE'));
  if v_retention_decision not in ('PENDIENTE','APLICAR','NO_SUJETO_332') then raise exception using errcode='22023',message='SUPPLIER_V2_RETENTION_DECISION_INVALID'; end if;
  if v_retention_decision='NO_SUJETO_332' and btrim(coalesce(p_payload->>'retentionDecisionReason',''))='' then
    raise exception using errcode='22023',message='SUPPLIER_V2_RETENTION_REASON_REQUIRED';
  end if;
  v_retention_status:=case v_retention_decision when 'APLICAR' then 'PENDING_ISSUANCE' when 'NO_SUJETO_332' then 'NOT_REQUIRED' else 'PENDING_DECISION' end;
  v_retention_code:=case when v_retention_decision='NO_SUJETO_332' then '332' else btrim(coalesce(p_payload->>'retentionDecisionCode','')) end;

  v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,p_payload->'journal','PURCHASE_DOCUMENT',v_id::text,'POST_PURCHASE');
  v_code:=public.erp_supplier_v2_next_code(p_company_id,'PURCHASE',coalesce(nullif(p_payload->>'accountingDate','')::date,current_date));
  if upper(coalesce(p_payload->>'settlementMode','CXP'))='CXP' then v_payable_id:=gen_random_uuid(); end if;
  insert into public.erp_supplier_purchase_documents(company_id,purchase_document_id,document_code,provider_id,document_type,external_document_number,source_key,
    issue_date,accounting_date,due_date,currency_code,exchange_rate,subtotal,tax_total,discount_total,withholding_total,total,settlement_mode,source,source_payload,
    status,journal_entry_id,payable_id,legacy_draft_id,retention_decision,retention_status,retention_decision_code,retention_decision_reason,
    retention_decision_at,retention_decision_by,created_at,created_by,posted_at,posted_by,last_operation_id)
  values(p_company_id,v_id,v_code,v_provider.provider_id,upper(coalesce(nullif(p_payload->>'documentType',''),'INVOICE')),btrim(p_payload->>'documentNumber'),v_source_key,
    (p_payload->>'issueDate')::date,(p_payload->>'accountingDate')::date,coalesce(nullif(p_payload->>'dueDate','')::date,(p_payload->>'issueDate')::date),
    upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
    round(coalesce(nullif(p_payload#>>'{totals,subtotal}','')::numeric,0),6),round(coalesce(nullif(p_payload#>>'{totals,taxTotal}','')::numeric,0),6),
    round(coalesce(nullif(p_payload#>>'{totals,discountTotal}','')::numeric,0),6),round(coalesce(nullif(p_payload#>>'{totals,withholdingTotal}','')::numeric,0),6),
    v_total,upper(coalesce(p_payload->>'settlementMode','CXP')),upper(coalesce(nullif(p_payload->>'source',''),'MANUAL')),coalesce(p_payload->'sourcePayload','{}'),
    'POSTED',v_entry_id,v_payable_id,nullif(p_payload->>'legacyDraftId',''),v_retention_decision,v_retention_status,v_retention_code,
    btrim(coalesce(p_payload->>'retentionDecisionReason','')),case when v_retention_decision='PENDIENTE' then null else clock_timestamp() end,
    case when v_retention_decision='PENDIENTE' then null else auth.uid() end,clock_timestamp(),auth.uid(),clock_timestamp(),auth.uid(),p_operation_id);

  for v_line in select value from jsonb_array_elements(coalesce(p_payload->'lines','[]')) loop
    v_idx:=v_idx+1;
    insert into public.erp_supplier_purchase_lines(company_id,purchase_line_id,purchase_document_id,line_number,product_code,description,quantity,unit,unit_price,
      taxable_base,tax_rate,tax_value,discount,line_total,account_code,cost_center,line_type,reception_id,reception_item_id)
    values(p_company_id,gen_random_uuid(),v_id,v_idx,btrim(coalesce(v_line->>'productCode','')),btrim(coalesce(v_line->>'description','Compra')),
      coalesce(nullif(v_line->>'quantity','')::numeric,0),btrim(coalesce(v_line->>'unit','')),coalesce(nullif(v_line->>'unitPrice','')::numeric,0),
      coalesce(nullif(v_line->>'taxableBase','')::numeric,0),coalesce(nullif(v_line->>'vatRate','')::numeric,0),coalesce(nullif(v_line->>'vatValue','')::numeric,0),
      coalesce(nullif(v_line->>'discount','')::numeric,0),coalesce(nullif(v_line->>'totalLine','')::numeric,0),btrim(v_line->>'accountCode'),
      btrim(coalesce(v_line->>'costCenter','')),upper(coalesce(nullif(v_line->>'lineType',''),'EXPENSE')),nullif(v_line->>'receptionId',''),nullif(v_line->>'receptionItemId',''));
    if nullif(v_line->>'receptionId','') is not null then
      select * into v_reception from public.erp_entity_records
      where company_id=p_company_id and entity='operations_receptions' and record_id=v_line->>'receptionId' and deleted_at is null for update;
      if not found then raise exception using errcode='23503',message='SUPPLIER_V2_RECEPTION_NOT_FOUND'; end if;
      if nullif(v_reception.payload->>'providerId','') is not null and (v_reception.payload->>'providerId')::uuid<>v_provider.provider_id then
        raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_PROVIDER_MISMATCH';
      end if;
      if nullif(v_reception.payload->>'providerId','') is null and upper(btrim(coalesce(v_reception.payload->>'supplier',''))) not in (upper(v_provider.legal_name),upper(v_provider.commercial_name)) then
        raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_PROVIDER_MISMATCH';
      end if;
      select coalesce((select nullif(item->>'totalStems','')::numeric from jsonb_array_elements(coalesce(v_reception.payload->'items','[]')) item
        where item->>'id'=v_line->>'receptionItemId'),nullif(v_reception.payload->>'totalDeclared','')::numeric,0) into v_available;
      select coalesce(sum(quantity),0) into v_prior from public.erp_supplier_reception_cost_allocations
      where company_id=p_company_id and reception_id=v_line->>'receptionId'
        and coalesce(reception_item_id,'')=coalesce(v_line->>'receptionItemId','') and status='ACTIVE';
      v_quantity:=round(coalesce(nullif(v_line->>'quantity','')::numeric,0),6);
      if v_quantity<=0 or v_prior+v_quantity>v_available then raise exception using errcode='23514',message='SUPPLIER_V2_RECEPTION_QUANTITY_EXCEEDED'; end if;
      v_allocation_id:=gen_random_uuid();
      insert into public.erp_supplier_reception_cost_allocations(company_id,allocation_id,provider_id,source_type,source_id,reception_id,reception_item_id,
        quantity_type,quantity,unit_price,amount,status,rule_snapshot,created_at,last_operation_id)
      values(p_company_id,v_allocation_id,v_provider.provider_id,'PURCHASE_DOCUMENT',v_id,v_line->>'receptionId',nullif(v_line->>'receptionItemId',''),
        upper(coalesce(nullif(v_line->>'quantityType',''),'STEM')),v_quantity,coalesce(nullif(v_line->>'unitPrice','')::numeric,0),
        coalesce(nullif(v_line->>'totalLine','')::numeric,0),'ACTIVE',coalesce(v_line->'ruleSnapshot','{}'),clock_timestamp(),p_operation_id);
      v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_reception_cost(p_company_id,p_operation_id,p_device_id,v_allocation_id));
    end if;
  end loop;
  if v_payable_id is not null then
    insert into public.erp_supplier_accounts_payable(company_id,payable_id,provider_id,source_type,source_id,document_number,issue_date,due_date,currency_code,
      exchange_rate,total,balance,payable_account_code,status,journal_entry_id,created_at,created_by,updated_at,last_operation_id)
    values(p_company_id,v_payable_id,v_provider.provider_id,'PURCHASE_DOCUMENT',v_id,btrim(p_payload->>'documentNumber'),(p_payload->>'issueDate')::date,
      coalesce(nullif(p_payload->>'dueDate','')::date,(p_payload->>'issueDate')::date),upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),
      coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),greatest(v_total-round(coalesce(nullif(p_payload#>>'{totals,withholdingTotal}','')::numeric,0),6),0),
      greatest(v_total-round(coalesce(nullif(p_payload#>>'{totals,withholdingTotal}','')::numeric,0),6),0),btrim(p_payload->>'payableAccountCode'),'OPEN',v_entry_id,
      clock_timestamp(),auth.uid(),clock_timestamp(),p_operation_id);
  end if;
  if v_provider_created then v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_provider(p_company_id,p_operation_id,p_device_id,v_provider.provider_id)); end if;
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id));
  v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_purchase(p_company_id,p_operation_id,p_device_id,v_id));
  if v_payable_id is not null then v_records:=v_records||jsonb_build_array(public.erp_supplier_v2_publish_payable(p_company_id,p_operation_id,p_device_id,v_payable_id)); end if;
  v_records:=v_records||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_PURCHASE','PURCHASE_DOCUMENT',v_id::text,
    jsonb_build_object('providerId',v_provider.provider_id,'providerCreated',v_provider_created,'total',v_total,'retentionDecision',v_retention_decision,'retentionStatus',v_retention_status)));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object(
    'purchaseDocumentId',v_id::text,'providerId',v_provider.provider_id::text,'providerCreated',v_provider_created,
    'payableId',v_payable_id::text,'journalEntryId',v_entry_id::text,'retentionDecision',v_retention_decision,'retentionStatus',v_retention_status));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'SUPPLIER_POST_PURCHASE',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

create or replace function public.erp_supplier_v2_health(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  return jsonb_build_object(
    'ok',true,'component','SUPPLIER_FINANCE_V2','migration','202608200001','companyId',p_company_id::text,
    'providersTable',to_regclass('public.erp_supplier_providers') is not null,
    'purchaseDocumentsTable',to_regclass('public.erp_supplier_purchase_documents') is not null,
    'purchaseLinesTable',to_regclass('public.erp_supplier_purchase_lines') is not null,
    'payablesTable',to_regclass('public.erp_supplier_accounts_payable') is not null,
    'settlementsTable',to_regclass('public.erp_supplier_settlements') is not null,
    'settlementLinesTable',to_regclass('public.erp_supplier_settlement_lines') is not null,
    'receptionCostsTable',to_regclass('public.erp_supplier_reception_cost_allocations') is not null,
    'paymentsTable',to_regclass('public.erp_supplier_payments') is not null,
    'paymentApplicationsTable',to_regclass('public.erp_supplier_payment_applications') is not null,
    'adjustmentsTable',to_regclass('public.erp_supplier_adjustments') is not null,
    'providerBalancesView',to_regclass('public.erp_supplier_v2_provider_balances') is not null,
    'receptionCostView',to_regclass('public.erp_supplier_v2_reception_cost_summary') is not null,
    'upsertProviderRpc',to_regprocedure('public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'postPurchaseRpc',to_regprocedure('public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reversePurchaseRpc',to_regprocedure('public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamp with time zone)') is not null,
    'registerPaymentRpc',to_regprocedure('public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reversePaymentRpc',to_regprocedure('public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamp with time zone)') is not null,
    'createSettlementRpc',to_regprocedure('public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamp with time zone)') is not null,
    'reverseSettlementRpc',to_regprocedure('public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamp with time zone)') is not null,
    'atomicProviderPost',true,
    'retentionDecisionColumns',exists(select 1 from information_schema.columns where table_schema='public' and table_name='erp_supplier_purchase_documents' and column_name='retention_decision')
  );
end $$;

revoke all on function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.erp_supplier_v2_health(uuid) from public,anon;
grant execute on function public.erp_supplier_v2_health(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
