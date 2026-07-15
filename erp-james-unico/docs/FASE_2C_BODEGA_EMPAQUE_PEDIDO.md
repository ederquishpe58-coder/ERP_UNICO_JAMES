# FASE 2C - Bodega / Empaque conectado al Pedido Maestro

## Que se implemento

Se agrego una capa modular nueva en `scripts/modules/comercial/bodega-empaque/` para conectar visualmente el `Pedido Maestro` con los materiales de bodega y empaque sin tocar inventario real ni contabilidad.

Quedo activo en modo demo:

- calculo de materiales requeridos por pedido
- detalle por caja para preparacion de bodega
- estados demo de preparacion y consumo visual
- documento imprimible `Requerimiento de materiales / Bodega`
- ruta `Comercial / Exportaciones -> Reporte materiales por pedido`
- integracion del `packagingRequirementContract` con campos ampliados

## Que se calcula

El calculo toma desde el `Pedido Maestro`:

- total de cajas por tipo
- total de ramos
- total de tallos
- detalle por caja
- marca
- destino
- estado del pedido

Con eso genera materiales demo como:

- cajas HB, QB y EB
- separadores por tipo de caja
- etiquetas de caja
- etiquetas de ramo
- ligas
- capuchones
- fundas

Cada fila calculada expone:

- codigo material
- nombre
- categoria
- unidad
- requerido
- disponible demo
- faltante
- bodega
- estado
- observacion

## Que sigue siendo demo

Esta fase NO hace:

- consumo real de inventario
- descuento de stock real
- movimiento de inventario
- asiento contable
- integracion con Supabase
- SQL o migraciones
- integracion con inventario de rosas

Los estados de bodega son solo visuales:

- `REQUERIDO`
- `OK`
- `PARCIAL`
- `FALTANTE`
- `CONSUMIDO_DEMO`
- `PENDIENTE_INVENTARIO_REAL`

## Como se conectara despues con inventario real

Flujo preparado para fase futura:

1. Pedido comercial validado.
2. Pedido Maestro calcula requerimientos de empaque.
3. Bodega confirma preparacion.
4. Inventario de suministros / empaque valida stock real.
5. Inventario genera consumo real por movimientos.
6. Auditoria registra el evento.

En esta fase solo quedo listo el puente visual y contractual:

- `packagingRequirementContract`
- boton hacia `Inventario suministros / empaque`
- advertencia de que la conexion real sigue pendiente

## Regla contable futura

Cuando se apruebe el consumo real, el flujo contable esperado sera:

```text
Pedido validado
-> materiales requeridos
-> bodega confirma preparacion
-> inventario genera consumo
-> asiento contable:
   Dr Costo materiales de empaque
      Cr Inventario materiales de empaque
```

Esa regla esta documentada, pero no se ejecuta ni se simula contablemente todavia.

## Como probar

1. Abrir el ERP unico.
2. Ir a `Comercial / Exportaciones`.
3. Abrir `Pedido Maestro`.
4. Cargar el pedido demo o crear uno nuevo.
5. Agregar cajas `HB` o `QB` en `Cajas y variedades`.
6. Ir a la pestaña `Bodega / Materiales`.
7. Revisar tarjetas de resumen y la tabla de requerimientos.
8. Cambiar entre `Ver detalle por material` y `Ver detalle por caja`.
9. Probar `Marcar como preparado, demo` y `Marcar como consumido demo`.
10. Ir a `Centro de impresion` y abrir `Requerimiento de materiales / Bodega`.
11. Ir a `Reporte materiales por pedido` para revisar el consolidado demo.

## Riesgos que evita esta fase

- evita mezclar consumo comercial con inventario real antes de tiempo
- evita tocar contabilidad o libro diario sin flujo aprobado
- evita mezclar inventario de rosas con inventario administrativo
- evita meter toda la logica de empaque dentro de `pedido-maestro.js`
- deja un contrato claro antes de conectar inventario real

## Riesgos pendientes

- los stocks siguen siendo demo y pueden no reflejar la realidad fisica
- un pedido puede validarse comercialmente con faltantes de bodega, solo con advertencia
- materiales especiales por cliente o destino siguen modelados con reglas base y overrides simples
- no existe trazabilidad real de consumo ni documentos persistidos

## Comandos de validacion

- `npm run validate:shell`
- `npm run build`
- `npm run build:standalone`

## Siguiente fase recomendada

FASE 2D:

- adapter visual con `Inventario suministros / empaque`
- lectura real de stock administrativo sin consumir todavia
- auditoria de preparacion de bodega por pedido
- reglas adicionales de empaque por cliente, marca y destino
