import { access, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(appRoot);
const operationsMode = process.argv.includes("--operations");
const errors = [];
const warnings = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else output.push(target);
  }
  return output;
}

function cleanReference(reference) {
  return reference.split(/[?#]/, 1)[0];
}

function isLocalReference(reference) {
  return reference && !/^(?:[a-z]+:|\/\/|#|\/api\/)/i.test(reference);
}

function uniqueIds(items, label) {
  const ids = items.map(item => String(item?.id || "").trim());
  assert(ids.every(Boolean), `${label}: existe un registro sin id`);
  assert(new Set(ids).size === ids.length, `${label}: existen ids duplicados`);
}

const requiredInputs = [
  "index.html", "styles.css",
  "styles", "app.js", "README.txt", "scripts", "build.mjs", "build-standalone.mjs",
  ".env.example"
];
for (const input of requiredInputs) {
  assert(await exists(path.join(appRoot, input)), `Falta el insumo requerido: ${input}`);
}

const html = await readFile(path.join(appRoot, "index.html"), "utf8");
const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(isLocalReference);
for (const reference of references) {
  const clean = cleanReference(reference);
  assert(await exists(path.join(appRoot, clean)), `Referencia local rota en index.html: ${reference}`);
}

const scriptReferences = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)]
  .map(match => cleanReference(match[1]))
  .filter(isLocalReference);
assert(scriptReferences.at(-1) === "app.js", "app.js debe ser el ultimo script cargado");
assert(new Set(scriptReferences).size === scriptReferences.length, "index.html contiene scripts locales duplicados");

const syntaxRoots = [path.join(appRoot, "scripts"), path.join(appRoot, "api"), path.join(repoRoot, "api")];
let syntaxFiles = [];
for (const directory of syntaxRoots) {
  if (await exists(directory)) syntaxFiles.push(...await walk(directory));
}
syntaxFiles.push(path.join(appRoot, "build.mjs"), path.join(appRoot, "build-standalone.mjs"));
syntaxFiles = [...new Set(syntaxFiles.filter(file => /\.(?:js|cjs|mjs)$/i.test(file)))];
for (const file of syntaxFiles) {
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (check.status !== 0) errors.push(`Sintaxis invalida en ${path.relative(repoRoot, file)}: ${(check.stderr || check.stdout).trim()}`);
}

const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const configFile of ["navigation.js", "module-registry.js", "module-contracts.js"]) {
  const source = await readFile(path.join(appRoot, "scripts", "config", configFile), "utf8");
  vm.runInContext(source, sandbox, { filename: configFile });
}

const navigation = sandbox.window.BlessERP?.navigation;
const registry = sandbox.window.BlessERP?.moduleRegistry;
const contracts = sandbox.window.BlessERP?.moduleContracts;
assert(Boolean(navigation), "No se pudo cargar la navegacion");
assert(Boolean(registry), "No se pudo cargar el registro de modulos");
assert(Boolean(contracts), "No se pudieron cargar los contratos internos");

if (navigation) {
  uniqueIds(navigation.groups || [], "Grupos de navegacion");
  uniqueIds(navigation.routes || [], "Rutas");
  assert(Boolean(navigation.routeMap?.[navigation.defaultRoute]), "La ruta predeterminada no existe");
  const groupIds = new Set((navigation.groups || []).map(group => group.id));
  for (const route of navigation.routes || []) {
    assert(groupIds.has(route.groupId), `La ruta ${route.id} apunta al grupo inexistente ${route.groupId}`);
  }
  assert(Boolean(navigation.routeMap?.["commercial-countries"]), "Comercial / Exportaciones no contiene el apartado Paises");
  assert(Boolean(navigation.routeMap?.["commercial-preorders"]), "Comercial / Exportaciones no contiene el apartado PO Nuevo");
}

if (registry) {
  uniqueIds(registry.modules || [], "Modulos");
  for (const module of registry.modules || []) {
    for (const dependency of module.dependencies || []) {
      if (/^(?:scripts|styles)\//.test(dependency)) {
        assert(await exists(path.join(appRoot, cleanReference(dependency))), `Dependencia de archivo rota del modulo ${module.id}: ${dependency}`);
      }
    }
  }
}

if (contracts) uniqueIds(contracts.contracts || [], "Contratos internos");

const require = createRequire(import.meta.url);
for (const apiEntry of [path.join(appRoot, "api", "sri.js"), path.join(appRoot, "api", "sri-retry.js")]) {
  try {
    require(apiEntry);
  } catch (error) {
    errors.push(`No se puede cargar ${path.relative(repoRoot, apiEntry)}: ${error.message}`);
  }
}

const sriQueue = require(path.join(appRoot, "scripts", "modules", "comercial", "sri-order-queue-core.js"));
const sriBaseContext = {
  order: {
    number: "PED-VALIDACION-SRI",
    packingListNumber: "PL-VALIDACION-SRI",
    issuedAt: new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }),
    destination: "USA",
    destinationCountryCode: "840",
    transportType: "aereo"
  },
  customer: { identification: "1790012345001", legalName: "CLIENTE VALIDACION" },
  brand: { name: "MARCA VALIDACION", country: "USA" },
  metrics: {
    totalStems: 25,
    totalUsd: 10,
    lines: [{ id: "LINEA-1", variety: "EXPLORER", length: 60, totalStems: 25, unitPrice: 0.4 }]
  }
};
const airSriErrors = sriQueue.validateOrder(sriBaseContext);
assert(airSriErrors.some(message => message.includes("DAE")), "SRI aereo permite emitir sin DAE");
assert(airSriErrors.some(message => message.toLowerCase().includes("guia madre")), "SRI aereo permite emitir sin guia madre");
assert(airSriErrors.some(message => message.toLowerCase().includes("guia hija")), "SRI aereo permite emitir sin guia hija");
const maritimeSriContext = structuredClone(sriBaseContext);
maritimeSriContext.order.transportType = "maritimo";
maritimeSriContext.order.sriDaeNumber = "055-VALIDACION-MARITIMA";
const maritimeSriErrors = sriQueue.validateOrder(maritimeSriContext);
assert(maritimeSriErrors.some(message => message.toLowerCase().includes("guia madre")), "SRI de exportacion maritima permite autorizar sin guia madre");
assert(maritimeSriErrors.some(message => message.toLowerCase().includes("guia hija")), "SRI de exportacion maritima permite autorizar sin guia hija");
const maritimeWithoutDae = structuredClone(maritimeSriContext);
maritimeWithoutDae.order.sriDaeNumber = "";
assert(sriQueue.validateOrder(maritimeWithoutDae).some(message => message.includes("DAE")), "SRI maritimo permite emitir sin DAE");
const localSriContext = structuredClone(sriBaseContext);
localSriContext.order.transportType = "terrestre";
localSriContext.order.destination = "ECUADOR";
localSriContext.order.destinationCountryCode = "593";
localSriContext.brand.country = "ECUADOR";
assert(!sriQueue.validateOrder(localSriContext).some(message => message.includes("DAE") || message.toLowerCase().includes("guia")), "SRI exige DAE o guias de exportacion en una venta local");
const localSriPayload = sriQueue.buildInvoicePayload(localSriContext);
assert(localSriPayload.ok && !("DAE" in localSriPayload.payload.additionalInformation) && !("Guias" in localSriPayload.payload.additionalInformation), "La venta local conserva DAE o guias en la informacion adicional SRI");
assert(sriQueue.guides({ sriGuides: "GUIA-PEGADA-SRI" }).includes("GUIA-PEGADA-SRI"), "SRI no reconoce las guias pegadas en la bandeja");

