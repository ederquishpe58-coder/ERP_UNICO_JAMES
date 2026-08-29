begin;

-- GERENCIA_GENERAL is the explicit union of the capabilities that RC5 already
-- grants through canonical base profiles. Capabilities without any base-profile
-- grant remain default-denied and are deliberately excluded.
create temporary table pg_temp.gerencia_general_expected_capabilities (
  capability_id text primary key
) on commit drop;

insert into pg_temp.gerencia_general_expected_capabilities(capability_id)
values
  ('accounting.chart.manage'),
  ('accounting.chart.view'),
  ('accounting.costs.record'),
  ('accounting.financial_statements.export'),
  ('accounting.financial_statements.view'),
  ('accounting.journal.post'),
  ('accounting.journal.view'),
  ('accounting.ledger.export'),
  ('accounting.ledger.view'),
  ('accounting.sales.post'),
  ('accounting.sales.view'),
  ('accounting.shipment_expenses.record'),
  ('admin.audit.export'),
  ('admin.audit.view'),
  ('admin.company.manage'),
  ('admin.company.view'),
  ('admin.company_state.edit'),
  ('admin.company_state.view'),
  ('admin.cost_centers.manage'),
  ('admin.cost_centers.view'),
  ('admin.diagnostics.view'),
  ('admin.sequences.view'),
  ('admin.synchronization.manage'),
  ('admin.synchronization.view'),
  ('admin.users.manage'),
  ('admin.users.view'),
  ('commercial.airlines.manage'),
  ('commercial.airlines.view'),
  ('commercial.availability.release'),
  ('commercial.availability.reserve'),
  ('commercial.availability.view'),
  ('commercial.box_types.view'),
  ('commercial.brands.manage'),
  ('commercial.brands.view'),
  ('commercial.cargo_agencies.manage'),
  ('commercial.cargo_agencies.view'),
  ('commercial.coordination.edit'),
  ('commercial.coordination.view'),
  ('commercial.countries.manage'),
  ('commercial.countries.view'),
  ('commercial.credit_notes.create'),
  ('commercial.credit_notes.post'),
  ('commercial.credit_notes.view'),
  ('commercial.customers.manage'),
  ('commercial.customers.view'),
  ('commercial.daes.manage'),
  ('commercial.daes.view'),
  ('commercial.dashboard.view'),
  ('commercial.electronic_documents.authorize'),
  ('commercial.electronic_documents.correct'),
  ('commercial.electronic_documents.create'),
  ('commercial.electronic_documents.view'),
  ('commercial.export_products.view'),
  ('commercial.exports.create'),
  ('commercial.exports.edit'),
  ('commercial.exports.transition'),
  ('commercial.exports.view'),
  ('commercial.orders.create'),
  ('commercial.orders.edit'),
  ('commercial.orders.view'),
  ('commercial.preorders.create'),
  ('commercial.preorders.edit'),
  ('commercial.preorders.view'),
  ('commercial.route_sheet.print'),
  ('commercial.senae_liquidation.generate'),
  ('commercial.senae_liquidation.view'),
  ('core.dashboard.view'),
  ('inventory.adjustments.create'),
  ('inventory.adjustments.view'),
  ('inventory.consumptions.create'),
  ('inventory.consumptions.view'),
  ('inventory.kardex.export'),
  ('inventory.kardex.view'),
  ('inventory.purchase_entries.view'),
  ('inventory.summary.view'),
  ('operations.availability.view'),
  ('operations.boxes.close'),
  ('operations.boxes.create'),
  ('operations.boxes.release_order'),
  ('operations.boxes.reopen'),
  ('operations.boxes.scan'),
  ('operations.boxes.unassign'),
  ('operations.bunch_intake.reassign'),
  ('operations.bunch_intake.receive'),
  ('operations.bunch_intake.view'),
  ('operations.classification.edit'),
  ('operations.classification.record'),
  ('operations.classification.view'),
  ('operations.cold_room.confirm_dispatch'),
  ('operations.cold_room.prepare'),
  ('operations.cold_room.view'),
  ('operations.dashboard.view'),
  ('operations.destination_orders.confirm'),
  ('operations.inventory.view'),
  ('operations.labels.create'),
  ('operations.labels.reprint'),
  ('operations.labels.view'),
  ('operations.parameters.view'),
  ('operations.reception.create'),
  ('operations.reception.edit'),
  ('operations.reception.view'),
  ('operations.yields.view'),
  ('payroll.accounting_settings.manage'),
  ('payroll.accounting_settings.view'),
  ('payroll.employees.manage'),
  ('payroll.employees.view'),
  ('payroll.performance_policies.manage'),
  ('payroll.performance_policies.view'),
  ('payroll.roles.approve'),
  ('payroll.roles.calculate'),
  ('payroll.roles.post'),
  ('payroll.roles.print'),
  ('payroll.roles.view'),
  ('portfolio.customers.view'),
  ('portfolio.payables.view'),
  ('portfolio.receivables.view'),
  ('portfolio.suppliers.view'),
  ('purchases.documents.create'),
  ('purchases.documents.import'),
  ('purchases.documents.post'),
  ('purchases.documents.view'),
  ('purchases.providers.manage'),
  ('purchases.providers.view'),
  ('purchases.retention_report.export'),
  ('purchases.retention_report.view'),
  ('purchases.settlements.create'),
  ('purchases.settlements.view'),
  ('purchases.tax_supports.view'),
  ('purchases.withholdings.create'),
  ('purchases.withholdings.view'),
  ('reports.accounting.export'),
  ('reports.accounting.view'),
  ('reports.banks.export'),
  ('reports.banks.view'),
  ('reports.commercial.export'),
  ('reports.commercial.view'),
  ('reports.dashboard.view'),
  ('reports.inventory.export'),
  ('reports.inventory.view'),
  ('reports.portfolio.export'),
  ('reports.portfolio.view'),
  ('reports.tax.export'),
  ('reports.tax.view'),
  ('tax.ats.export'),
  ('tax.ats.generate'),
  ('tax.ats.view'),
  ('tax.parameters.manage'),
  ('tax.parameters.view'),
  ('tax.received_withholdings.import'),
  ('tax.received_withholdings.view'),
  ('tax.retention_parameters.manage'),
  ('tax.retention_parameters.view'),
  ('treasury.accounts.manage'),
  ('treasury.accounts.view'),
  ('treasury.cash_accounts.manage'),
  ('treasury.cash_accounts.view'),
  ('treasury.cash_flow.export'),
  ('treasury.cash_flow.view'),
  ('treasury.collections.create'),
  ('treasury.collections.view'),
  ('treasury.movements.adjust'),
  ('treasury.movements.create'),
  ('treasury.movements.view'),
  ('treasury.payments.create'),
  ('treasury.payments.view'),
  ('treasury.reconciliation.execute'),
  ('treasury.reconciliation.import'),
  ('treasury.reconciliation.review'),
  ('treasury.reconciliation.save'),
  ('treasury.reconciliation.set_status'),
  ('treasury.reconciliation.view'),
  ('treasury.transfers.create'),
  ('treasury.transfers.view');

