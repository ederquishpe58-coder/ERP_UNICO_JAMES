import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sourcePath = "scripts/modules/comercial/sri-authorization.js";
const source = fs.readFileSync(sourcePath, "utf8");
const stateSource = fs.readFileSync("scripts/modules/comercial/comercial-state.js", "utf8");
const queueSource = fs.readFileSync("scripts/modules/comercial/sri-order-queue-core.js", "utf8");
const context = { window: { BlessERP: {} }, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: sourcePath });

const sri = context.window.BlessERP.comercialSriAuthorization;
assert.ok(sri, "El módulo SRI debe quedar registrado.");
assert.equal(sri.invoiceLastNine("001-003-000000674"), "000000674");
assert.equal(sri.invoiceLastNine("", "1108202601171724426600110010030000006741234567811"), "000000674");

const local = { documentType: "01", isExport: false };
const exported = { documentType: "01", isExport: true };
const creditNote = { documentType: "04", isExport: false };
assert.equal(sri.matchesSalesScope(local, "LOCALES"), true);
assert.equal(sri.matchesSalesScope(exported, "LOCALES"), false);
assert.equal(sri.matchesSalesScope(exported, "EXPORTACIONES"), true);
assert.equal(sri.matchesSalesScope(creditNote, "NOTAS_CREDITO"), true);
assert.equal(sri.selectedIssueMonthRange(), null, "La bandeja SRI debe iniciar sin un mes seleccionado.");
assert.equal(typeof sri.resetDocumentsEntry, "function", "La bandeja SRI debe limpiar el mes al volver a ingresar.");

const requiredHeaders = [
  "Fecha de emisión",
  "Fecha de vuelo",
  "Comprobante",
  "Valor",
  "Cliente",
  "Cliente final",
  "DAE",
  "Guía madre",
  "Guía hija",
  "Fecha de autorización"
];
requiredHeaders.forEach(header => assert.ok(source.includes(`<th>${header}</th>`) || source.includes(`<th class="numeric">${header}</th>`), `Falta la columna ${header}.`));
assert.ok(source.includes('data-sri-list-sales-scope'), "Debe existir el filtro de ventas/comprobantes.");
assert.ok(source.includes('data-sri-issue-year'), "Debe existir el selector de año por fecha de emisión.");
assert.ok(source.includes('data-sri-issue-month'), "Deben existir los doce meses como filtro previo.");
assert.match(source, /if \(selectedIssueMonthRange\(\) && !ui\.loaded && !ui\.loading\) refresh/, "No se debe consultar SRI antes de seleccionar un mes.");
assert.match(source, /listCommercialSriDocuments\(issueRange \? \{ from: issueRange\.from, to: issueRange\.to, limit: 200 \}/, "La consulta comercial remota debe limitarse al mes de emisión elegido.");
assert.match(source, /const sourceRows = issueRange \? allRows\(appState\) : \[\]/, "Sin mes seleccionado tampoco se deben preparar filas locales.");
assert.ok(source.includes('data-sri-download-selected="AUTHORIZED_XML"'), "Debe existir descarga XML por selección.");
assert.ok(source.includes('data-sri-download-selected="RIDE_PDF"'), "Debe existir descarga RIDE por selección.");
assert.ok(source.includes('data-sri-view-selected'), "Debe existir un único acceso al detalle SRI mediante selección.");
assert.ok(source.includes('renderLogisticsField(row, "sriDaeNumber", row.dae)'), "La DAE debe poder editarse desde la bandeja.");
assert.ok(source.includes('renderLogisticsField(row, "awb", row.motherGuide)'), "La guía madre debe poder editarse desde la bandeja.");
assert.ok(source.includes('renderLogisticsField(row, "hawb", row.childGuide)'), "La guía hija debe poder editarse desde la bandeja.");
assert.ok(!source.includes('${renderReadiness()}'), "La validación técnica no debe mostrarse en la bandeja.");
assert.ok(!source.includes('<strong>Separacion tributaria:</strong>'), "La indicación de separación tributaria debe permanecer oculta.");
assert.ok(source.includes('sri-document-number ${documentNumberStatusClass(row.authorizationStatus)}'), "El color del número debe derivarse del estado SRI canónico.");
assert.ok(source.includes('normalized === "AUTORIZADO"') && source.includes('return "is-authorized"'), "La factura autorizada debe marcar su número en verde.");
const identityCell = source.match(/<td class="sri-document-identity">[\s\S]*?<\/td>/)?.[0];
assert.ok(identityCell, "El comprobante debe tener una celda de identidad propia.");
assert.ok(!identityCell.includes("status-badge"), "El badge AUTORIZADO redundante debe quedar oculto bajo el número.");
assert.ok(source.includes("<th>Estado</th>") && source.includes('<td><span class="status-badge ${badgeClass(row.authorizationStatus)}">${utils.esc(row.authorizationStatus)}</span></td>'), "El estado SRI canónico debe conservar su columna separada.");
assert.match(stateSource, /\["sriDaeNumber", "sriGuides", "awb", "hawb"\]/, "El estado comercial debe aceptar DAE, guía madre y guía hija.");
assert.match(stateSource, /if \(!String\(order\.hawb \|\| ""\)\.trim\(\) && storedGuides\[1\]\) order\.hawb = storedGuides\[1\]/, "Editar una guía debe conservar la otra guía histórica.");

const queueContext = { console };
vm.createContext(queueContext);
vm.runInContext(queueSource, queueContext, { filename: "sri-order-queue-core.js" });
const queue = queueContext.BlessERP.comercialSriOrderQueueCore;
const validMetrics = {
  totalStems: 25,
  totalUsd: 10,
  lines: [{ variety: "EXPLORER", totalStems: 25, unitPrice: 0.4 }]
};
const baseOrder = {
  number: "PED-COM-2026-0001",
  issuedAt: "2026-08-15",
  destinationCountryCode: "110",
  destinationCountry: "USA",
  daeNumber: "055-2026-40-00000001",
  transportType: "AEREO"
};
const customer = { identification: "1790012345001", legalName: "CLIENTE PRUEBA" };
const brand = { name: "MARCA PRUEBA", country: "USA" };
const missingExportGuides = queue.validateOrder({ order: baseOrder, customer, brand, metrics: validMetrics, today: "2026-08-15" });
assert.ok(missingExportGuides.some(error => error.includes("guia madre")), "La exportación debe exigir guía madre solamente al autorizar.");
assert.ok(missingExportGuides.some(error => error.includes("guia hija")), "La exportación debe exigir guía hija solamente al autorizar.");
const validExport = queue.validateOrder({ order: { ...baseOrder, awb: "014-12345678", hawb: "GUIA-HIJA-1" }, customer, brand, metrics: validMetrics, today: "2026-08-15" });
assert.equal(validExport.some(error => error.includes("guia madre") || error.includes("guia hija")), false);
const validLocal = queue.validateOrder({
  order: { ...baseOrder, saleType: "LOCAL", transportType: "LOCAL", destinationCountry: "ECUADOR", destinationCountryCode: "593", daeNumber: "" },
  customer,
  brand: null,
  metrics: validMetrics,
  today: "2026-08-15"
});
assert.equal(validLocal.some(error => error.includes("guia madre") || error.includes("guia hija")), false, "La venta local no debe exigir guías al autorizar.");

console.log("Documentos electrónicos SRI: columnas, filtros, secuencial y selección XML/RIDE OK.");
