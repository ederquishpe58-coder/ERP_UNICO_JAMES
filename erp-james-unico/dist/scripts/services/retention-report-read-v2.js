(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const repo = () => BlessERP.retentionReportReadV2Repository;
  let realtimeTimer = null;
  const runtime = {
    started: false,
    subscribed: false,
    activeRoute: "",
    error: "",
    onChange: null,
    page: { loading: false, loaded: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, appliedFilters: null },
    detail: null
  };

  const number = value => Number(value || 0);
  const round2 = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  function normalizeRow(row = {}) {
    return {
      ...clone(row),
      type: String(row.type || ""),
      retentionId: String(row.retentionId || row.retention_id || ""),
      lineId: String(row.lineId || row.line_id || ""),
      date: row.date || row.retention_date || "",
      thirdPartyId: String(row.thirdPartyId || row.third_party_id || ""),
      thirdPartyName: row.thirdPartyName || row.third_party_name || "",
      thirdPartyTaxId: row.thirdPartyTaxId || row.third_party_tax_id || "",
      originDocumentId: String(row.originDocumentId || row.origin_document_id || ""),
      originDocumentNumber: row.originDocumentNumber || row.origin_document_number || "",
      retentionNumber: row.retentionNumber || row.retention_number || "",
      taxType: row.taxType || row.tax_type || "",
      retentionCode: row.retentionCode || row.retention_code || "",
      percentage: number(row.percentage),
      taxableBase: number(row.taxableBase ?? row.taxable_base),
      retainedAmount: number(row.retainedAmount ?? row.retained_amount),
      status: row.status || "",
      authorizationNumber: row.authorizationNumber || row.authorization_number || "",
      accessKey: row.accessKey || row.access_key || "",
      journalEntryId: row.journalEntryId || row.journal_entry_id || "",
      journalEntryNumber: row.journalEntryNumber || row.journal_entry_number || ""
    };
  }
  function snapshot() { return clone(runtime); }
  async function start(onChange) {
    runtime.onChange = onChange || runtime.onChange;
    if (!runtime.subscribed) { repo()?.subscribe?.(scheduleRefresh); runtime.subscribed = true; }
    if (runtime.started) return snapshot();
    runtime.started = true;
    const health = await repo()?.probeBackend?.();
    runtime.error = health?.ok ? "" : (health?.message || "Backend del reporte de retenciones pendiente de actualización.");
    runtime.onChange?.();
    return snapshot();
  }
  function setActiveRoute(route) { runtime.activeRoute = String(route || ""); }
  async function query(filters = {}, options = {}) {
    const state = runtime.page;
    if (state.loading && !options.force) return snapshot();
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = [25, 50].includes(Number(options.pageSize)) ? Number(options.pageSize) : state.pageSize;
    state.loading = true;
    runtime.error = "";
    try {
      const result = await repo()?.page?.(filters, { limit: pageSize, offset: (page - 1) * pageSize });
      if (!result?.ok) throw new Error(result?.message || "No se pudo generar el reporte de retenciones.");
      Object.assign(state, {
        items: (result.items || []).map(normalizeRow),
        total: Number(result.total || 0),
        summary: clone(result.summary || {}),
        loaded: true,
        page,
        pageSize,
        appliedFilters: clone(filters)
      });
      return snapshot();
    } catch (error) {
      runtime.error = error.message;
      throw error;
    } finally {
      state.loading = false;
    }
  }
  async function loadDetail(row) {
    if (!row?.retentionId) throw new Error("No se pudo identificar la retención seleccionada.");
    const result = row.source === "LEGACY_ISSUED_HISTORY"
      ? await repo()?.legacyIssuedDetail?.(row)
      : row.type === "ISSUED" ? await repo()?.issuedDetail?.(row) : await repo()?.receivedDetail?.(row);
    if (!result?.ok) throw new Error(result?.message || "No se pudo cargar el detalle de la retención.");
    runtime.detail = { type: row.type, row: clone(row), data: clone(result) };
    runtime.onChange?.();
    return clone(runtime.detail);
  }
  function closeDetail() { runtime.detail = null; runtime.onChange?.(); }
  function summarize(items = []) {
    const documents = new Set(items.map(item => `${item.type}:${item.retentionId}`));
    const issued = new Set(items.filter(item => item.type === "ISSUED").map(item => item.retentionId));
    const received = new Set(items.filter(item => item.type === "RECEIVED").map(item => item.retentionId));
    return {
      rowCount: items.length,
      documentCount: documents.size,
      issuedDocuments: issued.size,
      receivedDocuments: received.size,
      taxableBase: round2(items.reduce((sum, item) => sum + item.taxableBase, 0)),
      rentRetained: round2(items.filter(item => item.taxType === "RENTA").reduce((sum, item) => sum + item.retainedAmount, 0)),
      vatRetained: round2(items.filter(item => item.taxType === "IVA").reduce((sum, item) => sum + item.retainedAmount, 0)),
      totalRetained: round2(items.reduce((sum, item) => sum + item.retainedAmount, 0))
    };
  }
  function sameMoney(left, right) { return Math.abs(round2(left) - round2(right)) < 0.01; }
  function validateExport(items, total, summary = {}) {
    const calculated = summarize(items);
    const errors = [];
    if (items.length !== Number(total || 0)) errors.push("El número de filas exportadas no coincide con la consulta.");
    if (calculated.documentCount !== Number(summary.documentCount || 0)) errors.push("El número de comprobantes no coincide con el resumen.");
    if (!sameMoney(calculated.taxableBase, summary.taxableBase)) errors.push("La base imponible exportada no coincide.");
    if (!sameMoney(calculated.rentRetained, summary.rentRetained)) errors.push("La retención IR exportada no coincide.");
    if (!sameMoney(calculated.vatRetained, summary.vatRetained)) errors.push("La retención IVA exportada no coincide.");
    if (!sameMoney(calculated.totalRetained, summary.totalRetained)) errors.push("El total retenido exportado no coincide.");
    return { ok: errors.length === 0, errors, calculated };
  }
  async function exportApplied() {
    const state = runtime.page;
    if (!state.loaded || !state.appliedFilters) throw new Error("Primero genera el reporte que deseas exportar.");
    const items = [];
    let offset = 0;
    let total = Number(state.total || 0);
    do {
      const result = await repo()?.page?.(state.appliedFilters, { limit: 50, offset });
      if (!result?.ok) throw new Error(result?.message || "No se pudo consultar la exportación.");
      const page = (result.items || []).map(normalizeRow);
      total = Number(result.total || 0);
      items.push(...page);
      offset += page.length;
      if (!page.length) break;
    } while (offset < total);
    const validation = validateExport(items, total, state.summary);
    if (!validation.ok) throw new Error(`La exportación no coincide con el reporte consultado: ${validation.errors.join(" ")}`);
    return { items, total, summary: clone(state.summary), filters: clone(state.appliedFilters), validation };
  }
  async function refresh() {
    const state = runtime.page;
    if (!state.loaded || !state.appliedFilters) return snapshot();
    return query(state.appliedFilters, { force: true, page: state.page, pageSize: state.pageSize });
  }
  function eventRelevant(event = {}) {
    const record = event.new || event.old || {};
    if (event.table === "electronic_documents") return String(record.document_type || "") === "07";
    if (event.table === "erp_entity_records") return String(record.entity || "") === "received_withholdings";
    return event.table === "erp_supplier_purchase_withholding_links";
  }
  function scheduleRefresh(event = {}) {
    if (!eventRelevant(event) || !runtime.page.loaded || !runtime.page.appliedFilters) return;
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(async () => {
      realtimeTimer = null;
      const route = BlessERP.state?.currentRoute?.()?.id || runtime.activeRoute;
      if (route !== "purchases-retention-report" || !runtime.page.loaded) return;
      await refresh().catch(() => {});
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
  BlessERP.services.retentionReportReadV2 = Object.freeze({
    closeDetail, exportApplied, loadDetail, query, refresh, setActiveRoute, snapshot, start, stop, validateExport
  });
})();
