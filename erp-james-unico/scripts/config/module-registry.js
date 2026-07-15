(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const modules = [
    {
      id: "core",
      name: "Core del sistema",
      label: "Core del sistema",
      description: "Shell unico, navegacion principal, almacenamiento local separado y registro modular del ERP.",
      status: "activo",
      statusLabel: "Activo",
      group: "Core del sistema",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "dashboard-home / core-diagnostics / core-guided-demo",
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
      description: "Modulo operativo demo integrado con parametros, recepcion, clasificacion, etiquetas numericas, ingreso por escaneo, inventario de rosas, disponibilidad, bodega, rendimientos y despacho.",
      status: "demo avanzado",
      statusLabel: "Demo avanzado",
      group: "Operaciones / Poscosecha",
      renderTarget: "BlessERP.modules.operaciones.render",
      componentAssigned: "scripts/modules/operaciones/*",
      dependencies: ["core", "module-contracts", "comercial-exportaciones (solo contrato futuro)"],
      note: "Viene de Parte 1 POSCOSECHA.zip. No integrar logica pesada, Supabase ni scanner real todavia.",
      source: "PARTE 1 POSCOSECHA.zip",
      sourcePart: "Parte 1",
      moduleType: "modulo operativo preparado",
      summary: "El inventario operativo nace exclusivamente del primer escaneo valido de una etiqueta numerica de ramo.",
      owns: ["parametros poscosecha", "recepcion", "clasificacion", "etiquetas de ramos", "ingreso por escaneo", "inventario de rosas", "disponibilidad", "bodega", "rendimientos", "scanner demo", "despacho"],
      nextStep: "Proxima fase: conectar adapter controlado desde el demo compartido hacia disponibilidad real de Parte 1, sin importar app.js completo.",
      contracts: [
        { id: "availabilityContract", status: "demo activo" },
        { id: "reservationContract", status: "demo activo" },
        { id: "dispatchContract", status: "demo activo" },
        { id: "operationalInventoryContract", status: "demo visual" },
        { id: "operationalConsumptionContract", status: "activo demo" },
        { id: "bunchLabelContract", status: "demo visual" },
        { id: "scannerEventContract", status: "activo demo" }
      ]
    },
    {
      id: "comercial-exportaciones",
      name: "Comercial / Exportaciones",
      label: "Comercial / Exportaciones",
      description: "Modulo comercial demo integrado con Pedido Maestro, historial, catalogos, disponibilidad visual, impresion referencial y preview contable preparado.",
      status: "demo avanzado",
      statusLabel: "Demo avanzado",
      group: "Comercial / Exportaciones",
      renderTarget: "BlessERP.modules.comercial.render",
      componentAssigned: "scripts/modules/comercial/*",
      dependencies: [
        "core",
        "module-contracts",
        "inventario-empaque (contrato futuro)",
        "operaciones-poscosecha (contrato futuro)"
      ],
      note: "Viene de Parte 3 EXPORTACIONES Y VENTA.zip. Integrado solo como modulo comercial demo, sin Supabase ni disponibilidad real.",
      source: "PARTE 3 EXPORTACIONES Y VENTA.zip",
      sourcePart: "Parte 3",
      moduleType: "modulo comercial demo",
      summary: "Pedido Maestro, historial, catalogos, bodega/empaque, invoice carguera, factura cliente y preview contable demo dentro del shell unico.",
      owns: ["pedido maestro", "clientes", "cajas", "bodega empaque", "invoice", "packing", "logistica", "preview contable"],
      nextStep: "Proxima fase: profundizar adapter visual antes de conectar disponibilidad real y contabilidad.",
      contracts: [
        { id: "availabilityContract", status: "demo activo" },
        { id: "reservationContract", status: "demo activo" },
        { id: "commercialOrderContract", status: "demo" },
        { id: "commercialWorkflowContract", status: "demo" },
        { id: "boxLabelContract", status: "demo" },
        { id: "clientCommercialInvoiceContract", status: "demo" },
        { id: "packagingRequirementContract", status: "demo" },
        { id: "dispatchContract", status: "demo" },
        { id: "salesAccountingContract", status: "demo-preparado" }
      ]
    },
    {
      id: "contabilidad",
      name: "Administración / Contabilidad",
      label: "Administración / Contabilidad",
      description: "Base activa de la Parte 2 para compras, cartera, bancos, tributario y contabilidad dentro del shell unico.",
      status: "activo demo/local",
      statusLabel: "Activo demo/local",
      group: "Administración / Contabilidad",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "accounting-* / purchases-* / portfolios-* / banks-* / tax-*",
      dependencies: ["Core del sistema"],
      note: "Viene de Parte 2 CONTABILIDAD.zip y es la base tecnica activa del ERP unico.",
      source: "PARTE 2 CONTABILIDAD.zip",
      sourcePart: "Parte 2",
      summary: "Base funcional actual para compras, cartera, bancos, contabilidad y tributario.",
      owns: ["compras", "cartera", "bancos", "contabilidad", "tributario"],
      nextStep: "Mantener funcionando mientras el shell unico agrupa la navegacion."
    },
    {
      id: "inventario-empaque",
      name: "Inventario suministros / empaque",
      label: "Inventario suministros / empaque",
      description: "Modulo activo para inventario administrativo, ingresos, kardex, consumos y ajustes.",
      status: "activo demo/local",
      statusLabel: "Activo demo/local",
      group: "Inventario suministros / empaque",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "inventory-*",
      dependencies: ["Core del sistema", "contabilidad"],
      note: "Viene de Parte 2 CONTABILIDAD.zip y debe permanecer separado del inventario de rosas.",
      source: "PARTE 2 CONTABILIDAD.zip",
      sourcePart: "Parte 2",
      summary: "Inventario administrativo separado del inventario de rosas de poscosecha.",
      owns: ["items", "ingresos", "kardex", "consumos", "ajustes"],
      nextStep: "Preparado para una conexion futura con Pedido Maestro sin mezclar inventario de rosas."
    },
    {
      id: "reportes",
      name: "Reportes",
      label: "Reportes",
      description: "Modulo activo o parcial para reportes ejecutivos, contables, tributarios, bancarios e inventario.",
      status: "activo demo/local",
      statusLabel: "Activo demo/local",
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
      status: "activo demo/local",
      statusLabel: "Activo demo/local",
      group: "Configuración",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "settings-*",
      dependencies: ["Core del sistema", "contabilidad"],
      note: "Viene de Parte 2 CONTABILIDAD.zip y centraliza parametros del ERP unico.",
      source: "PARTE 2 CONTABILIDAD.zip",
      sourcePart: "Parte 2",
      summary: "Empresa, usuarios visuales, auditoria, secuenciales y parametros base.",
      owns: ["empresa", "usuarios", "auditoria", "secuenciales", "centros de costo"],
      nextStep: "Usar como punto unico de configuracion del ERP."
    },
    {
      id: "modulos-futuros",
      name: "Módulos futuros",
      label: "Módulos futuros",
      description: "Placeholder de expansion futura para LLC USA, CRM, Marketing, costos y app movil.",
      status: "placeholder",
      statusLabel: "Placeholder futuro",
      group: "Módulos futuros",
      renderTarget: "BlessERP.modules.part2.render",
      componentAssigned: "extensions-* placeholders",
      dependencies: ["Core del sistema"],
      note: "Proyecto nuevo. No implementar en esta fase.",
      source: "Proyecto nuevo",
      sourcePart: "Futuro",
      summary: "Espacio reservado para LLC USA, CRM, Marketing, costos y app movil.",
      owns: ["LLC USA", "CRM", "Marketing", "Costos", "App movil"],
      nextStep: "No implementar en esta fase."
    }
  ];

  const diagnostics = {
    shellStatus: "FASE 5C completada: prueba guiada demo/local preparada y ERP estable en modo local/demo",
    lastBuildText: "Manual: ejecutar npm run build, npm run build:standalone y npm run validate:shell despues de cada ajuste relevante.",
    generalStatus: {
      status: "activo",
      lines: [
        "Shell unico: activo",
        "Navegacion modular: activa",
        "Datos locales/demo: activo",
        "Supabase real: pendiente",
        "Login real: pendiente",
        "Auditoria real: pendiente"
      ]
    },
    technicalSources: [
      { label: "Parte 1 Poscosecha", status: "Demo visual preparado", note: "Sin mover logica pesada, Supabase ni scanner real." },
      { label: "Parte 2 Contabilidad", status: "Base activa", note: "Shell unico construido sobre esta base tecnica." },
      { label: "Parte 3 Comercial", status: "Demo integrado", note: "Pedido Maestro, historial, documentos y bodega / empaque demo desacoplados del prototipo monolitico." }
    ],
    warnings: [
      "No conectar Supabase todavia.",
      "No ejecutar SQL ni crear migraciones en esta fase.",
      "No integrar logica pesada sin fase aprobada.",
      "No mezclar modulos en un app.js monolitico.",
      "No llevar inventario de rosas dentro de contabilidad.",
      "No conectar scanner / Zebra real todavia.",
      "No implementar login real, permisos reales ni SRI real en esta fase."
    ],
    operationsStatus: {
      status: "demo avanzado",
      origin: "Parte 1 POSCOSECHA",
      moduleType: "modulo operativo demo avanzado",
      lines: [
        "Parametros de Poscosecha: activo demo/local",
        "Recepcion y clasificacion: activas demo/local",
        "Etiquetas numericas de 10 digitos: activas demo",
        "Ingreso de ramos por escaneo: activo demo",
        "Inventario nace solo por escaneo: activo demo",
        "Disponibilidad derivada del inventario escaneado: activo demo",
        "Rendimiento embonchador desde escaneos: activo demo",
        "Reservas demo: activo",
        "Despacho demo: activo",
        "Scanner / Zebra demo: activo",
        "Consumo demo: activo",
        "Kardex operativo demo: activo",
        "Parte 1 adapter: preparado",
        "Parte 1 real: pendiente",
        "Descuento inventario real: pendiente"
      ],
      contracts: [
        "availabilityContract demo activo",
        "reservationContract demo activo",
        "dispatchContract demo activo",
        "scannerEventContract demo activo",
        "operationalInventoryContract preparado",
        "operationalConsumptionContract activo demo",
        "bunchLabelContract demo visual"
      ]
    },
    commercialExportStatus: {
      status: "demo avanzado",
      origin: "Parte 3 EXPORTACIONES Y VENTA",
      connections: [
        "Pedido Maestro: demo activo",
        "Historial comercial: demo activo",
        "Documentos comerciales: demo activo",
        "Factura Comercial Cliente: demo activo",
        "Preview contable ventas: demo activo",
        "Conexion contable real: pendiente",
        "Facturacion SRI ventas: pendiente"
      ],
      workflow: [
        "Flujo comercial del pedido: demo activo",
        "Reservas demo desde Pedido Maestro: activo",
        "Despacho demo sincronizado con Operaciones: activo",
        "Checklist despacho unificado: activo",
        "Estado DESPACHADO_DEMO visual: activo",
        "Auditoria real: pendiente"
      ],
      accountingPreview: [
        "Preview contable ventas: demo activo",
        "Vista previa: no afecta Libro Diario ni Mayor General",
        "CxC real: pendiente",
        "Asiento de venta real: pendiente",
        "salesAccountingContract: preparado"
      ],
      warehousePackaging: [
        "Bodega empaque comercial: demo conectado",
        "Inventario real materiales por despacho: pendiente",
        "Consumo real materiales: pendiente"
      ],
      dispatchStatus: [
        "Despacho demo desde Comercial: activo",
        "Sincronizacion con Operaciones / Despacho: demo activa",
        "Escaneo demo visible desde Pedido Maestro: activo",
        "Consumo demo visible desde Pedido Maestro: activo",
        "Inventario real Parte 1: pendiente",
        "Scanner real: pendiente"
      ],
      printables: [
        "Documentos imprimibles demo: activo",
        "Invoice / Packing carguera: demo activo",
        "Factura Comercial Cliente demo: activo",
        "Packing List: demo activo",
        "HR / Hoja de Ruta: demo activo",
        "MP / Master Packing: demo activo",
        "Etiquetas de caja demo: activo",
        "Centro de impresion: demo activo",
        "Factura SRI exportacion: pendiente",
        "PDF real: pendiente",
        "SRI ventas: pendiente"
      ]
    },
    accountingStatus: {
      status: "activo demo/local",
      lines: [
        "Plan de cuentas: activo local/demo",
        "Libro diario / mayor: activo local/demo",
        "Compras: activo local/demo",
        "Retenciones: activo local/demo",
        "Bancos / CxP / CxC: activo local/demo",
        "ATS preliminar: activo demo",
        "Ventas comerciales reales: pendiente conexion futura"
      ]
    },
    inventoryMaterialsStatus: {
      status: "activo demo/local",
      lines: [
        "Inventario materiales: activo local/demo",
        "Bodega empaque comercial: demo conectado",
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
        "Contabilidad real de ventas"
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
        "Modo actual: local/demo",
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
        "Fuente activa actual: local/demo",
        "Supabase: desactivado",
        "Reemplazo de servicios demo: no realizado",
        "Migracion progresiva: documentada"
      ]
    },
    progressiveMigrationStatus: {
      status: "documentada",
      lines: [
        "Supabase global: desactivado",
        "Core Supabase: desactivado",
        "Comercial catalogos: desactivado",
        "Pedido Maestro: desactivado",
        "Operaciones: desactivado",
        "Scanner: desactivado",
        "Inventario materiales: desactivado",
        "Contabilidad: desactivado",
        "SRI: desactivado",
        "Repositorios preparados: si",
        "Servicios demo/locales activos: si",
        "Migracion progresiva: documentada"
      ]
    },
    preSupabaseAuditStatus: {
      status: "cerrada",
      lines: [
        "Modo actual: local/demo",
        "Supabase: desactivado",
        "SQL ejecutado: no",
        "Migraciones reales: no",
        "Repositorios futuros: preparados",
        "Feature flags: todas false",
        "Servicios demo/locales: activos",
        "Go produccion: no",
        "Go ambiente prueba: pendiente revision SQL 003",
        "Ultima fase: 4G cierre preparacion Supabase"
      ]
    },
    functionalReviewStatus: {
      status: "cerrada",
      lines: [
        "Revision funcional demo/local: cerrada",
        "Checklist funcional: creado",
        "Auditoria rutas: creada",
        "Flujo comercial demo: documentado",
        "Flujo operativo demo: documentado",
        "Contabilidad local/demo: documentada",
        "Placeholders: documentados",
        "Servicios reales: no conectados",
        "Estado recomendado: seguir en demo/local hasta pruebas completas"
      ]
    },
    phase5bCorrectionsStatus: {
      status: "cerrada",
      lines: [
        "Navegacion revisada",
        "Mensajes demo revisados",
        "Placeholders revisados",
        "Comercial revisado",
        "Operaciones revisado",
        "Contabilidad revisada",
        "Supabase preparado revisado",
        "Servicios reales: no conectados",
        "Estado: modo local/demo estable"
      ]
    },
    guidedDemoStatus: {
      status: "activa",
      lines: [
        "Prueba guiada demo: activa",
        "Pasos de prueba: documentados",
        "Formato resultados: creado",
        "Criterios aceptacion: creados",
        "Servicios reales: no conectados",
        "Estado recomendado: ejecutar prueba manual completa"
      ]
    }
  };

  BlessERP.moduleRegistry = {
    modules,
    diagnostics,
    moduleMap: Object.fromEntries(modules.map(module => [module.id, module]))
  };
})();
