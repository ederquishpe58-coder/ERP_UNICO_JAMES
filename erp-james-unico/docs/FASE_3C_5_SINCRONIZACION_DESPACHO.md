# FASE 3C-5: Sincronizacion visual de despacho

## Que se sincronizo

- `Pedido Maestro -> Despacho` y `Operaciones / Poscosecha -> Despacho operativo` usan el mismo servicio demo `scripts/modules/operaciones/despacho-service-demo.js`.
- El estado compartido vive en memoria/local state demo dentro de `operaciones.dispatches`.
- Las acciones de preparar, marcar listo, confirmar, observar, anular y reabrir actualizan el mismo registro demo.
- El historial comercial registra eventos demo cuando existe un pedido comercial relacionado.

## Checklist unico

El checklist se genera desde `validateDispatchReadinessDemo` y se muestra en ambos lados.

Incluye cliente, marca, destino, DAE, vigencia DAE, fecha vuelo, AWB, HAWB, agencia, carrier/vuelo, cajas, tallos, reservas, etiquetas, materiales, documentos HR/MP/Packing/Invoice, scanner pendiente e inventario real no descontado.

## Reglas de transicion

- `PENDIENTE` o `EN_PREPARACION` pueden pasar a `LISTO_DESPACHO` si no hay errores criticos.
- `LISTO_DESPACHO` puede pasar a `DESPACHADO_DEMO`.
- `OBSERVADO` y `ANULADO_DEMO` pueden reabrirse a `EN_PREPARACION`.
- `OBSERVADO` no elimina el despacho ni el pedido.
- `ANULADO_DEMO` anula solo el despacho demo y no elimina el pedido.

## Estados compartidos

- `PENDIENTE`
- `EN_PREPARACION`
- `LISTO_DESPACHO`
- `DESPACHADO_DEMO`
- `OBSERVADO`
- `ANULADO_DEMO`

## Que sigue siendo demo

- La sincronizacion con estado comercial intenta usar el workflow existente si la transicion es valida.
- Si el workflow comercial bloquea la transicion, el despacho conserva su estado demo y muestra sincronizacion visual pendiente.
- No hay scanner real.
- No hay descuento real de inventario.
- No hay consumo real de materiales.
- No hay Supabase, SQL, contabilidad ni SRI.

## Como probar desde Pedido Maestro

1. Abrir `Comercial / Exportaciones -> Pedido Maestro`.
2. Seleccionar un pedido demo con cajas y DAE.
3. Abrir la pestaña `Despacho`.
4. Preparar despacho demo.
5. Revisar checklist, errores y advertencias.
6. Marcar listo despacho.
7. Confirmar despacho demo si el estado es `LISTO_DESPACHO`.
8. Revisar historial del pedido.

## Como probar desde Operaciones

1. Abrir `Operaciones / Poscosecha -> Despacho operativo`.
2. Buscar el pedido preparado desde Pedido Maestro.
3. Confirmar que el estado coincide.
4. Observar o reabrir despacho.
5. Volver a Pedido Maestro y confirmar que el estado visual cambio.

## Siguiente paso recomendado

- Fase 3C-6: preparar adaptador real de Parte 1 para scanner, despacho fisico y descuento operativo, aun sin tocar Supabase ni inventario real hasta aprobacion.
