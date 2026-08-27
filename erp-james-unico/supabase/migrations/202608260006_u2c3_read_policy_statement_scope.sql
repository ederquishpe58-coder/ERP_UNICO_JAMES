begin;

-- U2C3-4: evaluate capability sets once per SQL statement for direct RLS reads.
-- The canonical U2C1 resolver remains the only source of effective grants.
create function public.erp_u2c3_authorized_companies(p_capability_ids text[])
returns table(company_id uuid)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select membership.company_id
  from public.user_company_memberships membership
  where membership.user_id=auth.uid()
    and membership.membership_status='ACTIVE'
    and (membership.valid_from is null or membership.valid_from<=current_date)
    and (membership.valid_until is null or membership.valid_until>=current_date)
    and exists(
      select 1
      from public.erp_security_get_effective_capabilities(membership.company_id) effective
      where effective.capability_id=any(coalesce(p_capability_ids,array[]::text[]))
    )
$$;
revoke all on function public.erp_u2c3_authorized_companies(text[]) from public,anon,service_role;
grant execute on function public.erp_u2c3_authorized_companies(text[]) to authenticated;

create function public.erp_u2c3_authorized_entities()
returns table(company_id uuid,entity text)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select distinct membership.company_id,mapping.entity
  from public.user_company_memberships membership
  join lateral public.erp_security_get_effective_capabilities(membership.company_id) effective on true
  join public.erp_u2c3_entity_read_capabilities mapping using(capability_id)
  where membership.user_id=auth.uid()
    and membership.membership_status='ACTIVE'
    and (membership.valid_from is null or membership.valid_from<=current_date)
    and (membership.valid_until is null or membership.valid_until>=current_date)
    and (
      left(mapping.entity,8)<>'payroll_'
      or public.erp_payroll_core_v2_has_permission(membership.company_id,'VIEW')
    )
$$;
revoke all on function public.erp_u2c3_authorized_entities() from public,anon,service_role;
grant execute on function public.erp_u2c3_authorized_entities() to authenticated;

drop policy if exists erp_entity_records_company_member_select on public.erp_entity_records;
create policy erp_entity_records_company_member_select on public.erp_entity_records for select to authenticated
using ((company_id,entity) in (select allowed.company_id,allowed.entity from public.erp_u2c3_authorized_entities() allowed));

drop policy if exists erp_sync_operations_company_member_select on public.erp_sync_operations;
create policy erp_sync_operations_company_member_select on public.erp_sync_operations for select to authenticated
using (
  user_id=auth.uid()
  and (company_id,entity) in (select allowed.company_id,allowed.entity from public.erp_u2c3_authorized_entities() allowed)
);

drop policy if exists accounting_document_links_select_member on public.accounting_document_links;
create policy accounting_document_links_select_member on public.accounting_document_links for select to authenticated
using (sri_is_company_member(company_id,auth.uid()) and company_id in (
  select allowed.company_id from public.erp_u2c3_authorized_companies(array['accounting.journal.view','purchases.documents.view','commercial.electronic_documents.view']) allowed
));

drop policy if exists electronic_documents_select_member on public.electronic_documents;
create policy electronic_documents_select_member on public.electronic_documents for select to authenticated
using (sri_is_company_member(company_id,auth.uid()) and company_id in (
  select allowed.company_id from public.erp_u2c3_authorized_companies(array['commercial.electronic_documents.view']) allowed
));

drop policy if exists erp_company_state_select_member on public.erp_company_state;
create policy erp_company_state_select_member on public.erp_company_state for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['admin.company_state.view']) allowed));

drop policy if exists erp_financial_collection_applications_member_select on public.erp_financial_collection_applications;
create policy erp_financial_collection_applications_member_select on public.erp_financial_collection_applications for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.collections.view']) allowed));
drop policy if exists erp_financial_collections_member_select on public.erp_financial_collections;
create policy erp_financial_collections_member_select on public.erp_financial_collections for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.collections.view']) allowed));
drop policy if exists erp_financial_credit_notes_member_select on public.erp_financial_credit_notes;
create policy erp_financial_credit_notes_member_select on public.erp_financial_credit_notes for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['commercial.credit_notes.view']) allowed));
drop policy if exists erp_financial_journal_entries_member_select on public.erp_financial_journal_entries;
create policy erp_financial_journal_entries_member_select on public.erp_financial_journal_entries for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['accounting.journal.view']) allowed));
drop policy if exists erp_financial_journal_lines_member_select on public.erp_financial_journal_lines;
create policy erp_financial_journal_lines_member_select on public.erp_financial_journal_lines for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['accounting.journal.view']) allowed));
drop policy if exists erp_financial_receivables_member_select on public.erp_financial_receivables;
create policy erp_financial_receivables_member_select on public.erp_financial_receivables for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['portfolio.receivables.view']) allowed));

