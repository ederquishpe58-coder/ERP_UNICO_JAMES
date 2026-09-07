-- NO_CREDIT: same economic account per line, compatible support, no VAT credit.
CREATE OR REPLACE FUNCTION public.erp_bless_purchase_validate_contract(p_company_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_line jsonb; v_journal jsonb; v_index integer:=0; v_ap text; v_provider_ap text;
 v_credit text; v_support text; v_date date; v_rate numeric; v_tax numeric; v_base numeric;
 v_credit_tax numeric:=0; v_economic_debit numeric;
 v_total numeric:=0; v_total_tax numeric:=0; v_account text; v_config jsonb;
begin
 if p_company_id <> 'cf331b82-7ac3-4065-9e38-d0bbcde96cd5'::uuid then return; end if;
 if p_payload#>>'{sourcePayload,purchaseAccountContract}' is distinct from 'BLESS_PURCHASE_V1' then
  raise exception 'PURCHASE_ACCOUNT_CONTRACT_REQUIRED: actualice Compras antes de contabilizar';
 end if;
 select payload into v_config from public.erp_entity_records where company_id=p_company_id and entity='company_settings' and record_id='company_settings' and deleted_at is null;
 if v_config#>>'{purchaseAccounting,relatedPayableAccountCode}' is distinct from '2.01.01.01'
 or v_config#>>'{purchaseAccounting,nonRelatedPayableAccountCode}' is distinct from '2.01.01.02'
 then raise exception 'PURCHASE_CANONICAL_MAPPING_REQUIRED'; end if;
 v_date := (p_payload->>'issueDate')::date;
 if v_date is null then raise exception 'PURCHASE_DOCUMENT_DATE_REQUIRED'; end if;
 v_ap:=btrim(p_payload->>'payableAccountCode');
 if coalesce(p_payload->>'settlementMode','CXP')='CXP' then
  if v_ap is null or v_ap not in ('2.01.01.01','2.01.01.02') then raise exception 'PURCHASE_AP_ACCOUNT_REQUIRED: seleccione relacionada o no relacionada'; end if;
  select payable_account_code into v_provider_ap from public.erp_supplier_providers
   where company_id=p_company_id and (provider_id::text=p_payload->>'providerId' or tax_id=p_payload#>>'{provider,taxId}') limit 1;
  if nullif(v_provider_ap,'') is not null and v_provider_ap<>v_ap then raise exception 'PURCHASE_PROVIDER_AP_MISMATCH'; end if;
  perform public.erp_financial_v2_validate_account(p_company_id,v_ap);
  if not exists(select 1 from public.erp_entity_records where company_id=p_company_id and entity='accounting_chart_accounts' and deleted_at is null and payload->>'code'=v_ap and payload->>'nature'='Acreedora') then raise exception 'PURCHASE_AP_NATURE_INVALID'; end if;
 else
  v_ap:=btrim(p_payload->>'paymentAccountCode');
  if nullif(v_ap,'') is null then raise exception 'PURCHASE_PAYMENT_ACCOUNT_REQUIRED'; end if;
  perform public.erp_financial_v2_validate_account(p_company_id,v_ap);
 end if;
 if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'PURCHASE_LINE_ACCOUNT_REQUIRED'; end if;
 v_credit:=p_payload#>>'{sourcePayload,vatCreditTreatment}';
 if jsonb_typeof(p_payload#>'{journal,lines}') is distinct from 'array' then raise exception 'PURCHASE_JOURNAL_REQUIRED'; end if;
 v_support:=p_payload#>>'{sourcePayload,taxSupportCode}';
 if (v_credit='NO_CREDIT' and (v_support is null or v_support not in ('02','04','07')))
 or (v_credit='CREDIT' and v_support in ('02','04','07')) then raise exception 'PURCHASE_VAT_SUPPORT_CONFLICT'; end if;
 for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
  v_index:=v_index+1; v_account:=btrim(v_line->>'accountCode');
  if nullif(v_account,'') is null or v_account in ('5.3','5.5.04','2.1.01.01','1.1.04.01') then raise exception 'PURCHASE_LINE_ACCOUNT_REQUIRED: lÃ­nea %',v_index; end if;
  begin perform public.erp_financial_v2_validate_account(p_company_id,v_account);
  exception when others then raise exception 'PURCHASE_LINE_ACCOUNT_REQUIRED: lÃ­nea %, cuenta %',v_index,v_account; end;
  v_base:=(v_line->>'taxableBase')::numeric; v_rate:=(v_line->>'vatRate')::numeric; v_tax:=(v_line->>'vatValue')::numeric;
  if v_base is null or v_rate is null or v_tax is null or v_base<0 or v_rate<0 or v_tax<0 or abs(round(v_base*v_rate/100,2)-v_tax)>0.02 then raise exception 'PURCHASE_VAT_AMOUNT_MISMATCH: lÃ­nea %',v_index; end if;
  if p_payload->>'source'='XML' then
   if v_line->>'vatRateAuthority' is distinct from 'DOCUMENT' or nullif(v_line->>'vatCode','') is null then raise exception 'PURCHASE_DOCUMENT_TAX_REQUIRED'; end if;
  else
   if v_line->>'vatRateAuthority' is distinct from 'EFFECTIVE_TABLE' or not exists (
    select 1 from public.erp_entity_records t where t.company_id=p_company_id and t.entity='accounting_tax_parameters' and t.deleted_at is null
    and t.payload->>'id'=v_line->>'vatParameterId' and t.payload->>'taxType'='IVA'
    and t.payload->>'appliesTo' in ('compras','compra','ambos') and lower(t.payload->>'status') in ('activa','activo','active')
    and (t.payload->>'rate')::numeric=v_rate and t.payload->>'sriCode'=v_line->>'vatCode' and (t.payload->>'effectiveFrom')::date<=v_date
    and (nullif(t.payload->>'effectiveTo','') is null or (t.payload->>'effectiveTo')::date>=v_date)
   ) then raise exception 'PURCHASE_VAT_RATE_REQUIRED: parÃ¡metro efectivo por fecha'; end if;
  end if;
  if v_tax>0 and (v_credit is null or v_credit not in ('CREDIT','NO_CREDIT') or nullif(v_support,'') is null) then raise exception 'PURCHASE_VAT_TREATMENT_REQUIRED'; end if;
  if v_credit='NO_CREDIT' and v_account='1.01.08' then raise exception 'PURCHASE_LINE_ACCOUNT_REQUIRED: cuenta economica requerida'; end if;
  if v_line->>'vatCode' is null or not (
    (v_line->>'vatCode' in ('0','6','7') and v_rate=0)
    or (v_line->>'vatCode'='2' and v_rate=12) or (v_line->>'vatCode'='3' and v_rate=14)
    or (v_line->>'vatCode'='4' and v_rate=15) or (v_line->>'vatCode'='5' and v_rate=5)
    or (v_line->>'vatCode'='8' and v_rate>=8 and v_rate<12) or (v_line->>'vatCode'='10' and v_rate=13)
  ) then raise exception 'PURCHASE_VAT_CODE_RATE_MISMATCH'; end if;
  v_economic_debit:=v_base+case when v_credit='NO_CREDIT' then v_tax else 0 end;
  v_credit_tax:=v_credit_tax+case when v_credit='CREDIT' then v_tax else 0 end;
  v_journal:=p_payload#>'{journal,lines}'->(v_index-1);
  if v_journal->>'accountCode' is distinct from v_account or (v_journal->>'debit')::numeric is distinct from v_economic_debit or coalesce((v_journal->>'credit')::numeric,0)<>0 then raise exception 'PURCHASE_LINE_JOURNAL_MISMATCH'; end if;
  v_total:=v_total+v_base+v_tax; v_total_tax:=v_total_tax+v_tax;
 end loop;
 if abs(v_total-coalesce((p_payload#>>'{totals,total}')::numeric,-1))>0.02 or abs(v_total_tax-coalesce((p_payload#>>'{totals,taxTotal}')::numeric,-1))>0.02 then raise exception 'PURCHASE_TOTAL_MISMATCH'; end if;
 if v_credit_tax>0 then
  if v_config#>>'{purchaseAccounting,vatCreditAccountCode}' is distinct from '1.01.08' then raise exception 'PURCHASE_CANONICAL_MAPPING_REQUIRED'; end if;
  perform public.erp_financial_v2_validate_account(p_company_id,'1.01.08');
  if not exists(select 1 from public.erp_entity_records where company_id=p_company_id and entity='accounting_chart_accounts' and deleted_at is null and payload->>'code'='1.01.08' and payload->>'nature'='Deudora') then raise exception 'PURCHASE_VAT_NATURE_INVALID'; end if;
 end if;
 -- All journal lines following economic lines must be explicit credit-VAT debits or the sole AP/payment credit.
 if jsonb_array_length(p_payload#>'{journal,lines}') < v_index+1 then raise exception 'PURCHASE_JOURNAL_REQUIRED'; end if;
 if exists(select 1 from jsonb_array_elements(p_payload#>'{journal,lines}') with ordinality j(line,n)
  where n>v_index and n<jsonb_array_length(p_payload#>'{journal,lines}') and (line->>'accountCode'<>'1.01.08' or coalesce((line->>'credit')::numeric,0)<>0 or coalesce((line->>'debit')::numeric,0)<=0)) then raise exception 'PURCHASE_VAT_JOURNAL_MISMATCH'; end if;
 if (select coalesce(sum((line->>'debit')::numeric),0) from jsonb_array_elements(p_payload#>'{journal,lines}') with ordinality j(line,n) where n>v_index and n<jsonb_array_length(p_payload#>'{journal,lines}')) is distinct from v_credit_tax then raise exception 'PURCHASE_VAT_JOURNAL_MISMATCH'; end if;
 v_journal:=p_payload#>'{journal,lines}'->(jsonb_array_length(p_payload#>'{journal,lines}')-1);
 if v_journal->>'accountCode' is distinct from v_ap or (v_journal->>'credit')::numeric is distinct from v_total or coalesce((v_journal->>'debit')::numeric,0)<>0 then raise exception 'PURCHASE_AP_JOURNAL_MISMATCH'; end if;
end;
$function$;
