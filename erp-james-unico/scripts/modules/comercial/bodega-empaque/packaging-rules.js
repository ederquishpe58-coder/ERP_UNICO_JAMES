(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { clone } = BlessERP.utils;

  function mergeConfig(baseConfig, overrideConfig) {
    const source = overrideConfig && typeof overrideConfig === "object" ? overrideConfig : {};
    const output = clone(baseConfig);
    Object.keys(source).forEach(key => {
      const value = source[key];
      if (Array.isArray(value)) {
        output[key] = [...value];
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        output[key] = {
          ...(output[key] && typeof output[key] === "object" ? output[key] : {}),
          ...value
        };
      } else {
        output[key] = value;
      }
    });
    return output;
  }

  const defaultConfig = {
    separadores_por_HB: 2,
    separadores_por_QB: 1,
    separadores_por_EB: 1,
    ligas_por_ramo: 1,
    capuchones_por_ramo: 0,
    etiquetas_por_caja: 1,
    etiquetas_por_ramo: 0,
    fundas_por_caja: 0,
    capuchon_desde_longitud: 60,
    cartonCodes: {
      HB: "CARTON-HB",
      QB: "CARTON-QB",
      EB: "CARTON-EB"
    },
    separatorCodes: {
      HB: "SEP-HB",
      QB: "SEP-QB",
      EB: "SEP-QB"
    },
    specialCodes: {
      boxLabel: "ETQ-CAJA",
      bunchLabel: "ETQ-RAMO",
      bunchTie: "LIGA-001",
      capuchon: "CAP-001",
      sleeve: "FUNDA-001"
    }
  };

  const brandOverrides = {
    "brand-alex": {
      capuchones_por_ramo: 1,
      fundas_por_caja: 1
    },
    "brand-del-real": {
      etiquetas_por_ramo: 1,
      fundas_por_caja: 1
    },
    "brand-orbiq": {
      etiquetas_por_ramo: 1,
      fundas_por_caja: 1
    },
    "brand-sg-jfe": {
      etiquetas_por_ramo: 1,
      capuchones_por_ramo: 0,
      fundas_por_caja: 0
    }
  };

  const destinationOverrides = {
    KAZAJSTAN: {
      capuchones_por_ramo: 1,
      fundas_por_caja: 1
    },
    "REPUBLICA DOMINICANA": {
      fundas_por_caja: 1,
      etiquetas_por_ramo: 1
    },
    USA: {
      fundas_por_caja: 1
    },
    ECUADOR: {
      capuchones_por_ramo: 0,
      fundas_por_caja: 0
    }
  };

  function resolvePackagingConfig(order) {
    const destinationKey = String(order?.destination || "").trim().toUpperCase();
    const brandKey = String(order?.brandId || "").trim();
    let config = mergeConfig(defaultConfig, destinationOverrides[destinationKey]);
    config = mergeConfig(config, brandOverrides[brandKey]);
    return config;
  }

  BlessERP.comercialPackagingRules = {
    brandOverrides,
    defaultConfig,
    destinationOverrides,
    mergeConfig,
    resolvePackagingConfig
  };
})();
