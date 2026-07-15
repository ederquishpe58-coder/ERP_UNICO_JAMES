(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function resolveRequirementState(material, order, meta = {}) {
    const required = Number(material.required || 0);
    const available = Number(material.available || 0);
    const lifecycleStatus = String(order?.packagingDemoStatus || "");

    if (required <= 0) return "PENDIENTE_INVENTARIO_REAL";
    if (lifecycleStatus === "CONSUMIDO_DEMO") return "CONSUMIDO_DEMO";
    if (meta.missingRule || meta.missingCatalog) return "PENDIENTE_INVENTARIO_REAL";
    if (String(order?.status || "").toUpperCase() === "BORRADOR") return "REQUERIDO";
    if (available >= required) return "OK";
    if (available > 0 && available < required) return "PARCIAL";
    if (available === 0) return "FALTANTE";
    return "PENDIENTE_INVENTARIO_REAL";
  }

  function resolveOrderPackagingStatus(order, summary) {
    const lifecycleStatus = String(order?.packagingDemoStatus || "");
    if (lifecycleStatus === "CONSUMIDO_DEMO") return "CONSUMIDO_DEMO";
    if (lifecycleStatus === "PREPARADO_DEMO") return "PREPARADO_DEMO";
    if (summary.missingCount > 0) return "FALTANTE";
    if (summary.partialCount > 0) return "PARCIAL";
    if (String(order?.status || "").toUpperCase() === "BORRADOR") return "REQUERIDO";
    return "OK";
  }

  function summarizeRequirements(requirements) {
    const summary = {
      totalMaterialTypes: 0,
      totalUnitsRequired: 0,
      okCount: 0,
      partialCount: 0,
      missingCount: 0,
      requiredCount: 0,
      consumedCount: 0,
      pendingInventoryCount: 0
    };

    (requirements || []).forEach(item => {
      if (Number(item.required || 0) <= 0) return;
      summary.totalMaterialTypes += 1;
      summary.totalUnitsRequired += Number(item.required || 0);
      if (item.state === "OK") summary.okCount += 1;
      if (item.state === "PARCIAL") summary.partialCount += 1;
      if (item.state === "FALTANTE") summary.missingCount += 1;
      if (item.state === "REQUERIDO") summary.requiredCount += 1;
      if (item.state === "CONSUMIDO_DEMO") summary.consumedCount += 1;
      if (item.state === "PENDIENTE_INVENTARIO_REAL") summary.pendingInventoryCount += 1;
    });

    return summary;
  }

  function buildWarnings(result) {
    const warnings = [];
    if (result.summary.missingCount > 0) warnings.push("Materiales faltantes en bodega / empaque.");
    if (result.summary.partialCount > 0) warnings.push("Materiales parciales en bodega / empaque.");
    if (result.missingRules.length > 0) warnings.push("Tipo de caja sin regla de empaque.");
    if (result.missingCatalogCodes.length > 0) warnings.push("Caja o material sin configuracion en catalogo.");
    warnings.push("Inventario real no conectado.");
    return warnings;
  }

  BlessERP.comercialPackagingStatus = {
    buildWarnings,
    resolveOrderPackagingStatus,
    resolveRequirementState,
    summarizeRequirements
  };
})();
