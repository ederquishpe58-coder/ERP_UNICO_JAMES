# TABLAS POR MODULO SUPABASE

## A. Core del sistema

- `companies`
- `users`
- `roles`
- `user_roles`
- `app_settings`
- `sequences`
- `audit_logs`
- `attachments` futuro opcional

## B. Comercial / Exportaciones

- `customers`
- `final_brands`
- `cargo_agencies`
- `airlines`
- `dae_records`
- `export_products`
- `commercial_orders`
- `commercial_order_boxes`
- `commercial_order_lines`
- `commercial_documents`
- `commercial_workflow_events`
- `commercial_reservations_link`
- `commercial_accounting_previews`

## C. Operaciones / Poscosecha

- `flower_receptions`
- `flower_classifications`
- `bunch_labels`
- `flower_inventory`
- `flower_availability`
- `flower_reservations`
- `operational_dispatches`
- `operational_dispatch_boxes`
- `scanner_events`
- `operational_consumptions`
- `operational_kardex`
- `performance_records`

## D. Inventario suministros / empaque

- `material_items`
- `material_warehouses`
- `material_stock`
- `material_movements`
- `packaging_rules`
- `packaging_requirements`
- `packaging_consumptions` futuro

## E. Contabilidad / Administracion

- `chart_of_accounts`
- `journal_entries`
- `journal_entry_lines`
- `suppliers`
- `purchases`
- `purchase_lines`
- `withholdings_issued`
- `withholdings_received`
- `cxp_documents`
- `cxp_payments`
- `customers_accounting` si se separa de `customers`
- `cxc_documents`
- `cxc_collections`
- `bank_accounts`
- `bank_movements`
- `bank_reconciliations`
- `tax_parameters`
- `ats_periods`

## F. Reportes

No crear tablas excesivas al inicio.

Reportes deben salir de vistas o consultas.

Opcional futuro:
- `report_snapshots`
- `dashboard_metrics_cache`
