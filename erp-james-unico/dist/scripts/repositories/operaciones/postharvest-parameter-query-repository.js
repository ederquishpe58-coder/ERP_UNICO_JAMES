(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const TYPES = Object.freeze({
    suppliers: Object.freeze({ entity: "operations_suppliers", label: "Fincas / Bloques" }),
    classifiers: Object.freeze({ entity: "operations_classifiers", label: "Clasificadores" }),
    bunchers: Object.freeze({ entity: "operations_bunchers", label: "Embonchadores" }),
    receptionists: Object.freeze({ entity: "operations_receptionists", label: "Recepcionistas" }),
    digitizers: Object.freeze({ entity: "operations_digitizers", label: "Digitadores" }),
    scanners: Object.freeze({ entity: "operations_scanners", label: "Responsables de escaneo" }),
    responsibles: Object.freeze({ entity: "operations_responsibles", label: "Responsables de despacho" }),
    varieties: Object.freeze({ entity: "operations_varieties", label: "Variedades" }),
    lengths: Object.freeze({ entity: "operations_lengths", label: "Medidas" }),
    stemTypes: Object.freeze({ entity: "operations_stem_types", label: "Tipos de tallo" }),
    labelTypes: Object.freeze({ entity: "operations_label_types", label: "Tipos de etiqueta" })
  });
  const TYPE_BY_ENTITY = new Map(Object.entries(TYPES).map(([type, config]) => [config.entity, type]));

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
      __canonicalRecordId: String(record?.record_id || payload.id || "")
    };
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
    history,
    types: () => TYPES,
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
