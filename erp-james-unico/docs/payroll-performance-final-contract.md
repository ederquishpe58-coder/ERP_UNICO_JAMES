# Rendimientos y Rol V2: contrato final

## Autoridad y alcance

Solo CLASSIFIER y BUNCHER se incorporan mediante el vínculo canónico por ID de
`erp_payroll_employee_operational_roles`. Cada evento se filtra por empresa,
fecha efectiva del vínculo y período. No se crean empleados ni se asocian nombres.
Los empleados normales conservan su remuneración y cálculo existentes.

`erp_operations_performance_v2_rows` es la fuente compartida de la pantalla
Rendimientos y Payroll. La pantalla consulta el RPC de lectura
`erp_operations_performance_v2_get`, que exige `operations.yields.view`.
Las funciones auxiliares no son ejecutables por roles de API.

- Clasificador: `operations_mesh_records.meshCount`, respaldado por el comando
  `ASSIGN_CLASSIFICATION` confirmado. Los tallos adicionales no crean otra malla.
- Embonchador: la recepción original única del registro Zebra y su comando
  `RECEIVE_ZEBRA_BUNCH` confirmado, con prueba del ingreso y del inventario.
  Crear o imprimir etiquetas no cuenta. Reintentar no agrega unidades.
- La fecha procede de `erp_operations_commands.server_created_at`, en
  `America/Guayaquil`; se conserva la jornada canónica pero no se usa su fecha
  antigua de apertura para imputar el período.
- La identidad operativa procede del ingreso actual, o de la coincidencia por
  ID entre el bunch y el inventario del ACK original cuando el ingreso antiguo
  carece del campo. Nunca procede de un nombre ni del estado de inventario actual.

## Cálculo aprobado

Base fija mensual 470; jornada referencial 8 horas. Los días trabajados se ingresan
explícitamente por empleado y período (entero de 1 a 31), y quedan en el snapshot.
No se sustituyen por días calendario ni se presupone 21.

Meta diaria: clasificador 260 mallas; embonchador 200 bunches.

```
meta_periodo = dias_trabajados * meta_diaria
excedente = max(real_confirmado - meta_periodo, 0)
tarifa_periodo = 470 / meta_periodo
extra = excedente * tarifa_periodo
base_mas_extra = 470 + extra
```

La división mantiene precisión numérica hasta redondear el extra a seis
decimales. La tarifa informativa se guarda a seis decimales; no se vuelve a
multiplicar la tarifa ya redondeada. UI e impresión muestran dos decimales.
No existe reducción automática bajo la meta ni pago proporcional por todas las
unidades. Los otros ingresos/egresos manuales se agregan normalmente.

El extra usa el concepto existente `OTHER_INCOME` y el tipo de fuente
`PERFORMANCE_PERIOD_EXCESS`; el código histórico `PERFORMANCE` sigue desactivado.
El sueldo usa `BASE_AMOUNT`. Si un concepto necesario está desactivado, se bloquea
el cálculo; no se activa silenciosamente. Las políticas antiguas se conservan
como histórico y no sustituyen esta fórmula aprobada.

## Correcciones, persistencia e impresión

Se guarda `erp_payroll_role_items.performance_calculation_snapshot` con el rol
operativo, período, días, metas, cantidad real, excedente, tarifa, base, extra e
identificadores de contexto. Los snapshots de fuentes conservan IDs de evento,
trabajador y jornada. Las líneas económicas mantienen precisión canónica.

Cambios semánticos de rendimiento o vínculo invalidan un rol CALCULATED y
bloquean su aprobación hasta recalcular. Versiones sin cambios económicos y
movimientos normales de inventario no eliminan rendimiento ni invalidan el
cálculo. Los bloqueos transaccionales serializan correcciones con cálculo y
aprobación. APPROVED conserva el snapshot; POSTED no puede recalcularse.

La impresión individual y el resumen administrativo muestran los valores del
snapshot, validan contexto y totales y resuelven la empresa desde el rol.
No consultan rendimiento vivo para reescribir un histórico aprobado.

El extra usa la misma cuenta de gasto efectiva del empleado: override explícito,
luego configuración predeterminada de Payroll. Esta entrega no asigna cuentas ni
configura contabilidad. Los requisitos contables existentes se conservan.

## Delta autorizado

Migraciones 202609070003 y 202609070004: helper económico, autoridad compartida,
adaptadores y guardas de recálculo; una columna nullable de snapshot y dos
triggers de bloqueo. No se actualizan filas históricas, conceptos, políticas,
empleados, vínculos, inventario, membresías ni SRI. Los ACK estrictos, permisos
canónicos y contratos de comandos Zebra/Operations se mantienen.
