import fs from "node:fs";
import vm from "node:vm";

function loadBlessERPConfig(file) {
  const code = fs.readFileSync(file, "utf8");
  const sandbox = { window: { BlessERP: {} } };
  vm.runInNewContext(code, sandbox, { filename: file });
  return sandbox.window.BlessERP;
}

function uniqueDuplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

const { navigation } = loadBlessERPConfig("scripts/config/navigation.js");
const { moduleRegistry } = loadBlessERPConfig("scripts/config/module-registry.js");
const { moduleContracts } = loadBlessERPConfig("scripts/config/module-contracts.js");
const treeSandbox = { window: { BlessERP: { navigation } } };
vm.runInNewContext(fs.readFileSync("scripts/config/navigation-tree.js", "utf8"), treeSandbox, { filename: "scripts/config/navigation-tree.js" });
const navigationTree = treeSandbox.window.BlessERP.navigationTree;

const expectedMenuLabels = [
  "Core del sistema",
  "Operaciones / Poscosecha",
  "Comercial / Exportaciones",
  "Administración / Contabilidad",
  "Inventario suministros / empaque",
  "Reportes",
  "Configuración",
  "Módulos futuros"
];

const expectedModuleIds = [
  "core",
  "operaciones-poscosecha",
  "comercial-exportaciones",
  "contabilidad",
  "inventario-empaque",
  "reportes",
  "configuracion",
  "modulos-futuros"
];

const expectedActiveRoutes = [
  "dashboard-home",
  "core-diagnostics",
  "operations-postharvest",
  "operations-parameters",
  "operations-reception",
  "operations-grading",
  "operations-labels",
  "operations-bunch-intake",
  "operations-roses-inventory",
  "operations-availability",
  "operations-warehouse",
  "operations-yields",
  "operations-scanner",
  "operations-dispatch",
  "commercial-panel",
  "commercial-order-master",
  "commercial-order-history",
  "commercial-customers-brands",
  "commercial-brands",
  "commercial-destinations",
  "commercial-box-types",
  "commercial-availability-reservations",
  "commercial-cargo-agencies",
  "commercial-daes",
  "commercial-airlines",
  "commercial-export-products",
  "commercial-invoice-packing",
  "commercial-client-invoice",
  "commercial-print-center",
  "commercial-sri-authorization",
  "accounting-chart",
  "accounting-journal",
  "accounting-ledger",
  "tax-parameters",
  "purchases-invoices",
  "purchases-withholdings-issued",
  "banks-accounts",
  "portfolios-suppliers",
  "portfolios-customers",
  "inventory-summary",
  "reports-dashboard",
  "settings-company",
  "tax-ats"
];

