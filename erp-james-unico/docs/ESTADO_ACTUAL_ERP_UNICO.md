# ESTADO ACTUAL ERP UNICO

## Que se hizo

- Se creo `erp-james-unico` usando Parte 2 como base tecnica.
- Se estabilizo el shell unico con sidebar, topbar y content area unificados.
- Se integraron en modo demo avanzado:
  - Comercial / Exportaciones
  - Operaciones / Poscosecha
- Se documentaron contratos internos modulares.
- Se cerro el ciclo operativo demo desde inventario de rosas hasta consumo y kardex demo.
- Se completo FASE 4A:
  - navegacion revisada
  - modulos ordenados
  - diagnostico actualizado
  - contratos revisados
  - preparacion conceptual Supabase documentada
  - sin conexion real a Supabase
  - sin SQL ejecutado
- Se completo FASE 4B:
  - arquitectura Supabase futura documentada
  - tablas por modulo disenadas
  - relaciones futuras documentadas
  - SQL revisable creado
  - RLS conceptual creado
  - contratos mapeados a tablas
  - no se ejecuto SQL
  - no se conecto Supabase
- Se completo FASE 4C:
  - primera migracion minima Supabase definida
  - SQL revisable 003 creado
  - exclusiones documentadas
  - campos minimos documentados
  - orden posterior definido
  - no se ejecuto SQL
  - no se conecto Supabase
- Se completo FASE 4D:
  - .env.example creado
  - env.js creado
  - cliente Supabase preparado pero desactivado
  - repository-base preparado
  - documentacion de configuracion creada
  - ERP sigue funcionando en modo local/demo
  - no se conecto Supabase
  - no se ejecuto SQL
  - no se crearon migraciones reales
- Se completo FASE 4E:
  - capa de repositorios futuros creada
  - repositorios Core preparados
  - repositorios Comercial preparados
  - repositorios Operaciones preparados
  - repositorios Inventario materiales preparados
  - repositorios Contabilidad preparados
  - servicios demo/locales siguen activos
  - Supabase sigue desactivado
  - no se ejecuto SQL
  - no se crearon migraciones reales
- Se completo FASE 4F:
  - migracion progresiva por modulo documentada
  - feature flags futuras agregadas
  - guard de feature flags creado
  - rollback documentado
  - checklist de pruebas creado
  - seeds iniciales documentados
  - repositorios siguen preparados pero no activos
  - Supabase sigue desactivado
- Se completo FASE 4G:
  - auditoria general pre-Supabase creada
  - checklist final pre-Supabase creado
  - decision Go/No-Go documentada
  - modulos congelados/pendientes documentados
  - diagnostico final actualizado
  - Supabase sigue desactivado
  - SQL no ejecutado
  - servicios demo/locales siguen activos
- Se completo FASE 5A:
  - plan de pruebas funcionales creado
  - checklist funcional general creado
  - auditoria de rutas creada
  - placeholders documentados
  - flujo comercial demo documentado
  - flujo operativo demo documentado
  - contabilidad local/demo documentada
  - riesgos funcionales documentados
  - ERP sigue en modo local/demo
- Se completo FASE 5B:
  - hallazgos visuales/funcionales revisados
  - navegacion revisada
  - mensajes demo reforzados
  - placeholders revisados
  - diagnostico actualizado
  - servicios reales siguen desactivados
  - ERP sigue en modo local/demo
- Se completo FASE 5C:
  - ruta Prueba guiada demo creada
  - pasos de usuario final documentados
  - formato de resultados creado
  - criterios de aceptacion creados
  - diagnostico actualizado
  - ERP sigue modo local/demo
  - servicios reales siguen desactivados

## Que quedo activo

- Core del sistema
- Operaciones / Poscosecha en demo avanzado
- Comercial / Exportaciones en demo avanzado
- Administracion / Contabilidad en activo demo/local
- Inventario suministros / empaque en activo demo/local
- Reportes en activo demo/local
- Configuracion en activo demo/local

## Que quedo pendiente futuro

- Supabase real
- Login real
- Roles y permisos reales
- Auditoria persistente
- Facturacion SRI ventas
- Contabilidad real de ventas
- Inventario real de rosas desde Parte 1
- Scanner / Zebra real

## Que no se debe tocar todavia

- No integrar logica pesada de Parte 1.
- No integrar logica pesada de Parte 3.
- No tocar Supabase.
- No ejecutar SQL.
- No crear migraciones.
- No implementar facturacion SRI real.
- No llevar inventario de rosas dentro de contabilidad.
- No mezclar modulos dentro de un `app.js` monolitico.

## Proxima fase recomendada

- Definir el alcance exacto del primer modulo que pasara de demo/local a persistencia real.
- Congelar contratos y campos obligatorios antes de tocar Supabase.
- Preparar primero Core, Pedido Maestro, Despacho e Inventario de rosas como frentes prioritarios.

## Riesgos detectados

- Si se conecta Supabase antes de congelar contratos, se multiplica la deuda tecnica.
- Si se mezcla inventario de rosas con inventario administrativo, se rompe la separacion funcional del ERP.
- Si se conecta Comercial con contabilidad real antes de definir factura SRI, pueden quedar ventas mal clasificadas.
- Si se importa `app.js` completo de Parte 1 o Parte 3, se pierde el control modular del ERP unico.

## Comandos de build

```bash
npm run build
npm run build:standalone
npm run validate:shell
```
