(function(){
  const BlessERP=window.BlessERP=window.BlessERP||{};
  let cache={ employees:[],operationalRoles:[],performancePolicies:[],policyAssignments:[],periods:[],roles:[],accountingSettings:{},loadedAt:0 };
  const clone=value=>value===undefined?undefined:(typeof structuredClone==="function"?structuredClone(value):JSON.parse(JSON.stringify(value)));
  const repository=()=>BlessERP.getPayrollV2Repository?.();
  function snapshot(){ return clone(cache); }
  function replace(bundle={}){
    cache={ employees:bundle.employees||[],operationalRoles:bundle.operationalRoles||[],performancePolicies:bundle.performancePolicies||[],
      policyAssignments:bundle.policyAssignments||[],periods:bundle.periods||[],roles:bundle.roles||[],
      accountingSettings:bundle.accountingSettings||{},loadedAt:Date.now() };
    return snapshot();
  }
  async function refresh(roleId=null){ const result=await repository()?.getBundle(roleId); return result?.ok?{ok:true,data:replace(result)}:{...(result||{}),ok:false}; }
  async function mutate(method,args){
    const result=await repository()?.[method]?.(...args);
    if(!result?.ok)return result||{ok:false,message:"Nómina V2 no disponible."};
    const refreshed=await refresh();
    return refreshed.ok?{...result,data:refreshed.data}:{...result,refreshWarning:refreshed.message};
  }
  function employeePayload(value={}){ return {
    employeeId:String(value.employeeId||value.employee_id||""),identification:String(value.identification||"").trim(),
    fullName:String(value.fullName||value.full_name||"").trim(),position:String(value.position||value.position_name||"").trim(),
    area:String(value.area||"").trim(),hireDate:String(value.hireDate||value.hire_date||"").slice(0,10),
    status:String(value.status||"ACTIVE").toUpperCase(),calculationMode:String(value.calculationMode||value.calculation_mode||"FIXED").toUpperCase(),
    monthlySalary:Number(value.monthlySalary??value.monthly_salary??0),hourlyRate:Number(value.hourlyRate??value.hourly_rate??0),
    performanceRate:Number(value.performanceRate??value.performance_rate??0),performanceUnit:String(value.performanceUnit||value.performance_unit||"UNITS").toUpperCase(),
    expenseAccountCode:String(value.expenseAccountCode||value.expense_account_code||"").trim(),
    userId:String(value.userId||value.user_id||"").trim()
  }; }
  const service=Object.freeze({
    snapshot,refresh,health:options=>repository()?.probeBackend(options),
    upsertEmployee:(value,options={})=>mutate("upsertEmployee",[employeePayload(value),options]),
    linkOperationalRole:(value,options={})=>mutate("linkOperationalRole",[value,options]),
    savePerformancePolicy:(value,options={})=>mutate("savePerformancePolicy",[value,options]),
    assignPerformancePolicy:(value,options={})=>mutate("assignPerformancePolicy",[value,options]),
    createPeriod:(value,options={})=>mutate("createPeriod",[value,options]),
    calculateRole:(periodId,value,options={})=>mutate("calculateRole",[periodId,value,options]),
    approveRole:(roleId,version,options={})=>mutate("approveRole",[roleId,version,options]),
    postRole:(roleId,version,date,options={})=>mutate("postRole",[roleId,version,date,options]),
    saveAccountingSettings:(value,options={})=>mutate("saveAccountingSettings",[value,options]),
    getPerformance:(employeeId,periodId)=>repository()?.getPerformance(employeeId,periodId),
    employeePayload
  });
  BlessERP.services=BlessERP.services||{};
  BlessERP.services.payrollV2=service;
})();
