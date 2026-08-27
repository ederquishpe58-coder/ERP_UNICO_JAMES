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

  register("employee", "employees", "getEmployeeRepository");
  register("employeePayProfile", "employee_pay_profiles", "getEmployeePayProfileRepository");
  register("workActivity", "work_activities", "getWorkActivityRepository");
  register("measurementUnit", "measurement_units", "getMeasurementUnitRepository");
  register("employeeRateRule", "employee_rate_rules", "getEmployeeRateRuleRepository");
  register("payrollPeriod", "payroll_periods", "getPayrollPeriodRepository");
  register("payrollParameterSet", "payroll_parameter_sets", "getPayrollParameterSetRepository");
  register("payrollHourMultiplier", "payroll_hour_multipliers", "getPayrollHourMultiplierRepository");
  register("payrollObligationSetting", "payroll_obligation_settings", "getPayrollObligationSettingRepository");
  register("payrollAccountSetting", "payroll_account_settings", "getPayrollAccountSettingRepository");
  register("salesperson", "salespeople", "getSalespersonRepository");
  register("salesCommissionRule", "sales_commission_rules", "getSalesCommissionRuleRepository");
})();