const sriDocumentService = require(path.join(appRoot, "api", "sri", "_lib", "document-service.cjs"));
const maritimeAdditionalPayload = {
  additionalInformation: { GUIAS: "", DAES: "055-VALIDACION-MARITIMA", Marca: "MARCA", Transporte: "maritimo" },
  buyer: { legalName: "CLIENTE", identification: "1790012345001", address: "DIRECCION" },
  lines: [{ mainCode: "ROSA-1", description: "ROSAS", variety: "EXPLORER", measure: "60 CM", unit: "TALLO" }]
};
try {
  sriDocumentService.normalizeExportAdditionalInformation(maritimeAdditionalPayload);
  assert(maritimeAdditionalPayload.erpEmission?.transportType === "MARITIMO", "Backend SRI no normaliza internamente el transporte maritimo");
} catch (error) {
  errors.push(`Backend SRI rechazo un pedido maritimo sin guia opcional: ${error.message}`);
}
const airAdditionalPayload = structuredClone(maritimeAdditionalPayload);
airAdditionalPayload.erpEmission.transportType = "AEREO";
let airWithoutGuideRejected = false;
try {
  sriDocumentService.normalizeExportAdditionalInformation(airAdditionalPayload);
} catch {
  airWithoutGuideRejected = true;
}
assert(airWithoutGuideRejected, "Backend SRI permite una factura aerea sin guia");

const commercialStateSandbox = { window: { BlessERP: {} } };
commercialStateSandbox.window.window = commercialStateSandbox.window;
vm.createContext(commercialStateSandbox);
vm.runInContext(
  await readFile(path.join(appRoot, "scripts", "modules", "comercial", "comercial-state.js"), "utf8"),
  commercialStateSandbox,
  { filename: "comercial-state.js" }
);
const daeWithoutAirline = {
  number: "055-VALIDACION-SIN-AEROLINEA",
  destination: "MIAMI",
  country: "USA",
  expirationDate: "2099-12-31",
  airlineId: "",
  status: "ACTIVA"
};
assert(
  commercialStateSandbox.window.BlessERP.comercialState.validateDaeDraft({
    airlineCatalog: [],
    countryCatalog: [{ name: "USA", status: "ACTIVO" }]
  }, daeWithoutAirline).ok,
  "Administracion no permite guardar una DAE sin aerolinea"
);

const masterOrderWorkspaceSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "pedido-maestro-workspace.js"), "utf8");
const masterOrderControllerSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "pedido-maestro.js"), "utf8");
assert(masterOrderWorkspaceSource.includes("master-boxes-quick-actions"), "Crear pedido no contiene las acciones compactas del diseno 1");
assert(masterOrderWorkspaceSource.includes("<th>Caja</th><th>Tipo</th><th>Variedad</th>"), "La matriz de Crear pedido no identifica la caja en la primera columna");
assert(!masterOrderWorkspaceSource.includes('class="master-grid-group-head"'), "Crear pedido conserva la doble cabecera del diseno anterior");
assert(!masterOrderWorkspaceSource.includes("<th>Total tallos</th>") && !masterOrderWorkspaceSource.includes("<th>Total USD</th>"), "Crear pedido conserva subtotales repetidos por fila");
for (const modeLabel of ["Rango igual", "Mixto manual", "Mixto abierto"]) {
  assert(masterOrderWorkspaceSource.includes(modeLabel), `Crear pedido perdio el generador ${modeLabel}`);
}
for (const actionAttribute of ["data-commercial-add-item-box", "data-commercial-duplicate-box", "data-commercial-delete-box", "data-commercial-duplicate-line", "data-commercial-delete-line"]) {
  assert(masterOrderWorkspaceSource.includes(actionAttribute), `La matriz compacta perdio la accion ${actionAttribute}`);
}
for (const formControl of ["data-commercial-open-quick-editor=\"customer\"", "data-commercial-open-quick-editor=\"brand\"", "data-commercial-save-order", "data-commercial-new-order", "commercial-quick-editor-modal", "data-commercial-customer-search"]) {
  assert(masterOrderWorkspaceSource.includes(formControl), `Crear pedido perdio el control compacto ${formControl}`);
}
assert(masterOrderControllerSource.includes("data-commercial-customer-option"), "Crear pedido perdio las opciones dinamicas del buscador de clientes");
const releaseActionIndex = masterOrderWorkspaceSource.indexOf("data-commercial-release-warehouse");
const saveActionIndex = masterOrderWorkspaceSource.indexOf("data-commercial-save-order");
const newActionIndex = masterOrderWorkspaceSource.indexOf("data-commercial-new-order");
assert(releaseActionIndex >= 0 && releaseActionIndex < saveActionIndex && saveActionIndex < newActionIndex, "Enviar a despacho no esta ubicado antes de Guardar y Nuevo");
assert((masterOrderWorkspaceSource.match(/data-commercial-release-warehouse/g) || []).length === 1, "Enviar a despacho aparece duplicado en Crear pedido");
assert(!masterOrderWorkspaceSource.includes("11 caracteres útiles"), "Crear pedido conserva el limite anterior de la guia hija");
assert(!masterOrderWorkspaceSource.includes('data-commercial-order-field="destination"'), "Crear pedido vuelve a mostrar Destino aunque proviene de la marca");
assert(!masterOrderWorkspaceSource.includes('data-commercial-order-field="destinationCountry"'), "Crear pedido vuelve a mostrar Pais aunque proviene de la marca");

const commercialDataSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "comercial-data.js"), "utf8");
const commercialCatalogSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "catalogos-comerciales.js"), "utf8");
const commercialStateSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "comercial-state.js"), "utf8");
assert(
  commercialStateSource.includes("(order?.lines || [])"),
  "El estado comercial vuelve a fallar cuando no existe un pedido seleccionado"
);
const commercialUtilsSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "comercial-utils.js"), "utf8");
const commercialHistorySource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "pedidos-historial.js"), "utf8");
const commercialPreordersSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "po-borradores.js"), "utf8");
const commercialWorkflowSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "comercial-workflow.js"), "utf8");
const boxLabelsUtilsSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "labels", "box-labels-utils.js"), "utf8");
const boxLabelsRenderSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "labels", "box-labels-render.js"), "utf8");
const commercialPrintSystemSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "print", "index.js"), "utf8");
const commercialPrintUtilsSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "print", "print-utils.js"), "utf8");
const commercialPrintCenterSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "centro-impresion.js"), "utf8");
const commercialInvoiceSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "print", "invoice-carguera-print.js"), "utf8");
const clientInvoiceSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "print", "commercial-invoice-client-print.js"), "utf8");
const clientInvoiceUtilsSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "print", "client-invoice-utils.js"), "utf8");
const sriAuthorizationSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "sri-authorization.js"), "utf8");
const sriApiSource = await readFile(path.join(appRoot, "api", "sri.js"), "utf8");
const sriRideSource = await readFile(path.join(appRoot, "api", "sri", "_lib", "ride.cjs"), "utf8");
const companyBrandingSource = await readFile(path.join(appRoot, "scripts", "services", "company-branding.js"), "utf8");
const commercialPrintCssSource = await readFile(path.join(appRoot, "styles", "print.css"), "utf8");
const operationsDataSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "operaciones-data.js"), "utf8");
const operationsStateSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "operaciones-state.js"), "utf8");
const postharvestParametersSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "parametros-poscosecha.js"), "utf8");
const dispatchViewSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "despacho-operativo.js"), "utf8");
const dispatchServiceSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "despacho-service-demo.js"), "utf8");
const operationsIndexSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "index.js"), "utf8");
const operationsLabelsSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "etiquetas-ramos.js"), "utf8");
const bunchLabelCodecSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "bunch-label-codec.js"), "utf8");
const zebraBrowserPrintSource = await readFile(path.join(appRoot, "scripts", "services", "zebra-browser-print.js"), "utf8");
const operationsReceptionSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "recepcion-flor.js"), "utf8");
const operationsClassificationSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "clasificacion.js"), "utf8");
const operationsReceptionClassificationSearchSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "reception-classification-search.js"), "utf8");
const labelPdfSource = await readFile(path.join(appRoot, "scripts", "services", "label-pdf.js"), "utf8");
const orderFulfillmentSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "order-fulfillment-demo.js"), "utf8");
const navigationTreeSource = await readFile(path.join(appRoot, "scripts", "config", "navigation-tree.js"), "utf8");
assert(commercialDataSource.includes("countryCatalog: clone(countries)"), "El estado comercial no persiste el catalogo de paises");
assert(commercialCatalogSource.includes("renderCountriesPage") && commercialCatalogSource.includes("data-country-save"), "El apartado Paises no permite crear y guardar registros");
assert(commercialCatalogSource.includes('data-destination-field="country"') && commercialCatalogSource.includes("countryOptions(countries, draft.country"), "Destinos no selecciona el pais desde el catalogo");
assert(commercialStateSource.includes("function saveCountry") && commercialStateSource.includes("store.destinationCatalog.forEach(rename)"), "El catalogo de paises no conserva sus referencias comerciales al editarse");
assert(navigationTreeSource.includes('"commercial-countries"'), "El apartado Paises no aparece en el arbol del menu comercial");
assert(!commercialCatalogSource.includes("Marca / referencia corta"), "Marcas todavia solicita una referencia corta innecesaria");
assert(commercialCatalogSource.includes("DAE automatica por pais") && commercialStateSource.includes("findCatalogCountry") && commercialStateSource.includes("draft.destination = country.name"), "Marca no deriva pais y destino desde el catalogo");
assert(commercialUtilsSource.includes('const supportsDae = order.transportType === "aereo"'), "La DAE comercial no esta limitada a pedidos aereos");
assert(commercialHistorySource.includes("data-commercial-history-annul") && commercialHistorySource.includes("NO se entregara a otro pedido"), "Historial de pedidos no permite anular conservando el secuencial");
assert(commercialHistorySource.includes("data-commercial-history-sri-review"), "Historial no deriva al modulo SRI cuando el comprobante ya inicio su proceso");
assert(
  commercialHistorySource.includes('target="_blank"')
    && commercialHistorySource.includes('url.searchParams.set("company", companyId)')
    && commercialHistorySource.includes('url.searchParams.set("order", orderId)')
    && commercialStateSource.includes('get("order")'),
  "El numero de pedido en Historial no conserva empresa y pedido al abrir otra pestana"
);
assert(commercialStateSource.includes("RESERVADO_ANULADO") && commercialStateSource.includes("BLOQUEAR_ANULACION_SRI"), "La anulacion no protege el secuencial ni el proceso SRI iniciado");
assert(navigationTreeSource.includes('"commercial-preorders"'), "PO Nuevo no aparece dentro de Ordenes / Pedidos");
assert(commercialPreordersSource.includes("data-po-generate") && commercialPreordersSource.includes("Generar pedido"), "PO Nuevo no permite generar un pedido");
for (const control of ["Caja individual", "Rango igual", "Mixto manual", "Mixto abierto", "data-po-mixed-filter", "preorderCustomerFilter", "preorderDateFilter", "preorderVarietyFilter", "preorderLengthFilter"]) {
  assert(commercialPreordersSource.includes(control), `PO Nuevo no contiene el control ${control}`);
}
assert(commercialPreordersSource.includes("sourcePoId") && commercialStateSource.includes("function createNewOrder(appState, seed = {})"), "PO Nuevo no transfiere su origen hacia Crear pedido");
assert(!commercialPreordersSource.includes("getReservations(") && !commercialPreordersSource.includes("reserveAvailability("), "PO Nuevo esta afectando reservas o disponibilidad");
assert(!commercialPreordersSource.includes("comercialSriAuthorization"), "PO Nuevo esta llamando directamente a Documentos electronicos SRI");
assert(!boxLabelsUtilsSource.includes('errors.push("Caja incompleta en Bodega'), "La impresion de etiquetas sigue bloqueada hasta completar la caja en Bodega");
assert(boxLabelsUtilsSource.includes("se permite imprimir la etiqueta anticipadamente"), "La etiqueta anticipada no informa que Bodega sigue pendiente");
assert(commercialWorkflowSource.includes('docCode !== "ETIQUETAS" && finalDispatchDocuments.includes(docCode)'), "El flujo documental sigue exigiendo LISTO_DESPACHO para imprimir etiquetas anticipadas");
assert(commercialPrintSystemSource.includes("printInIsolatedFrame") && commercialPrintSystemSource.includes("waitForPrintAssets"), "La impresion sigue dependiendo de una pestana web o no espera imagenes y fuentes");
assert(commercialPrintSystemSource.includes("data-commercial-download-doc") && commercialPrintSystemSource.includes("saveAsPdf"), "Los documentos no exponen una accion funcional para Guardar PDF");
assert(commercialPrintSystemSource.includes("clientInvoicePdfTitle") && commercialPrintSystemSource.includes("lastNineDigits"), "La descarga de Factura de Cliente no usa los ultimos 9 digitos y los nombres comerciales");
for (const clientInvoiceField of ["client-invoice-summary-grid", "INVOICE / PACKING", "TOTAL PIEZAS", "TOTAL FULLS", "CUSTOMER CODE", "FORWARDER / AGENCIA", "CARRIER & FLIGHT / LINEA"]) {
  assert(clientInvoiceSource.includes(clientInvoiceField), `La Factura de Cliente perdio el campo compacto ${clientInvoiceField}`);
}
assert(clientInvoiceUtilsSource.includes("visibleInvoiceNumber") && clientInvoiceUtilsSource.includes("type: row.type"), "La Factura de Cliente no conserva el secuencial SRI de nueve digitos o el tipo real de caja");
assert(clientInvoiceSource.includes("groupLinesByBox(metrics.lines)") && clientInvoiceSource.includes('rowspan="${group.lines.length}"'), "La Factura de Cliente no agrupa las variedades dentro de cada caja");
assert(clientInvoiceSource.includes("LENGTH / LONGITUD") && clientInvoiceSource.includes("STEMS / TALLOS") && clientInvoiceSource.includes("NUMERO DE PEDIDO"), "El pie de Factura de Cliente perdio el resumen de medidas, tallos o pedido");
assert(!clientInvoiceSource.includes("metrics.averagePricePerStem") && !clientInvoiceSource.includes("client-invoice-total"), "La Factura de Cliente vuelve a repetir el precio en el pie");
assert(commercialPrintSystemSource.includes('if (["INVOICE_PACKING_REFERENCIAL", "INVOICE_PACKING_REAL"].includes(docCode)) return "LETTER"'), "La factura comercial no usa tamano Carta de forma predeterminada");
assert(commercialPrintUtilsSource.includes('return "100mm 160mm"'), "La etiqueta Zebra ZD no usa el papel vertical exacto de 10 x 16 cm");
assert(commercialPrintCssSource.includes("width:100mm") && commercialPrintCssSource.includes("height:160mm"), "La plantilla de etiqueta no coincide con el tamano vertical de 10 x 16 cm");
assert(commercialPrintUtilsSource.includes('const pageMargin = customLabel') && commercialPrintUtilsSource.includes('? "0"'), "La etiqueta de caja no usa margen de pagina 0");
assert(commercialPrintCssSource.includes(".customs-label-canvas") && !commercialPrintCssSource.includes("transform:scale(.5)"), "La etiqueta Zebra ZD220 no debe reducirse internamente al 50%");
assert(boxLabelsRenderSource.includes("10 x 16 cm") && boxLabelsRenderSource.includes("Zebra ZD220"), "La interfaz no informa el formato vertical de etiqueta Zebra ZD220");
assert(boxLabelsRenderSource.includes("PRODUCT GROWN IN ECUADOR") && boxLabelsRenderSource.includes("COLD ROOM:"), "La franja inferior no contiene origen, agencia y cuarto frio");
assert(boxLabelsRenderSource.includes("aduana-ecuador-logo.png") && !boxLabelsRenderSource.includes("senae-logo-official.png"), "La etiqueta de caja no usa el logotipo correcto de Aduana del Ecuador");
assert(operationsLabelsSource.includes("IMPRIMIR ZEBRA") && operationsLabelsSource.includes("Tallos objetivo") && operationsLabelsSource.includes("Componente 4"), "La estación Zebra no contiene la tabla compacta completa");
assert(
  operationsLabelsSource.includes("assignNumericCodes: true")
    && operationsStateSource.includes("nextBunchLabelCode(store")
    && operationsStateSource.includes("ZEBRA_LABEL_SEQUENCE_KEY")
    && operationsStateSource.includes("numericBunchLabelCodes(store)"),
  "La estación Zebra no reserva un secuencial irreversible de 10 dígitos"
);
assert(operationsLabelsSource.includes("^PW609") && operationsLabelsSource.includes("^LL464") && operationsLabelsSource.includes("^GFA"), "La etiqueta Zebra no conserva 76,2 x 58 mm o no genera Code 128 grafico en ZPL");
assert(zebraBrowserPrintSource.includes("default?type=printer") && zebraBrowserPrintSource.includes('nativeRequest("write"'), "La estación no conecta o envía ZPL mediante Zebra Browser Print");
assert(!operationsLabelsSource.includes("stateApi.generateLabelBatch") && !operationsLabelsSource.includes("window.print()") && operationsLabelsSource.includes("registerPrintedZebraLabels") && operationsLabelsSource.includes("data-zebra-print") && operationsLabelsSource.includes("data-zebra-pdf") && operationsLabelsSource.includes("downloadBunchLabels"), "El creador Zebra no registra la ficha previa o perdió las acciones independientes Zebra/PDF");
assert(bunchLabelCodecSource.includes('"BF2"') && bunchLabelCodecSource.includes("components") && bunchLabelCodecSource.includes("componentTotal !== total") && bunchLabelCodecSource.includes("decodeLegacy"), "El código BF2 no contiene composición y total recuperables o perdió compatibilidad anterior");
assert(operationsStateSource.includes("inlineStructured") && operationsStateSource.includes("registerPrintedZebraLabels") && operationsStateSource.includes("bunchLabelCodec.decode(code, store)"), "Ingreso de ramos no interpreta o no registra el nuevo código estructurado");
assert(operationsStateSource.includes("ZEBRA_LABEL_REGISTRY_KEY") && operationsStateSource.includes("writeCompactZebraRegistry") && operationsStateSource.includes("hydrateCompactZebraRegistry"), "Las etiquetas Zebra no conservan el respaldo compacto cuando falla el guardado general");
assert(operationsIndexSource.includes("isZebraBarcodeKey") && operationsIndexSource.includes("isStructuredBarcode"), "Los lectores Zebra no aceptan el código BF alfanumérico");
assert(operationsIndexSource.includes("data-ops-bunch-intake-scan") && operationsIndexSource.includes('/^\\d{10}$/.test(code)'), "El ingreso de ramos no captura automáticamente el código corto de 10 dígitos");
assert(labelPdfSource.includes("BOX_PAGE_MM") && labelPdfSource.includes("width: 100, height: 160"), "El PDF de caja no conserva el formato vertical de 100 x 160 mm");
assert(labelPdfSource.includes('"ADUANA"') && labelPdfSource.includes('"DEL"') && labelPdfSource.includes('"ECUADOR"') && !labelPdfSource.includes('"SENAE"'), "El PDF no reproduce el nombre correcto del logotipo de Aduana del Ecuador");
assert(labelPdfSource.includes("BUNCH_PAGE_MM") && labelPdfSource.includes("width: 76.2, height: 58"), "El PDF de ramo no conserva la medida fisica fija de 76,2 x 58 mm");
assert(labelPdfSource.includes("BUNCH_BOTTOM_CLEARANCE_MM = 20") && labelPdfSource.includes("scaledTop(34.5)"), "El PDF de ramo no reserva 20 mm libres en la parte inferior");
assert(labelPdfSource.includes('/MediaBox [0 0 ${Number(page.width).toFixed(3)} ${Number(page.height).toFixed(3)}]'), "El PDF de etiquetas no declara sus medidas fisicas en cada pagina");
assert(sriAuthorizationSource.includes('data-sri-artifact-type="AUTHORIZED_XML"') && sriAuthorizationSource.includes('data-sri-artifact-type="RIDE_PDF"'), "Documentos electronicos SRI no permite descargar XML autorizado y PDF RIDE");
assert(sriApiSource.includes('attachment; filename="${fileName}"') && sriApiSource.includes('file.content_type === "application/pdf" ? "pdf"'), "La descarga SRI no conserva nombre y extension del archivo");
assert(companyBrandingSource.includes("bless-flower-logo-official-transparent.png"), "La identidad Bless Flower no usa el logo oficial transparente");
assert(companyBrandingSource.includes("imperio-flowers-logo.png"), "La identidad Imperio Flowers no conserva su logo propio");
assert(commercialPrintCenterSource.includes('id: "ROUTE_SHEET"') && commercialPrintCenterSource.includes('docCode: "HR"'), "El Centro de impresion no incluye la Hoja de Ruta");
for (const downloadAction of ["data-commercial-download-selected-labels", "data-commercial-download-selected-invoices", 'data-commercial-center-doc-action="download"']) {
  assert(commercialPrintCenterSource.includes(downloadAction), `El Centro de impresion perdio la accion ${downloadAction}`);
}
for (const invoiceSection of ["Shipper Name And Address", "Consignee Name and Address", "MAWB No.", "HAWB No.", "Name and Title of Person Preparing Invoice", "Freight Forwarder / Agencia de carga", "TOTAL FULLS", "QB", "HB", "SB", "OCT", "The Flowers and Foliage"]) {
  assert(commercialInvoiceSource.includes(invoiceSection), `La factura comercial Bless Flower perdio la seccion ${invoiceSection}`);
}
assert(!commercialInvoiceSource.includes("CUSTOM USE ONLY"), "La factura comercial conserva el bloque CUSTOM USE ONLY que debe mostrar al vendedor");
assert(commercialInvoiceSource.includes("order.seller_name") && commercialInvoiceSource.includes("order.sellerName"), "La factura comercial no obtiene el nombre del vendedor desde el pedido");
assert(commercialInvoiceSource.includes("<strong>BILL TO</strong><div>${utils.esc(consigneeName)}</div>"), "BILL TO no utiliza exclusivamente la Marca / Cliente final");
for (const principalCustomerLeak of ["customer?.legalName", "customer?.commercialName", "customer?.billingEmail", "customer?.contactEmail", "customer?.code"]) {
  assert(!commercialInvoiceSource.includes(principalCustomerLeak), `La factura de carguera puede revelar datos del cliente principal: ${principalCustomerLeak}`);
}
assert(commercialPrintCssSource.includes(".commercial-invoice-letter") && commercialPrintCssSource.includes(".commercial-invoice-table"), "La factura comercial adaptada no tiene estilos de impresion propios");
assert(operationsDataSource.includes('responsibles: rows("RSP"') && operationsStateSource.includes('responsibles: "responsibles"'), "Responsables de despacho no provienen de Parametros de Poscosecha");
assert(postharvestParametersSource.includes('responsibles: "Responsables de despacho"'), "Parametros de Poscosecha no permite administrar responsables de despacho");
assert(!dispatchViewSource.includes("data-ops-dispatch-responsible") && dispatchViewSource.includes("Cuarto frío · Escáner de cajas"), "Cuarto frio todavia exige un responsable individual o perdio el escaner de cajas");
assert(dispatchViewSource.includes("Número de pedido") && dispatchViewSource.includes("Abrir escáner") && dispatchViewSource.includes("COMPLETADO") && dispatchViewSource.includes("INCOMPLETO"), "Cuarto frio no muestra pedido, estado o acceso al escaner de cajas");
assert(!dispatchServiceSource.includes('createId("DSP-DEMO")') && dispatchServiceSource.includes('createId("CF")'), "Los pedidos de Cuarto frio vuelven a eliminarse por usar un identificador demo");
for (const dispatchStatus of ["PEDIDO_INCOMPLETO", "PEDIDO_COMPLETADO", "PEDIDO_ACTUALIZADO", "CARGADO_CAMION"]) {
  assert(dispatchServiceSource.includes(dispatchStatus) && dispatchViewSource.includes(dispatchStatus), `Despacho operativo perdio el estado ${dispatchStatus}`);
}
assert(!dispatchViewSource.includes("<th>Estado Bodega</th>") && !dispatchViewSource.includes("NO_LIBERADO"), "Despacho operativo todavia muestra la liberacion interna de Bodega");
assert(orderFulfillmentSource.includes("INICIAR_ARMADO_DIRECTO") && !orderFulfillmentSource.includes('error: "La orden debe estar liberada y abierta en Bodega antes de escanear."'), "El primer escaneo todavia exige liberacion manual de Bodega");
assert(operationsIndexSource.includes("refreshDispatchProgressDemo") && operationsIndexSource.includes("GUARDAR_AVANCE_AUTOMATICO") && dispatchViewSource.includes("Pedido completado. Todas las cajas quedaron completas automáticamente.") && !dispatchViewSource.includes("Confirmar carga en camión"), "El escaneo no actualiza automaticamente el pedido o todavia exige confirmacion final");
const invoiceSequenceCore = require(path.join(appRoot, "scripts", "modules", "comercial", "invoice-sequence-core.js"));
assert(
  invoiceSequenceCore.nextSequence([{ status: "ANULADO", sriSequential: "000000125" }]) === "000000126",
  "El generador intenta reutilizar el secuencial de un pedido anulado"
);

