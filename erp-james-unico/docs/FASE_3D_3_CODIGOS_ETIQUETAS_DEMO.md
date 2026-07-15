# FASE 3D-3 - Codigos demo unificados para etiquetas y scanner

## Resumen

Se unificaron los codigos demo usados por etiquetas de caja, etiquetas de ramo, Scanner / Zebra demo y Despacho Operativo. Todo sigue siendo visual/demo y no conecta hardware, Supabase, inventario real, contabilidad ni SRI.

## Utilitario central

Archivo:

- `scripts/modules/operaciones/code-utils-demo.js`

Funciones:

- `buildBoxCodeDemo(pedidoNumero, numeroCaja)`
- `buildBunchCodeDemo(variedad, longitud, secuencia)`
- `buildOrderCodeDemo(pedidoNumero)`
- `buildDispatchCodeDemo(pedidoNumero)`
- `parseDemoCode(codigo)`
- `normalizeDemoCode(codigo)`

## Formatos demo

Caja:

- `BOX-{pedido}-{numeroCaja}`
- Ejemplo: `BOX-60334-001`

Ramo:

- `BUNCH-{VARIEDAD_CORTA}-{LONGITUD}-{SECUENCIA}`
- Ejemplo: `BUNCH-EXP-50-001`

Pedido:

- `PED-{pedido}`
- Ejemplo: `PED-60334`

Despacho:

- `DSP-{pedido}`
- Ejemplo: `DSP-60334`

## Variedades cortas

- `EXPLORER` -> `EXP`
- `PLAYA BLANCA` -> `PLA`
- `MONDIAL` -> `MON`
- `CANDLELIGHT` -> `CAN`
- `QUICKSAND` -> `QUI`
- `NINA` -> `NIN`
- `PINK MONDIAL` -> `PMO`
- `HOT EXPLORER` -> `HEX`
- `HERMOSA` -> `HER`
- `MANDALA` -> `MAN`
- `BE SWEET` -> `BSW`

Si una variedad no esta catalogada, se usan las primeras 3 letras limpias.

## Uso en etiquetas de caja

Las etiquetas de caja comerciales usan `buildBoxCodeDemo(pedidoNumero, numeroCaja)`.

En la etiqueta se muestra:

- codigo caja demo
- placeholder visual de barcode/QR
- pedido
- caja numero / total cajas
- marca
- PO
- destino
- DAE
- AWB / HAWB

No se genera barcode real.

## Uso en etiquetas de ramo

Operaciones / Poscosecha -> Etiquetas de ramos usa `buildBunchCodeDemo(variedad, longitud, secuencia)`.

La pantalla muestra:

- fecha
- color dia
- proveedor / bloque
- variedad
- longitud
- tallos por ramo
- cantidad etiquetas
- codigo demo
- placeholder visual de barcode demo

## Uso en Scanner / Zebra

Scanner / Zebra demo reconoce:

- `BOX-60334-001`
- `BUNCH-EXP-50-001`
- `PED-60334`
- `DSP-60334`

Ademas muestra el resultado parseado:

- tipo detectado
- pedido
- caja
- variedad corta
- longitud
- secuencia

## Uso en Despacho Operativo

Despacho Operativo usa el mismo formato:

- `BOX-{pedido}-{numeroCaja}`

Para el pedido demo 60334:

- `BOX-60334-001`
- `BOX-60334-002`
- `BOX-60334-003`

## Sigue siendo demo

- Codigo demo no equivale a barcode real.
- Scanner demo no descuenta inventario real.
- Impresion real pendiente.
- Lector Zebra real pendiente.
- WebUSB/WebBluetooth no implementado.
- Supabase no conectado.

## Falta para barcode/Zebra real

- Definir libreria o driver de generacion barcode/QR.
- Definir modo de lectura real: teclado HID, USB, Bluetooth o driver Zebra.
- Definir formato final aprobado para etiquetas fisicas.
- Agregar validaciones reales contra inventario y despacho cuando la fase lo autorice.

## Como probar

1. Abrir ERP unico.
2. Ir a `Operaciones / Poscosecha -> Etiquetas de ramos`.
3. Generar etiqueta demo `BUNCH-EXP-50-001`.
4. Ir a `Comercial / Exportaciones -> Pedido Maestro -> Etiquetas`.
5. Verificar codigo `BOX-60334-001`.
6. Ir a `Operaciones / Poscosecha -> Scanner / Zebra`.
7. Escanear `BOX-60334-001`.
8. Escanear `BUNCH-EXP-50-001`.
9. Escanear `PED-60334`.
10. Escanear `DSP-60334`.
11. Revisar historial de escaneos.
12. Revisar Diagnostico / Estado del ERP.
