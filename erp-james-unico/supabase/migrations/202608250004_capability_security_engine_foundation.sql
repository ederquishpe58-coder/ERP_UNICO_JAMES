-- U2C1: additive capability security engine foundation.
--
-- This migration deliberately does NOT enforce capabilities on menus, routes,
-- domain loaders, repositories, business read models, Realtime, or mutating
-- business RPCs. Existing route, payroll and SRI permission models coexist.

begin;

do $$
declare
  v_relation text;
  v_function text;
begin
  foreach v_relation in array array[
    'erp_security_capabilities',
    'erp_security_profiles',
    'erp_security_profile_capabilities',
    'erp_security_user_company_profiles',
    'erp_security_user_capability_overrides',
    'erp_security_engine_state',
    'erp_security_permission_versions'
  ] loop
    if to_regclass('public.' || v_relation) is not null then
      raise exception 'U2C1_RELATION_ALREADY_EXISTS: %', v_relation;
    end if;
  end loop;

  foreach v_function in array array[
    'erp_security_get_effective_capabilities(uuid)',
    'erp_security_has_capability(uuid,text)',
    'erp_security_assert_capability(uuid,text)',
    'erp_security_get_permission_version(uuid)'
  ] loop
    if to_regprocedure('public.' || v_function) is not null then
      raise exception 'U2C1_FUNCTION_ALREADY_EXISTS: %', v_function;
    end if;
  end loop;

  if to_regclass('public.companies') is null
     or to_regclass('public.user_profiles') is null
     or to_regclass('public.user_company_memberships') is null
     or to_regprocedure('public.erp_u2a_assert_company_read_access(uuid)') is null then
    raise exception 'U2C1_REQUIRED_ACCESS_FOUNDATION_MISSING';
  end if;
end;
$$;

create table public.erp_security_capabilities (
  capability_id text primary key,
  module text not null,
  resource text not null,
  action text not null,
  risk_level text not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint erp_security_capability_id_format check (
    capability_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$'
    and capability_id !~ '[*]'
  ),
  constraint erp_security_capability_parts check (
    capability_id = module || '.' || resource || '.' || action
  ),
  constraint erp_security_capability_module_format check (module ~ '^[a-z][a-z0-9_]*$'),
  constraint erp_security_capability_resource_format check (resource ~ '^[a-z][a-z0-9_]*$'),
  constraint erp_security_capability_action_format check (action ~ '^[a-z][a-z0-9_]*$'),
  constraint erp_security_capability_risk check (
    risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  ),
  constraint erp_security_capability_description_not_blank check (btrim(description) <> '')
);

