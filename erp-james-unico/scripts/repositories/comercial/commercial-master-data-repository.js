(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const TABLE = "erp_entity_records";
  const RPC = "erp_apply_offline_operation";
  const SERVER_COLUMNS = "id,company_id,entity,record_id,payload,version,created_at,updated_at,created_by,updated_by,device_id,last_operation_id,deleted_at";
  const DEFINITIONS = Object.freeze({
    commercial_customers: Object.freeze({ key: "customer" }),
    commercial_brands: Object.freeze({ key: "finalBrand" }),
    commercial_countries: Object.freeze({ key: "country" }),
    commercial_dae: Object.freeze({ key: "dae" }),
    commercial_agencies: Object.freeze({ key: "cargoAgency" }),
    commercial_airlines: Object.freeze({ key: "airline" })
  });
  const repositories = new Map();
  const hydrationPromises = new Map();

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") {
      try { return structuredClone(value); } catch { /* JSON basta para estos catálogos. */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function activeContext() {
    const access = BlessERP.authAccess?.activeAccess?.();
    const db = BlessERP.state?.state?.db;
    return {
      companyId: String(access?.activeCompany?.id || db?.authAccess?.activeCompanyUuid || "").trim(),
      companyKey: String(access?.activeCompanyKey || access?.activeCompany?.company_key
        || db?.authAccess?.activeCompanyKey || db?.activeCompanyId || "").trim()
    };
  }

  function remoteRequired() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.authEnabled && config.incrementalSyncEnabled
      && config.commercialCatalogsSupabaseEnabled === true && window.location?.protocol !== "file:");
  }

  function configured(context = activeContext()) {
    const client = BlessERP.getSupabaseClient?.();
    return Boolean(remoteRequired() && context.companyId && client?.from && client?.rpc
      && BlessERP.offlineSync?.applyRemoteRecord && BlessERP.syncEntityRegistry);
  }

  function assertActiveContext(expected) {
    const current = activeContext();
    if (!expected?.companyId || current.companyId !== expected.companyId
      || (expected.companyKey && current.companyKey !== expected.companyKey)) {
      const error = new Error("La empresa activa cambió durante la hidratación del catálogo comercial.");
      error.code = "COMMERCIAL_MASTER_DATA_COMPANY_CONTEXT_CHANGED";
      throw error;
    }
    return current;
  }

  function assertServerCompany(serverRecord, expected) {
    if (String(serverRecord?.company_id || "") !== String(expected?.companyId || "")) {
      const error = new Error("Supabase devolvió un registro comercial de otra empresa.");
      error.code = "COMMERCIAL_MASTER_DATA_COMPANY_MISMATCH";
      throw error;
    }
  }

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.() || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
      });
  }

  function recordId(record) {
    return String(record?.id || record?.record_id || record?.recordId || record?.code || record?.number || "").trim();
  }

  function sameCompany(record, context) {
    const declared = String(record?.companyId || record?.company_id || "").trim();
    return !declared || declared === context.companyId || declared === context.companyKey;
  }

  function canonicalPayload(entity, record, context) {
    const source = { ...(record || {}) };
    const id = recordId(source);
    if (!id) throw new Error("El registro comercial no tiene identidad canónica.");
    const localCompanyIdentity = context.companyKey || context.companyId;
    source.id = id;
    source.companyId = localCompanyIdentity;
    source.company_id = localCompanyIdentity;
    return BlessERP.syncEntityRegistry.sanitizePayload(entity, source);
  }

  function recordFromServer(serverRecord) {
    const entity = String(serverRecord?.entity || "");
    const payload = BlessERP.syncEntityRegistry?.sanitizePayload?.(entity, serverRecord?.payload || {})
      || clone(serverRecord?.payload || {});
    if (!payload.id) payload.id = String(serverRecord?.record_id || "");
    return {
      ...payload,
      __syncVersion: Number(serverRecord?.version || 1),
      __syncUpdatedAt: String(serverRecord?.updated_at || ""),
      __syncUpdatedBy: String(serverRecord?.updated_by || ""),
      __syncDeviceId: String(serverRecord?.device_id || ""),
      __syncOperationId: String(serverRecord?.last_operation_id || "")
    };
  }

  function replaceLocalEntity(entity, serverRecords, context) {
    assertActiveContext(context);
    const db = BlessERP.state?.state?.db;
    if (!db || !BlessERP.syncEntityRegistry?.setRecords?.(db, entity, serverRecords.map(recordFromServer))) {
      const error = new Error("No se pudo reconciliar la caché comercial con la autoridad de Supabase.");
      error.code = "COMMERCIAL_MASTER_DATA_CACHE_RECONCILIATION_FAILED";
      throw error;
    }
    BlessERP.state?.saveDbLocalOnly?.();
  }

  async function readServerRecord(entity, id, context = activeContext()) {
    const { data, error } = await BlessERP.getSupabaseClient()
      .from(TABLE)
      .select(SERVER_COLUMNS)
      .eq("company_id", context.companyId)
      .eq("entity", entity)
      .eq("record_id", id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function applyCanonical(serverRecord, source, context = activeContext()) {
    if (!serverRecord) throw new Error("Supabase no devolvió el registro canónico confirmado.");
    assertActiveContext(context);
    assertServerCompany(serverRecord, context);
    const applied = await BlessERP.offlineSync.applyRemoteRecord(serverRecord, {
      source,
      force: true,
      forceServer: true,
      ignoreRecordHold: true,
      ignoreEditGuard: true
    });
    if (applied?.ok === false) throw new Error("Supabase confirmó el registro, pero no se pudo actualizar la caché canónica.");
    assertActiveContext(context);
    return recordFromServer(serverRecord);
  }

  function failure(error, fallback, operationId = "") {
    return {
      ok: false,
      confirmed: false,
      status: "ERROR",
      mode: String(error?.code || "SUPABASE_ERROR"),
      operationId,
      error,
      message: String(error?.message || fallback).trim()
    };
  }

  async function execute(entity, action, record) {
    const context = activeContext();
    const operationId = uuid();
    if (!configured(context)) {
      return failure(null, remoteRequired()
        ? "Supabase no está disponible; el catálogo no fue modificado."
        : "La autoridad remota de catálogos comerciales no está habilitada.", operationId);
    }
    if (!DEFINITIONS[entity]) return failure(null, "Entidad de catálogo comercial no autorizada.", operationId);
    if (!sameCompany(record, context)) return failure(null, "El registro pertenece a otra empresa activa.", operationId);
    const id = recordId(record);
    if (!id) return failure(null, "El registro comercial no tiene identidad canónica.", operationId);

    try {
      const current = await readServerRecord(entity, id, context);
      if (action === "DELETE" && (!current || current.deleted_at)) {
        return { ok: true, confirmed: true, status: "SYNCED", mode: "SERVER_ALREADY_ABSENT", operationId, record: clone(record) };
      }
      const basePayload = current?.payload || {};
      const protectedCatalog = ["commercial_customers", "commercial_brands", "commercial_airlines", "commercial_agencies", "commercial_dae"].includes(entity);
      let payload = action === "DELETE" ? basePayload : canonicalPayload(entity, record, context);
      if (protectedCatalog && action !== "DELETE" && current) {
        assertActiveContext(context);
        assertServerCompany(current, context);
        if (current.deleted_at || current.record_id !== id || current.entity !== entity) {
          throw new Error("El registro canónico ya no está disponible. Actualice el catálogo.");
        }
        const projected = BlessERP.comercialData?.commercialCatalogProjection?.(entity, basePayload);
        if (projected) {
          const requested = payload;
          payload = clone(basePayload);
          for (const [field, value] of Object.entries(requested)) {
            if (field === "id" || field === "companyId" || field === "company_id") continue;
            if (JSON.stringify(value) !== JSON.stringify(projected[field] ?? basePayload[field])) payload[field] = value;
          }
        }
      }
      if (action !== "DELETE" && current && !current.deleted_at
        && JSON.stringify(basePayload) === JSON.stringify(payload)) {
        const canonical = await applyCanonical(current, "COMMERCIAL_MASTER_DATA_NOOP", context);
        return { ok: true, confirmed: true, status: "SYNCED", mode: "SERVER_ALREADY_CURRENT", operationId, record: canonical, serverRecord: current };
      }
      if (protectedCatalog && action !== "DELETE" && current
        && Number(record.__syncVersion) !== Number(current.version)) {
        return failure({ code: "COMMERCIAL_CATALOG_VERSION_CONFLICT", message: "La ficha cambió o no tiene una versión canónica. Actualice el catálogo y revise sus cambios antes de guardar." }, "", operationId);
      }
      const fieldChanges = action === "DELETE"
        ? [{ path: ["$delete"], base_exists: true, base: clone(basePayload), value_exists: false, value: null }]
        : (BlessERP.offlineSync.buildFieldChanges?.(basePayload, payload) || []);
      const deviceId = String(await BlessERP.offlineSync.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
      const { data, error } = await BlessERP.getSupabaseClient().rpc(RPC, {
        p_operation_id: operationId,
        p_company_id: context.companyId,
        p_device_id: deviceId,
        p_entity: entity,
        p_action: action === "DELETE" ? "DELETE" : (current ? "UPDATE" : "INSERT"),
        p_record_id: id,
        p_payload: payload,
        p_base_payload: basePayload,
        p_field_changes: fieldChanges,
        p_base_version: Number(current?.version || 0),
        p_local_created_at: new Date().toISOString()
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || result.conflict === true || !["SYNCED", "APPLIED"].includes(String(result.status || "").toUpperCase())) {
        return failure(result, "Supabase no confirmó la operación del catálogo.", operationId);
      }
      let serverRecord = result.server_record || await readServerRecord(entity, id, context);
      if (typeof serverRecord === "string") serverRecord = JSON.parse(serverRecord);
      if (!serverRecord) throw new Error("Supabase confirmó la operación sin devolver el registro canónico.");
      if (protectedCatalog && action !== "DELETE" && (serverRecord.record_id !== id
        || serverRecord.entity !== entity || serverRecord.deleted_at
        || Number(serverRecord.version) !== Number(current?.version || 0) + 1
        || (result.discarded_fields || []).length)) {
        throw new Error("Supabase no confirmó la versión guardada del catálogo. Actualice la ficha antes de reintentar.");
      }
      const canonical = await applyCanonical(serverRecord, "COMMERCIAL_MASTER_DATA_CONFIRMATION", context);
      return {
        ok: true,
        confirmed: true,
        status: "SYNCED",
        mode: "SUPABASE_CONFIRMED",
        operationId,
        record: canonical,
        serverRecord,
        discardedFields: result.discarded_fields || []
      };
    } catch (error) {
      return failure(error, "Supabase rechazó la operación del catálogo.", operationId);
    }
  }

  async function listEntity(entity, context = activeContext()) {
    if (!configured(context)) return failure(null, "La autoridad remota del catálogo no está disponible.");
    try {
      assertActiveContext(context);
      const { data, error } = await BlessERP.getSupabaseClient().from(TABLE)
        .select(SERVER_COLUMNS)
        .eq("company_id", context.companyId)
        .eq("entity", entity)
        .is("deleted_at", null)
        .order("updated_at", { ascending: true });
      if (error) throw error;
      assertActiveContext(context);
      const serverRecords = Array.isArray(data) ? data : [];
      for (const serverRecord of serverRecords) {
        await applyCanonical(serverRecord, "COMMERCIAL_MASTER_DATA_HYDRATION", context);
      }
      replaceLocalEntity(entity, serverRecords, context);
      return {
        ok: true,
        confirmed: true,
        status: "SYNCED",
        companyId: context.companyId,
        companyKey: context.companyKey,
        rows: serverRecords.map(recordFromServer),
        serverRecords
      };
    } catch (error) {
      return failure(error, "No se pudo hidratar el catálogo desde Supabase.");
    }
  }

  async function hydrateCommercialCatalog(options = {}) {
    if (options.genericResult?.ok !== false) {
      return { ok: true, mode: "GENERIC_DOMAIN_PULL", fetchedRows: 0, skipped: true };
    }
    const context = activeContext();
    if (!configured(context)) {
      return failure(null, "La autoridad canónica del catálogo comercial no está disponible.");
    }
    if (hydrationPromises.has(context.companyId)) return hydrationPromises.get(context.companyId);
    const task = (async () => {
      const results = [];
      for (const entity of Object.keys(DEFINITIONS)) {
        assertActiveContext(context);
        const result = await listEntity(entity, context);
        if (!result.ok) return result;
        results.push({ entity, rows: result.rows.length });
      }
      assertActiveContext(context);
      return {
        ok: true,
        confirmed: true,
        mode: "CANONICAL_COMMERCIAL_MASTER_DATA",
        companyId: context.companyId,
        companyKey: context.companyKey,
        fetchedRows: results.reduce((total, result) => total + result.rows, 0),
        entities: results
      };
    })().finally(() => hydrationPromises.delete(context.companyId));
    hydrationPromises.set(context.companyId, task);
    return task;
  }

  function createRepository(entity) {
    if (!DEFINITIONS[entity]) throw new Error(`Catálogo comercial no autorizado: ${entity}`);
    if (repositories.has(entity)) return repositories.get(entity);
    const repository = Object.freeze({
      entity,
      activeCompanyUuid: () => activeContext().companyId,
      canExecute: configured,
      configured,
      remoteRequired,
      async getById(id) {
        const context = activeContext();
        if (!configured(context)) return failure(null, "La autoridad remota del catálogo no está disponible.");
        try {
          const serverRecord = await readServerRecord(entity, String(id || "").trim(), context);
          assertActiveContext(context);
          if (serverRecord) assertServerCompany(serverRecord, context);
          return { ok: true, confirmed: true, status: "SYNCED", serverRecord,
            record: serverRecord && !serverRecord.deleted_at ? recordFromServer(serverRecord) : null };
        } catch (error) {
          return failure(error, "No se pudo consultar el catálogo en Supabase.");
        }
      },
      async list() {
        const context = activeContext();
        return listEntity(entity, context);
      },
      save(record) { return execute(entity, "SAVE", record); },
      create(record) { return execute(entity, "SAVE", record); },
      update(id, record) { return execute(entity, "SAVE", { ...(record || {}), id: String(id || recordId(record)) }); },
      remove(recordOrId) {
        return execute(entity, "DELETE", typeof recordOrId === "object" ? recordOrId : { id: String(recordOrId || "") });
      }
    });
    repositories.set(entity, repository);
    return repository;
  }

  BlessERP.repositoryModules = BlessERP.repositoryModules || { core: {}, comercial: {}, operaciones: {}, inventarioMateriales: {}, contabilidad: {} };
  BlessERP.createCommercialMasterDataRepository = createRepository;
  BlessERP.getCommercialMasterDataRepository = createRepository;
  BlessERP.repositoryModules.comercial.customer = createRepository("commercial_customers");
  BlessERP.repositoryModules.comercial.finalBrand = createRepository("commercial_brands");
  BlessERP.repositoryModules.comercial.country = createRepository("commercial_countries");
  BlessERP.repositoryModules.comercial.dae = createRepository("commercial_dae");
  BlessERP.repositoryModules.comercial.cargoAgency = createRepository("commercial_agencies");
  BlessERP.repositoryModules.comercial.airline = createRepository("commercial_airlines");
  BlessERP.getCustomerRepository = () => BlessERP.repositoryModules.comercial.customer;
  BlessERP.getFinalBrandRepository = () => BlessERP.repositoryModules.comercial.finalBrand;
  BlessERP.getCountryRepository = () => BlessERP.repositoryModules.comercial.country;
  BlessERP.getDaeRepository = () => BlessERP.repositoryModules.comercial.dae;
  BlessERP.getCargoAgencyRepository = () => BlessERP.repositoryModules.comercial.cargoAgency;
  BlessERP.getAirlineRepository = () => BlessERP.repositoryModules.comercial.airline;
  BlessERP.domainDataHydrators = BlessERP.domainDataHydrators || {};
  BlessERP.domainDataHydrators["commercial-catalog"] = options => hydrateCommercialCatalog(options);
})();
