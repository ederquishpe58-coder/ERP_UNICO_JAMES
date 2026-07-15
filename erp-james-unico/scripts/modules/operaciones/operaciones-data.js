(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function todayLocal() {
    const now = new Date();
    return new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
  }

  function totalDeclared(seed) {
    const meshCount = Number(seed.meshCount || 0);
    const stemsPerMesh = Number(seed.stemsPerMesh || 0);
    const extraStems = Number(seed.extraStems || 0);
    return (meshCount * stemsPerMesh) + extraStems;
  }

  function createReceptionDraft(seed = {}) {
    const draft = {
      id: "",
      date: todayLocal(),
      supplier: "FINCA CANGAHUA",
      block: "BQ-01",
      receptionist: "Juan S.",
      responsible: "Juan S.",
      observation: "",
      status: "BORRADOR",
      items: [],
      ...seed
    };
    draft.totalDeclared = (draft.items || []).reduce((sum, item) => sum + totalDeclared(item), 0);
    return draft;
  }

  function createReceptionItemDraft(seed = {}) {
    const draft = {
      id: "",
      variety: "EXPLORER",
      stemType: "LARGO",
      meshCount: 1,
      stemsPerMesh: 25,
      extraStems: 0,
      ...seed
    };
    draft.totalStems = totalDeclared(draft);
    return draft;
  }

  function createLabelDraft(seed = {}) {
    return {
      date: "2026-07-09",
      colorDay: "ROJO",
      supplier: "FINCA CANGAHUA",
      block: "BQ-01",
      buncher: "Pedro M.",
      variety: "EXPLORER",
      length: 50,
      category: "EXPORTACION",
      stemsPerBunch: 25,
      quantity: 24,
      labelType: "NORMAL",
      observation: "",
      ...seed
    };
  }

  function createScannerDraft(seed = {}) {
    return {
      type: "RAMO",
      code: "0000000002",
      moduleOrigin: "Etiquetas de ramos",
      observation: "",
      ...seed
    };
  }

  function createYieldMeshDraft(seed = {}) {
    return {
      date: "2026-07-10",
      supplier: "FINCA CANGAHUA",
      block: "BQ-01",
      variety: "EXPLORER",
      classifier: "Rocio T.",
      responsible: "Juan S.",
      meshCount: 18,
      extraStems: 12,
      observation: "",
      ...seed
    };
  }

  function createYieldScannerDraft(seed = {}) {
    return {
      date: "2026-07-10",
      code: "0000000002",
      classifier: "Rocio T.",
      buncher: "Pedro M.",
      responsible: "Juan S.",
      observation: "",
      ...seed
    };
  }

  function createParameterDraft(seed = {}) {
    return {
      id: "",
      type: "suppliers",
      code: "",
      name: "",
      assignedBlock: "",
      active: true,
      observation: "",
      ...seed
    };
  }

  function createClassificationAssignmentDraft(seed = {}) {
    return {
      receptionId: "REC-OPS-001",
      receptionItemId: "REC-ITEM-001",
      supplier: "FINCA CANGAHUA",
      block: "BQ-01",
      variety: "EXPLORER",
      classifier: "Rocio T.",
      meshCount: 1,
      extraStems: 0,
      observation: "",
      ...seed
    };
  }

  function createClassificationResultDraft(seed = {}) {
    return {
      assignmentId: "ASG-OPS-001",
      supplier: "FINCA CANGAHUA",
      block: "BQ-01",
      classifier: "Rocio T.",
      variety: "EXPLORER",
      nationalStems: 0,
      observation: "",
      ...seed
    };
  }

  function createBunchIntakeDraft(seed = {}) {
    return {
      code: "0000000002",
      responsible: "Juan S.",
      observation: "",
      ...seed
    };
  }

  function createMasterData() {
    const rows = (prefix, values) => values.map((name, index) => ({
      id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
      code: `${prefix}${String(index + 1).padStart(3, "0")}`,
      name,
      active: true,
      observation: "Parametro operativo local/demo."
    }));
    const suppliers = rows("PRO", ["FINCA CANGAHUA", "BLOSSOM HILLS", "SANTA ROSA FARMS"]);
    ["BQ-01", "BQ-02", "BLOQUE A"].forEach((block, index) => { suppliers[index].assignedBlock = block; });
    return {
      suppliers,
      classifiers: rows("CLA", ["Rocio T.", "Daniela C.", "Camila V."]),
      bunchers: rows("EMB", ["Pedro M.", "Eder Q.", "Mateo G."]),
      receptionists: rows("REC", ["Juan S.", "Andrea P.", "Mateo G."]),
      varieties: rows("VAR", ["EXPLORER", "MONDIAL", "PLAYA BLANCA", "PINK MONDIAL", "NINA", "QUICKSAND"]),
      lengths: rows("LON", ["40", "50", "60", "70"]),
      stemTypes: rows("TAL", ["LARGO", "CORTO"]),
      labelTypes: rows("ETQ", ["NORMAL", "MIXTA"])
    };
  }

  function createYieldWorkday(seed = {}) {
    return {
      date: "2026-07-10",
      status: "SIN_INICIAR",
      startedAt: "",
      pausedAt: "",
      resumedAt: "",
      endedAt: "",
      observation: "Jornada demo preparada para rendimientos.",
      ...seed
    };
  }

  function createYieldSettings(seed = {}) {
    return {
      workdayHours: 8,
      classifierDailyGoal: 233,
      classifierHourlyGoal: 29.1,
      buncherHourlyGoal: 25,
      buncherDailyGoal: 200,
      ...seed
    };
  }

  function createAvailabilityDemoEntries() {
    return [
      {
        availability_id: "AVL-OPS-001",
        fecha: "2026-07-09",
        fecha_ingreso_bodega: "2026-07-07",
        variedad: "EXPLORER",
        longitud: 50,
        tallos_por_ramo: 25,
        ramos_disponibles: 40,
        tallos_disponibles: 1000,
        bodega: "CUARTO FRIO 1",
        proveedor: "FINCA CANGAHUA",
        bloque: "BLOQUE 1",
        categoria: "EXPORTACION",
        estado: "DISPONIBLE",
        edad_dias: 2,
        observacion: "Disponibilidad exportacion demo lista para Comercial."
      },
      {
        availability_id: "AVL-OPS-002",
        fecha: "2026-07-09",
        fecha_ingreso_bodega: "2026-07-08",
        variedad: "PLAYA BLANCA",
        longitud: 50,
        tallos_por_ramo: 25,
        ramos_disponibles: 30,
        tallos_disponibles: 750,
        bodega: "CUARTO FRIO 1",
        proveedor: "SANTA ROSA FARMS",
        bloque: "BLOQUE 2",
        categoria: "EXPORTACION",
        estado: "DISPONIBLE",
        edad_dias: 1,
        observacion: "Lote fresco demo para reserva comercial."
      },
      {
        availability_id: "AVL-OPS-003",
        fecha: "2026-07-09",
        fecha_ingreso_bodega: "2026-07-05",
        variedad: "MONDIAL",
        longitud: 60,
        tallos_por_ramo: 25,
        ramos_disponibles: 20,
        tallos_disponibles: 500,
        bodega: "CUARTO FRIO 2",
        proveedor: "BLOSSOM HILLS",
        bloque: "BLOQUE 3",
        categoria: "EXPORTACION",
        estado: "DISPONIBLE",
        edad_dias: 4,
        observacion: "Disponible para pedidos con vuelo demo."
      },
      {
        availability_id: "AVL-OPS-004",
        fecha: "2026-07-09",
        fecha_ingreso_bodega: "2026-07-08",
        variedad: "EXPLORER",
        longitud: 40,
        tallos_por_ramo: 25,
        ramos_disponibles: 15,
        tallos_disponibles: 375,
        bodega: "CUARTO FRIO 2",
        proveedor: "FINCA CANGAHUA",
        bloque: "BLOQUE 4",
        categoria: "NACIONAL",
        estado: "DISPONIBLE",
        edad_dias: 1,
        observacion: "Visible pero no reservable para exportacion."
      },
      {
        availability_id: "AVL-OPS-005",
        fecha: "2026-07-09",
        fecha_ingreso_bodega: "2026-07-02",
        variedad: "CANDLELIGHT",
        longitud: 70,
        tallos_por_ramo: 25,
        ramos_disponibles: 10,
        tallos_disponibles: 250,
        bodega: "CUARTO FRIO 3",
        proveedor: "SUNRISE BLOOMS",
        bloque: "BLOQUE 5",
        categoria: "EXPORTACION",
        estado: "VENCIDO",
        edad_dias: 7,
        observacion: "Lote visible solo para advertencia demo."
      }
    ];
  }

  function createBoxValidationBunchesDemo() {
    const specs = [
      { start: 101, count: 10, variety: "EXPLORER", length: 60, supplier: "FINCA CANGAHUA", block: "BQ-01", buncher: "Pedro M.", admittedAt: "2026-07-10 08:30" },
      { start: 201, count: 12, variety: "MONDIAL", length: 50, supplier: "BLOSSOM HILLS", block: "BQ-02", buncher: "Eder Q.", admittedAt: "2026-07-10 09:00" },
      { start: 301, count: 8, variety: "PLAYA BLANCA", length: 50, supplier: "SANTA ROSA FARMS", block: "BLOQUE A", buncher: "Mateo G.", admittedAt: "2026-07-10 09:30" },
      { start: 401, count: 4, variety: "NINA", length: 50, supplier: "FINCA CANGAHUA", block: "BQ-01", buncher: "Pedro M.", admittedAt: "2026-07-10 10:00" },
      { start: 501, count: 8, variety: "BE SWEET", length: 50, supplier: "BLOSSOM HILLS", block: "BQ-02", buncher: "Eder Q.", admittedAt: "2026-07-10 10:20" },
      { start: 601, count: 6, variety: "HOT EXPLORER", length: 60, supplier: "FINCA CANGAHUA", block: "BQ-01", buncher: "Pedro M.", admittedAt: "2026-07-10 10:40" }
    ];
    const labels = [];
    const inventory = [];
    const entries = [];

    specs.forEach(spec => {
      for (let index = 0; index < spec.count; index += 1) {
        const sequence = spec.start + index;
        const code = String(sequence).padStart(10, "0");
        const suffix = String(sequence).padStart(4, "0");
        const labelId = `LBL-VALID-${suffix}`;
        const inventoryId = `INV-VALID-${suffix}`;
        const entryId = `RAMO-VALID-${suffix}`;
        const assignedToHistory = spec.variety === "NINA" && index < 2;
        const minute = String((Number(spec.admittedAt.slice(-2)) + index) % 60).padStart(2, "0");
        const admittedAt = `${spec.admittedAt.slice(0, -2)}${minute}`;
        labels.push({
          id: labelId,
          date: "2026-07-10",
          createdAt: admittedAt,
          printedAt: admittedAt,
          scannedAt: admittedAt,
          colorDay: "AZUL",
          supplier: spec.supplier,
          block: spec.block,
          buncher: spec.buncher,
          variety: spec.variety,
          length: spec.length,
          category: "EXPORTACION",
          stemsPerBunch: 25,
          quantity: 1,
          labelType: "NORMAL",
          code,
          state: "ESCANEADA",
          inventoryId,
          printCount: 1,
          demoValidationSeed: true,
          observation: "Ramo demo ingresado para validar el armado de cajas."
        });
        inventory.push({
          inventoryId,
          date: "2026-07-10",
          admittedAt,
          labelCode: code,
          variety: spec.variety,
          length: spec.length,
          stemsPerBunch: 25,
          bunches: 1,
          stems: 25,
          warehouse: "CUARTO FRIO 1",
          location: "PASILLO DEMO",
          supplier: spec.supplier,
          block: spec.block,
          ageDays: 1,
          category: "EXPORTACION",
          state: assignedToHistory ? "ASIGNADO_CAJA" : "DISPONIBLE",
          buncher: spec.buncher,
          responsible: "Juan S.",
          coldState: "ESTABLE",
          observation: "Inventario demo disponible para validar cajas.",
          sourceType: "ESCANEO_ETIQUETA",
          sourceBunchEntryId: entryId,
          sourceLabelId: labelId,
          sourceScannerEventId: `SCN-VALID-${suffix}`,
          assignedOrderId: assignedToHistory ? "order-demo-0006" : "",
          assignedBoxNumber: assignedToHistory ? 1 : "",
          assignedLineId: assignedToHistory ? "line-demo-history-0001" : "",
          assignedAt: assignedToHistory ? "2026-07-10 11:10" : "",
          demoValidationSeed: true
        });
        entries.push({
          id: entryId,
          date: "2026-07-10",
          code,
          supplier: spec.supplier,
          block: spec.block,
          variety: spec.variety,
          length: spec.length,
          stemsPerBunch: 25,
          classifier: "Rocio T.",
          buncher: spec.buncher,
          responsible: "Juan S.",
          state: "INGRESADO_POR_ESCANEO",
          observation: "Registro demo para prueba de armado de pedido.",
          registeredAt: admittedAt,
          labelId,
          inventoryId,
          demoValidationSeed: true
        });
      }
    });

    return { labels, inventory, entries };
  }

  function createOperationsStore() {
    const boxValidationBunches = createBoxValidationBunchesDemo();
    return {
      ui: {
        notice: "",
        noticeTone: "info",
        inventoryStateFilter: "TODOS",
        selectedAvailabilityId: "AVL-OPS-001",
        availabilityFilterVariety: "TODOS",
        availabilityFilterLength: "TODOS",
        availabilityFilterCategory: "TODOS",
        availabilityFilterWarehouse: "TODOS",
        availabilityFilterState: "TODOS",
        availabilityFilterAge: "TODOS",
        selectedDispatchOrderId: "order-demo-0001",
        dispatchViewMode: "list",
        dispatchDetailTab: "boxes",
        warehouseOrderId: "order-demo-0001",
        warehouseBoxNumber: 1,
        warehouseScanCode: "",
        warehouseOrderFilter: "ABIERTAS",
        warehouseLastScan: null,
        dispatchScanCode: "BOX-60334-001",
        dispatchAssemblyBoxNumber: 1,
        dispatchBunchScanCode: "",
        dispatchLastBunchScan: null,
        scannerDispatchPedidoId: "order-demo-0001",
        scannerDispatchCode: "BOX-60334-001",
        scannerHidInput: "",
        scannerTechnicalTab: "diagnostico",
        parameterType: "suppliers",
        parameterDraft: createParameterDraft(),
        classificationAssignmentDraft: createClassificationAssignmentDraft(),
        classificationResultDraft: createClassificationResultDraft(),
        bunchIntakeDraft: createBunchIntakeDraft(),
        lastBunchIntakeResult: null,
        yieldsView: "rendimientos",
        receptionHistoryMode: "DIA",
        receptionHistoryDate: "",
        receptionHistoryMonth: "",
        receptionHistorySupplier: "",
        receptionHistoryBlock: "",
        receptionHistoryVariety: "",
        receptionHistoryStatus: "",
        receptionHistoryView: "DETALLE",
        receptionSummaryGroup: "PROVEEDOR",
        receptionDraft: createReceptionDraft(),
        receptionItemDraft: createReceptionItemDraft(),
        labelDraft: createLabelDraft(),
        scannerDraft: createScannerDraft(),
        yieldMeshDraft: createYieldMeshDraft(),
        yieldScannerDraft: createYieldScannerDraft()
      },
      catalogs: {
        suppliers: [
          "FINCA CANGAHUA",
          "BLOSSOM HILLS",
          "SANTA ROSA FARMS"
        ],
        blocks: ["BQ-01", "BQ-02", "BLOQUE A", "BLOQUE C", "CUARTO FRIO 1"],
        varieties: [
          "EXPLORER",
          "MONDIAL",
          "PLAYA BLANCA",
          "PINK MONDIAL",
          "NINA",
          "QUICKSAND"
        ],
        lengths: [40, 50, 60, 70],
        categories: ["EXPORTACION", "NACIONAL", "RECHAZO"],
        dayColors: ["ROJO", "AZUL", "VERDE", "AMARILLO"],
        labelTypes: ["NORMAL", "MIXTA"],
        stemTypes: ["LARGO", "CORTO"],
        scanTypes: ["RAMO", "CAJA", "DESPACHO"],
        activities: ["CLASIFICACION", "EMBONCHADO", "EMPAQUE", "DESPACHO", "OTRO"],
        classifiers: ["Rocio T.", "Daniela C.", "Camila V."],
        bunchers: ["Pedro M.", "Eder Q.", "Mateo G."],
        receptionists: ["Juan S.", "Andrea P.", "Mateo G."],
        responsibles: ["Juan S.", "Andrea P.", "Marco A."],
        receptionStatuses: ["BORRADOR", "RECIBIDO", "EN_CLASIFICACION", "CERRADO", "OBSERVADO"],
        inventoryStates: ["DISPONIBLE", "ASIGNADO_CAJA", "DESPACHADO", "VENCIDO", "OBSERVADO"],
        yieldViews: ["rendimientos", "mallas", "ramos", "registros", "transiciones"]
      },
      masterData: createMasterData(),
      sequences: {
        bunchLabel: 4
      },
      yieldWorkday: createYieldWorkday({
        status: "EN_CURSO_DEMO",
        startedAt: "2026-07-10 07:00",
        observation: "Jornada demo iniciada para visualizar metas."
      }),
      yieldSettings: createYieldSettings(),
      availabilityDemo: createAvailabilityDemoEntries(),
      demoReservations: [],
      receptions: [
        {
          id: "REC-OPS-001",
          date: "2026-07-09",
          createdAt: "2026-07-09 06:45",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          variety: "EXPLORER",
          stemType: "LARGO",
          meshCount: 48,
          stemsPerMesh: 25,
          extraStems: 10,
          totalDeclared: 1210,
          receptionist: "Juan S.",
          responsible: "Juan S.",
          observation: "Ingreso de primera hora.",
          status: "RECIBIDO",
          items: [{ id: "REC-ITEM-001", variety: "EXPLORER", stemType: "LARGO", meshCount: 48, stemsPerMesh: 25, extraStems: 10, totalStems: 1210 }]
        },
        {
          id: "REC-OPS-002",
          date: "2026-07-09",
          createdAt: "2026-07-09 07:18",
          supplier: "BLOSSOM HILLS",
          block: "BQ-02",
          variety: "MONDIAL",
          stemType: "LARGO",
          meshCount: 36,
          stemsPerMesh: 25,
          extraStems: 0,
          totalDeclared: 900,
          receptionist: "Andrea P.",
          responsible: "Andrea P.",
          observation: "Lote con humedad controlada.",
          status: "EN_CLASIFICACION",
          items: [{ id: "REC-ITEM-002", variety: "MONDIAL", stemType: "LARGO", meshCount: 36, stemsPerMesh: 25, extraStems: 0, totalStems: 900 }]
        },
        {
          id: "REC-OPS-003",
          date: "2026-07-08",
          createdAt: "2026-07-08 16:10",
          supplier: "SANTA ROSA FARMS",
          block: "BLOQUE A",
          variety: "PLAYA BLANCA",
          stemType: "CORTO",
          meshCount: 28,
          stemsPerMesh: 25,
          extraStems: 15,
          totalDeclared: 715,
          receptionist: "Mateo G.",
          responsible: "Mateo G.",
          observation: "Diferencia de mallas registrada.",
          status: "RECIBIDO",
          items: [{ id: "REC-ITEM-003", variety: "PLAYA BLANCA", stemType: "CORTO", meshCount: 28, stemsPerMesh: 25, extraStems: 15, totalStems: 715 }]
        }
      ],
      classifierAssignments: [
        {
          id: "ASG-OPS-001",
          receptionId: "REC-OPS-001",
          receptionItemId: "REC-ITEM-001",
          dateTime: "2026-07-10 07:20",
          classifier: "Rocio T.",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          variety: "EXPLORER",
          stemType: "LARGO",
          meshCount: 18,
          stemsPerMesh: 25,
          extraStems: 12,
          totalStems: 462,
          nationalStems: 35,
          exportableStems: 427,
          status: "COMPLETADO",
          observation: "Entrega inicial al clasificador."
        },
        {
          id: "ASG-OPS-002",
          receptionId: "REC-OPS-002",
          receptionItemId: "REC-ITEM-002",
          dateTime: "2026-07-10 08:05",
          classifier: "Daniela C.",
          supplier: "BLOSSOM HILLS",
          block: "BQ-02",
          variety: "MONDIAL",
          stemType: "LARGO",
          meshCount: 12,
          stemsPerMesh: 25,
          extraStems: 0,
          totalStems: 300,
          nationalStems: 0,
          exportableStems: 300,
          status: "ENTREGADO",
          observation: "Pendiente registrar nacional o rechazo."
        }
      ],
      classificationResults: [
        {
          id: "RES-CLA-001",
          assignmentId: "ASG-OPS-001",
          dateTime: "2026-07-10 10:35",
          nationalStems: 35,
          exportableStems: 427,
          observation: "Nacional reportado al cerrar la entrega."
        }
      ],
      classifications: [
        {
          id: "CLA-OPS-001",
          receptionId: "REC-OPS-001",
          lotCode: "LOT-EXP-001",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          variety: "EXPLORER",
          classifier: "Rocio T.",
          length: 50,
          category: "EXPORTACION",
          bunches: 34,
          stemsPerBunch: 25,
          totalStems: 850,
          leftovers: 15,
          observation: "Tallo uniforme.",
          reviewStatus: "DEMO VISUAL"
        },
        {
          id: "CLA-OPS-002",
          receptionId: "REC-OPS-001",
          lotCode: "LOT-EXP-001",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          variety: "EXPLORER",
          classifier: "Rocio T.",
          length: 50,
          category: "NACIONAL",
          bunches: 10,
          stemsPerBunch: 25,
          totalStems: 250,
          leftovers: 20,
          observation: "Separo nacional por longitud.",
          reviewStatus: "DEMO VISUAL"
        },
        {
          id: "CLA-OPS-003",
          receptionId: "REC-OPS-002",
          lotCode: "LOT-MON-002",
          supplier: "BLOSSOM HILLS",
          block: "BQ-02",
          variety: "MONDIAL",
          classifier: "Pedro M.",
          length: 60,
          category: "EXPORTACION",
          bunches: 22,
          stemsPerBunch: 25,
          totalStems: 550,
          leftovers: 8,
          observation: "Pendiente segundo pase.",
          reviewStatus: "DEMO VISUAL"
        },
        {
          id: "CLA-OPS-004",
          receptionId: "REC-OPS-003",
          lotCode: "LOT-PLA-003",
          supplier: "SANTA ROSA FARMS",
          block: "BLOQUE A",
          variety: "PLAYA BLANCA",
          classifier: "Daniela C.",
          length: 50,
          category: "EXPORTACION",
          bunches: 16,
          stemsPerBunch: 25,
          totalStems: 400,
          leftovers: 0,
          observation: "Pendiente cierre con motivo por faltante.",
          reviewStatus: "DEMO VISUAL"
        }
      ],
      labelBatches: [
        {
          id: "LBL-SCAN-0001",
          date: "2026-07-09",
          createdAt: "2026-07-09 07:45",
          printedAt: "2026-07-09 07:46",
          scannedAt: "2026-07-10 08:12",
          colorDay: "ROJO",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          buncher: "Pedro M.",
          variety: "EXPLORER",
          length: 50,
          category: "EXPORTACION",
          stemsPerBunch: 25,
          quantity: 1,
          labelType: "NORMAL",
          code: "0000000001",
          state: "ESCANEADA",
          inventoryId: "INV-SCAN-0001",
          printCount: 1,
          observation: "Etiqueta utilizada al dia siguiente de su impresion."
        },
        {
          id: "LBL-SCAN-0002",
          date: "2026-07-10",
          createdAt: "2026-07-10 08:20",
          printedAt: "2026-07-10 08:21",
          scannedAt: "",
          colorDay: "AZUL",
          supplier: "BLOSSOM HILLS",
          block: "BQ-02",
          buncher: "Eder Q.",
          variety: "MONDIAL",
          length: 60,
          category: "EXPORTACION",
          stemsPerBunch: 25,
          quantity: 1,
          labelType: "NORMAL",
          code: "0000000002",
          state: "IMPRESA",
          inventoryId: "",
          printCount: 1,
          observation: "Lista para utilizarse cuando exista el ramo fisico."
        },
        {
          id: "LBL-SCAN-0003",
          date: "2026-07-10",
          createdAt: "2026-07-10 08:22",
          printedAt: "2026-07-10 08:23",
          scannedAt: "",
          colorDay: "AZUL",
          supplier: "SANTA ROSA FARMS",
          block: "BLOQUE A",
          buncher: "Mateo G.",
          variety: "PLAYA BLANCA",
          length: 50,
          category: "EXPORTACION",
          stemsPerBunch: 25,
          quantity: 1,
          labelType: "MIXTA",
          code: "0000000003",
          state: "IMPRESA",
          inventoryId: "",
          printCount: 1,
          observation: "Etiqueta mixta demo pendiente de definir composicion."
        },
        ...boxValidationBunches.labels
      ],
      roseInventory: [
        {
          inventoryId: "INV-SCAN-0001",
          date: "2026-07-10",
          admittedAt: "2026-07-10 08:12",
          labelCode: "0000000001",
          variety: "EXPLORER",
          length: 50,
          stemsPerBunch: 25,
          bunches: 1,
          stems: 25,
          warehouse: "CUARTO FRIO 1",
          location: "PASILLO A1",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          ageDays: 1,
          category: "EXPORTACION",
          state: "DISPONIBLE",
          buncher: "Pedro M.",
          responsible: "Juan S.",
          coldState: "ESTABLE",
          observation: "Ingreso creado exclusivamente por escaneo de etiqueta.",
          sourceType: "ESCANEO_ETIQUETA",
          sourceBunchEntryId: "RAMO-SCAN-0001",
          sourceLabelId: "LBL-SCAN-0001",
          sourceScannerEventId: "SCN-SCAN-0001"
        },
        ...boxValidationBunches.inventory
      ],
      performances: [
        {
          id: "REN-OPS-001",
          date: "2026-07-09",
          worker: "Rocio T.",
          activity: "CLASIFICACION",
          variety: "EXPLORER",
          bunches: 34,
          stems: 850,
          performancePerHour: 113,
          observation: "Buen ritmo sostenido."
        },
        {
          id: "REN-OPS-002",
          date: "2026-07-09",
          worker: "Pedro M.",
          activity: "EMBONCHADO",
          variety: "MONDIAL",
          bunches: 22,
          stems: 550,
          performancePerHour: 92,
          observation: "Pendiente apoyo en segundo turno."
        },
        {
          id: "REN-OPS-003",
          date: "2026-07-08",
          worker: "Daniela C.",
          activity: "DESPACHO",
          variety: "PLAYA BLANCA",
          bunches: 16,
          stems: 400,
          performancePerHour: 88,
          observation: "Se priorizo revision de cajas."
        }
      ],
      meshProcessingRecords: [
        {
          id: "MALLA-OPS-001",
          date: "2026-07-10",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          variety: "EXPLORER",
          classifier: "Rocio T.",
          responsible: "Juan S.",
          meshCount: 18,
          extraStems: 12,
          totalStems: 462,
          status: "PROCESADA_DEMO",
          observation: "Entrega inicial de mallas al clasificador.",
          registeredAt: "2026-07-10 07:20"
        },
        {
          id: "MALLA-OPS-002",
          date: "2026-07-10",
          supplier: "BLOSSOM HILLS",
          block: "BQ-02",
          variety: "MONDIAL",
          classifier: "Daniela C.",
          responsible: "Andrea P.",
          meshCount: 12,
          extraStems: 0,
          totalStems: 300,
          status: "PROCESADA_DEMO",
          observation: "Pendiente cierre de nacional.",
          registeredAt: "2026-07-10 08:05"
        }
      ],
      bunchEntries: [
        {
          id: "RAMO-SCAN-0001",
          date: "2026-07-10",
          code: "0000000001",
          supplier: "FINCA CANGAHUA",
          block: "BQ-01",
          variety: "EXPLORER",
          length: 50,
          stemsPerBunch: 25,
          classifier: "Rocio T.",
          buncher: "Pedro M.",
          responsible: "Juan S.",
          state: "INGRESADO_POR_ESCANEO",
          observation: "Ramo creado desde primer escaneo valido.",
          registeredAt: "2026-07-10 08:12",
          labelId: "LBL-SCAN-0001",
          inventoryId: "INV-SCAN-0001"
        },
        ...boxValidationBunches.entries
      ],
      scannerEvents: [
        {
          eventId: "SCN-SCAN-0001",
          dateTime: "2026-07-10 08:12",
          code: "0000000001",
          type: "RAMO",
          moduleOrigin: "Ingreso de ramos por escaner",
          result: "INVENTARIO_CREADO",
          user: "Juan S.",
          inventoryId: "INV-SCAN-0001",
          labelId: "LBL-SCAN-0001",
          observation: "Primer escaneo valido; inventario creado."
        },
        {
          eventId: "SCN-OPS-002",
          dateTime: "2026-07-09 09:45",
          code: "BOX-HB-0007",
          type: "CAJA",
          moduleOrigin: "Despacho operativo",
          result: "PENDIENTE VALIDACION DEMO",
          user: "Camila V.",
          observation: "Sin Zebra real conectada."
        }
      ],
      consumptionsDemo: [],
      kardexOperativoDemo: [],
      dispatches: [
        {
          id: "DSP-OPS-001",
          orderId: "order-demo-0001",
          pedido_id: "order-demo-0001",
          relatedOrder: "PED-COM-2026-0001",
          numero_pedido: "PED-COM-2026-0001",
          boxes: 4,
          bunchesShipped: 56,
          dispatchDate: "2026-07-10",
          responsible: "Marco A.",
          responsible_demo: "Marco A.",
          state: "EN_PREPARACION",
          estado_despacho: "EN_PREPARACION",
          observation: "Pendiente confirmacion comercial.",
          observacion: "Pendiente confirmacion comercial."
        },
        {
          id: "DSP-OPS-002",
          orderId: "order-demo-0002",
          pedido_id: "order-demo-0002",
          relatedOrder: "PED-COM-2026-0002",
          numero_pedido: "PED-COM-2026-0002",
          boxes: 2,
          bunchesShipped: 22,
          dispatchDate: "2026-07-09",
          responsible: "Camila V.",
          responsible_demo: "Camila V.",
          state: "LISTO_DESPACHO",
          estado_despacho: "LISTO_DESPACHO",
          observation: "Esperando hoja de ruta demo.",
          observacion: "Esperando hoja de ruta demo."
        }
      ]
    };
  }

  BlessERP.operacionesData = {
    createAvailabilityDemoEntries,
    createOperationsStore,
    createBunchIntakeDraft,
    createClassificationAssignmentDraft,
    createClassificationResultDraft,
    createMasterData,
    createParameterDraft,
    createReceptionDraft,
    createReceptionItemDraft,
    createLabelDraft,
    createScannerDraft,
    createYieldMeshDraft,
    createYieldScannerDraft,
    createYieldSettings,
    createYieldWorkday
  };
})();
