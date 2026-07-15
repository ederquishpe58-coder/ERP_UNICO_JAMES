# PLAN ROLLBACK SUPABASE

## Regla general

- Cada modulo debe poder volver a modo local/demo.
- No reemplazar servicios demo hasta probar.
- Mantener feature flags por modulo.
- No borrar datos demo/locales hasta validar produccion.

## Antes de activar cualquier modulo

- backup
- pruebas
- usuario responsable
- plan de reversa

## Rollback por modulo

### Core

- desactivar `VITE_ENABLE_CORE_SUPABASE`
- volver a usuario demo

### Comercial

- desactivar `VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE`
- desactivar `VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE`
- volver a `comercial-data` demo/local

### Operaciones

- desactivar `VITE_ENABLE_OPERATIONS_SUPABASE`
- volver a `disponibilidad-service-demo`
- volver a `despacho-service-demo`

### Scanner

- desactivar `VITE_ENABLE_SCANNER_SUPABASE`
- volver a `scanner-service-demo`

### Inventario materiales

- desactivar `VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE`
- volver a local/demo

### Contabilidad

- desactivar `VITE_ENABLE_ACCOUNTING_SUPABASE`
- volver a local/demo
- nunca activar sin respaldo

### SRI

- desactivar `VITE_ENABLE_SRI_SUPABASE`
- detener emision real
- revisar logs
