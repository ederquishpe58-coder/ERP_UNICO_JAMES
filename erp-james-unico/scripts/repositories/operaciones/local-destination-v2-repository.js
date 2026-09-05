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
    return Boolean(config.supabaseEnabled && config.zebraV2CaptureEnabled && config.warehouseV2CaptureEnabled
      && window.location?.protocol !== "file:");
  }

  function configured() {
    return Boolean(remoteRequired() && typeof BlessERP.getSupabaseClient === "function" && activeCompanyUuid());
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return Boolean(configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS);
  }

  function healthFailure(error, companyId) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || "No se pudo validar Destino de lote V2.").trim();
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok: false, status, companyId, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      health = { status: "NOT_CONFIGURED", companyId, checkedAt: Date.now(), error: null, data: null };
      return { ok: false, status: health.status, companyId, message: "Destino de lote V2 no está habilitado." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };
    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);
    const { data, error } = await client.rpc("erp_destination_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "DESTINATION_LOTS_V2" || result.migration !== "202608160003"
      || result.lotTable !== true || result.zebraCreateDependency !== true || result.zebraReceiveDependency !== true
      || result.warehouseReserveDependency !== true || result.warehouseScanDependency !== true
      || result.createRpc !== true || result.receiveRpc !== true || result.confirmRpc !== true
      || result.reassignRpc !== true || result.availabilityRpc !== true) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend Destino de lote V2 está incompleto o desactualizado." }, companyId);
    }
    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), error: null, data: result };
    return { ok: true, status: health.status, companyId, data: result };
  }

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.() || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
      });
  }

  async function deviceId(operationId) {
    return String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
  }

  async function applyCanonicalRecords(records, source) {
    for (const serverRecord of records) {
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(serverRecord, {
        source, force: true, forceServer: true, ignoreRecordHold: true, ignoreEditGuard: true
      });
      if (applied && applied.ok === false) {
        throw new Error("Supabase confirmó Destino de lote, pero no se pudo actualizar la caché canónica.");
      }
    }
  }

  async function command(rpcName, parameters = {}, options = {}) {
    const companyId = activeCompanyUuid();
    const operationId = String(options.operationId || uuid());
    if (!configured() || !companyId) {
      return { ok: false, mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY", operationId,
        message: remoteRequired() ? "Supabase no está disponible; Destino de lote no fue confirmado."
          : "Destino de lote V2 no se utiliza en el HTML estrictamente local." };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, mode: backend.status || "BACKEND_UNAVAILABLE", operationId,
        error: backend.error, message: backend.message || "Destino de lote V2 no está disponible." };
    }
    console.info("[jaeder-v2-command]", { flow: "DESTINATION_LOTS_V2", rpc: rpcName, operationId, companyId });
    const { data, error } = await BlessERP.getSupabaseClient().rpc(rpcName, {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: await deviceId(operationId),
      ...parameters
    });
    if (error) return { ok: false, mode: "SUPABASE_ERROR", operationId, error, message: error.message || "Supabase rechazó la operación." };
    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) return { ok: false, mode: "INVALID_RESPONSE", operationId, message: "Supabase no confirmó la operación.", result: result?.result || {} };
    try {
      await applyCanonicalRecords(records, options.source || "DESTINATION_LOTS_V2_COMMAND");
    } catch (cacheError) {
      return { ok: false, mode: "CANONICAL_CACHE_ERROR", operationId, message: cacheError?.message || "No se actualizó la caché canónica." };
    }
    return { ok: true, confirmed: true, mode: "SUPABASE_TRANSACTION_CONFIRMED", operationId,
      records, serverTime: String(result.serverTime || ""), result: result.result || {} };
  }

  function createLabels(labels, destination = {}, options = {}) {
    return command("erp_destination_v2_create_labels", {
      p_labels: Array.isArray(labels) ? labels : [],
      p_destination_type: String(destination.type || destination.destinationType || "EXPORT").trim().toUpperCase(),
      p_destination_customer_id: String(destination.customerId || destination.destinationCustomerId || "").trim() || null,
      p_destination_order_id: String(destination.orderId || destination.destinationOrderId || "").trim() || null,
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "DESTINATION_V2_CREATE_LABELS" });
  }

  function receiveBunch(labelCode, payload = {}, options = {}) {
    return command("erp_destination_v2_receive_bunch", {
      p_label_code: String(labelCode || "").trim(), p_payload: payload || {},
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "DESTINATION_V2_RECEIVE_BUNCH" });
  }

  function confirmLocalOrder(orderId, options = {}) {
    return command("erp_destination_v2_confirm_local_order", {
      p_order_id: String(orderId || "").trim(), p_local_created_at: new Date().toISOString()
    }, { ...options, source: "DESTINATION_V2_CONFIRM_LOCAL_ORDER" });
  }

  function reassignBunch(labelCode, target = {}, reason, options = {}) {
    return command("erp_destination_v2_reassign_bunch", {
      p_label_code: String(labelCode || "").trim(),
      p_target_destination_type: String(target.type || target.destinationType || "EXPORT").trim().toUpperCase(),
      p_target_customer_id: String(target.customerId || target.destinationCustomerId || "").trim() || null,
      p_reason: String(reason || "").trim(), p_local_created_at: new Date().toISOString()
    }, { ...options, source: "DESTINATION_V2_REASSIGN_BUNCH" });
  }

  async function availability() {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, rows: [], mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY" };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, rows: [], mode: backend.status || "BACKEND_UNAVAILABLE", message: backend.message };
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_destination_v2_availability", { p_company_id: companyId });
    if (error) return { ok: false, rows: [], mode: "SUPABASE_ERROR", error, message: error.message };
    return { ok: true, rows: Array.isArray(data) ? data : [], mode: "SUPABASE_CONFIRMED" };
  }

  const repository = Object.freeze({
    activeCompanyUuid, availability, canExecute, configured, confirmLocalOrder, createLabels,
    healthStatus: () => ({ ...health, available: canExecute() }), probeBackend, reassignBunch,
    receiveBunch, remoteRequired, uuid
  });
  BlessERP.getLocalDestinationV2Repository = () => repository;
})();
