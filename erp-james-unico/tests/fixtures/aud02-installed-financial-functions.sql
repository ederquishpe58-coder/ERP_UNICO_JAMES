-- READ-ONLY snapshot of installed PROD functions, 2026-09-12. Test fixture only.
-- Captured through Management API read_only, no credentials or business records.
CREATE OR REPLACE FUNCTION public.erp_financial_v2_post_credit_note(p_operation_id uuid, p_company_id uuid, p_device_id text, p_credit_note jsonb, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_post_credit_note', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_post_credit_note_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_credit_note, p_local_created_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_financial_v2_post_credit_note_u2c3_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_credit_note jsonb, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_existing public.erp_operations_commands%rowtype; v_receivable public.erp_financial_receivables%rowtype;
 v_credit public.erp_financial_credit_notes%rowtype; v_credit_id uuid:=gen_random_uuid(); v_source_id text; v_entry_id uuid;
 v_subtotal numeric(20,6); v_tax numeric(20,6); v_total numeric(20,6); v_lines jsonb; v_records jsonb:='[]'; v_saved jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform public.erp_financial_v2_assert_access(p_company_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id; if found then return v_existing.result; end if;
 v_source_id:=coalesce(nullif(btrim(p_credit_note->>'electronicDocumentId'),''),nullif(btrim(p_credit_note->>'sourceId'),''));
 if v_source_id is null then raise exception using errcode='22023',message='FINANCE_V2_CREDIT_NOTE_SOURCE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':CREDIT_NOTE:'||v_source_id,0));
 select * into v_credit from public.erp_financial_credit_notes where company_id=p_company_id and source_id=v_source_id;
 if found then v_credit_id:=v_credit.credit_note_id; v_entry_id:=v_credit.journal_entry_id;
 else
  select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and receivable_id=(p_credit_note->>'receivableId')::uuid for update;
  if not found or v_receivable.status='CANCELLED' then raise exception using errcode='P0002',message='FINANCE_V2_RECEIVABLE_NOT_FOUND'; end if;
  v_total:=round(coalesce(nullif(p_credit_note->>'total','')::numeric,0),6); v_tax:=round(coalesce(nullif(p_credit_note->>'taxTotal','')::numeric,0),6);
  v_subtotal:=round(coalesce(nullif(p_credit_note->>'subtotal','')::numeric,v_total-v_tax),6);
  if v_total<=0 or round(v_subtotal+v_tax,6)<>v_total or v_total>v_receivable.balance then raise exception using errcode='23514',message='FINANCE_V2_CREDIT_NOTE_EXCEEDS_BALANCE'; end if;
  v_lines:=jsonb_build_array(jsonb_build_object('accountCode',p_credit_note->>'revenueAccountCode','debit',v_subtotal,'credit',0,'lineDescription','Nota de crédito '||coalesce(p_credit_note->>'documentNumber','')));
  if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode',p_credit_note->>'taxAccountCode','debit',v_tax,'credit',0,'lineDescription','Reverso IVA '||coalesce(p_credit_note->>'documentNumber',''))); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode',p_credit_note->>'receivableAccountCode','debit',0,'credit',v_total,'auxiliary',v_receivable.customer_tax_id_snapshot,'lineDescription','Disminución CxC '||v_receivable.document_number));
  v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
   jsonb_build_object('accountingDate',p_credit_note->>'issueDate','concept','Nota de crédito '||coalesce(p_credit_note->>'documentNumber',''),
    'originModule','Ventas','sourceDocument',p_credit_note->>'documentNumber','externalReference',coalesce(p_credit_note->>'accessKey',p_credit_note->>'authorizationNumber',''),
    'currencyCode',v_receivable.currency_code,'exchangeRate',v_receivable.exchange_rate,'lines',v_lines,'observation',coalesce(p_credit_note->>'reason','')),
   'CREDIT_NOTE',v_source_id,'POST_CREDIT_NOTE');
  insert into public.erp_financial_credit_notes(company_id,credit_note_id,receivable_id,source_id,document_number,issue_date,subtotal,tax_total,total,reason,journal_entry_id,created_at,created_by,last_operation_id)
   values(p_company_id,v_credit_id,v_receivable.receivable_id,v_source_id,btrim(p_credit_note->>'documentNumber'),(p_credit_note->>'issueDate')::date,v_subtotal,v_tax,v_total,btrim(coalesce(p_credit_note->>'reason','')),v_entry_id,v_now,auth.uid(),p_operation_id);
  update public.erp_financial_receivables set credited_total=round(credited_total+v_total,6),balance=round(balance-v_total,6),
   status=case when round(balance-v_total,6)=0 then 'PAID' else 'PARTIALLY_PAID' end,updated_at=v_now,updated_by=auth.uid(),version=version+1,last_operation_id=p_operation_id
   where company_id=p_company_id and receivable_id=v_receivable.receivable_id returning * into v_receivable;
 end if;
 if v_receivable.receivable_id is null then select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and receivable_id=v_credit.receivable_id; end if;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id));
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_receivables',v_receivable.receivable_id::text,
  jsonb_build_object('id',v_receivable.receivable_id::text,'receivableId',v_receivable.receivable_id::text,'customerId',v_receivable.customer_id,
   'customerName',v_receivable.customer_name_snapshot,'customerTaxId',v_receivable.customer_tax_id_snapshot,'sourceType',v_receivable.source_type,
   'sourceId',v_receivable.source_id,'orderId',v_receivable.order_id,'shipmentId',v_receivable.shipment_id::text,'documentType',v_receivable.document_type,
   'documentNumber',v_receivable.document_number,'issueDate',v_receivable.issue_date,'dueDate',v_receivable.due_date,'currencyCode',v_receivable.currency_code,
   'subtotal',v_receivable.subtotal,'taxTotal',v_receivable.tax_total,'total',v_receivable.total,'creditedTotal',v_receivable.credited_total,
   'balance',v_receivable.balance,'status',v_receivable.status,'postingStatus','CONTABILIZADO','journalEntryId',v_receivable.journal_entry_id::text,
   'updatedAtServer',v_receivable.updated_at,'version',v_receivable.version,'syncFlow','FINANCIAL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_receivables' and record_id=v_receivable.receivable_id::text),0));
 v_records:=v_records||jsonb_build_array(v_saved);
 select * into v_credit from public.erp_financial_credit_notes where company_id=p_company_id and credit_note_id=v_credit_id;
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_credit_notes',v_credit_id::text,
  jsonb_build_object('id',v_credit_id::text,'creditNoteId',v_credit_id::text,'receivableId',v_credit.receivable_id::text,'sourceId',v_credit.source_id,
   'documentNumber',v_credit.document_number,'issueDate',v_credit.issue_date,'subtotal',v_credit.subtotal,'taxTotal',v_credit.tax_total,'total',v_credit.total,
   'reason',v_credit.reason,'journalEntryId',v_credit.journal_entry_id::text,'postingStatus','CONTABILIZADO','createdAt',v_credit.created_at,'syncFlow','FINANCIAL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_credit_notes' and record_id=v_credit_id::text),0));
 v_records:=v_records||jsonb_build_array(v_saved)||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_CREDIT_NOTE','CREDIT_NOTE',v_source_id,jsonb_build_object('creditNoteId',v_credit_id::text,'journalEntryId',v_entry_id::text)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('creditNoteId',v_credit_id::text,'journalEntryId',v_entry_id::text,'receivableId',v_receivable.receivable_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_POST_CREDIT_NOTE',v_source_id,p_credit_note,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_financial_v2_post_invoice(p_operation_id uuid, p_company_id uuid, p_device_id text, p_invoice jsonb, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_post_invoice', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_post_invoice_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_invoice, p_local_created_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_financial_v2_post_invoice_u2c3_internal(p_operation_id uuid, p_company_id uuid, p_device_id text, p_invoice jsonb, p_local_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_existing public.erp_operations_commands%rowtype; v_source_id text; v_receivable public.erp_financial_receivables%rowtype;
 v_entry_id uuid; v_receivable_id uuid:=gen_random_uuid(); v_total numeric(20,6); v_subtotal numeric(20,6); v_tax numeric(20,6);
 v_lines jsonb; v_records jsonb:='[]'; v_saved jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform public.erp_financial_v2_assert_access(p_company_id);
 if p_operation_id is null or nullif(btrim(p_device_id),'') is null then raise exception using errcode='22023',message='FINANCE_V2_COMMAND_INVALID'; end if;
 v_source_id:=coalesce(nullif(btrim(p_invoice->>'electronicDocumentId'),''),nullif(btrim(p_invoice->>'sourceId'),''));
 if v_source_id is null then raise exception using errcode='22023',message='FINANCE_V2_INVOICE_SOURCE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_existing from public.erp_operations_commands where operation_id=p_operation_id and company_id=p_company_id;
 if found then return v_existing.result; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':INVOICE:'||v_source_id,0));
 select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and source_type='INVOICE' and source_id=v_source_id;
 if not found then
   v_total:=round(coalesce(nullif(p_invoice->>'total','')::numeric,0),6); v_tax:=round(coalesce(nullif(p_invoice->>'taxTotal','')::numeric,0),6);
   v_subtotal:=round(coalesce(nullif(p_invoice->>'subtotal','')::numeric,v_total-v_tax),6);
   if v_total<0 or v_subtotal<0 or round(v_subtotal+v_tax,6)<>v_total then raise exception using errcode='23514',message='FINANCE_V2_INVOICE_TOTAL_INVALID'; end if;
   v_lines:=jsonb_build_array(
    jsonb_build_object('accountCode',p_invoice->>'receivableAccountCode','debit',v_total,'credit',0,'auxiliary',coalesce(p_invoice->>'customerTaxId',p_invoice->>'customerName'),'lineDescription','CxC '||coalesce(p_invoice->>'documentNumber','')),
    jsonb_build_object('accountCode',p_invoice->>'counterAccountCode','debit',0,'credit',v_subtotal,'lineDescription','Venta '||coalesce(p_invoice->>'documentNumber',''))
   );
   if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode',p_invoice->>'taxAccountCode','debit',0,'credit',v_tax,'lineDescription','IVA venta '||coalesce(p_invoice->>'documentNumber',''))); end if;
   v_entry_id:=public.erp_financial_v2_create_entry_internal(p_company_id,p_operation_id,p_device_id,
    jsonb_build_object('accountingDate',p_invoice->>'issueDate','concept','Venta '||coalesce(p_invoice->>'documentNumber',''),
      'originModule','Ventas','sourceDocument',p_invoice->>'documentNumber','externalReference',coalesce(p_invoice->>'accessKey',p_invoice->>'authorizationNumber',''),
      'currencyCode',coalesce(p_invoice->>'currencyCode','USD'),'exchangeRate',coalesce(p_invoice->>'exchangeRate','1'),'lines',v_lines),
    'INVOICE',v_source_id,'POST_INVOICE');
   insert into public.erp_financial_receivables(company_id,receivable_id,customer_id,customer_name_snapshot,customer_tax_id_snapshot,
    source_type,source_id,electronic_document_id,order_id,shipment_id,document_type,document_number,issue_date,due_date,
    currency_code,exchange_rate,subtotal,tax_total,total,balance,status,journal_entry_id,created_at,created_by,updated_at,updated_by,last_operation_id)
   values(p_company_id,v_receivable_id,btrim(p_invoice->>'customerId'),btrim(p_invoice->>'customerName'),btrim(coalesce(p_invoice->>'customerTaxId','')),
    'INVOICE',v_source_id,nullif(p_invoice->>'electronicDocumentId',''),nullif(p_invoice->>'orderId',''),nullif(p_invoice->>'shipmentId','')::uuid,
    coalesce(nullif(upper(p_invoice->>'documentType'),''),'INVOICE'),btrim(p_invoice->>'documentNumber'),(p_invoice->>'issueDate')::date,
    coalesce(nullif(p_invoice->>'dueDate','')::date,(p_invoice->>'issueDate')::date),upper(coalesce(p_invoice->>'currencyCode','USD')),
    coalesce(nullif(p_invoice->>'exchangeRate','')::numeric,1),v_subtotal,v_tax,v_total,v_total,'OPEN',v_entry_id,v_now,auth.uid(),v_now,auth.uid(),p_operation_id);
   select * into v_receivable from public.erp_financial_receivables where company_id=p_company_id and receivable_id=v_receivable_id;
 else v_entry_id:=v_receivable.journal_entry_id;
 end if;
 v_records:=v_records||jsonb_build_array(public.erp_financial_v2_publish_entry(p_company_id,p_operation_id,p_device_id,v_entry_id));
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_receivables',v_receivable.receivable_id::text,
  jsonb_build_object('id',v_receivable.receivable_id::text,'receivableId',v_receivable.receivable_id::text,'customerId',v_receivable.customer_id,
   'customerName',v_receivable.customer_name_snapshot,'customerTaxId',v_receivable.customer_tax_id_snapshot,'sourceType',v_receivable.source_type,
   'sourceId',v_receivable.source_id,'electronicDocumentId',v_receivable.electronic_document_id,'orderId',v_receivable.order_id,
   'shipmentId',v_receivable.shipment_id::text,'documentType',v_receivable.document_type,'documentNumber',v_receivable.document_number,
   'issueDate',v_receivable.issue_date,'dueDate',v_receivable.due_date,'currencyCode',v_receivable.currency_code,'exchangeRate',v_receivable.exchange_rate,
   'subtotal',v_receivable.subtotal,'taxTotal',v_receivable.tax_total,'total',v_receivable.total,'balance',v_receivable.balance,
   'status',v_receivable.status,'postingStatus','CONTABILIZADO','journalEntryId',v_entry_id::text,
   'createdAt',v_receivable.created_at,'updatedAtServer',v_receivable.updated_at,'version',v_receivable.version,'syncFlow','FINANCIAL_V2'),
  coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_receivables' and record_id=v_receivable.receivable_id::text),0));
 v_records:=v_records||jsonb_build_array(v_saved)||jsonb_build_array(public.erp_financial_v2_write_event(p_company_id,p_operation_id,p_device_id,'POST_INVOICE','INVOICE',v_source_id,jsonb_build_object('receivableId',v_receivable.receivable_id::text,'journalEntryId',v_entry_id::text)));
 v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,'result',jsonb_build_object('receivableId',v_receivable.receivable_id::text,'journalEntryId',v_entry_id::text));
 insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
 values(p_operation_id,p_company_id,'FINANCE_POST_INVOICE',v_source_id,p_invoice,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp()); return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_financial_v2_validate_account(p_company_id uuid, p_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_payload jsonb;
begin
  select payload into v_payload from public.erp_entity_records
   where company_id=p_company_id and entity='accounting_chart_accounts' and deleted_at is null
     and coalesce(payload->>'code',record_id)=btrim(p_code) limit 1;
  if not found then raise exception using errcode='23503',message='FINANCE_V2_ACCOUNT_NOT_FOUND:'||btrim(p_code); end if;
  if lower(coalesce(v_payload->>'status','activa')) not in ('activa','active')
     or lower(coalesce(v_payload->>'isMovement',v_payload->>'is_movement','false')) not in ('true','1') then
    raise exception using errcode='23514',message='FINANCE_V2_ACCOUNT_NOT_POSTABLE:'||btrim(p_code);
  end if;
  return coalesce(v_payload->>'name',btrim(p_code));
end $function$;
