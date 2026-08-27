import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
const [queueSource, authorizationSource, stateSource, intercompanySource, historySource, adminSource, sriClientSource] = await Promise.all([
  read("./scripts/modules/comercial/sri-order-queue-core.js"),
  read("./scripts/modules/comercial/sri-authorization.js"),
  read("./scripts/modules/comercial/comercial-state.js"),
  read("./scripts/modules/comercial/intercompany-service.js"),
  read("./scripts/modules/comercial/pedidos-historial.js"),
  read("./scripts/services/admin-config.js"),
  read("./scripts/services/sri/sri-api-client.js")
]);

const browser = {};
browser.window = browser;
browser.globalThis = browser;
const context = vm.createContext({ window: browser, globalThis: browser, console, Date });
vm.runInContext(queueSource, context, { filename: "sri-order-queue-core.js" });
const queue = browser.BlessERP.comercialSriOrderQueueCore;

const customer = { identification: "1700000001", sriPaymentMethod: "20" };
const metrics = { totalStems: 25, totalUsd: 7.5, lines: [{ unitPrice: 0.3 }] };
const exportOrder = {
  number: "PED-EXP-1",
  issuedAt: "2026-07-30",
  saleType: "EXPORTACION",
  transportType: "MARITIMO",
  destinationCountryCode: "110",
  sriDaeNumber: "055-2026-40-01186792",
  awb: "014-12345678",
  hawb: "12345678"
};
const exportErrors = queue.validateOrder({
  order: exportOrder,
  customer,
  brand: { name: "CLIENTE FINAL", country: "USA" },
  metrics,
  today: "2026-08-10"
});
assert.equal(exportErrors.length, 0, "Una exportacion puede autorizarse dentro de 60 dias conservando la fecha del pedido.");

const localOldErrors = queue.validateOrder({
  order: { number: "PED-LOC-1", issuedAt: "2026-07-30", saleType: "LOCAL" },
  customer,
  brand: null,
  metrics,
  today: "2026-08-10"
});
assert.match(localOldErrors.join(" "), /mismo dia/i, "Una venta local antigua no debe cambiar su fecha para poder autorizarse.");

const localTodayErrors = queue.validateOrder({
  order: { number: "PED-LOC-2", issuedAt: "2026-08-10", saleType: "LOCAL", transportType: "AEREO", agencyId: "", awb: "", hawb: "", airlineId: "" },
  customer,
  brand: null,
  metrics,
  today: "2026-08-10"
});
assert.equal(localTodayErrors.length, 0, "La venta local del mismo dia debe quedar habilitada.");

assert.match(stateSource, /const normalMode = isImperioOrder \? "BLESS_SHARED" : "BLESS_INVENTORY";/, "Bless debe poder alternar entre inventario propio y compra externa.");
assert.match(stateSource, /order\.inventorySupplyMode = mode === "EXTERNAL_FARM" \? "EXTERNAL_FARM" : normalMode;/, "Compra externa debe quedar disponible en ambas empresas.");
assert.match(stateSource, /order\.availabilityCommitmentStatus = "NO_APLICA";[\s\S]*order\.availabilityCommitmentSource = "COMPRA_EXTERNA_SIN_INVENTARIO";/, "Guardar una compra externa de Bless no debe reservar disponibilidad.");
assert.match(intercompanySource, /const externalSupply = supplyMode === "EXTERNAL_FARM";/, "La normalizacion debe reconocer compra externa de Bless sin forzar inventario.");

assert.match(authorizationSource, /function sourceOrderIssueDate\(order = \{\}\)/, "La fecha original del pedido debe conservarse en una función explícita.");
assert.match(authorizationSource, /order\.sriOriginalIssueDate \|\| order\.issuedAt \|\| order\.createdAt \|\| order\.date/, "La exportación debe conservar la fecha original de emisión.");
assert.match(authorizationSource, /queueCore\.isLocalSale\(order, brand\)[\s\S]*\? String\(today \|\| ecuadorToday\(\)\)\.slice\(0, 10\)[\s\S]*: sourceOrderIssueDate\(order\)/, "La venta local debe usar la fecha de autorización y la exportación la fecha del pedido.");
assert.match(authorizationSource, /const emissionOrder = orderForSriEmission\(order, context\.brand\)/, "La creación SRI debe aplicar la fecha efectiva antes de construir el XML.");
assert.doesNotMatch(authorizationSource, /issueDate: row\.isExport \?[^\n]+: ecuadorToday\(\)/);
assert.match(stateSource, /order\.sriIssueDate = order\.issuedAt/);
assert.match(sriClientSource, /accessKeyDate\(input\.issueDate\)/, "La clave de acceso debe codificar la fecha de emision recibida.");

assert.match(intercompanySource, /const INTERCOMPANY_BILLING_ENABLED = false/);
assert.match(historySource, /!service\?\.billingEnabled/);
assert.match(adminSource, /if \(normalized === "FAC"\) return false/);
assert.doesNotMatch(adminSource, /id: "SEQ-FAC", code: "FAC"/);

console.log("Intercompany retirado, fechas SRI separadas y dos series de factura: OK");
