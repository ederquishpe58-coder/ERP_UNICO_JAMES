(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const modules = BlessERP.repositoryModules || {
    core: {},
    comercial: {},
    operaciones: {},
    inventarioMateriales: {},
    contabilidad: {}
  };

  const repositoryRegistry = {
    core: modules.core || {},
    comercial: modules.comercial || {},
    operaciones: modules.operaciones || {},
    inventarioMateriales: modules.inventarioMateriales || {},
    contabilidad: modules.contabilidad || {}
  };

  function countRepositories(group) {
    return Object.keys(group || {}).length;
  }

  function getRepositoryRegistryStatus() {
    const repositoriesByModule = {
      core: countRepositories(repositoryRegistry.core),
      comercial: countRepositories(repositoryRegistry.comercial),
      operaciones: countRepositories(repositoryRegistry.operaciones),
      inventarioMateriales: countRepositories(repositoryRegistry.inventarioMateriales),
      contabilidad: countRepositories(repositoryRegistry.contabilidad)
    };

    return {
      mode: BlessERP.getRepositoryMode ? BlessERP.getRepositoryMode() : "LOCAL_DEMO",
      supabaseEnabled: BlessERP.isSupabaseEnabled ? BlessERP.isSupabaseEnabled() : false,
      totalRepositories: Object.values(repositoriesByModule).reduce((total, value) => total + value, 0),
      repositoriesByModule,
      message: "Repositorios preparados. Supabase desactivado. Servicios demo/locales siguen activos."
    };
  }

  BlessERP.repositoryRegistry = repositoryRegistry;
  BlessERP.getRepositoryRegistryStatus = getRepositoryRegistryStatus;
})();
