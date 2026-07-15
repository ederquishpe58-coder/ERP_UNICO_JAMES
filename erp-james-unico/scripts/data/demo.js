(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { uid, today } = BlessERP.utils;

  function createCompanySettings() {
    return {
      ruc: "1717637084001",
      legalName: "Lanchimba Tutillo Manuel Clemente",
      commercialName: "Bless Flower",
      matrixAddress: "Pichincha / Cayambe / Cangahua / Central S/N y Santa Rosa",
      branchAddress: "Pichincha / Cayambe / Cangahua / Central S/N y Santa Rosa",
      phone: "0984970998",
      email: "administracion@blessflower.test",
      accountingRequired: "Si",
      taxRegime: "General",
      baseCurrency: "USD",
      activePeriod: "2026-07",
      periodLabel: "Julio 2026",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      periodStatus: "Abierto",
      sriEnvironment: "Pruebas",
      mainEstablishment: "001",
      mainEmissionPoint: "001",
      defaultAccounts: {
        cashGeneral: "1.1.01.01",
        mainBank: "1.1.01.02",
        accountsReceivableCustomers: "1.1.02",
        accountsPayableSuppliers: "2.1.01",
        vatPurchases: "1.1.05",
        vatSales: "2.1.03",
        incomeTaxWithholdingPayable: "2.1.02",
        vatWithholdingPayable: "2.1.02.01",
        withholdingReceivable: "1.1.05",
        suppliesInventory: "1.1.03.01",
        packagingInventory: "1.1.03.02",
        suppliesExpenseCost: "6.2",
        packagingCost: "5.2",
        localSales: "4.1",
        exportSales: "4.2",
        supplierAdvances: "1.1.04",
        customerAdvances: "2.1.04"
      }
    };
  }

  function createChartOfAccountsSeed() {
    return [
      { id: uid("ACC"), code: "1", name: "Activo", type: "Activo", nature: "Deudora", level: 1, parentCode: "", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Clase principal de activos" },
      { id: uid("ACC"), code: "1.1", name: "Activo corriente", type: "Activo", nature: "Deudora", level: 2, parentCode: "1", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Activos corrientes" },
      { id: uid("ACC"), code: "1.1.01", name: "Caja y bancos", type: "Activo", nature: "Deudora", level: 3, parentCode: "1.1", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Disponibilidades" },
      { id: uid("ACC"), code: "1.1.01.01", name: "Caja general", type: "Activo", nature: "Deudora", level: 4, parentCode: "1.1.01", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Caja general de la empresa" },
      { id: uid("ACC"), code: "1.1.01.02", name: "Banco principal", type: "Activo", nature: "Deudora", level: 4, parentCode: "1.1.01", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Cuenta bancaria principal" },
      { id: uid("ACC"), code: "1.1.02", name: "Cuentas por cobrar", type: "Activo", nature: "Deudora", level: 3, parentCode: "1.1", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: true, status: "Activa", notes: "Cartera de clientes" },
      { id: uid("ACC"), code: "1.1.03", name: "Inventarios", type: "Activo", nature: "Deudora", level: 3, parentCode: "1.1", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Inventarios administrativos" },
      { id: uid("ACC"), code: "1.1.03.01", name: "Inventario suministros", type: "Activo", nature: "Deudora", level: 4, parentCode: "1.1.03", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Suministros de uso administrativo" },
      { id: uid("ACC"), code: "1.1.03.02", name: "Inventario materiales de empaque", type: "Activo", nature: "Deudora", level: 4, parentCode: "1.1.03", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Materiales de empaque" },
      { id: uid("ACC"), code: "1.1.04", name: "Anticipos a proveedores", type: "Activo", nature: "Deudora", level: 3, parentCode: "1.1", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: true, status: "Activa", notes: "Anticipos entregados a proveedores" },
      { id: uid("ACC"), code: "1.1.05", name: "Retenciones por cobrar", type: "Activo", nature: "Deudora", level: 3, parentCode: "1.1", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Retenciones e IVA compras por cobrar" },
      { id: uid("ACC"), code: "1.2", name: "Activo no corriente", type: "Activo", nature: "Deudora", level: 2, parentCode: "1", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Activos no corrientes" },
      { id: uid("ACC"), code: "1.2.01", name: "Activos fijos", type: "Activo", nature: "Deudora", level: 3, parentCode: "1.2", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Base de activos fijos" },
      { id: uid("ACC"), code: "1.2.01.01", name: "Equipos y mobiliario", type: "Activo", nature: "Deudora", level: 4, parentCode: "1.2.01", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Equipos y mobiliario administrativo" },
      { id: uid("ACC"), code: "2", name: "Pasivo", type: "Pasivo", nature: "Acreedora", level: 1, parentCode: "", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Clase principal de pasivos" },
      { id: uid("ACC"), code: "2.1", name: "Pasivo corriente", type: "Pasivo", nature: "Acreedora", level: 2, parentCode: "2", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Obligaciones corrientes" },
      { id: uid("ACC"), code: "2.1.01", name: "Cuentas por pagar proveedores", type: "Pasivo", nature: "Acreedora", level: 3, parentCode: "2.1", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: true, status: "Activa", notes: "Cartera de proveedores" },
      { id: uid("ACC"), code: "2.1.02", name: "Retenciones por pagar", type: "Pasivo", nature: "Acreedora", level: 3, parentCode: "2.1", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Retenciones tributarias por pagar" },
      { id: uid("ACC"), code: "2.1.02.01", name: "Retencion IVA por pagar", type: "Pasivo", nature: "Acreedora", level: 4, parentCode: "2.1.02", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Retenciones de IVA por pagar" },
      { id: uid("ACC"), code: "2.1.02.02", name: "Retencion fuente por pagar", type: "Pasivo", nature: "Acreedora", level: 4, parentCode: "2.1.02", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Retenciones de renta por pagar" },
      { id: uid("ACC"), code: "2.1.03", name: "IVA por pagar", type: "Pasivo", nature: "Acreedora", level: 3, parentCode: "2.1", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "IVA generado por ventas" },
      { id: uid("ACC"), code: "2.1.04", name: "Anticipos de clientes", type: "Pasivo", nature: "Acreedora", level: 3, parentCode: "2.1", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: true, status: "Activa", notes: "Valores recibidos por anticipado" },
      { id: uid("ACC"), code: "3", name: "Patrimonio", type: "Patrimonio", nature: "Acreedora", level: 1, parentCode: "", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Clase principal de patrimonio" },
      { id: uid("ACC"), code: "3.1", name: "Capital", type: "Patrimonio", nature: "Acreedora", level: 2, parentCode: "3", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Capital del negocio" },
      { id: uid("ACC"), code: "3.2", name: "Resultados acumulados", type: "Patrimonio", nature: "Acreedora", level: 2, parentCode: "3", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Resultados acumulados" },
      { id: uid("ACC"), code: "4", name: "Ingresos", type: "Ingreso", nature: "Acreedora", level: 1, parentCode: "", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Clase principal de ingresos" },
      { id: uid("ACC"), code: "4.1", name: "Ventas locales", type: "Ingreso", nature: "Acreedora", level: 2, parentCode: "4", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Ventas locales" },
      { id: uid("ACC"), code: "4.2", name: "Ventas exportacion", type: "Ingreso", nature: "Acreedora", level: 2, parentCode: "4", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Placeholder para exportacion" },
      { id: uid("ACC"), code: "5", name: "Costos", type: "Costo", nature: "Deudora", level: 1, parentCode: "", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Clase principal de costos" },
      { id: uid("ACC"), code: "5.1", name: "Costo de ventas", type: "Costo", nature: "Deudora", level: 2, parentCode: "5", isMovement: true, acceptsCostCenter: true, requiresAuxiliary: false, status: "Activa", notes: "Costo de ventas" },
      { id: uid("ACC"), code: "5.2", name: "Costo materiales de empaque", type: "Costo", nature: "Deudora", level: 2, parentCode: "5", isMovement: true, acceptsCostCenter: true, requiresAuxiliary: false, status: "Activa", notes: "Costo de materiales de empaque" },
      { id: uid("ACC"), code: "6", name: "Gastos", type: "Gasto", nature: "Deudora", level: 1, parentCode: "", isMovement: false, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Clase principal de gastos" },
      { id: uid("ACC"), code: "6.1", name: "Gastos administrativos", type: "Gasto", nature: "Deudora", level: 2, parentCode: "6", isMovement: true, acceptsCostCenter: true, requiresAuxiliary: false, status: "Activa", notes: "Gastos administrativos" },
      { id: uid("ACC"), code: "6.2", name: "Gastos de suministros", type: "Gasto", nature: "Deudora", level: 2, parentCode: "6", isMovement: true, acceptsCostCenter: true, requiresAuxiliary: false, status: "Activa", notes: "Gastos o costo de suministros" },
      { id: uid("ACC"), code: "6.3", name: "Gastos financieros", type: "Gasto", nature: "Deudora", level: 2, parentCode: "6", isMovement: true, acceptsCostCenter: false, requiresAuxiliary: false, status: "Activa", notes: "Gastos financieros" }
    ];
  }

  function createProvidersSeed() {
    return [
      {
        id: uid("PRV"),
        code: "PRV-0001",
        ruc: "1790012345001",
        name: "Agroinsumos del Ecuador",
        commercialName: "Agroinsumos EC",
        providerType: "insumos",
        address: "Panamericana Norte Km 42, Tabacundo",
        phone: "022345678",
        email: "ventas@agroinsumos.test",
        paymentCondition: "Credito 30 dias",
        creditDays: 30,
        payableAccountCode: "2.1.01",
        advanceAccountCode: "1.1.04",
        status: "activo",
        profileState: "COMPLETO",
        notes: "Proveedor frecuente de fertilizantes y quimicos"
      },
      {
        id: uid("PRV"),
        code: "PRV-0002",
        ruc: "0990012345001",
        name: "Cartonera Andina",
        commercialName: "Cartonera Andina",
        providerType: "comercial",
        address: "Via Daule Km 8.5, Guayaquil",
        phone: "042987654",
        email: "pedidos@cartoneraandina.test",
        paymentCondition: "Credito 45 dias",
        creditDays: 45,
        payableAccountCode: "2.1.01",
        advanceAccountCode: "1.1.04",
        status: "activo",
        profileState: "COMPLETO",
        notes: "Proveedor de cajas HB, QB y material de empaque"
      },
      {
        id: uid("PRV"),
        code: "PRV-0003",
        ruc: "1710012345001",
        name: "Servicios Tecnicos Quito",
        commercialName: "STQ Mantenimiento",
        providerType: "servicios",
        address: "Av. Eloy Alfaro y Portugal, Quito",
        phone: "022987321",
        email: "soporte@stquito.test",
        paymentCondition: "Credito 15 dias",
        creditDays: 15,
        payableAccountCode: "2.1.01",
        advanceAccountCode: "1.1.04",
        status: "activo",
        profileState: "COMPLETO",
        notes: "Servicios tecnicos y mantenimiento general"
      }
    ];
  }

  function createTaxSupportsSeed() {
    return [
      { id: uid("SUP"), code: "01", description: "Credito tributario para declaracion de IVA", status: "Activo", suggestedAccountCode: "1.1.05", suggestedPurchaseType: "BIENES" },
      { id: uid("SUP"), code: "02", description: "Costo o gasto para declaracion de IR", status: "Activo", suggestedAccountCode: "6.1", suggestedPurchaseType: "GASTO" },
      { id: uid("SUP"), code: "03", description: "Activo fijo con credito tributario IVA", status: "Activo", suggestedAccountCode: "1.2.01.01", suggestedPurchaseType: "ACTIVO_FIJO" },
      { id: uid("SUP"), code: "04", description: "Activo fijo como costo o gasto IR", status: "Activo", suggestedAccountCode: "1.2.01.01", suggestedPurchaseType: "ACTIVO_FIJO" },
      { id: uid("SUP"), code: "05", description: "Liquidacion de gastos de viaje, hospedaje y alimentacion", status: "Activo", suggestedAccountCode: "6.1", suggestedPurchaseType: "SERVICIOS" }
    ];
  }

  function createTaxParametersSeed() {
    return [
      {
        id: uid("TAX"),
        internalCode: "IVA_0",
        sriCode: "0",
        name: "IVA 0%",
        taxType: "IVA",
        rate: 0,
        appliesTo: "ambos",
        purchaseAccountCode: "1.1.05",
        salesAccountCode: "2.1.03",
        payableAccountCode: "2.1.03",
        receivableAccountCode: "1.1.05",
        effectiveFrom: "2026-01-01",
        effectiveTo: "",
        status: "activo",
        observation: "Tarifa cero base para compras y ventas."
      },
      {
        id: uid("TAX"),
        internalCode: "IVA_15",
        sriCode: "2",
        name: "IVA 15%",
        taxType: "IVA",
        rate: 15,
        appliesTo: "ambos",
        purchaseAccountCode: "1.1.05",
        salesAccountCode: "2.1.03",
        payableAccountCode: "2.1.03",
        receivableAccountCode: "1.1.05",
        effectiveFrom: "2026-01-01",
        effectiveTo: "",
        status: "activo",
        observation: "Tarifa general vigente."
      },
      {
        id: uid("TAX"),
        internalCode: "IVA_NO_OBJETO",
        sriCode: "6",
        name: "No objeto de IVA",
        taxType: "IVA",
        rate: 0,
        appliesTo: "ambos",
        purchaseAccountCode: "1.1.05",
        salesAccountCode: "2.1.03",
        payableAccountCode: "",
        receivableAccountCode: "",
        effectiveFrom: "2026-01-01",
        effectiveTo: "",
        status: "activo",
        observation: "Operacion no objeto de IVA."
      },
      {
        id: uid("TAX"),
        internalCode: "IVA_EXENTO",
        sriCode: "7",
        name: "Exento de IVA",
        taxType: "IVA",
        rate: 0,
        appliesTo: "ambos",
        purchaseAccountCode: "1.1.05",
        salesAccountCode: "2.1.03",
        payableAccountCode: "",
        receivableAccountCode: "",
        effectiveFrom: "2026-01-01",
        effectiveTo: "",
        status: "activo",
        observation: "Operacion exenta de IVA."
      },
      {
        id: uid("TAX"),
        internalCode: "RENTA",
        sriCode: "RENTA",
        name: "Impuesto a la renta / retenciones fuente",
        taxType: "RENTA",
        rate: 0,
        appliesTo: "compras",
        purchaseAccountCode: "2.1.02.02",
        salesAccountCode: "",
        payableAccountCode: "2.1.02.02",
        receivableAccountCode: "1.1.05",
        effectiveFrom: "2026-01-01",
        effectiveTo: "",
        status: "activo",
        observation: "Parametro base para procesos de retencion."
      }
    ];
  }

  function createPurchaseTypesSeed() {
    return [
      { id: uid("PTY"), code: "BIENES", label: "Bienes", suggestedAccountCode: "6.2", requiresRetentionRent: false, requiresRetentionVat: false, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: false, suggestedSupportCode: "01" },
      { id: uid("PTY"), code: "SERVICIOS", label: "Servicios", suggestedAccountCode: "6.1", requiresRetentionRent: true, requiresRetentionVat: true, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: true, suggestedSupportCode: "02" },
      { id: uid("PTY"), code: "SERVICIOS_PROFESIONALES", label: "Servicios profesionales", suggestedAccountCode: "6.1", requiresRetentionRent: true, requiresRetentionVat: true, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: true, suggestedSupportCode: "02" },
      { id: uid("PTY"), code: "SERVICIOS_EXTERIOR", label: "Servicios del exterior", suggestedAccountCode: "6.3", requiresRetentionRent: true, requiresRetentionVat: false, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: false, suggestedSupportCode: "02" },
      { id: uid("PTY"), code: "TRANSPORTE", label: "Transporte", suggestedAccountCode: "6.1", requiresRetentionRent: true, requiresRetentionVat: true, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: true, suggestedSupportCode: "02" },
      { id: uid("PTY"), code: "ARRIENDO", label: "Arriendo", suggestedAccountCode: "6.1", requiresRetentionRent: true, requiresRetentionVat: true, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: false, suggestedSupportCode: "02" },
      { id: uid("PTY"), code: "AGRICOLA", label: "Agricola", suggestedAccountCode: "1.1.03.01", requiresRetentionRent: true, requiresRetentionVat: false, affectsInventory: true, affectsCostOrExpense: false, requiresCostCenter: false, suggestedSupportCode: "01" },
      { id: uid("PTY"), code: "INVENTARIO_SUMINISTROS", label: "Inventario suministros", suggestedAccountCode: "1.1.03.01", requiresRetentionRent: false, requiresRetentionVat: false, affectsInventory: true, affectsCostOrExpense: false, requiresCostCenter: false, suggestedSupportCode: "01" },
      { id: uid("PTY"), code: "INVENTARIO_EMPAQUE", label: "Inventario empaque", suggestedAccountCode: "1.1.03.02", requiresRetentionRent: false, requiresRetentionVat: false, affectsInventory: true, affectsCostOrExpense: false, requiresCostCenter: false, suggestedSupportCode: "01" },
      { id: uid("PTY"), code: "COSTO", label: "Costo", suggestedAccountCode: "5.1", requiresRetentionRent: false, requiresRetentionVat: false, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: true, suggestedSupportCode: "02" },
      { id: uid("PTY"), code: "ACTIVO_FIJO", label: "Activo PPE", suggestedAccountCode: "1.2.01.01", requiresRetentionRent: false, requiresRetentionVat: false, affectsInventory: false, affectsCostOrExpense: false, requiresCostCenter: false, suggestedSupportCode: "03" },
      { id: uid("PTY"), code: "GASTO", label: "Gasto", suggestedAccountCode: "6.1", requiresRetentionRent: false, requiresRetentionVat: false, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: true, suggestedSupportCode: "02" },
      { id: uid("PTY"), code: "OTROS", label: "Otros", suggestedAccountCode: "6.1", requiresRetentionRent: false, requiresRetentionVat: false, affectsInventory: false, affectsCostOrExpense: true, requiresCostCenter: false, suggestedSupportCode: "02" }
    ];
  }

  function createRetentionParametersSeed() {
    return [
      { id: uid("WHT"), internalCode: "RET_303", sriCode: "303", description: "Honorarios profesionales", taxType: "RENTA", percentage: 10, appliesTo: "compra", category: "profesional", payableAccountCode: "2.1.02.02", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" },
      { id: uid("WHT"), internalCode: "RET_304", sriCode: "304", description: "Servicios", taxType: "RENTA", percentage: 2, appliesTo: "compra", category: "servicios", payableAccountCode: "2.1.02.02", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" },
      { id: uid("WHT"), internalCode: "RET_312", sriCode: "312", description: "Transferencia de bienes", taxType: "RENTA", percentage: 1.75, appliesTo: "compra", category: "bienes", payableAccountCode: "2.1.02.02", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" },
      { id: uid("WHT"), internalCode: "RET_332", sriCode: "332", description: "Compras no sujetas a retencion", taxType: "RENTA", percentage: 0, appliesTo: "compra", category: "otros", payableAccountCode: "2.1.02.02", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "Codigo por defecto cuando no existe retencion." },
      { id: uid("WHT"), internalCode: "RET_AGRICOLA_1", sriCode: "AGRICOLA_1", description: "Material / producto agricola 1%", taxType: "RENTA", percentage: 1, appliesTo: "compra", category: "agricola", payableAccountCode: "2.1.02.02", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" },
      { id: uid("WHT"), internalCode: "RET_EXTERIOR_25", sriCode: "EXTERIOR_25", description: "Servicios del exterior 25%", taxType: "RENTA", percentage: 25, appliesTo: "compra", category: "exterior", payableAccountCode: "2.1.02.02", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" },
      { id: uid("WHT"), internalCode: "RET_IVA_30", sriCode: "IVA_30", description: "Retencion IVA 30%", taxType: "IVA", percentage: 30, appliesTo: "compra", category: "servicios", payableAccountCode: "2.1.02.01", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" },
      { id: uid("WHT"), internalCode: "RET_IVA_70", sriCode: "IVA_70", description: "Retencion IVA 70%", taxType: "IVA", percentage: 70, appliesTo: "compra", category: "servicios", payableAccountCode: "2.1.02.01", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" },
      { id: uid("WHT"), internalCode: "RET_IVA_100", sriCode: "IVA_100", description: "Retencion IVA 100%", taxType: "IVA", percentage: 100, appliesTo: "compra", category: "servicios", payableAccountCode: "2.1.02.01", receivableAccountCode: "1.1.05", effectiveFrom: "2026-01-01", effectiveTo: "", status: "activo", observation: "" }
    ];
  }

  function createPurchaseMemorySeed(providers) {
    const [agro, cartonera, servicios] = providers;
    return [
      {
        id: uid("MEM"),
        supplierId: agro.id,
        supplierRuc: agro.ruc,
        supplierName: agro.name,
        productCode: "FERT-01",
        descriptionNormalized: "fertilizante premium foliar",
        keywords: ["fertilizante", "foliar", "quimico"],
        accountCode: "1.1.03.01",
        vatPercentage: 15,
        expenseType: "INVENTARIO_SUMINISTROS",
        lastUsedAt: "2026-07-04T09:00:00.000Z",
        usageCount: 4,
        updatedBy: "James Lanchimba"
      },
      {
        id: uid("MEM"),
        supplierId: cartonera.id,
        supplierRuc: cartonera.ruc,
        supplierName: cartonera.name,
        productCode: "HB-BOX",
        descriptionNormalized: "caja hb exportacion",
        keywords: ["caja", "hb", "carton"],
        accountCode: "1.1.03.02",
        vatPercentage: 15,
        expenseType: "INVENTARIO_EMPAQUE",
        lastUsedAt: "2026-07-02T14:30:00.000Z",
        usageCount: 6,
        updatedBy: "James Lanchimba"
      },
      {
        id: uid("MEM"),
        supplierId: servicios.id,
        supplierRuc: servicios.ruc,
        supplierName: servicios.name,
        productCode: "",
        descriptionNormalized: "servicio tecnico de mantenimiento",
        keywords: ["servicio", "tecnico", "mantenimiento"],
        accountCode: "6.1",
        vatPercentage: 15,
        expenseType: "SERVICIOS_PROFESIONALES",
        lastUsedAt: "2026-07-06T16:15:00.000Z",
        usageCount: 3,
        updatedBy: "James Lanchimba"
      }
    ];
  }

  function createJournalEntriesSeed() {
    const createdAt = new Date().toISOString();
    return [
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000001",
        accountingDate: "2026-07-01",
        accountingPeriod: "2026-07",
        concept: "Aporte inicial a banco",
        originModule: "Manual",
        sourceDocument: "",
        externalReference: "",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Asiento inicial de prueba",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 5000, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Aporte inicial", documentReference: "" },
          { id: uid("JLN"), accountCode: "3.1", accountName: "Capital", debit: 0, credit: 5000, costCenter: "", auxiliary: "", lineDescription: "Capital inicial", documentReference: "" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000002",
        accountingDate: "2026-07-03",
        accountingPeriod: "2026-07",
        concept: "Compra menor pagada con caja",
        originModule: "Manual",
        sourceDocument: "",
        externalReference: "",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Asiento manual de prueba",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "6.2", accountName: "Gastos de suministros", debit: 125, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Compra menor", documentReference: "" },
          { id: uid("JLN"), accountCode: "1.1.01.01", accountName: "Caja general", debit: 0, credit: 125, costCenter: "", auxiliary: "", lineDescription: "Salida de caja", documentReference: "" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000003",
        accountingDate: "2026-07-05",
        accountingPeriod: "2026-07",
        concept: "Ajuste de inventario de suministros",
        originModule: "Ajustes",
        sourceDocument: "",
        externalReference: "",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Ajuste manual de inventario",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.03.01", accountName: "Inventario suministros", debit: 340, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Ingreso por ajuste", documentReference: "" },
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 0, credit: 340, costCenter: "", auxiliary: "", lineDescription: "Obligacion generada", documentReference: "" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000004",
        accountingDate: "2026-07-08",
        accountingPeriod: "2026-07",
        concept: "Asiento de prueba descuadrado",
        originModule: "Manual",
        sourceDocument: "",
        externalReference: "",
        status: "BORRADOR",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Borrador para validar diferencia",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "6.1", accountName: "Gastos administrativos", debit: 200, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Prueba", documentReference: "" },
          { id: uid("JLN"), accountCode: "1.1.01.01", accountName: "Caja general", debit: 0, credit: 180, costCenter: "", auxiliary: "", lineDescription: "Prueba", documentReference: "" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000005",
        accountingDate: "2026-07-06",
        accountingPeriod: "2026-07",
        concept: "Compra Servicios Tecnicos Quito | mantenimiento de cuarto frio",
        originModule: "Compras",
        sourceDocument: "001-002-000000145",
        externalReference: "1790012345678901234567890123456789012345678901",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Compra contabilizada pendiente de retencion",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "6.1", accountName: "Gastos administrativos", debit: 200, credit: 0, costCenter: "ADMIN", auxiliary: "", lineDescription: "Servicio tecnico", documentReference: "001-002-000000145" },
          { id: uid("JLN"), accountCode: "1.1.05", accountName: "Retenciones por cobrar", debit: 30, credit: 0, costCenter: "", auxiliary: "", lineDescription: "IVA compras", documentReference: "001-002-000000145" },
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 0, credit: 230, costCenter: "", auxiliary: "1710012345001", lineDescription: "Proveedor Servicios Tecnicos Quito", documentReference: "001-002-000000145" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000006",
        accountingDate: "2026-07-02",
        accountingPeriod: "2026-07",
        concept: "Compra Agroinsumos del Ecuador | fertilizante premium foliar",
        originModule: "Compras",
        sourceDocument: "001-003-000000231",
        externalReference: "1790012345678901234567890123456789012345678902",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Compra contabilizada con retencion en borrador",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.03.01", accountName: "Inventario suministros", debit: 480, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Fertilizante premium", documentReference: "001-003-000000231" },
          { id: uid("JLN"), accountCode: "1.1.05", accountName: "Retenciones por cobrar", debit: 72, credit: 0, costCenter: "", auxiliary: "", lineDescription: "IVA compras", documentReference: "001-003-000000231" },
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 0, credit: 552, costCenter: "", auxiliary: "1790012345001", lineDescription: "Proveedor Agroinsumos del Ecuador", documentReference: "001-003-000000231" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000007",
        accountingDate: "2026-07-11",
        accountingPeriod: "2026-07",
        concept: "Compra Agroinsumos del Ecuador | fertilizante granulado stock julio",
        originModule: "Compras",
        sourceDocument: "001-003-000000242",
        externalReference: "1790012345678901234567890123456789012345678910",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Compra contabilizada para cartera pendiente",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.03.01", accountName: "Inventario suministros", debit: 560, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Fertilizante granulado", documentReference: "001-003-000000242" },
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 0, credit: 560, costCenter: "", auxiliary: "1790012345001", lineDescription: "Proveedor Agroinsumos del Ecuador", documentReference: "001-003-000000242" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000008",
        accountingDate: "2026-07-12",
        accountingPeriod: "2026-07",
        concept: "Compra Cartonera Andina | lote de cajas HB y QB",
        originModule: "Compras",
        sourceDocument: "001-004-000000402",
        externalReference: "0990012345678901234567890123456789012345678911",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Compra contabilizada de empaque para cartera pendiente",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.03.02", accountName: "Inventario materiales de empaque", debit: 1250, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Lote cajas HB y QB", documentReference: "001-004-000000402" },
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 0, credit: 1250, costCenter: "", auxiliary: "0990012345001", lineDescription: "Proveedor Cartonera Andina", documentReference: "001-004-000000402" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000009",
        accountingDate: "2026-07-13",
        accountingPeriod: "2026-07",
        concept: "Compra Servicios Tecnicos Quito | soporte correctivo de sistemas",
        originModule: "Compras",
        sourceDocument: "001-002-000000152",
        externalReference: "1710012345678901234567890123456789012345678912",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Compra contabilizada de servicios para cartera pendiente",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "6.1", accountName: "Gastos administrativos", debit: 300, credit: 0, costCenter: "ADMIN", auxiliary: "", lineDescription: "Soporte correctivo", documentReference: "001-002-000000152" },
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 0, credit: 300, costCenter: "", auxiliary: "1710012345001", lineDescription: "Proveedor Servicios Tecnicos Quito", documentReference: "001-002-000000152" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000010",
        accountingDate: "2026-07-14",
        accountingPeriod: "2026-07",
        concept: "Compra Cartonera Andina | cajas de reposicion urgente",
        originModule: "Compras",
        sourceDocument: "001-004-000000395",
        externalReference: "0990012345678901234567890123456789012345678913",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Compra adicional para ejemplo de lote confirmado",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.03.02", accountName: "Inventario materiales de empaque", debit: 420, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Reposicion urgente", documentReference: "001-004-000000395" },
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 0, credit: 420, costCenter: "", auxiliary: "0990012345001", lineDescription: "Proveedor Cartonera Andina", documentReference: "001-004-000000395" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000011",
        accountingDate: "2026-07-16",
        accountingPeriod: "2026-07",
        concept: "Pago a proveedor Agroinsumos del Ecuador",
        originModule: "Pagos",
        sourceDocument: "PAG-2026-000001",
        externalReference: "TRF-AGRO-54720",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Pago total de documento 001-003-000000231",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 547.2, credit: 0, costCenter: "", auxiliary: "1790012345001", lineDescription: "Cancelacion documento 001-003-000000231", documentReference: "001-003-000000231" },
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 0, credit: 547.2, costCenter: "", auxiliary: "", lineDescription: "Salida banco principal", documentReference: "PAG-2026-000001" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000012",
        accountingDate: "2026-07-17",
        accountingPeriod: "2026-07",
        concept: "Pago a proveedor Servicios Tecnicos Quito",
        originModule: "Pagos",
        sourceDocument: "PAG-2026-000002",
        externalReference: "CAJ-STQ-001",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Pago parcial de documento 001-002-000000145",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 100, credit: 0, costCenter: "", auxiliary: "1710012345001", lineDescription: "Pago parcial documento 001-002-000000145", documentReference: "001-002-000000145" },
          { id: uid("JLN"), accountCode: "1.1.01.01", accountName: "Caja general", debit: 0, credit: 100, costCenter: "", auxiliary: "", lineDescription: "Salida caja general", documentReference: "PAG-2026-000002" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000013",
        accountingDate: "2026-07-18",
        accountingPeriod: "2026-07",
        concept: "Lote de pagos Lote 000002 | Cartonera Andina",
        originModule: "Pagos",
        sourceDocument: "LOT-2026-000002",
        externalReference: "LOTE-CART-420",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Lote confirmado de ejemplo",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 420, credit: 0, costCenter: "", auxiliary: "0990012345001", lineDescription: "Pago lote documento 001-004-000000395", documentReference: "001-004-000000395" },
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 0, credit: 420, costCenter: "", auxiliary: "", lineDescription: "Salida banco principal", documentReference: "LOT-2026-000002" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000014",
        accountingDate: "2026-07-20",
        accountingPeriod: "2026-07",
        concept: "Ingreso manual a Banco Pichincha por aporte extraordinario",
        originModule: "Bancos",
        sourceDocument: "MOV-2026-000001",
        externalReference: "DEP-EXT-001",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Movimiento bancario manual de prueba",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 850, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Ingreso bancario manual", documentReference: "MOV-2026-000001" },
          { id: uid("JLN"), accountCode: "3.1", accountName: "Capital", debit: 0, credit: 850, costCenter: "", auxiliary: "", lineDescription: "Contrapartida aporte extraordinario", documentReference: "DEP-EXT-001" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000015",
        accountingDate: "2026-07-21",
        accountingPeriod: "2026-07",
        concept: "Comision bancaria mensual Banco Pichincha",
        originModule: "Bancos",
        sourceDocument: "MOV-2026-000002",
        externalReference: "COM-BP-0721",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Comision bancaria manual de prueba",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "6.3", accountName: "Gastos financieros", debit: 12.5, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Comision bancaria", documentReference: "MOV-2026-000002" },
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 0, credit: 12.5, costCenter: "", auxiliary: "", lineDescription: "Salida por comision", documentReference: "COM-BP-0721" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000016",
        accountingDate: "2026-06-12",
        accountingPeriod: "2026-06",
        concept: "Pago proveedor Agroinsumos del Ecuador",
        originModule: "Pagos",
        sourceDocument: "MOV-2026-000004",
        externalReference: "TRF-AGRO-0626",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Movimiento demo para conciliacion bancaria de junio.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "2.1.01", accountName: "Cuentas por pagar proveedores", debit: 560, credit: 0, costCenter: "", auxiliary: "1790012345001", lineDescription: "Pago proveedor Agroinsumos", documentReference: "TRF-AGRO-0626" },
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 0, credit: 560, costCenter: "", auxiliary: "", lineDescription: "Salida Banco Pichincha", documentReference: "MOV-2026-000004" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000017",
        accountingDate: "2026-06-20",
        accountingPeriod: "2026-06",
        concept: "Comision bancaria junio Banco Pichincha",
        originModule: "Bancos",
        sourceDocument: "MOV-2026-000005",
        externalReference: "COM-BP-0620",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Movimiento demo para conciliacion bancaria de junio.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "6.3", accountName: "Gastos financieros", debit: 5, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Comision bancaria", documentReference: "COM-BP-0620" },
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 0, credit: 5, costCenter: "", auxiliary: "", lineDescription: "Salida por comision", documentReference: "MOV-2026-000005" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000018",
        accountingDate: "2026-06-25",
        accountingPeriod: "2026-06",
        concept: "Ingreso manual Banco Pichincha por deposito de cliente",
        originModule: "Bancos",
        sourceDocument: "MOV-2026-000006",
        externalReference: "DEP-CLI-0625",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Movimiento demo para conciliacion bancaria de junio.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 1000, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Ingreso bancario manual", documentReference: "MOV-2026-000006" },
          { id: uid("JLN"), accountCode: "1.1.02", accountName: "Cuentas por cobrar", debit: 0, credit: 1000, costCenter: "", auxiliary: "CLIENTE-DEMO", lineDescription: "Aplicacion deposito cliente", documentReference: "DEP-CLI-0625" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000019",
        accountingDate: "2026-07-10",
        accountingPeriod: "2026-07",
        concept: "Saldo inicial cartera FlowerForce",
        originModule: "Cobros",
        sourceDocument: "SALDO-CLI-001",
        externalReference: "CXC-2026-000001",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Saldo inicial de cartera de prueba.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.02", accountName: "Cuentas por cobrar", debit: 1200, credit: 0, costCenter: "", auxiliary: "FF-USA-001", lineDescription: "Saldo inicial FlowerForce", documentReference: "SALDO-CLI-001" },
          { id: uid("JLN"), accountCode: "4.1", accountName: "Ventas locales", debit: 0, credit: 1200, costCenter: "", auxiliary: "", lineDescription: "Contrapartida saldo inicial", documentReference: "SALDO-CLI-001" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000020",
        accountingDate: "2026-07-11",
        accountingPeriod: "2026-07",
        concept: "Documento manual cartera Floristeria Quito",
        originModule: "Cobros",
        sourceDocument: "DOC-CLI-002",
        externalReference: "CXC-2026-000002",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Documento manual de prueba para cartera local.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.02", accountName: "Cuentas por cobrar", debit: 450, credit: 0, costCenter: "", auxiliary: "1792011122001", lineDescription: "Documento manual Floristeria Quito", documentReference: "DOC-CLI-002" },
          { id: uid("JLN"), accountCode: "4.1", accountName: "Ventas locales", debit: 0, credit: 450, costCenter: "", auxiliary: "", lineDescription: "Contrapartida documento manual", documentReference: "DOC-CLI-002" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000021",
        accountingDate: "2026-07-12",
        accountingPeriod: "2026-07",
        concept: "Documento manual cartera Interflora Logistics",
        originModule: "Cobros",
        sourceDocument: "DOC-CLI-003",
        externalReference: "CXC-2026-000003",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Documento manual de prueba para cliente exterior.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.02", accountName: "Cuentas por cobrar", debit: 2300, credit: 0, costCenter: "", auxiliary: "NL-INT-7788", lineDescription: "Documento manual Interflora Logistics", documentReference: "DOC-CLI-003" },
          { id: uid("JLN"), accountCode: "4.2", accountName: "Ventas exportacion", debit: 0, credit: 2300, costCenter: "", auxiliary: "", lineDescription: "Contrapartida documento manual exterior", documentReference: "DOC-CLI-003" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000022",
        accountingDate: "2026-07-18",
        accountingPeriod: "2026-07",
        concept: "Cobro total Floristeria Quito",
        originModule: "Cobros",
        sourceDocument: "COB-2026-000001",
        externalReference: "DEP-FQ-0718",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Cobro total individual de cartera local.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.01.01", accountName: "Caja general", debit: 450, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Ingreso caja por cobro", documentReference: "COB-2026-000001" },
          { id: uid("JLN"), accountCode: "1.1.02", accountName: "Cuentas por cobrar", debit: 0, credit: 450, costCenter: "", auxiliary: "1792011122001", lineDescription: "Cobro Floristeria Quito", documentReference: "DOC-CLI-002" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000023",
        accountingDate: "2026-07-20",
        accountingPeriod: "2026-07",
        concept: "Lote de cobros LCB-2026-000001",
        originModule: "Cobros",
        sourceDocument: "LCB-2026-000001",
        externalReference: "LOTE-COB-0720",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Cobro masivo confirmado de prueba.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.01.02", accountName: "Banco principal", debit: 800, credit: 0, costCenter: "", auxiliary: "", lineDescription: "Ingreso banco por lote de cobros", documentReference: "LCB-2026-000001" },
          { id: uid("JLN"), accountCode: "1.1.02", accountName: "Cuentas por cobrar", debit: 0, credit: 800, costCenter: "", auxiliary: "NL-INT-7788", lineDescription: "Cobro parcial Interflora Logistics", documentReference: "DOC-CLI-003" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000024",
        accountingDate: "2026-07-22",
        accountingPeriod: "2026-07",
        concept: "Consumo de ligas a empaque",
        originModule: "Inventario",
        sourceDocument: "INV-2026-000006",
        externalReference: "CONS-EMP-0722",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Consumo confirmado de ligas para proceso de empaque.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "5.2", accountName: "Costo materiales de empaque", debit: 102, credit: 0, costCenter: "EMPAQUE", auxiliary: "", lineDescription: "Consumo ligas para empaque", documentReference: "INV-2026-000006" },
          { id: uid("JLN"), accountCode: "1.1.03.02", accountName: "Inventario materiales de empaque", debit: 0, credit: 102, costCenter: "", auxiliary: "", lineDescription: "Salida de ligas de inventario", documentReference: "INV-2026-000006" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000025",
        accountingDate: "2026-07-23",
        accountingPeriod: "2026-07",
        concept: "Ajuste negativo por perdida de etiquetas",
        originModule: "Inventario",
        sourceDocument: "INV-2026-000007",
        externalReference: "AJU-ETQ-0723",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Merma registrada en material de empaque.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "6.2", accountName: "Gastos de suministros", debit: 36, credit: 0, costCenter: "BODEGA", auxiliary: "", lineDescription: "Merma de etiquetas adhesivas", documentReference: "INV-2026-000007" },
          { id: uid("JLN"), accountCode: "1.1.03.02", accountName: "Inventario materiales de empaque", debit: 0, credit: 36, costCenter: "", auxiliary: "", lineDescription: "Salida por ajuste negativo", documentReference: "INV-2026-000007" }
        ]
      },
      {
        id: uid("JNL"),
        entryNumber: "ASI-2026-000026",
        accountingDate: "2026-07-24",
        accountingPeriod: "2026-07",
        concept: "Salida de fertilizante a proveedor pendiente de descontar",
        originModule: "Inventario",
        sourceDocument: "INV-2026-000008",
        externalReference: "SAL-PRV-0724",
        status: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt,
        observation: "Entrega de fertilizante a proveedor para descuento futuro.",
        reversedById: "",
        reverseOfId: "",
        lines: [
          { id: uid("JLN"), accountCode: "1.1.04", accountName: "Anticipos a proveedores", debit: 63, credit: 0, costCenter: "", auxiliary: "1790012345001", lineDescription: "Entrega a proveedor Agroinsumos", documentReference: "INV-2026-000008" },
          { id: uid("JLN"), accountCode: "1.1.03.01", accountName: "Inventario suministros", debit: 0, credit: 63, costCenter: "", auxiliary: "", lineDescription: "Salida fertilizante de inventario", documentReference: "INV-2026-000008" }
        ]
      }
    ];
  }

  function createPurchasesSeed(providers, memories, journalEntries) {
    const [agro, cartonera, servicios] = providers;
    const agroEntry = journalEntries.find(entry => entry.entryNumber === "ASI-2026-000006");
    const agroPendingEntry = journalEntries.find(entry => entry.entryNumber === "ASI-2026-000007");
    const cartoneraPendingEntry = journalEntries.find(entry => entry.entryNumber === "ASI-2026-000008");
    const serviciosPendingEntry = journalEntries.find(entry => entry.entryNumber === "ASI-2026-000009");
    const cartoneraBatchEntry = journalEntries.find(entry => entry.entryNumber === "ASI-2026-000010");
    const serviciosEntry = journalEntries.find(entry => entry.entryNumber === "ASI-2026-000005");
    const memoryAgro = memories.find(item => item.supplierId === agro.id);
    const memoryCartonera = memories.find(item => item.supplierId === cartonera.id);
    const memoryServicios = memories.find(item => item.supplierId === servicios.id);

    return [
      {
        id: uid("PUR"),
        source: "MANUAL",
        importStatus: "IMPORTADO",
        supplierId: servicios.id,
        supplierName: servicios.name,
        supplierRuc: servicios.ruc,
        supplierAddress: servicios.address,
        issueDate: "2026-07-06",
        accountingDate: "2026-07-06",
        dueDate: "2026-07-21",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "002",
        sequential: "000000145",
        authorizationNumber: "1790012345678901234567890123456789012345678901",
        accessKey: "",
        taxSupportCode: "02",
        purchaseType: "SERVICIOS_PROFESIONALES",
        observation: "Mantenimiento preventivo de cuarto frio",
        status: "PENDIENTE_RETENCION",
        retentionStatus: "Pendiente",
        payableId: uid("APV"),
        journalEntryId: serviciosEntry?.id || "",
        journalEntryNumber: serviciosEntry?.entryNumber || "",
        documentNumber: "001-002-000000145",
        duplicateKey: `${servicios.ruc}|factura|001002|000000145|1790012345678901234567890123456789012345678901`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "",
            description: "Servicio tecnico de mantenimiento",
            quantity: 1,
            unitPrice: 200,
            discount: 0,
            taxableBase: 200,
            vatRate: 15,
            vatValue: 30,
            totalLine: 230,
            accountCode: "6.1",
            accountName: "Gastos administrativos",
            costCenter: "ADMIN",
            lineType: "servicio",
            suggestionMode: "Automatico",
            suggestedAccountCode: memoryServicios?.accountCode || "6.1"
          }
        ],
        totals: {
          base0: 0,
          baseIva: 200,
          iva: 30,
          total: 230,
          withholdingsTotal: 0,
          balanceDue: 230
        }
      },
      {
        id: uid("PUR"),
        source: "XML",
        importStatus: "IMPORTADO",
        supplierId: agro.id,
        supplierName: agro.name,
        supplierRuc: agro.ruc,
        supplierAddress: agro.address,
        issueDate: "2026-07-02",
        accountingDate: "2026-07-02",
        dueDate: "2026-07-17",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "003",
        sequential: "000000231",
        authorizationNumber: "1790012345678901234567890123456789012345678902",
        accessKey: "1790012345678901234567890123456789012345678902",
        taxSupportCode: "01",
        purchaseType: "AGRICOLA",
        observation: "Fertilizante premium para stock",
        status: "RETENIDO",
        retentionStatus: "Borrador",
        payableId: uid("APV"),
        journalEntryId: agroEntry?.id || "",
        journalEntryNumber: agroEntry?.entryNumber || "",
        documentNumber: "001-003-000000231",
        duplicateKey: `${agro.ruc}|factura|001003|000000231|1790012345678901234567890123456789012345678902`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "FERT-01",
            description: "Fertilizante premium foliar",
            quantity: 8,
            unitPrice: 60,
            discount: 0,
            taxableBase: 480,
            vatRate: 15,
            vatValue: 72,
            totalLine: 552,
            accountCode: "1.1.03.01",
            accountName: "Inventario suministros",
            costCenter: "",
            lineType: "fertilizante",
            suggestionMode: "Automatico",
            suggestedAccountCode: memoryAgro?.accountCode || "1.1.03.01"
          }
        ],
        totals: {
          base0: 0,
          baseIva: 480,
          iva: 72,
          total: 552,
          withholdingsTotal: 4.8,
          balanceDue: 552
        }
      },
      {
        id: uid("PUR"),
        source: "XML",
        importStatus: "VALIDO",
        supplierId: cartonera.id,
        supplierName: cartonera.name,
        supplierRuc: cartonera.ruc,
        supplierAddress: cartonera.address,
        issueDate: "2026-07-09",
        accountingDate: "2026-07-09",
        dueDate: "2026-07-24",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "004",
        sequential: "000000381",
        authorizationNumber: "0990012345678901234567890123456789012345678903",
        accessKey: "0990012345678901234567890123456789012345678903",
        taxSupportCode: "01",
        purchaseType: "INVENTARIO_EMPAQUE",
        observation: "Importado desde XML, listo para clasificar",
        status: "XML_LEIDO",
        retentionStatus: "No requerida",
        payableId: "",
        journalEntryId: "",
        journalEntryNumber: "",
        documentNumber: "001-004-000000381",
        duplicateKey: `${cartonera.ruc}|factura|001004|000000381|0990012345678901234567890123456789012345678903`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "HB-BOX",
            description: "Caja HB exportacion",
            quantity: 120,
            unitPrice: 1.35,
            discount: 0,
            taxableBase: 162,
            vatRate: 15,
            vatValue: 24.3,
            totalLine: 186.3,
            accountCode: "1.1.03.02",
            accountName: "Inventario materiales de empaque",
            costCenter: "",
            lineType: "material empaque",
            suggestionMode: "Automatico",
            suggestedAccountCode: memoryCartonera?.accountCode || "1.1.03.02"
          }
        ],
        totals: {
          base0: 0,
          baseIva: 162,
          iva: 24.3,
          total: 186.3,
          withholdingsTotal: 0,
          balanceDue: 186.3
        }
      },
      {
        id: uid("PUR"),
        source: "XML",
        importStatus: "PENDIENTE_CUENTA",
        supplierId: agro.id,
        supplierName: agro.name,
        supplierRuc: agro.ruc,
        supplierAddress: agro.address,
        issueDate: "2026-07-10",
        accountingDate: "2026-07-10",
        dueDate: "2026-07-25",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "003",
        sequential: "000000241",
        authorizationNumber: "1790012345678901234567890123456789012345678904",
        accessKey: "1790012345678901234567890123456789012345678904",
        taxSupportCode: "01",
        purchaseType: "AGRICOLA",
        observation: "Importado desde XML con cuenta pendiente",
        status: "PENDIENTE_CLASIFICACION",
        retentionStatus: "Pendiente",
        payableId: "",
        journalEntryId: "",
        journalEntryNumber: "",
        documentNumber: "001-003-000000241",
        duplicateKey: `${agro.ruc}|factura|001003|000000241|1790012345678901234567890123456789012345678904`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "QUM-02",
            description: "Regulador de crecimiento especial",
            quantity: 4,
            unitPrice: 52,
            discount: 0,
            taxableBase: 208,
            vatRate: 15,
            vatValue: 31.2,
            totalLine: 239.2,
            accountCode: "",
            accountName: "",
            costCenter: "",
            lineType: "quimico",
            suggestionMode: "Sugerido",
            suggestedAccountCode: "1.1.03.01"
          }
        ],
        totals: {
          base0: 0,
          baseIva: 208,
          iva: 31.2,
          total: 239.2,
          withholdingsTotal: 0,
          balanceDue: 239.2
        }
      },
      {
        id: uid("PUR"),
        source: "MANUAL",
        importStatus: "IMPORTADO",
        supplierId: agro.id,
        supplierName: agro.name,
        supplierRuc: agro.ruc,
        supplierAddress: agro.address,
        issueDate: "2026-07-11",
        accountingDate: "2026-07-11",
        dueDate: "2026-07-26",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "003",
        sequential: "000000242",
        authorizationNumber: "1790012345678901234567890123456789012345678910",
        accessKey: "",
        taxSupportCode: "01",
        purchaseType: "INVENTARIO_SUMINISTROS",
        observation: "Fertilizante granulado para stock de julio",
        status: "CONTABILIZADO",
        retentionStatus: "No requerida",
        payableId: uid("APV"),
        journalEntryId: agroPendingEntry?.id || "",
        journalEntryNumber: agroPendingEntry?.entryNumber || "",
        documentNumber: "001-003-000000242",
        duplicateKey: `${agro.ruc}|factura|001003|000000242|1790012345678901234567890123456789012345678910`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "FERT-07",
            description: "Fertilizante granulado stock julio",
            quantity: 1,
            unitPrice: 560,
            discount: 0,
            taxableBase: 560,
            vatRate: 0,
            vatValue: 0,
            totalLine: 560,
            accountCode: "1.1.03.01",
            accountName: "Inventario suministros",
            costCenter: "",
            lineType: "fertilizante",
            suggestionMode: "Automatico",
            suggestedAccountCode: memoryAgro?.accountCode || "1.1.03.01"
          }
        ],
        totals: {
          base0: 560,
          baseIva: 0,
          iva: 0,
          total: 560,
          withholdingsTotal: 0,
          balanceDue: 560
        }
      },
      {
        id: uid("PUR"),
        source: "MANUAL",
        importStatus: "IMPORTADO",
        supplierId: cartonera.id,
        supplierName: cartonera.name,
        supplierRuc: cartonera.ruc,
        supplierAddress: cartonera.address,
        issueDate: "2026-07-12",
        accountingDate: "2026-07-12",
        dueDate: "2026-08-26",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "004",
        sequential: "000000402",
        authorizationNumber: "0990012345678901234567890123456789012345678911",
        accessKey: "",
        taxSupportCode: "01",
        purchaseType: "INVENTARIO_EMPAQUE",
        observation: "Lote grande de cajas HB y QB para exportacion",
        status: "CONTABILIZADO",
        retentionStatus: "No requerida",
        payableId: uid("APV"),
        journalEntryId: cartoneraPendingEntry?.id || "",
        journalEntryNumber: cartoneraPendingEntry?.entryNumber || "",
        documentNumber: "001-004-000000402",
        duplicateKey: `${cartonera.ruc}|factura|001004|000000402|0990012345678901234567890123456789012345678911`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "PACK-HB-QB",
            description: "Lote de cajas HB y QB",
            quantity: 1,
            unitPrice: 1250,
            discount: 0,
            taxableBase: 1250,
            vatRate: 0,
            vatValue: 0,
            totalLine: 1250,
            accountCode: "1.1.03.02",
            accountName: "Inventario materiales de empaque",
            costCenter: "",
            lineType: "material empaque",
            suggestionMode: "Automatico",
            suggestedAccountCode: memoryCartonera?.accountCode || "1.1.03.02"
          }
        ],
        totals: {
          base0: 1250,
          baseIva: 0,
          iva: 0,
          total: 1250,
          withholdingsTotal: 0,
          balanceDue: 1250
        }
      },
      {
        id: uid("PUR"),
        source: "MANUAL",
        importStatus: "IMPORTADO",
        supplierId: servicios.id,
        supplierName: servicios.name,
        supplierRuc: servicios.ruc,
        supplierAddress: servicios.address,
        issueDate: "2026-07-13",
        accountingDate: "2026-07-13",
        dueDate: "2026-07-28",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "002",
        sequential: "000000152",
        authorizationNumber: "1710012345678901234567890123456789012345678912",
        accessKey: "",
        taxSupportCode: "02",
        purchaseType: "SERVICIOS",
        observation: "Soporte correctivo de sistemas administrativos",
        status: "CONTABILIZADO",
        retentionStatus: "Pendiente",
        payableId: uid("APV"),
        journalEntryId: serviciosPendingEntry?.id || "",
        journalEntryNumber: serviciosPendingEntry?.entryNumber || "",
        documentNumber: "001-002-000000152",
        duplicateKey: `${servicios.ruc}|factura|001002|000000152|1710012345678901234567890123456789012345678912`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "",
            description: "Soporte correctivo administrativo",
            quantity: 1,
            unitPrice: 300,
            discount: 0,
            taxableBase: 300,
            vatRate: 0,
            vatValue: 0,
            totalLine: 300,
            accountCode: "6.1",
            accountName: "Gastos administrativos",
            costCenter: "ADMIN",
            lineType: "servicio",
            suggestionMode: "Automatico",
            suggestedAccountCode: memoryServicios?.accountCode || "6.1"
          }
        ],
        totals: {
          base0: 300,
          baseIva: 0,
          iva: 0,
          total: 300,
          withholdingsTotal: 0,
          balanceDue: 300
        }
      },
      {
        id: uid("PUR"),
        source: "MANUAL",
        importStatus: "IMPORTADO",
        supplierId: cartonera.id,
        supplierName: cartonera.name,
        supplierRuc: cartonera.ruc,
        supplierAddress: cartonera.address,
        issueDate: "2026-07-14",
        accountingDate: "2026-07-14",
        dueDate: "2026-07-29",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "004",
        sequential: "000000395",
        authorizationNumber: "0990012345678901234567890123456789012345678913",
        accessKey: "",
        taxSupportCode: "01",
        purchaseType: "INVENTARIO_EMPAQUE",
        observation: "Reposicion urgente de cajas para lote especial",
        status: "CONTABILIZADO",
        retentionStatus: "No requerida",
        payableId: uid("APV"),
        journalEntryId: cartoneraBatchEntry?.id || "",
        journalEntryNumber: cartoneraBatchEntry?.entryNumber || "",
        documentNumber: "001-004-000000395",
        duplicateKey: `${cartonera.ruc}|factura|001004|000000395|0990012345678901234567890123456789012345678913`,
        lines: [
          {
            id: uid("PLN"),
            productCode: "HB-URG",
            description: "Reposicion urgente de cajas",
            quantity: 1,
            unitPrice: 420,
            discount: 0,
            taxableBase: 420,
            vatRate: 0,
            vatValue: 0,
            totalLine: 420,
            accountCode: "1.1.03.02",
            accountName: "Inventario materiales de empaque",
            costCenter: "",
            lineType: "material empaque",
            suggestionMode: "Automatico",
            suggestedAccountCode: memoryCartonera?.accountCode || "1.1.03.02"
          }
        ],
        totals: {
          base0: 420,
          baseIva: 0,
          iva: 0,
          total: 420,
          withholdingsTotal: 0,
          balanceDue: 420
        }
      },
      {
        id: uid("PUR"),
        source: "MANUAL",
        importStatus: "LEIDO",
        supplierId: "",
        supplierName: "",
        supplierRuc: "",
        supplierAddress: "",
        issueDate: today(),
        accountingDate: today(),
        dueDate: "",
        voucherType: "factura",
        estab: "001",
        ptoEmi: "002",
        sequential: "000000166",
        authorizationNumber: "",
        accessKey: "",
        taxSupportCode: "02",
        purchaseType: "GASTO",
        observation: "Borrador manual para registrar gastos",
        status: "BORRADOR",
        retentionStatus: "Pendiente",
        payableId: "",
        journalEntryId: "",
        journalEntryNumber: "",
        documentNumber: "001-002-000000166",
        duplicateKey: "",
        lines: [
          {
            id: uid("PLN"),
            productCode: "",
            description: "Detalle pendiente",
            quantity: 1,
            unitPrice: 0,
            discount: 0,
            taxableBase: 0,
            vatRate: 15,
            vatValue: 0,
            totalLine: 0,
            accountCode: "",
            accountName: "",
            costCenter: "",
            lineType: "gasto",
            suggestionMode: "Manual",
            suggestedAccountCode: "6.1"
          }
        ],
        totals: {
          base0: 0,
          baseIva: 0,
          iva: 0,
          total: 0,
          withholdingsTotal: 0,
          balanceDue: 0
        }
      }
    ];
  }

  function createPayablesSeed(purchases) {
    return purchases
      .filter(purchase => purchase.status === "PENDIENTE_RETENCION" || purchase.status === "RETENIDO" || purchase.status === "CONTABILIZADO")
      .map(purchase => ({
        id: purchase.payableId || uid("APV"),
        purchaseId: purchase.id,
        supplierName: purchase.supplierName,
        supplierRuc: purchase.supplierRuc,
        documentNumber: purchase.documentNumber,
        issueDate: purchase.issueDate,
        dueDate: purchase.dueDate,
        total: purchase.totals.total,
        balance: purchase.totals.balanceDue,
        status: "pendiente",
        journalEntryId: purchase.journalEntryId,
        journalEntryNumber: purchase.journalEntryNumber
      }));
  }

  function createIssuedWithholdingsSeed(purchases) {
    const related = purchases.find(item => item.documentNumber === "001-002-000000152");
    if (!related) return [];
    return [
      {
        id: uid("RET"),
        purchaseId: related.id,
        purchaseDocumentNumber: related.documentNumber,
        supplierName: related.supplierName,
        supplierRuc: related.supplierRuc,
        retentionDate: "2026-07-15",
        draftNumber: "RET-BOR-000001",
        rentCode: "RET_304",
        rentSriCode: "304",
        rentDescription: "Servicios",
        rentBaseAmount: 300,
        rentPercentage: 2,
        rentRetainedAmount: 6,
        rentPayableAccountCode: "2.1.02.02",
        vatCode: "",
        vatSriCode: "",
        vatDescription: "",
        vatBaseAmount: 0,
        vatPercentage: 0,
        vatRetainedAmount: 0,
        vatPayableAccountCode: "2.1.02.01",
        totalRetained: 6,
        status: "BORRADOR"
      }
    ];
  }

  function createReceivedWithholdingsSeed(customers, receivables) {
    const quito = customers.find(item => item.code === "CLI-002");
    const flowerForce = customers.find(item => item.code === "CLI-001");
    const quitoReceivable = receivables.find(item => item.documentNumber === "CXC-001");
    const flowerReceivable = receivables.find(item => item.documentNumber === "CXC-002");
    return [
      {
        id: uid("WRC"),
        issuerTaxId: quito?.taxId || "1799999999001",
        issuerName: quito?.name || "Floristeria Quito",
        issueDate: "2026-07-21",
        fiscalPeriod: "07/2026",
        estab: "001",
        ptoEmi: "001",
        sequential: "000000041",
        documentNumber: "001-001-000000041",
        authorizationNumber: "1799999999001001001000000041123456789012345678901234",
        accessKey: "1799999999001001001000000041123456789012345678901234",
        supportDocumentNumber: "CXC-001",
        supportDocumentDate: "2026-07-11",
        totalRetained: 8.78,
        lines: [
          {
            id: uid("WRL"),
            taxType: "RENTA",
            retentionCode: "RET_304",
            sriCode: "304",
            percentage: 1.95,
            baseAmount: 450,
            retainedAmount: 8.78
          }
        ],
        importStatus: "IMPORTADO",
        status: "PENDIENTE_RELACION",
        suggestedReceivableId: quitoReceivable?.id || "",
        suggestedReceivableNumber: quitoReceivable?.documentNumber || "CXC-001",
        relatedReceivableId: "",
        relatedReceivableNumber: "",
        journalEntryId: "",
        journalEntryNumber: "",
        createdAt: new Date().toISOString()
      },
      {
        id: uid("WRC"),
        issuerTaxId: flowerForce?.taxId || "FF-USA-001",
        issuerName: flowerForce?.name || "FlowerForce",
        issueDate: "2026-07-22",
        fiscalPeriod: "07/2026",
        estab: "001",
        ptoEmi: "002",
        sequential: "000000085",
        documentNumber: "001-002-000000085",
        authorizationNumber: "FF0010020000000851234567890123456789012345678901234",
        accessKey: "FF0010020000000851234567890123456789012345678901234",
        supportDocumentNumber: "CXC-002",
        supportDocumentDate: "2026-07-10",
        totalRetained: 12,
        lines: [
          {
            id: uid("WRL"),
            taxType: "RENTA",
            retentionCode: "RET_312",
            sriCode: "312",
            percentage: 1,
            baseAmount: 1200,
            retainedAmount: 12
          }
        ],
        importStatus: "IMPORTADO",
        status: "IMPORTADO",
        suggestedReceivableId: flowerReceivable?.id || "",
        suggestedReceivableNumber: flowerReceivable?.documentNumber || "CXC-002",
        relatedReceivableId: "",
        relatedReceivableNumber: "",
        journalEntryId: "",
        journalEntryNumber: "",
        createdAt: new Date().toISOString()
      }
    ];
  }

  function createPaymentsSeed(purchases, journalEntries) {
    const agroPaid = purchases.find(item => item.documentNumber === "001-003-000000231");
    const servicePartial = purchases.find(item => item.documentNumber === "001-002-000000145");
    const agroEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000011");
    const serviceEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000012");
    return [
      {
        id: uid("PAY"),
        paymentNumber: "PAG-2026-000001",
        providerId: agroPaid?.supplierId || "",
        providerName: agroPaid?.supplierName || "",
        providerRuc: agroPaid?.supplierRuc || "",
        paymentDate: "2026-07-16",
        paymentMethod: "transferencia",
        paymentAccountCode: "1.1.01.02",
        paymentAccountName: "Banco principal",
        reference: "TRF-AGRO-54720",
        observation: "Pago total de compra retenida",
        status: "CONFIRMADO",
        entryId: agroEntry?.id || "",
        entryNumber: agroEntry?.entryNumber || "",
        source: "INDIVIDUAL",
        total: 547.2,
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString(),
        applications: [
          {
            payableId: agroPaid?.payableId || `payable-${agroPaid?.id || ""}`,
            purchaseId: agroPaid?.id || "",
            documentNumber: agroPaid?.documentNumber || "",
            supplierName: agroPaid?.supplierName || "",
            supplierRuc: agroPaid?.supplierRuc || "",
            providerId: agroPaid?.supplierId || "",
            originalBalance: 547.2,
            withholdingApplied: 4.8,
            advanceApplied: 0,
            amount: 547.2,
            resultingBalance: 0
          }
        ]
      },
      {
        id: uid("PAY"),
        paymentNumber: "PAG-2026-000002",
        providerId: servicePartial?.supplierId || "",
        providerName: servicePartial?.supplierName || "",
        providerRuc: servicePartial?.supplierRuc || "",
        paymentDate: "2026-07-17",
        paymentMethod: "caja",
        paymentAccountCode: "1.1.01.01",
        paymentAccountName: "Caja general",
        reference: "CAJ-STQ-001",
        observation: "Pago parcial de mantenimiento",
        status: "CONFIRMADO",
        entryId: serviceEntry?.id || "",
        entryNumber: serviceEntry?.entryNumber || "",
        source: "INDIVIDUAL",
        total: 100,
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString(),
        applications: [
          {
            payableId: servicePartial?.payableId || `payable-${servicePartial?.id || ""}`,
            purchaseId: servicePartial?.id || "",
            documentNumber: servicePartial?.documentNumber || "",
            supplierName: servicePartial?.supplierName || "",
            supplierRuc: servicePartial?.supplierRuc || "",
            providerId: servicePartial?.supplierId || "",
            originalBalance: 230,
            withholdingApplied: 0,
            advanceApplied: 0,
            amount: 100,
            resultingBalance: 130
          }
        ]
      }
    ];
  }

  function createPaymentBatchesSeed(purchases, journalEntries) {
    const agroPending = purchases.find(item => item.documentNumber === "001-003-000000242");
    const cartoneraPending = purchases.find(item => item.documentNumber === "001-004-000000402");
    const cartoneraConfirmed = purchases.find(item => item.documentNumber === "001-004-000000395");
    const confirmedEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000013");
    return [
      {
        id: uid("LOT"),
        batchNumber: "LOT-2026-000001",
        paymentDate: "2026-07-19",
        paymentAccountCode: "1.1.01.02",
        paymentAccountName: "Banco principal",
        reference: "LOTE-BORR-001",
        observation: "Lote de prueba en borrador",
        status: "BORRADOR",
        entryId: "",
        entryNumber: "",
        totalDocuments: 2,
        totalToPay: 1160,
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString(),
        applications: [
          {
            payableId: agroPending?.payableId || `payable-${agroPending?.id || ""}`,
            purchaseId: agroPending?.id || "",
            documentNumber: agroPending?.documentNumber || "",
            supplierName: agroPending?.supplierName || "",
            supplierRuc: agroPending?.supplierRuc || "",
            providerId: agroPending?.supplierId || "",
            originalBalance: 560,
            withholdingApplied: 0,
            advanceApplied: 0,
            amount: 560,
            resultingBalance: 0
          },
          {
            payableId: cartoneraPending?.payableId || `payable-${cartoneraPending?.id || ""}`,
            purchaseId: cartoneraPending?.id || "",
            documentNumber: cartoneraPending?.documentNumber || "",
            supplierName: cartoneraPending?.supplierName || "",
            supplierRuc: cartoneraPending?.supplierRuc || "",
            providerId: cartoneraPending?.supplierId || "",
            originalBalance: 1250,
            withholdingApplied: 0,
            advanceApplied: 0,
            amount: 600,
            resultingBalance: 650
          }
        ]
      },
      {
        id: uid("LOT"),
        batchNumber: "LOT-2026-000002",
        paymentDate: "2026-07-18",
        paymentAccountCode: "1.1.01.02",
        paymentAccountName: "Banco principal",
        reference: "LOTE-CART-420",
        observation: "Lote confirmado de prueba",
        status: "CONFIRMADO",
        entryId: confirmedEntry?.id || "",
        entryNumber: confirmedEntry?.entryNumber || "",
        totalDocuments: 1,
        totalToPay: 420,
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString(),
        applications: [
          {
            payableId: cartoneraConfirmed?.payableId || `payable-${cartoneraConfirmed?.id || ""}`,
            purchaseId: cartoneraConfirmed?.id || "",
            documentNumber: cartoneraConfirmed?.documentNumber || "",
            supplierName: cartoneraConfirmed?.supplierName || "",
            supplierRuc: cartoneraConfirmed?.supplierRuc || "",
            providerId: cartoneraConfirmed?.supplierId || "",
            originalBalance: 420,
            withholdingApplied: 0,
            advanceApplied: 0,
            amount: 420,
            resultingBalance: 0
          }
        ]
      }
    ];
  }

  function createBankAccountsSeed() {
    return [
      {
        id: uid("BNK"),
        code: "BANCO-PICHINCHA",
        bankName: "Banco Pichincha",
        accountNumber: "2200457788",
        accountType: "corriente",
        holder: "Bless Flower / Proyecto ERP JAMES",
        currency: "USD",
        linkedAccountCode: "1.1.01.02",
        openingBalance: 5000,
        openingBalanceDate: "2026-07-01",
        status: "activa",
        observation: "Cuenta principal de operaciones."
      },
      {
        id: uid("BNK"),
        code: "CAJA-GENERAL",
        bankName: "Caja interna",
        accountNumber: "CAJA-001",
        accountType: "caja",
        holder: "Caja general",
        currency: "USD",
        linkedAccountCode: "1.1.01.01",
        openingBalance: 500,
        openingBalanceDate: "2026-07-01",
        status: "activa",
        observation: "Caja operativa para gastos menores."
      }
    ];
  }

  function createBankMovementsSeed(bankAccounts, journalEntries) {
    const banco = bankAccounts.find(item => item.code === "BANCO-PICHINCHA");
    const caja = bankAccounts.find(item => item.code === "CAJA-GENERAL");
    const pagoJunioEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000016");
    const comisionJunioEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000017");
    const ingresoJunioEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000018");
    const ingresoEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000014");
    const comisionEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000015");
    return [
      {
        id: uid("BMV"),
        movementNumber: "MOV-2026-000004",
        movementDate: "2026-06-12",
        bankAccountId: banco?.id || "",
        movementType: "egreso",
        medium: "transferencia",
        reference: "TRF-AGRO-0626",
        beneficiary: "Agroinsumos del Ecuador",
        concept: "Pago proveedor Agroinsumos",
        incomeValue: 0,
        expenseValue: 560,
        status: "CONTABILIZADO",
        originModule: "pagos",
        sourceDocument: "PAG-2026-JUN-001",
        journalEntryId: pagoJunioEntry?.id || "",
        journalEntryNumber: pagoJunioEntry?.entryNumber || "",
        observation: "Pago demo usado en conciliacion bancaria de junio.",
        counterAccountCode: "2.1.01",
        counterAccountName: "Cuentas por pagar proveedores",
        costCenter: "",
        auxiliary: "1790012345001",
        lineDescription: "Pago proveedor Agroinsumos"
      },
      {
        id: uid("BMV"),
        movementNumber: "MOV-2026-000005",
        movementDate: "2026-06-20",
        bankAccountId: banco?.id || "",
        movementType: "comision",
        medium: "debito",
        reference: "COM-BP-0620",
        beneficiary: "Banco Pichincha",
        concept: "Comision bancaria junio",
        incomeValue: 0,
        expenseValue: 5,
        status: "CONTABILIZADO",
        originModule: "ajustes",
        sourceDocument: "MOV-2026-000005",
        journalEntryId: comisionJunioEntry?.id || "",
        journalEntryNumber: comisionJunioEntry?.entryNumber || "",
        observation: "Comision demo usada en conciliacion bancaria de junio.",
        counterAccountCode: "6.3",
        counterAccountName: "Gastos financieros",
        costCenter: "",
        auxiliary: "",
        lineDescription: "Comision bancaria"
      },
      {
        id: uid("BMV"),
        movementNumber: "MOV-2026-000006",
        movementDate: "2026-06-25",
        bankAccountId: banco?.id || "",
        movementType: "ingreso",
        medium: "deposito",
        reference: "DEP-CLI-0625",
        beneficiary: "Cliente demo",
        concept: "Ingreso manual por deposito de cliente",
        incomeValue: 1000,
        expenseValue: 0,
        status: "CONTABILIZADO",
        originModule: "manual",
        sourceDocument: "MOV-2026-000006",
        journalEntryId: ingresoJunioEntry?.id || "",
        journalEntryNumber: ingresoJunioEntry?.entryNumber || "",
        observation: "Deposito demo usado en conciliacion bancaria de junio.",
        counterAccountCode: "1.1.02",
        counterAccountName: "Cuentas por cobrar",
        costCenter: "",
        auxiliary: "CLIENTE-DEMO",
        lineDescription: "Deposito cliente"
      },
      {
        id: uid("BMV"),
        movementNumber: "MOV-2026-000001",
        movementDate: "2026-07-20",
        bankAccountId: banco?.id || "",
        movementType: "ingreso",
        medium: "deposito",
        reference: "DEP-EXT-001",
        beneficiary: "Aporte extraordinario",
        concept: "Ingreso manual por aporte extraordinario",
        incomeValue: 850,
        expenseValue: 0,
        status: "CONTABILIZADO",
        originModule: "manual",
        sourceDocument: "MOV-2026-000001",
        journalEntryId: ingresoEntry?.id || "",
        journalEntryNumber: ingresoEntry?.entryNumber || "",
        observation: "Deposito extraordinario en banco principal.",
        counterAccountCode: "3.1",
        counterAccountName: "Capital",
        costCenter: "",
        auxiliary: "",
        lineDescription: "Aporte extraordinario"
      },
      {
        id: uid("BMV"),
        movementNumber: "MOV-2026-000002",
        movementDate: "2026-07-21",
        bankAccountId: banco?.id || "",
        movementType: "comision",
        medium: "debito",
        reference: "COM-BP-0721",
        beneficiary: "Banco Pichincha",
        concept: "Comision bancaria mensual",
        incomeValue: 0,
        expenseValue: 12.5,
        status: "CONTABILIZADO",
        originModule: "ajustes",
        sourceDocument: "MOV-2026-000002",
        journalEntryId: comisionEntry?.id || "",
        journalEntryNumber: comisionEntry?.entryNumber || "",
        observation: "Cargo mensual del banco.",
        counterAccountCode: "6.3",
        counterAccountName: "Gastos financieros",
        costCenter: "",
        auxiliary: "",
        lineDescription: "Comision bancaria"
      },
      {
        id: uid("BMV"),
        movementNumber: "MOV-2026-000003",
        movementDate: "2026-07-22",
        bankAccountId: caja?.id || "",
        movementType: "egreso",
        medium: "efectivo",
        reference: "CAJ-BORR-001",
        beneficiary: "Pago menor de utileria",
        concept: "Salida pendiente de contabilizar",
        incomeValue: 0,
        expenseValue: 95,
        status: "BORRADOR",
        originModule: "manual",
        sourceDocument: "MOV-2026-000003",
        journalEntryId: "",
        journalEntryNumber: "",
        observation: "Borrador para prueba del modulo.",
        counterAccountCode: "6.2",
        counterAccountName: "Gastos de suministros",
        costCenter: "ADMIN",
        auxiliary: "",
        lineDescription: "Compra menor de utileria"
      }
    ];
  }

  function createBankStatementMovementsSeed(bankAccounts) {
    const banco = bankAccounts.find(item => item.code === "BANCO-PICHINCHA");
    return [
      {
        id: uid("STM"),
        statementNumber: "EXT-2026-000001",
        bankAccountId: banco?.id || "",
        movementDate: "2026-06-12",
        reference: "TRANSF AGROINSUMOS",
        description: "TRANSF AGROINSUMOS DEL ECUADOR",
        incomeValue: 0,
        expenseValue: 560,
        netValue: -560,
        status: "conciliado",
        relatedMovementId: "",
        observation: "",
        reconciliationId: ""
      },
      {
        id: uid("STM"),
        statementNumber: "EXT-2026-000002",
        bankAccountId: banco?.id || "",
        movementDate: "2026-06-20",
        reference: "COMISION SERVICIO",
        description: "COMISION SERVICIO",
        incomeValue: 0,
        expenseValue: 5,
        netValue: -5,
        status: "conciliado",
        relatedMovementId: "",
        observation: "",
        reconciliationId: ""
      },
      {
        id: uid("STM"),
        statementNumber: "EXT-2026-000003",
        bankAccountId: banco?.id || "",
        movementDate: "2026-06-25",
        reference: "DEPOSITO CLIENTE",
        description: "DEPOSITO CLIENTE",
        incomeValue: 1000,
        expenseValue: 0,
        netValue: 1000,
        status: "conciliado",
        relatedMovementId: "",
        observation: "",
        reconciliationId: ""
      },
      {
        id: uid("STM"),
        statementNumber: "EXT-2026-000004",
        bankAccountId: banco?.id || "",
        movementDate: "2026-06-28",
        reference: "COMISION EXTRA",
        description: "MOVIMIENTO EXTRA BANCO",
        incomeValue: 0,
        expenseValue: 2.5,
        netValue: -2.5,
        status: "observado",
        relatedMovementId: "",
        observation: "Cargo bancario pendiente de ajuste contable.",
        reconciliationId: ""
      }
    ];
  }

  function createBankReconciliationsSeed(bankAccounts, bankMovements, bankStatementMovements) {
    const banco = bankAccounts.find(item => item.code === "BANCO-PICHINCHA");
    const systemPago = bankMovements.find(item => item.reference === "TRF-AGRO-0626");
    const systemComision = bankMovements.find(item => item.reference === "COM-BP-0620");
    const systemIngreso = bankMovements.find(item => item.reference === "DEP-CLI-0625");
    const statementPago = bankStatementMovements.find(item => item.reference === "TRANSF AGROINSUMOS");
    const statementComision = bankStatementMovements.find(item => item.reference === "COMISION SERVICIO");
    const statementIngreso = bankStatementMovements.find(item => item.reference === "DEPOSITO CLIENTE");
    const statementExtra = bankStatementMovements.find(item => item.reference === "COMISION EXTRA");
    const reconciliationId = uid("REC");

    return [
      {
        id: reconciliationId,
        bankAccountId: banco?.id || "",
        period: "2026-06",
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
        openingBankBalance: 4200,
        closingBankBalance: 4632.5,
        status: "EN_REVISION",
        notes: "Conciliacion demo de junio 2026 para validar cruces base.",
        differenceJustification: "Existe un cargo extra de 2.50 en banco pendiente de ajuste contable.",
        closeDate: "",
        closedBy: "",
        reopenedAt: "",
        reopenedBy: "",
        reopenReason: "",
        createdAt: new Date().toISOString(),
        createdBy: "James Lanchimba",
        matches: [
          {
            id: uid("MTC"),
            systemMovementId: systemPago?.id || "",
            statementMovementId: statementPago?.id || "",
            suggestion: "MATCH_EXACTO",
            note: "Pago proveedor conciliado",
            createdAt: new Date().toISOString()
          },
          {
            id: uid("MTC"),
            systemMovementId: systemComision?.id || "",
            statementMovementId: statementComision?.id || "",
            suggestion: "MATCH_EXACTO",
            note: "Comision bancaria conciliada",
            createdAt: new Date().toISOString()
          },
          {
            id: uid("MTC"),
            systemMovementId: systemIngreso?.id || "",
            statementMovementId: statementIngreso?.id || "",
            suggestion: "MATCH_EXACTO",
            note: "Deposito conciliado",
            createdAt: new Date().toISOString()
          }
        ],
        systemReviews: [],
        statementReviews: [
          {
            movementId: statementExtra?.id || "",
            status: "observado",
            observation: "Cargo bancario pendiente de ajuste contable."
          }
        ]
      }
    ];
  }

  function createCustomersSeed() {
    return [
      {
        id: uid("CUS"),
        code: "CLI-001",
        taxId: "FF-USA-001",
        name: "FlowerForce",
        commercialName: "FlowerForce",
        customerType: "exterior",
        country: "USA",
        city: "Miami",
        address: "1450 NW Flower Ave, Miami",
        phone: "+1 305 555 1001",
        email: "ap@flowerforce.test",
        paymentCondition: "Credito 30 dias",
        creditDays: 30,
        creditLimit: 5000,
        receivableAccountCode: "1.1.02",
        advanceAccountCode: "2.1.04",
        status: "activo",
        observation: "Cliente exterior demo para cartera."
      },
      {
        id: uid("CUS"),
        code: "CLI-002",
        taxId: "1799999999001",
        name: "Floristeria Quito",
        commercialName: "Floristeria Quito",
        customerType: "local",
        country: "Ecuador",
        city: "Quito",
        address: "Av. Republica y Amazonas, Quito",
        phone: "022456780",
        email: "compras@floristeriaquito.test",
        paymentCondition: "Contado",
        creditDays: 0,
        creditLimit: 1500,
        receivableAccountCode: "1.1.02",
        advanceAccountCode: "2.1.04",
        status: "activo",
        observation: "Cliente local demo con cobro total."
      },
      {
        id: uid("CUS"),
        code: "CLI-003",
        taxId: "NL-INT-7788",
        name: "Interflora Logistics",
        commercialName: "Interflora Logistics",
        customerType: "exterior",
        country: "Netherlands",
        city: "Aalsmeer",
        address: "Bloemenweg 88, Aalsmeer",
        phone: "+31 20 555 7788",
        email: "accounting@interfloralogistics.test",
        paymentCondition: "Credito 45 dias",
        creditDays: 45,
        creditLimit: 8000,
        receivableAccountCode: "1.1.02",
        advanceAccountCode: "2.1.04",
        status: "activo",
        observation: "Cliente exterior demo con cobro parcial."
      }
    ];
  }

  function createCustomerReceivablesSeed(customers, journalEntries) {
    const flowerForce = customers.find(item => item.code === "CLI-001");
    const quito = customers.find(item => item.code === "CLI-002");
    const interflora = customers.find(item => item.code === "CLI-003");
    const flowerForceEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000019");
    const quitoEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000020");
    const interfloraEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000021");
    return [
      {
        id: uid("CXC"),
        customerId: flowerForce?.id || "",
        customerName: flowerForce?.name || "",
        customerTaxId: flowerForce?.taxId || "",
        customerCountry: flowerForce?.country || "",
        documentType: "saldo inicial",
        documentNumber: "CXC-002",
        issueDate: "2026-07-10",
        dueDate: "2026-07-30",
        concept: "Saldo inicial pendiente cliente FlowerForce",
        total: 1200,
        receivableAccountCode: "1.1.02",
        counterAccountCode: "4.1",
        counterAccountName: "Ventas locales",
        observation: "Saldo inicial pendiente para pruebas de cartera.",
        status: "PENDIENTE",
        source: "MANUAL",
        journalEntryId: flowerForceEntry?.id || "",
        journalEntryNumber: flowerForceEntry?.entryNumber || "",
        postingStatus: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString()
      },
      {
        id: uid("CXC"),
        customerId: quito?.id || "",
        customerName: quito?.name || "",
        customerTaxId: quito?.taxId || "",
        customerCountry: quito?.country || "",
        documentType: "documento manual",
        documentNumber: "CXC-001",
        issueDate: "2026-07-11",
        dueDate: "2026-07-11",
        concept: "Documento manual cartera Floristeria Quito",
        total: 450,
        receivableAccountCode: "1.1.02",
        counterAccountCode: "4.1",
        counterAccountName: "Ventas locales",
        observation: "Documento manual demo con cobro total.",
        status: "PENDIENTE",
        source: "MANUAL",
        journalEntryId: quitoEntry?.id || "",
        journalEntryNumber: quitoEntry?.entryNumber || "",
        postingStatus: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString()
      },
      {
        id: uid("CXC"),
        customerId: interflora?.id || "",
        customerName: interflora?.name || "",
        customerTaxId: interflora?.taxId || "",
        customerCountry: interflora?.country || "",
        documentType: "documento manual",
        documentNumber: "CXC-003",
        issueDate: "2026-07-12",
        dueDate: "2026-08-05",
        concept: "Documento manual cartera Interflora Logistics",
        total: 2300,
        receivableAccountCode: "1.1.02",
        counterAccountCode: "4.2",
        counterAccountName: "Ventas exportacion",
        observation: "Documento manual demo con cobro parcial por lote.",
        status: "PENDIENTE",
        source: "MANUAL",
        journalEntryId: interfloraEntry?.id || "",
        journalEntryNumber: interfloraEntry?.entryNumber || "",
        postingStatus: "CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString()
      },
      {
        id: uid("CXC"),
        customerId: flowerForce?.id || "",
        customerName: flowerForce?.name || "",
        customerTaxId: flowerForce?.taxId || "",
        customerCountry: flowerForce?.country || "",
        documentType: "ajuste",
        documentNumber: "AJU-CLI-004",
        issueDate: "2026-07-14",
        dueDate: "2026-07-28",
        concept: "Ajuste de cartera para cobro masivo en borrador",
        total: 300,
        receivableAccountCode: "1.1.02",
        counterAccountCode: "4.1",
        counterAccountName: "Ventas locales",
        observation: "Documento usado solo en lote de cobro borrador.",
        status: "PENDIENTE",
        source: "MANUAL",
        journalEntryId: "",
        journalEntryNumber: "",
        postingStatus: "NO_CONTABILIZADO",
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString()
      }
    ];
  }

  function createCollectionsSeed(receivables, journalEntries) {
    const quito = receivables.find(item => item.documentNumber === "CXC-001");
    const entry = journalEntries.find(item => item.entryNumber === "ASI-2026-000022");
    return [
      {
        id: uid("COL"),
        collectionNumber: "COB-2026-000001",
        customerId: quito?.customerId || "",
        customerName: quito?.customerName || "",
        customerTaxId: quito?.customerTaxId || "",
        collectionDate: "2026-07-18",
        collectionMethod: "efectivo",
        collectionAccountCode: "1.1.01.01",
        collectionAccountName: "Caja general",
        bankAccountId: "",
        reference: "DEP-FQ-0718",
        observation: "Cobro total individual demo.",
        status: "CONFIRMADO",
        entryId: entry?.id || "",
        entryNumber: entry?.entryNumber || "",
        total: 450,
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString(),
        applications: [
          {
            receivableId: quito?.id || "",
            customerId: quito?.customerId || "",
            customerName: quito?.customerName || "",
            customerTaxId: quito?.customerTaxId || "",
            documentNumber: quito?.documentNumber || "",
            originalBalance: 450,
            retentionApplied: 0,
            advanceApplied: 0,
            amount: 450,
            resultingBalance: 0,
            receivableAccountCode: "1.1.02"
          }
        ]
      }
    ];
  }

  function createCollectionBatchesSeed(receivables, journalEntries) {
    const interflora = receivables.find(item => item.documentNumber === "CXC-003");
    const flowerForceAdjustment = receivables.find(item => item.documentNumber === "AJU-CLI-004");
    const entry = journalEntries.find(item => item.entryNumber === "ASI-2026-000023");
    return [
      {
        id: uid("LCB"),
        batchNumber: "LCB-2026-000002",
        collectionDate: "2026-07-19",
        collectionAccountCode: "1.1.01.02",
        collectionAccountName: "Banco principal",
        bankAccountId: "",
        reference: "LOTE-BORR-COB-001",
        observation: "Lote de cobro demo en borrador.",
        status: "BORRADOR",
        entryId: "",
        entryNumber: "",
        totalDocuments: 1,
        totalToCollect: 300,
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString(),
        applications: [
          {
            receivableId: flowerForceAdjustment?.id || "",
            customerId: flowerForceAdjustment?.customerId || "",
            customerName: flowerForceAdjustment?.customerName || "",
            customerTaxId: flowerForceAdjustment?.customerTaxId || "",
            documentNumber: flowerForceAdjustment?.documentNumber || "",
            originalBalance: 300,
            retentionApplied: 0,
            advanceApplied: 0,
            amount: 300,
            resultingBalance: 0,
            receivableAccountCode: "1.1.02"
          }
        ]
      },
      {
        id: uid("LCB"),
        batchNumber: "LCB-2026-000001",
        collectionDate: "2026-07-20",
        collectionAccountCode: "1.1.01.02",
        collectionAccountName: "Banco principal",
        bankAccountId: "",
        reference: "LOTE-COB-0720",
        observation: "Lote de cobro demo confirmado.",
        status: "CONFIRMADO",
        entryId: entry?.id || "",
        entryNumber: entry?.entryNumber || "",
        totalDocuments: 1,
        totalToCollect: 800,
        createdBy: "James Lanchimba",
        createdAt: new Date().toISOString(),
        applications: [
          {
            receivableId: interflora?.id || "",
            customerId: interflora?.customerId || "",
            customerName: interflora?.customerName || "",
            customerTaxId: interflora?.customerTaxId || "",
            documentNumber: interflora?.documentNumber || "",
            originalBalance: 2300,
            retentionApplied: 0,
            advanceApplied: 0,
            amount: 800,
            resultingBalance: 1500,
            receivableAccountCode: "1.1.02"
          }
        ]
      }
    ];
  }

  function createInventoryWarehousesSeed() {
    return [
      { id: uid("BOD"), code: "BOD-001", name: "Bodega principal", responsible: "Bodega general", status: "activo", observation: "Bodega administrativa principal." },
      { id: uid("BOD"), code: "BOD-002", name: "Bodega empaque", responsible: "Supervisor de empaque", status: "activo", observation: "Cartones, ligas, etiquetas y capuchones." },
      { id: uid("BOD"), code: "BOD-003", name: "Bodega quimicos", responsible: "Encargado agricola", status: "activo", observation: "Quimicos de uso controlado." },
      { id: uid("BOD"), code: "BOD-004", name: "Bodega fertilizantes", responsible: "Encargado agricola", status: "activo", observation: "Fertilizantes y nutrientes." },
      { id: uid("BOD"), code: "BOD-005", name: "Bodega herramientas", responsible: "Mantenimiento", status: "activo", observation: "Herramientas y materiales de soporte." }
    ];
  }

  function createInventoryItemsSeed(warehouses) {
    const empaque = warehouses.find(item => item.code === "BOD-002");
    const quimicos = warehouses.find(item => item.code === "BOD-003");
    const fertilizantes = warehouses.find(item => item.code === "BOD-004");
    const herramientas = warehouses.find(item => item.code === "BOD-005");

    return [
      { id: uid("ITM"), code: "CARTON-HB", barcode: "", name: "Caja HB", category: "MATERIAL_EMPAQUE", subcategory: "carton", unit: "unidad", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", minStock: 150, maxStock: 600, warehouseId: empaque?.id || "", requiresLot: false, requiresExpiry: false, status: "activo", observation: "Caja HB para despacho de flores." },
      { id: uid("ITM"), code: "SEP-HB", barcode: "", name: "Separador HB", category: "MATERIAL_EMPAQUE", subcategory: "separador", unit: "unidad", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", minStock: 120, maxStock: 500, warehouseId: empaque?.id || "", requiresLot: false, requiresExpiry: false, status: "activo", observation: "Separadores para cajas HB." },
      { id: uid("ITM"), code: "LIGA-001", barcode: "", name: "Liga para bonche", category: "MATERIAL_EMPAQUE", subcategory: "liga", unit: "paquete", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", minStock: 30, maxStock: 120, warehouseId: empaque?.id || "", requiresLot: false, requiresExpiry: false, status: "activo", observation: "Liga usada en armado de bonches y empaque." },
      { id: uid("ITM"), code: "CAP-001", barcode: "", name: "Capuchon transparente", category: "MATERIAL_EMPAQUE", subcategory: "capuchon", unit: "paquete", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", minStock: 25, maxStock: 90, warehouseId: empaque?.id || "", requiresLot: false, requiresExpiry: false, status: "activo", observation: "Capuchon para proteccion en empaque." },
      { id: uid("ITM"), code: "ETQ-001", barcode: "", name: "Etiqueta adhesiva", category: "MATERIAL_EMPAQUE", subcategory: "etiqueta", unit: "rollo", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", minStock: 8, maxStock: 40, warehouseId: empaque?.id || "", requiresLot: false, requiresExpiry: false, status: "activo", observation: "Etiquetas de cajas y bultos." },
      { id: uid("ITM"), code: "FERT-001", barcode: "", name: "Fertilizante general", category: "FERTILIZANTE", subcategory: "fertilizante", unit: "kilo", inventoryAccountCode: "1.1.03.01", expenseAccountCode: "6.2", minStock: 50, maxStock: 250, warehouseId: fertilizantes?.id || "", requiresLot: true, requiresExpiry: true, status: "activo", observation: "Fertilizante de uso recurrente." },
      { id: uid("ITM"), code: "QUIM-001", barcode: "", name: "Quimico agricola", category: "QUIMICO", subcategory: "quimico", unit: "litro", inventoryAccountCode: "1.1.03.01", expenseAccountCode: "6.2", minStock: 20, maxStock: 100, warehouseId: quimicos?.id || "", requiresLot: true, requiresExpiry: true, status: "activo", observation: "Quimico de uso agricola controlado." },
      { id: uid("ITM"), code: "HRR-001", barcode: "", name: "Tijera de poda", category: "HERRAMIENTA", subcategory: "herramienta", unit: "unidad", inventoryAccountCode: "1.1.03.01", expenseAccountCode: "6.2", minStock: 5, maxStock: 30, warehouseId: herramientas?.id || "", requiresLot: false, requiresExpiry: false, status: "activo", observation: "Herramienta administrativa / operativa de bodega." }
    ];
  }

  function createInventoryMovementsSeed(items, warehouses, providers, journalEntries) {
    const empaque = warehouses.find(item => item.code === "BOD-002");
    const fertilizantes = warehouses.find(item => item.code === "BOD-004");
    const quimicos = warehouses.find(item => item.code === "BOD-003");
    const carton = items.find(item => item.code === "CARTON-HB");
    const separador = items.find(item => item.code === "SEP-HB");
    const liga = items.find(item => item.code === "LIGA-001");
    const etiqueta = items.find(item => item.code === "ETQ-001");
    const fertilizante = items.find(item => item.code === "FERT-001");
    const quimico = items.find(item => item.code === "QUIM-001");
    const agro = providers.find(item => item.code === "PRV-0001");
    const consumoEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000024");
    const ajusteEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000025");
    const proveedorEntry = journalEntries.find(item => item.entryNumber === "ASI-2026-000026");
    const createdAt = new Date().toISOString();

    return [
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000001",
        movementDate: "2026-07-17",
        movementType: "ENTRADA_COMPRA",
        warehouseFromId: "",
        warehouseFromName: "",
        warehouseToId: empaque?.id || "",
        warehouseToName: empaque?.name || "",
        responsible: "Bodega empaque",
        documentOrigin: "001-002-000000151",
        originModule: "compras",
        status: "CONFIRMADO",
        observation: "Entrada por compra de cajas HB.",
        counterAccountCode: "",
        counterAccountName: "",
        supplierId: "",
        supplierName: "",
        settlementStatus: "",
        journalEntryId: "",
        journalEntryNumber: "",
        costCenter: "",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: carton?.id || "", itemCode: carton?.code || "CARTON-HB", itemName: carton?.name || "Caja HB", description: "Entrada compra cajas HB", quantity: 300, unit: "unidad", costUnit: 1.85, costTotal: 555, lot: "", expiryDate: "", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", costCenter: "", observation: "Compra inicial de cajas HB", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000002",
        movementDate: "2026-07-18",
        movementType: "ENTRADA_COMPRA",
        warehouseFromId: "",
        warehouseFromName: "",
        warehouseToId: empaque?.id || "",
        warehouseToName: empaque?.name || "",
        responsible: "Bodega empaque",
        documentOrigin: "001-002-000000152",
        originModule: "compras",
        status: "CONFIRMADO",
        observation: "Entrada por compra de separadores HB.",
        counterAccountCode: "",
        counterAccountName: "",
        supplierId: "",
        supplierName: "",
        settlementStatus: "",
        journalEntryId: "",
        journalEntryNumber: "",
        costCenter: "",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: separador?.id || "", itemCode: separador?.code || "SEP-HB", itemName: separador?.name || "Separador HB", description: "Entrada compra separadores HB", quantity: 320, unit: "unidad", costUnit: 0.48, costTotal: 153.6, lot: "", expiryDate: "", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", costCenter: "", observation: "Compra inicial de separadores", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000003",
        movementDate: "2026-07-19",
        movementType: "ENTRADA_COMPRA",
        warehouseFromId: "",
        warehouseFromName: "",
        warehouseToId: empaque?.id || "",
        warehouseToName: empaque?.name || "",
        responsible: "Bodega empaque",
        documentOrigin: "COMP-LIGA-001",
        originModule: "compras",
        status: "CONFIRMADO",
        observation: "Entrada de ligas para empaque.",
        counterAccountCode: "",
        counterAccountName: "",
        supplierId: "",
        supplierName: "",
        settlementStatus: "",
        journalEntryId: "",
        journalEntryNumber: "",
        costCenter: "",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: liga?.id || "", itemCode: liga?.code || "LIGA-001", itemName: liga?.name || "Liga para bonche", description: "Entrada de ligas", quantity: 40, unit: "paquete", costUnit: 8.5, costTotal: 340, lot: "", expiryDate: "", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", costCenter: "", observation: "Stock inicial de ligas", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000004",
        movementDate: "2026-07-20",
        movementType: "ENTRADA_COMPRA",
        warehouseFromId: "",
        warehouseFromName: "",
        warehouseToId: empaque?.id || "",
        warehouseToName: empaque?.name || "",
        responsible: "Bodega empaque",
        documentOrigin: "COMP-ETQ-001",
        originModule: "compras",
        status: "CONFIRMADO",
        observation: "Entrada de etiquetas adhesivas.",
        counterAccountCode: "",
        counterAccountName: "",
        supplierId: "",
        supplierName: "",
        settlementStatus: "",
        journalEntryId: "",
        journalEntryNumber: "",
        costCenter: "",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: etiqueta?.id || "", itemCode: etiqueta?.code || "ETQ-001", itemName: etiqueta?.name || "Etiqueta adhesiva", description: "Entrada de etiquetas", quantity: 20, unit: "rollo", costUnit: 12, costTotal: 240, lot: "", expiryDate: "", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", costCenter: "", observation: "Stock inicial de etiquetas", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000005",
        movementDate: "2026-07-21",
        movementType: "ENTRADA_COMPRA",
        warehouseFromId: "",
        warehouseFromName: "",
        warehouseToId: fertilizantes?.id || "",
        warehouseToName: fertilizantes?.name || "",
        responsible: "Bodega agricola",
        documentOrigin: "001-002-000000150",
        originModule: "compras",
        status: "CONFIRMADO",
        observation: "Entrada compra de fertilizante general.",
        counterAccountCode: "",
        counterAccountName: "",
        supplierId: agro?.id || "",
        supplierName: agro?.name || "",
        settlementStatus: "",
        journalEntryId: "",
        journalEntryNumber: "",
        costCenter: "",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: fertilizante?.id || "", itemCode: fertilizante?.code || "FERT-001", itemName: fertilizante?.name || "Fertilizante general", description: "Entrada compra fertilizante", quantity: 80, unit: "kilo", costUnit: 4.2, costTotal: 336, lot: "FERT-0726-A", expiryDate: "2026-07-28", inventoryAccountCode: "1.1.03.01", expenseAccountCode: "6.2", costCenter: "", observation: "Lote proximo a vencer para demo", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000009",
        movementDate: "2026-07-21",
        movementType: "ENTRADA_COMPRA",
        warehouseFromId: "",
        warehouseFromName: "",
        warehouseToId: quimicos?.id || "",
        warehouseToName: quimicos?.name || "",
        responsible: "Bodega agricola",
        documentOrigin: "COMP-QUIM-001",
        originModule: "compras",
        status: "CONFIRMADO",
        observation: "Entrada de quimico agricola para control de lote.",
        counterAccountCode: "",
        counterAccountName: "",
        supplierId: agro?.id || "",
        supplierName: agro?.name || "",
        settlementStatus: "",
        journalEntryId: "",
        journalEntryNumber: "",
        costCenter: "",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: quimico?.id || "", itemCode: quimico?.code || "QUIM-001", itemName: quimico?.name || "Quimico agricola", description: "Entrada quimico agricola", quantity: 25, unit: "litro", costUnit: 6.4, costTotal: 160, lot: "QUI-0726-A", expiryDate: "2026-08-05", inventoryAccountCode: "1.1.03.01", expenseAccountCode: "6.2", costCenter: "", observation: "Lote demo de quimico", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000006",
        movementDate: "2026-07-22",
        movementType: "SALIDA_EMPAQUE",
        warehouseFromId: empaque?.id || "",
        warehouseFromName: empaque?.name || "",
        warehouseToId: "",
        warehouseToName: "",
        responsible: "Supervisor empaque",
        documentOrigin: "CONS-EMP-0722",
        originModule: "consumo",
        status: "CONFIRMADO",
        observation: "Consumo de ligas a empaque.",
        counterAccountCode: "",
        counterAccountName: "",
        supplierId: "",
        supplierName: "",
        settlementStatus: "",
        journalEntryId: consumoEntry?.id || "",
        journalEntryNumber: consumoEntry?.entryNumber || "",
        costCenter: "EMPAQUE",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: liga?.id || "", itemCode: liga?.code || "LIGA-001", itemName: liga?.name || "Liga para bonche", description: "Consumo ligas empaque", quantity: 12, unit: "paquete", costUnit: 8.5, costTotal: 102, lot: "", expiryDate: "", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "5.2", costCenter: "EMPAQUE", observation: "Consumo de ligas", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000007",
        movementDate: "2026-07-23",
        movementType: "AJUSTE_NEGATIVO",
        warehouseFromId: empaque?.id || "",
        warehouseFromName: empaque?.name || "",
        warehouseToId: "",
        warehouseToName: "",
        responsible: "Bodega principal",
        documentOrigin: "AJU-ETQ-0723",
        originModule: "ajuste",
        status: "CONFIRMADO",
        observation: "Ajuste negativo por perdida de etiquetas.",
        counterAccountCode: "6.2",
        counterAccountName: "Gastos de suministros",
        supplierId: "",
        supplierName: "",
        settlementStatus: "",
        journalEntryId: ajusteEntry?.id || "",
        journalEntryNumber: ajusteEntry?.entryNumber || "",
        costCenter: "BODEGA",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: etiqueta?.id || "", itemCode: etiqueta?.code || "ETQ-001", itemName: etiqueta?.name || "Etiqueta adhesiva", description: "Perdida de etiquetas adhesivas", quantity: 3, unit: "rollo", costUnit: 12, costTotal: 36, lot: "", expiryDate: "", inventoryAccountCode: "1.1.03.02", expenseAccountCode: "6.2", costCenter: "BODEGA", observation: "Ajuste por merma", sourcePurchaseId: "", sourceLineId: "" }
        ]
      },
      {
        id: uid("MOV"),
        movementNumber: "INV-2026-000008",
        movementDate: "2026-07-24",
        movementType: "SALIDA_PROVEEDOR",
        warehouseFromId: fertilizantes?.id || "",
        warehouseFromName: fertilizantes?.name || "",
        warehouseToId: "",
        warehouseToName: "",
        responsible: "Encargado agricola",
        documentOrigin: "SAL-PRV-0724",
        originModule: "consumo",
        status: "CONFIRMADO",
        observation: "Entrega de fertilizante a proveedor pendiente de descontar.",
        counterAccountCode: "1.1.04",
        counterAccountName: "Anticipos a proveedores",
        supplierId: agro?.id || "",
        supplierName: agro?.name || "",
        settlementStatus: "pendiente de descontar",
        journalEntryId: proveedorEntry?.id || "",
        journalEntryNumber: proveedorEntry?.entryNumber || "",
        costCenter: "",
        createdAt,
        createdBy: "James Lanchimba",
        confirmedAt: createdAt,
        lines: [
          { id: uid("MVL"), itemId: fertilizante?.id || "", itemCode: fertilizante?.code || "FERT-001", itemName: fertilizante?.name || "Fertilizante general", description: "Salida de fertilizante a proveedor", quantity: 15, unit: "kilo", costUnit: 4.2, costTotal: 63, lot: "FERT-0726-A", expiryDate: "2026-07-28", inventoryAccountCode: "1.1.03.01", expenseAccountCode: "6.2", costCenter: "", observation: "Pendiente de descuento en proveedor", sourcePurchaseId: "", sourceLineId: "" }
        ]
      }
    ];
  }

  function createVisualUsersSeed() {
    return [
      { id: "USR-ADMIN-001", code: "USR-001", name: "James Lanchimba", fullName: "James Santiago Lanchimba Tipanluisa", email: "", role: "Administrador / Contador", cargo: "Administrador / Contador", area: "Administracion / Contabilidad", status: "activo", observation: "Usuario visual principal para pruebas de auditoria." },
      { id: "USR-SUP-002", code: "USR-002", name: "Eder Lenin Quishpe", fullName: "Eder Lenin Quishpe", email: "", role: "Co-creador / Soporte", cargo: "Co-creador / Soporte", area: "Tecnologia / Soporte", status: "activo", observation: "Usuario visual de soporte funcional." },
      { id: "USR-ACC-003", code: "USR-003", name: "Usuario Contable", fullName: "Usuario Contable", email: "", role: "Asistente contable", cargo: "Asistente contable", area: "Contabilidad", status: "activo", observation: "Perfil visual para pruebas de registros contables." },
      { id: "USR-WHS-004", code: "USR-004", name: "Usuario Bodega", fullName: "Usuario Bodega", email: "", role: "Responsable bodega", cargo: "Responsable bodega", area: "Bodega", status: "activo", observation: "Perfil visual para inventario y movimientos de bodega." }
    ];
  }

  function createDocumentSequencesSeed() {
    return [
      { id: "SEQ-ASI", code: "ASI", name: "Asientos contables", prefix: "ASI", year: "2026", month: "", currentNumber: 25, length: 6, reset: "anual", module: "Contabilidad", status: "activo", observation: "Secuencial interno del libro diario." },
      { id: "SEQ-COM", code: "COM", name: "Compras", prefix: "COM", year: "2026", month: "", currentNumber: 3, length: 6, reset: "anual", module: "Compras", status: "activo", observation: "Control interno para documentos de compra." },
      { id: "SEQ-RETE", code: "RETE", name: "Retenciones emitidas", prefix: "RETE", year: "2026", month: "", currentNumber: 1, length: 6, reset: "anual", module: "Compras", status: "activo", observation: "Borradores y confirmaciones de retenciones emitidas." },
      { id: "SEQ-RETR", code: "RETR", name: "Retenciones recibidas", prefix: "RETR", year: "2026", month: "", currentNumber: 2, length: 6, reset: "anual", module: "Tributario", status: "activo", observation: "Importaciones XML de retenciones recibidas." },
      { id: "SEQ-PAGO", code: "PAGO", name: "Pagos", prefix: "PAGO", year: "2026", month: "", currentNumber: 2, length: 6, reset: "anual", module: "Carteras", status: "activo", observation: "Pagos individuales y lotes." },
      { id: "SEQ-COBRO", code: "COBRO", name: "Cobros", prefix: "COBRO", year: "2026", month: "", currentNumber: 2, length: 6, reset: "anual", module: "Carteras", status: "activo", observation: "Cobros individuales y lotes." },
      { id: "SEQ-BAN", code: "BAN", name: "Movimientos bancarios", prefix: "BAN", year: "2026", month: "", currentNumber: 3, length: 6, reset: "anual", module: "Bancos", status: "activo", observation: "Movimientos auxiliares de bancos y caja." },
      { id: "SEQ-CONC", code: "CONC", name: "Conciliaciones bancarias", prefix: "CONC", year: "2026", month: "", currentNumber: 1, length: 6, reset: "mensual", module: "Bancos", status: "activo", observation: "Cierres de conciliacion por cuenta y periodo." },
      { id: "SEQ-INV", code: "INV", name: "Movimientos de inventario", prefix: "INV", year: "2026", month: "", currentNumber: 8, length: 6, reset: "anual", module: "Inventario", status: "activo", observation: "Entradas y salidas generales de inventario." },
      { id: "SEQ-CONS", code: "CONS", name: "Consumos de inventario", prefix: "CONS", year: "2026", month: "", currentNumber: 1, length: 6, reset: "anual", module: "Inventario", status: "activo", observation: "Consumos al gasto o costo." },
      { id: "SEQ-AJU", code: "AJU", name: "Ajustes de inventario", prefix: "AJU", year: "2026", month: "", currentNumber: 1, length: 6, reset: "anual", module: "Inventario", status: "activo", observation: "Ajustes positivos y negativos." },
      { id: "SEQ-ATS", code: "ATS", name: "Generaciones ATS", prefix: "ATS", year: "2026", month: "", currentNumber: 1, length: 6, reset: "mensual", module: "Tributario", status: "activo", observation: "XML preliminar y revisiones ATS." }
    ];
  }

  function createCostCentersSeed() {
    return [
      { id: "CC-ADMINISTRACION", code: "ADMINISTRACION", name: "Administracion", type: "administrativo", responsible: "James Lanchimba", status: "activo", relatedAccount: "6.1", observation: "Centro administrativo general." },
      { id: "CC-CAMPO", code: "CAMPO", name: "Campo", type: "produccion", responsible: "Responsable de campo", status: "activo", relatedAccount: "5.1", observation: "Base operativa de campo." },
      { id: "CC-POSCOSECHA", code: "POSCOSECHA", name: "Poscosecha", type: "produccion", responsible: "Responsable poscosecha", status: "activo", relatedAccount: "5.1", observation: "Preparado para integracion futura con Parte 1." },
      { id: "CC-EMPAQUE", code: "EMPAQUE", name: "Empaque", type: "empaque", responsible: "Responsable de empaque", status: "activo", relatedAccount: "5.2", observation: "Consumos y costos de materiales de empaque." },
      { id: "CC-BODEGA", code: "BODEGA", name: "Bodega", type: "operativo", responsible: "Usuario Bodega", status: "activo", relatedAccount: "1.1.03.02", observation: "Control operativo de suministros y materiales." },
      { id: "CC-VENTAS", code: "VENTAS", name: "Ventas", type: "ventas", responsible: "Equipo comercial", status: "activo", relatedAccount: "4.1", observation: "Reservado para la fase comercial futura." },
      { id: "CC-LOGISTICA", code: "LOGISTICA", name: "Logistica", type: "logistica", responsible: "Coordinacion logistica", status: "activo", relatedAccount: "6.1", observation: "Apoyo a operaciones de despacho y transporte." },
      { id: "CC-MANTENIMIENTO", code: "MANTENIMIENTO", name: "Mantenimiento", type: "operativo", responsible: "Responsable de mantenimiento", status: "activo", relatedAccount: "6.2", observation: "Consumos y gastos por mantenimiento." },
      { id: "CC-GERENCIA", code: "GERENCIA", name: "Gerencia", type: "administrativo", responsible: "Gerencia general", status: "activo", relatedAccount: "6.1", observation: "Centro de decisiones y direccion." }
    ];
  }

  function createAuditLogsSeed() {
    return [
      { id: "AUD-DEMO-001", createdAt: "2026-07-24T09:15:00.000Z", userId: "USR-ADMIN-001", userName: "James Lanchimba", userEmail: "", userRole: "Administrador / Contador", userArea: "Administracion / Contabilidad", module: "COMPRAS", action: "CONTABILIZAR_COMPRA", entityType: "purchase", entityId: "PUR-DEMO-001", entityLabel: "001-001-000000123", documentLabel: "Compra Agroinsumos del Ecuador", previousStatus: "PENDIENTE_CLASIFICACION", nextStatus: "PENDIENTE_RETENCION", description: "Compra contabilizada y enviada a cuenta por pagar.", reason: "", result: "exitoso", ipDevice: "local / navegador", before: { status: "PENDIENTE_CLASIFICACION" }, after: { status: "PENDIENTE_RETENCION" } },
      { id: "AUD-DEMO-002", createdAt: "2026-07-24T10:30:00.000Z", userId: "USR-WHS-004", userName: "Usuario Bodega", userEmail: "", userRole: "Responsable bodega", userArea: "Bodega", module: "INVENTARIO", action: "CONFIRMAR_MOVIMIENTO", entityType: "inventory_movement", entityId: "MOV-DEMO-001", entityLabel: "INV-2026-000006", documentLabel: "Consumo ligas empaque", previousStatus: "BORRADOR", nextStatus: "CONFIRMADO", description: "Movimiento de consumo confirmado con impacto en stock y asiento.", reason: "", result: "exitoso", ipDevice: "local / navegador", before: { status: "BORRADOR" }, after: { status: "CONFIRMADO" } },
      { id: "AUD-DEMO-003", createdAt: "2026-07-24T11:05:00.000Z", userId: "USR-ACC-003", userName: "Usuario Contable", userEmail: "", userRole: "Asistente contable", userArea: "Contabilidad", module: "BANCOS", action: "CERRAR_CONCILIACION", entityType: "bank_reconciliation", entityId: "REC-DEMO-001", entityLabel: "CONC-2026-000001", documentLabel: "Conciliacion Banco Pichincha Junio 2026", previousStatus: "EN_REVISION", nextStatus: "CERRADA", description: "Conciliacion cerrada con diferencia en cero.", reason: "", result: "exitoso", ipDevice: "local / navegador", before: { status: "EN_REVISION" }, after: { status: "CERRADA" } },
      { id: "AUD-DEMO-004", createdAt: "2026-07-24T12:45:00.000Z", userId: "USR-ADMIN-001", userName: "James Lanchimba", userEmail: "", userRole: "Administrador / Contador", userArea: "Administracion / Contabilidad", module: "ATS", action: "GENERAR_ATS_PRELIMINAR", entityType: "ats_generation", entityId: "ATS-DEMO-001", entityLabel: "ATS-2026-000001", documentLabel: "ATS Junio 2026", previousStatus: "PREPARADO", nextStatus: "CON_ERRORES", description: "Validacion preliminar ATS detecto un error critico y una advertencia.", reason: "", result: "bloqueado", ipDevice: "local / navegador", before: { status: "PREPARADO" }, after: { status: "CON_ERRORES" } }
    ];
  }

  function createDemoDatabase() {
    const providers = createProvidersSeed();
    const purchaseMemory = createPurchaseMemorySeed(providers);
    const journalEntries = createJournalEntriesSeed();
    const purchases = createPurchasesSeed(providers, purchaseMemory, journalEntries);
    const payments = createPaymentsSeed(purchases, journalEntries);
    const paymentBatches = createPaymentBatchesSeed(purchases, journalEntries);
    const bankAccounts = createBankAccountsSeed();
    const bankMovements = createBankMovementsSeed(bankAccounts, journalEntries);
    const bankStatementMovements = createBankStatementMovementsSeed(bankAccounts);
    const bankReconciliations = createBankReconciliationsSeed(bankAccounts, bankMovements, bankStatementMovements);
    const customers = createCustomersSeed();
    const customerReceivables = createCustomerReceivablesSeed(customers, journalEntries);
    const collections = createCollectionsSeed(customerReceivables, journalEntries);
    const collectionBatches = createCollectionBatchesSeed(customerReceivables, journalEntries);
    const receivedWithholdings = createReceivedWithholdingsSeed(customers, customerReceivables);
    const inventoryWarehouses = createInventoryWarehousesSeed();
    const inventoryItems = createInventoryItemsSeed(inventoryWarehouses);
    const inventoryMovements = createInventoryMovementsSeed(inventoryItems, inventoryWarehouses, providers, journalEntries);
    const visualUsers = createVisualUsersSeed();
    const documentSequences = createDocumentSequencesSeed();
    const costCenters = createCostCentersSeed();
    const auditLogs = createAuditLogsSeed();

    return {
      meta: {
        companyName: "Bless Flower / Proyecto ERP JAMES",
        accountingPeriod: "Julio 2026",
        mode: "demo",
        createdAt: new Date().toISOString(),
        version: "v2"
      },
      session: {
        activeUser: {
          id: "USR-ADMIN-001",
          name: "James Lanchimba",
          role: "Administrador / Contador",
          cargo: "Administrador / Contador",
          area: "Administracion / Contabilidad",
          email: ""
        },
        alerts: [
          "8 compras pendientes de revision",
          "3 bancos por conciliar",
          "2 obligaciones tributarias proximas"
        ]
      },
      companySettings: createCompanySettings(),
      chartOfAccounts: createChartOfAccountsSeed(),
      journalEntries,
      providers,
      taxParameters: createTaxParametersSeed(),
      retentionParameters: createRetentionParametersSeed(),
      taxSupports: createTaxSupportsSeed(),
      purchaseTypes: createPurchaseTypesSeed(),
      purchaseMemory,
      visualUsers,
      documentSequences,
      costCenters,
      auditLogs,
      purchases,
      purchasePayables: createPayablesSeed(purchases),
      issuedWithholdings: createIssuedWithholdingsSeed(purchases),
      payments,
      paymentBatches,
      bankAccounts,
      bankMovements,
      bankStatementMovements,
      bankReconciliations,
      customers,
      customerReceivables,
      collections,
      collectionBatches,
      receivedWithholdings,
      inventoryWarehouses,
      inventoryItems,
      inventoryMovements,
      sales: [
        {
          id: uid("SAL"),
          document: "FAC-001-001-000000121",
          date: today(),
          client: "Roses Trading BV",
          country: "Netherlands",
          status: "Autorizado",
          sriStatus: "AUTORIZADO",
          logisticsStatus: "Sin guia",
          total: 1840,
          notes: "Pedido exportacion semana 26",
          lines: [
            { id: uid("LIN"), product: "Freedom", quantity: 120, price: 6.5, total: 780 },
            { id: uid("LIN"), product: "Explorer", quantity: 140, price: 7.57, total: 1060 }
          ]
        },
        {
          id: uid("SAL"),
          document: "FAC-001-001-000000122",
          date: today(),
          client: "Bloom Fresh Miami",
          country: "United States",
          status: "Pendiente",
          sriStatus: "BORRADOR",
          logisticsStatus: "Lista de empaque generada",
          total: 940,
          notes: "Venta local exterior demo",
          lines: [
            { id: uid("LIN"), product: "Vendela", quantity: 80, price: 5.25, total: 420 },
            { id: uid("LIN"), product: "Pink Mondial", quantity: 100, price: 5.2, total: 520 }
          ]
        },
        {
          id: uid("SAL"),
          document: "FAC-001-001-000000123",
          date: today(),
          client: "Flora Madrid",
          country: "Spain",
          status: "Parcial",
          sriStatus: "AUTORIZADO",
          logisticsStatus: "Guia generada",
          total: 1280,
          notes: "Cliente con saldo parcial",
          lines: [
            { id: uid("LIN"), product: "Tibet", quantity: 160, price: 8, total: 1280 }
          ]
        }
      ]
    };
  }

  BlessERP.demo = { createDemoDatabase };
})();
