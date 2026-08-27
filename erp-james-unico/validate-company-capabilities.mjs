import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
const context = {
  window: {},
  structuredClone,
  console
};
vm.createContext(context);

vm.runInContext(await read("./scripts/config/company-capabilities.js"), context);
vm.runInContext(await read("./scripts/config/navigation.js"), context);
vm.runInContext(await read("./scripts/config/navigation-tree.js"), context);
const purchasesSource = await read("./scripts/services/purchases.js");
const adminConfigSource = await read("./scripts/services/admin-config.js");
const brandedPrintFiles = [
  "./scripts/modules/comercial/print/invoice-carguera-print.js",
  "./scripts/modules/comercial/print/packing-list-print.js",
  "./scripts/modules/comercial/print/master-packing-print.js",
  "./scripts/modules/comercial/print/hoja-ruta-print.js",
  "./scripts/modules/comercial/print/control-dae-print.js",
  "./scripts/modules/comercial/print/summary-order-print.js"
];
const brandedPrintSources = await Promise.all(brandedPrintFiles.map(read));

const api = context.window.BlessERP.companyCapabilities;
const navigation = context.window.BlessERP.navigation;
const treeApi = context.window.BlessERP.navigationTree;
const { BLESS, IMPERIO } = api.COMPANY_IDS;

assert.equal(api.getCompany(BLESS).commercialName, "Bless Flower");
assert.equal(api.getCompany(IMPERIO).commercialName, "Imperio Flowers");
assert.equal(api.getCompany(IMPERIO).ruc, "1727970137001");
assert.equal(api.getCompany(IMPERIO).sriEnvironment, "PRUEBAS");
assert.equal(api.hasCapability(IMPERIO, "accounting.financials"), true);
assert.equal(api.hasCapability(IMPERIO, "purchases.issueWithholdings"), false);
assert.equal(api.hasCapability(IMPERIO, "payroll.performance"), false);
assert.equal(api.hasCapability(IMPERIO, "payroll.administrative"), true);
assert.equal(api.getCompany(IMPERIO).inventoryPolicy.ownsInventory, false);
assert.equal(api.getCompany(IMPERIO).inventoryPolicy.availabilitySourceCompanyId, BLESS);

[
  "commercial-order-master",
  "commercial-order-history",
  "commercial-availability-reservations",
  "commercial-sri-authorization",
  "accounting-chart",
  "accounting-journal",
  "accounting-ledger",
  "accounting-financials",
  "purchases-upload-xml",
  "purchases-manual",
  "tax-withholdings-received",
  "tax-ats",
  "payroll-generation",
  "portfolios-customers",
  "portfolios-suppliers",
  "banks-accounts"
].forEach(routeId => assert.equal(api.canAccessRoute(IMPERIO, routeId), true, `${routeId} debe estar habilitada para Imperio`));

[
  "operations-postharvest",
  "operations-reception",
  "inventory-summary",
  "purchases-withholdings-issued",
  "reports-inventory",
  "extensions-home"
].forEach(routeId => assert.equal(api.canAccessRoute(IMPERIO, routeId), false, `${routeId} debe estar bloqueada para Imperio`));

const records = treeApi.createMenuRecordsFromLegacyNavigation(navigation);
const imperioRecords = api.filterMenuRecords(records, IMPERIO);
const imperioRoutes = new Set(imperioRecords.filter(item => item.tipo === "pagina").map(item => item.ruta));
assert.equal(imperioRoutes.has("commercial-order-master"), true);
assert.equal(imperioRoutes.has("accounting-financials"), true);
assert.equal(imperioRoutes.has("purchases-withholdings-issued"), false);
assert.equal(imperioRoutes.has("operations-postharvest"), false);
assert.equal(imperioRoutes.has("inventory-summary"), false);
assert.equal(treeApi.validateMenuRecords(imperioRecords).valid, true);

context.window.BlessERP.state = { state: { db: { activeCompanyId: IMPERIO } } };
vm.runInContext(await read("./scripts/services/navigation/menu-service.js"), context);
const visibleThroughMenuService = new Set(
  context.window.BlessERP.menuService.getVisiblePages("Administrador").map(item => item.ruta)
);
assert.equal(visibleThroughMenuService.has("accounting-chart"), true);
assert.equal(visibleThroughMenuService.has("operations-postharvest"), false);
assert.equal(visibleThroughMenuService.has("purchases-withholdings-issued"), false);

