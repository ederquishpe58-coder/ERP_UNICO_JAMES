# FASE 3D-1 - Scanner / Zebra demo

## Resumen

Se preparo un modulo demo de escaneo para Operaciones / Poscosecha. El objetivo es simular lecturas de etiquetas de caja, ramos, pedido y despacho sin conectar hardware real.

## Implementado

- Contrato `scannerEventContract` ampliado para eventos de scanner demo.
- Servicio `scripts/modules/operaciones/scanner-service-demo.js` con eventos en memoria/demo.
- Pantalla `Operaciones / Poscosecha -> Scanner / Zebra` con entrada manual, botones demo, resultado e historial.
- Panel visual en `Despacho operativo` para ver escaneos demo del pedido seleccionado.
- Etiquetas de caja alineadas al formato demo `BOX-{pedido}-{numeroCaja}`.
- Diagnostico actualizado con estado activo demo y pendientes de hardware real.

## scannerEventContract

Campos principales:

- `event_id`
- `fecha_hora`
- `codigo`
- `tipo_codigo`
- `modulo_origen`
- `modulo_destino`
- `pedido_id`
- `box_id`
- `label_id`
- `variedad`
- `longitud`
- `resultado`
- `usuario_demo`
- `observacion`

Tipos demo:

- `RAMO`
- `CAJA`
- `PEDIDO`
- `DESPACHO`
- `MATERIAL`
- `DESCONOCIDO`

Resultados demo:

- `LEIDO_DEMO`
- `VALIDADO_DEMO`
- `NO_ENCONTRADO`
- `DUPLICADO`
- `ERROR_DEMO`

## Servicio demo

Archivo:

- `scripts/modules/operaciones/scanner-service-demo.js`

Funciones:

- `getScannerEventsDemo()`
- `scanCodeDemo(codigo, contexto)`
- `validateBoxScanDemo(codigo, pedidoId)`
- `validateBunchScanDemo(codigo)`
- `validateDispatchScanDemo(codigo, pedidoId)`
- `clearScannerEventsDemo()`
- `getScannerSummaryDemo()`

El servicio guarda eventos solo en memoria/local demo del ERP. No usa Supabase ni dispositivos reales.

## Codigos demo para probar

- `BOX-60334-001`
- `BOX-60334-002`
- `BOX-60334-003`
- `BUNCH-EXP-50-001`
- `BUNCH-PLA-50-001`
- `BUNCH-MON-60-001`
- `PED-60334`
- `DSP-60334`

Un codigo inexistente devuelve `NO_ENCONTRADO`. Un codigo repetido devuelve `DUPLICADO`.

## No implementado todavia

- Lector Zebra real.
- WebUSB.
- WebBluetooth.
- Drivers reales.
- Impresora real.
- Codigo de barras real.
- QR real.
- Descuento real de inventario.
- Confirmacion real de despacho por scanner.
- Supabase.
- SQL o migraciones.

## Como probar

1. Abrir el ERP unico.
2. Ir a `Operaciones / Poscosecha -> Scanner / Zebra`.
3. Escanear `BOX-60334-001`.
4. Escanear `BUNCH-EXP-50-001`.
5. Escanear `DSP-60334`.
6. Escanear un codigo inexistente.
7. Repetir un codigo para validar `DUPLICADO`.
8. Revisar el historial de escaneos.
9. Abrir `Operaciones / Poscosecha -> Despacho operativo` y revisar el bloque de scanner demo.
10. Revisar `Core del sistema -> Diagnostico / Estado del ERP`.

## Siguiente fase recomendada

FASE 3D-2: conectar visualmente los escaneos de caja con el checklist de despacho, marcando cajas escaneadas vs pendientes sin descontar inventario real.
