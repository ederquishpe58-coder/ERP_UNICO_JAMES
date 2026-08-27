(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let health = {
    status: "UNKNOWN",
    companyId: "",
    checkedAt: 0,
    error: null,
    data: null
  };

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(access?.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }

  function remoteRequired() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(
      config.supabaseEnabled
      && config.commercialOrdersSupabaseEnabled
      && config.operationsSupabaseEnabled
      && config.scannerSupabaseEnabled
      && window.location?.protocol !== "file:"
    );
  }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(
      config.supabaseEnabled
      && config.commercialOrdersSupabaseEnabled
      && config.operationsSupabaseEnabled
      && config.scannerSupabaseEnabled
      && typeof BlessERP.getSupabaseClient === "function"
      && activeCompanyUuid()
      && window.location?.protocol !== "file:"
    );
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return Boolean(
      configured()
      && health.status === "VERIFIED"
      && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS
    );
  }

  function healthStatus() {
    return { ...health, available: canExecute() };
  }

  function healthFailure(error, companyId) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || "No se pudo validar Despacho V2.").trim();
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING"
      : code === "42501"
        ? "PERMISSION_DENIED"
        : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok: false, status, companyId, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      health = { status: "NOT_CONFIGURED", companyId, checkedAt: Date.now(), error: null, data: null };
      return { ok: false, status: health.status, companyId, message: "Despacho V2 no está habilitado para este despliegue." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };

    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);

    const { data, error } = await client.rpc("erp_dispatch_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok
      || result.component !== "DISPATCH_V2"
      || result.migration !== "202608150007"
      || result.sequenceTable !== true
      || result.dispatchTable !== true
      || result.operationsDependency !== true
      || result.warehouseDependency !== true
      || result.inventoryStockDependency !== true
      || result.validateRpc !== true
      || result.markReadyRpc !== true
      || result.confirmRpc !== true
      || result.directConfirmReady !== true) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend de Despacho V2 está incompleto o desactualizado." }, companyId);
    }

    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), error: null, data: result };
    return { ok: true, status: health.status, companyId, data: result };
  }

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.()
      || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
      });
  }

  async function deviceId(operationId) {
    return String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
  }

  async function applyCanonical(records, source) {
    for (const record of records) {
      const result = await BlessERP.offlineSync?.applyRemoteRecord?.(record, {
        source, force: true, forceServer: true, ignoreRecordHold: true, ignoreEditGuard: true
      });
      if (result && result.ok === false) throw new Error("Supabase confirmó el despacho, pero no se pudo actualizar la caché canónica.");
    }
  }

  async function command(rpcName, parameters, options = {}) {
    const companyId = activeCompanyUuid();
    const operationId = String(options.operationId || uuid());
    if (!configured() || !companyId) {
      return {
        ok: false,
        mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY",
        operationId,
        message: remoteRequired()
          ? "Sin conexión confirmada con Supabase. El despacho definitivo no fue realizado."
          : "El despacho definitivo V2 no se confirma en el HTML estrictamente local."
      };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return {
        ok: false,
        mode: backend.status || "BACKEND_UNAVAILABLE",
        operationId,
        error: backend.error,
        message: backend.message || "Despacho V2 no está disponible en Supabase. La salida no fue confirmada."
      };
    }
    console.info("[jaeder-v2-command]", {
      flow: "DISPATCH_V2",
      rpc: rpcName,
      operationId,
      companyId
    });
    const { data, error } = await BlessERP.getSupabaseClient().rpc(rpcName, {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: await deviceId(operationId),
      ...parameters
    });
    if (error) return { ok: false, mode: "SUPABASE_ERROR", operationId, error, message: error.message || "Supabase rechazó el despacho." };
    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) return { ok: false, mode: "INVALID_RESPONSE", operationId, message: result?.message || "Supabase no confirmó el despacho." };
    try {
      await applyCanonical(records, options.source || "DISPATCH_V2_COMMAND");
    } catch (error) {
      return { ok: false, mode: "CANONICAL_CACHE_ERROR", operationId, message: error.message };
    }
    return { ok: true, confirmed: true, mode: "SUPABASE_TRANSACTION_CONFIRMED", operationId,
      records, serverTime: String(result.serverTime || ""), result: result.result || {} };
  }

  async function validateReady(orderId) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, ready: false, mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY" };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, ready: false, mode: backend.status || "BACKEND_UNAVAILABLE", error: backend.error, message: backend.message };
    }
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_dispatch_v2_validate_ready", {
      p_company_id: companyId, p_order_id: String(orderId || "").trim(), p_lock: false
    });
    if (error) return { ok: false, ready: false, mode: "SUPABASE_ERROR", error, message: error.message };
    return { ok: true, ready: Boolean(data?.ok), validation: data || {} };
  }

  function markReady(orderId, options = {}) {
    return command("erp_dispatch_v2_mark_ready", {
      p_order_id: String(orderId || "").trim(), p_local_created_at: new Date().toISOString()
    }, { ...options, source: "DISPATCH_V2_READY" });
  }

  function confirmDispatch(orderId, payload = {}, options = {}) {
    return command("erp_dispatch_v2_confirm", {
      p_order_id: String(orderId || "").trim(),
      p_logistics: payload.logistics && typeof payload.logistics === "object" ? payload.logistics : {},
      p_observations: String(payload.observations || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "DISPATCH_V2_CONFIRM" });
  }

  const repository = Object.freeze({
    activeCompanyUuid,
    canExecute,
    confirmDispatch,
    healthStatus,
    markReady,
    probeBackend,
    remoteRequired,
    uuid,
    validateReady
  });
  BlessERP.getDispatchV2Repository = function() { return repository; };
})();
