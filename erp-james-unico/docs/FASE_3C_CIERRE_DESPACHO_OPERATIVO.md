# FASE 3C: Cierre Despacho Operativo

## Resumen

FASE 3C queda terminada en modo demo. Pedido Maestro y Despacho Operativo quedan conectados visualmente mediante `dispatchContract` y el servicio `despacho-service-demo.js`.

## Archivos principales

- `scripts/modules/operaciones/despacho-service-demo.js`
- `scripts/modules/operaciones/despacho-operativo.js`
- `scripts/modules/operaciones/panel-operativo.js`
- `scripts/modules/comercial/pedido-maestro.js`
- `scripts/modules/comercial/index.js`
- `scripts/config/module-registry.js`

## dispatchContract

`dispatchContract` define el intercambio visual entre Comercial y Operaciones para preparar, revisar y confirmar despachos demo. No ejecuta SQL, no toca Supabase y no descuenta inventario real.

## Servicio demo

`despacho-service-demo.js` mantiene el estado demo compartido de despacho y expone acciones para preparar, marcar listo, confirmar, observar, anular y reabrir despachos.

## Conexion Pedido Maestro y Despacho Operativo

- Pedido Maestro muestra la pestaña `Despacho`.
- Despacho Operativo muestra los mismos despachos demo.
- Ambos usan el mismo checklist y los mismos estados demo.
- El historial comercial registra eventos demo cuando existe pedido relacionado.

## Estados usados

Despacho:
- `PENDIENTE`
- `EN_PREPARACION`
- `LISTO_DESPACHO`
- `DESPACHADO_DEMO`
- `OBSERVADO`
- `ANULADO_DEMO`

Pedido comercial:
- `BORRADOR`
- `REFERENCIAL`
- `VALIDADO_COMERCIAL`
- `LISTO_BODEGA`
- `LISTO_DESPACHO`
- `DESPACHADO_DEMO`
- `CERRADO_DEMO`
- `ANULADO`
- `REABIERTO_DEMO`

## Checklist

Errores criticos:
- falta marca
- falta destino
- falta DAE
- DAE caducada
- pedido sin cajas
- pedido anulado

Advertencias:
- falta AWB
- falta HAWB
- falta carrier/vuelo
- etiquetas no generadas
- materiales faltantes
- reservas sin usar
- cajas sin reserva
- scanner real no conectado
- despacho demo no descuenta inventario real

## Que es demo

- El despacho es visual y operativo demo.
- La sincronizacion de estado comercial es local/demo.
- Los documentos HR, MP y etiquetas usan el centro de impresion demo.

## Que no afecta todavia

- No descuenta inventario real de rosas.
- No consume materiales reales.
- No genera contabilidad.
- No conecta scanner/Zebra real.
- No conecta Supabase.
- No implementa SRI.
- No modifica la Parte 1 original.

## Como probar

1. Abrir ERP unico.
2. Ir a `Comercial / Exportaciones -> Pedido Maestro`.
3. Abrir pestaña `Despacho`.
4. Preparar despacho demo.
5. Marcar listo despacho.
6. Confirmar despacho demo.
7. Ir a `Operaciones / Poscosecha -> Despacho operativo`.
8. Revisar el mismo estado.
9. Observar o reabrir despacho.
10. Revisar diagnostico.

## Riesgos pendientes

- Scanner/Zebra real pendiente.
- Descuento real de inventario pendiente.
- Integracion real con Parte 1 pendiente.
- Supabase, contabilidad real y SRI pendientes.

## Siguiente fase recomendada

No avanzar a FASE 3D sin aprobacion. La siguiente fase deberia definir adapter real de Parte 1 o pruebas visuales adicionales, manteniendo bloqueados inventario real, scanner real, Supabase, contabilidad y SRI.
