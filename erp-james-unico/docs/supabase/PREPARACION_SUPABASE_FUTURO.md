# PREPARACION SUPABASE FUTURO

## Estado actual

- El ERP unico trabaja en modo local/demo.
- Supabase todavia no se conecta.
- No hay migraciones ejecutadas.
- No hay tablas reales creadas desde esta fase.

## Antes de conectar Supabase se debe definir

- modulos prioritarios
- tablas principales
- relaciones
- politicas RLS
- usuarios y roles
- auditoria
- migracion de datos demo
- backups
- ambiente prueba/produccion

## Modulos prioritarios sugeridos para Supabase

### 1. Core

- `users`
- `roles`
- `audit_logs`
- `settings`
- `sequences`

### 2. Comercial

- `customers`
- `final_brands`
- `commercial_orders`
- `commercial_order_boxes`
- `commercial_order_lines`
- `commercial_documents`
- `commercial_workflow_events`

### 3. Operaciones

- `flower_inventory`
- `flower_availability`
- `flower_reservations`
- `dispatches`
- `scanner_events`
- `operational_consumptions`
- `operational_kardex`

### 4. Contabilidad

- `chart_of_accounts`
- `journal_entries`
- `journal_entry_lines`
- `purchases`
- `withholdings`
- `cxp`
- `cxc`
- `bank_accounts`
- `bank_movements`

### 5. Inventario materiales

- `material_items`
- `material_stock`
- `material_movements`
- `packaging_requirements`

## Aclaracion

Este documento es preparacion conceptual. No ejecutar SQL todavia.
