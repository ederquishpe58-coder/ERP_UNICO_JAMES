import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
globalThis.BlessERP = {};

const appState = {
  db: {
    session: { activeUser: { name: "Validador operativo" } }
  }
};

globalThis.BlessERP.state = {
  state: appState,
  saveDb() {}
};

const scripts = [
  "scripts/core/utils.js",
  "scripts/modules/comercial/comercial-data.js",
  "scripts/modules/comercial/comercial-utils.js",
  "scripts/modules/comercial/comercial-workflow.js",
  "scripts/modules/comercial/order-box-builder.js",
  "scripts/modules/comercial/comercial-state.js",
  "scripts/modules/operaciones/operaciones-data.js",
  "scripts/modules/operaciones/operaciones-utils.js",
  "scripts/modules/operaciones/operaciones-state.js",
  "scripts/modules/operaciones/ramos-report-xlsx.js",
  "scripts/modules/operaciones/recepcion-flor.js",
  "scripts/modules/operaciones/disponibilidad-service-demo.js",
  "scripts/modules/comercial/order-fulfillment-demo.js",
  "scripts/modules/comercial/pedido-demand-view.js",
  "scripts/modules/comercial/disponibilidad-comercial.js",
  "scripts/modules/comercial/pedido-maestro-workspace.js",
  "scripts/modules/operaciones/despacho-service-demo.js"
];

scripts.forEach(file => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInThisContext(source, { filename: file });
});

appState.db.commercial = BlessERP.comercialData.createCommercialStore();
appState.db.operations = BlessERP.operacionesData.createOperationsStore();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fulfillment = BlessERP.comercialOrderFulfillment;
const operationsState = BlessERP.operacionesState;
const commercialState = BlessERP.comercialState;

function operationsStore() {
  return operationsState.getStore(appState);
}

function availability(variety, length) {
  return fulfillment
    .getAvailabilityRows(appState)
    .find(row => row.variety === variety && Number(row.length) === Number(length) && Number(row.stemsPerBunch) === 25);
}

function addInventoryBunch(seed) {
  const item = {
    inventoryId: seed.inventoryId || `INV-${seed.code}`,
    labelCode: seed.code,
    sourceLabelId: `LBL-${seed.code}`,
    sourceScannerEventId: `SCN-${seed.code}`,
    sourceType: "ESCANEO_ETIQUETA",
    date: "2026-07-12",
    admittedAt: "2026-07-12 08:00",
    variety: seed.variety,
    length: seed.length,
    stemsPerBunch: seed.stemsPerBunch || 25,
    bunches: 1,
    stems: seed.stemsPerBunch || 25,
    warehouse: "CUARTO FRIO 1",
    supplier: "FINCA PRUEBA CAJAS",
    block: "TEST-BOX",
    category: "EXPORTACION",
    state: "DISPONIBLE",
    observation: "Ramo demo exclusivo de validacion del modelo de cajas."
  };
  operationsStore().roseInventory.push(item);
  return item;
}

function addWarehouseOrder(id, number, lines, referenceOrder) {
  const order = BlessERP.comercialData.createOrder({
    id,
    number,
    issuedAt: "2026-07-12",
    flightDate: "2026-07-13",
    customerId: referenceOrder.customerId,
    brandId: referenceOrder.brandId,
    destination: referenceOrder.destination,
    destinationCountry: referenceOrder.destinationCountry,
    agencyId: referenceOrder.agencyId,
    status: "LISTO_BODEGA",
    warehouseStatus: "LIBERADO_BODEGA",
    fulfillmentStatus: "LIBERADO_BODEGA",
    lines
  });
  commercialState.getStore(appState).orders.push(order);
  return order;
}

// 1. Recepcion multivariedad con proveedor/bloque identificable.
let store = operationsStore();
store.masterData.suppliers.push({
  id: "PRO-VALIDACION",
  code: "PROVAL",
  name: "FINCA VALIDACION",
  assignedBlock: "VAL-01",
  active: true,
  observation: "Proveedor exclusivo de la prueba integral."
});
store.ui.receptionDraft = BlessERP.operacionesData.createReceptionDraft({
  date: "2026-07-11",
  supplier: "FINCA VALIDACION",
  block: "VAL-01",
  receptionist: "Andrea P.",
  responsible: "Andrea P.",
  items: []
});
store.ui.receptionItemDraft = BlessERP.operacionesData.createReceptionItemDraft({
  variety: "EXPLORER",
  stemType: "LARGO",
  meshCount: 3,
  stemsPerMesh: 25,
  extraStems: 5
});
const explorerReceptionItem = operationsState.addOrUpdateReceptionItem(appState);
assert(explorerReceptionItem?.totalStems === 80, "No se calculo el primer item de recepcion.");
store = operationsStore();
store.ui.receptionItemDraft = BlessERP.operacionesData.createReceptionItemDraft({
  variety: "MONDIAL",
  stemType: "LARGO",
  meshCount: 2,
  stemsPerMesh: 25,
  extraStems: 0
});
const mondialReceptionItem = operationsState.addOrUpdateReceptionItem(appState);
assert(mondialReceptionItem?.totalStems === 50, "No se calculo el segundo item de recepcion.");
const reception = operationsState.registerReception(appState);
assert(reception && reception.items.length === 2 && reception.totalDeclared === 130, "Recepcion multivariedad no registrada.");

// 2. Entrega FIFO a clasificacion y registro de nacional/rechazo.
store = operationsStore();
store.ui.classificationAssignmentDraft = BlessERP.operacionesData.createClassificationAssignmentDraft({
  block: "VAL-01",
  supplier: "FINCA VALIDACION",
  variety: "EXPLORER",
  classifier: "Rocio T.",
  meshCount: 2,
  extraStems: 0,
  observation: "Prueba integral de entrega."
});
const assignment = operationsState.registerClassifierAssignment(appState);
assert(assignment?.receptionId === reception.id && assignment.totalStems === 50, "Clasificacion no tomo la recepcion correcta.");
store = operationsStore();
store.ui.classificationResultDraft = BlessERP.operacionesData.createClassificationResultDraft({
  assignmentId: assignment.id,
  block: assignment.block,
  supplier: assignment.supplier,
  classifier: assignment.classifier,
  variety: assignment.variety,
  nationalStems: 5,
  observation: "Cinco tallos nacionales en prueba."
});
const classificationResult = operationsState.registerClassificationResult(appState);
assert(classificationResult?.nationalStems === 5 && classificationResult.exportableStems === 45, "Nacional/rechazo no actualizo la entrega.");
assert(operationsState.getReceptionQueue(appState).find(item => item.id === reception.id)?.classificationProgress.classifiedStems === 50, "Recepcion no refleja tallos enviados a clasificacion.");