const expectedShellFiles = [
  ".env.example",
  "index.html",
  "styles/print.css",
  "scripts/config/env.js",
  "scripts/config/navigation.js",
  "scripts/config/navigation-tree.js",
  "scripts/services/navigation/menu-service.js",
  "scripts/config/module-registry.js",
  "scripts/config/module-contracts.js",
  "scripts/core/state.js",
  "scripts/core/storage.js",
  "scripts/services/supabase/supabase-client.js",
  "scripts/services/supabase/repository-base.js",
  "scripts/services/supabase/feature-flag-guard.js",
  "scripts/repositories/core/company-repository.js",
  "scripts/repositories/core/user-repository.js",
  "scripts/repositories/core/audit-log-repository.js",
  "scripts/repositories/core/sequence-repository.js",
  "scripts/repositories/core/settings-repository.js",
  "scripts/repositories/core/menu-repository.js",
  "scripts/repositories/comercial/customer-repository.js",
  "scripts/repositories/comercial/final-brand-repository.js",
  "scripts/repositories/comercial/commercial-order-repository.js",
  "scripts/repositories/comercial/commercial-order-box-repository.js",
  "scripts/repositories/comercial/commercial-order-line-repository.js",
  "scripts/repositories/comercial/commercial-document-repository.js",
  "scripts/repositories/comercial/commercial-workflow-repository.js",
  "scripts/repositories/comercial/dae-repository.js",
  "scripts/repositories/comercial/cargo-agency-repository.js",
  "scripts/repositories/comercial/airline-repository.js",
  "scripts/repositories/comercial/export-product-repository.js",
  "scripts/repositories/operaciones/flower-availability-repository.js",
  "scripts/repositories/operaciones/flower-reservation-repository.js",
  "scripts/repositories/operaciones/operational-dispatch-repository.js",
  "scripts/repositories/operaciones/operational-dispatch-box-repository.js",
  "scripts/repositories/operaciones/scanner-event-repository.js",
  "scripts/repositories/operaciones/operational-consumption-repository.js",
  "scripts/repositories/operaciones/operational-kardex-repository.js",
  "scripts/repositories/operaciones/flower-inventory-repository.js",
  "scripts/repositories/operaciones/bunch-label-repository.js",
  "scripts/repositories/inventario-materiales/material-item-repository.js",
  "scripts/repositories/inventario-materiales/material-stock-repository.js",
  "scripts/repositories/inventario-materiales/material-movement-repository.js",
  "scripts/repositories/inventario-materiales/packaging-requirement-repository.js",
  "scripts/repositories/contabilidad/chart-of-accounts-repository.js",
  "scripts/repositories/contabilidad/journal-entry-repository.js",
  "scripts/repositories/contabilidad/journal-entry-line-repository.js",
  "scripts/repositories/contabilidad/supplier-repository.js",
  "scripts/repositories/contabilidad/purchase-repository.js",
  "scripts/repositories/contabilidad/withholding-issued-repository.js",
  "scripts/repositories/contabilidad/withholding-received-repository.js",
  "scripts/repositories/contabilidad/cxp-repository.js",
  "scripts/repositories/contabilidad/cxc-repository.js",
  "scripts/repositories/contabilidad/bank-account-repository.js",
  "scripts/repositories/contabilidad/bank-movement-repository.js",
  "scripts/repositories/index.js",
  "scripts/repositories/repository-status.js",
  "scripts/modules/comercial/comercial-data.js",
  "scripts/modules/comercial/comercial-utils.js",
  "scripts/modules/comercial/comercial-workflow.js",
  "scripts/modules/comercial/order-box-builder.js",
  "scripts/modules/comercial/comercial-state.js",
  "scripts/modules/comercial/order-fulfillment-demo.js",
  "scripts/modules/comercial/pedido-demand-view.js",
  "scripts/modules/comercial/pedido-maestro-workspace.js",
  "scripts/modules/comercial/accounting-preview/accounting-preview-utils.js",
  "scripts/modules/comercial/accounting-preview/cxc-preview.js",
  "scripts/modules/comercial/accounting-preview/journal-preview.js",
  "scripts/modules/comercial/accounting-preview/sales-accounting-preview.js",
  "scripts/modules/comercial/accounting-preview/index.js",
  "scripts/modules/comercial/catalogos-comerciales.js",
  "scripts/modules/comercial/labels/box-labels-data.js",
  "scripts/modules/comercial/labels/customs-code-utils.js",
  "scripts/modules/comercial/labels/box-labels-utils.js",
  "scripts/modules/comercial/labels/box-labels-render.js",
  "scripts/modules/comercial/bodega-empaque/packaging-data.js",
  "scripts/modules/comercial/bodega-empaque/packaging-rules.js",
  "scripts/modules/comercial/bodega-empaque/packaging-status.js",
  "scripts/modules/comercial/bodega-empaque/packaging-calculator.js",
  "scripts/modules/comercial/bodega-empaque/packaging-requirements-view.js",
  "scripts/modules/comercial/bodega-empaque/index.js",
  "scripts/modules/comercial/print/print-utils.js",
  "scripts/modules/comercial/print/client-invoice-utils.js",
  "scripts/modules/comercial/print/commercial-invoice-client-print.js",
  "scripts/modules/comercial/print/invoice-carguera-print.js",
  "scripts/modules/comercial/print/packing-list-print.js",
  "scripts/modules/comercial/print/hoja-ruta-print.js",
  "scripts/modules/comercial/print/master-packing-print.js",
  "scripts/modules/comercial/print/box-labels-print.js",
  "scripts/modules/comercial/print/control-dae-print.js",
  "scripts/modules/comercial/print/summary-order-print.js",
  "scripts/modules/comercial/print/index.js",
  "scripts/modules/comercial/invoice-carguera.js",
  "scripts/modules/comercial/centro-impresion.js",
  "scripts/modules/comercial/pedidos-historial.js",
  "scripts/modules/comercial/disponibilidad-comercial.js",
  "scripts/modules/comercial/ordenes-dia.js",
  "scripts/modules/comercial/orden-detalle.js",
  "scripts/modules/comercial/pedido-maestro.js",
  "scripts/modules/comercial/index.js",
  "scripts/modules/operaciones/operaciones-data.js",
  "scripts/modules/operaciones/code-utils-demo.js",
  "scripts/modules/operaciones/scanner-hid-adapter-demo.js",
  "scripts/modules/operaciones/operaciones-utils.js",
  "scripts/modules/operaciones/operaciones-state.js",
  "scripts/modules/operaciones/disponibilidad-service-demo.js",
  "scripts/modules/operaciones/despacho-service-demo.js",
  "scripts/modules/operaciones/consumo-inventario-demo.js",
  "scripts/modules/operaciones/operational-cycle-demo.js",
  "scripts/modules/operaciones/scanner-service-demo.js",
  "scripts/modules/operaciones/parte1-adapter.js",
  "scripts/modules/operaciones/panel-operativo.js",
  "scripts/modules/operaciones/parametros-poscosecha.js",
  "scripts/modules/operaciones/recepcion-flor.js",
  "scripts/modules/operaciones/clasificacion.js",
  "scripts/modules/operaciones/etiquetas-ramos.js",
  "scripts/modules/operaciones/ingreso-ramos-scanner.js",
  "scripts/modules/operaciones/inventario-rosas.js",
  "scripts/modules/operaciones/disponibilidad.js",
  "scripts/modules/operaciones/bodega-rosas.js",
  "scripts/modules/operaciones/rendimientos.js",
  "scripts/modules/operaciones/scanner-zebra.js",
  "scripts/modules/operaciones/despacho-operativo.js",
  "scripts/modules/operaciones/index.js",
  "scripts/ui/layout.js",
  "scripts/modules/part2.js"
];

