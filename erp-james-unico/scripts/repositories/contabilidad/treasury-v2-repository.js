(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS=5*60*1000;
  let health={status:"UNKNOWN",companyId:"",checkedAt:0,error:null,data:null};

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(access?.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }

  function remoteRequired() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.treasuryV2CaptureEnabled===true && window.location?.protocol!=="file:");
  }

  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.treasuryV2CaptureEnabled===true
      && typeof BlessERP.getSupabaseClient === "function" && activeCompanyUuid()
      && window.location?.protocol !== "file:");
  }
  function canExecute(){const companyId=activeCompanyUuid();return Boolean(configured()&&health.status==="VERIFIED"&&health.companyId===companyId&&Date.now()-health.checkedAt<=HEALTH_TTL_MS);}
  function healthStatus(){return{...health,available:canExecute()};}
  function healthFailure(error,companyId){const code=String(error?.code||"");const message=String(error?.message||"No se pudo validar Tesorería V2.");const status=["PGRST202","42883"].includes(code)||/schema cache|function .* does not exist/i.test(message)?"BACKEND_MISSING":code==="42501"?"PERMISSION_DENIED":"UNAVAILABLE";health={status,companyId,checkedAt:Date.now(),error,data:null};return{ok:false,status,companyId,error,message};}
  async function probeBackend(options={}){const companyId=activeCompanyUuid();if(!configured()||!companyId){health={status:"NOT_CONFIGURED",companyId,checkedAt:Date.now(),error:null,data:null};return{ok:false,status:health.status,companyId,message:"Tesorería V2 no está habilitada para este despliegue."};}if(!options.force&&canExecute())return{ok:true,status:"VERIFIED",companyId,data:health.data};health={status:"CHECKING",companyId,checkedAt:Date.now(),error:null,data:null};const client=BlessERP.getSupabaseClient();if(!client?.rpc)return healthFailure({code:"CLIENT_UNAVAILABLE",message:"Cliente Supabase no disponible."},companyId);const{data,error}=await client.rpc("erp_treasury_v2_health",{p_company_id:companyId});if(error)return healthFailure(error,companyId);const result=Array.isArray(data)?data[0]:data;const required=["bankAccountsTable","cashAccountsTable","statementImportsTable","bankTransactionsTable","cashTransactionsTable","transfersTable","reconciliationsTable","matchesTable","reviewsTable","adjustmentsTable","bankBalancesView","cashBalancesView","cashFlowView","upsertBankRpc","upsertCashRpc","registerTransactionRpc","importStatementRpc","saveReconciliationRpc","reconcileRpc","reverseMatchRpc","reviewRpc","statusRpc","transferRpc","adjustmentRpc"];if(!result?.ok||result.component!=="TREASURY_V2"||result.migration!=="202608150011"||required.some(key=>result[key]!==true))return healthFailure({code:"INCOMPLETE_BACKEND",message:"El backend de Tesorería V2 está incompleto o desactualizado."},companyId);health={status:"VERIFIED",companyId,checkedAt:Date.now(),error:null,data:result};return{ok:true,status:health.status,companyId,data:result};}

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.() || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
      });
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value || "").trim());
  }

  async function deviceId(operationId) {
    return String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
  }

  async function applyCanonical(records, source, companyId) {
    for (const record of records) {
      if (companyId !== activeCompanyUuid()) throw new Error("La empresa cambió durante la confirmación de Tesorería.");
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(record, {
        source, force: true, forceServer: true, ignoreRecordHold: true, ignoreEditGuard: true
      });
      if (applied && applied.ok === false) throw new Error("Supabase confirmó Tesorería, pero no se pudo aplicar su registro canónico.");
    }
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
          ? "Sin conexión confirmada con Supabase. La operación de Tesorería no fue confirmada."
          : "Tesorería V2 no confirma operaciones en el HTML estrictamente local."
      };
    }
    const backend=await probeBackend();
    if(!backend.ok||!canExecute())return{ok:false,mode:backend.status||"BACKEND_UNAVAILABLE",operationId,error:backend.error,message:backend.message||"Tesorería V2 no está disponible en Supabase."};
    const commandDeviceId = await deviceId(operationId);
    if (companyId !== activeCompanyUuid()) return { ok:false, message:"La empresa cambió antes de enviar Tesorería." };
    console.info("[jaeder-v2-command]",{flow:"TREASURY_V2",rpc:rpcName,operationId,companyId});
    const { data, error } = await BlessERP.getSupabaseClient().rpc(rpcName, {
      p_operation_id: operationId,
      p_company_id: companyId,
      p_device_id: commandDeviceId,
      ...parameters
    });
    if (companyId !== activeCompanyUuid()) return { ok:false, message:"La empresa cambió; consulte la operación en su empresa de origen." };
    if (error) return { ok: false, mode: "SUPABASE_ERROR", operationId, error, message: error.message || "Supabase rechazó la operación de Tesorería." };
    const result = Array.isArray(data) ? data[0] : data;
    const records = Array.isArray(result?.records) ? result.records : [];
    if (!result?.ok) return { ok: false, mode: "INVALID_RESPONSE", operationId, message: result?.message || "Supabase no confirmó Tesorería." };
    if (!records.length || records.some(r => r.company_id !== companyId || r.deleted_at || !r.payload || Number(r.version || 0) < 1)) return { ok:false, mode:"INVALID_CANONICAL_PROOF", message:"Supabase no devolvió registros canónicos válidos de esta empresa." };
    try { await applyCanonical(records, options.source || "TREASURY_V2_COMMAND", companyId); }
    catch (error) { return { ok: false, mode: "CANONICAL_CACHE_ERROR", operationId, message: error.message }; }
    return { ok: true, confirmed: true, mode: "SUPABASE_TRANSACTION_CONFIRMED", operationId, records,
      serverTime: String(result.serverTime || ""), result: result.result || {} };
  }

  async function queryView(view, filters = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) return { ok: false, rows: [], message: "Supabase Tesorería no disponible." };
    const backend=await probeBackend(); if(!backend.ok||!canExecute())return{ok:false,rows:[],message:backend.message||"Backend de Tesorería no disponible."};
    const columnsByView = {
      erp_treasury_bank_accounts: "company_id,bank_account_id,legacy_id,account_code,bank_name,currency_code,ledger_account_code,opening_balance,opening_balance_date,status",
      erp_treasury_v2_bank_balances: "company_id,bank_account_id,account_code,bank_name,currency_code,opening_balance,bank_statement_balance,expected_treasury_balance,book_balance",
      erp_treasury_v2_cash_balances: "company_id,cash_account_id,account_code,name,currency_code,current_balance,book_balance",
      erp_treasury_v2_cash_flow: "company_id,account_type,account_id,flow_date,currency_code,flow_kind,net_amount"
    };
    const columns = columnsByView[view];
    if (!columns) return { ok: false, rows: [], mode: "VIEW_NOT_ALLOWED", message: "La consulta de Tesorería solicitada no está permitida." };
    let query = BlessERP.getSupabaseClient().from(view).select(columns).eq("company_id", companyId);
    Object.entries(filters).forEach(([column, value]) => {
      if (value !== undefined && value !== null && value !== "") query = query.eq(column, value);
    });
    const { data, error } = await query;
    if (companyId !== activeCompanyUuid()) return { ok:false, rows:[], message:"La empresa cambió durante la consulta bancaria." };
    return error ? { ok: false, rows: [], error, message: error.message } : { ok: true, rows: data || [] };
  }

  const repository = Object.freeze({
    activeCompanyUuid, canExecute, healthStatus, isUuid, probeBackend, remoteRequired, uuid,
    bankAccountCatalog: () => queryView("erp_treasury_bank_accounts", { status: "ACTIVE" }),
    upsertBankAccount: (payload, options = {}) => command("erp_treasury_v2_upsert_bank_account", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_BANK_ACCOUNT" }),
    upsertCashAccount: (payload, options = {}) => command("erp_treasury_v2_upsert_cash_account", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_CASH_ACCOUNT" }),
    registerTransaction: (payload, options = {}) => command("erp_treasury_v2_register_transaction", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_TRANSACTION" }),
    findBankAccountByLegacyId: legacyId => queryView("erp_treasury_bank_accounts", { legacy_id: String(legacyId || "").trim() }),
    importStatement: (bankAccountId, fileName, fileFingerprint, rows, options = {}) => {
      const canonicalId = String(bankAccountId || "").trim();
      if (!isUuid(canonicalId)) {
        return Promise.resolve({
          ok: false,
          confirmed: false,
          mode: "VALIDATION_ERROR",
          code: "BANK_ACCOUNT_NOT_CANONICAL",
          message: "La cuenta seleccionada debe confirmarse en Tesorería V2 antes de importar el estado de cuenta.",
          errors: ["La cuenta seleccionada debe confirmarse en Tesorería V2 antes de importar el estado de cuenta."]
        });
      }
      return command("erp_treasury_v2_import_statement", {
        p_bank_account_id: canonicalId, p_file_name: String(fileName || ""),
        p_file_fingerprint: String(fileFingerprint || ""), p_rows: rows,
        p_local_created_at: new Date().toISOString()
      }, { ...options, source: "TREASURY_V2_STATEMENT_IMPORT" });
    },
    saveReconciliation: (payload, options = {}) => command("erp_treasury_v2_save_reconciliation", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_RECONCILIATION" }),
    reconcile: (reconciliationId, matches, notes, options = {}) => command("erp_treasury_v2_reconcile", {
      p_reconciliation_id: String(reconciliationId || ""), p_matches: matches, p_notes: String(notes || ""),
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_MATCH" }),
    reverseMatch: (matchId, reason, options = {}) => command("erp_treasury_v2_reverse_match", {
      p_match_id: String(matchId || ""), p_reason: String(reason || ""), p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_REVERSE_MATCH" }),
    reviewReconciliation: (reconciliationId, side, recordId, action, observation, options = {}) => command("erp_treasury_v2_review_reconciliation", {
      p_reconciliation_id: String(reconciliationId || ""), p_side: String(side || ""), p_record_id: String(recordId || ""),
      p_action: String(action || "SET"), p_observation: String(observation || ""), p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_RECONCILIATION_REVIEW" }),
    setReconciliationStatus: (reconciliationId, action, payload = {}, options = {}) => command("erp_treasury_v2_set_reconciliation_status", {
      p_reconciliation_id: String(reconciliationId || ""), p_action: String(action || ""), p_payload: payload,
      p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_RECONCILIATION_STATUS" }),
    transfer: (payload, options = {}) => command("erp_treasury_v2_transfer", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_TRANSFER" }),
    registerAdjustment: (payload, options = {}) => command("erp_treasury_v2_register_adjustment", {
      p_payload: payload, p_local_created_at: new Date().toISOString()
    }, { ...options, source: "TREASURY_V2_ADJUSTMENT" }),
    bankBalances: filters => queryView("erp_treasury_v2_bank_balances", filters),
    cashBalances: filters => queryView("erp_treasury_v2_cash_balances", filters),
    cashFlow: filters => queryView("erp_treasury_v2_cash_flow", filters)
  });

  BlessERP.getTreasuryV2Repository = function() { return repository; };
})();
