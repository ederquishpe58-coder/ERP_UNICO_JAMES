(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const chartService = BlessERP.services.chartOfAccounts;
  const journalService = BlessERP.services.journal;
  const companyService = BlessERP.services.companySettings;
  const adminService = BlessERP.services.adminConfig;
  const { clone, uid, today } = BlessERP.utils;

  const bankAccountTypes = ["corriente", "ahorros", "tarjeta", "caja", "otro"];
  const bankAccountStates = ["activa", "inactiva"];
  const movementTypes = ["ingreso", "egreso", "transferencia", "ajuste", "comision", "interes", "otro"];
  const movementMediums = ["transferencia", "cheque", "efectivo", "deposito", "debito", "credito", "otro"];
  const movementStates = ["BORRADOR", "CONTABILIZADO", "ANULADO"];
  const movementOrigins = ["manual", "pagos", "cobros", "ajustes", "transferencias"];

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function currentUser() {
    return adminService?.activeUser?.() || stateApi.state.db.session?.activeUser || { id: "demo", name: "Usuario demo", role: "Administrador" };
  }

  function cloneList(key) {
    return clone(stateApi.state.db[key] || []);
  }

  function saveList(key, rows) {
    stateApi.state.db[key] = rows;
    stateApi.saveDb();
  }

  function portfolioService() {
    return BlessERP.services.portfolios;
  }

  function nextBankAccountCode(existing = null) {
    const rows = existing || cloneList("bankAccounts");
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.code || "").replace(/\D/g, "") || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `BNK-${String(max + 1).padStart(4, "0")}`;
  }

  function nextMovementNumber(existing = null) {
    const rows = existing || cloneList("bankMovements");
    const year = companyService.settings().periodStart?.slice(0, 4) || new Date().getFullYear();
    const max = rows.reduce((acc, item) => {
      const numeric = Number(String(item.movementNumber || "").split("-").pop() || 0);
      return Math.max(acc, numeric);
    }, 0);
    return `MOV-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function normalizeBankAccount(account = {}) {
    const current = clone(account || {});
    return {
      id: current.id || uid("BNK"),
      code: String(current.code || "").trim(),
      bankName: String(current.bankName || current.bank || "").trim(),
      accountNumber: String(current.accountNumber || "").trim(),
      accountType: String(current.accountType || "corriente").trim().toLowerCase(),
      holder: String(current.holder || "").trim(),
      currency: String(current.currency || "USD").trim().toUpperCase(),
      linkedAccountCode: String(current.linkedAccountCode || "").trim(),
      openingBalance: round2(current.openingBalance || 0),
      openingBalanceDate: String(current.openingBalanceDate || companyService.settings().periodStart || today()).trim(),
      status: String(current.status || "activa").trim().toLowerCase(),
      observation: String(current.observation || "").trim()
    };
  }

  function bankAccounts() {
    return cloneList("bankAccounts").map(normalizeBankAccount);
  }

  function findBankAccountById(accountId) {
    return bankAccounts().find(item => item.id === accountId);
  }

  function findBankAccountByCode(code) {
    return bankAccounts().find(item => item.code === code);
  }

  function findBankAccountByLinkedAccount(linkedAccountCode) {
    return bankAccounts().find(item => item.linkedAccountCode === linkedAccountCode);
  }

  function validateBankAccount(account) {
    const candidate = normalizeBankAccount(account);
    const errors = [];
    const warnings = [];
    const rows = bankAccounts();

    if (!candidate.code) errors.push("El codigo interno de la cuenta bancaria es obligatorio.");
    if (!candidate.bankName) errors.push("El banco es obligatorio.");
    if (!candidate.holder) errors.push("El titular es obligatorio.");
    if (!candidate.linkedAccountCode) errors.push("Debe seleccionar la cuenta contable asociada.");
    if (!bankAccountTypes.includes(candidate.accountType)) errors.push("El tipo de cuenta bancaria no es valido.");
    if (!bankAccountStates.includes(candidate.status)) errors.push("El estado de la cuenta bancaria no es valido.");

    const duplicateCode = rows.find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicateCode) errors.push("No se permite codigo interno duplicado.");

    if (candidate.bankName && candidate.accountNumber) {
      const duplicateNumber = rows.find(item =>
        item.id !== candidate.id
        && item.bankName.toLowerCase() === candidate.bankName.toLowerCase()
        && item.accountNumber === candidate.accountNumber
      );
      if (duplicateNumber) errors.push("No se permite numero de cuenta duplicado para el mismo banco.");
    }

    if (candidate.linkedAccountCode) {
      const linkedAccount = chartService.findByCode(candidate.linkedAccountCode);
      if (!linkedAccount) {
        errors.push("La cuenta contable asociada no existe.");
      } else {
        if (linkedAccount.status !== "Activa") warnings.push("La cuenta contable asociada esta inactiva.");
        if (!linkedAccount.isMovement) warnings.push("La cuenta contable asociada no es de movimiento.");
      }
    }

    return { account: candidate, errors, warnings };
  }

  function saveBankAccount(account) {
    const { account: candidate, errors, warnings } = validateBankAccount(account);
    if (errors.length) return { ok: false, errors, warnings };
    const rows = bankAccounts();
    if (!candidate.code) candidate.code = nextBankAccountCode(rows);
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("bankAccounts", rows);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: index >= 0 ? "EDITAR_CUENTA_BANCARIA" : "CREAR_CUENTA_BANCARIA",
      entityType: "bank_account",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.bankName,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} la cuenta bancaria ${candidate.code}.`,
      before,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, account: clone(candidate), warnings };
  }

  function toggleBankAccountStatus(accountId) {
    const rows = bankAccounts();
    const index = rows.findIndex(item => item.id === accountId);
    if (index < 0) return { ok: false, message: "Cuenta bancaria no encontrada." };
    rows[index].status = rows[index].status === "activa" ? "inactiva" : "activa";
    saveList("bankAccounts", rows);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "CAMBIAR_ESTADO_CUENTA_BANCARIA",
      entityType: "bank_account",
      entityId: rows[index].id,
      entityLabel: rows[index].code,
      documentLabel: rows[index].bankName,
      nextStatus: rows[index].status,
      description: `Cuenta bancaria ${rows[index].code} cambiada a ${rows[index].status}.`,
      after: rows[index],
      result: "exitoso"
    });
    return { ok: true, account: clone(rows[index]) };
  }

  function emptyMovement() {
    return {
      id: "",
      movementNumber: nextMovementNumber(),
      movementDate: today(),
      bankAccountId: "",
      movementType: "egreso",
      medium: "transferencia",
      reference: "",
      beneficiary: "",
      concept: "",
      incomeValue: 0,
      expenseValue: 0,
      status: "BORRADOR",
      originModule: "manual",
      sourceDocument: "",
      journalEntryId: "",
      journalEntryNumber: "",
      observation: "",
      counterAccountCode: "",
      counterAccountName: "",
      costCenter: "",
      auxiliary: "",
      lineDescription: ""
    };
  }

  function normalizeMovement(movement = {}) {
    const current = {
      ...emptyMovement(),
      ...clone(movement || {})
    };
    const bankAccount = current.bankAccountId ? findBankAccountById(current.bankAccountId) : null;
    const counterAccount = current.counterAccountCode ? chartService.findByCode(current.counterAccountCode) : null;
    return {
      id: current.id || uid("BMV"),
      movementNumber: String(current.movementNumber || nextMovementNumber()).trim(),
      movementDate: String(current.movementDate || today()).trim(),
      bankAccountId: String(current.bankAccountId || "").trim(),
      bankAccountCode: String(bankAccount?.code || current.bankAccountCode || "").trim(),
      bankName: String(bankAccount?.bankName || current.bankName || "").trim(),
      bankAccountLabel: bankAccount ? `${bankAccount.code} · ${bankAccount.bankName}` : String(current.bankAccountLabel || "").trim(),
      movementType: movementTypes.includes(String(current.movementType || "").toLowerCase()) ? String(current.movementType || "").toLowerCase() : "egreso",
      medium: movementMediums.includes(String(current.medium || "").toLowerCase()) ? String(current.medium || "").toLowerCase() : "transferencia",
      reference: String(current.reference || "").trim(),
      beneficiary: String(current.beneficiary || "").trim(),
      concept: String(current.concept || "").trim(),
      incomeValue: round2(current.incomeValue || current.income || 0),
      expenseValue: round2(current.expenseValue || current.expense || 0),
      status: movementStates.includes(String(current.status || "").toUpperCase()) ? String(current.status || "").toUpperCase() : "BORRADOR",
      originModule: movementOrigins.includes(String(current.originModule || "").toLowerCase()) ? String(current.originModule || "").toLowerCase() : "manual",
      sourceDocument: String(current.sourceDocument || "").trim(),
      journalEntryId: String(current.journalEntryId || "").trim(),
      journalEntryNumber: String(current.journalEntryNumber || "").trim(),
      observation: String(current.observation || "").trim(),
      counterAccountCode: String(current.counterAccountCode || "").trim(),
      counterAccountName: String(counterAccount?.name || current.counterAccountName || "").trim(),
      costCenter: String(current.costCenter || "").trim(),
      auxiliary: String(current.auxiliary || "").trim(),
      lineDescription: String(current.lineDescription || "").trim(),
      derived: Boolean(current.derived),
      sourceKind: String(current.sourceKind || "MANUAL").trim().toUpperCase()
    };
  }

  function storedMovements() {
    return cloneList("bankMovements").map(normalizeMovement);
  }

  function derivedPaymentRows() {
    const service = portfolioService();
    if (!service) return [];
    return service.payments()
      .filter(item => item.status === "CONFIRMADO")
      .map(payment => {
        const account = findBankAccountByLinkedAccount(payment.paymentAccountCode);
        return normalizeMovement({
          id: `PAY-${payment.id}`,
          movementNumber: payment.paymentNumber,
          movementDate: payment.paymentDate,
          bankAccountId: account?.id || "",
          bankAccountCode: account?.code || "",
          bankName: account?.bankName || "",
          bankAccountLabel: account ? `${account.code} · ${account.bankName}` : payment.paymentAccountCode,
          movementType: "egreso",
          medium: payment.medium || payment.paymentMethod || "transferencia",
          reference: payment.reference,
          beneficiary: payment.providerName,
          concept: `Pago a proveedor ${payment.providerName}`,
          expenseValue: round2(payment.total || 0),
          incomeValue: 0,
          status: "CONTABILIZADO",
          originModule: "pagos",
          sourceDocument: payment.paymentNumber,
          journalEntryId: payment.entryId,
          journalEntryNumber: payment.entryNumber,
          observation: payment.observation,
          derived: true,
          sourceKind: "PAGO"
        });
      });
  }

  function derivedBatchRows() {
    const service = portfolioService();
    if (!service) return [];
    return service.paymentBatches()
      .filter(item => item.status === "CONFIRMADO")
      .map(batch => {
        const account = findBankAccountByLinkedAccount(batch.paymentAccountCode);
        return normalizeMovement({
          id: `LOT-${batch.id}`,
          movementNumber: batch.batchNumber,
          movementDate: batch.paymentDate,
          bankAccountId: account?.id || "",
          bankAccountCode: account?.code || "",
          bankName: account?.bankName || "",
          bankAccountLabel: account ? `${account.code} · ${account.bankName}` : batch.paymentAccountCode,
          movementType: "egreso",
          medium: "transferencia",
          reference: batch.reference,
          beneficiary: "Lote de pagos",
          concept: `Lote de pagos ${batch.batchNumber}`,
          expenseValue: round2(batch.totalToPay || 0),
          incomeValue: 0,
          status: "CONTABILIZADO",
          originModule: "pagos",
          sourceDocument: batch.batchNumber,
          journalEntryId: batch.entryId,
          journalEntryNumber: batch.entryNumber,
          observation: batch.observation,
          derived: true,
          sourceKind: "LOTE"
        });
      });
  }

  function receivableService() {
    return BlessERP.services.receivables;
  }

  function derivedCollectionRows() {
    const service = receivableService();
    if (!service) return [];
    return service.collections()
      .filter(item => item.status === "CONFIRMADO")
      .map(collection => {
        const account = collection.bankAccountId
          ? findBankAccountById(collection.bankAccountId)
          : findBankAccountByLinkedAccount(collection.collectionAccountCode);
        return normalizeMovement({
          id: `COB-${collection.id}`,
          movementNumber: collection.collectionNumber,
          movementDate: collection.collectionDate,
          bankAccountId: account?.id || "",
          bankAccountCode: account?.code || "",
          bankName: account?.bankName || "",
          bankAccountLabel: account ? `${account.code} · ${account.bankName}` : collection.collectionAccountCode,
          movementType: "ingreso",
          medium: collection.collectionMethod || "transferencia",
          reference: collection.reference,
          beneficiary: collection.customerName,
          concept: `Cobro a cliente ${collection.customerName}`,
          incomeValue: round2(collection.total || 0),
          expenseValue: 0,
          status: "CONTABILIZADO",
          originModule: "cobros",
          sourceDocument: collection.collectionNumber,
          journalEntryId: collection.entryId,
          journalEntryNumber: collection.entryNumber,
          observation: collection.observation,
          derived: true,
          sourceKind: "COBRO"
        });
      });
  }

  function derivedCollectionBatchRows() {
    const service = receivableService();
    if (!service) return [];
    return service.collectionBatches()
      .filter(item => item.status === "CONFIRMADO")
      .map(batch => {
        const account = batch.bankAccountId
          ? findBankAccountById(batch.bankAccountId)
          : findBankAccountByLinkedAccount(batch.collectionAccountCode);
        return normalizeMovement({
          id: `LCB-${batch.id}`,
          movementNumber: batch.batchNumber,
          movementDate: batch.collectionDate,
          bankAccountId: account?.id || "",
          bankAccountCode: account?.code || "",
          bankName: account?.bankName || "",
          bankAccountLabel: account ? `${account.code} · ${account.bankName}` : batch.collectionAccountCode,
          movementType: "ingreso",
          medium: "transferencia",
          reference: batch.reference,
          beneficiary: "Lote de cobros",
          concept: `Lote de cobros ${batch.batchNumber}`,
          incomeValue: round2(batch.totalToCollect || 0),
          expenseValue: 0,
          status: "CONTABILIZADO",
          originModule: "cobros",
          sourceDocument: batch.batchNumber,
          journalEntryId: batch.entryId,
          journalEntryNumber: batch.entryNumber,
          observation: batch.observation,
          derived: true,
          sourceKind: "LOTE_COBRO"
        });
      });
  }

  function sortMovements(rows = []) {
    return [...rows].sort((a, b) => {
      const aKey = `${a.movementDate || ""}|${a.movementNumber || ""}|${a.createdAt || ""}`;
      const bKey = `${b.movementDate || ""}|${b.movementNumber || ""}|${b.createdAt || ""}`;
      return bKey.localeCompare(aKey, "es");
    });
  }

  function movements(filters = {}) {
    const rows = sortMovements([
      ...storedMovements(),
      ...derivedPaymentRows(),
      ...derivedBatchRows(),
      ...derivedCollectionRows(),
      ...derivedCollectionBatchRows()
    ]);
    return rows.filter(item => {
      if (filters.bankAccountId && item.bankAccountId !== filters.bankAccountId) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.originModule && item.originModule !== filters.originModule) return false;
      if (filters.dateFrom && item.movementDate < filters.dateFrom) return false;
      if (filters.dateTo && item.movementDate > filters.dateTo) return false;
      if (filters.search) {
        const search = String(filters.search || "").toLowerCase();
        const haystack = [
          item.movementNumber,
          item.reference,
          item.beneficiary,
          item.concept,
          item.bankAccountLabel,
          item.journalEntryNumber
        ].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function accountMovements(accountId, { confirmedOnly = false } = {}) {
    return movements({ bankAccountId: accountId }).filter(item => !confirmedOnly || item.status === "CONTABILIZADO");
  }

  function accountSummary(accountId) {
    const account = findBankAccountById(accountId);
    if (!account) return null;
    const rows = accountMovements(accountId, { confirmedOnly: true });
    const incomes = round2(rows.reduce((sum, item) => sum + Number(item.incomeValue || 0), 0));
    const expenses = round2(rows.reduce((sum, item) => sum + Number(item.expenseValue || 0), 0));
    const lastMovement = rows[0] || null;
    return {
      account,
      openingBalance: round2(account.openingBalance || 0),
      incomes,
      expenses,
      currentBalance: round2(Number(account.openingBalance || 0) + incomes - expenses),
      lastMovement
    };
  }

  function accountsWithSummary(filters = {}) {
    return bankAccounts()
      .filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.type && item.accountType !== filters.type) return false;
        if (filters.search) {
          const search = String(filters.search || "").toLowerCase();
          const haystack = [item.code, item.bankName, item.accountNumber, item.holder].join(" ").toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .map(item => ({
        ...item,
        summary: accountSummary(item.id)
      }));
  }

  function validateMovement(movement, { forConfirm = false } = {}) {
    const candidate = normalizeMovement(movement);
    const errors = [];
    const account = candidate.bankAccountId ? findBankAccountById(candidate.bankAccountId) : null;

    if (!candidate.movementDate) errors.push("La fecha del movimiento es obligatoria.");
    if (!candidate.bankAccountId) errors.push("Debe seleccionar una cuenta bancaria.");
    if (!candidate.reference) errors.push("La referencia / comprobante es obligatoria.");
    if (!candidate.concept) errors.push("El concepto es obligatorio.");
    if (candidate.incomeValue > 0 && candidate.expenseValue > 0) errors.push("No se permite ingreso y egreso al mismo tiempo.");
    if (candidate.incomeValue <= 0 && candidate.expenseValue <= 0) errors.push("El movimiento no puede tener valor cero.");
    if (candidate.derived) errors.push("Los movimientos derivados no se pueden editar manualmente.");
    if (forConfirm && (!account || account.status !== "activa")) errors.push("La cuenta bancaria debe estar activa para contabilizar.");

    if (forConfirm) {
      if (!account) {
        errors.push("La cuenta bancaria seleccionada no existe.");
      } else if (!account.linkedAccountCode) {
        errors.push("La cuenta bancaria no tiene cuenta contable asociada.");
      } else {
        const linked = chartService.findByCode(account.linkedAccountCode);
        if (!linked) errors.push("La cuenta contable asociada a la cuenta bancaria no existe.");
        else {
          if (linked.status !== "Activa") errors.push("La cuenta contable asociada a la cuenta bancaria esta inactiva.");
          if (!linked.isMovement) errors.push("La cuenta contable asociada a la cuenta bancaria no es de movimiento.");
        }
      }

      if (!candidate.counterAccountCode) errors.push("Debe seleccionar la cuenta contable contrapartida.");
      const counter = candidate.counterAccountCode ? chartService.findByCode(candidate.counterAccountCode) : null;
      if (candidate.counterAccountCode && !counter) errors.push("La cuenta contable contrapartida no existe.");
      if (counter && counter.status !== "Activa") errors.push("La cuenta contable contrapartida esta inactiva.");
      if (counter && !counter.isMovement) errors.push("La cuenta contable contrapartida no es de movimiento.");
    }

    return { movement: candidate, errors };
  }

  function buildMovementJournalEntry(movement) {
    const bankAccount = findBankAccountById(movement.bankAccountId);
    const bankLedger = chartService.findByCode(bankAccount.linkedAccountCode);
    const counter = chartService.findByCode(movement.counterAccountCode);
    const entry = journalService.emptyEntry();
    entry.accountingDate = movement.movementDate;
    entry.accountingPeriod = companyService.settings().activePeriod || entry.accountingPeriod;
    entry.concept = movement.concept;
    entry.originModule = "Bancos";
    entry.sourceDocument = movement.movementNumber || movement.reference || "";
    entry.externalReference = movement.reference || "";
    entry.observation = movement.observation || "";

    const amount = round2(Number(movement.incomeValue || 0) || Number(movement.expenseValue || 0));
    if (movement.incomeValue > 0) {
      entry.lines = [
        {
          id: uid("JLN"),
          accountCode: bankLedger.code,
          accountName: bankLedger.name,
          debit: amount,
          credit: 0,
          costCenter: "",
          auxiliary: "",
          lineDescription: movement.lineDescription || movement.concept,
          documentReference: movement.reference || movement.movementNumber || ""
        },
        {
          id: uid("JLN"),
          accountCode: counter.code,
          accountName: counter.name,
          debit: 0,
          credit: amount,
          costCenter: movement.costCenter || "",
          auxiliary: movement.auxiliary || "",
          lineDescription: movement.lineDescription || movement.concept,
          documentReference: movement.reference || movement.movementNumber || ""
        }
      ];
    } else {
      entry.lines = [
        {
          id: uid("JLN"),
          accountCode: counter.code,
          accountName: counter.name,
          debit: amount,
          credit: 0,
          costCenter: movement.costCenter || "",
          auxiliary: movement.auxiliary || "",
          lineDescription: movement.lineDescription || movement.concept,
          documentReference: movement.reference || movement.movementNumber || ""
        },
        {
          id: uid("JLN"),
          accountCode: bankLedger.code,
          accountName: bankLedger.name,
          debit: 0,
          credit: amount,
          costCenter: "",
          auxiliary: "",
          lineDescription: movement.lineDescription || movement.concept,
          documentReference: movement.reference || movement.movementNumber || ""
        }
      ];
    }
    return entry;
  }

  function saveMovement(movement) {
    const { movement: candidate, errors } = validateMovement(movement, { forConfirm: false });
    const contentErrors = errors.filter(error => !error.includes("cuenta contable contrapartida") && !error.includes("derivados"));
    if (contentErrors.length) return { ok: false, errors: contentErrors };
    const rows = storedMovements();
    candidate.id = candidate.id || uid("BMV");
    if (!candidate.movementNumber) candidate.movementNumber = nextMovementNumber(rows);
    candidate.status = candidate.status === "ANULADO" ? "ANULADO" : "BORRADOR";
    const index = rows.findIndex(item => item.id === candidate.id);
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    saveList("bankMovements", rows);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: index >= 0 ? "EDITAR_MOVIMIENTO_BANCARIO" : "CREAR_MOVIMIENTO_BANCARIO",
      entityType: "bank_movement",
      entityId: candidate.id,
      entityLabel: candidate.movementNumber,
      documentLabel: candidate.reference || candidate.movementNumber,
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el movimiento bancario ${candidate.movementNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, movement: clone(candidate) };
  }

  function confirmMovement(movementId) {
    const rows = storedMovements();
    const index = rows.findIndex(item => item.id === movementId);
    if (index < 0) return { ok: false, errors: ["Movimiento bancario no encontrado."] };
    if (rows[index].status !== "BORRADOR") return { ok: false, errors: ["Solo se pueden contabilizar movimientos en borrador."] };
    const { movement: candidate, errors } = validateMovement(rows[index], { forConfirm: true });
    if (errors.length) return { ok: false, errors };
    const entryDraft = buildMovementJournalEntry(candidate);
    const savedEntry = journalService.saveDraft(entryDraft);
    if (!savedEntry.ok) return { ok: false, errors: savedEntry.errors || ["No se pudo guardar el asiento bancario."] };
    const postedEntry = journalService.postEntry(savedEntry.entry.id);
    if (!postedEntry.ok) return { ok: false, errors: postedEntry.errors || ["No se pudo contabilizar el asiento bancario."] };
    candidate.status = "CONTABILIZADO";
    candidate.journalEntryId = postedEntry.entry.id;
    candidate.journalEntryNumber = postedEntry.entry.entryNumber;
    rows[index] = candidate;
    saveList("bankMovements", rows);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "CONFIRMAR_MOVIMIENTO_BANCARIO",
      entityType: "bank_movement",
      entityId: candidate.id,
      entityLabel: candidate.movementNumber,
      documentLabel: candidate.reference || candidate.movementNumber,
      previousStatus: "BORRADOR",
      nextStatus: candidate.status,
      description: `Movimiento bancario ${candidate.movementNumber} contabilizado con asiento ${candidate.journalEntryNumber}.`,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, movement: clone(candidate), entry: clone(postedEntry.entry) };
  }

  function annulMovement(movementId) {
    const rows = storedMovements();
    const index = rows.findIndex(item => item.id === movementId);
    if (index < 0) return { ok: false, message: "Movimiento bancario no encontrado." };
    const movement = rows[index];
    if (movement.derived) return { ok: false, message: "Los movimientos derivados desde Pagos no se anulan aqui." };
    if (movement.status === "ANULADO") return { ok: false, message: "El movimiento ya esta anulado." };
    if (movement.status === "CONTABILIZADO" && movement.journalEntryId) {
      const reversed = journalService.reverseEntry(movement.journalEntryId);
      if (!reversed.ok) return { ok: false, message: reversed.message || "No se pudo reversar el movimiento bancario." };
      movement.reverseEntryId = reversed.entry.id;
      movement.reverseEntryNumber = reversed.entry.entryNumber;
    }
    movement.status = "ANULADO";
    rows[index] = normalizeMovement(movement);
    saveList("bankMovements", rows);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "ANULAR_MOVIMIENTO_BANCARIO",
      entityType: "bank_movement",
      entityId: movement.id,
      entityLabel: movement.movementNumber,
      documentLabel: movement.reference || movement.movementNumber,
      previousStatus: "CONTABILIZADO",
      nextStatus: movement.status,
      description: `Movimiento bancario ${movement.movementNumber} anulado.`,
      after: movement,
      result: "exitoso"
    });
    return { ok: true, movement: clone(rows[index]) };
  }

  function dashboardSummary() {
    const accounts = accountsWithSummary();
    const movementRows = movements();
    const confirmed = movementRows.filter(item => item.status === "CONTABILIZADO");
    return {
      activeAccounts: accounts.filter(item => item.status === "activa").length,
      inactiveAccounts: accounts.filter(item => item.status === "inactiva").length,
      totalAuxiliaryBalance: round2(accounts.reduce((sum, item) => sum + Number(item.summary?.currentBalance || 0), 0)),
      confirmedIncome: round2(confirmed.reduce((sum, item) => sum + Number(item.incomeValue || 0), 0)),
      confirmedExpense: round2(confirmed.reduce((sum, item) => sum + Number(item.expenseValue || 0), 0)),
      draftMovements: movementRows.filter(item => item.status === "BORRADOR").length
    };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.banks = {
    bankAccountTypes,
    bankAccountStates,
    movementTypes,
    movementMediums,
    movementStates,
    movementOrigins,
    bankAccounts,
    findBankAccountById,
    findBankAccountByCode,
    findBankAccountByLinkedAccount,
    saveBankAccount,
    toggleBankAccountStatus,
    accountsWithSummary,
    accountSummary,
    emptyMovement,
    movements,
    saveMovement,
    confirmMovement,
    annulMovement,
    dashboardSummary
  };
})();