create temporary table pg_temp.gerencia_general_existing_profile_grants
on commit drop
as
select
  pc.profile_id,
  count(*)::integer as grant_count,
  md5(string_agg(pc.capability_id, E'\n' order by pc.capability_id)) as grant_fingerprint
from public.erp_security_profile_capabilities pc
where pc.profile_id <> 'GERENCIA_GENERAL'
group by pc.profile_id;

create temporary table pg_temp.gerencia_general_base_denied
on commit drop
as
select capability.capability_id
from public.erp_security_capabilities capability
where capability.active
  and not exists (
    select 1
    from public.erp_security_profile_capabilities profile_capability
    where profile_capability.capability_id = capability.capability_id
      and profile_capability.profile_id <> 'GERENCIA_GENERAL'
  );

do $$
declare
  v_expected integer;
  v_profile_grantable integer;
  v_base_denied integer;
begin
  select count(*) into v_expected
  from pg_temp.gerencia_general_expected_capabilities;

  select count(distinct profile_capability.capability_id) into v_profile_grantable
  from public.erp_security_profile_capabilities profile_capability
  where profile_capability.profile_id <> 'GERENCIA_GENERAL';

  select count(*) into v_base_denied
  from pg_temp.gerencia_general_base_denied;

  if v_expected <> 173 or v_profile_grantable <> 173 then
    raise exception 'GERENCIA_GENERAL_PROFILE_GRANTABLE_COUNT_MISMATCH: expected=%, canonical=%',
      v_expected, v_profile_grantable;
  end if;

  if v_base_denied <> 22 then
    raise exception 'GERENCIA_GENERAL_BASE_DENIED_COUNT_MISMATCH: %', v_base_denied;
  end if;

  if exists (
    select 1
    from pg_temp.gerencia_general_expected_capabilities expected
    left join public.erp_security_capabilities capability
      on capability.capability_id = expected.capability_id
    where capability.capability_id is null or not capability.active
  ) then
    raise exception 'GERENCIA_GENERAL_UNKNOWN_OR_INACTIVE_CAPABILITY';
  end if;

  if exists (
    select capability_id
    from pg_temp.gerencia_general_expected_capabilities
    except
    select distinct capability_id
    from public.erp_security_profile_capabilities
    where profile_id <> 'GERENCIA_GENERAL'
  ) or exists (
    select distinct capability_id
    from public.erp_security_profile_capabilities
    where profile_id <> 'GERENCIA_GENERAL'
    except
    select capability_id
    from pg_temp.gerencia_general_expected_capabilities
  ) then
    raise exception 'GERENCIA_GENERAL_EXPLICIT_MATRIX_DRIFT';
  end if;

  if exists (
    select 1
    from pg_temp.gerencia_general_expected_capabilities expected
    join pg_temp.gerencia_general_base_denied denied using(capability_id)
  ) then
    raise exception 'GERENCIA_GENERAL_BASE_DENIED_GRANT_FORBIDDEN';
  end if;

  if exists (
    select 1
    from pg_temp.gerencia_general_expected_capabilities
    where capability_id like '%*%'
  ) then
    raise exception 'GERENCIA_GENERAL_WILDCARD_FORBIDDEN';
  end if;
