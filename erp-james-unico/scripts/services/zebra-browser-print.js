(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let selectedDevice = null;

  function baseUrl() {
    return window.location.protocol === "https:" ? "https://localhost:9101/" : "http://localhost:9100/";
  }

  function timeoutPromise(ms, message) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
  }

  function browserPrintCall(executor, timeout = 5000) {
    return Promise.race([
      new Promise((resolve, reject) => executor(resolve, error => reject(new Error(String(error || "Error de Zebra Browser Print."))))),
      timeoutPromise(timeout, "Zebra Browser Print no respondió a tiempo.")
    ]);
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
      normalized.code = "BROWSER_PRINT_NOT_STARTED";
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
    const device = selectedDevice || await getDefaultPrinter();
    if (device?.send && typeof device.send === "function") {
      await browserPrintCall((resolve, reject) => device.send(zpl, resolve, reject), 8000);
      return { ok: true, device };
    }
    const payload = JSON.stringify({
      device: {
        name: device.name,
        uid: device.uid,
        connection: device.connection,
        deviceType: device.deviceType,
        version: device.version || 2,
        provider: device.provider,
        manufacturer: device.manufacturer
      },
      data: zpl
    });
    await nativeRequest("write", { method: "POST", body: payload, timeout: 8000 });
    return { ok: true, device };
  }

  function clearDevice() {
    selectedDevice = null;
  }

  BlessERP.zebraBrowserPrint = { baseUrl, clearDevice, getDefaultPrinter, send };
})();
