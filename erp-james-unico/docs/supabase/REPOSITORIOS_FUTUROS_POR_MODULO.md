# REPOSITORIOS FUTUROS POR MODULO

## Objetivo

Preparar una capa de repositorios por modulo para que el ERP unico tenga un punto claro de transicion a Supabase en una fase futura, sin reemplazar todavia los servicios demo/locales.

## Estado actual

- Repositorios preparados: si
- Conexion Supabase: no
- Fuente activa actual: local/demo
- Reemplazo de servicios demo/locales: no realizado
- Modo actual: `LOCAL_DEMO`

## Que repositorios se crearon

### Core

- `company-repository.js`
- `user-repository.js`
- `audit-log-repository.js`
- `sequence-repository.js`
- `settings-repository.js`

### Comercial

- `customer-repository.js`
- `final-brand-repository.js`
- `commercial-order-repository.js`
- `commercial-order-box-repository.js`
- `commercial-order-line-repository.js`
- `commercial-document-repository.js`
- `commercial-workflow-repository.js`
- `dae-repository.js`
- `cargo-agency-repository.js`
- `airline-repository.js`
- `export-product-repository.js`

### Operaciones

- `flower-availability-repository.js`
- `flower-reservation-repository.js`
- `operational-dispatch-repository.js`
- `operational-dispatch-box-repository.js`
- `scanner-event-repository.js`
- `operational-consumption-repository.js`
- `operational-kardex-repository.js`
- `flower-inventory-repository.js`
- `bunch-label-repository.js`

### Inventario materiales

- `material-item-repository.js`
- `material-stock-repository.js`
- `material-movement-repository.js`
- `packaging-requirement-repository.js`

### Contabilidad

- `chart-of-accounts-repository.js`
- `journal-entry-repository.js`
- `journal-entry-line-repository.js`
- `supplier-repository.js`
- `purchase-repository.js`
- `withholding-issued-repository.js`
- `withholding-received-repository.js`
- `cxp-repository.js`
- `cxc-repository.js`
- `bank-account-repository.js`
- `bank-movement-repository.js`

## Para que sirven

- Separan desde ahora la futura capa de persistencia por dominio.
- Evitan que la futura activacion de Supabase se mezcle con pantallas o servicios demo.
- Permiten migrar modulo por modulo, sin romper el ERP actual.
- Dejan un mapa claro entre contrato, tabla futura y repositorio preparado.

## Por que no reemplazan servicios actuales

- `comercial-data.js`, `pedido-maestro.js` y demas modulos comerciales siguen usando datos demo/locales.
- `disponibilidad-service-demo.js`, `despacho-service-demo.js`, `scanner-service-demo.js` y `consumo-inventario-demo.js` siguen siendo la fuente activa en Operaciones.
- Contabilidad e inventario administrativo siguen funcionando en modo local/demo.
- Los repositorios nuevos solo devuelven estado controlado de repositorio pendiente.

## Mapa modulo -> repositorio -> tabla futura

| Modulo | Repositorios preparados | Tablas futuras principales |
| --- | --- | --- |
| Core | company, user, audit-log, sequence, settings | `companies`, `user_profiles`, `audit_logs`, `sequences`, `app_settings` |
| Comercial | customer, final-brand, commercial-order, commercial-order-box, commercial-order-line, commercial-document, commercial-workflow, dae, cargo-agency, airline, export-product | `customers`, `final_brands`, `commercial_orders`, `commercial_order_boxes`, `commercial_order_lines`, `commercial_documents`, `commercial_workflow_events`, `dae_records`, `cargo_agencies`, `airlines`, `export_products` |
| Operaciones | flower-availability, flower-reservation, operational-dispatch, operational-dispatch-box, scanner-event, operational-consumption, operational-kardex, flower-inventory, bunch-label | `flower_availability`, `flower_reservations`, `operational_dispatches`, `operational_dispatch_boxes`, `scanner_events`, `operational_consumptions`, `operational_kardex`, `flower_inventory`, `bunch_labels` |
| Inventario materiales | material-item, material-stock, material-movement, packaging-requirement | `material_items`, `material_stock`, `material_movements`, `packaging_requirements` |
| Contabilidad | chart-of-accounts, journal-entry, journal-entry-line, supplier, purchase, withholding-issued, withholding-received, cxp, cxc, bank-account, bank-movement | `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `suppliers`, `purchases`, `withholdings_issued`, `withholdings_received`, `cxp_documents`, `cxc_documents`, `bank_accounts`, `bank_movements` |

## Estado actual de activacion

- Preparados: si
- Conectados: no
- Consultas reales: no
- Auth real: no
- RLS real: no
- Dependencia obligatoria de Supabase en la app: no

## Que falta para activarlos

- Confirmar la primera migracion minima real.
- Ejecutar migraciones oficiales en ambiente de pruebas.
- Configurar `VITE_SUPABASE_ENABLED=true` en `.env.local`.
- Activar cliente Supabase real.
- Sustituir servicios demo/locales de forma progresiva, no de golpe.
- Probar por modulo antes de tocar datos reales.