// 2.1 Historial de recepcion: estados publicos, filtros y acumulados calculados.
const receptionModule = BlessERP.operacionesRecepcion;
assert(receptionModule.publicStatus({ totalStems: 100, classifiedStems: 0, pendingStems: 100 }) === "PENDIENTE", "Estado publico pendiente incorrecto.");
assert(receptionModule.publicStatus({ totalStems: 100, classifiedStems: 50, pendingStems: 50 }) === "PARCIAL", "Estado publico parcial incorrecto.");
assert(receptionModule.publicStatus({ totalStems: 100, classifiedStems: 100, pendingStems: 0 }) === "COMPLETA", "Estado publico completo incorrecto.");

const mondialHistory = receptionModule.filterReceptions(operationsState.getReceptionQueue(appState), {
  mode: "DIA",
  date: "2026-07-11",
  month: "2026-07",
  supplier: "FINCA VALIDACION",
  block: "VAL-01",
  variety: "MONDIAL",
  status: "PENDIENTE"
});
assert(mondialHistory.length === 1, "Filtro diario de recepcion no encontro la entrega esperada.");
assert(mondialHistory[0].classificationProgress.lines.length === 1 && mondialHistory[0].classificationProgress.lines[0].variety === "MONDIAL", "Filtro por variedad no proyecto solo la linea solicitada.");
assert(mondialHistory[0].classificationProgress.pendingStems === 50, "Filtro por variedad altero el saldo pendiente.");

const supplierAccumulated = receptionModule.aggregateBySupplier(mondialHistory);
assert(supplierAccumulated.length === 1 && supplierAccumulated[0].supplier === "FINCA VALIDACION" && supplierAccumulated[0].totalStems === 50, "Acumulado por proveedor no conserva origen y totales.");
const varietyAccumulated = receptionModule.aggregateByVariety(mondialHistory);
assert(varietyAccumulated.length === 1 && varietyAccumulated[0].variety === "MONDIAL" && varietyAccumulated[0].pendingStems === 50, "Acumulado por variedad no conserva el saldo.");

// 3. Etiqueta unica, pruebas de formato y primer ingreso al inventario.
store = operationsStore();
store.ui.labelDraft = BlessERP.operacionesData.createLabelDraft({
  date: "2026-07-11",
  supplier: "FINCA VALIDACION",
  block: "VAL-01",
  buncher: "Pedro M.",
  variety: "EXPLORER",
  length: 60,
  stemsPerBunch: 25,
  quantity: 1,
  labelType: "NORMAL"
});
const labelBatch = operationsState.generateLabelBatch(appState);
const generatedCode = labelBatch?.firstCode || "";
assert(/^\d{10}$/.test(generatedCode), "La etiqueta generada no tiene 10 digitos.");
assert(operationsStore().labelBatches.filter(item => item.code === generatedCode).length === 1, "El secuencial genero un codigo repetido.");
assert(!operationsStore().roseInventory.some(item => item.labelCode === generatedCode), "Imprimir etiqueta creo inventario antes del ingreso.");
assert(operationsState.scanBunchLabelIntoInventory(appState, "ABC").result === "FORMATO_INVALIDO", "No se rechazo codigo con formato invalido.");
assert(operationsState.scanBunchLabelIntoInventory(appState, "9999999999").result === "NO_ENCONTRADO", "No se rechazo etiqueta inexistente.");
const intake = operationsState.scanBunchLabelIntoInventory(appState, generatedCode, { responsible: "Andrea P." });
assert(intake.ok && intake.inventory?.state === "DISPONIBLE", "El primer ingreso no creo inventario disponible.");
assert(intake.entry?.classifier === "Rocio T.", "El ramo no conservo el clasificador relacionado.");
assert(operationsState.scanBunchLabelIntoInventory(appState, generatedCode).result === "DUPLICADO", "El segundo ingreso no fue rechazado como duplicado.");

// 3.1 Etiqueta mixta: lectura pendiente, composicion 1-3 proveedores y confirmacion exacta.
store = operationsStore();
store.ui.labelDraft = BlessERP.operacionesData.createLabelDraft({
  date: "2026-07-11",
  supplier: "FINCA CANGAHUA",
  block: "BQ-01",
  buncher: "Mateo G.",
  variety: "PLAYA BLANCA",
  length: 50,
  stemsPerBunch: 25,
  quantity: 1,
  labelType: "MIXTA"
});
const mixedLabelBatch = operationsState.generateLabelBatch(appState);
const mixedCode = mixedLabelBatch?.firstCode || "";
assert(mixedLabelBatch?.labels?.[0]?.supplier === "BLESS FL", "La etiqueta mixta no sustituyo el proveedor impreso por BLESS FL.");
const mixedPending = operationsState.scanBunchLabelIntoInventory(appState, mixedCode, { responsible: "Andrea P." });
assert(mixedPending.result === "PENDIENTE_COMPOSICION" && !operationsStore().roseInventory.some(item => item.labelCode === mixedCode), "La etiqueta mixta creo inventario antes de confirmar composicion.");
operationsState.updateMixedBunchCompositionLine(appState, 0, "block", "BQ-01");
operationsState.updateMixedBunchCompositionLine(appState, 0, "stems", 10);
operationsState.updateMixedBunchCompositionLine(appState, 1, "block", "BQ-02");
operationsState.updateMixedBunchCompositionLine(appState, 1, "stems", 10);
operationsState.updateMixedBunchCompositionLine(appState, 2, "block", "BLOQUE A");
operationsState.updateMixedBunchCompositionLine(appState, 2, "stems", 4);
assert(operationsState.confirmMixedBunchIntake(appState) === null, "Se confirmo una composicion mixta que no sumaba 25 tallos.");
operationsState.updateMixedBunchCompositionLine(appState, 2, "stems", 5);
const mixedIntake = operationsState.confirmMixedBunchIntake(appState);
assert(mixedIntake?.ok && mixedIntake.inventory?.composition?.length === 3, "La composicion mixta valida no creo un unico ramo.");
assert(mixedIntake.inventory.composition.reduce((sum, item) => sum + item.stems, 0) === 25, "El ramo mixto no conservo sus 25 tallos.");
assert(operationsState.scanBunchLabelIntoInventory(appState, mixedCode).result === "DUPLICADO", "La etiqueta mixta confirmada pudo volver a ingresarse.");

