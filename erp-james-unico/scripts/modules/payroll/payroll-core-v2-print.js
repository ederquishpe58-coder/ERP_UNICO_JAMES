(function(){
  const erp=window.BlessERP=window.BlessERP||{},contract=()=>erp.payrollV2Contract;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=v=>({DRAFT:'Borrador',CALCULATED:'Calculado · pendiente de aprobación',APPROVED:'Aprobado',POSTED:'Contabilizado'})[v]||v;
  function validate(bundle){
    const {role,period,company}=bundle||{},c=contract();
    if(bundle?.ok!==true||bundle.contract!=='PAYROLL_PRINT_V1'||!role||!period||!company
      ||role.company_id!==bundle.companyId||company.company_id!==role.company_id||period.company_id!==role.company_id
      ||period.period_id!==role.period_id||!Array.isArray(role.items)||!role.items.length
      ||!(company.commercial_name||company.legal_name))throw Error('PAYROLL_PRINT_CANONICAL_COMPANY_REQUIRED');
    let income=0n,deductions=0n,net=0n;
    for(const item of role.items){
      if(item.company_id!==role.company_id||item.role_id!==role.role_id||!Array.isArray(item.lines))throw Error('PAYROLL_PRINT_ITEM_CONTEXT');
      let earned=0n,discount=0n,salary=0n,overtime=0n,other=0n;
      for(const line of item.lines){
        const amount=c.micros(line.amount);
        if(line.company_id!==role.company_id||line.role_item_id!==item.role_item_id||amount<0n)throw Error('PAYROLL_PRINT_LINE_CONTEXT');
        if(line.line_kind==='EARNING'){
          earned+=amount;
          if(['BASE_AMOUNT','SALARY'].includes(line.concept_code))salary+=amount;
          else if(['ADDITIONAL_HOURS','OVERTIME'].includes(line.concept_code))overtime+=amount;
          else other+=amount;
        }else if(line.line_kind==='DEDUCTION')discount+=amount;
        else throw Error('PAYROLL_PRINT_LINE_KIND');
      }
      if(earned!==c.micros(item.total_income)||discount!==c.micros(item.total_discounts)||earned-discount!==c.micros(item.net_total)
        ||salary!==c.micros(item.summary?.salary)||overtime!==c.micros(item.summary?.overtime)||other!==c.micros(item.summary?.otherIncome)
        ||discount!==c.micros(item.summary?.otherDeductions))throw Error('PAYROLL_PRINT_TOTALS_INVALID');
      const p=item.performance_calculation_snapshot;
      if(item.lines.some(l=>l.source_type==='PERFORMANCE_PERIOD_EXCESS')&&p?.contract!=='PAYROLL_PERIOD_EXCESS_470_V1')throw Error('PAYROLL_PRINT_PERFORMANCE_SNAPSHOT_REQUIRED');
      if(p?.contract==='PAYROLL_PERIOD_EXCESS_470_V1'){
        const daily=p.operationalRole==='CLASSIFIER'?260:p.operationalRole==='BUNCHER'?200:0;
        if(p.companyId!==role.company_id||p.employeeId!==item.employee_id||p.roleItemId!==item.role_item_id
          ||p.periodFrom!==period.date_from||p.periodTo!==period.date_to||!daily||!Number.isInteger(p.workedDays)||p.workedDays<1||p.workedDays>31
          ||c.micros(p.dailyTarget)!==BigInt(daily)*1000000n||c.micros(p.periodTarget)!==BigInt(daily*p.workedDays)*1000000n
          ||c.micros(p.baseSalary)!==470000000n||salary!==470000000n)throw Error('PAYROLL_PRINT_PERFORMANCE_CONTEXT');
        const actual=c.micros(p.actualUnits),target=c.micros(p.periodTarget),excess=actual>target?actual-target:0n;
        const extra=(excess*470000000n+target/2n)/target;
        const extraLines=item.lines.filter(l=>l.source_type==='PERFORMANCE_PERIOD_EXCESS');
        if(actual<0n||c.micros(p.excessUnits)!==excess||c.micros(p.extraPay)!==extra
          ||extraLines.reduce((sum,l)=>sum+c.micros(l.amount),0n)!==extra||extraLines.length>(extra>0n?1:0))throw Error('PAYROLL_PRINT_PERFORMANCE_TOTALS');
      }
      income+=earned;deductions+=discount;net+=earned-discount;
    }
    if(income!==c.micros(role.total_income)||deductions!==c.micros(role.total_discounts)||net!==c.micros(role.net_total))throw Error('PAYROLL_PRINT_TOTALS_INVALID');
    return bundle;
  }
  function render(bundle,itemId=''){
    validate(bundle);
    const {role,period,company}=bundle,c=contract(),money=c.money,summary=!itemId;
    const items=summary?role.items:role.items.filter(i=>i.role_item_id===itemId);
    if(!items.length)throw Error('PAYROLL_PRINT_ITEM_NOT_FOUND');
    const title=summary?'RESUMEN DE ROL DE PAGOS':'ROL DE PAGOS';
    const header='<header><div><h1>'+esc(company.commercial_name||company.legal_name)+'</h1>'
      +(company.legal_name&&company.legal_name!==company.commercial_name?'<div>'+esc(company.legal_name)+'</div>':'')
      +'<div>RUC: '+esc(company.tax_id||'Sin RUC registrado')+'</div></div><div class="document"><h2>'+title+'</h2><div>'+esc(role.role_number)+'</div>'
      +'<div>Período: '+esc(period.date_from)+' a '+esc(period.date_to)+'</div><div class="state">'+esc(status(role.status))+'</div></div></header>';
    const lineTable=(item,kind)=>{
      const priority=l=>['BASE_AMOUNT','SALARY'].includes(l.concept_code)?0:['ADDITIONAL_HOURS','OVERTIME'].includes(l.concept_code)?1:2;
      const lines=item.lines.filter(l=>l.line_kind===kind&&c.micros(l.amount)!==0n).sort((a,b)=>priority(a)-priority(b)||a.line_order-b.line_order);
      return '<table><thead><tr><th>Concepto</th><th>Descripción / observación</th><th class="num">Valor</th></tr></thead><tbody>'
        +(lines.map(l=>{
          const manual=['OTHER_INCOME','OTHER_DISCOUNTS','MANUAL_DISCOUNT'].includes(l.concept_code),hours=['OVERTIME','ADDITIONAL_HOURS'].includes(l.concept_code);
          const performance=l.source_type==='PERFORMANCE_PERIOD_EXCESS';
          const description=[manual?l.concept_label:'',hours&&Number(l.quantity)?'Cantidad / referencia: '+l.quantity:'',l.line_notes||(!performance?l.source_reference:'')||''].filter(Boolean).join(' · ');
          return '<tr><td>'+esc(performance?'Excedente de rendimiento':c.labels[l.concept_code]||l.concept_label||l.concept_code)+'</td><td>'+esc(description)+'</td><td class="num">'+money(l.amount)+'</td></tr>';
        }).join('')||'<tr><td colspan="3">Sin conceptos aplicados.</td></tr>')
        +'</tbody><tfoot><tr><th colspan="2">'+(kind==='EARNING'?'TOTAL INGRESOS':'TOTAL EGRESOS')+'</th><th class="num">'+money(kind==='EARNING'?item.total_income:item.total_discounts)+'</th></tr></tfoot></table>';
    };
    const performance=item=>item.performance_calculation_snapshot?.contract==='PAYROLL_PERIOD_EXCESS_470_V1'?item.performance_calculation_snapshot:null;
    const qty=v=>new Intl.NumberFormat('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v));
    const roleName=p=>p.operationalRole==='CLASSIFIER'?'Clasificador':'Embonchador';
    const performanceBlock=i=>{const p=performance(i);if(!p)return '';return '<h3>RENDIMIENTO DEL PERÍODO · '+roleName(p)+'</h3><div class="employee-meta"><span>Días laborados: '+esc(p.workedDays)+'</span><span>Jornada referencial: 8 horas</span><span>Meta diaria: '+qty(p.dailyTarget)+' '+(p.operationalRole==='CLASSIFIER'?'mallas':'bunches')+'</span><span>Meta del período: '+qty(p.periodTarget)+'</span><span>Rendimiento real: '+qty(p.actualUnits)+'</span><span>Excedente: '+qty(p.excessUnits)+'</span><span>Sueldo base: '+money(p.baseSalary)+'</span><span>Valor extra: '+money(p.extraPay)+'</span></div>';};
    let body;
    if(summary){
      const totals={salary:0n,overtime:0n,otherIncome:0n,otherDeductions:0n};
      const rows=items.map(i=>{
        for(const k of Object.keys(totals))totals[k]+=c.micros(i.summary[k]);
        return '<tr><td><strong>'+esc(i.employee_name_snapshot)+'</strong><br><small>'+esc(i.employee_code_snapshot)+'</small></td>'
          +[i.summary.salary,i.summary.overtime,i.summary.otherIncome,i.total_income,i.summary.otherDeductions,i.total_discounts,i.net_total].map(v=>'<td class="num">'+money(v)+'</td>').join('')+'</tr>';
      }).join('');
      body='<table class="summary"><thead><tr><th>Empleado</th><th>Sueldo</th><th>Horas extras</th><th>Otros ingresos</th><th>Total ingresos</th><th>Otros egresos</th><th>Total egresos</th><th>Neto</th></tr></thead><tbody>'+rows
        +'</tbody><tfoot><tr><th>TOTALES DEL PERÍODO</th>'+[c.decimal(totals.salary),c.decimal(totals.overtime),c.decimal(totals.otherIncome),role.total_income,c.decimal(totals.otherDeductions),role.total_discounts,role.net_total].map(v=>'<th class="num">'+money(v)+'</th>').join('')+'</tr></tfoot></table>';
      const performanceItems=items.filter(performance);
      if(performanceItems.length)body+='<h3>DETALLE ADMINISTRATIVO DE RENDIMIENTO</h3><table class="summary"><thead><tr><th>Empleado</th><th>Cargo</th><th>Días</th><th>Meta</th><th>Rendimiento</th><th>Excedente</th><th>Valor extra</th><th>Neto</th></tr></thead><tbody>'+performanceItems.map(i=>{const p=performance(i);return '<tr><td>'+esc(i.employee_name_snapshot)+'</td><td>'+roleName(p)+'</td><td>'+esc(p.workedDays)+'</td>'+[p.periodTarget,p.actualUnits,p.excessUnits].map(v=>'<td class="num">'+qty(v)+'</td>').join('')+'<td class="num">'+money(p.extraPay)+'</td><td class="num">'+money(i.net_total)+'</td></tr>';}).join('')+'</tbody></table>';
    }else{
      const i=items[0];
      body='<section class="employee"><h2>'+esc(i.employee_name_snapshot)+'</h2><div class="employee-meta"><span>Identificación: '+esc(i.employee_identification_snapshot)+'</span><span>Cargo: '+esc(i.position_snapshot)+'</span>'
        +(i.employee_area_snapshot?'<span>Área: '+esc(i.employee_area_snapshot)+'</span>':'')+'<span>Código: '+esc(i.employee_code_snapshot)+'</span></div>'
        +performanceBlock(i)+'<h3>INGRESOS</h3>'+lineTable(i,'EARNING')+'<h3>EGRESOS</h3>'+lineTable(i,'DEDUCTION')
        +'<div class="net"><strong>NETO A PAGAR</strong><strong>'+money(i.net_total)+'</strong></div>'
        +(i.employee_notes?'<p>Observaciones: '+esc(i.employee_notes)+'</p>':'')
        +(i.base_adjustment_reason?'<p class="note">Ajuste de base: '+esc(i.base_adjustment_reason)+'</p>':'')
        +'<div class="signatures"><div>RECIBÍ CONFORME / EMPLEADO</div><div>RESPONSABLE / EMPRESA</div></div><p class="signature-date">Fecha de firma: ____________________</p></section>';
    }
    if(role.notes)body+='<p class="note">Observación del período: '+esc(role.notes)+'</p>';
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>'+esc(title+' '+role.role_number)+'</title><style>'
      +'@page{size:A4 '+(summary?'landscape':'portrait')+';margin:12mm}*{box-sizing:border-box}body{margin:0;padding:0;background:#fff;color:#17212b;font:12px Arial,sans-serif}h1{font-size:20px;margin:0 0 5px}h2{font-size:16px;margin:0 0 6px}h3{font-size:13px;margin:20px 0 6px}header{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:20px}.document{text-align:right}.state{margin-top:7px}.employee-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px}table{width:100%;border-collapse:collapse}th,td{padding:8px 7px;border:1px solid #bdc3c7;text-align:left}thead,tfoot{background:#f0f2f3}thead{display:table-header-group}.num{text-align:right;white-space:nowrap}tr{break-inside:avoid}.net{display:flex;justify-content:space-between;padding:14px 8px;margin-top:18px;border-top:2px solid #222;border-bottom:2px solid #222;font-size:16px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:60px}.signatures div{border-top:1px solid #333;padding-top:8px;text-align:center;font-size:11px}.signature-date{margin-top:24px}.note{font-size:11px}.summary{font-size:11px}.summary td:first-child{min-width:150px}small{color:#444}'
      +'</style></head><body>'+header+body+'<p class="note">Los totales se redondean al final y pueden diferir de la suma de los valores mostrados.</p></body></html>';
  }
  async function print(roleId,itemId=''){
    const repo=erp.getPayrollV2Repository?.();
    if(!repo?.canExecute?.()||!repo.healthStatus()?.data?.capabilities?.includes('payroll.roles.print')){
      erp.layout?.toast?.('No tiene permiso para imprimir roles de pago.');return false;
    }
    // Retain the window handle; noopener in window.open would return null in Chrome.
    const popup=window.open('','_blank');
    if(!popup){erp.layout?.toast?.('Permita ventanas emergentes para imprimir.');return false;}
    try{
      popup.opener=null;popup.document.body.textContent='Preparando documento…';
      const bundle=await erp.services.payrollV2.getPrintBundle(roleId);
      if(!bundle?.ok)throw Error('PAYROLL_PRINT_REQUEST_FAILED');
      const html=render(bundle,itemId);
      if(popup.closed)return false;
      popup.document.open();popup.document.write(html);popup.document.close();
      setTimeout(()=>{try{if(!popup.closed){popup.focus();popup.print();}}catch(error){erp.layout?.toast?.('El documento está preparado. Use la opción Imprimir del navegador.');}},200);
      return true;
    }catch(error){
      if(!popup.closed)popup.close();
      erp.layout?.toast?.('No se pudo preparar un documento canónico de Nómina. Recargue el rol y vuelva a intentar.');return false;
    }
  }
  erp.payrollV2Print=Object.freeze({render,print,validate});
})();
