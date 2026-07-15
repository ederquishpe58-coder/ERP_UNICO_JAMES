(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const moduleFlagReaders = {
    core: () => Boolean(BlessERP.isCoreSupabaseEnabled?.()),
    commercialCatalogs: () => Boolean(BlessERP.isCommercialCatalogsSupabaseEnabled?.()),
    commercialOrders: () => Boolean(BlessERP.isCommercialOrdersSupabaseEnabled?.()),
    operations: () => Boolean(BlessERP.isOperationsSupabaseEnabled?.()),
    scanner: () => Boolean(BlessERP.isScannerSupabaseEnabled?.()),
    materialInventory: () => Boolean(BlessERP.isMaterialInventorySupabaseEnabled?.()),
    accounting: () => Boolean(BlessERP.isAccountingSupabaseEnabled?.()),
    sri: () => Boolean(BlessERP.isSriSupabaseEnabled?.())
  };

  function getDisabledSupabaseReason(moduleName) {
    const normalizedName = String(moduleName || "").trim();
    const status = BlessERP.getSupabaseStatus ? BlessERP.getSupabaseStatus() : null;
    const isConfigured = BlessERP.isSupabaseConfigured ? BlessERP.isSupabaseConfigured() : false;
    const flagReader = moduleFlagReaders[normalizedName];

    if (!status || !status.enabled) {
      return "Supabase global desactivado. Usando modo local/demo.";
    }
    if (!isConfigured) {
      return "Cliente Supabase no configurado. Usando modo local/demo.";
    }
    if (!flagReader) {
      return "Modulo Supabase no soportado por el guard actual.";
    }
    if (!flagReader()) {
      return "Feature flag del modulo desactivada. Usando modo local/demo.";
    }
    return "Modulo habilitado para una futura transicion controlada.";
  }

  function canUseSupabaseModule(moduleName) {
    const normalizedName = String(moduleName || "").trim();
    const flagReader = moduleFlagReaders[normalizedName];
    const status = BlessERP.getSupabaseStatus ? BlessERP.getSupabaseStatus() : null;
    const isConfigured = BlessERP.isSupabaseConfigured ? BlessERP.isSupabaseConfigured() : false;
    const enabled = Boolean(status?.enabled && isConfigured && flagReader && flagReader());

    return {
      enabled,
      moduleName: normalizedName,
      reason: enabled
        ? "Modulo listo para evaluacion futura con Supabase."
        : getDisabledSupabaseReason(normalizedName)
    };
  }

  function getSupabaseModuleFlagsReport() {
    const moduleNames = Object.keys(moduleFlagReaders);
    return {
      supabaseGlobalEnabled: Boolean(BlessERP.isSupabaseEnabled?.()),
      configured: Boolean(BlessERP.isSupabaseConfigured?.()),
      modules: moduleNames.map(moduleName => canUseSupabaseModule(moduleName))
    };
  }

  BlessERP.canUseSupabaseModule = canUseSupabaseModule;
  BlessERP.getDisabledSupabaseReason = getDisabledSupabaseReason;
  BlessERP.getSupabaseModuleFlagsReport = getSupabaseModuleFlagsReport;
})();
