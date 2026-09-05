(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const modules = [
    {
      id: "core",
      name: "Core del sistema",
      label: "Core del sistema",
      description: "Navegacion principal, almacenamiento local separado y registro modular de JAEDER SYSTEMS.",
      status: "activo",
      statusLabel: "Activo",
      group: "Core del sistema",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "dashboard-home / core-diagnostics",
      dependencies: ["scripts/config/navigation.js", "scripts/core/state.js", "scripts/ui/layout.js"],
      note: "Proyecto nuevo creado en la Fase 1 sobre shell unico.",
      source: "Proyecto nuevo",
      sourcePart: "Shell unico",
      summary: "Base comun del sistema para sidebar, topbar, content area y render del modulo activo.",
      owns: ["layout", "sidebar", "topbar", "state", "storage", "registry"],
      nextStep: "Mantener el shell estable mientras se conectan los modulos."
    },
    {
      id: "operaciones-poscosecha",
      name: "Operaciones / Poscosecha",
      label: "Operaciones / Poscosecha",
      description: "Modulo operativo integrado con parametros, recepcion, clasificacion, etiquetas numericas, ingreso por escaneo, inventario de rosas, disponibilidad, bodega, rendimientos y despacho.",
      status: "activo operativo",
      statusLabel: "Activo operativo",
      group: "Operaciones / Poscosecha",
      renderTarget: "BlessERP.modules.operaciones.render",
      componentAssigned: "scripts/modules/operaciones/*",
      dependencies: ["core", "module-contracts", "comercial-exportaciones"],
      note: "La persistencia remota permanece desactivada; el flujo operativo funciona con almacenamiento local.",
      source: "PARTE 1 POSCOSECHA.zip",
      sourcePart: "Parte 1",
      moduleType: "modulo operativo preparado",
      summary: "El inventario operativo nace exclusivamente del primer escaneo valido de una etiqueta numerica de ramo.",
      owns: ["parametros poscosecha", "recepcion", "clasificacion", "etiquetas de ramos", "ingreso por escaneo", "inventario de rosas", "disponibilidad", "bodega", "rendimientos", "scanner HID", "despacho"],
      nextStep: "Mantener validado el enlace entre rendimiento, disponibilidad y despacho.",
      contracts: [
        { id: "availabilityContract", status: "activo" },
        { id: "reservationContract", status: "activo" },
        { id: "dispatchContract", status: "activo" },
        { id: "operationalInventoryContract", status: "activo" },
        { id: "operationalConsumptionContract", status: "activo" },
        { id: "bunchLabelContract", status: "activo" },
        { id: "scannerEventContract", status: "activo local" }
      ]
    },
    {
      id: "comercial-exportaciones",
      name: "Comercial / Exportaciones",
      label: "Comercial / Exportaciones",
      description: "Modulo comercial integrado con PO Nuevo, Crear pedido, historial, catalogos, disponibilidad, impresion y preview contable.",
      status: "activo comercial",
      statusLabel: "Activo comercial",
      group: "Comercial / Exportaciones",
      renderTarget: "BlessERP.modules.comercial.render",
      componentAssigned: "scripts/modules/comercial/*",
      dependencies: [
        "core",
        "module-contracts",
        "operaciones-poscosecha"
      ],
      note: "Disponibilidad compartida con Poscosecha y facturacion electronica habilitada únicamente en ambiente TEST.",
      source: "PARTE 3 EXPORTACIONES Y VENTA.zip",
      sourcePart: "Parte 3",
      moduleType: "modulo comercial multiempresa",
      summary: "PO Nuevo, Crear pedido, historial, catalogos, despacho, documentos comerciales y preview contable dentro del shell unico.",
      owns: ["PO Nuevo", "Crear pedido", "clientes", "cajas", "bodega empaque", "invoice", "packing", "logistica", "preview contable"],
      nextStep: "Mantener producción SRI bloqueada hasta completar la validación tributaria.",
      contracts: [
        { id: "availabilityContract", status: "activo" },
        { id: "reservationContract", status: "activo" },
        { id: "commercialOrderContract", status: "activo" },
        { id: "commercialWorkflowContract", status: "activo" },
        { id: "boxLabelContract", status: "activo" },
        { id: "clientCommercialInvoiceContract", status: "activo" },
        { id: "packagingRequirementContract", status: "activo" },
        { id: "dispatchContract", status: "activo" },
        { id: "salesAccountingContract", status: "vista previa" }
      ]
    },
    {
      id: "contabilidad",
      name: "Administración / Contabilidad",
      label: "Administración / Contabilidad",
      description: "Base activa de la Parte 2 para compras, cartera, bancos, tributario y contabilidad dentro del shell unico.",
      status: "activo local",
      statusLabel: "Activo local",
      group: "Administración / Contabilidad",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "accounting-* / purchases-* / portfolios-* / banks-* / tax-*",
      dependencies: ["Core del sistema"],
      note: "Viene de Parte 2 CONTABILIDAD.zip y es la base tecnica activa de JAEDER SYSTEMS.",
      source: "PARTE 2 CONTABILIDAD.zip",
      sourcePart: "Parte 2",
      summary: "Base funcional actual para compras, cartera, bancos, contabilidad y tributario.",
      owns: ["compras", "cartera", "bancos", "contabilidad", "tributario"],
      nextStep: "Mantener funcionando mientras el shell unico agrupa la navegacion."
    },
    {
      id: "rol-pagos",
      name: "Rol de pagos",
      label: "Rol de pagos",
      description: "Nómina funcional conectada con empleados, Operaciones, Comercial, Contabilidad, Bancos, Caja, auditoría e impresión.",
      status: "activo local",
      statusLabel: "Activo local",
      group: "Administración / Contabilidad",
      renderTarget: "BlessERP.modules.payroll.render",
      componentAssigned: "scripts/modules/payroll/*",
      dependencies: ["core", "operaciones-poscosecha", "comercial-exportaciones", "contabilidad"],
      note: "Las obligaciones laborales futuras permanecen configurables y desactivadas por defecto.",
      source: "Modelo único Bless Flower",
      sourcePart: "Rol de pagos",
      moduleType: "modulo administrativo-contable",
      summary: "Calcula sueldo, horas, rendimiento, comisiones, novedades, devengo, pagos e impresión por periodo.",
      owns: ["empleados", "horas", "rendimiento para pago", "comisiones", "roles", "pagos", "impresion", "auditoria"],
      nextStep: "Validar el flujo completo y preparar activación Supabase en ambiente de prueba.",
      contracts: [
        { id: "employeeIdentityContract", status: "activo" },
        { id: "performancePayrollContract", status: "activo" },
        { id: "salesCommissionContract", status: "activo" },
        { id: "payrollAccountingContract", status: "activo" }
      ]
    },
    {
      id: "inventario-empaque",
      name: "Inventario suministros / empaque",
      label: "Inventario suministros / empaque",
      description: "Modulo activo para inventario administrativo, ingresos, kardex, consumos y ajustes.",
      status: "activo local",
      statusLabel: "Activo local",
      group: "Inventario suministros / empaque",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "inventory-*",
      dependencies: ["Core del sistema", "contabilidad"],
      note: "Viene de Parte 2 CONTABILIDAD.zip y debe permanecer separado del inventario de rosas.",
      source: "PARTE 2 CONTABILIDAD.zip",
      sourcePart: "Parte 2",
      summary: "Inventario administrativo separado del inventario de rosas de poscosecha.",
      owns: ["items", "ingresos", "kardex", "consumos", "ajustes"],
      nextStep: "Preparado para una conexion futura con Crear pedido sin mezclar inventario de rosas."
    },
    {
      id: "reportes",
      name: "Reportes",
      label: "Reportes",
      description: "Modulo activo o parcial para reportes ejecutivos, contables, tributarios, bancarios e inventario.",
      status: "activo local",
      statusLabel: "Activo local",
      group: "Reportes",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "reports-*",
      dependencies: ["Core del sistema", "contabilidad", "inventario-empaque"],
      note: "Viene de Parte 2 CONTABILIDAD.zip. Los reportes comerciales siguen en fase futura.",
      source: "PARTE 2 CONTABILIDAD.zip",
      sourcePart: "Parte 2",
      summary: "Reportes ejecutivos, contables, tributarios, bancarios e inventario base.",
      owns: ["dashboard", "reportes contables", "tributarios", "cartera", "inventario"],
      nextStep: "Extender luego con reportes operativos y comerciales."
    },
    {
      id: "configuracion",
      name: "Configuración",
      label: "Configuración",
      description: "Modulo activo o parcial para empresa, usuarios visuales, auditoria, secuenciales y parametros base.",
      status: "activo local",
      statusLabel: "Activo local",
      group: "Configuración",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "settings-*",
      dependencies: ["Core del sistema", "contabilidad"],
      note: "Viene de Parte 2 CONTABILIDAD.zip y centraliza parametros de JAEDER SYSTEMS.",
      source: "PARTE 2 CONTABILIDAD.zip",
      sourcePart: "Parte 2",
      summary: "Empresa, usuarios visuales, auditoria, secuenciales y parametros base.",
      owns: ["empresa", "usuarios", "auditoria", "secuenciales", "centros de costo"],
      nextStep: "Usar como punto unico de configuracion de JAEDER SYSTEMS."
    }
  ];

  const legacyDiagnostics = {
    shellStatus: "FASE 5C completada: prueba guiada operativo TEST preparada y JAEDER SYSTEMS estable en modo local/operativo",
    lastBuildText: "Manual: ejecutar npm run build, npm run build:standalone y npm run validate:shell despues de cada ajuste relevante.",
    generalStatus: {
      status: "activo",
      lines: [
        "Shell unico: activo",
        "Navegacion modular: activa",
        "Datos locales/operativo: activo",
        "Supabase real: pendiente",
        "Login real: pendiente",
        "Auditoria real: pendiente"
      ]
    },
    technicalSources: [
      { label: "Parte 1 Poscosecha", status: "operativo visual preparado", note: "Scanner Zebra HID automatico activo; Supabase y logica remota pendientes." },
      { label: "Parte 2 Contabilidad", status: "Base activa", note: "Shell unico construido sobre esta base tecnica." },
      { label: "Parte 3 Comercial", status: "operativo integrado", note: "Crear pedido, historial y documentos comerciales integrados en el flujo unificado." }
    ],
    warnings: [
      "No conectar Supabase todavia.",
      "No ejecutar SQL ni crear migraciones en esta fase.",
      "No integrar logica pesada sin fase aprobada.",
      "No mezclar modulos en un app.js monolitico.",
      "No llevar inventario de rosas dentro de contabilidad.",
      "Scanner Zebra operativo mediante teclado HID automatico; integracion remota pendiente.",
      "No implementar login real, permisos reales ni SRI real en esta fase."
    ],
    operationsStatus: {
      status: "operativo avanzado",
      origin: "Parte 1 POSCOSECHA",
      moduleType: "modulo operativo operativo avanzado",
      lines: [
        "Parametros de Poscosecha: activo operativo TEST",
        "Recepcion y clasificacion: activas operativo TEST",
        "Etiquetas numericas de 10 digitos: activas operativo",
        "Ingreso de ramos por escaneo: activo operativo",
        "Inventario nace solo por escaneo: activo operativo",
        "Disponibilidad derivada del inventario escaneado: activo operativo",
        "Rendimiento embonchador desde escaneos: activo operativo",
        "Reservas operativo: activo",
        "Despacho operativo: activo",
        "Lectura Zebra HID integrada en Ingreso de ramos y Despacho: activa",
        "Consumo operativo: activo",
        "Kardex operativo operativo: activo",
        "Parte 1 adapter: preparado",
        "Parte 1 real: pendiente",
        "Descuento inventario real: pendiente"
      ],
      contracts: [
        "availabilityContract operativo activo",
        "reservationContract operativo activo",
        "dispatchContract operativo activo",
        "scannerEventContract operativo activo",
        "operationalInventoryContract preparado",
        "operationalConsumptionContract activo operativo",
        "bunchLabelContract operativo visual"
      ]
    },
    commercialExportStatus: {
      status: "operativo avanzado",
      origin: "Parte 3 EXPORTACIONES Y VENTA",
      connections: [
        "Crear pedido: operativo activo",
        "Historial comercial: operativo activo",
        "Documentos comerciales: operativo activo",
        "Factura Comercial Cliente: operativo activo",
        "Preview contable ventas: operativo activo",
        "Conexion contable de facturas SRI autorizadas: activa",
        "Facturacion SRI ventas: pendiente"
      ],
      workflow: [
        "Flujo comercial del pedido: operativo activo",
        "Reservas operativo desde Crear pedido: activo",
        "Despacho operativo sincronizado con Operaciones: activo",
        "Checklist despacho unificado: activo",
        "Estado DESPACHADO visual: activo",
        "Auditoria real: pendiente"
      ],
      accountingPreview: [
        "Preview contable ventas: operativo activo",
        "Vista previa: no afecta Libro Diario ni Mayor General",
        "CxC desde factura SRI autorizada: activa",
        "Asiento de venta idempotente: activo",
        "salesAccountingContract: operativo"
      ],
      warehousePackaging: [
        "Bodega empaque comercial: operativo conectado",
        "Inventario real materiales por despacho: pendiente",
        "Consumo real materiales: pendiente"
      ],
      dispatchStatus: [
        "Despacho operativo desde Comercial: activo",
        "Sincronizacion con Operaciones / Despacho: operativo activa",
        "Escaneo operativo visible desde Crear pedido: activo",
        "Consumo operativo visible desde Crear pedido: activo",
        "Inventario real Parte 1: pendiente",
        "Scanner Zebra HID automatico: activo local"
      ],
      printables: [
        "Documentos imprimibles operativo: activo",
        "Invoice / Packing carguera: operativo activo",
        "Factura Comercial Cliente operativo: activo",
        "Packing List: operativo activo",
        "HR / Hoja de Ruta: operativo activo",
        "MP / Master Packing: operativo activo",
        "Etiquetas de caja operativo: activo",
        "Centro de impresion: operativo activo",
        "Factura SRI exportacion: pendiente",
        "PDF real: pendiente",
        "SRI ventas: pendiente"
      ]
    },
    accountingStatus: {
      status: "activo operativo TEST",
      lines: [
        "Plan de cuentas: activo local/operativo",
        "Libro diario / mayor: activo local/operativo",
        "Compras: activo local/operativo",
        "Retenciones: activo local/operativo",
        "Bancos / CxP / CxC: activo local/operativo",
        "ATS preliminar: activo operativo",
        "Ventas SRI autorizadas a CxC y Libro Diario: activas"
      ]
    },
    inventoryMaterialsStatus: {
      status: "activo operativo TEST",
      lines: [
        "Inventario materiales: activo local/operativo",
        "Bodega empaque comercial: operativo conectado",
        "Consumo real materiales por despacho: pendiente"
      ]
    },
    pendingTechnicalStatus: {
      status: "pendiente",
      lines: [
        "Supabase",
        "Migraciones SQL",
        "Autenticacion",
        "Roles / permisos reales",
        "Auditoria persistente",
        "SRI ventas",
        "Scanner real",
        "Inventario real rosas",
        "Validacion tributaria externa de ventas en produccion"
      ]
    },
    supabaseStatus: {
      status: "activo conceptual",
      lines: [
        "Cliente Supabase preparado: activo",
        "Supabase habilitado: no",
        "Variables de entorno ejemplo: creado",
        "Repositorio base futuro: preparado",
        "Repositorios futuros por modulo: preparados",
        "Feature flags modulares futuras: creadas",
        "Modo actual: local/operativo",
        "Auth real: desactivado",
        "RLS real: desactivado",
        "Migraciones reales: pendiente",
        "Tablas reales: pendiente"
      ]
    },
    repositoryStatus: {
      status: "preparado",
      lines: [
        "Core repositorios: preparados",
        "Comercial repositorios: preparados",
        "Operaciones repositorios: preparados",
        "Inventario materiales repositorios: preparados",
        "Contabilidad repositorios: preparados",
        "Fuente activa actual: local/operativo",
        "Supabase: desactivado",
        "Reemplazo de servicios operativo: no realizado",
        "Migracion progresiva: documentada"
      ]
    },
    progressiveMigrationStatus: {
      status: "documentada",
      lines: [
        "Supabase global: desactivado",
        "Core Supabase: desactivado",
        "Comercial catalogos: desactivado",
        "Crear pedido: desactivado",
        "Operaciones: desactivado",
        "Scanner: desactivado",
        "Inventario materiales: desactivado",
        "Contabilidad: desactivado",
        "SRI: desactivado",
        "Repositorios preparados: si",
        "Servicios operativo TESTes activos: si",
        "Migracion progresiva: documentada"
      ]
    },
    preSupabaseAuditStatus: {
      status: "cerrada",
      lines: [
        "Modo actual: local/operativo",
        "Supabase: desactivado",
        "SQL ejecutado: no",
        "Migraciones reales: no",
        "Repositorios futuros: preparados",
        "Feature flags: todas false",
        "Servicios operativo TESTes: activos",
        "Go produccion: no",
        "Go ambiente prueba: pendiente revision SQL 003",
        "Ultima fase: 4G cierre preparacion Supabase"
      ]
    },
    functionalReviewStatus: {
      status: "cerrada",
      lines: [
        "Revision funcional operativo TEST: cerrada",
        "Checklist funcional: creado",
        "Auditoria rutas: creada",
        "Flujo comercial operativo: documentado",
        "Flujo operativo operativo: documentado",
        "Contabilidad local/operativo: documentada",
        "Placeholders: documentados",
        "Servicios reales: no conectados",
        "Estado recomendado: seguir en operativo TEST hasta pruebas completas"
      ]
    },
    phase5bCorrectionsStatus: {
      status: "cerrada",
      lines: [
        "Navegacion revisada",
        "Mensajes operativo revisados",
        "Placeholders revisados",
        "Comercial revisado",
        "Operaciones revisado",
        "Contabilidad revisada",
        "Supabase preparado revisado",
        "Servicios reales: no conectados",
        "Estado: modo local/operativo estable"
      ]
    },
    guidedDemoStatus: {
      status: "activa",
      lines: [
        "Prueba guiada operativo: activa",
        "Pasos de prueba: documentados",
        "Formato resultados: creado",
        "Criterios aceptacion: creados",
        "Servicios reales: no conectados",
        "Estado recomendado: ejecutar prueba manual completa"
      ]
    }
  };

  const diagnostics = {
    shellStatus: "JAEDER SYSTEMS local multiempresa activo",
    lastBuildText: "Ejecutar validaciones, build web y standalone después de cada cambio relevante.",
    generalStatus: {
      status: "activo",
      lines: [
        "Bless Flower e Imperio Flowers: contextos separados por pestaña",
        "Navegación filtrada por capacidades de cada empresa",
        "Persistencia actual: almacenamiento local del navegador",
        "Supabase y autenticación remota: desactivados",
        "SRI: habilitado solamente en ambiente de pruebas"
      ]
    },
    technicalSources: [
      {
        label: "Operaciones / Poscosecha",
        status: "Activo operativo",
        note: "Recepción, clasificación, etiquetas, rendimiento, disponibilidad y despacho conectados."
      },
      {
        label: "Administración / Contabilidad",
        status: "Activo local",
        note: "Plan de cuentas, diario, mayor, estados, compras, cartera y bancos separados por empresa."
      },
      {
        label: "Comercial / Exportaciones",
        status: "Activo comercial",
      note: "PO, pedidos, catálogos, disponibilidad y documentos SRI TEST conectados por empresa."
      }
    ],
    warnings: [
      "La información sigue almacenada localmente; no hay sincronización remota con Supabase.",
      "El ambiente SRI de producción permanece bloqueado.",
      "Las firmas P12 deben procesarse únicamente en el backend seguro.",
      "No mezclar el inventario físico de Bless Flower con la contabilidad de Imperio Flowers."
    ],
    operationsStatus: {
      status: "activo operativo",
      origin: "Operaciones / Poscosecha",
      moduleType: "flujo operativo local",
      lines: [
        "Parámetros, recepción y clasificación: activos",
        "Etiquetas e ingreso por escáner HID: activos",
        "Inventario y disponibilidad compartida: activos",
        "Rendimiento de clasificadores y embonchadores: conectado con nómina",
        "Despacho por pedido y cajas: activo"
      ],
      contracts: [
        "Disponibilidad compartida",
        "Pedidos activos",
        "Etiquetas y escaneo",
        "Consumo y despacho"
      ]
    },
    commercialExportStatus: {
      status: "activo comercial",
      origin: "Comercial / Exportaciones",
      connections: [
        "PO Nuevo y Crear pedido: activos",
        "Historial e impresión comercial: activos",
        "Disponibilidad de Bless Flower: compartida",
        "Facturación electrónica: ambiente TEST",
        "Liquidación semanal Bless a Imperio: preparada"
      ],
      workflow: [
        "Los PO borrador no reservan inventario",
        "Los pedidos confirmados ingresan a demanda activa",
        "Bodega completa y escanea cajas",
        "El historial concentra documentos e impresión"
      ],
      accountingPreview: [
        "Vista previa contable disponible",
        "Los asientos definitivos requieren confirmación expresa",
        "Imperio no crea inventario físico"
      ],
      warehousePackaging: [
        "La disponibilidad física pertenece a Bless Flower",
        "Imperio consulta y compromete esa disponibilidad mediante pedidos"
      ],
      dispatchStatus: [
        "Escaneo y despacho se ejecutan desde Operaciones",
        "El avance se refleja en Comercial"
      ],
      printables: [
        "Factura comercial",
        "Factura cliente",
        "Packing list",
        "Hoja de ruta",
        "Master packing",
        "Etiquetas de caja"
      ]
    },
    accountingStatus: {
      status: "activo local",
      lines: [
        "Plan de cuentas: activo por empresa",
        "Libro diario y mayor: activos por empresa",
        "Balance y estados financieros: activos por empresa",
        "Compras, cartera y bancos: activos por empresa",
        "ATS: disponible según las capacidades de cada empresa"
      ]
    },
    inventoryMaterialsStatus: {
      status: "activo local",
      lines: [
        "Inventario de suministros separado del inventario de rosas",
        "Imperio Flowers no administra inventario físico"
      ]
    },
    pendingTechnicalStatus: {
      status: "controlado",
      lines: [
        "Persistencia y usuarios remotos con Supabase",
        "Activación del ambiente SRI de producción",
        "Carga segura de firmas P12 en backend",
        "Exportaciones contables que aún no generan archivos"
      ]
    },
    supabaseStatus: {
      status: "desactivado",
      lines: [
        "Cliente y repositorios preparados",
        "Fuente activa: almacenamiento local",
        "No se ejecutó SQL ni se modificó Supabase",
        "RLS y autenticación remota pendientes de aprobación"
      ]
    }
  };

  void legacyDiagnostics;

  BlessERP.moduleRegistry = {
    modules,
    diagnostics,
    moduleMap: Object.fromEntries(modules.map(module => [module.id, module]))
  };
})();
