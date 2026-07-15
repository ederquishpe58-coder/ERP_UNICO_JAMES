(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const MODE = "TECLADO_HID_DEMO";

  let hidStatus = {
    mode: MODE,
    active: false,
    realConnectionStatus: "No conectado",
    last_input: "",
    last_normalized: "",
    last_result: "",
    last_reason: "Sesion HID demo inactiva.",
    last_timestamp: "",
    session_options: {}
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeScannerInputDemo(value) {
    return String(value || "")
      .replace(/[\r\n]+/g, "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/-+/g, "-");
  }

  function isLikelyScannerInputDemo(value) {
    const normalized = normalizeScannerInputDemo(value);
    if (normalized.length <= 5) return false;
    return /^(BOX-|BUNCH-|PED-|DSP-)/.test(normalized);
  }

  function createHidScannerSessionDemo(options = {}) {
    hidStatus = {
      mode: MODE,
      active: options.active === undefined ? Boolean(hidStatus.active) : Boolean(options.active),
      realConnectionStatus: "No conectado",
      last_input: "",
      last_normalized: "",
      last_result: "",
      last_reason: options.reason || "Sesion HID demo preparada.",
      last_timestamp: nowIso(),
      session_options: { ...options }
    };
    return getHidScannerStatusDemo();
  }

  function startHidScannerDemo() {
    hidStatus.active = true;
    hidStatus.last_reason = "Modo HID demo activo. El input queda listo para Enter.";
    hidStatus.last_timestamp = nowIso();
    return getHidScannerStatusDemo();
  }

  function stopHidScannerDemo() {
    hidStatus.active = false;
    hidStatus.last_reason = "Modo HID demo detenido.";
    hidStatus.last_timestamp = nowIso();
    return getHidScannerStatusDemo();
  }

  function handleHidInputDemo(value, context = {}) {
    const raw = String(value || "");
    const normalized = normalizeScannerInputDemo(raw);
    const detected = isLikelyScannerInputDemo(normalized);
    const timestamp = nowIso();
    const reason = !normalized
      ? "Entrada vacia."
      : detected
        ? (hidStatus.active
            ? "Codigo demo reconocido para flujo HID."
            : "Codigo demo reconocido, pero la sesion HID demo estaba inactiva.")
        : "Formato no reconocido como scanner demo.";

    hidStatus.last_input = raw;
    hidStatus.last_normalized = normalized;
    hidStatus.last_result = context.result || (detected ? "DETECTADO_DEMO" : "DESCONOCIDO");
    hidStatus.last_reason = reason;
    hidStatus.last_timestamp = timestamp;
    hidStatus.session_options = {
      ...hidStatus.session_options,
      last_context: { ...context }
    };

    return {
      raw_value: raw,
      normalized_value: normalized,
      mode: MODE,
      detected,
      reason,
      timestamp
    };
  }

  function getHidScannerStatusDemo() {
    return {
      ...hidStatus,
      session_options: { ...(hidStatus.session_options || {}) }
    };
  }

  BlessERP.operacionesHidScannerDemo = {
    createHidScannerSessionDemo,
    startHidScannerDemo,
    stopHidScannerDemo,
    handleHidInputDemo,
    isLikelyScannerInputDemo,
    normalizeScannerInputDemo,
    getHidScannerStatusDemo
  };
})();
