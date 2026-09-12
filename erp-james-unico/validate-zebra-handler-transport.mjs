import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const codecSource = fs.readFileSync("scripts/modules/operaciones/bunch-label-codec.js", "utf8");
const labelSource = fs.readFileSync("scripts/modules/operaciones/etiquetas-ramos.js", "utf8");
const destinationRepositorySource = fs.readFileSync("scripts/repositories/operaciones/local-destination-v2-repository.js", "utf8");
const zebraMigrationSource = fs.readFileSync("supabase/migrations/202608150005_zebra_intake_availability_v2.sql", "utf8");

const fakeDocument = new EventTarget();
fakeDocument.activeElement = null;
const container = new EventTarget();
container.dataset = {};
container.innerHTML = "";
container.querySelector = () => null;
container.querySelectorAll = () => [];

let createCalls = 0;
let reprintCalls = 0;
let sendCalls = 0;
let activeSends = 0;
let maxConcurrentSends = 0;
let failAtSend = 0;
let codeSequence = 100;
const creationOptions = [];
const sentZpl = [];
const toasts = [];

const store = {
  masterData: {
    suppliers: [{ code: "PRO001", name: "FINCA UNO", assignedBlock: "B1", active: true }],
    varieties: [{ name: "EXPLORER", active: true }, { name: "FREEDOM", active: true }, { name: "MONDIAL", active: true }],
    lengths: [{ name: "60", active: true }],
    bunchers: [{ code: "BUN-1", labelColor: "ROJO", active: true }]
  },
  catalogs: { blocks: ["B1"] },
  labelBatches: []
};

const appState = {
  db: {
    activeCompanyId: "company-a",
    commercial: {
      customerCatalog: [
        { id: "projection-local-a", record_id: "COM-CLI-LOCAL-A", companyId: "company-a", category: "LOCAL", legalName: "CLIENTE LOCAL A", status: "ACTIVO" },
        { id: "COM-CLI-MIXTO-A", companyId: "company-a", category: "MIXTO", legalName: "CLIENTE MIXTO A", status: "ACTIVO" },
        { id: "COM-CLI-INACTIVO", companyId: "company-a", category: "LOCAL", legalName: "CLIENTE INACTIVO", status: "INACTIVO" },
        { id: "COM-CLI-OTHER", companyId: "company-b", category: "LOCAL", legalName: "CLIENTE OTRA EMPRESA", status: "ACTIVO" }
      ],
      orders: [{ id: "ORDER-LOCAL-1", companyId: "company-a", customerId: "COM-CLI-LOCAL-A", saleType: "LOCAL", status: "CONFIRMADO" }]
    }
  }
};

