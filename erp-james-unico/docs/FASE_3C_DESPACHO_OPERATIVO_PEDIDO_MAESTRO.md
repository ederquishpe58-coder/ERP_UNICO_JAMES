# FASE 3C: Despacho Operativo conectado visualmente con Pedido Maestro

Estado final: FASE 3C terminada en demo. Pedido Maestro queda conectado visualmente con Despacho Operativo mediante `dispatchContract`, usando checklist unificado y servicio demo compartido.

## Que se implemento

- Se reforzo `dispatchContract` como contrato demo entre `Comercial / Exportaciones` y `Operaciones / Poscosecha`.
- Se creo el servicio `scripts/modules/operaciones/despacho-service-demo.js` para preparar, validar, observar, confirmar, anular y reabrir despachos demo.
- `Operaciones / Poscosecha -> Despacho operativo` ahora consume pedidos del `Pedido Maestro` y muestra:
  - estado del pedido
  - estado del despacho
  - cajas
  - reservas
  - materiales
  - documentos de salida
- `Comercial / Exportaciones -> Pedido Maestro` ahora tiene pestaña `Despacho` con:
  - checklist operativo
  - estado documental
  - detalle de cajas
  - uso de reservas
  - revision de materiales
  - acciones demo para preparar, marcar listo y confirmar despacho
- El flujo comercial ahora valida mejor las transiciones:
  - `LISTO_BODEGA -> LISTO_DESPACHO`
  - `LISTO_DESPACHO -> DESPACHADO_DEMO`
  - `DESPACHADO_DEMO -> CERRADO_DEMO`
- La impresion disparada desde Despacho operativo actualiza `documentActivity` del pedido, para que las validaciones no queden desfasadas.

## Flujo demo cubierto

1. Reserva demo desde disponibilidad compartida.
2. Cajas y variedades en Pedido Maestro.
3. Etiquetas demo.
4. Revision visual de bodega / materiales.
5. Pedido en `LISTO_DESPACHO`.
6. Confirmacion `DESPACHADO_DEMO`.
7. Cierre demo posterior desde el flujo comercial.

## Contratos usados

- `availabilityContract`
- `reservationContract`
- `dispatchContract`
- `packagingRequirementContract`
- `boxLabelContract`
- `commercialWorkflowContract`

## Que sigue siendo demo

- No se descuenta inventario real de rosas.
- No se consume inventario real de materiales.
- No se conecta scanner ni Zebra real.
- No se toca Supabase.
- No se ejecuta SQL.
- No se genera contabilidad real.
- No se genera SRI.
- No se modifica la Parte 1 original.

## Riesgos pendientes

- El despacho sigue dependiendo de datos demo y no de la Parte 1 real.
- La confirmacion de despacho no bloquea por faltantes de materiales; solo advierte.
- Las guias, DAE y etiquetas siguen en modo visual/demo, sin validacion externa.
- El cierre demo no genera evidencia operativa real ni consumo fisico.

## Como probar

1. Abrir el ERP unico.
2. Ir a `Comercial / Exportaciones`.
3. Abrir `Pedido Maestro`.
4. Seleccionar un pedido demo con cajas y reservas.
5. Ir a la pestaña `Despacho`.
6. Revisar checklist, cajas, reservas y materiales.
7. Generar vista previa de invoice, packing, HR, MP o etiquetas.
8. Marcar `Listo despacho`.
9. Confirmar `Despacho demo`.
10. Ir a `Operaciones / Poscosecha -> Despacho operativo`.
11. Verificar que el pedido aparezca con el mismo estado y documentos.
12. Reimprimir HR, MP, etiquetas o factura comercial cliente demo desde Operaciones.

## Comandos de validacion

- `npm run build`
- `npm run build:standalone`
- `npm run validate:shell`

## Siguiente fase recomendada

- FASE 3D: recepcion / clasificacion / inventario operativo con adapters visuales mas finos, manteniendo la separacion respecto a la Parte 1 real hasta aprobacion explicita.
