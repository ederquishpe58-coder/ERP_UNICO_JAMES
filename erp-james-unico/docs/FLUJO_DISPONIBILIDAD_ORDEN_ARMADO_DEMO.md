# Flujo disponibilidad, orden y armado demo

## Alcance implementado

- Disponibilidad agrupada por variedad, medida y tallos por bunch.
- Formula: `bunches disponibles = bunches totales - bunches en ordenes activas`.
- Las ordenes `BORRADOR`, anuladas, despachadas o cerradas no comprometen disponibilidad.
- Lista separada de ordenes del dia.
- Detalle separado de la orden con cajas desplegables y lineas por variedad.
- Escaneo demo de etiquetas numericas de ramos ya ingresados al inventario operativo.
- Validacion de variedad, medida y tallos por bunch contra la caja activa.
- Deteccion de codigos duplicados o que no pertenecen a la caja.
- Confirmacion manual de cada caja por Ventas.
- Impresion de etiqueta disponible despues de confirmar la caja.
- Confirmacion manual de orden completa sin cerrar automaticamente el estado comercial.

## Compatibilidad

- Reutiliza las lineas y cajas del Pedido Maestro.
- Reutiliza el inventario operativo creado por escaneo de etiquetas de ramos.
- Reutiliza el preview existente de etiquetas de caja.
- No reemplaza Despacho operativo ni Scanner / Zebra tecnico.
- No modifica Libro Diario, CxC, SRI, Supabase ni inventario real.

## Menu comercial

- Ordenes / Pedidos: ordenes del dia, crear/editar, detalle/armado e historial.
- Documentos comerciales: Invoice/Packing, Factura Comercial Cliente y Centro de impresion.
- Administracion: Clientes/Marcas, Agencias de carga, DAEs, Lineas aereas y Productos exportables.

## Regla pendiente real

El flujo actual sigue en modo demo/local. El descuento fisico del ramo se realizara solamente cuando se apruebe la integracion real de inventario y despacho.
