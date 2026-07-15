# FASE 3D-2 - Escaneo demo conectado a despacho de cajas

## Resumen

Se conecto el scanner demo con Despacho Operativo para marcar visualmente cajas escaneadas, pendientes, duplicadas, no encontradas u observadas. Todo funciona en modo demo y no afecta inventario, contabilidad, Supabase ni dispositivos reales.

## Implementado

- `scanner-service-demo.js` ahora expone estado de escaneo por pedido/despacho.
- Despacho Operativo muestra seccion de escaneo de cajas con campo, acciones, resumen y tabla por caja.
- Scanner / Zebra muestra escaneo por pedido/despacho y estado de cajas.
- Pedido Maestro -> Despacho muestra resumen visual de cajas escaneadas/pendientes.
- Checklist unico de despacho incluye `Cajas escaneadas demo` como OK, advertencia o pendiente.

## Funciones nuevas del servicio

- `getScansByOrderDemo(pedidoId)`
- `getBoxScanStatusDemo(pedidoId)`
- `scanBoxForDispatchDemo(codigo, pedidoId)`
- `resetBoxScansForOrderDemo(pedidoId)`
- `getPendingBoxesForOrderDemo(pedidoId)`
- `getScannedBoxesForOrderDemo(pedidoId)`
- `scanAllBoxesForDispatchDemo(pedidoId)`

## Estados de caja por escaneo

- `PENDIENTE_ESCANEO`
- `ESCANEADA_DEMO`
- `DUPLICADA_DEMO`
- `NO_ENCONTRADA`
- `OBSERVADA_DEMO`

Cada caja expone:

- `box_id`
- `numero_caja`
- `codigo_demo`
- `pedido_id`
- `tipo_caja`
- `po`
- `contenido_resumido`
- `estado_escaneo`
- `fecha_hora_escaneo`
- `resultado`
- `observacion`

## Codigos demo

- `BOX-60334-001`
- `BOX-60334-002`
- `BOX-60334-003`

Reglas:

- Si el codigo pertenece a una caja del pedido, queda `ESCANEADA_DEMO`.
- Si el codigo ya fue leido para el pedido, queda `DUPLICADA_DEMO`.
- Si existe pero pertenece a otro pedido, queda `OBSERVADA_DEMO` con resultado `ERROR_DEMO`.
- Si no existe, registra `NO_ENCONTRADO`.

## Relacion con Despacho Operativo

En `Operaciones / Poscosecha -> Despacho operativo`, el detalle del pedido muestra:

- campo de codigo de caja
- boton `Escanear caja demo`
- boton `Escanear todas demo`
- boton `Reiniciar escaneos demo`
- resumen de total, escaneadas, pendientes, duplicadas y observadas/error
- tabla de cajas con estado de escaneo

## Relacion con Pedido Maestro

En `Comercial / Exportaciones -> Pedido Maestro -> Despacho`, se muestra un bloque de escaneo con:

- cajas escaneadas
- cajas pendientes
- duplicadas
- estado general
- acceso a Scanner / Zebra
- acceso a Despacho Operativo

## No hace todavia

- No conecta lector Zebra real.
- No usa WebUSB.
- No usa WebBluetooth.
- No usa drivers reales.
- No descuenta inventario real.
- No consume materiales reales.
- No confirma despacho real.
- No toca Supabase.
- No genera contabilidad ni SRI.

## Como probar

1. Abrir ERP unico.
2. Ir a `Operaciones / Poscosecha -> Despacho operativo`.
3. Abrir detalle de pedido `60334`.
4. Escanear `BOX-60334-001`.
5. Escanear `BOX-60334-002`.
6. Repetir `BOX-60334-002` para ver duplicado.
7. Escanear un codigo inexistente.
8. Revisar cajas pendientes.
9. Ir a `Scanner / Zebra` y revisar historial.
10. Ir a `Pedido Maestro -> Despacho` y revisar estado de escaneo.

## Siguiente fase recomendada

FASE 3D-3: preparar integracion futura con modo teclado HID/Zebra real manteniendo el mismo contrato `scannerEventContract`, sin cambiar el flujo demo ya validado.
