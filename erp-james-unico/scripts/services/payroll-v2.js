(function(){
  const BlessERP=window.BlessERP=window.BlessERP||{};
  const clone=value=>value===undefined?undefined:(typeof structuredClone==="function"?structuredClone(value):JSON.parse(JSON.stringify(value)));
  const repository=()=>BlessERP.getPayrollV2Repository?.();
  const caches=new Map(); let cacheContext=null,refreshRequest=0;
  const empty=context=>({companyId:context.companyId,generation:context.generation,employees:[],operationalRoles:[],performancePolicies:[],policyAssignments:[],periods:[],roles:[],accountingSettings:{},loadedAt:0});
  function reset(context){caches.clear();cacheContext=context;refreshRequest++;caches.set(context.companyId,empty(context));}
  function context(){const current=repository().context();if(cacheContext!==current)reset(current);return current;}
  function snapshot(){const current=context();return clone(caches.get(current.companyId));}
  function fail(){return repository().contextError();}
  repository().onContextChange(reset);
  function known(collection,key,id){return !id||snapshot()[collection].some(row=>String(row[key])===String(id));}
  function validReferences(value){
    if(!value||typeof value!=="object")return true;
    if(Array.isArray(value))return value.every(validReferences);
    const refs={employeeId:['employees','employee_id'],employee_id:['employees','employee_id'],periodId:['periods','period_id'],period_id:['periods','period_id'],roleId:['roles','role_id'],role_id:['roles','role_id'],policyId:['performancePolicies','policy_id'],policy_id:['performancePolicies','policy_id'],priorPolicyId:['performancePolicies','policy_id']};
    return Object.entries(value).every(([key,item])=>refs[key]?known(...refs[key],item):validReferences(item));
  }
  async function refresh(roleId=null,options={}){
    const active=context(), captured=options.context||active, requestId=++refreshRequest;
    if(!repository().isContextCurrent(captured)||!known('roles','role_id',roleId))return fail();
    const result=await repository().getBundle(roleId,{context:captured});
    if(!repository().isContextCurrent(captured)||requestId!==refreshRequest)return fail();
    if(!result?.ok)return {...(result||{}),ok:false};
    if(result.companyId!==captured.companyId||!repository().matchesCompany(result,captured))return fail();
    const next=empty(captured);
    for(const key of ['employees','operationalRoles','performancePolicies','policyAssignments','periods','roles']){
      if(!Array.isArray(result[key])||result[key].some(row=>row.company_id!==captured.companyId))return fail();
      next[key]=result[key];
    }
    if(result.accountingSettings&&Object.keys(result.accountingSettings).length&&result.accountingSettings.company_id!==captured.companyId)return fail();
    next.accountingSettings=result.accountingSettings||{};next.loadedAt=Date.now();
    caches.set(captured.companyId,next);return {ok:true,data:snapshot()};
  }
  async function mutate(method,args,options){
    const captured=options.context;context();
    // Validate original input before employeePayload or a repository mapper drops company metadata.
    if(!repository().isContextCurrent(captured)||!snapshot().loadedAt
      ||!repository().matchesCompany(args,captured)||!repository().matchesCompany(options,captured)||!validReferences(args)||!validReferences(options))return fail();
    const normalized=method==='upsertEmployee'?[employeePayload(args[0])]:args;
    const result=await repository()[method](...normalized,options);
    if(!repository().isContextCurrent(captured))return fail();
    if(!result?.ok)return result||{ok:false,message:"Nómina V2 no disponible."};
    const refreshed=await refresh(null,{context:captured});
    if(!repository().isContextCurrent(captured))return fail();
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
    snapshot,refresh,context,health:options=>repository().probeBackend(options),
    upsertEmployee:(value,options={})=>mutate("upsertEmployee",[value],options),
    linkOperationalRole:(value,options={})=>mutate("linkOperationalRole",[value],options),
    savePerformancePolicy:(value,options={})=>mutate("savePerformancePolicy",[value],options),
    assignPerformancePolicy:(value,options={})=>mutate("assignPerformancePolicy",[value],options),
    createPeriod:(value,options={})=>mutate("createPeriod",[value],options),
    calculateRole:(periodId,value,options={})=>known('periods','period_id',periodId)?mutate("calculateRole",[periodId,value],options):Promise.resolve(fail()),
    approveRole:(roleId,version,options={})=>known('roles','role_id',roleId)?mutate("approveRole",[roleId,version],options):Promise.resolve(fail()),
    postRole:(roleId,version,date,options={})=>known('roles','role_id',roleId)?mutate("postRole",[roleId,version,date],options):Promise.resolve(fail()),
    saveAccountingSettings:(value,options={})=>mutate("saveAccountingSettings",[value],options),
    async getPerformance(employeeId,periodId){
      const captured=context();
      if(!known('employees','employee_id',employeeId)||!known('periods','period_id',periodId))return fail();
      const result=await repository().getPerformance(employeeId,periodId,{context:captured});
      return repository().isContextCurrent(captured)?result:fail();
    },
    employeePayload
  });
  BlessERP.services=BlessERP.services||{};BlessERP.services.payrollV2=service;
})();
