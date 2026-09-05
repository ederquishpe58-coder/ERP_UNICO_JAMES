(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const today = BlessERP.utils.today();
  const ui = {
    draftFilters: { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today, type: "ALL", status: "", supplierId: "", customerId: "", retentionCode: "", retentionNumber: "", documentNumber: "", search: "" },
    pageSize: 25, message: "", errors: [], exporting: false
  };
  const service = () => BlessERP.services.retentionReportReadV2;
  const totalBy = (rows, key) => Math.round((rows.reduce((sum, item) => sum + Number(item[key] || 0), 0) + Number.EPSILON) * 100) / 100;

  function providers() {
    return (BlessERP.services.purchases?.providers?.() || []).filter(item => !["INACTIVO", "INACTIVE"].includes(String(item.status || item.state || "ACTIVO").toUpperCase()));
  }
  function customers() {
    const db = BlessERP.state?.state?.db || {};
    const rows = [...(db.customers || []), ...(db.commercial?.customerCatalog || [])];
    const byId = new Map();
    rows.forEach(item => {
      const id = String(item.id || item.recordId || item.record_id || "").trim();
      if (!id || byId.has(id)) return;
      const active = !["INACTIVO", "INACTIVE"].includes(String(item.status || item.state || "ACTIVO").toUpperCase());
      if (active) byId.set(id, { id, name: item.name || item.legalName || item.businessName || item.commercialName || "Cliente", taxId: item.taxId || item.identification || item.ruc || "" });
    });
    return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  }
  function badge(status) {
    const value = String(status || "").toLowerCase();
    const css = value.includes("anulado") || value.includes("error") ? "cancelled"
      : value.includes("borrador") || value.includes("pendiente") ? "pending"
        : value.includes("autoriz") || value.includes("aplicado") ? "authorized" : "partial";
    return `<span class="status-badge ${css}">${esc(status || "-")}</span>`;
  }
  function workbook(rows, filters = {}) {
    const api = BlessERP.operacionesRamosReportXlsx;
    if (!api?.buildWorkbookArchive) return { ok: false, message: "El generador XLSX de JAEDER SYSTEMS no está disponible." };
    const sheet = {
      name: "Retenciones", title: "BLESS FLOWER - REPORTE DE RETENCIONES",
      widths: [14, 14, 34, 18, 22, 22, 14, 16, 14, 16, 16, 18, 18, 52],
      headers: ["Tipo", "Fecha", "Tercero", "Identificación", "Documento origen", "Número retención", "Impuesto", "Código", "Porcentaje", "Base", "Valor retenido", "Estado", "Asiento", "Clave de acceso"],
      rows: rows.map(item => [item.type === "ISSUED" ? "EMITIDA" : "RECIBIDA", item.date || "", item.thirdPartyName || "", item.thirdPartyTaxId || "",
        item.originDocumentNumber || "", item.retentionNumber || "", item.taxType || "", item.retentionCode || "", Number(item.percentage || 0), Number(item.taxableBase || 0),
        Number(item.retainedAmount || 0), item.status || "", item.journalEntryNumber || "", item.accessKey || ""]),
      totals: ["TOTALES", "", "", "", "", "", "", "", "", totalBy(rows, "taxableBase"), totalBy(rows, "retainedAmount"), "", "", ""]
    };
    const report = { period: `${filters.dateFrom || ""} a ${filters.dateTo || ""}`, range: `${rows.length} línea(s) · Una fila por código · Mismos filtros aplicados en pantalla` };
    return { ok: true, archive: api.buildWorkbookArchive([sheet], report), sheet, report, fileName: `reporte-retenciones-${filters.dateFrom || "desde"}-${filters.dateTo || "hasta"}.xlsx` };
  }
  function download(result) {
    const prepared = workbook(result.items, result.filters);
    if (!prepared.ok) throw new Error(prepared.message);
    const blob = new Blob([prepared.archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = prepared.fileName; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    return prepared;
  }
  function renderDetail(detail) {
    if (!detail?.data) return "";
    const row = detail.row || {};
    const legacyIssued = detail.row?.source === "LEGACY_ISSUED_HISTORY";
    const source = detail.type === "ISSUED" && !legacyIssued ? (detail.data.document || {}) : (detail.data.item || {});
    const lines = detail.type === "ISSUED" && !legacyIssued
      ? (source.source_snapshot?.withholding?.supportingDocuments || []).flatMap(item => item.retentions || [])
      : (source.retentionLines || source.lines || []);
    return `<section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">DETALLE LAZY</p><h3>${esc(row.retentionNumber || "Retención")}</h3></div><button class="secondary-button" type="button" data-retention-report-detail-close>Cerrar</button></div>
      <div class="summary-grid"><article class="summary-card"><span>Tipo</span><strong>${detail.type === "ISSUED" ? "Emitida" : "Recibida"}</strong></article><article class="summary-card"><span>Tercero</span><strong>${esc(row.thirdPartyName || "-")}</strong><small>${esc(row.thirdPartyTaxId || "")}</small></article><article class="summary-card"><span>Documento origen</span><strong>${esc(row.originDocumentNumber || "-")}</strong></article><article class="summary-card"><span>Asiento</span><strong>${esc(row.journalEntryNumber || "No vinculado")}</strong></article></div>
      <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Impuesto</th><th>Código</th><th>Base</th><th>%</th><th>Retenido</th></tr></thead><tbody>${lines.map(line => `<tr><td>${esc(String(line.code || line.taxType || "") === "2" ? "IVA" : (line.taxType || "RENTA"))}</td><td>${esc(line.retentionCode || line.sriCode || line.code || "-")}</td><td>${money(line.taxableBase ?? line.baseAmount ?? 0)}</td><td>${esc(line.rate ?? line.percentage ?? 0)}%</td><td>${money(line.value ?? line.retainedAmount ?? 0)}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty-inline">Sin líneas disponibles.</div></td></tr>`}</tbody></table></div>
      <p class="muted-note">XML y RIDE no se cargan con el reporte; se solicitan únicamente desde el flujo documental correspondiente.</p></section>`;
  }
  function render(container, route) {
    const api = service();
    const state = api?.snapshot?.() || { started: false, error: "", page: { loaded: false, loading: false, items: [], total: 0, summary: {}, page: 1, pageSize: ui.pageSize }, detail: null };
    if (!state.started) void api?.start?.(() => { if (BlessERP.state?.currentRoute?.()?.id === route.id) BlessERP.layout.renderPage(); });
    api?.setActiveRoute?.(route.id);
    const page = state.page || {};
    const summary = page.summary || {};
    const pageCount = Math.max(1, Math.ceil(Number(page.total || 0) / Number(page.pageSize || 25)));
    container.innerHTML = `<section class="page-header page-header-compact"><div><p class="section-kicker">REPORTE TRIBUTARIO</p><h1>${esc(route.title)}</h1><p>${esc(route.description)}</p></div><div class="page-header-side"><span class="status-badge partial">READ-ONLY</span></div></section>
      ${state.error ? `<section class="inline-feedback error">${esc(state.error)}</section>` : ""}${ui.errors.length ? `<section class="inline-feedback error">${ui.errors.map(esc).join(" ")}</section>` : ""}${ui.message ? `<section class="inline-feedback success">${esc(ui.message)}</section>` : ""}
      <section class="panel-card compact-toolbar-card"><div class="compact-toolbar purchase-retention-report-toolbar">
        <label class="compact-inline-field"><span>Desde</span><input id="retention-report-date-from" type="date" value="${esc(ui.draftFilters.dateFrom)}"></label><label class="compact-inline-field"><span>Hasta</span><input id="retention-report-date-to" type="date" value="${esc(ui.draftFilters.dateTo)}"></label>
        <label class="compact-inline-field"><span>Tipo</span><select id="retention-report-type"><option value="ALL" ${ui.draftFilters.type === "ALL" ? "selected" : ""}>Todas</option><option value="ISSUED" ${ui.draftFilters.type === "ISSUED" ? "selected" : ""}>Emitidas</option><option value="RECEIVED" ${ui.draftFilters.type === "RECEIVED" ? "selected" : ""}>Recibidas</option></select></label>
        <label class="compact-inline-field"><span>Estado</span><input id="retention-report-status" placeholder="Estado canónico" value="${esc(ui.draftFilters.status)}"></label>
        ${ui.draftFilters.type !== "RECEIVED" ? `<label class="compact-inline-field"><span>Proveedor (emitidas)</span><select id="retention-report-supplier"><option value="">Todos</option>${providers().map(item => `<option value="${esc(item.id)}" ${ui.draftFilters.supplierId === item.id ? "selected" : ""}>${esc(item.name || item.legalName || item.businessName || item.ruc || item.id)}</option>`).join("")}</select></label>` : ""}
        ${ui.draftFilters.type !== "ISSUED" ? `<label class="compact-inline-field"><span>Cliente (recibidas)</span><select id="retention-report-customer"><option value="">Todos</option>${customers().map(item => `<option value="${esc(item.id)}" ${ui.draftFilters.customerId === item.id ? "selected" : ""}>${esc(item.name)} · ${esc(item.taxId || "-")}</option>`).join("")}</select></label>` : ""}
        <label class="compact-inline-field"><span>Código</span><input id="retention-report-code" value="${esc(ui.draftFilters.retentionCode)}"></label><label class="compact-inline-field"><span>Número retención</span><input id="retention-report-number" value="${esc(ui.draftFilters.retentionNumber)}"></label><label class="compact-inline-field"><span>Documento origen</span><input id="retention-report-document" value="${esc(ui.draftFilters.documentNumber)}"></label><label class="compact-inline-field"><span>Buscar</span><input id="retention-report-search" value="${esc(ui.draftFilters.search)}"></label>
        <label class="compact-inline-field"><span>Filas</span><select id="retention-report-page-size"><option value="25" ${ui.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${ui.pageSize === 50 ? "selected" : ""}>50</option></select></label>
        <div class="compact-toolbar-actions"><button class="primary-button" type="button" data-retention-report-generate ${page.loading ? "disabled" : ""}>${page.loading ? "Consultando..." : "Generar reporte"}</button><button class="secondary-button" type="button" data-retention-report-export ${!page.loaded || ui.exporting ? "disabled" : ""}>${ui.exporting ? "Preparando..." : "Descargar XLSX"}</button></div></div></section>
      ${page.loaded ? `<section class="summary-grid purchase-retention-report-summary"><article class="summary-card"><span>Comprobantes</span><strong>${Number(summary.documentCount || 0)}</strong><small>${Number(summary.issuedDocuments || 0)} emitidas · ${Number(summary.receivedDocuments || 0)} recibidas</small></article><article class="summary-card"><span>Base imponible</span><strong>${money(summary.taxableBase)}</strong></article><article class="summary-card"><span>Retenido IR</span><strong>${money(summary.rentRetained)}</strong></article><article class="summary-card"><span>Retenido IVA</span><strong>${money(summary.vatRetained)}</strong></article><article class="summary-card"><span>Total retenido</span><strong>${money(summary.totalRetained)}</strong><small>${Number(page.total || 0)} línea(s)</small></article></section>` : ""}
      <article class="panel-card"><div class="panel-card-head panel-card-head-compact"><div><p class="section-kicker">DETALLE PAGINADO</p><h3>Una fila por código de retención</h3></div>${page.loaded ? `<span class="status-badge partial">Página ${page.page} de ${pageCount}</span>` : ""}</div><div class="compact-table-wrap"><table class="compact-table purchase-retention-report-table"><thead><tr><th>Tipo</th><th>Fecha</th><th>Tercero</th><th>Documento origen</th><th>Retención</th><th>Impuesto</th><th>Código</th><th>Base</th><th>%</th><th>Retenido</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
        ${page.loaded ? (page.items || []).map(item => `<tr><td>${item.type === "ISSUED" ? "Emitida" : "Recibida"}</td><td>${esc(item.date || "-")}</td><td><strong>${esc(item.thirdPartyName || "-")}</strong><small>${esc(item.thirdPartyTaxId || "")}</small></td><td>${esc(item.originDocumentNumber || "-")}</td><td><strong>${esc(item.retentionNumber || "-")}</strong></td><td>${esc(item.taxType || "-")}</td><td>${esc(item.retentionCode || "-")}</td><td>${money(item.taxableBase)}</td><td>${esc(item.percentage)}%</td><td><strong>${money(item.retainedAmount)}</strong></td><td>${badge(item.status)}</td><td><button class="row-action-button" type="button" data-retention-report-detail="${esc(item.lineId)}">Ver detalle</button></td></tr>`).join("") || `<tr><td colspan="12"><div class="empty-inline">No existen retenciones para los filtros aplicados.</div></td></tr>` : `<tr><td colspan="12"><div class="empty-inline">Selecciona los filtros y pulsa Generar reporte.</div></td></tr>`}</tbody></table></div>
        ${page.loaded ? `<div class="pagination-bar"><span>Mostrando ${page.total ? (page.page - 1) * page.pageSize + 1 : 0}–${Math.min(page.page * page.pageSize, page.total)} de ${page.total}</span><div><button class="secondary-button" type="button" data-retention-report-page="${page.page - 1}" ${page.page <= 1 ? "disabled" : ""}>Anterior</button><button class="secondary-button" type="button" data-retention-report-page="${page.page + 1}" ${page.page >= pageCount ? "disabled" : ""}>Siguiente</button></div></div>` : ""}</article>${renderDetail(state.detail)}`;
    bind();
    return true;
  }
  function bind() {
    const api = service();
    const draft = (selector, key) => document.querySelector(selector)?.addEventListener("change", event => { ui.draftFilters[key] = event.target.value; });
    draft("#retention-report-date-from", "dateFrom"); draft("#retention-report-date-to", "dateTo"); draft("#retention-report-status", "status"); draft("#retention-report-supplier", "supplierId"); draft("#retention-report-customer", "customerId"); draft("#retention-report-code", "retentionCode"); draft("#retention-report-number", "retentionNumber"); draft("#retention-report-document", "documentNumber"); draft("#retention-report-search", "search");
    document.querySelector("#retention-report-type")?.addEventListener("change", event => { ui.draftFilters.type = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#retention-report-page-size")?.addEventListener("change", event => { ui.pageSize = Number(event.target.value) === 50 ? 50 : 25; });
    const run = async page => {
      ui.errors = []; ui.message = "";
      const filters = clone(ui.draftFilters);
      if (!filters.dateFrom || !filters.dateTo) ui.errors.push("Selecciona Desde y Hasta.");
      if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) ui.errors.push("El rango de fechas no es válido.");
      if (filters.type === "ISSUED") filters.customerId = "";
      if (filters.type === "RECEIVED") filters.supplierId = "";
      if (ui.errors.length) return BlessERP.layout.renderPage();
      try { await api?.query?.(filters, { page, pageSize: ui.pageSize }); } catch (error) { ui.errors = [error.message || "No se pudo generar el reporte."]; }
      BlessERP.layout.renderPage();
    };
    document.querySelector("[data-retention-report-generate]")?.addEventListener("click", () => run(1));
    document.querySelectorAll("[data-retention-report-page]").forEach(button => button.addEventListener("click", async () => {
      const currentPage = api?.snapshot?.().page || {};
      const applied = currentPage.appliedFilters; if (!applied) return;
      try { await api.query(applied, { page: Number(button.dataset.retentionReportPage), pageSize: currentPage.pageSize || 25 }); } catch (error) { ui.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-retention-report-detail]").forEach(button => button.addEventListener("click", async () => {
      const row = api?.snapshot?.().page?.items?.find(item => item.lineId === button.dataset.retentionReportDetail);
      try { await api?.loadDetail?.(row); } catch (error) { ui.errors = [error.message || "No se pudo cargar el detalle."]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-retention-report-detail-close]")?.addEventListener("click", () => api?.closeDetail?.());
    document.querySelector("[data-retention-report-export]")?.addEventListener("click", async () => {
      ui.exporting = true; ui.errors = []; ui.message = ""; BlessERP.layout.renderPage();
      try { const result = await api?.exportApplied?.(); download(result); ui.message = `XLSX validado: ${result.total} línea(s), mismos filtros del reporte consultado.`; }
      catch (error) { ui.errors = [error.message || "No se pudo exportar el reporte."]; }
      finally { ui.exporting = false; BlessERP.layout.renderPage(); }
    });
  }

  BlessERP.retentionReportV2Ui = Object.freeze({ buildWorkbook: workbook, render });
})();
