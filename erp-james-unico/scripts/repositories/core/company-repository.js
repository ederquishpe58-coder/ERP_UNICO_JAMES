(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  BlessERP.repositoryModules = BlessERP.repositoryModules || {
    core: {},
    comercial: {},
    operaciones: {},
    inventarioMateriales: {},
    contabilidad: {}
  };

  function createFallbackRepository(entityName) {
    return {
      entity: entityName,
      list() {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      getById(id) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, id, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      create(payload) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, payload, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      update(id, payload) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, id, payload, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      remove(id) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, id, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      }
    };
  }

  const repository = BlessERP.createRepositoryBase
    ? BlessERP.createRepositoryBase("companies")
    : createFallbackRepository("companies");

  BlessERP.repositoryModules.core.company = repository;
  BlessERP.getCompanyRepository = function() {
    return repository;
  };
})();