// 3.2 Reporte XLSX: un ramo fisico por fila y aporte mixto separado por bloque.
const reportApi = BlessERP.operacionesRamosReportXlsx;
const bunchReport = reportApi.getReportData(appState, { from: "2026-07-01", to: "2026-07-31" });
const normalReportRow = bunchReport.records.find(item => item.code === generatedCode);
const mixedReportRows = bunchReport.records.filter(item => item.code === mixedCode);
assert(normalReportRow?.type === "NORMAL" && normalReportRow.printedSupplier === "FINCA VALIDACION", "El reporte no conecto el ramo normal con su proveedor real.");
assert(mixedReportRows.length === 1 && mixedReportRows[0].printedSupplier === "BLESS FL", "El reporte duplico el bonche mixto o perdio su proveedor impreso.");
assert(bunchReport.byBlock.get("BQ-01")?.some(item => item.code === mixedCode && item.contributedStems === 10), "El bloque BQ-01 no recibio sus 10 tallos mixtos.");
assert(bunchReport.byBlock.get("BQ-02")?.some(item => item.code === mixedCode && item.contributedStems === 10), "El bloque BQ-02 no recibio sus 10 tallos mixtos.");
assert(bunchReport.byBlock.get("BLOQUE A")?.some(item => item.code === mixedCode && item.contributedStems === 5), "El bloque A no recibio sus 5 tallos mixtos.");
const reportSheets = reportApi.buildSheets(bunchReport);
assert(reportSheets[0]?.name === "Ramos escaneados" && reportSheets[1]?.name === "Resumen proveedores", "El orden base de hojas XLSX es incorrecto.");
assert(reportSheets.some(item => item.name === "BQ-01") && reportSheets.some(item => item.name === "BLOQUE A"), "No se generaron hojas dinamicas por bloque.");
const workbookArchive = reportApi.buildWorkbookArchive(reportSheets, bunchReport);
assert(workbookArchive[0] === 80 && workbookArchive[1] === 75 && workbookArchive.length > 5000, "El XLSX no genero un paquete ZIP OpenXML valido.");
const junePeriod = reportApi.reportPeriod("2026-06-01", "2026-06-30");
assert(junePeriod.period === "PERIODO 2026" && junePeriod.range === "FECHA DEL 1 DE JUNIO AL 30 DE JUNIO 2026", "El encabezado de periodo solicitado no coincide.");

// 4. Pedido Maestro en pantalla unica, precio manual y liberacion automatica a Bodega.
const orderToRelease = commercialState.findOrder(appState, "order-demo-0002");
Object.assign(orderToRelease, {
  status: "BORRADOR",
  destination: "REPUBLICA DOMINICANA",
  destinationCountry: "REPUBLICA DOMINICANA",
  daeNumber: "055-2026-40-00992586",
  daeDestination: "REPUBLICA DOMINICANA",
  daeExpirationDate: "2026-07-20",
  warehouseStatus: "NO_LIBERADO",
  fulfillmentStatus: "NO_LIBERADO"
});
assert(commercialState.setCurrentOrder(appState, orderToRelease.id), "No se pudo seleccionar el pedido de prueba.");
assert(commercialState.currentOrder(appState)?.id === orderToRelease.id, "Pedido Maestro no conservo el pedido seleccionado.");

const automaticCodes = [
  commercialState.newCustomer(appState).code,
  commercialState.newBrand(appState).code,
  commercialState.newAgency(appState).code,
  commercialState.newDestination(appState).code
];
assert(/^CLI-\d{3,}$/.test(automaticCodes[0]), "Cliente nuevo no recibio codigo automatico.");
assert(/^MAR-\d{3,}$/.test(automaticCodes[1]), "Marca nueva no recibio codigo automatico.");
assert(/^AG-\d{3,}$/.test(automaticCodes[2]), "Agencia nueva no recibio codigo automatico.");
assert(/^DEST-\d{3,}$/.test(automaticCodes[3]), "Destino nuevo no recibio codigo automatico.");

const multiRoomAgency = BlessERP.comercialData.createAgency({
  code: "AG-TEST",
  name: "AGENCIA PRUEBA",
  coldRoom: "CUARTO A",
  coldRooms: ["CUARTO A", "CUARTO B"]
});
assert(multiRoomAgency.coldRooms.length === 2 && multiRoomAgency.coldRoom === "CUARTO A", "Agencia no conserva varios cuartos frios.");

commercialState.updateOrderField(appState, "agencyId", "agency-pacific");
assert(orderToRelease.coldRoom === "QCELL", "Seleccionar agencia no sugirio su cuarto frio principal.");
commercialState.updateOrderField(appState, "coldRoom", "CUARTO FRIO MANUAL");
assert(orderToRelease.coldRoom === "CUARTO FRIO MANUAL", "Pedido Maestro no permitio modificar el cuarto frio sugerido.");

