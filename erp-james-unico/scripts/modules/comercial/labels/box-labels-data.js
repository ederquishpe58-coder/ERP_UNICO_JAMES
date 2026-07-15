(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const printModes = [
    { id: "all", label: "Todas" },
    { id: "range", label: "Rango" },
    { id: "individual", label: "Individual" }
  ];

  const statusDefinitions = {
    LISTA: { label: "LISTA", tone: "authorized" },
    FALTA_DAE: { label: "FALTA_DAE", tone: "cancelled" },
    FALTA_MARCA: { label: "FALTA_MARCA", tone: "cancelled" },
    FALTA_DESTINO: { label: "FALTA_DESTINO", tone: "cancelled" },
    SIN_CONTENIDO: { label: "SIN_CONTENIDO", tone: "cancelled" },
    CAJA_INCOMPLETA: { label: "CAJA_INCOMPLETA", tone: "cancelled" },
    FALTA_GUIAS: { label: "FALTA_AWB_HAWB", tone: "cancelled" },
    REIMPRESION_REQUERIDA: { label: "REIMPRESION_REQUERIDA", tone: "pending" },
    ADVERTENCIA_PO: { label: "ADVERTENCIA_PO", tone: "pending" },
    FALTA_NUMERO_CAJA: { label: "FALTA_NUMERO_CAJA", tone: "cancelled" }
  };

  const placeholders = {
    customs: "Codigo aduana demo / pendiente validacion",
    barcode: "BARCODE DEMO",
    qr: "QR DEMO",
    zebra: "Impresion Zebra y codigo de barras real se implementaran en una fase posterior."
  };

  BlessERP.comercialLabelData = {
    placeholders,
    printModes,
    statusDefinitions
  };
})();
