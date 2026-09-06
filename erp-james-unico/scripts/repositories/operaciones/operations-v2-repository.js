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
      && config.operationsSupabaseEnabled
      && window.location?.protocol !== "file:"
    );
  }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(
      config.supabaseEnabled
      && config.operationsSupabaseEnabled
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
    const message = String(error?.message || "No se pudo validar Operaciones V2.").trim();
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
      return { ok: false, status: health.status, companyId, message: "Operaciones V2 no está habilitado para este despliegue." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };

    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);

    const { data, error } = await client.rpc("erp_operations_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok
      || result.component !== "OPERATIONS_V2"
      || result.migration !== "202608150004"
      || result.commandsTable !== true
      || result.executeRpc !== true
      || result.stockRpc !== true) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend de Operaciones V2 está incompleto o desactualizado." }, companyId);
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

  async function classificationContext(assignmentId = "") {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) throw new Error("OPERATIONS_CANONICAL_CONTEXT_REQUIRED");
    const recordIds = ["operations_yield_workday", String(assignmentId || "").trim()].filter(Boolean);
    const { data, error } = await BlessERP.getSupabaseClient().from("erp_entity_records")
      .select("company_id,entity,record_id,payload,version,updated_at,deleted_at")
      .eq("company_id", companyId).in("entity", ["operations_yield_workday", "operations_classifier_assignments"])
      .in("record_id", recordIds).is("deleted_at", null);
    if (companyId !== activeCompanyUuid()) throw new Error("OPERATIONS_COMPANY_CHANGED: vuelva a abrir la entrega en la empresa actual.");
    if (error) throw new Error(error.message || "OPERATIONS_CANONICAL_CONTEXT_UNAVAILABLE");
    if (!Array.isArray(data) || data.some(row => row.company_id !== companyId || row.deleted_at || Number(row.version || 0) < 1 || !row.payload)) throw new Error("OPERATIONS_CANONICAL_CONTEXT_INVALID");
    const days = data.filter(row => row.entity === "operations_yield_workday" && row.record_id === "operations_yield_workday");
    const workday = days[0]?.payload;
    if (days.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workday?.id || "") || String(workday.status).toUpperCase() !== "ACTIVA" || workday.endedAt) throw new Error("OPERATIONS_ACTIVE_WORKDAY_REQUIRED: inicie o reanude la jornada canónica.");
    const assignments = data.filter(row => row.entity === "operations_classifier_assignments" && row.record_id === assignmentId);
    const assignment = assignments[0] || null;
    if (assignmentId && assignments.length !== 1) throw new Error("OPERATIONS_CLASSIFICATION_ASSIGNMENT_NOT_FOUND:" + assignmentId);
    if (assignment && assignment.payload.workdayId !== workday.id) throw new Error("OPERATIONS_COMMAND_WORKDAY_MISMATCH: entrega " + assignmentId + " / jornada " + (assignment.payload.workdayId || "sin jornada") + "; jornada activa " + workday.id + ". No se puede clasificar esta entrega en otra jornada.");
    return { companyId, workday: { ...workday, __syncVersion: days[0].version }, assignment };
  }

  async function execute(command, payload = {}, options = {}) {
    const companyId = activeCompanyUuid();
    const operationId = String(options.operationId || uuid());
    const classification = ["ASSIGN_CLASSIFICATION", "REGISTER_CLASSIFICATION_RESULT"].includes(String(command).toUpperCase());
    if (classification && options.companyId && options.companyId !== companyId) return { ok: false, message: "OPERATIONS_COMPANY_CHANGED" };
    if (!configured() || !companyId) {
      return {
        ok: false,
        mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY",
        operationId,
        message: remoteRequired()
          ? "Supabase no está disponible; la operación no fue confirmada."
          : "El comando remoto no se utiliza en el HTML estrictamente local."
      };
    }

    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return {
        ok: false,
        mode: backend.status || "BACKEND_UNAVAILABLE",
        operationId,
        error: backend.error,
        message: backend.message || "Operaciones V2 no está disponible en Supabase. El cambio no fue confirmado."
      };
    }

    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
    if (classification && companyId !== activeCompanyUuid()) return { ok: false, message: "OPERATIONS_COMPANY_CHANGED" };
    console.info("[jaeder-v2-command]", {
      flow: "OPERATIONS_V2",
      rpc: "erp_execute_operations_v2",
      command: String(command || "").trim().toUpperCase(),
      operationId,
      companyId
    });
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_execute_operations_v2", {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: deviceId,
      p_command: String(command || "").trim().toUpperCase(),
      p_payload: payload && typeof payload === "object" ? payload : {},
      p_local_created_at: new Date().toISOString()
    });
    if (classification && companyId !== activeCompanyUuid()) return { ok: false, message: "OPERATIONS_COMPANY_CHANGED: consulte la empresa de origen antes de reintentar." };
    if (error) {
      return {
        ok: false,
        mode: "SUPABASE_ERROR",
        operationId,
        error,
        message: error.message || "Supabase rechazó la operación de Poscosecha."
      };
    }

    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok || !records.length) {
      return {
        ok: false,
        mode: "INVALID_RESPONSE",
        operationId,
        message: result?.message || "Supabase no devolvió registros canónicos para la operación."
      };
    }

    if (classification) {
      const expected = command === "REGISTER_CLASSIFICATION_RESULT" ? "operations_classification_results" : "operations_classifier_assignments";
      const expectedIds = command === "REGISTER_CLASSIFICATION_RESULT" ? [payload.resultId] : payload.assignmentIds || [];
      if (!expectedIds.length || expectedIds.some(id => !records.some(row => row.entity === expected && row.record_id === id && row.payload?.workdayId === payload.workdayId)) || records.some(row => row.company_id !== companyId || row.deleted_at || !row.payload || Number(row.version || 0) < 1)) return { ok: false, message: "OPERATIONS_CANONICAL_CONFIRMATION_REQUIRED" };
    }
    for (const serverRecord of records) {
      if (classification && companyId !== activeCompanyUuid()) return { ok: false, message: "OPERATIONS_COMPANY_CHANGED" };
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(serverRecord, {
        source: "OPERATIONS_V2_COMMAND",
        force: true,
        forceServer: true,
        ignoreRecordHold: true,
        ignoreEditGuard: true
      });
      if (applied && applied.ok === false) {
        return {
          ok: false,
          mode: "CANONICAL_CACHE_ERROR",
          operationId,
          message: "Supabase confirmó la operación, pero no se pudo actualizar la caché local. Recargue el módulo."
        };
      }
    }

    return {
      ok: true,
      confirmed: true,
      mode: "SUPABASE_TRANSACTION_CONFIRMED",
      operationId,
      records,
      serverTime: String(result.serverTime || ""),
      command: String(result.command || command || ""),
      result: result.result || {}
    };
  }

  const repository = Object.freeze({
    activeCompanyUuid,
    classificationContext,
    canExecute,
    execute,
    healthStatus,
    probeBackend,
    remoteRequired
  });

  BlessERP.getOperationsV2Repository = function() {
    return repository;
  };
})();
