# FASE 3E-2 - Puente futuro inventario real Parte 1

## Que se preparo

- Se reforzo `scripts/modules/operaciones/parte1-adapter.js` como puente futuro entre Parte 1 POSCOSECHA y el ERP unico.
- Se dejo listo el estado del adaptador, cargas demo, mapeos demo y validadores de payload para inventario, disponibilidad, etiquetas de ramo y despacho.
- Se actualizaron `operationalInventoryContract` y `availabilityContract` para dejar claro que la fuente futura real sera Parte 1.
- Se agrego un bloque visual en `Operaciones / Poscosecha -> Inventario de rosas` para revisar el puente, el estado del adaptador y un mapeo demo.
- Se reforzo `Operaciones / Poscosecha -> Disponibilidad` indicando que la fuente actual sigue siendo DEMO y la fuente futura sera Parte 1 POSCOSECHA.
- Se actualizo el diagnostico del ERP unico para reflejar que el puente esta preparado pero no conectado.

## Que es `parte1-adapter.js`

`parte1-adapter.js` es la capa de traduccion futura entre la estructura operativa real de Parte 1 y los contratos internos del ERP unico.

Su objetivo es:

- recibir payloads controlados de Parte 1
- validarlos
- normalizarlos
- mapearlos a contratos internos del ERP unico

En esta fase no lee datos externos ni se conecta a Supabase.

## Por que no se debe importar `app.js` completo

- `app.js` de Parte 1 concentra logica pesada, estado y dependencias propias del prototipo original.
- Importarlo completo rompería el objetivo del ERP unico modular.
- Tambien aumentaria el riesgo de dependencias globales, efectos laterales y conflictos con el shell actual.
- El enfoque correcto es extraer payloads y traducirlos por adaptador, no mezclar aplicaciones.

## Como se mapeara el inventario real a `operationalInventoryContract`

El adapter ya prepara:

- `mapParte1InventoryToOperationalInventoryContract(rawItem)`
- `validateParte1InventoryPayload(rawItem)`

El mapeo normaliza campos como:

- origen y record real
- variedad
- longitud
- tallos por ramo
- ramos iniciales, disponibles, reservados y consumidos
- bodega, proveedor, bloque
- categoria, edad y estado

## Como se generara `availabilityContract` desde inventario real

La disponibilidad futura no nacera desde Comercial.

Flujo previsto:

1. Parte 1 produce inventario operativo real de rosas.
2. `parte1-adapter.js` valida y mapea ese inventario a `operationalInventoryContract`.
3. Desde ese inventario operativo se deriva `availabilityContract`.
4. Comercial consulta disponibilidad y genera reservas por `reservationContract`.
5. Las reservas reales futuras devolveran cambios al inventario operativo a traves del adaptador.

## Como se conectara Comercial en el futuro

- Comercial seguira consultando disponibilidad desde Operaciones.
- Pedido Maestro no creara inventario de rosas propio.
- Las reservas reales futuras deberan actualizar el inventario operativo de rosas mediante adaptador.
- El consumo real por despacho tambien debera salir del inventario operativo de rosas y no desde una tabla comercial aislada.

## Que sigue siendo demo

- `getParte1AdapterStatus()`
- `loadRecepcionesFromParte1()`
- `loadClasificacionFromParte1()`
- `loadInventarioRosasFromParte1()`
- `loadDisponibilidadFromParte1()`
- `loadReservasFromParte1()`
- `loadDespachosFromParte1()`

Todas estas funciones siguen trabajando con payloads controlados o estado `PENDIENTE_INTEGRACION_REAL`.

## Que no se conecto todavia

- inventario real de rosas
- archivos externos de Parte 1
- modulos reales de Parte 1
- Supabase
- SQL
- migraciones
- consumo real
- scanner real

## Riesgos tecnicos

- Parte 1 puede tener nombres de campos distintos a los previstos en el mapeo demo.
- Parte 1 puede manejar estados no homologados al catalogo del ERP unico.
- Puede existir logica oculta en el prototipo original que no deba copiarse al shell modular.
- Si en una fase futura se intenta importar `app.js` completo, se perdera el desacople logrado.

## Siguiente fase recomendada

Hacer una fase de levantamiento controlado de payloads reales de Parte 1 sin integrarlos todavia:

- inventario operativo real
- disponibilidad real
- reservas reales
- estados reales de despacho

La siguiente fase debe comparar esos payloads contra `docs/MAPEO_PARTE1_A_ERP_UNICO.md` antes de conectar nada.
