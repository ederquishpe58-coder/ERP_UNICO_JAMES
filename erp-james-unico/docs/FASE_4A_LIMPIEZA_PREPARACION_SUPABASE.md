# FASE 4A LIMPIEZA PREPARACION SUPABASE

## Que se reviso

- navegacion general del ERP unico
- orden de rutas en Operaciones y Comercial
- `module-registry`
- contratos internos documentados
- diagnostico central del ERP
- mensajes demo principales

## Navegacion final

- Core del sistema
- Operaciones / Poscosecha
- Comercial / Exportaciones
- Administracion / Contabilidad
- Inventario suministros / empaque
- Reportes
- Configuracion
- Modulos futuros

## Modulos activos y demo

- Core del sistema: activo
- Operaciones / Poscosecha: demo avanzado
- Comercial / Exportaciones: demo avanzado
- Administracion / Contabilidad: activo demo/local
- Inventario suministros / empaque: activo demo/local
- Reportes: activo demo/local
- Configuracion: activo demo/local
- Modulos futuros: placeholder futuro

## Contratos revisados

- `availabilityContract`
- `reservationContract`
- `commercialOrderContract`
- `boxDetailContract`
- `packagingRequirementContract`
- `salesAccountingContract`
- `clientCommercialInvoiceContract`
- `commercialWorkflowContract`
- `dispatchContract`
- `scannerEventContract`
- `operationalInventoryContract`
- `bunchLabelContract`
- `operationalConsumptionContract`
- `auditEventContract`

## Diagnostico actualizado

- estado general del shell
- comercial / exportaciones
- operaciones / poscosecha
- contabilidad / administracion
- inventario suministros / empaque
- pendientes tecnicos

## Preparacion Supabase creada

- `docs/supabase/PREPARACION_SUPABASE_FUTURO.md`
- `docs/supabase/MAPA_MODULOS_TABLAS_FUTURAS.md`
- `docs/supabase/CHECKLIST_ANTES_DE_SUPABASE.md`

## Que NO se hizo

- no se conecto Supabase
- no se ejecuto SQL
- no se crearon migraciones
- no se implemento login real
- no se implemento SRI real
- no se conecto contabilidad real de ventas

## Riesgos antes de conectar base real

- contratos aun pueden cambiar si no se congelan campos
- Comercial y Operaciones siguen en demo/local
- contabilidad de ventas y SRI todavia no tienen flujo real aprobado
- Parte 1 real sigue pendiente de integracion controlada

## Siguiente fase recomendada

- definir el primer frente que se llevara a persistencia real
- congelar contratos clave
- preparar esquema Core + Comercial + Operaciones antes de tocar Supabase
