# FASE 3C-3: Pantalla Despacho Operativo

## Que se implemento

- Se actualizo `Operaciones / Poscosecha -> Despacho operativo` para consumir `scripts/modules/operaciones/despacho-service-demo.js`.
- La pantalla muestra resumen, filtros, tabla principal y detalle del despacho seleccionado.
- La tabla incluye pedido, vuelo, cliente, marca, destino, DAE, guias, agencia, totales, estados operativos y acciones demo.
- El detalle muestra datos generales, cajas, reservas, materiales y checklist generado por `validateDispatchReadinessDemo`.
- El panel de diagnostico deja explicito que el despacho operativo demo esta activo y que scanner real e inventario real siguen pendientes.

## Datos que usa

- `dispatchContract` documentado en `docs/CONTRATOS_INTERNOS_MODULOS.md`.
- Servicio en memoria `BlessERP.operacionesDispatchDemo`.
- Despachos demo devueltos por `getDispatchesDemo`.
- Validacion demo devuelta por `validateDispatchReadinessDemo`.

## Acciones demo disponibles

- Ver detalle.
- Marcar listo despacho con `markDispatchReadyDemo`.
- Confirmar despacho demo con `confirmDispatchDemo`.
- Observar con `observeDispatchDemo`.
- Anular demo con `cancelDispatchDemo`.
- Reabrir demo con `reopenDispatchDemo`.

## Que no afecta inventario real

- No descuenta inventario de rosas.
- No consume inventario de suministros o empaque.
- No genera movimientos de bodega reales.
- No conecta scanner ni Zebra real.
- No genera asientos contables.
- No ejecuta SQL ni toca Supabase.
- No implementa SRI.

## Como probar

1. Abrir el ERP unico.
2. Ir a `Operaciones / Poscosecha`.
3. Abrir `Despacho operativo`.
4. Revisar tarjetas de resumen.
5. Filtrar por estado, destino, marca, fecha o busqueda por pedido.
6. Ver la tabla de despachos demo.
7. Abrir detalle de un pedido.
8. Revisar cajas, reservas, materiales y checklist.
9. Marcar listo despacho.
10. Confirmar despacho demo solo cuando el estado sea `LISTO_DESPACHO`.
11. Probar observar, anular demo y reabrir demo.

## Siguiente paso recomendado

- Fase 3C-4: conectar visualmente el estado de despacho desde `Pedido Maestro` sin mover logica pesada ni generar consumo real.
