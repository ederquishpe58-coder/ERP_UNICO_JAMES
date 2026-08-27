(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));

  function repository() { return BlessERP.getTreasuryV2Repository?.(); }
  function treasuryState() {
    const db = BlessERP.state?.state?.db || {};
    db.treasuryV2 = db.treasuryV2 || {};
    return db.treasuryV2;
  }
  function rows(key) { return clone(treasuryState()[key] || []); }
  function payloads(result, entity) { return (result?.records || []).filter(row => row?.entity === entity).map(row => clone(row.payload || {})); }
  function first(result, entity) { return payloads(result, entity)[0] || null; }
  function failure(result, fallback) { return { ...(result || {}), ok: false, errors: result?.errors || [result?.message || fallback] }; }

  function canonicalBankAccount(row = {}) {
    return {
      companyId: String(row.companyId || row.company_id || ""),
      id: String(row.id || row.bankAccountId || row.bank_account_id || ""),
      bankAccountId: String(row.bankAccountId || row.bank_account_id || row.id || ""),
      code: String(row.code || row.accountCode || row.account_code || ""),
      bankName: String(row.bankName || row.bank_name || ""),
      holder: String(row.holder || row.account_holder || ""),
      accountNumber: String(row.accountNumber || row.masked_number || ""),
      accountType: String(row.accountType || row.account_type || "CHECKING"),
      currency: String(row.currency || row.currency_code || "USD"),
      linkedAccountCode: String(row.linkedAccountCode || row.ledger_account_code || ""),
      openingBalance: Number(row.openingBalance ?? row.opening_balance ?? 0),
      openingBalanceDate: String(row.openingBalanceDate || row.opening_balance_date || "").slice(0, 10),
      status: String(row.status || "ACTIVE"),
      observation: String(row.observation || row.notes || ""),
      legacyId: String(row.legacyId || row.legacy_id || ""),
      version: Number(row.version || 1),
      syncFlow: "TREASURY_V2"
    };
  }

  function bankAccounts() {
    const companyId = String(repository()?.activeCompanyUuid?.() || "");
    return rows("bankAccounts")
      .map(canonicalBankAccount)
      .filter(row => Boolean(companyId && row.companyId === companyId && String(row.status).toUpperCase() === "ACTIVE"));
  }
  function cashAccounts() { return rows("cashAccounts"); }
  function bankTransactions() { return rows("bankTransactions"); }
  function cashTransactions() { return rows("cashTransactions"); }
  function transfers() { return rows("transfers"); }
  function reconciliations() { return rows("reconciliations"); }
  function reconciliationMatches() { return rows("reconciliationMatches"); }
  function reconciliationReviews() { return rows("reconciliationReviews"); }
  function adjustments() { return rows("adjustments"); }

  async function hydrateBankAccountCatalog() {
    const repo = repository();
    const companyId = String(repo?.activeCompanyUuid?.() || "");
    if (!repo || !companyId) {
      return { ok: false, fetchedRows: 0, mode: "COMPANY_REQUIRED", message: "Falta la empresa activa para consultar las cuentas Treasury." };
    }
    const result = await repo.bankAccountCatalog?.();
    if (!result?.ok) {
      return { ...(result || {}), ok: false, fetchedRows: 0, mode: result?.mode || "TREASURY_CATALOG_READ_ERROR", message: result?.message || "No se pudo consultar el catálogo bancario Treasury." };
    }
    const canonical = new Map();
    (result.rows || []).forEach(source => {
      const row = canonicalBankAccount(source);
      if (!row.id || row.companyId !== companyId || String(row.status).toUpperCase() !== "ACTIVE") return;
      canonical.set(row.id, row);
    });
    treasuryState().bankAccounts = [...canonical.values()].sort((left, right) => left.code.localeCompare(right.code, "es"));
    return {
      ok: true,
      mode: "CANONICAL_TREASURY_CATALOG",
      companyId,
      fetchedRows: canonical.size,
      bankAccounts: bankAccounts()
    };
  }

  async function upsertBankAccount(account = {}, options = {}) {
    const accountId = String(account.bankAccountId || account.id || "");
    const canonicalId = repository()?.isUuid?.(accountId) ? accountId : "";
    const result = await repository()?.upsertBankAccount({
      bankAccountId: canonicalId,
      accountCode: String(account.code || account.accountCode || ""), bankName: String(account.bankName || account.bank || ""),
      holder: String(account.holder || ""), maskedNumber: String(account.accountNumber || account.maskedNumber || ""), accountType: String(account.accountType || "CHECKING").toUpperCase()
        .replace("CORRIENTE","CHECKING").replace("AHORROS","SAVINGS").replace("OTRO","OTHER"),
      currencyCode: String(account.currency || account.currencyCode || "USD"), ledgerAccountCode: String(account.linkedAccountCode || account.ledgerAccountCode || ""),
      openingBalance: Number(account.openingBalance || 0), openingBalanceDate: String(account.openingBalanceDate || "").slice(0,10),
      status: ["ACTIVA","ACTIVE"].includes(String(account.status || "ACTIVE").toUpperCase()) ? "ACTIVE" : "INACTIVE",
      notes: String(account.observation || account.notes || ""), legacyId: String(account.legacyId || (canonicalId ? "" : account.id) || "")
    }, options);
    return result?.ok ? { ...result, account: first(result,"treasury_bank_accounts") } : failure(result,"Cuenta bancaria no confirmada.");
  }

  async function confirmBankAccount(account = {}, options = {}) {
    const legacyId = String(account.legacyId || account.id || "").trim();
    const suppliedId = String(account.bankAccountId || account.id || "").trim();
    if (repository()?.isUuid?.(suppliedId)) {
      return { ok: true, confirmed: true, reused: true, account: canonicalBankAccount({ ...account, bankAccountId: suppliedId, id: suppliedId }) };
    }
    if (!legacyId) return failure({ code:"BANK_ACCOUNT_LEGACY_ID_REQUIRED" }, "No se pudo identificar la cuenta bancaria pendiente.");

    const existing = await repository()?.findBankAccountByLegacyId?.(legacyId);
    if (existing?.ok && existing.rows?.[0]) {
      return { ok: true, confirmed: true, reused: true, account: canonicalBankAccount(existing.rows[0]) };
    }

    const created = await upsertBankAccount({ ...account, bankAccountId:"", legacyId }, options);
    if (created?.ok) return { ...created, account: canonicalBankAccount(created.account), reused: Boolean(created.result?.reused) };

    // Una segunda sesión puede haber ganado la carrera protegida por legacy_id.
    const recovered = await repository()?.findBankAccountByLegacyId?.(legacyId);
    if (recovered?.ok && recovered.rows?.[0]) {
      return { ok: true, confirmed: true, reused: true, account: canonicalBankAccount(recovered.rows[0]) };
    }
    return failure(created, "No se pudo confirmar la cuenta bancaria en Tesorería V2.");
  }

  async function upsertCashAccount(account = {}, options = {}) {
    const result = await repository()?.upsertCashAccount({
      cashAccountId: String(account.cashAccountId || ""), accountCode: String(account.code || account.accountCode || ""),
      name: String(account.name || ""), currencyCode: String(account.currency || account.currencyCode || "USD"),
      ledgerAccountCode: String(account.linkedAccountCode || account.ledgerAccountCode || ""), openingBalance: Number(account.openingBalance || 0),
      openingBalanceDate: String(account.openingBalanceDate || "").slice(0,10), status: String(account.status || "ACTIVE").toUpperCase(),
      notes: String(account.observation || account.notes || ""), legacyId: String(account.legacyId || "")
    }, options);
    return result?.ok ? { ...result, account: first(result,"treasury_cash_accounts") } : failure(result,"Caja no confirmada.");
  }

  async function registerTransaction(transaction = {}, options = {}) {
    const income = Number(transaction.incomeValue || 0), expense = Number(transaction.expenseValue || 0);
    const result = await repository()?.registerTransaction({
      accountType: String(transaction.accountType || "BANK").toUpperCase(), accountId: String(transaction.accountId || transaction.bankAccountId || transaction.cashAccountId || ""),
      transactionDate: String(transaction.transactionDate || transaction.movementDate || "").slice(0,10), valueDate: String(transaction.valueDate || transaction.movementDate || "").slice(0,10),
      direction: String(transaction.direction || (income > 0 ? "CREDIT" : "DEBIT")).toUpperCase(), amount: Number(transaction.amount || income || expense),
      currencyCode: String(transaction.currency || transaction.currencyCode || "USD"), description: String(transaction.description || transaction.concept || ""),
      reference: String(transaction.reference || ""), originType: String(transaction.originType || "EXPECTED").toUpperCase(),
      sourceType: String(transaction.sourceType || transaction.sourceKind || "MANUAL").toUpperCase(), sourceId: String(transaction.sourceId || transaction.id || ""),
      journal: transaction.journal || null
    }, options);
    return result?.ok ? { ...result, transaction: first(result,"treasury_bank_transactions") || first(result,"treasury_cash_transactions") }
      : failure(result,"Movimiento no confirmado.");
  }

  async function importStatement({ bankAccountId, fileName, fileFingerprint, rows: inputRows }, options = {}) {
    const result = await repository()?.importStatement(bankAccountId,fileName,fileFingerprint,inputRows,options);
    return result?.ok ? { ...result, imported: Number(result.result?.imported || 0), duplicates: Number(result.result?.duplicates || 0),
      transactions: payloads(result,"treasury_bank_transactions") } : failure(result,"Extracto no importado.");
  }

  async function saveReconciliation(payload = {}, options = {}) {
    const result = await repository()?.saveReconciliation(payload,options);
    return result?.ok ? { ...result, reconciliation:first(result,"treasury_reconciliations") } : failure(result,"Conciliación no confirmada.");
  }
  async function reconcile(reconciliationId,matches,notes,options = {}) {
    const result = await repository()?.reconcile(reconciliationId,matches,notes,options);
    return result?.ok ? { ...result, reconciliation:first(result,"treasury_reconciliations"), matches:payloads(result,"treasury_reconciliation_matches") }
      : failure(result,"Cruce no confirmado.");
  }
  async function reverseMatch(matchId,reason,options = {}) {
    const result = await repository()?.reverseMatch(matchId,reason,options);
    return result?.ok ? { ...result, match:first(result,"treasury_reconciliation_matches") } : failure(result,"No se pudo deshacer la conciliación.");
  }
  async function reviewReconciliation(reconciliationId,kind,movementId,action,observation,options = {}) {
    const side=String(kind || "").toLowerCase()==="statement" ? "BANK" : "SYSTEM";
    const result=await repository()?.reviewReconciliation(reconciliationId,side,movementId,action,observation,options);
    return result?.ok ? { ...result,review:first(result,"treasury_reconciliation_reviews") }
      : failure(result,"Observación no confirmada.");
  }
  async function closeReconciliation(id,bankClosingBalance,options = {}) {
    const result = await repository()?.setReconciliationStatus(id,"CLOSE",{ bankClosingBalance },options);
    return result?.ok ? { ...result, reconciliation:first(result,"treasury_reconciliations") } : failure(result,"Cierre no confirmado.");
  }
  async function reopenReconciliation(id,reason,options = {}) {
    const result = await repository()?.setReconciliationStatus(id,"REOPEN",{ reason },options);
    return result?.ok ? { ...result, reconciliation:first(result,"treasury_reconciliations") } : failure(result,"Reapertura no confirmada.");
  }
  async function createTransfer(payload = {}, options = {}) {
    const result = await repository()?.transfer(payload,options);
    return result?.ok ? { ...result, transfer:first(result,"treasury_transfers"), entry:first(result,"financial_journal_entries") }
      : failure(result,"Transferencia no confirmada.");
  }
  async function registerAdjustment(payload = {}, options = {}) {
    const result = await repository()?.registerAdjustment(payload,options);
    return result?.ok ? { ...result,adjustment:first(result,"treasury_adjustments"),entry:first(result,"financial_journal_entries") }
      : failure(result,"Ajuste no confirmado.");
  }

  function expectedOperations() {
    const collections = BlessERP.services?.financialV2?.collections?.() || [];
    const payments = BlessERP.services?.supplierFinanceV2?.payments?.() || [];
    return [
      ...collections.filter(row => ["CONFIRMADO","CONFIRMED"].includes(String(row.status).toUpperCase())).map(row => ({ id:String(row.id),sourceType:"COLLECTION",date:row.collectionDate,
        description:`Cobro ${row.collectionNumber || row.id}`,reference:row.reference,amount:Number(row.total || 0),direction:"CREDIT" })),
      ...payments.filter(row => ["CONFIRMADO","CONFIRMED"].includes(String(row.status).toUpperCase())).map(row => ({ id:String(row.id),sourceType:"SUPPLIER_PAYMENT",date:row.paymentDate,
        description:`Pago ${row.paymentNumber || row.id}`,reference:row.reference,amount:Number(row.total || 0),direction:"DEBIT" })),
      ...transfers().filter(row => String(row.status).toUpperCase()==="CONFIRMED").map(row => ({ id:String(row.id),sourceType:"TRANSFER",date:row.transferDate,
        description:`Transferencia ${row.transferNumber || row.id}`,reference:row.reference,amount:Number(row.amount || 0),direction:"DEBIT" }))
    ];
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.treasuryV2 = Object.freeze({
    adjustments,bankAccounts,bankTransactions,cashAccounts,cashTransactions,confirmBankAccount,createTransfer,expectedOperations,hydrateBankAccountCatalog,importStatement,
    reconciliationMatches,reconciliationReviews,reconciliations,registerAdjustment,registerTransaction,reopenReconciliation,reverseMatch,reviewReconciliation,saveReconciliation,closeReconciliation,
    reconcile,transfers,upsertBankAccount,upsertCashAccount,
    bankBalances: filters => repository()?.bankBalances(filters), cashBalances: filters => repository()?.cashBalances(filters),
    cashFlow: filters => repository()?.cashFlow(filters)
  });
  BlessERP.domainDataHydrators = BlessERP.domainDataHydrators || {};
  BlessERP.domainDataHydrators["treasury-catalog"] = () => hydrateBankAccountCatalog();
})();
