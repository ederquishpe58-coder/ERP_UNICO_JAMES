(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  async function register() {
    if (!("serviceWorker" in navigator)) {
      return { ok: false, mode: "UNSUPPORTED" };
    }
    if (!/^https?:$/.test(window.location.protocol)) {
      return { ok: false, mode: "FILE_LOCAL" };
    }
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./",
        updateViaCache: "none"
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        if (sessionStorage.getItem("jaeder-sw-reloaded") !== "1") {
          sessionStorage.setItem("jaeder-sw-reloaded", "1");
          window.location.reload();
        }
      });
      const activateWaitingWorker = () => {
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      };
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) activateWaitingWorker();
        });
      });
      activateWaitingWorker();
      registration.update().catch(() => {});
      return { ok: true, registration };
    } catch (error) {
      console.warn("[pwa] No se pudo registrar el Service Worker", error);
      return { ok: false, mode: "REGISTER_ERROR", error };
    }
  }

  BlessERP.pwa = { register };
})();
