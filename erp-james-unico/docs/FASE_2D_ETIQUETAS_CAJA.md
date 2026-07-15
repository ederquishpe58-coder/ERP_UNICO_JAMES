# FASE 2D - Etiquetas de caja, codigo aduana demo e impresion por rango

## Que se implemento

Se agrego una capa modular nueva en `scripts/modules/comercial/labels/` para manejar:

- una etiqueta demo por caja
- codigo aduana demo / placeholder
- barcode y QR visuales
- impresion de todas las etiquetas
- impresion por rango
- reimpresion individual

Tambien se actualizo:

- `Pedido Maestro -> Etiquetas`
- `Centro de impresion -> Etiquetas de caja`
- `Pedidos / Historial -> Imprimir etiquetas`
- `boxLabelContract`

Todo sigue desacoplado de Zebra real, impresora real, barcode real, QR real, Supabase y SRI.

## Campos de la etiqueta

Cada etiqueta demo puede mostrar:

- BLESS FLOWER
- Pedido No.
- Invoice / Packing No., si existe
- Box numero / total cajas
- Tipo de caja
- Marca / cliente final
- PO
- Destino
- Pais
- DAE
- AWB / HAWB
- Agencia de carga
- Carrier / vuelo
- Fecha de vuelo
- Codigo aduana demo
- Contenido resumido por caja
- Placeholder BARCODE DEMO
- Placeholder QR DEMO
- Observacion

## Que es codigo aduana demo

`codigo_aduana` en esta fase:

- no es codigo oficial
- no es validacion aduanera real
- se construye visualmente con DAE, caja, total cajas, destino, fecha vuelo y pedido
- sirve para preparar luego la regla real

Si falta DAE:

- el codigo se sigue armando como placeholder
- la etiqueta queda con error `FALTA_DAE`
- se muestra claramente que sigue pendiente validacion

## Como imprimir todas

1. Abrir `Comercial / Exportaciones`.
2. Ir a `Pedido Maestro`.
3. Abrir la pestaña `Etiquetas`.
4. Seleccionar `Tipo impresion = Todas`.
5. Usar `Vista previa` o `Imprimir todas`.

## Como imprimir por rango

1. En `Etiquetas`, cambiar `Tipo impresion = Rango`.
2. Definir `Desde caja`.
3. Definir `Hasta caja`.
4. Verificar la vista previa incrustada.
5. Usar `Imprimir rango`.

Reglas activas:

- no permite `desde > hasta`
- no permite rango vacio
- no permite rango sin cajas existentes

## Como reimprimir una etiqueta individual

1. En `Etiquetas`, cambiar `Tipo impresion = Individual`.
2. Ingresar `Caja individual`.
3. Verificar que la caja exista.
4. Usar `Reimprimir individual`.

Tambien se puede reimprimir desde la tabla por caja con los botones `Ver` e `Imprimir`.

## Que falta para Zebra real

Pendiente para fase posterior:

- formato por etiqueta fisica real
- salida directa a impresora Zebra
- comandos propios del hardware
- definicion final de tamanos reales
- integracion con scanner / Zebra de Parte 1

## Que falta para barcode y QR real

Pendiente para fase posterior:

- generacion de barcode real
- generacion de QR real
- libreria de codificacion
- lectura por scanner externo
- persistencia del valor emitido

## Riesgos pendientes

- `codigo_aduana` sigue siendo demo y no oficial
- las etiquetas dependen de datos demo del Pedido Maestro
- si faltan marca, destino o DAE, el documento queda bloqueado
- Zebra y barcode real no estan conectados
- la impresion depende del navegador y `window.print()`

## Validacion recomendada

- `npm run validate:shell`
- `npm run build`
- `npm run build:standalone`

## Siguiente fase recomendada

FASE 2E:

- mejorar packing operativo por caja
- preparar adapter visual con stock administrativo de inventario de empaque
- definir identificador real futuro para barcode / QR / Zebra
