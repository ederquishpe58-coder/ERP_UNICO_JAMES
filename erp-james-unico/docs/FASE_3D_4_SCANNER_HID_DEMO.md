# FASE 3D-4 Scanner HID Demo

## Que se implemento

- Se agrego el adaptador `scripts/modules/operaciones/scanner-hid-adapter-demo.js`.
- La pantalla `Operaciones / Poscosecha -> Scanner / Zebra` ahora tiene una seccion de entrada tipo teclado HID demo.
- El campo HID demo procesa codigos al presionar `Enter`.
- El resultado HID demo se envia al `scanner-service-demo.js` para reutilizar la misma lectura visual.
- Se actualizo diagnostico y validaciones del shell para incluir el nuevo archivo.

## Que es modo teclado HID

Muchos lectores Zebra pueden configurarse como teclado HID. En ese modo, el navegador no necesita conectarse directamente al dispositivo; solo recibe el texto en un input. Por eso es la opcion mas simple para iniciar.

En esta fase el sistema solo prepara ese flujo:

- input manual
- texto pegado
- codigo finalizado con `Enter`
- normalizacion del valor
- envio al scanner demo ya existente

## Por que conviene empezar por HID

- No requiere WebUSB.
- No requiere WebBluetooth.
- No requiere drivers del navegador.
- La primera integracion real puede probarse con el lector escribiendo sobre un campo normal.
- Reduce riesgo antes de conectar hardware fisico.

## Funciones creadas

Archivo: `scripts/modules/operaciones/scanner-hid-adapter-demo.js`

- `createHidScannerSessionDemo(options)`
- `startHidScannerDemo()`
- `stopHidScannerDemo()`
- `handleHidInputDemo(value, context)`
- `isLikelyScannerInputDemo(value)`
- `normalizeScannerInputDemo(value)`
- `getHidScannerStatusDemo()`

## Como probar con teclado normal

1. Abrir `Operaciones / Poscosecha -> Scanner / Zebra`.
2. Presionar `Activar modo HID demo`.
3. Enfocar el campo `Campo de prueba HID demo`.
4. Escribir `BOX-60334-001`.
5. Presionar `Enter`.
6. Revisar el resultado, el historial y el codigo normalizado.

## Codigos demo sugeridos

- `BOX-60334-001`
- `BUNCH-EXP-50-001`
- `PED-60334`
- `DSP-60334`

## Que NO se implemento todavia

- Lector Zebra real.
- Conexion WebUSB.
- Conexion WebBluetooth.
- Drivers reales.
- Confirmacion de despacho real por scanner.
- Descuento de inventario real.
- Barcode real.
- QR real.

## Como funcionara con Zebra real despues

- El lector se configurara como teclado HID.
- El usuario enfocara el input del scanner.
- El lector escribira el codigo y enviara `Enter`.
- El ERP procesara ese texto usando la misma ruta preparada en esta fase.

## Pendientes

- Pruebas fisicas con lector real.
- Politicas de foco por pantalla.
- Auditoria real de eventos.
- Integracion real con despacho y etiquetas.