commercialState.updateOrderField(appState, "awb", "04512345678");
assert(orderToRelease.awb === "045-12345678", "Guia madre no se normalizo a 3 + 8 digitos.");
assert(orderToRelease.airlineId === "air-latam", "Prefijo 045 no reconocio LATAM CARGO.");
commercialState.getAirlineCatalog(appState).push(BlessERP.comercialData.createAirline({
  id: "air-validation-999",
  code: "AIR-999",
  name: "AEROLINEA PARAMETRIZADA",
  awbPrefix: "999",
  status: "ACTIVA"
}));
assert(BlessERP.comercialUtils.findAirlineByAwb("999-00000001", appState)?.id === "air-validation-999", "Utilidad AWB no consulto el catalogo editable vigente.");
commercialState.updateOrderField(appState, "awb", "99912345678");
assert(orderToRelease.airlineId === "air-validation-999", "Guia madre no reconocio una aerolinea creada en el catalogo editable.");
commercialState.updateOrderField(appState, "awb", "99812345678");
assert(!orderToRelease.airlineId, "Prefijo AWB no parametrizado mantuvo una aerolinea incorrecta.");
commercialState.updateOrderField(appState, "awb", "04512345678");
const compactMasterHtml = BlessERP.comercialPedidoMasterWorkspace.render(orderToRelease, appState);
assert(compactMasterHtml.includes('class="master-order-compact"'), "Pedido Maestro no activo el layout compacto.");
assert(compactMasterHtml.indexOf("data-commercial-awb-input") < compactMasterHtml.indexOf("data-commercial-awb-airline"), "Guia madre no aparece antes de la linea aerea automatica.");
assert(compactMasterHtml.includes("LATAM CARGO · prefijo 045"), "Vista maestra no mostro la aerolinea reconocida por la guia madre.");
assert(compactMasterHtml.includes('data-commercial-range-field="firstBox"'), "La plantilla no permite definir la caja inicial.");
assert(compactMasterHtml.includes("CUALQUIER MEDIDA") && compactMasterHtml.includes("40 cm") && compactMasterHtml.includes("70 cm"), "Pedido Maestro no carga medidas parametrizadas y la opcion abierta.");

  const nextRangeBox = Math.max(...orderToRelease.lines.map(line => Number(line.boxNumber || 0))) + 1;
  commercialState.updateBoxRangeDraft(appState, "quantity", 3);
  commercialState.updateBoxRangeDraft(appState, "firstBox", nextRangeBox);
  commercialState.updateBoxRangeDraft(appState, "boxType", "QB");
  commercialState.updateBoxRangeDraft(appState, "variety", "EXPLORER");
  commercialState.updateBoxRangeDraft(appState, "length", 70);
  commercialState.updateBoxRangeDraft(appState, "bunches", 4);
  commercialState.updateBoxRangeDraft(appState, "stemsPerBunch", 25);
  commercialState.updateBoxRangeDraft(appState, "unitPrice", 0.25);
  commercialState.updateBoxRangeDraft(appState, "po", "RANGO-TEST");
  const generatedRange = commercialState.addBoxRange(appState);
  assert(generatedRange.ok, `No se pudo generar el rango de cajas: ${generatedRange.error || "-"}`);
  assert(generatedRange.boxNumbers.join(",") === [nextRangeBox, nextRangeBox + 1, nextRangeBox + 2].join(","), "El rango no genero cajas consecutivas.");
  assert(generatedRange.lines.every(line => line.boxType === "QB" && line.variety === "EXPLORER" && line.length === 70 && !line.anyLength && line.bunches === 4 && line.stemsPerBunch === 25 && line.unitPrice === 0.25), "Las cajas del rango no conservaron su plantilla comercial.");
  assert(new Set(generatedRange.lines.map(line => line.boxRangeId)).size === 1, "Las cajas generadas no comparten la referencia del rango.");
  commercialState.updateBoxRangeDraft(appState, "firstBox", generatedRange.firstBox);
  commercialState.updateBoxRangeDraft(appState, "quantity", 1);
  const duplicatedRange = commercialState.addBoxRange(appState);
  assert(!duplicatedRange.ok && duplicatedRange.error.includes(String(generatedRange.firstBox)), "La caja inicial permitio sobrescribir una caja existente.");
  const firstRangeLine = generatedRange.lines[0];
  commercialState.updateLineField(appState, firstRangeLine.id, "length", 60);
  const refreshedRangeLines = commercialState.currentOrder(appState).lines.filter(line => line.boxRangeId === generatedRange.rangeId);
  assert(refreshedRangeLines.find(line => line.id === firstRangeLine.id)?.length === 60, "No se pudo editar una caja individual del rango.");
  assert(refreshedRangeLines.filter(line => line.id !== firstRangeLine.id).every(line => line.length === 70), "Editar una caja modifico indebidamente las demas cajas del rango.");
  generatedRange.boxNumbers.forEach(boxNumber => {
    assert(commercialState.deleteBox(appState, boxNumber).ok, `No se pudo retirar la caja ${boxNumber} usada en la prueba de rango.`);
  });

  commercialState.setBoxBuilderMode(appState, "MIXTO_MANUAL");
  commercialState.updateBoxRangeDraft(appState, "quantity", 5);
  commercialState.addManualMixDraftItem(appState);
  commercialState.addManualMixDraftItem(appState);
  const manualDraft = commercialState.getBoxRangeDraft(appState);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[0].id, "variety", "MONDIAL");
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[0].id, "lengthSelection", 60);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[0].id, "bunches", 3);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[0].id, "unitPrice", 0.25);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[1].id, "variety", "FREEDOM");
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[1].id, "lengthSelection", 60);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[1].id, "bunches", 2);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[1].id, "unitPrice", 0.25);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[2].id, "variety", "CANDELY");
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[2].id, "lengthSelection", 60);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[2].id, "bunches", 4);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[2].id, "unitPrice", 0.25);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[3].id, "variety", "SHIMMER");
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[3].id, "lengthSelection", 60);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[3].id, "bunches", 1);
  commercialState.updateManualMixDraftItem(appState, manualDraft.manualItems[3].id, "unitPrice", 0.25);
  const manualMix = commercialState.addBoxRange(appState);
  assert(manualMix.ok && manualMix.boxNumbers.length === 5 && manualMix.lines.length === 20, "El mixto manual no repitio los cuatro items en las cinco cajas.");
  assert(manualMix.lines.every(line => line.boxBuildMode === "MIXTO_MANUAL"), "Las lineas del mixto manual perdieron su modo de construccion.");
  const manualMixFirstBox = manualMix.lines.filter(line => line.boxNumber === manualMix.firstBox);
  const manualMixPerBoxUsd = manualMixFirstBox.reduce((sum, line) => sum + line.bunches * line.stemsPerBunch * line.unitPrice, 0);
  assert(manualMixFirstBox.reduce((sum, line) => sum + line.bunches, 0) === 10, "La plantilla mixta no conserva 10 ramos por caja.");
  assert(manualMixFirstBox.reduce((sum, line) => sum + line.bunches * line.stemsPerBunch, 0) === 250, "La plantilla mixta no conserva 250 tallos por caja.");
  assert(manualMixPerBoxUsd === 62.5 && manualMix.lines.reduce((sum, line) => sum + line.bunches * line.stemsPerBunch * line.unitPrice, 0) === 312.5, "Los totales de la plantilla mixta 5 QB son incorrectos.");
  manualMix.boxNumbers.forEach(boxNumber => assert(commercialState.deleteBox(appState, boxNumber).ok, `No se pudo retirar la caja mixta manual ${boxNumber}.`));

  commercialState.setBoxBuilderMode(appState, "MIXTO_ABIERTO");
  commercialState.updateBoxRangeDraft(appState, "quantity", 2);
  commercialState.updateBoxRangeDraft(appState, "length", 70);
  commercialState.updateBoxRangeDraft(appState, "bunches", 6);
  commercialState.updateBoxRangeDraft(appState, "stemsPerBunch", 25);
  commercialState.updateBoxRangeDraft(appState, "unitPrice", 0.24);
  commercialState.updateBoxRangeDraft(appState, "excludedVarieties", "PLAYA BLANCA, MONDIAL");
  const openMix = commercialState.addBoxRange(appState);
  assert(openMix.ok && openMix.lines.length === 2, "El mixto abierto no genero una linea operativa por caja.");
  assert(openMix.lines.every(line => line.boxBuildMode === "MIXTO_ABIERTO" && line.anyLength && line.mixedAnyLength && line.variety === "MIXTO ABIERTO" && line.mixedExcludedVarieties.includes("PLAYA BLANCA")), "El mixto abierto no conservo la medida libre o sus exclusiones.");
  openMix.boxNumbers.forEach(boxNumber => assert(commercialState.deleteBox(appState, boxNumber).ok, `No se pudo retirar la caja mixta abierta ${boxNumber}.`));
  commercialState.setBoxBuilderMode(appState, "RANGO_IGUAL");

  const originalLineCount = orderToRelease.lines.length;
const extraItem = commercialState.addItemToBox(appState, orderToRelease.lines[0].boxNumber);
assert(extraItem.ok && extraItem.line.unitPrice === 0, "Agregar item no dejo el precio manual pendiente.");
commercialState.deleteLine(appState, extraItem.line.id);
assert(orderToRelease.lines.length === originalLineCount, "No se pudo retirar el item borrador agregado.");
const duplicatedBox = commercialState.duplicateBox(appState, orderToRelease.lines[0].boxNumber);
assert(duplicatedBox.ok, "No se pudo duplicar una caja en el Pedido Maestro.");
assert(commercialState.deleteBox(appState, duplicatedBox.boxNumber).ok, "No se pudo eliminar la caja duplicada sin lecturas.");

