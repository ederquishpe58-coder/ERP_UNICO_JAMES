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
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isUuid(value) {
    return UUID_PATTERN.test(String(value || "").trim());
  }

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
    const typeMap = { CHECKING: "corriente", SAVINGS: "ahorros", CREDIT_CARD: "tarjeta", OTHER: "otro" };
    const statusMap = { ACTIVE: "activa", INACTIVE: "inactiva" };
    const sourceId = String(current.id || current.bankAccountId || "").trim() || uid("BNK");
    const canonicalId = [current.bankAccountId, current.canonicalBankAccountId, sourceId].find(isUuid) || "";
    const legacyId = String(current.legacyId || (!canonicalId ? sourceId : "")).trim();
    return {
      id: canonicalId || sourceId,
      bankAccountId: canonicalId,
      canonicalBankAccountId: canonicalId,
      legacyId,
      source: canonicalId ? "V2" : "LEGACY",
      isCanonical: Boolean(canonicalId),
      code: String(current.code || "").trim(),
      bankName: String(current.bankName || current.bank || "").trim(),
      accountNumber: String(current.accountNumber || "").trim(),
      accountType: typeMap[String(current.accountType || "").trim().toUpperCase()] || String(current.accountType || "corriente").trim().toLowerCase(),
      holder: String(current.holder || "").trim(),
      currency: String(current.currency || "USD").trim().toUpperCase(),
      linkedAccountCode: String(current.linkedAccountCode || "").trim(),
      openingBalance: round2(current.openingBalance || 0),
      openingBalanceDate: String(current.openingBalanceDate || companyService.settings().periodStart || today()).trim(),
      status: statusMap[String(current.status || "").trim().toUpperCase()] || String(current.status || "activa").trim().toLowerCase(),
      observation: String(current.observation || "").trim(),
      syncFlow: String(current.syncFlow || "")
    };
  }

  function bankAccounts() {
    const canonical = BlessERP.services?.treasuryV2?.bankAccounts?.() || [];
    const canonicalIds = new Set(canonical.flatMap(item => [item.id,item.legacyId]).filter(Boolean));
    return [...canonical, ...cloneList("bankAccounts").filter(item => !canonicalIds.has(item.id))].map(normalizeBankAccount);
  }

  function findBankAccountById(accountId) {
    const id = String(accountId || "").trim();
    return bankAccounts().find(item => item.id === id || item.bankAccountId === id || item.legacyId === id);
  }

  function resolveCanonicalBankAccount(accountId) {
    const id = String(accountId || "").trim();
    const canonical = (BlessERP.services?.treasuryV2?.bankAccounts?.() || [])
      .map(normalizeBankAccount)
      .find(item => item.bankAccountId === id || item.legacyId === id);
    if (canonical?.bankAccountId) return { ok:true,source:"V2",bankAccountId:canonical.bankAccountId,legacyId:canonical.legacyId,account:canonical };
    const account = findBankAccountById(id);
    return { ok:false,source:"LEGACY",bankAccountId:"",legacyId:account?.legacyId || id,account };
  }

  async function confirmCanonicalBankAccount(accountId) {
    const resolved = resolveCanonicalBankAccount(accountId);
    if (resolved.ok) return { ok:true,confirmed:true,reused:true,account:resolved.account };
    if (!resolved.account) return { ok:false,errors:["La cuenta bancaria seleccionada no existe."] };
    const result = await BlessERP.services?.treasuryV2?.confirmBankAccount?.(resolved.account);
    if (!result?.ok) return { ...(result || {}),ok:false,errors:result?.errors || [result?.message || "No se pudo confirmar la cuenta bancaria en Tesorería V2."] };
    return { ...result,account:normalizeBankAccount(result.account) };
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

    // El codigo definitivo se reserva atomically en PostgreSQL cuando queda vacio.
    if (!candidate.bankName) errors.push("El banco es obligatorio.");
    if (!candidate.holder) errors.push("El titular es obligatorio.");
    if (!candidate.linkedAccountCode) errors.push("Debe seleccionar la cuenta contable asociada.");
    if (!bankAccountTypes.includes(candidate.accountType)) errors.push("El tipo de cuenta bancaria no es valido.");
    if (!bankAccountStates.includes(candidate.status)) errors.push("El estado de la cuenta bancaria no es valido.");

    const duplicateCode = candidate.code && rows.find(item => item.id !== candidate.id && item.code === candidate.code);
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

  async function saveBankAccount(account) {
    const { account: candidate, errors, warnings } = validateBankAccount(account);
    if (errors.length) return { ok: false, errors, warnings };
    const before = findBankAccountById(candidate.id) || null;
    const result = await BlessERP.services?.treasuryV2?.upsertBankAccount?.(candidate);
    if (!result?.ok) return { ok:false,errors:result?.errors || [result?.message || "Supabase no confirmó la cuenta bancaria."],warnings };
    const confirmed = normalizeBankAccount(result.account);
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: before ? "EDITAR_CUENTA_BANCARIA" : "CREAR_CUENTA_BANCARIA",
      entityType: "bank_account",
      entityId: confirmed.id,
      entityLabel: confirmed.code,
      documentLabel: confirmed.bankName,
      previousStatus: before?.status || "",
      nextStatus: confirmed.status,
      description: `${before ? "Se actualizo" : "Se creo"} la cuenta bancaria ${confirmed.code}.`,
      before,
      after: confirmed,
      result: "exitoso"
    });
    return { ok: true, account: clone(confirmed), warnings, sync: result };
  }

  async function toggleBankAccountStatus(accountId) {
    const current = findBankAccountById(accountId);
    if (!current) return { ok: false, message: "Cuenta bancaria no encontrada." };
    const next = { ...current,status:current.status === "activa" ? "inactiva" : "activa" };
    const result = await saveBankAccount(next);
    if (!result.ok) return { ok:false,message:(result.errors || []).join(" ") || "No se confirmó el estado." };
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "CAMBIAR_ESTADO_CUENTA_BANCARIA",
      entityType: "bank_account",
      entityId: result.account.id,
      entityLabel: result.account.code,
      documentLabel: result.account.bankName,
      nextStatus: result.account.status,
      description: `Cuenta bancaria ${result.account.code} cambiada a ${result.account.status}.`,
      after: result.account,
      result: "exitoso"
    });
    return result;
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
    const sourceKind = String(current.sourceKind || "MANUAL").trim().toUpperCase();
    const sourceId = String(current.sourceId || "").trim();
    const canonicalSourcePrefix = { COLLECTION:"COB",SUPPLIER_PAYMENT:"PAY",TRANSFER:"TRF",ADJUSTMENT:"AJT" }[sourceKind];
    const semanticId = String(current.originType || "").toUpperCase() === "EXPECTED" && sourceId && canonicalSourcePrefix
      ? `${canonicalSourcePrefix}-${sourceId}${sourceKind === "TRANSFER" ? `-${String(current.direction || "").toUpperCase()}` : ""}` : "";
    const canonicalStatus = ({ CONFIRMED:"CONTABILIZADO", VOIDED:"ANULADO" })[String(current.status || "").toUpperCase()];
    const inferredType = String(current.direction || "").toUpperCase() === "CREDIT" ? "ingreso"
      : String(current.direction || "").toUpperCase() === "DEBIT" ? "egreso" : "";
    return {
      id: semanticId || current.id || uid("BMV"),
      treasuryTransactionId: String(current.id || current.bankTransactionId || "").trim(),
      movementNumber: String(current.movementNumber || nextMovementNumber()).trim(),
      movementDate: String(current.movementDate || today()).trim(),
      bankAccountId: String(current.bankAccountId || "").trim(),
      bankAccountCode: String(bankAccount?.code || current.bankAccountCode || "").trim(),
      bankName: String(bankAccount?.bankName || current.bankName || "").trim(),
      bankAccountLabel: bankAccount ? `${bankAccount.code} · ${bankAccount.bankName}` : String(current.bankAccountLabel || "").trim(),
      movementType: movementTypes.includes(String(current.movementType || inferredType).toLowerCase()) ? String(current.movementType || inferredType).toLowerCase() : "egreso",
      medium: movementMediums.includes(String(current.medium || "").toLowerCase()) ? String(current.medium || "").toLowerCase() : "transferencia",
      reference: String(current.reference || "").trim(),
      beneficiary: String(current.beneficiary || "").trim(),
      concept: String(current.concept || "").trim(),
      incomeValue: round2(current.incomeValue || current.income || 0),
      expenseValue: round2(current.expenseValue || current.expense || 0),
      status: canonicalStatus || (movementStates.includes(String(current.status || "").toUpperCase()) ? String(current.status || "").toUpperCase() : "BORRADOR"),
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
      originLabel: String(current.originLabel || current.originModule || "").trim(),
      derived: Boolean(current.derived),
      sourceKind,
      sourceId,
      originType: String(current.originType || "").trim().toUpperCase(),
      direction: String(current.direction || "").trim().toUpperCase(),
      syncFlow: String(current.syncFlow || "").trim()
    };
  }

  function storedMovements() {
    const canonical = BlessERP.services?.treasuryV2?.bankTransactions?.() || [];
    const ids = new Set(canonical.map(item => item.id));
    return [...canonical, ...cloneList("bankMovements").filter(item => !ids.has(item.id))].map(normalizeMovement);
  }

  function derivedPaymentRows() {
    const canonical = BlessERP.services?.supplierFinanceV2?.payments?.() || [];
    const service = portfolioService();
    const source = canonical.length ? canonical : (service?.payments?.() || []);
    return source
      .filter(item => ["CONFIRMADO","CONFIRMED"].includes(String(item.status || "").toUpperCase()))
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

  function derivedPayrollPaymentRows() {
    const payroll = stateApi.state.db.payroll || {};
    const payments = Array.isArray(payroll.payments) ? payroll.payments : [];
    const splits = Array.isArray(payroll.paymentSplits) ? payroll.paymentSplits : [];
    return splits
      .filter(split => ["TRANSFER", "CHECK"].includes(String(split.method || "").toUpperCase()) && split.status === "CONFIRMADO")
      .map(split => {
        const payment = payments.find(item => item.id === split.paymentId);
        const account = findBankAccountById(split.bankAccountId);
        return normalizeMovement({
          id: `ROL-${split.id}`,
          movementNumber: payment?.number || split.id,
          movementDate: split.date || payment?.date || today(),
          bankAccountId: account?.id || split.bankAccountId || "",
          bankAccountCode: account?.code || "",
          bankName: account?.bankName || "",
          bankAccountLabel: account ? `${account.code} · ${account.bankName}` : "",
          movementType: "egreso",
          medium: String(split.method || "").toUpperCase() === "CHECK" ? "cheque" : "transferencia",
          reference: split.reference || split.checkNumber || "",
          beneficiary: payment?.employeeName || split.beneficiary || "",
          concept: `Pago de rol ${payment?.number || ""}`,
          expenseValue: round2(split.amount || 0),
          incomeValue: 0,
          status: "CONTABILIZADO",
          originModule: "pagos",
          sourceDocument: payment?.number || "",
          journalEntryId: payment?.journalEntryId || "",
          journalEntryNumber: payment?.journalEntryNumber || "",
          observation: split.observation || payment?.observation || "",
          derived: true,
          sourceKind: "PAGO_ROL"
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
    const canonical = BlessERP.services?.financialV2?.collections?.() || [];
    const service = receivableService();
    const source = canonical.length ? canonical : (service?.collections?.() || []);
    return source
      .filter(item => ["CONFIRMADO","CONFIRMED"].includes(String(item.status || "").toUpperCase()))
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

  function derivedJournalRows(existingRows = []) {
    const representedEntryIds = new Set((existingRows || [])
      .map(item => String(item.journalEntryId || "").trim())
      .filter(Boolean));
    const accountByLedger = new Map(bankAccounts()
      .filter(item => item.status === "activa" && item.linkedAccountCode)
      .map(item => [item.linkedAccountCode, item]));
    if (!accountByLedger.size || !journalService?.impactedEntries) return [];

    const result = [];
    journalService.impactedEntries({}).forEach(entry => {
      if (representedEntryIds.has(String(entry.id || ""))) return;
      (entry.lines || []).forEach((line, lineIndex) => {
        const account = accountByLedger.get(String(line.accountCode || "").trim());
        if (!account) return;
        const debit = round2(line.debit || 0);
        const credit = round2(line.credit || 0);
        if (debit <= 0 && credit <= 0) return;
        const originText = String(entry.originModule || "Manual");
        const originKey = originText.toLowerCase().includes("cobro")
          ? "cobros"
          : originText.toLowerCase().includes("pago")
            ? "pagos"
            : originText.toLowerCase().includes("ajuste")
              ? "ajustes"
              : originText.toLowerCase().includes("transfer")
                ? "transferencias"
                : "manual";
        result.push(normalizeMovement({
          id: `JRN-${entry.id}-${line.id || lineIndex + 1}`,
          movementNumber: entry.entryNumber || entry.id,
          movementDate: entry.accountingDate,
          bankAccountId: account.id,
          bankAccountCode: account.code,
          bankName: account.bankName,
          bankAccountLabel: `${account.code} · ${account.bankName}`,
          movementType: debit > 0 ? "ingreso" : "egreso",
          medium: "otro",
          reference: entry.externalReference || entry.sourceDocument || entry.entryNumber || "",
          beneficiary: line.auxiliary || "",
          concept: line.lineDescription || entry.concept || "Movimiento de Libro Diario",
          incomeValue: debit,
          expenseValue: credit,
          status: "CONTABILIZADO",
          originModule: originKey,
          originLabel: `Libro Diario · ${originText}`,
          sourceDocument: entry.sourceDocument || "",
          journalEntryId: entry.id,
          journalEntryNumber: entry.entryNumber || "",
          observation: entry.observation || "",
          derived: true,
          sourceKind: "LIBRO_DIARIO"
        }));
      });
    });
    return result;
  }

  function sortMovements(rows = []) {
    return [...rows].sort((a, b) => {
      const aKey = `${a.movementDate || ""}|${a.movementNumber || ""}|${a.createdAt || ""}`;
      const bKey = `${b.movementDate || ""}|${b.movementNumber || ""}|${b.createdAt || ""}`;
      return bKey.localeCompare(aKey, "es");
    });
  }

  function movements(filters = {}) {
    const stored = storedMovements();
    const confirmedSources = new Set(stored
      .filter(item => item.sourceId && item.syncFlow === "EXPLICIT_TREASURY_V2")
      .map(item => `${item.sourceKind}:${item.sourceId}`));
    const isAlreadyRepresented = item => {
      if (item.sourceKind === "COBRO") return confirmedSources.has(`COLLECTION:${String(item.id || "").replace(/^COB-/,"")}`);
      if (item.sourceKind === "PAGO") return confirmedSources.has(`SUPPLIER_PAYMENT:${String(item.id || "").replace(/^PAY-/,"")}`);
      return false;
    };
    const sourceRows = [
      ...stored,
      ...derivedPaymentRows().filter(item => !isAlreadyRepresented(item)),
      ...derivedPayrollPaymentRows(),
      ...derivedBatchRows(),
      ...derivedCollectionRows().filter(item => !isAlreadyRepresented(item)),
      ...derivedCollectionBatchRows()
    ];
    const rows = sortMovements([
      ...sourceRows,
      ...derivedJournalRows(sourceRows)
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
    entry.accountingPeriod = journalService.accountingPeriodForDate?.(entry.accountingDate, entry.accountingPeriod)
      || String(entry.accountingDate || "").slice(0, 7)
      || entry.accountingPeriod;
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

  async function confirmMovement(movementId, movementOverride = null) {
    const rows = storedMovements();
    const index = rows.findIndex(item => item.id === movementId);
    const source = movementOverride || rows[index];
    if (!source) return { ok: false, errors: ["Movimiento bancario no encontrado."] };
    const { movement: candidate, errors } = validateMovement(source, { forConfirm: true });
    if (errors.length) return { ok: false, errors };
    const entryDraft = buildMovementJournalEntry(candidate);
    const result = await BlessERP.services?.treasuryV2?.registerTransaction?.({ ...candidate,accountType:"BANK",accountId:candidate.bankAccountId,
      amount:Number(candidate.incomeValue || candidate.expenseValue),direction:Number(candidate.incomeValue || 0)>0?"CREDIT":"DEBIT",
      originType:"EXPECTED",sourceType:"MANUAL",sourceId:candidate.id,journal:entryDraft });
    if (!result?.ok) return { ok:false,errors:result?.errors || [result?.message || "Supabase no confirmó el movimiento bancario."] };
    const confirmed = normalizeMovement({ ...result.transaction,status:"CONTABILIZADO" });
    const entry = (result.records || []).find(row => row.entity === "financial_journal_entries")?.payload || {};
    adminService?.addAuditLog?.({
      module: "BANCOS",
      action: "CONFIRMAR_MOVIMIENTO_BANCARIO",
      entityType: "bank_movement",
      entityId: confirmed.id,
      entityLabel: confirmed.movementNumber,
      documentLabel: confirmed.reference || confirmed.movementNumber,
      previousStatus: "BORRADOR",
      nextStatus: confirmed.status,
      description: `Movimiento bancario ${confirmed.movementNumber} confirmado en Supabase.`,
      after: confirmed,
      result: "exitoso"
    });
    return { ok: true, movement: clone(confirmed), entry: clone(entry), sync:result };
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
    confirmCanonicalBankAccount,
    findBankAccountById,
    findBankAccountByCode,
    findBankAccountByLinkedAccount,
    isUuid,
    resolveCanonicalBankAccount,
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
