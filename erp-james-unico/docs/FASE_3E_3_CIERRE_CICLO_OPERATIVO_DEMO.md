# FASE 3E-3 - Cierre del ciclo operativo demo

## Resumen del ciclo operativo demo

El ERP unico deja visible el flujo operativo demo completo:

1. Inventario de rosas demo
2. Disponibilidad comercial demo
3. Reserva desde Pedido Maestro
4. Cajas del pedido
5. Despacho operativo demo
6. Escaneo de cajas demo
7. Consumo demo de inventario de rosas
8. Kardex operativo demo
9. Diagnostico del ciclo

Todo el flujo sigue siendo DEMO.

## Contratos usados

- `operationalInventoryContract`
- `availabilityContract`
- `reservationContract`
- `dispatchContract`
- `scannerEventContract`
- `operationalConsumptionContract`

## Servicios usados

- `scripts/modules/operaciones/disponibilidad-service-demo.js`
- `scripts/modules/operaciones/despacho-service-demo.js`
- `scripts/modules/operaciones/scanner-service-demo.js`
- `scripts/modules/operaciones/consumo-inventario-demo.js`
- `scripts/modules/operaciones/parte1-adapter.js`
- `scripts/modules/operaciones/operational-cycle-demo.js`

## Pantallas afectadas

- `Operaciones / Poscosecha -> Panel operativo`
- `Operaciones / Poscosecha -> Inventario de rosas`
- `Operaciones / Poscosecha -> Disponibilidad`
- `Operaciones / Poscosecha -> Despacho operativo`
- `Comercial / Exportaciones -> Panel comercial`
- `Comercial / Exportaciones -> Pedido Maestro -> Despacho`
- `Core del sistema -> Diagnostico / Estado del ERP`

## Flujo completo paso a paso

### 1. Inventario de rosas demo

- Muestra el inventario operativo visual.
- Sigue separado del inventario administrativo de suministros y empaque.
- Expone el resumen del ciclo operativo y el kardex demo.

### 2. Disponibilidad demo

- Se deriva visualmente del frente operativo.
- Comercial consulta esta disponibilidad sin crear inventario propio.
- Se muestra la relacion disponibilidad -> reservas -> pedidos -> consumo demo.

### 3. Reserva demo

- Se registra desde Pedido Maestro.
- Reduce saldo demo visible, pero no toca inventario real.
- Queda ligada al pedido y a la disponibilidad operativa demo.

### 4. Cajas del pedido

- Se preparan desde Pedido Maestro.
- El despacho demo consume estas cajas como base operativa.

### 5. Despacho operativo demo

- Usa `dispatchContract`.
- Lee reservas, cajas, escaneo y consumo demo.
- No descuenta inventario real ni confirma despacho real.

### 6. Escaneo de cajas demo

- Usa `scannerEventContract`.
- Marca cajas escaneadas, pendientes o duplicadas en modo demo.

### 7. Consumo demo

- Usa `operationalConsumptionContract`.
- Se simula solo despues del despacho demo.
- No altera stock real ni Supabase.

### 8. Kardex operativo demo

- Muestra movimientos demo de consumo y reverso.
- No afecta contabilidad ni inventario real.

## Que datos son demo

- disponibilidad
- reservas
- despachos
- escaneos
- consumos
- kardex
- estado del adaptador Parte 1

## Que no afecta inventario real

- El consumo demo no descuenta stock real.
- El escaneo demo no confirma despacho real.
- El kardex demo no persiste en una base real.
- El ciclo demo no mueve datos a Supabase.

## Que no afecta contabilidad

- No genera asientos.
- No genera costo contable real por despacho.
- No genera CxC ni ventas reales.

## Que falta para integracion real Parte 1

- levantar payloads reales de inventario de rosas
- homologar estados y campos
- activar el adapter contra una fuente real controlada
- conectar reservas reales al inventario operativo real
- conectar consumo real por movimientos

## Que falta para Supabase

- definir tablas reales
- definir sincronizacion
- definir auditoria persistente
- aprobar SQL y migraciones

## Riesgos futuros

- diferencias de campos entre Parte 1 y contratos internos
- estados no homologados
- tentacion de importar `app.js` completo de Parte 1
- mezclar inventario de rosas con inventario administrativo

## Siguiente fase recomendada

Hacer una fase de levantamiento controlado de payloads reales de Parte 1, sin integrarlos todavia, y validar el mapeo real contra:

- `operationalInventoryContract`
- `availabilityContract`
- `reservationContract`
- `dispatchContract`
- `operationalConsumptionContract`