const firstPrice = orderToRelease.lines[0].unitPrice;
orderToRelease.lines[0].unitPrice = 0;
const blockedByPrice = commercialState.markReadyWarehouse(appState);
assert(
  !blockedByPrice.ok && (blockedByPrice.validation?.errors || []).some(error => error.toLowerCase().includes("precio")),
  `El pedido sin precio manual no fue bloqueado: ${JSON.stringify(blockedByPrice)}`
);
assert(orderToRelease.status === "BORRADOR" && orderToRelease.warehouseStatus === "NO_LIBERADO", "La validacion fallida cambio el estado del pedido.");
orderToRelease.lines[0].unitPrice = firstPrice;

const released = commercialState.markReadyWarehouse(appState);
assert(released.ok, `Pedido Maestro no se valido y envio a Bodega: ${released.error || released.validation?.errors?.join(" | ") || "-"}`);
assert(orderToRelease.status === "LISTO_BODEGA", "El envio no sincronizo el estado comercial LISTO_BODEGA.");
assert(fulfillment.getWarehouseOrders(appState).some(item => item.order.id === orderToRelease.id), "Pedido liberado no aparece en Bodega.");

const masterWorkspace = BlessERP.comercialPedidoMasterWorkspace.render(orderToRelease, appState);
assert(masterWorkspace.includes("Cliente, marca y logistica"), "Pedido Maestro no muestra su captura comercial/logistica.");
assert(masterWorkspace.includes("ORDEN DEL CLIENTE"), "Pedido Maestro no muestra cajas y variedades.");
assert(masterWorkspace.includes("COBERTURA OPERATIVA"), "Pedido Maestro no muestra cobertura contra inventario.");
  assert(masterWorkspace.includes(orderToRelease.number), "Pedido Maestro no conserva el numero del pedido activo.");
  assert(masterWorkspace.includes("Precio/tallo"), "Pedido Maestro no muestra el precio manual por tallo.");
  assert(masterWorkspace.includes("Crear cajas"), "Pedido Maestro no muestra el acceso visible al constructor de cajas.");
  assert(masterWorkspace.includes("Rango igual") && masterWorkspace.includes("Mixto manual") && masterWorkspace.includes("Mixto abierto"), "Pedido Maestro no muestra todos los modos de creacion de cajas.");
  assert(masterWorkspace.includes('data-commercial-range-field="quantity"'), "Pedido Maestro no expone la cantidad del rango.");

// 4.1 Revision controlada: cancelar restaura y una etiqueta impresa exige nueva revision.
orderToRelease.documentActivity.ETIQUETAS = { printedAt: "2026-07-11T10:00:00.000Z", revision: 1 };
const notesBeforeCancel = orderToRelease.notes;
assert(commercialState.startOrderRevision(appState, "Prueba de cancelacion").ok, "No se pudo abrir revision controlada.");
commercialState.updateOrderField(appState, "notes", "Cambio que debe cancelarse");
assert(commercialState.cancelOrderRevision(appState).ok, "No se pudo cancelar la revision.");
assert(orderToRelease.notes === notesBeforeCancel, "Cancelar revision no restauro el pedido.");

assert(commercialState.startOrderRevision(appState, "Actualizar guia enviada por cliente").ok, "No se pudo abrir segunda revision.");
commercialState.updateOrderField(appState, "awb", "04512345679");
const submittedRevision = commercialState.submitOrderRevision(appState);
assert(submittedRevision.ok, `No se pudo enviar revision a Bodega: ${submittedRevision.error || "-"}`);
assert(orderToRelease.labelReprintRequired && orderToRelease.labelRevision === 2, "La revision no invalido la etiqueta impresa anterior.");
assert(orderToRelease.changeNotifications[0]?.status === "NUEVA", "Bodega no recibio notificacion de la revision.");

  const initialWarehouseOrders = fulfillment.getWarehouseOrders(appState);
  assert(initialWarehouseOrders.some(item => item.order.id === "order-demo-0001"), "Falta pedido principal en Bodega.");
  assert(initialWarehouseOrders.some(item => item.order.id === "order-demo-0005"), "Falta segundo pedido de validacion.");
  assert(initialWarehouseOrders.some(item => item.order.id === "order-demo-0006" && item.warehouseStatus === "COMPLETO_BODEGA"), "Falta pedido en historial.");
  commercialState.findOrder(appState, "order-demo-0005").daeExpirationDate = "2099-12-31";

  // 5. El ramo de la cadena completa entra a una caja y actualiza todos los modulos.
const explorerBefore = availability("EXPLORER", 60);
const mismatch = fulfillment.scanBunchForOrder(appState, "order-demo-0005", 1, "0000000201");
assert(!mismatch.ok && mismatch.result === "NO_COINCIDE", "Un ramo incompatible no fue rechazado.");
const firstScan = fulfillment.scanBunchForOrder(appState, "order-demo-0005", 1, generatedCode);
assert(firstScan.ok, "El ramo generado desde Recepcion no entro a la caja.");
const firstInventory = operationsStore().roseInventory.find(item => item.labelCode === generatedCode);
assert(firstInventory?.state === "ASIGNADO_CAJA", "Inventario no cambio a ASIGNADO_CAJA.");
assert(firstInventory?.assignedOrderId === "order-demo-0005" && Number(firstInventory?.assignedBoxNumber) === 1, "Inventario no guardo pedido/caja.");
const afterFirst = fulfillment.getOrderFulfillment(appState, "order-demo-0005");
assert(afterFirst.scannedBunches === 1 && afterFirst.boxes[0].pending === 2, "Detalle del pedido no actualizo el ramo leido.");
assert(afterFirst.warehouseStatus === "EN_ARMADO", "Estado del pedido no cambio a EN_ARMADO.");
const explorerAfter = availability("EXPLORER", 60);
assert(explorerAfter.physicalBunches === explorerBefore.physicalBunches - 1, "Disponibilidad fisica no desconto el ramo asignado.");
assert(explorerAfter.demandPendingBunches === explorerBefore.demandPendingBunches - 1, "Demanda pendiente no desconto el ramo colocado.");
assert(explorerAfter.projectedBunches === explorerBefore.projectedBunches, "Saldo proyectado cambio incorrectamente durante el armado.");
const assignmentEvent = operationsStore().scannerEvents.find(item => item.code === generatedCode && item.result === "ASIGNADO_CAJA");
assert(assignmentEvent?.pedido_id === "order-demo-0005", "No se registro evento de asignacion del ramo.");
const duplicate = fulfillment.scanBunchForOrder(appState, "order-demo-0001", 1, generatedCode);
assert(!duplicate.ok && duplicate.result === "DUPLICADO", "El codigo usado en otra caja no fue rechazado.");

