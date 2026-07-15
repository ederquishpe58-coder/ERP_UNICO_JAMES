(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const ADAPTER_STATUS = "PENDIENTE_INTEGRACION_REAL";
  const ADAPTER_MODE = "ADAPTADOR_DEMO";
  const SOURCE_NAME = "Parte 1 POSCOSECHA";
  const INVENTORY_STATES = [
    "DISPONIBLE",
    "RESERVADO_PARCIAL",
    "RESERVADO_TOTAL",
    "DESPACHADO",
    "VENCIDO",
    "OBSERVADO",
    "PENDIENTE_SINCRONIZACION"
  ];
  const AVAILABILITY_STATES = [
    "DISPONIBLE",
    "RESERVADO",
    "DESPACHADO",
    "VENCIDO",
    "OBSERVADO",
    "PENDIENTE_SINCRONIZACION"
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeUpper(value) {
    return normalizeText(value).toUpperCase();
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildEnvelope(message, payload = {}) {
    return {
      integration_name: SOURCE_NAME,
      status: ADAPTER_STATUS,
      mode: ADAPTER_MODE,
      source: SOURCE_NAME,
      real_connection: false,
      supabase_connection: false,
      appjs_imported: false,
      message,
      ...payload
    };
  }

  function getParte1IntegrationWarnings() {
    return [
      "No importar app.js completo de Parte 1 dentro del ERP unico.",
      "No depender de variables globales ni localStorage legado de Parte 1.",
      "No conectar Supabase ni inventario real en esta fase.",
      "El adapter solo prepara contratos, mapeos y validaciones demo.",
      "La disponibilidad real futura debe derivarse del inventario operativo de rosas."
    ];
  }

  function getDemoInventoryRawRows() {
    return [
      {
        id_lote: "P1-INV-0001",
        fecha_ingreso: "2026-07-09",
        variedad: "EXPLORER",
        longitud: 50,
        tallos_por_ramo: 25,
        ramos_iniciales: 18,
        tallos_iniciales: 450,
        ramos_disponibles: 12,
        tallos_disponibles: 300,
        ramos_reservados: 4,
        tallos_reservados: 100,
        ramos_consumidos: 2,
        tallos_consumidos: 50,
        bodega: "CUARTO FRIO A",
        proveedor: "BLOSSOM FARM",
        bloque: "B-12",
        categoria: "EXPORTACION",
        edad_dias: 2,
        estado: "DISPONIBLE",
        observacion: "Payload demo para validar mapeo Parte 1."
      },
      {
        id_lote: "P1-INV-0002",
        fecha_ingreso: "2026-07-08",
        variedad: "MONDIAL",
        longitud: 60,
        tallos_por_ramo: 25,
        ramos_iniciales: 14,
        tallos_iniciales: 350,
        ramos_disponibles: 6,
        tallos_disponibles: 150,
        ramos_reservados: 6,
        tallos_reservados: 150,
        ramos_consumidos: 2,
        tallos_consumidos: 50,
        bodega: "CUARTO FRIO B",
        proveedor: "SUNRISE ROSES",
        bloque: "M-04",
        categoria: "EXPORTACION",
        edad_dias: 3,
        estado: "RESERVADO_PARCIAL",
        observacion: "Fila demo para reservas futuras."
      }
    ];
  }

  function getDemoAvailabilityRawRows() {
    return [
      {
        availability_id: "P1-AVL-0001",
        source_record_id: "P1-INV-0001",
        fecha: "2026-07-09",
        variedad: "EXPLORER",
        longitud: 50,
        tallos_por_ramo: 25,
        ramos_disponibles: 12,
        tallos_disponibles: 300,
        bodega: "CUARTO FRIO A",
        proveedor: "BLOSSOM FARM",
        bloque: "B-12",
        categoria: "EXPORTACION",
        estado: "DISPONIBLE",
        edad_dias: 2,
        observacion: "Disponibilidad demo derivada del inventario operativo."
      },
      {
        availability_id: "P1-AVL-0002",
        source_record_id: "P1-INV-0002",
        fecha: "2026-07-08",
        variedad: "MONDIAL",
        longitud: 60,
        tallos_por_ramo: 25,
        ramos_disponibles: 6,
        tallos_disponibles: 150,
        bodega: "CUARTO FRIO B",
        proveedor: "SUNRISE ROSES",
        bloque: "M-04",
        categoria: "EXPORTACION",
        estado: "RESERVADO",
        edad_dias: 3,
        observacion: "Disponibilidad demo con reserva parcial."
      }
    ];
  }

  function getDemoRecepcionesRawRows() {
    return [
      {
        recepcion_id: "P1-REC-0001",
        fecha_recepcion: "2026-07-09",
        proveedor: "BLOSSOM FARM",
        bloque: "B-12",
        variedad: "EXPLORER",
        longitud: 50,
        ramos: 18,
        tallos_por_ramo: 25,
        estado: ADAPTER_STATUS
      }
    ];
  }

  function getDemoClasificacionRawRows() {
    return [
      {
        clasificacion_id: "P1-CLA-0001",
        fecha: "2026-07-09",
        variedad: "EXPLORER",
        longitud: 50,
        categoria: "EXPORTACION",
        ramos_clasificados: 18,
        estado: ADAPTER_STATUS
      }
    ];
  }

  function getDemoReservasRawRows() {
    return [
      {
        reservation_id: "P1-RSV-0001",
        pedido_id: "order-demo-0001",
        numero_pedido: "60334",
        availability_id: "P1-AVL-0001",
        variedad: "EXPLORER",
        longitud: 50,
        ramos_reservados: 4,
        tallos_reservados: 100,
        estado: ADAPTER_STATUS
      }
    ];
  }

  function getDemoDespachosRawRows() {
    return [
      {
        dispatch_id: "DSP-60334",
        pedido_id: "order-demo-0001",
        numero_pedido: "60334",
        cliente_principal: "URSA",
        marca_cliente_final: "ALEX",
        destino: "KAZAJSTAN",
        fecha_vuelo: "2026-07-10",
        dae: "055-2026-40-01186707",
        awb: "369-44556677",
        hawb: "HWB-60334",
        agencia_carga: "PACIFIC CARGO",
        carrier: "ATLAS",
        vuelo: "5Y-602",
        total_cajas: 3,
        total_fulls: 1.5,
        total_ramos: 8,
        total_tallos: 200,
        estado_pedido: "LISTO_DESPACHO",
        estado_despacho: ADAPTER_STATUS
      }
    ];
  }

  function getParte1AdapterStatus() {
    return {
      integration_name: SOURCE_NAME,
      status: ADAPTER_STATUS,
      mode: ADAPTER_MODE,
      source: SOURCE_NAME,
      real_connection: false,
      supabase_connection: false,
      appjs_imported: false,
      warnings: getParte1IntegrationWarnings(),
      supported_contracts: [
        "operationalInventoryContract",
        "availabilityContract",
        "reservationContract",
        "bunchLabelContract",
        "dispatchContract",
        "scannerEventContract",
        "operationalConsumptionContract"
      ]
    };
  }

  function validateParte1InventoryPayload(rawItem) {
    const item = rawItem || {};
    const normalizedItem = {
      source_record_id: normalizeText(item.source_record_id || item.id_lote || item.inventory_id || item.id || ""),
      fecha: normalizeText(item.fecha || item.fecha_ingreso || item.date || ""),
      variedad: normalizeUpper(item.variedad || item.variety),
      longitud: toNumber(item.longitud || item.length),
      tallos_por_ramo: toNumber(item.tallos_por_ramo || item.stems_per_bunch || item.stemsPerBunch),
      ramos_iniciales: toNumber(item.ramos_iniciales || item.initial_bunches || item.bunches),
      tallos_iniciales: toNumber(item.tallos_iniciales || item.initial_stems || item.stems),
      ramos_disponibles: toNumber(item.ramos_disponibles || item.available_bunches || item.bunches_available),
      tallos_disponibles: toNumber(item.tallos_disponibles || item.available_stems || item.stems_available),
      ramos_reservados: toNumber(item.ramos_reservados || item.reserved_bunches),
      tallos_reservados: toNumber(item.tallos_reservados || item.reserved_stems),
      ramos_consumidos: toNumber(item.ramos_consumidos || item.consumed_bunches),
      tallos_consumidos: toNumber(item.tallos_consumidos || item.consumed_stems),
      bodega: normalizeUpper(item.bodega || item.warehouse || item.ubicacion || item.location),
      proveedor: normalizeUpper(item.proveedor || item.supplier || item.finca),
      bloque: normalizeUpper(item.bloque || item.block || item.sector),
      categoria: normalizeUpper(item.categoria || item.category || "EXPORTACION"),
      edad_dias: toNumber(item.edad_dias || item.age_days || item.ageDays),
      estado: normalizeUpper(item.estado || item.state || "PENDIENTE_SINCRONIZACION"),
      observacion: normalizeText(item.observacion || item.observation || ""),
      updated_at: normalizeText(item.updated_at || item.updatedAt || new Date().toISOString())
    };

    const errors = [];
    const warnings = [];

    if (!normalizedItem.variedad) errors.push("Falta variedad.");
    if (!normalizedItem.longitud) errors.push("Falta longitud.");
    if (!Number.isFinite(normalizedItem.ramos_disponibles)) errors.push("Ramos disponibles no numerico.");
    if (!Number.isFinite(normalizedItem.tallos_por_ramo)) errors.push("Tallos por ramo no numerico.");
    if (!normalizedItem.bodega) errors.push("Falta bodega o ubicacion.");
    if (!INVENTORY_STATES.includes(normalizedItem.estado)) errors.push(`Estado invalido: ${normalizedItem.estado || "-"}.`);
    if (!normalizedItem.source_record_id) warnings.push("Falta source_record_id; usar id_lote o source_record_id.");
    if (!normalizedItem.fecha) warnings.push("Falta fecha de ingreso.");
    if (!normalizedItem.proveedor) warnings.push("Proveedor pendiente de homologacion.");
    if (!normalizedItem.bloque) warnings.push("Bloque pendiente de homologacion.");

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      normalizedItem
    };
  }

  function validateParte1AvailabilityPayload(rawItem) {
    const item = rawItem || {};
    const normalizedItem = {
      availability_id: normalizeText(item.availability_id || item.inventory_id || item.source_record_id || item.id || ""),
      source_record_id: normalizeText(item.source_record_id || item.inventory_id || item.id_lote || ""),
      fecha: normalizeText(item.fecha || item.date || ""),
      variedad: normalizeUpper(item.variedad || item.variety),
      longitud: toNumber(item.longitud || item.length),
      tallos_por_ramo: toNumber(item.tallos_por_ramo || item.stemsPerBunch || item.stems_per_bunch),
      ramos_disponibles: toNumber(item.ramos_disponibles || item.available_bunches || item.bunches),
      tallos_disponibles: toNumber(item.tallos_disponibles || item.available_stems || item.stems),
      bodega: normalizeUpper(item.bodega || item.warehouse),
      proveedor: normalizeUpper(item.proveedor || item.supplier),
      bloque: normalizeUpper(item.bloque || item.block),
      categoria: normalizeUpper(item.categoria || item.category),
      estado: normalizeUpper(item.estado || item.state || "PENDIENTE_SINCRONIZACION"),
      edad_dias: toNumber(item.edad_dias || item.age_days || item.ageDays),
      observacion: normalizeText(item.observacion || item.observation || "")
    };

    const errors = [];
    const warnings = [];

    if (!normalizedItem.availability_id && !normalizedItem.source_record_id) {
      errors.push("Falta availability_id o source_record_id.");
    }
    if (!normalizedItem.variedad) errors.push("Falta variedad.");
    if (!normalizedItem.longitud) errors.push("Falta longitud.");
    if (!Number.isFinite(normalizedItem.ramos_disponibles)) errors.push("Ramos disponibles no numerico.");
    if (!normalizedItem.categoria) errors.push("Falta categoria.");
    if (!AVAILABILITY_STATES.includes(normalizedItem.estado)) warnings.push(`Estado fuera del catalogo esperado: ${normalizedItem.estado || "-"}.`);
    if (!normalizedItem.bodega) warnings.push("Bodega pendiente de homologacion.");
    if (!normalizedItem.fecha) warnings.push("Fecha pendiente de homologacion.");

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      normalizedItem
    };
  }

  function mapParte1InventoryToOperationalInventoryContract(rawItem) {
    const review = validateParte1InventoryPayload(rawItem);
    const item = review.normalizedItem;

    return {
      inventory_id: item.source_record_id || `INV-${Date.now()}`,
      source_system: SOURCE_NAME,
      source_record_id: item.source_record_id,
      fecha: item.fecha,
      variedad: item.variedad,
      longitud: item.longitud,
      tallos_por_ramo: item.tallos_por_ramo,
      ramos_iniciales: item.ramos_iniciales,
      tallos_iniciales: item.tallos_iniciales,
      ramos_disponibles: item.ramos_disponibles,
      tallos_disponibles: item.tallos_disponibles,
      ramos_reservados: item.ramos_reservados,
      tallos_reservados: item.tallos_reservados,
      ramos_consumidos: item.ramos_consumidos,
      tallos_consumidos: item.tallos_consumidos,
      bodega: item.bodega,
      proveedor: item.proveedor,
      bloque: item.bloque,
      categoria: item.categoria,
      edad_dias: item.edad_dias,
      estado: review.valid ? item.estado : "PENDIENTE_SINCRONIZACION",
      observacion: item.observacion || "Mapeo demo desde Parte 1 pendiente de conexion real.",
      updated_at: item.updated_at
    };
  }

  function mapParte1AvailabilityToAvailabilityContract(rawItem) {
    const review = validateParte1AvailabilityPayload(rawItem);
    const item = review.normalizedItem;

    return {
      availability_id: item.availability_id || item.source_record_id || `AVL-${Date.now()}`,
      fecha: item.fecha,
      variedad: item.variedad,
      longitud: item.longitud,
      tallos_por_ramo: item.tallos_por_ramo,
      ramos_disponibles: item.ramos_disponibles,
      tallos_disponibles: item.tallos_disponibles,
      ramos_reservados_demo: 0,
      tallos_reservados_demo: 0,
      ramos_saldo_demo: item.ramos_disponibles,
      tallos_saldo_demo: item.tallos_disponibles,
      bodega: item.bodega,
      proveedor: item.proveedor,
      bloque: item.bloque,
      categoria: item.categoria,
      estado: review.valid ? item.estado : "PENDIENTE_SINCRONIZACION",
      edad_dias: item.edad_dias,
      fecha_ingreso_bodega: item.fecha,
      observacion: item.observacion || "Disponibilidad demo derivada del inventario operativo de Parte 1."
    };
  }

  function mapParte1BunchLabelToBunchLabelContract(rawItem) {
    const item = rawItem || {};
    return {
      label_id: normalizeText(item.label_id || item.etiqueta_id || item.id || "P1-LBL-DEMO"),
      fecha: normalizeText(item.fecha || item.date || "2026-07-09"),
      color_dia: normalizeUpper(item.color_dia || item.day_color || "VERDE"),
      proveedor: normalizeUpper(item.proveedor || item.supplier || "PENDIENTE"),
      bloque: normalizeUpper(item.bloque || item.block || "PENDIENTE"),
      variedad: normalizeUpper(item.variedad || item.variety || "EXPLORER"),
      longitud: toNumber(item.longitud || item.length || 50),
      tallos_por_ramo: toNumber(item.tallos_por_ramo || item.stems_per_bunch || 25),
      tipo_etiqueta: normalizeUpper(item.tipo_etiqueta || item.label_type || "RAMO"),
      codigo_barra_futuro: normalizeText(item.codigo_barra_futuro || item.barcode_value || ""),
      estado: normalizeUpper(item.estado || item.state || ADAPTER_STATUS)
    };
  }

  function mapParte1DispatchToDispatchContract(rawItem) {
    const item = rawItem || {};
    return {
      dispatch_id: normalizeText(item.dispatch_id || item.id || "DSP-P1-DEMO"),
      pedido_id: normalizeText(item.pedido_id || item.order_id || ""),
      numero_pedido: normalizeText(item.numero_pedido || item.order_number || ""),
      cliente_principal: normalizeUpper(item.cliente_principal || item.main_customer || ""),
      marca_cliente_final: normalizeUpper(item.marca_cliente_final || item.brand || ""),
      destino: normalizeUpper(item.destino || item.destination || ""),
      fecha_vuelo: normalizeText(item.fecha_vuelo || item.flight_date || ""),
      dae: normalizeText(item.dae || item.dae_numero || ""),
      awb: normalizeText(item.awb || ""),
      hawb: normalizeText(item.hawb || ""),
      agencia_carga: normalizeUpper(item.agencia_carga || item.forwarder || ""),
      carrier: normalizeUpper(item.carrier || ""),
      vuelo: normalizeUpper(item.vuelo || item.flight || ""),
      total_cajas: toNumber(item.total_cajas || item.boxes || 0),
      total_fulls: toNumber(item.total_fulls || item.fulls || 0),
      total_ramos: toNumber(item.total_ramos || item.bunches || 0),
      total_tallos: toNumber(item.total_tallos || item.stems || 0),
      estado_pedido: normalizeUpper(item.estado_pedido || item.order_status || "PENDIENTE"),
      estado_despacho: normalizeUpper(item.estado_despacho || item.dispatch_status || ADAPTER_STATUS),
      observacion: normalizeText(item.observacion || item.observation || "Despacho demo pendiente de integracion real.")
    };
  }

  function loadRecepcionesFromParte1() {
    const rawRows = getDemoRecepcionesRawRows();
    return buildEnvelope("Recepciones Parte 1 pendientes de conexion real.", {
      rawRows: clone(rawRows),
      rows: clone(rawRows)
    });
  }

  function loadClasificacionFromParte1() {
    const rawRows = getDemoClasificacionRawRows();
    return buildEnvelope("Clasificacion Parte 1 pendiente de conexion real.", {
      rawRows: clone(rawRows),
      rows: clone(rawRows)
    });
  }

  function loadInventarioRosasFromParte1() {
    const rawRows = getDemoInventoryRawRows();
    return buildEnvelope("Inventario de rosas Parte 1 pendiente de conexion real.", {
      rawRows: clone(rawRows),
      mappedRows: rawRows.map(mapParte1InventoryToOperationalInventoryContract)
    });
  }

  function loadDisponibilidadFromParte1() {
    const rawRows = getDemoAvailabilityRawRows();
    return buildEnvelope("Disponibilidad Parte 1 pendiente de conexion real.", {
      rawRows: clone(rawRows),
      mappedRows: rawRows.map(mapParte1AvailabilityToAvailabilityContract)
    });
  }

  function loadReservasFromParte1() {
    const rawRows = getDemoReservasRawRows();
    return buildEnvelope("Reservas reales Parte 1 pendientes de integracion controlada.", {
      rawRows: clone(rawRows),
      rows: clone(rawRows)
    });
  }

  function loadDespachosFromParte1() {
    const rawRows = getDemoDespachosRawRows();
    return buildEnvelope("Despachos Parte 1 pendientes de integracion controlada.", {
      rawRows: clone(rawRows),
      mappedRows: rawRows.map(mapParte1DispatchToDispatchContract)
    });
  }

  BlessERP.operacionesParte1Adapter = {
    getParte1AdapterStatus,
    loadRecepcionesFromParte1,
    loadClasificacionFromParte1,
    loadInventarioRosasFromParte1,
    loadDisponibilidadFromParte1,
    loadReservasFromParte1,
    loadDespachosFromParte1,
    mapParte1InventoryToOperationalInventoryContract,
    mapParte1AvailabilityToAvailabilityContract,
    mapParte1BunchLabelToBunchLabelContract,
    mapParte1DispatchToDispatchContract,
    validateParte1InventoryPayload,
    validateParte1AvailabilityPayload,
    getParte1IntegrationWarnings
  };
})();
