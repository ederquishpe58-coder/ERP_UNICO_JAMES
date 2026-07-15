(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;

  const accountFields = [
    { key: "cashGeneral", label: "Caja general" },
    { key: "mainBank", label: "Banco principal" },
    { key: "accountsReceivableCustomers", label: "Cuentas por cobrar clientes" },
    { key: "accountsPayableSuppliers", label: "Cuentas por pagar proveedores" },
    { key: "vatPurchases", label: "IVA compras" },
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
    { key: "customerAdvances", label: "Anticipos de clientes" }
  ];

  function settings() {
    return BlessERP.utils.clone(stateApi.state.db.companySettings || {});
  }

  function save(nextSettings) {
    stateApi.state.db.companySettings = BlessERP.utils.clone(nextSettings);
    stateApi.state.db.meta.companyName = nextSettings.commercialName || nextSettings.legalName || stateApi.state.db.meta.companyName;
    stateApi.state.db.meta.accountingPeriod = nextSettings.periodLabel || nextSettings.activePeriod || stateApi.state.db.meta.accountingPeriod;
    stateApi.saveDb();
    return settings();
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