const commercialLogicSandbox = {
  window: {
    BlessERP: {
      utils: {
        clone: value => structuredClone(value),
        uid: prefix => `${prefix}-VALIDACION`,
        esc: value => String(value ?? ""),
        money: value => String(value ?? ""),
        number: value => String(value ?? ""),
        today: () => "2026-07-22"
      },
      comercialInvoiceSequence: { synchronize: seed => ({ ...seed }) }
    }
  }
};
commercialLogicSandbox.window.window = commercialLogicSandbox.window;
vm.createContext(commercialLogicSandbox);
vm.runInContext(commercialDataSource, commercialLogicSandbox, { filename: "comercial-data.js" });
vm.runInContext(commercialUtilsSource, commercialLogicSandbox, { filename: "comercial-utils.js" });
const commercialLogic = commercialLogicSandbox.window.BlessERP;
const normalizedBrand = commercialLogic.comercialData.createBrand({ finalClientName: "CLIENTE FINAL VALIDACION" });
assert(normalizedBrand.name === normalizedBrand.finalClientName && normalizedBrand.shortReference === normalizedBrand.finalClientName, "La razon social no alimenta el nombre interno compatible de Marca");
assert(normalizedBrand.destination === "" && normalizedBrand.country === "", "Una Marca nueva sigue heredando ECUADOR como destino");
assert(commercialLogic.comercialUtils.normalizeAwb("0451234567899") === "045-12345678", "La guia madre no limita a 11 digitos utiles ni agrega el guion");
assert(commercialLogic.comercialUtils.normalizeHawb("ab-c12 3456789 / libre") === "AB-C12 3456789 / LIBRE", "La guia hija no conserva su referencia alfanumerica normalizada");
assert(commercialLogic.comercialUtils.getGuideCharacters("ABC-12345678 / REFERENCIA").length > 11, "La guia hija sigue limitada a 11 caracteres");
commercialLogic.comercialData.daes.splice(0, commercialLogic.comercialData.daes.length, commercialLogic.comercialData.createDae({
  number: "055-DAE-AUTOMATICA",
  destination: "MIAMI",
  country: "USA",
  expirationDate: "2099-12-31",
  customerIds: ["CLIENTE-1"],
  status: "ACTIVA"
}));
const maritimeDaeOrder = { transportType: "maritimo", customerId: "CLIENTE-1", destination: "MIAMI" };
commercialLogic.comercialUtils.autoAssignDae(maritimeDaeOrder);
assert(maritimeDaeOrder.daeNumber === "" && !maritimeDaeOrder.daeAssignedAutomatically, "Una DAE comercial se asigna indebidamente al pedido maritimo");
commercialLogic.comercialData.daes.push(commercialLogic.comercialData.createDae({
  number: "055-DAE-SELECCIONABLE",
  destination: "MIAMI",
  country: "USA",
  expirationDate: "2099-12-31",
  customerIds: ["CLIENTE-1"],
  status: "ACTIVA"
}));
const selectableDaeOrder = { transportType: "aereo", customerId: "CLIENTE-1", destination: "NEW YORK", destinationCountry: "USA" };
commercialLogic.comercialUtils.autoAssignDae(selectableDaeOrder);
assert(selectableDaeOrder.daeNumber === "055-DAE-AUTOMATICA" && selectableDaeOrder.daeAssignedAutomatically, "La DAE del pais del cliente final no se selecciona por defecto");
assert(selectableDaeOrder.destination === "NEW YORK" && selectableDaeOrder.destinationCountry === "USA", "La DAE automatica reemplazo el destino o pais del cliente final");
commercialLogic.comercialUtils.applyManualDae(selectableDaeOrder, "055-DAE-SELECCIONABLE");
assert(selectableDaeOrder.daeNumber === "055-DAE-SELECCIONABLE" && selectableDaeOrder.daeModifiedManual, "La seleccion manual de DAE no se conserva");
assert(selectableDaeOrder.destination === "NEW YORK" && selectableDaeOrder.destinationCountry === "USA", "La DAE seleccionada manualmente reemplazo el destino o pais del cliente final");
commercialLogic.comercialData.daes.push(commercialLogic.comercialData.createDae({
  number: "055-DAE-OTRO-DESTINO",
  destination: "MADRID",
  country: "ESPANA",
  expirationDate: "2099-12-31",
  customerIds: [],
  status: "ACTIVA"
}));
assert(commercialLogic.comercialUtils.getAvailableDaesForOrder(selectableDaeOrder).some(item => item.number === "055-DAE-OTRO-DESTINO"), "El selector no permite elegir otra DAE activa y vigente");

