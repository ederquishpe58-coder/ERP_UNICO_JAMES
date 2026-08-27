(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const printModes = [
    { id: "all", label: "Todas" },
    { id: "range", label: "Rango" },
    { id: "individual", label: "Individual" }
  ];

  const statusDefinitions = {
    LISTA: { label: "LISTA", tone: "authorized" },
    FALTA_FACTURA: { label: "FALTA_FACTURA", tone: "cancelled" },
    FALTA_DAE: { label: "FALTA_DAE", tone: "cancelled" },
    DAE_INVALIDA: { label: "DAE_INVALIDA", tone: "cancelled" },
    FALTA_MARCA: { label: "FALTA_MARCA", tone: "cancelled" },
    FALTA_DESTINO: { label: "FALTA_DESTINO", tone: "cancelled" },
    SIN_CONTENIDO: { label: "SIN_CONTENIDO", tone: "cancelled" },
    CAJA_INCOMPLETA: { label: "LISTA_ANTICIPADA", tone: "pending" },
    FALTA_GUIAS: { label: "FALTA_AWB_HAWB", tone: "cancelled" },
    REIMPRESION_REQUERIDA: { label: "REIMPRESION_REQUERIDA", tone: "pending" },
    ADVERTENCIA_PO: { label: "ADVERTENCIA_PO", tone: "pending" },
    FALTA_NUMERO_CAJA: { label: "FALTA_NUMERO_CAJA", tone: "cancelled" }
  };

  const placeholders = {
    customs: "Codigo DAE",
    barcode: "CODIGO DE BARRAS DAE",
    zebra: "Zebra ZD220: JAEDER SYSTEMS descarga un PDF vertical de 100 x 160 mm, con margen de página 0. Abrir en Adobe Acrobat e imprimir en Tamaño real / 100 %."
  };

  BlessERP.comercialLabelData = {
    placeholders,
    printModes,
    statusDefinitions
  };
})();
