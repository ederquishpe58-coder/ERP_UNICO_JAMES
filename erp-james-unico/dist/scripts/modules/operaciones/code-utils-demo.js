(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const varietyAliases = {
    EXPLORER: "EXP",
    "PLAYA BLANCA": "PLA",
    MONDIAL: "MON",
    CANDLELIGHT: "CAN",
    QUICKSAND: "QUI",
    NINA: "NIN",
    "PINK MONDIAL": "PMO",
    "HOT EXPLORER": "HEX",
    HERMOSA: "HER",
    MANDALA: "MAN",
    "BE SWEET": "BSW"
  };

  function normalizeDemoCode(codigo) {
    return String(codigo || "").trim().toUpperCase().replace(/\s+/g, "-");
  }

  function cleanToken(value) {
    return normalizeDemoCode(value).replace(/[^A-Z0-9]/g, "");
  }

  function pad3(value) {
    const numeric = Number(value || 0);
    return String(Number.isFinite(numeric) ? numeric : 0).padStart(3, "0");
  }

  function cleanPedido(pedidoNumero) {
    const token = cleanToken(pedidoNumero);
    return token || "PEDIDO";
  }

  function shortVariety(variedad) {
    const normalized = normalizeDemoCode(variedad).replace(/-/g, " ");
    if (varietyAliases[normalized]) return varietyAliases[normalized];
    return cleanToken(variedad).slice(0, 3) || "VAR";
  }

  function buildBoxCodeDemo(pedidoNumero, numeroCaja) {
    return `BOX-${cleanPedido(pedidoNumero)}-${pad3(numeroCaja)}`;
  }

  function buildBunchCodeDemo(variedad, longitud, secuencia) {
    const lengthToken = String(Number(longitud || 0) || 0);
    return `BUNCH-${shortVariety(variedad)}-${lengthToken}-${pad3(secuencia)}`;
  }

  function buildOrderCodeDemo(pedidoNumero) {
    return `PED-${cleanPedido(pedidoNumero)}`;
  }

  function buildDispatchCodeDemo(pedidoNumero) {
    return `DSP-${cleanPedido(pedidoNumero)}`;
  }

  function parseDemoCode(codigo) {
    const code = normalizeDemoCode(codigo);
    let match = code.match(/^BOX-([A-Z0-9]+)-(\d{3})$/);
    if (match) {
      return {
        codigo: code,
        tipo_codigo: "CAJA",
        pedido: match[1],
        numero_caja: Number(match[2]),
        caja: match[2]
      };
    }

    match = code.match(/^BUNCH-([A-Z0-9]{3})-(\d+)-(\d{3})$/);
    if (match) {
      return {
        codigo: code,
        tipo_codigo: "RAMO",
        variedad_corta: match[1],
        longitud: Number(match[2]),
        secuencia: Number(match[3])
      };
    }

    match = code.match(/^PED-([A-Z0-9]+)$/);
    if (match) {
      return {
        codigo: code,
        tipo_codigo: "PEDIDO",
        pedido: match[1]
      };
    }

    match = code.match(/^DSP-([A-Z0-9]+)$/);
    if (match) {
      return {
        codigo: code,
        tipo_codigo: "DESPACHO",
        pedido: match[1]
      };
    }

    return {
      codigo: code,
      tipo_codigo: "DESCONOCIDO"
    };
  }

  BlessERP.operacionesCodeUtilsDemo = {
    buildBoxCodeDemo,
    buildBunchCodeDemo,
    buildOrderCodeDemo,
    buildDispatchCodeDemo,
    parseDemoCode,
    normalizeDemoCode,
    shortVariety
  };
})();
