import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
const BLESS = "COMP-BLESS-FLOWER";
const IMPERIO = "COMP-IMPERIO-FLOWERS";
let persisted = 0;

const context = vm.createContext({
  console,
  Date,
  Intl,
  Math,
  JSON,
  Map,
  Set,
  Blob,
  URL,
  URLSearchParams,
  Uint8Array,
  TextEncoder,
  TextDecoder,
  structuredClone,
  atob,
  btoa,
  setTimeout,
  window: {
    BlessERP: {
      utils: {
        clone: value => structuredClone(value)
      }
    }
  }
});
context.window.window = context.window;

vm.runInContext(await read("./scripts/config/company-capabilities.js"), context, {
  filename: "company-capabilities.js"
});

const ERP = context.window.BlessERP;
ERP.comercialData = {
  createCustomer(seed = {}) {
    const companyId = seed.companyId || seed.company_id || BLESS;
    return { status: "ACTIVO", country: "ECUADOR", ...seed, companyId, company_id: companyId };
  },
  createBrand(seed = {}) {
    const companyId = seed.companyId || seed.company_id || BLESS;
    const name = seed.finalClientName || seed.name || "";
    return { status: "ACTIVO", ...seed, name, finalClientName: name, companyId, company_id: companyId };
  },
  createDae(seed = {}) {
    const companyId = seed.companyId || seed.company_id || BLESS;
    return { status: "ACTIVA", customerIds: [], ...seed, companyId, company_id: companyId };
  },
  createCommercialStore() {
    return {
      orders: [],
      preorders: [],
      reservations: [],
      customerCatalog: [],
      brandCatalog: [],
      daeCatalog: [],
      agencyCatalog: [],
      airlineCatalog: [],
      countryCatalog: [],
      destinationCatalog: [],
      ui: {}
    };
  }
};
ERP.payrollData = {
  createPayrollStore(companyId) {
    return {
      schema_version: 1,
      default_company_id: companyId,
      employees: [],
      rate_rules: [],
      hour_entries: [],
      performance_entries: [],
      obligation_settings: [],
      parameters_by_company: []
    };
  }
};

const db = {
  activeCompanyId: BLESS,
  meta: {},
  session: {
    activeUser: { id: "USR-IMP-005", name: "Administracion Imperio", role: "Administrador / Contador" },
    alerts: []
  },
  visualUsers: [],
  companySettings: {
    companyId: BLESS,
    company_id: BLESS,
    legalName: "MANUEL CLEMENTE LANCHIMBA TUTILLO",
    commercialName: "Bless Flower",
    ruc: "1717637084001"
  },
  providers: [],
  commercial: ERP.comercialData.createCommercialStore(),
  operations: {
    catalogs: {
      suppliers: ["FINCA CANGAHUA"],
      blocks: ["BQ-01"],
      varieties: ["EXPLORER"]
    },
    availabilityDemo: [],
    roseInventory: []
  },
  payroll: ERP.payrollData.createPayrollStore(BLESS),
  documentSequences: [
    { id: "SEQ-FAC-EXPORT", code: "FAC_EXPORT", currentNumber: 10 },
    { id: "SEQ-FAC-LOCAL", code: "FAC_LOCAL", currentNumber: 10 }
  ]
};
ERP.state = { state: { db } };
ERP.storage = {
  save() {
    persisted += 1;
    return true;
  }
};

vm.runInContext(await read("./scripts/services/exercise-seeds.js"), context, {
  filename: "exercise-seeds.js"
});

const seeds = ERP.exerciseSeeds;
const firstSeedState = db.companyStores;
assert.ok(firstSeedState[BLESS], "Debe existir el almacen independiente de Bless");
assert.ok(firstSeedState[IMPERIO], "Debe existir el almacen independiente de Imperio");
assert.ok(persisted >= 1, "Los datos nuevos deben persistirse localmente");

