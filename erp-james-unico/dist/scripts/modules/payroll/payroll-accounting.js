(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid } = BlessERP.utils;

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function currentUser() {
    return BlessERP.services.adminConfig?.activeUser?.()
      || stateApi.state.db.session?.activeUser
      || { id: "USR-DEMO", name: "Usuario demo" };
  }

  function accountMap(companyId = "") {
    const configured = BlessERP.payrollEngine?.payrollStore?.().accountSettingsByCompany?.[String(companyId || "")];
    return configured && typeof configured === "object"
      ? configured
      : BlessERP.services.companySettings.settings().defaultAccounts || {};
  }

  function resolveAccount(accountKey, companyId = "") {
    const code = String(accountMap(companyId)[accountKey] || "").trim();
    const account = code ? BlessERP.services.chartOfAccounts.findByCode(code) : null;
    return { key: accountKey, code, account };
  }

  function validateAccounts(keys = [], companyId = "") {
    const errors = [];
    [...new Set(keys)].forEach(key => {
      const resolved = resolveAccount(key, companyId);
      if (!resolved.code) errors.push(`Falta configurar la cuenta ${key}.`);
      else if (!resolved.account) errors.push(`La cuenta ${resolved.code} configurada para ${key} no existe.`);
      else if (!resolved.account.isMovement) errors.push(`La cuenta ${resolved.code} de ${key} no es de movimiento.`);
      else if (String(resolved.account.status || "").toUpperCase() !== "ACTIVA") errors.push(`La cuenta ${resolved.code} de ${key} está inactiva.`);
    });
    return errors;
  }

  function line({ accountKey, debit = 0, credit = 0, item, description, reference, companyId = "" }) {
    const resolved = resolveAccount(accountKey, companyId);
    return {
      id: uid("JLN"),
      accountCode: resolved.code,
      accountName: resolved.account?.name || "",
      debit: round2(debit),
      credit: round2(credit),
      costCenter: item?.area || "",
      auxiliary: item ? `${item.employeeCode || item.employeeId} · ${item.employeeName}` : "",
      lineDescription: description || "",
      documentReference: reference || ""
    };
  }

  function buildAccrualEntry(runId) {
    const store = BlessERP.payrollEngine.payrollStore();
    const run = store.runs.find(item => item.id === runId);
    if (!run) return { ok: false, errors: ["Rol no encontrado."] };
    const items = store.employeeItems.filter(item => item.runId === runId && item.status !== "ANULADO");
    const components = store.components.filter(item => item.runId === runId && Number(item.amount || 0) !== 0);
    const requiredKeys = [...components.map(item => item.accountKey), "payrollPayable"];
    const errors = validateAccounts(requiredKeys, run.companyId);
    if (!items.length) errors.push("El rol no contiene trabajadores.");
    if (errors.length) return { ok: false, errors };
    const lines = [];
    items.forEach(item => {
      const employeeComponents = components.filter(row => row.employeeItemId === item.id);
      employeeComponents.filter(row => row.type === "EARNING").forEach(component => {
        lines.push(line({
          accountKey: component.accountKey,
          debit: component.amount,
          item,
          description: `${component.label} · ${item.employeeName}`,
          reference: run.number,
          companyId: run.companyId
        }));
      });
      employeeComponents.filter(row => row.type === "DEDUCTION").forEach(component => {
        lines.push(line({
          accountKey: component.accountKey,
          credit: component.amount,
          item,
          description: `${component.label} descontado · ${item.employeeName}`,
          reference: run.number,
          companyId: run.companyId
        }));
      });
      if (Number(item.netPay || 0) > 0) {
        lines.push(line({
          accountKey: "payrollPayable",
          credit: item.netPay,
          item,
          description: `Neto por pagar · ${item.employeeName}`,
          reference: run.number,
          companyId: run.companyId
        }));
      }
    });
    const debit = round2(lines.reduce((sum, row) => sum + Number(row.debit || 0), 0));
    const credit = round2(lines.reduce((sum, row) => sum + Number(row.credit || 0), 0));
    if (debit !== credit) {
      return { ok: false, errors: [`El asiento del rol no cuadra. Debe ${debit.toFixed(2)} / Haber ${credit.toFixed(2)}.`] };
    }
    return {
      ok: true,
      entry: {
        accountingDate: run.dateTo,
        accountingPeriod: String(run.dateTo || "").slice(0, 7),
        concept: `Devengo rol de pagos ${run.number}`,
        originModule: "Rol de pagos",
        sourceDocument: run.number,
        externalReference: run.id,
        status: "BORRADOR",
        observation: `Periodo ${run.dateFrom} al ${run.dateTo}. Devengo independiente de los pagos.`,
        lines
      },
      totals: { debit, credit }
    };
  }

  function applyAdvanceRecoveries(store, runId) {
    const advanceComponents = store.components.filter(item => item.runId === runId && item.code === "ADVANCE" && Number(item.amount || 0) > 0);
    advanceComponents.forEach(component => {
      if (store.advanceMovements.some(item => item.sourceComponentId === component.id && item.status !== "ANULADO")) return;
      let remaining = round2(component.amount);
      const employeeAdvances = store.advances
        .filter(item => item.employeeId === component.employeeId && String(item.status || "ACTIVE").toUpperCase() !== "ANULADO")
        .sort((a, b) => String(a.date || a.createdAt || "").localeCompare(String(b.date || b.createdAt || ""), "es"));
      employeeAdvances.forEach(advance => {
        if (remaining <= 0) return;
        const balance = Number(advance.balance ?? advance.originalAmount ?? advance.amount ?? 0);
        const applied = round2(Math.min(balance, remaining));
        if (applied <= 0) return;
        advance.balance = round2(balance - applied);
        if (advance.balance <= 0) advance.status = "SETTLED";
        store.advanceMovements.push({
          id: uid("PAM"), advanceId: advance.id, employeeId: component.employeeId,
          type: "RECOVERY", amount: applied, date: new Date().toISOString().slice(0, 10),
          runId, sourceComponentId: component.id, status: "CONFIRMED",
          createdAt: new Date().toISOString(), createdBy: currentUser().id
        });
        remaining = round2(remaining - applied);
      });
    });
  }

  function postRun(runId) {
    const store = BlessERP.payrollEngine.payrollStore();
    const run = store.runs.find(item => item.id === runId);
    if (!run) return { ok: false, errors: ["Rol no encontrado."] };
    if (run.status !== "APROBADO") return { ok: false, errors: ["Solo se contabiliza un rol aprobado."] };
    if (run.accrualJournalEntryId) return { ok: false, errors: ["El rol ya tiene asiento de devengo."] };
    const built = buildAccrualEntry(runId);
    if (!built.ok) return built;
    const saved = BlessERP.services.journal.saveDraft(built.entry);
    if (!saved.ok) return { ok: false, errors: saved.errors || ["No se pudo guardar el asiento."] };
    const posted = BlessERP.services.journal.postEntry(saved.entry.id);
    if (!posted.ok) return { ok: false, errors: posted.errors || ["No se pudo contabilizar el asiento."] };
    const previousStatus = run.status;
    run.status = "CONTABILIZADO";
    run.accountedAt = new Date().toISOString();
    run.accountedBy = currentUser().id;
    run.accrualJournalEntryId = posted.entry.id;
    run.accrualJournalEntryNumber = posted.entry.entryNumber;
    store.employeeItems.filter(item => item.runId === runId).forEach(item => { item.status = "CONTABILIZADO"; });
    store.employeeItems.filter(item => item.runId === runId).forEach(item => {
      store.journalLinks.push({
        id: uid("PJL"),
        companyId: run.companyId,
        runId,
        periodId: run.periodId,
        employeeId: item.employeeId,
        employeeItemId: item.id,
        journalEntryId: posted.entry.id,
        journalEntryNumber: posted.entry.entryNumber,
        paymentId: "",
        movementType: "ACCRUAL",
        createdAt: new Date().toISOString()
      });
    });
    applyAdvanceRecoveries(store, runId);
    store.statusHistory.unshift({
      id: uid("PSH"), runId, previousStatus, nextStatus: run.status,
      reason: `Contabilización ${posted.entry.entryNumber}`, userId: currentUser().id,
      userName: currentUser().name, createdAt: new Date().toISOString()
    });
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS", action: "CONTABILIZAR_ROL", entityType: "payroll_run",
      entityId: run.id, entityLabel: run.number, previousStatus, nextStatus: run.status,
      description: `Rol contabilizado con asiento ${posted.entry.entryNumber}.`, after: run, result: "exitoso"
    });
    return { ok: true, run: clone(run), entry: clone(posted.entry) };
  }

  function reverseAndCancel(runId, reason) {
    const store = BlessERP.payrollEngine.payrollStore();
    const run = store.runs.find(item => item.id === runId);
    if (!run) return { ok: false, errors: ["Rol no encontrado."] };
    if (!String(reason || "").trim()) return { ok: false, errors: ["El motivo de anulación es obligatorio."] };
    const activePayments = store.payments.filter(item => item.runId === runId && item.status !== "ANULADO");
    for (const payment of activePayments) {
      const cancelled = BlessERP.payrollPayments?.cancelPayment?.(payment.id, `Reverso por anulación del rol: ${reason}`);
      if (!cancelled?.ok) return { ok: false, errors: cancelled?.errors || ["No se pudo reversar un pago del rol."] };
    }
    if (run.accrualJournalEntryId && !run.accrualReverseEntryId) {
      const reversed = BlessERP.services.journal.reverseEntry(run.accrualJournalEntryId);
      if (!reversed.ok) return { ok: false, errors: [reversed.message || "No se pudo reversar el devengo."] };
      run.accrualReverseEntryId = reversed.entry.id;
      run.accrualReverseEntryNumber = reversed.entry.entryNumber;
    }
    store.advanceMovements
      .filter(item => item.runId === runId && item.type === "RECOVERY" && item.status !== "ANULADO")
      .forEach(movement => {
        const advance = store.advances.find(item => item.id === movement.advanceId);
        if (advance) {
          advance.balance = round2(Number(advance.balance || 0) + Number(movement.amount || 0));
          advance.status = "ACTIVE";
        }
        movement.status = "ANULADO";
        movement.cancelledAt = new Date().toISOString();
        movement.cancelReason = String(reason);
      });
    const previousStatus = run.status;
    run.status = "ANULADO";
    run.cancelReason = String(reason);
    run.cancelledAt = new Date().toISOString();
    run.cancelledBy = currentUser().id;
    store.employeeItems.filter(item => item.runId === runId).forEach(item => { item.status = "ANULADO"; });
    store.statusHistory.unshift({
      id: uid("PSH"), runId, previousStatus, nextStatus: "ANULADO", reason,
      userId: currentUser().id, userName: currentUser().name, createdAt: new Date().toISOString()
    });
    stateApi.saveDb();
    BlessERP.services.adminConfig?.addAuditLog?.({
      module: "ROL_PAGOS", action: "ANULAR_ROL", entityType: "payroll_run", entityId: run.id,
      entityLabel: run.number, previousStatus, nextStatus: "ANULADO",
      description: "Rol anulado con reversos contables.", reason, after: run, result: "exitoso"
    });
    return { ok: true, run: clone(run) };
  }

  BlessERP.payrollAccounting = {
    accountMap,
    resolveAccount,
    validateAccounts,
    buildAccrualEntry,
    postRun,
    reverseAndCancel
  };
})();
