(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.portfolioReadV2Repository;
  let realtimeTimer = null;

  function bucket() { return { loading: false, loaded: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null }; }
  const runtime = {
    started: false, subscribed: false, activeRoute: "", error: "", onChange: null,
    ap: { view: "OPERATIVE", open: bucket(), history: bucket(), detail: null },
    ar: { view: "OPERATIVE", open: bucket(), history: bucket(), detail: null }
  };
  function normalizeSummary(value = {}) {
    return Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, typeof item === "string" && /^-?\d+(\.\d+)?$/.test(item) ? Number(item) : item]));
  }
  function normalizeRow(kind, row = {}) {
    const companyId = String(row.companyId || row.company_id || repo()?.activeCompanyUuid?.() || "");
    if (kind === "ap") return {
      ...clone(row), id: String(row.id || ""), companyId, source: row.source || "", providerId: row.providerId || row.provider_id || "",
      providerCode: row.providerCode || row.provider_code || "", providerName: row.providerName || row.provider_name || "",
      providerRuc: row.providerRuc || row.provider_ruc || "", purchaseId: row.purchaseId || row.purchase_id || "",
      documentNumber: row.documentNumber || row.document_number || "", issueDate: row.issueDate || row.issue_date || "",
      dueDate: row.dueDate || row.due_date || "", totalDocument: Number(row.totalDocument ?? row.total_document ?? row.total ?? 0),
      balance: Number(row.balance || 0), paid: Number(row.paid || 0), retentionApplied: Number(row.retentionApplied ?? row.retention_applied ?? 0),
      advanceApplied: Number(row.advanceApplied ?? row.advance_applied ?? 0), state: row.state || "", canonicalStatus: row.canonicalStatus || row.canonical_status || "",
      journalEntryId: row.journalEntryId || row.journal_entry_id || "", updatedAt: row.updatedAt || row.updated_at || "", version: Number(row.version || 0)
    };
    return {
      ...clone(row), id: String(row.id || ""), companyId, source: row.source || "", customerId: row.customerId || row.customer_id || "",
      customerName: row.customerName || row.customer_name || "", customerTaxId: row.customerTaxId || row.customer_tax_id || "",
      sourceId: row.sourceId || row.source_id || "", documentType: row.documentType || row.document_type || "",
      documentNumber: row.documentNumber || row.document_number || "", issueDate: row.issueDate || row.issue_date || "", dueDate: row.dueDate || row.due_date || "",
      total: Number(row.total || 0), credited: Number(row.credited || 0), collected: Number(row.collected || 0), withheld: Number(row.withheld || 0),
      balance: Number(row.balance || 0), status: row.status || "", canonicalStatus: row.canonicalStatus || row.canonical_status || "",
      journalEntryId: row.journalEntryId || row.journal_entry_id || "", updatedAt: row.updatedAt || row.updated_at || "", version: Number(row.version || 0)
    };
  }
  function normalizePage(kind, result) {
    return { items: (result.items || []).map(row => normalizeRow(kind, row)), total: Number(result.total || 0), summary: normalizeSummary(result.summary || {}) };
  }
  function snapshot() { return clone(runtime); }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend de cartera pendiente de actualización.");
    runtime.onChange?.();
    return snapshot();
  }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  function setView(kind, view) { runtime[kind].view = view === "HISTORY" ? "HISTORY" : "OPERATIVE"; }
  async function query(kind, target, filters = {}, options = {}) {
    const state = runtime[kind][target];
    if (state.loading && !options.force) return snapshot();
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : state.pageSize;
    state.loading = true; runtime.error = "";
    try {
      const method = `${kind}${target === "open" ? "Open" : "History"}`;
      const result = await repo()?.[method]?.(filters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la cartera.");
      Object.assign(state, normalizePage(kind, result), { loaded: true, page, pageSize, appliedFilters: clone(filters) });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; }
    finally { state.loading = false; }
  }
  function queryOpen(kind, filters, options) { return query(kind, "open", filters, options); }
  function queryHistory(kind, filters, options) { return query(kind, "history", filters, options); }
  async function detail(kind, id, source) {
    const result = await repo()?.[`${kind}Detail`]?.(id, source);
    if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el detalle.");
    runtime[kind].detail = clone(result);
    runtime.onChange?.();
    return clone(result);
  }
  async function exportAll(kind, target, filters) {
    const method = `${kind}${target === "history" ? "History" : "Open"}`;
    const items = [];
    let offset = 0;
    let total = 0;
    do {
      const result = await repo()?.[method]?.(filters, { limit: 50, offset });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la exportación de cartera.");
      const page = normalizePage(kind, result);
      total = page.total;
      items.push(...page.items);
      offset += page.items.length;
      if (!page.items.length) break;
    } while (offset < total);
    return { items, total };
  }
  function row(kind, id) {
    return [...runtime[kind].open.items, ...runtime[kind].history.items].find(item => String(item.id) === String(id)) || null;
  }
  async function refreshKind(kind) {
    const state = runtime[kind];
    const target = state.view === "HISTORY" ? state.history : state.open;
    if (!target.loaded || !target.appliedFilters) return snapshot();
    return query(kind, state.view === "HISTORY" ? "history" : "open", target.appliedFilters, { force: true, page: target.page, pageSize: target.pageSize });
  }
  function realtimeKind(event = {}) {
    const table = String(event.table || "");
    const entity = String(event.new?.entity || event.old?.entity || "");
    if (table.startsWith("erp_supplier_") || ["purchase_payables", "payments", "payment_batches"].includes(entity)) return "ap";
    if (table.startsWith("erp_financial_") || ["customer_receivables", "collections", "collection_batches", "received_withholdings"].includes(entity)) return "ar";
    return "";
  }
  function scheduleRefresh(event) {
    const affectedKind = realtimeKind(event);
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      if (route === "portfolios-ap" && (!affectedKind || affectedKind === "ap")) await refreshKind("ap").catch(() => {});
      if (route === "portfolios-ar" && (!affectedKind || affectedKind === "ar")) await refreshKind("ar").catch(() => {});
      runtime.onChange?.();
    }, 180);
  }
  async function stop() {
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = null;
    runtime.activeRoute = "";
    runtime.onChange = null;
    if (runtime.subscribed) await repo()?.unsubscribe?.();
    runtime.subscribed = false;
    return snapshot();
  }
  BlessERP.services = BlessERP.services || {};
  BlessERP.services.portfolioReadV2 = Object.freeze({ detail, exportAll, queryHistory, queryOpen, refreshKind, row, setActiveRoute, setView, snapshot, start, stop });
})();
