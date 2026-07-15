(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function getRepositoriesByModule() {
    const registry = BlessERP.repositoryRegistry || {
      core: {},
      comercial: {},
      operaciones: {},
      inventarioMateriales: {},
      contabilidad: {}
    };

    return {
      core: {
        repositoriesPrepared: Object.keys(registry.core || {}).length > 0,
        activeDataSource: "local/demo",
        supabaseSource: "disabled",
        total: Object.keys(registry.core || {}).length
      },
      comercial: {
        repositoriesPrepared: Object.keys(registry.comercial || {}).length > 0,
        activeDataSource: "demo/local",
        supabaseSource: "disabled",
        total: Object.keys(registry.comercial || {}).length
      },
      operaciones: {
        repositoriesPrepared: Object.keys(registry.operaciones || {}).length > 0,
        activeDataSource: "demo/local",
        supabaseSource: "disabled",
        total: Object.keys(registry.operaciones || {}).length
      },
      inventarioMateriales: {
        repositoriesPrepared: Object.keys(registry.inventarioMateriales || {}).length > 0,
        activeDataSource: "local/demo",
        supabaseSource: "disabled",
        total: Object.keys(registry.inventarioMateriales || {}).length
      },
      contabilidad: {
        repositoriesPrepared: Object.keys(registry.contabilidad || {}).length > 0,
        activeDataSource: "local/demo",
        supabaseSource: "disabled",
        total: Object.keys(registry.contabilidad || {}).length
      }
    };
  }

  function getRepositoriesStatus() {
    return {
      mode: BlessERP.getRepositoryMode ? BlessERP.getRepositoryMode() : "LOCAL_DEMO",
      supabaseEnabled: BlessERP.isSupabaseEnabled ? BlessERP.isSupabaseEnabled() : false,
      modules: getRepositoriesByModule(),
      message: "Repositorios preparados. Supabase desactivado. Servicios demo/locales siguen activos."
    };
  }

  function getMigrationReadinessByModule() {
    const modules = getRepositoriesByModule();
    const moduleMap = {
      core: "core",
      commercialCatalogs: "comercial",
      commercialOrders: "comercial",
      operations: "operaciones",
      scanner: "operaciones",
      materialInventory: "inventarioMateriales",
      accounting: "contabilidad",
      sri: "comercial"
    };

    return Object.entries(moduleMap).reduce((report, [flagName, repositoryModuleName]) => {
      const moduleStatus = modules[repositoryModuleName];
      const featureFlagStatus = BlessERP.canUseSupabaseModule
        ? BlessERP.canUseSupabaseModule(flagName)
        : { enabled: false, reason: "Feature flag guard no disponible." };

      report[flagName] = {
        repositoryPrepared: Boolean(moduleStatus?.repositoriesPrepared),
        featureFlag: Boolean(BlessERP.getFeatureFlagsStatus?.()?.[flagName]),
        supabaseGlobalEnabled: Boolean(BlessERP.isSupabaseEnabled?.()),
        canUseSupabase: Boolean(featureFlagStatus.enabled),
        activeSource: featureFlagStatus.enabled ? "FUTURE_SUPABASE" : "LOCAL_DEMO",
        reason: featureFlagStatus.reason
      };
      return report;
    }, {});
  }

  function getFeatureFlagsReadinessReport() {
    const migration = getMigrationReadinessByModule();
    return {
      supabaseGlobalEnabled: Boolean(BlessERP.isSupabaseEnabled?.()),
      servicesRemainLocalDemo: true,
      modules: migration,
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
    };
  }

  function getRepositoryReadinessReport() {
    const status = getRepositoriesStatus();
    return {
      ...status,
      lines: [
        "Core repositorios: preparados",
        "Comercial repositorios: preparados",
        "Operaciones repositorios: preparados",
        "Inventario materiales repositorios: preparados",
        "Contabilidad repositorios: preparados",
        "Fuente activa actual: local/demo",
        "Supabase: desactivado",
        "Reemplazo de servicios demo: no realizado",
        "Migracion progresiva: pendiente"
      ]
    };
  }

  BlessERP.getRepositoriesByModule = getRepositoriesByModule;
  BlessERP.getRepositoriesStatus = getRepositoriesStatus;
  BlessERP.getMigrationReadinessByModule = getMigrationReadinessByModule;
  BlessERP.getFeatureFlagsReadinessReport = getFeatureFlagsReadinessReport;
  BlessERP.getRepositoryReadinessReport = getRepositoryReadinessReport;
})();
