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
      && config.scannerSupabaseEnabled
      && window.location?.protocol !== "file:"
    );
  }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(
      config.supabaseEnabled
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
    const message = String(error?.message || "No se pudo validar Zebra V2.").trim();
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
      return { ok: false, status: health.status, companyId, message: "Zebra V2 no está habilitado para este despliegue." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };

    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);

    const { data, error } = await client.rpc("erp_zebra_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok
      || result.component !== "ZEBRA_V2"
      || result.migration !== "202608150005"
      || result.sequenceTable !== true
      || result.registryTable !== true
      || result.operationsDependency !== true
      || result.createRpc !== true
      || result.reprintRpc !== true
      || result.receiveRpc !== true
      || result.availabilityRpc !== true) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend Zebra V2 está incompleto o desactualizado." }, companyId);
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
        throw new Error("Supabase confirmó la operación Zebra, pero no se pudo actualizar la caché local.");
      }
    }
  }

  async function rpc(name, parameters, options = {}) {
    const companyId = activeCompanyUuid();
    const operationId = String(options.operationId || uuid());
    if (!configured() || !companyId) {
      return {
        ok: false,
        mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY",
        operationId,
        message: remoteRequired()
          ? "Supabase no está disponible; la operación Zebra no fue confirmada."
          : "El comando Zebra remoto no se utiliza en el HTML estrictamente local."
      };
    }

    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return {
        ok: false,
        mode: backend.status || "BACKEND_UNAVAILABLE",
        operationId,
        error: backend.error,
        message: backend.message || "Zebra V2 no está disponible en Supabase. El cambio no fue confirmado."
      };
    }

    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
    console.info("[jaeder-v2-command]", {
      flow: "ZEBRA_V2",
      rpc: name,
      operationId,
      companyId
    });
    const { data, error } = await BlessERP.getSupabaseClient().rpc(name, {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: deviceId,
      ...parameters
    });
    if (error) {
      return {
        ok: false,
        mode: "SUPABASE_ERROR",
        operationId,
        error,
        message: error.message || "Supabase rechazó la operación Zebra."
      };
    }

    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) {
      return {
        ok: false,
        mode: "INVALID_RESPONSE",
        operationId,
        message: result?.message || "Supabase no confirmó la operación Zebra.",
        result: result?.result || {}
      };
    }

    try {
      await applyCanonicalRecords(records, options.source || "ZEBRA_V2_COMMAND");
    } catch (error_) {
      return {
        ok: false,
        mode: "CANONICAL_CACHE_ERROR",
        operationId,
        message: error_?.message || "No se pudo actualizar la caché canónica de Zebra."
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

  function createLabels(labels, options = {}) {
    return rpc("erp_zebra_v2_create_labels", {
      p_labels: Array.isArray(labels) ? labels : [],
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "ZEBRA_V2_CREATE" });
  }

  function reprintLabel(labelCode, outputType, options = {}) {
    return rpc("erp_zebra_v2_reprint_label", {
      p_label_code: String(labelCode || "").trim(),
      p_output_type: String(outputType || "ZEBRA").trim().toUpperCase(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "ZEBRA_V2_REPRINT" });
  }

  function receiveBunch(labelCode, payload = {}, options = {}) {
    return rpc("erp_zebra_v2_receive_bunch", {
      p_label_code: String(labelCode || "").trim(),
      p_payload: payload && typeof payload === "object" ? payload : {},
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "ZEBRA_V2_RECEIPT" });
  }

  function nextEcuadorDate(dateText) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || "").trim());
    if (!match) return "";
    const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
    return next.toISOString().slice(0, 10);
  }

  async function listBunchEntryHistory(filters = {}) {
    const companyId = activeCompanyUuid();
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = [25, 50].includes(Number(filters.pageSize)) ? Number(filters.pageSize) : 25;
    const from = String(filters.from || "").trim();
    const to = String(filters.to || "").trim();
    const nextTo = nextEcuadorDate(to);
    if (!configured() || !companyId) {
      return { ok: false, rows: [], total: 0, page, pageSize, mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY", message: "Supabase no está disponible para consultar el historial Zebra." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !nextTo || from > to) {
      return { ok: false, rows: [], total: 0, page, pageSize, mode: "INVALID_RANGE", message: "Seleccione un rango de fechas válido." };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, rows: [], total: 0, page, pageSize, mode: backend.status || "BACKEND_UNAVAILABLE", error: backend.error, message: backend.message || "Zebra V2 no está disponible." };
    }

    const offset = (page - 1) * pageSize;
    let query = BlessERP.getSupabaseClient()
      .from("erp_entity_records")
      .select("record_id,payload,version,created_at,updated_at", { count: "exact" })
      .eq("company_id", companyId)
      .eq("entity", "operations_bunch_entries")
      .is("deleted_at", null)
      .gte("created_at", `${from}T00:00:00-05:00`)
      .lt("created_at", `${nextTo}T00:00:00-05:00`);

    const textFilters = [
      ["code", "code"],
      ["supplier", "supplier"],
      ["variety", "variety"]
    ];
    textFilters.forEach(([inputName, payloadField]) => {
      const value = String(filters[inputName] || "").trim();
      const safeValue = value.replace(/[%_,]/g, "");
      if (safeValue) query = query.filter(`payload->>${payloadField}`, "ilike", `%${safeValue}%`);
    });
    const measure = String(filters.measure || "").replace(/[^0-9.]/g, "").trim();
    if (measure) query = query.filter("payload->>length", "eq", measure);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) {
      return { ok: false, rows: [], total: 0, page, pageSize, mode: "SUPABASE_ERROR", error, message: error.message || "No se pudo consultar el historial Zebra." };
    }
    const rows = (Array.isArray(data) ? data : []).map(record => ({
      ...(record.payload && typeof record.payload === "object" ? record.payload : {}),
      recordId: String(record.record_id || ""),
      version: Number(record.version || 0),
      canonicalCreatedAt: String(record.created_at || ""),
      canonicalUpdatedAt: String(record.updated_at || "")
    }));
    return { ok: true, rows, total: Number(count || 0), page, pageSize, mode: "SUPABASE_CONFIRMED" };
  }

  async function availability() {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, rows: [], mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY" };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, rows: [], mode: backend.status || "BACKEND_UNAVAILABLE", error: backend.error, message: backend.message };
    }
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_zebra_v2_availability", {
      p_company_id: companyId
    });
    if (error) return { ok: false, rows: [], mode: "SUPABASE_ERROR", error, message: error.message };
    return { ok: true, rows: Array.isArray(data) ? data : [], mode: "SUPABASE_CONFIRMED" };
  }

  const repository = Object.freeze({
    availability,
    canExecute,
    createLabels,
    healthStatus,
    listBunchEntryHistory,
    probeBackend,
    receiveBunch,
    remoteRequired,
    reprintLabel,
    uuid
  });

  BlessERP.getZebraV2Repository = function() {
    return repository;
  };
})();
