import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = file => readFileSync(resolve(root, file), "utf8");
const check = (condition, message) => { if (!condition) throw new Error(message); };
const index = read("index.html");
const loader = read("scripts/core/module-loader.js");
const commercialIndex = read("scripts/modules/comercial/index.js");
const flowCore = read("scripts/modules/comercial/flow-v2/commercial-flow-core.js");
const flowUi = read("scripts/modules/comercial/flow-v2/commercial-flow-ui.js");
const coldRoom = read("scripts/modules/comercial/flow-v2/cold-room-ui.js");
const operationsIndex = read("scripts/modules/operaciones/index.js");
const sri = read("scripts/modules/comercial/sri-authorization.js");

const tags = [...index.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
  .map(match => ({ attrs: match[1], src: match[2].split("?")[0] }));
const group = name => tags.filter(item => String(item.attrs.match(/data-jaeder-lazy-group=["']([^"']+)["']/i)?.[1] || "").split(/\s+/).includes(name));
const bytes = items => items.reduce((sum, item) => sum + statSync(resolve(root, item.src)).size, 0);
const fullCommercialBytes = bytes(group("commercial"));

for (const [route, lazyGroup] of [
  ["commercial-panel", "commercial-dashboard"],
  ["commercial-preorders", "commercial-po"],
  ["commercial-order-master", "commercial-order"],
  ["commercial-order-history", "commercial-history"],
  ["commercial-availability-reservations", "commercial-availability"],
  ["commercial-order-detail", "commercial-order-tracking"],
  ["commercial-sri-authorization", "commercial-sri"],
  ["operations-dispatch", "operations-dispatch"]
]) {
  check(loader.includes(`"${route}": ["${lazyGroup}"]`), `${route} no usa el grupo ${lazyGroup}.`);
  check(group(lazyGroup).length > 0, `El grupo ${lazyGroup} está vacío.`);
}

check(bytes(group("commercial-history")) < fullCommercialBytes * 0.22, "Historial carga demasiado código.");
check(bytes(group("commercial-availability")) < fullCommercialBytes * 0.22, "Disponibilidad carga demasiado código.");
check(bytes(group("commercial-order-tracking")) < fullCommercialBytes * 0.22, "Seguimiento carga demasiado código.");
check(/state\.pageSize/.test(flowUi), "Las listas V2 no utilizan el tamaño de página configurado.");
check(/Lista ligera/.test(flowUi), "Historial no declara su carga ligera.");
check(/Los documentos se generan únicamente al solicitarlos/.test(flowUi), "Los documentos no están bajo demanda.");
check(/function getAvailabilityRows/.test(flowCore), "Falta disponibilidad V2.");
check(/function buildOrderFulfillment/.test(flowCore), "Falta seguimiento V2.");
check(/function updateCoordination/.test(flowCore), "Falta coordinación V2.");
check(/slice\(\(ui\.page - 1\) \* ui\.pageSize/.test(coldRoom), "Cuarto Frío no está paginado.");
check(/Asignación automática desde la bolsa local/.test(coldRoom), "Falta el flujo local en Cuarto Frío.");
check(/paginate\?\.\(filteredRows, "commercial-sri-documents", \{ pageSize: 50 \}\)/.test(sri), "SRI no está paginado.");
check(/renderRouteDeferred/.test(commercialIndex), "Las rutas no muestran carga progresiva.");
check(!/stateApi\.resolveInitialOrderWorkspace/.test(commercialIndex), "Crear pedido aún activa el workspace antiguo.");
check(/operacionesCuartoFrioV2\.render/.test(operationsIndex), "Operaciones no usa Cuarto Frío V2.");

for (const oldPath of [
  "scripts/modules/comercial/pedido-maestro.js",
  "scripts/modules/comercial/pedidos-historial.js",
  "scripts/modules/comercial/order-fulfillment-demo.js",
  "scripts/modules/operaciones/despacho-operativo.js"
]) check(!index.includes(`src="${oldPath}`), `${oldPath} todavía se carga en runtime.`);

console.log("VALIDACION_RENDIMIENTO_RUTAS_COMERCIALES_V2_OK");
for (const name of ["commercial-dashboard", "commercial-po", "commercial-order", "commercial-history", "commercial-availability", "commercial-order-tracking", "operations-dispatch", "commercial-sri"]) {
  console.log(`${name}: ${group(name).length} archivo(s) / ${(bytes(group(name)) / 1024).toFixed(1)} KB`);
}
