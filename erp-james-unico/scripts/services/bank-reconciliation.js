(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const bankService = BlessERP.services.banks;
  const journalService = BlessERP.services.journal;
  const companyService = BlessERP.services.companySettings;
  const adminService = BlessERP.services.adminConfig;
  const { clone, uid, today } = BlessERP.utils;

  const reconciliationStates = ["BORRADOR", "EN_REVISION", "CERRADA", "REABIERTA", "ANULADA"];
  const lineStates = ["pendiente", "conciliado", "observado"];
  const suggestionStates = ["MATCH_EXACTO", "MATCH_POSIBLE", "SIN_COINCIDENCIA"];
  const toleranceAmount = 0.01;

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function saveList(key, rows) {
    stateApi.state.db[key] = rows;
    stateApi.saveDb();
  }

  function currentUser() {
    return adminService?.activeUser?.() || stateApi.state.db.session?.activeUser || { id: "demo", name: "Usuario demo", role: "Administrador" };
  }

  function nextStatementNumber(existing = null) {
    const rows = existing || cloneList("bankStatementMovements");
    const year = companyService.settings().periodStart?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.statementNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `EXT-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function periodDateRange(period = "") {
    if (!/^\d{4}-\d{2}$/.test(String(period || ""))) {
      const settings = companyService.settings();
      return {
        period: settings.activePeriod || "",
        dateFrom: settings.periodStart || today(),
        dateTo: settings.periodEnd || today()
      };
    }
    const [year, month] = String(period).split("-").map(Number);
    const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(year, month, 0);
    const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return { period: `${year}-${String(month).padStart(2, "0")}`, dateFrom, dateTo };
  }

  function emptyStatementMovement(bankAccountId = "") {
    return {
      id: "",
      statementNumber: nextStatementNumber(),
      bankAccountId,
      movementDate: today(),
      reference: "",
      description: "",
      externalUniqueCode: "",
      transactionType: "",
      incomeValue: 0,
      expenseValue: 0,
      netValue: 0,
      reportedBalance: 0,
      status: "pendiente",
      relatedMovementId: "",
      observation: "",
      reconciliationId: "",
      source: "MANUAL",
      sourceFile: "",
      importedAt: "",
      importRowNumber: 0
    };
  }

  function normalizeStatementMovement(movement = {}) {
    const current = { ...emptyStatementMovement(movement.bankAccountId || ""), ...clone(movement || {}) };
    return {
      id: current.id || uid("STM"),
      statementNumber: String(current.statementNumber || nextStatementNumber()).trim(),
      bankAccountId: String(current.bankAccountId || "").trim(),
      movementDate: String(current.movementDate || today()).trim(),
      reference: String(current.reference || "").trim(),
      description: String(current.description || "").trim(),
      externalUniqueCode: String(current.externalUniqueCode || "").trim(),
      transactionType: String(current.transactionType || "").trim(),
      incomeValue: round2(current.incomeValue || 0),
      expenseValue: round2(current.expenseValue || 0),
      netValue: round2((current.incomeValue || 0) - (current.expenseValue || 0)),
      reportedBalance: round2(current.reportedBalance || 0),
      status: ({ UNIDENTIFIED:"pendiente",UNRECONCILED:"pendiente",PARTIALLY_RECONCILED:"observado",RECONCILED:"conciliado",VOIDED:"observado" })[String(current.reconciliationStatus || current.status || "").toUpperCase()]
        || (lineStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "pendiente"),
      relatedMovementId: String(current.relatedMovementId || "").trim(),
      observation: String(current.observation || "").trim(),
      reconciliationId: String(current.reconciliationId || "").trim(),
      source: String(current.source || "MANUAL").trim(),
      sourceFile: String(current.sourceFile || "").trim(),
      importedAt: String(current.importedAt || "").trim(),
      importRowNumber: Number(current.importRowNumber || 0)
    };
  }

  function statementMovements(filters = {}) {
    const canonical = (BlessERP.services?.treasuryV2?.bankTransactions?.() || []).filter(item => item.originType === "REAL_STATEMENT");
    const ids = new Set(canonical.map(item => item.id));
    return [...canonical, ...cloneList("bankStatementMovements").filter(item => !ids.has(item.id))]
      .map(normalizeStatementMovement)
      .filter(item => {
        if (filters.bankAccountId && item.bankAccountId !== filters.bankAccountId) return false;
        if (filters.status && item.status !== filters.status) return false;
        if (filters.reconciliationId !== undefined && item.reconciliationId !== filters.reconciliationId) return false;
        if (filters.dateFrom && item.movementDate < filters.dateFrom) return false;
        if (filters.dateTo && item.movementDate > filters.dateTo) return false;
        if (filters.search) {
          const search = String(filters.search || "").toLowerCase();
          const haystack = [item.statementNumber, item.reference, item.description, item.observation].join(" ").toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => `${b.movementDate}|${b.statementNumber}`.localeCompare(`${a.movementDate}|${a.statementNumber}`, "es"));
  }

  async function saveStatementMovement(movement) {
    const candidate = normalizeStatementMovement(movement);
    const errors = [];
    if (!candidate.bankAccountId) errors.push("Debe seleccionar la cuenta bancaria del estado de cuenta.");
    if (!candidate.movementDate) errors.push("La fecha del movimiento bancario externo es obligatoria.");
    if (!candidate.reference) errors.push("La referencia del estado de cuenta es obligatoria.");
    if (candidate.incomeValue > 0 && candidate.expenseValue > 0) errors.push("No se permite ingreso y egreso al mismo tiempo en el estado de cuenta.");
    if (candidate.incomeValue <= 0 && candidate.expenseValue <= 0) errors.push("El movimiento del estado de cuenta no puede ser cero.");
    const duplicateCode = candidate.externalUniqueCode && statementMovements().find(item => (
      item.id !== candidate.id
        && item.bankAccountId === candidate.bankAccountId
        && item.externalUniqueCode.toUpperCase() === candidate.externalUniqueCode.toUpperCase()
    ));
    if (duplicateCode) errors.push(`El código único ${candidate.externalUniqueCode} ya fue importado en esta cuenta.`);
    if (errors.length) return { ok: false, errors };
    const result = await BlessERP.services?.treasuryV2?.registerTransaction?.({
      accountType:"BANK",accountId:candidate.bankAccountId,transactionDate:candidate.movementDate,valueDate:candidate.movementDate,
      direction:candidate.incomeValue>0?"CREDIT":"DEBIT",amount:Number(candidate.incomeValue || candidate.expenseValue),
      description:candidate.description,reference:candidate.reference,originType:"REAL_STATEMENT",sourceType:"MANUAL_STATEMENT",
      sourceId:candidate.externalUniqueCode || candidate.id
    });
    return result?.ok ? { ...result,movement:normalizeStatementMovement(result.transaction) }
      : { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "Supabase no confirmó el movimiento externo."] };
  }

  async function saveStatementMovementsBatch(movements = [], options = {}) {
    const sourceRows = Array.isArray(movements) ? movements : [];
    const existing = statementMovements();
    const accepted = [];
    const errors = [];
    const knownCodes = new Set(existing
      .filter(item => item.externalUniqueCode)
      .map(item => `${item.bankAccountId}|${item.externalUniqueCode.toUpperCase()}`));
    sourceRows.forEach((movement, index) => {
      const raw = {
        ...movement,
        bankAccountId: movement.bankAccountId || options.bankAccountId || "",
        source: "XLSX_IMPORT",
        sourceFile: movement.sourceFile || options.sourceFile || "",
        importedAt: movement.importedAt || new Date().toISOString()
      };
      const candidate = normalizeStatementMovement(raw);
      if (!raw.statementNumber) candidate.statementNumber = nextStatementNumber([...existing, ...accepted]);
      const rowNumber = Number(candidate.importRowNumber || index + 2);
      const rowErrors = [];
      if (!candidate.bankAccountId) rowErrors.push("debe seleccionar la cuenta bancaria");
      if (!candidate.movementDate) rowErrors.push("fecha obligatoria");
      if (!candidate.description) rowErrors.push("detalle obligatorio");
      if (!candidate.externalUniqueCode) rowErrors.push("código único obligatorio");
      if (candidate.incomeValue > 0 && candidate.expenseValue > 0) rowErrors.push("crédito y débito no pueden coexistir");
      if (candidate.incomeValue <= 0 && candidate.expenseValue <= 0) rowErrors.push("crédito o débito debe ser mayor que cero");
      const uniqueKey = `${candidate.bankAccountId}|${candidate.externalUniqueCode.toUpperCase()}`;
      if (candidate.externalUniqueCode && knownCodes.has(uniqueKey)) rowErrors.push(`código único duplicado (${candidate.externalUniqueCode})`);
      if (rowErrors.length) {
        errors.push(`Fila ${rowNumber}: ${rowErrors.join("; ")}.`);
        return;
      }
      knownCodes.add(uniqueKey);
      accepted.push(candidate);
    });
    if (errors.length) return { ok: false, imported: 0, movements: [], errors };
    if (!accepted.length) return { ok: false, imported: 0, movements: [], errors: ["No existen movimientos válidos para importar."] };
    const remote = await BlessERP.services?.treasuryV2?.importStatement?.({
      bankAccountId: options.bankAccountId,
      fileName: options.sourceFile || "",
      fileFingerprint: options.fileFingerprint || accepted.map(item => item.externalUniqueCode).sort().join("|"),
      rows: accepted.map((item,index) => ({
        transactionDate:item.movementDate,valueDate:item.movementDate,
        direction:item.incomeValue>0?"CREDIT":"DEBIT",amount:Number(item.incomeValue || item.expenseValue),
        currencyCode:"USD",description:item.description,reference:item.reference,externalId:item.externalUniqueCode,
        occurrence:index+1
      }))
    });
    if (!remote?.ok) return { ok:false,imported:0,movements:[],errors:remote?.errors || [remote?.message || "Supabase no confirmó la importación."] };
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "IMPORTAR_ESTADO_CUENTA_XLSX",
      entityType: "bank_statement_import",
      entityId: uid("IMP"),
      entityLabel: options.sourceFile || "Extracto XLSX",
      description: `Supabase confirmó ${remote.imported} movimientos bancarios externos.`,
      after: { sourceFile: options.sourceFile || "", imported: remote.imported,duplicates:remote.duplicates },
      result: "exitoso"
    });
    return { ok: true, imported: remote.imported, duplicates:remote.duplicates, movements: clone(remote.transactions || []), errors: [],sync:remote };
  }

  function emptyReconciliation(bankAccountId = "") {
    const settings = companyService.settings();
    const range = periodDateRange(settings.activePeriod || "");
    return {
      id: "",
      bankAccountId,
      period: range.period,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      openingBankBalance: 0,
      closingBankBalance: 0,
      status: "BORRADOR",
      notes: "",
      differenceJustification: "",
      closeDate: "",
      closedBy: "",
      reopenedAt: "",
      reopenedBy: "",
      reopenReason: "",
      createdAt: new Date().toISOString(),
      createdBy: currentUser().name,
      matches: [],
      systemReviews: [],
      statementReviews: []
    };
  }

  function normalizeReview(row = {}) {
    return {
      movementId: String(row.movementId || "").trim(),
      status: lineStates.includes(String(row.status || "").toLowerCase()) ? String(row.status || "").toLowerCase() : "pendiente",
      observation: String(row.observation || "").trim()
    };
  }

  function normalizeMatch(match = {}) {
    const systemMovementIds = [...new Set([
      ...(Array.isArray(match.systemMovementIds) ? match.systemMovementIds : []),
      match.systemMovementId
    ].map(value => String(value || "").trim()).filter(Boolean))];
    const statementMovementIds = [...new Set([
      ...(Array.isArray(match.statementMovementIds) ? match.statementMovementIds : []),
      match.statementMovementId
    ].map(value => String(value || "").trim()).filter(Boolean))];
    return {
      id: match.id || uid("MTC"),
      systemMovementId: systemMovementIds[0] || "",
      statementMovementId: statementMovementIds[0] || "",
      systemMovementIds,
      statementMovementIds,
      suggestion: suggestionStates.includes(String(match.suggestion || "").toUpperCase()) ? String(match.suggestion || "").toUpperCase() : "MATCH_POSIBLE",
      amount: round2(match.amount || 0),
      note: String(match.note || "").trim(),
      status: "CONCILIADO",
      createdAt: match.createdAt || new Date().toISOString(),
      createdBy: String(match.createdBy || currentUser().name).trim()
    };
  }

  function matchSystemIds(match = {}) {
    return normalizeMatch(match).systemMovementIds;
  }

  function matchStatementIds(match = {}) {
    return normalizeMatch(match).statementMovementIds;
  }

  function normalizeReconciliation(reconciliation = {}) {
    const current = { ...emptyReconciliation(reconciliation.bankAccountId || ""), ...clone(reconciliation || {}) };
    const range = periodDateRange(current.period);
    return {
      id: current.id || uid("REC"),
      bankAccountId: String(current.bankAccountId || "").trim(),
      period: String(current.period || range.period).trim(),
      dateFrom: String(current.dateFrom || range.dateFrom).trim(),
      dateTo: String(current.dateTo || range.dateTo).trim(),
      openingBankBalance: round2(current.openingBankBalance || 0),
      closingBankBalance: round2(current.closingBankBalance || 0),
      status: ({ OPEN:"BORRADOR",IN_REVIEW:"EN_REVISION",CLOSED:"CERRADA",REOPENED:"REABIERTA",CANCELLED:"ANULADA" })[String(current.status || "").toUpperCase()]
        || (reconciliationStates.includes(String(current.status || "").toUpperCase()) ? String(current.status || "").toUpperCase() : "BORRADOR"),
      notes: String(current.notes || "").trim(),
      differenceJustification: String(current.differenceJustification || "").trim(),
      closeDate: String(current.closeDate || "").trim(),
      closedBy: String(current.closedBy || "").trim(),
      reopenedAt: String(current.reopenedAt || "").trim(),
      reopenedBy: String(current.reopenedBy || "").trim(),
      reopenReason: String(current.reopenReason || "").trim(),
      createdAt: current.createdAt || new Date().toISOString(),
      createdBy: String(current.createdBy || currentUser().name).trim(),
      updatedAt: String(current.updatedAt || current.createdAt || new Date().toISOString()).trim(),
      updatedBy: String(current.updatedBy || current.createdBy || currentUser().name).trim(),
      matches: (current.matches || []).map(normalizeMatch),
      systemReviews: (current.systemReviews || []).map(normalizeReview),
      statementReviews: (current.statementReviews || []).map(normalizeReview)
    };
  }

  function reconciliations() {
    const canonical = BlessERP.services?.treasuryV2?.reconciliations?.() || [];
    const canonicalMatches = BlessERP.services?.treasuryV2?.reconciliationMatches?.() || [];
    const canonicalReviews = BlessERP.services?.treasuryV2?.reconciliationReviews?.() || [];
    const ids = new Set(canonical.map(item => item.id));
    return [...canonical.map(item => ({ ...item,matches:canonicalMatches.filter(match => match.reconciliationId === item.id && match.status !== "REVERSED").map(match => ({
      id:match.id,systemMovementIds:[`${({COLLECTION:"COB",SUPPLIER_PAYMENT:"PAY",TRANSFER_OUT:"TRF",TRANSFER_IN:"TRF",ADJUSTMENT:"AJT",JOURNAL:"JRN"})[match.sourceType] || match.sourceType}-${match.sourceId}${match.sourceType==="TRANSFER_OUT"?"-DEBIT":match.sourceType==="TRANSFER_IN"?"-CREDIT":""}`],
      statementMovementIds:[match.bankTransactionId],amount:match.amount,note:match.note,createdAt:match.createdAt,status:"CONCILIADO"
    })),systemReviews:canonicalReviews.filter(review=>review.reconciliationId===item.id&&review.kind==="system"&&review.status==="observado"),
      statementReviews:canonicalReviews.filter(review=>review.reconciliationId===item.id&&review.kind==="statement"&&review.status==="observado") })), ...cloneList("bankReconciliations").filter(item => !ids.has(item.id))]
      .map(normalizeReconciliation)
      .sort((a, b) => `${b.period}|${b.createdAt}`.localeCompare(`${a.period}|${a.createdAt}`, "es"));
  }

  function findReconciliationById(reconciliationId) {
    return reconciliations().find(item => item.id === reconciliationId) || null;
  }

  async function saveReconciliationV2(reconciliation) {
    const candidate = normalizeReconciliation(reconciliation);
    if (!candidate.bankAccountId || !candidate.dateFrom || !candidate.dateTo) return { ok:false,errors:["Cuenta y rango de conciliación son obligatorios."] };
    const result = await BlessERP.services?.treasuryV2?.saveReconciliation?.({
      reconciliationId:/^[0-9a-f-]{36}$/i.test(candidate.id)?candidate.id:"",bankAccountId:candidate.bankAccountId,
      dateFrom:candidate.dateFrom,dateTo:candidate.dateTo,openingBankBalance:candidate.openingBankBalance,
      closingBankBalance:candidate.closingBankBalance,bookClosingBalance:metrics(candidate).bookClosingBalance,
      difference:metrics(candidate).difference,notes:candidate.notes || candidate.differenceJustification
    });
    return result?.ok ? { ...result,reconciliation:normalizeReconciliation(result.reconciliation) }
      : { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "Conciliación no confirmada."] };
  }

  function reconciliationSource(row = {}) {
    const kind=String(row.sourceType || row.sourceKind || "").toUpperCase();
    const id=String(row.id || "");
    const direction=Number(row.incomeValue || 0)>0 ? "CREDIT" : "DEBIT";
    if(["COBRO","COLLECTION"].includes(kind) || id.startsWith("COB-")) return { sourceType:"COLLECTION",sourceId:String(row.sourceId || id.replace(/^COB-/,"")),sourceDirection:direction };
    if(["PAGO","SUPPLIER_PAYMENT"].includes(kind) || id.startsWith("PAY-")) return { sourceType:"SUPPLIER_PAYMENT",sourceId:String(row.sourceId || id.replace(/^PAY-/,"")),sourceDirection:direction };
    if(kind==="TRANSFER" || id.startsWith("TRF-")) return { sourceType:direction==="CREDIT"?"TRANSFER_IN":"TRANSFER_OUT",sourceId:String(row.sourceId || id.replace(/^TRF-/,"")),sourceDirection:direction };
    if(["AJUSTE","ADJUSTMENT"].includes(kind) || id.startsWith("AJT-")) return { sourceType:"ADJUSTMENT",sourceId:String(row.sourceId || id.replace(/^AJT-/,"")),sourceDirection:direction };
    return { sourceType:"JOURNAL",sourceId:String(row.journalEntryId || id.replace(/^JRN-/,"")),sourceDirection:direction };
  }

  async function linkMatchGroupV2(reconciliationId,systemMovementIds=[],statementMovementIds=[],note="") {
    const current=findReconciliationById(reconciliationId); if(!current) return {ok:false,errors:["Conciliación no encontrada."]};
    const searchWorkspace=BlessERP.services?.treasuryReadV2?.snapshot?.()?.workspace?.data || {};
    const availableSystems=searchWorkspace.systemRows || systemRowsFor(current);
    const availableStatements=searchWorkspace.statementRows || statementRowsFor(current);
    const systems=systemMovementIds.map(id=>availableSystems.find(row=>row.id===id)).filter(Boolean);
    const statements=statementMovementIds.map(id=>availableStatements.find(row=>(row.id || row.bankTransactionId)===id)).filter(Boolean);
    const systemTotal=round2(systems.reduce((sum,row)=>sum+Math.abs(Number(row.incomeValue||0)-Number(row.expenseValue||0)),0));
    const statementTotal=round2(statements.reduce((sum,row)=>sum+Math.abs(Number(row.incomeValue||0)-Number(row.expenseValue||0)),0));
    if(!systems.length || !statements.length || Math.abs(systemTotal-statementTotal)>toleranceAmount) return {ok:false,errors:[`Los totales seleccionados no coinciden. Sistema: ${systemTotal.toFixed(2)} · Banco: ${statementTotal.toFixed(2)}.`]};
    const remaining=systems.map(row=>({row,left:Math.abs(Number(row.incomeValue||0)-Number(row.expenseValue||0))})); const matches=[];
    for(const statement of statements){ let left=Math.abs(Number(statement.incomeValue||0)-Number(statement.expenseValue||0));
      for(const source of remaining){ if(left<=0) break; if(source.left<=0) continue; const amount=Math.min(left,source.left); const ref=reconciliationSource(source.row);
        matches.push({bankTransactionId:statement.id,...ref,amount}); left=round2(left-amount); source.left=round2(source.left-amount); }
    }
    const result=await BlessERP.services?.treasuryV2?.reconcile?.(reconciliationId,matches,note);
    return result?.ok ? { ...result,reconciliation:findReconciliationById(reconciliationId),suggestion:{status:"MATCH_EXACTO"} }
      : { ...(result||{}),ok:false,errors:result?.errors || [result?.message || "Conciliación no confirmada."] };
  }

  async function unlinkMatchGroupV2(reconciliationId,matchId) {
    const result=await BlessERP.services?.treasuryV2?.reverseMatch?.(matchId,"Deshacer conciliación solicitado por el usuario");
    return result?.ok ? { ...result,reconciliation:findReconciliationById(reconciliationId) }
      : { ...(result||{}),ok:false,errors:result?.errors || [result?.message || "No se pudo deshacer."] };
  }

  async function closeReconciliationV2(reconciliationId) {
    const current=findReconciliationById(reconciliationId); const result=await BlessERP.services?.treasuryV2?.closeReconciliation?.(reconciliationId,current?.closingBankBalance || 0);
    return result?.ok ? { ...result,reconciliation:normalizeReconciliation(result.reconciliation) }
      : { ...(result||{}),ok:false,errors:result?.errors || [result?.message || "Cierre no confirmado."] };
  }
  async function reopenReconciliationV2(reconciliationId,reason="") {
    const result=await BlessERP.services?.treasuryV2?.reopenReconciliation?.(reconciliationId,reason);
    return result?.ok ? { ...result,reconciliation:normalizeReconciliation(result.reconciliation) }
      : { ...(result||{}),ok:false,errors:result?.errors || [result?.message || "Reapertura no confirmada."] };
  }
  function deleteReconciliationV2(){ return {ok:false,errors:["Las conciliaciones V2 no se eliminan. Cierre o reabra mediante una acción auditada."]}; }

  function dateDiffDays(left, right) {
    const one = new Date(left);
    const two = new Date(right);
    return Math.abs(Math.round((two - one) / (1000 * 60 * 60 * 24)));
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function textRelated(left, right) {
    const l = normalizeText(left);
    const r = normalizeText(right);
    if (!l || !r) return false;
    if (l === r) return true;
    if (l.includes(r) || r.includes(l)) return true;
    const leftTokens = new Set(l.split(/\s+/));
    const rightTokens = new Set(r.split(/\s+/));
    let matches = 0;
    leftTokens.forEach(token => {
      if (rightTokens.has(token)) matches += 1;
    });
    return matches >= 2;
  }

  function systemRowsFor(reconciliation) {
    const usedElsewhere = new Set(reconciliations()
      .filter(item => item.id !== reconciliation.id && item.status !== "ANULADA")
      .flatMap(item => item.matches.flatMap(matchSystemIds)));
    return bankService.movements({
      bankAccountId: reconciliation.bankAccountId,
      dateFrom: reconciliation.dateFrom,
      dateTo: reconciliation.dateTo
    }).filter(item => item.status === "CONTABILIZADO" && !usedElsewhere.has(item.id));
  }

  function statementRowsFor(reconciliation) {
    const usedElsewhere = new Set(reconciliations()
      .filter(item => item.id !== reconciliation.id && item.status !== "ANULADA")
      .flatMap(item => item.matches.flatMap(matchStatementIds)));
    return statementMovements({
      bankAccountId: reconciliation.bankAccountId,
      dateFrom: reconciliation.dateFrom,
      dateTo: reconciliation.dateTo
    }).filter(item => !usedElsewhere.has(item.id) && (!item.reconciliationId || item.reconciliationId === reconciliation.id));
  }

  function systemRowState(reconciliation, movementId) {
    const row = systemRowsFor(reconciliation).find(item => item.id === movementId);
    const matches = reconciliation.matches.filter(item => matchSystemIds(item).includes(movementId));
    if (matches.length) {
      const target = Math.abs(Number(row?.incomeValue || 0) - Number(row?.expenseValue || 0));
      const allocated = round2(matches.reduce((sum, item) => sum + (Number(item.amount || 0) > 0 ? Number(item.amount) : target), 0));
      return allocated + toleranceAmount >= target ? "conciliado" : "observado";
    }
    const review = reconciliation.systemReviews.find(item => item.movementId === movementId);
    return review?.status || "pendiente";
  }

  function statementRowState(reconciliation, movementId) {
    const row = statementRowsFor(reconciliation).find(item => item.id === movementId);
    const matches = reconciliation.matches.filter(item => matchStatementIds(item).includes(movementId));
    if (matches.length) {
      const target = Math.abs(Number(row?.incomeValue || 0) - Number(row?.expenseValue || 0));
      const allocated = round2(matches.reduce((sum, item) => sum + (Number(item.amount || 0) > 0 ? Number(item.amount) : target), 0));
      return allocated + toleranceAmount >= target ? "conciliado" : "observado";
    }
    const review = reconciliation.statementReviews.find(item => item.movementId === movementId);
    return review?.status || "pendiente";
  }

  function suggestionForPair(systemRow, statementRow, reconciliation) {
    if (!systemRow || !statementRow) return { status: "SIN_COINCIDENCIA", reason: "Datos incompletos." };
    if (systemRow.bankAccountId !== reconciliation.bankAccountId || statementRow.bankAccountId !== reconciliation.bankAccountId) {
      return { status: "SIN_COINCIDENCIA", reason: "La cuenta bancaria no coincide." };
    }
    const systemNet = round2(Number(systemRow.incomeValue || 0) - Number(systemRow.expenseValue || 0));
    const statementNet = round2(Number(statementRow.incomeValue || 0) - Number(statementRow.expenseValue || 0));
    const amountDiff = round2(Math.abs(systemNet - statementNet));
    const days = dateDiffDays(systemRow.movementDate, statementRow.movementDate);
    const refMatch = textRelated(systemRow.reference, statementRow.reference);
    const textMatch = textRelated(systemRow.concept, statementRow.description) || textRelated(systemRow.beneficiary, statementRow.description);
    if (amountDiff <= toleranceAmount && days <= 1 && (refMatch || textMatch)) {
      return { status: "MATCH_EXACTO", reason: "Valor y referencia coinciden." };
    }
    if (amountDiff <= toleranceAmount && days <= 3) {
      return { status: "MATCH_POSIBLE", reason: "Valor igual y fecha cercana." };
    }
    return { status: "SIN_COINCIDENCIA", reason: amountDiff > toleranceAmount ? "El valor no coincide dentro de la tolerancia." : "La fecha no coincide." };
  }

  function suggestionsFor(reconciliation) {
    const systemRows = systemRowsFor(reconciliation).filter(item => systemRowState(reconciliation, item.id) === "pendiente");
    const statementRows = statementRowsFor(reconciliation).filter(item => statementRowState(reconciliation, item.id) === "pendiente");
    const map = {};
    systemRows.forEach(systemRow => {
      const candidates = statementRows.map(statementRow => ({
        statementMovementId: statementRow.id,
        ...suggestionForPair(systemRow, statementRow, reconciliation)
      }))
        .filter(item => item.status !== "SIN_COINCIDENCIA")
        .sort((a, b) => {
          const left = a.status === "MATCH_EXACTO" ? 0 : 1;
          const right = b.status === "MATCH_EXACTO" ? 0 : 1;
          return left - right;
        });
      map[systemRow.id] = candidates;
    });
    return map;
  }

  function reviewObservationFor(reconciliation, kind, movementId) {
    const collection = kind === "system" ? reconciliation.systemReviews : reconciliation.statementReviews;
    return collection.find(item => item.movementId === movementId)?.observation || "";
  }

  function metrics(reconciliation) {
    const systemRows = systemRowsFor(reconciliation);
    const statementRows = statementRowsFor(reconciliation);
    const totalSystemIncome = round2(systemRows.reduce((sum, item) => sum + Number(item.incomeValue || 0), 0));
    const totalSystemExpense = round2(systemRows.reduce((sum, item) => sum + Number(item.expenseValue || 0), 0));
    const totalBankIncome = round2(statementRows.reduce((sum, item) => sum + Number(item.incomeValue || 0), 0));
    const totalBankExpense = round2(statementRows.reduce((sum, item) => sum + Number(item.expenseValue || 0), 0));
    const totalConciliated = round2(reconciliation.matches.reduce((sum, item) => {
      if (Number(item.amount || 0) > 0) return sum + Number(item.amount);
      return sum + matchStatementIds(item).reduce((matchSum, statementMovementId) => {
        const statement = statementRows.find(row => row.id === statementMovementId);
        return matchSum + Math.abs(Number(statement?.netValue || 0));
      }, 0);
    }, 0));
    const pendingSystemRows = systemRows.filter(item => systemRowState(reconciliation, item.id) === "pendiente");
    const pendingBankRows = statementRows.filter(item => statementRowState(reconciliation, item.id) === "pendiente");
    const observedSystemRows = systemRows.filter(item => systemRowState(reconciliation, item.id) === "observado");
    const observedBankRows = statementRows.filter(item => statementRowState(reconciliation, item.id) === "observado");
    const auxiliaryBalance = round2(reconciliation.openingBankBalance + totalSystemIncome - totalSystemExpense);
    const difference = round2(reconciliation.closingBankBalance - auxiliaryBalance);
    const account = bankService.findBankAccountById(reconciliation.bankAccountId);
    const ledger = account?.linkedAccountCode ? journalService.ledgerByAccount(account.linkedAccountCode, { dateFrom: reconciliation.dateFrom, dateTo: reconciliation.dateTo }) : null;
    return {
      totalSystemIncome,
      totalSystemExpense,
      totalBankIncome,
      totalBankExpense,
      totalConciliated,
      pendingSystemRows,
      pendingBankRows,
      observedSystemRows,
      observedBankRows,
      auxiliaryBalance,
      difference,
      ledger
    };
  }

  function setStatementReconciliationFlags(reconciliation) {
    const rows = statementMovements();
    const matchedIds = new Set(reconciliation.matches.flatMap(matchStatementIds));
    const reviewed = new Map(reconciliation.statementReviews.map(item => [item.movementId, item]));
    let changed = false;
    rows.forEach(row => {
      if (row.bankAccountId !== reconciliation.bankAccountId) return;
      if (row.movementDate < reconciliation.dateFrom || row.movementDate > reconciliation.dateTo) return;
      if (matchedIds.has(row.id)) {
        const match = reconciliation.matches.find(item => matchStatementIds(item).includes(row.id));
        row.status = "conciliado";
        row.reconciliationId = reconciliation.id;
        row.relatedMovementId = match ? matchSystemIds(match).join(",") : row.relatedMovementId;
        changed = true;
        return;
      }
      const review = reviewed.get(row.id);
      if (review?.status === "observado") {
        row.status = "observado";
        row.reconciliationId = reconciliation.id;
        row.observation = review.observation || row.observation;
        changed = true;
        return;
      }
      if (row.reconciliationId === reconciliation.id) {
        row.status = "pendiente";
        row.reconciliationId = "";
        row.relatedMovementId = "";
        changed = true;
      }
    });
    if (changed) saveList("bankStatementMovements", rows);
  }

  function validateReconciliation(reconciliation, { forClose = false } = {}) {
    const candidate = normalizeReconciliation(reconciliation);
    const errors = [];
    if (!candidate.bankAccountId) errors.push("Debe seleccionar una cuenta bancaria.");
    if (!candidate.period) errors.push("Debe definir el periodo.");
    if (!candidate.dateFrom || !candidate.dateTo) errors.push("Debe definir el rango de fechas.");
    if (candidate.dateFrom && candidate.dateTo && candidate.dateFrom > candidate.dateTo) errors.push("La fecha desde no puede ser mayor a la fecha hasta.");
    if (forClose) {
      if (candidate.status === "CERRADA") errors.push("La conciliacion ya esta cerrada.");
      if (!String(candidate.closingBankBalance).length) errors.push("Debe ingresar el saldo final segun banco.");
      const info = metrics(candidate);
      if (Math.abs(info.difference) > toleranceAmount && !candidate.differenceJustification) {
        errors.push("No se puede cerrar con diferencia sin justificar.");
      }
      const observedWithoutExplanation = [
        ...candidate.systemReviews.filter(item => item.status === "observado" && !item.observation),
        ...candidate.statementReviews.filter(item => item.status === "observado" && !item.observation)
      ];
      if (observedWithoutExplanation.length) errors.push("Existen movimientos observados sin explicacion.");
    }
    return { reconciliation: candidate, errors };
  }

  function saveReconciliation(reconciliation) {
    const { reconciliation: candidate, errors } = validateReconciliation(reconciliation, { forClose: false });
    if (errors.length) return { ok: false, errors };
    if (candidate.status === "CERRADA") return { ok: false, errors: ["La conciliacion cerrada no se puede editar directamente."] };
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === candidate.id);
    const duplicate = rows.find(item => item.id !== candidate.id
      && item.status !== "ANULADA"
      && item.bankAccountId === candidate.bankAccountId
      && item.period === candidate.period);
    if (duplicate) return { ok: false, errors: ["Ya existe una conciliación para esta cuenta bancaria y período. Use Modificar desde el historial."] };
    const before = index >= 0 ? clone(rows[index]) : null;
    candidate.id = candidate.id || uid("REC");
    if (!candidate.status || candidate.status === "BORRADOR") {
      const hasProgress = candidate.matches.length || candidate.systemReviews.length || candidate.statementReviews.length || candidate.closingBankBalance;
      candidate.status = hasProgress ? "EN_REVISION" : "BORRADOR";
    }
    candidate.updatedAt = new Date().toISOString();
    candidate.updatedBy = currentUser().name;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(candidate);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: index >= 0 ? "EDITAR_CONCILIACION" : "CREAR_CONCILIACION",
      entityType: "bank_reconciliation",
      entityId: candidate.id,
      entityLabel: candidate.reconciliationNumber || candidate.id,
      documentLabel: candidate.bankAccountName || candidate.reconciliationNumber || candidate.id,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} una conciliacion bancaria.`,
      before,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, reconciliation: clone(candidate) };
  }

  async function saveReviewV2(reconciliationId, kind, movementId, status, observation = "") {
    const result=await BlessERP.services?.treasuryV2?.reviewReconciliation?.(reconciliationId,kind,movementId,status==="observado"?"SET":"CLEAR",observation);
    return result?.ok ? { ...result,reconciliation:findReconciliationById(reconciliationId) }
      : { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "Observación no confirmada."] };
  }

  async function clearReviewV2(reconciliationId, kind, movementId) {
    return saveReviewV2(reconciliationId,kind,movementId,"pendiente","");
  }

  function saveReview(reconciliationId, kind, movementId, status, observation = "") {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const current = normalizeReconciliation(rows[index]);
    if (current.status === "CERRADA") return { ok: false, errors: ["La conciliacion cerrada no se puede modificar."] };
    const collectionKey = kind === "system" ? "systemReviews" : "statementReviews";
    const collection = current[collectionKey] || [];
    const next = normalizeReview({ movementId, status, observation });
    const existingIndex = collection.findIndex(item => item.movementId === movementId);
    if (existingIndex >= 0) collection[existingIndex] = next;
    else collection.push(next);
    current[collectionKey] = collection.filter(item => item.status !== "pendiente" || item.observation);
    rows[index] = current;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(current);
    return { ok: true, reconciliation: clone(current) };
  }

  function clearReview(reconciliationId, kind, movementId) {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const current = normalizeReconciliation(rows[index]);
    if (current.status === "CERRADA") return { ok: false, errors: ["La conciliacion cerrada no se puede modificar."] };
    const collectionKey = kind === "system" ? "systemReviews" : "statementReviews";
    current[collectionKey] = (current[collectionKey] || []).filter(item => item.movementId !== movementId);
    rows[index] = current;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(current);
    return { ok: true, reconciliation: clone(current) };
  }

  function linkMatchGroup(reconciliationId, systemMovementIds = [], statementMovementIds = [], note = "") {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const current = normalizeReconciliation(rows[index]);
    if (current.status === "CERRADA") return { ok: false, errors: ["La conciliacion cerrada no se puede modificar."] };
    const selectedSystemIds = [...new Set((Array.isArray(systemMovementIds) ? systemMovementIds : [systemMovementIds]).map(value => String(value || "").trim()).filter(Boolean))];
    const selectedStatementIds = [...new Set((Array.isArray(statementMovementIds) ? statementMovementIds : [statementMovementIds]).map(value => String(value || "").trim()).filter(Boolean))];
    if (!selectedSystemIds.length || !selectedStatementIds.length) {
      return { ok: false, errors: ["Seleccione uno o varios movimientos en ambos paneles."] };
    }
    const availableSystemRows = systemRowsFor(current);
    const availableStatementRows = statementRowsFor(current);
    const systemRows = selectedSystemIds.map(id => availableSystemRows.find(item => item.id === id)).filter(Boolean);
    const statementRows = selectedStatementIds.map(id => availableStatementRows.find(item => item.id === id)).filter(Boolean);
    if (systemRows.length !== selectedSystemIds.length || statementRows.length !== selectedStatementIds.length) {
      return { ok: false, errors: ["Uno de los movimientos seleccionados ya no está disponible para conciliar."] };
    }
    const alreadyMatched = selectedSystemIds.some(id => systemRowState(current, id) === "conciliado")
      || selectedStatementIds.some(id => statementRowState(current, id) === "conciliado");
    if (alreadyMatched) return { ok: false, errors: ["Uno de los movimientos seleccionados ya está conciliado."] };

    const systemTotal = round2(systemRows.reduce((sum, item) => sum + Number(item.incomeValue || 0) - Number(item.expenseValue || 0), 0));
    const statementTotal = round2(statementRows.reduce((sum, item) => sum + Number(item.incomeValue || 0) - Number(item.expenseValue || 0), 0));
    if (Math.abs(systemTotal - statementTotal) > toleranceAmount) {
      return { ok: false, errors: [`Los totales no coinciden. Sistema: ${systemTotal.toFixed(2)} · Banco: ${statementTotal.toFixed(2)}.`] };
    }
    const suggestion = systemRows.length === 1 && statementRows.length === 1
      ? suggestionForPair(systemRows[0], statementRows[0], current)
      : { status: "MATCH_EXACTO", reason: "Los totales agrupados coinciden." };
    current.matches.push(normalizeMatch({
      systemMovementIds: selectedSystemIds,
      statementMovementIds: selectedStatementIds,
      suggestion: suggestion.status === "SIN_COINCIDENCIA" ? "MATCH_POSIBLE" : suggestion.status,
      note
    }));
    current.systemReviews = (current.systemReviews || []).filter(item => !selectedSystemIds.includes(item.movementId));
    current.statementReviews = (current.statementReviews || []).filter(item => !selectedStatementIds.includes(item.movementId));
    current.status = current.status === "BORRADOR" ? "EN_REVISION" : current.status;
    current.updatedAt = new Date().toISOString();
    current.updatedBy = currentUser().name;
    rows[index] = current;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(current);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "CONCILIAR_MOVIMIENTOS",
      entityType: "bank_reconciliation_match",
      entityId: current.matches[current.matches.length - 1]?.id || current.id,
      entityLabel: current.id,
      description: `Se conciliaron ${selectedSystemIds.length} movimiento(s) del sistema con ${selectedStatementIds.length} movimiento(s) bancario(s).`,
      after: { reconciliationId: current.id, systemMovementIds: selectedSystemIds, statementMovementIds: selectedStatementIds, systemTotal, statementTotal },
      result: "exitoso"
    });
    return { ok: true, reconciliation: clone(current), suggestion };
  }

  function linkMatch(reconciliationId, systemMovementId, statementMovementId, note = "") {
    return linkMatchGroup(reconciliationId, [systemMovementId], [statementMovementId], note);
  }

  function unlinkMatchGroup(reconciliationId, matchId) {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const current = normalizeReconciliation(rows[index]);
    if (current.status === "CERRADA") return { ok: false, errors: ["La conciliacion cerrada no se puede modificar."] };
    const target = current.matches.find(item => item.id === matchId);
    if (!target) return { ok: false, errors: ["La relación de conciliación no existe."] };
    current.matches = current.matches.filter(item => item.id !== matchId);
    current.updatedAt = new Date().toISOString();
    current.updatedBy = currentUser().name;
    rows[index] = current;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(current);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "DESHACER_CONCILIACION_MOVIMIENTOS",
      entityType: "bank_reconciliation_match",
      entityId: target.id,
      entityLabel: current.id,
      description: "Se deshizo una relación de conciliación sin eliminar los movimientos originales.",
      before: target,
      result: "exitoso"
    });
    return { ok: true, reconciliation: clone(current) };
  }

  function unlinkMatch(reconciliationId, systemMovementId, statementMovementId) {
    const current = findReconciliationById(reconciliationId);
    const target = current?.matches.find(item => matchSystemIds(item).includes(systemMovementId) && matchStatementIds(item).includes(statementMovementId));
    if (!target) return { ok: false, errors: ["La relación de conciliación no existe."] };
    return unlinkMatchGroup(reconciliationId, target.id);
  }

  function deleteReconciliation(reconciliationId) {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliación no encontrada."] };
    const target = normalizeReconciliation(rows[index]);
    if (target.status === "CERRADA") return { ok: false, errors: ["Reabra la conciliación cerrada antes de eliminarla."] };
    const statementRows = statementMovements();
    statementRows.forEach(row => {
      if (row.reconciliationId !== target.id) return;
      row.status = "pendiente";
      row.reconciliationId = "";
      row.relatedMovementId = "";
    });
    saveList("bankStatementMovements", statementRows);
    saveList("bankReconciliations", rows.filter(item => item.id !== reconciliationId));
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "ELIMINAR_CONCILIACION",
      entityType: "bank_reconciliation",
      entityId: target.id,
      entityLabel: target.id,
      previousStatus: target.status,
      nextStatus: "ELIMINADA",
      description: "Se eliminó únicamente la cabecera y sus relaciones; los movimientos originales permanecen intactos.",
      before: target,
      result: "exitoso"
    });
    return { ok: true, reconciliation: clone(target) };
  }

  function closeReconciliation(reconciliationId) {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const { reconciliation: candidate, errors } = validateReconciliation(rows[index], { forClose: true });
    if (errors.length) return { ok: false, errors };
    candidate.status = "CERRADA";
    candidate.closeDate = new Date().toISOString();
    candidate.closedBy = currentUser().name;
    candidate.updatedAt = candidate.closeDate;
    candidate.updatedBy = candidate.closedBy;
    rows[index] = candidate;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(candidate);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "CERRAR_CONCILIACION",
      entityType: "bank_reconciliation",
      entityId: candidate.id,
      entityLabel: candidate.reconciliationNumber || candidate.id,
      documentLabel: candidate.bankAccountName || candidate.reconciliationNumber || candidate.id,
      previousStatus: "EN_REVISION",
      nextStatus: candidate.status,
      description: `Conciliacion ${candidate.reconciliationNumber || candidate.id} cerrada correctamente.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, reconciliation: clone(candidate) };
  }

  function reopenReconciliation(reconciliationId, reason = "") {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const current = normalizeReconciliation(rows[index]);
    if (current.status !== "CERRADA") return { ok: false, errors: ["Solo se pueden reabrir conciliaciones cerradas."] };
    if (!String(reason || "").trim()) return { ok: false, errors: ["Debe ingresar el motivo de reapertura."] };
    current.status = "REABIERTA";
    current.reopenedAt = new Date().toISOString();
    current.reopenedBy = currentUser().name;
    current.reopenReason = String(reason || "").trim();
    current.updatedAt = current.reopenedAt;
    current.updatedBy = current.reopenedBy;
    rows[index] = current;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(current);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "REABRIR_CONCILIACION",
      entityType: "bank_reconciliation",
      entityId: current.id,
      entityLabel: current.reconciliationNumber || current.id,
      documentLabel: current.bankAccountName || current.reconciliationNumber || current.id,
      previousStatus: "CERRADA",
      nextStatus: current.status,
      description: `Conciliacion ${current.reconciliationNumber || current.id} reabierta.`,
      reason: current.reopenReason,
      after: current,
      result: "exitoso"
    });
    return { ok: true, reconciliation: clone(current) };
  }

  function context(reconciliation) {
    const current = normalizeReconciliation(reconciliation);
    const account = bankService.findBankAccountById(current.bankAccountId);
    const systemRows = systemRowsFor(current).map(item => ({
      ...item,
      lineState: systemRowState(current, item.id),
      observation: reviewObservationFor(current, "system", item.id)
    }));
    const statementRows = statementRowsFor(current).map(item => ({
      ...item,
      lineState: statementRowState(current, item.id),
      observation: reviewObservationFor(current, "statement", item.id)
    }));
    const totals = metrics(current);
    const suggestions = suggestionsFor(current);
    return {
      reconciliation: current,
      account,
      systemRows,
      statementRows,
      totals,
      suggestions,
      report: {
        company: companyService.settings().commercialName || companyService.settings().legalName || "Empresa",
        bankAccount: account ? `${account.bankName} · ${account.code}` : "Cuenta no seleccionada",
        period: current.period,
        openingBalance: current.openingBankBalance,
        closingBankBalance: current.closingBankBalance,
        systemBalance: totals.auxiliaryBalance,
        difference: totals.difference,
        conciliatedCount: current.matches.length,
        pendingSystem: totals.pendingSystemRows.length,
        pendingBank: totals.pendingBankRows.length,
        observed: totals.observedSystemRows.length + totals.observedBankRows.length,
        status: current.status,
        closeDate: current.closeDate || "",
        notes: current.notes || current.differenceJustification || ""
      }
    };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.bankReconciliation = {
    reconciliationStates,
    lineStates,
    suggestionStates,
    toleranceAmount,
    emptyReconciliation,
    reconciliations,
    findReconciliationById,
    saveReconciliation: saveReconciliationV2,
    closeReconciliation: closeReconciliationV2,
    reopenReconciliation: reopenReconciliationV2,
    emptyStatementMovement,
    statementMovements,
    saveStatementMovement,
    saveStatementMovementsBatch,
    linkMatchGroup: linkMatchGroupV2,
    linkMatch: (reconciliationId,systemId,statementId,note) => linkMatchGroupV2(reconciliationId,[systemId],[statementId],note),
    unlinkMatchGroup: unlinkMatchGroupV2,
    unlinkMatch: (reconciliationId,systemId,statementId) => {
      const current=findReconciliationById(reconciliationId); const match=current?.matches.find(row=>matchSystemIds(row).includes(systemId)&&matchStatementIds(row).includes(statementId));
      return match ? unlinkMatchGroupV2(reconciliationId,match.id) : Promise.resolve({ok:false,errors:["Relación no encontrada."]});
    },
    deleteReconciliation: deleteReconciliationV2,
    saveReview: saveReviewV2,
    clearReview: clearReviewV2,
    context
  };
})();
