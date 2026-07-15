# FASE 2B - Documentos imprimibles comerciales

## Que se integro

Se separo la capa de impresion comercial en `scripts/modules/comercial/print/` para evitar seguir creciendo `invoice-carguera.js` o mezclar todo dentro de `pedido-maestro.js`.

Quedaron activos en modo demo:

- Invoice / Packing carguera referencial
- Invoice / Packing carguera real demo
- Packing List
- HR / Hoja de Ruta
- MP / Master Packing
- Etiquetas de caja
- Resumen del pedido
- Control DAE

Todos salen desde:

- `Comercial / Exportaciones -> Pedido Maestro -> Centro de impresion`
- `Comercial / Exportaciones -> Centro de impresion`

Tambien quedaron conectadas las tabs internas de Pedido Maestro para:

- Invoice carguera
- Packing
- HR / Hoja de Ruta
- MP / Master Packing
- Etiquetas

## Que datos usa cada documento

### Invoice / Packing carguera

Usa:

- empresa demo Bless Flower
- pedido activo
- marca / cliente final
- DAE
- AWB / HAWB
- carrier / vuelo
- detalle de cajas y variedades
- precios por linea

Reglas:

- no imprime el cliente principal interno
- no es factura SRI
- puede salir como `REFERENCIAL` o `REAL DEMO / VALIDADO INTERNAMENTE`

### Packing List

Usa:

- pedido activo
- marca
- destino
- vuelo
- agencia
- DAE
- detalle de cajas

Reglas:

- por defecto sale sin precios
- puede verse con precios solo como preview interno demo

### HR / Hoja de Ruta

Usa:

- agencia de carga
- cuarto frio
- vuelo
- cajas
- destino
- marca

Reglas:

- documento operativo demo
- no conecta todavia Operaciones reales

### MP / Master Packing

Usa:

- totales del pedido
- resumen por tipo de caja
- resumen por variedad
- resumen por longitud
- resumen por PO

### Etiquetas de caja

Usa:

- cajas del pedido
- marca
- destino
- DAE
- AWB / HAWB
- fecha vuelo
- agencia

Reglas:

- imprime todas las cajas
- permite rango por caja
- para reimprimir una sola caja se usa el mismo numero en desde/hasta
- QR y Zebra real quedan como placeholder visual

### Resumen del pedido

Usa:

- cliente principal interno
- marca
- destino
- fechas
- DAE
- AWB / HAWB
- totales
- validaciones
- materiales de bodega requeridos demo

### Control DAE

Usa:

- DAE del pedido
- destino del pedido
- fecha vuelo
- estado de vigencia
- pedidos vinculados demo con la misma DAE

## Que es referencial y que es real demo

- `REFERENCIAL`: documento de revision, puede imprimirse aunque existan advertencias.
- `REAL DEMO / VALIDADO INTERNAMENTE`: modo visual interno para simular el documento de trabajo, sin implicar facturacion real ni autorizacion tributaria.

## Que no es SRI

Esta fase NO implementa:

- facturacion SRI real
- autorizacion SRI real
- XML SRI
- contabilidad de ventas
- cartera de ventas
- PDF firmado o tributario

Mensaje operativo vigente:

`Factura cliente y facturacion SRI se implementaran en una fase posterior. Los documentos actuales son comerciales/logisticos y de revision.`

## Como imprimir

1. Abrir el ERP unico.
2. Ir a `Comercial / Exportaciones`.
3. Abrir `Pedido Maestro` o `Centro de impresion`.
4. Seleccionar o revisar el pedido activo.
5. Usar `Vista previa` para abrir una ventana separada.
6. Usar `Imprimir` para lanzar `window.print()` sobre esa vista.

Notas:

- en `Packing List` se puede activar visualmente `Mostrar precios`
- en `Etiquetas` se puede indicar `Desde caja` y `Hasta caja`

## Que falta para PDF real

Pendiente para fase futura:

- generacion PDF formal con libreria dedicada
- nombres de archivo
- persistencia de documentos generados
- descarga controlada desde Centro de impresion

## Que falta para Zebra y codigo de barras real

Pendiente para fase futura:

- formato fisico por impresora Zebra
- codigo de barras real
- QR real
- comandos de impresion por hardware
- coordinacion con Parte 1 Scanner / Zebra

## Riesgos pendientes

- los previews dependen de datos demo; no consumen inventario real ni reservas reales
- la disponibilidad de rosas sigue desacoplada de Parte 1
- Packing con precios es solo visual y no debe confundirse con factura cliente
- el popup de impresion depende del navegador para permitir ventanas
- los documentos todavia no tienen exportacion PDF nativa ni control de version documental

## Comandos de validacion

- `npm run validate:shell`
- `npm run build`
- `npm run build:standalone`

## Siguiente fase recomendada

FASE 2C:

- pulir flujo de estados del Pedido Maestro
- fortalecer historial de documentos y duplicado de pedidos
- preparar adapter visual para disponibilidad/reservas sin tocar todavia Parte 1 real
- definir el puente futuro entre documento comercial y factura cliente sin mezclarlo con SRI
