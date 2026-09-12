import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const reportPath = path.join(root, "scripts", "modules", "operaciones", "inventario-proveedores-report-xlsx.js");
const codecPath = path.join(root, "scripts", "modules", "operaciones", "bunch-label-codec.js");
const workbookPath = path.join(root, "scripts", "modules", "operaciones", "ramos-report-xlsx.js");
const migrationPath = path.join(root, "supabase", "migrations", "202609120001_supplier_inventory_report_reconciliation.sql");

const [reportSource, codecSource, workbookSource, migrationSource] = await Promise.all([
  readFile(reportPath, "utf8"),
  readFile(codecPath, "utf8"),
  readFile(workbookPath, "utf8"),
  readFile(migrationPath, "utf8")
]);

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

function createBrowserApi() {
  const listeners = [];
  const window = {
    BlessERP: {
      operacionesState: {
        getStore: appState => appState.db.operations,
        getUi: appState => appState.db.operations.ui
      }
    },
    addEventListener: (...args) => listeners.push(args),
    clearTimeout,
    setTimeout
  };
  const context = {
    window,
    console,
    Intl,
    Object,
    Map,
    Set,
    Number,
    String,
    Array,
    Date,
    Math,
    JSON,
    RegExp,
    Uint8Array,
    TextEncoder,
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(codecSource, context, { filename: codecPath });
  vm.runInNewContext(workbookSource, context, { filename: workbookPath });
  vm.runInNewContext(reportSource, context, { filename: reportPath });
  return { context, BlessERP: window.BlessERP, listeners };
}

function zipEntries(archive) {
  const entries = new Map();
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let offset = 0;
  while (offset + 4 <= archive.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(archive.slice(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    entries.set(name, archive.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function baseSourceRow(overrides = {}) {
  return {
    date: "2026-09-10",
    dateTime: "2026-09-10 10:00",
    supplier: "CANONICAL SUPPLIER",
    supplierId: "BQ0004",
    supplierCode: "BQ0004",
    supplierResolution: "RESOLVED",
    supplierIdentityKey: "CANONICAL:BLESS:BQ0004",
    supplierScope: "BLESS",
    block: "B4",
    variety: "EXPLORER",
    length: 60,
    sourceType: "CLASIFICACION",
    classificationPending: false,
    classifiedStems: 0,
    inventoryStems: 0,
    exportedStems: 0,
    nationalStems: 0,
    mismatch: 0,
    responsible: "TEST",
    ...overrides
  };
}

function makeFixture() {
  const sameCanonicalName = "FINCA B4 - JOSE LANCHIMBA";
  return {
    db: {
      operations: {
        companyId: "BLESS",
        ui: {},
        masterData: {
          suppliers: [
            { __canonicalRecordId: "BQ0004", id: "BQ0004", code: "BQ0004", name: sameCanonicalName, assignedBlock: "B4", active: true },
            { __canonicalRecordId: "BQ0005", id: "BQ0005", code: "BQ0005", name: sameCanonicalName, assignedBlock: "B5", active: true },
            { __canonicalRecordId: "BQ0099", id: "BQ0099", code: "BQ0099", name: "AMBIGUO A", assignedBlock: "B9", active: true },
            { __canonicalRecordId: "FIN-099", id: "FIN-099", code: "FIN-099", name: "AMBIGUO B", assignedBlock: "B9", active: true }
          ]
        },
        classifierAssignments: [
          {
            id: "assignment-bq0004",
            status: "COMPLETADO",
            dateTime: "2026-09-10 09:00",
            supplier: sameCanonicalName,
            block: "B4",
            variety: "EXPLORER",
            length: 60,
            totalStems: 10,
            nationalStems: 0,
            classifier: "CLASIFICADOR"
          },
          {
            id: "assignment-same-name-other-block",
            status: "COMPLETADO",
            dateTime: "2026-09-10 09:30",
            supplier: sameCanonicalName,
            block: "B5",
            variety: "EXPLORER",
            length: 60,
            totalStems: 7,
            nationalStems: 0,
            classifier: "CLASIFICADOR"
          },
          {
            id: "assignment-unknown",
            status: "COMPLETADO",
            dateTime: "2026-09-10 10:00",
            supplier: "PROVEEDOR NUEVO",
            block: "B8",
            variety: "EXPLORER",
            length: 60,
            totalStems: 3,
            nationalStems: 0,
            classifier: "CLASIFICADOR"
          }
        ],
        labelBatches: [],
        roseInventory: [
          {
            inventoryId: "inventory-bq0004",
            sourceType: "ESCANEO_ETIQUETA",
            state: "ACTIVO",
            admittedAt: "2026-09-10 11:00",
            variety: "EXPLORER",
            length: 60,
            composition: [{ supplier: "P004", block: "B4", stems: 10 }]
          },
          {
            inventoryId: "inventory-bq0004-null-state",
            sourceType: "ESCANEO_ETIQUETA",
            state: null,
            admittedAt: "2026-09-10 11:05",
            variety: "EXPLORER",
            length: 60,
            composition: [{ supplier: "P004", block: "B4", stems: 2 }]
          },
          {
            inventoryId: "inventory-annulled",
            sourceType: "ESCANEO_ETIQUETA",
            state: "ANULADO",
            admittedAt: "2026-09-10 11:10",
            variety: "EXPLORER",
            length: 60,
            composition: [{ supplier: "P004", block: "B4", stems: 999 }]
          },
          {
            inventoryId: "inventory-ambiguous",
            sourceType: "ESCANEO_ETIQUETA",
            state: "ACTIVO",
            admittedAt: "2026-09-10 11:15",
            variety: "EXPLORER",
            length: 70,
            composition: [{ supplier: "P099", block: "B9", stems: 4 }]
          }
        ]
      }
    }
  };
}

assertContains(migrationSource, /entity\s*=\s*'operations_suppliers'/, "El read-model debe consultar el catalogo canonico de proveedores.");
assertContains(migrationSource, /supplier_candidates/, "La migracion debe materializar candidatos antes de agrupar.");
assertContains(migrationSource, /supplier_group_key/, "La agrupacion debe usar una identidad estable y con ambito.");
assertContains(migrationSource, /create or replace function public\.erp_operations_v2_supplier_inventory_report_u2c3_internal\(/, "La migracion debe reemplazar solo el read-model interno.");
assert.doesNotMatch(migrationSource, /create or replace function public\.erp_operations_v2_supplier_inventory_report\(/, "El wrapper publico con guard de capability no debe ser reemplazado.");
assertContains(migrationSource, /array_append\(c\.aliases, c\.legacy_transport_code\)/, "Los aliases legacy deben depender del catalogo, no de un mapping hardcodeado.");
assertContains(migrationSource, /upper\(coalesce\(inventory\.payload ->> 'state', ''\)\) <> 'ANULADO'/, "El aporte de inventario debe excluir ANULADO y conservar NULL/ausente.");
assertContains(migrationSource, /group by report_date, supplier_group_key/, "El proveedor canonicalizado debe ser la clave de agrupacion.");
assert.doesNotMatch(migrationSource, /group by report_date, supplier, variety\s*$/m, "No debe permanecer la agrupacion exclusivamente textual.");
assert.doesNotMatch(migrationSource, /(?:revoke|grant)\s+(?:all|execute)\s+on\s+function/i, "La migracion no debe alterar privilegios del wrapper ni del read-model.");
assert.doesNotMatch(migrationSource, /\b(drop|delete|update|insert)\b/i, "La migracion no debe reparar datos de negocio.");

assertContains(reportSource, /resolveSupplierIdentity/, "El fallback local debe usar el mismo contrato de identidad.");
assertContains(reportSource, /sourceType === "ESCANEO_ETIQUETA" && normalizeText\(item\.state \|\| item\.payload\?\.state\)\.toUpperCase\(\) !== "ANULADO"/, "El fallback local debe excluir ramos ANULADO.");
assertContains(reportSource, /const supplierKey = reportSupplierIdentityKey\(item\)/, "La agregacion local debe consumir la identidad canonicalizada.");
assertContains(reportSource, /buildSupplierClassificationSheets\(workbookReport\)/, "Pantalla y exportacion deben compartir el mismo resultado consultado.");

const { BlessERP } = createBrowserApi();
const reportApi = BlessERP.operacionesInventarioProveedoresReport;
const fixture = makeFixture();
const before = JSON.stringify(fixture);
const legacySupplierKeys = new Set([
  ["2026-09-10", "FINCA B4 - JOSE LANCHIMBA", "EXPLORER"].join("|"),
  ["2026-09-10", "P004", "EXPLORER"].join("|")
]);
assert.equal(legacySupplierKeys.size, 2, "El comportamiento anterior separaba las representaciones textuales del mismo proveedor.");
const legacyInventoryStems = fixture.db.operations.roseInventory
  .filter(item => item.sourceType === "ESCANEO_ETIQUETA")
  .reduce((sum, item) => sum + Number(item.composition?.[0]?.stems || item.stems || 0), 0);
assert.equal(legacyInventoryStems, 1015, "El comportamiento anterior incluia el aporte ANULADO en el total de inventario.");
const sourceRows = reportApi.buildSupplierClassificationSourceRows(fixture);
const rows = reportApi.aggregateSupplierClassificationRows(sourceRows);
const after = JSON.stringify(fixture);

assert.equal(sourceRows.length, 6, "ANULADO debe salir del universo sin eliminar los demas registros.");
assert.equal(sourceRows.filter(item => item.sourceType === "INVENTARIO_BONCHES").length, 3, "Solo los inventarios activos o sin estado deben aportar metricas.");
assert.equal(sourceRows.some(item => item.inventoryState === "ANULADO"), false, "Un ramo ANULADO no debe llegar al agregado.");
assert.equal(JSON.stringify(sourceRows.filter(item => item.sourceType === "INVENTARIO_BONCHES").map(item => item.inventoryStems).sort((a, b) => a - b)), JSON.stringify([2, 4, 10]), "Las cantidades fuente activas deben conservarse.");

const canonical = rows.find(item => item.supplierId === "BQ0004");
assert.ok(canonical, "La representacion de nombre y P004 debe resolver el mismo proveedor.");
assert.equal(canonical.supplier, "FINCA B4 - JOSE LANCHIMBA");
assert.equal(canonical.classifiedStems, 10);
assert.equal(canonical.exportedStems, 12);
assert.equal(canonical.length60, 12);

const sameNameOtherBlock = rows.find(item => item.supplierId === "BQ0005");
assert.ok(sameNameOtherBlock, "Un proveedor distinto con nombre igual debe conservarse separado por identidad canonica.");
assert.equal(sameNameOtherBlock.classifiedStems, 7);
assert.notEqual(canonical.supplierIdentityKey, sameNameOtherBlock.supplierIdentityKey);

const ambiguous = sourceRows.find(item => item.supplier === "P099");
assert.equal(ambiguous?.supplierResolution, "AMBIGUOUS", "Una correspondencia multiple debe bloquear la fusion.");
const unknown = sourceRows.find(item => item.supplier === "PROVEEDOR NUEVO");
assert.equal(unknown?.supplierResolution, "UNKNOWN", "Una fuente sin catalogo debe conservar diagnostico.");
assert.equal(new Set(rows.map(item => item.supplierIdentityKey)).size, 4, "Los grupos canonicos y no resueltos deben mantener su identidad.");
assert.equal(reportApi.supplierClassificationTotals(rows).suppliers, 4);
assert.equal(before, after, "El armado del reporte no puede mutar los datos fuente.");

const multiBlock = reportApi.aggregateSupplierClassificationRows([
  baseSourceRow({ sourceType: "CLASIFICACION", block: "B4", classifiedStems: 5 }),
  baseSourceRow({ sourceType: "INVENTARIO_BONCHES", block: "B5", length: 70, inventoryStems: 5, exportedStems: 5 })
]);
assert.equal(multiBlock.length, 2, "La conciliacion conserva el bloque dentro del proveedor canonico.");
assert.equal(multiBlock[0].block, "B4");
assert.equal(multiBlock[0].classifiedStems, 5);
assert.equal(multiBlock[1].exportedStems, 5);
assert.equal(new Set(multiBlock.map(item => item.supplierIdentityKey)).size, 1);

const explicitMultiBlockIdentity = reportApi.resolveSupplierIdentity(fixture.db.operations, {
  supplierId: "BQ0004",
  block: "B5",
  sourceType: "INVENTARIO_BONCHES"
});
assert.equal(explicitMultiBlockIdentity.status, "RESOLVED", "Una relacion canonica explicita conserva la identidad aunque el proveedor tenga mas de un bloque.");

const imperioStore = { ...fixture.db.operations, companyId: "IMPERIO" };
const blessIdentity = reportApi.resolveSupplierIdentity(fixture.db.operations, { supplier: "P004", block: "B4", sourceType: "INVENTARIO_BONCHES" });
const imperioIdentity = reportApi.resolveSupplierIdentity(imperioStore, { supplier: "P004", block: "B4", sourceType: "INVENTARIO_BONCHES" });
assert.equal(blessIdentity.status, "RESOLVED");
assert.equal(imperioIdentity.status, "RESOLVED");
assert.notEqual(blessIdentity.groupKey, imperioIdentity.groupKey, "El ambito de empresa debe formar parte de la identidad.");

const totals = reportApi.supplierClassificationTotals(rows);
const sheets = reportApi.buildSupplierClassificationSheets({
  rows,
  totals,
  period: "10/09/2026",
  range: "2026-09-10 a 2026-09-10"
});
assert.equal(sheets[0].rows.length, rows.length, "La hoja principal debe usar exactamente las filas consultadas.");
assert.deepEqual(sheets[0].rows.map(row => row[1]), rows.map(row => row.supplierResolution === "RESOLVED" ? row.supplier : `${row.supplier} [${row.supplierResolution}]`), "La exportacion debe conservar los proveedores y diagnosticos mostrados.");
assert.equal(sheets.length, rows.length + 1, "Cada identidad de proveedor debe conservar su propia hoja de detalle.");
assert.equal(sheets.slice(1).filter(sheet => sheet.rows.some(row => row[1] === "FINCA B4 - JOSE LANCHIMBA")).length, 2, "Dos proveedores con el mismo nombre no deben fusionarse en el detalle XLSX.");
const archive = BlessERP.operacionesRamosReportXlsx.buildWorkbookArchive(
  sheets,
  { period: "10/09/2026", range: "2026-09-10 a 2026-09-10", identity: { commercialName: "Fixture" } },
  Uint8Array.of(1, 2, 3)
);
const archiveFiles = zipEntries(archive);
const firstSheet = new TextDecoder().decode(archiveFiles.get("xl/worksheets/sheet1.xml"));
assert.match(firstSheet, /FINCA B4 - JOSE LANCHIMBA/);
assert.match(firstSheet, />12<|>12\.0</, "El XLSX debe contener el total activo esperado.");

const evidenceDirectory = process.env.LUNA_EVIDENCE_DIR || path.resolve(root, "..", "evidence", "supplier-report");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(path.join(evidenceDirectory, "luna-01-proveedores-fixture.xlsx"), archive);

console.log(JSON.stringify({
  ok: true,
  sourceRows: sourceRows.length,
  groups: rows.length,
  suppliers: totals.suppliers,
  legacySplitRepresentations: legacySupplierKeys.size,
  legacyInventoryStemsIncludingAnnulled: legacyInventoryStems,
  activeInventoryStems: rows.reduce((sum, item) => sum + Number(item.exportedStems || 0), 0),
  annulledInventoryExcluded: true,
  sourceUnchanged: before === after,
  workbookEntries: archiveFiles.size,
  fixture: path.join(evidenceDirectory, "luna-01-proveedores-fixture.xlsx")
}, null, 2));
