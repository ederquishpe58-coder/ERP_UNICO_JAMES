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
      incomeValue: 0,
      expenseValue: 0,
      netValue: 0,
      status: "pendiente",
      relatedMovementId: "",
      observation: "",
      reconciliationId: ""
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
      incomeValue: round2(current.incomeValue || 0),
      expenseValue: round2(current.expenseValue || 0),
      netValue: round2((current.incomeValue || 0) - (current.expenseValue || 0)),
      status: lineStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "pendiente",
      relatedMovementId: String(current.relatedMovementId || "").trim(),
      observation: String(current.observation || "").trim(),
      reconciliationId: String(current.reconciliationId || "").trim()
    };
  }

  function statementMovements(filters = {}) {
    return cloneList("bankStatementMovements")
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

  function saveStatementMovement(movement) {
    const candidate = normalizeStatementMovement(movement);
    const errors = [];
    if (!candidate.bankAccountId) errors.push("Debe seleccionar la cuenta bancaria del estado de cuenta.");
    if (!candidate.movementDate) errors.push("La fecha del movimiento bancario externo es obligatoria.");
    if (!candidate.reference) errors.push("La referencia del estado de cuenta es obligatoria.");
    if (candidate.incomeValue > 0 && candidate.expenseValue > 0) errors.push("No se permite ingreso y egreso al mismo tiempo en el estado de cuenta.");
    if (candidate.incomeValue <= 0 && candidate.expenseValue <= 0) errors.push("El movimiento del estado de cuenta no puede ser cero.");
    if (errors.length) return { ok: false, errors };
    const rows = statementMovements();
    const index = rows.findIndex(item => item.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("bankStatementMovements", rows);
    return { ok: true, movement: clone(candidate) };
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
    return {
      id: match.id || uid("MTC"),
      systemMovementId: String(match.systemMovementId || "").trim(),
      statementMovementId: String(match.statementMovementId || "").trim(),
      suggestion: suggestionStates.includes(String(match.suggestion || "").toUpperCase()) ? String(match.suggestion || "").toUpperCase() : "MATCH_POSIBLE",
      note: String(match.note || "").trim(),
      createdAt: match.createdAt || new Date().toISOString()
    };
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
      status: reconciliationStates.includes(String(current.status || "").toUpperCase()) ? String(current.status || "").toUpperCase() : "BORRADOR",
      notes: String(current.notes || "").trim(),
      differenceJustification: String(current.differenceJustification || "").trim(),
      closeDate: String(current.closeDate || "").trim(),
      closedBy: String(current.closedBy || "").trim(),
      reopenedAt: String(current.reopenedAt || "").trim(),
      reopenedBy: String(current.reopenedBy || "").trim(),
      reopenReason: String(current.reopenReason || "").trim(),
      createdAt: current.createdAt || new Date().toISOString(),
      createdBy: String(current.createdBy || currentUser().name).trim(),
      matches: (current.matches || []).map(normalizeMatch),
      systemReviews: (current.systemReviews || []).map(normalizeReview),
      statementReviews: (current.statementReviews || []).map(normalizeReview)
    };
  }

  function reconciliations() {
    return cloneList("bankReconciliations")
      .map(normalizeReconciliation)
      .sort((a, b) => `${b.period}|${b.createdAt}`.localeCompare(`${a.period}|${a.createdAt}`, "es"));
  }

  function findReconciliationById(reconciliationId) {
    return reconciliations().find(item => item.id === reconciliationId) || null;
  }

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
    return bankService.movements({
      bankAccountId: reconciliation.bankAccountId,
      dateFrom: reconciliation.dateFrom,
      dateTo: reconciliation.dateTo
    }).filter(item => item.status === "CONTABILIZADO");
  }

  function statementRowsFor(reconciliation) {
    return statementMovements({
      bankAccountId: reconciliation.bankAccountId,
      dateFrom: reconciliation.dateFrom,
      dateTo: reconciliation.dateTo
    });
  }

  function systemRowState(reconciliation, movementId) {
    const match = reconciliation.matches.find(item => item.systemMovementId === movementId);
    if (match) return "conciliado";
    const review = reconciliation.systemReviews.find(item => item.movementId === movementId);
    return review?.status || "pendiente";
  }

  function statementRowState(reconciliation, movementId) {
    const match = reconciliation.matches.find(item => item.statementMovementId === movementId);
    if (match) return "conciliado";
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
    const matchedSystemIds = new Set(reconciliation.matches.map(item => item.systemMovementId));
    const matchedStatementIds = new Set(reconciliation.matches.map(item => item.statementMovementId));
    const totalConciliated = round2(reconciliation.matches.reduce((sum, item) => {
      const statement = statementRows.find(row => row.id === item.statementMovementId);
      return sum + Math.abs(Number(statement?.netValue || 0));
    }, 0));
    const pendingSystemRows = systemRows.filter(item => !matchedSystemIds.has(item.id) && systemRowState(reconciliation, item.id) !== "observado");
    const pendingBankRows = statementRows.filter(item => !matchedStatementIds.has(item.id) && statementRowState(reconciliation, item.id) !== "observado");
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
    const matchedIds = new Set(reconciliation.matches.map(item => item.statementMovementId));
    const reviewed = new Map(reconciliation.statementReviews.map(item => [item.movementId, item]));
    let changed = false;
    rows.forEach(row => {
      if (row.bankAccountId !== reconciliation.bankAccountId) return;
      if (row.movementDate < reconciliation.dateFrom || row.movementDate > reconciliation.dateTo) return;
      if (matchedIds.has(row.id)) {
        row.status = "conciliado";
        row.reconciliationId = reconciliation.id;
        row.relatedMovementId = reconciliation.matches.find(item => item.statementMovementId === row.id)?.systemMovementId || row.relatedMovementId;
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
    const before = index >= 0 ? clone(rows[index]) : null;
    candidate.id = candidate.id || uid("REC");
    if (!candidate.status || candidate.status === "BORRADOR") {
      const hasProgress = candidate.matches.length || candidate.systemReviews.length || candidate.statementReviews.length || candidate.closingBankBalance;
      candidate.status = hasProgress ? "EN_REVISION" : "BORRADOR";
    }
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

  function linkMatch(reconciliationId, systemMovementId, statementMovementId, note = "") {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const current = normalizeReconciliation(rows[index]);
    if (current.status === "CERRADA") return { ok: false, errors: ["La conciliacion cerrada no se puede modificar."] };
    const systemRow = systemRowsFor(current).find(item => item.id === systemMovementId);
    const statementRow = statementRowsFor(current).find(item => item.id === statementMovementId);
    if (!systemRow || !statementRow) return { ok: false, errors: ["Debe seleccionar movimientos validos de ambos paneles."] };
    if (systemRowState(current, systemMovementId) === "conciliado" || statementRowState(current, statementMovementId) === "conciliado") {
      return { ok: false, errors: ["Uno de los movimientos ya esta conciliado."] };
    }
    const suggestion = suggestionForPair(systemRow, statementRow, current);
    if (suggestion.status === "SIN_COINCIDENCIA") return { ok: false, errors: ["Los movimientos seleccionados no coinciden dentro de la tolerancia. Marquelos como observados si corresponde."] };
    current.matches = (current.matches || []).filter(item => item.systemMovementId !== systemMovementId && item.statementMovementId !== statementMovementId);
    current.matches.push(normalizeMatch({
      systemMovementId,
      statementMovementId,
      suggestion: suggestion.status,
      note
    }));
    current.systemReviews = (current.systemReviews || []).filter(item => item.movementId !== systemMovementId);
    current.statementReviews = (current.statementReviews || []).filter(item => item.movementId !== statementMovementId);
    current.status = current.status === "BORRADOR" ? "EN_REVISION" : current.status;
    rows[index] = current;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(current);
    return { ok: true, reconciliation: clone(current), suggestion };
  }

  function unlinkMatch(reconciliationId, systemMovementId, statementMovementId) {
    const rows = reconciliations();
    const index = rows.findIndex(item => item.id === reconciliationId);
    if (index < 0) return { ok: false, errors: ["Conciliacion no encontrada."] };
    const current = normalizeReconciliation(rows[index]);
    if (current.status === "CERRADA") return { ok: false, errors: ["La conciliacion cerrada no se puede modificar."] };
    current.matches = (current.matches || []).filter(item => !(item.systemMovementId === systemMovementId && item.statementMovementId === statementMovementId));
    rows[index] = current;
    saveList("bankReconciliations", rows);
    setStatementReconciliationFlags(current);
    return { ok: true, reconciliation: clone(current) };
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
    saveReconciliation,
    closeReconciliation,
    reopenReconciliation,
    emptyStatementMovement,
    statementMovements,
    saveStatementMovement,
    linkMatch,
    unlinkMatch,
    saveReview,
    clearReview,
    context
  };
})();
