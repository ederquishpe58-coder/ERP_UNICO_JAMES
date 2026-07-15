# PRIMERA MIGRACION MINIMA SUPABASE

## Alcance de esta fase

- Esta fase no ejecuta SQL.
- Esta fase no conecta Supabase.
- Esta fase solo define la primera migracion minima futura.
- La primera migracion debe enfocarse en Core + Comercial base + Auditoria minima.
- No meter todavia Contabilidad real.
- No meter todavia SRI.
- No meter todavia inventario real completo.
- No meter todavia scanner real.
- No meter todavia consumo real.

## Objetivo de la primera migracion minima

La primera migracion debe crear solo la base necesaria para que el ERP empiece a guardar datos reales de forma segura sin tocar todavia contabilidad real, SRI ni inventario operativo completo.

## Incluye como prioridad 1

### Core

- `companies`
- `user_profiles`
- `roles`
- `user_roles`
- `app_settings`
- `sequences`
- `audit_logs`

### Comercial base

- `customers`
- `final_brands`
- `cargo_agencies`
- `airlines`
- `dae_records`
- `export_products`
- `commercial_orders`
- `commercial_order_boxes`
- `commercial_order_lines`
- `commercial_workflow_events`
- `commercial_documents`

### Operaciones minima demo/persistible

- `flower_availability`
- `flower_reservations`
- `operational_dispatches`
- `operational_dispatch_boxes`

## No incluye todavia

- `journal_entries`
- `journal_entry_lines`
- `purchases`
- tablas tributarias definitivas
- autorizaciones SRI
- documentos electronicos
- `operational_consumptions` reales
- `operational_kardex` real
- `scanner_events` real
- `material_stock` real

## Motivo de esta reduccion

- bajar el riesgo de una primera migracion demasiado grande
- persistir primero Core y Pedido Maestro
- dejar Operaciones solo en el minimo necesario para reservas y despacho
- evitar contaminar la primera base con reglas no definidas de ventas, SRI o contabilidad
