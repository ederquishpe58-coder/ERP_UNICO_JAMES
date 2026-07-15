# FASE 2A COMERCIAL DEMO INTEGRADO

## Que se integro

- Se creo el modulo `Comercial / Exportaciones` dentro de `scripts/modules/comercial/` con separacion por datos, estado, utilidades, Pedido Maestro, historial, catalogos, invoice carguera y centro de impresion.
- Se reemplazo el placeholder comercial del shell por rutas demo reales.
- Se integro `Pedido Maestro` como flujo central con tabs para:
  - resumen
  - cliente / marca
  - logistica
  - cajas y variedades
  - PO / marcaciones adicionales
  - disponibilidad / reservas
  - packing
  - invoice carguera
  - HR / hoja de ruta
  - MP / master packing
  - etiquetas
  - bodega / materiales
  - validaciones
  - centro de impresion
- Se implemento filtrado cliente principal -> marca.
- Se implemento asignacion automatica de destino y DAE demo por marca.
- Se implemento tabla editable demo de cajas y variedades con recalculo de tallos y total linea.
- Se implemento calculo demo de:
  - total cajas
  - total fulls
  - total ramos
  - total tallos
  - total USD
  - precio promedio por tallo
  - resumen por longitud
  - resumen por variedad
  - resumen por tipo de caja
- Se implemento preview demo de `Invoice / Packing carguera`.
- Se implemento `Centro de impresion` con preview e impresion en ventana separada.
- Se implemento `Pedidos / Historial` con acciones de abrir, duplicar y previsualizar documentos.
- Se implementaron catalogos demo de:
  - clientes / marcas
  - agencias de carga
  - DAEs
  - lineas aereas
  - productos exportables
- Se actualizo el `Diagnostico / Estado del ERP` para reflejar que Comercial ya esta en `demo integrado`.

## Que sigue siendo demo

- La disponibilidad de rosas es simulada.
- Las reservas son visuales y no consumen inventario real.
- El invoice carguera es un preview demo imprimible.
- HR, MP, etiquetas, resumen y control DAE siguen como salidas visuales demo.
- Los catalogos comerciales siguen en solo lectura.
- `commercialOrderContract` y `packagingRequirementContract` ya tienen uso visual demo, pero no hay integracion real con otros modulos.

## Que no se toco

- No se movio logica pesada de Parte 1 Poscosecha.
- No se movio el `app.js` monolitico de Parte 3 como bloque unico.
- No se conecto Supabase.
- No se ejecuto SQL.
- No se crearon migraciones.
- No se implemento facturacion SRI real.
- No se implemento autorizacion SRI real.
- No se conectaron ventas con contabilidad o cartera.
- No se consumio inventario real de rosas.
- No se consumio inventario real de suministros / empaque.

## Contratos usados en esta fase

- `availabilityContract`: pendiente integracion real, usado como referencia visual.
- `reservationContract`: pendiente integracion real, usado para reservas demo.
- `commercialOrderContract`: demo integrado desde el resumen comercial del pedido.
- `boxDetailContract`: reflejado por la tabla de cajas y variedades.
- `packagingRequirementContract`: demo integrado desde la pestaña `Bodega / materiales`.
- `salesAccountingContract`: pendiente.
- `auditEventContract`: pendiente.

## Como probar

1. Abrir `index.html` del ERP unico.
2. Ir a `Comercial / Exportaciones`.
3. Abrir `Pedido Maestro`.
4. Seleccionar `URSA`.
5. Seleccionar `ALEX`.
6. Verificar que el destino cambie a `KAZAJSTAN`.
7. Verificar que se asigne automaticamente la DAE `055-2026-40-01186707`.
8. Ir a `Cajas y variedades` y agregar lineas HB.
9. Verificar el recalculo de tallos, total linea, total cajas, fulls y USD.
10. Ir a `Invoice carguera` y revisar el preview dinamico.
11. Ir a `Bodega / materiales` y revisar el calculo visual demo.
12. Ir a `Disponibilidad / Reservas` y registrar una reserva demo.
13. Ir a `Centro de impresion` y abrir un preview.

## Riesgos pendientes

- La DAE sigue siendo un catalogo demo sin integracion aduanera real.
- La disponibilidad real aun no se sincroniza con Operaciones / Poscosecha.
- El invoice carguera aun no usa plantilla final de produccion.
- Falta la capa futura de auditoria especifica del modulo comercial.
- La integracion futura con contabilidad puede introducir acople si no se respeta `salesAccountingContract`.

## Siguiente fase recomendada

Fase 2B:

- integrar solo lectura real de disponibilidad desde Operaciones / Poscosecha
- adaptar reservas comerciales controladas contra `reservationContract`
- reforzar preview de HR, MP y etiquetas con layout mas cercano al formato operativo
- preparar adapter controlado para materiales requeridos contra inventario de empaque
- mantener fuera de alcance SRI real, ventas-contabilidad y Supabase

## Comandos usados para validar

- `npm run validate:shell`
- `npm run build`
- `npm run build:standalone`
