(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, error: null, data: null };

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(access?.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }
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
  function healthStatus() { return { ...health, available: canExecute() }; }
  function classifyHealthError(error, companyId) {
    const code = String(error?.code || "");
    const message = String(error?.message || "No se pudo validar Nómina V2.");
    const status = ["PGRST202","42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok:false,status,companyId,error,message };
  }
  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      health = { status:"NOT_CONFIGURED",companyId,checkedAt:Date.now(),error:null,data:null };
      return { ok:false,status:health.status,companyId,message:"Nómina V2 no está habilitada en este despliegue." };
    }
    if (!options.force && canExecute()) return { ok:true,status:"VERIFIED",companyId,data:health.data };
    health = { status:"CHECKING",companyId,checkedAt:Date.now(),error:null,data:null };
    const client = BlessERP.getSupabaseClient();
    if (!client?.rpc) return classifyHealthError({ code:"CLIENT_UNAVAILABLE",message:"Cliente Supabase no disponible." },companyId);
    const { data,error } = await client.rpc("erp_payroll_core_v2_health",{ p_company_id:companyId });
    if (error) return classifyHealthError(error,companyId);
    const result = Array.isArray(data) ? data[0] : data;
    const required = ["employeeTable","operationalRoleTable","periodTable","roleTable","snapshotTable","financialDependency","postharvestParameterLink",
      "performancePolicyTable","policyAssignmentTable","policySnapshotTable"];
    if (!result?.ok || result.component !== "PAYROLL_CORE_V2" || result.migration !== "202608210003"
      || result.performancePolicy !== "VERSIONED_MEASUREMENT_V2" || result.salaryImpact !== "NONE"
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
  async function ensureBackend() {
    const checked = await probeBackend();
    return checked.ok && canExecute() ? { ok:true,data:checked.data } : checked;
  }
  async function applyCanonical(records,source) {
    for (const record of records || []) {
      const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(record,{ source,force:true,forceServer:true,ignoreRecordHold:true,ignoreEditGuard:true });
      if (applied && applied.ok === false) throw new Error("Supabase confirmó Nómina, pero la caché canónica no pudo actualizarse.");
    }
  }
  async function command(rpcName,parameters,options={}) {
    const companyId=activeCompanyUuid(); const operationId=String(options.operationId||uuid()); const backend=await ensureBackend();
    if (!backend.ok) return { ok:false,mode:backend.status||"BACKEND_UNAVAILABLE",operationId,message:backend.message,error:backend.error };
    console.info("[jaeder-v2-command]",{ flow:"PAYROLL_CORE_V2",rpc:rpcName,operationId,companyId });
    const { data,error }=await BlessERP.getSupabaseClient().rpc(rpcName,{ p_operation_id:operationId,p_company_id:companyId,p_device_id:await deviceId(operationId),...parameters });
    if (error) return { ok:false,mode:"SUPABASE_ERROR",operationId,error,message:error.message||"Supabase rechazó Nómina." };
    const result=Array.isArray(data)?data[0]:data; const records=Array.isArray(result?.records)?result.records:[];
    if (!result?.ok) return { ok:false,mode:"INVALID_RESPONSE",operationId,message:result?.message||"Respuesta inválida de Nómina V2." };
    try { await applyCanonical(records,options.source||"PAYROLL_CORE_V2"); } catch(error){ return { ok:false,mode:"CANONICAL_CACHE_ERROR",operationId,message:error.message }; }
    return { ok:true,confirmed:true,mode:"SUPABASE_TRANSACTION_CONFIRMED",operationId,records,result:result.result||{},serverTime:result.serverTime };
  }
  async function readRpc(name,parameters={}) {
    const backend=await ensureBackend();
    if (!backend.ok) return { ok:false,status:backend.status,message:backend.message,error:backend.error };
    const { data,error }=await BlessERP.getSupabaseClient().rpc(name,{ p_company_id:activeCompanyUuid(),...parameters });
    if (error) return { ok:false,error,message:error.message };
    return Array.isArray(data)?data[0]:data;
  }

  const repository=Object.freeze({
    activeCompanyUuid,configured,canExecute,healthStatus,probeBackend,uuid,
    getBundle: roleId=>readRpc("erp_payroll_core_v2_get_bundle",{ p_role_id:roleId||null }),
    getPerformance:(employeeId,periodId)=>readRpc("erp_payroll_core_v2_get_performance",{ p_employee_id:employeeId,p_period_id:periodId }),
    upsertEmployee:(payload,options={})=>command("erp_payroll_core_v2_upsert_employee",{ p_payload:payload,p_expected_version:options.expectedVersion??null,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_EMPLOYEE"}),
    linkOperationalRole:(payload,options={})=>command("erp_payroll_core_v2_link_operational_role",{ p_employee_id:payload.employeeId,p_operational_role:payload.operationalRole,p_operational_worker_id:payload.operationalWorkerId,p_valid_from:payload.validFrom,p_valid_to:payload.validTo||null,p_active:payload.active!==false,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_OPERATIONAL_ROLE"}),
    savePerformancePolicy:(payload,options={})=>command("erp_payroll_performance_v2_save_policy",{ p_payload:payload,p_prior_policy_id:options.priorPolicyId||null,p_expected_version:options.expectedVersion??null,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_PERFORMANCE_POLICY"}),
    assignPerformancePolicy:(payload,options={})=>command("erp_payroll_performance_v2_assign_policy",{ p_employee_id:payload.employeeId,p_policy_id:payload.policyId,p_valid_from:payload.validFrom,p_valid_to:payload.validTo||null,p_active:payload.active!==false,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_POLICY_ASSIGNMENT"}),
    createPeriod:(payload,options={})=>command("erp_payroll_core_v2_create_period",{ p_year:Number(payload.year),p_month:Number(payload.month),p_date_from:payload.dateFrom,p_date_to:payload.dateTo,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_PERIOD"}),
    calculateRole:(periodId,payload,options={})=>command("erp_payroll_core_v2_calculate_role",{ p_period_id:periodId,p_payload:payload,p_expected_version:options.expectedVersion??null,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_ROLE_CALCULATE"}),
    approveRole:(roleId,version,options={})=>command("erp_payroll_core_v2_approve_role",{ p_role_id:roleId,p_expected_version:Number(version),p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_ROLE_APPROVE"}),
    postRole:(roleId,version,accountingDate,options={})=>command("erp_payroll_core_v2_post_role",{ p_role_id:roleId,p_expected_version:Number(version),p_accounting_date:accountingDate||null,p_local_created_at:new Date().toISOString() },{...options,source:"PAYROLL_V2_ROLE_POST"}),
    saveAccountingSettings:(payload,options={})=>command("erp_payroll_core_v2_save_accounting_settings",{ p_payroll_payable_account_code:payload.payrollPayableAccountCode,p_deduction_account_code:payload.deductionAccountCode,p_cost_center:payload.costCenter||"" },{...options,source:"PAYROLL_V2_ACCOUNTING_SETTINGS"})
  });
  BlessERP.getPayrollV2Repository=()=>repository;
})();
