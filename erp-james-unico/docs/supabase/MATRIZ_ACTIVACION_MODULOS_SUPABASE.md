# MATRIZ ACTIVACION MODULOS SUPABASE

| Modulo | Estado actual | Repositorio preparado | Tabla futura | Feature flag | Criterio para activar | Riesgo | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core | local/demo | si | `companies`, `user_profiles`, `roles` | `VITE_ENABLE_CORE_SUPABASE` | usuarios definidos y auditoria prevista | alto | volver a local/demo |
| Comercial catalogos | demo/local | si | `customers`, `final_brands` | `VITE_ENABLE_COMMERCIAL_CATALOGS_SUPABASE` | catalogos validados | medio | usar data demo |
| Pedido Maestro | demo/local | si | `commercial_orders` | `VITE_ENABLE_COMMERCIAL_ORDERS_SUPABASE` | flujo estable | alto | desactivar flag |
| Operaciones disponibilidad | demo/local | si | `flower_availability` | `VITE_ENABLE_OPERATIONS_SUPABASE` | Parte 1 mapeada | alto | volver a demo |
| Scanner | demo | si | `scanner_events` | `VITE_ENABLE_SCANNER_SUPABASE` | lector HID probado | medio | guardar eventos local/demo |
| Inventario materiales | local/demo | si | `material_stock` | `VITE_ENABLE_MATERIAL_INVENTORY_SUPABASE` | bodega validada | medio | volver a local/demo |
| Contabilidad | local/demo | si | `journal_entries` | `VITE_ENABLE_ACCOUNTING_SUPABASE` | reglas contables validadas | muy alto | no activar en produccion |
| SRI | pendiente | no real | `sri_*` | `VITE_ENABLE_SRI_SUPABASE` | pruebas SRI listas | critico | desactivar SRI |