commercialLogic.comercialState = {};
vm.runInContext(commercialPreordersSource, commercialLogicSandbox, { filename: "po-borradores.js" });
const preorderLogic = commercialLogic.comercialPreorders;
const validPreorder = preorderLogic.createPreorder({
  number: "PO-2026-00001",
  customerId: "CLIENTE-1",
  brandId: "MARCA-1",
  scheduledDate: "2026-07-23",
  lines: [{ boxCount: 2, boxType: "HB", variety: "EXPLORER", length: 70, bunchesPerBox: 12, stemsPerBunch: 25, unitPrice: 0.4 }]
});
assert(preorderLogic.validate(validPreorder).length === 0, "Un PO completo no puede confirmarse");
const generatedPoLines = preorderLogic.expandOrderLines(validPreorder);
assert(generatedPoLines.length === 2 && generatedPoLines[0].boxNumber === 1 && generatedPoLines[1].boxNumber === 2, "PO Nuevo no convierte la cantidad de cajas en lineas de Crear pedido");
const mixedPreorder = preorderLogic.createPreorder({
  number: "PO-2026-MIXTOS",
  customerId: "CLIENTE-1",
  brandId: "MARCA-1",
  scheduledDate: "2026-07-23",
  lines: [
    {
      mode: preorderLogic.LINE_MODES.MANUAL_MIX,
      boxCount: 2,
      boxType: "HB",
      manualItems: [
        { variety: "EXPLORER", length: 70, bunches: 4, stemsPerBunch: 25, unitPrice: 0.4 },
        { variety: "MONDIAL", length: 60, bunches: 3, stemsPerBunch: 25, unitPrice: 0.35 }
      ]
    },
    {
      mode: preorderLogic.LINE_MODES.OPEN_MIX,
      boxCount: 1,
      boxType: "QB",
      anyLength: true,
      bunchesPerBox: 6,
      stemsPerBunch: 25,
      unitPrice: 0.3,
      excludedVarieties: "MANDALA, NINA"
    }
  ]
});
assert(preorderLogic.validate(mixedPreorder).length === 0, "Un PO con mixtos completos no puede confirmarse");
const generatedMixedLines = preorderLogic.expandOrderLines(mixedPreorder);
assert(generatedMixedLines.length === 5, "El mixto manual no conserva todas sus variedades por caja");
assert(generatedMixedLines.filter(line => line.boxBuildMode === "MIXTO_MANUAL").length === 4, "El PO no identifica las lineas del mixto manual");
const generatedOpenMix = generatedMixedLines.find(line => line.boxBuildMode === "MIXTO_ABIERTO");
assert(generatedOpenMix?.mixedAnyLength && generatedOpenMix?.mixedExcludedVarieties?.includes("MANDALA"), "El mixto abierto no conserva cualquier medida y sus exclusiones");
validPreorder.status = "CONFIRMADO";
const preorderStore = {
  preorders: [validPreorder],
  customerCatalog: [],
  brandCatalog: [],
  agencyCatalog: [],
  ui: { currentPreorderId: validPreorder.id, preorderStatusFilter: "TODOS" }
};
let generatedOrderSeed = null;
commercialLogic.comercialState.getStore = () => preorderStore;
commercialLogic.comercialState.createNewOrder = (_appState, seed) => {
  generatedOrderSeed = seed;
  return { id: "PEDIDO-GENERADO-1", number: "PED-COM-2026-9999", ...seed };
};
commercialLogic.state = { saveDb() {}, setRoute() { return true; } };
commercialLogic.layout = { renderApp() {} };
preorderLogic.generateOrder({ db: { session: { activeUser: { name: "VALIDADOR" } } } });
assert(generatedOrderSeed?.sourcePoNumber === "PO-2026-00001" && generatedOrderSeed?.lines?.length === 2, "Generar pedido no transfiere el PO completo a Crear pedido");
assert(preorderStore.preorders[0].status === "PEDIDO_GENERADO" && preorderStore.preorders[0].linkedOrderId === "PEDIDO-GENERADO-1", "El PO no conserva el enlace con el pedido generado");

