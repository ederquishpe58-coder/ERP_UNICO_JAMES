(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function getRepositoryMode() {
    const status = BlessERP.getSupabaseStatus?.();
    if (!status || !status.enabled || !status.configured) return "LOCAL_DEMO";
    return "SUPABASE_PENDING_BINDING";
  }

  function assertRepositoryReady() {
    const mode = getRepositoryMode();
    if (mode !== "SUPABASE_PENDING_BINDING") {
      return {
        ok: false,
        mode,
        message: "Repositorio Supabase pendiente. Usar servicios demo/locales."
      };
    }
    return {
      ok: true,
      mode,
      message: "Repositorio base preparado para una futura conexion Supabase."
    };
  }

  function placeholderResult(entityName) {
    return {
      ok: false,
      mode: getRepositoryMode(),
      entity: entityName,
      message: "Repositorio Supabase pendiente. Usar servicios demo/locales."
    };
  }

  function createRepositoryBase(entityName) {
    return {
      entity: entityName,
      list() {
        return placeholderResult(entityName);
      },
      getById(id) {
        return {
          ...placeholderResult(entityName),
          id
        };
      },
      create(payload) {
        return {
          ...placeholderResult(entityName),
          payload
        };
      },
      update(id, payload) {
        return {
          ...placeholderResult(entityName),
          id,
          payload
        };
      },
      remove(id) {
        return {
          ...placeholderResult(entityName),
          id
        };
      }
    };
  }

  BlessERP.createRepositoryBase = createRepositoryBase;
  BlessERP.getRepositoryMode = getRepositoryMode;
  BlessERP.assertRepositoryReady = assertRepositoryReady;
})();