// 6. Completar cajas, sincronizar despacho y simular un segundo pedido.
["0000000101", "0000000102"].forEach(code => {
  assert(fulfillment.scanBunchForOrder(appState, "order-demo-0005", 1, code).ok, `Fallo ${code} en caja 1.`);
});
["0000000201", "0000000202"].forEach(code => {
  assert(fulfillment.scanBunchForOrder(appState, "order-demo-0005", 2, code).ok, `Fallo ${code} en caja 2.`);
});
const completed = fulfillment.getOrderFulfillment(appState, "order-demo-0005");
assert(completed.allBoxesComplete && completed.completeBoxes === 2, "Las cajas no se completaron automaticamente.");
assert(completed.warehouseStatus === "COMPLETO_BODEGA", "El pedido no paso a COMPLETO_BODEGA.");
let dispatch = BlessERP.operacionesDispatchDemo.getDispatchByOrderDemo(appState, "order-demo-0005");
assert(dispatch.estado_bodega === "COMPLETO_BODEGA", "Despacho no refleja el estado de Bodega.");
assert(dispatch.cajas.every(box => box.estado_caja === "LISTA" && box.ramos_pendientes === 0), "Despacho no refleja cajas completas.");
assert(fulfillment.scanBunchForOrder(appState, "order-demo-0001", 1, "0000000103").ok, "No se pudo simular el segundo pedido.");
const secondOrder = fulfillment.getOrderFulfillment(appState, "order-demo-0001");
assert(secondOrder.scannedBunches === 1 && secondOrder.boxes[0].scanned === 1, "Segundo pedido no actualizo su caja.");

  // 7. Acciones que reciben los valores de los prompts de despacho.
  assert(BlessERP.operacionesDispatchDemo.prepareDispatchFromOrderDemo(appState, "order-demo-0005").ok, "Prompt preparar despacho no llego al servicio.");
  const readyDispatchResult = BlessERP.operacionesDispatchDemo.markDispatchReadyDemo(appState, "order-demo-0005");
  assert(readyDispatchResult.ok, `No se pudo marcar listo el despacho: ${readyDispatchResult.error || JSON.stringify(readyDispatchResult)}`);
const confirmPrompt = BlessERP.operacionesDispatchDemo.confirmDispatchDemo(appState, "order-demo-0005", {
  responsable_demo: "Responsable prompt",
  observacion: "Confirmacion ingresada por prompt."
});
assert(confirmPrompt.ok, `Confirmacion del prompt no actualizo el despacho: ${confirmPrompt.error || JSON.stringify(confirmPrompt)}`);
dispatch = BlessERP.operacionesDispatchDemo.getDispatchByOrderDemo(appState, "order-demo-0005");
assert(dispatch.estado_despacho === "DESPACHADO_DEMO" && dispatch.responsable_demo === "Responsable prompt", "Datos del prompt de confirmacion no se conservaron.");
assert(BlessERP.operacionesDispatchDemo.observeDispatchDemo(appState, "order-demo-0005", "Observacion prompt").ok, "Prompt observar no funciono.");
assert(BlessERP.operacionesDispatchDemo.reopenDispatchDemo(appState, "order-demo-0005", "Reapertura prompt").ok, "Prompt reabrir no funciono.");
assert(BlessERP.operacionesDispatchDemo.cancelDispatchDemo(appState, "order-demo-0005", "Anulacion prompt").ok, "Prompt anular no funciono.");
assert(BlessERP.operacionesDispatchDemo.reopenDispatchDemo(appState, "order-demo-0005", "Reapertura final prompt").ok, "Reapertura posterior a anulacion no funciono.");

const manualReleaseBlocked = operationsState.updateInventoryState(appState, firstInventory.inventoryId, "DISPONIBLE");
assert(manualReleaseBlocked === false && firstInventory.state === "ASIGNADO_CAJA", "Se permitio liberar manualmente un ramo asignado.");

const openMixCandidates = operationsStore().roseInventory.filter(item => item.state === "DISPONIBLE" && !["MONDIAL", "PLAYA BLANCA"].includes(item.variety));
const openMixInventory = openMixCandidates.find(item => openMixCandidates.some(other => (
  other.labelCode !== item.labelCode
  && other.stemsPerBunch === item.stemsPerBunch
  && other.length !== item.length
)));
const openMixInventoryOtherLength = openMixCandidates.find(item => (
  item.labelCode !== openMixInventory?.labelCode
  && item.stemsPerBunch === openMixInventory?.stemsPerBunch
  && item.length !== openMixInventory?.length
));
assert(openMixInventory && openMixInventoryOtherLength, "No existen dos ramos disponibles de medidas distintas para validar el mixto abierto.");
const openMixScanBuild = BlessERP.comercialBoxBuilder.buildLines(
  BlessERP.comercialBoxBuilder.normalizeDraft({
    mode: "MIXTO_ABIERTO",
    firstBox: 1,
    quantity: 1,
    boxType: "QB",
    length: openMixInventory.length,
    anyLength: true,
    bunches: 2,
    stemsPerBunch: openMixInventory.stemsPerBunch,
    unitPrice: 0.25,
    excludedVarieties: "MONDIAL, PLAYA BLANCA"
  }),
  { firstBox: 1, revisionNumber: 1 }
);
assert(openMixScanBuild.ok, "El constructor no genero la caja mixta abierta para Bodega.");
const openMixScanOrder = BlessERP.comercialData.createOrder({
  id: "order-test-open-mix",
  number: "PED-TEST-MIXTO-ABIERTO",
  customerId: orderToRelease.customerId,
  brandId: orderToRelease.brandId,
  destination: orderToRelease.destination,
  destinationCountry: orderToRelease.destinationCountry,
  issuedAt: orderToRelease.issuedAt,
  flightDate: orderToRelease.flightDate,
  status: "LISTO_BODEGA",
  warehouseStatus: "LIBERADO_BODEGA",
  fulfillmentStatus: "LIBERADO_BODEGA",
  lines: openMixScanBuild.lines
});
commercialState.getStore(appState).orders.push(openMixScanOrder);
const openMixBeforeSales = BlessERP.comercialPedidoMasterWorkspace.render(openMixScanOrder, appState);
assert(openMixBeforeSales.includes("CUALQUIER MEDIDA"), "Ventas no muestra la medida libre del mixto abierto.");
const openMixAvailability = fulfillment.getAvailabilityRows(appState).find(item => item.openMixed && item.anyLength && item.stemsPerBunch === openMixInventory.stemsPerBunch);
assert(openMixAvailability?.physicalBunches >= 2, "La cobertura del mixto abierto no suma inventario compatible de distintas medidas.");
const openMixFirstScan = fulfillment.scanBunchForOrder(appState, openMixScanOrder.id, 1, openMixInventory.labelCode);
const openMixSecondScan = fulfillment.scanBunchForOrder(appState, openMixScanOrder.id, 1, openMixInventoryOtherLength.labelCode);
assert(openMixFirstScan.ok, `El mixto abierto rechazo la primera medida permitida: ${openMixFirstScan.error || "-"}`);
assert(openMixSecondScan.ok, `El mixto abierto rechazo una medida diferente: ${openMixSecondScan.error || "-"}`);
const openMixComposition = openMixScanOrder.lines[0].mixedActualComposition;
assert(new Set(openMixComposition.map(item => item.length)).size === 2, "El mixto abierto no separo la composicion real por medida.");
assert(openMixComposition.reduce((sum, item) => sum + item.bunches, 0) === 2, "El mixto abierto no conservo los dos ramos escaneados.");
assert(openMixInventory.state === "ASIGNADO_CAJA" && openMixInventoryOtherLength.state === "ASIGNADO_CAJA", "Los ramos mixtos no salieron de disponibilidad al asignarse a la caja.");
const openMixProgress = fulfillment.getOrderFulfillment(appState, openMixScanOrder.id);
assert(openMixProgress.allBoxesComplete && openMixProgress.scannedBunches === 2, "La caja mixta abierta no se completo con las medidas escaneadas.");
const openMixAfterSales = BlessERP.comercialPedidoMasterWorkspace.render(openMixScanOrder, appState);
assert(openMixAfterSales.includes(`${openMixInventory.variety} ${openMixInventory.length} cm`) && openMixAfterSales.includes(`${openMixInventoryOtherLength.variety} ${openMixInventoryOtherLength.length} cm`), "Ventas no refleja la composicion real actualizada desde Bodega.");

