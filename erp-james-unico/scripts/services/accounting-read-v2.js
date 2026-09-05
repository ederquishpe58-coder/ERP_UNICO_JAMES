(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repository = () => BlessERP.accountingReadV2Repository;
  let realtimeTimer = null;

  const runtime = {
    started: false,
    subscribed: false,
    activeRoute: "",
    error: "",
    onChange: null,
    journal: {
      loading: false, loaded: false, items: [], total: 0, summary: {},
      page: 1, pageSize: 25, appliedFilters: null, detailLoading: false
    },
    ledger: {
      loading: false, loaded: false, items: [], total: 0, summary: {}, account: null,
      page: 1, pageSize: 25, appliedFilters: null
    }
  };

  function normalizeJournalRow(row = {}) {
    return {
      entryKey: String(row.entry_key || row.entryKey || ""),
      sourceKind: String(row.source_kind || row.sourceKind || ""),
      entryNumber: row.entry_number || row.entryNumber || "",
      accountingDate: row.accounting_date || row.accountingDate || "",
      accountingPeriod: row.accounting_period || row.accountingPeriod || "",
      concept: row.concept || "",
      originModule: row.origin_module || row.originModule || "",
      sourceType: row.source_type || row.sourceType || "",
      sourceDocument: row.source_document || row.sourceDocument || "",
      externalReference: row.external_reference || row.externalReference || "",
      status: row.status || "",
      totalDebit: Number(row.total_debit ?? row.totalDebit ?? 0),
      totalCredit: Number(row.total_credit ?? row.totalCredit ?? 0),
      difference: Number(row.difference || 0),
      lineCount: Number(row.line_count ?? row.lineCount ?? 0),
      actorId: row.actor_id || row.actorId || "",
      createdAt: row.created_at || row.createdAt || "",
      version: Number(row.version || 0)
    };
  }

  function normalizeSummary(summary = {}) {
    return Object.fromEntries(Object.entries(summary || {}).map(([key, value]) => {
      const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      return [camel, typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value];
    }));
  }

  function normalizeLedgerRow(row = {}) {
    return {
      entryKey: row.entryKey || row.entry_key || "",
      sourceKind: row.sourceKind || row.source_kind || "",
      lineNumber: Number(row.lineNumber ?? row.line_number ?? 0),
      date: row.date || row.movement_date || "",
      entryNumber: row.entryNumber || row.entry_number || "",
      concept: row.concept || "",
      originModule: row.originModule || row.origin_module || "",
      sourceDocument: row.sourceDocument || row.source_document || "",
      externalReference: row.externalReference || row.external_reference || "",
      status: row.status || "",
      debit: Number(row.debit || 0),
      credit: Number(row.credit || 0),
      balance: Number(row.balance || 0),
      costCenter: row.costCenter || row.cost_center || "",
      auxiliary: row.auxiliary || "",
      description: row.description || "",
      documentReference: row.documentReference || row.document_reference || ""
    };
  }

  function snapshot() { return clone(runtime); }

  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) {
      repository()?.subscribe?.(scheduleRealtimeRefresh);
      runtime.subscribed = true;
    }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repository()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend search-first contable no disponible.");
    runtime.onChange?.();
    return snapshot();
  }

  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }

  async function queryJournal(filters, options = {}) {
    if (runtime.journal.loading && !options.force) return snapshot();
    const appliedFilters = clone(filters || runtime.journal.appliedFilters || {});
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : runtime.journal.pageSize;
    runtime.journal.loading = true;
    runtime.error = "";
    try {
      const result = await repository()?.journalPage?.(appliedFilters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar el Libro Diario.");
      Object.assign(runtime.journal, {
        loaded: true,
        items: (result.items || []).map(normalizeJournalRow),
        total: Number(result.total || 0),
        summary: normalizeSummary(result.summary || {}),
        page,
        pageSize,
        appliedFilters
      });
      return snapshot();
    } catch (error) {
      runtime.error = error.message;
      throw error;
    } finally {
      runtime.journal.loading = false;
    }
  }

  async function journalDetail(entryKey, sourceKind) {
    runtime.journal.detailLoading = true;
    runtime.error = "";
    try {
      const result = await repository()?.journalDetail?.(entryKey, sourceKind);
      if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el asiento.");
      return clone(result.entry || {});
    } finally {
      runtime.journal.detailLoading = false;
    }
  }

  async function queryLedger(filters, options = {}) {
    const appliedFilters = clone(filters || runtime.ledger.appliedFilters || {});
    if (!appliedFilters.accountRecordId) throw new Error("Selecciona una cuenta contable antes de consultar.");
    if (runtime.ledger.loading && !options.force) return snapshot();
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : runtime.ledger.pageSize;
    runtime.ledger.loading = true;
    runtime.error = "";
    try {
      const result = await repository()?.ledgerPage?.(appliedFilters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar el Mayor General.");
      Object.assign(runtime.ledger, {
        loaded: true,
        items: (result.items || []).map(normalizeLedgerRow),
        total: Number(result.total || 0),
        summary: normalizeSummary(result.summary || {}),
        account: clone(result.account || null),
        page,
        pageSize,
        appliedFilters
      });
      return snapshot();
    } catch (error) {
      runtime.error = error.message;
      throw error;
    } finally {
      runtime.ledger.loading = false;
    }
  }

  async function refreshActive() {
    const currentRouteId = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
    if (currentRouteId !== runtime.activeRoute) return snapshot();
    if (runtime.activeRoute === "accounting-journal" && runtime.journal.loaded && runtime.journal.appliedFilters) {
      return queryJournal(runtime.journal.appliedFilters, { force: true, page: runtime.journal.page, pageSize: runtime.journal.pageSize });
    }
    if (runtime.activeRoute === "accounting-ledger" && runtime.ledger.loaded && runtime.ledger.appliedFilters) {
      return queryLedger(runtime.ledger.appliedFilters, { force: true, page: runtime.ledger.page, pageSize: runtime.ledger.pageSize });
    }
    return snapshot();
  }

  function scheduleRealtimeRefresh() {
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      try { await refreshActive(); } catch (_) { /* error visible through runtime */ }
      runtime.onChange?.();
    }, 180);
  }

  async function stop() {
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = null;
    runtime.activeRoute = "";
    runtime.onChange = null;
    if (runtime.subscribed) await repository()?.unsubscribe?.();
    runtime.subscribed = false;
    return snapshot();
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.accountingReadV2 = Object.freeze({
    journalDetail,
    queryJournal,
    queryLedger,
    refreshActive,
    setActiveRoute,
    snapshot,
    start,
    stop
  });
})();
