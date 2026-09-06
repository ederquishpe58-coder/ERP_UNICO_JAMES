(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;

  const accountFields = [
    { key: "cashGeneral", label: "Caja general" },
    { key: "mainBank", label: "Banco principal" },
    { key: "accountsReceivableCustomers", label: "Cuentas por cobrar clientes" },
    { key: "accountsReceivableCustomersExport", label: "Cuentas por cobrar clientes del exterior" },
    { key: "accountsReceivableCustomersLocal", label: "Cuentas por cobrar clientes locales" },
    { key: "accountsPayableSuppliers", label: "Cuentas por pagar proveedores" },
    { key: "vatPurchases", label: "IVA compras" },
    { key: "vatPurchases15", label: "IVA compras 15%" },
    { key: "vatPurchases8", label: "IVA compras 8%" },
    { key: "vatPurchases5", label: "IVA compras 5%" },
    { key: "vatSales", label: "IVA ventas" },
    { key: "incomeTaxWithholdingPayable", label: "Retenciones fuente por pagar" },
    { key: "vatWithholdingPayable", label: "Retenciones IVA por pagar" },
    { key: "withholdingReceivable", label: "Retenciones recibidas por cobrar" },
    { key: "suppliesInventory", label: "Inventario de suministros" },
    { key: "packagingInventory", label: "Inventario materiales de empaque" },
    { key: "suppliesExpenseCost", label: "Gasto/costo de suministros" },
    { key: "packagingCost", label: "Costo materiales de empaque" },
    { key: "localSales", label: "Ventas locales" },
    { key: "exportSales", label: "Ventas exportacion" },
    { key: "supplierAdvances", label: "Anticipos a proveedores" },
    { key: "customerAdvances", label: "Anticipos de clientes" },
    { key: "payrollSalaries", label: "Rol: sueldos y salarios" },
    { key: "payrollPiecework", label: "Rol: trabajo por destajo" },
    { key: "payrollCommissions", label: "Rol: comisiones" },
    { key: "payrollBonuses", label: "Rol: bonificaciones" },
    { key: "payrollTransport", label: "Rol: pasajes" },
    { key: "payrollOvertime", label: "Rol: horas adicionales" },
    { key: "payrollOtherIncome", label: "Rol: otros ingresos" },
    { key: "payrollPayable", label: "Rol: remuneraciones por pagar" },
    { key: "employeeAdvances", label: "Rol: anticipos a empleados" },
    { key: "payrollFoodRecovery", label: "Rol: descuento de alimentación" },
    { key: "payrollFinesRecovery", label: "Rol: multas e infracciones" },
    { key: "payrollOtherDiscounts", label: "Rol: otros descuentos" }
  ];

  function settings() {
    return BlessERP.services?.companyContext?.companySettings?.()
      || BlessERP.utils.clone(stateApi.state.db.companySettings || {});
  }

  async function save(nextSettings) {
    const ack = await BlessERP.services.confirmedOperationalWrite.commit('company_settings', nextSettings);
    if (!ack.ok) return ack;
    const saved = BlessERP.utils.clone(ack.serverRecord.payload);
    const db = stateApi.state.db;
    const id = BlessERP.services.companyContext.activeCompanyId();
    if (db.companyStores?.[id]) db.companyStores[id].companySettings = saved;
    db.meta.companyName = saved.commercialName || saved.legalName || db.meta.companyName;
    db.meta.accountingPeriod = saved.periodLabel || saved.activePeriod || db.meta.accountingPeriod;
    stateApi.saveDb({ remote: true, captureIncremental: false, skipCloudSnapshot: true });
    return { ...ack, settings: saved };
  }

  function missingDefaultAccounts(currentSettings = settings()) {
    const defaults = currentSettings.defaultAccounts || {};
    return accountFields.filter(field => !String(defaults[field.key] || "").trim());
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.companySettings = {
    accountFields,
    settings,
    save,
    missingDefaultAccounts
  };
})();
