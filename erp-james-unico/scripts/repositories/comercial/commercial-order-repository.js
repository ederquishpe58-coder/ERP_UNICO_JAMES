(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  BlessERP.repositoryModules = BlessERP.repositoryModules || {
    core: {},
    comercial: {},
    operaciones: {},
    inventarioMateriales: {},
    contabilidad: {}
  };

  function createFallbackRepository(entityName) {
    return {
      entity: entityName,
      list() {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      getById(id) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, id, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      create(payload) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, payload, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      update(id, payload) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, id, payload, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      },
      remove(id) {
        return { ok: false, mode: "LOCAL_DEMO", entity: entityName, id, message: "Repositorio Supabase pendiente. Usar servicios demo/locales." };
      }
    };
  }

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(
      access?.activeCompany?.id
      || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid
      || ""
    ).trim();
  }

  function canListPageFromSupabase() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(
      config.supabaseEnabled
      && config.incrementalSyncEnabled
      && typeof BlessERP.getSupabaseClient === "function"
      && activeCompanyUuid()
      && window.location?.protocol !== "file:"
    );
  }

  function remoteRequired() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(
      config.supabaseEnabled
      && config.authEnabled
      && config.incrementalSyncEnabled
      && window.location?.protocol !== "file:"
    );
  }

  function normalizedPage(value) {
    return Math.max(1, Math.trunc(Number(value || 1)));
  }

  function normalizedPageSize(value) {
    return Math.min(100, Math.max(10, Math.trunc(Number(value || 25))));
  }

  function safeSearch(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function normalizeOrderTransportPayload(order = {}, options = {}) {
    return BlessERP.comercialUtils?.normalizeOrderTransportPayload
      ? BlessERP.comercialUtils.normalizeOrderTransportPayload(order, options)
      : { ...order };
  }

  const COMMERCIAL_WORKSPACE_STATUSES = Object.freeze(["GUARDADO", "EN_CUARTO_FRIO", "COMPLETADO"]);
  const COMMERCIAL_WORKSPACE_PAGE_SIZE = 200;
  const workspaceHydrationPromises = new Map();

  function workspaceServerRecord(row, companyId) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      id: row?.id,
      company_id: String(row?.company_id || companyId || ""),
      entity: "commercial_orders",
      record_id: String(row?.record_id || payload.id || ""),
      payload: normalizeOrderTransportPayload(payload, { ensureMaritimePrefix: true }),
      version: Number(row?.version || 1),
      created_at: String(row?.created_at || ""),
      updated_at: String(row?.updated_at || ""),
      created_by: String(row?.created_by || ""),
      updated_by: String(row?.updated_by || ""),
      device_id: String(row?.device_id || ""),
      last_operation_id: String(row?.last_operation_id || ""),
      deleted_at: row?.deleted_at || null
    };
  }

  async function readCommercialWorkspace(options = {}) {
    const companyId = activeCompanyUuid();
    if (!canListPageFromSupabase() || !companyId) {
      return { ok: false, mode: "REMOTE_REQUIRED", fetchedRows: 0, message: "El workspace comercial canónico no está disponible." };
    }
    const rows = [];
    for (let offset = 0; ; offset += COMMERCIAL_WORKSPACE_PAGE_SIZE) {
      let query = BlessERP.getSupabaseClient()
        .from("erp_entity_records")
        .select("id,company_id,entity,record_id,payload,version,created_at,updated_at,created_by,updated_by,device_id,last_operation_id,deleted_at")
        .eq("company_id", companyId)
        .eq("entity", "commercial_orders")
        .is("deleted_at", null)
        .in("payload->>status", COMMERCIAL_WORKSPACE_STATUSES)
        .order("updated_at", { ascending: false })
        .range(offset, offset + COMMERCIAL_WORKSPACE_PAGE_SIZE - 1);
      if (options.signal && typeof query.abortSignal === "function") query = query.abortSignal(options.signal);
      const { data, error } = await query;
      if (error) {
        return { ok: false, mode: "SUPABASE_ERROR", fetchedRows: rows.length, error, message: error.message || "No se pudo leer el workspace comercial." };
      }
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < COMMERCIAL_WORKSPACE_PAGE_SIZE) break;
    }
    return {
      ok: true,
      mode: "SUPABASE_COMMERCIAL_WORKSPACE",
      companyId,
      rows: rows.map(row => workspaceServerRecord(row, companyId)),
      fetchedRows: rows.length
    };
  }

  async function hydrateCommercialWorkspace(options = {}) {
    if (options.genericResult?.ok !== false) {
      return { ok: true, mode: "GENERIC_DOMAIN_PULL", fetchedRows: 0, skipped: true };
    }
    const companyId = activeCompanyUuid();
    if (!companyId) return { ok: false, mode: "NO_COMPANY", fetchedRows: 0, message: "Seleccione una empresa antes de abrir Coordinación." };
    if (workspaceHydrationPromises.has(companyId)) return workspaceHydrationPromises.get(companyId);
    const task = (async () => {
      const remote = await readCommercialWorkspace(options);
      if (!remote.ok) return remote;
      if (typeof BlessERP.offlineSync?.applyRemoteRecord !== "function") {
        return { ok: false, mode: "CANONICAL_MERGE_UNAVAILABLE", fetchedRows: 0, message: "La fusión canónica del workspace comercial no está disponible." };
      }
      let changedRows = 0;
      let deferredRows = 0;
      for (const row of remote.rows) {
        const applied = await BlessERP.offlineSync.applyRemoteRecord(row, {
          source: "COMMERCIAL_WORKSPACE_HYDRATE",
          forceServer: true,
          // La carga inicial ocurre antes de que exista un formulario comercial
          // editable. El shell puede reportar isEditing() durante ese montaje;
          // diferir aquí dejaría el renderer vacío pese a haber recibido servidor.
          // Los refresh posteriores conservan el guard normal de edición.
          ignoreEditGuard: options.full === true
        });
        if (applied?.changed) changedRows += 1;
        if (applied?.deferred) deferredRows += 1;
      }
      return {
        ok: true,
        mode: remote.mode,
        companyId,
        fetchedRows: remote.fetchedRows,
        changedRows,
        deferredRows
      };
    })().finally(() => workspaceHydrationPromises.delete(companyId));
    workspaceHydrationPromises.set(companyId, task);
    return task;
  }

  async function requestPage(options = {}, requestedPage = normalizedPage(options.page)) {
    const companyId = activeCompanyUuid();
    if (!canListPageFromSupabase() || !companyId) {
      return { ok: false, mode: "LOCAL_FALLBACK", message: "La consulta paginada de Supabase no está disponible." };
    }

    const pageSize = normalizedPageSize(options.pageSize);
    const client = BlessERP.getSupabaseClient();
    const filters = options.filters || {};
    let query = client.rpc("erp_list_commercial_order_history", {
      p_company_id: companyId,
      p_page: requestedPage,
      p_page_size: pageSize,
      p_search: safeSearch(filters.search),
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_customer_id: filters.customerId || null,
      p_brand_id: filters.brandId || null,
      p_destination: filters.destination || null,
      p_customer_matches: Array.isArray(filters.customerMatches) && filters.customerMatches.length ? filters.customerMatches : null,
      p_brand_matches: Array.isArray(filters.brandMatches) && filters.brandMatches.length ? filters.brandMatches : null,
      p_airline_matches: Array.isArray(filters.airlineMatches) && filters.airlineMatches.length ? filters.airlineMatches : null
    });
    if (options.signal && typeof query.abortSignal === "function") query = query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error) return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message || "No se pudo consultar el historial." };

    const result = data && typeof data === "object" ? data : {};
    const items = Array.isArray(result.items) ? result.items : [];
    const total = Math.max(0, Number(result.total || 0));
    const resolvedPage = normalizedPage(result.page || requestedPage);
    const resolvedPageSize = normalizedPageSize(result.pageSize || pageSize);
    return {
      ok: true,
      mode: "SUPABASE_ENTITY_RECORDS",
      items,
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      totalPages: Math.max(1, Number(result.totalPages || Math.ceil(total / resolvedPageSize))),
      start: Math.max(0, Number(result.start || 0)),
      end: Math.max(0, Number(result.end || 0)),
      companyId
    };
  }

  async function getFullOrder(recordId, options = {}) {
    const companyId = activeCompanyUuid();
    const id = String(recordId || "").trim();
    if (!canListPageFromSupabase() || !companyId || !id) {
      return { ok: false, mode: "LOCAL_FALLBACK", message: "El detalle remoto no está disponible." };
    }
    let query = BlessERP.getSupabaseClient()
      .from("erp_entity_records")
      .select("record_id, payload, version, updated_at, last_operation_id")
      .eq("company_id", companyId)
      .eq("entity", "commercial_orders")
      .eq("record_id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (options.signal && typeof query.abortSignal === "function") query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error) return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message || "No se pudo consultar el pedido." };
    if (!data) return { ok: false, mode: "NOT_FOUND", message: "El pedido ya no existe en Supabase." };
    const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    const effectivePayload = normalizeOrderTransportPayload(payload, { ensureMaritimePrefix: true });
    return {
      ok: true,
      mode: "SUPABASE_ENTITY_RECORDS",
      order: {
        ...effectivePayload,
        id: String(payload.id || data.record_id || id),
        __syncVersion: Number(data.version || 0),
        __syncUpdatedAt: String(data.updated_at || ""),
        __syncOperationId: String(data.last_operation_id || "")
      }
    };
  }

  async function listSalesRepresentatives(options = {}) {
    const companyId = activeCompanyUuid();
    if (!canListPageFromSupabase() || !companyId) {
      return { ok: false, mode: "REMOTE_REQUIRED", message: "El catálogo canónico de vendedores no está disponible." };
    }
    let query = BlessERP.getSupabaseClient().rpc("erp_commercial_v2_list_sales_representatives", {
      p_company_id: companyId
    });
    if (options.signal && typeof query.abortSignal === "function") query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error) return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message || "No se pudo consultar vendedores." };
    const result = data && typeof data === "object" ? data : {};
    const items = Array.isArray(result.items) ? result.items : [];
    return {
      ok: result.ok === true,
      mode: "SUPABASE_PAYROLL_EMPLOYEES",
      items,
      rows: items,
      companyId
    };
  }

  async function reserveIdentifiers(order = {}, series = {}) {
    const companyId = activeCompanyUuid();
    const recordId = String(order.id || "").trim();
    const issuedAt = String(order.issuedAt || order.createdAt || "").slice(0, 10);
    const orderYear = Number(issuedAt.slice(0, 4)) || new Date().getFullYear();
    if (!canListPageFromSupabase() || !companyId) {
      return { ok: false, mode: "LOCAL_FALLBACK", message: "La reserva atomica de Supabase no esta disponible." };
    }
    if (!recordId) {
      return { ok: false, mode: "INVALID_ORDER", message: "El pedido no tiene un identificador interno valido." };
    }

    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_reserve_commercial_order_identifiers", {
      p_company_id: companyId,
      p_record_id: recordId,
      p_order_year: orderYear,
      p_establishment_code: String(series.establishment || "001").padStart(3, "0"),
      p_emission_point_code: String(series.emissionPoint || "001").padStart(3, "0"),
      p_document_type: "01"
    });
    if (error) {
      return {
        ok: false,
        mode: "SUPABASE_ERROR",
        error,
        message: error.message || "No se pudo reservar el numero del pedido y la factura en Supabase."
      };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, mode: "INVALID_RESPONSE", message: "Supabase no devolvio los identificadores reservados." };
    }
    return { ok: true, mode: "SUPABASE_ATOMIC", ...data };
  }

  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
      const random = Math.random() * 16 | 0;
      return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
    });
  }

  async function saveConfirmedOrder(order = {}, series = {}, options = {}) {
    order = normalizeOrderTransportPayload(order, { ensureMaritimePrefix: true });
    const companyId = activeCompanyUuid();
    const recordId = String(order.id || "").trim();
    const issuedAt = String(order.issuedAt || order.createdAt || "").slice(0, 10);
    const orderYear = Number(issuedAt.slice(0, 4)) || new Date().getFullYear();
    if (!canListPageFromSupabase() || !companyId) {
      return { ok: false, mode: "LOCAL_FALLBACK", message: "El guardado transaccional de Supabase no esta disponible." };
    }
    if (!recordId) {
      return { ok: false, mode: "INVALID_ORDER", message: "El pedido no tiene un identificador interno valido." };
    }

    const operationId = String(options.operationId || BlessERP.offlineSync?.createOperationId?.() || uuid());
    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
    const payload = BlessERP.syncEntityRegistry?.serializableRecord?.(order) || { ...order };
    const basePayload = options.basePayload && typeof options.basePayload === "object"
      ? (BlessERP.syncEntityRegistry?.serializableRecord?.(options.basePayload) || { ...options.basePayload })
      : {};
    const fieldChanges = BlessERP.offlineSync?.buildFieldChanges?.(basePayload, payload) || [];
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_save_commercial_order", {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: deviceId,
      p_record_id: recordId,
      p_order_year: orderYear,
      p_establishment_code: String(series.establishment || "001").padStart(3, "0"),
      p_emission_point_code: String(series.emissionPoint || "001").padStart(3, "0"),
      p_payload: payload,
      p_base_payload: basePayload,
      p_field_changes: fieldChanges,
      p_base_version: Math.max(0, Number(options.baseVersion || order.__syncVersion || 0)),
      p_local_created_at: new Date().toISOString()
    });
    if (error) {
      return {
        ok: false,
        mode: "SUPABASE_ERROR",
        operationId,
        error,
        message: error.message || "No se pudo guardar el pedido completo en Supabase."
      };
    }
    const result = Array.isArray(data) ? data[0] : data;
    const serverRecord = result?.serverRecord || result?.server_record || null;
    if (!result?.ok || !serverRecord?.record_id || !serverRecord?.payload) {
      return {
        ok: false,
        mode: "INVALID_RESPONSE",
        operationId,
        message: "Supabase no confirmo el pedido completo; no se consumio ningun secuencial."
      };
    }
    return {
      ok: true,
      confirmed: true,
      mode: "SUPABASE_TRANSACTION_CONFIRMED",
      operationId,
      reservation: result.reservation || {},
      serverRecord,
      resultVersion: Number(result.resultVersion || serverRecord.version || 0),
      serverTime: String(result.serverTime || serverRecord.updated_at || ""),
      discardedFields: result.discardedFields || [],
      mergeSummary: result.mergeSummary || {}
    };
  }

  async function patchCoordination(recordId, patch = {}, options = {}) {
    const companyId = activeCompanyUuid();
    const id = String(recordId || "").trim();
    if (!canListPageFromSupabase() || !companyId || !id) {
      return { ok: false, mode: "REMOTE_REQUIRED", message: "La coordinación confirmada no está disponible." };
    }
    const allowed = ["daeNumber", "awb", "hawb", "airlineId"];
    const safePatch = Object.fromEntries(allowed
      .filter(field => Object.prototype.hasOwnProperty.call(patch, field))
      .map(field => [field, String(patch[field] ?? "").trim()]));
    if (!Object.keys(safePatch).length) {
      return { ok: false, mode: "INVALID_PATCH", message: "No existen campos de coordinación permitidos." };
    }
    const operationId = String(options.operationId || BlessERP.offlineSync?.createOperationId?.() || uuid());
    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_patch_commercial_order_coordination", {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: deviceId,
      p_record_id: id,
      p_expected_version: Math.max(1, Number(options.expectedVersion || 0)),
      p_patch: safePatch,
      p_local_created_at: new Date().toISOString()
    });
    if (error) {
      return {
        ok: false,
        mode: error.code === "40001" || /COMMERCIAL_ORDER_VERSION_CONFLICT/i.test(String(error.message || ""))
          ? "VERSION_CONFLICT"
          : "SUPABASE_ERROR",
        operationId,
        error,
        message: error.message || "Supabase no confirmó la coordinación del pedido."
      };
    }
    const result = Array.isArray(data) ? data[0] : data;
    const serverRecord = result?.serverRecord || result?.server_record || null;
    if (!result?.ok || !serverRecord?.record_id || !serverRecord?.payload) {
      return { ok: false, mode: "INVALID_RESPONSE", operationId, message: "Supabase no devolvió el pedido canónico actualizado." };
    }
    const noChange = result?.noChange === true
      || result?.unchanged === true
      || result?.result?.status === "COORDINATION_UNCHANGED";
    return {
      ok: true,
      confirmed: true,
      unchanged: noChange,
      noChange,
      mode: noChange ? "SUPABASE_COORDINATION_PATCH_UNCHANGED" : "SUPABASE_COORDINATION_PATCH_CONFIRMED",
      operationId,
      serverRecord
    };
  }

  async function patchSriIssueDate(recordId, issueDate, documentId, options = {}) {
    const companyId = activeCompanyUuid();
    const id = String(recordId || "").trim();
    const normalizedDate = String(issueDate || "").slice(0, 10);
    const sriDocumentId = String(documentId || "").trim();
    if (!canListPageFromSupabase() || !companyId || !id) {
      return { ok: false, mode: "REMOTE_REQUIRED", message: "La fecha SRI canónica requiere conexión con Supabase." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !sriDocumentId) {
      return { ok: false, mode: "INVALID_PATCH", message: "La fecha o el comprobante SRI no son válidos." };
    }
    const operationId = String(options.operationId || BlessERP.offlineSync?.createOperationId?.() || uuid());
    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_patch_commercial_order_sri_issue_date", {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: deviceId,
      p_record_id: id,
      p_document_id: sriDocumentId,
      p_expected_version: Math.max(1, Number(options.expectedVersion || 0)),
      p_issue_date: normalizedDate,
      p_local_created_at: new Date().toISOString()
    });
    if (error) {
      return {
        ok: false,
        mode: /COMMERCIAL_ORDER_VERSION_CONFLICT/i.test(String(error.message || ""))
          ? "VERSION_CONFLICT"
          : "SUPABASE_ERROR",
        operationId,
        error,
        message: error.message || "Supabase no confirmó la fecha SRI del pedido."
      };
    }
    const result = Array.isArray(data) ? data[0] : data;
    const serverRecord = result?.serverRecord || result?.server_record || null;
    if (!result?.ok || !serverRecord?.record_id || !serverRecord?.payload) {
      return { ok: false, mode: "INVALID_RESPONSE", operationId, message: "Supabase no devolvió el pedido canónico actualizado." };
    }
    return { ok: true, confirmed: true, mode: "SUPABASE_SRI_DATE_PATCH_CONFIRMED", operationId, serverRecord };
  }

  const repository = BlessERP.createRepositoryBase
    ? BlessERP.createRepositoryBase("commercial_orders")
    : createFallbackRepository("commercial_orders");
  repository.canListPage = canListPageFromSupabase;
  repository.getFullOrder = getFullOrder;
  repository.hydrateWorkspace = hydrateCommercialWorkspace;
  repository.readWorkspace = readCommercialWorkspace;
  repository.listSalesRepresentatives = listSalesRepresentatives;
  repository.listPage = requestPage;
  repository.patchCoordination = patchCoordination;
  repository.patchSriIssueDate = patchSriIssueDate;
  repository.remoteRequired = remoteRequired;
  repository.reserveIdentifiers = reserveIdentifiers;
  repository.saveConfirmedOrder = saveConfirmedOrder;

  BlessERP.repositoryModules.comercial.commercialOrder = repository;
  BlessERP.domainDataHydrators = BlessERP.domainDataHydrators || {};
  BlessERP.domainDataHydrators["commercial-workspace"] = options => hydrateCommercialWorkspace(options);
  BlessERP.getCommercialOrderRepository = function() {
    return repository;
  };
})();
