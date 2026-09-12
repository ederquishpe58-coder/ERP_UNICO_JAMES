(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  const COLLECTION_RPC = "erp_financial_v2_register_collection";
  const COMMERCIAL_PROFITABILITY_RPC = "erp_commercial_profitability_report";
  const COMMERCIAL_PROFITABILITY_PAGE_SIZE = 100;
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, error: null, data: null };
  let lastCollectionTrace = null;

  function traceTime() {
    return new Date().toISOString();
  }

  function traceError(error) {
    if (!error) return null;
    return {
      code: String(error.code || error.name || "ERROR"),
      message: String(error.message || error),
      details: String(error.details || ""),
      hint: String(error.hint || "")
    };
  }

  function collectionTrace() {
    if (!lastCollectionTrace) return null;
    return {
      ...lastCollectionTrace,
      error: lastCollectionTrace.error ? { ...lastCollectionTrace.error } : null,
      events: lastCollectionTrace.events.map(event => ({ ...event }))
    };
  }

  function recordCollectionTrace(stage, detail = {}) {
    if (!lastCollectionTrace) startCollectionTrace({ origin: "REPOSITORY" });
    const at = traceTime();
    const event = { stage: String(stage || "UNKNOWN"), at, ...detail };
    lastCollectionTrace.currentStage = event.stage;
    lastCollectionTrace.events.push(event);
    const timestampFields = {
      COLLECTION_SUBMIT_STARTED: "startedAt",
      HEALTH_STARTED: "healthStartedAt",
      HEALTH_OK: "healthCompletedAt",
      DEVICE_ID_RESOLVED: "deviceResolvedAt",
      RPC_REQUEST_STARTED: "rpcRequestStartedAt",
      RPC_RESPONSE_RECEIVED: "responseReceivedAt",
      CANONICAL_RESULT_APPLIED: "canonicalResultAppliedAt",
      COLLECTION_COMPLETED: "completedAt"
    };
    const timestampField = timestampFields[event.stage];
    if (timestampField) lastCollectionTrace[timestampField] = at;
    if (event.operationId) lastCollectionTrace.operationId = String(event.operationId);
    return collectionTrace();
  }

  function startCollectionTrace(detail = {}) {
    const startedAt = traceTime();
    lastCollectionTrace = {
      traceId: uuid(),
      startedAt,
      healthStartedAt: "",
      healthCompletedAt: "",
      deviceResolvedAt: "",
      operationId: "",
      rpcRequestStartedAt: "",
      responseReceivedAt: "",
      canonicalResultAppliedAt: "",
      completedAt: "",
      currentStage: "COLLECTION_SUBMIT_STARTED",
      failedStage: "",
      error: null,
      events: [{ stage: "COLLECTION_SUBMIT_STARTED", at: startedAt, ...detail }]
    };
    return collectionTrace();
  }

  function failCollectionTrace(stage, error, detail = {}) {
    if (!lastCollectionTrace) startCollectionTrace({ origin: "REPOSITORY" });
    const failure = traceError(error);
    lastCollectionTrace.failedStage = String(stage || "UNKNOWN");
    lastCollectionTrace.error = failure;
    recordCollectionTrace("COLLECTION_FAILED", {
      failedStage: lastCollectionTrace.failedStage,
      error: failure,
      ...detail
    });
    return collectionTrace();
  }

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(access?.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }

  function remoteRequired() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.financialV2CaptureEnabled === true
      && window.location?.protocol !== "file:");
  }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.financialV2CaptureEnabled === true
      && typeof BlessERP.getSupabaseClient === "function" && activeCompanyUuid()
      && window.location?.protocol !== "file:");
  }

  function commercialProfitabilityReadConfigured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled
      && typeof BlessERP.getSupabaseClient === "function"
      && BlessERP.getSupabaseClient()?.rpc
      && activeCompanyUuid()
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
    const message = String(error?.message || "No se pudo validar Finanzas V2.").trim();
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok: false, status, companyId, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      health = { status: "NOT_CONFIGURED", companyId, checkedAt: Date.now(), error: null, data: null };
      return { ok: false, status: health.status, companyId, message: "Finanzas V2 no está habilitada para este despliegue." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };
    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);
    const { data, error } = await client.rpc("erp_financial_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    const required = ["sequenceTable","journalTable","journalLinesTable","receivablesTable","creditNotesTable",
      "collectionsTable","applicationsTable","costsTable","expensesTable","allocationsTable","eventsTable",
      "orderProfitabilityView","shipmentProfitabilityView","operationsDependency","exportDependency",
      "postJournalRpc","postInvoiceRpc","postCreditNoteRpc","reverseJournalRpc","registerCollectionRpc",
      "reverseCollectionRpc","recordCostRpc","recordShipmentExpenseRpc"];
    if (!result?.ok || result.component !== "FINANCIAL_V2" || result.migration !== "202608150009"
      || required.some(key => result[key] !== true)) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend de Finanzas V2 está incompleto o desactualizado." }, companyId);
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
        throw new Error("Supabase confirmó la operación financiera, pero no se pudo aplicar su versión canónica.");
      }
    }
  }

  async function command(rpcName, parameters, options = {}) {
    const companyId = activeCompanyUuid();
    const isCollection = rpcName === COLLECTION_RPC;
    if (isCollection && (!lastCollectionTrace || (options.collectionTraceId
      && lastCollectionTrace.traceId !== options.collectionTraceId))) {
      startCollectionTrace({ origin: "FINANCIAL_V2_COMMAND" });
    }
    const operationId = String(options.operationId || uuid());
    if (isCollection) recordCollectionTrace("OPERATION_ID_CREATED", { operationId });
    if (!configured() || !companyId) {
      if (isCollection) failCollectionTrace("CLIENT_CONFIGURATION", { code: "NOT_CONFIGURED", message: "Supabase financiero no configurado." });
      return {
        ok: false,
        mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY",
        operationId,
        message: remoteRequired()
          ? "Sin conexión confirmada con Supabase. La operación financiera no fue contabilizada."
          : "La contabilización V2 no se confirma en el HTML estrictamente local."
      };
    }
    if (isCollection) recordCollectionTrace("HEALTH_STARTED");
    let backend;
    try {
      backend = await probeBackend();
    } catch (error) {
      if (isCollection) failCollectionTrace("HEALTH", error);
      return { ok: false, mode: "HEALTH_ERROR", operationId, error, message: error.message || "No se pudo validar Finanzas V2." };
    }
    if (!backend.ok || !canExecute()) {
      if (isCollection) failCollectionTrace("HEALTH", backend.error || { code: backend.status, message: backend.message });
      return { ok: false, mode: backend.status || "BACKEND_UNAVAILABLE", operationId,
        error: backend.error, message: backend.message || "Finanzas V2 no está disponible en Supabase." };
    }
    if (isCollection) recordCollectionTrace("HEALTH_OK", { healthStatus: backend.status || "VERIFIED" });
    let resolvedDeviceId;
    try {
      resolvedDeviceId = await deviceId(operationId);
    } catch (error) {
      if (isCollection) failCollectionTrace("DEVICE_ID", error, { operationId });
      return { ok: false, mode: "DEVICE_ID_ERROR", operationId, error, message: error.message || "No se pudo resolver el dispositivo." };
    }
    if (isCollection) recordCollectionTrace("DEVICE_ID_RESOLVED", { operationId, deviceIdPresent: Boolean(resolvedDeviceId) });
    console.info("[jaeder-v2-command]", { flow: "FINANCIAL_V2", rpc: rpcName, operationId, companyId });
    let response;
    try {
      const rpcRequest = BlessERP.getSupabaseClient().rpc(rpcName, {
        p_operation_id: operationId,
        p_company_id: companyId,
        p_device_id: resolvedDeviceId,
        ...parameters
      });
      if (isCollection) recordCollectionTrace("RPC_REQUEST_STARTED", { operationId, rpcName });
      response = await rpcRequest;
      if (isCollection) recordCollectionTrace("RPC_RESPONSE_RECEIVED", {
        operationId,
        rpcName,
        responseStatus: response?.status ?? (response?.error ? "ERROR" : "OK"),
        responseStatusText: String(response?.statusText || ""),
        responseError: traceError(response?.error)
      });
    } catch (error) {
      if (isCollection) {
        recordCollectionTrace("RPC_RESPONSE_RECEIVED", { operationId, rpcName, responseStatus: "REJECTED", responseError: traceError(error) });
        failCollectionTrace("RPC_RESPONSE", error, { operationId, rpcName });
      }
      return { ok: false, mode: "SUPABASE_REJECTED", operationId, error, message: error.message || "La solicitud a Supabase no respondió." };
    }
    const { data, error } = response || {};
    if (error) {
      if (isCollection) failCollectionTrace("RPC_RESPONSE", error, { operationId, rpcName });
      return { ok: false, mode: "SUPABASE_ERROR", operationId, error,
        message: error.message || "Supabase rechazó la operación financiera." };
    }
    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) {
      if (isCollection) failCollectionTrace("RPC_RETURN_CONTRACT", { code: "INVALID_RESPONSE", message: result?.message || "Respuesta remota inválida." }, { operationId, rpcName });
      return { ok: false, mode: "INVALID_RESPONSE", operationId,
        message: result?.message || "Supabase no confirmó la operación financiera." };
    }
    try {
      await applyCanonical(records, options.source || "FINANCIAL_V2_COMMAND");
    } catch (error) {
      if (isCollection) failCollectionTrace("CANONICAL_RESULT", error, { operationId, rpcName });
      return { ok: false, mode: "CANONICAL_CACHE_ERROR", operationId, message: error.message };
    }
    if (isCollection) {
      recordCollectionTrace("CANONICAL_RESULT_APPLIED", { operationId, recordCount: records.length });
      recordCollectionTrace("COLLECTION_COMPLETED", { operationId });
    }
    return { ok: true, confirmed: true, mode: "SUPABASE_TRANSACTION_CONFIRMED", operationId,
      records, serverTime: String(result.serverTime || ""), result: result.result || {} };
  }

  async function profitability(view, filters = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, rows: [], message: "Supabase financiero no disponible." };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, rows: [], message: backend.message || "Backend financiero no disponible." };
    const columns = view === "erp_financial_v2_shipment_profitability"
      ? "company_id,shipment_id,revenue,flower_cost,packaging_cost,labor_cost,direct_logistics_cost,direct_cost,allocated_cost,margin"
      : "company_id,order_id,revenue,flower_cost,packaging_cost,labor_cost,direct_logistics_cost,direct_cost,allocated_cost,margin";
    let query = BlessERP.getSupabaseClient().from(view).select(columns).eq("company_id", companyId);
    for (const [column, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== "") query = query.eq(column, value);
    }
    const { data, error } = await query;
    return error ? { ok: false, rows: [], error, message: error.message } : { ok: true, rows: data || [] };
  }

  async function commercialProfitabilityReport(filters = {}) {
    const companyId = activeCompanyUuid();
    const dateFrom = String(filters.dateFrom || "").slice(0, 10);
    const dateTo = String(filters.dateTo || "").slice(0, 10);
    const pageSize = Math.min(100, Math.max(10, Number(filters.pageSize || COMMERCIAL_PROFITABILITY_PAGE_SIZE)));
    const fromTime = Date.parse(`${dateFrom}T00:00:00Z`);
    const toTime = Date.parse(`${dateTo}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)
      || !Number.isFinite(fromTime) || !Number.isFinite(toTime)
      || new Date(fromTime).toISOString().slice(0, 10) !== dateFrom
      || new Date(toTime).toISOString().slice(0, 10) !== dateTo) {
      return { ok: false, rows: [], orders: [], message: "Seleccione un rango de fechas válido." };
    }
    if (dateFrom > dateTo) {
      return { ok: false, rows: [], orders: [], message: "La fecha Desde no puede ser posterior a Hasta." };
    }
    if (!commercialProfitabilityReadConfigured() || !companyId) {
      return { ok: false, rows: [], orders: [], message: "Supabase financiero no disponible." };
    }

    const rows = [];
    let summary = {};
    let total = 0;
    let totalPages = 1;
    let requestCount = 0;
    for (let page = 1; page <= totalPages; page += 1) {
      requestCount += 1;
      const { data, error } = await BlessERP.getSupabaseClient().rpc(COMMERCIAL_PROFITABILITY_RPC, {
        p_company_id: companyId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_include_annulled: filters.includeAnnulled === true,
        p_page: page,
        p_page_size: pageSize
      });
      if (error) {
        return { ok: false, rows: [], orders: [], requestCount, error, message: error.message || "No se pudo consultar la rentabilidad." };
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.ok || !Array.isArray(result.items)) {
        return { ok: false, rows: [], orders: [], requestCount, message: "Supabase devolvió una respuesta de rentabilidad inválida." };
      }
      rows.push(...result.items);
      summary = result.summary || summary;
      total = Number(result.total || 0);
      const serverTotalPages = Number(result.totalPages || 1);
      if (!Number.isSafeInteger(serverTotalPages) || serverTotalPages < 1) {
        return { ok: false, rows: [], orders: [], requestCount, message: "Supabase devolvió una paginación inválida." };
      }
      totalPages = serverTotalPages;
    }
    return {
      ok: true,
      rows,
      orders: rows.map(row => row?.order).filter(Boolean),
      summary,
      total,
      totalPages,
      pageSize,
      requestCount,
      dateFrom,
      dateTo,
      includeAnnulled: filters.includeAnnulled === true
    };
  }

  function postJournal(payload = {}, options = {}) {
    return command("erp_financial_v2_post_journal", {
      p_payload: payload,
      p_source_type: String(options.sourceType || payload.sourceType || "MANUAL").trim().toUpperCase(),
      p_source_id: String(options.sourceId || payload.sourceId || "").trim() || null,
      p_event_type: String(options.eventType || payload.eventType || "POST_JOURNAL").trim().toUpperCase(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_POST_JOURNAL" });
  }

  const repository = Object.freeze({
    async salesInbox({ search = "", offset = 0, documentId = null, fiscalState = "", accountingState = "" } = {}) {
      const companyId = activeCompanyUuid();
      if (!commercialProfitabilityReadConfigured()) throw new Error("Bandeja de ventas: conexion canonica no disponible.");
      const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_financial_v2_sales_inbox", {
        p_company_id: companyId, p_search: search, p_offset: offset, p_limit: 50, p_document_id: documentId,
        p_fiscal_state: fiscalState, p_accounting_state: accountingState
      });
      if (error) throw new Error(`No se pudo leer la bandeja de ventas (${error.code || "ERROR"}). ${error.message || ""}`);
      const result = Array.isArray(data) ? data[0] : data;
      if (activeCompanyUuid() !== companyId) throw new Error("La empresa activa cambio durante la lectura.");
      if (!result || result.companyId !== companyId || result.environment !== "PRODUCTION"
        || !Array.isArray(result.rows) || !Number.isSafeInteger(Number(result.total))
        || !Number.isSafeInteger(result.pendingCount) || result.pendingCount < 0 || result.pendingCount > Number(result.total)
        || result.rows.some(row => row.companyId !== companyId || row.environment !== "PRODUCTION")) {
        throw new Error("La bandeja devolvio un ambito o respuesta no valido.");
      }
      return result;
    },
    activeCompanyUuid,
    canExecute,
    healthStatus,
    probeBackend,
    collectionTrace,
    failCollectionTrace,
    recordCollectionTrace,
    startCollectionTrace,
    commercialProfitabilityReport,
    orderProfitability: orderId => profitability("erp_financial_v2_order_profitability", { order_id: orderId }),
    postInvoice: (invoice, options = {}) => command("erp_financial_v2_post_invoice", {
      p_invoice: invoice, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_POST_INVOICE" }),
    postCreditNote: (creditNote, options = {}) => command("erp_financial_v2_post_credit_note", {
      p_credit_note: creditNote, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_POST_CREDIT_NOTE" }),
    postJournal,
    recordOrderCost: (payload, options = {}) => command("erp_financial_v2_record_cost", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_ORDER_COST" }),
    recordShipmentExpense: (payload, options = {}) => command("erp_financial_v2_record_shipment_expense", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_SHIPMENT_EXPENSE" }),
    registerCollection: (payload, options = {}) => command("erp_financial_v2_register_collection", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_COLLECTION" }),
    remoteRequired,
    reverseJournal: (journalEntryId, reason, options = {}) => command("erp_financial_v2_reverse_journal", {
      p_journal_entry_id: String(journalEntryId || "").trim(),
      p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_JOURNAL_REVERSAL" }),
    shipmentProfitability: shipmentId => profitability("erp_financial_v2_shipment_profitability", { shipment_id: shipmentId }),
    reverseCollection: (collectionId, reason, options = {}) => command("erp_financial_v2_reverse_collection", {
      p_collection_id: String(collectionId || "").trim(),
      p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "FINANCIAL_V2_COLLECTION_REVERSAL" }),
    uuid
  });

  BlessERP.getFinancialV2Repository = function() { return repository; };
})();
