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

  register("payrollRun", "payroll_runs", "getPayrollRunRepository");
  register("payrollEmployeeItem", "payroll_employee_items", "getPayrollEmployeeItemRepository");
  register("payrollComponent", "payroll_components", "getPayrollComponentRepository");
  register(
    "payrollCommissionSource",
    "payroll_commission_sources",
    "getPayrollCommissionSourceRepository"
  );
  register(
    "payrollManualAdjustment",
    "payroll_manual_adjustments",
    "getPayrollManualAdjustmentRepository"
  );
  register("payrollStatusHistory", "payroll_status_history", "getPayrollStatusHistoryRepository");
  register("payrollJournalLink", "payroll_journal_links", "getPayrollJournalLinkRepository");
  register("payrollPayment", "payroll_payments", "getPayrollPaymentRepository");
  register("payrollPaymentSplit", "payroll_payment_splits", "getPayrollPaymentSplitRepository");
  register("payrollCheckDetail", "payroll_check_details", "getPayrollCheckDetailRepository");
  register("payrollDocument", "payroll_documents", "getPayrollDocumentRepository");
})();
