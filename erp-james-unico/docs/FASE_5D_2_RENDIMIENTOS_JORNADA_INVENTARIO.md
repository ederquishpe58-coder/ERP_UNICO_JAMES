# FASE 5D-2 - Rendimientos, jornada y puente a inventario demo

## Objetivo

Acercar el modulo `Operaciones / Poscosecha -> Rendimientos` al flujo de Parte 1 POSCOSECHA, reforzando:

- control visual de jornada
- metas demo para clasificadores y embonchadores
- lectura separada de ramos ingresados
- relacion visible entre ramos ingresados e inventario operativo demo

## Implementado

- Panel de jornada dentro de Rendimientos.
- Estados demo de jornada:
  - `SIN_INICIAR`
  - `EN_CURSO_DEMO`
  - `PAUSADA_DEMO`
  - `CERRADA_DEMO`
- Acciones visuales:
  - iniciar jornada
  - pausar
  - reanudar
  - cerrar jornada demo
- Metas demo:
  - 233 mallas/dia clasificador
  - 29.1 mallas/hora clasificador
  - 25 bonches/hora embonchador
  - 200 bonches/dia embonchador
- Tablas de rendimiento usan las metas configuradas, no valores sueltos.
- Al ingresar un ramo por `RAMOS ING`, se crea o vincula un registro de inventario operativo demo.
- La pantalla muestra la relacion:
  - codigo de ramo
  - variedad
  - longitud
  - embonchador
  - inventario demo
  - bodega
  - ubicacion
  - estado

## Archivos principales

- `scripts/modules/operaciones/operaciones-data.js`
- `scripts/modules/operaciones/operaciones-state.js`
- `scripts/modules/operaciones/rendimientos-utils.js`
- `scripts/modules/operaciones/rendimientos.js`
- `scripts/modules/operaciones/ramos-ingresados.js`
- `scripts/modules/operaciones/index.js`

## Que sigue siendo demo

- No conecta lector Zebra real.
- No descuenta inventario real.
- No conecta Supabase.
- No modifica Parte 1 original.
- No modifica rol de pagos.
- No modifica contabilidad.

## Siguiente paso recomendado

FASE 5D-3:
Revisar contra ERP1 la pantalla exacta de `MALLAS PRC` y `RAMOS ING`, agregando filtros por proveedor, fecha, clasificador y exportacion CSV demo si corresponde.
