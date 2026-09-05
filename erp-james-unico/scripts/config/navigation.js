(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function activeRoute(config) {
    return {
      status: "Activo local",
      future: false,
      ...config
    };
  }

  function operationsRoute(config) {
    return {
      status: "Activo operativo",
      future: false,
      source: "Parte 1 POSCOSECHA",
      futureAction: "Mantener trazabilidad entre recepción, rendimiento, disponibilidad y cuarto frío",
      ...config
    };
  }

  function commercialRoute(config) {
    return {
      status: "Activo en pruebas",
      future: false,
      source: "Parte 3 EXPORTACIONES Y VENTA",
      futureAction: "Mantener producción bloqueada hasta completar la validación tributaria",
      ...config
    };
  }

  function commercialActiveRoute(config) {
    return {
      status: "Activo comercial",
      future: false,
      source: "Parte 3 EXPORTACIONES Y VENTA",
      futureAction: "Mantener el flujo comercial conectado y auditable",
      ...config
    };
  }

  function commercialCatalogRoute(config) {
    return {
      status: "Catálogo activo",
      future: false,
      source: "Parte 3 EXPORTACIONES Y VENTA",
      futureAction: "Conservar referencias históricas al editar catálogos",
      ...config
    };
  }

  const menuGroups = [
    { id: "core", label: "Core del sistema", shortLabel: "CS", defaultRoute: "dashboard-home", groupIds: ["dashboard"] },
    { id: "operations", label: "Operaciones / Poscosecha", shortLabel: "OP", defaultRoute: "operations-postharvest", groupIds: ["operations"] },
    { id: "commercial", label: "Comercial / Exportaciones", shortLabel: "CE", defaultRoute: "commercial-panel", groupIds: ["commercial"] },
    { id: "administration", label: "Administración / Contabilidad", shortLabel: "AC", defaultRoute: "payroll-generation", groupIds: ["payroll", "accounting", "purchases", "portfolios", "banks", "tax"] },
    { id: "materials-inventory", label: "Inventario suministros / empaque", shortLabel: "IE", defaultRoute: "inventory-summary", groupIds: ["inventory"] },
    { id: "reports", label: "Reportes", shortLabel: "RP", defaultRoute: "reports-dashboard", groupIds: ["reports"] },
    { id: "settings", label: "Configuración", shortLabel: "CF", defaultRoute: "settings-company", groupIds: ["settings"] }
  ];

  const groups = [
    {
      id: "dashboard",
      label: "Core del sistema",
      shortLabel: "CS",
      defaultRoute: "dashboard-home",
      routes: [
        activeRoute({
          id: "dashboard-home",
          label: "Panel general",
          title: "Panel general",
      description: "Panel principal de JAEDER SYSTEMS con estado de modulos, alertas y accesos rapidos.",
          checklist: [
            "Estado del shell unico",
            "Resumen de modulos registrados",
            "Alertas administrativas base",
            "Accesos rapidos a las areas activas"
          ]
        }),
        activeRoute({
          id: "core-diagnostics",
      label: "Diagnóstico / Estado del sistema",
      title: "Diagnóstico / Estado de JAEDER SYSTEMS",
          description: "Pantalla central de verificación del shell, módulos activos, conexiones, fuentes técnicas y límites del entorno.",
          checklist: [
            "Estado del shell unico",
            "Modulos activos y conexiones",
            "Fuentes tecnicas por parte",
            "Advertencias de integracion"
          ]
        })
      ]
    },
    {
      id: "operations",
      label: "Operaciones / Poscosecha",
      shortLabel: "OP",
      defaultRoute: "operations-postharvest",
      routes: [
        operationsRoute({
          id: "operations-postharvest",
          label: "Panel operativo",
          title: "Panel operativo",
          description: "Panel operativo para recepción, clasificación, etiquetas, inventario, rendimiento, disponibilidad y cuarto frío.",
          integrationRisk: "Los cambios deben conservar la trazabilidad entre inventario de rosas, etiquetas, pedidos y nómina.",
          checklist: [
            "Panel operativo compacto",
            "Accesos por frente operativo",
            "Separacion respecto al inventario administrativo",
            "Estado del flujo diario"
          ]
        }),
        operationsRoute({
          id: "operations-parameters",
          label: "Parámetros de Poscosecha",
          title: "Parámetros de Operaciones Poscosecha",
          description: "Catalogos maestros de proveedores, personal, variedades, longitudes, tipos de tallo y etiquetas.",
          integrationRisk: "Los registros usados deben conservar historial y desactivarse en lugar de eliminarse.",
          checklist: ["Fincas / Bloques", "Clasificadores y embonchadores", "Variedades y longitudes", "Tipos de tallo y etiqueta"]
        }),
        operationsRoute({
          id: "operations-farms-blocks",
          label: "Fincas / Bloques",
          title: "Fincas y bloques de Poscosecha",
          description: "Catálogo canónico de fincas y bloques utilizados por Recepción y la trazabilidad operativa.",
          integrationRisk: "Cada bloque debe conservar su finca, company scope e historial canónico.",
          checklist: ["Fincas activas", "Bloques únicos", "Consulta server-side", "Gestión capability-aware"]
        }),
        operationsRoute({
          id: "operations-varieties",
          label: "Variedades",
          title: "Variedades de Poscosecha",
          description: "Catálogo canónico de variedades utilizado por Recepción, Clasificación, Etiquetas y Comercial.",
          integrationRisk: "Las variedades persistidas en Supabase son la autoridad y deben conservar referencias históricas.",
          checklist: ["Variedades activas", "Códigos canónicos", "Consulta server-side", "Gestión capability-aware"]
        }),
        operationsRoute({
          id: "operations-reception",
          label: "Recepción de flor",
          title: "Recepción de flor",
          description: "Registro de lotes, proveedor, variedad, mallas y tallos recibidos.",
          integrationRisk: "La recepción alimenta clasificación, rendimiento y trazabilidad del lote.",
          checklist: [
            "Lotes y proveedor",
            "Variedad y tallos",
            "Observaciones iniciales",
            "Trazabilidad base"
          ]
        }),
        operationsRoute({
          id: "operations-grading",
          label: "Clasificación",
          title: "Clasificación",
          description: "Registro de clasificación por medida, calidad y categoría comercial.",
          integrationRisk: "La clasificación alimenta rendimiento, inventario y etiquetas.",
          checklist: [
            "Clasificacion por medida",
            "Calidad comercial",
            "Descartes y novedades",
            "Relaciones con rendimiento"
          ]
        }),
        operationsRoute({
          id: "operations-labels",
          label: "Etiquetas Zebra",
          title: "Crear e imprimir etiquetas Zebra",
          description: "Digitación temporal de composición e impresión ZPL directa, sin guardar etiquetas ni modificar inventario.",
          integrationRisk: "La creación no persiste datos; el inventario nace únicamente cuando se escanea el código estructurado.",
          checklist: [
            "Digitacion operativa",
            "Tabla compacta de composición",
            "Autocompletado desde Poscosecha",
            "Impresión directa Zebra Browser Print"
          ]
        }),
        operationsRoute({
          id: "operations-bunch-intake",
          label: "Ingreso de ramos por escáner",
          title: "Ingreso de ramos por escáner Zebra",
          description: "Estacion exclusiva donde el primer escaneo valido de una etiqueta crea el ramo en inventario.",
          integrationRisk: "Debe ser idempotente: una etiqueta nunca puede crear dos ramos.",
          checklist: ["Codigo numerico de 10 digitos", "Recuperacion automatica de etiqueta", "Fecha oficial del escaneo", "Creacion unica del ramo"]
        }),
        operationsRoute({
          id: "operations-roses-inventory",
          label: "Inventario de rosas",
          title: "Inventario de rosas",
          description: "Inventario de ramos escaneados, etiquetas en frío, movimientos y control de flor.",
          integrationRisk: "No debe mezclarse con inventario administrativo ni con stock contable.",
          checklist: [
            "Inventario de flor",
            "Disponibilidad real",
            "Separado de suministros",
            "Base para demanda comercial"
          ]
        }),
        operationsRoute({
          id: "operations-availability",
          label: "Disponibilidad",
          title: "Disponibilidad",
          description: "Inventario escaneado disponible y demanda pendiente de pedidos activos desde VALIDADO_COMERCIAL.",
          integrationRisk: "Requiere adaptar inventario operativo sin permitir edicion desde Comercial.",
          checklist: [
            "Variedad y medida",
            "Tallos disponibles",
            "Demanda pendiente sin reservas",
            "Contrato con pedidos comerciales"
          ]
        }),
        operationsRoute({
          id: "operations-yields",
          label: "Rendimientos",
          title: "Rendimientos",
          description: "Rendimiento por proveedor y proceso, junto con los registros laborales de clasificadores y embonchadores.",
          integrationRisk: "El rendimiento laboral depende de tallos clasificados y bonches ingresados dentro del periodo.",
          checklist: [
            "Rendimiento por lote",
            "Indicadores por proveedor",
            "Mermas y observaciones",
            "Analisis operativo"
          ]
        }),
        operationsRoute({
          id: "operations-yield-screen",
          label: "PANTALLA DE RENDIMIENTOS",
          title: "Pantalla de rendimientos",
          description: "Presentacion de produccion para television o monitor externo.",
          integrationRisk: "Solo lectura de rendimientos operativos registrados.",
          checklist: [
            "Top 3, Top 5 y resto de embonchadores",
            "Top 3, Top 5 y resto de clasificadores",
            "Actualizacion automatica",
            "Pantalla completa"
          ]
        }),
        operationsRoute({
          id: "operations-dispatch",
          label: "Cuarto frío",
          title: "Cuarto frío · Escáner de cajas",
          description: "Pedidos enviados desde Comercial, selección de caja y lectura automática de ramos con Zebra.",
          integrationRisk: "Integra pedidos, cajas, lectura HID y disponibilidad sin requerir confirmación de despacho.",
          checklist: [
            "Pedidos preparados por Comercial",
            "Escáner de cajas",
            "Avance guardado con cada lectura",
            "Caja y pedido completados automáticamente"
          ]
        })
      ]
    },
    {
      id: "commercial",
      label: "Comercial / Exportaciones",
      shortLabel: "CE",
      defaultRoute: "commercial-panel",
      routes: [
        commercialActiveRoute({
          id: "commercial-panel",
          label: "Panel comercial",
          title: "Panel comercial",
          description: "Panel de pedidos, catálogos, disponibilidad compartida, documentos e integración multiempresa.",
          integrationRisk: "La emisión SRI se mantiene en ambiente de pruebas; producción continúa bloqueada.",
          checklist: [
            "Panel comercial operativo",
            "Crear pedido y PO Nuevo",
            "Historial e impresión",
            "Disponibilidad compartida"
          ]
        }),
        commercialActiveRoute({
          id: "commercial-orders-day",
          label: "Órdenes del día",
          title: "Órdenes del día",
          description: "Bandeja diaria de ordenes con avance por cajas, bunches escaneados y pendientes.",
          integrationRisk: "El consumo físico depende del escaneo y del cierre operativo de Bodega.",
          checklist: ["Ordenes por dia", "Avance de cajas", "Acceso al armado", "Seguimiento operativo"]
        }),
        commercialActiveRoute({
          id: "commercial-preorders",
          label: "PO Nuevo",
          title: "PO Nuevo",
          description: "Borradores comerciales opcionales que pueden confirmarse y generar un pedido prellenado.",
          integrationRisk: "No afecta inventario, reservas, Bodega ni SRI; solo transfiere datos hacia Crear pedido.",
          checklist: [
            "Borrador independiente",
            "Confirmacion interna del PO",
            "Generacion de pedido prellenado",
            "Sin autorizacion SRI"
          ]
        }),
        commercialActiveRoute({
          id: "commercial-order-master",
          label: "Crear pedido",
          title: "Crear pedido",
          description: "Formulario central para crear pedidos y editar los pedidos abiertos desde el historial.",
          integrationRisk: "La disponibilidad se comparte con Poscosecha; la factura SRI se autoriza después desde su bandeja de pruebas.",
          checklist: [
            "Cliente principal y marca",
            "Logistica editable",
            "Cajas y variedades",
            "Edicion desde Pedidos / Historial"
          ]
        }),
        commercialActiveRoute({
          id: "commercial-order-detail",
          label: "Seguimiento de pedidos",
          title: "Seguimiento de pedidos",
          description: "Consulta separada del avance de Cuarto frío y coordinación diaria de guías y DAE.",
          integrationRisk: "Es una vista de consulta; no duplica el escaneo ni modifica inventario desde Comercial.",
          checklist: ["Estado de preparación", "Detalle por caja", "Composición real de mixtos abiertos", "Coordinación diaria"]
        }),
        commercialActiveRoute({
          id: "commercial-order-coordination",
          label: "Coordinación diaria",
          title: "Coordinación diaria",
          description: "Editor general por fecha para completar guías y DAE marítimas de los pedidos.",
          integrationRisk: "Actualiza el pedido original antes de crear el comprobante SRI; no duplica órdenes ni documentos.",
          checklist: ["Pedidos por fecha", "Guía madre", "Guía hija", "DAE marítima", "Guardado general"]
        }),
        commercialActiveRoute({
          id: "commercial-order-history",
          label: "Pedidos / Historial",
          title: "Pedidos / Historial",
          description: "Bandeja central para seguimiento, seleccion e impresion directa de documentos comerciales.",
          integrationRisk: "Los pedidos se anulan con historial; no deben eliminarse físicamente ni reutilizar su secuencial.",
          checklist: [
            "Listado por fecha",
            "Estado del pedido",
            "Cliente y destino",
            "Impresion comercial masiva"
          ]
        }),
        commercialActiveRoute({
          id: "commercial-availability-reservations",
          label: "Disponibilidad",
          title: "Disponibilidad compartida",
          description: "Consulta el inventario físico de Bless Flower y descuenta la demanda activa de Bless e Imperio sin crear inventario propio en Imperio.",
          integrationRisk: "Imperio solo consulta y compromete disponibilidad comercial; el inventario físico continúa perteneciendo exclusivamente a Bless Flower.",
          checklist: [
            "Variedad y medida",
            "Ramos y tallos disponibles",
            "Demanda de Bless e Imperio",
            "Actualización automática entre dispositivos"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-customers-brands",
          label: "Clientes principales",
          title: "Clientes principales",
          description: "Catalogo editable del cliente principal interno, sus datos comerciales y condiciones de credito.",
          integrationRisk: "Los datos se guardan por empresa en el almacenamiento local y deben conservar sus referencias históricas.",
          checklist: [
            "Clientes internos",
            "Datos de contacto",
            "Condiciones de credito",
            "Relacion futura con cartera"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-brands",
          label: "Marcas / Clientes finales",
          title: "Marcas / Clientes finales",
          description: "Catalogo editable de marcas y clientes finales relacionados con un cliente principal.",
          integrationRisk: "Las agencias se administran en su catálogo separado y el destino debe provenir de la marca seleccionada.",
          checklist: [
            "Cliente principal obligatorio",
            "Marca y razon social final",
            "Destino y datos operativos",
            "Agencia y reglas de PO"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-cargo-agencies",
          label: "Agencias de carga",
          title: "Agencias de carga",
          description: "Catalogo editable de agencias de carga y cuartos frios sugeridos.",
          integrationRisk: "La coordinación con sistemas externos de la carguera continúa siendo manual.",
          checklist: [
            "Agencias de carga",
            "Coordinacion",
            "Datos de contacto",
            "Base para embarques"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-countries",
          label: "Paises",
          title: "Paises",
          description: "Catalogo único de países; cada país funciona también como destino para clientes finales, DAEs y pedidos.",
          integrationRisk: "Debe ser la unica fuente de paises del modulo comercial y conservar referencias historicas.",
          checklist: ["Codigo interno", "Nombre unico", "Estado activo o inactivo", "Uso en catalogos comerciales"]
        }),
        commercialCatalogRoute({
          id: "commercial-daes",
          label: "DAEs",
          title: "DAE / Aduana",
          description: "Catalogo editable de DAEs activas y su caducidad para asignación desde Crear pedido.",
          integrationRisk: "La parte aduanera debe mantenerse separada del SRI real y de SENAE automatizado.",
          checklist: [
            "Numero DAE",
            "Referencia aduanera",
            "Estado de control",
            "Base documental"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-airlines",
          label: "Líneas aéreas",
          title: "Líneas aéreas",
          description: "Catalogo editable de lineas aereas y prefijos AWB.",
          integrationRisk: "La línea aérea es opcional al crear la DAE y debe coincidir con los documentos del embarque.",
          checklist: [
            "Catalogo base",
            "Datos de vuelo",
            "Relacion con agencia",
            "Base para coordinacion"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-export-products",
          label: "Productos exportables",
          title: "Productos exportables",
          description: "Vista comercial de variedades activas provenientes de Parametros de Operaciones / Poscosecha.",
          integrationRisk: "Es una consulta: no crea variedades ni inventario y depende del catálogo maestro de Poscosecha.",
          checklist: [
            "Variedades activas de Operaciones",
            "Genero y especie",
            "Codigos HTS y NANDINA",
            "Fuente unica para Crear pedido"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-box-types",
          label: "Tipos de caja",
          title: "Tipos de caja",
          description: "Catalogo predeterminado de tipos de box, equivalencias y pesos usados al crear pedidos.",
          integrationRisk: "Los tipos son base del pedido y no deben editarse sin revisar empaque, documentos y reportes.",
          checklist: ["Codigos FB/HB/QB/EB/JB", "Conversion a full", "Pesos", "Uso en Crear pedido"]
        }),
        commercialRoute({
          id: "commercial-senae-liquidation",
          label: "Liquidación SENAE",
          title: "Liquidación SENAE V2",
          description: "Reporte read-only de facturas SRI autorizadas locales y de exportación por fecha de emisión.",
          integrationRisk: "Solo debe incluir facturas tipo 01 autorizadas de la empresa activa.",
          checklist: ["Rango por issue_date", "Facturas tipo 01 autorizadas", "Local y Exportador", "XLSX con identidad de empresa"]
        }),
        commercialRoute({
          id: "commercial-credit-notes",
          label: "Notas de crédito",
          title: "Notas de crédito",
          description: "Emisión total o parcial de notas de crédito vinculadas a facturas SRI autorizadas.",
          integrationRisk: "La cartera solo debe modificarse cuando la nota de crédito quede autorizada por el SRI.",
          checklist: [
            "Factura autorizada como documento origen",
            "Selección de variedades y cantidades",
            "Motivo obligatorio",
            "XML y RIDE de la nota autorizada"
          ]
        }),
        commercialRoute({
          id: "commercial-sri-authorization",
          label: "Documentos electrónicos SRI",
          title: "Documentos electrónicos SRI",
          description: "Bandeja de documentos para emisión y autorización SRI en ambiente de pruebas.",
          integrationRisk: "Producción permanece bloqueada hasta validar XML, firma P12 y respuestas oficiales.",
          checklist: [
            "Ficha técnica 2.34",
            "XML y XSD oficiales",
            "Firma P12 solo en backend",
            "Transmisión inmediata"
          ]
        })
      ]
    },
    {
      id: "payroll",
      label: "Rol de pagos",
      shortLabel: "RP",
      defaultRoute: "payroll-generation",
      routes: [
        activeRoute({
          id: "payroll-employees",
          label: "Personal y tarifas",
          title: "Personal y tarifas del rol",
          description: "Personal conectado con Parámetros de Poscosecha y valores básicos para calcular el rol.",
          checklist: ["Sin proveedores", "Clasificadores por tallos", "Embonchadores por bonches", "Tarifas fáciles de revisar"]
        }),
        activeRoute({
          id: "payroll-generation",
          label: "Crear rol",
          title: "Crear rol de pagos",
          description: "Seleccione el periodo y los trabajadores; el sistema calcula automáticamente sueldo, horas, rendimiento y comisiones.",
          checklist: ["Elegir periodo", "Seleccionar trabajadores", "Calcular y revisar", "Aprobar"]
        }),
        activeRoute({
          id: "payroll-approved",
          label: "Historial e impresión",
          title: "Historial e impresión del rol",
        description: "Consulte roles terminados, registre pagos e imprima el comprobante individual con la identidad de la empresa activa.",
          checklist: ["Consultar rol", "Registrar pago", "Imprimir individual o todos", "Anular con motivo"]
        })
      ]
    },
    {
      id: "accounting",
      label: "Contabilidad",
      shortLabel: "CO",
      defaultRoute: "accounting-chart",
      routes: [
        activeRoute({
          id: "accounting-chart",
          label: "Plan de cuentas",
          title: "Plan de cuentas",
          description: "Arbol contable, cuentas de movimiento, cuentas padre y estructura financiera base.",
          checklist: [
            "Arbol jerarquico desplegable",
            "Filtros por codigo y nombre",
            "Cuentas padre y cuentas de movimiento",
            "Creacion y edicion con auditoria"
          ]
        }),
        activeRoute({
          id: "accounting-sales",
          label: "Ventas contables",
          title: "Facturas de venta, cobros y retenciones",
          description: "Control contable de facturas autorizadas, notas de crédito, cobros y retenciones recibidas, sin mezclar pedidos comerciales.",
          checklist: [
            "Facturas SRI autorizadas",
            "Notas de crédito aplicadas",
            "Cobros y retenciones recibidas",
            "Saldos iniciales mediante XML"
          ]
        }),
        activeRoute({
          id: "accounting-journal",
          label: "Libro diario",
          title: "Libro diario",
          description: "Vista compacta de asientos con fecha, numero, descripcion, cuenta, debe y haber.",
          checklist: [
            "Asientos manuales y automaticos",
            "Filtros por fecha y origen",
            "Contabilizacion y anulacion",
            "Reversion con trazabilidad"
          ]
        }),
        activeRoute({
          id: "accounting-ledger",
          label: "Mayor general",
          title: "Mayor general",
          description: "Analisis por cuenta contable con movimientos, acumulados y saldo.",
          checklist: [
            "Consulta por cuenta",
            "Rangos de fecha",
            "Saldo acumulado",
            "Detalle de movimientos contabilizados"
          ]
        }),
        activeRoute({
          id: "accounting-financials",
          label: "Balance y estados",
          title: "Balance de comprobacion y estados financieros",
          description: "Balance de comprobacion, balance general y estado de resultados con control automatico de diferencias.",
          checklist: [
            "Balance general",
            "Estado de resultados",
            "Balance de comprobacion",
            "Movimiento por cuenta"
          ]
        })
      ]
    },
    {
      id: "purchases",
      label: "Compras",
      shortLabel: "CP",
      defaultRoute: "purchases-upload-xml",
      routes: [
        activeRoute({
          id: "purchases-upload-xml",
          label: "Subir XML compras",
          title: "Subir XML compras",
          description: "Recepcion y revision visual de XML de compras antes de cualquier contabilizacion real.",
          checklist: [
            "Carga individual y masiva",
            "Lectura de proveedor y autorizacion",
            "Revision previa del comprobante",
            "Separacion entre carga y contabilizacion"
          ]
        }),
        activeRoute({
          id: "purchases-providers",
          label: "Proveedores",
          title: "Proveedores de compras",
          description: "Catalogo de proveedores creado y actualizado automaticamente desde los XML de compra.",
          checklist: [
            "Creacion automatica por RUC",
            "Datos fiscales extraidos del XML",
            "Edicion y complemento de la ficha",
            "Relacion directa con compras y cuentas por pagar"
          ]
        }),
        activeRoute({
          id: "purchases-invoices",
          label: "Facturas de compra",
          title: "Facturas de compra",
          description: "Bandeja de documentos de compra con estados, revision y futura relacion con pagos.",
          checklist: [
            "Listado de documentos",
            "Estado y vencimiento",
            "Busqueda por proveedor o numero",
            "Vista resumen del comprobante"
          ]
        }),
        activeRoute({
          id: "purchases-manual",
          label: "Compras manuales",
          title: "Compras manuales",
          description: "Formulario amplio por secciones para registrar compras, gastos y servicios.",
          checklist: [
            "Formulario por pestanas",
            "Proveedor, direccion y soporte",
            "Totales y resumen",
            "Preparacion para retenciones y sustento"
          ]
        }),
        activeRoute({
          id: "purchases-supplier-settlements",
          label: "Liquidaciones",
          title: "Liquidaciones de proveedores y productores",
          description: "Convierte recepciones confirmadas en costos históricos y obligaciones por pagar sin duplicarlas.",
          checklist: [
            "Recepciones pendientes por proveedor",
            "Precio por tallo o ramo",
            "Liquidación y cuenta por pagar transaccionales",
            "Costo trazable desde la recepción"
          ]
        }),
        activeRoute({
          id: "purchases-withholdings-issued",
          label: "Retenciones emitidas",
          title: "Retenciones emitidas en compras",
          description: "Base para retenciones que se emiten al registrar compras y gastos.",
          checklist: [
            "Retenciones de renta e IVA",
            "Documento soporte",
            "Lineas y bases imponibles",
            "Resumen y exportacion futura"
          ]
        }),
        activeRoute({
          id: "purchases-retention-report",
          label: "Reporte de retenciones",
          title: "Reporte de retenciones",
          description: "Consulta tributaria bajo demanda de retenciones emitidas y recibidas.",
          checklist: [
            "Fechas tributarias inclusivas",
            "Emitidas y recibidas diferenciadas",
            "Resumen calculado en servidor",
            "Consulta y exportacion con los mismos filtros"
          ]
        }),
        activeRoute({
          id: "purchases-tax-supports",
          label: "Sustentos tributarios",
          title: "Sustentos tributarios",
          description: "Catalogo y seleccion de sustento tributario para compras y gastos.",
          checklist: [
            "Codigos de sustento",
            "Reglas por tipo de compra",
            "Sugerencias por pestana",
            "Validacion antes de guardar"
          ]
        })
      ]
    },
    {
      id: "portfolios",
      label: "Cartera",
      shortLabel: "CT",
      defaultRoute: "portfolios-suppliers",
      routes: [
        activeRoute({
          id: "portfolios-suppliers",
          label: "Proveedores",
          title: "Cartera de proveedores",
          description: "Vista base de obligaciones, vencimientos y estado por proveedor.",
          checklist: [
            "Antiguedad de saldos",
            "Documentos abiertos",
            "Cruce con pagos",
            "Alertas por vencimiento"
          ]
        }),
        activeRoute({
          id: "portfolios-customers",
          label: "Clientes",
          title: "Cartera de clientes",
          description: "Catalogo base de clientes y estructura para cuentas por cobrar manuales, saldos iniciales y futuras facturas.",
          checklist: [
            "Catalogo de clientes local y exterior",
            "Saldos por cliente",
            "Antiguedad y cobranza",
            "Preparado para integrarse con ventas futuras"
          ]
        }),
        activeRoute({
          id: "portfolios-ap",
          label: "Cuentas por pagar",
          title: "Cuentas por pagar",
          description: "Resumen de obligaciones abiertas, programacion y estado de pago.",
          checklist: [
            "Listado por proveedor",
            "Saldo pendiente",
            "Calendario de pagos",
            "Cruce con notas y pagos"
          ]
        }),
        activeRoute({
          id: "portfolios-ar",
          label: "Cuentas por cobrar",
          title: "Cuentas por cobrar",
          description: "Control de cartera de clientes con saldos iniciales, documentos manuales y ajustes de prueba.",
          checklist: [
            "Documentos manuales de cartera",
            "Saldo pendiente y vencido",
            "Cobranza y seguimiento",
            "Preparado para futuras facturas"
          ]
        }),
        activeRoute({
          id: "portfolios-payments-single",
          label: "Pagos",
          title: "Registrar pago",
          description: "Pantalla sencilla para escoger la obligación, indicar cómo se pagó y guardar.",
          checklist: [
            "Documento a pagar",
            "Cuenta de salida",
            "Comprobante y fecha",
            "Soporte y referencia"
          ]
        }),
        activeRoute({
          id: "portfolios-collections-single",
          label: "Cobros",
          title: "Registrar cobro",
          description: "Pantalla sencilla para escoger la factura, registrar el valor recibido y su banco o caja.",
          checklist: [
            "Factura o documento por cobrar",
            "Banco o caja de ingreso",
            "Comprobante de cobro",
            "Relacion con Libro Diario y Mayor"
          ]
        })
      ]
    },
    {
      id: "banks",
      label: "Bancos",
      shortLabel: "BK",
      defaultRoute: "banks-accounts",
      routes: [
        activeRoute({
          id: "banks-accounts",
          label: "Cuentas bancarias",
          title: "Cuentas bancarias",
          description: "Catalogo de bancos, cajas y cuentas financieras internas.",
          checklist: [
            "Bancos y cajas",
            "Relacion con plan de cuentas",
            "Estado y tipo de cuenta",
            "Saldo base y configuracion"
          ]
        }),
        activeRoute({
          id: "banks-movements",
          label: "Movimientos bancarios",
          title: "Movimientos bancarios",
          description: "Base para ingresos, egresos y control de movimientos financieros.",
          checklist: [
            "Ingresos y egresos",
            "Busqueda por cuenta y fecha",
            "Referencia y soporte",
            "Enlace futuro con cobros y pagos"
          ]
        }),
        activeRoute({
          id: "banks-reconciliation",
          label: "Conciliacion bancaria",
          title: "Conciliacion bancaria",
          description: "Panel para comparar movimientos internos contra extractos externos.",
          checklist: [
            "Carga de extractos",
            "Movimientos pendientes",
            "Cruce interno vs banco",
            "Resumen por cuenta"
          ]
        }),
        activeRoute({
          id: "banks-cash",
          label: "Cajas",
          title: "Cuentas de caja",
          description: "Caja general y cajas internas con saldo derivado de movimientos confirmados.",
          checklist: ["Cuenta contable", "Saldo inicial", "Ingresos y egresos", "Auditoria"]
        }),
        activeRoute({
          id: "banks-transfers",
          label: "Transferencias",
          title: "Transferencias de tesoreria",
          description: "Movimientos atomicos entre bancos y cajas.",
          checklist: ["Banco a banco", "Caja a banco", "Banco a caja", "Partida doble"]
        }),
        activeRoute({
          id: "banks-cash-flow",
          label: "Flujo de efectivo",
          title: "Flujo de efectivo",
          description: "Vista separada de movimientos reales y esperados.",
          checklist: ["Saldo inicial", "Ingresos", "Egresos", "Real versus esperado"]
        })
      ]
    },
    {
      id: "tax",
      label: "Tributario",
      shortLabel: "TR",
      defaultRoute: "tax-parameters",
      routes: [
        activeRoute({
          id: "tax-parameters",
          label: "Parametros de impuestos",
          title: "Parametros de impuestos",
          description: "Catalogos y reglas base para impuestos aplicables al modulo administrativo-contable actual.",
          checklist: [
            "IVA y otros impuestos",
            "Codigos y porcentajes",
            "Aplicacion por tipo de documento",
            "Base para validaciones"
          ]
        }),
        activeRoute({
          id: "tax-retention-parameters",
          label: "Parametros de retenciones",
          title: "Parametros de retenciones",
          description: "Configuracion de codigos, porcentajes y catalogos de retencion.",
          checklist: [
            "Retenciones de renta",
            "Retenciones de IVA",
            "Codigos y casilleros",
            "Base para automatizacion futura"
          ]
        }),
        activeRoute({
          id: "tax-withholdings-received",
          label: "Retenciones recibidas XML",
          title: "Retenciones recibidas por XML",
          description: "Recepcion y clasificacion visual de XML de retenciones recibidas.",
          checklist: [
            "Carga de XML",
            "Lectura de bases y codigos",
            "Revision del comprobante",
            "Bandeja tributaria"
          ]
        }),
        activeRoute({
          id: "tax-ats",
          label: "ATS",
          title: "ATS",
          description: "Preparacion y validacion base del ATS para revision interna y exportacion preliminar.",
          checklist: [
            "Periodo y frecuencia",
            "Datos de compras y ventas",
            "Retenciones relacionadas",
            "Validacion previa"
          ]
        })
      ]
    },
    {
      id: "inventory",
      label: "Inventario suministros / empaque",
      shortLabel: "IV",
      defaultRoute: "inventory-summary",
      routes: [
        activeRoute({
          id: "inventory-summary",
          label: "Resumen",
          title: "Inventario de suministros y empaque",
          description: "Resumen y parametrizacion de materiales, suministros e ingresos de compras para el inventario administrativo.",
          checklist: [
            "Reporte por tipo de material o suministro",
            "Parametrizacion de productos e insumos",
            "Bodegas y responsables",
            "Alertas de compras pendientes de ingreso"
          ]
        }),
        activeRoute({
          id: "inventory-purchase-entries",
          label: "Ingresos desde compras",
          title: "Ingresos desde compras",
          description: "Revision de facturas contabilizadas con lineas de inventario para registrar entradas reales a bodega sin duplicar asientos.",
          checklist: [
            "Facturas pendientes de ingreso",
            "Ingreso parcial o total por linea",
            "Relacion producto-compra-bodega",
            "Control de diferencias factura vs inventario"
          ]
        }),
        activeRoute({
          id: "inventory-kardex",
          label: "Kardex",
          title: "Kardex",
          description: "Historial de movimientos de inventario administrativo con saldo por item.",
          checklist: [
            "Entradas y salidas",
            "Filtro por item y fecha",
            "Saldo acumulado",
            "Documento origen"
          ]
        }),
        activeRoute({
          id: "inventory-consumptions",
          label: "Consumos al gasto/costo",
          title: "Consumos al gasto/costo",
          description: "Descarga futura de inventario administrativo hacia gasto o costo segun corresponda.",
          checklist: [
            "Consumo a gasto",
            "Consumo a costo",
            "Responsable y fecha",
            "Resumen por centro de costo"
          ]
        }),
        activeRoute({
          id: "inventory-adjustments",
          label: "Ajustes de inventario",
          title: "Ajustes de inventario",
          description: "Ajustes positivos y negativos con impacto en stock y asiento contable.",
          checklist: [
            "Ajuste por sobrante o faltante",
            "Cuenta contrapartida obligatoria",
            "Historial de anulaciones",
            "Preparado para cierres de bodega"
          ]
        })
      ]
    },
    {
      id: "reports",
      label: "Reportes",
      shortLabel: "RP",
      defaultRoute: "reports-dashboard",
      routes: [
        activeRoute({
          id: "reports-dashboard",
          label: "Panel gerencial",
          title: "Panel gerencial",
          description: "Tablero ejecutivo de reportes para contabilidad, compras, cartera, bancos e inventario administrativo.",
          checklist: [
            "Tarjetas de resumen por modulo",
            "Filtros generales por periodo",
            "Alertas de control",
            "Acceso rapido a reportes detallados"
          ]
        }),
        activeRoute({
          id: "reports-accounting",
          label: "Reportes contables",
          title: "Reportes contables",
          description: "Reportes base de libro diario, mayor y estados financieros.",
          checklist: [
            "Libro diario exportable",
            "Mayor general",
            "Balances",
            "Resumen ejecutivo"
          ]
        }),
        activeRoute({
          id: "reports-tax",
          label: "Reportes tributarios",
          title: "Reportes tributarios",
          description: "Reportes base de impuestos, retenciones y ATS.",
          checklist: [
            "Resumen de impuestos",
            "Resumen de retenciones",
            "Previo ATS",
            "Salida exportable"
          ]
        }),
        activeRoute({
          id: "reports-portfolio",
          label: "Reportes de cartera",
          title: "Reportes de cartera",
          description: "Reportes de antiguedad, vencimientos y estado de obligaciones.",
          checklist: [
            "Cartera por proveedor",
            "Cartera por cliente",
            "Vencimientos",
            "Concentracion por tercero"
          ]
        }),
        activeRoute({
          id: "reports-banks",
          label: "Reportes bancarios",
          title: "Reportes bancarios",
          description: "Reportes de saldos auxiliares, movimientos y conciliaciones bancarias.",
          checklist: [
            "Movimientos por cuenta bancaria",
            "Saldos auxiliares",
            "Conciliaciones abiertas y cerradas",
            "Preparado para exportacion"
          ]
        }),
        activeRoute({
          id: "reports-inventory",
          label: "Reportes de inventario",
          title: "Reportes de inventario",
          description: "Reportes de existencias, kardex y consumos administrativos.",
          checklist: [
            "Stock actual",
            "Bajo minimo",
            "Kardex resumido",
            "Consumos por periodo"
          ]
        }),
        activeRoute({
          id: "reports-commercial",
          label: "Reportes comerciales",
          title: "Reportes comerciales",
          description: "Rentabilidad de pedidos y ventas por rango de fechas, separada del Historial de pedidos.",
          checklist: [
            "Rentabilidad por pedido",
            "Detalle por variedad y medida",
            "Filtros por fecha",
            "Descarga XLSX bajo demanda"
          ]
        })
      ]
    },
    {
      id: "settings",
      label: "Configuración",
      shortLabel: "CF",
      defaultRoute: "settings-company",
      routes: [
        activeRoute({
          id: "settings-company",
          label: "Empresa",
          title: "Empresa",
      description: "Datos generales de la empresa y parametros base de JAEDER SYSTEMS.",
          checklist: [
            "Razon social y nombre comercial",
            "Periodo contable",
            "Moneda y zona horaria",
            "Datos visibles del entorno"
          ]
        }),
        activeRoute({
          id: "settings-users",
          label: "Usuarios",
          title: "Usuarios",
          description: "Referencia visual del usuario activo temporal para auditoria interna, sin login ni permisos reales en esta fase.",
          checklist: [
            "Usuarios visuales de prueba",
            "Cambio de usuario activo temporal",
            "Referencia de cargo y area",
            "Preparacion para auditoria"
          ]
        }),
        activeRoute({
          id: "settings-audit",
          label: "Auditoria",
          title: "Auditoria",
      description: "Bitacora interna de acciones importantes de JAEDER SYSTEMS con filtros por modulo, usuario, fecha y resultado.",
          checklist: [
            "Eventos importantes por modulo",
            "Filtro por usuario y accion",
            "Registro de exitos, bloqueos y errores",
            "Historial no editable"
          ]
        }),
        activeRoute({
          id: "settings-sequences",
          label: "Secuenciales",
          title: "Secuenciales",
          description: "Numeracion SRI por empresa, establecimiento, punto de emision y tipo de comprobante; incluye tambien los secuenciales internos.",
          checklist: [
            "Establecimiento y punto de emision por empresa",
            "Factura 01 y comprobante de retencion 07",
            "Control por documento",
            "Visor de proximos numeros"
          ]
        }),
        activeRoute({
          id: "settings-cost-centers",
          label: "Centros de costo",
          title: "Centros de costo",
          description: "Catalogo de centros de costo para compras, inventario y contabilidad.",
          checklist: [
            "Catalogo base",
            "Estado y responsable",
            "Clasificacion",
            "Uso futuro en asientos y consumos"
          ]
        }),
        activeRoute({
          id: "settings-synchronization",
          label: "Sincronización",
          title: "Centro de sincronización",
          description: "Operaciones pendientes, errores y conflictos persistentes entre dispositivos.",
          checklist: [
            "Estado permanente de la cola",
            "Resolución explícita de conflictos",
            "Reintento y recuperación desde Supabase",
            "Respaldo local antes de reemplazar datos"
          ]
        })
      ]
    }
  ];

  const menuGroupMap = Object.fromEntries(menuGroups.map(group => [group.id, group]));
  const groupMap = Object.fromEntries(groups.map(group => [group.id, group]));

  const groupToMenuMap = {};
  menuGroups.forEach(menuGroup => {
    menuGroup.groupIds.forEach(groupId => {
      groupToMenuMap[groupId] = menuGroup;
    });
  });

  const routes = groups.flatMap(group => group.routes.map(route => {
    const menuGroup = groupToMenuMap[group.id] || group;
    return {
      ...route,
      groupId: group.id,
      groupLabel: group.label,
      groupShortLabel: group.shortLabel,
      groupFuture: Boolean(group.future),
      menuId: menuGroup.id,
      menuLabel: menuGroup.label,
      menuShortLabel: menuGroup.shortLabel
    };
  }));

  const routeMap = Object.fromEntries(routes.map(route => [route.id, route]));

  BlessERP.navigation = {
    menuGroups,
    menuGroupMap,
    groups,
    routes,
    routeMap,
    groupMap,
    defaultRoute: "dashboard-home"
  };
})();
