(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const dataApi = BlessERP.comercialPackagingData;
  const rulesApi = BlessERP.comercialPackagingRules;
  const statusApi = BlessERP.comercialPackagingStatus;

  function groupLinesByBox(lines) {
    const groups = [];
    const map = new Map();
    (lines || []).forEach(line => {
      const key = `${line.boxNumber}|${line.boxType}`;
      if (!map.has(key)) {
        const group = {
          boxId: `BOX-${line.boxNumber}`,
          boxNumber: Number(line.boxNumber || 0),
          boxType: line.boxType,
          lines: [],
          totalBunches: 0,
          totalStems: 0,
          varieties: []
        };
        map.set(key, group);
        groups.push(group);
      }
      const group = map.get(key);
      group.lines.push(line);
      group.totalBunches += Number(line.bunches || 0);
      group.totalStems += Number(line.totalStems || 0);
      group.varieties.push(`${line.variety} ${line.length} cm`);
    });

    return groups.sort((left, right) => left.boxNumber - right.boxNumber);
  }

  function cloneMaterialMeta(code) {
    const source = dataApi.materialMap[code];
    if (!source) {
      return {
        code,
        name: code,
        category: "MATERIAL_EMPAQUE",
        unit: "unidad",
        stockDemoAvailable: 0,
        minimumStock: 0,
        warehouse: "SIN-BODEGA",
        status: "SIN_CONFIGURACION",
        observation: "Material no configurado en catalogo demo."
      };
    }
    return BlessERP.utils.clone(source);
  }

  function createAccumulatorEntry(code, boxId, missingCatalog = false) {
    const meta = cloneMaterialMeta(code);
    return {
      code,
      name: meta.name,
      category: meta.category,
      unit: meta.unit,
      available: Number(meta.stockDemoAvailable || 0),
      minimumStock: Number(meta.minimumStock || 0),
      warehouse: meta.warehouse,
      materialStatus: meta.status,
      observation: meta.observation,
      required: 0,
      missing: 0,
      boxIds: new Set(boxId ? [boxId] : []),
      missingCatalog,
      sourceBoxes: []
    };
  }

  function addRequirement(store, code, quantity, boxId, meta = {}) {
    const requiredQty = Number(quantity || 0);
    if (!requiredQty) return;
    if (!store[code]) {
      store[code] = createAccumulatorEntry(code, boxId, meta.missingCatalog);
    }
    store[code].required += requiredQty;
    if (boxId) store[code].boxIds.add(boxId);
    if (meta.sourceBox) store[code].sourceBoxes.push(meta.sourceBox);
  }

  function resolveBoxRule(boxType, config) {
    const normalized = String(boxType || "").toUpperCase();
    const separatorCount = normalized === "HB"
      ? Number(config.separadores_por_HB || 0)
      : normalized === "QB"
        ? Number(config.separadores_por_QB || 0)
        : normalized === "EB"
          ? Number(config.separadores_por_EB || 0)
          : null;

    const cartonCode = config.cartonCodes?.[normalized] || "";
    const separatorCode = config.separatorCodes?.[normalized] || "";

    if (!separatorCount && separatorCount !== 0) {
      return null;
    }

    return {
      boxType: normalized,
      cartonCode,
      separatorCode,
      separatorCount
    };
  }

  function calculateBoxMaterials(group, order, config) {
    const rule = resolveBoxRule(group.boxType, config);
    if (!rule) {
      return {
        boxId: `${order.id}-BOX-${group.boxNumber}`,
        boxNumber: group.boxNumber,
        boxType: group.boxType,
        varieties: [...new Set(group.varieties)],
        bunches: group.totalBunches,
        stems: group.totalStems,
        materials: [],
        missingRule: true
      };
    }

    const materials = [];
    const boxId = `${order.id}-BOX-${group.boxNumber}`;
    const pushMaterial = (code, required) => {
      if (!required) return;
      const meta = cloneMaterialMeta(code);
      materials.push({
        code,
        name: meta.name,
        required: Number(required || 0),
        unit: meta.unit
      });
    };

    pushMaterial(rule.cartonCode, 1);
    pushMaterial(rule.separatorCode, rule.separatorCount);
    pushMaterial(config.specialCodes?.boxLabel, Number(config.etiquetas_por_caja || 0));
    pushMaterial(config.specialCodes?.sleeve, Number(config.fundas_por_caja || 0));

    group.lines.forEach(line => {
      const bunches = Number(line.bunches || 0);
      pushMaterial(config.specialCodes?.bunchTie, bunches * Number(config.ligas_por_ramo || 0));
      pushMaterial(config.specialCodes?.bunchLabel, bunches * Number(config.etiquetas_por_ramo || 0));
      if (Number(line.length || 0) >= Number(config.capuchon_desde_longitud || 0)) {
        pushMaterial(config.specialCodes?.capuchon, bunches * Number(config.capuchones_por_ramo || 0));
      }
    });

    return {
      boxId,
      boxNumber: group.boxNumber,
      boxType: group.boxType,
      varieties: [...new Set(group.varieties)],
      bunches: group.totalBunches,
      stems: group.totalStems,
      materials,
      missingRule: false
    };
  }

  function calculateOrderRequirements(order, appState) {
    const normalizedOrder = utils.normalizeOrder(order || {});
    const metrics = utils.getOrderMetrics(normalizedOrder);
    const config = rulesApi.resolvePackagingConfig(normalizedOrder);
    const boxGroups = groupLinesByBox(metrics.lines);
    const requirementStore = {};
    const missingRules = [];
    const missingCatalogCodes = [];
    const boxDetails = boxGroups.map(group => {
      const detail = calculateBoxMaterials(group, normalizedOrder, config);
      if (detail.missingRule) {
        missingRules.push(group.boxType);
        return detail;
      }

      detail.materials.forEach(item => {
        if (!dataApi.materialMap[item.code]) {
          missingCatalogCodes.push(item.code);
        }
        addRequirement(requirementStore, item.code, item.required, detail.boxId, { sourceBox: detail.boxNumber });
      });
      return detail;
    });

    const requirements = Object.values(requirementStore)
      .map(entry => {
        const missing = Math.max(Number(entry.required || 0) - Number(entry.available || 0), 0);
        const item = {
          code: entry.code,
          name: entry.name,
          category: entry.category,
          unit: entry.unit,
          required: Number(entry.required || 0),
          available: Number(entry.available || 0),
          missing,
          warehouse: entry.warehouse,
          observation: entry.observation,
          boxIds: [...entry.boxIds],
          materialStatus: entry.materialStatus,
          minimumStock: entry.minimumStock,
          sourceBoxes: [...entry.sourceBoxes]
        };
        item.state = statusApi.resolveRequirementState(item, normalizedOrder, {
          missingRule: false,
          missingCatalog: Boolean(entry.missingCatalog)
        });
        return item;
      })
      .sort((left, right) => left.code.localeCompare(right.code));

    const summary = statusApi.summarizeRequirements(requirements);
    summary.okCount = requirements.filter(item => item.required > 0 && item.available >= item.required).length;
    summary.partialCount = requirements.filter(item => item.required > 0 && item.available > 0 && item.available < item.required).length;
    summary.missingCount = requirements.filter(item => item.required > 0 && item.available === 0).length;
    summary.requiredCount = requirements.filter(item => item.state === "REQUERIDO").length;
    summary.cartonsRequired = requirements
      .filter(item => item.code.startsWith("CARTON-"))
      .reduce((sum, item) => sum + item.required, 0);
    summary.boxLabelsRequired = requirements
      .filter(item => item.code === "ETQ-CAJA")
      .reduce((sum, item) => sum + item.required, 0);
    summary.bunchLabelsRequired = requirements
      .filter(item => item.code === "ETQ-RAMO")
      .reduce((sum, item) => sum + item.required, 0);
    summary.tiesRequired = requirements
      .filter(item => item.code === "LIGA-001")
      .reduce((sum, item) => sum + item.required, 0);
    summary.capuchonesRequired = requirements
      .filter(item => item.code === "CAP-001")
      .reduce((sum, item) => sum + item.required, 0);
    summary.sleevesRequired = requirements
      .filter(item => item.code === "FUNDA-001")
      .reduce((sum, item) => sum + item.required, 0);
    summary.orderPackagingStatus = statusApi.resolveOrderPackagingStatus(normalizedOrder, summary);

    const warnings = statusApi.buildWarnings({
      summary,
      missingRules: [...new Set(missingRules)],
      missingCatalogCodes: [...new Set(missingCatalogCodes)]
    });

    const contractRows = requirements.map(item => ({
      pedido_id: normalizedOrder.id,
      box_id: item.boxIds[0] || "",
      fecha: normalizedOrder.flightDate || normalizedOrder.issuedAt || "",
      tipo_caja: item.boxIds.length ? boxDetails.find(detail => detail.boxId === item.boxIds[0])?.boxType || "" : "",
      cantidad_cajas: item.boxIds.length,
      material_codigo: item.code,
      material_nombre: item.name,
      categoria: item.category,
      unidad: item.unit,
      requerido: item.required,
      disponible: item.available,
      faltante: item.missing,
      bodega: item.warehouse,
      estado: item.state,
      observacion: item.observation,
      origen_calculo: "pedido_maestro",
      consumo_real_id: ""
    }));

    return {
      order: normalizedOrder,
      appState,
      metrics,
      config,
      requirements,
      boxDetails,
      summary,
      warnings,
      missingRules: [...new Set(missingRules)],
      missingCatalogCodes: [...new Set(missingCatalogCodes)],
      contractRows
    };
  }

  BlessERP.comercialPackagingCalculator = {
    calculateOrderRequirements,
    groupLinesByBox
  };
})();
