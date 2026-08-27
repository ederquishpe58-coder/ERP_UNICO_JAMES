begin;

-- U2C3-2: Finance, Supplier and Treasury critical mutation wrappers.

alter function public.erp_financial_v2_post_journal(uuid,uuid,text,jsonb,text,text,text,timestamptz) rename to erp_financial_v2_post_journal_u2c3_internal;
revoke all on function public.erp_financial_v2_post_journal_u2c3_internal(uuid,uuid,text,jsonb,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_post_journal(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_source_type text default 'MANUAL',
  p_source_id text default null,
  p_event_type text default 'POST_JOURNAL',
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_post_journal', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_post_journal_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_source_type, p_source_id, p_event_type, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_post_journal(uuid,uuid,text,jsonb,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_post_journal(uuid,uuid,text,jsonb,text,text,text,timestamptz) to authenticated;
comment on function public.erp_financial_v2_post_journal(uuid,uuid,text,jsonb,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz) rename to erp_financial_v2_post_invoice_u2c3_internal;
revoke all on function public.erp_financial_v2_post_invoice_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_post_invoice(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_invoice jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_post_invoice', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_post_invoice_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_invoice, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_financial_v2_post_invoice(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz) rename to erp_financial_v2_post_credit_note_u2c3_internal;
revoke all on function public.erp_financial_v2_post_credit_note_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_post_credit_note(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_credit_note jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_post_credit_note', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_post_credit_note_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_credit_note, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_financial_v2_post_credit_note(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_financial_v2_record_cost(uuid,uuid,text,jsonb,timestamptz) rename to erp_financial_v2_record_cost_u2c3_internal;
revoke all on function public.erp_financial_v2_record_cost_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_record_cost(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_record_cost', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_record_cost_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_record_cost(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_record_cost(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_financial_v2_record_cost(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_financial_v2_record_shipment_expense(uuid,uuid,text,jsonb,timestamptz) rename to erp_financial_v2_record_shipment_expense_u2c3_internal;
revoke all on function public.erp_financial_v2_record_shipment_expense_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_record_shipment_expense(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_record_shipment_expense', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_record_shipment_expense_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_record_shipment_expense(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_record_shipment_expense(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_financial_v2_record_shipment_expense(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_financial_v2_register_collection(uuid,uuid,text,jsonb,timestamptz) rename to erp_financial_v2_register_collection_u2c3_internal;
revoke all on function public.erp_financial_v2_register_collection_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_register_collection(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_register_collection', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_register_collection_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_register_collection(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_register_collection(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_financial_v2_register_collection(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamptz) rename to erp_financial_v2_reverse_journal_u2c3_internal;
revoke all on function public.erp_financial_v2_reverse_journal_u2c3_internal(uuid,uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_reverse_journal(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_journal_entry_id uuid,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_reverse_journal', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_reverse_journal_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_journal_entry_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
comment on function public.erp_financial_v2_reverse_journal(uuid,uuid,text,uuid,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_financial_v2_reverse_collection(uuid,uuid,text,uuid,text,timestamptz) rename to erp_financial_v2_reverse_collection_u2c3_internal;
revoke all on function public.erp_financial_v2_reverse_collection_u2c3_internal(uuid,uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_financial_v2_reverse_collection(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_collection_id uuid,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_financial_v2_reverse_collection', p_company_id, '{}'::jsonb
  );
  return public.erp_financial_v2_reverse_collection_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_collection_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_financial_v2_reverse_collection(uuid,uuid,text,uuid,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_financial_v2_reverse_collection(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
comment on function public.erp_financial_v2_reverse_collection(uuid,uuid,text,uuid,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamptz) rename to erp_supplier_v2_upsert_provider_u2c3_internal;
revoke all on function public.erp_supplier_v2_upsert_provider_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_supplier_v2_upsert_provider(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_supplier_v2_upsert_provider', p_company_id, '{}'::jsonb
  );
  return public.erp_supplier_v2_upsert_provider_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_supplier_v2_upsert_provider(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) rename to erp_supplier_v2_post_purchase_u2c3_internal;
revoke all on function public.erp_supplier_v2_post_purchase_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_supplier_v2_post_purchase(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_supplier_v2_post_purchase', p_company_id, '{}'::jsonb
  );
  return public.erp_supplier_v2_post_purchase_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_supplier_v2_post_purchase(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamptz) rename to erp_supplier_v2_create_settlement_u2c3_internal;
revoke all on function public.erp_supplier_v2_create_settlement_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_supplier_v2_create_settlement(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_supplier_v2_create_settlement', p_company_id, '{}'::jsonb
  );
  return public.erp_supplier_v2_create_settlement_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_supplier_v2_create_settlement(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamptz) rename to erp_supplier_v2_register_payment_u2c3_internal;
revoke all on function public.erp_supplier_v2_register_payment_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_supplier_v2_register_payment(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_supplier_v2_register_payment', p_company_id, '{}'::jsonb
  );
  return public.erp_supplier_v2_register_payment_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_supplier_v2_register_payment(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamptz) rename to erp_supplier_v2_reverse_purchase_u2c3_internal;
revoke all on function public.erp_supplier_v2_reverse_purchase_u2c3_internal(uuid,uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_supplier_v2_reverse_purchase(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_purchase_document_id uuid,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_supplier_v2_reverse_purchase', p_company_id, '{}'::jsonb
  );
  return public.erp_supplier_v2_reverse_purchase_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_purchase_document_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
comment on function public.erp_supplier_v2_reverse_purchase(uuid,uuid,text,uuid,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamptz) rename to erp_supplier_v2_reverse_settlement_u2c3_internal;
revoke all on function public.erp_supplier_v2_reverse_settlement_u2c3_internal(uuid,uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_supplier_v2_reverse_settlement(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_settlement_id uuid,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_supplier_v2_reverse_settlement', p_company_id, '{}'::jsonb
  );
  return public.erp_supplier_v2_reverse_settlement_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_settlement_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
comment on function public.erp_supplier_v2_reverse_settlement(uuid,uuid,text,uuid,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz) rename to erp_supplier_v2_reverse_payment_u2c3_internal;
revoke all on function public.erp_supplier_v2_reverse_payment_u2c3_internal(uuid,uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_supplier_v2_reverse_payment(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payment_id uuid,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_supplier_v2_reverse_payment', p_company_id, '{}'::jsonb
  );
  return public.erp_supplier_v2_reverse_payment_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payment_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
comment on function public.erp_supplier_v2_reverse_payment(uuid,uuid,text,uuid,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_upsert_bank_account(uuid,uuid,text,jsonb,timestamptz) rename to erp_treasury_v2_upsert_bank_account_u2c3_internal;
revoke all on function public.erp_treasury_v2_upsert_bank_account_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_upsert_bank_account(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_upsert_bank_account', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_upsert_bank_account_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_upsert_bank_account(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_upsert_bank_account(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_upsert_bank_account(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_upsert_cash_account(uuid,uuid,text,jsonb,timestamptz) rename to erp_treasury_v2_upsert_cash_account_u2c3_internal;
revoke all on function public.erp_treasury_v2_upsert_cash_account_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_upsert_cash_account(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_upsert_cash_account', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_upsert_cash_account_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_upsert_cash_account(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_upsert_cash_account(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_upsert_cash_account(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_register_transaction(uuid,uuid,text,jsonb,timestamptz) rename to erp_treasury_v2_register_transaction_u2c3_internal;
revoke all on function public.erp_treasury_v2_register_transaction_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_register_transaction(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_register_transaction', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_register_transaction_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_register_transaction(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_register_transaction(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_register_transaction(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_save_reconciliation(uuid,uuid,text,jsonb,timestamptz) rename to erp_treasury_v2_save_reconciliation_u2c3_internal;
revoke all on function public.erp_treasury_v2_save_reconciliation_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_save_reconciliation(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_save_reconciliation', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_save_reconciliation_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_save_reconciliation(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_save_reconciliation(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_save_reconciliation(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_transfer(uuid,uuid,text,jsonb,timestamptz) rename to erp_treasury_v2_transfer_u2c3_internal;
revoke all on function public.erp_treasury_v2_transfer_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_transfer(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_transfer', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_transfer_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_transfer(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_transfer(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_transfer(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_register_adjustment(uuid,uuid,text,jsonb,timestamptz) rename to erp_treasury_v2_register_adjustment_u2c3_internal;
revoke all on function public.erp_treasury_v2_register_adjustment_u2c3_internal(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_register_adjustment(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_payload jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_register_adjustment', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_register_adjustment_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_register_adjustment(uuid,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_register_adjustment(uuid,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_register_adjustment(uuid,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_import_statement(uuid,uuid,text,uuid,text,text,jsonb,timestamptz) rename to erp_treasury_v2_import_statement_u2c3_internal;
revoke all on function public.erp_treasury_v2_import_statement_u2c3_internal(uuid,uuid,text,uuid,text,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_import_statement(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_bank_account_id uuid,
  p_file_name text,
  p_file_fingerprint text,
  p_rows jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_import_statement', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_import_statement_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_bank_account_id, p_file_name, p_file_fingerprint, p_rows, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_import_statement(uuid,uuid,text,uuid,text,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_import_statement(uuid,uuid,text,uuid,text,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_import_statement(uuid,uuid,text,uuid,text,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_reconcile(uuid,uuid,text,uuid,jsonb,text,timestamptz) rename to erp_treasury_v2_reconcile_u2c3_internal;
revoke all on function public.erp_treasury_v2_reconcile_u2c3_internal(uuid,uuid,text,uuid,jsonb,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_reconcile(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_reconciliation_id uuid,
  p_matches jsonb,
  p_notes text default '',
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_reconcile', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_reconcile_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_reconciliation_id, p_matches, p_notes, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_reconcile(uuid,uuid,text,uuid,jsonb,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_reconcile(uuid,uuid,text,uuid,jsonb,text,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_reconcile(uuid,uuid,text,uuid,jsonb,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_reverse_match(uuid,uuid,text,uuid,text,timestamptz) rename to erp_treasury_v2_reverse_match_u2c3_internal;
revoke all on function public.erp_treasury_v2_reverse_match_u2c3_internal(uuid,uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_reverse_match(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_match_id uuid,
  p_reason text,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_reverse_match', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_reverse_match_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_match_id, p_reason, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_reverse_match(uuid,uuid,text,uuid,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_reverse_match(uuid,uuid,text,uuid,text,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_reverse_match(uuid,uuid,text,uuid,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_review_reconciliation(uuid,uuid,text,uuid,text,text,text,text,timestamptz) rename to erp_treasury_v2_review_reconciliation_u2c3_internal;
revoke all on function public.erp_treasury_v2_review_reconciliation_u2c3_internal(uuid,uuid,text,uuid,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_review_reconciliation(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_reconciliation_id uuid,
  p_side text,
  p_record_id text,
  p_action text,
  p_observation text default '',
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_review_reconciliation', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_review_reconciliation_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_reconciliation_id, p_side, p_record_id, p_action, p_observation, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_review_reconciliation(uuid,uuid,text,uuid,text,text,text,text,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_review_reconciliation(uuid,uuid,text,uuid,text,text,text,text,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_review_reconciliation(uuid,uuid,text,uuid,text,text,text,text,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';


alter function public.erp_treasury_v2_set_reconciliation_status(uuid,uuid,text,uuid,text,jsonb,timestamptz) rename to erp_treasury_v2_set_reconciliation_status_u2c3_internal;
revoke all on function public.erp_treasury_v2_set_reconciliation_status_u2c3_internal(uuid,uuid,text,uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function public.erp_treasury_v2_set_reconciliation_status(
  p_operation_id uuid,
  p_company_id uuid,
  p_device_id text,
  p_reconciliation_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_local_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2c3_assert_mutation_capability(
    'erp_treasury_v2_set_reconciliation_status', p_company_id, '{}'::jsonb
  );
  return public.erp_treasury_v2_set_reconciliation_status_u2c3_internal(p_operation_id, p_company_id, p_device_id, p_reconciliation_id, p_action, p_payload, p_local_created_at);
end;
$$;

revoke all on function public.erp_treasury_v2_set_reconciliation_status(uuid,uuid,text,uuid,text,jsonb,timestamptz) from public, anon, service_role;
grant execute on function public.erp_treasury_v2_set_reconciliation_status(uuid,uuid,text,uuid,text,jsonb,timestamptz) to authenticated;
comment on function public.erp_treasury_v2_set_reconciliation_status(uuid,uuid,text,uuid,text,jsonb,timestamptz) is
  'U2C3 capability-guarded entrypoint. The original implementation remains internal and preserves transaction, locks and idempotency.';

notify pgrst,'reload schema';
commit;
