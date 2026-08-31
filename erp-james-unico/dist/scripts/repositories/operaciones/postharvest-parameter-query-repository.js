(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const TYPES = Object.freeze({
    suppliers: Object.freeze({ entity: "operations_suppliers", label: "Fincas / Bloques", codePrefix: "FIN", recordPrefix: "FARM" }),
    classifiers: Object.freeze({ entity: "operations_classifiers", label: "Clasificadores", codePrefix: "CLA", person: true }),
    bunchers: Object.freeze({ entity: "operations_bunchers", label: "Embonchadores", codePrefix: "EMB", person: true }),
    receptionists: Object.freeze({ entity: "operations_receptionists", label: "Recepcionistas", codePrefix: "REC", person: true }),
    digitizers: Object.freeze({ entity: "operations_digitizers", label: "Digitadores", codePrefix: "DIG", person: true }),
    scanners: Object.freeze({ entity: "operations_scanners", label: "Responsables de escaneo", codePrefix: "ESC", person: true }),
    responsibles: Object.freeze({ entity: "operations_responsibles", label: "Responsables de despacho", codePrefix: "RSP", person: true }),
    varieties: Object.freeze({ entity: "operations_varieties", label: "Variedades", codePrefix: "VAR", recordPrefix: "VAR" }),
    lengths: Object.freeze({ entity: "operations_lengths", label: "Medidas", codePrefix: "LON", recordPrefix: "LENGTH" }),
    stemTypes: Object.freeze({ entity: "operations_stem_types", label: "Tipos de tallo", codePrefix: "TAL", recordPrefix: "STEM" }),
    labelTypes: Object.freeze({ entity: "operations_label_types", label: "Tipos de etiqueta", codePrefix: "ETQ", recordPrefix: "LABEL" })
  });
  const TYPE_BY_ENTITY = new Map(Object.entries(TYPES).map(([type, config]) => [config.entity, type]));
  const CANONICAL_EDIT_TYPES = new Set(Object.keys(TYPES));
  const RECORD_SELECT = "id,company_id,entity,record_id,payload,version,created_at,updated_at,created_by,updated_by,device_id,last_operation_id,deleted_at";

  function activeCompanyId() {
    return String(
      BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid
      || ""
    ).trim();
  }

  function configured() {
    return Boolean(
      activeCompanyId()
      && BlessERP.isSupabaseConfigured?.()
      && BlessERP.getSupabaseClient?.()?.from
      && window.location?.protocol !== "file:"
    );
  }

  function normalizePageSize(value) {
    return Number(value) === 50 ? 50 : 25;
  }

  function safeSearch(value) {
    return String(value || "")
      .trim()
      .replace(/[%_,().:'"\\]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 120);
  }

  function mapRecord(record, type) {
    const payload = record?.payload && typeof record.payload === "object" ? record.payload : {};
    return {
      ...payload,
      id: String(payload.id || record?.record_id || ""),
      type,
      __syncVersion: Number(record?.version || payload.__syncVersion || 0),
      __syncUpdatedAt: String(record?.updated_at || payload.updated_at || ""),
      __canonicalRecordId: String(record?.record_id || payload.id || ""),
      __canonicalPayload: { ...payload }
    };
  }

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.() || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
      });
  }

  function payloadOf(item = {}) {
    const source = item.__canonicalPayload && typeof item.__canonicalPayload === "object"
      ? item.__canonicalPayload
      : item;
    return Object.fromEntries(Object.entries(source).filter(([key]) => (
      key !== "type" && !String(key).startsWith("__")
    )));
  }

  async function get(type, recordId) {
    const config = TYPES[type];
    const companyId = activeCompanyId();
    const id = String(recordId || "").trim();
    if (!config || !companyId || !id || !configured()) {
      return { ok: false, mode: "REMOTE_REQUIRED", message: "Supabase debe estar disponible para consultar el registro canónico." };
    }
    const { data, error } = await BlessERP.getSupabaseClient()
      .from("erp_entity_records")
      .select(RECORD_SELECT)
      .eq("company_id", companyId)
      .eq("entity", config.entity)
      .eq("record_id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message || "No se pudo consultar el registro canónico." };
    if (!data) return { ok: false, mode: "NOT_FOUND", message: "El registro ya no existe en el catálogo canónico." };
    return { ok: true, serverRecord: data, record: mapRecord(data, type), mode: "SUPABASE_CONFIRMED" };
  }

  function normalizeBusinessValue(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function likeLiteral(value) {
    return normalizeBusinessValue(value).replace(/[\\%_]/g, character => `\\${character}`);
  }

  async function duplicate(type, field, value, recordId = "") {
    const config = TYPES[type];
    const companyId = activeCompanyId();
    const expected = normalizeBusinessValue(value);
    if (!config || !companyId || !expected) return null;
    let query = BlessERP.getSupabaseClient()
      .from("erp_entity_records")
      .select("record_id,payload")
      .eq("company_id", companyId)
      .eq("entity", config.entity)
      .is("deleted_at", null)
      .ilike(`payload->>${field}`, likeLiteral(expected))
      .limit(2);
    if (recordId) query = query.neq("record_id", recordId);
    const { data, error } = await query;
    if (error) throw error;
    return (Array.isArray(data) ? data : []).find(row => (
      normalizeBusinessValue(row?.payload?.[field]).toLocaleUpperCase("es-EC")
      === expected.toLocaleUpperCase("es-EC")
    )) || null;
  }

  function mutationPayload(type, draft, basePayload, recordId, operationId) {
    const config = TYPES[type];
    const next = {
      ...basePayload,
      id: recordId,
      code: normalizeBusinessValue(draft.code || basePayload.code
        || `${config.codePrefix}-${operationId.slice(0, 8).toUpperCase()}`),
      name: normalizeBusinessValue(draft.name),
      active: draft.active !== false,
      observation: normalizeBusinessValue(draft.observation)
    };
    if (type === "suppliers") next.assignedBlock = normalizeBusinessValue(draft.assignedBlock).toUpperCase();
    if (type === "bunchers") next.labelColor = normalizeBusinessValue(draft.labelColor).toUpperCase();
    if (config.person) {
      const operationalWorkerId = normalizeBusinessValue(
        basePayload.operational_worker_id || basePayload.operationalWorkerId
        || basePayload.employee_id || basePayload.employeeId || recordId
      );
      next.employee_id = operationalWorkerId;
      next.employeeId = operationalWorkerId;
      next.operational_worker_id = operationalWorkerId;
      next.operationalWorkerId = operationalWorkerId;
      next.employeeLinkSource = basePayload.employeeLinkSource || "OPERATIONAL_CATALOG_ID";
    }
    return next;
  }

  async function applyConfirmedServerRecord(serverRecord) {
    const result = await BlessERP.offlineSync?.applyRemoteRecord?.(serverRecord, {
      source: "POSTHARVEST_PARAMETER_CONFIRMED",
      force: true,
      forceServer: true,
      ignoreRecordHold: true,
      ignoreEditGuard: true
    });
    if (result && result.ok === false) throw new Error("Supabase confirmó el parámetro, pero no se pudo actualizar la caché canónica operativa.");
    return result;
  }

  async function save(type, draft = {}) {
    const config = TYPES[type];
    const companyId = activeCompanyId();
    if (!CANONICAL_EDIT_TYPES.has(type) || !config) {
      return { ok: false, mode: "INVALID_TYPE", message: "Este catálogo no admite edición canónica desde esta pantalla." };
    }
    if (!configured() || !companyId) {
      return { ok: false, mode: "REMOTE_REQUIRED", message: "Supabase debe confirmar la edición del catálogo." };
    }
    if (!BlessERP.offlineSync?.applyRemoteRecord || !BlessERP.offlineSync?.buildFieldChanges) {
      return { ok: false, mode: "SYNC_RUNTIME_REQUIRED", message: "El runtime canónico de sincronización no está disponible." };
    }

    const name = normalizeBusinessValue(draft.name);
    const assignedBlock = normalizeBusinessValue(draft.assignedBlock).toUpperCase();
    if (!name) return { ok: false, mode: "VALIDATION", message: "Ingrese el nombre del parámetro." };
    if (type === "suppliers" && !assignedBlock) {
      return { ok: false, mode: "VALIDATION", message: "Asigne el bloque canónico de la finca." };
    }

    const existingId = String(draft.__canonicalRecordId || draft.id || "").trim();
    let current = null;
    if (existingId) {
      const found = await get(type, existingId);
      if (!found.ok) return found;
      current = found.record;
    }

    try {
      const duplicateName = await duplicate(type, "name", name, existingId);
      if (duplicateName) return { ok: false, mode: "DUPLICATE", message: "Ya existe un registro canónico con el mismo nombre." };
      const normalizedCode = normalizeBusinessValue(draft.code || current?.code);
      if (normalizedCode) {
        const duplicateCode = await duplicate(type, "code", normalizedCode, existingId);
        if (duplicateCode) return { ok: false, mode: "DUPLICATE", message: "Ya existe un registro canónico con el mismo código." };
      }
      if (type === "suppliers") {
        const duplicateBlock = await duplicate(type, "assignedBlock", assignedBlock, existingId);
        if (duplicateBlock) return { ok: false, mode: "DUPLICATE", message: `El bloque ${assignedBlock} ya pertenece a otra finca canónica.` };
      }
    } catch (error) {
      return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message || "No se pudieron validar los duplicados canónicos." };
    }

    const operationId = uuid();
    const recordId = existingId || (config.person ? operationId : `${config.recordPrefix}-${operationId}`);
    const basePayload = current ? payloadOf(current) : {};
    const payload = mutationPayload(type, draft, basePayload, recordId, operationId);
    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-PARAM-${operationId.slice(0, 12)}`);
    const fieldChanges = BlessERP.offlineSync?.buildFieldChanges?.(basePayload, payload) || [];
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_apply_offline_operation", {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: deviceId,
      p_entity: config.entity,
      p_action: current ? "UPDATE" : "INSERT",
      p_record_id: recordId,
      p_payload: payload,
      p_base_payload: basePayload,
      p_field_changes: fieldChanges,
      p_base_version: Number(current?.__syncVersion || 0),
      p_local_created_at: new Date().toISOString()
    });
    if (error) return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message || "Supabase rechazó el cambio del catálogo." };
    const command = Array.isArray(data) ? data[0] : data;
    if (command?.conflict || String(command?.status || "").toUpperCase() === "CONFLICT") {
      return { ok: false, mode: "CONFLICT", message: "El registro cambió en otra sesión. Consulte nuevamente antes de editar." };
    }
    let serverRecord = command?.server_record || null;
    if (!serverRecord?.record_id) {
      const confirmed = await get(type, recordId);
      if (!confirmed.ok) return { ...confirmed, mode: "CONFIRMATION_FAILED" };
      serverRecord = confirmed.serverRecord;
    }
    await applyConfirmedServerRecord(serverRecord);
    return {
      ok: true,
      confirmed: true,
      mode: "SUPABASE_CONFIRMED",
      operationId,
      serverRecord,
      record: mapRecord(serverRecord, type)
    };
  }

  async function setActive(type, item, active) {
    if (!item?.id) return { ok: false, mode: "INVALID_RECORD", message: "Seleccione un registro canónico." };
    return save(type, { ...item, active: Boolean(active) });
  }

  async function list(filters = {}) {
    const type = String(filters.type || "").trim();
    const config = TYPES[type];
    const companyId = activeCompanyId();
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = normalizePageSize(filters.pageSize);
    const status = ["TODOS", "INACTIVO"].includes(String(filters.status || "").toUpperCase())
      ? String(filters.status || "").toUpperCase()
      : "ACTIVO";

    if (!config) {
      return { ok: false, rows: [], total: 0, page, pageSize, mode: "INVALID_TYPE", message: "Seleccione un tipo de parámetro válido." };
    }
    if (!configured() || !companyId) {
      return { ok: false, rows: [], total: 0, page, pageSize, mode: "REMOTE_REQUIRED", message: "Supabase debe estar disponible para consultar el catálogo administrativo." };
    }

    const startedAt = performance.now();
    const offset = (page - 1) * pageSize;
    let query = BlessERP.getSupabaseClient()
      .from("erp_entity_records")
      .select("record_id,payload,version,updated_at", { count: "exact" })
      .eq("company_id", companyId)
      .eq("entity", config.entity)
      .is("deleted_at", null);

    if (status === "ACTIVO") query = query.filter("payload->>active", "eq", "true");
    if (status === "INACTIVO") query = query.filter("payload->>active", "eq", "false");

    const search = safeSearch(filters.search);
    if (search) {
      const pattern = `%${search}%`;
      query = query.or([
        `record_id.ilike.${pattern}`,
        `payload->>code.ilike.${pattern}`,
        `payload->>name.ilike.${pattern}`,
        `payload->>observation.ilike.${pattern}`,
        `payload->>assignedBlock.ilike.${pattern}`,
        `payload->>labelColor.ilike.${pattern}`
      ].join(","));
    }

    const { data, error, count } = await query
      .order("updated_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return {
        ok: false,
        rows: [],
        total: 0,
        page,
        pageSize,
        mode: "SUPABASE_ERROR",
        error,
        message: error.message || "No se pudo consultar el catálogo."
      };
    }

    const rawRows = Array.isArray(data) ? data : [];
    return {
      ok: true,
      rows: rawRows.map(record => mapRecord(record, type)),
      total: Number(count || 0),
      page,
      pageSize,
      entity: config.entity,
      mode: "SUPABASE_CONFIRMED",
      elapsedMs: Math.max(0, performance.now() - startedAt),
      payloadBytes: new TextEncoder().encode(JSON.stringify(rawRows)).byteLength
    };
  }

  async function history(filters = {}) {
    const type = String(filters.type || "").trim();
    const recordId = String(filters.recordId || "").trim();
    const config = TYPES[type];
    const companyId = activeCompanyId();
    if (!config || !recordId) {
      return { ok: false, rows: [], mode: "INVALID_RECORD", message: "Seleccione un parámetro válido." };
    }
    if (!configured() || !companyId) {
      return { ok: false, rows: [], mode: "REMOTE_REQUIRED", message: "Supabase debe estar disponible para consultar el historial." };
    }
    const { data, error } = await BlessERP.getSupabaseClient()
      .from("erp_sync_operations")
      .select("operation_id,action,status,result_version,last_error,server_created_at,server_processed_at")
      .eq("company_id", companyId)
      .eq("entity", config.entity)
      .eq("record_id", recordId)
      .order("server_created_at", { ascending: false })
      .limit(25);
    if (error) {
      return { ok: false, rows: [], mode: "SUPABASE_ERROR", error, message: error.message || "No se pudo consultar el historial del parámetro." };
    }
    return { ok: true, rows: Array.isArray(data) ? data : [], mode: "SUPABASE_CONFIRMED" };
  }

  const repository = Object.freeze({
    list,
    get,
    history,
    save,
    setActive,
    types: () => TYPES,
    isCanonicalEditableType: type => CANONICAL_EDIT_TYPES.has(String(type || "")),
    typeForEntity: entity => TYPE_BY_ENTITY.get(String(entity || "")) || "",
    activeCompanyId,
    configured,
    normalizePageSize,
    safeSearch,
    mapRecord
  });

  BlessERP.getPostharvestParameterQueryRepository = () => repository;
  BlessERP.repositoryRegistry = BlessERP.repositoryRegistry || {};
  BlessERP.repositoryRegistry.operaciones = BlessERP.repositoryRegistry.operaciones || {};
  BlessERP.repositoryRegistry.operaciones.postharvestParameterQuery = repository;
})();
