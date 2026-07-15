(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function activeRoute(config) {
    return {
      status: "Base activa",
      future: false,
      ...config
    };
  }

  function placeholderRoute(config) {
    return {
      status: "Pendiente integracion",
      future: false,
      ...config
    };
  }

  function futureRoute(config) {
    return {
      status: "Fase futura: no implementado todavia",
      future: true,
      ...config
    };
  }

  function operationsRoute(config) {
    return {
      status: "Demo visual preparado",
      future: false,
      source: "Parte 1 POSCOSECHA",
      futureAction: "Conectar adapter controlado de Parte 1",
      ...config
    };
  }

  function commercialRoute(config) {
    return placeholderRoute({
      source: "Parte 3 EXPORTACIONES Y VENTA",
      futureAction: "Integrar pantalla del prototipo",
      ...config
    });
  }

  function commercialDemoRoute(config) {
    return {
      status: "Demo integrado",
      future: false,
      source: "Parte 3 EXPORTACIONES Y VENTA",
      futureAction: "Continuar adapter visual por dominio",
      ...config
    };
  }

  function commercialCatalogRoute(config) {
    return {
      status: "Demo catalogo",
      future: false,
      source: "Parte 3 EXPORTACIONES Y VENTA",
      futureAction: "Conectar CRUD cuando se apruebe la siguiente fase",
      ...config
    };
  }

  const menuGroups = [
    { id: "core", label: "Core del sistema", shortLabel: "CS", defaultRoute: "dashboard-home", groupIds: ["dashboard"] },
    { id: "operations", label: "Operaciones / Poscosecha", shortLabel: "OP", defaultRoute: "operations-postharvest", groupIds: ["operations"] },
    { id: "commercial", label: "Comercial / Exportaciones", shortLabel: "CE", defaultRoute: "commercial-panel", groupIds: ["commercial"] },
    { id: "administration", label: "Administración / Contabilidad", shortLabel: "AC", defaultRoute: "accounting-chart", groupIds: ["accounting", "purchases", "portfolios", "banks", "tax"] },
    { id: "materials-inventory", label: "Inventario suministros / empaque", shortLabel: "IE", defaultRoute: "inventory-summary", groupIds: ["inventory"] },
    { id: "reports", label: "Reportes", shortLabel: "RP", defaultRoute: "reports-dashboard", groupIds: ["reports"] },
    { id: "settings", label: "Configuración", shortLabel: "CF", defaultRoute: "settings-company", groupIds: ["settings"] },
    { id: "extensions", label: "Módulos futuros", shortLabel: "MF", defaultRoute: "extensions-home", groupIds: ["extensions"] }
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
          description: "Shell unico del ERP JAMES con estado de modulos, alertas y accesos rapidos.",
          checklist: [
            "Estado del shell unico",
            "Resumen de modulos registrados",
            "Alertas administrativas base",
            "Accesos rapidos a las areas activas"
          ]
        }),
        activeRoute({
          id: "core-diagnostics",
          label: "Diagnóstico / Estado del ERP",
          title: "Diagnóstico / Estado del ERP",
          description: "Pantalla central de verificacion del shell, modulos activos, placeholders, fuentes tecnicas y advertencias.",
          checklist: [
            "Estado del shell unico",
            "Modulos activos y placeholder",
            "Fuentes tecnicas por parte",
            "Advertencias de integracion"
          ]
        }),
        activeRoute({
          id: "core-guided-demo",
          label: "Prueba guiada demo",
          title: "Prueba guiada demo/local del ERP unico",
          description: "Recorrido guiado para validar el ERP en modo demo/local sin tocar servicios reales, Supabase, SRI ni inventario real.",
          checklist: [
            "Recorrido completo del ERP demo/local",
            "Pasos manuales por Comercial, Operaciones y Contabilidad",
            "Registro local de observaciones y prioridad",
            "Confirmacion final de que no se activo nada real"
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
          description: "Panel visual base del modulo operativo para preparar la futura integracion de Parte 1 sin mover aun su logica pesada.",
          integrationRisk: "Acople alto con inventario de rosas, etiquetas y flujo operativo original.",
          checklist: [
            "Panel operativo compacto",
            "Tarjetas de integracion por frente",
            "Separacion respecto al inventario administrativo",
            "Base para futuras pantallas reales"
          ]
        }),
        operationsRoute({
          id: "operations-parameters",
          label: "Parámetros de Poscosecha",
          title: "Parámetros de Operaciones Poscosecha",
          description: "Catalogos maestros de proveedores, personal, variedades, longitudes, tipos de tallo y etiquetas.",
          integrationRisk: "Los registros usados deben conservar historial y desactivarse en lugar de eliminarse.",
          checklist: ["Proveedores", "Clasificadores y embonchadores", "Variedades y longitudes", "Tipos de tallo y etiqueta"]
        }),
        operationsRoute({
          id: "operations-reception",
          label: "Recepción de flor",
          title: "Recepción de flor",
          description: "Pantalla placeholder para lotes, proveedor, variedad, mallas y tallos recibidos.",
          integrationRisk: "La recepcion original esta unida a flujo operativo y trazabilidad de Parte 1.",
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
          description: "Pantalla placeholder para clasificacion por medida, calidad y categoria comercial.",
          integrationRisk: "La clasificacion original afecta rendimiento, inventario y etiquetas.",
          checklist: [
            "Clasificacion por medida",
            "Calidad comercial",
            "Descartes y novedades",
            "Relaciones con rendimiento"
          ]
        }),
        operationsRoute({
          id: "operations-labels",
          label: "Etiquetas de ramos",
          title: "Etiquetas de ramos",
          description: "Pantalla placeholder para digitacion, impresion de etiquetas y trazabilidad de ramos.",
          integrationRisk: "El flujo original depende de codigos, estados y herramientas de impresion.",
          checklist: [
            "Digitacion operativa",
            "Etiquetas de ramos",
            "Busqueda de etiquetas",
            "Base para scanner y Zebra"
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
          description: "Pantalla placeholder para disponibilidad real, etiquetas en frio y control de flor.",
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
            "Contrato con Pedido Maestro"
          ]
        }),
        operationsRoute({
          id: "operations-warehouse",
          label: "Bodega de rosas",
          title: "Bodega de rosas",
          description: "Bandeja de pedidos enviados por Comercial e historial de pedidos completados.",
          integrationRisk: "La bodega original esta ligada a inventario de rosas y despacho operativo.",
          checklist: [
            "Pedidos pendientes por preparar",
            "Orden de llegada",
            "Avance de cajas",
            "Historial de pedidos completados"
          ]
        }),
        operationsRoute({
          id: "operations-yields",
          label: "Rendimientos",
          title: "Rendimientos",
          description: "Pantalla placeholder para medir rendimiento por proveedor, variedad y proceso.",
          integrationRisk: "Los rendimientos originales dependen de clasificacion, lotes y recepcion.",
          checklist: [
            "Rendimiento por lote",
            "Indicadores por proveedor",
            "Mermas y observaciones",
            "Analisis operativo"
          ]
        }),
        operationsRoute({
          id: "operations-scanner",
          label: "Scanner / Zebra técnico",
          title: "Scanner / Zebra técnico",
          description: "Validacion compacta del lector HID y acceso a las estaciones de ingreso de ramos y armado en Bodega.",
          integrationRisk: "La integracion original depende de hardware y flujo de etiquetas en Parte 1.",
          checklist: [
            "Diagnostico de lectura HID",
            "Acceso a ingreso de ramos",
            "Acceso a Bodega / armado",
            "Historial tecnico"
          ]
        }),
        operationsRoute({
          id: "operations-dispatch",
          label: "Despacho operativo",
          title: "Despacho operativo",
          description: "Pantalla placeholder para cierre de cajas, salida operativa y trazabilidad de despacho.",
          integrationRisk: "El despacho original depende de bodega, cajas y trazabilidad operativa completa.",
          checklist: [
            "Despacho de cajas",
            "Destino operativo",
            "Control de salida",
            "Relacion con pedido futuro"
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
        commercialDemoRoute({
          id: "commercial-panel",
          label: "Panel comercial",
          title: "Panel comercial",
          description: "Modulo comercial demo integrado dentro del shell unico, desacoplado del prototipo monolitico original.",
          integrationRisk: "Aun faltan adapters para disponibilidad real, ventas-contabilidad y salidas documentales finales.",
          checklist: [
            "Panel comercial operativo",
            "Pedido Maestro modular",
            "Historial y previews demo",
            "Separacion frente a contabilidad"
          ]
        }),
        commercialDemoRoute({
          id: "commercial-orders-day",
          label: "Órdenes del día",
          title: "Órdenes del día",
          description: "Bandeja diaria de ordenes con avance por cajas, bunches escaneados y pendientes.",
          integrationRisk: "El armado es demo y no descuenta inventario real.",
          checklist: ["Ordenes por dia", "Avance de cajas", "Acceso al armado", "Sin cierre automatico"]
        }),
        commercialDemoRoute({
          id: "commercial-order-master",
          label: "Pedido Maestro",
          title: "Pedido Maestro",
          description: "Pantalla central del flujo comercial demo con cliente, marca, DAE, logistica, cajas, packing e impresion.",
          integrationRisk: "La disponibilidad real y la facturacion final aun no se conectan en esta fase.",
          checklist: [
            "Cliente principal y marca",
            "Logistica editable",
            "Cajas y variedades",
            "Centro de impresion demo"
          ]
        }),
        commercialDemoRoute({
          id: "commercial-order-detail",
          label: "Seguimiento de orden",
          title: "Seguimiento de orden",
          description: "Vista comercial de avance por cajas; el armado se consulta desde Bodega y se ejecuta en el detalle operativo del pedido.",
          integrationRisk: "No debe duplicar el escaneo operativo ni asignar flor desde Comercial.",
          checklist: ["Cajas desplegables", "Lineas por variedad y medida", "Avance de Bodega", "Acceso a Bodega"]
        }),
        commercialDemoRoute({
          id: "commercial-order-history",
          label: "Pedidos / Historial",
          title: "Pedidos / Historial",
          description: "Bandeja demo para seguimiento de pedidos, estados, vuelos y vistas de impresion.",
          integrationRisk: "La trazabilidad definitiva y la auditoria plena se completaran en una fase posterior.",
          checklist: [
            "Listado por fecha",
            "Estado del pedido",
            "Cliente y destino",
            "Acciones de continuidad"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-customers-brands",
          label: "Clientes principales",
          title: "Clientes principales",
          description: "Catalogo editable del cliente principal interno, sus datos comerciales y condiciones de credito.",
          integrationRisk: "El mantenimiento es local/demo y no conecta cartera ni facturacion real.",
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
          integrationRisk: "El mantenimiento es local/demo y las agencias siguen en su catalogo separado.",
          checklist: [
            "Cliente principal obligatorio",
            "Marca y razon social final",
            "Destino y datos operativos",
            "Agencia y reglas de PO"
          ]
        }),
        commercialDemoRoute({
          id: "commercial-availability-reservations",
          label: "Disponibilidad",
          title: "Disponibilidad para venta",
          description: "Inventario fisico disponible menos demanda pendiente de pedidos activos, sin reservar ramos individualmente.",
          integrationRisk: "No debe crear inventario ni modificar clasificacion operativa de Parte 1.",
          checklist: [
            "Consulta comercial de solo lectura",
            "Pedidos activos desde VALIDADO_COMERCIAL",
            "Disponibilidad real para venta",
            "Contrato con Operaciones"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-cargo-agencies",
          label: "Agencias de carga",
          title: "Agencias de carga",
          description: "Catalogo demo de agencias de carga y cuartos frios sugeridos.",
          integrationRisk: "La coordinacion operativa final aun no se desacopla por completo.",
          checklist: [
            "Agencias de carga",
            "Coordinacion",
            "Datos de contacto",
            "Base para embarques"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-destinations",
          label: "Destinos / Países",
          title: "Destinos / Países",
          description: "Catalogo editable de destinos, paises y transporte sugerido para Marca, DAE y Pedido Maestro.",
          integrationRisk: "El catalogo es local/demo y no conecta fuentes aduaneras externas.",
          checklist: ["Codigo de destino", "Pais relacionado", "Transporte sugerido", "Uso en Marca y DAE"]
        }),
        commercialCatalogRoute({
          id: "commercial-daes",
          label: "DAEs",
          title: "DAE / Aduana",
          description: "Catalogo demo de DAEs activas y su caducidad para autoasignacion desde Pedido Maestro.",
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
          description: "Catalogo demo de lineas aereas y prefijos AWB.",
          integrationRisk: "La linea aerea definitiva debera coordinarse luego con salidas documentales reales.",
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
          integrationRisk: "No crea variedades ni inventario; depende del catalogo maestro operativo local/demo.",
          checklist: [
            "Variedades activas de Operaciones",
            "Genero y especie",
            "Codigos HTS y NANDINA",
            "Fuente unica para Pedido Maestro"
          ]
        }),
        commercialCatalogRoute({
          id: "commercial-box-types",
          label: "Tipos de caja",
          title: "Tipos de caja",
          description: "Catalogo predeterminado de tipos de box, equivalencias y pesos usados por Pedido Maestro.",
          integrationRisk: "Los tipos son base del pedido y no deben editarse sin revisar empaque, documentos y reportes.",
          checklist: ["Codigos FB/HB/QB/EB/JB", "Conversion a full", "Pesos", "Uso en Pedido Maestro"]
        }),
        commercialDemoRoute({
          id: "commercial-invoice-packing",
          label: "Invoice / Packing carguera",
          title: "Invoice / Packing carguera",
          description: "Preview demo dinamico del documento carguera basado en el Pedido Maestro activo.",
          integrationRisk: "No debe confundirse con factura cliente ni con facturacion SRI real.",
          checklist: [
            "Documento preliminar",
            "Totales de cajas",
            "Variedades y tallos",
            "Formato de impresion"
          ]
        }),
        commercialDemoRoute({
          id: "commercial-client-invoice",
          label: "Factura Comercial Cliente",
          title: "Factura Comercial Cliente",
          description: "Vista demo separada del Invoice / Packing carguera y de la futura factura SRI.",
          integrationRisk: "No debe confundirse con factura electronica autorizada ni generar CxC real en esta fase.",
          checklist: [
            "Documento comercial cliente",
            "Vista agrupada o detallada",
            "Impresion demo",
            "Sin SRI ni contabilidad real"
          ]
        }),
        commercialDemoRoute({
          id: "commercial-print-center",
          label: "Centro de impresión",
          title: "Centro de impresión",
          description: "Centro demo para agrupar packing, invoice, hoja de ruta, MP, etiquetas y control DAE.",
          integrationRisk: "La impresion final aun requiere plantillas definitivas y salidas reales aprobadas.",
          checklist: [
            "Packing",
            "Invoice",
            "Hoja de ruta",
            "Etiquetas"
          ]
        }),
        commercialRoute({
          id: "commercial-sri-authorization",
          label: "Autorización SRI futura",
          title: "Autorización SRI futura",
          description: "Pantalla placeholder para dejar reservado el frente tributario sin implementar SRI real.",
          integrationRisk: "No debe mezclarse con Invoice / Packing ni con contabilidad definitiva en esta fase.",
          checklist: [
            "Reservado para fase futura",
            "Sin SRI real",
            "Sin contabilidad automatica",
            "No implementar todavia"
          ]
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
            "Importacion y exportacion del plan"
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
            "Impresion y exportacion",
            "Detalle por documento origen"
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
            "Enlace a libro diario y origen"
          ]
        }),
        activeRoute({
          id: "accounting-financials",
          label: "Estados financieros",
          title: "Estados financieros",
          description: "Base para balance general, estado de resultados y reportes financieros.",
          checklist: [
            "Balance general",
            "Estado de resultados",
            "Comparativos por periodo",
            "Vista exportable para gerencia"
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
          label: "Pagos individuales",
          title: "Pagos individuales",
          description: "Registro futuro de pagos unitarios a proveedores u obligaciones.",
          checklist: [
            "Documento a pagar",
            "Cuenta de salida",
            "Comprobante y fecha",
            "Soporte y referencia"
          ]
        }),
        activeRoute({
          id: "portfolios-payments-bulk",
          label: "Pagos masivos",
          title: "Pagos masivos",
          description: "Base para operaciones de pago por lote y aplicacion multiple.",
          checklist: [
            "Seleccion multiple de documentos",
            "Total aplicado",
            "Cuenta bancaria o caja",
            "Comprobante consolidado"
          ]
        }),
        activeRoute({
          id: "portfolios-collections-single",
          label: "Cobros individuales",
          title: "Cobros individuales",
          description: "Cobros parciales o totales por cliente con asiento contable y enlace a bancos/caja.",
          checklist: [
            "Factura o documento por cobrar",
            "Banco o caja de ingreso",
            "Comprobante de cobro",
            "Relacion con Libro Diario y Mayor"
          ]
        }),
        activeRoute({
          id: "portfolios-collections-bulk",
          label: "Cobros masivos",
          title: "Cobros masivos",
          description: "Cobros por lote para varios documentos, con resumen, confirmacion y asiento unico.",
          checklist: [
            "Seleccion multiple de cuentas por cobrar",
            "Total aplicado",
            "Cuenta de ingreso",
            "Confirmacion del lote y reverso si aplica"
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
        futureRoute({
          id: "reports-commercial",
          label: "Reportes comerciales",
          title: "Reportes comerciales",
          description: "Reservado para la fase futura cuando se conecte la capa comercial y exportadora.",
          checklist: [
            "Pedidos y embarques",
            "Packing e invoice",
            "Ventas por cliente y destino",
            "No implementar todavia"
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
          description: "Datos generales de la empresa y parametros base del ERP unico.",
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
          description: "Bitacora interna de acciones importantes del ERP con filtros por modulo, usuario, fecha y resultado.",
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
          description: "Catalogo interno de numeracion para asientos, compras, pagos, cobros, bancos, inventario y ATS preliminar.",
          checklist: [
            "Series y numeracion",
            "Reserva de secuenciales",
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
          id: "settings-sri",
          label: "Parametros SRI",
          title: "Parametros SRI",
          description: "Panel reservado para datos SRI de la empresa sin tocar aun integracion real.",
          checklist: [
            "Datos tributarios",
            "Establecimiento y punto de emision",
            "Ambiente y tipo de emision",
            "Preparacion para fase futura"
          ]
        })
      ]
    },
    {
      id: "extensions",
      label: "Módulos futuros",
      shortLabel: "MF",
      defaultRoute: "extensions-home",
      future: true,
      routes: [
        futureRoute({
          id: "extensions-home",
          label: "Mapa futuro",
          title: "Módulos futuros",
          description: "Espacio reservado para expansiones posteriores del ERP unico.",
          checklist: [
            "LLC USA",
            "CRM",
            "Marketing",
            "Costos y movil"
          ]
        }),
        futureRoute({
          id: "extensions-usa-llc",
          label: "LLC USA",
          title: "LLC USA",
          description: "Modulo futuro reservado para la operacion LLC USA.",
          checklist: [
            "Clientes y documentos",
            "Flujo internacional",
            "Reportes dedicados",
            "No implementar todavia"
          ]
        }),
        futureRoute({
          id: "extensions-crm",
          label: "CRM",
          title: "CRM",
          description: "Modulo futuro para seguimiento comercial y relacion con clientes.",
          checklist: [
            "Prospectos",
            "Seguimiento",
            "Actividades",
            "No implementar todavia"
          ]
        }),
        futureRoute({
          id: "extensions-marketing",
          label: "Marketing",
          title: "Marketing",
          description: "Espacio futuro para acciones comerciales y marketing.",
          checklist: [
            "Campanas",
            "Segmentos",
            "Analitica",
            "No implementar todavia"
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