const syntaxCheckFiles = [
  "app.js",
  "scripts/config/env.js",
  "scripts/config/navigation-tree.js",
  "scripts/services/navigation/menu-service.js",
  "scripts/core/state.js",
  "scripts/core/storage.js",
  "scripts/services/supabase/supabase-client.js",
  "scripts/services/supabase/repository-base.js",
  "scripts/services/supabase/feature-flag-guard.js",
  "scripts/repositories/core/company-repository.js",
  "scripts/repositories/core/user-repository.js",
  "scripts/repositories/core/audit-log-repository.js",
  "scripts/repositories/core/sequence-repository.js",
  "scripts/repositories/core/settings-repository.js",
  "scripts/repositories/core/menu-repository.js",
  "scripts/repositories/comercial/customer-repository.js",
  "scripts/repositories/comercial/final-brand-repository.js",
  "scripts/repositories/comercial/commercial-order-repository.js",
  "scripts/repositories/comercial/commercial-order-box-repository.js",
  "scripts/repositories/comercial/commercial-order-line-repository.js",
  "scripts/repositories/comercial/commercial-document-repository.js",
  "scripts/repositories/comercial/commercial-workflow-repository.js",
  "scripts/repositories/comercial/dae-repository.js",
  "scripts/repositories/comercial/cargo-agency-repository.js",
  "scripts/repositories/comercial/airline-repository.js",
  "scripts/repositories/comercial/export-product-repository.js",
  "scripts/repositories/operaciones/flower-availability-repository.js",
  "scripts/repositories/operaciones/flower-reservation-repository.js",
  "scripts/repositories/operaciones/operational-dispatch-repository.js",
  "scripts/repositories/operaciones/operational-dispatch-box-repository.js",
  "scripts/repositories/operaciones/scanner-event-repository.js",
  "scripts/repositories/operaciones/operational-consumption-repository.js",
  "scripts/repositories/operaciones/operational-kardex-repository.js",
  "scripts/repositories/operaciones/flower-inventory-repository.js",
  "scripts/repositories/operaciones/bunch-label-repository.js",
  "scripts/repositories/inventario-materiales/material-item-repository.js",
  "scripts/repositories/inventario-materiales/material-stock-repository.js",
  "scripts/repositories/inventario-materiales/material-movement-repository.js",
  "scripts/repositories/inventario-materiales/packaging-requirement-repository.js",
  "scripts/repositories/contabilidad/chart-of-accounts-repository.js",
  "scripts/repositories/contabilidad/journal-entry-repository.js",
  "scripts/repositories/contabilidad/journal-entry-line-repository.js",
  "scripts/repositories/contabilidad/supplier-repository.js",
  "scripts/repositories/contabilidad/purchase-repository.js",
  "scripts/repositories/contabilidad/withholding-issued-repository.js",
  "scripts/repositories/contabilidad/withholding-received-repository.js",
  "scripts/repositories/contabilidad/cxp-repository.js",
  "scripts/repositories/contabilidad/cxc-repository.js",
  "scripts/repositories/contabilidad/bank-account-repository.js",
  "scripts/repositories/contabilidad/bank-movement-repository.js",
  "scripts/repositories/index.js",
  "scripts/repositories/repository-status.js",
  "scripts/modules/comercial/comercial-data.js",
  "scripts/modules/comercial/comercial-utils.js",
  "scripts/modules/comercial/comercial-workflow.js",
  "scripts/modules/comercial/comercial-state.js",
  "scripts/modules/comercial/order-fulfillment-demo.js",
  "scripts/modules/comercial/pedido-demand-view.js",
  "scripts/modules/comercial/pedido-maestro-workspace.js",
  "scripts/modules/comercial/accounting-preview/accounting-preview-utils.js",
  "scripts/modules/comercial/accounting-preview/cxc-preview.js",
  "scripts/modules/comercial/accounting-preview/journal-preview.js",
  "scripts/modules/comercial/accounting-preview/sales-accounting-preview.js",
  "scripts/modules/comercial/accounting-preview/index.js",
  "scripts/modules/comercial/catalogos-comerciales.js",
  "scripts/modules/comercial/labels/box-labels-data.js",
  "scripts/modules/comercial/labels/customs-code-utils.js",
  "scripts/modules/comercial/labels/box-labels-utils.js",
  "scripts/modules/comercial/labels/box-labels-render.js",
  "scripts/modules/comercial/bodega-empaque/packaging-data.js",
  "scripts/modules/comercial/bodega-empaque/packaging-rules.js",
  "scripts/modules/comercial/bodega-empaque/packaging-status.js",
  "scripts/modules/comercial/bodega-empaque/packaging-calculator.js",
  "scripts/modules/comercial/bodega-empaque/packaging-requirements-view.js",
  "scripts/modules/comercial/bodega-empaque/index.js",
  "scripts/modules/comercial/print/print-utils.js",
  "scripts/modules/comercial/print/client-invoice-utils.js",
  "scripts/modules/comercial/print/commercial-invoice-client-print.js",
  "scripts/modules/comercial/print/invoice-carguera-print.js",
  "scripts/modules/comercial/print/packing-list-print.js",
  "scripts/modules/comercial/print/hoja-ruta-print.js",
  "scripts/modules/comercial/print/master-packing-print.js",
  "scripts/modules/comercial/print/box-labels-print.js",
  "scripts/modules/comercial/print/control-dae-print.js",
  "scripts/modules/comercial/print/summary-order-print.js",
  "scripts/modules/comercial/print/index.js",
  "scripts/modules/comercial/invoice-carguera.js",
  "scripts/modules/comercial/centro-impresion.js",
  "scripts/modules/comercial/pedidos-historial.js",
  "scripts/modules/comercial/disponibilidad-comercial.js",
  "scripts/modules/comercial/ordenes-dia.js",
  "scripts/modules/comercial/orden-detalle.js",
  "scripts/modules/comercial/pedido-maestro.js",
  "scripts/modules/comercial/index.js",
  "scripts/modules/operaciones/operaciones-data.js",
  "scripts/modules/operaciones/code-utils-demo.js",
  "scripts/modules/operaciones/scanner-hid-adapter-demo.js",
  "scripts/modules/operaciones/operaciones-utils.js",
  "scripts/modules/operaciones/operaciones-state.js",
  "scripts/modules/operaciones/disponibilidad-service-demo.js",
  "scripts/modules/operaciones/despacho-service-demo.js",
  "scripts/modules/operaciones/consumo-inventario-demo.js",
  "scripts/modules/operaciones/operational-cycle-demo.js",
  "scripts/modules/operaciones/scanner-service-demo.js",
  "scripts/modules/operaciones/parte1-adapter.js",
  "scripts/modules/operaciones/parametros-poscosecha.js",
  "scripts/modules/operaciones/ingreso-ramos-scanner.js",
  "scripts/modules/operaciones/panel-operativo.js",
  "scripts/modules/operaciones/recepcion-flor.js",
  "scripts/modules/operaciones/clasificacion.js",
  "scripts/modules/operaciones/etiquetas-ramos.js",
  "scripts/modules/operaciones/inventario-rosas.js",
  "scripts/modules/operaciones/disponibilidad.js",
  "scripts/modules/operaciones/bodega-rosas.js",
  "scripts/modules/operaciones/rendimientos.js",
  "scripts/modules/operaciones/scanner-zebra.js",
  "scripts/modules/operaciones/despacho-operativo.js",
  "scripts/modules/operaciones/index.js",
  "scripts/ui/layout.js",
  "scripts/modules/part2.js"
];

