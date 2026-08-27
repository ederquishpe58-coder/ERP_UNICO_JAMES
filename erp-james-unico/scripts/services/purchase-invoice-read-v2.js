(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.purchaseInvoiceReadV2Repository;
  let realtimeTimer = null;
  const runtime = {
    started: false, subscribed: false, activeRoute: "", error: "", onChange: null,
    history: { loading: false, loaded: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null },
    detail: null, xml: null
  };

  function normalizeRow(row = {}) {
    return {
      ...clone(row), id: String(row.id || ""), source: row.source || "", canonical: row.canonical !== false,
      supplierId: row.supplierId || row.supplier_id || "", supplierName: row.supplierName || row.supplier_name || "",
      supplierRuc: row.supplierRuc || row.supplier_ruc || "", issueDate: row.issueDate || row.issue_date || "",
      accountingDate: row.accountingDate || row.accounting_date || "", documentType: row.documentType || row.document_type || "",
      documentNumber: row.documentNumber || row.document_number || "", authorizationSummary: row.authorizationSummary || row.authorization_summary || "",
      accessKeySummary: row.accessKeySummary || row.access_key_summary || "", subtotal: Number(row.subtotal || 0), iva: Number(row.iva ?? row.tax_total ?? 0),
      total: Number(row.total || 0), status: row.status || "", accountingStatus: row.accountingStatus || row.accounting_status || "",
      retentionStatus: row.retentionStatus || row.retention_status || "", payableId: row.payableId || row.payable_id || "",
      payableBalance: Number(row.payableBalance ?? row.payable_balance ?? 0), payableStatus: row.payableStatus || row.payable_status || "",
      journalEntryId: row.journalEntryId || row.journal_entry_id || "", journalEntryNumber: row.journalEntryNumber || row.journal_entry_number || "",
      lineCount: Number(row.lineCount ?? row.line_count ?? 0), sourceType: row.sourceType || row.source_type || "", updatedAt: row.updatedAt || row.updated_at || ""
    };
  }
  function snapshot() { return clone(runtime); }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend de facturas de compra pendiente de actualización.");
    runtime.onChange?.();
    return snapshot();
  }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  async function queryHistory(filters = {}, options = {}) {
    const state = runtime.history;
    if (state.loading && !options.force) return snapshot();
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : state.pageSize;
    state.loading = true; runtime.error = "";
    try {
      const result = await repo()?.historyPage?.(filters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar las facturas de compra.");
      Object.assign(state, {
        items: (result.items || []).map(normalizeRow), total: Number(result.total || 0), summary: clone(result.summary || {}),
        loaded: true, page, pageSize, appliedFilters: clone(filters)
      });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; }
    finally { state.loading = false; }
  }
  async function loadDetail(id, source) {
    const result = await repo()?.detail?.(id, source);
    if (!result?.ok) throw new Error(result?.message || "No se pudo cargar la factura de compra.");
    runtime.detail = clone(result);
    runtime.onChange?.();
    return clone(result);
  }
  async function loadXml(id, source) {
    const result = await repo()?.xml?.(id, source);
    if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el XML de la compra.");
    runtime.xml = clone(result);
    runtime.onChange?.();
    return clone(result);
  }
  function closeDetail() { runtime.detail = null; runtime.xml = null; runtime.onChange?.(); }
  async function exportAll(filters) {
    const items = [];
    let offset = 0;
    let total = 0;
    do {
      const result = await repo()?.historyPage?.(filters, { limit: 50, offset });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la exportación de compras.");
      const page = (result.items || []).map(normalizeRow);
      total = Number(result.total || 0); items.push(...page); offset += page.length;
      if (!page.length) break;
    } while (offset < total);
    return { items, total };
  }
  async function refresh() {
    const state = runtime.history;
    if (!state.loaded || !state.appliedFilters) return snapshot();
    return queryHistory(state.appliedFilters, { force: true, page: state.page, pageSize: state.pageSize });
  }
  function detailAffected(event = {}) {
    const purchase = runtime.detail?.purchase;
    if (!purchase) return false;
    const record = event.new || event.old || {};
    const table = String(event.table || "");
    const purchaseId = String(purchase.id || purchase.purchaseDocumentId || "");
    if (table === "erp_entity_records") return String(record.record_id || "") === purchaseId;
    if (String(record.purchase_document_id || "") === purchaseId) return true;
    if (table === "erp_supplier_accounts_payable") return String(record.payable_id || "") === String(purchase.payableId || "");
    if (table === "electronic_documents") return String(record.id || "") === String(runtime.detail?.retention?.document?.id || "");
    return false;
  }
  function scheduleRefresh(event = {}) {
    if (String(event.table || "") === "electronic_documents") {
      const record = event.new || event.old || {};
      if (String(record.document_type || "") !== "07") return;
    }
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      if (route !== "purchases-invoices" || !runtime.history.loaded) return;
      await refresh().catch(() => {});
      if (detailAffected(event)) {
        const purchase = runtime.detail?.purchase || {};
        const result = await repo()?.detail?.(purchase.id || purchase.purchaseDocumentId, runtime.detail?.source || purchase.sourceKind);
        if (result?.ok) runtime.detail = clone(result);
      }
      runtime.onChange?.();
    }, 180);
  }
  function purchaseFromDetail(result = {}) {
    const item = clone(result.purchase || result.item || {});
    return BlessERP.services?.purchases?.normalizePurchase?.(item) || item;
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
  BlessERP.services.purchaseInvoiceReadV2 = Object.freeze({
    closeDetail, exportAll, loadDetail, loadXml, purchaseFromDetail, queryHistory, refresh, setActiveRoute, snapshot, start, stop
  });
})();
