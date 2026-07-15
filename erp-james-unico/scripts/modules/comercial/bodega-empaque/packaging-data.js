(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { clone } = BlessERP.utils;

  const materials = [
    {
      code: "CARTON-HB",
      name: "Caja HB",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 220,
      minimumStock: 40,
      warehouse: "BODEGA-EMPAQUE-A",
      status: "ACTIVO",
      observation: "Carton HB disponible para pedidos comerciales demo."
    },
    {
      code: "CARTON-QB",
      name: "Caja QB",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 160,
      minimumStock: 30,
      warehouse: "BODEGA-EMPAQUE-A",
      status: "ACTIVO",
      observation: "Carton QB para pedidos compactos."
    },
    {
      code: "CARTON-EB",
      name: "Caja EB",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 80,
      minimumStock: 20,
      warehouse: "BODEGA-EMPAQUE-A",
      status: "ACTIVO",
      observation: "Caja EB configurable para pedidos de menor volumen."
    },
    {
      code: "SEP-HB",
      name: "Separador HB",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 260,
      minimumStock: 50,
      warehouse: "BODEGA-EMPAQUE-B",
      status: "ACTIVO",
      observation: "Separador dedicado para cajas HB."
    },
    {
      code: "SEP-QB",
      name: "Separador QB",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 140,
      minimumStock: 30,
      warehouse: "BODEGA-EMPAQUE-B",
      status: "ACTIVO",
      observation: "Separador para cajas QB y EB compactas."
    },
    {
      code: "LIGA-001",
      name: "Liga para bonche",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 480,
      minimumStock: 120,
      warehouse: "BODEGA-EMPAQUE-C",
      status: "ACTIVO",
      observation: "Consumo base por ramo configurable."
    },
    {
      code: "CAP-001",
      name: "Capuchón transparente",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 360,
      minimumStock: 90,
      warehouse: "BODEGA-EMPAQUE-C",
      status: "ACTIVO",
      observation: "Se aplica por ramo segun regla comercial."
    },
    {
      code: "ETQ-CAJA",
      name: "Etiqueta de caja",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 240,
      minimumStock: 60,
      warehouse: "BODEGA-EMPAQUE-D",
      status: "ACTIVO",
      observation: "Etiqueta operativa para packing y despacho."
    },
    {
      code: "ETQ-RAMO",
      name: "Etiqueta de ramo",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 620,
      minimumStock: 160,
      warehouse: "BODEGA-EMPAQUE-D",
      status: "ACTIVO",
      observation: "Solo aplica para perfiles comerciales que lo requieran."
    },
    {
      code: "FUNDA-001",
      name: "Funda empaque",
      category: "MATERIAL_EMPAQUE",
      unit: "unidad",
      stockDemoAvailable: 150,
      minimumStock: 35,
      warehouse: "BODEGA-EMPAQUE-E",
      status: "ACTIVO",
      observation: "Funda adicional para clientes o destinos que lo exijan."
    }
  ];

  BlessERP.comercialPackagingData = {
    materials,
    materialMap: Object.fromEntries(materials.map(item => [item.code, item])),
    cloneMaterials() {
      return clone(materials);
    }
  };
})();
