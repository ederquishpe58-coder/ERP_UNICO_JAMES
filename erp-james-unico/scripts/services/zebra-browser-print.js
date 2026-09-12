(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let selectedDevice = null;
  let sending = false;
  let lastDiagnostic = null;

  function baseUrl() {
    // BrowserPrint 3.1.250 uses HTTPS loopback only for Safari.
    const safari = /^((?!chrome|android).)*safari/i.test(window.navigator?.userAgent || "");
    return safari && window.location.protocol === "https:" ? "https://127.0.0.1:9101/" : "http://127.0.0.1:9100/";
  }

  function browserPrintCall(executor, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("Zebra Browser Print no respondio a tiempo."), { code: "BROWSER_PRINT_TIMEOUT" })), timeout);
      const finish = (callback, value) => { clearTimeout(timer); callback(value); };
      try { executor(value => finish(resolve, value), error => finish(reject, new Error(String(error || "Error de Zebra Browser Print.")))); }
      catch (error) { finish(reject, error); }
    });
  }

  async function nativeRequest(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 4500);
    try {
      const response = await fetch(`${baseUrl()}${path}`, {
        method: options.method || "GET",
        body: options.body,
        signal: controller.signal,
        cache: "no-store",
        headers: options.body ? { "Content-Type": "text/plain;charset=UTF-8" } : undefined
      });
      if (!response.ok) throw new Error(`Browser Print respondió HTTP ${response.status}.`);
      return await response.text();
    } catch (error) {
      const normalized = new Error(error?.name === "AbortError" ? "Zebra Browser Print no respondió a tiempo." : (error?.message || "No se pudo conectar con Zebra Browser Print."));
      normalized.code = error?.name === "AbortError" ? "BROWSER_PRINT_TIMEOUT" : "BROWSER_PRINT_CONNECTION_ERROR";
      if (normalized.code === "BROWSER_PRINT_CONNECTION_ERROR") normalized.message += ` Compruebe Browser Print y la autorizacion local del sitio ${window.location.origin}.`;
      throw normalized;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getDefaultPrinter() {
    if (window.BrowserPrint?.getDefaultDevice) {
      const device = await browserPrintCall((resolve, reject) => window.BrowserPrint.getDefaultDevice("printer", resolve, reject));
      if (!device) throw new Error("Zebra Browser Print está iniciado, pero no tiene una impresora predeterminada.");
      selectedDevice = device;
      return device;
    }
    const raw = await nativeRequest("default?type=printer");
    if (!raw.trim()) throw new Error("Zebra Browser Print está iniciado, pero no tiene una impresora predeterminada.");
    selectedDevice = JSON.parse(raw);
    return selectedDevice;
  }

  async function send(zpl) {
    if (typeof zpl !== "string" || !zpl.trim()) throw new Error("El contenido ZPL esta vacio; no se envio a la impresora.");
    if (sending) throw new Error("Ya hay un envio Zebra en curso.");
    sending = true;
    lastDiagnostic = null;
    let invoked = false;
    try {
    const device = selectedDevice || await getDefaultPrinter();
    if (!device.uid || device.deviceType !== "printer") throw new Error("El dispositivo seleccionado no es una impresora valida.");
    const bytes = new TextEncoder().encode(zpl);
    const digest = window.crypto?.subtle ? await window.crypto.subtle.digest("SHA-256", bytes) : null;
    lastDiagnostic = { device: { uid: device.uid, name: device.name, connection: device.connection }, stage: "ENVIANDO", bytes: bytes.length, sha256: digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") : null };
    invoked = true;
    if (device?.send && typeof device.send === "function") {
      await browserPrintCall((resolve, reject) => device.send(zpl, resolve, reject), 8000);
      lastDiagnostic.stage = "ACEPTADO_POR_BROWSER_PRINT";
      return { ok: true, device };
    }
    const payload = JSON.stringify({
      device: {
        name: device.name,
        uid: device.uid,
        connection: device.connection,
        deviceType: device.deviceType,
        version: 2,
        provider: device.provider,
        manufacturer: device.manufacturer
      },
      data: zpl
    });
    await nativeRequest("write", { method: "POST", body: payload, timeout: 8000 });
    lastDiagnostic.stage = "ACEPTADO_POR_BROWSER_PRINT";
    return { ok: true, device };
    } catch (error) {
      if (invoked && error.code === "BROWSER_PRINT_TIMEOUT") {
        error.message = "Resultado de envio incierto: Browser Print no respondio. Compruebe la salida fisica antes de reintentar; no se reenvio automaticamente.";
      }
      if (lastDiagnostic) { lastDiagnostic.stage = invoked ? "RESULTADO_INCIERTO_O_ERROR" : "ERROR_PREPARACION"; lastDiagnostic.error = error.code || "BROWSER_PRINT_ERROR"; }
      throw error;
    } finally { sending = false; }
  }

  function clearDevice() {
    selectedDevice = null;
  }

  BlessERP.zebraBrowserPrint = { baseUrl, clearDevice, getDefaultPrinter, send, getDiagnostic: () => lastDiagnostic ? JSON.parse(JSON.stringify(lastDiagnostic)) : null };
})();
