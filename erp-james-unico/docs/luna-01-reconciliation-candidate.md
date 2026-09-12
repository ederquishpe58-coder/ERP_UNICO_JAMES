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

## Base, limites y publicacion NO autorizada

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
