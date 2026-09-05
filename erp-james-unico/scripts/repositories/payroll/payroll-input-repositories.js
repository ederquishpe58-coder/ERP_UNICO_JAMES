(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  BlessERP.repositoryModules = BlessERP.repositoryModules || {};
  BlessERP.repositoryModules.payroll = BlessERP.repositoryModules.payroll || {};

  function createFallbackRepository(entityName) {
    function pendingResult(extra) {
      return {
        ok: false,
        mode: "LOCAL_DEMO",
        entity: entityName,
        message: "Repositorio Supabase pendiente. Usar servicios demo/locales.",
        ...(extra || {})
      };
    }

    return {
      entity: entityName,
      list() {
        return pendingResult();
      },
      getById(id) {
        return pendingResult({ id });
      },
      create(payload) {
        return pendingResult({ payload });
      },
      update(id, payload) {
        return pendingResult({ id, payload });
      },
      remove(id) {
        return pendingResult({ id });
      }
    };
  }

  function register(key, entityName, getterName) {
    const repository = BlessERP.createRepositoryBase
      ? BlessERP.createRepositoryBase(entityName)
      : createFallbackRepository(entityName);

    BlessERP.repositoryModules.payroll[key] = repository;
    BlessERP[getterName] = function() {
      return repository;
    };
  }

  register("workTimeEntry", "work_time_entries", "getWorkTimeEntryRepository");
  register(
    "operationalPerformanceEntry",
    "operational_performance_entries",
    "getOperationalPerformanceEntryRepository"
  );
  register("employeeAdvance", "employee_advances", "getEmployeeAdvanceRepository");
  register(
    "employeeAdvanceMovement",
    "employee_advance_movements",
    "getEmployeeAdvanceMovementRepository"
  );
})();
