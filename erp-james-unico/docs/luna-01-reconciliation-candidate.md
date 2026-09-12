# LUNA-01: conciliacion firmada (candidato local)

## Addendum TIPO y gates, 2026-09-12

TIPO usa flowerQuality.label: PREMIUM / TIPO_B se muestran PREMIUM / TIPO B.
Se mantiene el enum y no se escribe ninguna traduccion en los datos. Quality
ausente muestra SIN CALIDAD, no se convierte a PREMIUM.
Los cierres aportan independientemente con su quality explicita; si no existe,
usan la de su assignmentId demostrado. Si ambos carecen de tipo, permanecen en
el grano sin calidad. Una entrega sin tipo no se copia en las filas tipadas.
El calculo definitivo de mismatch permanece sin cambios.

Las definiciones PROD fueron leidas y se conservan en el fixture
test-fixtures/supplier-report-installed-20260912.json. Firma/retorno/STABLE,
SECURITY DEFINER y search_path coinciden. El wrapper requiere
operations.inventory.view y solo authenticated tiene EXECUTE (ademas de postgres).
El internal solo tiene EXECUTE para postgres. La migracion preserva ambos.
Se reprodujeron estas definiciones en PGlite, con mocks de identidad/capability,
y se aplico la migracion dos veces preservando ACL. Esto no prueba una sesion RLS.

Historial instalado leido: 202609120001 no aparece; se conserva esta version
libre al momento de lectura. 202609110001 es SRI y no fue modificada. No se aplico
la migracion del reporte. Revalidar la version antes de cualquier futura aplicacion.

GATE POOL = FAIL: el helper instalado erp_inventory_pool_company resuelve al owner,
pero el wrapper/internal del reporte no lo invoca. El candidato preserva ese
scope anterior, p_company_id, que corresponde a la operadora. La prueba local con
las definiciones instaladas reproduce que no lee el inventario del owner. No se
amplio automaticamente el acceso para pasar este gate. Hace falta revisar la
autorizacion del reporte para consumir las fuentes operativas del owner por el
resolver canonico, sin conceder permisos ni ampliar a datos comerciales.

Limite de lectura: supabase db query --linked imprimio Initialising login role
en las dos consultas SELECT. Esa inicializacion puede crear/renovar un rol tecnico.
Se detuvo esa ruta al detectar el efecto. No se afirma cero cambios de seguridad
de infraestructura, aunque no se ejecutaron escrituras de negocio ni migraciones.
No se intento revertir o cambiar ese rol. La metadata de companies del pool no
se releeyo por esta via; los datos humanos/sesion real permanecen NOT_VERIFIED.

El addendum sustituye los pendientes anteriores de lectura de firma/ACL e historial;
NO sustituye el bloqueo funcional del pool. READY FOR DEPLOY APPROVAL = NO.

## Contrato definitivo

`mismatch = classifiedStems - (exportedStems + nationalStems)`.

Los nombres de respuesta existentes se conservan: classifiedStems es entrega,
exportedStems es ingreso fisico confirmado y nationalStems es nacional/rechazo.
UI y XLSX consumen mismatch; no lo recalculan ni interpretan su causa.

## Fuentes y grano

- Entrega: operations_classifier_assignments.payload.totalStems. Vinculo
  receptionId/receptionItemId con operations_receptions para proveedor y variedad.
  No se recalculan tallos a partir de mallas.
- Nacional: SUM(operations_classification_results.payload.nationalStems), por
  assignmentId, antes de combinar con la entrega. El cierre guarda incrementos;
  accumulatedNationalStems no se suma. O/V/B/M son desglose del total, no otro aporte.
- Fisico: operations_rose_inventory / ESCANEO_ETIQUETA, misma expresion de
  componentes/stemsPerBunch/stems y mismas medidas que LUNA-01. Se mantiene la
  exclusion ANULADO del candidato; no se modifica ninguna fuente persistida.
- Grano: company scope, proveedor canonico, bloque normalizado, fecha de entrega
  o admision, variedad y quality cuando existe. Los cierres se atribuyen a su
  entrega vinculada, no se repiten por medida ni por fecha de registro del cierre.
  Quality ausente permanece distinta de PREMIUM; no se infiere equivalencia.
- SQL agrega cierres por entrega, agrega las etapas por separado y combina sus
  contribuciones sin join entre entregas crudas e inventario crudo.

## Correcciones de revision incorporadas

ID explicito tiene prioridad y no cae a nombre si es desconocido. UNKNOWN y
AMBIGUOUS conservan procedencia y se muestran en proveedor tanto en UI como XLSX.
Bloques vacios no son evidencia. B04/B4 y listas de bloques tienen el mismo
contrato JS/SQL. Varios bloques del proveedor conservan su detalle por bloque.
La identidad explicita no se cambia por el nombre o propietario actual del bloque.

