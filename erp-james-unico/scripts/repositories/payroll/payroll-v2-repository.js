(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, error: null, data: null };

  let generation = 0, currentContext = null, healthRequest = 0, sessionInactive = false;
  const contextListeners = new Set(), readRequests = new Map();
  function contextError() {
    return { ok:false,confirmed:false,code:"PAYROLL_COMPANY_CONTEXT_MISMATCH",status:"CONTEXT_CHANGED",
      message:"La empresa o los datos de Nómina cambiaron. Vuelva a cargar la empresa actual antes de guardar." };
  }
  function context() {
    const access = BlessERP.authAccess?.activeAccess?.() || {};
    const selected = String(BlessERP.services?.companyContext?.activeCompanyId?.() || access.activeCompany?.id || "");
    const company = (access.companies || []).find(row => [row.id,row.company_key].includes(selected))
      || ([access.activeCompany?.id,access.activeCompany?.company_key].includes(selected) ? access.activeCompany : null);
    const companyId = sessionInactive?"":String(company?.id || ""), actorId = sessionInactive?"":String(access.session?.user?.id || "");
    if (!currentContext || currentContext.companyId !== companyId || currentContext.actorId !== actorId) resetContext(companyId,actorId);
    return currentContext;
  }
  function resetContext(companyId,actorId) {
    currentContext = Object.freeze({companyId,actorId,generation:++generation});
    health = {status:"UNKNOWN",companyId,checkedAt:0,error:null,data:null};
    healthRequest++; readRequests.clear();
    for (const listener of contextListeners) listener(currentContext);
  }
  function isContextCurrent(expected) {
    const actual = context();
    return Boolean(expected && actual.companyId && actual.actorId && expected.companyId === actual.companyId
      && expected.actorId === actual.actorId && expected.generation === actual.generation);
  }
  function matchesCompany(value,expected) {
    if (!value || typeof value !== "object") return true;
    if (Array.isArray(value)) return value.every(item=>matchesCompany(item,expected));
    return Object.entries(value).every(([key,item]) => ["company_id","companyId"].includes(key)
      ? item === expected.companyId : matchesCompany(item,expected));
  }
  function onContextChange(listener) { contextListeners.add(listener); return ()=>contextListeners.delete(listener); }
  function activeCompanyUuid() { return context().companyId; }
  window.addEventListener("erp:company-changed",()=>{
    const before=currentContext, next=context();
    if(before===next) resetContext(next.companyId,next.actorId);
  });
  window.addEventListener("erp:session-status",event=>{
    if(event.detail?.active===false){sessionInactive=true;resetContext("","");}
    else if(event.detail?.active===true){sessionInactive=false;context();}
  });
  function configured() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.incrementalSyncEnabled && config.payrollV2CaptureEnabled === true
      && typeof BlessERP.getSupabaseClient === "function" && activeCompanyUuid() && window.location?.protocol !== "file:");
  }
  function canExecute() {
    const companyId = activeCompanyUuid();
    return Boolean(configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS && health.data?.permissions?.view === true);
  }
  function healthStatus() { const available=canExecute(); return { ...health, available }; }
  function classifyHealthError(error, companyId) {
    const code = String(error?.code || "");
    const message = String(error?.message || "No se pudo validar Nómina V2.");
    const status = ["PGRST202","42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok:false,status,companyId,error,message };
  }
  async function probeBackend(options = {}) {
    const captured = options.context || context();
    if (!isContextCurrent(captured)) return contextError();
    const companyId = captured.companyId;
    if (!configured() || !companyId) {
      health = { status:"NOT_CONFIGURED",companyId,checkedAt:Date.now(),error:null,data:null };
      return { ok:false,status:health.status,companyId,message:"Nómina V2 no está habilitada en este despliegue." };
    }
    if (!options.force && canExecute()) return { ok:true,status:"VERIFIED",companyId,data:health.data };
    const requestId=++healthRequest;
    health = { status:"CHECKING",companyId,checkedAt:Date.now(),error:null,data:null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return classifyHealthError({ code:"CLIENT_UNAVAILABLE",message:"Cliente Supabase no disponible." },companyId);
    const { data,error } = await client.rpc("erp_payroll_core_v2_health",{ p_company_id:companyId });
    if (!isContextCurrent(captured) || requestId!==healthRequest) return contextError();
    if (error) return classifyHealthError(error,companyId);
    const result = Array.isArray(data) ? data[0] : data;
    const required = ["employeeTable","operationalRoleTable","periodTable","roleTable","snapshotTable","financialDependency","postharvestParameterLink",
      "performancePolicyTable","policyAssignmentTable","policySnapshotTable"];
    if (result?.functionalCore !== "PAYROLL_GO_LIVE_20260907" || result?.okContract !== "PAYROLL_COMMAND_CONFIRMATION_V1"
      || !result?.ok || result.component !== "PAYROLL_CORE_V2" || result.migration !== "202608210003"
      || result.performancePolicy !== "CANONICAL_PERIOD_EXCESS_V1" || result.salaryImpact !== "BASE_470_PLUS_PERIOD_EXCESS"
      || result.performanceSource !== "OPERATIONS_PERFORMANCE_V2"
      || result.manualRoleValues !== true || result.serverTotals !== true || result.baseAdjustmentAudit !== true || result.performanceDetailsOnDemand !== true
      || required.some(key => result[key] !== true)) {
      return classifyHealthError({ code:"INCOMPLETE_BACKEND",message:"El backend de Nómina V2 está incompleto o desactualizado." },companyId);
    }
    health = { status:"VERIFIED",companyId,checkedAt:Date.now(),error:null,data:result };
    return { ok:true,status:"VERIFIED",companyId,data:result };
  }
  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.() || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==="x"?r:(r&3|8)).toString(16);});
  }
  async function deviceId(operationId) { return String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0,12)}`); }
  async function ensureBackend(captured) {
    if(!isContextCurrent(captured)) return contextError();
    const checked = await probeBackend({context:captured});
    if(!isContextCurrent(captured)) return contextError();
    return checked.ok && canExecute() ? { ok:true,data:checked.data } : checked;
  }
  async function applyCanonical(records,source,captured) {
    for (const record of records || []) {
      if(!isContextCurrent(captured) || record.company_id!==captured.companyId || !matchesCompany(record,captured)) return contextError();
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(record,{ source,force:true,forceServer:true,ignoreRecordHold:true,ignoreEditGuard:true,
        isContextCurrent:()=>isContextCurrent(captured) });
      if(!isContextCurrent(captured)) return contextError();
      if (applied && applied.ok === false) throw new Error("Supabase confirmó Nómina, pero la caché canónica no pudo actualizarse.");
    }
    return {ok:true};
  }
  async function command(rpcName,parameters,options={}) {
    const captured=options.context;
    if(!isContextCurrent(captured) || !matchesCompany(parameters,captured) || !matchesCompany(options,captured)) return contextError();
    const companyId=captured.companyId, operationId=String(options.operationId||uuid());
    const backend=await ensureBackend(captured);
    if(!isContextCurrent(captured)) return contextError();
    if (!backend.ok) return { ok:false,mode:backend.status||"BACKEND_UNAVAILABLE",operationId,message:backend.message,error:backend.error };
    const device=await deviceId(operationId);
    if(!isContextCurrent(captured)) return contextError();
    console.info("[jaeder-v2-command]",{ flow:"PAYROLL_CORE_V2",rpc:rpcName,operationId,companyId });
    const { data,error }=await BlessERP.getSupabaseClient().rpc(rpcName,{ ...parameters,p_operation_id:operationId,p_company_id:companyId,p_device_id:device });
    if(!isContextCurrent(captured)) return contextError();
    if (error) return { ok:false,mode:"SUPABASE_ERROR",operationId,error,message:error.message||"Supabase rechazó Nómina." };
    const result=Array.isArray(data)?data[0]:data; const records=Array.isArray(result?.records)?result.records:[];
    if(!matchesCompany(result,captured) || records.some(row=>row.company_id!==companyId)) return contextError();
    if (!result?.ok) return { ok:false,mode:"INVALID_RESPONSE",operationId,message:result?.message||"Respuesta inválida de Nómina V2." };
    if(!BlessERP.payrollV2Contract?.ack(rpcName,result,companyId,operationId,parameters))return BlessERP.payrollV2Contract?.failure()||{ok:false,confirmed:false,code:"PAYROLL_CANONICAL_ACK_REQUIRED"};
    let refreshWarning="";
    try { const applied=await applyCanonical(records,options.source||"PAYROLL_CORE_V2",captured); if(!applied.ok)return applied; }
    catch(error){ if(!isContextCurrent(captured))return contextError(); refreshWarning=BlessERP.payrollV2Contract.refreshWarning; }
    return { ok:true,confirmed:true,mode:"SUPABASE_TRANSACTION_CONFIRMED",operationId,records,result:result.result,serverTime:result.serverTime,refreshWarning };
  }
  async function readRpc(name,parameters={},options={}) {
    const captured=options.context||context();
    if(!isContextCurrent(captured) || !matchesCompany(parameters,captured))return contextError();
    const key=JSON.stringify([captured.companyId,name,parameters]), requestId=(readRequests.get(key)||0)+1;
    readRequests.set(key,requestId);
    const current=()=>isContextCurrent(captured)&&readRequests.get(key)===requestId;
    const backend=await ensureBackend(captured);
    if(!current())return contextError();
    if (!backend.ok) return { ok:false,status:backend.status,message:backend.message,error:backend.error };
    const { data,error }=await BlessERP.getSupabaseClient().rpc(name,{ ...parameters,p_company_id:captured.companyId });
    if(!current())return contextError();
    if (error) return { ok:false,error,message:error.message };
    const result=Array.isArray(data)?data[0]:data;
    if(!matchesCompany(result,captured))return contextError();
    return result;
  }

  async function getPrintBundle(companyId,roleId){
    const captured=context();
    if(!isContextCurrent(captured)||companyId!==captured.companyId||!roleId)return contextError();
    const {data,error}=await BlessERP.getSupabaseClient().rpc("erp_payroll_core_v2_get_print_bundle",{p_company_id:companyId,p_role_id:roleId});
    // A company switch must not rewrite an already requested document. A user/session switch still cancels it.
    if(!context().actorId||context().actorId!==captured.actorId)return contextError();
    if(error)return {ok:false,message:error.message||"No se pudo consultar el rol para imprimir."};
    const result=Array.isArray(data)?data[0]:data;
    if(result?.ok!==true||result.contract!=="PAYROLL_PRINT_V1"||result.companyId!==companyId||result.company?.company_id!==companyId
      ||result.role?.company_id!==companyId||result.role?.role_id!==roleId
      ||result.period?.company_id!==companyId||result.period?.period_id!==result.role?.period_id
      ||!matchesCompany(result,{companyId}))return {ok:false,code:"PAYROLL_PRINT_CANONICAL_COMPANY_REQUIRED",message:"No se pudo validar la empresa y el período del documento."};
    return result;
  }
  const repository=Object.freeze({
    activeCompanyUuid,configured,canExecute,healthStatus,probeBackend,uuid,context,isContextCurrent,matchesCompany,contextError,onContextChange,getPrintBundle,
    getBundle: (roleId,options={})=>readRpc("erp_payroll_core_v2_get_bundle",{ p_role_id:roleId||null },options),
    getPerformance:(employeeId,periodId,options={})=>readRpc("erp_payroll_core_v2_get_performance",{ p_employee_id:employeeId,p_period_id:periodId },options),
    upsertEmployee:(payload,options={})=>command("erp_payroll_core_v2_upsert_employee",{ p_payload:payload,p_expected_version:options.expectedVersion??null,p_local_created_at:new Date().toISOString() },{...options,payloadContext:payload,source:"PAYROLL_V2_EMPLOYEE"}),
    linkOperationalRole:(payload,options={})=>command("erp_payroll_core_v2_link_operational_role",{ p_employee_id:payload.employeeId,p_operational_role:payload.operationalRole,p_operational_worker_id:payload.operationalWorkerId,p_valid_from:payload.validFrom,p_valid_to:payload.validTo||null,p_active:payload.active!==false,p_local_created_at:new Date().toISOString() },{...options,payloadContext:payload,source:"PAYROLL_V2_OPERATIONAL_ROLE"}),
    savePerformancePolicy:(payload,options={})=>command("erp_payroll_performance_v2_save_policy",{ p_payload:payload,p_prior_policy_id:options.priorPolicyId||null,p_expected_version:options.expectedVersion??null,p_local_created_at:new Date().toISOString() },{...options,payloadContext:payload,source:"PAYROLL_V2_PERFORMANCE_POLICY"}),
    assignPerformancePolicy:(payload,options={})=>command("erp_payroll_performance_v2_assign_policy",{ p_employee_id:payload.employeeId,p_policy_id:payload.policyId,p_valid_from:payload.validFrom,p_valid_to:payload.validTo||null,p_active:payload.active!==false,p_local_created_at:new Date().toISOString() },{...options,payloadContext:payload,source:"PAYROLL_V2_POLICY_ASSIGNMENT"}),
    createPeriod:(payload,options={})=>command("erp_payroll_core_v2_create_period",{ p_year:Number(payload.year),p_month:Number(payload.month),p_date_from:payload.dateFrom,p_date_to:payload.dateTo,p_local_created_at:new Date().toISOString() },{...options,payloadContext:payload,source:"PAYROLL_V2_PERIOD"}),
    calculateRole:(periodId,payload,options={})=>command("erp_payroll_core_v2_calculate_role",{ p_period_id:periodId,p_payload:payload,p_expected_version:options.expectedVersion??null,p_local_created_at:new Date().toISOString() },{...options,payloadContext:payload,source:"PAYROLL_V2_ROLE_CALCULATE"}),
    approveRole:(roleId,version,options={})=>command("erp_payroll_core_v2_approve_role",{ p_role_id:roleId,p_expected_version:Number(version),p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_ROLE_APPROVE"}),
    postRole:(roleId,version,accountingDate,options={})=>command("erp_payroll_core_v2_post_role",{ p_role_id:roleId,p_expected_version:Number(version),p_accounting_date:accountingDate||null,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_ROLE_POST"}),
    saveAccountingSettings:(payload,options={})=>command("erp_payroll_core_v2_save_accounting_settings",{ p_payroll_payable_account_code:payload.payrollPayableAccountCode,p_deduction_account_code:payload.deductionAccountCode||"",p_cost_center:payload.costCenter||"",p_default_expense_account_code:payload.defaultExpenseAccountCode||"" },{...options,payloadContext:payload,source:"PAYROLL_V2_ACCOUNTING_SETTINGS"})
  });
  BlessERP.getPayrollV2Repository=()=>repository;
})();
