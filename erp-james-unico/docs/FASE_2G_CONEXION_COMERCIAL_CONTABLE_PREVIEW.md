# FASE 2G CONEXION COMERCIAL CONTABLE PREVIEW

## Que se implemento

- Se creo la carpeta `scripts/modules/comercial/accounting-preview/` para separar la preparacion contable del modulo comercial demo.
- Se agrego la pestaña `Contabilidad futura` dentro de `Pedido Maestro`.
- Se agrego la ruta `Comercial / Exportaciones -> Reporte comercial-contable demo`.
- Se preparo el contrato `salesAccountingContract` con datos comerciales, cuenta CxC sugerida, cuenta ingreso sugerida, centro de costo sugerido y estado contable demo.
- Se ampliaron `Pedidos / Historial`, `Panel comercial` y `Diagnostico / Estado del ERP` con estado contable, preview y preparacion futura.

## Que es preview contable

- Es una simulacion interna de la futura conexion entre Comercial y Contabilidad.
- No crea asiento real.
- No crea cuenta por cobrar real.
- No modifica Libro Diario.
- No modifica Mayor General.
- No modifica Cartera real.
- No modifica ATS.

## Que NO afecta todavia

- Libro Diario real.
- Mayor General real.
- Cartera real.
- ATS real.
- Facturacion SRI.
- XML y RIDE.

## Asiento sugerido futuro

Dr `Cuentas por cobrar clientes`

Cr `Ventas exportacion`

Notas:
- En esta fase se deja sin IVA para exportacion.
- Las cuentas se toman de `companySettings.defaultAccounts` si existen.
- Si faltan cuentas, el preview muestra advertencias y no toca contabilidad real.

## Cuenta por cobrar futura

- Documento base: `Factura Comercial Cliente demo`
- Cliente base: cliente principal interno
- Fecha emision: desde Pedido Maestro
- Fecha vencimiento: desde `expireDate` o dias de credito del cliente
- Estado demo:
  - `NO_GENERADO`
  - `PREVIEW`
  - `LISTO_PARA_CONTABILIZAR_FUTURO`
  - `CONTABILIZADO_FUTURO`

## Reglas para generar preview

- Permitido desde:
  - `VALIDADO_COMERCIAL`
  - `LISTO_BODEGA`
  - `LISTO_DESPACHO`
  - `DESPACHADO_DEMO`
  - `CERRADO_DEMO`
- Bloqueado si:
  - el pedido esta `ANULADO`
  - falta cliente principal
  - falta `Factura Comercial Cliente demo`
  - total USD es cero
- Advertencias:
  - falta cuenta CxC sugerida
  - falta cuenta de ventas exportacion sugerida
  - falta centro de costo sugerido
  - faltan cuentas preparadas de anticipos / retenciones

## Que falta para conexion real

- Adaptador hacia cartera real.
- Generacion controlada de cuenta por cobrar real.
- Generacion controlada de asiento en Libro Diario.
- Regla final de contabilizacion contra factura SRI exportacion.
- Politica de bloqueo para evitar contabilizar antes de autorizacion tributaria.

## Riesgos si se contabiliza antes de SRI

- Diferencia entre documento comercial y documento tributario definitivo.
- Duplicidad de ventas si luego se crea factura real por otra ruta.
- Cuentas por cobrar desalineadas con documento oficial.
- Reportes y ATS inconsistentes.

## Siguiente fase recomendada

- FASE 2H: adapter controlado entre Factura Comercial Cliente demo y cartera/contabilidad real, con doble validacion y sin tocar todavia SRI real hasta aprobar la politica final de venta exportacion.