const expectedContractIds = [
  "availabilityContract",
  "reservationContract",
  "operationalInventoryContract",
  "operationalConsumptionContract",
  "bunchLabelContract",
  "scannerEventContract",
  "commercialOrderContract",
  "boxDetailContract",
  "packagingRequirementContract",
  "boxLabelContract",
  "clientCommercialInvoiceContract",
  "commercialWorkflowContract",
  "salesAccountingContract",
  "dispatchContract",
  "auditEventContract"
];

const expectedOperationsLabels = [
  "Panel operativo",
  "Parámetros de Poscosecha",
  "Recepción de flor",
  "Clasificación",
  "Etiquetas de ramos",
  "Ingreso de ramos por escáner",
  "Inventario de rosas",
  "Disponibilidad",
  "Bodega de rosas",
  "Rendimientos",
  "Scanner / Zebra técnico",
  "Despacho operativo"
];

const expectedCommercialLabels = [
  "Panel comercial",
  "Pedido Maestro",
  "Pedidos / Historial",
  "Clientes principales",
  "Marcas / Clientes finales",
  "Destinos / Países",
  "Tipos de caja",
  "Disponibilidad",
  "Agencias de carga",
  "DAEs",
  "Líneas aéreas",
  "Productos exportables",
  "Invoice / Packing carguera",
  "Centro de impresión",
  "Autorización SRI futura"
];

