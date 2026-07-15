(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  BlessERP.repositoryModules = BlessERP.repositoryModules || { core: {} };
  BlessERP.repositoryModules.core = BlessERP.repositoryModules.core || {};

  const repository = BlessERP.createRepositoryBase("app_menu_items");

  repository.listMenuTree = function() {
    return repository.list();
  };

  BlessERP.repositoryModules.core.menu = repository;
  BlessERP.getMenuRepository = function() {
    return repository;
  };

  BlessERP.menuService?.configureMenuDataProvider(async function() {
    const result = repository.listMenuTree();
    return result?.ok && Array.isArray(result.data)
      ? { records: result.data, source: "SUPABASE" }
      : { records: [], source: "LOCAL_CONFIG" };
  });
})();
