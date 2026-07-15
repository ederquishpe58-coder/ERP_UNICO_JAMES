(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function normalizeColdRooms(seed = {}) {
    const source = Array.isArray(seed.coldRooms)
      ? seed.coldRooms
      : String(seed.coldRooms || "").split(/[\n,;]+/);
    const rooms = source.map(item => String(item || "").trim()).filter(Boolean);
    const primary = String(seed.coldRoom || "").trim();
    if (primary && !rooms.some(item => item.toUpperCase() === primary.toUpperCase())) rooms.unshift(primary);
    return [...new Map(rooms.map(item => [item.toUpperCase(), item])).values()];
  }
  const { clone } = BlessERP.utils;

  const company = {
    commercialName: "Bless Flower Export Demo",
    legalName: "Bless Flower Export Demo",
    ruc: "1717637084001",
    address: "Comunidad Carrera Calle Central SN y Santa Rosa",
    address2: "Tres cuadras del parque central. Via a Oyacachi",
    city: "Cayambe - Ecuador",
    phone: "032262041",
    email: "comercial@blessflower.demo",
    soldToLabel: "Bless Flower Export",
    paymentTermsDefault: "0 dias",
    preparedBy: "Equipo comercial demo",
    incoterm: "FCA UIO",
    coldRoomDefault: "QCELL"
  };

  function createCustomer(seed = {}) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-CLI"),
      code: seed.code || "",
      category: seed.category || "EXPORTACION",
      related: Boolean(seed.related),
      flowerTypeB: Boolean(seed.flowerTypeB),
      legalName: seed.legalName || "",
      commercialName: seed.commercialName || "",
      status: seed.status || "ACTIVO",
      identificationType: seed.identificationType || "RUC",
      identification: seed.identification || "",
      address: seed.address || "",
      city: seed.city || "",
      country: seed.country || "ECUADOR",
      contact: seed.contact || "",
      fixedPhone: seed.fixedPhone || "",
      mobilePhone: seed.mobilePhone || "",
      contactEmail: seed.contactEmail || "",
      creditDays: Number(seed.creditDays || 0),
      creditAmount: Number(seed.creditAmount || 0),
      billingEmail: seed.billingEmail || "",
      statementEmail: seed.statementEmail || "",
      observation: seed.observation || ""
    };
  }

  const customers = [
    {
      id: "customer-cvflor",
      code: "CLI-CVF",
      commercialName: "CVFLOR GROUP",
      legalName: "CVFLOR GROUP S.A.",
      identification: "1799991001001",
      country: "ECUADOR",
      city: "Quito",
      address: "Av. Amazonas y Naciones Unidas",
      contact: "Cuenta CVFLOR",
      fixedPhone: "022991001",
      mobilePhone: "099991001",
      contactEmail: "contacto@cvflor.com",
      billingEmail: "facturas@cvflor.com",
      statementEmail: "contabilidad@cvflor.com",
      creditDays: 15,
      creditAmount: 15000,
      status: "ACTIVO",
      category: "EXPORTACION"
    },
    {
      id: "customer-ursa",
      code: "CLI-URS",
      commercialName: "URSA",
      legalName: "URSA TRADING LLC",
      identification: "1799991002001",
      country: "ECUADOR",
      city: "Quito",
      address: "Parque Empresarial Quito Norte",
      contact: "Cuenta URSA",
      fixedPhone: "022987654",
      mobilePhone: "0987654321",
      contactEmail: "contact@ursa.com",
      billingEmail: "invoice@ursa.com",
      statementEmail: "accounting@ursa.com",
      creditDays: 0,
      creditAmount: 5000,
      status: "ACTIVO",
      category: "EXPORTACION"
    },
    {
      id: "customer-sara",
      code: "CLI-SAR",
      commercialName: "SARA GARDEN",
      legalName: "SARA GARDEN EXPORT INC",
      identification: "1799991003001",
      country: "ECUADOR",
      city: "Cayambe",
      address: "Panamericana Norte Km 3",
      contact: "Cuenta SARA GARDEN",
      fixedPhone: "022118800",
      mobilePhone: "099118800",
      contactEmail: "contacto@saragarden.com",
      billingEmail: "billing@saragarden.com",
      statementEmail: "accounting@saragarden.com",
      creditDays: 30,
      creditAmount: 22000,
      status: "ACTIVO",
      category: "LOCAL"
    }
  ].map(createCustomer);

  function createBrand(seed = {}) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-MAR"),
      code: seed.code || "",
      customerId: seed.customerId || "",
      commercializer: Boolean(seed.commercializer),
      name: seed.name || "",
      shortReference: seed.shortReference || seed.name || "",
      finalClientName: seed.finalClientName || "",
      address: seed.address || "",
      city: seed.city || "",
      country: seed.country || "ECUADOR",
      destination: seed.destination || seed.country || "ECUADOR",
      contact: seed.contact || "",
      fixedPhone: seed.fixedPhone || "",
      phone: seed.phone || "",
      email: seed.email || "",
      requiresPo: Boolean(seed.requiresPo),
      defaultAgencyId: seed.defaultAgencyId || "",
      agencyContact: seed.agencyContact || "",
      agencyEmail: seed.agencyEmail || "",
      agencyColdRoom: seed.agencyColdRoom || "",
      agencyCity: seed.agencyCity || "",
      printedConsignee: seed.printedConsignee || "",
      printedMark: seed.printedMark || "",
      printedInvoiceAddress: seed.printedInvoiceAddress || "",
      observation: seed.observation || "",
      status: seed.status || "ACTIVO"
    };
  }

  const brands = [
    {
      id: "brand-del-real",
      code: "MAR-DELREAL",
      customerId: "customer-cvflor",
      name: "DEL REAL",
      finalClientName: "DEL REAL FLOWERS",
      address: "Ave. del Comercio 120",
      city: "Santo Domingo",
      country: "REPUBLICA DOMINICANA",
      destination: "REPUBLICA DOMINICANA",
      contact: "Carlos Mena",
      phone: "+1 809 555 0101",
      email: "imports@delreal.do",
      requiresPo: true,
      defaultAgencyId: "agency-fresh",
      observation: "Broker con control estricto de PO por linea."
    },
    {
      id: "brand-orbiq",
      code: "MAR-ORBIQ",
      customerId: "customer-cvflor",
      name: "ORBIQ ADAN",
      finalClientName: "ORBIQ ADAN FLOWERS",
      address: "Zona Franca Oriente 22",
      city: "Miami",
      country: "USA",
      destination: "USA",
      contact: "Andrea Bloom",
      phone: "+1 305 555 8822",
      email: "ops@orbiqadan.com",
      requiresPo: true,
      defaultAgencyId: "agency-fresh",
      observation: "Requiere PO por caja o por linea."
    },
    {
      id: "brand-sagas",
      code: "MAR-SAGAS",
      customerId: "customer-cvflor",
      name: "SAGAS FLOWERS",
      finalClientName: "SAGAS FLOWERS BV",
      address: "Flower Trade Center 18",
      city: "Aalsmeer",
      country: "NETHERLANDS",
      destination: "NETHERLANDS",
      contact: "Mila Vos",
      phone: "+31 20 555 0190",
      email: "orders@sagasflowers.nl",
      requiresPo: false,
      defaultAgencyId: "agency-pacific",
      observation: "No exige PO en todos los embarques."
    },
    {
      id: "brand-alex",
      code: "MAR-ALEX",
      customerId: "customer-ursa",
      name: "ALEX",
      finalClientName: "ALEX FLOWERS",
      address: "KazTrade Hub 81",
      city: "Almaty",
      country: "KAZAJSTAN",
      destination: "KAZAJSTAN",
      contact: "Alex Romanov",
      phone: "+7 727 555 1122",
      email: "sales@alexflowers.kz",
      requiresPo: false,
      defaultAgencyId: "agency-pacific",
      observation: "Usa packing/invoice carguera consolidado."
    },
    {
      id: "brand-sg-jfe",
      code: "MAR-SGJFE",
      customerId: "customer-sara",
      name: "SG-JFE",
      finalClientName: "SARA GARDEN JFE",
      address: "Zona Industrial 4",
      city: "Quito",
      country: "ECUADOR",
      destination: "ECUADOR",
      contact: "Jose F. Erazo",
      phone: "+593 98 555 4444",
      email: "compras@sgjfe.ec",
      requiresPo: true,
      defaultAgencyId: "agency-logike",
      observation: "Cliente local con detalle comercial interno."
    }
  ].map(createBrand);

  function createDae(seed = {}) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-DAE"),
      number: seed.number || "",
      destination: seed.destination || "",
      country: seed.country || seed.destination || "",
      status: seed.status || "ACTIVA",
      expirationDate: seed.expirationDate || "",
      airlineId: seed.airlineId || "",
      customerIds: Array.isArray(seed.customerIds) ? [...new Set(seed.customerIds.filter(Boolean))] : [],
      observation: seed.observation || ""
    };
  }

  const daes = [
    {
      id: "dae-kazajstan-demo",
      number: "055-2026-40-01186707",
      destination: "KAZAJSTAN",
      country: "KAZAJSTAN",
      status: "ACTIVA",
      expirationDate: "2026-07-20",
      airlineId: "air-atlas",
      customerIds: ["customer-ursa"],
      observation: "DAE activa para flujo demo URSA / ALEX."
    },
    {
      id: "dae-rd-demo",
      number: "055-2026-40-00992586",
      destination: "REPUBLICA DOMINICANA",
      country: "REPUBLICA DOMINICANA",
      status: "ACTIVA",
      expirationDate: "2026-07-12",
      airlineId: "air-latam",
      customerIds: ["customer-cvflor"],
      observation: "DAE demo para embarques hacia Republica Dominicana."
    },
    {
      id: "dae-usa-american-demo",
      number: "055-2026-40-01001111",
      destination: "USA",
      country: "USA",
      status: "ACTIVA",
      expirationDate: "2026-07-18",
      airlineId: "air-american",
      customerIds: ["customer-cvflor"],
      observation: "Ruta demo USA con American Airlines."
    },
    {
      id: "dae-usa-latam-demo",
      number: "055-2026-40-01001112",
      destination: "USA",
      country: "USA",
      status: "ACTIVA",
      expirationDate: "2026-07-22",
      airlineId: "air-latam",
      customerIds: ["customer-cvflor"],
      observation: "Ruta demo USA con Latam Cargo."
    },
    {
      id: "dae-netherlands-demo",
      number: "055-2026-40-00880001",
      destination: "NETHERLANDS",
      country: "NETHERLANDS",
      status: "ACTIVA",
      expirationDate: "2026-06-30",
      airlineId: "air-klm",
      customerIds: [],
      observation: "DAE demo caducada para control visual."
    },
    {
      id: "dae-kazajstan-secondary-demo",
      number: "055-2026-40-00193911",
      destination: "KAZAJSTAN",
      country: "KAZAJSTAN",
      status: "ACTIVA",
      expirationDate: "2026-07-26",
      airlineId: "air-atlas",
      customerIds: ["customer-sara"],
      observation: "DAE demo secundaria para Kazajstan."
    },
    {
      id: "dae-russia-demo",
      number: "055-2026-40-00193912",
      destination: "RUSIA",
      country: "RUSIA",
      status: "ACTIVA",
      expirationDate: "2026-07-29",
      airlineId: "air-avianca",
      customerIds: [],
      observation: "Ruta demo Rusia."
    }
  ].map(createDae);

  function createAgency(seed = {}) {
    const coldRooms = normalizeColdRooms(seed);
    return {
      id: seed.id || BlessERP.utils.uid("COM-AGE"),
      code: seed.code || "",
      name: seed.name || "",
      coldRoom: seed.coldRoom || coldRooms[0] || "",
      coldRooms,
      city: seed.city || "Quito",
      contact: seed.contact || "",
      email: seed.email || "",
      phone: seed.phone || "",
      status: seed.status || "ACTIVA",
      observation: seed.observation || ""
    };
  }

  const agencies = [
    {
      id: "agency-pacific",
      code: "AG-PAC",
      name: "PACIFIC CARGO",
      coldRoom: "QCELL",
      city: "Quito",
      contact: "Mesa operativa Pacific",
      email: "ops@pacificcargo.demo",
      phone: "022500100",
      status: "ACTIVA",
      observation: "Agencia principal para embarques de URSA y rutas CIS."
    },
    {
      id: "agency-fresh",
      code: "AG-FRE",
      name: "FRESH LOGISTICS",
      coldRoom: "COOL 4",
      city: "Quito",
      contact: "Coordinacion Fresh",
      email: "booking@freshlogistics.demo",
      phone: "022500110",
      status: "ACTIVA",
      observation: "Coordinacion de carga para clientes de America y Europa."
    },
    {
      id: "agency-logike",
      code: "AG-LOG",
      name: "LOGIKE CARGO",
      coldRoom: "BODEGA 3",
      city: "Quito",
      contact: "Mesa local Logike",
      email: "local@logikecargo.demo",
      phone: "022500120",
      status: "ACTIVA",
      observation: "Agencia para operaciones locales y embarques consolidados."
    },
    {
      id: "agency-ebf",
      code: "AG-EBF",
      name: "EBF CARGO",
      coldRoom: "EBF CARGO",
      city: "Quito",
      contact: "Soporte EBF",
      email: "operaciones@ebfcargo.demo",
      phone: "022500130",
      status: "ACTIVA",
      observation: "Agencia demo disponible para parametrizacion comercial."
    },
    {
      id: "agency-saftec",
      code: "AG-SAF",
      name: "SAFTEC CARGO",
      coldRoom: "SAFTEC CARGO",
      city: "Quito",
      contact: "Mesa SAFTEC",
      email: "mesa@safteccargo.demo",
      phone: "022500140",
      status: "ACTIVA",
      observation: "Agencia demo con cuarto frio propio."
    },
    {
      id: "agency-one-team",
      code: "AG-ONE",
      name: "ONE TEAM CARGO",
      coldRoom: "KUEHNE NAGEL",
      city: "Quito",
      contact: "One Team",
      email: "ops@oneteamcargo.demo",
      phone: "022500150",
      status: "ACTIVA",
      observation: "Coordinacion demo para carga internacional."
    }
  ].map(createAgency);

  function createAirline(seed = {}) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-AIR"),
      code: seed.code || "",
      name: seed.name || "",
      awbPrefix: String(seed.awbPrefix || ""),
      status: seed.status || "ACTIVA"
    };
  }

  const airlines = [
    { id: "air-atlas", code: "AIR-ATL", name: "ATLAS", awbPrefix: "369", status: "ACTIVA" },
    { id: "air-latam", code: "AIR-LAT", name: "LATAM CARGO", awbPrefix: "045", status: "ACTIVA" },
    { id: "air-klm", code: "AIR-KLM", name: "KLM CARGO", awbPrefix: "074", status: "ACTIVA" },
    { id: "air-avianca", code: "AIR-AVI", name: "AVIANCA", awbPrefix: "134", status: "ACTIVA" },
    { id: "air-american", code: "AIR-AAL", name: "AMERICAN AIRLINES", awbPrefix: "001", status: "ACTIVA" }
  ].map(createAirline);

  function createDestination(seed = {}) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-DST"),
      code: seed.code || "",
      destination: seed.destination || "",
      country: seed.country || seed.destination || "",
      suggestedTransport: seed.suggestedTransport || "aereo",
      status: seed.status || "ACTIVO"
    };
  }

  const destinations = [
    { id: "destination-kz", code: "DEST-KZ", destination: "KAZAJSTAN", country: "Kazajstan", suggestedTransport: "aereo" },
    { id: "destination-rd", code: "DEST-RD", destination: "REPUBLICA DOMINICANA", country: "Republica Dominicana", suggestedTransport: "aereo" },
    { id: "destination-us", code: "DEST-US", destination: "USA", country: "USA", suggestedTransport: "aereo" },
    { id: "destination-ru", code: "DEST-RU", destination: "RUSIA", country: "Rusia", suggestedTransport: "aereo" },
    { id: "destination-nl", code: "DEST-NL", destination: "NETHERLANDS", country: "Netherlands", suggestedTransport: "aereo" },
    { id: "destination-ec", code: "DEST-EC", destination: "ECUADOR", country: "Ecuador", suggestedTransport: "terrestre" }
  ].map(createDestination);

  const products = [
    { id: "product-roses", code: "ROSES", name: "ROSES", genus: "Rosa", species: "Rosa spp.", hts: "06031100", nandina: "060311" }
  ];

  const varieties = [
    "EXPLORER",
    "MONDIAL",
    "PLAYA BLANCA",
    "QUICKSAND",
    "CANDLELIGHT",
    "BE SWEET",
    "NINA",
    "PINK MONDIAL",
    "HOT EXPLORER",
    "HERMOSA",
    "MANDALA"
  ];

  const boxTypes = [
    { id: "box-fb", code: "FB", name: "Full box", fullEquivalent: 1, netWeight: 15, grossWeight: 17, alternateName: "Full", configurable: false },
    { id: "box-hb", code: "HB", name: "Half box", fullEquivalent: 0.5, netWeight: 7.5, grossWeight: 8.5, alternateName: "Tabaco", configurable: false },
    { id: "box-qb", code: "QB", name: "Quarter box", fullEquivalent: 0.25, netWeight: 3.75, grossWeight: 4, alternateName: "Cuarto", configurable: false },
    { id: "box-eb", code: "EB", name: "Eighth box", fullEquivalent: 0.125, netWeight: 1.75, grossWeight: 2, alternateName: "Octavo", configurable: false },
    { id: "box-jb", code: "JB", name: "Jumbo box", fullEquivalent: 0.5, netWeight: 8, grossWeight: 9, alternateName: "Jumbo", configurable: false }
  ];

  const materialStock = {
    CARTON_HB: { code: "CARTON_HB", name: "Caja HB", unit: "unidad", available: 220 },
    CARTON_QB: { code: "CARTON_QB", name: "Caja QB", unit: "unidad", available: 160 },
    CARTON_EB: { code: "CARTON_EB", name: "Caja EB", unit: "unidad", available: 80 },
    SEPARADOR: { code: "SEPARADOR", name: "Separadores", unit: "unidad", available: 260 },
    ETIQUETA: { code: "ETIQUETA", name: "Etiquetas de caja", unit: "unidad", available: 240 },
    LIGA: { code: "LIGA", name: "Ligas", unit: "paquete", available: 24 },
    CAPUCHON: { code: "CAPUCHON", name: "Capuchones", unit: "paquete", available: 18 }
  };

  const materialRules = {
    separatorPerBox: { HB: 2, QB: 1, EB: 1 },
    labelsPerBox: 1,
    bunchesPerLigaPack: 12,
    bunchesPerCapuchonPack: 10,
    capuchonLengths: [60, 70, 80]
  };

  const availability = [
    {
      id: "availability-001",
      date: "2026-07-08",
      variety: "EXPLORER",
      length: 60,
      stemsPerBunch: 25,
      bunchesAvailable: 120,
      stemsAvailable: 3000,
      warehouse: "BODEGA A",
      supplier: "Proveedor demo 1",
      block: "B1",
      category: "exportacion",
      status: "disponible",
      ageDays: 1,
      note: "Disponibilidad demo para flujo comercial."
    },
    {
      id: "availability-002",
      date: "2026-07-08",
      variety: "MONDIAL",
      length: 50,
      stemsPerBunch: 25,
      bunchesAvailable: 90,
      stemsAvailable: 2250,
      warehouse: "BODEGA A",
      supplier: "Proveedor demo 2",
      block: "B2",
      category: "exportacion",
      status: "disponible",
      ageDays: 2,
      note: "Coincide con ordenes de exportacion demo."
    },
    {
      id: "availability-003",
      date: "2026-07-08",
      variety: "PLAYA BLANCA",
      length: 50,
      stemsPerBunch: 25,
      bunchesAvailable: 140,
      stemsAvailable: 3500,
      warehouse: "BODEGA B",
      supplier: "Proveedor demo 3",
      block: "B4",
      category: "exportacion",
      status: "disponible",
      ageDays: 1,
      note: "Pendiente de integrar disponibilidad real desde Operaciones."
    },
    {
      id: "availability-004",
      date: "2026-07-08",
      variety: "BE SWEET",
      length: 40,
      stemsPerBunch: 25,
      bunchesAvailable: 55,
      stemsAvailable: 1375,
      warehouse: "BODEGA C",
      supplier: "Proveedor demo 4",
      block: "B5",
      category: "nacional",
      status: "disponible",
      ageDays: 3,
      note: "Uso comercial solo demo."
    },
    {
      id: "availability-005",
      date: "2026-07-08",
      variety: "QUICKSAND",
      length: 60,
      stemsPerBunch: 25,
      bunchesAvailable: 38,
      stemsAvailable: 950,
      warehouse: "BODEGA D",
      supplier: "Proveedor demo 5",
      block: "B8",
      category: "exportacion",
      status: "disponible",
      ageDays: 4,
      note: "Reserva demo disponible."
    }
  ];

  const printDocs = [
    { code: "INVOICE_PACKING_REFERENCIAL", name: "Invoice / Packing carguera referencial", mode: "REFERENCIAL" },
    { code: "INVOICE_PACKING_REAL", name: "Invoice / Packing carguera real", mode: "REAL DEMO" },
    { code: "COMMERCIAL_INVOICE_CLIENT", name: "Factura Comercial Cliente", mode: "REFERENCIAL" },
    { code: "PACKING_LIST", name: "Packing List", mode: "REFERENCIAL" },
    { code: "HR", name: "HR / Hoja de Ruta", mode: "REFERENCIAL" },
    { code: "MP", name: "MP / Master Packing", mode: "REFERENCIAL" },
    { code: "ETIQUETAS", name: "Etiquetas de caja", mode: "REFERENCIAL" },
    { code: "PACKAGING_REQUIREMENTS", name: "Requerimiento de materiales / Bodega", mode: "REFERENCIAL" },
    { code: "RESUMEN", name: "Resumen pedido", mode: "REFERENCIAL" },
    { code: "CONTROL_DAE", name: "Control DAE", mode: "REFERENCIAL" }
  ];

  function createLine(seed = {}) {
    const openMixed = seed.boxBuildMode === "MIXTO_ABIERTO";
    const anyLength = seed.anyLength !== undefined
      ? Boolean(seed.anyLength)
      : openMixed && seed.mixedAnyLength !== false;
    return {
      id: seed.id || BlessERP.utils.uid("COM-LIN"),
      boxNumber: Number(seed.boxNumber || 1),
      boxType: seed.boxType || "HB",
      variety: seed.variety || "EXPLORER",
      po: seed.po || "",
      length: Number(seed.length || 60),
      bunches: Number(seed.bunches || 1),
      stemsPerBunch: Number(seed.stemsPerBunch || 25),
      unitPrice: Number(seed.unitPrice || 0),
      reservationId: seed.reservationId || seed.reservation_id || "",
      reservationSourceId: seed.reservationSourceId || seed.availability_id || "",
      reservationBunchesUsed: Number(seed.reservationBunchesUsed || seed.ramos_reserva_usados || 0),
      reservationNote: seed.reservationNote || "",
      scannedBunches: Array.isArray(seed.scannedBunches) ? seed.scannedBunches.map(item => ({ ...item })) : [],
      boxRangeId: seed.boxRangeId || "",
      boxRangeSequence: Number(seed.boxRangeSequence || 0),
      boxRangeTotal: Number(seed.boxRangeTotal || 0),
      boxRangeLabel: seed.boxRangeLabel || "",
      boxBuildMode: seed.boxBuildMode || "INDIVIDUAL",
      boxBuildGroupId: seed.boxBuildGroupId || "",
      anyLength,
      mixedAnyLength: openMixed ? anyLength : Boolean(seed.mixedAnyLength),
      mixedExcludedVarieties: Array.isArray(seed.mixedExcludedVarieties) ? [...seed.mixedExcludedVarieties] : [],
      mixedActualComposition: Array.isArray(seed.mixedActualComposition) ? seed.mixedActualComposition.map(item => ({ ...item })) : [],
      addedRevision: Number(seed.addedRevision || 1),
      fulfillmentStatus: seed.fulfillmentStatus || "PENDIENTE",
      state: seed.state || "borrador"
    };
  }

  function createOrder(seed = {}) {
    return {
      id: seed.id || BlessERP.utils.uid("COM-ORD"),
      number: seed.number || "PED-COM-2026-0001",
      issuedAt: seed.issuedAt || "",
      flightDate: seed.flightDate || "",
      status: seed.status || "BORRADOR",
      statusUpdatedAt: seed.statusUpdatedAt || "",
      statusUpdatedBy: seed.statusUpdatedBy || "",
      lastTransitionReason: seed.lastTransitionReason || "",
      reopenedFromStatus: seed.reopenedFromStatus || "",
      dispatchedAt: seed.dispatchedAt || "",
      closedAt: seed.closedAt || "",
      customerId: seed.customerId || "",
      brandId: seed.brandId || "",
      destination: seed.destination || "",
      destinationCountry: seed.destinationCountry || "",
      agencyId: seed.agencyId || "",
      daeNumber: seed.daeNumber || "",
      daeDestination: seed.daeDestination || "",
      daeExpirationDate: seed.daeExpirationDate || "",
      daeAssignedAutomatically: Boolean(seed.daeAssignedAutomatically),
      daeModifiedManual: Boolean(seed.daeModifiedManual),
      awb: seed.awb || "",
      hawb: seed.hawb || "",
      airlineId: seed.airlineId || "",
      flightNumber: seed.flightNumber || "",
      transportType: seed.transportType || "aereo",
      coldRoom: seed.coldRoom || "",
      currency: seed.currency || "USD",
      paymentTerms: seed.paymentTerms || company.paymentTermsDefault,
      expireDate: seed.expireDate || "",
      generalPo: seed.generalPo || "",
      invoicePackingNumber: seed.invoicePackingNumber || "",
      clientInvoiceNumber: seed.clientInvoiceNumber || "",
      notes: seed.notes || "",
      packagingDemoStatus: seed.packagingDemoStatus || "",
      packagingPreparedAt: seed.packagingPreparedAt || "",
      packagingConsumedAt: seed.packagingConsumedAt || "",
      routeSheetReference: seed.routeSheetReference || "",
      masterPackingReference: seed.masterPackingReference || "",
      labelsReference: seed.labelsReference || "",
      accountingPreview: seed.accountingPreview && typeof seed.accountingPreview === "object"
        ? {
            state: seed.accountingPreview.state || "NO_GENERADO",
            asientoPreviewId: seed.accountingPreview.asientoPreviewId || "",
            cxcPreviewId: seed.accountingPreview.cxcPreviewId || "",
            generatedAt: seed.accountingPreview.generatedAt || "",
            generatedBy: seed.accountingPreview.generatedBy || "",
            readyAt: seed.accountingPreview.readyAt || "",
            readyBy: seed.accountingPreview.readyBy || "",
            observation: seed.accountingPreview.observation || "",
            snapshot: seed.accountingPreview.snapshot || null
          }
        : {
            state: "NO_GENERADO",
            asientoPreviewId: "",
            cxcPreviewId: "",
            generatedAt: "",
            generatedBy: "",
            readyAt: "",
            readyBy: "",
            observation: "",
            snapshot: null
          },
      documentActivity: seed.documentActivity && typeof seed.documentActivity === "object"
        ? seed.documentActivity
        : {},
      boxFulfillment: seed.boxFulfillment && typeof seed.boxFulfillment === "object" ? { ...seed.boxFulfillment } : {},
      fulfillmentStatus: seed.fulfillmentStatus || "NO_LIBERADO",
      warehouseStatus: seed.warehouseStatus || "NO_LIBERADO",
      warehouseReleasedAt: seed.warehouseReleasedAt || "",
      warehouseReleasedBy: seed.warehouseReleasedBy || "",
      warehouseCompletedAt: seed.warehouseCompletedAt || "",
      warehouseObservation: seed.warehouseObservation || "",
      revisionNumber: Number(seed.revisionNumber || 1),
      revisionEditing: Boolean(seed.revisionEditing),
      revisionDraftNumber: Number(seed.revisionDraftNumber || 0),
      revisionReason: seed.revisionReason || "",
      revisionBaseBoxNumbers: Array.isArray(seed.revisionBaseBoxNumbers) ? [...seed.revisionBaseBoxNumbers] : [],
      revisionAffectedBoxes: Array.isArray(seed.revisionAffectedBoxes) ? [...seed.revisionAffectedBoxes] : [],
      revisionChangeTypes: Array.isArray(seed.revisionChangeTypes) ? [...seed.revisionChangeTypes] : [],
      revisionSnapshot: seed.revisionSnapshot && typeof seed.revisionSnapshot === "object" ? BlessERP.utils.clone(seed.revisionSnapshot) : null,
      labelRevision: Number(seed.labelRevision || 1),
      labelReprintRequired: Boolean(seed.labelReprintRequired),
      invalidatedLabels: Array.isArray(seed.invalidatedLabels) ? seed.invalidatedLabels.map(item => ({ ...item })) : [],
      changeNotifications: Array.isArray(seed.changeNotifications) ? seed.changeNotifications.map(item => ({ ...item })) : [],
      demoValidationSeed: Boolean(seed.demoValidationSeed),
      fulfillmentHistory: Array.isArray(seed.fulfillmentHistory) ? seed.fulfillmentHistory.map(item => ({ ...item })) : [],
      history: Array.isArray(seed.history) ? seed.history : [],
      lines: Array.isArray(seed.lines) ? seed.lines.map(createLine) : []
    };
  }

  function createSeedOrders() {
    return [
      createOrder({
        id: "order-demo-0004",
        number: "PED-COM-2026-0004",
        issuedAt: "2026-07-08",
        flightDate: "2026-07-09",
        status: "BORRADOR",
        transportType: "aereo",
        paymentTerms: "0 dias",
        expireDate: "2026-07-08"
      }),
      createOrder({
        id: "order-demo-0001",
        number: "PED-COM-2026-0001",
        issuedAt: "2026-07-07",
        flightDate: "2026-07-09",
        status: "LISTO_BODEGA",
        warehouseStatus: "LIBERADO_BODEGA",
        warehouseReleasedAt: "2026-07-08 15:15",
        warehouseReleasedBy: "Usuario ventas demo",
        fulfillmentStatus: "LIBERADO_BODEGA",
        customerId: "customer-ursa",
        brandId: "brand-alex",
        packagingDemoStatus: "PREPARADO_DEMO",
        packagingPreparedAt: "2026-07-08",
        invoicePackingNumber: "60334",
        clientInvoiceNumber: "CINV-2026-0001",
        accountingPreview: {
          state: "LISTO_PARA_CONTABILIZAR_FUTURO",
          asientoPreviewId: "AS-PREV-PED-COM-2026-0001",
          cxcPreviewId: "CXC-PREV-PED-COM-2026-0001",
          generatedAt: "2026-07-08T14:30:00.000Z",
          generatedBy: "Usuario demo",
          readyAt: "2026-07-08T15:00:00.000Z",
          readyBy: "Usuario demo",
          observation: "Preview contable listo para contabilidad futura."
        },
        awb: "369-10693465",
        hawb: "PC607002439",
        airlineId: "air-atlas",
        flightNumber: "5Y 820",
        transportType: "aereo",
        coldRoom: "QCELL",
        paymentTerms: "0 dias",
        expireDate: "2026-07-07",
        generalPo: "URSA-GEN-2026",
        notes: "Pedido comercial demo para flujo URSA / ALEX.",
        lines: [
          { id: "line-demo-0001", boxNumber: 1, boxType: "HB", variety: "EXPLORER", po: "", length: 60, bunches: 8, stemsPerBunch: 25, unitPrice: 0.31, state: "confirmado" },
          { id: "line-demo-0002", boxNumber: 2, boxType: "HB", variety: "MONDIAL", po: "", length: 50, bunches: 10, stemsPerBunch: 25, unitPrice: 0.28, state: "confirmado" },
          { id: "line-demo-0003", boxNumber: 3, boxType: "HB", variety: "PLAYA BLANCA", po: "", length: 50, bunches: 6, stemsPerBunch: 25, unitPrice: 0.35, state: "reservado" }
        ]
      }),
      createOrder({
        id: "order-demo-0002",
        number: "PED-COM-2026-0002",
        issuedAt: "2026-07-07",
        flightDate: "2026-07-11",
        status: "VALIDADO_COMERCIAL",
        customerId: "customer-cvflor",
        brandId: "brand-del-real",
        awb: "045-77889900",
        hawb: "FR-2026-2209",
        airlineId: "air-latam",
        flightNumber: "LA 1450",
        transportType: "aereo",
        coldRoom: "COOL 4",
        paymentTerms: "15 dias",
        expireDate: "2026-07-12",
        generalPo: "ALG-PO-2209",
        clientInvoiceNumber: "CINV-2026-0002",
        notes: "Pedido demo con marca que requiere PO.",
        lines: [
          { id: "line-demo-0004", boxNumber: 1, boxType: "QB", variety: "BE SWEET", po: "ALG-PO-2209", length: 50, bunches: 8, stemsPerBunch: 25, unitPrice: 0.24, state: "confirmado" },
          { id: "line-demo-0005", boxNumber: 2, boxType: "QB", variety: "HOT EXPLORER", po: "", length: 60, bunches: 6, stemsPerBunch: 25, unitPrice: 0.32, state: "borrador" }
        ]
      }),
      createOrder({
        id: "order-demo-0003",
        number: "PED-COM-2026-0003",
        issuedAt: "2026-07-06",
        flightDate: "2026-07-08",
        status: "REFERENCIAL",
        customerId: "customer-sara",
        brandId: "brand-sg-jfe",
        transportType: "terrestre",
        coldRoom: "BODEGA 3",
        paymentTerms: "30 dias",
        expireDate: "2026-07-30",
        generalPo: "SG-LOCAL-001",
        notes: "Pedido local demo sin DAE.",
        lines: [
          { id: "line-demo-0006", boxNumber: 1, boxType: "HB", variety: "MANDALA", po: "SG-PO-01", length: 50, bunches: 4, stemsPerBunch: 25, unitPrice: 0.22, state: "reservado" }
        ]
      }),
      createOrder({
        id: "order-demo-0005",
        number: "PED-COM-2026-0005",
        issuedAt: "2026-07-10",
        flightDate: "2026-07-12",
        status: "LISTO_BODEGA",
        customerId: "customer-cvflor",
        brandId: "brand-del-real",
        destination: "REPUBLICA DOMINICANA",
        destinationCountry: "REPUBLICA DOMINICANA",
        daeNumber: "055-2026-40-00992586",
        daeDestination: "REPUBLICA DOMINICANA",
        daeExpirationDate: "2026-07-12",
        agencyId: "agency-fresh",
        airlineId: "air-latam",
        flightNumber: "LA 1450",
        transportType: "aereo",
        coldRoom: "COOL 4",
        warehouseStatus: "LIBERADO_BODEGA",
        fulfillmentStatus: "LIBERADO_BODEGA",
        warehouseReleasedAt: "2026-07-10 11:00",
        warehouseReleasedBy: "Ventas demo",
        demoValidationSeed: true,
        notes: "Pedido corto para validar el armado de dos cajas.",
        lines: [
          { id: "line-demo-validation-0001", boxNumber: 1, boxType: "QB", variety: "EXPLORER", length: 60, bunches: 3, stemsPerBunch: 25, unitPrice: 0.31, state: "confirmado" },
          { id: "line-demo-validation-0002", boxNumber: 2, boxType: "QB", variety: "MONDIAL", length: 50, bunches: 2, stemsPerBunch: 25, unitPrice: 0.28, state: "confirmado" }
        ]
      }),
      createOrder({
        id: "order-demo-0006",
        number: "PED-COM-2026-0006",
        issuedAt: "2026-07-10",
        flightDate: "2026-07-10",
        status: "LISTO_BODEGA",
        customerId: "customer-ursa",
        brandId: "brand-alex",
        destination: "KAZAJSTAN",
        destinationCountry: "KAZAJSTAN",
        daeNumber: "055-2026-40-01186707",
        daeDestination: "KAZAJSTAN",
        daeExpirationDate: "2026-07-20",
        agencyId: "agency-pacific",
        airlineId: "air-atlas",
        transportType: "aereo",
        coldRoom: "QCELL",
        warehouseStatus: "COMPLETO_BODEGA",
        fulfillmentStatus: "COMPLETO_BODEGA",
        warehouseReleasedAt: "2026-07-10 10:45",
        warehouseReleasedBy: "Ventas demo",
        warehouseCompletedAt: "2026-07-10 11:10",
        demoValidationSeed: true,
        notes: "Pedido completado para validar el historial de Bodega.",
        lines: [
          { id: "line-demo-history-0001", boxNumber: 1, boxType: "QB", variety: "NINA", length: 50, bunches: 2, stemsPerBunch: 25, unitPrice: 0.25, state: "confirmado", fulfillmentStatus: "COMPLETA", scannedBunches: [
            { code: "0000000401", inventoryId: "INV-VALID-0401", scannedAt: "2026-07-10 11:08" },
            { code: "0000000402", inventoryId: "INV-VALID-0402", scannedAt: "2026-07-10 11:10" }
          ] }
        ]
      })
    ];
  }

  function createCommercialStore() {
    return {
      orders: createSeedOrders(),
      reservations: [],
      customerCatalog: clone(customers),
      brandCatalog: clone(brands),
      agencyCatalog: clone(agencies),
      airlineCatalog: clone(airlines),
      daeCatalog: clone(daes),
      destinationCatalog: clone(destinations),
      ui: {
        currentOrderId: "order-demo-0004",
        orderTab: "summary",
        packagingViewMode: "material",
        availabilityFilterVariety: "",
        availabilityFilterLength: "",
        availabilityFilterCategory: "",
        availabilityFilterWarehouse: "",
        availabilityFilterState: "",
        availabilityReserveDrafts: {},
        reservationLineDrafts: {},
        boxRangeDrafts: {},
        labelPrintMode: "all",
        labelFromBox: 1,
        labelToBox: 1,
        labelSingleBox: 1,
        clientInvoiceViewMode: "grouped",
        clientInvoiceShowCustomer: true,
        clientInvoiceShowBrand: true,
        accountingPreviewView: "summary",
        ordersDayDate: "",
        orderScanCode: "",
        orderDetailBox: 1,
        selectedCustomerId: "customer-ursa",
        customerDraft: createCustomer(customers.find(item => item.id === "customer-ursa") || customers[0]),
        selectedBrandId: "brand-alex",
        brandDraft: createBrand(brands.find(item => item.id === "brand-alex") || brands[0]),
        selectedAgencyId: "agency-pacific",
        agencyDraft: createAgency(agencies.find(item => item.id === "agency-pacific") || agencies[0]),
        selectedAirlineId: "air-atlas",
        airlineDraft: createAirline(airlines.find(item => item.id === "air-atlas") || airlines[0]),
        selectedDaeId: "dae-kazajstan-demo",
        daeDraft: createDae(daes.find(item => item.id === "dae-kazajstan-demo") || daes[0]),
        selectedDestinationId: "destination-kz",
        destinationDraft: createDestination(destinations.find(item => item.id === "destination-kz") || destinations[0]),
        historySearch: "",
        historyStatus: "TODOS",
        historyDateFrom: "",
        historyDateTo: "",
        historyCustomerId: "",
        historyBrandId: "",
        historyDestination: "",
        historyDae: "",
        historyBoxType: "",
        historyPo: "",
        notice: "",
        noticeTone: "info"
      }
    };
  }

  BlessERP.comercialData = {
    company,
    createAgency,
    createAirline,
    createBrand,
    createDae,
    createDestination,
    customers,
    brands,
    daes,
    destinations,
    agencies,
    airlines,
    products,
    varieties,
    boxTypes,
    materialStock,
    materialRules,
    availability,
    printDocs,
    createCustomer,
    createLine,
    createOrder,
    createSeedOrders,
    createCommercialStore,
    cloneData() {
      return {
        company: clone(company),
        customers: clone(customers),
        brands: clone(brands),
        daes: clone(daes),
        agencies: clone(agencies),
        airlines: clone(airlines),
        products: clone(products),
        varieties: clone(varieties),
        boxTypes: clone(boxTypes),
        materialStock: clone(materialStock),
        materialRules: clone(materialRules),
        availability: clone(availability),
        printDocs: clone(printDocs)
      };
    }
  };
})();