let blessStore = firstSeedState[BLESS];
let imperioStore = firstSeedState[IMPERIO];
const imperioUser = db.visualUsers.find(user => user.id === "USR-IMP-005");
assert.equal(imperioUser.companyAccess[BLESS].enabled, false, "El usuario de Imperio no debe entrar a Bless");
assert.equal(imperioUser.companyAccess[IMPERIO].enabled, true, "El usuario de Imperio debe poder entrar a Imperio");

for (const [label, store] of [["Bless", blessStore], ["Imperio", imperioStore]]) {
  assert.ok(store.providers.length >= 5, `${label} debe tener al menos cinco proveedores de ejercicio`);
  assert.ok(store.commercial.customerCatalog.length >= 5, `${label} debe tener al menos cinco clientes`);
  assert.ok(store.commercial.brandCatalog.length >= 5, `${label} debe tener al menos cinco marcas`);
  assert.ok(store.commercial.daeCatalog.length >= 5, `${label} debe tener al menos cinco DAE`);
}
assert.ok(imperioStore.payroll.employees.length >= 5, "Imperio debe tener cinco trabajadores administrativos");
assert.ok(
  imperioStore.payroll.employees.every(employee => employee.area === "ADMINISTRATIVA"),
  "El personal predeterminado de Imperio debe ser exclusivamente administrativo"
);
assert.ok(
  imperioStore.payroll.employees.some(employee => employee.seller_id === "SELL-IMP-001"),
  "Imperio debe tener un responsable comercial seleccionable sin activar comisiones"
);
assert.equal(
  imperioStore.commercial.sharedCatalogSourceCompanyId,
  BLESS,
  "Los catalogos florales de Imperio deben referenciar a Bless"
);
assert.ok(imperioStore.commercial.blockReferenceCatalog.length >= 5);
assert.ok(imperioStore.commercial.varietyReferenceCatalog.length >= 5);
assert.equal(
  Object.keys(imperioStore.operations || {}).length,
  0,
  "Las semillas no deben crear inventario operativo propio para Imperio"
);
assert.equal(seeds.ensureAll({ db, persist: false }).added, 0, "La migracion de ejercicios debe ser idempotente");
blessStore = db.companyStores[BLESS];
imperioStore = db.companyStores[IMPERIO];

blessStore.operations.availabilityDemo = [{
  id: "AVL-EXPLORER-60",
  supplier: "FINCA CANGAHUA",
  block: "BQ-01",
  variety: "EXPLORER",
  length: 60
}];

function orderFor(companyId, id, customerId, brandId, unitPrice, costSeed) {
  return {
    id,
    number: `PED-${id}`,
    companyId,
    company_id: companyId,
    sellingCompanyId: companyId,
    status: "COMPLETADO",
    issuedAt: "2026-07-20",
    dispatchedAt: "2026-07-22",
    customerId,
    brandId,
    destinationCountry: "USA",
    destination: "MIAMI",
    seller_id: companyId === BLESS ? "SELL-BLF-001" : "SELL-IMP-001",
    seller_name: companyId === BLESS ? "Vendedor Bless" : "Coordinacion Comercial Imperio",
    transportType: "AEREO",
    sriDaeNumber: companyId === BLESS ? "055-BLF-TEST" : "055-IMP-TEST",
    sriInvoiceNumber: companyId === BLESS ? "001-001-000000101" : "001-001-000000201",
    sriAuthorizationStatus: "AUTORIZADO",
    currency: "USD",
    lines: [{
      id: `LINE-${id}`,
      boxNumber: 1,
      boxType: "HB",
      variety: "EXPLORER",
      length: 60,
      bunches: 12,
      stemsPerBunch: 25,
      unitPrice,
      reservationSourceId: "AVL-EXPLORER-60",
      scannedBunches: [],
      ...costSeed
    }]
  };
}

const blessCustomer = blessStore.commercial.customerCatalog[0];
const blessBrand = blessStore.commercial.brandCatalog.find(item => item.customerId === blessCustomer.id)
  || blessStore.commercial.brandCatalog[0];
