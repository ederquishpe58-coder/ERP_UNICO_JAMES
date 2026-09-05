(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.treasuryReadV2Repository;
  let realtimeTimer = null;
  const suppressedTransferOperations = new Map();
  const runtime = {
    started: false, transfersStarted: false, subscribed: false, activeRoute: "", error: "", transferError: "", onChange: null,
    movements: { loading: false, loaded: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null },
    history: { loading: false, loaded: false, items: [], total: 0, page: 1, pageSize: 25, appliedFilters: null },
    workspace: { loading: false, loaded: false, filters: null, data: null },
    transfers: { loading: false, loaded: false, items: [], total: 0, page: 1, pageSize: 25, appliedFilters: null, detail: null }
  };
  let scopedCompany = "";
  function snapshot() {
    const company = String(BlessERP.authAccess?.activeAccess?.()?.activeCompany?.id || "");
    if (company !== scopedCompany) {
      scopedCompany = company;
      for (const key of ["movements", "history", "transfers"]) Object.assign(runtime[key], { loaded:false,loading:false,items:[],total:0,summary:{},page:1,appliedFilters:null,detail:null });
      runtime.workspace = { loading:false,loaded:false,filters:null,data:null };
      runtime.started = false; runtime.transfersStarted = false; runtime.error = ""; runtime.transferError = "";
    }
    return clone(runtime);
  }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (!runtime.started) {
      runtime.started = true;
      const health = await repo()?.probeBackend?.();
      runtime.error = health?.ok ? "" : (health?.message || "Backend search-first de Tesorería no disponible.");
      runtime.onChange?.();
    }
    return snapshot();
  }
  async function startTransfers(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (!runtime.transfersStarted) {
      runtime.transfersStarted = true;
      const health = await repo()?.probeTransfersBackend?.();
      runtime.transferError = health?.ok ? "" : (health?.message || "Backend search-first de transferencias no disponible.");
      runtime.onChange?.();
    }
    return snapshot();
  }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  async function queryMovements(filters, options = {}) {
    const appliedFilters = clone(filters || runtime.movements.appliedFilters || {});
    if (!appliedFilters.bankAccountId) throw new Error("Selecciona una cuenta bancaria antes de consultar.");
    if (!appliedFilters.dateFrom || !appliedFilters.dateTo) throw new Error("Define el rango Desde/Hasta.");
    const page = Math.max(1, Number(options.page || 1)); const pageSize = [25,50].includes(Number(options.pageSize)) ? Number(options.pageSize) : 25;
    runtime.movements.loading = true; runtime.error = "";
    try {
      const result = await repo()?.movementsPage?.(appliedFilters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudieron consultar los movimientos.");
      Object.assign(runtime.movements, { loaded: true, items: result.items || [], total: Number(result.total || 0), summary: result.summary || {}, page, pageSize, appliedFilters });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; } finally { runtime.movements.loading = false; }
  }
  async function queryHistory(filters, options = {}) {
    const appliedFilters = clone(filters || runtime.history.appliedFilters || {});
    const page = Math.max(1, Number(options.page || 1)); const pageSize = [25,50].includes(Number(options.pageSize)) ? Number(options.pageSize) : 25;
    runtime.history.loading = true; runtime.error = "";
    try {
      const result = await repo()?.reconciliationHistoryPage?.(appliedFilters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar el historial de conciliaciones.");
      Object.assign(runtime.history, { loaded: true, items: result.items || [], total: Number(result.total || 0), page, pageSize, appliedFilters });
      return snapshot();
    } catch (error) { runtime.error = error.message; throw error; } finally { runtime.history.loading = false; }
  }
  async function loadWorkspace(filters) {
    if (!filters?.bankAccountId || !filters?.dateFrom || !filters?.dateTo) throw new Error("Selecciona cuenta y período antes de cargar la conciliación.");
    runtime.workspace.loading = true; runtime.error = "";
    try {
      const result = await repo()?.reconciliationWorkspace?.({ ...filters, limit: 50 });
      if (!result?.ok) throw new Error(result?.message || "No se pudo cargar la conciliación.");
      runtime.workspace = { loading: false, loaded: true, filters: clone(filters), data: clone(result) };
      return snapshot();
    } catch (error) { runtime.error = error.message; runtime.workspace.loading = false; throw error; }
  }
  async function loadDetail(id) {
    runtime.workspace.loading = true;
    try {
      const result = await repo()?.reconciliationDetail?.(id);
      if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el detalle de conciliación.");
      const reconciliation = result.reconciliation || {};
      runtime.workspace = { loading: false, loaded: true, filters: {
        bankAccountId: reconciliation.bank_account_id || "",
        dateFrom: reconciliation.period_start || "",
        dateTo: reconciliation.period_end || "",
        reconciliationId: reconciliation.reconciliation_id || id
      }, data: clone(result) };
      return snapshot();
    } finally { runtime.workspace.loading = false; }
  }
  async function queryTransfers(filters, options = {}) {
    const appliedFilters = clone(filters || runtime.transfers.appliedFilters || {});
    if (!appliedFilters.dateFrom || !appliedFilters.dateTo) throw new Error("Define el rango Desde/Hasta antes de consultar.");
    if (appliedFilters.dateFrom > appliedFilters.dateTo) throw new Error("La fecha Desde no puede ser posterior a Hasta.");
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25,50].includes(Number(options.pageSize)) ? Number(options.pageSize) : 25;
    runtime.transfers.loading = true; runtime.transferError = "";
    try {
      const result = await repo()?.transferHistoryPage?.(appliedFilters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar el historial de transferencias.");
      Object.assign(runtime.transfers, { loaded: true, items: result.items || [], total: Number(result.total || 0), page, pageSize, appliedFilters });
      return snapshot();
    } catch (error) { runtime.transferError = error.message; throw error; } finally { runtime.transfers.loading = false; }
  }
  async function loadTransferDetail(id) {
    runtime.transfers.loading = true; runtime.transferError = "";
    try {
      const result = await repo()?.transferDetail?.(id);
      if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el detalle de la transferencia.");
      runtime.transfers.detail = clone(result);
      return snapshot();
    } catch (error) { runtime.transferError = error.message; throw error; } finally { runtime.transfers.loading = false; }
  }
  function closeTransferDetail() { runtime.transfers.detail = null; }
  function suppressTransferOperation(operationId, ttlMs = 1500) {
    const id = String(operationId || "").trim();
    if (id) suppressedTransferOperations.set(id, Date.now() + Math.max(250, Number(ttlMs || 1500)));
  }
  function invalidateWorkspace() { runtime.workspace = { loading: false, loaded: false, filters: null, data: null }; }
  async function refreshActive() {
    if (runtime.activeRoute === "banks-movements" && runtime.movements.loaded) return queryMovements(runtime.movements.appliedFilters, { page: runtime.movements.page, pageSize: runtime.movements.pageSize });
    if (runtime.activeRoute === "banks-reconciliation") {
      if (runtime.workspace.loaded && runtime.workspace.filters) return loadWorkspace(runtime.workspace.filters);
      if (runtime.history.loaded) return queryHistory(runtime.history.appliedFilters, { page: runtime.history.page, pageSize: runtime.history.pageSize });
    }
    if (runtime.activeRoute === "banks-transfers" && runtime.transfers.loaded) {
      const state = runtime.transfers;
      const refreshed = await queryTransfers(state.appliedFilters, { page: state.page, pageSize: state.pageSize });
      const detailId = state.detail?.transfer?.transfer_id || state.detail?.transfer?.transferId || state.detail?.transfer?.id;
      if (detailId) await loadTransferDetail(detailId);
      return detailId ? snapshot() : refreshed;
    }
    return snapshot();
  }
  function scheduleRefresh(event = {}) {
    if (runtime.activeRoute === "banks-transfers") {
      if (!runtime.transfers.loaded) return;
      const transferId = event?.new?.transfer_id || event?.old?.transfer_id || event?.new?.transferId || event?.old?.transferId;
      const operationId = String(event?.new?.last_operation_id || event?.old?.last_operation_id || event?.new?.lastOperationId || event?.old?.lastOperationId || "");
      for (const [id,expiresAt] of suppressedTransferOperations) if (expiresAt <= Date.now()) suppressedTransferOperations.delete(id);
      if (operationId && suppressedTransferOperations.has(operationId)) return;
      if (event?.table !== "erp_treasury_transfers" && !transferId) return;
    }
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => { realtimeTimer = null; try { await refreshActive(); } catch (_) {} runtime.onChange?.(); }, 180);
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
  BlessERP.services.treasuryReadV2 = Object.freeze({
    closeTransferDetail,
    invalidateWorkspace,
    loadDetail,
    loadTransferDetail,
    loadWorkspace,
    queryHistory,
    queryMovements,
    queryTransfers,
    refreshActive,
    setActiveRoute,
    snapshot,
    start,
    startTransfers,
    stop,
    suppressTransferOperation
  });
})();
