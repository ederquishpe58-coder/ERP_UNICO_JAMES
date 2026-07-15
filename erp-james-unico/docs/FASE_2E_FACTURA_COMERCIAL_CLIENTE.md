# FASE 2E - Factura Comercial Cliente

## Que se implemento

Se agrego dentro de `Pedido Maestro` y `Centro de impresion` un documento nuevo:

- `FACTURA COMERCIAL CLIENTE / COMMERCIAL INVOICE CLIENTE`

Quedo activo en modo demo/preliminar y separado de:

- `Invoice / Packing carguera`
- futura `Factura SRI exportacion`
- contabilidad y cartera de ventas

Tambien se agrego:

- vista agrupada por variedad / longitud / precio
- vista detallada por caja
- configuracion visual para mostrar cliente principal y/o marca
- accion en `Pedidos / Historial` para abrir la factura cliente
- contrato interno `clientCommercialInvoiceContract`

## Diferencia entre Invoice carguera y Factura Comercial Cliente

### Invoice / Packing carguera

- orientado a carguera, logistica y exportacion
- usa detalle por caja
- incluye Mark, PO, DAE, AWB, HAWB, carrier y flight
- no es la factura comercial del cliente

### Factura Comercial Cliente

- orientada al cliente
- presenta el valor comercial en formato mas limpio
- puede salir agrupada o detallada
- mantiene separacion total respecto de SRI
- no reemplaza al packing logístico

## Que no es SRI

Esta fase NO implementa:

- factura electronica SRI
- autorizacion SRI
- XML SRI
- RIDE
- clave de acceso
- contabilizacion de ventas
- cuenta por cobrar real

Mensaje operativo vigente:

`Documento comercial preliminar. No corresponde a factura electronica autorizada por el SRI.`

## Que datos usa

Desde el `Pedido Maestro` usa:

- empresa Bless Flower demo
- cliente principal
- marca / cliente final
- destino
- fecha emision
- fecha vuelo
- DAE
- AWB / HAWB
- agencia de carga
- carrier / vuelo
- payment / expire
- moneda USD
- detalle comercial de las lineas
- totales del pedido

## Como imprimir

1. Abrir el ERP unico.
2. Ir a `Comercial / Exportaciones`.
3. Abrir `Pedido Maestro`.
4. Ir a `Factura cliente`.
5. Escoger vista `Agrupada` o `Detallada por caja`.
6. Activar o desactivar `cliente principal` y `marca / cliente final`.
7. Usar:
   - `Vista previa`
   - `Imprimir referencial`
   - `Vista previa real demo`
   - `Imprimir real demo`

Tambien puede imprimirse desde:

- `Centro de impresion`
- `Pedidos / Historial`

## Que falta para formato real final

Pendiente para fase posterior:

- confirmacion del formato final por cliente
- campos comerciales adicionales por cliente
- numeracion documental definitiva
- control de versiones del documento emitido
- descarga PDF formal
- envio por correo real

## Que falta para SRI

Pendiente para fase posterior:

- factura SRI exportacion
- XML firmado
- autorizacion
- RIDE
- clave de acceso
- conciliacion entre factura comercial cliente y factura tributaria

## Que falta para contabilidad y cartera

Pendiente para fase posterior:

- puente a cartera
- generacion de cuenta por cobrar
- asiento de venta
- control de anulacion contable
- trazabilidad entre pedido, factura cliente y factura SRI

## Validacion recomendada

- `npm run validate:shell`
- `npm run build`
- `npm run build:standalone`

## Siguiente fase recomendada

FASE 2F:

- preparar puente visual entre factura comercial cliente y cartera futura
- mantener separacion estricta con SRI
- definir numeracion documental comercial y revision por cliente