const availabilityPolicySource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "availability-policy.js"), "utf8");
const availabilityViewSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "pedido-demand-view.js"), "utf8");
const commercialAvailabilitySource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "disponibilidad-comercial.js"), "utf8");
const commercialModuleSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "index.js"), "utf8");
const operationsModuleSource = await readFile(path.join(appRoot, "scripts", "modules", "operaciones", "index.js"), "utf8");
const layoutSource = await readFile(path.join(appRoot, "scripts", "ui", "layout.js"), "utf8");
const fulfillmentSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "order-fulfillment-demo.js"), "utf8");
const orderMasterSource = await readFile(path.join(appRoot, "scripts", "modules", "comercial", "pedido-maestro.js"), "utf8");
assert(!availabilityViewSource.includes('class="summary-grid availability-summary-grid"'), "Disponibilidad conserva las tarjetas superiores que deben eliminarse");
assert(availabilityViewSource.includes('data-ops-ui-field="availabilityFilterVariety"'), "Disponibilidad no contiene el filtro de variedades");
assert(availabilityViewSource.includes('data-ops-ui-field="availabilityFilterLength"'), "Disponibilidad no contiene el filtro de medidas");
assert(availabilityViewSource.includes("physicalInventoryBunches || 0) > 0"), "Los filtros de disponibilidad incluyen combinaciones sin existencia fisica");
for (const header of ["<th>Variedad</th>", "<th>Medida</th>", "<th>Físico</th>", "<th>Pedido Activo</th>", "<th>Faltante</th>", "<th>Disponible Spot</th>"]) {
  assert(availabilityViewSource.includes(header), `Disponibilidad no contiene la columna ${header.replace(/<[^>]+>/g, "")}`);
}
assert(!availabilityViewSource.includes("<th>Escaneado</th>"), "Disponibilidad todavía muestra la columna Escaneado que debe permanecer solo en el cálculo interno");
for (const setting of ["autoActivateOrders", "activationTime", "mondayToSaturday", "showFutureOrders", "allowRiskSales", "requireRiskObservation", "projectionDays"]) {
  assert(availabilityViewSource.includes(`data-ops-availability-setting=\"${setting}\"`) || availabilityViewSource.includes(`booleanSetting(\"${setting}\"`), `Disponibilidad no contiene el parametro ${setting}`);
}
assert(availabilityPolicySource.includes("isFutureOrder") && availabilityPolicySource.includes("isOrderActive"), "La politica de disponibilidad no separa pedidos activos y futuros");
assert(availabilityPolicySource.includes("La venta no está bloqueada") || availabilityViewSource.includes("no bloquea"), "La alerta de pedido futuro no conserva la venta no bloqueante");
assert(fulfillmentSource.includes("getFutureDemandRows") && fulfillmentSource.includes("orderContributesDemand(order, appState)"), "El calculo de disponibilidad no separa la demanda futura de la activa");
assert(
  fulfillmentSource.includes("getAvailabilitySourceState(appState)")
    && !fulfillmentSource.includes("parseNumber(line?.stemsPerBunch) !== parseNumber(inventory?.stemsPerBunch)"),
  "Cajas y escaner no comparte el inventario Bless o exige una condicion adicional a variedad y medida"
);
assert(orderMasterSource.includes("evaluateOrderRisk") && orderMasterSource.includes("recordRiskObservation"), "El envio de la venta no solicita observacion ante riesgo futuro");
assert(
  commercialAvailabilitySource.includes("BlessERP.comercialPedidoDemandView.renderAvailability")
    && commercialAvailabilitySource.includes('context: "operations"'),
  "Comercial debe reutilizar exactamente el cálculo operativo de disponibilidad"
);
assert(
  commercialModuleSource.includes("BlessERP.comercialAvailability.bind(container, appState)")
    && commercialAvailabilitySource.includes("function bind(container, appState)"),
  "La disponibilidad compartida en Comercial no tiene controles propios o reutilizables"
);
assert(operationsModuleSource.includes('routeId === "commercial-availability-reservations"'), "Los controles de disponibilidad no funcionan desde la ruta Comercial");
assert(layoutSource.includes('["operations-availability", "commercial-availability-reservations"]'), "Comercial elimina las tarjetas de la disponibilidad compartida");
assert(!layoutSource.includes("comercialState?.createNewOrder?.(state)"), "Entrar a Crear pedido sigue generando automaticamente un pedido");