const requiredModuleFields = [
  "id",
  "name",
  "description",
  "status",
  "group",
  "renderTarget",
  "dependencies",
  "note"
];

const requiredContractFields = [
  "id",
  "name",
  "origin",
  "destination",
  "description",
  "status",
  "implementationStatus",
  "primaryFields",
  "summarizedRules"
];

const errors = [];

const menuTreeRecords = navigationTree.createMenuRecordsFromLegacyNavigation(navigation);
const menuTreeReport = navigationTree.validateMenuRecords(menuTreeRecords);
if (!menuTreeReport.valid) {
  errors.push(`Arbol de navegacion invalido: ${menuTreeReport.errors.join(" | ")}`);
}
const requiredTreeFields = ["id", "parentId", "orden", "icono", "nombre", "ruta", "tipo", "permisos"];
for (const node of menuTreeRecords) {
  const missingFields = requiredTreeFields.filter(field => !(field in node));
  if (missingFields.length) errors.push(`Nodo de menu ${node.id} sin campos: ${missingFields.join(", ")}`);
}
if (!menuTreeRecords.some(node => node.tipo === "carpeta") || !menuTreeRecords.some(node => node.tipo === "pagina")) {
  errors.push("El arbol de navegacion debe contener carpetas y paginas.");
}
if (!navigationTree.buildMenuTree(menuTreeRecords, "Administrador / Contador").tree.length) {
  errors.push("El arbol de navegacion no produce nodos visibles para Administrador.");
}

const menuLabels = navigation.menuGroups.map(group => group.label);
if (menuLabels.length !== expectedMenuLabels.length || expectedMenuLabels.some(label => !menuLabels.includes(label))) {
  errors.push(`Menu principal incompleto o fuera de especificacion. Detectado: ${menuLabels.join(" | ")}`);
}

const routeIds = navigation.routes.map(route => route.id);
const groupIds = navigation.groups.map(group => group.id);
const menuIds = navigation.menuGroups.map(group => group.id);

const duplicateRouteIds = uniqueDuplicates(routeIds);
if (duplicateRouteIds.length) {
  errors.push(`Rutas duplicadas: ${duplicateRouteIds.join(", ")}`);
}

const duplicateGroupIds = uniqueDuplicates(groupIds);
if (duplicateGroupIds.length) {
  errors.push(`Grupos duplicados: ${duplicateGroupIds.join(", ")}`);
}

const duplicateMenuIds = uniqueDuplicates(menuIds);
if (duplicateMenuIds.length) {
  errors.push(`Menus duplicados: ${duplicateMenuIds.join(", ")}`);
}

for (const group of navigation.groups) {
  if (!navigation.routeMap[group.defaultRoute]) {
    errors.push(`Grupo sin defaultRoute valido: ${group.id} -> ${group.defaultRoute}`);
  }
}

