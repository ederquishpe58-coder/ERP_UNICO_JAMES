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
    return Boolean(config.supabaseEnabled && config.supplierFinanceV2CaptureEnabled === true
      && window.location?.protocol !== "file:");
  }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.supplierFinanceV2CaptureEnabled === true
      && typeof BlessERP.getSupabaseClient === "function" && activeCompanyUuid()
      && window.location?.protocol !== "file:");
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return Boolean(configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS);
  }

  function healthStatus() { return { ...health, available: canExecute() }; }

  function normalizedTaxId(value) {
    return String(value || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  }

  const PROVIDER_SELECT = [
    "provider_id", "provider_code", "tax_id", "legal_name", "commercial_name",
    "provider_type", "settlement_method", "contact_name", "phone", "email", "address",
    "payment_terms", "credit_days", "currency_code", "payable_account_code",
    "advance_account_code", "operational_supplier_id", "status", "profile_state",
    "source", "notes", "version", "updated_at"
  ].join(",");

  function providerRow(row = {}) {
    const providerId = String(row.provider_id || "");
    const taxId = normalizedTaxId(row.tax_id);
    const legalName = String(row.legal_name || "");
    return {
      id: providerId,
      providerId,
      code: String(row.provider_code || ""),
      providerCode: String(row.provider_code || ""),
      taxId,
      ruc: taxId,
      name: legalName,
      legalName,
      commercialName: String(row.commercial_name || ""),
      providerType: String(row.provider_type || "OTHER"),
      settlementMethod: String(row.settlement_method || "PURCHASE_DOCUMENT"),
      contact: String(row.contact_name || ""),
      phone: String(row.phone || ""),
      email: String(row.email || ""),
      address: String(row.address || ""),
      paymentCondition: String(row.payment_terms || ""),
      creditDays: Number(row.credit_days || 0),
      currencyCode: String(row.currency_code || "USD"),
      payableAccountCode: String(row.payable_account_code || ""),
      advanceAccountCode: String(row.advance_account_code || ""),
      operationalSupplierId: String(row.operational_supplier_id || ""),
      status: String(row.status || "ACTIVE").toLowerCase(),
      profileState: String(row.profile_state || "COMPLETE"),
      createdSource: String(row.source || ""),
      observation: String(row.notes || ""),
      version: Number(row.version || 0),
      updatedAt: String(row.updated_at || ""),
      syncFlow: "SUPPLIER_FINANCE_V2",
      remoteConfirmed: true
    };
  }

  function healthFailure(error, companyId) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || "No se pudo validar Proveedores V2.").trim();
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok: false, status, companyId, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      health = { status: "NOT_CONFIGURED", companyId, checkedAt: Date.now(), error: null, data: null };
      return { ok: false, status: health.status, companyId, message: "Proveedores y CxP V2 no está habilitado para este despliegue." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };
    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return healthFailure({ code: "CLIENT_UNAVAILABLE", message: "Cliente Supabase no disponible." }, companyId);
    const { data, error } = await client.rpc("erp_supplier_v2_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    const required = ["providersTable","purchaseDocumentsTable","purchaseLinesTable","payablesTable","settlementsTable",
      "settlementLinesTable","receptionCostsTable","paymentsTable","paymentApplicationsTable","adjustmentsTable",
      "providerBalancesView","receptionCostView","upsertProviderRpc","postPurchaseRpc","reversePurchaseRpc",
      "registerPaymentRpc","reversePaymentRpc","createSettlementRpc","reverseSettlementRpc","atomicProviderPost","retentionDecisionColumns"];
    if (!result?.ok || result.component !== "SUPPLIER_FINANCE_V2" || result.migration !== "202608200001"
      || required.some(key => result[key] !== true)) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend de Proveedores y CxP V2 está incompleto o desactualizado." }, companyId);
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

  async function applyCanonical(records, source, options = {}) {
    const changedEntities = new Set();
    for (const record of records) {
      if (options.granularCanonical === true) {
        const db = BlessERP.state?.state?.db;
        const applied = BlessERP.syncEntityRegistry?.applyServerRecord?.(db, record, { forceServer: true });
        await BlessERP.syncIndexedDb?.putEntity?.(record);
        if (!applied || applied.ok === false) throw new Error("Supabase confirmó la operación, pero no se pudo aplicar su registro canónico.");
        if (applied.changed) changedEntities.add(String(record.entity || ""));
        continue;
      }
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(record, {
        source, force: true, forceServer: true, ignoreRecordHold: true, ignoreEditGuard: true
      });
      if (applied && applied.ok === false) throw new Error("Supabase confirmó la operación, pero no se pudo aplicar su registro canónico.");
    }
    if (options.granularCanonical === true && changedEntities.size) {
      window.dispatchEvent?.(new CustomEvent("erp:incremental-sync-applied", {
        detail: { changed: changedEntities.size, entities: [...changedEntities], source }
      }));
    }
  }

  function friendlyError(error) {
    const code = String(error?.message || error?.code || "").toUpperCase();
    const messages = {
      SUPPLIER_V2_PROVIDER_IDENTITY_REQUIRED: "El proveedor necesita RUC/CI y razón social.",
      SUPPLIER_V2_PROVIDER_IDENTITY_MISMATCH: "El RUC del XML no corresponde al proveedor seleccionado.",
      SUPPLIER_V2_PROVIDER_NOT_FOUND: "El proveedor no existe o está inactivo en Supabase.",
      SUPPLIER_V2_PURCHASE_INCOMPLETE: "La compra está incompleta o no tiene un total válido.",
      SUPPLIER_V2_RETENTION_DECISION_INVALID: "La decisión de retención no es válida.",
      SUPPLIER_V2_RETENTION_REASON_REQUIRED: "Debe registrar el motivo para la decisión 332 no sujeto a retención.",
      SUPPLIER_V2_PURCHASE_HAS_PAYMENTS: "No se puede reversar la compra porque su obligación ya tiene pagos.",
      SUPPLIER_V2_PAYMENT_EXCEEDS_BALANCE: "El pago supera el saldo real confirmado de la obligación.",
      SUPPLIER_V2_PAYABLE_NOT_AVAILABLE: "La obligación ya fue pagada, anulada o pertenece a otro proveedor.",
      SUPPLIER_V2_RECEPTION_NOT_FOUND: "La recepción seleccionada no existe en Supabase.",
      SUPPLIER_V2_RECEPTION_PROVIDER_MISMATCH: "La recepción no pertenece al proveedor seleccionado.",
      SUPPLIER_V2_RECEPTION_QUANTITY_EXCEEDED: "La cantidad a liquidar supera lo pendiente de la recepción.",
      SUPPLIER_V2_SETTLEMENT_HAS_PAYMENTS: "No se puede reversar la liquidación porque ya tiene pagos.",
      SUPPLIER_V2_REVERSAL_REASON_REQUIRED: "Debe indicar el motivo de la reversión."
    };
    const match = Object.keys(messages).find(key => code.includes(key));
    return match ? messages[match] : (error?.message || "Supabase rechazó la operación.");
  }

  async function command(rpcName, parameters, options = {}) {
    const companyId = activeCompanyUuid();
    const operationId = String(options.operationId || uuid());
    if (!configured() || !companyId) {
      return {
        ok: false,
        mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY",
        operationId,
        message: remoteRequired()
          ? "Sin conexión confirmada con Supabase. La operación de proveedores no fue confirmada."
          : "El flujo V2 de proveedores no se confirma en el HTML estrictamente local."
      };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, mode: backend.status || "BACKEND_UNAVAILABLE", operationId,
        error: backend.error, message: backend.message || "Proveedores y CxP V2 no está disponible en Supabase." };
    }
    console.info("[jaeder-v2-command]", { flow: "SUPPLIER_FINANCE_V2", rpc: rpcName, operationId, companyId });
    const { data, error } = await BlessERP.getSupabaseClient().rpc(rpcName, {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: await deviceId(operationId),
      ...parameters
    });
    if (error) return { ok: false, mode: "SUPABASE_ERROR", operationId, error, message: friendlyError(error), errors: [friendlyError(error)] };
    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) return { ok: false, mode: "INVALID_RESPONSE", operationId, message: result?.message || "Respuesta remota inválida." };
    try { await applyCanonical(records, options.source || "SUPPLIER_FINANCE_V2_COMMAND", options); }
    catch (error) { return { ok: false, mode: "CANONICAL_CACHE_ERROR", operationId, message: error.message }; }
    return { ok: true, confirmed: true, mode: "SUPABASE_TRANSACTION_CONFIRMED", operationId,
      records, serverTime: String(result.serverTime || ""), result: result.result || {} };
  }

  async function providerBalances() {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, rows: [], message: "Supabase de proveedores no disponible." };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, rows: [], message: backend.message || "Backend de proveedores no disponible." };
    const { data, error } = await BlessERP.getSupabaseClient().from("erp_supplier_v2_provider_balances")
      .select("company_id,provider_id,provider_code,tax_id,legal_name,total_obligations,balance,open_documents")
      .eq("company_id",companyId);
    return error ? { ok: false, rows: [], error, message: error.message } : { ok: true, rows: data || [] };
  }

  async function receptionCostSummary(filters = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, rows: [], message: "Supabase de costos de recepción no disponible." };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, rows: [], message: backend.message || "Backend de proveedores no disponible." };
    if (!filters.providerId && !filters.receptionId) {
      return { ok: false, rows: [], mode: "FILTER_REQUIRED", message: "Selecciona proveedor o recepción antes de consultar costos." };
    }
    let query = BlessERP.getSupabaseClient().from("erp_supplier_v2_reception_cost_summary")
      .select("company_id,provider_id,tax_id,legal_name,reception_id,reception_item_id,quantity_type,confirmed_quantity,confirmed_cost,average_unit_cost")
      .eq("company_id", companyId);
    if (filters.providerId) query = query.eq("provider_id", filters.providerId);
    if (filters.receptionId) query = query.eq("reception_id", filters.receptionId);
    const { data, error } = await query;
    return error ? { ok: false, rows: [], error, message: error.message } : { ok: true, rows: data || [] };
  }

  async function resolveProvidersByTaxIds(taxIds = []) {
    const companyId = activeCompanyUuid();
    const normalized = [...new Set((taxIds || []).map(normalizedTaxId).filter(Boolean))];
    if (!normalized.length) return { ok: true, rows: [], companyId };
    if (!configured() || !companyId) {
      return {
        ok: false,
        rows: [],
        mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY",
        message: remoteRequired()
          ? "Sin conexión confirmada con Supabase. No se pudo resolver el proveedor."
          : "El catálogo V2 de proveedores no está disponible en este entorno."
      };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, rows: [], mode: backend.status || "BACKEND_UNAVAILABLE",
        message: backend.message || "Backend de proveedores no disponible." };
    }
    const { data, error } = await BlessERP.getSupabaseClient()
      .from("erp_supplier_providers")
      .select(PROVIDER_SELECT)
      .eq("company_id", companyId)
      .in("tax_id", normalized);
    if (error) return { ok: false, rows: [], mode: "SUPABASE_ERROR", error, message: friendlyError(error) };
    return {
      ok: true,
      mode: "SUPABASE_READ_ONLY",
      companyId,
      rows: (data || []).map(providerRow)
    };
  }

  async function resolveProvider(candidate = {}) {
    const companyId = activeCompanyUuid();
    const providerId = String(candidate.providerId || candidate.id || "").trim();
    const taxId = normalizedTaxId(candidate.taxId || candidate.ruc || candidate.providerRuc);
    if (!providerId && !taxId) return { ok: false, provider: null, companyId, mode: "IDENTITY_REQUIRED", message: "Falta la identidad canónica del proveedor." };
    if (!configured() || !companyId) {
      return { ok: false, provider: null, companyId, mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY", message: "El catálogo V2 de proveedores no está disponible en este entorno." };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) {
      return { ok: false, provider: null, companyId, mode: backend.status || "BACKEND_UNAVAILABLE", message: backend.message || "Backend de proveedores no disponible." };
    }
    let query = BlessERP.getSupabaseClient().from("erp_supplier_providers")
      .select(PROVIDER_SELECT)
      .eq("company_id", companyId);
    query = providerId ? query.eq("provider_id", providerId) : query.eq("tax_id", taxId);
    const { data, error } = await query.maybeSingle();
    if (error) return { ok: false, provider: null, companyId, mode: "SUPABASE_ERROR", error, message: friendlyError(error) };
    if (!data) return { ok: false, provider: null, companyId, mode: "NOT_FOUND", message: "El proveedor canónico no existe en la empresa activa." };
    const provider = providerRow(data);
    if (providerId && provider.id !== providerId) return { ok: false, provider: null, companyId, mode: "IDENTITY_MISMATCH", message: "La identidad del proveedor no coincide." };
    if (taxId && provider.taxId !== taxId) return { ok: false, provider: null, companyId, mode: "IDENTITY_MISMATCH", message: "El RUC de la CxP no coincide con el proveedor canónico." };
    return { ok: true, provider, rows: [provider], companyId, mode: "SUPABASE_READ_ONLY" };
  }

  async function providerCatalog(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, rows: [], companyId, mode: remoteRequired() ? "REMOTE_REQUIRED" : "LOCAL_ONLY", message: "El catálogo V2 de proveedores no está disponible en este entorno." };
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, rows: [], companyId, mode: backend.status || "BACKEND_UNAVAILABLE", message: backend.message || "Backend de proveedores no disponible." };
    const pageSize = Math.min(500, Math.max(25, Number(options.pageSize || 500)));
    const rows = [];
    let offset = 0;
    while (true) {
      let query = BlessERP.getSupabaseClient().from("erp_supplier_providers")
        .select(PROVIDER_SELECT)
        .eq("company_id", companyId)
        .order("provider_code", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (options.status) query = query.eq("status", String(options.status).toUpperCase());
      const { data, error } = await query;
      if (error) return { ok: false, rows: [], companyId, mode: "SUPABASE_ERROR", error, message: friendlyError(error) };
      const page = Array.isArray(data) ? data : [];
      rows.push(...page.map(providerRow));
      if (page.length < pageSize) break;
      offset += page.length;
    }
    return { ok: true, rows, total: rows.length, companyId, mode: "SUPABASE_READ_ONLY", paginated: true };
  }

  const repository = Object.freeze({
    activeCompanyUuid,
    canExecute,
    healthStatus,
    probeBackend,
    remoteRequired,
    uuid,
    providerCatalog,
    resolveProvider,
    resolveProvidersByTaxIds,
    providerBalances,
    receptionCostSummary,
    upsertProvider: (payload, options = {}) => command("erp_supplier_v2_upsert_provider", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "SUPPLIER_V2_UPSERT_PROVIDER" }),
    postPurchase: (payload, options = {}) => command("erp_supplier_v2_post_purchase", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "SUPPLIER_V2_POST_PURCHASE", granularCanonical: true }),
    reversePurchase: (purchaseDocumentId, reason, options = {}) => command("erp_supplier_v2_reverse_purchase", {
      p_purchase_document_id: String(purchaseDocumentId || "").trim(),
      p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "SUPPLIER_V2_REVERSE_PURCHASE" }),
    createSettlement: (payload, options = {}) => command("erp_supplier_v2_create_settlement", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "SUPPLIER_V2_CREATE_SETTLEMENT" }),
    reverseSettlement: (settlementId, reason, options = {}) => command("erp_supplier_v2_reverse_settlement", {
      p_settlement_id: String(settlementId || "").trim(), p_reason: String(reason || "").trim(),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "SUPPLIER_V2_REVERSE_SETTLEMENT" }),
    registerPayment: (payload, options = {}) => command("erp_supplier_v2_register_payment", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "SUPPLIER_V2_REGISTER_PAYMENT" }),
    reversePayment: (paymentId, reason, options = {}) => command("erp_supplier_v2_reverse_payment", {
      p_payment_id: String(paymentId || "").trim(), p_reason: String(reason || "").trim(), p_local_created_at: new Date().toISOString()
    }, { ...options, source: "SUPPLIER_V2_REVERSE_PAYMENT" })
  });

  BlessERP.getSupplierFinanceV2Repository = function() { return repository; };
})();