const availabilityStore = { ui: {}, availabilityPolicySettings: {} };
const availabilityOrders = [];
const availabilitySandbox = { window: { BlessERP: {
  operacionesState: { getStore: () => availabilityStore },
  comercialState: { getOrders: () => availabilityOrders },
  state: { saveDb() {} },
  utils: { uid: prefix => `${prefix}-VALIDATION` }
} } };
availabilitySandbox.window.window = availabilitySandbox.window;
vm.createContext(availabilitySandbox);
vm.runInContext(availabilityPolicySource, availabilitySandbox, { filename: "availability-policy.js" });
const availabilityPolicy = availabilitySandbox.window.BlessERP.operacionesAvailabilityPolicy;
const validationToday = availabilityPolicy.localDateKey();
const validationFutureOrder = { id: "ORDER-FUTURE", number: "FUT-001", status: "VALIDADO_COMERCIAL", warehouseStatus: "NO_LIBERADO", flightDate: availabilityPolicy.addDays(validationToday, 1), lines: [{ bunches: 10 }] };
availabilityOrders.push(validationFutureOrder);
assert(!availabilityPolicy.isOrderActive(validationFutureOrder, null), "Un pedido futuro esta descontando inventario activo");
assert(availabilityPolicy.isFutureOrder(validationFutureOrder, null), "Un pedido futuro no aparece como informacion proyectada");
validationFutureOrder.flightDate = validationToday;
availabilityPolicy.synchronizeDueOrders(null, { force: true });
assert(availabilityPolicy.isOrderActive(validationFutureOrder, null), "Actualizar no activa el pedido del dia de preparacion");
assert(availabilityPolicy.getSettings(null).projectionDays === 3, "La proyeccion predeterminada de disponibilidad no es 3 dias");

