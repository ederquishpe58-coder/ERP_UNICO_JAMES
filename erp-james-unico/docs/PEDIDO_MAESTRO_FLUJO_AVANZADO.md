# Pedido Maestro: estructura y flujo operativo

## Objetivo

El Pedido Maestro es la fuente unica de la orden comercial. Ventas define cliente, marca, logistica y contenido de cajas. Bodega recibe la misma orden y completa cada caja validando codigos de ramos ya ingresados al inventario.

No se reservan ramos individuales. La disponibilidad se presenta como:

`stock fisico de ramos - demanda pendiente de pedidos liberados = saldo proyectado`

## Estructura del pedido

### 1. Cabecera comercial

- Numero de pedido.
- Fecha de emision.
- Cliente principal.
- Marca o cliente final.
- Destino y pais.
- Tipo de transporte: aereo, maritimo o terrestre.
- PO general y observaciones.

### 2. Logistica

- Fecha de vuelo.
- Agencia de carga y cuarto frio.
- Linea aerea, carrier y vuelo.
- AWB y HAWB.
- DAE y fecha de caducidad.

Para transporte maritimo se permite mantener la DAE pendiente. Para transporte aereo la DAE forma parte de la validacion comercial.

### 3. Orden de cajas

Cada caja tiene numero, tipo y PO. Una caja puede contener varias lineas. Cada linea contiene:

- Variedad.
- Medida.
- Numero de ramos.
- Tallos por ramo.
- Total de tallos.
- Precio unitario y total comercial.

### 4. Cobertura operativa

El sistema compara cada linea con inventario fisico por variedad, medida y tallos por ramo. El resultado puede ser `DISPONIBLE`, `PARCIAL` o `FALTANTE`. Un faltante genera advertencia, no una reserva ni un descuento anticipado.

### 5. Bodega y seguimiento

Al liberar el pedido:

1. La orden aparece en Bodega de rosas.
2. Bodega abre el detalle y selecciona una caja.
3. Cada codigo de ramo se valida contra variedad, medida y tallos por ramo.
4. La linea incrementa ramos leidos y reduce pendientes.
5. El ramo queda asignado a pedido y caja.
6. La disponibilidad fisica se actualiza.
7. La caja pasa automaticamente a completa al cubrir todas sus lineas.
8. Pedido Maestro refleja el mismo avance sin volver a capturar datos.

Si Ventas agrega cajas despues de liberar la orden, debe abrir una revision. Las cajas anteriores quedan bloqueadas y Bodega recibe una notificacion de las cajas nuevas.

## Estados principales

- Comercial: `BORRADOR`, `REFERENCIAL`, `VALIDADO_COMERCIAL`, `LISTO_BODEGA`, `LISTO_DESPACHO`, `DESPACHADO_DEMO`, `CERRADO_DEMO`, `ANULADO`.
- Bodega: `NO_LIBERADO`, `LIBERADO_BODEGA`, `EN_ARMADO`, `ACTUALIZADO_POR_VENTAS`, `COMPLETO_BODEGA`.
- Caja: `PENDIENTE`, `EN_PROCESO`, `ARMADA_COMPLETA`, `CERRADA_BODEGA`.

## Limites actuales

Todo funciona en modo local/demo. No conecta Supabase, no reserva inventario real, no genera contabilidad real, no emite SRI y no conecta el lector Zebra fisico todavia.