## Pruebas reproducibles sin PROD

Node 24; PGlite 0.5.8 en memoria, sin database URLs. Instalarlo en un entorno de
pruebas separado o indicar PGLITE_MODULE con la ruta de su dist/index.js.

```
npm run validate:luna-01:supplier-report
npm run validate:supplier-reconciliation
npm run build
```

LUNA_REFERENCE_REPORT permite comparar las medidas y cantidades fisicas contra
el JS original de 929f579. LUNA_EVIDENCE_DIR determina la carpeta de XLSX sinteticos.
SUPPLIER_NEGATIVE_CONTROL=1 reinstala solo en PGlite la formula anterior: la prueba
debe FALLAR con -1 en lugar de 1. No modifica archivos de aplicacion.

La suite comprueba 250-(249+0)=1; 250-(240+10)=0; 250-(252+0)=-2; dos entregas,
cuatro cierres con desglose O/M, tres medidas; identidad, bloques y ambitos;
ANULADO/NULL/reimpresion; datos intactos en consultas; ACL/owner preservados;
migracion dos veces; valores de HTML y celdas P/Q/R/S del XLSX generado.
La prueba de permisos usa membership simulado. NO equivale a RLS/sesion real.

Fixture anterior: 1015 = 10+2+999+4 tallos sinteticos; se excluyen 999 ANULADO,
quedan 16. Entregas 20 y nacional 0 se conservan: desfase definitivo 20-16=4.
No son existencias leidas de PROD ni una reparacion de stock.

## Base y limites iniciales (superados por el cierre de pool abajo)

Base Zebra: 374c03bef27219db07edc0c9b2ef070a2cdc8ec0, deployment reportado/verificado
dpl_5ZfpP4RM4eTuqLNXYBCbJnN5j5f1. Se integro sin commit previo el diff 929f579,
preservando su worktree y todos los archivos Zebra. Sin push ni deploy.

Migracion propuesta: 202609120001_supplier_inventory_report_reconciliation.sql.
Numeracion unica en este arbol, NO verificada contra el historial instalado.
Se retiro del candidato la propuesta 202609110001 que colisionaba con SRI;
no se modifico ninguna migracion SRI ni historial de servidores.
El precheck exige la funcion internal instalada antes de CREATE OR REPLACE para
no crear accidentalmente una entrada nueva con ACL por defecto.

Bloqueos de publicacion: leer definicion/firma/ACL e historial instalados y
verificar el contrato IMPERIO operadora / BLESS propietaria. Este candidato NO
agrega permisos ni cambia el resolver de pool: p_company_id conserva su alcance
existente. La prueba de aislamiento no demuestra que IMPERIO resuelva el pool.
Tambien falta evidencia temporal para inferir relaciones historicas de bloque
solo a partir del catalogo actual. No aplicar a historicos como reparacion.

Antes de publicar: revalidar PROD y resolver estos bloqueos. Aplicar solo la
migracion revisada, no todas las pendientes; probar permisos y pool con lecturas
autorizadas. Reversion futura: restaurar solo el read-model capturado y el JS del
reporte mediante una nueva migracion/release, nunca retroceder Zebra/SRI ni datos.

## Cierre focal del pool - 2026-09-12

Continuacion de 2d1009f08df43304d9d6ee82dc67e1bb4f354b8a en el mismo worktree
aislado, limpio antes de editar. PROD canonico confirmado por inspect/API Vercel:
374c03bef27219db07edc0c9b2ef070a2cdc8ec0,
dpl_5ZfpP4RM4eTuqLNXYBCbJnN5j5f1. Ningun archivo Zebra cambia.

### Operadora y propietaria

La migracion conserva p_company_id como empresa operadora para la autorizacion.
El wrapper instalado exige operations.inventory.view; el internal comprueba
membership de esa misma operadora. Despues llama al resolver instalado
erp_inventory_pool_company(p_company_id), sin reemplazarlo ni cambiar sus ACL.

Solo las fuentes operations_suppliers, operations_receptions,
operations_classifier_assignments, operations_classification_results y
operations_rose_inventory usan v_source_company_id. Tambien lo usan supplierScope
y las claves de identidad. La respuesta agrega operatingCompanyId e
inventoryOwnerCompanyId, sin cambiar campos existentes ni pedir al frontend que
suplante company_id. El repository conserva la operadora en consulta/exportacion.
No se cambia branding, cabecera ni plantilla de Excel en este cierre.

Lectura Management API directa, read_only=true, 2026-09-12T11:29:21.524183Z:
BLESS activa, inventory_owner=true; IMPERIO activa, inventory_owner=false,
availability_source_company_key=COMP-BLESS-FLOWER. Las definiciones y ACL de
resolver/wrapper/internal coinciden exactamente con el fixture instalado.
202609120001 no esta ocupada; permanece pendiente, NO aplicada. La aplicacion
futura debe revalidar que siga libre y que las definiciones no hayan cambiado.
Segunda lectura final a las 11:40:29.143922Z: version aun libre, ultimo registro
instalado 202609110002; mismo mapping de empresas y atributos observados del rol.

