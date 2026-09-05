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
    return String(
      access?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid
      || ""
    ).trim();
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
    const message = String(error?.message || "No se pudo validar Bodega V2.").trim();
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
      return { ok: false, status: health.status, companyId, message: "Bodega V2 no está habilitada para este despliegue." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };

    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);

    const { data, error } = await client.rpc("erp_warehouse_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok
      || result.component !== "WAREHOUSE_V2"
      || result.migration !== "202608150006"
      || result.reservationTable !== true
      || result.boxSequenceTable !== true
      || result.boxTable !== true
      || result.assignmentTable !== true
      || result.operationsDependency !== true
      || result.zebraDependency !== true
      || result.availabilityRpc !== true
      || result.reserveRpc !== true
      || result.createBoxRpc !== true
      || result.scanRpc !== true
      || result.closeRpc !== true) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend de Bodega V2 está incompleto o desactualizado." }, companyId);
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

  async function applyCanonicalRecords(records, source) {
    for (const serverRecord of records) {
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(serverRecord, {
        source,
        force: true,
        forceServer: true,
        ignoreRecordHold: true,
        ignoreEditGuard: true
      });
      if (applied && applied.ok === false) {
        throw new Error("Supabase confirmó la operación de Cuarto Frío, pero no se pudo actualizar la caché canónica.");
      }
    }
  }

  async function command(rpcName, parameters = {}, options = {}) {
    const operatorCompanyId = activeCompanyUuid();
    const companyId = String(options.sellingCompanyId || operatorCompanyId || "").trim();
    const operationId = String(options.operationId || uuid());
    if (!configured() || !companyId) {
      return {
        ok: false,
        mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY",
        operationId,
        message: remoteRequired()
          ? "Supabase no está disponible; la operación de reserva o empaque no fue confirmada."
          : "El comando remoto de Cuarto Frío no se utiliza en el HTML estrictamente local."
      };
    }

    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return {
        ok: false,
        mode: backend.status || "BACKEND_UNAVAILABLE",
        operationId,
        error: backend.error,
        message: backend.message || "Bodega V2 no está disponible en Supabase. El cambio no fue confirmado."
      };
    }

    console.info("[jaeder-v2-command]", {
      flow: "WAREHOUSE_V2",
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
    if (error) {
      return {
        ok: false,
        mode: "SUPABASE_ERROR",
        operationId,
        error,
        message: error.message || "Supabase rechazó la operación de Cuarto Frío."
      };
    }

    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) {
      return {
        ok: false,
        mode: "INVALID_RESPONSE",
        operationId,
        message: result?.message || "Supabase no confirmó la operación de Cuarto Frío.",
        result: result?.result || {}
      };
    }

    try {
      await applyCanonicalRecords(records, options.source || "WAREHOUSE_V2_COMMAND");
    } catch (cacheError) {
      return {
        ok: false,
        mode: "CANONICAL_CACHE_ERROR",
        operationId,
        message: cacheError?.message || "No se pudo actualizar la caché canónica de Cuarto Frío."
      };
    }

    return {
      ok: true,
      confirmed: true,
      mode: "SUPABASE_TRANSACTION_CONFIRMED",
      operationId,
      records,
      serverTime: String(result.serverTime || ""),
      result: result.result || {}
    };
  }

  function reserveOrder(orderId, options = {}) {
    return command("erp_warehouse_v2_reserve_order", {
      p_order_id: String(orderId || "").trim(),
      p_allow_partial: options.allowPartial !== false,
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_RESERVE" });
  }

  function releaseOrder(orderId, reason, options = {}) {
    return command("erp_warehouse_v2_release_order", {
      p_order_id: String(orderId || "").trim(),
      p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_RELEASE" });
  }

  function cancelOrder(orderId, reason, options = {}) {
    return command("erp_warehouse_v2_cancel_order", {
      p_order_id: String(orderId || "").trim(),
      p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_CANCEL" });
  }

  function createBox(orderId, payload = {}, options = {}) {
    return command("erp_warehouse_v2_create_box", {
      p_order_id: String(orderId || "").trim(),
      p_box_number: Number(payload.boxNumber || payload.box_number || 0),
      p_box_type: String(payload.boxType || payload.box_type || "").trim(),
      p_capacity_bunches: Number(payload.capacityBunches || payload.capacity_bunches || 0),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_CREATE_BOX" });
  }

  function scanIntoBox(orderId, boxNumber, labelCode, options = {}) {
    return command("erp_warehouse_v2_scan_into_box", {
      p_order_id: String(orderId || "").trim(),
      p_box_number: Number(boxNumber || 0),
      p_label_code: String(labelCode || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_SCAN_PACK" });
  }

  function unassignBunch(orderId, labelCode, reason, options = {}) {
    return command("erp_warehouse_v2_unassign_bunch", {
      p_order_id: String(orderId || "").trim(),
      p_label_code: String(labelCode || "").trim(),
      p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_UNASSIGN" });
  }

  function closeBox(orderId, boxNumber, options = {}) {
    return command("erp_warehouse_v2_close_box", {
      p_order_id: String(orderId || "").trim(),
      p_box_number: Number(boxNumber || 0),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_CLOSE_BOX" });
  }

  function reopenBox(orderId, boxNumber, reason, options = {}) {
    return command("erp_warehouse_v2_reopen_box", {
      p_order_id: String(orderId || "").trim(),
      p_box_number: Number(boxNumber || 0),
      p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "WAREHOUSE_V2_REOPEN_BOX" });
  }

  async function availability() {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      return { ok: false, rows: [], mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY" };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, rows: [], mode: backend.status || "BACKEND_UNAVAILABLE", error: backend.error, message: backend.message };
    }
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_warehouse_v2_availability", {
      p_company_id: companyId
    });
    if (error) return { ok: false, rows: [], mode: "SUPABASE_ERROR", error, message: error.message };
    return { ok: true, rows: Array.isArray(data) ? data : [], mode: "SUPABASE_CONFIRMED" };
  }

  async function coldRoomOrders() {
    const poolCompanyId = activeCompanyUuid();
    if (!configured() || !poolCompanyId) return { ok: false, rows: [], mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY" };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, rows: [], mode: backend.status || "BACKEND_UNAVAILABLE", error: backend.error, message: backend.message };
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_warehouse_v2_cold_room_orders", {
      p_inventory_pool_company_id: poolCompanyId
    });
    if (error) return { ok: false, rows: [], mode: "SUPABASE_ERROR", error, message: error.message };
    return { ok: true, rows: Array.isArray(data) ? data : [], mode: "SUPABASE_CONFIRMED" };
  }

  async function labelContext(sellingCompanyId, labelCode) {
    const poolCompanyId = activeCompanyUuid();
    if (!configured() || !poolCompanyId) return { ok: false, mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY" };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, mode: backend.status || "BACKEND_UNAVAILABLE", error: backend.error, message: backend.message };
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_warehouse_v2_label_context", {
      p_selling_company_id: String(sellingCompanyId || "").trim(),
      p_label_code: String(labelCode || "").trim()
    });
    if (error) return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message };
    return { ok: true, row: Array.isArray(data) ? data[0] : data, mode: "SUPABASE_CONFIRMED" };
  }

  const repository = Object.freeze({
    activeCompanyUuid,
    availability,
    coldRoomOrders,
    canExecute,
    cancelOrder,
    closeBox,
    configured,
    createBox,
    releaseOrder,
    remoteRequired,
    reopenBox,
    reserveOrder,
    scanIntoBox,
    unassignBunch,
    uuid,
    healthStatus,
    labelContext,
    probeBackend
  });

  BlessERP.getWarehouseV2Repository = function() {
    return repository;
  };
})();
