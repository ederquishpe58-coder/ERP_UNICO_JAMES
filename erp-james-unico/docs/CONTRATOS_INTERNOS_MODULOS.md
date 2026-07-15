# CONTRATOS INTERNOS MODULOS

## Objetivo

Definir como se comunicaran los modulos del ERP unico sin mezclar logica pesada de Parte 1, Parte 2 y Parte 3 dentro de un solo archivo o flujo monolitico.

## Reglas base

- Operaciones / Poscosecha sigue siendo el origen del inventario de rosas.
- Comercial / Exportaciones consume disponibilidad, pero no crea inventario de rosas.
- Inventario suministros / empaque sigue separado del inventario de rosas.
- Contabilidad y cartera no deben recibir ventas definitivas hasta que exista el flujo aprobado.
- En FASE 3B `availabilityContract` y `reservationContract` quedan activos en modo demo local, sin tocar Parte 1 real.

## Matriz rapida de estado

| Contrato | Estado actual | Afecta contabilidad | Afecta inventario real | Supabase futuro |
| --- | --- | --- | --- | --- |
| `availabilityContract` | demo activo / pendiente real | No | No en esta fase | Si |
| `reservationContract` | demo activo / pendiente real | No | No en esta fase | Si |
| `commercialOrderContract` | demo integrado | Futuro | No | Si |
| `boxDetailContract` | demo preparado | No | No | Si |
| `packagingRequirementContract` | demo integrado | No en esta fase | No en esta fase | Si |
| `salesAccountingContract` | preparado / pendiente real | Preparado | No | Si |
| `clientCommercialInvoiceContract` | demo activo | Futuro | No | Si |
| `commercialWorkflowContract` | demo activo | No en esta fase | No en esta fase | Si |
| `dispatchContract` | demo activo | No en esta fase | No en esta fase | Si |
| `scannerEventContract` | demo activo | No | No | Si |
| `operationalInventoryContract` | preparado demo / pendiente Parte 1 real | No | Preparado / pendiente real | Si |
| `bunchLabelContract` | demo visual | No | No | Si |
| `operationalConsumptionContract` | activo demo | No | Simulado solamente | Si |
| `auditEventContract` | pendiente integracion persistente | No directo | No directo | Si |

## A. Contrato disponibilidad de rosas

Nombre sugerido: `availabilityContract`

Origen:
- Operaciones / Poscosecha
- Inventario operativo de rosas de Parte 1 futuro

Destino:
- Comercial / Exportaciones

Campos:
- `availability_id`
- `fecha`
- `variedad`
- `longitud`
- `tallos_por_ramo`
- `ramos_disponibles`
- `tallos_disponibles`
- `ramos_reservados_demo`
- `tallos_reservados_demo`
- `ramos_saldo_demo`
- `tallos_saldo_demo`
- `bodega`
- `proveedor`
- `bloque`
- `categoria`
- `estado`
- `edad_dias`
- `fecha_ingreso_bodega`
- `observacion`

Uso en Comercial:
- Pedido Maestro consulta disponibilidad.
- Comercial puede reservar ramos.
- Comercial no crea inventario de rosas.
- Comercial no modifica clasificacion directamente.
- El origen futuro sera Parte 1 POSCOSECHA mediante `parte1-adapter.js`.
- Las reservas reales futuras deberan actualizar el inventario operativo mediante el adaptador.
- El saldo demo se recalcula en ambos modulos al reservar o liberar.
- No se toca inventario real de rosas en esta fase.

## B. Contrato reserva de flor

Nombre sugerido: `reservationContract`

Origen:
- Comercial / Exportaciones

Destino:
- Operaciones / Poscosecha

Campos:
- `reservation_id`
- `pedido_id`
- `numero_pedido`
- `cliente_principal`
- `marca_cliente_final`
- `fecha_pedido`
- `fecha_vuelo`
- `availability_id`
- `variedad`
- `longitud`
- `tallos_por_ramo`
- `ramos_reservados`
- `tallos_reservados`
- `bodega`
- `proveedor`
- `bloque`
- `estado`
- `usuario_demo`
- `fecha_hora`
- `observacion`

Reglas:
- Una reserva reduce disponibilidad comercial.
- Una reserva no elimina inventario operativo.
- Si se anula pedido, debe liberar reserva.
- Operaciones puede visualizar y liberar reservas demo.
- Comercial puede crear lineas del pedido usando la reserva demo como origen.
- No se conecta todavia a Parte 1 real, inventario real ni despacho real.

