# FASE 3D Cierre Scanner / Zebra Demo

## Resumen de la fase

### 3D-1 Scanner demo base

- Lectura demo de caja, ramo, pedido y despacho.
- Historial visual de eventos.
- Contrato `scannerEventContract`.

### 3D-2 Escaneo conectado a despacho

- Escaneo de cajas vinculado a `Despacho operativo`.
- Estado de cajas escaneadas, pendientes, duplicadas y no encontradas.

### 3D-3 Codigos demo unificados

- Utilitario central `code-utils-demo.js`.
- Formatos unificados:
  - `BOX-{pedido}-{numeroCaja}`
  - `BUNCH-{variedad_corta}-{longitud}-{secuencia}`
  - `PED-{pedido}`
  - `DSP-{pedido}`
- Etiquetas de caja y etiquetas de ramo alineadas con el scanner demo.

### 3D-4 Preparacion teclado HID demo

- Adaptador `scanner-hid-adapter-demo.js`.
- Entrada por `Enter` en la pantalla `Scanner / Zebra`.
- Preparacion tecnica para lector real tipo teclado HID.

## Activo demo

- lectura de caja
- lectura de ramo
- lectura de pedido
- lectura de despacho
- historial de escaneos
- caja escaneada / pendiente
- duplicados
- codigos no encontrados
- modo teclado HID demo

## Pendiente

- lector real
- configuracion Zebra real
- pruebas fisicas
- impresion barcode real
- descuento inventario real
- Supabase
- auditoria real

## Archivos principales

- `scripts/modules/operaciones/code-utils-demo.js`
- `scripts/modules/operaciones/scanner-service-demo.js`
- `scripts/modules/operaciones/scanner-hid-adapter-demo.js`
- `scripts/modules/operaciones/scanner-zebra.js`
- `scripts/modules/operaciones/despacho-operativo.js`
- `scripts/modules/comercial/pedido-maestro.js`

## Estado final

El scanner Zebra demo queda cerrado como modulo visual y tecnico de preparacion. El flujo actual sirve para validar UX, codigos demo, historial y sincronizacion visual con despacho, sin tocar hardware real ni inventario real.
