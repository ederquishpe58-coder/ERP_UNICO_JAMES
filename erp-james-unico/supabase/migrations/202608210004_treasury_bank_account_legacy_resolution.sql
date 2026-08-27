-- Confirma cuentas bancarias legacy de forma idempotente antes de usarlas en Tesorería V2.
-- No transforma IDs BNK-* en UUID ni modifica importaciones/conciliaciones existentes.

begin;

create or replace function public.erp_treasury_v2_upsert_bank_account(
 p_operation_id uuid,p_company_id uuid,p_device_id text,p_payload jsonb,p_local_created_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_existing jsonb;
  v_id uuid;
  v_requested_id uuid;
  v_requested_text text;
  v_legacy_id text;
  v_code text;
  v_records jsonb:='[]';
  v_result jsonb;
  v_date date;
  v_reused boolean:=false;
begin
  perform public.erp_financial_v2_assert_access(p_company_id);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  v_existing:=public.erp_treasury_v2_command_result(p_operation_id,p_company_id);
  if v_existing is not null then return v_existing; end if;

  v_requested_text:=coalesce(nullif(btrim(p_payload->>'bankAccountId'),''),nullif(btrim(p_payload->>'id'),''));
  if v_requested_text is not null and v_requested_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='TREASURY_V2_BANK_ACCOUNT_ID_NOT_UUID';
  end if;
  v_requested_id:=v_requested_text::uuid;
  v_legacy_id:=nullif(btrim(p_payload->>'legacyId'),'');

  if v_requested_id is null and v_legacy_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|BANK_ACCOUNT_LEGACY|'||v_legacy_id,0));
    select bank_account_id,account_code into v_id,v_code
      from public.erp_treasury_bank_accounts
     where company_id=p_company_id and legacy_id=v_legacy_id
     for update;
    v_reused:=found;
  end if;

  if v_reused then
    v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_accounts',v_id));
    v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,
      'result',jsonb_build_object('bankAccountId',v_id::text,'accountCode',v_code,'reused',true));
    insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
    values(p_operation_id,p_company_id,'TREASURY_UPSERT_BANK_ACCOUNT',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
    return v_result;
  end if;

  v_id:=coalesce(v_requested_id,gen_random_uuid());
  v_date:=coalesce(nullif(p_payload->>'openingBalanceDate','')::date,current_date);
  perform public.erp_financial_v2_validate_account(p_company_id,p_payload->>'ledgerAccountCode');
  select account_code into v_code from public.erp_treasury_bank_accounts where company_id=p_company_id and bank_account_id=v_id for update;
  v_code:=coalesce(v_code,nullif(btrim(p_payload->>'accountCode'),''),public.erp_treasury_v2_next_code(p_company_id,'BANK_ACCOUNT',v_date));
  insert into public.erp_treasury_bank_accounts(company_id,bank_account_id,account_code,bank_name,account_holder,masked_number,account_type,currency_code,
    ledger_account_code,opening_balance,opening_balance_date,status,notes,legacy_id,created_by,updated_by,last_operation_id)
  values(p_company_id,v_id,v_code,btrim(p_payload->>'bankName'),btrim(coalesce(p_payload->>'holder','')),btrim(coalesce(p_payload->>'maskedNumber','')),upper(coalesce(nullif(p_payload->>'accountType',''),'CHECKING')),
    upper(coalesce(nullif(p_payload->>'currencyCode',''),'USD')),btrim(p_payload->>'ledgerAccountCode'),coalesce(nullif(p_payload->>'openingBalance','')::numeric,0),
    v_date,upper(coalesce(nullif(p_payload->>'status',''),'ACTIVE')),btrim(coalesce(p_payload->>'notes','')),v_legacy_id,auth.uid(),auth.uid(),p_operation_id)
  on conflict(company_id,bank_account_id) do update set bank_name=excluded.bank_name,account_holder=excluded.account_holder,masked_number=excluded.masked_number,account_type=excluded.account_type,
    currency_code=excluded.currency_code,ledger_account_code=excluded.ledger_account_code,status=excluded.status,notes=excluded.notes,
    updated_at=clock_timestamp(),updated_by=auth.uid(),version=erp_treasury_bank_accounts.version+1,last_operation_id=p_operation_id;
  v_records:=jsonb_build_array(public.erp_treasury_v2_publish(p_company_id,p_operation_id,p_device_id,'treasury_bank_accounts',v_id));
  v_result:=jsonb_build_object('ok',true,'serverTime',clock_timestamp(),'records',v_records,
    'result',jsonb_build_object('bankAccountId',v_id::text,'accountCode',v_code,'reused',false));
  insert into public.erp_operations_commands(operation_id,company_id,command_type,source_record_id,request_payload,result,status,user_id,device_id,local_created_at,server_created_at)
  values(p_operation_id,p_company_id,'TREASURY_UPSERT_BANK_ACCOUNT',v_id::text,p_payload,v_result,'CONFIRMED',auth.uid(),p_device_id,p_local_created_at,clock_timestamp());
  return v_result;
end $$;

notify pgrst,'reload schema';

commit;
