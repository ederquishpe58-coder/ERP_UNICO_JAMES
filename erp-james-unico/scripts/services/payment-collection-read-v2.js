(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.paymentCollectionReadV2Repository;
  let timer = null;
  function bucket() { return { loading: false, loaded: false, items: [], total: 0, page: 1, pageSize: 25, appliedFilters: null }; }
  const runtime = {
    started: false, subscribed: false, activeRoute: "", error: "", onChange: null,
    payment: { lookup: bucket(), history: bucket(), detail: null },
    collection: { lookup: bucket(), history: bucket(), detail: null }
  };
  function normalizeLookup(kind, row = {}) {
    const companyId = String(row.companyId || row.company_id || repo()?.activeCompanyUuid?.() || "");
    if (kind === "payment") return {
      id: String(row.id || ""), companyId, source: row.source || "", providerId: row.providerId || row.provider_id || "",
      providerName: row.providerName || row.provider_name || "", providerRuc: row.providerRuc || row.provider_ruc || "",
      purchaseId: row.purchaseId || row.purchase_id || "", documentNumber: row.documentNumber || row.document_number || "",
      issueDate: row.issueDate || row.issue_date || "", dueDate: row.dueDate || row.due_date || "",
      balance: Number(row.balance || 0), retentionApplied: Number(row.retentionApplied ?? row.retention_applied ?? 0), advanceApplied: Number(row.advanceApplied ?? row.advance_applied ?? 0),
      state: row.state || "", canonicalStatus: row.canonicalStatus || row.canonical_status || ""
    };
    return {
      id: String(row.id || ""), companyId, source: row.source || "", customerId: row.customerId || row.customer_id || "",
      customerName: row.customerName || row.customer_name || "", customerTaxId: row.customerTaxId || row.customer_tax_id || "",
      documentNumber: row.documentNumber || row.document_number || "", concept: row.concept || row.documentType || row.document_type || "",
      issueDate: row.issueDate || row.issue_date || "", dueDate: row.dueDate || row.due_date || "",
      balance: Number(row.balance || 0), status: row.status || "", canonicalStatus: row.canonicalStatus || row.canonical_status || "",
      sourceId: row.sourceId || row.source_id || "", receivableAccountCode: row.receivableAccountCode || row.receivable_account_code || ""
    };
  }
  function normalizeHistory(kind, row = {}) {
    const common = {
      id: String(row.id || ""), source: row.source || "", date: row.date || "", number: row.number || "",
      partyId: row.partyId || row.party_id || "", partyName: row.partyName || row.party_name || "",
      partyTaxId: row.partyTaxId || row.party_tax_id || "", method: row.method || "", accountCode: row.accountCode || row.account_code || "",
      bankAccountId: row.bankAccountId || row.bank_account_id || "", reference: row.reference || "", total: Number(row.total || 0),
      status: row.status || "", journalEntryId: row.journalEntryId || row.journal_entry_id || "",
      treasuryTransactionId: row.treasuryTransactionId || row.treasury_transaction_id || "", applicationCount: Number(row.applicationCount ?? row.application_count ?? 0)
    };
    return kind === "payment" ? { ...common, providerId: common.partyId, providerName: common.partyName }
      : { ...common, customerId: common.partyId, customerName: common.partyName };
  }
  function snapshot() { return clone(runtime); }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend de pagos y cobros pendiente de actualización.");
    runtime.onChange?.();
    return snapshot();
  }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  async function query(kind, target, filters = {}, options = {}) {
    const state = runtime[kind][target];
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : state.pageSize;
    state.loading = true; runtime.error = "";
    try {
      const method = target === "lookup"
        ? (kind === "payment" ? "payableLookup" : "receivableLookup")
        : `${kind}History`;
      const result = await repo()?.[method]?.(filters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar.");
      state.items = (result.items || []).map(row => target === "lookup" ? normalizeLookup(kind, row) : normalizeHistory(kind, row));
      Object.assign(state, { loaded: true, total: Number(result.total || 0), page, pageSize, appliedFilters: clone(filters) });
      runtime.onChange?.();
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; }
    finally { state.loading = false; }
  }
  function queryLookup(kind, filters, options) { return query(kind, "lookup", filters, options); }
  function queryHistory(kind, filters, options) { return query(kind, "history", filters, options); }
  async function detail(kind, id, source) {
    const result = await repo()?.[`${kind}Detail`]?.(id, source);
    if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el detalle.");
    runtime[kind].detail = clone(result);
    runtime.onChange?.();
    return clone(result);
  }
  async function refresh(kind, target) {
    const state = runtime[kind][target];
    if (!state.loaded || !state.appliedFilters) return snapshot();
    return query(kind, target, state.appliedFilters, { page: state.page, pageSize: state.pageSize });
  }
  function scheduleRefresh(event = {}) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      const kind = String(event.table || "").startsWith("erp_supplier_") || event.new?.entity === "payments" || event.old?.entity === "payments" ? "payment" : "collection";
      if (route === "portfolios-payments-single" && kind === "payment") {
        if (runtime.payment.lookup.loaded) await refresh("payment", "lookup").catch(() => {});
        if (runtime.payment.history.loaded) await refresh("payment", "history").catch(() => {});
      }
      if (route === "portfolios-collections-single" && kind === "collection") {
        if (runtime.collection.lookup.loaded) await refresh("collection", "lookup").catch(() => {});
        if (runtime.collection.history.loaded) await refresh("collection", "history").catch(() => {});
      }
      runtime.onChange?.();
    }, 180);
  }
  async function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    runtime.activeRoute = "";
    runtime.onChange = null;
    if (runtime.subscribed) await repo()?.unsubscribe?.();
    runtime.subscribed = false;
    return snapshot();
  }
  BlessERP.services = BlessERP.services || {};
  BlessERP.services.paymentCollectionReadV2 = Object.freeze({ detail, queryHistory, queryLookup, refresh, setActiveRoute, snapshot, start, stop });
})();