const imperioCustomer = imperioStore.commercial.customerCatalog.find(item => item.id === "customer-imperio-01");
const imperioBrand = imperioStore.commercial.brandCatalog.find(item => item.id === "brand-imperio-01");
blessStore.commercial.orders = [
  orderFor(BLESS, "BLF-TEST-001", blessCustomer.id, blessBrand.id, 0.55, { costPerStem: 0.31 })
];
imperioStore.commercial.orders = [
  orderFor(IMPERIO, "IMP-TEST-001", imperioCustomer.id, imperioBrand.id, 0.62, {
    providerCostPerStem: 0.42
  })
];

ERP.comercialIntercompany = {
  getCommercialStore(appState, companyId) {
    return appState.db.companyStores[companyId].commercial;
  },
  getAvailabilitySourceState(appState) {
    return { db: { operations: appState.db.companyStores[BLESS].operations } };
  },
  getSettlements() {
    return [];
  }
};
ERP.comercialUtils = {
  getOrderMetrics(order) {
    return {
      lines: (order.lines || []).map(line => ({
        ...line,
        totalStems: Number(line.bunches || 0) * Number(line.stemsPerBunch || 0)
      }))
    };
  }
};

vm.runInContext(await read("./scripts/modules/operaciones/ramos-report-xlsx.js"), context, {
  filename: "ramos-report-xlsx.js"
});
vm.runInContext(await read("./scripts/modules/comercial/commercial-profitability-report-xlsx.js"), context, {
  filename: "commercial-profitability-report-xlsx.js"
});

const reportApi = ERP.comercialProfitabilityReportXlsx;
const appState = { db };
const blessReport = reportApi.buildReport(appState, { companyId: BLESS });
const imperioReport = reportApi.buildReport(appState, { companyId: IMPERIO });
assert.equal(blessReport.validation.ok, true);
assert.equal(imperioReport.validation.ok, true);
assert.equal(blessReport.orders.length, 1);
assert.equal(imperioReport.orders.length, 1);
assert.ok(blessReport.rows.every(row => row.companyId === BLESS), "El XLSX Bless no debe mezclar pedidos Imperio");
assert.ok(imperioReport.rows.every(row => row.companyId === IMPERIO), "El XLSX Imperio no debe mezclar pedidos Bless");
assert.equal(blessReport.rows[0].inventory.suppliers, "FINCA CANGAHUA");
assert.equal(blessReport.rows[0].inventory.blocks, "BQ-01");
assert.equal(blessReport.rows[0].grossMargin, 72);
assert.equal(imperioReport.rows[0].grossMargin, 60);
assert.equal(imperioReport.rows[0].costSource, "COSTO PROVEEDOR");

const requiredDetailHeaders = [
  "Pedido",
  "Fecha venta / salida",
  "Cliente",
  "Pais",
  "Vendedor",
  "Variedad",
  "Medida cm",
  "Precio venta por tallo",
  "Venta total",
  "Costo total",
  "Margen bruto",
  "Margen %",
  "Proveedor",
  "Bloque"
];
const detailSheet = reportApi.buildSheets(imperioReport).find(sheet => sheet.name === "Detalle comercial");
requiredDetailHeaders.forEach(header => assert.ok(detailSheet.headers.includes(header), `Falta la columna ${header}`));

const onePixelPng = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), char => char.charCodeAt(0));
const blessExport = await reportApi.exportXlsx(appState, { companyId: BLESS, download: false, logoBytes: onePixelPng });
const imperioExport = await reportApi.exportXlsx(appState, { companyId: IMPERIO, download: false, logoBytes: onePixelPng });
assert.equal(blessExport.ok, true);
assert.equal(imperioExport.ok, true);
assert.match(blessExport.fileName, /rentabilidad-comercial-bless/);
assert.match(imperioExport.fileName, /rentabilidad-comercial-imperio/);
assert.equal(String.fromCharCode(...blessExport.archive.slice(0, 2)), "PK", "Bless debe generar un XLSX real");
assert.equal(String.fromCharCode(...imperioExport.archive.slice(0, 2)), "PK", "Imperio debe generar un XLSX real");
const blessArchiveText = new TextDecoder().decode(blessExport.archive);
const imperioArchiveText = new TextDecoder().decode(imperioExport.archive);
assert.match(blessArchiveText, /FF166534/, "El XLSX Bless debe usar identidad verde");
assert.match(imperioArchiveText, /FF0B63CE/, "El XLSX Imperio debe usar identidad azul");
assert.match(imperioArchiveText, /Imperio Flowers/i, "El XLSX Imperio debe identificar su propia empresa");

