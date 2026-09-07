(function(){
  const BlessERP=window.BlessERP=window.BlessERP||{};
  const esc=value=>BlessERP.utils?.esc?.(value??"")??String(value??"");
  const money=value=>BlessERP.payrollV2Contract.money(value||0);
  const number=(value,decimals=2)=>new Intl.NumberFormat("es-EC",{minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(Number(value||0));
  const today=()=>new Date().toISOString().slice(0,10);
  const freshState=()=>({loading:false,loaded:false,error:"",operation:"",employeeDraft:null,policyDraft:null,runPeriod:"",historyPeriod:"",periodGeneration:0,runNotes:"",runDrafts:{},runEditorId:""});
  const ui={...freshState(),context:null};
  let loadRequest=0,realtimeTimer;
  const service=()=>BlessERP.services?.payrollV2;
  const repo=()=>BlessERP.getPayrollV2Repository?.();

  function resetContext(context){
    clearTimeout(realtimeTimer);loadRequest++;
    Object.assign(ui,freshState(),{context});
  }
  function alignContext(){const current=repo().context();if(ui.context!==current)resetContext(current);return current;}
  const current=context=>repo().isContextCurrent(context)&&ui.context===context;
  repo().onContextChange(context=>{
    resetContext(context);
    if(String(BlessERP.state?.state?.route||'').startsWith('payroll-'))rerender();
  });
  function data(){return service()?.snapshot?.()||{employees:[],operationalRoles:[],performancePolicies:[],policyAssignments:[],periods:[],roles:[]};}
  function permissions(){
    const capabilities=new Set(data().refreshRequired?[]:(repo()?.healthStatus?.()?.data?.capabilities||[]));
    return {employeesManage:capabilities.has('payroll.employees.manage'),policiesManage:capabilities.has('payroll.performance_policies.manage'),
      accountingManage:capabilities.has('payroll.accounting_settings.manage'),calculate:capabilities.has('payroll.roles.calculate'),
      approve:capabilities.has('payroll.roles.approve'),replace:capabilities.has('payroll.roles.approve')&&capabilities.has('payroll.roles.calculate'),
      post:capabilities.has('payroll.roles.post'),print:capabilities.has('payroll.roles.print')};
  }
  function value(row,snake,camel=snake){return row?.[snake]??row?.[camel];}
  function employeeId(row){return String(value(row,"employee_id","employeeId")||"");}
  function policyId(row){return String(value(row,"policy_id","policyId")||"");}
  function roleItemId(row){return String(value(row,"role_item_id","roleItemId")||"");}
  function statusActive(row){return row?.active!==false&&!value(row,"valid_to","validTo");}
  function policyById(id,d=data()){return (d.performancePolicies||[]).find(row=>policyId(row)===String(id));}
  function employeeLinks(id,d=data()){return (d.operationalRoles||[]).filter(row=>String(value(row,"employee_id","employeeId"))===String(id)&&statusActive(row));}
  function periodLinks(id,d=data()){
    const month=ui.runPeriod||currentMonth(),from=month+'-01',to=month+'-'+new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
    return (d.operationalRoles||[]).filter(l=>l.company_id===d.companyId&&String(value(l,'employee_id','employeeId'))===String(id)
      &&['CLASSIFIER','BUNCHER'].includes(value(l,'operational_role','operationalRole'))
      &&(l.active!==false||value(l,'valid_to','validTo'))&&value(l,'valid_from','validFrom')<=to
      &&(!value(l,'valid_to','validTo')||value(l,'valid_to','validTo')>=from));
  }
  const performanceSnapshot=item=>value(item,'performance_calculation_snapshot','performanceCalculationSnapshot');
  function performanceDetail(p){
    if(p?.contract!=='PAYROLL_PERIOD_EXCESS_470_V1')return '';
    const buncher=p.operationalRole==='BUNCHER',unit=buncher?'bunches':'mallas';
    return '<div class="payroll-performance-result"><strong>'+(buncher?'Embonchador':'Clasificador')+' · rendimiento del período</strong><p>Días laborados: '+esc(p.workedDays)+' · Jornada referencial: 8 horas</p><p>Meta diaria: '+number(p.dailyTarget)+' '+unit+' · Meta del período: '+number(p.periodTarget)+' '+unit+'</p><p>Rendimiento real: '+number(p.actualUnits)+' · Excedente: '+number(p.excessUnits)+'</p><p>Base: '+money(p.baseSalary)+' · Extra: '+money(p.extraPay)+'</p></div>';
  }
  function employeeAssignments(id,d=data()){return (d.policyAssignments||[]).filter(row=>String(value(row,"employee_id","employeeId"))===String(id)&&statusActive(row));}
  function assignedPolicies(id,d=data()){return employeeAssignments(id,d).map(row=>policyById(value(row,"policy_id","policyId"),d)).filter(Boolean);}
  function requestFailure(){return {ok:false,code:'PAYROLL_REQUEST_FAILED',message:'No se pudo confirmar Nómina con el servidor. Revise la conexión y vuelva a consultar el estado antes de reintentar.'};}
  function notify(result,success){BlessERP.layout?.toast?.(result?.ok?(result.refreshWarning||success):(result?.message||"Operación no confirmada."));return result?.ok;}
  function rerender(){BlessERP.layout?.renderPage?.();}
  async function load(force=false,captured=alignContext()){
    if(!current(captured)||(ui.loading&&!force))return;
    const requestId=++loadRequest,valid=()=>current(captured)&&requestId===loadRequest;
    ui.loading=true;ui.error="";
    try{
    const health=await service().health({force,context:captured});
    if(!valid())return;
    if(!health?.ok){ui.error=health?.message||"Nómina V2 no disponible.";ui.loaded=false;ui.loading=false;return rerender();}
    const result=await service().refresh(null,{context:captured});
    if(!valid())return;
    ui.loading=false;ui.loaded=Boolean(result?.ok);ui.error=result?.ok?"":result?.message||"No se pudo cargar Nómina V2.";rerender();
    }catch(error){if(!valid())return;ui.loading=false;ui.loaded=false;ui.error=requestFailure().message;rerender();}
  }
  function header(route){return `<section class="payroll-page-header"><div><p class="section-kicker">TALENTO HUMANO · NÓMINA V2</p><h1>${esc(route.title)}</h1><p>${esc(route.description)}</p></div><span class="status-badge authorized">SUPABASE CANÓNICO</span></section>${data().refreshRequired?'<article class="panel-card"><p>'+esc(BlessERP.payrollV2Contract.refreshWarning)+'</p><button class="secondary-button" data-payroll-v2-retry>Actualizar vista</button></article>':""}`;}
  function unavailable(route){const health=repo()?.healthStatus?.()||{};return `<section class="payroll-page">${header(route)}<article class="panel-card"><h3>${ui.loading?"Verificando Nómina V2…":"Módulo no disponible"}</h3><p>${esc(ui.error||health.error?.message||"El backend debe confirmarse antes de operar.")}</p><button class="secondary-button" data-payroll-v2-retry>Reintentar health-check</button></article></section>`;}
  function field(label,control,helper=""){return `<label class="compact-field"><span>${esc(label)}</span>${control}${helper?`<small>${esc(helper)}</small>`:""}</label>`;}
  function conceptEnabled(code,d=data()){return (d.conceptSettings||[]).some(row=>row.company_id===d.companyId&&row.concept_code===code&&row.enabled===true);}
  function accountSelect(name,selected,purpose,inherit=false){
    const d=data(),choices=BlessERP.payrollV2Contract.accountOptions(d.accountOptions,d.companyId,purpose);
    const valid=!selected||choices.some(a=>a.code===selected),empty=inherit?'__INHERIT__':'';
    const caption=inherit?'Heredar configuración de Nómina'+(d.accountDefaults?.default_expense_account_code?' ('+d.accountDefaults.default_expense_account_code+')':' (pendiente de configurar)'):'Sin configurar';
    return '<select name="'+name+'" '+(inherit?'required':'')+'>'
      +(!valid?'<option value="" selected disabled>Cuenta actual no disponible: seleccione una opción</option>':'')
      +'<option value="'+empty+'" '+(!selected?'selected':'')+'>'+esc(caption)+'</option>'
      +choices.map(a=>'<option value="'+esc(a.code)+'" '+(a.code===selected?'selected':'')+'>'+esc(a.code+' · '+a.name)+'</option>').join('')+'</select>';
  }
  function conceptsPanel(d){
    const rows=d.conceptSettings||[],labels=BlessERP.payrollV2Contract.labels;
    return '<article class="panel-card"><h3>Conceptos de Nómina de esta empresa</h3><p><strong>Habilitados:</strong> '+rows.filter(r=>r.enabled).map(r=>esc(labels[r.concept_code]||r.concept_code)).join(' · ')+'</p>'
      +'<p><strong>Desactivados / no utilizados:</strong> '+rows.filter(r=>!r.enabled).map(r=>esc(labels[r.concept_code]||r.concept_code)).join(' · ')+'</p>'
      +'<small>Las descripciones de otros ingresos y egresos identifican conceptos manuales; no activan fórmulas de beneficios.</small></article>';
  }
  function modeLabel(mode){return ({FIXED:"Sueldo fijo",FIXED_MANUAL_HOURS:"Sueldo fijo + horas manuales",FIXED_PERFORMANCE:"Sueldo fijo + rendimiento",MONTHLY:"Mensual (histórico)",HOURLY:"Por hora (histórico)",PERFORMANCE:"Por unidad (histórico)",MIXED:"Mixto (histórico)"})[String(mode||"").toUpperCase()]||mode;}
  function modeOptions(current="FIXED"){
    const standard=[["FIXED","Sueldo fijo"],["FIXED_MANUAL_HOURS","Sueldo fijo + horas manuales"],["FIXED_PERFORMANCE","Sueldo fijo + rendimiento"]];
    const normalized=String(current||"FIXED").toUpperCase();
    if(!standard.some(([item])=>item===normalized))standard.push([normalized,`${modeLabel(normalized)} · compatibilidad histórica`]);
    return standard.map(([item,label])=>`<option value="${esc(item)}" ${item===normalized?"selected":""}>${esc(label)}</option>`).join("");
  }
  function employeeForm(perms){
    if(!perms.employeesManage)return "";
    const draft=ui.employeeDraft||{status:"ACTIVE",calculation_mode:"FIXED",monthly_salary:0,hourly_rate:0};
    const id=employeeId(draft);const mode=value(draft,"calculation_mode","calculationMode")||"FIXED";
    const linkedUser=String(value(draft,"user_id","userId")||"");
    const users=BlessERP.services?.adminConfig?.visualUsers?.({status:"activo"})||[];
    return `<form class="panel-card payroll-form-grid payroll-v2-employee-editor" data-payroll-v2-employee-form>
      <div class="panel-card-head payroll-form-span"><div><p class="section-kicker">PERSONAL</p><h3>${id?"Editar empleado V2":"Nuevo empleado V2"}</h3></div>${id?'<button type="button" class="secondary-button" data-payroll-v2-employee-reset>Cancelar edición</button>':""}</div>
      <input type="hidden" name="employeeId" value="${esc(id)}"><input type="hidden" name="expectedVersion" value="${esc(draft.version||"")}">
      ${field("Cédula / identificación",`<input name="identification" required value="${esc(draft.identification||"")}">`)}
      ${field("Nombres",`<input name="fullName" required value="${esc(value(draft,"full_name","fullName")||"")}">`)}
      ${field("Cargo",`<input name="position" value="${esc(value(draft,"position_name","position")||"")}">`)}
      ${field("Área",`<input name="area" value="${esc(draft.area||"")}">`)}
      ${field("Usuario ERP vinculado",`<select name="userId"><option value="">Sin vínculo</option>${users.map(user=>`<option value="${esc(user.id)}" ${String(user.id)===linkedUser?"selected":""}>${esc(user.fullName||user.name||user.email||user.id)}</option>`).join("")}</select>`,`Se usa el UUID de autenticación; nunca se relaciona por nombre.`)}
      ${field("Fecha ingreso",`<input name="hireDate" type="date" value="${esc(value(draft,"hire_date","hireDate")||"")}">`)}
      ${field("Modalidad",`<select name="calculationMode">${modeOptions(mode)}</select>`)}
      ${field("Sueldo individual",`<input name="monthlySalary" type="number" min="0" step=".01" value="${esc(value(draft,"monthly_salary","monthlySalary")||0)}">`,`Clasificadores y embonchadores vinculados usan base 470 y excedente acumulado por período.`)}
      ${field("Tarifa hora manual",`<input name="hourlyRate" type="number" min="0" step=".00000001" value="${esc(value(draft,"hourly_rate","hourlyRate")||0)}">`)}
      ${field("Cuenta de gasto",accountSelect("expenseAccountCode",value(draft,"expense_account_code","expenseAccountCode")||"","EXPENSE",true),"La cuenta efectiva se copia al calcular. Los roles calculados requieren revisión si cambia la configuración.")}
      ${field("Estado",`<select name="status"><option value="ACTIVE" ${draft.status!=="INACTIVE"?"selected":""}>Activo</option><option value="INACTIVE" ${draft.status==="INACTIVE"?"selected":""}>Inactivo</option></select>`)}
      <div class="payroll-form-actions payroll-form-span"><button class="primary-button">${id?"Guardar empleado":"Crear empleado V2"}</button></div>
    </form>`;
  }
  function policyDraftFrom(row={}){return {
    priorPolicyId:policyId(row),expectedVersion:row.version||"",code:row.code||"",name:row.name||"",
    operationalRole:value(row,"operational_role","operationalRole")||"BUNCHER",salaryType:value(row,"salary_type","salaryType")||"FIXED_PERFORMANCE",
    baseSalary:value(row,"base_salary","baseSalary")??470,standardWorkdays:value(row,"standard_workdays","standardWorkdays")??21,
    primaryUnit:value(row,"primary_unit","primaryUnit")||"BUNCH",dailyTarget:value(row,"daily_target","dailyTarget")??200,
    monthlyTarget:value(row,"monthly_target","monthlyTarget")??4200,referenceStems:value(row,"reference_stems","referenceStems")??105000,
    stemsPerUnit:value(row,"stems_per_unit","stemsPerUnit")??25,validFrom:today(),validTo:""
  };}
  function policyForm(perms){
    if(!perms.policiesManage)return "";
    const draft=ui.policyDraft||policyDraftFrom();const versioning=Boolean(draft.priorPolicyId);
    return `<form class="panel-card payroll-policy-form" data-payroll-v2-policy-form>
      <div class="panel-card-head payroll-form-span"><div><p class="section-kicker">POLÍTICAS DE RENDIMIENTO</p><h3>${versioning?"Crear nueva versión":"Nueva política"}</h3><p>Configuración económica y metas; no altera el rendimiento físico de Poscosecha.</p></div>${versioning?'<button type="button" class="secondary-button" data-payroll-v2-policy-reset>Cancelar versión</button>':""}</div>
      <input type="hidden" name="priorPolicyId" value="${esc(draft.priorPolicyId||"")}"><input type="hidden" name="expectedVersion" value="${esc(draft.expectedVersion||"")}">
      ${field("Código",`<input name="code" required value="${esc(draft.code)}" ${versioning?"readonly":""}>`)}
      ${field("Nombre",`<input name="name" required value="${esc(draft.name)}">`)}
      ${field("Rol operativo",`<select name="operationalRole" ${versioning?"disabled":""}><option value="BUNCHER" ${draft.operationalRole==="BUNCHER"?"selected":""}>Embonchador</option><option value="CLASSIFIER" ${draft.operationalRole==="CLASSIFIER"?"selected":""}>Clasificador</option></select><input type="hidden" name="operationalRoleFallback" value="${esc(draft.operationalRole)}">`)}
      ${field("Modalidad",`<select name="salaryType"><option value="FIXED_PERFORMANCE" ${draft.salaryType==="FIXED_PERFORMANCE"?"selected":""}>Sueldo fijo + rendimiento</option><option value="FIXED" ${draft.salaryType==="FIXED"?"selected":""}>Sueldo fijo</option><option value="FIXED_MANUAL_HOURS" ${draft.salaryType==="FIXED_MANUAL_HOURS"?"selected":""}>Sueldo fijo + horas manuales</option></select>`)}
      ${field("Sueldo base",`<input name="baseSalary" type="number" min="0" step=".01" value="${esc(draft.baseSalary)}" required>`,`No se multiplica por el porcentaje de cumplimiento.`)}
      ${field("Días estándar",`<input name="standardWorkdays" type="number" min="1" max="31" value="${esc(draft.standardWorkdays)}" required>`)}
      ${field("Unidad principal",`<select name="primaryUnit" ${versioning?"disabled":""}><option value="BUNCH" ${draft.primaryUnit==="BUNCH"?"selected":""}>Ramo</option><option value="MESH" ${draft.primaryUnit==="MESH"?"selected":""}>Malla</option></select><input type="hidden" name="primaryUnitFallback" value="${esc(draft.primaryUnit)}">`)}
      ${field("Meta diaria",`<input name="dailyTarget" type="number" min=".00000001" step=".01" value="${esc(draft.dailyTarget)}" required>`)}
      ${field("Meta estándar del período",`<input name="monthlyTarget" type="number" min=".00000001" step=".01" value="${esc(draft.monthlyTarget)}" required>`)}
      ${field("Referencia tallos",`<input name="referenceStems" type="number" min="0" step="1" value="${esc(draft.referenceStems)}" required>`)}
      ${field("Tallos por unidad",`<input name="stemsPerUnit" type="number" min=".00000001" step=".01" value="${esc(draft.stemsPerUnit)}" required>`)}
      ${field("Vigente desde",`<input name="validFrom" type="date" value="${esc(draft.validFrom)}" required>`)}
      ${field("Vigente hasta",`<input name="validTo" type="date" value="${esc(draft.validTo||"")}">`)}
      <div class="payroll-form-actions payroll-form-span"><button class="primary-button">${versioning?"Crear nueva versión":"Crear política"}</button></div>
    </form>`;
  }
  function policySummary(policy){const unit=value(policy,"primary_unit","primaryUnit")==="BUNCH"?"ramos":"mallas";return `<div class="payroll-policy-summary"><strong>${esc(policy.name)}</strong><span>${money(value(policy,"base_salary","baseSalary"))} · ${esc(modeLabel(value(policy,"salary_type","salaryType")))}</span><span>${number(value(policy,"daily_target","dailyTarget"),0)} ${unit}/día · ${number(value(policy,"monthly_target","monthlyTarget"),0)} ${unit}/período</span><span>${number(value(policy,"reference_stems","referenceStems"),0)} tallos de referencia</span></div>`;}
  function policiesTable(d,perms){return `<article class="panel-card payroll-table-wrap"><div class="panel-card-head"><div><p class="section-kicker">VIGENCIAS</p><h3>Políticas canónicas</h3></div><span class="status-badge partial">VERSIONADAS</span></div><table class="compact-table payroll-table"><thead><tr><th>Código / versión</th><th>Política</th><th>Meta</th><th>Referencia</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead><tbody>${(d.performancePolicies||[]).map(policy=>{const active=statusActive(policy);const unit=value(policy,"primary_unit","primaryUnit")==="BUNCH"?"ramos":"mallas";return `<tr><td><strong>${esc(policy.code)}</strong><br><small>v${esc(value(policy,"policy_version","policyVersion"))}</small></td><td>${esc(policy.name)}<br><small>${money(value(policy,"base_salary","baseSalary"))} · ${esc(modeLabel(value(policy,"salary_type","salaryType")))}</small></td><td>${number(value(policy,"daily_target","dailyTarget"),0)} ${unit}/día<br><strong>${number(value(policy,"monthly_target","monthlyTarget"),0)} ${unit}</strong></td><td>${number(value(policy,"reference_stems","referenceStems"),0)} tallos<br><small>${number(value(policy,"stems_per_unit","stemsPerUnit"),0)} por unidad</small></td><td>${esc(value(policy,"valid_from","validFrom"))}<br><small>${esc(value(policy,"valid_to","validTo")||"Sin fin")}</small></td><td><span class="status-badge ${active?"authorized":"pending"}">${active?"VIGENTE":"HISTÓRICA"}</span></td><td>${active&&perms.policiesManage?`<button class="secondary-button" data-payroll-v2-policy-version="${esc(policyId(policy))}">Nueva versión</button>`:""}</td></tr>`;}).join("")||'<tr><td colspan="7" class="empty-row">Sin políticas.</td></tr>'}</tbody></table></article>`;}
  function employeesTable(d,perms){return `<article class="panel-card payroll-table-wrap"><div class="panel-card-head"><div><p class="section-kicker">PERSONAL</p><h3>Empleados y vínculos de rendimiento</h3></div></div><table class="compact-table payroll-table"><thead><tr><th>Código</th><th>Empleado</th><th>Modalidad</th><th>Sueldo base</th><th>Roles Poscosecha</th><th>Políticas</th><th></th></tr></thead><tbody>${(d.employees||[]).map(employee=>{const id=employeeId(employee);const links=employeeLinks(id,d);const policies=assignedPolicies(id,d);const mode=value(employee,"calculation_mode","calculationMode");const effectiveSalary=referenceSalary(employee,d);const allowedPolicies=(d.performancePolicies||[]).filter(policy=>statusActive(policy)&&links.some(link=>value(link,"operational_role","operationalRole")===value(policy,"operational_role","operationalRole")));return `<tr data-payroll-v2-employee-row="${esc(id)}"><td>${esc(value(employee,"employee_code","employeeCode"))}</td><td><strong>${esc(value(employee,"full_name","fullName"))}</strong><br><small>${esc(employee.identification)} · ${esc(employee.area||"")} ${esc(value(employee,"position_name","position")||"")}</small></td><td>${esc(modeLabel(mode))}</td><td class="numeric"><strong>${money(effectiveSalary)}</strong>${periodLinks(id,d).length?'<br><small>Base del contrato de rendimiento</small>':""}</td><td>${links.map(link=>`<span class="status-badge authorized">${esc(value(link,"operational_role","operationalRole"))}</span>`).join(" ")||'<span class="status-badge pending">SIN VÍNCULO</span>'}</td><td>${policies.map(policySummary).join("")||'<span class="payroll-muted">Sin política histórica</span>'}${perms.policiesManage&&mode==="FIXED_PERFORMANCE"?`<div class="payroll-policy-assignment"><select data-payroll-v2-policy-select><option value="">Seleccione política vigente</option>${allowedPolicies.map(policy=>`<option value="${esc(policyId(policy))}">${esc(policy.name)} · v${esc(value(policy,"policy_version","policyVersion"))}</option>`).join("")}</select><input type="date" data-payroll-v2-policy-from value="${today()}"><button class="secondary-button" data-payroll-v2-policy-assign="${esc(id)}">Asignar</button></div>`:""}</td><td>${perms.employeesManage?`<button class="secondary-button" data-payroll-v2-employee-edit="${esc(id)}">Editar</button>`:""}</td></tr>`;}).join("")||'<tr><td colspan="7" class="empty-row">Sin empleados V2.</td></tr>'}</tbody></table></article>`;}
  function renderEmployees(route){const d=data(),perms=permissions();return `<section class="payroll-page">${header(route)}${employeeForm(perms)}<article class="panel-card"><h3>Rendimiento por período</h3><p>Clasificador: 260 mallas/día. Embonchador: 200 bunches/día. Base fija: 470. Jornada referencial: 8 horas. Ingrese los días laborados al calcular cada período. Solo el excedente genera un pago adicional.</p><p>El vínculo se registra por ID en Parámetros Poscosecha. Las políticas anteriores se conservan como referencia histórica y no sustituyen este cálculo.</p></article>${employeesTable(d,{...perms,policiesManage:false})}${policiesTable(d,{...perms,policiesManage:false})}</section>`;}

  function currentMonth(){const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;}
  function referenceSalary(employee,d=data()){return periodLinks(employeeId(employee),d).length?470:Number(value(employee,'monthly_salary','monthlySalary')||0);}
  const standardLines=Object.freeze([
    {key:"additionalHours",code:"ADDITIONAL_HOURS",kind:"EARNING",label:"Horas extras (importe manual)",quantity:true},
    {key:"bonus",code:"BONUS",kind:"EARNING",label:"Bono"},{key:"commission",code:"COMMISSION",kind:"EARNING",label:"Comisión"},
    {key:"transport",code:"TRANSPORT",kind:"EARNING",label:"Transporte"},{key:"advance",code:"ADVANCE",kind:"DEDUCTION",label:"Anticipo"},
    {key:"food",code:"FOOD",kind:"DEDUCTION",label:"Alimentación"},{key:"manualDiscount",code:"MANUAL_DISCOUNT",kind:"DEDUCTION",label:"Multa / descuento manual"}
  ]);
  function blankLine(def={}){return {key:def.key||`custom-${crypto.randomUUID?.()||Date.now()}-${Math.random()}`,code:def.code||"OTHER_INCOME",kind:def.kind||"EARNING",label:def.label||"",amount:0,quantity:0,accountCode:"",notes:"",custom:Boolean(def.custom)};}
  function periodRoles(period,d=data()){const [year,month]=String(period||"").split("-").map(Number);const found=(d.periods||[]).find(p=>Number(p.year)===year&&Number(p.month)===month);return (d.roles||[]).filter(r=>r.company_id===d.companyId&&String(value(r,"period_id","periodId"))===String(value(found,"period_id","periodId")));}
  function roleForPeriod(period,d=data()){return periodRoles(period,d).filter(r=>r.status!=='REPLACED').sort((a,b)=>Number(value(b,'replacement_revision','replacementRevision')||1)-Number(value(a,'replacement_revision','replacementRevision')||1))[0]||null;}
  function replacedRolesForPeriod(period,d=data()){return periodRoles(period,d).filter(r=>r.status==='REPLACED').sort((a,b)=>Number(value(b,'replacement_revision','replacementRevision')||1)-Number(value(a,'replacement_revision','replacementRevision')||1));}
  function hydrateDraft(employee,d=data()){
    const id=employeeId(employee);if(ui.runDrafts[id])return ui.runDrafts[id];const reference=referenceSalary(employee,d);const current=roleForPeriod(ui.runPeriod||currentMonth(),d);const item=(current?.items||[]).find(row=>String(value(row,"employee_id","employeeId"))===id);
    const linked=periodLinks(id,d).length>0;const draft={selected:Boolean(item),baseReference:linked?470:Number(value(item,"reference_base_salary","referenceBaseSalary")??reference),baseAmount:linked?470:Number(value(item,"base_amount_used","baseAmountUsed")??reference),baseAdjustmentReason:String(value(item,"base_adjustment_reason","baseAdjustmentReason")||""),notes:String(value(item,"employee_notes","employeeNotes")||""),consideredWorkdays:performanceSnapshot(item)?.workedDays??"",lines:standardLines.filter(def=>conceptEnabled(def.code,d)).map(def=>blankLine(def))};
    for(const line of item?.lines||[]){const code=String(value(line,"concept_code","conceptCode")||"");if(code==="BASE_AMOUNT"||code==="SALARY"||value(line,"source_type","sourceType")==="PERFORMANCE_PERIOD_EXCESS"||!conceptEnabled(code,d))continue;const target=draft.lines.find(row=>row.code===code&&!row.custom);const shaped={code,kind:String(value(line,"line_kind","lineKind")),label:String(value(line,"concept_label","conceptLabel")||""),amount:Number(line.amount||0),quantity:Number(line.quantity||0),accountCode:String(value(line,"account_code","accountCode")||""),notes:String(value(line,"line_notes","lineNotes")||value(line,"source_reference","sourceReference")||"")};if(target)Object.assign(target,shaped);else draft.lines.push({...blankLine({code,kind:shaped.kind,custom:true}),...shaped});}
    if(!conceptEnabled("BASE_AMOUNT",d)){draft.baseAmount=0;draft.baseReference=0;draft.baseAdjustmentReason="";}
    ui.runDrafts[id]=draft;return draft;
  }
  function assignmentPreview(employee,d){return '<div class="payroll-policy-preview">'+periodLinks(employeeId(employee),d).map(l=>'<span>'+ (value(l,'operational_role','operationalRole')==='CLASSIFIER'?'Clasificador · 260 mallas/día':'Embonchador · 200 bunches/día')+' · meta del período = días laborados × meta diaria</span>').join('')+'</div>';}
  function deductionAccounts(line){return BlessERP.payrollV2Contract.accountOptions(data().accountOptions,ui.context.companyId,line.code==='ADVANCE'?'ADVANCE_LINE':'DEDUCTION_LINE');}
  function deductionAccountSelect(line){
    const options=deductionAccounts(line),selected=String(line.accountCode||'');
    return '<label class="payroll-line-account">Cuenta de contrapartida<select data-payroll-line-field="accountCode" aria-label="Cuenta de contrapartida de '+esc(line.label||line.code)+'"><option value="">Seleccione una cuenta para este descuento</option>'
      +(selected&&!options.some(a=>a.code===selected)?'<option selected disabled value="'+esc(selected)+'">Cuenta no disponible; seleccione una cuenta válida</option>':'')
      +options.map(a=>'<option value="'+esc(a.code)+'"'+(a.code===selected?' selected':'')+'>'+esc(a.code+' · '+a.name)+'</option>').join('')+'</select></label>';
  }
  function editorLine(line){
    const hours=['ADDITIONAL_HOURS','OVERTIME'].includes(line.code),label=BlessERP.payrollV2Contract.labels[line.code]||line.label;
    return '<div class="payroll-manual-line" data-payroll-line="'+esc(line.key)+'"><span class="payroll-line-kind '+line.kind.toLowerCase()+'">'+(line.kind==='EARNING'?'Ingreso':'Egreso')+'</span><strong>'+esc(label)+'</strong>'
      +(line.custom?'<input data-payroll-line-field="label" value="'+esc(line.label)+'" placeholder="Descripción del concepto manual" required>':'')
      +'<input data-payroll-line-field="amount" type="number" min="0" step=".01" value="'+(line.amount||'')+'" placeholder="Valor manual">'
      +(hours?'<input data-payroll-line-field="quantity" type="number" min="0" step=".01" value="'+(line.quantity||'')+'" placeholder="Horas / referencia opcional">':'')
      +(line.kind==='DEDUCTION'?deductionAccountSelect(line):'')
      +'<input data-payroll-line-field="notes" value="'+esc(line.notes)+'" placeholder="Observación opcional">'
      +(line.custom?'<button type="button" class="ghost-button" data-payroll-remove-line="'+esc(line.key)+'">Quitar</button>':'')+'</div>';
  }
  function employeeEditor(employee,draft,d){const id=employeeId(employee);const linked=periodLinks(id,d).length>0;return `<section class="payroll-role-editor" data-payroll-editor="${esc(id)}"><div class="panel-card-head"><div><p class="section-kicker">VALORES DEL PERÍODO</p><h3>${esc(value(employee,"full_name","fullName"))}</h3></div><button type="button" class="ghost-button" data-payroll-close-editor>Cerrar</button></div><div class="payroll-editor-grid">${field("Sueldo de referencia",`<input value="${money(draft.baseReference)}" disabled>`)}${field("Valor base a pagar",`<input data-payroll-draft-field="baseAmount" type="number" min="0" step=".01" value="${esc(draft.baseAmount)}" ${linked?"readonly":""}>`)}${field("Motivo del ajuste",`<input data-payroll-draft-field="baseAdjustmentReason" value="${esc(draft.baseAdjustmentReason)}" placeholder="Obligatorio si cambia el valor base">`)}${linked?field("Días laborados del período",`<input data-payroll-draft-field="consideredWorkdays" type="number" min="1" max="31" step="1" required value="${esc(draft.consideredWorkdays)}">`,`Ingrese los días trabajados. La base de 470 no se reduce por incumplimiento de meta.`):""}</div>${assignmentPreview(employee,d)}<h4>OTROS INGRESOS</h4><p>Horas extras: el valor se ingresa manualmente; la cantidad es una referencia opcional.</p><div class="payroll-manual-lines">${draft.lines.filter(l=>l.kind==="EARNING").map(editorLine).join("")}</div><h4>OTROS EGRESOS / DESCUENTOS</h4><div class="payroll-manual-lines">${draft.lines.filter(l=>l.kind==="DEDUCTION").map(editorLine).join("")}</div><div class="table-actions-inline"><button type="button" class="secondary-button" data-payroll-add-line="EARNING">+ Otro ingreso</button><button type="button" class="secondary-button" data-payroll-add-line="DEDUCTION">+ Otro descuento</button></div>${field("Observación del empleado",`<textarea data-payroll-draft-field="notes" rows="2">${esc(draft.notes)}</textarea>`)}</section>`;}
  function renderGeneration(route){const d=data(),perms=permissions();ui.runPeriod=ui.runPeriod||currentMonth();const latest=roleForPeriod(ui.runPeriod,d);const active=(d.employees||[]).filter(e=>e.status==='ACTIVE');return `<section class="payroll-page">${header(route)}${perms.calculate?`<form class="panel-card payroll-run-form" data-payroll-v2-run-form><div class="payroll-form-grid">${field("Período",`<input name="period" type="month" value="${esc(ui.runPeriod)}" required>`)}${field("Observación general",`<input name="notes" value="${esc(ui.runNotes)}">`)}</div><div class="panel-card-head"><div><p class="section-kicker">ROL DEL PERÍODO</p><h3>Empleados</h3></div><small>Seleccione y edite solo la fila necesaria.</small></div><div class="payroll-table-wrap"><table class="compact-table payroll-table payroll-run-table"><thead><tr><th></th><th>Empleado</th><th>Modalidad</th><th>Referencia</th><th>Rendimiento</th><th></th></tr></thead><tbody>${active.map(employee=>{const id=employeeId(employee),draft=hydrateDraft(employee,d);const policies=periodLinks(id,d);return `<tr><td><input type="checkbox" data-payroll-select-employee="${esc(id)}" ${draft.selected?"checked":""}></td><td><strong>${esc(value(employee,"employee_code","employeeCode"))} · ${esc(value(employee,"full_name","fullName"))}</strong><br><small>${esc(value(employee,"position_name","position")||"")}</small></td><td>${esc(modeLabel(value(employee,"calculation_mode","calculationMode")))}</td><td class="numeric">${money(draft.baseAmount)}</td><td>${policies.map(p=>`<span class="status-badge partial">${esc(value(p,"operational_role","operationalRole"))}</span>`).join(" ")||'<span class="payroll-muted">No aplica</span>'}</td><td><button type="button" class="secondary-button" data-payroll-edit-run="${esc(id)}">Editar</button></td></tr>`;}).join("")||'<tr><td colspan="6" class="empty-row">Sin empleados activos.</td></tr>'}</tbody></table></div>${ui.runEditorId?employeeEditor(active.find(e=>employeeId(e)===ui.runEditorId)||{},hydrateDraft(active.find(e=>employeeId(e)===ui.runEditorId)||{},d),d):""}<div class="table-actions-inline"><button class="primary-button" ${ui.operation?'disabled':''}>${ui.operation?'Procesando…':'Calcular / guardar rol V2'}</button></div></form>`:""}${latest?roleCard(latest,perms):'<article class="panel-card"><p>Sin rol calculado para el período seleccionado.</p></article>'}</section>`;}
  function policySnapshotCard(snapshot){const role=value(snapshot,"operational_role","operationalRole");const unit=value(snapshot,"primary_unit","primaryUnit")==="BUNCH"?"ramos":"mallas";return `<article class="payroll-performance-result"><div><strong>${role==="BUNCHER"?"Rendimiento Embonche":"Rendimiento Clasificación"}</strong><span class="status-badge partial">v${esc(value(snapshot,"policy_version","policyVersion"))}</span></div><dl><dt>Días estándar</dt><dd>${esc(value(snapshot,"standard_workdays","standardWorkdays"))}</dd><dt>Días considerados</dt><dd>${esc(value(snapshot,"considered_workdays","consideredWorkdays"))}</dd><dt>Meta diaria</dt><dd>${number(value(snapshot,"daily_target","dailyTarget"),0)} ${unit}</dd><dt>Meta estándar</dt><dd>${number(value(snapshot,"period_target","periodTarget"),0)} ${unit}</dd><dt>Meta proporcional informativa</dt><dd>${number(value(snapshot,"proportional_target","proportionalTarget"),0)} ${unit}</dd><dt>Real</dt><dd><strong>${number(value(snapshot,"actual_units","actualUnits"),0)} ${unit}</strong></dd><dt>Cumplimiento</dt><dd><strong>${number(value(snapshot,"performance_percentage","performancePercentage"),2)} %</strong></dd><dt>Referencia tallos</dt><dd>${number(value(snapshot,"reference_stems_actual","referenceStemsActual"),0)} / ${number(value(snapshot,"reference_stems_target","referenceStemsTarget"),0)}</dd></dl><small>Sueldo base ${money(value(snapshot,"base_salary","baseSalary"))}; el porcentaje no modifica la remuneración.</small></article>`;}
  function roleCard(role,perms){const id=value(role,"role_id","roleId"),revision=Number(value(role,'replacement_revision','replacementRevision')||1);const period=data().periods.find(p=>p.period_id===role.period_id&&p.company_id===role.company_id);const predecessor=value(role,'replaces_role_id','replacesRoleId');return `<article class="panel-card payroll-table-wrap"><div class="panel-card-head"><div><p class="section-kicker">${esc(role.status)} · revisión ${revision}</p><h3>${esc(value(role,"role_number","roleNumber"))}</h3><small>${esc(period?.date_from||"")} a ${esc(period?.date_to||"")} · ${esc(role.notes||"")}</small>${predecessor?`<p class="status-badge partial">Sustituye el rol ${esc(predecessor)}</p>`:""}${role.status==='REPLACED'?`<p class="status-badge pending">HISTÓRICO SUSTITUIDO · ${esc(value(role,'replaced_reason','replacedReason')||'')}</p>`:""}${role.requires_recalculation?'<p class="status-badge pending">REQUIERE RECALCULAR: cambió la configuración, el vínculo o el rendimiento confirmado.</p>':""}</div><div class="payroll-role-totals"><span>Ingresos ${money(value(role,"total_income","totalIncome"))}</span><span>Descuentos ${money(value(role,"total_discounts","totalDiscounts"))}</span><strong>Neto ${money(value(role,"net_total","netTotal"))}</strong></div></div><table class="compact-table payroll-table"><thead><tr><th>Empleado</th><th>Modalidad / rendimiento</th><th>Ingresos</th><th>Descuentos</th><th>Neto</th><th>Estado</th><th></th></tr></thead><tbody>${(role.items||[]).map(item=>{const snapshots=item.performance_policy_snapshots||item.performancePolicySnapshots||[];const p=performanceSnapshot(item);const perf=p?.contract==="PAYROLL_PERIOD_EXCESS_470_V1"?`Días ${p.workedDays} · Meta ${number(p.periodTarget)} · Real ${number(p.actualUnits)} · Extra ${money(p.extraPay)}`:snapshots.map(p=>`${value(p,"operational_role","operationalRole")==="BUNCHER"?"Embonche":"Clasificación"} ${number(value(p,"performance_percentage","performancePercentage"),2)} %`).join(" · ");return `<tr><td><strong>${esc(value(item,"employee_name_snapshot","employeeName"))}</strong><br><small>${esc(value(item,"employee_code_snapshot","employeeCode"))} · ${esc(value(item,"position_snapshot","position")||"")}</small></td><td>${esc(modeLabel(value(item,"calculation_mode_snapshot","calculationMode")))}${perf?`<br><span class="status-badge partial">${esc(perf)}</span>`:""}</td><td class="numeric">${money(value(item,"total_income","totalIncome"))}</td><td class="numeric">${money(value(item,"total_discounts","totalDiscounts"))}</td><td class="numeric"><strong>${money(value(item,"net_total","netTotal"))}</strong></td><td><span class="status-badge ${role.status==='POSTED'||role.status==='APPROVED'?'authorized':'partial'}">${esc(role.status)}</span></td><td>${perms.print?`<button class="secondary-button" data-payroll-v2-print="${esc(id)}" data-item="${esc(roleItemId(item))}">Rol individual</button>`:""}</td></tr>`;}).join("")}</tbody><tfoot><tr><th colspan="2">TOTAL NÓMINA</th><th class="numeric">${money(value(role,"total_income","totalIncome"))}</th><th class="numeric">${money(value(role,"total_discounts","totalDiscounts"))}</th><th class="numeric">${money(value(role,"net_total","netTotal"))}</th><th colspan="2"></th></tr></tfoot></table>${(role.items||[]).map(i=>performanceDetail(performanceSnapshot(i))).join("")}<div class="table-actions-inline">${perms.print?`<button class="secondary-button" data-payroll-v2-print="${esc(id)}">Resumen del período</button>`:""}${value(role,"accrual_journal_entry_id","journalEntryId")?'<button type="button" class="secondary-button" data-route-link="accounting-journal">Ver asiento</button>':""}${role.status==='CALCULATED'&&!role.requires_recalculation&&perms.approve?`<button class="primary-button" data-payroll-v2-approve="${esc(id)}" data-version="${esc(role.version)}">Aprobar</button>`:""}${role.status==='APPROVED'&&!value(role,'accrual_journal_entry_id','journalEntryId')&&perms.replace?`<form data-payroll-v2-replace-form data-role="${esc(id)}" data-version="${esc(role.version)}"><label>Motivo de sustitución<input name="reason" minlength="10" maxlength="500" required placeholder="Explique por qué debe recalcularse este rol aprobado"></label><button class="secondary-button">Crear versión de reemplazo</button><small>El rol aprobado quedará histórico; la nueva revisión empezará en borrador.</small></form>`:""}${role.status==='APPROVED'&&perms.post?`<button class="primary-button" data-payroll-v2-post="${esc(id)}" data-version="${esc(role.version)}">Contabilizar Financial V2</button>`:""}</div></article>`;}
  function renderApproved(route){
    const d=data(),perms=permissions();ui.historyPeriod=ui.historyPeriod||currentMonth();
    const role=roleForPeriod(ui.historyPeriod,d),replaced=replacedRolesForPeriod(ui.historyPeriod,d);
    return '<section class="payroll-page">'+header(route)+conceptsPanel(d)
      +(perms.accountingManage?'<form class="panel-card payroll-form-grid" data-payroll-v2-accounting><h3 class="payroll-form-span">Configuración contable de Nómina</h3>'
        +field('Cuenta predeterminada de gasto de remuneraciones',accountSelect('defaultExpenseAccountCode',d.accountingSettings?.default_expense_account_code||'','EXPENSE'))
        +field('Nómina por pagar',accountSelect('payrollPayableAccountCode',d.accountingSettings?.payroll_payable_account_code||'','PAYABLE'))
        +'<p class="payroll-form-span">Cada descuento requiere su cuenta de contrapartida en el detalle del rol. No se usa una cuenta genérica de descuentos.</p>'
        +field('Centro de costo','<input name="costCenter" value="'+esc(d.accountingSettings?.cost_center||'')+'">')
        +'<p class="payroll-form-span">Seleccione las cuentas cuando se apruebe la configuración contable. No se asignan cuentas automáticamente. Cambiar cuentas exige recalcular los roles pendientes de aprobación.</p><button class="secondary-button">Guardar configuración</button></form>':'')
      +'<article class="panel-card">'+field('Período del historial','<input type="month" name="historyPeriod" value="'+esc(ui.historyPeriod)+'" required>')+'</article>'
      +(role?roleCard(role,perms):'<article class="panel-card">Sin rol activo para el período seleccionado.</article>')
      +(replaced.length?'<h3>Versiones sustituidas · solo historial</h3>'+replaced.map(item=>roleCard(item,perms)).join(''):'')+'</section>';
  }
  function formData(form){return Object.fromEntries(new FormData(form).entries());}
  async function runLocked(label,action){
    const captured=ui.context;
    if(!current(captured))return repo().contextError();
    if(ui.operation)return;
    const selectedGeneration=ui.periodGeneration,periodAction=["Rol","Aprobación","Sustitución","Contabilización"].includes(label);
    const operation={label,context:captured};ui.operation=operation;rerender();
    try{
      const result=await action(captured);
      if(!current(captured)||ui.operation!==operation)return repo().contextError();
      if(periodAction&&ui.periodGeneration!==selectedGeneration)return {ok:false,code:"PAYROLL_PERIOD_CONTEXT_CHANGED",confirmed:result?.confirmed===true};
      notify(result,label+" confirmado.");return result;
    }catch(error){
      if(!current(captured)||ui.operation!==operation)return repo().contextError();
      const result=requestFailure();notify(result);return result;
    }finally{if(current(captured)&&ui.operation===operation){ui.operation="";rerender();}}
  }
  function editEmployee(id){ui.employeeDraft=(data().employees||[]).find(row=>employeeId(row)===String(id))||null;rerender();}
  function versionPolicy(id){const policy=policyById(id);if(!policy)return;ui.policyDraft=policyDraftFrom(policy);rerender();}
  function mount(container){
    const captured=ui.context,selectedGeneration=ui.periodGeneration;
    const on=(node,type,handler)=>node?.addEventListener(type,event=>{
      if(!current(captured)||selectedGeneration!==ui.periodGeneration){
        event.preventDefault?.();
        if(type==='submit'||type==='click')notify(repo().contextError());
        return;
      }
      return handler(event);
    });
    on(container.querySelector('[data-payroll-v2-retry]'),'click',()=>load(true));
    on(container.querySelector('[data-payroll-v2-employee-reset]'),'click',()=>{ui.employeeDraft=null;rerender();});
    container.querySelectorAll('[data-payroll-v2-employee-edit]').forEach(button=>on(button,'click',()=>editEmployee(button.dataset.payrollV2EmployeeEdit)));
    on(container.querySelector('[data-payroll-v2-employee-form]'),'submit',event=>{event.preventDefault();const payload=formData(event.currentTarget);if(payload.expenseAccountCode==="__INHERIT__")payload.expenseAccountCode="";else if(!BlessERP.payrollV2Contract.accountOptions(data().accountOptions,data().companyId,"EXPENSE").some(a=>a.code===payload.expenseAccountCode))return BlessERP.layout?.toast?.("Seleccione una cuenta de gasto válida o herede la configuración de Nómina.");const expected=payload.expectedVersion?Number(payload.expectedVersion):null;runLocked('Empleado',async context=>{const result=await service().upsertEmployee(payload,{expectedVersion:expected,context});if(result?.ok&&current(context))ui.employeeDraft=null;return result;});});
    on(container.querySelector('[data-payroll-v2-policy-reset]'),'click',()=>{ui.policyDraft=null;rerender();});
    container.querySelectorAll('[data-payroll-v2-policy-version]').forEach(button=>on(button,'click',()=>versionPolicy(button.dataset.payrollV2PolicyVersion)));
    on(container.querySelector('[data-payroll-v2-policy-form]'),'submit',event=>{event.preventDefault();const payload=formData(event.currentTarget);payload.operationalRole=payload.operationalRole||payload.operationalRoleFallback;payload.primaryUnit=payload.primaryUnit||payload.primaryUnitFallback;const options={priorPolicyId:payload.priorPolicyId||null,expectedVersion:payload.expectedVersion?Number(payload.expectedVersion):null};runLocked('Política',async context=>{const result=await service().savePerformancePolicy(payload,{...options,context});if(result?.ok&&current(context))ui.policyDraft=null;return result;});});
    container.querySelectorAll('[data-payroll-v2-policy-assign]').forEach(button=>on(button,'click',()=>{const row=button.closest('[data-payroll-v2-employee-row]');const policy=row?.querySelector('[data-payroll-v2-policy-select]')?.value;const validFrom=row?.querySelector('[data-payroll-v2-policy-from]')?.value;if(!policy)return BlessERP.layout?.toast?.('Seleccione una política vigente.');runLocked('Asignación',context=>service().assignPerformancePolicy({employeeId:button.dataset.payrollV2PolicyAssign,policyId:policy,validFrom},{context}));}));
    on(container.querySelector('[data-payroll-v2-run-form]'),'submit',event=>{event.preventDefault();const period=ui.runPeriod||event.currentTarget.elements.period.value;const [year,month]=period.split('-').map(Number);const last=new Date(year,month,0).getDate();const d=data();const existing=(d.periods||[]).find(p=>Number(p.year)===year&&Number(p.month)===month);const existingRole=roleForPeriod(period,d);const selected=(d.employees||[]).filter(employee=>ui.runDrafts[employeeId(employee)]?.selected);if(!selected.length)return BlessERP.layout?.toast?.('Seleccione empleados.');for(const employee of selected){const draft=hydrateDraft(employee,d);for(const line of draft.lines.filter(l=>l.kind==='DEDUCTION'&&Number(l.amount)>0)){if(!deductionAccounts(line).some(a=>a.code===line.accountCode))return BlessERP.layout?.toast?.('Seleccione una cuenta de contrapartida válida para '+(line.label||line.code)+'.');}if(periodLinks(employeeId(employee),d).length&&(!Number.isInteger(Number(draft.consideredWorkdays))||Number(draft.consideredWorkdays)<1||Number(draft.consideredWorkdays)>31))return BlessERP.layout?.toast?.("Ingrese días laborados válidos (1 a 31) para el período.");if(Number(draft.baseAmount)<0)return BlessERP.layout?.toast?.('El valor base no puede ser negativo.');if(Math.abs(Number(draft.baseAmount)-Number(draft.baseReference))>.000001&&!String(draft.baseAdjustmentReason||'').trim())return BlessERP.layout?.toast?.(`Ingrese el motivo del ajuste para ${value(employee,'full_name','fullName')}.`);}const notes=ui.runNotes;runLocked('Rol',async context=>{const items=selected.map(employee=>{const draft=hydrateDraft(employee,d);return{employeeId:employeeId(employee),baseAmount:Number(draft.baseAmount||0),baseAdjustmentReason:String(draft.baseAdjustmentReason||'').trim(),consideredWorkdays:draft.consideredWorkdays===""?null:Number(draft.consideredWorkdays),notes:String(draft.notes||'').trim(),concepts:draft.lines.filter(line=>Number(line.amount)>0).map(line=>({code:line.code,kind:line.kind,label:String(line.label||'').trim(),amount:Number(line.amount),quantity:Number(line.quantity||0),accountCode:String(line.accountCode||""),notes:String(line.notes||'').trim()}))};});let periodId=value(existing,"period_id","periodId");if(!periodId){const made=await service().createPeriod({year,month,dateFrom:`${period}-01`,dateTo:`${period}-${String(last).padStart(2,'0')}`},{context});if(!current(context))return repo().contextError();if(!made.ok)return made;periodId=made.result?.periodId;}return service().calculateRole(periodId,{items,notes},{context,expectedVersion:existingRole?Number(existingRole.version):null});});});
    on(container.querySelector('[name="period"]'),'change',event=>{ui.runPeriod=event.currentTarget.value;ui.periodGeneration++;ui.runDrafts={};ui.runNotes=roleForPeriod(ui.runPeriod)?.notes||'';ui.runEditorId='';rerender();});
    on(container.querySelector('[name="historyPeriod"]'),'change',event=>{ui.historyPeriod=event.currentTarget.value;ui.periodGeneration++;rerender();});
    on(container.querySelector('[name="notes"]'),'input',event=>{ui.runNotes=event.currentTarget.value;});
    container.querySelectorAll('[data-payroll-select-employee]').forEach(input=>on(input,'change',()=>{const employee=(data().employees||[]).find(row=>employeeId(row)===input.dataset.payrollSelectEmployee);if(employee)hydrateDraft(employee).selected=input.checked;}));
    container.querySelectorAll('[data-payroll-edit-run]').forEach(button=>on(button,'click',()=>{ui.runEditorId=button.dataset.payrollEditRun;const employee=(data().employees||[]).find(row=>employeeId(row)===ui.runEditorId);if(employee)hydrateDraft(employee).selected=true;rerender();}));
    on(container.querySelector('[data-payroll-close-editor]'),'click',()=>{ui.runEditorId='';rerender();});
    container.querySelectorAll('[data-payroll-draft-field]').forEach(input=>on(input,'input',()=>{const draft=ui.runDrafts[ui.runEditorId];if(!draft)return;const key=input.dataset.payrollDraftField;draft[key]=input.type==='number'?Number(input.value||0):input.value;}));
    container.querySelectorAll('[data-payroll-line]').forEach(row=>row.querySelectorAll('[data-payroll-line-field]').forEach(input=>on(input,'input',()=>{const draft=ui.runDrafts[ui.runEditorId];const line=draft?.lines.find(item=>item.key===row.dataset.payrollLine);if(!line)return;const key=input.dataset.payrollLineField;line[key]=input.type==='number'?Number(input.value||0):input.value;})));
    container.querySelectorAll('[data-payroll-add-line]').forEach(button=>on(button,'click',()=>{const draft=ui.runDrafts[ui.runEditorId];if(!draft)return;const kind=button.dataset.payrollAddLine;if(!conceptEnabled(kind==="EARNING"?"OTHER_INCOME":"OTHER_DISCOUNTS"))return;draft.lines.push(blankLine({code:kind==='EARNING'?'OTHER_INCOME':'OTHER_DISCOUNTS',kind,custom:true}));rerender();}));
    container.querySelectorAll('[data-payroll-remove-line]').forEach(button=>on(button,'click',()=>{const draft=ui.runDrafts[ui.runEditorId];if(!draft)return;draft.lines=draft.lines.filter(line=>line.key!==button.dataset.payrollRemoveLine);rerender();}));
    container.querySelectorAll('[data-payroll-v2-approve]').forEach(button=>on(button,'click',()=>runLocked('Aprobación',context=>service().approveRole(button.dataset.payrollV2Approve,Number(button.dataset.version),{context}))));
    container.querySelectorAll('[data-payroll-v2-replace-form]').forEach(form=>on(form,'submit',event=>{event.preventDefault();const reason=String(new FormData(form).get('reason')||'').trim();if(reason.length<10)return BlessERP.layout?.toast?.('Ingrese un motivo de sustitución de al menos 10 caracteres.');if(!window.confirm('El rol aprobado quedará histórico y se creará una nueva revisión en borrador. ¿Continuar?'))return;runLocked('Sustitución',context=>service().replaceRole(form.dataset.role,Number(form.dataset.version),reason,{context}));}));
    container.querySelectorAll('[data-payroll-v2-post]').forEach(button=>on(button,'click',()=>runLocked('Contabilización',context=>service().postRole(button.dataset.payrollV2Post,Number(button.dataset.version),null,{context}))));
    container.querySelectorAll('[data-payroll-v2-print]').forEach(button=>on(button,'click',()=>BlessERP.payrollV2Print?.print(button.dataset.payrollV2Print,button.dataset.item||'')));
    on(container.querySelector('[data-payroll-v2-accounting]'),'submit',event=>{event.preventDefault();const payload=formData(event.currentTarget);runLocked('Configuración',context=>service().saveAccountingSettings(payload,{context}));});
  }
  function render(container,route){const captured=alignContext();if(!ui.loaded){container.innerHTML=unavailable(route);mount(container);if(!ui.loading&&!ui.error)queueMicrotask(()=>{if(current(captured))load(false,captured);});return;}const map={"payroll-employees":renderEmployees,"payroll-generation":renderGeneration,"payroll-approved":renderApproved};container.innerHTML=(map[route.id]||renderGeneration)(route);mount(container);}
  window.addEventListener('erp:canonical-record-updated',event=>{
    const captured=alignContext(),recordCompany=event.detail?.companyId||event.detail?.company_id;
    if(!String(event.detail?.entity||'').startsWith('payroll_v2_')||recordCompany!==captured.companyId)return;
    clearTimeout(realtimeTimer);
    realtimeTimer=setTimeout(()=>{
      if(current(captured)&&String(BlessERP.state?.state?.route||'').startsWith('payroll-'))load(true,captured);
    },120);
  });
  BlessERP.modules=BlessERP.modules||{};BlessERP.modules.payroll={render};
})();