drop policy if exists erp_supplier_accounts_payable_member_select on public.erp_supplier_accounts_payable;
create policy erp_supplier_accounts_payable_member_select on public.erp_supplier_accounts_payable for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['portfolio.payables.view']) allowed));
drop policy if exists erp_supplier_payment_applications_member_select on public.erp_supplier_payment_applications;
create policy erp_supplier_payment_applications_member_select on public.erp_supplier_payment_applications for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.payments.view']) allowed));
drop policy if exists erp_supplier_payments_member_select on public.erp_supplier_payments;
create policy erp_supplier_payments_member_select on public.erp_supplier_payments for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.payments.view']) allowed));
drop policy if exists erp_supplier_providers_member_select on public.erp_supplier_providers;
create policy erp_supplier_providers_member_select on public.erp_supplier_providers for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['purchases.providers.view','portfolio.suppliers.view']) allowed));
drop policy if exists erp_supplier_purchase_documents_member_select on public.erp_supplier_purchase_documents;
create policy erp_supplier_purchase_documents_member_select on public.erp_supplier_purchase_documents for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['purchases.documents.view']) allowed));
drop policy if exists erp_supplier_purchase_lines_member_select on public.erp_supplier_purchase_lines;
create policy erp_supplier_purchase_lines_member_select on public.erp_supplier_purchase_lines for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['purchases.documents.view']) allowed));
drop policy if exists erp_supplier_purchase_withholding_links_member_select on public.erp_supplier_purchase_withholding_links;
create policy erp_supplier_purchase_withholding_links_member_select on public.erp_supplier_purchase_withholding_links for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['purchases.withholdings.view']) allowed));
drop policy if exists erp_supplier_reception_cost_allocations_member_select on public.erp_supplier_reception_cost_allocations;
create policy erp_supplier_reception_cost_allocations_member_select on public.erp_supplier_reception_cost_allocations for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['purchases.settlements.view']) allowed));
drop policy if exists erp_supplier_settlement_lines_member_select on public.erp_supplier_settlement_lines;
create policy erp_supplier_settlement_lines_member_select on public.erp_supplier_settlement_lines for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['purchases.settlements.view']) allowed));
drop policy if exists erp_supplier_settlements_member_select on public.erp_supplier_settlements;
create policy erp_supplier_settlements_member_select on public.erp_supplier_settlements for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['purchases.settlements.view']) allowed));

drop policy if exists erp_treasury_bank_accounts_member_select on public.erp_treasury_bank_accounts;
create policy erp_treasury_bank_accounts_member_select on public.erp_treasury_bank_accounts for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.accounts.view','treasury.payments.view','treasury.collections.view','treasury.reconciliation.view','treasury.transfers.view','payroll.accounting_settings.view']) allowed));
drop policy if exists erp_treasury_bank_transactions_member_select on public.erp_treasury_bank_transactions;
create policy erp_treasury_bank_transactions_member_select on public.erp_treasury_bank_transactions for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.movements.view']) allowed));
drop policy if exists erp_treasury_cash_transactions_member_select on public.erp_treasury_cash_transactions;
create policy erp_treasury_cash_transactions_member_select on public.erp_treasury_cash_transactions for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.movements.view']) allowed));
drop policy if exists erp_treasury_reconciliation_matches_member_select on public.erp_treasury_reconciliation_matches;
create policy erp_treasury_reconciliation_matches_member_select on public.erp_treasury_reconciliation_matches for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.reconciliation.view']) allowed));
drop policy if exists erp_treasury_reconciliation_reviews_member_select on public.erp_treasury_reconciliation_reviews;
create policy erp_treasury_reconciliation_reviews_member_select on public.erp_treasury_reconciliation_reviews for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.reconciliation.view']) allowed));
drop policy if exists erp_treasury_reconciliations_member_select on public.erp_treasury_reconciliations;
create policy erp_treasury_reconciliations_member_select on public.erp_treasury_reconciliations for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.reconciliation.view']) allowed));
drop policy if exists erp_treasury_transfers_member_select on public.erp_treasury_transfers;
create policy erp_treasury_transfers_member_select on public.erp_treasury_transfers for select to authenticated
using (company_id in (select allowed.company_id from public.erp_u2c3_authorized_companies(array['treasury.transfers.view']) allowed));

drop policy if exists sri_transmissions_select_member on public.sri_transmissions;
create policy sri_transmissions_select_member on public.sri_transmissions for select to authenticated
using (sri_is_company_member(company_id,auth.uid()) and company_id in (
  select allowed.company_id from public.erp_u2c3_authorized_companies(array['commercial.electronic_documents.view']) allowed
));

notify pgrst,'reload schema';
commit;