const [
  sriApiSource,
  sriPageSource,
  companyContextSource,
  layoutSource,
  stylesSource,
  historySource,
  indexSource
] = await Promise.all([
  read("./scripts/services/sri/sri-api-client.js"),
  read("./scripts/modules/comercial/sri-authorization.js"),
  read("./scripts/services/company-context.js"),
  read("./scripts/ui/layout.js"),
  read("./styles.css"),
  read("./scripts/modules/comercial/pedidos-historial.js"),
  read("./index.html")
]);

const sriSession = new Map();
const sriContext = vm.createContext({
  console,
  Map,
  Set,
  URL,
  URLSearchParams,
  window: {
    BlessERP: {},
    sessionStorage: {
      getItem(key) {
        return sriSession.has(key) ? sriSession.get(key) : null;
      },
      setItem(key, value) {
        sriSession.set(key, String(value));
      }
    }
  }
});
vm.runInContext(sriApiSource, sriContext, { filename: "sri-api-client.js" });
const sriApi = sriContext.window.BlessERP.sriApi;
assert.equal(sriApi.companyProfiles().length, 2);
assert.equal(sriApi.companyIdentity("BLESS_FLOWER").ruc, "1717637084001");
assert.equal(sriApi.companyIdentity("IMPERIO_FLOWERS").ruc, "1727970137001");
assert.equal(sriApi.companyKeyForReference(IMPERIO), "IMPERIO_FLOWERS");
assert.equal(sriApi.selectCompany("IMPERIO_FLOWERS").key, "IMPERIO_FLOWERS");
assert.equal(sriApi.activeCompanyKey(), "IMPERIO_FLOWERS");

assert.match(sriPageSource, /syncWorkspaceCompany/, "La pantalla SRI debe fijarse a la empresa de la pestaña");
assert.match(sriPageSource, /Fijada por la pestaña y el permiso del usuario/);
assert.doesNotMatch(sriPageSource, /data-sri-company/, "No debe existir selector que mezcle emisores SRI");
assert.match(companyContextSource, /COMPANY_ACCESS_DENIED/, "El cambio de empresa debe validar la membresia");
assert.match(companyContextSource, /canCurrentUserAccessCompany/, "La URL de la otra empresa debe validar permisos");
assert.match(layoutSource, /target-bless/);
assert.match(layoutSource, /target-imperio/);
assert.match(stylesSource, /body\[data-company-id="COMP-BLESS-FLOWER"\]/);
assert.match(stylesSource, /body\[data-company-id="COMP-IMPERIO-FLOWERS"\]/);
assert.match(stylesSource, /--company-accent:#16803a/);
assert.match(stylesSource, /--company-accent:#0b63ce/);
assert.doesNotMatch(historySource, /data-commercial-history-export-xlsx/, "Rentabilidad no debe sobrecargar Historial");
assert.match(indexSource, /reportes-comerciales\.js/);
assert.match(historySource, /url\.searchParams\.set\("company", companyId\)/, "Historial debe conservar Imperio al abrir un pedido en otra pestaña");
assert.match(historySource, /url\.searchParams\.set\("order", orderId\)/, "Historial debe enviar el pedido seleccionado a la nueva pestaña");
assert.match(indexSource, /commercial-profitability-report-xlsx\.js/);
assert.doesNotMatch(indexSource, /exercise-seeds\.js/, "Producción no debe cargar datos de ejercicio como fuente empresarial");

console.log("Multiempresa comercial: OK");
console.log("Acceso por permiso, temas verde/azul y pestañas independientes: OK");
console.log("SRI y secuenciales separados por empresa: OK");
console.log("XLSX de rentabilidad Bless/Imperio con costos, margen, proveedor y bloque: OK");
console.log("Sin datos de ejercicio y sin inventario propio en Imperio: OK");
