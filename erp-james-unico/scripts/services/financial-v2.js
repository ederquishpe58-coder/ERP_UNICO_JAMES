(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function repository() {
    return BlessERP.getFinancialV2Repository?.();
  }

  function db() {
    return BlessERP.state?.state?.db || {};
  }

  function financeState() {
    const state = db();
    state.financeV2 = state.financeV2 || {};
    return state.financeV2;
  }

  function clone(value) {
    return BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  }

  function canonicalUuid(value) {
    const candidate = String(value || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
      ? candidate
      : "";
  }

  function entityPayloads(records = [], entity = "") {
    return records
      .filter(record => String(record?.entity || "") === entity)
      .map(record => clone(record.payload || {}));
  }

  function firstEntity(result, entity) {
    return entityPayloads(result?.records, entity)[0] || null;
  }

  function journalEntries() {
    return clone(financeState().journalEntries || []);
  }

  function receivables() {
    return clone(financeState().receivables || []);
  }

  function collections() {
    return clone(financeState().collections || []);
  }

  function creditNotes() {
    return clone(financeState().creditNotes || []);
  }

  function normalizedJournal(entry = {}) {
    return {
      ...clone(entry),
      id: String(entry.id || entry.journalEntryId || ""),
      entryNumber: String(entry.entryNumber || ""),
      status: ({ POSTED: "CONTABILIZADO", REVERSED: "REVERSADO", CANCELLED: "ANULADO" })[String(entry.status || "").toUpperCase()] || String(entry.status || "BORRADOR").toUpperCase(),
      lines: clone(entry.lines || []),
      syncFlow: "FINANCIAL_V2",
      remoteConfirmed: true
    };
  }

  function normalizedReceivable(row = {}) {
    const canonicalStatus = String(row.status || "OPEN").toUpperCase();
    return {
      ...clone(row),
      id: String(row.id || row.receivableId || ""),
      documentType: String(row.documentType || "factura sri").toLowerCase(),
      status: ({ OPEN: "PENDIENTE", PARTIALLY_PAID: "PARCIAL", PAID: "COBRADO", CANCELLED: "ANULADO" })[canonicalStatus] || canonicalStatus,
      postingStatus: "CONTABILIZADO",
      journalEntryId: String(row.journalEntryId || ""),
      balance: Number(row.balance || 0),
      syncFlow: "FINANCIAL_V2",
      remoteConfirmed: true
    };
  }

  function normalizedCollection(row = {}) {
    return {
      ...clone(row),
      id: String(row.id || row.collectionId || ""),
      status: String(row.status || "CONFIRMADO").toUpperCase(),
      collectionAccountCode: String(row.collectionAccountCode || row.debitAccountCode || ""),
      syncFlow: "FINANCIAL_V2",
      remoteConfirmed: true
    };
  }

  function financialReceivableForLegacy(candidate = {}) {
    const references = new Set([
      candidate.v2ReceivableId,
      candidate.id,
      candidate.sourceDocumentId,
      candidate.accessKey,
      candidate.authorizationNumber,
      candidate.documentNumber
    ].map(value => String(value || "").trim()).filter(Boolean));
    return receivables().find(row =>
      references.has(String(row.id || row.receivableId || ""))
      || references.has(String(row.sourceId || ""))
      || (String(row.documentNumber || "") === String(candidate.documentNumber || "")
        && String(row.customerId || "") === String(candidate.customerId || ""))
    ) || null;
  }

  function invoicePayload(candidate = {}) {
    return {
      sourceId: String(candidate.sourceDocumentId || candidate.accessKey || candidate.authorizationNumber || candidate.id || ""),
      electronicDocumentId: String(candidate.sourceDocumentId || ""),
      orderId: String(candidate.sourceOrderId || candidate.orderId || ""),
      shipmentId: String(candidate.shipmentId || ""),
      customerId: String(candidate.customerId || ""),
      customerName: String(candidate.customerName || ""),
      customerTaxId: String(candidate.customerTaxId || ""),
      documentType: String(candidate.documentType || "INVOICE").toUpperCase(),
      documentNumber: String(candidate.documentNumber || ""),
      issueDate: String(candidate.issueDate || "").slice(0, 10),
      dueDate: String(candidate.dueDate ?? "").slice(0, 10),
      currencyCode: String(candidate.currencyCode || "USD").toUpperCase(),
      exchangeRate: Number(candidate.exchangeRate || 1),
      subtotal: Number(candidate.subtotal || 0),
      taxTotal: Number(candidate.taxTotal || 0),
      total: Number(candidate.total || 0),
      receivableAccountCode: String(candidate.receivableAccountCode || ""),
      counterAccountCode: String(candidate.counterAccountCode || ""),
      taxAccountCode: String(candidate.taxAccountCode || ""),
      authorizationNumber: String(candidate.authorizationNumber || ""),
      accessKey: String(candidate.accessKey || "")
    };
  }

  async function postJournal(entry = {}, options = {}) {
    const repo = repository();
    if (!repo) return { ok: false, message: "Repositorio financiero V2 no disponible." };
    const result = await repo.postJournal({
      accountingDate: entry.accountingDate,
      concept: entry.concept,
      originModule: entry.originModule || "Manual",
      sourceDocument: entry.sourceDocument || "",
      externalReference: entry.externalReference || "",
      currencyCode: entry.currencyCode || "USD",
      exchangeRate: Number(entry.exchangeRate || 1),
      observation: entry.observation || "",
      legacyDraftId: entry.syncFlow === "FINANCIAL_V2" ? "" : String(entry.id || ""),
      lines: (entry.lines || []).map(line => ({
        accountCode: String(line.accountCode || ""),
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        costCenter: String(line.costCenter || ""),
        auxiliary: String(line.auxiliary || ""),
        lineDescription: String(line.lineDescription || ""),
        documentReference: String(line.documentReference || "")
      }))
    }, {
      sourceType: options.sourceType || (entry.syncFlow === "FINANCIAL_V2" ? "JOURNAL_ENTRY" : "MANUAL_DRAFT"),
      sourceId: options.sourceId || String(entry.id || ""),
      eventType: options.eventType || "POST_JOURNAL",
      ...options
    });
    if (!result.ok) return result;
    return { ...result, entry: normalizedJournal(firstEntity(result, "financial_journal_entries") || {}) };
  }

  async function postInvoice(candidate = {}, options = {}) {
    const repo = repository();
    if (!repo) return { ok: false, message: "Repositorio financiero V2 no disponible." };
    const result = await repo.postInvoice(invoicePayload(candidate), options);
    if (!result.ok) return result;
    const receivable = normalizedReceivable(firstEntity(result, "financial_receivables") || {});
    const entry = normalizedJournal(firstEntity(result, "financial_journal_entries") || {});
    return { ...result, receivable, entry, reused: Boolean(financialReceivableForLegacy(candidate)) };
  }

  async function postCreditNote(receivable = {}, note = {}, options = {}) {
    const repo = repository();
    const canonical = financialReceivableForLegacy(receivable);
    if (!repo || !canonical?.id) return { ok: false, errors: ["Primero contabilice la factura original en V2."] };
    const result = await repo.postCreditNote({
      receivableId: canonical.id,
      sourceId: String(note.remoteDocumentId || note.id || note.accessKey || note.authorizationNumber || ""),
      electronicDocumentId: String(note.remoteDocumentId || ""),
      documentNumber: String(note.documentNumber || ""),
      issueDate: String(note.issueDate || "").slice(0, 10),
      subtotal: Number(note.subtotal || 0),
      taxTotal: Number(note.taxTotal || 0),
      total: Number(note.total || 0),
      reason: String(note.reason || ""),
      accessKey: String(note.accessKey || ""),
      authorizationNumber: String(note.authorizationNumber || ""),
      receivableAccountCode: String(receivable.receivableAccountCode || ""),
      revenueAccountCode: String(receivable.counterAccountCode || ""),
      taxAccountCode: String(receivable.taxAccountCode || "")
    }, options);
    if (!result.ok) return result;
    return {
      ...result,
      creditNote: firstEntity(result, "financial_credit_notes"),
      receivable: normalizedReceivable(firstEntity(result, "financial_receivables") || {}),
      entry: normalizedJournal(firstEntity(result, "financial_journal_entries") || {})
    };
  }

  function applicationPayload(application = {}) {
    const service = BlessERP.services?.receivables;
    const requestedId = String(application.receivableId || "").trim();
    const selected = BlessERP.services?.portfolioReadV2?.row?.("ar", requestedId)
      || (BlessERP.services?.paymentCollectionReadV2?.snapshot?.()?.collection?.lookup?.items || [])
        .find(item => String(item.id || "") === requestedId)
      || receivables().find(item => String(item.id || item.receivableId || "") === requestedId)
      || null;
    const source = String(selected?.source || application.source || application.syncFlow || "").toUpperCase();
    const directCanonicalId = source === "FINANCIAL_V2" ? canonicalUuid(selected?.id || requestedId) : "";
    const legacy = selected || service?.findReceivableById?.(requestedId) || application;
    const canonical = directCanonicalId ? { id: directCanonicalId } : financialReceivableForLegacy(legacy);
    return {
      receivableId: String(canonical?.id || canonical?.receivableId || ""),
      receivableAccountCode: String(application.receivableAccountCode || legacy.receivableAccountCode || ""),
      amount: Number(application.amount || 0)
    };
  }

  function canonicalCollectionMethod(collection = {}) {
    return String(
      collection.collectionMethod
      || collection.paymentMethod
      || collection.paymentForm
      || "transferencia"
    ).trim().toLowerCase();
  }

  function collectionPayloadPreview(collection = {}) {
    const method = canonicalCollectionMethod(collection);
    return {
      clientReferenceId: String(collection.id || ""),
      customerId: String(collection.customerId || ""),
      collectionDate: String(collection.collectionDate || "").slice(0, 10),
      collectionMethod: method,
      paymentMethod: method,
      bankAccountId: String(collection.bankAccountId || ""),
      reference: String(collection.reference || ""),
      currencyCode: String(collection.currencyCode || "USD"),
      exchangeRate: Number(collection.exchangeRate || 1),
      debitAccountCode: String(collection.collectionAccountCode || ""),
      applications: (collection.applications || []).filter(item => Number(item.amount || 0) > 0).map(applicationPayload)
    };
  }

  async function registerCollection(collection = {}, options = {}) {
    const repo = repository();
    if (!repo) return { ok: false, message: "Repositorio financiero V2 no disponible." };
    const activeTrace = repo.collectionTrace?.();
    if (!options.collectionTraceId || !activeTrace || activeTrace.traceId !== options.collectionTraceId
      || activeTrace.completedAt || activeTrace.failedStage) {
      const started = repo.startCollectionTrace?.({ origin: "FINANCIAL_V2_SERVICE" });
      options = { ...options, collectionTraceId: started?.traceId || "" };
    }
    repo.recordCollectionTrace?.("FINANCIAL_SERVICE_STARTED");
    const payload = collectionPayloadPreview(collection);
    repo.recordCollectionTrace?.("COLLECTION_PAYLOAD_BUILT", {
      receivableCount: payload.applications.length,
      customerIdPresent: Boolean(payload.customerId),
      bankAccountIdPresent: Boolean(payload.bankAccountId),
      debitAccountCodePresent: Boolean(payload.debitAccountCode),
      collectionMethod: payload.collectionMethod
    });
    if (payload.applications.some(item => !item.receivableId)) {
      repo.failCollectionTrace?.("COLLECTION_PAYLOAD", { code: "RECEIVABLE_ID_REQUIRED", message: "Falta receivable_id canónico." });
      return { ok: false, errors: ["Primero contabilice en V2 todos los documentos que recibirán el cobro."] };
    }
    const result = await repo.registerCollection(payload, options);
    if (!result.ok) return result;
    return {
      ...result,
      collection: normalizedCollection(firstEntity(result, "financial_collections") || {}),
      entry: normalizedJournal(firstEntity(result, "financial_journal_entries") || {})
    };
  }

  async function reverseCollection(collectionId, reason, options = {}) {
    const repo = repository();
    if (!repo) return { ok: false, message: "Repositorio financiero V2 no disponible." };
    const result = await repo.reverseCollection(collectionId, reason, options);
    if (!result.ok) return result;
    const entries = entityPayloads(result.records, "financial_journal_entries").map(normalizedJournal);
    return { ...result, collection: normalizedCollection(firstEntity(result, "financial_collections") || {}), entries };
  }

  async function reverseJournal(journalEntryId, reason, options = {}) {
    const repo = repository();
    if (!repo) return { ok: false, message: "Repositorio financiero V2 no disponible." };
    const result = await repo.reverseJournal(journalEntryId, reason, options);
    if (!result.ok) return result;
    const entries = entityPayloads(result.records, "financial_journal_entries").map(normalizedJournal);
    return { ...result, entry: entries.find(item => item.reverseOfId) || entries.at(-1), entries };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.financialV2 = Object.freeze({
    commercialProfitabilityReport: filters => repository()?.commercialProfitabilityReport(filters),
    collections: () => collections().map(normalizedCollection),
    collectionPayloadPreview,
    collectionTrace: () => repository()?.collectionTrace?.() || null,
    creditNotes: () => creditNotes(),
    financialReceivableForLegacy,
    journalEntries: () => journalEntries().map(normalizedJournal),
    normalizedCollection,
    normalizedJournal,
    normalizedReceivable,
    orderProfitability: orderId => repository()?.orderProfitability(orderId),
    postInvoice,
    postCreditNote,
    postJournal,
    receivables: () => receivables().map(normalizedReceivable),
    recordOrderCost: (payload, options) => repository()?.recordOrderCost(payload, options),
    recordShipmentExpense: (payload, options) => repository()?.recordShipmentExpense(payload, options),
    registerCollection,
    recordCollectionTrace: (stage, detail) => repository()?.recordCollectionTrace?.(stage, detail),
    startCollectionTrace: detail => repository()?.startCollectionTrace?.(detail),
    reverseCollection,
    reverseJournal,
    shipmentProfitability: shipmentId => repository()?.shipmentProfitability(shipmentId)
  });
})();
