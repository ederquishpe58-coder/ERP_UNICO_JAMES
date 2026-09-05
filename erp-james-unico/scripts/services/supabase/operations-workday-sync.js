(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const ENTITY = "operations_yield_workday";
  const HISTORY_ENTITY = "operations_yield_workday_history";
  const RECORD_ID = ENTITY;

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(
      access?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid
      || ""
    ).trim();
  }

  function isEnabled() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(
      config.supabaseEnabled
      && config.authEnabled
      && config.operationsSupabaseEnabled
      && activeCompanyUuid()
      && BlessERP.getSupabaseClient?.()
      && window.location?.protocol !== "file:"
    );
  }

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.()
      || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
      });
  }

  function serializable(entity, value) {
    return BlessERP.syncEntityRegistry?.serializableRecord?.(value || {}, entity)
      || JSON.parse(JSON.stringify(value || {}));
  }

  async function fetchRecord(entity, recordId) {
    const companyId = activeCompanyUuid();
    if (!isEnabled() || !companyId) throw new Error("La jornada canónica requiere una sesión Supabase y una empresa activa.");
    const { data, error } = await BlessERP.getSupabaseClient()
      .from("erp_entity_records")
      .select("id,company_id,entity,record_id,payload,version,created_at,updated_at,created_by,updated_by,device_id,last_operation_id,deleted_at")
      .eq("company_id", companyId)
      .eq("entity", entity)
      .eq("record_id", recordId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function applyCanonicalRecord(serverRecord, source) {
    if (!serverRecord) return null;
    const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(serverRecord, {
      source,
      force: true,
      forceServer: true,
      ignoreRecordHold: true,
      ignoreEditGuard: true
    });
    if (applied && applied.ok === false) {
      throw new Error("Supabase confirmó la jornada, pero no se pudo hidratar la caché canónica.");
    }
    return {
      ...serializable(serverRecord.entity, serverRecord.payload),
      __syncVersion: Number(serverRecord.version || 1),
      __syncUpdatedAt: String(serverRecord.updated_at || ""),
      __syncUpdatedBy: String(serverRecord.updated_by || ""),
      __syncDeviceId: String(serverRecord.device_id || ""),
      __syncOperationId: String(serverRecord.last_operation_id || "")
    };
  }

  function clearMissingSingleton() {
    const operations = BlessERP.state?.state?.db?.operations;
    if (!operations) return;
    operations.yieldWorkday = BlessERP.operacionesData?.createYieldWorkday?.() || null;
    BlessERP.state?.saveDbLocalOnly?.();
  }

  async function hydrate() {
    if (!isEnabled()) return { ok: false, confirmed: false, mode: "REMOTE_REQUIRED", message: "La jornada canónica no está disponible." };
    try {
      const serverRecord = await fetchRecord(ENTITY, RECORD_ID);
      if (!serverRecord) {
        clearMissingSingleton();
        return { ok: true, confirmed: true, mode: "SUPABASE_EMPTY", workday: null, serverRecord: null };
      }
      const workday = await applyCanonicalRecord(serverRecord, "WORKDAY_CANONICAL_HYDRATION");
      return { ok: true, confirmed: true, mode: "SUPABASE_CANONICAL", workday, serverRecord };
    } catch (error) {
      return { ok: false, confirmed: false, mode: "SUPABASE_ERROR", error, message: error?.message || String(error) };
    }
  }

  async function persistEntity(entity, recordId, value) {
    const companyId = activeCompanyUuid();
    if (!isEnabled() || !companyId) {
      return { ok: false, confirmed: false, mode: "REMOTE_REQUIRED", message: "Supabase debe confirmar la jornada antes de actualizar la UI." };
    }
    try {
      const current = await fetchRecord(entity, recordId);
      const payload = serializable(entity, value);
      const basePayload = current?.payload || {};
      const operationId = uuid();
      const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
      const fieldChanges = BlessERP.offlineSync?.buildOperationFieldChanges?.(entity, basePayload, payload) || [];
      const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_apply_offline_operation", {
        p_operation_id: operationId,
        p_company_id: companyId,
        p_device_id: deviceId,
        p_entity: entity,
        p_action: current ? "UPDATE" : "INSERT",
        p_record_id: recordId,
        p_payload: payload,
        p_base_payload: basePayload,
        p_field_changes: fieldChanges,
        p_base_version: Math.max(0, Number(current?.version || 0)),
        p_local_created_at: new Date().toISOString()
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.conflict === true || String(result?.status || "").toUpperCase() === "CONFLICT") {
        return { ok: false, confirmed: false, mode: "VERSION_CONFLICT", operationId, message: "La jornada cambió en otra sesión. Recargue y vuelva a intentar." };
      }
      const serverRecord = result?.server_record || await fetchRecord(entity, recordId);
      if (!serverRecord) throw new Error("Supabase confirmó la operación sin devolver la jornada canónica.");
      const record = await applyCanonicalRecord(serverRecord, "WORKDAY_SERVER_CONFIRMATION");
      return { ok: true, confirmed: true, mode: "SUPABASE_TRANSACTION_CONFIRMED", operationId, record, serverRecord };
    } catch (error) {
      return { ok: false, confirmed: false, mode: "SUPABASE_ERROR", error, message: error?.message || String(error) };
    }
  }

  async function persist(workday) {
    const result = await persistEntity(ENTITY, RECORD_ID, workday);
    return { ...result, workday: result.record || null };
  }

  async function persistHistory(workday) {
    const recordId = String(workday?.id || "").trim();
    if (!recordId) return { ok: false, confirmed: false, mode: "INVALID_HISTORY", message: "La jornada finalizada no tiene UUID." };
    const result = await persistEntity(HISTORY_ENTITY, recordId, workday);
    return { ...result, workday: result.record || null };
  }

  BlessERP.operationsWorkdayCloudSync = Object.freeze({
    canonicalEntity: ENTITY,
    hydrate,
    isEnabled,
    persist,
    persistHistory,
    sync: persist
  });
})();