for (const menuGroup of navigation.menuGroups) {
  if (!navigation.routeMap[menuGroup.defaultRoute]) {
    errors.push(`Menu sin defaultRoute valido: ${menuGroup.id} -> ${menuGroup.defaultRoute}`);
  }
  for (const groupId of menuGroup.groupIds) {
    if (!navigation.groupMap[groupId]) {
      errors.push(`Menu ${menuGroup.id} referencia grupo inexistente: ${groupId}`);
    }
  }
}

const operationsGroup = navigation.groupMap.operations;
if (!operationsGroup) {
  errors.push("No existe el grupo interno operations.");
} else {
  const labels = operationsGroup.routes.map(route => route.label);
  for (const label of expectedOperationsLabels) {
    if (!labels.includes(label)) errors.push(`Falta opcion de Operaciones: ${label}`);
  }
}

const commercialGroup = navigation.groupMap.commercial;
if (!commercialGroup) {
  errors.push("No existe el grupo interno commercial.");
} else {
  const labels = commercialGroup.routes.map(route => route.label);
  for (const label of expectedCommercialLabels) {
    if (!labels.includes(label)) errors.push(`Falta opcion de Comercial: ${label}`);
  }
}

const moduleIds = moduleRegistry.modules.map(module => module.id);
const duplicateModuleIds = uniqueDuplicates(moduleIds);
if (duplicateModuleIds.length) {
  errors.push(`Modulos duplicados: ${duplicateModuleIds.join(", ")}`);
}

for (const moduleId of expectedModuleIds) {
  if (!moduleRegistry.moduleMap[moduleId]) {
    errors.push(`Falta modulo requerido en registry: ${moduleId}`);
  }
}

if (moduleRegistry.moduleMap["operaciones-poscosecha"]?.status === "placeholder") {
  errors.push("Operaciones / Poscosecha no debe seguir como placeholder simple.");
}

for (const contractId of expectedContractIds) {
  if (!moduleContracts.contractMap[contractId]) {
    errors.push(`Falta contrato requerido: ${contractId}`);
  }
}

for (const routeId of expectedActiveRoutes) {
  if (!navigation.routeMap[routeId]) {
    errors.push(`Falta ruta clave del shell: ${routeId}`);
  }
}

for (const file of expectedShellFiles) {
  if (!fs.existsSync(file)) {
    errors.push(`Falta archivo clave del shell: ${file}`);
  }
}

for (const file of syntaxCheckFiles) {
  try {
    const code = fs.readFileSync(file, "utf8");
    new Function(code);
  } catch (error) {
    errors.push(`Error de sintaxis en ${file}: ${error.message}`);
  }
}

for (const module of moduleRegistry.modules) {
  const missingFields = requiredModuleFields.filter(field => !(field in module));
  if (missingFields.length) {
    errors.push(`Modulo ${module.id} sin campos requeridos: ${missingFields.join(", ")}`);
  }
    if (![
      "activo",
      "activo demo/local",
      "demo avanzado",
      "preparado",
      "pendiente futuro",
      "placeholder",
      "futuro",
      "demo-integrado",
      "parcial"
    ].includes(module.status)) {
      errors.push(`Modulo ${module.id} tiene estado invalido: ${module.status}`);
    }
  if (!Array.isArray(module.dependencies)) {
    errors.push(`Modulo ${module.id} debe declarar dependencias como arreglo.`);
  }
}

const duplicateContractIds = uniqueDuplicates(moduleContracts.contracts.map(contract => contract.id));
if (duplicateContractIds.length) {
  errors.push(`Contratos duplicados: ${duplicateContractIds.join(", ")}`);
}

for (const contract of moduleContracts.contracts) {
  const missingFields = requiredContractFields.filter(field => !(field in contract));
  if (missingFields.length) {
    errors.push(`Contrato ${contract.id} sin campos requeridos: ${missingFields.join(", ")}`);
  }
  if (!Array.isArray(contract.primaryFields) || !contract.primaryFields.length) {
    errors.push(`Contrato ${contract.id} debe declarar primaryFields.`);
  }
  if (!Array.isArray(contract.summarizedRules) || !contract.summarizedRules.length) {
    errors.push(`Contrato ${contract.id} debe declarar summarizedRules.`);
  }
}

if (!moduleRegistry.diagnostics?.shellStatus) {
  errors.push("Falta diagnostics.shellStatus en module-registry.");
}

if (!Array.isArray(moduleRegistry.diagnostics?.technicalSources) || moduleRegistry.diagnostics.technicalSources.length < 3) {
  errors.push("Falta detalle de technicalSources en diagnostics.");
}