end;
$$;

insert into public.erp_security_profiles(
  profile_id,
  display_name,
  description,
  active,
  system_defined
)
values (
  'GERENCIA_GENERAL',
  'Gerencia General',
  'Gerencia funcional completa de la empresa mediante permisos explícitos, sin acceso automático a capabilities base-denied.',
  true,
  true
)
on conflict(profile_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  active = true,
  system_defined = true,
  updated_at = clock_timestamp();

do $$
begin
  if exists (
    select 1
    from public.erp_security_profile_capabilities existing
    where existing.profile_id = 'GERENCIA_GENERAL'
      and not exists (
        select 1
        from pg_temp.gerencia_general_expected_capabilities expected
        where expected.capability_id = existing.capability_id
      )
  ) then
    raise exception 'GERENCIA_GENERAL_UNEXPECTED_EXISTING_GRANT';
  end if;
end;
$$;

insert into public.erp_security_profile_capabilities(profile_id, capability_id)
select 'GERENCIA_GENERAL', expected.capability_id
from pg_temp.gerencia_general_expected_capabilities expected
on conflict(profile_id, capability_id) do nothing;

do $$
declare
  v_actual integer;
  v_base_denied_granted integer;
  v_admin_grants integer;
begin
  select count(*) into v_actual
  from public.erp_security_profile_capabilities
  where profile_id = 'GERENCIA_GENERAL';

  select count(*) into v_base_denied_granted
  from public.erp_security_profile_capabilities profile_capability
  join pg_temp.gerencia_general_base_denied denied using(capability_id)
  where profile_capability.profile_id = 'GERENCIA_GENERAL';

  select count(*) into v_admin_grants
  from public.erp_security_profile_capabilities
  where profile_id = 'ADMINISTRADOR_ERP';

  if v_actual <> 173 then
    raise exception 'GERENCIA_GENERAL_FINAL_GRANT_COUNT_MISMATCH: %', v_actual;
  end if;

  if v_base_denied_granted <> 0 then
    raise exception 'GERENCIA_GENERAL_FINAL_BASE_DENIED_GRANT_MISMATCH: %', v_base_denied_granted;
  end if;

  if v_admin_grants <> 15 then
    raise exception 'GERENCIA_GENERAL_ADMINISTRADOR_ERP_REGRESSION: %', v_admin_grants;
  end if;

  if exists (
    select 1
    from pg_temp.gerencia_general_existing_profile_grants before_grants
    full join (
      select
        pc.profile_id,
        count(*)::integer as grant_count,
        md5(string_agg(pc.capability_id, E'\n' order by pc.capability_id)) as grant_fingerprint
      from public.erp_security_profile_capabilities pc
      where pc.profile_id <> 'GERENCIA_GENERAL'
      group by pc.profile_id
    ) after_grants using(profile_id)
    where before_grants.profile_id is null
       or after_grants.profile_id is null
       or before_grants.grant_count <> after_grants.grant_count
       or before_grants.grant_fingerprint <> after_grants.grant_fingerprint
  ) then
    raise exception 'GERENCIA_GENERAL_EXISTING_PROFILE_REGRESSION';
  end if;
end;
$$;

commit;
