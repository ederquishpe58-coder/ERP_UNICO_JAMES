(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let bootStage = "INICIO";
  const bootStartedAt = BlessERP.performance?.now?.() || performance.now();
  let bootStageStartedAt = bootStartedAt;

  function setBootStage(stage) {
    if (bootStage) BlessERP.performance?.record?.(`arranque:${bootStage.toLowerCase()}`, bootStageStartedAt);
    bootStage = stage;
    bootStageStartedAt = BlessERP.performance?.now?.() || performance.now();
  }

  function timeout(promise, milliseconds, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => window.setTimeout(
        () => reject(new Error(`${label} excedió el tiempo de espera.`)),
        milliseconds
      ))
    ]);
  }

  function errorLocation(error) {
    const stack = String(error?.stack || "");
    const match = stack.match(/(?:file:\/\/\/)?[^\n()]*(?:app|scripts)[\\/][^\n()]+\.js(?:\?[^:\n()]*)?:(\d+):(\d+)/i);
    if (!match) return "";
    const fullMatch = match[0].replace(/^file:\/\/\//i, "");
    return fullMatch.replace(/^.*?(?=(?:app|scripts)[\\/])/i, "");
  }

  function rememberBootError(error) {
    const diagnostic = {
      stage: bootStage,
      message: String(error?.message || error || "Error inesperado"),
      location: errorLocation(error),
      stack: String(error?.stack || ""),
      at: new Date().toISOString()
    };
    window.__JAEDER_LAST_BOOT_ERROR__ = diagnostic;
    return diagnostic;
  }

  function renderFatalBootError(error) {
    const diagnostic = rememberBootError(error);
    window.clearTimeout(window.__JAEDER_BOOT_WATCHDOG__);
    console.error("[jaeder-boot] No se pudo completar el arranque", error);
    BlessERP.authAccess?.renderGate?.({
      title: "No se pudo iniciar JAEDER SYSTEMS",
      message: `${diagnostic.message} Etapa: ${diagnostic.stage}.${diagnostic.location ? ` Ubicación: ${diagnostic.location}.` : ""} Actualice la página para reintentar. No es necesario cerrar la sesión.`,
      showLogin: false,
      allowSignOut: true,
      access: BlessERP.authAccess?.activeAccess?.()
    });
  }

  function renderAppWithRouteRecovery() {
    try {
      BlessERP.layout.renderApp();
      return { recovered: false };
    } catch (error) {
      const failedRoute = String(BlessERP.state?.currentRoute?.()?.id || BlessERP.state?.state?.ui?.route || "");
      const fallbackRoute = "dashboard-home";
      const diagnostic = rememberBootError(error);
      console.error(`[jaeder-boot] Falló la ruta ${failedRoute || "desconocida"}; se intentará abrir ${fallbackRoute}`, error);
      if (!failedRoute || failedRoute === fallbackRoute || !BlessERP.state?.setRoute?.(fallbackRoute)) {
        throw error;
      }
      BlessERP.layout.renderApp();
      window.setTimeout(() => BlessERP.layout?.toast?.(
        `Se abrió el panel principal porque ${failedRoute} contenía datos antiguos incompatibles. El diagnóstico quedó registrado (${diagnostic.location || diagnostic.stage}).`
      ), 0);
      return { recovered: true, failedRoute, diagnostic };
    }
  }

  function afterFirstPaint(callback) {
    const run = () => window.setTimeout(callback, 0);
    if (typeof window.requestAnimationFrame !== "function") {
      run();
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  }

  function reportSyncContext() {
    const access = BlessERP.authAccess?.activeAccess?.() || {};
    const env = BlessERP.getEnvConfig?.() || {};
    let projectRef = "";
    try { projectRef = new URL(env.supabaseUrl || "").hostname.split(".")[0] || ""; } catch {}
    console.info("[jaeder-sync-context]", {
      userId: access.session?.user?.id || "",
      email: access.session?.user?.email || "",
      role: access.ownMembership?.membership_role || "",
      companyId: access.activeCompany?.id || "",
      companyKey: access.activeCompany?.company_key || "",
      supabaseProjectRef: projectRef,
      appEnvironment: env.appEnv || "",
      deploymentHost: window.location.host
    });
  }

  async function verifyEnabledV2Backends() {
    const env = BlessERP.getEnvConfig?.() || {};
    const checks = [
      {
        key: "OPERATIONS_V2",
        enabled: env.operationsV2CaptureEnabled === true,
        repository: () => BlessERP.getOperationsV2Repository?.()
      },
      {
        key: "ZEBRA_V2",
        enabled: env.zebraV2CaptureEnabled === true,
        repository: () => BlessERP.getZebraV2Repository?.()
      },
      {
        key: "WAREHOUSE_V2",
        enabled: env.warehouseV2CaptureEnabled === true,
        repository: () => BlessERP.getWarehouseV2Repository?.()
      },
      {
        key: "DESTINATION_LOTS_V2",
        enabled: env.zebraV2CaptureEnabled === true && env.warehouseV2CaptureEnabled === true,
        repository: () => BlessERP.getLocalDestinationV2Repository?.()
      },
      {
        key: "DISPATCH_V2",
        enabled: env.dispatchV2CaptureEnabled === true,
        repository: () => BlessERP.getDispatchV2Repository?.()
      },
      {
        key: "EXPORT_V2",
        enabled: env.exportV2CaptureEnabled === true,
        repository: () => BlessERP.getExportShipmentV2Repository?.()
      },
      {
        key: "FINANCIAL_V2",
        enabled: env.financialV2CaptureEnabled === true,
        repository: () => BlessERP.getFinancialV2Repository?.()
      },
      {
        key: "SUPPLIER_FINANCE_V2",
        enabled: env.supplierFinanceV2CaptureEnabled === true,
        repository: () => BlessERP.getSupplierFinanceV2Repository?.()
      },
      {
        key: "TREASURY_V2",
        enabled: env.treasuryV2CaptureEnabled === true,
        repository: () => BlessERP.getTreasuryV2Repository?.()
      }
    ].filter(check => check.enabled);
    const results = [];
    for (const check of checks) {
      const repository = check.repository();
      const result = repository?.probeBackend
        ? await repository.probeBackend({ force: true })
        : { ok: false, status: "REPOSITORY_MISSING", message: `No se cargó el repositorio ${check.key}.` };
      const verified = result?.ok === true && repository?.canExecute?.() === true;
      results.push({
        key: check.key,
        verified,
        status: result?.status || "UNKNOWN",
        message: result?.message || ""
      });
    }
    const status = {
      checkedAt: new Date().toISOString(),
      enabled: checks.map(check => check.key),
      results,
      ok: results.every(result => result.verified)
    };
    window.__JAEDER_V2_FRONTEND_STATUS__ = status;
    console.info("[jaeder-v2-health]", status);
    return status;
  }

  async function startBackgroundServices(auth, initialCloud) {
    const backgroundStartedAt = BlessERP.performance?.now?.() || performance.now();
    let cloud = initialCloud;
    const v2Health = await verifyEnabledV2Backends().catch(error => ({
      ok: false,
      checkedAt: new Date().toISOString(),
      enabled: [],
      results: [],
      error: error?.message || String(error)
    }));
    if (!v2Health.ok) {
      cloud = {
        ok: false,
        mode: "V2_HEALTH_FAILED",
        message: "El backend V2 no pasó la validación. Las operaciones afectadas quedaron bloqueadas sin fallback legacy."
      };
      console.error("[jaeder-v2-health] Flujo bloqueado para evitar mezcla V2/legacy.", v2Health);
    }
    try {
      await timeout(
        BlessERP.offlineSync?.start?.(BlessERP.state.state.db) || { ok: true, mode: "LOCAL" },
        30000,
        "La sincronización inicial por registros"
      );
    } catch (error) {
      // La interfaz ya está disponible. La cola incremental conserva lo local y
      // sus supervisores continuarán reintentando cuando Supabase responda.
      console.warn("[jaeder-sync] Supabase no confirmó la carga inicial; el sistema continúa disponible.", error);
      cloud = { ok: false, mode: "INCREMENTAL_LOAD_ERROR", message: error.message };
    }

    try {
      await BlessERP.realtimeSync?.start?.();
    } catch (error) {
      console.warn("[jaeder-realtime] La conexión en tiempo real se reintentará en segundo plano.", error);
      cloud = { ok: false, mode: "REALTIME_START_ERROR", message: error.message };
    }

    reportSyncContext();
    const incrementalStatus = BlessERP.offlineSync?.status?.() || {};
    const cloudStatus = BlessERP.cloudStateSync?.status?.() || {};
    const serverConfirmed = incrementalStatus.enabled
      ? incrementalStatus.serverReachable
      : (cloudStatus.serverReachable || !cloudStatus.enabled);
    BlessERP.layout.toast(
      cloud.ok && serverConfirmed && v2Health.ok
        ? (auth.mode === "AUTHENTICATED"
          ? "Acceso validado y JAEDER SYSTEMS conectado"
          : auth.mode === "LOCAL_AUTHENTICATED"
            ? "Acceso local validado"
            : auth.mode === "AUTHENTICATED_CACHE"
              ? "JAEDER SYSTEMS listo; permisos verificados en segundo plano"
              : "JAEDER SYSTEMS listo")
        : (v2Health.ok
          ? "JAEDER SYSTEMS está disponible; Supabase continúa sincronizando."
          : "JAEDER SYSTEMS está disponible; un flujo V2 quedó bloqueado por validación del backend.")
    );
    BlessERP.performance?.record?.("arranque:servicios-segundo-plano", backgroundStartedAt, {
      serverConfirmed,
      syncMode: cloud.mode || ""
    });
    return { cloud, serverConfirmed };
  }

  async function boot() {
    try {
      if (await BlessERP.invitePassword?.bootIfNeeded?.()) return;
      setBootStage("REGISTRO_PWA");
      BlessERP.pwa?.register?.();
      setBootStage("VALIDACION_ACCESO");
      const auth = await timeout(
        BlessERP.authAccess?.boot?.() || { ok: true, mode: "LOCAL" },
        35000,
        "La validación de acceso"
      );
      if (!auth.ok) return;

      const currentAuth = () => !auth.access || (BlessERP.authAccess?.activeAccess?.()?.sessionGeneration === auth.access.sessionGeneration
        && BlessERP.authAccess?.activeAccess?.()?.session?.user?.id === auth.access.session?.user?.id);
      setBootStage("CAPABILITIES_SHADOW");
      try {
        const capabilities = await timeout(
          BlessERP.capabilityRuntime?.bootstrap?.() || { loaded: true, effectiveCapabilityCount: 0 },
          10000,
          "La carga del contexto de capabilities"
        );
        if (!currentAuth()) return;
        if (BlessERP.capabilityPolicy?.mode?.hardEnforcement === true && (!capabilities.loaded || capabilities.error || !capabilities.effectiveCapabilityCount)) {
          throw new Error(capabilities.error || "ACCESS_CONFIGURATION_REQUIRED: no se confirmaron permisos operativos.");
        }
      } catch (error) {
        if (!currentAuth()) return;
        if (BlessERP.capabilityPolicy?.mode?.hardEnforcement === true) {
          window.clearTimeout(window.__JAEDER_BOOT_WATCHDOG__);
          BlessERP.authAccess.renderGate({
            title: "No se pudieron cargar los permisos",
            message: /AbortError|operation was aborted/i.test(String(error?.message || error))
              ? "CAPABILITY_BOOTSTRAP_INTERRUPTED: reintente la carga de permisos."
              : String(error?.message || "No se confirmaron permisos operativos."),
            showLogin: false, allowRetry: true, allowSignOut: true
          });
          return;
        }
        // U2C2A observa, pero todavía no autoriza ni bloquea. Un fallo del motor
        // nuevo queda diagnosticado sin sustituir el control legacy vigente.
        console.warn("[jaeder-capabilities-shadow] El control legacy continúa activo.", error);
      }

      setBootStage("CARGA_DATOS");
      let cloud = { ok: true, mode: "LOCAL" };
      try {
        cloud = await timeout(
          BlessERP.cloudStateSync?.hydrate?.(BlessERP.state.state.db)
            || { ok: true, mode: "LOCAL" },
          7000,
          "La carga de datos"
        );
      } catch (error) {
        cloud = { ok: false, mode: "LOAD_TIMEOUT", message: error.message };
      }
      setBootStage("CARGA_MENU");
      try {
        await timeout(BlessERP.menuService.refreshMenuFromProvider(), 8000, "La carga del menú");
      } catch (error) {
      console.warn("[jaeder-boot] Se conserva el menú local", error);
      }
      setBootStage("PREPARACION_NAVEGACION");
      BlessERP.state.refreshNavigationAccess();
      BlessERP.layout.bindNavigation();
      setBootStage("RENDER_RUTA");
      renderAppWithRouteRecovery();
      setBootStage("INTERFAZ_LISTA");
      window.clearTimeout(window.__JAEDER_BOOT_WATCHDOG__);
      BlessERP.performance?.record?.("arranque:interfaz-visible", bootStartedAt, {
        routeId: BlessERP.state?.currentRoute?.()?.id || ""
      });

      BlessERP.authAccess?.startSessionSupervisor?.();
      BlessERP.cloudStateSync?.startSupervisor?.(BlessERP.state.state.db);
      window.addEventListener("erp:cloud-sync-error", event => {
        if (event.detail?.conflict && !BlessERP.getEnvConfig?.().incrementalSyncEnabled) {
          BlessERP.offlineSync?.recordSystemConflict?.(event.detail);
        }
        BlessERP.layout.toast(event.detail?.message || "No se pudo sincronizar con Supabase.");
      });
      setBootStage("COMPLETADO");
      BlessERP.performance?.record?.("arranque:total", bootStartedAt, {
        routeId: BlessERP.state?.currentRoute?.()?.id || ""
      });
      afterFirstPaint(() => {
        window.__JAEDER_BACKGROUND_BOOT__ = startBackgroundServices(auth, cloud)
          .catch(error => console.error("[jaeder-background-boot]", error));
      });
    } catch (error) {
      BlessERP.performance?.record?.(`arranque:error:${bootStage.toLowerCase()}`, bootStageStartedAt);
      renderFatalBootError(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