const database = {
  meta: {},
  companySettings: {
    legalName: "Lanchimba Tutillo Manuel Clemente",
    commercialName: "Bless Flower",
    ruc: "1717637084001",
    defaultAccounts: { cashGeneral: "1.1.01.01" }
  },
  chartOfAccounts: [{ id: "ACC-1", code: "1", name: "Activos" }],
  journalEntries: [{ id: "JNL-1", entryNumber: "ASI-2026-000001" }],
  documentSequences: [
    { id: "SEQ-FAC-EXPORT", code: "FAC_EXPORT", currentNumber: 12 },
    { id: "SEQ-FAC-LOCAL", code: "FAC_LOCAL", currentNumber: 18 },
    { id: "SEQ-RETE", code: "RETE", currentNumber: 3 },
    { id: "SEQ-ATS", code: "ATS", currentNumber: 1 }
  ],
  costCenters: [
    { id: "CC-ADMIN", code: "ADMIN", type: "administrativo" },
    { id: "CC-CAMPO", code: "CAMPO", type: "produccion" }
  ],
  commercial: {
    orders: [{ id: "ORD-BLESS-1" }],
    customerCatalog: [{ id: "CLI-1", name: "Cliente base" }]
  }
};

api.migrateDatabase(database);
assert.equal(database.activeCompanyId, BLESS);
assert.equal(database.journalEntries[0].companyId, BLESS);
assert.equal(database.companyStores[IMPERIO].journalEntries.length, 0);
assert.equal(database.companyStores[IMPERIO].documentSequences.some(item => item.code === "RETE"), false);
assert.equal(database.companyStores[IMPERIO].documentSequences.some(item => item.code === "FAC"), false);
assert.equal(database.companyStores[IMPERIO].documentSequences.some(item => item.code === "FAC_EXPORT"), true);
assert.equal(database.companyStores[IMPERIO].documentSequences.some(item => item.code === "FAC_LOCAL"), true);
assert.equal(database.companyStores[IMPERIO].commercial.orders.length, 0);
assert.equal(database.companyStores[BLESS].commercial.customerCatalog.length, 1);
assert.equal(database.companyStores[IMPERIO].commercial.customerCatalog.length, 0);

database.journalEntries.push({ id: "JNL-BLESS-2" });
api.captureActiveStore(database);
api.applyActiveStore(database, IMPERIO);
assert.equal(database.journalEntries.length, 0);
database.journalEntries.push({ id: "JNL-IMPERIO-1" });
api.captureActiveStore(database);
api.applyActiveStore(database, BLESS);
assert.equal(database.journalEntries.some(item => item.id === "JNL-BLESS-2"), true);
assert.equal(database.journalEntries.some(item => item.id === "JNL-IMPERIO-1"), false);
assert.equal(database.companyStores[IMPERIO].journalEntries[0].companyId, IMPERIO);

context.window.BlessERP.utils = { clone: structuredClone };
context.window.BlessERP.state = {
  state: { db: database },
  saveDb() {
    api.captureActiveStore(this.state.db);
  },
  refreshNavigationAccess() {},
  currentRoute() {
    return { id: "dashboard-home" };
  }
};
vm.runInContext(await read("./scripts/services/company-context.js"), context);
vm.runInContext(await read("./scripts/services/company-branding.js"), context);
const companyContext = context.window.BlessERP.services.companyContext;
const companyBranding = context.window.BlessERP.services.companyBranding;
assert.equal(companyContext.activeCompanyId(), BLESS);
assert.equal(companyBranding.resolve(BLESS).logoPath, "scripts/assets/bless-flower-logo-official-transparent.png");
assert.equal(companyBranding.resolve(IMPERIO).logoPath, "scripts/assets/imperio-flowers-logo.png");
assert.equal(companyBranding.resolveForOrder({ sellerCompanyId: IMPERIO }).ruc, "1727970137001");
const switched = companyContext.setActiveCompany(IMPERIO);
assert.equal(switched.ok, true);
assert.equal(companyContext.activeCompanyId(), IMPERIO);
assert.equal(companyContext.inventoryPolicy().ownsInventory, false);
assert.equal(companyContext.payrollPolicy().operationalPerformance, false);
assert.equal(companyContext.availabilitySourceCompanyId(), BLESS);
companyContext.setActiveCompany(BLESS);
assert.equal(companyContext.activeCompanyId(), BLESS);