if (!Array.isArray(moduleRegistry.diagnostics?.warnings) || !moduleRegistry.diagnostics.warnings.length) {
  errors.push("Faltan warnings en diagnostics.");
}

const indexHtml = fs.readFileSync("index.html", "utf8");
if (!indexHtml.includes("scripts/config/module-contracts.js")) {
  errors.push("index.html no carga module-contracts.js.");
}
if (!indexHtml.includes("scripts/config/navigation-tree.js") || !indexHtml.includes("scripts/services/navigation/menu-service.js")) {
  errors.push("index.html no carga la navegacion dinamica en arbol.");
}
if (!indexHtml.includes("scripts/repositories/core/menu-repository.js")) {
  errors.push("index.html no carga el repositorio futuro del menu.");
}
if (!indexHtml.includes("scripts/modules/comercial/index.js")) {
  errors.push("index.html no carga el modulo comercial demo.");
}
if (!indexHtml.includes("scripts/modules/comercial/pedido-maestro-workspace.js")) {
  errors.push("index.html no carga el workspace del Pedido Maestro.");
}
if (indexHtml.indexOf("scripts/modules/comercial/print/print-utils.js") > indexHtml.indexOf("scripts/modules/comercial/labels/box-labels-utils.js")) {
  errors.push("index.html debe cargar print-utils.js antes de box-labels-utils.js.");
}
if (!indexHtml.includes("styles/print.css")) {
  errors.push("index.html no carga styles/print.css.");
}
if (!indexHtml.includes("scripts/modules/comercial/print/index.js")) {
  errors.push("index.html no carga el subsistema de impresion comercial.");
}
if (!indexHtml.includes("scripts/modules/comercial/print/commercial-invoice-client-print.js")) {
  errors.push("index.html no carga la factura comercial cliente demo.");
}
if (!indexHtml.includes("scripts/modules/comercial/bodega-empaque/index.js")) {
  errors.push("index.html no carga el subsistema bodega-empaque comercial.");
}
if (!indexHtml.includes("scripts/modules/comercial/labels/box-labels-render.js")) {
  errors.push("index.html no carga el subsistema de etiquetas comerciales.");
}
if (!indexHtml.includes("scripts/modules/comercial/accounting-preview/index.js")) {
  errors.push("index.html no carga el subsistema de preview contable comercial.");
}
if (!indexHtml.includes("scripts/modules/operaciones/index.js")) {
  errors.push("index.html no carga el modulo de Operaciones / Poscosecha.");
}
if (!indexHtml.includes("scripts/modules/operaciones/disponibilidad-service-demo.js")) {
  errors.push("index.html no carga el servicio demo compartido de disponibilidad.");
}
if (!indexHtml.includes("scripts/modules/operaciones/despacho-service-demo.js")) {
  errors.push("index.html no carga el servicio demo compartido de despacho.");
}
if (!indexHtml.includes("scripts/modules/operaciones/consumo-inventario-demo.js")) {
  errors.push("index.html no carga el servicio demo de consumo operativo.");
}
if (!indexHtml.includes("scripts/modules/operaciones/operational-cycle-demo.js")) {
  errors.push("index.html no carga el servicio agregador del ciclo operativo demo.");
}
if (!indexHtml.includes("scripts/modules/operaciones/code-utils-demo.js")) {
  errors.push("index.html no carga el utilitario central de codigos demo.");
}
if (!indexHtml.includes("scripts/modules/operaciones/scanner-hid-adapter-demo.js")) {
  errors.push("index.html no carga el adaptador HID demo del scanner.");
}
if (!indexHtml.includes("scripts/modules/operaciones/scanner-service-demo.js")) {
  errors.push("index.html no carga el servicio demo compartido de scanner.");
}
if (!indexHtml.includes("scripts/modules/operaciones/parte1-adapter.js")) {
  errors.push("index.html no carga el adapter documentado de Parte 1.");
}
if (!indexHtml.includes("scripts/repositories/index.js")) {
  errors.push("index.html no carga el indice general de repositorios futuros.");
}
if (!indexHtml.includes("scripts/repositories/repository-status.js")) {
  errors.push("index.html no carga el reporte de estado de repositorios.");
}
if (!indexHtml.includes("scripts/services/supabase/feature-flag-guard.js")) {
  errors.push("index.html no carga el guard de feature flags Supabase.");
}
if (!indexHtml.includes("scripts/modules/operaciones/disponibilidad.js")) {
  errors.push("index.html no carga la pantalla de disponibilidad operativa.");
}
if (!indexHtml.includes("scripts/modules/operaciones/scanner-zebra.js")) {
  errors.push("index.html no carga la pantalla demo Scanner / Zebra.");
}

