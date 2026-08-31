(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function isEnabled() {
    return Boolean(BlessERP.canUseSupabaseModule?.("operations")?.enabled && BlessERP.getSupabaseClient?.());
  }

  async function sync(workday) {
    // Adaptador de compatibilidad deliberadamente sin escritura. La autoridad
    // única de jornada es operations_yield_workday en erp_entity_records y su
    // persistencia ocurre por el pipeline incremental/offline canónico.
    return {
      ok: true,
      skipped: true,
      mode: isEnabled() ? "CANONICAL_INCREMENTAL" : "LOCAL_CACHE",
      canonicalEntity: "operations_yield_workday",
      workdayId: String(workday?.id || "")
    };
  }

  BlessERP.operationsWorkdayCloudSync = { isEnabled, sync };
})();
