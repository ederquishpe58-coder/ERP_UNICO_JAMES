Contrato aprobado de excedente por período

La base mensual es USD 470 y permanece íntegra aunque el rendimiento sea inferior a la meta. El excedente se calcula sobre el total del período, nunca sumando excesos diarios. Este contrato sustituye la fórmula legacy de pago sobre todas las unidades para la futura integración aprobada.

| Cargo | Unidad | Meta diaria | Meta del período |
|---|---|---:|---|
| CLASSIFIER | Mallas | 260 | Días trabajados × 260 |
| BUNCHER | Bunches | 200 | Días trabajados × 200 |

La tarifa de cada período es `470 / meta_del_período`. El excedente es `max(real - meta_del_período, 0)` y su pago es `excedente × 470 / meta_del_período`. La base más ese pago constituye el subtotal antes de otros ingresos/egresos.

El helper SQL privado `erp_payroll_performance_v2_period_excess` implementa exclusivamente esta aritmética. No consulta datos de empleados ni rendimiento, no escribe filas y no acredita persistencia o autorización. No tiene EXECUTE para PUBLIC, anon, authenticated ni service_role. Un futuro caller canónico deberá validar capacidad exacta, empresa, período, identidad operativa, vigencia del vínculo y operaciones confirmadas antes de invocarlo.

Días trabajados es un entero explícito entre 1 y 31, de acuerdo con el dominio existente de `considered_workdays`. Cero o ausencia se rechazan para evitar división por cero; no se reemplazan por 21 ni por días del calendario. El rendimiento debe ser finito, no negativo y representable con hasta seis decimales. La función no determina asistencia ni convierte automáticamente duración de jornada en días.

Precisión y redondeo:

- PostgreSQL NUMERIC conserva la proporción durante la división. El pago se redondea una vez a seis decimales; los importes y cantidades del contrato se devuelven como strings decimales de seis posiciones.
- `unitCost` es la representación de seis posiciones de la tarifa del período. Para evitar deriva, no se utiliza esa representación ya redondeada como multiplicador; el pago usa el numerador 470 y el denominador `periodTarget` del mismo snapshot.
- Display/print redondean a dos decimales al presentar el resultado. No se redondean tarifas o excedentes a dos decimales durante el cálculo.
- La identidad `exceso = meta → extra = 470` se conserva para ambos cargos y todos los días permitidos. Por ejemplo, 4200 × 0.111905 daría 470.001; conservar la proporción evita ese error.

| Ejemplo de 21 días | Real | Meta | Excedente | Tarifa, snapshot 6 | Extra, interno 6 | Base + extra, display 2 |
|---|---:|---:|---:|---:|---:|---:|
| Clasificador | 5600 | 5460 | 140 | 0.086081 | 12.051282 | 482.05 |
| Clasificador | 5000 | 5460 | 0 | 0.086081 | 0.000000 | 470.00 |
| Embonchador | 4300 | 4200 | 100 | 0.111905 | 11.190476 | 481.19 |
| Embonchador | 4200 | 4200 | 0 | 0.111905 | 0.000000 | 470.00 |

Estado de implementación: aritmética implementada y probada aisladamente; no conectada al cálculo monetario público ni desplegada. No se reactiva el concepto histórico PERFORMANCE ni se crea otro concepto, política, empleado, tarifa guardada o mapping.

La reconexión de datos sigue pendiente de los defectos documentados en la auditoría y de decisiones sobre jornadas que atraviesan meses y anulaciones/correcciones. Una migración que solo añade este helper no cierra esa reconexión. La impresión real deberá usar snapshots aprobados, no consultar rendimiento vivo.

Validación reproducible: ejecutar la migración y `validate-payroll-performance-excess.sql` únicamente en una base descartable. La prueba SQL comprueba ejemplos humanos, días 1–31, falta de reducción de base, acumulación por período, redondeo sin deriva, entradas inválidas y ACL privada. No ejecuta nómina real.