// 8.1 Modelo unificado: caja individual exacta, rango libre y mixto manual en Bodega.
const exactBoxBuild = BlessERP.comercialBoxBuilder.buildLines(
  BlessERP.comercialBoxBuilder.normalizeDraft({
    mode: "RANGO_IGUAL",
    firstBox: 1,
    quantity: 1,
    boxType: "QB",
    variety: "NINA",
    length: 60,
    anyLength: false,
    bunches: 1,
    stemsPerBunch: 25,
    unitPrice: 0.25
  }),
  { firstBox: 1, revisionNumber: 1 }
);
assert(exactBoxBuild.ok && exactBoxBuild.lines.length === 1 && !exactBoxBuild.lines[0].anyLength, "La caja individual exacta no se genero correctamente.");
const exactBoxOrder = addWarehouseOrder("order-test-box-exact", "PED-TEST-CAJA-EXACTA", exactBoxBuild.lines, orderToRelease);
const exactWrongLength = addInventoryBunch({ code: "9100000001", variety: "NINA", length: 50 });
const exactRightLength = addInventoryBunch({ code: "9100000002", variety: "NINA", length: 60 });
const exactMismatch = fulfillment.scanBunchForOrder(appState, exactBoxOrder.id, 1, exactWrongLength.labelCode);
assert(!exactMismatch.ok && exactMismatch.result === "NO_COINCIDE", "Bodega acepto una medida distinta en una caja de medida exacta.");
assert(fulfillment.scanBunchForOrder(appState, exactBoxOrder.id, 1, exactRightLength.labelCode).ok, "Bodega rechazo la medida exacta de la caja individual.");
assert(fulfillment.getOrderFulfillment(appState, exactBoxOrder.id).allBoxesComplete, "La caja individual no se completo automaticamente.");

const anyRangeBuild = BlessERP.comercialBoxBuilder.buildLines(
  BlessERP.comercialBoxBuilder.normalizeDraft({
    mode: "RANGO_IGUAL",
    firstBox: 1,
    quantity: 2,
    boxType: "QB",
    variety: "NINA",
    length: 60,
    anyLength: true,
    bunches: 1,
    stemsPerBunch: 25,
    unitPrice: 0.25
  }),
  { firstBox: 1, revisionNumber: 1 }
);
assert(anyRangeBuild.ok && anyRangeBuild.lines.every(line => line.anyLength), "El rango no conservo CUALQUIER MEDIDA.");
const anyRangeOrder = addWarehouseOrder("order-test-range-any", "PED-TEST-RANGO-CUALQUIER-MEDIDA", anyRangeBuild.lines, orderToRelease);
const anyRangeWrongVariety = addInventoryBunch({ code: "9200000001", variety: "MONDIAL", length: 50 });
const anyRangeFirst = addInventoryBunch({ code: "9200000002", variety: "NINA", length: 40 });
const anyRangeSecond = addInventoryBunch({ code: "9200000003", variety: "NINA", length: 70 });
assert(fulfillment.scanBunchForOrder(appState, anyRangeOrder.id, 1, anyRangeWrongVariety.labelCode).result === "NO_COINCIDE", "CUALQUIER MEDIDA acepto una variedad distinta.");
assert(fulfillment.scanBunchForOrder(appState, anyRangeOrder.id, 1, anyRangeFirst.labelCode).ok, "El rango libre rechazo NINA 40 cm.");
assert(fulfillment.scanBunchForOrder(appState, anyRangeOrder.id, 2, anyRangeSecond.labelCode).ok, "El rango libre rechazo NINA 70 cm.");
const anyRangeProgress = fulfillment.getOrderFulfillment(appState, anyRangeOrder.id);
assert(anyRangeProgress.allBoxesComplete && new Set(anyRangeProgress.boxes.flatMap(box => box.lines.flatMap(item => item.line.scannedBunches.map(scan => scan.length)))).size === 2, "El rango libre no completo cajas con sus medidas reales.");
const anyRangeSalesHtml = BlessERP.comercialPedidoMasterWorkspace.render(anyRangeOrder, appState);
assert(anyRangeSalesHtml.includes("40 cm: 1 ramo(s)") && anyRangeSalesHtml.includes("70 cm: 1 ramo(s)"), "Ventas no muestra las medidas reales leidas en el rango abierto.");

