(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const capabilities = BlessERP.companyCapabilities;
  const commercialData = BlessERP.comercialData;
  const payrollData = BlessERP.payrollData;
  const COMPANY_IDS = capabilities?.COMPANY_IDS || {
    BLESS: "COMP-BLESS-FLOWER",
    IMPERIO: "COMP-IMPERIO-FLOWERS"
  };
  const SEED_VERSION = 1;

  function clone(value) {
    if (value === undefined) return undefined;
    return BlessERP.utils?.clone
      ? BlessERP.utils.clone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function appendMissing(target, seeds, identityFields = ["id", "code"]) {
    const rows = list(target);
    let added = 0;
    list(seeds).forEach(seed => {
      const exists = rows.some(current => identityFields.some(field => (
        seed?.[field]
        && current?.[field]
        && String(seed[field]).trim().toUpperCase() === String(current[field]).trim().toUpperCase()
      )));
      if (exists) return;
      rows.push(clone(seed));
      added += 1;
    });
    return { rows, added };
  }

  function access(enabled, roleCode) {
    return {
      enabled: Boolean(enabled),
      status: enabled ? "activo" : "inactivo",
      roleCode,
      routeAccess: {}
    };
  }

  function exerciseUsers() {
    return [{
      id: "USR-IMP-005",
      code: "USR-005",
      username: "imperio.demo",
      name: "Administracion Imperio",
      fullName: "Administracion Imperio Flowers",
      email: "",
      role: "Administrador / Contador",
      cargo: "Administrador / Contador",
      area: "Administracion / Contabilidad",
      status: "activo",
      observation: "Usuario de ejercicio sin clave predefinida. El administrador debe asignarla desde Usuarios y accesos.",
      companyAccess: {
        [COMPANY_IDS.BLESS]: access(false, "ADMIN"),
        [COMPANY_IDS.IMPERIO]: access(true, "ADMIN")
      }
    }];
  }

  function providerSeeds(companyId) {
    const common = {
      companyId,
      company_id: companyId,
      payableAccountCode: "2.1.01",
      advanceAccountCode: "1.1.04",
      status: "activo",
      profileState: "COMPLETO",
      creditDays: 15,
      paymentCondition: "Credito 15 dias"
    };
    if (companyId === COMPANY_IDS.BLESS) {
      return [
        {
          ...common,
          id: "PRV-BLF-001",
          code: "PRV-0001",
          ruc: "1790012345001",
          name: "Agroinsumos del Ecuador",
          commercialName: "Agroinsumos EC",
          providerType: "insumos",
          address: "Tabacundo, Pichincha",
          phone: "0000000001",
          email: "ejercicio1@proveedor.local",
          notes: "Dato local de ejercicio para insumos."
        },
        {
          ...common,
          id: "PRV-BLF-002",
          code: "PRV-0002",
          ruc: "0990012345001",
          name: "Cartonera Andina",
          commercialName: "Cartonera Andina",
          providerType: "comercial",
          address: "Guayaquil, Guayas",
          phone: "0000000002",
          email: "ejercicio2@proveedor.local",
          notes: "Dato local de ejercicio para material de empaque."
        },
        {
          ...common,
          id: "PRV-BLF-003",
          code: "PRV-0003",
          ruc: "1710012345001",
          name: "Servicios Tecnicos Quito",
          commercialName: "STQ Mantenimiento",
          providerType: "servicios",
          address: "Quito, Pichincha",
          phone: "0000000003",
          email: "ejercicio3@proveedor.local",
          notes: "Dato local de ejercicio para servicios."
        },
        {
          ...common,
          id: "PRV-BLF-004",
          code: "PRV-0004",
          ruc: "DEMO-BLF-PRV-004",
          name: "Finca Rosas del Cayambe",
          commercialName: "Rosas del Cayambe",
          providerType: "flor",
          address: "Cayambe, Pichincha",
          phone: "0000000004",
          email: "ejercicio4@proveedor.local",
          notes: "Dato local de ejercicio para compras de flor."
        },
        {
          ...common,
          id: "PRV-BLF-005",
          code: "PRV-0005",
          ruc: "DEMO-BLF-PRV-005",
          name: "Logistica Floral Andina",
          commercialName: "Logistica Floral Andina",
          providerType: "servicios",
          address: "Quito, Pichincha",
          phone: "0000000005",
          email: "ejercicio5@proveedor.local",
          notes: "Dato local de ejercicio para servicios logisticos."
        }
      ];
    }
    return [
      ["PRV-IMP-001", "PRV-I001", "Finca Comercial Demo Norte", "flor"],
      ["PRV-IMP-002", "PRV-I002", "Finca Comercial Demo Sur", "flor"],
      ["PRV-IMP-003", "PRV-I003", "Carga Internacional Demo", "servicios"],
      ["PRV-IMP-004", "PRV-I004", "Empaques Imperio Demo", "comercial"],
      ["PRV-IMP-005", "PRV-I005", "Servicios Aduaneros Demo", "servicios"]
    ].map(([id, code, name, providerType], index) => ({
      ...common,
      id,
      code,
      ruc: `DEMO-IMP-PRV-${String(index + 1).padStart(3, "0")}`,
      name,
      commercialName: name,
      providerType,
      address: index < 2 ? "Cayambe, Pichincha" : "Quito, Pichincha",
      phone: `00000001${String(index + 1).padStart(2, "0")}`,
      email: `proveedor${index + 1}@imperio.local`,
      notes: "Dato local de ejercicio de Imperio Flowers."
    }));
  }

  function customerSeeds(companyId) {
    const isBless = companyId === COMPANY_IDS.BLESS;
    const prefix = isBless ? "BLF" : "IMP";
    const rows = isBless
      ? [
          ["customer-cvflor", "CLI-CVF", "CVFLOR GROUP", "CVFLOR GROUP S.A.", "ECUADOR", "Quito"],
          ["customer-ursa", "CLI-URS", "URSA", "URSA TRADING LLC", "KAZAJSTAN", "Almaty"],
          ["customer-sara", "CLI-SAR", "SARA GARDEN", "SARA GARDEN EXPORT INC", "ECUADOR", "Cayambe"],
          ["customer-bless-exercise-04", "CLI-B04", "Pacific Flowers Demo", "PACIFIC FLOWERS DEMO LLC", "USA", "Miami"],
          ["customer-bless-exercise-05", "CLI-B05", "Euroflora Demo", "EUROFLORA DEMO BV", "NETHERLANDS", "Aalsmeer"]
        ]
      : [
          ["customer-imperio-01", "CLI-I01", "Imperial Bloom Demo", "IMPERIAL BLOOM DEMO LLC", "USA", "Miami"],
          ["customer-imperio-02", "CLI-I02", "Azul Flores Demo", "AZUL FLORES DEMO SAS", "COLOMBIA", "Bogota"],
          ["customer-imperio-03", "CLI-I03", "Europa Rosa Demo", "EUROPA ROSA DEMO BV", "NETHERLANDS", "Aalsmeer"],
          ["customer-imperio-04", "CLI-I04", "Caribe Floral Demo", "CARIBE FLORAL DEMO SRL", "REPUBLICA DOMINICANA", "Santo Domingo"],
          ["customer-imperio-05", "CLI-I05", "Mercado Local Demo", "MERCADO LOCAL DEMO CIA LTDA", "ECUADOR", "Quito"]
        ];
    return rows.map(([id, code, commercialName, legalName, country, city], index) => commercialData.createCustomer({
      id,
      code,
      companyId,
      company_id: companyId,
      commercialName,
      legalName,
      identificationType: country === "ECUADOR" ? "RUC" : "IDENTIFICACION EXTERIOR",
      identification: `DEMO-${prefix}-CLI-${String(index + 1).padStart(3, "0")}`,
      country,
      city,
      address: `${city} - direccion de ejercicio`,
      contact: `Contacto ${commercialName}`,
      mobilePhone: `00000002${String(index + 1).padStart(2, "0")}`,
      contactEmail: `cliente${index + 1}@${prefix.toLowerCase()}.local`,
      billingEmail: `facturas${index + 1}@${prefix.toLowerCase()}.local`,
      statementEmail: `cartera${index + 1}@${prefix.toLowerCase()}.local`,
      creditDays: index % 2 ? 15 : 30,
      creditAmount: 5000 + (index * 2500),
      category: country === "ECUADOR" ? "LOCAL" : "EXPORTACION",
      status: "ACTIVO",
      observation: "Dato local de ejercicio; reemplazar antes de usar en produccion."
    }));
  }

  function brandSeeds(companyId, customers) {
    const isBless = companyId === COMPANY_IDS.BLESS;
    const customerById = new Map(customers.map(item => [item.id, item]));
    const rows = isBless
      ? [
          ["brand-del-real", "MAR-DELREAL", "DEL REAL FLOWERS", customerById.get("customer-cvflor"), "REPUBLICA DOMINICANA", "Santo Domingo"],
          ["brand-orbiq", "MAR-ORBIQ", "ORBIQ ADAN FLOWERS", customerById.get("customer-cvflor"), "USA", "Miami"],
          ["brand-sagas", "MAR-SAGAS", "SAGAS FLOWERS BV", customerById.get("customer-cvflor"), "NETHERLANDS", "Aalsmeer"],
          ["brand-alex", "MAR-ALEX", "ALEX FLOWERS", customerById.get("customer-ursa"), "KAZAJSTAN", "Almaty"],
          ["brand-sg-jfe", "MAR-SGJFE", "SARA GARDEN JFE", customerById.get("customer-sara"), "ECUADOR", "Quito"],
          ["brand-bless-exercise-04", "MAR-B04", "PACIFIC DEMO", customerById.get("customer-bless-exercise-04"), "USA", "Miami"],
          ["brand-bless-exercise-05", "MAR-B05", "EUROFLORA DEMO", customerById.get("customer-bless-exercise-05"), "NETHERLANDS", "Aalsmeer"]
        ]
      : [
          ["brand-imperio-01", "MAR-I01", "IMPERIAL BLUE DEMO", customerById.get("customer-imperio-01"), "USA", "Miami"],
          ["brand-imperio-02", "MAR-I02", "AZUL BOGOTA DEMO", customerById.get("customer-imperio-02"), "COLOMBIA", "Bogota"],
          ["brand-imperio-03", "MAR-I03", "EUROPA ROSA DEMO", customerById.get("customer-imperio-03"), "NETHERLANDS", "Aalsmeer"],
          ["brand-imperio-04", "MAR-I04", "CARIBE DEMO", customerById.get("customer-imperio-04"), "REPUBLICA DOMINICANA", "Santo Domingo"],
          ["brand-imperio-05", "MAR-I05", "IMPERIO LOCAL DEMO", customerById.get("customer-imperio-05"), "ECUADOR", "Quito"]
        ];
    return rows.map(([id, code, name, customer, country, city]) => commercialData.createBrand({
      id,
      code,
      companyId,
      company_id: companyId,
      customerId: customer?.id || "",
      name,
      finalClientName: name,
      address: `${city} - direccion de ejercicio`,
      city,
      country,
      destination: country,
      contact: `Contacto ${name}`,
      phone: "0000000300",
      email: `marca.${code.toLowerCase()}@local`,
      requiresPo: true,
      status: "ACTIVO",
      observation: "Marca local de ejercicio."
    }));
  }

  function daeSeeds(companyId, customers) {
    const prefix = companyId === COMPANY_IDS.BLESS ? "055-BLF" : "055-IMP";
    const countries = ["USA", "COLOMBIA", "NETHERLANDS", "REPUBLICA DOMINICANA", "KAZAJSTAN"];
    return countries.map((country, index) => commercialData.createDae({
      id: `${companyId === COMPANY_IDS.BLESS ? "dae-bless" : "dae-imperio"}-exercise-${index + 1}`,
      companyId,
      company_id: companyId,
      number: `${prefix}-2026-${String(index + 1).padStart(8, "0")}`,
      destination: country,
      country,
      status: "ACTIVA",
      expirationDate: "2026-12-31",
      customerIds: customers[index]?.id ? [customers[index].id] : [],
      observation: "DAE local de ejercicio; no utilizar como documento real."
    }));
  }

  function ensureCommercial(store, companyId, sharedCatalogs) {
    let commercial = store.commercial && typeof store.commercial === "object"
      ? store.commercial
      : commercialData.createCommercialStore();
    if (companyId === COMPANY_IDS.IMPERIO && !store.commercial) {
      commercial = {
        ...commercial,
        orders: [],
        preorders: [],
        reservations: [],
        customerCatalog: [],
        brandCatalog: [],
        daeCatalog: []
      };
    }
    const customerResult = appendMissing(
      commercial.customerCatalog,
      customerSeeds(companyId),
      ["id", "code", "identification"]
    );
    commercial.customerCatalog = customerResult.rows;
    const companyCustomers = commercial.customerCatalog.filter(item => (
      String(item.companyId || item.company_id || companyId) === companyId
    ));
    const brandResult = appendMissing(
      commercial.brandCatalog,
      brandSeeds(companyId, companyCustomers),
      ["id", "code"]
    );
    commercial.brandCatalog = brandResult.rows;
    const daeResult = appendMissing(
      commercial.daeCatalog,
      daeSeeds(companyId, companyCustomers),
      ["id", "number"]
    );
    commercial.daeCatalog = daeResult.rows;
    commercial.sharedCatalogSourceCompanyId = COMPANY_IDS.BLESS;
    commercial.supplierReferenceCatalog = clone(sharedCatalogs.suppliers);
    commercial.blockReferenceCatalog = clone(sharedCatalogs.blocks);
    commercial.varietyReferenceCatalog = clone(sharedCatalogs.varieties);
    store.commercial = commercial;
    return customerResult.added + brandResult.added + daeResult.added;
  }

  function administrativeEmployees(companyId) {
    const createdAt = "2026-07-01T00:00:00.000Z";
    const rows = [
      ["EMP-IMP-ADM-001", "ADM-I01", "DEMO-IMP-EMP-001", "Administracion Imperio", "Administrador"],
      ["EMP-IMP-ADM-002", "ADM-I02", "DEMO-IMP-EMP-002", "Asistente Contable Imperio", "Asistente contable"],
      ["EMP-IMP-ADM-003", "ADM-I03", "DEMO-IMP-EMP-003", "Coordinacion Comercial Imperio", "Coordinador comercial"],
      ["EMP-IMP-ADM-004", "ADM-I04", "DEMO-IMP-EMP-004", "Asistente Logistico Imperio", "Asistente logistico"],
      ["EMP-IMP-ADM-005", "ADM-I05", "DEMO-IMP-EMP-005", "Auxiliar Administrativo Imperio", "Auxiliar administrativo"]
    ];
    return rows.map(([employeeId, code, identification, fullName, position], index) => ({
      employee_id: employeeId,
      company_id: companyId,
      user_id: index === 0 ? "USR-IMP-005" : "",
      seller_id: index === 2 ? "SELL-IMP-001" : "",
      code,
      identification,
      full_name: fullName,
      hire_date: "2026-01-01",
      area: "ADMINISTRATIVA",
      position,
      status: "ACTIVO",
      calculation_mode: "SUELDO_MENSUAL",
      salary_payment_mode: "COMPLETO",
      monthly_salary: index === 0 ? 700 : 482,
      hourly_rate: 0,
      performance_rate: 0,
      performance_unit: "OTRA",
      goal: 0,
      probation_period: false,
      probation_end_date: "",
      account_code: "5.6.01",
      notes: "Trabajador administrativo local de ejercicio; Imperio no calcula rendimiento.",
      external_refs: {},
      created_at: createdAt,
      created_by: "SYSTEM-EXERCISE",
      updated_at: createdAt,
      updated_by: "SYSTEM-EXERCISE"
    }));
  }

  function ensurePayroll(store, companyId) {
    if (companyId !== COMPANY_IDS.IMPERIO) return 0;
    const payroll = store.payroll && typeof store.payroll === "object"
      ? store.payroll
      : payrollData.createPayrollStore(companyId);
    const result = appendMissing(payroll.employees, administrativeEmployees(companyId), ["employee_id", "code", "identification"]);
    payroll.employees = result.rows;
    payroll.default_company_id = companyId;
    if (!Array.isArray(payroll.performance_entries)) payroll.performance_entries = [];
    store.payroll = payroll;
    return result.added;
  }

  function ensureOperationsCatalogs(blessStore) {
    const operations = blessStore.operations && typeof blessStore.operations === "object"
      ? blessStore.operations
      : {};
    operations.catalogs = operations.catalogs && typeof operations.catalogs === "object"
      ? operations.catalogs
      : {};
    const supplierNames = [
      "FINCA CANGAHUA",
      "BLOSSOM HILLS",
      "SANTA ROSA FARMS",
      "ROSAS DEL CAYAMBE",
      "FLORICOLA SAN PEDRO"
    ];
    const blockNames = ["BQ-01", "BQ-02", "BLOQUE A", "BLOQUE C", "CUARTO FRIO 1"];
    const varietyNames = ["EXPLORER", "MONDIAL", "PLAYA BLANCA", "PINK MONDIAL", "NINA", "QUICKSAND"];
    operations.catalogs.suppliers = [...new Set([...list(operations.catalogs.suppliers), ...supplierNames])];
    operations.catalogs.blocks = [...new Set([...list(operations.catalogs.blocks), ...blockNames])];
    operations.catalogs.varieties = [...new Set([...list(operations.catalogs.varieties), ...varietyNames])];
    blessStore.operations = operations;
    return {
      suppliers: operations.catalogs.suppliers.map((name, index) => ({ code: `FIN-${String(index + 1).padStart(3, "0")}`, name })),
      blocks: operations.catalogs.blocks.map((name, index) => ({ code: `BLQ-${String(index + 1).padStart(3, "0")}`, name })),
      varieties: operations.catalogs.varieties.map((name, index) => ({ code: `VAR-${String(index + 1).padStart(3, "0")}`, name }))
    };
  }

  function ensureAll(options = {}) {
    const db = options.db || BlessERP.state?.state?.db;
    if (!db || !capabilities || !commercialData || !payrollData) {
      return { ok: false, added: 0, reason: "DEPENDENCIAS_NO_DISPONIBLES" };
    }
    capabilities.captureActiveStore?.(db);
    capabilities.migrateDatabase(db);
    const blessStore = db.companyStores[COMPANY_IDS.BLESS];
    const imperioStore = db.companyStores[COMPANY_IDS.IMPERIO];
    const sharedCatalogs = ensureOperationsCatalogs(blessStore);
    let added = 0;

    const userResult = appendMissing(db.visualUsers, exerciseUsers(), ["id", "code", "username"]);
    db.visualUsers = userResult.rows;
    added += userResult.added;

    [COMPANY_IDS.BLESS, COMPANY_IDS.IMPERIO].forEach(companyId => {
      const store = db.companyStores[companyId];
      const providerResult = appendMissing(store.providers, providerSeeds(companyId), ["id", "code", "ruc"]);
      store.providers = providerResult.rows;
      added += providerResult.added;
      added += ensureCommercial(store, companyId, sharedCatalogs);
      added += ensurePayroll(store, companyId);
    });

    db.meta = db.meta && typeof db.meta === "object" ? db.meta : {};
    db.meta.exerciseSeedVersion = SEED_VERSION;
    db.meta.exerciseSeedNotice = "Datos locales de ejercicio; no equivalen a documentos, clientes o identificaciones reales.";
    capabilities.applyActiveStore(db, db.activeCompanyId);
    if (options.persist !== false && added > 0) BlessERP.storage?.save?.(db);
    return {
      ok: true,
      added,
      companyCounts: {
        [COMPANY_IDS.BLESS]: {
          providers: list(blessStore.providers).length,
          customers: list(blessStore.commercial?.customerCatalog).length,
          brands: list(blessStore.commercial?.brandCatalog).length,
          daes: list(blessStore.commercial?.daeCatalog).length,
          employees: list(blessStore.payroll?.employees).length
        },
        [COMPANY_IDS.IMPERIO]: {
          providers: list(imperioStore.providers).length,
          customers: list(imperioStore.commercial?.customerCatalog).length,
          brands: list(imperioStore.commercial?.brandCatalog).length,
          daes: list(imperioStore.commercial?.daeCatalog).length,
          employees: list(imperioStore.payroll?.employees).length
        }
      },
      sharedCatalogCounts: {
        suppliers: sharedCatalogs.suppliers.length,
        blocks: sharedCatalogs.blocks.length,
        varieties: sharedCatalogs.varieties.length
      }
    };
  }

  BlessERP.exerciseSeeds = {
    SEED_VERSION,
    appendMissing,
    ensureAll,
    providerSeeds,
    customerSeeds,
    brandSeeds,
    daeSeeds,
    administrativeEmployees
  };

  ensureAll();
})();
