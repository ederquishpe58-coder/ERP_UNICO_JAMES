# Mapeo Parte 1 POSCOSECHA a ERP unico

## Objetivo

Dejar documentada la homologacion futura entre los datos operativos reales de Parte 1 POSCOSECHA y los contratos internos del ERP unico, sin conectar todavia datos reales.

## Tabla de mapeo base

| Parte 1 POSCOSECHA campo futuro | ERP unico contrato | Observacion |
| --- | --- | --- |
| id lote / registro | `source_record_id` | Identificador original de Parte 1 dentro de `operationalInventoryContract`. |
| fecha ingreso | `fecha` | Fecha de ingreso al inventario operativo. |
| variedad | `variedad` | Debe homologarse a catalogo comun del ERP unico. |
| longitud | `longitud` | Mantener unidad en centimetros. |
| tallos por ramo | `tallos_por_ramo` | Base para disponibilidad, reservas y consumo demo/futuro. |
| ramos iniciales | `ramos_iniciales` | Cantidad total registrada al ingreso. |
| tallos iniciales | `tallos_iniciales` | Derivado o entregado por Parte 1. |
| ramos disponibles | `ramos_disponibles` | Saldo utilizable para disponibilidad comercial. |
| tallos disponibles | `tallos_disponibles` | Saldo en tallos del inventario operativo. |
| ramos reservados | `ramos_reservados` | Reserva sobre inventario operativo. |
| tallos reservados | `tallos_reservados` | Reserva en tallos. |
| ramos consumidos | `ramos_consumidos` | Salida operativa por despacho real futuro. |
| tallos consumidos | `tallos_consumidos` | Salida operativa en tallos. |
| bodega / cuarto frio | `bodega` | Ubicacion operativa del inventario de rosas. |
| proveedor / finca | `proveedor` | Debe homologarse a una sola clave o nombre comun. |
| bloque | `bloque` | Puede venir separado de proveedor o finca. |
| categoria | `categoria` | Ejemplo: exportacion, nacional, observada. |
| estado | `estado` | Debe homologarse al catalogo del ERP unico. |
| edad dias | `edad_dias` | Se usa en disponibilidad y alertas operativas. |
| observacion | `observacion` | Campo libre sin mezclar con auditoria formal. |
| fecha actualizacion | `updated_at` | Marca de sincronizacion futura del adapter. |

## Estados esperados para `operationalInventoryContract`

- `DISPONIBLE`
- `RESERVADO_PARCIAL`
- `RESERVADO_TOTAL`
- `DESPACHADO`
- `VENCIDO`
- `OBSERVADO`
- `PENDIENTE_SINCRONIZACION`

## Derivacion futura a `availabilityContract`

La disponibilidad comercial futura debe derivarse del inventario operativo de rosas:

1. `operationalInventoryContract`
2. adapter de Parte 1
3. `availabilityContract`
4. `reservationContract`
5. consumo operativo / despacho

## Restricciones

- No mezclar este inventario con cartones, separadores, ligas, capuchones ni suministros administrativos.
- No importar `app.js` completo de Parte 1.
- No conectar Supabase ni SQL en esta fase.
- No crear tablas ni migraciones en esta fase.