const manualWarehouseBuild = BlessERP.comercialBoxBuilder.buildLines(
  BlessERP.comercialBoxBuilder.normalizeDraft({
    mode: "MIXTO_MANUAL",
    firstBox: 1,
    quantity: 2,
    boxType: "QB",
    manualItems: [
      { variety: "MONDIAL", length: 60, anyLength: false, bunches: 1, stemsPerBunch: 25, unitPrice: 0.25 },
      { variety: "EXPLORER", length: 70, anyLength: true, bunches: 1, stemsPerBunch: 25, unitPrice: 0.25 }
    ]
  }),
  { firstBox: 1, revisionNumber: 1 }
);
assert(manualWarehouseBuild.ok && manualWarehouseBuild.lines.length === 4, "El mixto manual no replico sus dos items en dos cajas.");
const manualWarehouseOrder = addWarehouseOrder("order-test-manual-mix", "PED-TEST-MIXTO-MANUAL", manualWarehouseBuild.lines, orderToRelease);
const manualWrongExact = addInventoryBunch({ code: "9300000001", variety: "MONDIAL", length: 50 });
const manualBox1Exact = addInventoryBunch({ code: "9300000002", variety: "MONDIAL", length: 60 });
const manualBox1Any = addInventoryBunch({ code: "9300000003", variety: "EXPLORER", length: 40 });
const manualBox2Exact = addInventoryBunch({ code: "9300000004", variety: "MONDIAL", length: 60 });
const manualBox2Any = addInventoryBunch({ code: "9300000005", variety: "EXPLORER", length: 70 });
assert(fulfillment.scanBunchForOrder(appState, manualWarehouseOrder.id, 1, manualWrongExact.labelCode).result === "NO_COINCIDE", "El item exacto del mixto manual acepto una medida incorrecta.");
[
  [1, manualBox1Exact.labelCode],
  [1, manualBox1Any.labelCode],
  [2, manualBox2Exact.labelCode],
  [2, manualBox2Any.labelCode]
].forEach(([boxNumber, code]) => assert(fulfillment.scanBunchForOrder(appState, manualWarehouseOrder.id, boxNumber, code).ok, `Bodega rechazo ${code} del mixto manual.`));
const manualWarehouseProgress = fulfillment.getOrderFulfillment(appState, manualWarehouseOrder.id);
assert(manualWarehouseProgress.allBoxesComplete && manualWarehouseProgress.scannedBunches === 4, "Bodega no completo las dos cajas del mixto manual.");

// 9. Disponibilidad comercial: inventario menos demanda activa, sin doble descuento.
const salesAvailabilityInventory = operationsStore().roseInventory.find(item => item.state === "DISPONIBLE");
assert(salesAvailabilityInventory, "No existe inventario disponible para validar la disponibilidad comercial.");
const availabilityBeforeDraft = availability(salesAvailabilityInventory.variety, salesAvailabilityInventory.length);
const salesDemandOrder = BlessERP.comercialData.createOrder({
  id: "order-test-sales-availability",
  number: "PED-TEST-DISPONIBILIDAD",
  status: "BORRADOR",
  warehouseStatus: "NO_LIBERADO",
  lines: [BlessERP.comercialData.createLine({
    boxNumber: 1,
    boxType: "QB",
    variety: salesAvailabilityInventory.variety,
    length: salesAvailabilityInventory.length,
    bunches: 2,
    stemsPerBunch: salesAvailabilityInventory.stemsPerBunch,
    unitPrice: 0.25
  })]
});
commercialState.getStore(appState).orders.push(salesDemandOrder);
const availabilityWithDraft = availability(salesAvailabilityInventory.variety, salesAvailabilityInventory.length);
assert(availabilityWithDraft.demandPendingBunches === availabilityBeforeDraft.demandPendingBunches, "Un pedido BORRADOR desconto disponibilidad comercial.");
salesDemandOrder.status = "VALIDADO_COMERCIAL";
const availabilityWithValidatedOrder = availability(salesAvailabilityInventory.variety, salesAvailabilityInventory.length);
assert(availabilityWithValidatedOrder.demandPendingBunches === availabilityBeforeDraft.demandPendingBunches + 2, "El pedido VALIDADO_COMERCIAL no desconto su demanda pendiente.");
assert(availabilityWithValidatedOrder.availableForSaleBunches === Math.max(availabilityWithValidatedOrder.physicalBunches - availabilityWithValidatedOrder.demandPendingBunches, 0), "La disponibilidad para venta no respeta inventario menos pedidos activos.");
const availabilityPage = BlessERP.comercialAvailability.render(appState);
assert(availabilityPage.includes("Disponibilidad para venta") && availabilityPage.includes("Ramos en pedidos"), "La pantalla comercial no muestra la consulta simplificada de disponibilidad.");
assert(!availabilityPage.includes("PEDIDO ACTUAL"), "La pantalla independiente de disponibilidad conserva detalle del pedido actual.");
salesDemandOrder.warehouseStatus = "LIBERADO_BODEGA";
const projectedBeforeScan = availabilityWithValidatedOrder.projectedBunches;
const availabilityScan = fulfillment.scanBunchForOrder(appState, salesDemandOrder.id, 1, salesAvailabilityInventory.labelCode);
assert(availabilityScan.ok, `No se pudo asignar el ramo para validar el doble descuento: ${availabilityScan.error || "-"}`);
const availabilityAfterScan = availability(salesAvailabilityInventory.variety, salesAvailabilityInventory.length);
assert(availabilityAfterScan.physicalBunches === availabilityWithValidatedOrder.physicalBunches - 1, "El escaneo no redujo el inventario disponible.");
assert(availabilityAfterScan.demandPendingBunches === availabilityWithValidatedOrder.demandPendingBunches - 1, "El escaneo no redujo la demanda pendiente del pedido.");
assert(availabilityAfterScan.projectedBunches === projectedBeforeScan, "El escaneo desconto dos veces la disponibilidad para venta.");

console.log("Validacion operativa integral: OK");
console.log(`Recepcion: ${reception.id} / ${reception.items.length} variedades / ${reception.totalDeclared} tallos`);
console.log(`Clasificacion: ${assignment.totalStems} tallos / nacional ${classificationResult.nationalStems}`);
console.log("Historial recepcion: estados / filtros / acumulados OK");
console.log(`Etiqueta e ingreso: ${generatedCode} / ${intake.result}`);
console.log(`Etiqueta mixta: ${mixedCode} / 10 + 10 + 5 tallos / ${mixedIntake.result}`);
console.log(`Reporte XLSX: ${bunchReport.records.length} ramos / ${reportSheets.length} hojas / mixto distribuido 10 + 10 + 5`);
console.log(`Pedidos en Bodega: ${fulfillment.getWarehouseOrders(appState).length}`);
console.log(`Pedido ${completed.order.number}: ${completed.completeBoxes}/${completed.totalBoxes} cajas completas`);
console.log(`Pedido ${secondOrder.order.number}: ${secondOrder.scannedBunches}/${secondOrder.requiredBunches} ramos validados`);
console.log(`Inventario ${firstInventory.labelCode}: ${firstInventory.state} / caja ${firstInventory.assignedBoxNumber}`);
console.log(`Disponibilidad EXPLORER 60: fisico ${availability("EXPLORER", 60).physicalBunches}, demanda ${availability("EXPLORER", 60).demandPendingBunches}, proyectado ${availability("EXPLORER", 60).projectedBunches}`);
console.log(`Prompts despacho: preparar/listo/confirmar/observar/anular/reabrir OK`);
console.log(`Constructores de cajas: individual / rango igual / mixto manual 5x4 / mixto abierto OK`);
console.log(`Mixto abierto libre: ${openMixInventory.length} cm + ${openMixInventoryOtherLength.length} cm / sincronizado con Ventas`);
console.log(`Bodega cajas: exacta rechaza 50 y acepta 60 / rango libre acepta 40 + 70 / mixto manual 4 de 4 ramos`);
console.log(`Disponibilidad comercial: borrador ignorado / validado descontado / escaneo sin doble descuento`);