## C. Contrato pedido comercial

Nombre sugerido: `commercialOrderContract`

Origen:
- Comercial / Exportaciones

Destino:
- Contabilidad / Cartera / Reportes

Campos:
- `pedido_id`
- `numero_pedido`
- `cliente_principal_id`
- `cliente_principal_nombre`
- `marca_id`
- `marca_nombre`
- `destino`
- `fecha_emision`
- `fecha_vuelo`
- `estado`
- `total_cajas`
- `total_fulls`
- `total_ramos`
- `total_tallos`
- `total_usd`
- `dae`
- `awb`
- `hawb`
- `agencia_carga`
- `linea_aerea`
- `tipo_transporte`
- `observacion`

Uso futuro:
- generar factura cliente
- generar cuenta por cobrar
- reportes comerciales
- reportes gerenciales
- ATS futuro si corresponde

## D. Contrato detalle de cajas

Nombre sugerido: `boxDetailContract`

Origen:
- Comercial / Exportaciones

Destino:
- Bodega empaque / Reportes / Impresion

Campos:
- `pedido_id`
- `box_id`
- `numero_caja`
- `tipo_caja`
- `full_equivalente`
- `variedad`
- `longitud`
- `ramos`
- `tallos_por_ramo`
- `total_tallos`
- `precio_unitario`
- `total_linea`
- `po`
- `marca_adicional`
- `estado`

## E. Contrato materiales de empaque requeridos

Nombre sugerido: `packagingRequirementContract`

Origen:
- Comercial / Exportaciones

Destino:
- Inventario suministros / empaque

Campos:
- `pedido_id`
- `box_id`
- `fecha`
- `tipo_caja`
- `cantidad_cajas`
- `material_codigo`
- `material_nombre`
- `categoria`
- `unidad`
- `requerido`
- `disponible`
- `faltante`
- `estado`
- `bodega`
- `origen_calculo`
- `consumo_real_id`
- `observacion`

Reglas:
- Comercial calcula materiales requeridos.
- Inventario suministros / empaque valida stock.
- Consumo real se hara desde inventario.
- No consumir automaticamente todavia.
- El origen del calculo en esta fase es `pedido_maestro`.
- `box_id` puede usarse para detalle por caja.
- `consumo_real_id` queda reservado para la futura integracion de inventario real.

## F. Contrato etiquetas de caja

Nombre sugerido: `boxLabelContract`

Origen:
- Comercial / Exportaciones

Destino:
- Centro de impresion / Zebra futuro / Reportes

Campos:
- `pedido_id`
- `box_id`
- `numero_caja`
- `total_cajas`
- `tipo_caja`
- `marca`
- `po`
- `destino`
- `dae`
- `awb`
- `hawb`
- `fecha_vuelo`
- `agencia_carga`
- `carrier`
- `vuelo`
- `contenido_resumido`
- `codigo_aduana`
- `barcode_value_futuro`
- `qr_value_futuro`
- `estado`

Reglas:
- Cada caja genera una etiqueta demo independiente.
- `codigo_aduana` es placeholder y no debe tratarse como codigo oficial.
- `barcode_value_futuro` y `qr_value_futuro` quedan preparados para Zebra, barcode y QR real.
- La impresion por rango e individual usa este contrato como base visual.

## G. Contrato factura comercial cliente

Nombre sugerido: `clientCommercialInvoiceContract`

Origen:
- Comercial / Exportaciones

Destino:
- Centro de impresion / Contabilidad futura / Cartera futura

Campos:
- `pedido_id`
- `invoice_cliente_id`
- `numero_invoice`
- `cliente_principal_id`
- `cliente_principal_nombre`
- `marca_id`
- `marca_nombre`
- `fecha_emision`
- `fecha_vuelo`
- `destino`
- `moneda`
- `total_cajas`
- `total_fulls`
- `total_ramos`
- `total_tallos`
- `total_usd`
- `estado`
- `es_sri`
- `sri_estado_futuro`
- `observacion`

Reglas:
- La factura comercial cliente se mantiene separada del Invoice / Packing carguera.
- `es_sri` en esta fase debe ser `false`.
- No corresponde a factura electronica autorizada por el SRI.
- La conexion con contabilidad y cartera queda reservada para una fase posterior.

## H. Contrato flujo comercial del pedido

Nombre sugerido: `commercialWorkflowContract`

Origen:
- Comercial / Exportaciones

Destino:
- Core / Auditoria / Centro de impresion

