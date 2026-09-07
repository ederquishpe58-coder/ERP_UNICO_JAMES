(function(){
  const erp=window.BlessERP=window.BlessERP||{};
  const specs=Object.freeze({
    erp_payroll_core_v2_upsert_employee:['UPSERT_EMPLOYEE','employeeId','payroll_v2_employees'],
    erp_payroll_core_v2_link_operational_role:['LINK_OPERATIONAL_ROLE','linkId','payroll_v2_operational_roles'],
    erp_payroll_performance_v2_save_policy:['SAVE_PERFORMANCE_POLICY','policyId','payroll_v2_performance_policies'],
    erp_payroll_performance_v2_assign_policy:['ASSIGN_PERFORMANCE_POLICY','assignmentId','payroll_v2_policy_assignments'],
    erp_payroll_core_v2_create_period:['CREATE_PERIOD','periodId','payroll_v2_periods'],
    erp_payroll_core_v2_calculate_role:['CALCULATE_ROLE','roleId','payroll_v2_roles','CALCULATED'],
    erp_payroll_core_v2_approve_role:['APPROVE_ROLE','roleId','payroll_v2_roles','APPROVED'],
    erp_payroll_core_v2_replace_role:['REPLACE_ROLE'],
    erp_payroll_core_v2_post_role:['POST_ROLE','roleId','payroll_v2_roles','POSTED'],
    erp_payroll_core_v2_save_accounting_settings:['SAVE_ACCOUNTING_SETTINGS']
  });
  const object=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
  const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const version=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
  function ack(name,value,companyId,operationId,parameters={}){
    const spec=specs[name],c=value?.confirmation,r=value?.result;
    if(!spec||value?.ok!==true||value.companyId!==companyId||!object(c)||!object(r)
      ||c.companyId!==companyId||c.operationId!==operationId||c.commandType!=='PAYROLL_V2_'+spec[0]
      ||c.status!=='CONFIRMED'||typeof value.serverTime!=='string'||!Number.isFinite(Date.parse(value.serverTime))
      ||!Array.isArray(value.records))return false;
    if(value.records.some(row=>!object(row)||row.company_id!==companyId||!id(row.record_id)||!version(row.version)
      ||row.last_operation_id!==operationId||!object(row.payload)||row.deleted_at))return false;
    if(spec[0]==='SAVE_ACCOUNTING_SETTINGS')return value.records.length===0&&r.company_id===companyId&&version(r.version)
      &&['default_expense_account_code','payroll_payable_account_code','payroll_deduction_account_code','cost_center'].every(k=>typeof r[k]==='string');
    if(spec[0]==='REPLACE_ROLE'){
      const originalId=r.originalRoleId,replacementId=r.replacementRoleId,periodId=r.periodId;
      const roles=value.records.filter(row=>row.entity==='payroll_v2_roles');
      const original=roles.find(row=>row.record_id===originalId)?.payload;
      const replacement=roles.find(row=>row.record_id===replacementId)?.payload;
      const period=value.records.find(row=>row.entity==='payroll_v2_periods'&&row.record_id===periodId)?.payload;
      return roles.length===2&&id(originalId)&&id(replacementId)&&originalId!==replacementId&&id(periodId)
        &&parameters.p_role_id===originalId&&r.originalStatus==='REPLACED'&&r.replacementStatus==='DRAFT'
        &&version(r.originalVersion)&&version(r.replacementVersion)&&Number(r.originalVersion)===Number(parameters.p_expected_version)+1
        &&Number(r.replacementVersion)===1&&Number.isSafeInteger(Number(r.replacementRevision))&&Number(r.replacementRevision)>1
        &&original?.roleId===originalId&&original.periodId===periodId&&original.status==='REPLACED'
        &&original.version===r.originalVersion&&original.replacedReason===String(parameters.p_reason||'').trim()
        &&replacement?.roleId===replacementId&&replacement.periodId===periodId&&replacement.status==='DRAFT'
        &&replacement.version===r.replacementVersion&&replacement.replacesRoleId===originalId
        &&replacement.replacementRevision===r.replacementRevision&&replacement.replacementReason===original.replacedReason
        &&period?.periodId===periodId&&period.status==='OPEN'&&version(period.version);
    }
    const canonicalId=r[spec[1]],row=value.records.find(x=>x.entity===spec[2]&&x.record_id===canonicalId),payload=row?.payload;
    if(!id(canonicalId)||!row||!version(payload.version)||payload[spec[1]]!==canonicalId)return false;
    if(spec[3]&&(r.status!==spec[3]||payload.status!==spec[3]||!id(payload.periodId)))return false;
    if(parameters.p_role_id&&canonicalId!==parameters.p_role_id)return false;
    if(parameters.p_period_id&&payload.periodId!==parameters.p_period_id)return false;
    if(spec[0]==='UPSERT_EMPLOYEE'&&(!['ACTIVE','INACTIVE'].includes(payload.status)||typeof r.employeeCode!=='string'||!r.employeeCode))return false;
    if(spec[0]==='CREATE_PERIOD'&&!['OPEN','CALCULATED','APPROVED','POSTED','CLOSED'].includes(payload.status))return false;
    if(spec[0]==='POST_ROLE'&&(!id(r.journalEntryId)||payload.journalEntryId!==r.journalEntryId
      ||!value.records.some(x=>x.entity==='financial_journal_entries'&&x.record_id===r.journalEntryId)))return false;
    return true;
  }
  // Canonical six-decimal units; never sum rounded display values.
  function micros(value){
    const text=typeof value==='number'&&Number.isFinite(value)?value.toFixed(6):String(value??'0');
    if(!/^-?\d+(\.\d{1,6})?$/.test(text))throw Error('PAYROLL_MONEY_INVALID');
    const negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^-/,'').split('.');
    return (negative?-1n:1n)*(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')));
  }
  function decimal(units){const n=BigInt(units),a=n<0n?-n:n;return (n<0n?'-':'')+(a/1000000n)+'.'+String(a%1000000n).padStart(6,'0');}
  function money(value){
    const units=micros(value),a=units<0n?-units:units,cents=(a+5000n)/10000n;
    return (units<0n&&cents?'-':'')+'$ '+new Intl.NumberFormat('es-EC',{maximumFractionDigits:0}).format(cents/100n)+','+String(cents%100n).padStart(2,'0');
  }
  const labels=Object.freeze({BASE_AMOUNT:'Sueldo',SALARY:'Sueldo',ADDITIONAL_HOURS:'Horas extras (importe manual)',OVERTIME:'Horas extras (importe manual)',
    TRANSPORT:'Transporte',BONUS:'Bonificación',COMMISSION:'Comisión manual',OTHER_INCOME:'Otro ingreso manual',
    FOOD:'Alimentación',ADVANCE:'Anticipo',MANUAL_DISCOUNT:'Descuento manual',OTHER_DISCOUNTS:'Otro egreso manual',
    PERFORMANCE:'Rendimiento histórico',DECIMO_TERCERO:'Décimo tercero',DECIMO_CUARTO:'Décimo cuarto',FONDOS_RESERVA:'Fondos de reserva',
    VACACIONES_PROVISIONADAS:'Vacaciones provisionadas',UTILIDADES:'Utilidades',IESS_PERSONAL:'IESS personal',IESS_PATRONAL:'IESS patronal',
    PRESTAMO_QUIROGRAFARIO:'Préstamo quirografario',PRESTAMO_HIPOTECARIO:'Préstamo hipotecario'});
  function accountOptions(rows,companyId,purpose){
    return (rows||[]).filter(r=>r.company_id===companyId&&!r.deleted_at&&!r.__deleted&&r.isMovement===true
      &&['ACTIVE','ACTIVA'].includes(String(r.status).toUpperCase())&&typeof r.code==='string'&&r.code.trim()
      &&(purpose==='EXPENSE'?['Gasto','Costo'].includes(r.type)&&r.nature==='Deudora'
        :purpose==='ADVANCE_LINE'?r.type==='Activo'&&r.nature==='Deudora'
        :purpose==='DEDUCTION_LINE'?(r.type==='Activo'&&r.nature==='Deudora')||(r.type==='Pasivo'&&r.nature==='Acreedora')
        :['PAYABLE','DEDUCTION'].includes(purpose)&&r.type==='Pasivo'&&r.nature==='Acreedora'));
  }
  erp.payrollV2Contract=Object.freeze({ack,micros,decimal,money,labels,accountOptions,
    failure:()=>({ok:false,confirmed:false,code:'PAYROLL_CANONICAL_ACK_REQUIRED',message:'No se recibió una confirmación canónica completa de Nómina. Consulte el estado antes de reintentar.'}),
    refreshWarning:'Guardado correctamente. No se pudo actualizar la vista; recargue para consultar el estado actual.'});
})();
