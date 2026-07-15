# FASE 4C PRIMERA MIGRACION MINIMA SUPABASE

## Que se definio

- primera migracion minima futura de Supabase
- tablas incluidas en el primer corte
- tablas excluidas del primer corte
- campos minimos por entidad
- orden posterior de fases
- migracion demo -> real solo bajo revision

## Por que se redujo el alcance

- para evitar una primera migracion demasiado grande
- para no mezclar ventas reales con contabilidad o SRI
- para no persistir todavia inventario real completo
- para proteger el arranque de Supabase con un corte pequeno y controlado

## Tablas incluidas

- Core
- Comercial base
- Operaciones minima para reservas y despacho

## Tablas excluidas

- Contabilidad real
- SRI
- inventario real de rosas completo
- inventario real de materiales
- scanner real
- consumo real

## Archivos creados

- `docs/supabase/PRIMERA_MIGRACION_MINIMA_SUPABASE.md`
- `docs/supabase/sql_revisable/003_primera_migracion_minima_borrador.sql`
- `docs/supabase/QUE_NO_ENTRA_EN_PRIMERA_MIGRACION.md`
- `docs/supabase/ORDEN_POSTERIOR_A_PRIMERA_MIGRACION.md`
- `docs/supabase/CAMPOS_MINIMOS_PRIMERA_MIGRACION.md`
- `docs/supabase/MIGRACION_DATOS_DEMO_A_REALES.md`

## SQL revisable creado

`003_primera_migracion_minima_borrador.sql` es solo un borrador de revision.

## Que NO se hizo

- no se conecto Supabase
- no se ejecuto SQL
- no se crearon migraciones reales
- no se crearon tablas reales
- no se implemento Auth real
- no se implemento RLS real

## Riesgos si se ejecuta antes de tiempo

- campos incompletos o mal congelados
- company y usuarios reales sin definir
- relaciones con Parte 1 aun no cerradas
- SRI y contabilidad todavia sin frontera final

## Siguiente fase recomendada

- revisar el SQL 003 con calma
- congelar campos obligatorios
- definir el alcance exacto de Auth y roles antes de cualquier migracion oficial