Campos:
- `pedido_id`
- `estado_actual`
- `estado_anterior`
- `transicion`
- `usuario`
- `fecha_hora`
- `motivo`
- `errores`
- `advertencias`
- `documentos_habilitados`
- `edicion_bloqueada`

Reglas:
- El pedido debe respetar una matriz de transiciones controlada.
- `ANULADO` y `REABIERTO_DEMO` requieren motivo registrado.
- El flujo sigue siendo demo y no conecta SRI, contabilidad ni inventario real.
- `documentos_habilitados` permite saber que salidas comerciales estan listas segun el estado actual.

## I. Contrato contable de ventas futuro

Nombre sugerido: `salesAccountingContract`

Origen:
- Comercial / Exportaciones

Destino:
- Contabilidad / Cartera / Reportes

Campos:
- `pedido_id`
- `numero_pedido`
- `invoice_cliente_id`
- `numero_invoice_cliente`
- `cliente_principal_id`
- `cliente_principal_nombre`
- `marca_id`
- `marca_nombre`
- `fecha_emision`
- `fecha_vuelo`
- `destino`
- `moneda`
- `total_cajas`
- `total_fulls`
- `total_ramos`
- `total_tallos`
- `subtotal`
- `descuento`
- `iva`
- `total_usd`
- `cuenta_ingreso_sugerida`
- `cuenta_cxc_sugerida`
- `centro_costo_sugerido`
- `estado_comercial`
- `estado_contable`
- `asiento_preview_id`
- `cxc_preview_id`
- `observacion`

Reglas:
- Invoice / Packing carguera NO genera contabilidad.
- Factura Comercial Cliente demo tampoco genera contabilidad real todavia.
- Solo se prepara la vista previa contable.
- La factura SRI exportacion sera fase futura.
- No modificar Libro Diario real.
- No modificar Cartera real.
- No modificar ATS real.

## J. Contrato auditoria

Nombre sugerido: `auditEventContract`

Origen:
- Todos los modulos

Destino:
- Core / Auditoria

Campos:
- `fecha_hora`
- `usuario`
- `modulo`
- `accion`
- `documento`
- `estado_anterior`
- `estado_nuevo`
- `descripcion`
- `resultado`
- `motivo`

## K. Contrato despacho operativo

Nombre sugerido: `dispatchContract`

Origen:
- Comercial / Exportaciones

Destino:
- Operaciones / Poscosecha -> Despacho operativo

Campos:
- `dispatch_id`
- `pedido_id`
- `numero_pedido`
- `cliente_principal`
- `marca_cliente_final`
- `destino`
- `fecha_emision`
- `fecha_vuelo`
- `dae`
- `awb`
- `hawb`
- `agencia_carga`
- `carrier`
- `vuelo`
- `total_cajas`
- `total_fulls`
- `total_ramos`
- `total_tallos`
- `estado_pedido`
- `estado_bodega`
- `estado_etiquetas`
- `estado_reservas`
- `estado_despacho`
- `cajas`
- `materiales_requeridos`
- `reservas_relacionadas`
- `etiquetas_generadas`
- `responsable_demo`
- `fecha_hora_despacho`
- `observacion`

Reglas:
- El despacho demo no descuenta inventario real de rosas.
- El despacho demo no consume inventario real de materiales.
- El despacho demo no genera contabilidad, ventas reales ni SRI.
- Un pedido anulado no puede despacharse.
- Un pedido cerrado no puede confirmarse otra vez.
- Si el pedido se reabre, el despacho queda observado o pendiente de revision.

## L. Refuerzo FASE 3A para availabilityContract y reservationContract

- `availabilityContract` ya tiene una pantalla demo visible en `Operaciones / Poscosecha -> Disponibilidad`.
- `reservationContract` sigue pendiente de integracion real, pero el shell ya deja preparada la relacion visual con `Comercial / Exportaciones`.
- Comercial continuara consultando disponibilidad desde Operaciones y no debe crear inventario de rosas propio.
- Operaciones seguira siendo el origen del stock operativo real cuando se apruebe el adapter de Parte 1.

## M. Contrato inventario operativo de rosas

Nombre sugerido: `operationalInventoryContract`

Origen:
- Operaciones / Poscosecha

Destino:
- Disponibilidad
- Bodega de rosas
- Comercial futuro

