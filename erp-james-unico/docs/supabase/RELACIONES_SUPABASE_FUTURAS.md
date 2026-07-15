# RELACIONES SUPABASE FUTURAS

## Core

- `users` pertenece a `companies` en escenario futuro multiempresa.
- `user_roles` relaciona `users` con `roles`.
- `audit_logs` registra acciones de usuarios.

## Comercial

- `customers` 1:N `final_brands`
- `customers` 1:N `commercial_orders`
- `final_brands` 1:N `commercial_orders`
- `commercial_orders` 1:N `commercial_order_boxes`
- `commercial_order_boxes` 1:N `commercial_order_lines`
- `commercial_orders` 1:N `commercial_documents`
- `commercial_orders` 1:N `commercial_workflow_events`
- `commercial_orders` N:M `flower_reservations` mediante `commercial_reservations_link`

## Operaciones

- `flower_inventory` 1:N `flower_availability`
- `flower_availability` 1:N `flower_reservations`
- `flower_reservations` puede vincularse a `commercial_orders`
- `operational_dispatches` pertenece a `commercial_orders`
- `operational_dispatches` 1:N `operational_dispatch_boxes`
- `operational_dispatches` 1:N `scanner_events`
- `operational_dispatches` 1:N `operational_consumptions`
- `operational_consumptions` genera `operational_kardex`

## Inventario materiales

- `material_items` 1:N `material_stock`
- `material_items` 1:N `material_movements`
- `commercial_orders` 1:N `packaging_requirements`

## Contabilidad

- `chart_of_accounts` 1:N `journal_entry_lines`
- `journal_entries` 1:N `journal_entry_lines`
- `purchases` puede generar `journal_entries`
- `withholdings_issued` y `withholdings_received` pueden relacionarse con `purchases`
- `cxc_documents` futuro puede relacionarse con `commercial_orders` o con factura SRI