const context = {
  TextEncoder,
  Uint8Array,
  fetch: async (url, options) => {
    if (!url.endsWith("write")) return { ok: true, text: async () => JSON.stringify({ uid: "fixture", name: "Fixture", deviceType: "printer", version: 5, connection: "usb" }) };
    sendCalls++; activeSends++; maxConcurrentSends = Math.max(maxConcurrentSends, activeSends);
    sentZpl.push(JSON.parse(options.body).data);
    await new Promise(resolve => setTimeout(resolve, 2)); activeSends--;
    return { ok: failAtSend !== sendCalls, status: 503, text: async () => "" };
  },
  AbortController,
  console,
  document: fakeDocument,
  Event,
  setTimeout,
  clearTimeout,
  window: {
    location: { protocol: "https:", origin: "https://bless-flower-jaeder-prod-indol.vercel.app" },
    navigator: { userAgent: "Chrome/140" },
    AbortController,
    confirm: () => true,
    document: fakeDocument,
    BlessERP: {},
    crypto: { getRandomValues(array) { array.fill(7); return array; } }
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("scripts/core/flower-quality.js", "utf8"), context);
vm.runInContext(codecSource, context);

const BlessERP = context.window.BlessERP;
BlessERP.operacionesUtils = { esc: value => String(value ?? ""), renderTabs: () => "" };
BlessERP.operacionesState = {
  getStore: () => store,
  async registerPrintedZebraLabels(_state, drafts, options) {
    createCalls += 1;
    creationOptions.push({ ...options });
    return {
      ok: true,
      labels: drafts.map(draft => ({
        ...draft,
        id: `label-${codeSequence}`,
        code: String(codeSequence++).padStart(10, "0")
      }))
    };
  },
  async updateLabelState(_state, id, status) {
    reprintCalls += 1;
    return { id, code: String(id).replace(/\D/g, "").padStart(10, "0"), state: status };
  }
};
BlessERP.comercialState = {
  getCustomerCatalog(state, companyId) {
    return state.db.commercial.customerCatalog.filter(item => String(item.companyId) === String(companyId));
  }
};
BlessERP.services = { companyContext: { activeCompanyId: () => "company-a" } };
BlessERP.state = { currentRoute: () => ({ id: "operations-labels", title: "Etiquetas Zebra" }) };
BlessERP.layout = { toast(message) { toasts.push(String(message)); } };
BlessERP.getZebraV2Repository = () => ({ remoteRequired: () => true, uuid: () => `op-${Math.random()}` });
vm.runInContext(fs.readFileSync("scripts/services/zebra-browser-print.js", "utf8"), context);
BlessERP.labelPdf = { downloadBunchLabels: () => true };

vm.runInContext(labelSource, context);
const labels = BlessERP.operacionesEtiquetas;

function validRow(variety, copies = 1) {
  return labels.createRow({
    color: "ROJO",
    variety,
    length: 60,
    target: 25,
    copies,
    components: [{ provider: "P001", block: "B1", stems: "25", stemsMode: "manual" }]
  });
}

labels.__testing.setRows([validRow("EXPLORER")]);
labels.mount(container, appState);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(sendCalls, 0, "Mount must not print");

labels.__testing.setDestination("EXPORT");
labels.__testing.setRows([validRow("EXPLORER", 2), validRow("FREEDOM"), validRow("MONDIAL")]);
const createBeforeDouble = createCalls;
const sendBeforeDouble = sendCalls;
const optionsBeforeDouble = creationOptions.length;
const firstDouble = labels.printAll();
const secondDouble = labels.printAll();
const doubleResult = await Promise.all([firstDouble, secondDouble]);
assert.equal(doubleResult.filter(Boolean).length, 1, "Doble clic debe admitir una sola intención de batch.");
assert.equal(createCalls - createBeforeDouble, 3, "Cada fila visual debe conservar su propio lote canónico.");
assert.equal(sendCalls - sendBeforeDouble, 3, "Cada fila debe producir un solo envío ZPL.");
assert.equal(maxConcurrentSends, 1, "La concurrencia física máxima debe ser uno.");
const doubleOptions = creationOptions.slice(optionsBeforeDouble);
assert.equal(new Set(doubleOptions.map(item => item.operationId)).size, 3, "Cada fila debe conservar su operation_id independiente.");
assert.ok(doubleOptions.every(item => item.destinationType === "EXPORT" && !item.destinationCustomerId && !item.destinationOrderId));
assert.ok(labels.__testing.getRows().every(row => row.outputState === "WAITING_CONFIRMATION"));
assert.equal(labels.batchCanBeConfirmed(), true);
assert.equal(labels.__testing.getRows().length, 3, "Enviar ZPL no debe limpiar filas.");

const createBeforeReprint = createCalls;
const sendBeforeReprint = sendCalls;
await labels.reprintBatch();
assert.equal(createCalls, createBeforeReprint, "Reimprimir no debe volver a crear etiquetas.");
assert.equal(sendCalls - sendBeforeReprint, 3, "Volver a imprimir debe reenviar una vez cada fila.");
assert.ok(reprintCalls >= 4, "La reimpresión debe usar la ruta canónica existente por etiqueta.");

const mutationsBeforeConfirm = createCalls + reprintCalls;
assert.equal(labels.confirmVisualBatch(), true);
assert.equal(createCalls + reprintCalls, mutationsBeforeConfirm, "Confirmar lote impreso debe ser exclusivamente visual.");
assert.equal(labels.__testing.getRows().length, 1);
assert.equal(labels.__testing.getRows()[0].confirmedLabels.length, 0);

labels.__testing.setRows([validRow("EXPLORER"), validRow("FREEDOM"), validRow("MONDIAL")]);
const createBeforePartial = createCalls;
const partialSendStart = sendCalls;
failAtSend = partialSendStart + 2;
assert.equal(await labels.printAll(), false);
let partialRows = labels.__testing.getRows();
assert.equal(partialRows[0].outputState, "WAITING_CONFIRMATION");
assert.equal(partialRows[1].outputState, "ERROR");
assert.equal(partialRows[2].outputState, "DRAFT");
assert.equal(createCalls - createBeforePartial, 2);
const failedCodes = partialRows[1].confirmedLabels.map(label => label.code);
failAtSend = 0;
assert.equal(await labels.printAll(), true);
partialRows = labels.__testing.getRows();
assert.deepEqual(partialRows[1].confirmedLabels.map(label => label.code), failedCodes, "Retry debe conservar los mismos códigos Zebra.");
assert.equal(createCalls - createBeforePartial, 3, "Retry solo debe crear la fila que todavía no tenía etiquetas.");
assert.ok(partialRows.every(row => row.outputState === "WAITING_CONFIRMATION"));

labels.confirmVisualBatch();
labels.__testing.setRows([validRow("EXPLORER")]);
for (let index = 0; index < 10; index += 1) labels.mount(container, appState);
await new Promise(resolve => setTimeout(resolve, 0));
const sendsBeforeShortcut = sendCalls;
const shortcut = new Event("keydown", { cancelable: true });
Object.defineProperties(shortcut, {
  key: { value: "i" },
  ctrlKey: { value: true },
  shiftKey: { value: false },
  altKey: { value: false },
  repeat: { value: false }
});
fakeDocument.dispatchEvent(shortcut);
for (let index = 0; index < 100 && labels.__testing.getBatchPrintInProgress(); index += 1) {
  await new Promise(resolve => setTimeout(resolve, 2));
}
assert.equal(shortcut.defaultPrevented, true);
assert.equal(sendCalls - sendsBeforeShortcut, 1, "10 mounts deben dejar un solo listener Ctrl+I.");
labels.unmount(container);
labels.confirmVisualBatch();
labels.__testing.setRows([validRow("FREEDOM")]);
const sendsBeforeUnmountShortcut = sendCalls;
const afterUnmount = new Event("keydown", { cancelable: true });
Object.defineProperties(afterUnmount, { key: { value: "i" }, ctrlKey: { value: true }, shiftKey: { value: false }, altKey: { value: false } });
fakeDocument.dispatchEvent(afterUnmount);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(sendCalls, sendsBeforeUnmountShortcut, "Unmount debe destruir el listener Ctrl+I.");

assert.match(labelSource, /batchPrintInProgress/);
assert.match(labelSource, /new window\.AbortController\(\)/);
assert.match(labelSource, /input, textarea, select, \[contenteditable='true'\]/);
assert.match(labelSource, /Enviado a impresora — pendiente de confirmar/);
assert.match(labelSource, /Las etiquetas ya creadas no se eliminarán/);
assert.doesNotMatch(labelSource, /window\.localStorage|window\.indexedDB|saveDb\(/);
assert.doesNotMatch(labelSource, /replacePrintedRow\(row\)/);
assert.match(destinationRepositorySource, /erp_destination_v2_create_labels/);
assert.match(zebraMigrationSource, /LABELED/);
assert.doesNotMatch(labelSource, /\.receiveBunch\(|\.createMovement\(|\.saveDb\(/, "La UI de impresion no debe invocar ingreso ni movimientos.");

console.log("VALIDACION_ZEBRA_DESTINO_BATCH_PRINT_OK");
console.log(JSON.stringify({ createCalls, reprintCalls, sendCalls, maxConcurrentSends, toasts: toasts.length, sentRows: sentZpl.length }));