Campos:
- `inventory_id`
- `source_system`
- `source_record_id`
- `fecha`
- `variedad`
- `longitud`
- `tallos_por_ramo`
- `ramos_iniciales`
- `tallos_iniciales`
- `ramos_disponibles`
- `tallos_disponibles`
- `ramos_reservados`
- `tallos_reservados`
- `ramos_consumidos`
- `tallos_consumidos`
- `bodega`
- `proveedor`
- `bloque`
- `categoria`
- `edad_dias`
- `estado`
- `observacion`
- `updated_at`

Estados:
- `DISPONIBLE`
- `RESERVADO_PARCIAL`
- `RESERVADO_TOTAL`
- `DESPACHADO`
- `VENCIDO`
- `OBSERVADO`
- `PENDIENTE_SINCRONIZACION`

Reglas:
- El inventario operativo de rosas pertenece a Operaciones.
- No se mezcla con inventario administrativo de suministros o empaque.
- El origen futuro aprobado sera Parte 1 POSCOSECHA mediante `parte1-adapter.js`.
- Su salida futura hacia Comercial se hace por `availabilityContract`.
- En esta fase solo queda preparado y documentado; no esta conectado a datos reales.

## N. Contrato consumo operativo demo

Nombre sugerido: `operationalConsumptionContract`

Origen:
- Operaciones / Poscosecha

Destino:
- Inventario de rosas demo
- Despacho operativo
- Comercial

Campos:
- `consumption_id`
- `pedido_id`
- `numero_pedido`
- `dispatch_id`
- `reservation_id`
- `availability_id`
- `box_id`
- `fecha_hora`
- `variedad`
- `longitud`
- `tallos_por_ramo`
- `ramos_consumidos_demo`
- `tallos_consumidos_demo`
- `bodega`
- `proveedor`
- `bloque`
- `estado_consumo`
  - `PENDIENTE`
  - `SIMULADO`
  - `REVERTIDO_DEMO`
  - `OBSERVADO`
- `usuario_demo`
- `motivo`
- `observacion`

Reglas:
- El consumo demo no descuenta inventario real.
- El consumo demo no afecta Supabase.
- El consumo demo no genera asiento contable.
- El consumo demo solo sirve para preparar el futuro descuento real por movimientos.
- Si se revierte el despacho demo, el consumo demo debe quedar `REVERTIDO_DEMO`.

## O. Contrato etiquetas de ramos

Nombre sugerido: `bunchLabelContract`

Origen:
- Operaciones / Poscosecha

Destino:
- Ingreso de ramos por escaner
- Inventario operativo de rosas
- Trazabilidad

Campos:
- `label_id`
- `codigo_10_digitos`
- `fecha_creacion`
- `fecha_impresion`
- `fecha_escaneo`
- `embonchador`
- `color_dia`
- `proveedor`
- `bloque`
- `variedad`
- `longitud`
- `tallos_por_ramo`
- `tipo_etiqueta`
- `inventory_id`
- `estado`

Reglas:
- Cada etiqueta tiene un codigo numerico unico de 10 digitos que nunca se reutiliza.
- Crear, imprimir o reimprimir una etiqueta no genera inventario.
- El inventario nace unicamente durante el primer escaneo valido.
- La fecha oficial de ingreso es la fecha/hora del escaneo, no la fecha de impresion.
- Un escaneo duplicado registra el evento, pero no crea otro ramo.
- Una etiqueta anulada u observada no puede crear inventario.
- La implementacion actual funciona en modo demo/local.
- Barcode real y Zebra real siguen pendientes.

## P. Contrato eventos de scanner

Nombre sugerido: `scannerEventContract`

Origen:
- Operaciones / Poscosecha

Destino:
- Core / Auditoria
- Zebra futuro

Campos:
- `event_id`
- `fecha_hora`
- `codigo`
- `tipo_codigo`
  - `RAMO`
  - `CAJA`
  - `PEDIDO`
  - `DESPACHO`
  - `MATERIAL`
  - `DESCONOCIDO`
- `modulo_origen`
- `modulo_destino`
- `pedido_id`
- `box_id`
- `label_id`
- `variedad`
- `longitud`
- `resultado`
  - `LEIDO_DEMO`
  - `VALIDADO_DEMO`
  - `NO_ENCONTRADO`
  - `DUPLICADO`
  - `ERROR_DEMO`
- `usuario_demo`
- `observacion`

Reglas:
- El escaneo demo no descuenta inventario real.
- El escaneo demo no confirma despacho real.
- El escaneo demo solo registra eventos visuales.
- Sirve para preparar trazabilidad futura y auditoria operativa.
- La conexion Zebra real queda pendiente para una fase posterior.