if (operationsMode) {
  const workday = require(path.join(appRoot, "scripts", "modules", "operaciones", "workday-core.js"));
  assert(workday.normalizeStatus("EN_CURSO") === workday.ACTIVE_STATUS, "La normalizacion de jornada activa no coincide");
  assert(workday.canRegister({ id: "VALIDACION", status: "ACTIVA" }), "Una jornada activa no permite registrar");
  assert(!workday.canRegister({ id: "VALIDACION", status: "PAUSADA" }), "Una jornada pausada permite registrar");
  for (const file of [
    "operaciones-data.js", "operaciones-utils.js", "operaciones-state.js", "recepcion-flor.js",
    "clasificacion.js", "inventario-rosas.js", "despacho-operativo.js"
  ]) {
    assert(await exists(path.join(appRoot, "scripts", "modules", "operaciones", file)), `Falta el componente operativo ${file}`);
  }
  assert(
    operationsReceptionClassificationSearchSource.includes("<th>Recibido</th><th>Entregado</th><th>Pendiente</th><th>Estado</th>")
      && operationsReceptionClassificationSearchSource.includes("item.pendingStems"),
    "El historial search-first de recepciones no muestra Recibido/Entregado/Pendiente junto al estado"
  );
  assert(
    operationsReceptionClassificationSearchSource.includes("Solo con pendiente")
      && operationsReceptionClassificationSearchSource.includes('data-ops-search-action="query"')
      && operationsReceptionClassificationSearchSource.includes("pageSize: 25"),
    "El historial de recepciones no conserva consulta explícita, filtro pendiente o paginación"
  );
  for (const field of ["nationalOidioStems", "nationalVellosoStems", "nationalBotrytisStems", "nationalMaltratoStems"]) {
    assert(operationsClassificationSource.includes(`data-field="${field}"`), `El resultado de clasificacion no permite registrar ${field}`);
  }
  assert(
    operationsClassificationSource.includes('"O", "V", "B", "M", "Estado", "Observacion"')
      && operationsClassificationSource.includes('"TOTALES"'),
    "El XLSX de clasificadores no incluye causas nacionales y totales"
  );
  assert(
    operationsStateSource.includes("generalNationalStems !== detailedNationalStems")
      && operationsStateSource.includes("accumulatedNationalOidioStems"),
    "La clasificacion no valida ni acumula el desglose nacional O/V/B/M"
  );
  assert(
    (
      operationsClassificationSource.includes('<input type="number" min="0" value="${utils.esc(assignmentDraft.meshCount)}"')
      || (
        operationsClassificationSource.includes('data-ops-numeric-only')
        && operationsClassificationSource.includes('value="${utils.esc(assignmentDraft.meshCount)}"')
      )
    )
      && operationsStateSource.includes("if (meshCount < 0 || extraStems < 0)"),
    "El ingreso al clasificador no permite registrar solo tallos extras"
  );
  assert(
    operationsClassificationSource.includes("data-ops-classification-block-option")
      && operationsIndexSource.includes("filterClassificationBlockOptions")
      && operationsIndexSource.includes("beginClassificationAssignmentSearch")
      && operationsStateSource.includes("configuredSupplier?.assignedBlock")
      && operationsStateSource.includes("classificationAssignmentManualSelectionVersion")
      && !operationsStateSource.includes("selectedPendingLine = pendingReceptionLines[0]"),
    "El ingreso al clasificador no ofrece busqueda por bloque o proveedor parametrizado"
  );
  assert(
    operationsStateSource.includes("Ingrese al menos una malla o una cantidad de tallos extras mayor a cero.")
      && operationsStateSource.includes("classificationAssignmentQuantitySeed")
      && operationsStateSource.includes("meshCount: Math.max(0, utils.parseNumber(meshEntry.meshCount, 0))"),
    "La logica de clasificacion no conserva movimientos de 0 mallas con tallos extras"
  );
  assert(
    operationsStateSource.includes("!assignment.receptionId || assignment.receptionId === reception.id")
      && operationsStateSource.includes('id: existing ? (item.id || uid("REC-ITEM")) : uid("REC-ITEM")')
      && operationsStateSource.includes("entry.reception.id === draft.receptionId")
      && operationsStateSource.includes("entry.item.id === draft.receptionItemId"),
    "Una recepcion nueva puede heredar clasificaciones por identificadores de lineas reutilizados"
  );
  assert(
    operationsReceptionSource.includes("La flor pasa a EN CLASIFICACION unicamente cuando se registra su entrega al clasificador."),
    "Recepcion no explica la transicion manual hacia Clasificacion"
  );
}

const sourceScripts = (await walk(path.join(appRoot, "scripts")))
  .filter(file => file.endsWith(".js"))
  .map(file => path.relative(appRoot, file).replaceAll("\\", "/"));
const referencedSet = new Set(scriptReferences);
const unreferenced = sourceScripts.filter(file => !referencedSet.has(file));
if (unreferenced.length) warnings.push(`Scripts fuente no cargados directamente: ${unreferenced.join(", ")}`);

if (warnings.length) warnings.forEach(message => console.warn(`ADVERTENCIA: ${message}`));
if (errors.length) {
  errors.forEach(message => console.error(`ERROR: ${message}`));
  process.exitCode = 1;
} else {
  console.log([
    `Validacion ${operationsMode ? "operativa" : "tecnica"} correcta`,
    `rutas=${navigation?.routes?.length || 0}`,
    `modulos=${registry?.modules?.length || 0}`,
    `contratos=${contracts?.contracts?.length || 0}`,
    `scripts=${sourceScripts.length}`,
    `archivos_sintaxis=${syntaxFiles.length}`
  ].join(" | "));
}
