# FASE 2F FLUJO ESTADOS HISTORIAL COMERCIAL

## Que se implemento

- Se creo una capa nueva `scripts/modules/comercial/comercial-workflow.js` para separar estados, transiciones, bloqueos, historial y politica documental del resto del modulo comercial.
- El `Pedido Maestro` ahora muestra un panel superior de estado con progreso visual, siguiente accion sugerida, errores, advertencias y transiciones permitidas.
- Se agrego historial comercial por pedido en memoria/local demo con eventos de:
  - crear pedido
  - editar cliente / marca
  - cambiar DAE
  - agregar, editar, duplicar y eliminar lineas
  - recalcular bodega
  - generar / imprimir documentos demo
  - cambiar estado
  - anular
  - reabrir
- `Pedidos / Historial` paso a tener filtros completos, resumen por estados y acciones controladas sobre cada pedido.
- Se preparo `commercialWorkflowContract` en configuracion y documentacion.

## Estados del pedido

- `BORRADOR`
- `REFERENCIAL`
- `VALIDADO_COMERCIAL`
- `LISTO_BODEGA`
- `LISTO_DESPACHO`
- `DESPACHADO_DEMO`
- `CERRADO_DEMO`
- `ANULADO`
- `REABIERTO_DEMO`
- `AUTORIZADO_SRI_FUTURO`

## Matriz de transiciones

- `BORRADOR -> REFERENCIAL`
- `BORRADOR -> ANULADO`
- `REFERENCIAL -> BORRADOR`
- `REFERENCIAL -> VALIDADO_COMERCIAL`
- `REFERENCIAL -> ANULADO`
- `VALIDADO_COMERCIAL -> LISTO_BODEGA`
- `VALIDADO_COMERCIAL -> REABIERTO_DEMO`
- `VALIDADO_COMERCIAL -> ANULADO`
- `LISTO_BODEGA -> LISTO_DESPACHO`
- `LISTO_BODEGA -> REABIERTO_DEMO`
- `LISTO_BODEGA -> ANULADO`
- `LISTO_DESPACHO -> DESPACHADO_DEMO`
- `LISTO_DESPACHO -> REABIERTO_DEMO`
- `LISTO_DESPACHO -> ANULADO`
- `DESPACHADO_DEMO -> CERRADO_DEMO`
- `DESPACHADO_DEMO -> REABIERTO_DEMO`
- `CERRADO_DEMO -> REABIERTO_DEMO`
- `REABIERTO_DEMO -> BORRADOR`
- `REABIERTO_DEMO -> REFERENCIAL`

## Validaciones por etapa

- Para `REFERENCIAL`:
  - cliente principal
  - marca / cliente final
  - al menos una linea comercial
- Para `VALIDADO_COMERCIAL`:
  - sin errores criticos comerciales
  - cliente, marca, destino, DAE vigente si aplica, fechas, detalle, precio y total USD
- Para `LISTO_BODEGA`:
  - pedido ya validado comercialmente
  - materiales calculados
  - etiquetas demo generadas al menos una vez
  - bodega marcada como revisada / preparada demo
- Para `LISTO_DESPACHO`:
  - invoice carguera real demo listo
  - packing listo
  - HR lista
  - MP listo
  - etiquetas listas
  - control DAE sin errores criticos
- Para `DESPACHADO_DEMO`:
  - solo desde `LISTO_DESPACHO`
  - confirmacion del usuario
- Para `CERRADO_DEMO`:
  - solo desde `DESPACHADO_DEMO`
  - confirmacion del usuario

## Que bloquea edicion

- `BORRADOR`: edicion completa.
- `REFERENCIAL`: editable, pero se advierte que puede afectar documentos emitidos.
- `VALIDADO_COMERCIAL`: se bloquean cliente, marca, DAE y cajas; para cambiar datos criticos hay que reabrir.
- `LISTO_BODEGA`: mantiene bloqueados datos criticos y lineas.
- `LISTO_DESPACHO`: edicion directa bloqueada.
- `DESPACHADO_DEMO`: edicion bloqueada.
- `CERRADO_DEMO`: edicion bloqueada; solo consulta y reimpresion.
- `ANULADO`: todo bloqueado salvo consulta y copia anulada.

## Como se duplica un pedido

- La accion vive en `Comercial / Exportaciones -> Pedidos / Historial`.
- Genera nuevo numero demo.
- Copia cliente, marca, destino y lineas.
- Limpia AWB, HAWB y estado documental.
- Recalcula DAE segun destino y fecha nueva.
- Arranca en `BORRADOR`.
- No arrastra historial anterior; crea evento `duplicado desde pedido X`.

## Documentos habilitados por estado

- `BORRADOR`: vista previa preliminar con advertencias.
- `REFERENCIAL`: documentos referenciales permitidos.
- `VALIDADO_COMERCIAL`: ya permite real demo para documentos comerciales que lo soportan.
- `LISTO_DESPACHO`: habilita impresion final demo de packing, HR, MP, etiquetas y control DAE.
- `ANULADO`: bloquea impresion real demo; mantiene copia anulada / referencial.
- `CERRADO_DEMO`: solo reimpresion y consulta.

## Que sigue siendo demo

- No hay SRI real.
- No hay XML ni RIDE.
- No hay contabilidad ni cartera real de ventas.
- No hay disponibilidad real de Parte 1.
- No hay consumo real de inventario de empaque.

## Que falta para auditoria real

- Conectar el historial del pedido con la bitacora central del core de forma mas profunda.
- Añadir filtros dedicados del historial comercial dentro del modulo Auditoria.
- Definir usuarios y permisos reales, no solo usuario visual demo.

## Que falta para conexion con contabilidad y SRI

- Adaptador de ventas hacia cartera / CxC.
- Politica contable para contabilizacion de exportaciones.
- Factura SRI de exportacion y autorizacion real.
- Integracion de disponibilidad y reservas reales con Operaciones / Poscosecha.
