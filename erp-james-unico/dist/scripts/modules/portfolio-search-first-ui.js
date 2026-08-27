(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money } = BlessERP.utils;
  const read = () => BlessERP.services?.portfolioReadV2;
  const portfolio = () => BlessERP.services?.portfolios;
  const receivables = () => BlessERP.services?.receivables;
  let listeners = null;
  let booting = { ap: false, ar: false };
  const today = () => new Date().toISOString().slice(0, 10);
  const monthStart = () => `${today().slice(0, 7)}-01`;
  const ui = {
    ap: { draft: { search: "", providerId: "", state: "", dueMode: "" }, historyDraft: { dateFrom: monthStart(), dateTo: today(), providerId: "", state: "", document: "", search: "" }, message: "", detail: null },
    ar: { draft: { search: "", customerId: "", state: "", dueMode: "" }, historyDraft: { dateFrom: monthStart(), dateTo: today(), customerId: "", state: "", documentType: "", document: "", search: "" }, message: "", detail: null, editor: null }
  };

  function tabs(route) {
    return `<div class="subnav-tabs">${(BlessERP.navigation.groupMap[route.groupId]?.routes || []).map(item => `<button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>`).join("")}</div>`;
  }
  function statusBadge(status) {
    const value = String(status || "").toLowerCase();
    const css = value.includes("anulado") ? "cancelled" : value.includes("pendiente") || value.includes("vencido") ? "pending" : value.includes("pagado") || value.includes("cobrado") ? "authorized" : "partial";
    return `<span class="status-badge ${css}">${esc(status || "-")}</span>`;
  }
  function pageState(kind) {
    const snap = read()?.snapshot?.() || {};
    const root = snap[kind] || { view: "OPERATIVE", open: {}, history: {} };
    return { snap, root, view: root.view || "OPERATIVE", data: root.view === "HISTORY" ? root.history : root.open };
  }
  async function ensureOpen(kind) {
    const state = pageState(kind);
    if (state.data?.loaded || booting[kind] || state.snap?.error) return;
    booting[kind] = true;
    try {
      await read()?.start?.(() => BlessERP.layout?.renderPage?.());
      const after = pageState(kind);
      if (!after.snap.error && !after.root.open.loaded) await read()?.queryOpen?.(kind, ui[kind].draft, { page: 1, pageSize: 25 });
    } catch (error) { ui[kind].message = error.message; }
    finally { booting[kind] = false; BlessERP.layout?.renderPage?.(); }
  }
  function pager(kind, data) {
    if (!data?.loaded || Number(data.total || 0) <= Number(data.pageSize || 25)) return "";
    const pages = Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.pageSize || 25)));
    return `<div class="table-pager"><button class="secondary-button" data-portfolio-page="${Math.max(1, data.page - 1)}" ${data.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.page} de ${pages}</span><button class="secondary-button" data-portfolio-page="${Math.min(pages, data.page + 1)}" ${data.page >= pages ? "disabled" : ""}>Siguiente</button></div>`;
  }
  function summaryCards(kind, summary = {}) {
    if (kind === "ap") return `<section class="summary-grid summary-grid-payables">
      <article class="summary-card"><span>Total pendiente</span><strong>${money(summary.totalPending || summary.totalBalance || 0)}</strong></article>
      <article class="summary-card"><span>Total vencido</span><strong>${money(summary.totalOverdue || 0)}</strong></article>
      <article class="summary-card"><span>Por vencer</span><strong>${money(summary.totalUpcoming || 0)}</strong></article>
      <article class="summary-card"><span>Documentos</span><strong>${esc(String(summary.openDocuments ?? summary.totalDocuments ?? 0))}</strong></article></section>`;
    return `<section class="summary-grid summary-grid-payables">
      <article class="summary-card"><span>Total pendiente</span><strong>${money(summary.totalPending || summary.totalBalance || 0)}</strong></article>
      <article class="summary-card"><span>Total vencido</span><strong>${money(summary.totalOverdue || 0)}</strong></article>
      <article class="summary-card"><span>Por vencer</span><strong>${money(summary.totalUpcoming || 0)}</strong></article>
      <article class="summary-card"><span>Documentos</span><strong>${esc(String(summary.openDocuments ?? summary.totalDocuments ?? 0))}</strong></article></section>`;
  }
  function filterValue(id) { return document.querySelector(`#${id}`)?.value || ""; }
  function apFilters(view) {
    if (view === "HISTORY") return { dateFrom: filterValue("ap-date-from"), dateTo: filterValue("ap-date-to"), providerId: filterValue("ap-provider"), state: filterValue("ap-state"), document: filterValue("ap-document"), search: filterValue("ap-search") };
    return { providerId: filterValue("ap-provider"), state: filterValue("ap-state"), dueMode: filterValue("ap-due"), search: filterValue("ap-search") };
  }
  function arFilters(view) {
    if (view === "HISTORY") return { dateFrom: filterValue("ar-date-from"), dateTo: filterValue("ar-date-to"), customerId: filterValue("ar-customer"), state: filterValue("ar-state"), documentType: filterValue("ar-type"), document: filterValue("ar-document"), search: filterValue("ar-search") };
    return { customerId: filterValue("ar-customer"), state: filterValue("ar-state"), dueMode: filterValue("ar-due"), search: filterValue("ar-search") };
  }
  function commonToolbar(kind, view) {
    const isAp = kind === "ap";
    const draft = view === "HISTORY" ? ui[kind].historyDraft : ui[kind].draft;
    const options = isAp ? portfolio()?.providers?.() || [] : receivables()?.customers?.() || [];
    const partyKey = isAp ? "providerId" : "customerId";
    return `<section class="panel-card compact-toolbar-card"><div class="compact-toolbar compact-toolbar-payables">
      ${view === "HISTORY" ? `<label class="compact-inline-field"><span>Desde</span><input id="${kind}-date-from" type="date" value="${esc(draft.dateFrom)}"></label><label class="compact-inline-field"><span>Hasta</span><input id="${kind}-date-to" type="date" value="${esc(draft.dateTo)}"></label>` : ""}
      <label class="compact-inline-field"><span>${isAp ? "Proveedor" : "Cliente"}</span><select id="${kind}-${isAp ? "provider" : "customer"}"><option value="">Todos</option>${options.map(item => `<option value="${esc(item.id)}" ${draft[partyKey] === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
      <label class="compact-inline-field"><span>Estado</span><select id="${kind}-state"><option value="">Todos</option>${(isAp ? portfolio().payableStates : receivables().receivableStates).map(value => `<option value="${esc(value)}" ${draft.state === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>
      ${view === "OPERATIVE" ? `<label class="compact-inline-field"><span>Vencimiento</span><select id="${kind}-due"><option value="">Todas abiertas</option><option value="OVERDUE" ${draft.dueMode === "OVERDUE" ? "selected" : ""}>Vencidas</option><option value="UPCOMING" ${draft.dueMode === "UPCOMING" ? "selected" : ""}>Por vencer</option></select></label>` : ""}
      ${view === "HISTORY" && !isAp ? `<label class="compact-inline-field"><span>Tipo</span><select id="ar-type"><option value="">Todos</option>${receivables().receivableDocumentTypes.map(value => `<option value="${esc(value)}" ${draft.documentType === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>` : ""}
      ${view === "HISTORY" ? `<label class="compact-inline-field"><span>Documento</span><input id="${kind}-document" value="${esc(draft.document || "")}"></label>` : ""}
      <label class="compact-inline-field"><span>Buscar</span><input id="${kind}-search" value="${esc(draft.search || "")}" placeholder="Número o referencia"></label>
      <label class="compact-inline-field"><span>Filas</span><select id="${kind}-page-size"><option value="25">25</option><option value="50">50</option></select></label>
      <button class="primary-button" type="button" data-portfolio-consult>Consultar</button>
    </div></section>`;
  }
  function detailPanel(kind, detail) {
    if (!detail) return "";
    const apps = detail.applications || [];
    const adjustments = kind === "ap" ? detail.adjustments || [] : [...(detail.creditNotes || []), ...(detail.receivedWithholdings || [])];
    return `<article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">DETALLE LAZY</p><h3>Documento seleccionado</h3></div><button class="secondary-button" data-portfolio-detail-close>Cerrar</button></div>
      <div class="info-stack info-grid-two"><div class="info-row"><strong>Aplicaciones</strong><span>${apps.length}</span></div><div class="info-row"><strong>${kind === "ap" ? "Ajustes" : "Notas / retenciones"}</strong><span>${adjustments.length}</span></div><div class="info-row"><strong>Asiento</strong><span>${detail.journal?.header?.entry_number || detail.journal?.header?.entryNumber || "No registrado"}</span></div></div></article>`;
  }
  function receivableEditor() {
    const draft = ui.ar.editor;
    if (!draft) return "";
    const accounts = BlessERP.services?.chartOfAccounts?.movementOptions?.() || [];
    return `<article class="panel-card editor-card"><div class="panel-card-head"><div><p class="section-kicker">DOCUMENTO</p><h3>${draft.id ? `Editar ${esc(draft.documentNumber)}` : "Nuevo documento de cartera"}</h3></div><div class="editor-actions"><button class="secondary-button" data-ar-editor-cancel>Cancelar</button><button class="secondary-button" data-ar-editor-save>Guardar</button><button class="primary-button" data-ar-editor-post>Guardar y contabilizar</button></div></div>
      <form id="portfolio-ar-editor" class="compact-form-grid"><label class="compact-field"><span>Cliente</span><select name="customerId"><option value="">Seleccionar</option>${receivables().customers().map(item => `<option value="${esc(item.id)}" ${draft.customerId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
      <label class="compact-field"><span>Tipo</span><select name="documentType">${receivables().receivableDocumentTypes.map(item => `<option value="${esc(item)}" ${draft.documentType === item ? "selected" : ""}>${esc(item)}</option>`).join("")}</select></label>
      <label class="compact-field"><span>Número</span><input name="documentNumber" value="${esc(draft.documentNumber || "")}"></label><label class="compact-field"><span>Emisión</span><input type="date" name="issueDate" value="${esc(draft.issueDate || "")}"></label><label class="compact-field"><span>Vencimiento</span><input type="date" name="dueDate" value="${esc(draft.dueDate || "")}"></label><label class="compact-field"><span>Total</span><input type="number" min="0" step="0.01" name="total" value="${esc(String(draft.total || 0))}"></label>
      <label class="compact-field"><span>Cuenta por cobrar</span><select name="receivableAccountCode"><option value="">Seleccionar</option>${accounts.map(item => `<option value="${esc(item.code)}" ${draft.receivableAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}</select></label>
      <label class="compact-field"><span>Contrapartida</span><select name="counterAccountCode"><option value="">Seleccionar</option>${accounts.map(item => `<option value="${esc(item.code)}" ${draft.counterAccountCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}</select></label>
      <label class="compact-field full"><span>Concepto</span><input name="concept" value="${esc(draft.concept || "")}"></label><label class="compact-field full"><span>Observación</span><textarea name="observation">${esc(draft.observation || "")}</textarea></label></form></article>`;
  }
  function collectEditor() {
    const form = document.querySelector("#portfolio-ar-editor");
    if (!form) return ui.ar.editor;
    return { ...ui.ar.editor, customerId: form.elements.customerId.value, documentType: form.elements.documentType.value,
      documentNumber: form.elements.documentNumber.value, issueDate: form.elements.issueDate.value, dueDate: form.elements.dueDate.value,
      total: Number(form.elements.total.value || 0), receivableAccountCode: form.elements.receivableAccountCode.value,
      counterAccountCode: form.elements.counterAccountCode.value, concept: form.elements.concept.value, observation: form.elements.observation.value };
  }
  async function exportCurrent(kind, view) {
    const state = pageState(kind).data;
    if (!state.loaded || !state.appliedFilters) throw new Error("Consulta la cartera antes de descargar.");
    const exported = await read().exportAll(kind, view === "HISTORY" ? "history" : "open", state.appliedFilters);
    const isAp = kind === "ap";
    const headers = isAp
      ? ["PROVEEDOR", "RUC", "DOCUMENTO", "EMISION", "VENCIMIENTO", "TOTAL", "SALDO", "ESTADO"]
      : ["CLIENTE", "IDENTIFICACION", "DOCUMENTO", "EMISION", "VENCIMIENTO", "TOTAL", "SALDO", "ESTADO"];
    const rows = exported.items.map(item => isAp
      ? [item.providerName, item.providerRuc, item.documentNumber, item.issueDate, item.dueDate, item.totalDocument, item.balance, item.state]
      : [item.customerName, item.customerTaxId, item.documentNumber, item.issueDate, item.dueDate, item.total, item.balance, item.status]);
    return BlessERP.reportFinancialXlsx?.exportReport?.(isAp ? "payables-report" : "receivables-report", state.appliedFilters, {
      definition: { report: { filters: state.appliedFilters, total: exported.total, source: "PORTFOLIO_READ_V2" }, label: isAp ? "cuentas-por-pagar" : "cuentas-por-cobrar", sheets: [{ name: isAp ? "CxP" : "CxC", title: isAp ? "CUENTAS POR PAGAR" : "CUENTAS POR COBRAR", headers, widths: [28, 18, 22, 14, 14, 16, 16, 14], rows }] }
    });
  }
  function renderAp(container, route) {
    read()?.setActiveRoute?.("portfolios-ap");
    const { snap, view, data } = pageState("ap");
    void ensureOpen("ap");
    const rows = data.items || [];
    container.innerHTML = `<section class="page-header"><div><p class="section-kicker">CARTERA</p><h1>Cuentas por pagar</h1><p>Obligaciones abiertas al iniciar; documentos cerrados únicamente bajo consulta.</p></div><div class="page-header-side"><button class="secondary-button" data-opening-balances-template>Plantilla saldos</button><button class="secondary-button" data-opening-balances-import="CXP">Importar saldos</button><input type="file" accept=".xlsx" hidden data-opening-balances-file="CXP"><button class="secondary-button" data-portfolio-export>Descargar XLSX</button><button class="secondary-button" data-route-link="portfolios-payments-single">Nuevo pago</button><button class="secondary-button" data-route-link="portfolios-payments-bulk">Pago masivo</button></div></section>${tabs(route)}
      <div class="subnav-tabs"><button class="subnav-tab ${view === "OPERATIVE" ? "active" : ""}" data-portfolio-view="OPERATIVE">Cartera operativa</button><button class="subnav-tab ${view === "HISTORY" ? "active" : ""}" data-portfolio-view="HISTORY">Historial</button></div>
      ${snap.error ? `<section class="inline-feedback danger">${esc(snap.error)}</section>` : ""}${ui.ap.message ? `<section class="inline-feedback">${esc(ui.ap.message)}</section>` : ""}
      ${commonToolbar("ap", view)}${data.loaded ? summaryCards("ap", data.summary) : ""}
      <article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">${view === "HISTORY" ? "HISTORIAL" : "OPERATIVO"}</p><h3>${view === "HISTORY" ? "Obligaciones consultadas" : "Obligaciones abiertas y vencidas"}</h3></div><span class="status-badge partial">${esc(String(data.total || 0))}</span></div>
      ${!data.loaded ? `<div class="empty-inline">${view === "HISTORY" ? "Selecciona filtros y pulsa Consultar." : "Cargando cartera operativa…"}</div>` : `<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Proveedor</th><th>Documento</th><th>Emisión</th><th>Vence</th><th>Total</th><th>Saldo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(item => `<tr><td><strong>${esc(item.providerName)}</strong><small>${esc(item.providerRuc || "")}</small></td><td>${esc(item.documentNumber)}</td><td>${esc(item.issueDate)}</td><td>${esc(item.dueDate)}</td><td>${money(item.totalDocument ?? item.total)}</td><td><strong>${money(item.balance)}</strong></td><td>${statusBadge(item.state)}</td><td><div class="row-actions"><button class="row-action-button" data-portfolio-detail="${esc(item.id)}" data-portfolio-source="${esc(item.source)}">Ver detalle</button>${view === "OPERATIVE" ? `<button class="row-action-button" data-ap-pay="${esc(item.id)}">Pagar</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="8"><div class="empty-inline">Sin resultados.</div></td></tr>`}</tbody></table></div>${pager("ap", data)}`}</article>${detailPanel("ap", ui.ap.detail)}`;
    bind("ap", view);
  }
  function renderAr(container, route) {
    read()?.setActiveRoute?.("portfolios-ar");
    const { snap, view, data } = pageState("ar");
    void ensureOpen("ar");
    const rows = data.items || [];
    container.innerHTML = `<section class="page-header"><div><p class="section-kicker">CARTERA</p><h1>Cuentas por cobrar</h1><p>Documentos abiertos al iniciar; cartera cobrada y anulada únicamente bajo consulta.</p></div><div class="page-header-side"><button class="secondary-button" data-opening-balances-template>Plantilla saldos</button><button class="secondary-button" data-opening-balances-import="CXC">Importar saldos</button><input type="file" accept=".xlsx" hidden data-opening-balances-file="CXC"><button class="secondary-button" data-portfolio-export>Descargar XLSX</button><button class="secondary-button" data-ar-new>Nuevo documento</button><button class="secondary-button" data-route-link="portfolios-collections-single">Nuevo cobro</button></div></section>${tabs(route)}
      <div class="subnav-tabs"><button class="subnav-tab ${view === "OPERATIVE" ? "active" : ""}" data-portfolio-view="OPERATIVE">Cartera operativa</button><button class="subnav-tab ${view === "HISTORY" ? "active" : ""}" data-portfolio-view="HISTORY">Historial</button></div>
      ${snap.error ? `<section class="inline-feedback danger">${esc(snap.error)}</section>` : ""}${ui.ar.message ? `<section class="inline-feedback">${esc(ui.ar.message)}</section>` : ""}
      ${commonToolbar("ar", view)}${data.loaded ? summaryCards("ar", data.summary) : ""}${receivableEditor()}
      <article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">${view === "HISTORY" ? "HISTORIAL" : "OPERATIVO"}</p><h3>${view === "HISTORY" ? "Documentos consultados" : "Facturas abiertas y vencidas"}</h3></div><span class="status-badge partial">${esc(String(data.total || 0))}</span></div>
      ${!data.loaded ? `<div class="empty-inline">${view === "HISTORY" ? "Selecciona filtros y pulsa Consultar." : "Cargando cartera operativa…"}</div>` : `<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Cliente</th><th>Documento</th><th>Emisión</th><th>Vence</th><th>Total</th><th>Saldo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(item => `<tr><td><strong>${esc(item.customerName)}</strong><small>${esc(item.customerTaxId || "")}</small></td><td>${esc(item.documentNumber)}</td><td>${esc(item.issueDate)}</td><td>${esc(item.dueDate)}</td><td>${money(item.total)}</td><td><strong>${money(item.balance)}</strong></td><td>${statusBadge(item.status)}</td><td><div class="row-actions"><button class="row-action-button" data-portfolio-detail="${esc(item.id)}" data-portfolio-source="${esc(item.source)}">Ver detalle</button>${item.source === "LEGACY_PROJECTION" && !item.journalEntryId && item.status !== "ANULADO" ? `<button class="row-action-button" data-ar-edit="${esc(item.id)}">Editar</button><button class="row-action-button" data-ar-post="${esc(item.id)}">Contabilizar</button><button class="row-action-button" data-ar-annul="${esc(item.id)}">Anular</button>` : ""}${view === "OPERATIVE" ? `<button class="row-action-button" data-ar-collect="${esc(item.id)}">Cobrar</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="8"><div class="empty-inline">Sin resultados.</div></td></tr>`}</tbody></table></div>${pager("ar", data)}`}</article>${detailPanel("ar", ui.ar.detail)}`;
    bind("ar", view);
  }
  function bind(kind, view) {
    listeners?.abort?.(); listeners = new AbortController(); const signal = listeners.signal;
    document.querySelectorAll("[data-portfolio-view]").forEach(button => button.addEventListener("click", () => { read().setView(kind, button.dataset.portfolioView); ui[kind].detail = null; BlessERP.layout.renderPage(); }, { signal }));
    document.querySelector("[data-portfolio-consult]")?.addEventListener("click", async () => {
      const filters = kind === "ap" ? apFilters(view) : arFilters(view); const pageSize = Number(filterValue(`${kind}-page-size`) || 25);
      if (view === "HISTORY" && (!filters.dateFrom || !filters.dateTo || filters.dateFrom > filters.dateTo)) { ui[kind].message = "Selecciona un rango de fechas válido."; BlessERP.layout.renderPage(); return; }
      view === "HISTORY" ? Object.assign(ui[kind].historyDraft, filters) : Object.assign(ui[kind].draft, filters);
      try { await (view === "HISTORY" ? read().queryHistory(kind, filters, { page: 1, pageSize }) : read().queryOpen(kind, filters, { page: 1, pageSize })); ui[kind].message = ""; }
      catch (error) { ui[kind].message = error.message; } BlessERP.layout.renderPage();
    }, { signal });
    document.querySelectorAll("[data-portfolio-page]").forEach(button => button.addEventListener("click", async () => {
      const state = pageState(kind).data; const filters = state.appliedFilters || {};
      await (view === "HISTORY" ? read().queryHistory(kind, filters, { page: Number(button.dataset.portfolioPage), pageSize: state.pageSize }) : read().queryOpen(kind, filters, { page: Number(button.dataset.portfolioPage), pageSize: state.pageSize })); BlessERP.layout.renderPage();
    }, { signal }));
    document.querySelectorAll("[data-portfolio-detail]").forEach(button => button.addEventListener("click", async () => { try { ui[kind].detail = await read().detail(kind, button.dataset.portfolioDetail, button.dataset.portfolioSource); } catch (error) { ui[kind].message = error.message; } BlessERP.layout.renderPage(); }, { signal }));
    document.querySelector("[data-portfolio-detail-close]")?.addEventListener("click", () => { ui[kind].detail = null; BlessERP.layout.renderPage(); }, { signal });
    document.querySelector("[data-portfolio-export]")?.addEventListener("click", async event => { const button = event.currentTarget; button.disabled = true; try { const result = await exportCurrent(kind, view); if (!result?.ok) throw new Error(result?.message || "No se pudo descargar."); } catch (error) { ui[kind].message = error.message; } finally { button.disabled = false; BlessERP.layout.renderPage(); } }, { signal });
    document.querySelector("[data-opening-balances-template]")?.addEventListener("click", async event => {
      const button = event.currentTarget; const original = button.textContent; button.disabled = true; button.textContent = "Generando...";
      try { const result = await BlessERP.services.openingBalancesXlsx?.generateTemplate?.(); if (!result?.ok) throw new Error((result?.errors || ["No se pudo generar la plantilla."]).join(" ")); }
      catch (error) { ui[kind].message = error.message; }
      finally { button.disabled = false; button.textContent = original; BlessERP.layout.renderPage(); }
    }, { signal });
    document.querySelector("[data-opening-balances-import]")?.addEventListener("click", event => document.querySelector(`[data-opening-balances-file="${event.currentTarget.dataset.openingBalancesImport}"]`)?.click(), { signal });
    document.querySelector("[data-opening-balances-file]")?.addEventListener("change", async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const importKind = event.target.dataset.openingBalancesFile;
      try {
        // La importación de saldos iniciales conserva por ahora la mutación
        // legacy validada. Sus caches históricos se cargan únicamente cuando
        // el operador elige el archivo, nunca al abrir CxP/CxC ni durante login.
        const mutationDomains = importKind === "CXP"
          ? ["purchases-workspace", "finance-workspace"]
          : ["portfolio-workspace", "finance-workspace"];
        for (const domain of mutationDomains) await BlessERP.domainDataLoader?.ensureDomain?.(domain);
        const result = await BlessERP.services.openingBalancesXlsx?.importFile?.(file, { kind: importKind }); if (!result?.ok) throw new Error((result?.errors || ["No se pudo importar la plantilla."]).join(" ")); ui[kind].message = `${result.count} saldo(s) inicial(es) ${importKind} importado(s) y contabilizado(s).`; await read().refreshKind(kind);
      }
      catch (error) { ui[kind].message = error.message; }
      finally { event.target.value = ""; BlessERP.layout.renderPage(); }
    }, { signal });
    document.querySelectorAll("[data-ap-pay]").forEach(button => button.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      const row = read().row("ap", button.dataset.apPay);
      if (!row) {
        ui.ap.message = "No se encontró la CxP canónica seleccionada.";
        BlessERP.layout.renderPage();
        return;
      }
      const resolved = await BlessERP.services?.supplierFinanceV2?.resolveProvider?.({
        providerId: row.providerId,
        taxId: row.providerRuc
      });
      if (!resolved?.ok || !resolved.provider) {
        ui.ap.message = resolved?.message || resolved?.errors?.[0] || "No se pudo resolver el proveedor canónico de la CxP.";
        BlessERP.layout.renderPage();
        return;
      }
      BlessERP.modules.part2Portfolios.ensurePaymentDraft(BlessERP.modules.part2Portfolios.paymentDraftFromPayable(row));
      BlessERP.state.setRoute("portfolios-payments-single");
      BlessERP.layout.renderApp();
    }, { signal }));
    document.querySelectorAll("[data-ar-collect]").forEach(button => button.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      const row = read().row("ar", button.dataset.arCollect);
      if (!row) {
        ui.ar.message = "No se encontró la CxC canónica seleccionada.";
        BlessERP.layout.renderPage();
        return;
      }
      const resolved = await receivables().resolveCanonicalCustomer?.({ customerId: row.customerId });
      if (!resolved?.ok || !resolved.customer) {
        ui.ar.message = resolved?.message || "No se pudo resolver el cliente canónico de la CxC.";
        BlessERP.layout.renderPage();
        return;
      }
      BlessERP.modules.part2Receivables.ensureCollectionDraft(BlessERP.modules.part2Receivables.collectionDraftFromReceivable(row));
      BlessERP.state.setRoute("portfolios-collections-single");
      BlessERP.layout.renderApp();
    }, { signal }));
    document.querySelector("[data-ar-new]")?.addEventListener("click", () => { ui.ar.editor = receivables().emptyReceivable(); ui.ar.message = ""; BlessERP.layout.renderPage(); }, { signal });
    document.querySelector("[data-ar-editor-cancel]")?.addEventListener("click", () => { ui.ar.editor = null; BlessERP.layout.renderPage(); }, { signal });
    document.querySelector("[data-ar-editor-save]")?.addEventListener("click", () => { const result = receivables().saveReceivable(collectEditor()); if (result.ok) { ui.ar.editor = result.receivable; ui.ar.message = `Documento ${result.receivable.documentNumber} guardado.`; } else ui.ar.message = (result.errors || [result.message]).filter(Boolean).join(" "); BlessERP.layout.renderPage(); }, { signal });
    document.querySelector("[data-ar-editor-post]")?.addEventListener("click", async () => { let current = collectEditor(); if (!current.id) { const saved = receivables().saveReceivable(current); if (!saved.ok) { ui.ar.message = (saved.errors || [saved.message]).filter(Boolean).join(" "); BlessERP.layout.renderPage(); return; } current = saved.receivable; } const result = await receivables().postReceivableV2(current.id); ui.ar.message = result.ok ? `Documento contabilizado con asiento ${result.entry.entryNumber}.` : (result.errors || [result.message]).filter(Boolean).join(" "); if (result.ok) { ui.ar.editor = null; await read().refreshKind("ar").catch(() => {}); } BlessERP.layout.renderPage(); }, { signal });
    document.querySelectorAll("[data-ar-edit]").forEach(button => button.addEventListener("click", async () => { try { const detail = await read().detail("ar", button.dataset.arEdit, "LEGACY_PROJECTION"); ui.ar.editor = receivables().normalizeReceivable(detail.item); } catch (error) { ui.ar.message = error.message; } BlessERP.layout.renderPage(); }, { signal }));
    document.querySelectorAll("[data-ar-post]").forEach(button => button.addEventListener("click", async () => { const result = await receivables().postReceivableV2(button.dataset.arPost); ui.ar.message = result.ok ? `Documento contabilizado con asiento ${result.entry.entryNumber}.` : (result.errors || [result.message]).filter(Boolean).join(" "); if (result.ok) await read().refreshKind("ar").catch(() => {}); BlessERP.layout.renderPage(); }, { signal }));
    document.querySelectorAll("[data-ar-annul]").forEach(button => button.addEventListener("click", async () => { const result = receivables().annulReceivable(button.dataset.arAnnul); ui.ar.message = result.ok ? "Documento anulado y reversado cuando correspondía." : (result.message || "No se pudo anular el documento."); if (result.ok) await read().refreshKind("ar").catch(() => {}); BlessERP.layout.renderPage(); }, { signal }));
  }

  function install() {
    const apModule = BlessERP.modules?.part2Portfolios; const arModule = BlessERP.modules?.part2Receivables;
    if (!apModule || !arModule || apModule.__searchFirstInstalled) return;
    const apRender = apModule.render.bind(apModule); const arRender = arModule.render.bind(arModule);
    apModule.render = (container, route) => route.id === "portfolios-ap" ? renderAp(container, route) : apRender(container, route);
    arModule.render = (container, route) => route.id === "portfolios-ar" ? renderAr(container, route) : arRender(container, route);
    apModule.__searchFirstInstalled = true; arModule.__searchFirstInstalled = true;
  }
  install();
  BlessERP.portfolioSearchFirstUI = Object.freeze({ install, renderAp, renderAr });
})();
