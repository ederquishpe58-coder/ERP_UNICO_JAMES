(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid, today } = BlessERP.utils;

  const methods = ["CASH", "TRANSFER", "CHECK"];
  const checkStates = ["EMITIDO", "ENTREGADO", "COBRADO", "ANULADO"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function currentUser() {
    return BlessERP.services.adminConfig?.activeUser?.()
      || stateApi.state.db.session?.activeUser
      || { id: "USR-DEMO", name: "Usuario demo" };
  }

  function normalizeSplit(split = {}) {
    return {
      id: split.id || uid("PPS"),
      method: methods.includes(String(split.method || "").toUpperCase()) ? String(split.method).toUpperCase() : "CASH",
      amount: round2(split.amount),
      bankAccountId: String(split.bankAccountId || ""),
      accountCode: String(split.accountCode || ""),
      date: String(split.date || today()),
      reference: String(split.reference || ""),
      proof: String(split.proof || ""),
      observation: String(split.observation || ""),
      checkNumber: String(split.checkNumber || ""),
      beneficiary: String(split.beneficiary || ""),
      checkState: checkStates.includes(String(split.checkState || "").toUpperCase()) ? String(split.checkState).toUpperCase() : "EMITIDO"
    };
  }

  function creditAccount(split, companyId = "") {
    const defaults = BlessERP.payrollAccounting?.accountMap?.(companyId)
      || BlessERP.services.companySettings.settings().defaultAccounts
      || {};
    if (split.method === "CASH") {
      const code = split.accountCode || defaults.cashGeneral;
      return BlessERP.services.chartOfAccounts.findByCode(code);
    }
    const bank = split.bankAccountId ? BlessERP.services.banks.findBankAccountById(split.bankAccountId) : null;
    const code = bank?.linkedAccountCode || split.accountCode || defaults.mainBank;
    return BlessERP.services.chartOfAccounts.findByCode(code);
  }

  function buildPaymentEntry(item, run, payment, splits) {
    const defaults = BlessERP.payrollAccounting?.accountMap?.(run.companyId)
      || BlessERP.services.companySettings.settings().defaultAccounts
      || {};
    const payable = BlessERP.services.chartOfAccounts.findByCode(defaults.payrollPayable);
    const errors = [];
    if (!payable || !payable.isMovement) errors.push("La cuenta de remuneraciones por pagar no está configurada correctamente.");
    splits.forEach((split, index) => {
      const account = creditAccount(split, run.companyId);
      if (!account || !account.isMovement) errors.push(`La cuenta de pago de la parte ${index + 1} no es válida.`);
      if (["TRANSFER", "CHECK"].includes(split.method) && !split.bankAccountId) errors.push(`Debe seleccionar banco para la parte ${index + 1}.`);
      if (split.method === "TRANSFER" && !split.reference) errors.push(`La transferencia ${index + 1} requiere referencia.`);
      if (split.method === "CHECK" && !split.checkNumber) errors.push(`El cheque ${index + 1} requiere número.`);
    });
    if (errors.length) return { ok: false, errors };
    const total = round2(splits.reduce((sum, split) => sum + split.amount, 0));
    return {
      ok: true,
      entry: {
        accountingDate: payment.date,
        accountingPeriod: payment.date.slice(0, 7),
        concept: `Pago de rol ${run.number} · ${item.employeeName}`,
        originModule: "Rol de pagos",
        sourceDocument: payment.number,
        externalReference: item.id,
        status: "BORRADOR",
        observation: payment.observation || "Pago separado del asiento de devengo.",
        lines: [
          {
            id: uid("JLN"),
            accountCode: payable.code,
            accountName: payable.name,
            debit: total,
            credit: 0,
            costCenter: item.area || "",
            auxiliary: `${item.employeeCode || item.employeeId} · ${item.employeeName}`,
            lineDescription: `Disminución de remuneración por pagar · ${item.employeeName}`,
            documentReference: payment.number
          },
          ...splits.map(split => {
            const account = creditAccount(split, run.companyId);
            return {
              id: uid("JLN"),
              accountCode: account.code,
              accountName: account.name,
              debit: 0,
              credit: split.amount,
              costCenter: "",
              auxiliary: split.reference || split.checkNumber || item.employeeName,
              lineDescription: `Pago ${split.method} · ${item.employeeName}`,
              documentReference: split.reference || split.checkNumber || payment.number
            };
          })
        ]
      },
      total
    };
  }

  function recalculatePaymentState(runId) {
    const store = BlessERP.payrollEngine.payrollStore();
    const run = store.runs.find(item => item.id === runId);
    if (!run) return null;
    const items = store.employeeItems.filter(item => item.runId === runId && item.status !== "ANULADO");
    items.forEach(item => {
      const paid = round2(store.payments
        .filter(payment => payment.employeeItemId === item.id && payment.status === "CONFIRMADO")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
      item.paidAmount = paid;
      item.pendingBalance = round2(Number(item.netPay || 0) - paid);
      item.paymentStatus = paid <= 0 ? "PENDIENTE" : item.pendingBalance > 0 ? "PARCIAL" : "PAGADO";
      if (item.paymentStatus === "PAGADO") item.status = "PAGADO";
      else if (item.paymentStatus === "PARCIAL") item.status = "PARCIALMENTE_PAGADO";
      else if (run.accrualJournalEntryId) item.status = "CONTABILIZADO";
    });
    BlessERP.payrollEngine.recalculateRunTotals(runId);
    const previousStatus = run.status;
    if (items.length && items.every(item => item.pendingBalance <= 0)) run.status = "PAGADO";
    else if (items.some(item => item.paidAmount > 0)) run.status = "PARCIALMENTE_PAGADO";
    else if (run.accrualJournalEntryId) run.status = "CONTABILIZADO";
    if (previousStatus !== run.status) {
      store.statusHistory.unshift({
        id: uid("PSH"), runId, previousStatus, nextStatus: run.status,
        reason: "Actualización automática por pagos", userId: currentUser().id,
        userName: currentUser().name, createdAt: new Date().toISOString()
      });
    }
    return run;
  }

  function registerPayment(payload = {}) {
    const store = BlessERP.payrollEngine.payrollStore();
    const item = store.employeeItems.find(row => row.id === payload.employeeItemId);
    const run = item ? store.runs.find(row => row.id === item.runId) : null;
    if (!item || !run) return { ok: false, errors: ["Rol del trabajador no encontrado."] };
    if (!["CONTABILIZADO", "PARCIALMENTE_PAGADO"].includes(run.status)) {
      return { ok: false, errors: ["Solo se pagan roles contabilizados."] };
    }
    const splits = (payload.splits || []).map(normalizeSplit).filter(split => split.amount > 0);
    const total = round2(splits.reduce((sum, split) => sum + split.amount, 0));
    const errors = [];
    if (!splits.length) errors.push("Debe ingresar al menos una forma de pago.");
    if (total <= 0) errors.push("El valor del pago debe ser mayor que cero.");
    if (total > round2(item.pendingBalance) + 0.001) errors.push("La suma del pago supera el saldo pendiente.");
    if (errors.length) return { ok: false, errors };
    const sequence = store.payments.reduce((max, payment) => Math.max(max, Number(String(payment.number || "").split("-").pop() || 0)), 0) + 1;
    const payment = {
      id: uid("PPY"),
      number: `PAG-ROL-${String(sequence).padStart(6, "0")}`,
      companyId: run.companyId,
      runId: run.id,
      periodId: run.periodId,
      employeeItemId: item.id,
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      date: String(payload.date || today()),
      amount: total,
      status: "BORRADOR",
      observation: String(payload.observation || ""),
      createdAt: new Date().toISOString(),
      createdBy: currentUser().id
    };
    const built = buildPaymentEntry(item, run, payment, splits);
    if (!built.ok) return built;
    const saved = BlessERP.services.journal.saveDraft(built.entry);
    if (!saved.ok) return { ok: false, errors: saved.errors || ["No se pudo guardar el asiento de pago."] };
    const posted = BlessERP.services.journal.postEntry(saved.entry.id);
    if (!posted.ok) return { ok: false, errors: posted.errors || ["No se pudo contabilizar el pago."] };
    payment.status = "CONFIRMADO";
    payment.journalEntryId = posted.entry.id;
    payment.journalEntryNumber = posted.entry.entryNumber;
    payment.confirmedAt = new Date().toISOString();
    payment.confirmedBy = currentUser().id;
    store.payments.unshift(payment);
    splits.forEach(split => {
      const storedSplit = { ...split, paymentId: payment.id, runId: run.id, employeeItemId: item.id, status: "CONFIRMADO" };
      store.paymentSplits.push(storedSplit);
      if (split.method === "CHECK") {
        store.checkDetails.push({
          id: uid("PCK"), splitId: split.id, paymentId: payment.id, bankAccountId: split.bankAccountId,
          checkNumber: split.checkNumber, date: split.date, beneficiary: split.beneficiary || item.employeeName,
          status: split.checkState, createdAt: new Date().toISOString()
        });
      }
    });
    store.journalLinks.push({
      id: uid("PJL"), companyId: run.companyId, runId: run.id, periodId: run.periodId,
      employeeId: item.employeeId, employeeItemId: item.id, journalEntryId: posted.entry.id,
      journalEntryNumber: posted.entry.entryNumber, paymentId: payment.id, movementType: "PAYMENT",
      createdAt: new Date().toISOString()
    });
    recalculatePaymentState(run.id);
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS", action: "PAGAR_ROL", entityType: "payroll_payment", entityId: payment.id,
      entityLabel: payment.number, previousStatus: "BORRADOR", nextStatus: "CONFIRMADO",
      description: `Pago ${payment.number} registrado para ${item.employeeName}.`, after: { payment, splits }, result: "exitoso"
    });
    return { ok: true, payment: clone(payment), splits: clone(splits), entry: clone(posted.entry), run: clone(run) };
  }

  function cancelPayment(paymentId, reason) {
    const store = BlessERP.payrollEngine.payrollStore();
    const payment = store.payments.find(item => item.id === paymentId);
    if (!payment) return { ok: false, errors: ["Pago no encontrado."] };
    if (payment.status === "ANULADO") return { ok: false, errors: ["El pago ya está anulado."] };
    if (!String(reason || "").trim()) return { ok: false, errors: ["El motivo de anulación es obligatorio."] };
    const reversed = payment.journalEntryId ? BlessERP.services.journal.reverseEntry(payment.journalEntryId) : { ok: true, entry: null };
    if (!reversed.ok) return { ok: false, errors: [reversed.message || "No se pudo reversar el asiento de pago."] };
    payment.status = "ANULADO";
    payment.cancelReason = String(reason);
    payment.cancelledAt = new Date().toISOString();
    payment.cancelledBy = currentUser().id;
    payment.reverseJournalEntryId = reversed.entry?.id || "";
    payment.reverseJournalEntryNumber = reversed.entry?.entryNumber || "";
    store.paymentSplits.filter(item => item.paymentId === paymentId).forEach(item => { item.status = "ANULADO"; });
    store.checkDetails.filter(item => item.paymentId === paymentId).forEach(item => { item.status = "ANULADO"; });
    recalculatePaymentState(payment.runId);
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS", action: "ANULAR_PAGO_ROL", entityType: "payroll_payment",
      entityId: payment.id, entityLabel: payment.number, previousStatus: "CONFIRMADO", nextStatus: "ANULADO",
      description: "Pago de rol anulado y reversado.", reason, after: payment, result: "exitoso"
    });
    return { ok: true, payment: clone(payment), reverseEntry: clone(reversed.entry) };
  }

  function payments(filters = {}) {
    return clone(BlessERP.payrollEngine.payrollStore().payments).filter(payment => {
      if (filters.runId && payment.runId !== filters.runId) return false;
      if (filters.employeeItemId && payment.employeeItemId !== filters.employeeItemId) return false;
      if (filters.status && payment.status !== filters.status) return false;
      return true;
    });
  }

  BlessERP.payrollPayments = {
    methods,
    checkStates,
    normalizeSplit,
    buildPaymentEntry,
    registerPayment,
    cancelPayment,
    recalculatePaymentState,
    payments
  };
})();
