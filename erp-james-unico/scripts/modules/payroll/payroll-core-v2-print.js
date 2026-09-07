(function(){
  const BlessERP=window.BlessERP=window.BlessERP||{};
  const esc=value=>BlessERP.utils?.esc?.(value??"")??String(value??"");
  const money=value=>new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD"}).format(Number(value||0));
  const number=(value,decimals=2)=>new Intl.NumberFormat("es-EC",{minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(Number(value||0));
  function company(){
    const active=BlessERP.authAccess?.activeAccess?.()?.activeCompany||{};
    const settings=BlessERP.services?.companySettings?.settings?.()||{};
    return { name:active.commercialName||active.legalName||settings.commercialName||"Empresa",taxId:active.taxId||settings.taxId||"",address:settings.address||"" };
  }
  function roleBundle(roleId){
    const data=BlessERP.services?.payrollV2?.snapshot?.()||{};
    return { role:(data.roles||[]).find(row=>String(row.role_id||row.roleId)===String(roleId)),periods:data.periods||[] };
  }
  function render(roleId,itemId=""){
    const {role,periods}=roleBundle(roleId); if(!role)return "";
    const period=periods.find(row=>String(row.period_id||row.periodId)===String(role.period_id||role.periodId))||{};
    const items=(role.items||[]).filter(item=>!itemId||String(item.role_item_id||item.roleItemId)===String(itemId)); const business=company();
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(role.role_number||role.roleNumber)}</title><style>
      @page{size:A4;margin:11mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#111;margin:0}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 3px}h3{font-size:11px;margin:10px 0 3px;text-transform:uppercase}
      .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}.meta{text-align:right}.employee{page-break-inside:avoid;margin:0 0 13px}.employee-meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px}.note{margin-top:6px;padding:6px;border:1px solid #bbb}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:35px;margin-top:30px}.signature{border-top:1px solid #222;text-align:center;padding-top:5px}
      table{width:100%;border-collapse:collapse;margin-top:5px}th,td{border:1px solid #aaa;padding:5px;text-align:left;vertical-align:top}th{background:#eee}.num{text-align:right}.totals{font-weight:700}.draft{border:1px solid #555;padding:4px 8px}.split{display:grid;grid-template-columns:1fr 1fr;gap:8px}.adjustment{font-size:10px;color:#333;margin-top:3px}
      </style></head><body><header class="head"><div><h1>${esc(business.name)}</h1><div>RUC ${esc(business.taxId)}</div><div>${esc(business.address)}</div></div>
      <div class="meta"><strong>ROL DE PAGOS</strong><div>${esc(role.role_number||role.roleNumber)}</div><div>${esc(period.date_from||period.dateFrom)} a ${esc(period.date_to||period.dateTo)}</div><div class="draft">${esc(role.status)}</div></div></header>
      ${items.map(item=>{const policies=item.performance_policy_snapshots||item.performancePolicySnapshots||[];const lines=item.lines||[];const earnings=lines.filter(line=>(line.line_kind||line.lineKind)==="EARNING");const deductions=lines.filter(line=>(line.line_kind||line.lineKind)==="DEDUCTION");const adjusted=Math.abs(Number(item.base_amount_used??item.baseAmountUsed??0)-Number(item.reference_base_salary??item.referenceBaseSalary??0))>.000001;return `<section class="employee"><h2>${esc(item.employee_name_snapshot||item.employeeName)}</h2><div class="employee-meta"><span><strong>Identificación:</strong> ${esc(item.employee_identification_snapshot||item.employeeIdentification||"")}</span><span><strong>Código:</strong> ${esc(item.employee_code_snapshot||item.employeeCode)}</span><span><strong>Cargo:</strong> ${esc(item.position_snapshot||item.position)}</span><span><strong>Modalidad:</strong> ${esc(item.calculation_mode_snapshot||item.calculationMode)}</span></div>
        ${policies.length?`<h3>Control de rendimiento (informativo)</h3><table><thead><tr><th>Función</th><th>Meta</th><th>Real</th><th>Cumplimiento</th><th>Referencia tallos</th></tr></thead><tbody>${policies.map(policy=>{const op=policy.operational_role||policy.operationalRole;const unit=(policy.primary_unit||policy.primaryUnit)==="BUNCH"?"ramos":"mallas";return `<tr><td>${op==="BUNCHER"?"Embonche":"Clasificación"}</td><td>${number(policy.period_target||policy.periodTarget,0)} ${unit}</td><td>${number(policy.actual_units||policy.actualUnits,0)} ${unit}</td><td><strong>${number(policy.performance_percentage||policy.performancePercentage,2)} %</strong></td><td>${number(policy.reference_stems_actual||policy.referenceStemsActual,0)} / ${number(policy.reference_stems_target||policy.referenceStemsTarget,0)}</td></tr>`;}).join("")}</tbody></table><div class="adjustment">El cumplimiento no modifica automáticamente la remuneración.</div>`:""}
        <div class="split"><div><h3>Ingresos</h3><table><thead><tr><th>Concepto</th><th>Observación</th><th class="num">Valor</th></tr></thead><tbody>${earnings.map(line=>`<tr><td>${esc(line.concept_label||line.conceptLabel)}</td><td>${esc(line.line_notes||line.lineNotes||line.source_reference||"")}</td><td class="num">${money(line.amount)}</td></tr>`).join("")||'<tr><td colspan="3">Sin ingresos.</td></tr>'}<tr class="totals"><td colspan="2">TOTAL INGRESOS</td><td class="num">${money(item.total_income||item.totalIncome)}</td></tr></tbody></table></div>
        <div><h3>Descuentos</h3><table><thead><tr><th>Concepto</th><th>Observación</th><th class="num">Valor</th></tr></thead><tbody>${deductions.map(line=>`<tr><td>${esc(line.concept_label||line.conceptLabel)}</td><td>${esc(line.line_notes||line.lineNotes||line.source_reference||"")}</td><td class="num">${money(line.amount)}</td></tr>`).join("")||'<tr><td colspan="3">Sin descuentos.</td></tr>'}<tr class="totals"><td colspan="2">TOTAL DESCUENTOS</td><td class="num">${money(item.total_discounts||item.totalDiscounts)}</td></tr></tbody></table></div></div>
        <table><tr class="totals"><td>NETO A PAGAR</td><td class="num">${money(item.net_total||item.netTotal)}</td></tr></table>${adjusted?`<div class="adjustment"><strong>Valor base ajustado para este período:</strong> referencia ${money(item.reference_base_salary||item.referenceBaseSalary)} · utilizado ${money(item.base_amount_used||item.baseAmountUsed)} · motivo: ${esc(item.base_adjustment_reason||item.baseAdjustmentReason)}</div>`:""}${item.employee_notes||item.employeeNotes?`<div class="note"><strong>Observaciones:</strong> ${esc(item.employee_notes||item.employeeNotes)}</div>`:""}${itemId?'<div class="signatures"><div class="signature">Trabajador</div><div class="signature">Responsable / autorización</div></div>':""}</section>`;}).join("")}
      ${!itemId?`<table><tr class="totals"><td>Total ingresos</td><td class="num">${money(role.total_income||role.totalIncome)}</td><td>Total descuentos</td><td class="num">${money(role.total_discounts||role.totalDiscounts)}</td><td>TOTAL NÓMINA</td><td class="num">${money(role.net_total||role.netTotal)}</td></tr></table>${role.notes?`<div class="note"><strong>Observación general:</strong> ${esc(role.notes)}</div>`:""}`:""}
      </body></html>`;
  }
  function print(roleId,itemId=""){
    const repo=BlessERP.getPayrollV2Repository?.();
    if(!repo?.canExecute?.()||!repo.healthStatus()?.data?.capabilities?.includes('payroll.roles.print')){
      BlessERP.layout?.toast?.('No tiene permiso para imprimir roles de pago.');return false;
    }
    const html=render(roleId,itemId); if(!html)return BlessERP.layout?.toast?.("Rol V2 no encontrado.");
    const popup=window.open("","_blank","noopener,noreferrer"); if(!popup)return BlessERP.layout?.toast?.("Permita ventanas emergentes para imprimir.");
    popup.document.open();popup.document.write(html);popup.document.close();popup.focus();setTimeout(()=>popup.print(),180);
  }
  BlessERP.payrollV2Print=Object.freeze({render,print});
})();
