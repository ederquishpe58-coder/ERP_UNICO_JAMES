# FASE 3E-1 Consumo Inventario Rosas Demo

## Que se implemento

- Se agrego `operationalConsumptionContract`.
- Se creo el servicio `scripts/modules/operaciones/consumo-inventario-demo.js`.
- `Operaciones / Poscosecha -> Despacho operativo` ahora puede simular y revertir consumo demo.
- `Operaciones / Poscosecha -> Inventario de rosas` ahora muestra:
  - resumen de consumo demo
  - tabla de consumos demo
  - kardex operativo demo
- `Comercial / Exportaciones -> Pedido Maestro -> Despacho` ahora visualiza el consumo demo y puede lanzar la simulacion.
- El checklist de despacho ahora incluye `Consumo demo simulado`.

## Como funciona operationalConsumptionContract

Origen:
- Operaciones / Poscosecha

Destino:
- Inventario de rosas demo
- Despacho operativo
- Comercial

El contrato registra consumo simulado por pedido, despacho, reserva, availability y caja, sin afectar stock real ni contabilidad.

## Como funciona consumo-inventario-demo.js

Funciones creadas:

- `getConsumptionsDemo()`
- `getConsumptionsByOrderDemo(pedidoId)`
- `simulateConsumptionFromDispatchDemo(pedidoId)`
- `validateConsumptionReadinessDemo(pedidoId)`
- `reverseConsumptionDemo(pedidoId, motivo)`
- `getConsumptionSummaryDemo()`
- `getKardexOperativoDemo()`
- `getKardexByOrderDemo(pedidoId)`

El servicio usa solo estado local/demo del ERP.

## Como se calcula el consumo desde cajas y reservas

Flujo demo:

1. Se lee el despacho demo del pedido.
2. Se leen las cajas del pedido.
3. Si existen lineas comerciales, se toman variedad, longitud, ramos y tallos desde esas lineas.
4. Si no hay lineas suficientes, se hace fallback sobre el resumen de caja.
5. Si existe `reservation_id`, se busca la reserva demo y su `availability_id`.
6. Se generan filas de consumo demo por caja/linea.
7. Se genera kardex operativo demo con tipo `CONSUMO_DESPACHO_DEMO`.

## Que es kardex operativo demo

Es un historial visual de movimientos operativos de rosas:

- `CONSUMO_DESPACHO_DEMO`
- `REVERSO_CONSUMO_DEMO`

No corresponde al inventario real.
No corresponde a contabilidad.
No debe mezclarse con inventario de suministros/empaque.

## Que no afecta todavia

- No descuenta inventario real.
- No toca Supabase.
- No ejecuta SQL.
- No genera asientos contables.
- No consume materiales reales.
- No conecta scanner real.
- No modifica Parte 1 original.

## Como probar

1. Abrir el ERP unico.
2. Ir a `Comercial / Exportaciones -> Pedido Maestro`.
3. Confirmar despacho demo de un pedido.
4. Ir a `Operaciones / Poscosecha -> Despacho operativo`.
5. Abrir el detalle del despacho.
6. Presionar `Simular consumo demo`.
7. Revisar el bloque de consumo de inventario demo.
8. Revisar el kardex operativo demo.
9. Ir a `Operaciones / Poscosecha -> Inventario de rosas`.
10. Verificar tablas de consumo demo y kardex demo.
11. Revertir consumo demo con motivo.
12. Revisar diagnostico.

## Riesgos futuros

- Si el flujo real usa otra granularidad de caja/ramo, el contrato debera ajustarse.
- El saldo demo del kardex no reemplaza el motor real por movimientos.
- Cuando se conecte Parte 1 real, el descuento operativo debera validarse contra trazabilidad real por reserva y disponibilidad.

## Siguiente fase recomendada

Conectar el consumo demo con una trazabilidad operativa mas fina por reserva/caja y dejar preparado el adapter hacia descuento real de inventario de rosas, sin activarlo todavia.
