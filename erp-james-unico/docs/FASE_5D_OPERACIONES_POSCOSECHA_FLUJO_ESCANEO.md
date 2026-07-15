# Operaciones / Poscosecha - flujo integrado por escaneo

## Regla principal

Una etiqueta es un identificador impreso. No representa inventario. El ramo se crea en el inventario operativo unicamente durante el primer escaneo valido de la etiqueta.

La fecha oficial de ingreso es la fecha y hora del escaneo. La fecha de creacion o impresion de la etiqueta no se utiliza como fecha de inventario.

## Menu validado

1. Panel operativo.
2. Parametros de Poscosecha.
3. Recepcion de flor.
4. Clasificacion.
5. Etiquetas de ramos.
6. Ingreso de ramos por escaner.
7. Inventario de rosas.
8. Disponibilidad.
9. Bodega de rosas.
10. Rendimientos.
11. Scanner / Zebra tecnico.
12. Despacho operativo.

La estacion de ingreso de ramos crea inventario. Scanner / Zebra tecnico se conserva separado para pruebas HID, cajas y despacho.

## Funcionalidad integrada

- Parametros administra proveedores con su bloque asignado, recepcionistas, clasificadores, embonchadores, variedades, longitudes, tipos de tallo y tipos de etiqueta.
- En Recepcion se busca y selecciona primero el numero de bloque; el proveedor parametrizado se reconoce automaticamente.
- Recepcion registra una sola cabecera por proveedor, bloque y recepcionista, con varias lineas de variedad, mallas, tallos por malla y extras.
- Las recepciones registradas pueden editarse; sus totales se recalculan y una linea vinculada a Clasificacion no puede eliminarse.
- El historial de recepciones abre por dia, permite consultar todo un mes y muestra total recibido, enviado a Clasificacion y saldo pendiente.
- La cola de Clasificacion respeta el orden de llegada; las recepciones completadas se muestran al final y ya no ofrecen lineas sin saldo.
- En la entrega al clasificador el usuario selecciona bloque y variedad; el proveedor se reconoce y el sistema aplica automaticamente la recepcion pendiente mas antigua de esa combinacion.
- En Nacional o rechazo se selecciona bloque, clasificador y variedad; el proveedor se reconoce y el sistema aplica el resultado a la entrega pendiente mas reciente de esa combinacion.
- Cada bloque debe pertenecer a un solo proveedor para evitar reconocimientos ambiguos.
- Los identificadores internos de recepcion y entrega se conservan para trazabilidad aunque no se soliciten al usuario.
- Etiquetas genera registros individuales con codigo numerico unico de 10 digitos.
- Generar o reimprimir etiquetas mantiene el inventario sin cambios.
- Ingreso por escaner recupera datos de la etiqueta sin volver a digitarlos.
- El primer escaneo valido crea una fila de inventario y un evento de scanner.
- Un segundo escaneo genera `DUPLICADO` y no crea otro ramo.
- Inventario muestra codigo, fecha/hora de ingreso, proveedor, variedad, longitud, tallos y embonchador.
- Disponibilidad se reconstruye desde inventario cuyo origen es `ESCANEO_ETIQUETA`.
- Bodega calcula edad desde la fecha real del escaneo.
- Rendimientos de embonchadores cuentan ramos escaneados, no etiquetas impresas.

## Estados

Etiquetas:

- `GENERADA`
- `IMPRESA`
- `ESCANEADA`
- `OBSERVADA`
- `ANULADA`

Ingreso por escaneo:

- `INVENTARIO_CREADO`
- `DUPLICADO`
- `NO_ENCONTRADO`
- `FORMATO_INVALIDO`
- `BLOQUEADA`

Inventario:

- `DISPONIBLE`
- `RESERVADO`
- `DESPACHADO`
- `VENCIDO`
- `OBSERVADO`

## Controles de integridad

- El codigo de ramo debe tener exactamente 10 digitos.
- El secuencial nunca se reutiliza.
- Una etiqueta anulada u observada no crea inventario.
- Una etiqueta escaneada queda vinculada a un solo `inventoryId`.
- Cada inventario nuevo guarda `sourceLabelId` y `sourceScannerEventId`.
- Los registros antiguos sin trazabilidad de escaneo quedan marcados como `LEGACY_DEMO` y no alimentan la disponibilidad nueva.
- Los parametros usados historicamente se desactivan en lugar de borrarse.

## Pruebas funcionales

1. Generar dos etiquetas y confirmar que el inventario no aumenta.
2. Escanear la primera etiqueta y confirmar que el inventario aumenta en un ramo.
3. Repetir el codigo y confirmar resultado `DUPLICADO` sin aumentar inventario.
4. Escanear `9999999999` y confirmar `NO_ENCONTRADO`.
5. Revisar que la fecha de ingreso corresponde al escaneo.
6. Revisar Disponibilidad y confirmar que solo incluye inventario nacido por escaneo.
7. Revisar Rendimientos y confirmar que el embonchador suma el ramo escaneado.

## Alcance actual

Todo funciona en modo local/demo. No se conecto Supabase, no se ejecuto SQL, no se conecto un lector Zebra real y no se modifico Parte 1 original. Contabilidad y rol de pagos no fueron modificados.
