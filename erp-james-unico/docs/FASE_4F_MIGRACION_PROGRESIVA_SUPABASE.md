# FASE 4F MIGRACION PROGRESIVA SUPABASE

## Que se creo

- documentacion principal de migracion progresiva por modulo
- matriz de activacion por modulo
- feature flags futuras en `.env.example`
- funciones nuevas en `env.js`
- guard tecnico `feature-flag-guard.js`
- reporte extendido en `repository-status.js`
- plan de rollback
- checklist de pruebas
- estrategia de seeds iniciales

## Feature flags disponibles

- `VITE_ENABLE_CORE_SUPABASE`
- `VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE`
- `VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE`
- `VITE_ENABLE_OPERATIONS_SUPABASE`
- `VITE_ENABLE_SCANNER_SUPABASE`
- `VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE`
- `VITE_ENABLE_ACCOUNTING_SUPABASE`
- `VITE_ENABLE_SRI_SUPABASE`

## Como se controla la activacion

- `VITE_SUPABASE_ENABLED` debe seguir en `false` por ahora.
- Aunque una bandera modular este en `true`, no podra activarse si Supabase global sigue desactivado o sin configurar.
- El guard central devuelve la razon exacta de bloqueo.

## Como funciona `feature-flag-guard.js`

- valida Supabase global
- valida configuracion del cliente
- valida la bandera del modulo
- responde si el modulo puede o no usar Supabase
- devuelve motivo claro cuando no puede

## Documentacion agregada

- `docs/supabase/MIGRACION_PROGRESIVA_MODULOS.md`
- `docs/supabase/MATRIZ_ACTIVACION_MODULOS_SUPABASE.md`
- `docs/supabase/PLAN_ROLLBACK_SUPABASE.md`
- `docs/supabase/CHECKLIST_PRUEBAS_MIGRACION_MODULOS.md`
- `docs/supabase/ESTRATEGIA_SEEDS_INICIALES.md`

## Que NO se hizo

- no se conecto Supabase
- no se ejecuto SQL
- no se crearon migraciones reales
- no se reemplazaron servicios demo/locales
- no se activaron feature flags

## Riesgos si se activa todo de golpe

- romper Comercial y Operaciones ya estables
- mezclar datos demo con persistencia real
- activar contabilidad o SRI sin flujos consolidados
- perder capacidad de rollback por modulo

## Siguiente fase recomendada

- elegir un modulo piloto pequeno
- probar primero catalogos simples
- mantener activacion progresiva con flags y rollback probado