create table public.erp_security_profiles (
  profile_id text primary key,
  display_name text not null,
  description text not null,
  active boolean not null default true,
  system_defined boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint erp_security_profile_id_format check (profile_id ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint erp_security_profile_display_not_blank check (btrim(display_name) <> ''),
  constraint erp_security_profile_description_not_blank check (btrim(description) <> '')
);

create table public.erp_security_profile_capabilities (
  profile_id text not null references public.erp_security_profiles(profile_id) on delete cascade,
  capability_id text not null references public.erp_security_capabilities(capability_id) on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default clock_timestamp(),
  primary key (profile_id, capability_id)
);

create table public.erp_security_user_company_profiles (
  company_id uuid not null,
  user_id uuid not null,
  profile_id text not null references public.erp_security_profiles(profile_id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_id, user_id),
  constraint erp_security_user_company_profile_membership_fk
    foreign key (company_id, user_id)
    references public.user_company_memberships(company_id, user_id)
    on delete cascade
);

create table public.erp_security_user_capability_overrides (
  company_id uuid not null,
  user_id uuid not null,
  capability_id text not null references public.erp_security_capabilities(capability_id) on delete restrict,
  effect text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default clock_timestamp(),
  primary key (company_id, user_id, capability_id),
  constraint erp_security_override_membership_fk
    foreign key (company_id, user_id)
    references public.user_company_memberships(company_id, user_id)
    on delete cascade,
  constraint erp_security_override_effect check (effect in ('GRANT', 'DENY')),
  constraint erp_security_override_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint erp_security_override_reason_not_blank check (reason is null or btrim(reason) <> '')
);

create table public.erp_security_engine_state (
  singleton_key text primary key default 'GLOBAL',
  catalog_version bigint not null default 1 check (catalog_version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  constraint erp_security_engine_singleton check (singleton_key = 'GLOBAL')
);

create table public.erp_security_permission_versions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  permissions_version bigint not null default 1 check (permissions_version > 0),
  updated_at timestamptz not null default clock_timestamp()
);

create index erp_security_capabilities_module_resource_idx
  on public.erp_security_capabilities(module, resource, action)
  where active;
create index erp_security_profile_capabilities_capability_idx
  on public.erp_security_profile_capabilities(capability_id, profile_id);
create index erp_security_user_profiles_profile_idx
  on public.erp_security_user_company_profiles(profile_id, company_id);
create index erp_security_user_overrides_user_idx
  on public.erp_security_user_capability_overrides(user_id, company_id, effect);

comment on table public.erp_security_capabilities is
  'U2C1 exact capability catalog. Wildcards and implicit all-access entries are forbidden.';
comment on table public.erp_security_profiles is
  'U2C1 base security profiles. Membership roles remain separate from functional capabilities.';
comment on table public.erp_security_profile_capabilities is
  'Explicit default grants only. Missing capability means default deny.';
comment on table public.erp_security_user_company_profiles is
  'One base profile per user and company. No global functional role is stored on user_profiles.';
comment on table public.erp_security_user_capability_overrides is
  'Exact user/company GRANT or DENY override. The primary key forbids contradictory effective rows.';
comment on table public.erp_security_engine_state is
  'Global catalog/profile version for future bounded capability-cache invalidation.';
comment on table public.erp_security_permission_versions is
  'Company-scoped permission version. It never authorizes access by itself.';

with capability_families(module, resource, actions) as (
  values
    ('core','dashboard','{"view":"LOW"}'::jsonb),
    ('admin','diagnostics','{"view":"MEDIUM"}'::jsonb),
    ('admin','company_state','{"view":"LOW","edit":"HIGH"}'::jsonb),
    ('operations','dashboard','{"view":"LOW"}'::jsonb),
    ('operations','parameters','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('operations','reception','{"view":"LOW","create":"MEDIUM","edit":"MEDIUM","cancel":"HIGH"}'::jsonb),
    ('operations','classification','{"view":"LOW","record":"MEDIUM","edit":"MEDIUM"}'::jsonb),
    ('operations','labels','{"view":"LOW","create":"MEDIUM","reprint":"MEDIUM"}'::jsonb),
    ('operations','bunch_intake','{"view":"LOW","receive":"HIGH","reassign":"HIGH"}'::jsonb),
    ('operations','destination_orders','{"confirm":"HIGH"}'::jsonb),
    ('operations','boxes','{"create":"HIGH","scan":"HIGH","close":"HIGH","reopen":"HIGH","unassign":"HIGH","release_order":"CRITICAL","cancel_order":"CRITICAL"}'::jsonb),
    ('operations','inventory','{"view":"LOW"}'::jsonb),
    ('operations','availability','{"view":"LOW"}'::jsonb),
    ('operations','yields','{"view":"LOW"}'::jsonb),
    ('operations','cold_room','{"view":"LOW","prepare":"HIGH","confirm_dispatch":"CRITICAL"}'::jsonb),
    ('commercial','dashboard','{"view":"LOW"}'::jsonb),
    ('commercial','orders','{"view":"LOW","create":"MEDIUM","edit":"MEDIUM","cancel":"HIGH"}'::jsonb),
    ('commercial','coordination','{"view":"LOW","edit":"MEDIUM"}'::jsonb),
    ('commercial','preorders','{"view":"LOW","create":"MEDIUM","edit":"MEDIUM","cancel":"HIGH"}'::jsonb),
    ('commercial','availability','{"view":"LOW","reserve":"HIGH","release":"HIGH"}'::jsonb),
    ('commercial','customers','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','brands','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','cargo_agencies','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','countries','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','daes','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('commercial','airlines','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','export_products','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','box_types','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('commercial','exports','{"view":"LOW","create":"HIGH","edit":"HIGH","transition":"HIGH"}'::jsonb),
    ('commercial','senae_liquidation','{"view":"LOW","generate":"CRITICAL"}'::jsonb),
    ('commercial','credit_notes','{"view":"LOW","create":"HIGH","post":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('commercial','electronic_documents','{"view":"LOW","create":"CRITICAL","authorize":"CRITICAL","correct":"CRITICAL","annul":"CRITICAL"}'::jsonb),
    ('commercial','route_sheet','{"print":"MEDIUM"}'::jsonb),
    ('payroll','employees','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('payroll','roles','{"view":"LOW","calculate":"HIGH","approve":"CRITICAL","post":"CRITICAL","print":"MEDIUM"}'::jsonb),
    ('payroll','performance_policies','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('payroll','accounting_settings','{"view":"LOW","manage":"CRITICAL"}'::jsonb),
    ('accounting','chart','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('accounting','sales','{"view":"LOW","post":"CRITICAL"}'::jsonb),
    ('accounting','journal','{"view":"LOW","post":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('accounting','ledger','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('accounting','financial_statements','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('accounting','costs','{"record":"HIGH"}'::jsonb),
    ('accounting','shipment_expenses','{"record":"HIGH"}'::jsonb),
    ('purchases','documents','{"view":"LOW","import":"MEDIUM","create":"MEDIUM","post":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('purchases','providers','{"view":"LOW","manage":"MEDIUM"}'::jsonb),
    ('purchases','settlements','{"view":"LOW","create":"HIGH","reverse":"HIGH"}'::jsonb),
    ('purchases','withholdings','{"view":"LOW","create":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('purchases','retention_report','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('purchases','tax_supports','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('portfolio','suppliers','{"view":"LOW"}'::jsonb),
    ('portfolio','customers','{"view":"LOW"}'::jsonb),
    ('portfolio','payables','{"view":"LOW"}'::jsonb),
    ('portfolio','receivables','{"view":"LOW"}'::jsonb),
    ('treasury','payments','{"view":"LOW","create":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('treasury','collections','{"view":"LOW","create":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('treasury','accounts','{"view":"LOW","manage":"CRITICAL"}'::jsonb),
    ('treasury','movements','{"view":"LOW","create":"HIGH","adjust":"HIGH","reverse":"CRITICAL"}'::jsonb),
    ('treasury','reconciliation','{"view":"LOW","import":"HIGH","save":"HIGH","execute":"CRITICAL","review":"HIGH","reverse":"CRITICAL","set_status":"HIGH"}'::jsonb),
    ('treasury','cash_accounts','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('treasury','transfers','{"view":"LOW","create":"CRITICAL"}'::jsonb),
    ('treasury','cash_flow','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('tax','parameters','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('tax','retention_parameters','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('tax','received_withholdings','{"view":"LOW","import":"HIGH"}'::jsonb),
    ('tax','ats','{"view":"LOW","generate":"CRITICAL","export":"HIGH"}'::jsonb),
    ('inventory','summary','{"view":"LOW"}'::jsonb),
    ('inventory','purchase_entries','{"view":"LOW"}'::jsonb),
    ('inventory','kardex','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('inventory','consumptions','{"view":"LOW","create":"HIGH","reverse":"HIGH"}'::jsonb),
    ('inventory','adjustments','{"view":"LOW","create":"HIGH","approve":"CRITICAL","reverse":"CRITICAL"}'::jsonb),
    ('reports','dashboard','{"view":"LOW"}'::jsonb),
    ('reports','accounting','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','tax','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','portfolio','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','banks','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','inventory','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('reports','commercial','{"view":"LOW","export":"MEDIUM"}'::jsonb),
    ('admin','company','{"view":"LOW","manage":"CRITICAL"}'::jsonb),
    ('admin','users','{"view":"HIGH","manage":"CRITICAL"}'::jsonb),
    ('admin','audit','{"view":"HIGH","export":"HIGH"}'::jsonb),
    ('admin','sequences','{"view":"HIGH","manage":"CRITICAL"}'::jsonb),
    ('admin','cost_centers','{"view":"LOW","manage":"HIGH"}'::jsonb),
    ('admin','synchronization','{"view":"HIGH","manage":"CRITICAL"}'::jsonb)
)
insert into public.erp_security_capabilities(
  capability_id, module, resource, action, risk_level, description
)
select
  f.module || '.' || f.resource || '.' || action_entry.key,
  f.module,
  f.resource,
  action_entry.key,
  action_entry.value,
  'U2B2 capability: ' || f.module || '.' || f.resource || '.' || action_entry.key
from capability_families f
cross join lateral jsonb_each_text(f.actions) action_entry;

insert into public.erp_security_profiles(profile_id, display_name, description)
values
  ('DIRECCION','Dirección','Visión ejecutiva principalmente de lectura, reportes y exportación.'),
  ('COMERCIAL','Comercial','Gestión comercial operativa con privilegio mínimo.'),
  ('COORDINACION','Coordinación','Coordinación logística y exportadora, separada de autorización tributaria.'),
  ('RECEPCION','Recepción','Recepción operativa de flor.'),
  ('CLASIFICACION','Clasificación','Clasificación y rendimiento operativo.'),
  ('EMBONCHE_ZEBRA','Embonche / Zebra','Embonche, etiquetas Zebra e ingreso operativo.'),
  ('BODEGA_CUARTO_FRIO','Bodega / Cuarto frío','Preparación de bodega y cuarto frío.'),
  ('DESPACHO','Despacho','Confirmación controlada de despacho y lectura relacionada.'),
  ('COMPRAS','Compras','Documentos de compra y proveedores, sin pagos implícitos.'),
  ('CONTABILIDAD','Contabilidad','Contabilización, libros y reportes contables.'),
  ('FINANZAS_TREASURY','Finanzas / Treasury','Pagos, cobros, bancos, transferencias y conciliación.'),
  ('TRIBUTACION_SRI','Tributación / SRI','Documentos electrónicos y obligaciones tributarias.'),
  ('INVENTARIO_MATERIALES','Inventario de materiales','Kárdex, consumos y ajustes administrativos.'),
  ('NOMINA','Nómina','Nómina con coexistencia del guard probado actual.'),
  ('ADMINISTRADOR_ERP','Administrador ERP','Administración técnica sin privilegios financieros implícitos.'),
  ('AUDITORIA_SOPORTE','Auditoría / Soporte','Lectura, diagnóstico y exportación sin mutaciones de negocio.');

create temporary table u2c1_profile_grants (
  profile_id text not null,
  capability_id text not null,
  primary key(profile_id, capability_id)
) on commit drop;

-- DIRECCION: broad read/report visibility, excluding technical and payroll-maintenance details.
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'DIRECCION', capability_id
from public.erp_security_capabilities
where action = 'view'
  and capability_id !~ '^(admin\.(diagnostics|company_state|company|users|sequences|cost_centers|synchronization)|payroll\.(employees|performance_policies|accounting_settings))\.';
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'DIRECCION', unnest(array[
  'reports.accounting.export','reports.tax.export','reports.portfolio.export',
  'reports.banks.export','reports.inventory.export','reports.commercial.export',
  'accounting.ledger.export','accounting.financial_statements.export',
  'purchases.retention_report.export','treasury.cash_flow.export','tax.ats.export',
  'inventory.kardex.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'COMERCIAL', unnest(array[
  'core.dashboard.view','commercial.dashboard.view','commercial.orders.view',
  'commercial.orders.create','commercial.orders.edit','commercial.preorders.view',
  'commercial.preorders.create','commercial.preorders.edit','commercial.availability.view',
  'commercial.availability.reserve','commercial.availability.release','commercial.customers.view',
  'commercial.customers.manage','commercial.brands.view','commercial.brands.manage',
  'commercial.cargo_agencies.view','commercial.countries.view','commercial.daes.view',
  'commercial.airlines.view','commercial.export_products.view','commercial.box_types.view',
  'commercial.exports.view','operations.availability.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'COORDINACION', unnest(array[
  'core.dashboard.view','commercial.dashboard.view','commercial.orders.view',
  'commercial.coordination.view','commercial.coordination.edit','commercial.preorders.view',
  'commercial.availability.view','commercial.customers.view','commercial.brands.view',
  'commercial.cargo_agencies.view','commercial.cargo_agencies.manage','commercial.countries.view',
  'commercial.countries.manage','commercial.daes.view','commercial.daes.manage',
  'commercial.airlines.view','commercial.airlines.manage','commercial.export_products.view',
  'commercial.box_types.view','commercial.exports.view','commercial.exports.create',
  'commercial.exports.edit','commercial.exports.transition','commercial.route_sheet.print',
  'operations.availability.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'RECEPCION', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.reception.view','operations.reception.create','operations.reception.edit',
  'operations.yields.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'CLASIFICACION', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.reception.view','operations.classification.view','operations.classification.record',
  'operations.classification.edit','operations.yields.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'EMBONCHE_ZEBRA', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.labels.view','operations.labels.create','operations.labels.reprint',
  'operations.bunch_intake.view','operations.bunch_intake.receive',
  'operations.bunch_intake.reassign','operations.inventory.view','operations.availability.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'BODEGA_CUARTO_FRIO', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.parameters.view',
  'operations.labels.view','operations.bunch_intake.view','operations.inventory.view',
  'operations.availability.view','operations.cold_room.view','operations.cold_room.prepare',
  'operations.destination_orders.confirm','operations.boxes.create','operations.boxes.scan',
  'operations.boxes.close','operations.boxes.reopen','operations.boxes.unassign',
  'operations.boxes.release_order','commercial.orders.view','commercial.availability.view',
  'commercial.availability.reserve'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'DESPACHO', unnest(array[
  'core.dashboard.view','operations.dashboard.view','operations.inventory.view',
  'operations.availability.view','operations.cold_room.view','operations.cold_room.prepare',
  'operations.cold_room.confirm_dispatch','commercial.orders.view',
  'commercial.coordination.view','commercial.exports.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'COMPRAS', unnest(array[
  'core.dashboard.view','purchases.documents.view','purchases.documents.import',
  'purchases.documents.create','purchases.documents.post','purchases.providers.view',
  'purchases.providers.manage','purchases.settlements.view','purchases.settlements.create',
  'purchases.withholdings.view','purchases.withholdings.create',
  'purchases.retention_report.view','purchases.retention_report.export',
  'purchases.tax_supports.view','portfolio.suppliers.view','portfolio.payables.view',
  'inventory.purchase_entries.view','reports.portfolio.view','reports.tax.view'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'CONTABILIDAD', unnest(array[
  'core.dashboard.view','accounting.chart.view','accounting.chart.manage',
  'accounting.sales.view','accounting.sales.post','accounting.journal.view',
  'accounting.journal.post','accounting.ledger.view','accounting.ledger.export',
  'accounting.financial_statements.view','accounting.financial_statements.export',
  'accounting.costs.record','accounting.shipment_expenses.record','purchases.documents.view',
  'purchases.withholdings.view','purchases.retention_report.view',
  'purchases.retention_report.export','portfolio.suppliers.view','portfolio.customers.view',
  'portfolio.payables.view','portfolio.receivables.view','treasury.payments.view',
  'treasury.collections.view','tax.received_withholdings.view','tax.ats.view',
  'reports.dashboard.view','reports.accounting.view','reports.accounting.export',
  'reports.tax.view','reports.tax.export','reports.portfolio.view','reports.portfolio.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'FINANZAS_TREASURY', unnest(array[
  'core.dashboard.view','portfolio.suppliers.view','portfolio.customers.view',
  'portfolio.payables.view','portfolio.receivables.view','treasury.payments.view',
  'treasury.payments.create','treasury.collections.view','treasury.collections.create',
  'treasury.accounts.view','treasury.accounts.manage','treasury.movements.view',
  'treasury.movements.create','treasury.movements.adjust','treasury.reconciliation.view',
  'treasury.reconciliation.import','treasury.reconciliation.save',
  'treasury.reconciliation.execute','treasury.reconciliation.review',
  'treasury.reconciliation.set_status','treasury.cash_accounts.view',
  'treasury.cash_accounts.manage','treasury.transfers.view','treasury.transfers.create',
  'treasury.cash_flow.view','treasury.cash_flow.export','accounting.journal.view',
  'accounting.ledger.view','reports.dashboard.view','reports.portfolio.view',
  'reports.portfolio.export','reports.banks.view','reports.banks.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'TRIBUTACION_SRI', unnest(array[
  'core.dashboard.view','commercial.orders.view','commercial.credit_notes.view',
  'commercial.credit_notes.create','commercial.credit_notes.post',
  'commercial.electronic_documents.view','commercial.electronic_documents.create',
  'commercial.electronic_documents.authorize','commercial.electronic_documents.correct',
  'commercial.senae_liquidation.view','commercial.senae_liquidation.generate',
  'purchases.documents.view','purchases.withholdings.view','purchases.withholdings.create',
  'purchases.retention_report.view','purchases.retention_report.export','tax.parameters.view',
  'tax.parameters.manage','tax.retention_parameters.view','tax.retention_parameters.manage',
  'tax.received_withholdings.view','tax.received_withholdings.import','tax.ats.view',
  'tax.ats.generate','tax.ats.export','accounting.sales.view','accounting.journal.view',
  'reports.tax.view','reports.tax.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'INVENTARIO_MATERIALES', unnest(array[
  'core.dashboard.view','inventory.summary.view','inventory.purchase_entries.view',
  'inventory.kardex.view','inventory.kardex.export','inventory.consumptions.view',
  'inventory.consumptions.create','inventory.adjustments.view',
  'inventory.adjustments.create','reports.inventory.view','reports.inventory.export'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'NOMINA', unnest(array[
  'core.dashboard.view','payroll.employees.view','payroll.employees.manage',
  'payroll.roles.view','payroll.roles.calculate','payroll.roles.approve',
  'payroll.roles.post','payroll.roles.print','payroll.performance_policies.view',
  'payroll.performance_policies.manage','payroll.accounting_settings.view',
  'payroll.accounting_settings.manage'
]);

insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'ADMINISTRADOR_ERP', unnest(array[
  'core.dashboard.view','admin.diagnostics.view','admin.company_state.view',
  'admin.company_state.edit','admin.company.view','admin.company.manage',
  'admin.users.view','admin.users.manage','admin.audit.view','admin.audit.export',
  'admin.sequences.view','admin.cost_centers.view','admin.cost_centers.manage',
  'admin.synchronization.view','admin.synchronization.manage'
]);

-- AUDITORIA_SOPORTE: read/diagnostic/export only; no business mutations.
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'AUDITORIA_SOPORTE', capability_id
from public.erp_security_capabilities
where action = 'view'
  and capability_id !~ '^(admin\.(company_state|company|sequences|cost_centers|synchronization)|payroll\.(employees|performance_policies|accounting_settings))\.';
insert into pg_temp.u2c1_profile_grants(profile_id, capability_id)
select 'AUDITORIA_SOPORTE', unnest(array[
  'admin.audit.export','reports.accounting.export','reports.tax.export',
  'reports.portfolio.export','reports.banks.export','reports.inventory.export',
  'reports.commercial.export','accounting.ledger.export',
  'accounting.financial_statements.export','purchases.retention_report.export',
  'treasury.cash_flow.export','tax.ats.export','inventory.kardex.export'
]);

do $$
declare
  v_capabilities integer;
  v_views integer;
  v_actions integer;
  v_high_critical integer;
  v_profiles integer;
  v_wildcards integer;
  v_sensitive_grants integer;
  v_bad_profile text;
begin
  select count(*), count(*) filter(where action = 'view'), count(*) filter(where action <> 'view'),
         count(*) filter(where risk_level in ('HIGH','CRITICAL'))
  into v_capabilities, v_views, v_actions, v_high_critical
  from public.erp_security_capabilities;
  select count(*) into v_profiles from public.erp_security_profiles;
  select count(*) into v_wildcards from public.erp_security_capabilities where capability_id like '%*%';

  if (v_capabilities, v_views, v_actions, v_high_critical, v_profiles, v_wildcards)
     <> (195, 79, 116, 85, 16, 0) then
    raise exception 'U2C1_CATALOG_MATRIX_MISMATCH: capabilities=%, views=%, actions=%, high_critical=%, profiles=%, wildcards=%',
      v_capabilities, v_views, v_actions, v_high_critical, v_profiles, v_wildcards;
  end if;

  select count(*) into v_sensitive_grants
  from pg_temp.u2c1_profile_grants
  where capability_id = any(array[
    'operations.parameters.manage','operations.reception.cancel','operations.boxes.cancel_order',
    'commercial.orders.cancel','commercial.preorders.cancel','commercial.export_products.manage',
    'commercial.box_types.manage','commercial.credit_notes.reverse',
    'commercial.electronic_documents.annul','accounting.journal.reverse',
    'purchases.documents.reverse','purchases.settlements.reverse',
    'purchases.withholdings.reverse','purchases.tax_supports.manage',
    'treasury.payments.reverse','treasury.collections.reverse','treasury.movements.reverse',
    'treasury.reconciliation.reverse','inventory.consumptions.reverse',
    'inventory.adjustments.approve','inventory.adjustments.reverse','admin.sequences.manage'
  ]);
  if v_sensitive_grants <> 0 then
    raise exception 'U2C1_SENSITIVE_BASE_GRANT_MISMATCH: %', v_sensitive_grants;
  end if;

  with expected(profile_id, grant_count) as (
    values
      ('DIRECCION',81),('COMERCIAL',23),('COORDINACION',25),('RECEPCION',7),
      ('CLASIFICACION',8),('EMBONCHE_ZEBRA',11),('BODEGA_CUARTO_FRIO',19),
      ('DESPACHO',10),('COMPRAS',19),('CONTABILIDAD',32),('FINANZAS_TREASURY',33),
      ('TRIBUTACION_SRI',29),('INVENTARIO_MATERIALES',11),('NOMINA',12),
      ('ADMINISTRADOR_ERP',15),('AUDITORIA_SOPORTE',84)
  ), actual as (
    select profile_id, count(*)::integer grant_count
    from pg_temp.u2c1_profile_grants
    group by profile_id
  )
  select expected.profile_id into v_bad_profile
  from expected
  left join actual using(profile_id)
  where coalesce(actual.grant_count, -1) <> expected.grant_count
  limit 1;
  if v_bad_profile is not null then
    raise exception 'U2C1_PROFILE_GRANT_COUNT_MISMATCH: %', v_bad_profile;
  end if;

  if exists (
    select 1 from pg_temp.u2c1_profile_grants g
    left join public.erp_security_profiles p using(profile_id)
    left join public.erp_security_capabilities c using(capability_id)
    where p.profile_id is null or c.capability_id is null or not c.active
  ) then
    raise exception 'U2C1_UNKNOWN_OR_INACTIVE_GRANT';
  end if;
end;
$$;

insert into public.erp_security_profile_capabilities(profile_id, capability_id)
select profile_id, capability_id
from pg_temp.u2c1_profile_grants;

insert into public.erp_security_engine_state(singleton_key, catalog_version)
values ('GLOBAL', 1);
insert into public.erp_security_permission_versions(company_id, permissions_version)
select id, 1 from public.companies;

create or replace function public.erp_security_validate_profile_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.erp_security_profiles p
    where p.profile_id = new.profile_id and p.active
  ) then
    raise exception using errcode = '23514', message = 'ACTIVE_SECURITY_PROFILE_REQUIRED';
  end if;
  new.assigned_at := case when tg_op = 'INSERT' then clock_timestamp() else old.assigned_at end;
  new.updated_at := clock_timestamp();
  if auth.uid() is not null then
    new.assigned_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.erp_security_validate_override()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_risk text;
begin
  select risk_level into v_risk
  from public.erp_security_capabilities
  where capability_id = new.capability_id and active;
  if v_risk is null then
    raise exception using errcode = '23514', message = 'ACTIVE_CAPABILITY_REQUIRED';
  end if;
  if v_risk in ('HIGH','CRITICAL') and coalesce(btrim(new.reason), '') = '' then
    raise exception using errcode = '23514', message = 'SECURITY_OVERRIDE_REASON_REQUIRED';
  end if;
  new.changed_at := clock_timestamp();
  if auth.uid() is not null then
    new.changed_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.erp_security_bump_company_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_company uuid;
  v_new_company uuid;
begin
  if tg_op <> 'INSERT' then v_old_company := old.company_id; end if;
  if tg_op <> 'DELETE' then v_new_company := new.company_id; end if;
  if v_old_company is not null then
    insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
    values(v_old_company, 1, clock_timestamp())
    on conflict(company_id) do update
      set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
          updated_at = clock_timestamp();
  end if;
  if v_new_company is not null and v_new_company is distinct from v_old_company then
    insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
    values(v_new_company, 1, clock_timestamp())
    on conflict(company_id) do update
      set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
          updated_at = clock_timestamp();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.erp_security_bump_company_row_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if tg_op = 'DELETE' then
    v_company_id := old.id;
  else
    v_company_id := new.id;
  end if;
  insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
  values(v_company_id, 1, clock_timestamp())
  on conflict(company_id) do update
    set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
        updated_at = clock_timestamp();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.erp_security_bump_user_profile_versions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;
  insert into public.erp_security_permission_versions(company_id, permissions_version, updated_at)
  select m.company_id, 1, clock_timestamp()
  from public.user_company_memberships m
  where m.user_id = v_user_id
  on conflict(company_id) do update
    set permissions_version = public.erp_security_permission_versions.permissions_version + 1,
        updated_at = clock_timestamp();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.erp_security_bump_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.erp_security_engine_state
  set catalog_version = catalog_version + 1,
      updated_at = clock_timestamp()
  where singleton_key = 'GLOBAL';
  return null;
end;
$$;

create trigger erp_security_user_profile_validate
before insert or update on public.erp_security_user_company_profiles
for each row execute function public.erp_security_validate_profile_assignment();
create trigger erp_security_override_validate
before insert or update on public.erp_security_user_capability_overrides
for each row execute function public.erp_security_validate_override();

create trigger erp_security_user_profile_version
after insert or update or delete on public.erp_security_user_company_profiles
for each row execute function public.erp_security_bump_company_version();
create trigger erp_security_override_version
after insert or update or delete on public.erp_security_user_capability_overrides
for each row execute function public.erp_security_bump_company_version();
create trigger erp_security_membership_version
after insert or update or delete on public.user_company_memberships
for each row execute function public.erp_security_bump_company_version();
create trigger erp_security_company_active_version
after update of is_active on public.companies
for each row execute function public.erp_security_bump_company_row_version();
create trigger erp_security_user_active_version
after update of is_active on public.user_profiles
for each row execute function public.erp_security_bump_user_profile_versions();

create trigger erp_security_capability_catalog_version
after insert or update or delete on public.erp_security_capabilities
for each statement execute function public.erp_security_bump_catalog_version();
create trigger erp_security_profiles_catalog_version
after insert or update or delete on public.erp_security_profiles
for each statement execute function public.erp_security_bump_catalog_version();
create trigger erp_security_profile_grants_catalog_version
after insert or update or delete on public.erp_security_profile_capabilities
for each statement execute function public.erp_security_bump_catalog_version();

create or replace function public.erp_security_get_effective_capabilities(p_company_id uuid)
returns table(
  capability_id text,
  module text,
  resource text,
  action text,
  risk_level text,
  description text,
  permission_source text,
  catalog_version bigint,
  company_version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_assigned_profile text;
  v_assigned_profile_active boolean;
begin
  v_actor := public.erp_u2a_assert_company_read_access(p_company_id);

  select ucp.profile_id, p.active
  into v_assigned_profile, v_assigned_profile_active
  from public.erp_security_user_company_profiles ucp
  join public.erp_security_profiles p on p.profile_id = ucp.profile_id
  where ucp.company_id = p_company_id
    and ucp.user_id = v_actor;

  -- An explicitly assigned but inactive profile is an absolute deny.
  if v_assigned_profile is not null and not coalesce(v_assigned_profile_active, false) then
    return;
  end if;

  return query
  with profile_allowed as (
    select pc.capability_id, 1 as source_priority, 'PROFILE'::text as source_name
    from public.erp_security_profile_capabilities pc
    where pc.profile_id = v_assigned_profile
  ), user_allowed as (
    select o.capability_id, 2 as source_priority, 'USER_GRANT'::text as source_name
    from public.erp_security_user_capability_overrides o
    where o.company_id = p_company_id
      and o.user_id = v_actor
      and o.effect = 'GRANT'
  ), candidates as (
    select * from profile_allowed
    union all
    select * from user_allowed
  ), selected as (
    select distinct on (candidate.capability_id)
      candidate.capability_id,
      candidate.source_name
    from candidates candidate
    where not exists (
      select 1
      from public.erp_security_user_capability_overrides denied
      where denied.company_id = p_company_id
        and denied.user_id = v_actor
        and denied.capability_id = candidate.capability_id
        and denied.effect = 'DENY'
    )
    order by candidate.capability_id, candidate.source_priority desc
  )
  select
    capability.capability_id,
    capability.module,
    capability.resource,
    capability.action,
    capability.risk_level,
    capability.description,
    selected.source_name,
    engine.catalog_version,
    coalesce(company_version.permissions_version, 1)
  from selected
  join public.erp_security_capabilities capability
    on capability.capability_id = selected.capability_id
   and capability.active
  cross join public.erp_security_engine_state engine
  left join public.erp_security_permission_versions company_version
    on company_version.company_id = p_company_id
  where engine.singleton_key = 'GLOBAL'
  order by capability.capability_id;
end;
$$;

create or replace function public.erp_security_has_capability(
  p_company_id uuid,
  p_capability_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null or p_capability_id is null or btrim(p_capability_id) = '' then
    return false;
  end if;
  return exists (
    select 1
    from public.erp_security_get_effective_capabilities(p_company_id) effective
    where effective.capability_id = p_capability_id
  );
exception
  when sqlstate '42501' or sqlstate '22023' then
    return false;
end;
$$;

create or replace function public.erp_security_assert_capability(
  p_company_id uuid,
  p_capability_id text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  if not exists (
    select 1 from public.erp_security_capabilities capability
    where capability.capability_id = p_capability_id and capability.active
  ) then
    raise exception using errcode = '42501', message = 'ACTIVE_CAPABILITY_REQUIRED';
  end if;
  if not public.erp_security_has_capability(p_company_id, p_capability_id) then
    raise exception using errcode = '42501', message = 'CAPABILITY_REQUIRED';
  end if;
end;
$$;

create or replace function public.erp_security_get_permission_version(p_company_id uuid)
returns table(catalog_version bigint, company_version bigint, security_token text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.erp_u2a_assert_company_read_access(p_company_id);
  return query
  select
    engine.catalog_version,
    coalesce(company_version.permissions_version, 1),
    engine.catalog_version::text || ':' || coalesce(company_version.permissions_version, 1)::text
  from public.erp_security_engine_state engine
  left join public.erp_security_permission_versions company_version
    on company_version.company_id = p_company_id
  where engine.singleton_key = 'GLOBAL';
end;
$$;

alter table public.erp_security_capabilities enable row level security;
alter table public.erp_security_capabilities force row level security;
alter table public.erp_security_profiles enable row level security;
alter table public.erp_security_profiles force row level security;
alter table public.erp_security_profile_capabilities enable row level security;
alter table public.erp_security_profile_capabilities force row level security;
alter table public.erp_security_user_company_profiles enable row level security;
alter table public.erp_security_user_company_profiles force row level security;
alter table public.erp_security_user_capability_overrides enable row level security;
alter table public.erp_security_user_capability_overrides force row level security;
alter table public.erp_security_engine_state enable row level security;
alter table public.erp_security_engine_state force row level security;
alter table public.erp_security_permission_versions enable row level security;
alter table public.erp_security_permission_versions force row level security;

revoke all on table public.erp_security_capabilities from public, anon, authenticated;
revoke all on table public.erp_security_profiles from public, anon, authenticated;
revoke all on table public.erp_security_profile_capabilities from public, anon, authenticated;
revoke all on table public.erp_security_user_company_profiles from public, anon, authenticated;
revoke all on table public.erp_security_user_capability_overrides from public, anon, authenticated;
revoke all on table public.erp_security_engine_state from public, anon, authenticated;
revoke all on table public.erp_security_permission_versions from public, anon, authenticated;

grant all on table public.erp_security_capabilities to service_role;
grant all on table public.erp_security_profiles to service_role;
grant all on table public.erp_security_profile_capabilities to service_role;
grant all on table public.erp_security_user_company_profiles to service_role;
grant all on table public.erp_security_user_capability_overrides to service_role;
grant all on table public.erp_security_engine_state to service_role;
grant all on table public.erp_security_permission_versions to service_role;

revoke all on function public.erp_security_validate_profile_assignment() from public, anon, authenticated, service_role;
revoke all on function public.erp_security_validate_override() from public, anon, authenticated, service_role;
revoke all on function public.erp_security_bump_company_version() from public, anon, authenticated, service_role;
revoke all on function public.erp_security_bump_company_row_version() from public, anon, authenticated, service_role;
revoke all on function public.erp_security_bump_user_profile_versions() from public, anon, authenticated, service_role;
revoke all on function public.erp_security_bump_catalog_version() from public, anon, authenticated, service_role;

revoke all on function public.erp_security_get_effective_capabilities(uuid) from public, anon, service_role;
revoke all on function public.erp_security_has_capability(uuid,text) from public, anon, service_role;
revoke all on function public.erp_security_assert_capability(uuid,text) from public, anon, service_role;
revoke all on function public.erp_security_get_permission_version(uuid) from public, anon, service_role;
grant execute on function public.erp_security_get_effective_capabilities(uuid) to authenticated;
grant execute on function public.erp_security_has_capability(uuid,text) to authenticated;
grant execute on function public.erp_security_assert_capability(uuid,text) to authenticated;
grant execute on function public.erp_security_get_permission_version(uuid) to authenticated;

comment on function public.erp_security_get_effective_capabilities(uuid) is
  'U2C1 canonical resolver: active auth/company/membership, profile grants plus exact user grants minus exact user denies.';
comment on function public.erp_security_has_capability(uuid,text) is
  'Read-only UX helper. Business RPCs must call erp_security_assert_capability at mutation time.';
comment on function public.erp_security_assert_capability(uuid,text) is
  'Fail-closed backend capability assertion. Unknown or inactive capabilities are denied.';
comment on function public.erp_security_get_permission_version(uuid) is
  'Company-scoped cache token. Domains remain data-loading boundaries and never become authorization authorities.';

do $$
begin
  if (select count(*) from public.erp_security_capabilities) <> 195
     or (select count(*) from public.erp_security_profiles) <> 16
     or (select count(*) from public.erp_security_profile_capabilities) <> 419
     or (select count(*) from public.erp_security_user_company_profiles) <> 0
     or (select count(*) from public.erp_security_user_capability_overrides) <> 0 then
    raise exception 'U2C1_POST_SEED_INVARIANT_FAILED';
  end if;
end;
$$;

commit;
