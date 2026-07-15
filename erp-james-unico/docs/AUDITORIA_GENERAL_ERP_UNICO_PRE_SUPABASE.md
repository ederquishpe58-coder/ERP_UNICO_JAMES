# AUDITORIA GENERAL ERP UNICO PRE SUPABASE

## A. Estado general

- Shell unico activo
- Navegacion modular activa
- Modo local/demo activo
- Supabase desactivado
- Auth real pendiente
- RLS pendiente
- SRI pendiente
- Inventario real pendiente
- Scanner real pendiente
- Contabilidad real de ventas pendiente

## B. Comercial / Exportaciones

Estado:

- Pedido Maestro demo activo
- Historial comercial demo activo
- Documentos comerciales demo activos
- Invoice / Packing carguera demo activo
- Factura Comercial Cliente demo activa
- Centro de impresion demo activo
- Preview contable demo activo
- Conexion contable real pendiente
- Facturacion SRI pendiente

## C. Operaciones / Poscosecha

Estado:

- Inventario rosas demo activo
- Disponibilidad demo activa
- Reservas demo activas
- Despacho operativo demo activo
- Scanner / Zebra demo activo
- Consumo inventario rosas demo activo
- Kardex operativo demo activo
- Parte 1 adapter preparado
- Integracion real Parte 1 pendiente
- Descuento inventario real pendiente

## D. Administracion / Contabilidad

Estado:

- Plan de cuentas local/demo activo
- Libro diario / mayor local/demo activo
- Compras local/demo activo
- Retenciones local/demo activo
- Bancos local/demo activo
- CxP / CxC local/demo activo
- ATS preliminar demo activo
- Ventas reales desde Comercial pendiente
- SRI ventas pendiente

## E. Inventario suministros / empaque

Estado:

- Inventario materiales local/demo activo
- Requerimiento empaque desde pedido demo activo
- Consumo real de materiales pendiente
- Kardex real materiales pendiente

## F. Supabase

Estado:

- Arquitectura futura documentada
- Primera migracion minima definida
- SQL revisable creado
- Cliente Supabase preparado pero desactivado
- Repositorios futuros preparados
- Feature flags creadas
- Migracion progresiva documentada
- Rollback documentado
- SQL real no ejecutado
- Tablas reales no creadas

## G. Riesgos antes de Supabase

- Activar muchos modulos a la vez
- Ejecutar SQL sin revisar
- Migrar datos demo como reales
- Activar contabilidad antes de SRI
- Mezclar inventario de rosas con inventario de materiales
- Integrar `app.js` completo de Parte 1
- Activar scanner real sin pruebas HID
- No tener backups
- No definir roles / RLS antes de produccion
