(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function normalizeToken(value, fallback = "NA", maxLength = 24) {
    const token = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase();
    return (token || fallback).slice(0, maxLength);
  }

  function digitsOnly(value, fallback = "") {
    const digits = String(value || "").replace(/\D+/g, "");
    return digits || fallback;
  }

  function padBoxNumber(value) {
    const numeric = Math.max(0, Number(value || 0));
    return `BOX${String(numeric).padStart(3, "0")}`;
  }

  function buildCustomsCode(order, group, totalBoxes) {
    const boxNumber = Number(group?.boxNumber || group?.numero_caja || 0);
    if (!boxNumber) {
      return {
        value: "ERROR-SIN-BOX",
        isValid: false,
        note: "Codigo aduana demo no disponible por falta de numero de caja.",
        issues: ["Caja sin numero para generar codigo aduana demo."]
      };
    }

    const daeToken = digitsOnly(order?.daeNumber, "SIN-DAE");
    const destinationToken = normalizeToken(order?.destination, "SIN-DESTINO", 14);
    const flightToken = digitsOnly(order?.flightDate, "SIN-FECHA").slice(0, 8) || "SIN-FECHA";
    const orderToken = normalizeToken(order?.number, "SIN-PEDIDO", 16);
    const totalToken = `OF${String(Math.max(1, Number(totalBoxes || 0))).padStart(3, "0")}`;
    const code = `CUSTOMS-${daeToken}-${padBoxNumber(boxNumber)}-${totalToken}-${destinationToken}-${flightToken}-${orderToken}`;

    return {
      value: code,
      isValid: Boolean(order?.daeNumber),
      note: "Codigo aduana demo / pendiente validacion.",
      issues: order?.daeNumber ? [] : ["SIN DAE"]
    };
  }

  function buildBarcodeValue(order, group, totalBoxes) {
    const boxNumber = Number(group?.boxNumber || group?.numero_caja || 0);
    if (!boxNumber) return "";
    return `BAR-${normalizeToken(order?.number, "PEDIDO", 14)}-${padBoxNumber(boxNumber)}-OF${String(Math.max(1, Number(totalBoxes || 0))).padStart(3, "0")}`;
  }

  function buildQrValue(order, group, totalBoxes) {
    const boxNumber = Number(group?.boxNumber || group?.numero_caja || 0);
    if (!boxNumber) return "";
    return `QR-${normalizeToken(order?.destination, "DEST", 12)}-${padBoxNumber(boxNumber)}-${normalizeToken(order?.flightDate, "FECHA", 8)}-${String(Math.max(1, Number(totalBoxes || 0))).padStart(3, "0")}`;
  }

  BlessERP.comercialCustomsCode = {
    buildBarcodeValue,
    buildCustomsCode,
    buildQrValue,
    digitsOnly,
    normalizeToken,
    padBoxNumber
  };
})();
