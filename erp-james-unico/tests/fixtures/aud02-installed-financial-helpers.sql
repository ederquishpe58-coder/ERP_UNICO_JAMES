-- Installed financial helper definitions. READ-ONLY snapshot 2026-09-12; tests only.
CREATE OR REPLACE FUNCTION public.erp_financial_v2_create_entry_internal(p_company_id uuid, p_operation_id uuid, p_device_id text, p_payload jsonb, p_source_type text, p_source_id text, p_event_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid:=coalesce(nullif(p_payload->>'journalEntryId','')::uuid,gen_random_uuid()); v_date date; v_period text; v_line jsonb;
 v_debit numeric(20,6):=0; v_credit numeric(20,6):=0; v_number text; v_index integer:=0; v_account_name text;
begin
 v_date:=coalesce(nullif(p_payload->>'accountingDate','')::date,current_date);
 v_period:=to_char(v_date,'YYYY-MM');
 if exists(select 1 from public.erp_financial_period_controls where company_id=p_company_id and accounting_period=v_period and status='CLOSED') then
   raise exception using errcode='23514',message='FINANCE_V2_PERIOD_CLOSED:'||v_period;
 end if;
 if jsonb_typeof(coalesce(p_payload->'lines','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'lines','[]'))<2 then
   raise exception using errcode='22023',message='FINANCE_V2_LINES_REQUIRED';
 end if;
 for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
   v_debit:=v_debit+round(coalesce(nullif(v_line->>'debit','')::numeric,0),6);
   v_credit:=v_credit+round(coalesce(nullif(v_line->>'credit','')::numeric,0),6);
   if (coalesce(nullif(v_line->>'debit','')::numeric,0)>0)=(coalesce(nullif(v_line->>'credit','')::numeric,0)>0) then
     raise exception using errcode='23514',message='FINANCE_V2_LINE_SIDE_INVALID';
   end if;
 end loop;
 if round(v_debit,6)<>round(v_credit,6) or v_debit<=0 then
   raise exception using errcode='23514',message='FINANCE_V2_UNBALANCED_ENTRY';
 end if;
 v_number:=public.erp_financial_v2_next_code(p_company_id,'JOURNAL',v_date);
 insert into public.erp_financial_journal_entries(company_id,journal_entry_id,entry_number,accounting_date,accounting_period,concept,
   origin_module,source_type,source_id,event_type,source_document,external_reference,currency_code,exchange_rate,status,
   total_debit,total_credit,legacy_draft_id,observation,created_at,created_by,posted_at,posted_by,last_operation_id)
 values(p_company_id,v_id,v_number,v_date,v_period,btrim(coalesce(p_payload->>'concept','Asiento contable')),
   btrim(coalesce(p_payload->>'originModule','Manual')),upper(btrim(p_source_type)),nullif(btrim(p_source_id),''),upper(btrim(p_event_type)),
   btrim(coalesce(p_payload->>'sourceDocument','')),btrim(coalesce(p_payload->>'externalReference','')),
   upper(btrim(coalesce(p_payload->>'currencyCode','USD'))),coalesce(nullif(p_payload->>'exchangeRate','')::numeric,1),
   'POSTED',v_debit,v_credit,nullif(p_payload->>'legacyDraftId',''),btrim(coalesce(p_payload->>'observation','')),
   clock_timestamp(),auth.uid(),clock_timestamp(),auth.uid(),p_operation_id);
 for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
   v_index:=v_index+1; v_account_name:=public.erp_financial_v2_validate_account(p_company_id,v_line->>'accountCode');
   insert into public.erp_financial_journal_lines(company_id,journal_entry_line_id,journal_entry_id,line_number,account_code,
    account_name_snapshot,debit,credit,cost_center,auxiliary,description,document_reference)
   values(p_company_id,gen_random_uuid(),v_id,v_index,btrim(v_line->>'accountCode'),v_account_name,
    round(coalesce(nullif(v_line->>'debit','')::numeric,0),6),round(coalesce(nullif(v_line->>'credit','')::numeric,0),6),
    btrim(coalesce(v_line->>'costCenter','')),btrim(coalesce(v_line->>'auxiliary','')),
    btrim(coalesce(v_line->>'lineDescription','')),btrim(coalesce(v_line->>'documentReference','')));
 end loop;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_financial_v2_next_code(p_company_id uuid, p_type text, p_date date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_type text:=upper(btrim(p_type)); v_year integer:=extract(year from p_date)::integer; v_value bigint;
begin
  if v_type not in ('JOURNAL','COLLECTION') then raise exception using errcode='22023',message='FINANCE_V2_SEQUENCE_TYPE_INVALID'; end if;
  insert into public.erp_financial_sequence_counters(company_id,sequence_type,calendar_year,last_value,updated_at)
  values(p_company_id,v_type,v_year,1,clock_timestamp())
  on conflict(company_id,sequence_type,calendar_year) do update set
    last_value=erp_financial_sequence_counters.last_value+1,updated_at=clock_timestamp()
  returning last_value into v_value;
  return (case when v_type='JOURNAL' then 'ASI-' else 'COB-' end)||v_year||'-'||lpad(v_value::text,6,'0');
end $function$;

CREATE OR REPLACE FUNCTION public.erp_financial_v2_publish_entry(p_company_id uuid, p_operation_id uuid, p_device_id text, p_entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_entry public.erp_financial_journal_entries%rowtype; v_lines jsonb; v_saved jsonb;
begin
 select * into v_entry from public.erp_financial_journal_entries where company_id=p_company_id and journal_entry_id=p_entry_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',journal_entry_line_id::text,'accountCode',account_code,'accountName',account_name_snapshot,
   'debit',debit,'credit',credit,'costCenter',cost_center,'auxiliary',auxiliary,'lineDescription',description,
   'documentReference',document_reference) order by line_number),'[]') into v_lines
 from public.erp_financial_journal_lines where company_id=p_company_id and journal_entry_id=p_entry_id;
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_journal_entries',p_entry_id::text,
   jsonb_build_object('id',p_entry_id::text,'journalEntryId',p_entry_id::text,'entryNumber',v_entry.entry_number,
   'accountingDate',v_entry.accounting_date,'accountingPeriod',v_entry.accounting_period,'concept',v_entry.concept,
   'originModule',v_entry.origin_module,'sourceType',v_entry.source_type,'sourceId',v_entry.source_id,'eventType',v_entry.event_type,
   'sourceDocument',v_entry.source_document,'externalReference',v_entry.external_reference,'currencyCode',v_entry.currency_code,
   'exchangeRate',v_entry.exchange_rate,'status',v_entry.status,'totalDebit',v_entry.total_debit,'totalCredit',v_entry.total_credit,
   'reverseOfId',v_entry.reverse_of_id::text,'legacyDraftId',v_entry.legacy_draft_id,'observation',v_entry.observation,
   'createdAt',v_entry.created_at,'postedAt',v_entry.posted_at,'reversedAt',v_entry.reversed_at,'lines',v_lines,
   'version',v_entry.version,'syncFlow','FINANCIAL_V2'),
   coalesce((select version from public.erp_entity_records where company_id=p_company_id and entity='financial_journal_entries' and record_id=p_entry_id::text),0));
 return v_saved;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_financial_v2_write_event(p_company_id uuid, p_operation_id uuid, p_device_id text, p_event_type text, p_source_type text, p_source_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid:=gen_random_uuid(); v_saved jsonb;
begin
 insert into public.erp_financial_events(company_id,event_id,event_type,source_type,source_id,payload,operation_id,device_id,occurred_at,user_id)
 values(p_company_id,v_id,upper(btrim(p_event_type)),upper(btrim(p_source_type)),p_source_id,coalesce(p_payload,'{}'),p_operation_id,p_device_id,clock_timestamp(),auth.uid());
 v_saved:=public.erp_operations_v2_write_record(p_company_id,p_operation_id,p_device_id,'financial_events',v_id::text,
   jsonb_build_object('id',v_id::text,'eventId',v_id::text,'eventType',upper(btrim(p_event_type)),'sourceType',upper(btrim(p_source_type)),
   'sourceId',p_source_id,'payload',coalesce(p_payload,'{}'),'operationId',p_operation_id::text,'occurredAt',clock_timestamp(),'syncFlow','FINANCIAL_V2'),0);
 return v_saved;
end $function$;
