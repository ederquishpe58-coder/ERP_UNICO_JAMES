# Flujo de armado de cajas y revisiones del pedido

## Armado por escaneo de ramos

- La caja no se escanea.
- Bodega selecciona una caja del pedido.
- El sistema muestra variedad, medida, tallos por ramo, cantidad requerida, escaneada y pendiente.
- Cada lectura corresponde a una etiqueta numerica de ramo de 10 digitos previamente ingresada al Inventario de rosas.
- La lectura valida variedad, medida, tallos por ramo, disponibilidad y duplicidad.
- Una caja puede quedar `INCOMPLETA` o `EN_PROCESO` mientras Bodega trabaja en otra.
- Cuando todas sus lineas llegan a cero pendientes, la caja cambia automaticamente a `ARMADA_COMPLETA`.
- Cuando todas las cajas estan completas, el pedido cambia automaticamente a `COMPLETO_BODEGA`.
- No existe una segunda confirmacion mediante escaneo de caja.

## Revision por nueva caja solicitada

1. El pedido debe estar liberado a Bodega y no puede estar despachado, cerrado o anulado.
2. Ventas pulsa `Modificar pedido` y registra el motivo del cliente.
3. Se abre una revision numerada.
4. Las cajas anteriores permanecen bloqueadas y conservan todos sus ramos escaneados.
5. Ventas agrega una o mas cajas nuevas.
6. Al pulsar `Enviar actualizacion a Bodega`, se valida que las cajas tengan numeros nuevos y detalle completo.
7. El pedido cambia a `ACTUALIZADO_POR_VENTAS`.
8. Bodega y Despacho muestran `NUEVA CAJA Rn` y el motivo.
9. Bodega pulsa `Actualizacion revisada`.
10. La nueva caja se arma mediante el mismo escaner de ramos.

## Bloqueos

- Una revision no permite editar ni eliminar cajas anteriores.
- Un pedido despachado no se modifica; requiere un pedido complementario.
- Una nueva caja conserva cliente, marca, vuelo, destino y condiciones logisticas del pedido original.
- Si esas condiciones cambian, se recomienda crear otro pedido relacionado.

## Estados compartidos

- `LIBERADO_BODEGA`
- `EN_ARMADO`
- `ACTUALIZADO_POR_VENTAS`
- `CAMBIO_REVISADO_BODEGA`
- `COMPLETO_BODEGA`

## Alcance actual

El flujo es local/demo. No conecta Supabase, Zebra real, inventario real, materiales, contabilidad ni SRI.

