# Flujo Pedido, Demanda y Bodega por Escaneo

## Objetivo

Definir el flujo operativo local/demo entre Comercial y Bodega sin reservar ramos individualmente. El pedido expresa demanda; la asignacion fisica ocurre solo cuando Bodega escanea una etiqueta de ramo dentro de una caja.

## Flujo acordado

1. Operaciones genera inventario cuando se escanea una etiqueta numerica de ramo de 10 digitos.
2. Comercial crea el Pedido Maestro con cliente, marca, transporte, DAE cuando corresponda, cajas y lineas.
3. Disponibilidad muestra `stock fisico - demanda pendiente = saldo proyectado`.
4. Comercial valida el pedido y lo libera a Bodega.
5. Bodega abre el pedido liberado y selecciona la caja que esta armando.
6. Bodega toma primero la flor mas antigua compatible, siempre que su estado fisico sea correcto.
7. Cada etiqueta escaneada se valida contra variedad, longitud y tallos por ramo de una linea pendiente.
8. El ramo pasa de `DISPONIBLE` a `ASIGNADO_CAJA` y deja de aparecer como stock fisico disponible.
9. Cuando todas las lineas de una caja estan completas, Bodega cierra la caja.
10. La etiqueta de caja se prepara despues del cierre fisico.
11. Cuando todas las cajas estan cerradas, la orden queda `COMPLETO_BODEGA` para continuar al despacho.

## Reglas principales

- No existe reserva previa de ramos.
- Una orden puede mostrar faltante proyectado sin apartar flor inexistente.
- El escaneo es la unica accion que asigna un ramo fisico a una caja.
- Un codigo de ramo no puede usarse dos veces.
- El codigo debe existir previamente en Inventario de rosas y estar `DISPONIBLE`.
- El sistema sugiere FIFO por fecha y hora de ingreso.
- Escanear un ramo mas nuevo que otro compatible genera advertencia, no bloqueo, para permitir observar flor antigua deteriorada.
- Pedidos aereos requieren DAE para liberarse a Bodega.
- Pedidos maritimos pueden permanecer sin DAE con advertencia.
- Cambiar cliente, marca o lineas queda bloqueado una vez liberado el pedido.

## Estados de Bodega

| Estado | Significado |
| --- | --- |
| `NO_LIBERADO` | Comercial aun prepara el pedido. |
| `LIBERADO_BODEGA` | Pedido visible en la cola de Bodega. |
| `EN_ARMADO` | Al menos un ramo fue asignado por escaneo. |
| `PARCIAL_FALTANTE` | Estado previsto para una orden incompleta con faltante confirmado. |
| `COMPLETO_BODEGA` | Todas las cajas fueron cerradas por Bodega. |

## Estados de caja

| Estado | Significado |
| --- | --- |
| `INCOMPLETA` | Ningun ramo escaneado. |
| `EN_PROCESO` | Armado parcial. |
| `ARMADA_COMPLETA` | Todos los ramos solicitados fueron escaneados. |
| `CERRADA_BODEGA` | Bodega verifico y cerro la caja. |

## Responsabilidades futuras por rol

- Ventas: administra catalogos comerciales, crea y valida pedidos, libera a Bodega y monitorea avance.
- Bodega: consulta la cola, escanea ramos, arma y cierra cajas, solicita impresion de etiquetas.
- Operaciones: registra recepcion, clasificacion, etiquetas de ramos e ingreso al inventario.
- Contabilidad: permanece separada; este flujo no genera asientos.

El menu dinamico y los permisos futuros podran ocultar rutas y acciones segun rol. En esta fase no existe autenticacion ni autorizacion real.

## Alcance demo

- Persistencia local/demo.
- Sin Supabase ni SQL.
- Sin lector o impresora Zebra real.
- Sin descuento de inventario real de Parte 1.
- Sin consumo real de materiales.
- Sin contabilidad ni SRI.

## Prueba manual

1. Ingresar un ramo desde `Operaciones / Poscosecha -> Ingreso de ramos` usando una etiqueta numerica generada.
2. Crear o abrir un pedido en `Comercial / Exportaciones -> Pedido Maestro`.
3. Validar comercialmente el pedido.
4. Pulsar `Liberar a Bodega`.
5. Abrir `Operaciones / Poscosecha -> Bodega de rosas`.
6. Abrir el pedido y seleccionar una caja.
7. Escanear una etiqueta compatible de 10 digitos.
8. Confirmar que aumenta el avance y el ramo cambia a `ASIGNADO_CAJA`.
9. Completar y cerrar la caja.
10. Abrir la etiqueta demo desde Bodega.

