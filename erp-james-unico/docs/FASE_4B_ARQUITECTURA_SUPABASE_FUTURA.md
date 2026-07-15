# FASE 4B ARQUITECTURA SUPABASE FUTURA

## Que se diseno

- arquitectura futura de Supabase
- tablas por modulo
- prioridad de implementacion
- relaciones principales
- diccionario de tablas
- mapeo contratos -> tablas
- borradores SQL revisables
- borrador conceptual de RLS

## Archivos creados

- `docs/supabase/ARQUITECTURA_SUPABASE_FUTURA.md`
- `docs/supabase/TABLAS_POR_MODULO_SUPABASE.md`
- `docs/supabase/PRIORIDAD_IMPLEMENTACION_SUPABASE.md`
- `docs/supabase/RELACIONES_SUPABASE_FUTURAS.md`
- `docs/supabase/DICCIONARIO_TABLAS_SUPABASE.md`
- `docs/supabase/CONTRATOS_A_TABLAS_SUPABASE.md`
- `docs/supabase/NO_EJECUTAR_SQL_AUN.md`
- `docs/supabase/sql_revisable/001_core_comercial_operaciones_borrador.sql`
- `docs/supabase/sql_revisable/002_rls_policies_borrador.sql`

## Tablas prioritarias

- Core: `companies`, `users`, `roles`, `audit_logs`, `sequences`
- Comercial: `customers`, `final_brands`, `commercial_orders`, `commercial_order_boxes`, `commercial_order_lines`
- Operaciones: `flower_inventory`, `flower_availability`, `flower_reservations`, `operational_dispatches`, `scanner_events`

## Relacion con contratos

Cada contrato principal del ERP ya tiene tabla objetivo sugerida para persistencia futura.

## SQL existente solo como borrador

- El SQL creado en `sql_revisable/` es conceptual.
- No es migracion oficial.
- No debe ejecutarse todavia.

## Que NO se hizo

- no se conecto Supabase
- no se ejecuto SQL
- no se crearon migraciones reales
- no se crearon tablas reales
- no se implemento Auth real
- no se implemento RLS real

## Riesgos antes de ejecutar SQL

- campos aun pueden cambiar si no se congelan contratos
- usuarios y roles reales todavia no estan definidos
- multiempresa todavia no esta cerrada
- SRI y contabilidad de ventas aun no tienen modelo final aprobado

## Siguiente fase recomendada

- congelar contratos y campos obligatorios
- definir primer alcance minimo de persistencia real
- revisar el SQL borrador antes de cualquier migracion oficial
