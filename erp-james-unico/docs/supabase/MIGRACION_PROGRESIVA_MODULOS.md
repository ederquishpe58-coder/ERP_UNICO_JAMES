# MIGRACION PROGRESIVA MODULOS

## Estado actual

- El ERP sigue en modo local/demo.
- Supabase sigue desactivado.
- Los repositorios futuros ya existen, pero no reemplazan servicios actuales.
- La migracion se hara por modulo, no todo de golpe.

## Regla principal

Cada modulo debe tener antes de activarse:

- repositorio preparado
- tabla revisada
- pruebas locales
- seed minimo
- rollback documentado
- auditoria prevista
- validaciones definidas
- usuario responsable

## Orden recomendado

### FASE MIGRACION 1

Core minimo:

- `companies`
- `user_profiles`
- `roles`
- `user_roles`
- `app_settings`
- `sequences`
- `audit_logs`

### FASE MIGRACION 2

Catalogos comerciales:

- `customers`
- `final_brands`
- `cargo_agencies`
- `airlines`
- `dae_records`
- `export_products`

### FASE MIGRACION 3

Pedido Maestro comercial:

- `commercial_orders`
- `commercial_order_boxes`
- `commercial_order_lines`
- `commercial_workflow_events`
- `commercial_documents`

### FASE MIGRACION 4

Operaciones minima:

- `flower_availability`
- `flower_reservations`
- `operational_dispatches`
- `operational_dispatch_boxes`

### FASE MIGRACION 5

Scanner y eventos:

- `scanner_events`

### FASE MIGRACION 6

Inventario materiales:

- `material_items`
- `material_stock`
- `material_movements`
- `packaging_requirements`

### FASE MIGRACION 7

Contabilidad base:

- `chart_of_accounts`
- `journal_entries`
- `journal_entry_lines`
- `suppliers`
- `purchases`
- `withholdings`
- `cxp`
- `cxc`
- `bank_accounts`
- `bank_movements`

### FASE MIGRACION 8

SRI futuro:

- `electronic_documents`
- `sri_authorizations`
- `sri_xml_logs`
- `ride_documents`
- `ats_periods`

## Criterio de trabajo

- No ejecutar ninguna fase todavia.
- Activar un modulo solo cuando el anterior este estable.
- No mezclar inventario de rosas con inventario de materiales.
- No llevar contabilidad real de ventas antes de definir SRI.
- No mover pedidos, consumos o scanner a persistencia real sin rollback probado.
