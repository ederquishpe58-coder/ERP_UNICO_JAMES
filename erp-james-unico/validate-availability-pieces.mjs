import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./scripts/modules/operaciones/availability-pieces.js", import.meta.url), "utf8");
const viewSource = await readFile(new URL("./scripts/modules/comercial/pedido-demand-view.js", import.meta.url), "utf8");
const operationsDataSource = await readFile(new URL("./scripts/modules/operaciones/operaciones-data.js", import.meta.url), "utf8");
const sandbox = {
  window: { BlessERP: {} },
  navigator: {},
  document: {}
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "availability-pieces.js" });

const service = sandbox.window.BlessERP.operacionesAvailabilityPieces;
const errors = [];
const assert = (condition, message) => {
  if (!condition) errors.push(message);
};

assert(service?.BUNCHES_PER_PIECE === 12, "Cada pieza debe contener 12 bonches.");
assert(JSON.stringify(service?.PIECE_SIZE_OPTIONS) === JSON.stringify([4, 12, 14]), "Las opciones permitidas deben ser 4, 12 y 14 bonches.");

const example = service.buildRows([{
  variety: "EXPLORER",
  length: 60,
  stemsPerBunch: 25,
  spotAvailableBunches: 65
}]);
assert(example.length === 1, "El ejemplo de 65 bonches debe generar una fila.");
assert(example[0]?.pieces === 6, "65 bonches deben mostrarse como 6 piezas estimadas.");
assert(example[0]?.status === "PIEZA INCOMPLETA", "La sexta pieza de 65 bonches debe quedar incompleta.");
assert(example[0]?.missingBunches === 7, "A la sexta pieza de 65 bonches deben faltarle 7 bonches.");

const complete = service.buildRows([{
  variety: "MONDIAL",
  length: 60,
  stemsPerBunch: 25,
  spotAvailableBunches: 60
}]);
assert(complete[0]?.pieces === 5, "60 bonches deben mostrarse como 5 piezas.");
assert(complete[0]?.status === "PIEZA COMPLETA", "60 bonches deben formar piezas completas.");
assert(complete[0]?.missingBunches === 0, "Una pieza completa no debe mostrar faltantes.");

const afterFlexibleOrder = service.buildRows([
  { variety: "EXPLORER", length: 60, stemsPerBunch: 25, spotAvailableBunches: 65, oldestAdmission: "2026-07-20" },
  { variety: "EXPLORER", length: 70, stemsPerBunch: 25, spotAvailableBunches: 24, oldestAdmission: "2026-07-21" },
  { variety: "EXPLORER", anyLength: true, stemsPerBunch: 25, demandPendingBunches: 12 }
]);
assert(afterFlexibleOrder.find(row => row.length === 60)?.availableBunches === 53, "La demanda de medida abierta debe descontarse una sola vez del inventario exacto.");
assert(afterFlexibleOrder.find(row => row.length === 70)?.availableBunches === 24, "La asignación estimada de demanda abierta debe respetar FIFO.");

const beforeMixedScan = service.buildRows([
  { variety: "EXPLORER", length: 60, stemsPerBunch: 25, spotAvailableBunches: 65, oldestAdmission: "2026-07-20" },
  { variety: "MONDIAL", length: 50, stemsPerBunch: 25, spotAvailableBunches: 24, oldestAdmission: "2026-07-21" },
  {
    variety: "MIXTO PENDIENTE",
    openMixed: true,
    anyLength: true,
    pendingMixedPlaceholder: true,
    stemsPerBunch: 25,
    demandPendingBunches: 12
  }
]);
assert(beforeMixedScan.find(row => row.variety === "EXPLORER")?.availableBunches === 65, "Un mixto sin escanear no debe descontar piezas de Explorer.");
assert(beforeMixedScan.find(row => row.variety === "MONDIAL")?.availableBunches === 24, "Un mixto sin escanear no debe descontar piezas de Mondial.");

const afterOneMixedScan = service.buildRows([
  { variety: "EXPLORER", length: 60, stemsPerBunch: 25, spotAvailableBunches: 64, mixedScannedBunches: 1 },
  { variety: "MONDIAL", length: 50, stemsPerBunch: 25, spotAvailableBunches: 24 },
  {
    variety: "MIXTO PENDIENTE",
    openMixed: true,
    anyLength: true,
    pendingMixedPlaceholder: true,
    stemsPerBunch: 25,
    demandPendingBunches: 11
  }
]);
assert(afterOneMixedScan.find(row => row.variety === "EXPLORER")?.availableBunches === 64, "Al escanear Explorer, solamente Explorer debe bajar en piezas.");
assert(afterOneMixedScan.find(row => row.variety === "MONDIAL")?.availableBunches === 24, "Escanear Explorer no debe modificar Mondial.");

const fourteenPerPiece = service.buildRows([{
  variety: "FREEDOM",
  length: 60,
  stemsPerBunch: 25,
  spotAvailableBunches: 28
}], { bunchesPerPiece: 14 });
assert(fourteenPerPiece[0]?.pieces === 2, "28 bonches deben formar 2 piezas cuando la configuración es 14.");
assert(fourteenPerPiece[0]?.missingBunches === 0, "Dos piezas de 14 deben quedar completas.");
assert(fourteenPerPiece[0]?.availableBunches === 28, "La fila debe conservar los ramos disponibles para visualización.");

const fourPerPiece = service.buildRows([{
  variety: "NINA",
  length: 50,
  stemsPerBunch: 25,
  spotAvailableBunches: 10
}], { bunchesPerPiece: 4 });
assert(fourPerPiece[0]?.pieces === 3, "10 bonches deben mostrarse como 3 piezas estimadas cuando la configuración es 4.");
assert(fourPerPiece[0]?.missingBunches === 2, "A la tercera pieza de 4 deben faltarle 2 bonches.");
assert(service.normalizeBunchesPerPiece(99) === 12, "Un tamaño no permitido debe regresar al valor seguro de 12.");

const copyText = service.buildCopyText(example);
assert(copyText.includes("NRO. PIEZA\tVARIEDAD\tMEDIDA"), "El texto copiable debe contener las tres columnas públicas.");
assert(!copyText.includes("ESTADO") && !copyText.includes("FALTANTES") && !copyText.includes("RAMOS DISPONIBLES"), "Estado, ramos disponibles y faltantes no deben copiarse.");
assert(/data-ops-ui-field="availabilityBunchesPerPiece"/.test(viewSource), "La ventana debe permitir seleccionar los bonches por pieza.");
assert(/RAMOS DISPONIBLES/.test(viewSource), "La tabla debe mostrar la columna Ramos disponibles.");
assert(/availabilityBunchesPerPiece:\s*12/.test(operationsDataSource), "La configuración debe persistir con 12 como valor predeterminado.");

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("VALIDACION_DISPONIBILIDAD_PIEZAS_OK");