### Verificacion aislada y limites

validate-supplier-reconciliation.mjs reinstala las definiciones capturadas en
PGlite en memoria, aplica la migracion dos veces y preserva ACL/owner de las tres
funciones. La prueba usa SET ROLE authenticated; auth.uid/membership/capability
son doubles locales controlados, NO una sesion James/IMPERIO ni RLS real.

- BLESS y actor solo IMPERIO obtienen las mismas fuentes BLESS.
- Fixture: dos entregas PREMIUM, cuatro cierres incrementales, tres medidas;
  entrega/cierre/escaneo TIPO_B; ANULADO separado. Totales: entregado 350,
  fisico 335, nacional 15, desfase 0. PREMIUM/TIPO_B conservan sus medidas.
- Registros con igual ID/B4 en IMPERIO y tercera empresa no contaminan el pool.
  Clientes, pedidos, asientos y perfiles BLESS con payloads senuelo son ignorados.
- Actor sin capability, empresa ajena, mapping ausente, actor nulo y llamada
  directa al internal/resolver privado permanecen bloqueados. La tercera empresa
  propietaria lee solo sus propias fuentes. No se agregan grants ni se cambia RLS.
- Repository real -> wrapper SQL real en PGlite -> UI -> exportador real con
  download:false. Celdas XLSX por TIPO y totales inspeccionados, filtros identicos.
- Datos operativos y metadata de empresas identicos antes/despues de las lecturas.
- Control negativo SUPPLIER_POOL_NEGATIVE_CONTROL=1 vuelve al filtro operadora
  solo en memoria: falla con entregado 9999/fisico 5555/nacional 7777 en vez de
  350/335/15. Demuestra que el test no pasa renombrando una empresa del fixture.
- Se conservan regresiones de identidad explicita, UNKNOWN/AMBIGUOUS, bloques
  vacios, paridad JS/SQL, ANULADO/NULL/reimpresion, TIPO y desfase firmado.

npm run validate:luna-01:supplier-report, node validate-supplier-reconciliation.mjs
y npm run build: PASS. El control negativo falla intencionalmente. No se usa build
como sustituto de prueba funcional. No se reejecutan validadores generales ajenos.
La lectura real verifica metadata/definiciones; el reporte modificado no se ejecuto
en PROD. Prueba humana de UI/sesion real pendiente tras una publicacion autorizada.

### Incidencia tecnica separada

La traza local de la revision anterior registra CLI 2.117.0, dos POST al endpoint
/cli/login-role con HTTP 201 a las 11:12:54.080Z y 11:13:03.963Z. El endpoint
oficial emite rol/credencial temporal y requiere database:write, no es un SELECT.
Clasificacion: TECHNICAL ROLE MUTATION CONFIRMED en esa revision anterior.
Rol actual: cli_login_postgres, LOGIN, miembro de postgres sin ADMIN OPTION,
sin SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS directos;
rolvaliduntil=2026-09-12T11:18:04.253510Z (ya vencido en la lectura).

No se conserva respuesta del endpoint ni snapshot anterior: CREATE frente a
ALTER/rotacion, existencia previa y cambios exactos de atributos son NOT_VERIFIED.
No se infiere que el rol desaparezca al vencer la contrasena. No se altero,
elimino ni renovo durante este cierre. No se reutiliza el camino CLI db/link.
El lector actual usa CredReadW de credencial existente y POST database/query con
read_only=true, exclusivamente SELECT. Dos lecturas iniciales fallaron porque
intentaban ejecutar el resolver privado; se retiro esa invocacion y se leyeron
su definicion y metadata, sin elevar permisos ni cambiar read_only.

Fuente oficial: https://supabase.com/docs/reference/api/v1-create-login-role
Evidencia saneada y resultado de gates:
../../LUNA-POOL-CLOSE-20260912/ (fuera del codigo de aplicacion).
La reparacion de la incidencia tecnica queda separada y NO autorizada.

### Orden futuro y preservacion

Solicitar aprobacion de publicacion; revalidar SHA, numero libre y ACL; aplicar
SOLO esta migracion; publicar el candidato sobre Zebra; verificar lecturas BLESS
e IMPERIO y XLSX sin generar operaciones. Para revertir, nueva migracion que
restaure el internal capturado y release focal del reporte, nunca rollback global
de Zebra/SRI ni modificaciones de fuentes. No hay reparacion historica autorizada.

Este cierre crea solamente un commit local. PROD data/schema/permission changes=0,
SRI requests=0, impresiones=0, cambios de inventario=0, deployments=0 durante
este turno. No se afirma que la base completa permaneciera inmovil por otros usuarios.
