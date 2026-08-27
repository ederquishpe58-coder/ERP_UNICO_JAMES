(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, error: null, data: null };

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(access?.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }

  function remoteRequired() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.exportV2CaptureEnabled === true
      && window.location?.protocol !== "file:");
  }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.exportV2CaptureEnabled === true
      && config.commercialOrdersSupabaseEnabled && config.operationsSupabaseEnabled
      && typeof BlessERP.getSupabaseClient === "function" && activeCompanyUuid()
      && window.location?.protocol !== "file:");
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return Boolean(configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS);
  }

  function healthStatus() {
    return { ...health, available: canExecute() };
  }

  function healthFailure(error, companyId) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || "No se pudo validar Exportación V2.").trim();
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok: false, status, companyId, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      health = { status: "NOT_CONFIGURED", companyId, checkedAt: Date.now(), error: null, data: null };
      return { ok: false, status: health.status, companyId, message: "Exportación V2 no está habilitada para este despliegue." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };
    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);
    const { data, error } = await client.rpc("erp_export_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "EXPORT_V2" || result.migration !== "202608150008"
      || result.sequenceTable !== true || result.shipmentTable !== true || result.orderLinksTable !== true
      || result.dispatchLinksTable !== true || result.boxLinksTable !== true || result.documentsTable !== true
      || result.flightHistoryTable !== true || result.eventsTable !== true || result.operationsDependency !== true
      || result.dispatchDependency !== true || result.createRpc !== true || result.updateRpc !== true
      || result.transitionRpc !== true) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend de Exportación V2 está incompleto o desactualizado." }, companyId);
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
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(record, {
        source, force: true, forceServer: true, ignoreRecordHold: true, ignoreEditGuard: true
      });
      if (applied && applied.ok === false) {
        throw new Error("Supabase confirmó el expediente, pero no se pudo actualizar la caché canónica.");
      }
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
          ? "Sin conexión confirmada con Supabase. La operación de exportación no fue confirmada."
          : "Exportación V2 no se confirma en el HTML estrictamente local."
      };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, mode: backend.status || "BACKEND_UNAVAILABLE", operationId,
        error: backend.error, message: backend.message || "Exportación V2 no está disponible en Supabase." };
    }
    console.info("[jaeder-v2-command]", { flow: "EXPORT_V2", rpc: rpcName, operationId, companyId });
    const { data, error } = await BlessERP.getSupabaseClient().rpc(rpcName, {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: await deviceId(operationId),
      ...parameters
    });
    if (error) return { ok: false, mode: "SUPABASE_ERROR", operationId, error,
      message: error.message || "Supabase rechazó la operación de exportación." };
    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) return { ok: false, mode: "INVALID_RESPONSE", operationId,
      message: result?.message || "Supabase no confirmó la operación de exportación." };
    try {
      await applyCanonical(records, options.source || "EXPORT_V2_COMMAND");
    } catch (error) {
      return { ok: false, mode: "CANONICAL_CACHE_ERROR", operationId, message: error.message };
    }
    return { ok: true, confirmed: true, mode: "SUPABASE_TRANSACTION_CONFIRMED", operationId,
      records, serverTime: String(result.serverTime || ""), result: result.result || {} };
  }

  function createShipment(payload = {}, options = {}) {
    return command("erp_export_v2_create", {
      p_order_ids: [...new Set((payload.orderIds || []).map(String).filter(Boolean))],
      p_dispatch_ids: [...new Set((payload.dispatchIds || []).map(String).filter(Boolean))],
      p_required_document_types: [...new Set((payload.requiredDocumentTypes || []).map(value => String(value).trim().toUpperCase()).filter(Boolean))],
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "EXPORT_V2_CREATE" });
  }

  function updateLogistics(shipmentId, payload = {}, options = {}) {
    return command("erp_export_v2_update_logistics", {
      p_shipment_id: String(shipmentId || "").trim(),
      p_payload: payload && typeof payload === "object" ? payload : {},
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "EXPORT_V2_LOGISTICS" });
  }

  function transition(shipmentId, action, payload = {}, options = {}) {
    return command("erp_export_v2_transition", {
      p_shipment_id: String(shipmentId || "").trim(),
      p_action: String(action || "").trim().toUpperCase(),
      p_payload: payload && typeof payload === "object" ? payload : {},
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: `EXPORT_V2_${String(action || "TRANSITION").toUpperCase()}` });
  }

  const repository = Object.freeze({
    activeCompanyUuid,
    canExecute,
    closeShipment: (shipmentId, options = {}) => transition(shipmentId, "CLOSE", {}, options),
    createShipment,
    deliverToCargo: (shipmentId, payload = {}, options = {}) => transition(shipmentId, "DELIVER_TO_CARGO", payload, options),
    markArrived: (shipmentId, options = {}) => transition(shipmentId, "ARRIVE", {}, options),
    markBooked: (shipmentId, options = {}) => transition(shipmentId, "BOOK", {}, options),
    markDeparted: (shipmentId, options = {}) => transition(shipmentId, "DEPART", {}, options),
    healthStatus,
    probeBackend,
    remoteRequired,
    reopenShipment: (shipmentId, reason, options = {}) => transition(shipmentId, "REOPEN", { reason: String(reason || "").trim() }, options),
    transition,
    updateLogistics,
    uuid
  });

  BlessERP.getExportShipmentV2Repository = function() { return repository; };
})();
