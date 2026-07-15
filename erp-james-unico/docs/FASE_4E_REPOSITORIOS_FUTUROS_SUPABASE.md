# FASE 4E REPOSITORIOS FUTUROS SUPABASE

## Que se creo

- Carpeta `scripts/repositories/`.
- Repositorios preparados por modulo:
  - Core
  - Comercial
  - Operaciones
  - Inventario materiales
  - Contabilidad
- Registro global `scripts/repositories/index.js`.
- Reporte de estado `scripts/repositories/repository-status.js`.
- Diagnostico actualizado para mostrar la preparacion de repositorios.

## Estructura

- `scripts/repositories/core/`
- `scripts/repositories/comercial/`
- `scripts/repositories/operaciones/`
- `scripts/repositories/inventario-materiales/`
- `scripts/repositories/contabilidad/`

## Como funciona

- Cada repositorio usa `createRepositoryBase()` desde `scripts/services/supabase/repository-base.js`.
- Mientras Supabase siga desactivado, cada repositorio responde en modo `LOCAL_DEMO`.
- Ningun repositorio nuevo reemplaza la fuente activa actual.

## Repository registry

- `scripts/repositories/index.js` expone `repositoryRegistry`.
- `getRepositoryRegistryStatus()` devuelve:
  - modo actual
  - Supabase habilitado o no
  - total de repositorios
  - total por modulo
  - mensaje de que los servicios demo/locales siguen activos

## Repository status

- `scripts/repositories/repository-status.js` expone:
  - `getRepositoriesStatus()`
  - `getRepositoriesByModule()`
  - `getRepositoryReadinessReport()`

## Diagnostico actualizado

Core -> Diagnostico ahora muestra:

- repositorios Core preparados
- repositorios Comercial preparados
- repositorios Operaciones preparados
- repositorios Inventario materiales preparados
- repositorios Contabilidad preparados
- fuente activa actual local/demo
- Supabase desactivado
- reemplazo de servicios demo no realizado

## Que NO se hizo

- No se conecto Supabase.
- No se ejecuto SQL.
- No se crearon migraciones reales.
- No se reemplazaron servicios demo/locales.
- No se movio Pedido Maestro, Despacho, Scanner, Inventario de rosas ni Contabilidad a repositorios reales.

## Riesgos si se reemplazan servicios antes de tiempo

- Se puede romper el flujo demo estable del ERP.
- Se puede mezclar persistencia futura con logica temporal de prototipo.
- Se puede introducir dependencia parcial de Supabase sin contratos congelados.

## Siguiente fase recomendada

- Definir un modulo piloto para transicion controlada.
- Empezar por lectura de catalogos simples antes de mover transacciones.
- Mantener la migracion por capas: Core -> Comercial base -> Operaciones -> Inventario materiales -> Contabilidad.
