# FASE 3B DISPONIBILIDAD OPERACIONES COMERCIAL

## Que se implemento

- Se conecto visualmente la disponibilidad demo de Operaciones / Poscosecha con Comercial / Exportaciones.
- `availabilityContract` y `reservationContract` quedaron activos en modo demo local.
- Operaciones ahora muestra saldo, reservas asociadas y liberacion demo por fila de disponibilidad.
- Pedido Maestro ahora consulta la misma disponibilidad compartida, permite reservar, confirmar, liberar y crear lineas desde una reserva demo.
- Pedidos / Historial y Panel comercial muestran indicadores de reservas demo, ramos sin usar y lineas sin reserva.
- Diagnostico y registry reflejan el nuevo enlace visual Operaciones -> Comercial.

## Que sigue siendo demo

- No se conecta disponibilidad real de Parte 1.
- No se consume inventario real de rosas.
- No se descuenta stock real en Operaciones.
- No se conecta a despacho real, scanner real ni Zebra real.
- No existe integracion con contabilidad, cartera, SRI ni Supabase.

## Contratos usados

- `availabilityContract`
- `reservationContract`
- `commercialOrderContract`
- `commercialWorkflowContract`

## Flujo visual actual

1. Operaciones publica disponibilidad demo compartida.
2. Comercial consulta la misma disponibilidad desde Pedido Maestro.
3. Comercial reserva ramos demo por fila.
4. La reserva reduce saldo visual en Operaciones y Comercial.
5. Comercial puede crear una linea del pedido usando la reserva como origen.
6. La reserva puede confirmarse o liberarse.
7. Todo queda en almacenamiento local del shell unico.

## Lo que no se debe tocar todavia

- No copiar logica pesada de Parte 1.
- No conectar disponibilidad real.
- No tocar Supabase.
- No ejecutar SQL ni crear migraciones.
- No mezclar inventario de rosas con inventario administrativo.
- No enviar ventas a contabilidad real.

## Riesgos pendientes

- Las reservas demo no reemplazan una trazabilidad real de inventario operativo.
- Si luego se integra Parte 1 real, habra que mapear estados y cantidades sin romper los documentos comerciales ya activos.
- Las lineas antiguas del pedido pueden quedar sin reserva asociada hasta que se migren o se reconstruyan desde el flujo demo.
- La liberacion y confirmacion siguen siendo visuales y no disparan workflow operativo real.

## Como probar

1. Abrir el ERP unico.
2. Ir a `Operaciones / Poscosecha -> Disponibilidad`.
3. Revisar filas demo con saldo y reservas en cero o activas.
4. Ir a `Comercial / Exportaciones -> Pedido Maestro`.
5. Abrir la pestaña `Disponibilidad / Reservas`.
6. Seleccionar una fila exportable y reservar ramos demo.
7. Confirmar que el saldo baja en la misma pestaña.
8. Crear una linea desde la reserva demo.
9. Volver a `Cajas y variedades` y validar la referencia de reserva en la linea.
10. Ir a `Pedidos / Historial` y revisar indicadores de reservas, ramos sin usar y lineas sin reserva.
11. Volver a `Operaciones -> Disponibilidad` y validar la misma reserva asociada.
12. Liberar la reserva demo y confirmar que el saldo vuelve a mostrarse disponible.

## Siguiente fase recomendada

- FASE 3C: adaptar disponibilidad real de Parte 1 hacia este mismo contrato compartido, sin mover todavia toda la logica pesada del prototipo operativo.
