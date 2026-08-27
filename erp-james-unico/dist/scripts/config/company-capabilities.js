(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const COMPANY_IDS = Object.freeze({
    BLESS: "COMP-BLESS-FLOWER",
    IMPERIO: "COMP-IMPERIO-FLOWERS"
  });

  const SCOPED_ROOT_KEYS = Object.freeze([
    "companySettings",
    "chartOfAccounts",
    "journalEntries",
    "providers",
    "taxParameters",
    "retentionParameters",
    "taxSupports",
    "purchaseTypes",
    "purchaseMemory",
    "documentSequences",
    "costCenters",
    "auditLogs",
    "purchases",
    "purchasePayables",
    "issuedWithholdings",
    "payments",
    "paymentBatches",
    "bankAccounts",
    "bankMovements",
    "bankStatementMovements",
    "bankReconciliations",
    "customers",
    "customerReceivables",
    "collections",
    "collectionBatches",
    "receivedWithholdings",
    "inventoryWarehouses",
    "inventoryItems",
    "inventoryMovements",
    "inventoryResponsibles",
    "sales",
    "commercial",
    "operations",
    "payroll",
    "atsConfig",
    "atsHistory"
  ]);

  const IMPERIO_SEQUENCE_CODES = Object.freeze([
    "FAC_EXPORT",
    "FAC_LOCAL",
    "NC_EXPORT",
    "NC_LOCAL",
    "ASI",
    "COM",
    "RETR",
    "PAGO",
    "COBRO",
    "BAN",
    "CONC",
    "ATS"
  ]);

  const COMPANY_PROFILES = Object.freeze({
    [COMPANY_IDS.BLESS]: Object.freeze({
      id: COMPANY_IDS.BLESS,
      code: "BLESS",
      legalName: "Lanchimba Tutillo Manuel Clemente",
      commercialName: "Bless Flower",
      originCountryAlpha2: "EC",
      ruc: "1717637084001",
      habitualExporterLegend: "EXPORTADOR HABITUAL DE BIENES",
      sriDeliveryGuidesEnabled: false,
        logoPath: "scripts/assets/bless-flower-logo-official-transparent.png",
      status: "ACTIVA",
      sriEnvironment: "PRUEBAS",
      accountingMode: "COMPLETA",
      capabilities: Object.freeze({ "*": true }),
      inventoryPolicy: Object.freeze({
        ownsInventory: true,
        availabilitySourceCompanyId: COMPANY_IDS.BLESS,
        mayCommitSharedAvailability: true
      }),
      payrollPolicy: Object.freeze({
        administrative: true,
        salesCommissions: true,
        operationalPerformance: true
      })
    }),
    [COMPANY_IDS.IMPERIO]: Object.freeze({
      id: COMPANY_IDS.IMPERIO,
      code: "IMPERIO",
      legalName: "Lanchimba Tipanluisa Sandy Anahi",
      commercialName: "Imperio Flowers",
      originCountryAlpha2: "EC",
      ruc: "1727970137001",
      sriDeliveryGuidesEnabled: false,
      taxpayerType: "PERSONA_NATURAL",
      taxRegime: "GENERAL",
      accountingRequired: false,
      withholdingAgent: false,
      specialTaxpayer: false,
      province: "PICHINCHA",
      canton: "CAYAMBE",
      parish: "CANGAHUA",
      matrixAddress: "Calle 3 de Noviembre, lote 4 e interseccion Cachicungo, a dos cuadras de la cancha comunal Carrera",
      phone: "0987694901",
      email: "imperioflower@gmail.com",
      logoPath: "scripts/assets/imperio-flowers-logo.png",
      status: "ACTIVA",
      sriEnvironment: "PRUEBAS",
      accountingMode: "BASICA_COMERCIALIZADORA",
      capabilities: Object.freeze({
        "core.access": true,
        "commercial.exports": true,
        "commercial.sri.test": true,
        "commercial.sharedAvailability": true,
        "commercial.commitBlessAvailability": true,
        "accounting.chart": true,
        "accounting.journal": true,
        "accounting.ledger": true,
        "accounting.financials": true,
        "purchases.xml": true,
        "purchases.manage": true,
        "purchases.manual": true,
        "purchases.taxSupports": true,
        "purchases.issueWithholdings": false,
        "portfolio.suppliers": true,
        "portfolio.customers": true,
        "portfolio.payables": true,
        "portfolio.receivables": true,
        "portfolio.payments": true,
        "portfolio.collections": true,
        "banks.accounts": true,
        "banks.movements": true,
        "banks.reconciliation": true,
        "tax.parameters": true,
        "tax.retentionParameters": true,
        "tax.receivedWithholdings": true,
        "tax.ats": true,
        "payroll.administrative": true,
        "payroll.performance": false,
        "payroll.salesCommissions": false,
        "reports.executive": true,
        "reports.accounting": true,
        "reports.tax": true,
        "reports.portfolio": true,
        "reports.banks": true,
        "reports.commercial": true,
        "settings.manage": true,
        "operations.postharvest": false,
        "inventory.materials": false,
        "extensions.access": false
      }),
      inventoryPolicy: Object.freeze({
        ownsInventory: false,
        availabilitySourceCompanyId: COMPANY_IDS.BLESS,
        mayCommitSharedAvailability: true
      }),
      payrollPolicy: Object.freeze({
        administrative: true,
        salesCommissions: false,
        operationalPerformance: false
      })
    })
  });

  const ROUTE_CAPABILITIES = Object.freeze({
    "dashboard-home": "core.access",
    "core-diagnostics": "core.access",

    "commercial-panel": "commercial.exports",
    "commercial-orders-day": "commercial.exports",
    "commercial-preorders": "commercial.exports",
    "commercial-order-master": "commercial.exports",
    "commercial-order-detail": "commercial.exports",
    "commercial-order-coordination": "commercial.exports",
    "commercial-export-shipments": "commercial.exports",
    "commercial-order-history": "commercial.exports",
    "commercial-customers-brands": "commercial.exports",
    "commercial-brands": "commercial.exports",
    "commercial-availability-reservations": "commercial.sharedAvailability",
    "commercial-cargo-agencies": "commercial.exports",
    "commercial-countries": "commercial.exports",
    "commercial-destinations": "commercial.exports",
    "commercial-daes": "commercial.exports",
    "commercial-airlines": "commercial.exports",
    "commercial-export-products": "commercial.exports",
    "commercial-box-types": "commercial.exports",
    "commercial-sri-authorization": "commercial.sri.test",
    "commercial-credit-notes": "commercial.sri.test",
    "commercial-senae-liquidation": "commercial.sri.test",

    "payroll-employees": "payroll.administrative",
    "payroll-generation": "payroll.administrative",
    "payroll-approved": "payroll.administrative",

    "accounting-chart": "accounting.chart",
    "accounting-sales": "accounting.journal",
    "accounting-journal": "accounting.journal",
    "accounting-ledger": "accounting.ledger",
    "accounting-financials": "accounting.financials",

    "purchases-upload-xml": "purchases.xml",
    "purchases-providers": "portfolio.suppliers",
    "purchases-invoices": "purchases.manage",
    "purchases-manual": "purchases.manual",
    "purchases-withholdings-issued": "purchases.issueWithholdings",
    "purchases-retention-report": "purchases.manage",
    "purchases-tax-supports": "purchases.taxSupports",

    "portfolios-suppliers": "portfolio.suppliers",
    "portfolios-customers": "portfolio.customers",
    "portfolios-ap": "portfolio.payables",
    "portfolios-ar": "portfolio.receivables",
    "portfolios-payments-single": "portfolio.payments",
    "portfolios-payments-bulk": "portfolio.payments",
    "portfolios-collections-single": "portfolio.collections",
    "portfolios-collections-bulk": "portfolio.collections",

    "banks-accounts": "banks.accounts",
    "banks-movements": "banks.movements",
    "banks-reconciliation": "banks.reconciliation",
    "banks-cash": "banks.accounts",
    "banks-transfers": "banks.movements",
    "banks-cash-flow": "banks.movements",

    "tax-parameters": "tax.parameters",
    "tax-retention-parameters": "tax.retentionParameters",
    "tax-withholdings-received": "tax.receivedWithholdings",
    "tax-ats": "tax.ats",

    "reports-dashboard": "reports.executive",
    "reports-accounting": "reports.accounting",
    "reports-tax": "reports.tax",
    "reports-portfolio": "reports.portfolio",
    "reports-banks": "reports.banks",
    "settings-company": "settings.manage",
    "settings-users": "settings.manage",
    "settings-audit": "settings.manage",
    "settings-sequences": "settings.manage",
    "settings-cost-centers": "settings.manage"
    ,"settings-synchronization": "settings.manage"
  });

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function companyIdOf(value, fallback = COMPANY_IDS.BLESS) {
    const candidate = String(value || "").trim();
    return COMPANY_PROFILES[candidate] ? candidate : fallback;
  }

  function getCompany(companyId) {
    const profile = COMPANY_PROFILES[companyIdOf(companyId)];
    return clone(profile);
  }

  function listCompanies() {
    return Object.values(COMPANY_PROFILES).map(clone);
  }

  function hasCapability(companyId, capability) {
    const profile = COMPANY_PROFILES[companyIdOf(companyId)];
    if (!profile || profile.status !== "ACTIVA") return false;
    if (profile.capabilities["*"] === true) return true;
    return profile.capabilities[String(capability || "")] === true;
  }

  function requiredCapabilityForRoute(routeId) {
    const id = String(routeId || "");
    if (ROUTE_CAPABILITIES[id]) return ROUTE_CAPABILITIES[id];
    if (id.startsWith("operations-")) return "operations.postharvest";
    if (id.startsWith("inventory-")) return "inventory.materials";
    if (id.startsWith("extensions-")) return "extensions.access";
    return "";
  }

  function canAccessRoute(companyId, routeId) {
    const profile = COMPANY_PROFILES[companyIdOf(companyId)];
    if (profile?.capabilities?.["*"] === true) return true;
    const required = requiredCapabilityForRoute(routeId);
    return Boolean(required) && hasCapability(companyId, required);
  }

  function filterMenuRecords(records, companyId) {
    const rows = Array.isArray(records) ? records : [];
    const allowedIds = new Set(
      rows
        .filter(item => item?.tipo === "pagina" && canAccessRoute(companyId, item.ruta))
        .map(item => item.id)
    );
    const rowMap = new Map(rows.map(item => [item.id, item]));
    [...allowedIds].forEach(id => {
      let current = rowMap.get(id);
      while (current?.parentId && rowMap.has(current.parentId)) {
        allowedIds.add(current.parentId);
        current = rowMap.get(current.parentId);
      }
    });
    return rows
      .filter(item => allowedIds.has(item.id))
      .map(item => ({
        ...item,
        permisos: Array.isArray(item.permisos) ? [...item.permisos] : [],
        metadata: {
          ...(item.metadata || {}),
          companyCapability: item.tipo === "pagina" ? requiredCapabilityForRoute(item.ruta) : ""
        }
      }));
  }

  function stampEntityArrays(value, companyId) {
    if (Array.isArray(value)) {
      return value.map(item => {
        if (!item || typeof item !== "object") return item;
        const stamped = {
          ...clone(item),
          companyId,
          company_id: companyId
        };
        Object.keys(stamped).forEach(key => {
          if (Array.isArray(stamped[key])) stamped[key] = stampEntityArrays(stamped[key], companyId);
        });
        return stamped;
      });
    }
    if (!value || typeof value !== "object") return clone(value);
    const result = clone(value);
    Object.keys(result).forEach(key => {
      if (Array.isArray(result[key])) result[key] = stampEntityArrays(result[key], companyId);
      else if (result[key] && typeof result[key] === "object") result[key] = stampEntityArrays(result[key], companyId);
    });
    return result;
  }

  function normalizeScopedValue(key, value, companyId) {
    if (Array.isArray(value)) return stampEntityArrays(value, companyId);
    if (!value || typeof value !== "object") return clone(value);
    const normalized = stampEntityArrays(value, companyId);
    if (key === "companySettings" || key === "atsConfig") {
      normalized.companyId = companyId;
      normalized.company_id = companyId;
    }
    if (key === "payroll") {
      normalized.default_company_id = companyId;
    }
    return normalized;
  }

  function emptyValueForKey(key) {
    if (["companySettings", "commercial", "operations", "payroll", "atsConfig"].includes(key)) return {};
    return [];
  }

  function createImperioSettings(blessSettings = {}) {
    return {
      ...clone(blessSettings || {}),
      companyId: COMPANY_IDS.IMPERIO,
      company_id: COMPANY_IDS.IMPERIO,
      ruc: "1727970137001",
      legalName: "Lanchimba Tipanluisa Sandy Anahi",
      commercialName: "Imperio Flowers",
      email: "imperioflower@gmail.com",
      phone: "0987694901",
      matrixAddress: "Calle 3 de Noviembre, lote 4 e interseccion Cachicungo, a dos cuadras de la cancha comunal Carrera, Cangahua, Cayambe, Pichincha",
      branchAddress: "Calle 3 de Noviembre, lote 4 e interseccion Cachicungo, a dos cuadras de la cancha comunal Carrera, Cangahua, Cayambe, Pichincha",
      province: "Pichincha",
      canton: "Cayambe",
      parish: "Cangahua",
      taxpayerType: "Persona natural",
      accountingRequired: "No",
      taxRegime: "General",
      withholdingAgent: "No",
      specialTaxpayer: "No",
      taxRegistrationDate: "2025-06-16",
      vatDeclarationFrequency: "Semestral",
      sriEnvironment: "Pruebas",
      mainEstablishment: "001",
      mainEmissionPoint: "001"
    };
  }

  function createImperioSequences(blessSequences = []) {
    return (Array.isArray(blessSequences) ? blessSequences : [])
      .filter(item => IMPERIO_SEQUENCE_CODES.includes(String(item.code || "").toUpperCase()))
      .map(item => ({
        ...clone(item),
        id: `${String(item.id || item.code || "SEQ")}-IMP`,
        currentNumber: 0,
        establishmentCode: ["FAC_EXPORT", "FAC_LOCAL", "NC_EXPORT", "NC_LOCAL"].includes(String(item.code || "").toUpperCase()) ? "001" : (item.establishmentCode || ""),
        emissionPointCode: ["FAC_EXPORT", "NC_EXPORT"].includes(String(item.code || "").toUpperCase())
          ? "001"
          : ["FAC_LOCAL", "NC_LOCAL"].includes(String(item.code || "").toUpperCase())
            ? "002"
            : (item.emissionPointCode || ""),
        configurationStatus: ["FAC_EXPORT", "FAC_LOCAL", "NC_EXPORT", "NC_LOCAL"].includes(String(item.code || "").toUpperCase()) ? "PENDIENTE_CONFIRMACION" : (item.configurationStatus || ""),
        companyId: COMPANY_IDS.IMPERIO,
        company_id: COMPANY_IDS.IMPERIO
      }));
  }

  function createImperioCommercialStore(blessCommercial = {}) {
    const source = clone(blessCommercial || {});
    return {
      ...source,
      orders: [],
      preorders: [],
      reservations: [],
      customerCatalog: [],
      brandCatalog: [],
      daeCatalog: [],
      ui: {
        ...(source.ui || {}),
        currentOrderId: "",
        currentPreorderId: "",
        selectedCustomerId: "",
        selectedBrandId: "",
        selectedDaeId: "",
        customerDraft: {},
        brandDraft: {},
        daeDraft: {},
        notice: "",
        noticeTone: "info"
      }
    };
  }

  function createImperioPayrollStore() {
    return {
      schema_version: 3,
      default_company_id: COMPANY_IDS.IMPERIO,
      employees: [],
      rate_rules: [],
      hour_entries: [],
      performance_entries: [],
      obligation_settings: [],
      parameters_by_company: [{
        company_id: COMPANY_IDS.IMPERIO,
        hour_divisor: 240,
        hour_multipliers: [],
        payroll_policy: "SOLO_ADMINISTRATIVO",
        performance_enabled: false,
        commissions_enabled: false
      }]
    };
  }

  function createImperioStore(blessStore = {}) {
    const store = {};
    SCOPED_ROOT_KEYS.forEach(key => {
      switch (key) {
        case "companySettings":
          store[key] = createImperioSettings(blessStore.companySettings);
          break;
        case "chartOfAccounts":
        case "taxParameters":
        case "retentionParameters":
        case "taxSupports":
        case "purchaseTypes":
          store[key] = normalizeScopedValue(key, blessStore[key] || [], COMPANY_IDS.IMPERIO);
          break;
        case "documentSequences":
          store[key] = createImperioSequences(blessStore.documentSequences);
          break;
        case "costCenters":
          store[key] = normalizeScopedValue(
            key,
            (blessStore.costCenters || []).filter(item =>
              ["administrativo", "ventas", "logistica", "otro"].includes(String(item.type || "").toLowerCase())
            ),
            COMPANY_IDS.IMPERIO
          );
          break;
        case "commercial":
          store[key] = normalizeScopedValue(key, createImperioCommercialStore(blessStore.commercial), COMPANY_IDS.IMPERIO);
          break;
        case "payroll":
          store[key] = createImperioPayrollStore();
          break;
        default:
          store[key] = normalizeScopedValue(key, emptyValueForKey(key), COMPANY_IDS.IMPERIO);
      }
    });
    return store;
  }

  function snapshotActiveStore(db, companyId = db?.activeCompanyId) {
    const resolved = companyIdOf(companyId);
    const store = {};
    SCOPED_ROOT_KEYS.forEach(key => {
      store[key] = normalizeScopedValue(key, db?.[key] ?? emptyValueForKey(key), resolved);
    });
    return store;
  }

  function captureActiveStore(db) {
    if (!db || typeof db !== "object") return db;
    const activeCompanyId = companyIdOf(db.activeCompanyId);
    db.companyStores = db.companyStores && typeof db.companyStores === "object" ? db.companyStores : {};
    db.companyStores[activeCompanyId] = snapshotActiveStore(db, activeCompanyId);
    return db;
  }

  function applyActiveStore(db, requestedCompanyId = db?.activeCompanyId) {
    if (!db || typeof db !== "object") return db;
    const activeCompanyId = companyIdOf(requestedCompanyId);
    const store = db.companyStores?.[activeCompanyId] || {};
    SCOPED_ROOT_KEYS.forEach(key => {
      db[key] = normalizeScopedValue(key, store[key] ?? emptyValueForKey(key), activeCompanyId);
    });
    db.activeCompanyId = activeCompanyId;
    db.meta = db.meta && typeof db.meta === "object" ? db.meta : {};
    db.meta.activeCompanyId = activeCompanyId;
    db.meta.companyName = COMPANY_PROFILES[activeCompanyId].commercialName;
    return db;
  }

  function migrateDatabase(db) {
    if (!db || typeof db !== "object") return db;
    db.companies = listCompanies();
    db.activeCompanyId = companyIdOf(db.activeCompanyId);
    const hasStores = db.companyStores && typeof db.companyStores === "object";
    if (!hasStores || !db.companyStores[COMPANY_IDS.BLESS]) {
      const blessStore = snapshotActiveStore(db, COMPANY_IDS.BLESS);
      db.companyStores = {
        ...(hasStores ? db.companyStores : {}),
        [COMPANY_IDS.BLESS]: blessStore,
        [COMPANY_IDS.IMPERIO]: createImperioStore(blessStore)
      };
    } else if (!db.companyStores[COMPANY_IDS.IMPERIO]) {
      db.companyStores[COMPANY_IDS.IMPERIO] = createImperioStore(db.companyStores[COMPANY_IDS.BLESS]);
    }
    SCOPED_ROOT_KEYS.forEach(key => {
      if (db.companyStores[COMPANY_IDS.BLESS][key] === undefined) {
        db.companyStores[COMPANY_IDS.BLESS][key] = normalizeScopedValue(
          key,
          db[key] ?? emptyValueForKey(key),
          COMPANY_IDS.BLESS
        );
      }
      if (db.companyStores[COMPANY_IDS.IMPERIO][key] === undefined) {
        db.companyStores[COMPANY_IDS.IMPERIO][key] = normalizeScopedValue(
          key,
          emptyValueForKey(key),
          COMPANY_IDS.IMPERIO
        );
      }
    });
    return applyActiveStore(db, db.activeCompanyId);
  }

  BlessERP.companyCapabilities = {
    COMPANY_IDS,
    COMPANY_PROFILES,
    IMPERIO_SEQUENCE_CODES,
    ROUTE_CAPABILITIES,
    SCOPED_ROOT_KEYS,
    applyActiveStore,
    canAccessRoute,
    captureActiveStore,
    companyIdOf,
    filterMenuRecords,
    getCompany,
    hasCapability,
    listCompanies,
    migrateDatabase,
    requiredCapabilityForRoute,
    snapshotActiveStore
  };
})();