const serializedProfiles = JSON.stringify(api.COMPANY_PROFILES).toLowerCase();
assert.equal(serializedProfiles.includes("password"), false);
assert.equal(serializedProfiles.includes("clave"), false);
assert.equal(serializedProfiles.includes(".p12"), false);
assert.match(purchasesSource, /companyAllows\("purchases\.issueWithholdings"\)/);
assert.match(purchasesSource, /companyAllows\("inventory\.materials"\)/);
assert.match(purchasesSource, /La empresa activa no emite retenciones/);
assert.match(adminConfigSource, /sequenceAllowed/);
assert.match(adminConfigSource, /purchases\.issueWithholdings/);
assert.match(adminConfigSource, /inventory\.materials/);
brandedPrintSources.forEach((source, index) => {
  assert.match(source, /renderCompanyBrand\(company/, `${brandedPrintFiles[index]} debe imprimir la marca de la empresa emisora`);
});

const sharedLocalValues = new Map();
const createWebStorage = values => ({
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  }
});
const baseTabDatabase = () => ({
  meta: {},
  session: { activeUser: { name: "Validador", role: "Administrador" }, alerts: [] },
  companySettings: { commercialName: "Bless Flower" },
  commercial: { orders: [] },
  operations: {},
  journalEntries: []
});
const createTabContext = async search => {
  const localStorage = createWebStorage(sharedLocalValues);
  const sessionValues = new Map();
  const sessionStorage = createWebStorage(sessionValues);
  const events = [];
  const href = `https://erp.local/index.html${search}`;
  const tabContext = {
    window: {
      BlessERP: {
        demo: {
          createDemoDatabase: () => structuredClone(baseTabDatabase()),
          createInitialDatabase: () => structuredClone(baseTabDatabase())
        },
        accountingRules: { migrateDatabase: db => db }
      },
      location: { href, search, hostname: "erp.local" },
      history: { replaceState() {} },
      dispatchEvent(event) {
        events.push(event);
      }
    },
    localStorage,
    sessionStorage,
    URL,
    URLSearchParams,
    structuredClone,
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    console
  };
  vm.createContext(tabContext);
  vm.runInContext(await read("./scripts/core/storage.js"), tabContext);
  vm.runInContext(await read("./scripts/config/company-capabilities.js"), tabContext);
  return { context: tabContext, events, sessionValues };
};

sharedLocalValues.clear();
const blessTab = await createTabContext("?company=COMP-BLESS-FLOWER");
const imperioTab = await createTabContext("?company=COMP-IMPERIO-FLOWERS");
const blessTabStorage = blessTab.context.window.BlessERP.storage;
const imperioTabStorage = imperioTab.context.window.BlessERP.storage;
const blessTabDb = blessTabStorage.load();
const imperioTabDb = imperioTabStorage.load();
assert.equal(blessTabDb.activeCompanyId, BLESS);
assert.equal(imperioTabDb.activeCompanyId, IMPERIO);
blessTabDb.journalEntries.push({ id: "JNL-TAB-BLESS" });
assert.equal(blessTabStorage.save(blessTabDb), true);
imperioTabDb.journalEntries.push({ id: "JNL-TAB-IMPERIO" });
assert.equal(imperioTabStorage.save(imperioTabDb), true);
const mergedTabDb = blessTabStorage.load();
assert.equal(mergedTabDb.companyStores[BLESS].journalEntries.some(item => item.id === "JNL-TAB-BLESS"), true);
assert.equal(mergedTabDb.companyStores[IMPERIO].journalEntries.some(item => item.id === "JNL-TAB-IMPERIO"), true);
blessTabStorage.saveUi({ currentRoute: "accounting-journal" });
imperioTabStorage.saveUi({ currentRoute: "commercial-panel" });
assert.equal(blessTabStorage.loadUi().currentRoute, "accounting-journal");
assert.equal(imperioTabStorage.loadUi().currentRoute, "commercial-panel");

const conflictTabA = await createTabContext("?company=COMP-BLESS-FLOWER");
const conflictTabB = await createTabContext("?company=COMP-BLESS-FLOWER");
const conflictDbA = conflictTabA.context.window.BlessERP.storage.load();
const conflictDbB = conflictTabB.context.window.BlessERP.storage.load();
conflictDbA.journalEntries.push({ id: "JNL-CONFLICT-A" });
assert.equal(conflictTabA.context.window.BlessERP.storage.save(conflictDbA), true);
conflictDbB.journalEntries.push({ id: "JNL-CONFLICT-B" });
assert.equal(conflictTabB.context.window.BlessERP.storage.save(conflictDbB), true);
assert.equal(conflictTabB.events.some(event => event.type === "erp:storage-reconciled"), true);

console.log("Validacion multiempresa/capacidades: OK");
console.log(`Empresas: ${api.listCompanies().map(item => item.commercialName).join(" / ")}`);
console.log(`Rutas visibles Imperio: ${imperioRoutes.size}`);
console.log("Aislamiento por companyId y cambio de empresa: OK");
console.log("Pestanas separadas, merge por empresa y conflicto controlado: OK");
console.log("Identidad y logo dinamicos en impresiones: OK");