const standaloneBuild = fs.readFileSync("build-standalone.mjs", "utf8");
if (!standaloneBuild.includes("scripts/config/module-contracts.js")) {
  errors.push("build-standalone.mjs no incluye module-contracts.js.");
}
if (!standaloneBuild.includes("scripts/config/navigation-tree.js") || !standaloneBuild.includes("scripts/services/navigation/menu-service.js")) {
  errors.push("build-standalone.mjs no incluye la navegacion dinamica en arbol.");
}
if (!standaloneBuild.includes("scripts/modules/comercial/index.js")) {
  errors.push("build-standalone.mjs no incluye el modulo comercial demo.");
}
if (!standaloneBuild.includes("scripts/modules/comercial/pedido-maestro-workspace.js")) {
  errors.push("build-standalone.mjs no incluye el workspace del Pedido Maestro.");
}
if (standaloneBuild.indexOf("scripts/modules/comercial/print/print-utils.js") > standaloneBuild.indexOf("scripts/modules/comercial/labels/box-labels-utils.js")) {
  errors.push("build-standalone.mjs debe cargar print-utils.js antes de box-labels-utils.js.");
}
if (!standaloneBuild.includes("styles/print.css")) {
  errors.push("build-standalone.mjs no incluye styles/print.css.");
}
if (!standaloneBuild.includes("scripts/modules/comercial/accounting-preview/index.js")) {
  errors.push("build-standalone.mjs no incluye el subsistema de preview contable comercial.");
}
if (!standaloneBuild.includes("scripts/modules/comercial/print/index.js")) {
  errors.push("build-standalone.mjs no incluye la capa de impresion comercial.");
}
if (!standaloneBuild.includes("scripts/modules/comercial/print/commercial-invoice-client-print.js")) {
  errors.push("build-standalone.mjs no incluye la factura comercial cliente demo.");
}
if (!standaloneBuild.includes("scripts/modules/comercial/bodega-empaque/index.js")) {
  errors.push("build-standalone.mjs no incluye la capa bodega-empaque comercial.");
}
if (!standaloneBuild.includes("scripts/modules/comercial/labels/box-labels-render.js")) {
  errors.push("build-standalone.mjs no incluye la capa de etiquetas comerciales.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/index.js")) {
  errors.push("build-standalone.mjs no incluye el modulo de Operaciones / Poscosecha.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/disponibilidad-service-demo.js")) {
  errors.push("build-standalone.mjs no incluye el servicio demo compartido de disponibilidad.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/despacho-service-demo.js")) {
  errors.push("build-standalone.mjs no incluye el servicio demo compartido de despacho.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/consumo-inventario-demo.js")) {
  errors.push("build-standalone.mjs no incluye el servicio demo de consumo operativo.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/operational-cycle-demo.js")) {
  errors.push("build-standalone.mjs no incluye el servicio del ciclo operativo demo.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/code-utils-demo.js")) {
  errors.push("build-standalone.mjs no incluye el utilitario central de codigos demo.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/scanner-hid-adapter-demo.js")) {
  errors.push("build-standalone.mjs no incluye el adaptador HID demo del scanner.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/scanner-service-demo.js")) {
  errors.push("build-standalone.mjs no incluye el servicio demo compartido de scanner.");
}
if (!standaloneBuild.includes("scripts/modules/operaciones/parte1-adapter.js")) {
  errors.push("build-standalone.mjs no incluye el adapter documentado de Parte 1.");
}
if (!standaloneBuild.includes("scripts/repositories/index.js")) {
  errors.push("build-standalone.mjs no incluye el indice general de repositorios.");
}
if (!standaloneBuild.includes("scripts/repositories/repository-status.js")) {
  errors.push("build-standalone.mjs no incluye el reporte de estado de repositorios.");
}
if (!standaloneBuild.includes("scripts/services/supabase/feature-flag-guard.js")) {
  errors.push("build-standalone.mjs no incluye el guard de feature flags Supabase.");
}

if (errors.length) {
  console.error("Validacion del shell: ERROR");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Validacion del shell: OK");
console.log(`Menus: ${navigation.menuGroups.length}`);
console.log(`Grupos internos: ${navigation.groups.length}`);
console.log(`Rutas: ${navigation.routes.length}`);
console.log(`Modulos registrados: ${moduleRegistry.modules.length}`);
console.log(`Contratos preparados: ${moduleContracts.contracts.length}`);
